/**
 * 托盘模式长时浸泡：minimizeToTray=true，关窗隐藏后调度继续，验证长时稳定。
 * 运行: SOAK_MIN=20 node tests/e2e/soak-tray.mjs
 */
import { _electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const exe = path.resolve('dist-release/win-unpacked/Tempo.exe')
const SOAK_MIN = Number(process.env.SOAK_MIN ?? 20)

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${detail}`}`)
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-soak-tray-'))
writeFileSync(path.join(dataDir, 'tempo.json'), JSON.stringify({ schemaVersion: 1, tasks: [], runs: {}, settings: { theme: 'system', sortMode: 'created', minimizeToTray: true } }))

const app = await _electron.launch({
  executablePath: exe, args: [],
  env: { ...process.env, TEMPO_DATA_DIR: dataDir, TEMPO_DISABLE_NOTIFICATIONS: '1' },
})
const win = await app.firstWindow()
await win.waitForSelector('.app', { timeout: 10000 })
// 建每分钟任务（UI 全流程）
await win.click('[data-testid="btn-new"]')
await win.waitForSelector('[data-testid="task-editor"]')
await win.fill('[data-testid="field-name"]', '托盘浸泡心跳')
await win.fill('.code-input', 'echo tray-tick %TIME%')
await win.click('[data-testid="sched-interval"]')
await win.locator('[data-testid="task-editor"] input[type="number"]').first().fill('1')
await win.click('[data-testid="editor-save"]')
await win.waitForSelector('[data-testid="task-editor"]', { state: 'detached' })

// 关窗 → 隐藏到托盘（进程应存活）。注意：playwright win.close() 不触发 Electron close 事件，必须走 WM_CLOSE
try { execSync(`taskkill /PID ${app.process().pid}`, { stdio: 'ignore' }) } catch {}
await new Promise((r) => setTimeout(r, 4000))
let aliveAfterClose = false
try { execSync(`tasklist /FI "PID eq ${app.process().pid}" /FO CSV`, { encoding: 'utf-8', timeout: 10000 }); aliveAfterClose = true } catch {}
try { aliveAfterClose = execSync(`tasklist /FI "IMAGENAME eq Tempo.exe" /FO CSV`, { encoding: 'utf-8' }).split('\n').filter((l) => l.startsWith('"Tempo')).length > 0 } catch {}
check('关窗后进程存活（托盘隐藏）', aliveAfterClose)
console.log(`  [soak-tray] 托盘隐藏浸泡 ${SOAK_MIN} 分钟……调度应在后台继续`)

// 等浸泡结束
await new Promise((r) => setTimeout(r, SOAK_MIN * 60_000))

// 验证：任务在托盘期间持续触发（读磁盘数据）
const raw = JSON.parse(readFileSync(path.join(dataDir, 'tempo.json'), 'utf-8'))
const runs = raw.runs[raw.tasks[0]?.id] ?? []
const n = runs.length
check(`托盘隐藏期间触发 ≥${SOAK_MIN - 1} 次`, n >= SOAK_MIN - 1, `n=${n}`)
check('全部为计划触发且成功', runs.every((r) => r.trigger === 'scheduled' && r.status === 'success'), JSON.stringify(runs.map((r) => r.status)))
const mem = execSync(`powershell -NoProfile -Command "(Get-Process -Name Tempo -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum / 1MB"`, { encoding: 'utf-8', timeout: 15000 }).trim()
console.log(`  [soak-tray] 内存 ${mem} MB`)

try { await app.close() } catch {}
try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
const pass = results.filter((r) => r.ok).length
console.log(`\n===== 托盘浸泡: ${pass}/${results.length} 通过 =====`)
process.exit(pass === results.length ? 0 : 1)
