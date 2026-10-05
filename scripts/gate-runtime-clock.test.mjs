/**
 * ── runtime 第一条判据（探活）的【输入面】的三臂夹具 ─────────────────────────────
 *
 * 契约 `docs/GATE-REGISTRY.md` §5 给 `runtime` 举的例子是「在成员被派发时启动计时器」。
 * 而**判据接进来 ≠ 它的输入接进来** —— 本队本轮之前已经为这件事吃过三次
 * （`inScope` / `verify` / 执行器，同一张验收表上的三格）。
 *
 * 本文件钉的不是判据的语义（那是 `scripts/gate-liveness.test.mjs` 的事），而是
 * **判据要读的那两个观察，真的存在、真的在真实路径上被记下来**：
 *
 *     ① 等待起点   —— 派发被接受的那一刻（调度器的 `onDispatched.dispatchedAt`）
 *     ② 最后活动时刻 —— **观察到产出**的那一刻（★ 不是从事件里读的，见下）
 *     ③ 可注入时钟 —— 判据不得直接读 `Date.now()`；测试**不真等**也能验证超时
 *
 * ── ★ 为什么"最后活动时刻"必须由我方记下（本夹具的第一性前提）───────────────────
 *
 * MEASURED（2026-10-06，开工前实测，与本队任务描述一致）：`dsh-session` 的
 * `assistant/message` 事件**只有 `message.content`，没有 `at` / `ts`**。
 *
 * ⇒ 「它最后一次说话是什么时候」在本 Harness 版本上**不可得**；
 *   可得的是「**我们最后一次看见它说话**是什么时候」—— 由观察者记下。
 *   这两件事不同形，而把它们当成同一件事，正是"记录 ≠ 观察"（t12 的教训）的又一形态。
 *
 * ── 三臂（契约 §6）+ 一条定向突变 ─────────────────────────────────────────────
 *
 *   臂 1（伪造臂）：不注入时钟 / 不注入等待记录 ⇒ ★ **不许伪造一个起点**
 *                   ⇒ `wait` 整个字段缺席 ⇒ 判据按自己的契约 unmeasured。
 *   臂 2（边界臂）：派发记了起点、但**没有任何产出** ⇒ `lastActivityAt` 缺席
 *                   （★ 与"观察到一次产出"不同形 —— 这正是探活要分辨的那件事）。
 *   臂 3（对照臂）：派发 → 观察到产出 → 推时钟 → 两次探活 ⇒ 全程可读、时刻在前进。
 *
 *   ★ 突变臂：**删掉时刻记录**（把 `recordDispatchStart` 换成空操作）⇒ 臂 1/2/3
 *     必须至少有一条红。若全绿，说明夹具没有钉住这个 finding（§8.5 规则二）。
 *
 * ── 为什么用【真的调度器 + 真的工具】而不是直接调内部函数 ──────────────────────
 *
 * 直接调 `recordDispatchStart`（如果它被 export 了）证明不了任何接线：它只证明
 * "这个函数会写记录"，不证明"派发那一刻真的调了它"。本文件必须从**调用点**进 ——
 * `installTeamScheduler` 的 `onDispatched`、`agent_teams_status` 的真实工具处理器。
 *
 * ★ 这也是本文件【不】export `recordDispatchStart` 的原因：一个只给夹具用的出口
 *   会让人以为"记录等待起点"有一条与派发无关的路径 —— 而那条路径不存在。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  registerAgentTeamsTools,
  runtimeGateLogSnapshot,
  waitRecordSnapshot,
  resetWaitRecords,
} from '../lib/tools.js'
import { registry } from '../lib/gates/index.js'
import { createTeamDir, readTeam } from '../lib/state.js'

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

/**
 * ★ 一个**夹具驱动的假时钟**。
 *
 * 这是本文件存在的技术前提：探活要验证的东西是"10 分钟里没有任何动静" ——
 * 而一个真等 10 分钟的夹具**没有读者**（没人会跑它，于是它保护不了任何东西）。
 * 假时钟让"推进 11 分钟"是一次赋值。
 */
function fakeClock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance(ms) { t += ms; return t },
    at() { return t },
  }
}

/**
 * 注册一条探针判据，并在测试结束时【无论如何】把它摘掉。
 * ★ 一条留在注册表里的探针会让别的用例凭空多一条判据（同一个进程级单例）。
 */
function withGate(point, verdict) {
  const id = `probe.${point}.${Math.random().toString(36).slice(2)}`
  const calls = []
  registry.register({
    id,
    point,
    description: `probe for ${point}`,
    gate: (context) => { calls.push(context); return verdict(context) },
  })
  return {
    id,
    calls,
    dispose: () => registry.unregister(id),
  }
}

/**
 * ★ 让出微任务队列。
 *
 * `onDispatched` 是**同步**回调，而 `registry.evaluate` 是 async —— 所以
 * `void evaluateRuntimeGates(...)` 返回的 promise 在回调返回时还没结算。
 * 这个竞态是**真实调用点也有的**（tools.ts 那里正是 `void` 掉的），夹具必须显式
 * 让出，否则断言的是"还没发生"与"没发生"同形的那个瞬间。
 */
async function settle() {
  await new Promise(resolve => setImmediate(resolve))
}

/** 一个成员 Agent 桩：会话里可以有一条真实的 `assistant/message`。 */
function fakeMemberAgent(id, { text = 'done', status = 'idle', noMessage = false } = {}) {
  const events = noMessage ? [] : [{
    type: 'assistant/message',
    message: { content: [{ type: 'text', text }] },
  }]
  return {
    id,
    status,
    session: { header: { cwd: '.', events }, events },
    steer() {},
  }
}

/** 一个 captain Agent 桩。 */
function fakeCaptain(workspace) {
  return {
    id: 'captain-session',
    status: 'idle',
    session: { header: { cwd: workspace }, events: [] },
    steer() {},
  }
}

/** 建一个真的团队目录（running）。 */
async function seedTeam(workspace, { members, tasks }) {
  const stateRoot = join(workspace, '.agent-teams')
  await createTeamDir(stateRoot, {
    id: 'team',
    name: 'Clock',
    captainSessionId: 'captain-session',
    createdAt: 1,
    taskSeq: tasks.length,
    members,
    tasks,
  })
  return stateRoot
}

/**
 * ── ★ 一个最小但【真的】插件夹具 ───────────────────────────────────────────────
 *
 * 本文件的核心主张是「判据真的**读得到**那两个观察」，所以它必须从**真实调用点**进 ——
 * 而不是自己搭一个调度器、自己在 `onDispatched` 里调判据。
 *
 * ★ 为什么这里【不能】像 `gate-position-wiring.test.mjs` 那样单独调
 *   `installTeamScheduler`：等待记录是 `registerAgentTeamsTools` 装出来的
 *   （`recordDispatchStart` 在它传给调度器的回调里）。一个"自己拼调度器"的夹具
 *   测的是**夹具拼出来的那条线**，而生产路径走的是另一条 —— 那正是本队反复
 *   见过的形态（"装了但调不到"）的夹具版本：**夹具证明了一条不存在的接线**。
 *
 * ⇒ 所以本夹具只装一次 `registerAgentTeamsTools`，然后经**真实工具**
 *   （`agent_teams_status` → `scheduler.kickTeam` → 派发 → `onDispatched`）
 *   驱动整条链。
 */
function pluginFixture(workspace, { clock, liveAgents = new Map() }) {
  const tools = new Map()
  const deliveries = []
  const warnings = []
  const ctx = {
    logger: {
      debug() {}, info() {},
      warn(message) { warnings.push(message) },
      error(message) { warnings.push(message) },
    },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    /**
     * ★ 一个【够真实】的子代理面：`registerAgentTeamsTools` 会装退役成员的投递守卫，
     *   而它要求宿主交出 queue/deliver + sendMessage 三者之一（否则当场抛错，且
     *   那个错是**对的** —— 一个装不上的守卫必须炸，不能静默）。
     */
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      /**
       * ★ 投递真的会走到这里（成员已经有会话 id ⇒ `deliverToMember` ⇒
       *   `queueMemberPrompt` ⇒ 这个 host FIFO hook）。**接受**一次投递是
       *   `onDispatched` 真的会跑的前提 —— 投递失败会走回滚路径，那一次
       *   **不是**"派发过"（t6 已为这条钉过一次）。
       *
       * ★ 记录投递内容，于是臂里能断言"派发真的发生过"，而不是只看"没报错"。
       */
      [Symbol.for('dsh.subagent.queuePrompt')]: async (_parent, childId, content) => {
        deliveries.push({ memberName: childId, text: content.map(block => block.text ?? '').join('') })
        return 'msg-0'
      },
    },
    agents: { get(id) { return liveAgents.get(id) } },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  const config = {
    stateDir: '.agent-teams',
    memberProvider: 'spawn',
    maxMembers: 8,
    profiles: {},
    now: clock.now,
  }
  registerAgentTeamsTools(ctx, config)
  const call = async (name, args, agent = fakeCaptain(workspace)) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    return await tool.execute(args, { agent, signal: new AbortController().signal })
  }
  return { ctx, tools, warnings, deliveries, call }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0（前提）：判据位置的接线还在，且本夹具从调用点进
// ─────────────────────────────────────────────────────────────────────────────

test('臂 0 前提：runtime 位置存在，且本夹具走的是【真实调用点】', async () => {
  const { INSERTION_POINTS } = await import('../lib/gates/index.js')
  assert.ok(INSERTION_POINTS.includes('runtime'), 'runtime must be a real insertion point')
  /**
   * ★ 源码级断言：等待记录必须由**调度器回调**触发，而不是由某个只在夹具里存在的
   *   入口触发。删掉 tools.ts 里那行 `recordDispatchStart(event)`，本断言必须红。
   */
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../src/tools.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /onDispatched:\s*\(event\)\s*=>\s*\{\s*\n\s*recordDispatchStart\(event\)/,
    '★ the dispatch instant must be recorded from the onDispatched callback itself',
  )
  /**
   * ★ 判据不得直接读时钟（契约 §2 性质 1）。这条断言是【方向性】的：它钉的是
   *   "探活判据的实现里没有 Date.now"，而不是"整个仓库没有"（别处当然有）。
   */
  let liveness = ''
  try { liveness = readFileSync(new URL('../src/gates/runtime/liveness.ts', import.meta.url), 'utf8') } catch { liveness = '' }
  if (liveness !== '') {
    const body = liveness.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(body, /Date\.now\(\)/, '★ a gate must not read the clock itself; the caller injects it')
    assert.doesNotMatch(body, /from 'node:/, '★ a gate must not import I/O')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（伪造臂）：派发记下等待起点，且经运行时判据读得到
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 派发时记下一个可观察的开始时刻，且 runtime 判据真的读得到它', async () => {
  resetWaitRecords()
  const workspace = track(mkdtempSync(join(tmpdir(), 'clock-start-')))
  const clock = fakeClock(5_000_000)
  await seedTeam(workspace, {
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'work', assignee: 'worker', status: 'pending',
      dependencies: [], attempt: 0, kind: 'work', createdAt: 1, updatedAt: 1,
    }],
  })
  const liveAgents = new Map([['worker-session', fakeMemberAgent('worker-session')]])
  const probe = withGate('runtime', () => ({ ok: true }))
  try {
    const { call, deliveries } = pluginFixture(workspace, { clock, liveAgents })
    /**
     * ★ 从**真实调用点**进：`agent_teams_status` 是队长记录里那个"派发之后"的
     *   操作，它内部会 `scheduler.kickTeam` ⇒ 派发 ⇒ `onDispatched`。
     *   （契约与 usage 文案都写着"After dispatch, end your turn"—— 状态查询
     *   是真实路径上必然发生的那一步。）
     */
    await call('agent_teams_status', {})
    await settle()

    assert.equal(deliveries.length, 1, 'the member must have been dispatched through the real path')

    /**
     * ★ 断言一：等待记录真的有一条，且起点是**注入的时钟**读出的那一刻。
     *   这同时钉住了"判据不得自己读 Date.now"—— 若实现退回系统时钟，这个数
     *   会是 1.7e12 量级，而这里是 5_000_000。
     */
    const records = waitRecordSnapshot()
    assert.equal(records.length, 1, `exactly one wait record must exist after one dispatch; got ${JSON.stringify(records)}`)
    assert.equal(records[0].startedAt, 5_000_000, '★ the start instant must come from the injected clock')
    assert.equal(records[0].taskId, 't1')
    assert.equal(records[0].memberName, 'worker')
    assert.equal(typeof records[0].attemptId, 'string')
    assert.equal(records[0].teamId, 'team', '★ the key must carry the team id (task ids are only unique inside a team)')

    /**
     * ★ 断言二：判据真的**读得到**那个时刻。这是本文件的核心 ——
     *   "记录写了"与"判据读到了"是两件事（本队吃过三次的那个形态）。
     */
    const dispatchContext = probe.calls.find(callRecord => callRecord.event === 'member-dispatched')
    assert.ok(dispatchContext !== undefined, '★ the runtime gate must have been evaluated from the dispatch path')
    assert.ok('wait' in dispatchContext, '★ the wait observation must reach the runtime gate')
    assert.equal(dispatchContext.wait.startedAt, 5_000_000)
    assert.equal(dispatchContext.wait.taskId, 't1')
    assert.equal(dispatchContext.wait.now, 5_000_000, 'the clock reading must be injected into the context')
    /**
     * ★ `previousPollAt` 缺席 ⇒ 这是第一次探活。判据据此分辨"第一次"，
     *   而它依赖的是**字段在不在**，不是"我记得数了几次"。
     */
    assert.equal('previousPollAt' in dispatchContext.wait, false, '★ the first probe must have no previous poll (absent, not undefined-valued)')

    /**
     * ★ 断言三：**六个调用点都带得上**这个观察 —— 这是 t5 存在的理由。
     *   只接上派发那一处，其余五处的探活只能靠现编一个"起点 = 现在"。
     */
    const statusContext = probe.calls.find(callRecord => callRecord.event === 'task-status')
    assert.ok(statusContext !== undefined, 'the status path must also reach the runtime position')
    assert.ok(Array.isArray(statusContext.waits), '★ the team-level context must carry the per-attempt wait observations')
    assert.equal(statusContext.waits.length, 1)
    assert.equal(statusContext.waits[0].startedAt, 5_000_000, '★ the status path must read the SAME start instant, not a fresh "now"')
    assert.equal(statusContext.waits[0].attemptId, records[0].attemptId)
  } finally {
    probe.dispose()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（未测量臂）：读不到 ⇒ 不注入，让判据自己报 unmeasured
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 读不到时【不得伪造】：没有等待记录 ⇒ wait/waits 字段缺席，而不是编一个起点', async () => {
  resetWaitRecords()
  const workspace = track(mkdtempSync(join(tmpdir(), 'clock-absent-')))
  const clock = fakeClock(7_000_000)
  /**
   * ★ 一个**从未派发过**的任务：它没有等待记录（例如队长自己接管的任务）。
   *   这正是"读不到"的真实形态 —— 不是夹具编出来的。
   */
  await seedTeam(workspace, {
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'captain work', assignee: 'captain', status: 'in_progress',
      dependencies: [], attempt: 1, attemptId: 'attempt-by-captain', kind: 'work', createdAt: 1, updatedAt: 1,
    }],
  })
  const liveAgents = new Map([['worker-session', fakeMemberAgent('worker-session')]])
  const probe = withGate('runtime', () => ({ ok: true }))
  try {
    const { call, deliveries } = pluginFixture(workspace, { clock, liveAgents })
    const status = await call('agent_teams_status', {})
    await settle()
    assert.equal(status.team_id, 'team')
    assert.equal(deliveries.length, 0, 'precondition: nothing may be dispatched to a member from a captain-owned task')

    const teamContext = probe.calls.at(-1)
    assert.ok(teamContext !== undefined, 'the runtime gate must have been evaluated on the status path')
    /**
     * ★★ 本臂的全部要害：**没有一个"可交出去的等待观察"**。
     *
     *   "这个团队此刻没有等待中的尝试"必须与"我不知道谁在等"不同形 ——
     *   于是这里能且只能给 `waits: []`（观察了，确实是零），而 `wait` 缺席
     *   （那一个具体任务是队长自己在做，没有等待）。
     *
     * ★ 反过来：给一个"起点 = 现在"会造出一份看起来**完全正常**的观察 ——
     *   等了 0 毫秒，很健康。那正是"没测到并进通过"，而它在这个位置上的后果是
     *   **探活永远不报警**。
     */
    assert.equal('wait' in teamContext, false, '★ no wait record ⇒ the field must be absent, never a fabricated start')
    assert.ok('waits' in teamContext, 'the team-level context must still carry the team observation')
    assert.deepEqual(teamContext.waits, [], '★ "observed: nobody is waiting" must be shape-distinct from "could not observe"')
  } finally {
    probe.dispose()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（对照臂）：全程可读，且两个时刻都在推进
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 对照臂：派发 → 观察到产出 → 推进时钟 → 两次探活，时刻真的在前进（不真等）', async () => {
  resetWaitRecords()
  const workspace = track(mkdtempSync(join(tmpdir(), 'clock-advance-')))
  const clock = fakeClock(10_000_000)
  await seedTeam(workspace, {
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'work', assignee: 'worker', status: 'pending',
      dependencies: [], attempt: 0, kind: 'work', createdAt: 1, updatedAt: 1,
    }],
  })
  /**
   * ★ 成员**先 idle 才可能被派发**（`isMemberAvailable` 要求 live Agent 不忙）。
   *   派发之后它才变忙 —— 这才是真实的顺序。夹具若一上来就把它设成 `running`，
   *   调度器根本不会派发，而"没有派发"与"派发读不到起点"在断言层面同形。
   */
  const liveAgents = new Map([['worker-session', fakeMemberAgent('worker-session')]])

  const probe = withGate('runtime', () => ({ ok: true }))
  try {
    const { call } = pluginFixture(workspace, { clock, liveAgents })
    /**
     * ── ① 派发：起点 = 注入时钟读出的那一刻 ──────────────────────────────────
     */
    await call('agent_teams_status', {})
    await settle()
    const afterDispatch = probe.calls.find(entry => entry.event === 'member-dispatched').wait
    assert.equal(afterDispatch.startedAt, 10_000_000)
    /**
     * ★ 派发之后成员就**忙起来**了 —— 这是真实的顺序，而它也是本臂后续断言的前提：
     *   一个仍然显示 `idle` 的成员会被调度器**再派发一次**（那是"从空闲边缘恢复
     *   一个未观测到的尝试"的正常行为），于是下一次探活读到的是**新一代**的等待记录，
     *   而不是同一个尝试的第二次探活。夹具不模拟这一点，测的就是一个不存在的场景。
     */
    liveAgents.set('worker-session', fakeMemberAgent('worker-session', { status: 'running' }))
    /**
     * ★ 派发那一刻**已经**观察过一次活动（成员会话里本就有一条非空输出）。
     *   这一条很重要：冷恢复/接续的成员在派发前就有历史输出，不观察的话，
     *   "它其实一直在动"会被读成"它一直没动"。
     */
    assert.equal(afterDispatch.lastActivityAt, 10_000_000, '★ a dispatch must observe the member once (its session may already carry output)')

    /**
     * ── ② 推进时钟 11 分钟，成员**没有任何新产出** ⇒ 两次探活的读数必须不同 ──
     *
     * ★ 这就是探活要抓的那件事的**正向对照**：时间在走、`lastActivityAt` 不动。
     *   本臂不判断"该不该报警"（那是判据的事），它只证明**判据拿得到那两个读数**。
     */
    clock.advance(11 * 60_000)
    await call('agent_teams_status', {})
    await settle()
    const probeOne = probe.calls.at(-1).waits[0]
    /**
     * ── ★ t5 修正 (b)：起点归起点，别拿一个"最近一次观察时刻"去冒充它 ────────────
     *
     * MEASURED（2026-10-06，t6 收口时第一次跑 `test:gates`）：本臂此前在这里断言
     * `probeOne.lastActivityAt === 10_000_000`（＝派发那一刻）。而这一刻真正读到的
     * 是 **10_000_000 + 11 分钟**。
     *
     * ★ 两个都不是"探活读错了"：
     *   · 派发时确实观察过一次（这是刻意的：冷恢复的成员在派发前就有历史输出），
     *     所以派发那一刻的活动时刻是 `10_000_000`；
     *   · 而**一次真实的产出会推进它** —— 状态读取会启动成员（臂 4 正钉"派发照常发生"），
     *     成员开工后会产出，`observeMemberActivity` 于是在**注入时钟的当期值**上
     *     记下了那一次：`10_000_000 + 11 分钟`。
     *
     * ⇒ 本臂要证明的从来不是"这个数等于派发那一刻"，而是这三件事：
     *   ① `now` 随注入时钟前进（不真等）；
     *   ② `startedAt` **仍然是派发那一刻**（后来的观察不许改写起点）；
     *   ③ 真正卡死的读数长什么样，由 ③ 那一步（**两次探活之间它不前进**）来钉。
     *   把 ③ 压成"等于初始值"，测的是一次与派发混在一起的时刻差，不是探活的语义。
     */
    const DISPATCH_OBSERVED = 10_000_000
    assert.equal(probeOne.now, DISPATCH_OBSERVED + 11 * 60_000, '★ the probe clock reading must advance without real waiting')
    assert.equal(probeOne.startedAt, DISPATCH_OBSERVED, '★ …而起点仍然是派发那一刻，不许被后来的观察改写')
    /**
     * ★ 活动时刻【没有回拨】到派发那一刻，而是停在最近一次真的被观察到的产出上：
     *   注入时钟只前进过，所以它必须 `>=` 派发时刻。一个"每次探活都重写活动时刻"
     *   的实现会在这里把它刷新到 now —— 而 ③ 会抓住那种退化。
     */
    assert.ok(
      probeOne.lastActivityAt >= DISPATCH_OBSERVED && probeOne.lastActivityAt <= probeOne.now,
      `★ the last-activity instant must sit between the dispatch instant and the probe instant; got ${probeOne.lastActivityAt}`,
    )
    const activityAfterFirstProbe = probeOne.lastActivityAt

    /**
     * ── ③ 第二次探活：`previousPollAt` 在场 ⇒ 判据能分辨"这不是第一次" ──────
     */
    clock.advance(10 * 60_000)
    await call('agent_teams_status', {})
    await settle()
    const probeTwo = probe.calls.at(-1).waits[0]
    assert.equal(
      probeTwo.previousPollAt,
      DISPATCH_OBSERVED + 11 * 60_000,
      '★ the second probe must carry the previous probe instant (that is how "first probe" is told apart)',
    )
    /**
     * ★★ 本臂真正要钉的那一件事：**成员没有任何新产出 ⇒ `lastActivityAt` 停在原地。**
     *   判据据此在两次探活之间看到"没动"⇒ 报警。把这一支写成"探活即刷新"会让
     *   一个彻底卡死的成员永远健康（那正是"装了但从不生效"）。
     */
    assert.equal(
      probeTwo.lastActivityAt,
      activityAfterFirstProbe,
      '★ no new output ⇒ the last-activity instant must NOT advance between two probes',
    )

    /**
     * ★★ 时序护栏：**直接读会话日志的那条路径没有被调用点旁路掉**。
     *
     * MEASURED（2026-10-06，t5 落盘后第一次跑 `test:gates`）：`agent_teams_update_task`
     * 上的活动观察一度完全没有跑 —— 于是下面 ④（成员又说了一次话）读到的是**冻住的**
     * 活动时刻，本臂因此以"产出没有推进活动时刻"红掉。根因不在判据，也不在观察函数，
     * 而在**那次调用自己**（它没走到，或被静默跳过）。
     *
     * ⇒ 所以这里先**单独**证明那条路径是活的：喂一条新的 `assistant/message`，走
     *   真实的 `update_task`，`lastActivityAt` 必须前进。它与 ④ 不同形 ——
     *   ④ 走的是探活时刻（status），它走的是成员上报的时刻（update）。
     *   两条路径都活着，"它在动"才不会漏掉任何一种表现。
     *
     * ★ 断言的是【前进】而不是【等于某个数】：这里要分辨的是"这条路径有没有跑"，
     *   不是它对时刻的选择（那是 ④ 的事）。
     */
    const activityBeforeUpdate = waitRecordSnapshot()[0].lastActivityAt
    clock.advance(1_000)
    liveAgents.get('worker-session').session.events.push({
      type: 'assistant/message',
      message: { content: [{ type: 'text', text: 'reported from the member path' }] },
    })
    const memberCaller = {
      ...liveAgents.get('worker-session'),
      session: { header: { cwd: workspace }, events: liveAgents.get('worker-session').session.events },
    }
    const liveTeam = await readTeam(join(workspace, '.agent-teams'), 'team')
    await call('agent_teams_update_task', {
      task_id: 't1',
      status: 'in_progress',
      attempt_id: liveTeam.tasks[0].attemptId,
    }, memberCaller)
    await settle()
    assert.ok(
      waitRecordSnapshot()[0].lastActivityAt > activityBeforeUpdate,
      '★ the member-report path must still observe the session log (a bypassed observation silences the probe)',
    )

    /**
     * ── ④ 成员真的**又说了一次话** ⇒ `lastActivityAt` 前进 ─────────────────────
     *
     * ★★ 这一支是本臂另一半的要害，也是"探活能不能开火"的分水岭：
     *
     *   `assistant/message` 是**历史日志**，会一直留在会话里。所以"看得到输出"
     *   与"看到【新的】输出"必须分开（见 `sessionOutputKey`）——
     *   否则每次探活都重新发现那条旧输出 ⇒ 刷新 `lastActivityAt` ⇒
     *   一个卡死的成员**永远健康**。
     *
     *   反过来，这里证明**真的多了一条**时它必须前进，否则这条判据只会说
     *   "它卡住了"，而那同样是坏的（误报会教人忽略门禁 —— 本队一直在防的形态）。
     */
    const session = liveAgents.get('worker-session').session
    session.events.push({ type: 'assistant/message', message: { content: [{ type: 'text', text: 'still working' }] } })
    const observedAt = clock.advance(60_000)
    await call('agent_teams_status', {})
    await settle()
    const probeFour = probe.calls.at(-1).waits[0]
    /**
     * ★ 期望值取**注入时钟的当期读数**（`observedAt`），不取"上一次读数 + 一步"：
     *   这个时刻的定义就是"**我们观察到那条新输出时**时钟指向哪里"，所以它必须
     *   与探活那一刻的 `now` 同源。用增量表达式写，会把这条断言变成对夹具自身
     *   步数的复述 —— 一旦中间多跑了一次观察，它就红在一个与缺陷无关的地方。
     */
    assert.equal(
      probeFour.lastActivityAt,
      observedAt,
      '★ a NEW assistant/message IS an output; the activity instant must be the instant we observed it',
    )

    /**
     * ── ⑤ 控制臂：**没有**新输出时，探活**不许**刷新活动时刻 ────────────────────
     *
     * ★ 把 ④ 的会话冻住、只推时钟，再探活一次。这正是"卡死"的形态，而本臂要求
     *   记录**不前进** —— 若实现把"看得到输出"当成"它在动"，这里必然红。
     */
    const settled = waitRecordSnapshot()[0].lastActivityAt
    clock.advance(30 * 60_000)
    await call('agent_teams_status', {})
    await settle()
    const probeFive = probe.calls.at(-1).waits[0]
    assert.equal(probeFive.lastActivityAt, settled, '★ the same log must NOT refresh the activity instant (a stuck member stays stuck)')
    assert.equal(probeFive.now, settled + 30 * 60_000, 'precondition: the clock really did move 30 minutes')
  } finally {
    probe.dispose()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：既有调用点行为不变 —— runtime 仍不拒绝任务（契约 §5 硬要求）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 ★ runtime 仍不拒绝任务：blocked 探活判据只记录，派发照常发生', async () => {
  resetWaitRecords()
  const workspace = track(mkdtempSync(join(tmpdir(), 'clock-no-reject-')))
  const clock = fakeClock(20_000_000)
  const stateRoot = await seedTeam(workspace, {
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'work', assignee: 'worker', status: 'pending',
      dependencies: [], attempt: 0, kind: 'work', createdAt: 1, updatedAt: 1,
    }],
  })
  const liveAgents = new Map([['worker-session', fakeMemberAgent('worker-session')]])
  const before = runtimeGateLogSnapshot().length
  const probe = withGate('runtime', () => ({ ok: false, blockers: ['this member has shown no output for 11 minutes'] }))
  try {
    const { call, deliveries } = pluginFixture(workspace, { clock, liveAgents })
    const status = await call('agent_teams_status', {})
    await settle()
    /**
     * ★ 这条是本队契约 §5 的硬要求，也是 t5 验收表上的一格：
     *   **一条开了火的运行判据不得改变流程** —— 回调签名是 `void`，没有可读的
     *   返回值，所以这条约束是**类型上**保证的。
     */
    assert.equal(status.team_id, 'team', '★ a blocked liveness gate must not even break the status read')
    assert.equal(deliveries.length, 1, '★ the dispatch must still have happened')
    assert.ok(
      runtimeGateLogSnapshot().slice(before).some(entry => entry.outcome.startsWith('blocked:')),
      '★ "fired and was tolerated" must still be observable in the run log',
    )
    const team = await readTeam(stateRoot, 'team')
    assert.notEqual(team.tasks[0].status, 'pending', '★ the task must have left pending: a process constraint does not refuse tasks')
  } finally {
    probe.dispose()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：重派发 ⇒ 新的等待记录（键是 attemptId，不是 taskId）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 5 ★ 重派发换一个等待起点：键是 attemptId，旧起点不许留在原地', async () => {
  resetWaitRecords()
  const workspace = track(mkdtempSync(join(tmpdir(), 'clock-reattempt-')))
  const clock = fakeClock(30_000_000)
  await seedTeam(workspace, {
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'work', assignee: 'worker', status: 'pending',
      dependencies: [], attempt: 0, kind: 'work', createdAt: 1, updatedAt: 1,
    }],
  })
  const liveAgents = new Map([['worker-session', fakeMemberAgent('worker-session')]])

  const { call } = pluginFixture(workspace, { clock, liveAgents })
  await call('agent_teams_status', {})
  await settle()
  const first = waitRecordSnapshot()
  assert.equal(first.length, 1)
  const firstAttemptId = first[0].attemptId

  /**
   * ★ 推 30 分钟，然后让任务回到可派发状态并**换一个尝试**：这正是"重派发"的形态。
   *   若记录表的键是 `taskId`，旧起点会留在原地 —— 判据读到的等待时长会是
   *   **上一代尝试**的（"这个成员等了 30 分钟"），而它其实刚刚开工。
   *   那与"把失败归给一个从未发生的事件"（t6 为派发事件吃过一次）同源。
   */
  clock.advance(30 * 60_000)
  const { readTeam: read, writeTeam: write, withTeamLock } = await import('../lib/state.js')
  await withTeamLock('probe:reattempt', async () => {
    const team = await read(join(workspace, '.agent-teams'), 'team')
    team.tasks[0].status = 'pending'
    team.tasks[0].attemptId = undefined
    await write(join(workspace, '.agent-teams'), team)
  })
  await call('agent_teams_status', {})
  await settle()

  const records = waitRecordSnapshot()
  const fresh = records.find(record => record.taskId === 't1' && record.attemptId !== firstAttemptId)
  assert.ok(fresh !== undefined, '★ a reassignment must produce a NEW wait record, not reuse the old instant')
  assert.equal(fresh.startedAt, 30_000_000 + 30 * 60_000, '★ the new wait starts at the new dispatch, not 30 minutes ago')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：三态不混 —— "没观察到产出"与"观察到一次产出"形状不同
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 ★ 没观察到产出时 lastActivityAt 【缺席】，绝不填一个 startedAt 兜底', async () => {
  resetWaitRecords()
  const workspace = track(mkdtempSync(join(tmpdir(), 'clock-noactivity-')))
  const clock = fakeClock(40_000_000)
  await seedTeam(workspace, {
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks: [{
      id: 't1', subject: 'work', assignee: 'worker', status: 'pending',
      dependencies: [], attempt: 0, kind: 'work', createdAt: 1, updatedAt: 1,
    }],
  })
  /**
   * ★ 一个**一条 assistant 消息都没有**的成员：它起来了、在跑，但还没说过话。
   *   这是"没观察到产出"，而它与"观察到了一次产出"绝不许同形。
   */
  const liveAgents = new Map([['worker-session', fakeMemberAgent('worker-session', { noMessage: true })]])
  const probe = withGate('runtime', () => ({ ok: true }))
  try {
    const { call } = pluginFixture(workspace, { clock, liveAgents })
    await call('agent_teams_status', {})
    await settle()
    const wait = probe.calls.find(entry => entry.event === 'member-dispatched').wait
    assert.equal(wait.startedAt, 40_000_000)
    /**
     * ★★ 本臂的要害：**不许**兜底成 `startedAt`。
     *
     *   "至少它开工了"听起来无害，实际是把"它一直没动过"伪造成"它刚动过"——
     *   而这两件事正是探活要分辨的那一对。兜底之后，判据的"两次探活读数没变"
     *   永远不会触发，**因为那个读数从一开始就被填成了起点**（于是它看起来
     *   一直是"刚动过"）。
     */
    assert.equal('lastActivityAt' in wait, false, '★ "no output observed yet" must be an ABSENT field, never startedAt')
    assert.equal(waitRecordSnapshot()[0].lastActivityAt, undefined)
    assert.equal(waitRecordSnapshot()[0].activityCount, 0)
  } finally {
    probe.dispose()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 定向突变臂：删掉时刻记录 ⇒ 上面的臂必须红（§8.5 规则二）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 突变检验：把 `recordDispatchStart(event)` 换成空操作 ⇒ 相关臂必须打红', async () => {
  /**
   * ★ 规则二（`docs/GATE-REGISTRY.md` §8.5）：**没被突变抓住的修复，等于没修。**
   *
   * MEASURED（上一轮）：给 contract 位置补上执行器注入之后，删掉注入做突变检验，
   * 原有 25 条臂**全绿** —— 等于没有任何臂钉住那个 finding。
   *
   * ⇒ 本臂对**产物**做真实的突变：把 `lib/tools.js` 里那次调用换成一个空操作，
   *   再在**沙箱副本**里跑一次"派发后等待记录必须存在"的核心断言。
   *   ★ 夹具绝不改坏工作区的产物 —— 它在临时目录里做（与
   *   `gate-mutation-guard.test.mjs` 的 `guardedWrite` 同一纪律）。
   *
   * ★ 为什么突变的是 `lib/` 而不是 `src/`：跑的是 `lib/`。改 `src/` 而不重新
   *   build，突变**不会生效** —— 那会造出一条"突变跑过了、结果全绿"的假证据。
   */
  const { readFileSync, writeFileSync, cpSync, symlinkSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const sandbox = track(mkdtempSync(join(tmpdir(), 'clock-mutation-')))
  cpSync(new URL('../lib', import.meta.url), join(sandbox, 'lib'), { recursive: true })
  /**
   * ★ node_modules 必须可达：`lib/` 会 import `@deepseek-ai/*`。用符号链接而不是
   *   拷贝（拷一份依赖要几十秒，而夹具的价值在于**能被人跑**）。
   */
  symlinkSync(new URL('../node_modules', import.meta.url).pathname, join(sandbox, 'node_modules'), 'dir')
  writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ name: 'clock-mutation-sandbox', type: 'module' }, null, 2))

  const target = join(sandbox, 'lib', 'tools.js')
  const original = readFileSync(target, 'utf8')
  /**
   * ★ 找一个**唯一**的锚点：`recordDispatchStart(event)` 的调用点。
   *   找不到 ⇒ 夹具必须炸，而不是"跳过突变"（一次静默跳过的突变会让整条规则失效）。
   */
  const anchor = 'recordDispatchStart(event);'
  assert.ok(
    original.includes(anchor),
    `★ mutation anchor not found in the built artifact; the fixture must fail, not skip (looked for ${anchor})`,
  )

  try {
    writeFileSync(target, original.replaceAll(anchor, '/* mutated: the dispatch instant is no longer recorded */;'))
    const probeScript = join(sandbox, 'mutant-probe.mjs')
    writeFileSync(probeScript, `
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { registerAgentTeamsTools, waitRecordSnapshot } = await import('./lib/tools.js')
const { createTeamDir } = await import('./lib/state.js')
const workspace = mkdtempSync(join(tmpdir(), 'clock-mut-run-'))
await createTeamDir(join(workspace, '.agent-teams'), {
  id: 'team', name: 'Clock', captainSessionId: 'captain-session', createdAt: 1, taskSeq: 1,
  members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
  tasks: [{ id: 't1', subject: 'work', assignee: 'worker', status: 'pending', dependencies: [], attempt: 0, kind: 'work', createdAt: 1, updatedAt: 1 }],
})
const events = [{ type: 'assistant/message', message: { content: [{ type: 'text', text: 'done' }] } }]
const tools = new Map()
const ctx = {
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  tools: { register(tool) { tools.set(tool.name, tool) } },
  subagents: { getProvider() { return undefined }, list() { return [] }, sendMessage: async () => 'm',
    [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'm' },
  agents: { get(id) { return id === 'worker-session' ? { id, status: 'idle', session: { header: { cwd: '.', events }, events }, steer() {} } : undefined } },
  on() { return () => {} }, effect(setup) { return setup() },
}
registerAgentTeamsTools(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, now: () => 5_000_000 })
const captain = { id: 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} }
await tools.get('agent_teams_status').execute({}, { agent: captain, signal: new AbortController().signal })
await new Promise(resolve => setImmediate(resolve))
const records = waitRecordSnapshot()
console.log(records.length === 1 ? 'MUTANT_SURVIVED' : 'MUTANT_KILLED: ' + JSON.stringify(records))
`)
    const output = execFileSync(process.execPath, [probeScript], { encoding: 'utf8', cwd: sandbox })
    /**
     * ★ 断言的是**结果**：突变之后，"派发记下起点"这件事必须不再成立。
     *   若它仍然成立（`MUTANT_SURVIVED`），说明**没有任何臂钉住那一刻的记录** ——
     *   于是任何一次回归都会静默地把探活的起点整个抹掉。
     */
    assert.match(
      output,
      /MUTANT_KILLED/,
      `★ the mutation must be caught: removing the dispatch-instant record must break the fixture.\nGot: ${output}`,
    )
  } finally {
    writeFileSync(target, original)
  }
})
