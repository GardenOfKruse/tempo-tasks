import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRunAt, parseHM, parseOnceAt, formatSchedule, validateTaskInput, validateSchedule } from '../dist-electron/schedule.js'

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
const ymd = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

test('once: 未来时间返回该时刻，过去时间返回 null', () => {
  const s = { kind: 'once', at: ymd(at(2026, 9, 27, 10, 0)) }
  assert.equal(nextRunAt(s, at(2026, 9, 27, 0, 0)), at(2026, 9, 27, 10, 0))
  assert.equal(nextRunAt(s, at(2026, 9, 27, 10, 0)), null)
  assert.equal(nextRunAt(s, at(2026, 9, 28, 0, 0)), null)
})

test('once: 无效字符串', () => {
  assert.equal(parseOnceAt('2026-13-01T00:00'), null)
  assert.equal(parseOnceAt('2026-02-30T00:00'), null)
  assert.equal(parseOnceAt('abc'), null)
})

test('interval: after + N 秒（分钟/小时/天折算）', () => {
  assert.equal(nextRunAt({ kind: 'interval', seconds: 300 }, at(2026, 9, 27, 8, 0)), at(2026, 9, 27, 8, 5))
  assert.equal(nextRunAt({ kind: 'interval', seconds: 5400 }, at(2026, 9, 27, 8, 0)), at(2026, 9, 27, 9, 30))
  assert.equal(nextRunAt({ kind: 'interval', seconds: 45 }, at(2026, 9, 27, 8, 0) + 10_000), at(2026, 9, 27, 8, 0) + 55_000)
  assert.equal(nextRunAt({ kind: 'interval', seconds: 86400 }, at(2026, 9, 27, 8, 0)), at(2026, 9, 28, 8, 0))
})

test('daily: 恰好等于触发点时顺延到明天', () => {
  const s = { kind: 'daily', time: '08:30' }
  assert.equal(nextRunAt(s, at(2026, 9, 27, 8, 29)), at(2026, 9, 27, 8, 30))
  assert.equal(nextRunAt(s, at(2026, 9, 27, 8, 30)), at(2026, 9, 28, 8, 30))
})

test('weekly: 就近星期匹配', () => {
  const mon = { kind: 'weekly', days: [1], time: '09:00' }
  // 2026-09-26 是周六 → 下一个周一是 09-28
  assert.equal(nextRunAt(mon, at(2026, 9, 26, 10, 0)), at(2026, 9, 28, 9, 0))

  const multi = { kind: 'weekly', days: [0, 3], time: '20:00' } // 周日、周三
  // 周六 09-26 → 最近的是周日 09-27
  assert.equal(nextRunAt(multi, at(2026, 9, 26, 10, 0)), at(2026, 9, 27, 20, 0))

  const all = { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '07:00' }
  assert.equal(nextRunAt(all, at(2026, 9, 26, 8, 0)), at(2026, 9, 27, 7, 0))

  assert.equal(nextRunAt({ kind: 'weekly', days: [], time: '07:00' }, at(2026, 9, 26)), null)
})

test('cron: 委托到 cronNext', () => {
  assert.equal(nextRunAt({ kind: 'cron', expr: '30 8 * * *' }, at(2026, 9, 27, 0, 0)), at(2026, 9, 27, 8, 30))
  assert.equal(nextRunAt({ kind: 'cron', expr: 'bad' }, at(2026, 9, 27, 0, 0)), null)
})

test('parseHM: 边界', () => {
  assert.deepEqual(parseHM('08:30'), { h: 8, m: 30 })
  assert.deepEqual(parseHM('0:00'), { h: 0, m: 0 })
  assert.equal(parseHM('24:00'), null)
  assert.equal(parseHM('12:60'), null)
  assert.equal(parseHM('abc'), null)
})

test('validateSchedule: 各类型校验', () => {
  assert.equal(validateSchedule({ kind: 'interval', seconds: 0 }), '间隔至少 5 秒')
  assert.equal(validateSchedule({ kind: 'interval', seconds: 2.5 }), '间隔需为整数秒')
  assert.equal(validateSchedule({ kind: 'interval', seconds: 30 }), null)
  assert.equal(validateSchedule({ kind: 'interval', seconds: 86400 }), null)
  assert.equal(validateSchedule({ kind: 'daily', time: '99:00' }), '时间无效')
  assert.equal(validateSchedule({ kind: 'weekly', days: [], time: '08:00' }), '至少选择一个星期')
  assert.match(validateSchedule({ kind: 'cron', expr: '* * * *' }) ?? '', /Cron/)
  assert.equal(validateSchedule({ kind: 'once', at: ymd(at(2026, 9, 27, 9, 0)) }), null)
})

test('validateTaskInput: 默认值与错误', () => {
  const ok = validateTaskInput({
    name: ' 抓取数据 ',
    runType: 'powershell',
    command: 'Get-Date',
    schedule: { kind: 'daily', time: '08:30' },
  })
  assert.ok(ok.ok)
  if (ok.ok) {
    assert.equal(ok.value.name, '抓取数据')
    assert.equal(ok.value.catchUp, true)
    assert.equal(ok.value.concurrency, 'skip')
    assert.equal(ok.value.timeoutSec, 60)
    assert.equal(ok.value.enabled, true)
  }

  assert.match(validateTaskInput({ name: '', runType: 'cmd', command: 'a', schedule: { kind: 'daily', time: '08:00' } }).error, /名称/)
  assert.match(validateTaskInput({ name: 'x', runType: 'cmd', command: '  ', schedule: { kind: 'daily', time: '08:00' } }).error, /命令/)
  assert.match(validateTaskInput({ name: 'x', runType: 'cmd', command: 'a', schedule: { kind: 'daily', time: 'xx' } }).error, /时间/)

  const timeout = validateTaskInput({ name: 'x', runType: 'cmd', command: 'a', schedule: { kind: 'daily', time: '08:00' }, timeoutSec: -5 })
  assert.ok(timeout.ok)
  if (timeout.ok) assert.equal(timeout.value.timeoutSec, 60)
})

test('formatSchedule: 中文摘要', () => {
  assert.match(formatSchedule({ kind: 'daily', time: '08:30' }), /每天 08:30/)
  assert.match(formatSchedule({ kind: 'interval', seconds: 300 }), /每 5 分钟/)
  assert.match(formatSchedule({ kind: 'interval', seconds: 7200 }), /每 2 小时/)
  assert.match(formatSchedule({ kind: 'interval', seconds: 45 }), /每 45 秒/)
  assert.match(formatSchedule({ kind: 'interval', seconds: 172800 }), /每 2 天/)
  assert.match(formatSchedule({ kind: 'interval', seconds: 90 }), /每 1 分 30 秒/)
  assert.match(formatSchedule({ kind: 'weekly', days: [1, 3], time: '09:00' }), /周一、周三 09:00/)
  assert.match(formatSchedule({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' }), /每天/)
  assert.match(formatSchedule({ kind: 'cron', expr: '*/5 * * * *' }), /Cron/)
  assert.match(formatSchedule({ kind: 'once', at: ymd(at(2026, 9, 27, 9, 0)) }), /9 月 27 日 09:00/)
})
