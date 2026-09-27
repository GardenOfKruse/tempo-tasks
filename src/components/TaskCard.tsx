import type { RunRecord, Task } from '../api'
import { RUN_TYPE_LABEL, fmtCountdown, fmtDur, fmtRel } from '../format'
import { Icon } from '../icons'
import { formatSchedule } from '../../electron/schedule'

export interface TaskCardProps {
  task: Task
  now: number
  running: boolean
  live: RunRecord | undefined
  lastRun: RunRecord | null | undefined
  onOpen: () => void
  onRun: () => void
  onStop: () => void
  onToggleEnabled: () => void
  onEdit: () => void
  onDelete: () => void
  onMenu: (x: number, y: number) => void
}

export function TaskCard(p: TaskCardProps) {
  const t = p.task
  const idx = Math.min(t.createdAt % 12, 11) // 入场动画的微差异
  const last = p.lastRun
  const lastChip = p.running
    ? { cls: 'run', text: `运行中 ${fmtDur(p.now - (p.live?.startedAt ?? p.now))}` }
    : last
      ? last.status === 'success'
        ? { cls: 'ok', text: `成功 · ${fmtDur(last.durationMs)}` }
        : last.status === 'failed'
          ? { cls: 'err', text: `退出码 ${last.exitCode ?? '—'}` }
          : last.status === 'timeout'
            ? { cls: 'err', text: '超时' }
            : last.status === 'canceled'
              ? { cls: 'idle', text: '已停止' }
              : { cls: 'idle', text: '成功 · —' }
      : { cls: 'idle', text: '从未运行' }

  const dotCls = p.running ? 'run' : !t.enabled ? '' : t.missedOnce || t.missedCount > 0 ? 'err' : last ? (last.status === 'success' ? 'ok' : last.status === 'canceled' ? '' : 'err') : ''

  return (
    <div
      className={`card${t.enabled ? '' : ' paused'}`}
      style={{ animationDelay: `${idx * 26}ms` }}
      data-testid="task-card"
      data-task-name={t.name}
      onClick={p.onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(e.clientX, e.clientY)
      }}
    >
      {p.running && <div className="run-bar" />}
      <div className="card-top">
        <span className={`status-dot ${dotCls}`} />
        <span className="card-name" title={t.name}>
          {t.name}
        </span>
        {!t.enabled && <span className="miss-badge">已暂停</span>}
        {t.enabled && !p.running && (t.missedOnce || t.missedCount > 0) && <span className="miss-badge">已错过</span>}
        <button
          className="kebab"
          aria-label="更多操作"
          onClick={(e) => {
            e.stopPropagation()
            p.onMenu(e.clientX, e.clientY)
          }}
        >
          <Icon name="kebab" size={15} />
        </button>
      </div>

      <div className="card-cmd">
        <span className={`type-badge ${t.runType}`}>{RUN_TYPE_LABEL[t.runType]}</span>
        <span className="cmd mono" title={t.command}>
          {t.command}
        </span>
      </div>

      <div className="card-sched">
        <Icon name={t.schedule.kind === 'once' ? 'clock' : 'calendar'} size={13.5} />
        <span>{formatSchedule(t.schedule)}</span>
      </div>

      <div className="card-sep" />

      <div className="card-foot">
        {t.enabled ? (
          <span className="card-next" title="下次执行">
            {p.running ? (
              <span className="val">执行中…</span>
            ) : t.nextRunAt !== null ? (
              <>
                <span className="label">接下来</span>
                <span className="val">{fmtCountdown(t.nextRunAt, p.now)}</span>
              </>
            ) : t.schedule.kind === 'once' ? (
              t.missedOnce ? (
                <span className="val" style={{ color: 'var(--orange)' }}>已错过 · {t.schedule.at.slice(11)} 后不再触发</span>
              ) : t.lastRunAt !== null ? (
                <span className="val" style={{ color: 'var(--green)' }}>已完成 · {fmtRel(t.lastRunAt, p.now)}</span>
              ) : (
                <span className="val">待执行</span>
              )
            ) : (
              <span className="val">—</span>
            )}
          </span>
        ) : (
          <span className="card-next">
            <span className="label">已暂停</span>
          </span>
        )}
        <span className="grow" />
        <span className={`last-chip ${lastChip.cls}`} title={`上次：${last ? `${fmtRel(last.startedAt, p.now)}` : '从未运行'}`}>
          {lastChip.text}
        </span>
        <span className="card-run-actions" onClick={(e) => e.stopPropagation()}>
          {p.running && t.concurrency === 'parallel' && (
            <button className="mini-btn" title="再启动一轮（并行）" onClick={p.onRun}>
              <Icon name="play" size={12} />
            </button>
          )}
          {p.running ? (
            <button className="mini-btn danger" title="停止" onClick={p.onStop}>
              <Icon name="stop" size={11} />
            </button>
          ) : (
            <button className="mini-btn" title={t.enabled ? '立即运行' : '已暂停'} onClick={p.onRun} disabled={!t.enabled}>
              <Icon name="play" size={12} />
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
