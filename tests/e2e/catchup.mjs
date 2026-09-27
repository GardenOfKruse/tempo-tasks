/**
 * 错过补跑（catch-up）端到端验证：
 * A) catchUp=true：应用关闭期间错过的周期调度 → 重启后自动补跑一次（trigger=补跑）
 * B) catchUp=false：错过 → 不执行，missedCount 计数 + 卡片「已错过」
 * 运行: node tests/e2e/catchup.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'

async function waitForTaskId(file, name) {
  for (let i = 0; i < 50; i++) {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf-8'))
      const t = raw.tasks.find((x) => x.name === name)
      if (t) return t.id
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('task not found in store: ' + name)
}
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { launchTempo, closeApp } from './probe.mjs'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${detail}`}`)
}

function writeNextRunAt(dataDir, taskId, nextRunAt) {
  const file = path.join(dataDir, 'tempo.json')
  const raw = JSON.parse(readFileSync(file, 'utf-8'))
  const t = raw.tasks.find((x) => x.id === taskId)
  t.nextRunAt = nextRunAt
  writeFileSync(file, JSON.stringify(raw, null, 2))
}

async function createIntervalTask(win, name, command, catchUp) {
  await win.click('[data-testid="btn-new"]')
  await win.waitForSelector('[data-testid="task-editor"]')
  await win.fill('[data-testid="field-name"]', name)
  await win.fill('.code-input', command)
  await win.click('[data-testid="sched-interval"]')
  await win.locator('[data-testid="task-editor"] input[type="number"]').first().fill('10')
  if (catchUp === false) {
    await win.locator('[data-testid="task-editor"] [data-testid="switch"]').first().click()
  }
  await win.click('[data-testid="editor-save"]')
  await win.waitForSelector('[data-testid="task-editor"]', { state: 'detached' })
  return waitForTaskId(path.join(dataDir, 'tempo.json'), name)
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-catchup-'))
let app, win
try {
  // ---- A. catchUp = true ----
  ;({ app, win } = await launchTempo({ dataDir }))
  await win.waitForSelector('[data-testid="empty-state"]', { timeout: 8000 })
  const idA = await createIntervalTask(win, '补跑任务A', 'echo catch-up-A')
  await closeApp(app)

  const missedAt = Date.now() - 90_000
  writeNextRunAt(dataDir, idA, missedAt)
  ;({ app, win } = await launchTempo({ dataDir }))
  const cardA = win.locator('[data-task-name="补跑任务A"]')
  console.log('  [dbg] waiting card')
  await cardA.waitFor({ timeout: 8000 })
  console.log('  [dbg] card found, waiting chip')
  try {
    await cardA.locator('.last-chip.ok').waitFor({ timeout: 12000 })
  } catch (e) {
    const raw = JSON.parse(readFileSync(path.join(dataDir, 'tempo.json'), 'utf-8'))
    const t = raw.tasks.find((x) => x.id === idA)
    console.log('  [dbg] CHIP TIMEOUT. task:', JSON.stringify({ lastRunAt: t.lastRunAt, nextRunAt: t.nextRunAt, catchUp: t.catchUp, enabled: t.enabled }, null, 1))
    console.log('  [dbg] now:', Date.now(), 'runs:', (raw.runs[idA] ?? []).length)
    throw e
  }
  console.log('  [dbg] chip ok')
  await cardA.click()
  await win.waitForSelector('[data-testid="run-list"] .run-item')
  const runA = await win.locator('[data-testid="run-list"] .run-item').first().textContent()
  check('A: 重启后自动补跑', runA.includes('补跑'), runA.slice(0, 70))
  await win.keyboard.press('Escape')

  // ---- B. catchUp = false ----
  const idB = await createIntervalTask(win, '跳过任务B', 'echo never-B', false)
  await closeApp(app)
  writeNextRunAt(dataDir, idB, Date.now() - 90_000)
  ;({ app, win } = await launchTempo({ dataDir }))
  const cardB = win.locator('[data-task-name="跳过任务B"]')
  await cardB.waitFor({ timeout: 8000 })
  await win.waitForTimeout(4000)
  const textB = await cardB.textContent()
  check('B: 未补跑显示已错过', textB.includes('已错过') && !textB.includes('运行中'), textB.slice(0, 70))
  const raw = JSON.parse(readFileSync(path.join(dataDir, 'tempo.json'), 'utf-8'))
  const tB = raw.tasks.find((t) => t.id === idB)
  check('B: missedCount 计数', tB.missedCount >= 1, `missedCount=${tB.missedCount}`)
  check('B: 没有产生执行记录', (raw.runs[idB] ?? []).length === 0, `runs=${(raw.runs[idB] ?? []).length}`)
  const tA = raw.tasks.find((t) => t.id === idA)
  check('A: nextRunAt 回到未来', tA.nextRunAt !== null && tA.nextRunAt > Date.now(), String(tA.nextRunAt))
} catch (e) {
  check('流程未抛异常', false, e.message.split('\n')[0])
} finally {
  await closeApp(app)
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {}
}

const pass = results.filter((r) => r.ok).length
console.log(`\n===== 补跑验证: ${pass}/${results.length} 通过 =====`)
process.exit(pass === results.length ? 0 : 1)
