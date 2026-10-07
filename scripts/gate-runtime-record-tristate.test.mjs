/**
 * ── ★★ 运行记录的三态（t66）：没被检查 / 检查了而通过 / 检查了而发现 blocker ──────────
 *
 * ── 它防的是什么失效（MEASURED，t64 实测命中、t66 修）────────────────────────────
 *
 * `src/tools/shared/entities.ts` 的 `outcome` 映射原本是**两态**：
 *
 *     ok === false ? (unmeasured ? `unmeasured: …` : `blocked: ${blockers.join('; ')}`)
 *                  : (evaluated === 0 ? `ok (nothing evaluated: …)` : 'ok')
 *
 * 而 t58 之后，**全跳过**的 runtime 位置变成 `ok:false` 且 `blockers` 为空 ⇒ 它落进
 * `blocked` 那一支 ⇒ 运行记录里写出的是 **`"blocked: "`（后面什么都没有）**。
 *
 * ⇒ ★ **一个【没被检查】的步骤，在运行记录里读起来像【发现了一个 blocker】。**
 *   一个空的 `blocked:` 是**没有对象的指控**：它说"有问题"，而"问题"那一栏是空的。
 *
 * ★ 而那正是 t58/t64 在**调用点**消灭的同一个合流 —— 只是换成了**运行记录**这个出口。
 *   本文件把那个出口的三态钉住，与调用点那三态**逐条对齐**。
 *
 * ── 与调用点那条修法的关系（刻意的同构）─────────────────────────────────────────
 *
 *     调用点（t64）：`ok === false && skippedAll !== undefined` ⇒ **放行 + 告警**
 *     运行记录（t66）：同一判据 ⇒ **`notChecked: <skippedAll 原文>`**
 *
 *   ★ 两处用**同一个判据**是刻意的：同一个事实在两个出口上必须用同一条口径，
 *     否则它们会分叉 —— 而分叉之后，"调用点放过了、记录说被拒了"会在日志里同形。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { createGateRegistry, ok, blocked, unmeasured } = await import('../lib/gates/registry.js')

/**
 * ── ★ 装置：逐字复刻 `entities.ts` 的 `outcome` 映射 ──────────────────────────────
 *
 * ★ 为什么不直接 import `entities.ts` 的那个表达式：它是**内联**在
 *   `evaluateRuntimeGates` 里的，不导出。⇒ 复刻是唯一可选，而它带来一个风险：
 *   **复刻与产物会分叉**（改了产品忘了改这里，或反之）。
 *   ⇒ 因此臂 5 用**真实工具路径**（`agent_teams_create_task` 的 `runtime_gates.outcome`）
 *     对拍一次 —— 那一臂才是"产物真的这么写"的证据，本装置只是让三态**逐个**可测。
 *
 * ★ 而这条"复刻 + 一条真实路径对拍"的形状，正是本队反复用的：
 *   装置让**每个分支**可独立打红，真实路径让**接线**可信。两者缺一不可。
 */
function outcomeOf(evaluation) {
  return evaluation.ok === false
    ? evaluation.unmeasured !== undefined
      ? `unmeasured: ${evaluation.unmeasured}`
      : evaluation.skippedAll !== undefined
        ? `notChecked: ${evaluation.skippedAll}`
        : `blocked: ${evaluation.blockers.join('; ')}`
    : evaluation.evaluated === 0
      ? `ok (nothing evaluated: ${evaluation.registered} registered, all skipped)`
      : 'ok'
}

/** 一个挂了指定判据的 runtime 注册表。 */
function runtimeRegistry(gate, appliesTo) {
  const r = createGateRegistry()
  r.register({ id: 'probe', point: 'runtime', description: 'a runtime probe', ...(appliesTo === undefined ? {} : { appliesTo }), gate })
  return r
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★ 三态不同形（本任务的核心）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★ 三态不同形：没被检查 / 检查了而通过 / 检查了而发现 blocker', async () => {
  const notChecked = outcomeOf(await runtimeRegistry(() => ok(), () => false).evaluate('runtime', {}))
  const passed = outcomeOf(await runtimeRegistry(() => ok()).evaluate('runtime', {}))
  const blockedOutcome = outcomeOf(await runtimeRegistry(() => blocked('a real problem')).evaluate('runtime', {}))

  console.log(`    ℹ 没被检查      ⇒ ${JSON.stringify(notChecked.slice(0, 72))}`)
  console.log(`    ℹ 检查了而通过  ⇒ ${JSON.stringify(passed)}`)
  console.log(`    ℹ 发现 blocker  ⇒ ${JSON.stringify(blockedOutcome)}`)

  /** ★ 三者必须两两不同形（逐对断言，不循环 —— 漏掉哪一对都看不出来）。 */
  assert.notEqual(notChecked, passed, '★ "没被检查"与"检查了而通过"必须不同形')
  assert.notEqual(notChecked, blockedOutcome, '★ "没被检查"与"发现 blocker"必须不同形')
  assert.notEqual(passed, blockedOutcome, '★ "通过"与"发现 blocker"必须不同形')

  /** ★ 而各自的**出口名**必须是可读的、稳定的（那是契约，措辞可以变，出口名不行）。 */
  assert.match(notChecked, /^notChecked:/, '★ 没被检查的出口名必须是 notChecked:')
  assert.equal(passed, 'ok', '★ 通过就是 ok')
  assert.match(blockedOutcome, /^blocked:/, '★ 发现 blocker 的出口名必须是 blocked:')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 核心命中：那个空的 `blocked: ` 不许再出现
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★★ 核心：一个空的 `blocked: `（没有对象的指控）不许再出现', async () => {
  const notChecked = outcomeOf(await runtimeRegistry(() => ok(), () => false).evaluate('runtime', {}))

  /**
   * ★ 缺陷的**准确形状**：`blocked:` 后面什么都没有。
   *   ⇒ 这一句是本任务的存在理由 —— 它在 t66 之前会红（那时 outcome === `"blocked: "`）。
   */
  assert.doesNotMatch(
    notChecked, /^blocked:\s*$/,
    '★ 写出一个空的 `blocked: ` —— 那是"没有对象的指控"：它说有问题，而问题那一栏是空的。'
    + '★ 它把一个【没被检查】的步骤读成了【发现了一个 blocker】。',
  )
  /**
   * ★ 而且它**不许**用 `blocked:` 这个出口名（哪怕后面有内容）——
   *   因为那会让"没检查"与"发现了 blocker"在**出口名**上同形，
   *   而读者是**先看出口名**决定要不要紧张的人。
   */
  assert.doesNotMatch(
    notChecked, /^blocked:/,
    '★ "没被检查"用了 `blocked:` 这个出口名 —— 出口名一合流，后面写什么都没用了',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 反向半边：真的 blocker / unmeasured 的措辞**一字不变**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★★ 反向半边：真的 blocker 仍写 blocker 原文；unmeasured 仍写 unmeasured 那句', async () => {
  /** ① 真的发现 blocker ⇒ 必须写出**它的原文**（不是"有 blocker"这种概括）。 */
  const blockedOutcome = outcomeOf(await runtimeRegistry(() => blocked('the member has not moved for 10 minutes')).evaluate('runtime', {}))
  assert.match(
    blockedOutcome, /the member has not moved for 10 minutes/,
    '★ 真的 blocker 的**原文**必须出现在记录里 —— 一个只说"有 blocker"的记录等于没说',
  )
  assert.match(blockedOutcome, /^blocked:/, '★ 真的 blocker 仍走 blocked: 出口（既有语义不变）')

  /** ② 判据报 unmeasured ⇒ 必须写出**它那句**（既有语义不变）。 */
  const unmeasuredOutcome = outcomeOf(await runtimeRegistry(() => unmeasured('no clock was injected')).evaluate('runtime', {}))
  assert.match(
    unmeasuredOutcome, /^unmeasured:/,
    '★ unmeasured 仍走它自己的出口（t66 不许把它并进 notChecked 或 blocked）',
  )
  assert.match(unmeasuredOutcome, /no clock was injected/, '★ 并保留判据的原话')

  /** ③ 三条出口名两两不同（把"出口名"这一层单独钉一次）。 */
  const names = [blockedOutcome, unmeasuredOutcome].map((line) => line.split(':')[0])
  assert.deepEqual(names, ['blocked', 'unmeasured'])
  assert.notEqual(names[0], names[1], '★ blocked 与 unmeasured 的出口名必须不同')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 空位置的另一半：它必须仍是 `ok` 那一侧（不许把正常读成异常）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂防的是【过度修正】───────────────────────────────────────────────────
 *
 *   `registered === 0`（**空位置**：这个位置压根没有判据）是**正常情形** ——
 *   它不是"没被检查"，而是"这里本来就没有检查"。
 *   ★ 而两者在注册表这一层**可以**分开（`skippedAll` 只在 `registered > 0` 时产出），
 *     所以运行记录也不该把它们合成一句。
 */
test('臂 4 ★ 空位置（这里本来就没有判据）不许被读成"没被检查"', async () => {
  const empty = outcomeOf(await createGateRegistry().evaluate('runtime', {}))

  console.log(`    ℹ 空位置 ⇒ ${JSON.stringify(empty)}`)
  assert.doesNotMatch(
    empty, /^notChecked:/,
    '★ 空位置被读成了"没被检查" —— 而它是"这里本来就没有判据"，是正常情形。'
    + '★ 把正常读成异常与把异常读成正常一样有害（注册表那条边界已写明）。',
  )
  assert.match(empty, /^ok/, '★ 空位置必须落在 ok 那一侧')
  /** ★ 而它是哪一种 ok 也要可读（"没有判据"与"判据都通过"不同形）。 */
  assert.match(empty, /nothing evaluated/, '★ 空位置要写出"没有判据"这个原因，而不是一句光秃秃的 ok')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 真实路径对拍：产物真的这么写（复刻装置不算证据）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是臂 1~4 的**可信度来源** ─────────────────────────────────────────────
 *
 * ★ 上面四条用的 `outcomeOf` 是**复刻**（因为那个表达式内联在 `evaluateRuntimeGates`
 *   里、不导出）。复刻的风险是**它会与产物分叉**。
 * ⇒ 本臂走**真实工具路径**，从 `agent_teams_create_task` 的返回值里读
 *   `runtime_gates.outcome` —— 那一份是**产物自己写的**。
 *   它一旦与复刻不一致，这一臂就红。
 */
test('臂 5 ★★ 真实路径对拍：`agent_teams_create_task` 的 runtime_gates.outcome 是三态之一', async () => {
  const { registerAgentTeamsTools } = await import('../lib/tools.js')
  const { createTeamDir } = await import('../lib/state.js')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const workspace = mkdtempSync(join(tmpdir(), 't66-'))
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team', name: 'T66', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 0, members: [], tasks: [],
  })
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: { getProvider() { return undefined }, list() { return [] }, sendMessage: async () => 'm', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'm' },
    agents: { get() { return undefined } }, on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined })
  const call = async (name, args) => (await tools.get(name).execute(args, {
    agent: { id: 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} },
    signal: new AbortController().signal,
  }))

  const created = await call('agent_teams_create_task', { subject: 'a work task with no runtime probe', inScope: ['docs/x.md'] })
  const outcome = String(created?.runtime_gates?.outcome)
  console.log(`    ℹ 真实路径 outcome = ${JSON.stringify(outcome.slice(0, 90))}`)

  /**
   * ★ 这是一条"没被检查"的 runtime（探活判据只认 `runtime-liveness` 事件）
   *   ⇒ 真实路径必须与复刻装置一致：`notChecked:` 出口。
   */
  assert.match(
    outcome, /^notChecked:/,
    '★ 真实路径写出的不是 `notChecked:` —— 那说明【复刻装置与产物分叉了】，'
    + '或那三个出口没有被接上。★ 两种都要修，而这一臂是唯一能发现它们的地方。',
  )
  assert.doesNotMatch(outcome, /^blocked:\s*$/, '★ 真实路径仍写出空的 `blocked: ` —— t66 的缺陷还在')
  assert.equal(created?.runtime_gates?.evaluated, 0, '★ 前提：这一轮确实没有任何运行判据适用')
  assert.equal(created?.runtime_gates?.registered, 1, '★ 前提：runtime 位置确实挂着判据（否则那是"空位置"，属于臂 4）')
})
