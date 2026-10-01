import { useEffect, useState } from 'react'
import type { Settings } from '../api'
import { Sheet } from './common'
import { Icon } from '../icons'

/** 独立设置面板：外观 / 行为 / 数据 / 关于。点击即保存 + toast，与原弹出菜单一致 */
export function SettingsSheet({
  settings,
  onPatch,
  onClose,
  toast,
}: {
  settings: Settings
  onPatch: (patch: Partial<Settings>, msg?: string) => void
  onClose: () => void
  toast: (text: string, kind?: 'info' | 'err') => void
}) {
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.tempo.appInfo().then((info) => setVersion(info.version))
  }, [])

  const exportTasks = () => {
    window.tempo.exportTasks().then((r) => {
      if (r.ok) toast(`已导出 ${r.count} 个任务`)
      else if (!r.canceled) toast(r.error ?? '导出失败', 'err')
    }).catch(() => toast('导出失败', 'err'))
  }

  const importTasks = () => {
    window.tempo.importTasks().then((r) => {
      if (r.ok) toast(`已导入 ${r.count} 个任务`)
      else if (!r.canceled) toast(r.error ?? '导入失败', 'err')
    }).catch(() => toast('导入失败', 'err'))
  }

  return (
    <Sheet testid="settings-sheet" className="settings-sheet" title="设置" onClose={onClose}>
      <div className="set-group">
        <div className="set-group-title">外观</div>
        <div className="set-card">
          <div className="set-row">
            <span>主题</span>
            <div className="seg" data-testid="settings-theme">
              {(['system', 'light', 'dark'] as const).map((th) => (
                <button
                  key={th}
                  className={settings.theme === th ? 'on' : ''}
                  onClick={() => onPatch({ theme: th }, `主题已切换为${th === 'system' ? '跟随系统' : th === 'light' ? '浅色' : '深色'}`)}
                >
                  {th === 'system' ? '自动' : th === 'light' ? '浅色' : '深色'}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <span>排序</span>
            <div className="seg" data-testid="settings-sort">
              {(
                [
                  ['next', '下次执行'],
                  ['created', '新建优先'],
                  ['name', '名称'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={settings.sortMode === k ? 'on' : ''}
                  onClick={() => onPatch({ sortMode: k }, `已按${k === 'next' ? '下次执行' : k === 'created' ? '新建优先' : '名称'}排序`)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="set-group">
        <div className="set-group-title">行为</div>
        <div className="set-card">
          <div className="set-row">
            <span>关窗时</span>
            <div className="seg" data-testid="menu-tray">
              {(
                [
                  [false, '直接退出'],
                  [true, '最小到托盘'],
                ] as [boolean, string][]
              ).map(([k, label]) => (
                <button
                  key={String(k)}
                  className={settings.minimizeToTray === k ? 'on' : ''}
                  onClick={() => onPatch({ minimizeToTray: k }, k ? '关闭窗口将最小化到托盘，托盘菜单可退出' : '关闭窗口即退出')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <span>运行日志落盘</span>
            <div className="seg" data-testid="settings-runlogs">
              {(
                [
                  [false, '关闭'],
                  [true, '开启'],
                ] as [boolean, string][]
              ).map(([k, label]) => (
                <button
                  key={String(k)}
                  className={(settings.writeRunLogs === true) === k ? 'on' : ''}
                  onClick={() => onPatch({ writeRunLogs: k }, k ? '每次运行的输出将另存为独立文本文件' : '不再把运行日志写入磁盘')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-note">开启后，每次运行的输出写入数据目录 runs/&#60;任务&#62;/ 下的文本文件，可在任务详情页点「输出目录」打开；每任务保留最近 100 次</div>
        </div>
      </div>

      <div className="set-group">
        <div className="set-group-title">数据</div>
        <div className="set-card">
          <button className="set-action" data-testid="menu-export" onClick={exportTasks}>
            <Icon name="download" size={15} />
            导出全部任务
          </button>
          <button className="set-action" data-testid="menu-import" onClick={importTasks}>
            <Icon name="upload" size={15} />
            导入任务
          </button>
          <button className="set-action" onClick={() => window.tempo.openDataDir()}>
            <Icon name="folder" size={15} />
            打开数据文件夹
          </button>
        </div>
      </div>

      <div className="set-group">
        <div className="set-group-title">关于</div>
        <div className="set-card">
          <div className="set-row">
            <span>版本</span>
            <span className="set-ver" data-testid="settings-version">
              {version !== '' ? `v${version}` : '…'}
            </span>
          </div>
          <div className="set-note">调度在应用运行期间进行；错过补跑见任务设置</div>
        </div>
      </div>
    </Sheet>
  )
}
