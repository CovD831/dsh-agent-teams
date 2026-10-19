/** Terminal member failures, composed with Harness's actual retry plugin. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { apply as installRetry } from '@deepseek-ai/dsh-llm-retry'
import { installMemberSelectionRuntime } from '../lib/members.js'
import { installTeamScheduler } from '../lib/scheduler.js'
import { appendMailbox, createMessage, createTeamDir, readTeam, readMailbox, readUnreadMailbox, withTeamLock, writeTeam } from '../lib/state.js'
import { appendHmrReload, HMR_FAILURE_WINDOW_MS } from '../lib/hmr-trace.js'

const deliveryHarness = process.argv.includes('--delivery-harness')
const modernHarness = deliveryHarness || process.argv.includes('--modern-harness')
const hostQueue = Symbol.for(deliveryHarness ? 'dsh.subagent.deliverPrompt' : 'dsh.subagent.queuePrompt')

async function eventually(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return
    await delay(10)
  }
  assert.fail('terminal failure did not settle')
}

async function fixture(t, {
  captainStatus = 'idle', fallback, captainOffline = false, rejectDelivery = false,
  /**
   * ── ★★ N4：失败落账之后要不要真的重派 ────────────────────────────────────────
   *
   * 生产上 `onFailureSettled` 接的是 `scheduler.kickMember`（`src/tools.ts:2310`），
   * ⇒ 一次失败落账之后，调度器会**立刻**把这条任务重新派给同一个成员
   * （`recoverOwned` 那一支），任务状态随之从 `in_progress` 变成 `claimed`。
   *
   * ★ 那是**另一格机制**（调度器），不是"这次失败算不算工作失败"这个判定。
   *   把它们混在一次读数里，就分不清"判定对了但被重派改了状态"与"判定错了"。
   * ⇒ 默认 `true`（照生产接线），而 N4 的判定臂传 `false` 把那一格摘掉，
   *   另有一条臂在 `true` 下钉住**真实接线下的不变量**（不被标成 failed）。
   */
  kickOnFailure = true,
} = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-member-failure-'))
  const pendingFailures = []
  let settleOnCleanup = () => {}
  t.after(async () => {
    settleOnCleanup()
    await Promise.all(pendingFailures)
    await rm(workspace, { recursive: true, force: true })
  })
  const stateRoot = join(workspace, '.agent-teams')
  const listeners = new Map()
  const steers = []
  const deliveries = []
  const warnings = []
  const sessionEvents = []
  const captain = {
    id: 'captain', status: captainStatus,
    session: { append() {} },
    steer(message) {
      if (rejectDelivery) throw new Error('captain cannot receive')
      steers.push(message)
    },
  }
  let resolveIdle
  const idle = new Promise(resolve => { resolveIdle = resolve })
  const child = {
    id: 'worker-session', status: 'running',
    steer(message) { deliveries.push({ id: this.id, content: message.content }) },
    whenIdle: () => child.status === 'idle' ? Promise.resolve() : idle,
    session: {
      header: { cwd: workspace, parentSession: captain.id, seedLength: 0 },
      events: [{ type: 'subagent/descriptor', data: {
        version: 3, mode: 'continuable', provider: 'spawn', label: 'agent-teams:team:worker',
        agentProvider: 'fake', agentModel: 'primary',
      } }],
      append(type, data) { sessionEvents.push({ type, data }) },
    },
  }
  await createTeamDir(stateRoot, {
    id: 'team', name: 'Team', captainSessionId: captain.id, createdAt: 1, taskSeq: 1,
    members: [{ id: child.id, name: 'worker', status: 'working', joinedAt: 1, provider: 'fake', model: 'primary' }],
    tasks: [{ id: 't1', subject: 'work', assignee: 'worker', status: 'in_progress', dependencies: [], attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1 }],
  })
  let setup
  const rootListeners = new Map()
  const disposers = []
  const ctx = {
    logger: { debug() {}, warn(message) { warnings.push(message) } },
    agents: { list: () => [], get(id) { return id === child.id ? child : id === captain.id && !captainOffline ? captain : undefined } },
    on(name, listener) { rootListeners.set(name, listener); return () => rootListeners.delete(name) },
    effect(setup) { const dispose = setup(); disposers.push(dispose); return dispose },
    subagents: {
      registerContinuableSetup(fn) { setup = fn },
      async followup(_captain, id, content) { deliveries.push({ id, content }); return 'accepted' },
    },
  }
  if (modernHarness) {
    const oldEvents = child.session.events
    delete child.session.events
    delete child.session.header.seedLength
    child.session.ownEvents = () => oldEvents
    const followup = ctx.subagents.followup
    delete ctx.subagents.followup
    delete ctx.subagents.registerContinuableSetup
    ctx.subagents[hostQueue] = function (parent, id, content, source, signal, delivery) {
      if (deliveryHarness) assert.ok(['queue', 'steer'].includes(delivery))
      return followup.call(this, parent, id, content, { source, signal })
    }
    ctx.subagents.sendMessage = (parent, id, content) => followup.call(ctx.subagents, parent, id, content)
    setup = childCtx => {
      child.ctx = childCtx
      if (deliveryHarness) delete childCtx.agent
      rootListeners.get('agent/session-start')({ agent: child, source: 'startup' })
      return () => { for (const dispose of disposers) dispose() }
    }
  }
  const scheduler = installTeamScheduler(ctx, { stateDir: '.agent-teams' })
  const settledCalls = []
  const runtime = installMemberSelectionRuntime(ctx, '.agent-teams', (workspace, teamId, memberName) => {
    settledCalls.push({ workspace, teamId, memberName })
    return kickOnFailure ? scheduler.kickMember(workspace, teamId, memberName) : Promise.resolve()
  })
  const dispose = await runtime.withPending(captain.id, 'agent-teams:team:worker', {
    provider: 'fake', model: 'primary', ...fallback ? { fallback } : {},
  }, () => setup({
    agent: child,
    effect(setup) { const dispose = setup(); disposers.push(dispose); return dispose },
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
  }))
  t.after(dispose)
  let retryHandler
  let projection
  let retryState = {}
  const retryDisposers = []
  installRetry({
    logger: ctx.logger,
    sessionProjections: { register(value) { projection = value }, stateOf() { return retryState } },
    on(_name, listener) { retryHandler = listener; return () => {} },
    effect(setup) { retryDisposers.push(setup()) },
  })
  t.after(async () => { for (const dispose of retryDisposers) await dispose() })
  child.session.append = (type, data) => {
    sessionEvents.push({ type, data })
    retryState = projection.apply(retryState, { type, data })
  }
  const failure = { code: 'STREAM_CLOSED', message: 'SSE stream ended without [DONE]' }
  /**
   * ── ★★ N4：一条 `agent/error` 的**文本**必须可换 ──────────────────────────────
   *
   * 原来的 `terminal()` 把 `failure` 写死在闭包里（`STREAM_CLOSED`），于是
   * 「`inactive context` 那条路径」**在任何臂里都走不到** ——
   * 而本缺陷的整个判据就架在那条文本上。一个改不动的常量，
   * 会让"这条路径被覆盖了"与"它一次都没跑过"在测试计数上同形。
   */
  /**
   * ── ★★ N4 的两个夹具动作：写一条重载痕迹 / 造出那条 `inactive context` 失败 ────
   *
   * ★ 为什么痕迹用生产的 `appendHmrReload`（而不是手工 `writeFileSync` JSON）：
   *   手工写会在测试里**重新实现一遍**落盘格式，而格式一改测试仍绿 ——
   *   于是它测的是"我记不记得那个格式"，不是"生产写的东西读得回来"。
   * ★ 为什么 `at` 可传：窗口是 5 秒，而夹具要测**窗口两侧**。
   *   靠真等 5 秒的测试没人会跑第二次 ⇒ 两侧都靠显式给 `at` 来构造。
   */
  const writeReload = (at = Date.now(), pid = process.pid) => appendHmrReload(stateRoot, {
    at, shape: 'Map(1)', pid,
  })
  /** 生产上那条报错的逐字文本（`docs/DEFECT-HMR-DURING-MEMBER-TURN.md:11`）。 */
  const inactiveContext = {
    code: 'UNKNOWN',
    message: 'cannot get required service "agents" in inactive context',
  }
  const payload = (policy, code = failure.code, signal = new AbortController().signal) => ({
    agent: child, turn: 1, step: 0, provider: 'fake', failure: { ...failure, code }, retryPolicy: policy, signal,
  })
  const memberError = (value, next = async () => undefined) => listeners.get('agent/request-error')?.(value, next) ?? next()
  const settleSilently = () => {
    // The real driver settles after emitting agent/error. Deliberately omit
    // agent/status so recovery cannot depend on that edge reaching the plugin.
    child.status = 'idle'
    resolveIdle()
  }
  settleOnCleanup = settleSilently
  return {
    stateRoot, steers, deliveries, warnings, listeners, child, sessionEvents, memberError, payload, settleSilently,
    writeReload, inactiveContext, settledCalls,
    state: () => readTeam(stateRoot, 'team'),
    mailbox: () => readMailbox(stateRoot, 'team', 'captain'),
    unread: () => readUnreadMailbox(stateRoot, 'team', 'captain'),
    retry: (policy, code) => { const value = payload(policy, code); return retryHandler(value, () => memberError(value)) },
    terminal({ settle = true, turn = 1, failure: override } = {}) {
      const raised = override ?? failure
      pendingFailures.push(listeners.get('agent/error')?.({ agent: child, turn, step: 0, error: new LlmError(raised.message, raised.code) }))
      if (settle) settleSilently()
    },
  }
}

const normal = { mode: 'normal', maxRetries: 1, retryableCodes: ['STREAM_CLOSED'], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }
const always = { mode: 'always', initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }

await test('always retry keeps the owned task open and sends no false failure report', async t => {
  const h = await fixture(t)
  assert.deepEqual(await h.retry(always), { kind: 'retry' })
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
  assert.equal((await h.mailbox()).length, 0)
})

await test('request handler delegates recovery and leaves exhausted requests open until final error', async t => {
  const h = await fixture(t)
  let delegated = 0
  assert.deepEqual(await h.memberError(h.payload(undefined), async () => { delegated++; return { kind: 'retry' } }), { kind: 'retry' })
  assert.equal(delegated, 1)
  assert.deepEqual(await h.retry(normal), { kind: 'retry' })
  assert.equal(await h.retry(normal), undefined)
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
})

await test('fallback recovers once and exhausted fallback still delegates without failing the task', async t => {
  const h = await fixture(t, { fallback: { provider: 'backup', model: 'backup-model' } })
  assert.deepEqual(await h.memberError(h.payload(undefined, 'AUTH')), { kind: 'retry' })
  assert.deepEqual(await h.memberError(h.payload(undefined, 'RATE_LIMIT'), async () => ({ kind: 'retry' })), { kind: 'retry' })
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
})

await test('aborted request does not fail a task or consume its fallback route', async t => {
  const h = await fixture(t, { fallback: { provider: 'backup', model: 'backup-model' } })
  const abort = new AbortController()
  abort.abort()
  assert.equal(await h.memberError(h.payload(undefined, 'AUTH', abort.signal)), undefined)
  assert.deepEqual(await h.memberError(h.payload(undefined, 'AUTH')), { kind: 'retry' })
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
})

for (const captainStatus of ['idle', 'running']) {
  await test(`final failure notifies ${captainStatus} captain once and flushes without an idle event`, async t => {
    const h = await fixture(t, { captainStatus })
    await appendMailbox(h.stateRoot, 'team', 'worker', createMessage('captain', 'worker', 'status please'))
    h.terminal()
    h.terminal()
    await eventually(async () => (await h.state()).tasks[0].status === 'failed' && h.steers.length === 1 && h.deliveries.length === 1)
    assert.equal((await h.state()).tasks[0].attemptId, 'a1')
    assert.match((await h.state()).tasks[0].output, /STREAM_CLOSED/)
    assert.equal((await h.state()).members[0].status, 'idle')
    assert.match(JSON.stringify(h.steers[0]), /t1/)
    assert.match(JSON.stringify(h.steers[0]), /STREAM_CLOSED/)
    await eventually(async () => (await h.mailbox())[0]?.deliveredAt !== undefined)
    assert.equal((await h.unread()).length, 1, 'delivery alone does not prove consumption')
    assert.equal((await h.mailbox()).length, 1)
    assert.equal((await readUnreadMailbox(h.stateRoot, 'team', 'worker')).length, 1)
    assert.equal(h.warnings.length, 0)
  })
}

await test('report a final error immediately but do not dispatch while the driver is still running', async t => {
  const h = await fixture(t)
  await appendMailbox(h.stateRoot, 'team', 'worker', createMessage('captain', 'worker', 'status please'))
  h.terminal({ settle: false })
  await eventually(async () => (await h.state()).tasks[0].status === 'failed' && h.steers.length === 1)
  assert.equal(h.child.status, 'running')
  assert.equal((await h.state()).members[0].status, 'working')
  assert.equal(h.deliveries.length, 0)
  h.settleSilently()
  await eventually(() => h.deliveries.length === 1)
  assert.equal((await h.state()).members[0].status, 'idle')
})

for (const options of [{ captainOffline: true }, { rejectDelivery: true }]) {
  await test(`unavailable captain keeps failure notification readable: ${JSON.stringify(options)}`, async t => {
    const h = await fixture(t, options)
    h.terminal()
    await eventually(async () => (await h.unread()).length === 1)
    assert.equal((await h.state()).tasks[0].status, 'failed')
    assert.equal(h.steers.length, 0)
  })
}

await test('a queued error cannot fail a newer attempt created before it gets the team lock', async t => {
  const h = await fixture(t)
  let release
  let locked
  const ready = new Promise(resolve => { locked = resolve })
  const lock = withTeamLock(`team:${h.stateRoot}:team`, async () => {
    locked()
    await new Promise(resolve => { release = resolve })
    const team = await h.state()
    team.tasks[0].attempt = 2
    team.tasks[0].attemptId = 'a2'
    await writeTeam(h.stateRoot, team)
  })
  await ready
  h.terminal()
  release()
  await lock
  await withTeamLock(`team:${h.stateRoot}:team`, async () => {})
  assert.equal((await h.state()).tasks[0].status, 'in_progress')
  assert.equal((await h.state()).tasks[0].attemptId, 'a2')
  assert.equal((await h.mailbox()).length, 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// N4 —— 一次重载打断的回合【不是】一次工作失败
//   `docs/DEFECT-HMR-DURING-MEMBER-TURN.md`: HMR 把 fiber 打成 inactive ⇒
//   成员下一次读 `ctx.agents` 抛 `cannot get required service` ⇒ `agent/error`
//   ⇒ 一次 `pnpm build` 把一条正在干活的活判成 failed。实测 4 次，间隔 6–538 ms。
// ─────────────────────────────────────────────────────────────────────────────

await test('★ N4 豁免臂：紧跟在一次重载之后的 inactive context 不落 failed，任务仍打开', async t => {
  const h = await fixture(t, { kickOnFailure: false })
  h.writeReload()
  h.terminal({ failure: h.inactiveContext })
  await eventually(async () => h.steers.length === 1)
  const task = (await h.state()).tasks[0]
  /**
   * ★★ 这一条是整件事的**目的**：任务还开着，而不是被记成做过一遍。
   *   连带 `attemptId` 也不许变 —— 一变，成员手上的 capability 就失效了，
   *   "还能继续干"就成了一句空话。
   */
  assert.equal(task.status, 'in_progress', '★ 重载打断的回合不许把任务判成 failed')
  assert.equal(task.attemptId, 'a1', '★ capability 不许被换掉，否则成员无法继续')
  assert.equal(task.attempt, 1)
  assert.equal(task.output, undefined, '★ 不许把基础设施故障写成任务的交付结论')
  assert.equal((await h.state()).members[0].status, 'idle', '★ 成员必须回到 idle，否则再也派发不到它')
})

await test('★ N4 消息臂：队长收到的消息明说是 infrastructure，而不是 work failure', async t => {
  const h = await fixture(t, { kickOnFailure: false })
  h.writeReload()
  h.terminal({ failure: h.inactiveContext })
  await eventually(async () => h.steers.length === 1)
  /**
   * ★★ 三态纪律：这条消息读起来必须**不可能**被当成"工作失败"。
   *   把两种失败写成同一句话，是本仓记账最久的那一格 ——
   *   人要做的下一件事（重派 / 让成员继续）与"这活干砸了"完全相反。
   */
  const said = JSON.stringify(h.steers[0])
  assert.match(said, /Infrastructure failure, not a work failure/, '★ 措辞必须点名它是基础设施故障')
  assert.match(said, /plugin reload/, '★ 要说出成因是重载，而不是只说"出错了"')
  assert.match(said, /t1/, '★ 要说清是哪一条任务（否则队长不知道该继续哪一条）')
  assert.match(said, /still in_progress/, '★ 要说清任务的真实状态')
  assert.doesNotMatch(said, /was marked failed/, '★★ 不许出现"被标成 failed"这句话')
  /** ★ 而队长的信箱里那一条也要在（steer 可能失败，而落盘必须已经发生）。 */
  const mailbox = await h.mailbox()
  assert.equal(mailbox.length, 1)
  assert.match(mailbox[0].content, /Infrastructure failure, not a work failure/)
})

await test('★★ N4 对照臂（窗口外）：重载发生在 5 秒之前 ⇒ 仍然按工作失败处理', async t => {
  const h = await fixture(t, { kickOnFailure: false })
  h.writeReload(Date.now() - HMR_FAILURE_WINDOW_MS - 1_000)
  h.terminal({ failure: h.inactiveContext })
  await eventually(async () => (await h.state()).tasks[0].status === 'failed')
  /**
   * ★★ 这是**证明豁免不是放行一切**的那一半。
   *   少了它，"所有失败都被放过"与"只有重载造成的被放过"在测试计数上同形 ——
   *   而前者会把真的工作失败全部藏起来。
   */
  assert.equal((await h.state()).tasks[0].status, 'failed', '★ 窗口外的同样报错必须照常判失败')
  assert.match((await h.state()).tasks[0].output, /inactive context/)
  assert.match(JSON.stringify(h.steers[0]), /was marked failed/)
  assert.doesNotMatch(JSON.stringify(h.steers[0]), /Infrastructure failure/)
})

await test('★★ N4 对照臂（别的进程）：痕迹属于另一个 pid ⇒ 不豁免', async t => {
  const h = await fixture(t, { kickOnFailure: false })
  h.writeReload(Date.now(), process.pid + 1)
  h.terminal({ failure: h.inactiveContext })
  await eventually(async () => (await h.state()).tasks[0].status === 'failed')
  /**
   * ★ 痕迹跨进程追加：宿主重启、开两个窗口、跑一次 CLI 都往里写。
   *   别的进程的重载**动不了本进程的 fiber** ⇒ 拿它来解释本进程的一次
   *   `inactive context` 是归因错误。不筛 pid 的话，开发机上永远有一条
   *   别的窗口刚写下的重载，豁免就会变成无条件通过。
   */
  assert.equal((await h.state()).tasks[0].status, 'failed', '★ 别人的重载不许替本进程的失败背书')
})

await test('★★ N4 对照臂（别的报错）：窗口内有重载，但报错不是 inactive context ⇒ 不豁免', async t => {
  const h = await fixture(t, { kickOnFailure: false })
  h.writeReload()
  h.terminal()
  await eventually(async () => (await h.state()).tasks[0].status === 'failed')
  /**
   * ★ 少了这一道，窗口会变成"构建期间干什么都不算失败" ——
   *   一次真的把测试跑红的回合，只要恰好落在构建窗口里就被记成基础设施故障。
   *   那与本缺陷是同一件事的**两个方向**。
   */
  assert.equal((await h.state()).tasks[0].status, 'failed', '★ 只豁免服务读取失败这一类，不是豁免"构建期间的一切"')
  assert.match((await h.state()).tasks[0].output, /STREAM_CLOSED/)
})

await test('★ N4 无痕迹臂：从没构建过 ⇒ 正常的初始态，照常判失败', async t => {
  const h = await fixture(t, { kickOnFailure: false })
  h.terminal({ failure: h.inactiveContext })
  await eventually(async () => (await h.state()).tasks[0].status === 'failed')
  /**
   * ★ 痕迹文件不存在是**正常的初始状态**（没构建过就没有重载），
   *   而不是"读失败"。它必须落回**保守的一侧**：照常上报。
   *   若把它做成"读不到 ⇒ 豁免"，那么任何一次读盘异常都会变成静默放过。
   */
  assert.equal((await h.state()).tasks[0].status, 'failed')
})

await test('★★ N4 接线臂：真实接线（失败后立刻重派）下，重载打断的任务绝不停在 failed', async t => {
  const h = await fixture(t)
  h.writeReload()
  h.terminal({ failure: h.inactiveContext })
  /**
   * ★★ 这一条是**生产形态**：`onFailureSettled` 真的接的是调度器。
   *   于是落账之后任务会被**立刻重派**（`recoverOwned`），状态回到 `claimed`。
   *
   * ★ 所以这里不能钉 `in_progress` —— 那是把"调度器有没有重派"写进了
   *   一条关于"这次失败算不算工作失败"的判据里。要钉的是**两个不变量**：
   *   ① 任务**没有**停在 `failed`（这才是本缺陷的痛点）；
   *   ② 它已经被重新派给出去了（`claimed` + 同一个成员 + 同一代 attempt 之前的那一条
   *      仍在队列里）—— 并且队长收到了那条基础设施消息。
   * ★ 而"成员被钉在 working 上再也派不出去"这个反向风险，正是靠 ② 排除的。
   */
  await eventually(async () => h.settledCalls.length === 1)
  const task = (await h.state()).tasks[0]
  assert.notEqual(task.status, 'failed', '★★ 真实接线下的核心不变量：重载打断的活不许落 failed')
  assert.equal(task.assignee, 'worker', '★ 任务还在原成员手上（不是被丢回公共池）')
  assert.equal(h.settledCalls[0].memberName, 'worker', '★ 失败落账之后调度器确实被叫了一次')
  assert.match(JSON.stringify(h.steers[0]), /Infrastructure failure/, '★ 队长收到的仍是基础设施口径，不是工作失败')
})
