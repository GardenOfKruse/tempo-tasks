import type { RunRecord, RunStatus, RunType, Settings, Task, TaskInput, TriggerKind } from '../electron/types'

export type { RunRecord, RunStatus, RunType, Settings, Task, TaskInput, TriggerKind }

interface TempoApi {
  listTasks(): Promise<Task[]>
  createTask(input: TaskInput): Promise<{ ok: boolean; id?: string; error?: string }>
  updateTask(id: string, input: TaskInput): Promise<{ ok: boolean; error?: string }>
  setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }>
  setPinned(id: string, pinned: boolean): Promise<{ ok: boolean; error?: string }>
  deleteTask(id: string): Promise<{ ok: boolean; error?: string }>
  runNow(id: string): Promise<{ ok: boolean; error?: string }>
  cancelRun(id: string): Promise<{ ok: boolean; error?: string }>
  listRuns(taskId: string): Promise<RunRecord[]>
  clearRuns(taskId: string): Promise<{ ok: boolean; error?: string }>
  liveRun(taskId: string): Promise<{ status: RunStatus; stdout: string; stderr: string; startedAt: number } | null>
  exportTasks(): Promise<{ ok: boolean; canceled?: boolean; count?: number; error?: string }>
  importTasks(): Promise<{ ok: boolean; canceled?: boolean; count?: number; error?: string }>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  appInfo(): Promise<{ version: string; dataDir: string; electron: string; readyMs: number | null }>
  openDataDir(): Promise<void>
  openRunsDir(taskId?: string): Promise<void>
  chooseFolder(): Promise<string | null>
  probePython(): Promise<{ ok: boolean; version?: string; error?: string }>
  onTasksChanged(cb: (tasks: Task[]) => void): () => void
  onRunUpdate(cb: (record: RunRecord) => void): () => void
  onRunsChanged(cb: (taskId: string) => void): () => void
  onNotice(cb: (text: string) => void): () => void
  onOpenTask(cb: (taskId: string) => void): () => void
}

declare global {
  interface Window {
    tempo: TempoApi
  }
}

export const api: TempoApi = window.tempo
