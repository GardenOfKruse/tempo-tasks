/** 计划模型：下一次执行时间计算、展示文案、校验（纯函数） */
import type { ConcurrencyPolicy, RunType, Schedule, Task, TaskInput } from './types'
import { cronNext, parseCron } from './cron'

export function parseHM(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return { h, m: min }
}

/** 'YYYY-MM-DDTHH:mm' → 本地时间毫秒；非法返回 null */
export function parseOnceAt(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number)
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dt.getTime()
}

/** 一次性计划的时刻是否已不可触发（与 nextRunAt 同口径：严格晚于 now 才会执行，含恰好等于 now）。
 *  编辑器在用户选过去时间时即时提示，避免保存后卡片莫名出现「已错过」。 */
export function isOnceAtPast(at: string, nowMs: number): boolean {
  const at0 = parseOnceAt(at)
  return at0 !== null && at0 <= nowMs
}

/** 严格晚于 afterMs 的下一次执行时间；null 表示不再执行 */
export function nextRunAt(schedule: Schedule, afterMs: number): number | null {
  switch (schedule.kind) {
    case 'once': {
      // 严格晚于 afterMs；已过期返回 null（由调度器标记为错过，不自动触发）
      const at = parseOnceAt(schedule.at)
      return at !== null && at > afterMs ? at : null
    }
    case 'interval': {
      const seconds = Math.max(5, Math.floor(schedule.seconds))
      return afterMs + seconds * 1000
    }
    case 'daily': {
      const hm = parseHM(schedule.time)
      if (!hm) return null
      const cand = new Date(afterMs)
      cand.setHours(hm.h, hm.m, 0, 0)
      if (cand.getTime() <= afterMs) cand.setDate(cand.getDate() + 1)
      return cand.getTime()
    }
    case 'weekly': {
      const hm = parseHM(schedule.time)
      if (!hm || schedule.days.length === 0) return null
      const days = new Set(schedule.days)
      for (let i = 0; i < 8; i++) {
        const cand = new Date(afterMs)
        cand.setDate(cand.getDate() + i)
        cand.setHours(hm.h, hm.m, 0, 0)
        if (cand.getTime() > afterMs && days.has(cand.getDay())) return cand.getTime()
      }
      return null
    }
    case 'cron': {
      const parsed = parseCron(schedule.expr)
      if (!parsed.ok) return null
      return cronNext(parsed.fields, afterMs)
    }
  }
}

/** 从 afterMs 起接下来 count 次执行时间（本地毫秒）；表达式无效或不再执行时提前截断 */
export function previewNextRuns(schedule: Schedule, afterMs: number, count = 3): number[] {
  const out: number[] = []
  let cursor = afterMs
  for (let i = 0; i < count; i++) {
    const next = nextRunAt(schedule, cursor)
    if (next === null) break
    out.push(next)
    cursor = next
  }
  return out
}

/** 复制任务：仅取配置，去掉 id/历史等运行态；名称去掉旧「副本」后缀再追加，避免连环叠加 */
export function duplicateTaskInput(t: Task): TaskInput {
  const base = t.name.replace(/ 副本$/, '')
  return {
    name: `${base.length > 57 ? base.slice(0, 57) : base} 副本`,
    runType: t.runType,
    command: t.command,
    cwd: t.cwd,
    timeoutSec: t.timeoutSec,
    schedule: structuredClone(t.schedule),
    catchUp: t.catchUp,
    notify: t.notify,
    enabled: t.enabled,
    concurrency: t.concurrency,
  }
}

export function validateSchedule(schedule: Schedule): string | null {
  switch (schedule.kind) {
    case 'once':
      if (parseOnceAt(schedule.at) === null) return '一次性时间无效'
      return null
    case 'interval':
      if (!Number.isFinite(schedule.seconds)) return '间隔需为整数秒'
      if (!Number.isInteger(schedule.seconds)) return '间隔需为整数秒'
      if (schedule.seconds < 5) return '间隔至少 5 秒'
      if (schedule.seconds > 365 * 24 * 3600) return '间隔过大'
      return null
    case 'daily':
      if (!parseHM(schedule.time)) return '时间无效'
      return null
    case 'weekly':
      if (!parseHM(schedule.time)) return '时间无效'
      if (schedule.days.length === 0) return '至少选择一个星期'
      if (schedule.days.some((d) => d < 0 || d > 6 || !Number.isInteger(d))) return '星期无效'
      return null
    case 'cron': {
      const r = parseCron(schedule.expr)
      return r.ok ? null : `Cron 表达式无效：${r.error}`
    }
    default:
      return '执行计划类型无效'
  }
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function formatSchedule(schedule: Schedule): string {
  switch (schedule.kind) {
    case 'once': {
      const at = parseOnceAt(schedule.at)
      if (at === null) return '一次性（时间无效）'
      const d = new Date(at)
      const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
      return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hhmm} 执行一次`
    }
    case 'interval': {
      const total = Math.max(5, Math.round(schedule.seconds))
      if (total % 86400 === 0) return `每 ${total / 86400} 天`
      if (total % 3600 === 0) return `每 ${total / 3600} 小时`
      if (total % 60 === 0) return `每 ${total / 60} 分钟`
      if (total < 60) return `每 ${total} 秒`
      return `每 ${Math.floor(total / 60)} 分 ${total % 60} 秒`
    }
    case 'daily':
      return `每天 ${schedule.time}`
    case 'weekly': {
      const days = [...new Set(schedule.days)].sort()
      if (days.length === 7) return `每天 ${schedule.time}`
      const label = days.map((d) => WEEKDAY_NAMES[d]).join('、')
      return `每${label} ${schedule.time}`
    }
    case 'cron':
      return `Cron · ${schedule.expr}`
  }
}

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export interface ValidatedTask {
  name: string
  runType: RunType
  command: string
  cwd: string
  timeoutSec: number
  schedule: Schedule
  catchUp: boolean
  notify: boolean
  enabled: boolean
  concurrency: ConcurrencyPolicy
}

const RUN_TYPES: RunType[] = ['cmd', 'powershell', 'python']

export function validateTaskInput(input: TaskInput): { ok: true; value: ValidatedTask } | { ok: false; error: string } {
  const name = String(input.name ?? '').trim()
  if (name === '') return { ok: false, error: '请填写任务名称' }
  if (name.length > 60) return { ok: false, error: '任务名称过长（最多 60 字）' }
  const runType = RUN_TYPES.includes(input.runType) ? input.runType : 'cmd'
  const command = String(input.command ?? '').trim()
  if (command === '') return { ok: false, error: '请填写要执行的命令' }
  if (command.length > 8000) return { ok: false, error: '命令过长' }
  const scheduleErr = validateSchedule(input.schedule)
  if (scheduleErr) return { ok: false, error: scheduleErr }
  let timeoutSec = Number(input.timeoutSec ?? 60)
  if (!Number.isFinite(timeoutSec) || timeoutSec < 0) timeoutSec = 60
  timeoutSec = Math.min(Math.floor(timeoutSec), 24 * 3600)
  const cwd = String(input.cwd ?? '').trim()
  return {
    ok: true,
    value: {
      name,
      runType,
      command,
      cwd,
      timeoutSec,
      schedule: input.schedule,
      catchUp: input.catchUp ?? true,
      notify: input.notify ?? false,
      enabled: input.enabled ?? true,
      concurrency: input.concurrency === 'parallel' ? 'parallel' : 'skip',
    },
  }
}
