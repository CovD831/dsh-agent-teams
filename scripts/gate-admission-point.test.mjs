/**
 * ── 「成团之前」这个【位置】的三臂夹具（t5）─────────────────────────────────────
 *
 * 被测的不是一条判据的语义（那在 `<id>.test.mjs` 里），也不是装配点的校验
 * （那在 `gate-index-assembly.test.mjs` 里），而是**一个新位置本身**：
 *
 *     ① 它真的被编排层认识吗（能被 `evaluate` 到，不是一个只在数组里躺着的字符串）；
 *     ② 一条判据都没有时它会不会误伤（空位置必须放行）；
 *     ③ 它与既有的 `contract` 位置**互不影响**（两类缺陷不许同形）。
 *
 * ── ★ 它防的是什么失效（本任务存在的理由）──────────────────────────────────────
 *
 * 本轮要做的三件事（检查点触发 / 吸收痕迹 / 成团闸门）**全部发生在成团之前**，
 * 而注册表原有的五个位置全部在成团【之后】。零覆盖的那一段里，最自然的偷懒是
 * 把这些判据塞进 `contract` —— 那是错的：
 *
 *     `contract`  判的是：这个契约合不合法（inScope 声明 / verify 可判性）
 *     `admission` 判的是：这份需求 / 计划够不够格进场（有产物 / 审过了 / 无待确认问题）
 *
 * ⇒ 合成一个位置，会让"契约写错了"与"根本不该进场"在日志里同形，而两者的补救
 *   动作完全不同（改契约 vs 回去接着聊）。本文件第 3 节把这条**当作可执行断言**：
 *   两个位置各有各的判据、各开各的火、谁也管不着谁。
 *
 * ── ★★ 本文件**刻意不写**的一句话（本队已因这类棘轮返工多次）──────────────────
 *
 * `admission` 现在一条判据都没有 —— 但那**不是不变量**，它是"t5 只加位置"这个
 * 当前状态的快照。t6/t7/t8 会往里挂判据（检查点 / 吸收 / 成团闸门），
 * 而一条把「它现在为空」写成断言的夹具，会在队友接上第一条判据的那一刻按设计变红
 * —— 那时红的原因与"位置没接好"毫无关系，于是下一个人只能来删断言（棘轮）。
 *
 * ⇒ 本文件断言的一律是**机制的形状**：
 *     · 位置存在、能被求值（接了就该被跑到）；
 *     · 空注册表在**任何**位置上都放行（用**新建的空实例**表达，与哪个位置当前
 *       接了什么都不相干）；
 *     · 两个位置互不影响（各挂各的探针，各读各的裁决）。
 *
 * ── 三臂 ─────────────────────────────────────────────────────────────────────
 *
 *   臂 1（对照臂）：`admission` 上挂一条 ok 的判据 ⇒ 它**真的被跑到**（`ran` 里
 *                   有它、`evaluated: 1`）。缺了它，下面两臂在"位置压根调不到"时
 *                   照样是绿的。
 *   臂 2（反向臂）：一条判据都不挂 ⇒ 放行，且与"挂了但全跳过"**不同形**
 *                   （`registered` / `skippedAll` 分得开）。
 *   臂 3（隔离臂）：`admission` 与 `contract` 各挂一条 blocked 探针 ⇒ 每个位置只
 *                   被自己那条影响；一次 `contract` 求值不碰 `admission`，反之亦然。
 *
 * ── ★ 定向突变（打红它的是哪一次改动）──────────────────────────────────────────
 *
 *   ① 把 `'admission'` 从 `src/gates/registry.ts` 的 `INSERTION_POINTS` 里拿掉 ⇒
 *      `register({point: 'admission'})` 当场抛 `unknown insertion point` ⇒ 三条臂
 *      全部红（声明即证据：位置是**注册表**认识的，不是钳进夹具里的一个字符串）。
 *   ② 把 `evaluate('admission', …)` 的**分派**改成忽略这个位置（例如按旧的五个
 *      位置白名单过滤）⇒ 臂 1 红（探针没被跑到），而臂 2 仍然绿 —— 这正是
 *      "空位置放行"与"位置可达"必须分成两条臂的理由：合成一条的话，
 *      "压根调不到"会伪装成"空位置照常放行"。
 *   ③ 把两个位置的求值互相串起来（例如 `evaluate('contract')` 顺带跑 admission）
 *      ⇒ 臂 3 红。
 *
 * ★ 与 `gate-position-wiring.test.mjs` 的分工：那一份测的是**真实调用点**（走工具
 *   入口，证明编排层真的会在这个位置求值）；本文件测的是**位置自身**的形状。
 *   两者都必须存在 —— 一个没有调用点的位置，在注册表这一层照样完全正常。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registry, buildRegistry } from '../lib/gates/index.js'
import { createGateRegistry, INSERTION_POINTS, ok, blocked } from '../lib/gates/registry.js'

/** 位置的名字本身就是本任务的一条验收：判的是**准入**，不是契约合法性。 */
const POINT = 'admission'

/**
 * 一个装了指定判据的**新建**注册表。
 *
 * ★ 不碰进程级单例：单例是**别的用例正在用**的那一份清单（`gate-position-wiring`
 *   会往它上面挂探针）。往它上面挂一条"admission 探针"会让同进程的普查夹具
 *   （「11 条判据」那一类）凭空多一条，而它红起来的样子与"这里缺陷"毫无关系。
 */
function withGates(entries) {
  const r = createGateRegistry()
  for (const entry of entries) r.register(entry)
  return r
}

/** 一条探针判据（每条只对**自己那个位置**的求值说话）。 */
function probe(id, point, verdict) {
  return { id, point, description: `probe for ${point}`, gate: () => verdict }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（对照臂）：这个位置真的能被 evaluate 到
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：admission 能被 evaluate 到 —— 挂一条判据，它就真的跑', async () => {
  /**
   * ★ 缺了这一臂，下面两臂在"位置压根调不到"时会全绿：一个 `evaluate` 认不出
   *   `admission` 的实现，同样不会报错、同样不会误伤空位置。
   */
  assert.ok(
    INSERTION_POINTS.includes(POINT),
    `★ 注册表必须在 INSERTION_POINTS 里认识 "${POINT}" —— 定向突变：把它从那个数组里拿掉，本条与下面每一条都红`,
  )

  const r = withGates([
    probe('admission.probe.ran', POINT, ok()),
    /** ★ 同一次求值里还有一条会开火的：把"跑到了"与"跑通了"分开看。 */
    probe('admission.probe.fired', POINT, blocked('this requirement has not been reviewed yet')),
  ])
  const evaluation = await r.evaluate(POINT, {})

  const entry = evaluation.ran.find((item) => item.id === 'admission.probe.ran')
  assert.ok(
    entry !== undefined,
    `★ "${POINT}" 上注册的判据没有出现在 run["${POINT}"] 的 ran 里 —— 它被注册到了一个不会跑的位置，`
    + `而"位置不存在"与"位置存在但一条都没跑"在返回值里必须不同形。实际 ran：${JSON.stringify(evaluation.ran)}`,
  )
  assert.equal(entry.verdict, 'ok')
  assert.equal(evaluation.registered, 2, '★ 这个位置上挂了两条，就得如实数到两条')
  assert.equal(evaluation.evaluated, 2, '★ 两条都真的跑了（不是 skipped）')
  assert.equal(evaluation.ok, false, '★ 其中一条开火了 ⇒ 这个位置的裁决是被拒的')
  assert.deepEqual(
    evaluation.blockers,
    ['[admission.probe.fired] this requirement has not been reviewed yet'],
    '★ 判据的原话必须带着它自己的 id 出现在 blocker 里 —— 否则读日志的人不知道是谁说的话',
  )

  /**
   * ★ 位置还会**穿过装配层**：`buildRegistry()` 交出的单例必须也认识它
   *   （`list()` 的键是从 `INSERTION_POINTS` 派生的，所以它必须出现在键里）。
   *   一个只在 `registry.ts` 里加、而装配层读不到的读法，会让控制台少一整行。
   */
  const built = buildRegistry()
  assert.ok(
    Object.keys(built.list()).includes(POINT),
    `★ 装配点交出的清单里必须有 "${POINT}" 这一格（空位置也是）—— 否则控制台看不出这个位置还没接判据`,
  )
  assert.deepEqual(
    built.list()[POINT],
    [],
    '★ 本任务只加位置、不加判据：真实清单里 admission 位置这一轮不该有任何判据'
    + '（★ 这一条是【当下快照】，t6/t7/t8 接上第一条判据时应当删掉它，而不是让它在队友那里红）',
  )
  void registry
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（反向臂）：空位置不报错 —— 而且它不许与"挂了但全跳过"同形
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 反向臂：admission 一条判据都没有 ⇒ 放行，且与「有判据却全跳过」不同形', async () => {
  /**
   * ★ 空位置的语义要用**一个真的新建的空实例**表达，而不是 `registry.count(POINT) === 0`
   *   —— 后者会把"这个位置此刻恰好为空"写成不变量（见文件头那段）。
   *   空实例与"哪个位置当前接了什么"完全无关，所以它永远测的是同一件事。
   */
  const empty = createGateRegistry()
  const verdict = await empty.evaluate(POINT, {})
  assert.equal(verdict.ok, true, `★ 空位置必须放行 —— 把"这里还没接判据"判成拒绝是误伤，会卡死流程`)
  assert.deepEqual(verdict.ran, [], '★ 空位置：一条都没跑（不是"跑了一条什么都对的判据"）')
  assert.equal(verdict.registered, 0)
  assert.equal(verdict.evaluated, 0)
  assert.equal(verdict.skipped, 0)
  assert.equal(
    verdict.skippedAll, undefined,
    '★ 空位置【不得】产出"这一步没被检查"的说明 —— 那是"有判据却全跳过"的形态，两者混起来，'
    + '一次静默全跳过会伪装成"这个位置本来就没判据"',
  )

  /** 对照：同一个位置、**有**判据但全被跳过 —— 两者必须不同形。 */
  const allSkipped = withGates([
    { ...probe('admission.probe.skipped', POINT, blocked('would have fired')), appliesTo: () => false },
  ])
  const skipped = await allSkipped.evaluate(POINT, {})
  /**
   * ── ★★★ t69：这一条断言的是【t58 之前】的口径，而 t58 有意改掉了它 ─────────────
   *
   * 原文（本行此前）：`assert.equal(skipped.ok, true, '★ 全跳过同样不翻成 ok:false…')`
   *
   * MEASURED：t58 把「有判据却一条没跑」从 `ok:true` 改成 **`ok:false`**，
   * 理由写在 `registry.ts` 那一支的注释里（逐字）：
   *
   *     ok:false · blockers:[] · unmeasured:undefined · skippedAll:在场  ← 这一步没被检查
   *     ok:false · blockers:[…]                          · skippedAll:缺席  ← 判据说有问题
   *     ok:false · unmeasured:在场                        · skippedAll:缺席  ← 判据说测不了
   *
   * ⇒ ★ 也就是："**这一步没被检查**"不许与"检查了、通过了"同形 ——
   *   而那正是本队那条最贵的纪律（不把没测到并进通过）。
   *
   * ★★ 所以本行是**夹具过期**（口径被有意改了，而臂没跟上），不是真实缺陷：
   *   它断言的是旧决定，而旧决定被推翻时留下了它。⇒ 修法是**改夹具**，
   *   **不是**把 `registry.ts` 改回去（那是 out-of-scope，且会把一条正确的口径弄坏）。
   *   ★ 而"哪一个是对的"有据可查：`registry.ts` 那一支带着完整的论证与三态表，
   *     而这一行只有一句"那是正常情形"—— 前者是决定，后者是被推翻的默认。
   *
   * ★ 而**空位置**那一半（`verdict.ok === true`）**一个字没动**（见上面第 159 行）：
   *   空位置仍是放行 —— 两者仍然不同形，而**差别现在同时体现在 `ok` 与 `skippedAll` 上**。
   */
  assert.equal(skipped.ok, false, '★ t58 之后：全跳过 ⇒ ok:false（"没被检查"不许读成"通过"）')
  assert.equal(skipped.unmeasured, undefined, '★ 而它不是"没能测量" —— 第三种形态，两者不许同形')
  assert.deepEqual(skipped.blockers, [], '★ 也不是"判据说有问题"')
  assert.equal(skipped.registered, 1)
  assert.equal(skipped.evaluated, 0)
  assert.equal(typeof skipped.skippedAll, 'string', '★ 有判据却一条没跑 ⇒ 必须留下那句话')
  assert.notDeepEqual(
    { registered: verdict.registered, skippedAll: verdict.skippedAll },
    { registered: skipped.registered, skippedAll: skipped.skippedAll },
    '★ "这里还没有判据"与"有判据却一条没跑"必须不同形 —— 合成一条断言，位置一旦接上判据就会静默地改变读法',
  )

  /**
   * ★ 同一件事在**每一个**位置上都成立（不是给 admission 开的特例）：
   *   定向突变 = 在 `evaluate` 里给新位置开一条"永远返回失败"的分支 ⇒ 本条红。
   */
  for (const point of INSERTION_POINTS) {
    const perPoint = await createGateRegistry().evaluate(point, {})
    assert.equal(perPoint.ok, true, `★ 空注册表在 "${point}" 必须放行`)
    assert.deepEqual(perPoint.ran, [])
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（隔离臂）：admission 与 contract 互不影响
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 隔离臂：admission 与 contract 各开各的火 —— 两个位置不许互相影响', async () => {
  /**
   * ── 这一臂测的是本任务验收里的那一句：「两类缺陷不许同形」────────────────────
   *
   * `contract` 判契约合不合法，`admission` 判够不够格进场。判据挂在位置上
   * （契约 §1），所以"两个位置互不影响"是**位置机制**的性质，不是某条判据的语义。
   * 把这条性质写成可执行断言，是因为它最容易被一次"顺手复用"改坏 ——
   * 例如让 `evaluate('contract', …)` 连带跑一遍前缀位置。
   */
  const r = withGates([
    probe('admission.gate', POINT, blocked('the plan has an unreviewed revision')),
    probe('contract.gate', 'contract', blocked('inScope names a path the task may not touch')),
  ])

  const atAdmission = await r.evaluate(POINT, {})
  assert.deepEqual(
    atAdmission.blockers,
    ['[admission.gate] the plan has an unreviewed revision'],
    '★ admission 的求值只许听见 admission 的判据 —— contract 的话跑到这里，就等于"契约不合法"被读成了"不准进场"',
  )
  assert.deepEqual(
    atAdmission.ran.map((item) => item.id),
    ['admission.gate'],
    '★ 别的位置的判据不许出现在这次 ran 里',
  )

  const atContract = await r.evaluate('contract', {})
  assert.deepEqual(
    atContract.blockers,
    ['[contract.gate] inScope names a path the task may not touch'],
    '★ 反向半边：contract 的求值也只许听见它自己的判据 —— 缺了这一半，"两个位置互不影响"是恒真的',
  )
  assert.deepEqual(atContract.ran.map((item) => item.id), ['contract.gate'])

  /**
   * ★ 两半都要在：一条只断言"admission 没听见 contract"的臂，在一个
   *   **所有位置共用一个判据池**的实现上照样绿（那时两边都会听见对方，只要对方
   *   恰好没开火就看不出来）—— 所以这里让两条探针**都开火**，且原文不同。
   */
  assert.notDeepEqual(atAdmission.blockers, atContract.blockers)

  /**
   * ★ 而且这个隔离不是"因为 contract 位置恰好为空"：先证明 contract 真的有判据
   *   （`registered === 1`），再证明它没跑到 admission 那边。
   */
  assert.equal(atContract.registered, 1)
  assert.equal(atAdmission.registered, 1)

  /**
   * ★ 第三条半边（**换了谁空谁满**仍成立）：把 contract 那一条摘掉之后，
   *   admission 的读数一个字都不许变 —— 否则上面那两半可能只是"两个位置都空"。
   */
  assert.equal(r.unregister('contract.gate'), true)
  const afterRemoval = await r.evaluate(POINT, {})
  assert.deepEqual(
    afterRemoval.blockers, atAdmission.blockers,
    '★ 摘掉 contract 的判据不许改 admission 的裁决 —— 两个位置的判据集合是各自独立的',
  )
  assert.deepEqual((await r.evaluate('contract', {})).blockers, [], '★ 而 contract 那边确实回到了空位置')
})
