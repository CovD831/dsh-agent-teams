/**
 * ── ★★★ 工作区 = 一个房间：**投影是纯函数，可单测**（需求 §27）────────────────────────
 *
 * ── 这个文件守的是什么 ────────────────────────────────────────────────────────────
 *
 * MEASURED（本机）：**没有视觉模型** ⇒ "房间画对了没有"不能靠看图判。
 * ⇒ 所以房间的**几何与站位**必须落成一个可读的数据形状（`roomPlanOf` 的返回值），
 *   而本文件就钉那个形状。★ 这与 `folders-panel.tsx` 的 `data-*` 读数同一条路。
 *
 * ── 它借的是参照物的**分工**，不是美术 ──────────────────────────────────────────
 *
 * `ypyik0669/claude-web` 的 `web/src/features/cafe/` 把
 *   `sim.ts`（状态机）+ `map.ts`（地板图） 与 `render.ts`（只管画）分开，
 * 前两者是纯函数、有 `sim.test.ts` / `map.test.ts`。
 * ★★ 那条分工的**理由**与本仓既有纪律同源：判据要落在数据上，而不是画面上。
 *
 * ── 用户裁定（§27.3 逐字）─────────────────────────────────────────────────────
 *
 * ```
 * 「一个工作区（或者说一个项目）就是一个房间。房间里面一般只有一个团队，
 *   当然也不排除有两个或几个团队，这样应该就不会显得很空吧。」
 * ```
 * ⇒ 本文件钉住的是那条裁定的**可读形式**：
 *   · 一个工作区 = 一间房间（`roomPlanOf(这个工作区的 teams)`）
 *   · 团队之间**几何可分**（不是靠颜色 —— 色弱看不出、截图也说不清）
 *   · 房间随人数**长**（不是固定的空盒子）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { roomPlanOf, doingOf, SEATS_PER_ROW, SEAT_ROW_STRIDE, MIN_ROWS } = await import(join(ROOT, 'lib', 'client', 'room-plan.js'))

/** 一个成员的最小形状（只给 `roomPlanOf` 读到的那些格）。 */
const member = (name, patch = {}) => ({
  id: `id-${name}`, name, role: 'engineer', activity: 'idle', liveness: 'idle',
  progress: 0, done: 0, total: 0, currentTask: '', unread: 0, ...patch,
})
const team = (teamId, members, patch = {}) => ({
  workspace: '/w', teamId, name: teamId, captainSessionId: 'c', phase: 'running',
  members, tasks: [], messageCount: 0, captainInbox: [], captainInboxState: 'empty',
  captainInboxUnreadable: 0, ...patch,
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 一个工作区 = 一间房间；一个团队 = 房间里的一个区域
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 1：一个团队 ⇒ 一间房间，每个成员一个工位，行数随人数增长', () => {
  const plan = roomPlanOf([team('alpha', [member('a'), member('b'), member('c')])])
  assert.equal(plan.empty, false)
  assert.equal(plan.actors.length, 3, '★ 三个成员 ⇒ 三个小人（不多不少）')
  assert.equal(plan.teams.length, 1, '★ 一个团队 ⇒ 房间里一个区域')
  /** ★ 座位坐标唯一 —— 两个人不能坐在同一个格子上。 */
  const seats = new Set(plan.actors.map((actor) => `${actor.seat.col},${actor.seat.row}`))
  assert.equal(seats.size, 3, '★★ 两个人的座位重合 ⇒ 画面上一人消失，而"消失"与"没有这个人"同形')
  /** ★ 一行放 SEATS_PER_ROW 个 ⇒ 3 个人占 1 行。 */
  assert.equal(new Set(plan.actors.map((actor) => actor.seat.row)).size, 1)
})

test('★ 臂 2：人多了房间**变高**（超过最小纵深之后才长）', () => {
  const one = roomPlanOf([team('alpha', [member('a')])])
  /**
   * ★★ MEASURED（本臂第一版在本轮红过）：`MIN_ROWS` 从 3 提到 8 之后，
   *   「1 个人」与「18 个人」都落 8 排 ⇒ 旧断言（`many.rows > one.rows`）变红。
   *
   * ★ 而那是**行为变更**，不是缺陷：房间有**最小纵深**（否则墙压过地板，看起来像一堵墙）。
   *   ⇒ 断言改成"长过最小纵深之后，人数越多房间越高"——
   *     那才是"房间随人数长"的可证伪形式。
   */
  const rowsFor = (people) => roomPlanOf([team('alpha', Array.from({ length: people }, (_, i) => member(`m${i}`)))]).rows
  /**
   * ★★★ 修之前这一格是**假绿**：`Math.max(MIN_ROWS, …)` 把 8 排以下全压平
   *   （1/6/12/18/24 人全是 8 排），而我写的是 `>` 断言 —— 它在 18 vs 12 上恰好成立
   *   纯属巧合。⇒ 现在断的是**严格单调**：每多一行人，房间必须更高。
   */
  assert.ok(rowsFor(SEATS_PER_ROW) < rowsFor(SEATS_PER_ROW * 2), `★★ ${SEATS_PER_ROW} 人必须比 ${SEATS_PER_ROW * 2} 人的房间矮`)
  assert.ok(rowsFor(SEATS_PER_ROW * 2) < rowsFor(SEATS_PER_ROW * 3), `★★ ${SEATS_PER_ROW * 2} 人必须比 ${SEATS_PER_ROW * 3} 人的房间矮`)
  assert.ok(one.rows >= MIN_ROWS, '★ 一个人时也不小于最小纵深（空房间也画得出来）')
  /** ★ 每人独占一行座位号 ⇒ 座位行数 = 人数 / 每行座数（向上取整）。 */
  const full = roomPlanOf([team('alpha', Array.from({ length: SEATS_PER_ROW * 3 }, (_, i) => member(`m${i}`)))])
  const seatRows = new Set(full.actors.map((actor) => actor.seat.row))
  assert.equal(seatRows.size, 3, `${SEATS_PER_ROW * 3} 个人 / 每行 ${SEATS_PER_ROW} ⇒ 占 3 排座位`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ 多个团队在几何上**分得开**（不靠颜色）
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 3：两个团队在房间里有**各自的行段**，且中间留过道', () => {
  const plan = roomPlanOf([
    team('alpha', [member('a1'), member('a2')]),
    team('beta', [member('b1')]),
  ])
  assert.equal(plan.teams.length, 2)
  const [alpha, beta] = plan.teams
  assert.ok(
    beta.fromRow > alpha.toRow,
    '★★ 第二个团队必须从第一个团队**结束之后**再开始 —— 团队界限靠几何，不靠颜色'
  )
  assert.ok(
    beta.fromRow - alpha.toRow >= 2,
    '★ 中间至少隔一行过道（`toRow + 1` 是过道，`beta.fromRow` 是下一段的第一行）—— '
    + '贴着排会让"两个团队"看起来像"一个大队"',
  )
  /** ★ 每个小人带着自己的 teamId —— 房间里有多个团队时要能分清谁是谁。 */
  assert.deepEqual(
    [...new Set(plan.actors.map((actor) => actor.teamId))].sort(), ['alpha', 'beta'],
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★ 五态 `doing` —— `could-not-measure` **不许**并进 idle
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 4：`liveness` 五态各落一个 `doing`，且读不到**不并进**闲着', () => {
  assert.equal(doingOf({ liveness: 'working' }), 'working')
  assert.equal(doingOf({ liveness: 'idle' }), 'idle')
  assert.equal(doingOf({ liveness: 'never-spawned' }), 'not-spawned')
  assert.equal(doingOf({ liveness: 'not-live' }), 'away')
  assert.equal(doingOf({ liveness: 'could-not-measure' }), 'unknown')
  assert.equal(doingOf({ liveness: undefined }), 'unknown', '★ 缺席（老宿主）也是"读不到"')
  assert.equal(doingOf({ liveness: 'a-value-nobody-expects' }), 'unknown', '★ 认不出的值不许猜')
  /** ★★ 本仓记账最久的合流：「读不到」与「闲着」的补救动作相反。 */
  assert.notEqual(doingOf({ liveness: 'could-not-measure' }), doingOf({ liveness: 'idle' }))
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：反向半边 —— 同名的两个成员在两个团队里是**两个不同的小人**
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 5（反向半边）：两个团队里同名成员 ⇒ 两个 key，不许合并成一个', () => {
  const plan = roomPlanOf([
    team('alpha', [member('worker')]),
    team('beta', [member('worker')]),
  ])
  assert.equal(plan.actors.length, 2, '★★ 同名即合并 ⇒ 两个团队里那两个人会变成一个（而他俩是不同的会话）')
  const keys = new Set(plan.actors.map((actor) => actor.key))
  assert.equal(keys.size, 2, '★ key 必须带 teamId')
  assert.deepEqual([...keys].sort(), ['alpha/worker', 'beta/worker'])
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：空房间与"没有房间"不同形
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 6：一个团队都没有 ⇒ `empty: true`，而房间几何**仍然成立**（不返回 null）', () => {
  const plan = roomPlanOf([])
  assert.equal(plan.empty, true, '★ 空房间是一个**事实**，不是"没有房间"')
  assert.equal(plan.actors.length, 0)
  assert.equal(plan.rows, MIN_ROWS, '★ 空房间也画得出来（否则界面上是白屏，而白屏与"读不到"同形）')
  /** ★★ 与"读不到"不同形：`empty` 是布尔，而"读不到"由调用方用 `undefined` 表达。 */
  assert.notEqual(roomPlanOf([]), undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★ 真实语料 —— 本仓的 8 个团队全塞进一间房间也放得下
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 7（真实语料）：把本工作区的真实团队投影成房间，座位**不重合**、行数合理', async (t) => {
  const { collectTeamsActivity } = await import(join(ROOT, 'lib', 'snapshot.js'))
  const teams = await collectTeamsActivity(
    { logger: { warn: () => {} } },
    [{ workspace: ROOT, stateRoot: join(ROOT, '.agent-teams') }],
  )
  if (teams.length === 0) {
    t.diagnostic('本仓此刻没有团队 ⇒ 真实语料这一格没被走过（不是失败，是没数据）')
    return
  }
  const plan = roomPlanOf(teams)
  const seats = new Set(plan.actors.map((actor) => `${actor.seat.col},${actor.seat.row}`))
  assert.equal(
    seats.size, plan.actors.length,
    `★★ ${plan.actors.length} 个成员挤出了 ${seats.size} 个不同座位 —— 有人重叠`,
  )
  assert.ok(plan.rows >= MIN_ROWS)
  /**
   * ★ 行数的**上界**：每个团队最多吃 ceil(成员数 / 每行) 行 + 1 行过道。
   *   ⇒ 超过这个数说明有条团队被算了两次，或者过道被重复计。
   */
  /**
   * ★ 上界：`MIN_ROWS`（最小纵深）+ 每个团队吃掉的排数 + 每个团队之后的过道。
   * ★★ 写 `<= MIN_ROWS + expected` 而不是 `<= expected`：房间是"最小纵深 + 团队区"，
   *   两者**相加**（见 `roomPlanOf` 的注释 —— 压平过一次，那是假绿）。
   */
  /**
   * ★★ 每个团队吃掉的排数必须按 **`SEAT_ROW_STRIDE`** 算（2026-10-22 第四轮）。
   *   MEASURED：改成"一行 3 人 + 每排占 3 行"之后，这里仍按"每排占 1 行"算 ⇒
   *   报 `行数 42 超过上界 30`。**而产品是对的、判据是错的** ——
   *   排距放大 3 倍是刻意的（见 `SEAT_ROW_STRIDE` 的注释：不放大就挡死）。
   *   ⇒ 修判据，不修产品；★ 但要把"为什么放大"写在这里，否则下一轮会把它改回去。
   */
  const bandRows = teams.reduce((sum, entry) => {
    const seatsInRow = Math.max(1, Math.ceil((entry.members?.length ?? 0) / SEATS_PER_ROW))
    return sum + ((seatsInRow - 1) * SEAT_ROW_STRIDE + 1) + 1
  }, 0)
  assert.ok(plan.rows <= MIN_ROWS + bandRows, `行数 ${plan.rows} 超过按人头算出的上界 ${MIN_ROWS + bandRows}`)
  t.diagnostic(`${teams.length} 个团队 / ${plan.actors.length} 个成员 ⇒ ${plan.cols}×${plan.rows} 的房间`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：★ 一个工作区 = 一间房间（`teamsOfWorkspace` 只挑**这个**工作区的队）
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 8：两个工作区 ⇒ 两间**独立的**房间，一个房间不许混进另一个工作区的队', async () => {
  const { teamsOfWorkspace, workspacesOf } = await import(join(ROOT, 'lib', 'client', 'room-plan.js'))
  const teams = [
    team('a1', [member('x')], { workspace: '/proj-a' }),
    team('a2', [member('y')], { workspace: '/proj-a' }),
    team('b1', [member('z')], { workspace: '/proj-b' }),
  ]
  assert.deepEqual(workspacesOf(teams), ['/proj-a', '/proj-b'], '★ 工作区去重且保序（顺序抖动会让画面跳）')
  const roomA = roomPlanOf(teamsOfWorkspace(teams, '/proj-a'))
  const roomB = roomPlanOf(teamsOfWorkspace(teams, '/proj-b'))
  assert.equal(roomA.teams.length, 2, '★ /proj-a 有 2 个团队')
  assert.equal(roomB.teams.length, 1, '★ /proj-b 有 1 个团队')
  assert.equal(roomA.actors.length, 2)
  assert.equal(roomB.actors.length, 1)
  /**
   * ★★ 反向半边：把**全部**团队塞进一间房间必须**不同**于按工作区分开 ——
   *   否则"一个工作区一间房"这条裁定在实现上不成立。
   */
  const allInOne = roomPlanOf(teams)
  assert.equal(allInOne.teams.length, 3, '★ 全部塞一起会是 3 个区域')
  assert.notDeepEqual(roomA.teams, allInOne.teams, '★ 若相等 ⇒ 按工作区过滤没生效')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9：房间的 `data-*` 读数与 plan 一一对应（渲染层不许自己算）
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 9：渲染层的 `data-*` 全部**从 plan 派生**（渲染层不做判断）', () => {
  const source = readFileSync(join(ROOT, 'src', 'client', 'room-panel.tsx'), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  /** ★ 它必须调 `roomPlanOf`（不许自己算座位）。 */
  assert.match(code, /roomPlanOf\(/, '★ 渲染层必须用纯函数算出来的房间，不许自己排座位')
  /** ★ 每个 `data-*` 都从 plan/actor 读，不出现"渲染层自己再算一遍状态"的第二种写法。 */
  for (const key of ['data-room-cols', 'data-room-rows', 'data-room-actors', 'data-room-teams', 'data-room-state']) {
    assert.ok(code.includes(key), `★ 缺读数 ${key}`)
  }
  for (const key of ['data-actor-doing', 'data-actor-seat', 'data-actor-task', 'data-actor-team']) {
    assert.ok(code.includes(key), `★★ 缺成员级读数 ${key} —— 而"谁在干活"正是 §27 要表达的东西`)
  }
  /** ★★ 反向半边：不许出现第二份 `liveness` 判断（`doingOf` 是唯一落点）。 */
  assert.ok(!/liveness\s*===\s*'/.test(code), '★★ 渲染层自己判 liveness ⇒ 与 room-plan 的 doingOf 变成两份真相')
})
