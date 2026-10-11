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
