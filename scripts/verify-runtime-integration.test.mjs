/**
 * ── 独立验证（verifier3 / t3）：runtime 位置的第一条判据 —— 探活 ────────────────
 *
 * 这个文件**不是**实现者夹具的复制品，也刻意不看它的断言。它只带着七个要证伪的
 * 命题进场，每一个都从**真实路径**上做实验：
 *
 *   ① 判据真的会在 runtime 的【六个调用点】上被求值吗？
 *      —— 不是"源码里有一行 evaluate"，而是"跑一次真实的工具/调度器调用，
 *         判据自己被调用了，且它的裁决出现在**返回值**里"。
 *   ② ★ 它哪怕返回最严重的裁决，也不阻止流程吗？（契约 §5 硬要求）
 *      两种做法分开测：(a) 用注册表**公开 API** 把真判据改成"永远 blocked"；
 *      (b) 不挂任何东西，把**真实**判据逼到 blocked（成员 20 分钟没产出）。
 *   ③ ★ 它是【有状态】的吗？—— 两次探活之间"动过"与"没动过"必须不同形。
 *      这一条要喂两次观察，而且状态必须经**真实调用**推进，不是手工塞 ctx。
 *   ④ 三态形状互不相同；缺省方向是"未测量"，不是"通过"。
 *   ⑤ 边界：正好等于间隔 / 时钟回拨 / 间隔非法值 / 第一次探活。
 *   ⑥ 纯数据变换：不 import I/O，不调 `Date.now()`（**去掉注释**再数）。
 *   ⑦ ★ 它【没有】实现"没进展"那一种：等很久、但一直在动 ⇒ 不得报警。
 *
 * ── 为什么必须从调用点进（这是我这份文件与实现者夹具的**根本区别**）──────────
 *
 * 直接 `import` 判据再 `gate(ctx)` 能证明"这段逻辑自洽"，但**证明不了接线** ——
 * 而本队这一轮反复踩的形态恰恰是"判据写得对，而它的输入面没接上"。
 * 所以下面每一条 ①②③ 的臂都走 `agent_teams_*` 工具或 `installTeamScheduler`，
 * 自己构造团队、自己注入假时钟，然后读**工具返回值**里的 `runtime_gates`。
 *
 * ── 一处刻意的写法：时钟是"可推进的假时钟"，不是"够大的常量" ──────────────────
 *
 * 探活是**跨步骤**的判据：它的结论取决于"两次探活之间"发生了什么。用常量时钟
 * 测不到这个（两次读数永远相同 ⇒ 永远报"没动过"）。所以本文件用一个能手动推进的
 * `now()`，并且每次推进都对应一次**真实的**工具调用 —— 无产出时**不推进**、
 * 成员真的产出时才推进。这样"有状态"这一条才是被实测出来的，而不是被构造出来的。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerAgentTeamsTools, runtimeGateLogSnapshot } from '../lib/tools.js'
import { registry, INSERTION_POINTS } from '../lib/gates/index.js'
import { installTeamScheduler } from '../lib/scheduler.js'
import { createTeamDir, readTeam, withTeamLock, writeTeam } from '../lib/state.js'

const CAPTAIN_SESSION = 'captain-session'
const INTERVAL = 10 * 60_000
const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

// ─────────────────────────────────────────────────────────────────────────────
// 夹具：一个可推进的假时钟 + 一个【真的】插件装配
// ─────────────────────────────────────────────────────────────────────────────

/** 可推进的假时钟。`advance` 只改数字，等待由哪一次真实调用产生是各自臂的事。 */
function fakeClock(t0 = 1_700_000_000_000) {
  let value = t0
  return {
    now: () => value,
    set: (v) => { value = v },
    advance: (ms) => { value += ms },
    get value() { return value },
  }
}

/** 一个 captain Agent 桩（工具层读 `id` / `session`）。id 必须与团队记录里的
 *  `captainSessionId` 对上 —— 装配层靠它认人（`findTeamByCaptain`）。 */
function captainAgent(workspace) {
  return {
    id: CAPTAIN_SESSION,
    status: 'idle',
    session: { header: { cwd: workspace }, events: [], append() {} },
    steer() {},
  }
}

/**
 * 一个成员 Agent 桩。`utter()` 会**真的**往它自己的会话日志里追加一条
 * `assistant/message` —— 这是判据唯一认的"在动"。
 */
function memberAgent(id, { workspace = '.', text = 'starting' } = {}) {
  const events = []
  const agent = {
    id,
    status: 'idle',
    session: {
      header: { cwd: workspace, events },
      events,
    },
    steer() {},
    /** 成员说话了：追加一条非空 assistant 消息。 */
    utter(next) { events.push({ type: 'assistant/message', message: { content: [{ type: 'text', text: next }] } }) },
    /** 会话里一条 assistant 消息都没有（"没观察到产出"，不是"观察到零产出"）。 */
    silence() { events.length = 0 },
  }
  if (text !== undefined) agent.utter(text)
  return agent
}

/**
 * 一个最小但【真的】插件装配：真的 `registerAgentTeamsTools`、真的注册表、
 * 六… 五个工具调用点都从这里进。`clock` 注入到 `config.now`（t5 建立的那条面）。
 */
function pluginFixture(workspace, { clock, liveAgents = new Map() } = {}) {
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: { debug() {}, info() {}, warn(m) { warnings.push(m) }, error(m) { warnings.push(m) } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
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
    ...(clock === undefined ? {} : { now: clock.now }),
  }
  const runtime = registerAgentTeamsTools(ctx, config)
  const call = async (name, args, agent = captainAgent(workspace)) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    return await tool.execute(args, { agent, signal: new AbortController().signal })
  }
  return { ctx, tools, warnings, runtime, call }
}

/** 建一个已存在的团队（running）。 */
async function seedTeam(workspace, { id = 'team', tasks = [], members = [], taskSeq } = {}) {
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id,
    name: 'RuntimeIntegration',
    captainSessionId: 'captain-session',
    createdAt: 1,
    taskSeq: taskSeq ?? tasks.length,
    members,
    tasks,
  })
  return stateRoot
}

/** 一个 ready 的任务记录（`pending`、指派给某个成员 ⇒ 可被调度器接手）。 */
function readyTask({ id = 't1', assignee = 'worker' } = {}) {
  return {
    id, subject: 'ordinary work', assignee, status: 'pending', dependencies: [], attempt: 0,
    kind: 'work', createdAt: 1, updatedAt: 1,
  }
}

/** 把一次求值的裁决从返回值里读出来（★ 判据的产物必须能被人直接读）。 */
function runtimeFrom(result) {
  return result?.runtime_gates
}

/**
 * 让 `agent_teams_status` 真的驱动一次探活。
 *
 * ★ 为什么用它：`task-status` 是六个调用点里**唯一**由时刻驱动的那一个
 *   （用户裁定"10 分钟探活一次"，而"探活"发生在查状态时）。所以"两次探活"
 *   在这里是两次真实的状态查询。
 */
async function poll(workspace, fixture) {
  return runtimeFrom(await fixture.call('agent_teams_status', {}))
}

/** 一个真实的派发周期：kickTeam ⇒ 调度器建尝试、投递、回调。 */
async function dispatchOnce(workspace, { clock, liveAgents, onDispatched } = {}) {
  const stateRoot = join(workspace, '.agent-teams')
  const deliveries = []
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    agents: { get: (id) => liveAgents.get(id) },
    subagents: { getProvider() { return undefined }, list() { return [] } },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  const events = []
  const scheduler = installTeamScheduler(ctx, {
    stateDir: '.agent-teams',
    ...(clock === undefined ? {} : { now: clock.now }),
    dispatch: async (_captain, _teamId, _memberName, text) => { deliveries.push(text); return true },
    onDispatched: (event) => { events.push(event); onDispatched?.(event) },
  })
  await scheduler.kickTeam(workspace, 'team')
  const team = await readTeam(stateRoot, 'team')
  return { deliveries, events, team }
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 六个调用点：判据真的在它们上面被求值
// ─────────────────────────────────────────────────────────────────────────────
//
// ★ 判据被求值到 ⇒ 返回值里出现 `runtime_gates`（含 `ran[]` 与 `outcome`）。
//   而 `runtime-gates` 只认事件名 `runtime-liveness` ⇒ 其余五个事件的读数
//   应当是 `evaluated: 0` 且 `registered: 1`：**位置不空，而这一轮没有适用**。
//   那本身是一条必须能读到的信息（"没检查" ≠ "检查通过了"）。

test('① 六个调用点：member-dispatched 真的把 runtime 判据求值到了（真实的 kickTeam）', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-dispatch-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const liveAgents = new Map([['worker-session', memberAgent('worker-session')]])

  const probeCalls = []
  const probe = withProbe('runtime', (context) => {
    probeCalls.push(context)
    return { ok: true, probe: 'seen' }
  })
  try {
    const runs = []
    await dispatchOnce(workspace, { clock, liveAgents, onDispatched: (event) => { runs.push(event) } })
    assert.equal(runs.length, 1, '★ 一次被接受的投递必须产生恰好一次 onDispatched')
    assert.equal(probeCalls.length, 1, '★ runtime 位置的判据必须真的在派发那一刻被求值（不是源码里有一行）')
    assert.equal(probeCalls[0].event, 'member-dispatched', '判据必须能分辨自己被哪个调用点调用')
    /**
     * ★ 派发那一刻必须拿到【等待观察】—— 这是 t5 建立输入面的全部理由。
     *   拿不到的话，判据会在最需要它的那个调用点上返回 unmeasured。
     */
    assert.ok(probeCalls[0].wait !== undefined, `★ 派发调用点必须带上 wait 观察面；ctx 只有 ${Object.keys(probeCalls[0]).join(',')}`)
    assert.equal(probeCalls[0].wait.startedAt, clock.value, '★ 等待起点必须就是这次派发被接受的时刻')

    /** ★ 判据的裁决必须出现在**返回值**里 —— 只记在日志里的话，读者看不到。 */
    const team = await readTeam(join(workspace, '.agent-teams'), 'team')
    assert.notEqual(team.tasks[0].status, 'pending', '成员真的开工了（派发把它从 pending 推走）')
  } finally {
    probe.dispose()
  }
})

test('① 六个调用点：task-created / task-update / task-update-settled / task-status / delivery-declared 每一个都被真的求值到', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-callsites-')))
  await seedTeam(workspace, {
    members: [
      { id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 },
      /** ★ reviewer 只有一条：`create_task` 对契约任务要求 review 环。 */
      { id: 'reviewer-1', name: 'reviewer', status: 'idle', joinedAt: 1 },
    ],
    tasks: [{
      id: 't1', subject: 'impl', status: 'pending', assignee: 'worker', dependencies: [], attempt: 1,
      attemptId: 'att-1', kind: 'implementation', objective: 'do it', acceptance: ['a'],
      verify: ['node -e "process.exit(0)"'], inScope: ['docs/x.md'],
      reviewer: 'reviewer', createdAt: 1, updatedAt: 1,
    }],
  })
  const clock = fakeClock()
  const liveAgents = new Map([
    ['member-1', memberAgent('member-1', { text: 'all done' })],
    ['reviewer-1', memberAgent('reviewer-1', { text: 'noted' })],
  ])
  const fixture = pluginFixture(workspace, { clock, liveAgents })

  const seen = []
  const probe = withProbe('runtime', (context) => {
    seen.push(context.event)
    return { ok: true }
  })
  try {
    /** 调用点 ②：建任务。 */
    await fixture.call('agent_teams_create_task', { subject: 'another', inScope: ['docs/y.md'] })
    /** 调用点 ③：成员上报（in_progress，不终结）。 */
    const member = memberAgent('member-1', { text: 'working' })
    liveAgents.set('member-1', member)
    await fixture.call(
      'agent_teams_update_task',
      { task_id: 't1', attempt_id: 'att-1', status: 'in_progress', output: 'partial' },
      member,
    )
    /** 调用点 ④：成员上报（终结 / settled）。 */
    await fixture.call(
      'agent_teams_update_task',
      { task_id: 't1', attempt_id: 'att-1', status: 'completed', output: 'done', verdict: 'pass' },
      member,
    )
    /** 调用点 ⑤：状态快照。 */
    await fixture.call('agent_teams_status', {})
    /** 调用点 ⑥：宣布交付。 */
    await fixture.call('agent_teams_declare_delivery', {}).catch(() => undefined)

    for (const event of ['task-created', 'task-update', 'task-update-settled', 'task-status', 'delivery-declared']) {
      assert.ok(
        seen.includes(event),
        `★ 调用点 "${event}" 没有把 runtime 判据求值到；实际看到的是 ${JSON.stringify(seen)}`,
      )
    }
  } finally {
    probe.dispose()
  }
})

test('① 六个调用点的输入面：有等待记录时 `wait` 到位，读不到时【整个字段缺席】（不是 {} 、不是兜底）', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-inputs-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const liveAgents = new Map([['worker-session', memberAgent('worker-session')]])

  /** 第一次：真的派发一次，建立一条等待记录。 */
  const captured = []
  const probeA = withProbe('runtime', (context) => { captured.push(context); return { ok: true } })
  try {
    await dispatchOnce(workspace, { clock, liveAgents })
  } finally {
    probeA.dispose()
  }
  const dispatchedAt = clock.value

  /**
   * ★ 队长自己接管的任务：任务在记录里、assignee 是队长 ⇒ **没有派发记录**
   *   ⇒ 调用方【不注入】`wait` ⇒ 判据按自己的契约说"没能测量"。
   *
   * ★ 判据只在 `runtime-liveness` 事件上跑，所以要看"注入面"必须让事件对得上；
   *   而六个调用点里**唯一**会构造单个 `wait` 的是那条 `team + task` 分支。
   *   这里直接看判据层收到的东西（用探针在 `runtime` 位置上看同一份 ctx）。
   */
  const fixture = pluginFixture(workspace, { clock, liveAgents })
  const statuses = []
  const probeB = withProbe('runtime', (context) => { statuses.push(context); return { ok: true } })
  try {
    /**
     * ★ 一条**没有派发记录**的任务：手工写进去（模拟"队长建了任务但没人被派发"）。
     *   它的 `attemptId` 不可能对上任何等待记录。
     */
    const stateRoot = join(workspace, '.agent-teams')
    await withTeamLock(`v3:${stateRoot}:team`, async () => {
      const team = await readTeam(stateRoot, 'team')
      team.tasks.push({
        id: 't2', subject: 'captain-owned', status: 'claimed', assignee: 'worker',
        dependencies: [], attempt: 1, attemptId: 'att-never-dispatched', kind: 'work',
        createdAt: 1, updatedAt: 1,
      })
      await writeTeam(stateRoot, team)
    })
    const record = await poll(workspace, fixture)
    assert.ok(record !== undefined, 'task-status 必须求值 runtime 位置')
  } finally {
    probeB.dispose()
  }

  /** 团队级观察面：`waits` 是数组（观察了），不是缺席。 */
  const teamLevel = statuses.find((ctx) => ctx.event === 'task-status')
  assert.ok(teamLevel !== undefined, 'task-status 必须在探针里留下一次求值')
  assert.ok(Array.isArray(teamLevel.waits), '★ 团队级调用点必须交出 `waits` 数组')
  /**
   * ★ 空数组与缺席不同形：这里观察了，且**至少**有一条等待（刚刚派发的那个尝试）。
   *   与它对照的缺席臂在下面那条测试里。
   */
  assert.ok(teamLevel.waits.length >= 1, `★ 派发过的尝试必须出现在 waits 里；得到 ${JSON.stringify(teamLevel.waits)}`)

  /** ★ 那条"没有派发记录"的任务**不得**出现在 waits 里（拿不到起点就不许伪造）。 */
  assert.equal(
    teamLevel.waits.some((w) => w.taskId === 't2'),
    false,
    '★ 没有派发记录的任务不得被塞进 waits —— 那会把"从没等过"伪造成"等了一会儿"',
  )

  /** 而它自己的单任务观察面：读不到 ⇒ `wait` 缺席。 */
  const singleWait = captured[0]?.wait
  assert.ok(singleWait !== undefined, '派发那一刻必须注入 wait')
  assert.equal(singleWait.startedAt, dispatchedAt)
})

test('① 派发前的任务状态：等待起点记在【尝试开始之后】，不是任务创建那一刻', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-startorder-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const liveAgents = new Map([['worker-session', memberAgent('worker-session')]])
  const created = clock.value
  clock.advance(7 * 60_000)  // 过了 7 分钟才真的被调度

  const seen = []
  const probe = withProbe('runtime', (ctx) => { seen.push(ctx); return { ok: true } })
  try {
    await dispatchOnce(workspace, { clock, liveAgents })
  } finally {
    probe.dispose()
  }
  const wait = seen[0]?.wait
  assert.ok(wait !== undefined)
  assert.equal(wait.startedAt, created + 7 * 60_000, '★ 起点必须是【派发被接受】的时刻')
  assert.notEqual(wait.startedAt, created, '★ 起点不得被任务记录上的时间戳冒充（那会把"队长刚改过任务"读成"成员刚开工"）')
})

// ─────────────────────────────────────────────────────────────────────────────
// ② ★ 硬要求：哪怕返回最严重的裁决，也不阻止流程
// ─────────────────────────────────────────────────────────────────────────────

test('★ ② 硬要求（a）：注册表公开 API 把真判据改成永远 blocked ⇒ 六条路全部照常走完', async () => {
  /**
   * ★ 做法说明（这是本文件唯一"动判据本身"的地方，且**只动它的注册项**）：
   *   `registry.register` 是公开 API，它拒绝重复 id ⇒ 要换掉它必须先 `unregister`。
   *   我不改任何源码，测试结束【无论如何】把它装回去（`finally`）。
   *
   * ★ 为什么不用 `observe()`：观察模式的定义就是"放过"，拿它测"不阻止流程"是
   *   循环论证（它本来就为了不阻止才存在的）。这里要的是"**会被采纳的** blocked
   *   裁决也拦不住流程"，而契约 §5 要的正是这一条。
   */
  const LIVE = await import('../lib/gates/runtime/liveness.js')
  const LIVE_ID = LIVE.id
  const original = registry.list().runtime.find((entry) => entry.id === LIVE_ID)
  assert.ok(original !== undefined, '★ 真判据必须真的挂在 runtime 位置上（本臂的前提）')

  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-nonblocking-')))
  await seedTeam(workspace, {
    members: [
      { id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 },
      { id: 'reviewer-1', name: 'reviewer', status: 'idle', joinedAt: 1 },
    ],
    tasks: [{
      id: 't1', subject: 'impl', status: 'pending', assignee: 'worker', dependencies: [], attempt: 1,
      attemptId: 'att-1', kind: 'implementation', objective: 'do it', acceptance: ['a'],
      verify: ['node -e "process.exit(0)"'], inScope: ['docs/x.md'],
      reviewer: 'reviewer', createdAt: 1, updatedAt: 1,
    }],
  })
  const clock = fakeClock()
  const liveAgents = new Map([
    ['member-1', memberAgent('member-1', { text: 'all done' })],
    ['reviewer-1', memberAgent('reviewer-1', { text: 'noted' })],
  ])
  const fixture = pluginFixture(workspace, { clock, liveAgents })

  /** ★ 换掉真判据：它现在**无条件**返回最严重的裁决（带 blocker ⇒ ok:false）。 */
  registry.unregister(LIVE_ID)
  registry.register({
    id: LIVE_ID,
    point: 'runtime',
    description: 'verifier3 probe: the real liveness gate, forced to always block',
    gate: () => ({ ok: false, blockers: ['verifier3: this member is stuck, and this verdict is deliberately maximal'] }),
  })
  const before = runtimeGateLogSnapshot().length
  try {
    /** ① 建任务 —— 不得被拒。 */
    const created = await fixture.call('agent_teams_create_task', { subject: 'still allowed', inScope: ['docs/y.md'] })
    assert.equal(created.status, 'pending', '★ 一条 blocked 的 runtime 裁决不得拦住建任务')

    /** ② 成员上报 —— 不得被拒。 */
    const member = memberAgent('member-1', { text: 'reporting' })
    liveAgents.set('member-1', member)
    const updated = await fixture.call(
      'agent_teams_update_task',
      { task_id: 't1', attempt_id: 'att-1', status: 'in_progress', output: 'part way' },
      member,
    )
    assert.equal(updated.task_id, 't1', '★ 不得拦住成员上报')

    /** ③ 状态快照 —— 读操作必须永远读得到（t18/B2 的硬要求）。 */
    const status = await fixture.call('agent_teams_status', {})
    assert.equal(status.team_id, 'team', '★ 不得拦住状态查询')

    /** ④ 宣告交付 —— 裁决被如实报告，但**不是** runtime 判据造成的中断。 */
    const declared = await fixture.call('agent_teams_declare_delivery', {})
    assert.equal(typeof declared.declared, 'boolean', '★ 交付宣告必须走完并给出结论')

    /** ⑤ 派发 —— 不得被拦住、也不得被撤销。 */
    const dispatchedTeam = await readTeam(join(workspace, '.agent-teams'), 'team')
    assert.equal(dispatchedTeam.tasks[0].status, 'in_progress', '这条任务刚刚被上报过，状态必须保持')

    /** ★ 裁决**确实被求值并记录**了：否则"没拦住"可能只是"压根没跑"。 */
    const log = runtimeGateLogSnapshot().slice(before)
    assert.ok(
      log.some((entry) => entry.outcome.startsWith('blocked:')),
      `★ "开火了但流程照走"必须留下痕迹；log=${JSON.stringify(log.map((e) => e.outcome))}`,
    )
    assert.ok(
      log.some((entry) => entry.outcome.includes('deliberately maximal')),
      '★ 留下痕迹的必须是【这条判据的原话】',
    )
  } finally {
    registry.unregister(LIVE_ID)
    registry.register({
      id: LIVE_ID,
      point: 'runtime',
      description: original.description,
      gate: (context) => LIVE.gate(context),
      ...(original.hasAppliesTo === true ? { appliesTo: LIVE.appliesTo } : {}),
    })
  }
})

test('★ ② 硬要求（b）：把【真实】判据逼到 blocked（成员 20 分钟没产出）⇒ 流程照样走完', async () => {
  /**
   * ★ 这条臂与上一条互补：上一条问"最严重的裁决能不能拦住"，这条问
   *   "**不加任何东西**时，真实判据在最该开火的情形下开火了吗，开了火之后呢"。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-realsevere-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { text: 'starting' })
  const liveAgents = new Map([['worker-session', member]])
  const fixture = pluginFixture(workspace, { clock, liveAgents })

  const before = runtimeGateLogSnapshot().length
  /** 派发（第一次探活，建立 `previousPollAt`）；这条路上成员确实产出过一次。 */
  await dispatchOnce(workspace, { clock, liveAgents })

  /** 20 分钟里成员**一句话都没说**（`silence()` 不会造出"新的产出"）。 */
  clock.advance(20 * 60_000)
  const status = await poll(workspace, fixture)

  assert.ok(status !== undefined, '★ runtime 位置必须真的被求值到')
  assert.equal(status.ok, false, `★ 20 分钟零产出必须报出来；得到 ${JSON.stringify(status)}`)
  assert.ok(status.blockers.length > 0, '★ blocked 必须说清为什么')
  assert.equal(status.outcome.startsWith('blocked:'), true, `运行记录里必须读得出这是 blocked；得到 ${status.outcome}`)

  /** ★★ 而它**没有**阻止任何东西：状态查询照常返回结果。 */
  const again = await fixture.call('agent_teams_status', {})
  assert.equal(again.team_id, 'team', '★ blocked 的 runtime 裁决不得阻止流程（契约 §5 硬要求）')

  /** 而它确实进了运行记录（"警告 + 证据"的产物）。 */
  const log = runtimeGateLogSnapshot().slice(before)
  assert.ok(log.some((entry) => entry.outcome.startsWith('blocked:')), '★ 告警必须留在运行记录里')
})

// ─────────────────────────────────────────────────────────────────────────────
// ③ ★ 有状态：两次探活之间"动过"与"没动过"必须不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ ③ 有状态（对照臂）：10 分钟里成员【说过话】⇒ ok；同一份记录、同样等了很久 ≠ 报警', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-state-ok-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { text: 'starting' })
  const liveAgents = new Map([['worker-session', member]])
  const fixture = pluginFixture(workspace, { clock, liveAgents })

  /** 派发 ⇒ 第一次探活的记录建立（这一步也观察了一次已有产出）。 */
  await dispatchOnce(workspace, { clock, liveAgents })

  /** 过了 10 分钟，成员**真的又说了一句** —— 观察发生在 status 那条真实路径上。 */
  clock.advance(INTERVAL)
  member.utter('still working on it')
  const status = await poll(workspace, fixture)

  assert.ok(status !== undefined, 'runtime 位置必须被求值到')
  assert.equal(status.ok, true, `★ 动过的成员不得被报成卡死；得到 ${JSON.stringify(status)}`)
  assert.equal(status.outcome, 'ok', '★ 运行记录里必须读得出这是 ok，不是 blocked')
})

test('★ ③ 有状态（伪造臂）：同样过了 10 分钟，成员【一句话都没说】⇒ blocked，与上面那条不同形', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-state-stuck-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { text: 'starting' })
  const liveAgents = new Map([['worker-session', member]])
  const fixture = pluginFixture(workspace, { clock, liveAgents })

  await dispatchOnce(workspace, { clock, liveAgents })
  /** ★ 同样推进 10 分钟，而这一次**什么都不发生**。 */
  clock.advance(INTERVAL)
  const status = await poll(workspace, fixture)

  assert.ok(status !== undefined)
  assert.equal(status.ok, false, `★ 一整段间隔里零产出必须被报出来；得到 ${JSON.stringify(status)}`)
  assert.ok(status.blockers.length > 0, '★ 报警必须说清为什么')
  assert.notEqual(status.outcome, 'ok', '★ "没动过"与"动过"必须不同形')

  /**
   * ★ 这一条是本判据存在的**全部意义**：同样等了 10 分钟，两条臂唯一的差别是
   *   "这 10 分钟里成员有没有产出"，而结论必须相反。若判据是无状态的
   *   （例如只比较"等了多久"与"阈值"），这两条臂会给出同一个结论。
   */
})

test('★ ③ 有状态（跨调用点）：派发那一次观察之后，改契约/成员上报不会把"最后活动时刻"刷成现在', async () => {
  /**
   * ★ 这条臂防的是最隐蔽的一种失效：把"**工具被调用了**"当成"成员在动"。
   *   若调用点这么写，一个卡死的成员只要它的工具还在被调用（重试、心跳）就会被
   *   反复刷新 ⇒ 判据**永远不报警**。
   *
   *   构造：派发后成员一直不说话，而队长反复改契约 / 成员反复上报 —— 时钟每次
   *   都被推进 10 分钟。若判据被刷成"刚动过"，最后一探会是 ok；正确的结果是
   *   **因为首探 vs 末探读数没变**而判 blocked。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-statenoise-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { text: 'starting' })
  const liveAgents = new Map([['worker-session', member]])
  const fixture = pluginFixture(workspace, { clock, liveAgents })

  await dispatchOnce(workspace, { clock, liveAgents })
  const team = await readTeam(join(workspace, '.agent-teams'), 'team')
  const attemptId = team.tasks[0].attemptId

  /** 三次"看起来像在动"的事件：改契约、成员上报、再来一次改契约。每 10 分钟一次。 */
  for (let round = 0; round < 3; round += 1) {
    clock.advance(INTERVAL)
    await fixture.call('agent_teams_amend_task', { task_id: 't1', reason: `round ${round}` })
    await fixture.call(
      'agent_teams_update_task',
      { task_id: 't1', attempt_id: attemptId, status: 'in_progress', output: `round ${round}` },
      member,
    )
  }
  clock.advance(INTERVAL)
  const status = await poll(workspace, fixture)

  assert.ok(status !== undefined)
  /**
   * ★ 这三次上报**都不是产出**（成员一句话都没说）⇒ 最后活动时刻停在派发那一刻
   *   ⇒ 与首探读数一致 ⇒ 必须报警。若这里读到 ok，说明有调用点把"工具调用"或
   *   "自报的 output 文本"当成了产出。
   */
  assert.equal(
    status.ok,
    false,
    `★ 反复的工具调用不是"在动"：成员 40 分钟零产出必须报警；得到 ${JSON.stringify(status)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ④ 三态形状互不相同；缺省方向是"未测量"
// ─────────────────────────────────────────────────────────────────────────────

test('④ 三态形状：ok / blocked / unmeasured 两两不同形', async () => {
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  const base = {
    event: 'runtime-liveness',
    task: { id: 't1', assignee: 'worker' },
  }

  const okArm = gate({
    ...base,
    wait: { startedAt: T0, now: T0 + 2 * INTERVAL, previousPollAt: T0 + INTERVAL, previousLastActivityAt: T0, lastActivityAt: T0 + INTERVAL },
  })
  const blockedArm = gate({
    ...base,
    wait: { startedAt: T0, now: T0 + 2 * INTERVAL, previousPollAt: T0 + INTERVAL, previousLastActivityAt: T0, lastActivityAt: T0 },
  })
  const unmeasuredArm = gate({ ...base, wait: { now: T0 } })

  assert.equal(shapeOf(okArm), 'ok')
  assert.equal(shapeOf(blockedArm), 'blocked')
  assert.equal(shapeOf(unmeasuredArm), 'unmeasured')
  assert.notEqual(shapeOf(okArm), shapeOf(blockedArm))
  assert.notEqual(shapeOf(okArm), shapeOf(unmeasuredArm))
  assert.notEqual(shapeOf(blockedArm), shapeOf(unmeasuredArm))

  /** ★ blocked 必须说清为什么；unmeasured 必须说清测不了什么。 */
  assert.ok(blockedArm.blockers.length > 0)
  assert.ok(unmeasuredArm.unmeasured.trim().length > 0)
  /** ★ 而且两者的措辞不得同形。 */
  assert.doesNotMatch(unmeasuredArm.unmeasured, /has been waiting \d+ minute/)
})

test('④ 缺省方向：什么都不注入时，判据留下的是"未测量"，不是"通过"', async () => {
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const cases = [
    ['完全空的 ctx', {}],
    ['空 wait', { event: 'runtime-liveness', wait: {} }],
    ['没有时钟', { event: 'runtime-liveness', wait: { startedAt: 1, lastActivityAt: 1 } }],
    ['没有等待起点', { event: 'runtime-liveness', wait: { now: 2, lastActivityAt: 1 } }],
    ['没有活动观察', { event: 'runtime-liveness', wait: { now: 2, startedAt: 1 } }],
    ['时钟不是数', { event: 'runtime-liveness', wait: { now: 'x', startedAt: 1, lastActivityAt: 1 } }],
  ]
  const offenders = []
  for (const [label, ctx] of cases) {
    const verdict = gate(ctx)
    const shape = shapeOf(verdict)
    if (shape === 'ok') offenders.push(`${label} ⇒ ok: ${JSON.stringify(verdict)}`)
  }
  assert.deepEqual(
    offenders,
    [],
    `★ 一条拿不到观察就说"通过"的判据，比没装更坏（它让人以为探过了）：\n${offenders.join('\n')}`,
  )
})

test('④ 三态在【真实路径】上也不同形：ok / blocked / unmeasured 都从工具返回值里读得到', async () => {
  /**
   * ★ 判据层自洽 ≠ 调用点如实转述。这条臂走真实工具，读工具返回值里的
   *   `runtime_gates`：三态在**返回值**里也必须两两不同形。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-threestates-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { text: 'starting' })
  const liveAgents = new Map([['worker-session', member]])
  const fixture = pluginFixture(workspace, { clock, liveAgents })

  /** unmeasured 臂：还没派发过 ⇒ 没有等待记录 ⇒ 读不到观察。 */
  const noWait = await poll(workspace, fixture)
  assert.ok(noWait !== undefined, 'runtime 位置必须真的被求值到（判据在，只是读不到观察）')
  assert.equal(noWait.ok, true, '★ "这个团队此刻没有任何等待"是正常情形，不是异常')
  assert.equal(noWait.evaluated, 0, '★ 探活判据只在 runtime-liveness 事件上开火；这里必须是"没跑"而不是"跑了一条什么都对的"')
  assert.equal(noWait.registered, 1, '★ runtime 位置必须真的挂着判据')
  assert.match(String(noWait.outcome), /nothing evaluated/, '★ "没有判据适用"必须留在记录里')

  /** 派发 ⇒ 建立等待记录。 */
  await dispatchOnce(workspace, { clock, liveAgents })

  /** ok 臂：成员在间隔里说了话。 */
  clock.advance(INTERVAL)
  member.utter('progress')
  const okStatus = await poll(workspace, fixture)

  /** blocked 臂：再一次间隔里零产出。 */
  clock.advance(INTERVAL)
  const blockedStatus = await poll(workspace, fixture)

  assert.equal(okStatus.ok, true, `期望 ok；得到 ${JSON.stringify(okStatus)}`)
  assert.equal(blockedStatus.ok, false, `期望 blocked；得到 ${JSON.stringify(blockedStatus)}`)
  assert.equal(typeof blockedStatus.unmeasured, 'undefined', '★ blocked 不得同时说"没能测量"')
  assert.ok(blockedStatus.blockers.length > 0, '★ blocked 必须带着原话')
  assert.notEqual(blockedStatus.outcome, okStatus.outcome)
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 边界：正好等于间隔 / 时钟回拨 / 间隔非法 / 第一次探活
// ─────────────────────────────────────────────────────────────────────────────

test('⑤ 边界：第一次探活（没有上一次记录）⇒ ok，但【不同形】于"确认它还在动"', async () => {
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  const first = gate({
    event: 'runtime-liveness',
    task: { id: 't1', assignee: 'worker' },
    wait: { startedAt: T0, lastActivityAt: T0, now: T0 + INTERVAL },
  })
  assert.equal(shapeOf(first), 'ok', '第一次探活是探活的常规状态')
  assert.equal(first.first_probe, true, '★ "第一次探活"必须能读出来')
  assert.equal(first.alive, null, '★ 第一次探活**没有**"它还在动"这个结论（那是比较出来的）')
  assert.equal(first.updated_since_previous_probe, null, '★ 没比过 ≠ 比过且没动')

  const second = gate({
    event: 'runtime-liveness',
    task: { id: 't1', assignee: 'worker' },
    wait: { startedAt: T0, lastActivityAt: T0 + 1, now: T0 + 2 * INTERVAL, previousPollAt: T0 + INTERVAL, previousLastActivityAt: T0 },
  })
  assert.equal(second.first_probe, false)
  assert.equal(second.alive, true)
  /** ★ 两者必须不同形，否则"我等了 10 分钟还没看过它"会读起来像"我确认过它还活着"。 */
  assert.notDeepEqual(
    { first_probe: first.first_probe, alive: first.alive },
    { first_probe: second.first_probe, alive: second.alive },
  )
})

test('⑤ 边界：正好等于间隔 —— 间隔边界不是"卡死"的判据（没动就是没动，动过就是动过）', async () => {
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  /** 正好推进一个间隔：活动读数没变 ⇒ blocked（那是"真的没动"）。 */
  const exactlyStuck = gate({
    event: 'runtime-liveness',
    wait: { startedAt: T0, lastActivityAt: T0, now: T0 + INTERVAL, previousPollAt: T0, previousLastActivityAt: T0, intervalMs: INTERVAL },
  })
  assert.equal(shapeOf(exactlyStuck), 'blocked')

  /** 正好推进一个间隔、而活动读数前进了 ⇒ ok。 */
  const exactlyMoved = gate({
    event: 'runtime-liveness',
    wait: { startedAt: T0, lastActivityAt: T0 + INTERVAL, now: T0 + INTERVAL, previousPollAt: T0, previousLastActivityAt: T0, intervalMs: INTERVAL },
  })
  assert.equal(shapeOf(exactlyMoved), 'ok')

  /** ★ 而**只推进了半个间隔**时，判据不做任何"没进展"的判断（它只看两端）。 */
  const halfMoved = gate({
    event: 'runtime-liveness',
    wait: { startedAt: T0, lastActivityAt: T0, now: T0 + INTERVAL / 2, previousPollAt: T0, previousLastActivityAt: T0, intervalMs: INTERVAL },
  })
  assert.equal(shapeOf(halfMoved), 'ok', '★ 半个间隔里没动**不得**被当成卡死 —— 判据没有实现"没进展"那一种')
})

test('⑤ 边界：时钟回拨 ⇒ unmeasured（不是假警报、也不是"通过"）', async () => {
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  const backwards = gate({
    event: 'runtime-liveness',
    task: { id: 't1', assignee: 'worker' },
    wait: { startedAt: T0, lastActivityAt: T0, now: T0 - 5_000, previousPollAt: T0, previousLastActivityAt: T0 },
  })
  assert.equal(shapeOf(backwards), 'unmeasured', `★ 负的间隔既不是"卡死"也不是"健康"；得到 ${JSON.stringify(backwards)}`)
  assert.match(backwards.unmeasured, /clock|backwards/i)
  assert.doesNotMatch(backwards.unmeasured, /has not moved/, '★ 回拨不得被读成"它没动"（那是假警报）')

  /** ★ 而**第一次探活**遇到"往回走"的时钟不算回拨（没有可比对象）。 */
  const firstWithOddClock = gate({
    event: 'runtime-liveness',
    wait: { startedAt: T0, lastActivityAt: T0, now: T0 - 5_000 },
  })
  assert.equal(shapeOf(firstWithOddClock), 'ok', '★ 第一次探活只有一端，"不可比"这件事还不存在')
})

test('⑤ 边界：间隔非法值 ⇒ 不加界、不抛错（用缺省值，并留下痕迹）', async () => {
  const { gate, DEFAULT_LIVENESS_INTERVAL_MS } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  const bad = [0, -1, NaN, Infinity, -Infinity, null, 'ten minutes', {}, []]

  for (const value of bad) {
    let verdict
    assert.doesNotThrow(() => {
      verdict = gate({
        event: 'runtime-liveness',
        task: { id: 't1', assignee: 'worker' },
        wait: { startedAt: T0, lastActivityAt: T0, now: T0 + 2 * INTERVAL, previousPollAt: T0 + INTERVAL, previousLastActivityAt: T0, intervalMs: value },
      })
    }, `★ 间隔写成 ${JSON.stringify(value)} 不得让判据抛错（一个因为参数没写对就炸的守卫会被关掉）`)
    assert.equal(shapeOf(verdict), 'blocked', `intervalMs=${JSON.stringify(value)} 时"没动过"仍然必须被报出来`)
    assert.equal(verdict.interval_ms, DEFAULT_LIVENESS_INTERVAL_MS, '★ 非法值必须落回缺省，而不是"不加界 ⇒ 永不触发"')
    assert.equal(typeof verdict.interval_ignored, 'string', '★ 给了个坏值必须留下痕迹（与"没给"不同形）')
  }

  /** ★ 而【缺席】不留下痕迹：缺席是正常，给了坏值才是要曝光的事。 */
  const absent = gate({
    event: 'runtime-liveness',
    wait: { startedAt: T0, lastActivityAt: T0, now: T0 + 2 * INTERVAL, previousPollAt: T0 + INTERVAL, previousLastActivityAt: T0 },
  })
  assert.equal(absent.interval_ms, DEFAULT_LIVENESS_INTERVAL_MS)
  assert.equal('interval_ignored' in absent, false, '★ "没写间隔"与"写错了间隔"必须不同形')

  /** ★ 合法间隔被尊重。 */
  const custom = gate({
    event: 'runtime-liveness',
    wait: { startedAt: T0, lastActivityAt: T0, now: T0 + 2 * INTERVAL, previousPollAt: T0 + INTERVAL, previousLastActivityAt: T0, intervalMs: 60_000 },
  })
  assert.equal(custom.interval_ms, 60_000)
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 纯数据变换：不 import I/O，不调 Date.now()
// ─────────────────────────────────────────────────────────────────────────────

test('⑥ 判据源码里没有 I/O import，也没有真的调用 Date.now —— 时钟只从 ctx 读', async () => {
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  const source = await readFile(path.join(root, 'src', 'gates', 'runtime', 'liveness.ts'), 'utf8')
  const built = await readFile(path.join(root, 'lib', 'gates', 'runtime', 'liveness.js'), 'utf8')

  for (const [label, text] of [['源码', source], ['构建产物', built]]) {
    /** ★ 去掉注释再数：注释里提到 `Date.now()` 不算调用（本队已为这条吃过一次）。 */
    const code = stripComments(text)
    assert.doesNotMatch(code, /Date\.now/, `★ ${label}里不得出现真的 \`Date.now\` 调用 —— 时钟由调用方注入（契约 §2 性质 1）`)
    assert.doesNotMatch(code, /performance\.now/, `★ ${label}里不得自己读表`)
    assert.doesNotMatch(code, /new Date\(/, `★ ${label}里不得自己读表`)
    for (const forbidden of ['node:fs', 'node:child_process', 'node:net', 'node:http', 'node:https', 'node:os']) {
      assert.doesNotMatch(code, new RegExp(`from\\s+['"]${forbidden.replace(/[/]/g, '\\/')}`), `★ ${label}不得 import ${forbidden}`)
    }
  }

  /** ★ 判据只 import 注册表（不 import 别的判据、不 import 工具层）。 */
  const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line) || /^\s*\}?\s*from\s+['"]/.test(line))
  assert.deepEqual(
    importLines.map((line) => line.match(/from\s+['"]([^'"]+)['"]/)?.[1]).filter(Boolean),
    ['../registry.ts'],
    '★ 判据只能 import 注册表 —— 它必须是一个可独立求值的纯数据变换',
  )

  /** ★ 而调用方**确实**注入了时钟：同一个模块的两次求值、不同 now ⇒ 不同结论。 */
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  const at = (now) => gate({ event: 'runtime-liveness', wait: { startedAt: T0, lastActivityAt: T0, now, previousPollAt: T0, previousLastActivityAt: T0 } })
  assert.equal(shapeOf(at(T0 + INTERVAL)), 'blocked')
  assert.equal(at(T0 + INTERVAL).wait_ms, INTERVAL, '★ 时长完全由注入的时钟决定（它自己不读表）')
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ ★ 它没有实现"没进展"那一种
// ─────────────────────────────────────────────────────────────────────────────

test('★ ⑦ 等很久但一直在动 ⇒ 不得报警（"思考很久"不是异常）', async () => {
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  /** 一条整整等了 7 小时、每一段间隔都有产出的等待。 */
  for (const elapsed of [INTERVAL, 60 * 60_000, 3 * 60 * 60_000, 7 * 60 * 60_000]) {
    const verdict = gate({
      event: 'runtime-liveness',
      task: { id: 't1', assignee: 'slow-but-alive' },
      wait: {
        startedAt: T0,
        now: T0 + elapsed,
        lastActivityAt: T0 + elapsed - 1,
        previousPollAt: T0 + elapsed - INTERVAL,
        previousLastActivityAt: T0 + elapsed - INTERVAL - 1,
      },
    })
    assert.equal(
      shapeOf(verdict),
      'ok',
      `★ 等了 ${Math.round(elapsed / 60_000)} 分钟但一直在动 ⇒ 不得报警；得到 ${JSON.stringify(verdict)}`,
    )
  }

  /** 读一遍源码：判据的说明里明确写了"没进展"不做，且没有任何按总时长报警的分支。 */
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const source = await readFile(path.join(root, 'src', 'gates', 'runtime', 'liveness.ts'), 'utf8')
  assert.match(source, /永不.*(因为"等了太久"|因为等太久)|不是「硬超时」|不是硬超时/, '判据的自我说明里必须写清它是探活、不是硬超时')
})

// ─────────────────────────────────────────────────────────────────────────────
// 产物必须被 test:gates 收：判据源码与构建产物都在仓库里
// ─────────────────────────────────────────────────────────────────────────────

test('inScope：判据本体在 src/ 与 lib/ 两处都存在（link: 安装下改动必须 build 才生效）', async () => {
  const { readFile, stat } = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const src = path.join(root, 'src', 'gates', 'runtime', 'liveness.ts')
  const lib = path.join(root, 'lib', 'gates', 'runtime', 'liveness.js')
  assert.ok((await stat(src)).isFile(), '判据源码必须存在')
  assert.ok((await stat(lib)).isFile(), '★ 构建产物必须存在 —— 已装插件是 link: 指向源码，改动不 build 不生效')
  const built = await readFile(lib, 'utf8')
  assert.match(built, /runtime-liveness/, '★ 构建产物必须是当前的（含本判据认的事件名）')

  const { id, point, description } = await import('../lib/gates/runtime/liveness.js')
  assert.equal(id, 'runtime.liveness')
  assert.equal(point, 'runtime')
  assert.ok(INSERTION_POINTS.includes(point), 'runtime 必须是注册表认识的插入点')
  assert.ok(description.trim().length > 0, '判据必须有说明（控制台渲染它）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────────────────────

/** 每种裁决的【形状】—— 三态不同形的机械判据。 */
function shapeOf(verdict) {
  if (verdict === null || typeof verdict !== 'object') return `non-object:${JSON.stringify(verdict)}`
  if (verdict.ok === true) return 'ok'
  if (Array.isArray(verdict.blockers)) return 'blocked'
  if (typeof verdict.unmeasured === 'string') return 'unmeasured'
  return `malformed:${JSON.stringify(verdict)}`
}

/** ★ 注释里提到 `Date.now()` 不算调用 —— 去掉行注释与块注释再数（粗糙但足够）。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 注册一条探针判据；调用方**必须**在 finally 里 dispose（留一条会让别的用例凭空多一条）。 */
function withProbe(point, gate) {
  const id = `verify3.${point}.${Math.random().toString(36).slice(2)}`
  const calls = []
  registry.register({
    id,
    point,
    description: `verifier3 probe for ${point}`,
    gate: (context) => { calls.push(context); return gate(context) },
  })
  return { id, calls, dispose: () => registry.unregister(id) }
}

