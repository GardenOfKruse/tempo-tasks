/** 首次运行快速开始模板：纯数据，有效性由 validateTaskInput / previewNextRuns 在单测中兜底 */
import type { TaskInput } from './types'

export interface StarterTemplate {
  key: string
  title: string
  desc: string
  input: TaskInput
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'site-check',
    title: '网站测活',
    desc: '每 30 分钟检查一次网站可用性',
    input: {
      name: '网站测活',
      runType: 'cmd',
      command: 'curl -s -o nul -w "%{http_code}" https://example.com',
      timeoutSec: 30,
      schedule: { kind: 'interval', seconds: 1800 },
    },
  },
  {
    key: 'daily-backup',
    title: '每日备份',
    desc: '每天 18:00 把桌面备份到文档',
    input: {
      name: '每日桌面备份',
      runType: 'cmd',
      command: 'robocopy "%USERPROFILE%\\Desktop" "%USERPROFILE%\\Documents\\DesktopBackup" /E /R:2 /W:2 & if errorlevel 8 (echo backup failed & exit /b 8) else (echo backup done & exit /b 0)',
      timeoutSec: 0,
      schedule: { kind: 'daily', time: '18:00' },
    },
  },
  {
    key: 'weekday-chime',
    title: '工作日打点',
    desc: '工作日整点发出一声提示音',
    input: {
      name: '工作日打点',
      runType: 'powershell',
      command: '[console]::beep(880,300)',
      timeoutSec: 30,
      schedule: { kind: 'cron', expr: '0 9-17 * * 1-5' },
    },
  },
]
