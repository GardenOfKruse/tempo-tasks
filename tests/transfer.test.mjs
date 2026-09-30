import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExport, parseImport, EXPORT_KIND, MAX_IMPORT_TASKS } from '../dist-electron/transfer.js'
import { validateTaskInput } from '../dist-electron/schedule.js'

function mkTask(over = {}) {
  return {
    id: 't1',
    name: '每日备份',
    runType: 'powershell',
    command: 'Get-Date',
    cwd: '',
    timeoutSec: 60,
    schedule: { kind: 'daily', time: '08:30' },
    catchUp: true,
    notify: false,
    enabled: true,
    concurrency: 'skip',
    createdAt: 1000,
    updatedAt: 2000,
    lastRunAt: 3000,
    nextRunAt: 4000,
    missedCount: 1,
    missedOnce: false,
    ...over,
  }
}

test('buildExport: 结构完整，仅含配置字段，不携带 id/历史/运行态', () => {
  const f = buildExport([mkTask()])
  assert.equal(f.app, 'tempo')
  assert.equal(f.kind, EXPORT_KIND)
  assert.equal(f.version, 1)
  assert.equal(f.exportedAt, new Date(f.exportedAt).toISOString())
  assert.equal(f.tasks.length, 1)
  const t = f.tasks[0]
  assert.deepEqual(t.schedule, { kind: 'daily', time: '08:30' })
  assert.equal(t.name, '每日备份')
  assert.equal(t.enabled, true)
  for (const k of ['id', 'createdAt', 'updatedAt', 'lastRunAt', 'nextRunAt', 'missedCount', 'missedOnce']) {
    assert.equal(k in t, false, `不应导出 ${k}`)
  }
})

test('导入/导出回环：导出文本可原样解析回相同配置', () => {
  const f = buildExport([mkTask(), mkTask({ id: 't2', name: 'x', schedule: { kind: 'cron', expr: '*/10 * * * *' } })])
  const r = parseImport(JSON.stringify(f))
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.tasks.length, 2)
  assert.deepEqual(r.tasks[0].schedule, { kind: 'daily', time: '08:30' })
  assert.deepEqual(r.tasks[1].schedule, { kind: 'cron', expr: '*/10 * * * *' })
})

test('parseImport: 合法文件逐任务通过 validateTaskInput', () => {
  const r = parseImport(
    JSON.stringify({
      app: 'tempo',
      kind: EXPORT_KIND,
      version: 1,
      exportedAt: '2026-10-01T00:00:00Z',
      tasks: [{ name: ' 清理日志 ', runType: 'cmd', command: 'del /q log', schedule: { kind: 'daily', time: '23:50' } }],
    }),
  )
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.tasks[0].name, '清理日志')
  assert.equal(r.tasks[0].timeoutSec, 60) // 默认值补齐
  assert.equal(validateTaskInput(r.tasks[0]).ok, true)
})

test('parseImport: 坏 JSON / 非对象 / 缺 kind / 缺任务列表 / 空列表', () => {
  assert.equal(parseImport('{oops').error, '文件不是有效的 JSON')
  assert.equal(parseImport('[]').error, '文件格式不正确')
  assert.equal(parseImport(JSON.stringify({ kind: 'other-export', tasks: [] })).error, '不是 Tempo 任务导出文件')
  assert.equal(parseImport(JSON.stringify({ kind: EXPORT_KIND })).error, '文件中缺少任务列表')
  assert.equal(parseImport(JSON.stringify({ kind: EXPORT_KIND, tasks: [] })).error, '文件中没有任务')
})

test('parseImport: 缺 schedule / 非对象条目不抛错，报序号', () => {
  const noSched = parseImport(JSON.stringify({ kind: EXPORT_KIND, tasks: [{ name: 'x', runType: 'cmd', command: 'a' }] }))
  assert.equal(noSched.ok, false)
  assert.match(noSched.error, /第 1 个任务无效/)
  const notObj = parseImport(JSON.stringify({ kind: EXPORT_KIND, tasks: ['x'] }))
  assert.equal(notObj.ok, false)
  assert.match(notObj.error, /第 1 个任务无效/)
})

test('parseImport: 第 N 个任务无效时报出序号与原因', () => {
  const r = parseImport(
    JSON.stringify({
      kind: EXPORT_KIND,
      tasks: [
        { name: '好的', runType: 'cmd', command: 'echo ok', schedule: { kind: 'daily', time: '08:00' } },
        { name: '坏的', runType: 'cmd', command: 'echo bad', schedule: { kind: 'cron', expr: '99 * * * *' } },
      ],
    }),
  )
  assert.equal(r.ok, false)
  assert.match(r.error, /第 2 个任务无效/)
  assert.match(r.error, /Cron/)
})

test('parseImport: 超过单次导入上限拒绝', () => {
  const tasks = Array.from({ length: MAX_IMPORT_TASKS + 1 }, (_, i) => ({ name: `t${i}`, runType: 'cmd', command: 'echo x' }))
  const r = parseImport(JSON.stringify({ kind: EXPORT_KIND, tasks }))
  assert.equal(r.ok, false)
  assert.match(r.error, /最多/)
})
