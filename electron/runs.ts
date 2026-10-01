/** 运行历史与卡片时钟的共享纯函数（主进程逻辑 / 渲染端展示 / 单测通用） */
import type { MergeMark, RunRecord, RunStatus } from './types'

export type RunFilter = 'all' | 'ok' | 'fail'

/** 历史筛选：成功 = success；失败 = failed + timeout；已停止只在「全部」可见 */
export function matchRunFilter(r: Pick<RunRecord, 'status'>, f: RunFilter): boolean {
  if (f === 'ok') return r.status === 'success'
  if (f === 'fail') return r.status === 'failed' || r.status === 'timeout'
  return true
}

export function filterRuns(runs: RunRecord[], f: RunFilter): RunRecord[] {
  if (f === 'all') return runs
  return runs.filter((r) => matchRunFilter(r, f))
}

/** 状态是否计入「失败」口径（徽标 / 筛选一致性） */
export function isFailStatus(s: RunStatus): boolean {
  return s === 'failed' || s === 'timeout'
}

/** 近期统计摘要（详情页顶部「近 7 天」行） */
export interface RunsSummary {
  total: number // 窗口内触发次数（含仍在运行中的）
  success: number // 窗口内成功次数
  /** 成功率 0-100，分母为已出结果的运行（运行中不计）；无已完成运行时 null */
  successRate: number | null
  /** 平均耗时 ms，仅统计已结束且有时长的运行；无数据时 null */
  avgDurationMs: number | null
}

/** 统计 startedAt >= sinceMs 的运行；与详情页历史列表同源同口径 */
export function summarizeRuns(runs: RunRecord[], sinceMs: number): RunsSummary {
  let total = 0
  let success = 0
  let decided = 0
  let durSum = 0
  let durCount = 0
  for (const r of runs) {
    if (r.startedAt < sinceMs) continue
    total++
    if (r.status === 'running') continue
    decided++
    if (r.status === 'success') success++
    if (r.durationMs !== null) {
      durSum += r.durationMs
      durCount++
    }
  }
  return {
    total,
    success,
    successRate: decided > 0 ? Math.round((success / decided) * 100) : null,
    avgDurationMs: durCount > 0 ? Math.round(durSum / durCount) : null,
  }
}

/**
 * 卡片时钟分桶：把 now 量化到当前文案所需的精度。
 * 配合 React.memo，远期倒计时的卡片在同一桶内 props 不变、跳过逐秒重渲染。
 * 运行中 / 刚结束 / 倒计时进入最后一分钟 → 原样返回（秒级）；
 * 一小时内 → 15 秒桶；更远或无排程 → 1 分钟桶。
 */
export function displayClock(opts: { nextRunAt: number | null; lastRunAt: number | null; running: boolean; now: number }): number {
  const { nextRunAt, lastRunAt, running, now } = opts
  if (running) return now
  if (lastRunAt !== null && now - lastRunAt < 120_000) return now // 刚结束：相对时间秒级保鲜
  if (nextRunAt !== null) {
    const diff = nextRunAt - now
    if (diff <= 60_000) return now
    if (diff <= 3_600_000) return Math.floor(now / 15_000) * 15_000
  }
  return Math.floor(now / 60_000) * 60_000
}

/* ---------- 合并输出视图：交错游标快照与重建（v0.9） ---------- */

/** marks 封顶：超出丢弃最早的一半（每项只是两个数字，重建时早期交错粗化为一段） */
export const MAX_MARKS = 400

/** 记录一次输出事件后的游标快照；返回截断后的新数组（原地复用入参减少分配） */
export function pushMark(marks: MergeMark[], stdout: string, stderr: string): MergeMark[] {
  marks.push([stdout.length, stderr.length])
  if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS / 2)
  return marks
}

/** 流首被丢弃（尾部截断）后整体平移游标：shift = 丢弃的字符数 - 新增的头部标记长度，可为负 */
export function shiftMarks(marks: MergeMark[], shiftOut: number, shiftErr: number): void {
  for (let i = 0; i < marks.length; i++) {
    marks[i] = [Math.max(0, marks[i][0] - shiftOut), Math.max(0, marks[i][1] - shiftErr)]
  }
}

export interface MergedSeg {
  /** 0 = stdout，1 = stderr（渲染端 stderr 标红） */
  s: 0 | 1
  t: string
}

/**
 * 从游标快照重建真实交错序列（切片自最终 stdout/stderr，与两个 tab 视图严格同源）。
 * 无 marks 的旧记录回退为「全部输出后跟全部错误」；游标回退（流首截断）只推进游标不重复发射——
 * 截断标记已内嵌在字符串头部，会随后续切片自然出现。
 */
export function rebuildMerged(marks: MergeMark[] | undefined, stdout: string, stderr: string): MergedSeg[] {
  if (!marks || marks.length === 0) {
    const segs: MergedSeg[] = []
    if (stdout !== '') segs.push({ s: 0, t: stdout })
    if (stderr !== '') segs.push({ s: 1, t: stderr })
    return segs
  }
  const segs: MergedSeg[] = []
  const push = (s: 0 | 1, text: string) => {
    if (text !== '') segs.push({ s, t: text })
  }
  let po = 0
  let pe = 0
  for (const [o, e] of marks) {
    if (o > po) {
      push(0, stdout.slice(po, o))
      po = o
    } else if (o < po) {
      po = o // 流首被截断：游标退回，新头部随下一拍自然带出
    }
    if (e > pe) {
      push(1, stderr.slice(pe, e))
      pe = e
    } else if (e < pe) {
      pe = e
    }
  }
  return segs
}
