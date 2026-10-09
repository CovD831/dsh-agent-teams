/**
 * ── t13 · 补测量：在有 base 的进程里重跑 t1 的 `completion.mutation` ────────────────
 *
 * ── 这个夹具回答什么问题 ──────────────────────────────────────────────────────
 *
 *   「t1 的收口被 `completion.mutation` 挡住了。而那次拒绝说的是
 *     *改动行范围 …:5-5 里没有一条可计分变异体* —— 一个 `unmeasured`。
 *     那么：**判据在有 base 的时候到底会说什么？**」
 *
 * ★ 本夹具的答案是**判据自己给的**，不是任何人的推断：
 *
 *     判据真的跑了 —— 它给出一份 measured 的裁决：
 *     126 条可计分变异体，63 杀 / 63 存，杀伤率 **0.5 < 0.6** ⇒ **blocked**。
 *     （而那条 `unmeasured` 是**缺 base 那一格**造成的，与交付质量无关。）
 *
 * ── ★★ 为什么必须"自己起一个进程"（而不是在夹具里直接调判据）───────────────
 *
 * `taskWorktreeBase` 是一个 **Map**（`src/tools/shared/entities.ts:306`），
 * 只在【派发建出 worktree 的那个进程】里被写入。而判据要拿到的 `changedLines`
 * 由 `changedLineNumbers(workspace, base)` 从 base 推 —— base 缺席 ⇒ `undefined`
 * ⇒ 判据第一格就返回 `unmeasured`。
 *
 * ⇒ 所以"判据在有 base 时说什么"这件事，**只能在持有 base 的进程里问**。
 *   本夹具因此**真的起一个子进程**，在它里面登记 base，再让它走生产入口。
 *
 * ── ★★★ 独立性的边界（写清楚，因为它决定了本夹具能声称什么、不能声称什么）──
 *
 *   不复用实现者的夹具辅助函数 —— 那些编码了实现者的假设（ctx 长什么样、
 *   什么算通过）。本文件**自己构造**：
 *     · 宿主 ctx（一个真的 cordis `Context` + 真的 `SubagentRuntime`）
 *     · 成员会话（含 `tool/result` + `meta.diffs`，形状取自 `docs/START-HERE.md` §5.1）
 *     · base（一个**真实的 git 对象名**，从 git 里读出来的，不是编的）
 *
 *   唯一"借用"的是**被测对象本身**：
 *     · `lib/tools.js` 的 `registerAgentTeamsTools` / `rememberWorktreeBase`
 *     · `lib/tools/update-task/completion.js` 的 `wireCompletion`
 *   ★ 而这正是本任务要问的那条生产路径。
 *
 * ── ★ 走 `lib/` 而不是 `src/` ────────────────────────────────────────────────
 *   `lib/` 才是运行时真的加载的那一份（`docs/SOURCE-READING-CONVENTION.md`）。
 *
 * ── ★★ 三态如实，且**绝不并进** ──────────────────────────────────────────────
 *
 *   本夹具有一条**硬断言**：`completion.mutation` 的那一格必须**不是** `skipped`
 *   （"判据没跑"与"判据跑了"是两件事）。它跑起来之后，三种结果都**接受**：
 *
 *     measured + 分数 ≥ 阈值   ⇒ ok      （断言：mutationScore 是数字、scored > 0）
 *     measured + 分数 < 阈值   ⇒ blocked （断言：报出存活数与覆盖范围）← 本轮实测
 *     unmeasured               ⇒ 如实记，并**说出缺哪一格**（断言：说得出原因）
 *
 *   ★ 而**不允许**的是：把"没测到"写成"通过"。
 *     所以下面 `assertMeasuredOrHonestUnmeasured` 会把那一格读出来再看 ——
 *     而不是写一条"期望 ok"的断言（那会把"判据没跑"伪装成"跑过了"）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')

/** t1 的交付物所在的检出。★ 那份交付【未提交】，只存在于这个工作树里。 */
const T1_WORKTREE = join(ROOT, '.agent-teams', 'worktrees', 'task-t1')

const git = (args, cwd = ROOT) => execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/**
 * ── 一句话说清本夹具的**前置**（缺一条就 `t.skip`，绝不静默变绿）──────────────
 *
 * ★ 为什么用 `t.skip` 而不是 `assert.ok`：本夹具测的是**一份在另一个目录里的交付**，
 *   而那份交付可能有它的生命周期。当它不在了，正确的读数是"这一格测不了"
 *   （`unmeasured`），**不是**"判据通过了"，也不是"仓库坏了"。
 *   ★ 而那正是本任务的中心：**没测到与测了而不过必须不同形。**
 */
function preconditions() {
  const missing = []
  if (!existsSync(T1_WORKTREE)) missing.push(`t1 的检出不在盘上：${T1_WORKTREE}`)
  if (!existsSync(join(LIB, 'tools.js'))) missing.push('lib/tools.js 不在盘上（先 pnpm build）')
  if (!existsSync(join(LIB, 'tools/update-task/completion.js'))) missing.push('lib/tools/update-task/completion.js 不在盘上（先 pnpm build）')
  if (missing.length === 0) {
    const changed = git(['-C', T1_WORKTREE, 'status', '--porcelain', '--', 'scripts/friction-triage.mjs', 'scripts/friction-triage.test.mjs'])
    if (changed.trim() === '') missing.push('t1 的检出里没有交付（那两个文件与 HEAD 一致）⇒ 没有可测的改动')
  }
  return missing
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★ 前置臂：说清"这次测的是哪一份东西"
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 前置：t1 的交付在它自己的检出里，且基线是那个提交', (t) => {
  const missing = preconditions()
  if (missing.length > 0) {
    t.skip(`未测量：${missing.join('; ')}`)
    return
  }
  /** ★ 交付的**位置**与**规模**都要读出来 —— 后面每一条读数都挂在这两个事实上。 */
  const stat = git(['-C', T1_WORKTREE, 'diff', '--shortstat', '--', 'scripts/friction-triage.mjs', 'scripts/friction-triage.test.mjs'])
  assert.match(stat, /insertion|deletion/, `★ 交付必须是【未提交的改动】。实测：${stat}`)
  const base = git(['-C', T1_WORKTREE, 'rev-parse', 'HEAD'])
  assert.match(base, /^[0-9a-f]{40}$/, `★ 基线必须是一个真的 git 对象名（不是编的）。实测：${base}`)
  console.log(`  [t13] t1 检出 = ${T1_WORKTREE}`)
  console.log(`  [t13] 基线     = ${base.slice(0, 12)}`)
  console.log(`  [t13] 交付规模 = ${stat}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★★ 核心臂：在有 base 的进程里跑判据，取【判据自己的裁决】
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★★ 子进程载荷 ───────────────────────────────────────────────────────────
 *
 * 它做三件事，顺序有意义：
 *
 *   ① 起一个**真的宿主**：cordis `Context` + `SubagentRuntime`
 *      + `subagent-spawn-in-process` provider + jsonl session persistence
 *      + `AgentRegistry`（带一个最小的 agent 工厂）。
 *      ★ 为什么要这么重：`taskWorktreeBase` 的写入点是
 *        `scheduler.onWorktree` → `rememberWorktreeBase`，而它只在
 *        **真的派发过一个成员**（`startContinuable` 走通）之后才会被调用。
 *        一个"我直接 set 一下 Map"的写法测的是**另一个东西**。
 *
 *   ② 用**真的**工具体建团队、加成员、建任务、认领、登记 base。
 *      ★ base 用的是 `rememberWorktreeBase` —— **生产那一个入口**。
 *
 *   ③ 走 `wireCompletion`（生产接线）求值 `completion` 位置，
 *      把 `gates` 那一份**原样**交出来。
 *
 * ★ 子进程把结果打成一行 JSON（`__T13__` 前缀），父进程只解析它 ——
 *   于是"读数"是**结构化**的，而不是对日志做正则。
 */
const CHILD = String.raw`
import { Context } from '@deepseek-ai/cordis'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { mkdir, rm } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.env.T13_ROOT
const WORKSPACE = process.env.T13_WORKSPACE
const BASE = process.env.T13_BASE
const STATE_DIR = '.agent-teams/t13-completion-probe-state'
const git = (a) => execFileSync('git', a, { cwd: WORKSPACE, encoding: 'utf8' }).trim()

const out = (obj) => { process.stdout.write('__T13__' + JSON.stringify(obj) + '\n') }

const { registerAgentTeamsTools, rememberWorktreeBase, evaluateQualityCompletion } = await import(join(ROOT, 'lib/tools.js'))
const { registry } = await import(join(ROOT, 'lib/gates/index.js'))
const { wireCompletion } = await import(join(ROOT, 'lib/tools/update-task/completion.js'))
const { readTeam, writeTeam } = await import(join(ROOT, 'lib/state.js'))
const { changedLineNumbers, deriveScanDirs, resolveBaseRevision } = await import(join(ROOT, 'lib/tools/shared/entities.js'))
const { parseKindRequirements } = await import(join(ROOT, 'lib/gates/completion/r5.js'))

/**
 * ★ 复刻调用方那一格：kind 需求表怎么被读到。
 *   它是**调用方的读表助手**（src/tools/update-task.ts:25），不是被测对象。
 *   ★★ 一条"读不到表"的复刻会让三条门一起沉默 ⇒ 本次测量会变成**假 unmeasured**，
 *     而那正是本任务要防的形态（探针的失败伪装成被测物的结论）。
 */
function loadKindRequirementsSync() {
  const here = join(ROOT, 'lib/tools')
  const candidates = [
    join(here, '..', 'gates', 'completion', 'kind-requirements.json'),
    join(here, '..', '..', 'src', 'gates', 'completion', 'kind-requirements.json'),
    join(process.cwd(), 'src', 'gates', 'completion', 'kind-requirements.json'),
  ]
  let lastError = ''
  for (const candidate of candidates) {
    try { return parseKindRequirements(JSON.parse(readFileSync(candidate, 'utf8'))) }
    catch (error) { lastError = candidate + ': ' + String(error?.message ?? error) }
  }
  return { status: 'absent', reason: 'the kind-requirements table could not be read from any known location (' + lastError + ')' }
}

const stateAbs = join(WORKSPACE, STATE_DIR)
await rm(stateAbs, { recursive: true, force: true })
await mkdir(stateAbs, { recursive: true })

// ── ① 真的宿主 ───────────────────────────────────────────────────────────────
const host = new Context()
const fiber = host.plugin(SubagentRuntime)
await fiber.await()

const pnpm = join(ROOT, 'node_modules/.pnpm')
const spawnPkg = join(pnpm, readdirSync(pnpm).find(n => n.startsWith('@deepseek-ai+dsh-subagent-spawn-in-process@')), 'node_modules/@deepseek-ai/dsh-subagent-spawn-in-process/lib/index.js')
const persistPkg = join(pnpm, readdirSync(pnpm).find(n => n.startsWith('@deepseek-ai+dsh-session-persistence-jsonl@')), 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')
const spawnMod = await import(spawnPkg)
const persistFiber = host.plugin((await import(persistPkg)).default, { root: join(stateAbs, 'sessions'), compression: 'none' })
await persistFiber.await()
const spawnFiber = host.plugin({ inject: spawnMod.inject, apply: spawnMod.apply }, { providerName: 'spawn' })
await spawnFiber.await()

const liveAgents = new Map()
const definitions = new Map()
const listeners = new Map()
const childListeners = new Map()
let childSeq = 0, messageSeq = 0

function makeAgent(id, parentSession) {
  return {
    id, status: 'idle',
    options: { provider: 'fake', model: 'fake-model' },
    session: {
      id,
      header: { cwd: WORKSPACE, parentSession, seedLength: 0 },
      events: [],
      append(type, data) { this.events.push({ type, data }) },
      ownEvents() { return this.events },
      requestHeader() { return { config: { provider: 'fake', model: 'fake-model', reasoningEffort: 'high' } } },
    },
    followups: [], steers: [],
    followup(m) { this.followups.push(m); this.status = 'running' },
    steer(m) { this.steers.push(m); this.status = 'running' },
    inject() {},
    cancel() { this.status = 'idle'; this._idle?.(); this._idle = undefined },
    whenIdle() { return this.status === 'idle' ? Promise.resolve() : new Promise(r => { this._idle = r }) },
  }
}

/**
 * ★ 成员的 scoped ctx：给到 \`applyChildComposition\` 需要的那三格。
 *   它们缺席 ⇒ 子代理建不出来 ⇒ \`startContinuable\` 抛错 ⇒ 本探针测不到东西
 *   （而那个失败**看起来**像"判据没跑"，所以必须补上，不是"凑绿"）。
 */
function childContext(child) {
  const reg = new Map()
  childListeners.set(child.id, reg)
  return {
    agent: child,
    get() { return undefined },
    tools: { restrict() { return () => {} } },
    systemPrompt: {
      section() {}, context() {}, getSectionOrder() { return 0 }, getContextOrder() { return 0 },
    },
    effect(setup) { return setup() },
    on(name, listener) {
      const cur = reg.get(name) ?? []
      cur.push(listener)
      reg.set(name, cur)
      return () => reg.set(name, (reg.get(name) ?? []).filter(c => c !== listener))
    },
  }
}

const captain = makeAgent('captain-session')
liveAgents.set(captain.id, captain)

const ctx = {
  effect(setup) { return setup() },
  tools: { register(d) { definitions.set(d.name, d) } },
  on(name, listener) {
    const cur = listeners.get(name) ?? []
    cur.push(listener)
    listeners.set(name, cur)
    return () => listeners.set(name, (listeners.get(name) ?? []).filter(c => c !== listener))
  },
  logger: { debug() {}, info() {}, warn() {}, error() {} },
  llm: { async resolveCallConfig(c) { return c }, async listModels() { return [] } },
  subagents: host.subagents,
}

/**
 * ★ 复现**现代宿主**那一面：只有 FIFO 队列（\`dsh.subagent.queuePrompt\`），
 *   没有 \`followup\`。见 \`scripts/lifecycle-verify.mjs --modern-harness\`。
 *   ★ 这是本插件真实支持的一种宿主形态，不是为夹具造的。
 */
const queueKey = Symbol.for('dsh.subagent.queuePrompt')
const realStart = host.subagents.startContinuable.bind(host.subagents)
host.subagents.startContinuable = async (spec) => await realStart({ ...spec, childId: 'member-session-' + (++childSeq) })
host.subagents.followup = undefined
host.subagents[queueKey] = async (_parent, childId, content, source) => {
  const child = liveAgents.get(childId)
  if (child === undefined) throw new Error('no such child ' + childId)
  child.followup({ content, source })
  return 'message-' + (++messageSeq)
}

// ── 真的 AgentRegistry（captain 必须登记进去：drainChildren 会核对身份）────────
const { AgentRegistry } = await import('@deepseek-ai/dsh-agent')
const agentsFiber = host.plugin(AgentRegistry)
await agentsFiber.await()
ctx.agents = host.agents
/**
 * ★ captain 的 ctx 必须是**宿主 ctx** —— \`startContinuable\` 会读
 *   \`parent.ctx.get('permissionPresets' | 'sandboxPolicy' | 'approval')\`
 *   （\`captureDelegatedPolicyOverrides\`）。给一个"看着像 ctx"的对象会在
 *   那里炸成 \`Cannot read properties of undefined (reading 'get')\`，
 *   而那**看起来**像"判据跑不了"。
 */
captain.ctx = host
await host.agents.register(captain)
host.agents.setFactory({
  createAgent: async (_ownerCtx, options) => {
    const child = makeAgent(options.sessionId, options.parentAgent?.id)
    liveAgents.set(child.id, child)
    child.ctx = childContext(child)
    await options.setup?.(child.ctx, child)
    return { agent: child, dispose: async () => { liveAgents.delete(child.id) } }
  },
})

registerAgentTeamsTools(ctx, { stateDir: STATE_DIR, memberProvider: 'spawn', maxMembers: 8, profiles: {} })

const execFor = (subject) => ({ agent: subject, signal: new AbortController().signal })
const call = (name, args, subject = captain) => {
  const d = definitions.get(name)
  if (d === undefined) throw new Error('missing tool ' + name)
  return d.execute(args, execFor(subject))
}

// ── ② 真的工具调用链：建团队 → 加成员 → 建任务 → 认领 ────────────────────────
await call('agent_teams_create', { name: 'T13 Probe', description: 'replay t1 completion with a base' })
await call('agent_teams_add_member', { name: 'probe-author', role: 'implementer' })

const created = await call('agent_teams_create_task', {
  subject: 't1 replay: unified pipeline skeleton',
  assignee: 'probe-author',
  kind: 'implementation',
  objective: 'replay t1 completion with a real base',
  inScope: ['scripts/friction-triage.mjs', 'scripts/friction-triage.test.mjs'],
  acceptance: ['the pipeline skeleton is the single trunk'],
  verify: ['node --test scripts/friction-triage.test.mjs'],
})
const taskId = created.task_id
const stateRoot = join(WORKSPACE, STATE_DIR)
let team = await readTeam(stateRoot, 't13-probe')
let member = team.members.find(m => m.name === 'probe-author')
/**
 * ★ 成员的 agent 由**真的** \`startContinuable\` 建出来（我们给 AgentRegistry 装的
 *   那个最小工厂）。\`member.id\` 是宿主交回的 childId —— 用**它**去找活的 agent。
 *   ★ 找不到 ⇒ 如实报"成员没能建起来"，而不是硬往下走（那会在别处炸成一个
 *     看起来像"判据有问题"的形状）。
 */
/**
 * ★★ \`member.id === ''\` 表示**这个成员还没被建起来** —— 而它只在**真的派发过**
 *   一个任务之后才有 id（\`spawnMember\` 会写回 \`start.childId\`）。
 *   ⇒ 所以先认领那个任务：认领会触发调度器派发，派发才建成员。
 *   ★ 那正是本探针要的"真的走过生产路径"，而不是"我直接把 agent 塞进 Map"。
 */
if (member.id === '') {
  /**
   * ★ \`reassign_task\` 只对**未开工**的任务生效 ⇒ 先把它置回 \`pending\`
   *   （这一步只是**安排一次派发**，不是绕过任何判据）。
   */
  {
    const t0 = await readTeam(stateRoot, 't13-probe')
    const task0 = t0.tasks.find(x => x.id === taskId)
    task0.status = 'pending'
    task0.assignee = 'probe-author'
    /**
     * ★ \`phase\` 在这一份耐久记录里是**缺席**的（\`team.json\` 里没有这一格）
     *   —— 而 \`kickMember\` 的第一道前置是 \`team.phase === 'staged'\` ⇒ 显式置为
     *   \`running\`（与生产上 \`create\` 的缺省一致，见 \`src/tools/create.ts:172\`）。
     *   ★ 一个"缺席的 phase"会让派发**静默不发生**，而那正好会伪装成
     *     "判据没跑" —— 所以这一格必须被显式写下来，而不是靠运气。
     */
    t0.phase = 'running'
    await writeTeam(stateRoot, t0)
  }
  /**
   * ── ★★ 让成员**真的被建起来**：走 \`ctx.subagents.startContinuable\`（生产那一条线）
   *
   * ★ 为什么不用 \`reassign_task\` 触发它：那条路要经过 \`scheduler.kickMember\`，
   *   而 kick 的准入里有**好几道与本任务无关的前置**（reload 排队、就绪扫描…）。
   *   任何一道不满足，派发就**静默不发生** —— 而那会伪装成"判据没跑"，
   *   正是本任务记账的那条形态。★ 本探针实测就撞上了它（成员 id 恒为 ''），
   *   所以这里**绕开调度器的准入**，只走"建出成员"这一步。
   *
   * ★ 而 base 那一格的登记**仍然走生产入口**（下面的 \`rememberWorktreeBase\`），
   *   值与入口都和生产一致 —— 本探针没有伪造任何一格。
   */
  const started = await host.subagents.startContinuable({
    provider: 'spawn',
    label: 'agent-teams:t13-probe:probe-author',
    request: {
      prompt: [{ type: 'text', text: 'probe member: present so the worktree base has a writer' }],
      parent: captain,
      persona: 'probe',
      toolFilter: { deny: [] },
      agentOptions: { provider: 'fake', model: 'fake-model' },
    },
    signal: new AbortController().signal,
  })
  {
    const t1 = await readTeam(stateRoot, 't13-probe')
    const m1 = t1.members.find(m => m.name === 'probe-author')
    m1.id = started.childId
    m1.status = 'idle'
    await writeTeam(stateRoot, t1)
  }
  process.stdout.write('__T13DBG__ spawned childId = ' + JSON.stringify(started.childId) + '\n')
  process.stdout.write('__T13DBG__ live = ' + JSON.stringify([...liveAgents.keys()]) + '\n')
  team = await readTeam(stateRoot, 't13-probe')
  member = team.members.find(m => m.name === 'probe-author')
}

const author = liveAgents.get(member.id)
if (author === undefined) {
  out({ fatal: 'member-not-spawned', member, live: [...liveAgents.keys()] })
  process.exit(0)
}

/**
 * ★ 观察面：成员会话里要有 \`tool/result\` + \`meta.diffs\`。
 *   形状取自 docs/START-HERE.md §5.1（那份形状是从 app.asar 抽源码核实过的）。
 *   ★ 没有它 \`dispatch.changed-paths\` 会诚实地说"我没能观察" —— 那不是判据的缺陷。
 */
author.session.events.push({
  type: 'tool/result', turn: 1, step: 1,
  meta: { diffs: [
    { path: 'scripts/friction-triage.mjs', oldText: null, newText: '// t1' },
    { path: 'scripts/friction-triage.test.mjs', oldText: null, newText: '// t1' },
  ] },
})

const claim = await call('agent_teams_claim_task', { task_id: taskId }, author)

/**
 * ── ★★★ 本任务缺的那一格 ────────────────────────────────────────────────────
 *
 * 生产路径上它由 \`scheduler.onWorktree(taskId, base)\` 写入
 * （\`src/scheduler.ts:857\` → \`src/tools.ts:1734\` → \`rememberWorktreeBase\`）。
 * ★ 本探针**不走调度器**（那需要真的起一个成员派发循环），所以在这里用
 *   **同一个入口**登记 —— 而 base 是**从 git 里读出来的真实对象名**，不是编的。
 */
rememberWorktreeBase(taskId, BASE)

/** 把任务置为 in_progress（**不经过 update_task**）。理由见下面的 dispatchNote。 */
{
  const fresh = await readTeam(stateRoot, 't13-probe')
  const t = fresh.tasks.find(x => x.id === taskId)
  t.status = 'in_progress'
  t.updatedAt = Date.now()
  await writeTeam(stateRoot, fresh)
}

// ── ③ 走生产接线求值 completion 位置 ─────────────────────────────────────────
const freshTask = (await readTeam(stateRoot, 't13-probe')).tasks.find(x => x.id === taskId)
const changedFiles = ['scripts/friction-triage.mjs', 'scripts/friction-triage.test.mjs']
const changedLines = await changedLineNumbers(WORKSPACE, BASE)

const wiring = await wireCompletion({
  args: { status: 'completed' },
  changedLines,
  loadKindRequirementsSync,
  resolveBaseRevision,
  acceptanceResults: [{ criterion: 'the pipeline skeleton is the single trunk', status: 'passed' }],
  changedFiles,
  commandsRun: [],
  discriminatingFiles: ['scripts/friction-triage.test.mjs'],
  findings: undefined,
  gate: evaluateQualityCompletion,
  input: { changedPaths: changedFiles },
  killerSuiteFiles: ['scripts/friction-triage.test.mjs'],
  newTestFiles: ['scripts/friction-triage.test.mjs'],
  observedTestFiles: ['scripts/friction-triage.test.mjs'],
  repairEvidence: undefined,
  task: freshTask,
  worktreeBase: BASE,
  registry,
  workspace: WORKSPACE,
  deriveScanDirs,
})

/**
 * ★ 判据自己的裁决：\`gates.ran\` 里那一条的 verdict，以及输出的产物。
 *   ★★ 三态如实：\`skipped\` 与 \`ok\` / \`blocked\` / \`unmeasured\` 不同形。
 */
const mutated = wiring.gates.ran.find(entry => entry.id === 'completion.mutation')
out({
  ok: wiring.gates.ok,
  evaluated: wiring.gates.evaluated,
  skippedGates: wiring.gates.skipped,
  registered: wiring.gates.registered,
  ran: wiring.gates.ran.map(e => ({ id: e.id, verdict: e.verdict, count: e.count, produced: e.produced })),
  mutationVerdict: mutated === undefined ? null : mutated.verdict,
  mutationBlockers: wiring.gates.blockers.filter(b => String(b).startsWith('[completion.mutation]')),
  /** ★ 判据自己的产物那一份也要交出来（见 \`wireCompletion\` 的 outputs）。 */
  mutationOutput: wiring.gates.outputs['completion.mutation'] ?? null,
  outputsKeys: Object.keys(wiring.gates.outputs),
  allBlockers: wiring.gates.blockers,
  unmeasured: wiring.gates.unmeasured ?? null,
  changedLineCount: changedLines === undefined ? null : changedLines.length,
  changedLineFirst: changedLines === undefined ? null : changedLines[0],
  changedLineLast: changedLines === undefined ? null : changedLines[changedLines.length - 1],
  workspace: WORKSPACE,
  base: BASE,
  baseResolved: resolveBaseRevision(freshTask),
})

await rm(stateAbs, { recursive: true, force: true })
process.exit(0)
`

/** 起那个子进程，并把它的**一行 JSON 读数**拿回来。 */
async function readCompletionVerdict() {
  /**
   * ★ 子进程必须落在**能解析 `@deepseek-ai/cordis` 的地方**。
   *   `mkdtemp(tmpdir())` 不行 —— 那里向上找不到 node_modules
   *   （实测：ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis'）。
   *   ⇒ 写进 **t1 检出**（它有 node_modules 的链接），跑完删掉。
   */
  const scratch = mkdtempSync(join(T1_WORKTREE, '.t13-probe-'))
  const script = join(scratch, 'probe.mjs')
  /**
   * ★ 子进程**在 t1 的检出里跑**（`cwd` = 那个 worktree），因为：
   *   · 判据读的是 `workspace` ⇒ 它必须看见 t1 那一份交付；
   *   · `loadKindRequirementsSync` 的第三条候选是 `process.cwd()/src/...`。
   * ★ 而插件本体从**主树**的 `lib/` 加载（`T13_ROOT`）—— 那才是部署中那一份。
   */
  writeFileSync(script, CHILD)
  try {
    const { stdout } = await run(process.execPath, [script], {
      cwd: T1_WORKTREE,
      /**
       * ── ★★ 必须清掉 `NODE_TEST_CONTEXT` / `NODE_OPTIONS` ────────────────────────
       *
       * MEASURED（本夹具实测，且本仓的 `scripts/gate-mutation.test.mjs` 记过同一条）：
       * 本夹具自己跑在 `node --test` 里，而 `NODE_TEST_CONTEXT` 会让**孙进程**
       * （判据起的那个 `node --test <suite>`）变成**子报告器** —— 它不再打印
       * `ℹ pass N` 汇总行 ⇒ 判据读不到汇总 ⇒ 它诚实地报
       * "the killer suite did not report a readable summary" ⇒ `unmeasured`。
       *
       * ★ 而那正是本任务记账的形态：**夹具的环境**让被测判据产生**假 unmeasured**，
       *   而它与"套件真的够不到"在读数上完全同形。
       * ⇒ 清掉它，让判据拿到它与生产上会拿到的那一份一样的输出。
       */
      env: (() => {
        const env = { ...process.env, T13_ROOT: ROOT, T13_WORKSPACE: T1_WORKTREE, T13_BASE: git(['rev-parse', 'HEAD'], T1_WORKTREE) }
        for (const key of Object.keys(env)) {
          if (key.startsWith('NODE_TEST') || key === 'NODE_OPTIONS') delete env[key]
        }
        return env
      })(),
      maxBuffer: 32 * 1024 * 1024,
    })
    if (process.env.T13_DEBUG === '1') console.log('  [child stdout]\n' + stdout.split('\n').filter(l => l.startsWith('__T13DBG__')).join('\n'))
    const line = stdout.split('\n').find(l => l.startsWith('__T13__'))
    assert.notEqual(line, undefined, `★ 子进程没有交出读数。stdout 尾部：\n${stdout.slice(-2000)}`)
    return JSON.parse(line.slice('__T13__'.length))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('★ 臂 2（核心）：在有 base 的进程里，`completion.mutation` 交出的裁决', async (t) => {
  const missing = preconditions()
  if (missing.length > 0) {
    t.skip(`未测量：${missing.join('; ')}`)
    return
  }
  const verdict = await readCompletionVerdict()
  assert.equal(verdict.fatal, undefined, `★ 前置失败（不是判据的结论）：${JSON.stringify(verdict).slice(0, 600)}`)

  /**
   * ── ★★★ 第一条断言：判据**真的跑了** ────────────────────────────────────────
   *
   * ★ 它防的正是本任务要纠正的那个读数：`skipped` 与"跑了但说测不了"不同形，
   *   而两者在日志里都像"没有拦住流程"。
   *   ⇒ 所以这里**先**把"跑没跑"钉住，再看它说了什么。
   */
  console.log(`  [t13] workspace   = ${verdict.workspace}`)
  console.log(`  [t13] base        = ${String(verdict.base).slice(0, 12)} (resolveBaseRevision ⇒ ${JSON.stringify(verdict.baseResolved)})`)
  console.log(`  [t13] changedLines= ${verdict.changedLineCount} 行（${verdict.changedLineFirst}…${verdict.changedLineLast}）`)
  console.log(`  [t13] completion 位置的裁决：evaluated=${verdict.evaluated} skipped=${verdict.skippedGates} registered=${verdict.registered}`)
  console.log(`  [t13] ran = ${JSON.stringify(verdict.ran)}`)

  assert.equal(
    verdict.baseResolved.kind, 'resolved',
    `★ 前置：base 必须真的被解析出来（否则本臂测的是"缺 base"那件事，不是判据的裁决）。实测：${JSON.stringify(verdict.baseResolved)}`,
  )
  assert.equal(
    verdict.mutationVerdict !== null && verdict.mutationVerdict !== 'skipped', true,
    `★ 核心：\`completion.mutation\` 必须**真的跑了**（实测 verdict=${String(verdict.mutationVerdict)}）。`
    + ` "没跑"与"跑了而测不了"必须不同形 —— 那正是本任务记账的那条。`,
  )
  assert.equal(typeof verdict.changedLineCount, 'number', '★ 前置：改动行必须真的拿到了（它是 base 那一格的产物）')
  assert.ok(verdict.changedLineCount > 0, `★ 前置：改动行非空。实测 ${verdict.changedLineCount}`)

  /**
   * ── ★★★ 第二条：三态如实，**三种都接受**，但每一种都要能被读出形状 ──────────
   *
   * ★ 这里**刻意不写** `assert.equal(verdict.mutationVerdict, 'blocked')`：
   *   那会把"判据换了一个正确的裁决"读成"夹具坏了"。
   *   本任务要的是**判据自己的读数**，不是夹具期望的那个读数。
   */
  const allowed = ['ok', 'blocked', 'unmeasured']
  assert.ok(allowed.includes(verdict.mutationVerdict), `★ 三态之一。实测：${String(verdict.mutationVerdict)}`)

  if (verdict.mutationVerdict === 'unmeasured') {
    /**
     * ★★ 第三态：**如实记，且说出缺哪一格** —— 绝不许并进 ok，也不许并进 blocked。
     */
    assert.notEqual(verdict.unmeasured, null, '★ unmeasured 必须带一句"缺哪一格"（不许是一个光秃秃的 false）')
    console.log(`  [t13] ★ 判据仍报 unmeasured —— 缺的那一格是：${verdict.unmeasured}`)
    return
  }

  /**
   * ── 跑起来了 ⇒ 把**读数**逐条交出来 ────────────────────────────────────────
   *
   * ★ 而"跑了"这一件事本身就已经回答了本任务的核心问题：
   *   `5-5 里没有一条可计分变异体` 那个 `unmeasured` **是缺 base 造成的**，
   *   不是交付质量的读数。
   */
  const joined = verdict.mutationBlockers.join('\n')
  if (verdict.mutationVerdict === 'ok') {
    assert.equal(joined, '', `★ ok 的判据不该同时报 blocker。实测：${joined}`)
    console.log('  [t13] ★ 判据说 ok（杀伤率 ≥ 阈值）')
    return
  }

  /** blocked：★ 必须报出**存活数**与**覆盖范围**（判据自己的契约要求）。 */
  assert.match(joined, /mutation score/, `★ blocked 必须给出杀伤率。实测：${joined}`)
  assert.match(joined, /survived/, `★ blocked 必须报出存活数。实测：${joined}`)
  assert.match(joined, /coverage: /, `★ blocked 必须报出覆盖范围。实测：${joined}`)
  assert.match(joined, /survivor: /, `★ blocked 必须逐条列出存活体。实测：${joined}`)
  console.log('  [t13] ★ 判据给出 measured 的 blocked：')
  for (const line of verdict.mutationBlockers) console.log(`         ${line}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★ 实测的可计分变异体数：由 `generateMutants()` 输出，**不是** git diff 行数
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3：实测的可计分变异体数（`generateMutants()`，不是 `git diff` 行数）', (t) => {
  const missing = preconditions()
  if (missing.length > 0) {
    t.skip(`未测量：${missing.join(', ')}`)
    return
  }
  /**
   * ── 为什么这条臂单独存在 ────────────────────────────────────────────────────
   *
   * MEASURED（本任务查明）：成员报过「114 条可计分变异体」，captain 复算得
   * 542+589 —— **两个都不对**，因为它们数的都是 `git diff` 的 `+` 行数。
   * 而判据消费的是**另一格**：`changedLineNumbers()` 从 base 推出来的
   * **改动行号集合**，再被 `generateMutants()` 过滤。
   *
   * ★ 三个数字必须**各自可读**，否则它们会互相冒充：
   *
   *     git diff 的 + 行数      ⇒ 文本行的规模
   *     changedLineNumbers 长度 ⇒ 判据看到的行集合（**含被删行所在的新行号**，
   *                               所以它 ≥/≠ + 行数）
   *     generateMutants 条数    ⇒ ★ 真正进分母的那一个
   */
  const base = git(['rev-parse', 'HEAD'], T1_WORKTREE)
  const plusLines = git(['diff', '--numstat', base, '--', 'scripts/friction-triage.mjs', 'scripts/friction-triage.test.mjs'], T1_WORKTREE)
    .split('\n').filter(Boolean)
    .reduce((sum, line) => sum + Number(line.split('\t')[0]), 0)

  const probeScript = join(mkdtempSync(join(tmpdir(), 't13-count-')), 'count.mjs')
  writeFileSync(probeScript, String.raw`
import { readFileSync } from 'node:fs'
const ROOT = process.env.T13_ROOT, W = process.env.T13_WORKSPACE, BASE = process.env.T13_BASE
const { generateMutants } = await import(ROOT + '/lib/mutation.js')
const { changedLineNumbers } = await import(ROOT + '/lib/tools/shared/entities.js')
const lines = await changedLineNumbers(W, BASE)
const per = {}
let total = 0
for (const f of ['scripts/friction-triage.mjs', 'scripts/friction-triage.test.mjs']) {
  const text = readFileSync(W + '/' + f, 'utf8')
  const inFile = lines.filter(l => l >= 1 && l <= text.split('\n').length)
  const m = generateMutants(text, { startLine: Math.min(...inFile), endLine: Math.max(...inFile), changedLines: inFile, file: f })
  per[f] = { changedLines: inFile.length, mutants: m.length }
  total += m.length
}
process.stdout.write('__T13C__' + JSON.stringify({ changedLineTotal: lines.length, per, total }) + '\n')
`)
  let counted
  try {
    counted = JSON.parse(execFileSync(process.execPath, [probeScript], {
      cwd: T1_WORKTREE,
      env: (() => {
        const env = { ...process.env, T13_ROOT: ROOT, T13_WORKSPACE: T1_WORKTREE, T13_BASE: base }
        for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST') || key === 'NODE_OPTIONS') delete env[key]
        return env
      })(),
      encoding: 'utf8',
    }).split('\n').find(l => l.startsWith('__T13C__')).slice('__T13C__'.length))
  } finally {
    rmSync(dirname(probeScript), { recursive: true, force: true })
  }

  console.log(`  [t13] git diff 的 + 行数                      = ${plusLines}`)
  console.log(`  [t13] changedLineNumbers(base) 的长度         = ${counted.changedLineTotal}`)
  for (const [file, stat] of Object.entries(counted.per)) {
    console.log(`  [t13]   ${file}: 文件内改动行 ${stat.changedLines} ⇒ generateMutants ${stat.mutants}`)
  }
  console.log(`  [t13] ★ generateMutants 合计（进分母的那一个）= ${counted.total}`)

  /**
   * ★ 硬断言只有一条：**它必须是一个真的数出来的数**（> 0），
   *   且它**不等于** `git diff` 的 + 行数 —— 后者是那两个错数的来源。
   * ★ 不断言具体条数：那会让"判据/算子改了一个正确的行为"被读成"夹具坏了"。
   */
  assert.ok(counted.total > 0, `★ 必须有可计分变异体（否则"无可计分"这件事本身要另行解释）。实测 ${counted.total}`)
  assert.notEqual(
    counted.total, plusLines,
    `★ 可计分变异体数 **不是** git diff 的 + 行数 —— 本任务纠正的就是这个合流。`
    + `实测 mutants=${counted.total}, +lines=${plusLines}`,
  )
  assert.notEqual(
    counted.changedLineTotal, plusLines,
    `★ 判据看到的那一格（changedLineNumbers）也 **不是** + 行数。实测 ${counted.changedLineTotal} vs ${plusLines}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 反向半边：**缺 base** 时判据必须报 unmeasured，且**与 blocked 不同形**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（反向半边）：base 缺席 ⇒ unmeasured，**绝不**记成 blocked/ok', async (t) => {
  const missing = preconditions()
  if (missing.length > 0) {
    t.skip(`未测量：${missing.join('; ')}`)
    return
  }
  /**
   * ── 这一臂为什么**不能少** ──────────────────────────────────────────────────
   *
   * 没有它，臂 2 的 `blocked` 就无法区分两种成因：
   *
   *     (i)  判据真的测出"交付的测试在改动行上是装饰性的"  ← 一条关于**交付**的结论
   *     (ii) `changedLines` 根本没拿到（缺 base）           ← 一条关于**测量**的事实
   *
   * ★ 而 t1 当时收到的正是 (ii)，只是它被印成了一句看起来像 (i) 的话。
   *   ⇒ 这一臂把两者**分开钉住**。
   */
  const { changedLineNumbers } = await import(join(LIB, 'tools/shared/entities.js'))
  const { gate } = await import(join(LIB, 'gates/completion/mutation.js'))

  const worktree = T1_WORKTREE
  const undefinedLines = await changedLineNumbers(worktree, undefined)
  assert.equal(undefinedLines, undefined, `★ 缺 base ⇒ changedLineNumbers 返回 undefined（不是 []，也不是全文件）。实测 ${JSON.stringify(undefinedLines)}`)

  /** ★ `undefined` 与 `[]` **必须不同形**（判据的契约逐字写着这一条）。 */
  const emptyLines = await changedLineNumbers(worktree, '')
  assert.equal(emptyLines, undefined, `★ 空 base 同样 ⇒ undefined。实测 ${JSON.stringify(emptyLines)}`)

  /**
   * ★ 走**判据本体**（`lib/gates/completion/mutation.js` 的 `gate`），
   *   而不是实现者的夹具辅助函数 —— 这是本任务的独立性纪律。
   */
  /**
   * ★ 表要用**真的那一个**（`src/gates/completion/kind-requirements.json`）。
   *   MEASURED（本夹具第一版就是把表写死成 `byKind.get('implementation')` ⇒
   *   它在 `gateRequirementFor` 里当场炸）—— 而那是**探针构造错了**，
   *   不是判据坏了。一件"我造错了输入"与"被测物不接受输入"必须分得开。
   */
  const { parseKindRequirements } = await import(join(LIB, 'gates/completion/r5.js'))
  const table = parseKindRequirements(JSON.parse(readFileSync(join(ROOT, 'src/gates/completion/kind-requirements.json'), 'utf8')))

  const verdict = await gate({
    loadKindRequirements: () => table,
    task: { id: 't13-absent-base', kind: 'implementation' },
    wantsCompleted: true,
    taskNotTerminal: true,
    changedFiles: ['scripts/friction-triage.mjs', 'scripts/friction-triage.test.mjs'],
    changedLines: undefined,
    readFile: (p) => readFileSync(join(worktree, p), 'utf8'),
    readSuite: (p) => readFileSync(p, 'utf8'),
    writeFile: () => {},
    runTest: async () => ({ exitCode: 0, stdout: 'ℹ pass 1\nℹ fail 0\n', stderr: '' }),
    testCommand: 'node --test *',
    killerSuites: [{ id: join(worktree, 'scripts/friction-triage.test.mjs'), files: [join(worktree, 'scripts/friction-triage.test.mjs')] }],
  })

  console.log(`  [t13] 缺 base 时判据说： ${JSON.stringify(verdict).slice(0, 400)}`)
  assert.equal(verdict.ok, false, '★ unmeasured 不是 ok')
  assert.equal(verdict.unmeasured !== undefined, true, `★ 必须是 unmeasured 那一态。实测 ${JSON.stringify(verdict)}`)
  assert.equal('blockers' in verdict, false, '★ unmeasured 与 blocked **不同形**：不许同时带 blockers')
  assert.equal(verdict.mutationScore, undefined, '★ unmeasured 不许携带分数（一个分数会被下游当成测量结果）')
  assert.equal(verdict.survived, undefined, '★ unmeasured 不许携带"存活数"')
  assert.match(
    String(verdict.unmeasured), /changed-line ranges|could not be established/,
    `★ 必须说清缺的是**改动行**那一格（而不是一句笼统的"没测成"）。实测：${String(verdict.unmeasured)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★ 根因链：`baseRevision` 为什么缺席，以及它**是否可修**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5：`resolveBaseRevision` 的两条来源与两个"没有"的成因**不同形**', async (t) => {
  if (!existsSync(join(LIB, 'tools/shared/entities.js'))) {
    t.skip('未测量：lib/tools/shared/entities.js 不在盘上（先 pnpm build）')
    return
  }
  const { resolveBaseRevision } = await import(join(LIB, 'tools/shared/entities.js'))

  /**
   * ── 这条臂钉的是**根因链的第 1、2 跳** ──────────────────────────────────────
   *
   *   `resolveBaseRevision` 有两条来源：**内存 Map** → **任务记录里的 `baseRevision`**。
   *   两条都没有 ⇒ `absent`，而它又分**两种成因**，它们的补救动作**相反**：
   *
   *     `no-worktree`   ⇒ 这类任务本来就没有父版本（不适用）
   *     `not-recorded`  ⇒ ★ 本该有而丢了（**要去看一眼**）
   *
   * ── ★★★ t21 更正：判别依据是 **`kind`**，不是 `attempt`（t20 改的口径）──────────
   *
   * MEASURED（本臂第一版就是按 `attempt` 调的，而它现在**测的是一个已经不存在的形状**）：
   *
   *     // t20 之前（旧口径）              // t20 之后（现在）
   *     attempt > 0 ? 'not-recorded'       needsWorktreeFor(kind) ? 'not-recorded' : 'no-worktree'
   *                 : 'no-worktree'
   *
   * ★ 而 t20 的更正理由是硬的（`entities.ts:355-360` 逐字）：
   *   「"这个任务被派发过几次"与"这类任务该不该有父版本"是两件不相干的事。
   *     旧写法把它们绑在一起，于是**重派**（一个与基准无关的动作）会翻转诊断。」
   *   ⇒ ★ 后果（t20 实测）：任何非 implementation/repair 的任务，只要被重派过一次，
   *     就再也无法提交终态 —— 而它被拒的理由**从来没有发生过**。
   *
   * ★★ 而本臂此前传 `{ id, attempt }`（无 kind）⇒ `needsWorktreeFor(undefined)` 为假
   *   ⇒ **两种情形都落 `no-worktree`** ⇒ "两种没有必须不同形"这条断言必然红。
   *   ★ 而那不是产品坏了：生产**两个**调用方（`update-task.ts:466`、
   *     `update-task/completion.ts:250`）**都传整个 `task`**（因而带 kind）。
   *   ⇒ ★ 这是我的夹具用了**旧的产品形状** —— 与 t34 同族（夹具复刻了旧的形状）。
   *
   * ⇒ 修法：按**现在的**口径调（带 kind），并**两个方向都钉**：
   *     会建 worktree 的 kind（implementation/repair）⇒ `not-recorded`（本该有却丢了）
   *     不会建 worktree 的 kind（其余五种）        ⇒ `no-worktree`（按设计没有）
   */
  const notRecorded = resolveBaseRevision({ id: 't13-dispatched-but-lost', kind: 'implementation', attempt: 1 })
  const noWorktree = resolveBaseRevision({ id: 't13-review-never-had-one', kind: 'review', attempt: 1 })
  console.log(`  [t13] kind=implementation ⇒ ${JSON.stringify(notRecorded)}`)
  console.log(`  [t13] kind=review         ⇒ ${JSON.stringify(noWorktree)}`)

  assert.equal(noWorktree.kind, 'absent')
  assert.equal(notRecorded.kind, 'absent')
  assert.notEqual(
    noWorktree.reason, notRecorded.reason,
    '★ 两种"没有"必须不同形 —— 它们的补救动作相反（一个不适用，一个要去看一眼）',
  )
  assert.equal(noWorktree.reason, 'no-worktree', '★ 不建 worktree 的 kind ⇒ 按设计没有')
  assert.equal(notRecorded.reason, 'not-recorded', '★ 该建 worktree 的 kind ⇒ 本该有而丢了')

  /**
   * ── ★★ 反向半边（t20 的口径）：`attempt` **不再参与判定** ─────────────────────
   *
   * ★ 这一条是**刻意的**：旧写法里"重派"会翻转诊断，而那正是 t20 修的那个缺陷。
   *   ⇒ 所以同一 kind 下，`attempt` 取任何值都必须给出**同一个结论**。
   */
  for (const attempt of [0, 1, 9]) {
    assert.equal(
      resolveBaseRevision({ id: `t21-attempt-${attempt}`, kind: 'implementation', attempt }).reason,
      'not-recorded',
      `★ implementation 且 attempt=${attempt} ⇒ 必须恒为 not-recorded（attempt 不参与判定）`,
    )
    assert.equal(
      resolveBaseRevision({ id: `t21-attempt-r-${attempt}`, kind: 'review', attempt }).reason,
      'no-worktree',
      `★ review 且 attempt=${attempt} ⇒ 必须恒为 no-worktree（重派不该翻转诊断）`,
    )
  }

  /**
   * ── t1 的**真实记录**：直接读耐久态，确认那一格真的不在 ──────────────────────
   * ★ 只在团队还在盘上时读；不在就跳过这一半（不猜）。
   */
  const teamFile = join(ROOT, '.agent-teams', 'unified-pipeline', 'team.json')
  if (!existsSync(teamFile)) {
    console.log('  [t13] （unified-pipeline 的 team.json 不在盘上 ⇒ t1 那一半跳过）')
    return
  }
  const team = JSON.parse(readFileSync(teamFile, 'utf8'))
  const t1 = team.tasks.find(x => x.id === 't1')
  if (t1 === undefined) {
    console.log('  [t13] （团队里没有 t1 ⇒ 那一半跳过）')
    return
  }
  console.log(`  [t13] t1.kind=${t1.kind} · t1.attempt=${t1.attempt} · t1.baseRevision=${JSON.stringify(t1.baseRevision)} · status=${t1.status}`)
  assert.equal(
    Object.hasOwn(t1, 'baseRevision'), false,
    '★ t1 的记录里【不该】有 baseRevision，且它的 kind 会建 worktree ⇒ 这正是 `not-recorded`（本该有而丢了）',
  )
  /** ★ 前置：t1 的 kind 确实是"会建 worktree"那一类（否则本臂的 `not-recorded` 前提不成立）。 */
  assert.equal(t1.kind, 'implementation', '★ 前置：t1 是 implementation（会建 worktree ⇒ 本该有父版本）')
  assert.equal(resolveBaseRevision(t1).kind, 'absent', '★ 前置：t1 的 base 解析确实落 absent')
  assert.equal(resolveBaseRevision(t1).reason, 'not-recorded', '★ 而它的成因是 not-recorded（kind 会建 worktree），不是 no-worktree')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5b ★★ 「成因」这一格**不许**从时间线推 —— 只有可重跑的读数才算
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5b：成因未定 —— 可复现的事实只有两条，推不出的那一格必须留空', (t) => {
  /**
   * ── 这一臂钉的是**本任务第一版犯过的一个错**（captain 当场核出来的）───────────
   *
   * 第一版写着：
   *
   *     t1.updatedAt = 14:53:21  <  task-t1 检出建立 = 14:56:13
   *     ⇒ 那次 update 被评估时 worktree 还不存在 ⇒ onWorktree 从没为 t1 触发过
   *
   * ★★ 而 `14:56:13` **复现不出来**（实测：`.git/worktrees/task-t1/HEAD` 与
   *   `worktrees/task-t1/.git` 的 mtime **都是 14:24:17**）——
   *   而 14:24:17 **早于** t1.updatedAt（14:53:21）**29 分钟**
   *   ⇒ **那个结论不成立**：worktree 当时是存在的。
   *
   * ★ 所以这一臂把纪律变成**可执行**的：
   *
   *     ① 能复现的：worktree 的建立时刻**早于**那次 update
   *     ② 能复现的：t1 的记录里没有 baseRevision
   *     ③ ★ 推不出的：**为什么**没落上 —— 见 `docs/T1-COMPLETION-PROBE.md` §三，
   *        两类候选（模块级 root 未赋值 / cwd 指向别处）**都没有当时的证据**
   *
   * ★★ 而"成因未定"必须**写成没定**，不许选一个说得通的 ——
   *   一个指错的根因会让修法修错地方（那正是 §三 引的 t58 形状）。
   */
  const adminHead = join(ROOT, '.git', 'worktrees', 'task-t1', 'HEAD')
  const worktreeGit = join(T1_WORKTREE, '.git')
  if (!existsSync(adminHead) && !existsSync(worktreeGit)) {
    t.skip('未测量：task-t1 的 git 管理元数据不在盘上')
    return
  }

  const mtime = (path) => statSync(path).mtimeMs
  const created = existsSync(worktreeGit) ? mtime(worktreeGit) : mtime(adminHead)
  const updated = 1791442401679 // t1.updatedAt（arm 5 已从 team.json 读过；此处固定以免重复解析）

  console.log(`  [t13] worktree .git 建立 = ${new Date(created).toISOString()}`)
  console.log(`  [t13] t1.updatedAt       = ${new Date(updated).toISOString()}`)

  /**
   * ★ 唯一允许的**因果**断言：建立**早于**那次 update ⇒
   *   "那次评估时 worktree 不存在"这个说法**被证伪**。
   *   ★ 注意这里钉的是**否定**（本任务第一版的那个说法不成立），
   *     而不是肯定一个替身成因 —— 替身成因**没有证据**。
   */
  assert.ok(
    created < updated,
    `★ 实测：worktree 的建立时刻（${new Date(created).toISOString()}）必须**早于** t1.updatedAt（${new Date(updated).toISOString()}）`
    + ' ⇒ 于是"那次评估时 worktree 还不存在"这个说法**不成立**（本任务第一版就是那么写的，已撤）。',
  )
  console.log('  [t13] ★ 因此："worktree 当时不存在"被证伪；而"为什么 base 没落上"**因果未定**（两类候选都缺当时的证据）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6 ★★ 一条**独立**发现的挡路缺陷（只报告，不修）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6：`update_task` 的 dispatch 位置把「判据没说话」读成了拒绝，且消息是空的', async (t) => {
  if (!existsSync(join(LIB, 'gates/index.js'))) {
    t.skip('未测量：lib/gates/index.js 不在盘上（先 pnpm build）')
    return
  }
  /**
   * ── 它是什么（MEASURED，本任务第 3 次跑到它）────────────────────────────────
   *
   *   在**没有任何判据适用**的 dispatch 位置上：
   *
   *     registry.evaluate('dispatch', …) ⇒ { ok:false, blockers:[], evaluated:0,
   *                                           skipped:2, registered:2, skippedAll:'…' }
   *
   *   ★ `ok:false` + `blockers:[]` + `skippedAll` 的**语义是"这一步没被检查"** ——
   *     而 `src/tools/update-task.ts` 在 dispatch 与 completion **两处**把它读成拒绝：
   *
   *         if (gates.ok === false) {
   *           const msg = gates.unmeasured !== undefined ? "…could not measure (…)" : "…rejected: " + gates.blockers.join('; ')
   *           throwWithSurface(msg, …)      // ★ 两个分支都 throw
   *         }
   *
   *   ⇒ 后果：一条 `in_progress` 的更新被拒，而**拒绝原话是空的**
   *     （`blockers` 是 `[]`）⇒ 读的人拿不到任何补救线索。
   *
   * ── 与 `docs/HANDOVER.md` 第五节的关系 ──────────────────────────────────────
   *
   *   那里记着同一条在 **delivery** 位置被 t64 修过。★ 本臂钉的是：
   *   **dispatch 与 completion 两处仍是同一形状** —— 而那正是"修了一处、
   *   另一处同形"的机械形式（本队记过的形态）。
   *
   * ★ 本臂**只测量**：它不去改 `src/`（那是本任务的 outOfScope）。
   */
  const { registry } = await import(join(LIB, 'gates/index.js'))
  const evaluation = await registry.evaluate('dispatch', {
    task: { id: 't13-no-gate-applies', kind: 'implementation' },
    update: { status: 'in_progress' },
    wantsCompleted: false,
    taskNotTerminal: true,
  })

  console.log(`  [t13] dispatch 位置（无判据适用）：ok=${evaluation.ok} blockers=${JSON.stringify(evaluation.blockers)} evaluated=${evaluation.evaluated} skipped=${evaluation.skipped} registered=${evaluation.registered}`)
  console.log(`  [t13] skippedAll = ${JSON.stringify(evaluation.skippedAll ?? null)}`)
  console.log(`  [t13] ran = ${JSON.stringify(evaluation.ran)}`)

  assert.equal(evaluation.skippedAll !== undefined, true, '★ 前置："全跳过"必须有一条可读的话（t58 的产物）')
  assert.equal(evaluation.evaluated, 0, '★ 前置：一条判据都没跑')

  /**
   * ★★ 这一条是**读数**，不是断言"该不该 throw" —— 本任务不许改 `src/`。
   *   ⇒ 断言只钉住"这个形状真的存在"，从而让下一个任务能照着它修。
   */
  if (evaluation.ok === false && evaluation.blockers.length === 0 && evaluation.unmeasured === undefined) {
    console.log('  [t13] ★★ 实测确认：ok=false 而 blockers 为空、unmeasured 缺席 ⇒')
    console.log('         `update_task` 那条 `throwWithSurface(gates.blockers.join(\'; \'))` 会抛出**空消息**。')
    console.log('         形态与 docs/HANDOVER.md 第五节记的那条同族（t64 只在 delivery 位置修过）。')
  }
  /**
   * ★ 而**不允许**的是"全跳过被读成通过" —— 那会把"没被检查"伪装成"检查过了"。
   *   所以这里同时钉住：`skippedAll` 在时，整体裁决**不许**是 `ok`。
   */
  assert.equal(evaluation.ok, false, '★ "全跳过"绝不许读成 ok（那是契约 §3.4 明令禁止的那条合流）')
})
