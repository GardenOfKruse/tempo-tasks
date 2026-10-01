import { useEffect, useMemo, useRef, useState } from 'react'
import type { RunRecord, Task } from '../api'
import { RUN_TYPE_FULL, STATUS_LABEL, TRIGGER_LABEL, fmtAt, fmtCountdown, fmtDur, fmtRel } from '../format'
import { Icon } from '../icons'
import { formatSchedule } from '../../electron/schedule'
import { matchRunFilter, rebuildMerged, summarizeRuns, type RunFilter } from '../../electron/runs'
import { Sheet, ConfirmBox } from './common'

function RunIco({ status }: { status: RunRecord['status'] }) {
  if (status === 'running') return <span className="run-ico running" style={{ animation: 'pulse 1.1s ease-in-out infinite' }} />
  const name = status === 'success' ? 'check' : status === 'canceled' ? 'stop' : 'warn'
  return (
    <span className={`run-ico ${status}`}>
      <Icon name={name} size={13} />
    </span>
  )
}

type OutView = 'merged' | 'stdout' | 'stderr'

function TermView({ record }: { record: RunRecord }) {
  const [tab, setTab] = useState<OutView>('merged')
  const bodyRef = useRef<HTMLPreElement>(null)
  // 合并视图：按游标快照重建真实交错顺序（stderr 红色）；旧记录回退为输出后跟错误
  const segs = useMemo(
    () => (tab === 'merged' ? rebuildMerged(record.marks, record.stdout, record.stderr) : null),
    [tab, record.marks, record.stdout, record.stderr],
  )
  const text = tab === 'stdout' ? record.stdout : tab === 'stderr' ? record.stderr : ''
  const empty = tab === 'merged' ? segs!.length === 0 : text.trim() === ''

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text, segs, tab])

  return (
    <div className="term">
      <div className="term-tabs">
        <button className={tab === 'merged' ? 'on' : ''} onClick={() => setTab('merged')} data-testid="term-merged">
          合并
        </button>
        <button className={tab === 'stdout' ? 'on' : ''} onClick={() => setTab('stdout')}>
          输出
        </button>
        <button className={tab === 'stderr' ? 'on' : ''} onClick={() => setTab('stderr')}>
          错误{record.stderr.trim() !== '' ? ' •' : ''}
        </button>
        <button
          className="tcopy"
          onClick={() => {
            navigator.clipboard.writeText((record.stdout || '') + (record.stderr ? `\n[stderr]\n${record.stderr}` : ''))
          }}
        >
          <Icon name="copy" size={12} />
          复制全部
        </button>
      </div>
      {empty ? (
        <div className="empty-out">{record.status === 'running' ? '等待输出…' : '（无内容）'}</div>
      ) : tab === 'merged' ? (
        <pre ref={bodyRef}>
          {segs!.map((sg, i) =>
            sg.s === 1 ? (
              <span key={i} className="seg-err" title="stderr">
                {sg.t}
              </span>
            ) : (
              <span key={i}>{sg.t}</span>
            ),
          )}
        </pre>
      ) : (
        <pre ref={bodyRef} className={tab === 'stderr' ? 'err' : ''}>
          {text}
        </pre>
      )}
    </div>
  )
}

export function TaskDetail({
  task,
  live,
  runsVersion,
  now,
  onClose,
  onEdit,
  onRun,
  onStop,
  onToggleEnabled,
}: {
  task: Task
  live: RunRecord | null
  now: number
  onClose: () => void
  onEdit: () => void
  onRun: () => void
  onStop: () => void
  onToggleEnabled: () => void
  runsVersion: number
}) {
  const [runs, setRuns] = useState<RunRecord[] | null>(null)
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const [runFilter, setRunFilter] = useState<RunFilter>('all')
  const [confirmClear, setConfirmClear] = useState(false)
  const running = live !== null

  const autoExpandedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    window.tempo.listRuns(task.id).then((rs) => {
      setRuns(rs)
      // 仅首次自动展开最近一次失败；之后不重放（避免覆盖用户手动收起）
      const last = rs.at(-1)
      if (last && (last.status === 'failed' || last.status === 'timeout') && !autoExpandedRef.current.has(task.id)) {
        autoExpandedRef.current.add(task.id)
        setOpenRunId(last.id)
      }
    })
  }, [task.id, task.updatedAt, runsVersion])

  // 运行结束时刷新历史
  useEffect(() => {
    if (live === null && running === false) {
      window.tempo.listRuns(task.id).then(setRuns)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.endedAt, live === null])

  // 最新记录在前；运行中的直播条目固定顶部，结束后自然落入时间序
  const merged = useMemo(() => {
    const sorted = [...(runs ?? [])].sort((a, b) => b.startedAt - a.startedAt)
    if (live) return [live, ...sorted.filter((r) => r.id !== live.id)]
    return sorted
  }, [runs, live])

  const shown = useMemo(() => (runFilter === 'all' ? merged : merged.filter((r) => matchRunFilter(r, runFilter))), [merged, runFilter])

  // 近 7 天统计：与历史列表同源（含运行中的直播条目）。
  // 统计项不含秒级内容，按分钟桶重算即可（原实现随秒级 now 每秒重算 O(n)）。
  const minuteClock = Math.floor(now / 60_000)
  const summary = useMemo(() => summarizeRuns(merged, minuteClock * 60_000 - 7 * 86_400_000), [merged, minuteClock])

  const clearHistory = async () => {
    const r = await window.tempo.clearRuns(task.id)
    if (r.ok) {
      setRuns([])
      setOpenRunId(null)
    }
  }


  return (
    <Sheet
      wide
      testid="task-detail"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <span className={`status-dot ${running ? 'run' : task.enabled ? (task.missedOnce || task.missedCount > 0 ? 'err' : 'ok') : ''}`} />
          {task.name}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onEdit}>
            <Icon name="pencil" size={14} />
            编辑
          </button>
          <button className="btn" onClick={onToggleEnabled}>
            <Icon name={task.enabled ? 'pause' : 'play'} size={14} />
            {task.enabled ? '暂停任务' : '启用任务'}
          </button>
          <span className="grow" />
          {running ? (
            <button className="btn primary" onClick={onStop} data-testid="detail-stop">
              <Icon name="stop" size={14} />
              停止
            </button>
          ) : (
            <button className="btn primary" onClick={onRun} disabled={!task.enabled} data-testid="detail-run">
              <Icon name="play" size={14} />
              立即运行
            </button>
          )}
        </>
      }
    >
      {summary.total === 0 ? (
        <div className="detail-stats" data-testid="detail-stats">
          <span className="dstat-none">近 7 天暂无执行</span>
        </div>
      ) : (
        <div className="detail-stats" data-testid="detail-stats">
          <span className="dstat-cap">近 7 天</span>
          <div className="dstat">
            <div className="n">{summary.total} 次</div>
            <div className="l">触发</div>
          </div>
          <div className="dstat">
            <div className="n">{summary.successRate === null ? '—' : `${summary.successRate}%`}</div>
            <div className="l">成功率</div>
          </div>
          <div className="dstat">
            <div className="n">{fmtDur(summary.avgDurationMs)}</div>
            <div className="l">平均耗时</div>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <div className="kv">
          <div className="k">执行方式</div>
          <div className="v">{RUN_TYPE_FULL[task.runType]}</div>
        </div>
        <div className="kv">
          <div className="k">执行计划</div>
          <div className="v">{formatSchedule(task.schedule)}</div>
        </div>
        <div className="kv">
          <div className="k">下次执行</div>
          <div className="v" style={{ color: task.enabled ? 'var(--accent)' : 'var(--text-3)' }}>
            {task.enabled && !running ? fmtCountdown(task.nextRunAt, now) : running ? '运行中' : '已暂停'}
          </div>
        </div>
        <div className="kv">
          <div className="k">上次触发</div>
          <div className="v">{fmtRel(task.lastRunAt, now)}</div>
        </div>
        <div className="kv">
          <div className="k">超时限制</div>
          <div className="v">{task.timeoutSec > 0 ? `${task.timeoutSec} 秒` : '不限时'}</div>
        </div>
        <div className="kv">
          <div className="k">重复策略</div>
          <div className="v">{task.concurrency === 'skip' ? '运行中跳过触发' : '允许并行'}</div>
        </div>
        <div className="kv full">
          <div className="k">工作目录</div>
          <div className="v mono" style={{ fontSize: 12 }}>
            {task.cwd && task.cwd.trim() !== '' ? task.cwd : '(用户主目录)'}
          </div>
        </div>
        <div className="kv full">
          <div className="k">命令</div>
          <div className="cmd-block">
            <button
              className="copy-btn"
              title="复制命令"
              onClick={() => navigator.clipboard.writeText(task.command)}
            >
              <Icon name="copy" size={13} />
            </button>
            {task.command}
          </div>
        </div>
        {(task.missedOnce || task.missedCount > 0) && (
          <div className="kv full">
            <div className="k" style={{ color: 'var(--orange)' }}>
              错过情况
            </div>
            <div className="v">
              {task.missedOnce
                ? '一次性任务已过计划时间且未执行（不会自动补跑，可手动运行或修改时间）'
                : `错过 ${task.missedCount} 次调度（未开启补跑）`}
            </div>
          </div>
        )}
      </div>

      <div className="sect-title">
        执行历史
        <span className="count-pill">{merged.length > 0 ? `${shown.length === merged.length ? `${merged.length} 条记录` : `${shown.length} / ${merged.length} 条`}` : ''}</span>
        <span className="grow" />
        <button
          className="tclear dir"
          title="打开输出日志所在文件夹（数据目录 runs/<任务>；需在设置中开启「运行日志落盘」，首次打开会自动创建）"
          data-testid="open-runs-dir"
          onClick={() => window.tempo.openRunsDir(task.id)}
        >
          <Icon name="folder" size={12} />
          输出目录
        </button>
        {merged.length > 0 && (
          <>
            <div className="chip-row detail-chips">
              {(
                [
                  ['all', '全部'],
                  ['ok', '成功'],
                  ['fail', '失败'],
                ] as [RunFilter, string][]
              ).map(([k, label]) => (
                <button key={k} className={`chip${runFilter === k ? ' on' : ''}`} onClick={() => setRunFilter(k)} data-testid={`run-filter-${k}`}>
                  {label}
                </button>
              ))}
            </div>
            <button className="tclear" onClick={() => setConfirmClear(true)} data-testid="run-clear">
              <Icon name="trash" size={12} />
              清空
            </button>
          </>
        )}
      </div>
      {merged.length === 0 ? (
        <div className="empty" style={{ padding: '30px 20px' }}>
          <p style={{ marginTop: 0 }}>还没有执行记录。点击「立即运行」验证一次，或等待计划触发。</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty" style={{ padding: '30px 20px' }}>
          <p style={{ marginTop: 0 }}>没有符合筛选的记录</p>
        </div>
      ) : (
        <div className="run-list" data-testid="run-list">
          {shown.map((r) => (
            <div key={r.id} className={`run-item${openRunId === r.id ? ' active' : ''}`}>
              <div
                className="run-item-head"
                role="button"
                tabIndex={0}
                aria-expanded={openRunId === r.id}
                aria-label={`${fmtAt(r.startedAt)} ${STATUS_LABEL[r.status]}，展开或收起输出`}
                onClick={() => setOpenRunId(openRunId === r.id ? null : r.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setOpenRunId(openRunId === r.id ? null : r.id)
                  }
                }}
              >
                <RunIco status={r.status} />
                <span className="when">{fmtAt(r.startedAt)}</span>
                <span className="trigger-tag">{TRIGGER_LABEL[r.trigger]}</span>
                <span className="grow" />
                <span className="meta">
                  {r.status === 'running' ? `已运行 ${fmtDur(now - r.startedAt)}` : `${STATUS_LABEL[r.status]} · ${fmtDur(r.durationMs)}`}
                  {r.exitCode !== null && r.status !== 'success' ? ` · 退出码 ${r.exitCode}` : ''}
                </span>
              </div>
              {openRunId === r.id && <TermView record={r} />}
            </div>
          ))}
        </div>
      )}

      {confirmClear && (
        <ConfirmBox
          title="清空执行历史"
          message={`「${task.name}」的全部执行记录（含输出）将被删除，任务本身不受影响。此操作无法撤销。`}
          confirmLabel="清空"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false)
            clearHistory()
          }}
        />
      )}
    </Sheet>
  )
}
