#!/usr/bin/env node
/**
 * ── ★★★ 把**真实的** `drawRoom()` 渲染成一张 PNG（不是另画一遍）────────────────────
 *
 * ── 为什么必须换掉旧的那份 ──────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-22 第四轮）：旧的是 `scripts/render-room-preview.py` ——
 * 一个 **Python 重实现**，把 `room-canvas.ts` 的画法又抄了一遍。
 * 而它已经漂了：
 * ```
 * TS 里  deskTop '#5b4f69'  deskLeft '#41384d'  deskRight '#2e2838'
 * py 里  deskTop '#564a63'  deskLeft '#362e40'  deskRight '#41374d'   ← 修光照前的旧值
 * ```
 * ⇒ 于是**预览图与真实界面不是同一件事**，而"预览图看起来对不对"因此**不可信**。
 * ★★ 这是本仓 §4 那条纪律的又一次复现：**同一个事实有两份真相**。
 *
 * ── 本文件怎么做到"只有一份真相"────────────────────────────────────────────────
 *
 * `drawRoom()` 只用到 Canvas 2D 的**六个**方法（`fillStyle` / `beginPath` / `lineTo` /
 * `closePath` / `fill` / `fillRect`）。所以这里给一个**记录型 context**：
 * ```
 * drawRoom(recorder, plan)  ⇒  recorder.ops[]   （一串 fill / rect，带颜色）
 *        ⇒  本文件把 ops 光栅化进 RGBA 缓冲
 *        ⇒  node:zlib 编码成 PNG（不引任何依赖）
 * ```
 * ★ 判据：`gate-room-preview` 臂 1 断言 **渲染器 import 的是 `lib/client/room-canvas.js`**，
 *   而不是自己画 —— 谁把画法抄回来，那条臂立刻红。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────
 *
 *   node scripts/render-room-preview.mjs [输出路径] [--zoom=4]
 *
 * @module dsh-agent-teams/scripts/render-room-preview
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { drawRoom } = await import(join(ROOT, 'lib', 'client', 'room-canvas.js'))
const { roomPlanOf } = await import(join(ROOT, 'lib', 'client', 'room-plan.js'))

/**
 * ── 记录型 2D context ────────────────────────────────────────────────────────
 *
 * ★ 它**只实现 `drawRoom` 真的会调的那几个**。多实现一个方法，就多一处
 *   "预览与真实渲染可能不一致"的地方。
 */
class Recorder {
  constructor() {
    this.ops = []
    this.fillStyle = '#000000'
    this._path = []
  }

  beginPath() { this._path = [] }

  lineTo(x, y) { this._path.push([x, y]) }

  closePath() { /* 隐式闭合；fill() 会自己收尾 */ }

  fill() {
    if (this._path.length >= 3) this.ops.push({ kind: 'poly', points: [...this._path], color: this.fillStyle })
  }

  fillRect(x, y, w, h) {
    this.ops.push({ kind: 'rect', x, y, w, h, color: this.fillStyle })
  }
}

/**
 * 光栅化：多边形用**扫描线填充**，矩形直接写。
 *
 * ★ 像素风要的是**硬边**：所有坐标先 `round`，不插值、不抗锯齿。
 */
function rasterize(ops, width, height) {
  const pixels = new Uint8Array(width * height * 3)
  /** 底色：与 `room-panel.tsx` 里 `ctx.fillRect(0,0,frame.width,frame.height)` 同一个值。 */
  pixels.fill(0)
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 3] = 0x0b
    pixels[i * 3 + 1] = 0x0a
    pixels[i * 3 + 2] = 0x10
  }

  const parse = (color) => {
    if (typeof color !== 'string' || !color.startsWith('#')) return null
    const n = Number.parseInt(color.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  const put = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const at = (y * width + x) * 3
    pixels[at] = rgb[0]
    pixels[at + 1] = rgb[1]
    pixels[at + 2] = rgb[2]
  }

  for (const op of ops) {
    const rgb = parse(op.color)
    if (rgb === null) continue
    if (op.kind === 'rect') {
      const x0 = Math.round(op.x); const y0 = Math.round(op.y)
      const x1 = Math.round(op.x + op.w); const y1 = Math.round(op.y + op.h)
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) put(x, y, rgb)
      continue
    }
    /** 扫描线填充（even-odd 对三角形/四边形都够用）。 */
    const points = op.points.map(([x, y]) => [Math.round(x), Math.round(y)])
    const ys = points.map(([, y]) => y)
    const yMin = Math.min(...ys); const yMax = Math.max(...ys)
    for (let y = yMin; y <= yMax; y += 1) {
      const crossings = []
      for (let i = 0; i < points.length; i += 1) {
        const [x1, y1] = points[i]
        const [x2, y2] = points[(i + 1) % points.length]
        if (y1 === y2) continue
        if ((y >= y1 && y < y2) || (y >= y2 && y < y1)) {
          crossings.push(Math.round(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)))
        }
      }
      crossings.sort((a, b) => a - b)
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        for (let x = crossings[i]; x <= crossings[i + 1]; x += 1) put(x, y, rgb)
      }
    }
  }
  return pixels
}

/** 最小 PNG 编码（无依赖）：RGB8 + 单个 IDAT + 每行 filter 0。 */
function encodePng(pixels, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0
    Buffer.from(pixels.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1)
  }
  const crcTable = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 预览用的**语料**：一个工作区里的两个团队。
 *
 * ★ 刻意让五态各出现至少一次 —— 否则"预览图"看不出 `unknown` 与 `idle` 的区别，
 *   而那正是 §27.4 要求"两两不同形"的那一格。
 */
const TEAMS = [
  {
    teamId: 'alpha', name: 'alpha', workspace: 'demo',
    members: [
      { name: 'architect', role: 'captain', liveness: 'working' },
      { name: 'researcher', role: 'member', liveness: 'working' },
      { name: 'builder', role: 'member', liveness: 'idle' },
      { name: 'qa', role: 'member', liveness: 'never-spawned' },
      { name: 'reviewer', role: 'member', liveness: 'not-live' },
      { name: 'scribe', role: 'member', liveness: 'could-not-measure' },
    ],
  },
  {
    teamId: 'beta', name: 'beta', workspace: 'demo',
    members: [
      { name: 'worker-1', role: 'member', liveness: 'working' },
      { name: 'worker-2', role: 'member', liveness: 'idle' },
      { name: 'worker-3', role: 'member', liveness: 'working' },
    ],
  },
]

const args = process.argv.slice(2)
const zoomArg = args.find((entry) => entry.startsWith('--zoom='))
const ZOOM = zoomArg === undefined ? 4 : Math.max(1, Number.parseInt(zoomArg.slice(7), 10))
const out = args.find((entry) => !entry.startsWith('--')) ?? join(ROOT, 'docs', 'room-preview.png')

const plan = roomPlanOf(TEAMS)
const recorder = new Recorder()
const frame = drawRoom(recorder, plan, { mainBusy: true, now: 0 })

const small = rasterize(recorder.ops, frame.width, frame.height)
/** ★ 整数倍放大、最近邻 —— 与 `room-panel.tsx` 的 `ZOOM` 同一个道理。 */
const width = frame.width * ZOOM
const height = frame.height * ZOOM
const big = new Uint8Array(width * height * 3)
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const src = ((Math.floor(y / ZOOM)) * frame.width + Math.floor(x / ZOOM)) * 3
    const dst = (y * width + x) * 3
    big[dst] = small[src]; big[dst + 1] = small[src + 1]; big[dst + 2] = small[src + 2]
  }
}

writeFileSync(out, encodePng(big, width, height))
process.stdout.write(
  `room-preview: ${out}\n`
  + `  来自 drawRoom() 的 ${recorder.ops.length} 个绘制指令（★ 不是另画一遍）\n`
  + `  房间 ${plan.cols}×${plan.rows} · ${plan.actors.length} 人 · ${plan.teams.length} 个团队\n`
  + `  画布 ${width}×${height}（1:1 是 ${frame.width}×${frame.height}，放大 ${ZOOM}×）\n`,
)
