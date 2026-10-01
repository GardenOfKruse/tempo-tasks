/** 新建任务草稿：仅「新建任务」表单自动保存到 localStorage。
 *  编辑已有任务不做草稿——恢复草稿与磁盘上的任务态会互相打架，违背状态可信。 */

export type DraftRunType = 'cmd' | 'powershell' | 'python'
export type DraftScheduleKind = 'once' | 'interval' | 'daily' | 'weekly' | 'cron'

/** 与 TaskEditor 的 FormState 同形（此处独立声明，避免渲染层模块反向依赖组件文件） */
export interface DraftForm {
  name: string
  runType: DraftRunType
  command: string
  cwd: string
  timeoutSec: string
  kind: DraftScheduleKind
  onceAt: string
  intervalValue: string
  intervalUnit: 's' | 'm' | 'h' | 'd'
  dailyTime: string
  weeklyDays: number[]
  weeklyTime: string
  cronExpr: string
  catchUp: boolean
  notify: boolean
  concurrency: 'skip' | 'parallel'
}

const KEY = 'tempo.draft.newTask'
const MAX_AGE_MS = 14 * 86_400_000 // 两周前的陈旧草稿不再恢复

export function loadDraft(): Partial<DraftForm> | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    if (typeof obj.savedAt === 'number' && Date.now() - obj.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY)
      return null
    }
    return obj as Partial<DraftForm>
  } catch {
    return null
  }
}

export function saveDraft(f: DraftForm): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...f, savedAt: Date.now() }))
  } catch {
    /* 存储不可用（隐私模式/配额）时静默放弃，草稿是锦上添花 */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 同上 */
  }
}

const STR_FIELDS = ['name', 'command', 'cwd', 'timeoutSec', 'onceAt', 'intervalValue', 'dailyTime', 'weeklyTime', 'cronExpr'] as const
const RUN_TYPES: DraftRunType[] = ['cmd', 'powershell', 'python']
const KINDS: DraftScheduleKind[] = ['once', 'interval', 'daily', 'weekly', 'cron']
const UNITS: DraftForm['intervalUnit'][] = ['s', 'm', 'h', 'd']

/** 草稿覆盖默认表单：逐字段校验形状（手改/旧版本 localStorage 不会把表单带坏） */
export function applyDraft(base: DraftForm, d: Partial<DraftForm> | null): DraftForm {
  if (!d) return base
  const out: DraftForm = { ...base }
  for (const k of STR_FIELDS) {
    const v = d[k]
    if (typeof v === 'string') out[k] = v
  }
  if (d.runType !== undefined && RUN_TYPES.includes(d.runType)) out.runType = d.runType
  if (d.kind !== undefined && KINDS.includes(d.kind)) out.kind = d.kind
  if (d.intervalUnit !== undefined && UNITS.includes(d.intervalUnit)) out.intervalUnit = d.intervalUnit
  if (d.concurrency !== undefined && (d.concurrency === 'skip' || d.concurrency === 'parallel')) out.concurrency = d.concurrency
  if (typeof d.catchUp === 'boolean') out.catchUp = d.catchUp
  if (typeof d.notify === 'boolean') out.notify = d.notify
  if (Array.isArray(d.weeklyDays)) {
    out.weeklyDays = d.weeklyDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).slice(0, 7)
  }
  return out
}
