import assert from 'node:assert/strict'
import test from 'node:test'
import {createWorkspaceState,createTeamDiscovery} from '../lib/client/workspace-state.js'
import {startActivityPolling} from '../lib/client/activity-monitor.js'

test('restored, closed, updated and newly created teams have distinct discovery semantics',()=>{
 const discover=createTeamDiscovery()
 const a={teamId:'a'},b={teamId:'b'}
 assert.equal(discover([a]),undefined)
 assert.equal(discover([{...a,phase:'running'}]),undefined)
 assert.equal(discover([a,b]),'b')
 assert.equal(discover([a,b]),undefined)
 assert.equal(discover([]),undefined)
})
test('historical cards and selected teams remain bound to their owner',()=>{
 const state=createWorkspaceState();let count=0;const off=state.subscribe(()=>count++)
 const old={teamId:'old',captainSessionId:'',teamName:'Old',members:[]}
 state.remember('a',old)
 state.select('b','new')
 state.remember('a',{...old,teamId:'foreign',captainSessionId:'b'})
 assert.equal(state.getSnapshot().history.size,1)
 assert.equal(state.getSnapshot().history.get('a:old').captainSessionId,'a')
 assert.equal(state.getSnapshot().selected.get('a'),'old')
 assert.equal(state.getSnapshot().selected.get('b'),'new')
 state.status('a','ready');state.status('a','ready')
 assert.equal(count,3)
 off();state.status('a','error');assert.equal(count,3)
})
test('offline, invalid data and recovery report health without erasing the last snapshot',async()=>{
 let tick;let response={ok:false};const statuses=[],snapshots=[]
 const poll=startActivityPolling([],{discoverySessionId:'a',fetchState:async()=>response,
 schedule:fn=>{tick=fn;return 1},cancel:()=>{},onStatus:s=>statuses.push(s),publishSnapshots:s=>snapshots.push(s)})
 await poll.firstTick;assert.deepEqual(statuses,['error']);assert.equal(snapshots.length,0)
 response={ok:true,json:async()=>({invalid:true})};tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(statuses.at(-1),'error')
 response={ok:true,json:async()=>({teams:[]})};tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(statuses.at(-1),'ready');assert.equal(snapshots.length,2)
 poll.stop()
})
test('disposal prevents a late failed request from updating a different session',async()=>{
 let reject;const statuses=[]
 const poll=startActivityPolling([],{discoverySessionId:'a',fetchState:()=>new Promise((_,no)=>reject=no),schedule:()=>1,cancel:()=>{},onStatus:s=>statuses.push(s)})
 poll.stop();reject(new Error('offline'));await poll.firstTick;assert.deepEqual(statuses,[])
})

test('workspace DAG keeps real dependency endpoints aligned with enlarged nodes',async()=>{
 const {compactDagLayout}=await import('../lib/client/activity-model.js')
 const tasks=[{id:'implement',depth:0,dependencies:[]},{id:'review',depth:1,dependencies:['implement']}]
 const layout=compactDagLayout(tasks,{nodeWidth:164,nodeHeight:76,columnGap:36,rowGap:16})
 assert.equal(layout.width,364)
 assert.equal(layout.nodes[1].x,200)
 assert.equal(layout.edges[0].path,'M164 38C178 38,186 38,200 38')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * t13：把「评审【找到了问题】」与「东西【真的坏了】」在面板上分开
 *
 * ★ 本组测的是判据本身（activity-model / activity-monitor 里的纯函数），而
 *   颜色那条由随后的 [data-tone] DOM 断言在这个同一次 pod metrics 上钉住。
 *
 * ★ 每条臂都带反向半边：只断言"它是对的"会让一个【恒返回同一值】的实现全绿。
 * ───────────────────────────────────────────────────────────────────────────── */

const {
  reviewLoop, roundTailCounts, memberClock, formatElapsed, taskIsTerminal, taskLoopTone,
} = await import('../lib/client/activity-model.js')
const {
  loopFacts, nextLoopDisclosure, toggleLoopDisclosure,
} = await import('../lib/client/activity-model.js')
const {
  failureToneOf, isConsultativeFailure, isBrokenFailure, isUnmeasuredFailure,
} = await import('../lib/client/activity-monitor.js')

/** 三种结局的原始形状 —— 与 src/state.ts 的 failureKindOf 判据逐条对应。 */
const REVIEW = { id: 'review-round-2', status: 'failed', verdict: 'needs_revision', failureKind: 'inconclusive', round: 2 }
const BROKE = { id: 'impl', status: 'failed', failureKind: 'failed_delivery', round: 1 }
const UNMEASURED = { id: 'bare', status: 'failed', failureKind: 'failed_context', round: 1 }

test('★ 臂 1（三态不同形）：三种结局必须映射到三种 UI 状态，且两两不同', () => {
  const review = taskLoopTone(REVIEW)
  const broke = taskLoopTone(BROKE)
  const bare = taskLoopTone(UNMEASURED)
  assert.notEqual(review, broke, '★ 「找到了问题」不得与「东西坏了」同形')
  assert.notEqual(review, bare, '★ 「找到了问题」不得与「没测到」同形')
  assert.notEqual(broke, bare, '★ 「东西坏了」不得与「没测到」同形')
  /** ★ 方向是收缩(Harden mercy)那一句的人话版本：那一格【必须】是琥珀，
   *   而不是"只要不是红的就行" —— 后者会让黄色/灰色一类实现蒙混过关。 */
  assert.equal(review, 'converging', '★ 评审的 needs_revision 必须读成「收敛」（琥珀 --dsw-alias-state-warn-primary）')
  assert.equal(broke, 'failed', '★ 交付物损坏仍然必须是「失败」（红）')
  assert.equal(bare, 'unmeasured', '★ 没有证据的必须是「未测量」，既非红也非绿')
})

test('★ 臂 1b（反向半边）：塌缩实现必须当场红，否则"三种不同形"可能来自任何东西', () => {
  const collapsed = () => 'failed'
  const tones = [taskLoopTone(REVIEW), taskLoopTone(BROKE), taskLoopTone(UNMEASURED)]
  assert.equal(new Set(tones).size, 3, '★ 三种结局必须产出三个不同值')
  assert.equal(new Set([collapsed(), collapsed(), collapsed()]).size, 1, '★ 而这个替身确实会塌缩 —— 它是本臂的反例')
})

test('★ 臂 2（缺席即回退）：failure_kind 缺席 ⇒ 退回今天的旧行为，而不是猜一个', () => {
  /** ★ 契约原句："if failure_kind is absent fall back to today's behaviour"。 */
  const legacy = { id: 'legacy', status: 'failed' }
  assert.equal(failureToneOf(legacy), 'unknown', '★ 缺席 = 未测量，不是三种之一')
  assert.equal(taskLoopTone(legacy), 'failed', '★ 缺席 ⇒ 与改动前完全一致的单色 failed（回退，不猜）')
  const weird = { id: 'x', status: 'failed', failureKind: 'something-else' }
  assert.equal(failureToneOf(weird), 'unknown', '★ 认不出来的值同样不许猜')
  assert.equal(taskLoopTone(weird), 'failed')
  /** ★ 非 failed 的任务根本不带这一格。 */
  assert.equal(failureToneOf({ id: 'ok', status: 'completed' }), 'unknown')
  assert.equal(taskLoopTone({ id: 'ok', status: 'completed' }), 'completed')
})

test('★ 臂 3（收敛循环可见）：多轮 ⇒ 有序轮次 + 轮标记', () => {
  const loop = reviewLoop([
    { id: 'review-round-1', status: 'failed', failureKind: 'inconclusive', round: 1 },
    { id: 'repair-round-2', status: 'completed', round: 2 },
    { id: 'review-round-2', status: 'failed', failureKind: 'inconclusive', round: 2 },
    { id: 'impl', status: 'completed' },
  ])
  assert.equal(loop.tracked, 3, '★ 只有带 round 的任务进循环')
  assert.deepEqual(loop.rounds.map(entry => entry.round), [1, 2], '★ 升序且带轮标记 —— 这个顺序本身就是那个"循环"')
  assert.equal(loop.rounds[1].tasks.length, 2)
  /** ★ 反向半边：单轮不是循环；防止把"有 round 字段"当成"有循环"。 */
  assert.equal(reviewLoop([REVIEW]).rounds.length, 1)
})

test('★ 臂 4（轮次整体语气）：一轮里"发现问题"不得被同轮的通过任务染绿', () => {
  const mixed = reviewLoop([
    { id: 'repair-round-3', status: 'completed', round: 3 },
    { id: 'review-round-3', status: 'failed', failureKind: 'inconclusive', round: 3 },
  ])
  assert.equal(mixed.rounds[0].tone, 'converging', '★ 该轮结论是"还在收敛"，哪怕 repair 已完成')
  const clean = reviewLoop([{ id: 'review-round-4', status: 'completed', round: 4 }])
  assert.equal(clean.rounds[0].tone, 'completed', '★ 反向：全数通过的轮才是 completed')
  const broken = reviewLoop([
    { id: 'review-round-5', status: 'failed', failureKind: 'inconclusive', round: 5 },
    { id: 'repair-round-5', status: 'failed', failureKind: 'failed_delivery', round: 5 },
  ])
  assert.equal(broken.rounds[0].tone, 'failed', '★ 交付物坏了压过"发现问题" —— 那是要立刻去看的那一格')
})

test('★ 臂 5（状态尾程）："发现问题"必须出现在尾程里，且不与"已通过"混同', () => {
  const t = (key, params) => `${key}:${params?.count}`
  const tail = roundTailCounts([
    { id: 'review-round-2', status: 'failed', failureKind: 'inconclusive', round: 2 },
    { id: 'repair-round-2', status: 'completed', round: 2 },
  ], t, ' | ')
  assert.match(tail, /task\.status\.failed:1/, '★ "发现问题"这一格必须在尾程里（而不是只剩 completed）')
  assert.match(tail, /task\.status\.completed:1/)
  /** ★ 反向半边：全通过的轮，尾程里没有 converging。 */
  const cleanTail = roundTailCounts([{ id: 'r', status: 'completed', round: 1 }], t, ' | ')
  assert.equal(cleanTail, 'task.status.completed:1')
  assert.doesNotMatch(cleanTail, /task\.status\.failed/)
})

test('★ 臂 6（成员时钟）：时长读自任务持久 updatedAt，绝不是浏览器自造的计时器', () => {
  const NOW = 10_000
  const member = { name: 'ui-eng', activity: 'working', liveness: 'working', currentTask: 'impl' }
  const running = memberClock(member, [{ id: 'impl', assignee: 'ui-eng', status: 'in_progress', updatedAt: 4_000 }], NOW)
  assert.equal(running.kind, 'running')
  assert.equal(running.ms, 6_000, '★ now − 持久 updatedAt；面板不起表')

  /** ★ 名下有在飞任务、而会话已不在 ⇒ 那是"停滞"，不是"在工作"。 */
  const stale = memberClock(
    { ...member, liveness: 'not-live' },
    [{ id: 'impl', assignee: 'ui-eng', status: 'claimed', updatedAt: 4_000 }],
    NOW,
  )
  assert.equal(stale.kind, 'stale', '★ 会话不在了 ⇒ 停滞，与 running 不同形')

  /**
   * ★★★ 没有在飞任务 ⇒ **`idle`，不再塌成 `none`**（用户 2026-10-11 实测）。
   *
   * 用户原话：「Integrator 前面是一个空白的显示，这说明显示就不对。」
   * 旧实现在这里返回 `kind:'none'`，而渲染条件又是 `kind !== 'none'` ⇒
   * **整格空白**，于是"这个成员没事做"与"这一格坏了"在界面上同形。
   * ★ 三态纪律：空闲是**一个读数**，不是"没有读数"。
   */
  const idle = memberClock(member, [{ id: 'done', assignee: 'ui-eng', status: 'completed', updatedAt: 9_000 }], NOW)
  assert.equal(idle.kind, 'idle', '★ 没有在飞任务 ⇒ idle（明确的中性读数），不是空白')
  assert.equal(idle.ms, 0, '★ 空闲不带时长 —— 不许编一个"0 秒"的假时长出来')

  /** ★ 没有持久戳 ⇒ 是"读不到"，不是"刚开工"，**也不是"它没事做"**。 */
  const noStamp = memberClock(member, [{ id: 'impl', assignee: 'ui-eng', status: 'in_progress' }], NOW)
  assert.equal(noStamp.kind, 'unknown', '★ 读不到戳 ⇒ could-not-measure，不许并进 idle')

  /** ★ 而四个读数是**两两不同形**的 —— 合流任意两个都会让本臂红。 */
  assert.equal(new Set([running.kind, stale.kind, idle.kind, noStamp.kind]).size, 4,
    '★★★ 四种读数必须两两不同形：working / waiting / idle / unknown')
})

test('★ 臂 7（可读时长）：秒 / 分 / 时三档', () => {
  assert.equal(formatElapsed(0), '0s')
  assert.equal(formatElapsed(45_000), '45s')
  assert.equal(formatElapsed(61_000), '1m')
  assert.equal(formatElapsed(3_900_000), '1h 5m')
})

test('★ 臂 8（终态判定）：唯一判据源，不出现第二份清单', () => {
  for (const status of ['completed', 'failed', 'cancelled']) assert.equal(taskIsTerminal(status), true)
  for (const status of ['pending', 'claimed', 'in_progress']) assert.equal(taskIsTerminal(status), false)
})

test('★ 臂 9（三态谓词互斥）：一条失败只能属于一类', () => {
  assert.equal(isConsultativeFailure(REVIEW), true)
  assert.equal(isBrokenFailure(REVIEW), false, '★ "找到了问题"不许同时被读成"东西坏了"')
  assert.equal(isBrokenFailure(BROKE), true)
  assert.equal(isUnmeasuredFailure(UNMEASURED), true)
  const flags = [isConsultativeFailure, isBrokenFailure, isUnmeasuredFailure].map(f => f(REVIEW))
  assert.equal(flags.filter(Boolean).length, 1)
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 10-12：展开/折叠必须【由状态驱动】，且用户的选择要活得过重渲染
 * ───────────────────────────────────────────────────────────────────────────── */

/** 一个"还在收敛"的循环：第 2 轮的评审找到了问题。 */
const CONVERGING = reviewLoop([
  { id: 'review-round-1', status: 'failed', failureKind: 'inconclusive', round: 1 },
  { id: 'review-round-2', status: 'failed', failureKind: 'inconclusive', round: 2 },
])
/** 一个全部通过的循环。 */
const CLEAN = reviewLoop([{ id: 'review-round-1', status: 'completed', round: 1 }])

test('★ 臂 10（状态驱动的展开）：未了结/异常的一层默认展开，全完成的一层收起', () => {
  const abnormal = loopFacts(CONVERGING)
  assert.equal(abnormal.mode, 'abnormal', '★ "发现了问题"算异常 —— 折叠起来的琥珀标记等于看不见')
  assert.equal(nextLoopDisclosure(undefined, abnormal).open, true, '★ 异常层默认展开')

  const clean = loopFacts(CLEAN)
  assert.equal(clean.mode, 'clean')
  assert.equal(nextLoopDisclosure(undefined, clean).open, false, '★ 全完成的一层保持收起')

  /** ★ 反向半边：不是"一律展开"。一刀切展开会让"全绿"也占满面板。 */
  const opens = [loopFacts(CONVERGING), loopFacts(CLEAN)].map(f => nextLoopDisclosure(undefined, f).open)
  assert.deepEqual(opens, [true, false], '★ 两种情形必须给出【不同】的初始展开，否则就是一刀切')
})

test('★ 臂 11（用户选择活得过重渲染）：同一组事实 ⇒ 折叠后仍然是折叠', () => {
  const facts = loopFacts(CONVERGING)
  const initial = nextLoopDisclosure(undefined, facts)
  assert.equal(initial.open, true)
  /** 用户手动折叠。 */
  const collapsed = toggleLoopDisclosure(initial)
  assert.equal(collapsed.open, false)
  assert.equal(collapsed.userSet, true)
  /** 重渲染：事实一字未变 ⇒ 选择必须原样保留。 */
  const afterRerender = nextLoopDisclosure(collapsed, facts)
  assert.equal(afterRerender.open, false, '★ 用户的折叠不得被下一次渲染抹掉')
  assert.equal(afterRerender.userSet, true)
})

test('★ 臂 12（新事实盖过旧选择）：升级/多一轮 ⇒ 重新展开；且初值来自事实而非记忆', () => {
  /** 一个"在跑"的循环：初值展开，于是"用户折叠"是一个真实存在的选择。 */
  const runningFacts = loopFacts(reviewLoop([{ id: 'review-round-1', status: 'in_progress', round: 1 }]))
  assert.equal(runningFacts.mode, 'running')
  const collapsed = toggleLoopDisclosure(nextLoopDisclosure(undefined, runningFacts))
  assert.equal(collapsed.open, false, '前置：用户确实把它折起来了')
  assert.equal(collapsed.userSet, true)
  /** 后来这一轮真的找到了问题 ⇒ 必须重新展开，否则琥珀标记被用户早先的选择永久藏住。 */
  const abnormalFacts = loopFacts(CONVERGING)
  assert.equal(abnormalFacts.mode, 'abnormal')
  const reopened = nextLoopDisclosure(collapsed, abnormalFacts)
  assert.equal(reopened.open, true, '★ 升级（running → abnormal）盖过先前的手动折叠')

  /** 多出新一轮 ⇒ 同样重新展开（从一个【已被用户折叠】的收起态出发）。 */
  const grew = loopFacts(reviewLoop([
    { id: 'review-round-1', status: 'completed', round: 1 },
    { id: 'review-round-2', status: 'completed', round: 2 },
  ]))
  assert.equal(grew.mode, 'clean')
  /** clean 的初值是收起；用户展开又折叠回去 ⇒ 一个真正的"用户选择：收起"。 */
  const collapsedGrew = toggleLoopDisclosure(toggleLoopDisclosure(nextLoopDisclosure(undefined, grew)))
  assert.equal(collapsedGrew.open, false, '前置：用户确实把它折起来了')
  assert.equal(nextLoopDisclosure(collapsedGrew, { ...grew, count: grew.count + 1 }).open, true, '★ 多一轮 ⇒ 重新展开')

  /** ★ 初值永远来自事实：没有上一次状态时，不会"记住"任何 UI 标志。 */
  assert.deepEqual(nextLoopDisclosure(undefined, loopFacts(CLEAN)), { mode: 'clean', count: 1, open: false, userSet: false })
})

/* ─────────────────────────────────────────────────────────────────────────────
 * One-line enabling projection: the panel's own route (/plugins/.../state, built
 * by src/snapshot.ts) must carry the classification, or the client never sees it.
 *
 * ★ The panel does NOT read agent_teams_status; it reads this snapshot. So this
 *   is the difference between "the client CAN distinguish" and an inert UI.
 * ───────────────────────────────────────────────────────────────────────────── */

const { assembleTeamSnapshot } = await import('../lib/snapshot.js')

/** Minimal ctx: the snapshot needs `logger` and `agents` (memberActivity). */
const snapshotCtx = { logger: { debug() {}, info() {}, warn() {}, error() {} }, agents: { get: () => undefined } }

function teamStateWith(tasks) {
  return {
    id: 'team', name: 'Team', captainSessionId: 'cap', createdAt: 1, taskSeq: 0,
    phase: 'running',
    members: [{ id: 'm1', name: 'ui-eng', role: 'eng', status: 'idle', provider: 'p', model: 'm' }],
    tasks,
  }
}
const durable = (o) => ({
  id: 'T', subject: 's', description: '', status: 'pending', assignee: 'ui-eng',
  dependencies: [], createdAt: 1, updatedAt: 1, ...o,
})

test('the panel route carries failure_kind, and only for a failed task', async () => {
  const snapshot = await assembleTeamSnapshot(snapshotCtx, '/nonexistent-root', 'w', teamStateWith([
    durable({ id: 'review-round-2', status: 'failed', verdict: 'needs_revision', round: 2 }),
    durable({ id: 'impl', status: 'failed', acceptanceResults: [{ criterion: 'x', status: 'failed' }] }),
    durable({ id: 'bare', status: 'failed' }),
    durable({ id: 'ok', status: 'completed' }),
  ]))
  const byId = new Map(snapshot.tasks.map((task) => [task.id, task]))
  assert.equal(byId.get('review-round-2').failureKind, 'inconclusive',
    'a review that found problems must reach the panel as inconclusive')
  assert.equal(byId.get('impl').failureKind, 'failed_delivery')
  assert.equal(byId.get('bare').failureKind, 'failed_context')
  /** Absent, not a fabricated kind: "not applicable" must stay distinguishable. */
  assert.equal('failureKind' in byId.get('ok'), false,
    'a non-failed task must NOT carry a failureKind - absence is not one of the kinds')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ t27：成员的**活子代理**必须到达 /state 负载（面板的展开层）───────────────
 *
 * ── 这一节修的是什么（MEASURED，t27 开工时）──────────────────────────────────
 *
 *     grep -n "subagent|childSession|parentSession" src/snapshot.ts
 *     ⇒ 只命中两处**注释**，一处代码都没有。
 *
 * ⇒ 用户要的"点开一个成员看到它底下的子代理"会展开成**一块空白** ——
 *   而 `snapshot` 里那个"live subagent activity"的模块注释会让读代码的人
 *   以为它已经做了。这正是本仓撞过两次的 **「做出来了但没接上」**。
 *
 * ── ★ 夹具：一个**真的** parent/child 对 ──────────────────────────────────────
 *
 * 形状按宿主的 `Agent` 复现（`id`、`status`、`session.header.parentSession`、
 * `session.ownEvents()`），而**不是**手搓一个"看起来像"的对象 —— 这样臂测的
 * 才是投影真的会走的那条路。
 * ★ 子会话带 `ownEvents: () => []`：`sessionOwnEvents` 在没有 `ownEvents` 且没有
 *   legacy `events` 时**抛错**（刻意的契约检查），所以一个"会话形状不对"的夹具
 *   会让投影走上另一条路 —— 那正是臂 3 要单独钉的那一格。
 * ───────────────────────────────────────────────────────────────────────────── */

const { liveSessionRefs, attributeSubagents, memberSubagents } = await import('../lib/members.js')

/** 一个宿主形状的活会话。★ `parent` 只写在 header 上（与真宿主一致）。 */
function liveSession(id, { parent, status = 'running', withLog = true } = {}) {
  return {
    id,
    status,
    session: {
      header: parent === undefined ? {} : { parentSession: parent },
      ...withLog ? { ownEvents: () => [] } : {},
    },
  }
}

/** panel ctx：`list()` 交出一份活会话清单；`get()` 按 id 找。 */
function panelCtx(sessions) {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    agents: {
      get: (id) => sessions.find((s) => s.id === id),
      list: () => sessions,
    },
  }
}

test('★ 臂 13（t27 归属臂）：一个真 parent/child 对 ⇒ 子代理挂在【正确的】父成员底下', async () => {
  /**
   * ★ 用户要求的那件事，逐字：第一屏显示持久成员，**点开一个成员**看到它底下的
   *   子代理。本臂断言那条链真的接通了 —— 从 `ctx.agents.list()` 到载荷里的
   *   `members[i].liveSubagents`。
   */
  const sessions = [liveSession('m1'), liveSession('child-a', { parent: 'm1' })]
  const ctx = panelCtx(sessions)
  const state = {
    id: 'team', name: 'Team', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, phase: 'running',
    members: [
      { id: 'm1', name: 'ui-eng', role: 'eng', status: 'running', provider: 'p', model: 'm' },
      { id: 'm2', name: 'other', role: 'eng', status: 'idle', provider: 'p', model: 'm' },
    ],
    tasks: [durable({ id: 't1', status: 'in_progress', assignee: 'ui-eng', round: 3 })],
  }
  const snapshot = await assembleTeamSnapshot(ctx, '/nonexistent-root', 'w', state)
  const byName = new Map(snapshot.members.map((member) => [member.name, member]))

  assert.equal(byName.get('ui-eng').subagents, 'observed', '★ 前置：这一格必须是被**观测**到的')
  assert.deepEqual(
    byName.get('ui-eng').liveSubagents.map((sub) => sub.id), ['child-a'],
    '★ 子代理必须出现在**它的父成员**底下（实测：'
    + JSON.stringify(byName.get('ui-eng').liveSubagents.map((sub) => sub.id)) + '）',
  )
  /** ★ 用户要求的另一半：轮次信息与展开层一起到达。 */
  assert.equal(byName.get('ui-eng').round, 3, '★ 轮次信息必须与子代理一起到达（用户明确要求）')

  /**
   * ★★ 反向半边 ①：**没有**子代理的成员不许被分到一个"幽灵孩子"。
   *   缺了这一半，一个"给每个成员都挂上所有会话"的实现会让上面那条照样绿 ——
   *   而面板会把别人的子代理画在这个成员底下。
   */
  assert.deepEqual(
    byName.get('other').liveSubagents, [],
    '★ 一个没有子代理的成员必须拿到空数组 —— 分到幽灵孩子比漏掉更坏（归属错了看不见）',
  )

  /**
   * ★★ 反向半边 ②：父会话**不是**本队成员 ⇒ 不得挂到任何成员底下。
   *   `outsider` 的父是一个本队之外的会话（一次性委派的典型形状）。
   */
  const withOutsider = await assembleTeamSnapshot(
    panelCtx([liveSession('m1'), liveSession('child-a', { parent: 'm1' }), liveSession('outsider', { parent: 'not-our-member' })]),
    '/nonexistent-root', 'w', state,
  )
  for (const member of withOutsider.members) {
    assert.deepEqual(
      member.liveSubagents.map((sub) => sub.id).filter((id) => id === 'outsider'), [],
      `★ 父会话不是本队成员的子代理不得被挂到 "${member.name}" 底下 —— 那是"随意归属"`,
    )
  }
  /** ★ 而它**也不许被丢掉**：它必须出现在自己的那一格里（见下一条臂）。 */
  assert.deepEqual(
    withOutsider.unattributedSubagents.map((sub) => sub.id).sort(), ['outsider'],
    '★ 父定不下来的子代理必须**自成一格**被交出去 —— 丢掉它 = 面板上它根本不存在',
  )
})

test('★ 臂 14（t27 三态臂）："读不到子代理数据"必须与"这个成员没有子代理"不同形', async () => {
  /**
   * ★★ 这是本任务点名的那条纪律（验收第 3 条）。一个把"枚举入口不在"圆成
   *   空数组的实现，会让面板**永远**显示"没有子代理" —— 而那与"确实没有"
   *   在读者眼里一模一样。缺了这一臂，本任务的整个三态设计就是一句注释。
   */
  const noEnumeration = { logger: snapshotCtx.logger, agents: { get: () => undefined } }
  const state = teamStateWith([durable({ id: 't1', status: 'completed' })])

  const blind = await assembleTeamSnapshot(noEnumeration, '/nonexistent-root', 'w', state)
  assert.equal(
    blind.members[0].subagents, 'could-not-measure',
    '★ 没有可用的会话枚举 ⇒ `could-not-measure`，**不是**"这个成员没有子代理"',
  )
  assert.equal(typeof blind.members[0].subagentsReason, 'string', '★ 未能测量必须带上成因')
  assert.ok(blind.members[0].subagentsReason.length > 0)

  /**
   * ★★ 对照臂（缺了它，"could-not-measure"可能来自任何东西）：**同一个成员**、
   *   同一个团队，唯一的差别是**枚举可用** ⇒ 那时必须是 `observed` + 空数组。
   *   ⇒ 两态在同一条输入上真的不同形。
   */
  const sighted = await assembleTeamSnapshot(panelCtx([]), '/nonexistent-root', 'w', state)
  assert.equal(
    sighted.members[0].subagents, 'observed',
    '★ 枚举可用且一个子代理都没有 ⇒ `observed`（真的没有），不是 could-not-measure',
  )
  assert.deepEqual(sighted.members[0].liveSubagents, [])
  assert.notEqual(
    blind.members[0].subagents, sighted.members[0].subagents,
    '★ 两态必须在同一条输入上真的不同形 —— 否则"读不到"与"没有"在读者眼里同形',
  )

  /**
   * ★★★ 定向突变臂的可执行形式：把三态**塌缩**掉（把 could-not-measure 当成
   *   observed + 空数组）⇒ 上面那条断言必须红。这正是那个歪路的最小复现。
   */
  const collapsed = (member) => ({ ...member, subagents: 'observed', liveSubagents: [] })
  assert.notEqual(
    collapsed(blind.members[0]).subagents, blind.members[0].subagents,
    '★ 塌缩之后读数必须**变了** —— 没变说明这条断言测的不是它声称的东西（突变是空操作）',
  )

  /**
   * ★ 反向半边：枚举入口**在**、而它**抛错** ⇒ 同样是 could-not-measure
   *   （一次失败的基础设施不许被读成"没有子代理"）。
   */
  const throwing = {
    logger: snapshotCtx.logger,
    agents: { get: () => undefined, list: () => { throw new Error('registry exploded') } },
  }
  const broken = await assembleTeamSnapshot(throwing, '/nonexistent-root', 'w', state)
  assert.equal(broken.members[0].subagents, 'could-not-measure',
    '★ 枚举抛错 ⇒ could-not-measure（不是"没有子代理"）')
  assert.match(broken.members[0].subagentsReason, /registry exploded/,
    '★ 成因必须带上真正的原因，而不是一句泛泛的"读不到"')
})

test('★ 臂 15（t27 只读臂）：投影**只读** —— 一个碰一下就抛的 ctx 走完全程', () => {
  /**
   * ── ★★ 这一臂把"只读"从**约定**变成**机械断言**（验收第 4 条）────────────────
   *
   * 用户与契约都要求："this must not spawn, steer or mutate anything"。
   * ★ "我记得我只写了读"不是证据 —— 一条会在**下一次**改动里悄悄失效。
   *   做法是把**所有**已知的"会改变东西"的入口都换成一个**碰一下就抛**的桩，
   *   然后跑完整条投影路径：只要它碰到任何一个，本臂当场红。
   *
   * ★ 桩的清单来自真实的宿主契约（`Context` 上那几个入口）：
   *   `subagents.start` / `startContinuable` / `interrupt` / `sendMessage`、
   *   `agent.steer` / `agent.whenIdle` / `agent.interrupt`，以及
   *   `ctx.tools.register`（注册一个工具也是改变世界）。
   */
  const tripped = []
  const boom = (name) => (...args) => {
    tripped.push(name)
    throw new Error(`★ 投影碰到了会改变世界的入口：${name}（args: ${JSON.stringify(args).slice(0, 80)}）`)
  }
  const sessions = [liveSession('m1'), liveSession('child-a', { parent: 'm1' })]
  /** ★ 会话对象本身也上桩：`steer`/`whenIdle` 挂在那里。 */
  const stubbed = sessions.map((session) => ({
    ...session,
    steer: boom('agent.steer'),
    whenIdle: boom('agent.whenIdle'),
    interrupt: boom('agent.interrupt'),
  }))
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    subagents: {
      start: boom('subagents.start'),
      startContinuable: boom('subagents.startContinuable'),
      interrupt: boom('subagents.interrupt'),
      sendMessage: boom('subagents.sendMessage'),
    },
    tools: { register: boom('tools.register') },
    agents: {
      get: (id) => stubbed.find((s) => s.id === id),
      list: () => stubbed,
      isOwnedBy: boom('agents.isOwnedBy'),
    },
    effect: boom('ctx.effect'),
  }

  /** ★ 三个纯读入口各自单独过一遍（不经过快照），出错即红。 */
  const projection = liveSessionRefs(ctx)
  assert.equal(projection.status, 'observed', '★ 前置：这一支必须真的读到了')
  const attribution = attributeSubagents(projection.subagents, ['m1'])
  memberSubagents(ctx, 'm1', attribution)

  assert.deepEqual(
    tripped, [],
    '★ 投影碰到了会改变世界的入口 —— 契约要求它**只读**：\n' + tripped.join('\n'),
  )

  /**
   * ★ 反向半边（防恒真）：桩**真的**会在被碰时抛 —— 缺了这一半，
   *   一个"桩根本没接上"的夹具会让 `tripped` 恒为空，而它什么都没测到。
   */
  assert.throws(() => ctx.subagents.start(), /投影碰到了会改变世界的入口/,
    '★ 反向半边：桩必须真的会抛，否则"没碰到"是恒真的')
})

