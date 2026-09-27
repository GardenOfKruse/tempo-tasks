/** 向数据目录写入安全的演示任务与历史（用于截图与演示） */
import { writeFileSync, mkdirSync } from 'node:fs'
import * as path from 'node:path'

const MIN = 60_000
const HOUR = 3600_000
const DAY = 24 * HOUR

export function seedRunning(dataDir, opts = {}) {
  const theme = opts.theme ?? 'system'
  const now = Date.now()

  const tasks = [
    {
      id: 'demo-clock',
      name: '本地时钟快照',
      runType: 'cmd',
      command: 'echo %DATE% %TIME%',
      cwd: '',
      timeoutSec: 30,
      schedule: { kind: 'daily', time: '08:30' },
      catchUp: true,
      notify: false,
      enabled: true,
      concurrency: 'skip',
      createdAt: now - 6 * DAY,
      updatedAt: now - 6 * DAY,
      lastRunAt: now - 14 * HOUR,
      nextRunAt: now + 5 * HOUR,
      missedCount: 0,
      missedOnce: false,
    },
    {
      id: 'demo-live',
      name: '网络连通性巡检',
      runType: 'cmd',
      command: 'ping -n 14 127.0.0.1 > nul & echo 巡检完成',
      cwd: '',
      timeoutSec: 60,
      schedule: { kind: 'interval', seconds: 600 },
      catchUp: true,
      notify: false,
      enabled: true,
      concurrency: 'skip',
      createdAt: now - 3 * DAY,
      updatedAt: now - 3 * DAY,
      lastRunAt: now - 10 * MIN,
      nextRunAt: now + 2000,
      missedCount: 0,
      missedOnce: false,
    },
    {
      id: 'demo-disk',
      name: '磁盘剩余空间报告',
      runType: 'powershell',
      command: "Get-PSDrive C | ForEach-Object { \"已用 $([math]::Round($_.Used/1GB,1)) GB / 剩余 $([math]::Round($_.Free/1GB,1)) GB\" }",
      cwd: '',
      timeoutSec: 60,
      schedule: { kind: 'weekly', days: [1, 3, 5], time: '09:30' },
      catchUp: false,
      notify: true,
      enabled: true,
      concurrency: 'skip',
      createdAt: now - 9 * DAY,
      updatedAt: now - 9 * DAY,
      lastRunAt: now - 2 * DAY,
      nextRunAt: now + 2 * DAY,
      missedCount: 0,
      missedOnce: false,
    },
    {
      id: 'demo-fail',
      name: '失败示例：退出码 2',
      runType: 'cmd',
      command: 'echo 模拟一个失败任务 & exit /b 2',
      cwd: '',
      timeoutSec: 30,
      schedule: { kind: 'cron', expr: '0 22 * * *' },
      catchUp: false,
      notify: true,
      enabled: true,
      concurrency: 'skip',
      createdAt: now - 2 * DAY,
      updatedAt: now - 2 * DAY,
      lastRunAt: now - 26 * MIN,
      nextRunAt: now + 3 * HOUR,
      missedCount: 0,
      missedOnce: false,
    },
    {
      id: 'demo-paused',
      name: '旧数据归档',
      runType: 'cmd',
      command: 'robocopy "%USERPROFILE%\\Documents\\archive" "D:\\backup" /MIR',
      cwd: '',
      timeoutSec: 600,
      schedule: { kind: 'weekly', days: [0], time: '03:00' },
      catchUp: false,
      notify: false,
      enabled: false,
      concurrency: 'skip',
      createdAt: now - 20 * DAY,
      updatedAt: now - 4 * DAY,
      lastRunAt: now - 8 * DAY,
      nextRunAt: null,
      missedCount: 0,
      missedOnce: false,
    },
  ]

  const run = (taskId, trigger, status, startedAt, durationMs, exitCode, stdout, stderr) => ({
    id: `r-${taskId}-${startedAt}`,
    taskId,
    trigger,
    startedAt,
    endedAt: startedAt + durationMs,
    status,
    exitCode,
    durationMs,
    stdout: stdout ?? '',
    stderr: stderr ?? '',
    truncated: false,
  })

  const runs = {
    'demo-clock': [
      run('demo-clock', 'scheduled', 'success', now - 14 * HOUR, 62, 0, '2026-09-26 周五 18:30:00.12\r\n'),
      run('demo-clock', 'scheduled', 'success', now - 38 * HOUR, 58, 0, '2026-09-25 周四 18:30:00.09\r\n'),
      run('demo-clock', 'scheduled', 'success', now - 62 * HOUR, 60, 0, '2026-09-24 周三 18:30:00.11\r\n'),
    ],
    'demo-live': [
      run('demo-live', 'scheduled', 'success', now - 4 * MIN, 210, 0, '2026-09-27 00:41:27\n'),
      run('demo-live', 'scheduled', 'success', now - 19 * MIN, 198, 0, '2026-09-27 00:26:27\n'),
      run('demo-live', 'manual', 'success', now - 47 * MIN, 205, 0, '2026-09-26 23:58:27\n'),
    ],
    'demo-disk': [
      run('demo-disk', 'scheduled', 'success', now - 2 * DAY, 1330, 0, '已用 376.4 GB / 剩余 148.9 GB\n'),
    ],
    'demo-fail': [
      run('demo-fail', 'scheduled', 'failed', now - 26 * MIN, 95, 2, '模拟一个失败任务 \r\n', ''),
      run('demo-fail', 'scheduled', 'failed', now - 2 * DAY + 3 * HOUR, 91, 2, '模拟一个失败任务 \r\n', ''),
    ],
    'demo-paused': [run('demo-paused', 'scheduled', 'success', now - 8 * DAY, 41_200, 1, '未知选项\r\n', '')],
  }

  mkdirSync(dataDir, { recursive: true })
  writeFileSync(path.join(dataDir, 'tempo.json'), JSON.stringify({ schemaVersion: 1, tasks, runs, settings: { theme, sortMode: 'next' } }, null, 2))
}
