/**
 * 5 字段 cron 解析与下一次执行时间计算（本地时区）。
 * 支持：星号、数字、列表 a,b、区间 a-b、步进（斜杠后跟 n），dow 允许 0-7（7=周日）。
 * dom 与 dow 同时受限时按 vixie 语义取并集。
 */

export interface CronFields {
  minutes: boolean[] // [60]
  hours: boolean[] // [24]
  doms: boolean[] // [32]，0 弃用
  months: boolean[] // [13]，0 弃用
  dows: boolean[] // [7]
  domRestricted: boolean
  dowRestricted: boolean
}

export type CronParseResult = { ok: true; fields: CronFields } | { ok: false; error: string }

const RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // dom
  [1, 12], // month
  [0, 7], // dow（7 视为 0）
]

function parseField(part: string, idx: number, bits: boolean[]): string | null {
  const [min, max] = RANGES[idx]
  const names = ['分钟', '小时', '日', '月', '星期']
  let step = 1
  let range: string = part

  const slash = part.indexOf('/')
  if (slash >= 0) {
    range = part.slice(0, slash)
    const stepStr = part.slice(slash + 1)
    step = Number(stepStr)
    if (!Number.isInteger(step) || step < 1 || stepStr === '') return `${names[idx]}步进无效`
  }

  let lo = min
  let hi = max
  if (range !== '*') {
    const dash = range.indexOf('-')
    if (dash >= 0) {
      lo = Number(range.slice(0, dash))
      hi = Number(range.slice(dash + 1))
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return `${names[idx]}区间无效`
    } else {
      lo = Number(range)
      hi = step > 1 ? max : lo // 单值带步进时等价于 lo/max
      if (!Number.isInteger(lo)) return `${names[idx]}数值无效`
      if (step === 1) hi = lo
    }
  }
  if (lo < min || hi > max || lo > hi) return `${names[idx]}超出范围 (${min}-${max})`
  for (let v = lo; v <= hi; v += step) {
    bits[idx === 4 ? (v === 7 ? 0 : v) : v] = true
  }
  return null
}

export function parseCron(expr: string): CronParseResult {
  const trimmed = expr.trim().replace(/\s+/g, ' ')
  if (trimmed === '') return { ok: false, error: '表达式为空' }
  const parts = trimmed.split(' ')
  if (parts.length !== 5) return { ok: false, error: '需要 5 个字段（分 时 日 月 周）' }

  const minutes = new Array<boolean>(60).fill(false)
  const hours = new Array<boolean>(24).fill(false)
  const doms = new Array<boolean>(32).fill(false)
  const months = new Array<boolean>(13).fill(false)
  const dows = new Array<boolean>(7).fill(false)
  const bitSets = [minutes, hours, doms, months, dows]

  for (let i = 0; i < 5; i++) {
    for (const seg of parts[i].split(',')) {
      if (seg === '') return { ok: false, error: '存在空字段项' }
      const err = parseField(seg, i, bitSets[i])
      if (err) return { ok: false, error: err }
    }
  }

  return {
    ok: true,
    fields: {
      minutes,
      hours,
      doms,
      months,
      dows,
      domRestricted: parts[2] !== '*',
      dowRestricted: parts[4] !== '*',
    },
  }
}

function dayMatches(f: CronFields, d: Date): boolean {
  if (!f.months[d.getMonth() + 1]) return false
  const domOk = f.doms[d.getDate()]
  const dowOk = f.dows[d.getDay()]
  if (f.domRestricted && f.dowRestricted) return domOk || dowOk
  if (f.domRestricted) return domOk
  if (f.dowRestricted) return dowOk
  return true
}

/** 严格晚于 afterMs 的下一个匹配分钟；最多向后扫描 366+7 天 */
export function cronNext(f: CronFields, afterMs: number): number | null {
  const limit = afterMs + (366 + 7) * 24 * 3600 * 1000
  const d = new Date(afterMs + 60_000)
  d.setSeconds(0, 0)
  while (d.getTime() <= limit) {
    if (!dayMatches(f, d)) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (f.hours[d.getHours()] && f.minutes[d.getMinutes()]) return d.getTime()
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}
