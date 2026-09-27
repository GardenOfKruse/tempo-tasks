/** 调度器：秒级粗粒度轮询，触发即时执行；启动/唤醒时做错过检查 */
import { powerMonitor } from 'electron'
import type { Executor } from './executor'
import type { Store } from './storage'
import type { Task } from './types'
import { CATCH_UP_MAX_AGE_MS } from './types'
import { nextRunAt } from './schedule'

export interface SchedulerHooks {
  fire(task: Task, trigger: 'scheduled' | 'catch-up'): void
  onTasksChanged(): void
  onNotice(text: string): void
}

const TICK_MS = 1000

export class Scheduler {
  private timer: NodeJS.Timeout | null = null

  constructor(private store: Store, private executor: Executor, private hooks: SchedulerHooks) {}

  start(): void {
    this.stop()
    this.catchUpCheck()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref?.()
    powerMonitor.on('resume', () => {
      // 睡眠唤醒：setInterval 会堆积暂停，先补一轮错过检查
      this.catchUpCheck()
      this.tick()
    })
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** 任务变更后重算 nextRunAt 并落盘 */
  /** 任务变更/启用后重算 nextRunAt 并落盘。以当前时刻为基准，避免把已排定的未来时刻拉回过去造成误触发 */
  recompute(task: Task): void {
    const now = Date.now()
    task.nextRunAt = task.enabled ? nextRunAt(task.schedule, now) : null
    if (task.enabled && task.schedule.kind === 'once' && task.nextRunAt === null) {
      // 一次性任务的计划时刻已过且从未触发 → 标记错过
      if (task.lastRunAt === null) task.missedOnce = true
    }
    this.store.saveSoon()
  }

  /** 启动时调用：只补算缺失的 nextRunAt，已排定的未来调度不动（错过由 catchUpCheck 处理） */
  recomputeAll(): void {
    for (const t of this.store.snapshot.tasks) {
      if (t.enabled && t.nextRunAt === null) this.recompute(t)
    }
    this.hooks.onTasksChanged()
  }

  private tick(): void {
    const now = Date.now()
    let changed = false
    for (const task of this.store.snapshot.tasks) {
      if (!task.enabled) continue
      try {
        if (task.concurrency === 'skip' && this.executor.isRunning(task.id)) continue
        if (task.nextRunAt !== null && now >= task.nextRunAt) {
          const due = task.nextRunAt
          changed = true
          task.lastRunAt = now
          if (task.schedule.kind === 'once') {
            task.nextRunAt = null
          } else if (task.schedule.kind === 'interval') {
            // interval 以到期时刻为锚推进，避免 tick 采样相位逐次累加漂移
            task.nextRunAt = nextRunAt(task.schedule, due)
          } else {
            task.nextRunAt = nextRunAt(task.schedule, now)
          }
          this.hooks.fire(task, 'scheduled')
          if (now - due > 5000 && task.schedule.kind !== 'once') {
            this.hooks.onNotice(`「${task.name}」已按计划触发`)
          }
        }
      } catch (e) {
        // 单个任务的异常数据不应拖垮整个调度循环
        console.error('[scheduler] tick task failed:', task.id, e)
      }
    }
    if (changed) {
      this.store.saveSoon()
      this.hooks.onTasksChanged()
    }
  }

  /** 应用启动与系统唤醒：检查错过的调度 */
  private catchUpCheck(): void {
    const now = Date.now()
    let changed = false
    for (const task of this.store.snapshot.tasks) {
      if (!task.enabled) continue
      if (task.schedule.kind === 'once') {
        // 过期且从未跑过 → 标记错过
        if (task.lastRunAt === null && task.nextRunAt !== null && now > task.nextRunAt) {
          task.nextRunAt = null
          task.missedOnce = true
          changed = true
        }
        continue
      }
      if (task.nextRunAt === null) {
        task.nextRunAt = nextRunAt(task.schedule, now)
        if (task.nextRunAt !== null) changed = true
        continue
      }
      if (now <= task.nextRunAt) continue
      const missedAt = task.nextRunAt
      if (task.concurrency === 'skip' && this.executor.isRunning(task.id)) continue
      if (now - missedAt <= CATCH_UP_MAX_AGE_MS) {
        if (task.catchUp) {
          // 补跑一次，之后回到正常节奏
          task.nextRunAt = nextRunAt(task.schedule, now)
          task.lastRunAt = now
          changed = true
          this.hooks.fire(task, 'catch-up')
          this.hooks.onNotice(`「${task.name}」错过了 ${formatMissedTime(missedAt)} 的调度，已自动补跑`)
        } else {
          task.missedCount += 1
          task.nextRunAt = nextRunAt(task.schedule, now)
          changed = true
          this.hooks.onNotice(`「${task.name}」错过了 ${formatMissedTime(missedAt)} 的调度（未开启补跑）`)
        }
      } else {
        task.nextRunAt = nextRunAt(task.schedule, now)
        changed = true
      }
    }
    if (changed) {
      this.store.saveSoon()
      this.hooks.onTasksChanged()
    }
  }
}

function formatMissedTime(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}
