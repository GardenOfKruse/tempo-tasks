import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchRunFilter, filterRuns, isFailStatus, displayClock, summarizeRuns, pushMark, shiftMarks, rebuildMerged, MAX_MARKS } from '../dist-electron/runs.js'

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

test('summarizeRuns: 窗口边界含起点，早于 sinceMs 的不计', () => {
  const mk = (startedAt, status, durationMs = 100) => ({ ...run(status), startedAt, durationMs })
  const since = 1_000_000
  const s = summarizeRuns([mk(since - 1, 'success'), mk(since, 'success'), mk(since + 5, 'failed')], since)
  assert.equal(s.total, 2)
  assert.equal(s.success, 1)
  assert.equal(s.successRate, 50)
})

test('summarizeRuns: 成功率不含运行中，canceled 计入分母', () => {
  const mk = (status, durationMs = 100) => ({ ...run(status), startedAt: 0, durationMs })
  // success + canceled + running：decided = 2，成功率 50%；触发次数 3
  const s = summarizeRuns([mk('success'), mk('canceled'), mk('running', null)], 0)
  assert.equal(s.total, 3)
  assert.equal(s.success, 1)
  assert.equal(s.successRate, 50)
  // 全部仍在运行：成功次数为 0，无已完成 → 成功率 null
  const onlyRunning = summarizeRuns([mk('running', null), mk('running', null)], 0)
  assert.equal(onlyRunning.total, 2)
  assert.equal(onlyRunning.success, 0)
  assert.equal(onlyRunning.successRate, null)
})

test('summarizeRuns: 平均耗时只统计已结束且有时长的记录，四舍五入取整', () => {
  const mk = (status, durationMs) => ({ ...run(status), startedAt: 0, durationMs })
  const s = summarizeRuns([mk('success', 100), mk('failed', 201), mk('running', null)], 0)
  assert.equal(s.avgDurationMs, 151) // (100 + 201) / 2 = 150.5 → 151（四舍五入）
  // durationMs 缺失（异常数据）不参与平均
  assert.equal(summarizeRuns([mk('success', null)], 0).avgDurationMs, null)
})

test('summarizeRuns: 空窗口返回全零与 null（详情页显示暂无执行）', () => {
  const s = summarizeRuns([], 0)
  assert.deepEqual(s, { total: 0, success: 0, successRate: null, avgDurationMs: null })
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

/* ---------- 合并输出视图：交错游标与重建 ---------- */

/** 模拟执行器：按事件序列推进两流并记录游标（与 executor.ts 的接线方式一致） */
function simulate(events) {
  let stdout = ''
  let stderr = ''
  const marks = []
  const mark = () => marks.push([stdout.length, stderr.length])
  for (const ev of events) {
    if (ev.out !== undefined) stdout += ev.out
    if (ev.err !== undefined) stderr += ev.err
    mark()
  }
  return { stdout, stderr, marks }
}

const segsText = (segs, s) =>
  segs
    .filter((sg) => sg.s === s)
    .map((sg) => sg.t)
    .join('')

test('rebuildMerged: 无 marks 的旧记录回退为「输出后跟全部错误」', () => {
  assert.deepEqual(rebuildMerged(undefined, 'out', 'err'), [
    { s: 0, t: 'out' },
    { s: 1, t: 'err' },
  ])
  // 空流不产生段落
  assert.deepEqual(rebuildMerged(undefined, '', ''), [])
  assert.deepEqual(rebuildMerged([], 'only-out', ''), [{ s: 0, t: 'only-out' }])
})

test('rebuildMerged: 交错顺序与事件序列一致，流内拼接与 tab 视图严格同源', () => {
  const { stdout, stderr, marks } = simulate([
    { out: 'step1\n' },
    { err: 'warn: slow\n' },
    { out: 'step2\n' },
    { err: 'warn2\n' },
    { out: 'done\n' },
  ])
  const segs = rebuildMerged(marks, stdout, stderr)
  assert.deepEqual(segs.map((s) => [s.s, s.t]), [
    [0, 'step1\n'],
    [1, 'warn: slow\n'],
    [0, 'step2\n'],
    [1, 'warn2\n'],
    [0, 'done\n'],
  ])
  // 每个流拼接回原文：与「输出/错误」两个 tab 的内容一致（状态可信）
  assert.equal(segsText(segs, 0), stdout)
  assert.equal(segsText(segs, 1), stderr)
})

test('rebuildMerged: 单流纯输出、空拍与首拍前缀都不产生空段落', () => {
  const { stdout, stderr, marks } = simulate([{ out: 'a' }, { out: 'b' }, { err: 'e' }])
  // 空记录：全空流 + 空拍
  assert.deepEqual(rebuildMerged([[0, 0]], '', ''), [])
  assert.equal(segsText(rebuildMerged(marks, stdout, stderr), 0), 'ab')
  // 头部预置文本（如 Bash 转换提示）计入第一拍：marks [5,0] → [10,3]
  const segs2 = rebuildMerged(
    [
      [5, 0],
      [10, 3],
    ],
    'helloworld',
    'abc',
  )
  assert.deepEqual(segs2.map((s) => [s.s, s.t]), [
    [0, 'hello'],
    [0, 'world'],
    [1, 'abc'],
  ])
})

test('rebuildMerged: 尾部截断后游标平移，重建与最终文本一致且不重复发射', () => {
  // 模拟 close 时 truncate：40000 字符 → 11 字符标记 + 32000 尾部
  const big = 'x'.repeat(40_000)
  const truncated = `…[前段输出已截断]\n${big.slice(-32_000)}`
  const marks = [
    [1000, 0],
    [40_000, 7],
  ]
  shiftMarks(marks, big.length - truncated.length, 0)
  marks.push([truncated.length, 7])
  const segs = rebuildMerged(marks, truncated, 'err-line')
  assert.equal(segsText(segs, 0), truncated) // 不重复、不少发
  assert.ok(truncated.startsWith('…[前段输出已截断]'))
  // 平移前游标被钳到 0：不产生负游标
  assert.ok(marks.every(([o]) => o >= 0))
})

test('rebuildMerged: 运行中流首被静默丢弃时只推进游标不重复发射', () => {
  // 先发 1000 字符，头部丢 400，再追加 10
  const final = 'y'.repeat(610)
  const marks = []
  marks.push([1000, 0]) // 丢弃前
  shiftMarks(marks, 400, 0) // 流首被丢
  marks.push([600, 0])
  marks.push([610, 0])
  const segs = rebuildMerged(marks, final, '')
  assert.equal(segsText(segs, 0), final) // 输出拼接仍等于最终文本（无重复）
})

test('pushMark/shiftMarks: marks 封顶丢弃最早一半，最近事件保留', () => {
  const marks = []
  let out = ''
  for (let i = 0; i < MAX_MARKS + 50; i++) {
    out += 'z'.repeat(10)
    pushMark(marks, out, '')
  }
  assert.ok(marks.length <= MAX_MARKS, `封顶后长度 ${marks.length} 应 ≤ ${MAX_MARKS}`)
  // 最后一拍与当前流长度一致（游标不因截断历史而失真）
  assert.equal(marks.at(-1)[0], out.length)
  // 封顶后仍可重建：流内拼接 = 最终文本
  const segs = rebuildMerged(marks, out, '')
  assert.equal(segsText(segs, 0), out)
})

test('pushMark: 原地追加并返回同一数组（执行器接线无额外分配）', () => {
  const marks = []
  const ret = pushMark(marks, 'ab', 'c')
  assert.equal(ret, marks)
  assert.deepEqual(marks, [[2, 1]])
})
