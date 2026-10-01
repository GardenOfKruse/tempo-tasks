/** 搜索命中高亮：把文本按查询词切分为命中/未命中片段（纯函数，主测试通用） */

export interface HighlightPart {
  text: string
  hit: boolean
}

/** 大小写不敏感地按 query 切分 text；query 为空（或全空白）返回整段未命中 */
export function splitHighlight(text: string, rawQuery: string): HighlightPart[] {
  const q = rawQuery.trim().toLowerCase()
  if (q === '') return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const parts: HighlightPart[] = []
  let i = 0
  for (;;) {
    const idx = lower.indexOf(q, i)
    if (idx === -1) {
      parts.push({ text: text.slice(i), hit: false })
      break
    }
    if (idx > i) parts.push({ text: text.slice(i, idx), hit: false })
    parts.push({ text: text.slice(idx, idx + q.length), hit: true })
    i = idx + q.length
  }
  return parts.filter((p) => p.text !== '')
}
