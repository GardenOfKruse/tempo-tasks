import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Store, localDateStr, backupFileNameFor, parseBackupDate, staleBackups, BACKUP_KEEP_DAYS } from '../dist-electron/storage.js'

test('每日备份纯函数：localDateStr / backupFileNameFor / parseBackupDate', () => {
  assert.equal(localDateStr(new Date(2026, 0, 5, 8, 30)), '2026-01-05')
  assert.equal(localDateStr(new Date(2026, 10, 23)), '2026-11-23')
  assert.equal(backupFileNameFor('2026-05-01'), 'tempo-2026-05-01.json')
  assert.equal(parseBackupDate('tempo-2026-05-01.json'), '2026-05-01')
  assert.equal(parseBackupDate('tempo.json'), null)
  assert.equal(parseBackupDate('tempo-2026-5-1.json'), null)
  assert.equal(parseBackupDate('tempo-2026-05-01.json.bak'), null)
  assert.equal(parseBackupDate('notes.txt'), null)
})

test('每日备份纯函数：staleBackups 只清理 7 天前、不碰当天/近期/外来文件', () => {
  const today = '2026-06-15'
  const files = [
    'tempo-2026-06-15.json', // 今天：保留
    'tempo-2026-06-14.json', // 昨天：保留
    'tempo-2026-06-09.json', // 6 天前：保留（边界内）
    'tempo-2026-06-08.json', // 7 天前：删
    'tempo-2026-06-01.json', // 更早：删
    'tempo-2020-01-01.json', // 很久以前：删
    'tempo-2026-06-20.json', // 未来日期：保留（不做多余动作）
    'notes.txt', // 外来文件：不动
    'tempo.json', // 非备份命名：不动
  ]
  // 边界核对：今天 − 7 天 = 2026-06-08，严格早于它的才删
  assert.deepEqual(staleBackups(today, files).sort(), ['tempo-2026-06-08.json', 'tempo-2026-06-01.json', 'tempo-2020-01-01.json'].sort())
  assert.deepEqual(staleBackups(today, []), [])
  // 跨月/跨年运算正确
  assert.deepEqual(staleBackups('2026-03-03', ['tempo-2026-02-24.json', 'tempo-2026-02-25.json']), ['tempo-2026-02-24.json'])
  assert.deepEqual(staleBackups('2026-01-05', ['tempo-2025-12-29.json', 'tempo-2025-12-30.json']), ['tempo-2025-12-29.json'])
  assert.equal(BACKUP_KEEP_DAYS, 7)
})

test('每日备份轮转：saveNow 落地当天快照、同日不重复、清理旧备份、外来文件保留', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tempo-backup-'))
  try {
    const backupDir = path.join(dir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    // 预置过期备份与外来文件
    writeFileSync(path.join(backupDir, 'tempo-2020-01-01.json'), '{"old":true}', 'utf-8')
    writeFileSync(path.join(backupDir, 'notes.txt'), 'keep me', 'utf-8')

    const store = new Store(dir)
    store.mutate((d) => d.tasks.push(makeTask('t1', '备份演练')))
    assert.equal(store.saveNow(), null)

    const today = localDateStr(new Date())
    const snap = path.join(backupDir, `tempo-${today}.json`)
    // 快照存在且内容与 tempo.json 一致
    assert.equal(existsSync(snap), true, '当天快照应生成')
    assert.deepEqual(JSON.parse(readFileSync(snap, 'utf-8')), JSON.parse(readFileSync(path.join(dir, 'tempo.json'), 'utf-8')))
    assert.equal(JSON.parse(readFileSync(snap, 'utf-8')).tasks[0].name, '备份演练')
    // 过期备份被清理，外来文件保留
    assert.equal(existsSync(path.join(backupDir, 'tempo-2020-01-01.json')), false)
    assert.equal(existsSync(path.join(backupDir, 'notes.txt')), true)
    // 同日再次保存：不新增、不重复
    store.mutate((d) => d.tasks.push(makeTask('t2', '第二次')))
    assert.equal(store.saveNow(), null)
    assert.deepEqual(readdirSync(backupDir).sort(), ['notes.txt', `tempo-${today}.json`])
    store.destroy()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('每日备份轮转：新目录首次保存即产生备份，快照内容完整可解析', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tempo-backup2-'))
  try {
    const store = new Store(dir)
    store.mutate((d) => d.tasks.push(makeTask('a1', '存活')))
    assert.equal(store.saveNow(), null)
    const today = localDateStr(new Date())
    const snap = path.join(dir, 'backups', `tempo-${today}.json`)
    assert.equal(existsSync(snap), true)
    const parsed = JSON.parse(readFileSync(snap, 'utf-8'))
    assert.equal(parsed.schemaVersion, 1)
    assert.equal(parsed.tasks.length, 1)
    assert.equal(parsed.tasks[0].name, '存活')
    assert.equal(parsed.tasks[0].pinned, false)
    // 重新加载主库：数据 round-trip 完整
    const store2 = new Store(dir)
    assert.equal(store2.snapshot.tasks.length, 1)
    assert.equal(store2.snapshot.tasks[0].name, '存活')
    store2.destroy()
    store.destroy()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTask(id, name) {
  const now = Date.now()
  return {
    id,
    name,
    runType: 'cmd',
    command: 'echo hi',
    cwd: '',
    timeoutSec: 60,
    schedule: { kind: 'daily', time: '08:00' },
    catchUp: true,
    notify: false,
    enabled: true,
    pinned: false,
    concurrency: 'skip',
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt: null,
    missedCount: 0,
    missedOnce: false,
  }
}
