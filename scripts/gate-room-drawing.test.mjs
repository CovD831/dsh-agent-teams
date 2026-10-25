/**
 * ── ★★★ 房间**画法**的四条几何/对比度纪律（2026-10-22 第四轮）──────────────────────
 *
 * ── 这个文件为什么存在 ──────────────────────────────────────────────────────────
 *
 * 用户两次说「跟我想的画面不一样」，而我第一次去**看图**（参照物在 `docs/reference/`）
 * 之后，发现了**四个能量出来的错**，它们此前**没有任何判据会红**：
 *
 * ```
 * ① 相邻工位只隔 8px，而小人是 24px  ⇒ 每个人有 2/3 被下一个人盖住
 * ② 相邻两排只隔 4px，而显示器高 8px ⇒ 后排被前排挡死
 * ③ 一行 6 人 ⇒ 人排成一条横线、房间下面 10 排全空（读起来像表格，不像办公室）
 * ④ 桌子 vs 地板只有 2.1:1，桌子 vs 墙只有 1.6:1 ⇒ 深色主题下"糊成一团"
 * ```
 *
 * ★★★ 四条**都不是审美问题**。它们各自有一个数，而那个数可以算、可以断言。
 *   这正是本仓 §27.4 的纪律：「画得好不好看」不进判据，但**画法**可以。
 *
 * ── 判据怎么读（★ 本机没有视觉模型，也不联网）────────────────────────────────────
 *
 * ```
 * 臂 1  座位横向间距 ≥ 精灵宽（否则人叠人）
 * 臂 2  座位纵向间距 ≥ 显示器高（否则后排被挡）
 * 臂 3  ★ 反向半边：**不许**为了"一屏放得下"把间距调回去
 * 臂 4  桌子 vs 地板 ≥ 3:1（与参照物实测的 3.3:1 同量级）
 * 臂 5  显示器机身**不是黑的**（它要是黑的，会把桌面又遮回去）
 * 臂 6  ★★ 每个小人头上有名牌，且五态**不同色**（"读不到"不许长得像"闲着"）
 * 臂 7  ★★ 预览图**由 `drawRoom()` 渲染**，不是另画一遍（一份真相）
 * ```
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { ROOM_PALETTE } = await import(join(ROOT, 'lib', 'client', 'room-canvas.js'))
const { TW, TH } = await import(join(ROOT, 'lib', 'client', 'room-iso.js'))
const { SPRITE_GRID } = await import(join(ROOT, 'lib', 'client', 'room-sprite.js'))
const {
  roomPlanOf, SEAT_STRIDE, SEAT_ROW_STRIDE, SEATS_PER_ROW,
} = await import(join(ROOT, 'lib', 'client', 'room-plan.js'))

const CANVAS_SRC = readFileSync(join(ROOT, 'src', 'client', 'room-canvas.ts'), 'utf8')
const PREVIEW_SRC = readFileSync(join(ROOT, 'scripts', 'render-room-preview.mjs'), 'utf8')

/** 相对亮度（WCAG）。★ 只用来比大小，不用来判可读性。 */
function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  const channel = (value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG 对比度（1:1 ~ 21:1）。 */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 造一个团队（只带 `roomPlanOf` 需要的字段）。 */
function team(id, size) {
  return {
    teamId: id, name: id, workspace: 'w',
    members: Array.from({ length: size }, (_, i) => ({ name: `m${i}`, liveness: 'working' })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 座位横向间距 ≥ 精灵宽
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 1：同一行相邻工位的**屏幕间距** ≥ 小人宽度（否则人叠人）', () => {
  /**
   * MEASURED（修之前）：`col` 差 1 ⇒ 屏幕 x 差 `TW/2 = 8px`，而 `SPRITE_GRID = 24`
   * ⇒ 重叠 16px。**这就是"挤成一堆"的根因**，而它此前没有任何东西会红。
   */
  const gap = (SEAT_STRIDE * TW) / 2
  assert.ok(
    gap >= SPRITE_GRID,
    `★★★ 相邻工位只隔 ${gap}px，而小人是 ${SPRITE_GRID}px ⇒ 重叠 ${SPRITE_GRID - gap}px`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 座位纵向间距 ≥ 显示器高
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 2：相邻两排的**屏幕间距** ≥ 显示器高度（否则后排被前排挡死）', () => {
  /**
   * MEASURED（修之前）：`row` 差 1 ⇒ 屏幕 y 差 `TH/2 = 4px`，而显示器高 8px
   * ⇒ 后排被完全挡住 —— 而"被挡住"与"这排没人"在画面上同形。
   */
  const gap = (SEAT_ROW_STRIDE * TH) / 2
  const monitorHeight = 8
  assert.ok(
    gap >= monitorHeight,
    `★★ 相邻两排只隔 ${gap}px，而显示器高 ${monitorHeight}px ⇒ 后排被挡`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 反向半边 —— 间距不许为了"一屏放得下"被调回去
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 3（反向半边）：`SEAT_STRIDE` / `SEAT_ROW_STRIDE` 都不许小于 2', () => {
  /**
   * ★★ 为什么这条是**反向**的：这两个数直接决定房间有多宽/多高。
   *   而"一屏放得下一整间房"是一个**很诱人**的目标 —— 用户也说过想要。
   *   ⇒ 于是有人会为了它把 stride 调回 1，而那会**悄悄**让人重新叠起来。
   * ★ 这条臂把那个取舍**摆到明面上**：要一屏放得下，就得改精灵大小或分页，
   *   **不许**靠让人重叠来换。
   */
  assert.ok(SEAT_STRIDE >= 2, `★ SEAT_STRIDE=${SEAT_STRIDE} —— 小于 2 会让人重叠`)
  assert.ok(SEAT_ROW_STRIDE >= 2, `★ SEAT_ROW_STRIDE=${SEAT_ROW_STRIDE} —— 小于 2 会让后排被挡`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★ 桌子 vs 地板 ≥ 3:1
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 4：桌面与地板的对比度 ≥ 3:1（参照物实测 3.3:1）', () => {
  /**
   * MEASURED（2026-10-22 第四轮，`python3` 量图）：
   * ```
   * 参照物 agent-cockpit：桌面 #726c6e vs 地板 #1d1a37 ⇒ 3.3 : 1
   * 我们（修之前）：      桌面 #5b4f69 vs 地板 #26212f ⇒ 2.1 : 1
   *                                    vs 墙 #3a3348 ⇒ 1.6 : 1  ← 最糟的一格
   * ```
   * ★★ 1.6:1 就是"糊成一团"的**可测定义** —— 桌子与墙几乎分不出来。
   */
  const floor = contrast(ROOM_PALETTE.deskTop, ROOM_PALETTE.floorA)
  assert.ok(floor >= 3, `★★ 桌面 vs 地板只有 ${floor.toFixed(2)}:1，需要 ≥ 3:1`)
  const wall = contrast(ROOM_PALETTE.deskTop, ROOM_PALETTE.wallBack)
  assert.ok(wall >= 2, `★★ 桌面 vs 墙只有 ${wall.toFixed(2)}:1，需要 ≥ 2:1（否则桌子"融进墙里"）`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★ 显示器机身不是黑的
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 5：显示器**机身**比屏幕亮（否则它是一块黑洞，把桌面遮回去）', () => {
  /**
   * MEASURED：参照物 agent-cockpit 的显示器机身是 `#58565b`（亮度 0.095），
   * **屏幕才是黑的**。我们此前把机身写成 `#0b0b10`（亮度 0.0035）
   * ⇒ 显示器成了一块黑洞，刚提亮的桌面又被遮回去。
   * ★ 而"机身比屏幕亮"是物理事实（塑料外壳反光，屏幕画面暗）。
   */
  const frame = luminance(ROOM_PALETTE.monitorFrame)
  const screen = luminance(ROOM_PALETTE.screenIdle)
  assert.ok(
    frame > screen,
    `★★ 显示器机身（${frame.toFixed(4)}）必须比屏幕（${screen.toFixed(4)}）亮 —— 否则它是黑洞`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★★★ 每个小人头上有名牌，且五态不同色
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 6：每个小人画一块**头顶名牌**，且五个 `doing` 的颜色两两不同', () => {
  /**
   * ★★ 为什么名牌必须画在**画面里**：我们的名字此前只在 canvas 外面的 `<ul>` 里
   * ⇒ **看画面时不知道谁是谁**，房间退化成一个装饰图，信息仍要去读列表。
   * ★ 而参照物（pixtuoid 的 `#working` / `#idle-a`、agent-cockpit 的状态点）都有这一格。
   */
  assert.match(CANVAS_SRC, /kind: 'tag'/, '★★ 没有 `kind: \'tag\'` ⇒ 名牌没画')

  const block = CANVAS_SRC.slice(CANVAS_SRC.indexOf('const TAG_COLOR'), CANVAS_SRC.indexOf('/** 一个可以被夹具核对'))
  const colours = [...block.matchAll(/'#[0-9a-f]{6}'/g)].map((entry) => entry[0])
  assert.equal(colours.length, 5, `★★ 名牌色应有 5 个（五态各一），实际 ${colours.length} 个`)
  assert.equal(new Set(colours).size, 5, '★★ 五态必须有**五个不同**的颜色 —— 否则"读不到"长得像"闲着"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★★★ 预览图由真实 `drawRoom()` 渲染（一份真相）
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 7：预览图渲染器 import 的是 `lib/client/room-canvas.js`，不是自己画一遍', () => {
  /**
   * MEASURED（本轮发现的漂移）：旧的 `render-room-preview.py` 是 `room-canvas.ts`
   * 的**重实现**，而它已经漂了 ——
   * ```
   * TS 里  deskTop '#5b4f69'（后来改成 '#8a7a9e'）
   * py 里  deskTop '#564a63'（更早的旧值）
   * ```
   * ⇒ **预览图与真实界面不是同一件事**，而"预览图看着对"因此**不可信**。
   * ★★ 这是本仓 §4 那条纪律的又一次复现：**同一个事实有两份真相**。
   */
  assert.match(
    PREVIEW_SRC,
    /from ['"]\.\.?\/.*lib['"],\s*['"]client['"],\s*['"]room-canvas\.js['"]|room-canvas\.js/,
    '★★★ 预览渲染器必须 import 真实的 `drawRoom`，不许重实现',
  )
  assert.equal(
    /fillStyle\s*=\s*'#[0-9a-f]{6}';\s*\/\/\s*桌面/.test(PREVIEW_SRC),
    false,
    '★ 预览渲染器里出现了硬编码的调色板 —— 那正是上一版漂移的形态',
  )
  /** ★ 而它必须**真的调用** `drawRoom`，不是只 import。 */
  assert.match(PREVIEW_SRC, /drawRoom\(recorder/, '★★ 必须真的调用 `drawRoom()`')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：★ 一行几个工位 —— 人排成方块，不是一条线
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 8：`SEATS_PER_ROW` 小到让人排成**方块**（一行 6 个 ⇒ 一条横线）', () => {
  /**
   * MEASURED（第三版预览图）：9 个人 / 一行 6 个 ⇒ 前 6 个人一条横线、房间 20×12、
   * **下面 10 排全是空地板** ⇒ 读起来是"一排人贴在墙边"，不是办公室。
   * 参照物 pixtuoid：12 个工位排成 **3 列 × 4 排的方块**。
   */
  assert.ok(
    SEATS_PER_ROW <= 4,
    `★ SEATS_PER_ROW=${SEATS_PER_ROW} —— 大于 4 会让 9 个人排成一条横线，房间大半空着`,
  )
  assert.ok(SEATS_PER_ROW >= 2, '★ 小于 2 会让每个团队占太多排，房间被拉成一条竖线')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9：★★ 反向半边 —— 房间仍然**装得下**（间距变大不等于无限变大）
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 9（反向半边）：9 个人 + 2 个团队的房间，宽高都不超过 24 格', () => {
  /**
   * ★★ 这条防的是"为了不重叠而把房间撑到放不下"。
   *   间距放大 3 倍之后，9 人 2 队应当落在 11×15 附近 —— 而它是**可读的**。
   * ★ 上界给 24 是刻意的宽松：真实语料是 35 人 / 8 队，那会更大（见 gate-room-plan 臂 7）。
   */
  const plan = roomPlanOf([team('alpha', 6), team('beta', 3)])
  assert.ok(plan.cols <= 24, `★★ 房间 ${plan.cols} 列 —— 9 个人不该要这么宽`)
  assert.ok(plan.rows <= 24, `★★ 房间 ${plan.rows} 排 —— 9 个人不该要这么高`)
})
