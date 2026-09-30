import { app, BrowserWindow, ipcMain, dialog, nativeTheme, Notification, Menu, Tray } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { spawn } from 'node:child_process'
import { Store } from './storage'
import { Executor } from './executor'
import { Scheduler } from './scheduler'
import { validateTaskInput } from './schedule'
import { buildExport, parseImport } from './transfer'
import { resolveCloseBehavior, trayActions, TRAY_TOOLTIP } from './tray'
import type { RunRecord, Settings, Task, TaskInput, TriggerKind } from './types'
import { newId } from './types'

const T0 = Date.now()
app.setAppUserModelId('dev.tempo.tasks')
// 熄屏/锁屏时 Windows 判定窗口被完全遮挡，渲染器会完全停帧（倒计时冻结、
// 自动化超时、截图拿旧帧）。禁用三类后台降级，让界面在任何窗口状态下保持走帧。
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const dataDir = process.env.TEMPO_DATA_DIR || app.getPath('userData')
fs.mkdirSync(dataDir, { recursive: true })

const store = new Store(dataDir)
store.onSaveError = (err) => {
  mainWindow?.webContents.send('tempo:notice', err)
}
const executor = new Executor()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let gotFirstPaint = false
let gotFirstPaintAt: number | null = null

// ---- IPC 广播节流：输出流最多 150ms 一条，完成时立即 ----
const lastSentAt = new Map<string, number>()
function broadcastRun(record: RunRecord, force = false): void {
  if (record.endedAt === null && !force) {
    const last = lastSentAt.get(record.taskId) ?? 0
    if (Date.now() - last < 150) return
    lastSentAt.set(record.taskId, Date.now())
  } else {
    lastSentAt.delete(record.taskId)
  }
  mainWindow?.webContents.send('tempo:run-update', record)
  if (record.endedAt !== null) {
    // 任务可能已在运行期间被删除：不落盘孤儿记录、不打扰
    if (!store.snapshot.tasks.some((t) => t.id === record.taskId)) return
    store.appendRun(record)
    maybeNotify(record)
  }
}

function maybeNotify(record: RunRecord): void {
  const task = store.snapshot.tasks.find((t) => t.id === record.taskId)
  if (!task || !task.notify || !Notification.isSupported()) return
  if (process.env.TEMPO_DISABLE_NOTIFICATIONS === '1') return
  const ok = record.status === 'success'
  const dur = record.durationMs !== null ? formatDur(record.durationMs) : ''
  const n = new Notification({
    title: ok ? `✓ ${task.name}` : `✗ ${task.name}`,
    body: ok ? `执行成功${dur ? ` · ${dur}` : ''}` : describeFailure(record),
    silent: false,
  })
  n.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send('tempo:open-task', task.id)
  })
  n.show()
}

function formatDur(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`
}

function describeFailure(r: RunRecord): string {
  if (r.status === 'timeout') return '执行超时，已终止'
  if (r.status === 'canceled') return '已手动停止'
  const firstErr = r.stderr.trim().split('\n').find((l) => l.trim() !== '')
  if (firstErr) return firstErr.slice(0, 120)
  return `退出码 ${r.exitCode ?? '未知'}`
}

const scheduler = new Scheduler(store, executor, {
  fire: (task, trigger) => {
    executor.run(task, trigger).catch((e) => {
      console.error('[executor] unexpected:', e)
    })
  },
  onTasksChanged: () => {
    mainWindow?.webContents.send('tempo:tasks-changed', store.snapshot.tasks)
  },
  onNotice: (text) => {
    mainWindow?.webContents.send('tempo:notice', text)
  },
})
executor.setEventSink({ onRunUpdate: (r) => broadcastRun(r) })

// ---- 托盘：设置开启「最小化到托盘」时创建；点击恢复窗口 ----
function showMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function syncTray(settings: Settings): void {
  if (settings.minimizeToTray === true && tray === null) {
    tray = new Tray(path.join(__dirname, '..', 'build', 'icon.ico'))
    tray.setToolTip(TRAY_TOOLTIP)
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayActions().map((a) => ({
          label: a.label,
          click: () => {
            if (a.id === 'show') showMainWindow()
            else app.quit()
          },
        })),
      ),
    )
    tray.on('click', () => showMainWindow())
  } else if (settings.minimizeToTray !== true && tray !== null) {
    tray.destroy()
    tray = null
  }
}

// ---- IPC ----
function taskById(id: string): Task | undefined {
  return store.snapshot.tasks.find((t) => t.id === id)
}

function registerIpc(): void {
  ipcMain.handle('tasks:list', () => store.snapshot.tasks)

  ipcMain.handle('task:create', (_e, input: TaskInput) => {
    const v = validateTaskInput(input)
    if (!v.ok) return { ok: false, error: v.error }
    const now = Date.now()
    const task: Task = {
      id: newId(),
      ...v.value,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      nextRunAt: null,
      missedCount: 0,
      missedOnce: false,
    }
    store.mutate((d) => d.tasks.push(task))
    scheduler.recompute(task)
    mainWindow?.webContents.send('tempo:tasks-changed', store.snapshot.tasks)
    return { ok: true, id: task.id }
  })

  ipcMain.handle('task:update', (_e, id: string, input: TaskInput) => {
    const task = taskById(id)
    if (!task) return { ok: false, error: '任务不存在' }
    const v = validateTaskInput(input)
    if (!v.ok) return { ok: false, error: v.error }
    Object.assign(task, v.value, { updatedAt: Date.now() })
    task.missedOnce = false
    task.missedCount = 0
    scheduler.recompute(task)
    store.saveSoon()
    mainWindow?.webContents.send('tempo:tasks-changed', store.snapshot.tasks)
    return { ok: true, id }
  })

  ipcMain.handle('task:setEnabled', (_e, id: string, enabled: boolean) => {
    const task = taskById(id)
    if (!task) return { ok: false, error: '任务不存在' }
    task.enabled = enabled
    if (enabled) {
      task.missedOnce = false
      task.missedCount = 0
      scheduler.recompute(task)
    } else {
      task.nextRunAt = null
    }
    task.updatedAt = Date.now()
    store.saveSoon()
    mainWindow?.webContents.send('tempo:tasks-changed', store.snapshot.tasks)
    return { ok: true }
  })

  ipcMain.handle('task:setPinned', (_e, id: string, pinned: boolean) => {
    const task = taskById(id)
    if (!task) return { ok: false, error: '任务不存在' }
    task.pinned = pinned === true
    task.updatedAt = Date.now()
    store.saveSoon()
    mainWindow?.webContents.send('tempo:tasks-changed', store.snapshot.tasks)
    return { ok: true }
  })

  ipcMain.handle('task:delete', async (_e, id: string) => {
    const task = taskById(id)
    if (!task) return { ok: false, error: '任务不存在' }
    if (executor.isRunning(id)) await executor.cancel(id)
    store.mutate((d) => {
      d.tasks = d.tasks.filter((t) => t.id !== id)
      delete d.runs[id]
    })
    mainWindow?.webContents.send('tempo:tasks-changed', store.snapshot.tasks)
    return { ok: true }
  })

  ipcMain.handle('task:runNow', async (_e, id: string) => {
    const task = taskById(id)
    if (!task) return { ok: false, error: '任务不存在' }
    if (!task.enabled) return { ok: false, error: '任务已暂停，请先启用' }
    if (task.concurrency === 'skip' && executor.isRunning(id)) {
      return { ok: false, error: '任务正在运行中（重复策略为运行中跳过）' }
    }
    const trigger: TriggerKind = 'manual'
    try {
      const record = await executor.run(task, trigger)
      task.lastRunAt = record.startedAt
      store.saveSoon()
      mainWindow?.webContents.send('tempo:tasks-changed', store.snapshot.tasks)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('task:cancel', async (_e, id: string) => {
    const ok = await executor.cancel(id)
    return ok ? { ok: true } : { ok: false, error: '任务未在运行' }
  })

  ipcMain.handle('runs:list', (_e, taskId: string) => store.runsOf(taskId))
  ipcMain.handle('runs:live', (_e, taskId: string) => executor.livePreview(taskId))
  ipcMain.handle('runs:clear', (_e, taskId: string) => {
    if (!taskById(taskId)) return { ok: false, error: '任务不存在' }
    store.clearRuns(taskId)
    // 卡片的「上次结果」由渲染端缓存，广播清空事件让其重取
    mainWindow?.webContents.send('tempo:runs-changed', taskId)
    return { ok: true }
  })

  ipcMain.handle('tasks:exportAll', async () => {
    const tasks = store.snapshot.tasks
    if (tasks.length === 0) return { ok: false, error: '没有任务可导出' }
    if (!mainWindow) return { ok: false, error: '窗口未就绪' }
    const day = new Date().toISOString().slice(0, 10)
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '导出任务',
      defaultPath: `tempo-tasks-${day}.json`,
      filters: [{ name: 'Tempo 任务', extensions: ['json'] }],
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    try {
      fs.writeFileSync(r.filePath, JSON.stringify(buildExport(tasks), null, 2), 'utf-8')
      return { ok: true, count: tasks.length }
    } catch (e) {
      return { ok: false, error: `写入失败：${e instanceof Error ? e.message : String(e)}`.slice(0, 120) }
    }
  })

  ipcMain.handle('tasks:importFile', async () => {
    if (!mainWindow) return { ok: false, error: '窗口未就绪' }
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '导入任务',
      filters: [{ name: 'Tempo 任务', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true }
    let raw: string
    try {
      raw = fs.readFileSync(r.filePaths[0], 'utf-8')
    } catch (e) {
      return { ok: false, error: `读取失败：${e instanceof Error ? e.message : String(e)}`.slice(0, 120) }
    }
    const parsed = parseImport(raw)
    if (!parsed.ok) return parsed
    const now = Date.now()
    const created: Task[] = parsed.tasks.map((input) => ({
      id: newId(),
      ...input,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      nextRunAt: null,
      missedCount: 0,
      missedOnce: false,
    }))
    store.mutate((d) => d.tasks.push(...created))
    for (const task of created) scheduler.recompute(task)
    mainWindow?.webContents.send('tempo:tasks-changed', store.snapshot.tasks)
    return { ok: true, count: created.length }
  })

  ipcMain.handle('settings:get', () => store.snapshot.settings)
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = { ...store.snapshot.settings, ...patch }
    store.replaceSettings(next)
    applyTheme(next.theme)
    syncTray(next)
    return next
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir,
    electron: process.versions.electron,
    readyMs: gotFirstPaintAt,
  }))
  ipcMain.handle('app:openDataDir', () => {
    spawn('explorer.exe', [dataDir], { detached: true, stdio: 'ignore' }).unref?.()
  })
  ipcMain.handle('app:chooseFolder', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('app:probePython', async () => {
    // 异步探测：python.exe 启动可能被杀软拖慢，不能阻塞主进程调度与 IPC
    return new Promise((resolve) => {
      let settled = false
      const done = (r: { ok: boolean; version?: string; error?: string }) => {
        if (!settled) {
          settled = true
          resolve(r)
        }
      }
      try {
        const p = spawn('python', ['--version'], { windowsHide: true })
        let out = ''
        p.stdout?.on('data', (d) => (out += d))
        p.stderr?.on('data', (d) => (out += d))
        const timer = setTimeout(() => {
          try {
            p.kill()
          } catch {}
          done({ ok: false, error: 'python 探测超时' })
        }, 6000)
        timer.unref?.()
        p.on('error', () => {
          clearTimeout(timer)
          done({ ok: false, error: 'python 不在 PATH 中' })
        })
        p.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) done({ ok: true, version: out.trim() })
          else done({ ok: false, error: 'python 不在 PATH 中' })
        })
      } catch {
        done({ ok: false, error: '无法启动 python' })
      }
    })
  })
}

function applyTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  try {
    mainWindow?.setTitleBarOverlay({
      color: dark ? '#1a1a1c00' : '#f2f2f700',
      symbolColor: dark ? '#e8e8ea' : '#3c3c43',
      height: 44,
    })
  } catch {
    /* Linux/旧系统无 overlay */
  }
}

function createWindow(): void {
  const dark0 = store.snapshot.settings.theme === 'dark'
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 680,
    minHeight: 460,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    backgroundColor: dark0 ? '#1a1a1c' : '#f2f2f7',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: dark0 ? '#1a1a1c00' : '#f2f2f700',
      symbolColor: dark0 ? '#e8e8ea' : '#3c3c43',
      height: 44,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 任务工具的界面（倒计时/运行状态）在后台或锁定屏幕时也保持更新
      backgroundThrottling: false,
      // TEMPO_OFFSCREEN=1：离屏渲染，帧率与显示器/熄屏状态解耦（自动化测试用）
      ...(process.env.TEMPO_OFFSCREEN === '1' ? { offscreen: true } : {}),
    },
  })

  mainWindow.once('ready-to-show', () => {
    // 离屏测试模式完全不显示窗口：夜间/用户在场时跑自动化不抢焦点
    if (process.env.TEMPO_OFFSCREEN !== '1') mainWindow?.show()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (!gotFirstPaint) {
      gotFirstPaint = true
      gotFirstPaintAt = Date.now() - T0
      console.log(`[perf] window ready in ${gotFirstPaintAt}ms`)
    }
  })
  mainWindow.on('close', (e) => {
    // 开启「最小化到托盘」：拦下关窗只隐藏，调度与托盘常驻
    if (resolveCloseBehavior(store.snapshot.settings, { quitting }) === 'hide') {
      e.preventDefault()
      mainWindow?.hide()
      // 首次隐藏时用系统通知解释行为（之后不再打扰）
      if (!store.snapshot.settings.trayHintShown) {
        if (Notification.isSupported()) {
          const n = new Notification({ title: 'Tempo 仍在运行', body: '已最小化到系统托盘，定时任务继续调度。点击托盘图标可恢复窗口。' })
          n.on('click', () => showMainWindow())
          n.show()
        }
        store.mutate((d) => {
          d.settings.trayHintShown = true
        })
      }
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const indexFile = path.join(__dirname, '..', 'dist', 'index.html')
  // 截图模式: --shot=out.png [--shot-ui=editor|detail|menu] [--shot-delay=ms]
  const shotArg = process.argv.find((a) => a.startsWith('--shot='))
  const shotUi = process.argv.find((a) => a.startsWith('--shot-ui='))?.split('=')[1]
  const search = shotUi ? `?ui=${shotUi}` : ''
  mainWindow.loadFile(indexFile, { search })

  if (shotArg) {
    const outPath = shotArg.split('=').slice(1).join('=')
    const delay = Number(process.argv.find((a) => a.startsWith('--shot-delay='))?.split('=')[1] ?? 1500)
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await mainWindow!.webContents.capturePage()
          fs.writeFileSync(outPath, img.toPNG())
          console.log(`[shot] saved ${outPath}`)
        } catch (e) {
          console.error('[shot] failed:', e)
        }
        app.quit()
      }, delay)
    })
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 拿不到锁 = 已有实例在运行。注意：此时 ready 事件不会触发（whenReady 永远挂起），
  // 必须用同步的 showErrorBox；否则进程会在无提示的情况下静默退出，用户以为"双击没反应"
  dialog.showErrorBox(
    'Tempo 已在运行',
    'Tempo 正在运行中（可能在后台未完全退出）。\n\n请查看任务栏；若任务栏没有窗口，请在任务管理器中结束 Tempo.exe 进程后再启动。',
  )
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
  Menu.setApplicationMenu(null)

  app.whenReady().then(() => {
    if (process.env.TEMPO_FORCE_DARK === '1') store.snapshot.settings.theme = 'dark'
    applyTheme(store.snapshot.settings.theme)
    syncTray(store.snapshot.settings)
    registerIpc()
    createWindow()
    scheduler.start()
    scheduler.recomputeAll()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    executor.cancelAll()
    store.flush()
  })
}
