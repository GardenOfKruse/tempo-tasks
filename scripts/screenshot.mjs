/**
 * 截图脚本（playwright 驱动，capturePage 在后台窗口下不可靠）。
 * 用法: node scripts/screenshot.mjs <name> [ui] [delayMs] [--dark]
 *   ui: ""(主页) | editor | detail | empty   （editor/detail 通过真实点击进入）
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { launchTempo, closeApp } from '../tests/e2e/probe.mjs'

const [, , name, ui = '', delayArg = '1800', darkFlag = ''] = process.argv
if (!name) {
  console.error('usage: node scripts/screenshot.mjs <name> [ui] [delayMs] [--dark]')
  process.exit(1)
}
const dark = darkFlag === '--dark'
const outDir = path.resolve('docs/shots')
mkdirSync(outDir, { recursive: true })
const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-shot-'))

const { seedDemo } = await import('./seed-demo.mjs')
if (ui === 'running') {
  // 运行中状态：把采集任务的下一次执行调到 2 秒后，命令为 12 秒长任务
  const mod = await import('./seed-running.mjs')
  mod.seedRunning(dataDir, dark ? { theme: 'dark' } : {})
} else if (ui !== 'empty') {
  seedDemo(dataDir, dark ? { theme: 'dark' } : {})
}

const { app, win } = await launchTempo({ dataDir })
await win.waitForTimeout(Number(delayArg))

try {
  if (ui === 'editor') {
    await win.click('[data-testid="btn-new"]')
    await win.waitForTimeout(450)
  } else if (ui === 'detail') {
    await win.click('[data-testid="task-card"]')
    await win.waitForTimeout(500)
  } else if (ui === 'editor-python') {
    await win.click('[data-testid="btn-new"]')
    await win.waitForSelector('[data-testid="task-editor"]')
    const seg = await win.$$('#task-editor .seg.wide >> nth=0 >> button')
    await seg[2].click()
    await win.waitForTimeout(600)
  }
  await win.screenshot({ path: path.join(outDir, name + '.png') })
  console.log(`[shot] saved docs/shots/${name}.png`)
} catch (e) {
  console.error('[shot] failed:', e.message)
  process.exitCode = 1
} finally {
  await closeApp(app)
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {}
}
