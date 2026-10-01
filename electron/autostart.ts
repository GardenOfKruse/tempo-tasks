/** 开机自启的决策（纯函数，主进程接 Electron app 实例） */

/** 开机自启写入的命令行参数：静默启动（本次进程不弹出主窗口） */
export const AUTOSTART_HIDDEN_ARG = '--hidden'

/** Electron app.setLoginItemSettings 接受的 settings 形状 */
export interface LoginItemSettings {
  openAtLogin: boolean
  path?: string
  args?: string[]
}

/** 开机自启登录项设置：开启时带 --hidden（重启后最小化静默启动，不抢焦点）；
 *  关闭时只需 openAtLogin: false（Electron 会清掉本应用的 Run 键条目）。 */
export function resolveLoginItem(enabled: boolean, appPath: string): LoginItemSettings {
  return enabled
    ? { openAtLogin: true, path: appPath, args: [AUTOSTART_HIDDEN_ARG] }
    : { openAtLogin: false }
}

/** 本次进程是否由「开机自启」拉起（命令行带 --hidden）→ 启动完成后不 show 主窗口 */
export function launchedByAutoStart(argv: readonly string[]): boolean {
  return argv.includes(AUTOSTART_HIDDEN_ARG)
}
