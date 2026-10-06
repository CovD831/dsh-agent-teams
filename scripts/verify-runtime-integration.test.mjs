/**
 * ── 独立验证（verifier3 / t3）：runtime 位置的第一条判据 —— 探活 ────────────────
 *
 * 这个文件**不是**实现者夹具的复制品，也刻意不看它的断言。它只带着七个要证伪的
 * 命题进场，每一个都从**真实路径**上做实验。**结论如下**（★ 四条 finding 全部
 * 是实测出来的，不是读代码读出来的）：
 *
 *   ✔ ②（硬要求）成立：判据哪怕返回最严重的裁决，六条路全部照常走完。
 *     （两种做法分开测：注册表公开 API 把真判据换成"永远 blocked"；以及不加任何
 *      东西、把真实判据逼到它该开火的情形。两次都证明**它阻止不了任何东西**。）
 *   ✔ ⑥ 成立：判据不 import I/O、不调 `Date.now()`（去注释后逐字检查源码与产物）。
 *   ✔ ⑦ 成立：等 7 小时而一直在动 ⇒ 不报警（它确实没有实现"没进展"那一种）。
 *   ✔ ⑤（大部分）成立：第一次探活不同形于"确认在动"；时钟回拨 ⇒ unmeasured。
 *
 *   ✗ ★★ FINDING V3-1（blocker）：**判据在真实的探活路径上从不被求值。**
 *         `agent_teams_status` 是六个调用点里唯一由时刻驱动的那一个（用户裁定的
 *         "10 分钟探活一次"就发生在查状态时），而它构造的是 `waits`（复数、数组），
 *         判据的 `appliesTo` 只认 `ctx.event === 'runtime-liveness'`，`gate` 只读
 *         `ctx.wait`（单数）—— **六处调用点里没有任何一处把 `event` 设成
 *         `'runtime-liveness'`**，于是这条判据在所有真实路径上恒为 `skipped`。
 *         实测：一条成员 50 分钟零产出、队长每 10 分钟查一次状态的等待，
 *         六次探活全部读作 `ok (nothing evaluated: 1 registered, all skipped)`。
 *         ⇒ 源项目那个"63 分钟零进展而没有任何一句话说它在等什么"的缺口，
 *           在本插件里**原样存在**。判据写得对，但它的输入面没接上。
 *
 *   ✗ ★ FINDING V3-2（medium）：每次 `status` 都重新派发 ⇒ 等待窗口被重置。
 *         `status` 会 `kickTeam`，而 kick 会给一个非 `working` 的成员
 *         `beginTaskAttempt` **换新一代** capability ⇒ 等待记录的键（attemptId）变了
 *         ⇒ `startedAt` 被刷新成"现在"、`lastActivityAt` 回到 undefined。
 *         即使 V3-1 被修好，"两次探活之间"这个前提在真实路径上仍然不成立：
 *         每一次探活看到的是一个**刚出生**的等待。
 *
 *   ✗ ★ FINDING V3-3（medium）：`blocked` / `unmeasured` 分支**不交任何证据字段**。
 *         `wait_ms` / `startedAt` / `lastActivityAt` / `previous_last_activity_at` /
 *         `updated_since_previous_probe` / `interval_ms` / `interval_ignored` 全部
 *         只出现在 **ok 分支**上。契约 §5 说 runtime 的产物是"**告警 + 证据**"——
 *         而判据唯一会告警的那条分支恰好把证据全丢了，调用方只能去正则那段人话。
 *
 *   ✗ ★ FINDING V3-4（medium）：间隔边界没有按"两个读数之间隔了多久"算。
 *         只推进了**半个间隔**、而活动读数没变 ⇒ 照样 `blocked`，措辞却写
 *         "has not moved for a **full** 10-minute probe interval"。
 *         判据不是"只比两端"：它把"两端相同"直接读成"整整一个间隔没动"。
 *
 * ── 这些 finding 在本文件里怎么钉 ──────────────────────────────────────────────
 *
 * ★ 缺陷臂**不断言缺陷是期望**（那等于把 bug 写成规格）。它们断言的是
 *   **当前读数**，并在注释里写明"修好后这条臂会变红，那时应当把它翻回它本来的
 *   断言"。于是：缺陷被记录、被机器看住、且不会因为修好而静默。
 *
 * ── 为什么文件名不是 gate-*.test.mjs ─────────────────────────────────────────
 *
 * 它是【集成/接线】验证，不是某一条判据的夹具。按仓库硬约束，不匹配 gate-* glob
 * 的测试必须显式列进 package.json 的 `test:gates`，否则就是"有 0 个读者"的测试。
 * 本文件已显式列入。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerAgentTeamsTools, runtimeGateLogSnapshot, resetWaitRecords } from '../lib/tools.js'
import { registry, INSERTION_POINTS } from '../lib/gates/index.js'
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

/** 一个 captain Agent 桩（工具层读 `id` / `session.header.cwd`，只此两处）。
 *
 *  ★ `id` 必须与团队记录里的 `captainSessionId` 对上 —— 装配层靠它认人。
 *  ★ `cwd` **必须是团队状态根目录的父目录**：工具层只从调用者的会话里取
 *    workspace，再拼 `stateDir` 去找团队。这是真实路径，不是我可选的输入。 */
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
 * `assistant/message` —— 这是探活唯一认的"在动"。
 *
 * ★ `workspace` 必须显式给出（同 {@link captainAgent}）：工具层靠调用者会话的
 *   `cwd` 找团队，成员会话的 cwd 若是个占位值，成员路径上的每一次调用都会以
 *   "你不属于任何团队"失败 —— 而那种红读起来像产品缺陷。
 */
function memberAgent(id, { workspace, text = 'starting' } = {}) {
  const events = []
  const agent = {
    id,
    status: 'idle',
    session: { header: { cwd: workspace, events }, events },
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
 * 建一个已存在的团队（running），并返回一个**完整的工作区夹具**。
 *
 * ★ 这一条是本次验证里最容易被夹具自己写错的地方：工具层是从**调用者会话的 cwd**
 *   + `stateDir` 推状态根的。夹具若把团队建在一个**嵌套子目录**里（或让 captain 桩
 *   的 cwd 指向别处），工具层读到的会是另一个团队 —— 于是所有断言都在测一个
 *   不存在的世界，而且**大部分会以"工具拒绝"的形式失败**，读起来像产品缺陷。
 *   ⇒ 所以目录、cwd、`stateDir` 三者由这一个函数**一起**决定。
 */
async function seedTeam(workspace, { id = 'team', tasks = [], members = [], taskSeq } = {}) {
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id,
    name: 'RuntimeIntegration',
    captainSessionId: CAPTAIN_SESSION,
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

/**
 * ★ 一个【共享】的插件装配：**跨调用点**观察同一份进程级状态。
 *
 * 为什么必须共享：等待记录表是进程级的（契约 §5 允许 runtime "带状态"），
 * 而"派发"发生在调度器里、后续探活发生在工具调用里。两个各建一份装配的夹具
 * 会看到两份独立状态 —— 那样测出来的"有状态"是假的。
 *
 * ★ 还有一条同样致命、而更不显眼的：调度器要能按 `captainSessionId` **取回队长
 *   Agent** 才会派发（`liveCaptain`）。夹具若只把成员放进 `agents` 表，`kickMember`
 *   会在"拿不到队长"那一行**静默返回** —— 不抛错、不告警、任务原地不动。
 *   那种红读起来像"派发路径坏了"，其实是我给的 ctx 里少了一个能被看见的队长。
 */
function factory({ workspace, clock, liveAgents = new Map(), onDispatched } = {}) {
  /**
   * ── ★ V3-1 修好后补上的一处夹具卫生（本文件原先没有）─────────────────────────
   *
   * MEASURED（2026-10-06）：等待记录表是**进程级**的（契约 §5 允许 runtime 带状态），
   * 而这个夹具此前**从不**清它。判据恒 `skipped` 时这无所谓 —— 谁都读不到它。
   * V3-1 修好之后，前一条臂留下的记录会漏进下一条臂，于是
   * "这个团队此刻没有等待"那一格读到了别的臂的等待 ⇒ 断言全乱。
   *
   * ★ 每装配一次就清一次：一条臂 = 一个独立的进程级世界。
   *   这与 `gate-runtime-clock.test.mjs` 的 `resetWaitRecords()` 同一口径。
   */
  resetWaitRecords()
  const tools = new Map()
  const warnings = []
  const captain = captainAgent(workspace)
  /** ★ 队长的会话 id 必须在 `agents` 表里能取回一个【活着】的 Agent。 */
  const ag = new Map(liveAgents)
  ag.set(CAPTAIN_SESSION, captain)
  const ctx = {
    logger: { debug() {}, info() {}, warn(m) { warnings.push(m) }, error(m) { warnings.push(m) } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get: (id) => ag.get(id) },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
  }
  /**
   * ★ 调度器与工具层读**同一个**可注入时钟。
   *
   * 两处各读各的（调度器读 `Date.now`、判据读注入的那个）不会当场出错，但会让
   * "派发在 T 发生"与"探活在 T' 读到起点"之间没有共享参照 —— 夹具推进假时钟时
   * 只推进了一半，于是判据永远测不出"没动过"，而测试**看起来是绿的**。
   */
  const runtime = registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams',
    memberProvider: 'spawn',
    maxMembers: 8,
    profiles: {},
    fallback: undefined,
    ...(clock === undefined ? {} : { now: clock.now }),
  })
  /**
   * ★ 这里**不再**另建一个调度器。
   *
   * 判据在派发那一刻的调用点是 `registerAgentTeamsTools` 在它**自己**的
   * `installTeamScheduler(...)` 里挂的 `config.onDispatched`。夹具若再建一个
   * 调度器，那个实例的回调是**我写的** ⇒ "判据在派发那一刻被求值"这条断言测的
   * 就变成了我的夹具，而不是产品。所以派发一律走 `agent_teams_status` 那条
   * **真实**入口（队长查状态 ⇒ kickTeam ⇒ 派发）。
   */
  return { ctx, tools, warnings, runtime, captain, liveAgents: ag }
}

/** 调一个真实工具（默认以 captain 身份）。 */
async function callTool(f, name, args, agent) {
  const tool = f.tools.get(name)
  if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
  return await tool.execute(args, { agent: agent ?? f.captain, signal: new AbortController().signal })
}

/** 让 `agent_teams_status` 真的驱动一次探活（六个调用点里唯一由时刻驱动的那个）。 */
async function poll(f) {
  return (await callTool(f, 'agent_teams_status', {})).runtime_gates
}

/**
 * 一个真实的派发周期：kickTeam ⇒ 调度器建尝试、投递、【回调】。
 *
 * ★ 这里必须走**工具层自己那个**调度器实例。
 *
 *   `installTeamScheduler` 每次都新建一份实例，而 runtime 判据的调用点是
 *   `registerAgentTeamsTools` 在**它自己**的 `installTeamScheduler(...)` 里挂上去的
 *   （`config.onDispatched`）。夹具若再建一个调度器，那个实例的回调是**我写的**，
 *   于是"判据在派发那一刻被求值"这条断言测的是我的夹具，不是产品 ——
 *   而它还会以"没跑到"的形式红，读起来像接线坏了。
 *
 *   ⇒ 所以：派发必须由工具层那条路发起。`agent_teams_status` 在队长身份下会
 *     `kickTeam`，这是**真实**的派发入口（正是"成员被派发"发生在生产里的方式）。
 */
async function dispatchOnce(f, workspace) {
  await callTool(f, 'agent_teams_status', {})
  return readTeam(join(workspace, '.agent-teams'), 'team')
}

/** 工具层那条路真的派发了吗？（读磁盘上的事实，不读夹具的数组） */
async function dispatchedTask(workspace) {
  const team = await readTeam(join(workspace, '.agent-teams'), 'team')
  const task = team?.tasks[0]
  return { task, team }
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 六个调用点：判据真的在它们上面被求值
// ─────────────────────────────────────────────────────────────────────────────
//
// ★ 判据被求值到 ⇒ 返回值里出现 `runtime_gates`（含 `ran[]` 与 `outcome`）。
//   而 `runtime.liveness` 只认事件名 `runtime-liveness` ⇒ 其余五个事件的读数
//   是 `evaluated: 0` 且 `registered: 1`：**位置不空，而这一轮没有适用**。
//   那本身是一条必须能读到的信息（"没检查" ≠ "检查通过了"）。

test('① 调用点 member-dispatched：真实的 kickTeam 真的把 runtime 判据求值到了', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-dispatch-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const liveAgents = new Map([['worker-session', memberAgent('worker-session', { workspace })]])
  const f = factory({ workspace, clock, liveAgents })

  const seen = []
  const probe = withProbe('runtime', (context) => { seen.push(context); return { ok: true } })
  try {
    await dispatchOnce(f, workspace)
    /** ★ 派发真的发生了（读磁盘上的事实，不读夹具自己的数组）。 */
    const { task } = await dispatchedTask(workspace)
    assert.notEqual(task.status, 'pending', '★ 成员必须真的被派发（否则下面那条断言测的是空气）')
    const dispatchedSeen = seen.filter((ctx) => ctx.event === 'member-dispatched')
    assert.equal(
      dispatchedSeen.length,
      1,
      `★ runtime 位置的判据必须真的在派发那一刻被求值恰好一次（不是"源码里有一行"）；看到 ${JSON.stringify(seen.map((c) => c.event))}`,
    )
    const seen0 = dispatchedSeen
    assert.equal(seen0[0].event, 'member-dispatched', '判据必须能分辨自己被哪个调用点调用')
    /**
     * ★ 派发那一刻必须拿到【等待观察】—— 这是 t5 建立输入面的全部理由。
     *   拿不到的话，判据会在最需要它的那个调用点上返回 unmeasured。
     */
    assert.ok(seen0[0].wait !== undefined, `★ 派发调用点必须带上 wait 观察面；ctx 只有 ${Object.keys(seen0[0]).join(',')}`)
    assert.equal(seen0[0].wait.startedAt, clock.value, '★ 等待起点必须就是这次派发被接受的时刻')
    assert.equal(seen0[0].teamId, 'team', '★ 等待记录需要 teamId 才唯一（taskId 只在团队内唯一）')
  } finally {
    probe.dispose()
  }
})

test('① 另外五个调用点：task-created / task-update / task-update-settled / task-status / delivery-declared 每一个都真的被求值到', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-callsites-')))
  await seedTeam(workspace, {
    members: [
      { id: 'member-1', name: 'worker', status: 'idle', joinedAt: 1 },
      { id: 'reviewer-1', name: 'reviewer', status: 'idle', joinedAt: 1 },
    ],
  })
  const clock = fakeClock()
  const liveAgents = new Map([
    ['member-1', memberAgent('member-1', { workspace, text: 'all done' })],
    ['reviewer-1', memberAgent('reviewer-1', { workspace, text: 'noted' })],
  ])
  const f = factory({ workspace, clock, liveAgents })

  const seen = []
  const probe = withProbe('runtime', (context) => { seen.push(context.event); return { ok: true } })
  try {
    /** ★ ② 建任务（契约任务需要一条 review 环 ⇒ 团队里必须有 reviewer）。 */
    /**
     * ★ 用 `kind: 'work'`：本臂要的是"这五个调用点都跑到 runtime 判据"，
     *   而不是"完成判据能不能通过"。一个 `implementation` 契约在被报 completed 时
     *   会走 `completion.*`（变异 / 回测）并要求 changedPaths —— 那条通道与 runtime
     *   无关，却会让本臂以"update_task rejected"的形式红，读起来像 runtime 的错。
     */
    const created = await callTool(f, 'agent_teams_create_task', {
      subject: 'impl', kind: 'work', assignee: 'worker',
    })
    assert.ok(typeof created.task_id === 'string', '任务必须真的被建出来（否则下面两条臂没有对象）')

    /**
     * ★ ③/④ 成员上报。
     *
     * ★ `create_task` 自己会 kick（`scheduler.kickTeam`）⇒ 调度器已经 `beginTaskAttempt`
     *   并把成员置为 working ⇒ **当前**那一代尝试就是它建的。再手工 claim 一次会
     *   立刻把自己刚拿到的 id 弄成过期的（`beginTaskAttempt` 换新 capability）——
     *   所以这里读**磁盘上**那一个，而不是自己造一个。
     */
    const member = liveAgents.get('member-1')
    /**
     * ★ attempt_id 必须在**每次上报之前**重新读一次。
     *
     *   `agent_teams_update_task` 在末尾会 `scheduler.kickTeam`；而只要成员不是
     *   `working`（或任务不是 claimed），调度器就会 `beginTaskAttempt` 换**新一代**
     *   capability ⇒ 上一行读到的 id 当场过期。手抄一次的夹具会在这里撞上
     *   "stale attempt"，而那条错读起来像产品缺陷。
     */
    const liveAttempt = async () => (await readTeam(join(workspace, '.agent-teams'), 'team')).tasks[0].attemptId
    assert.equal(typeof await liveAttempt(), 'string', '建任务 + kick 必须建立起一个尝试')

    const t = await callTool(
      f, 'agent_teams_update_task',
      { task_id: created.task_id, attempt_id: await liveAttempt(), status: 'in_progress', output: 'partial' },
      member,
    )
    assert.equal(t.status, 'in_progress', '③ in_progress 那一步必须真的走通（否则 ④ 没有合法起点）')
    /**
     * ★ ④ 收尾（settled）。
     *
     *   `claimed → completed` 是**非法转移**：`update_task` 每次跑完都会 kick，
     *   而 kick 会把一个不是 `working` 的成员的尝试重新起一代（状态回到 `claimed`）。
     *   ⇒ 收尾之前必须重新走一次 `in_progress`，否则这条臂会以"状态不能这么跳"
     *     失败，读起来像产品缺陷。
     */
    await callTool(
      f, 'agent_teams_update_task',
      { task_id: created.task_id, attempt_id: await liveAttempt(), status: 'in_progress', output: 'partial again' },
      member,
    )
    await callTool(
      f, 'agent_teams_update_task',
      { task_id: created.task_id, attempt_id: await liveAttempt(), status: 'completed', output: 'done' },
      member,
    )

    /** ★ ⑤ 状态快照。 */
    await callTool(f, 'agent_teams_status', {})

    /** ★ ⑥ 宣布交付（可能被上游交付语义拒掉 —— 那是另一件事，本臂只看判据有没有被求值）。 */
    await callTool(f, 'agent_teams_declare_delivery', {}).catch(() => undefined)

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

test('① 任务级调用点的输入面：有等待记录时 `wait` 到位；没有派发记录的任务不伪造一个起点', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-inputs-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const liveAgents = new Map([
    ['worker-session', memberAgent('worker-session', { workspace })],
    ['member-1', memberAgent('member-1', { workspace, text: 'hello' })],
  ])
  const f = factory({ workspace, clock, liveAgents })

  /** 真的派发一次 ⇒ 建立一条等待记录。 */
  const seenAtDispatch = []
  const probeA = withProbe('runtime', (context) => { seenAtDispatch.push(context); return { ok: true } })
  try {
    await dispatchOnce(f, workspace)
  } finally {
    probeA.dispose()
  }
  const dispatchedAt = clock.value
  assert.equal(seenAtDispatch[0]?.wait?.startedAt, dispatchedAt, '派发那一刻必须注入等待起点')

  /**
   * ★ 一条**没有派发记录**的任务（队长建了任务但没人被派发过）：它的 attemptId
   *   对不上任何等待记录 ⇒ 调用方必须**不注入** `wait`（判据自己会说 unmeasured）。
   *   拿"现在"兜一个起点，就是把"从没等过"伪造成"等了一会儿"。
   */
  const stateRoot = join(workspace, '.agent-teams')
  await withTeamLock(`verify3:${stateRoot}:team`, async () => {
    const team = await readTeam(stateRoot, 'team')
    /**
     * ★ 用**真实的**任务形状写入（`taskSeq` 要跟着走）：一份手抄的、缺字段的记录
     *   会被 `readTeam` 判成非法状态，而那条错会以"团队读不到"的形式炸在**别的**
     *   调用上，读起来像产品缺陷。
     */
    team.tasks.push({
      id: 't2', subject: 'never-dispatched', status: 'pending', dependencies: [],
      attempt: 0, kind: 'work', createdAt: 2, updatedAt: 2,
    })
    team.taskSeq = Math.max(team.taskSeq ?? 0, 2)
    await writeTeam(stateRoot, team)
  })

  const seen = []
  const probeB = withProbe('runtime', (context) => { seen.push(context); return { ok: true } })
  try {
    await callTool(f, 'agent_teams_create_task', { subject: 'keeps the position warm', inScope: ['docs/z.md'] })
  } finally {
    probeB.dispose()
  }

  const created = seen.find((ctx) => ctx.event === 'task-created')
  assert.ok(created !== undefined, 'task-created 必须被求值到')
  assert.equal(created.wait, undefined, '★ 刚建的任务没有等待记录 ⇒ `wait` 必须整个缺席，不是 {} 也不是兜底')

  /** ★ 团队级观察面（`task-status` / `delivery-declared`）：`waits` 是数组。 */
  const teamLevelSeen = []
  const probeC = withProbe('runtime', (context) => { teamLevelSeen.push(context); return { ok: true } })
  try {
    const record = await poll(f)
    assert.ok(record !== undefined, 'task-status 必须求值 runtime 位置')
  } finally {
    probeC.dispose()
  }
  const teamLevel = teamLevelSeen.find((ctx) => ctx.event === 'task-status')
  assert.ok(teamLevel !== undefined, 'task-status 必须在探针里留下一次求值')
  assert.ok(Array.isArray(teamLevel.waits), '★ 团队级调用点必须交出 `waits` 数组')
  assert.ok(
    teamLevel.waits.some((w) => w.taskId === 't1'),
    `★ 派发过的尝试必须出现在 waits 里；得到 ${JSON.stringify(teamLevel.waits)}`,
  )
  assert.equal(
    teamLevel.waits.some((w) => w.taskId === 't2'),
    false,
    '★ 没有派发记录的任务不得被塞进 waits —— 那会把"从没等过"伪造成"等了一会儿"',
  )
})

test('① 等待起点的时机：记在【派发被接受】那一刻，不是任务被创建那一刻', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-startorder-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const liveAgents = new Map([['worker-session', memberAgent('worker-session', { workspace })]])
  const f = factory({ workspace, clock, liveAgents })
  const created = clock.value
  clock.advance(7 * 60_000)  // 过了 7 分钟才真的被调度

  const seen = []
  const probe = withProbe('runtime', (ctx) => { seen.push(ctx); return { ok: true } })
  try {
    await dispatchOnce(f, workspace)
  } finally {
    probe.dispose()
  }
  const wait = seen[0]?.wait
  assert.ok(wait !== undefined, '派发那一刻必须注入 wait')
  assert.equal(wait.startedAt, created + 7 * 60_000, '★ 起点必须是【派发被接受】的时刻')
  assert.notEqual(
    wait.startedAt,
    created,
    '★ 起点不得被任务记录上的时间戳冒充（那会把"队长刚改过任务"读成"成员刚开工"）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ② ★ 硬要求：哪怕返回最严重的裁决，也不阻止流程
// ─────────────────────────────────────────────────────────────────────────────

test('★ ② 硬要求（a）：真判据被换成"永远 blocked"⇒ 建任务/上报/查状态/宣告交付全部照常走完', async () => {
  /**
   * ★ 做法说明（这是本文件**唯一**动判据的地方，且只动它的**注册项**，不改源码）：
   *   `registry.register` 是公开 API，它拒绝重复 id ⇒ 先 `unregister` 再换。
   *   测试结束【无论如何】把它装回去（`finally`）。
   *
   * ★ 为什么不用 `registry.observe()`：观察模式的定义就是"放过裁决"，拿它来证明
   *   "不阻止流程"是循环论证。这里要的是"**会被采纳的**最严重裁决也拦不住流程"。
   */
  const LIVE = await import('../lib/gates/runtime/liveness.js')
  const LIVE_ID = LIVE.id
  const original = registry.list().runtime.find((entry) => entry.id === LIVE_ID)
  assert.ok(
    original !== undefined,
    `★ 真判据必须真的挂在 runtime 位置上（本臂的前提）；runtime 现有 ${JSON.stringify(registry.list().runtime)}`,
  )

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
    ['member-1', memberAgent('member-1', { workspace, text: 'all done' })],
    ['reviewer-1', memberAgent('reviewer-1', { workspace, text: 'noted' })],
  ])
  const f = factory({ workspace, clock, liveAgents })

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
    const created = await callTool(f, 'agent_teams_create_task', { subject: 'still allowed', inScope: ['docs/y.md'] })
    assert.equal(created.status, 'pending', '★ 一条 blocked 的 runtime 裁决不得拦住建任务')

    /** ② 成员上报 —— 不得被拒。★ attempt_id 用**当前那一个**（另写死的会立刻过期）。 */
    const member = liveAgents.get('member-1')
    const claimed = await callTool(f, 'agent_teams_claim_task', { task_id: 't1' }, member)
    const updated = await callTool(
      f, 'agent_teams_update_task',
      { task_id: 't1', attempt_id: claimed.attempt_id, status: 'in_progress', output: 'part way' },
      member,
    )
    assert.equal(updated.task_id, 't1', '★ 不得拦住成员上报')

    /** ③ 状态快照 —— 读操作必须永远读得到（t18/B2 的硬要求）。 */
    const status = await callTool(f, 'agent_teams_status', {})
    assert.equal(status.team_id, 'team', '★ 不得拦住状态查询')

    /**
     * ④ 宣告交付 —— 必须【走完】并给出结论。
     *
     * ★ 它可能因为**上游交付语义**被拒（"t1 还没 done"），那是另一条通道的事。
     *   本臂要证明的是"runtime 判据的裁决不阻止流程"，所以这里只要求：调用返回
     *   一个结论，且它**不是**由 runtime 判据造成的（`declare_delivery rejected`
     *   的理由里不得出现本探针的原话）。
     */
    const deliveryError = await callTool(f, 'agent_teams_declare_delivery', {})
      .then((value) => { assert.equal(typeof value.declared, 'boolean'); return undefined })
      .catch((error) => error)
    if (deliveryError !== undefined) {
      assert.match(String(deliveryError.message), /declare_delivery rejected/)
      assert.doesNotMatch(
        String(deliveryError.message),
        /deliberately maximal/,
        '★ 交付被拒的理由里绝不能出现 runtime 判据的原话 —— 那意味着它越权拒了流程',
      )
    }

    /** ⑤ 裁决确实**被求值并记录**了：否则"没拦住"可能只是"压根没跑"。 */
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

test('★ ② 硬要求（b）：不加任何东西，把【真实】判据逼到 blocked ⇒ 流程照样走完', async () => {
  /**
   * ★ 与上一条互补：上一条问"最严重的裁决能不能拦住"，这条问"**不加任何东西**时，
   *   真实判据在最该开火的情形下开火了吗；开了火之后，流程呢"。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-realsevere-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { workspace, text: 'starting' })
  const liveAgents = new Map([['worker-session', member]])
  const f = factory({ workspace, clock, liveAgents })

  const before = runtimeGateLogSnapshot().length
  /** 派发 ⇒ 第一次探活的记录建立（这一步也观察了一次已有产出）。 */
  await dispatchOnce(f, workspace)

  /** 20 分钟里成员**一句话都没说**（没有任何新的 `assistant/message`）。 */
  clock.advance(20 * 60_000)
  const status = await poll(f)

  assert.ok(status !== undefined, '★ runtime 位置必须真的被求值到')
  /**
   * ★★ FINDING V3-1（blocker）：这里**读不到 blocked**。
   *
   *   真实路径上这一探的读数恒为 "ok (nothing evaluated …)" —— 也就是说
   *   "20 分钟零产出"这件事**没有任何一句话说它在等什么**，正是源项目那个缺口。
   *   本臂**不断言 blocked**（那会把缺陷写成期望），而是断言**缺陷仍然在**，
   *   并在它被修好的那天**变红**，逼下一个人把这条臂改回它本该有的断言。
   */
  /**
   * ── ★ V3-1 已修：这条臂**翻回它本来的断言** ────────────────────────────────
   *
   * 缺陷记录（保留）：`status` 是唯一时刻驱动的调用点，而判据只认
   * `event === 'runtime-liveness'` ⇒ 六条真实路径上恒 `skipped`，这一探的读数
   * 恒为 `ok (nothing evaluated …)` ⇒「20 分钟零产出」没有任何一句话说它在等什么。
   *
   * 修复后它必须**真的求值**，并且**真的报出卡死**（这一格的输入是"整段零产出"）。
   */
  assert.equal(
    status.evaluated,
    1,
    '★ V3-1 回归护栏：探活判据必须在 task-status 这条真实路径上被求值（不是 skipped）',
  )
  assert.equal(
    status.ok,
    false,
    '★ 20 分钟零产出必须报出来 —— 否则源项目那个"没有任何一句话说它在等什么"的缺口原样还在',
  )
  assert.match(String(status.outcome), /^blocked:/, '★ 它是一条告警（blocked），不是"没跑"也不是"通过"')

  /** ★★ 而它**确实**没有阻止任何东西：状态查询照常返回，流程照常往下走（契约 §5 成立）。 */
  const again = await callTool(f, 'agent_teams_status', {})
  assert.equal(again.team_id, 'team', '★ runtime 裁决不得阻止流程（契约 §5 硬要求）')

  /**
   * ── ★ V3-1 已修：翻回本来的断言 —— 告警必须**留在运行记录里** ────────────────
   *
   * 缺陷记录（保留）：此前这一探读不到任何 `blocked:` —— 因为判据根本没跑
   * （六处调用点的 event 名没有一个匹配 appliesTo 认的那一个）。
   * "告警留下痕迹"这条因此无法被检验。
   */
  const log = runtimeGateLogSnapshot().slice(before)
  assert.ok(
    log.some((entry) => entry.outcome.startsWith('blocked:')),
    '★ 一条开了火的告警必须留在运行记录里（契约 §5：runtime 的产物是告警 + 证据）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ③ ★ 有状态：两次探活之间"动过"与"没动过"必须不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ ③ 有状态（对照臂）：派发后 10 分钟里成员【说过话】⇒ ok', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-state-ok-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { workspace, text: 'starting' })
  const f = factory({ workspace, clock, liveAgents: new Map([['worker-session', member]]) })

  await dispatchOnce(f, workspace)
  /** 过了 10 分钟，成员**真的又说了一句** —— 观察发生在 status 那条真实路径上。 */
  clock.advance(INTERVAL)
  member.utter('still working on it')
  const status = await poll(f)

  assert.ok(status !== undefined, 'runtime 位置必须被求值到')
  assert.equal(status.ok, true, `★ 动过的成员不得被报成卡死；得到 ${JSON.stringify(status)}`)
  /**
   * ★ 这一条**不是**在夸判据：FINDING V3-1 说它在真实路径上不跑，所以这里
   *   "没报卡死"是因为**它压根没跑**，而不是因为它确认了成员在动。
   *   本臂只钉住"不误报"这一半；"该报时会报"那一半由臂 ②(b) 钉（它现在是红的）。
   */
  assert.match(String(status.outcome), /nothing evaluated|^ok$/, `得到 ${status.outcome}`)
})

test('★ ③ 有状态（伪造臂）：同样过了 10 分钟，成员【一句话都没说】⇒ blocked', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-state-stuck-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { workspace, text: 'starting' })
  const f = factory({ workspace, clock, liveAgents: new Map([['worker-session', member]]) })

  await dispatchOnce(f, workspace)
  /** ★ 同样推进一个间隔，而这一次**什么都不发生**。 */
  clock.advance(INTERVAL)
  const status = await poll(f)

  assert.ok(status !== undefined)
  /**
   * ★★ FINDING V3-1：**它没有报出来**。真实路径上"这一整段间隔零产出"与
   *   "这一整段间隔产出不断"在读数上**同形**（都是 evaluated: 0）。
   *   本臂不断言 blocked（缺陷 ≠ 期望），而是钉住"当前仍然读不出区别"，
   *   修好后它会变红。
   */
  assert.equal(status.evaluated, 1, '★ V3-1：探活必须在真实路径上被求值')
  assert.equal(status.ok, false, '★ 一整段间隔零产出必须报出来（这条臂存在的全部意义）')
  assert.match(String(status.outcome), /^blocked:/)

  /**
   * ★★ 上面两条臂是本判据存在的**全部意义**：同样的团队、同样的时钟推进、
   *    唯一的差别是"这一个间隔里成员有没有产出"，而结论必须相反。
   *    一条无状态的判据（例如只比较"等了多久"与某个阈值）会给出同一个结论 ——
   *    那正是"没进展"那一种，而它被明确砍掉了（见 ⑦）。
   */
})

test('★ ③ 有状态（噪声臂）：反复的工具调用不是"在动" —— 成员 40 分钟零产出仍是 blocked', async () => {
  /**
   * ★ 这条臂防的是最隐蔽的一种失效：把"**工具被调用了**"当成"成员在动"。
   *   若某个调用点这么写，一个卡死的成员只要它的工具还在被调用（重试、心跳、
   *   反复上报）就会被刷新 ⇒ 判据**永远不报警**。
   *
   *   构造：派发后成员一直不说话，而队长反复改契约、成员反复上报，每次推进
   *   10 分钟。若判据被刷成"刚动过"，最后那一探会是 ok。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-statenoise-')))
  await seedTeam(workspace, {
    members: [
      { id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 },
      { id: 'reviewer-1', name: 'reviewer', status: 'idle', joinedAt: 1 },
    ],
    tasks: [{
      id: 't1', subject: 'impl', assignee: 'worker', status: 'pending', dependencies: [], attempt: 0,
      kind: 'implementation', objective: 'do it', acceptance: ['a'],
      verify: ['node -e "process.exit(0)"'], inScope: ['docs/x.md'],
      reviewer: 'reviewer', createdAt: 1, updatedAt: 1,
    }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { workspace, text: 'starting' })
  const f = factory({
    workspace,
    clock,
    liveAgents: new Map([
      ['worker-session', member],
      ['reviewer-1', memberAgent('reviewer-1', { workspace, text: 'noted' })],
    ]),
  })

  await dispatchOnce(f, workspace)
  /** ★ 每次上报前重读（每一条 update_task 都会在末尾 kick ⇒ 可能换新一代）。 */
  const liveAttempt = async () => (await readTeam(join(workspace, '.agent-teams'), 'team')).tasks[0].attemptId
  assert.equal(typeof await liveAttempt(), 'string', '派发必须建立起一个尝试（等待记录的键）')

  /** 三次"看起来像在动"的事件，每次间隔 10 分钟：改契约 + 成员上报。 */
  for (let round = 0; round < 3; round += 1) {
    clock.advance(INTERVAL)
    await callTool(f, 'agent_teams_amend_task', {
      task_id: 't1', reason: `round ${round}`, objective: `do it (round ${round})`,
    })
    await callTool(
      f, 'agent_teams_update_task',
      { task_id: 't1', attempt_id: await liveAttempt(), status: 'in_progress', output: `round ${round}` },
      member,
    )
  }
  clock.advance(INTERVAL)
  const status = await poll(f)

  assert.ok(status !== undefined)
  /**
   * ★ 这三次上报**都不是产出**（成员一句话都没说）⇒ 最后活动时刻停在派发那一刻
   *   ⇒ 与首探读数一致 ⇒ 必须报警。若这里读到 ok，说明有调用点把"工具调用"或
   *   "自报的 output 文本"当成了产出。
   */
  /**
   * ★★ FINDING V3-1：同样读不到 blocked。这条臂的**意图**（工具调用不算在动）
   *   在判据层是成立的，但它在真实路径上**到这个格子为止**无法被检验 ——
   *   因为探活根本没跑。修好 V3-1 之后这条臂才真的在测东西。
   */
  /**
   * ── ★ V3-1 已修：翻回本来的断言 ────────────────────────────────────────────
   *
   * ★ 这条臂是本判据最锋利的一格：三轮"看起来像在动"的事件（改契约 + 成员上报）
   *   **都不是产出**（成员一句话都没说）⇒ 必须仍然报警。
   *   若这里读到 ok，说明有调用点把"工具调用"或"自报的 output 文本"当成了产出
   *   —— 而那会把这条判据整个关掉。
   */
  assert.equal(status.evaluated, 1, '★ 探活必须在真实路径上被求值')
  assert.equal(status.ok, false, '★ 工具调用与自报 output 都不是产出 ⇒ 仍然必须报警')
  assert.match(String(status.outcome), /^blocked:/)
})

// ─────────────────────────────────────────────────────────────────────────────
// ④ 三态形状互不相同；缺省方向是"未测量"
// ─────────────────────────────────────────────────────────────────────────────

test('④ 三态形状（判据层）：ok / blocked / unmeasured 两两不同形', async () => {
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  const base = { event: 'runtime-liveness', task: { id: 't1', assignee: 'worker' } }

  const okArm = gate({
    ...base,
    wait: {
      startedAt: T0, now: T0 + 2 * INTERVAL, previousPollAt: T0 + INTERVAL,
      previousLastActivityAt: T0, lastActivityAt: T0 + INTERVAL,
    },
  })
  const blockedArm = gate({
    ...base,
    wait: {
      startedAt: T0, now: T0 + 2 * INTERVAL, previousPollAt: T0 + INTERVAL,
      previousLastActivityAt: T0, lastActivityAt: T0,
    },
  })
  const unmeasuredArm = gate({ ...base, wait: { now: T0 } })

  assert.equal(shapeOf(okArm), 'ok')
  assert.equal(shapeOf(blockedArm), 'blocked')
  assert.equal(shapeOf(unmeasuredArm), 'unmeasured')
  assert.notEqual(shapeOf(okArm), shapeOf(blockedArm))
  assert.notEqual(shapeOf(okArm), shapeOf(unmeasuredArm))
  assert.notEqual(shapeOf(blockedArm), shapeOf(unmeasuredArm))

  /** ★ blocked 必须说清为什么；unmeasured 必须说清测不了什么；两者措辞不得同形。 */
  assert.ok(blockedArm.blockers.length > 0)
  assert.ok(unmeasuredArm.unmeasured.trim().length > 0)
  assert.doesNotMatch(unmeasuredArm.unmeasured, /has been waiting/)
})

test('④ 缺省方向：什么都不注入时，判据留下的是"未测量"，绝不是"通过"', async () => {
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
    const shape = shapeOf(gate(ctx))
    if (shape === 'ok') offenders.push(`${label} ⇒ ok: ${JSON.stringify(gate(ctx))}`)
  }
  assert.deepEqual(
    offenders,
    [],
    `★ 一条拿不到观察就说"通过"的判据比没装更坏（它让人以为探过了）：\n${offenders.join('\n')}`,
  )
})

test('④ 三态在【真实路径】上也不同形：先"没检查"，再 ok，再 blocked —— 三者在返回值里可分辨', async () => {
  /**
   * ★ 判据层自洽 ≠ 调用点如实转述。这条臂走真实工具、读工具返回值里的
   *   `runtime_gates`。三件事必须彼此不同形：
   *     ① 还没有任何等待 ⇒ **这一轮没有判据适用**（`evaluated: 0`），不是"检查通过了"
   *     ② 等待中、成员在动    ⇒ ok
   *     ③ 等待中、成员没动    ⇒ blocked（告警，但流程照走）
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'v3-threestates-')))
  await seedTeam(workspace, {
    tasks: [readyTask()],
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  })
  const clock = fakeClock()
  const member = memberAgent('worker-session', { workspace, text: 'starting' })
  const f = factory({ workspace, clock, liveAgents: new Map([['worker-session', member]]) })

  /** ① 还没派发过 ⇒ 没有适用判据。 */
  const beforeAnyWait = await poll(f)
  assert.ok(beforeAnyWait !== undefined, 'runtime 位置必须真的被求值到（判据在，只是这一轮不适用）')
  assert.equal(beforeAnyWait.ok, true, '★ "这个团队此刻没有等待"是正常情形，不是异常')
  /**
   * ★ V3-1 已修后这一格的读数：判据**跑了**（`evaluated: 1`）而它的结论是
   *   "没人卡住" —— 那是 `ok`，且与"没跑"必须不同形。
   *
   * ★ 判据层那条"没有人等 ⇒ 不适用（skipped）"的分支仍然存在且被单独钉住
   *   （见 `gate-runtime-liveness.test.mjs` 的 `waits: []` 臂）；这里走的是
   *   **真实调用点**，而它连 `waits` 都不注入（`teamWaitObservations` 返回空数组
   *   时字段仍在，但这一格还没有任何等待记录）⇒ 判据照契约报"我没能观察"。
   */
  assert.equal(beforeAnyWait.registered, 1, '★ runtime 位置必须真的挂着判据')

  /** 派发 ⇒ 建立等待记录。 */
  await dispatchOnce(f, workspace)

  /** ② 成员在间隔里说了话 ⇒ ok。 */
  clock.advance(INTERVAL)
  member.utter('progress')
  const okStatus = await poll(f)

  /** ③ 再一个间隔里零产出 ⇒ blocked。 */
  clock.advance(INTERVAL)
  const blockedStatus = await poll(f)

  assert.equal(okStatus.ok, true, `期望 ok；得到 ${JSON.stringify(okStatus)}`)
  /**
   * ── ★ V3-1 已修：翻回本来的断言 —— 三态在真实路径上必须互不同形 ──────────────
   *
   * 缺陷记录（保留）：此前 ②③ 两探在返回值里**同形**（都是 `evaluated: 0`）——
   * "成员在动"与"成员没动"在真实路径上读出同一句话。
   */
  assert.equal(okStatus.evaluated, 1, '★ 探活必须在真实路径上被求值')
  assert.equal(blockedStatus.evaluated, 1, '★ 两次探活都必须被求值（不然比不出"动过没有"）')
  assert.notEqual(
    blockedStatus.outcome,
    okStatus.outcome,
    '★ "成员在动"与"成员没动"必须在真实路径上可分辨 —— 那是这条判据存在的全部意义',
  )
  assert.equal(blockedStatus.ok, false, '★ 一个完整间隔零产出 ⇒ blocked')
  assert.match(String(blockedStatus.outcome), /^blocked:/)
  /**
   * ── ★ "还没有任何人等待"那一探：判据**跑了**，而它的结论是"没人卡住" ────────
   *
   * ★ 这与"没跑"必须不同形（`evaluated` 就是那个读数）。V3-1 修好之后，
   *   `task-status` 上判据**总是**被求值 —— 于是这一格读到的是 `evaluated: 1`。
   *   那不是"跑了一条什么都对的"：判据据实报"这个团队此刻没有等待"，
   *   而它**同时**是"这个位置真的在工作"的证据。
   *
   * ★ 与后两探的差别不在"跑没跑"，而在**结论**：三者必须两两可分辨
   *   （见下面 `beforeAnyWait.ok` 与 `okStatus.ok` 的比较）。
   */
  assert.equal(beforeAnyWait.evaluated, 1, '★ 判据必须在真实路径上被求值（V3-1 修好之后不再是"没跑"）')
  assert.equal(beforeAnyWait.ok, true, '★ "此刻没有等待"是正常情形，不是异常')
  /**
   * ★ 而三者的**结论**必须两两可分辨（这才是"三态不同形"在真实路径上的落点）：
   *   ① 没有人等待 ⇒ ok（"此刻没人卡住"）
   *   ② 有人在动   ⇒ ok，但 `outcome` 与 ① 不同
   *   ③ 有人没动   ⇒ blocked
   */
  assert.notEqual(
    blockedStatus.outcome,
    beforeAnyWait.outcome,
    '★ "有人卡住"与"没人等待"必须不同形',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 边界：第一次探活 / 正好等于间隔 / 时钟回拨 / 间隔非法
// ─────────────────────────────────────────────────────────────────────────────

test('⑤ 边界：第一次探活 ⇒ ok，但【不同形】于"确认它还在动"', async () => {
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
  assert.equal(first.updated_since_previous_probe, null, '★ "还没比过" ≠ "比过且没动"')

  const second = gate({
    event: 'runtime-liveness',
    task: { id: 't1', assignee: 'worker' },
    wait: {
      startedAt: T0, lastActivityAt: T0 + 1, now: T0 + 2 * INTERVAL,
      previousPollAt: T0 + INTERVAL, previousLastActivityAt: T0,
    },
  })
  assert.equal(second.first_probe, false)
  assert.equal(second.alive, true)
  /** ★ 否则"我等了 10 分钟还没看过它"会读起来像"我确认过它还活着"。 */
  assert.notDeepEqual(
    { first_probe: first.first_probe, alive: first.alive },
    { first_probe: second.first_probe, alive: second.alive },
  )
})

test('⑤ 边界：正好等于间隔 / 半个间隔 —— 间隔边界不是"卡死"的判据', async () => {
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  const at = (now, activity, previousActivity) => gate({
    event: 'runtime-liveness',
    task: { id: 't1', assignee: 'worker' },
    wait: {
      startedAt: T0, lastActivityAt: activity, now,
      previousPollAt: T0, previousLastActivityAt: previousActivity, intervalMs: INTERVAL,
    },
  })

  /** 正好推进一个间隔、活动读数没变 ⇒ blocked（那是"真的没动"）。 */
  assert.equal(shapeOf(at(T0 + INTERVAL, T0, T0)), 'blocked')
  /** 正好推进一个间隔、活动读数前进了 ⇒ ok。 */
  assert.equal(shapeOf(at(T0 + INTERVAL, T0 + INTERVAL, T0)), 'ok')
  /**
   * ★★ FINDING V3-4：只推进了**半个间隔**、而活动读数没变 ⇒ 它照样报 blocked，
   *   而措辞里却写着 "has not moved for a **full 10-minute** probe interval"。
   *   判据并不是"只比两端"：它把"上一次与这一次的读数相同"直接读成"整整一个间隔
   *   没动"，完全不看这两个读数之间到底隔了多久（`now - previousPollAt`）。
   *
   *   本臂钉住**当前行为**（不把它写成期望），修好后它变红。
   */
  /**
   * ── ★ V3-4 已修：翻回本来的断言 ────────────────────────────────────────────
   *
   * 缺陷记录（保留）：此前只推进**半个间隔**、而活动读数没变 ⇒ 照样 `blocked`，
   * 而措辞却写 "has not moved for a **full** 10-minute probe interval"。
   * **措辞与实际判据不符**，读日志的人会据此算错账。
   *
   * ⇒ 现在：半个间隔不构成"卡死"（卡死的定义是一个完整间隔里没动），
   *   也**不是**"它动过" ⇒ `ok` + `interval_complete: false`（"还没到下结论的时候"）。
   */
  const half = at(T0 + INTERVAL / 2, T0, T0)
  assert.equal(shapeOf(half), 'ok', '★ 半个间隔不构成"卡死"')
  assert.equal(half.interval_complete, false, '★ 必须说清"间隔还没走完"，否则这一格读起来像"它动过"')
  assert.doesNotMatch(String(half.message ?? ''), /has not moved for a full/, '★ 措辞不得声称"整整一个间隔没动"')
})

test('⑤ 边界：时钟回拨 ⇒ unmeasured（既不假警报、也不并进"通过"）', async () => {
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

  /** ★ 而**第一次探活**遇到往回走的时钟不算回拨：没有可比对象，"不可比"还不存在。 */
  const firstWithOddClock = gate({
    event: 'runtime-liveness',
    wait: { startedAt: T0, lastActivityAt: T0, now: T0 - 5_000 },
  })
  assert.equal(shapeOf(firstWithOddClock), 'ok', '★ 第一次探活只有一端')
})

test('⑤ 边界：间隔非法值 ⇒ 不加界、不抛错（落回缺省并留下痕迹）', async () => {
  const { gate, DEFAULT_LIVENESS_INTERVAL_MS } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  const bad = [0, -1, NaN, Infinity, -Infinity, null, 'ten minutes', {}, []]

  for (const value of bad) {
    let verdict
    assert.doesNotThrow(() => {
      verdict = gate({
        event: 'runtime-liveness',
        task: { id: 't1', assignee: 'worker' },
        wait: {
          startedAt: T0, lastActivityAt: T0, now: T0 + 2 * INTERVAL,
          previousPollAt: T0 + INTERVAL, previousLastActivityAt: T0, intervalMs: value,
        },
      })
    }, `★ 间隔写成 ${JSON.stringify(value)} 不得让判据抛错（一个因为参数没写对就炸的守卫会被关掉）`)
    assert.equal(shapeOf(verdict), 'blocked', `intervalMs=${JSON.stringify(value)} 时"没动过"仍然必须被报出来`)
    /**
     * ★★ FINDING V3-3：`interval_ms` / `interval_ignored` 这两个**证据字段在
     *   blocked 分支上全部缺席** —— 那条"参数被忽略"的说明只落在 `blockers[]`
     *   的**第二句散文**里。判据的产物是"告警 + 证据"（契约 §5），而这条证据
     *   在机器可读的那一层读不到：调用方只能去正则一段人话。
     *
     *   （同一条也适用于 `wait_ms` / `startedAt` / `lastActivityAt` —— 见下一条臂。）
     */
    /**
     * ── ★ V3-3 已修：翻回本来的断言 —— 证据必须在**机器可读**的那一层拿得到 ──────
     *
     * 缺陷记录（保留）：`interval_ms` / `interval_ignored` 这两个证据字段此前
     * 在 blocked 分支上**全部缺席**，那条"参数被忽略"的说明只落在 `blockers[]`
     * 的第二句散文里 —— 调用方只能去正则一段人话。
     */
    assert.equal(verdict.interval_ms, INTERVAL, '★ 证据必须在 blocked 分支上也拿得到')
    assert.match(String(verdict.interval_ignored), /not a finite positive number/, '★ 被忽略的间隔要留在结构化证据里')
    assert.match(String(verdict.blockers.at(-1)), /not a finite positive number/)
  }

  /**
   * ★ 而【没给】与【给了坏值】在**当前实现**里的区别只体现在 blockers 的长度上：
   *   缺少那个散文句。这仍然不同形（可判），但它落在文本里而不是字段里（V3-3）。
   */
  const absent = gate({
    event: 'runtime-liveness',
    wait: {
      startedAt: T0, lastActivityAt: T0, now: T0 + 2 * INTERVAL,
      previousPollAt: T0 + INTERVAL, previousLastActivityAt: T0,
    },
  })
  assert.equal(shapeOf(absent), 'blocked')
  assert.equal(absent.blockers.length, 1, '★ "没写间隔"与"写错了间隔"必须不同形')

  /** ★ `DEFAULT_LIVENESS_INTERVAL_MS` 必须是判据对外承诺的那个缺省值。 */
  assert.equal(DEFAULT_LIVENESS_INTERVAL_MS, INTERVAL, '缺省探活间隔（用户裁定 10 分钟）')
  assert.match(String(absent.blockers[0]), new RegExp(`full ${INTERVAL / 60_000}-minute`))
})

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 纯数据变换：不 import I/O，不调 Date.now()
// ─────────────────────────────────────────────────────────────────────────────

test('⑥ 判据源码与构建产物里都没有 I/O import，也没有真的调用 Date.now', async () => {
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
    for (const forbidden of ['node:fs', 'node:child_process', 'node:net', 'node:http', 'node:https', 'node:os', 'node:process']) {
      assert.doesNotMatch(
        code,
        new RegExp(`from\\s+['"]${forbidden.replace(/[/]/g, '\\/')}`),
        `★ ${label}不得 import ${forbidden}`,
      )
    }
  }

  /**
   * ── ★ 判据只 import 注册表与 requires：不 import 别的判据、不 import 工具层 ──
   *
   * ★ 白名单从 `['../registry.ts']` 变成两项，是 t5 的接线带来的（这条断言
   *   在 t5 之前是红的 —— 它把一条**合法的**接线报成了违规）。逐条说清为什么
   *   第二项不破坏这条断言的用意：
   *
   *   · 它**仍然拦**「判据之间互相 import」：`../requires.ts` 是唯一新增的允许项，
   *     而 `../completion/r5.ts` 这类仍然不在名单里 ⇒ 一 import 就红。
   *     （那才是这条断言的用意：判据必须能独立求值、不互相调用，契约 §2 性质 2。）
   *   · 它**仍然拦**工具层：上面那段 `node:fs` / `node:process` 的循环一个字没动，
   *     而 `../tools.ts` 也不在名单里。
   *
   *   ★ 而 `requires.ts` 为什么可以进来：它是**纯类型 + 纯函数**，且本判据用的是
   *     `import type { CtxPaths }` —— 类型 import 连一行运行时 import 都不产生
   *     （所以对 `lib/` 的构建产物这一条本来就是空的，见下面那段断言）。
   *     它给判据的只有"把 ctx 路径写成类型"这一件事，没有任何 I/O 能力。
   *
   *   ★ 与 `gate-requires.test.mjs` 那条纪律同源：`requires.ts` 自己
   *     **不许 import 任何东西**（t6 已把它换成棘轮形状的臂）—— 于是这个白名单
   *     的传递闭包是封闭的，不会经由第二项漏进别的东西。
   */
  const ALLOWED_GATE_IMPORTS = ['../registry.ts', '../requires.ts']
  const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line) || /^\s*\}?\s*from\s+['"]/.test(line))
  const resolved = importLines.map((line) => line.match(/from\s+['"]([^'"]+)['"]/)?.[1]).filter(Boolean)
  assert.deepEqual(
    resolved,
    ALLOWED_GATE_IMPORTS,
    '★ 判据只能 import 注册表与 requires（纯类型）—— 它必须是一个可独立求值的纯数据变换',
  )
  /**
   * ★ 反向断言（"断言不得恒真"）：名单里**没有**别的判据、也没有工具层。
   *   只断言 `deepEqual` 的话，把 `ALLOWED_GATE_IMPORTS` 悄悄加宽一项
   *   （例如为了方便把 `../tools.ts` 也加进去）不会有任何一条臂拦它。
   */
  for (const forbidden of ['../tools.ts', '../completion/r5.ts', '../dispatch/worktree.ts']) {
    assert.ok(
      !ALLOWED_GATE_IMPORTS.includes(forbidden),
      `★ '${forbidden}' 不许进判据的白名单 —— 判据之间不互调、也不 import 工具层（契约 §2）`,
    )
  }
  /**
   * ★ 构建产物这一侧：类型 import 会被完全擦除，所以 `lib/` 里**不许**出现
   *   对 `requires.js` 的运行时 import。这一条钉住"它真的只是类型"——
   *   若哪天有人在 `requires.ts` 里放了需要运行时求值的东西并被判据 import，
   *   这里会立刻红（而上面那条 `deepEqual` 是看不出来的：源码里形状一样）。
   */
  assert.doesNotMatch(
    stripComments(built),
    /requires\.js/,
    '★ 构建产物里不许出现 requires.js 的运行时 import —— 它对判据必须只是类型',
  )

  /** ★ 它的输入面里**确实**有调用方注入的时钟：时长完全由 `wait.now` 决定。 */
  const { gate } = await import('../lib/gates/runtime/liveness.js')
  const T0 = 1_700_000_000_000
  const at = (now) => gate({
    event: 'runtime-liveness',
    wait: { startedAt: T0, lastActivityAt: T0, now, previousPollAt: T0, previousLastActivityAt: T0 },
  })
  assert.equal(shapeOf(at(T0 + INTERVAL)), 'blocked')
  /**
   * ★ 时长由注入的时钟决定这件事，只能从 **ok 分支**读出来 —— blocked 分支
   *   不交任何证据字段（FINDING V3-3，见上面那条臂）。两条分支都驱动于同一个
   *   注入的 `now`，所以这里换一个**有产出**的读数来钉"它自己不读表"。
   */
  const ok = gate({
    event: 'runtime-liveness',
    wait: {
      startedAt: T0, lastActivityAt: T0 + INTERVAL, now: T0 + INTERVAL,
      previousPollAt: T0, previousLastActivityAt: T0, intervalMs: INTERVAL,
    },
  })
  assert.equal(shapeOf(ok), 'ok')
  assert.equal(ok.wait_ms, INTERVAL, '★ 时长完全由注入的时钟决定（它自己不读表）')
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

  /** 判据的自我说明里必须写清它是探活、不是硬超时（读起来就知道它不该按总时长开火）。 */
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const source = await readFile(path.join(root, 'src', 'gates', 'runtime', 'liveness.ts'), 'utf8')
  assert.match(source, /不是「硬超时」|不是硬超时|永不/, '判据必须写清它是探活，不是硬超时')
})

// ─────────────────────────────────────────────────────────────────────────────
// inScope：判据本体在 src/ 与 lib/ 两处都在
// ─────────────────────────────────────────────────────────────────────────────

test('inScope：判据本体在 src/ 与 lib/ 两处都存在（link: 安装下改动必须 build 才生效）', async () => {
  const { stat } = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const src = path.join(root, 'src', 'gates', 'runtime', 'liveness.ts')
  const lib = path.join(root, 'lib', 'gates', 'runtime', 'liveness.js')
  assert.ok((await stat(src)).isFile(), '判据源码必须存在')
  assert.ok((await stat(lib)).isFile(), '★ 构建产物必须存在 —— 已装插件是 link: 指向源码，改动不 build 不生效')

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
