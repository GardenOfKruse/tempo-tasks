import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Store } from '../dist-electron/storage.js'

function mkDir() {
  return mkdtempSync(path.join(tmpdir(), 'tempo-corrupt-'))
}

const validTask = {
  id: 't1', name: '任务一', runType: 'cmd', command: 'echo hi', cwd: '', timeoutSec: 60,
  schedule: { kind: 'daily', time: '08:30' }, catchUp: true, notify: false, enabled: true,
  concurrency: 'skip', pinned: false, createdAt: Date.now(), updatedAt: Date.now(),
  lastRunAt: null, nextRunAt: null, missedCount: 0, missedOnce: false,
}

test('恢复：tempo.json 损坏时从 .bak 恢复任务', () => {
  const dir = mkDir()
  const s1 = new Store(dir)
  // 两次写入：第一次产生主文件，第二次把第一份复制为 .bak
  s1.mutate((d) => d.tasks.push(validTask))
  s1.flush()
  s1.mutate((d) => { d.tasks[0].name = '任务一改名' })
  s1.flush()
  assert.ok(existsSync(path.join(dir, 'tempo.json.bak')), '第二次保存应产生 .bak')
  s1.destroy()

  // 主文件损坏（写入半截 JSON）
  writeFileSync(path.join(dir, 'tempo.json'), '{"schemaVersion":1,"tasks":[{"id":"broken"')

  const s2 = new Store(dir)
  assert.equal(s2.snapshot.tasks.length, 1, '从 .bak 恢复出任务')
  assert.equal(s2.snapshot.tasks[0].name, '任务一改名')
  s2.destroy()
  rmSync(dir, { recursive: true, force: true })
})

test('恢复：主文件与 .bak 都损坏 → 从 backups/ 每日快照恢复（第三层）', () => {
  const dir = mkDir()
  const s1 = new Store(dir)
  s1.mutate((d) => d.tasks.push(validTask))
  s1.flush() // 产生主文件 + backups/ 当日快照
  s1.destroy()

  // 主文件与 .bak 全部损坏
  writeFileSync(path.join(dir, 'tempo.json'), 'broken{{{')
  writeFileSync(path.join(dir, 'tempo.json.bak'), 'also-broken')

  const s2 = new Store(dir)
  assert.equal(s2.snapshot.tasks.length, 1, '从每日快照恢复出任务')
  assert.equal(s2.snapshot.tasks[0].name, '任务一改名')
  s2.destroy()
  rmSync(dir, { recursive: true, force: true })
})

test('恢复：主文件与 .bak 都损坏且无 backups → 空启动不崩溃', () => {
  const dir = mkDir()
  writeFileSync(path.join(dir, 'tempo.json'), 'not-json-at-all{{{')
  writeFileSync(path.join(dir, 'tempo.json.bak'), ']]]also bad')
  const s = new Store(dir)
  assert.equal(s.snapshot.tasks.length, 0)
  s.mutate((d) => d.tasks.push(validTask))
  s.flush()
  assert.ok(existsSync(path.join(dir, 'tempo.json')))
  s.destroy()
  rmSync(dir, { recursive: true, force: true })
})

test('原子性：快速连续 mutate 不产生损坏文件', () => {
  const dir = mkDir()
  const s = new Store(dir)
  for (let i = 0; i < 20; i++) {
    s.mutate((d) => d.tasks.push({ ...validTask, id: 't' + i, name: '任务' + i }))
  }
  s.flush()
  const raw = JSON.parse(readFileSync(path.join(dir, 'tempo.json'), 'utf-8'))
  assert.equal(raw.tasks.length, 20)
  s.destroy()
  rmSync(dir, { recursive: true, force: true })
})

