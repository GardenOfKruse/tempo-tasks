import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { RunRecord, Settings, Task, TaskInput } from './types'

type Unsubscribe = () => void

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): Unsubscribe {
  const handler = (_e: IpcRendererEvent, ...args: T) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  listTasks: (): Promise<Task[]> => ipcRenderer.invoke('tasks:list'),
  createTask: (input: TaskInput) => ipcRenderer.invoke('task:create', input),
  updateTask: (id: string, input: TaskInput) => ipcRenderer.invoke('task:update', id, input),
  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('task:setEnabled', id, enabled),
  setPinned: (id: string, pinned: boolean) => ipcRenderer.invoke('task:setPinned', id, pinned),
  deleteTask: (id: string) => ipcRenderer.invoke('task:delete', id),
  runNow: (id: string) => ipcRenderer.invoke('task:runNow', id),
  cancelRun: (id: string) => ipcRenderer.invoke('task:cancel', id),
  listRuns: (taskId: string): Promise<RunRecord[]> => ipcRenderer.invoke('runs:list', taskId),
  liveRun: (taskId: string) => ipcRenderer.invoke('runs:live', taskId),
  clearRuns: (taskId: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('runs:clear', taskId),
  exportTasks: () => ipcRenderer.invoke('tasks:exportAll'),
  importTasks: () => ipcRenderer.invoke('tasks:importFile'),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  openRunsDir: (taskId?: string) => ipcRenderer.invoke('app:openRunsDir', taskId),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('app:chooseFolder'),
  probePython: () => ipcRenderer.invoke('app:probePython'),
  onTasksChanged: (cb: (tasks: Task[]) => void) => subscribe<[Task[]]>('tempo:tasks-changed', cb),
  onRunUpdate: (cb: (record: RunRecord) => void) => subscribe<[RunRecord]>('tempo:run-update', cb),
  onRunsChanged: (cb: (taskId: string) => void) => subscribe<[string]>('tempo:runs-changed', cb),
  onNotice: (cb: (text: string) => void) => subscribe<[string]>('tempo:notice', cb),
  onOpenTask: (cb: (taskId: string) => void) => subscribe<[string]>('tempo:open-task', cb),
}

export type TempoApi = typeof api

contextBridge.exposeInMainWorld('tempo', api)
