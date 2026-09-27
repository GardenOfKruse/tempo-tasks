/**
 * Bash → CMD 兼容转换（编辑器「一键修复」与执行器自动转换共用同一实现）。
 * CMD 与 bash 的差异：\ 不是续行符、单引号不是引用符、引号内换行会被静默截断。
 */

/** 是否为 Bash 风格多行命令（行尾续行符，或单引号体内含换行） */
export function isBashStyleMultiLine(command: string): boolean {
  if (!command.includes('\n')) return false
  if (command.split('\n').some((l) => /\\\s*$/.test(l))) return true
  // 单引号对跨行（bash 里单引号内换行合法，CMD 会拆行）
  return /'[^']*'/.test(command) && /'[^']*[\s\S]*?\n[\s\S]*?'/.test(command)
}

/** 转换为 CMD 兼容单行。返回转换结果与是否残留无法自动处理的单引号（奇数个，可能是撇号） */
export function toCmdCompat(command: string): { text: string; strayQuote: boolean } {
  let joined = command.replace(/\\\s*\n/g, ' ')
  const quoteCount = (joined.match(/'/g) ?? []).length
  const strayQuote = quoteCount % 2 === 1
  if (!strayQuote) {
    joined = joined.replace(/'([^']*)'/g, (_m, inner) => `"${String(inner).replace(/"/g, '\\"')}"`)
  }
  const text = joined.replace(/\s*\n\s*/g, ' ').trim()
  return { text, strayQuote }
}
