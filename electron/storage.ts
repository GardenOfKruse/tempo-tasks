/** JSON 持久化：原子写 + 前一份备份，运行历史按任务封顶 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RunRecord, Settings, Task } from './types'
import { MAX_RUNS_PER_TASK } from './types'

export interface StoreData {
  schemaVersion: 1
  tasks: Task[]
  runs: Record<string, RunRecord[]>
  settings: Settings
}

const DEFAULT_DATA: StoreData = {
  schemaVersion: 1,
  tasks: [],
  runs: {},
  settings: { theme: 'system', sortMode: 'created', minimizeToTray: false },
}

function isValidTaskShape(t: unknown): t is Task {
  if (!t || typeof t !== 'object') return false
  const o = t as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id !== '' &&
    typeof o.name === 'string' &&
    typeof o.command === 'string' &&
    o.schedule !== null &&
    typeof o.schedule === 'object' &&
    typeof (o.schedule as Record<string, unknown>).kind === 'string' &&
    typeof o.createdAt === 'number'
  )
}

/** v0.1 旧数据：interval.minutes → interval.seconds */
function migrateTask(t: Task): Task {
  const s = t.schedule as { kind?: string; minutes?: number; seconds?: number }
  if (s && s.kind === 'interval' && typeof s.seconds !== 'number' && typeof s.minutes === 'number') {
    return { ...t, schedule: { kind: 'interval', seconds: Math.round(s.minutes * 60) } }
  }
  return t
}

function sanitizeRuns(runs: unknown, validTaskIds: string[]): Record<string, RunRecord[]> {
  if (!runs || typeof runs !== 'object') return {}
  const ids = new Set(validTaskIds)
  const out: Record<string, RunRecord[]> = {}
  for (const [id, list] of Object.entries(runs as Record<string, unknown>)) {
    if (!ids.has(id) || !Array.isArray(list)) continue
    out[id] = list.filter(
      (r): r is RunRecord =>
        !!r &&
        typeof r === 'object' &&
        typeof (r as Record<string, unknown>).id === 'string' &&
        typeof (r as Record<string, unknown>).startedAt === 'number',
    )
  }
  return out
}

export class Store {
  readonly dir: string
  private file: string
  private bakFile: string
  private data: StoreData
  private saveTimer: NodeJS.Timeout | null = null
  /** 保存失败回调（主进程接以通知用户；磁盘满/文件被锁等） */
  onSaveError: ((err: string) => void) | null = null
  private lastErrorNotifiedAt = 0

  constructor(dir: string) {
    this.dir = dir
    this.file = path.join(dir, 'tempo.json')
    this.bakFile = path.join(dir, 'tempo.json.bak')
    this.data = this.load()
  }

  private load(): StoreData {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
    } catch {
      /* 目录已存在或不可创建（后者在首次写入时报错） */
    }
    for (const f of [this.file, this.bakFile]) {
      try {
        if (!fs.existsSync(f)) continue
        const raw = JSON.parse(fs.readFileSync(f, 'utf-8'))
        if (raw && raw.schemaVersion === 1 && Array.isArray(raw.tasks)) {
          const tasks = (raw.tasks.filter(isValidTaskShape) as Task[]).map(migrateTask)
          return {
            schemaVersion: 1,
            // 手改/旧结构数据：丢弃形状不完整的任务，避免调度循环崩坏
            tasks,
            runs: sanitizeRuns(raw.runs, raw.tasks.filter(isValidTaskShape).map((t: Task) => t.id)),
            settings: { ...DEFAULT_DATA.settings, ...(raw.settings ?? {}) },
          }
        }
      } catch {
        /* 尝试下一份 */
      }
    }
    return structuredClone(DEFAULT_DATA)
  }

  get snapshot(): StoreData {
    return this.data
  }

  /** 同步保存（原子替换 + 备份）。数据量小，同步足够 */
  saveNow(): string | null {
    try {
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.bakFile)
      fs.renameSync(tmp, this.file)
      return null
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      console.error('[store] save failed:', err)
      // 同一分钟的重复失败不刷屏（网盘/杀软锁定可能持续报错）
      if (this.onSaveError && Date.now() - this.lastErrorNotifiedAt > 30_000) {
        this.lastErrorNotifiedAt = Date.now()
        this.onSaveError(`数据保存失败：${err.slice(0, 80)}`)
      }
      return err
    }
  }

  /** 防抖保存（输出/历史更新频繁时用） */
  saveSoon(delayMs = 800): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      const err = this.saveNow()
      if (err) console.error('[store] save failed:', err)
    }, delayMs)
    this.saveTimer.unref?.()
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.saveNow()
  }

  mutate(fn: (d: StoreData) => void): void {
    fn(this.data)
    this.saveSoon()
  }

  replaceSettings(settings: Settings): void {
    this.data.settings = settings
    this.saveSoon()
  }

  appendRun(record: RunRecord): void {
    const list = this.data.runs[record.taskId] ?? (this.data.runs[record.taskId] = [])
    list.push(record)
    if (list.length > MAX_RUNS_PER_TASK) list.splice(0, list.length - MAX_RUNS_PER_TASK)
    this.saveSoon()
  }

  runsOf(taskId: string): RunRecord[] {
    return this.data.runs[taskId] ?? []
  }

  clearRuns(taskId: string): void {
    if (this.data.runs[taskId] === undefined) return
    delete this.data.runs[taskId]
    this.saveSoon()
  }

  destroy(): void {
    this.flush()
  }
}
