/**
 * ── `runtime.shape-execution` 的臂（2026-10-20，`shape` 的执行判据）────────────────
 *
 * ── 它修的是什么（上一轮形态验证亲手撞上的缺口）────────────────────────────────────
 *
 * 用户 2026-10-20 裁定乙方案：`team.json` 落一个 `shape` 位，成员提示按它选。
 * 那一轮真的跑通了一个 `shape: 'dispatch'` 的队，派工也确实发生了 ——
 * **而验证它是靠队长手工看会话文件。** `docs/SHAPE-VERIFICATION-PROBE-1.md` §4 逐字：
 *
 * > 「**`shape` 是一条声明，而"声明有没有被执行"今天没有读数。**
 * >   一个 `shape: 'dispatch'` 的队如果成员全都自己干活，**没有任何一条臂会红**。」
 *
 * ⇒ 本文件就是那一条臂。契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）：**声明了 dispatch、而成员干完活一个都没派** ⇒ 违规被**指名**
 *   臂 2（未测量臂）：**读不到派工** ⇒ `unmeasured`，★ 与"零违规"**不同形**
 *   臂 3（对照臂）：声明了、也真的派了 ⇒ `ok` 且 `shape_violations` 为空
 *   臂 4（闸门臂）：`flat` / 缺声明 / 非本判据事件 ⇒ **不适用**（`appliesTo` 为假）
 *   臂 5（接线臂）：它真的在 `ALL_GATES` 里，且 runtime 位置可达
 *
 * ★★ 而**臂 2 与臂 3 成对**才构成判别力：一个"永远报 ok"的实现能过臂 3，
 *   一个"永远报 unmeasured"的实现能过臂 2 —— 只有两条同时在，才能把它们分开。
 *   （本仓那条一般形式：「正向臂只喂『该被拒』的输入，所以它测不出『一律拒绝』」。）
 *
 * ── 每一条臂都对着一次【定向突变】（写在各自注释里）────────────────────────────────
 *
 *   · 把 `gate` 里 `unmeasured` 那一支改成 `ok`          ⇒ 臂 2 红
 *   · 把 `violations` 恒写成 `[]`                        ⇒ 臂 1 红
 *   · 把 `appliesTo` 的 `shape === 'dispatch'` 去掉      ⇒ 臂 4 红
 *   · 从 `ALL_GATES` 删掉这一行                          ⇒ 臂 5 红
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const SHAPE = await import('../lib/gates/runtime/shape-execution.js')
const { registry } = await import('../lib/gates/index.js')
const { memberDispatchRows, shapeExecutionOf, describeTeamShape, dispatchReadoutOf } = await import('../lib/members.js')

/** 判据裁决的三种形状（用于"两者不同形"的断言）。 */
function shapeOfVerdict(verdict) {
  if (verdict.ok === true) return 'ok'
  return 'blockers' in verdict ? 'blocked' : 'unmeasured'
}

/** 一条"读了、派过 N 个"的成员行。 */
function readRow(name, executedTasks, dispatched) {
  return {
    name,
    executedTasks,
    dispatch: { status: 'read', dispatched, unreadableEvents: 0, ...dispatched === 0 ? {} : { latest: { childId: `child-${name}` } } },
  }
}

/** 一份合法的判据 ctx（dispatch 队 + 注入的读数）。 */
function dispatchCtx(injected, extra = {}) {
  return {
    event: 'task-status',
    team: { id: 'team', shape: 'dispatch', tasks: [] },
    ...injected === undefined ? {} : { shapeExecution: injected },
    ...extra,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 伪造臂）：声明了 dispatch，而成员干完活一个都没派
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（伪造臂）：声明 dispatch、成员干完活却一个 worker 都没派 ⇒ 违规被**指名**', () => {
  const verdict = SHAPE.gate(dispatchCtx({ status: 'measured', violations: ['ledger'] }))
  assert.equal(shapeOfVerdict(verdict), 'ok', '★ runtime 位置不拒绝 —— 裁决恒为 ok')
  /**
   * ★★ 而"违规了"这件事必须从**产出**里读得出来。
   *   runtime 位置的纪律是"只记录、不拒绝"，所以 `ok:true` 与"没违规"**不能同形** ——
   *   差别就在这两格上（与 `runtime.liveness` 的 `stuck_count`、`runtime.stall` 的
   *   `stalled_count` 逐字同形）。
   */
  assert.deepEqual(verdict.shape_violations, ['ledger'], '★ 必须指名是哪个成员没派工')
  assert.equal(verdict.shape_violation_count, 1, '★ 计数必须与名单一致（一个不可数的名单读不出"几个"）')
})

test('★ 臂 1b（伪造臂）：多个成员违规 ⇒ 一次给全，不短路', () => {
  const verdict = SHAPE.gate(dispatchCtx({ status: 'measured', violations: ['ledger', 'inspector'] }))
  assert.deepEqual(verdict.shape_violations, ['ledger', 'inspector'], '★ 一次给全')
  assert.equal(verdict.shape_violation_count, 2)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 未测量臂）：读不到派工 ⇒ unmeasured，且与"零违规"不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（未测量臂）：读不到派工 ⇒ unmeasured，**绝不**并进 ok', () => {
  /**
   * ★★★ 这一臂是本判据的要害。把"没测到"读成"没有违规"，就是一个**恒不响的哨兵**
   *   —— 而它与"哨兵工作了、没人违规"在 `ok:true` 上同形。
   *   ⇒ 定向突变：把这一支改成 `ok({shape_violations: []})` ⇒ 本臂红。
   */
  const verdict = SHAPE.gate(dispatchCtx({ status: 'unmeasured', reason: 'session log unreadable' }))
  assert.equal(shapeOfVerdict(verdict), 'unmeasured', '★★ 读不到就是 unmeasured')
  assert.match(verdict.unmeasured, /session log unreadable/, '★ 成因必须原样传下去（不然读的人不知道该去查什么）')
  assert.notEqual(shapeOfVerdict(verdict), 'ok', '★★★ 它不许与"零违规"同形')
})

test('★★★ 臂 2b（未测量臂）：**没有注入**读数 ⇒ unmeasured（不是"没有违规"）', () => {
  /**
   * ★ 这一支防的是接线漏了而判据自己圆场：`shapeExecution` 缺席 ⇒ 判据**没能测量**。
   *   一个"没注入就当没有违规"的实现，会让**每一次接线失败**都伪装成一次通过。
   */
  const verdict = SHAPE.gate(dispatchCtx(undefined))
  assert.equal(shapeOfVerdict(verdict), 'unmeasured')
  assert.match(verdict.unmeasured, /was not injected/, '★ 必须说清是"没接上"这一种读不到')
})

test('★★ 臂 2c（矛盾臂）：注入的读数说"不是 dispatch 队"，而闸门放它进来 ⇒ unmeasured', () => {
  /**
   * ★ 两份来源对同一个事实给出不同答案 —— 那是一个**接线矛盾**，不是一个通过。
   *   圆成 ok 会让"两份真相分叉"这件事永远读不出来。
   */
  const verdict = SHAPE.gate(dispatchCtx({ status: 'not-applicable', reason: 'flat team' }))
  assert.equal(shapeOfVerdict(verdict), 'unmeasured')
  assert.match(verdict.unmeasured, /two sources disagree/, '★ 必须说清是"两份来源打架"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 对照臂）：声明了、也真的派了 ⇒ ok 且违规名单为空
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（对照臂）：声明了、成员真的派了 worker ⇒ ok，且违规名单**为空**', () => {
  const verdict = SHAPE.gate(dispatchCtx({ status: 'measured', violations: [] }))
  assert.equal(shapeOfVerdict(verdict), 'ok')
  /**
   * ★ 空数组**恒在场**（字段缺席会让"读了、确实没违规"与"这一格不存在"同形）。
   *   ⇒ 与臂 2 的 `unmeasured` 一起构成判别力：一个"永远 ok"的实现过得了本臂，
   *     而过不了臂 2；一个"永远 unmeasured"的实现反过来。
   */
  assert.deepEqual(verdict.shape_violations, [], '★ 读了、确实没有违规 ⇒ 空数组（不是字段缺席）')
  assert.equal(verdict.shape_violation_count, 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 闸门臂）：不适用 ⇒ 不开口（且不产出噪音）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（闸门臂）：`flat` / 缺声明 / 非本判据事件 ⇒ 一律**不适用**', () => {
  /**
   * ★ 定向突变：把 `appliesTo` 里 `ctx.team?.shape === 'dispatch'` 那一行删掉 ⇒ 本臂红。
   *
   * ★★ 为什么"缺声明"也不适用：那是**存量队**（这一格上线前建的），
   *   对它说"你没按 dispatch 跑"是一句**关于没有发生过的主张的指控**。
   */
  assert.equal(SHAPE.appliesTo({ event: 'task-status', team: { shape: 'flat' } }), false, '★ flat ⇒ 不开口')
  assert.equal(SHAPE.appliesTo({ event: 'task-status', team: { id: 't' } }), false, '★ 缺声明（存量队）⇒ 不开口')
  assert.equal(SHAPE.appliesTo({ event: 'task-created', team: { shape: 'dispatch' } }), false, '★ 别的事件 ⇒ 不开口')
  assert.equal(SHAPE.appliesTo(undefined), false, '★ 没有 ctx ⇒ 不开口')
  /** ★ 而**反向半边**：该开口的那一格必须真的开口（否则上面四条可以靠"恒 false"通过）。 */
  assert.equal(SHAPE.appliesTo({ event: 'task-status', team: { shape: 'dispatch' } }), true, '★ dispatch + 本判据事件 ⇒ 必须开口')
  assert.equal(SHAPE.appliesTo({ event: 'delivery-declared', team: { shape: 'dispatch' } }), true, '★ 交付那一刻也开口')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 接线臂）：它真的在装配清单里，且 runtime 位置可达
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（接线臂）：它真的在 `ALL_GATES` 里 —— 盘上有文件不算接上了', () => {
  /**
   * ★ 本仓实测过**不止一次**「判据本体已在盘上、夹具也有，而一次都不会跑」
   *   （`runtime.liveness` / `runtime.stall` / `delivery.coverage` 各记着一次）。
   *   ⇒ 这一臂问的就是那一格。
   */
  const listed = registry.list().runtime ?? []
  assert.ok(listed.some((gate) => gate.id === SHAPE.id), `★ ${SHAPE.id} 必须在 runtime 的注册清单里`)
  assert.equal(SHAPE.point, 'runtime', '★ 位置必须是 runtime（只记录、不拒绝）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★★★ 纯函数臂）：`shapeExecutionOf` 的三态与"干过活"闸门
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 6：`shapeExecutionOf` —— 三态两两不同形，且"没干过活"的成员不算违规', () => {
  /**
   * ── ★★ 两个自变量，缺一不可 ──────────────────────────────────────────────────────
   *
   *   ① `executedTasks`（它**干完过活**吗）—— 只看"派了几个"会把**还没开工的成员**
   *      判成违规，而那会马上教会人忽略这条判据。
   *   ② `dispatch.dispatched`（它派过吗）
   *
   * ⇒ 只有两格同时成立才算违规。下面用一个 **2×2** 把它钉住。
   */
  const rows = [
    readRow('did-work-and-dispatched', 2, 3),   // 合规
    readRow('did-work-no-dispatch', 1, 0),      // ★ 违规
    readRow('no-work-no-dispatch', 0, 0),       // 没机会派工 ⇒ **不是违规**
  ]
  const measured = shapeExecutionOf('dispatch', rows)
  assert.equal(measured.status, 'measured')
  assert.deepEqual(measured.violations, ['did-work-no-dispatch'], '★★ 只有"干过活、却一个都没派"才算违规')

  /**
   * ★★★ 三态：`not-applicable` / `measured` / `unmeasured` 必须**两两不同形**。
   *   合并任意两个都会造成一次"没测到"并进"通过"或"不适用"的合流。
   */
  const notApplicable = shapeExecutionOf('flat', rows)
  assert.equal(notApplicable.status, 'not-applicable', '★ flat ⇒ 不适用（不是"零违规"）')
  const undeclared = shapeExecutionOf(undefined, rows)
  assert.equal(undeclared.status, 'not-applicable', '★ 缺声明 ⇒ 也不适用')
  assert.notEqual(undeclared.reason, notApplicable.reason, '★★ flat 与缺声明**成因不同**：一个是"我知道自己在用扁平形态"，一个是"这一格不存在"')

  const unreadableRows = [
    readRow('did-work-and-dispatched', 2, 3),
    { name: 'cant-read', executedTasks: 1, dispatch: { status: 'unmeasured', reason: 'session gone' } },
  ]
  const unmeasured = shapeExecutionOf('dispatch', unreadableRows)
  assert.equal(unmeasured.status, 'unmeasured', '★★ 有人读不到 ⇒ 整份判不了（不是"其余合规所以通过"）')
  assert.match(unmeasured.reason, /cant-read/, '★ 必须指名是谁读不到')
  assert.notEqual(unmeasured.status, measured.status, '★★★ 与"读了、零违规"不同形')
})

test('★★ 臂 6b：`memberDispatchRows` —— 干过活 = 名下有**跑到终态**的任务', () => {
  const members = [
    { name: 'a', status: 'idle' },
    { name: 'b', status: 'idle' },
    { name: 'gone', status: 'removed' },
  ]
  const tasks = [
    { id: 't1', assignee: 'a', status: 'completed' },
    { id: 't2', assignee: 'a', status: 'in_progress' },
    { id: 't3', assignee: 'b', status: 'failed' },
  ]
  const rows = memberDispatchRows(members, tasks, () => ({ status: 'read', dispatched: 1, unreadableEvents: 0 }))
  assert.deepEqual(rows.map((row) => row.name), ['a', 'b'], '★ removed 的成员不进读数（它不会再被派活）')
  assert.equal(rows[0].executedTasks, 1, '★★ 只数**终态**任务：in_progress 还没干完，不算"干过活"')
  assert.equal(rows[1].executedTasks, 1, '★ failed 也是终态（它确实跑过一次）')
})

test('★★ 臂 6c：`dispatchReadoutOf` —— 只数 `subagent/catalog`，且坏事件单独计数', () => {
  /**
   * ★ 事件形状取自**实测**（`14f0a67e-…` 的 `session.v4.jsonl.zstd` 第 45 条）。
   */
  const catalog = (childId, extra = {}) => ({
    type: 'subagent/catalog',
    data: { version: 0, childId, childCreatedAt: 1792475600384, mode: 'continuable', label: 'Build readout', ...extra },
  })
  assert.deepEqual(
    dispatchReadoutOf([]),
    { status: 'read', dispatched: 0, unreadableEvents: 0 },
    '★ 空日志是"读了、确实一个都没派"（`read`），**不是** unmeasured',
  )
  assert.equal(dispatchReadoutOf(undefined).status, 'unmeasured', '★★ 没有日志才是 unmeasured —— 与上面那条不同形')

  const two = dispatchReadoutOf([catalog('c1'), { type: 'assistant/message' }, catalog('c2')])
  assert.equal(two.status, 'read')
  assert.equal(two.dispatched, 2, '★ 只数 catalog，别的类型不算')
  /**
   * ★★ 这一条是**定向突变打出来的**：第一版只断言 `dispatched === 2`，
   *   而把类型过滤改成 `event.type === 'nope'` 时，`assistant/message` 会被当成
   *   一条**坏 catalog**（它没有 `data.childId`）⇒ `unreadableEvents` 从 0 变 1，
   *   而 `dispatched` 仍是 2 ⇒ **那条臂零红**。
   *   ⇒ 必须显式断言"别的类型**既不派出、也不算坏事件**"。
   */
  assert.equal(two.unreadableEvents, 0, '★★ 非 catalog 事件既不算派出、也不算「坏 catalog」—— 它压根不是 catalog')
  assert.deepEqual(two.latest, { childId: 'c2', createdAt: 1792475600384, label: 'Build readout' }, '★ `latest` 是**最后一条**')

  const broken = dispatchReadoutOf([catalog('c1'), { type: 'subagent/catalog', data: { label: 'no id' } }])
  assert.equal(broken.dispatched, 1, '★ 缺 childId 的 catalog **不算派出**')
  assert.equal(broken.unreadableEvents, 1, '★★ 但它**要计数** —— 否则"读到 3 个 + 2 条读不出"与"读到 5 个"同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7（★★ 人话臂）：`describeTeamShape` 的九格里，四种必须不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 7：`describeTeamShape` —— "按形态在跑"与"形态没被执行"必须**读起来不一样**', () => {
  /**
   * ★★ 这一臂防的是"合成一句话"：把声明与执行合成一句之后，
   *   "声明了、也照做了"与"声明了、全员自己干"在返回的**同一个字符串**
   *   上同形 —— 而它们要求的动作相反（一个什么都不用做，一个要停下来看）。
   */
  const compliant = shapeExecutionOf('dispatch', [readRow('a', 1, 1)])
  const violated = shapeExecutionOf('dispatch', [readRow('a', 1, 0)])
  const unmeasured = shapeExecutionOf('dispatch', [{ name: 'a', executedTasks: 1, dispatch: { status: 'unmeasured', reason: 'gone' } }])
  const toNothing = shapeExecutionOf('flat', [])

  const say = {
    compliant: describeTeamShape('dispatch', compliant),
    violated: describeTeamShape('dispatch', violated),
    unmeasured: describeTeamShape('dispatch', unmeasured),
    flat: describeTeamShape('flat', toNothing),
    undeclared: describeTeamShape(undefined, shapeExecutionOf(undefined, [])),
  }
  assert.match(say.compliant, /held/, '★ 合规那一句要读得出"守住了"')
  assert.match(say.violated, /NOT held/, '★★ 违规那一句必须**明说没守住**')
  assert.match(say.violated, /a/, '★ 且必须指名是哪个成员')
  assert.match(say.unmeasured, /could not be measured|not be measured/, '★★ 判不了要**明说判不了**，不许写成"没有违规"')
  assert.match(say.undeclared, /no shape declaration/, '★ 存量队要读成"这一格不存在"，不是"flat"')
  const all = Object.values(say)
  assert.equal(new Set(all).size, all.length, '★★★ 五种情形必须给出**五句不同的话**（否则读者要靠猜）')
  /**
   * ★★ 而"五句不同的话"还不够 —— 每一句自己也得**不重复**。
   *   MEASURED（第一版，实测抓到的）：`not-applicable` 那一支把 `execution.reason`
   *   拼在 `declaration` 后面，而两者说的是**同一件事**，于是同一个结论读了两遍：
   *     「this team carries no shape declaration … — nothing to check:
   *        this team carries no shape declaration (older team), so …」
   *   ⇒ 一句话读两遍不是风格问题：读者会以为那是**两条**独立的证据。
   */
  for (const [label, sentence] of Object.entries(say)) {
    const clauses = sentence.split(' — ')
    assert.ok(clauses.length <= 3, `★★ "${label}" 那一句读起来像 ${clauses.length} 段，最多应有 3 段（声明 / 结论 / 成因）`)
    const repeated = sentence.match(/no shape declaration/g) ?? []
    assert.ok(repeated.length <= 1, `★★ "${label}" 把"缺声明"说了 ${repeated.length} 遍`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（★★★ 真实路径臂）：`agent_teams_status` 的那两格**真的出现在返回值里**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 8（真实路径臂）：`agent_teams_status` 真的交出 `team_shape` / `shape_execution` / `shape_violations`', async () => {
  /**
   * ── ★ 为什么必须走工具的**真实路径**，而不是只测纯函数 ─────────────────────────
   *
   * MEASURED（本仓记过**不止一次**）：`status` 的返回对象是手写的，而它的 `output`
   * schema 也是手写的。两处一旦分叉，宿主会在 `createSuccessResult` 里当场拒掉
   * **每一次** `status` 调用（`scripts/capabilities.test.mjs` 抓到过一次：
   * `"value.halted" — not a declared property`）。
   * ⇒ 只有真的调一次 `execute`，才能同时验证"产出了"与"声明接得住"。
   *
   * ★★ 而这一臂用的是**一个没有活会话的成员** ⇒ 读数必须是 `unmeasured`。
   *   那正是要钉的那一格：**"读不到"不许落成"零违规"**。
   *   （把一个假成员写成"合规"会让本仓最贵的那个合流再发生一次。）
   */
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const workspace = mkdtempSync(join(tmpdir(), 'shape-status-'))
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team', name: 'ShapeProbe', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 0,
    shape: 'dispatch',
    members: [{ id: 'member-1', name: 'ledger', role: 'dispatch point', joinedAt: 1, status: 'idle' }],
    tasks: [{ id: 't1', subject: 'did work', status: 'completed', dependencies: [], createdAt: 1, updatedAt: 2, assignee: 'ledger', kind: 'work' }],
  })
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: { getProvider() { return undefined }, list() { return [] }, sendMessage: async () => 'm', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'm' },
    agents: { list: () => [], get() { return undefined } }, on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  const out = await tools.get('agent_teams_status').execute({}, {
    agent: { id: 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} },
    signal: new AbortController().signal,
  })

  /** ★ 三格**都在**（`required` 是声明面的要求，这里是产出面的对拍）。 */
  assert.equal(typeof out.team_shape, 'string', '★ `team_shape` 必须是一句话（人能读懂声明与执行）')
  assert.equal(out.team_shape, out.team_shape.trim(), '★ 不许带首尾空白')
  assert.match(out.team_shape, /declared shape "dispatch"/, '★ 那一句必须说清**声明了什么**')
  /**
   * ★★★ 这一格是本臂的要害：**读不到 ⇒ unmeasured**。
   *   定向突变：把 `shapeExecutionFor` 里的三态折成"空数组就是零违规" ⇒ 本臂红。
   */
  assert.equal(out.shape_execution, 'unmeasured', '★★ "读不到派工"必须是 unmeasured —— 绝不许落成"零违规"')
  assert.deepEqual(out.shape_violations, [], '★ 而违规名单仍是空数组（**它恒在场**，字段缺席会让"没违规"与"这一格不存在"同形）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9（★★★ 2026-10-21）：`status` 必须**读判据的产出**，不许自己再算一遍
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 9：`status` 在判据跑过时**读它的产出**（`shape_source` 区分两份真相）', async () => {
  /**
   * ── 它补的是什么（MEASURED，`docs/OUTPUTS-CONSUMER-AUDIT.md` 的 (a)-1）────────
   *
   * 这一格此前是**两份真相**：判据自己算一遍并写进 `outputs`，
   * 而 `status` **又算了一遍**。两者独立取证 ⇒ 它们可以不一致，
   * 而"不一致"这件事**没有任何读数**。
   *
   * ★★★ 所以新增 `shape_source` 这一格：`judgment-gate`（判据算的）与
   *   `status-recomputed`（判据没跑、status 自己算的）**必须不同形** ——
   *   否则读的人不知道自己在看哪一份。
   *
   * 定向突变：把 `fromGate` 恒写成 `false` ⇒ 本条在"判据跑过"那一支上红。
   */
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const call = async (layout) => {
    const ws = mkdtempSync(join(tmpdir(), 'shape-source-'))
    await createTeamDir(join(ws, '.agent-teams'), { id: 'team', name: 'T', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 1, ...layout })
    const tools = new Map()
    const ctx = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      tools: { register(t) { tools.set(t.name, t) } },
      subagents: { getProvider() { return undefined }, list() { return [] }, sendMessage: async () => 'm', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'm' },
      agents: { list: () => [], get() { return undefined } }, on() { return () => {} }, effect(s) { return s() }, inject() { return () => {} },
    }
    registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
    return tools.get('agent_teams_status').execute({}, {
      agent: { id: 'captain-session', status: 'idle', session: { header: { cwd: ws }, events: [] }, steer() {} },
      signal: new AbortController().signal,
    })
  }

  /** ① 非 dispatch 队 ⇒ 判据不适用 ⇒ `status-recomputed`（回落是有理由的）。 */
  const plain = await call({ members: [], tasks: [] })
  assert.equal(plain.shape_source, 'status-recomputed', '★ 判据没跑 ⇒ 回落，并**标明**这一份是重算的')

  /**
   * ② dispatch 队、成员**会话读不出来** ⇒ 判据答 `unmeasured`（它的 `outputs`
   *   不带 `shape_violations`）⇒ `status` **仍然**回落成 `status-recomputed`。
   *   ★ 这一条同时钉住"判据的 `unmeasured` 与 `measured` 不同形"：
   *     前者没有名单，后者有（哪怕是空数组）。
   */
  const unreadable = await call({
    shape: 'dispatch',
    members: [{ id: 'm-fake', name: 'w', role: 'w', provider: 'p', model: 'm', reasoningEffort: 'default', joinedAt: 1, status: 'idle' }],
    tasks: [{ id: 't1', subject: 'done', status: 'completed', dependencies: [], createdAt: 1, updatedAt: 2, assignee: 'w', kind: 'work' }],
  })
  assert.equal(unreadable.shape_source, 'status-recomputed', '★ 判据 unmeasured（无名单）⇒ 回落')
  assert.equal(unreadable.shape_execution, 'unmeasured', '★ 而**状态本身**仍如实报 unmeasured（不是"没违规"）')

  /** ★★ 两种来源必须不同形 —— 这是本条的存在理由。 */
  assert.notEqual(
    plain.shape_source, 'judgment-gate',
    '★★ `status-recomputed` 与 `judgment-gate` 必须可区分（否则两份真相又合流了）',
  )
})
