import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Store } from '../dist-electron/storage.js'

test('存储迁移：旧 interval.minutes 自动转为 interval.seconds', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tempo-mig-'))
  const old = {
    schemaVersion: 1,
    tasks: [
      {
        id: 't1',
        name: '旧任务',
        runType: 'cmd',
        command: 'echo hi',
        cwd: '',
        timeoutSec: 60,
        schedule: { kind: 'interval', minutes: 15 },
        catchUp: true,
        notify: false,
        enabled: true,
        concurrency: 'skip',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRunAt: null,
        nextRunAt: null,
        missedCount: 0,
        missedOnce: false,
      },
    ],
    runs: { t1: [] },
    settings: { theme: 'system', sortMode: 'created' },
  }
  writeFileSync(path.join(dir, 'tempo.json'), JSON.stringify(old))
  const store = new Store(dir)
  const t = store.snapshot.tasks[0]
  assert.equal(t.schedule.kind, 'interval')
  assert.equal(t.schedule.seconds, 900)
  // 旧数据无 pinned 字段：补默认值 false（v0.5 置顶）
  assert.equal(t.pinned, false)
  // 旧数据无 minimizeToTray：补默认值 false（关窗即退出）
  assert.equal(store.snapshot.settings.minimizeToTray, false)
  store.destroy()
  rmSync(dir, { recursive: true, force: true })
})

test('存储迁移：pinned=true 持久化往返不丢失', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tempo-pin-'))
  const data = {
    schemaVersion: 1,
    tasks: [
      {
        id: 'p1',
        name: '置顶任务',
        runType: 'cmd',
        command: 'echo hi',
        cwd: '',
        timeoutSec: 60,
        schedule: { kind: 'daily', time: '08:00' },
        catchUp: true,
        notify: false,
        enabled: true,
        pinned: true,
        concurrency: 'skip',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRunAt: null,
        nextRunAt: null,
        missedCount: 0,
        missedOnce: false,
      },
    ],
    runs: {},
    settings: { theme: 'system', sortMode: 'created' },
  }
  writeFileSync(path.join(dir, 'tempo.json'), JSON.stringify(data))
  const store = new Store(dir)
  assert.equal(store.snapshot.tasks[0].pinned, true)
  // 落盘再读回仍为 true
  assert.equal(store.saveNow(), null)
  const store2 = new Store(dir)
  assert.equal(store2.snapshot.tasks[0].pinned, true)
  store2.destroy()
  store.destroy()
  rmSync(dir, { recursive: true, force: true })
})

test('clearRuns: 清空指定任务历史，其他任务不受影响；重复清空安全', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tempo-clear-'))
  const store = new Store(dir)
  const rec = (id, taskId) => ({ id, taskId, trigger: 'manual', startedAt: 1, endedAt: 2, status: 'success', exitCode: 0, durationMs: 1, stdout: '', stderr: '', truncated: false })
  store.appendRun(rec('r1', 'a'))
  store.appendRun(rec('r2', 'a'))
  store.appendRun(rec('r3', 'b'))
  store.clearRuns('a')
  assert.deepEqual(store.runsOf('a'), [])
  assert.equal(store.runsOf('b').length, 1)
  store.clearRuns('a') // 已为空：无副作用不抛错
  store.clearRuns('missing')
  assert.equal(store.runsOf('b').length, 1)
  store.destroy()
  rmSync(dir, { recursive: true, force: true })
})
