import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayDiff, fmtNextTime } from '../dist-electron/timefmt.js'

// 基准：2026-09-27 是周日；全部用本地时间构造，与被测函数同一时区
const NOW = new Date(2026, 8, 27, 10, 0).getTime() // 周日 10:00
const at = (dayOffset, h, m) => new Date(2026, 8, 27 + dayOffset, h, m).getTime()

test('fmtNextTime: 今天/明天', () => {
  assert.equal(fmtNextTime(at(0, 14, 30), NOW), '今天 14:30')
  assert.equal(fmtNextTime(at(0, 23, 59), NOW), '今天 23:59')
  assert.equal(fmtNextTime(at(1, 8, 30), NOW), '明天 08:30')
})

test('fmtNextTime: 本周内用周X（2~6 天后）', () => {
  assert.equal(fmtNextTime(at(3, 9, 0), NOW), '周三 09:00') // 2026-09-30 周三
  assert.equal(fmtNextTime(at(6, 9, 0), NOW), '周六 09:00')
})

test('fmtNextTime: ≥7 天退化为 M/D HH:MM', () => {
  assert.equal(fmtNextTime(at(7, 9, 0), NOW), '10/4 09:00')
  assert.equal(fmtNextTime(at(10, 21, 5), NOW), '10/7 21:05')
})

test('fmtNextTime: 跨零点按自然日（23:50 → 次日 00:30 是明天）', () => {
  const now = new Date(2026, 8, 27, 23, 50).getTime()
  assert.equal(fmtNextTime(at(1, 0, 30), now), '明天 00:30')
})

test('dayDiff: 按本地零点取整', () => {
  assert.equal(dayDiff(at(0, 14, 30), NOW), 0)
  assert.equal(dayDiff(at(1, 0, 0), NOW), 1)
  assert.equal(dayDiff(at(0, 0, 0), NOW), 0) // 同一天凌晨
  assert.equal(dayDiff(at(-1, 23, 0), NOW), -1)
  assert.equal(dayDiff(at(7, 9, 0), NOW), 7)
})
