/** 运行日志落盘：文件命名、内容组装、保留策略（纯函数，可单测）。写盘动作在 main.ts */
import type { RunRecord, RunStatus, TriggerKind } from './types'

/** 数据目录下的日志子目录：runs/<taskId>/<文件>.log */
export const RUNS_LOG_DIR = 'runs'

/** 每个任务保留的最新日志文件数（与 MAX_RUNS_PER_TASK 同量级，防无限增长） */
export const RUN_LOG_KEEP = 100

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 日志文件名：本地开始时间 + 运行 id。时间前缀保证目录内按文件名自然序即时间序 */
export function runLogFileName(startedAt: number, runId: string): string {
  const d = new Date(startedAt)
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const safeId = runId.replace(/[^A-Za-z0-9_-]/g, '')
  return `${date}-${time}-${safeId === '' ? 'run' : safeId}.log`
}

const TRIGGER_LABEL: Record<TriggerKind, string> = {
  manual: '手动',
  scheduled: '计划',
  'catch-up': '补跑',
}

const STATUS_LABEL: Record<RunStatus, string> = {
  running: '运行中',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  canceled: '已停止',
}

function fmtLocal(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 日志文件内容：头部元信息 + 完整 stdout/stderr（内存中已按 32KB 尾部封顶，这里如实落盘） */
export function buildRunLog(r: RunRecord, taskName: string): string {
  const sep = '='.repeat(28)
  return [
    'Tempo 运行日志',
    sep,
    `任务：${taskName}`,
    `任务 ID：${r.taskId}`,
    `运行 ID：${r.id}`,
    `触发：${TRIGGER_LABEL[r.trigger]}`,
    `开始：${fmtLocal(r.startedAt)}`,
    `结束：${r.endedAt === null ? '—' : fmtLocal(r.endedAt)}`,
    `状态：${STATUS_LABEL[r.status]}`,
    `退出码：${r.exitCode ?? '—'}`,
    `耗时：${r.durationMs === null ? '—' : `${r.durationMs} ms`}`,
    sep,
    '',
    '[stdout]',
    r.stdout === '' ? '（无输出）' : r.stdout,
    '',
    '[stderr]',
    r.stderr === '' ? '（无内容）' : r.stderr,
    '',
  ].join('\n')
}

/** 保留策略：目录内按文件名排序（即时间序），超出 RUN_LOG_KEEP 的最旧文件名清单。
 *  非 .log 文件不动；未超量返回空数组。 */
export function pruneRunLogFiles(files: string[]): string[] {
  const logs = files.filter((f) => f.endsWith('.log')).sort()
  if (logs.length <= RUN_LOG_KEEP) return []
  return logs.slice(0, logs.length - RUN_LOG_KEEP)
}
