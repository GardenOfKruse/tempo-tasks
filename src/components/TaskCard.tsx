import { memo } from 'react'
import type { RunRecord, Task } from '../api'
import { RUN_TYPE_LABEL, fmtCountdown, fmtDur, fmtRel } from '../format'
import { Icon } from '../icons'
import { formatSchedule } from '../../electron/schedule'

export interface TaskCardProps {
  task: Task
  /** 已按展示精度分桶的时钟（displayClock）：同桶内 props 不变，memo 跳过重渲染 */
  now: number
  running: boolean
  liveStartedAt: number | undefined
  lastRun: RunRecord | null
  onOpen: (id: string) => void
  onRun: (id: string) => void
  onStop: (id: string) => void
  onToggleEnabled: (t: Task) => void
  onEdit: (t: Task) => void
  onDelete: (t: Task) => void
  onMenu: (t: Task, x: number, y: number) => void
}

export const TaskCard = memo(function TaskCard(p: TaskCardProps) {
  const t = p.task
  const idx = Math.min(t.createdAt % 12, 11) // 入场动画的微差异
  const last = p.lastRun
  const lastChip = p.running
    ? { cls: 'run', text: `运行中 ${fmtDur(p.now - (p.liveStartedAt ?? p.now))}` }
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
      onClick={() => p.onOpen(t.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onMenu(t, e.clientX, e.clientY)
      }}
    >
      {p.running && <div className="run-bar" />}
      <div className="card-top">
        <span className={`status-dot ${dotCls}`} />
        <span className="card-name" title={t.name}>
          {t.name}
        </span>
        {t.pinned && <Icon name="pin" size={12.5} className="pin-badge" />}
        {!t.enabled && <span className="miss-badge">已暂停</span>}
        {t.enabled && !p.running && (t.missedOnce || t.missedCount > 0) && <span className="miss-badge">已错过</span>}
        <button
          className="kebab"
          aria-label="更多操作"
          onClick={(e) => {
            e.stopPropagation()
            p.onMenu(t, e.clientX, e.clientY)
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
            <button className="mini-btn" title="再启动一轮（并行）" onClick={() => p.onRun(t.id)}>
              <Icon name="play" size={12} />
            </button>
          )}
          {p.running ? (
            <button className="mini-btn danger" title="停止" onClick={() => p.onStop(t.id)}>
              <Icon name="stop" size={11} />
            </button>
          ) : (
            <button className="mini-btn" title={t.enabled ? '立即运行' : '已暂停'} onClick={() => p.onRun(t.id)} disabled={!t.enabled}>
              <Icon name="play" size={12} />
            </button>
          )}
        </span>
      </div>
    </div>
  )
})
