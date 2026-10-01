import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunRecord, Settings, Task, TaskInput } from './api'
import { Icon } from './icons'
import { TaskCard } from './components/TaskCard'
import { TaskEditor } from './components/TaskEditor'
import { TaskDetail } from './components/TaskDetail'
import { ConfirmBox, PopMenu, Toasts, type MenuItem, type ToastItem } from './components/common'
import { SettingsSheet } from './components/SettingsSheet'
import { duplicateTaskInput } from '../electron/schedule'
import { STARTER_TEMPLATES, type StarterTemplate } from '../electron/templates'
import { displayClock, isFailStatus } from '../electron/runs'
import { clearDraft } from './draft'

type Filter = 'all' | 'running' | 'paused' | 'failed' | 'missed'

let toastSeq = 1

export default function App() {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [settings, setSettings] = useState<Settings>({ theme: 'system', sortMode: 'created', minimizeToTray: false })
  const [now, setNow] = useState(() => Date.now())
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  /** 从模板新建时带入编辑器的预填配置（普通新建/编辑为 null） */
  const [draftInput, setDraftInput] = useState<TaskInput | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ title: string; message: string; label: string; action: () => void } | null>(null)
  const [runningIds, setRunningIds] = useState<Map<string, Set<string>>>(new Map())
  const isRunning = useCallback((id: string) => (runningIds.get(id)?.size ?? 0) > 0, [runningIds])
  const [liveRuns, setLiveRuns] = useState<Record<string, RunRecord>>({})
  const [lastRuns, setLastRuns] = useState<Record<string, RunRecord | null>>({})
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
      // 历史被清空后重取卡片「上次结果」缓存
      window.tempo.onRunsChanged((taskId) => {
        window.tempo.listRuns(taskId).then((rs) => {
          lastRunsRef.current[taskId] = rs.at(-1) ?? null
          setLastRuns({ ...lastRunsRef.current })
        })
      }),
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
          // 并行多实例：仅当被替换的直播条目就是这条结束记录时才清掉，
          // 否则先结束的一轮会把仍在跑的后一轮直播状态误删
          else if (next[record.taskId]?.id === record.id) delete next[record.taskId]
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
          // 并行多实例：仅当被替换的直播条目就是这条结束记录时才清掉，
          // 否则先结束的一轮会把仍在跑的后一轮直播状态误删
          setLiveRuns((prev) => (prev[record.taskId]?.id === record.id ? (() => { const n = { ...prev }; delete n[record.taskId]; return n })() : prev))
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
        // 编辑器打开时 Ctrl+F 归编辑器内的查找替换（TaskEditor 里 preventDefault 并打开查找条）
        if (editingRef.current !== null) return
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
      if (lastRuns[t.id] && isFailStatus(lastRuns[t.id]!.status)) c.failed++
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
        list = list.filter((t) => lastRuns[t.id] && isFailStatus(lastRuns[t.id]!.status))
        break
      case 'missed':
        list = list.filter((t) => t.missedOnce || t.missedCount > 0)
        break
    }
    const sorted = [...list]
    // 各排序模式下置顶任务永远排在最前，组内再按所选方式排序
    const byPinned = (a: Task, b: Task) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1)
    if (settings.sortMode === 'name') sorted.sort((a, b) => byPinned(a, b) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    else if (settings.sortMode === 'next') {
      sorted.sort((a, b) => {
        const p = byPinned(a, b)
        if (p !== 0) return p
        const av = a.enabled && a.nextRunAt !== null ? a.nextRunAt : Number.MAX_SAFE_INTEGER
        const bv = b.enabled && b.nextRunAt !== null ? b.nextRunAt : Number.MAX_SAFE_INTEGER
        if (av !== bv) return av - bv
        return b.createdAt - a.createdAt
      })
    } else sorted.sort((a, b) => byPinned(a, b) || b.createdAt - a.createdAt)
    return sorted
  }, [tasks, query, filter, runningIds, isRunning, lastRuns, settings.sortMode])

  // 详情目标任务：避免随秒级时钟在每次渲染都做 O(n) 查找
  const detailTask = useMemo(() => tasks?.find((t) => t.id === detailId) ?? null, [tasks, detailId])

  /* ---------- 打开编辑器 ---------- */

  const openNew = useCallback(() => {
    setDraftInput(null)
    setEditing('new')
  }, [])

  const startFromTemplate = useCallback((tpl: StarterTemplate) => {
    clearDraft() // 从模板开始是明确的新意图，不恢复旧草稿
    setDraftInput(structuredClone(tpl.input))
    setEditing('new')
  }, [])

  const closeEditor = useCallback(() => {
    setEditing(null)
    setDraftInput(null)
  }, [])

  /* ---------- 操作（全部稳定引用，配合 TaskCard 的 React.memo） ---------- */

  const runNow = useCallback(
    async (id: string) => {
      const r = await window.tempo.runNow(id)
      if (!r.ok) toast(r.error ?? '无法启动', 'err')
    },
    [toast],
  )

  const stopRun = useCallback((id: string) => {
    window.tempo.cancelRun(id)
  }, [])

  const toggleEnabled = useCallback(
    async (t: Task) => {
      const r = await window.tempo.setEnabled(t.id, !t.enabled)
      if (!r.ok) toast(r.error ?? '操作失败', 'err')
      else toast(t.enabled ? `「${t.name}」已暂停` : `「${t.name}」已启用`)
    },
    [toast],
  )

  const togglePinned = useCallback(
    async (t: Task) => {
      const r = await window.tempo.setPinned(t.id, !t.pinned)
      if (!r.ok) toast(r.error ?? '操作失败', 'err')
      else toast(t.pinned ? `「${t.name}」已取消置顶` : `「${t.name}」已置顶`)
    },
    [toast],
  )

  const deleteTask = useCallback((t: Task) => {
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
  }, [])

  const duplicateTask = useCallback(
    async (t: Task) => {
      const input = duplicateTaskInput(t)
      const r = await window.tempo.createTask(input)
      if (r.ok) toast(`已创建副本「${input.name}」`)
      else toast(r.error ?? '创建失败', 'err')
    },
    [toast],
  )

  // 菜单打开时才读运行态：引用稳定，不随 runningIds 逐次变化
  const runningIdsRef = useRef(runningIds)
  runningIdsRef.current = runningIds

  const taskMenu = useCallback(
    (t: Task, x: number, y: number) => {
      const running = (runningIdsRef.current.get(t.id)?.size ?? 0) > 0
      setMenu({
        x,
        y,
        items: [
          running
            ? { label: '停止运行', icon: 'stop' as const, action: () => window.tempo.cancelRun(t.id) }
            : { label: '立即运行', icon: 'play' as const, action: () => runNow(t.id) },
          { label: t.enabled ? '暂停任务' : '启用任务', icon: (t.enabled ? 'pause' : 'play') as never, action: () => toggleEnabled(t) },
          { label: t.pinned ? '取消置顶' : '置顶', icon: 'pin' as const, action: () => togglePinned(t) },
          { label: '-', icon: 'x' as const, action: () => {} },
          { label: '编辑', icon: 'pencil' as const, action: () => setEditing(t) },
          { label: '创建副本', icon: 'copy' as const, action: () => duplicateTask(t) },
          { label: '打开详情', icon: 'terminal' as const, action: () => setDetailId(t.id) },
          { label: '-', icon: 'x' as const, action: () => {} },
          { label: '删除任务', icon: 'trash' as const, danger: true, action: () => deleteTask(t) },
        ],
      })
    },
    [runNow, toggleEnabled, togglePinned, duplicateTask, deleteTask],
  )

  const patchSettings = useCallback(
    (patch: Partial<Settings>, msg?: string) => {
      window.tempo.setSettings(patch).then((v) => {
        setSettings(v)
        if (msg) toast(msg)
      })
    },
    [toast],
  )

  /* ---------- URL 参数驱动的 UI 状态（截图/验收用） ---------- */
  useEffect(() => {
    if (!tasks) return
    const ui = new URLSearchParams(window.location.search).get('ui')
    if (ui === 'editor') openNew()
    if (ui === 'detail' && tasks.length > 0) setDetailId(sortedFirstId(tasks))
    if (ui === 'settings') setSettingsOpen(true)
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
              <button className="btn icon-btn subtle" title="设置" data-testid="btn-settings" onClick={() => setSettingsOpen(true)}>
                <Icon name="gear" size={16} />
              </button>
              <button className="btn primary" onClick={openNew} data-testid="btn-new">
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
              <EmptyState onNew={openNew} onTemplate={startFromTemplate} />
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
              {visibleTasks.map((t) => {
                const running = isRunning(t.id)
                return (
                  <TaskCard
                    key={t.id}
                    task={t}
                    now={displayClock({ nextRunAt: t.nextRunAt, lastRunAt: t.lastRunAt, running, now })}
                    running={running}
                    liveStartedAt={liveRuns[t.id]?.startedAt}
                    lastRun={lastRuns[t.id] ?? null}
                    query={query.trim()}
                    onOpen={setDetailId}
                    onRun={runNow}
                    onStop={stopRun}
                    onToggleEnabled={toggleEnabled}
                    onEdit={setEditing}
                    onDelete={deleteTask}
                    onMenu={taskMenu}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {editing !== null && (
        <TaskEditor
          task={editing === 'new' ? null : editing}
          initial={draftInput}
          onClose={closeEditor}
          onSaved={(msg) => {
            closeEditor()
            toast(msg)
          }}
          onDelete={
            editing !== 'new'
              ? () => {
                  const t = editing as Task
                  closeEditor()
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

      {settingsOpen && (
        <SettingsSheet
          settings={settings}
          onPatch={patchSettings}
          onClose={() => setSettingsOpen(false)}
          toast={toast}
        />
      )}

      {menu && <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

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

function EmptyState({ onNew, onTemplate }: { onNew: () => void; onTemplate: (tpl: StarterTemplate) => void }) {
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
      <div className="tpl-cap">或从一个模板开始，进编辑器后可随意修改</div>
      <div className="tpl-row">
        {STARTER_TEMPLATES.map((tpl) => (
          <button key={tpl.key} className="tpl-card" data-testid={`tpl-${tpl.key}`} onClick={() => onTemplate(tpl)}>
            <span className="tpl-title">{tpl.title}</span>
            <span className="tpl-desc">{tpl.desc}</span>
          </button>
        ))}
      </div>
      <div className="hint">
        按 <kbd>Ctrl</kbd> + <kbd>N</kbd> 随时新建 · 调度在应用运行期间进行
      </div>
    </div>
  )
}
