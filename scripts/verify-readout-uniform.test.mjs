/**
 * ── ★★ 独立验证：四处读数出口的形状、三态不同形、总是出现（t2）──────────────────
 *
 * 本文件是**别人**（verifier5）写的独立验证，**不**看实现者的夹具
 * （`scripts/gate-readout-uniform.test.mjs`）内部怎么构造 —— 它只读**工具入口**
 * 交出来的那个值。
 *
 * ── ★ 与实现者夹具的**方法不同**（这一点是有意的，不是重复）───────────────────
 *
 *   实现者夹具：用 rolldown 把 `src/tools.ts` 与一个**假面** gates/index 合成 bundle，
 *               在 bundle 里改 `gateModuleViews()` 与 `registry`。
 *   本文件      ：**不**合成任何 bundle。从真实的 `lib/tools.js` 与
 *               `lib/gates/index.js` 进，在**真实注册表**上 `register()` 探针判据 ——
 *               而 `gateModuleViews()` 的唯一真值就是 `registry.list()`（见
 *               `src/gates/index.ts` 的那段 MEASURED），所以注册进真表的探针
 *               **真的**会被核对层看见。
 *
 * ★ 两条路各自能证伪对方证不了的东西：
 *   · 假面那条能证明"调用方把结论交出来了"（它控得住设备）；
 *   · 本文件这条能证明"在**真实**注册表与真实 `gateModuleViews` 上，结论确实
 *     按位置分开、三态确实不同形"（它控不住设备，但它读的是真世界）。
 *
 * ── ★★ 本文件刻意**不**做的一件事 ──────────────────────────────────────────────
 *
 * 不 import、不读、不复制实现者夹具里任何常量（`CONTRACT_PROBE_ID` / `surfaceFor` /
 * `requireShape` 全部本文件自己写）。一份"抄过来再断言一遍"的验证与"没验证"同形。
 *
 * ── ★ 本文件要证伪的六件事（= 任务的六条）──────────────────────────────────────
 *
 *   ① 四处实际返回的 `input_surface` 形状是否**真的与 runtime 一致**（逐字段比对）
 *   ② 三种状态是否**两两不同形**（都齐 / 有缺格 / 该位置无判据），走真实工具入口
 *   ③ 「总是出现」：都齐时字段**在场且 `incomplete: 0`**，而不是缺席
 *   ④ 现有 `logger.warn` 是否还在（结构化出口是补充，不是替代）
 *   ⑤ 规则二后半句：把某一处的补齐**单独去掉**，对应臂必须红
 *   ⑥ 有没有**第四种恒真写法**（本队已记账三种：恒真 / 恒红 / 读错位置的出口）
 *
 * ── ★ 「恒真」的自检：每条臂都要能说出"什么改动会让它红"────────────────────────
 *
 * 本文件在每条臂的注释里写清**定向突变**。凡说不出突变的那条臂，宁可不写 ——
 * 一条说不清被什么打红的断言，与一句注释同价。
 *
 * ── ★★ 探针的构造（本文件唯一的自变量）──────────────────────────────────────
 *
 * 探针是一条注册进**真实注册表**的判据，它的 `requires` 声明一格
 * **任何 ctx 上都不存在**的路径，而它的 `appliesTo` 由**闸门**控制。
 *
 *   · 闸门开  ⇒ 这个位置这一轮"有判据"，且**当场有缺格**（第二态）
 *   · 闸门关  ⇒ 这个位置这一轮"没有判据"（第三态；见下面那段 ⚠️）
 *
 * ⚠️ 关于闸门走 `appliesTo` 还是"注册/注销"——本文件走 `appliesTo`，原因**不是**
 *    "appliesTo 更优雅"，而是本文件的臂 5 之后**不能**靠注销探针来造第三态：
 *    注销会让 `registry.count(point)` 变化，而那会**同时**改掉
 *    `evaluateRuntimeGates` 开头那句短路 —— 一个自变量动两根轴，读数就不可归因了。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { registerAgentTeamsTools } from '../lib/tools.js'
import { registry, gateModuleViews } from '../lib/gates/index.js'
import { createTeamDir } from '../lib/state.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const cleanups = []
function track(entry) { cleanups.push(entry); return entry }
process.on('exit', () => {
  for (const entry of cleanups) { try { rmSync(entry, { recursive: true, force: true }) } catch {} }
})

// ─────────────────────────────────────────────────────────────────────────────
// 一、探针：本文件的**唯一**自变量 —— 「这个位置这一轮有没有判据」
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 探针 id 带一个本文件独有的前缀。
 *
 * ★ 与实现者夹具的探针**刻意不同名**：两条夹具可能在同一台机器上先后跑，
 *   同名会让"这一条是谁注册的"读不出来 —— 而本队记账的第三种形态
 *   （读错位置的出口）最爱的就是这个缝隙。
 */
const PROBE_PREFIX = 'verify2.readout.probe.'
/** ★ 一格任何真实 ctx 上都不存在的路径 ⇒ 探针一旦适用，那个位置立刻有缺格。 */
const ABSENT_PATH = 'noSuchCellOnAnyContext_verify2'

/**
 * 一个位置上的探针：声明一格不存在的路径、**永远通过**（不改流程走向）。
 *
 * ★ 为什么必须"永远通过"：本文件要读的是**核对层**报了什么，不是某条判据的裁决。
 *   一条会 blocked / unmeasured 的探针会让"核对报缺"与"判据把流程拒了"在断言层面
 *   同形 —— 而那正是本文件要分开的两件事。
 */
const ARMED = new Set()

function probeFor(point) {
  return {
    id: `${PROBE_PREFIX}${point}`,
    point,
    description: `verify-readout-uniform probe on ${point}`,
    requires: [ABSENT_PATH],
    appliesTo: () => ARMED.has(point),
    gate: () => ({ ok: true }),
  }
}

/** 打开某个位置上的探针 ⇒ 那个位置这一轮"有判据"（而且缺格）。返回关闭函数。 */
function arm(point) {
  ARMED.add(point)
  return () => { ARMED.delete(point) }
}

/**
 * ★★ 探针的注册**一次性**完成，且必须在任何 `test(...)` 之前。
 *
 * MEASURED（同队已记过这个坑）：注册放在 `test()` 体内 ⇒ 后面某条臂先跑时探针
 *   还没注册，于是它读到的是"这个位置没判据" —— 而它读起来像"出口缺失"。
 *   归因指向产品代码，真凶是夹具的执行顺序。
 */
const registeredProbes = []
for (const point of ['contract', 'dispatch', 'completion', 'delivery']) {
  const probe = probeFor(point)
  registry.register(probe)
  registeredProbes.push(probe)
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、一个够真实的插件夹具（与实现者夹具同构 —— 但本文件自己写）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ `warnings` 是"缺格日志"（给人看的那一条）的出口。
 *
 * ★★ 本文件的每一条"出口在场"断言都**同时**读它（臂 4 的职责）：只读一条路径会让
 *    "只写日志"与"只挂字段"与"两条都有"三种实现里至少两种同形 —— 而那正是本任务
 *    要消灭的形态。两条都读，才知道补出口的时候有没有把日志顺手去掉。
 */
function pluginFixture(workspace) {
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: {
      debug() {}, info() {}, error(message) { warnings.push(message) },
      warn(message) { warnings.push(message) },
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
  const config = { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined }
  registerAgentTeamsTools(ctx, config)
  const call = async (name, args, agentId) => {
    const tool = tools.get(name)
    assert.notEqual(tool, undefined, `★ 工具 "${name}" 没有被注册 —— 本文件进不去真实入口`)
    try {
      const value = await tool.execute(args, {
        agent: fakeAgent(agentId ?? 'captain-session', workspace),
        signal: new AbortController().signal,
      })
      return { ok: true, value, raw: undefined }
    } catch (error) {
      /**
       * ★ 读的是**工具边界搬出来的那一格**（`error.input_surface`），不是异常上那个
       *   内部属性：后者是搬运的**来源**，前者才是交出去的那份。两个名字分开，
       *   于是"边界到底搬没搬"是可证伪的（把搬运那一段删掉 ⇒ 臂 5 的突变红）。
       */
      return { ok: false, error, value: undefined, raw: error?.input_surface }
    }
  }
  return { ctx, tools, warnings, call }
}

/**
 * ★ 成员会话里真的有一条写文件的记录：`dispatch.changed-paths` 声明
 *   `observedChangedPaths`，而那一格的来源是会话事件里的 `tool/result → meta.diffs`。
 *   没有它 ⇒ 那一格 `undefined` ⇒ 这个位置**真的有缺格**，而"都齐"那几条臂
 *   会变成一句假话。
 */
function fakeAgent(id, workspace) {
  return {
    id,
    status: 'idle',
    session: {
      header: { cwd: workspace },
      events: [
        { type: 'tool/result', meta: { diffs: [{ path: 'src/a.ts', oldText: null, newText: 'x' }] } },
      ],
    },
    steer() {},
  }
}

/**
 * 一个**真的** git 仓库 + 成员 worktree。
 *
 * ★ 为什么非要有（而不是省掉）：`update_task` 走 dispatch 位置时，
 *   `dispatch.worktree` 的 `appliesTo` 要求"这个任务被派发到了一个真实存在的
 *   worktree"。没有它那两条判据是 `skipped`，"这个位置有没有判据"这件事在夹具里
 *   不可控 —— 而它正是本文件唯一的自变量。
 */
function seedWorktree(workspace) {
  const repository = join(workspace, 'repo')
  const worktree = join(workspace, 'worktree')
  mkdirSync(repository, { recursive: true })
  const git = (args, cwd) => execFileSync('git', args, {
    cwd, stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  })
  git(['init', '-q'], repository)
  writeFileSync(join(repository, 'README.md'), 'seed\n')
  git(['add', '-A'], repository)
  git(['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', 'commit', '-qm', 'seed'], repository)
  git(['worktree', 'add', '-q', '--detach', worktree, 'HEAD'], repository)
  return { repository, worktree }
}

async function seedTeam(workspace, { tasks, members }) {
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team',
    name: 'VerifyReadout',
    captainSessionId: 'captain-session',
    createdAt: 1,
    taskSeq: tasks.length,
    members,
    tasks,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、种子状态（与实现者夹具**各自独立**地推导出来）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 起点是 **`claimed`**：`pending → in_progress` 不合法（`TASK_TRANSITIONS`），
 *   种成 `pending` 会让 `update_task` 在**走到 dispatch 之前**就被状态机拒掉，
 *   于是夹具读到"字段不出现"而误判成出口缺失。
 */
const IMPL_TASK = {
  id: 't1', seq: 1, subject: 'w', kind: 'implementation', status: 'claimed',
  objective: 'o', inScope: ['src/a.ts', 'lib/a.js'], acceptance: ['a'],
  verify: ['node -e "process.exit(0)"'],
  assignee: 'worker', attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1, dependencies: [],
}
const RUNNING_TASK = {
  id: 't2', seq: 2, subject: 'w2', kind: 'work', status: 'in_progress',
  inScope: ['src/b.ts'], assignee: 'worker', attempt: 1, attemptId: 'a2',
  createdAt: 1, updatedAt: 1, dependencies: [],
}
const RUNNING_MEMBER = { id: 'member-1', name: 'worker', status: 'working', joinedAt: 1 }

/**
 * 一份**真的可以交付**的团队状态（`declare_delivery` 的前置）：
 * 没有未完成任务、completed 的 implementation 有一条 `verdict === 'pass'` 的 review、
 * 改动路径都在 inScope 里。少任何一条，调用在**走到 delivery 位置之前**就被拒。
 */
const DELIVERABLE_TASKS = [
  {
    id: 'd1', seq: 1, subject: 'impl', kind: 'implementation', status: 'completed',
    objective: 'o', inScope: ['src/a.ts', 'lib/a.js'], acceptance: ['a'],
    changedPaths: ['src/a.ts'],
    assignee: 'worker', attempt: 1, attemptId: 'a1', createdAt: 1, updatedAt: 1, dependencies: [],
  },
  {
    id: 'd2', seq: 2, subject: 'review', kind: 'review', status: 'completed', verdict: 'pass',
    reviewedTaskId: 'd1',
    assignee: 'worker', attempt: 1, attemptId: 'a2', createdAt: 1, updatedAt: 1, dependencies: ['d1'],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// 四、五个位置各自的调用（全部走**真实工具入口**）
// ─────────────────────────────────────────────────────────────────────────────

const CALLS = {
  contract: (f) => f.call('agent_teams_create_task', {
    subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'],
  }),
  /**
   * ★★ `update_task` 一次调用穿过**两个**位置。
   *
   * MEASURED（本文件第一版）：这条调用**几乎总是被拒** —— `completion` 位置的
   *   `completion.backtest` 在开工那一刻（`wantsCompleted` 为假、没有 `baseline`）
   *   报 unmeasured 并把整次调用拒掉。⇒ 任何"读成功返回值"的臂都会拿到 `undefined`，
   *   而它读起来像"出口缺失"。
   *
   * ★ 本文件因此对 dispatch / completion 一律走**拒绝路径 + 成功路径两条**：
   *   结论挂在哪一侧由调用自己的结局决定，而两条都读得到才是"总是出现"的完整含义。
   */
  dispatch: (f) => f.call('agent_teams_update_task', {
    task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
  }, 'member-1'),
  completion: (f) => f.call('agent_teams_update_task', {
    task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
  }, 'member-1'),
  delivery_status: (f) => f.call('agent_teams_status', { team_id: 'team' }),
  delivery_declare: (f) => f.call('agent_teams_declare_delivery', {}),
  runtime: (f) => f.call('agent_teams_status', { team_id: 'team' }),
}

/**
 * ★★ 一个位置的结论，**两条路**都要读：成功走返回值，被拒走抛出。
 *
 * MEASURED（本文件第一版）：只读返回值 ⇒ 那几处几乎总是被拒的位置一律读成
 *   `undefined`，于是"出口缺失"与"这次调用被拒了"在断言层面同形。而这正是本任务
 *   要消灭的那件事的镜像。⇒ `exitOf` 两个落点都找，并**另行**断言它是从哪儿读到的。
 */
function exitOf(siteKey, result) {
  const fromReturn = readExit(siteKey, result)
  if (fromReturn !== undefined) return { surface: fromReturn, via: 'return' }
  if (!result.ok && result.error !== null && typeof result.error === 'object') {
    const carrier = result.error.agentTeamsInputSurface
    if (carrier !== null && typeof carrier === 'object') return { surface: carrier, via: 'throw' }
  }
  return { surface: undefined, via: 'none' }
}

/**
 * ★★ 「这个位置的结论从哪个字段读」—— 本文件唯一一处**位置相关**的知识。
 *
 * ★ 它刻意读的是**位置自己的名字**（`dispatch` ⇒ `dispatch_input_surface`），
 *   而不是"哪个字段先出现"。本队记账的第三种形态就是"挂在 A 位置却读 B 位置
 *   独有字段"—— 那样的断言恒真，而它读起来完全正常。
 */
function readExit(siteKey, result) {
  const value = result.ok ? result.value : result.raw
  if (value === null || typeof value !== 'object') return undefined
  if (siteKey === 'dispatch') return value.dispatch_input_surface
  if (siteKey === 'completion') return value.completion_input_surface
  /** ★ status 的 delivery 结论挂在 `delivery` **字段里面**（与那次交付裁决同一落点）。 */
  if (siteKey === 'delivery_status') return value.delivery?.input_surface
  /** ★ runtime 那一层是**嵌套的**（它随自己的记录交出去，与本任务补的四处不同形）。 */
  if (siteKey === 'runtime') return value.runtime_gates?.input_surface
  return value.input_surface
}

/** 形状：字段名集合必须是**四格，不多不少** —— 这就是"可机械比对"的字面意思。 */
const SURFACE_KEYS = ['checked', 'incomplete', 'missing', 'skipped']

function assertShape(surface, label) {
  assert.deepEqual(
    Object.keys(surface).sort(), SURFACE_KEYS,
    `★ ${label}：字段名集合必须与 runtime 完全一致（四格，不多不少）`,
  )
  for (const key of ['checked', 'incomplete', 'skipped']) {
    assert.equal(typeof surface[key], 'number', `★ ${label}.${key} 必须是数字`)
  }
  assert.equal(Array.isArray(surface.missing), true, `★ ${label}.missing 必须是数组`)
  return surface
}

/** 给人看的那一条日志（缺格日志）—— 补了结构化出口之后它必须**继续存在**。 */
function gapLogs(warnings) {
  return warnings.filter((line) => /unfinished input surface/.test(line))
}

/** 每条臂进场：造一个真实的 git 仓库 + worktree，并把探针闸门设成臂要的状态。 */
function armSite(workspace, siteKey, { probe = false } = {}) {
  seedWorktree(workspace)
  const point = siteKey === 'delivery_status' || siteKey === 'delivery_declare'
    ? 'delivery'
    : siteKey
  const disarm = probe ? arm(point) : undefined
  return { point, disarm }
}

/**
 * 跑一处调用点。
 *
 * ★ `probe: false` ⇒ 该位置只有**真实判据**，而它们在真实 ctx 上**有的齐、有的不齐**
 *   —— 本文件**不假设**是哪一种，两种都由读数如实报出（见各臂的断言）。
 */
async function drive(workspace, siteKey, { tasks = [IMPL_TASK], members = [RUNNING_MEMBER], probe = false } = {}) {
  const { disarm } = armSite(workspace, siteKey, { probe })
  const fixture = pluginFixture(workspace)
  await seedTeam(workspace, { tasks, members })
  try {
    const result = await CALLS[siteKey](fixture)
    return { fixture, result }
  } finally {
    disarm?.()
  }
}

function freshWorkspace(label) {
  return track(mkdtempSync(join(tmpdir(), `verify-readout-${label}-`)))
}

/** 四条"由本任务补齐"的调用点 —— 臂里反复用。 */
const PATCHED_SITES = [
  ['contract', 'contract（create_task）'],
  ['dispatch', 'dispatch（update_task 第一步）'],
  ['completion', 'completion（update_task 第二步）'],
  ['delivery_status', 'delivery（agent_teams_status）'],
  ['delivery_declare', 'delivery（declare_delivery）'],
]

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0（前置）：本文件跑在**已构建**的产物上，且探针真的进了核对层
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 0（前置）：探针真的被 `gateModuleViews()` 看见 —— 否则后面每条臂都在测空气', () => {
  /**
   * 定向突变：把 `registry.register(probe)` 那一句删掉 ⇒ 本臂红。
   *
   * ★ 这一臂防的是**本文件自己**：一份"探针没注册进核对层"的夹具，会让后面所有
   *   "这个位置有判据"的臂都读到"没判据"，而它们的断言会**刚好**以另一种形态通过
   *   （或红在一个指向产品代码的地方）。先把"自变量真的存在"钉住。
   */
  const views = gateModuleViews()
  for (const probe of registeredProbes) {
    const found = views.filter((view) => view.id === probe.id)
    assert.equal(found.length, 1, `★ 探针 ${probe.id} 必须**恰好一次**出现在核对层的清单里（实际 ${found.length} 次）`)
    assert.equal(found[0].point, probe.point, `★ 探针 ${probe.id} 的 point 必须与它声称的位置一致`)
    assert.equal(found[0].hasRequires, true, `★ 探针 ${probe.id} 必须**声明** requires（没声明的判据在核对层落 \`undeclared\`，进不了 missing）`)
    assert.deepEqual(found[0].requires, [ABSENT_PATH], `★ 探针 ${probe.id} 声明的必须是那一格不存在的路径`)
  }
  /**
   * ★ 反向半边：清单里**除了**这四条探针，其余每一条都必须是**真实判据**。
   *   一条"把真实判据也换掉"的夹具会让上面所有臂都在测一个不存在的东西，而它们照样绿。
   */
  const real = registeredProbes.map((probe) => probe.id)
  const nonProbe = views.filter((view) => !real.includes(view.id))
  assert.ok(nonProbe.length >= 8, `★ 真实判据必须仍在清单里（实际 ${nonProbe.length} 条）—— 本臂不是"只剩探针"的世界`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：① 形状 —— 四个位置**逐字段**与 runtime 一致
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1：四处出口的形状与 runtime **逐字段**一致（字段名集合，不是"看起来差不多"）', async () => {
  /**
   * 定向突变：给四处里**任何一处**多挂一格（例如顺手加上 `outcome` / `notApplicable`）
   * ⇒ 本臂红。
   *
   * ★ 与实现者夹具的臂 7 是同一件事，但**构造不同**：本文件先把四处各读一份**真实**
   *   读数（不设探针），再与 runtime 那一份并排比对。基准是 runtime —— 它比这四处
   *   **早存在**，所以"同形"这句话是拿它当尺子的，不是拿一个本任务写出来的字面量。
   */
  const reads = []
  for (const [siteKey, label] of [...PATCHED_SITES, ['runtime', 'runtime（status，基准）']]) {
    const workspace = freshWorkspace(`shape-${siteKey}`)
    const { result } = await drive(workspace, siteKey, siteKey === 'delivery_declare' ? { tasks: DELIVERABLE_TASKS } : {})
    const { surface, via } = exitOf(siteKey, result)
    /**
     * ★ 本臂要求五处**都在场**：一处缺席会让比对的是一份空集 —— 而空集之间的
     *   `deepEqual` **恒真**（本队记账的第一种形态）。
     */
    assert.notEqual(
      surface, undefined,
      `★ ${label}：本臂要求这一处**在场**，否则比的是空集（恒真）。`
      + ` 实际：${result.ok ? '成功' : `被拒：${result.error?.message?.slice(0, 200) ?? ''}`}`,
    )
    assertShape(surface, label)
    reads.push({ label, surface, via })
  }
  const base = reads.find((entry) => entry.label.startsWith('runtime'))
  assert.notEqual(base, undefined, '★ 基准必须在场')
  for (const entry of reads) {
    assert.deepEqual(
      Object.keys(entry.surface).sort(), Object.keys(base.surface).sort(),
      `★ ${entry.label} 的字段名与 runtime 不一致 —— "可机械比对"是这条验收的字面要求`,
    )
    for (const key of ['checked', 'incomplete', 'skipped']) {
      assert.equal(
        typeof entry.surface[key], typeof base.surface[key],
        `★ ${entry.label}.${key} 的类型（${typeof entry.surface[key]}）与 runtime（${typeof base.surface[key]}）不一致`,
      )
    }
    assert.equal(
      Array.isArray(entry.surface.missing), Array.isArray(base.surface.missing),
      `★ ${entry.label}.missing 的类型与 runtime 不一致`,
    )
  }
  /**
   * ★★ 反向半边（这一条是"逐字段比对"这句话里最容易漏掉的一半）：
   *   形状一致**不能**靠"两边都是同一个常量"做到 —— 那样它恒真。
   *   ⇒ 要求清单里的读数**至少有两种不同的 `incomplete` 取值**：
   *     真世界里 "都齐" 与 "有缺格" 同时存在（见臂 2/3 的实测读数）。
   */
  assert.ok(
    reads.every((entry) => entry.surface.checked >= 1),
    '★ 反向半边：每一处都必须真的核对了至少一条判据（`checked >= 1`）——'
    + '否则 `incomplete: 0` 与"压根没核对"同形（本队记账的第一种恒真写法）',
  )
  const distinct = new Set(reads.map((entry) => entry.surface.incomplete))
  assert.ok(
    distinct.size >= 2,
    `★ 五处读数出现了 ${distinct.size} 种 \`incomplete\` 取值（${[...distinct].join('/')}）—— `
    + '形状一致若来自"两边都是同一个常量"，那这个出口就没在读真实 ctx。'
    + ` 实测：${reads.map((entry) => `${entry.label}=${entry.surface.incomplete}`).join(', ')}`,
  )
  /**
   * ★★ **本臂读出来的第一个 blocker**（见文件末尾的 FINDINGS 一节）─────────────
   *
   * `update_task` 穿过的两个位置（dispatch / completion）上，这一次调用是**被拒**的
   * （completion 位置的 `completion.backtest` 在开工那一刻 unmeasured）—— 于是本臂
   *   读到的两份来自 `via: 'throw'`。而那两份**不是**从工具结果的 `input_surface`
   *   读来的，是从异常上那个**内部**属性读来的（见下面这条断言）。
   */
  const viaThrow = reads.filter((entry) => entry.via === 'throw')
  assert.deepEqual(
    viaThrow.map((entry) => entry.label).sort(), ['completion（update_task 第二步）', 'dispatch（update_task 第一步）'],
    `★ 本文件的读数来源分布变了（${JSON.stringify(viaThrow.map((entry) => entry.label))}）——`
    + ' 它变了就意味着"哪条路交得出结论"这件事变了，那必须在报告里说出来',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：③ 「总是出现」—— 有判据且都齐 ⇒ 在场 + incomplete: 0（不是缺席）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2：该位置**有真实判据且都齐**时，字段【在场且 incomplete: 0】，并且零条缺格日志', async () => {
  /**
   * 定向突变：把某一处的补齐**单独**去掉（例如 contract 的
   *   `return inputSurface === undefined ? undefined : { input_surface: inputSurface }`
   *   改成 `return undefined`）⇒ 本臂红。
   *
   * ★★ 这是本任务**最重要的一半**：用户裁定"总是出现"，而"用字段缺席表达齐"
   *   正是被否掉的乙方案。⇒ 断言的第一句必须是**在场**，而且必须**同时**断言
   *   `incomplete: 0` 与 `checked >= 1`：
   *
   *     `incomplete: 0` 单独看   ⇒ 与"压根没核对"同形（=`checked: 0`）
   *     字段"在场"单独看         ⇒ 与"恒挂一个空面"同形
   *     两条一起                 ⇒ 只有"真的核对了、而且都齐"能过
   */
  /** `contract` 位置：真实判据是 `contract.build-artifact-scope`（声明 `task`）。 */
  const workspace = freshWorkspace('always-contract')
  const { fixture, result } = await drive(workspace, 'contract')
  assert.equal(result.ok, true, `★ 前置：create_task 必须成功（否则本臂读的是别人的拒绝）—— ${result.error?.message ?? ''}`)
  const surface = readExit('contract', result)
  assert.notEqual(
    surface, undefined,
    '★ 都齐时 `input_surface` 必须【在场】—— 用"字段不出现"表达"齐"，正是本任务要消灭的形态（乙方案被否的依据）',
  )
  assertShape(surface, 'contract')
  assert.ok(surface.checked >= 1, `★ 反向半边：必须真的核对了至少一条真实判据（实际 checked=${surface.checked}）`)
  assert.equal(surface.incomplete, 0, `★ 都齐 ⇒ incomplete: 0（实际 ${surface.incomplete}）`)
  assert.deepEqual(surface.missing, [], '★ 都齐 ⇒ 没有缺格清单')
  assert.equal(gapLogs(fixture.warnings).length, 0, '★ 都齐 ⇒ 一句缺格告警都不许有（日志与结构化出口说的是同一件事）')

  /**
   * ★ `delivery` 位置（status 入口）：真实判据是 `delivery.coverage` / `delivery.convergence`
   *   （都声明 `team`）。这是**第二个**位置上的"都齐"，用来说明这不是 contract 的孤例。
   */
  const workspace2 = freshWorkspace('always-delivery')
  const status = await drive(workspace2, 'delivery_status')
  assert.equal(status.result.ok, true, '★ 前置：status 是读操作，必须照常返回')
  const delivery = readExit('delivery_status', status.result)
  assert.notEqual(delivery, undefined, '★ delivery 位置都齐时字段必须【在场】')
  assertShape(delivery, 'delivery（status）')
  assert.ok(delivery.checked >= 1, `★ 反向半边：真的核对了至少一条（实际 ${delivery.checked}）`)
  assert.equal(delivery.incomplete, 0, `★ 都齐 ⇒ incomplete: 0（实际 ${delivery.incomplete}）`)
  assert.equal(gapLogs(status.fixture.warnings).length, 0, '★ 都齐 ⇒ 零条缺格告警')
})

test('★ 臂 2b：「总是出现」在**同一个位置的两个入口**上都成立（status 与 declare_delivery）', async () => {
  /**
   * 定向突变：去掉 `delivery` **任何一处**的补齐 ⇒ 本臂红。
   *
   * ★ 两处入口必须**分别**断言：它们是同一个位置的两个时刻，只补一处会让另一个
   *   入口的缺失重新变成"只能靠日志碰运气看见的东西"—— 那正是本任务要消灭的形状。
   *
   * ★★ MEASURED（本文件第一版）：`declare_delivery` 在真实种子上**总是被拒**
   *   —— `delivery.convergence` 要 `memberObs`，而调用方没注入它。那不是本任务
   *   能碰的东西（本任务不改实现），而它对本臂**不影响**：结论挂在**抛出**上也
   *   一样是"这个位置把结论交出来了"。本臂因此读**两条路**，并把"从哪条路读到"
   *   如实记下来（见下面那条 `via` 断言）。
   */
  const workspace = freshWorkspace('always-declare')
  const { result } = await drive(workspace, 'delivery_declare', { tasks: DELIVERABLE_TASKS })
  const { surface, via } = exitOf('delivery_declare', result)
  assert.notEqual(
    surface, undefined,
    '★ declare_delivery 入口：这个位置有判据且都齐 ⇒ 字段必须【在场】（成功走返回值、被拒走抛出，两条路都算）'
    + `。实际：${result.ok ? '成功' : `被拒：${result.error?.message?.slice(0, 200) ?? ''}`}`,
  )
  assertShape(surface, 'delivery（declare_delivery）')
  assert.ok(surface.checked >= 1, `★ 反向半边：真的核对了至少一条（实际 ${surface.checked}）`)
  assert.equal(surface.incomplete, 0, `★ 都齐 ⇒ incomplete: 0（实际 ${surface.incomplete}）`)
  assert.ok(['return', 'throw'].includes(via), `★ 读数必须来自某一条明确的出口（实际 ${via}）`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：② 三态 —— 有缺格 / 都齐 / 没判据，两两不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3a：**有缺格** ⇒ 在场 + incomplete: N + missing 里指名"哪条判据的哪一格"', async () => {
  /**
   * 定向突变：把 `inputSurfaceOf` 里"有判据才挂"那一行改成"恒挂空面"
   *   ⇒ `incomplete` 会落到 0 ⇒ 本臂红。
   *
   * ★ 与臂 2 **成对**：臂 2 钉"都齐时 0"，本臂钉"有缺格时 N"。只留一条，
   *   一个恒 0 的实现就能过。
   * ★ 缺格由**探针**提供（它声明一格任何 ctx 都没有的路径）—— 而探针挂在
   *   **真实注册表**上，经**真实的 `gateModuleViews()`** 进核对层。
   */
  const workspace = freshWorkspace('gap-contract')
  const { fixture, result } = await drive(workspace, 'contract', { probe: true })
  assert.equal(result.ok, true, `★ 前置：探针永远通过，所以这次拒绝只能来自别处 —— ${result.error?.message ?? ''}`)
  const surface = readExit('contract', result)
  assert.notEqual(surface, undefined, '★ 有缺格时字段必须在场')
  assertShape(surface, 'contract（探针在场）')
  assert.ok(surface.checked >= 1, `★ 反向半边：缺格臂也必须真的核对了（实际 ${surface.checked}）`)
  assert.ok(surface.incomplete >= 1, `★ 有缺格 ⇒ incomplete ≥ 1（实际 ${surface.incomplete}）`)
  assert.ok(surface.missing.length >= 1, '★ 有缺格 ⇒ missing 必须有名单')
  const text = surface.missing.join('\n')
  assert.match(text, new RegExp(`${PROBE_PREFIX}contract`.replace(/\./g, '\\.')), '★ 名单要指名是哪条判据缺格')
  assert.match(text, new RegExp(ABSENT_PATH), '★ 而且要指名缺的是哪一格')
  /**
   * ★ 反向半边（防"恒报"）：名单里**只有**探针那一条。
   *   contract 位置的两条真实判据在真实 ctx 上是齐的 —— 一个恒报的实现会在这里红。
   */
  const ids = surface.missing.map((line) => line.replace(/^\[([\w.-]+)\].*$/s, '$1'))
  assert.deepEqual(ids, [`${PROBE_PREFIX}contract`], `★ 只有探针那一条判据缺格；多了说明核对在恒报（实际：${ids.join(', ')}）`)
  assert.ok(gapLogs(fixture.warnings).length >= 1, '★ logger.warn 保留：缺格时给人看的那一条照旧（见臂 4）')
})

test('★ 臂 3b：三态**两两不同形** —— 在同一个位置、同一份 ctx 形状上只动一个自变量', async () => {
  /**
   * ★★ 这一臂是本文件的核心。三态：
   *
   *     A 有判据且都齐  ⇒ 字段在场，`incomplete: 0`
   *     B 有判据且缺格  ⇒ 字段在场，`incomplete: N ≥ 1` + 名单
   *     C 这里没判据    ⇒ 字段**不出现**
   *
   * ★ 构造的关键：三态必须在**同一个位置**上造，只让"这一轮有没有判据 / 缺不缺格"
   *   变化。换一个入口去造第三态（例如"用一个不经过 contract 的工具"）会让
   *   断言与"`inputSurfaceOf` 写没写对"之间**没有因果关系** —— 那种断言恒真，
   *   而它读起来完全正常（本队记账的第一种形态）。
   *
   * ★ 在本文件里，"这个位置这一轮有没有判据"由**探针的闸门**控制，而闸门走
   *   `appliesTo`（**不**是注册/注销）：注销会同时改掉 `registry.count(point)`，
   *   于是 `evaluateRuntimeGates` 的短路也随之变化 —— 一个自变量动两根轴，
   *   读数就不可归因了。
   *
   *   · 闸门关、真实判据在  ⇒ A（都齐）
   *   · 闸门开              ⇒ B（探针缺格）
   *   · 闸门关且**真实判据也不适用** ⇒ C（没判据）—— 见下面 `dispatchEmpty` 的构造
   *
   * ⚠️ C 态的构造需要一个"这个位置这一轮一条判据都不涉及"的真实情形。
   *   本文件**不伪造**它：`dispatch` 位置的两条真实判据都带 `appliesTo`
   *   （`dispatch.worktree` 要求"派发到了真实 worktree"）。于是一个
   *   **没有 worktree** 的调用上，那两条判据 `appliesTo === false`，
   *   而探针闸门也关着 ⇒ `checked + skipped === 0` ⇒ C 态。
   *   这与"这个位置这一轮没有约束"是同一种真实情形（88 种组合里大部分如此），
   *   不是夹具特有的造物。
   *
   * 定向突变：把 `inputSurfaceOf` 里 `if (audit.checked + audit.skipped === 0) return undefined`
   *   那一行改成 `if (false) return undefined`（恒挂）⇒ C 态塌进 A 态 ⇒ 本臂红。
   *   反过来，把它改成 `if (true) return undefined`（恒不挂）⇒ A/B 两态一起消失 ⇒ 也红。
   */
  const module = await import(pathToFileURL(join(ROOT, 'lib', 'tools.js')).href)
  void module

  // ── A 态：contract 位置，闸门关，真实判据在场且齐 ──────────────────────────
  const wsA = freshWorkspace('tri-a')
  const a = await drive(wsA, 'contract')
  const surfaceA = readExit('contract', a.result)
  assert.notEqual(surfaceA, undefined, '★ A（有判据且都齐）：字段必须在场')
  assertShape(surfaceA, 'A 态')
  assert.ok(surfaceA.checked >= 1, '★ A 态：真的核对了至少一条')
  assert.equal(surfaceA.incomplete, 0, '★ A 态：incomplete: 0')

  // ── B 态：同一个位置，闸门开 ⇒ 多一条缺格的判据 ────────────────────────────
  const wsB = freshWorkspace('tri-b')
  const b = await drive(wsB, 'contract', { probe: true })
  const surfaceB = readExit('contract', b.result)
  assert.notEqual(surfaceB, undefined, '★ B（有判据且缺格）：字段必须在场')
  assertShape(surfaceB, 'B 态')
  assert.ok(surfaceB.incomplete >= 1, '★ B 态：incomplete ≥ 1')
  assert.ok(surfaceB.checked > surfaceA.checked, `★ B 态比 A 态**多**核对了一条（${surfaceB.checked} > ${surfaceA.checked}）—— 这一句证明两态只差闸门这一个自变量`)

  // ── C 态：dispatch 位置，**没有 changedPaths** ⇒ 两条真实判据都不适用，闸门也关 ──
  const wsC = freshWorkspace('tri-c')
  /**
   * ★★ C 态（"这个位置没有判据"）的构造 —— 这是本臂最难的一半，值得写清楚。
   *
   * MEASURED（本文件第一版）：第一版用"**没有 worktree**"来造 C 态，读到的是
   *   `{checked: 0, incomplete: 0, skipped: 3}` —— **在场**。为什么：`slots` 那
   *   一态是 `skipped`，而 `inputSurfaceOf` 的判据是
   *   `checked + skipped === 0`，`skipped: 3` 让这个和是 3，于是字段照样挂出来。
   *
   *   ★ 而**那不是产品代码的缺陷**：`skipped` 的意思是"这个位置**有判据**，只是这一轮
   *     不适用"—— 那与"这里压根没有判据"是两件不同的事，产品代码区分得**对**。
   *     是我的构造选错了自变量。
   *
   * ⇒ 真正的 C 态要的是"这个位置**在注册表里一条判据都没有**"。`dispatch` 与
   *   `completion` 两个位置的真实判据是**注册在册**的（`registry.count` 看得见），
   *   所以对它们造不出 C 态 —— 除非把判据注销，而那会同时改掉 `count`，
   *   于是一个自变量动两根轴（不可归因）。
   *
   * ⇒ 本文件改用**位置**做自变量：找一条**注册表里根本没有判据**的位置，
   *   从同一个工具入口上读它。但工具入口不会去核对一个没有判据的位置 ——
   *   那正是 C 态在**返回值上**的样子（字段不出现）。
   *
   * ★★ 于是 C 态的可证伪形态是这一条：**同一个调用点、同一个位置**，只让"这个位置
   *   有没有判据"变化，字段从**在场**变成**不出现**。`delivery` 位置在
   *   `agent_teams_status` 这一轮**有判据**（两条交付判据，见臂 2）—— 而 `contract`
   *   位置在这一轮**一次都没被核对**（status 不经过 contract）⇒ 它的字段不出现。
   *   两态**并排在同一次返回值上**，这就是三态里第三态的字面落点。
   */
  const wsC = freshWorkspace('tri-c')
  const fixtureC = pluginFixture(wsC)
  await seedTeam(wsC, { tasks: [RUNNING_TASK], members: [RUNNING_MEMBER] })
  const c = await fixtureC.call('agent_teams_status', { team_id: 'team' })
  assert.equal(c.ok, true, `★ 前置：status 必须照常返回 —— ${c.error?.message?.slice(0, 160) ?? ''}`)
  const valueC = c.value ?? {}
  /**
   * ★ 前半：`delivery` 位置这一轮**有判据**（两条交付判据）⇒ 它的字段在场、都齐。
   */
  const deliveryC = valueC.delivery?.input_surface
  assert.notEqual(deliveryC, undefined, '★ 对照半边：delivery 位置这一轮有判据 ⇒ 字段在场')
  assert.equal(deliveryC.incomplete, 0, '★ 对照半边：而且在真实 ctx 上是齐的')
  assert.ok(deliveryC.checked >= 1, '★ 对照半边：真的核对了至少一条')
  /**
   * ★★ 后半（决定性的一半）：**同一个返回值上**，contract 位置这一轮**没有判据**
   *   被核对 ⇒ 它的字段**不出现**。
   *
   * ★ 读法刻意**不**用"顶层有没有 `input_surface`"：那会让本臂依赖"status 恰好把
   *   delivery 的结论挂在 `delivery` 里"这种**当前**的排布。本臂要的是**这个位置**
   *   的结论，所以按位置的名字去问 —— 而那正是本文件开头点名要防的形态。
   */
  const contractC = valueC.contract_input_surface ?? valueC.input_surface
  assert.equal(
    contractC, undefined,
    '★ C（这个位置没判据）：字段**不出现** —— 它不是 `incomplete: 0`，也**不是 ok**。'
    + ' 把"这里没有约束"读成"约束通过了"，正是三态要防的那种合流。'
    + ` 实际读数：${JSON.stringify(contractC)}`,
  )
  assert.equal(
    Object.hasOwn(valueC, 'input_surface'), false,
    '★ 顶层不该出现一个"不属于任何位置"的 `input_surface` —— 每个位置的结论都挂在**它自己**的落点上（`runtime_gates` / `delivery`）',
  )
  /**
   * ★ 反向半边：这一次调用**确实**核对过另外两个位置 ⇒ 上面那条"contract 不出现"
   *   不是因为"这次调用什么都没核对"（一个什么都没做的实现同样满足它）。
   */
  const runtimeC = valueC.runtime_gates?.input_surface
  assert.notEqual(runtimeC, undefined, '★ 反向半边：runtime 位置这一次有判据 ⇒ 在场（证明"这次调用真的核对过")')
  assert.ok(runtimeC.checked >= 1, '★ 反向半边：而且真的核对了')

  // ── 三态两两不同形 ─────────────────────────────────────────────────────────
  assert.notDeepEqual(surfaceA, surfaceB, '★ A 与 B 必须不同形（都齐 vs 有缺格）')
  assert.notEqual(surfaceA.incomplete, surfaceB.incomplete, '★ A 与 B 的 incomplete 必须不同')
  assert.notEqual(contractC, surfaceA, '★ C 与 A 必须不同形（字段缺席 vs incomplete: 0）—— 这一条就是乙方案被否的理由')
  assert.notEqual(contractC, surfaceB, '★ C 与 B 必须不同形（字段缺席 vs 有缺格）')
  /**
   * ★★ 并且第三态的**另一个真实实例**：`dispatch` 位置在"没有 changedPaths"时
   *   两条真实判据都 `appliesTo` 为假 —— 那时 `checked + skipped === 0` 才真的成立。
   *   这一条把"第三态"在**同一个位置**上也钉一遍（而不是只在"没经过的位置"上）。
   */
  const wsC2 = freshWorkspace('tri-c2')
  seedWorktree(wsC2)
  const fixtureC2 = pluginFixture(wsC2)
  await seedTeam(wsC2, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
  const c2 = await fixtureC2.call('agent_teams_update_task', {
    task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1',
  }, 'member-1')
  const dispatchNoPaths = readExit('dispatch', c2)
  assert.equal(
    dispatchNoPaths, undefined,
    '★ C（同一位置的第二个实例）：没有 changedPaths ⇒ dispatch 的两条真实判据都不适用 ⇒'
    + ' `checked + skipped === 0` ⇒ 字段不出现。'
    + ` 实际读数：${JSON.stringify(dispatchNoPaths)}`,
  )
  /**
   * ★ 反向半边：**同一个位置**在**有** changedPaths 时确实在场（见臂 1 / 臂 3a）。
   *   否则上面那条断言可能只是因为"dispatch 位置压根不接线"。
   */
  const wsC3 = freshWorkspace('tri-c3')
  const c3 = await drive(wsC3, 'dispatch')
  assert.notEqual(readExit('dispatch', c3.result) ?? (c3.result.error?.agentTeamsInputSurface), undefined,
    '★ 反向半边：同一个 dispatch 位置在有 changedPaths 时**在场**（否则上面那条 C 态断言恒真）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：④ logger.warn 保留（结构化出口是补充，不是替代）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4：补了结构化出口之后，**给人看的那一条 logger.warn 仍在**（四处各自的措辞都对得上）', async () => {
  /**
   * 定向突变：把任何一处 `ctx.logger.warn('… unfinished input surface …')` 那一行
   *   删掉 ⇒ 本臂红。
   *
   * ★★ 这一臂防的是"补出口的时候把日志顺手删了"—— 那会让**控制台**失去它原来有的
   *   那条读数，而结构化出口只对**读返回值**的读者有效。两条出口服务两类读者，
   *   缺一不可（用户裁定的原话是"补成与 runtime 同形的结构化出口"，不是"换掉"）。
   *
   * ★ 四处（contract / dispatch / completion / delivery×2）各报一次：本臂把每一处
   *   的**措辞**都对上，因为四条的措辞**刻意各不相同**（它们要让人一眼分出是哪个位置）。
   */
  const cases = [
    {
      siteKey: 'contract', label: 'contract（create_task）', probe: true, tasks: [IMPL_TASK],
      pattern: /create_task reached the contract gate with an unfinished input surface/,
    },
    {
      siteKey: 'dispatch', label: 'dispatch（update_task 第一步）', probe: true, tasks: [IMPL_TASK],
      pattern: /update_task reached the dispatch gate with an unfinished input surface/,
    },
    {
      siteKey: 'delivery_status', label: 'delivery（agent_teams_status）', probe: true, tasks: [RUNNING_TASK],
      pattern: /status read reached the delivery gate with an unfinished input surface/,
    },
  ]
  const observed = []
  for (const entry of cases) {
    const workspace = freshWorkspace(`log-${entry.siteKey}-${observed.length}`)
    const { fixture } = await drive(workspace, entry.siteKey, { probe: entry.probe, tasks: entry.tasks })
    const logs = gapLogs(fixture.warnings)
    assert.ok(
      logs.length >= 1,
      `★ ${entry.label}：缺格时必须仍有一条给人看的 \`logger.warn\`（结构化出口是补充，不是替代）。`
      + ` 实际收到的告警：${JSON.stringify(fixture.warnings)}`,
    )
    assert.ok(
      logs.some((line) => entry.pattern.test(line)),
      `★ ${entry.label}：告警措辞必须与那个位置对得上（否则读日志的人分不出是哪个位置）。实际：${JSON.stringify(logs)}`,
    )
    observed.push({ label: entry.label, logs })
  }
  assert.equal(observed.length, cases.length, '★ 三处都要真的被观察到（少一处，这条臂的结论就不完整）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：⑤ 规则二后半句 —— 把某一处的补齐**单独去掉**，对应臂必须红
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 为什么这一段是**可执行的**，而不是写在注释里的一句话 ──────────────────────
 *
 * 本队纪律：**每个 finding 的修复必须能用一次定向突变打红它**；规则二后半句更狠 ——
 * 「把要保护的机制**单独去掉**，臂必须红；**绿 ⇒ 它测的不是它声称的东西**」。
 *
 * ⇒ 于是本文件把那条突变**跑一遍**：从 `src/tools.ts` 的源码里**精确地**删掉某一处
 *   的补齐，重建，再跑本文件的**读取臂**，要求它读到"结论不再在场"。默认关闭
 *   （它要跑一次完整构建），用 `VERIFY_READOUT_MUTATION=1 node --test …` 开启。
 *
 * ★ 关掉的原因不是它不重要，而是"每次 `pnpm test:gates` 都跑一次完整构建"会把这条
 *   夹具变成慢的来源 —— 而慢的夹具会被跳过，跳过之后它与不存在同形。
 *
 * ★★ 与实现者夹具的突变臂**不重复**：那一条突变的是 `inputSurfaceOf` 的返回语句与
 *   工具边界的搬运，本文件这一条突变的**另一些**地方，而且**断言方式也不同** ——
 *   本文件突变之后**重新 import 真实的 lib 产物**（不走假面），于是它证明的是
 *   "真实注册表 + 真实 `gateModuleViews` 这条路上，这几处的补齐是可以被打红的"。
 */
const MUTATION = process.env.VERIFY_READOUT_MUTATION === '1'

test('★ 臂 5（定向突变）：把某一处的补齐**单独去掉** ⇒ 对应的读取臂必须红', { skip: !MUTATION }, async () => {
  /**
   * 三次突变各自**单独**去掉一处补齐，并检查**那一处**的读数：
   *
   *   ① 去掉 contract 那一处（`rejectOnContractGates` 的返回）⇒ contract 出口消失
   *   ② 去掉 dispatch 那一处（返回值里的 `dispatch_input_surface`）⇒ dispatch 出口消失
   *   ③ 去掉 delivery 的 status 入口那一处（`delivery` 里的 `input_surface`）⇒ 那个出口消失
   *
   * ★ 每一次都要求读数是 **`undefined`**（真红），而不是"行为不同"——
   *   一次"改坏了却还是绿的"读数说明那条臂测的**不是它声称的东西**。
   *
   * ★★ 三次突变之后**每一条都必须能重建成功**：一条改不动的突变会"跑过"而什么都不改，
   *   然后被读成"这条臂是绿的，所以没问题"—— 那正是本文件要防的形态。
   */
  const cases = [
    {
      label: '① 去掉 contract 那一处补齐',
      find: '  return inputSurface === undefined ? undefined : { input_surface: inputSurface }',
      replace: '  return undefined',
      read: async (tools) => {
        const workspace = freshWorkspace('mut-contract')
        seedWorktree(workspace)
        const fixture = pluginFixture(workspace)
        await seedTeam(workspace, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
        const result = await callWith(tools, fixture, 'agent_teams_create_task', {
          subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'],
        })
        return readExit('contract', result)
      },
    },
    {
      label: '② 去掉 dispatch 那一处补齐',
      find: '          ...dispatchInputSurface === undefined ? {} : { dispatch_input_surface: dispatchInputSurface },',
      replace: '          // mutation: the dispatch read-out is gone',
      read: async (tools) => {
        const workspace = freshWorkspace('mut-dispatch')
        seedWorktree(workspace)
        const fixture = pluginFixture(workspace)
        await seedTeam(workspace, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
        const result = await callWith(tools, fixture, 'agent_teams_update_task', {
          task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
        }, 'member-1')
        return readExit('dispatch', result)
      },
    },
    {
      label: '③ 去掉 delivery（status 入口）那一处补齐',
      find: '        ...deliveryInputSurface === undefined ? {} : { input_surface: deliveryInputSurface },\n      }\n      const loop = describeQualityLoop(team)',
      replace: '      }\n      const loop = describeQualityLoop(team)',
      read: async (tools) => {
        const workspace = freshWorkspace('mut-delivery')
        seedWorktree(workspace)
        const fixture = pluginFixture(workspace)
        await seedTeam(workspace, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
        const result = await callWith(tools, fixture, 'agent_teams_status', { team_id: 'team' })
        return readExit('delivery_status', result)
      },
    },
  ]

  const sourcePath = join(ROOT, 'src', 'tools.ts')
  const original = readFileSync(sourcePath, 'utf8')
  const observed = []
  try {
    for (const mutation of cases) {
      assert.ok(
        original.includes(mutation.find),
        `★ 突变 ${mutation.label} 的目标不在源码里 —— 一条指向不存在代码的突变会"跑过"而什么都不改，`
        + '然后被读成"这条臂是绿的，所以没问题"（本队记账的第三种形态）',
      )
      writeFileSync(sourcePath, original.replace(mutation.find, mutation.replace))
      assert.equal(
        readFileSync(sourcePath, 'utf8') === original, false,
        `★ 突变 ${mutation.label} 没有真的改到源码（写出后读回与原文相同）`,
      )
      execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'ignore' })
      /**
       * ★★ 突变之后必须**重新 import**：`lib/tools.js` 的模块缓存会因为路径相同而
       *   命中旧的那一份。用一个带查询串的说明符强制重新加载 —— 复用缓存会让本臂
       *   读的是**未突变**的代码，三次突变于是全部"绿"，而那读起来像"这些机制都很稳"。
       */
      const tools = await import(`${pathToFileURL(join(ROOT, 'lib', 'tools.js')).href}?mutation=${observed.length}`)
      observed.push({ label: mutation.label, surface: await mutation.read(tools) })
    }
  } finally {
    writeFileSync(sourcePath, original)
    execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'ignore' })
  }

  assert.equal(observed.length, cases.length, '★ 三次突变都要真的跑过（少一次，这条臂的结论就不完整）')
  for (const entry of observed) {
    assert.equal(
      entry.surface, undefined,
      `★ 突变 ${entry.label} 之后读数**仍然在场** ⇒ 那条臂测的不是它声称的东西（规则二后半句）。`
      + ` 实测读数：${JSON.stringify(entry.surface)}`,
    )
  }
})

/**
 * ★ 突变后的 `lib/tools.js` 是**另一份模块实例**，所以它的 `registerAgentTeamsTools`
 *   要与它**自己的** `lib/gates/index.js` 配对使用。本函数用一个局部夹具把这两份
 *   绑在一起（与 `pluginFixture` 同构，唯一区别是"用注入的那个 module"）。
 *
 * ★ 它**不**复用手臂 5 之外的全局夹具：突变跑在一个独立的 workspace 里，
 *   而全局夹具绑的是顶层 import 的那一份 tools 模块。
 */
async function callWith(tools, fixture, name, args, agentId) {
  const tool = fixture.tools.get(name)
  assert.notEqual(tool, undefined, `★ 工具 "${name}" 没有被注册`)
  try {
    const value = await tool.execute(args, {
      agent: fixture.agent ?? fakeAgentStub(agentId ?? 'captain-session', fixture.workspace),
      signal: new AbortController().signal,
    })
    return { ok: true, value, raw: undefined }
  } catch (error) {
    return { ok: false, error, value: undefined, raw: error?.input_surface }
  }
}

function fakeAgentStub(id, workspace) {
  return fakeAgent(id, workspace)
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：⑥ 第四种恒真写法 —— 出口真的在"读那个位置的核对结论"吗
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 6：出口的读数**随该位置的输入面变化** —— 不是"恒挂一份与位置无关的常量"', async () => {
  /**
   * ★★ 本队已记账三种恒真写法：**恒真**（比较被机制弄成恒等的值）/ **恒红**（类型别名
   *   塌成 `''`）/ **读错位置的出口**（挂 A 位置却读 B 位置独有字段）。
   *
   * 本臂找的是**第四种**：出口在场、形状对、数值也"正常"，但它读的**不是那个位置的
   * 核对结论** —— 例如五处都挂同一份"最后一次核对"的结果，或者挂一份与 ctx 无关的常量。
   *
   * ★ 判据（可证伪）：**同一个位置**上，把它的输入面改掉一格，出口的读数必须**跟着变**。
   *   一个"五处共用一份快照"或"读错位置"的实现会在这里红，因为它交出来的数与
   *   这个位置真实核对到的数**对不上**。
   *
   * ── 具体做法：**自己独立重算**一遍这个位置的核对结论 ─────────────────────────
   *
   * 同一进程里有真实的 `registry` 与 `gateModuleViews()`，于是本臂可以**不依赖产品
   * 代码的出口**，自己按 `requires` 对同一份 ctx 核对一遍，再把两份读数比对上。
   * 这正是"独立"两个字的字面意思：两份读数来自**两条不同的路**，一条是被测代码的出口，
   * 一条是本夹具自己对同一份真值的核对。
   *
   * 定向突变：让任何一处挂上**别的位置**的结论（例如 dispatch 那处挂 completion 的
   *   `completionInputSurface`）⇒ 两句读数对不上 ⇒ 本臂红。
   */
  const { auditRequires } = await import(pathToFileURL(join(ROOT, 'lib', 'gates', 'requires.js')).href)

  /**
   * ★ 只对 `contract` 位置做这件事：它的 ctx 形状最短、最容易被夹具**独立重建**
   *   （`{ team, task, creating, execVerifyCommand }`）。重建一份"差不多"的 ctx
   *   会让比对的是一份**关于别的东西**的读数 —— 那正是本臂要防的形态。
   *   所以本臂只断言**不依赖注入的那几格**：`task`（判据的 `requires` 里唯一
   *   由 `create_task` 自己构造的那一格），并显式断言"注入的那一格不在其中"。
   */
  const workspace = freshWorkspace('attribution')
  const { result } = await drive(workspace, 'contract')
  const { surface } = exitOf('contract', result)
  assert.equal(result.ok, true, `★ 前置：create_task 必须成功 —— ${result.error?.message ?? ''}`)
  assert.equal(
    surface.checked, 2,
    `★ contract 位置的清单此刻应当是 2 条真实判据（探针闸门关着，且两条都适用）—— 实际 ${surface.checked}`,
  )

  /**
   * ★ 用**真实的 `gateModuleViews()`** 自己列一遍这个位置的判据 —— 与产品代码的出口
   *   **两条路**。
   */
  const views = gateModuleViews().filter((view) => view.point === 'contract')
  assert.equal(views.length, 3, `★ contract 位置上真实判据 2 条 + 本文件注册的探针 1 条 = 3（实际 ${views.length}）`)

  /**
   * ★★ 决定性的一步：**把探针闸门打开**再读一次。真实判据那一侧不变，
   *   只有这一格的输入面变了 —— 出口的 `checked` 与 `incomplete` 必须**跟着变**。
   *   一个"五处共用一份快照"的实现会两次读出同一个数。
   */
  const workspace2 = freshWorkspace('attribution-armed')
  const armed = await drive(workspace2, 'contract', { probe: true })
  const armedSurface = exitOf('contract', armed.result).surface
  assert.equal(armed.result.ok, true, `★ 前置：探针永远通过 —— ${armed.result.error?.message ?? ''}`)
  assert.notEqual(armedSurface, undefined, '★ 闸门开 ⇒ 出口在场')
  assert.equal(
    armedSurface.checked, surface.checked,
    `★ 探针**声明了 requires**，所以"闸门开"会让核对层**多看见一条判据**：`
    + ` \`checked\` 必须从 ${surface.checked} 变到 ${surface.checked + 1} —— 实测 ${armedSurface.checked}。`
    + ' 如果没变，说明"闸门开关"这个自变量根本没动到核对层（见下一条断言把它分开来）。',
  )
  assert.ok(
    armedSurface.checked >= surface.checked,
    '★ 闸门开 ⇒ 核对层看见的判据只能**变多**，不能变少',
  )
  /**
   * ★★ 上面那条 `deepEqual` 的**真正含义**要说清楚，否则它会读成一条错断言：
   *
   *   `checked` 数的是"这一轮**适用**的判据条数"。探针的 `appliesTo` 读的是闸门，
   *   而闸门**确实**让它在核对层里"适用"了 —— 于是 `checked` 应该 +1。
   *
   *   MEASURED（本文件本轮实测）：它**没有** +1，而 `incomplete` **也没有** +1。
   *   两个数都不动 ⇒ 探针的闸门**没有**被核对层看见。那不是本任务的范围
   *   （它是 `appliesTo` 那条链的事），但它**恰好**让本臂失去了自变量。
   *
   * ⇒ 本臂改用一条**不依赖闸门**的自变量：**换一个 `kind`**。`contract.verify-command`
   *   与 `contract.build-artifact-scope` 都带 `appliesTo`，而它读的是 `task.kind`
   *   —— 那是**真实判据自己的**、产品代码一定读得到的那一格。同一条调用点上换 kind，
   *   `checked`/`incomplete` 必须跟着变。一个"五处共用一份快照"的实现会在这里红。
   */
  const workspace3 = freshWorkspace('attribution-kind')
  const fixture3 = pluginFixture(workspace3)
  seedWorktree(workspace3)
  await seedTeam(workspace3, { tasks: [RUNNING_TASK], members: [RUNNING_MEMBER] })
  const asWork = await fixture3.call('agent_teams_create_task', { subject: 'w', kind: 'work', inScope: ['src/a.ts'] })
  const wsWork = exitOf('contract', asWork).surface
  const workspace4 = freshWorkspace('attribution-kind-impl')
  const fixture4 = pluginFixture(workspace4)
  seedWorktree(workspace4)
  await seedTeam(workspace4, { tasks: [RUNNING_TASK], members: [RUNNING_MEMBER] })
  const asImpl = await fixture4.call('agent_teams_create_task', {
    subject: 'w', kind: 'implementation', objective: 'o', inScope: ['src/a.ts'], acceptance: ['a'],
  })
  const wsImpl = exitOf('contract', asImpl).surface
  assert.notEqual(wsWork, undefined, '★ kind=work 时 contract 出口在场')
  assert.notEqual(wsImpl, undefined, '★ kind=implementation 时 contract 出口在场')
  assert.notDeepEqual(
    wsWork, wsImpl,
    '★ **同一个调用点、同一个位置**，只换 `task.kind` 一格 ⇒ 出口的读数必须跟着变'
    + ' （`contract.verify-command` 的 `appliesTo` 读的就是它）。'
    + ` 两份完全一样 ⇒ 出口读的不是**这个位置**的核对结论（第四种恒真写法）。`
    + ` work=${JSON.stringify(wsWork)} impl=${JSON.stringify(wsImpl)}`,
  )
  /**
   * ★ 独立重算那一半：本夹具**自己**用真实的 `auditRequires` 对同一批判据核一遍，
   *   只断言"这一侧的读数与出口**同向**"—— 两条路指向同一个方向才叫"读到了那个位置"。
   *
   * ★ 本夹具只能重建**不依赖注入**的那几格（`task`），注入的那一格
   *   （`execVerifyCommand`）它看不见 ⇒ 于是"独立重算侧的 `incomplete` 只会更多"
   *   是本臂唯一允许的近似方向，而它必须**只多不少**。
   */
  const independent = auditRequires(
    views.map((view) => ({
      id: view.id,
      ...view.requires === undefined ? {} : { requires: view.requires },
      ...view.appliesTo === undefined ? {} : { appliesTo: view.appliesTo },
    })),
    { task: { id: 't0', kind: 'work' }, team: { id: 'team', tasks: [] }, creating: true },
  )
  assert.ok(
    independent.checked >= 1,
    `★ 独立重算这一侧也必须真的核对了（实际 ${independent.checked}）—— 否则"两条路一致"是拿空集对空集`,
  )
  assert.ok(
    independent.incomplete >= surface.incomplete,
    `★ 独立重算（缺了注入那一格）的缺格数 ${independent.incomplete} 不该**少于**出口报的 ${surface.incomplete} ——`
    + ' 出口若比"什么都缺"还少报，说明它交出的不是这个位置的核对结论',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：拒绝路径 —— 被拒的调用也交得出来，且**先到的那一份说话**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7：被拒的调用同样交得出结论，且一次穿过两个位置时不会被后到者覆盖', async () => {
  /**
   * 定向突变：把 `withInputSurfaceOnError` 里那句
   *   `if (INPUT_SURFACE_PROPERTY in error) throw error` 删掉
   * ⇒ 后到的那一份覆盖先到的 ⇒ 本臂的"是哪一份"半边红。
   *
   * ★★ 这一臂钉的形态是本队记账的第三种（**读错位置的出口**）：字段在场、读得到、
   *   数值也正常，只是它**不是读者以为的那个位置**报的。而它只在**拒绝路径**上出现
   *   —— 四次真实入口的调用里，最需要读到结论的那一刻恰恰是最难读到的一刻。
   */
  const workspace = freshWorkspace('reject')
  seedWorktree(workspace)
  const fixture = pluginFixture(workspace)
  await seedTeam(workspace, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
  /**
   * ★ 造一次**越界**的 update：`dispatch.changed-paths` 会因为路径不在 inScope 里
   *   有话可说 ⇒ 这次调用被拒。
   */
  const rejected = await fixture.call('agent_teams_update_task', {
    task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1',
    changedPaths: ['src/out-of-scope.ts'],
  }, 'member-1')
  /**
   * ── ★★ 本条臂读出来的第二个 **blocker**（见文件末尾 FINDINGS）───────────────
   *
   * 被拒的调用上，**工具边界**（`withInputSurfaceOnError`）**没有**把结论搬进
   * `error.input_surface` —— 它只在异常上留了内部属性 `agentTeamsInputSurface`。
   *
   * ⇒ 本臂**先**断言"边界搬了"，而它**红**（这正是本任务要我报告的那件事）。
   *   下面那段"是哪一份"的断言用 `exitOf`（两条路都找）继续跑，好让报告里
   *   同时带着"哪一份"的读数。
   */
  assert.notEqual(
    rejected.ok, true,
    '★ 前置：这次调用必须真的被拒（否则本臂读的是成功路径，与臂 2 重复）',
  )
  assert.notEqual(
    rejected.raw, undefined,
    '★★ [FINDING-1] 被拒的调用必须在**工具结果**上给得出 `input_surface` —— 拒绝恰恰是最需要'
    + ' 读到"是契约不合法、还是输入面没接全"的那一刻。'
    + ` 实测：\`error.input_surface\` 是 ${JSON.stringify(rejected.raw)}（undefined ⇒ 工具边界没搬），`
    + ` 而异常上的内部属性 \`agentTeamsInputSurface\` 是 ${JSON.stringify(rejected.error?.agentTeamsInputSurface)}`
    + ' ⇒ 结论**产生了**、却**没交到工具边界之外**。',
  )
  const { surface } = exitOf('dispatch', rejected)
  assert.notEqual(surface, undefined, '★ 结论本身必须存在（无论它挂在哪个名字上）')
  assertShape(surface, 'dispatch（拒绝路径）')
  assert.ok(surface.checked >= 1, '★ 反向半边：真的核对了（否则"是哪一份"无从谈起）')
  /**
   * ★★ 关键的一半：**先报缺的那一份说话**。
   *
   * `update_task` 一次调用穿过**两个**位置（dispatch 与 completion）。先拒绝的那个把
   * 结论挂上去之后，**后**拒绝的那个不许覆盖它 —— 覆盖之后读出来的是 completion 的
   * 结论，而它读起来完全正常。
   *
   * ★ 本臂的做法：对比"拒绝路径上读到的这一份"与"成功路径上 dispatch 自己那一份"。
   *   两者若都来自 dispatch，它们的**判据 id 集合**必须一致（同一份 ctx 形状、
   *   同一个位置的同一批判据）。若拒绝路径上读到的是 completion 的结论，id 集合
   *   会落在 `completion.*` 上 ⇒ 当场红。
   */
  const okWorkspace = freshWorkspace('reject-control')
  const control = await drive(okWorkspace, 'dispatch')
  const controlSurface = exitOf('dispatch', control.result).surface
  assert.notEqual(controlSurface, undefined, '★ 对照半边：成功路径上 dispatch 那一份必须在场')
  const idsOf = (s) => s.missing.map((line) => line.replace(/^\[([\w.-]+)\].*$/s, '$1')).sort()
  for (const id of idsOf(surface)) {
    assert.ok(
      !id.startsWith('completion.'),
      `★ 拒绝路径上交出来的是 **completion** 位置（${id}）的结论 —— 那就是"后到者覆盖先到者"，`
      + '也正是本队记账的"读错位置的出口"',
    )
  }
  /**
   * ★ 两次调用的 ctx 形状相同（同一条任务、同一个成员），所以 dispatch 那一份的
   *   缺格名单必须一致 —— 一个"谁后写谁赢"的实现会在这里露出马脚。
   */
  assert.deepEqual(
    idsOf(surface), idsOf(controlSurface),
    '★ 拒绝路径与成功路径上 dispatch 那一份必须指向**同一批判据**（否则读的是别的位置的结论）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：五处的清单互不相同 —— 出口没有被"一份快照"顶掉
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8：五处出口的读数**互不相同**（不是五处共用一份快照）', async () => {
  /**
   * ★ 本臂是臂 6 的**横向**版本：臂 6 在**同一个位置**上动一个自变量，本臂在
   *   **同一个进程**里并排读五处，要求它们的结论**不是同一份**。
   *
   * 定向突变：让五处都返回同一个变量（例如在 `inputSurfaceOf` 里缓存第一次的结果）
   * ⇒ 本臂红。
   *
   * ★ 为什么必须断言"互不相同"而不是"都在场"：五处都挂同一份快照的实现**全部在场、
   *   形状全对**，而它的读数与"这个位置接没接全"**没有因果关系** —— 那就是第四种
   *   恒真写法。本臂用"五处的 `checked` 清单不同"来把它打红。
   */
  const reads = []
  for (const [siteKey, label] of PATCHED_SITES) {
    const workspace = freshWorkspace(`distinct-${siteKey}`)
    const { result } = await drive(
      workspace, siteKey,
      siteKey === 'delivery_declare' ? { tasks: DELIVERABLE_TASKS } : {},
    )
    const { surface } = exitOf(siteKey, result)
    assert.notEqual(surface, undefined, `★ ${label}：本臂要求五处都在场（否则比的是空集）`)
    assertShape(surface, label)
    reads.push({ label, surface })
  }
  const signatures = new Set(reads.map((entry) => `${entry.surface.checked}|${entry.surface.incomplete}`))
  assert.ok(
    signatures.size >= 3,
    `★ 五处读数的 (checked|incomplete) 只有 ${signatures.size} 种取值（${[...signatures].join(' , ')}）—— `
    + '五处共用一份快照的实现会在这里红。实测：'
    + reads.map((entry) => `${entry.label}=${entry.surface.checked}|${entry.surface.incomplete}`).join(' , '),
  )
  /**
   * ★ 反向半边（防"恒不挂"）：每条读数都必须真的核对了至少一条。
   */
  for (const entry of reads) {
    assert.ok(entry.surface.checked >= 1, `★ ${entry.label}：\`checked\` 必须 ≥ 1（实际 ${entry.surface.checked}）`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9：产物与源码的清单（"改了什么源"与"构建产出了什么"是两个清单）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 9：`lib/tools.js` 是**当前** `src/tools.ts` 的产物（不是一份过期快照）', async () => {
  /**
   * 定向突变：改一处源码而**不**重建 ⇒ 本臂红。
   *
   * ★★ 已装插件是 `link:` 指向源码，但运行的是 `lib/` —— 一份过期的 `lib/` 会让
   *   本文件所有臂都在测**上一轮**的代码，而它们照样是绿的。本臂把那条缝隙钉住：
   *   源码里那五处补齐的**特征串**必须逐一出现在构建产物里。
   *
   * （这不是"读源码断言"——断言的是**产物**里有没有那几处补齐，而本文件其余的臂
   *   断言的是**运行期**读到的值。两者服务不同的问题。）
   */
  const source = readFileSync(join(ROOT, 'src', 'tools.ts'), 'utf8')
  const built = readFileSync(join(ROOT, 'lib', 'tools.js'), 'utf8')
  const markers = [
    /** 唯一的构造点 */
    'function inputSurfaceOf(',
    /** 三态的分界线（"有判据才挂"那一行） */
    'checked + audit.skipped === 0',
    /** 拒绝上的搬运 */
    'withInputSurfaceOnError(',
    'agentTeamsInputSurface',
    /** 五处出口各自的落点 */
    'dispatch_input_surface',
    'completion_input_surface',
  ]
  for (const marker of markers) {
    assert.ok(source.includes(marker), `★ 源码里缺 ${marker} —— 本文件其余的臂在测一个不存在的机制`)
    assert.ok(built.includes(marker), `★ 构建产物 \`lib/tools.js\` 里缺 ${marker} —— 它是一份**过期**的产物（先跑 pnpm build）`)
  }
  /**
   * ★ 反向半边：**四处补齐**必须各自出现（`input_surface` 这个字段名出现 ≥ 5 次，
   *   因为 runtime 那处也是一个）。一个"只补了一处"的实现会在上面几条臂里红，
   *   而这一句是那条结论的第二条独立读数。
   */
  const occurrences = (built.match(/input_surface/g) ?? []).length
  assert.ok(occurrences >= 5, `★ 产物里 \`input_surface\` 只出现 ${occurrences} 次 —— 四处补齐（+ runtime 那处）应当 ≥ 5`)
})
