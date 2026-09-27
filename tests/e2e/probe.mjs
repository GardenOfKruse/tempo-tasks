/**
 * E2E 基建 + DOM 调试：playwright-core 驱动真实 Electron。
 * 单独运行: node tests/e2e/probe.mjs —— 打印页面可见文本与卡片数量。
 */
import { _electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// TEMPO_E2E_EXE=path 时对打包产物跑 E2E（验证 asar 环境差异）
const electronPath = process.env.TEMPO_E2E_EXE ? path.resolve(process.env.TEMPO_E2E_EXE) : require('electron')


export async function launchTempo({ seed, dataDir: forcedDir } = {}) {
  const dataDir = forcedDir ?? mkdtempSync(path.join(tmpdir(), 'tempo-e2e-'))
  if (seed) {
    const { seedDemo } = await import('../../scripts/seed-demo.mjs')
    seedDemo(dataDir)
  }
  // 熄屏/锁屏切换窗口期启动的实例偶发完全停帧（rAF 死亡），检测到就换一个实例重试
  let lastErr = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const app = await _electron.launch({
      executablePath: electronPath,
      args: ['.'],
      env: { ...process.env, TEMPO_DATA_DIR: dataDir, TEMPO_DISABLE_NOTIFICATIONS: '1', TEMPO_OFFSCREEN: '1' },
    })
    try {
      const win = await app.firstWindow()
      await win.waitForLoadState('domcontentloaded')
      await win.waitForSelector('.app', { timeout: 8000 })
      const raf = await win.evaluate(
        () =>
          new Promise((resolve) => {
            const t0 = performance.now()
            let frames = 0
            const tick = () => {
              frames++
              if (performance.now() - t0 < 600) requestAnimationFrame(tick)
              else resolve(frames)
            }
            requestAnimationFrame(tick)
            setTimeout(() => resolve(0), 2000)
          }),
      )
      if (raf >= 8) return { app, win, dataDir }
      lastErr = new Error(`renderer stalled (rAF=${raf}), attempt ${attempt}`)
      console.log(`[launch] ${lastErr.message}`)
    } catch (e) {
      lastErr = e
      const first = String(e.message).split('\n')[0]
      console.log(`[launch] attempt ${attempt} failed: ${first}`)
    }
    await closeApp(app)
  }
  throw lastErr ?? new Error('launch failed')
}

export async function closeApp(app) {
  if (!app) return
  try {
    const proc = app.process()
    await app.close()
    // app.close() 返回时 before-quit 的落盘可能尚未执行，等进程真正退出
    await new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve()
      const timer = setTimeout(resolve, 5000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  } catch {}
}

const isMain = process.argv[1] && process.argv[1].endsWith('probe.mjs')
if (isMain) {
  const { app, win } = await launchTempo({ seed: true })
  await win.waitForTimeout(2500)
  const info = await win.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid="task-card"]').length,
    gridExists: !!document.querySelector('.grid'),
    emptyState: !!document.querySelector('[data-testid="empty-state"]'),
    bodyClass: document.body.className,
    gridHTMLLen: document.querySelector('.grid')?.innerHTML.length ?? 0,
    contentText: document.querySelector('.content-inner')?.textContent?.slice(0, 300) ?? '',
  }))
  console.log(JSON.stringify(info, null, 2))
  await closeApp(app)
}
