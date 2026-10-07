/**
 * ── ★ 位置级裁决（t58）：全跳过必须改变【裁决】，而不只是留下一句【说明】───────────
 *
 * ── 它防的是什么失效（MEASURED，先于本任务存在；t54 在基线上核实）─────────────────
 *
 *     「三条完工门**全 skipped** 时，位置级 `evaluate('completion', …)` 报 `ok: true`。」
 *
 * ★ 而那正是"5 个 kind 没有门 ⇒ 那 5 类的完工位置【永远报 ok】"的机制本身。
 *   实测本仓库的真实注册表（见臂 2）：
 *
 *     kind=integration / verification / review ⇒ `ok=true, evaluated=0, skipped=4`
 *     kind=implementation                      ⇒ `ok=false, evaluated=1`
 *
 * ── ★★ 缺口在【两个层次上分叉】────────────────────────────────────────────────
 *
 *     判据层**是对的**：三条门各自在表不可用时报 `unmeasured`；
 *     而位置级把那个 `unmeasured` **吞掉了** —— `appliesTo` 返回 false ⇒
 *     门**根本不进 `gate()`** ⇒ 位置级看到的是"四条都 skipped" ⇒ 报 ok。
 *
 * ★ 而 `registry.ts` 里原本已经有一句 `skippedAll` 的说明文本
 *   （"nothing was evaluated, so this step was not checked"）——
 *   **而它是【说明】，不是【裁决】**：它说了 A，裁决说了 B，而**两者在措辞上都不错**。
 *   ⇒ 那比"什么都没说"更危险：读的人**看到了那句话**，会以为自己已经知道了。
 *
 * ── ★★★ 修法：② 而非 ①（这一条是本文件最想留下的记录）─────────────────────────
 *
 * 契约给了三条路。我**先实现了 ①**（全跳过 ⇒ 报 `unmeasured`），而它当场红了
 * `gate-registry.test.mjs` 的 ⑯ 臂 3b，那句话写得很清楚：
 *
 *     「全跳过不是 unmeasured —— 那是关于"测量"的结论，而这里压根没测」
 *     「前者是"判据根本没跑"，后者是"判据跑了、说它测不了"……
 *       两者都意味着"没测到"，但成因不同、责任不同 ⇒ 不许同形。」
 *
 * ⇒ ★ 那条反对**是对的**，我接受它：`unmeasured` 在本仓库有既定含义
 *   （判据跑了、它说测不了），把"判据根本没跑"塞进同一个字段，正是本轮一直在
 *   消灭的那种**合流**。⇒ 改用 ② 的本意：裁决不再无条件给 `ok`，而**不复用
 *   `unmeasured`** —— 于是三种"没测到"**三者不同形**：
 *
 *     ┌ 空位置（registered === 0）        ok:true  · skippedAll 缺席   ← 正常，仍放行
 *     ├ 全跳过（registered>0, eval===0）   ok:false · skippedAll 在场   ← 本任务修的那个
 *     └ 判据报 unmeasured（eval >= 1）     ok:false · unmeasured 在场   ← 判据层的结论
 *
 * ── ★★ 而这一改动的【下游后果】必须被写下来（它超出本任务 inScope）─────────────────
 *
 *   调用点读的是 `ok`，而它们**在 `ok === false` 时拒绝**（`src/tools/delivery.ts:88`、
 *   `src/tools/update-task.ts:249` 与 completion 那一处）。实测：
 *
 *     completion（kind=integration）  基线 ok=true → 现在 ok=false
 *     dispatch                       基线 ok=true → 现在 ok=false
 *
 *   ⇒ ★ 也就是说：**光改注册表会把这两个位置的调用点变成拒绝** —— 而"这一轮没有
 *     适用的判据"本来不该拒绝任务（那是 t13 明确要求保住的边界）。
 *   ⇒ 所以这一改动**必须与其调用点的同步改动一起落地**，否则它是"把一种沉默
 *     换成了另一种沉默"（从"没检查却报通过"换成"没检查却拒任务"）。
 *   ⇒ ★ 本文件**如实测出并钉住这个事实**（臂 4），而不是假装它不存在 ——
 *     本任务 inScope 不含 `src/tools/`，故修复拆到别处，见臂 4 的报告。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { createGateRegistry, ok, blocked, unmeasured, INSERTION_POINTS } = await import('../lib/gates/registry.js')
const { registry } = await import('../lib/gates/index.js')

/** 把一个裁决读成它的出口名 —— **本文件唯一的读数装置**。 */
function exitOf(verdict) {
  if (verdict === null || typeof verdict !== 'object') return 'malformed'
  if (verdict.ok === true) return 'ok'
  if (typeof verdict.unmeasured === 'string' && verdict.unmeasured.trim() !== '') return 'unmeasured'
  if (Array.isArray(verdict.blockers) && verdict.blockers.length > 0) return 'blocked'
  /**
   * ★ `ok:false` 而 `blockers` 空、`unmeasured` 也缺席 —— 那是**本任务引入的第四种出口**：
   *   位置级说"这一步没被检查"。★ 它不冒充任何判据结论。
   */
  return typeof verdict.skippedAll === 'string' ? 'notChecked' : 'neither'
}

/** 一个"挂了 n 条判据、而它们的 appliesTo 全为假"的注册表。 */
function allSkippedRegistry(n) {
  const r = createGateRegistry()
  for (let index = 0; index < n; index += 1) {
    r.register({
      id: `probe-${index}`, point: 'completion', description: 'a gate that never applies',
      appliesTo: () => false,
      /* ★ 它的 gate 会开火 —— 而它**根本不该被调用**。这样"吞掉"是可观测的。 */
      gate: () => blocked('this must never run'),
    })
  }
  return r
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：全跳过不再报 ok（本任务修的那一件事）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 全跳过 ⇒ 裁决不再是 ok（而 `skippedAll` 那句说明仍然在场）', async () => {
  const skipped = await allSkippedRegistry(3).evaluate('completion', {})

  console.log(`    ℹ 全跳过 ⇒ exit=${exitOf(skipped)} ok=${skipped.ok} evaluated=${skipped.evaluated} skipped=${skipped.skipped}`)

  /**
   * ★ 核心断言：`ok` 不再是 true。
   *   基线（本任务之前）这里是 `true` —— 而"这一步没被检查"被读成"通过了"。
   */
  assert.equal(
    skipped.ok, false,
    '★ 全跳过仍然报 ok:true —— 那意味着"这一步没被检查"与"检查过了、没问题"在裁决上同形。'
    + '★ 而调用点读的就是 `ok`（它会被 `if` 判），不是旁边的 `skippedAll`。',
  )

  /** ★ 而且它**不许**冒充 `unmeasured` —— 那是判据层关于"测量"的结论。 */
  assert.equal(
    skipped.unmeasured, undefined,
    '★ 全跳过被报成了 `unmeasured` —— 而 `unmeasured` 在本仓库的含义是"判据【跑了】、'
    + '而它说测不了"（`evaluated >= 1`）。这里判据**一条都没跑**，两者成因不同、责任不同，'
    + '不许合流（`gate-registry.test.mjs` ⑯ 臂 3b 钉的就是这条）。',
  )
  /** ★ 也不许冒充 `blocked` —— 没有判据说发现了问题。 */
  assert.deepEqual(skipped.blockers, [], '★ 全跳过不许带 blocker —— 没有任何判据说发现了问题')

  /** ★ 那句说明必须还在（它是给人读的，本任务不撤销它）。 */
  assert.match(String(skipped.skippedAll), /this step was not checked/, '★ "没检查"那句话必须留全 —— 裁决变了，说明不能跟着丢')
  /** ★ 计数仍然可读。 */
  assert.equal(skipped.evaluated, 0)
  assert.equal(skipped.skipped, 3)
  assert.equal(skipped.registered, 3)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：真实语料上的那一类（29% 的机制）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 真实注册表：没有门的 kind 不再"永远报 ok"', async () => {
  /**
   * ★ 这一臂用**真实注册表**，不是构造的 —— 因为要验的正是"生产中那 5 个 kind"。
   *   `integration` / `verification` / `review` 都没有 completion 门 ⇒ 四条全跳过。
   */
  const readings = []
  for (const kind of ['integration', 'verification', 'review', 'implementation']) {
    const verdict = await registry.evaluate('completion', { task: { id: 't', kind }, wantsCompleted: true, taskNotTerminal: true })
    readings.push({ kind, exit: exitOf(verdict), ok: verdict.ok, evaluated: verdict.evaluated, registered: verdict.registered })
    console.log(`    ℹ kind=${kind.padEnd(15)} ⇒ exit=${exitOf(verdict).padEnd(10)} ok=${String(verdict.ok).padEnd(5)} evaluated=${verdict.evaluated} registered=${verdict.registered}`)
  }

  /** ★ 三个没有门的 kind：基线是 `ok:true`，现在必须是 `notChecked`。 */
  for (const reading of readings.filter((item) => item.kind !== 'implementation')) {
    assert.equal(
      reading.exit, 'notChecked',
      `★ kind=${reading.kind} 的完工位置仍然报 ok（基线形态）—— 那正是"5 个 kind 没有门 `
      + '⇒ 那 5 类的完工位置永远报 ok"这条缺口。',
    )
  }

  /**
   * ★ 反向半边：`implementation` **真的跑了**一条判据（`evaluated=1`）⇒
   *   它必须**不**落进 `notChecked`。否则本臂在"一律报 notChecked"的实现上照样绿。
   */
  const impl = readings.find((item) => item.kind === 'implementation')
  assert.notEqual(
    impl.exit, 'notChecked',
    '★ implementation 有判据真的跑了（evaluated=1），却被报成"没被检查" —— 那是过度修正',
  )
  assert.ok(impl.evaluated > 0, '★ implementation 的 evaluated 必须 > 0')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★ 反向半边：不许退化成"恒 notChecked"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 这条最重要 —— 它决定了这个修改会不会**过度修正**。
 *
 * ★ 而它保护的两件事都是**已有的、写明了的边界**：
 *   · `registered === 0`（空位置）⇒ 仍是 `ok`。理由（registry.ts 原注释）：
 *     「空位置是正常情形，不是异常 —— 在那里产出这段话，会让每个还没接判据的位置
 *       都读起来像出了问题，而那正是『把正常读成异常』，与『把异常读成正常』一样有害。」
 *   · `evaluated > 0` ⇒ 按原裁决（ok / blocked / unmeasured 三种一字不改）。
 */
test('臂 3 ★ 反向半边：空位置仍 ok、真跑过的仍按原裁决（不许退化成恒 notChecked）', async () => {
  /** ① 空位置在**每一个**位置上都必须仍是 ok（不是挑一个位置举例）。 */
  for (const point of INSERTION_POINTS) {
    const empty = await createGateRegistry().evaluate(point, {})
    assert.equal(
      empty.ok, true,
      `★ 空位置 "${point}" 被报成了非 ok —— 那是把正常情形读成异常（registry.ts 已写明这条边界）`,
    )
    assert.equal(empty.skippedAll, undefined, `★ 空位置 "${point}" 不许产出"没检查"的说明`)
    assert.equal(empty.evaluated, 0)
  }
  console.log(`    ℹ 空位置：${INSERTION_POINTS.length} 个位置全部仍是 ok ✓`)

  /** ② 真的跑了一条且通过 ⇒ ok。 */
  const passing = createGateRegistry()
  passing.register({ id: 'p', point: 'completion', description: 'd', gate: () => ok() })
  assert.equal((await passing.evaluate('completion', {})).ok, true, '★ 有一条真跑且通过 ⇒ 必须仍是 ok')

  /** ③ 真的跑了一条且 blocked ⇒ blockers 原样带出。 */
  const blocking = createGateRegistry()
  blocking.register({ id: 'b', point: 'completion', description: 'd', gate: () => blocked('a real problem') })
  const blockedVerdict = await blocking.evaluate('completion', {})
  assert.equal(blockedVerdict.ok, false)
  assert.deepEqual(blockedVerdict.blockers, ['[b] a real problem'], '★ blocked 的原文必须原样带出（与 notChecked 不同形）')
  assert.equal(blockedVerdict.skippedAll, undefined, '★ blocked 的裁决不许带"没检查"的说明')

  /** ④ 真的跑了一条且它说 unmeasured ⇒ 判据层那句话原样交回。 */
  const measuring = createGateRegistry()
  measuring.register({ id: 'u', point: 'completion', description: 'd', gate: () => unmeasured('no executor was injected') })
  const unmeasuredVerdict = await measuring.evaluate('completion', {})
  assert.equal(unmeasuredVerdict.ok, false)
  assert.match(String(unmeasuredVerdict.unmeasured), /no executor was injected/, '★ 判据层那句必须原样带出')
  assert.equal(unmeasuredVerdict.skippedAll, undefined, '★ 判据层 unmeasured 与位置级 notChecked 必须不同形')

  /** ⑤ 部分跳过 + 部分真跑 ⇒ 按真跑的那些裁决（不是 notChecked）。 */
  const mixed = createGateRegistry()
  mixed.register({ id: 's', point: 'completion', description: 'd', appliesTo: () => false, gate: () => blocked('never') })
  mixed.register({ id: 'r', point: 'completion', description: 'd', gate: () => ok() })
  const mixedVerdict = await mixed.evaluate('completion', {})
  assert.equal(mixedVerdict.ok, true, '★ 部分跳过 + 部分通过 ⇒ 仍是 ok（只有【全】跳过才改裁决）')
  assert.equal(mixedVerdict.evaluated, 1)
  assert.equal(mixedVerdict.skipped, 1)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 下游后果：光改注册表会把调用点变成拒绝（如实测出，不假装不存在）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂记的是【一件还不完整的事】，而它必须被写下来 ────────────────────────────
 *
 * 调用点读 `ok` 并**在 `ok === false` 时拒绝**：
 *   · `src/tools/delivery.ts:88`   `if (evaluation.ok === false || deliveryCheck.ok === false)`
 *   · `src/tools/update-task.ts:249`（dispatch）与 completion 那一处
 *
 * ⇒ 而 `completion` 与 `dispatch` 在真实语料上**恰好落在全跳过**（实测）：
 *
 *     completion（kind=integration）  基线 ok=true  →  现在 ok=false
 *     dispatch                        基线 ok=true  →  现在 ok=false
 *
 * ★ 也就是说：**只改注册表，会把"没检查却报通过"换成"没检查却拒任务"。**
 *   而"这一轮没有适用的判据"本来**不该**拒绝任务（t13 明确要求保住的边界）。
 *
 * ⇒ ★ 本臂的立场：**如实钉住这个事实**，而不是把它藏起来或假装本任务已完整。
 *   本任务 inScope 只含 `src/gates/registry.ts` 与它的产物 —— **不含 `src/tools/`**
 *   ⇒ 调用点的同步改动必须拆到另一张契约里。
 *   ★ 而这一臂会在**那件事做完之后**翻转（那时调用点应当读 `skippedAll` 而不拒绝），
 *     所以我把它写成**双向**的：两种状态各自可判，哪一种都不恒真。
 */
test('臂 4 ★★ 下游后果（如实记录）：全跳过改判后，两个调用点会从"放行"变成"拒绝"', async () => {
  /**
   * ★ 复刻调用点的判据（**逐字照抄那一行的形状**）—— 不 import 产品代码，
   *   因为本任务 inScope 不含 `src/tools/`，而这里要的是"那个判据会怎么反应"。
   */
  const consumerWouldReject = (verdict) => verdict.ok === false

  const delivery = await registry.evaluate('delivery', {})
  const completion = await registry.evaluate('completion', { task: { id: 't', kind: 'integration' }, wantsCompleted: true, taskNotTerminal: true })
  const dispatch = await registry.evaluate('dispatch', { task: { id: 't', kind: 'integration' }, update: {} })

  const rows = [
    { point: 'delivery', exit: exitOf(delivery), wouldReject: consumerWouldReject(delivery) },
    { point: 'completion', exit: exitOf(completion), wouldReject: consumerWouldReject(completion) },
    { point: 'dispatch', exit: exitOf(dispatch), wouldReject: consumerWouldReject(dispatch) },
  ]
  for (const row of rows) console.log(`    ℹ ${row.point.padEnd(11)} exit=${row.exit.padEnd(11)} 调用点会拒绝=${row.wouldReject}`)

  /**
   * ★ 断言"这件事是真的"（而不是"它是好的"）：只要有一个位置落到 `notChecked`，
   *   它的调用点就会拒绝 —— 而那正是需要同步修调用点的证据。
   */
  const notChecked = rows.filter((row) => row.exit === 'notChecked')
  if (notChecked.length > 0) {
    const rejecting = notChecked.filter((row) => row.wouldReject)
    assert.ok(
      rejecting.length > 0,
      '★ 有位置落到 notChecked 而调用点不会拒绝 —— 那说明调用点已经在读 skippedAll 了，'
      + '本臂的双向断言应当翻面（把这一支改成断言"它不再拒绝"）',
    )
    console.log(`    ℹ ★ ${notChecked.length} 个位置落到 notChecked，其中 ${rejecting.length} 个的调用点会拒绝 `
      + `⇒ 调用点的同步改动必须拆到另一张契约（本任务 inScope 不含 src/tools/）`)
  } else {
    /**
     * ★ 另一半：**修好之后**走这里。那时这些位置仍落 notChecked，而调用点**不再拒绝**。
     */
    console.log('    ℹ 没有位置落到 notChecked ⇒ 调用点已经不需要同步改动（或门已接上）')
  }

  /**
   * ★ 而无论走哪一支，**"空位置仍放行"这条边界都不许被下游客破坏** ——
   *   它是本臂与臂 3 共同的底线。
   */
  const empty = await registry.evaluate('admission', {})
  assert.equal(empty.ok, true, '★ 空位置仍是 ok（下游后果不许波及这一条）')
  assert.equal(consumerWouldReject(empty), false, '★ 空位置不许让调用点拒绝 —— 那是把正常读成异常')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★ 定向突变：两个方向各自打红一条臂
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 规则二后半句：把机制单独去掉 ⇒ 臂必须红 ────────────────────────────────────
 *
 * ★ 本臂用**对照实现**做归因（本任务不许碰 `src/tools/`，而注册表那一支已被臂 1/3 实测）。
 *   两个退化端：
 *
 *     alwaysOk          —— 去掉"全跳过 ⇒ 非 ok"（= 退回基线行为）
 *     alwaysNotChecked  —— 去掉"空位置仍 ok"（= 过度修正）
 *
 *   ⇒ 断言：臂 1 与臂 3 的断言**只在真实现上同时成立**。
 */
test('臂 5 ★ 定向突变：退回基线 / 过度修正 —— 两个退化端各被一条臂抓住', async () => {
  /** 真实现的裁决（用真实注册表读，不从代码里抄）。 */
  const realAllSkipped = await allSkippedRegistry(3).evaluate('completion', {})
  const realEmpty = await createGateRegistry().evaluate('completion', {})

  /** ★ 退化端 A：退回基线（全跳过报 ok）。 */
  const baselineLike = { ok: true, blockers: [], skippedAll: realAllSkipped.skippedAll }
  /** ★ 退化端 B：过度修正（空位置也报非 ok）。 */
  const overcorrected = { ok: false, blockers: [], skippedAll: 'nothing to check' }

  /** 臂 1 的断言：全跳过不许是 ok。 */
  const arm1Holds = (verdict) => verdict.ok === false && verdict.unmeasured === undefined
  assert.equal(arm1Holds(realAllSkipped), true, '★ 真实现上臂 1 必须成立')
  assert.equal(arm1Holds(baselineLike), false, '★ 退回基线后臂 1 的断言没有失败 —— 那臂 1 抓不住这个退化')

  /** 臂 3 的断言：空位置必须仍是 ok。 */
  const arm3Holds = (verdict) => verdict.ok === true
  assert.equal(arm3Holds(realEmpty), true, '★ 真实现上空位置必须仍是 ok')
  assert.equal(arm3Holds(overcorrected), false, '★ 过度修正后臂 3 的断言没有失败 —— 那臂 3 抓不住这个退化')

  /**
   * ★★ 两个退化端**各自**被**不同**的那一条断言抓住 —— 这才是"两个方向"的含义。
   *
   * ★ 我第一版在这一行写错了，记下来：我断言的是
   *   `arm1Holds(baselineLike) !== arm3Holds(overcorrected)` ——
   *   而两者**都是 `false`**（两个退化端各自让对应的那条断言失败），所以它红了。
   *   ⇒ ★ 真正的区别不在**布尔值**上，而在**谁红了**：
   *     退回基线 ⇒ 臂 1 的断言失败；过度修正 ⇒ 臂 3 的断言失败。
   *     把它们写在同一个布尔比较里，是把"两条不同的断言"压成了一个读数 ——
   *     而那正是本队记过的**合流**形态。⇒ 分开断言。
   */
  assert.equal(
    arm3Holds(baselineLike), true,
    '★ 退回基线**不该**让臂 3（空位置仍 ok）失败 —— 若它失败，说明两条断言的职责被混了',
  )
  assert.equal(
    arm1Holds(overcorrected), true,
    '★ 过度修正**不该**让臂 1（全跳过非 ok）失败 —— 同上：两条断言各自只该管自己的那个方向',
  )
  console.log('    ℹ 退回基线 ⇒ 臂 1 红；过度修正 ⇒ 臂 3 红（两条断言各管一个方向，互不越界）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 附录（写给第二半）：本改动影响到的 11 个夹具，与它们各自断言的旧契约
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★ 这个附录不是测试，是【交接清单】────────────────────────────────────────────
 *
 * captain 裁定 t58 拆成两半：
 *   · 第一半（本任务）：注册表层 —— 全跳过不再报 `ok`。**已完成**。
 *   · 第二半：让调用点区分「notChecked」与「真拒绝」，并同步更新下面这些夹具。
 *
 * ★ 它写在**测试文件里**而不是报告里，因为报告会随着任务终态沉下去，
 *   而下一个动这个文件的人**必然**会打开这里。
 *
 * ── 为什么那 11 个夹具必须一起改（而不是"它们碰巧红了"）─────────────────────────
 *
 * 它们**全部断言旧契约** —— 即"全跳过 ⇒ ok:true"。而旧契约之所以看起来对，
 * 是因为当时**没有任何调用点会因此拒任务**（消费方式没被检查）。
 * ⇒ 本任务把裁决改对之后，它们的断言就成了**对旧行为的忠诚**。
 *
 * ── 逐文件的工作量（实测的 `ok=true` 断言行数，供第二半估计）─────────────────────
 *
 *     scripts/gate-registry.test.mjs              20 行   ← ⑯ 臂 1 是那条核心断言
 *     scripts/verify-input-requires.test.mjs      15 行
 *     scripts/verify-runtime-integration.test.mjs 11 行
 *     scripts/verify-readout-uniform.test.mjs      9 行
 *     scripts/gate-admission-absorb.test.mjs       7 行
 *     scripts/gate-input-wiring.test.mjs           4 行
 *     scripts/gate-runtime-clock.test.mjs          4 行
 *     scripts/gate-admission-point.test.mjs        3 行
 *     scripts/gate-admission-checkpoint.test.mjs   2 行
 *     scripts/gate-position-wiring.test.mjs        2 行
 *     scripts/gate-runtime-liveness.test.mjs       1 行
 *
 * ★ 而"行数"只是**上界**，不是"要改 78 处"：多数 `ok=true` 断言说的是
 *   "真跑过且通过"（那些**不该**改）。第二半要逐个判断它属于哪一类 ——
 *   而那正是第二半需要自己论证的原因（captain 的原话：
 *   「一次做完会掩盖那条边界，而它是本任务的核心发现」）。
 *
 * ── 第二半的两个判据（写给接手的人，避免重新推导）────────────────────────────────
 *
 *   ① **调用点**：`ok === false` 且 `skippedAll` 在场 ⇒ **不是**拒绝，而是
 *      "这一步没被检查"。★ 而"没被检查"要不要阻止流程，是**编排层的决定**，
 *      不是注册表的 —— 注册表只负责让两者**不同形**（它已经做到了）。
 *   ② **夹具**：只改那些真正落在"全跳过"上的断言。判据是
 *      `evaluated === 0 && registered > 0` —— **不是**"所有 ok=true 都改"。
 *      ★ 一个把两者合并处理的改动，会让"真的通过了"也变成"没被检查"。
 */
