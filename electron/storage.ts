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
  settings: { theme: 'system', sortMode: 'created', minimizeToTray: false, writeRunLogs: false },
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

/** v0.5 旧数据：无 pinned 字段补默认 false */
function withPinned(t: Task): Task {
  return typeof t.pinned === 'boolean' ? t : { ...t, pinned: false }
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

/* ---------- 每日备份轮转（纯函数，可单测） ---------- */

export const BACKUP_DIR_NAME = 'backups'
/** 保留最近 7 天（含今天）的备份，更早的删除 */
export const BACKUP_KEEP_DAYS = 7

/** 本地日期 'YYYY-MM-DD' */
export function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 某一天的备份文件名：tempo-YYYY-MM-DD.json */
export function backupFileNameFor(dateStr: string): string {
  return `tempo-${dateStr}.json`
}

/** 从文件名解析备份日期，非本工具备份命名返回 null */
export function parseBackupDate(fileName: string): string | null {
  const m = /^tempo-(\d{4}-\d{2}-\d{2})\.json$/.exec(fileName)
  return m ? m[1] : null
}

/** 'YYYY-MM-DD' ± N 天（本地日历运算；取正午避开夏令时切换时刻） */
function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateStr
  return localDateStr(new Date(y, m - 1, d + days, 12))
}

/** 备份决策：给定今天与 backups/ 现有文件名列表 → 应删除的文件名清单。
 *  规则：只保留最近 BACKUP_KEEP_DAYS 天（含今天），日期早于「今天 − (N−1) 天」的删除；
 *  非本工具命名/非法日期不动。 */
export function staleBackups(today: string, files: string[]): string[] {
  const cutoff = shiftDateStr(today, -(BACKUP_KEEP_DAYS - 1))
  const out: string[] = []
  for (const f of files) {
    const date = parseBackupDate(f)
    if (date !== null && date < cutoff) out.push(f)
  }
  return out
}

export class Store {
  readonly dir: string
  private file: string
  private bakFile: string
  private backupDir: string
  private data: StoreData
  private saveTimer: NodeJS.Timeout | null = null
  /** 今日已做过每日备份的日期（'YYYY-MM-DD'），内存缓存避免每次保存都读目录 */
  private lastBackupDate: string | null = null
  /** 保存失败回调（主进程接以通知用户；磁盘满/文件被锁等） */
  onSaveError: ((err: string) => void) | null = null
  private lastErrorNotifiedAt = 0

  constructor(dir: string) {
    this.dir = dir
    this.file = path.join(dir, 'tempo.json')
    this.bakFile = path.join(dir, 'tempo.json.bak')
    this.backupDir = path.join(dir, BACKUP_DIR_NAME)
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
          const tasks = (raw.tasks.filter(isValidTaskShape) as Task[]).map(migrateTask).map(withPinned)
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

  /** 同步保存（原子替换 + 备份 + 每日快照轮转）。数据量小，同步足够 */
  saveNow(): string | null {
    try {
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.bakFile)
      fs.renameSync(tmp, this.file)
      this.backupDaily()
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

  /** 每日备份：当天首次成功保存后把 tempo.json 快照进 backups/，并清理 7 天前的旧备份 */
  private backupDaily(): void {
    const today = localDateStr(new Date())
    if (today === this.lastBackupDate) return
    try {
      fs.mkdirSync(this.backupDir, { recursive: true })
      const existing = fs.readdirSync(this.backupDir)
      const todayFile = backupFileNameFor(today)
      if (!existing.includes(todayFile)) fs.copyFileSync(this.file, path.join(this.backupDir, todayFile))
      this.lastBackupDate = today
      for (const name of staleBackups(today, existing)) {
        try {
          fs.unlinkSync(path.join(this.backupDir, name))
        } catch {
          /* 单个旧备份删除失败不阻塞（可能被占用，下次保存再试） */
        }
      }
    } catch (e) {
      console.error('[store] daily backup failed:', e instanceof Error ? e.message : String(e))
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
