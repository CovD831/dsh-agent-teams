/**
 * ── t6（C4）：机械化停滞哨兵的五条验收臂 ──────────────────────────────────────────
 *
 * 契约原话：*"a mechanical stall sentinel … It must NOT rely on a member honestly
 * reporting that it is stuck."*
 *
 * ── 本文件为什么长这样（一次真实的三连败之后写的）────────────────────────────────
 *
 * t6 的前三次尝试**都没写代码**，因为它们的前提不存在：交付它的依赖（C1 的判据）
 * 不在那些 worktree 的基线上。⇒ 本文件因此**先钉住自己的前提**（臂 0），
 * 再去测判据 —— ★ 一个"前提不在"的夹具如果只是跳过，它读起来与"测过了"同形。
 *
 * ── 五臂（对着契约的五条验收逐条）────────────────────────────────────────────────
 *
 *   臂 0  ★ 前提臂：它读的那一格（`TaskStall`）真的在基线的叶子里
 *   臂 1  ★★★ 核心：**不看成员自报**也能判出停下（并证明自报字段不被读）
 *   臂 2  ★★★ 类型臂：**它不能拒绝任务**，而那是类型保证的
 *   臂 3  ★★ N 可注入：N=1 与 N=2 给出**不同**裁决
 *   臂 4  ★★★ 三态 + 定向突变：说不出 ≠ 通过，且合流被抓
 *   臂 5  ★ 接线臂：它真的在装配清单里，且 runtime 位置可达
 *
 * Run: node --test scripts/gate-runtime-stall.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const STALL = await import('../lib/gates/runtime/stall.js')
const { registry } = await import('../lib/gates/index.js')

/** 一条在跑的任务（本文件所有臂的最小输入）。 */
const runningTask = (extra = {}) => ({
  id: 't1', subject: 'a running task', status: 'in_progress', attempt: 1,
  dependencies: [], createdAt: 1, updatedAt: 1, ...extra,
})

const ctxOf = (tasks, extra = {}) => ({ event: 'task-status', team: { id: 'team', tasks }, ...extra })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0：★ 前提臂 —— 它读的那一格真的在基线的叶子里
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么这一臂必须存在 ────────────────────────────────────────────────────────
 *
 * MEASURED（t6，前三次尝试）：这个任务被派发过三次，三次都**什么都没写** ——
 * 因为它的前提（C1 的 `observeStall` / `TaskStall`）不在那些 worktree 的基线上。
 * 那三次的代价是三个完整的往返。
 *
 * ★★ 而"前提不在"与"前提在、而判据写错了"在**一个只跑判据的夹具**里同形：
 *   两者都可能表现为"没报出停下"。⇒ 所以这里**先**把前提钉死。
 */
test('★ 臂 0（前提臂）：本判据读的那一格（TaskStall）真的在基线的叶子 src/types.ts 里', () => {
  const types = readFileSync(join(ROOT, 'src', 'types.ts'), 'utf8')

  assert.match(types, /export interface TaskStall/, '★ `TaskStall` 必须定义在叶子里 —— 否则本判据读不到那一格')
  assert.match(types, /export type StallState = 'trying' \| 'stalled'/, '★ 两态 + 缺席 = 三态那一条约定')
  assert.match(types, /stall\?: TaskStall/, '★ `TeamTask.stall` 必须是可选的（缺席 = 从未被拒）')

  /**
   * ── ★★★ 叶子性：`src/types.ts` **不许有 import** ─────────────────────────────────
   *
   * ★ 这一条是**本判据能不能存在**的全部依据：
   *   `tools/shared/entities.ts` import 了 `gates/index.ts` ⇒ 若判据反向 import 它，
   *   就成环。而叶子无 import ⇒ `gates/ → types.ts` 是单向的，不成环。
   * ★★ 所以"加一个 import 到 types.ts"不是一次风格改动 —— 它会把叶子变成节点，
   *   于是本判据的 import 方向**重新变成**一个环。
   */
  const importLines = types.split('\n').filter((line) => /^\s*import\b/.test(line))
  assert.deepEqual(
    importLines, [],
    '★★★ `src/types.ts` 必须是**零 import 的叶子** —— 它是本判据能读那一格而不成环的**唯一**依据。\n'
    + `   实测它现在有 ${importLines.length} 条 import：${JSON.stringify(importLines.slice(0, 3))}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 核心臂 —— 不看成员自报
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约点名的第一条："decides stall without any member self-report"────────────────
 *
 * ★★ 判据必须是**机械的**：一个卡住的成员**恰恰是最不可能如实报告"我卡住了"的那一个**。
 *   而一个"读了成员状态才报警"的哨兵，会在成员**谎报在动**时永远闭嘴 ——
 *   它与没装这个哨兵在观测上同形。
 *
 * ★ 本臂用**两个方向**证明它不读自报：
 *   ① 把成员的状态字段摆成"一切正常"⇒ 判据**照样**报出停下（正面）
 *   ② 把成员的状态字段摆成"我卡住了"、而任务面无异常 ⇒ 判据**不**报（反面）
 *   ⇒ 两个方向合起来说明：它读的是**任务面**，不是成员面。
 */
test('★★★ 臂 1（核心）：判据只读任务面 —— 成员自报"在动"不影响它，"自报卡住"也不影响它', () => {
  /** ① 任务面上已经数出来 2 次拒绝，而成员面伪装成一切正常 ⇒ 必须报出停下。 */
  const selfReportingHealthy = ctxOf([runningTask({
    stall: { gate: 'completion.mutation', point: 'completion', state: 'stalled', count: 2, at: 1 },
    /** ★ 这些都是"成员侧"的自报面 —— 判据**一个都不许读**。 */
    memberStatus: 'working', lastActivityAt: Date.now(), spoke: 'I am making great progress',
  })], { members: [{ id: 'm1', name: 'worker', status: 'working' }] })
  const reported = STALL.gate(selfReportingHealthy)
  console.log(`    ℹ 成员自报"在动"、而任务面 count=2 ⇒ stalled_count=${reported.stalled_count}`)
  assert.equal(reported.ok, true, '★ 它记录而不拒绝')
  assert.equal(
    reported.stalled_count, 1,
    '★★★ 成员自报"我在动"时，判据**仍然**必须报出停下 —— 否则一个谎报在动的成员能让哨兵闭嘴，\n'
    + '   而那与"没装这个哨兵"在观测上同形。',
  )
  assert.equal(reported.observations[0].basis, 'repeats', '★ 而它说得出**凭什么**判的（basis）')

  /** ② 反面：成员面喊"我卡住了"，而任务面干干净净 ⇒ **不许**报。 */
  const selfReportingStuck = ctxOf([runningTask()], {
    members: [{ id: 'm1', name: 'worker', status: 'blocked', said: 'I am stuck, please help' }],
  })
  const notReported = STALL.gate(selfReportingStuck)
  console.log(`    ℹ 成员自报"我卡住了"、而任务面干净 ⇒ stalled_count=${notReported.stalled_count}`)
  assert.equal(
    notReported.stalled_count, 0,
    '★★★ 反面同理：成员**自称**卡住而任务面没有机械证据时，判据**不许**报 ——\n'
    + '   否则它就成了"读成员自报"的哨兵，而那正是契约禁止的那一种。',
  )

  /**
   * ★★ 而"不读自报"这件事还要**在源码上**可核 —— 否则上面两条只是行为上的巧合
   *   （例如"碰巧没有那个字段"）。⇒ 断言源码里**不出现**成员侧的那些名字。
   */
  const source = readFileSync(join(ROOT, 'src', 'gates', 'runtime', 'stall.ts'), 'utf8')
  /**
   * ── ★★ 只扫**代码**，不扫**注释** ──────────────────────────────────────────────
   *
   * MEASURED（本臂第一版就是这样假红的）：不剥注释时，本文件因为**在注释里**
   * 拿 `liveness` 当结构模板、并描述它的 `stuck_count` 形状而被判"读了成员面"。
   * ★ 而那是**本仓记账过很多次**的形态：**描述一条纪律的文字**被当成了**违反那条纪律的证据**。
   *   （`gate-tool-split` 的臂 3 与 `gate-shared-artifact-writes` 都栽过同一格。）
   * ⇒ 口径与它们逐字相同：先剥块注释与整行 `//`，再扫。
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  /**
   * ★ 成员侧的那些名字（判据一旦读它们，"不依赖自报"就不成立）。
   * ★★ 而反过来也要防**恒真**：下面先证明这段代码**确实**在别处会命中
   *   —— 否则"一个都没命中"可能只是那批名字拼错了。
   */
  const memberFacingNames = ['memberStatus', 'spoke', 'said', 'lastActivityAt']
  for (const name of memberFacingNames) {
    assert.doesNotMatch(
      code, new RegExp(`\\b${name}\\b`),
      `★ 判据**代码**里出现了成员侧的名字 \`${name}\` —— 它一旦读了那一面，"不依赖成员自报"就不成立了`,
    )
  }
  /** ★ 反向半边（防恒真）：同一批名字在**故意写了它们**的样本上必须命中。 */
  const probe = "const memberStatus = 'working'; task.lastActivityAt = now()"
  const hits = memberFacingNames.filter((name) => new RegExp(`\\b${name}\\b`).test(probe))
  assert.ok(
    hits.length >= 2,
    '★ 那批名字在一个**故意写了它们**的样本上一个都没命中 ⇒ 上面"没有成员面"的结论是恒真的（正则坏了）\n'
    + `   实际命中 ${hits.length} 条：${JSON.stringify(hits)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★★ 类型臂 —— 它不能拒绝任务（类型保证，不是约定）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约点名的第二条："It cannot reject a task, and this is enforced by the type
 *    signature rather than by convention" ────────────────────────────────────────
 *
 * ★★ 与 liveness 的差别就在这里：liveness 靠**约定 + 调用方**避免拒绝；
 *   t6 要求的是**编译期**的事实。
 *
 * ★ 怎么在**运行期**夹具里测一个**类型**保证？两条读数合起来：
 *   ① 运行期：判据返回的**形状**里永远没有 `blockers`（多组输入，逐个断言）
 *   ② 源码：返回类型是 `StallVerdict`，而那个类型**排除了** `blockers` 那一支
 *   ⇒ ①是行为、②是机制；只有①会在"它恰好没拒绝过"的输入上假绿。
 */
test('★★★ 臂 2（类型臂）：不能拒绝任务 —— 行为上没有 blockers，类型上排除了那一支', () => {
  /** ① 行为半：把能想到的输入都喂一遍，`blockers` 一个都不许出现。 */
  const shapes = [
    ['空面', { event: 'task-status' }],
    ['团队无 tasks', { event: 'task-status', team: { id: 'team' } }],
    ['干净', ctxOf([runningTask()])],
    ['停下的', ctxOf([runningTask({ stall: { gate: 'g', point: 'p', state: 'stalled', count: 9, at: 1 } })])],
    ['多条停下', ctxOf([
      runningTask({ id: 't1', stall: { gate: 'g', point: 'p', state: 'stalled', count: 2, at: 1 } }),
      runningTask({ id: 't2', stall: { gate: 'h', point: 'q', state: 'stalled', count: 3, at: 1 } }),
    ])],
    ['轮次超限', ctxOf([runningTask({ attempt: 99 })], { rounds: 2 })],
  ]
  for (const [label, ctx] of shapes) {
    const verdict = STALL.gate(ctx)
    console.log(`    ℹ ${label.padEnd(14)} ⇒ ok=${verdict.ok} · blockers=${'blockers' in verdict ? 'YES' : 'no'}`)
    assert.equal(
      'blockers' in verdict, false,
      `★★★ 「${label}」的裁决里出现了 \`blockers\` —— 那是**拒绝**的形状，而 runtime 位置不许拒绝（契约 §5）`,
    )
  }

  /** ② 机制半：导出类型收窄到不拒绝的那一半。 */
  const source = readFileSync(join(ROOT, 'src', 'gates', 'runtime', 'stall.ts'), 'utf8')
  assert.match(
    source, /export type StallVerdict\s*=\s*\n?\s*\| \{ ok: true/,
    '★ 本判据必须导出一个**收窄过**的裁决类型（`StallVerdict`）',
  )
  const verdictType = /export type StallVerdict =([\s\S]*?)\n\n/.exec(source)
  assert.notEqual(verdictType, null, '★ 取不到 `StallVerdict` 的定义 —— 本臂无法成立')
  assert.doesNotMatch(
    verdictType[1], /blockers/,
    '★★★ `StallVerdict` 里出现了 `blockers` —— 那正是"不能拒绝"这条保证的**唯一**载体。\n'
    + '   ⇒ 把它加回去，"本判据不能拒绝任务"就退回成一次 code review 才能发现的事。',
  )
  assert.match(
    source, /export function gate\(ctx: RuntimeStallContext\): StallVerdict/,
    '★★ `gate` 的返回类型必须是那个收窄的类型 —— 否则收窄了也没人用',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★ N 可注入 —— N=1 与 N=2 给出不同裁决
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（N 可注入）：同一条任务在 N=1 与 N=2 下给出**不同**裁决', () => {
  /**
   * ★ 契约原话："N is injectable and a fixture proves N=1 vs N=2 give different verdicts"
   *
   * ★★ 而"可注入"这一条**有历史**：`docs/PENDING-FRICTION-REFORM.md` 逐字写着
   *   「N 必须可注入」。一个写死的阈值在别的仓库形态里要么恒不响、要么吵个不停，
   *   而**两种都读不出来**（恒不响的哨兵与没装它同形）。
   */
  const once = runningTask({ stall: { gate: 'g', point: 'p', state: 'trying', count: 1, at: 1 } })

  const n1 = STALL.gate(ctxOf([once], { rounds: 1 }))
  const n2 = STALL.gate(ctxOf([once], { rounds: 2 }))
  console.log(`    ℹ 同一条 count=1 的任务 ⇒ N=1: stalled_count=${n1.stalled_count} · N=2: stalled_count=${n2.stalled_count}`)

  assert.equal(n1.stalled_count, 1, '★ N=1 ⇒ 被拒一次就算停下')
  assert.equal(n2.stalled_count, 0, '★ N=2 ⇒ 被拒一次还不算停下')
  assert.notEqual(n1.stalled_count, n2.stalled_count, '★★★ 两端必须给出**相反**结论 —— 否则 N 不是一个自变量')

  /** ★ 而 N 必须**随读数交出去**（一个数必须与它的量具一起读 —— 文档 §6）。 */
  assert.equal(n1.threshold, 1, '★ 裁决必须交出**它用的那个 N**')
  assert.equal(n2.threshold, 2, '★ 否则 "被拒 1 次" 在 N=1 与 N=2 下读起来一样，而它们的含义相反')

  /** ★ 反向半边：**非法/缺席的 N 落回默认值，绝不抛错**。 */
  for (const bad of [undefined, 0, -1, 1.5, Number.NaN]) {
    const verdict = STALL.gate(ctxOf([once], { rounds: bad }))
    assert.equal(verdict.threshold, STALL.DEFAULT_STALL_ROUNDS, `★ rounds=${String(bad)} 必须落回默认值（判据不许因为配置没给而炸掉）`)
  }
  assert.equal(STALL.DEFAULT_STALL_ROUNDS, 2, '★ 契约点名 default 2')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 三态 + 定向突变
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4（三态 + 定向突变）：说不出 ≠ 通过，且把两者合流会被抓', () => {
  /**
   * ── 三态（契约："could-not-measure is distinguishable from pass"）────────────────
   *
   * ★★ 而这一条在本判据上**格外要命**：一个恒 `unmeasured` 的哨兵是**吵**，
   *   一个把 `unmeasured` 读成 `ok` 的哨兵是**哑** —— 而哑的那个更坏，
   *   因为"没人停住"与"我没测成"在 `ok: true` 上同形。
   */
  const cannotMeasure = STALL.gate({ event: 'task-status' })
  const pass = STALL.gate(ctxOf([runningTask()]))

  console.log(`    ℹ 说不出 ⇒ ok=${cannotMeasure.ok} \`unmeasured\`=${cannotMeasure.unmeasured === undefined ? 'no' : 'YES'}`)
  console.log(`    ℹ 通过   ⇒ ok=${pass.ok} \`unmeasured\`=${pass.unmeasured === undefined ? 'no' : 'YES'}`)

  assert.equal(cannotMeasure.ok, false, '★ "说不出"不是 ok')
  assert.equal(typeof cannotMeasure.unmeasured, 'string', '★ 而它必须**说得出**缺的是哪一格')
  assert.match(String(cannotMeasure.unmeasured), /team observation/, '★ 措辞要说清缺的是团队面')

  assert.equal(pass.ok, true, '★ "看了、没人停下"是 ok')
  assert.equal('unmeasured' in pass, false, '★ 而它**不带** unmeasured')

  /** ★ 三态**两两不同形** —— 逐对写，不循环（漏掉哪一对都看不出来）。 */
  assert.notEqual(cannotMeasure.ok, pass.ok, '★ 说不出与通过必须不同形')
  const stalled = STALL.gate(ctxOf([runningTask({ stall: { gate: 'g', point: 'p', state: 'stalled', count: 2, at: 1 } })]))
  assert.notEqual(stalled.stalled_count, pass.stalled_count, '★ "有人停下"与"没人停下"必须不同形')
  assert.equal(stalled.ok, pass.ok, '★ 而两者都是 ok（本判据不拒绝）—— 所以差别**只能**靠计数读出来')

  /**
   * ── ★★★ 定向突变：把"说不出"并进"通过" ⇒ 本臂必须翻脸 ────────────────────────
   *
   * ★ 用**对照实现**（本仓既有的做法）：两个端点跑同一份输入、同一条读数函数。
   */
  const honest = (ctx) => {
    try {
      const verdict = STALL.gate(ctx)
      return verdict.ok === true ? 'passed' : verdict.unmeasured !== undefined ? 'could-not-measure' : 'other'
    } catch { return 'threw' }
  }
  /** ★ 被"拆掉机制"的版本：说不出被读成通过（哑哨兵）。 */
  const collapsed = (ctx) => (honest(ctx) === 'could-not-measure' ? 'passed' : honest(ctx))

  assert.equal(honest({ event: 'task-status' }), 'could-not-measure', '★ honest 端必须是"说不出"')
  assert.equal(collapsed({ event: 'task-status' }), 'passed', '★ collapsed 端把"说不出"读成了"通过"')
  assert.notEqual(
    honest({ event: 'task-status' }), collapsed({ event: 'task-status' }),
    '★★★ 两端必须给出相反结论：否则本臂的断言在一个"把没测到读成通过"的实现上照样绿 ——\n'
    + '   而那正是本任务要消灭的合流（一个恒 ok 的哨兵与没装它同形）。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 接线臂 —— 在装配清单里，且 runtime 位置可达
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（接线臂）：`runtime.stall` 在装配清单里，且经 runtime 位置真的被求值到', async () => {
  /**
   * ★★ 本仓记账最久的形态之一：「盘上有文件」与「有人跑它」在**没人跑**时同形。
   *   这个文件的头注释记着两次真实事故（`runtimeLiveness` 与 `deliveryCoverage`
   *   都曾"本体在盘上、`ALL_GATES` 里没有它"）。
   */
  assert.equal(STALL.id, 'runtime.stall')
  assert.equal(STALL.point, 'runtime')

  const listed = registry.list().runtime.map((entry) => entry.id)
  console.log(`    ℹ runtime 位置的清单：${JSON.stringify(listed)}`)
  assert.ok(
    listed.includes('runtime.stall'),
    '★★★ 它必须在装配清单里 —— 否则它**一次都不会跑**，而那与没有它在观测上同形',
  )

  /**
   * ★ 而"在清单里"还不等于"被求值到"：走一次**真的 registry 求值**。
   *   ★ 用白名单里的事件 ⇒ 它应当 `evaluated`（而不是 skipped）。
   */
  const evaluation = await registry.evaluate('runtime', {
    event: 'task-status',
    team: { id: 'team', tasks: [runningTask({ stall: { gate: 'g', point: 'p', state: 'stalled', count: 2, at: 1 } })] },
  })
  const entry = evaluation.ran.find((item) => item.id === 'runtime.stall')
  console.log(`    ℹ 经注册表求值 ⇒ ran entry: ${JSON.stringify(entry)}`)
  assert.notEqual(entry, undefined, '★ 它必须出现在这一次求值的 `ran` 清单里')
  assert.notEqual(entry.verdict, 'skipped', '★ 在它白名单里的事件上，它不许被跳过 —— 那正是"装了但不跑"')

  /**
   * ★★ 而它**只在该开口的事件上**开口（白名单是它自己的决定，不是调用方的）——
   *   否则它会在每一个 runtime 事件上说话，变成噪音。
   */
  assert.equal(STALL.appliesTo({ event: 'member-dispatched' }), false, '★ 不在白名单的事件上它不许说话')
  assert.equal(STALL.appliesTo({ event: 'task-status' }), true)
  assert.equal(STALL.appliesTo(undefined), false, '★ 没有 ctx ⇒ 不适用（不是"通过"）')
})
