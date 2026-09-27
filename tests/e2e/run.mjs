/**
 * Tempo E2E：playwright-core 驱动真实 Electron，验证用户完整闭环。
 * 运行: npm run e2e   （自建临时数据目录，不碰真实数据）
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { launchTempo, closeApp } from './probe.mjs'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${detail}`}`)
}

async function createTask(win, { name, command, runType = 'cmd', sched = 'daily', extra = {} }) {
  await win.click('[data-testid="btn-new"]')
  await win.waitForSelector('[data-testid="task-editor"]')
  await win.fill('[data-testid="field-name"]', name)
  if (runType !== 'cmd') {
    await win.click(`[data-testid="task-editor"] .seg.wide >> nth=0 >> button >> nth=${runType === 'powershell' ? 1 : 2}`)
  }
  await win.fill('.code-input', command)
  await win.click(`[data-testid="sched-${sched}"]`)
  if (sched === 'interval') {
    const num = await win.$('[data-testid="task-editor"] input[type="number"]')
    await num.fill(String(extra.minutes ?? 1))
  }
  if (sched === 'once') {
    const dt = await win.$('[data-testid="task-editor"] input[type="datetime-local"]')
    await dt.fill(extra.at)
  }
  await win.click('[data-testid="editor-save"]')
  await win.waitForSelector('[data-testid="task-editor"]', { state: 'detached' })
}

async function cardByName(win, name) {
  return win.locator(`[data-task-name="${name}"]`)
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-e2e-full-'))
let app, win

try {
  // ---------- 1. 空态 ----------
  ;({ app, win } = await launchTempo({ dataDir }))
  await win.waitForSelector('[data-testid="empty-state"]', { timeout: 8000 })
  check('空态展示', true)

  // ---------- 2. 创建成功样例任务 ----------
  await createTask(win, { name: '问好', command: 'echo hello-tempo-e2e' })
  await win.waitForSelector('[data-task-name="问好"]')
  check('创建任务后卡片出现', true)

  // ---------- 3. 立即运行 → 成功 + 输出 ----------
  const okCard = await cardByName(win, '问好')
  await okCard.hover()
  await okCard.locator('.mini-btn').first().click()
  await win.waitForSelector('[data-testid="task-card"] .last-chip.ok', { timeout: 10000 })
  const chipText = await okCard.locator('.last-chip').textContent()
  check('手动运行后卡片显示成功', chipText.includes('成功'), `chip=${chipText}`)

  await okCard.click()
  await win.waitForSelector('[data-testid="task-detail"]')
  await win.waitForSelector('[data-testid="run-list"] .run-item', { timeout: 8000 })
  const firstRun = await win.locator('[data-testid="run-list"] .run-item').first().textContent()
  check('详情页历史记录存在', firstRun.includes('手动') && firstRun.includes('成功'), firstRun.slice(0, 80))
  await win.click('[data-testid="run-list"] .run-item-head >> nth=0')
  const outText = await win.locator('.term pre').textContent()
  check('输出包含命令产物', outText.includes('hello-tempo-e2e'), `out=${outText.slice(0, 60)}`)
  await win.keyboard.press('Escape')

  // ---------- 4. 失败任务 → 退出码 ----------
  await createTask(win, { name: '注定失败', command: 'echo oops & exit /b 3' })
  const failCard = await cardByName(win, '注定失败')
  await failCard.hover()
  await failCard.locator('.mini-btn').first().click()
  await win.waitForSelector('[data-testid="task-card"] .last-chip.err', { timeout: 10000 })
  const failChip = await failCard.locator('.last-chip').textContent()
  check('失败任务显示退出码', failChip.includes('3'), `chip=${failChip}`)

  // ---------- 5. 超时任务 ----------
  await createTask(win, { name: '超时样例3s', command: 'ping -n 30 127.0.0.1 > nul' })
  // 通过编辑面板设置超时 3 秒
  const tCard = await cardByName(win, '超时样例3s')
  await tCard.click()
  await win.waitForSelector('[data-testid="task-detail"]')
  await win.click('.sheet-foot .btn >> nth=0') // 编辑
  await win.waitForSelector('[data-testid="task-editor"]')
  await win.locator('[data-testid="task-editor"] input[type="number"]').last().fill('3')
  await win.click('[data-testid="editor-save"]')
  await win.waitForSelector('[data-testid="task-editor"]', { state: 'detached' })
  await win.keyboard.press('Escape')
  await tCard.hover()
  await tCard.locator('.mini-btn').first().click()
  await tCard.locator('.last-chip.err').waitFor({ timeout: 15000 })
  await tCard.click()
  await win.waitForSelector('[data-testid="run-list"] .run-item')
  const tRun = await win.locator('[data-testid="run-list"] .run-item').first().textContent()
  check('超时任务标记为超时', tRun.includes('超时'), tRun.slice(0, 80))
  await win.keyboard.press('Escape')

  // ---------- 5.5 运行中详情：实时条目 + 手动停止 ----------
  await createTask(win, { name: '长任务直播', command: 'ping -n 12 127.0.0.1 > nul & echo done' })
  const liveCard = await cardByName(win, '长任务直播')
  await liveCard.hover()
  await liveCard.locator('.mini-btn').first().click()
  await liveCard.click()
  await win.waitForSelector('[data-testid="task-detail"]')
  await win.waitForSelector('[data-testid="run-list"] .run-item', { timeout: 6000 })
  const liveText1 = await win.locator('[data-testid="run-list"] .run-item').first().textContent()
  check('运行中任务在详情页显示直播条目', liveText1.includes('已运行'), liveText1.slice(0, 70))
  await win.click('[data-testid="detail-stop"]')
  await win.waitForTimeout(1800)
  const liveText2 = await win.locator('[data-testid="run-list"] .run-item').first().textContent()
  check('手动停止后状态为已停止', liveText2.includes('已停止'), liveText2.slice(0, 70))
  await win.keyboard.press('Escape')

  // ---------- 5.6 长内容不破坏布局 ----------
  const longName = '这是一个相当长的任务名称用来验证卡片标题在超出可用宽度时是否能够正确截断省略而不破坏布局'
  const longCmd = 'echo ' + 'x'.repeat(400)
  await createTask(win, { name: longName, command: longCmd })
  const longCard = await cardByName(win, longName)
  check('长名称/长命令任务创建成功', await longCard.count() === 1, '')
  const clipped = await longCard
    .locator('span.cmd.mono')
    .evaluate((el) => el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 50)
  check('长命令在卡片中截断显示', clipped, '')

  // ---------- 5.7 并行策略：连续两次手动运行共存 ----------
  await createTask(win, { name: '并行双跑', command: 'ping -n 5 127.0.0.1 > nul & echo p' })
  const pCard = await cardByName(win, '并行双跑')
  await pCard.click()
  await win.waitForSelector('[data-testid="task-detail"]')
  await win.locator('.sheet-foot .btn', { hasText: '编辑' }).click()
  await win.waitForSelector('[data-testid="task-editor"]')
  await win
    .locator('[data-testid="task-editor"] .opt-row', { hasText: '运行中再次触发' })
    .locator('.seg button')
    .nth(1)
    .click()
  await win.click('[data-testid="editor-save"]')
  await win.waitForSelector('[data-testid="task-editor"]', { state: 'detached' })
  await win.keyboard.press('Escape')
  await pCard.hover()
  await pCard.locator('.mini-btn').first().click()
  await win.waitForTimeout(400)
  await pCard.hover()
  await pCard.locator('.mini-btn').first().click()
  await win.waitForTimeout(9000)
  await pCard.click()
  await win.waitForSelector('[data-testid="run-list"] .run-item')
  const pRuns = await win.locator('[data-testid="run-list"] .run-item').count()
  check('并行策略下两实例同时运行', pRuns >= 2, `runs=${pRuns}`)
  await win.keyboard.press('Escape')

  // ---------- 6. Python 环境探测 + 执行 ----------
  await createTask(win, { name: 'Python 自检', command: 'import sys; print("py-ok", sys.version_info[0])', runType: 'python' })
  const pyCard = await cardByName(win, 'Python 自检')
  await pyCard.hover()
  await pyCard.locator('.mini-btn').first().click()
  await win.waitForTimeout(4000)
  await pyCard.click()
  await win.waitForSelector('[data-testid="run-list"] .run-item')
  const pyRun = await win.locator('[data-testid="run-list"] .run-item').first().textContent()
  check('Python 任务有记录', pyRun.includes('成功') || pyRun.includes('失败'), pyRun.slice(0, 80))
  await win.keyboard.press('Escape')

  // ---------- 7. 一次性任务过期 → 已错过 ----------
  const yesterday = new Date(Date.now() - 24 * 3600_000)
  const pad = (n) => String(n).padStart(2, '0')
  const atStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T${pad(yesterday.getHours())}:${pad(yesterday.getMinutes())}`
  await createTask(win, { name: '过期一次性', command: 'echo never', sched: 'once', extra: { at: atStr } })
  const onceCard = await cardByName(win, '过期一次性')
  const onceText = await onceCard.textContent()
  check('过期一次性任务标记已错过', onceText.includes('已错过'), onceText.slice(0, 60))

  // ---------- 8. 暂停 / 启用 ----------
  await cardByName(win, '问好').then(async (c) => {
    await c.hover()
    await c.locator('.kebab').click()
  })
  await win.click('.pop-menu button >> nth=1') // 暂停任务
  await win.waitForTimeout(400)
  const pausedText = await (await cardByName(win, '问好')).textContent()
  check('暂停后卡片显示已暂停', pausedText.includes('已暂停'), pausedText.slice(0, 60))

  // ---------- 9. 周期任务真实调度触发（间隔 1 分钟） ----------
  await createTask(win, { name: '每分钟心跳', command: 'echo tick %TIME%', sched: 'interval', extra: { minutes: 1 } })
  console.log('  ……等待 70 秒验证周期调度真实触发')
  const tickCard = await cardByName(win, '每分钟心跳')
  await tickCard.locator('.last-chip.ok').waitFor({ timeout: 80_000 })
  await tickCard.click()
  await win.waitForSelector('[data-testid="run-list"] .run-item')
  const tickRun = await win.locator('[data-testid="run-list"] .run-item').first().textContent()
  check('周期任务被调度器真实触发', tickRun.includes('计划'), tickRun.slice(0, 80))
  await win.keyboard.press('Escape')

  // ---------- 10. 重启持久化 ----------
  await closeApp(app)
  ;({ app, win } = await launchTempo({ dataDir }))
  await win.waitForSelector('[data-testid="task-card"]', { timeout: 8000 })
  const names = await win.locator('[data-testid="task-card"]').allTextContents()
  const all = names.join('|')
  check('重启后任务全部保留', ['问好', '注定失败', '每分钟心跳', '过期一次性'].every((n) => all.includes(n)), all.slice(0, 120))
  const pausedAgain = names.find((n) => n.includes('问好')) ?? ''
  check('暂停状态持久化', pausedAgain.includes('已暂停'), pausedAgain.slice(0, 60))

  // 磁盘数据校验
  const raw = JSON.parse(readFileSync(path.join(dataDir, 'tempo.json'), 'utf-8'))
  check('存储文件任务数一致', raw.tasks.length === 9, `tasks=${raw.tasks.length}`)
  const totalRuns = Object.values(raw.runs).reduce((n, list) => n + list.length, 0)
  check('存储文件含运行历史', totalRuns >= 3, `totalRuns=${totalRuns}`)
  const noSecret = !JSON.stringify(raw).includes('hello-tempo-e2e-disabled')
  check('存储无意外内容', noSecret, '')

  // ---------- 11. 删除任务 ----------
  await cardByName(win, '注定失败').then(async (c) => {
    await c.hover()
    await c.locator('.kebab').click()
  })
  await win.click('.pop-menu button.danger')
  await win.waitForSelector('.confirm-box')
  await win.click('.confirm-box .btn.destructive')
  await win.waitForTimeout(500)
  const afterDel = (await win.locator('[data-testid="task-card"]').allTextContents()).join('|')
  check('删除后卡片消失', !afterDel.includes('注定失败'), '')
} catch (e) {
  check('E2E 流程未抛异常', false, e.message)
  try {
    const diag = await win.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now(); let frames = 0
      const tick = () => { frames++; if (performance.now() - t0 < 700) requestAnimationFrame(tick); else resolve({ frames, anims: document.getAnimations().length }) }
      requestAnimationFrame(tick)
      setTimeout(() => resolve({ frames: 'rAF-dead', anims: document.getAnimations().length }), 2500)
    }))
    const btn = await win.$('[data-testid="btn-new"]')
    const b = btn ? await btn.boundingBox() : null
    console.log('DIAG:', JSON.stringify(diag), 'btn-box:', JSON.stringify(b))
  } catch (e2) {
    console.log('DIAG failed:', e2.message)
  }
} finally {
  try {
    await closeApp(app)
  } catch {}
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {}
}

const pass = results.filter((r) => r.ok).length
console.log(`\n===== E2E 结果: ${pass}/${results.length} 通过 =====`)
process.exit(pass === results.length ? 0 : 1)
