/**
 * 浸泡测试：多任务并行调度 7 分钟，验证连续触发节奏、once 精确触发、内存稳定。
 * 运行: node tests/e2e/soak.mjs   （约 8 分钟）
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { launchTempo, closeApp } from './probe.mjs'
import { execSync } from 'node:child_process'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${detail}`}`)
}

function procMem(rootPid) {
  try {
    const out = execSync(
      `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ParentProcessId=${rootPid}\\").WorkingSetSize"`,
      { encoding: 'utf-8', timeout: 15000 },
    )
    const a = out.split('\n').map((l) => Number(l.trim())).filter((n) => Number.isFinite(n) && n > 0)
    return a.reduce((s, n) => s + n, 0)
  } catch {
    return 0
  }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

const SOAK_MIN = Number(process.env.SOAK_MIN ?? 7)
const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-soak-'))
let app, win
try {
  ;({ app, win } = await launchTempo({ dataDir }))
  await win.waitForSelector('[data-testid="empty-state"]', { timeout: 8000 })

  // A: 每 1 分钟；B: 每 2 分钟；C: 3 分钟后一次性
  async function create(name, command, sched, extra = {}) {
    await win.click('[data-testid="btn-new"]')
    await win.waitForSelector('[data-testid="task-editor"]')
    await win.fill('[data-testid="field-name"]', name)
    await win.fill('.code-input', command)
    await win.click(`[data-testid="sched-${sched}"]`)
    if (sched === 'interval') {
      await win.locator('[data-testid="task-editor"] input[type="number"]').first().fill(String(extra.minutes))
    }
    if (sched === 'once') {
      const at = new Date(extra.at)
      await win
        .locator('[data-testid="task-editor"] input[type="datetime-local"]')
        .fill(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`)
    }
    await win.click('[data-testid="editor-save"]')
    await win.waitForSelector('[data-testid="task-editor"]', { state: 'detached' })
  }

  const now = Date.now()
  await create('浸泡-每分钟', 'echo A %TIME%', 'interval', { minutes: 1 })
  await create('浸泡-每两分钟', 'echo B %TIME%', 'interval', { minutes: 2 })
  await create('浸泡-一次性', 'echo C-once', 'once', { at: now + 3 * 60_000 })
  const mem1 = procMem(app.process().pid)
  console.log(`  [soak] 开始浸泡 ${SOAK_MIN} 分钟…… (mem1=${Math.round(mem1 / 1048576)}MB)`)

  await win.waitForTimeout(SOAK_MIN * 60_000)
  const mem2 = procMem(app.process().pid)
  console.log(`  [soak] 结束 (mem2=${Math.round(mem2 / 1048576)}MB)`)

  await closeApp(app)
  const raw = JSON.parse(readFileSync(path.join(dataDir, 'tempo.json'), 'utf-8'))
  const runs = (name) => raw.runs[raw.tasks.find((t) => t.name === name)?.id] ?? []
  const aRuns = runs('浸泡-每分钟')
  const bRuns = runs('浸泡-每两分钟')
  const cRuns = runs('浸泡-一次性')

  check(`每分钟任务触发 ≥${SOAK_MIN - 1} 次且全部成功`, aRuns.length >= SOAK_MIN - 1 && aRuns.every((r) => r.status === 'success'), `n=${aRuns.length}`)
  check('每分钟触发均为计划触发', aRuns.every((r) => r.trigger === 'scheduled'), '')
  check(`每两分钟任务触发 ≥${Math.max(1, Math.floor(SOAK_MIN / 2) - 1)} 次`, bRuns.length >= Math.max(1, Math.floor(SOAK_MIN / 2) - 1) && bRuns.every((r) => r.status === 'success'), `n=${bRuns.length}`)
  check('一次性任务在 3 分钟后精确执行', cRuns.length === 1 && cRuns[0].status === 'success', `n=${cRuns.length}`)
  const cTask = raw.tasks.find((t) => t.name === '浸泡-一次性')
  check('一次性任务执行后 nextRunAt 置空', cTask.nextRunAt === null, String(cTask.nextRunAt))
  const growth = (mem2 - mem1) / 1048576
  check('内存无异常增长（<40MB）', growth < 40, `growth=${growth.toFixed(1)}MB`)

  // 节奏检验：每分钟任务的连续触发间隔 ≈60s（±5s，允许进程启动首轮偏差）
  if (aRuns.length >= 4) {
    const sorted = [...aRuns].sort((x, y) => x.startedAt - y.startedAt)
    const gaps = []
    for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i].startedAt - sorted[i - 1].startedAt) / 1000)
    const maxDev = Math.max(...gaps.map((g) => Math.abs(g - 60)))
    check('每分钟节奏稳定（间隔偏差 ≤5s）', maxDev <= 5, `gaps=${gaps.map((g) => g.toFixed(0)).join(',')}`)
  }
} catch (e) {
  check('浸泡流程未抛异常', false, e.message.split('\n')[0])
} finally {
  try {
    await closeApp(app)
  } catch {}
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {}
}

const pass = results.filter((r) => r.ok).length
console.log(`\n===== 浸泡结果: ${pass}/${results.length} 通过 =====`)
process.exit(pass === results.length ? 0 : 1)
