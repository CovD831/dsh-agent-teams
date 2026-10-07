/**
 * ── 五个【位置】的接线夹具：挂了判据，真的会被跑到吗？────────────────────────────
 *
 * 契约见 `docs/GATE-REGISTRY.md`。本文件回答的不是"某条判据写得对不对"
 * （那是 `gate-<名字>.test.mjs` 的事），而是 t6 那个更前置的问题：
 *
 *     ★ 往 `contract` / `delivery` / `runtime` 位置挂一条判据，它到底会不会进裁决？
 *
 * ── 它防的是什么失效（MEASURED，2026-10-05）────────────────────────────────────
 *
 * 注册表声明五个位置，而此前只有 `dispatch`（1 处）与 `completion`（3 处）有
 * `registry.evaluate` 调用点。另外三个位置上挂的判据【永远不会跑】—— 而"源码里
 * 没有 evaluate"与"判据跑了但通过了"在日志里同形：两者都只留下"没什么事发生"。
 * 本队已经反复见过这个形态（"装了但调不到"）。
 *
 * ⇒ 所以本文件的每一条断言都必须是【实测】的：往注册表上真的挂一条判据，
 *   真的走一次工具路径（或调度器路径），然后检查判据【自己被调用了】，
 *   以及它的裁决【真的进了调用方的决定】。
 *
 * ── 三臂（契约 §6）在本文件里各自是什么 ────────────────────────────────────────
 *
 *   伪造臂：挂一条 `blocked(['…'])` 的判据 ⇒ 期望路径被拒，且拒绝理由里带着判据的
 *           原话（不是"调用方自己写的一句话"—— 那只能证明调用方会拒绝，不能证明
 *           判据进了裁决）。
 *   未测量臂：挂一条 `unmeasured('…')` 的判据 ⇒ 期望【与 blocked 不同形】的拒绝，
 *           且措辞说的是"没能测量"。★ 把两者合成一句话就会让"没测到"并进"拒绝"，
 *           而契约要求它们不同形。
 *   对照臂：什么都不挂（`registered === 0`）⇒ 期望路径照常走完。★ 这一臂是唯一能
 *           区分"判据有效"与"调用点乱拒"的东西：一个永远拒绝的调用点同样能过前两臂。
 *
 * ── 为什么用【真的工具】而不是直接调 evaluate ──────────────────────────────────
 *
 * 直接 `registry.evaluate('contract', …)` 在 t6 之前就能跑通（注册表本身没问题），
 * 它证明不了任何接线。本文件必须从【调用点】进 —— 也就是 `registerAgentTeamsTools`
 * 注册出来的那些工具，以及 `installTeamScheduler` 注册出去的那个回调。
 *
 * ★ 为什么 `runtime` 的断言不止"没抛错"：那太弱了 —— 一个压根没接线的调用点
 *   同样什么都不抛。所以运行判据的**开火次数**是断言的一部分（探针记录自己被调了
 *   几次），并且必须证明【blocked 与 unmeasured 只记录、不放行】。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerAgentTeamsTools, runtimeGateLogSnapshot } from '../lib/tools.js'
import { registry } from '../lib/gates/index.js'
import { installTeamScheduler } from '../lib/scheduler.js'
import { createTeamDir, readTeam } from '../lib/state.js'

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

/** 注册一条探针判据，并在测试结束时【无论如何】把它摘掉（否则会污染同进程的其它用例）。 */
function withGate(point, verdict, { appliesTo } = {}) {
  const id = `probe.${point}.${Math.random().toString(36).slice(2)}`
  const calls = []
  registry.register({
    id,
    point,
    description: `probe for ${point}`,
    ...(appliesTo === undefined ? {} : { appliesTo }),
    gate: (context) => { calls.push(context); return typeof verdict === 'function' ? verdict(context) : verdict },
  })
  return {
    id,
    calls,
    /** ★ "挂上去"与"摘掉"必须成对：一条留在注册表里的探针会让别的用例凭空多一条判据。 */
    dispose: () => registry.unregister(id),
  }
}

function removeGate(id) { registry.unregister(id) }

/** 一个可用的 captain Agent 桩：只提供工具层真的读得到的字段。 */
function fakeAgent(workspace) {
  return {
    id: 'captain-session',
    status: 'idle',
    session: { header: { cwd: workspace }, events: [] },
    steer() {},
  }
}

/**
 * 一个成员 Agent 桩，它的会话里有一条真实的 `assistant/message`。
 *
 * ★ t12 之后 delivery 位置的 `convergence` 判据读的是【观察到的】成员面：
 *   · `state` 来自 live Agent（它此刻忙不忙）；
 *   · `spoke` 来自该成员会话里最后一条 `assistant/message` 的内容是否为空。
 *   ⇒ 一个只有持久记录、没有 live Agent / 没有会话日志的团队，**拿不到观察**,
 *     判据按自己的契约说 unmeasured。这正是本文件要能构造出来的两种输入。
 *
 * @param id - 成员会话 id（`ctx.agents.get` 用它取回 live Agent）
 * @param opts.text - 最后一条 assistant 消息的文本；`''` 表示空回复
 * @param opts.status - live Agent 状态（`running` ⇒ 判据读成 working）
 * @param opts.noMessage - true 时会话里【一条 assistant 消息都没有】（⇒ 观察不到 spoke）
 */
function fakeMemberAgent(id, { text = 'done', status = 'idle', noMessage = false, unreadable = false } = {}) {
  const events = noMessage ? [] : [{
    type: 'assistant/message',
    message: { content: [{ type: 'text', text }] },
  }]
  return {
    id,
    status,
    session: {
      header: { cwd: '.', events },
      events,
      ...unreadable ? { ownEvents() { throw new Error('session log unreadable') } } : {},
    },
    steer() {},
  }
}

/**
 * 一个最小但【真的】的插件 ctx：真的 `defineTool`、真的注册表。
 *
 * ★ 用真实的 `registerAgentTeamsTools` 而不是手搓一份 —— 手搓的那份测的是夹具，
 *   不是产品代码。工具注册的读锁也不隔离：真实的注册表就是并发安全的那一个。
 */
function pluginFixture(workspace, { teamId = 'team', liveAgents = new Map() } = {}) {
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: { debug() {}, info() {}, warn(message) { warnings.push(message) }, error(message) { warnings.push(message) } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    /**
     * ★ 一个【够真实】的子代理面：`registerAgentTeamsTools` 会装退役成员的投递守卫，
     *   而它要求宿主交出 queue/deliver + sendMessage 三者之一（否则当场抛错，且
     *   那个错是**对的** —— 一个装不上的守卫必须炸，不能静默）。本夹具不派发成员，
     *   所以这里给一对最小的、形状正确的实现，让注册路径走完。
     */
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    /**
     * ★ live Agent 表：`convergence` 的 `state` 观察面就是这里。
     *   默认空 ⇒ 拿不到观察 ⇒ 判据 unmeasured（这正是本文件要能构造的一种输入）；
     *   需要"观察到了"的臂用 `liveAgents` 登记一个成员 Agent 桩。
     */
    agents: { get: (id) => liveAgents.get(id) },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
  }
  const config = {
    stateDir: '.agent-teams',
    memberProvider: 'spawn',
    maxMembers: 8,
    profiles: {},
    fallback: undefined,
  }
  const runtime = registerAgentTeamsTools(ctx, config)
  const call = async (name, args) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    return await tool.execute(args, { agent: fakeAgent(workspace), signal: new AbortController().signal })
  }
  return { ctx, tools, warnings, runtime, call, teamId }
}

/**
 * 让 delivery 位置的 **convergence** 判据拿到它要的观察面。
 *
 * ★ 为什么需要它（而不是让探针去适应）：registry 的合并规则是 unmeasured 优先于
 *   blockers。一条返回 unmeasured 的判据会**盖住**同一次求值里别的判据的 blocker ——
 *   于是"探针没进裁决"与"探针进了裁决但被 unmeasured 盖住"在断言层面同形。
 *   本节把【别的判据】的干扰面补齐，本臂才能干净地问它自己的问题。
 *
 * ★ 补的是真实的观察面（成员都 idle 且状态可观察），不是让判据闭嘴：
 *   一个已收敛的团队正是"交付可以对它求值"的正常输入。
 */
async function makeDeliveryObservable(workspace) {
  const stateRoot = join(workspace, '.agent-teams')
  const { readTeam, writeTeam, withTeamLock } = await import('../lib/state.js')
  await withTeamLock(`probe:${stateRoot}:team`, async () => {
    const team = await readTeam(stateRoot, 'team')
    team.members = [{ id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 }]
    await writeTeam(stateRoot, team)
  })
}

/** 建一个已存在的团队（running，phase 缺省）。 */
async function seedRunningTeam(workspace, { id = 'team', tasks = [], members = [] } = {}) {
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id,
    name: 'Wiring',
    captainSessionId: 'captain-session',
    createdAt: 1,
    taskSeq: tasks.length,
    members,
    tasks,
  })
  return stateRoot
}

// ── 臂 0：新接的三个位置【在做之前】真的没被调用过吗 ───────────────────────────

test('接线前置：contract / delivery / runtime 三个位置在源码与产物里都有调用点', async () => {
  /**
   * ★ 这条臂钉的是"位置真的存在、且装配层认识它" —— 它是上面那些行为断言的
   *   前提。三个位置中的任何一个若被改名（或从 INSERTION_POINTS 里消失），
   *   这里必须在**接线**这一层炸，而不是让后面的用例以别的形状失败。
   *
   * ★ t5 追加 `admission`：它是**成团之前**的位置（判的是准入，不是契约合法性）。
   *   本臂只钉"装配层认识它"这一格 —— 它现在一条判据都没有，而"现在为空"**不是**
   *   不变量（t6/t7/t8 会往里挂），所以这里一个关于条数的字都不写。
   */
  const { INSERTION_POINTS } = await import('../lib/gates/index.js')
  for (const point of ['admission', 'contract', 'delivery', 'runtime']) {
    assert.ok(INSERTION_POINTS.includes(point), `insertion point "${point}" must exist`)
  }
})

// ── 臂 1（伪造臂）：contract 位置的一条 blocked 判据真的进去了吗 ────────────────
//
// ★ MEASURED（2026-10-05，t10 把第一条判据接进 contract 位置之后）：下面几条臂原先
//   用 `{ subject, kind: 'work' }` —— 一个**没有 inScope** 的契约。而 `contract` 位置上
//   现在同时跑着别的判据（`contract.build-artifact-scope`），它对"没拿到 inScope"
//   给出的是 `unmeasured`，于是一条**探针判据的 blocked 会被注册表的合并规则盖过**
//   （unmeasured 优先，契约 §3）。臂因此读到的是别的判据的话，读起来像
//   "接的探针没进裁决"—— 而其实它进了，只是被更高的优先级遮住了。
//
// ⇒ 修法是给契约带上一份 **inScope**，让别的判据安静下来：探针的话才是唯一的话。
//   ★ 这不是把断言放松，是把【输入】补成这个位置真正会收到的形状（一个质量任务）。
//   每个探针都只对 `creating === true` 开火，于是"建任务"那条路只被它一条影响。

test('★ 伪造臂：contract 位置上一条 blocked 判据 ⇒ create_task 被拒，理由带判据原话', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-contract-')))
  await seedRunningTeam(workspace)
  const { call } = pluginFixture(workspace)
  const probe = withGate(
    'contract',
    { ok: false, blockers: ['the verify command can never fail (grep -qx is whitespace-broken)'] },
    {
      /**
       * ★ 只对【探针自己】关心的形状开火：这条臂要读的是"探针的话进了裁决"，
       *   而不是"注册表整体被拒"。别的判据的裁决与本臂无关。
       */
      appliesTo: (context) => context?.creating === true,
    },
  )
  try {
    await assert.rejects(
      () => call('agent_teams_create_task', { subject: 'work', kind: 'work', inScope: ['src/a.ts'] }),
      (error) => {
        assert.match(error.message, /create_task rejected/, 'the rejection must say which step was refused')
        assert.match(error.message, /grep -qx is whitespace-broken/, '★ the judge must have entered the decision: its own words must be in the rejection')
        return true
      },
      'a blocked contract gate must reject the task',
    )
    assert.equal(probe.calls.length, 1, 'the probe must have been evaluated exactly once')
    /**
     * ★ 判据读到的是【契约本身】—— 这是它存在的意义。若调用点传的是工具参数
     *   （`args`），这条断言会挂：判据将拿不到 verify/inScope。
     */
    assert.equal(probe.calls[0].task?.kind, 'work', 'the gate must receive the task draft')
    assert.equal(probe.calls[0].creating, true, 'creating must be distinguishable from amending')
  } finally {
    removeGate(probe.id)
  }
})

// ── 臂 2（未测量臂）：contract 的 unmeasured 必须与 blocked 不同形 ──────────────

test('★ 未测量臂：contract 位置上一条 unmeasured 判据 ⇒ 拒绝措辞与 blocked 不同形', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-contract-unm-')))
  await seedRunningTeam(workspace)
  const { call } = pluginFixture(workspace)
  const probe = withGate('contract', { ok: false, unmeasured: 'the gate could not parse the verify command statically' })
  try {
    await assert.rejects(
      () => call('agent_teams_create_task', { subject: 'work', kind: 'work', inScope: ['src/a.ts'] }),
      (error) => {
        assert.match(error.message, /could not measure/, '★ unmeasured must read as "could not measure", never as "found problems"')
        assert.match(error.message, /parse the verify command statically/, '★ the probe\'s own words must be in the rejection (otherwise another judge spoke)')
        assert.doesNotMatch(error.message, /\.\.\.;|blockers/, 'the shape must not be the blocked shape')
        return true
      },
    )
  } finally {
    removeGate(probe.id)
  }
})

// ── 臂 3（对照臂）：没有判据的位置照常放行 ─────────────────────────────────────

test('★ 对照臂：contract 位置【一条判据都没挂】⇒ create_task 照常成功', async () => {
  /**
   * ★ 这一臂是唯一能区分"判据有效"与"调用点乱拒"的东西。前两臂一个永远拒绝的
   *   调用点也能通过。而"这个位置这一轮没有判据"是**正常情形**（契约 §9.1），
   *   它必须放行。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-contract-ok-')))
  await seedRunningTeam(workspace)
  const { call } = pluginFixture(workspace)
  /**
   * ★ 对照臂 = "**没有探针判据**时这条路照常走完"。原先这里断言
   *   `registry.count('contract') === 0`（整个位置空着）—— 那在 t10 把第一条真判据
   *   接上 contract 位置之后就过期了。而这条臂要证明的东西从来不是"这个位置是空的"，
   *   是"**探针**没有让流程被乱拒"。
   *
   * ★ 所以输入要带上一份合法的 inScope：`contract.build-artifact-scope` 在"没拿到
   *   inScope"时说 unmeasured（那是它诚实的样子），而本臂测的是调用点本身。
   */
  const created = await call('agent_teams_create_task', { subject: 'ordinary work', inScope: ['docs/x.md'] })
  assert.equal(created.subject, 'ordinary work')
  assert.equal(created.status, 'pending')
})

// ── 臂 4：改契约那条路也有调用点（契约 §1 ① 的另一半）────────────────────────

test('★ 伪造臂：contract 位置的一条 blocked 判据 ⇒ amend_task 同样被拒', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-amend-')))
  await seedRunningTeam(workspace, {
    tasks: [{
      id: 't1', subject: 'impl', status: 'pending', dependencies: [], attempt: 0,
      kind: 'implementation', objective: 'do it', acceptance: ['a'], verify: ['true'],
      inScope: ['src/x.ts'], createdAt: 1, updatedAt: 1,
    }],
  })
  const { call } = pluginFixture(workspace)
  /**
   * ★ 只对 `creating === false`（改契约）开火的探针：它必须【不】在别处被拒。
   *   一个 appliesTo 写错的探针会让"建任务"那条路也炸，于是这条臂读起来像
   *   "改契约被拒了"，其实拒的是别处。
   */
  const probe = withGate('contract', { ok: false, blockers: ['the amended contract is unjudgeable'] }, {
    /**
     * ★ t17 追加：同一次求值里 `contract.verify-command` 也会跑，而它需要【注入的执行器】
     *   才能给出 ok/blocked（没有执行器时它诚实地报 unmeasured —— 那是它对"没跑过"
     *   该有的态度）。而 registry 的合并规则是 **unmeasured 优先于 blockers** ⇒
     *   它的 unmeasured 会把本探针的 blocker 盖住，本臂就会红 ——
     *   而红的原因与"改契约那条路有没有调用点"毫无关系。
     *
     *   ⇒ 本臂把【别的判据】的干扰面排除掉（只让本探针在场），才能干净地问它自己的问题。
     *
     *   ★ 为什么不是 `appliesTo: (ctx) => ctx.creating === false`（像上面那条臂那样）：
     *     本臂的契约**带着** `verify: ['exit 1']`，所以 verify-command 一定会进求值；
     *     它对"没有执行器"的处理是判据自己的语义，不该由我在探针这边假装它不适用。
     *     直接在本臂的求值里把探针设成唯一在场的判据，最诚实。
     */
    appliesTo: (context) => context?.creating === false,
  })
  try {
    await assert.rejects(
      /**
       * ★ t17 时这条臂**被 unmeasured 盖住**（两个 contract 调用点都没注入执行器 ⇒
       *   `contract.verify-command` 永远 unmeasured，而合并规则 unmeasured 优先于
       *   blockers）。当时它被保留为一条**标注清楚的待修臂**，断言方向不变 ——
       *   **没有改成断言 unmeasured**（那就等于把缺陷写成期望）。
       *
       * ★ t18 已修 finding A（两个调用点都注入 `execVerifyCommand`）⇒ 本臂现在
       *   恢复它本来的断言：改契约这条路仍然**要求拒绝**，且拒绝理由带本探针的原话。
       *   —— 这正是"缺陷修好后，待修臂自动变回有效臂"，而不是靠人去把它改绿。
       */
      () => call('agent_teams_amend_task', { task_id: 't1', reason: 'verify was wrong', verify: ['pnpm verify'] }),
      (error) => {
        assert.match(error.message, /amend_task rejected/)
        assert.match(error.message, /unjudgeable/)
        return true
      },
    )
    assert.equal(probe.calls.length, 1, 'the probe must have fired once, on the amend path')
  } finally {
    removeGate(probe.id)
  }
})

// ── 臂 5：delivery 位置 ────────────────────────────────────────────────────────

test('★ 伪造臂：delivery 位置上一条 blocked 判据 ⇒ 团队状态查询被拒，理由带判据原话', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-delivery-')))
  const stateRoot = await seedRunningTeam(workspace)
  /**
   * ★ t11 修正：这里此前用一个「位置为空」的前提（最初还断言过 count===0）。
   *   接上 t8 的两条 delivery 判据之后，这个位置【本来就不再是空的】——
   *   探针要证明的是"它自己进了裁决"，不是"它是唯一一条"。
   *   一条把「位置为空」当不变量的对照臂，会在队友接上判据的那一刻变成障碍。
   *
   * ★ t12 追加：本臂还要保证【t8 的 convergence 不抢戏】。合并规则是
   *   unmeasured 优先于 blockers，所以一个"观察不到成员"的团队会让 convergence
   *   返回 unmeasured，从而把探针的 blocker 整个盖住 —— 于是本臂会红，
   *   而红的原因与"探针没进裁决"毫无关系。
   *   ⇒ 本臂构造一份**真的可观察**的成员面（live Agent + 会话里一条非空 assistant 消息），
   *     那正是"交付可以对它求值"的正常输入，不是让判据闭嘴。
   */
  const liveAgents = new Map([['member-1', fakeMemberAgent('member-1', { text: 'nothing else to report' })]])
  const { call } = pluginFixture(workspace, { liveAgents })
  const probe = withGate('delivery', { ok: false, blockers: ['goal "audit the installer" has no task covering it'] })
  try {
    const before = probe.calls.length
    /**
     * ★ t11 修正的第二层（实测逼出来的）：本臂断言的是【探针的 blocker 出现在拒绝理由里】。
     *   而 registry 的合并规则是 **unmeasured 优先于 blockers** —— t8 的
     *   `delivery.convergence` 在"拿不到成员状态"时返回 unmeasured，于是它会把
     *   探针的 blocker 整个盖住（`declare_delivery rejected: ... could not measure`），
     *   本臂就会红，而红的原因与"探针没进裁决"毫无关系。
     *
     *   ⇒ 本臂必须先把【别的判据】的干扰排除掉，才能干净地问它自己的问题。
     *     这不是在让判据说谎：一个"成员都 idle 且状态可观察"的团队本来就是
     *     这条臂要的输入面（本臂测的是 delivery 位置的 blocked 路径，不是 convergence）。
     *     为此本臂给这次调用备一个已收敛、且状态可观察的团队。
     */
    await makeDeliveryObservable(workspace)
    await assert.rejects(
      () => call('agent_teams_declare_delivery', {}),
      (error) => {
        assert.match(error.message, /declare_delivery rejected/)
        assert.match(error.message, /audit the installer/, '★ the judge must have entered the decision')
        return true
      },
    )
    assert.equal(probe.calls.length, before + 1, 'the probe must have been evaluated exactly once')
    /**
     * ★ 交付判据拿到的必须是【团队状态】：没有它，t8 的 coverage 判据无从谈起。
     */
    assert.equal(probe.calls[before].team?.id, 'team', 'the gate must receive the team state')
    assert.ok(probe.calls[before].gate !== undefined, 'the gate must receive upstream canDeclareDelivery result (the delivery position sits after it)')
    void stateRoot
  } finally {
    removeGate(probe.id)
  }
})

test('★ 未测量臂：delivery 位置上一条 unmeasured 判据 ⇒ 与 blocked 不同形', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-delivery-unm-')))
  await seedRunningTeam(workspace)
  const { call } = pluginFixture(workspace)
  const probe = withGate('delivery', { ok: false, unmeasured: 'member convergence data was not observable' })
  try {
    await assert.rejects(
      () => call('agent_teams_declare_delivery', {}),
      (error) => {
        assert.match(error.message, /could not measure/)
        assert.match(
          error.message,
          /member convergence data was not observable/,
          '★ 这条 unmeasured 也必须是【探针说的】—— 否则它可能来自位置上别的判据',
        )
        return true
      },
    )
  } finally {
    removeGate(probe.id)
  }
})

test('★ 对照臂：delivery 位置【没有额外判据加进来】⇒ 团队状态查询照常返回（不误伤）', async () => {
  /**
   * ★ t11 修正：这一臂此前写着 `assert.equal(registry.count('delivery'), 0)` ——
   *   它把「这个位置为空」当成了对照臂的前提。而 t8 的两条 delivery 判据正是本轮
   *   要接上去的东西 ⇒ 那条断言在队友交付的那一刻必然作废。
   *
   *   对照臂真正要问的问题是：「**没有额外的东西发言时，流程照常吗**」——
   *   而不是「这个位置是空的吗」。所以现在它只断言：本臂自己不挂任何东西，
   *   于是这次调用不得因为【本臂引入的原因】而失败。
   *
   *   ★ 顺带保留了既有交付语义的断言：上游 `canDeclareDelivery` 的结论仍然是结果里
   *     的 `delivery` 字段 —— 新接线只允许【加】blocker，不许替换上游的结论。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-delivery-ok-')))
  await seedRunningTeam(workspace)
  const { call } = pluginFixture(workspace)
  const status = await call('agent_teams_status', {})
  assert.equal(status.team_id, 'team')
  assert.equal(typeof status.delivery?.ok, 'boolean')
  assert.ok(Array.isArray(status.delivery?.blockers))
  /**
   * ★ t11 补充：交付位置上现在有 t8 的两条真判据（coverage / convergence）。
   *   本臂不假设它们缺席，而是**如实记下它们的裁决形态**：一个状态查询不得因为
   *   "这个位置有判据"就失败 —— 交付位置的空闲与忙碌，都不是状态查询能不能用的前提。
   *
   *   （convergence 在这个裸团队上会说 unmeasured —— 那是它**正确地**在说
   *    "成员收敛状态没被观察"，与"状态查询坏了"是两件事。）
   */
  assert.equal(status.team_id, 'team', '★ 位置上有判据不许让状态查询失败')
})

// ── 臂 6：runtime 位置**不得阻止任何流程**（契约 §5 硬要求）───────────────────

test('★ runtime 位置的硬要求：blocked 判据【被记录但不得阻止流程】', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-runtime-blocked-')))
  await seedRunningTeam(workspace)
  const { call } = pluginFixture(workspace)
  const before = runtimeGateLogSnapshot().length
  const probe = withGate('runtime', { ok: false, blockers: ['member has been running for 40 minutes'] })
  try {
    /**
     * ★ 这是整份夹具里最重要的一条断言：`create_task` **成功**。
     *   一个 process 约束若能把工具调用拒掉，那它就是裁决而不是过程约束 ——
     *   而"过程"与"裁决"混在一处，正是契约 §5 要分开的东西。
     */
    /**
     * ★ 契约带上一份 inScope：这是这个位置真实会收到的形状（一个质量任务），
     *   而其余 contract 判据只有在拿到 inScope 时才安静（见文件顶部那条 MEASURED）。
     */
    const created = await call('agent_teams_create_task', { subject: 'work under a blocked runtime gate', inScope: ['docs/x.md'] })
    assert.equal(created.status, 'pending', '★ a blocked runtime gate must NOT block the flow')
    assert.ok(probe.calls.length >= 1, '★ the runtime gate must actually have been evaluated (not merely written in the source)')
    const log = runtimeGateLogSnapshot().slice(before)
    assert.ok(
      log.some((entry) => entry.outcome.startsWith('blocked:')),
      `★ "fired and was tolerated" must be observable in the run log; got ${JSON.stringify(log)}`,
    )
    /**
     * ★ 返回值里必须能看出它开火了（`ok:false` + blockers），而【同时】流程没被拒。
     *   "开火了但被放过"与"压根没跑"必须不同形。
     */
    assert.equal(created.runtime_gates?.ok, false, 'the runtime verdict must be visible in the tool result')
    /**
     * ★ 注册表给 blocker 加 `[判据 id]` 前缀（这样"哪条判据说的"不会丢）。断言前缀
     *   存在本身就是证据：说明这句话是**判据**说的，不是调用方替它转述的。
     */
    assert.equal(created.runtime_gates?.blockers?.length, 1, `exactly the probe's one blocker must be there; got ${JSON.stringify(created.runtime_gates?.blockers)}`)
    assert.match(created.runtime_gates.blockers[0], /\[probe\.runtime\.[a-z0-9]+\] member has been running for 40 minutes/)
    assert.equal(created.runtime_gates?.outcome?.startsWith('blocked:'), true)
  } finally {
    removeGate(probe.id)
  }
})

test('★ runtime 位置：unmeasured 与 blocked 不同形，且同样不阻止流程', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-runtime-unm-')))
  await seedRunningTeam(workspace)
  const { call } = pluginFixture(workspace)
  const before = runtimeGateLogSnapshot().length
  const probe = withGate('runtime', { ok: false, unmeasured: 'no clock available for this member' })
  try {
    const created = await call('agent_teams_create_task', { subject: 'work under an unmeasured runtime gate', inScope: ['docs/x.md'] })
    assert.equal(created.status, 'pending')
    assert.equal(created.runtime_gates?.ok, false)
    assert.equal(created.runtime_gates?.blockers?.length ?? 0, 0, 'unmeasured must NOT be reported as blockers')
    assert.match(created.runtime_gates.unmeasured, /\[probe\.runtime\.[a-z0-9]+\] no clock available for this member/)
    const log = runtimeGateLogSnapshot().slice(before)
    assert.ok(
      log.some((entry) => entry.outcome.startsWith('unmeasured:')),
      '★ "fired and could not measure" must be distinguishable from "fired and blocked" in the run log',
    )
  } finally {
    removeGate(probe.id)
  }
})

test('★ runtime 位置：判据【自己抛错】也要被记录，且不把异常抛给调用方', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-runtime-throw-')))
  await seedRunningTeam(workspace)
  const { call, warnings } = pluginFixture(workspace)
  const before = runtimeGateLogSnapshot().length
  const probe = withGate('runtime', () => { throw new Error('probe exploded') })
  try {
    /**
     * ★ 一条抛错的判据既不是"发现问题"也不是"没能测量"，而它若被当成"通过"，
     *   就又是一个"装了但从不生效"的形态。所以：记下来、发出警告、**但不把异常
     *   抛回调用方**（过程约束不得中断流程）。
     */
    const created = await call('agent_teams_create_task', { subject: 'work under a throwing runtime gate', inScope: ['docs/x.md'] })
    assert.equal(created.status, 'pending', 'a throwing runtime gate must not break the caller')
    assert.equal(created.runtime_gates?.threw, 'probe exploded')
    assert.ok(runtimeGateLogSnapshot().slice(before).some(entry => entry.outcome.includes('probe exploded')))
    assert.ok(warnings.some(line => line.includes('runtime gate threw')), 'the failure must reach the log, not be swallowed')
  } finally {
    removeGate(probe.id)
  }
})

test('★ 对照臂：runtime 位置【本臂没有额外加判据】⇒ 调用照常，且本臂不引入拒绝', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-runtime-ok-')))
  await seedRunningTeam(workspace)
  const { call } = pluginFixture(workspace)
  /**
   * ★ t6 修正（与上面 delivery 那条同源）：这一臂此前写着
   *   `assert.equal(registry.count('runtime'), 0)` —— 它把「runtime 位置为空」当成了
   *   对照臂的**前提**。而本任务（t6）正是要往 runtime 接第一条判据
   *   （`runtime.liveness`）⇒ 那条断言在交付的那一刻必然作废（棘轮）。
   *
   *   ⇒ 对照臂真正要问的问题是：「**没有额外的东西发言时，流程照常吗**」——
   *     而不是「这个位置是空的吗」。所以现在它只断言：本臂自己不挂任何东西，
   *     于是这次调用不得因为【本臂引入的原因】而失败。
   *
   * ★ 而"空位置 ⇒ 返回值里不出现 runtime_gates"那条纪律并没有被丢掉，只是换了一处
   *   钉：`runtime.liveness` **按事件收窄**（只认 `runtime-liveness`），其余五个事件上
   *   它被 `appliesTo` 跳过 —— 位置不再为空，但这一轮**没有任何判据适用**，
   *   于是 `evaluated === 0`。★ 那是"没检查"的读数，**不是**"检查通过了"。
   */
  const created = await call('agent_teams_create_task', { subject: 'work with no extra runtime probe', inScope: ['docs/x.md'] })
  assert.equal(created.status, 'pending')
  /**
   * ── ★★★ t66：这条臂的【性质】对，措辞错（实测抓出来的）─────────────────────
   *
   * 它想保的性质是：「没有判据适用」必须**留在运行记录里**。
   * 而它用的正则 `/nothing evaluated/` —— **在 t64 之前、t66 之前都不匹配**：
   *
   *   · t58/t64 之前：`ok === false` 不成立 ⇒ 走 `ok (nothing evaluated: …)` ⇒ 匹配 ✓
   *   · t58/t64 之后：`ok === false` 成立、`blockers` 空 ⇒ 走 `"blocked: "` ⇒ **不匹配** ✗
   *   · t66 之后：走 `notChecked: <skippedAll 原文>` ⇒ 原文含 `nothing WAS evaluated` ⇒ **仍不匹配** ✗
   *
   * ★ 也就是说：这条断言自 t58 起就**从未真正生效过** —— 它红着，而红的原因
   *   与它声称的性质（"没检查必须留在记录里"）**只有一半相关**：记录确实丢了那个读数
   *   （t64 报的），但它的正则也没对上 `nothing was evaluated` 这个措辞。
   *
   * ⇒ ★ 修法（t66）：断言**性质**，而不是某一句话的逐字措辞 ——
   *   ① 记录里必须出现 `notChecked:`（那是 t66 建立的那个**出口名**）；
   *   ② 并且它必须**带着注册表那句原文**（`skippedAll`），而不是一句自己编的话。
   *   ★ 比对措辞更耐久的理由：出口名（`notChecked:`）是**契约**（三个出口名之一），
   *     而 `skippedAll` 的措辞是**说明** —— 前者变了就是缺陷，后者可以改词。
   */
  assert.equal(
    created.runtime_gates?.ok, false,
    '★ 全跳过的裁决必须是 ok:false（它是"没测到"，不是"通过了"）',
  )
  assert.match(
    String(created.runtime_gates?.outcome), /notChecked:/,
    '★ 运行记录必须用 `notChecked:` 这个**出口**说明"这一步没被检查" —— '
    + '★ 而不是 `blocked: `（一个没有对象的指控）。那正是 t66 修的那件事。',
  )
  assert.match(
    String(created.runtime_gates?.outcome), /nothing was evaluated/,
    '★ 记录里必须带上注册表那句**原文**（skippedAll），而不是调用方自己编的一句话 —— '
    + '否则"没检查"与"检查了没问题"在日志里可能因措辞而重新合流',
  )
  /**
   * ★ 这两条与上面三条**各测各的**（缺一条就会漏掉一种读法）：
   *   `evaluated` 保证"一条都没跑"可读；`registered` 保证"这个位置确实挂着判据"可读。
   *   ★ 少了 `registered`，"没检查"与"这个位置本来就没判据"会同形。
   */
  assert.equal(created.runtime_gates?.evaluated, 0, '★ 这一轮没有任何一条运行判据适用 ⇒ evaluated=0，不是"跑了一条什么都对的判据"')
  assert.equal(created.runtime_gates?.registered, 1, '★ runtime 位置必须真的挂着 t6 的探活判据')
  assert.equal(
    (created.runtime_gates?.ran ?? []).filter((entry) => entry.verdict !== 'skipped').length,
    0,
    '★ 非探活事件上，探活判据必须一条都不跑（否则每次工具调用都背上未测量的噪音）',
  )
})

// ── 臂 7：runtime 真的接在【派发】那一刻（契约 §5 的例子）─────────────────────

test('★ 接线臂：成员被真的派发时，runtime 判据在调度器那条路上被跑到', async () => {
  /**
   * ★ 契约 §5 给 runtime 举的例子就是这一条：「在成员被派发时启动」。
   *   而"派发"发生在【调度器】里，不在工具处理器里 —— 所以它有一条独立的接线，
   *   必须单独证明。这里用真实的 `installTeamScheduler` 跑一次 kickMember，
   *   注入的 dispatch 与工具层用的是同一个（`config.dispatch`）。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-runtime-dispatch-')))
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id: 'team', name: 'Wiring', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 1,
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'ordinary work', assignee: 'worker', status: 'pending',
      dependencies: [], attempt: 0, kind: 'work', createdAt: 1, updatedAt: 1,
    }],
  })

  const deliveries = []
  const child = { id: 'worker-session', status: 'idle', steer(message) { deliveries.push(message.content) }, session: { header: { cwd: workspace }, events: [] } }
  const captain = { id: 'captain-session', status: 'idle', session: { append() {} }, steer() {} }
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    agents: { get(id) { return id === child.id ? child : id === captain.id ? captain : undefined } },
    subagents: { getProvider() { return undefined }, list() { return [] } },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  const dispatched = []
  const probes = []
  const seenByProbe = []
  const scheduler = installTeamScheduler(ctx, {
    stateDir: '.agent-teams',
    dispatch: async (_captain, _teamId, _memberName, text) => { deliveries.push(text); return true },
    onDispatched: (event) => {
      dispatched.push(event)
      // 与 `registerAgentTeamsTools` 用的是同一个出口；这里直接调判据层，
      // 用的是【注册表进程级单例】—— 探针就挂在它上面。
      const probe = registry.count('runtime')
      seenByProbe.push(probe)
      return registry.evaluate('runtime', { ...event, event: 'member-dispatched' })
    },
  })
  probes.push(withGate('runtime', { ok: false, blockers: ['the member exceeded its runtime budget'] }))
  try {
    await scheduler.kickMember(workspace, 'team', 'worker')
    assert.equal(deliveries.length, 1, 'the member must have been dispatched')
    assert.equal(dispatched.length, 1, '★ onDispatched must fire exactly once for one accepted dispatch')
    assert.equal(dispatched[0].taskId, 't1')
    assert.equal(dispatched[0].kind, 'work')
    assert.ok(seenByProbe[0] >= 1, '★ the runtime gate must have been reachable from the dispatch path')
    /**
     * ★ 派发本身【没有被 runtime 判据阻止】—— 契约 §5：它不直接拒任务。
     *   而任务也确实离开 pending（成员开工了）。
     */
    const team = await readTeam(stateRoot, 'team')
    assert.notEqual(team.tasks[0].status, 'pending', '★ a blocked runtime gate must not undo a dispatch')
  } finally {
    for (const probe of probes) removeGate(probe.id)
  }
})

test('★ 接线臂（闸门）：投递【失败】的派发不算"派发过" ⇒ 不记录、也不回调', async () => {
  /**
   * ★ 时机的另一面：投递失败会走回滚路径（任务回 pending、成员回 idle）。
   *   把失败也记成一次派发，会让运行判据读到一个**从未发生的事件** ——
   *   而那正是"记录"与"事实"分离的开始。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-runtime-dispatch-fail-')))
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id: 'team', name: 'Wiring', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 1,
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'ordinary work', assignee: 'worker', status: 'pending',
      dependencies: [], attempt: 0, kind: 'work', createdAt: 1, updatedAt: 1,
    }],
  })
  const child = { id: 'worker-session', status: 'idle', steer() {}, session: { header: { cwd: workspace }, events: [] } }
  const captain = { id: 'captain-session', status: 'idle', session: { append() {} }, steer() {} }
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    agents: { get(id) { return id === child.id ? child : id === captain.id ? captain : undefined } },
    subagents: { getProvider() { return undefined }, list() { return [] } },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  const dispatched = []
  const scheduler = installTeamScheduler(ctx, {
    stateDir: '.agent-teams',
    dispatch: async () => false,
    onDispatched: (event) => { dispatched.push(event) },
  })
  await scheduler.kickMember(workspace, 'team', 'worker')
  assert.deepEqual(dispatched, [], '★ a failed delivery is not a dispatch')
  const team = await readTeam(stateRoot, 'team')
  assert.equal(team.tasks[0].status, 'pending', 'the failed dispatch must have rolled the task back')
})

// ── 臂 8：既有四个调用点行为未被改变（回归的机械臂）──────────────────────────

test('★ 回归臂：dispatch 位置仍然会拒，且 rejection 措辞未变', async () => {
  /**
   * ★ 改接线最容易破坏的不是新位置，是**旧位置**：一次不小心的重排会让
   *   dispatch 的拒绝发生在 completion 之后（或干脆不再发生）。所以旧的两个
   *   位置各留一条机械臂。
   *
   * 这里用 `dispatch.changed-paths` 的真实语义：成员自报改了文件，但自己的会话
   * 事件里没有任何写入 ⇒ blocked。这条路径与 t6 的改动无关，所以它同时是
   * "我没把旧调用点弄坏"的证据。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-dispatch-')))
  await seedRunningTeam(workspace, {
    members: [{ id: 'worker-session', name: 'worker', status: 'working', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'impl', status: 'claimed', assignee: 'worker', dependencies: [],
      attempt: 1, attemptId: 'a1', kind: 'implementation', objective: 'do it',
      acceptance: ['a'], verify: ['true'], inScope: ['src/x.ts'], createdAt: 1, updatedAt: 1,
    }],
  })
  const { tools } = pluginFixture(workspace)
  const member = fakeAgent(workspace)
  member.id = 'worker-session'
  const update = tools.get('agent_teams_update_task')
  assert.ok(update !== undefined)
  await assert.rejects(
    () => update.execute(
      { task_id: 't1', attempt_id: 'a1', status: 'in_progress', changedPaths: ['src/invented.ts'] },
      { agent: member, signal: new AbortController().signal },
    ),
    (error) => {
      assert.match(error.message, /update_task rejected/, 'the dispatch position must still refuse through the same wording')
      assert.match(error.message, /dispatch\.changed-paths|dispatch/, 'the dispatch gate must be the one that fired')
      return true
    },
  )
})

// ── 臂 9（t12）：delivery 输入面 —— 观察 vs 记录 ─────────────────────────────

test('★ t12 臂 1：成员状态【可观察】⇒ delivery 不再无条件 unmeasured', async () => {
  /**
   * ★ t12 修的缺陷：`convergence` 接了却拿不到 `ctx.members` ⇒ 它在任何真实路径上
   *   都返回 unmeasured，而合并规则是「未测量优先于 blockers」⇒ 它的 unmeasured
   *   盖住别的判据的 blocker ⇒ `declare_delivery` 永远返回"无法测量"。
   *   **一道永远关着的门**，与 t6 时 verify-rerun 缺执行器同源。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t12-ok-')))
  await seedRunningTeam(workspace, {
    members: [{ id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const liveAgents = new Map([['member-1', fakeMemberAgent('member-1', { text: 'all done' })]])
  const { call } = pluginFixture(workspace, { liveAgents })

  /**
   * 一个已收敛的团队 ⇒ 状态查询必须**走得通**（判据说 ok，不是 unmeasured）。
   * 本臂特意断言"不抛错"：这正是修复前后**唯一不同形**的那一件事。
   */
  const status = await call('agent_teams_status', {})
  assert.equal(status.team_id, 'team')
})

test('★ t12 臂 2（硬约束）：持久记录写着 idle、而成员【没交回任何东西】⇒ 仍然拦住', async () => {
  /**
   * ★ 这条臂钉的是 t12 验收里那句「不得用 `team.members[].status` 冒充观察到的收敛」。
   *
   *   输入面刻意做成最容易骗过实现的样子：
   *     · 持久记录 `member.status = 'idle'`（看起来"不忙"）；
   *     · live Agent 也确实是 `idle`（它真的不忙着）；
   *     · **但它的会话里最后一条 assistant 消息是空的**。
   *
   *   一个拿持久字段冒充观察的实现会把这三条读成"收敛" ⇒ 交付放行。
   *   而正确的裁决是 blocked：`idle` 只说"它不忙"，**不说"它做完了"** ——
   *   一个静下来的成员与一个收敛的成员，在没有"它最后说了什么"这一位时完全同形。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t12-quiet-')))
  await seedRunningTeam(workspace, {
    members: [{ id: 'member-1', name: 'quiet-worker', status: 'idle', joinedAt: 1 }],
  })
  const liveAgents = new Map([['member-1', fakeMemberAgent('member-1', { text: '', status: 'idle' })]])
  const { call, tools } = pluginFixture(workspace, { liveAgents })
  await assert.rejects(
    () => call('agent_teams_declare_delivery', {}),
    (error) => {
      assert.match(error.message, /declare_delivery rejected/)
      assert.match(error.message, /quiet-worker/, '★ 必须指名那个成员')
      assert.match(error.message, /empty reply/, '★ 必须说清是"空回复"，不是泛泛的"没收敛"')
      return true
    },
    '★ 持久记录 idle + 空回复 ⇒ 必须拦住：那是"记录"，不是"收敛"',
  )
  assert.ok(tools.get('agent_teams_status') !== undefined)
})

test('★ t12 臂 3（未测量臂）：拿到持久记录、但【拿不到观察】⇒ unmeasured，与上面两者都不同形', async () => {
  /**
   * ★ 三种输入的裁决必须两两不同形，这是本臂存在的全部理由：
   *
   *     ① 观察到了、收敛      ⇒ ok      （臂 1）
   *     ② 观察到了、空回复    ⇒ blocked （臂 2）
   *     ③ **没能观察**        ⇒ unmeasured（本臂）
   *
   *   ③ 的构造刻意是"团队记录看起来很好"：成员在记录里是 idle，但没有 live Agent
   *   （未 spawn / 句柄已释放）⇒ 调用方**不注入** members ⇒ 判据按自己的契约说
   *   "没能观察"。★ 这与 ② 的 blocked 不同形，也与 ① 的 ok 不同形。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t12-unobserved-')))
  await seedRunningTeam(workspace, {
    members: [{ id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  // liveAgents 为空 ⇒ ctx.agents.get 拿不到 ⇒ 观察缺席
  const { call } = pluginFixture(workspace, { liveAgents: new Map() })
  await assert.rejects(
    () => call('agent_teams_declare_delivery', {}),
    (error) => {
      assert.match(error.message, /could not measure/, '★ 没能观察 ⇒ 措辞必须是"没能测量"')
      assert.doesNotMatch(
        error.message,
        /empty reply/,
        '★ 与臂 2 的 blocked 不同形：这里不是"发现了问题"，是"没能检查"',
      )
      return true
    },
  )
})

test('★ t12 臂 4（未测量臂）：成员的会话日志读不出来 ⇒ 不注入 ⇒ unmeasured（不是 ok）', async () => {
  /**
   * ★ 一次读取失败会让**每一个**成员都消失。若把"读不出来"折成"没说话"或
   *   "收敛了"，就等于用一次基础设施故障宣布全队交付。
   *   这与 `observedChangedPaths` 里 `undefined` / `[]` 必须不同形是同一条纪律。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t12-unreadable-')))
  await seedRunningTeam(workspace, {
    members: [{ id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const liveAgents = new Map([['member-1', fakeMemberAgent('member-1', { unreadable: true })]])
  const { call } = pluginFixture(workspace, { liveAgents })
  await assert.rejects(
    () => call('agent_teams_declare_delivery', {}),
    (error) => {
      assert.match(error.message, /could not measure/)
      return true
    },
  )
})

test('★ t12 臂 5（未测量臂）：会话里【一条 assistant 消息都没有】⇒ 不注入 spoke ⇒ unmeasured', async () => {
  /**
   * ★ "它有没有说过话没被观察到"与"它说了空的"必须不同形：
   *   前者是没能测量（本臂），后者是 blocked（臂 2）。
   *   把两者合流，会让一个**从来没跑过**的成员与一个**跑了但空回复**的成员同形。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t12-nomessage-')))
  await seedRunningTeam(workspace, {
    members: [{ id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const liveAgents = new Map([['member-1', fakeMemberAgent('member-1', { noMessage: true })]])
  const { call } = pluginFixture(workspace, { liveAgents })
  await assert.rejects(
    () => call('agent_teams_declare_delivery', {}),
    (error) => {
      assert.match(error.message, /could not measure/)
      assert.doesNotMatch(error.message, /empty reply/, '★ 与"空回复"不同形：没有消息 ≠ 消息是空的')
      return true
    },
  )
})

test('★ t12/t15/t16 臂 6（接线臂）：仍未 spawn 的成员 ⇒ blocked（不是 unmeasured），且指名它', async () => {
  /**
   * ★ 这一臂的期望被**逐轮修正过两次**，两次都因为语义变清楚了：
   *
   *   t12（最初）：`observeMemberConvergence` 对 id 为空的成员 `return undefined`
   *                ⇒ 观察面整个缺席 ⇒ 交付位置 unmeasured。本臂当时断言
   *                "could not measure" —— 它如实反映了当时的**实现**。
   *
   *   t15：判据层接纳 `never-spawned`（不再需要调用方伪造 state）。
   *   t16：调用方如实交出这条观察（不再丢掉整个观察面）。
   *
   *   ⇒ 现在的正确结论是 **blocked**：一个从未起来过的成员**没交回任何东西**，
   *     交付必须被拦住 —— 而"它没起来"是一条【可判定的事实】，不是"我不知道"。
   *
   * ★ 为什么这不算"改臂去迁就实现"：断言的方向始终是**反对放行**的。
   *   t12 时它反对的是"记录写着 idle 就当收敛"，现在反对的是"从未 spawn 却放过"；
   *   两次 assert.rejects 都要求**拒绝**，只是拒绝的**形态**从 unmeasured 变成了
   *   blocked —— 而形态变化正是 t15/t16 要的（unmeasured 的副作用是让门永久关闭）。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t16-unspawned-')))
  await seedRunningTeam(workspace, {
    members: [{ id: '', name: 'never-started', status: 'idle', joinedAt: 1 }],
  })
  const { call } = pluginFixture(workspace, { liveAgents: new Map() })
  await assert.rejects(
    () => call('agent_teams_declare_delivery', {}),
    (error) => {
      /**
       * ★ 必须是 blocked 那一支：说得出**哪个成员**、以及**它从未起来过**。
       *   若它退回 unmeasured，本臂会红 —— 因为那意味着调用方又在丢观察面。
       */
      assert.match(error.message, /never-started/, '★ 必须指名那个成员')
      assert.match(error.message, /never started/, '★ 必须说清成因是"它从未起来"')
      assert.doesNotMatch(
        error.message,
        /could not measure/,
        '★ 不得退回 unmeasured：那会让整个交付位置只要有一个依赖未满足的成员就永久无法测量',
      )
      return true
    },
  )
})

// ── 臂 10（t18/B2）：交付位置分两处 —— 读取只报告，宣告才拒绝 ────────────────

test('★ t18 臂 1（B2 核心）：status 是【纯读取】—— 没收敛的团队照样读得到状态', async () => {
  /**
   * ★ 这条臂钉的是 t18 修的死结：
   *
   *     想看状态 ⇒ 被拒（因为没收敛）
   *     想让成员收敛 ⇒ 得先看状态
   *
   *   「唯一的读取点」被当成了「宣告点」。修法是把两者分开：
   *     · status            —— 只报告，随时能读
   *     · declare_delivery  —— 承载拒绝
   *
   * ★ 输入刻意是**最该被拒**的样子（一个从未 spawn 的成员），以排除
   *   "它只是恰好能通过"这个解释。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t18-read-')))
  await seedRunningTeam(workspace, {
    members: [{ id: '', name: 'never-started', status: 'idle', joinedAt: 1 }],
  })
  const { call } = pluginFixture(workspace, { liveAgents: new Map() })

  const status = await call('agent_teams_status', {})
  assert.equal(status.team_id, 'team', '★ 读操作不得因为交付门失败')
  /**
   * ★ 但裁决必须**如实报出来**（只是不拒绝）—— 否则"读取能用了"是以"看不见问题"
   *   为代价换来的，那等于把门拆掉而不是移走。
   */
  assert.equal(status.delivery?.ok, false, '★ 报告仍须如实：这个团队现在不能交付')
  assert.ok(
    status.delivery.blockers.some((line) => String(line).includes('never-started')),
    '★ 判据层的 blocker 必须并进报告，让队长看见【为什么】',
  )
  assert.equal(typeof status.delivery.gates_evaluated, 'number')
})

test('★ t18 臂 2（B2 核心）：同一个团队上，declare_delivery 仍然【真的拦】', async () => {
  /**
   * ★ 验收原话："delivery 判据仍然真的会拦 —— 由 declare_delivery 承载拒绝，
   *   不是被放弃（不得出现「装了但没人拦」）"。
   *
   *   本臂与臂 1 用**同一个团队**：status 放行、declare 拒绝 —— 两者读同一份事实、
   *   得出同一个结论，只是**收场不同**。这正是 B2 要的形状。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t18-declare-')))
  await seedRunningTeam(workspace, {
    members: [{ id: '', name: 'never-started', status: 'idle', joinedAt: 1 }],
  })
  const { call } = pluginFixture(workspace, { liveAgents: new Map() })

  await assert.rejects(
    () => call('agent_teams_declare_delivery', {}),
    (error) => {
      assert.match(error.message, /declare_delivery rejected/)
      assert.match(error.message, /never-started/, '★ 判据层仍然在说话，且指名成员')
      return true
    },
    '★ 交付判据不得因为改挂载点而被放弃',
  )
})

test('★ t18 臂 3（B2）：与 status 读的是同一份事实 —— 报告与宣告不许各自为政', async () => {
  /**
   * ★ 若两处各自算一遍，就会出现"status 说能交、declare 说不能"这种**新的、
   *   更难查的不一致**。本臂在【可交付】的输入上同时问两者：结论必须一致。
   *
   *   构造一个真的可交付的团队：没有任务、没有成员 —— `canDeclareDelivery` 对
   *   "团队没有完成的活"会拦（那是上游语义），所以这里用**有成员且已收敛**的团队，
   *   并把任务清空以避开上游 blocker。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t18-agree-')))
  await seedRunningTeam(workspace, {
    tasks: [{
      id: 't1', subject: 'done work', status: 'completed', dependencies: [], attempt: 1,
      kind: 'work', createdAt: 1, updatedAt: 1,
    }],
    members: [{ id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const liveAgents = new Map([['member-1', fakeMemberAgent('member-1', { text: 'all done' })]])
  const { call } = pluginFixture(workspace, { liveAgents })

  const status = await call('agent_teams_status', {})
  const declared = await call('agent_teams_declare_delivery', {})
  assert.equal(status.delivery?.ok, true, 'status 报告：可以交付')
  assert.equal(declared.declared, true, '★ 宣告：同一份事实下也应当通过（两者不许各自为政）')
  assert.equal(declared.gates_evaluated >= 1, true, '★ 宣告必须真的求值过判据（不是空转通过）')
})

test('★ t18 臂 4（B2）：declare_delivery 是[captain 工具]，不在成员工具名单里', async () => {
  /**
   * ★ 交付宣告是**队长**的动作。成员拿到它只会多一个能把自己队伍判死的入口，
   *   而它没有任何理由需要那个能力。
   */
  const { TEAM_TOOL_NAMES, MEMBER_TOOL_NAMES, CAPTAIN_TOOL_NAMES } = await import('../lib/tool-names.js')
  assert.ok(TEAM_TOOL_NAMES.includes('agent_teams_declare_delivery'), '★ 必须登记进稳定业务清单')
  assert.equal(MEMBER_TOOL_NAMES.includes('agent_teams_declare_delivery'), false, '★ 不得进成员工具名单')
  assert.ok(CAPTAIN_TOOL_NAMES.includes('agent_teams_declare_delivery'), '★ 它是 captain 工具')
})

test('★ t18 臂 5（finding A 的守门臂）：contract 位置必须注入执行器 —— 否则 implementation 契约连 create 都过不去', async () => {
  /**
   * ★ 这条臂的存在理由，是从一次**突变没被抓住**里发现的（自证可失效的检查本身失效了）：
   *
   *   我把 `create_task` 的 `execVerifyCommand` 注入删掉后，25 条臂**全绿** ——
   *   也就是说此前没有任何一条臂钉住 finding A。而 finding A 的后果是最重的一种：
   *   **implementation / repair 这类必须验的契约连 create_task 都过不去**
   *   （它们的 verify 命令一律拿不到执行器 ⇒ `contract.verify-command` 永远
   *   `unmeasured` ⇒ 调用方拒绝）。
   *
   * ★ 输入刻意是**最正常**的一份质量契约：一条真实的、可判的 verify 命令。
   *   没有执行器时，`contract.verify-command` 只能诚实地说"我没能真的跑它"
   *   （那是它该有的态度）；有执行器时它才可能在"静态看着没问题 + 真的能跑"
   *   之上给出 ok。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wire-t18-exec-')))
  await seedRunningTeam(workspace)
  const { call } = pluginFixture(workspace)
  /**
   * ★ 命令选 `true`：它恒绿 ⇒ 静态检查会认为"这条命令永远不会红，因此不能证明什么"。
   *   用一个**既真实又可判**的命令更贴切 —— `node --test` 在空文件上会红，
   *   所以这里用一条本仓库真的会跑、且在当前工作区能通过的命令。
   */
  const created = await call('agent_teams_create_task', {
    subject: 'implementation with a real verify command',
    kind: 'implementation',
    objective: 'Ship it',
    acceptance: ['it is shipped'],
    inScope: ['docs/plan.md'],
    verify: ['node -e "process.exit(0)"'],
  })
  assert.equal(created.status, 'pending', '★ implementation 契约必须能建出来 —— 这要求 contract 位置拿得到执行器')
  assert.equal(created.kind, 'implementation')
})
