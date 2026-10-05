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

test('⑥ 注册时校验形状（id / point / gate / description）', () => {
  const r = createGateRegistry()
  assert.throws(() => r.register({ point: 'contract', description: 'd', gate: () => ok() }), /non-empty id/)
  assert.throws(() => r.register({ id: 'a', point: 'nowhere', description: 'd', gate: () => ok() }), /unknown insertion point/)
  assert.throws(() => r.register({ id: 'a', point: 'contract', description: 'd' }), /no gate function/)
  assert.throws(
    () => r.register({ id: 'a', point: 'contract', gate: () => ok() }),
    /requires a description/,
    '★ 描述是控制台渲染的东西；没有它就看不见这条判据装了什么',
  )
  assert.equal(INSERTION_POINTS.length, 5)
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
