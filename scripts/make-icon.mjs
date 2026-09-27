/**
 * 生成应用图标 build/icon.ico：蓝色渐变圆角方块 + 白色闪电。
 * 纯 Node 实现：4x 超采样绘制 → PNG（zlib）→ ICO 容器（256px PNG 条目 + 32px PNG 条目）。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const SIZE = 256
const SS = 4 // 超采样
const N = SIZE * SS

// sRGB 空间的简单混合
const lerp = (a, b, t) => a + (b - a) * t

function samplePixel(x, y) {
  // 坐标归一化到 0..1（采样网格中心）
  const u = (x + 0.5) / N
  const v = (y + 0.5) / N
  const px = u * SIZE
  const py = v * SIZE

  // ---- 圆角方块（连续圆角近似：大圆角 22.5%） ----
  const r = SIZE * 0.225
  const x0 = r, x1 = SIZE - r, y0 = r, y1 = SIZE - r
  const cx = Math.min(Math.max(px, x0), x1)
  const cy = Math.min(Math.max(py, y0), y1)
  const dx = px - cx
  const dy = py - cy
  const dSquare = Math.sqrt(dx * dx + dy * dy) - r // 外正内负

  // ---- 渐变背景（左上 #4AA8FF → 右下 #0063E6） ----
  const t = Math.min(1, Math.max(0, (u + v) / 2))
  const bg = [lerp(74, 0, t), lerp(168, 99, t), lerp(255, 230, t)]

  // ---- 白色闪电（bolt）：多边形 + 内距 ----
  // 以 0..1 归一化坐标定义闪电轮廓
  const bolt = [
    [0.60, 0.10],
    [0.30, 0.55],
    [0.48, 0.55],
    [0.40, 0.92],
    [0.72, 0.42],
    [0.52, 0.42],
    [0.68, 0.10],
  ]
  const inBolt = pointInPolygon(px / SIZE, py / SIZE, bolt) ? 1 : 0
  // 闪电抗锯齿：用 1px 宽度的软边（近似，靠超采样已足够）

  let alpha = Math.min(1, Math.max(0, 0.5 - dSquare * SS * 0.5)) // 1px 边缘过渡
  if (alpha <= 0) return [0, 0, 0, 0]

  const mix = inBolt ? 0.94 : 0
  const col = [lerp(bg[0], 255, mix), lerp(bg[1], 255, mix), lerp(bg[2], 255, mix)]
  return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2]), Math.round(alpha * 255)]
}

function pointInPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ---- 4x 超采样合成 ----
const pixels = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb, pa] = samplePixel(x * SS + sx, y * SS + sy)
        r += pr * pa
        g += pg * pa
        b += pb * pa
        a += pa
      }
    }
    const i = (y * SIZE + x) * 4
    if (a > 0) {
      pixels[i] = Math.round(r / a)
      pixels[i + 1] = Math.round(g / a)
      pixels[i + 2] = Math.round(b / a)
      pixels[i + 3] = Math.round(a / (SS * SS))
    }
  }
}

// ---- PNG 编码 ----
function crc32(buf) {
  let c, table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(px, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- ICO 容器（256 + 64 + 32 + 16，均嵌 PNG） ----
function scaleTo(px, from, to) {
  const out = Buffer.alloc(to * to * 4)
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      const sx = Math.floor((x + 0.5) * from / to) % from
      const sy = Math.floor((y + 0.5) * from / to) % from
      px.copy(out, (y * to + x) * 4, (sy * from + sx) * 4, (sy * from + sx) * 4 + 4)
    }
  }
  return out
}

const sizes = [256, 64, 32, 16]
const pngs = sizes.map((s) => encodePNG(s === SIZE ? pixels : scaleTo(pixels, SIZE, s), s))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
const entries = []
let offset = 6 + sizes.length * 16
sizes.forEach((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s
  e[1] = s === 256 ? 0 : s
  e[2] = 0
  e[3] = 0
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(pngs[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += pngs[i].length
  entries.push(e)
})

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.ico', Buffer.concat([header, ...entries, ...pngs]))
console.log(`[icon] build/icon.ico written (${sizes.join(', ')})`)
