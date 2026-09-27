/**
 * 可重复测量：启动耗时 / 空闲资源占用 / 任务执行期界面响应。
 * 运行: node scripts/measure.mjs   （3 次启动采样 + 1 次空闲采样 + 1 次运行期采样）
 */
import { _electron } from 'playwright-core'
import { spawnSync, execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

function psQuery(filter) {
  const script = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress`
  try {
    const out = execSync(`powershell.exe -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
      timeout: 20000,
    })
    const v = JSON.parse(out || '[]')
    return Array.isArray(v) ? v : v ? [v] : []
  } catch {
    return []
  }
}

function procStats(rootPid) {
  // 收集进程树（主进程 + 渲染 + GPU 等）的内存与 CPU
  const list = psQuery(`ProcessId=${rootPid}`)
  list.push(...psQuery(`ParentProcessId=${rootPid}`))
  for (const c of psQuery(`ParentProcessId=${rootPid}`)) {
    list.push(...psQuery(`ParentProcessId=${c.ProcessId}`))
  }
  let mem = 0
  let cpu = 0
  let count = 0
  for (const p of list) {
    if (!p || !p.ProcessId) continue
    mem += Number(p.WorkingSetSize) || 0
    cpu += (Number(p.KernelModeTime) || 0) + (Number(p.UserModeTime) || 0)
    count++
  }
  if (count === 0) return null
  return { memBytes: mem, cpuMs: cpu / 10000, count } // 100ns → ms
}

async function launch(dataDir, offscreen) {
  const t0 = Date.now()
  const app = await _electron.launch({
    executablePath: electronPath,
    args: ['.'],
    env: {
      ...process.env,
      TEMPO_DATA_DIR: dataDir,
      TEMPO_DISABLE_NOTIFICATIONS: '1',
      ...(offscreen ? { TEMPO_OFFSCREEN: '1' } : {}),
    },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('.app', { timeout: 10000 })
  const info = await win.evaluate(() => window.tempo.appInfo())
  return { app, win, dataDir, rootPid: app.process().pid, launchToDom: Date.now() - t0, readyMs: info.readyMs }
}

const report = { startedAt: new Date().toISOString(), startup: [], idle: null, running: null, note: '' }

// ---- 1. 启动耗时 ×3（离屏模式，熄屏死区也能稳定运行；启动路径与正常模式一致） ----
for (let i = 1; i <= 3; i++) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-m-'))
  const r = await launch(dataDir, true)
  report.startup.push({ attempt: i, readyMs: r.readyMs, launchToDomMs: r.launchToDom })
  await r.app.close()
  rmSync(dataDir, { recursive: true, force: true })
}

// ---- 2. 空闲 30s：内存 + CPU（真实窗口模式） ----
{
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-m-'))
  const r = await launch(dataDir, true)
  await r.win.waitForTimeout(2000)
  const s1 = procStats(r.rootPid)
  await r.win.waitForTimeout(30_000)
  const s2 = procStats(r.rootPid)
  if (s1 && s2) {
    report.idle = {
      processes: s2.count,
      memoryMB: Math.round((s2.memBytes / 1048576) * 10) / 10,
      cpuPercentOfOneCore: Math.round(((s2.cpuMs - s1.cpuMs) / 30000) * 1000) / 10,
      windowMs: 30000,
    }
  }
  await r.app.close()
  rmSync(dataDir, { recursive: true, force: true })
}

// ---- 3. 任务执行期界面响应：空闲 rAF vs 长任务运行中 rAF（各测 5s，真实窗口模式） ----
{
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-m-'))
  const r = await launch(dataDir, true)
  const raf = () =>
    r.win.evaluate(
      () =>
        new Promise((resolve) => {
          const t0 = performance.now()
          let frames = 0
          const tick = () => {
            frames++
            if (performance.now() - t0 < 5000) requestAnimationFrame(tick)
            else resolve(frames)
          }
          requestAnimationFrame(tick)
          setTimeout(() => resolve(0), 8000)
        }),
    )
  const idleFps = Math.round((await raf()) / 5)
  // 通过 UI 创建并启动一个 10 秒的长任务
  await r.win.click('[data-testid="btn-new"]')
  await r.win.waitForSelector('[data-testid="task-editor"]')
  await r.win.fill('[data-testid="field-name"]', '测量负载')
  await r.win.fill('[data-testid="field-command"]', 'ping -n 12 127.0.0.1 > nul')
  await r.win.click('[data-testid="editor-save"]')
  await r.win.waitForSelector('[data-testid="task-editor"]', { state: 'detached' })
  const card = r.win.locator('[data-task-name="测量负载"]')
  await card.hover()
  await card.locator('.mini-btn').first().click()
  await r.win.waitForTimeout(1200)
  const s1 = procStats(r.rootPid)
  const runFps = Math.round((await raf()) / 5)
  const s2 = procStats(r.rootPid)
  const taskName = '测量负载'
  await r.win.waitForSelector('[data-task-name="' + taskName + '"] .last-chip.ok', { timeout: 20000 })
  report.running = {
    idleFps,
    runningFps: runFps,
    fpsDrop: idleFps - runFps,
    extraCpuPercentOfOneCoreDuringRun: s1 && s2 ? Math.round(((s2.cpuMs - s1.cpuMs) / 5000) * 1000) / 10 : null,
    note: 'fps=窗口每秒渲染帧数（requestAnimationFrame）；任务为 12 秒 ping 空转',
  }
  await r.app.close()
  rmSync(dataDir, { recursive: true, force: true })
}

report.note = '环境：本机实测；readyMs=Electron 主进程启动到窗口 did-finish-load；资源为 Tempo 全部进程之和'
console.log(JSON.stringify(report, null, 2))
import { writeFileSync, mkdirSync } from 'node:fs'
mkdirSync('docs', { recursive: true })
writeFileSync('docs/measurements.json', JSON.stringify(report, null, 2))
