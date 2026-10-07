#!/usr/bin/env node
/**
 * ── 需求表的【自洽性】：数据与它自己的理由不许互相否（t73）────────────────────────
 *
 * ── 它测的是什么 ──────────────────────────────────────────────────────────────
 *
 * `kind-requirements.json` 里每个 kind 有两格：`requiredGates`（数据）与
 * `because`（**为什么**是这一组）。★ 而本任务修的冲突正是：**同一个 JSON 对象里**，
 * 数据说"要 r5"，而同一行的理由说"Not required: r5"。
 *
 * ★★ 为什么它值得一条常驻的判据（而不是"这次修掉就算了"）：
 *
 *   那个冲突**从 f8fc671 起就一直在那儿**，而它活了一整天没被发现 ——
 *   因为**没有任何东西同时读那两格**。
 *   三条完工门各自只读 `requiredGates`（`gateRequirementFor`），
 *   而 `because` 只被人读。⇒ 于是"数据与理由互相否"在机制上**不可观测**。
 *
 *   ★ 这是本队记账过的形态：**一个没有人读的字段，会与"它是对的"长期同形。**
 *
 * ── 三态（★ 三者不同形）────────────────────────────────────────────────────
 *
 *   `coherent`    —— 数据与理由一致
 *   `conflict`    —— ★ 它们互相否（本任务修的那一类）；**指出是哪一个门**
 *   `unmeasured`  —— ★ **判不了**：那一行的理由没提到这个门，也没有别的依据
 *
 * ★★★ 而第三态是**必须存在**的，不是兜底：本文件靠"理由里提没提到这个门"
 *   来判，而**提到 ≠ 说"要"**。
 *
 *   · 写"Not required: r5" ⇒ 说的是**不要** ⇒ 若数据里有 r5 ⇒ **conflict**
 *   · 写"r5 stays because …" ⇒ 说的是**要** ⇒ 一致
 *   · 写"…r5/mutation…" 而没有要/不要的字样 ⇒ ★ **判不了** ⇒ 落第三态
 *
 *   ⇒ ★ 而**不许**把第三种硬判成前两种：那会让"我没能判"伪装成一个结论，
 *     而两者的补救动作相反（一个要改数据、一个要改措辞）。
 *
 * ★ 而本判据**只读表**（一个 JSON），不 import 任何产品代码 ——
 *   于是它测的是**那份数据本身**，而不是"某条门怎么用它"。
 *
 * Run: node --test scripts/gate-kind-table-coherence.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TABLE_PATH = join(ROOT, 'src', 'gates', 'completion', 'kind-requirements.json')

/** 三条完工门（表里 `requiredGates` 用的是这些 id）。 */
const GATES = ['completion.r5', 'completion.mutation', 'completion.backtest']

const table = JSON.parse(readFileSync(TABLE_PATH, 'utf8'))

/**
 * ── 理由里对这个门说了什么 ────────────────────────────────────────────────────
 *
 * @returns `'wants'` / `'does-not-want'` / `undefined`（★ 第三种：没说出来）
 *
 * ★ 判"不要"用的是**否定短语**，而不是"没出现某个词"：
 *   `Not required: <门>` / `not required: <门>` / `<门> is not required`。
 *   ★ 而它必须**贴着门的名字**取（`Not required: r5` 里 `r5` 紧跟着），
 *     否则"mutation (its subject is code…)"那种括注会把它带到别的门上去。
 */
export function stanceOn(reason, gateId) {
  if (typeof reason !== 'string') return undefined
  const short = gateId.replace(/^completion\./u, '')
  /** 门名在理由里的各种写法（`completion.r5` / `r5` / `` `r5` ``）。 */
  const names = [gateId, short]
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')
  /** ★ "不要"：否定词与门名相邻（允许中间隔一个冒号/空格/反引号）。 */
  const rejects = new RegExp(`(not required|no new|不需要|不要)\\s*[:：]?\\s*\`?(${escaped})\`?`, 'iu')
  if (rejects.test(reason)) return 'does-not-want'
  /**
   * ── ★★★ MEASURED（臂 3b 当场抓出来的）：光看"肯定短语"是**太窄**的 ──────────────
   *
   * 第一版只认 `r5: it must be …` / `r5 stays` 这种**带谓词**的肯定说法。
   * 而真实那张表里，`implementation` 那一行的理由是：
   *
   *     "new behaviour needs a new test (**r5**: it must be red before and green after),
   *      that test must actually discriminate (**mutation**), and the change must not
   *      break what was working (**backtest**)."
   *     ————————————————————————————————↑↑↑ 这两个只是**括注**，没有谓词
   *
   * ⇒ 于是 `mutation` / `backtest` 判成"没说" ⇒ 整行落 `unmeasured`（**假读数**）。
   *   ★ 而那**不是**数据的错 —— 那句话说清了它要这三个：它把三个名字逐个点在
   *     "needs"那半句里。⇒ 是我的检测器**太窄**。
   *
   * ── 修法：把"提到"本身当作"说了"，而**否定的那一支仍然优先** ──────────────────
   *
   * ★ 判定顺序因此是：**先否定 ⇒ 再"提到"**。
   *   ⇒ 一个门如果**只被否定地提到**（`Not required: r5`），它落 `does-not-want`；
   *     否则只要它**被提到**（在 requiredGates 里、而理由也讲到它），就算有说法。
   *
   * ★★ 而这一格**没有变成恒真**：它仍然能判出 `unmeasured` ——
   *   判据是"这个门**在理由里根本没出现**"（见臂 3c：一条只写 `r5/mutation` 而
   *   对被查的那个门一字不提的理由，仍落第三态）。
   */
  const mentioned = new RegExp(`\`?(${escaped})\`?`, 'iu')
  if (mentioned.test(reason)) return 'wants'
  return undefined
}

/** 一个 kind 那一行的自洽读数。★ 三态。 */
export function coherenceOf(entry) {
  const gates = Array.isArray(entry?.requiredGates) ? entry.requiredGates : []
  const reason = entry?.because
  if (typeof reason !== 'string' || reason.trim() === '') {
    return { kind: entry?.kind, state: 'unmeasured', why: 'this row has no because, so there is nothing to check the data against' }
  }
  const conflicts = []
  const unmeasured = []
  for (const gate of gates) {
    const stance = stanceOn(reason, gate)
    if (stance === 'does-not-want') conflicts.push(gate)
    else if (stance === undefined) unmeasured.push(gate)
  }
  if (conflicts.length > 0) {
    return {
      kind: entry?.kind,
      state: 'conflict',
      gates: conflicts,
      why: `the row requires ${conflicts.join(', ')} while its own because says it is not required`,
    }
  }
  if (unmeasured.length > 0) {
    return {
      kind: entry?.kind,
      state: 'unmeasured',
      gates: unmeasured,
      why: `the because does not say either way about ${unmeasured.join(', ')} — that is "could not judge", not "coherent"`,
    }
  }
  return { kind: entry?.kind, state: 'coherent', why: 'every required gate is accounted for by the because' }
}

const readings = (table.kinds ?? []).map(coherenceOf)

// ═════════════════════════════════════════════════════════════════════════════
// 臂 1：真实的那张表必须**没有冲突**
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 1：真实那张表里**没有任何一行**是 conflict（本任务修的那一类）', () => {
  const conflicts = readings.filter((reading) => reading.state === 'conflict')
  assert.deepEqual(
    conflicts.map((reading) => `${reading.kind}: ${reading.why}`), [],
    '★ 数据与它自己的理由互相否 —— 那是 f8fc671 留下的那个缺陷的形态，本判据就是为它建的',
  )
  /** ★ 夹具自检：7 个 kind 都要被读到（表被截断时这一臂不能静默地变绿）。 */
  assert.equal(readings.length, 7, '★ TASK_KINDS 有 7 个 ⇒ 表里应当有 7 行')
})

test('★★★ 臂 1b：verification 那一行**指名**断言（它是本任务修的那一行）', () => {
  /**
   * ★ 只断言"没有 conflict"是不够的：一个把 `verification` 整行删掉的实现会全绿。
   *   ⇒ 必须**指名**它：数据里留着 backtest，而 r5 **不在**里面。
   */
  const entry = (table.kinds ?? []).find((item) => item.kind === 'verification')
  assert.ok(entry !== undefined, '★ verification 那一行必须还在')
  assert.deepEqual(entry.requiredGates, ['completion.backtest'],
    '★ t73 的结论：只留 backtest（r5 对这个 kind 恒落 unmeasured，而 unmeasured 在完工位置 = 拒绝）')
  assert.ok(!entry.requiredGates.includes('completion.r5'), '★ 而 r5 不许回来')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 2：那条被删掉的立场**仍然可读**（契约的反向半边）
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 2：被删掉的立场（「要 r5」）**仍然写在表里**，并说清【为什么它错了】', () => {
  /**
   * 契约原文：「★ 反向半边：修好之后那条被删掉的立场【仍要可读】
   *            （注释里说明「曾经写在这里、而它错了、因为…」）—— 否则下一个人会重新提它。」
   *
   * ★ 而这一条**不能只测"文件里有这段字"**：那种断言在一个把整段乱写进去的实现上照样绿。
   *   ⇒ 它断言三件具体的事：那段话提到**曾经的立场**、**为什么错**、以及**实测证据**。
   */
  const entry = (table.kinds ?? []).find((item) => item.kind === 'verification')
  const history = entry?._history
  assert.equal(typeof history, 'string', '★ 表里必须保留 `_history` 那段（否则下一个人会重新发现这个冲突）')
  assert.match(history, /要 r5|「要 r5」|requiredGates 里多出来的一格/u, '★ 要说清**曾经写的是什么立场**')
  assert.match(history, /它错在|而它错了/u, '★ 要说清**它为什么错**（不是只写"已删除"）')
  assert.match(history, /MEASURED/u, '★ 而那理由要有**实测证据**（本队要求"实测，不是推断"）')
  assert.match(history, /unmeasured/u, '★ 证据的核心：r5 在这个 kind 上恒落 unmeasured')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 3：★ 判据本身有分辨力（不许恒绿、不许恒红）
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 3：把数据改回与理由冲突 ⇒ **conflict**（这就是本任务修的那个形状）', () => {
  /**
   * ★ 契约：「★ 定向突变能打红：把数据改回与理由冲突 ⇒ 若有一条检查它的臂，臂必须红
   *          （★ 若没有，本任务该建一条）。」—— **本文件就是那一条。**
   *
   * ★ 而这里用**合成的那一行**来测（不是改盘上的文件）：判据是纯函数，
   *   于是"它对不对"与"盘上那张表现在怎样"**分开**测 —— 否则一次编辑会同时改变
   *   被测物与期望值。
   */
  const broken = coherenceOf({
    kind: 'verification',
    requiredGates: ['completion.r5'],
    because: 'a verification task adds no behaviour. Not required: r5 (no new behaviour to pin), mutation (its subject is code, not a verdict).',
  })
  assert.equal(broken.state, 'conflict', '★ 数据说"要"、理由说"不要" ⇒ 必须是 conflict')
  assert.deepEqual(broken.gates, ['completion.r5'], '★ 而且必须**指名**是哪一个门')
})

test('★★ 臂 3b：**反向**半边 —— 一致的那一行必须落 `coherent`（否则这一格恒 conflict）', () => {
  /**
   * ★ 一个 `return 'conflict'` 的实现在臂 3 上完全绿。
   *   ⇒ 必须同时断言：真实那张表里每一行都读得出，且**至少有一行**是 coherent。
   *     （真实的表里 `implementation` 那一行逐字写着 "r5: it must be red before and green after"。）
   */
  const coherent = readings.filter((reading) => reading.state === 'coherent')
  assert.ok(coherent.length > 0, '★ 至少有一行是 coherent —— 否则"conflict"这个读数没有分辨力')
  /** ★ 而 `implementation` 那行的三格都在理由里各自有说法 ⇒ 它必须是 coherent。 */
  assert.equal(
    readings.find((reading) => reading.kind === 'implementation')?.state, 'coherent',
    '★ implementation 的三条门各自的理由都写在那句 because 里',
  )
})

test('★★★ 臂 3c：**判不了**是第三态 —— 不许硬判成前两种', () => {
  /**
   * ── 这一格是"三态不同形"的落点 ────────────────────────────────────────────────
   *
   * ★ 判之前"要/不要"靠**理由里说没说**，而**提到 ≠ 说了**。
   *   一条只写 `…r5/mutation…` 而没有要/不要字样的理由 ⇒ **判不了**。
   * ★ 硬判成 `conflict` 会让"措辞没写清"伪装成"数据错了"（而补救动作相反：
   *   一个要改数据、一个要改措辞）；硬判成 `coherent` 会让真冲突混过去。
   */
  /**
   * ★★★ 而"判不了"的**确切条件**是：**那个门在理由里根本没出现**。
   *
   * MEASURED（臂 3c 第一版当场抓出来的）：我原先拿一条**提到了** r5 的理由
   *   （`r5/mutation both concern the change…`）当"没说"的例子 ——
   *   而它与"括注肯定"（`needs a new test (r5)`）**在形式上完全同形**：
   *   两者都是"点了名、没有否定词"。
   * ⇒ 所以"提到但说得含糊"**不是**判不了 —— 而是一个**真的要它**的说法
   *   （它把那个门算进了这一行的理由里）。
   *   ★ 硬要把两者分开，就得去**读语义**——而那正是这条判据声明过不做的事。
   *
   * ⇒ 真正的第三态是：**理由里压根没有这个门**。
   *   而那件事的可观测形式很干净：`requiredGates` 里有它，`because` 里一个字都没提它
   *   ⇒ 那一格**没有依据** ⇒ 判不了（而不是"一致"，也不是"冲突"）。
   */
  const silent = coherenceOf({
    kind: 'x',
    requiredGates: ['completion.r5'],
    because: 'this row is about the change as a whole, and the suite must still be green afterwards.',
  })
  assert.equal(silent.state, 'unmeasured', '★ 理由里一个字都没提到 r5 ⇒ 那一格没有依据 ⇒ 第三态')
  assert.notEqual(silent.state, 'conflict', '★ 不许硬判成冲突')
  assert.notEqual(silent.state, 'coherent', '★ 也不许硬判成一致')
  assert.deepEqual(silent.gates, ['completion.r5'], '★ 而它要**指出是哪一格判不了**')
})

test('★ 臂 3d：没有 `because` 的行 ⇒ `unmeasured`（而不是"没有冲突"）', () => {
  const noReason = coherenceOf({ kind: 'x', requiredGates: ['completion.r5'] })
  assert.equal(noReason.state, 'unmeasured', '★ 没有理由 ⇒ 没有东西可对照 ⇒ 判不了')
  /** ★ 而空 `requiredGates` + 有理由 ⇒ 那是 coherent（"不要求"是一个决定，契约明写）。 */
  assert.equal(
    coherenceOf({ kind: 'x', requiredGates: [], because: 'nothing to pin here.' }).state, 'coherent',
    '★ 空数组本身不是冲突 —— 契约说"空数组必须配理由"，而它配了',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 4：判据自己不越界
// ═════════════════════════════════════════════════════════════════════════════

test('★ 臂 4：本判据**只读表**，不 import 产品代码（于是它测的是数据本身）', () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from '\.\.\/lib\//u, '★ 不 import 产品代码 —— 否则"表对不对"会被"代码怎么用它"混进来')
})

test('★ 臂 4b：`stanceOn` 贴着门名取，不把括注算到别的门上', () => {
  /**
   * ★ MEASURED（写这一条时才看清的坑）：真实的 because 里有一句
   *   `Not required: r5 (no new behaviour to pin), mutation (its subject is code, not a verdict).`
   *   —— 里面连着出现 r5 **与** mutation。若否定短语取宽了，
   *   `mutation` 也会被判成"不要" ⇒ 而 `repair` 那一行**要** mutation ⇒ **假红**。
   *   ⇒ 所以否定断言必须**贴着门名**。
   */
  const reason = 'Not required: r5 (no new behaviour to pin), mutation (its subject is code, not a verdict).'
  assert.equal(stanceOn(reason, 'completion.r5'), 'does-not-want', '★ r5 紧跟否定短语 ⇒ 不要')
  assert.notEqual(stanceOn(reason, 'completion.mutation'), 'does-not-want',
    '★ mutation 只是出现在括注里 ⇒ **不许**判成"不要"（那会给 repair 一行造成假红）')
})
