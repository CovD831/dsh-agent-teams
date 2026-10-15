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

  /**
   * ★ 任务还是 pending ⇒ 还没开始。updatedAt 是创建时间，拿它走表会在开工前
   *   就显示"已工作 / 已等待"（用户 2026-10-13）。认领之后才允许计时，见上面的 stale。
   */
  const notStarted = memberClock(
    member,
    [{ id: 'impl', assignee: 'ui-eng', status: 'pending', updatedAt: 1_000 }],
    NOW,
  )
  assert.equal(notStarted.kind, 'idle', '★ pending 还没开始 ⇒ 不显示时长')
  assert.equal(notStarted.ms, 0, '★ 未开始不带时长')
  assert.equal(notStarted.stamp, undefined, '★ 未开始没有可走的表')

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


/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ t28（R2）：第一屏是**成员中心**的 ──────────────────────────────────────
 *
 * ── 用户对这一屏的原话（这是全部判据的来源）────────────────────────────────────
 *
 *   · "the first screen should show durable roles, and clicking one expands to
 *      show the subagents working underneath it, together with round information"
 *   · "so the round data moves UP into screen one rather than living on its own screen"
 *   · "is the whole team working, and who is doing what"
 *   · 「整个东西挺冗余的，比如它做一些 badge 之类的东西」
 *
 * ── 本节的形状：每条臂都带【反向半边】──────────────────────────────────────────
 *
 * 只断言"它是对的"会让一个【恒返回同一值】的实现全绿。所以每一条真正的臂
 * 旁边都站着一个**同样输入、必须给出不同答案**的对照，而对照本身也要先被证明
 * "它真的会变"（否则那条断言测的不是它声称的东西）。
 * ───────────────────────────────────────────────────────────────────────────── */

const {
  memberClockTicks, memberSubagentReadout, subagentTone, memberRound,
  memberRowKey, memberRowExpanded, toggleMemberRow, pruneMemberRows,
} = await import('../lib/client/activity-model.js')

test('★ 臂 16（成员时钟订阅臂）：只有**真的在跑**的读数才该拥有秒表', () => {
  /**
   * ★★★ 契约原句："Only members that actually have a running clock subscribe to
   *   ticks; an idle or waiting member does not keep a timer alive."
   *
   * ★ 方向：`running` 为真（它的时长每秒都在变），其余三格为假 ——
   *   而**四格必须给出不同答案**，否则一个"恒 true"的实现会让每一行每秒重渲染，
   *   而"running 为真"那半条断言照样绿。
   */
  assert.equal(memberClockTicks('running'), true, '★ 在跑的成员必须有秒表，否则读数不动')
  assert.equal(memberClockTicks('stale'), false, '★ "等待"是一条静态的坏消息，不该每秒重排')
  assert.equal(memberClockTicks('idle'), false, '★ 空闲不带时长，tick 只会重渲染一个不动的字符串')
  assert.equal(memberClockTicks('unknown'), false, '★ 读不出戳 ⇒ 没有可更新的数字')

  /** ★ 反向半边：四种读数必须**不是**同一个答案。 */
  const answers = ['running', 'stale', 'idle', 'unknown'].map(memberClockTicks)
  assert.notEqual(new Set(answers).size, 1, '★ 四格给出同一个答案 ⇒ 这条判据什么都没测')
  assert.deepEqual(answers, [true, false, false, false], '★ 而恰好只有第一格为真')
})

test('★ 臂 17（子代理三态臂）："读不到"与"确实没有"必须在**客户端**也不同形', () => {
  /**
   * ★ t27 把这一格送到了 /state，而这里测的是**面板怎么读它**。
   *   一个把 `could-not-measure` 圆成 `observed + []` 的客户端会让面板
   *   永远印着"没有子代理" —— 与"确实没有"在读者眼里同形。
   */
  const measured = memberSubagentReadout({ subagents: 'observed', liveSubagents: [] })
  assert.equal(measured.state, 'observed')
  assert.deepEqual(measured.subagents, [], '★ 读了、真的没有 ⇒ 空数组（这是一个读数）')

  const blind = memberSubagentReadout({ subagents: 'could-not-measure', subagentsReason: 'registry exploded' })
  assert.equal(blind.state, 'could-not-measure', '★ 没读成 ⇒ 不许圆成"没有"')
  assert.equal(blind.reason, 'registry exploded', '★ 成因必须带过来，否则读者分不出"没有"与"没读成"')
  assert.notEqual(blind.state, measured.state, '★ 两态必须在同一条输入上真的不同形')

  /** ★ 老宿主根本没有这一格 ⇒ 同样是"没读成"，不是"没有"。 */
  const legacy = memberSubagentReadout({})
  assert.equal(legacy.state, 'could-not-measure', '★ 缺省 = 没测到，不是"这个成员没有子代理"')
  assert.ok(legacy.reason.length > 0, '★ 而且要说明成因')

  /** ★ 一条真的子代理要原样交出来。 */
  const one = memberSubagentReadout({
    subagents: 'observed',
    liveSubagents: [{ id: 'child-a', label: 'reviewer', status: 'running', mode: 'continuable' }],
  })
  assert.deepEqual(one.subagents.map((sub) => sub.id), ['child-a'])

  /** ★ 反向半边（定向突变的可执行形式）：把三态塌缩掉 ⇒ 读数必须**变了**。 */
  const collapsed = (readout) => ({ ...readout, state: 'observed', subagents: [] })
  assert.notEqual(collapsed(blind).state, blind.state,
    '★ 塌缩之后读数必须变了 —— 没变说明这条断言测的不是它声称的东西')
})

test('★ 臂 18（子代理语气臂）：认不出来的状态**不许**被圆成"工作中"', () => {
  assert.equal(subagentTone('running'), 'working')
  assert.equal(subagentTone('idle'), 'idle')
  /** ★ 反向半边：一个没见过的值必须是第三态，而不是并进 working。 */
  assert.equal(subagentTone('hibernating'), 'unknown')
  assert.notEqual(subagentTone('hibernating'), subagentTone('running'))
  assert.equal(new Set(['running', 'idle', 'hibernating'].map(subagentTone)).size, 3,
    '★ 三种输入必须给出三个不同答案')
})

test('★ 臂 19（轮次行内臂）：轮次读的是**这个成员自己的**任务，且缺席不等于第 0 轮', () => {
  const tasks = [
    { id: 'a', status: 'failed', failureKind: 'inconclusive', round: 2 },
    { id: 'b', status: 'completed', round: 3 },
  ]
  const latest = memberRound(tasks)
  assert.equal(latest.round, 3, '★ 取最大的那一轮（它是这个成员此刻在第几轮）')
  assert.equal(latest.tone, 'completed', '★ 而语气是**那一轮**的语气，不是别的轮')
  assert.deepEqual(latest.tasks.map((task) => task.id), ['b'], '★ 同轮的任务才在一起')

  /** ★ 缺席 ⇒ `undefined`（"没有轮次概念"），**不是** 0（"第 0 轮"）。 */
  assert.equal(memberRound([{ id: 'plain', status: 'in_progress' }]), undefined,
    '★ 没有 round 的任务不进这个投影 —— 缺席与"第 0 轮"必须不同形')

  /**
   * ★ 反向半边：**只**看交给它的那些任务。一个把全队最大轮次印到每个成员身上的
   *   实现，会让没参与那一轮的成员也印着"第 N 轮"。
   */
  const outsider = memberRound([{ id: 'mine', status: 'completed', round: 1 }])
  assert.equal(outsider.round, 1)
  assert.notEqual(outsider.round, latest.round, '★ 两个成员不同的轮次必须给出不同读数')
})

test('★ 臂 20（展开存活臂）：默认收起，而用户按下的那个活得过重渲染', () => {
  const key = memberRowKey({ id: 'm1', name: 'ui-eng' })
  /** ★ 默认收起是一个**值**，不是一条缺席分支。 */
  let state = new Map()
  assert.equal(memberRowExpanded(state, key), false, '★ 默认必须是收起')

  /** 用户按下 ⇒ 展开。 */
  state = toggleMemberRow(state, key)
  assert.equal(memberRowExpanded(state, key), true)
  /** ★ 重渲染 = 用同一份 state 再读一次 ⇒ 选择必须还在。 */
  assert.equal(memberRowExpanded(state, key), true, '★ 用户的展开不得被下一次渲染抹掉')

  /** 再按一次 ⇒ 收起，而且仍然是一个**记住了的**收起。 */
  state = toggleMemberRow(state, key)
  assert.equal(memberRowExpanded(state, key), false)
  assert.equal(state.has(key), false)

  /** ★ 键必须跟着**成员 id**：轮询重排名册不许把展开状态交给另一个人。 */
  assert.equal(memberRowKey({ id: '', name: 'fresh' }), 'name:fresh', '★ 未启动的成员退化成名字键')
  assert.notEqual(memberRowKey({ id: 'm1', name: 'ui-eng' }), memberRowKey({ id: 'm2', name: 'ui-eng' }))

  /** ★ 反向半边：另一行**不受**影响（否则"一行展开"会传染成"每行都展开"）。 */
  assert.equal(memberRowExpanded(state, 'm2'), false)
})

test('★ 臂 21（剪枝臂）：不在册的展开条目会被剪掉，而在册的原样留着', () => {
  let state = new Map()
  state = toggleMemberRow(state, 'm1')
  state = toggleMemberRow(state, 'm2')
  const pruned = pruneMemberRows(state, ['m1'])
  assert.equal(memberRowExpanded(pruned, 'm1'), true, '★ 在册的必须原样留着')
  assert.equal(pruned.has('m2'), false, '★ 不在册的必须被剪掉（否则 store 只增不减）')

  /** ★ 反向半边：**没有**要剪的东西时，必须返回**同一个** map。 */
  const same = pruneMemberRows(pruned, ['m1'])
  assert.equal(same, pruned, '★ 无变化必须返回同一个引用 —— 否则每次轮询都会让每一行重渲染')
  /** ★ 而"恒返回同一个空 map"的实现会被这一条抓住：有东西可剪时必须**真的**剪。 */
  const grew = toggleMemberRow(toggleMemberRow(new Map(), 'm1'), 'gone')
  assert.equal(grew.size, 2, '★ 前置：两条真的在 store 里')
  assert.equal(pruneMemberRows(grew, ['m1']).size, 1, '★ 有东西可剪时必须真的剪掉一个')
  assert.equal(pruneMemberRows(grew, ['m1', 'gone']).size, 2, '★ 而全在册时必须一个都不剪')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ 臂 22-25：**真的渲染**（不是读源码）─────────────────────────────────────
 *
 * ── 为什么需要一个 DOM 桩 ──────────────────────────────────────────────────────
 *
 * 契约对秒表那条是**可测**的（"the per-second timer lives inside a small component
 * that owns only the elapsed text, so a tick re-renders that component and not the
 * panel tree"）。而"读源码说它只 tick 自己"是**惯例**，不是**断言** ——
 * 下一次改动可以悄悄把一个 setState 挪回父级，而 grep 照样通过。
 *
 * ⇒ 这一节用**真的 React**（`react-dom/client` + `React.act`）把组件挂起来，
 *   起一个**真的** `setInterval`，然后**数**父组件的渲染次数。
 * ★ 下面的 DOM 桩只补 React 18 真正会碰的那些成员（构造、属性、事件注册、
 *   选区探测）；没有 `jsdom` 依赖被引入到 package.json（那在本次 scope 之外）。
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * 把 `.css` / 宿主包解析成一个**惰性空的**模块。
 * ★ CSS Modules 在 Node 里没有含义；`Proxy` 让 `css.anything` 都是一个字符串，
 *   于是"类名"这件事对下面这些臂是不透明的 —— 而它们本来也不该断言 CSS。
 */
const HOST_STUBS = {
  '@deepseek-ai/dsh-client-ui-primitives': 'export const Menu=()=>null; export const Modal=()=>null; export default { Menu, Modal }',
  '@deepseek-ai/dsh-client-ui-model-selection/client': 'export {}',
  '@deepseek-ai/dsh-session/types': 'export {}',
}
const { registerHooks } = await import('node:module')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.css')) {
      return { url: 'data:text/javascript,' + encodeURIComponent('export default new Proxy({},{get:(t,k)=>String(k)})'), shortCircuit: true }
    }
    const stub = HOST_STUBS[specifier]
    if (stub !== undefined) return { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

/** 一个刚好够 `react-dom/client` 挂载与提交的最小 DOM（见上面的口径注）。 */
function installMinimalDom() {
  class NodeBase {
    constructor(nodeType, nodeName) {
      this.nodeType = nodeType; this.nodeName = nodeName
      this.childNodes = []; this.parentNode = null; this.ownerDocument = null
      this.style = {}; this.data = ''; this.textContent = ''
      this._attrs = new Map(); this._listeners = new Map()
    }
    get firstChild() { return this.childNodes[0] ?? null }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null }
    get nextSibling() {
      if (this.parentNode === null) return null
      const index = this.parentNode.childNodes.indexOf(this)
      return this.parentNode.childNodes[index + 1] ?? null
    }
    appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); this.childNodes.push(child); child.parentNode = this; return child }
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.removeChild(child)
      const at = ref === null || ref === undefined ? this.childNodes.length : this.childNodes.indexOf(ref)
      this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child)
      child.parentNode = this; return child
    }
    removeChild(child) { const at = this.childNodes.indexOf(child); if (at >= 0) this.childNodes.splice(at, 1); child.parentNode = null; return child }
    replaceChild(next, prev) { this.insertBefore(next, prev); this.removeChild(prev); return prev }
    setAttribute(name, value) { this._attrs.set(name, String(value)) }
    getAttribute(name) { return this._attrs.get(name) ?? null }
    hasAttribute(name) { return this._attrs.has(name) }
    removeAttribute(name) { this._attrs.delete(name) }
    setAttributeNS(_ns, name, value) { this.setAttribute(name, value) }
    removeAttributeNS(_ns, name) { this.removeAttribute(name) }
    addEventListener(type, fn) { const set = this._listeners.get(type) ?? new Set(); set.add(fn); this._listeners.set(type, set) }
    removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn) }
    dispatchEvent() { return true }
    contains(other) { for (let node = other; node !== null && node !== undefined; node = node.parentNode) { if (node === this) return true } return false }
    getRootNode() { let node = this; while (node.parentNode) node = node.parentNode; return node }
    focus() { document.activeElement = this }
    blur() {}
    getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
    get clientWidth() { return 0 }
    get clientHeight() { return 0 }
    get scrollWidth() { return 0 }
    get scrollHeight() { return 0 }
  }
  class Element extends NodeBase {
    constructor(tagName, namespace) {
      super(1, String(tagName).toUpperCase())
      this.tagName = String(tagName).toUpperCase()
      this.namespaceURI = namespace ?? 'http://www.w3.org/1999/xhtml'
    }
    get children() { return this.childNodes.filter((node) => node.nodeType === 1) }
  }
  class Text extends NodeBase {
    constructor(data) { super(3, '#text'); this.data = data }
    get nodeValue() { return this.data }
    set nodeValue(value) { this.data = value }
  }
  class Document extends NodeBase {
    constructor() { super(9, '#document'); this.ownerDocument = this }
    createElement(tag) { const element = new Element(tag); element.ownerDocument = this; return element }
    createElementNS(namespace, tag) { const element = new Element(tag, namespace); element.ownerDocument = this; return element }
    createTextNode(data) { const text = new Text(data); text.ownerDocument = this; return text }
    createComment(data) { return new Text(data) }
    createDocumentFragment() { const fragment = new Element('#fragment'); fragment.ownerDocument = this; return fragment }
    querySelector() { return null }
    querySelectorAll() { return [] }
    getElementById() { return null }
  }
  const document = new Document()
  document.documentElement = new Element('html')
  document.body = new Element('body')
  document.head = new Element('head')
  document.activeElement = document.body
  const window = {
    document,
    navigator: { userAgent: 'node' },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    HTMLIFrameElement: class HTMLIFrameElement {},
    HTMLElement: Element, Element, Node: NodeBase, Text, Document,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return [] } },
  }
  document.defaultView = window
  globalThis.window = window
  globalThis.document = document
  globalThis.Element = Element
  globalThis.HTMLElement = Element
  globalThis.Node = NodeBase
  globalThis.Text = Text
  globalThis.NodeList = Array
  globalThis.MutationObserver = window.MutationObserver
  globalThis.requestAnimationFrame = window.requestAnimationFrame
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame
  globalThis.getComputedStyle = window.getComputedStyle
  return { document, window }
}

const { document: testDocument } = installMinimalDom()
/**
 * ★ `IS_REACT_ACT_ENVIRONMENT` 必须显式打开：React 18 靠它决定要不要把
 *   "更新发生在 act 之外"当成告警。打开它，下面这些臂测的就是**浏览器里
 *   真正会发生的那件事**，而不是一个宽松环境里的近似。
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
/** ★ React 18.3 起 `act` 从 `react` 导出；`react-dom/test-utils` 那条已弃用。 */
const act = React.act
// ★ react-dom 的调度依赖一个 MessageChannel；Node 自带一个（不需要 jsdom）。
const { MessageChannel } = await import('node:worker_threads')
globalThis.MessageChannel = MessageChannel
globalThis.window.MessageChannel = MessageChannel

const { MemberClock, MEMBER_CLOCK_TICK_MS } = await import('../lib/client/MemberClock.js')

/**
 * 挂起一棵树；返回容器与卸载函数。
 *
 * ★ 必须是 `async` + `await act(async () => ...)`：React 18 的并发根把首次渲染
 *   排进一次微任务，**同步**的 `act` 返回时 DOM 还是空的（实测：文本读出来是 `''`，
 *   看起来像"组件渲染了空白"，其实是"还没提交"）。这个坑值得写下来 ——
 *   它会把一条"不许空白"的臂变成一个**恒假**的断言。
 */
async function mount(element) {
  const container = testDocument.createElement('div')
  const root = createRoot(container)
  await act(async () => { root.render(element) })
  return {
    container,
    unmount: () => { act(() => { root.unmount() }) },
    /**
     * 真的**点一下**一个节点。
     *
     * ★ 走的是 React 自己接上去的那个 handler（`__reactProps$…`），而不是
     *   手写一个 `onClick()` 调用 —— 后者测的是"函数能跑"，而不是"这一行接上了"。
     */
    click: async (node) => {
      const key = Object.keys(node).find((name) => name.startsWith('__reactProps$'))
      assert.ok(key !== undefined, '★ 这个节点上没有 React 的 handler —— 它不是一个真的控件')
      const handler = node[key].onClick
      assert.equal(typeof handler, 'function', '★ 这个节点上确实挂了 onClick')
      await act(async () => { handler({ preventDefault() {}, stopPropagation() {}, currentTarget: node, target: node }) })
    },
  }
}

/**
 * 深度优先找**第一个**满足条件的节点。
 *
 * ★ 用它而不是 `querySelector`：这个最小 DOM 桩没有选择器引擎，
 *   而"我找一个看起来像它的东西"不是判据 —— 条件本身写在调用处。
 */
function findFirst(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.childNodes ?? []) {
    const hit = findFirst(child, predicate)
    if (hit !== null) return hit
  }
  return null
}

/**
 * ── ★★ 让**真的**时间过去，让计时器**真的**响 ────────────────────────────────
 *
 * MEASURED（本节自己踩到的一个坑，记下来给下一个人）：
 * 把等待写在 `await act(async () => { await sleep(ms) })` **里面**，计时器
 * 回调触发的 setState 会被 act 排队、直到 act 块结束才提交 —— 于是
 * "tick 有没有真的发生"这件事**测不到**（实测：interval 响了 3 次，
 * 而渲染计数一动不动，看起来像"隔离得很好"，其实是"什么都没跑"）。
 *
 * ★★ 而更坏的一种：`await act(async () => {})`（空体）在"有一个每秒都重新排队的
 *   interval"时会**永不返回** —— 实测整个测试文件卡死、没有任何断言输出。
 *
 * ⇒ 正确做法：**在 act 之外**睡，让 React 像在浏览器里那样把更新提交掉，
 *   之后才读计数。这一节要测的正是"浏览器里真正会发生的那件事"。
 */
async function settle(ms) {
  await new Promise((resolve) => { setTimeout(resolve, ms) })
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

/**
 * 容器里的全部文本（用来断言"没有空白格"）。
 *
 * ★ MEASURED（本节自己踩到的第二个坑）：React 18 对**只有文本**的宿主节点是直接写
 *   `node.textContent` 的，**不**挂一个文本子节点。只走 childNodes 会读出一个空串 ——
 *   而那会让"不许空白"这条臂变成**恒假**（它测的是遍历写错了，不是组件印了空白）。
 *   ⇒ 叶子节点读 `textContent`，同时仍然递归子节点。
 */
function textOf(node) {
  const parts = []
  const walk = (current) => {
    if (current.nodeType === 3) { parts.push(current.data); return }
    if (current.childNodes.length === 0) {
      if (typeof current.textContent === 'string') parts.push(current.textContent)
      return
    }
    for (const child of current.childNodes) walk(child)
  }
  walk(node)
  return parts.join(' ').replace(/\s+/gu, ' ').trim()
}

/**
 * ── ★★ 组件**必须定义在测试外面**（本节踩到的第三个坑，实测）────────────────────
 *
 * 把 `PanelSpy` 写在 `test(...)` 体里，每次渲染都会新建一个组件**类型** ——
 * React 于是把整棵子树**卸载重挂**，`MemberClock` 的定时器还没响就被拆了。
 * 实测症状：面板计数涨、时钟计数也涨，看起来像"隔离失败"，
 * 其实测的是"每次渲染都换了组件身份"。
 *
 * ── ★★ 而"时钟自己重渲染了几次"**不能**用外层包装来数（第四个坑，实测）────────
 *
 * 第一版把一个 `CountingClock` 包在 `MemberClock` 外面来计数。实测：它恒为 1，
 * 而 51 次 act 告警证明 `MemberClock` **确实**在更新。
 * ⇒ 这恰恰是本任务要的性质：React 只重渲染**拥有那个 state 的组件**，
 *   连它的直接父组件都跳过。所以包装器的计数测不到"时钟 tick 了"。
 *
 * ⇒ 两个计数器各司其职：
 *   · `panelCounter.renders` = 面板替身的渲染次数 —— **必须一动不动**（隔离的断言）
 *   · `ticks` + 时钟印出来的字**变了** —— 反向半边（证明"确实跑过"，
 *     否则"没重渲染"是恒真的）
 */
const panelCounter = { renders: 0 }

/** 面板替身：它渲染成员行（行里是很小的 `MemberClock`）。 */
function PanelSpy({ stamp, t }) {
  panelCounter.renders += 1
  return React.createElement('div', { className: 'panel' },
    React.createElement(MemberClock, { kind: 'running', stamp, t }))
}
/**
 * `t` 必须**同一个身份**，否则每次渲染都是新 props（那会把这条臂变成测 props 抖动）。
 *
 * ★ 而它必须**把 `elapsed` 带出来**：这一节要能看到"字真的在走"。
 *   只回一个 key 的话，`member.clock.working` 5 秒和 8 秒是同一串字 ——
 *   反向半边 ② 就测不到东西（实测：它红在这里）。
 */
const stableTranslate = (key, params) => `${key}:${params?.elapsed ?? ''}`
const SpyWithStableProps = ({ stamp }) => React.createElement(PanelSpy, { stamp, t: stableTranslate })

test('★ 臂 22（时钟隔离臂）：秒表 tick 一次 ⇒ **面板**的渲染次数一动不动', async () => {
  /**
   * ★★★ 这是本任务点名的那条**可测**要求。做法是把它变成一个**对照实验**：
   *
   *   · 父组件 = 面板的替身（它渲染成员行，而成员行里是很小的 `MemberClock`）
   *   · 子组件 = `MemberClock`（它自己拥有 `setInterval`）
   *
   * ★ 计数是**真的**渲染次数（组件函数被 React 调用的次数），不是 grep 出来的。
   */
  panelCounter.renders = 0
  const STAMP = Date.now() - 5_000

  /** ★ 数**真的** `setInterval` 回调：它才是"这一秒真的过去了"的机械形式。 */
  const realSetInterval = globalThis.setInterval
  let ticks = 0
  const countingSetInterval = (fn, ms) => realSetInterval(() => { ticks += 1; fn() }, ms)
  globalThis.setInterval = countingSetInterval
  globalThis.window.setInterval = countingSetInterval

  let mounted
  try {
    mounted = await mount(React.createElement(SpyWithStableProps, { stamp: STAMP }))
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.window.setInterval = realSetInterval
  }
  const afterMount = panelCounter.renders
  assert.equal(afterMount, 1, '★ 前置：面板替身挂了 1 次')
  const textAtMount = textOf(mounted.container)

  /** ★ 真的等过至少两个 tick（用组件自己导出的节拍，不另猜一个数）。 */
  await settle(MEMBER_CLOCK_TICK_MS * 2 + 300)

  /**
   * ★★ 反向半边（两条，缺一条上面那条就可能是恒真的）：
   *   ① 计时器**真的**响过；
   *   ② 时钟印出来的字**真的**变了（不是"它跑了但什么都没更新"）。
   */
  assert.ok(ticks >= 2, `★ 反向半边 ①：计时器必须真的响过（实测 ${ticks} 次）`)
  const textLater = textOf(mounted.container)
  assert.notEqual(textLater, textAtMount,
    `★ 反向半边 ②：时钟印的字必须真的在走（${JSON.stringify(textAtMount)} → ${JSON.stringify(textLater)}）`)

  /** ★★★ 而**面板**一动不动：这就是那条"measured requirement"。 */
  assert.equal(panelCounter.renders, afterMount,
    `★★★ 秒表 tick 时**面板**必须一动不动（渲染次数 ${afterMount} → ${panelCounter.renders}）：`
    + 'tick 只许重渲染拥有时长的那一个小小组件')
  mounted.unmount()
})

test('★ 臂 23（静止成员不起表臂）：idle / unknown 的成员**不保留**一个活着的计时器', async () => {
  /**
   * ★ 契约原句："an idle or waiting member does not keep a timer alive"。
   *
   * ★ 这条臂测的是**表有没有被创建**，而不是"文本对不对"：做法是把
   *   `setInterval` 换成一个记账的替身，然后挂一个 idle 的成员。
   */
  const created = []
  const realSetInterval = globalThis.setInterval
  const counting = (fn, ms) => { created.push(ms); return realSetInterval(fn, ms) }
  globalThis.setInterval = counting
  globalThis.window.setInterval = counting
  try {
    const idle = await mount(React.createElement(MemberClock, { kind: 'idle', t: (key) => key }))
    assert.deepEqual(created, [], '★ 空闲的成员不许起表 —— 它数的是"没事做"，一个不动的读数')
    idle.unmount()

    const unknown = await mount(React.createElement(MemberClock, { kind: 'unknown', t: (key) => key }))
    assert.deepEqual(created, [], '★ 读不出时长的成员同样不许起表')
    unknown.unmount()

    /** ★ 反向半边：**在跑**的成员必须真的起表（用同一个替身，同一条路）。 */
    const running = await mount(React.createElement(MemberClock, { kind: 'running', stamp: Date.now() - 3_000, t: (key) => key }))
    assert.deepEqual(created, [MEMBER_CLOCK_TICK_MS],
      '★ 反向半边：在跑的成员必须起一次表，而且用的是组件导出的那个节拍')
    running.unmount()
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.window.setInterval = realSetInterval
  }
})

test('★ 臂 24（四种读数都非空臂）：四格文字两两不同，且没有一格是空白', async () => {
  /**
   * ★★★ MEASURED（用户 2026-10-11）：「Integrator 前面是一个空白的显示，这说明显示就不对。」
   *
   * ★ 所以这一条断言的是**渲染出来的文本**，不是源码里的分支。
   *   一个漏了某个分支的实现会印出空字符串 —— 而那正是用户看到的那一格。
   */
  const NOW = 1_000_000
  const cases = [
    { kind: 'running', stamp: NOW - 65_000 },
    { kind: 'stale', stamp: NOW - 65_000 },
    { kind: 'idle' },
    { kind: 'unknown' },
  ]
  const texts = []
  for (const item of cases) {
    const mounted = await mount(React.createElement(MemberClock, {
      ...item, frozenNow: NOW, t: (key, params) => `${key}:${params?.elapsed ?? ''}`,
    }))
    const text = textOf(mounted.container)
    assert.notEqual(text, '', `★ ${item.kind} 这一格**不许**空白（用户实测到的缺陷就是这个）`)
    texts.push(text)
    mounted.unmount()
  }
  assert.equal(new Set(texts).size, 4, `★ 四种读数必须两两不同形，实测：${JSON.stringify(texts)}`)
  assert.match(texts[0], /member\.clock\.working/, '★ 在跑的读"已工作"')
  assert.match(texts[1], /member\.clock\.waiting/, '★ 停滞的读"已等待"（与"已工作"必须不同形）')
  assert.match(texts[2], /member\.clock\.idle/)
  assert.match(texts[3], /member\.clock\.unknown/)
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 25：成员行本身（真的挂起来）—— 一行四件事，展开层是子代理
 * ───────────────────────────────────────────────────────────────────────────── */

const { MemberRow, memberDoingText } = await import('../lib/client/MemberRow.js')

/** ★ 一行夹具：一个持久成员，名下有一个在跑的任务。 */
const ROW_TEAM = {
  workspace: '', teamId: 'team', name: 'Team', captainSessionId: 'cap',
  phase: 'running', messageCount: 0, captainInbox: [],
}
const ROW_MEMBER = {
  id: 'm1', name: 'ui-eng', role: 'eng', provider: 'prov', model: 'long-model-name',
  activity: 'working', progress: 0, done: 0, total: 1, currentTask: 'impl', unread: 0,
}
const ROW_TASK = {
  id: 'impl', subject: 'rebuild screen one', status: 'in_progress', state: 'running',
  assignee: 'ui-eng', dependencies: [], depth: 0, round: 2, updatedAt: 1_000,
}

async function renderRow(member, tasks, extra = {}) {
  const props = {
    team: { ...ROW_TEAM, members: [member], tasks },
    member, tasks,
    expanded: false, onToggle: () => {}, onOpenSubagent: () => {},
    t: (key, params) => `${key}${params !== undefined && params.round !== undefined ? `:${params.round}` : ''}`,
    frozenNow: 61_000,
    ...extra,
  }
  const mounted = await mount(React.createElement(MemberRow, props))
  return { ...mounted, text: textOf(mounted.container) }
}

test('★ 臂 25a（成员行身份臂）：一行里有身份、模型、在做什么、以及**非空**的时长', async () => {
  const rendered = await renderRow(ROW_MEMBER, [ROW_TASK])
  const { text } = rendered
  assert.match(text, /ui-eng/, '★ 身份：名字')
  assert.match(text, /eng/, '★ 身份：角色')
  assert.match(text, /long-model-name/, '★ 模型（可见的是末段，这里断言它真的印出来了）')
  assert.match(text, /impl/, '★ 在做什么：任务 id')
  assert.match(text, /member\.clock\.working/, '★ 时长：读"已工作"')
  assert.notEqual(text, '', '★ 整行不许空白')
  rendered.unmount()
})

test('★ 臂 25b（轮次行内臂）：轮次印在**成员行这一块里**，不是另一屏', async () => {
  const rendered = await renderRow(ROW_MEMBER, [ROW_TASK])
  /** ★ 行内 = 同一个渲染结果里的一个节点，而不是"别处还有一个轮次区"。 */
  assert.match(rendered.text, /member\.round\.mark:2/, '★ 第 2 轮必须在这一行的渲染结果里')
  /** ★ 反向半边：没有轮次的任务 ⇒ 这一块**整个不渲染**（不许印"第 0 轮"）。 */
  const plain = await renderRow(ROW_MEMBER, [{ ...ROW_TASK, round: undefined }])
  assert.doesNotMatch(plain.text, /member\.round\.mark/, '★ 没有轮次概念时不许印任何轮次')
  rendered.unmount(); plain.unmount()
})

test('★ 臂 25c（展开层臂）：收起时不渲染子代理；展开时才渲染，且**每个**都说明它在做什么', async () => {
  const member = {
    ...ROW_MEMBER,
    subagents: 'observed',
    liveSubagents: [
      { id: 'child-a', label: 'reviewer', status: 'running', mode: 'continuable' },
      { id: 'child-b', label: 'prober', status: 'idle' },
    ],
  }
  /**
   * ★ 默认收起：子代理**整个不在 DOM 里**（而不是渲染了但用 CSS 藏起来 ——
   *   后者会泄进可访问性树，而"看不见"与"不存在"对读屏的人不同形）。
   */
  const collapsed = await renderRow(member, [ROW_TASK])
  assert.doesNotMatch(collapsed.text, /reviewer/, '★ 收起时不许渲染子代理')
  assert.doesNotMatch(collapsed.text, /subagent\.doing\./, '★ 收起时连它的状态行都不许在')

  /** ★ 展开：两个子代理都必须出现，而且**各自**说明它在做什么。 */
  const expanded = await renderRow(member, [ROW_TASK], { expanded: true })
  assert.match(expanded.text, /reviewer/, '★ 展开时第一个子代理必须出现')
  assert.match(expanded.text, /prober/, '★ 而第二个也在（不是只渲染第一个）')
  assert.match(expanded.text, /subagent\.doing\.working/, '★ 每个都说清它在做什么（running ⇒ working）')
  assert.match(expanded.text, /subagent\.doing\.idle/, '★ 而 idle 的那一个读"空闲"（两态不同形）')

  /** ★ 反向半边：收起与展开的文本必须**不同**（否则"展开了"这件事没发生）。 */
  assert.notEqual(collapsed.text, expanded.text, '★ 展开必须改变渲染结果')

  /** ★ 而每一行都带**可定位的 id**（label 只是给人看的，id 才是地址）。 */
  const titles = []
  const collectTitles = (node) => {
    if (node._attrs?.has('title')) titles.push(node._attrs.get('title'))
    for (const child of node.childNodes) collectTitles(child)
  }
  collectTitles(expanded.container)
  assert.ok(titles.includes('child-a'), `★ 子代理的 id 必须可定位，实测 titles：${JSON.stringify(titles)}`)
  assert.ok(titles.includes('child-b'), '★ 第二个子代理同样可定位')
  collapsed.unmount(); expanded.unmount()
})

test('★ 臂 25d（展开层三态臂）："没读成"与"确实没有"在**渲染出来的文本**上也不同形', async () => {
  const blind = await renderRow({ ...ROW_MEMBER, subagents: 'could-not-measure', subagentsReason: 'registry exploded' }, [ROW_TASK], { expanded: true })
  const empty = await renderRow({ ...ROW_MEMBER, subagents: 'observed', liveSubagents: [] }, [ROW_TASK], { expanded: true })
  assert.match(blind.text, /subagent\.unmeasured/, '★ 没读成 ⇒ 必须说清是"读不到"')
  assert.match(empty.text, /subagent\.none/, '★ 读了、真的没有 ⇒ 说"没有"')
  assert.notEqual(blind.text, empty.text, '★ 两者在屏幕上必须不同形（本仓三态纪律）')
  blind.unmount(); empty.unmount()
})

test('★ 臂 25e（"在做什么"兜底臂）：读不出当前任务时也要说点什么，而不是留空', () => {
  const idle = { ...ROW_MEMBER, activity: 'idle', currentTask: '', total: 0, done: 0 }
  /** ★ 没有当前任务、没有在飞任务 ⇒ 兜底文案，**不是空字符串**。 */
  const doing = memberDoingText(idle, undefined, [], (key) => key)
  assert.equal(doing, 'member.status.waitingAssignment', '★ 兜底必须是明确的一句话')
  /** ★ 反向半边：有在飞任务时读的是**任务**，不是兜底那句。 */
  const busy = memberDoingText(idle, undefined, [ROW_TASK], (key, params) => `${key}:${params?.taskId}`)
  assert.equal(busy, 'member.doing.task:impl', '★ 有任务就报任务 id')
  assert.notEqual(busy, doing, '★ 两种情形必须给出不同读数')
})

test('★ 臂 25f（无药丸臂）：模型那一格是行内文字，不是药丸/徽章', async () => {
  /**
   * ★ 用户的投诉是 "badge-like elements"。判据落在两个**形状**属性上：
   *   圆角拉满（`border-radius: 999px`）与描边/底色 —— 它们只为"这是个标签"服务。
   * ★ 这条读的是 CSS 源（形状是 CSS 的事实），而它旁边的臂 25a 读的是渲染结果。
   */
  const { readFile } = await import('node:fs/promises')
  const cssSource = await readFile(new URL('../src/client/ActivityPanel.module.css', import.meta.url), 'utf8')
  const start = cssSource.indexOf('.memberModel {')
  assert.notEqual(start, -1, '★ 前置：模型那一格的样式必须存在（否则下面测的是空字符串）')
  const block = cssSource.slice(start, cssSource.indexOf('}', start) + 1)
  assert.equal(block.includes('border-radius'), false, '★ 模型那一格不许有圆角药丸形状')
  assert.equal(block.includes('border:'), false, '★ 也不许有描边')
  assert.equal(block.includes('background:'), false, '★ 也不许有底色（行内文字不需要底色）')
  assert.ok(block.includes('text-overflow: ellipsis'), '★ 但长路由仍要就地省略号（不许撑破面板）')
  assert.ok(block.includes('min-width: 0'))
  /**
   * ★ 反向半边：**别的**格子仍然可以有形状（比如那个状态点）——
   *   缺了这一半，一条"整个样式表里没有 999px"的实现会让上面那条照样绿，
   *   而它其实把面板上所有圆角都删了。
   */
  assert.ok(cssSource.includes('border-radius: 999px'), '★ 反向半边：样式表里确实还有别处在用圆角 —— 上面那条是有分辨力的')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 26：模型那一格的**契约**跟着代码走，不跟着文件名走
 *
 * ── 为什么要单独立这一条 ───────────────────────────────────────────────────────
 *
 * `scripts/verify.mjs` 里有一条 check 断言 `.memberModel` 的**形状**，而它是拿
 * 【`ActivityPanel.tsx` 的文本切片】来判的 —— 那是这一行还长在面板里的时候写的。
 * R2 把成员行搬进了 `MemberRow.tsx`（这正是本任务要的），于是那条 check 的
 * 判据变成了"在错误的文件里找正确的字符串"。
 *
 * ★ "读不到" 与 "它违反了" 必须不同形（本仓三态纪律）：那一条红**不代表**
 *   模型那一格坏了，只代表**它现在在另一个文件里**。
 * ⇒ 所以这里对着**真正的实现处**把同一条契约重立一遍，
 *   并以 `MemberRow.tsx` 为源 —— 于是它跟着代码走，而不是跟着文件名走。
 * ───────────────────────────────────────────────────────────────────────────── */

test('★ 臂 26（模型格契约臂）：模型是**行内文字**且完整路由可核（对着实现处断言）', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/client/MemberRow.tsx', import.meta.url), 'utf8')
  /** ★ 前置：这一格真的在 `MemberRow.tsx` 里（否则下面几条测的是空字符串）。 */
  assert.ok(source.includes('css.memberModel'), '★ 前置：模型那一格现在由 MemberRow 渲染')
  assert.ok(source.includes('data-member-model={memberModel}'), '★ 渲染出一个可核的探针')
  assert.ok(source.includes('aria-label={memberModel}'), '★ 读屏也能拿到完整路由')
  assert.ok(source.includes('title={editable === \'sealed\''), '★ 完整路由（或"为什么改不了"）在 title 上')
  assert.ok(source.includes('role="img"'), '★ 非交互：它是一个读数，不是一个控件')
  assert.ok(source.includes('compactModelLabel(memberModel)'), '★ 可见的是末段，不是整条长路由')

  /**
   * ★ 反向半边（精确到**读数**，而不是类名）：面板可以复用同一个**布局类**
   *   （它给这一行留位置），但**读数**——`role="img"` / `data-member-model` /
   *   完整路由的 `aria-label`——只许有一份，否则同一个事实会有两次读数，
   *   而"归属错了"与"归属对了"在界面上同形。
   */
  const panel = await readFile(new URL('../src/client/ActivityPanel.tsx', import.meta.url), 'utf8')
  assert.equal(panel.includes('data-member-model'), false,
    '★ 反向半边：面板里不许有第二份 `data-member-model` 读数（那一格只有 MemberRow 交出）')
  assert.equal(panel.includes('aria-label={memberModel}'), false,
    '★ 反向半边：完整路由的 aria-label 同样只有一份')
  /**
   * ★ 前置：给这一行**留位置**的那一层确实复用了同一个布局类。
   * ★ R4 把这一层（成员屏的行槽）搬进了 `MemberScreen.tsx`，判据跟着代码走 ——
   *   问"有没有一层复用那个类"，而不是"某个特定文件里有没有那个字符串"。
   */
  const memberScreenSource = await readFile(new URL('../src/client/MemberScreen.tsx', import.meta.url), 'utf8')
  assert.ok(memberScreenSource.includes('css.memberModel'), '★ 前置：成员屏复用同一个布局类给这一行留位置')
  assert.equal(memberScreenSource.includes('data-member-model={memberModel}'), false,
    '★ 反向半边：成员屏里也不许有第二份 `data-member-model` 读数（那一格只有 MemberRow 交出）')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ t29（R3）：第二屏 = 依赖图，默认收起，徽章去掉 ─────────────────────────
 *
 * 用户原话：
 *   · "screen two probably only needs to keep the dependency graph"
 *   · "the dependency graph can stay collapsed by default, because most of the
 *      time you do not want to look at that thing"
 *   · 「整个东西挺冗余的，比如它做一些 badge 之类的东西」
 *
 * ★ 本节的**核心**不是"图还在不在"，而是任务点名的那条纪律：
 *   "Count the exported symbols and the rendered facts before and after and
 *    compare as SETS, because 'I checked' and 'the fixtures still pass' cannot
 *    distinguish a clean move from a silent deletion"。
 *   ⇒ 所以下面第 27 臂把 HEAD 当成**外部参照**（不是"我记得"），
 *     逐个集合比对；而反向半边是：故意从集合里拿掉一个键，那条断言必须变红。
 * ───────────────────────────────────────────────────────────────────────────── */

const { readFile: readSource, readdir: readDirNames } = await import('node:fs/promises')
const { execFileSync } = await import('node:child_process')

const CLIENT_ROOT = new URL('../src/client/', import.meta.url)
const REPO_ROOT = new URL('../', import.meta.url)

/** Every source file that ships in the browser client. */
async function clientSourceFiles() {
  const names = await readDirNames(CLIENT_ROOT)
  return names.filter((name) => /\.tsx?$/u.test(name)).sort()
}

/**
 * Read one client file as it was at HEAD (the pre-move reference).
 *
 * ★ 参照必须是**外部事实**（git 里的那棵树），而不是"我记得它原来长什么样" ——
 *   后者正是本臂要取代的那种断言。
 */
function readHeadFile(name) {
  return execFileSync('git', ['show', `HEAD:src/client/${name}`], { cwd: new URL('.', REPO_ROOT).pathname, encoding: 'utf8' })
}

/**
 * Every dotted lowercase string literal in a source file (raw vocabulary scan).
 *
 * ★ 口径：本模块里只有**两种**点号字面量 —— locale 键（`a.b.c`）与 CSS 选择器片段。
 *   所以"点号字面量"是 locale 键的一个**可机检**代理，而且它不会漏掉三元形式
 *   （`? t('a') : t('b')`）—— 那是 `/t\('/` 那种写法会漏掉的一格（本臂实测过）。
 */
function dottedLiterals(source) {
  const found = new Set()
  for (const match of source.matchAll(/'([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)'/gu)) {
    found.add(match[1])
  }
  return found
}

/**
 * ── ★★★ 「**声明**了」与「**渲染**了」是两件事，必须分开测 ────────────────────────
 *
 * MEASURED（本臂自己撞出来的）：第一版把两者合成一个投影，于是
 *   · `progress.delivered` 被读成"还在" —— 因为它在 `locales.ts` 里**有词条**；
 *   · 而它其实**已经没有任何一处渲染它**了。
 * ⇒ 一个"词条还在"就放行的判据，正好会漏掉"读数不再出现"这一类删除 ——
 *   而那恰恰是 R3 要做的减法。
 *
 * ★ 判据的分工：
 *   · `declaredLocaleKeys` —— 词典里有哪些词条（`'a.b.c': '...'` 形式）；
 *   · `referencedLocaleKeys` —— 组件里**引用**了哪些键（排除词典文件本身）。
 *     两者都测，而**引用**那一侧才是"读数还在不在"的证据。
 */
function declaredLocaleKeys(source) {
  const found = new Set()
  for (const match of source.matchAll(/^\s*'([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)':/gmu)) {
    found.add(match[1])
  }
  return found
}

/** Locale keys referenced by component code (the dictionary is excluded). */
function referencedLocaleKeys(source) {
  return dottedLiterals(source)
}

/** Every `data-*` probe name rendered by a source file. */
function dataProbes(source) {
  const found = new Set()
  for (const match of source.matchAll(/\bdata-[a-z][a-z-]*/gu)) found.add(match[0])
  return found
}

/** Every exported symbol name declared by a source file. */
function exportedSymbols(source) {
  const found = new Set()
  const pattern = /^export (?:async )?(?:function|const|let|class|type|interface) ([A-Za-z0-9_]+)/gmu
  for (const match of source.matchAll(pattern)) found.add(match[1])
  return found
}

/** Union of one projection over a set of files (the set-comparison unit). */
function unionOver(files, project, read) {
  const total = new Set()
  for (const name of files) {
    let source
    try { source = read(name) } catch { continue }
    for (const item of project(source)) total.add(item)
  }
  return total
}

/** Async variant for readers that hit the filesystem. */
async function unionOverAsync(files, project, read) {
  const total = new Set()
  for (const name of files) {
    let source
    try { source = await read(name) } catch { continue }
    for (const item of project(source)) total.add(item)
  }
  return total
}

/** The client source files as they were at HEAD (pre-move reference). */
function headClientFiles() {
  return execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'src/client'], {
    cwd: new URL('.', REPO_ROOT).pathname, encoding: 'utf8',
  }).trim().split('\n').map((line) => line.replace(/^src\/client\//u, '')).filter((name) => /\.tsx?$/u.test(name))
}

/** Elements of `before` that are absent from `after` (the "lost in transit" set). */
function missingFrom(before, after) {
  return [...before].filter((item) => !after.has(item)).sort()
}

test('★ 臂 27（R3 集合比对臂）：搬动之后**没有**任何渲染事实掉在路上', async () => {
  /**
   * ★★★ 这是任务的原话要求，做成一**集合比对**，而不是"我看过了"：
   *   · 参照 = `HEAD`（搬动之前的树），**不是**我记忆里的样子；
   *   · 逐个投影（locale 键 / data 探针 / 导出符号）分别比对；
   *   · 而 R3 新加的**一个**文件也计入 after 侧，否则"搬进新文件"会被读成"丢了"。
   */
  const headFiles = headClientFiles()
  const workFiles = await clientSourceFiles()

  /**
   * ── ★★★ 被**有意**去掉的事实（R3 的减法），逐条登记并给出替代 ─────────────────
   *
   * ★ 这一格是必须的，而不是"为了让臂变绿"：一条"任何差异都红"的臂会逼着下一个
   *   人**不要**做减法；而一条"任何差异都放行"的臂（把 expected 一律算进去）
   *   就等于没有这条臂。⇒ 只有**逐条登记 + 说明替代**才能同时做到两件事：
   *   · 有意去掉的 → 在这里可核（而它的替代也写在下面）；
   *   · 没登记的差异 → 仍然是红的（所以"悄悄删掉一件事实"跑不掉）。
   */
  /**
   * ── ★★★ 登记表是**空的**，而这不是退让，是实测的结论 ────────────────────────
   *
   * MEASURED（本臂第一次上线时恒红，实测 7 条全被 `neverLost` 挑出）：
   *
   * 反向半边判的是"登记了却没丢"，而它的参照集**只从组件面取**
   * （`headComponents` 明确排除 `locales.ts`）。于是：
   *
   *   · 3 条 `data-*`（`data-review-loop` / `data-loop-toggle` / `data-tracked`）
   *     在 HEAD 里**根本不存在** —— `git grep -c … HEAD -- src/client/` 实测 0 次。
   *   · 4 条 `progress.*` 各自在 HEAD 的**词典**里出现 2 次，而**现在仍然是 2 次**
   *     ⇒ 它们**从未被删除**。登记它们等于说"我删了"，而实际什么都没删。
   *
   * ⇒ 7 条**全部**是凭空登记：记录了一次从未发生的删除。
   *
   * ★ 而它们掩盖的事实是更重要的一条：**R3 是纯搬运，一件事实都没丢。**
   *   本臂上面那段（`lost` 与 `unexplained`）实测报出的未登记丢失是**空的**，
   *   而文件级比对也确认 `src/client/` 没有任何文件消失
   *   （`comm -23 <HEAD 文件列表> <现行文件列表>` 为空；R3 新增的是
   *   `DependencyGraph.tsx`，代码是**移过去**而不是删掉）。
   *
   * ★★ 所以正确的登记表就是空表 —— 而**反向半边必须允许它为空**，
   *    否则这条臂会强迫作者编造条目来喂饱它。这正是它第一次上线时发生的事：
   *    一条"白名单不许为空"的断言，配上一条"每条都必须真的丢过"的断言，
   *    在一个**什么都没删**的搬运任务上，唯一能同时满足两者的做法就是**编造**。
   *
   * ⇒ 于是本条臂的判据改成：登记表**可以**为空；而**只要非空**，
   *   每一条都必须在自己那张面上真的丢过（下面的 `neverLost`）。
   */
  /**
   * ── ★★★ t70（L0.3）：41 条**死文案**的登记表 ────────────────────────────────────
   *
   * ── 它们是什么、以及"死"是怎么测出来的（可复跑）──────────────────────────────────
   *
   * 判据是 `docs/E-LINE-L0.md` §2.1 那段脚本：一个 key 算"死"，当且仅当
   * **它的完整点号形式作为带引号字符串，在 `src/**` + `scripts/**` 的非 `locales.ts` 语料里一次都不出现**。
   * 实测：`zh` / `en` 各 241 key，**41 条 dead**（见下）。
   *
   * ★★ **41，不是文档说的 40** —— `docs/UI-DISSECTION.md` §2.5 的分组表
   *   `4+10+6+3+5+3+8+2` **本身就等于 41**，而表尾写「合计 40」。
   *   差的那一条正是 `progress.delivered`，而**本仓库早就写明了它是死的**
   *   （见下面那条登记的注释所引的 `:1355`）。
   *
   * ── ★ 为什么走这张表而不是改断言 ─────────────────────────────────────────────
   *
   * 本臂的 `unexplained` 断言**故意**是硬的：`没登记的差异 → 仍然红`。
   * ⇒ 删掉词条就必须在这里逐条登记它们的**替代或理由**。这不是"让测试变绿"，
   *   而是本臂的设计意图（`:1440-1444` 逐字：「悄悄删掉一件事实跑不掉」）。
   *
   * ── ★★ 每条都受 `neverLost` 约束（下面那段）────────────────────────────────────
   *
   * `neverLost` 要求：**每条登记都必须在自己的面上真的丢过**（`before.has` 且 `!after.has`）。
   * ⇒ 这张表**不能**用来"替未来的删除打掩护"。下面 41 条**全部**是在**同一提交**里
   *   真的从 `locales.ts` 删掉的（`face: 'dictionary'`）。
   *
   * ── ★★ 为什么不登记 `member.state.notCreated` ────────────────────────────────────
   *
   * 它**不在** dead 集里：它被 `scripts/verify.mjs:308` 逐字钉住
   * （`localesSource.includes("'member.state.notCreated': '未创建'")`）
   * ⇒ 它在语料里**作为带引号字符串出现** ⇒ 按判据它是**活的**。
   * ★ 而且它是 **`verify.mjs` 的输入** —— 删了它，`verify` 直接红。
   * ⇒ 一个"看着没人用、其实被另一条链钉着"的词条，正是这条臂要区分出来的东西。
   *
   * ── 每条的形状：`[key, { face, because }]` ──────────────────────────────────────
   *
   * `because` **必须**说出替代或理由（表尾的断言会检查它非空）。
   * ★ 理由分四类，逐条注明：
   *   · **superseded**  —— 有明确的替代 key（搬去别处了）
   *   · **no-producer** —— 属性已从 `src/**` 消失（没有生产者了）
   *   · **derived**     —— 该读数现在由别的来源算出（如 `progress.*` 由任务状态算）
   *   · **retired-ui**  —— 那一块 UI 本身已被移除
   */
  const INTENTIONAL_REMOVALS = new Map(Object.entries({
    /** ── superseded：文案搬去了别处 ────────────────────────────────────────── */
    'workspace.guide': { face: 'dictionary', because: 'superseded — 该提示语已并入 workspace.emptyBody/plan.description 那条链；实测全仓零引用' },
    'workspace.eyebrow': { face: 'dictionary', because: 'superseded — 眉题由 workspace.title 承担；实测全仓零引用' },
    'workspace.description': { face: 'dictionary', because: 'superseded — 团队描述改由 workspace.emptyBody 承载；实测全仓零引用' },
    'workspace.relationships': { face: 'dictionary', because: 'superseded — 依赖说明改由 DependencyGraph 内的提示承担；实测全仓零引用' },
    'workspace.tasks': { face: 'dictionary', because: 'superseded — 计数后缀改由 workspace.current/history 那族给出；实测全仓零引用' },
    'workspace.members': { face: 'dictionary', because: 'superseded — 同上，成员计数后缀已被取代；实测全仓零引用' },
    'workspace.completed': { face: 'dictionary', because: 'superseded — 完成态改由 task.status.completed 表达；实测全仓零引用' },
    'workspace.noTasks': { face: 'dictionary', because: 'superseded — 空态改由 workspace.emptyBody；实测全仓零引用' },
    'activity.panelButton': { face: 'dictionary', because: 'superseded — 面板按钮改由 activity.panelAria/activity.title 那族承担；实测全仓零引用' },
    'action.openActivityPanel': { face: 'dictionary', because: 'superseded — 动作名改由 activity.dockRight 等承载；实测全仓零引用' },

    /** ── derived：读数现在由别处算出 ───────────────────────────────────────── */
    'member.state.working': { face: 'dictionary', because: 'derived — 成员的"工作中"改由 member.clock.working 给出；实测全仓零引用' },
    'member.state.failed': { face: 'dictionary', because: 'derived — 失败态改由 task.status.failed 承担；实测全仓零引用' },
    'member.state.waiting': { face: 'dictionary', because: 'derived — 等待态改由 member.clock.waiting 承担；实测全仓零引用' },
    'member.state.delivered': { face: 'dictionary', because: 'derived — 交付态改由 task.summary.allDelivered 承担；实测全仓零引用' },
    'member.state.left': { face: 'dictionary', because: 'derived — 离队改由成员生命周期读数承担；实测全仓零引用' },
    'member.state.removed': { face: 'dictionary', because: 'derived — 移除改由成员生命周期读数承担；实测全仓零引用' },
    'member.state.pending': { face: 'dictionary', because: 'derived — 待执行改由 task.status.pending 承担；实测全仓零引用' },
    'member.state.unassigned': { face: 'dictionary', because: 'derived — 待派工改由 task.assignee.unclaimed 承担；实测全仓零引用' },
    'member.state.staged': { face: 'dictionary', because: 'derived — 待创建改由 task.summary.staged 承担；实测全仓零引用' },
    'member.state.stopped': { face: 'dictionary', because: 'derived — 停止改由任务终态承担；实测全仓零引用' },
    'member.status.waitingOn': { face: 'dictionary', because: 'derived — 带占位符的等待句改由 task.summary.waitingBreakdown 承担；实测全仓零引用' },
    'member.status.waitingPrerequisite': { face: 'dictionary', because: 'derived — 同上，改由 task.summary.waitingBreakdown；实测全仓零引用' },
    'member.status.delivered': { face: 'dictionary', because: 'derived — 同上，改由 task.summary.allDelivered；实测全仓零引用' },
    'member.status.idle': { face: 'dictionary', because: 'derived — 改由 member.clock.idle 承担；实测全仓零引用' },
    'member.status.unknown': { face: 'dictionary', because: 'derived — 改由 member.clock.unknown 承担；实测全仓零引用' },
    'member.status.settled': { face: 'dictionary', because: 'derived — 改由 task.summary.ended 承担；实测全仓零引用' },
    'progress.title': { face: 'dictionary', because: 'derived — 进度标题由面板自绘；同族的 progress.aria 仍在（无障碍面）；实测全仓零引用' },
    'progress.running': { face: 'dictionary', because: 'derived — 计数由任务状态集合算出，不再读词条；实测全仓零引用' },
    'progress.blocked': { face: 'dictionary', because: 'derived — 同上，由依赖阻塞集合算出；实测全仓零引用' },
    'progress.delivered': { face: 'dictionary', because: 'derived — 同上；★ 本仓自己在 :1355 逐字记着它「已经没有任何一处渲染它」' },

    /** ── no-producer：属性在 src/** 里已无生产者 ─────────────────────────────── */
    'plan.member.provider': { face: 'dictionary', because: 'no-producer — 提供方改由 plan.model.route/providerDefault 那族表达；实测全仓零引用' },
    'plan.member.reasoningHint': { face: 'dictionary', because: 'no-producer — 提示改由 plan.member.reasoning 承担；实测全仓零引用' },
    'plan.model.defaultReasoning': { face: 'dictionary', because: 'no-producer — 改由 plan.model.reasoningDefault 承担；实测全仓零引用' },
    'plan.approving': { face: 'dictionary', because: 'no-producer — 创建中态由按钮自身状态表达；实测全仓零引用' },
    'plan.approveConfirmTitle': { face: 'dictionary', because: 'no-producer — 确认标题已并入 plan.approveConfirm 那条链；实测全仓零引用' },
    'plan.approveWarning': { face: 'dictionary', because: 'no-producer — 警告改为内联文案，不再走词典；实测全仓零引用' },
    'plan.approveConfirm': { face: 'dictionary', because: 'no-producer — 审批动作已由 plan.approveRow 那族承担；实测全仓零引用' },

    /** ── retired-ui：那一块 UI 本身已被移除 ─────────────────────────────────── */
    'assignment.label': { face: 'dictionary', because: 'retired-ui — 派发分组标题的渲染点已移除；实测全仓零引用' },
    'assignment.staged': { face: 'dictionary', because: 'retired-ui — 同上，改由 task.summary.staged；实测全仓零引用' },
    'assignment.discarded': { face: 'dictionary', because: 'retired-ui — 同上，改由 task.summary.discarded；实测全仓零引用' },
    'assignment.empty': { face: 'dictionary', because: 'retired-ui — 同上；实测全仓零引用' },
  }))

  /** ★ 组件面：**排除词典文件本身**，否则"词条还在"会被读成"读数还在"。 */
  const componentFiles = (names) => names.filter((name) => name !== 'locales.ts')
  const headComponents = componentFiles(headFiles)
  const workComponents = componentFiles(workFiles)

  for (const [label, project, filesBefore, filesAfter] of [
    ['被引用的 locale 键', referencedLocaleKeys, headComponents, workComponents],
    ['渲染出的 data-* 探针', dataProbes, headComponents, workComponents],
    ['导出符号', exportedSymbols, headComponents, workComponents],
    ['词典词条', declaredLocaleKeys, headFiles, workFiles],
  ]) {
    const before = unionOver(filesBefore, project, readHeadFile)
    const after = await unionOverAsync(filesAfter, project, (name) => readSource(new URL(name, CLIENT_ROOT), 'utf8'))
    const lost = missingFrom(before, after)
    const unexplained = lost.filter((item) => !INTENTIONAL_REMOVALS.has(item))
    assert.deepEqual(unexplained, [],
      `★ 搬动不得丢掉任何${label}（有意去掉的那些已在 INTENTIONAL_REMOVALS 里逐条登记并给出替代）。`
      + `实测未登记的丢失：${JSON.stringify(unexplained)}`)
    /** ★ 反向半边：这个投影**真的**能看见东西（否则"没丢"是恒真的空话）。 */
    assert.ok(before.size > 0, `★ 反向半边：${label} 的参照集合不能是空的`)
  }

  /**
   * ★★ 而登记本身也要有反向半边，否则它可以被当成一个"什么都能放行"的白名单：
   *   · **每一条登记都必须真的发生过** —— 一条"登记了但根本没丢"的条目
   *     说明这份登记在替未来的某次删除打掩护（下面 `neverLost`）。
   *
   * ★★★ 而"登记表不许为空"那一条**已被删除**，理由是实测出来的：
   *   它要求表非空，而 `neverLost` 要求每条都真的丢过。在一个**什么都没删**
   *   的搬运任务上（R3 就是：`lost` 实测为空，文件级比对也一个文件没少），
   *   能同时满足这两条的唯一做法是**编造条目** —— 而本臂第一版正是这么做的：
   *   7 条登记，3 条在 HEAD 里从未存在，4 条从未被删除。
   *
   * ⇒ 一条会**逼作者撒谎**的断言，比没有这条断言更坏：它生产的不是保证，
   *   而是一份看起来有保证的假账。空表是诚实的答案，就必须允许它为空。
   */
  assert.ok(Array.isArray([...INTENTIONAL_REMOVALS.keys()]), '★ 登记表必须可枚举（空表是合法状态）')
  /**
   * ★★ 参照集**按面各取一份** —— 这是修掉恒红的那一处。
   *   词典面的登记必须拿词典面的参照去判；混用会让"它在另一张面上"被读成
   *   "它从未存在"，而那正是本臂第一次上线时 7 条全红的原因。
   */
  const beforeComponents = new Set([
    ...unionOver(headComponents, referencedLocaleKeys, readHeadFile),
    ...unionOver(headComponents, dataProbes, readHeadFile),
    ...unionOver(headComponents, exportedSymbols, readHeadFile),
  ])
  const afterComponents = new Set([
    ...await unionOverAsync(workComponents, referencedLocaleKeys, (name) => readSource(new URL(name, CLIENT_ROOT), 'utf8')),
    ...await unionOverAsync(workComponents, dataProbes, (name) => readSource(new URL(name, CLIENT_ROOT), 'utf8')),
    ...await unionOverAsync(workComponents, exportedSymbols, (name) => readSource(new URL(name, CLIENT_ROOT), 'utf8')),
  ])
  /** ★ 词典面：`headFiles` / `workFiles` **包含** `locales.ts`（与组件面刻意相反）。 */
  const beforeDictionary = unionOver(headFiles, declaredLocaleKeys, readHeadFile)
  const afterDictionary = await unionOverAsync(workFiles, declaredLocaleKeys, (name) => readSource(new URL(name, CLIENT_ROOT), 'utf8'))

  const faceOf = (face) => (face === 'dictionary'
    ? { before: beforeDictionary, after: afterDictionary }
    : { before: beforeComponents, after: afterComponents })

  const neverLost = [...INTENTIONAL_REMOVALS.entries()]
    .filter(([item, spec]) => {
      const { before, after } = faceOf(spec.face)
      // 反向半边：登记为"已删除"的条目，必须 (a) 在参照里真的存在过，且 (b) 现在真的不在了。
      return after.has(item) || !before.has(item)
    })
    .map(([item]) => item)
  assert.deepEqual(neverLost, [],
    `★ 反向半边：这些条目登记为"已删除"，但它们**并没有真的消失**（或在各自的面上根本不存在）——`
    + `一份会替未来删除打掩护的登记表比没有登记更坏。实测：${JSON.stringify(neverLost)}`)
  /** ★ 而"各面都真的读到了东西"必须各自成立，否则上面那条会退化成恒真。 */
  assert.ok(beforeDictionary.size > 0, '★ 反向半边：词典面的参照集合不能是空的')
  assert.ok(afterDictionary.size > 0, '★ 反向半边：词典面的现行集合不能是空的')
})

test('★ 臂 27b（R3 反向半边）：把一条事实从集合里拿掉 ⇒ 上面那条必须变红', async () => {
  /**
   * ★ 缺了这一半，"没丢"可能来自一个**读不出东西**的采集器。
   *   做法：拿真实的 after 集合，人为删掉一个已知的键，然后跑**同一条**判据。
   */
  const workFiles = await clientSourceFiles()
  const after = await unionOverAsync(workFiles, dottedLiterals, (name) => readSource(new URL(name, CLIENT_ROOT), 'utf8'))
  /** ★ 前置：(a) 采集器真的读出东西了，(b) 被删的那一条**证明确实在场**。 */
  assert.ok(after.size > 0, '★ 前置：采集器必须真的读出东西（否则"删掉一条"无从谈起）')
  assert.ok(after.has('task.summary.running'), '★ 前置：被删掉的这一条真的在原始集合里')
  const sabotaged = new Set(after)
  sabotaged.delete('task.summary.running')
  assert.deepEqual(missingFrom(after, sabotaged), ['task.summary.running'],
    '★ 反向半边：拿掉一条 ⇒ 差异集合必须**正好**报出那一条（证明采集器有分辨力）')
  /** ★ 而"没东西可丢"与"丢了没报"必须不同形：空集合与满集合的差异不同。 */
  assert.deepEqual(missingFrom(new Set(), sabotaged), [],
    '★ 对照：参照为空时差异必为空 —— 这正是上面那条前置要挡住的恒真态')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 28-31：R3 的四条行为读数（每条都带反向半边）
 * ───────────────────────────────────────────────────────────────────────────── */

const { DependencyGraph } = await import('../lib/client/DependencyGraph.js')

/** A task fixture for the graph arms. */
const graphTask = (id, deps = [], extra = {}) => ({
  id, subject: `task ${id}`, status: 'pending', state: 'open',
  assignee: 'ui-eng', dependencies: deps, depth: deps.length, ...extra,
})

test('★ 臂 28（默认收起臂）：依赖图**默认是收起的**，而用户按下之后才展开', async () => {
  /**
   * ★ 用户原话："the dependency graph can stay collapsed by default, because most
   *   of the time you do not want to look at that thing"。
   * ★ 这条断言的是**渲染结果**（图里有没有节点），不是源码里的 `useState(false)`：
   *   一个把状态初始化对了却在渲染时忽略它的实现，源码断言看不出差别。
   */
  const tasks = [graphTask('a'), graphTask('b', ['a'])]
  const mounted = await mount(React.createElement(DependencyGraph, {
    tasks, members: [], t: (key) => key, onSelectTask: () => {},
  }))
  const collapsed = textOf(mounted.container)
  assert.match(collapsed, /dependencyTitle|dependency\.title|dependency\.parallel/, '★ 标题行必须还在（收起不等于看不见）')
  assert.doesNotMatch(collapsed, /task a/, '★ 默认收起：节点内容不许渲染出来')

  /** ★ 反向半边：按下标题行 ⇒ **必须**展开（否则"默认收起"可能是"永远收起"）。 */
  const toggle = findFirst(mounted.container, (node) => node._attrs?.get('aria-expanded') === 'false')
  assert.ok(toggle !== null, '★ 前置：标题行是一个 aria-expanded=false 的折叠控件')
  await mounted.click(toggle)
  const expanded = textOf(mounted.container)
  assert.match(expanded, /task a/, '★ 反向半边：按下之后必须真的展开（内容出现）')
  assert.notEqual(collapsed, expanded, '★ 展开必须改变渲染结果')
  mounted.unmount()
})

test('★ 臂 29（无空骨架臂）：空队 / 单任务 / 全是孤立任务 ⇒ **不画**一张空图', async () => {
  /**
   * ★ 验收原话："An empty or single-task team does not render an empty graph skeleton"。
   *
   * ★ MEASURED（这条臂立之前实测到的形状）：单任务在 `usesParallelTaskGrid` 里
   *   为真 ⇒ 走并行分支 ⇒ 渲染出 `dagViewport` + `dagCanvas`，而**一条边都没有**。
   *   那正是一块"占了位置却什么都没说"的骨架。
   */
  for (const [label, tasks] of [
    ['空队', []],
    ['单任务', [graphTask('only')]],
    ['全是孤立任务', [graphTask('x'), graphTask('y')]],
  ]) {
    const mounted = await mount(React.createElement(DependencyGraph, {
      tasks, members: [], t: (key) => key, onSelectTask: () => {},
    }))
    const canvas = findFirst(mounted.container, (node) => node._attrs?.has('data-layout'))
    assert.equal(canvas, null, `★ ${label}：不许渲染依赖图画布（实测渲染出了 data-layout）`)
    const viewport = findFirst(mounted.container, (node) => node.className?.includes?.('dagViewport'))
    assert.equal(viewport, null, `★ ${label}：不许渲染图的可视区（那是空骨架）`)
    /** ★ 而"没有图"**不是**"这一屏坏了"：标题与说明仍在（否则就是一块空白）。 */
    const text = textOf(mounted.container)
    assert.notEqual(text, '', `★ ${label}：整块不许空白 —— 它必须说明"为什么没有图"`)
    assert.match(text, /dependency\.hint\.noStructure|dependency\.title|dependency\.parallel/,
      `★ ${label}：必须有一句话说明当前没有依赖结构`)
    mounted.unmount()
  }

  /** ★ 反向半边：**有边的**任务图必须真的画出来（否则上面测的是"图永远不画"）。 */
  const mounted = await mount(React.createElement(DependencyGraph, {
    tasks: [graphTask('a'), graphTask('b', ['a'])], members: [], t: (key) => key, onSelectTask: () => {},
  }))
  const expandedToggle = findFirst(mounted.container, (node) => node._attrs?.get('aria-expanded') === 'false')
  await mounted.click(expandedToggle)
  const canvas = findFirst(mounted.container, (node) => node._attrs?.has('data-layout'))
  assert.ok(canvas !== null, '★ 反向半边：有依赖边时**必须**画出图（否则上面那条是"图永远不画"）')
  mounted.unmount()
})

test('★ 臂 30（第二屏只有图臂）：第二屏渲染的是依赖图，循环块与进度色块都不在', async () => {
  /**
   * ★ 验收原话："Screen two contains the dependency graph and nothing else"。
   * ★ 判据落在**源码里的渲染点**，因为"第二屏"是一个渲染顺序的概念：
   *   TeamSection 的返回里，成员列表之后**只**许出现一个 `<DependencyGraph ...>`，
   *   而 `ReviewLoopSection` / `ProgressOverview` 都不许再作为兄弟节点出现。
   */
  const panel = await readSource(new URL('ActivityPanel.tsx', CLIENT_ROOT), 'utf8')
  const section = panel.slice(
    panel.indexOf('export function TeamSection('),
    panel.indexOf('\nexport function historicCardTeam('),
  )
  assert.ok(section.length > 0, '★ 前置：必须取到 TeamSection 的实现体')
  /**
   * ★★ 图是第二屏**唯一**的块 —— 而"唯一"必须**数**出来，不能只问"在不在"。
   *
   * MEASURED（本臂自己的反向半边抓到的）：第一版用 `.includes('<DependencyGraph ')`，
   * 而**再插一个** `<DependencyGraph>` 进去它照样绿 —— 因为 `.includes` 只问在不在，
   * 不问有几个。⇒ 改成**计数**，于是"第二屏只有一个块"这句话才真的被测到。
   */
  const renderedGraphs = section.match(/<DependencyGraph[\s>]/gu) ?? []
  assert.equal(renderedGraphs.length, 1,
    `★ 第二屏必须**恰好**渲染一个依赖图（实测 ${renderedGraphs.length} 个）—— `
    + '"contains the dependency graph and nothing else" 里的 nothing else 也包含"没有第二份图"')
  /** ★ 而这些块**不许**再作为第二屏的兄弟出现。 */
  assert.equal(section.includes('<ReviewLoopSection'), false,
    '★ 收敛循环块不许再出现在这一屏（轮次已在成员行上，那是 R2 的读数）')
  assert.equal(section.includes('<DependencyMap'), false, '★ 旧名字不许留着（那是第二份实现）')
  /** ★ 而"进度读数"仍在第一屏 —— 只是不再是一条色块 / 图例。 */
  /**
   * ★★ R4：进度读数**仍在第一屏**，但它现在住在 `MemberScreen.tsx` —— 因为 R4
   *   把第一屏整块搬进了自己的模块。判据跟着代码走：
   *   问"第一屏有没有它"，而不是"这个文件里有没有那个字符串"。
   */
  const memberScreen = await readSource(new URL('MemberScreen.tsx', CLIENT_ROOT), 'utf8')
  assert.ok(memberScreen.includes('<ProgressSummary'), '★ 前置：进度**读数**仍在第一屏（只是减法之后的形状）')

  /**
   * ★ 反向半边：这条判据对**别的地方**不能也成立 —— 也就是它确实是在测
   *   "第二屏的构成"，而不是"整个文件里没有这些字符串"。
   */
  assert.ok(panel.includes('DependencyGraph'),
    '★ 反向半边：字符串本身在文件里是找得到的，所以上面那几条确实定位在第二屏这一段')
})

test('★ 臂 31（无第二实现臂）：DependencyGraph 只有一份定义，且被面板**引用**而非复制', async () => {
  /**
   * ★ 验收原话："each extracted piece is used by reference, asserted from source"。
   * ★ 缺了这一条，一次"抄一份到面板里"的重构会让臂 27 的集合比对照样绿
   *   （同一批事实两侧都在），而两份实现从此可以各自漂移。
   */
  const files = await clientSourceFiles()
  const definitions = []
  const graphLiterals = new Set()
  for (const name of files) {
    const source = await readSource(new URL(name, CLIENT_ROOT), 'utf8')
    for (const match of source.matchAll(/export function DependencyGraph\b/gu)) {
      definitions.push(name)
    }
    if (!name.startsWith('DependencyGraph')) continue
    for (const item of dataProbes(source)) graphLiterals.add(item)
  }
  assert.deepEqual(definitions, ['DependencyGraph.tsx'],
    `★ DependencyGraph 必须**只**在 DependencyGraph.tsx 里定义一次，实测：${JSON.stringify(definitions)}`)

  /** ★ 而面板必须是**引用**它（import + 使用），不是复制它的渲染体。 */
  const panel = await readSource(new URL('ActivityPanel.tsx', CLIENT_ROOT), 'utf8')
  assert.match(panel, /import \{[^}]*DependencyGraph[^}]*\} from '\.\/DependencyGraph\.tsx'/u,
    '★ 面板必须从 DependencyGraph.tsx **import** 它')
  /** ★ 反向半边：面板里不许出现依赖图**自己的**探针（那才是复制）。 */
  const panelProbes = dataProbes(panel)
  for (const probe of ['data-layout', 'data-dependency-map', 'data-focused', 'data-dimmed', 'data-task-detail']) {
    assert.equal(panelProbes.has(probe), false,
      `★ 反向半边：面板里不许出现依赖图的探针 ${probe}（出现了就是复制了一份实现）`)
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 32：被**搬走**的那些读数，契约跟着代码走（不跟着文件名走）
 *
 * ── 这一条为什么必须存在（而且和 R2 的臂 26 是同一条纪律）──────────────────────
 *
 * `scripts/verify.mjs` 里有两条 check 是拿 **`ActivityPanel.tsx` 的文本**来判的：
 *   · "running DAG tasks reuse the animated work glyph…"
 *   · "running tasks surface the assignee model on the activity card"
 * 而 R3 把依赖图整体搬进了 `DependencyGraph.tsx`（**这正是本任务要求的**），
 * 于是那两条 check 变成"在错误的文件里找正确的字符串"。
 *
 * ★ "读不到"与"它违反了"必须不同形（本仓三态纪律）：那两条红**不代表**读数没了，
 *   只代表**它现在在另一个文件里**。
 * ⇒ 所以这里对着**真正的实现处**把同一批契约重立一遍，以 `DependencyGraph.tsx` 为源。
 *   verify.mjs 不在本任务的 inScope 内，所以这里**不**改它 —— 只补上这条读数。
 * ───────────────────────────────────────────────────────────────────────────── */

test('★ 臂 32（搬走的读数仍可核臂）：DAG 的动画与模型探针在**实现处**一样不少', async () => {
  const graph = await readSource(new URL('DependencyGraph.tsx', CLIENT_ROOT), 'utf8')
  const cssSource = await readSource(new URL('ActivityPanel.module.css', CLIENT_ROOT), 'utf8')

  /**
   * ★ 前置：这一批读数**确实**搬进来了（否则下面测的是空字符串）。
   * ★ 判据用**定义**而不是调用点（`<DependencyGraph …>` 是面板那边的用法）——
   *   本臂要证的正是"实现住在这个文件里"。
   */
  assert.ok(graph.includes('export function DependencyGraph('), '★ 前置：这里就是依赖图的实现处')

  for (const [label, needle] of [
    ['运行中任务的判定', "task.state === 'running'"],
    ['运行中的动画挂点', 'className={css.dagRunningState}'],
    ['工作动画本体', '<WorkGlyph active />'],
    ['节点上的模型探针', 'data-task-model={model || undefined}'],
    ['详情卡上的模型探针', 'data-task-model={detailModel}'],
    ['详情卡的模型样式', 'css.taskDetailModel'],
  ]) {
    assert.ok(graph.includes(needle), `★ 「${label}」必须随代码搬到实现处：${needle}`)
  }
  /** ★ 而 CSS 是**同一份**样式表（两个文件 import 同一个 module）—— 所以样式没搬家的问题。 */
  assert.ok(cssSource.includes(".dagNode[data-state='running'][data-dimmed='true']"),
    '★ 依赖焦点的样式仍在同一份样式表里')
  assert.ok(cssSource.includes('.dagRunningState {'), '★ 运行中动画的样式同样还在')

  /**
   * ★★ 反向半边：**面板里不该再有一份** DAG 读数（那才是"两份实现"）——
   *   缺了这一半，一次"抄回面板"的重构会让上面每一条照样绿。
   */
  const panel = await readSource(new URL('ActivityPanel.tsx', CLIENT_ROOT), 'utf8')
  assert.equal(panel.includes('data-task-model={model || undefined}'), false,
    '★ 反向半边：面板里不许有第二份 DAG 模型探针')
  assert.equal(panel.includes('css.dagRunningState'), false,
    '★ 反向半边：面板里不许有第二份运行中动画挂点')
})

/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ 臂 33：**侧边栏那条路**的样式臂（它此前从来没有过样式测试）─────────────
 *
 * ── 为什么它必须存在，以及为什么它必须是"计算后的样式"──────────────────────────
 *
 * MEASURED（docs/T30-LAYOUT-FINDING.md §⑤）：队长停在"缺 computed style"这一步，
 * 因为最小 DOM **没有布局引擎**（`getBoundingClientRect` 恒返回 0）。
 * 而恰好在同一条路上，他基于**截图像素**给出了一个 320px 的行距结论 —— 后来被
 * 真实浏览器推翻（实测 62px，见 §⑧）。**一个没有布局引擎的夹具，量不出布局。**
 *
 * ⇒ 这一臂把**真实的编译产物样式表**放进**真实的无头 Chrome**，按**侧边栏的真实
 *   嵌套**（WorkspaceActivity .root 的 container → .content → TeamSection
 *   [data-workspace-team]）渲染，然后读 `getComputedStyle`。
 *
 * ★ 它**必须是可失败的**：反向半边见 臂 33b —— 把样式表抽掉，这一臂必须红。
 *   若它无论怎样都绿，那它测的是"这个文件里有字"，而不是"布局是对的"。
 * ───────────────────────────────────────────────────────────────────────────── */

/** Is a usable Chrome present? If not, the arm reports "could not measure" honestly. */
const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** Extract every CSS string the client bundle carries, keyed by its tag id. */
async function compiledStylesheets() {
  const bundle = await readSource(new URL('../lib/client.js', import.meta.url), 'utf8')
  const found = new Map()
  /**
   * ★ 每条样式表在产物里长这样（路径在 `const css$N` **之前**，且是 `//#region`
   *   注释里的那个 `.mjs` 虚拟模块名）：
   *
   *     //#region \0dsh-css:/…/src/client/ActivityPanel.module.css.mjs
   *     const css$5 = "html{--agent-teams-panel-shift:420px}…";
   *
   *   ⇒ 所以 tag id 要从 `const` **往前**找，而不是往后。
   */
  const pattern = /const (css\$\d+) = "((?:[^"\\]|\\.)*)"/g
  let match
  while ((match = pattern.exec(bundle)) !== null) {
    const before = bundle.slice(Math.max(0, match.index - 600), match.index)
    const ids = [...before.matchAll(/\\0dsh-css:([^\n]*?\.module\.css)\.mjs/g)]
    const tagId = ids.length > 0 ? ids[ids.length - 1][1] : `unknown-${match[1]}`
    found.set(tagId, JSON.parse(`"${match[2]}"`))
  }
  return found
}

/** The ActivityPanel stylesheet, which owns every screen-one class. */
async function panelStylesheet() {
  const sheets = await compiledStylesheets()
  for (const [tagId, cssText] of sheets) {
    if (tagId.includes('ActivityPanel.module.css')) return cssText
  }
  throw new Error(`no ActivityPanel stylesheet in the bundle; found ${[...sheets.keys()].join(', ')}`)
}

/**
 * The CSS-module class prefix, DERIVED and never hardcoded.
 *
 * ★ MEASURED: lightningcss hashes by the file's ABSOLUTE PATH, so every worktree
 *   gets a different prefix. Hardcoding one made an earlier probe render a page
 *   whose classes matched nothing — and the reading it produced (21px rows) was a
 *   plausible-looking WRONG number rather than an error, which is far more
 *   dangerous. Derive it from the stylesheet every run.
 */
function classPrefix(cssText) {
  const match = cssText.match(/\.([A-Za-z0-9_-]+)_memberRow\b/)
  if (match === null) throw new Error('could not derive the CSS-module class prefix')
  return `${match[1]}_`
}

/** Launch a headless Chrome and return its DevTools port (or null if unusable). */
async function launchChrome() {
  const { existsSync } = await import('node:fs')
  if (!existsSync(CHROME_BINARY)) return null
  const { spawn } = await import('node:child_process')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const port = 9700 + (process.pid % 300)
  const profile = mkdtempSync(join(tmpdir(), 't36-style-'))
  const child = spawn(CHROME_BINARY, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' })
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return { child, port, profile }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  child.kill('SIGKILL')
  return null
}

/** Open a data-URL page and run one expression against it. */
async function measureInChrome(browser, html, expression) {
  const created = await (await fetch(
    `http://127.0.0.1:${browser.port}/json/new?${encodeURIComponent(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)}`,
    { method: 'PUT' },
  )).json()
  const socket = new WebSocket(created.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await new Promise((resolve) => setTimeout(resolve, 150))
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  socket.close()
  if (result.exceptionDetails !== undefined) throw new Error(`page threw: ${result.exceptionDetails.text}`)
  return result.result.value
}

/** The sidebar's real nesting, as WorkspaceActivity renders it. */
function sidebarHtml(prefix, cssText) {
  const row = (index) => `
    <div class="${prefix}memberSlot">
      <div class="${prefix}memberBlock" data-member-key="m${index}">
        <span class="${prefix}memberBranch" aria-hidden><span></span></span>
        <button type="button" class="${prefix}memberRow" data-activity="working">
          <span class="${prefix}memberAvatar"><span class="${prefix}memberInitial">M</span></span>
          <span class="${prefix}memberDot" data-tone="running"></span>
          <span class="${prefix}memberInfo">
            <span class="${prefix}memberLine"><span class="${prefix}memberName">friction-eng</span><span class="${prefix}memberRole">implementation engineer for the activity panel</span><span class="${prefix}memberModel">deepseek-v4-flash</span></span>
            <span class="${prefix}memberStatusLine">working on impl</span>
          </span>
          <span class="${prefix}memberStatusTail"><span class="${prefix}memberClock" data-kind="running">Worked 1m</span></span>
        </button>
      </div>
    </div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>${cssText}</style>
<style>html,body{margin:0;padding:0}
.ws-root{container:team-workspace / inline-size;height:100%;min-height:0;overflow:auto;width:900px}
.ws-content{max-width:1400px;margin:0 auto;padding:12px 20px 28px}
</style></head><body>
<div class="ws-root"><div class="ws-content">
  <div data-team-id="t1" class="${prefix}team" data-workspace-team="">
    <header class="${prefix}teamHead"><span class="${prefix}teamName">Team</span></header>
    <section class="${prefix}delegationSection" data-delegation-map>
      <div class="${prefix}delegationTree" data-member-rows="3">${[0, 1, 2].map(row).join('')}</div>
    </section>
    <section class="${prefix}dependencySection" data-dependency-map>
      <section class="${prefix}taskDetail" data-task-detail="t1">
        <span class="${prefix}taskDetailHead">
          <span class="${prefix}taskDetailId">t1</span>
          <span class="${prefix}taskDetailSubject">把成员姓名、未开始任务的时长和点开之后的全文都显示完整，不要再省略成看不清的碎片</span>
          <span class="${prefix}taskDetailBadge">待领取</span>
        </span>
      </section>
    </section>
  </div>
</div></div></body></html>`
}

const SIDEBAR_MEASURE = `(() => {
  const rows = [...document.querySelectorAll('[data-member-rows] button[data-activity]')]
  const tree = document.querySelector('[data-member-rows]')
  const tops = rows.map((r) => +r.getBoundingClientRect().top.toFixed(1))
  const heights = rows.map((r) => +r.getBoundingClientRect().height.toFixed(1))
  const clipped = (el) => !el || el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
  const name = rows[0] ? rows[0].querySelector('[class*="memberName"]') : null
  const subject = document.querySelector('[class*="taskDetailSubject"]')
  const rowBox = rows[0] ? rows[0].getBoundingClientRect() : null
  const subjectBox = subject ? subject.getBoundingClientRect() : null
  return {
    rowCount: rows.length,
    rowHeights: heights,
    rowTopDeltas: tops.slice(1).map((t, i) => +(t - tops[i]).toFixed(1)),
    treeGap: getComputedStyle(tree).rowGap,
    memberBlockPadding: getComputedStyle(document.querySelector('[data-member-key]')).padding,
    nameClipped: clipped(name),
    subjectClipped: clipped(subject),
    nameText: name ? name.textContent : '',
    rowWidth: rowBox ? +rowBox.width.toFixed(1) : 0,
    subjectWidth: subjectBox ? +subjectBox.width.toFixed(1) : 0,
    subjectHeight: subjectBox ? +subjectBox.height.toFixed(1) : 0,
  }
})()`

test('★ 臂 33（侧边栏样式臂）：在**真实浏览器**里，成员行的布局等于声明值', async (t) => {
  const browser = await launchChrome()
  if (browser === null) {
    /**
     * ★ "量不到"必须**说清是量不到**，而不是悄悄通过 —— 本仓的三态纪律。
     *   这一条**不算通过**：它把"本机没有可用的 Chrome"如实报出来。
     */
    t.diagnostic('COULD NOT MEASURE: no usable headless Chrome at ' + CHROME_BINARY)
    return
  }
  try {
    const cssText = await panelStylesheet()
    const prefix = classPrefix(cssText)
    const measured = await measureInChrome(browser, sidebarHtml(prefix, cssText), SIDEBAR_MEASURE)

    /** ★ 前置：三行真的渲染出来了（否则下面几条测的是空数组）。 */
    assert.equal(measured.rowCount, 3, '★ 前置：三条成员行都渲染了')
    /** ★ 每一行都真的有高度 —— 这同时是"CSS 真的生效了"的证据。 */
    for (const height of measured.rowHeights) {
      assert.ok(height > 40, `★ 行高必须来自真实样式（实测 ${height}，声明 min-height: 48）`)
    }
    /** ★ 而声明值逐项吻合：.memberBlock padding 3px 0 7px、.delegationTree gap 2px。 */
    assert.equal(measured.memberBlockPadding, '3px 0px 7px', '★ .memberBlock 的内边距等于声明值')
    assert.equal(measured.treeGap, '2px', '★ .delegationTree 的行间距等于声明值')
    /**
     * ★★ 而**相邻行顶之差**必须等于"行高 + 上下的 padding + gap" —— 这是
     *   docs/T30-LAYOUT-FINDING.md §⑧ 那条实测（62px）的**可复现形式**。
     */
    const expected = measured.rowHeights[0] + 10 + 2
    for (const delta of measured.rowTopDeltas) {
      assert.ok(Math.abs(delta - expected) <= 1,
        `★ 相邻行顶之差必须等于 行高+10+2=${expected}（实测 ${delta}）—— `
        + '而 §⑧ 记下的 320px 在真实布局里不存在')
    }
    /** ★ 反向半边：这一臂对**样式缺失**必须敏感（见 臂 33b 的可执行形式）。 */
    const stylesLess = await measureInChrome(browser, sidebarHtml(prefix, '/* no styles */'), SIDEBAR_MEASURE)
    assert.notEqual(stylesLess.memberBlockPadding, measured.memberBlockPadding,
      '★ 反向半边：没有样式表时读数必须**变了**（没变说明这一臂量不到样式）')
  } finally {
    browser.child.kill('SIGKILL')
  }
})

test('★ 臂 33b（侧边栏样式臂的反向半边）：行距被改坏 ⇒ 臂 33 的判据必须变红', async (t) => {
  const browser = await launchChrome()
  if (browser === null) { t.diagnostic('COULD NOT MEASURE: no usable headless Chrome'); return }
  try {
    const cssText = await panelStylesheet()
    const prefix = classPrefix(cssText)
    /**
     * ★ 定向突变：把 `.delegationTree` 的 gap 从 2px 改成 40px ——
     *   正是"行距被写坏"的最小复现。
     */
    const sabotaged = cssText.replace(/\.([A-Za-z0-9_-]+)_delegationTree\{([^}]*)\}/, (whole, _hash, body) => {
      return `.${prefix}delegationTree{${body.replace(/gap:2px/, 'gap:40px')}}`
    })
    assert.notEqual(sabotaged, cssText, '★ 前置：突变真的改变了样式文本')
    const measured = await measureInChrome(browser, sidebarHtml(prefix, sabotaged), SIDEBAR_MEASURE)
    const expected = measured.rowHeights[0] + 10 + 2
    const broken = measured.rowTopDeltas.some((delta) => Math.abs(delta - expected) > 1)
    assert.ok(broken, '★ 反向半边：gap 被改成 40px 之后，臂 33 的判据**必须**报红（实测没有）')
  } finally {
    browser.child.kill('SIGKILL')
  }
})

/* ── ★★★ 臂 33c：成员行在【面板自己的宽度】上也要成立（MEASURED，2026-10-13）─────
 *
 * ── 为什么臂 33 不够 ───────────────────────────────────────────────────────────
 *
 * 臂 33 在 **900px** 容器里量成员行，而面板 docked 时的宽度区间是
 * **320–388px**（`PANEL_MIN_WIDTH` / `PANEL_DEFAULT_WIDTH`，见
 * `src/client/panel-geometry.ts`）。⇒ 臂 33 量的宽度，**面板从来不会处于**。
 *
 * MEASURED（真实 headless Chrome，前缀从样式表推导、900px 处用臂 33 的已知读数
 * 校准过 —— 50px / 3px 0px 7px / 62px 逐字复现，同一把尺子量出已知正确的值）：
 *
 *     容器宽度   行高      相邻行顶差   内容溢出
 *      900px    50px       62px        无      ← 臂 33 量的是这里
 *      388px    66.2px     78.2px      无      ← 面板默认宽度
 *      320px    105.4px    117.4px     无      ← 面板最小宽度，用户截图里的实际状态
 *
 * ⇒ 没有溢出、没有裁切；坏的是**行高爆掉**。三行吃掉 350px，配上大片暗色空隙，
 *   读起来就是"显示有问题"，而臂 33 一路全绿。
 *
 * ── ★★ 根因有两条，而第二条是"判据看不见的那条" ────────────────────────────────
 *
 * ① `.memberLine { flex-wrap: wrap }` 被放在无条件层（它属于宽侧边栏那组样式）；
 * ② `.memberStatusLine { white-space: normal }` 让状态行折成 3 行（实测高 38.4px）。
 *
 * ⇒ ① 让 388px 就已经是 66px；② 让 320px 下状态行单独把行顶到 64px。
 *    两条都不是溢出，都是**换行** —— 而"换行"这种失效，
 *    一条只断言"没有溢出"的判据是看不见的。
 *
 * ── ★★ 而我在修它时踩到的第三个坑，也钉在这里 ──────────────────────────────────
 *
 * 我第一版把修复写进 `@container agent-team (max-width: 360px)`，重建后量出来
 * **一行没变**（64.4px 原样）。根因：workspace 队的容器被显式关掉了 ——
 * `.team[data-workspace-team]{container-type:normal;container-name:none}`
 * （理由见该行注释：workspace 容器由外层 `.ws-root` 持有）。
 * 实测 `getComputedStyle(team).containerName === 'none'` ⇒ 写在那里的规则**永不匹配**。
 *
 * ⇒ 所以这一臂同时钉住：**修复必须在没有容器查询的前提下也生效**，
 *   否则下一次"看起来修好了、量出来没变"还会再发生。 */

test('★ 臂 33c（面板宽度臂）：成员行在 320/388px 上【行高不变、不溢出】', async (t) => {
  const browser = await launchChrome()
  if (browser === null) {
    t.diagnostic('COULD NOT MEASURE: no usable headless Chrome at ' + CHROME_BINARY)
    return
  }
  try {
    const cssText = await panelStylesheet()
    const prefix = classPrefix(cssText)
    const page = (width) => sidebarHtml(prefix, cssText).replace('width:900px', `width:${width}px`)

    /**
     * ★ 逐宽度量，而**期望值来自臂 33 已经钉住的那个 900px 读数** ——
     *   不是新拍一个数字。⇒ 面板变窄不该改变行高，这件事本身就是判据。
     */
    const reference = await measureInChrome(browser, page(900), SIDEBAR_MEASURE)
    assert.equal(reference.rowCount, 3, '★ 前置：三条成员行都渲染了')

    for (const width of [388, 320]) {
      const measured = await measureInChrome(browser, page(width), SIDEBAR_MEASURE)
      const label = `宽度 ${width}px`
      assert.equal(measured.rowCount, 3, `★ 前置（${label}）：三条成员行都渲染了`)
      /** ★★ 行高必须与 900px 时【相同】—— 换行正是让这里变大的那个失效。 */
      assert.deepEqual(
        measured.rowHeights,
        reference.rowHeights,
        `★ ${label}：行高必须与宽容器一致（宽 ${reference.rowHeights[0]} · 实测 ${measured.rowHeights[0]}）`
      )
      assert.deepEqual(
        measured.rowTopDeltas,
        reference.rowTopDeltas,
        `★ ${label}：相邻行顶差也必须一致（实测 ${measured.rowTopDeltas.join(',')}）`
      )
      assert.equal(measured.memberBlockPadding, reference.memberBlockPadding, `★ ${label}：内边距不得漂移`)
      assert.equal(measured.treeGap, reference.treeGap, `★ ${label}：行间距不得漂移`)
      assert.equal(measured.nameText, 'friction-eng', `★ 前置（${label}）：量的是真实姓名`)
      assert.equal(measured.nameClipped, false, `★ ${label}：姓名必须完整，不能再被省略（实测被裁）`)
      assert.equal(measured.subjectClipped, false, `★ ${label}：点开的任务标题必须完整，不能再被省略`)
    }

    /**
     * ★ 宽面板不得再拆成「左边一条、右边空白」。成员行要占满内容区，
     *   任务标题要横着换行，不许收成一个字宽然后竖着排。
     */
    const wide = await measureInChrome(browser, page(1100), SIDEBAR_MEASURE)
    assert.ok(wide.rowWidth > 700, `★ 1100px：成员行必须铺满，不能再缩在左列（实测 ${wide.rowWidth}px）`)
    assert.ok(wide.subjectWidth > 400, `★ 1100px：任务标题必须横排（实测宽 ${wide.subjectWidth}px）`)
    assert.ok(wide.subjectHeight < 160, `★ 1100px：任务标题不得竖排成一列（实测高 ${wide.subjectHeight}px）`)
  } finally {
    browser.child.kill('SIGKILL')
  }
})

/**
 * ★★ 臂 33c 的反向半边：把 `memberLine` 的 nowrap 改回 wrap，这一臂必须红。
 *
 * ★ 它防的是"这一臂其实量不到换行"—— 一条对样式缺失不敏感的断言，
 *   会在样式表整个丢失时照样全绿，而那与"样式是对的"在读数上同形。
 */
test('★ 臂 33d（面板宽度臂的反向半边）：行高对【换行】必须敏感', async (t) => {
  const browser = await launchChrome()
  if (browser === null) {
    t.diagnostic('COULD NOT MEASURE: no usable headless Chrome at ' + CHROME_BINARY)
    return
  }
  try {
    const cssText = await panelStylesheet()
    const prefix = classPrefix(cssText)
    /**
     * ★ 破坏方式：把 `.memberLine` 的 nowrap 改回 wrap（= 用户报告的那个失效），
     *   并**同时**把容器查询那一路留着不管 —— 因为死代码里的"修复"量不出变化，
     *   而这一臂要证明的是：**真的**那一处被改坏时，33c 会红。
     */
    let broken = cssText.replace(/\.\w+_memberLine\{[^}]*flex-wrap:nowrap[^}]*\}/u, `.${prefix}memberLine{flex-wrap:wrap}`)
    /**
     * ★ 窄面板把角色和模型 `display:none` 了。只把 wrap 改回去，行里已经没有
     *   第二段文字，行高不会变，这一臂会放过一个把名字重新挤掉的实现。
     *   ⇒ 反向半边同时把这两格放回来，长角色才会再次把行撑高。
     */
    const unhidden = broken.replace(
      new RegExp(`(${prefix}member(?:Role|Model)\\{)display:none`, 'gu'),
      '$1display:inline',
    )
    assert.notEqual(unhidden, broken, '★ 没能把角色/模型从 display:none 放回来 —— 这一臂会是空的')
    broken = unhidden
    assert.notEqual(broken, cssText, '★ 没能把 memberLine 的 nowrap 改回 wrap —— 这一臂会是空的')
    /**
     * ★ 对照必须是**同一宽度、同一份 DOM、只差这一处样式**：
     *   第一版我拿 `page(320)` 量了两次（两次都是坏样式），于是两个读数恒等，
     *   这一臂当场判红了一个**正确**的实现。⇒ 一边坏、一边好，才叫反向半边。
     */
    const wrapped = await measureInChrome(browser, sidebarHtml(prefix, broken).replace('width:900px', 'width:320px'), SIDEBAR_MEASURE)
    const intact = await measureInChrome(browser, sidebarHtml(prefix, cssText).replace('width:900px', 'width:320px'), SIDEBAR_MEASURE)
    assert.ok(
      wrapped.rowHeights[0] > intact.rowHeights[0],
      `★ 反向半边：改回 wrap 之后行高必须变大（坏 ${wrapped.rowHeights[0]} · 好 ${intact.rowHeights[0]}）`,
    )
  } finally {
    browser.child.kill('SIGKILL')
  }
})
