/**
 * ── `delivery` 位置两条判据的三臂夹具（契约 §6）─────────────────────────────────
 *
 * 被测的是：
 *   · `delivery.coverage`    —— 每个目标都有任务认领
 *   · `delivery.convergence` —— idle ≠ converged，空回复不是收敛
 *
 * ── 三臂在本文件里各自是什么 ──────────────────────────────────────────────────
 *
 *   对照臂（臂 3）：合法的交付面（所有目标都有任务认领 + 成员确实收敛）⇒ 期望 ok
 *   伪造臂（臂 1）：有目标无人认领 / 成员其实没收敛             ⇒ 期望 blocked，
 *                   ★ 且必须【指名】是哪一个（哪个目标 / 哪个成员）
 *   未测量臂（臂 2）：拿不到目标清单或任务图 / 拿不到成员状态   ⇒ 期望 unmeasured，
 *                   ★ 与 ok / blocked 都不同形
 *
 * ★ 验收里那条带星号的：**convergence 的未测量形态必须与「已收敛」不同形**。
 *   它的反面（"拿不到状态 ⇒ 当成都收敛了 ⇒ ok"）是本项目吃过的那口亏的镜像，
 *   所以臂 5/6 专门钉它，而且不只断言"是 unmeasured"，还断言
 *   `shapeOf(unmeasured) !== shapeOf(ok)` —— 让它不可能被某次重构合流回去。
 *
 * ── 为什么夹具里还要有【注册表接线臂】（臂 9）─────────────────────────────────
 *
 * 本队反复见过的形态是"装了但调不到"：判据写得再对，`delivery` 位置没有调用点就
 * 永远不跑（t6 之前正是如此）。所以除了直接调 `gate()`（那证明判据的语义），
 * 还必须从【进程级注册表】真的求值一次 `delivery`，证明它出现在 `ran[]` 里、
 * 且裁决真的进了整体裁决。两者证明的是不同的事，缺一臂都不算完成。
 *
 * ★ 本夹具不改任何 `delivery` 位置的注册状态：探针在 try/finally 里注册与摘除，
 *   且只断言【自己那一条】的条目（别的判据可能同时挂在同一位置）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as coverageGate from '../lib/gates/delivery/coverage.js'
import * as convergenceGate from '../lib/gates/delivery/convergence.js'
import { registry } from '../lib/gates/index.js'

/**
 * 裁决的【形状】。三态不同形是机械可判的，所以夹具不靠"读起来像"来断言它，
 * 而是先算出形状再比较（与 `verify-gates-integration.test.mjs` 同构）。
 */
function shapeOf(verdict) {
  if (verdict === null || typeof verdict !== 'object') return `non-object:${JSON.stringify(verdict)}`
  if (verdict.ok === true) return 'ok'
  if (Array.isArray(verdict.blockers)) return 'blocked'
  if (typeof verdict.unmeasured === 'string') return 'unmeasured'
  return `malformed:${JSON.stringify(verdict)}`
}

/** 收窄助手：把"这条断言期望哪一种裁决"写进断言本身。 */
function expectOk(verdict, why) {
  assert.equal(shapeOf(verdict), 'ok', `${why}: expected ok, got ${JSON.stringify(verdict)}`)
  return verdict
}
function expectBlocked(verdict, why) {
  assert.equal(shapeOf(verdict), 'blocked', `${why}: expected blocked, got ${JSON.stringify(verdict)}`)
  assert.ok(verdict.blockers.length > 0, `${why}: blocked must say why`)
  return verdict.blockers
}
function expectUnmeasured(verdict, why) {
  assert.equal(shapeOf(verdict), 'unmeasured', `${why}: expected unmeasured, got ${JSON.stringify(verdict)}`)
  assert.ok(verdict.unmeasured.trim().length > 0, `${why}: unmeasured must say what could not be measured`)
  return verdict.unmeasured
}

/** 一行覆盖矩阵（与 `buildCoverageMatrix` 的产出同形）。 */
function row(goalItem, status, taskIds) {
  return { goal_item: goalItem, task_ids: taskIds, status }
}

/** 一个合法的交付面：一条目标、它有任务、任务已完成。 */
function coveredDelivery(extra = {}) {
  return {
    team: { id: 'team', members: [{ name: 'worker' }] },
    coverage: [row('ship the gate layer', 'passed', ['t1'])],
    ...extra,
  }
}

/** 一个已收敛的成员。 */
function converged(name = 'worker') {
  return { name, state: 'reported', spoke: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★ 伪造臂：coverage —— 有目标无人认领 ⇒ blocked，且指名哪个目标
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 伪造臂：有目标没有任何任务认领 ⇒ blocked，且【指名是哪个目标】', async () => {
  const verdict = await coverageGate.gate({
    team: { id: 'team' },
    coverage: [
      row('ship the gate layer', 'passed', ['t1']),
      row('audit the installer', 'missing', []),
    ],
  })
  const blockers = expectBlocked(verdict, 'coverage: an unclaimed goal')
  assert.equal(blockers.length, 1, '★ 只报真的没人认领的那一条，不连坐')
  /**
   * ★ 验收原话："指名【哪个目标】没有任务覆盖"。
   *   一条只说"有目标没人认领"的拒绝是不可行动的 —— 读到它的人得自己去差两份清单。
   */
  assert.match(blockers[0], /audit the installer/, '★ 必须指名是哪个目标')
  assert.match(blockers[0], /no task claiming it|no task declares coverageOf/, '★ 必须说清是哪一类问题')
  assert.doesNotMatch(blockers[0], /ship the gate layer/, '★ 已被认领的目标不该出现在拒绝理由里')
})

test('臂 1b ★ 伪造臂：多个目标无人认领 ⇒ 一次给全，不短路', async () => {
  const blockers = expectBlocked(await coverageGate.gate({
    team: { id: 'team' },
    coverage: [
      row('goal A', 'missing', []),
      row('goal B', 'missing', []),
      row('goal C', 'passed', ['t3']),
    ],
  }), 'coverage: several unclaimed goals')
  assert.equal(blockers.length, 2, '★ 一次给全，而不是修一个又冒一个')
  assert.ok(blockers.some((line) => line.includes('goal A')))
  assert.ok(blockers.some((line) => line.includes('goal B')))
})

test('臂 1c ★ 伪造臂（coverage）：矩阵里有一行读不懂 ⇒ unmeasured，绝不静默跳过那一行', async () => {
  /**
   * ★ 这一臂防的是最隐蔽的那条路：跳过读不懂的行。那一行的目标可能正是没人认领的
   *   那一条 —— 于是"没测到"会伪装成"覆盖没问题"。
   */
  const reason = expectUnmeasured(await coverageGate.gate({
    team: { id: 'team' },
    coverage: [row('goal A', 'passed', ['t1']), { goal_item: '', status: 'passed', task_ids: [] }, 'nonsense'],
  }), 'coverage: unreadable rows')
  assert.match(reason, /could not be read in full/, '★ 必须说清是"读不全"，而不是"覆盖没问题"')
  assert.match(reason, /coverage\[1\]|coverage\[2\]/, '★ 必须指认是哪一行读不懂')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★ 未测量臂：coverage —— 拿不到目标清单或任务图
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 未测量臂：拿不到目标清单/矩阵 ⇒ unmeasured，与 ok/blocked 都不同形', async () => {
  const missing = expectUnmeasured(await coverageGate.gate({ team: { id: 'team' } }), 'coverage: no matrix field')
  const nulled = expectUnmeasured(await coverageGate.gate({ team: { id: 'team' }, coverage: null }), 'coverage: null matrix')
  const notAList = expectUnmeasured(await coverageGate.gate({ team: { id: 'team' }, coverage: { rows: [] } }), 'coverage: non-list matrix')
  for (const reason of [missing, nulled, notAList]) {
    assert.match(reason, /could not be determined|could not be read/, '★ 措辞必须说"没能确定"，不是"没问题"')
  }
  /**
   * ★ 形状断言：未测量与 ok / blocked 必须两两不同形。
   *   把"没测到"合进"通过"正是本队要防的合流，而它会以"某次重构顺手 `?? []`"的
   *   形式回来 —— 所以这里比较的是 shape，不是文字。
   */
  const okShape = shapeOf(expectOk(await coverageGate.gate({ team: { id: 'team' }, coverage: [] }), 'coverage: empty matrix'))
  const blockedShape = shapeOf(await coverageGate.gate({
    team: { id: 'team' },
    coverage: [row('goal A', 'missing', [])],
  }))
  assert.notEqual(shapeOf({ ok: false, unmeasured: missing }), okShape, '★ unmeasured 绝不能与 ok 同形')
  assert.notEqual(shapeOf({ ok: false, unmeasured: missing }), blockedShape, '★ unmeasured 绝不能与 blocked 同形')
})

test('臂 2b ★ 未测量臂的反面：矩阵【在场但为空】⇒ ok（这是测量结论，不是没测到）', async () => {
  /**
   * ★ 缺矩阵与空矩阵必须不同形：
   *   缺席 ⇒ 没能拿到目标清单 ⇒ unmeasured；
   *   空数组 ⇒ 看过了：这次交付没有目标条目 ⇒ ok（普通 work 团队正是这样）。
   *   把两者合成一个 —— 无论合成哪一边 —— 都会错：合成 unmeasured 会让每个没有
   *   goal 概念的团队永远交付不了；合成 ok 会让一次读取失败伪装成"全都覆盖了"。
   */
  const verdict = expectOk(await coverageGate.gate({ team: { id: 'team' }, coverage: [] }), 'coverage: empty matrix')
  assert.deepEqual(verdict.goal_items, [], '★ 产出里必须能看出"没有目标条目"这件事')
  assert.match(verdict.coverage_source, /no goal item/, '★ 产出必须说清这份清单是从哪来的')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★ 对照臂：coverage —— 所有目标都有任务认领
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 对照臂：所有目标都有任务认领 ⇒ ok（证明判据不误伤正常交付）', async () => {
  const verdict = expectOk(await coverageGate.gate(coveredDelivery()), 'coverage: every goal covered')
  assert.deepEqual(verdict.goal_items, ['ship the gate layer'])
  assert.deepEqual(verdict.covered_goal_items, ['ship the gate layer'])
  assert.equal('in_progress_goal_items' in verdict, false, '★ 全绿时不该出现"进行中"字段')
})

test('臂 3b ★ 对照臂：目标【已被认领、只是还没跑完】⇒ ok（这条判据只管"有没有人认领"）', async () => {
  /**
   * ★ 边界：`in_progress` 不是本判据的拒绝理由 —— "任务没做完"是 `canDeclareDelivery`
   *   的事（它检查每个任务的状态）。本判据若把 `in_progress` 也拒掉，就与上游重复，
   *   而重复的检查会在上游改变语义时变成一条错误的拒绝。
   */
  const verdict = expectOk(await coverageGate.gate({
    team: { id: 'team' },
    coverage: [row('goal A', 'in_progress', ['t1'])],
  }), 'coverage: covered but unfinished')
  assert.deepEqual(verdict.in_progress_goal_items, ['goal A'], '★ 产出里要说清它是"有人认领但没跑完"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 伪造臂：convergence —— 有人没收敛 ⇒ blocked，且指名哪个成员
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 ★ 伪造臂：成员其实没收敛 ⇒ blocked，且指名是哪个成员、为什么', async () => {
  const cases = [
    { member: { name: 'builder', state: 'working', spoke: true }, expect: /still working/ },
    { member: { name: 'auditor', state: 'failed', spoke: true }, expect: /reported a failure/ },
    { member: { name: 'helper', state: 'unknown', spoke: true }, expect: /not a convergence state/ },
    { member: { name: 'quiet', state: 'idle', spoke: false }, expect: /empty reply/ },
  ]
  for (const { member, expect } of cases) {
    const blockers = expectBlocked(await convergenceGate.gate({
      team: { id: 'team' },
      members: [converged(), member],
    }), `convergence: ${member.name}`)
    assert.equal(blockers.length, 1, '★ 只报真的没收敛的那一个')
    assert.match(blockers[0], new RegExp(member.name), '★ 必须指名是哪个成员')
    assert.match(blockers[0], expect, '★ 必须说清是哪一类没收敛')
  }
})

test('臂 4b ★ 伪造臂：idle 但最近一次回复是空的 ⇒ 不算收敛（idle ≠ converged）', async () => {
  /**
   * ★ 这一臂是本判据存在的【全部理由】：上游只看得到 `activity: 'idle'`，
   *   而"空回复"落进 idle 之后与"做完了"完全同形。所以这里用【最小差异】
   *   比较：两条输入只差 `spoke` 一位，裁决必须从 ok 变成 blocked。
   */
  const convergedArm = await convergenceGate.gate({
    team: { id: 'team' },
    members: [{ name: 'quiet', state: 'idle', spoke: true }],
  })
  expectOk(convergedArm, 'convergence: idle with a non-empty last reply')

  const silentArm = await convergenceGate.gate({
    team: { id: 'team' },
    members: [{ name: 'quiet', state: 'idle', spoke: false }],
  })
  const blockers = expectBlocked(silentArm, 'convergence: idle with an empty last reply')
  assert.match(blockers[0], /quiet/)
  assert.match(blockers[0], /empty reply/)
})

test('臂 4c ★ 伪造臂：没见过的状态值 ⇒ 拒绝（白名单，缺省方向不得是放行）', async () => {
  /**
   * ★ 上游的活动枚举今天是 `running | idle | ready`。未来多一个取值时，
   *   一条黑名单实现（"不是 working 就算收敛"）会静默放行；白名单会当场拒绝。
   *   这一臂钉的就是缺省方向。
   */
  const blockers = expectBlocked(await convergenceGate.gate({
    team: { id: 'team' },
    members: [{ name: 'future', state: 'sleeping', spoke: true }],
  }), 'convergence: an unseen state value')
  assert.match(blockers[0], /future/)
  assert.match(blockers[0], /not a convergence state/)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 未测量臂（验收点名的那一条）：拿不到成员状态 ⇒ unmeasured，不得当成收敛
// ─────────────────────────────────────────────────────────────────────────────

test('臂 5 ★★ 未测量臂：拿不到成员状态 ⇒ unmeasured，且与「已收敛」不同形', async () => {
  const missing = expectUnmeasured(
    await convergenceGate.gate({ team: { id: 'team' } }),
    'convergence: no member observations at all',
  )
  assert.match(missing, /not observed/, '★ 必须说清"没能观察"，而不是"都收敛了"')
  assert.match(missing, /not a converged team/, '★ 措辞必须把"没观察"与"已收敛"分开')

  const notAList = expectUnmeasured(
    await convergenceGate.gate({ team: { id: 'team' }, members: 'all good' }),
    'convergence: observations are not a list',
  )
  assert.match(notAList, /could not be determined/)

  /**
   * ★ 验收原话："convergence 的未测量形态必须与「已收敛」不同形"。
   *   这里把它变成一条机械断言：同一份上下文，只把【观察在不在】换掉，
   *   裁决的 shape 必须不同，且 unmeasured 那侧的措辞不许读成收敛。
   */
  const convergedShape = shapeOf(await convergenceGate.gate({ team: { id: 'team' }, members: [converged()] }))
  const unmeasuredShape = shapeOf(await convergenceGate.gate({ team: { id: 'team' } }))
  assert.equal(convergedShape, 'ok')
  assert.equal(unmeasuredShape, 'unmeasured')
  assert.notEqual(unmeasuredShape, convergedShape, '★ "没测到"绝不能与"已收敛"同形')
})

test('臂 5b ★★ 未测量臂：观察到的成员缺 `spoke`（没能观察它最后有没有说话）⇒ unmeasured', async () => {
  /**
   * ★ 这是"空回复不是收敛"的边界：没观察过输出，就不能声称它收敛了。
   *   把缺席的 `spoke` 读成 `true` 正是"没测到并进通过"，所以它必须挡住交付。
   */
  const reason = expectUnmeasured(await convergenceGate.gate({
    team: { id: 'team' },
    members: [converged(), { name: 'mute', state: 'reported' }],
  }), 'convergence: spoke not observed')
  assert.match(reason, /mute/, '★ 必须指名是哪个成员的输出没能观察')
  assert.match(reason, /was not observed/)
})

test('臂 5c ★ 未测量臂：某一行读不懂 ⇒ 整条未测量（不静默跳过那一行）', async () => {
  const reason = expectUnmeasured(await convergenceGate.gate({
    team: { id: 'team' },
    members: [converged(), { name: 'victim' }, null],
  }), 'convergence: unreadable rows')
  assert.match(reason, /could not be read in full/)
  assert.match(reason, /victim|member\[2\]/, '★ 必须指认是哪一行读不懂')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6 ★ 对照臂：convergence —— 成员确实收敛
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 ★ 对照臂：每个成员都明确收敛 ⇒ ok', async () => {
  const verdict = expectOk(await convergenceGate.gate({
    team: { id: 'team' },
    members: [
      { name: 'worker', state: 'reported', spoke: true },
      { name: 'helper', state: 'idle', spoke: true },
    ],
  }), 'convergence: everyone converged')
  assert.deepEqual(verdict.converged_members, ['worker', 'helper'])
})

test('臂 6b ★ 对照臂：团队【观察过了、确实没有成员】⇒ ok，且产出里说清这一点', async () => {
  /**
   * ★ 与臂 5 是一对：`members: []`（观察了，没有成员）与 `members` 缺席（没观察）
   *   必须不同形。把空数组也读成"没测到"会让一个普通 work 团队永远交付不了。
   */
  const verdict = expectOk(await convergenceGate.gate({ team: { id: 'team' }, members: [] }), 'convergence: no members')
  assert.equal(verdict.converged_note.includes('no members'), true, '★ 产出必须把"没有成员"与"都收敛了"分开')
  assert.deepEqual(verdict.converged_members, [])
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：appliesTo —— "不适用"与"没能测量"必须不同形
// ─────────────────────────────────────────────────────────────────────────────

test('臂 7 appliesTo：两条判据都不把"没有内容"写成跳过（跳过 ≠ 没测到）', async () => {
  /**
   * ★ 这两条判据都刻意【不】用 `appliesTo` 排除"没有目标 / 没有成员"的情形 ——
   *   那样会让它们落进 `skipped`，而 `skipped`（判据没跑）与 `unmeasured`
   *   （判据跑了、说测不了）在日志里必须不同形（t9 已为观察模式钉过这条界线）。
   *   所以 appliesTo 只回答"这一步是不是交付判读"，与输入内容无关。
   */
  assert.equal(coverageGate.appliesTo({ team: { id: 'team' }, coverage: [] }), true)
  assert.equal(coverageGate.appliesTo({ team: { id: 'team' } }), true, '★ 缺矩阵必须是 unmeasured，不是 skipped')
  assert.equal(convergenceGate.appliesTo({ team: { id: 'team' }, members: [] }), true)
  assert.equal(convergenceGate.appliesTo({ team: { id: 'team' } }), true, '★ 缺成员状态必须是 unmeasured，不是 skipped')
  // 不在交付判读里（没传 team）⇒ 不适用。这一条是调用点契约，不是判据语义。
  assert.equal(coverageGate.appliesTo({}), false)
  assert.equal(convergenceGate.appliesTo({}), false)
  assert.equal(convergenceGate.appliesTo(undefined), false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：两条判据的元数据
// ─────────────────────────────────────────────────────────────────────────────

test('臂 8 元数据：id / point 与注册表的位置一致，且描述非空（控制台靠它渲染）', async () => {
  assert.equal(coverageGate.id, 'delivery.coverage')
  assert.equal(coverageGate.point, 'delivery')
  assert.equal(convergenceGate.id, 'delivery.convergence')
  assert.equal(convergenceGate.point, 'delivery')
  assert.ok(coverageGate.description.trim().length > 0)
  assert.ok(convergenceGate.description.trim().length > 0)
  assert.equal(typeof coverageGate.gate, 'function')
  assert.equal(typeof convergenceGate.gate, 'function')
  const { INSERTION_POINTS } = await import('../lib/gates/index.js')
  for (const point of [coverageGate.point, convergenceGate.point]) {
    assert.ok(INSERTION_POINTS.includes(point), `insertion point "${point}" must exist`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9 ★ 接线臂：两条判据真的会被 `delivery` 位置求值
// ─────────────────────────────────────────────────────────────────────────────

test('★ 接线臂：两条判据都出现在 delivery 位置的真实求值里，且裁决进整体裁决', async () => {
  /**
   * ★ 本队反复见过的形态是"装了但调不到"：判据写得再对，位置没有调用点也永远不跑。
   *   上面那些臂直接调 `gate()`，证明的是**语义**；这一臂走【进程级注册表】，
   *   证明的是**接线** —— 它必须出现在 `ran[]` 里，而不是仅仅被 import 过。
   *
   * ★ 只断言自己这两条：同一位置上可能还挂着别人的判据（并行开发），
   *   断言"这个位置只有两条"会把夹具变成一条一接就红的棘轮。
   *
   * ★ 但"它们到底在不在注册清单里"这件事由两条判据的**引用身份**决定，
   *   不由名字决定：本夹具直接持有的是模块对象，所以这里把 `ran[]` 的 id 与
   *   模块自己的 id 对上 —— 一个把 point 挂错的实现会在这里红（而不是悄悄
   *   被求值到别的位置去）。
   */
  const wiring = await registry.evaluate('delivery', {
    team: { id: 'team' },
    gate: { ok: true, blockers: [] },
    coverage: [row('goal A', 'missing', [])],
  })
  const coverageEntry = wiring.ran.find((entry) => entry.id === coverageGate.id)
  const convergenceEntry = wiring.ran.find((entry) => entry.id === convergenceGate.id)
  assert.ok(coverageEntry !== undefined, `★ ${coverageGate.id} 必须出现在 delivery 位置的真实求值里（装上了就要跑得起来）`)
  assert.ok(convergenceEntry !== undefined, `★ ${convergenceGate.id} 必须出现在 delivery 位置的真实求值里`)
  assert.equal(coverageEntry.verdict, 'blocked', '★ 这个输入必须让 coverage 开火')
  assert.equal(convergenceEntry.verdict, 'unmeasured', '★ 这个输入没给成员状态 ⇒ 它必须说"测不了"')
  assert.equal(wiring.ok, false)
  const joined = wiring.unmeasured ?? ''
  assert.match(joined, /delivery\.convergence/, '★ 未测量的裁决必须进整体裁决（带 id 前缀），否则开火了也没人看得见')
  assert.ok(
    wiring.blockers.some((line) => line.includes(coverageGate.id)),
    '★ blocked 的裁决必须进 blockers（带 id 前缀）',
  )
})

test('★ 接线臂（对照）：合法交付面上两条判据都必须安静', async () => {
  const wiring = await registry.evaluate('delivery', {
    team: { id: 'team' },
    gate: { ok: true, blockers: [] },
    coverage: [row('goal A', 'passed', ['t1'])],
    members: [{ name: 'worker', state: 'reported', spoke: true }],
  })
  const coverageEntry = wiring.ran.find((entry) => entry.id === coverageGate.id)
  const convergenceEntry = wiring.ran.find((entry) => entry.id === convergenceGate.id)
  assert.equal(coverageEntry?.verdict, 'ok', '★ 合法交付面上 coverage 不得开火（否则这条判据在乱拒）')
  assert.equal(convergenceEntry?.verdict, 'ok', '★ 合法交付面上 convergence 不得开火')
  assert.ok(
    !wiring.blockers.some((line) => line.includes('delivery.coverage') || line.includes('delivery.convergence')),
    '★ 两条判据都不许在这个输入上产出 blocker',
  )
  assert.ok(
    (wiring.unmeasured ?? '') === '' || (!wiring.unmeasured.includes('delivery.coverage') && !wiring.unmeasured.includes('delivery.convergence')),
    '★ 两条判据都不许在这个输入上产出 unmeasured',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（t15）★★ 「从未 spawn」是可判定的事实，不是没能测量
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 这条修的是一个**自己造的语义空白**（t15）：
 *
 *   MEASURED：一个**依赖未满足**的成员不会 spawn —— 它的 `id` 是空串。而那是
 *   **被设计期望的正常情形**（`lifecycle-verify.mjs` 有一条 check 明确断言它不
 *   spawn：`dependency-blocked roster does not spawn a model session`）。
 *
 *   最初的实现把"id 为空"甩给调用方（不注入）⇒ 判据收到"没能观察" ⇒ unmeasured
 *   ⇒ **只要队里有一个依赖未满足的成员，整个交付位置就永远无法被测量**。
 *   **一道永远关着的门**，而且是被这条判据自己焊上的。
 *
 *   ⇒ 正确的分界不是"能不能读到那个成员的会话"，而是**这件事可不可判定**：
 *       从未 spawn   —— 可判定的事实：它没起来过，也就没交回任何东西 ⇒ **阻止**
 *       读不出来     —— 没能测量：它可能起来了、也可能没起来 ⇒ unmeasured
 */

test('★ 臂 6a（t15 核心）：从未 spawn 的成员 ⇒ blocked（阻止，不是 unmeasured）', async () => {
  const [reason] = expectBlocked(await convergenceGate.gate({
    team: { id: 'team' },
    members: [converged('analyst'), { name: 'implementer', state: 'never-spawned' }],
  }), 'convergence: a member that never started must block the delivery')
  assert.match(reason, /implementer/, '★ 必须指名那个成员')
  /**
   * ★ 措辞必须说【它从未起来过】这件事本身，而不是笼统的"不是收敛态"：
   *   读日志的人据此知道下一步该查**依赖/派发**，而不是去查状态读取 ——
   *   两件事的动作完全不同。
   */
  assert.match(reason, /never started|never spawned/, '★ 必须说清成因是"从未起来"')
  assert.match(reason, /has returned nothing/, '★ 必须说清后果：它没有交回任何东西')
})

test('★ 臂 6b（t15）：从未 spawn 的成员【不需要】spoke —— 它压根没有会话', async () => {
  /**
   * ★ 这个例外是本判据的**语义**，不是宽松：
   *
   *   一个从未 spawn 的成员**本来就没有会话**，所以"它最后说了什么"这一位
   *   **不存在** —— 不是"没能读到"。要求它必须带 `spoke`，等于要求调用方为一个
   *   没起来过的成员编一份发言记录；而那正是 t15 要消灭的形状。
   *
   * ★ 与臂 5b 的对照（这两条必须同时成立，否则分界就错了）：
   *     · 起来了、但没观察到它说没说话 ⇒ unmeasured（臂 5b）
   *     · 根本没起来                  ⇒ blocked（本臂，即使没有 spoke）
   */
  const blockedVerdict = await convergenceGate.gate({
    team: { id: 'team' },
    members: [{ name: 'implementer', state: 'never-spawned' }],
  })
  assert.equal(blockedVerdict.ok, false)
  assert.ok(Array.isArray(blockedVerdict.blockers), '★ 没有 spoke 也要走 blocked 这条路径，不能退化成 unmeasured')
  assert.equal(blockedVerdict.unmeasured, undefined)

  // 反面：同一个团队里若成员【起来了】而 spoke 没观察 ⇒ 仍然是 unmeasured（臂 5b 的语义没被破坏）
  const stillUnmeasured = await convergenceGate.gate({
    team: { id: 'team' },
    members: [{ name: 'started-but-mute', state: 'reported' }],
  })
  assert.equal(stillUnmeasured.ok, false)
  assert.equal(typeof stillUnmeasured.unmeasured, 'string', '★ "起来了但没观察到发言"仍然必须是 unmeasured')
  assert.equal(stillUnmeasured.blockers, undefined)
})

test('★ 臂 6c（t15）：三态两两不同形 —— 可判定但未起来 / 真拿不到观察 / 观察过且收敛', async () => {
  /**
   * ★ 验收点名的那条：三态仍必须两两不同形。
   *   尤其"可判定但未起来 ⇒ blocked"与"拿不到观察 ⇒ unmeasured"这两条 ——
   *   它们都阻止交付，但**成因与责任完全不同**，混起来人就分不出
   *   "这个成员没起来"与"我读不到成员状态"。
   */
  const neverStarted = await convergenceGate.gate({
    team: { id: 'team' }, members: [{ name: 'implementer', state: 'never-spawned' }],
  })
  const unobserved = await convergenceGate.gate({ team: { id: 'team' } })
  const convergedVerdict = await convergenceGate.gate({
    team: { id: 'team' }, members: [converged()],
  })

  const shapes = [shapeOf(neverStarted), shapeOf(unobserved), shapeOf(convergedVerdict)]
  assert.equal(shapes[0], 'blocked')
  assert.equal(shapes[1], 'unmeasured')
  assert.equal(shapes[2], 'ok')
  assert.equal(new Set(shapes).size, 3, '★ 三种结论的 shape 必须两两不同')

  // 措辞也不许互相借用
  assert.doesNotMatch(neverStarted.blockers.join(' '), /not observed|could not measure/)
  assert.doesNotMatch(unobserved.unmeasured, /never started|has returned nothing/)
})

test('★ 臂 6d（t15）：从未 spawn + 有 error 上下文 ⇒ 仍然 blocked，且把原因带上', async () => {
  /**
   * ★ 与既有 `failed` / `unknown` 的 `error` 约定一致：它**不改变裁决**，
   *   只让 blocker 更可行动（"成员 X 没收敛"与"成员 X 起不来：依赖 t1 未满足"
   *   的下一步动作差一个往返）。
   */
  const [reason] = expectBlocked(await convergenceGate.gate({
    team: { id: 'team' },
    members: [converged('analyst'), {
      name: 'implementer', state: 'never-spawned', error: 'dependency t1 is unsatisfied',
    }],
  }), 'convergence: never-spawned with context')
  assert.match(reason, /never started/)
  assert.match(reason, /dependency t1 is unsatisfied/, '★ error 上下文必须带上（不改变裁决，但更可行动）')
})

test('★ 臂 6e（t15 接线）：真实路径上，一个依赖未满足的成员不再让整个交付位置无法测量', async () => {
  /**
   * ★ 这条臂钉的是**修复的目的**，而不只是分支逻辑：
   *   "profile 团队第一步只让 analyst 干活、implementer 依赖未满足"是**正常情形**。
   *   修复前：交付位置对**任何**这样的团队都返回 unmeasured ⇒ 永远无法交付。
   *   修复后：它给出一个**可行动**的 blocked（指名 implementer 从未起来）。
   *
   *   ⇒ 于是"这道门"从【永远关闭且说不清原因】变成【关闭但说得出为什么】——
   *     而后者才是门禁该有的样子。
   */
  const verdict = await convergenceGate.gate({
    team: { id: 'team' },
    members: [
      converged('analyst'),
      { name: 'implementer', state: 'never-spawned', error: 'dependency t1 is unsatisfied' },
    ],
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.unmeasured, undefined, '★ 不再是"测不成" —— 这是一个可判定的结论')
  assert.ok(verdict.blockers.length >= 1)
  assert.match(verdict.blockers.join(' '), /implementer/)
  /**
   * ★ 而"成员真的没起来"与"我在这一步只是个读操作"这件事是分开的：
   *   判据只说成员没收敛，**不**说这次查询本身失败了。
   */
  assert.doesNotMatch(verdict.blockers.join(' '), /could not measure|not observed/)
})
