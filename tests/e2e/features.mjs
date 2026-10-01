/**
 * 功能扩容 E2E：托盘关窗行为 / 数据每日备份 / 导入导出入口 / 创建副本 / 置顶 / 搜索高亮。
 * 运行: node tests/e2e/features.mjs   （launchTempo 已内置 TEMPO_OFFSCREEN=1，全程隐藏离屏）
 */
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { launchTempo, closeApp } from './probe.mjs'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${detail}`}`)
}

/** 与 electron/storage.ts localDateStr 相同的本地日期（备份文件名 tempo-YYYY-MM-DD.json） */
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 预置 settings 的空数据目录（trayHintShown=true 避免测试期间弹系统通知打扰） */
function seedSettings(dataDir, settings) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(
    path.join(dataDir, 'tempo.json'),
    JSON.stringify({ schemaVersion: 1, tasks: [], runs: {}, settings: { theme: 'system', sortMode: 'created', trayHintShown: true, ...settings } }),
  )
}

/** 进程存活查询走 OS（tasklist 按 PID）：app 退出后 playwright 的 app.process() 会抛异常，不可靠 */
function pidAlive(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf-8' })
    return out.includes(String(pid))
  } catch {
    return false
  }
}

async function waitPidGone(pid, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return !pidAlive(pid)
}

/** 兜底清理：只杀自己启动的 PID 子树，防止偶发慢退出留下僵尸实例（会占用单实例锁弹错误框） */
function killTree(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
  } catch {}
}

function childrenOf(pid) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | ForEach-Object { '$($_.Name)=$($_.ProcessId)' }) -join ' | '"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return out || '(无子进程)'
  } catch {
    return '(查询失败)'
  }
}

/** 模拟用户点窗口 X：主进程对每个窗口调 close()，走真实 close 事件分支 */
const closeAllWindows = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()))

/** 渲染端 IPC 建任务（表单创建已由 run.mjs 覆盖，这里走同一 task:create 通道更快） */
async function createTaskViaIpc(win, name, command, schedule) {
  const r = await win.evaluate(async ({ name, command, schedule }) => {
    const r = await window.tempo.createTask({ name, runType: 'cmd', command, schedule, timeoutSec: 30 })
    return r
  }, { name, command, schedule })
  if (!r.ok) throw new Error(`createTask 失败: ${r.error}`)
}

const dirs = []

// =====================================================================
// 实例 1：minimizeToTray=false（默认）→ 关窗即退出 + 退出前完成每日备份落盘
// =====================================================================
{
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-feat-trayoff-'))
  dirs.push(dataDir)
  seedSettings(dataDir, { minimizeToTray: false })
  let app = null
  let pid = null
  try {
    ;({ app } = await launchTempo({ dataDir }))
    pid = app.process().pid // 退出后 app.process() 会失效，先取 PID
    await closeAllWindows(app)
    const exited = await waitPidGone(pid, 20_000)
    check('托盘开关=关：关窗后进程退出', exited, exited ? '' : `进程 20s 内未退出 children=[${childrenOf(pid)}]`)
    // before-quit flush → saveNow → backupDaily：退出路径完整落盘的证据（种子只写了 tempo.json，backups 只能由保存链路生成）
    check('托盘开关=关：退出前完成每日备份落盘', existsSync(path.join(dataDir, 'backups', `tempo-${localDateStr()}.json`)), 'backups/ 无今日备份')
  } catch (e) {
    check('托盘开关=关：关窗后进程退出', false, e.message.split('\n')[0])
  } finally {
    await closeApp(app)
    if (pid !== null && pidAlive(pid)) killTree(pid)
  }
}

// =====================================================================
// 实例 2：设置面板切「最小到托盘」→ 关窗进程存活 + 窗口隐藏 + 设置持久化
// =====================================================================
{
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-feat-trayon-'))
  dirs.push(dataDir)
  seedSettings(dataDir, { minimizeToTray: false })
  let app = null
  let pid = null
  try {
    ;({ app } = await launchTempo({ dataDir }))
    pid = app.process().pid
    const win = await app.firstWindow()
    // 通过设置面板打开开关（覆盖 settings:set → syncTray 主进程链路）
    await win.click('[data-testid="btn-settings"]')
    await win.waitForSelector('[data-testid="settings-sheet"]')
    const traySeg = win.locator('[data-testid="menu-tray"] button')
    await traySeg.nth(1).click() // 「最小到托盘」
    await win.waitForTimeout(400)
    const on = (await traySeg.nth(1).getAttribute('class'))?.includes('on')
    check('设置面板切「最小到托盘」生效', on, `class=${await traySeg.nth(1).getAttribute('class')}`)
    await win.keyboard.press('Escape')
    await win.waitForSelector('[data-testid="settings-sheet"]', { state: 'detached' })

    // 关窗（=点 X）：进程应存活（托盘常驻），窗口应隐藏
    await closeAllWindows(app)
    await new Promise((r) => setTimeout(r, 4000))
    const alive = pidAlive(pid)
    check('托盘开关=开：关窗后进程仍存活', alive, '进程已退出')
    // 窗口状态从主进程查（离屏模式窗口本就不显示，关键是 isVisible=false 即被 hide 而非 quit）
    const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), destroyed: w.isDestroyed() })))
    check('托盘开关=开：关窗后窗口隐藏未销毁', wins.length === 1 && wins[0].destroyed === false && wins[0].visible === false, JSON.stringify(wins))
    // 托盘实例为 main.js 闭包变量，evaluate 只能拿到 electron 模块无法直查；
    // 此处按进程存活 + 窗口隐藏做间接验证（见任务约定）。

    // 优雅退出（托盘菜单「退出 Tempo」的同一 app.quit 路径）后设置持久化
    await app.evaluate(({ app }) => app.quit())
    const quitOk = await waitPidGone(pid, 20_000)
    check('托盘开关=开：app.quit 退出', quitOk, quitOk ? '' : `进程 20s 内未退出 children=[${childrenOf(pid)}]`)
    const raw = JSON.parse(readFileSync(path.join(dataDir, 'tempo.json'), 'utf-8'))
    check('托盘设置持久化到磁盘', raw.settings.minimizeToTray === true, JSON.stringify(raw.settings))
  } catch (e) {
    check('托盘开关=开：关窗进程存活', false, e.message.split('\n')[0])
  } finally {
    await closeApp(app)
    if (pid !== null && pidAlive(pid)) killTree(pid)
  }
}

// =====================================================================
// 实例 3：每日备份 / 创建副本（右键）/ 置顶（卡片菜单）/ 搜索高亮 / 导入导出入口
// =====================================================================
{
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-feat-core-'))
  dirs.push(dataDir)
  let app = null
  let win = null
  try {
    ;({ app, win } = await launchTempo({ dataDir }))

    // ---------- 数据每日备份：首次保存后 backups/tempo-YYYY-MM-DD.json ----------
    await createTaskViaIpc(win, '每日问候', 'echo hello', { kind: 'daily', time: '08:30' })
    await win.waitForSelector('[data-task-name="每日问候"]')
    await createTaskViaIpc(win, '清理缓存', 'echo clean', { kind: 'weekly', days: [1], time: '09:00' })
    const waitSaved = win.waitForTimeout(1600) // saveSoon 防抖 800ms + 余量
    await waitSaved
    const backupFile = path.join(dataDir, 'backups', `tempo-${localDateStr()}.json`)
    check('每日备份文件生成', existsSync(backupFile), backupFile)
    if (existsSync(backupFile)) {
      try {
        const bak = JSON.parse(readFileSync(backupFile, 'utf-8'))
        const names = bak.tasks.map((t) => t.name)
        check('每日备份内容为任务快照', Array.isArray(bak.tasks) && names.includes('每日问候') && names.includes('清理缓存'), `names=${names}`)
      } catch (e) {
        check('每日备份内容为任务快照', false, e.message)
      }
    }

    // ---------- 创建副本：右键菜单 ----------
    const srcCard = win.locator('[data-task-name="每日问候"]')
    await srcCard.click({ button: 'right' })
    await win.waitForSelector('.pop-menu')
    await win.click('.pop-menu button:text-is("创建副本")')
    await win.waitForSelector('[data-task-name="每日问候 副本"]', { timeout: 6000 })
    check('右键「创建副本」生成「xx 副本」卡片', true)
    check('副本后卡片总数为 3', (await win.locator('[data-testid="task-card"]').count()) === 3)

    // ---------- 任务置顶：卡片 kebab 菜单；默认「新建优先」排序下旧任务应跳到首位 ----------
    const greetCard = win.locator('[data-task-name="每日问候"]')
    await greetCard.hover()
    await greetCard.locator('.kebab').click()
    await win.waitForSelector('.pop-menu')
    await win.click('.pop-menu button:text-is("置顶")')
    await win.waitForTimeout(600)
    const firstName = await win.locator('[data-testid="task-card"]').first().getAttribute('data-task-name')
    check('置顶后置顶任务排在首位', firstName === '每日问候', `first=${firstName}`)
    check('置顶卡片显示置顶角标', (await greetCard.locator('.pin-badge').count()) === 1)

    // ---------- 搜索高亮：卡片名命中出现 <mark> ----------
    await win.fill('.search-box input', '问候')
    await win.waitForTimeout(400)
    const matched = await win.locator('[data-testid="task-card"]').count()
    check('搜索过滤保留命中任务', matched === 2, `matched=${matched}`)
    const nameMarks = await win.locator('[data-testid="task-card"] .card-name mark').allTextContents()
    check('命中任务名高亮为 <mark>', nameMarks.length === 2 && nameMarks.every((t) => t === '问候'), JSON.stringify(nameMarks))
    await win.fill('.search-box input', 'echo')
    await win.waitForTimeout(400)
    const cmdMarks = await win.locator('[data-testid="task-card"] .cmd mark').allTextContents()
    check('命中命令文本高亮为 <mark>', cmdMarks.length === 3 && cmdMarks.every((t) => t === 'echo'), JSON.stringify(cmdMarks))
    await win.fill('.search-box input', '')

    // ---------- 导入/导出：按钮存在可点击；用主进程 stub 模拟「取消对话框」，断言无副作用 ----------
    const tasksBefore = await win.evaluate(() => window.tempo.listTasks())
    const filesBefore = readdirSync(dataDir).sort().join(',')
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    })
    await win.click('[data-testid="btn-settings"]')
    await win.waitForSelector('[data-testid="settings-sheet"]')
    const btnExport = win.locator('[data-testid="menu-export"]')
    const btnImport = win.locator('[data-testid="menu-import"]')
    check('设置面板导出按钮存在可用', (await btnExport.count()) === 1 && (await btnExport.isEnabled()), '')
    check('设置面板导入按钮存在可用', (await btnImport.count()) === 1 && (await btnImport.isEnabled()), '')
    await btnExport.click()
    await win.waitForTimeout(800)
    await btnImport.click()
    await win.waitForTimeout(800)
    const toasts = await win.locator('.toast').allTextContents()
    check('取消对话框无成功 toast', !toasts.some((t) => t.includes('已导出') || t.includes('已导入')), JSON.stringify(toasts))
    const tasksAfter = await win.evaluate(() => window.tempo.listTasks())
    check('取消对话框任务数不变', tasksAfter.length === tasksBefore.length && tasksAfter.length === 3, `${tasksBefore.length}→${tasksAfter.length}`)
    const filesAfter = readdirSync(dataDir).sort().join(',')
    check('取消对话框数据目录无新增文件', filesAfter === filesBefore, `${filesBefore} → ${filesAfter}`)
    await win.keyboard.press('Escape')

    // ---------- 磁盘一致性：副本存在 + 置顶标志落盘 ----------
    await win.waitForTimeout(1200)
    const raw = JSON.parse(readFileSync(path.join(dataDir, 'tempo.json'), 'utf-8'))
    check('磁盘含副本任务', raw.tasks.some((t) => t.name === '每日问候 副本'), `tasks=${raw.tasks.map((t) => t.name)}`)
    check('磁盘置顶标志已保存', raw.tasks.find((t) => t.name === '每日问候')?.pinned === true)
  } catch (e) {
    check('核心流程未抛异常', false, e.message.split('\n')[0])
  } finally {
    await closeApp(app)
  }
}

// ---------- 清理临时数据目录 ----------
for (const d of dirs) {
  try {
    rmSync(d, { recursive: true, force: true })
  } catch {}
}

const pass = results.filter((r) => r.ok).length
console.log(`\n===== 功能扩容 E2E: ${pass}/${results.length} 通过 =====`)
process.exit(pass === results.length ? 0 : 1)
