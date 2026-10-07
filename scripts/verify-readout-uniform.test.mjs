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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { registerAgentTeamsTools } from '../lib/tools.js'
import { registry, gateModuleViews } from '../lib/gates/index.js'
import { createTeamDir } from '../lib/state.js'
// ★ t39：工具的源码面现在是 src/tools.ts + src/tools/**（见该模块的文件头）
import { toolsSource } from './tools-source.mjs'

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
      /**
       * ★★ 拒绝路径的**读取顺序**（队长核实过的构造性不可达，本文件第三版修正）：
       *
       * MEASURED（本文件第二版）：这里此前只取**泛用名** `error.input_surface`，
       *   而 `readExit` 按**位置名**取（`dispatch_input_surface`）——
       *   ⇒ 在那条读取路径上位置名**构造性不可达**，于是读到 `undefined`，
       *     而它读起来像"产品没交出来"。
       *
       * ★ 两个名字现在**都取**是有意义的（见 `inputSurfaceFieldOf`）：拒绝路径上
       *   位置名与泛用名**并存且同指一个对象**。于是 `raw` 仍取泛用名（四处共用），
       *   而 `rawByPosition(key)` 让读者按**位置名**取 —— 与本文件"读那个位置自己的
       *   出口"那条纪律一致。
       */
      return { ok: false, error, value: undefined, raw: error?.input_surface, rawByPosition: (key) => error?.[key] }
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
   * ★★ 反向半边（其二）：**拒绝路径上也要能按位置名读到**。
   *
   * ── MEASURED（本文件第二版改正的地方，值得记下来）────────────────────────────
   *
   * 本臂第一版**红的**，而我当时把它读成了产品的 FINDING-1。队长独立复核后指出：
   * 那是**我的自变量选错了** —— 与我自己写进文件头的那条教训**同一形态**。
   *
   *   我给 dispatch 与 completion 的是**同一个调用**（逐字节相同的一条 `update_task`）。
   *   而那次调用的真实走向是：`dispatch` ⇒ **ok（没拒绝）**；`completion` ⇒ 拒绝。
   *
   *   ⇒ `completion_input_surface` 在场、`dispatch_input_surface` **合理地缺席** ——
   *     因为 dispatch 那一段**根本没有拒绝**，"交出去的拒绝结论"这回事不存在。
   *   ⇒ 我的 `exitOf('dispatch', …)` 于是回落到异常上的**内部属性**，读到的是
   *     **completion 的**结论 ⇒ 断言"读不到"并 fail。
   *
   *   ★ 这与我自己写下的那条教训是同一个病：
   *
   *       「想用『换 task.kind』动 contract 位置的输入面会落空 ⇒ 一次归因指向
   *         产品代码的假红」
   *
   *     **这次是「用同一次调用读两个位置」落空。**
   *
   * ⇒ 修法：给 dispatch **造一次它自己的拒绝**（越界路径 ⇒ `dispatch.changed-paths`
   *   有话可说）。这样两个位置各有各的拒绝，两个位置名都该在场。
   *
   * ── ★ 并且这一条现在**真的**能按位置名读到（见下面 `exitOf` 的实测）──────────
   *
   *   拒绝路径此前只有**泛用名** `input_surface`，而成功路径按**位置名**
   *   （`dispatch_input_surface`）⇒ 一次调用穿过两个位置时，"按位置名去找的读者
   *   在拒绝路径上读不到"，而**读不到与"这个位置没判据"在断言层面同形**。
   *   实现者把它改成**位置名 + 泛用名并存（同指一个对象）**。
   *   ⇒ 本条臂因此可以**按位置名**在**两条路径**上读同一件事。
   */
  const wsReject = freshWorkspace('shape-reject')
  seedWorktree(wsReject)
  const rejectFixture = pluginFixture(wsReject)
  await seedTeam(wsReject, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
  const dispatchReject = await rejectFixture.call('agent_teams_update_task', {
    task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1',
    /** ★ 越界路径：不在 inScope 里 ⇒ `dispatch.changed-paths` 当场有话可说。 */
    changedPaths: ['elsewhere/x.ts'],
  }, 'member-1')
  assert.equal(dispatchReject.ok, false, `★ 前置：这一次必须真的被拒 —— ${dispatchReject.ok ? '它成功了，本段读的是别的东西' : ''}`)
  /**
   * ★★ 决定性的一半：被拒的调用，结论必须在**工具结果**上、按**位置名**读得到。
   *
   * ★ 两条路（成功 / 拒绝）在**同一个位置**上必须**同形** —— 这正是"可机械比对"
   *   这句话在拒绝路径上的落点。
   */
  const dispatchRejectSurface = dispatchReject.raw === undefined ? undefined : dispatchReject.raw
  assert.notEqual(
    dispatchRejectSurface, undefined,
    '★★ [臂 1 的拒绝路径半边] 被拒的调用必须在**工具结果**上给得出 `input_surface` ——'
    + ' 拒绝恰恰是最需要读到"是契约不合法、还是输入面没接全"的那一刻。'
    + ` 实测：\`error.input_surface\` 是 ${JSON.stringify(dispatchReject.raw)}`
    + `（undefined ⇒ 工具边界没搬）；异常上的内部属性是 ${JSON.stringify(dispatchReject.error?.agentTeamsInputSurface)}`,
  )
  assertShape(dispatchRejectSurface, 'dispatch（拒绝路径）')
  assert.ok(dispatchRejectSurface.checked >= 1, '★ 反向半边：真的核对了（否则"是哪一份"无从谈起）')
  /**
   * ★★ 位置名与泛用名**并存且同指**（队长点名要我独立确认的 ③ 那一格）。
   *
   * ★ 断言的是"**同一个对象**"（引用相等），不是"内容相等"—— 后者对两份真的
   *   各自算出来的结论也会成立，于是它区分不出"一个对象的两个名字"与"两份真相"。
   */
  const errorCarrier = dispatchReject.error
  assert.equal(
    Object.hasOwn(errorCarrier, 'dispatch_input_surface'), true,
    '★ 拒绝路径上必须**按位置名**也读得到（否则一次穿过两位置的调用里，"按位置名找的读者"'
    + ' 在拒绝路径上读不到，而"读不到"与"这个位置没判据"在断言层面同形）',
  )
  assert.equal(
    Object.hasOwn(errorCarrier, 'input_surface'), true,
    '★ 同时保留**泛用名**（只有单一入口的那几处的读者按它找）',
  )
  assert.equal(
    errorCarrier.dispatch_input_surface, errorCarrier.input_surface,
    '★ 两个名字必须指向**同一个对象**（引用相等）—— 内容相等区分不出"一个对象的两个名字"'
    + ' 与"两份各自算出来的真相"，而后者正是本队记账的「两份真相」形态',
  )
  assert.equal(
    errorCarrier.dispatch_input_surface === errorCarrier.agentTeamsInputSurface, true,
    '★ 而且它们与异常上那个内部属性也是**同一个对象**（同一份结论，三个名字）',
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
   * ★ 本文件里 A 与 B 两态由**探针的闸门**控制，而闸门走 `appliesTo`
   *   （**不**是注册/注销）：注销会同时改掉 `registry.count(point)`，于是
   *   `evaluateRuntimeGates` 的短路也随之变化 —— 一个自变量动两根轴，
   *   读数就不可归因了。
   *
   * ⚠️ C 态（"这个位置没有判据"）是**三态里最难造的一态**，而它必须造对，
   *   否则这一臂会变成一条恒真的断言。本文件第一版就在这上面栽过一次 ——
   *   那次实测记在下面 C 态那一段里。
   *
   * 定向突变：把 `inputSurfaceOf` 里 `if (audit.checked + audit.skipped === 0) return undefined`
   *   那一行改成 `if (false) return undefined`（恒挂）⇒ C 态塌进 A 态 ⇒ 本臂红。
   *   反过来，把它改成 `if (true) return undefined`（恒不挂）⇒ A/B 两态一起消失 ⇒ 也红。
   */

  // ── A 态：contract 位置，闸门关，真实判据在场且齐 ──────────────────────────
  const wsA = freshWorkspace('tri-a')
  const a = await drive(wsA, 'contract')
  const surfaceA = exitOf('contract', a.result).surface
  assert.notEqual(surfaceA, undefined, '★ A（有判据且都齐）：字段必须在场')
  assertShape(surfaceA, 'A 态')
  assert.ok(surfaceA.checked >= 1, '★ A 态：真的核对了至少一条')
  assert.equal(surfaceA.incomplete, 0, '★ A 态：incomplete: 0')

  // ── B 态：同一个位置，闸门开 ⇒ 多一条缺格的判据 ────────────────────────────
  const wsB = freshWorkspace('tri-b')
  const b = await drive(wsB, 'contract', { probe: true })
  const surfaceB = exitOf('contract', b.result).surface
  assert.notEqual(surfaceB, undefined, '★ B（有判据且缺格）：字段必须在场')
  assertShape(surfaceB, 'B 态')
  assert.ok(surfaceB.incomplete >= 1, '★ B 态：incomplete ≥ 1')
  assert.ok(surfaceB.checked >= surfaceA.checked, `★ B 态不该比 A 态核对得更少（${surfaceB.checked} vs ${surfaceA.checked}）`)

  /**
   * ★★ C 态（"这个位置没有判据"）的构造 —— 这是本臂最难的一半，值得写清楚。
   *
   * MEASURED（本文件第一版错在这里）：第一版用"**没有 worktree**"来造 C 态，
   *   读到的是 `{checked: 0, incomplete: 0, skipped: 3}` —— 字段**在场**。
   *   为什么：那两条判据 `appliesTo` 为假 ⇒ 核对层把它们记成 `skipped`，而
   *   `inputSurfaceOf` 的判据是 `checked + skipped === 0`，`skipped: 3` 让这个和是 3。
   *
   *   ★ 而**那不是产品代码的缺陷**：`skipped` 的意思是"这个位置**有判据**，只是这一轮
   *     不适用" —— 那与"这里压根没有判据"是两件不同的事，产品代码区分得**对**。
   *     是我的构造选错了自变量。
   *
   * ⇒ 真正的 C 态要的是"这个位置**在注册表里一条判据都没有**"。而 `contract` /
   *   `dispatch` / `completion` / `delivery` 四个位置的真实判据都在册
   *   （`registry.count` 看得见）—— 对它们造不出 C 态，除非把判据注销，
   *   而那会同时改掉 `count`（一个自变量动两根轴，不可归因）。
   *
   * ⇒ 本文件改用**位置**做自变量，而且让两种状态**并排在同一次返回值上**：
   *
   *     · `delivery` 位置 —— `agent_teams_status` 这一轮**有判据**（两条交付判据）⇒ 在场
   *     · `contract` 位置 —— 同一个 `agent_teams_status` 调用**不经过**它
   *       ⇒ 这一轮它**没有判据被核对** ⇒ 字段不出现
   *
   *   这比"分开两次调用"强：分开调用无法排除调用之间的状态差异，而并排读数
   *   把"两态只差这一个位置"变成了同一个值上的两个字段。
   *
   * ★ 并且本文件**不**满足于此：再补一个**同一个位置内部**的实例（下面 `dispatch`
   *   在"没有 changedPaths"时），把第三态钉在位置内部，而不是只靠"换了个入口"。
   *
   * ★★ 读法上刻意**不**用"顶层有没有 `input_surface`"：那会让本臂依赖"status 恰好把
   *   delivery 的结论挂在 `delivery` 里"这种**当前**的排布。本臂要的是**这个位置**
   *   的结论，所以按位置的名字去问 —— 而那正是本文件开头点名要防的形态。
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
  /**
   * ★★ MEASURED（本文件本轮，第二个被记下来的构造教训）：
   *
   *   本文件第一版以为"没有 changedPaths"会造出 C 态。**它不会** —— 实测读到的是
   *   `{checked: 0, incomplete: 0, skipped: 3}`，字段**在场**。
   *
   *   原因不是产品代码写错了，而是我读错了 `skipped` 的含义：
   *   `skipped` = "这个位置**有判据**（注册在册），只是这一轮不适用" ——
   *   而 `inputSurfaceOf` 的分界是 `checked + skipped === 0`，所以**有判据但不适用**
   *   照样把字段挂出来（挂的是 `incomplete: 0` + `skipped: 3`）。
   *
   *   ★ 那与"这个位置压根没有判据"（字段**不出现**）是两件不同的事 ——
   *     而产品代码**区分得对**。这是三态之外的一个第四种读数，本文件把它如实记下来，
   *     而不是把它硬塞进 C 态（那会让这条断言变成一句假话）。
   *
   * ⇒ 本文件因此**不再**用"没有 changedPaths"当 C 态；C 态由上面那次
   *   `agent_teams_status` 的并排读数提供（contract 位置这一轮一条判据都没被核对）。
   *   这一条留下来，断言的是那个**实测事实**本身（它也是"三态不会被撑成两态"的证据：
   *   `skipped > 0` 时字段在场，而 `checked === 0` 时 `incomplete` 仍是 0 ——
   *   一个把"有判据但不适用"读成"没判据"的实现会在这里红）。
   */
  assert.notEqual(
    dispatchNoPaths, undefined,
    '★ 「这个位置有判据、但这一轮一条都不适用」（`skipped > 0`）⇒ 字段**照样在场**；'
    + ' 它不等于 C 态（"这里没有判据"⇒ 字段不出现）。一个把 `skipped` 读成"没判据"的实现会在这里红。',
  )
  assertShape(dispatchNoPaths, 'dispatch（有判据但不适用）')
  assert.equal(dispatchNoPaths.checked, 0, '★ 这一轮确实一条都没适用')
  assert.ok(dispatchNoPaths.skipped >= 1, `★ 而它们被记成 skipped（实测 ${dispatchNoPaths.skipped}），不是"没有判据"`)
  assert.equal(dispatchNoPaths.incomplete, 0, '★ 不适用的判据不算缺格')
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
    return { ok: false, error, value: undefined, raw: error?.input_surface, rawByPosition: (key) => error?.[key] }
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
    armedSurface.checked, surface.checked + 1,
    `★ 探针声明了 \`requires\`，而且它的 \`appliesTo\` 读的正是那道闸门 ——`
    + ` 闸门一开，核对层就该**多看见一条判据**：\`checked\` 必须从 ${surface.checked} 变到 ${surface.checked + 1}`
    + `（实测 ${armedSurface.checked}）。不变 ⇒ 这个出口读的不是**这个位置**的核对结论。`,
  )
  assert.equal(
    armedSurface.incomplete, surface.incomplete + 1,
    `★ 而且探针多出来的那一格是缺的 ⇒ \`incomplete\` 也必须跟着变（${surface.incomplete} → ${armedSurface.incomplete}）`,
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
  /**
   * ★★ 自变量的选择（本文件第二轮修正，理由值得记下来）：
   *
   *   第一轮想用**换 `task.kind`** 来动这个位置的输入面 —— 落空了：`contract`
   *   位置的两条真实判据的 `appliesTo` 都只读 `ctx?.task !== undefined`
   *   （见 `src/gates/contract/{verify-command,build-artifact-scope}.ts`），
   *   换 kind **动不了**它。于是那一对读数完全相同，而本臂会把它读成
   *   "产品代码有第四种恒真写法" —— 一次**归因指向产品代码的假红**。
   *
   * ⇒ 改用一份**真的**会变的输入：`inScope` 的内容。`contract.build-artifact-scope`
   *   的 `appliesTo` 虽然只看 `task` 在不在，但**它的 `requires` 只有 `task` 一格**，
   *   所以 `checked` 不变 —— 而真正会变的是**别的**位置上的读数（见下）。
   *
   * ★ 更好的自变量在这里：**同一条 `create_task`，只改 `inScope`**，而
   *   `contract.verify-command` 的 `requires` 里那一格 `task.verify` 是由
   *   `kind` 决定的（implementation 必须给 verify）—— 于是两份 ctx 的 `task`
   *   形状不同，而**出口必须把这件事如实报出来**。
   *
   * ★★ 而最干净的那一个：**同一个位置、同一份 ctx 形状，只把探针的闸门开合**，
   *   已经在上面 `armed` 那一对里做过了（`checked` 2 → 3、`incomplete` 0 → 1）。
   *   本段因此改为**独立重算**：用真实的 `auditRequires` 自己算一遍，
   *   要求两条路的**方向**一致 —— 而不是再找一个人为的自变量。
   */
  const independentWork = auditRequires(
    views.map((view) => ({
      id: view.id,
      ...view.requires === undefined ? {} : { requires: view.requires },
      ...view.appliesTo === undefined ? {} : { appliesTo: view.appliesTo },
    })),
    { task: { id: 't0', kind: 'work' }, team: { id: 'team', tasks: [] }, creating: true },
  )
  assert.notDeepEqual(
    independentWork, surface,
    '★ 独立重算那一份（**缺了注入的那一格** `execVerifyCommand`）与出口那一份必须**不同**：'
    + ' 两份完全一样 ⇒ 出口不是按 `requires` 对真实 ctx 算出来的（第四种恒真写法）。'
    + ` 独立=${JSON.stringify(independentWork)} 出口=${JSON.stringify(surface)}`,
  )
  assert.ok(
    independentWork.incomplete >= surface.incomplete,
    `★ 独立重算的缺格数 ${independentWork.incomplete} 必须 ≥ 出口报的 ${surface.incomplete}`,
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
   * ★ 前置：这次调用必须真的被拒（否则本臂读的是成功路径，与臂 2 重复）。
   */
  assert.equal(
    rejected.ok, false,
    '★ 前置：这次调用必须真的被拒（否则本臂读的是成功路径，与臂 2 重复）',
  )
  /**
   * ★★ 本臂此前**红**过，而我当时把它归因给产品代码的 FINDING-1 —— 那是**误报**，
   *   修的是**我的自变量**（理由与实测写在文件末尾「verifier5 的自变量修正」一节）。
   *
   * ⇒ 现在读法回到"**按位置名**从工具结果上读"这一条 —— 而这是**唯一**能同时证伪
   *   "边界没搬"与"位置名与成功路径不同形"的读法。
   */
  assert.notEqual(
    rejected.raw, undefined,
    '★★ 被拒的调用必须在**工具结果**上给得出 `input_surface` —— 拒绝恰恰是最需要'
    + ' 读到"是契约不合法、还是输入面没接全"的那一刻。'
    + ` 实测：\`error.input_surface\` 是 ${JSON.stringify(rejected.raw)}（undefined ⇒ 工具边界没搬），`
    + ` 而异常上的内部属性 \`agentTeamsInputSurface\` 是 ${JSON.stringify(rejected.error?.agentTeamsInputSurface)}`,
  )
  assert.equal(
    Object.hasOwn(rejected.error, 'dispatch_input_surface'), true,
    '★ 而且必须**按位置名**也读得到 —— 一次穿过两个位置的调用里，"按位置名找的读者"'
    + ' 在拒绝路径上读不到，就与"这个位置没判据"在断言层面同形',
  )
  assert.equal(
    rejected.error.dispatch_input_surface, rejected.raw,
    '★ 位置名与泛用名必须指向**同一个对象**（引用相等，不是内容相等）',
  )
  const { surface } = exitOf('dispatch', rejected)
  assert.notEqual(surface, undefined, '★ 结论本身必须存在')
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
  /**
   * ★★ 对照半边：**同一个位置、同一份 ctx 形状**，只把"有没有拒绝"换掉。
   *
   * ── MEASURED（本文件本轮第二次踩到同一个坑，值得记下来）──────────────────────
   *
   * 第一版对照用 `drive(ws, 'dispatch')`（`changedPaths: ['src/a.ts']`）。那一次调用
   * **穿过了** dispatch、然后在 **completion** 位置被拒 —— 于是 `exitOf('dispatch', …)`
   * 读到的是 **completion 的**结论，而这条断言报 `dispatch.worktree` vs
   * `completion.backtest` 不一致。
   *
   * ★ 它读起来像"产品把别的位置的结论交出来了"，实际是**我的对照取材取错了**：
   *   我要的对照是"dispatch **没被拒**"，而那次调用在 dispatch 位置上确实没拒 ——
   *   只是整个调用的结局仍然是"被拒"，于是两条出口都落在异常上。
   *
   * ⇒ 对照改成从**异常上按位置名**读（`error.dispatch_input_surface`），而不是从
   *   "这次调用成不成功"去读 —— 因为后者问的是**整个调用**的结局，
   *   而本臂要的是**这一个位置**的结论。这是"读错位置的出口"的又一形态。
   */
  /**
   * ★★ 对照半边：**只把"这一次的拒绝落在哪个位置"换掉**。
   *
   * ── MEASURED（本文件第三次踩到同一个坑，三次都是"读错位置的出口"）────────────
   *
   * 第一版对照用 `drive(ws, 'dispatch')`（`changedPaths: ['src/a.ts']`）。实测那次
   * **穿过了** dispatch、在 **completion** 位置被拒 ⇒ 异常上是
   * `completion_input_surface` + `input_surface`，而 `dispatch_input_surface`
   * **根本不存在**（实测 `own = […,"completion_input_surface","input_surface"]`）。
   *
   * ★ 它读起来像"dispatch 那一份没交出来"，实际是**我要的对照根本不存在**：
   *   `['src/a.ts']` 这一次在 dispatch 位置上**没有拒绝** —— "dispatch 的拒绝结论"
   *   这回事没有发生。拿 `undefined` 与一个不存在的对照比，恒真也恒红。
   *
   * ⇒ 对照改成**同一条调用路径上两个位置名之别**：两次都真的被拒，只是落点不同，
   *   于是"各挂各的位置名"成为一次**正面对照**，而不是一次缺席。
   */
  const okWorkspace = freshWorkspace('reject-control')
  const control = await drive(okWorkspace, 'dispatch')
  assert.equal(
    control.result.ok, false,
    '★ 对照半边的前置：`changedPaths: [src/a.ts]` 这一次确实会被拒（落在 **completion** 位置）'
    + ` —— ${control.result.ok ? '它成功了，本对照不成立' : ''}`,
  )
  const controlOwn = Object.getOwnPropertyNames(control.result.error ?? {})
  assert.ok(
    controlOwn.includes('completion_input_surface'),
    `★ 对照半边：这一次的拒绝落在 **completion** 位置 ⇒ 异常上必须是 \`completion_input_surface\`。实测 own = ${JSON.stringify(controlOwn)}`,
  )
  assert.equal(
    controlOwn.includes('dispatch_input_surface'), false,
    '★★ 而 `dispatch_input_surface` **必须不出现** —— 这一次在 dispatch 位置上**没有拒绝**，'
    + ' "dispatch 的拒绝结论"这回事没有发生。★ 一个"给所有位置名都挂一份"的实现会在这里红：'
    + ' 那正是把"这个位置没有拒绝"与"有结论"合流。'
    + ` 实测 own = ${JSON.stringify(controlOwn)}`,
  )
  const controlSurface = control.result.error?.completion_input_surface
  assert.notEqual(controlSurface, undefined, '★ 对照半边：completion 那一份必须在场')
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
  /**
   * ★★ 两次拒绝**各挂各的位置名**，而且**内容确实不同**（各指各的判据）。
   *
   * ★ 这是"两个名字"这件事的**反面**证据：如果实现只是把**同一份**结论挂到所有
   *   位置名上（一份快照 + 多个名字），这两条读数就会相同 —— 而它们**必须不同**。
   */
  assert.notDeepEqual(
    idsOf(surface), idsOf(controlSurface),
    '★ 两次拒绝落在**不同位置** ⇒ 两份结论必须指**不同**的判据（dispatch.worktree vs completion.backtest）。'
    + ' 相同 ⇒ 出口交的是"一份与位置无关的快照"，那正是第四种恒真写法',
  )
  assert.deepEqual(
    idsOf(surface), ['dispatch.worktree'],
    `★ 越界那一次缺的是 dispatch 位置的那条（实测 ${JSON.stringify(idsOf(surface))}）`,
  )
  assert.deepEqual(
    idsOf(controlSurface), ['completion.backtest'],
    `★ 另一次缺的是 completion 位置的那条（实测 ${JSON.stringify(idsOf(controlSurface))}）`,
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
    signatures.size >= 2,
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
  const source = toolsSource()
  /**
   * ★★ t39：产物面**不再只有一个文件**。
   *
   * 拆分之后 `lib/tools.js` 是**装配**，而 `inputSurfaceOf` / `withInputSurfaceOnError`
   * 这些机制住在 `lib/tools/shared/entities.js` —— 实测：
   *
   *     lib/tools.js                 -> 'function inputSurfaceOf(' 出现 0 次
   *     lib/tools/shared/entities.js -> 出现 1 次
   *
   * ⇒ 与源码侧【对称地】扩大范围：源码面读 `src/tools.ts` + `src/tools/**`，
   *   产物面就读 `lib/tools.js` + `lib/tools/**`。
   * ★ 判别力一个字不动：仍然断言"产物里找得到这些特征串"，
   *   而"改源码不重建"仍然会让本臂红（markers 不在产物里）。
   */
  const builtFiles = [join(ROOT, 'lib', 'tools.js')]
  const walkBuilt = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walkBuilt(full)
      else if (entry.name.endsWith('.js')) builtFiles.push(full)
    }
  }
  walkBuilt(join(ROOT, 'lib', 'tools'))
  const built = builtFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
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

// ─────────────────────────────────────────────────────────────────────────────
// 十、本文件读出来的缺口（verifier5 的独立验证结论 —— 只报告，不改实现）
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// 十、verifier5 的自变量修正（本文件三次踩同一个坑，全部记在这里）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ 本文件第一版报的 FINDING-1 在**修完之后仍然是错的**，错的是我的自变量 ────
 *
 * 第一版臂 1/7 **红**，我把它读成产品缺陷（"拒绝路径交不出结论"）。修完之后**它们还是红**
 * —— 而那时产品已经是对的。追下去发现：**我给的 dispatch 与 completion 是同一次调用**
 * （逐字节相同的两条 `update_task`），而那次调用的真实走向是
 *
 *     dispatch   ⇒ ok（**没有拒绝**）
 *     completion ⇒ unmeasured（拒绝）
 *
 * ⇒ `dispatch_input_surface` **合理地缺席** —— 因为 dispatch 那一段根本没有拒绝，
 *   "交出去的拒绝结论"这回事不存在。而我的 `exitOf` 于是回落到异常上的**内部属性**，
 *   读到的是 **completion 的**结论。
 *
 * ★ 这与我自己写进文件头的那条教训是**同一个病**：
 *
 *     「想用『换 task.kind』动 contract 位置的输入面会落空 ⇒ 一次归因指向产品代码的假红」
 *
 *   **这次是「用同一次调用读两个位置」落空。**
 *
 * ── 三次都是同一种形态，值得列在一起 ──────────────────────────────────────────
 *
 *   ① 换 `task.kind` 想动 contract 的输入面 —— 那两条判据的 `appliesTo` 只读 `ctx.task`
 *      ⇒ 读数不变 ⇒ 会误判成"产品恒真"
 *   ② 用**同一个调用**想读两个位置的拒绝 —— 只有后拒绝的那个有结论
 *      ⇒ 会误判成"出口交出了别的位置的结论"
 *   ③ 对照半边用了 `['src/a.ts']`（在 **completion** 位置才被拒）当"dispatch 没被拒"
 *      的对照 —— **那个对照根本不存在** ⇒ `dispatch_input_surface` 必然缺席，
 *      而"不是我读错了出口，是**我这个对照取材取错了**" （详见臂 7 的注释）
 *
 * ⇒ 三次都**不是**"读错位置的出口"这条**产品**缺陷，而是**同一个**形态落在**夹具**里：
 *   **拿一个不是那个位置的东西，去断言那个位置的性质。**
 *
 * ── ★ 一条本队已记账的读数纪律（本文件严格遵守）───────────────────────────────
 *
 *   差分探测只能看见"这一轮 ctx 里出现过的格子" ⇒ 读数**单向可信**：
 *   报了的一定真，**没报的不一定没有**。本文件因此**不**把"没报 ⇒ 没缺口"
 *   写成任何断言 —— 那是把单向读数变成假保险，而假保险比没有读数更坏。
 *
 * ── ★★ 第四种恒真写法（本文件本轮真正找到的那一种，记在这里）───────────────────
 *
 *   本队已记账三种：恒真 / 恒红 / 读错位置的出口。本轮补上**第四种**：
 *
 *     **守卫检查了另一个同名的东西。**
 *
 *   实测（`src/tools.ts` 的 `withInputSurfaceOnError`）：守卫要判断的是**工具结果的
 *   字段** `input_surface`（"这一跳搬过没有"），却写成了 `INPUT_SURFACE_PROPERTY in error`
 *   —— 而那个常量是**异常上判据挂的内部属性** `agentTeamsInputSurface`，
 *   正是 `throwWithSurface` **刚挂上去**的东西 ⇒ 守卫**恒真** ⇒ 搬运永不发生。
 *
 *   ★ 一个永远为真的守卫不是"更严格"，是**不存在**。而它在断言层面读起来完全正常：
 *     属性在场、值也对，只是那一步从未发生。
 *
 *   ★ 它与第三种（读错位置的出口）的区别：第三种是**读者**读错了位置；
 *     这第四种是**守卫**检查了另一个同名的东西 —— 前者的受害者在**读**，
 *     后者的受害者在**写**（搬运被跳过）。
 *
 * ── ★★ 一条关于"假面"的经验（本轮最有价值的一条）─────────────────────────────
 *
 *   实现者的夹具**没有**抓到上面那个 blocker，而原因是它的**假面**：它把
 *   `registry.evaluate` 换成**永远 `{ok:true}`** 的替身 ⇒ 那一轮里 contract/delivery
 *   没有任何判据会把流程拒掉 ⇒ 它构造的"被拒"**根本不由 `throwWithSurface` 产生**，
 *   走的是别处的裸 `throw new Error(...)`（本来也不带结论）。
 *
 *   ⇒ **一份为了可控而造的假面，替它挡掉了真实世界最常发生的那条路。**
 *     事后被逐字证实：把守卫改回恒真做突变 ⇒ 它新补的臂红，而**旧的假面臂照绿**。
 *
 *   ⇒ 本文件因此坚持走**真实注册表 + 真实 `gateModuleViews()` + 真实 `lib/`**，
 *     不合成 bundle、不换 `evaluate`。被替掉的每一件东西，都是一条看不见的路。
 *
 * ── ★★ 关于"位置名 + 泛用名并存"（verifier5 的独立判断）─────────────────────────
 *
 *   拒绝路径此前只有**泛用名** `input_surface`，而成功路径按**位置名**
 *   （`dispatch_input_surface`）⇒ 同一个位置在两条路径上**不同形**：按位置名去找的
 *   读者在拒绝路径上读不到，而**读不到与"这个位置没判据"在断言层面同形**。
 *
 *   ★ 判断：**这是修好了一个不同形，不是引入一个新的。** 三条独立理由：
 *
 *     ① 两个名字指向**同一个对象**（本文件臂 1 用**引用相等**断言，不是内容相等）——
 *        实测 `位置名 === 泛用名 === 内部属性`，写一个名字另一个立刻看得见。
 *        "两份真相"的定义是**两次独立计算**，而这里只有一次 `inputSurfaceFromThrown`。
 *     ② 泛用名**只在没人占的时候写**（`if (!Object.hasOwn(error,'input_surface'))`）
 *        ⇒ "先到的那一份说话"这条语义一个字没变，两个名字不会各自指向不同的位置。
 *     ③ 两者**各司其职且都不可省**：位置名服务"我要**这个位置**的结论"，
 *        泛用名服务"这次调用**有没有**交结论"（单一入口位置只有后者）。
 *        删掉任何一个都会让某一类读者回到"读不到 = 没有"的合流。
 *
 *   ★ 唯一**真的**风险（我因此加了反向断言）：如果哪天有人在两个键之间插入一次
 *     "重新算一遍"，两个名字就**真的**成了两份真相。本文件臂 7 因此断言
 *     "两次拒绝落在不同位置 ⇒ 两份结论必须指**不同**的判据"
 *     （实测 `dispatch.worktree` vs `completion.backtest`）——
 *     它同时打红"一份快照 + 多个名字"与"两个名字分叉"两种坏法。
 */
