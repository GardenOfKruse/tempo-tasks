import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunType, Task, TaskInput } from '../api'
import { RUN_TYPE_FULL } from '../format'
import { Icon } from '../icons'
import { validateTaskInput, previewNextRuns } from '../../electron/schedule'
import { parseCron } from '../../electron/cron'
import { isBashStyleMultiLine, toCmdCompat } from '../../electron/fixcmd'
import { fmtWhen } from '../format'
import { Sheet, Switch, ConfirmBox } from './common'
import { applyDraft, clearDraft, loadDraft, saveDraft, type DraftForm } from '../draft'

const WEEK = [
  { d: 0, label: '日' },
  { d: 1, label: '一' },
  { d: 2, label: '二' },
  { d: 3, label: '三' },
  { d: 4, label: '四' },
  { d: 5, label: '五' },
  { d: 6, label: '六' },
]

function localDateTimeInput(ms?: number | null): string {
  const d = ms ? new Date(ms) : new Date(Date.now() + 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const PLACEHOLDER: Record<RunType, string> = {
  cmd: 'curl https://api.example.com/health',
  powershell: 'Get-ChildItem ~\\Desktop',
  python: 'import datetime\nprint(datetime.datetime.now().strftime("%H:%M:%S"))',
}

type ScheduleKind = Task['schedule']['kind']

type IntervalUnit = 's' | 'm' | 'h' | 'd'

const UNIT_FACTOR: Record<IntervalUnit, number> = { s: 1, m: 60, h: 3600, d: 86400 }

/** 把秒数分解为「数值 + 最合适的单位」用于编辑回填 */
function decomposeSeconds(seconds: number): { value: string; unit: IntervalUnit } {
  if (seconds % 86400 === 0) return { value: String(seconds / 86400), unit: 'd' }
  if (seconds % 3600 === 0) return { value: String(seconds / 3600), unit: 'h' }
  if (seconds % 60 === 0) return { value: String(seconds / 60), unit: 'm' }
  return { value: String(seconds), unit: 's' }
}

/** 表单状态与草稿同形（src/draft.ts 负责localStorage 读写与字段校验） */
type FormState = DraftForm

function formFromTask(t: Task | null, initial?: TaskInput | null): FormState {
  if (t) {
    const s = t.schedule
    return {
      name: t.name,
      runType: t.runType,
      command: t.command,
      cwd: t.cwd,
      timeoutSec: String(t.timeoutSec),
      kind: s.kind,
      onceAt: s.kind === 'once' ? s.at : localDateTimeInput(null),
      intervalValue: s.kind === 'interval' ? decomposeSeconds(s.seconds).value : '15',
      intervalUnit: s.kind === 'interval' ? decomposeSeconds(s.seconds).unit : 'm',
      dailyTime: s.kind === 'daily' ? s.time : '08:30',
      weeklyDays: s.kind === 'weekly' ? s.days : [1],
      weeklyTime: s.kind === 'weekly' ? s.time : '09:00',
      cronExpr: s.kind === 'cron' ? s.expr : '*/5 * * * *',
      catchUp: t.catchUp,
      notify: t.notify,
      concurrency: t.concurrency,
    }
  }
  const f: FormState = {
    name: '',
    runType: 'cmd',
    command: '',
    cwd: '',
    timeoutSec: '60',
    kind: 'daily',
    onceAt: localDateTimeInput(null),
    intervalValue: '15',
    intervalUnit: 'm',
    dailyTime: '08:30',
    weeklyDays: [1],
    weeklyTime: '09:00',
    cronExpr: '*/5 * * * *',
    catchUp: true,
    notify: false,
    concurrency: 'skip',
  }
  // 模板快速开始：以默认表单为底，覆盖模板给出的字段
  if (initial) {
    if (initial.name) f.name = initial.name
    f.runType = initial.runType
    if (initial.command) f.command = initial.command
    if (initial.cwd) f.cwd = initial.cwd
    if (initial.timeoutSec !== undefined) f.timeoutSec = String(initial.timeoutSec)
    const s = initial.schedule
    f.kind = s.kind
    if (s.kind === 'once') f.onceAt = s.at
    if (s.kind === 'interval') {
      const d = decomposeSeconds(s.seconds)
      f.intervalValue = d.value
      f.intervalUnit = d.unit
    }
    if (s.kind === 'daily') f.dailyTime = s.time
    if (s.kind === 'weekly') {
      f.weeklyDays = s.days
      f.weeklyTime = s.time
    }
    if (s.kind === 'cron') f.cronExpr = s.expr
  }
  return f
}

/* ---------- 代码编辑区：行号 + Tab 缩进 + 横向滚动 + 查找替换 ---------- */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const FIND_MATCH_CAP = 2000

function CodeArea({
  value,
  onChange,
  placeholder,
  testid,
  findOpen,
  onFindToggle,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  testid?: string
  findOpen: boolean
  onFindToggle: (open: boolean) => void
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const lineCount = useMemo(() => Math.max(value.split('\n').length, 1), [value])
  // 智能大小写：查询含大写时精确匹配，全小写则忽略大小写
  const caseSensitive = /[A-Z]/.test(findText)

  const matches = useMemo(() => {
    if (findText === '') return []
    const hay = caseSensitive ? value : value.toLowerCase()
    const needle = caseSensitive ? findText : findText.toLowerCase()
    const out: number[] = []
    let i = hay.indexOf(needle)
    while (i !== -1 && out.length < FIND_MATCH_CAP) {
      out.push(i)
      i = hay.indexOf(needle, i + Math.max(needle.length, 1))
    }
    return out
  }, [value, findText, caseSensitive])

  useEffect(() => {
    if (matchIdx >= matches.length) setMatchIdx(matches.length === 0 ? 0 : matches.length - 1)
  }, [matches.length, matchIdx])

  /** 定位到第 i 处；focus=false 时只设置选区不打断查找框输入 */
  const selectMatch = useCallback(
    (i: number, focus: boolean) => {
      const ta = taRef.current
      const pos = matches[i]
      if (!ta || pos === undefined) return
      if (focus) ta.focus()
      ta.setSelectionRange(pos, pos + findText.length)
    },
    [matches, findText.length],
  )

  const step = useCallback(
    (dir: 1 | -1) => {
      if (matches.length === 0) return
      const next = (matchIdx + dir + matches.length) % matches.length
      setMatchIdx(next)
      selectMatch(next, true)
    },
    [matches.length, matchIdx, selectMatch],
  )

  // 打开时聚焦查找框，并尽量以编辑区当前选区作为查找词
  useEffect(() => {
    if (!findOpen) return
    const ta = taRef.current
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      const sel = value.slice(ta.selectionStart, ta.selectionEnd)
      if (sel !== '' && !sel.includes('\n')) setFindText(sel)
    }
    findRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen])

  // 关闭时把焦点还给编辑区（打开瞬间不算）
  const prevOpen = useRef(findOpen)
  useEffect(() => {
    if (prevOpen.current && !findOpen) taRef.current?.focus()
    prevOpen.current = findOpen
  }, [findOpen])

  // 查询变化时优先选中光标之后的第一处
  useEffect(() => {
    if (findText === '' || matches.length === 0) return
    const caret = taRef.current?.selectionStart ?? 0
    const i = matches.findIndex((p) => p >= caret)
    const idx = i === -1 ? 0 : i
    setMatchIdx(idx)
    selectMatch(idx, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findText])

  const replaceCurrent = () => {
    const ta = taRef.current
    const pos = matches[matchIdx]
    if (!ta || pos === undefined) return
    if (ta.selectionStart === pos && ta.selectionEnd === pos + findText.length) {
      ta.focus()
      // execCommand 走原生编辑命令，保留 Ctrl+Z 撤销栈
      if (!document.execCommand('insertText', false, replaceText)) {
        onChange(value.slice(0, pos) + replaceText + value.slice(pos + findText.length))
      }
    } else {
      selectMatch(matchIdx, true)
    }
  }

  const replaceAll = () => {
    const ta = taRef.current
    if (!ta || matches.length === 0) return
    const re = new RegExp(escapeRegExp(findText), caseSensitive ? 'g' : 'gi')
    const nv = value.replace(re, replaceText)
    ta.focus()
    ta.setSelectionRange(0, value.length)
    if (!document.execCommand('insertText', false, nv)) onChange(nv)
  }

  const syncScroll = () => {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const ta = e.currentTarget
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (start !== end) {
      // 选区缩进：给选中行首插入两空格
      const before = value.slice(0, start)
      const lineStart = before.lastIndexOf('\n') + 1
      const block = value.slice(lineStart, end)
      const nv = value.slice(0, lineStart) + block.replace(/^/gm, '  ') + value.slice(end)
      onChange(nv)
      const lineCount = block.split('\n').length
      requestAnimationFrame(() => ta.setSelectionRange(start + 2, end + 2 * lineCount))
    } else {
      onChange(value.slice(0, start) + '  ' + value.slice(end))
      requestAnimationFrame(() => ta.setSelectionRange(start + 2, start + 2))
    }
  }

  return (
    <div className="code-area" data-testid={testid}>
      {findOpen && (
        <div className="find-bar" data-testid="find-bar">
          <input
            ref={findRef}
            className="find-input mono"
            placeholder="查找"
            spellCheck={false}
            value={findText}
            onChange={(e) => {
              setFindText(e.target.value)
              setMatchIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                step(e.shiftKey ? -1 : 1)
              }
            }}
          />
          <span className={`find-count${findText !== '' && matches.length === 0 ? ' none' : ''}`} data-testid="find-count">
            {findText === '' ? '' : matches.length === 0 ? '无结果' : `${matchIdx + 1}/${matches.length}`}
          </span>
          <button title="上一处（Shift+Enter）" onClick={() => step(-1)} disabled={matches.length === 0}>
            ↑
          </button>
          <button title="下一处（Enter）" onClick={() => step(1)} disabled={matches.length === 0}>
            ↓
          </button>
          <input
            className="find-input mono"
            placeholder="替换为"
            spellCheck={false}
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
          />
          <button onClick={replaceCurrent} disabled={matches.length === 0} title="替换当前处">
            替换
          </button>
          <button onClick={replaceAll} disabled={matches.length === 0} title="替换全部">
            全部
          </button>
          <button title="关闭（Esc）" onClick={() => onFindToggle(false)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      <div className="code-main">
        <div className="code-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="code-ln">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={taRef}
          className="code-input mono"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  )
}

export function TaskEditor({
  task,
  initial,
  onClose,
  onSaved,
  onDelete,
}: {
  task: Task | null
  /** 模板快速开始的预填配置（仅在 task 为 null 时生效） */
  initial?: TaskInput | null
  onClose: () => void
  onSaved: (msg: string) => void
  onDelete?: () => void
}) {
  // 新建模式且非模板进入时恢复草稿（编辑已有任务不做草稿，避免与磁盘态打架）
  const draftAppliedRef = useRef(false)
  const [initialForm] = useState<FormState>(() => {
    const base = formFromTask(task, initial)
    if (task === null && !initial) {
      const merged = applyDraft(base, loadDraft())
      if (merged !== base) draftAppliedRef.current = true
      return merged
    }
    return base
  })
  const [draftRestored] = useState(() => draftAppliedRef.current)
  const [f, setF] = useState<FormState>(initialForm)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pyInfo, setPyInfo] = useState<'checking' | 'ok' | 'missing' | null>(null)
  const [findOpen, setFindOpen] = useState(false)

  // 新建草稿自动保存（防抖 600ms）。三路判定：
  // 等于挂载时的纯默认表单 → 清除草稿；等于打开时的初始表单 → 不动（未修改，别把已有草稿洗掉）；否则保存
  const [pristineForm] = useState<FormState>(() => formFromTask(null))
  useEffect(() => {
    if (task !== null) return
    const t = setTimeout(() => {
      if (JSON.stringify(f) === JSON.stringify(pristineForm)) clearDraft()
      else if (JSON.stringify(f) !== JSON.stringify(initialForm)) saveDraft(f)
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, task])

  // 有未保存修改时关闭需确认（Esc / 取消 / 遮罩 / 右上角 X 都走 requestClose）
  const dirty = JSON.stringify(f) !== JSON.stringify(initialForm)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }, [dirty, onClose])

  const set = (patch: Partial<FormState>) => setF((prev) => ({ ...prev, ...patch }))

  // Bash 风格写法检测与修复：与执行器的自动转换共用同一实现
  const bashMulti = f.runType === 'cmd' && isBashStyleMultiLine(f.command)
  const needsCmdFix = bashMulti
  const [cmdFixNote, setCmdFixNote] = useState('')
  const fixCmdCompat = () => {
    const { text, strayQuote } = toCmdCompat(f.command)
    set({ command: text })
    setCmdFixNote(strayQuote ? '已合并换行；但存在未配对的单引号（可能是撇号），未能自动转换引号，请手动检查' : '')
  }
  // Windows PowerShell 5.1 里 curl 是 Invoke-WebRequest 的别名，真 curl 要写 curl.exe
  const psCurlAlias = f.runType === 'powershell' && /^\s*curl\s/.test(f.command) && !/curl\.exe/.test(f.command)

  useEffect(() => {
    if (f.runType === 'python') {
      setPyInfo('checking')
      window.tempo.probePython().then((r) => setPyInfo(r.ok ? 'ok' : 'missing'))
    } else {
      setPyInfo(null)
    }
  }, [f.runType])

  const buildInput = (): TaskInput => {
    let schedule: Task['schedule']
    switch (f.kind) {
      case 'once':
        schedule = { kind: 'once', at: f.onceAt }
        break
      case 'interval':
        schedule = { kind: 'interval', seconds: Math.round((Number(f.intervalValue) || 0) * UNIT_FACTOR[f.intervalUnit]) }
        break
      case 'daily':
        schedule = { kind: 'daily', time: f.dailyTime }
        break
      case 'weekly':
        schedule = { kind: 'weekly', days: f.weeklyDays, time: f.weeklyTime }
        break
      case 'cron':
        schedule = { kind: 'cron', expr: f.cronExpr }
        break
    }
    return {
      name: f.name,
      runType: f.runType,
      command: f.command,
      cwd: f.cwd,
      timeoutSec: Number(f.timeoutSec),
      schedule,
      catchUp: f.catchUp,
      notify: f.notify,
      concurrency: f.concurrency,
      enabled: task ? task.enabled : true,
    }
  }

  const save = async () => {
    if (saving) return
    const v = validateTaskInput(buildInput())
    if (!v.ok) {
      setError(v.error)
      return
    }
    setSaving(true)
    const r = task ? await window.tempo.updateTask(task.id, v.value) : await window.tempo.createTask(v.value)
    setSaving(false)
    if (!r.ok) {
      setError(r.error ?? '保存失败')
      return
    }
    if (!task) clearDraft() // 新建落库后草稿完成使命
    onSaved(task ? '已保存修改' : '任务已创建')
  }

  // Ctrl+S 保存、Ctrl+F 查找：编辑器挂载期间的全局快捷键（含焦点在代码编辑区内），经 ref 取最新闭包
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const chooseFolder = async () => {
    const dir = await window.tempo.chooseFolder()
    if (dir) set({ cwd: dir })
  }

  const scheduleHint = useMemo((): { text: string; cls: string } => {
    if (f.kind === 'cron') {
      return { text: '格式：分 时 日 月 周，例如 "30 8 * * 1-5" 表示工作日 08:30', cls: '' }
    }
    if (f.kind === 'once') {
      return { text: '到点只执行一次；应用未运行时会标记为“已错过”，不会自动补跑', cls: '' }
    }
    if (!f.catchUp) {
      return { text: '未开启补跑：应用未运行期间错过的调度将被跳过并计数提醒', cls: 'warn' }
    }
    return { text: '应用未运行期间错过的调度，会在下次启动或系统唤醒时补跑一次', cls: '' }
  }, [f.kind, f.catchUp])

  // Cron 预览随时间前进重算：30 秒一跳足够（分钟粒度展示），仅在 Cron 模式下运行
  const [clockTick, setClockTick] = useState(() => Date.now())
  useEffect(() => {
    if (f.kind !== 'cron') return
    setClockTick(Date.now())
    const iv = setInterval(() => setClockTick(Date.now()), 30_000)
    return () => clearInterval(iv)
  }, [f.kind])

  // Cron 实时预览：接下来 3 次执行时间（与调度器同一引擎计算）；非法表达式直接给出原因
  const cronInfo = useMemo((): { times: string[]; error: string | null } => {
    if (f.kind !== 'cron') return { times: [], error: null }
    const parsed = parseCron(f.cronExpr)
    if (!parsed.ok) return { times: [], error: parsed.error }
    const now = clockTick
    return {
      times: previewNextRuns({ kind: 'cron', expr: f.cronExpr }, now, 3).map((ms) => fmtWhen(ms, now)),
      error: null,
    }
  }, [f.kind, f.cronExpr, clockTick])

  return (
    <Sheet
      wide
      title={task ? '编辑任务' : '新建任务'}
      onClose={requestClose}
      testid="task-editor"
      className="editor-sheet"
      onEsc={() => {
        // 查找条打开时 Esc 只收起查找条，不关编辑器
        if (findOpen) {
          setFindOpen(false)
          return true
        }
        return false
      }}
      footer={
        <>
          {task && onDelete && (
            <button className="btn danger-text" onClick={onDelete}>
              <Icon name="trash" size={15} />
              删除
            </button>
          )}
          <span className="grow" />
          {error && (
            <span className="form-hint error" style={{ margin: 0 }} data-testid="editor-error">
              {error}
            </span>
          )}
          <button className="btn" onClick={requestClose}>
            取消
          </button>
          <button className="btn primary" onClick={save} disabled={saving} data-testid="editor-save" title="Ctrl+S">
            {saving ? '保存中…' : task ? '保存' : '创建任务'}
          </button>
        </>
      }
    >
      <div className="form-sec">
        <label>名称</label>
        <input
          className="field"
          autoFocus
          placeholder="例如：每日数据备份"
          value={f.name}
          maxLength={60}
          onChange={(e) => set({ name: e.target.value })}
          data-testid="field-name"
        />
        {draftRestored && (
          <div className="form-hint ok" data-testid="draft-restored">
            已恢复上次未完成的草稿；保存或放弃修改后自动清除
          </div>
        )}
      </div>

      <div className="form-sec">
        <label>执行方式</label>
        <div className="seg wide">
          {(['cmd', 'powershell', 'python'] as RunType[]).map((rt) => (
            <button key={rt} className={f.runType === rt ? 'on' : ''} onClick={() => set({ runType: rt })}>
              <Icon name="terminal" size={13} />
              {RUN_TYPE_FULL[rt]}
            </button>
          ))}
        </div>
        <div style={{ height: 8 }} />
        <CodeArea
          value={f.command}
          onChange={(v) => set({ command: v })}
          placeholder={PLACEHOLDER[f.runType]}
          testid="field-command"
          findOpen={findOpen}
          onFindToggle={setFindOpen}
        />
        {needsCmdFix && (
          <div className="form-hint warn" data-testid="bash-warn">
            ⚠ 检测到 Bash 风格的多行命令（续行符或单引号跨行）——CMD 无法直接执行，会在运行时自动转换为 CMD 兼容单行。
            <button className="btn small" style={{ marginLeft: 8 }} onClick={fixCmdCompat} data-testid="fix-cmd">
              立即转换为单行
            </button>
          </div>
        )}
        {cmdFixNote && !needsCmdFix && (
          <div className="form-hint warn" data-testid="cmd-fix-note">
            {cmdFixNote}
          </div>
        )}
        {psCurlAlias && (
          <div className="form-hint warn">
            ℹ Windows PowerShell 中 curl 是 Invoke-WebRequest 的别名，参数不兼容。如需真正的 curl，请写成 curl.exe。
          </div>
        )}
        {f.runType === 'python' && (
          <div className={`form-hint ${pyInfo === 'ok' ? 'ok' : pyInfo === 'missing' ? 'warn' : ''}`}>
            {pyInfo === 'checking' && '正在检查本机 Python…'}
            {pyInfo === 'ok' && '✓ 已检测到本机 Python，命令将作为脚本正文执行'}
            {pyInfo === 'missing' && '⚠ 未检测到 python，执行会失败。请安装 Python 并加入 PATH'}
          </div>
        )}
        {f.runType === 'cmd' && <div className="form-hint">通过 cmd.exe /c 执行，可直接使用 curl、robocopy 等命令</div>}
        {f.runType === 'powershell' && <div className="form-hint">以 -NoProfile -NonInteractive 执行，适合系统管理脚本</div>}
      </div>

      <div className="editor-cols">
        <div className="form-sec">
          <label>执行计划</label>
          <div className="seg wide">
            {(
              [
                ['once', '一次'],
                ['interval', '固定间隔'],
                ['daily', '每天'],
                ['weekly', '每周'],
                ['cron', 'Cron'],
              ] as [ScheduleKind, string][]
            ).map(([k, label]) => (
              <button key={k} className={f.kind === k ? 'on' : ''} onClick={() => set({ kind: k })} data-testid={`sched-${k}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="sched-panel" data-testid="sched-panel">
            {f.kind === 'once' && (
              <input
                type="datetime-local"
                className="field"
                style={{ width: 220 }}
                value={f.onceAt}
                onChange={(e) => set({ onceAt: e.target.value })}
              />
            )}
            {f.kind === 'interval' && (
              <div className="field-row">
                <span style={{ fontSize: 13 }}>每隔</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="field"
                  style={{ width: 84 }}
                  value={f.intervalValue}
                  onChange={(e) => set({ intervalValue: e.target.value })}
                  data-testid="interval-value"
                />
                <select
                  className="field"
                  style={{ width: 92, flex: '0 0 auto' }}
                  value={f.intervalUnit}
                  onChange={(e) => set({ intervalUnit: e.target.value as IntervalUnit })}
                  data-testid="interval-unit"
                >
                  <option value="s">秒</option>
                  <option value="m">分钟</option>
                  <option value="h">小时</option>
                  <option value="d">天</option>
                </select>
                <span style={{ fontSize: 13 }}>执行一次</span>
              </div>
            )}
            {f.kind === 'daily' && (
              <div className="field-row">
                <span style={{ fontSize: 13 }}>每天</span>
                <input type="time" className="field time-input" value={f.dailyTime} onChange={(e) => set({ dailyTime: e.target.value })} />
                <span style={{ fontSize: 13 }}>执行</span>
              </div>
            )}
            {f.kind === 'weekly' && (
              <>
                <div className="week-days" style={{ marginBottom: 10 }}>
                  {WEEK.map((w) => (
                    <button
                      key={w.d}
                      className={f.weeklyDays.includes(w.d) ? 'on' : ''}
                      onClick={() =>
                        set({
                          weeklyDays: f.weeklyDays.includes(w.d) ? f.weeklyDays.filter((d) => d !== w.d) : [...f.weeklyDays, w.d],
                        })
                      }
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
                <div className="field-row">
                  <input type="time" className="field time-input" value={f.weeklyTime} onChange={(e) => set({ weeklyTime: e.target.value })} />
                  <span style={{ fontSize: 13 }}>执行</span>
                </div>
              </>
            )}
            {f.kind === 'cron' && (
              <>
                <div className="cron-templates">
                  {(
                    [
                      ['*/5 * * * *', '每 5 分钟'],
                      ['0 * * * *', '每小时'],
                      ['30 8 * * *', '每天 08:30'],
                      ['30 8 * * 1-5', '工作日 08:30'],
                    ] as [string, string][]
                  ).map(([expr, label]) => (
                    <button key={expr} className="cron-tpl" onClick={() => set({ cronExpr: expr })}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="field-row">
                  <input
                    className="field mono"
                    placeholder="30 8 * * 1-5"
                    value={f.cronExpr}
                    spellCheck={false}
                    onChange={(e) => set({ cronExpr: e.target.value })}
                  />
                </div>
                <div className={`cron-preview${cronInfo.error ? ' error' : ''}`} data-testid="cron-preview">
                  {cronInfo.error
                    ? `表达式无效：${cronInfo.error}`
                    : cronInfo.times.length > 0
                      ? `接下来 ${cronInfo.times.length} 次：${cronInfo.times.join('、')}`
                      : '该表达式在一年内没有匹配的执行时间'}
                </div>
              </>
            )}
            <div className={`form-hint ${scheduleHint.cls}`}>{scheduleHint.text}</div>
          </div>
        </div>

        <div className="form-sec">
          <label>运行选项</label>
          <div className="opt-row" style={{ padding: '10px 12px' }}>
            <span className="txt">
              <div className="t">工作目录</div>
              <div className="field-row" style={{ marginTop: 5 }}>
                <input
                  className="field mono"
                  style={{ fontSize: 12, height: 30 }}
                  placeholder="默认：用户主目录"
                  value={f.cwd}
                  onChange={(e) => set({ cwd: e.target.value })}
                />
                <button className="btn icon-btn" style={{ height: 30, width: 30 }} title="选择文件夹" onClick={chooseFolder}>
                  <Icon name="folder" size={14} />
                </button>
              </div>
            </span>
          </div>
          <div className="opt-row" style={{ padding: '10px 12px' }}>
            <span className="txt">
              <div className="t">超时（秒）</div>
              <div className="field-row" style={{ marginTop: 5 }}>
                <input type="number" min={0} className="field" style={{ height: 30 }} value={f.timeoutSec} onChange={(e) => set({ timeoutSec: e.target.value })} />
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>0 = 不限时</span>
              </div>
            </span>
          </div>
          <div className="opt-row" style={{ padding: '10px 12px' }}>
            <span className="txt">
              <div className="t">错过补跑</div>
              <div className="d">应用关闭或睡眠期间错过的调度，启动/唤醒后补跑一次</div>
            </span>
            <Switch on={f.catchUp} onChange={(v) => set({ catchUp: v })} disabled={f.kind === 'once'} />
          </div>
          <div className="opt-row" style={{ padding: '10px 12px' }}>
            <span className="txt">
              <div className="t">运行中再次触发</div>
              <div className="d">跳过：上一轮未结束时不重复启动（推荐）</div>
            </span>
            <div className="seg" style={{ flexShrink: 0 }}>
              <button className={f.concurrency === 'skip' ? 'on' : ''} onClick={() => set({ concurrency: 'skip' })}>
                跳过
              </button>
              <button className={f.concurrency === 'parallel' ? 'on' : ''} onClick={() => set({ concurrency: 'parallel' })}>
                并行
              </button>
            </div>
          </div>
          <div className="opt-row" style={{ padding: '10px 12px' }}>
            <span className="txt">
              <div className="t">完成时系统通知</div>
              <div className="d">任务结束后弹出 Windows 通知</div>
            </span>
            <Switch on={f.notify} onChange={(v) => set({ notify: v })} />
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmBox
          title="放弃未保存的修改？"
          message="编辑器中有尚未保存的修改，关闭后将无法恢复。"
          confirmLabel="放弃修改"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => {
            if (!task) clearDraft() // 新建模式下点「放弃修改」= 明确不要这份草稿
            onClose()
          }}
        />
      )}
    </Sheet>
  )
}
