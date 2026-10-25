/**
 * ── ★★★ 像素小人：字符画必须**真的画得出来**（需求 §27.5）───────────────────────────
 *
 * ── 为什么这个文件存在 ────────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-22，用户截图）：第一版"小人"是两个灰方块拼的，用户评语
 * 「**目前这个很显然跟我想要的风格、跟我想的画面不一样**」。
 *
 * ★★ 改成 24×24 字符画之后，"画对了没有"第一次**可以单测**：
 *   行数、列数、用到的调色板键、五个 `doing` 的两两不同形 —— 全是可数的。
 *   这是字符画相对 PNG 的决定性好处（本机没有视觉模型，看不了图）。
 *
 * ── 五条要点 ──────────────────────────────────────────────────────────────────
 *
 * ```
 * ① 24 行 × 24 列，一格不差（差一格 = 画歪了，而画歪了与"设计如此"同形）
 * ② 每个字符要么是 '.'，要么在调色板里（拼错一个键 = 那个像素透明 = 身上一个洞）
 * ③ ★ 五态两两不同形（本仓 §4）：五个 doing 不许有任意两个帧完全相同
 * ④ ★ `away` 是**全透明**（椅子空着）；`unknown` 是一个 `?`（读不到）
 * ⑤ 轮廓闭合：最外层可见像素必须是 `k`（否则小人在深底上"没有边"）
 * ```
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { spriteOf, SPRITE_GRID, SPRITE_PALETTE } = await import(join(ROOT, 'lib', 'client', 'room-sprite.js'))

const DOINGS = ['working', 'idle', 'not-spawned', 'away', 'unknown']

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：尺寸
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 1：每一帧都是 24 行 × 24 列（差一格就是画歪了）', () => {
  for (const doing of DOINGS) {
    const rows = spriteOf(doing)
    assert.equal(rows.length, SPRITE_GRID, `★ ${doing} 的行数是 ${rows.length}，应当是 ${SPRITE_GRID}`)
    rows.forEach((row, index) => {
      assert.equal(row.length, SPRITE_GRID, `★★ ${doing} 第 ${index} 行有 ${row.length} 列，应当是 ${SPRITE_GRID}（画歪了）`)
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：调色板键必须都存在
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 2：每个字符要么是 `.`，要么在调色板里（拼错一个键 = 身上一个洞）', () => {
  const unknown = new Set()
  for (const doing of DOINGS) {
    for (const row of spriteOf(doing)) {
      for (const char of row) {
        if (char === '.' || char === '?') continue
        if (!(char in SPRITE_PALETTE)) unknown.add(`${doing}:${char}`)
      }
    }
  }
  assert.deepEqual([...unknown], [], `★★ 这些字符不在调色板里 ⇒ 那几个像素会**透明**（小人身出现洞）：${[...unknown].join(', ')}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ 五态两两不同形
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 3：五个 `doing` 的帧**两两不同**（不许有两个状态长得一样）', () => {
  const frames = DOINGS.map((doing) => ({ doing, key: spriteOf(doing).join('\n') }))
  const seen = new Map()
  for (const { doing, key } of frames) {
    const previous = seen.get(key)
    assert.equal(
      previous, undefined,
      `★★ ${doing} 与 ${previous} 画出来**完全一样** —— 而它们的补救动作相反（§4：两件不同的事不许同形）`,
    )
    seen.set(key, doing)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★ away 全透明 · unknown 是一个 `?`
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 4：`away` 全透明（椅子空着）；`unknown` 用 `?` 画（读不到 ≠ 闲着）', () => {
  const away = spriteOf('away').join('')
  assert.equal(away.replaceAll('.', ''), '', '★★ `away` 必须一个像素都没有 —— 它的意思是"这里没人"')

  const unknown = spriteOf('unknown').join('')
  assert.ok(unknown.includes('?'), '★★ `unknown` 必须用 `?` 画：**读不到**要看得出来，而不是长得像一个人')
  /** ★★ 反向半边：`unknown` 不许长得像 `idle`（那会让"读不到"与"闲着"同形）。 */
  assert.notEqual(unknown, spriteOf('idle').join(''))
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：轮廓闭合
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 5：可见像素的最外圈必须是轮廓色 `k`（否则深底上"没有边"）', () => {
  for (const doing of ['working', 'idle', 'not-spawned']) {
    const rows = spriteOf(doing)
    /** ★ 逐行检查"最左/最右的可见像素是 k"。 */
    for (const [index, row] of rows.entries()) {
      const visible = [...row].map((char, col) => ({ char, col })).filter((entry) => entry.char !== '.')
      if (visible.length === 0) continue
      const first = visible[0]
      const last = visible[visible.length - 1]
      assert.equal(
        first.char, 'k',
        `★ ${doing} 第 ${index} 行最左边的可见像素是 '${first.char}'，必须是 'k'（轮廓）`,
      )
      assert.equal(
        last.char, 'k',
        `★ ${doing} 第 ${index} 行最右边的可见像素是 '${last.char}'，必须是 'k'（轮廓）`,
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★ 有眼睛（否则"小人"读成一个方块）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 6：可见的人形必须**有眼睛**（`e` 瞳孔至少 2 个像素）', () => {
  for (const doing of ['working', 'idle']) {
    const pixels = spriteOf(doing).join('')
    const pupils = [...pixels].filter((char) => char === 'e').length
    assert.ok(
      pupils >= 2,
      `★★ ${doing} 只有 ${pupils} 个瞳孔像素 —— 参照物的规矩是「Eyes are at least 2 × 2 pixels, so the face reads」`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：working 与 idle 的差别是**手**（不只是颜色）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 7：`working` 与 `idle` 的差别落在**像素**上（不是只换颜色）', () => {
  const working = spriteOf('working')
  const idle = spriteOf('idle')
  const differing = working.filter((row, index) => row !== idle[index]).length
  assert.ok(
    differing >= 1,
    '★★ 两帧逐字节相同 ⇒ "在敲键盘"与"坐着"在画面上同形（而它们的补救动作相反）',
  )
  assert.ok(differing <= 4, `★ 差别只该是手（实测 ${differing} 行不同）—— 差太多说明那是两个不同的角色`)
})
