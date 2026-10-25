/**
 * ── ★★★ 房间的三条**像素等距纪律**（外部规范 + 本轮实测）──────────────────────────
 *
 * ── 这份规范从哪来（★ 这是本轮装 Agent Reach 的**第一个直接收益**）───────────────
 *
 * MEASURED（2026-10-22，`node scripts/agent-reach.mjs search …`）：
 * 搜到 `pixeli.pebbly.space/knowledge/rules/71-isometric` —— 一份像素等距的规范。
 * 它把"手画容易错的地方"说成了可判定的规则，其中三条**直接命中**我们的实现：
 *
 * ```
 * rule 5   三明度、一个光源：top 最亮 · left 中 · right 最暗 · **never flip it per object**
 * rule 8   从远到近画：按 x+y 升序，再按高度
 * rule 15  **每个物件都要有接地阴影** —— 没有它，物件看起来是"贴上去的"
 * rule 18  世界坐标 → 屏幕：((x−y)·W/2, (x+y)·W/4 − z)
 * ```
 *
 * ★★ 而这三个读数此前**一个都不在判据里**：房间能画出来、16 条臂全绿，
 *   而"光向反了"、"没有阴影"这两处**没有任何东西会红**。
 *   MEASURED：桌子原来写的是 `deskLeft: '#362e40'`（暗）`deskRight: '#41374d'`（亮）
 *   ⇒ **左右反了**，而它单看不像错 —— 整间房的光向不一致才看得出来。
 *
 * ── 判据怎么读（本机没有视觉模型 ⇒ 只能读颜色与结构）──────────────────────────
 *
 * ★ 不比较"好不好看"，只比较**三个面的相对明度**与**有没有阴影那一笔**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { ROOM_PALETTE } = await import(join(ROOT, 'lib', 'client', 'room-canvas.js'))
const { toScreen } = await import(join(ROOT, 'lib', 'client', 'room-iso.js'))
const SOURCE = readFileSync(join(ROOT, 'src', 'client', 'room-canvas.ts'), 'utf8')

/** 相对亮度（WCAG 公式；只用来比大小，不用来判可读性）。 */
function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  const channel = (value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 三明度、一个光源（rule 5）
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 1：每个立方体都是 `top > left > right`（光从左上来，**不许按物件翻**）', () => {
  const solids = [
    { name: '桌子', top: ROOM_PALETTE.deskTop, left: ROOM_PALETTE.deskLeft, right: ROOM_PALETTE.deskRight },
    { name: '椅子', top: ROOM_PALETTE.chairTop, left: ROOM_PALETTE.chairLeft, right: ROOM_PALETTE.chairRight },
  ]
  for (const solid of solids) {
    const [t, l, r] = [luminance(solid.top), luminance(solid.left), luminance(solid.right)]
    assert.ok(
      t > l,
      `★★ ${solid.name}：顶面(${solid.top}) 必须比左面(${solid.left}) 亮 —— 光从左上来`,
    )
    assert.ok(
      l > r,
      `★★ ${solid.name}：左面(${solid.left}) 必须比右面(${solid.right}) 亮 —— `
      + '规范逐字「top lightest, left face middle, right face darkest… Never flip it per object」',
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 每个物件都有接地阴影（rule 15）
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 2：每个工位都画了接地阴影（没有它，桌椅看起来是"贴上去的"）', () => {
  assert.match(
    SOURCE, /接地阴影/,
    '★ 必须找得到那段阴影的注释（找不到说明它被删了，而"删了"与"从没画过"同形）',
  )
  assert.match(
    SOURCE, /rgba\(6,5,10,0\.45\)/,
    '★★ 阴影必须是一笔**半透明暗色** —— 不透明会变成一块地板，完全透明则等于没有',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★ 绘制顺序按 `x + y`（rule 8）
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 3：站着的东西按 `u + v` **从远到近**画（否则前面的人会被后面的人盖住）', () => {
  assert.match(
    SOURCE, /sort\(\(a, b\) => \(a\.seat\.col \+ a\.seat\.row\) - \(b\.seat\.col \+ b\.seat\.row\)\)/,
    '★★ 不按 u+v 排序 ⇒ "被盖住"与"这个人不在"在画面上同形（本仓记账最久的那类合流）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★ 投影公式与规范逐字一致（rule 18）
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 4：投影公式 `((x−y)·W/2, (x+y)·H/2 − z)` 与规范 rule 18 一致', () => {
  /** ★ 用**几个点**核对，而不是读源码文本 —— 读文本会把"注释里写了公式"当成实现。 */
  const W = 16
  const H = 8
  for (const [u, v, h] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [3, 2, 0], [3, 2, 10]]) {
    const got = toScreen(u, v, h)
    assert.equal(got.x, (u - v) * (W / 2), `★ (${u},${v},${h}) 的 x`)
    assert.equal(got.y, (u + v) * (H / 2) - h, `★ (${u},${v},${h}) 的 y`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 地板必须比墙**暗**（这是"房间不是坑"的物理前提）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 5：地板比墙暗（亮上暗下是重力的语言，反过来就是塌陷）', () => {
  const floor = Math.min(luminance(ROOM_PALETTE.floorA), luminance(ROOM_PALETTE.floorB))
  const wall = Math.min(luminance(ROOM_PALETTE.wallBack), luminance(ROOM_PALETTE.wallSide))
  assert.ok(
    floor < wall,
    `★★ 地板(${floor.toFixed(3)}) 必须比墙(${wall.toFixed(3)}) 暗 —— `
    + 'MEASURED（第四版截图）：地板比墙亮时看起来像**挖开的坑**',
  )
})
