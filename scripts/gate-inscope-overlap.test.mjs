/**
 * ── `inScope` 重叠检查的豁免方向与触发点（t40 修 f-0019）─────────────────────────
 *
 * 这不是一条新判据的三臂，而是**一条既有规则的两处误伤**。臂的形状因此按
 * "每一个被修掉的误伤各有一条能打红它的臂"来排：
 *
 *   臂 1（缺陷臂）：`t22 依赖 t18` 而两者 inScope 重叠 ⇒ 校验 **t18** 必须【通过】
 *                   ★ 这是 captain 亲手撞上的那一次，也是本任务存在的理由
 *   臂 2（反向臂）：两者**无**依赖关系且 inScope 重叠 ⇒ 仍必须【拒绝】
 *                   ★ 缺它，一个"把整个检查删掉"的实现会全绿 ——
 *                     而那会把这条护栏真正要防的冲突一起放过去
 *   臂 3（间接臂）：间接依赖（t24 → t22 → t18）同样豁免
 *   臂 4（触发点臂）：`inScopeTouched === false` ⇒ 跳过；缺省/`true` ⇒ 照常检查
 *   臂 5（对照臂）：无重叠 ⇒ 放行（不误伤正常情形）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-07，captain 实测、本任务复现）：
 *
 *     图中 t22 依赖 t18，两者 inScope 都含 src/tools.ts
 *     ⇒ 校验 t18 被拒：`inScope overlaps t22 at src/tools.ts; serialize these
 *       tasks or split the paths`
 *
 * 而实际关系是【t22 依赖 t18】—— **别人依赖我**。护栏此前只豁免一个方向：
 *
 *     if (dependencies.includes(other.id) || other.dependencies.includes('pending-new')) continue
 *       ↑ "我依赖它"  ⇒ 当【别人依赖我】时这一句为假 ⇒ 拒绝
 *
 * ── ★ 方向的实质（这条 finding 最值钱的地方）──────────────────────────────────
 *
 * 一条**已声明的依赖链**恰恰**证明**两个任务的写域会被串行执行：
 * 上游不到终态，下游就不会被派发。⇒ 那种重叠是【设计的一部分】，不是冲突。
 * 把它当成冲突，等于让合法链上的两个任务**无法同时被编辑** ——
 * 而"改依赖"正是这条链最需要被改的时刻。
 *
 * ── 第二处误伤：触发点偏了 ────────────────────────────────────────────────────
 *
 * `updatePlanBatch` 对每个 `update_task` 变更做**整任务重校验** ⇒ 改 dependencies /
 * description 会把 inScope 的重叠检查再跑一遍。⇒ 一条规则在**它没被触碰**的时候
 * 开火，而错误信息还在谈论 inScope —— 读的人会去翻 inScope，问题根本不在那里。
 *
 * ── ★★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）────────────────────────
 *
 * 「某个具体任务 id / 某个具体路径现在是什么状态」**不是不变量**。
 * 本文件里的 t18 / t22 / t24 与 `src/tools.ts` 都是**夹具自己造的**，
 * 不读盘上真实的 team.json —— 一个去读真实团队的夹具会在下一次团队重建时
 * 按设计变红，而红的原因与"豁免方向"毫无关系。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/**
 * ★ 从 `../lib` 读（和每一条既有夹具一样）：测的是**真的会被插件加载**的
 *   那一份代码，而不是 `src/` 里的一份平行副本。
 */
import { validateCreateTask, inScopeOverlap } from '../lib/quality-gates.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GATE_SOURCE = join(ROOT, 'src', 'quality-gates.ts')
const BUILT_GATE = join(ROOT, 'lib', 'quality-gates.js')

/** 重叠用的那一格路径。★ 夹具自己写死，不读盘。 */
const SHARED = 'src/tools.ts'

/**
 * 一个最小的 implementation 任务。**只填本规则读的那几格** ——
 * 多填一格就多一个"因为我不填它所以红"的机会，而那种红与豁免方向无关。
 */
function candidate(spec) {
  return {
    id: spec.id,
    subject: `task ${spec.id}`,
    status: spec.status ?? 'pending',
    dependencies: spec.dependencies ?? [],
    kind: spec.kind ?? 'implementation',
    inScope: spec.inScope ?? [SHARED],
    objective: 'do the thing',
    acceptance: ['it works'],
    verify: ['pnpm typecheck'],
    createdAt: 1,
    updatedAt: 1,
    /**
     * ★★ 这一格必须**显式转发**，而且【不能】写成 `inScopeTouched: spec.inScopeTouched`：
     *
     *     写成 `inScopeTouched: undefined` 与"根本没有这个键"在 JS 里读起来一样，
     *     但在**这条判据**上不一样 —— 判据读的是 `input.inScopeTouched !== false`，
     *     两者都为真、都该照常检查。★ 所以这里真正要防的不是判据，是**夹具自己**：
     *     漏转发一个格子，会让臂 4 的输入**永远不是**它声称的那个形状，
     *     而断言会以"规则没生效"的样子失败 —— 方向完全指错。
     *
     * MEASURED（本任务第一次跑）：第一版 helper 逐字段枚举、**漏了**这一格，
     * 于是臂 4/4b/4c 全红，读起来像"触发点收窄没生效"，而实现其实是对的。
     * ⇒ 用条件展开：**有值才带键**，与判据的三态口径逐字对齐。
     */
    ...spec.inScopeTouched === undefined ? {} : { inScopeTouched: spec.inScopeTouched },
  }
}

/**
 * 走**真实调用形状**：候选任务被交成 `input`，图里**不含它自己**
 * （与 `updatePlanBatch` / amend 路径逐字同形）。
 */
function validate(input, others) {
  return validateCreateTask({ tasks: others, members: [], halted: false }, input)
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（缺陷臂）：别人依赖我 ⇒ 必须通过（captain 撞上的那一次）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1：t22 依赖 t18 而写域重叠 ⇒ 校验 t18 必须【通过】（f-0019 的实测形状）', () => {
  /**
   * ★ 这一臂就是本任务的验收。它逐字复现 captain 那一次：
   *   他要改 t18 的 dependencies，而图里的 t22 依赖 t18。
   *
   * ★ 断言里带上"错误信息里不许再出现那串话"：只断言 `ok === true` 的话，
   *   一个"通过了但顺手报了别的错"的实现（不可能，但更坏的是反过来 ——
   *   一个把拒绝消息改软、却仍然拒绝的实现）会把这条臂的含义读丢。
   */
  const verdict = validate(candidate({ id: 't18' }), [candidate({ id: 't22', dependencies: ['t18'] })])
  assert.equal(
    verdict.ok, true,
    `★ 【别人依赖我】必须是豁免方向之一 —— 实测被拒时它是：${JSON.stringify(verdict.error)}`,
  )
  assert.equal(verdict.error, undefined, '★ 通过就是通过，不许再挂着一条关于 inScope 的话')
})

test('★ 臂 1b：我依赖它 ⇒ 也必须通过（原来的那个方向不许被这次改动弄坏）', () => {
  /**
   * ★ 反向回归：护栏原来**只**豁免这一个方向。修双向的时候最自然的坏法是
   *   把条件写反（`&&` 写成 `||`、或者把两侧搞混），于是**旧方向**反而坏了。
   *   一条只测新方向的夹具看不见这件事。
   */
  const verdict = validate(candidate({ id: 't18', dependencies: ['t22'] }), [candidate({ id: 't22' })])
  assert.equal(verdict.ok, true, `★ 【我依赖它】仍然必须豁免：${JSON.stringify(verdict.error)}`)
})

test('★ 臂 1c：环状依赖（两侧互相依赖）⇒ 同样豁免（两个方向都成立）', () => {
  /**
   * ★ 两侧都依赖对方时，两个方向**都为真** —— 一条把两个方向写成
   *   "要么…要么…"的实现在这里自然通过，而一条写成
   *   "必须恰好一个方向成立"的实现会在这里红。后者是过度收紧。
   */
  const verdict = validate(candidate({ id: 't18', dependencies: ['t22'] }), [candidate({ id: 't22', dependencies: ['t18'] })])
  assert.equal(verdict.ok, true)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（反向臂）：无依赖关系 ⇒ 仍然必须拒绝
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2：两者【无】依赖关系且写域重叠 ⇒ 仍必须【拒绝】（缺它则"删掉检查"也全绿）', () => {
  /**
   * ── 这一臂是整份夹具里最重要的一条 ──────────────────────────────────────────
   *
   * 本任务做的是**放开**一条规则。而"放开"有一个很自然的过度写法：
   * 把整个重叠检查删掉（或让它无条件 `continue`）。
   * 那个实现在臂 1 上**完全绿** —— 因为它确实放行了合法链。
   *
   * ⇒ 而它会把**真正要防的冲突**一起放过去：两个没有任何次序关系的任务
   *   同时写同一个文件 —— 那会让两个成员并发改同一处，而合并没有次序。
   *   这条护栏存在的全部理由就是这个。
   *
   * ★ 断言里逐字点名被拒绝的原因（`inScope overlaps` + the other id + the path）：
   *   只断言 `ok === false` 会让"因为别的原因被拒"也算过 ——
   *   而那正是本队记账的"守卫检查了另一个同名的东西"。
   */
  const verdict = validate(candidate({ id: 't18' }), [candidate({ id: 't22' })])
  assert.equal(verdict.ok, false, '★ 无依赖关系的重叠必须【仍然】被拒 —— 否则这条护栏就没了')
  assert.match(String(verdict.error), /inScope overlaps/, '★ 拒绝的理由必须是"写域重叠"，不是别的')
  assert.match(String(verdict.error), /t22/, '★ 而且要指名是跟谁重叠')
  assert.match(String(verdict.error), /src\/tools\.ts/, '★ 以及重叠在哪一条路径上')
})

test('★ 臂 2b：部分重叠也拒绝（不是"完全相同才拦"）', () => {
  const verdict = validate(
    candidate({ id: 't18', inScope: [SHARED, 'src/state.ts'] }),
    [candidate({ id: 't22', inScope: [SHARED] })],
  )
  assert.equal(verdict.ok, false, '★ 只要有一条路径重叠就必须拦')
  assert.match(String(verdict.error), /src\/tools\.ts/)
})

test('★ 臂 2c：完全不相交的写域 ⇒ 放行（护栏只对重叠说话）', () => {
  const verdict = validate(
    candidate({ id: 't18', inScope: ['src/quality-gates.ts'] }),
    [candidate({ id: 't22', inScope: ['src/tools.ts'] })],
  )
  assert.equal(verdict.ok, true, `★ 不重叠就没有冲突：${JSON.stringify(verdict.error)}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（间接臂）：闭包，不是直接那一格
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3：间接依赖（t24 → t22 → t18）同样豁免 —— 闭包，不只是直接那一格', () => {
  /**
   * ── 为什么这一臂值得单独存在 ──────────────────────────────────────────────────
   *
   * 最省事的双向写法是 `other.dependencies.includes(candidateId)` —— 只查**直接**
   * 那一格。它在臂 1 上完全绿（t22 直接依赖 t18），而隔一层就漏：
   *
   *     t24 依赖 t22、t22 依赖 t18 ⇒ 三者串行
   *     ⇒ t24 与 t18 的重叠**同样**是设计的一部分
   *     ⇒ 但 `t24.dependencies.includes('t18')` 为假 ⇒ 会被误伤
   *
   * ★ 而那种误伤更难归因：报错只提 the other task 的 id，读的人看不到
   *   "其实隔了一层依赖"。⇒ 用闭包。
   */
  const verdict = validate(
    candidate({ id: 't18' }),
    [
      candidate({ id: 't22', dependencies: ['t18'] }),
      candidate({ id: 't24', dependencies: ['t22'] }),
    ],
  )
  assert.equal(verdict.ok, true, `★ 间接依赖同样证明串行：${JSON.stringify(verdict.error)}`)
})

test('★ 臂 3b：链上的每一环都豁免（逐个点名，不是一个汇总）', () => {
  /**
   * ── ★★ 夹具自检：这一臂**第一版是错的**，而它的错法值得记 ────────────────────────
   *
   * MEASURED（本任务第一次跑）：第一版为了"逐个点名每一环"而把该环**从图里滤掉**
   * 再校验 —— 而那会**把链切断**：
   *
   *     滤掉 t22 ⇒ 图里只剩 t24，而 t24 依赖一个不存在的 t22
   *     ⇒ t24 到 t18 的闭包断了 ⇒ 重叠不再被豁免 ⇒ 断言红
   *
   * ★ 红的原因是**夹具把图改坏了**，不是实现坏了。一条"为了测某一环而先把那一环
   *   拿掉"的夹具，测的是它自己造出来的另一张图 —— 而它红起来的样子与"机制失效"
   *   一模一样（本队记账的"守卫检查了另一个同名的东西"的夹具版本）。
   *
   * ⇒ 正确做法：**保留完整的图**，逐环各断言一次。图不变，只是每次换一个着眼点。
   */
  const chain = [
    candidate({ id: 't22', dependencies: ['t18'] }),
    candidate({ id: 't24', dependencies: ['t22'] }),
  ]
  /** ① 整张图在 ⇒ 每一环都该被豁免（链完整，闭包可达）。 */
  const full = validate(candidate({ id: 't18' }), chain)
  assert.equal(full.ok, true, `★ 完整链必须放行：${JSON.stringify(full.error)}`)

  /**
   * ② 而"链断了就【不】豁免"是另一条独立的读数 —— 它证明上面那条不是因为
   *    "凡是重叠都放行"才绿的：
   *
   *     滤掉 t22 ⇒ t24 依赖一个不存在的 id ⇒ 闭包断了
   *     ⇒ t18 与 t24 之间**没有**可证的串行关系 ⇒ 重叠必须仍然被拒
   *
   * ★ 这是**反向半边**：没有它，`full.ok === true` 可能只是"护栏又不知为何失效了"。
   */
  const brokenChain = validate(candidate({ id: 't18' }), chain.filter((task) => task.id !== 't22'))
  assert.equal(
    brokenChain.ok, false,
    '★ 链断了（t22 不在图里）⇒ 到 t24 的串行关系无从证明 ⇒ 重叠必须仍然被拒',
  )
  assert.match(String(brokenChain.error), /inScope overlaps/, '★ 拒绝的理由仍然是写域重叠')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（触发点臂）：只在 inScope 真的被校验时检查
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4：`inScopeTouched === false` ⇒ 跳过检查（改的不是 inScope）', () => {
  /**
   * ── 第二处误伤：一条规则在**它没被触碰**的时候开火 ────────────────────────────
   *
   * `updatePlanBatch` 对每个 `update_task` 变更做整任务重校验 ⇒ 改 dependencies /
   * description 会把 inScope 的重叠检查再跑一遍。
   * ★ 而错误信息**还在谈论 inScope** ⇒ 读的人会去翻 inScope，问题根本不在那里。
   *
   * 这一臂让"调用方明确说这次改的不是 inScope"时整块跳过。
   */
  const skipped = validate(candidate({ id: 't18', inScopeTouched: false }), [candidate({ id: 't22' })])
  assert.equal(skipped.ok, true, '★ 明确声明"没碰 inScope" ⇒ 这条规则不该开火')
})

test('★★ 臂 4b：`undefined`（缺省）与 `true` 都【照常检查】—— 缺省方向是"不放宽"', () => {
  /**
   * ── 三态纪律：`undefined` **不是** `false` ────────────────────────────────────
   *
   * ★ 缺省方向必须是**照常检查**，不是跳过：
   *   · 一个还没接线的调用方 ⇒ 仍然有护栏（不会静默失去）；
   *   · 反过来（缺省跳过）会让"调用方忘了传"与"确实不该检查"同形 ——
   *     而那正是本库记账最久的形态（把没测到并进通过）。
   *
   * ⇒ 三条一起断言：`undefined` 拒、`true` 拒、`false` 放行。
   *   单测其中一条都读不出"缺省是哪一边"。
   */
  assert.equal(
    validate(candidate({ id: 't18' }), [candidate({ id: 't22' })]).ok, false,
    '★ 缺省（undefined）必须照常检查 —— 缺省不放宽',
  )
  assert.equal(
    validate(candidate({ id: 't18', inScopeTouched: true }), [candidate({ id: 't22' })]).ok, false,
    '★ 明确声明"在改 inScope" ⇒ 照常检查',
  )
  assert.equal(
    validate(candidate({ id: 't18', inScopeTouched: false }), [candidate({ id: 't22' })]).ok, true,
    '★ 明确声明"没改 inScope" ⇒ 跳过（与上面两条不同形）',
  )
})

test('★ 臂 4c：触发点收窄**不是**放行依赖豁免 —— 两者独立', () => {
  /**
   * ── 两条修法必须各自独立可辨 ──────────────────────────────────────────────────
   *
   * 本次修的是**两个**独立的误伤：豁免方向、触发点。
   * 一个把两者合成一个布尔（`inScopeTouched === false || 有依赖`）的实现，
   * 会让"哪一条坏了"读不出来。
   *
   * ⇒ 四条组合各测一次：只方向成立 / 只触发点成立 / 都成立 / 都不成立。
   */
  const withDep = [candidate({ id: 't22', dependencies: ['t18'] })]
  const withoutDep = [candidate({ id: 't22' })]
  assert.equal(validate(candidate({ id: 't18' }), withDep).ok, true, '只方向成立 ⇒ 放行')
  assert.equal(validate(candidate({ id: 't18', inScopeTouched: false }), withoutDep).ok, true, '只触发点成立 ⇒ 放行')
  assert.equal(validate(candidate({ id: 't18', inScopeTouched: false }), withDep).ok, true, '都成立 ⇒ 放行')
  assert.equal(
    validate(candidate({ id: 't18', inScopeTouched: true }), withoutDep).ok, false,
    '★ 都不成立 ⇒ 仍然拒绝（这一条是"护栏还在"的读数）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（对照臂）：正常情形不被误伤
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：对照臂 —— 图里没有任何别的写任务 ⇒ 放行', () => {
  assert.equal(validate(candidate({ id: 't18' }), []).ok, true)
})

test('★ 臂 5b：对照臂 —— 别的任务不写代码（review/requirements）⇒ 不参与重叠判定', () => {
  /**
   * ★ 护栏只管 `WRITE_KINDS`（implementation / repair）：一个 review 任务
   *   "声明 inScope" 与一个实现任务的写域不是同一件事。
   *   这条对照臂钉住"参与判定的范围没被这次改动弄宽"。
   */
  const verdict = validate(
    candidate({ id: 't18' }),
    [candidate({ id: 't22', kind: 'review', inScope: [SHARED] })],
  )
  assert.equal(verdict.ok, true, '★ review 任务不在写域重叠的判定范围里')
})

test('★ 臂 5c：对照臂 —— 终态的别的任务不参与（它不会再写）', () => {
  const verdict = validate(
    candidate({ id: 't18' }),
    [candidate({ id: 't22', status: 'completed' })],
  )
  assert.equal(verdict.ok, true, '★ 已经 completed 的任务不会再写那些路径')
})

// ─────────────────────────────────────────────────────────────────────────────
// 既有导出 `inScopeOverlap` 的形状（这条规则的原料）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 原料：`inScopeOverlap` 只报真的重叠的那些路径，且不重不漏', () => {
  assert.deepEqual(inScopeOverlap(['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/c.ts']), ['src/b.ts'])
  assert.deepEqual(inScopeOverlap(['src/a.ts'], ['src/b.ts']), [])
  assert.deepEqual(inScopeOverlap(['src/a.ts'], ['src/a.ts']), ['src/a.ts'], '★ 完全相同的一条路径当然算重叠')
  /**
   * ── ★★ 这条断言**故意钉住"没有目录前缀语义"这件事**──────────────────────────
   *
   * MEASURED（本任务第一次跑）：我一开始想当然地断言
   * `inScopeOverlap(['src/dir'], ['src/dir/file.ts']) === ['src/dir']`
   * （"目录前缀算重叠"），而实测是 `[]` —— 这一格做的是**精确路径匹配**。
   *
   * ★ 而这件事值得写在夹具里，因为它是一个**真实的边界**：
   *   两个任务各自声明 `src/dir/` 与 `src/dir/file.ts` 时，这条护栏**看不见**
   *   它们重叠。⇒ 那是另一个 finding（不在本任务的射程里），
   *   但**下一个人读这条规则时必须知道**，否则他会以为护栏比他以为的宽。
   *
   * ★ 断言写成"实测是什么就说什么"，不是"我以为应该是什么"：
   *   一条按我以为的语义写的断言，一旦实现真的改了，会以"护栏坏了"的样子红 ——
   *   而它红的原因是**夹具的假设错了**。这正是本队记账过的那种棘轮。
   */
  assert.deepEqual(
    inScopeOverlap(['src/dir'], ['src/dir/file.ts']), [],
    '★ 实测：这一格是【精确路径】匹配，没有目录前缀语义（窄于直觉 —— 已知边界，不是回归）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 定向突变（真的执行）：把双向豁免改回单向 ⇒ 对应臂必须红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么这次突变要**真的跑** ────────────────────────────────────────────────
 *
 * 契约 §8.5 规则二：「没被突变抓住的修复，等于没修」。而它的后半句更狠：
 * **一条恒真的断言会在"突变全红"的表象下活下来**。所以本文件不是"声称"这次
 * 突变能打红臂 1，而是把它跑出来。
 *
 * ★ 顺序是【串行】的：`pnpm build` 会先 `rm -rf lib/`，并行跑两个 build 会让
 *   另一个进程读到半个 lib/。
 */
function withBuiltGate(mutatedSource, body) {
  const original = readFileSync(GATE_SOURCE, 'utf8')
  const restore = () => {
    writeFileSync(GATE_SOURCE, original)
    const rebuilt = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(rebuilt.status, 0, `★ 还原之后必须能重新 build 成功:\n${rebuilt.stdout}\n${rebuilt.stderr}`)
  }
  try {
    writeFileSync(GATE_SOURCE, mutatedSource)
    const built = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(built.status, 0, `★ 突变体必须编译得过（否则这次突变测的是 tsc，不是行为）:\n${built.stdout}\n${built.stderr}`)
    const result = body()
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      return result.then(
        (value) => { restore(); return value },
        (error) => { restore(); throw error },
      )
    }
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

/**
 * ★★ 突变体必须用【重新 import】拿到，不许用文件顶部那个绑定 ──────────────────
 *
 * MEASURED（t6 的突变臂，夹具自己抓出来的）：顶部 `import` 绑定在**文件加载时**
 * 就解析完了。突变体写进 src/、build 也真的重建了 lib/，而那一次调用仍指向
 * **加载时那一份**（未被突变的）模块 —— 于是断言红，而报告会读作
 * "突变没打红 ⇒ 那条臂可能是恒真的"。**方向恰好相反。**
 */
async function freshGate(tag) {
  return import(`${BUILT_GATE}?${tag}`)
}

/** 突变的针脚（★ 逐字，且下面有专门一条断言它在源码里真的存在）。 */
const NEEDLE_BIDIRECTIONAL = `      if (iDependOnOther || otherDependsOnMe) continue`
/**
 * ★ 触发点那一次的针脚：**整条 if 条件**（见突变 B 里那段实测记录 ——
 *   只替换半句会让 `if (A && B && 注释)` 少一个操作数，**编译不过**）。
 * ★ 提升到模块作用域，好让突变 B 与下面的"二次对照"自检**问同一个字符串**：
 *   两处各写一份字面量的话，它们会各自漂移，而自检仍然绿（半句确实在整条里）。
 */
const NEEDLE_TRIGGER_FOR_SELFCHECK = `  if (WRITE_KINDS.includes(kind) && nonemptyStringList(input.inScope) && input.inScopeTouched !== false) {`

test('★ 定向突变：把双向豁免改回【单向】⇒ 臂 1 必须红', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**（`rm -rf lib/` 的窗口会让并行读到假红），所以这一条
   *   由环境变量显式开启，默认跳过，由本任务的验证读数那次单独运行。
   */
  if (process.env.AGENT_TEAMS_INSCOPE_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_INSCOPE_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  const others = [candidate({ id: 't22', dependencies: ['t18'] })]
  const baselineGate = await freshGate('mutation=baseline')
  const baseline = {
    otherDependsOnMe: baselineGate.validateCreateTask({ tasks: others, members: [], halted: false }, candidate({ id: 't18' })).ok,
    iDependOnOther: baselineGate.validateCreateTask({ tasks: [candidate({ id: 't22' })], members: [], halted: false }, candidate({ id: 't18', dependencies: ['t22'] })).ok,
    unrelated: baselineGate.validateCreateTask({ tasks: [candidate({ id: 't22' })], members: [], halted: false }, candidate({ id: 't18' })).ok,
  }
  assert.deepEqual(
    baseline,
    { otherDependsOnMe: true, iDependOnOther: true, unrelated: false },
    '★ 突变之前：两个方向都豁免、无依赖关系的仍然拒绝 —— 否则下面测的不是突变',
  )

  /**
   * ── 突变体：回到 f-0019 那一行（只豁免【我依赖它】）───────────────────────────
   *
   * ★ `replaceAll` 之后**必须断言真的替换到了**：一次没匹配上的 `replace` 会让
   *   突变体与基线逐字相同，于是"变了没有"这件事变成恒假 ——
   *   而报告会说"突变没打红"（本队记账的恒红变体）。
   */
  const original = readFileSync(GATE_SOURCE, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_BIDIRECTIONAL,
    `      if (iDependOnOther) continue // MUTANT: f-0019 restored (one direction only)`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行 —— 没匹配上的替换会让它恒不生效')

  await withBuiltGate(mutated, async () => {
    const mutant = await freshGate('mutation=one-direction')
    const after = {
      otherDependsOnMe: mutant.validateCreateTask({ tasks: others, members: [], halted: false }, candidate({ id: 't18' })).ok,
      iDependOnOther: mutant.validateCreateTask({ tasks: [candidate({ id: 't22' })], members: [], halted: false }, candidate({ id: 't18', dependencies: ['t22'] })).ok,
      unrelated: mutant.validateCreateTask({ tasks: [candidate({ id: 't22' })], members: [], halted: false }, candidate({ id: 't18' })).ok,
    }
    /** ★ 这一条断言就是**臂 1 的红**：captain 撞上的那个方向重新被拒。 */
    assert.equal(after.otherDependsOnMe, false, '★ 突变体必须重新拒绝【别人依赖我】—— 臂 1 就是靠这一条变红的')
    assert.equal(after.iDependOnOther, true, '★ 而旧方向仍然豁免（本次突变只拆掉新方向）')
    assert.equal(after.unrelated, false, '★ 无依赖关系的仍然拒绝（护栏还在）')
    assert.notDeepEqual(after, baseline, '★ 突变体与基线的读数必须真的不同 —— 相同说明这次突变什么都没测到')
  })

  /** ★ 还原之后逐字相等：一次中途失败会把一份被突变的实现留在盘上。 */
  const restored = await freshGate('mutation=restored')
  assert.deepEqual(
    {
      otherDependsOnMe: restored.validateCreateTask({ tasks: others, members: [], halted: false }, candidate({ id: 't18' })).ok,
      iDependOnOther: restored.validateCreateTask({ tasks: [candidate({ id: 't22' })], members: [], halted: false }, candidate({ id: 't18', dependencies: ['t22'] })).ok,
      unrelated: restored.validateCreateTask({ tasks: [candidate({ id: 't22' })], members: [], halted: false }, candidate({ id: 't18' })).ok,
    },
    baseline,
    '★ 还原之后必须与突变前逐字一致 —— 否则盘上留着一份没人认得的实现',
  )
})

test('★ 定向突变 B：把触发点收窄去掉 ⇒ 臂 4 必须红', async (t) => {
  /**
   * ★ 第二处误伤也要有一条自己的突变：本任务修了**两个**独立的误伤，
   *   而"两条修法各自可打红"是它们**独立**的唯一证据。
   */
  if (process.env.AGENT_TEAMS_INSCOPE_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_INSCOPE_MUTATION=1 时运行')
    return
  }

  const others = [candidate({ id: 't22' })]
  const original = readFileSync(GATE_SOURCE, 'utf8')
  /**
   * ★ 针脚选的是**整条 if 条件**，不是那半句 `&& input.inScopeTouched !== false`。
   *
   * MEASURED（本任务第一次跑）：第一版只把那半句换成注释，于是 `if (A && B && 注释)`
   * 少了一个操作数 —— **编译不过**（TS1005 / TS1128），而夹具如实报出
   * "突变体必须编译得过（否则这次突变测的是 tsc，不是行为）"。
   * ⇒ 那一次的读数对，但它测的是语法，不是行为。修法：整句一起替换。
   */
  assert.equal(original.includes(NEEDLE_TRIGGER_FOR_SELFCHECK), true, '★ 触发点的针脚必须逐字存在')
  const mutated = original.replaceAll(
    NEEDLE_TRIGGER_FOR_SELFCHECK,
    `  if (WRITE_KINDS.includes(kind) && nonemptyStringList(input.inScope)) { // MUTANT: the trigger narrowing is gone`,
  )
  assert.notEqual(mutated, original, '★ 替换必须真的发生')

  await withBuiltGate(mutated, async () => {
    const mutant = await freshGate('mutation=trigger-restored')
    assert.equal(
      mutant.validateCreateTask({ tasks: others, members: [], halted: false }, candidate({ id: 't18', inScopeTouched: false })).ok,
      false,
      '★ 突变体必须让"明确没改 inScope"也重新被拦 —— 臂 4 就是靠这一条变红的',
    )
  })
})

test('★ 二次对照：突变针脚在源码里【真的存在】', () => {
  /**
   * ★ 这条不测行为，测的是两次突变**赖以成立的前提**。针脚错一个字符，
   *   突变就会静默变成"什么都没改"，而报告会读成"突变没打红 ⇒ 臂是恒真的"
   *   —— 一个**方向相反**的结论。
   *
   * ★ 而第二条针脚**必须与突变 B 用的是同一个常量**：第一版这里另写了一个
   *   半句字面量（`' && input.inScopeTouched !== false'`），而突变 B 用的是整条
   *   if 条件 ⇒ 两处会各自漂移，而这条自检**仍然绿**（半句确实在整条里）。
   *   ⇒ 自检与突变必须问**同一个**问题，否则自检保护的是另一个字符串。
   */
  const source = readFileSync(GATE_SOURCE, 'utf8')
  assert.equal(source.includes(NEEDLE_BIDIRECTIONAL), true, '★ 双向豁免的针脚必须逐字存在')
  assert.equal(source.includes(NEEDLE_TRIGGER_FOR_SELFCHECK), true, '★ 触发点的针脚必须逐字存在')
})

test('★★ 夹具自检：`freshGate` 读到的确实是【当前磁盘上】的 lib', async () => {
  const a = await freshGate('selfcheck=a')
  const b = await freshGate('selfcheck=b')
  assert.notEqual(a, b, '★ 不同的 query 必须拿到不同的模块实例 —— 否则突变臂会静默地测旧代码')
  assert.equal(typeof a.validateCreateTask, 'function')
  assert.equal(typeof b.inScopeOverlap, 'function')
  assert.equal(typeof validateCreateTask, 'function')
})
