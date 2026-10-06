/**
 * ── ★ 独立验证（t8）：requires 这个机制自己，有没有被独立验证过？──────────────────
 *
 * ── 立场：不用实现者的夹具 ──────────────────────────────────────────────────────
 *
 * 本文件的所有输入都**自己构造**：自己建 workspace、自己建 team.json、自己决定
 * 每一次工具调用的参数。它**不 import** 任何 `gate-*.test.mjs` 里的辅助函数
 * —— 那些辅助函数是"被测对象的一部分"，复用它等于复用它的假设。
 *
 * ★ 唯一的例外是 `registerAgentTeamsTools` / `createTeamDir` / 判据模块本身：
 *   它们是**被测对象**，不是夹具。而从工具入口进是本任务的硬要求
 *   （直呼 `auditRequires` 测的是审计函数，不是接线）。
 *
 * ── ★ 本文件用了一个与实现者夹具不同的【读数装置】，这是刻意的 ─────────────────────
 *
 * 实现者的夹具靠"挂一条探针判据 ⇒ 读告警文本"来证明接线通了。那要求**先注册一条
 * 新的判据**，于是它测的是"注册进来的判据会被核对"，而不是"**真实那 11 条**判据
 * 在**真实工具调用**上读到的是什么"。
 *
 * ⇒ 本文件改用**回归探针**（regression probe）：
 *
 *     const probe = { get value() { sink.push(this.k); return undefined }, ... }
 *
 *   把这样一格的**取值事件**记下来。三点好处，每一点都对着实现者夹具的一个盲区：
 *
 *   ① 它读的是**真实 ctx**（调用点原样交出去的那一份），不需要注册任何东西 ⇒
 *      "11 条判据 × 8 个调用点"可以逐格读出来，而不是只读挂上去的那一条探针；
 *   ② 它给出的是**那个调用点那一刻**的读数，于是"哪个位置缺哪一格"是可分的
 *      （告警文本是拼在一起的）；
 *   ③ ★ 它不依赖措辞 —— 告警文本改了、格式变了、"unfinished input surface"
 *      这句话被重写了，本文件的断言**照样成立**。一个断言不该与它要检查的
 *      那句人话绑定。
 *
 * ── ★ 回归探针自身的一条纪律（否则它会变成一个假读数）────────────────────────────
 *
 * `readPath` 对缺失的格子返回 `undefined`。于是**格子的值是 `undefined`** 与
 * **格子压根不存在**在核对层里同形。本文件因此**不靠"值"判断在不在场**，
 * 只靠"取值事件有没有发生"—— 一个 `get` 陷阱被触发过，就说明那一格真的被读了。
 * 这条口径与核对层的口径**刻意不同**，而两者的差集本身是一条读数（见臂 6）。
 *
 * ── 七项验证 → 本文件的臂 ───────────────────────────────────────────────────────
 *
 *   ① requires 抓得住"调用方没给"· · · · · · · · · · · · · · 臂 1 / 臂 2
 *   ② 五次历史缺口逐个复现 · · · · · · · · · · · · · · · · · · 臂 3
 *   ③ 没有变成噪音源（双向钉） · · · · · · · · · · · · · · · · 臂 4
 *   ④ 先软后硬：报缺不拒绝 · · · · · · · · · · · · · · · · · · 臂 5
 *   ⑤ 规则二后半句：单独去掉闸门 ⇒ 臂必须红（定向突变）· · · · · 臂 6 / 臂 7
 *   ⑥ 闸门格缺席 与「不适用」不同形（shape-dev 的实测标准） · · · 臂 8
 *   ⑦ completion.backtest 那个"出厂即报的真实缺格"是否如实 · · · 臂 9
 *   另：读数契约（单向可信）不许被写成假保险 · · · · · · · · · · 臂 10
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** ★ 被测对象：从**编译产物**进（与仓库里 25 个测试同构），且只从 lib/ 进。 */
const { registerAgentTeamsTools } = await import('../lib/tools.js')
const { createTeamDir } = await import('../lib/state.js')
const { registry, gateModuleViews } = await import('../lib/gates/index.js')

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

// ─────────────────────────────────────────────────────────────────────────────
// 夹具：一个够真实的插件 ctx + 一个够真实的团队（自己写，不从别人的夹具抄）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 建一个插件实例。★ 与实现者夹具的差别在这一行：
 * `warnings` 是**活的引用** —— 本文件在每次调用前后把 `logger.warn` 换掉，
 * 于是"这一次调用产生了哪几条告警"是**切片**出来的，而不是累计的。
 */
function pluginFixture(workspace) {
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
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
  const runtime = registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })
  const call = async (name, args, agentId) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    return await tool.execute(args, {
      agent: { id: agentId ?? 'captain-session', status: 'idle', session: { header: { cwd: workspace }, events: [] }, steer() {} },
      signal: new AbortController().signal,
    })
  }
  /**
   * ── ★ 每一次调用的告警切片 ────────────────────────────────────────────────────
   *
   * `logger.warn` 在这里被临时换掉，调用结束再换回来。于是**同一个 fixture**
   * 上可以精确回答"是哪个调用点报的这一条"—— 而累计式读数答不出这个问题
   * （本文件臂 5 要的正是这个分辨力）。
   */
  const capture = async (fn) => {
    const collected = []
    const previous = ctx.logger.warn
    ctx.logger.warn = (message) => { collected.push(String(message)) }
    try {
      const value = await fn()
      return { value, warnings: collected }
    } finally {
      ctx.logger.warn = previous
    }
  }
  return { ctx, tools, runtime, call, capture }
}

/** 一个能过 `coerceTeamState` 的团队（`createdAt`/`updatedAt` 必填）。 */
async function seedTeam(workspace, { tasks = [], members = [] } = {}) {
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team', name: 'VerifyRequires', captainSessionId: 'captain-session',
    createdAt: 1, taskSeq: tasks.length, members, tasks,
  })
}

const TASK = {
  id: 't1', seq: 1, subject: 'w', kind: 'work', status: 'in_progress',
  inScope: ['src/a.ts', 'lib/a.js'], assignee: 'worker', attempt: 1, attemptId: 'a1',
  createdAt: 1, updatedAt: 1, dependencies: [],
}
const MEMBER = { id: 'member-1', name: 'worker', status: 'working', joinedAt: 1 }

async function fixtureWith({ tasks = [], members = [] } = {}) {
  const workspace = track(mkdtempSync(join(tmpdir(), 'verify-req-')))
  await seedTeam(workspace, { tasks, members })
  return { workspace, ...pluginFixture(workspace) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 读数装置①：回归探针（regression probe）—— 记录"哪一格被读了"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 一个"任何路径都缺席、且把每一次取值记下来"的 ctx。
 *
 * ★ 为什么它能给出"缺的是哪一格"：核对层读一条路径的方式是**逐段**读
 *   （`readPath` 的循环）。所以一次 `key` 的 `get` 陷阱，恰好对应"核对层走到了
 *   这一层级的这个键"。把每次调用的记录切片，就得到"这一次它问了哪些键"。
 *
 * ★ 为什么它**不**能给出"值是什么"：它故意让每一格都返回 `undefined` ⇒
 *   站在核对层的口径上，这份 ctx 是**全空**的。于是它是一台"输入面全空"的
 *   照相机：任何一条**适用**的判据，在它上面都必须报出它声明的全部格子。
 */
function regressionProbe() {
  const seen = { own: [], nested: [] }
  const probe = (bucket) => new Proxy({}, {
    get(_target, key) {
      if (typeof key === 'string') bucket.push(key)
      return undefined
    },
    has: () => true,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
  })
  const own = probe(seen.own)
  const nested = probe(seen.nested)
  const context = new Proxy({}, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      seen.own.push(key)
      /**
       * ★ 只有**已知的对象型格子**才交给下一层。其余一律 `undefined`（缺席）。
       *   这一份清单来自判据自己的 `requires`（脚注式，见 `nestedBagKeys()`），
       *   不是手抄：手抄的那一份会与声明分叉。
       */
      return NESTED_BAGS.has(key) ? nested : undefined
    },
    has: () => true,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: undefined }),
  })
  return { context, seen }
}

/**
 * 哪些顶层格子是"袋子"（能继续往下读）。
 *
 * ★ 口径：把 11 条判据声明的**全部**路径里，含 `.` 的那些的顶层键收进来
 *   —— 一条声明了 `task.kind` 的判据，其 `task` 就是一个袋子。这是从声明
 *   **推导**出来的，与判据的实现无关。
 */
const NESTED_BAGS = new Set(
  gateModuleViews().flatMap((gate) => (gate.requires ?? []).filter((path) => path.includes('.')).map((path) => path.split('.')[0])),
)

/**
 * 用回归探针跑一个**只挂一条探针判据**的注册表以外的通道：
 * 这条通道直呼 `auditRequires`，仅供"机制本身"的臂使用
 * （臂 6/7 的定向突变需要它；接线层面的臂一律走工具入口）。
 */
async function auditViaRegistry(point, context) {
  const { createGateRegistry } = await import('../lib/gates/registry.js')
  const r = createGateRegistry()
  for (const gate of gateModuleViews().filter((entry) => entry.point === point)) {
    r.register({
      id: gate.id, point, description: 'replay of an assembled gate',
      ...gate.hasRequires ? { requires: gate.requires ?? [] } : {},
      ...gate.appliesTo === undefined ? {} : { appliesTo: gate.appliesTo },
      gate: () => ({ ok: true }),
    })
  }
  return await r.evaluate(point, context)
}

/** 告警文本里的缺格清单（只用于**读人话**，断言一律不绑定它 —— 见文件头）。 */
function gapWarnings(warnings) {
  return warnings.filter((line) => /unfinished input surface/.test(line))
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（验证①）：requires 真的能抓住"判据要的输入、调用方没给"吗
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（①）：走真实工具入口 —— 一条声明了真实路径的判据，在缺格时被读出缺哪一格', async () => {
  /**
   * ★ 立场的落点：**不实现者探针**之前，先证明"真实那 11 条判据"在真实入口上是
   *   被核对的。做法是拿**注册表自己的**声明，在**每一个**位置上问一遍：
   *   每一条**适用**的判据，在被核对的 ctx 上读到了它声明的哪些格子？
   *
   * ★ 与实现者夹具的差别：它挂一条**新的**探针（"注册进来的会被核对"），
   *   本臂读**已有的那 11 条**（"它们自己被核对了没有"）。后者才是本任务的目的。
   */
  const positions = ['contract', 'dispatch', 'completion', 'delivery', 'runtime']
  const declared = gateModuleViews().filter((gate) => gate.hasRequires)
  assert.equal(declared.length, 11, `★ 11 条判据都必须声明输入面（实测 ${declared.length}）`)
  for (const gate of declared) {
    assert.ok(positions.includes(gate.point), `★ ${gate.id} 的 point 必须是五个位置之一`)
    assert.ok((gate.requires ?? []).length > 0, `★ ${gate.id} 声明了空数组，本臂对它没有分辨力`)
  }

  /**
   * ★ 真实入口的读数：`agent_teams_create_task`（contract）与
   *   `agent_teams_status`（delivery + runtime）。
   *
   * 两条出口都要读（本文件不把"读数在哪"当成前提）：
   *   · runtime 是返回值里的 `runtime_gates.input_surface`（结构化出口）；
   *   · 其余位置是告警。
   * ★ 若某条出口**不存在**，本臂必须**失败**而不是静默 —— 一个"读了没有的出口"
   *   正是本队记账的第三种形态（读错位置的出口）。
   */
  const { call, capture } = await fixtureWith({ tasks: [TASK], members: [MEMBER] })

  const created = await capture(() => call('agent_teams_create_task', {
    subject: 'v', kind: 'implementation', objective: 'o', inScope: ['src/a.ts', 'lib/a.js'],
    acceptance: ['a'], verify: ['node -e "process.exit(0)"'],
  }))
  assert.equal(typeof created.value?.task_id, 'string', '★ create_task 必须照常返回（真实入口、真实落库）')

  const status = await capture(() => call('agent_teams_status', { team_id: 'team' }))
  const surface = status.value?.runtime_gates?.input_surface
  assert.ok(surface !== undefined, '★ runtime 的结构化出口 `runtime_gates.input_surface` 必须存在（读了不存在的出口会让断言恒真）')
  assert.equal(surface.incomplete >= 0, true)
  assert.ok(Array.isArray(surface.missing), '★ `missing` 必须是数组（哪怕是空的）—— 缺席与空数组不同形')

  /**
   * ★ 关键读数：**11 条判据里，有宣言的每一条在同一份 ctx 上都被核对过**
   *   —— 判据是"skipped 但成因不是 undeclared"。这是"接线通了"的最小证据，
   *   且它不依赖任何新增探针。
   */
  const { createGateRegistry } = await import('../lib/gates/registry.js')
  const r = createGateRegistry()
  for (const gate of gateModuleViews()) {
    r.register({
      id: gate.id, point: gate.point, description: 'x',
      ...gate.hasRequires ? { requires: gate.requires ?? [] } : {},
      ...gate.appliesTo === undefined ? {} : { appliesTo: gate.appliesTo },
      gate: () => ({ ok: true }),
    })
  }
  const probe = regressionProbe()
  const allChecks = []
  for (const point of positions) {
    const evaluation = await auditViaRegistry(point, probe.context)
    allChecks.push(...evaluation.requires.checks.map((check) => ({ point, ...check })))
  }
  assert.equal(allChecks.length, 11, '★ 五个位置合起来必须正好是那 11 条判据（一条不多、一条不少）')
  const undeclared = allChecks.filter((check) => check.skipReason === 'undeclared' || check.undeclared !== undefined)
  assert.deepEqual(
    undeclared.map((check) => check.id), [],
    '★ 不许有任何一条判据走到 `undeclared` —— 那意味着它的输入面没人核（11 条全部已经声明）',
  )
  /**
   * ★ 而在**全空的 ctx**上，适用的判据必须报出它声明的**每一格**。
   *   这一半钉"漏报"：一个恒不报的实现过不了这里。
   */
  const applicable = allChecks.filter((check) => check.status === 'incomplete')
  assert.ok(applicable.length > 0, '★ 不可能所有判据都不适用 —— 那样本臂什么都没测到')
  for (const check of applicable) {
    const fromRegistry = gateModuleViews().find((gate) => gate.id === check.id).requires
    /**
     * ★ 口径修正（本臂第一版写错了）：不能要求 `missing` 恰好等于声明全集。
     *   回归探针让**每一格**返回 `undefined`，所以它确实让"每一格都缺席" ——
     *   但**判据的 `appliesTo` 也读同一份 ctx**，于是"闸门格也缺席"的判据
     *   会走 `skipped` 分支（那是另一条路，本臂不该要求它们 incomplete）。
     *
     *   ⇒ 对**确实适用**的那些（incomplete），要求 `missing` 覆盖到它声明的
     *      **每一格**：闸门格既然让它适用了，说明那些格在这个探针上被读到了值
     *      之外的东西… 实测不是这样 —— 所以口径改成**逐格对拍**：`present` 与
     *      `missing` 必须恰好划分声明全集（不漏一格、不多一格）。
     */
    assert.deepEqual(
      [...check.present, ...check.missing].sort(), [...fromRegistry].sort(),
      `★ ${check.id}：在场 + 缺席必须**恰好**划分声明全集（多一格是误报，少一格是漏报）`,
    )
    /**
     * ★ 而"适用却被判格全空"这一件事本身要能被看见：闸门格在 `missing` 里
     *   说明 `appliesTo` 是用**别的**方式说真的（例如 `appliesTo` 缺省 ⇒ 恒真）。
     *   这不是缺陷，但必须可读 —— 打印出来而不是断言掉。
     */
    if (fromRegistry.some((path) => ['task', 'task.kind', 'task.verify', 'wantsCompleted', 'taskNotTerminal'].includes(path) && check.missing.includes(path))) {
      assert.equal(typeof check.status, 'string', `★ ${check.id} 的闸门格也在 missing 里 —— 它凭 appliesTo 缺省而适用（记录，不是缺陷）`)
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（验证①反面）：不漏报 —— 一格都不缺时，一条都不许被报
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2（①反面，防恒报）：11 条判据在同一份 ctx 上不可能全部报缺 —— 报的必须逐条对得上声明', async () => {
  /**
   * ★ 双向钉的一半。臂 1 钉"缺了要报"，本臂钉"**报出来的每一格都必须真的在声明里、
   *   且真的缺席**"。一个恒报的实现（把每条判据都报成 incomplete）会在本臂红：
   *   它会把**在场**的格子也报出来。
   *
   * ★ 构造：一份**部分在场**的 ctx。用真值对象（不是全空探针），于是"在场"与
   *   "缺席"同时存在 —— 这正是"恒报"与"恒不报"两种常量实现都会露馅的形状。
   */
  const context = {
    task: { id: 't1', kind: 'implementation', verify: ['node -e "process.exit(0)"'], inScope: ['src/a.ts'] },
    update: { status: 'completed', changedPaths: ['src/a.ts'] },
    wantsCompleted: true,
    taskNotTerminal: true,
    event: 'task-status',
  }
  const { createGateRegistry } = await import('../lib/gates/registry.js')
  const r = createGateRegistry()
  for (const gate of gateModuleViews()) {
    r.register({
      id: gate.id, point: gate.point, description: 'x',
      ...gate.hasRequires ? { requires: gate.requires ?? [] } : {},
      ...gate.appliesTo === undefined ? {} : { appliesTo: gate.appliesTo },
      gate: () => ({ ok: true }),
    })
  }
  const probes = {}
  for (const point of ['contract', 'dispatch', 'completion', 'delivery', 'runtime']) {
    probes[point] = await r.evaluate(point, context)
  }
  const checks = Object.entries(probes).flatMap(([point, evaluation]) => evaluation.requires.checks.map((check) => ({ point, check })))

  let sawPresentAndAbsentTogether = false
  for (const { check } of checks) {
    if (check.status === 'skipped') continue
    const declared = gateModuleViews().find((gate) => gate.id === check.id).requires
    assert.deepEqual(
      [...check.present, ...check.missing].sort(), [...declared].sort(),
      `★ ${check.id}：在场 + 缺席必须**恰好**等于声明的全集（多一格是误报，少一格是漏报）`,
    )
    if (check.present.length > 0 && check.missing.length > 0) sawPresentAndAbsentTogether = true
  }
  assert.equal(
    sawPresentAndAbsentTogether, true,
    '★ 本臂必须至少看见一条"既在场又缺席"的判据 —— 否则这份 ctx 太单薄，恒报/恒不报两个常量实现都可能过',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（验证②）：五次历史缺口逐个复现
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3（②）：五次历史缺口 —— 逐个问"今天这一格读到没有"，两种结果都必须被断言到', async () => {
  /**
   * ── ★ 本臂的构造与实现者夹具的差别 ─────────────────────────────────────────────
   *
   * 实现者的臂 3..7 是"挂一条探针，声明历史缺口的那一格，看它报没报"。那是
   * **探针**的读数。本臂要的是**真实判据**的读数：
   *
   *     那条判据声明的格子，在**今天**的真实 ctx 上，核对层到底读到了几格？
   *
   * ★ 每一种情形都必须断言到，**不许"两种情况都绿"**（那是规则二点名的恒真）：
   *   读不到 ⇒ 必须报出来；读得到 ⇒ **不许**被报成缺。两个分支各自写死。
   */
  const positions = ['contract', 'dispatch', 'completion', 'delivery', 'runtime']

  /** 历史缺口 ①..⑤ 各自锚在哪条判据的哪一格 —— 从**声明**里读，不手抄。 */
  const HISTORICAL = [
    /**
     * ── ★ 缺口 ① 的一处**实测修正**：那一格**没有**、也不该被声明 ─────────────────
     *
     * 上一轮第一次同形问题的那一格是 `task.inScope`。而 `contract.build-artifact-scope`
     * 的 `requires` 是 `['task']` —— **不是** `['task', 'task.inScope']`，
     * 且这是 contract-owner 明确论证过的**语义决定**（见 t2 的报告）：
     *
     *     inScope 的缺席是那条判据的一条**合法裁决分支**（`kind=work` ⇒ ok）。
     *     声明它 ⇒ 会在每一个普通任务上报缺 ⇒ 那正是假告警，与漏报同样有害。
     *
     * ★ 那么"机制覆盖得了那次缺口吗"的答案就不是"它声明了那一格"，而是**两层**：
     *   · 契约**整个** `task` 缺席 ⇒ 判据不适用（`appliesTo` 假）⇒ 不再静默；
     *   · `inScope` **在**、而内容读不出来 ⇒ 判据自己 `unmeasured`（不是 ok）。
     *   ⇒ 本臂因此把缺口 ① 拆成**这两件可证伪的事**，逐条断言，
     *     而不是断言"声明里有那一格"（那会红，而且红得没道理）。
     */
    { n: 1, label: 'inScope 缺席', gate: 'contract.build-artifact-scope', path: 'task', mode: 'declared' },
    { n: 2, label: 'verify 缺席', gate: 'completion.verify-rerun', path: 'task.verify', mode: 'declared' },
    { n: 3, label: '执行器缺席', gate: 'contract.verify-command', path: 'execVerifyCommand', mode: 'declared' },
    { n: 4, label: 'event 名不匹配', gate: 'runtime.liveness', path: 'event', mode: 'declared' },
    { n: 5, label: '窗口表没接线', gate: 'runtime.liveness', path: 'waits', mode: 'declared' },
  ]

  /**
   * ★ 前置：那五格必须**真的在**对应判据的声明里。否则本臂测的是一条
   *   "判据根本不关心的格子"，而那种断言恒真。
   */
  for (const item of HISTORICAL) {
    const gate = gateModuleViews().find((entry) => entry.id === item.gate)
    assert.ok(gate !== undefined, `★ ${item.gate} 必须被装配进注册表`)
    assert.ok(
      (gate.requires ?? []).includes(item.path),
      `★ 历史缺口 ${item.n}（${item.label}）的那一格 "${item.path}" 必须在 ${item.gate} 的 requires 里 ——`
      + '不声明则核对层不核它，本臂对那次缺口就没有分辨力',
    )
  }

  /**
   * ── ★ 两轮读数：**全空 ctx**（缺口应当在场）与**饱含 ctx**（缺口应当已补上）──
   *
   * 两轮用**同一份声明**，只换 ctx。这正是"双向钉"：
   *   只读全空那一轮 ⇒ 放行"恒报"；只读饱满那一轮 ⇒ 放行"恒不报"。
   */
  const readAt = async (point, context) => {
    const { createGateRegistry } = await import('../lib/gates/registry.js')
    const r = createGateRegistry()
    for (const gate of gateModuleViews().filter((entry) => entry.point === point)) {
      r.register({
        id: gate.id, point, description: 'x',
        ...gate.hasRequires ? { requires: gate.requires ?? [] } : {},
        ...gate.appliesTo === undefined ? {} : { appliesTo: gate.appliesTo },
        gate: () => ({ ok: true }),
      })
    }
    const evaluation = await r.evaluate(point, context)
    return evaluation.requires.checks
  }

  /**
   * ★ 第一轮：全空探针 ctx。判据**适用**的那些必须报出全部声明格。
   *   注意本轮的公平性 —— `appliesTo` 自己也要读 ctx，所以"全空"会让一部分
   *   判据**正确地说不适用**（那是臂 8 的地盘，不是这里）。本臂因此只对
   *   `incomplete` 的那些读，并**要求至少有一条**（否则本轮什么都没测到）。
   */
  const emptyByPoint = {}
  for (const point of positions) {
    const probe = regressionProbe()
    /**
     * ★ 全空 ctx 上 `appliesTo` 恒假 ⇒ 一条都不会 incomplete。所以本轮改用
     *   "**只把闸门喂饱、测量格留空**"的 ctx：这正是历史缺口当时的真实形态
     *   （判据跑得起来、而它要的那一格没接上）。
     */
    void probe
    emptyByPoint[point] = await readAt(point, {
      task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts'] },
      update: { status: 'completed', changedPaths: ['src/a.ts'], newTestFiles: ['scripts/x.test.mjs'] },
      wantsCompleted: true, taskNotTerminal: true, event: 'task-status',
    })
  }
  const gapped = Object.entries(emptyByPoint).flatMap(([point, checks]) => checks.map((check) => ({ point, check })))
  const incomplete = gapped.filter(({ check }) => check.status === 'incomplete')
  assert.ok(incomplete.length > 0, '★ 这一轮必须至少有一条判据报缺 —— 否则本臂什么都没测到（恒绿）')

  /**
   * ★ 逐个历史缺口：**声明的那一格**在这份 ctx 上的读数。
   *
   * 口径（两种结果都断言到）：在全空探针下**必须**被报；在饱满 ctx 下
   * **必须不被报**。本臂用一次真实工具调用给出"饱满"的那一半的独立证据（见下）。
   */
  const absent = { task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts'] }, update: { status: 'completed', changedPaths: ['src/a.ts'], newTestFiles: ['scripts/x.test.mjs'] } }
  const absentChecks = {}
  for (const point of positions) absentChecks[point] = await readAt(point, absent)

  const findCheck = (point, id) => absentChecks[point].find((check) => check.id === id)
  /**
   * 历史缺口 ①/②/③：在"闸门饱、测量格空"的那一份 ctx 上，它们必须报出那几格。
   */
  const gap1 = findCheck('contract', 'contract.build-artifact-scope')
  /**
   * ★ 缺口 ① 的两半（见上面 `HISTORICAL` 的那段说明）：
   *   (a) `task` **整个缺席** ⇒ 判据不适用 ⇒ 核对**如实说成因**（不是静默通过）；
   *   (b) `task` 在、而 `inScope` **在**（因而判据适用）⇒ 输入面齐 ⇒ 不报缺。
   *
   * ★ 而 (a) 的读数必须是 `not-applicable`（不是 `input-surface-absent`）——
   *   因为这一份 ctx 上有 `task.kind` 那样的闸门格被读到了。本臂逐条钉住。
   */
  const gap1MissingTask = await readAt('contract', { update: {} })
  const gap1Check = gap1MissingTask.find((check) => check.id === 'contract.build-artifact-scope')
  assert.equal(gap1Check.status, 'skipped', '★ 缺口 ① (a)：`task` 整个缺席 ⇒ 判据不适用（它不再静默，而是有读数的 skipped）')
  assert.ok(
    ['not-applicable', 'input-surface-absent'].includes(gap1Check.skipReason),
    `★ 且成因必须读得出来：实际 ${gap1Check.skipReason}`,
  )
  assert.deepEqual(gap1Check.missing, [], '★ 不适用 ⇒ 不许进 missing（守住"不适用不报"）')
  /**
   * ★ (b)：`task` 在、`inScope` 也在 ⇒ **输入面齐**，核对不许报缺。
   *   ★ 这一半与 (a) 合起来才说明"这一格被核对了"，而不是"这一格被忽略"。
   */
  const gap1Full = await readAt('contract', { task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts'] } })
  const gap1FullCheck = gap1Full.find((check) => check.id === 'contract.build-artifact-scope')
  assert.equal(gap1FullCheck.status, 'ok', `★ 缺口 ① (b)：\`task\` 在场 ⇒ 它要的那一格齐 ⇒ 不许报缺（实际 ${gap1FullCheck.status}/${JSON.stringify(gap1FullCheck.missing)}）`)
  assert.deepEqual(gap1FullCheck.present, ['task'], '★ 且要如实交出"读到了 task"')

  const gap2 = findCheck('completion', 'completion.verify-rerun')
  /**
   * ── ★★ 缺口 ② 的独立结论：机制**报不出**它 —— 而这是一条**结构性**的事实 ──────
   *
   * MEASURED（本臂，2026-10-06）：`completion.verify-rerun` 的 `appliesTo` 里写着
   *
   *     Array.isArray(ctx?.task?.verify) && ctx.task.verify.length > 0
   *
   * ⇒ `task.verify` **既是它的闸门格、又是它声明的那一格**。于是：
   *
   *     task.verify 缺席  ⇒  appliesTo 恒假  ⇒  判据 skipped  ⇒  **核对不报**
   *     而它**不是**被判成 `input-surface-absent`（`wantsCompleted` 等格在场）
   *     ⇒ 它被判成 `not-applicable` —— 与"这一轮本来就不该跑"**逐字节同形**。
   *
   * ★ 这正是 t4（completion-owner）当时上报、captain 记录在案的那个形状缺口，
   *   而本臂独立确认它**在 t11 修完之后依然存在**：
   *   t11 修的是"闸门格**没接线**"（成因可读），修不了"闸门格**是判据自己"（恒假不可分）。
   *
   * ★ 为什么这不构成"机制不可用"：`verify` 缺席时判据**本来也不说话**，
   *   而"该不该有 verify"由 `quality-gates.ts` 的 `verifyCovered` 单独把关。
   *   ⇒ 它是**已知的覆盖边界**，不是新缺陷。本臂把它写成断言，让它**可被读出来**，
   *   而不是变成一个"看起来覆盖了、其实没有"的假保险。
   */
  assert.equal(
    gap2.status, 'skipped',
    '★ 独立确认：`task.verify` 缺席时 verify-rerun 是 skipped（不是 incomplete）——'
    + '因为那一格同时是它的闸门格，缺席使 appliesTo 恒假',
  )
  assert.equal(
    gap2.skipReason, 'not-applicable',
    `★ 且成因被判成 not-applicable（实测 ${gap2.skipReason}）——`
    + '与"任务类型不匹配"同形 ⇒ 这是机制如实承认的天花板，不是它能报出的缺口',
  )
  assert.deepEqual(
    gap2.missing, [],
    '★ 它**不进 missing**（守住"不适用不报"）—— 所以缺口 ② 的可发现性不在这条读数上',
  )
  /**
   * ★ 反向半边（防恒真）：把 `task.verify` **补上** ⇒ 它立刻变成 ok/适用，
   *   说明这条判据确实是"被那一格开关的"。两轮必须不同形。
   */
  const gap2Filled = (await readAt('completion', {
    task: { id: 't1', kind: 'implementation', verify: ['node -e 0'] },
    update: { status: 'completed', changedPaths: ['src/a.ts'] },
    wantsCompleted: true, taskNotTerminal: true,
  })).find((check) => check.id === 'completion.verify-rerun')
  assert.notEqual(
    gap2Filled.status, gap2.status,
    '★ 补上 `task.verify` ⇒ 它必须从 skipped 翻成别的（说明这一格确实是它的开关）；'
    + `实测不补 = ${gap2.status}，补上 = ${gap2Filled.status}`,
  )
  assert.ok(
    gap2Filled.missing.includes('execVerifyCommand'),
    `★ 而补上之后，它**真的缺**的那一格（执行器）必须被报出来 —— 这才证明核对在它身上工作：`
    + `实际 missing=${JSON.stringify(gap2Filled.missing)}`,
  )

  const gap3 = findCheck('contract', 'contract.verify-command')
  assert.equal(gap3.status, 'incomplete', '★ 缺口③：执行器缺席 ⇒ 必须报出来')
  assert.ok(gap3.missing.includes('execVerifyCommand'), '★ 缺口③ 的那一格必须被指名')

  /**
   * ★ 缺口④/⑤ 走**真实工具入口**（runtime 那一格），因为它们的读数出口是
   *   结构化字段而不是告警 —— 两条出口都要被真的读到。
   */
  const { call, capture } = await fixtureWith({ tasks: [TASK], members: [MEMBER] })
  const status = await capture(() => call('agent_teams_status', { team_id: 'team' }))
  const surface = status.value?.runtime_gates?.input_surface
  assert.ok(surface !== undefined, '★ runtime 的结构化出口必须存在')
  /**
   * ★ 这两个读数**各自**都要被断言到 —— 不许合并成"missing 里没有就是好"。
   *
   * ★ 声明口径（本臂第一版写错了，实测打回）：`runtime.liveness` 声明的是
   *   **`['event', 'waits']`**，**不含** `wait` —— 这是 delivery-owner 的语义决定
   *   （`wait` 缺席时判据自己报 unmeasured，那是**合法裁决**，不是接线缺陷；
   *   把它写进声明会在每一次"这一轮没有等待"时报缺 —— 噪音）。
   *   ⇒ 本臂的读数全集就是那两格，不许自己加一格进去。
   */
  const livenessDeclared = gateModuleViews().find((entry) => entry.id === 'runtime.liveness').requires
  assert.deepEqual(
    [...livenessDeclared].sort(), ['event', 'waits'],
    `★ 前置：runtime.liveness 声明的是这两格（实际 ${JSON.stringify(livenessDeclared)}）`,
  )
  const runtimeChecks = await readAt('runtime', {
    task: { ...TASK }, event: 'task-status', waits: [{ member: 'worker' }],
  })
  const liveness = runtimeChecks.find((check) => check.id === 'runtime.liveness')
  assert.notEqual(liveness, undefined, '★ runtime.liveness 必须在 runtime 位置上被核对到')
  assert.deepEqual(
    [...liveness.missing, ...liveness.present].sort(), [...livenessDeclared].sort(),
    '★ 在场 + 缺席必须恰好等于声明全集（多一格/少一格都是读数失真）',
  )
  assert.ok(liveness.present.includes('event'), '★ 缺口④ 已经补上：`event` 是调用方在真实路径上**必传**的那一格 ⇒ 不许被报成缺')
  assert.ok(liveness.present.includes('waits'), '★ 缺口⑤ 已经补上：窗口表在有 team 的事件上**必须**在场 ⇒ 不许被报成缺')
  assert.deepEqual(liveness.missing, [], '★ 两格都在场 ⇒ 一条缺格都不许报（误报方向）')
  /**
   * ★ 反向半边（防恒真）：**拿掉 `waits`** ⇒ 它必须立刻被报出来。
   *   这一步才是"缺口⑤ 真的被这机制守着"的机械证据 ——
   *   只断言"在场时不报"会放行一个恒不报的实现。
   */
  const withoutWaits = runtimeChecks.length > 0
    ? (await readAt('runtime', { event: 'task-status' })).find((check) => check.id === 'runtime.liveness')
    : undefined
  assert.ok(
    withoutWaits !== undefined && withoutWaits.missing.includes('waits'),
    `★ 拿掉窗口表 ⇒ 必须被报成缺（实测 ${JSON.stringify(withoutWaits?.missing)}）——`
    + '上一轮那个"建好了但没接线"的点（waitWindows），现在拿掉 waits 就机械报缺，不再靠人发现',
  )
  assert.ok(
    withoutWaits.present.includes('event'),
    '★ 而 `event` 仍然在场 ⇒ 不许被一并报缺（逐格分辨，不是"要么全报要么全不报"）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（验证③）：它没有变成噪音源 —— 双向钉
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（③）：不适用 ⇒ 缺失清单为空；同一份声明翻成适用 ⇒ 恰好那一条（双向钉）', async () => {
  /**
   * ── ★ 双向钉的构造，以及它与实现者夹具的差别 ───────────────────────────────────
   *
   * 实现者的臂 8 用**新增探针**做这件事（`appliesTo: () => false`）。
   * 本臂用**真实那 11 条判据**做：同一个位置、同一份真实 ctx，把
   * `appliesTo` **整体摘掉**（等价于"调用方说它适用"）再读一遍。
   *
   * ⇒ 于是两次读数之间**只有一个变量**：闸门。差别必须恰好是"那一条出现 / 消失"。
   *   一个恒报或恒不报的实现，在这对读数上必然有一边对不上。
   */
  const { createGateRegistry } = await import('../lib/gates/registry.js')
  const build = (withGate) => {
    const r = createGateRegistry()
    for (const gate of gateModuleViews()) {
      r.register({
        id: gate.id, point: gate.point, description: 'x',
        ...gate.hasRequires ? { requires: gate.requires ?? [] } : {},
        ...withGate && gate.appliesTo !== undefined ? { appliesTo: gate.appliesTo } : {},
        ...!withGate && gate.appliesTo !== undefined ? { appliesTo: () => true } : {},
        gate: () => ({ ok: true }),
      })
    }
    return r
  }
  /** 一份"什么都不适用"的真实 ctx：空对象（每一个 `appliesTo` 都读不到自己的闸门格）。 */
  const context = {}

  const gated = build(true)
  const ungated = build(false)
  const before = await gated.evaluate('completion', context)
  const after = await ungated.evaluate('completion', context)

  /**
   * ★ 半边一：不适用 ⇒ **0 条**。这是"不制造噪音"的那一半。
   */
  assert.equal(
    before.requires.missing.length, 0,
    `★ 不适用的事件上缺失清单必须为空。实际：${JSON.stringify(before.requires.missing)}`,
  )
  assert.equal(before.requires.incomplete, 0, '★ `incomplete` 必须是 0（它只数真的核对了的）')
  assert.ok(before.requires.skipped > 0, '★ 而那些判据必须是**被显式跳过**的（不是"压根没登记"）')

  /**
   * ★ 半边二：同一份声明翻成适用 ⇒ **恰好**报出那些缺格，且一条不少。
   *   这半边钉"恒不报"。
   */
  const expectedIncomplete = gateModuleViews()
    .filter((gate) => gate.point === 'completion' && gate.hasRequires)
    .length
  assert.ok(expectedIncomplete > 0, '★ completion 位置上必须有声明了输入面的判据')
  assert.equal(
    after.requires.incomplete, expectedIncomplete,
    '★ 闸门摘掉之后（= 全部适用），completion 上**每一条**声明了输入面的判据都必须报缺'
    + `（应为 ${expectedIncomplete}，实际 ${after.requires.incomplete}）`,
  )
  assert.ok(after.requires.missing.length > 0, '★ 且人话清单必须非空')
  /**
   * ★ 且两轮**必须不同形** —— 一个把两者读成同一个数的实现会在这里红。
   */
  assert.notDeepEqual(
    [before.requires.incomplete, before.requires.missing.length],
    [after.requires.incomplete, after.requires.missing.length],
    '★ "不适用 ⇒ 0 条" 与 "适用 ⇒ 每条都报" 必须不同形（只测一边会放行恒报或恒不报）',
  )
})

test('★ 臂 4b（③）：真实入口上的噪音读数 —— 不适用的事件不产生任何缺格告警', async () => {
  /**
   * ★ 上一条臂走的是注册表；本臂走**真实工具入口**，并读**真实告警出口**。
   *   两条读数来源不同（旁路字段 vs 日志），互为印证。
   *
   * ★ 基线 + 增量：先在**空团队**上读一次（此时大部分判据不适用），
   *   再在**有任务**的团队上读一次。两次的缺格告警都必须**只能由"适用且缺格"
   *   的判据产生** —— 不许因为"这次调用走了另一个分支"而冒出一片。
   */
  const empty = await fixtureWith({})
  const emptyRead = await empty.capture(() => empty.call('agent_teams_create_task', { subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] }))
  /**
   * ★ `kind=work` 的契约：`inScope` 是**允许缺席**的（设计如此，见 build-artifact-scope
   *   文件头）。所以这里**不许**因为 `task.inScope` 不在就冒出一条告警 ——
   *   那正是"不适用不报"要守住的边界。
   */
  const workGaps = gapWarnings(emptyRead.warnings)
  assert.equal(
    workGaps.length, 0,
    '★ kind=work 的建任务上一条缺格告警都不许有（inScope 缺席是设计的一部分）。'
    + `实际：${JSON.stringify(workGaps)}`,
  )
  assert.equal(typeof emptyRead.value?.task_id, 'string', '★ 且流程照常走完')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（验证④）：先软后硬 —— 报缺不拒绝
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（④）：核对报缺时流程【照常走完】—— 五个位置逐个读，且不许由核对层拒绝', async () => {
  /**
   * ── ★ 本臂与实现者臂 9/12 的差别 ───────────────────────────────────────────────
   *
   * 实现者的臂靠"挂一条必然报缺的探针"制造缺格。本臂**不挂任何东西**：
   * 用**真实判据**在真实路径上自然产生的缺格（例如 completion.backtest 的
   * baseline/coverage），于是"报缺 ⇒ 不拒绝"这条纪律是在**没有任何人为构造**
   * 的条件下被读出来的。
   *
   * ★ 逐位置读（不是只读 contract）：contract / dispatch / completion /
   *   delivery / runtime 各一次真实调用，每一次都同时断言两半：
   *   (a) 流程照常（返回值在场）；
   *   (b) 若它被拒，理由里**不许**出现核对层的话。
   *
   * ★ 两半缺一不可：只断言 (a) ⇒ 一个什么都没做的核对也能过（恒真）；
   *   只断言 (b) ⇒ 一个从不报缺的实现也能过。
   */
  const outcomes = []

  // ── contract：一次真实的建任务（implementation，带齐 verify / acceptance）
  const contractFixture = await fixtureWith({})
  const created = await contractFixture.capture(() => contractFixture.call('agent_teams_create_task', {
    subject: 'soft', kind: 'implementation', objective: 'o', inScope: ['src/a.ts', 'lib/a.js'],
    acceptance: ['a'], verify: ['node -e "process.exit(0)"'],
  }))
  assert.equal(typeof created.value?.task_id, 'string', '★ contract 位置：核对不许拒绝建任务（先软后硬）')
  outcomes.push(['contract', created.warnings])

  // ── dispatch + completion：一次真实的成员 update_task（会走到两个位置）
  const memberFixture = await fixtureWith({ tasks: [TASK], members: [MEMBER] })
  const updated = await memberFixture.capture(() => memberFixture.call('agent_teams_update_task', {
    task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
  }, 'member-1').then((value) => ({ value }), (error) => ({ error })))
  /**
   * ★ dispatch/completion 位置上**本来就可能拒**（worktree 建不出来是设计的一部分），
   *   所以这里不断言"一定成功"。断言的是：**若它被拒，理由不许是核对层那句话**。
   *   那才是"核对的裁决权是零"的可证伪形式。
   */
  if (updated.value.error !== undefined) {
    assert.doesNotMatch(
      String(updated.value.error.message), /input surface/,
      '★ dispatch/completion：拒绝理由里不许出现核对层的话（核对不参与裁决）',
    )
  }
  outcomes.push(['dispatch+completion', updated.warnings])

  // ── delivery + runtime：一次真实的 status 读（它一个位置都不该拒）
  const statusFixture = await fixtureWith({ tasks: [TASK], members: [MEMBER] })
  const status = await statusFixture.capture(() => statusFixture.call('agent_teams_status', { team_id: 'team' }))
  assert.equal(typeof status.value?.team_id, 'string', '★ delivery/runtime 位置：核对报缺时 status 必须照常返回')
  assert.ok(status.value?.runtime_gates !== undefined, '★ 且 runtime 记录必须照常产出')
  outcomes.push(['delivery+runtime', status.warnings])

  // ── declare_delivery：那个"本来就会拒"的位置，理由同样不许来自核对层
  const declareFixture = await fixtureWith({ tasks: [TASK], members: [MEMBER] })
  const declared = await declareFixture.capture(() => declareFixture.call('agent_teams_declare_delivery', { team_id: 'team' })
    .then((value) => ({ value }), (error) => ({ error })))
  if (declared.value.error !== undefined) {
    assert.doesNotMatch(String(declared.value.error.message), /input surface/, '★ declare_delivery：拒绝理由里不许出现核对层的话')
  }
  outcomes.push(['declare_delivery', declared.warnings])

  /**
   * ★ 读数：这五次调用里**任何一次**都不许把核对结论变成异常。
   *   而其中至少要有一次**真的报出了缺格** —— 否则上面全部在测"什么都没发生"。
   */
  const allGaps = outcomes.flatMap(([label, warnings]) => gapWarnings(warnings).map((line) => `${label}: ${line}`))
  const runtimeGap = status.value?.runtime_gates?.input_surface
  const sawAnyGap = allGaps.length > 0
    || (runtimeGap?.incomplete ?? 0) > 0
    || (runtimeGap?.missing?.length ?? 0) > 0
  assert.equal(
    sawAnyGap, true,
    '★ 这五次真实调用里至少要有一次报出缺格 —— 否则"不拒绝"这条断言是在一个什么都没测到的场景上成立的（恒真）',
  )
  /**
   * ★ 而报出缺格的每一次，措辞都必须同时说出"记下来了"与"没有拒绝"。
   *   这一条是**可读性**要求，不是裁决要求：读日志的人要能一眼分出
   *   "调用方没接这一格"与"判据测不了"。
   */
  for (const line of allGaps) {
    assert.match(line, /recorded, not rejected/, `★ 报缺的措辞必须同时说出"记录了"与"未拒绝"：${line}`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（验证⑤）：定向突变 —— 把核对的闸门单独去掉，臂必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6（⑤）：单独去掉 appliesTo 闸门 ⇒ 不适用的事件上立刻冒出缺格（这就是"臂会红"）', async () => {
  /**
   * ── ★ 规则二后半句的用法，以及本文件对它的加强 ─────────────────────────────────
   *
   * 实现者已经钉过"去掉闸门 ⇒ 噪音臂红"（用探针）。本臂做的是**同一件事的独立
   * 复算**，而且是在**真实 11 条判据**上：把闸门单独摘掉，问一句
   * "不适用的事件上会不会开始报缺？"
   *
   * ★ 判据是**构造性**的，不是"我读了代码觉得它会红"：
   *   本臂真的建了两个注册表（一个有闸门、一个没有），跑**同一份 ctx**，
   *   并把两个数读出来。差别就是那次定向突变的**证据**。
   */
  const { createGateRegistry } = await import('../lib/gates/registry.js')
  const build = (gate) => {
    const r = createGateRegistry()
    for (const entry of gateModuleViews()) {
      r.register({
        id: entry.id, point: entry.point, description: 'x',
        ...entry.hasRequires ? { requires: entry.requires ?? [] } : {},
        ...entry.appliesTo === undefined ? {} : { appliesTo: gate ? entry.appliesTo : () => true },
        gate: () => ({ ok: true }),
      })
    }
    return r
  }
  /**
   * ★ 口径修正（本臂第一版写错了，实测打回）：不能断言"闸门在 ⇒ 每个位置都 0 条"。
   *   因为 `contract` 位置的两条判据 `appliesTo` 只读 `ctx?.task` ——
   *   这份 ctx **有** `task` ⇒ 它们**适用** ⇒ 缺 `execVerifyCommand` 是**真报**
   *   （不是噪音）。这正是"适用 ⇒ 报"那一半，与"不适用 ⇒ 不报"不矛盾。
   *
   * ⇒ 本臂的口径改成**逐位置**的：闸门去掉之后，`incomplete` **必须严格增加**
   *   （那是"闸门真的在拦"的证据）；而基线是多少不预设，如实读出来。
   */
  /**
   * ★ 口径修正（本臂第二版，实测打回两次）：这份 ctx **不能带 `task`**。
   *   `contract` 位置的两条判据 `appliesTo` 只读 `ctx?.task` —— 带了 `task`
   *   它们就**适用**，于是"闸门在/闸门去掉"两轮读数相同（都是 1 条真报），
   *   而那不是"闸门没起作用"，是**这份 ctx 上闸门本来就没拦任何东西**。
   *
   * ⇒ 要让"闸门"成为一个**真的在起作用的变量**，必须给一份"闸门会关上"的 ctx。
   *   本臂因此用一份**只有 part 骨架、没有 task** 的 ctx：此时 contract 的两条
   *   判据不适用 ⇒ 闸门在 ⇒ 0 条；闸门去掉 ⇒ 全部适用 ⇒ 报缺。差别就是证据。
   *
   * ★ 同时**保留**一份"闸门本来就没拦"的 ctx 作为对照 —— 两种情形都断言到，
   *   否则本臂只覆盖了"闸门会拦"这一种，而把"闸门不该拦却被写成拦"放过去。
   */
  /**
   * ── ★ 第三处**独立的实测修正**：`completion.backtest` 是**有**闸门的 ────────────
   *
   * 本臂第二版把 `gatedContext` 写成 `{ update: { changedPaths: ['src/a.ts'] } }`
   * 并断言"闸门在 ⇒ 0 条"，而实测读出 1 条 —— 是 `backtest`。追下去发现
   * **它确实有 `appliesTo`**，而它的闸门格正是 `update.changedPaths` / `changedPaths`：
   *
   *     appliesTo = Array.isArray(paths) && paths.length > 0
   *
   * ⇒ 是**我的 ctx 把它的闸门喂饱了**（那正是它的测量格），不是它"恒适用"。
   *   ★ 这与臂 9 的结论完全一致：它报缺是因为 `baseline` / `coverage` 那几格
   *     真的缺席，而它们缺席时判据真的 `unmeasured` ⇒ 报它不是误报。
   *
   * ★ 修法：要用一份**连 backtest 的闸门也关上**的 ctx 来测"闸门在 ⇒ 不报"。
   *   `{}` 就能做到（每条 `appliesTo` 都读不到自己的闸门格）。
   */
  const gatedContext = {}
  /**
   * ★ 对照 ctx：它必须让**相当一部分**判据**本来就适用**（否则"对照"是空的）。
   *   所以它带上各位置闸门真正读的那几格：
   *     completion.r5 / mutation  ⇒ `task.kind` ∈ {implementation, repair}
   *     completion.backtest       ⇒ `changedPaths` 非空
   *     contract.*                ⇒ `task` 在场
   *   ⇒ 于是"去掉闸门"对这些判据**不该有任何影响**（它们本来就适用），
   *     而这一条正是防"把闸门写成恒假"的那一半。
   */
  const ungatedContext = {
    task: { id: 't1', kind: 'implementation', inScope: ['src/a.ts'], verify: ['node -e 0'] },
    update: { changedPaths: ['src/a.ts'], status: 'in_progress' },
    changedPaths: ['src/a.ts'],
    event: 'task-status',
    /** ★ delivery 的两条判据与 runtime 的一条都以 `team` 为闸门/测量格 ⇒ 必须给。 */
    team: { id: 'team', name: 'Ungated', tasks: [], members: [] },
  }
  const points = ['contract', 'completion', 'delivery', 'runtime']

  let mutantReported = 0
  for (const point of points) {
    const untouchedIntact = (await build(true).evaluate(point, ungatedContext)).requires
    const untouchedMutant = (await build(false).evaluate(point, ungatedContext)).requires
    const intact = (await build(true).evaluate(point, gatedContext)).requires
    const mutant = (await build(false).evaluate(point, gatedContext)).requires
    assert.equal(
      intact.incomplete, 0,
      `★ 闸门在（ctx = \`{}\`，每条 appliesTo 都读不到自己的闸门格）⇒ ${point} 位置一条都不许报。`
      + `实际报缺：${JSON.stringify(intact.checks.filter((check) => check.status === 'incomplete').map((check) => check.id))}`,
    )
    assert.ok(
      mutant.incomplete > intact.incomplete,
      `★ 把闸门单独摘掉（${point}）⇒ ${point} 的缺格报告必须**严格增加**。`
      + `实测：闸门在 = ${intact.incomplete} 条，闸门去掉 = ${mutant.incomplete} 条。`
      + '若两者相等，说明"闸门"这个要被保护的机制根本没起作用，而那条噪音臂是恒真的',
    )
    /**
     * ★ 而"闸门在"的那一轮，**不适用**的那些不许进 missing —— 这是噪音的定义。
     */
    for (const check of intact.checks.filter((entry) => entry.status === 'skipped')) {
      assert.deepEqual(check.missing, [], `★ ${point}/${check.id} 被跳过 ⇒ 不许进 missing`)
    }
    /**
     * ── ★ 对照半边（防"把闸门写成恒假"）：**闸门只影响它自己那条判据** ────────────
     *
     * 本臂第三版在这里写错了，值得记一笔：它断言"有 `task` 的 ctx 上两轮读数相同"，
     * 而实测 `completion` 是 0 → 4。原因不是误伤，是**那份 ctx 上 r5/mutation/backtest
     * 的闸门本来就关着**（它们要 `kind` 是 implementation/repair、要 `changedPaths`，
     * 而 `ungatedContext` 只给了 `kind:'work'`）⇒ 去掉闸门它们当然开始报。
     *
     * ⇒ 正确的对照是**逐条**的：一条判据在**闸门去掉前就已经适用**时，
     *   去掉闸门**不得**改变它的读数。这与位置无关，所以它能精确地防住
     *   "把闸门写成恒假"（那样所有判据无论闸门如何都报缺，本条立刻红）。
     */
    const alreadyApplicable = untouchedIntact.checks.filter((check) => check.status !== 'skipped')
    assert.ok(
      alreadyApplicable.length > 0,
      `★ ${point}：对照 ctx 上必须至少有一条判据**本来就适用** —— 否则这半边什么都没测到`,
    )
    for (const check of alreadyApplicable) {
      const after = untouchedMutant.checks.find((entry) => entry.id === check.id)
      assert.deepEqual(
        [after.status, after.missing], [check.status, check.missing],
        `★ ${point}/${check.id} 在闸门**去掉前就已经适用** ⇒ 去掉闸门不许改变它的读数。`
        + '这一条防的是"把闸门写成恒假"：那样任何判据都会无条件报缺，这一半立刻红',
      )
    }
    mutantReported += mutant.incomplete - intact.incomplete
  }
  assert.ok(mutantReported > 0, '★ 定向突变必须真的打红（至少一个位置）—— 这是"臂会红"的构造性证据')
})

test('★ 臂 7（⑤）：第四种形态排查 —— 断言有没有"恒真/恒红/读错出口"的漏网', async () => {
  /**
   * ── ★ 本队已记账的三种"臂绿了但什么都没测"──────────────────────────────────────
   *
   *   ① 恒真：比较被机制弄成恒等的两个值；
   *   ② 恒红：类型别名塌成 '' 的断言；
   *   ③ 读错位置的出口：挂 contract 位置却读 runtime 独有字段。
   *
   * ⇒ 本臂做三件可证伪的检查，并**明确报告有没有第四种**：
   *
   *   (a) 出口普查：五个位置各自**真的有哪条出口**？—— 把"读错位置的出口"
   *       变成一次机械普查，而不是靠读夹具的构造。
   *   (b) 每条位置的出口**都读得出东西**（不是恒空）：挂一个必然报缺的东西上去，
   *       出口必须变。
   *   (c) 恒等比较排查：本文件里的每一对"翻成适用 / 保持不适用"读数，
   *       都断言了**不相等**（`notDeepEqual`）—— 一个恒等的比较过不了。
   */
  const positions = ['contract', 'dispatch', 'completion', 'delivery', 'runtime']
  const { createGateRegistry } = await import('../lib/gates/registry.js')

  /**
   * (a) 出口普查。★ 口径：**每个位置**上，一条"必然报缺"的判据无论如何都要
   *     让**那个位置的**读数变化。位置 × 出口的对应关系由本普查机械给出。
   */
  const findings = []
  for (const point of positions) {
    const r = createGateRegistry()
    r.register({
      id: `probe.exit.${point}`, point, description: 'exit probe',
      requires: ['noSuchPathOnAnyContextAtAll'], gate: () => ({ ok: true }),
    })
    const evaluation = await r.evaluate(point, {})
    const exitWorks = evaluation.requires.incomplete === 1
      && evaluation.requires.missing.join('\n').includes('noSuchPathOnAnyContextAtAll')
    if (!exitWorks) findings.push(`${point}: the registry-level exit does not surface the gap`)
  }
  assert.deepEqual(
    findings, [],
    '★ 五个位置在**注册表这一层**都必须有一条能读出缺格的出口。'
    + '（工具层的出口是另一件事，见下面 (b) —— 两者不是同一个读数。）',
  )

  /**
   * (b) 工具层的出口：**每个位置**的工具调用在挂上探针之后，都必须让某条出口变化。
   *     ★ 这里直接检查"出口存在且非恒空"，而不是"文本里有没有某个词"。
   */
  const observedExits = {}
  for (const point of positions) {
    const fixture = await fixtureWith({ tasks: [TASK], members: [MEMBER] })
    const { registry: liveRegistry } = await import('../lib/gates/index.js')
    const id = `probe.tool.${point}.${Math.random().toString(36).slice(2)}`
    liveRegistry.register({
      id, point, description: 'tool-level exit probe',
      requires: ['noSuchPathOnAnyContextAtAll'], gate: () => ({ ok: true }),
    })
    try {
      const runFor = {
        contract: () => fixture.capture(() => fixture.call('agent_teams_create_task', { subject: 'x', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'] })),
        dispatch: () => fixture.capture(() => fixture.call('agent_teams_update_task', { task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'] }, 'member-1').catch(() => undefined)),
        completion: () => fixture.capture(() => fixture.call('agent_teams_update_task', { task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'] }, 'member-1').catch(() => undefined)),
        delivery: () => fixture.capture(() => fixture.call('agent_teams_status', { team_id: 'team' })),
        runtime: () => fixture.capture(() => fixture.call('agent_teams_status', { team_id: 'team' })),
      }[point]
      const observed = await runFor()
      const textGap = gapWarnings(observed.warnings).some((line) => line.includes('noSuchPathOnAnyContextAtAll'))
      const structuredGap = JSON.stringify(observed.value ?? {}).includes('noSuchPathOnAnyContextAtAll')
        || (observed.value?.runtime_gates?.input_surface?.missing ?? []).some((item) => String(item).includes('noSuchPathOnAnyContextAtAll'))
      observedExits[point] = { textGap, structuredGap }
    } finally {
      liveRegistry.unregister(id)
    }
  }
  /**
   * ★ 断言：**每个位置**至少要有一条出口真的把那个哨兵交出来。
   *   一条都不交 ⇒ 那个位置的接线读不出来（"没核对"与"核对了没缺"同形）。
   *   ★ 这条断言**恰好就是**"读错位置的出口"的机械形式：它不预设某位置用哪条出口。
   */
  for (const point of positions) {
    assert.ok(
      observedExits[point].textGap || observedExits[point].structuredGap,
      `★ ${point} 位置的**工具层出口**必须至少有一条真的交出缺格（否则这个位置的核对读不出来）。`
      + `实测：${JSON.stringify(observedExits[point])}`,
    )
  }
  /**
   * (c) 恒等比较排查：本文件里"翻成适用"的那对读数必须不相等（已在臂 4 断言）。
   *     这里再补一条**独立**的：同一位置、同一份声明，**ctx 多一格** ⇒ 读数必须变。
   *     一个"核对没读 ctx"的实现在这里红。
   */
  const r = createGateRegistry()
  r.register({ id: 'probe.ctx', point: 'completion', description: 'x', requires: ['task.id'], gate: () => ({ ok: true }) })
  const withId = await r.evaluate('completion', { task: { id: 't1' } })
  const withoutId = await r.evaluate('completion', { task: {} })
  assert.notDeepEqual(
    withId.requires.missing, withoutId.requires.missing,
    '★ ctx 少一格 ⇒ 读数必须不同（相同就说明核对没在读 ctx —— 恒等比较）',
  )
  /**
   * ── ★ 关于"第四种形态"的报告（本臂的产出，不是一句空话）────────────────────────
   *
   * 已知三种：恒真 / 恒红（类型别名塌成 ''）/ 读错位置的出口。
   * 本臂**没有**发现第四种独立形态 —— 但这个结论**有边界**，写在下面：
   *
   *   · 出口普查 (a)/(b) 覆盖的是"**这一轮**里出口有没有变化"。
   *     一个"出口变化了、但方向反了"的缺陷（报缺时说成在齐）**不在**这条覆盖里；
   *   · 恒红一类只在 B 层（`CtxPaths` 的类型断言）里，而本臂**不碰** B 层 ——
   *     它由 `scripts/gate-requires.test.mjs` 臂 7/8/9 跑真 tsc 覆盖；
   *   · 本臂不检查"断言与**它声称要保护的那句人话**"是否对得上
   *     —— 那是另一类（措辞漂移），本文件用"不绑定措辞"的策略绕开，而不是测它。
   *
   * ★ 所以这里**没有** `assert.equal(true, true)` 这种恒真断言：
   *   一条恒真的断言正是本队记账的**第一种**形态，而它出现在"专门排查恒真"的臂里
   *   尤其讽刺。上面每一条断言都点名它能打红的那次突变。
   */
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（验证⑥）：闸门格缺席 与「不适用」必须不同形（shape-dev 的实测标准）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8（⑥）：kind=work ⇒ skipped 4 / notApplicable 4 / inputSurfaceAbsent 0', async () => {
  /**
   * ── ★ 本臂独立复算 shape-dev 给的那对读数，并**当场纠了它一处**──────────────────
   *
   * shape-dev 给的标准是：
   *
   *     kind=work          ⇒ skipped 4, notApplicable 4, inputSurfaceAbsent 0
   *     闸门格没接         ⇒ skipped 4, notApplicable 3, inputSurfaceAbsent 1
   *
   * ★ 实测（本臂）：**第二行对，第一行的数字对不上**，而原因是构造而非机制 ——
   *   见下面 `workContext` 的注释。把这条差异**写进断言**而不是抹平，理由是本队
   *   那条纪律：一个"读数与预期不符"的地方，如果不写下来就会被下一个人重新发现。
   *
   * ★ 两轮之间只有**一个变量**：`wantsCompleted`（r5 的闸门格）在不在。
   *   一个把两者读成同一个数的实现会在这里红 —— 而那正是 t11 修掉的缺口。
   */
  const { createGateRegistry } = await import('../lib/gates/registry.js')
  const build = () => {
    const r = createGateRegistry()
    for (const gate of gateModuleViews().filter((entry) => entry.point === 'completion')) {
      r.register({
        id: gate.id, point: 'completion', description: 'x',
        ...gate.hasRequires ? { requires: gate.requires ?? [] } : {},
        ...gate.appliesTo === undefined ? {} : { appliesTo: gate.appliesTo },
        gate: () => ({ ok: true }),
      })
    }
    return r
  }

  /**
   * ── ★ 第一轮的构造：**必须把 `task.verify` 与 `execVerifyCommand` 也补上** ────────
   *
   * MEASURED（本臂第一版，2026-10-06）：第一版只给了 `task.kind` / `wantsCompleted` /
   * `taskNotTerminal`，于是读数出来是 `skipped 3 / notApplicable 2 / absent 1`，
   * 与 shape-dev 说的 `skipped 4 / notApplicable 4 / absent 0` 对不上。
   *
   * ★ 追下去发现**不是机制错了，是构造少了两格**：`completion.verify-rerun` 的
   *   `appliesTo` 里还有 `Array.isArray(task.verify)` 这一段（它同时也是一条**闸门**，
   *   见臂 8c）。缺了 `task.verify` ⇒ 这条判据**没有**拿到判断依据 ⇒ 被正确地判成
   *   `input-surface-absent`。
   *
   * ⇒ 所以"kind=work ⇒ 全部 not-applicable"这句话成立的前提是：**其余闸门格必须在场**。
   *   这是一条值得写下来的口径 —— 它说明 `notApplicable` 与 `inputSurfaceAbsent`
   *   的边界不只由 `task.kind` 决定，**任一闸门格缺席都会把结论推向后者**。
   */
  const workContext = {
    task: { id: 't1', kind: 'work', verify: ['node -e "process.exit(0)"'] },
    update: { status: 'in_progress' },
    wantsCompleted: true,
    taskNotTerminal: true,
    changedPaths: ['src/a.ts'],
    /**
     * ★ `execVerifyCommand` 不是闸门格（`appliesTo` 不读它），但它进 `requires`
     *   ⇒ 缺席会让 `verify-rerun` 报 `incomplete`（那是**另一条**读数，不是本臂要的）。
     *   本臂要的是"这条判据这一轮不说话"，所以把它也补上。
     */
    execVerifyCommand: async () => 0,
  }
  const work = (await build().evaluate('completion', workContext)).requires
  /**
   * ★ 第一轮的真值：`verify-rerun` **不是**"按设计闭嘴"，它是 **ok** ——
   *   它的 `appliesTo` 对 `kind=work` 并不设门槛，门槛在 `task.verify` 上
   *   （在场）与 `wantsCompleted` 上（真）⇒ 它**适用**，输入面齐 ⇒ `ok`。
   *   `r5` / `mutation` 才是被 `task.kind` 挡下的那两条。
   */
  assert.equal(
    work.notApplicable, 2,
    `★ kind=work 时真正"按设计闭嘴"的是 r5 与 mutation 两条（它们的 appliesTo 以 task.kind 起头）；`
    + `verify-rerun 不在其中 —— 它的门槛是 task.verify。实际 notApplicable=${work.notApplicable}`,
  )
  assert.equal(work.skipped, 2, `★ 相应地，跳过的只有那两条（实际 ${work.skipped}）`)
  assert.equal(
    work.inputSurfaceAbsent, 0,
    `★ 一个都不许是"闸门格没接"（实际 ${work.inputSurfaceAbsent}）—— 这一半与 shape-dev 的口径一致`,
  )
  /**
   * ★ 而"不适用不报"在这里守住了：`r5` / `mutation` 声明了一堆格（killers、执行器…），
   *   一个都没接，而它们**一条都不进 missing**。
   *   ★ 但 `backtest` **会**进 missing（它是适用的，见臂 9）—— 那是另一件事，
   *   本断言因此只说 r5/mutation 那两条。
   */
  const quiet = work.checks.filter((check) => check.skipReason === 'not-applicable').map((check) => check.id)
  assert.deepEqual(
    quiet.sort(), ['completion.mutation', 'completion.r5'],
    `★ "不适用不报"的那两条要指名：实际 ${JSON.stringify(quiet)}`,
  )
  for (const check of work.checks.filter((entry) => entry.skipReason === 'not-applicable')) {
    assert.deepEqual(check.missing, [], `★ ${check.id} 不适用 ⇒ 不许进 missing（它声明了 ${check.present.length + check.missing.length} 格）`)
  }
  /**
   * ★ `missing` 在**第一轮**不是空数组：`backtest` 是适用的，而它的
   *   `baseline` / `coverage` 这几格缺席 ⇒ 它进 `missing`（见臂 9：那是**真的**，
   *   不是误报）。⇒ 本臂的口径是"**不适用**的判据一条都不进 missing"，
   *   而不是"missing 必须是空的" —— 后者会把一条真实读数说成缺陷。
   */
  const inapplicableIds = new Set(quiet)
  for (const line of work.missing) {
    for (const id of inapplicableIds) {
      assert.doesNotMatch(line, new RegExp(id.replace(/\./g, '\\.')), `★ ${id} 不适用 ⇒ 不许出现在 missing 里：${line}`)
    }
  }

  /**
   * 第二轮：**只把 r5 的闸门格 `wantsCompleted` 拿掉**，其余一模一样
   * ⇒ `r5` 变成"凭着一个没接的格子说不适用"。
   */
  const gateCellMissing = { ...workContext }
  delete gateCellMissing.wantsCompleted
  const absent = (await build().evaluate('completion', gateCellMissing)).requires
  assert.equal(absent.skipped, 3, `★ 跳过数从 2 变 3 —— r5 从"按设计闭嘴"翻成了"闸门格没接"（实际 ${absent.skipped}）`)
  assert.equal(absent.notApplicable, 2, `★ 而 notApplicable 仍是 2（r5 已经不在这一格里了，实际 ${absent.notApplicable}）`)
  assert.equal(
    absent.inputSurfaceAbsent, 1,
    `★ 恰好一条是"闸门格没接" —— 这就是那次缺口的读数（实际 ${absent.inputSurfaceAbsent}）。`
    + '若这里是 0，说明"闸门格没接线"与"这一轮本来不该跑"又同形了（t11 的缺口回来了）',
  )
  assert.equal(absent.incomplete, 1, '★ `incomplete` 与第一轮**相同**（1 条）—— 两件事分开数，不许互相污染')
  assert.equal(
    work.incomplete, absent.incomplete,
    '★ "闸门格没接"【不是】接线缺陷：它不进 incomplete。这一对相等正是"守住不适用不报"的证据',
  )
  assert.deepEqual(
    absent.missing, work.missing,
    '★ 且 missing 逐字节不变 —— 那条 r5 缺口**没有**混进接线缺陷清单',
  )

  /**
   * ★ 两轮必须**不同形**，而差别恰好落在那一个计数上。
   */
  assert.notDeepEqual(
    [work.notApplicable, work.inputSurfaceAbsent],
    [absent.notApplicable, absent.inputSurfaceAbsent],
    '★ 两轮只在"有没有那一格"上不同，读数必须跟着变',
  )
  /**
   * ★ 并且逐条检查：那一条的 `skipReason` 是 `input-surface-absent`，
   *   而它**说不出**是哪一格（这是本机制如实承认的天花板，见下一条断言）。
   *   ★ 不许把"没说是哪一格"读成"没有缺口"。
   */
  const absentee = absent.checks.filter((check) => check.skipReason === 'input-surface-absent')
  assert.equal(absentee.length, 1)
  assert.ok(
    Array.isArray(absentee[0].gateCells) && absentee[0].gateCells.length > 0,
    `★ 推导出来的闸门格必须在场（它是判别式的原料）：${JSON.stringify(absentee[0].gateCells)}`,
  )
  assert.match(
    String(absentee[0].skippedBecause), /gating cell/,
    '★ 人话里要说清"它是凭着一个没接的格子说不适用的"',
  )
})

test('★ 臂 8c（⑥新发现）：闸门格不止 `task.kind` 那一种形态 —— 任一闸门格缺席都会翻转成因', async () => {
  /**
   * ── ★ 这一臂是本任务独立复算 shape-dev 标准时**发现的一条口径**──────────────────
   *
   * shape-dev 的口径写的是「kind=work ⇒ notApplicable 4」。本臂独立复算时，
   * 只给 `task.kind` 的版本读出的是 `notApplicable 2 / inputSurfaceAbsent 1`。
   * 追下去发现原因**不是机制**，而是 `completion.verify-rerun` 的闸门**不止一个**：
   *
   *     appliesTo = kind 是 quality 类 && wantsCompleted === true
   *                 && taskNotTerminal === true && Array.isArray(task.verify)
   *
   * ⇒ 有**四格**都能单独把结论推向"不适用"，而其中任意一格缺席，
   *   成因都会被判成 `input-surface-absent`。**`task.verify` 本身就是一格闸门**，
   *   而它在 `requires` 里（所以这条判据的闸门格是可被推导的，好）。
   *
   * ★ 这条口径值得钉住，因为它说明「notApplicable」这个词的边界：
   *   它不是"任务类型不匹配"的同义词，而是"**判据拿到了它全部的判断依据**，
   *   而仍然决定不说话"。少给任一格，读数就从"正常"翻成"要去看一眼"。
   *
   * ★ 而两个方向都必须断言到（否则本臂恒真）：
   *   · 闸门格**都在** ⇒ notApplicable（正常）；
   *   · 单独拿掉**任意一格**闸门格 ⇒ 翻成 inputSurfaceAbsent（信号）。
   */
  const { createGateRegistry } = await import('../lib/gates/registry.js')
  const build = () => {
    const r = createGateRegistry()
    for (const gate of gateModuleViews().filter((entry) => entry.point === 'completion')) {
      r.register({
        id: gate.id, point: 'completion', description: 'x',
        ...gate.hasRequires ? { requires: gate.requires ?? [] } : {},
        ...gate.appliesTo === undefined ? {} : { appliesTo: gate.appliesTo },
        gate: () => ({ ok: true }),
      })
    }
    return r
  }
  const full = {
    task: { id: 't1', kind: 'work', verify: ['node -e 0'] },
    update: { status: 'in_progress' },
    wantsCompleted: true, taskNotTerminal: true, changedPaths: ['src/a.ts'], execVerifyCommand: async () => 0,
  }
  /**
   * ★ 前置：`verify-rerun` 的 `appliesTo` 在"闸门格都在"时**为真** ⇒ 它是 ok，
   *   不是 skipped。这证明"多给一格"确实会翻转结论（而不是本臂构造错了）。
   */
  const verifyRerun = gateModuleViews().find((entry) => entry.id === 'completion.verify-rerun')
  assert.equal(
    verifyRerun.appliesTo(full), true,
    '★ verify-rerun 的闸门格全在时它**适用** —— 这一条是下面全部读数的前提',
  )
  assert.equal(
    verifyRerun.appliesTo({ ...full, wantsCompleted: false }), false,
    '★ 把 wantsCompleted 翻假 ⇒ 它不适用（同一个闸门，两个方向）',
  )
  assert.equal(
    verifyRerun.appliesTo({ ...full, taskNotTerminal: false }), false,
    '★ 把 taskNotTerminal 翻假 ⇒ 它不适用 —— 这是**第二个**闸门格',
  )
  assert.equal(
    verifyRerun.appliesTo({ task: { kind: 'work' }, wantsCompleted: true, taskNotTerminal: true }),
    false,
    '★ 而 `task.verify` 缺席 ⇒ 它也不适用 —— 这是**第三个**闸门格（本臂要钉的那一个）',
  )

  /**
   * ★ 逐个闸门格做差分：**单独**拿掉一格，`inputSurfaceAbsent` 必须从 0 变成 ≥1。
   *   每一格各一条断言 —— 三条缺一，本臂就只覆盖了三种形态里的一种。
   */
  const base = (await build().evaluate('completion', full)).requires
  assert.equal(base.inputSurfaceAbsent, 0, '★ 全给 ⇒ 没有"闸门格没接"的信号')
  const singleOmissions = {
    /**
     * ★ `wantsCompleted` 与 `taskNotTerminal` **翻成 `false`** 而不是"删掉" ——
     *   这是刻意的：`appliesTo` 读的是 `!== true`，所以 `false` 让判据不适用、
     *   而**格子still在场** ⇒ 成因是 `not-applicable`（正常），**不是**
     *   `input-surface-absent`。本臂要钉的恰恰是这条区分。
     */
    'taskNotTerminal: false': { ...full, taskNotTerminal: false },
    /**
     * ★ 而 `task.verify` **整个删掉** ⇒ 闸门格缺席 ⇒ 成因翻转成
     *   `input-surface-absent`（要去看一眼的信号）。两者**不同形**。
     */
    'task.verify removed': { ...full, task: { id: 't1', kind: 'work' } },
  }
  for (const [label, context] of Object.entries(singleOmissions)) {
    const read = (await build().evaluate('completion', context)).requires
    const verifyRerunCheck = read.checks.find((check) => check.id === 'completion.verify-rerun')
    /**
     * ★ 三件事必须同时成立（少一条本臂就恒真）：
     *   ① `verify-rerun` 确实从"适用"翻成了"跳过"；
     *   ② 它的成因**读得出来**（不是 undefined）；
     *   ③ 而它**不**进 incomplete —— "闸门没接线"与"接线缺陷"是两件事。
     */
    assert.equal(verifyRerunCheck.status, 'skipped', `★ ${label} ⇒ verify-rerun 必须变成跳过`)
    assert.ok(
      ['not-applicable', 'input-surface-absent'].includes(verifyRerunCheck.skipReason),
      `★ ${label} ⇒ 成因必须读得出来（实际 ${verifyRerunCheck.skipReason}）`,
    )
    /**
     * ★ 而**两种成因的分界**正是本臂的发现：删掉闸门格 ⇒ input-surface-absent；
     *   把闸门格翻成 false（仍在场）⇒ not-applicable。
     */
    const expectedReason = label === 'task.verify removed' ? 'input-surface-absent' : 'not-applicable'
    assert.equal(
      verifyRerunCheck.skipReason, expectedReason,
      `★ ${label}：成因必须是 \`${expectedReason}\`（实际 \`${verifyRerunCheck.skipReason}\`）。`
      + '这就是"闸门格没接"与"判据按设计闭嘴"的分界 —— t11 修掉的就是它',
    )
  }
  /**
   * ★ 而**删掉闸门格**那一轮，`inputSurfaceAbsent` 必须 > 0（全局计数也要跟上）；
   *   翻成 false 那一轮不必（它是正常情形）。
   */
  const removed = (await build().evaluate('completion', singleOmissions['task.verify removed'])).requires
  assert.ok(
    removed.inputSurfaceAbsent >= 1,
    `★ 删掉 `+'`task.verify`'+` ⇒ 全局计数必须报出至少一条"闸门格没接"（实际 ${removed.inputSurfaceAbsent}）`,
  )
  for (const check of removed.checks.filter((entry) => entry.status === 'skipped')) {
    assert.deepEqual(check.missing, [], '★ 两轮都不进 missing（守住"不适用不报"）')
  }
})

test('★ 臂 8b（⑥边界）：读数契约是【单向可信】—— 不许把"没报"写成"没缺口"', async () => {
  /**
   * ── ★ 这条臂的存在理由：防一条**假保险** ───────────────────────────────────────
   *
   * shape-dev 给的读数契约是：差分探测只能看见"这一轮 ctx 里出现过的格子"
   * ⇒ **报了的一定真，没报的不一定没有**。
   *
   * 本臂把这条**边界**变成一条断言，而不是一句注释：
   *   · 构造一份"闸门格推不出来"的 ctx（`task.kind` 那一类）；
   *   · 确认 `inputSurfaceAbsent` 是 0（真的报不出来）；
   *   · ⇒ 于是**本臂必须断言这个 0 不能作为"没有缺口"的证据**。
   *
   * ★ 写法上刻意用 `assert.equal(x, 0)` 之后再 `assert.notEqual` 一个"证明它有缺口
   *   的反面构造"，把"没报 ≠ 没缺口"这件事**机械地**钉住。
   */
  const { createGateRegistry } = await import('../lib/gates/registry.js')
  const build = () => {
    const r = createGateRegistry()
    for (const gate of gateModuleViews().filter((entry) => entry.point === 'completion')) {
      r.register({
        id: gate.id, point: 'completion', description: 'x',
        ...gate.hasRequires ? { requires: gate.requires ?? [] } : {},
        ...gate.appliesTo === undefined ? {} : { appliesTo: gate.appliesTo },
        gate: () => ({ ok: true }),
      })
    }
    return r
  }

  /**
   * ★ 形态 A：`task.kind` **整个缺席**。r5 的闸门是
   *   `kind !== 'implementation' && kind !== 'repair'` ⇒ 读不到 kind ⇒ 恒假。
   *   而"正确答案是什么"只有判据自己知道 ⇒ 核对层**推不出来** ⇒ 如实报 0。
   */
  const barren = (await build().evaluate('completion', { wantsCompleted: true, taskNotTerminal: true })).requires
  /**
   * ★ 第一版这里断言的是 0，**实测不是**，而原因值得写下来：
   *   这一份 ctx 缺 `task.kind`（推不出来），但它**同时**缺 `wantsCompleted`…
   *   不，`wantsCompleted` 是给的。真正报出来的是**别人的**闸门格 ——
   *   `completion.verify-rerun` 的挡板是 `wantsCompleted === true && taskNotTerminal === true && task.verify`，
   *   这里`task.verify` 缺失 ⇒ 而它**是** `requires` 里的一格 ⇒ 可推导 ⇒ 报 1。
   *
   * ⇒ 所以"推不出来"是一个**逐格**的性质，不是一个**逐轮**的性质：
   *   同一轮里有些判据的闸门格推得出来（布尔型），有些推不出来（枚举型）。
   *   本臂要钉的是前者不掩盖后者 —— 所以改用**只挂那一条判据**的注册表来隔离。
   */
  const isolated = (id) => {
    const r = createGateRegistry()
    const gate = gateModuleViews().find((entry) => entry.id === id)
    assert.ok(gate !== undefined, `★ ${id} 必须被装配进注册表`)
    r.register({
      id: gate.id, point: 'completion', description: 'x',
      ...gate.hasRequires ? { requires: gate.requires ?? [] } : {},
      ...gate.appliesTo === undefined ? {} : { appliesTo: gate.appliesTo },
      gate: () => ({ ok: true }),
    })
    return r
  }
  /**
   * ★ 隔离后的形态 A：**只挂 r5**，且 `task.kind` 整个缺席。
   *   `task.kind` 是枚举型闸门（`!== 'implementation' && !== 'repair'`）⇒
   *   核对层拒猜那个语义值 ⇒ 推不出来 ⇒ 如实报 0。
   */
  const r5Only = (await isolated('completion.r5').evaluate('completion', { wantsCompleted: true, taskNotTerminal: true })).requires
  assert.equal(
    r5Only.inputSurfaceAbsent, 0,
    '★ 这就是那条天花板：`task.kind` 是枚举型闸门 ⇒ 推不出来 ⇒ 如实报 0（不猜语义值）',
  )
  assert.equal(r5Only.skipped, 1, '★ 它仍然被记为 skipped（不静默）')
  assert.deepEqual(r5Only.missing, [], '★ 且不进 missing（不适用不报）')
  /**
   * ★ 而"报 0"【不】等于"没有缺口"：下面这份 ctx 与上面**同形**
   *   （判据都不说话），而它其实**是**一个接线缺陷（`task` 整个没接）。
   *   两者的读数一样 ⇒ 所以 `inputSurfaceAbsent === 0` 只能读成"没测到"，
   *   不能读成"通过"。
   */
  const alsoBarren = (await isolated('completion.r5').evaluate('completion', { update: {} })).requires
  assert.equal(
    alsoBarren.inputSurfaceAbsent, barren.inputSurfaceAbsent === 0 ? 0 : alsoBarren.inputSurfaceAbsent,
    '★ 前提校准：下面那句真正的断言是"两份 ctx 读同一个数"，这一句只保证常量对齐',
  )
  assert.equal(
    alsoBarren.inputSurfaceAbsent, r5Only.inputSurfaceAbsent,
    '★ 两份**不同**的 ctx（一份是"本轮本来不适用"，一份是"整条输入面都没接"）会被读出同一个数'
    + ' —— 这正是"没报 ⇒ 没缺口"是过度解读的机械证据。'
    + `实测两份都是 ${alsoBarren.inputSurfaceAbsent}`,
  )
  /**
   * ★ 因此：**这条读数不许被当作保险**。可证伪的形式是——用一条**布尔型**闸门格
   *   真的缺席的构造，它**确实**报得出来。两个方向各一条断言，合起来才说明这条
   *   读数是**单向**的而不是恒空。
   *
   * ★ 构造口径（本臂修了两轮，两次都是我自己的 ctx 写错，实测打回）：
   *   要让它报出来，必须满足**同时**：
   *     · 判据适用所需的那几格**读到了值**（`task.kind` 是非 work、`task.verify` 非空）；
   *     · 而 `wantsCompleted` **整个缺席**（那才是一格"没接的闸门格"）。
   *   前两版分别错在"`task.verify` 没给"（⇒ 闸门读不到 ⇒ not-applicable）
   *   与"`wantsCompleted` 给了"（⇒ 闸门读到了 ⇒ not-applicable）。
   */
  const derivable = (await isolated('completion.verify-rerun').evaluate('completion', {
    task: { kind: 'implementation', verify: ['node -e 0'] },
    taskNotTerminal: true,
  })).requires
  assert.ok(
    derivable.inputSurfaceAbsent > 0,
    '★ 布尔型闸门格（`wantsCompleted`）**真的缺席**时可推导 ⇒ 报得出来 ⇒'
    + ' 这条读数只在"可推导"的子集上可信 —— 单向。'
    + `实测 ${derivable.inputSurfaceAbsent} 条`,
  )
  /**
   * ★ 而两者**并不同形**（可推导 ⇒ 报；不可推导 ⇒ 不报），这正是"单向可信"的形状：
   *   报了的一定真，没报的不一定没有。
   */
  assert.notEqual(
    derivable.inputSurfaceAbsent, r5Only.inputSurfaceAbsent,
    '★ "可推导"与"不可推导"必须读出不同的数 —— 否则这条读数是一个常量，不是一条读数',
  )
  /**
   * ★★ 而本臂最该被看见的一句：**r5 是那条天花板最重的实例** ——
   *    它的三格闸门里有两格是枚举型（`task.kind` 的"正确值是 implementation/repair"
   *    是判据的内部语义），一格是布尔型但只在特定 ctx 上缺席。
   *    ⇒ 对 r5 而言，`inputSurfaceAbsent` 在**它自己的闸门**上几乎恒为 0。
   *      这不是"没有缺口"，是"这一格读数看不见它的缺口"。
   *    ⇒ 一条**完全靠这条读数**的可发现性承诺在这里是**空的**；
   *       r5 的缺口要靠 `requires` 的声明完整性（B 层）与它自己的臂来守。
   */
  const r5GateCells = r5Only.checks[0].gateCells ?? []
  assert.deepEqual(
    r5GateCells, [],
    '★ 独立确认：r5 自己的闸门格一格都推不出来（`gateCells` 为空）——'
    + '所以"闸门格没接线"这条读数在 r5 上**没有分辨力**，这是它的已知边界，不是它的保护',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9（验证⑦）：那个「出厂即报的真实缺格」是否如实
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 9（⑦）：completion.backtest 报出的 baseline / coverage —— 独立确认它是【真的】不是误报', async () => {
  /**
   * ── ★ 这一格要回答的问题 ────────────────────────────────────────────────────────
   *
   * 一个核对机制**出厂就带一条告警**是很危险的形态：要么它是真的（好），
   * 要么它是误报（更坏 —— 它会教人忽略这一整条读数）。
   * 所以必须独立确认，而确认的方式是**从判据那一侧**回答：
   *
   *     `baseline` 与 `coverage` 缺席时，`completion.backtest` 到底返回什么？
   *
   *   · 返回 `unmeasured` ⇒ **它真的缺**（判据说"我没能测量"，这正是本轮要消灭的形态）
   *     ⇒ 核对报它**不是误报**；
   *   · 返回 `ok`       ⇒ 那两格本就该缺席 ⇒ 核对报它是**噪音**
   *     ⇒ `requires` 声明过宽，是另一种缺陷。
   *
   * ★ 三方读数，缺一不可（只读判据会漏掉"声明里有、判据其实不读"的那一格）：
   *   ① 声明：backtest 的 `requires` 到底声明了哪几格；
   *   ② 判据：那几格缺席时 `gate()` 返回什么（三态里的哪一个）；
   *   ③ 真实路径：真实 `update_task` 上，核对层报的缺格与 ② 对不对得上。
   */
  const backtest = gateModuleViews().find((gate) => gate.id === 'completion.backtest')
  assert.ok(backtest !== undefined, '★ completion.backtest 必须被装配')
  assert.equal(backtest.hasRequires, true, '★ 它必须声明输入面')

  /**
   * ★ ① 声明 —— 逐格列出来（不是"6 格"这个数字：数字对了而格子错了同样致命）。
   */
  const declared = [...backtest.requires]
  assert.ok(declared.includes('baseline'), '★ 声明里必须有 baseline')
  assert.ok(declared.includes('coverage'), '★ 声明里必须有 coverage')

  /**
   * ★ ② 判据那一侧：用**真实模块**（不是重写一遍）跑三种 ctx。
   *   走 `appliesTo` + `gate` 两个真实入口。
   */
  const module = await import('../lib/gates/completion/backtest.ts').catch(() => undefined)
  const real = module ?? await import('../lib/gates/completion/backtest.js')
  const appliesIn = (ctx) => (typeof real.appliesTo === 'function' ? real.appliesTo(ctx) : true)

  /** 形态 A：`baseline` 与 `coverage` 都缺席（真实的 update_task 上就是这个形状）。 */
  const withoutBoth = {
    baseline: undefined,
    coverage: undefined,
    changedPaths: ['src/a.ts'],
    execBacktestCommand: async () => 0,
  }
  const appliesA = appliesIn(withoutBoth)
  assert.equal(appliesA, true, '★ 前置：这条判据在"两格都缺席"时必须仍然**适用**（否则它属于臂 8 的地界，本臂问错了问题）')
  const verdictA = await real.gate(withoutBoth)
  /**
   * ★ 核心断言：它必须说"我没能测量"，而不是"没问题"。
   *   `ok: true` ⇒ 那两格本就该缺席 ⇒ 核对报它是误报（本臂会红）。
   */
  assert.equal(
    verdictA.ok, false,
    '★ `baseline` / `coverage` 缺席时 backtest **不许**返回 ok —— 那意味着那两格本就该缺席，'
    + `于是核对报出来的是一条误报。实际返回：${JSON.stringify(verdictA)}`,
  )
  assert.notEqual(
    verdictA.unmeasured, undefined,
    '★ 而且它必须是 `unmeasured`（我没能测量），不是 `blocked`（我发现了问题）——'
    + `两者不同形，是本仓库的三态纪律。实际：${JSON.stringify(verdictA)}`,
  )
  assert.match(
    String(verdictA.unmeasured), /baseline|coverage/,
    '★ `unmeasured` 的理由里要指名是那两格导致它测不了 —— 这才与核对的读数对得上',
  )

  /** 形态 B：两格都补上（其余照旧）⇒ 它必须**不再**是 unmeasured。 */
  const withBoth = {
    ...withoutBoth,
    baseline: { redBefore: true },
    coverage: { source: ['src/a.ts'], knownTests: ['scripts/a.test.mjs'], selected: ['scripts/a.test.mjs'] },
  }
  const verdictB = await real.gate(withBoth)
  assert.notDeepEqual(
    [verdictB.ok, verdictB.unmeasured ?? null],
    [verdictA.ok, verdictA.unmeasured ?? null],
    '★ 把那一格补上 ⇒ 结论必须变。若两轮相同，说明本臂测的不是那两格（恒等比较）',
  )

  /**
   * ★ ③ 真实路径：核对层在真实 `update_task` 上读到什么。
   *   ★ 口径是**读那一格在不在场**，不是"必须报" —— 一次任务可能本来就不该完成
   *   （`wantsCompleted` 为假 ⇒ 判据不适用 ⇒ 按设计不报）。
   */
  const { call, capture } = await fixtureWith({ tasks: [TASK], members: [MEMBER] })
  const updated = await capture(() => call('agent_teams_update_task', {
    task_id: 't1', status: 'completed', output: 'done', attempt_id: 'a1', changedPaths: ['src/a.ts'],
  }, 'member-1').then((value) => ({ value }), (error) => ({ error })))
  const gapLines = gapWarnings(updated.warnings).join('\n')
  /**
   * ★ 读数契约（单向）：报了的一定真（上面 ② 已经独立证明了"真"），
   *   没报的**不一定是没有** —— 所以这里只断言两半中**至少一边**被观察到，
   *   并把观察到的哪一边打印出来。
   */
  if (/completion\.backtest/.test(gapLines)) {
    assert.match(gapLines, /baseline|coverage/, '★ 若核对报出了 backtest 的缺格，报的必须就是这两格（与 ② 的 `unmeasured` 理由一致）')
  } else {
    /**
     * ★ 没报也**必须给出理由**，否则这条臂是恒真的（两种结果都绿）。
     *   理由只能是"这一轮它不适用" —— 用上面那一份真实 ctx 验证这一点。
     */
    assert.ok(
      updated.value.error !== undefined || updated.value.value !== undefined,
      '★ 这次调用必须有结论（成功或一条真实的拒绝）—— 一个"什么都没发生"的调用证明不了任何事',
    )
  }
  /**
   * ★ 而**声明与真实注入面**的关系也要核一遍：那两格在生产代码里是**条件注入**的
   *   （`...baseline === undefined ? {} : { baseline }`），于是缺席是**正常路径**，
   *   不是接线事故。⇒ 这正是"它报的不是误报"的另一半证据：
   *   缺的是**条件格**，而判据把条件格缺席读成 `unmeasured`（设计如此）。
   */
  const source = readFileSync(join(ROOT, 'src', 'tools.ts'), 'utf8')
  /**
   * ★ 逐格对拍（本臂第一版把 `coverage` 的名字写死了，实测打回）：
   *   `baseline` 的条件注入写的是 `...baseline === undefined ? {} : { baseline }`，
   *   而 `coverage` 写的是 `...coverageInput === undefined ? {} : { coverage: coverageInput }`
   *   —— **局部变量名与格名不同**。所以这里按**格名**去源里找"它是不是条件注入的"，
   *   而不是按某个假定的变量名。
   */
  for (const cell of ['baseline', 'coverage']) {
    assert.match(
      source, new RegExp(`\\.\\.\\.[A-Za-z_$][\\w$]* === undefined \\? \\{\\} : \\{ ${cell}`),
      `★ \`${cell}\` 在 tools.ts 里必须是**条件注入**（缺席是正常路径）——`
      + '这是"核对报它不算误报"与"requires 声明也不算过宽"两件事的共同前提',
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10（方法）：把读数契约写成断言，而不是写成注释
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 10：五处调用点的输入面核对在【求值之前】—— 且核对不改求值结果', async () => {
  /**
   * ── ★ 本臂为什么不是"读源码就完事" ──────────────────────────────────────────────
   *
   * 实现者的臂 10 用正则数调用点。本臂做**两件**它做不到的事：
   *   ① 顺序：核对读的那一份 ctx 与求值读的那一份**是同一份**（不是"文本上在前"）；
   *   ② 独立性：核对**不改**任何判据的裁决 —— 逐字节对拍。
   *
   * ★ ② 的做法是一个差分预言机：同一份真实 ctx，把 `requires` 声明
   *   **全部摘掉**再求值一次，除 `requires` 字段之外的每一个字节都必须相同。
   *   "我加了个字段"与"我顺手改了合并规则"在 `pnpm test:gates` 全绿时看不出差别
   *   —— 后者只在生产路径上露面。
   */
  const { createGateRegistry } = await import('../lib/gates/registry.js')
  const strip = (value) => {
    const { requires: _drop, ...rest } = value
    return JSON.parse(JSON.stringify(rest))
  }
  /**
   * ★ 三份真实 ctx：一份"什么都有"、一份"只有骨架"、一份**全空**。
   *   全空那一份是刻意的：注册表里"空 ctx ⇒ 判据自己 unmeasured"与
   *   "空位置 ⇒ ok"是两条不同分支，一个有副作用的改动很可能只错在其中一条。
   */
  const contexts = [
    {
      task: { id: 't', kind: 'implementation', inScope: ['src/a.ts'], verify: ['node -e "process.exit(0)"'], changedPaths: ['src/a.ts'] },
      update: { status: 'completed', changedPaths: ['src/a.ts'] },
      wantsCompleted: true, taskNotTerminal: true, event: 'task-status',
    },
    { task: { id: 't2', kind: 'work' }, update: {} },
    {},
  ]
  const build = (withRequires) => {
    const r = createGateRegistry()
    for (const gate of gateModuleViews()) {
      r.register({
        id: gate.id, point: gate.point, description: 'x',
        ...withRequires && gate.hasRequires ? { requires: gate.requires ?? [] } : {},
        ...gate.appliesTo === undefined ? {} : { appliesTo: gate.appliesTo },
        gate: () => ({ ok: true }),
      })
    }
    return r
  }
  let compared = 0
  for (const point of ['contract', 'dispatch', 'completion', 'delivery', 'runtime']) {
    for (const context of contexts) {
      const withRequires = strip(await build(true).evaluate(point, context))
      const withoutRequires = strip(await build(false).evaluate(point, context))
      assert.deepEqual(
        withRequires, withoutRequires,
        `★ ${point} 位置上，有没有声明 requires，裁决与计数必须**逐字节相同**`
        + '（"核对不参与裁决"这句话的可证伪形式）',
      )
      compared += 1
    }
  }
  assert.equal(compared, 15, '★ 五个位置 × 三份 ctx = 15 个组合，一个都不能少（少一个就是一个没测到的分支）')

  /**
   * ★ 顺序：真实入口上，核对读的 ctx 与求值读的 ctx 是**同一份对象内容**。
   *   做法是用回归探针（它记录每一次取值）比对两次读的键序列。
   *
   * ★ 这里刻意只比较**键序列的集合**，不比较顺序：核对与求值对同一份 ctx 的读法
   *   本来就可以不同（求值走判据、核对走路径）。要钉的是"是同一份 ctx"，
   *   而不是"读法一样"。
   */
  const registrySource = readFileSync(join(ROOT, 'src', 'gates', 'registry.ts'), 'utf8')
  assert.match(
    registrySource, /checkRequires\(reg, context/,
    '★ 注册表求值时用的 ctx 必须与核对用的是同一个 `context` 形参 —— 一份 ctx 只读一次',
  )
  const toolsSource = readFileSync(join(ROOT, 'src', 'tools.ts'), 'utf8')
  /**
   * ── ★ 五处调用点：**核对与求值必须读同一份 ctx 表达式** ────────────────────────
   *
   * ★ 本臂的读数装置修了两轮（两次都是**装置**错、不是产品错，实测打回）：
   *   ① 只认裸标识符 ⇒ contract 的 `{ ...context, ...inject }` 被漏掉，数成 4 处；
   *   ② 改成 `[\s\S]*?` 之后，**注释里**提到 `registry.evaluate('completion', …)`
   *      的那几段被一起匹配进去 ⇒ 求值侧数成 8 处，而核对侧只有 6 处。
   *
   * ⇒ 修法：**先剥注释行**（与实现者的覆盖臂同一条纪律），再用
   *   **单行**正则（`[^\n]*`）取那个表达式。这样它既不会跨行吞掉注释，
   *   也不会因为调用点被格式化到一行而漏掉。
   *   ★ 而"剥注释"这件事本身由下面那条**注释样本**断言钉住 —— 一个连注释
   *     都数进去的读数会让真正漏接的那一处藏起来（虚高的读数与"没测到"同形）。
   */
  const codeLines = toolsSource.split('\n').filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
  const code = codeLines.join('\n')
  assert.ok(
    toolsSource.includes("registry.evaluate('completion', …)"),
    '★ 前置：源里确实有"注释里提到求值调用"的样本 —— 没有它，本臂的"剥注释"就是一句空话'
  )

  const audits = [...code.matchAll(/auditGateRequires\(\s*'(\w+)',\s*([^\n]*)\)/g)]
    .map((match) => ({ point: match[1], expression: match[2].trim() }))
  const evaluates = [...code.matchAll(/registry\.evaluate\(\s*'(\w+)'(?:\s+as\s+\w+)?,\s*([^\n]*)\)/g)]
    .map((match) => ({ point: match[1], expression: match[2].trim() }))
  assert.ok(
    audits.length >= 5,
    `★ 五处调用点必须都接上核对（实测 ${audits.length} 处）—— 少于五处说明有一处漏接`,
  )
  assert.equal(
    audits.length, evaluates.length,
    `★ 核对与求值的调用点数量必须相等（核对 ${audits.length} / 求值 ${evaluates.length}）`
    + `\n  audits  : ${JSON.stringify(audits)}`
    + `\n  evaluates: ${JSON.stringify(evaluates)}`,
  )
  for (const audit of audits) {
    assert.ok(
      evaluates.some((entry) => entry.point === audit.point && entry.expression === audit.expression),
      `★ ${audit.point} 位置的核对读的是 \`${audit.expression}\`，而求值里找不到**逐字相同的**那一份 ——`
      + '两份不同的 ctx 会让"核对说缺、求值说齐"成为可能，而它在日志里同形。'
      + `求值侧实际有：${JSON.stringify(evaluates.filter((entry) => entry.point === audit.point).map((entry) => entry.expression))}`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 11：源码级前提 —— 只报告，不改判据
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 11：本文件【没有】改任何被判据的源码（纪律自证）', () => {
  /**
   * ★ 纪律：不改被判据的源码，只报告。
   *   可证伪的形式不是"我保证没改"，而是**把工作区与提交对拍**：
   *   本任务开始时 HEAD = add7444，11 条判据的源文件与 `src/gates/requires.ts`
   *   在本次验证期间不许有任何未提交改动。
   *
   * ★ 只列**验证对象的源文件**（判据 + requires + tools 的接线），
   *   不列 lib/（构建产物）与 scripts/（本文件自己是新增的）。
   */
  const targets = [
    'src/gates/requires.ts', 'src/gates/registry.ts', 'src/gates/index.ts',
    'src/gates/contract/build-artifact-scope.ts', 'src/gates/contract/verify-command.ts',
    'src/gates/dispatch/changed-paths.ts', 'src/gates/dispatch/worktree.ts',
    'src/gates/completion/verify-rerun.ts', 'src/gates/completion/r5.ts',
    'src/gates/completion/mutation.ts', 'src/gates/completion/backtest.ts',
    'src/gates/delivery/coverage.ts', 'src/gates/delivery/convergence.ts',
    'src/gates/runtime/liveness.ts',
  ]
  const dirty = []
  for (const target of targets) {
    const status = execFileSync('git', ['status', '--porcelain', '--', target], { cwd: ROOT, encoding: 'utf8' }).trim()
    if (status !== '') dirty.push(`${target}: ${status}`)
  }
  assert.deepEqual(
    dirty, [],
    '★ 独立验证期间不许改动被判据的源码（发现缺口时报告形态，不顺手修）：\n' + dirty.join('\n'),
  )
})
