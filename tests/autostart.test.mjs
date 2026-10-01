import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTOSTART_HIDDEN_ARG, launchedByAutoStart, resolveLoginItem } from '../dist-electron/autostart.js'

const EXE = 'C:\\Program Files\\Tempo\\Tempo.exe'

test('resolveLoginItem: 开启时写入 openAtLogin + --hidden 静默参数', () => {
  assert.deepEqual(resolveLoginItem(true, EXE), {
    openAtLogin: true,
    path: EXE,
    args: ['--hidden'],
  })
  assert.equal(AUTOSTART_HIDDEN_ARG, '--hidden')
})

test('resolveLoginItem: 关闭时不带 args（Electron 清除本应用 Run 键条目）', () => {
  const r = resolveLoginItem(false, EXE)
  assert.equal(r.openAtLogin, false)
  assert.equal(r.args, undefined)
})

test('launchedByAutoStart: argv 精确匹配 --hidden（误配 --hiddenfoo 不算）', () => {
  assert.equal(launchedByAutoStart([EXE, '--hidden']), true)
  assert.equal(launchedByAutoStart(['electron.exe', '.', '--hidden']), true)
  assert.equal(launchedByAutoStart(['electron.exe', '.']), false)
  assert.equal(launchedByAutoStart([EXE, '--hidden=1']), false)
  assert.equal(launchedByAutoStart([EXE, '--hiddenfoo']), false)
  assert.equal(launchedByAutoStart([]), false)
})
