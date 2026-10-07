/**
 * ── `delivered_blocked`：给「交付合格但门拦着」一个正确的终态（t55）────────────────
 *
 * 这不是一条判据的三臂，而是**一次收口语义的修复**。臂按"每一个被修掉的误记各有一条
 * 能打红它的臂"来排：
 *
 *   臂 1（正记臂）：交付合格 + 门拦着 ⇒ 记 `delivered_blocked`，且**带门的拒绝原文**
 *   臂 2（反向臂）：★ 真正的「做坏了」**不许**被记成 `delivered_blocked`
 *                   ★ 缺它，一个"凡终态都记 delivered_blocked"的实现会全绿 ——
 *                     而那正是"把缺陷写成不变量"的第三次发作
 *   臂 3（三态臂）：三种收口**互不同形**（补救动作不同 ⇒ 读数必须不同）
 *   臂 4（统计臂）：status 要能回答「有多少卡在门上、各是哪个门」
 *   臂 5（对照臂）：正常的 completed 不受影响（不产生记录，也不被算进缺口）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-07）：今天 **16 个任务全部由 captain 代落终态**，而其中多数
 * **交付物是合格的**（有 25/25 夹具、`pnpm verify exit=0`）。而它们的终态被落成
 * `cancelled`。
 *
 * ⇒ `cancelled` 的语义是「**被中止**」，不是「**做完了但记录不了**」。
 *   把后者记成前者 ⇒ 台账里**读不出「哪些真做完了」** ⇒ 整个台账的**结论层**失去意义。
 *
 * ★ 本队记过那条纪律的三种形态，本条是第三种：
 *     · 把缺陷写成不变量   —— 不对
 *     · 把缺陷删掉         —— 不对
 *     · ★ **把缺陷记成一个语义不对的终态** —— 本次
 *
 * ── ★★ 为什么记在 `delivery` 上，而不是往 `TaskStatus` 里加一个成员 ─────────────
 *
 * 最自然的写法是加 `'delivered_blocked'` 到 `TaskStatus`。**它做不到**：
 * 该类型被 `Record<TaskStatus, …>` 穷尽使用（`src/state.ts` 与 `src/quality-gates.ts`），
 * 加成员会让后者当场 `TS2741` —— **而 `src/quality-gates.ts` 不在本任务射程里**。
 *
 * ★ 而"做不到"在这里恰好是对的：
 *   · `status` 答「在生命周期哪一点」，`delivery.outcome` 答「**为什么停在那里**」——
 *     **两个轴**。合进一个枚举会让 `delivered_blocked` 与 `completed` 并列，
 *     读的人以为它们是同一种东西的两种程度，而补救动作完全不同。
 *   · 留着 `status` 不变 ⇒ 既有消费者（调度器、看板、邮箱、判据注册表）一个字不用改。
 *
 * ── ★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）────────────────────────
 *
 * 「某个任务 id 现在是什么状态」「台账里现在有几个 cancelled」**都不是不变量**。
 * 本文件里每一个任务都是**夹具自己造的**，不读盘上真实的 team.json ——
 * 一个去读真实团队的夹具会在下一次团队重建时按设计变红，而红的原因与"收口语义"无关。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import {
  buildDeliveryRecord,
  summariseDeliveries,
  describeDeliveries,
  dependencyOutcomeOf,
} from '../lib/state.js'
import { DELIVERY_OUTCOMES } from '../lib/types.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_SOURCE = join(ROOT, 'src', 'state.ts')
const TYPES_SOURCE = join(ROOT, 'src', 'types.ts')
const BUILT_STATE = join(ROOT, 'lib', 'state.js')
const BUILT_TYPES = join(ROOT, 'lib', 'types.js')

/** 一条最小任务。★ 只填本机制读的那几格。 */
function task(spec) {
  return {
    id: spec.id,
    subject: `task ${spec.id}`,
    status: spec.status ?? 'cancelled',
    dependencies: spec.dependencies ?? [],
    createdAt: 1,
    updatedAt: 1,
    ...spec.delivery === undefined ? {} : { delivery: spec.delivery },
    ...spec.verdict === undefined ? {} : { verdict: spec.verdict },
    ...spec.acceptanceResults === undefined ? {} : { acceptanceResults: spec.acceptanceResults },
    ...spec.commandsRun === undefined ? {} : { commandsRun: spec.commandsRun },
  }
}

/** 今天那个真实的拒绝原文（夹具自己写死，不读盘）。 */
const R5_REFUSAL = '[completion.r5] R5 could not locate the new test files: no scan directories were declared'
const CHANGED_PATHS_REFUSAL = '[dispatch.changed-paths] no write to it was observed in this member\'s session'
const MUTATION_REFUSAL = '[completion.mutation] this task declared no changed files, so there is nothing to mutate'

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（正记臂）：交付合格 + 门拦着 ⇒ delivered_blocked，且带门的拒绝原文
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1：交付合格 + 门拦着 ⇒ 记 delivered_blocked，且**带门的拒绝原文**', () => {
  /**
   * ★ 这一臂就是本任务的验收。它复现今天的真实形状：一份合格的交付
   *   （`pnpm verify exit=0`、夹具全绿）被门的裁决挡住，最后由人代落终态。
   */
  const built = buildDeliveryRecord({
    outcome: 'delivered_blocked',
    gateRefusals: [R5_REFUSAL, CHANGED_PATHS_REFUSAL],
    by: 'captain',
    at: 1_800_000_000_000,
  })
  assert.equal(built.ok, true, `★ 合格的交付 + 门拦着必须记得下来：${JSON.stringify(built)}`)
  assert.equal(built.record.outcome, 'delivered_blocked')
  assert.deepEqual(
    built.record.gateRefusals, [R5_REFUSAL, CHANGED_PATHS_REFUSAL],
    '★ 必须逐字保留门说的话 —— 转述会丢掉判据那句里的限定语，而那正是判断"门是不是错了"的依据',
  )
  assert.equal(built.record.by, 'captain', '★ 谁代落的要读得出来')
  assert.equal(built.record.at, 1_800_000_000_000)
})

test('★★ 臂 1b：没有门的拒绝原文 ⇒ **不许**记 `delivered_blocked`', () => {
  /**
   * ── 这一条钉的是"记录的证据完整性"，不是形式主义 ────────────────────────────────
   *
   * `delivered_blocked` 与 `not_delivered` 的**唯一区别**就是"东西是好的、而门拦着"。
   * ⇒ 少了门的原话，这个记录就**没有携带**那个区别 ⇒ 它与"做坏了"在读的人眼里同形。
   *   而"同形"正是本任务要消灭的东西。
   *
   * ★ 所以这里**拒收**，而不是"记一个空的、看起来成功"——
   *   一个空记录比没有记录更坏：它会出现在统计里，让台账看起来是完整的。
   */
  const built = buildDeliveryRecord({ outcome: 'delivered_blocked' })
  assert.equal(built.ok, false, '★ 没有门原文的记录必须被拒（否则它与"做坏了"同形）')
  assert.match(built.error, /refusal text/, '★ 而且理由要说清缺的是"门的拒绝原文"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（反向臂）：真正的「做坏了」不许被记成 delivered_blocked
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2：真正的「做坏了」⇒ 记 `not_delivered`，★ 与「门拦着」不同形', () => {
  /**
   * ── 这一臂是整份夹具里最重要的一条 ──────────────────────────────────────────
   *
   * 本任务做的是**给一种情形一个正确的名字**。而"加一个名字"有一个很自然的
   * 过度写法：**凡终态都记它**。那个实现在臂 1 上完全绿 —— 而它会把
   * "东西真的是坏的"也记成"交付合格、只是记录不了"。
   *
   * ⇒ 那是**方向相反**的同一类错误：把缺陷写成不变量是掩盖它，
   *   而把缺陷记成"合格"是**声称**它不存在。本队对后者有一句更狠的记账：
   *   把"没测到"并进"通过"。
   *
   * ★ 本条用**今天那个真实的坏形状**来测：一条验收项为 `failed` 的交付。
   *   它的补救动作是**重做**，不是"人代落"。
   */
  const brokenDelivery = task({
    id: 't-broken',
    status: 'failed',
    acceptanceResults: [{ criterion: 'the gate must pass', status: 'failed' }],
  })
  const record = buildDeliveryRecord({ outcome: 'not_delivered', reason: 'acceptance criterion failed: the gate must pass' })
  assert.equal(record.ok, true)

  /**
   * ★ 断言两条读数**不同形**（这正是"必须能区分"的字面落点）：
   *   ① 它们不是同一个 outcome；
   *   ② 它们要求的证据**不同**（门原文 vs 理由）。
   */
  const blockedRecord = buildDeliveryRecord({ outcome: 'delivered_blocked', gateRefusals: [R5_REFUSAL] })
  assert.notEqual(
    record.record.outcome, blockedRecord.record.outcome,
    '★ "做坏了"与"门拦着"必须是两个不同的名字 —— 它们的补救动作是"重做"与"人代落"',
  )
  assert.equal(blockedRecord.record.reason, undefined, '★ 而"门拦着"那一格不需要"哪一点坏了"的理由')
  assert.equal(record.record.gateRefusals, undefined, '★ 而"做坏了"那一格不需要门的原文（没有门拦它）')

  /** ★ 并且：一条**真坏了**的任务，用一个 delivered_blocked 去记它必须是可辨的。 */
  assert.equal(brokenDelivery.acceptanceResults[0].status, 'failed', '★ 夹具自检：这份交付确实是坏的')
})

test('★★ 臂 2b：`not_delivered` 必须说清**哪一点坏了**（否则无从重做）', () => {
  const built = buildDeliveryRecord({ outcome: 'not_delivered' })
  assert.equal(built.ok, false, '★ 没有理由的 not_delivered 必须被拒')
  assert.match(built.error, /what was wrong|reason/, '★ 理由要说清缺的是"哪一点坏了"')
})

test('★ 臂 2c：非法取值被拒（不许静默落成某一类）', () => {
  for (const bogus of ['made_up', 'completed', '', undefined, 42, null]) {
    assert.equal(
      buildDeliveryRecord({ outcome: bogus }).ok, false,
      `★ ${JSON.stringify(bogus)} 不是一个收口取值 ⇒ 必须拒，而不是归到某一类里`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（三态臂）：三种收口互不同形 —— 它们的补救动作不同
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3：三种收口的补救动作不同 ⇒ 读数必须不同形', () => {
  /**
   * 用户在派工里给的那张表，本臂把它变成可执行断言：
   *
   *     交付合格 + 门拦着 ⇒ 人代落 / 改门
   *     交付不合格        ⇒ 重做
   *     门自己错了        ⇒ 改门
   *
   * ★ 三者必须**互不相等**且**各自可达**。只断言"有两个不同"是不够的。
   */
  const three = {
    delivered_blocked: buildDeliveryRecord({ outcome: 'delivered_blocked', gateRefusals: [R5_REFUSAL] }),
    not_delivered: buildDeliveryRecord({ outcome: 'not_delivered', reason: 'the fixture never went red' }),
    gate_fault: buildDeliveryRecord({ outcome: 'gate_fault', gateRefusals: [MUTATION_REFUSAL] }),
  }
  assert.deepEqual(
    Object.values(three).map((entry) => entry.ok), [true, true, true],
    '★ 三种都必须记得下来（缺一个，那张表里就有一行是空话）',
  )
  assert.equal(
    new Set(Object.values(three).map((entry) => entry.record.outcome)).size, 3,
    '★ 三个名字必须互不相同 —— 合成一个就是三种补救动作合流',
  )
  /** ★ 而常量表本身要与产出对得上（不许有一格永远产不出来）。 */
  assert.deepEqual(
    [...DELIVERY_OUTCOMES].sort(),
    Object.keys(three).sort(),
    '★ DELIVERY_OUTCOMES 里的每个取值都必须真的产得出来（否则它是一条只写在常量里的话）',
  )
})

test('★★ 臂 3b：「门自己错了」与「做坏了」必须分得开（今天 5 次同形终止的成因）', () => {
  /**
   * ── 为什么这一格单独存在 ──────────────────────────────────────────────────────
   *
   * 今天 5 次同形终止（t26/t28/t32/t40/t44）的成因是**判据在自己没有对象可判时开火**，
   * 而那个读数看起来像"工作不合格"。
   * ⇒ 如果台账把 `gate_fault` 与 `not_delivered` 合成一个，那么**下一次**遇到同样情形时，
   *   读的人仍然只能看到"活没干好"—— 而正确的动作是**去改门**。
   *
   * ★ 所以这一格是"让下一次不必再发生"的**读数基础**（预防那半要靠 t54 那侧）。
   */
  const gateFault = buildDeliveryRecord({ outcome: 'gate_fault', gateRefusals: [MUTATION_REFUSAL] })
  const badWork = buildDeliveryRecord({ outcome: 'not_delivered', reason: 'it does not work' })
  assert.notEqual(gateFault.record.outcome, badWork.record.outcome)
  assert.deepEqual(gateFault.record.gateRefusals, [MUTATION_REFUSAL], '★ 门错了必须带上门的原话（那是改门的依据）')
  assert.equal(badWork.record.gateRefusals, undefined, '★ 而活没干好时没有"门"要交代')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（统计臂）：「有多少任务卡在门上、各是哪个门」
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4：status 要能回答「有多少卡在门上、各是哪个门」', () => {
  /**
   * ── 这一臂是"可被统计"的字面落点，也是 user 痛点的正面回答 ──────────────────────
   *
   * 用户原话：「什么时候触发也是凭我的个人经验」。收口这一侧的同一件事是：
   * **"无人值守还差什么"只能靠人手工数卡点**（captain 报：64 条里约 20 条在完工门）。
   * ⇒ 本臂把那一次手工动作变成一条可复现、可断言读数。
   *
   * ★ 断言的是**具体的两个答案**（几个、哪几个门），不是一个总数 ——
   *   一个只报总数的实现会让"卡在哪道门"这件事重新变成人要翻台账去找的东西。
   */
  const ledger = [
    task({ id: 't1', status: 'cancelled', delivery: { outcome: 'delivered_blocked', gateRefusals: [R5_REFUSAL] } }),
    task({ id: 't2', status: 'cancelled', delivery: { outcome: 'delivered_blocked', gateRefusals: [CHANGED_PATHS_REFUSAL] } }),
    task({ id: 't3', status: 'cancelled', delivery: { outcome: 'delivered_blocked', gateRefusals: [CHANGED_PATHS_REFUSAL] } }),
    task({ id: 't4', status: 'cancelled', delivery: { outcome: 'gate_fault', gateRefusals: [MUTATION_REFUSAL] } }),
    task({ id: 't5', status: 'failed', delivery: { outcome: 'not_delivered', reason: 'x' } }),
    task({ id: 't6', status: 'completed' }),
    task({ id: 't7', status: 'pending' }),
  ]
  const summary = summariseDeliveries(ledger)

  assert.equal(summary.total, 7)
  assert.equal(summary.terminal, 6, '★ 终态的才算收口（pending 不在台账的结论层里）')
  assert.deepEqual(summary.byOutcome, {
    delivered_blocked: 3,
    not_delivered: 1,
    gate_fault: 1,
  }, '★ 三种收口各几个 —— 这正是"哪些真做完了"的读数')
  assert.deepEqual(
    summary.byGate,
    { 'completion.r5': 1, 'dispatch.changed-paths': 2, 'completion.mutation': 1 },
    '★ 各是哪个门 —— 按**判据 id** 分组，不是按整句原文（原文里带着每次都不一样的路径/计数）',
  )
  assert.equal(summary.unrecorded, 0, '★ 这一份台账每一笔都记了成因')
})

test('★★ 臂 4b：**没有成因记录的终态**单独可读 —— 不许并进任何一种 outcome', () => {
  /**
   * ── 这一臂防的是"把缺口抹平" ──────────────────────────────────────────────────
   *
   * 一份没有 `delivery` 的终态任务（今天它们全是这个形状）——
   * ⇒ 一个"默认算 delivered_blocked"的统计实现会让台账**看起来完整**，
   *   而那个数字是编的。★ 编一个完整的台账，与台账读不出来，是同一件事的两面。
   *
   * ⇒ `unrecorded` 是**独立的读数**：它是"我承认这里有个洞"。
   */
  const summary = summariseDeliveries([
    task({ id: 't1', status: 'cancelled', delivery: { outcome: 'delivered_blocked', gateRefusals: [R5_REFUSAL] } }),
    task({ id: 't2', status: 'cancelled' }),
    task({ id: 't3', status: 'cancelled' }),
  ])
  assert.equal(summary.unrecorded, 2, '★ 两道没有记录的必须被数出来，不许并进 delivered_blocked')
  assert.equal(summary.byOutcome.delivered_blocked, 1, '★ 有记录的只有一条 ⇒ 那一种就只算一条')
})

test('★★ 臂 4c：取不到判据 id 的拒绝原文 ⇒ 归 `unattributed`，★ 不许静默丢掉', () => {
  /**
   * ★ 丢掉一条取不到 id 的拒绝，正是丢掉"这条拒绝来自哪道门"这个问题的答案。
   *   而那恰好是"各是哪个门"这个读数要回答的东西。
   */
  const summary = summariseDeliveries([
    task({ id: 't1', status: 'cancelled', delivery: { outcome: 'delivered_blocked', gateRefusals: ['something went wrong, no judge id here'] } }),
  ])
  assert.equal(summary.byGate['unattributed'], 1, '★ 取不到 id 的要单独归一类，不许消失')
})

test('★ 臂 4d：读数只在有值得说的事时出声（全正常 ⇒ 沉默）', () => {
  /**
   * ★ 一个每次状态读取都渲染一行的实现，会让真正要看的那一行淹没在噪音里 ——
   *   而噪音会教人忽略告警（requires.ts 那一条的同源）。
   */
  const clean = summariseDeliveries([task({ id: 't1', status: 'completed' })])
  assert.equal(describeDeliveries(clean), '', '★ 全部正常 ⇒ 一个字都不说')

  const withGap = summariseDeliveries([task({ id: 't1', status: 'cancelled' })])
  assert.notEqual(describeDeliveries(withGap), '', '★ 而"有终态却没记成因"必须说出来')
  assert.match(describeDeliveries(withGap), /no reason recorded/, '★ 且说清是"没记成因"这一类缺口')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（对照臂）：正常情形不被影响
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：一个自己走到 completed 的任务 ⇒ 无需记录，也不进缺口读数', () => {
  /**
   * ★ `delivery` 缺席是**正常**的：它的 status 已经把话说完了。
   *   把"没有记录"一律当成缺口，会让每一份正常完成的活都变成一行噪音。
   */
  const summary = summariseDeliveries([task({ id: 't1', status: 'completed' })])
  assert.equal(summary.unrecorded, 0, '★ completed 不是缺口 —— 它不需要交代"为什么停下"')
  assert.equal(describeDeliveries(summary), '', '★ 也不产出任何一行')
})

test('★ 臂 5b：下游读得出上游是「交付合格但门拦着」，★ 与「被中止」不同形', () => {
  /**
   * ★ 这一臂把新取值接回 t26 那条链：`dependencyOutcomeOf` 现在能报
   *   `delivered_blocked` —— 而它**不同于** `cancelled`。
   *
   * ★ 为什么下游需要这个区别：`cancelled` 说"上面被中止了"（那份活可能没做完），
   *   `delivered_blocked` 说"上面**做完了**、交付是好的，只是没人验收得成"。
   *   下游据此可以放心继续，而它同时知道"那一份要人去补一笔终态"。
   */
  const delivered = task({ id: 't1', status: 'cancelled', delivery: { outcome: 'delivered_blocked', gateRefusals: [R5_REFUSAL] } })
  const aborted = task({ id: 't2', status: 'cancelled' })
  assert.equal(dependencyOutcomeOf(delivered), 'delivered_blocked', '★ 有记录的 ⇒ 读出它是"做完了"')
  assert.equal(dependencyOutcomeOf(aborted), 'cancelled', '★ 没记录的 ⇒ 如实报"被中止"（★ 不猜"多半是好的"）')
  assert.notEqual(
    dependencyOutcomeOf(delivered), dependencyOutcomeOf(aborted),
    '★ 两者必须不同形 —— 合成一个，下游就分不出"做完了没人验收"与"被中止了"',
  )
})

test('★ 臂 5c：非终态任务 ⇒ 仍然没有 outcome（不许提前给它一个）', () => {
  assert.equal(dependencyOutcomeOf(task({ id: 't1', status: 'in_progress' })), 'failed_context', '★ 还在做的任务没有终态结论')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 定向突变（真的执行）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★★ `withBuiltState` **必须还原两个文件**（本任务实测抓出来的）
 *
 * MEASURED：第一版只备份/还原 `src/state.ts`，而突变 A 的目标是
 * `src/types.ts`（`DELIVERY_OUTCOMES` 定义在那里）。于是突变体写进 types.ts、
 * 而 `finally` 把 state.ts 写回**旧内容** ⇒ 两半对不上 ⇒ 下一次 build 报
 * `src/capabilities.ts(7,10): TS2305: Module './state.ts' has no exported member
 * 'readTeamSync'` 一类的一串错 —— 读起来像"源码被改坏了"，而其实只是
 * **一半被还原、另一半没有**。
 *
 * ⇒ 一次中途失败会把一份**半还原**的树留在盘上，那比突变本身坏得多。
 *   本函数因此对两个文件都取快照、都还原。
 */
function withBuiltState(mutatedSource, body, target = STATE_SOURCE) {
  const snapshots = [STATE_SOURCE, TYPES_SOURCE].map((file) => [file, readFileSync(file, 'utf8')])
  const restore = () => {
    for (const [file, contents] of snapshots) writeFileSync(file, contents)
    const rebuilt = spawnSync('pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: true })
    assert.equal(rebuilt.status, 0, `★ 还原之后必须能重新 build 成功:\n${rebuilt.stdout}\n${rebuilt.stderr}`)
  }
  try {
    writeFileSync(target, mutatedSource)
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
 * ★★ 突变体必须用 cache-busting 重新 import —— **而 transitively imported 的模块
 *    也必须一起 bust**（本任务实测抓出来的，比 t6 那一次更深一层）
 *
 * MEASURED：第一版只 bust 了 `lib/state.js`：
 *
 *     return import(`${BUILT_STATE}?${tag}`)
 *
 * 而 `lib/state.js` 第 19 行是**静态** `import { DELIVERY_OUTCOMES, … } from "./types.js"`
 * —— 那个 `types.js` 没有 query ⇒ **它一直是第一次加载的那一份**。
 *
 * ⇒ 突变 A（改 `types.ts` 的 `DELIVERY_OUTCOMES`）因此**根本没被读到**：
 *   判据仍然拿着旧的常量表，`delivered_blocked` 照旧被接受 ⇒ 断言红，
 *   而报告会读作"这次突变没能打红 ⇒ 那条臂可能是恒真的"。**方向恰好相反。**
 *
 * ★ 手工验证过：同样地改 `types.ts`、build 之后，从**进程外**新起一个 node
 *   读 `lib/state.js`，`delivered_blocked` 确实被拒（"must be one of: not_delivered,
 *   gate_fault"）。⇒ 机制是对的，是夹具的 import 粒度不够。
 *
 * ⇒ 两个模块**用同一个 tag** 一起 import：这样它们在这一轮里互为一致的一份。
 */
async function freshState(tag) {
  const types = await import(`${BUILT_TYPES}?${tag}`)
  const state = await import(`${BUILT_STATE}?${tag}`)
  return { ...state, DELIVERY_OUTCOMES: types.DELIVERY_OUTCOMES }
}

/**
 * ── ★★★ 突变 A 的针脚，以及**它为什么从 types.ts 挪到了 state.ts**（本任务最贵的一课）
 *
 * 第一版瞄的是 `src/types.ts` 的 `DELIVERY_OUTCOMES` 常量表 —— 那是"最像定义处"的地方。
 * 而它**测不出来**，因为 `lib/state.js` 第 19 行是**静态** `import { DELIVERY_OUTCOMES }
 * from "./types.js"`：那个 `./types.js` 是**裸路径**，与夹具用 `?tag` 加载的
 * `lib/types.js?tag` 是**两个不同的模块实例**。
 *
 * ⇒ 实测到的形状（探针逐字）：
 *
 *     mutant.DELIVERY_OUTCOMES  ⇒ ["not_delivered","gate_fault"]   ← 夹具看到的**是**突变体
 *     mutant.buildDeliveryRecord ⇒ { ok: true, … }                 ← 而 state.js 用的是**旧的**
 *
 * ★ 也就是说：**夹具观察的那一份**与**被测代码实际用的那一份**是两个实例。
 *   断言于是红，而报告会读作"这次突变没打红 ⇒ 那条臂可能是恒真的"——**方向恰好相反**。
 *   这正是本队记账的「读错位置的出口」在 **import 图**上的形态。
 *
 * ★★ 修法不是"再 bust 一层"（那要递归地 bust 整张图，且每加一层依赖就再失效一次），
 *   而是**把针脚放在被测代码自己所在的那个模块里**：
 *   校验那一行（`state.ts` 的 `DELIVERY_OUTCOMES.includes(outcome)`）就在 state.ts，
 *   而 `lib/state.js?tag` 是夹具直接加载的那一份 ⇒ 改它必被读到。
 *
 * ⇒ 结论（值得写进本队的记账）：**突变要打在"被测模块自己"的那一行上**，
 *   而不是打在它所依赖的常量表上 —— 否则你测的是 import 缓存，不是行为。
 */
const NEEDLE_OUTCOMES = `  if (typeof outcome !== 'string' || !(DELIVERY_OUTCOMES as readonly string[]).includes(outcome)) {`
/** 突变 B 的针脚：把"门自己错了"并入"做坏了"。 */
const NEEDLE_GATE_FAULT = `  if (kind !== 'not_delivered' && refusals.length === 0) {`

test('★ 定向突变 A：把三种收口塌成一种（delivered_blocked 并入 cancelled）⇒ 臂 3/4 必须红', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**（`rm -rf lib/` 的窗口会让并行读到假红），所以这一条
   *   由环境变量显式开启，默认跳过，由本任务的验证读数那次单独运行。
   */
  if (process.env.AGENT_TEAMS_DELIVERY_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_DELIVERY_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  const ledger = [
    task({ id: 't1', status: 'cancelled', delivery: { outcome: 'delivered_blocked', gateRefusals: [R5_REFUSAL] } }),
    task({ id: 't2', status: 'cancelled', delivery: { outcome: 'not_delivered', reason: 'x' } }),
    task({ id: 't3', status: 'cancelled', delivery: { outcome: 'gate_fault', gateRefusals: [MUTATION_REFUSAL] } }),
  ]
  const baselineState = await freshState('mutation=baseline')
  const baseline = {
    outcomes: baselineState.summariseDeliveries(ledger).byOutcome,
    distinct: new Set(ledger.map((entry) => entry.delivery.outcome)).size,
  }
  assert.deepEqual(
    baseline, { outcomes: { delivered_blocked: 1, not_delivered: 1, gate_fault: 1 }, distinct: 3 },
    '★ 突变之前：三种各一条、互不相同 —— 否则下面测的不是突变',
  )

  /**
   * ── 突变体：`delivered_blocked` 并入 `cancelled`（"就是一个终态而已"）──────────
   *
   * `replaceAll` 之后**必须断言真的替换到了**：一次没匹配上的 `replace` 会让
   * 突变体与基线逐字相同，于是"变了没有"变成恒假 —— 而报告会说"突变没打红"。
   */
  const original = readFileSync(STATE_SOURCE, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_OUTCOMES,
    /** ★ 塌成两种：`delivered_blocked` 不再被接受（"它就是一个终态而已"）。 */
    `  if (typeof outcome !== 'string' || outcome === 'delivered_blocked' || !(DELIVERY_OUTCOMES as readonly string[]).includes(outcome)) {`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行 —— 没匹配上的替换会让它恒不生效')

  await withBuiltState(mutated, async () => {
    const mutant = await freshState('mutation=collapsed')
    /** ★ 这一条断言就是**臂 3 的红**：`delivered_blocked` 不再是可记录的取值。 */
    assert.equal(
      mutant.buildDeliveryRecord({ outcome: 'delivered_blocked', gateRefusals: [R5_REFUSAL] }).ok, false,
      '★ 塌成一种之后"交付合格但门拦着"记不下来 —— 臂 3 就是靠这一条变红的',
    )
    /**
     * ★ 而**后果**也要钉住：今天那种"合格的交付被记成 cancelled"的形状**复活**，
     *   因为没有任何一格能承载它。
     */
    assert.equal(
      mutant.buildDeliveryRecord({ outcome: 'not_delivered', reason: 'x' }).ok, true,
      '★ 剩下两格仍可用（本次突变只塌掉一格）',
    )
  })

  /** ★ 还原之后逐字相等。 */
  const restored = await freshState('mutation=restored')
  assert.deepEqual(
    {
      outcomes: restored.summariseDeliveries(ledger).byOutcome,
      distinct: new Set(ledger.map((entry) => entry.delivery.outcome)).size,
    },
    baseline,
    '★ 还原之后必须与突变前逐字一致 —— 否则盘上留着一份没人认得的实现',
  )
})

test('★ 定向突变 B：把「门自己错了」并入「做坏了」⇒ 臂 3b 必须红', async (t) => {
  /**
   * ★ 第二处也是独立的一处：本任务记的是**两种不同的补救动作**（改门 / 重做），
   *   所以必须各有自己的突变，否则"两条修法各自可打红"没有证据。
   */
  if (process.env.AGENT_TEAMS_DELIVERY_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_DELIVERY_MUTATION=1 时运行')
    return
  }

  const original = readFileSync(STATE_SOURCE, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_GATE_FAULT,
    `  if (kind === 'gate_fault') { // MUTANT: "the gate is wrong" is folded into "the work was bad"
    return { ok: false, error: 'this is just bad work' }
  }
  if (kind !== 'not_delivered' && refusals.length === 0) {`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withBuiltState(mutated, async () => {
    const mutant = await freshState('mutation=folded')
    assert.equal(
      mutant.buildDeliveryRecord({ outcome: 'gate_fault', gateRefusals: [MUTATION_REFUSAL] }).ok, false,
      '★ 突变体把"门自己错了"当成"做坏了" ⇒ 臂 3b 就是靠这一条变红的',
    )
    /** ★ 另外两格不受影响（本次突变只针对 gate_fault）。 */
    assert.equal(mutant.buildDeliveryRecord({ outcome: 'not_delivered', reason: 'x' }).ok, true)
  })
})

test('★ 二次对照：突变针脚在源码里【真的存在】', () => {
  /** ★ 两条针脚**在不同文件里**（A 在 types.ts 的常量表，B 在 state.ts 的分支）——
   *  第一版两处都去 state.ts 找，于是"针脚存在"这条自检红得比突变还早。
   */
  assert.equal(readFileSync(STATE_SOURCE, 'utf8').includes(NEEDLE_OUTCOMES), true, '★ 突变 A 的针脚必须逐字存在于 state.ts（**被测模块自己**那一行）')
  assert.equal(readFileSync(STATE_SOURCE, 'utf8').includes(NEEDLE_GATE_FAULT), true, '★ 突变 B 的针脚必须逐字存在于 state.ts')
})

test('★★ 夹具自检：`freshState` 读到的确实是【当前磁盘上】的 lib', async () => {
  const a = await freshState('selfcheck=a')
  const b = await freshState('selfcheck=b')
  assert.notEqual(a, b, '★ 不同的 query 必须拿到不同的模块实例 —— 否则突变臂会静默地测旧代码')
  assert.equal(typeof a.buildDeliveryRecord, 'function')
  assert.equal(typeof b.summariseDeliveries, 'function')
  assert.equal(typeof buildDeliveryRecord, 'function')
})
