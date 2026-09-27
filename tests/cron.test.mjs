import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCron, cronNext } from '../dist-electron/cron.js'

/** 构造本地时间引用点，保证测试与时区无关 */
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

test('parseCron: 合法表达式生成位表', () => {
  const r = parseCron('*/15 0 * * 1-5')
  assert.equal(r.ok, true)
  if (!r.ok) return
  const minHits = r.fields.minutes.reduce((s, v, i) => s + (v ? 1 : 0), 0)
  assert.equal(minHits, 4) // 0,15,30,45
  assert.equal(r.fields.hours[0], true)
  assert.equal(r.fields.hours[12], false)
  assert.equal(r.fields.dows[1] && r.fields.dows[5], true)
  assert.equal(r.fields.dows[6], false)
  assert.equal(r.fields.domRestricted, false)
  assert.equal(r.fields.dowRestricted, true)
})

test('parseCron: 非法输入报错', () => {
  assert.equal(parseCron('* * * *').ok, false)
  assert.equal(parseCron('61 * * * *').ok, false)
  assert.equal(parseCron('a * * * *').ok, false)
  assert.equal(parseCron('* * * * 8').ok, false)
  assert.equal(parseCron('1-0 * * * *').ok, false)
  assert.equal(parseCron('*/0 * * * *').ok, false)
  assert.equal(parseCron('').ok, false)
})

test('cronNext: 固定时刻当天命中', () => {
  const r = parseCron('30 8 * * *')
  assert.ok(r.ok)
  assert.equal(cronNext(r.fields, at(2026, 9, 27, 0, 0)), at(2026, 9, 27, 8, 30))
})

test('cronNext: 严格晚于（整点触发后跳到次日）', () => {
  const r = parseCron('0 0 * * *')
  assert.ok(r.ok)
  assert.equal(cronNext(r.fields, at(2026, 9, 27, 0, 0)), at(2026, 9, 28, 0, 0))
})

test('cronNext: 步进分钟', () => {
  const r = parseCron('*/15 * * * *')
  assert.ok(r.ok)
  assert.equal(cronNext(r.fields, at(2026, 9, 27, 8, 7)), at(2026, 9, 27, 8, 15))
})

test('cronNext: 跨到下周的星期匹配（2026-09-27 是周日）', () => {
  const r = parseCron('0 12 * * 1')
  assert.ok(r.ok)
  assert.equal(cronNext(r.fields, at(2026, 9, 26, 20, 0)), at(2026, 9, 28, 12, 0))
})

test('cronNext: dom/dow 受限时取并集（vixie 语义）', () => {
  // 每月 13 号或每周五；2026-09-27 周日 → 最近的是 10-02（周五），13 号是周二
  const r = parseCron('0 0 13 * 5')
  assert.ok(r.ok)
  assert.equal(cronNext(r.fields, at(2026, 9, 27, 0, 0)), at(2026, 10, 2, 0, 0))
})

test('cronNext: 跨年', () => {
  const r = parseCron('0 0 1 1 *')
  assert.ok(r.ok)
  assert.equal(cronNext(r.fields, at(2026, 9, 27, 0, 0)), at(2027, 1, 1, 0, 0))
})

test('cronNext: dow=7 视为周日', () => {
  const r7 = parseCron('0 0 * * 7')
  const r0 = parseCron('0 0 * * 0')
  assert.ok(r7.ok && r0.ok)
  assert.equal(cronNext(r7.fields, at(2026, 9, 28, 0, 0)), at(2026, 10, 4, 0, 0))
  assert.equal(cronNext(r7.fields, at(2026, 9, 28, 0, 0)), cronNext(r0.fields, at(2026, 9, 28, 0, 0)))
})

test('cronNext: 列表与区间', () => {
  const r = parseCron('5,35 9-18 * * *')
  assert.ok(r.ok)
  assert.equal(cronNext(r.fields, at(2026, 9, 27, 18, 40)), at(2026, 9, 28, 9, 5))
})
