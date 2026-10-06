/**
 * ── 注册表的测试 ──────────────────────────────────────────────────────────────
 *
 * 契约见 `docs/GATE-REGISTRY.md`。这里钉的是【注册表本身的语义】，
 * 不是任何一条判据的语义（那些在各自的 `<id>.test.mjs`）。
 *
 * ★ 每一条都指名它防的是什么失效 —— 注册表是接线层，它错了会让
 *   "装了判据"与"没装判据"在日志里同形。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createGateRegistry, ok, blocked, unmeasured, INSERTION_POINTS,
} from '../lib/gates/registry.js'

/** 一个最小的注册表，带一条指定裁决的判据。 */
function withGate(point, verdict, extra = {}) {
  const r = createGateRegistry()
  r.register({
    id: 'probe', point, description: 'probe',
    gate: () => verdict,
    ...extra,
  })
  return r
}

test('① 三态裁决的构造器：每一条都必须说清自己是什么', () => {
  assert.deepEqual(ok(), { ok: true })
  assert.deepEqual(blocked('why'), { ok: false, blockers: ['why'] })
  assert.deepEqual(unmeasured('could not run'), { ok: false, unmeasured: 'could not run' })
  /**
   * ★ 一个不说原因的 blocked 与一个说原因的 blocked，在日志里必须不同形。
   *   而"不说原因"这条错误必须在【构造时】就炸，而不是等到读日志的人发现。
   */
  assert.throws(() => blocked(), /must say why/)
  assert.throws(() => blocked('', '  '), /must say why/)
  assert.throws(() => unmeasured(''), /must say what could not be measured/)
})

test('② ★ 非法裁决形状【抛错】—— 否则这条判据就是"装上了但没生效"', async () => {
  const cases = [
    [null, /malformed verdict/],
    [{}, /malformed verdict/],
    [{ ok: 'yes' }, /malformed verdict/],
    // ok:false 却不说为什么 —— 最危险：它可能被当成通过
    [{ ok: false }, /said neither why/],
    // 两个都说了 —— "发现问题"与"没能测量"是两种不同的主张，不许混
    [{ ok: false, blockers: ['x'], unmeasured: 'y' }, /pick one/],
  ]
  for (const [verdict, re] of cases) {
    const r = withGate('completion', verdict)
    await assert.rejects(() => r.evaluate('completion', {}), re)
  }
})

test('③ ★ unmeasured 优先于 blockers（未测量意味着其余通过也不可信）', async () => {
  const r = createGateRegistry()
  r.register({ id: 'a', point: 'completion', description: 'a', gate: () => blocked('found a problem') })
  r.register({ id: 'b', point: 'completion', description: 'b', gate: () => unmeasured('review returned nothing') })
  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, false)
  assert.match(v.unmeasured, /\[b\] review returned nothing/)
  /**
   * ★ blockers 仍要【保留】：那条问题是真的，只是这一轮的可信度更低。
   *   丢掉它会让"没测成"掩盖"已经发现的问题"。
   */
  assert.deepEqual(v.blockers, ['[a] found a problem'])
})

test('④ ★ 不短路：一次给全部 blocker（上游是遇错即返回，一轮只发现一个）', async () => {
  const r = createGateRegistry()
  for (const id of ['x', 'y', 'z']) {
    r.register({ id, point: 'completion', description: id, gate: () => blocked(`${id} failed`) })
  }
  const v = await r.evaluate('completion', {})
  assert.equal(v.blockers.length, 3, '★ 三条判据的问题必须一次全报，否则修一个又冒一个（实测：串行发现花了三轮）')
})

test('⑤ ★ 重复 id 抛错，不静默覆盖', () => {
  const r = withGate('contract', ok())
  assert.throws(
    () => r.register({ id: 'probe', point: 'contract', description: 'again', gate: () => ok() }),
    /already registered/,
  )
  /**
   * ★ 静默覆盖会让"我换了一条判据"与"两条都在、后一条赢了"在日志里同形
   *   —— 而后者意味着旧判据从未停止运行，只是结果被丢掉了。
   */
})

test('⑥ 注册时校验形状（id / point / gate / description）', async () => {
  const r = createGateRegistry()
  assert.throws(() => r.register({ point: 'contract', description: 'd', gate: () => ok() }), /non-empty id/)
  assert.throws(() => r.register({ id: 'a', point: 'nowhere', description: 'd', gate: () => ok() }), /unknown insertion point/)
  assert.throws(() => r.register({ id: 'a', point: 'contract', description: 'd' }), /no gate function/)
  assert.throws(
    () => r.register({ id: 'a', point: 'contract', gate: () => ok() }),
    /requires a description/,
    '★ 描述是控制台渲染的东西；没有它就看不见这条判据装了什么',
  )
  /**
   * ★ 位置集合只能**按形状**断言，不能按数量。
   *
   * MEASURED（2026-10-06，t5 加「成团之前」的位置）：这里此前写着
   * `INSERTION_POINTS.length === 5`。而"有几个位置"是**流程的形状**，它会变
   * （这一轮就多了一个 `admission`：判的是准入，与"契约合不合法"是两件事）。
   * ⇒ 一条把"恰好五个"写成不变量的断言，会在流程真的长出一个位置的那一刻变红，
   *   而红的原因与"注册表坏了"毫无关系 —— 那是棘轮，不是回归。
   *
   * ★ 换成两条**机制形状**的断言，它们在任何位置数量下都成立、且真的会红：
   *   ① 每个位置都能被 `evaluate` 到（只写在数组里、调不到的位置是不算数的）；
   *   ② 位置名唯一（重名会让 `list()` 的键合并，两个位置悄悄变成一格）。
   *   ★ 少了这一对，"位置集合"就没有任何东西在看；而只留"长度等于 N"则相反：
   *     它对**内容**一无所知（把 contract 改名成 foo，长度照样是 5）。
   */
  for (const point of INSERTION_POINTS) {
    assert.equal(
      (await r.evaluate(point, {})).registered,
      0,
      `★ 位置 "${point}" 必须能被 evaluate 到（一条判据都没挂时 registered=0，而不是抛"unknown insertion point"）`,
    )
  }
  assert.equal(new Set(INSERTION_POINTS).size, INSERTION_POINTS.length, '★ 位置名必须唯一 —— 重名会让 list() 的两个键合成一格')
  assert.ok(
    INSERTION_POINTS.includes('admission'),
    '★ 「成团之前」的位置必须存在：判的是准入（够不够格进场），与 contract（契约合不合法）是两件事',
  )
})

test('⑦ appliesTo 为假 ⇒ 跳过（且可分辨"跳过"与"通过"）', async () => {
  const r = createGateRegistry()
  r.register({
    id: 'impl-only', point: 'completion', description: 'd',
    appliesTo: (ctx) => ctx.kind === 'implementation',
    gate: () => blocked('should not run for non-implementation'),
  })
  const skipped = await r.evaluate('completion', { kind: 'review' })
  assert.equal(skipped.ok, true)
  assert.deepEqual(skipped.ran, [{ id: 'impl-only', verdict: 'skipped' }])
  const ran = await r.evaluate('completion', { kind: 'implementation' })
  assert.equal(ran.ok, false)
  /**
   * ★ "跳过"与"通过"必须可分辨 —— 否则一条只对 implementation 生效的判据，
   *   在 review 上会被读成"检查过了，没问题"。
   */
  assert.equal(ran.ran[0].verdict, 'blocked')
})

test('⑧ list() 是控制台的数据源：按位置分组、含描述', () => {
  const r = createGateRegistry()
  r.register({ id: 'c1', point: 'contract', description: '契约检查一', gate: () => ok() })
  r.register({ id: 'd1', point: 'delivery', description: '交付检查一', gate: () => ok() })
  const l = r.list()
  assert.deepEqual(Object.keys(l), INSERTION_POINTS, '★ 五个位置必须都在（空位置也要出现，否则控制台看不出哪个位置还没接）')
  assert.equal(l.contract.length, 1)
  assert.equal(l.contract[0].description, '契约检查一')
  assert.equal(l.completion.length, 0, '★ 空位置要如实为空')
})

test('⑨ 未注册任何判据 ⇒ 通过（空注册表不阻塞流程）', async () => {
  const r = createGateRegistry()
  for (const point of INSERTION_POINTS) {
    const v = await r.evaluate(point, {})
    assert.equal(v.ok, true, `★ 空位置 ${point} 必须放行 —— 否则没装判据的流程会被卡死`)
    assert.deepEqual(v.ran, [])
  }
})

test('⑩ 异步判据被 await（需要 I/O 的判据由调用方注入执行器，见契约 §5）', async () => {
  const r = createGateRegistry()
  r.register({
    id: 'async', point: 'completion', description: 'd',
    gate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return blocked('async found a problem')
    },
  })
  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, false)
  assert.deepEqual(v.blockers, ['[async] async found a problem'])
})

test('⑪ 求值顺序稳定（按注册顺序，便于复现）', async () => {
  const r = createGateRegistry()
  const seen = []
  for (const id of ['one', 'two', 'three']) {
    r.register({ id, point: 'completion', description: id, gate: () => { seen.push(id); return ok() } })
  }
  await r.evaluate('completion', {})
  assert.deepEqual(seen, ['one', 'two', 'three'])
  /**
   * ★ 顺序不稳定会让同一条夹具两次跑出不同顺序的 blocker 列表 ——
   *   而"两次报错逐字节相同"正是我们今天用来证明门禁确定性的判据。
   */
})

test('⑫ unregister 生效，且注销后该位置回到空', async () => {
  const r = withGate('delivery', blocked('nope'))
  assert.equal((await r.evaluate('delivery', {})).ok, false)
  assert.equal(r.unregister('probe'), true)
  assert.equal((await r.evaluate('delivery', {})).ok, true)
  assert.equal(r.unregister('probe'), false, '★ 二次注销返回 false，不抛错（幂等）')
})

test('⑬ ★ 判据在【被采纳】时产出的数据要被交出来（否则只能写副作用）', async () => {
  const r = createGateRegistry()
  r.register({
    id: 'producer', point: 'completion', description: 'd',
    // 通过时交出一份"判据层亲眼看到的结果"
    gate: () => ({ ok: true, reruns: [{ command: 'x', exitCode: 0 }] }),
  })
  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, true)
  assert.deepEqual(
    v.outputs['producer'],
    { reruns: [{ command: 'x', exitCode: 0 }] },
    '★ 一个只能表达"过/不过"的接线层，会逼判据把结果写进副作用里',
  )
  assert.equal(v.ran[0].produced, true, '★ ran 里也要看得出"这条判据交了东西"')
})

test('⑭ ★ 被【拒绝】的判据，它的产出不得被当成结果使用', async () => {
  const r = createGateRegistry()
  r.register({
    id: 'bad', point: 'completion', description: 'd',
    gate: () => ({ ok: false, blockers: ['nope'], reruns: [{ command: 'x', exitCode: 999 }] }),
  })
  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, false)
  assert.deepEqual(
    v.outputs,
    {},
    '★ 一条被拒的判据的产出如果被采纳，就等于用它的结果去覆盖记录 —— 而它刚刚说了不可信',
  )
})

test('⑮ 没有产出的判据 ⇒ outputs 为空对象（不是 undefined）', async () => {
  const r = withGate('delivery', ok())
  const v = await r.evaluate('delivery', {})
  assert.deepEqual(v.outputs, {}, '★ 调用方不必写 `?? {}` —— 空即空')
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑯ 三臂：「全跳过」不得与「都通过」同形（t13）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 判据形态（收窄助手）：把一个裁决对象压成【可比较的形状】。
 *   它把"哪几个字段在场"这件事变成可断言的东西 —— 因为在日志里，两者的
 *   区别恰恰就是"在场/缺席"，而不是值的不同。
 */
function shapeOf(evaluation) {
  return {
    ok: evaluation.ok,
    blockers: evaluation.blockers.length,
    unmeasured: evaluation.unmeasured !== undefined,
    skippedAll: evaluation.skippedAll !== undefined,
    evaluated: evaluation.evaluated,
    skipped: evaluation.skipped,
    registered: evaluation.registered,
  }
}

/** 一个位置，挂 N 条判据，全部被 appliesTo 跳过。 */
function allSkippedRegistry(point, count = 3) {
  const r = createGateRegistry()
  for (let index = 0; index < count; index += 1) {
    r.register({
      id: `skip-${index}`, point, description: 'skipped probe',
      // ★ 判据本身会【拒绝】—— 这样"全跳过却没拦住"就不是因为判据温和，而是因为没跑。
      appliesTo: () => false,
      gate: () => blocked('this gate would have blocked if it had run'),
    })
  }
  return r
}

test('⑯ 臂 1 ★ 全跳过：有判据、却一条没跑 ⇒ 可读出「跑了 0 条」，且与「都通过」不同形', async () => {
  const skippedRegistry = allSkippedRegistry('completion', 3)
  const passedRegistry = createGateRegistry()
  for (let index = 0; index < 3; index += 1) {
    passedRegistry.register({ id: `pass-${index}`, point: 'completion', description: 'passing probe', gate: () => ok() })
  }

  const skipped = await skippedRegistry.evaluate('completion', {})
  const passed = await passedRegistry.evaluate('completion', {})

  /**
   * ★ 这是本任务的核心断言：`ok` 一样，但**形状必须不同**。
   *   改动前这两行 `shapeOf` 完全相等 —— 一次忘了传上下文的重构会让四条判据
   *   静默全跳过，而门禁返回 `ok: true`，读起来与"都过了"一模一样。
   */
  assert.equal(skipped.ok, true, '★ 全跳过【不翻成 ok:false】—— 那是正常情形（空位置同理），拒掉它会卡死流程')
  assert.notDeepEqual(shapeOf(skipped), shapeOf(passed), '★ 全跳过与都通过必须不同形，否则人只能看见"通过"')
  assert.equal(skipped.evaluated, 0, '★ 必须能读出"一条都没跑"')
  assert.equal(skipped.skipped, 3)
  assert.equal(skipped.registered, 3)
  assert.match(skipped.skippedAll, /none of the 3 gate\(s\) registered at "completion" applied/)
  assert.match(skipped.skippedAll, /this step was not checked/, '★ 话要说全：不只是"没跑"，还有"所以这一步没被检查"')

  // 对照：都通过的形状
  assert.equal(passed.evaluated, 3)
  assert.equal(passed.skipped, 0)
  assert.equal(passed.skippedAll, undefined, '★ 「都通过」不许带"没检查"的说明 —— 两者不同形')
  assert.equal(skipped.skippedAll !== undefined, true)
})

test('⑯ 臂 2 ★ 空位置：本来就没有判据 ⇒ 仍返回 ok，且【不得】产出「没检查」的说明', async () => {
  const empty = createGateRegistry()
  const verdict = await empty.evaluate('delivery', {})

  assert.equal(verdict.ok, true, '★ 空位置必须放行 —— 把"这里还没接判据"判成拒绝，是误伤')
  assert.deepEqual(verdict.ran, [])
  /**
   * ★ 关键：空位置与全跳过必须【不同形】。
   *   两者都是"一条都没跑"，但一个是"这里还没有判据"（正常），
   *   一个是"有判据却全被跳过"（要曝光）。混起来，静默全跳过会伪装成
   *   "这个位置本来就没判据"。
   */
  assert.equal(verdict.registered, 0, '★ 空位置：registered=0')
  assert.equal(verdict.evaluated, 0)
  assert.equal(verdict.skipped, 0)
  assert.equal(verdict.skippedAll, undefined, '★ 空位置不得产出"没检查"的说明 —— 那是正常情形，不是异常')

  const skipped = await allSkippedRegistry('delivery', 1).evaluate('delivery', {})
  assert.notDeepEqual(
    shapeOf(verdict),
    shapeOf(skipped),
    '★ 「空位置」与「全跳过」必须不同形 —— 否则一次静默全跳过会伪装成"这个位置本来就没判据"',
  )
})

test('⑯ 臂 3 ★ 至少一条跑了 ⇒ 三种合并规则一字不改（ok / blocked / unmeasured）', async () => {
  /**
   * ★ 混着放：两条被跳过、一条真跑。跳过的那两条如果被当成"跑了"，结果会变。
   */
  const r = createGateRegistry()
  r.register({ id: 'skip-a', point: 'completion', description: 'd', appliesTo: () => false, gate: () => blocked('must not surface') })
  r.register({ id: 'run-ok', point: 'completion', description: 'd', gate: () => ok() })
  r.register({ id: 'skip-b', point: 'completion', description: 'd', appliesTo: () => false, gate: () => blocked('must not surface') })

  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, true)
  assert.deepEqual(v.blockers, [], '★ 被跳过的判据【不得】贡献 blocker')
  assert.equal(v.evaluated, 1, '★ 只数真的跑了的')
  assert.equal(v.skipped, 2)
  assert.equal(v.registered, 3)
  assert.equal(v.skippedAll, undefined, '★ 有判据跑了 ⇒ 不是"全跳过"，不许带那句说明')

  // 原样保留的三种合并规则
  const blockedR = createGateRegistry()
  blockedR.register({ id: 'b', point: 'completion', description: 'd', gate: () => blocked('found a problem') })
  assert.equal((await blockedR.evaluate('completion', {})).ok, false)

  const unmeasuredR = createGateRegistry()
  unmeasuredR.register({ id: 'u', point: 'completion', description: 'd', gate: () => unmeasured('could not measure') })
  const um = await unmeasuredR.evaluate('completion', {})
  assert.equal(um.ok, false)
  assert.equal(um.evaluated, 1, '★ unmeasured 是"跑了但说测不了" ⇒ evaluated 必须 ≥ 1（与全跳过的 0 不同形）')

  // 空注册表照常放行（既有 ⑨ 的语义）
  for (const point of INSERTION_POINTS) {
    const empty = await createGateRegistry().evaluate(point, {})
    assert.equal(empty.ok, true)
    assert.equal(empty.skippedAll, undefined)
  }
})

test('⑯ 臂 3b ★ 「全跳过」与「unmeasured」必须不同形（都是"没测到"，但不是同一件事）', async () => {
  const skipped = await allSkippedRegistry('completion', 2).evaluate('completion', {})
  const unmeasuredR = createGateRegistry()
  unmeasuredR.register({ id: 'u', point: 'completion', description: 'd', gate: () => unmeasured('no executor was injected') })
  const unmeasuredVerdict = await unmeasuredR.evaluate('completion', {})

  /**
   * ★ 前者是"判据【根本没跑】"（关于这一步有没有被检查），
   *   后者是"判据跑了、说它【测不了】"（关于测量的结论）。
   *   两者都意味着"没测到"，但成因不同、责任不同 ⇒ 不许同形。
   */
  assert.notDeepEqual(shapeOf(skipped), shapeOf(unmeasuredVerdict))
  assert.equal(skipped.unmeasured, undefined, '★ 全跳过不是 unmeasured —— 那是关于"测量"的结论，而这里压根没测')
  assert.equal(unmeasuredVerdict.skippedAll, undefined)
  assert.equal(skipped.evaluated, 0)
  assert.equal(unmeasuredVerdict.evaluated, 1)
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑰ 观察模式（t9）：新判据先只记录、不拒绝 —— 但必须【显式选择加入】
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 观察模式防的是什么失效
 *
 * 一条写错的新判据若立刻有否决权，会把**真实任务**卡死；而"被门禁坑过"的人学到
 * 的不是"这条判据要修"，是"门禁可以忽略" —— 此后所有判据都白装。本队已经见过
 * 这个形态（棘轮断言在成功路径上报错）。
 *
 * ⇒ 新判据可以先【进来观察】：照常求值、照常记录，裁决不阻止流程。
 *
 * ★ 而它自己最危险的失效是**方向反了**：一个缺省就放宽的实现会让"配置丢了"与
 *   "判据通过了"在日志里同形。所以下面每一条臂都有一半在钉"缺省不放宽"。
 */

import { OBSERVE_GATES_ENV, observeIdsFromEnv } from '../lib/gates/registry.js'

/** 一条会开火的探针（blocked），挂在一个位置上的注册表。 */
function firingRegistry(point = 'completion') {
  const r = createGateRegistry()
  r.register({ id: 'shiny', point, description: 'a brand-new gate', gate: () => blocked('found a problem') })
  return r
}

test('⑰ 臂 1 ★ 观察中的判据开火 ⇒ 被记录、但【不阻止流程】', async () => {
  const r = firingRegistry()
  assert.equal(r.isObserving('shiny'), false, '挂上去时它必须【不在】观察中（缺省有否决权）')
  r.observe('shiny', { reason: 'first rollout' })
  assert.equal(r.isObserving('shiny'), true)

  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, true, '★ 观察中的判据不得拒绝流程 —— 这正是观察模式的定义')
  assert.deepEqual(v.blockers, [], '★ 被放过的 blocker 不许并进 blockers：并进去就等于它进了裁决')
  assert.equal(v.unmeasured, undefined)

  /**
   * ★ 但裁决必须【被记录】，且是三处不同形的记录：
   *   ran 里那条条目、计数、以及裁决原文。
   *   丢掉任何一处，观察期就变成"什么都看不见"，那时没人能从日志里决定
   *   "这条判据该不该开火"。
   */
  assert.equal(v.ran.length, 1)
  assert.equal(v.ran[0].verdict, 'blocked', '★ 它确实开火了 —— verdict 不许被改写成 ok')
  assert.equal(v.ran[0].observed, true, '★ "开火了但被放过"必须写在这条条目上')
  assert.equal(v.observedBlockers, 1, '★ 必须可计数（不是只能靠翻 ran 数组）')
  assert.deepEqual(v.observed.blockers, ['[shiny] found a problem'], '★ 裁决原文必须留着')
})

test('⑰ 臂 2 ★ 对照臂：没在观察的同一条判据开火 ⇒ 照常阻止', async () => {
  const r = firingRegistry()
  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, false, '★ 缺省 = 今天的行为：有否决权')
  assert.deepEqual(v.blockers, ['[shiny] found a problem'])
  assert.equal(v.observedBlockers, undefined, '★ 没有观察 ⇒ 不许产出任何"放过"的痕迹')
  assert.deepEqual(v.observed, { blockers: [], unmeasured: [] }, '★ observed 恒在场（空即空），但它是空的')
  assert.equal(v.ran[0].observed, undefined, '★ 未观察的条目不许带 observed 标记')
})

test('⑰ 臂 3 ★ 观察中的判据 ok ⇒ 正常通过（且"放过"的概念在这里没有对象）', async () => {
  const r = createGateRegistry()
  r.register({ id: 'quiet', point: 'delivery', description: 'd', gate: () => ({ ok: true, produced: 'value' }) })
  r.observe('quiet')

  const v = await r.evaluate('delivery', {})
  assert.equal(v.ok, true)
  assert.equal(v.ran[0].verdict, 'ok')
  /**
   * ★ 一条通过的判据在观察模式下【不产出 observed 标记】—— 它没有任何裁决被拦下。
   *   给它打标记会让"通过"与"开火被放过"在这条条目上同形，而后者才是要曝光的。
   */
  assert.equal(v.ran[0].observed, undefined)
  assert.equal(v.observedBlockers, undefined)
  assert.equal(v.ran[0].produced, true, '★ 观察模式放宽的是【否决权】，不是判据的结论：产出照常被采纳')
  assert.deepEqual(v.outputs.quiet, { produced: 'value' })
})

test('⑰ 臂 3b ★ 观察中【未测量】⇒ 同样被记录、不阻止流程，且与 blocked 不同形', async () => {
  const r = createGateRegistry()
  r.register({ id: 'blind', point: 'completion', description: 'd', gate: () => unmeasured('no executor was injected') })
  r.observe('blind')

  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, true, '★ 观察模式对 unmeasured 同样成立 —— 它也不得把流程卡死')
  assert.equal(v.unmeasured, undefined, '★ 被放过的 unmeasured 不许并进 unmeasured')
  assert.equal(v.ran[0].verdict, 'unmeasured')
  assert.equal(v.ran[0].observed, true)
  assert.deepEqual(v.observed.unmeasured, ['[blind] no executor was injected'])
  assert.deepEqual(v.observed.blockers, [], '★ "没能测量"不许被读成"发现了问题"')

  // 与 blocked 的观察记录不同形（两者都在 observed 里，但躺在不同字段）
  const blockedR = firingRegistry()
  blockedR.observe('shiny')
  const bv = await blockedR.evaluate('completion', {})
  assert.deepEqual(bv.observed.blockers, ['[shiny] found a problem'])
  assert.deepEqual(bv.observed.unmeasured, [])
  assert.notDeepEqual(v.observed, bv.observed, '★ "开火"与"测不了"在观察记录里也必须不同形')
})

test('⑰ 臂 4 ★ 关掉观察 ⇒ 同一条判据恢复阻止流程（开关是运行时调用，不改代码）', async () => {
  const r = firingRegistry()
  r.observe('shiny')
  assert.equal((await r.evaluate('completion', {})).ok, true, '观察中：放过')

  assert.equal(r.unobserve('shiny'), true, '★ 关掉观察只是一次调用 —— 不需要 code change，也就不需要重新 build')
  const after = await r.evaluate('completion', {})
  assert.equal(after.ok, false, '★ 关掉之后立刻恢复阻止流程')
  assert.deepEqual(after.blockers, ['[shiny] found a problem'])
  assert.equal(after.observedBlockers, undefined)
  assert.equal(r.unobserve('shiny'), false, '★ 二次关闭返回 false，不抛错（幂等）')
})

test('⑰ 臂 5 ★ 缺省方向：未显式开启观察的判据，行为与今天完全一致', async () => {
  /**
   * ★ 这条臂是本任务最重要的方向性断言。把"观察模式"实现成"默认放宽"是一个
   *   很容易犯、而且**在成功路径上完全看不出来**的错：所有用例都绿，直到某天
   *   有人发现门禁其实早就没在拦了。
   */
  const r = createGateRegistry()
  r.register({ id: 'strict', point: 'completion', description: 'd', gate: () => blocked('missing acceptance evidence') })
  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, false, '★ 显式观察之外的判据一律保留否决权')
  assert.deepEqual(v.blockers, ['[missing acceptance evidence]'.replace('[missing acceptance evidence]', '[strict] missing acceptance evidence')])
  assert.equal(r.observingIds().length, 0, '★ 没有人在观察 —— 名单必须是空的，不许有默认成员')
  assert.deepEqual(v.observed, { blockers: [], unmeasured: [] })
})

test('⑰ 臂 6 ★ 开关来自环境变量 ⇒ 不改代码也能开、能关（且只增不减）', async () => {
  /**
   * ★ 需求原话是"开关本身不得需要一个 code change"。一个只有代码内部能调的
   *   `observe()` 只满足一半 —— 关掉观察仍然要有人写一行代码并重新 build。
   */
  assert.equal(OBSERVE_GATES_ENV, 'AGENT_TEAMS_OBSERVE_GATES')
  assert.deepEqual(observeIdsFromEnv(undefined), [], '★ 没设 ⇒ 空名单')
  assert.deepEqual(observeIdsFromEnv(''), [], '★ 空串 ⇒ 空名单（一个空值不是"有人在观察"）')
  assert.deepEqual(observeIdsFromEnv('  , ,'), [], '★ 全是空白 ⇒ 空名单')
  assert.deepEqual(observeIdsFromEnv(' a , b ,,a '), ['a', 'b'], '★ 去空白、去重、保序')

  const fromEnv = createGateRegistry({ observeFromEnv: 'shiny,not-registered-yet' })
  fromEnv.register({ id: 'shiny', point: 'completion', description: 'd', gate: () => blocked('found a problem') })
  const v = await fromEnv.evaluate('completion', {})
  assert.equal(v.ok, true, '★ 环境变量把 shiny 放进了观察 ⇒ 开火但不拦')
  assert.equal(v.observedBlockers, 1)

  /**
   * ★ 名字里有未注册的 id 不是错误（配置可以比注册表先就位），但必须【看得出来】：
   *   `observingIds()` 里那条 `registered: false` 就是它。
   */
  const names = fromEnv.observingIds()
  assert.deepEqual(names.map((entry) => entry.id).sort(), ['not-registered-yet', 'shiny'])
  assert.equal(names.find((entry) => entry.id === 'shiny').registered, true)
  assert.equal(
    names.find((entry) => entry.id === 'not-registered-yet').registered,
    false,
    '★ "名单里有它、而它还没注册"必须与"已注册且在观察"不同形',
  )

  // 关掉：换一个不带它的名单（不加一行代码，只换一次配置）
  const withoutIt = createGateRegistry({ observeFromEnv: '' })
  withoutIt.register({ id: 'shiny', point: 'completion', description: 'd', gate: () => blocked('found a problem') })
  assert.equal((await withoutIt.evaluate('completion', {})).ok, false, '★ 名单里没有它 ⇒ 恢复阻止流程')
})

test('⑰ 臂 7 ★ 环境变量只【增】不减：它不能把显式观察中的判据移出观察', async () => {
  /**
   * ★ 若环境变量能移除显式观察的 id，线上（设了变量）与本地（没设）就会跑出
   *   两套不同的门禁，而两者的日志同形 —— 那正是最难归因的一类缺陷。
   */
  const r = createGateRegistry({ observeFromEnv: 'other' })
  r.register({ id: 'shiny', point: 'completion', description: 'd', gate: () => blocked('found a problem') })
  r.observe('shiny')
  const v = await r.evaluate('completion', {})
  assert.equal(v.ok, true, '★ 显式观察不因环境变量的内容而被撤销')
  assert.equal(v.observedBlockers, 1)
})

test('⑰ 臂 8 ★ "开火了但被放过" 与 "根本没跑" 必须不同形', async () => {
  /**
   * ★ 本任务验收的第 2 条。两者在"没有拦住流程"这一点上一样，但成因与责任
   *   完全不同：前者说"这条判据开火了，是我们选择先放过它"，后者说"这条判据
   *   压根没跑"。混起来，人就没法回答"这条新判据到底动没动过"。
   */
  const observedFiring = firingRegistry()
  observedFiring.observe('shiny')
  const fired = await observedFiring.evaluate('completion', {})

  const skippedR = createGateRegistry()
  skippedR.register({ id: 'shiny', point: 'completion', description: 'd', appliesTo: () => false, gate: () => blocked('would have fired') })
  const skipped = await skippedR.evaluate('completion', {})

  assert.equal(fired.ok, true)
  assert.equal(skipped.ok, true)
  assert.deepEqual(
    [fired.ran[0].verdict, fired.ran[0].observed, fired.observedBlockers, fired.skipped],
    ['blocked', true, 1, 0],
    '★ 开火了：verdict=blocked、observed=true、有计数、没有跳过',
  )
  assert.deepEqual(
    [skipped.ran[0].verdict, skipped.ran[0].observed, skipped.observedBlockers, skipped.evaluated],
    ['skipped', undefined, undefined, 0],
    '★ 没跑：verdict=skipped、没有 observed 标记、没有计数、evaluated=0',
  )

  // 观察中的判据【确实跑了】⇒ evaluated 必须 ≥ 1（与全跳过的 0 不同形）
  assert.equal(fired.evaluated, 1, '★ 观察不是跳过：判据真的跑了')
})

test('⑰ 臂 9 ★ 观察模式不许被实现成 appliesTo：那会让它根本不跑', async () => {
  /**
   * ★ 一个"看起来能用"的偷懒实现是把观察写成 `appliesTo: () => false`：
   *   流程确实不被拦了，但判据【也不再运行】⇒ 观察期什么都看不见，
   *   于是"观察"与"跳过"同形，而观察期的全部意义就是收集"它开火了吗"。
   *   本臂用一个"计算过才发现不该跑"的判据把这条界线钉住。
   */
  const r = createGateRegistry()
  let calls = 0
  r.register({
    id: 'shiny', point: 'completion', description: 'd',
    gate: () => { calls += 1; return blocked('found a problem') },
  })
  r.observe('shiny')
  const v = await r.evaluate('completion', {})
  assert.equal(calls, 1, '★ 观察中的判据必须【真的被调用】—— 观察不等于跳过')
  assert.equal(v.evaluated, 1)
  assert.equal(v.skipped, 0)
  assert.equal(v.skippedAll, undefined, '★ 观察不是"全跳过"，不许产出那句"这一步没被检查"')
})

test('⑰ 臂 10 ★ 控制台读得到观察状态（一条"开火了却不拦"的判据不许与正常判据同形）', () => {
  const r = createGateRegistry()
  r.register({ id: 'shiny', point: 'completion', description: 'new gate', gate: () => blocked('x') })
  r.register({ id: 'plain', point: 'completion', description: 'old gate', gate: () => ok() })
  r.observe('shiny', { reason: 'first rollout' })

  const entries = r.list().completion
  const shiny = entries.find((entry) => entry.id === 'shiny')
  const plain = entries.find((entry) => entry.id === 'plain')
  assert.equal(shiny.observing, true, '★ 清单必须说得出"这条在观察中"')
  assert.equal(shiny.observeReason, 'first rollout', '★ 且要说得出为什么（否则没人敢把它放出来）')
  assert.equal(plain.observing, false, '★ 没观察的判据如实为 false')
  assert.equal(plain.observeReason, undefined, '★ 不许给没观察的判据编一个理由')

  /**
   * ★ 注销后观察标记必须一起撤掉：否则同一个 id 重新注册会**继承**上一代的观察期，
   *   而"我观察过它"与"它现在在观察中"是两件事。
   */
  r.unregister('shiny')
  assert.equal(r.isObserving('shiny'), false, '★ 注销连带撤掉观察标记')
  r.register({ id: 'shiny', point: 'completion', description: 're-registered', gate: () => blocked('x') })
  assert.equal(r.isObserving('shiny'), false, '★ 重新注册不许继承上一代的观察期（缺省一律有否决权）')
})
