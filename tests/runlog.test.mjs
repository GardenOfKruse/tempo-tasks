import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RUNS_LOG_DIR, RUN_LOG_KEEP, buildRunLog, pruneRunLogFiles, runLogFileName } from '../dist-electron/runlog.js'

const rec = (over = {}) => ({
  id: 'r1',
  taskId: 't1',
  trigger: 'manual',
  startedAt: new Date(2026, 9, 1, 8, 30, 5).getTime(),
  endedAt: new Date(2026, 9, 1, 8, 30, 7).getTime(),
  status: 'success',
  exitCode: 0,
  durationMs: 2000,
  stdout: 'hello-tempo',
  stderr: '',
  truncated: false,
  ...over,
})

test('runLogFileName: 时间前缀 + 安全 id，目录内自然序即时间序', () => {
  const t0 = new Date(2026, 9, 1, 8, 30, 5).getTime()
  const name = runLogFileName(t0, 'abc123')
  assert.match(name, /^20261001-083005-abc123\.log$/)
  // 时间晚 → 文件名排序靠后
  const a = runLogFileName(t0, 'a')
  const b = runLogFileName(t0 + 65_000, 'b')
  assert.ok(a < b)
  // id 中混入路径非法字符时被剔除，不产生分隔符
  const safe = runLogFileName(t0, '../../evil')
  assert.match(safe, /^20261001-083005-[A-Za-z0-9_-]*\.log$/)
  assert.ok(!safe.includes('/') && !safe.includes('\\'))
  // 空 id 兜底
  assert.match(runLogFileName(t0, ''), /^20261001-083005-run\.log$/)
})

test('buildRunLog: 头部元信息 + stdout/stderr 分节，空流给出占位', () => {
  const log = buildRunLog(rec(), '每日备份')
  assert.ok(log.includes('任务：每日备份'))
  assert.ok(log.includes('任务 ID：t1'))
  assert.ok(log.includes('触发：手动'))
  assert.ok(log.includes('状态：成功'))
  assert.ok(log.includes('退出码：0'))
  assert.ok(log.includes('耗时：2000 ms'))
  assert.ok(log.includes('[stdout]\nhello-tempo'))
  assert.ok(log.includes('[stderr]\n（无内容）'))

  const fail = buildRunLog(rec({ status: 'failed', exitCode: 3, trigger: 'scheduled', stderr: 'boom', stdout: '' }), '会失败')
  assert.ok(fail.includes('状态：失败'))
  assert.ok(fail.includes('退出码：3'))
  assert.ok(fail.includes('触发：计划'))
  assert.ok(fail.includes('[stderr]\nboom'))
  assert.ok(fail.includes('[stdout]\n（无输出）'))
  // 补跑触发标签
  assert.ok(buildRunLog(rec({ trigger: 'catch-up' }), 'x').includes('触发：补跑'))
})

test('buildRunLog: 输出内容原样落盘（不截断不转义）', () => {
  const multi = 'line1\r\nline2\n<xml>&ok'
  const log = buildRunLog(rec({ stdout: multi, stderr: '中文错误' }), 'x')
  assert.ok(log.includes(multi))
  assert.ok(log.includes('中文错误'))
})

test('pruneRunLogFiles: 未超量返回空；超出保留最旧；非 .log 不参与', () => {
  assert.deepEqual(pruneRunLogFiles([]), [])
  assert.deepEqual(pruneRunLogFiles(['20261001-080000-a.log', '20261001-080001-b.log']), [])

  const files = []
  for (let i = 0; i < RUN_LOG_KEEP + 5; i++) {
    files.push(`20261001-0800${String(i).padStart(2, '0')}-${i}.log`)
  }
  const stale = pruneRunLogFiles(files)
  assert.equal(stale.length, 5)
  // 删的是字典序（即时间序）最旧的 5 个
  assert.deepEqual(stale, files.slice(0, 5))

  // 混入非日志文件：不计入数量、不会被列入删除
  const mixed = [...files.slice(0, RUN_LOG_KEEP), 'notes.txt']
  assert.deepEqual(pruneRunLogFiles(mixed), [])
})

test('RUNS_LOG_DIR / RUN_LOG_KEEP 常量导出', () => {
  assert.equal(RUNS_LOG_DIR, 'runs')
  assert.equal(RUN_LOG_KEEP, 100)
})
