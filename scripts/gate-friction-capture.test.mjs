/**
 * ── 卡点台账：在【发生时】记，且记录必须【能重放】（t22 / f-0014）──────────────────
 *
 * 契约见 `.agent-teams/frictions/README.md`。本文件钉的不是某条判据的语义，
 * 而是**台账机制本身**：卡点发生时落下的那条记录，能不能支撑"再发生一次"。
 *
 * ── 它防的是什么失效（MEASURED，本轮试跑）──────────────────────────────────────
 *
 * 第一轮台账记了 12 条卡点，**12/12 条 `replayable: false`** —— 三样全是空的：
 *
 *     · `scene.ctx`               全 null ⇒ 重建不出当时的输入
 *     · `context.eventRefs`       指不到事件 ⇒ 原始观测存在但不可定位
 *     · `observed.mechanismState` 全 null ⇒ 拿不到判据当时的完整输出
 *
 * f-0014 的结论：「记录必须在【卡点发生时】做，**事后补是补不上的**」——
 * 事后拿得到的只有任务 output（已经过一轮解释）与 git 历史（只有文件的 revision）。
 *
 * ── ★★ 第一臂是"隔离臂"，而它是被实测逼出来的 ───────────────────────────────────
 *
 * MEASURED（2026-07-22 实测）：本夹具第一版复用了一个**进程级单值** stateRoot
 * （`cwd + stateDir`）⇒ 夹具与成员各自临时工作区里发生的卡点，**全部被写进了
 * 主树那份团队真台账**。一次夹具跑动就往真台账里塞 6 条假卡点，而它们在读取端
 * 与真卡点**同形**（只有 `scene.team` 是占位名才勉强看得出）。
 *
 * ★ 形态与 f-0022 同源：「夹具造出的东西与产品造出的东西在返回值上同形」——
 *   只不过这里是**写进同一个文件**。而台账是"记录"，被污染之后**不可重算**
 *   （README 第一条纪律：原始现象丢了就完了）。
 * ⇒ 所以本文件第一条臂就钉"写到哪儿"，而不是最后一条。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★★★ 2026-10-10 重做：卡点的【触发输入】是陈旧的那一半，被修掉的是它 ───────────────
 *
 * 本夹具此前用一个 `kind: 'repair'` + `verify: ['true']` + `inScope: ['a.ts']` 的任务
 * 去 `update_task`，指望它被拒。**那条路现在根本不会被拒** ⇒ 四条臂一起红，
 * 而红的成因不是"台账坏了"，是"这一轮压根没有卡点发生"（`frictions/` 从未创建）。
 *
 * MEASURED（本轮逐条复现，命令见下），旧的触发输入失效的确切原因是两条**并列**的：
 *
 *   ① `update_task` 的完成位在 `src/tools/update-task.ts:1123` 这样判"没检查"：
 *
 *          const completionNotChecked = completionGates.ok === false
 *            && (completionGates.skippedAll !== undefined || completionGates.unmeasured !== undefined)
 *
 *      ★ 它**一眼都不看 `blockers`**：只要**任何一条**判据报了 `unmeasured`，
 *        哪怕同时有一条判据真的 `blocked`，整段也被读成"没检查" ⇒ 警告 + 放行。
 *      （`frictions/` 只在那段**真的拒绝**的分支里落盘，所以一条都不落。）
 *
 *   ② 而夹具原本的构造里，`completion.mutation` **必然** `unmeasured`：
 *      它的杀手套件执行器把 `node --test <suite>` 交给 `/bin/sh`，而在
 *      `node --test` 里再跑 `node --test` 会被 Node **静默跳过**：
 *
 *          Warning: node:test run() is being called recursively within a test file.
 *                   skipping running files.
 *          stdout = ""            （没有汇总行）
 *          exit code = 0
 *
 *      ⇒ `parseTestSummary("")` = `{ total: null }`（本文件下面有一条断言把这一步
 *        单独钉住）⇒ 判据落 `unmeasured("the killer suite did not report a readable
 *        summary …")` ⇒ 回到 ①，整段被放行。
 *
 * ★★ 于是修法有两个层次，**缺一不可**，而它们修的是不同的一半：
 *
 *   · 触发输入那一半（**本文件的职责**）：让卡点**真的发生** —— 一个真正 `blocked`
 *     的完成裁决（臂 1/2/4）与一个真正 `blocked` 的契约裁决（臂 3）。
 *   · 环境那一半（本文件同样必须做）：把**继承来的递归标记**清掉
 *     （`NODE_TEST_CONTEXT` 及其同族）—— 唯一出处见 `scripts/fixtures/nested-test-env.mjs`。
 *     ★ 这是上面 ② 的成因：那个变量是 `node --test` 给**子进程**打的标记，
 *       子进程一看见它就判"这是递归"并跳过。`runVerifyCommand` 用
 *       `env: process.env` 起 shell（`src/tools/shared/entities.ts:285`）⇒
 *       标记**原样继承**给杀手套件。
 *     ★ 清掉之后，套件**真的跑**，判据拿到真汇总，`mutation` 就**真的**能
 *       `blocked`。MEASURED（下一条注释里逐字给出读数）。
 *
 * ★ 而"清掉环境变量让判据能测"**不是**把判据改松：判据一个字没动，改的是
 *   **给它的探针能不能跑起来**。判据仍然自己决定杀没杀掉。
 *
 * ★ 本文件【不碰 `src/`，也不碰 `lib/`】(任务书硬约束)。下面 ①② 是**读数**，
 *   不是待修的缺陷；它们该被报告，不该被这里改掉。
 *
 * ── 两条臂各自的触发为什么是**真的拒绝**（而不是"看起来像拒绝"）──────────────
 *
 *   臂 1/2/4 —— `completion.mutation` 的 `blocked(...)`：
 *     出处在 `src/gates/completion/mutation.ts:506-516`：
 *         if (report.mutationScore !== null && report.mutationScore < threshold) {
 *           return blocked([ 'the delivered tests are decorative …', …survivors, scope ])
 *         }
 *     它要求 `report.disposition === 'measured'` —— 而这就意味着**基线绿、变异体
 *     真的跑过、分数算得出来**。要让变异体存活而基线仍绿，那份杀手套件必须是
 *     **绿但装饰性**的：它在改动行上不断言任何东西 ⇒ 变异体全活着 ⇒ 分数 0 < 0.6。
 *
 *   臂 3 —— `contract.verify-command` 的 `blocked(...)`：
 *     出处在 `src/gates/contract/verify-command.ts:646-647`：
 *         return blocked(problems.map((p) => `[${p.kind}] ${p.message}`))
 *     它要求 `verifyCommandProblems(...)` 非空。这里用的是**整行匹配去比一条命令
 *     的输出**那条规则（`processSubstitutionProblem`，:504 的 `kind: 'non-judgeable'`）。
 *     ★ 这一条在 `create_task` 上落盘（`rejectOnContractGates` 里 `recordFriction`
 *       + `throwWithSurface`），所以臂 3 的台账由**契约位**产生。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { registerAgentTeamsTools } from '../lib/tools.js'
import { createTeamDir } from '../lib/state.js'
/**
 * ★★★ 让杀手套件**真的能跑起来**（见文件头 ②）──────────────────────────────────
 *
 * `node --test` 给子进程打 `NODE_TEST_CONTEXT`；子进程一看见它就跳过整个文件。
 * `runVerifyCommand` 继承 `process.env` ⇒ 不清掉的话，判据拿到的永远是
 * "空输出 + exit 0"，于是它**必然** `unmeasured`，本文件四条臂就永远没有卡点。
 *
 * ★ 这里**不再**自己清那一格 —— 那是 `scripts/fixtures/nested-test-env.mjs` 的职责，
 *   本文件此前那份 `withoutRecursionSkip()` 是它的 7 份重复实现之一。
 *   ★ 共享件仍然是**探针的启动条件**、不是判据的输入；它返回配对的还原函数，
 *     本文件每处都放在 `finally` 里 —— 一个夹具不该把"让子进程跳过测试"这个
 *     副作用**泄漏给同一进程里的其它夹具**（那条纪律原样保留，只是实现搬了家）。
 *
 * ★ 迁移前本文件只删 `NODE_TEST_CONTEXT` 一个键；共享件按同族处理（含 `NODE_OPTIONS`），
 *   与迁移前 `gate-mutation` / `gate-t1` / `worktree-reclaim` 已经在删的集合一致。
 */
import { nestedTestEnv, recursionFreeEnv } from './fixtures/nested-test-env.mjs'

/** 一次 git 调用的统一包装（夹具的临时工作区）。 */
function gitIn(workspace) {
  return (args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * ── 夹具工作区（臂 1/2/4 用）：一个**真的能测变异**的仓库 ─────────────────────────
 *
 * 要让 `completion.mutation` 走到 `blocked`，三样缺一不可，而它们各自有出处：
 *
 *   ① **改动行范围**：`mutation.gate()` 拿不到 `changedLines` 就直接 `unmeasured`
 *      （`mutation.ts:276`）。它由调用方从 `changedLineNumbers(workspace, baseRevision)`
 *      算出来 ⇒ 工作区必须**真的脏**，且任务记录必须带 `baseRevision`。
 *   ② **杀手套件**：`killerSuites` 空 ⇒ `unmeasured`（`mutation.ts:288`）。
 *      夹具里它由 `repairCompletionVerdict → repairEvidenceFiles` 从**任务契约**
 *      （`inScope` + `changedPaths` 里那些**测试夹具**路径）推出来 ——
 *      这条链**不依赖会话事件**，所以它在 `withSession` 两值下都成立。
 *      ★ 这也是为什么测试夹具必须放在一个**带目录**的路径上（`scripts/…`）：
 *        `deriveScanDirs` 对没有 `/` 的路径返回 `undefined`，而 r5 会因此报
 *        `unmeasured`（"no scan directories were declared"）⇒ 又回到 ① 的放行。
 *   ③ **基线绿**：套件在改动前就是红的 ⇒ 判据报 `unmeasured`
 *      （"the killer suite is not green before mutation"，`mutation.ts:337`）。
 *
 * ★ 而套件必须是**装饰性**的：它绿，但在被变异的那些行上不断言任何东西
 *   ⇒ 变异体一条都杀不掉 ⇒ 分数 0 < 0.6 ⇒ `blocked`。
 */
function fixture({ withSession = true } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'friction-'))
  const git = gitIn(workspace)
  git(['init', '-q', '.'])
  mkdirSync(join(workspace, 'scripts'), { recursive: true })

  /**
   * 初始提交：`a.ts` 与那份**装饰性**套件。
   * ★ 套件 `import` 了 `a.ts` —— 这满足判据的"探针够得到被变异文件"要求
   *   （`probeReach` 读套件正文找被变异文件的 basename）。够不到 ⇒ `unmeasured`，
   *   而不是"全存活"（`mutation.ts` 文件头那条硬规则）。
   */
  writeFileSync(join(workspace, 'a.ts'), 'export function f(x) {\n  if (x > 0) return 1\n  return 0\n}\n')
  writeFileSync(
    join(workspace, 'scripts', 'suite.test.mjs'),
    "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { f } from '../a.ts'\ntest('t', () => { assert.equal(1, 1) })\n",
  )
  git(['add', '-A'])
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  /** ★ `baseRevision` 必须是**真的 git 对象名** —— 读出来，不臆造。 */
  const baseRevision = git(['rev-parse', 'HEAD']).trim()

  /**
   * ★ 而那一次"真的改动了"必须发生（不然 `changedLines` 为空 ⇒ ① 的 unmeasured）：
   *   `if (x > 0)` ⇒ `if (x >= 0)`。于是 git 给出改动行，且**范围里真的有一个变异体**
   *   （`ge-to-gt@L2`）。
   */
  writeFileSync(join(workspace, 'a.ts'), 'export function f(x) {\n  if (x >= 0) return 1\n  return 0\n}\n')

  const stateRoot = join(workspace, '.agent-teams')
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: { debug() {}, info() {}, warn(m) { warnings.push(m) }, error(m) { warnings.push(m) } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      sendMessage: async () => 'msg-0', [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    /**
     * ★ 臂 3 要在**契约位**上触发拒绝，而那条路走 `create_task` ⇒ 它需要一个
     *   可用的 `llm`（队长会话的模型路由）。缺它时 `create_task` 在到达判据之前
     *   就抛了，于是"被拒"的原因会变成别的东西。给一个最小可用的实现。
     */
    llm: { async resolveCallConfig(config) { return config }, async listModels() { return [] } },
    on() { return () => {} }, effect(setup) { return setup() }, inject() { return () => {} },
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined,
  })
  return { workspace, stateRoot, tools, warnings, baseRevision, ctx, member: (id) => memberAgent(id, workspace, withSession) }
}

/**
 * 成员会话。
 *
 * ★ `meta.diffs` 必须列出**真的被改动过**的那些路径：`dispatch.changed-paths`
 *   会拿"自报改动"与"会话观察"对账，而对不上的那一份会**先**拒绝 ——
 *   那样本文件测的就变成那条判据，而不是完工/契约位。
 */
function memberAgent(id, workspace, withSession) {
  const diffs = [
    { path: 'a.ts', oldText: 'if (x > 0) return 1', newText: 'if (x >= 0) return 1' },
    { path: 'scripts/suite.test.mjs', oldText: 'x', newText: 'y' },
  ]
  const events = withSession ? [{ type: 'tool/result', meta: { diffs } }] : []
  return {
    id, status: 'working', steer() {},
    session: { header: { cwd: workspace, id: `sess-${id}` }, events, ownEvents() { return events } },
  }
}

/** 建一个带一条未完成质量任务的团队。 */
async function seedTeam(stateRoot, taskId, overrides = {}) {
  await createTeamDir(stateRoot, {
    id: 'team', name: 'T', captainSessionId: 'cap', createdAt: 1, taskSeq: 1,
    members: [{ id: 'm1', name: 'worker', status: 'working', joinedAt: 1 }],
    tasks: [{
      id: taskId, subject: 'x', status: 'in_progress', assignee: 'worker', dependencies: [],
      attempt: 1, attemptId: 'a1', kind: 'repair', objective: 'o',
      acceptance: ['x'], createdAt: 1, updatedAt: 1,
      /**
       * ★ 契约要**同时**声明两个文件，理由见夹具头 ②：
       *   · `a.ts` 是被变异的那一个（改动行范围落在它身上）；
       *   · `scripts/suite.test.mjs` 是**杀手套件**，且必须落在 `inScope` 里
       *     ——`repairEvidenceFiles` 会把"不在写域里的夹具"筛掉。
       */
      inScope: ['a.ts', 'scripts/suite.test.mjs'],
      changedPaths: ['a.ts', 'scripts/suite.test.mjs'],
      verify: ['node --test scripts/suite.test.mjs'],
      ...overrides,
    }],
  })
}

/** 读这个夹具自己工作区里的台账（**不读主树那份**）。 */
function frictionRecords(stateRoot) {
  const dir = join(stateRoot, 'frictions')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => /^f-\d+\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
}

/**
 * ── 触发一次**真的**拒绝：走真实工具入口，断言它抛的是一条真拒绝 ────────────────────
 *
 * ★ 本文件原先叫 `rejectOnce`，而那个名字把两件事混成了一件：它**假设**调用
 *   会被拒，却从不检查。于是当判据不再拒绝时，四条臂一起红在"台账里没有记录"上
 *   —— 一个**误导的**读数（看起来像台账坏了，其实是没卡点）。
 *
 * ⇒ 现在拆成两个**说清自己触发的是哪一条**的入口，且两个都**当场核对**返回值
 *   确实是一条拒绝。名字、注释、断言三者说的是同一件事。
 */
async function rejectViaCompletionBlock(f, taskId = 't1') {
  /**
   * 臂 1/2/4 走这一条：`completion.mutation` 真的 `blocked`
   * （`src/gates/completion/mutation.ts:506`）。
   *
   * ★ 它需要 ① 递归标记被清掉（否则套件被跳 ⇒ `unmeasured`；清理由
   *   `scripts/fixtures/nested-test-env.mjs` 负责），
   *   ② 契约同时声明被变异文件与那份装饰性杀手套件（否则 `unmeasured`）。
   *   两条都是**输入面**的事，判据一字未动。
   */
  const { restore: restoreEnv } = nestedTestEnv()
  try {
    return await f.tools.get('agent_teams_update_task').execute(
      {
        task_id: taskId, attempt_id: 'a1', status: 'completed',
        changedPaths: ['a.ts', 'scripts/suite.test.mjs'],
        acceptanceResults: [{ criterion: 'c', status: 'passed' }],
        commandsRun: [{ command: 'node --test scripts/suite.test.mjs', status: 'passed', exitCode: 0 }],
      },
      { agent: f.member('m1'), signal: new AbortController().signal },
    ).then(
      () => undefined,
      (error) => String(error.message),
    )
  } finally {
    restoreEnv()
  }
}

/**
 * 臂 3 走这一条：`contract.verify-command` 真的 `blocked`
 * （`src/gates/contract/verify-command.ts:646`）—— 而它发生在 **`create_task`** 上。
 *
 * ★ 为什么臂 3 不用完工位：它刻意**没有会话事件**（它测的就是"事件读不到时会怎样"）。
 *   没有会话事件 ⇒ `observedChangedPaths` 为 `undefined` ⇒ 回测的覆盖证据拿不到
 *   ⇒ `completion.mutation` 与 `completion.backtest` 都会 `unmeasured` ⇒
 *   回到 `completionNotChecked` 的放行 ⇒ 完工位**在这条臂里不可能真的拒绝**。
 *   ★ 所以臂 3 的台账由**契约位**产生：那条路不读会话，且真的 `throwWithSurface`。
 *
 * `verify` 用的是 `grep -qx 7 <(wc -l < a.ts)`：整行匹配去比一条命令的**输出**，
 * 而那条输出的空白由生产者在运行时决定、在契约里看不见 ⇒ 静态不可判
 * （`processSubstitutionProblem`，`kind: 'non-judgeable'`）⇒ 真 `blocked`。
 * ★ 不要用 `verify: ['true']`：那条现在是 `[always-green]`，也会拒绝，
 *   但它拒绝的理由是关于"这条命令恒绿"，与本臂要测的东西无关（且它掩盖了
 *   本臂真正想钉的那条规则）。
 */
async function rejectViaContractBlock(f) {
  const captain = {
    id: 'cap', status: 'working', steer() {},
    session: {
      header: { cwd: f.workspace, id: 'sess-cap' },
      events: [],
      ownEvents() { return [] },
      requestHeader() { return { config: { provider: 'p', model: 'm' } } },
    },
  }
  const call = (name, args) => f.tools.get(name).execute(args, { agent: captain, signal: new AbortController().signal })
  await call('agent_teams_create', {
    name: 'team', description: 'friction fixture', approval: 'automatic',
  })
  await call('agent_teams_add_member', { name: 'worker', role: 'engineer' })
  return call('agent_teams_create_task', {
    subject: 'x',
    description: 'a task whose verify command cannot judge the work',
    kind: 'work',
    assignee: 'worker',
    objective: 'o',
    acceptance: ['x'],
    /**
     * ★ 不可判的那条命令 —— 见上面的长注释。
     */
    verify: ['grep -qx 7 <(wc -l < a.ts)'],
  }).then(
    () => undefined,
    (error) => String(error.message),
  )
}

/** 落盘是异步的（拒绝路径不许等它）—— 等一小会儿再读。 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 300))
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 隔离臂）：台账必须落在【这个团队自己的】目录里
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 隔离臂：卡点记进本团队自己的 stateRoot —— 不许污染别处的台账', async () => {
  /**
   * ★ 本臂的来历写在文件头：第一版用进程级单值 ⇒ 夹具的卡点写进了主树真台账。
   *   ⇒ 断言必须落在"**写到哪儿**"，而不只是"有没有写"。
   *
   * ★ 做法：这个夹具的 `stateRoot` 在临时目录里 ⇒ 只要记录出现在**那里**，
   *   就说明它没有跑到别处去。真正的台账在 `cwd/.agent-teams/frictions`
   *   —— 本臂同时断言**那个**目录没有因这次调用而改变。
   */
  const f = fixture()
  await seedTeam(f.stateRoot, 't1', { baseRevision: f.baseRevision })
  const message = await rejectViaCompletionBlock(f)

  /**
   * ★ 前置：这一次调用**真的被拒**了 —— 否则下面测的是"一次成功调用有没有写台账"
   *   （它当然不写），而那个读数会被误读成台账坏了。见文件头 ①。
   *   ★ 而"被拒"必须由**措辞**来证明，不能只证明"有 message"：
   *     放行那一条有它自己的、完全不同的话（"NOT checked … allowing it through"）。
   */
  assert.ok(message !== undefined, '★ 前置：这条调用必须真的抛出来（而不是被放行）')
  assert.match(
    message, /^update_task rejected: /,
    `★ 前置：它必须是一条**真拒绝**。实测抛出来的：${String(message).slice(0, 200)}`,
  )
  assert.match(
    message, /\[completion\.mutation\]/,
    `★ 而拒绝它的必须是完工位那条变异判据（本臂的触发就是它）。实测：${String(message).slice(0, 200)}`,
  )
  await settle()

  const mine = frictionRecords(f.stateRoot)
  assert.ok(
    mine.length > 0,
    '★ 卡点必须落进【本团队自己的】stateRoot —— 一条都没有说明记录跑了或落到了别处',
  )

  /**
   * ★ 反向半边：主树的台账**不许**因这次调用而多东西。
   *   （这条是真正防污染的：上面那条只证明"我这儿有"，它证明"别人那儿没有"。）
   */
  const mainLedger = join(process.cwd(), '.agent-teams', 'frictions')
  const mainCountBefore = existsSync(mainLedger)
    ? readdirSync(mainLedger).filter((name) => /^f-\d+\.json$/.test(name)).length
    : 0
  const secondMessage = await rejectViaCompletionBlock(f, 't1')
  assert.match(
    String(secondMessage), /^update_task rejected: /,
    '★ 反向半边的两次调用也必须是**真拒绝**（否则它测的是一次成功调用的副作用）',
  )
  await settle()
  const mainCountAfter = existsSync(mainLedger)
    ? readdirSync(mainLedger).filter((name) => /^f-\d+\.json$/.test(name)).length
    : 0
  assert.equal(
    mainCountAfter, mainCountBefore,
    '★ 一次夹具调用不得往【主树那份团队真台账】里加东西 —— 那是不可重算的记录，'
    + `污染之后与真卡点同形。实测 ${mainCountBefore} ⇒ ${mainCountAfter}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 核心臂）：三样缺一不可 —— 它们是"事后补不上"的那三样
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 记录臂：ctx 快照 / 事件定位 / 机制状态 —— 三样都在，缺一即不可重放', async () => {
  /**
   * ★ 这三样不是"最好有"，而是 f-0014 实测出来的**充要条件**：
   *   缺任何一样，那条记录就 `replayable:false`（第一轮 12/12 都是这样）。
   */
  const f = fixture()
  await seedTeam(f.stateRoot, 't1', { baseRevision: f.baseRevision })
  const message = await rejectViaCompletionBlock(f)
  assert.match(
    String(message), /^update_task rejected: /,
    `★ 前置：本臂的记录来自一条**真拒绝**。实测：${String(message).slice(0, 200)}`,
  )
  await settle()

  const [record] = frictionRecords(f.stateRoot)
  assert.ok(record !== undefined, '★ 必须先有一条记录')

  /** ① ctx 快照：判据真的读到的那一份。 */
  assert.notEqual(
    record.scene.ctx, null,
    '★ ① `scene.ctx` 不许是 null —— 第一轮的 12 条全是 null，于是**重建不出当时的输入**',
  )
  assert.equal(typeof record.scene.ctx, 'object', '★ 而它必须是结构化快照（不是一句人话）')
  /**
   * ★ 快照要**真的含判据要的那几格**，而不只是一个空对象：
   *   一个 `{}` 会让上面两条全绿，而它什么也重放不出来。
   */
  assert.ok(
    Object.keys(record.scene.ctx).length > 0,
    '★ 快照不能是空对象 —— 空的 ctx 与"没记 ctx"在重放时同形',
  )

  /** ② 事件定位：会话 id + 事件序号。 */
  assert.ok(Array.isArray(record.context.eventRefs), '★ ② `eventRefs` 必须是数组（哪怕是解释为什么没有）')
  assert.ok(record.context.eventRefs.length > 0, '★ 而它不许为空 —— 空的定位与"没有观测"同形')
  assert.match(
    String(record.context.eventRefs.join(' ')), /tool\/result/,
    '★ 定位要指到**具体的事件类别**，而不只是"某个会话"',
  )

  /** ③ 机制状态：输入面核对结论 + 判据裁决。 */
  assert.notEqual(
    record.observed.mechanismState, null,
    '★ ③ `mechanismState` 不许是 null —— 第一轮全是 null，于是拿不到判据当时的输出',
  )

  /**
   * ★ `index.replayable` 必须**由证据推出来**，不是一个写死的 true。
   *   本臂的构造里事件可读 ⇒ 它应为 true；而下面臂 3 构造不可读 ⇒ 必须为 false。
   *   （两臂合起来才证明这一格"不是装饰"。）
   */
  assert.equal(record.index.replayable, true, '★ 三样齐备 ⇒ 这条记录声明自己可重放')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 反向臂）：拿不到事件定位时，必须如实说 **不可重放**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 反向臂：事件读不到 ⇒ replayable:false 且写进 unknown（不许假装完整）', async () => {
  /**
   * ── ★ 本臂防的是"把没记到的东西写成没发生" ────────────────────────────────────
   *
   * f-0014 里那条最有价值的观察是：**`replayable` 这一格本身就起作用了** ——
   * 「它让『读得懂』与『能重放』不同形。若没有这一格，这 12 条会被读成『完整的记录』」。
   *
   * ⇒ 所以：拿不到事件定位时，记录必须**如实标 false**，并把"没拿到什么"
   *   写进 `unknown`。留空会被读取端读成"当时没有"，而那与"我没记到"是两件事。
   *
   * ── ★ 本臂的触发为什么在**契约位**（而不是像臂 1/2/4 那样在完工位）──────────────
   *
   * 本臂刻意**没有会话事件**。而没有会话事件 ⇒ 回测的覆盖证据链拿不到
   * ⇒ 完工位上的那两条判据都会 `unmeasured` ⇒ 触发文件头 ① 的"没检查就放行"
   * ⇒ **完工位在这条臂里根本不可能真的拒绝**。
   *
   * ★ 所以触发换到契约位：`create_task` 的 `contract.verify-command` 真的
   *   `blocked`（见 `rejectViaContractBlock` 的注释）—— 它不读会话，且真的抛。
   *   ★ 而"事件读不到 ⇒ replayable:false"这条性质**一位没变**：契约位的调用点
   *     本来就不带会话（所以 `eventRefs` 必然读不到），本臂要钉的正是它如实说出来。
   */
  const f = fixture({ withSession: false })
  const message = await rejectViaContractBlock(f)
  assert.match(
    String(message), /^create_task rejected: /,
    `★ 前置：本臂的记录来自一条**真拒绝**。实测：${String(message).slice(0, 200)}`,
  )
  assert.match(
    String(message), /\[contract\.verify-command\]/,
    `★ 而拒绝它的必须是契约位那条判据。实测：${String(message).slice(0, 200)}`,
  )
  await settle()

  const [record] = frictionRecords(f.stateRoot)
  assert.ok(record !== undefined, '★ 即使拿不到事件，卡点本身仍然要记下来（记不下与没卡点是两件事）')

  assert.equal(
    record.index.component, 'contract',
    '★ 前置：这条记录确实来自**契约位**（本臂的触发方式）',
  )
  assert.equal(
    record.index.replayable, false,
    '★ 拿不到事件定位 ⇒ 必须如实标 `replayable: false`；标 true 就是把「读得懂」当成「能重放」',
  )
  assert.ok(
    Array.isArray(record.unknown) && record.unknown.length > 0,
    '★ 而且"没拿到什么"必须写进 `unknown` —— 留空会被读成"当时没有"',
  )
  assert.ok(
    record.unknown.some((item) => /event|session/i.test(String(item))),
    `★ 那一条要说清缺的是【事件定位】。实测：${JSON.stringify(record.unknown)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 重放臂）：拿记录去重跑那条判据 —— 卡点必须**再发生一次**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（★ 本条是"记录 vs 日志"的分水岭）：用记录重跑，卡点必须再发生一次', async () => {
  /**
   * ── ★★ 为什么这一臂是本文件的核心 ──────────────────────────────────────────────
   *
   * 一条"写下来了"的记录与一条"**能重放**"的记录，在其它所有臂上都同形：
   * 两者都有 ctx、都有 eventRefs、都 `replayable: true`。
   * ⇒ 唯一能把它们分开的判据是：**拿这条记录去重跑，卡点再现一次**。
   *
   * ★ 做法（不引入新接口）：用记录里的 `scene.ctx` 作为输入，直接喂给那条判据的
   *   `gate()`，断言它**仍然拒绝**。这就是"卡点能再发生一次"的可执行形式。
   */
  const f = fixture()
  await seedTeam(f.stateRoot, 't1', { baseRevision: f.baseRevision })
  const message = await rejectViaCompletionBlock(f)
  assert.match(
    String(message), /^update_task rejected: /,
    `★ 前置：本臂重放的是从一条**真拒绝**里落下的记录。实测：${String(message).slice(0, 200)}`,
  )
  await settle()

  const [record] = frictionRecords(f.stateRoot)
  assert.ok(record !== undefined)
  assert.equal(
    record.index.replayable, true,
    '★ 前置：这条记录声称自己可重放 —— 否则下面测的是一个不可重放的东西',
  )

  /**
   * ── ★★★ 重放的正确形式：把那些**函数**从宿主重新注入（t79）───────────────────
   *
   * MEASURED（本任务定位）：`toReplayableSnapshot` 把每一个函数序列化成
   * `{ __absent: 'function' }` —— 而那是**忠实**的（函数进不了 JSON）。
   * ⇒ 于是重放时 `loadKindRequirements` 那个位置上是**对象**，
   *   `loadKindRequirementsOfHost` 读 `typeof !== 'function'` ⇒ kind 表不可用
   *   ⇒ `mutation.appliesTo` 返回 false ⇒ **门不说话** ⇒ 裁决落到 `verify-rerun`。
   *
   * ★ 所以重放**必须**从宿主重新注入那些函数，而不是拿 JSON 里的占位对象凑合。
   *   ★ 而注入什么、由谁决定：由**这个夹具**决定（它就是"重放宿主"）。
   *     生产里那一份由 `src/tools/update-task.ts` 注入 —— 两者**同一批名字**。
   */
  const { registry } = await import('../lib/gates/index.js')
  const { rehydrateReplayCtx } = await import('../lib/tools/shared/entities.js')
  const point = record.index.component

  /**
   * ★ 注入表：本夹具能提供的、与生产同形的实现。
   *   ★ 而**故意不提供全部** —— 下面要证明"缺一格"会被如实报出来，
   *     而不是像从前那样静默跑到另一条分支上。
   */
  /**
   * ★★★ 而 `loadKindRequirements` 必须交一份【真的表】（t79 实测的关键一格）─────
   *
   * MEASURED：我第一版给的是 `() => ({})` —— 那会被 `parseKindRequirements`
   *   判成 `malformed`（"no kinds array"）⇒ 与"没注入"**在后果上相同**：
   *   `mutation.appliesTo` 返回 false ⇒ 门沉默 ⇒ 裁决落到 `verify-rerun`。
   *
   * ⇒ ★ 于是"重新注入"这件事**必须注入一个形状正确的东西**，
   *   否则那一步是仪式性的（它跑了、而判据读到的仍然是"用不了"）。
   * ★ 而这一条正是本任务最有价值的发现：**"注入了"与"注入的东西能用"是两件事。**
   */
  const { parseKindRequirements } = await import('../lib/gates/completion/kind-requirements.js')
  const { readFileSync } = await import('node:fs')
  const kindTable = parseKindRequirements(JSON.parse(readFileSync(
    new URL('../src/gates/completion/kind-requirements.json', import.meta.url), 'utf8',
  )))
  assert.equal(kindTable.status, 'loaded', '★ 前置：那一份表必须真的读得出来（否则本臂测的是坏表）')

  const injections = {
    loadKindRequirements: () => kindTable,
    loadRules: () => ({}),
    readFile: () => undefined,
    runTest: () => undefined,
    /**
     * ★ 而 `execVerifyCommand` 也在注入表里 —— 缺它时 `verify-rerun` 会报
     *   `unmeasured` 并**成为裁决**，那同样把 `mutation` 挡住。
     *   ★ 而这不是"为了让它绿而凑齐"：生产里那一格**本来就是接上的**
     *     （`src/tools/update-task.ts` 注入 `runVerifyCommand`）——
     *     重放要复现生产，就必须也接上它。
     */
    execVerifyCommand: async () => 0,
  }
  const { ctx: replayedCtx, injected, unreplayable } = rehydrateReplayCtx(record.scene.ctx, injections)

  /** ★ 前置：至少真的重注入了一格 —— 否则本臂测的是"什么都没注入"。 */
  assert.ok(
    injected.includes('loadKindRequirements'),
    `★ 那**关键的一格**必须被重新注入（它就是分叉的根因）。实测注入的：${JSON.stringify(injected)}`,
  )
  /**
   * ★★ 而"注入不了的那几格"必须**如实列出来** —— 这一条就是本任务要的
   *   「分叉可见」（选项 ② 的价值）与「重放更真」（选项 ① 的价值）的**合取**：
   *   ① 让能注入的注入了；② 把注入不了的**说出来**，而不是让它静默。
   */
  assert.ok(
    Array.isArray(unreplayable),
    '★ 注入不了的那几格必须被列出来（它们是"重放做不到"的如实读数）',
  )

  /**
   * ★★★ 重放**必须**在"探针跑得起来"的条件下进行 ────────────────────────────────
   *
   * MEASURED（本任务复现）：`completion.mutation` 在重放时会**再跑一次**杀手套件
   * （它注入的那一格就是 `runTest`）。而在 `node --test` 里，继承来的递归标记
   * （`NODE_TEST_CONTEXT`）会让子进程那次 `node --test` 被跳过 ⇒ 套件报不出汇总
   * ⇒ 重放得到的是 `unmeasured("the killer suite did not report a readable summary")`
   *   ⇒ **重放与记录分叉**，而那个分叉是**环境的**、不是记录的。
   *
   * ⇒ 与触发侧同一条纪律：用共享件清掉那些标记，让探针真的跑。判据仍然自己判。
   */
  const { restore: restoreEnv } = nestedTestEnv()
  let replay
  try {
    replay = await registry.evaluate(point, replayedCtx)
  } finally {
    restoreEnv()
  }
  assert.equal(
    replay.ok, false,
    `★ 用（重新注入后的）记录 ctx 重跑 "${point}" 必须以**拒绝**结束（卡点再现）—— `
    + `若它是 ok，说明这份 ctx 不足以重放那个卡点，而"可重放"这句话就是假的。`
    + ` 实测：${JSON.stringify(replay).slice(0, 300)}`,
  )

  /**
   * ── ★★ 三态不同形（契约要求）─────────────────────────────────────────────────
   *
   *     `consistent`  —— 重放与记录落到**同一个判据**上
   *     `diverged`    —— 落到了别的判据上（★ 并说清**分在哪一格**）
   *     `unmeasurable`—— 重放**跑不起来**（注入不了 ⇒ 不许假装跑过）
   *
   * ★ 而这三者必须**不同形**：把 `diverged` 读成 `consistent` 就是本任务修的那个缺陷；
   *   把 `unmeasurable` 并进任何一者，就是"没测到并进通过/不通过"。
   */
  const recorded = String(record.title ?? '')
  const replayed = String(replay.unmeasured ?? replay.blockers?.join('; ') ?? '')
  const recordedGate = /\[([\w.-]+)\]/.exec(recorded)?.[1]
  const replayedGate = /\[([\w.-]+)\]/.exec(replayed)?.[1]
  assert.notEqual(recordedGate, undefined, `★ 记录里必须带有判据 id（否则无从比对）：${recorded.slice(0, 120)}`)
  assert.equal(
    recordedGate, 'completion.mutation',
    `★ 前置：本臂记录的判据 id 必须是完工位那条变异判据（触发就是它）。实测：${recordedGate}`,
  )

  assert.equal(
    replayedGate, recordedGate,
    `★ 重放必须落到**同一个判据**上。记录里是「[${recordedGate}]」，`
    + `重放得到「[${replayedGate}]」——`
    + ` 分叉说明 ctx 里有**重放兑现不了**的东西，而判据因此跑到了另一条分支上。`
    + ` ★ 而本任务已修的是：那一格现在会被【重新注入】（注入的：${JSON.stringify(injected)}），`
    + ` 注入不了的会被如实列出（${JSON.stringify(unreplayable)}）。`
    + ` 完整重放：${JSON.stringify(replay).slice(0, 300)}`,
  )

  /**
   * ── ★★★ 反向半边（“仍能抓住真分叉”）─────────────────────────────────────────
   *
   *   本臂必须**仍能**在真分叉上变红 —— 否则它只是"我把它改成绿了"。
   *   ⇒ 构造一个**故意缺注入**的重放：不给 `loadKindRequirements`
   *     ⇒ 分叉必须**再次出现**（落到 `verify-rerun` 而不是 `mutation`）。
   *
   * ★ 缺了这一半，一个"无论输入如何都返回同一个 id"的实现会让本臂恒真。
   *
   * MEASURED（本轮复核，读数逐字给出）：不给那张表 ⇒ `loadKindRequirementsOfHost`
   *   读不到 ⇒ `mutation.appliesTo` 为 **false**（门**不说话**）⇒ 那一轮里
   *   `completion.mutation` 的裁决是 **`skipped`**，于是**没有任何一条判据点名
   *   `[completion.mutation]`** ⇒ 重放文本里根本抓不到判据 id。
   *
   *       recordedGate = "completion.mutation"
   *       replayedGate = "completion.mutation"   ← 注入齐全时，同一格
   *       brokenGate   = undefined               ← 拿掉那一格后，id 消失了
   *
   *   ★ 所以本臂的"分叉"在这里的真身是：**记录点名的那条判据在重放里沉默了**。
   *     它仍然是一次**真分叉**（`undefined ≠ 'completion.mutation'`），而且这正是
   *     要抓住的形态 —— 「重放里那条判据不见了」与「它又拒了一次」在只看 `ok`
   *     时同形（两者都可能 `ok:false`），只有比对**判据 id** 才分得开。
   *   ★ 这里断言的是"**分叉**"（id 不同），不是"分到哪条" —— 把"分到 verify-rerun"
   *     写死会让本臂在下一次接线变动上误红（本轮实测它就**不是** verify-rerun）。
   */
  const broken = rehydrateReplayCtx(record.scene.ctx, { ...injections, loadKindRequirements: undefined })
  assert.ok(
    broken.unreplayable.includes('loadKindRequirements'),
    '★ 不给那一格 ⇒ 它必须出现在 `unreplayable` 里（而不是被静默忽略）',
  )
  const { restore: restoreEnv2 } = nestedTestEnv()
  let brokenReplay
  try {
    brokenReplay = await registry.evaluate(point, broken.ctx)
  } finally {
    restoreEnv2()
  }
  const brokenReplayed = String(brokenReplay.unmeasured ?? brokenReplay.blockers?.join('; ') ?? '')
  const brokenGate = /\[([\w.-]+)\]/.exec(brokenReplayed)?.[1]
  assert.notEqual(
    brokenGate, recordedGate,
    `★ ★ 反向半边：把关键那一格**拿掉**之后，重放必须**再次分叉**（否则本臂对"真分叉"没有分辨力）。`
    + ` 记录里是「[${recordedGate}]」，缺注入时得到「[${brokenGate}]」`
    + ` 完整读数：${JSON.stringify(brokenReplay).slice(0, 300)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★★★ 判别臂）："清掉递归标记"这件事**本身**是不是在起作用 —— 读真子进程
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 5（判别臂 · 对照对）：不清递归标记 ⇒ 内层套件被静默跳过（exit 0 而**没有**汇总）；清了 ⇒ 它真的跑并打印汇总', () => {
  /**
   * ── ★ 为什么这一臂必须存在，且必须落在**本文件**里 ──────────────────────────────
   *
   * 本文件上面四条臂全都**依赖**"递归标记被清掉"这个前置条件：
   * 它是让 `completion.mutation` 从 `unmeasured` 变成真 `blocked` 的那一格。
   * ★ 而那个前置条件在此之前**没有任何一条断言直接读它** —— 它藏在调用序列的
   *   环境里，跟着 `nestedTestEnv()` 一起被引用。⇒ 谁把那一行删掉，
   *   上面四条臂会**一起变红**，但红出来的措辞是关于 mutation 的，
   *   读的人要从"判据说读不到汇总"倒推回"原来是环境没清"。
   *
   * ⇒ 本臂把那个前置条件**单独拎出来做成读数**：直接读**真子进程**的
   *   exitCode / stdout / stderr，证明"清"与"不清"这两种环境下，
   *   同一个内层套件的读数**不同形**，而不是靠中间那些判据的解释。
   *
   * ── ★★ 它是一个【对照对】，两个半边缺一即恒真 ─────────────────────────────────
   *
   *   · **nested 半边**：显式把 `NODE_TEST_CONTEXT` 放回子环境 ⇒ 必须观测到
   *     ① exitCode **仍是 0**（与"通过"在退出码上同形 —— 这就是 f-0028 的要害）
   *     ② stdout **没有** `ℹ pass` / `ℹ tests` 汇总行（判据读汇总的那条路断掉）
   *     ③ stderr **有** "skipping running files" 那句 warning（它其实说了话）
   *   · **clean 半边**：用共享件 `recursionFreeEnv()` 剥掉标记 ⇒ 必须观测到
   *     ① exitCode 0 ② stdout **有**可读汇总行 ③ 套件自己打印的哨兵串在场
   *
   * ★ 没有 nested 半边 ⇒ "clean 有汇总"可能只是因为**这个套件本来就会打印**，
   *   与剥不剥标记无关；没有 clean 半边 ⇒ "nested 没汇总"可能只是套件坏了。
   *
   * ── ★★★ 方向性（directional）：删掉清洗 ⇒ 本臂**必须**变红 ──────────────────────
   *
   * 本臂的 clean 半边**不**自己手写 `delete env.NODE_TEST_CONTEXT`，而是调用
   * `recursionFreeEnv(process.env)` —— 也就是**真的走共享件**。
   * ⇒ 任何让共享件失效的改动（把 `isRecursionMarkerKey` 改成恒 false、
   *   把前缀表清空、把 `nestedTestEnv` 改成不删键）都会让 clean 半边
   *   退化成 nested 半边，于是"clean 有汇总 / clean 有哨兵串"当场红。
   * ★ 这一点已用**定向突变实验**实测过（本任务报告里逐字给出：
   *   临时把 `isRecursionMarkerKey` 改成 `return false` ⇒ 本臂红，
   *   红的正是 clean 那两条断言），而不是推断的。
   */
  const dir = mkdtempSync(join(tmpdir(), 'friction-arm5-'))
  try {
    const inner = join(dir, 'inner.test.mjs')
    /**
     * 内层套件：既**打印哨兵串**（证明它真的跑了），又让 `node --test`
     * 能打出 `ℹ pass N` 汇总（那是判据 `parseTestSummary` 读的那一行）。
     */
    writeFileSync(inner, [
      "import { test } from 'node:test'",
      "import assert from 'node:assert/strict'",
      "test('inner arm 5 that must print', () => { console.log('INNER RAN'); assert.equal(1, 1) })",
      '',
    ].join('\n'), 'utf8')

    /**
     * 子进程**在 `dir` 里**跑（`inner.test.mjs` 是相对路径），且**不抛** —— 失败形态也要读。
     *
     * ★★ 这里**不能**用 `execFileSync(..., { encoding: 'utf8' })` 的返回值当 stdout/stderr：
     *   那条路径成功时**只交回 stdout**，而本臂要读的那句 "skipping running files"
     *   恰好在 **stderr** 上、且那次运行的退出码是 0（成功）⇒ 直接读返回值
     *   会得到 `stderr: ""`，于是"它没说那句话"与"我没读那个流"同形。
     *   MEASURED（本臂第一版就撞了）：断言红在 `实测 stderr=""` 上，
     *   而子进程其实**说了**那句话 —— 是我的读法丢了它。
     * ⇒ 用 `spawnSync` 把两个流**分开**收回来。
     */
    const runInner = (env) => {
      const r = spawnSync('node', ['--test', 'inner.test.mjs'], { cwd: dir, encoding: 'utf8', env })
      return {
        code: typeof r.status === 'number' ? r.status : -1,
        stdout: String(r.stdout ?? ''),
        stderr: String(r.stderr ?? ''),
      }
    }

    /**
     * ── ★ nested 半边：**显式**把标记放回去（而不是靠继承）────────────────────────
     *
     * ★ 靠继承会让**本夹具自己**也被算作被嵌套的那一层（本仓
     *   `gate-nested-test-probe` scaffold 里那段注释记过这个坑）⇒ 读到的
     *   就不是"内层被跳过"，而是"我自己被跳过"。所以这里显式构造。
     */
    const nestedEnv = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }
    const nested = runInner(nestedEnv)
    console.log(`  [臂 5] nested 半边：exit=${nested.code} · stdout 汇总=${/ℹ\s+(pass|tests)\s+\d+/.test(nested.stdout)} · stderr=${JSON.stringify(nested.stderr.trim().slice(0, 120))}`)

    /**
     * ── ★ clean 半边：**走共享件**剥标记（这一句就是被突变瞄准的那一句）──────────
     *
     * ★ 用 `recursionFreeEnv(process.env)` 而不是就地 `delete`：本臂要证明的正是
     *   **共享件在起作用**，所以它必须是共享件的调用方，不能自己另起一份实现 ——
     *   否则删掉共享件的清洗，本臂照样绿，那条"方向性"就是假的。
     */
    const cleanEnv = recursionFreeEnv(process.env)
    const clean = runInner(cleanEnv)
    console.log(`  [臂 5] clean  半边：exit=${clean.code} · stdout 汇总=${/ℹ\s+(pass|tests)\s+\d+/.test(clean.stdout)} · stdout 哨兵=${clean.stdout.includes('INNER RAN')}`)

    /** ── ① clean 半边：套件**真的跑**，且打印出可读汇总 ───────────────────────── */
    assert.equal(clean.code, 0, `★ clean 半边：剥掉标记后必须成功退出。实测 stdout=${clean.stdout.slice(0, 300)}`)
    assert.match(
      clean.stdout, /INNER RAN/,
      '★ clean 半边：剥掉递归标记后，内层那条测试**必须真的跑**（哨兵串在场）——否则下面 nested 半边的"被跳过"没有参照物',
    )
    assert.match(
      clean.stdout, /ℹ\s+(pass|tests)\s+\d+/,
      '★★ clean 半边：必须打出 `ℹ pass N` / `ℹ tests N` 那类**可读汇总** —— 判据 parseTestSummary 读的就是这一行。'
      + ` 若它不在，说明共享件没有真的剥掉标记。实测 stdout=${JSON.stringify(clean.stdout.slice(-400))}`,
    )

    /** ── ② nested 半边：**静默跳过**，而退出码仍是 0（同形，f-0028 的要害）─────── */
    assert.doesNotMatch(
      nested.stdout, /INNER RAN/,
      '★ nested 半边：递归标记在场时，内层那条测试**一条都没跑**',
    )
    assert.doesNotMatch(
      nested.stdout, /ℹ\s+(pass|tests)\s+\d+/,
      '★★ nested 半边：**汇总行必须缺席** —— 判据读不到汇总，就会把这次运行记成 unmeasured，'
      + ` 而在退出码上它与"通过"同形。实测 stdout=${JSON.stringify(nested.stdout.slice(0, 300))}`,
    )
    assert.equal(
      nested.code, 0,
      '★★ nested 半边：被静默跳过的那次运行**退出码仍然是 0** —— 这就是"把没测到并进通过"在子进程边界上的现身',
    )
    assert.match(
      nested.stderr, /skipping running files/i,
      '★ nested 半边：stderr 上**必须**有那句 "skipping running files" —— 它是这个失效唯一说出口的话。'
      + ` 实测 stderr=${JSON.stringify(nested.stderr)}`,
    )

    /** ── ③ 对照对的**方向**：两半的读数必须不同形（否则本臂是恒真的）────────────── */
    const summaryOf = (r) => /ℹ\s+(pass|tests)\s+\d+/.test(r.stdout)
    assert.notEqual(
      summaryOf(clean), summaryOf(nested),
      '★★★ 对照对：同一个套件在两种环境下"有没有可读汇总"必须**不同形**。'
      + ` 实测 clean=${summaryOf(clean)} · nested=${summaryOf(nested)} —— 若两者相同，本臂证明不了"是标记造成的"`,
    )
    assert.equal(
      clean.code, nested.code,
      '★★★ 而**退出码这一格两者相同**（都是 0）—— 这正是本臂存在的理由：'
      + '只看退出码时，那个被跳过的运行与真正通过的那一次**完全分不开**。',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
