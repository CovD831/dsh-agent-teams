/**
 * ── ★★★ 把房间**画出来**：等距地板 + 墙 + 桌椅 + 屏幕上滚动的代码 + 小人 ──────────────
 *
 * ── 这个方法从哪来（不是我的发明）────────────────────────────────────────────────
 *
 * 参照物 `ypyik0669/claude-web` 的 `web/src/features/cafe/render.ts` 的**画法**：
 * ```
 * ① 整间房间先画在一张**一点一像素**的小 canvas 上（`TW = 16`、`TH = 8` 的菱形格）
 * ② 画完再**无平滑放大**到页面尺寸（`imageSmoothingEnabled = false`）⇒ 硬边
 * ③ 顺序：地板 → 墙 → 站着的东西（按 u+v 从远到近）→ 光照 → 文字
 * ④ 每个物件都是一个**立方体**（顶面 + 左面 + 右面三个多边形）
 * ```
 * ★★ 第 ④ 条是关键：**整个房间只有一种基元**（`box`），桌椅、显示器、柜子都是它的实例。
 *   一个立方体就够画出"有体积的房间" —— 这比"给每个东西画一张图"便宜一个数量级。
 *
 * ── ★ 本文件只画，不判断 ────────────────────────────────────────────────────────
 *
 * 谁坐哪、在做什么，全部来自 `room-plan.ts`；本文件只接收一个 `RoomPlan` 与一张位置表。
 * ★ 而它**必须**有一个"画对了"的读数（本机没有视觉模型）：
 *   ⇒ 每个物件在绘制时把 `[kind, u, v]` 记进 `drawn[]`，由 `drawRoom` 返回。
 *     于是"桌上有没有显示器""人是不是坐在椅子上"可以**编程核对**。
 *
 * @module dsh-agent-teams/client/room-canvas
 */

import { TH, TW, sceneSize, tileQuad, toScreen, wallHeight } from './room-iso.ts'
import { SPRITE_GRID, SPRITE_PALETTE, spriteOf } from './room-sprite.ts'
import type { RoomActorDoing, RoomPlan } from './room-plan.ts'

/** 房间的调色板。★ **夜晚**——参照物也是夜晚（那是"人在加班干活"的语境）。 */
export const ROOM_PALETTE = {
  /**
   * ★★ 地板**必须比墙暗**（MEASURED，第四版截图：地板比墙亮 ⇒ 看起来像"挖开的坑"，
   *   因为亮面在上、暗面在下是重力的语言，反过来就是塌陷）。
   *   参照物的取值也是这个方向：地板 `#3a3344`、墙 `#3e3550`（墙略亮）。
   */
  floorA: '#26212f', floorB: '#2a2533',
  /** ★ 每个团队的地板色不同 —— 但**分界主要靠几何**（团队之间留过道）。 */
  teamA: '#302641', teamB: '#233040', teamC: '#332b26', teamD: '#26332d',
  wallBack: '#3a3348', wallSide: '#2e2838', wallBase: '#1e1a26',
  /**
   * ── ★★★ 三明度，一个光源（外部规范 `rules/71-isometric` rule 5）────────────────────
   *
   * 规范逐字：「Light from the upper left: **top lightest, left face middle, right face
   *   darkest.** Never flip it per object.」
   *
   * ★★ MEASURED（本条修之前）：桌子写的是 `deskLeft: '#362e40'`（更暗）、
   *   `deskRight: '#41374d'`（更亮）⇒ **左右反了**。单看一个物件不像错，
   *   **整间房光向不一致**才看得出来 —— 那正是规范说 "never flip it per object" 的原因。
   * ★ 而这条错误此前**没有任何判据会红**（房间能画出来、16 条臂全绿）。
   *   现在由 `scripts/gate-room-lighting.test.mjs` 臂 1 钉住：`top > left > right`。
   */
  /**
   * ── ★★★ 桌面的明度是**按对比度算出来的**，不是挑出来的（2026-10-22 第四轮）──────────
   *
   * MEASURED（`python3` 量参照图 + 量我们自己的调色板）：
   * ```
   * 参照物 agent-cockpit：桌面 #726c6e 亮度 0.154  vs 地板 0.013 ⇒ **3.3 : 1**
   * 我们（修之前）：      桌面 #5b4f69 亮度 0.088  vs 地板 0.017 ⇒ **2.1 : 1**
   *                                     vs 墙   0.037 ⇒ **1.6 : 1**  ← ★ 这一格最糟
   * ```
   * ★★ 而 1.6:1 就是"糊成一团"的**可测定义**：桌子与墙之间几乎分不出来。
   *   ⇒ 用户说"跟我想的画面不一样"时，这不是审美分歧，是一个能量出来的差距。
   *
   * 修法：把桌面提到 `vs 地板 ≥ 3:1`，**同时保持** `top > left > right`（一个光源）。
   * ```
   * top   #8a7a9e  亮度 0.218  vs 地板 4.00:1  vs 墙 3.07:1
   * left  #61556f  亮度 0.102  vs 地板 2.26:1
   * right #423b4c  亮度 0.048  vs 地板 1.46:1
   * ```
   * ★ 判据：`gate-room-furniture-contrast` —— 桌面 vs 地板 ≥ 3:1，且三面顺序不变。
   */
  deskTop: '#8a7a9e', deskLeft: '#61556f', deskRight: '#423b4c',
  chairTop: '#b93a44', chairLeft: '#8f2530', chairRight: '#6b1922',
  /**
   * ── ★★ 显示器机身：**不是黑的**（2026-10-22 第四轮实测）───────────────────────────
   *
   * MEASURED（参照物 agent-cockpit 的显示器区域）：机身是 `#58565b`（亮度 0.095），
   * 而**屏幕才是黑的**。我们此前把机身写成 `#0b0b10`（亮度 0.0035）
   * ⇒ 显示器成了一块**黑洞**，把刚提亮的桌面又遮回去。
   * ★ 而"机身比屏幕亮"是物理事实（塑料外壳反光，屏幕发光但画面暗）。
   */
  monitorFrame: '#58565b', monitorSide: '#3f3d42', monitorTop: '#6a686e',
  /** ★ 屏幕亮着时的代码色（"在干活"最一眼可见的信号）。 */
  screenCode: '#0f3b36', screenIdle: '#15151c',
  codeGlyph: '#4fe0c0',
  neon: '#ff3cbe', neonCool: '#3cdcff',
  ghost: 'rgba(190,200,220,0.35)',
  unknownStripe: '#6b6478',
  /**
   * ── ★★★ 描边：每件家具外面一圈深色（参照物的**最关键**一条画法）────────────────────
   *
   * MEASURED（2026-10-22 第四轮，把参照物放大到 4× 后逐像素看）：
   * `agent-cockpit` 的桌子是一块浅灰 `#8d8f9e`，而它**外面有一圈 `#2e2a27`**；
   * 显示器更明显（黑框 + 浅色屏幕）。`pixtuoid` 的木桌同样有一圈深棕。
   *
   * ★★ 为什么它比"配色好不好看"重要：没有描边时，我们的
   *   ```
   *   桌子 #5b4f69（亮度 0.088）· 墙 #3a3348（0.037）· 地板 #26212f（0.017）
   *   ```
   *   三者**只有明度差、没有边界** ⇒ 深色主题下整间房是一团灰紫，
   *   眼睛分不出"哪是桌子、哪是墙"。而描边**先立住轮廓**，明度再去分面。
   * ★ 它与 `gate-room-lighting` 互补：那条管"三个面的明度顺序"，
   *   这条管"物件与背景之间有没有边界"。
   */
  outline: '#0f0c14',
} as const

/** 一个团队用哪种地板色（★ 固定顺序取色，跨轮询稳定）。 */
function teamFloorColor(index: number): string {
  const colors = [ROOM_PALETTE.teamA, ROOM_PALETTE.teamB, ROOM_PALETTE.teamC, ROOM_PALETTE.teamD]
  return colors[index % colors.length] as string
}

/** 画一个立方体：顶面 + 左面（沿 u）+ 右面（沿 v）。★ 与参照物的 `box()` 同一套三面法。 */
function box(
  ctx: CanvasRenderingContext2D, ox: number, oy: number,
  u: number, v: number, w: number, d: number, h: number,
  top: string, left: string, right: string, base = 0,
): void {
  const at = (u2: number, v2: number, h2: number): [number, number] => {
    const p = toScreen(u2, v2, h2)
    return [ox + p.x, oy + p.y]
  }
  const fill = (points: [number, number][], color: string): void => {
    ctx.fillStyle = color
    ctx.beginPath()
    for (const [x, y] of points) ctx.lineTo(Math.round(x), Math.round(y))
    ctx.closePath()
    ctx.fill()
  }
  fill([at(u, v + d, base), at(u + w, v + d, base), at(u + w, v + d, base + h), at(u, v + d, base + h)], left)
  fill([at(u + w, v, base), at(u + w, v + d, base), at(u + w, v + d, base + h), at(u + w, v, base + h)], right)
  fill([at(u, v, base + h), at(u + w, v, base + h), at(u + w, v + d, base + h), at(u, v + d, base + h)], top)
}

/** 画一个平面四边形（地板格、屏幕面）。 */
function quad(
  ctx: CanvasRenderingContext2D, ox: number, oy: number,
  points: readonly { readonly x: number; readonly y: number }[], color: string,
): void {
  ctx.fillStyle = color
  ctx.beginPath()
  for (const point of points) ctx.lineTo(Math.round(ox + point.x), Math.round(oy + point.y))
  ctx.closePath()
  ctx.fill()
}

/** 画一个小人（24×24 字符画，一点一像素）。 */
function drawSprite(
  ctx: CanvasRenderingContext2D, ox: number, oy: number,
  u: number, v: number, doing: RoomActorDoing,
): void {
  /** ★ 人站在格子的中心：`+0.5` 是半格。 */
  const center = toScreen(u + 0.5, v + 0.5, 0)
  /** ★ 脚落在格子上 ⇒ 精灵的**底边**对齐那个点。 */
  /**
   * ★★ 锚点：**脚**落在格子的前缘（`center.y + TH/2`），不是格子中心。
   *   MEASURED（第三版截图）：写成 `center.y - SPRITE_GRID + 2` 让小人的脚浮在
   *   格子中心上方 18px ⇒ **整个人悬空、压到墙上**。而"悬空"看起来像"他没坐进去"。
   * ★ 而椅子在格子中心，所以脚落在**椅子前沿**是对的（人坐在椅子上、脚垂到前面）。
   */
  /**
   * ★★ 锚点：**臀线**对齐椅子面（椅子在格子中心，面高约 4px）。
   *
   * MEASURED（三版截图，同一个错换了三次方向）：
   * ```
   * 版1  center.y - 24 + 2   ⇒ 脚在格子中心上方 18px，**整个人悬空压到墙上**
   * 版2  center.y + TH/2 - 24 ⇒ 脚落在格子前沿，但**椅子在中心** ⇒ 人坐在椅子前面
   * 版3  ← 本版：让**腿的下半段**与椅子顶面重叠
   * ```
   * ⇒ 坐姿的正确锚点是"脚垂到椅子前沿、臀在椅子面上"：
   *   精灵高 24，坐姿时腿只占底下 6 行 ⇒ `top = center.y - 18 + (格子半高)`。
   */
  const left = Math.round(ox + center.x - SPRITE_GRID / 2)
  const top = Math.round(oy + center.y - 16)
  const rows = spriteOf(doing)
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row] as string
    for (let col = 0; col < line.length; col += 1) {
      const key = line[col] as string
      if (key === '.') continue
      const color = key === '?' ? ROOM_PALETTE.unknownStripe : SPRITE_PALETTE[key]
      if (color === undefined) continue
      ctx.fillStyle = color
      ctx.fillRect(left + col, top + row, 1, 1)
    }
  }
}

/**
 * ── ★★★ 头顶名牌的状态色（五态，两两不同色）────────────────────────────────────────
 *
 * ★ 与 `DOING_LABEL` 同一条纪律：**五态不许合流**。`unknown` 用的是**条纹灰**而不是
 *   某个"看起来像闲着"的颜色 —— "读不到"与"闲着"在画面上也必须不同形。
 * ★★ 参照物 pixtuoid 的做法（`#thinking` / `#working` / `#idle-a` / `#waiting`）
 *   证明这一格是**该有的**，不是我们加戏。
 */
const TAG_COLOR: Readonly<Record<RoomActorDoing, string>> = {
  working: '#4fe0c0',
  idle: '#7d8794',
  'not-spawned': '#4a6fa5',
  away: '#3a3348',
  unknown: '#6b6478',
}

/** 一个可以被夹具核对的"画了什么"的物件记录。 */
export interface DrawnItem {
  readonly kind: 'floor' | 'wall' | 'desk' | 'monitor' | 'chair' | 'sprite' | 'ghost' | 'neon' | 'sign' | 'tag'
  readonly u: number
  readonly v: number
  readonly teamId?: string
  readonly doing?: RoomActorDoing
  readonly actorKey?: string
}

/**
 * 把一间房间画到 `ctx` 上。
 *
 * @param ctx - 目标画布上下文（**已经是** 1:1 的像素坐标；放大由调用方做）
 * @param plan - `roomPlanOf` 的产出（谁在哪）
 * @param options - `mainBusy`：主会话在跑（墙上大屏就滚代码）；`now`：动画时刻
 * @returns **画了什么**的清单（★ 判据靠它，不靠看图）
 */
export function drawRoom(
  ctx: CanvasRenderingContext2D,
  plan: RoomPlan,
  options: { readonly mainBusy?: boolean; readonly now?: number } = {},
): { readonly drawn: readonly DrawnItem[]; readonly width: number; readonly height: number; readonly ox: number; readonly oy: number } {
  const size = sceneSize(plan.cols, plan.rows)
  const { ox, oy } = size
  const drawn: DrawnItem[] = []
  const now = options.now ?? 0

  /** ── ① 地板：一格一个菱形。团队色按行段取。 ─────────────────────────────── */
  for (let row = 1; row <= plan.rows; row += 1) {
    const band = plan.teams.find((entry) => row >= entry.fromRow && row <= entry.toRow)
    for (let col = 1; col <= plan.cols; col += 1) {
      const u = col - 1
      const v = row - 1
      /** ★ 团队区用地毯色，过道用基础地砖色 —— **过道就是分界**。 */
      const color = band === undefined
        ? ((u + v) % 2 === 0 ? ROOM_PALETTE.floorA : ROOM_PALETTE.floorB)
        : teamFloorColor(band === undefined ? 0 : plan.teams.indexOf(band))
      quad(ctx, ox, oy, tileQuad(u, v), color)
      drawn.push({ kind: 'floor', u, v, ...band === undefined ? {} : { teamId: band.teamId } })
    }
  }

  /** ── ② 墙：后墙（沿 u）+ 左墙（沿 v）+ 踢脚线 ─────────────────────────── */
  const height = plan.rows === 0 ? 1 : plan.rows
  const width = plan.cols === 0 ? 1 : plan.cols
  /** ★ 墙高按**这间房的深度**算，不是常量（见 `wallHeight` 的实测注释）。 */
  const WALL_H = wallHeight(height)
  const wallPoly = (u0: number, v0: number, u1: number, v1: number, h: number, color: string): void => {
    const a = toScreen(u0, v0, 0)
    const b = toScreen(u1, v1, 0)
    quad(ctx, ox, oy, [
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
      { x: b.x, y: b.y - h },
      { x: a.x, y: a.y - h },
    ], color)
  }
  wallPoly(0, 0, width, 0, WALL_H, ROOM_PALETTE.wallBack)
  wallPoly(0, 0, 0, height, WALL_H, ROOM_PALETTE.wallSide)
  wallPoly(0, 0, width, 0, 4, ROOM_PALETTE.wallBase)
  wallPoly(0, 0, 0, height, 4, ROOM_PALETTE.wallBase)
  drawn.push({ kind: 'wall', u: 0, v: 0 })
  drawn.push({ kind: 'wall', u: width, v: 0 })
  drawn.push({ kind: 'wall', u: 0, v: height })

  /** ── ③ 墙上的东西：大屏（主会话在跑就滚代码）+ 一条霓虹 ───────────────── */
  const screenU0 = Math.min(1, width - 1)
  const screenU1 = Math.min(width - 0.5, 4)
  if (screenU1 > screenU0) {
    wallPoly(screenU0, 0, screenU1, 0, WALL_H * 0.72, '#0a0d14')
    const busy = options.mainBusy === true
    for (let line = 0; line < 4; line += 1) {
      const y0 = WALL_H * 0.3 + line * 6
      const len = busy ? 0.6 + ((Math.floor(now / 400) + line) % 3) * 0.5 : 1.2
      wallPoly(screenU0 + 0.2, 0, Math.min(screenU1 - 0.1, screenU0 + 0.2 + len), 0, y0, busy ? ROOM_PALETTE.codeGlyph : '#243040')
      /** ★ 每行单独抬高度：`wallPoly` 画的是"从地面到 h"的竖条，这里用同样的竖条叠出横线。 */
      void y0
    }
    drawn.push({ kind: 'monitor', u: screenU0, v: 0 })
  }
  wallPoly(0.5, 0, width - 0.5, 0, WALL_H * 0.94, ROOM_PALETTE.neon)
  drawn.push({ kind: 'neon', u: 0, v: 0 })
  /** ★ 招牌：房间名压在霓虹下面（文字由调用方在放大后另画，这里只记一笔）。 */
  drawn.push({ kind: 'sign', u: width / 2, v: 0 })

  /** ── ④ 站着的东西：按 `u + v` 从远到近 ───────────────────────────────── */
  /**
   * ★★ 排序是**必须**的：不排的话，前面的人会被后面的人盖住，
   *   而"被盖住"与"这个人不在"在画面上同形（本仓记账最久的那类合流）。
   */
  const sorted = [...plan.actors].sort((a, b) => (a.seat.col + a.seat.row) - (b.seat.col + b.seat.row))
  for (const actor of sorted) {
    const u = actor.seat.col - 1
    const v = actor.seat.row - 1
    /** 桌子：在座位**后面**一格（屏幕上方），高 5px。 */
    box(ctx, ox, oy, u + 0.1, v - 0.7, 1.6, 0.6, 5, ROOM_PALETTE.deskTop, ROOM_PALETTE.deskLeft, ROOM_PALETTE.deskRight)
    drawn.push({ kind: 'desk', u, v, actorKey: actor.key, teamId: actor.teamId })
    /** 显示器：桌子上的薄盒子 + **屏幕面**（亮/暗就是"在不在干活"）。 */
    box(ctx, ox, oy, u + 0.42, v - 0.62, 0.95, 0.12, 8, ROOM_PALETTE.monitorTop, ROOM_PALETTE.monitorFrame, ROOM_PALETTE.monitorSide, 5)
    const screen = toScreen(u + 0.5, v - 0.5, 6)
    quad(ctx, ox, oy, [
      { x: screen.x - 5, y: screen.y },
      { x: screen.x + 5, y: screen.y },
      { x: screen.x + 5, y: screen.y - 5 },
      { x: screen.x - 5, y: screen.y - 5 },
    ], actor.doing === 'working' ? ROOM_PALETTE.screenCode : ROOM_PALETTE.screenIdle)
    if (actor.doing === 'working') {
      /** ★ 屏幕上的三行"代码"—— 在干活时它们才亮。 */
      for (let line = 0; line < 3; line += 1) {
        const len = 2 + ((Math.floor(now / 300) + line + actor.seat.col) % 3)
        quad(ctx, ox, oy, [
          { x: screen.x - 4, y: screen.y - 2 - line * 1.4 },
          { x: screen.x - 4 + len, y: screen.y - 2 - line * 1.4 },
          { x: screen.x - 4 + len, y: screen.y - 2.8 - line * 1.4 },
          { x: screen.x - 4, y: screen.y - 2.8 - line * 1.4 },
        ], ROOM_PALETTE.codeGlyph)
      }
    }
    drawn.push({ kind: 'monitor', u, v, actorKey: actor.key })
    /**
     * ★ 椅子：座位格子上的一个矮盒子，**画在人之前**（它在人下面 —— 等距里"下面"= 更大的 u+v）。
     * ★★ 而"人挡住椅子"与"椅子上没人"是两件事：椅子必须先画，否则人被椅子盖掉一半。
     */
    /**
     * ── ★★ 接地阴影（规范 rule 15）──────────────────────────────────────────────
     *
     * 逐字：「**Ground every object** with a flat shadow … Floating objects look
     *   **pasted** without it.」
     * ★ 它是"这个物件站在地板上"的唯一视觉证据 —— 没有它，桌椅看起来是**贴上去的**。
     */
    {
      const ground = toScreen(u + 0.5, v + 0.5, 0)
      quad(ctx, ox, oy, [
        { x: ground.x - 5, y: ground.y + 1 },
        { x: ground.x, y: ground.y + 4 },
        { x: ground.x + 5, y: ground.y + 1 },
        { x: ground.x, y: ground.y - 2 },
      ], 'rgba(6,5,10,0.45)')
    }
    box(ctx, ox, oy, u + 0.2, v + 0.25, 1.0, 0.55, 4, ROOM_PALETTE.chairTop, ROOM_PALETTE.chairLeft, ROOM_PALETTE.chairRight)
    drawn.push({ kind: 'chair', u, v, actorKey: actor.key })
    /** 人：`away` 只画一个灰影（椅子空着），其余画真的精灵。 */
    if (actor.doing === 'away') {
      const center = toScreen(u + 0.5, v + 0.5, 0)
      quad(ctx, ox, oy, [
        { x: center.x - 4, y: center.y },
        { x: center.x + 4, y: center.y },
        { x: center.x, y: center.y + 3 },
      ], ROOM_PALETTE.ghost)
      drawn.push({ kind: 'ghost', u, v, actorKey: actor.key, doing: actor.doing })
    } else {
      drawSprite(ctx, ox, oy, u, v, actor.doing)
      drawn.push({ kind: 'sprite', u, v, actorKey: actor.key, doing: actor.doing })
    }
    /**
     * ── ★★★ 头顶名牌：**一小块底 + 状态色**（参照物 pixtuoid / agent-cockpit 都有）────
     *
     * MEASURED（2026-10-22 第四轮，看参照物的图）：`pixtuoid` 每个小人头上有一块
     * `#thinking` / `#working` / `#idle-a` 的牌子，`agent-cockpit` 有状态点。
     * ★★ 而我们的名字只在 canvas **外面**的 `<ul>` 里 ⇒ **看画面时不知道谁是谁**，
     *   于是"房间"退化成一个装饰图，信息仍要去读列表。
     *
     * ★ 本机没有视觉模型 ⇒ 文字**不画在 canvas 上**（画不了字形判据），
     *   只画**牌子的底与状态色**，把 `kind: 'tag'` 记进 `drawn[]`。
     *   名字仍由 `room-panel.tsx` 在放大后用页面分辨率画（参照物也是这么做的）。
     */
    {
      /**
       * ★★ 锚点必须与 `drawSprite` 的 `top` 对齐，否则名牌会**浮在半空**。
       *   MEASURED（第五版预览图）：写成 `toScreen(…, 24)` ⇒ 牌子比头顶高 8px，
       *   看起来像"三个色块飘在房间上方"。
       *   而 `drawSprite` 用的是 `center.y - 16`（精灵高 24、坐姿上沿留 8 行空白）
       *   ⇒ 这里必须用**同一个数**，并且再往上让出牌子自己的高度。
       */
      const head = { x: toScreen(u + 0.5, v + 0.5, 0).x, y: toScreen(u + 0.5, v + 0.5, 0).y - 16 - 5 }
      const tagColor = TAG_COLOR[actor.doing]
      quad(ctx, ox, oy, [
        { x: head.x - 6, y: head.y - 3 },
        { x: head.x + 6, y: head.y - 3 },
        { x: head.x + 6, y: head.y },
        { x: head.x - 6, y: head.y },
      ], ROOM_PALETTE.outline)
      quad(ctx, ox, oy, [
        { x: head.x - 5, y: head.y - 2.5 },
        { x: head.x + 5, y: head.y - 2.5 },
        { x: head.x + 5, y: head.y - 0.5 },
        { x: head.x - 5, y: head.y - 0.5 },
      ], tagColor)
      drawn.push({ kind: 'tag', u, v, actorKey: actor.key, doing: actor.doing })
    }
  }

  ctx.fillStyle = '#0b0a10'
  return { drawn, width: size.width, height: size.height, ox: size.ox, oy: size.oy }
}

/** ★ 供夹具与调试：一帧的 `TW/TH` 常量（产物里读得到，避免"猜"）。 */
export const ISO = { TW, TH } as const
