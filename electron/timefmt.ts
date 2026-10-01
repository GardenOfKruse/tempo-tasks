/** 下次执行具体时刻的紧凑文案（纯函数，主进程/渲染端/测试共用，不依赖运行时） */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 目标时刻与 now 相差的自然日数（按本地零点取整；正 = 未来） */
export function dayDiff(ms: number, now: number): number {
  const today0 = new Date(now)
  today0.setHours(0, 0, 0, 0)
  const day0 = new Date(ms)
  day0.setHours(0, 0, 0, 0)
  return Math.round((day0.getTime() - today0.getTime()) / 86_400_000)
}

/**
 * 具体时刻：今天/明天/周X HH:MM；≥7 天退化为 M/D HH:MM（卡片倒计时旁的小字、调度预览共用）。
 * 静态文本：随分桶时钟（displayClock）只在桶边界变化，不引入逐秒重渲染。
 */
export function fmtNextTime(ms: number, now: number): string {
  const d = new Date(ms)
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const days = dayDiff(ms, now)
  if (days === 0) return `今天 ${hhmm}`
  if (days === 1) return `明天 ${hhmm}`
  if (days > 1 && days < 7) return `周${'日一二三四五六'[d.getDay()]} ${hhmm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`
}
