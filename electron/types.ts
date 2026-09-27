/** Tempo 共享类型与领域模型（主进程/渲染进程/测试通用，不依赖运行时） */

export type RunType = 'cmd' | 'powershell' | 'python'
export type TriggerKind = 'manual' | 'scheduled' | 'catch-up'
export type RunStatus = 'running' | 'success' | 'failed' | 'timeout' | 'canceled'
export type ConcurrencyPolicy = 'skip' | 'parallel'

/** 计划：一次 / 固定间隔 / 每天 / 每周 / Cron 表达式（5 字段，分 时 日 月 周） */
export type Schedule =
  | { kind: 'once'; at: string } // 本地时间 'YYYY-MM-DDTHH:mm'
  | { kind: 'interval'; seconds: number } // 每 N 秒（5 秒 ~ 365 天）
  | { kind: 'daily'; time: string } // 'HH:MM'
  | { kind: 'weekly'; days: number[]; time: string } // days: 0=周日..6=周六
  | { kind: 'cron'; expr: string }

export interface Task {
  id: string
  name: string
  runType: RunType
  command: string
  cwd: string // '' = 用户主目录
  timeoutSec: number // 0 = 不限制
  schedule: Schedule
  catchUp: boolean // 应用未运行/睡眠期间错过调度后，启动或唤醒时补跑一次
  notify: boolean // 完成时系统通知
  enabled: boolean
  concurrency: ConcurrencyPolicy
  createdAt: number
  updatedAt: number
  lastRunAt: number | null // 最近一次实际触发（含手动）
  nextRunAt: number | null // 由调度器计算并持久化
  missedCount: number // 错过且未补跑的调度次数（catchUp=false 的周期任务）
  missedOnce: boolean // 一次性任务已过期未执行
}

export interface TaskInput {
  name: string
  runType: RunType
  command: string
  cwd?: string
  timeoutSec?: number
  schedule: Schedule
  catchUp?: boolean
  notify?: boolean
  enabled?: boolean
  concurrency?: ConcurrencyPolicy
}

export interface RunRecord {
  id: string
  taskId: string
  trigger: TriggerKind
  startedAt: number
  endedAt: number | null
  status: RunStatus
  exitCode: number | null
  durationMs: number | null
  stdout: string // 尾部截断
  stderr: string
  truncated: boolean
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  sortMode: 'created' | 'name' | 'next'
}

export const MAX_RUNS_PER_TASK = 50
export const MAX_OUTPUT_CHARS = 32_000
export const DEFAULT_TIMEOUT_SEC = 60
export const CATCH_UP_MAX_AGE_MS = 7 * 24 * 3600 * 1000

export function newId(): string {
  const ts = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${ts}${rnd}`
}
