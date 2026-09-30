/** 运行历史与卡片时钟的共享纯函数（主进程逻辑 / 渲染端展示 / 单测通用） */
import type { RunRecord, RunStatus } from './types'

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
