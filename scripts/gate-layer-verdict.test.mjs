/**
 * ── 判据：层次之间【不得吞掉结论】—— 位置级必须是判据层的函数（t61 / S2）──────────
 *
 * 被测的**不是**某一条判据的语义，而是【两层之间的接缝】：
 *
 *     判据层（每条 gate 各自的三态）  →  位置级（evaluate(point) 的合并裁决）
 *
 * ── ★★★ 它防的是什么失效（MEASURED，t58 昨天实测）──────────────────────────────
 *
 *     判据层报 `unmeasured`（"我没能测量"），而**位置级把那个结论吞掉了**：
 *     `appliesTo` 返回 false ⇒ 那条判据不进 `gate()` ⇒ 位置级看到的是
 *     "几条判据都 skipped" ⇒ 它报 `ok`。
 *
 *     ⇒ ★ 后果：**5 个 kind 的完工位置永远报 ok**，而那 5 类占真实任务的 29%（15/51）。
 *     ⇒ ★ 形状：**"没检查"与"检查了而通过"在位置级读数里同形。**
 *
 * ★ 而它是本队那条纪律的又一个长相：
 *   **一个机制在它没想到的场景里，给出一个看起来正常的答案。**
 *   而"正常"这个词在这里是字面的 —— 位置级报的就是 `ok: true`。
 *
 * ── ★★ 本判据断言的是【函数关系】，而不是某些具体值 ─────────────────────────────
 *
 * 契约原话：「给出同一组判据裁决，位置级必须给出同一个结论（不许用别的信号覆盖它）」。
 *
 * ⇒ 所以本文件做两件事：
 *
 *   ① **穷举一组判据层输入**，对每一种都断言"位置级说了什么"——
 *      而判法不是"它等于某个我挑的值"，而是**它必须等于【由判据层输入推出的那个值】**。
 *      ★ 换句话说：本文件里有一份 `expected()`，它**只看判据层的裁决**；
 *        而断言是 `position === expected(gateVerdicts)`。
 *      ⇒ 于是"位置级用别的信号覆盖了结论"会在这里红 —— 因为那个覆盖会让它
 *        偏离 `expected()`。
 *
 *   ② **对同一种输入跑两次**，断言两次结果**逐字段相同**（函数性：同输入同输出）。
 *      ★ 缺了它，一个"内部有随机/顺序依赖"的实现可能每次都恰好落在 expected 上
 *        —— 而那测的是运气。
 *
 * ── ★★★ 三态与那条例外（本文件最容易做错的地方）────────────────────────────────
 *
 *   ┌ 空位置（`registered === 0`）        `ok: true`  · `skippedAll` 缺席   ← ★ 正常
 *   ├ 全跳过（`registered > 0`, `eval===0`）`ok: FALSE` · `skippedAll` 在场   ← t58 修的那个
 *   └ 判据报 unmeasured（`eval >= 1`）     `ok: false` · `unmeasured` 在场   ← 判据层的结论
 *
 * ★ `registry.ts:692` 写明了空位置为什么必须是 `ok`：
 *   「空位置是正常情形，不是异常 —— 在那里产出这段话，会让每个还没接判据的位置
 *     都读起来像出了问题，而那正是『把正常读成异常』，
 *     与『把异常读成正常』一样有害。」
 *
 * ⇒ ★ 所以本判据**不能**写成"位置级必须等于判据层的最坏态"——那句话在空位置上
 *   **不成立**。按用户 2026-10-08 的标准（"特定条件下起效的也能加，
 *   只是需要把那些特定条件顺便加上去"），那条**例外被写进判据本身**，
 *   见下面的 `expected()` 与 `EXCEPTION` 一节。
 *
 * ── 定向突变（两处，各自应当打红不同的臂）──────────────────────────────────────
 *
 *   ① 把位置级改成**无条件 ok**（`evaluate` 里一律 `return { ok: true, ... }`）
 *      ⇒ 臂 1（吞掉）红 —— 而臂 2（反向：空位置仍 ok）**照旧绿**
 *      ★ 这正是"全 ok"与"正确的全 ok"必须分成两条臂的理由。
 *   ② 把**空位置**也改成非 ok（例如 `registered === 0` ⇒ `ok: false`）
 *      ⇒ 臂 2（反向臂）红 —— 而臂 1 照旧绿
 *   ⇒ ★ 两条臂合起来才排除掉"两个常量实现"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createGateRegistry, ok, blocked, unmeasured } from '../lib/gates/registry.js'

/** 本文件用的位置：只在**新建的空实例**上跑，不碰进程级单例（它被别的夹具用着）。 */
const POINT = 'completion'

/** 一条探针判据：只对**自己那条**裁决说话。 */
function probe(id, verdict, appliesTo) {
  return {
    id,
    point: POINT,
    description: `layer probe: ${id}`,
    gate: () => verdict,
    ...appliesTo === undefined ? {} : { appliesTo },
  }
}

/** 一个装了指定判据的**新建**注册表（不碰单例）。 */
function withGates(entries) {
  const registry = createGateRegistry()
  for (const entry of entries) registry.register(entry)
  return registry
}

/**
 * ── ★★★ 判据层的【裁决向量】 → 位置级【应当给出的结论】──────────────────────────
 *
 * ★ 这个函数**只看判据层的裁决**，不看任何别的信号 —— 它就是"函数关系"的右侧。
 *   断言写成 `position === expected(...)`，于是"位置级用别的信号覆盖了结论"
 *   （t58 那个缺陷）会在这里红。
 *
 * ★ 三类输入（与 registry.ts 的三态逐条对齐）：
 *
 *   `registered === 0`      —— 空位置 ⇒ ★ **例外**：仍然 `ok`（正常情形）
 *   `evaluated === 0`（而 registered > 0）
 *                           —— 全跳过 ⇒ `ok: false` + `skippedAll` 在场
 *   其余                    —— 由**判据层的合并规则**决定：
 *                              任一 unmeasured ⇒ unmeasured
 *                              否则任一 blocked ⇒ blocked
 *                              否则            ⇒ ok
 */
function expected({ registered, verdicts }) {
  /** ★ 例外：空位置是正常情形 —— 见文件头 `EXCEPTION` 一节。 */
  if (registered === 0) return { ok: true, kind: 'empty' }
  if (verdicts.length === 0) return { ok: false, kind: 'all-skipped' }
  if (verdicts.some((v) => v === 'unmeasured')) return { ok: false, kind: 'unmeasured' }
  if (verdicts.some((v) => v === 'blocked')) return { ok: false, kind: 'blocked' }
  return { ok: true, kind: 'all-ok' }
}

/** 把位置级的返回值归到同一组"种类"上（**只读它自己交出来的字段**）。 */
function classify(evaluation) {
  if (evaluation.ok === true) {
    return evaluation.skippedAll === undefined ? 'empty-or-all-ok' : 'ok-with-skippedAll?'
  }
  if (evaluation.unmeasured !== undefined) return 'unmeasured'
  if (evaluation.blockers.length > 0) return 'blocked'
  if (evaluation.skippedAll !== undefined) return 'all-skipped'
  return 'unknown-non-ok'
}

/**
 * 把"应当给出的结论"与"实际归出来的种类"对齐。
 * ★ 而 `expected()` 的两个 `ok:true` 分支（empty / all-ok）在这里合成一个种类 ——
 *   它们的区别由**另一组断言**（`registered` / `skippedAll`）承担，见臂 1 与臂 2。
 */
function expectedClass(exp) {
  if (exp.kind === 'empty' || exp.kind === 'all-ok') return 'empty-or-all-ok'
  return exp.kind
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 函数关系 —— 位置级必须等于"由判据层输入推出的那个结论"
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1 函数臂：位置级的结论必须【由判据层的裁决推出】—— 不许被别的信号覆盖', async () => {
  /**
   * ★ 本臂穷举判据层的输入形状，而每一个都断言：
   *
   *     classify(position) === expectedClass(expected({registered, verdicts}))
   *
   * ★ 定向突变：把位置级改成【无条件 ok】⇒ 除空位置与全通过之外全部红
   *   （而空位置那一格本来就该 ok ⇒ 它照旧绿 ⇒ 也正是为什么需要臂 2）。
   */
  const cases = [
    { name: '空位置：一条判据都没有', entries: [], registered: 0, verdicts: [] },
    { name: '一条真跑且通过', entries: [probe('p.ok', ok())], registered: 1, verdicts: ['ok'] },
    { name: '两条真跑且都通过', entries: [probe('p.ok1', ok()), probe('p.ok2', ok())], registered: 2, verdicts: ['ok', 'ok'] },
    { name: '一条真跑而拒绝', entries: [probe('p.blocked', blocked('found a problem'))], registered: 1, verdicts: ['blocked'] },
    { name: '一条真跑而没能测量', entries: [probe('p.unmeasured', unmeasured('cannot tell'))], registered: 1, verdicts: ['unmeasured'] },
    /** ★★ 这是 t58 修的那一格：全跳过 ⇒ **不许**报 ok。 */
    { name: '★ 全跳过（有判据、而一条都没跑）', entries: [probe('p.skipped', blocked('x'), () => false)], registered: 1, verdicts: [] },
    { name: '★ 两条都跳过', entries: [probe('p.s1', ok(), () => false), probe('p.s2', ok(), () => false)], registered: 2, verdicts: [] },
    { name: '部分跳过 + 部分通过 ⇒ 仍 ok', entries: [probe('p.s', blocked('x'), () => false), probe('p.ok', ok())], registered: 2, verdicts: ['ok'] },
    { name: '部分跳过 + 部分拒绝 ⇒ 拒绝', entries: [probe('p.s', ok(), () => false), probe('p.b', blocked('boom'))], registered: 2, verdicts: ['blocked'] },
    { name: '通过 + 没能测量 ⇒ 没能测量（未测量优先）', entries: [probe('p.ok', ok()), probe('p.u', unmeasured('no reading'))], registered: 2, verdicts: ['ok', 'unmeasured'] },
    { name: '拒绝 + 没能测量 ⇒ 没能测量（未测量优先于拒绝）', entries: [probe('p.b', blocked('boom')), probe('p.u', unmeasured('no reading'))], registered: 2, verdicts: ['blocked', 'unmeasured'] },
  ]

  for (const item of cases) {
    const evaluation = await withGates(item.entries).evaluate(POINT, {})
    const exp = expected({ registered: item.registered, verdicts: item.verdicts })
    assert.equal(
      classify(evaluation), expectedClass(exp),
      `★ 【${item.name}】：位置级的结论必须由判据层的裁决推出。`
      + ` 期望 ${expectedClass(exp)}（因为 registered=${item.registered}、判据层裁决=${JSON.stringify(item.verdicts)}），`
      + ` 实测 ${classify(evaluation)} —— 完整返回值：${JSON.stringify(evaluation)}`,
    )
    /** ★ 而"跑了几条"也要如实：它是"位置级真的读了判据层"的最小证据。 */
    assert.equal(evaluation.registered, item.registered, `★ 【${item.name}】：registered 必须如实`)
    assert.equal(evaluation.evaluated, item.verdicts.length, `★ 【${item.name}】：evaluated 必须等于真跑的条数`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 吞掉臂 —— "没能测量"绝不许在位置级变成"通过"
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2 吞掉臂：判据说"没能测量" / "全跳过" ⇒ 位置级【绝不许】是 ok', async () => {
  /**
   * ── 这一臂把 t58 那个缺陷的**形状**单独钉住 ───────────────────────────────────
   *
   *     判据层交出了两个**非通过**的结论之一（unmeasured / all-skipped），
   *     而位置级读出来的是 `ok: true` —— 那就是"吞掉"。
   *
   * ★ 定向突变：把位置级改成无条件 ok ⇒ 本臂红。
   * ★ 而它与臂 1 的区别：臂 1 判"整体是不是函数"，本臂【只】判那两条吞掉路径
   *   —— 于是当臂 1 因为别的原因红时，本臂仍然指出是"哪一种吞掉"。
   */
  const swallowing = [
    {
      name: '判据报 unmeasured（而位置级若报 ok 就是吞掉）',
      entries: [probe('p.u', unmeasured('the meter is unavailable'))],
    },
    {
      name: '★ 全跳过（有判据、而一条都没跑）—— t58 的那个根因',
      entries: [probe('p.s', ok(), () => false)],
    },
  ]

  for (const item of swallowing) {
    const evaluation = await withGates(item.entries).evaluate(POINT, {})
    assert.equal(
      evaluation.ok, false,
      `★ 【${item.name}】：位置级报了 ok:true —— 而判据层交出的不是"通过"。`
      + ' 这就是"层次之间吞掉结论"：每一层各自都对，而接缝把它们合成了一个看起来正常的答案。'
      + ` 完整返回值：${JSON.stringify(evaluation)}`,
    )
  }

  /**
   * ★★ 而"位置级报了非 ok"还不够 —— 还要**说得出是哪一种**：
   *   `unmeasured` 与 `skippedAll` 必须不同形（它们的补救动作不同：
   *   前者去接测量手段，后者去接那几条判据的适用条件）。
   */
  const unmeasuredRun = await withGates(swallowing[0].entries).evaluate(POINT, {})
  const skippedRun = await withGates(swallowing[1].entries).evaluate(POINT, {})

  assert.equal(unmeasuredRun.unmeasured !== undefined, true, '★ 判据报 unmeasured ⇒ 位置级必须交出 unmeasured')
  assert.equal(unmeasuredRun.skippedAll, undefined, '★ 而它【不许】带 skippedAll —— 那是另一种"没测到"')
  assert.equal(skippedRun.skippedAll !== undefined, true, '★ 全跳过 ⇒ 位置级必须交出 skippedAll')
  assert.equal(skippedRun.unmeasured, undefined, '★ 而它【不许】带 unmeasured —— 那会把"没跑"说成"测不了"')
  assert.notDeepEqual(
    { ok: unmeasuredRun.ok, unmeasured: unmeasuredRun.unmeasured !== undefined, skippedAll: skippedRun.skippedAll !== undefined && false },
    { ok: skippedRun.ok, unmeasured: skippedRun.unmeasured !== undefined, skippedAll: skippedRun.skippedAll !== undefined },
    '★ 两种"没测到"必须不同形 —— 合成一个会让两种补救动作同形',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 反向臂 —— 不许过度修正：那三格必须【仍然】是 ok
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3 反向臂：空位置 / 全通过 / 部分跳过+通过 ⇒ 必须【仍然】是 ok', async () => {
  /**
   * ── ★ 这一臂守的是 registry.ts:692 那条**写明的既有边界** ──────────────────────
   *
   *   「空位置是正常情形，不是异常 —— 在那里产出这段话，会让每个还没接判据的位置
   *     都读起来像出了问题，而那正是『把正常读成异常』，
   *     与『把异常读成正常』一样有害。」
   *
   * ★ 定向突变：把空位置也改成非 ok ⇒ 本臂红。
   *   ★ 而它与臂 2 成对：一个防"该拒的不拒"，一个防"该放的不放"。
   *     ⇒ 两条合起来才排除掉两个常量实现（全 ok / 全非 ok）。
   */
  const mustStayOk = [
    { name: '★ 空位置（一条判据都没有）—— 正常情形', entries: [], registered: 0, evaluated: 0, skipped: 0 },
    { name: '一条真跑且通过', entries: [probe('p.ok', ok())], registered: 1, evaluated: 1, skipped: 0 },
    { name: '★ 部分跳过 + 部分通过 ⇒ 仍 ok（只有【全】跳过才改裁决）', entries: [probe('p.s', blocked('x'), () => false), probe('p.ok', ok())], registered: 2, evaluated: 1, skipped: 1 },
  ]

  for (const item of mustStayOk) {
    const evaluation = await withGates(item.entries).evaluate(POINT, {})
    assert.equal(
      evaluation.ok, true,
      `★ 【${item.name}】：位置级必须是 ok —— 把正常情形读成拒绝，与把拒绝读成通过一样有害。`
      + ` 完整返回值：${JSON.stringify(evaluation)}`,
    )
    assert.deepEqual(evaluation.blockers, [], `★ 【${item.name}】：ok 的位置不许带 blocker`)
    assert.equal(evaluation.unmeasured, undefined, `★ 【${item.name}】：ok 的位置不许带 unmeasured`)
    assert.equal(evaluation.registered, item.registered, `★ 【${item.name}】：registered 如实`)
    assert.equal(evaluation.evaluated, item.evaluated, `★ 【${item.name}】：evaluated 如实`)
    assert.equal(evaluation.skipped, item.skipped, `★ 【${item.name}】：skipped 如实`)
  }

  /**
   * ★★ 而"空位置是 ok"与"全跳过是非 ok"必须**不同形** ——
   *   它们是本判据的两端，而合成一端就会让 t58 那个缺陷复活（或误伤空位置）。
   */
  const empty = await withGates([]).evaluate(POINT, {})
  const allSkipped = await withGates([probe('p.s', ok(), () => false)]).evaluate(POINT, {})
  assert.notDeepEqual(
    { ok: empty.ok, registered: empty.registered, skippedAll: empty.skippedAll },
    { ok: allSkipped.ok, registered: allSkipped.registered, skippedAll: allSkipped.skippedAll },
    '★ "这里还没有判据"与"有判据却一条没跑"必须不同形（前者的 skippedAll 必须缺席）',
  )
  assert.equal(empty.skippedAll, undefined, '★ 空位置【不得】产出 skippedAll —— 那是"有判据却全跳过"的形态')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★ 函数性 —— 同一输入两次求值必须逐字段相同
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4 函数性臂：同一组判据层裁决 ⇒ 位置级给出【同一个】结论（跑两次逐字段相同）', async () => {
  /**
   * ── 契约原话：「给出同一组判据裁决，位置级必须给出同一个结论」──────────────────
   *
   * ★ 只测"它落在 expected 上"是不够的：一个内部依赖**顺序 / 时间 / 全局状态**
   *   的实现可能每次都恰好落在 expected 上，而那不是函数关系，是巧合。
   *   ⇒ 所以这里对每种输入跑两次，断言逐字段相同。
   *
   * ★ 为什么用**各自新建**的两个注册表：同一个实例跑两次会共享内部状态，
   *   而那恰好会把"跨调用污染"伪装成"函数性"。★ 而本臂要测的正是后者。
   *   ⇒ 两个新实例 + 同一组判据 ⇒ 结果必须相同。
   */
  const shapes = [
    [],
    [probe('p.ok', ok())],
    [probe('p.b', blocked('boom'))],
    [probe('p.u', unmeasured('no reading'))],
    [probe('p.s', ok(), () => false)],
    [probe('p.s', ok(), () => false), probe('p.ok', ok())],
  ]

  for (const entries of shapes) {
    /**
     * ★ 每次都用**新的探针对象**（不是同一个引用）—— 否则"相同"可能只因为
     *   两次读的是同一个对象。
     */
    const first = await withGates(entries.map((e) => ({ ...e }))).evaluate(POINT, {})
    const second = await withGates(entries.map((e) => ({ ...e }))).evaluate(POINT, {})
    assert.deepEqual(
      second, first,
      `★ 同一组判据层裁决必须给出同一个位置级结论。第一次：${JSON.stringify(first)}，`
      + ` 第二次：${JSON.stringify(second)} —— 不同则说明位置级的结论不是判据层的函数`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 每个位置都一样 —— 不是给 completion 开的特例
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5 普遍臂：这条接缝性质在【每一个】插入点上都成立（不是给某个位置开的特例）', async () => {
  /**
   * ── 为什么必须有这一臂 ────────────────────────────────────────────────────────
   *
   *   t58 那个缺陷是在 **completion** 位置被发现的，而它**不是** completion 特有的 ——
   *   它是"位置级合并"这件事的性质。⇒ 只测一个位置，会让"别的位置也吞"留在外面。
   *
   * ★ 而它同时是防"给某个位置开特例"的：一个 `if (point === 'completion')` 的实现
   *   会在这里红。
   */
  const { INSERTION_POINTS } = await import('../lib/gates/registry.js')

  for (const point of INSERTION_POINTS) {
    /** ★ 空位置：每个位置都必须放行（正常情形）。 */
    const empty = await createGateRegistry().evaluate(point, {})
    assert.equal(empty.ok, true, `★ 空位置 "${point}" 必须放行 —— 把"这里还没接判据"判成拒绝是误伤`)
    assert.equal(empty.skippedAll, undefined, `★ 空位置 "${point}" 不得产出 skippedAll`)

    /** ★ 全跳过：每个位置都必须【不】放行（t58 那条接缝在别处也要成立）。 */
    const registry = createGateRegistry()
    registry.register({ id: `probe.${point}.skipped`, point, description: 'skipped probe', gate: () => ok(), appliesTo: () => false })
    const skipped = await registry.evaluate(point, {})
    assert.equal(
      skipped.ok, false,
      `★ 位置 "${point}"：有判据却全跳过 ⇒ 不许报 ok —— 这条接缝性质不是 completion 特有的`,
    )
    assert.notEqual(skipped.skippedAll, undefined, `★ 位置 "${point}"：必须说清"这一步没被检查"`)

    /** ★ 真跑且通过：每个位置都必须放行。 */
    const passing = createGateRegistry()
    passing.register({ id: `probe.${point}.ok`, point, description: 'ok probe', gate: () => ok() })
    assert.equal((await passing.evaluate(point, {})).ok, true, `★ 位置 "${point}"：真跑且通过 ⇒ ok`)
  }
})
