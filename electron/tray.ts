/** 托盘最小化的决策与菜单数据（纯函数，主进程接 Electron 实例） */
import type { Settings } from './types'

export type CloseBehavior = 'quit' | 'hide'

/** 关窗行为：开启「最小化到托盘」且不是正在退出 → 隐藏窗口；否则照常退出 */
export function resolveCloseBehavior(settings: Pick<Settings, 'minimizeToTray'>, opts?: { quitting?: boolean }): CloseBehavior {
  if (opts?.quitting) return 'quit'
  return settings.minimizeToTray === true ? 'hide' : 'quit'
}

export const TRAY_TOOLTIP = 'Tempo · 定时任务'

export interface TrayAction {
  id: 'show' | 'quit'
  label: string
}

/** 托盘菜单（固定两项），主进程按 id 接行为 */
export function trayActions(): TrayAction[] {
  return [
    { id: 'show', label: '显示主窗口' },
    { id: 'quit', label: '退出 Tempo' },
  ]
}
