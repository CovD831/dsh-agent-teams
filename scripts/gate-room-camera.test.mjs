/**
 * ── ★★★ 摄像机：用户那句话的两个尺度，各一条判据（需求 §28.5）────────────────────────
 *
 * ── 用户原话（逐字，这是本文件的唯一来源）──────────────────────────────────────────
 *
 * > 「A 吧，就是可以调整视图大小，可以**放大到只有一个房间的视图**，
 * >  也可以**缩小到看到所有房间**的视图」
 *
 * ★★ 这句话里有两个**可以**，而它们是**两个尺度**。本文件把它们各钉一条臂：
 * ```
 * 臂 1  放大到一间房 ⇒ 那间房**完整可见**，且它**占满**视口（不是缩在角落）
 * 臂 2  缩小到所有房 ⇒ **整个世界**完整可见（一间都不许被切掉）
 * 臂 3  ★ 反向半边：缩放**必须是整数倍**（像素风的物理前提）
 * 臂 4  ★ 反向半边：所有房**不是**一间房的同一个矩形（否则"缩到所有"是假的）
 * 臂 5  世界里的房间**不重叠**，且**顺序稳定**（位置记忆）
 * 臂 6  屏幕坐标 ↔ 世界坐标**互逆**（hit test 与画面不许错开）
 * 臂 7  点在某间房里 ⇒ `roomAt` 返回那间（与 `focusRoom` 用同一个矩形）
 * 臂 8  ★ 真实语料：本工作区 8 队 / 35 人，缩到"所有房间"仍然装得下
 * ```
 *
 * ── 为什么这些能进判据（而"好不好看"不能）──────────────────────────────────────────
 *
 * 两个尺度都是**算出来的**（包围盒 ÷ 视口 ⇒ 一个确定的整数缩放），
 * 所以"是否看到了所有房间"是一个**布尔读数**，不是一个观感。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const {
  layOutRooms, fitTo, focusRoom, focusWorld, fitZoom, ZOOM_LADDER,
  worldToScreen, screenToWorld, roomAt, visibleRect, coversWorld, STREET_GAP,
} = await import(join(ROOT, 'lib', 'client', 'room-camera.js'))
const { roomPlanOf } = await import(join(ROOT, 'lib', 'client', 'room-plan.js'))
const { sceneSize } = await import(join(ROOT, 'lib', 'client', 'room-iso.js'))

/** 造一个团队（只带 `roomPlanOf` 需要的字段）。 */
function team(id, size, workspace = 'w') {
  return {
    teamId: id, name: id, workspace,
    members: Array.from({ length: size }, (_, i) => ({ name: `m${i}`, liveness: 'working' })),
  }
}

/** 造一个工作区的房间。 */
function roomOf(workspace, teams) {
  return { workspace, plan: roomPlanOf(teams) }
}

const VIEWPORT = { width: 900, height: 600 }

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 放大到**一间房** —— 它完整可见且占满视口
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 1：`focusRoom` 让那一间房**完整可见**，且**占满**视口（不是缩在角落）', () => {
  const { rooms } = layOutRooms([roomOf('/a', [team('alpha', 6)]), roomOf('/b', [team('beta', 3)])])
  const room = rooms[0]
  const camera = focusRoom(room, VIEWPORT)

  const seen = visibleRect(camera, VIEWPORT)
  const frame = { x: room.origin.x, y: room.origin.y, width: room.frame.width, height: room.frame.height }
  assert.ok(
    seen.x <= frame.x && seen.y <= frame.y
    && seen.x + seen.width >= frame.x + frame.width
    && seen.y + seen.height >= frame.y + frame.height,
    `★★ 那间房没被完整装进视口：看到 ${JSON.stringify(seen)}，房间 ${JSON.stringify(frame)}`,
  )

  /**
   * ★★★ "占满"是这句话的另一半 —— 用户说的是「放大到**只有**一个房间的视图」。
   *
   * ── 这条判据我**改错过两次**，两次都如实记下来 ─────────────────────────────────
   *
   * ```
   * 第一版：断言"放大后**不该**看得见第二间房"
   *         ⇒ 宽视口下必然红：房间 212×156 装进 900×600，zoom 到上限后两侧自然露邻居
   *         ⇒ 那是**我的判据错了**：用户要"以这间房为主体"，不是"邻居必须消失"
   * 第二版：断言"占视口面积 ≥ 60%"
   *         ⇒ 也红，而 MEASURED 说 55% 就是**几何上限**：
   *            房间宽高比 212:156 = 1.36，视口 900:600 = 1.50
   *            ⇒ 两者不匹配，最多只能填满一边 ⇒ 面积占比必然 < 60%
   *         ⇒ 又是我写错了：我把"视口比例恰好等于房间比例"当成了常态
   * ```
   * ★★ 第三版（本版）断言的是**几何正确的那件事**：
   *   `zoom` 已经是**能装下的最大合法档** —— 即再上一档就装不下。
   *   这才是"占满"的可判定形式（而不是一个拍出来的百分比）。
   */
  const nextUp = ZOOM_LADDER.filter((zoom) => zoom > camera.zoom).sort((a, b) => a - b)[0]
  if (nextUp !== undefined) {
    const tooBig = room.frame.width * nextUp > VIEWPORT.width || room.frame.height * nextUp > VIEWPORT.height
    assert.ok(
      tooBig,
      `★★ zoom=${camera.zoom} 不是"能装下的最大档" —— 再上一档 ${nextUp} 仍然装得下`,
    )
  }
  /** ★ 而它确实被放大了（不是停在 1 倍、缩在角落）。 */
  assert.ok(camera.zoom > 1, `★★ 一间房的视图 zoom=${camera.zoom} —— 没有被放大`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★★ 缩小到**所有房间** —— 整个世界完整可见
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 2：`focusWorld` 让**整个世界**完整可见（一间都不许被切掉）', () => {
  const plans = ['/a', '/b', '/c', '/d'].map((ws) => roomOf(ws, [team(`t-${ws}`, 4)]))
  const { rooms, world } = layOutRooms(plans)
  const camera = focusWorld(world, VIEWPORT)
  assert.ok(coversWorld(camera, world, VIEWPORT), '★★ 缩到"所有房间"后仍有房间在视口外')
  assert.ok(rooms.length === 4, '★ 四个工作区 ⇒ 四间房')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 反向半边 —— 缩放必须是**整数倍**
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 3（反向半边）：任何缩放都落在 `ZOOM_LADDER` 里（不许 1.37 倍）', () => {
  /**
   * ★★ 为什么这条是反向的：`fitZoom` 最容易写成 `viewport.width / rect.width`
   *   —— 那会产出 1.37 这种数，而**画面看起来"差不多对"**，
   *   于是没人会发现像素大小不均。这正是"看起来对"最危险的那类错。
   *
   * ★★★ 而"只能整数倍"也是错的（我第一版就是那么写的）：房间一多就必然要 < 1 倍。
   *   像素风的真实要求是**像素大小均匀** ⇒ 允许 `1/n`（每 n×n 源像素压成 1 个），
   *   见 `ZOOM_LADDER` 的注释。
   */
  const { world } = layOutRooms(['/a', '/b', '/c'].map((ws) => roomOf(ws, [team(`t${ws}`, 5)])))
  for (const viewport of [VIEWPORT, { width: 1280, height: 800 }, { width: 320, height: 240 }, { width: 200, height: 120 }]) {
    const camera = focusWorld(world, viewport)
    assert.ok(
      ZOOM_LADDER.includes(camera.zoom),
      `★★ zoom=${camera.zoom} 不在允许的阶梯里 ⇒ 像素大小不均`,
    )
    assert.ok(camera.zoom > 0, '★★ zoom 必须为正（0 倍会把房间画没）')
  }
  /**
   * ★★ 而阶梯的**每一档**都必须是"整数或整数分之一" —— 否则它只是一组魔数。
   *   判据：`zoom` 或其倒数之一是整数。
   */
  for (const zoom of ZOOM_LADDER) {
    const uniform = Number.isInteger(zoom) || Number.isInteger(Math.round(1 / zoom)) && Math.abs(1 / zoom - Math.round(1 / zoom)) < 1e-9
    assert.ok(uniform, `★★ 阶梯里的 ${zoom} 不是整数也不是整数分之一 ⇒ 像素大小不均`)
  }
  void fitZoom
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 反向半边 —— "所有房"不等于"一间房"
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 4（反向半边）：多间房的"所有房间"视图**不等于**任何一间房的视图', () => {
  /**
   * ★★ 若 `focusWorld` 与 `focusRoom` 返回同一个矩形，那说明世界包围盒退化了
   *   （例如所有房都摆在原点）—— 而那时"缩小到看到所有房间"是**假的**：
   *   用户看到的是"一间房"，却以为自己看到了全部。
   * ★ 这是"两个尺度其实是同一个"的检测器。
   */
  const plans = ['/a', '/b', '/c'].map((ws) => roomOf(ws, [team(`t${ws}`, 4)]))
  const { rooms, world } = layOutRooms(plans)
  const worldCamera = focusWorld(world, VIEWPORT)
  for (const room of rooms) {
    const roomCamera = focusRoom(room, VIEWPORT)
    assert.notDeepEqual(worldCamera, roomCamera, '★★ "所有房间"与"一间房"给出了同一个摄像机 —— 世界没排开')
  }
  /** ★ 而"所有房间"必须比"一间房"**看得更多**（可见宽度更大）。 */
  const seenWorld = visibleRect(worldCamera, VIEWPORT)
  const seenRoom = visibleRect(focusRoom(rooms[0], VIEWPORT), VIEWPORT)
  assert.ok(seenWorld.width > seenRoom.width, '★★ "所有房间"视图的可见世界宽度必须更大')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★ 房间不重叠，且顺序稳定
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 5：世界里的房间**不重叠**、**顺序稳定**，且之间有过道', () => {
  const plans = ['/a', '/b', '/c'].map((ws) => roomOf(ws, [team(`t${ws}`, 4)]))
  const { rooms } = layOutRooms(plans)
  assert.deepEqual(rooms.map((room) => room.workspace), ['/a', '/b', '/c'], '★ 顺序必须与输入一致（位置记忆）')

  for (let i = 1; i < rooms.length; i += 1) {
    const left = rooms[i - 1]
    const right = rooms[i]
    const leftEdge = left.origin.x + left.frame.width
    assert.ok(right.origin.x >= leftEdge, `★★ 第 ${i} 间房压在第 ${i - 1} 间上`)
    assert.equal(right.origin.x - leftEdge, STREET_GAP, '★ 两间房之间必须有**固定的**过道（不许挤在一起）')
  }

  /** ★ 同一批输入跑两次 ⇒ 位置完全一样（否则每次轮询房间会跳）。 */
  const again = layOutRooms(plans)
  assert.deepEqual(again.rooms.map((room) => room.origin), rooms.map((room) => room.origin))
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★★ 屏幕 ↔ 世界互逆
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 6：`worldToScreen` 与 `screenToWorld` **互逆**（hit test 不许与画面错开）', () => {
  const { rooms, world } = layOutRooms([roomOf('/a', [team('alpha', 6)])])
  const camera = focusWorld(world, VIEWPORT)
  for (const point of [{ x: 0, y: 0 }, { x: 37, y: 91 }, { x: rooms[0].frame.width, y: rooms[0].frame.height }]) {
    const round = screenToWorld(camera, worldToScreen(camera, point))
    assert.deepEqual(round, point, `★★ 往返之后 ${JSON.stringify(point)} 变成了 ${JSON.stringify(round)}`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★★ 点在某间房里 ⇒ 返回那间
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 7：`roomAt` 与 `focusRoom` 用**同一个矩形**（点得中 ⇒ 放大到对的那间）', () => {
  const plans = ['/a', '/b', '/c'].map((ws) => roomOf(ws, [team(`t${ws}`, 4)]))
  const { rooms } = layOutRooms(plans)
  for (const room of rooms) {
    const centre = { x: room.origin.x + room.frame.width / 2, y: room.origin.y + room.frame.height / 2 }
    assert.equal(roomAt(rooms, centre)?.workspace, room.workspace, `★ 点在 ${room.workspace} 的中心却命中了别的房`)
  }
  /** ★ 反向：点在**过道**里（两间房之间）不该命中任何一间。 */
  const gapPoint = { x: rooms[0].origin.x + rooms[0].frame.width + STREET_GAP / 2, y: 10 }
  assert.equal(roomAt(rooms, gapPoint), undefined, '★★ 过道里不该命中房间 —— 否则点空白处会误进某间')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：★★ 真实语料 —— 8 队 / 35 人也缩得下
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 8（真实语料）：本工作区的真实团队，"缩到所有房间"仍然装得下', async (t) => {
  const { collectTeamsActivity } = await import(join(ROOT, 'lib', 'snapshot.js'))
  const teams = await collectTeamsActivity(
    { logger: { warn: () => {} } },
    [{ workspace: ROOT, stateRoot: join(ROOT, '.agent-teams') }],
  )
  if (teams.length === 0) {
    t.diagnostic('本仓此刻没有团队 ⇒ 真实语料这一格没被走过（不是失败，是没数据）')
    return
  }
  /** ★ 按工作区分组 —— 与 `RoomPanel` 同一条投影（一个工作区一间房）。 */
  const byWorkspace = new Map()
  for (const entry of teams) {
    const list = byWorkspace.get(entry.workspace) ?? []
    list.push(entry)
    byWorkspace.set(entry.workspace, list)
  }
  const plans = [...byWorkspace.entries()].map(([workspace, scoped]) => ({ workspace, plan: roomPlanOf(scoped) }))
  const { world, rooms } = layOutRooms(plans)
  const camera = focusWorld(world, VIEWPORT)

  assert.ok(coversWorld(camera, world, VIEWPORT), `★★ 真实语料缩不到全部：世界 ${world.width}×${world.height}`)
  /**
   * ★★ 而这一格是**这个特性存在的理由**：真实房间有 42 排高，
   *   `focusWorld` 必须能把它压进视口 —— 若压不进（`zoom < 1` 才装得下），
   *   那说明**"缩小到看到所有房间"在真实数据上不成立**，而那时应当如实报出来。
   */
  assert.ok(camera.zoom >= 1, '★★ 真实语料需要 zoom < 1 ⇒ 缩到最小仍看不全')
  t.diagnostic(
    `${byWorkspace.size} 个工作区 / ${teams.length} 队 ⇒ 世界 ${world.width}×${world.height}，`
    + `缩到 zoom=${camera.zoom}（视口 ${VIEWPORT.width}×${VIEWPORT.height}）`,
  )
  void rooms
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9：★ 世界尺寸用 `sceneSize`，不许另算一遍
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 9：每间房的世界尺寸 = `sceneSize(cols, rows)`（与 drawRoom 同一个函数）', () => {
  /**
   * ★★ 这与本轮刚修过的那个错同源：预览图曾是 `room-canvas.ts` 的重实现，
   *   而它已经漂了。世界尺寸若另算一遍，`focusRoom` 会**框不住**画出来的房间。
   */
  const plans = [roomOf('/a', [team('alpha', 6)]), roomOf('/b', [team('beta', 12)])]
  const { rooms } = layOutRooms(plans)
  for (const [index, room] of rooms.entries()) {
    const size = sceneSize(plans[index].plan.cols, plans[index].plan.rows)
    assert.equal(room.frame.width, size.width, `★ ${room.workspace} 的宽度与 sceneSize 不一致`)
    assert.equal(room.frame.height, size.height, `★ ${room.workspace} 的高度与 sceneSize 不一致`)
  }
  void fitTo
})
