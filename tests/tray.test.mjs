import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCloseBehavior, trayActions, TRAY_TOOLTIP } from '../dist-electron/tray.js'

test('resolveCloseBehavior: 默认关，关窗即退出', () => {
  assert.equal(resolveCloseBehavior({ minimizeToTray: false }), 'quit')
  // 旧数据缺字段按 false 处理
  assert.equal(resolveCloseBehavior({}), 'quit')
})

test('resolveCloseBehavior: 开启后关窗隐藏，正在退出时不拦截', () => {
  assert.equal(resolveCloseBehavior({ minimizeToTray: true }), 'hide')
  assert.equal(resolveCloseBehavior({ minimizeToTray: true }, { quitting: true }), 'quit')
  assert.equal(resolveCloseBehavior({ minimizeToTray: false }, { quitting: true }), 'quit')
})

test('trayActions: 固定「显示主窗口 / 退出」两项', () => {
  const acts = trayActions()
  assert.deepEqual(acts.map((a) => a.id), ['show', 'quit'])
  assert.match(acts[0].label, /显示主窗口/)
  assert.match(acts[1].label, /退出/)
  assert.equal(typeof TRAY_TOOLTIP, 'string')
  assert.ok(TRAY_TOOLTIP.length > 0)
})
