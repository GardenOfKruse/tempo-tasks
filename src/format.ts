/** 时间与状态展示格式化 */
import type { RunStatus, RunType, TriggerKind } from './api'
import { dayDiff, fmtNextTime } from '../electron/timefmt'

export { fmtNextTime }

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 倒计时/下一次执行的紧凑展示 */
export function fmtCountdown(nextMs: number | null, now: number): string {
  if (nextMs === null) return '—'
  const diff = nextMs - now
  if (diff <= 0) return '即将执行'
  // 秒级倒数只保留最后一分钟；更远只到分钟（配合卡片时钟分桶，避免逐秒重渲染）
  if (diff < 60_000) return `${Math.ceil(diff / 1000)} 秒后`
  if (diff < 3_600_000) return `${Math.ceil(diff / 60_000)} 分钟后`
  return fmtNextTime(nextMs, now)
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

/** 相对时间：刚刚 / N 分钟前 / 今天 HH:MM / 昨天 HH:MM / M/D HH:MM */
export function fmtRel(ms: number | null, now: number): string {
  if (ms === null) return '从未运行'
  const diff = now - ms
  if (diff < 15_000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ms)
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (isSameDay(ms, now)) return `今天 ${hhmm}`
  if (isSameDay(ms, now - 86_400_000)) return `昨天 ${hhmm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`
}

export function fmtDur(ms: number | null): string {
  if (ms === null) return '—'
  const d = Math.max(0, ms) // 运行刚启动时 now 可能早于 startedAt（秒级 tick 采样差）
  if (d < 1000) return `${Math.round(d)} ms`
  if (d < 60_000) return `${(d / 1000).toFixed(1)} s`
  const totalSec = Math.floor(d / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`
}

export function fmtAt(ms: number | null): string {
  if (ms === null) return '—'
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 紧凑时间点：今天/明天 HH:MM，否则 M/D HH:MM（调度预览用） */
export function fmtWhen(ms: number, now: number): string {
  const d = new Date(ms)
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const days = dayDiff(ms, now)
  if (days === 0) return `今天 ${hhmm}`
  if (days === 1) return `明天 ${hhmm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: '运行中',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  canceled: '已停止',
}

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  manual: '手动',
  scheduled: '计划',
  'catch-up': '补跑',
}

export const RUN_TYPE_LABEL: Record<RunType, string> = {
  cmd: 'CMD',
  powershell: 'PS',
  python: 'PY',
}

export const RUN_TYPE_FULL: Record<RunType, string> = {
  cmd: '命令行（CMD）',
  powershell: 'PowerShell',
  python: 'Python',
}
