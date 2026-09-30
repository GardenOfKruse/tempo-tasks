/** 任务导入/导出：纯数据 JSON（仅配置，不含 id/历史/运行态），解析与校验为纯函数 */
import type { Task, TaskInput } from './types'
import { validateTaskInput, type ValidatedTask } from './schedule'

export const EXPORT_KIND = 'tempo-tasks-export'
export const MAX_IMPORT_TASKS = 500

export interface ExportFile {
  app: 'tempo'
  kind: typeof EXPORT_KIND
  version: 1
  exportedAt: string // ISO 8601
  tasks: ValidatedTask[]
}

export function buildExport(tasks: Task[]): ExportFile {
  return {
    app: 'tempo',
    kind: EXPORT_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: tasks.map((t) => ({
      name: t.name,
      runType: t.runType,
      command: t.command,
      cwd: t.cwd,
      timeoutSec: t.timeoutSec,
      schedule: structuredClone(t.schedule),
      catchUp: t.catchUp,
      notify: t.notify,
      enabled: t.enabled,
      concurrency: t.concurrency,
    })),
  }
}

export type ImportResult = { ok: true; tasks: ValidatedTask[] } | { ok: false; error: string }

/** 解析导入文件文本：结构校验 + 逐任务走 validateTaskInput（与新建任务同一套规则） */
export function parseImport(raw: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, error: '文件不是有效的 JSON' }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: '文件格式不正确' }
  const o = data as Record<string, unknown>
  if (o.kind !== EXPORT_KIND) return { ok: false, error: '不是 Tempo 任务导出文件' }
  if (!Array.isArray(o.tasks)) return { ok: false, error: '文件中缺少任务列表' }
  if (o.tasks.length === 0) return { ok: false, error: '文件中没有任务' }
  if (o.tasks.length > MAX_IMPORT_TASKS) return { ok: false, error: `任务数过多（一次最多导入 ${MAX_IMPORT_TASKS} 个）` }
  const out: ValidatedTask[] = []
  for (let i = 0; i < o.tasks.length; i++) {
    const raw = o.tasks[i]
    // 外部文件不可信：先做形状守卫，缺执行计划会让 validateSchedule 直接抛错
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: `第 ${i + 1} 个任务无效：不是任务对象` }
    }
    const s = (raw as Record<string, unknown>).schedule
    if (!s || typeof s !== 'object' || typeof (s as Record<string, unknown>).kind !== 'string') {
      return { ok: false, error: `第 ${i + 1} 个任务无效：缺少执行计划` }
    }
    let v: ReturnType<typeof validateTaskInput>
    try {
      // 外部数据字段可能为 undefined（如 {"kind":"daily"} 缺 time），校验内部会抛 TypeError——转为逐条友好报错
      v = validateTaskInput(raw as TaskInput)
    } catch {
      return { ok: false, error: `第 ${i + 1} 个任务无效：执行计划字段不完整` }
    }
    if (!v.ok) return { ok: false, error: `第 ${i + 1} 个任务无效：${v.error}` }
    out.push(v.value)
  }
  return { ok: true, tasks: out }
}
