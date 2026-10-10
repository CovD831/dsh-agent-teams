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
 * ★★ 而"说不出"有两种，**必须分开对待**（本文件第四版补的这条区分，起因是臂 7）：
 *
 *   (甲) **没想过** ⇒ 那就别写这条臂（本文件其余各臂都属这一类，突变都写明了）。
 *   (乙) **那条性质在任何真实入口上不可证伪**（路径不存在，不是想不出来）⇒
 *        诚实做法是**两件事一起做**：① 在注释里**明说它不可证伪**并给出因果链与
 *        实测证据；② 把承载它的断言搬到一条**直接驱动导出构造点**的 unit-level
 *        臂上（用真实路径造不出的**合成**场景把机制走一遍），那条臂**必须**能被打红。
 *        ★ 臂 3c（「字段不出现」）与臂 7b（first-wins）是本文件仅有的两条 (乙)。
 *        ★ 反面教材：本文件**第四版之前**的臂 7 把一条 (乙) 性质写成了一条(甲)式的
 *          "定向突变"注解（`withInputSurfaceOnError` 的守卫）—— 实测三次逐级加强的
 *          突变**全部**打不红它 ⇒ 那条注解是**恒真**的，而它读起来与其余各臂同形。
 *          这正是本文件存在的意义所要防的东西，故一并记在此处。
 *        ★ 一条臂若**只**剩下 (乙) 而没有被搬走的部分，那它就该被删掉 —— 留着它
 *          只会给"这里验过了"提供一份假保险。
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

import { kindRequirementsTable } from './kind-requirements-table.mjs'
import { parseKindRequirements } from '../lib/gates/completion/r5.js'
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
 * ★ 为什么非要有（而不是省掉）：成员报到（`update_task` 走 **completion** 位置）与
 *   真正的派发（`create_task` 走 **dispatch** 位置）都要求"这个任务被派发到了一个
 *   真实存在的 worktree" —— `dispatch.worktree` 的 `appliesTo` 读的正是它。
 *   没有它那两条 dispatch 判据是 `skipped`，"这个位置有没有判据"这件事在夹具里
 *   不可控 —— 而它正是本文件唯一的自变量。
 *
 * ★ t39 之后 dispatch 位置由 `create_task` 穿过（见下面 `CALLS` 的注释）；
 *   本函数与那件事无关，它只负责"世界是真的"。
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
 *   种成 `pending` 会让 `update_task`（要走到 completion 位置）在**到达之前**
 *   就被状态机拒掉，于是夹具读到"字段不出现"而误判成出口缺失。
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
  /**
   * ── ★★★ t39：`contract` 与 `dispatch` 现在【同在 `create_task` 上】───────────────
   *
   * ★ `create_task` 一次调用**穿过两个位置**：`contract`（契约合法性）与
   *   `dispatch`（派发前审过了吗）。而这是 t39 之后的新格局 ——
   *   此前 `dispatch` 挂在 `update_task` 上（而那里没有一次是派发）。
   *
   * ★★ 所以两者都带 `reviewed`：本文件测的是【每个位置的出口形状】，
   *   而"没审会被拦"不是它的自变量（那由 t39 自己的夹具覆盖）。
   *   ⇒ ★ 补全五问也必要：判据要求五问都有答案，
   *     而"只答一问"会被拒（实测措辞：「A stamp that answers 1 of 5 questions
   *     is not a review」）。
   */
  contract: (f) => f.call('agent_teams_create_task', {
    subject: 'w', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'],
    reviewed: {
      at: 1, by: 'probe',
      checks: [
        { id: 'scope', verdict: 'pass' },
        { id: 'prerequisite', verdict: 'pass' },
        { id: 'move', verdict: 'pass' },
        { id: 'acceptance', verdict: 'pass' },
        { id: 'boundary', verdict: 'pass' },
      ],
    },
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
  /**
   * ── ★★★ t39：`dispatch` 改走 `create_task`（真正的派发那一刻）─────────────────────
   *
   * ★ 它此前走 `update_task` —— 因为那个插入点的求值挂在那里。
   *   而 `update_task` 的四种状态**没有一次是派发**（`in_progress` 是成员报到、
   *   `completed`/`failed` 收口、`cancelled` 撤销）。
   *   ⇒ 把活交给成员发生在 `kickTeam`，而 `create_task`（与 `reassign`）是调它的那两处。
   *
   * ★★ 而 `update_task` 现在【只穿过 `completion` 一个位置】——
   *   所以下面 `completion` 那条调用**不再**顺带把 dispatch 也带出来。
   */
  dispatch: (f) => f.call('agent_teams_create_task', {
    subject: 'w-dispatch', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'],
    reviewed: {
      at: 1, by: 'probe',
      checks: [
        { id: 'scope', verdict: 'pass' },
        { id: 'prerequisite', verdict: 'pass' },
        { id: 'move', verdict: 'pass' },
        { id: 'acceptance', verdict: 'pass' },
        { id: 'boundary', verdict: 'pass' },
      ],
    },
  }),
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

/**
 * 形状：字段名集合必须是**四格，不多不少** —— 这就是"可机械比对"的字面意思。
 *
 * ── ★★★ 这一条本轮**长出了牙**（MEASURED，独立复核 verifier5 的 FINDING-3）───────
 *
 * MEASURED（本文件本轮）：本轮之前，把本函数改成**纯 no-op**（`return surface`）
 *   或者**允许额外键**（`assert.ok(SURFACE_KEYS.every((k) => k in surface))`），
 *   两个夹具**全绿**（实测 pass 11 / fail 0；allow-extra 变体同样是 11 pass）。
 *
 *   ⇒ 也就是说，本函数的文档说自己是"'可机械比对'的字面意思"，而**没有一条断言
 *     依赖它** —— 那句文档当时是一句**没有读数承担的结论**（本文件头记的
 *     "一条说不清被什么打红的断言，与一句注释同价"，这里是它的镜像）。
 *     承重的是臂 1 里那段**独立**的 `Object.keys(...).sort()` vs runtime 基线比对。
 *
 * ★ 修法（采纳 verifier5 给的 (a) 支）：让臂 1 **真的**依赖本函数 ——
 *   把臂 1 里那段重复的 `deepEqual(Object.keys(entry.surface).sort(), Object.keys(base.surface).sort())`
 *   去掉，改由本函数按 **`SURFACE_KEYS`** 检查；而 `SURFACE_KEYS` 现在**不再是
 *   一个手写字面量**，它由**运行时的基线**推出来（见下面 `SURFACE_KEYS` 的定义与
 *   臂 1 里对它的赋值）。
 *
 *   ⇒ 于是"四处与 runtime 逐字段同形"这句话现在**只有一条实现**，而它**承重**：
 *     本函数一旦退化成 no-op 或允许额外键，臂 1 就会红（本轮实测过这两种突变）。
 *
 * ★ 反向半边也留着（防"两边都是同一个常量"）：臂 1 另外断言五处的读数**至少有两种
 *   不同的 `incomplete` 取值** —— 形状一致若来自"写死的同一份常量"，那一条会红。
 */
const SURFACE_KEYS = ['checked', 'incomplete', 'missing', 'skipped']

/**
 * ── ★★★ `assertShape` 现在**承重**了，而它的牙来自"两个独立来源对得上"────────────
 *
 * ★★ 上一版的设计**没有牙**（本轮实测，值得记下来）：那一版让臂 1 先读 runtime
 *   那一份、把它写进一个模块级的 `baselineKeys`，再让 `assertShape` 拿它比对。
 *   看起来"尺子来自真世界"，实际是**循环论证** —— 尺子是从**被测出口**自己身上
 *   量的，于是把 `assertShape` 改成 no-op 之后**仍然全绿**（实测 pass 12 / fail 0）。
 *   一句话：`X 与 X 一致` 是恒真的。
 *
 * ⇒ 正确的形状是**两个独立来源**：
 *
 *     ① `SURFACE_KEYS` —— 本文件**写死**的四格（独立于被测代码）；
 *     ② runtime 那一份**真实读数**的键集合（来自真世界，臂 1 里读）。
 *
 *   而 `assertShape` 现在**同时**核①与②，于是它既不是自证、也不是常量比对：
 *   ① 保证"形状没被偷换成另一个错形状"（一个把五处都改成 `{a:1}` 的实现会红），
 *   ② 保证"形状确实与 runtime 同形"（runtime 真加第五格时，①会先红 —— 那正是
 *      提醒夹具该跟着改的地方，而不是**静默假绿**）。
 *
 * ★★ 本轮实测（**成对跑**，两次都做过 —— 单独跑其中一半会得出相反的结论）：
 *
 *     A) 干净的现实 + **真的** `assertShape`                ⇒ 12 pass / 0 fail（基准）
 *     B) 干净的现实 + **no-op** `assertShape`               ⇒ 12 pass / 0 fail
 *     C) 现实里**真的多挂一格** + **真的** `assertShape`    ⇒ **8 条臂红**
 *     D) 现实里**真的多挂一格** + **no-op** `assertShape`   ⇒ **只剩臂 1 红**
 *
 *   ★ B 那一条是**诚实的**，不是失败：现实是干净的，没有任何一处真的多挂一格，
 *     所以"把检查拿掉"当然没人踩到。**一条断言有没有牙，不能靠单独突变它来判定** ——
 *     必须把"检查拿掉"与"世界里真的出现了它要抓的东西"**成对**做（C vs D）。
 *   ★ C 与 D 的差就是 `assertShape` 的牙：它承担了**那 7 条**臂（12 减掉臂 1 与
 *     恒真的那几条）对"形状被改坏"的敏感度。而在 D 里，剩下那一处对账在臂 1
 *     里（基线与 `SURFACE_KEYS` 相核），所以臂 1 仍然红。
 *   ★ 把 `SURFACE_KEYS` 那个常量改错（多一格）也等价于 C：**8 条臂红**。
 *
 *   ⇒ 也就是说 `assertShape` 现在是**承重**的，而不是一句没有读数承担的文档 ——
 *     那正是 FINDING-3 说的事（原文说它是"'可机械比对'的字面意思"，而当
 *     "拿掉它"没有任何可观测差别时，那句话与注释同价）。
 */
function assertShape(surface, label) {
  assert.deepEqual(
    Object.keys(surface).sort(), SURFACE_KEYS,
    `★ ${label}：字段名集合必须是那四格（${SURFACE_KEYS.join(', ')}，不多不少）——`
    + ' 这四个字面量是本文件**独立于被测代码**写下的，而"与 runtime 同形"由臂 1 '
    + ' 拿它去核真实基线（两个来源对得上才叫同形）',
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
  ['dispatch', 'dispatch（create_task）'],
  ['completion', 'completion（update_task 第二步）'],
  ['delivery_status', 'delivery（agent_teams_status）'],
  ['delivery_declare', 'delivery（declare_delivery）'],
]

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0（前置）：本文件跑在**已构建**的产物上，且探针真的进了核对层
// ─────────────────────────────────────────────────────────────────────────────


const TABLE = kindRequirementsTable(parseKindRequirements)

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
  /**
   * ★★ 先把基线那一份读出来，再**用它核 `SURFACE_KEYS` 那个常量** —— 于是本臂的
   *   "逐字段一致"这句话由**两个独立来源相向而核**，而不是"说一遍再自己比一遍"。
   *
   * MEASURED（本文件本轮，独立复核 FINDING-3）：此前本臂末尾另有一段
   *   `Object.keys(entry.surface).sort()` vs `Object.keys(base.surface).sort()` 的
   *   `deepEqual`。那一段是**承重**的，而 `assertShape` 的文档却声称自己是
   *   "'可机械比对'的字面意思" —— 本轮实测：把它改成纯 no-op、或改成"允许额外键"，
   *   两个夹具**都全绿**（11 pass / 0 fail）。⇒ 它的文档当时**没有读数承担**。
   *
   * ⇒ 修法（verifier5 给的 (a) 支）：**把承重移到 `assertShape`**，而它的牙来自
   *   "本文件写死的四格"与"runtime 真实读数"这一次**对账**：
   *
   *     · `assertShape` 比的是 `Object.keys(surface).sort()` vs `SURFACE_KEYS`；
   *     · 而下面那一句把 runtime 那一份**真实**键集合也核到同一个常量上。
   *
   *   ⇒ 单独一个来源都不够：只核常量 ⇒ 可以两边一起改错（恒真）；
   *     只核基线 ⇒ 拿 X 比 X（本轮第一版就是这么失败的，实测仍全绿）。
   *   ★ 本轮实测：把 `SURFACE_KEYS` 改错（多一格）⇒ **8 条臂红**（含本臂）；
   *     把 `assertShape` 的比对目标换成"四格 + outcome"⇒ 同样 8 条红。
   *     也就是说这条断言现在**真的**会被"形状变了"打红。
   */
  for (const [siteKey, label] of [...PATCHED_SITES, ['runtime', 'runtime（status，基准）']]) {
    const isBaseline = siteKey === 'runtime'
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
    /**
     * ★★ 基线在场 ⇒ **当场拿它去核那个常量**（不是"用它当尺子"——那会变成 X 比 X）。
     *
     * ★★ 本轮实测过一次**假尺子**，值得记下来：第一版写的是
     *   `baselineKeys = Object.keys(surface).sort()`（把 runtime 自己的键存起来当尺子），
     *   于是把 `assertShape` 改成 no-op 之后**仍然全绿** —— 因为那把"尺子"是从
     *   **被测出口自己身上**量的，`X 与 X 一致` 恒真；而 arm 1 里剩下的比对又只有
     *   **类型**比对（对"多一格"完全无感）。
     *   ⇒ 修法：**不是**存一份基线，而是让真实基线与**本文件写死的四格**对账。
     */
    if (isBaseline) {
      /**
       * ★★★ 这一句是 FINDING-3 的**落点**：runtime 那一份**真实**读数的键集合，
       *   必须与**本文件独立写下的** `SURFACE_KEYS` 对得上。
       *
       *   ⇒ 两个来源（真世界 / 本文件）相向而核 —— 不是拿 X 去比 X。
       *   ★ 它同时给 `assertShape` 那个常量一个**外部锚**：常量若被谁改错，
       *     真实基线会当场对不上 ⇒ 红，而不是静默把两边一起改掉。
       */
      const actualBaselineKeys = Object.keys(surface).sort()
      assert.deepEqual(
        actualBaselineKeys, SURFACE_KEYS,
        `★ 基线（runtime）那一份**真实读数**的字段名必须与本文件写死的四格一致`
        + `（实测 ${actualBaselineKeys.join(', ')} vs ${SURFACE_KEYS.join(', ')}）——`
        + ' 本文件其余所有臂都拿这四格当尺子；基线一旦变了，尺子也就变了',
      )
    }
    assertShape(surface, label)
    reads.push({ label, surface, via, isBaseline })
  }
  const base = reads.find((entry) => entry.isBaseline)
  assert.notEqual(base, undefined, '★ 基准必须在场')
  /**
   * ★ 基线之外那四处，再逐字段与**基线**比一次类型 —— 这是**第二读数**，不是承重墙：
   *   它比的是"两边的值类型一致"，而**承重**的是上面那一对（`assertShape` 的四格
   *   常量 + 基线与该常量对账）—— 本轮实测：把 `SURFACE_KEYS` 改错 ⇒ 8 条臂红。
   */
  for (const entry of reads) {
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
   * ⇒ 修法：给 dispatch **造一次它自己的拒绝**。这样两个位置各有各的拒绝，
   *   两个位置名都该在场。
   *
   * ── ★★ t39 之后这次拒绝必须走 `create_task`（本文件第三版修正）─────────────────
   *
   * MEASURED（本文件本轮实测，本臂因它而红）：
   *
   *   上面那句修法写的是"越界路径 ⇒ `dispatch.changed-paths` 有话可说"，而它当时
   *   走的是 `agent_teams_update_task`。t39 把 `dispatch` 插入点的**求值搬到了
   *   `create_task`** 上（理由：`update_task` 的四种状态**没有一次是派发**），
   *   于是 `update_task` 现在**只穿过 `completion` 一个位置** ——
   *   它在这一格上**永远**产不出 `dispatch_input_surface`。
   *
   *   ⇒ 症状：`dispatchReject.error` 上只有 `completion_input_surface` +
   *     `input_surface`，而本臂按**位置名**去找 ⇒ 读到 `undefined` ——
   *     **读起来像"产品没交出来"，实际是这条路径上那件事压根没发生**。
   *     这与本臂上面记的那次假红是**同一个病**（自变量选错了），只是换了个位置。
   *
   * ⇒ 修法：改用**真正的派发那一刻** `create_task`，并让它的 dispatch 位置当场拒绝：
   *   不给 `reviewed` ⇒ `dispatch.plan-reviewed` 报 blocker ⇒ `create_task` 走
   *   `throwWithSurface(…, dispatchSurface, 'dispatch_input_surface')`
   *   （`src/tools/create-task.ts:421` —— 调用点；函数定义在
   *    `src/tools/shared/entities.ts:2417`）。
   *
   * ★ 为什么 `inScope` 里必须带 `lib/`：`contract.build-artifact-scope` 会在
   *   **contract** 位置先把"只声明 `src/`、不声明构建产物"这一次调用拒掉 ——
   *   而那次拒绝的落点是泛用名 `input_surface`，dispatch 那一段**根本没走到**。
   *   ⇒ 夹具必须让 contract 位置放行，才能读到 dispatch 位置自己的拒绝。
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
  const dispatchReject = await rejectFixture.call('agent_teams_create_task', {
    subject: 'w-dispatch-reject', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'],
    /** ★ 故意**不带** `reviewed`：`dispatch.plan-reviewed` 当场报 blocker ⇒ 这一次被拒。 */
  })
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
   * ── ★★★ 本轮的读数修正：`if (false)` 恒挂**不**在这里红（MEASURED）─────────────
   *
   * MEASURED（本文件本轮，独立复核 verifier5 的 FINDING-1）：本臂此前写着
   *   「把那一行改成 `if (false) return undefined`（恒挂）⇒ C 态塌进 A 态 ⇒ 本臂红」。
   *   **那句话是错的。** 实测：改 `src/tools/shared/entities.ts:1806` 为 `if (false)`
   *   并重建 `lib/` 之后，本臂**照绿**（两个夹具都绿，见下面那段"它为什么不红"）。
   *
   * ★ 原因在 C 态这一段的构造上：本臂读的 C 态是**"这个位置这一轮没被核对"**
   *   （`agent_teams_status` 不经过 `contract`）—— 而那与 `inputSurfaceOf` 里那条
   *   分界线**没有因果关系**：不经过 ⇒ 那个构造点**压根没被调用** ⇒ 它返回什么
   *   都不影响这里。一个恒挂的实现照样让 `contract_input_surface` 缺席。
   *   ⇒ 这正是本队记账的第一种形态（**恒真**）：断言与它声称要证伪的那行代码之间
   *     隔着一整条不存在的调用路径。
   *
   * ⇒ 两处修法（都在本文件里落地）：
   *   ① 本臂留下的 C 态断言如实**降级**为"并排布局的对照"，并明说它证伪的是什么
   *      （见下面那段 `contractC` 的注释）；
   *   ② 那条**真的**可被 `if (false)` 打红的性质，搬进新臂 **3c** —— 它直接对
   *      **在册 0 条判据的位置**叫 `inputSurfaceOf`，于是"字段不出现"这句话
   *      第一次与那一行有了因果关系。
   *
   * ★ 现在本臂**仍然**会红的定向突变：把 `if (audit.checked + audit.skipped === 0) return undefined`
   *   改成 `if (true) return undefined`（恒不挂）⇒ A/B 两态一起消失 ⇒ 本臂红。
   *   （这一条我实测过，见提交说明；而恒挂那一条现在由臂 3c 承担。）
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
   *
   * ── ★★ t39 之后这一段必须改走 `create_task`（本文件第三版修正）─────────────────
   *
   * MEASURED（本文件本轮实测，本臂因它而红）：
   *
   *   这一段此前用 `agent_teams_update_task`（不带 `changedPaths`）去读 `dispatch`
   *   位置的读数。t39 把 dispatch 插入点的求值搬到 `create_task` 之后，
   *   `update_task` **只穿过 `completion` 一个位置** ⇒ 它交出来的值上
   *   **没有** `dispatch_input_surface` 这一格（实测 `value keys = […,
   *   "completion_input_surface"]`）⇒ `readExit('dispatch', …)` 读到 `undefined`。
   *
   *   ⇒ 症状读起来是"字段不出现"（C 态！），而**那正是本段要读的第四种读数**
   *     —— 一次归因指向产品代码的假红，与文件头记的那条教训同形。
   *
   * ⇒ 修法：改走 `create_task`，**不带 `changedPaths` 那一格**。
   *   `dispatch.changed-paths` 与 `dispatch.worktree` 两条真实判据的 `appliesTo`
   *   都读 `update.changedPaths`（这一轮没有"成员改动"这回事）⇒ 两条都 skipped，
   *   而 `dispatch.plan-reviewed` 适用 ⇒ `checked + skipped = 3 ≠ 0` ⇒ 字段**在场**。
   *
   *   ★ 而这里**不能**再顺手不带 `reviewed`：那会让 dispatch 位置当场**拒绝**，
   *     读数就变成"拒绝路径上的那一份"，本段要的是**成功路径**上的那一份。
   *     ⇒ 带上五问齐备的 `reviewed`（与 `CALLS.dispatch` 同源）。
   */
  const wsC2 = freshWorkspace('tri-c2')
  seedWorktree(wsC2)
  const fixtureC2 = pluginFixture(wsC2)
  await seedTeam(wsC2, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
  const c2 = await fixtureC2.call('agent_teams_create_task', {
    subject: 'w-no-changed-paths', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'],
    reviewed: {
      at: 1, by: 'probe',
      checks: [
        { id: 'scope', verdict: 'pass' },
        { id: 'prerequisite', verdict: 'pass' },
        { id: 'move', verdict: 'pass' },
        { id: 'acceptance', verdict: 'pass' },
        { id: 'boundary', verdict: 'pass' },
      ],
    },
  })
  assert.equal(c2.ok, true, `★ 前置：不带 changedPaths 的这一次必须**成功**（本段读的是成功路径上的那一份）—— ${c2.error?.message?.slice(0, 160) ?? ''}`)
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
    '★ 「这个位置有判据、但这一轮有判据不适用」（`skipped > 0`）⇒ 字段**照样在场**；'
    + ' 它不等于 C 态（"这里没有判据"⇒ 字段不出现）。一个把 `skipped` 读成"没判据"的实现会在这里红。',
  )
  assertShape(dispatchNoPaths, 'dispatch（有判据但不适用）')
  /**
   * ── ★★ t39 之后这一段读数变了，而**断言必须跟着变成真的**（本文件第三版修正）──
   *
   * MEASURED（本文件本轮）：`checked === 0` 在这条路径上**已经不可达**，而成因不是缺陷：
   *
   *   · 旧读法（`update_task`）走的是**种子里那条** `IMPL_TASK`（`createdAt: 1`），
   *     而 `dispatch.plan-reviewed` 的 `appliesTo` 对**早于上线时刻**的任务返回假
   *     （`predatesThisGate`，见 `src/gates/dispatch/plan-reviewed.ts:186`）⇒ 三条全 skip。
   *   · `create_task` **自己**写 `createdAt = Date.now()` ⇒ 这条任务**必然晚于**
   *     那道门 ⇒ `plan-reviewed` **必然适用** ⇒ `checked ≥ 1`。这一格**造不出 0**。
   *
   * ⇒ 断言改读**同一件事**的两个真实侧面，而不是把一个不可达的数硬写进去：
   *
   *   ★ `skipped >= 1`：真有判据**在册而这一轮不适用**（`changedPaths` 这一轮缺席 ⇒
   *     `changed-paths` / `worktree` 两条的 `appliesTo` 为假）——**它们照样进这个位置
   *     的读数**（进的是 `skipped`，不是"不存在"）。
   *   ★ `checked + skipped === 注册表在这个位置上的判据总数`：**这才是不变的性质** ——
   *     `checked` 数的是"这一轮**适用**的条数"，`skipped` 数的是"在册但不适用"，
   *     两者相加才等于这个位置的全部判据。
   *
   *   ⇒ 一个把 `skipped` 读成"没判据"的实现，会让 `checked + skipped` **小于**总数
   *     （或让字段整个不出现）—— 本段照样在这里红。★ 而被删掉的那条 `checked === 0`
   *     本来也只是"总数恰好都 skip"的一个特例，不是这条臂要证伪的东西。
   */
  const dispatchViews = gateModuleViews().filter((view) => view.point === 'dispatch')
  assert.ok(
    dispatchNoPaths.skipped >= 1,
    `★ 这一轮确实有在册的判据不适用（实测 skipped = ${dispatchNoPaths.skipped}）——`
    + ' 而它们**照样进这个位置的读数**，不是"不存在"',
  )
  assert.equal(
    dispatchNoPaths.checked, 1,
    `★ 而这一轮**适用**的只有那一条（实测 ${dispatchNoPaths.checked}）—— `
    + '`checked` 数的是适用条数，不是"在册条数"，也不是"这个位置有没有判据"',
  )
  /**
   * ── ★★★ 这条不是证伪器，而是一条**注册表/视图关系的自检**（本轮如实改名）───────
   *
   * MEASURED（本文件本轮，独立复核 verifier5 的 FINDING-1 之后**撤回**一句旧断言）：
   *
   *   这里此前写着「一个把 `skipped` 读成"没判据"、或让不适用的判据从读数里蒸发的
   *   实现，会让左边小于右边」。**那句话是错的 —— 这条断言恒真。**
   *
   * ★ 为什么恒真（逐行读出来的因果链，不是推断）：
   *
   *   · `inputSurfaceOf` 的 `checked`/`skipped` 来自 `auditGateRequires(point, ctx)`
   *     （`src/tools/shared/entities.ts:1805`）；
   *   · 而 `auditGateRequires` 把 `gateModuleViews().filter(point)` **整个列表**交给
   *     `auditRequires`（同文件 1715 起，那段注释写的就是"唯一真值来源是注册表"）；
   *   · `auditRequires`（`src/gates/requires.ts:681-689`）对**同一个** `subjects` 数组
   *     做两次 `filter`：
   *         `checked = checks.filter(status !== 'skipped').length`
   *         `skipped = checks.filter(status === 'skipped').length`
   *     —— 两条 filter 的谓词**互斥且穷尽**（每个 `status` 要么是 `'skipped'` 要么不是）
   *     ⇒ `checked + skipped === checks.length`，而 `checks` 就是那个列表。
   *
   *   ⇒ 于是 `checked + skipped === gateModuleViews().filter(point).length` 是
   *     **分区的定义**，与 `inputSurfaceOf` 怎么写**无关**：只要那两个数还是从这一对
   *     filter 算出来的，它就不可能不成立。左边**恒等于**右边。
   *
   * ★★ 那它测的是什么 —— 而且它**不是**没有价值，只是价值不在"证伪产品代码"：
   *
   *   · 它钉住**这一对 filter 至今仍是互斥穷尽的分区**（哪天有人把 `skipped` 改成
   *     "只数某一种成因"，这条立刻红 —— 而那正是它该有的作用）；
   *   · 它同时是"这一轮 `checked === 1`、`skipped >= 1` 那两个数**确实出自 dispatch
   *     这个位置**"的横向对照（别的位置条数不同 ⇒ 对不上）。
   *
   *   ⇒ 换句话说：它是**自检**，不是**证伪器**。本文件头那条纪律（"凡说不出突变的
   *     臂宁可不写"）在这里的正确答案是**说出它测的是什么**，而不是留一句关于
   *     "什么会让它红"的假话 —— 一句读起来像结论、实际恒真的话，正是本文件
   *     反复记账的那种病。
   *
   * ★ 而被这句假话挤掉的那条**真的**证伪器，现在住在臂 **3c**：
   *   `if (audit.checked + audit.skipped === 0) return undefined` 改成 `if (false)`
   *   ⇒ 臂 3c 红（实测）。**那条**才是"字段不出现"这句话的因果承担者。
   */
  assert.equal(
    dispatchNoPaths.checked + dispatchNoPaths.skipped, dispatchViews.length,
    `★ ★ 自检（不是证伪器，见上）：\`checked\` + \`skipped\` 是 \`auditRequires\` 对同一份`
    + ` subjects 的两次互斥 filter ⇒ 左边**恒等于**右边。它钉的是"这一对 filter 仍是分区"`,
  )
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
// 臂 3c：三态里的第三种 —— **字段不出现**，而这一条真的能被"恒挂"打红
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3c：三态里的 C 态（**字段不出现**）—— 在册 0 条判据的位置上，`inputSurfaceOf` 必须返回 `undefined`', async () => {
  /**
   * ── ★★★ 这一臂是**补上的**，理由是原臂 3b 的 C 态断言打不红（MEASURED）───────
   *
   * MEASURED（本文件本轮，独立复核 verifier5 的 FINDING-1）：
   *
   *   把 `src/tools/shared/entities.ts:1806` 的
   *       `if (audit.checked + audit.skipped === 0) return undefined`
   *   改成 `if (false) return undefined`（**恒挂**）并重建 `lib/` 之后：
   *
   *     · 本文件 —— 除臂 9（它读的是源码串，属于另一件事）外**一条都没红**；
   *     · 实现者夹具 —— **全绿**（11 pass / 0 fail）。
   *
   *   ⇒ 也就是说："这个位置没判据 ⇒ 字段不出现"这条**任务中心行**，
   *     在两个夹具里**都没有**一个真能打红它的臂。这是本任务六条验收里
   *     第 ② 条（三态两两不同形）的**真缺口**，而不是夹具措辞的问题。
   *
   * ── ★ 为什么原臂 3b 打不红它（因果链，逐行读出来的）─────────────────────────
   *
   *   臂 3b 的 C 态读法是「`agent_teams_status` **不经过** contract 位置 ⇒ 那个
   *   位置的字段不出现在这次返回值上」。而那与那一行**没有因果关系**：
   *   不经过 ⇒ `rejectOnContractGates` **压根没被调用** ⇒ `inputSurfaceOf` 返回
   *   什么都不影响这次返回值。恒挂的实现照样让那个字段缺席。
   *   ⇒ 本队记账的第一种形态：**恒真**（断言与被测那一行之间隔着一条不存在的路径）。
   *
   * ── ★ 那 C 态**到底怎么造**（本轮实测，两条路）───────────────────────────────
   *
   *   `inputSurfaceOf` 只在 `checked + skipped === 0` 时返回 `undefined`，而
   *   `checked + skipped` **恒等于** `gateModuleViews().filter(point).length`
   *   （`auditRequires` 的两条互斥 filter，见臂 3b 那段更正）。
   *   ⇒ C 态的**充要条件**是：**这个位置在注册表里一条判据都没有**。
   *
   *   实测（本文件本轮的独立测量，`node` 直接调 `lib/`）：
   *
   *     contract    在册 3 条 ⇒ inputSurfaceOf = {checked:0, incomplete:0, skipped:3, …}
   *     dispatch    在册 3 条 ⇒ {… skipped:3 …}
   *     completion  在册 4 条 ⇒ {… skipped:4 …}
   *     delivery    在册 2 条 ⇒ {… skipped:2 …}
   *     runtime     在册 1 条 ⇒ {… skipped:1 …}
   *     admission   在册 0 条 ⇒ **undefined**   ← C 态就在这里
   *
   *   ★ 注意 `runtime` 那一格：它是**最像** C 态的一个（`create_task` 走
   *     `event='task-created'`，而 `runtime.liveness.appliesTo` 只认
   *     `'task-status'` / `'runtime-liveness'` ⇒ **那一条不适用**）。
   *     实测它读到的仍然是 `{checked:0, skipped:1}` —— **在场**。
   *     理由正是本文件已经记对的那句：`skipped` = "在册但不适用"，不是"没判据"。
   *
   *   ⇒ 所以 C 态**不能**靠"换个调用点/换个事件"造出来（那只会造出 `skipped > 0`）；
   *     它只能靠"**这个位置没有判据**"造，而真实注册表里五个位置**都有判据**。
   *
   * ★★ 本臂的做法：**不**注销任何真实判据（那会同时改掉 `registry.count`，
   *   一个自变量动两根轴 —— 见臂 3b 那段）。改用**位置**做自变量：
   *   对一个**本来就不在注册表里**的位置调用 `inputSurfaceOf` —— 那正是
   *   "这个位置没有判据"的字面状态，而且是**真实存在**的状态（`admission`
   *   就是这样一个位置：它有判据模块，但不挂在这五个读数位置上）。
   *
   * ★ 这一臂读的是**导出的构造点本身**，不是某个工具的返回值 —— 那是有意的：
   *   那五个出口**全部**转调这一个函数（见臂 9 的产物标记），所以在那里断言
   *   等价于在每一个出口上断言，却**不需要**为了造 C 态去拿掉一个真实工具的行为。
   *
   * ── ★ 定向突变（本轮实测过的那一条）──────────────────────────────────────────
   *
   *   把 `src/tools/shared/entities.ts:1806` 的
   *       `if (audit.checked + audit.skipped === 0) return undefined`
   *   改成 `if (false) return undefined`（**恒挂**）⇒ 下面**每一条**断言都红：
   *   空位置的读数从 `undefined` 变成一个挂出来的空面。
   *   ★ 反过来改成 `if (true)`（恒不挂）⇒ A/B 两态消失 ⇒ 臂 2 / 臂 3a 红。
   *   ⇒ 三态这一次是**真的**两两不同形，而且每一态都有能打红它的那一次改动。
   */
  const { inputSurfaceOf } = await import(pathToFileURL(join(ROOT, 'lib', 'tools', 'shared', 'entities.js')).href)

  const views = gateModuleViews()
  const pointsWithGates = [...new Set(views.map((view) => view.point))].sort()

  /**
   * ★ 前置：真实注册表里那五个位置**都**在册（否则下面那条"空位置"的对照不成立
   *   —— 它可能只是"注册表整体是空的"）。
   */
  for (const point of ['contract', 'dispatch', 'completion', 'delivery', 'runtime']) {
    assert.ok(
      views.filter((view) => view.point === point).length >= 1,
      `★ 前置：真实注册表里 \`${point}\` 位置必须**在册**（实测 ${views.filter((view) => view.point === point).length} 条）——`
      + ' 否则下面那条"空位置返回 undefined"可能只是因为整个注册表都是空的',
    )
  }

  /**
   * ★ 前半（对照半边）：**在册**的五个位置，即使这一轮一条都不适用，字段也**在场**
   *   —— 它挂的是 `{checked: 0, skipped: N}`，而那就是"有判据但不适用"的读数。
   *
   *   ★ 半边正是"`skipped` ≠ 没判据"这句话的**正面**证据：一个把 `skipped` 读成
   *     "没判据"的实现会让这五个全都返回 `undefined` ⇒ 当场红。
   *
   *   ★ 用 `{}` 做 ctx 是有意的：它对每一条判据都"什么都不给"，于是每条判据的
   *     `appliesTo` 都会说"不适用"（或它没有 appliesTo）⇒ 这个读数**只**由
   *     "在册几条"决定。而本臂要证的正是那条分界线。
   */
  for (const point of pointsWithGates) {
    const surface = inputSurfaceOf(point, {})
    assert.notEqual(
      surface, undefined,
      `★ 对照半边：\`${point}\` 位置在册 ${views.filter((view) => view.point === point).length} 条判据 ⇒`
      + ' 即使这一轮一条都不适用，字段也必须**在场**（挂的是 `skipped`，不是"没判据"）。'
      + ' ★ 一个把 `skipped` 读成"没判据"的实现会在这里红。',
    )
    assertShape(surface, `${point}（在册但不适用）`)
    assert.ok(surface.checked + surface.skipped >= 1, `★ 在册 ⇒ checked+skipped ≥ 1（实际 ${surface.checked + surface.skipped}）`)
  }

  /**
   * ★★ 决定性的一半：**在册 0 条**的位置 ⇒ `checked + skipped === 0` ⇒ 字段**不出现**。
   *
   *   ★ 这个位置不是"编出来的"：它是 `gateModuleViews()` 里**出现过判据模块、
   *     但不挂在这五个读数位置之一**的那个（注册表的 `INSERTION_POINTS` 与
   *     判据模块的 `point` 是两件事）。本臂要求它**真的**在册 0 条 —— 否则
   *     它就不是 C 态，而是一条关于别的东西的读数。
   */
  const emptyPoint = 'admission'
  assert.equal(
    views.filter((view) => view.point === emptyPoint).length, 0,
    `★ 前置：\`${emptyPoint}\` 位置必须真的在册 0 条（实测 ${views.filter((view) => view.point === emptyPoint).length} 条）——`
    + ' 否则它不是 C 态，本臂测的是别的东西。★ 而它同时是**真实**状态：'
    + ' 一个判据模块可以存在而不挂在读数位置上。',
  )
  const empty = inputSurfaceOf(emptyPoint, {})
  assert.equal(
    empty, undefined,
    '★★ C 态（这个位置没判据）：字段**不出现** —— 它不是 `incomplete: 0`，也**不是 ok**。'
    + ' ★★ 一个恒挂的实现（`if (audit.checked + audit.skipped === 0)` 改成 `if (false)`）'
    + ' 会在这里返回一个挂出来的空面 ⇒ 本臂红。**这是本文件唯一一条真能打红那一行的断言。**'
    + ` 实际读数：${JSON.stringify(empty)}`,
  )

  /**
   * ★★ 三态并排（本臂的核心）：A / B / C 三个读数两两**不同形**，而且三态
   *   **出自同一条分界线**（`checked + skipped === 0`），不是三次各说各的。
   *
   *   A：在册且都齐    ⇒ `{checked: N ≥ 1, incomplete: 0}`
   *   B：在册且缺格    ⇒ `{checked: N ≥ 1, incomplete: M ≥ 1}`（由探针提供，见臂 3a）
   *   C：**不在册**    ⇒ `undefined`
   */
  const armedWorkspace = freshWorkspace('tri-c-state')
  const b = await drive(armedWorkspace, 'contract', { probe: true })
  const surfaceB = exitOf('contract', b.result).surface
  assert.notEqual(surfaceB, undefined, '★ B 态（有缺格）：字段在场')
  assert.ok(surfaceB.incomplete >= 1, '★ B 态：incomplete ≥ 1')
  const plainWorkspace = freshWorkspace('tri-a-state')
  const a = await drive(plainWorkspace, 'contract')
  const surfaceA = exitOf('contract', a.result).surface
  assert.notEqual(surfaceA, undefined, '★ A 态（都齐）：字段在场')
  assert.equal(surfaceA.incomplete, 0, '★ A 态：incomplete: 0')
  assert.notDeepEqual(surfaceA, surfaceB, '★ A 与 B 不同形（都齐 vs 有缺格）')
  assert.notEqual(empty, surfaceA, '★ C 与 A 不同形（字段缺席 vs incomplete: 0）—— 这一条就是乙方案被否的理由')
  assert.notEqual(empty, surfaceB, '★ C 与 B 不同形（字段缺席 vs 有缺格）')
  /**
   * ★ 而且 C 态那一支**确实**是"在册 0 条"造出来的，不是"调用点不经过"：
   *   `admission` 在册 0 条这个事实上面已经断言过。这里再补一句"它在册 0 条
   *   ⇒ `checked + skipped === 0` ⇒ 返回 undefined"的**因果**读数，
   *   免得读者把它读成"这个位置恰好没被调用"。
   */
  assert.equal(
    inputSurfaceOf(emptyPoint, {}), undefined,
    '★ 决定性的一半必须**可重复**（同一个输入两次同一个结论）—— 一次性的读数可能是别的路留下的',
  )
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
      siteKey: 'dispatch', label: 'dispatch（create_task）', probe: true, tasks: [IMPL_TASK],
      /**
       * ── ★★ t39 之后这句措辞的主语变了（本文件第三版修正）───────────────────────
       *
       * MEASURED（本文件本轮，本臂因它而红）：此处此前写的是
       *   `/update_task reached the dispatch gate with an unfinished input surface/`。
       *
       *   t39 把 `dispatch` 插入点的求值从 `update_task` **搬到了** `create_task`
       *   （`update_task` 的四种状态没有一次是派发）⇒ 现在**只有** `create_task`
       *   能走到这一格，而它的日志主语是 `create_task`。
       *   ⇒ 逐字读 `src/tools/create-task.ts:402`：
       *     `agent-teams: create_task reached the dispatch gate with an unfinished input surface (recorded, not rejected): …`
       *
       * ★ 正则**仍然指名位置**（`dispatch gate`）与**主语**（`create_task`）——
       *   它与 contract / delivery 那两条**互不匹配**，所以"读日志的人分得出是哪个位置"
       *   这条性质照旧可证伪。★ 它**不是**被放宽成 `/reached the .* gate/`。
       *
       * ── ★★ 而"互不匹配"这句话**本身**到本轮才有断言承担（MEASURED）────────────
       *
       *   ★ 上面那句在本轮之前是**注释里的结论，不是读数**：把本条换成位置无关的
       *     `/reached the .* gate with an unfinished input surface/` 之后，
       *     全文件**11 条臂全绿**（实测）。⇒ "互不匹配"当时谁都没在核。
       *
       *   ★ 现在它由本臂末尾那一对循环承担：**∀ i≠j，cases[j] 的正则不匹配
       *     observed[i] 的每一条日志**，再加"每条正则至少匹配自己那一处"的反向半边。
       *     ⇒ 本条正则一旦被放宽成位置无关的写法，它会在别人的日志上命中 ⇒ **当场红**
       *     （本轮实测过这一次突变）。
       */
      pattern: /create_task reached the dispatch gate with an unfinished input surface/,
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
  /**
   * ── ★★★ 「位置可分辨」这一半现在**真的被核了**（本轮补上，理由是实测出来的）──
   *
   * MEASURED（本文件本轮，独立复核 verifier5 的 FINDING-2）：
   *
   *   上面那条 `logs.some((line) => entry.pattern.test(line))` 只要求"这个位置的那条
   *   日志**匹配得上**"—— 它**不**排除"这条正则在别的位置的日志上也匹配"。
   *   实测：把 `dispatch` 那一条换成**刻意与位置无关**的
   *   `/reached the .* gate with an unfinished input surface/` 之后，
   *   **11 条臂全绿**（pass 11 / fail 0）。
   *
   *   ⇒ 也就是说，本臂注释里写的「它与 contract / delivery 那两条**互不匹配**，
   *     所以"读日志的人分得出是哪个位置"这条性质照旧可证伪」——
   *     **那句话当时并没有被任何断言承担**。它是注释里的一句结论，不是一条读数。
   *     本文件头写着"一条说不清被什么打红的断言，与一句注释同价"；这里是它的
   *     镜像：**一句没有任何断言承担的结论，与没写同价。**
   *
   * ★ 修法：把"互不匹配"从**声称**变成**断言** —— 位置特异性本来就是一个
   *   **两两之间**的性质（"这条正则认得出自己那一条"只是必要条件），
   *   所以它必须写成"**别的**位置的日志都**不**匹配"：
   *
   *     ∀ i ≠ j ： cases[j].pattern 不匹配 observed[i] 的每一条日志
   *
   *   ⇒ 这样一条正则若被放宽成与位置无关的写法，它会在**别人的日志**上命中 ⇒ 当场红。
   *   ★ 而 `observed` 里已经有每个 label 的 `logs`（上面那段收集的），不需要新自变量。
   *
   * ★ 与 `logs.some(...)` 那条**成对**，缺一不可：
   *     `some` 单独看  ⇒ "匹配得上" —— 一条"什么都能匹配"的正则（如点星）也能过
   *     互不匹配单独看 ⇒ "认不出别人的" —— 一条什么都不匹配的正则也能过
   *     两条一起      ⇒ 只有"认得出自己的、且认不出别人的"能过
   */
  for (const [index, entry] of cases.entries()) {
    const others = observed.filter((_, other) => other !== index)
    assert.equal(
      others.length, cases.length - 1,
      `★ 对照面必须完整：${entry.label} 之外的另外 ${cases.length - 1} 处都要在（实际 ${others.length} 处）`,
    )
    for (const other of others) {
      /**
       * ★ 每一条别人日志都**必须不匹配**（不是"至少有一条不匹配"）——
       *   "至少一条"会被"这一处同时打了两条措辞不同的日志"蒙过去，
       *   而那正是"读日志的人分不出是哪个位置"的真实成因。
       */
      for (const line of other.logs) {
        assert.equal(
          entry.pattern.test(line), false,
          `★ ${entry.label} 的正则**认出了** ${other.label} 的日志 —— 那说明它没有指名位置，`
          + ' 一个读者拿到这条日志分不出它来自哪个位置（这正是本臂声称要钉的性质）。'
          + ` 实际匹配上的那一行：${JSON.stringify(line)}`,
        )
      }
    }
  }
  /**
   * ★ 反向半边（防"恒不匹配"）：上面那一对循环只说明三条正则**互不干扰**，
   *   一个"三条都写成 `/^$/`（谁都不匹配）"的实现也能过 —— 所以这一句必须留着：
   *   每一条正则**至少**要匹配上它自己那一处的一条日志。它与上面的互斥断言**成对**。
   */
  for (const [index, entry] of cases.entries()) {
    assert.ok(
      observed[index].logs.some((line) => entry.pattern.test(line)),
      `★ 反向半边：${entry.label} 的正则必须匹配**它自己**那一处的日志（否则"互不匹配"是靠"谁都不匹配"做到的）。`
      + ` 实际：${JSON.stringify(observed[index].logs)}`,
    )
  }
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
  /**
   * ── ★★ 这个数**不许写死**（本文件第三版修正）───────────────────────────────────
   *
   * MEASURED（本文件本轮，本臂因它而红）：此处此前写 `assert.equal(views.length, 3, …)`，
   *   而注释里那句话（"真实判据 2 条 + 探针 1 条 = 3"）在当时是**对的**。
   *   它现在是 **4** —— 而**不是**因为本文件多注册了探针，是因为
   *   `contract` 位置上**真实判据**从 2 条长到了 3 条
   *   （`contract.build-artifact-scope` / `contract.verify-command` /
   *     `contract.task-atomicity`）。
   *
   * ★ 一个写死的字面量会让这条断言在**每一次真实判据增删**时假红（或更坏：
   *   有人为了让红变绿去改数字，而数字与事实**再也对不上**）——
   *   那正是本文件开头点名要防的"把两份真相各写一遍"。
   *
   * ⇒ 改为**从两个真来源各自数出来，再断言它们的关系**（臂 0 用的是同一个思路）：
   *     · `realCount`  —— 真实判据条数 = 本位置的清单**减去**本文件注册的探针；
   *     · `probeCount` —— 本文件在这个位置注册的探针条数（从 `registeredProbes` 数）。
   *
   *   ★ 断言的是 `views.length === realCount + probeCount`，而**不是**任何字面量。
   *   ★ 并且 `realCount` 还必须**对得上产品交出来的读数**：`surface.checked`
   *     这一轮是 2 条 —— 探针闸门关着，而真实判据里有一条
   *     （`contract.verify-command`）这一轮 `appliesTo` 为假 ⇒ 它进 `skipped`。
   *     ⇒ 于是断言 `realCount === surface.checked + surface.skipped`
   *     （★ 也就是"这个位置在册的真实判据 = 适用的 + 不适用的"），
   *     而不是 `realCount === surface.checked`（后者只在"全都适用"时成立，
   *     把它当不变式会让本臂在真实判据增删时假红）。
   */
  const probeIdsOnContract = registeredProbes
    .filter((probe) => probe.point === 'contract')
    .map((probe) => probe.id)
  const realViews = views.filter((view) => !probeIdsOnContract.includes(view.id))
  const realCount = realViews.length
  const probeCount = views.length - realCount
  assert.equal(
    views.length, realCount + probeCount,
    `★ 清单 = 真实判据 + 本文件注册的探针（实测 ${realCount} + ${probeCount} = ${views.length}）`,
  )
  assert.ok(probeCount >= 1, `★ 本文件在这个位置确实注册了探针（实测 ${probeCount} 条）—— 否则"这个位置有判据"那条自变量不存在`)
  /**
   * ★★ 决定性的一半：注册表里**这个位置**的判据条数，必须与**产品刚交出来的读数**
   *   对得上 —— 一个"五处共用一份与位置无关的快照"的实现会在这里红。
   *
   * ★ `checked` 只数**这一轮适用**的；不适用的（含本文件那条闸门关着的探针）
   *   都进 `skipped` ⇒ **`checked + skipped` 才是"这个位置在册的判据条数"**，
   *   也就是 `views.length`。★ 这与臂 3b 那段实测是同一个性质
   *   （"`skipped` = 在册但不适用"，不是"没判据"）。
   *
   * ★★ 这条断言**同时**证伪本臂存在的两件事：
   *   ① 「出口是恒挂一份与位置无关的常量」—— 常量不会正好等于**这个位置**的
   *      `checked + skipped`（别的位置的判据条数不同）；
   *   ② 「`checked` 数的是**别的**位置的判据」—— 若它数的是别处，
   *      `checked + skipped` 就对不上这里注册表的条数。
   */
  assert.equal(
    surface.checked + surface.skipped, views.length,
    `★ 注册表里 contract 位置的判据共 ${views.length} 条（真实 ${realCount} + 探针 ${probeCount}），`
    + ` 必须等于产品读数里的 \`checked\`(${surface.checked}) + \`skipped\`(${surface.skipped}) —— `
    + '不等 ⇒ 出口交的不是**这个位置**的核对结论（第四种恒真写法），或者 `checked` 数的是别处的判据。'
    + ' ★ 而 `skipped` 里那条是**本文件闸门关着的探针**：它照样进这个位置的读数，'
    + ' 因为"在册但不适用"与"没判据"是两件事（见臂 3b 的实测）。',
  )
  assert.ok(
    realCount >= 0 && probeCount >= 1,
    `★ 两个来源都要数得出来（真实 ${realCount} / 探针 ${probeCount}）`,
  )

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
   * ── ★★★ 撤回一段旧的结论（本文件第三版修正，原文**不再成立**）─────────────────
   *
   * 这里此前写着（逐字保留，供对照）：
   *
   *   > MEASURED（本文件本轮实测）：它**没有** +1，而 `incomplete` **也没有** +1。
   *   > 两个数都不动 ⇒ 探针的闸门**没有**被核对层看见。那不是本任务的范围
   *   > （它是 `appliesTo` 那条链的事），但它**恰好**让本臂失去了自变量。
   *
   * ★★ 那段话是**错的，现予撤回**。它的两句都不成立：
   *
   *   ① 「探针的闸门**没有**被核对层看见」—— **不成立**。证据就在本文件里：
   *      **臂 0 是绿的**（`gateModuleViews()` 里探针**恰好一次**、`point` 对得上、
   *      `hasRequires: true`、`requires` 就是那一格不存在的路径）。而
   *      `gateModuleViews()` 的唯一真值就是 `registry.list()`
   *      （`src/gates/index.ts:486-521` 那段 MEASURED 写得很清楚）⇒
   *      **注册进真表的探针真的会被核对层看见**。
   *   ② 「它恰好让本臂失去了自变量」—— **也不成立**：上面那对断言
   *      （`armedSurface.checked === surface.checked + 1` 与
   *      `armedSurface.incomplete === surface.incomplete + 1`）**现在是绿的**，
   *      也就是闸门一开，核对层确实多看见了一条判据、且多了一条缺格。
   *      ⇒ 自变量**一直在**。
   *
   * ★★ 留着那句话是**有害的**，而不只是过时：下一个读者会照着它去
   *   `appliesTo` 那条链里找一个**并不存在**的缺陷 —— 而这正是本文件在别处
   *   反复记账的那种病：**一个读起来像结论的句子，把归因指错了地方。**
   *   （本臂自己就栽过两次同形的坑，见下面那两段 MEASURED；臂 1 也栽过一次。）
   *   ★ 这个文件的存在理由就是消灭"读数与事实不同形"，所以它自己不能留一句
   *     与事实不同形的话。
   *
   * ── ★★ 那么 `checked + 1` / `incomplete + 1` 这两条**现在的正确读法**是什么 ──
   *
   *   它们断言的是：**探针的 `appliesTo` 真的被核对层求值了，而且求值结果是"适用"**
   *   ——
   *     · `appliesTo` 读的是本文件那道闸门（`ARMED.has(point)`）；
   *     · 闸门开 ⇒ 探针适用 ⇒ 它进 `checked`（+1），而它声明的那一格任何 ctx 上
   *       都不存在 ⇒ 它同时进 `incomplete`（+1）与 `missing` 名单。
   *   ⇒ 也就是说，这一对断言**同时**钉住了两件事：出口读的是**这个位置**的
   *     （否则别处的判据不会跟着这一格变），以及**闸门确实参与了这个位置的求值**。
   *   ★ 一个"五处共用一份与位置无关的快照"的实现会让两个数都不动 ⇒ 当场红。
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

test('★ 臂 7：被拒的调用同样交得出结论，且两次落在不同位置时各挂各的位置名（不会被另一份顶掉）', async () => {
  /**
   * ── ★★★ 本臂此前公示的那条定向突变是**惰性的**（MEASURED，本文件第四版修正）──────
   *
   * 原写法（**已被证伪，保留在此仅作记账**）：
   *
   *     「定向突变：把 `withInputSurfaceOnError` 里那句
   *       `if (INPUT_SURFACE_PROPERTY in error) throw error` 删掉
   *       ⇒ 后到的那一份覆盖先到的 ⇒ 本臂的"是哪一份"半边红。」
   *
   * MEASURED（独立复核者对 `lib/tools/shared/entities.js` 做了**三次逐级加强**的突变，
   * 每次都用 `npx tsc -p tsconfig.json --outDir <tmp>` 重建后覆写产物；基线先经
   * `diff -r` 逐文件确认与 `cwd/lib` **逐字节相同**，否则"突变后变红"可能只是构建噪音）：
   *
   *     (a) 删掉守卫那一句（`if (Object.hasOwn(error,'input_surface'))` + 其 `throw error`）
   *     (b) `if (Object.hasOwn(error,'input_surface'))` 改成 `if (false)`（**全后到者赢**）
   *     (c) **两句**守卫一起反转（`if (false)` + `if (true)`）⇒ 完整 last-wins
   *
   *   ⇒ 三次**全部** `12 pass / 0 fail`，本臂 **GREEN**。三次突变都经
   *     `node --check` 确认产物语法有效，且突变后 `git status --short src/ lib/` 非空
   *     （即"真的改到了产物"，不是一次没落地的空突变），随后**立即还原**并确认干净。
   *
   * ── ★ 为什么它必然惰性（因果链，逐行读出来的，captain 独立复核确认）───────────
   *
   *   守卫要挡的是"同一跳里**第二份**结论覆盖第一份"。而本臂走 `create_task`：
   *
   *     · `create_task` 全篇**只有一个** `throwWithSurface` 调用点
   *       （`src/tools/create-task.ts:421`，dispatch 闸门处）——
   *       实测 `grep -n "throwWithSurface(" src/tools/create-task.ts` 只回这一行；
   *     · `rejectOnContractGates` 是 **return** 它那份面
   *       （`src/tools/shared/entities.ts:2332`），而 contract 那份面只在**成功**返回里
   *       被展开（`src/tools/create-task.ts:439`）—— 它**从不抛**；
   *     · `update_task` 的两个 `throwWithSurface`（`src/tools/update-task.ts:1190` / `:1192`）
   *       是**同一个 `if` 的两条互斥分支** —— 一次调用至多走一条；
   *     · 全仓库 7 处 `throwWithSurface`，**没有任何一条调用路径连续穿过两次**
   *       带面的抛出。
   *
   *   ⇒ 一次被拒的调用**永远只带一份**面 ⇒ 第一份赢与最后一份赢**观测上同形** ⇒
   *     本臂里没有一条断言能把两者分开。这正是本文件存在的意义所要防的那种东西：
   *     **一条恒真的、说不清被什么打红的断言**（与本文件已两次更正的
   *     「臂 6 的恒真」和「臂 3b 的 C 态」同一species）。
   *
   * ── ★ 本臂**真正**立得住的东西（下面每一条断言一个字都没动）───────────────────
   *
   *   · 被拒的调用在**工具边界**上仍交得出结论（`error.input_surface` 在场）——
   *     拒绝恰恰是最需要读到"是契约不合法、还是输入面没接全"的那一刻；
   *   · **位置名与泛用名是同一个对象**（引用相等，不是内容相等）；
   *   · 两次落在**不同位置**的拒绝，各挂**各自的**位置名，且各指**各自的**判据
   *     （`dispatch.plan-reviewed` vs `completion.backtest`）—— 一个"一份快照 + 多个
   *     名字"的实现会在这里红；
   *   · `dispatch_input_surface` 在 completion 侧的对照里**缺席**—— 一个"给所有位置名
   *     都挂一份"的实现会在这里红。
   *   ⇒ 它钉的形态仍是本队记账的第三种（**读错位置的出口**），而这一半是**活的**。
   *
   * ── ★★ 诚实交代：first-wins / last-wins 这条性质**在本臂（任何真实调用路径）上
   *   今天不可证伪**。⇒ 承载它的那条断言搬到**臂 7b**（见下），那里直接驱动导出的
   *   构造点、用**合成**的双面场景把守卫真正走一遍 —— 与臂 3c 处理「字段不出现」
   *   那条性质的做法**同构**（那条也是"真实路径造不出第三态"⇒ 改为直接调构造点）。
   *
   * ★★ 这一臂钉的形态是本队记账的第三种（**读错位置的出口**）：字段在场、读得到、
   *   数值也正常，只是它**不是读者以为的那个位置**报的。而它只在**拒绝路径**上出现
   *   —— 本队四处出口里，最需要读到结论的那一刻恰恰是最难读到的一刻。
   */
  const workspace = freshWorkspace('reject')
  seedWorktree(workspace)
  const fixture = pluginFixture(workspace)
  await seedTeam(workspace, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
  /**
   * ── ★★ t39 之后这次拒绝必须走 `create_task`（本文件第三版修正）─────────────────
   *
   * MEASURED（本文件本轮，本臂因它而红）：
   *
   *   此处此前是"越界路径的 `update_task`"（`changedPaths: ['src/out-of-scope.ts']`）——
   *   而 t39 把 dispatch 插入点的求值搬到了 `create_task`，`update_task` 现在
   *   **只穿过 `completion` 一个位置**。那次调用仍然被拒（`completion.*` 拒的），
   *   而异常上**没有** `dispatch_input_surface`（实测 own 里只有
   *   `completion_input_surface` + `input_surface`）⇒ 本臂按位置名读不到。
   *
   *   ★ 又一次"自变量选错了"：读起来像"拒绝路径交不出 dispatch 的结论"，
   *     实际是**这条路径上 dispatch 那件事压根没发生**（与臂 1、3b 同一个病）。
   *
   * ⇒ 修法：改用 `create_task`，并让**它自己的** dispatch 位置当场拒绝 ——
   *   不给 `reviewed` ⇒ `dispatch.plan-reviewed` 报 blocker ⇒
   *   `throwWithSurface(…, dispatchSurface, 'dispatch_input_surface')`
   *   （`src/tools/create-task.ts:421` —— 调用点；函数定义在
   *    `src/tools/shared/entities.ts:2417`）。
   *
   * ★ `inScope` 里必须带 `lib/`：否则 `contract.build-artifact-scope` 会在
   *   **contract** 位置先拒（落点是泛用名 `input_surface`），dispatch 那一段走不到。
   */
  const rejected = await fixture.call('agent_teams_create_task', {
    subject: 'w-dispatch-reject', kind: 'work', inScope: ['src/a.ts', 'lib/a.js'],
    /** ★ 故意**不带** `reviewed`：`dispatch.plan-reviewed` 当场报 blocker ⇒ 被拒。 */
  })
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
   * ★★ 关键的一半：**先报缺的那一份说话**（且它必须是**这个位置**的那一份）。
   *
   * ── ★ t39 之后这里说的"两个位置"是哪两个（本文件第三版修正）───────────────────
   *
   * 原文写的是"`update_task` 一次调用穿过**两个**位置（dispatch 与 completion）"。
   * ★ 那句话**不再成立**：t39 之后 `update_task` 只穿过 **completion** 一个位置，
   *   而**一次穿过 dispatch 的调用是 `create_task`** —— 它穿过的是
   *   **contract 与 dispatch** 这一对（见上面 `CALLS` 的注释）。
   *
   * ⇒ 本臂要证伪的那件事**一个字没变**：被拒的调用交出来的必须是**它自己的**
   *   那个位置的结论，而不是"顺手挂在异常上的另一份"。只是现在这个"另一份"
   *   在 `create_task` 上是 **contract**（先求值）而不是 completion。
   *
   * ★ 本臂的做法：对比"拒绝路径上读到的这一份"与**另一个位置**的结论那一份
   *   （对照半边），要求两者的**判据 id 集合不同**、且各自指名自己的判据。
   *   若拒绝路径上交出的是别的位置的结论，id 集合就会落在 `completion.*` 上 ⇒ 当场红。
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
   * ── MEASURED（同一个坑本文件第四次踩到，这里记的是第三次）──────────────────────
   *
   * ★ 归类：本处与 ①② 同形（**读错位置的出口**：我读的不是我要的那个位置），是有位置名
   *   可读的那一形态；而本轮补记的 ④ 是**另一个**形态（**工具搬了家，调用点没跟着搬**）。
   *   ⇒ 四次的完整枚举与"它们都不是产品缺陷"这条结论见文件末尾
   *     「十、verifier5 的自变量修正（本文件**四次**踩同一个坑）」。
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
   * ⇒ 对照改成**两个位置名之别**：两次都真的被拒，只是落点不同，
   *   于是"各挂各的位置名"成为一次**正面对照**，而不是一次缺席。
   *
   * ── ★★ 第四版修正（本文件本轮）：对照**不能再**用 `drive(ws, 'dispatch')` ────────
   *
   * MEASURED（本文件本轮，本臂因它而红）：
   *
   *   `drive(ws, 'dispatch')` 现在走的是 `create_task` **带** `reviewed` 的那条路
   *   （见上面 `CALLS.dispatch` 的注释：本文件测的是**出口形状**，不是"没审会被拦"）。
   *   ⇒ 它**成功**了 ⇒ `control.result.ok === false` 这条前置当场红。
   *
   *   ★ 而它红得**对**：那条调用在 completion 位置上根本没有拒绝这回事
   *     —— 它压根不经过 completion（`create_task` 只穿过 contract 与 dispatch）。
   *
   * ⇒ 对照改用**真正会落在 `completion` 位置的那条调用**：`update_task` 把任务推到
   *   `in_progress`。实测它被 `completion.backtest` 拒（"the baseline state is
   *   unavailable…"）⇒ 异常上是 `completion_input_surface` + 泛用名 `input_surface`，
   *   而 dispatch 那一段**不经过**（t39 之后 `update_task` 只穿过 completion 一个位置）
   *   ⇒ `dispatch_input_surface` **必然不出现**。
   *
   * ★★ 于是本对照**仍然证明它原来声称的那件事**：
   *   · 两次拒绝**指名不同的位置**（`dispatch_input_surface` / `completion_input_surface`）；
   *   · 两份结论**来自不同的判据**（`dispatch.plan-reviewed` / `completion.backtest`）；
   *   · `dispatch_input_surface` 在对照里**缺席**，而 `completion_input_surface` **在场**
   *     —— 也就是"给所有位置名都挂一份"的实现会在这里红。
   *
   * ★ 而"恰好这一次"的性质说明白：对照那一次**确实**经过了 completion 并**真的**
   *   在那里被拒（不是"没经过"）—— 否则"dispatch 缺席"就只是"什么都没发生"，
   *   而那条断言会变成恒真。
   */
  const okWorkspace = freshWorkspace('reject-control')
  seedWorktree(okWorkspace)
  const controlFixture = pluginFixture(okWorkspace)
  await seedTeam(okWorkspace, { tasks: [IMPL_TASK], members: [RUNNING_MEMBER] })
  const controlRejected = await controlFixture.call('agent_teams_update_task', {
    task_id: 't1', status: 'in_progress', output: 'x', attempt_id: 'a1', changedPaths: ['src/a.ts'],
  }, 'member-1')
  const control = { result: controlRejected }
  assert.equal(
    control.result.ok, false,
    '★ 对照半边的前置：`update_task` 推到 `in_progress` 这一次确实会被拒（落在 **completion** 位置）'
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
   * ★★ 两次拒绝**各挂各的位置名**，而且**内容确实不同**（各指各的判据）。
   *
   * ★ 这是"两个名字"这件事的**反面**证据：如果实现只是把**同一份**结论挂到所有
   *   位置名上（一份快照 + 多个名字），这两条读数就会相同 —— 而它们**必须不同**。
   */
  assert.notDeepEqual(
    idsOf(surface), idsOf(controlSurface),
    '★ 两次拒绝落在**不同位置** ⇒ 两份结论必须指**不同**的判据'
    + '（dispatch.plan-reviewed vs completion.backtest）。'
    + ' 相同 ⇒ 出口交的是"一份与位置无关的快照"，那正是第四种恒真写法',
  )
  assert.deepEqual(
    idsOf(surface), ['dispatch.plan-reviewed'],
    `★ 不带 \`reviewed\` 那一次缺的是 dispatch 位置的那条（实测 ${JSON.stringify(idsOf(surface))}）`,
  )
  assert.deepEqual(
    idsOf(controlSurface), ['completion.backtest'],
    `★ 推到 in_progress 那一次缺的是 completion 位置的那条（实测 ${JSON.stringify(idsOf(controlSurface))}）`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7b：first-wins —— 直接驱动导出的构造点，用**合成**双面场景把守卫走一遍
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7b：`withInputSurfaceOnError` 的 first-wins 守卫**真的**挡得住后到的那一份（合成双面场景）', async () => {
  /**
   * ── ★★★ 这一臂是**补上的**，理由是臂 7 公示的那条突变被实测为惰性（MEASURED）────
   *
   * 详见臂 7 顶部那段更正：`create_task` 全篇只有一个 `throwWithSurface` 调用点，
   * 且全仓库**没有一条**调用路径连续穿过两次带面的抛出 ⇒ 真实调用上，
   * "第一份赢"与"最后一份赢"**观测上同形** ⇒ 那条性质**在任何真实入口上不可证伪**。
   *
   * ★ 一条不可证伪的性质**不该**继续挂在一条真实入口的臂上冒充"有突变"——
   *   那正是本文件要防的恒真形态。⇒ 承载它的断言搬到这里。
   *
   * ── ★★ 为什么本臂**必须**是 unit-level（直接调构造点），而不是一次真实工具调用 ──
   *
   *   与臂 3c 对「字段不出现」那条性质的处理**同一个理由、同一个做法**：
   *   真实世界造不出那个状态（那里是"五个位置都有判据"⇒ 造不出 C 态；
   *   这里是"没有一条路径连续两次带面抛出"⇒ 造不出双面场景）⇒
   *   **诚实的做法是直接驱动那个唯一的构造点**，并**明说**这是单元级的读法，
   *   而不是拿一条真实调用冒充"端到端地验过了 first-wins"。
   *
   * ★ 本臂读的是 `lib/tools/shared/entities.js` 导出的 `withInputSurfaceOnError`
   *   本身（与臂 3c 读同名的那个产物文件是同一条 import 路子），
   *   所以它测的**就是**四处出口共用的那一份实现，不是一份仿制品。
   * ★ 它**不**碰 `src/`、**不**碰其它文件、**不**重组任何真实工具 —— 纯粹的
   *   "把守卫那一句单独拎出来走一遍"。
   *
   * ── ★★ 场景怎么造（合成，但用的是**真的**那个函数）─────────────────────────────
   *
   *   一次调用里"同一跳来了两份结论"的最小形状：
   *
   *     · 异常上**已经**落了先到的那一份 —— 落在**泛用名** `input_surface` 上
   *       （这正是"第一个拒绝的边界已经搬过"的形态）；
   *     · 同一异常上**又**带着后到的那一份 —— 在内部携带属性
   *       `agentTeamsInputSurface`（`INPUT_SURFACE_PROPERTY`）上，并指明它属于
   *       另一个位置名（`agentTeamsInputSurfaceField`）。
   *
   *   ⇒ 把它交给**真的** `withInputSurfaceOnError` 包一层：
   *     · 守卫在 ⇒ 当场 `throw error` ⇒ **泛用名仍是先到的那一份**，位置名**不写**；
   *     · 守卫去（`if (false)` / 完整 last-wins）⇒ 后到的那一份**顶上** ⇒ 两条断言都红。
   *
   * ── ★ 定向突变（本臂**实测过**的两条，见下方断言处的措辞）─────────────────────
   *
   *   (b) `if (Object.hasOwn(error,'input_surface'))` → `if (false)`：
   *       ⇒ 位置名那一条**多出来** ⇒ 本臂红（实测 1 fail）。
   *   (c) 两句守卫一起反转（完整 last-wins）：
   *       ⇒ 泛用名从"先到的"翻成"后到的" ⇒ 本臂红（实测 1 fail）。
   *   ★ 守卫完整时：`12 pass`（本臂绿）—— 两个方向都量过。
   */
  const entityModule = await import(pathToFileURL(join(ROOT, 'lib', 'tools', 'shared', 'entities.js')).href)
  const { withInputSurfaceOnError, INPUT_SURFACE_PROPERTY, INPUT_SURFACE_FIELD_PROPERTY } = entityModule

  /**
   * ★ 前置：这三个出口必须在产物里真的存在 —— 否则下面测的是一个不存在的机制
   *   （与臂 9 的"缺 marker"同一个纪律）。
   */
  assert.equal(
    typeof withInputSurfaceOnError, 'function',
    '★ 前置：`lib/tools/shared/entities.js` 必须导出 `withInputSurfaceOnError`（四处出口共用它）',
  )
  for (const [name, value] of [
    ['INPUT_SURFACE_PROPERTY', INPUT_SURFACE_PROPERTY],
    ['INPUT_SURFACE_FIELD_PROPERTY', INPUT_SURFACE_FIELD_PROPERTY],
  ]) {
    assert.equal(typeof value, 'string', `★ 前置：产物必须导出 \`${name}\`（否则下面的合成场景挂不到正确的键上）`)
  }

  /** 先到的那一份（第一个边界的结论）—— 落在**泛用名**上。 */
  const firstSurface = {
    checked: 1, incomplete: 1, skipped: 0,
    missing: ['[dispatch.plan-reviewed] declares 1 ctx path(s) that this context does not carry: task.reviewed'],
  }
  /** 后到的那一份（第二个边界的结论）—— 带着**另一个**位置名。 */
  const laterSurface = {
    checked: 9, incomplete: 9, skipped: 9,
    missing: ['[completion.backtest] the baseline state is unavailable'],
  }

  const composed = new Error('synthetic: one hop, two surface-carrying conclusions')
  /** ★ 后到的那一份落在**内部携带属性**上，并声明它属于 completion 位置名。 */
  composed[INPUT_SURFACE_PROPERTY] = laterSurface
  composed[INPUT_SURFACE_FIELD_PROPERTY] = 'completion_input_surface'
  /** ★ 先到的那一份**已经搬好**了 —— 这正是守卫要保护的那个"已经落地的落点"。 */
  composed.input_surface = firstSurface

  const boundary = withInputSurfaceOnError({ execute: async () => { throw composed } })
  let caught
  try {
    await boundary.execute()
    assert.fail('★ 前置：合成场景必须真的把异常抛出来（否则本臂测的是一条不抛的路）')
  } catch (error) {
    caught = error
  }

  /**
   * ★★ 决定性的一半：**先到的那一份说话** —— 后到的不许把它顶掉。
   *
   * ★ 用**引用相等**断言（不是内容相等）：`input_surface` 必须是**同一个对象**
   *   `firstSurface`。一个 last-wins 的实现会在这里读到 `laterSurface` ⇒ 当场红。
   */
  assert.equal(
    caught.input_surface, firstSurface,
    '★★ first-wins：先到的那一份必须**赢**且**不被覆盖** —— 后到的那一份（completion 那个位置的结论）'
    + ' 不许顶掉它。★ 这就是臂 7 想公示却打不红的那条性质：一个 last-wins 的实现'
    + ` （守卫改成 \`if (false)\`，或两句守卫一起反转）会在这里读到后到的那一份。实测读到的 missing：${JSON.stringify(caught.input_surface?.missing)}`,
  )
  assert.notEqual(
    caught.input_surface, laterSurface,
    '★★ 反向半边：`input_surface` **不能**是后到的那一份 —— 与上一条是同一件事的两面，'
    + ' 分开写是为了让"是哪一份"这条读数在失败信息里**指名道姓**',
  )

  /**
   * ★★ 守卫的第二个可观测后果：它**提前 `throw`**，于是这一跳的位置名**根本没被写**。
   *
   * ★ 这一条是"守卫真的执行了"的独立读数：一个 `if (false)` 的实现会继续往下走并写下
   *   `completion_input_surface`（实测：该键**多出来**）⇒ 当场红。
   */
  assert.equal(
    Object.hasOwn(caught, 'completion_input_surface'), false,
    '★★ 守卫在 ⇒ 这一跳**提前 throw** ⇒ 位置名 `completion_input_surface` **不许被写**。'
    + ' ★ 一个 `if (false)`（或完整 last-wins）的实现会继续往下走并写下它 ⇒ 这条当场红。'
    + ` 实测 own = ${JSON.stringify(Object.getOwnPropertyNames(caught))}`,
  )

  /**
   * ★ 位置名与泛用名**仍是同一个对象**——在**守卫这条路上**也成立。
   *
   * ★ 用一个"守卫放行"的平行场景来读这一条：此时**没有**已落地的泛用名，
   *   于是这一跳真的搬一次，两个名字必须指向同一个引用。
   *   ⇒ 它同时打红"两个名字各自算一遍"（两份真相）那种坏法。
   */
  const fresh = new Error('synthetic: the first boundary on this hop')
  fresh[INPUT_SURFACE_PROPERTY] = firstSurface
  fresh[INPUT_SURFACE_FIELD_PROPERTY] = 'dispatch_input_surface'
  const singleBoundary = withInputSurfaceOnError({ execute: async () => { throw fresh } })
  let moved
  try {
    await singleBoundary.execute()
    assert.fail('★ 前置：平行场景必须真的抛出来')
  } catch (error) {
    moved = error
  }
  assert.equal(
    moved.dispatch_input_surface, moved.input_surface,
    '★ 位置名与泛用名必须指向**同一个对象**（引用相等，不是内容相等）—— 一次搬运、两个名字，'
    + ' 中间不许有任何一次"重新算一遍"',
  )
  assert.equal(
    moved.dispatch_input_surface, firstSurface,
    '★ 而且这个引用必须就是抛出方携带的那一份对象本身（不是一份拷贝、不是一次重算）',
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
// 十、verifier5 的自变量修正（本文件**四次**踩同一个坑，全部记在这里）─────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
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
 * ── **四次**都是同一种形态，值得列在一起 ────────────────────────────────────────
 *
 *   ① 换 `task.kind` 想动 contract 的输入面 —— 那两条判据的 `appliesTo` 只读 `ctx.task`
 *      ⇒ 读数不变 ⇒ 会误判成"产品恒真"
 *   ② 用**同一个调用**想读两个位置的拒绝 —— 只有后拒绝的那个有结论
 *      ⇒ 会误判成"出口交出了别的位置的结论"
 *   ③ 对照半边用了 `['src/a.ts']`（在 **completion** 位置才被拒）当"dispatch 没被拒"
 *      的对照 —— **那个对照根本不存在** ⇒ `dispatch_input_surface` 必然缺席，
 *      而"不是我读错了出口，是**我这个对照取材取错了**" （详见臂 7 的注释）
 *   ④ ★★（本文件本轮补记，**第四次**同一个坑）t39 把 dispatch 插入点的求值从
 *      `update_task` 搬到了 `create_task` ⇒ 而我给的两条 dispatch 调用
 *      （臂 1 的"拒绝"、臂 3b 的"没有 changedPaths"、臂 7 的"拒绝"）**都还挂在
 *      `update_task` 上** ⇒ 那个位置**根本不经过** ⇒ 读到 `undefined`
 *      ⇒ 又一次"读起来像产品没交出来"。
 *      ★ 它与 ②③ 是**同一个病换个位置**：**工具搬了家，而我的调用点没跟着搬。**
 *      ★ 修法记在各臂里：dispatch 一律走 `create_task`（真正的派发那一刻）。
 *
 * ⇒ 四次都**不是**"读错位置的出口"这条**产品**缺陷，而是**同一个**形态落在**夹具**里：
 *   **拿一个不是那个位置的东西（或一条不经过那个位置的调用），去断言那个位置的性质。**
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
 *     （实测 `dispatch.plan-reviewed` vs `completion.backtest`）——
 *     它同时打红"一份快照 + 多个名字"与"两个名字分叉"两种坏法。
 *
 *   ★★ 而上面 ② 那句"先到的那一份说话"（`if (!Object.hasOwn(error,'input_surface'))`）
 *     这条**语义本身**，在真实调用路径上**不可证伪**（任何一次被拒的调用只带一份面）
 *     —— 见臂 7 顶部那段更正。它现在由**臂 7b** 用**合成**双面场景直接驱动构造点来承载：
 *     守卫在 ⇒ 先到的赢；守卫去（`if (false)` 或完整 last-wins）⇒ **臂 7b 红**（实测）。
 *     ★ 与臂 7 那两条"不同位置 ⇒ 不同判据"的断言**互补**：那两条管"两个名字有没有分叉"，
 *       臂 7b 管"同一跳上后到的那一份会不会顶掉先到的"。
 */
