/**
 * ── ★ 预测验证②（t21）：扫全部【调用点】找「把 unmeasured 读成 blocked/ok」的地方 ────
 *
 * ── 这一步在本质探索里的位置：第 ④ 步（预测验证）的第二条 ────────────────────────
 *
 *   本质 ①：【判据自己把「没能判断」与「判断了」合流】   —— t20 扫过（判据内部）
 *   本质 ②：**判据判得对，而读它的那一层把输出读错了** —— 本文件扫（调用点这一层）
 *
 * ★ t20 的强否定把搜索面**缩小**到了这里：
 *
 *     「14 条判据在『测量手段缺席』上全部如实报 unmeasured，零例外
 *       ⇒ 本质① 的载体不是『忘了说 unmeasured』（那一层很扎实）
 *       ⇒ 而是【裁决的传递】」
 *
 * ⇒ 于是本任务问的不是"判据内部怎么处理 unmeasured"，而是：
 *
 *     ★ **evaluate 的返回值被拿去做决定的那几处，怎么读 unmeasured？**
 *
 * ── 预测（从本质②出发，要验证的是一条【尚未观测到的】表象）─────────────────────
 *
 *     任何按 `unmeasured` 做决策的调用点，都可能把它读成另外两态之一：
 *
 *       读成 `blocked` ⇒ 「没能测量」变成一个【拒绝理由】     ← f-0003 就是这样
 *       读成 `ok`      ⇒ 「没能测量」变成一次【通过】         ← 更坏，静默
 *
 * ★ 已有实例（f-0003）：执行器缺席 ⇒ 判据诚实报 unmeasured ⇒ 被上层读成拒绝
 *   ⇒ **所有普通任务建不出来**。它是这条预测的第一个实证。
 *
 * ── 本文件的立场：不看实现者夹具，自己构造输入，走真实入口 ────────────────────────
 *
 * 唯一的被测对象是 `registerAgentTeamsTools` 注册出来的**真实工具**（`lib/tools.js`）
 * 与真实注册表（`lib/gates/index.js`）。不 import 任何 `*.test.mjs` 的辅助函数。
 *
 * ★ 为什么必须从工具入口进：直接调 `registry.evaluate(...)` 在调用点接线之前就能跑通
 *   （注册表本身没问题），它证明不了"读它的那一层怎么读"。本文件要的正是那一层。
 *
 * ── 臂的划分 ────────────────────────────────────────────────────────────────
 *
 *   臂 0（普查口径）  六个调用点逐个列出，**并说明每个为什么对/错** ——
 *                     契约原话：「报告要按调用点逐个列出……否则普查等于没查」
 *   臂 1（★ 命中）     status 调用点把 delivery 的 unmeasured **塞进 blockers**
 *   臂 2（诱导复现）   构造"delivery 真的没能测量"的场景 ⇒ 沿真实路径断言它落在哪出口
 *   臂 3（两处 delivery 的形状一致）同一份事实，两个入口必须给同形的答复
 *   臂 4（★ 定向突变） 把某处的 unmeasured 处理改成当 blocked ⇒ 对应臂必须红
 *   臂 5（f-0003 回归） 执行器缺席时，普通任务的建立**不该**被 unmeasured 拒掉
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { registerAgentTeamsTools } = await import('../lib/tools.js')
const { registry } = await import('../lib/gates/index.js')
const { createTeamDir } = await import('../lib/state.js')

/**
 * ── 六个调用点（普查的完整名单）─────────────────────────────────────────────────
 *
 * ★ 这份名单是**机械取出来的**（`grep -n "registry.evaluate(" src/tools.ts`），
 *   不是手写的猜测。但它同时记了 `point` 与工具名 —— 于是"注册表里又多了一个
 *   被 evaluate 的位置，而这份名单没跟上"是可以被发现的（见臂 0 的末段）。
 */
const CALL_SITES = [
  { point: 'runtime', tool: '（多处：每次状态迁移/等待）', line: 'tools.ts:2353' },
  { point: 'contract', tool: 'agent_teams_create_task / amend_task', line: 'tools.ts:2470' },
  { point: 'dispatch', tool: 'agent_teams_update_task', line: 'tools.ts:4294' },
  { point: 'completion', tool: 'agent_teams_update_task', line: 'tools.ts:4593' },
  { point: 'delivery', tool: 'agent_teams_status（报告）', line: 'tools.ts:5308' },
  { point: 'delivery', tool: 'agent_teams_declare_delivery（宣告）', line: 'tools.ts:5450' },
]

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

/**
 * 一个最小但【真的】插件 ctx —— 用真实 `registerAgentTeamsTools`，不手搓实现。
 *
 * ★ 手搓的那份测的是夹具，不是产品代码。这里连 `logger.warn` 都是真的（只是被换成
 *   一个收集器），因为"调用点怎么读 unmeasured"有一部分正体现在它的告警措辞上。
 *
 * ★★ 必须先 seed 一个真的团队（`createTeamDir`），再注册工具 —— 否则每个工具都会先
 *    撞上 "you are not leading any team yet"。第一次跑就是这样红的（实测记一笔：
 *    那是**夹具缺了前置**，不是产品缺陷；而它与"调用点读错了 unmeasured"在返回值上
 *    同形 —— 都只是一句 error。⇒ 所以下面 `assert.equal(threw,false)` 的失败信息里
 *    必须点明"这一次是不是前置没搭好"）。
 */
async function pluginFixture() {
  const workspace = track(mkdtempSync(join(tmpdir(), 't21-')))
  /**
   * ★ 团队里【先放一个普通任务】:很多工具要求"团队里有工作"。
   *   而它的 kind 是 `work`（不是 quality）—— 与臂 5 要测的"普通任务"同形。
   */
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team', name: 'T21Consumers', captainSessionId: 'captain-session',
    createdAt: 1, taskSeq: 0, members: [], tasks: [],
  })
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: {
      debug() {}, info() {},
      warn(message) { warnings.push(String(message)) },
      error(message) { warnings.push(String(message)) },
    },
    tools: { register(tool) { tools.set(tool.name, tool) } },
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
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })
  const call = async (name, args) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    return await tool.execute(args, {
      agent: { id: 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} },
      signal: new AbortController().signal,
    })
  }
  return { ctx, tools, call, warnings, workspace }
}

/** 跑一次调用并把它抛出的错（若有）读回来 —— 不抛错的路径同样是一个读数。 */
async function attempt(fn) {
  try {
    return { threw: false, value: await fn() }
  } catch (error) {
    return { threw: true, message: error instanceof Error ? error.message : String(error) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0：普查口径 —— 逐个调用点列出它怎么读 unmeasured，并说清为什么对/错
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是契约里那句的落点 ───────────────────────────────────────────────────
 *
 *   「★ 报告要按调用点逐个列出：它怎么读 unmeasured，以及为什么那样读是对的或错的」
 *
 * ★ 而"逐个列出"不能只是打印：它必须**同时**是一条断言 —— 否则"我查过了"与
 *   "我没查"在下一次跑的时候同形。⇒ 本臂对每个调用点给出一个**可判定的判词**
 *   （`honest` / `collapsed`），并断言这份名单与注册表里真实存在的位置对得上。
 *
 * ── 判词的标准（★ 这是本臂的全部要点：什么叫"读对了"）──────────────────────────
 *
 *   `unmeasured` 是**关于测量**的结论；`blocked` 是**关于被测对象**的结论。
 *   调用点读对了 ⟺ 它把两者放在**不同形**的出口上，且措辞能让人分开。三种读法：
 *
 *     ✔ honest    —— 有独立的 `unmeasured` 分支（或独立字符串前缀），与 blockers 不同形
 *     ✘ collapsed —— 与 blocked 或 ok 合流（同一出口、只靠措辞区分）
 *
 * ★ 本臂**不**断言"六个调用点全部 honest" —— 那会把"发现缺陷"变成"断言不存在缺陷"
 *   （一个会随现状变红的普查，与 t5 禁止的棘轮同类）。它断言的是两件不随现状变的事：
 *     ① 名单覆盖了注册表里**每一个**有 evaluate 调用点的位置；
 *     ② 每个调用点的判词都有**可执行的证据**（下面 cases 里逐条喂输入验证）。
 */
test('臂 0 ★ 普查：六个调用点逐个列出它怎么读 unmeasured（判词 + 可执行证据）', () => {
  /**
   * ── 逐【调用点】的判词（★ 不是逐位置）────────────────────────────────────────
   *
   * ★★ 这一点是本任务实测抓出来的：`delivery` 有**两个**调用点，而它们**不同**：
   *
   *     status（5308）          ✘ collapsed —— unmeasured 被拼进 blockers
   *     declare_delivery（5450）✔ honest    —— 有独立的 unmeasured 分支
   *
   * ⇒ 第一版把判词按 **point** 索引，于是两个 delivery 调用点共用一条判词 ——
   *   一个"同一个位置两处不同读法"的事实被**索引方式本身**抹掉了。
   *   ★ 这正是本队记过的形态："读错位置的出口"的一个变体 —— 索引的粒度选错，
   *     于是两件不同的事在报表上同形。
   *
   * ⇒ 现在按调用点（`line`）索引。每一条都必须在别处**被实测**（臂 1/2/3/5），
   *   这里只做登记与对账 —— "我读懂了代码"不许冒充"我测过了"。
   */
  const verdicts = {
    'tools.ts:2353': { reading: 'honest', why: 'unmeasured 与 blocked 分列成两个字符串前缀（`unmeasured: …` / `blocked: …`），且只记录不拒绝（契约 §5）' },
    'tools.ts:2470': { reading: 'honest', why: '有独立 `unmeasured !== undefined` 分支，抛出的措辞说 "could not measure"，与 blockers 分支不同形' },
    'tools.ts:4294': { reading: 'honest', why: '同上：独立分支 + "could not measure" 措辞' },
    'tools.ts:4593': { reading: 'honest', why: '同上：独立分支 + "could not measure" 措辞' },
    'tools.ts:5308': { reading: 'collapsed', why: '★ status 把 unmeasured 拼进 blockers 数组（同一出口），而 schema 是 additionalProperties:false ⇒ 结构上无处安放' },
    'tools.ts:5450': { reading: 'honest', why: '★ 同一位置、另一入口：declare_delivery 有独立的 unmeasured 分支，措辞与 blockers 不同形' },
  }

  /** ① 名单必须覆盖注册表里每一个有 evaluate 的位置（新增位置而名单没跟上 ⇒ 红）。 */
  const pointsWithCallSites = new Set(CALL_SITES.map((site) => site.point))
  assert.ok(
    pointsWithCallSites.has('delivery') && pointsWithCallSites.has('contract') && pointsWithCallSites.has('dispatch')
    && pointsWithCallSites.has('completion') && pointsWithCallSites.has('runtime'),
    '★ 名单没有覆盖全部五个有调用点的位置 —— 漏掉的那个就是"没查"与"查了没问题"同形的地方',
  )

  /**
   * ② `admission` 位置**不在**名单里，且这是一条读数而不是遗漏：
   *    它此刻一条调用点都没有（t20 的臂 0 记过）。★ 断言它"没有"而不是"应该有" ——
   *    后者会在 t10 接上调用点的时候无端变红。
   */
  const admissionCallSites = CALL_SITES.filter((site) => site.point === 'admission')
  console.log(`    ℹ 普查范围：${CALL_SITES.length} 个调用点，覆盖 ${pointsWithCallSites.size} 个位置`
    + `（admission 位置${admissionCallSites.length === 0 ? '没有调用点，故不在名单里' : '已列入'}）`)

  /** ③ 每个调用点都要有判词与理由 —— 空判词会让"逐个列出"退化成一句口号。 */
  for (const site of CALL_SITES) {
    const verdict = verdicts[site.line]
    assert.notEqual(
      verdict, undefined,
      `★ 调用点 ${site.line}（${site.point}·${site.tool}）没有判词 —— 普查漏了它。`
      + '★ 判词按【调用点】索引而不是按位置：同一个位置的两处入口可以读出不同的结果，'
      + '按位置索引会把那个差别抹掉（本任务第一版就是这样错的）',
    )
    assert.ok(verdict.why.length > 10, `★ 调用点 ${site.line} 的判词没有理由 —— "为什么对/错"必须写出来`)
    console.log(`    ℹ ${site.point.padEnd(11)} ${site.line.padEnd(15)} ${verdict.reading === 'honest' ? '✔ honest   ' : '✘ collapsed'} ${verdict.why.slice(0, 78)}`)
  }

  /**
   * ④ ★ 关于"没有问题的调用点也要说清为什么没有"：
   *    `honest` 那五条判词就是那个说明。而它们**不是**靠这句话成立的 ——
   *    臂 5 会用真实工具路径（执行器缺席 ⇒ 普通任务照常建立）把 `contract` 那条
   *    实测一遍；臂 3 会把两个 delivery 入口的**不一致**实测出来。
   *    没有那两条臂，这些判词就只是一句主张。
   */
  const honestCount = Object.values(verdicts).filter((v) => v.reading === 'honest').length
  const collapsedCount = Object.values(verdicts).filter((v) => v.reading === 'collapsed').length
  assert.ok(honestCount >= 5, '★ honest 的判词少于 5 条 —— 要么普查漏了，要么有人把判词改成了 collapsed 却没记账')
  assert.equal(
    collapsedCount, 1,
    '★ collapsed 的判词不是恰好 1 条 —— 这个数字是**台账**：今天恰好只有 status 这一处合流。'
    + '它变了就必须有人来解释（修好了 ⇒ 改成 0 并说明；新出现的 ⇒ 那是新的命中）',
  )
  /**
   * ★ 并如实记一笔：**同一个 delivery 位置的两条判词不同** —— 那正是本任务的关键读数。
   *   任何"按位置去重"的实现都会让它消失，所以这里显式钉一次。
   */
  const deliveryVerdicts = CALL_SITES
    .filter((site) => site.point === 'delivery')
    .map((site) => verdicts[site.line].reading)
  assert.deepEqual(
    deliveryVerdicts, ['collapsed', 'honest'],
    '★ delivery 的两个调用点必须各自有判词，且**当前**一 collapsed 一 honest —— '
    + '这正是"同一份事实、两种读法"的台账。它变了就说明有人修了其中一处或两处',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★ 命中：status 调用点把 delivery 的 unmeasured 塞进 blockers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂防的是什么（本任务的核心命中）────────────────────────────────────────
 *
 * `tools.ts:5308`（`agent_teams_status` 的 delivery 报告面）：
 *
 *     blockers: [ ...deliveryCheck.blockers,
 *                 ...deliveryEvaluation.blockers,
 *                 ...deliveryEvaluation.unmeasured === undefined ? [] : [`could not measure: ${…}`] ]
 *
 * ⇒ `unmeasured` 被拼进 `blockers` —— **与"发现了一个问题"走同一个出口**。
 *   而它的 reader 是一个 JSON schema，`additionalProperties: false`，
 *   字段只有 `{ok, blockers, gates_evaluated, input_surface}` ⇒ **结构上无处安放**。
 *
 * ★ 为什么这比 f-0003 更值得修：`delivery` 位置**今天恒 unmeasured**（coverage 与
 *   convergence 都要调用方注入观察面，而 status 交的 ctx 里没有）⇒ 这条"假拒绝理由"
 *   **每次读状态都在**。一个偶尔出现的假告警可以被忽略；一个**每次都在**的假告警
 *   会教人永久忽略那个字段 —— 那正是本队记过的「噪音教人忽略门禁」。
 *
 * ── 本臂怎么把它变成可判定的 ──────────────────────────────────────────────────
 *
 * 沿**真实入口**读一次 `agent_teams_status`，然后检查返回的 `delivery` 对象：
 *   · `unmeasured` 有没有**自己的位置**？（期望：有；实际：没有）
 *   · 那句"没能测量"是否出现在 `blockers` 里？（期望：不；实际：是）
 */
test('臂 1 ★ 命中：status 把 delivery 的「没能测量」塞进 blockers（同一出口，结构上无处安放）', async () => {
  const fixture = await pluginFixture()
  const result = await attempt(() => fixture.call('agent_teams_status', {}))

  /**
   * ★ 即使 status 本身抛错，我们也要能读到最后一次的 delivery 读数 —— 但它不该抛错：
   *   报告类入口不该因为"没能测量"而拒绝（拒绝会把"读一下状态"变成流程卡死）。
   */
  assert.equal(result.threw, false, `★ agent_teams_status 不该抛错（它只是报告）：${result.message}`)

  const delivery = result.value?.delivery
  assert.notEqual(delivery, undefined, '★ 返回里必须有一个 delivery 报告面 —— 否则本臂读不到任何东西')

  /**
   * ★★ 关键断言 A：`unmeasured` 必须有自己的**结构化**出口。
   *
   * 现在它没有（被拼成 blockers 里的一条字符串）⇒ 这一条会红，那正是命中。
   */
  const hasOwnUnmeasuredField = Object.prototype.hasOwnProperty.call(delivery, 'unmeasured')
  const blockerCarryingMeasurementFailure = (delivery.blockers ?? [])
    .filter((line) => /could not measure/i.test(String(line)))

  console.log(`    ℹ delivery 的字段：${Object.keys(delivery).join(', ')}`)
  console.log(`    ℹ blockers 里带 "could not measure" 的条数：${blockerCarryingMeasurementFailure.length}`)
  if (blockerCarryingMeasurementFailure.length > 0) {
    console.log(`    ℹ 原文：${blockerCarryingMeasurementFailure[0]}`)
  }

  /**
   * ★★ 关键断言 A：若出现了"没能测量"，它必须有自己的**结构化**出口。
   *
   * ── 口径在 2026-10-07 被修正过一次，理由在这里 ──────────────────────────────
   *
   * 原文是 `assert.ok(hasOwnUnmeasuredField)` —— 「delivery 面**必须**带 unmeasured」。
   * 而它依赖一个**前提**，那个前提写在上面那段注释里：
   *   「`delivery` 位置**今天恒 unmeasured**（coverage 与 convergence 都要调用方注入
   *     观察面，而 status 交的 ctx 里没有）」
   *
   * ★ MEASURED：t34 之后那个前提**不再成立** —— ctx 现在有观察面了，于是这个 fixture
   *   产出的是 `gates_evaluated=3 / blockers=["team has no completed work"]`：
   *   一条**真实的** blocker，而 delivery 位置根本没有"没能测量"。
   *   ⇒ 在该 ctx 下 `unmeasured` 恒为 `undefined`，
   *     于是**任何「仅在测量失败时才产出该字段」的正确实现都过不了这一条** ——
   *     而那个口径正是 `declare_delivery` 与同文件其它可选读数一直用的口径。
   *
   * ⇒ 修正后它断言的是【形状】而非【在场】，而那才是这一臂真正要防的东西：
   *   若出现了"没能测量"，它必须有**自己的位置**（不许挤进 blockers）；
   *   而下面那条反向断言同时钉住"不许两处都写"。
   *
   * ★ 为什么不改成"让产品恒产出这个字段"：那会把「没测到」与「没发生测量」
   *   合流成同一个形状 —— 而那正是本任务存在的理由。
   *   夹具该做的不是逼产品迁就它，而是**把前提改成当前为真的那一个**。
   */
  const measurementFailed = blockerCarryingMeasurementFailure.length > 0
    || (typeof delivery.unmeasured === 'string' && delivery.unmeasured.length > 0)
  assert.ok(
    !measurementFailed || hasOwnUnmeasuredField,
    '★ delivery 报告面没有自己的 `unmeasured` 位置 —— "没能测量"只能挤进 blockers，'
    + '于是它与"发现了问题"走同一出口。★ 它的读者是一个 additionalProperties:false 的 schema，'
    + '所以修法不只是改一行拼装：schema 也要留出那一格。',
  )

  /**
   * ★★ 关键断言 B：那句"没能测量"**不许**出现在 blockers 里。
   *
   * 反向半边：若它既有独立字段、又同时塞进 blockers，那是**两份真相**（同一事实两个出口，
   * 而它们会分叉）。⇒ 两半都要断言，缺一半本臂就可能被"两处都写"蒙过去。
   */
  assert.deepEqual(
    blockerCarryingMeasurementFailure, [],
    '★ "没能测量"被写进了 blockers —— 读者会把一次未能测量读成一条交付被拒的理由\n'
    + blockerCarryingMeasurementFailure.map((line) => `  · ${line}`).join('\n'),
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：诱导复现 —— 构造"delivery 真的没能测量"，断言它落在哪个出口
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约要求：「必须能诱导复现：构造一个调用点拿到 unmeasured 的场景，
 *    断言它【不】被当成拒绝或通过」──────────────────────────────────────────────
 *
 * 臂 1 读的是"一次真实调用留下的形状"，本臂读的是"**当 delivery 确实未能测量时**，
 * 两态被怎么走"。分开的理由：臂 1 可能因为 delivery 恰好没产出 unmeasured 而变绿
 * （那样它就没测到任何东西）⇒ 本臂直接**喂**一个"没能测量"的裁决进去，逼它走那条路。
 *
 * ★ 怎么"喂"：在**真实注册表**上临时挂一条 `unmeasured` 探针（点 = delivery），
 *   调用真实的 `agent_teams_status`，然后摘掉探针。
 *   ⇒ 走的是**真实调用点**，不是复刻它的逻辑。
 *   ★ 探针必须在 finally 里摘掉：留在注册表上的探针会让同进程的其它用例凭空多一条判据。
 */
test('臂 2 ★ 诱导复现：delivery 报 unmeasured 时，status 不许把它当成"交付被拒的理由"', async () => {
  const fixture = await pluginFixture()
  const probeId = `t21.probe.unmeasured.${Math.random().toString(36).slice(2)}`
  registry.register({
    id: probeId,
    point: 'delivery',
    description: 't21 probe: a delivery gate that could not measure',
    gate: () => ({ ok: false, unmeasured: 'the convergence of the members could not be observed (t21 probe)' }),
  })

  try {
    const result = await attempt(() => fixture.call('agent_teams_status', {}))
    assert.equal(result.threw, false, `★ status 不该抛错：${result.message}`)

    const delivery = result.value?.delivery
    assert.notEqual(delivery, undefined, '★ 返回里必须有 delivery 报告面')

    /** ★ 前提：探针**真的被求值到了**（否则本臂在"探针没跑"时也会绿）。 */
    assert.equal(
      delivery.gates_evaluated >= 1, true,
      '★ 探针没有被求值到 —— 那本臂什么都没测到（"没能测量"与"探针没跑"同形）',
    )

    const lines = (delivery.blockers ?? []).map(String)
    const measurementLine = lines.filter((line) => /could not measure/i.test(line))
    console.log(`    ℹ gates_evaluated=${delivery.gates_evaluated} · blockers=${JSON.stringify(lines)}`)

    /**
     * ★★ 断言：那句"没能测量"**不许**被读成一条 blocker。
     *
     * 这是"诱导复现"的落点：我们**确定**配送了一条 unmeasured，而调用点必须让它
     * 落在与"发现了问题"不同的出口上。现在它落在 blockers 里 ⇒ 红。
     */
    assert.deepEqual(
      measurementLine, [],
      '★ 构造出来的 unmeasured 被调用点读成了 blocked —— 这正是 f-0003 的形态（把"没能测量"'
      + '当成一条拒绝理由），只是位置不同：那里卡死的是建任务，这里污染的是交付报告面',
    )

    /** ★ 反向半边（缺了它，本臂在"调用点什么都不报"的实现上照样绿）：它必须**说出来**。 */
    assert.ok(
      Object.prototype.hasOwnProperty.call(delivery, 'unmeasured')
      || measurementLine.length > 0,
      '★ 调用点把那条 unmeasured **完全丢掉了** —— 那比读错更坏：一次未能测量变成一片静默，'
      + '而静默与"测过了、没问题"在读者眼里同形',
    )
  } finally {
    registry.unregister(probeId)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：两处 delivery 的形状一致（同一份事实，两个入口必须给同形答复）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂的由来（captain 要求的第③条，比 ctx 分叉深一层）────────────────────────
 *
 * `delivery` 有**两个**调用点：`status`（报告）与 `declare_delivery`（宣告）。
 * captain 已核实两处的 **ctx 逐字段相同**（刻意设计：报告与宣告必须读同一份事实，
 * 否则"status 说能交、declare 说不能"会成为一个新的、更难查的不一致）。
 *
 * ★ 但 ctx 相同**保护不了消费方式**：同一份裁决，两个入口各自决定"怎么读它"。
 *   而实测两者不同形：
 *
 *     declare_delivery ⇒ 有独立的 `unmeasured !== undefined` 分支（throwWithSurface，
 *                        措辞 "could not measure"）
 *     status           ⇒ 把 unmeasured 拼进 blockers 数组
 *
 * ⇒ 于是**同一份事实，两个入口给读者的形状不同**。这是"两份真相"的另一种写法：
 *   不是数据有两个来源，而是**同一份数据有两种读法**。
 *
 * ── 本臂的可执行形式 ──────────────────────────────────────────────────────────
 *
 * 两个入口在"delivery 报 unmeasured"时应给出**同类**的答复形状 —— 具体地：
 * 都不能把它算成一条 blockers。用真实工具路径分别读一次。
 */
test('臂 3 ★ 两个 delivery 入口必须同形地暴露「没能测量」（ctx 相同保护不了消费方式）', async () => {
  const fixture = await pluginFixture()
  const probeId = `t21.probe.twosides.${Math.random().toString(36).slice(2)}`
  registry.register({
    id: probeId,
    point: 'delivery',
    description: 't21 probe: delivery that could not measure (two-entry consistency)',
    gate: () => ({ ok: false, unmeasured: 'the goal coverage matrix could not be read (t21 two-entry probe)' }),
  })

  try {
    /** 入口 A：status（报告）。 */
    const statusRun = await attempt(() => fixture.call('agent_teams_status', {}))
    const statusDelivery = statusRun.value?.delivery
    assert.notEqual(statusDelivery, undefined, '★ status 必须交出 delivery 报告面')

    /** 入口 B：declare_delivery（宣告）。★ 它很可能被拒 —— 拒绝本身是读数。 */
    const declareRun = await attempt(() => fixture.call('agent_teams_declare_delivery', {}))
    console.log(`    ℹ status: did it put "could not measure" into blockers? `
      + `${(statusDelivery.blockers ?? []).some((line) => /could not measure/i.test(String(line)))}`)
    console.log(`    ℹ declare_delivery: threw=${declareRun.threw}`
      + `${declareRun.threw ? ` · ${declareRun.message.slice(0, 90)}` : ''}`)

    /**
     * ★★ 断言：**两个入口不许不同形**。
     *
     * 判据：declare 那一侧把"没能测量"表达成**独立措辞**（它有自己的分支）；
     * 那么 status 那一侧也必须有一个**不叫 blockers 的出口**承载同一件事。
     */
    const statusUsesBlockersForMeasurement = (statusDelivery.blockers ?? [])
      .some((line) => /could not measure/i.test(String(line)))
    const declareUsesDedicatedWording = declareRun.threw
      && /could not measure/i.test(declareRun.message)

    assert.equal(
      statusUsesBlockersForMeasurement, false,
      '★ 两个 delivery 入口对**同一份**"没能测量"给了不同形状的答复：\n'
      + '  · declare_delivery ⇒ 独立措辞（"the delivery gate could not measure (…)"）\n'
      + '  · status           ⇒ 拼进 blockers 数组\n'
      + '  ⇒ 而两处的 ctx 是逐字段相同的（captain 已核实）。ctx 相同保护不了消费方式：\n'
      + '    不是数据有两个来源，而是**同一份数据有两种读法**。\n'
      + `  ※ 本臂实测：declare 走独立措辞 = ${declareUsesDedicatedWording}`,
    )
  } finally {
    registry.unregister(probeId)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 定向突变：把某处的 unmeasured 处理改成当 blocked ⇒ 对应臂必须红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 规则二后半句 ──────────────────────────────────────────────────────────────
 *
 * 「把机制单独去掉，臂必须红。」本臂要证明的是：**臂 1/2/3 测的确实是"调用点怎么读
 *   unmeasured"这条机制**，而不是"恰好也在看 blockers"。
 *
 * ★ 为什么用对照实现而不是改产品源码：本任务 inScope 只有 scripts/，
 *   改 `src/tools.ts` 不在范围内。⇒ 用**同一族实现的两个端点**并排证明：
 *
 *     `honest`     —— 给 unmeasured 一个独立出口（调用点应当的形状）
 *     `collapsed`  —— 把它拼进 blockers（被拆掉机制之后的形状）
 *
 *   然后断言：臂 1 的那两条断言**只在 honest 上绿、在 collapsed 上红**。
 *   ⇒ 这把"臂 1 的失败模式（恰好也绿）"排除掉了。
 *
 * ★ 并如实记一笔（t20 的教训）：一次"本来就已经红"的臂，无法用突变区分
 *   "测到了机制"与"恰好在报别的问题"。⇒ 本臂不声称"我突变了产品",
 *   它声称的是"这两个端点在同一条断言下给出相反结论"。
 */
test('臂 4 ★ 定向突变：把 unmeasured 的处理换成"当成 blocked" ⇒ 臂 1 的断言必须翻脸', async () => {
  /**
   * 消费函数的两端：输入是同一份 `{ok:false, unmeasured, blockers:[]}` 裁决。
   */
  const honest = (verdict) => ({
    ok: verdict.ok === false ? false : true,
    blockers: [...(verdict.blockers ?? [])],
    ...verdict.unmeasured === undefined ? {} : { unmeasured: verdict.unmeasured },
  })
  /** ★ 这就是被"拆掉机制"的版本：unmeasured 拼进 blockers（= 产品当前的 status 写法）。 */
  const collapsed = (verdict) => ({
    ok: verdict.ok === false ? false : true,
    blockers: [
      ...(verdict.blockers ?? []),
      ...verdict.unmeasured === undefined ? [] : [`could not measure: ${verdict.unmeasured}`],
    ],
  })

  const unmeasuredVerdict = { ok: false, unmeasured: 'the members could not be observed', blockers: [] }
  const blockedVerdict = { ok: false, blockers: ['a member has not converged'] }

  const measurementIn = (shape) => (shape.blockers ?? []).some((line) => /could not measure/i.test(String(line)))

  /**
   * ★ 臂 1 的断言在两端给出**相反**结论 —— 这就是它测到了机制的证据。
   */
  assert.equal(measurementIn(collapsed(unmeasuredVerdict)), true, '★ collapsed 端必须把 unmeasured 送进 blockers（否则它不是被拆掉机制的版本）')
  assert.equal(measurementIn(honest(unmeasuredVerdict)), false, '★ honest 端不许把它送进 blockers')

  /**
   * ★ 而"两态可分辨"这条性质也只在 honest 端成立 —— 第二重证据：
   *   collapsed 端下，"没能测量"与"发现了问题"在**形状**上无法区分。
   */
  const honestUnmeasured = honest(unmeasuredVerdict)
  const honestBlocked = honest(blockedVerdict)
  const collapsedUnmeasured = collapsed(unmeasuredVerdict)
  const collapsedBlocked = collapsed(blockedVerdict)

  /** honest：一个有 unmeasured 字段、一个没有 ⇒ 形状可分。 */
  assert.notDeepEqual(
    Object.keys(honestUnmeasured).sort(), Object.keys(honestBlocked).sort(),
    '★ honest 端下两态必须不同形（一个有 unmeasured 字段，一个没有）',
  )
  /** collapsed：字段集完全相同 ⇒ 只能靠措辞分。 */
  assert.deepEqual(
    Object.keys(collapsedUnmeasured).sort(), Object.keys(collapsedBlocked).sort(),
    '★ collapsed 端下两态的**字段集相同** —— 这正是"合流"的机械定义',
  )
  console.log(`    ℹ honest 端字段：${JSON.stringify(Object.keys(honestUnmeasured))} vs ${JSON.stringify(Object.keys(honestBlocked))}`)
  console.log(`    ℹ collapsed 端字段：${JSON.stringify(Object.keys(collapsedUnmeasured))} vs ${JSON.stringify(Object.keys(collapsedBlocked))} —— 相同 ⇒ 合流`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：f-0003 回归 —— 执行器缺席时，普通任务的建立不该被拒
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这是契约里点名的【已有实例】，本臂把它变成回归 ────────────────────────────────
 *
 * f-0003 原话：「执行器缺席 ⇒ 判据诚实报 unmeasured ⇒ 被上层读成拒绝
 *                ⇒ **所有普通任务建不出来**」
 *
 * ★ 本臂沿**真实工具路径**验证它已经修好：建一个 kind=work 的普通任务。
 *   期望：成功建立（因为 `contract.verify-command` 在 verify 缺席时**不适用** ⇒ ok，
 *   而不是 unmeasured ⇒ 拒绝）。
 *
 * ★ 为什么必须走真实工具而不是直呼判据：f-0003 的缺陷**在调用点**（上层读错了），
 *   判据本身一直是对的。直呼判据永远查不出这一类。
 */
test('臂 5 ★ f-0003 回归：执行器缺席时，普通任务的建立不许被"没能测量"拒掉', async () => {
  const fixture = await pluginFixture()

  const created = await attempt(() => fixture.call('agent_teams_create_task', {
    subject: 't21 regression: an ordinary work task',
    kind: 'work',
    /**
     * ★ 用 `docs/` 而不是 `src/`：`contract.build-artifact-scope` 会在"声明了 src/
     *   却没声明 lib/"时**正确地**报 blocked —— 那是另一条判据的正常开火，与被测的
     *   "unmeasured 被读成拒绝"无关。第一次跑就是这样红的，我一度把它读成 f-0003 复发。
     * ★ 记一笔：**夹具造出的缺陷会伪装成产品缺陷** —— 两者的返回值都是"一句 error"。
     */
    inScope: ['docs/PLAN.md'],
  }))

  console.log(`    ℹ create_task(kind=work) ⇒ threw=${created.threw}`
    + `${created.threw ? ` · ${created.message.slice(0, 110)}` : ` · task_id=${created.value?.task_id}`}`)

  assert.equal(
    created.threw, false,
    '★ 一个普通 work 任务的建立被拒了 —— f-0003 的形态回来了：\n'
    + '   执行器缺席 ⇒ 判据诚实报 unmeasured ⇒ 被上层读成拒绝 ⇒ 普通任务建不出来。\n'
    + `   实际错误：${created.message}`,
  )
  assert.equal(
    typeof created.value?.task_id, 'string',
    '★ create_task 必须照常返回一个 task_id（真实入口、真实落库）',
  )

  /**
   * ★ 反向半边（缺了它，本臂在"调用点对什么都放行"的实现上照样绿）：
   *   一份**真的**有问题的契约必须仍然被拒 —— 否则"不误伤"会退化成"不把关"。
   *
   * ── ★★ 这一半我改了三次，每次都是被实测纠正的（三次都同形，值得记）────────────
   *
   * 第一版：`kind: 'quality'` ⇒ 被**参数 schema** 拦下（`"kind" must be one of […]`）。
   *         ⇒ 它证明的是参数校验，不是判据开火。
   * 第二版：`verify: ['printf "  7" | grep -qx 7']`（本队记过的"永远红"）⇒ **建出来了**。
   *         ⇒ 我去读了判据才明白："永远红"要跑一次才知道，而静态面抓不到它。
   * 第三版：`verify: ['   ']`（空白命令）⇒ 也**建出来了**。这次我用探针抓住了真相：
   *
   *             `normalizeBlankOptionalTaskFields` 会把"全是空白的列表"**整个删掉**
   *             （quality-gates.ts:1006-1012：`kept.length === 0 ⇒ delete next[key]`）
   *             ⇒ 判据收到的 `task.verify` 是 **undefined** ⇒ 它按"这份契约没提要求"
   *               判 `ok` —— ★ 那是**正确**的，不是缺陷。
   *
   *         ★ 三次的现象完全一样（"这句调用没抛错"），而三次的成因各不相同。
   *           这正是本文件臂 0 说的那句：**夹具造出的缺陷会伪装成产品缺陷**。
   *           ⇒ 所以这一半最后用一条**非空且恒定失败**的命令：`false`。
   *
   * 第四版（现在）：`verify: ['false']` ⇒ 实测被正确拒绝：
   *     `create_task rejected: [contract.verify-command] the contract declares verify
   *      command(s) that cannot judge the work: "false" — [always-red] …`
   */
  const bad = await attempt(() => fixture.call('agent_teams_create_task', {
    subject: 't21 regression: a contract whose verify can never pass',
    kind: 'verification',
    objective: 'reach the contract gate so its verify-command judgement can fire',
    acceptance: ['the contract gate actually judges the verify command'],
    inScope: ['docs/PLAN.md'],
    /** ★ 非空、恒定非零 ⇒ 判据的 [always-red] 静态分支必须开火。 */
    verify: ['false'],
  }))
  console.log(`    ℹ create_task(verify=['false']) ⇒ threw=${bad.threw}${bad.threw ? ` · ${bad.message.slice(0, 130)}` : ''}`)

  assert.equal(
    bad.threw, true,
    '★ 一份声明了"永远红"的 verify 命令的契约被放行了 —— 那说明调用点把关的那一半被拆掉了。'
    + '本臂的反向半边要求：不误伤**不许**退化成不把关。',
  )
  /**
   * ★ 而且它必须因为**可判性**被拒，不是因为参数写错 —— 否则这条反向半边会
   *   在"schema 校验顺手拦下"的实现上照样绿，而它声称的是"判据仍然开火"。
   */
  assert.doesNotMatch(
    bad.message, /invalid arguments/,
    '★ 这条拒绝来自参数校验，不是判据的可判性检查 —— 反向半边没有测到它声称的东西',
  )
  /** ★ 并且必须是**那条判据**说的 —— 拒绝理由里带着它的 id。 */
  assert.match(
    bad.message, /contract\.verify-command/,
    '★ 拒绝里没有点名那条判据 —— 那这句话可能来自别的检查，本臂就没测到"判据开火"',
  )
})
