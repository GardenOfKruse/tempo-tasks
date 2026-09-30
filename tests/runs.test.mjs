import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchRunFilter, filterRuns, isFailStatus, displayClock } from '../dist-electron/runs.js'

const run = (status) => ({ id: 'r', taskId: 't', trigger: 'manual', startedAt: 0, endedAt: 1, status, exitCode: 0, durationMs: 1, stdout: '', stderr: '', truncated: false })

test('matchRunFilter: 成功/失败(含超时)/全部 三档口径', () => {
  assert.equal(matchRunFilter(run('success'), 'ok'), true)
  assert.equal(matchRunFilter(run('failed'), 'ok'), false)
  assert.equal(matchRunFilter(run('canceled'), 'ok'), false)

  assert.equal(matchRunFilter(run('failed'), 'fail'), true)
  assert.equal(matchRunFilter(run('timeout'), 'fail'), true)
  assert.equal(matchRunFilter(run('success'), 'fail'), false)
  assert.equal(matchRunFilter(run('canceled'), 'fail'), false)

  for (const s of ['running', 'success', 'failed', 'timeout', 'canceled']) {
    assert.equal(matchRunFilter(run(s), 'all'), true)
  }
})

test('filterRuns: 保持顺序与原数组不变', () => {
  const list = [run('success'), run('failed'), run('timeout'), run('canceled')]
  const out = filterRuns(list, 'fail')
  assert.deepEqual(out.map((r) => r.status), ['failed', 'timeout'])
  assert.equal(list.length, 4)
  assert.equal(filterRuns(list, 'all'), list)
})

test('isFailStatus: 与卡片失败徽标同口径', () => {
  assert.equal(isFailStatus('failed'), true)
  assert.equal(isFailStatus('timeout'), true)
  assert.equal(isFailStatus('success'), false)
  assert.equal(isFailStatus('canceled'), false)
  assert.equal(isFailStatus('running'), false)
})

test('displayClock: 运行中/刚结束/最后一分钟内为秒级原值', () => {
  const now = 1_000_000_000
  assert.equal(displayClock({ nextRunAt: now + 3600_000, lastRunAt: null, running: true, now }), now)
  // 2 分钟前刚结束：秒级保鲜（相对时间「刚刚 / N 秒前」）；恰满 2 分钟则降为分钟桶
  assert.equal(displayClock({ nextRunAt: now + 3600_000, lastRunAt: now - 119_000, running: false, now }), now)
  assert.equal(displayClock({ nextRunAt: now + 3600_000, lastRunAt: now - 120_000, running: false, now }), 999_990_000)
  // 倒计时进入最后一分钟：秒级倒数
  assert.equal(displayClock({ nextRunAt: now + 30_000, lastRunAt: null, running: false, now }), now)
})

test('displayClock: 一小时内 15 秒桶，更远/无排程 1 分钟桶', () => {
  const now = 1_000_012_345
  const q15 = Math.floor(now / 15_000) * 15_000
  const q60 = Math.floor(now / 60_000) * 60_000
  assert.equal(displayClock({ nextRunAt: now + 600_000, lastRunAt: null, running: false, now }), q15)
  assert.equal(displayClock({ nextRunAt: now + 3 * 3600_000, lastRunAt: null, running: false, now }), q60)
  assert.equal(displayClock({ nextRunAt: null, lastRunAt: null, running: false, now }), q60)
  // 桶值不超过 now（文案不会超前于真实时间）
  assert.ok(q15 <= now && q60 <= now)
})

test('displayClock: 100 卡逐秒场景量化对比（重渲染量降幅 > 90%）', () => {
  const t0 = 1_760_000_000_000
  // 100 张卡片：下次执行从 30 秒到 7 天均匀铺开（远期为主），上次运行均在 10 分钟前
  const cards = []
  for (let i = 0; i < 100; i++) {
    cards.push({
      nextRunAt: t0 + 30_000 + i * (7 * 86_400_000 - 30_000) / 99,
      lastRunAt: t0 - 600_000,
    })
  }
  const ticks = 60 // 模拟 1 秒一跳、持续 1 分钟
  let rawRenders = 0
  let quantizedRenders = 0
  for (let s = 0; s < ticks; s++) {
    const now = t0 + s * 1000
    rawRenders += cards.length // 旧行为：每卡每秒都拿到新 now
    for (const c of cards) {
      const q = displayClock({ nextRunAt: c.nextRunAt, lastRunAt: c.lastRunAt, running: false, now })
      if (s === 0 || q !== displayClock({ nextRunAt: c.nextRunAt, lastRunAt: c.lastRunAt, running: false, now: now - 1000 })) quantizedRenders++
    }
  }
  assert.ok(rawRenders === 6000)
  assert.ok(quantizedRenders < rawRenders * 0.1, `量化后 ${quantizedRenders} 应 < 600（实际卡片倒计时文案不受影响）`)
})
