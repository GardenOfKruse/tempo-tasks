import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitHighlight } from '../dist-electron/highlight.js'

const texts = (parts) => parts.map((p) => p.text).join('')
const hits = (parts) => parts.filter((p) => p.hit).map((p) => p.text)

test('splitHighlight: 空查询返回整段未命中', () => {
  const parts = splitHighlight('echo hello', '')
  assert.deepEqual(parts, [{ text: 'echo hello', hit: false }])
  // 全空白查询与空串等价
  assert.deepEqual(splitHighlight('echo hello', '   '), [{ text: 'echo hello', hit: false }])
})

test('splitHighlight: 命中一处，前后文保留且大小写不敏感', () => {
  const parts = splitHighlight('curl https://EXAMPLE.com/health', 'example')
  assert.equal(texts(parts), 'curl https://EXAMPLE.com/health')
  assert.deepEqual(hits(parts), ['EXAMPLE'])
  assert.equal(parts.filter((p) => p.hit).length, 1)
  assert.equal(parts[0].hit, false)
  assert.equal(parts[1].hit, true)
  assert.equal(parts[2].hit, false)
})

test('splitHighlight: 多处命中 / 整串命中 / 无命中', () => {
  const multi = splitHighlight('a-b-c', '-')
  assert.deepEqual(hits(multi), ['-', '-'])
  assert.equal(texts(multi), 'a-b-c')

  const three = splitHighlight('x-x-x', 'x-')
  assert.deepEqual(hits(three), ['x-', 'x-'])

  const whole = splitHighlight('ping', 'ping')
  assert.deepEqual(whole, [{ text: 'ping', hit: true }])

  const none = splitHighlight('echo hi', 'zzz')
  assert.deepEqual(none, [{ text: 'echo hi', hit: false }])
})

test('splitHighlight: 头尾命中不产生空片段', () => {
  const head = splitHighlight('ab cd', 'ab')
  assert.deepEqual(head, [
    { text: 'ab', hit: true },
    { text: ' cd', hit: false },
  ])
  const tail = splitHighlight('ab cd', 'cd')
  assert.deepEqual(tail, [
    { text: 'ab ', hit: false },
    { text: 'cd', hit: true },
  ])
  // 查询长于文本 → 无命中
  assert.deepEqual(splitHighlight('ab', 'abc'), [{ text: 'ab', hit: false }])
})

test('splitHighlight: 特殊字符按字面处理（正则元字符不报错不误命中）', () => {
  const parts = splitHighlight('echo a.*b', 'a.*b')
  assert.deepEqual(hits(parts), ['a.*b'])
  const cjk = splitHighlight('备份 桌面 每日', '桌面')
  assert.deepEqual(hits(cjk), ['桌面'])
  assert.equal(texts(cjk), '备份 桌面 每日')
})
