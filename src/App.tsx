import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunRecord, Settings, Task } from './api'
import { Icon } from './icons'
import { TaskCard } from './components/TaskCard'
import { TaskEditor } from './components/TaskEditor'
import { TaskDetail } from './components/TaskDetail'
import { ConfirmBox, PopMenu, Toasts, type MenuItem, type ToastItem } from './components/common'
import { duplicateTaskInput } from '../electron/schedule'

type Filter = 'all' | 'running' | 'paused' | 'failed' | 'missed'

let toastSeq = 1

export default function App() {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [settings, setSettings] = useState<Settings>({ theme: 'system', sortMode: 'created' })
  const [now, setNow] = useState(() => Date.now())
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ title: string; message: string; label: string; action: () => void } | null>(null)
  const [runningIds, setRunningIds] = useState<Map<string, Set<string>>>(new Map())
  const isRunning = useCallback((id: string) => (runningIds.get(id)?.size ?? 0) > 0, [runningIds])
  const [liveRuns, setLiveRuns] = useState<Record<string, RunRecord>>({})
  const [lastRuns, setLastRuns] = useState<Record<string, RunRecord | null>>({})
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; extra?: (s: Settings) => React.ReactNode } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const lastRunsRef = useRef<Record<string, RunRecord | null>>({})

  const toast = useCallback((text: string, kind: 'info' | 'err' = 'info') => {
    const id = toastSeq++
    setToasts((ts) => [...ts.slice(-3), { id, kind, text }])
    setTimeout(() => {
      setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
      setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 260)
    }, 4200)
  }, [])

  /* ---------- 初始化与事件 ---------- */

  useEffect(() => {
    const lastRunAtRef = new Map<string, number | null>()
    const unsubs: Array<() => void> = [
      window.tempo.onNotice((text) => toast(text)),
      window.tempo.onOpenTask((id) => setDetailId(id)),
    ]
    window.tempo.listTasks().then((ts) => {
      setTasks(ts)
      for (const t of ts) lastRunAtRef.set(t.id, t.lastRunAt)
      // 懒加载各任务最近一次结果（卡片展示用）
      Promise.all(ts.map(async (t) => [t.id, (await window.tempo.listRuns(t.id)).at(-1) ?? null] as const)).then((pairs) => {
        lastRunsRef.current = Object.fromEntries(pairs)
        setLastRuns(lastRunsRef.current)
      })
    })
    window.tempo.getSettings().then(setSettings)
    window.tempo.appInfo().then((info) => {
      const el = document.getElementById('ver')
      if (el) el.textContent = 'v' + info.version
    })

    unsubs.push(
      window.tempo.onTasksChanged((ts) => {
        setTasks(ts)
        for (const id of Object.keys(lastRunsRef.current)) {
          if (!ts.some((t) => t.id === id)) {
            delete lastRunsRef.current[id]
            lastRunAtRef.delete(id)
          }
        }
        for (const t of ts) {
          // lastRunAt 变化（如启动补跑发生在渲染端初始化前后、事件丢失）时重取最近记录
          if (lastRunAtRef.has(t.id) && t.lastRunAt !== null && t.lastRunAt !== lastRunAtRef.get(t.id)) {
            window.tempo.listRuns(t.id).then((rs) => {
              lastRunsRef.current[t.id] = rs.at(-1) ?? null
              setLastRuns({ ...lastRunsRef.current })
            })
          }
          lastRunAtRef.set(t.id, t.lastRunAt)
          if (!(t.id in lastRunsRef.current)) {
            lastRunsRef.current[t.id] = null
            window.tempo.listRuns(t.id).then((rs) => {
              lastRunsRef.current[t.id] = rs.at(-1) ?? null
              setLastRuns({ ...lastRunsRef.current })
            })
          }
        }
      }),
    )

    unsubs.push(
      window.tempo.onRunUpdate((record) => {
        setLiveRuns((prev) => {
          const next = { ...prev }
          if (record.endedAt === null) next[record.taskId] = record
          else delete next[record.taskId]
          return next
        })
        setRunningIds((prev) => {
          const next = new Map(prev)
          const set = new Set(next.get(record.taskId) ?? [])
          if (record.endedAt === null) set.add(record.id)
          else set.delete(record.id)
          if (set.size === 0) next.delete(record.taskId)
          else next.set(record.taskId, set)
          return next
        })
        if (record.endedAt !== null) {
          // ref 与 state 同步写：tasks-changed 的 refetch 用 ref 全量替换，漏写会让终态回退为旧记录
          lastRunsRef.current[record.taskId] = record
          setLastRuns((prev) => ({ ...prev, [record.taskId]: record }))
          if (record.status === 'failed' || record.status === 'timeout') {
            window.tempo.listTasks().then((ts) => {
              const t = ts.find((x) => x.id === record.taskId)
              toast(`「${t?.name ?? '任务'}」${record.status === 'timeout' ? '执行超时' : `执行失败（退出码 ${record.exitCode ?? '?'}）`}`, 'err')
            })
          }
        }
      }),
    )

    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  /* ---------- 主题 ---------- */

  useEffect(() => {
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.body.classList.toggle('theme-dark', dark)
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  /* ---------- 键盘快捷键 ---------- */

  const editingRef = useRef(editing)
  editingRef.current = editing

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (editingRef.current !== null) return // 已在编辑器中：不覆盖未保存草稿
        setEditing('new')
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---------- 派生数据 ---------- */

  const counts = useMemo(() => {
    const c = { all: 0, running: 0, paused: 0, failed: 0, missed: 0 }
    if (!tasks) return c
    c.all = tasks.length
    for (const t of tasks) {
      if (isRunning(t.id)) c.running++
      if (!t.enabled) c.paused++
      if (lastRuns[t.id] && lastRuns[t.id]!.status !== 'success' && lastRuns[t.id]!.status !== 'canceled' && lastRuns[t.id]!.status !== 'running') c.failed++
      if (t.missedOnce || t.missedCount > 0) c.missed++
    }
    return c
  }, [tasks, runningIds, isRunning, lastRuns])

  const visibleTasks = useMemo(() => {
    if (!tasks) return []
    let list = tasks
    const q = query.trim().toLowerCase()
    if (q !== '') list = list.filter((t) => t.name.toLowerCase().includes(q) || t.command.toLowerCase().includes(q))
    switch (filter) {
      case 'running':
        list = list.filter((t) => isRunning(t.id))
        break
      case 'paused':
        list = list.filter((t) => !t.enabled)
        break
      case 'failed':
        list = list.filter((t) => lastRuns[t.id] && ['failed', 'timeout'].includes(lastRuns[t.id]!.status))
        break
      case 'missed':
        list = list.filter((t) => t.missedOnce || t.missedCount > 0)
        break
    }
    const sorted = [...list]
    if (settings.sortMode === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    else if (settings.sortMode === 'next') {
      sorted.sort((a, b) => {
        const av = a.enabled && a.nextRunAt !== null ? a.nextRunAt : Number.MAX_SAFE_INTEGER
        const bv = b.enabled && b.nextRunAt !== null ? b.nextRunAt : Number.MAX_SAFE_INTEGER
        if (av !== bv) return av - bv
        return b.createdAt - a.createdAt
      })
    } else sorted.sort((a, b) => b.createdAt - a.createdAt)
    return sorted
  }, [tasks, query, filter, runningIds, isRunning, lastRuns, settings.sortMode])

  const detailTask = tasks?.find((t) => t.id === detailId) ?? null

  /* ---------- 操作 ---------- */

  const runNow = async (id: string) => {
    const r = await window.tempo.runNow(id)
    if (!r.ok) toast(r.error ?? '无法启动', 'err')
  }

  const toggleEnabled = async (t: Task) => {
    const r = await window.tempo.setEnabled(t.id, !t.enabled)
    if (!r.ok) toast(r.error ?? '操作失败', 'err')
    else toast(t.enabled ? `「${t.name}」已暂停` : `「${t.name}」已启用`)
  }

  const deleteTask = (t: Task) => {
    setConfirming({
      title: '删除任务',
      message: `「${t.name}」将被删除，包括它的全部执行历史。此操作无法撤销。`,
      label: '删除',
      action: async () => {
        const r = await window.tempo.deleteTask(t.id)
        if (r.ok) {
          setDetailId(null)
          toast(`「${t.name}」已删除`)
        } else toast(r.error ?? '删除失败', 'err')
      },
    })
  }

  const duplicateTask = async (t: Task) => {
    const input = duplicateTaskInput(t)
    const r = await window.tempo.createTask(input)
    if (r.ok) toast(`已创建副本「${input.name}」`)
    else toast(r.error ?? '创建失败', 'err')
  }

  const taskMenu = (t: Task, x: number, y: number) => {
    const running = isRunning(t.id)
    setMenu({
      x,
      y,
      items: [
        running
          ? { label: '停止运行', icon: 'stop' as const, action: () => window.tempo.cancelRun(t.id) }
          : { label: '立即运行', icon: 'play' as const, action: () => runNow(t.id) },
        { label: t.enabled ? '暂停任务' : '启用任务', icon: (t.enabled ? 'pause' : 'play') as never, action: () => toggleEnabled(t) },
        { label: '-', icon: 'x' as const, action: () => {} },
        { label: '编辑', icon: 'pencil' as const, action: () => setEditing(t) },
        { label: '创建副本', icon: 'copy' as const, action: () => duplicateTask(t) },
        { label: '打开详情', icon: 'terminal' as const, action: () => setDetailId(t.id) },
        { label: '-', icon: 'x' as const, action: () => {} },
        { label: '删除任务', icon: 'trash' as const, danger: true, action: () => deleteTask(t) },
      ],
    })
  }

  const openSettingsMenu = (x: number, y: number) => {
    setMenu({
      x,
      y,
      items: [],
      extra: (cur: Settings) => (
        <>
          <div className="row">
            <span>主题</span>
            <div className="seg">
              {(['system', 'light', 'dark'] as const).map((th) => (
                <button
                  key={th}
                  className={cur.theme === th ? 'on' : ''}
                  onClick={() => window.tempo.setSettings({ theme: th }).then((v) => { setSettings(v); toast(`主题已切换为${th === 'system' ? '跟随系统' : th === 'light' ? '浅色' : '深色'}`) })}
                >
                  {th === 'system' ? '自动' : th === 'light' ? '浅色' : '深色'}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <span>排序</span>
            <div className="seg">
              {(
                [
                  ['next', '下次执行'],
                  ['created', '新建优先'],
                  ['name', '名称'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={cur.sortMode === k ? 'on' : ''} onClick={() => window.tempo.setSettings({ sortMode: k }).then((v) => { setSettings(v); toast(`已按${k === 'next' ? '下次执行' : k === 'created' ? '新建优先' : '名称'}排序`) })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="pop-sep" />
          <button onClick={() => window.tempo.openDataDir()}>
            <Icon name="folder" size={15} />
            打开数据文件夹
          </button>
          <button
            data-testid="menu-export"
            onClick={() => {
              setMenu(null)
              window.tempo.exportTasks().then((r) => {
                if (r.ok) toast(`已导出 ${r.count} 个任务`)
                else if (!r.canceled) toast(r.error ?? '导出失败', 'err')
              })
            }}
          >
            <Icon name="download" size={15} />
            导出全部任务
          </button>
          <button
            data-testid="menu-import"
            onClick={() => {
              setMenu(null)
              window.tempo.importTasks().then((r) => {
                if (r.ok) toast(`已导入 ${r.count} 个任务`)
                else if (!r.canceled) toast(r.error ?? '导入失败', 'err')
              })
            }}
          >
            <Icon name="upload" size={15} />
            导入任务
          </button>
          <div className="meta" id="app-meta">
            Tempo for Windows · <span id="ver">v0.1.0</span>
            <br />
            调度在应用运行期间进行；错过补跑见任务设置
          </div>
        </>
      ),
    })
  }

  /* ---------- URL 参数驱动的 UI 状态（截图/验收用） ---------- */
  useEffect(() => {
    if (!tasks) return
    const ui = new URLSearchParams(window.location.search).get('ui')
    if (ui === 'editor') setEditing('new')
    if (ui === 'detail' && tasks.length > 0) setDetailId(sortedFirstId(tasks))
    if (ui === 'menu' && tasks.length > 0) {
      // 截图 kebab 菜单：放在卡片右上角附近
      setMenu({ x: window.innerWidth - 340, y: 200, items: [] })
      setEditing(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks === null])

  /* ---------- 渲染 ---------- */

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">
          <Icon name="bolt" size={15} />
          Tempo
        </div>
        <span className="spacer" />
      </div>

      <div className="content">
        <div className="content-inner">
          <div className="hero">
            <div>
              <h1>任务</h1>
              <div className="sub">
                {tasks === null
                  ? '加载中…'
                  : tasks.length === 0
                    ? '把重复的事交给时间'
                    : `共 ${tasks.length} 个任务${counts.running > 0 ? ` · ${counts.running} 个运行中` : ''}${counts.paused > 0 ? ` · ${counts.paused} 个已暂停` : ''}`}
              </div>
            </div>
            <div className="hero-actions">
              <div className="search-box">
                <Icon name="search" size={14} />
                <input ref={searchRef} placeholder="搜索任务或命令" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <button className="btn icon-btn subtle" title="设置" onClick={(e) => openSettingsMenu(e.clientX - 180, e.clientY + 12)}>
                <Icon name="gear" size={16} />
              </button>
              <button className="btn primary" onClick={() => setEditing('new')} data-testid="btn-new">
                <Icon name="plus" size={15} />
                新建任务
              </button>
            </div>
          </div>

          {tasks !== null && tasks.length > 0 && (
            <div className="chip-row">
              {(
                [
                  ['all', `全部`],
                  ['running', '运行中'],
                  ['failed', '失败'],
                  ['missed', '已错过'],
                  ['paused', '已暂停'],
                ] as [Filter, string][]
              ).map(([k, label]) => (
                <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)} data-testid={`filter-${k}`}>
                  {label}
                  {counts[k] > 0 && <span className="count">{counts[k]}</span>}
                </button>
              ))}
            </div>
          )}

          {tasks === null ? null : visibleTasks.length === 0 ? (
            tasks.length === 0 ? (
              <EmptyState onNew={() => setEditing('new')} />
            ) : (
              <div className="empty" style={{ paddingTop: 60 }}>
                <p style={{ marginTop: 0, color: 'var(--text-2)' }}>没有匹配「{query || filterLabel(filter)}」的任务</p>
                <button
                  className="btn subtle"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                  }}
                >
                  清除筛选
                </button>
              </div>
            )
          ) : (
            <div className="grid">
              {visibleTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  now={now}
                  running={isRunning(t.id)}
                  live={liveRuns[t.id]}
                  lastRun={lastRuns[t.id] ?? null}
                  onOpen={() => setDetailId(t.id)}
                  onRun={() => runNow(t.id)}
                  onStop={() => window.tempo.cancelRun(t.id)}
                  onToggleEnabled={() => toggleEnabled(t)}
                  onEdit={() => setEditing(t)}
                  onDelete={() => deleteTask(t)}
                  onMenu={(x, y) => taskMenu(t, x, y)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {editing !== null && (
        <TaskEditor
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null)
            toast(msg)
          }}
          onDelete={
            editing !== 'new'
              ? () => {
                  const t = editing as Task
                  setEditing(null)
                  deleteTask(t)
                }
              : undefined
          }
        />
      )}

      {detailTask && (
        <TaskDetail
          task={detailTask}
          live={liveRuns[detailTask.id] ?? null}
          now={now}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null)
            setEditing(detailTask)
          }}
          onRun={() => runNow(detailTask.id)}
          onStop={() => window.tempo.cancelRun(detailTask.id)}
          onToggleEnabled={() => toggleEnabled(detailTask)}
        />
      )}

      {confirming && (
        <ConfirmBox
          title={confirming.title}
          message={confirming.message}
          confirmLabel={confirming.label}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            confirming.action()
            setConfirming(null)
          }}
        />
      )}

      {menu && (
        <PopMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          className={menu.items.length === 0 ? 'settings-pop' : undefined}
          onClose={() => setMenu(null)}
        >
          {menu.extra?.(settings)}
        </PopMenu>
      )}

      <Toasts items={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
    </div>
  )
}

function filterLabel(f: Filter): string {
  return { all: '全部', running: '运行中', paused: '已暂停', failed: '失败', missed: '已错过' }[f]
}

function sortedFirstId(tasks: Task[]): string {
  return [...tasks].sort((a, b) => b.createdAt - a.createdAt)[0].id
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="empty" data-testid="empty-state">
      <div className="art">
        <span className="ring r1" />
        <span className="ring r2" />
        <Icon name="terminal" size={38} />
      </div>
      <h2>把重复的事交给时间</h2>
      <p>创建任务卡片，为每张卡片配置一条命令和它的执行计划。Tempo 会在到点时自动执行，并如实记录每次结果。</p>
      <button className="btn primary" onClick={onNew} data-testid="empty-new">
        <Icon name="plus" size={15} />
        新建任务
      </button>
      <div className="hint">
        按 <kbd>Ctrl</kbd> + <kbd>N</kbd> 随时新建 · 调度在应用运行期间进行
      </div>
    </div>
  )
}
