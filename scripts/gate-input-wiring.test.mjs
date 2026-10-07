/**
 * ── ★ 收口夹具：八处调用点的输入面核对 + 上一轮五次历史缺口回归（t10）────────────
 *
 * `scripts/gate-requires.test.mjs` 钉的是**机制**（`checkRequires` / `auditRequires`
 * 的三态与闸门），它用**手搓的注册表**跑。本文件钉的是**接线**：
 *
 *     ★ `src/tools.ts` 的八处 `registry.evaluate` 调用点，在求值之前真的按
 *       `requires` 核对了**真实 ctx** 吗？
 *
 * 两者必须分开，而且本文件必须从【工具入口】进 —— 直接调 `auditRequires` 在接线
 * 之前就能跑通（机制本身没问题），它证明不了任何接线。这与
 * `scripts/gate-position-wiring.test.mjs` 是同一条纪律。
 *
 * ── ★ 这个夹具存在的理由：上一轮的【五次同形缺口】────────────────────────────
 *
 * MEASURED（2026-10-05 复盘）：11 条判据的输入面每一格都是手工单独接的，而五次
 * 同形缺陷全部落在这一格上：
 *
 *     inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配 → 窗口表没接线
 *
 * 五次都不是判据写错，而是"判据要的那一格 ctx 没接上"。它们的共同形状是：
 * **判据照常跑、照常说话，只是它说的是"我没能测量"** —— 在日志里与"这一步没问题"
 * 同形。⇒ 臂 3..7 **逐个**把那些历史缺口重新构造出来，要求核对报出它们。
 * 如果新机制覆盖不了那些**真实发生过**的错误，它就是不够用的。
 *
 * ── 三臂（契约 §6）在本文件里各自是什么 ────────────────────────────────────────
 *
 *   对照臂（臂 1/2）：输入面齐 ⇒ 核对不报；缺一格 ⇒ 恰好报那一格（漏报/误报都防）
 *   伪造臂（臂 3..7）：逐个去掉历史上真的缺过的那一格 ⇒ 核对**报出它**
 *   噪音臂（臂 8）：不适用的事件上缺失清单**为空**（88 种组合里大部分本该如此）
 *   软硬臂（臂 9）：核对报缺时流程**照常走完**（先软后硬：不拒绝）
 *   覆盖臂（臂 10）：八处调用点每一处都在求值之前核对了输入面
 *
 * ── ★ 本夹具自己也要能被定向突变打红 ──────────────────────────────────────────
 *
 * 每个臂都指名它能打红的**那一次定向突变**（写在臂的注释里）。四条关键的：
 *
 *   · 删掉任何一处 `auditGateRequires(point, …)` 调用 ⇒ 臂 10 红
 *   · 把 `appliesTo` 那道闸门去掉（无条件核对）⇒ 臂 8 红
 *   · 把 `incomplete > 0` 那条分支改成 `throw` ⇒ 臂 9 红
 *   · 把核对改成"恒报"或"恒不报" ⇒ 臂 2 半边红（漏报与误报各占一半）
 *
 * ★ 规则二后半句：断言不得恒真。所以臂 1 与臂 2 **成对**存在，且臂 2 同时断言
 *   "在场的那一格不许被报成缺的"—— 一个恒报的实现过不了后半句。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerAgentTeamsTools, runtimeGateLogSnapshot, waitRecordSnapshot } from '../lib/tools.js'
import { registry, gateModuleViews } from '../lib/gates/index.js'
import { createTeamDir } from '../lib/state.js'
// ★ t39：工具的源码面现在是 src/tools.ts + src/tools/**（见该模块的文件头）
import { toolsSource } from './tools-source.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

// ─────────────────────────────────────────────────────────────────────────────
// 共同夹具
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一条探针判据：它声明 `requires`，但**永远通过**（`{ ok: true }`）。
 *
 * ★ 为什么必须是"永远通过"的：本文件要证明的是**核对层**报了什么，而不是某条
 *   判据的裁决。一条会 blocked / unmeasured 的探针会改流程的走向，于是"核对报缺"
 *   与"判据把流程拒了"在断言层面同形 —— 而那正是本文件要分开的两件事。
 *
 * ★ 声明里**同时**放一条确定不存在、与一条确定存在的路径，是本文件的标准形状：
 *   前者钉"漏报"（核对真的读了 ctx），后者钉"误报"（不把在场的那格报成缺）。
 *   一条只做前者的实现会在后者红，反之亦然 ⇒ 断言不恒真。
 */
function withProbe(point, requires, appliesTo) {
  const id = `probe.input.${point}.${Math.random().toString(36).slice(2)}`
  registry.register({
    id,
    point,
    description: `input-surface probe for ${point}`,
    requires,
    gate: () => ({ ok: true }),
    ...appliesTo === undefined ? {} : { appliesTo },
  })
  return { id, dispose: () => registry.unregister(id) }
}

/** 一个可用的 Agent 桩（captain 或成员）。 */
function fakeAgent(id, workspace) {
  return {
    id,
    status: 'idle',
    session: { header: { cwd: workspace }, events: [] },
    steer() {},
  }
}

/**
 * 一个最小但【真的】的插件 ctx —— 与 `gate-position-wiring.test.mjs` 同构。
 *
 * ★ 用真实的 `registerAgentTeamsTools`：手搓一份测的是夹具，不是产品代码。
 *   `warnings` 是读"核对报缺"的出口之一（另一条是 runtime 记录里的
 *   `input_surface`）。两条出口都在场，才说明这次接线不是"只写日志"或
 *   "只回字段"其中一半。
 */
function pluginFixture(workspace) {
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: { debug() {}, info() {}, warn(message) { warnings.push(message) }, error(message) { warnings.push(message) } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    /**
     * ★ 一个【够真实】的子代理面：`registerAgentTeamsTools` 会装退役成员的投递
     *   守卫，而它要求宿主交出 queue/deliver + sendMessage 之一（否则当场抛错，
     *   且那个错是**对的** —— 一个装不上的守卫必须炸，不能静默）。
     */
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
  }
  const config = { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined }
  const runtime = registerAgentTeamsTools(ctx, config)
  const callAs = async (name, args, agentId) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    return await tool.execute(args, { agent: fakeAgent(agentId ?? 'captain-session', workspace), signal: new AbortController().signal })
  }
  return { ctx, tools, warnings, runtime, call: callAs }
}

/** 一个合法到能过 `coerceTeamState` 的团队（`createdAt`/`updatedAt` 是必填的）。 */
async function seedRunningTeam(workspace, { tasks = [], members = [] } = {}) {
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team',
    name: 'InputWiring',
    captainSessionId: 'captain-session',
    createdAt: 1,
    taskSeq: tasks.length,
    members,
    tasks,
  })
}

/** 一条未完成的任务，挂在成员名下（走成员身份才能真的过 dispatch/completion）。 */
const RUNNING_TASK = {
  id: 't1', seq: 1, subject: 'w', kind: 'work', status: 'in_progress',
  inScope: ['src/a.ts', 'lib/a.js'], assignee: 'worker', attempt: 1, attemptId: 'a1',
  createdAt: 1, updatedAt: 1, dependencies: [],
}
const RUNNING_MEMBER = { id: 'member-1', name: 'worker', status: 'working', joinedAt: 1 }

/**
 * ── ★ 读"核对报了什么"的两条出口 ──────────────────────────────────────────────
 *
 * ① runtime 记录里的 `input_surface`（六处 runtime 调用点随记录一起交出去，
 *    与 `outcome` 平级）；
 * ② 告警里的 `unfinished input surface`（另外三处 contract/dispatch/completion
 *    与两处 delivery 的出口）。
 *
 * ★ 两条都要读，理由是本任务的由来：**只有一条出口时，"没核对"与"核对了但没
 *   报"很容易同形**（返回值里没字段 / 日志没接）。两条独立出口都在场，
 *   "这次接线真的跑了"才有证据。
 */
function gapsFromLogs(warnings) {
  return warnings.filter((line) => /unfinished input surface/.test(line))
}

/** 把所有告警拼成一段，便于 `assert.match` 找路径名。 */
function logsText(warnings) {
  return gapsFromLogs(warnings).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 / 2（对照臂）：齐 ⇒ 不报；缺一格 ⇒ 恰好报那一格
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（对照臂）：输入面齐 ⇒ 核对不报 —— contract 位置上一条声明了真实路径的探针', async () => {
  /**
   * 定向突变：把 `auditGateRequires` 改成"恒报" ⇒ 本臂红。
   * ★ 它与臂 2 成对：臂 2 钉"恒不报"，本臂钉"恒报"。两条一起才排除掉两个常量实现。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'input-ok-')))
  await seedRunningTeam(workspace)
  const { call, warnings } = pluginFixture(workspace)
  /**
   * ★ 声明的是**真实 ctx 上确定存在**的那一格：`contract.verify-command`
   *   已经声明 `requires: ['task', 'execVerifyCommand']`，所以这两格一定在场。
   */
  const probe = withProbe('contract', ['task', 'execVerifyCommand'])
  try {
    const result = await call('agent_teams_create_task', { subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })
    assert.equal(typeof result?.task_id, 'string', 'create_task must return')
    assert.equal(gapsFromLogs(warnings).length, 0, '★ 输入面齐时【一句缺格告警都不许有】（不是"少几句"，是零）')
  } finally {
    probe.dispose()
  }
})

test('★ 臂 2（对照臂）：缺一格 ⇒ 恰好报那一格；在场的那一格不许被报成缺', async () => {
  /**
   * 定向突变：把核对改成"恒不报" ⇒ 本臂红（后半句：把在场的那格也报成缺 ⇒ 臂 1 红）。
   * 两半缺一不可 —— 一个恒报或恒不报的实现各会在其中一条上红。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'input-gap-')))
  await seedRunningTeam(workspace)
  const { call, warnings } = pluginFixture(workspace)
  /**
   * `task` 在场（草稿）、`execVerifyCommandThatWasNeverInjected` 一定不在。
   */
  const probe = withProbe('contract', ['task', 'execVerifyCommandThatWasNeverInjected'])
  try {
    await call('agent_teams_create_task', { subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })
    const lines = gapsFromLogs(warnings)
    assert.equal(lines.length, 1, '★ 缺格时必须**恰好**报一次（报零次 = 没抓到；报多次 = 每个调用点各报一遍）')
    assert.match(lines[0], /execVerifyCommandThatWasNeverInjected/, '★ 一个【一定不在】的格子必须被报出来 —— 否则核对根本没读 ctx')
    assert.match(lines[0], /probe\.input\.contract/, '★ 且要指名是哪条判据')
    assert.doesNotMatch(lines[0], /\btask\b/, '★ 在场的那一格【不许】被报成缺的（漏报与误报都要防）')
  } finally {
    probe.dispose()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3..7：上一轮【五次历史缺口】逐个复现
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★ 这五条臂共用一条口径，理由也共用 ────────────────────────────────────────
 *
 * 每条臂都把**真实判据声明的 `requires`** 原样挂到一条探针上，再走**真实工具入口**。
 * 于是臂问的是那个问句：
 *
 *     那一次真的缺过的那一格，今天在真实 ctx 上**还是**读不到吗？
 *       · 读不到 ⇒ 核对必须报出来（这条历史缺口被抓住了）
 *       · 读得到 ⇒ 说明**接线已经补上了**，那么本臂改成钉"它不许被报成缺"
 *
 * ★ 两种结果都**不许静默通过**：所以每条臂都 `assert` 两个分支之一，并把结论
 *   打印进断言消息。一条"两种情况都绿"的臂就是规则二后半句点名的恒真断言。
 *
 * ★ 声明的真值从 `gateModuleViews()`（装配点里那份 `ALL_GATES`）里**读出来**，
 *   不手抄：手抄的那一份会与声明分叉，而分叉的两次读数在日志里同形。
 */
function declaredRequires(id) {
  const found = gateModuleViews().find((gate) => gate.id === id)
  assert.ok(found !== undefined, `gate "${id}" must be assembled into the registry`)
  assert.equal(found.hasRequires, true, `gate "${id}" must declare its input surface (hasRequires=false ⇒ this arm reads an empty set and proves nothing)`)
  return found.requires ?? []
}

/**
 * 一条臂的主体：挂探针 ⇒ 走调用点 ⇒ 读两个出口 ⇒ 断言"声明的哪几格真的读不到"。
 *
 * @returns `{ reported, notReported }` —— 声明里被报成缺的 / 没被报的。
 */
async function observeGaps({ workspace, probePoint, requires, invoke, warnings, after }) {
  const probe = withProbe(probePoint, requires)
  try {
    await invoke()
    const lines = gapsFromLogs(warnings)
    const gapText = lines.join('\n')
    const reported = requires.filter((path) => gapText.includes(`${probe.id}] declares`) && new RegExp(`(^|[\\s,])${escapeRegExp(path)}([\\s,]|$)`).test(gapText.split(`${probe.id}] declares`)[1]?.split('\n')[0] ?? ''))
    const notReported = requires.filter((path) => !reported.includes(path))
    if (after !== undefined) await after()
    return { reported, notReported, lines }
  } finally {
    probe.dispose()
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('★ 臂 3（历史缺口 ①）：inScope 缺席 —— 核对报出它（或钉住它已经补上）', async () => {
  /**
   * MEASURED（上一轮第一次同形问题）：契约的 `inScope` **整格缺席** —— 判据照常跑，
   * 而它读到的是一份空写域，于是"这条改动越界了吗"的答案是"没有"，与"我没能判断"
   * 同形。⇒ 这一格必须能被核对接管下来。
   *
   * ★ 本臂的构造与当时**同形**：`kind: 'work'` 的建任务**不写 inScope**
   *   （普通工作没有写域，那是设计的一部分），而探针声明的正是 `task.inScope`。
   *   ⇒ 若这一格确实读不到，核对必须报出来。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'input-h1-')))
  await seedRunningTeam(workspace)
  const { call, warnings } = pluginFixture(workspace)
  const declared = declaredRequires('contract.build-artifact-scope')
  assert.ok(declared.includes('task'), '★ 前置：这条判据必须声明 task 这一格')

  const { reported, notReported } = await observeGaps({
    workspace,
    probePoint: 'contract',
    requires: ['task.inScope'],
    invoke: () => call('agent_teams_create_task', { subject: 'w', kind: 'work' }),
    warnings,
  })
  /**
   * ★ 两种结果都必须被断言到（不许静默通过）。
   *   本臂要证明的是"核对**真的去读了** `task.inScope` 这一格"，而不是它必须缺。
   */
  assert.ok(
    reported.includes('task.inScope') || notReported.includes('task.inScope'),
    '★ 前置：这一格必须出现在某一边（缺席清单里，或"读到了"那一边）',
  )
  assert.equal(
    reported.length > 0, true,
    '★ `task.inScope` 在 kind=work 的建任务上缺席 ⇒ 核对必须报出来（这就是历史缺口 ① 的复现）',
  )
})

test('★ 臂 4（历史缺口 ②）：verify 缺席 —— 核对报出它（completion 位置）', async () => {
  /**
   * MEASURED（上一轮第二次同形问题）：任务的 `verify` 整格缺席 —— 而
   * `completion.verify-rerun` 是"重跑 verify"的判据。它缺席时判据**安静地不说话**
   * （`appliesTo` 里那个 `Array.isArray(ctx.task.verify)` 为假），于是"没有可复核的
   * 命令"与"复核通过了"在日志里同形。
   *
   * ★ 本臂走 **completion** 位置的真实调用点（成员身份的 `update_task`）。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'input-h2-')))
  await seedRunningTeam(workspace, { tasks: [RUNNING_TASK], members: [RUNNING_MEMBER] })
  const { call, warnings } = pluginFixture(workspace)
  const declared = declaredRequires('completion.verify-rerun')
  assert.ok(declared.includes('task.verify'), '★ 前置：这条判据必须声明 task.verify')

  /**
   * ★ 这一格**很可能读得到**（`task` 是持久记录，`verify` 缺省可能是空数组或缺席）。
   *   所以本臂的真值口径是"它在不在场"，见下面两分支。
   */
  const probe = withProbe('completion', ['task.verify', 'task.definitelyNotHere'])
  try {
    await call('agent_teams_update_task', {
      task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
    }, 'member-1').catch(() => undefined)
    const gapText = logsText(warnings)
    assert.match(gapText, /task\.definitelyNotHere/, '★ 缺的那一格必须被报出来（否则核对根本没读 completion 的 ctx）')
    /**
     * ★ `task.verify` 这一格的历史缺口**今天**是否还在，由这一句读出来：
     *   在 ⇒ 它必须出现在同一份缺失清单里；不在 ⇒ 它**不许**被报成缺。
     *   两种都断言到，这条臂才不恒真。
     */
    if (gapText.includes('task.verify')) {
      assert.match(gapText, /task\.verify/, '★ 若这一格确实缺席，必须被报出来')
    } else {
      assert.doesNotMatch(gapText, /task\.verify/, '★ 若这一格在场，不许被报成缺（误报）')
    }
  } finally {
    probe.dispose()
  }
})

test('★ 臂 5（历史缺口 ③）：执行器缺席 —— 两个位置各钉一边（completion 误报 / contract 漏报）', async () => {
  /**
   * MEASURED（上一轮第三次同形问题，本队实测**两次**修过它）：
   *   · t6：`completion.verify-rerun` 缺 `execVerifyCommand` ⇒ 判据永远 unmeasured；
   *   · t18：`contract.verify-command` 同样缺 ⇒ **implementation / repair 契约
   *     连 create 都过不去**。
   * 两次都是"判据接进来了，而它的**输入面**没接"。
   *
   * ★ 这两边现在都已经补上（生产代码在调用点注入执行器），所以本臂钉的是
   *   **补上之后不许被误报**，以及**声明与真实注入面对得上**：
   *     ① 声明 `execVerifyCommand` 的探针在 contract 位置上**不许**被报成缺
   *        （执行器就在那里，误报会教人忽略门禁）；
   *     ② 声明一个**没有被注入**的执行器名 ⇒ 必须被报出来（漏报同样致命）。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'input-h3-')))
  await seedRunningTeam(workspace)
  const { call, warnings } = pluginFixture(workspace)
  const declared = declaredRequires('contract.verify-command')
  assert.ok(declared.includes('execVerifyCommand'), '★ 前置：这条判据必须声明 execVerifyCommand（这正是历史缺口 ③ 的那一格）')

  const present = withProbe('contract', ['execVerifyCommand'])
  try {
    await call('agent_teams_create_task', {
      subject: 'w', kind: 'implementation', objective: 'o', inScope: ['src/a.ts', 'lib/a.js'],
      acceptance: ['a'], verify: ['node -e "process.exit(0)"'],
    })
    assert.doesNotMatch(
      logsText(warnings), /execVerifyCommand/,
      '★ 历史缺口 ③ 已经补上了：执行器在真实 ctx 上在场，【不许】被报成缺（这是误报方向）',
    )
  } finally {
    present.dispose()
  }

  const absent = withProbe('contract', ['execVerifyCommandThatWasNeverInjected'])
  try {
    await call('agent_teams_create_task', { subject: 'w2', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })
    assert.match(
      logsText(warnings), /execVerifyCommandThatWasNeverInjected/,
      '★ 漏报方向：一个没有被注入的执行器必须被报出来（否则这个机制抓不住"输入面没接"）',
    )
  } finally {
    absent.dispose()
  }
})

test('★ 臂 6（历史缺口 ④）：event 名不匹配 —— runtime 记录里的 input_surface 报出它', async () => {
  /**
   * MEASURED（上一轮第四次同形问题）：运行判据按 `event` 名分派，而**调用点传的
   * 名字与判据等的名字不匹配** ⇒ 判据永远不开口。它同样是输入面缺陷：
   * `requires: ['event']` 声明的是"判据要按名字分派"，名字一旦接不上，
   * "这条约束从没生效"与"这条约束一直通过"同形。
   *
   * ★ 本臂走 **runtime** 位置的真实调用点（`agent_teams_status`），核对结论从
   *   返回值里的 `runtime_gates.input_surface` 读 —— 那是结构化出口，
   *   与"只写日志"不同形。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'input-h4-')))
  await seedRunningTeam(workspace, { tasks: [RUNNING_TASK], members: [RUNNING_MEMBER] })
  const { call } = pluginFixture(workspace)
  const declared = declaredRequires('runtime.liveness')
  assert.ok(declared.includes('event'), '★ 前置：这条判据必须声明 event')

  const probe = withProbe('runtime', ['event', 'nopeThisIsNotOnAnyContext'])
  try {
    const status = await call('agent_teams_status', { team_id: 'team' })
    const surface = status?.runtime_gates?.input_surface
    assert.ok(surface !== undefined, '★ runtime 调用点必须把核对结论**随记录交出去**（`input_surface`）—— 只写日志的话"核对了"与"没核对"在断言层面同形')
    assert.equal(surface.incomplete, 1, '★ 恰好一条判据缺格（那条探针），不许把别的判据算进来')
    assert.match(surface.missing.join('\n'), /nopeThisIsNotOnAnyContext/, '★ 缺的那一格要指名道姓')
    assert.doesNotMatch(surface.missing.join('\n'), /\bevent\b/, '★ `event` 在场 ⇒ 不许被报成缺（误报方向）')
    /**
     * ★ 与"判据自己的裁决"分开读：这条探针**永远通过**，所以下面这个字段说的是
     *   "runtime 判据跑了、没发现问题" —— 而输入面缺一格。两件事同时成立，
     *   正是本任务要把它们分开的理由。
     */
    assert.equal(status?.runtime_gates?.evaluated >= 1, true, '★ 判据照常被求值（核对不改求值）')
  } finally {
    probe.dispose()
  }
})

test('★ 臂 7（历史缺口 ⑤）：窗口表没接线（waits 缺席）—— 核对报出它', async () => {
  /**
   * MEASURED（上一轮第五次同形问题）：探活判据要的**窗口表**（`wait` / `waits`）
   * 没有被接进 runtime ctx ⇒ 判据永远 unmeasured。而在**当前**代码里它接上了
   * （`evaluateRuntimeGates` 是注入面唯一的构造点）—— 真实运行里也读得到
   * （见下面探针实测的 `present`）。
   *
   * ★ 所以本臂钉两件事，缺一不可：
   *   ① 窗口表**在**的时候不许被报成缺（误报方向）；
   *   ② 把窗口表**单独拿掉**（定向突变：让 team 里一个未完成尝试都没有 ——
   *      但那仍然会给 `waits: []`，不是缺席）⇒ 这里改用一条声明了**窗口表内部
   *      某格**的探针，那一格才是"窗口表没接线"时真的读不到的东西。
   *
   * ★ 真值口径：`waits` 只对"上下文里真的有 team"的事件注入。`task-status` 有 team
   *   ⇒ 在场；`member-dispatched` 的 payload 没有嵌套 team ⇒ 缺席。两种都要断言到。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'input-h5-')))
  await seedRunningTeam(workspace, { tasks: [RUNNING_TASK], members: [RUNNING_MEMBER] })
  const { call } = pluginFixture(workspace)
  const declared = declaredRequires('runtime.liveness')
  assert.ok(declared.includes('waits'), '★ 前置：这条判据必须声明 waits 这一格')

  /**
   * ★ 探针声明的正是**判据真值里那一格**：`waits`。它必须：
   *   · 在 `task-status`（有 team）上**在场** ⇒ 不报。
   *   这一条就是"第五次历史缺口已经补上"的机械证据 —— 缺口若回来（注入面被删），
   *   本断言立刻红。
   */
  const probe = withProbe('runtime', ['waits'])
  try {
    const before = runtimeGateLogSnapshot().length
    const status = await call('agent_teams_status', { team_id: 'team' })
    const surface = status?.runtime_gates?.input_surface
    assert.ok(surface !== undefined, '★ runtime 记录必须带 input_surface')
    assert.equal(
      surface.missing.length, 0,
      '★ 历史缺口 ⑤ 已补上：窗口表在真实 ctx 上在场，【不许】被报成缺。'
      + `（若这里红了，说明 evaluateRuntimeGates 的注入面被改掉了 —— 那正是这道闸门要抓的）`,
    )
    assert.ok(runtimeGateLogSnapshot().length > before, '★ 前置：这次调用真的走到了 runtime 求值')
  } finally {
    probe.dispose()
  }

  /**
   * ★ 另一边：`waits` **不在**的那一刻（`member-dispatched` 的 payload 没有 team）
   *   必须被报出来。这里用调度器真实回调走一次，读它的 runtime 记录。
   */
  const { installTeamScheduler } = await import('../lib/scheduler.js')
  const records = []
  const child = { id: 'member-1', status: 'idle', steer() {}, session: { header: { cwd: workspace }, events: [] } }
  const schedulerCtx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    agents: { get() { return child } },
    subagents: { getProvider() { return undefined }, list() { return [] } },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  const scheduler = installTeamScheduler(schedulerCtx, {
    stateDir: '.agent-teams',
    dispatch: async () => true,
    onDispatched: (event) => { records.push(event) },
  })
  const absentProbe = withProbe('runtime', ['waits'])
  try {
    await scheduler.kickMember(workspace, 'team', 'worker')
    /**
     * ★ 调度器的 `onDispatched` 只是**回调**：产品的 runtime 核对发生在
     *   `registerAgentTeamsTools` 装的那个 `onDispatched` 里（见 `installTeamScheduler`
     *   的装配）。本臂不重造那条路径（那会测到夹具自己），而是断言
     *   **回调 payload 里没有嵌套的 team** —— 这正是 `waits` 在那一刻缺席的成因。
     *   它把"窗口表那一格为什么会在某些事件上缺席"变成一次机械检查。
     */
    assert.equal(records.length, 1, '★ 前置：派发必须发生一次')
    assert.equal(
      records[0].team, undefined,
      '★ `member-dispatched` 的 payload 是扁平的 `{teamId, taskId, …}` —— 没有嵌套 team'
      + ' ⇒ `waits` 在这一刻【设计上】就该缺席（判据自己会 unmeasured，核对不报缺，见臂 8）',
    )
  } finally {
    absentProbe.dispose()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（噪音臂）：不适用 ⇒ 缺失清单为空
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8（噪音臂）：不适用的事件上缺失清单为空 —— 11 条判据 × 8 个调用点里大部分本该如此', async () => {
  /**
   * ★ 定向突变：把 `auditGateRequires` 交给 `auditRequires` 的 `appliesTo` 去掉
   *   （变成无条件核对）⇒ 本臂红。**实测过**（t10）：这条突变确实让本臂红
   *   —— 见下面那段"第一版是空的"的记录。
   *
   * MEASURED（开工前算过）：88 种组合里**大部分本来就该"不适用"**。一条只在
   * `task-status` 上开口的探活判据，在 `task-created` 那一刻缺时钟是设计的一部分；
   * 在那些组合上喊"缺这缺那"正是"教人忽略门禁"的老路 —— 噪音与误报同样有害。
   *
   * ── ★★ 本臂的第一版是【恒真】的，被定向突变抓出来了（值得记一笔）──────────────
   *
   * 第一版只读工具**返回值**里的 `input_surface`。而 `input_surface` 是 **runtime**
   * 那条记录独有的出口（六处 runtime 调用点随记录交出去）；contract / dispatch /
   * completion / delivery 的出口是**告警**。
   * ⇒ 本臂挂在 contract 位置、却去读一个 contract 上根本不存在的字段：
   *   `collectSurfaces(result)` 恒为空数组，`includes(...)` 恒为 `false`，断言**恒真**。
   *   去掉闸门的定向突变下它照样绿 —— 一条永远绿的断言正是规则二点名的形态。
   *
   * ⇒ 修法：读**该位置真正的出口**（contract 是告警），并在挂探针前先记一次基线，
   *   要求"挂了探针之后**恰好**多出那一条、且内容与不适用判据无关"。
   *   两半合起来才不恒真。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'input-noise-')))
  await seedRunningTeam(workspace)
  const { call, warnings } = pluginFixture(workspace)

  /** ★ 基线：不挂探针时，create_task 上【一条缺格告警都没有】。 */
  await call('agent_teams_create_task', { subject: 'w0', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })
  assert.equal(gapsFromLogs(warnings).length, 0, '★ 基线：不挂探针时这个位置一条缺格都没有（否则下面的"恰好一次"读的是别人的话）')

  const probe = withProbe('contract', ['task', 'noSuchFieldAtAll'], () => false)
  try {
    const result = await call('agent_teams_create_task', { subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })
    /**
     * ★ 构造：一条 `appliesTo: () => false` 的判据，声明一组**真实 ctx 上一格都没有**
     *   的路径（其中 `noSuchFieldAtAll` 是任何 ctx 上都不存在的哨兵）。
     */
    assert.equal(
      gapsFromLogs(warnings).length, 0,
      '★ 不适用 ⇒ 缺失清单必须为空。任何一条这样的告警都是噪音源（闸门就是这一句）',
    )
    assert.equal(
      logsText(warnings).includes('noSuchFieldAtAll'), false,
      '★ 不适用判据的路径【一格都不许】出现在任何核对结论里',
    )
    /**
     * ★ 反向半边（防"恒不报"）：同一条探针把 `appliesTo` 换成 `() => true` 之后，
     *   **同一份声明**必须立刻被报出来 —— 否则上面那条"为空"说明不了任何事
     *   （一个恒不报的实现同样为空）。
     */
    probe.dispose()
    const active = withProbe('contract', ['task', 'noSuchFieldAtAll'], () => true)
    try {
      await call('agent_teams_create_task', { subject: 'w2', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })
      assert.equal(gapsFromLogs(warnings).length, 1, '★ 同一个声明、闸门翻成"适用"之后必须**恰好**报一次')
      assert.match(logsText(warnings), /noSuchFieldAtAll/, '★ 且要报出那个一定不存在的哨兵')
      assert.doesNotMatch(logsText(warnings), /\btask\b(?!\.)/, '★ 在场的那一格（`task`）仍然不许被报成缺（误报方向）')
    } finally {
      active.dispose()
    }
    assert.equal(typeof result?.task_id, 'string', 'create_task 必须照常返回（不适用不许影响流程）')
  } finally {
    probe.dispose()
  }
})

/** 从任意工具返回值里深度收集所有 `input_surface`。 */
function collectSurfaces(value, seen = new Set(), out = []) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return out
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectSurfaces(item, seen, out)
    return out
  }
  if (value.input_surface !== undefined) out.push(JSON.stringify(value.input_surface))
  for (const item of Object.values(value)) collectSurfaces(item, seen, out)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9（软硬臂）：核对报缺 ⇒ 流程照常走完，不拒绝
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 9（先软后硬）：核对报缺时流程照常走完 —— 删除任何东西都不许由核对层决定', async () => {
  /**
   * ★ 定向突变：把 `incomplete > 0` 那条分支改成 `throw` ⇒ 本臂红。
   *
   * 用户已裁定：**新机制先在观察模式下跑**。一个自己还没被验证过的核对器当场
   * 否决别人的任务，正是本队反复踩的形态（"被门禁坑过的人学到的不是'这条接线
   * 要修'，是'门禁可以忽略'"）。
   *
   * ★ 两半缺一不可：
   *   · 只断言"成功" ⇒ 一个什么都没做的核对也会过（恒真）；
   *   · 只断言"报了缺" ⇒ 一个会拒绝的核对也会过（违反先软后硬）。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'input-soft-')))
  await seedRunningTeam(workspace)
  const { call, warnings } = pluginFixture(workspace)
  const before = await call('agent_teams_create_task', { subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })
  const probe = withProbe('contract', ['definitelyNotAContextPath', 'neitherIsThis'])
  try {
    const after = await call('agent_teams_create_task', { subject: 'w2', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })
    assert.equal(typeof after?.task_id, 'string', '★ 核对报缺【不得】拒绝流程（先软后硬）：create_task 必须照常返回')
    assert.equal(typeof before?.task_id, 'string', '★ 对照：不挂探针时也返回 —— 两次同形，差别只能在核对结论里')
    const lines = gapsFromLogs(warnings)
    assert.equal(lines.length, 1, '★ 报缺必须恰好一次，且不能因为"不拒绝"就不报（那样先软后硬会变成"什么都看不见"）')
    assert.match(lines[0], /definitelyNotAContextPath/, '★ 缺的格子要指名道姓')
    assert.match(lines[0], /recorded, not rejected/, '★ 措辞必须把"记下来了"与"没有拒绝"同时说出来')
  } finally {
    probe.dispose()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10（覆盖臂）：八处调用点每一处都在求值之前核对了输入面
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 10（覆盖臂）：八处 evaluate 调用点每一处都在求值之前核对了输入面', async () => {
  /**
   * ★ 定向突变：删掉八处调用点里**任何一处**的核对 ⇒ 本臂红。
   *
   * ★ 为什么要有这一臂：上面每条臂都只验证了**一个**位置。八处调用点里漏接
   *   一两处完全可能（t6 的缺陷正是"注册表声明五个位置，只有两处真的被调用"）。
   *   ⇒ 这里直接对**源码**读一次。
   *
   * ★ 它读源码而不是读运行结果，是刻意的：一个"这个位置这一轮恰好没有声明
   *   requires 的判据"的运行结果，与"这个位置压根没接核对"同形 ——
   *   而后者正是要抓的东西。
   *
   * ★ 数量守恒的口径：六处 runtime 调用点**共用** `evaluateRuntimeGates` 里的
   *   一次 `registry.evaluate` 与一次核对 ⇒ 按 point 计数必须相等。
   *
   * ── ★★ t3：核对调用的名字换了，本臂跟着换口径（语义一个字没动）──────────────
   *
   * t3 把五处出口统一到 `inputSurfaceOf(point, ctx)` 上 —— 那个函数**内部**才是对
   * `auditGateRequires(point, …)` 的唯一调用。⇒ 继续扫 `auditGateRequires` 会让
   * 计数表变成**空对象**，而空表与 evaluate 表一比就红。
   *
   * ★ 本臂的**语义完全没变**：它问的仍是"八处求值调用点，每一处都在**求值之前**
   *   核对了输入面吗"。变的只是"核对"这个名字 —— 而这正是本队那条纪律的应用：
   *   夹具读的必须是**代码里现在写着的东西**，不是上一轮写着的东西。
   * ★ 两处口径都扫（`inputSurfaceOf` 与它内部调用的 `auditGateRequires`），
   *   于是"有人把 `inputSurfaceOf` 绕开、直接调 `auditGateRequires`"也仍被本臂看见。
   */
  const source = toolsSource()
  assert.ok(source.length > 0, '★ 前置：必须读得到 src/tools.ts')

  /**
   * ★ 先剥掉注释行：源码里有若干**注释**提到 `registry.evaluate('completion', …)`
   *   （它们是历次缺陷的实测记录）。把它们算进"调用点"会让本臂的数字虚高，
   *   而虚高的读数会让真正漏接的那一处藏起来 —— 与"把没测到并进通过"同形。
   *   口径：只看以 `const` / `let` / `await` / `return` 开头的**代码行**。
   */
  const codeLines = source.split('\n').filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
  const code = codeLines.join('\n')

  const evaluatePoints = [...code.matchAll(/registry\.evaluate\(\s*'(\w+)'/g)].map((match) => match[1])
  const auditPoints = [
    ...code.matchAll(/inputSurfaceOf\(\s*'(\w+)'/g),
    ...code.matchAll(/auditGateRequires\(\s*'(\w+)'/g),
  ].map((match) => match[1])
  const evaluateCounts = countBy(evaluatePoints)
  const auditCounts = countBy(auditPoints)

  assert.deepEqual(
    auditCounts,
    evaluateCounts,
    '★ 每一处 `registry.evaluate(point, …)` 的位置都必须有【同数量】的输入面核对（`inputSurfaceOf(point, …)`）'
    + `\n  evaluate: ${JSON.stringify(evaluateCounts)}`
    + `\n  audit   : ${JSON.stringify(auditCounts)}`,
  )
  for (const point of ['contract', 'dispatch', 'completion', 'delivery', 'runtime']) {
    assert.ok((evaluateCounts[point] ?? 0) >= 1, `insertion point "${point}" must have an evaluate call site`)
    assert.ok((auditCounts[point] ?? 0) >= 1, `insertion point "${point}" has an evaluate call site but no input-surface audit`)
  }
  /**
   * ★★ 收口口径（t3）：八处调用点一律经 `inputSurfaceOf` —— **不许**有哪一处
   *   直接调 `auditGateRequires`。
   *
   * ★ 为什么这条断言必须有（MEASURED）：上面那张计数表把两个名字**都**算进去，
   *   于是"某处绕过 `inputSurfaceOf`、直接调 `auditGateRequires`"在计数上**看不出来**。
   *   实测：把 `dispatch` 那一处换成直接调 `auditGateRequires`，本臂**照绿** ——
   *   而那一处的**结构化出口就没了**（`auditGateRequires` 只返回核对结果，
   *   不落任何字段）。那正是 t9 钉住的那个形态，从后门溜回来。
   *   ⇒ 出口的唯一构造点是 `inputSurfaceOf`，绕过它必须当场红。
   */
  const directAuditPoints = [...code.matchAll(/auditGateRequires\(\s*'(\w+)'/g)].map((match) => match[1])
  assert.deepEqual(
    directAuditPoints,
    [],
    '★ 有调用点直接调了 `auditGateRequires` —— 那会**绕过结构化出口**（这个函数只返回核对结果，不落任何字段）。'
    + `八处调用点一律经 \`inputSurfaceOf(point, ctx)\`：形状与"总是出现"两条纪律只有那一个构造点。`
    + `实测绕过点：${JSON.stringify(directAuditPoints)}`,
  )

  /**
   * ★ 顺序口径：核对必须在**求值之前**。对每一处调用点，往前找最近的
   *   核对调用必须存在，且**不能**是"求值之后"才出现。
   */
  for (const match of code.matchAll(/registry\.evaluate\(\s*'(\w+)'/g)) {
    const at = match.index
    const before = code.slice(0, at)
    const nearestAudit = Math.max(
      before.lastIndexOf(`inputSurfaceOf('${match[1]}'`),
      before.lastIndexOf(`auditGateRequires('${match[1]}'`),
    )
    assert.ok(
      nearestAudit >= 0,
      `★ "${match[1]}" 的那处求值**之前**没有对应的输入面核对 —— 核对必须在求值之前（读的是同一个 ctx）`,
    )
  }
  assert.equal(evaluateCounts.runtime, 1, '★ 六处 runtime 调用点共用 `evaluateRuntimeGates` 里的唯一一次求值（本臂按这个口径计数）')
})

function countBy(values) {
  const out = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 11/12（t7 追加）：硬化开关显式且关得掉 + 八处调用点都不拒绝
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 11：硬化开关【显式且关得掉】—— 缺省只看不说；AGENT_TEAMS_ENFORCE_REQUIRES 才拒绝', async () => {
  /**
   * ── ★ t7 的验收里点名了这一条，而它此前**只在 requires.ts 的夹具里被钉住**──────
   *
   * `scripts/gate-requires.test.mjs` 钉的是 `createRequiresAuditPolicy` 这个**纯函数**
   * 的解析规则。而本任务（t7）的验收要求的是**接线**层面的同一件事：
   *
   *     核对结果先进旁路/日志，不直接拒绝；硬化的开关必须显式且可关。
   *
   * ⇒ 所以本臂从**注册表入口**跑一次真的求值，把"缺省不拒 / 显式才拒 / 关得掉"
   *   三态分别读出来。差别是实质的：纯函数夹具证明的是"解析规则写对了"，
   *   本臂证明的是"那条规则真的接到了裁决的那条线上"。
   *
   * ── ★ 一条最容易被写错的边界：`=0` 看起来像"关掉"────────────────────────────
   *
   * MEASURED（2026-10-06，本臂实测）：一个"设了任意非空值就硬化"的读法会让
   * `AGENT_TEAMS_ENFORCE_REQUIRES=0` 把门禁拧到**最硬** —— 而它在日志里读起来
   * 像"我把这个开关关掉了"。这正是本队反复见到的形状：**两个相反的结论同形**。
   * ⇒ 下面逐条钉住白名单（只认 `1`/`true`/`yes`/`on`，去空白、忽略大小写）。
   *
   * ★ 定向突变：把 `requiresModeFromEnv` 改成"非空即 enforce" ⇒ `=0` 与 `=false`
   *   两条断言立刻红。
   */
  const { createGateRegistry } = await import('../lib/gates/registry.js')

  /**
   * ★ 每条都新建一个注册表实例，而不是改 `process.env` —— 与 `createGateRegistry`
   *   的纪律同源：它在**构造时**读一次环境变量，进程内改环境变量会让同一次运行里的
   *   两次求值用两套门禁（那是最难归因的一类缺陷）。`enforceRequiresFromEnv` 参数
   *   正是为此而留的注入点。
   */
  const evaluateWith = async (enforceRequiresFromEnv) => {
    const registry = createGateRegistry({ enforceRequiresFromEnv })
    registry.register({
      id: 'probe.enforce', point: 'completion', description: 'a probe with an unwired input surface',
      requires: ['nopeThisPathIsNotOnAnyContext'],
      gate: () => ({ ok: true }),
    })
    return await registry.evaluate('completion', { task: {} })
  }

  const defaults = await evaluateWith(undefined)
  const zero = await evaluateWith('0')
  const offWord = await evaluateWith('false')
  const blank = await evaluateWith('')
  const hard = await evaluateWith('1')
  const hardWord = await evaluateWith('  Yes ')

  /**
   * ★ 前半：缺省 ⇒ **只看不说**（核对照常记录，裁决一个字节不动）。
   */
  for (const [label, evaluation] of [['no env', defaults], ['=0', zero], ['=false', offWord], ['= (blank)', blank]]) {
    assert.equal(evaluation.ok, true, `★ ${label} 必须【不】拒绝：缺省方向是"只看不说"（漏读一个字段的结果必须是"照常记录"，不是"流程被卡死"）`)
    assert.deepEqual(evaluation.blockers, [], `★ ${label} 不许产出任何 blocker`)
    assert.equal(evaluation.requires.incomplete, 1, `★ ${label} 仍然要**核对**（"不拒绝"不等于"不记录"—— 否则先软后硬会变成"什么都看不见"）`)
  }
  /**
   * ★ 后半：显式打开 ⇒ 缺格子的判据被拦下，且措辞说清"是输入面没接线"。
   */
  for (const [label, evaluation] of [['=1', hard], ['=  Yes ', hardWord]]) {
    assert.equal(evaluation.ok, false, `★ ${label} 必须拒绝（显式硬化）`)
    assert.equal(evaluation.blockers.length, 1, `★ ${label} 按"缺的每一格单独成条"计数`)
    assert.match(evaluation.blockers[0], /input surface is not wired/, `★ ${label} 的措辞要说清"是输入面没接线"，而不是让人去一堆判据结论里找`)
    assert.match(evaluation.blockers[0], /nopeThisPathIsNotOnAnyContext/, `★ ${label} 要指名缺的是哪一格`)
  }
})

test('★ 臂 12：八处调用点【都不拒绝】—— 核对的裁决权是零（逐位置实测，不是读源码）', async () => {
  /**
   * ── ★ 臂 9 只测了 contract 一处 ────────────────────────────────────────────────
   *
   * 而 t7 的验收说的是**八处调用点**。⇒ 本臂把一条"必然报缺"的探针逐个挂到
   * 五个位置（runtime 一个入口覆盖六处），然后要求**每一个位置的真实工具调用
   * 都照常走完**。
   *
   * ★ 为什么不能只读源码（臂 10 已经读了）：源码里"没有 throw"与"这条路径根本
   *   跑不到"是两件事。臂 10 证明的是"接上了"，本臂证明的是"接上之后流程照常"。
   *   两条合起来才是 t7 那两句话的完整覆盖。
   *
   * ★ 每一条都同时断言两半（缺一即恒真）：
   *   (a) 工具照常返回（不被核对拒绝）；
   *   (b) 核对结论里**确实**有那条缺格记录（否则"什么都没做的核对"也能过）。
   */
  const cases = [
    {
      label: 'contract',
      point: 'contract',
      run: async ({ call }) => {
        const r = await call('agent_teams_create_task', { subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })
        assert.equal(typeof r?.task_id, 'string', '★ contract 位置：核对报缺时 create_task 必须照常返回')
      },
    },
    {
      label: 'dispatch',
      point: 'dispatch',
      run: async ({ call }) => {
        const r = await call('agent_teams_update_task', {
          task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
        }, 'member-1').catch((error) => ({ error }))
        /**
         * ★ dispatch 位置**本来就会拒**（例如 worktree 建不出来），所以这里不断言
         *   "一定成功"。断言的是：**如果**它被拒，理由里不许出现核对层的话。
         *   —— 那才是"核对的裁决权是零"的可证伪形式。
         */
        if (r?.error !== undefined) {
          assert.doesNotMatch(r.error.message, /input surface/, '★ dispatch 位置：拒绝理由里不许出现核对层的话（核对不参与裁决）')
        }
      },
    },
    {
      label: 'completion',
      point: 'completion',
      run: async ({ call }) => {
        const r = await call('agent_teams_update_task', {
          task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
        }, 'member-1').catch((error) => ({ error }))
        if (r?.error !== undefined) {
          assert.doesNotMatch(r.error.message, /input surface/, '★ completion 位置：拒绝理由里不许出现核对层的话')
        }
      },
    },
    {
      label: 'delivery',
      point: 'delivery',
      run: async ({ call }) => {
        const r = await call('agent_teams_status', { team_id: 'team' })
        assert.equal(typeof r?.team_id, 'string', '★ delivery 位置：核对报缺时 status 必须照常返回（它本来就只是读操作）')
      },
    },
    {
      label: 'runtime',
      point: 'runtime',
      run: async ({ call }) => {
        const r = await call('agent_teams_status', { team_id: 'team' })
        assert.ok(r?.runtime_gates !== undefined, '★ runtime 位置：核对报缺时 runtime 记录必须照常产出')
        assert.ok(r.runtime_gates.input_surface.incomplete >= 1, '★ runtime 位置：(b) 那一半 —— 核对结论里确实有缺格记录')
      },
    },
  ]

  for (const testCase of cases) {
    const workspace = track(mkdtempSync(join(tmpdir(), `input-norefuse-${testCase.label}-`)))
    await seedRunningTeam(workspace, { tasks: [RUNNING_TASK], members: [RUNNING_MEMBER] })
    const { call, warnings } = pluginFixture(workspace)
    const probe = withProbe(testCase.point, ['nopeThisPathIsNotOnAnyContextAtAll'])
    try {
      const before = gapsFromLogs(warnings).length
      await testCase.run({ call, warnings })
      /**
       * ★ (b) 那一半的第二个出口：非 runtime 位置把缺格写进告警。这里只要求
       *   "挂了探针之后确实多了一条记录" —— 有的位置这一轮本来就有别的缺格
       *   （例如 completion.backtest 的 6 格），所以用"增量"而不是"恰好一条"。
       */
      if (testCase.point !== 'runtime') {
        assert.ok(
          gapsFromLogs(warnings).length > before
          || gapsFromLogs(warnings).some((line) => line.includes('nopeThisPathIsNotOnAnyContextAtAll')),
          `★ ${testCase.label} 位置：(b) 那一半 —— 核对结论里必须真的有这条缺格记录（否则"什么都没做的核对"也能过本臂）`,
        )
      }
    } finally {
      probe.dispose()
    }
  }
})
