/**
 * 用户体验审查：编辑回填 / 校验报错 / 快捷键 / 缩放 / 设置面板。
 * 运行: node tests/e2e/review.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { launchTempo, closeApp } from './probe.mjs'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  —— ${detail}`}`)
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'tempo-review-'))
let app, win
try {
  ;({ app, win } = await launchTempo({ seed: true, dataDir }))
  await win.waitForSelector('[data-testid="task-card"]', { timeout: 8000 })

  // 1. 编辑回填
  await win.locator('[data-task-name="本地时钟快照"]').click()
  await win.waitForSelector('[data-testid="task-detail"]')
  await win.locator('.sheet-foot .btn', { hasText: '编辑' }).click()
  await win.waitForSelector('[data-testid="task-editor"]')
  const nameVal = await win.inputValue('[data-testid="field-name"]')
  const cmdVal = await win.inputValue('.code-input')
  check('编辑回填名称', nameVal === '本地时钟快照', nameVal)
  check('编辑回填命令', cmdVal.includes('%TIME%'), cmdVal)
  const dailyOn = await win.locator('[data-testid="sched-daily"].on').count()
  const timeVal = await win.inputValue('[data-testid="task-editor"] input[type="time"]')
  check('编辑回填计划（每天 08:30）', dailyOn === 1 && timeVal === '08:30', `${dailyOn}/${timeVal}`)
  await win.keyboard.press('Escape')

  // 2. cron 无效输入报错
  await win.click('[data-testid="btn-new"]')
  await win.waitForSelector('[data-testid="task-editor"]')
  await win.fill('[data-testid="field-name"]', 'Cron 校验')
  await win.fill('.code-input', 'echo hi')
  await win.click('[data-testid="sched-cron"]')
  await win.fill('[data-testid="task-editor"] input.mono', '99 * * * *')
  await win.click('[data-testid="editor-save"]')
  const err = await win.locator('[data-testid="editor-error"]').textContent().catch(() => '')
  check('无效 cron 保存被拦截并提示', (err ?? '').includes('Cron'), err ?? 'no-error-shown')
  await win.keyboard.press('Escape')

  // 3. 搜索过滤
  await win.fill('.search-box input', '时钟')
  await win.waitForTimeout(300)
  const visible = await win.locator('[data-testid="task-card"]').count()
  check('搜索过滤生效', visible === 1, `visible=${visible}`)
  await win.fill('.search-box input', '')

  // 4. 筛选 chip：失败
  await win.click('[data-testid="filter-failed"]')
  await win.waitForTimeout(300)
  const failedNames = await win.locator('[data-testid="task-card"]').allTextContents()
  check('失败筛选只显示失败任务', failedNames.length === 1 && failedNames[0].includes('失败示例'), JSON.stringify(failedNames.length))
  await win.click('[data-testid="filter-all"]')

  // 5. 快捷键 Ctrl+N
  await win.keyboard.press('Control+n')
  await win.waitForSelector('[data-testid="task-editor"]')
  check('Ctrl+N 打开新建', true)
  await win.keyboard.press('Escape')

  // 6. 窗口缩放到 700px 不破格
  await win.setViewportSize({ width: 700, height: 520 })
  await win.waitForTimeout(500)
  const cardBox = await win.locator('[data-testid="task-card"]').first().boundingBox()
  check('窄窗口下卡片不越界', cardBox && cardBox.width >= 300 && cardBox.width <= 660, JSON.stringify(cardBox))
  await win.setViewportSize({ width: 1120, height: 740 })

  // 7. 设置面板（独立 Sheet）
  await win.click('.hero-actions .icon-btn.subtle')
  await win.waitForSelector('[data-testid="settings-sheet"]')
  await win.locator('[data-testid="settings-sheet"] .seg >> text=深色').click()
  await win.waitForTimeout(400)
  const darkOn = await win.evaluate(() => document.body.classList.contains('theme-dark'))
  check('设置内切换深色主题', darkOn, '')
  await win.screenshot({ path: 'docs/shots/08-settings-dark.png' })
  await win.locator('[data-testid="settings-sheet"] .seg >> text=名称').click()
  await win.waitForSelector('.toast:has-text("排序")')
  check('设置内切换排序有 toast 反馈', true)
  await win.keyboard.press('Escape')
  await win.waitForSelector('[data-testid="settings-sheet"]', { state: 'detached' })
  check('Escape 关闭设置面板', true)
} catch (e) {
  check('审查流程未抛异常', false, e.message.split('\n')[0])
} finally {
  await closeApp(app)
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {}
}

const pass = results.filter((r) => r.ok).length
console.log(`\n===== 体验审查: ${pass}/${results.length} 通过 =====`)
process.exit(pass === results.length ? 0 : 1)
