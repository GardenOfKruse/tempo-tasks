/**
 * 第六轮修复回归：清空历史同步删落盘日志 / runsVersion 并行历史刷新
 * 运行: node tests/e2e/regressions.mjs   （隐藏离屏，无窗口）
 */
import { launchTempo, closeApp } from './probe.mjs'
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${detail}`}`)
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-regr-'))
let app, win
try {
  // ========== 1. 清空历史同步删除落盘日志 ==========
  ;({ app, win } = await launchTempo({ dataDir }))
  await win.waitForSelector('.app', { timeout: 10000 })
  await win.click('[data-testid="btn-settings"]', { force: true, timeout: 8000 })
  await win.waitForSelector('[data-testid="settings-sheet"]', { timeout: 6000 })
  await win.click('[data-testid="settings-runlogs"]', { force: true, timeout: 8000 })
  await win.waitForTimeout(500)
  await win.keyboard.press('Escape')
  await win.click('[data-testid="btn-new"]', { force: true, timeout: 8000 })
  await win.waitForSelector('[data-testid="task-editor"]', { timeout: 6000 })
  await win.fill('[data-testid="field-name"]', '日志落盘验证')
  await win.fill('.code-input', 'echo log-check-ok')
  await win.click('[data-testid="editor-save"]', { force: true, timeout: 8000 })
  await win.waitForSelector('[data-testid="task-editor"]', { state: 'detached' })
  const card = win.locator('[data-task-name="日志落盘验证"]')
  await card.hover()
  await card.locator('.mini-btn').first().click()
  await card.locator('.last-chip.ok').waitFor({ timeout: 15000 })
  await win.waitForTimeout(1500)
  const taskId = JSON.parse(readFileSync(path.join(dataDir, 'tempo.json'), 'utf-8')).tasks[0].id
  const logDir = path.join(dataDir, 'runs', taskId)
  check('运行日志已落盘', existsSync(logDir) && readdirSync(logDir).some((f) => f.endsWith('.log')), '')
  await card.click()
  await win.waitForSelector('[data-testid="task-detail"]')
  await win.locator('button', { hasText: '清空' }).first().click()
  await win.waitForSelector('.confirm-box', { timeout: 5000 })
  await win.click('.confirm-box .btn.destructive')
  await win.waitForTimeout(1200)
  check('清空历史后日志目录已删除', !existsSync(logDir), `仍存在: ${existsSync(logDir)}`)
  await win.keyboard.press('Escape')

  // ========== 2. runsVersion：并行实例先结束的记录进历史 ==========
  await closeApp(app)
  ;({ app, win } = await launchTempo({}))
  await win.waitForSelector('.app', { timeout: 10000 })
  await win.click('[data-testid="btn-new"]', { force: true, timeout: 8000 })
  await win.waitForSelector('[data-testid="task-editor"]', { timeout: 6000 })
  await win.fill('[data-testid="field-name"]', '并行重叠验证')
  await win.fill('.code-input', 'ping -n 90 127.0.0.1 > nul')
  await win.click('[data-testid="sched-interval"]')
  await win.locator('[data-testid="task-editor"] input[type="number"]').first().fill('1')
  await win.locator('[data-testid="task-editor"] .opt-row', { hasText: '运行中再次触发' }).locator('.seg button').nth(1).click()
  await win.click('[data-testid="editor-save"]')
  await win.waitForSelector('[data-testid="task-editor"]', { state: 'detached' })
  console.log('  ……等 155 秒验证并行重叠（间隔 1 分钟 + 单轮 90 秒）')
  const pCard = win.locator('[data-task-name="并行重叠验证"]')
  await win.waitForTimeout(155_000)
  await pCard.click()
  await win.waitForSelector('[data-testid="task-detail"]', { timeout: 8000 })
  await win.waitForSelector('[data-testid="run-list"] .run-item', { timeout: 8000 })
  const runCount = await win.locator('[data-testid="run-list"] .run-item').count()
  check('并行重叠：A 结束进历史 + B 直播可见', runCount >= 2, `runs=${runCount}`)
  await win.keyboard.press('Escape')
  await closeApp(app)
} catch (e) {
  check('流程未抛异常', false, e.message.split('\n')[0])
} finally {
  try { await closeApp(app) } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}

const pass = results.filter((r) => r.ok).length
console.log(`\n===== 第六轮回归: ${pass}/${results.length} 通过 =====`)
process.exit(pass === results.length ? 0 : 1)
