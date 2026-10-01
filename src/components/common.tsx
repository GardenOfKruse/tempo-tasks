import React, { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../icons'

/* ---------- 开关 ---------- */

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
      role="switch"
      aria-checked={on}
      data-testid="switch"
      onClick={() => onChange(!on)}
    />
  )
}

/* ---------- Toast ---------- */

export interface ToastItem {
  id: number
  kind: 'info' | 'err'
  text: string
  leaving?: boolean
}

export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}${t.leaving ? ' out' : ''}`} onClick={() => onDismiss(t.id)}>
          <Icon name={t.kind === 'err' ? 'warn' : 'check'} size={15} />
          <span style={{ userSelect: 'text' }}>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- 弹出菜单 ---------- */

export interface MenuItem {
  label: string
  icon: IconName
  danger?: boolean
  action: () => void
}

export function PopMenu({
  x,
  y,
  items,
  onClose,
  children,
  className,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  children?: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + r.width > window.innerWidth - 10) left = window.innerWidth - r.width - 10
    if (top + r.height > window.innerHeight - 10) top = window.innerHeight - r.height - 10
    if (top < 50) top = 50
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <>
      <div className="pop-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className={`pop-menu${className ? ` ${className}` : ''}`} ref={ref} style={{ left: pos.left, top: pos.top }}>
        {children}
        {items.map((it, i) => (
          <React.Fragment key={i}>
            {it.label === '-' ? (
              <div className="pop-sep" />
            ) : (
              <button
                className={it.danger ? 'danger' : ''}
                onClick={() => {
                  onClose()
                  it.action()
                }}
              >
                <Icon name={it.icon} size={15} />
                {it.label}
              </button>
            )}
          </React.Fragment>
        ))}
      </div>
    </>
  )
}

/* ---------- 确认对话框 ---------- */

export function ConfirmBox({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="overlay" style={{ zIndex: 80 }} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-box" role="alertdialog">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="row">
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button className="btn destructive" onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Sheet 骨架 ---------- */

export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
  testid,
  className,
  /** 返回 true 表示 Esc 已被内层（如查找替换条）消费，不关闭面板 */
  onEsc,
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
  testid?: string
  className?: string
  onEsc?: () => boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onEsc && onEsc()) return
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, onEsc])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} data-testid={testid}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="close-x" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}
