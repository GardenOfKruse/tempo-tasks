/** 执行器：按运行方式生成子进程，捕获输出与退出码，超时杀进程树 */
import { spawn, ChildProcess } from 'node:child_process'
import * as os from 'node:os'
import * as fs from 'node:fs'
import type { MergeMark, RunRecord, RunType, Task, TriggerKind } from './types'
import { MAX_OUTPUT_CHARS, newId } from './types'
import { isBashStyleMultiLine, toCmdCompat } from './fixcmd'
import { pushMark, shiftMarks } from './runs'

export interface ExecutorEvents {
  onRunUpdate(record: RunRecord): void
}

interface RunningProc {
  record: RunRecord
  child: ChildProcess
  timedOut: boolean
  killedByUser: boolean
}

function truncate(s: string, alreadyTruncated: boolean): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT_CHARS) return { text: s, truncated: alreadyTruncated }
  return { text: `…[前段输出已截断]\n${s.slice(s.length - MAX_OUTPUT_CHARS)}`, truncated: true }
}

/** 尾部截断后把交错游标平移到新字符串坐标系（新头部标记长度已被差值天然补偿，越界由 shiftMarks 钳到 0） */
function shiftForTruncate(marks: MergeMark[], oldOut: string, oldErr: string, tOut: { text: string }, tErr: { text: string }): void {
  shiftMarks(marks, oldOut.length - tOut.text.length, oldErr.length - tErr.text.length)
}

/** UTF-8 优先；出现替换符时回退 GBK（中文 cmd 输出常见） */
function decodeSmart(buf: Buffer): string {
  const utf8 = buf.toString('utf-8')
  const bad = (utf8.match(/\uFFFD/g) ?? []).length
  if (bad === 0) return utf8
  try {
    const gbk = new TextDecoder('gbk')
    const dec = gbk.decode(buf)
    const badGbk = (dec.match(/\uFFFD/g) ?? []).length
    return badGbk < bad ? dec : utf8
  } catch {
    return utf8
  }
}

function buildArgs(runType: RunType, command: string): { file: string; args: string[] } {
  switch (runType) {
    case 'cmd':
      // verbatim 拼接下外层补一对引号，让 cmd /s 只剥掉这一对，
      // 命令自身的引号（如带空格的 exe 路径）原样保留
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`] }
    case 'powershell':
      return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] }
    case 'python':
      return { file: 'python.exe', args: ['-X', 'utf8', '-c', command] }
  }
}

export class Executor {
  private running = new Map<string, RunningProc[]>() // taskId → 进程列表（并行策略下可多个）
  private eventSink: ExecutorEvents | null = null

  setEventSink(sink: ExecutorEvents): void {
    this.eventSink = sink
  }

  isRunning(taskId: string): boolean {
    return (this.running.get(taskId)?.length ?? 0) > 0
  }

  runningTaskIds(): string[] {
    return [...this.running.keys()].filter((id) => this.isRunning(id))
  }

  /** 输出/状态变化的实时预览（取最近一次启动的实例） */
  livePreview(taskId: string): { status: RunRecord['status']; stdout: string; stderr: string; startedAt: number } | null {
    const list = this.running.get(taskId)
    if (!list || list.length === 0) return null
    const p = list.reduce((a, b) => (b.record.startedAt > a.record.startedAt ? b : a))
    return { status: 'running', stdout: p.record.stdout, stderr: p.record.stderr, startedAt: p.record.startedAt }
  }

  async run(task: Task, trigger: TriggerKind): Promise<RunRecord> {
    const record: RunRecord = {
      id: newId(),
      taskId: task.id,
      trigger,
      startedAt: Date.now(),
      endedAt: null,
      status: 'running',
      exitCode: null,
      durationMs: null,
      stdout: '',
      stderr: '',
      truncated: false,
    }

    const cwd = task.cwd && task.cwd.trim() !== '' ? task.cwd.trim() : os.homedir()
    const emit = () => this.eventSink?.onRunUpdate({ ...record })

    // 合并视图游标：每个输出事件后记一拍，详情页据此重建真实交错顺序
    const marks: MergeMark[] = (record.marks = [])

    const finish = (status: RunRecord['status'], exitCode: number | null) => {
      if (record.endedAt !== null) return
      record.endedAt = Date.now()
      record.status = status
      record.exitCode = exitCode
      record.durationMs = record.endedAt - record.startedAt
      emit()
    }

    let runCommand = task.command
    if (task.runType === 'cmd' && isBashStyleMultiLine(runCommand)) {
      const { text, strayQuote } = toCmdCompat(runCommand)
      runCommand = text
      // 在输出头部如实标注发生了自动转换
      record.stdout = strayQuote
        ? '[Tempo] 检测到 Bash 风格多行命令，已自动合并为单行执行（命令含未配对单引号，未能自动转换引号，如失败请手动调整）\r\n\r\n'
        : '[Tempo] 检测到 Bash 风格多行命令，已自动转换为 CMD 兼容单行执行\r\n\r\n'
      pushMark(marks, record.stdout, record.stderr)
    }
    const { file, args } = buildArgs(task.runType, runCommand)

    let child: ChildProcess
    try {
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        record.stderr = `工作目录不存在：${cwd}`
        pushMark(marks, record.stdout, record.stderr)
        finish('failed', null)
        return record
      }
      child = spawn(file, args, {
        cwd,
        env: { ...process.env, TEMPO_TASK_ID: task.id, TEMPO_TASK_NAME: task.name, TEMPO_TRIGGER: trigger },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // CMD 类型按字面拼接参数：Node 默认会把参数里的引号转义成 \"，
        // CMD 又把 \" 当字面引号，导致 curl 等程序收到带引号的 URL（curl: (3) 端口错误）
        ...(task.runType === 'cmd' ? { windowsVerbatimArguments: true } : {}),
      })
    } catch (e) {
      record.stderr = `无法启动进程：${e instanceof Error ? e.message : String(e)}`
      pushMark(marks, record.stdout, record.stderr)
      finish('failed', null)
      return record
    }

    const proc: RunningProc = { record, child, timedOut: false, killedByUser: false }
    const list = this.running.get(task.id) ?? []
    list.push(proc)
    this.running.set(task.id, list)

    const stdoutBuf: Buffer[] = []
    const stderrBuf: Buffer[] = []
    let stdoutLen = 0
    let stderrLen = 0

    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuf.push(chunk)
      stdoutLen += chunk.length
      // 只保留尾部，避免长输出撑爆内存
      while (stdoutLen > MAX_OUTPUT_CHARS * 4 && stdoutBuf.length > 1) {
        stdoutLen -= stdoutBuf[0].length
        stdoutBuf.shift()
      }
      const prevLen = record.stdout.length
      record.stdout = decodeSmart(Buffer.concat(stdoutBuf))
      // 流首被静默丢弃：游标同步平移，重建才不会重复发射旧文本
      if (record.stdout.length < prevLen) shiftMarks(marks, prevLen - record.stdout.length, 0)
      pushMark(marks, record.stdout, record.stderr)
      emit()
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf.push(chunk)
      stderrLen += chunk.length
      while (stderrLen > MAX_OUTPUT_CHARS * 4 && stderrBuf.length > 1) {
        stderrLen -= stderrBuf[0].length
        stderrBuf.shift()
      }
      const prevLen = record.stderr.length
      record.stderr = decodeSmart(Buffer.concat(stderrBuf))
      if (record.stderr.length < prevLen) shiftMarks(marks, 0, prevLen - record.stderr.length)
      pushMark(marks, record.stdout, record.stderr)
      emit()
    })

    const timeoutMs = task.timeoutSec > 0 ? task.timeoutSec * 1000 : 0
    let timer: NodeJS.Timeout | null = null
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        proc.timedOut = true
        killTree(child)
      }, timeoutMs)
      timer.unref?.()
    }

    child.on('error', (err) => {
      record.stderr = `${record.stderr}${record.stderr ? '\n' : ''}启动失败：${describeSpawnError(task.runType, err)}`
      pushMark(marks, record.stdout, record.stderr)
      finish('failed', null)
    })

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      const oldOut = record.stdout
      const oldErr = record.stderr
      const tOut = truncate(oldOut, false)
      record.stdout = tOut.text
      const tErr = truncate(oldErr, false)
      record.stderr = tErr.text
      record.truncated = tOut.truncated || tErr.truncated
      // 截断改变了字符串坐标系：先平移游标再补最后一拍，重建结果与最终文本严格一致
      shiftForTruncate(marks, oldOut, oldErr, tOut, tErr)
      pushMark(marks, record.stdout, record.stderr)
      // 判定优先级：先排除毫秒级竞态（进程恰在超时/停止边界前自然成功退出），
      // 再按 kill 标志归类，最后按退出码
      if (code === 0 && !proc.timedOut && !proc.killedByUser) finish('success', 0)
      else if (proc.killedByUser) finish('canceled', null)
      else if (proc.timedOut) finish('timeout', null)
      else if (code === 0) finish('success', 0)
      else finish('failed', code ?? (signal ? -1 : null))
      const list = (this.running.get(task.id) ?? []).filter((p) => p !== proc)
      if (list.length === 0) this.running.delete(task.id)
      else this.running.set(task.id, list)
    })

    emit()
    return record
  }

  async cancel(taskId: string): Promise<boolean> {
    const list = this.running.get(taskId)
    if (!list || list.length === 0) return false
    for (const p of list) {
      p.killedByUser = true
      killTree(p.child)
    }
    return true
  }

  /** 应用退出时终止所有子进程 */
  cancelAll(): void {
    for (const list of this.running.values()) {
      for (const p of list) {
        p.killedByUser = true
        killTree(p.child)
      }
    }
  }
}

function describeSpawnError(runType: RunType, err: Error): string {
  const enoent = err.message.includes('ENOENT')
  if (enoent && runType === 'python') return '未找到 Python。请安装 Python 并加入 PATH 后重试（命令行执行 python --version 应成功）。'
  if (enoent && runType === 'powershell') return '未找到 powershell.exe，当前系统异常。'
  return err.message
}

function killTree(child: ChildProcess | undefined): void {
  const pid = child?.pid
  if (!pid) return
  // 进程已被我们感知退出时不再盲杀，避免 PID 复用误伤无关进程树
  if (child.exitCode !== null || child.signalCode !== null) return
  // 用 PID 精确杀进程树，绝不用镜像名批量杀
  spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
}
