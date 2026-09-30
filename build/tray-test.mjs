import { _electron } from 'playwright-core'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
const exe = path.resolve('dist-release/win-unpacked/Tempo.exe')
const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-tray-'))
writeFileSync(path.join(dataDir, 'tempo.json'), JSON.stringify({ schemaVersion: 1, tasks: [], runs: {}, settings: { theme: 'system', sortMode: 'created', minimizeToTray: true } }))
const app = await _electron.launch({
  executablePath: exe, args: [],
  env: { ...process.env, TEMPO_DATA_DIR: dataDir, TEMPO_DISABLE_NOTIFICATIONS: '1' },
})
const win = await app.firstWindow()
await win.waitForSelector('.app', { timeout: 10000 })
const rootPid = app.process().pid
try {
  execSync(`taskkill /PID ${rootPid}`, { stdio: 'ignore' })
} catch {}
await new Promise((r) => setTimeout(r, 5000))
const count = execSync('tasklist /FI "IMAGENAME eq Tempo.exe" /FO CSV', { encoding: 'utf-8' })
  .split('\n').filter((l) => l.startsWith('"Tempo')).length
console.log('WM_CLOSE after:', count, count > 0 ? 'TRAY-OK' : 'QUIT-BUG')
try { execSync('taskkill /IM Tempo.exe /T /F', { stdio: 'ignore' }) } catch {}
rmSync(dataDir, { recursive: true, force: true })
process.exit(0)
