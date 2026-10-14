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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
/**
 * ★ 臂 9 要造一个**审过了**的计划（放行半边）—— 那份戳的形状由判据层的
 *   `REVIEW_QUESTION_IDS` 决定，本文件不自己拼一遍（拼两遍就会在"五问改名"那天分叉）。
 */
import { reviewedStamp } from './fixtures/reviewed-stamp.mjs'

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

/**
 * ─── ★★★ C1（本段是 2026-10-11 加的）：判据拒绝 ≠ 卡点 ──────────────────────────
 *
 * 用户裁定（`docs/PENDING-FRICTION-REFORM.md` §0，逐字）：
 *   「卡点就是让任务停下来的地方」「如果不阻塞任务，其实不算卡点」。
 *
 * 实测动机（同文件 §1）：253 条卡点里 **207 条（82%）是判据拒绝日志**
 * （标题形如 `update_task rejected: …`），而真正让任务停下来的只有 **21 条**。
 * ⇒ 记的是【事件：判据报错了】，而用户的定义是【状态：任务卡住了】。
 *
 * ── 机械判据（本段四条臂瞄准的东西）────────────────────────────────────────────
 *
 * **同一条判据把同一个任务拒 ≥2 次 ⇒ 任务停住了。**
 *   1 次 = 正常的"填错了改一下"（那 207 条正是这一类）；
 *   2 次 = 它在同一个地方卡住了。
 *
 * ── ★★ 为什么这四条臂必须落在本文件（而不是一个只读记录形状的臂）──────────────
 *
 * 一个"记录里有 `class` 字段"的臂**测不出**这个改动：
 *   把两类合并回一条（`class` 恒为 `'rejection'`、`blocking` 恒 false）之后，
 *   那个臂照样绿 —— 因为形状还在，只是**结论全错**。
 * ⇒ 必须有一条臂喂【该产生卡点】的输入（真的停两次）与一条【该不产生】的
 *   （拒一次就走）。这正是 `PENDING-FRICTION-REFORM.md` §6 经验 B：
 *   「正向臂只喂『该被拒』的输入，所以它测不出『一律拒绝』」。
 */

/**
 * ── 读一个任务的 `stall` 读数（C1 的判据落在这一格上）──────────────────────────
 *
 * ★ 读的是**盘上那份 `team.json`**，不是工具返回值 —— 判据必须是**落盘的**，
 *   否则它在"下一次调用"里就不存在了（而那正是本判据赖以成立的东西）。
 */
function stallOf(stateRoot, taskId) {
  /**
   * ★ 路径是 `stateRoot/<teamId>/team.json`（见 `src/state.ts` 的 `createTeamDir`）——
   *   本夹具的团队 id 恒为 `team`。
   */
  const team = JSON.parse(readFileSync(join(stateRoot, 'team', 'team.json'), 'utf8'))
  const task = (team.tasks ?? []).find((candidate) => candidate.id === taskId)
  return task?.stall
}

/** 走**真工具**做一次完工上报（返回错误原文，或被放行时返回 undefined）。 */
async function reportCompletion(f, taskId, attemptId, overrides = {}) {
  const { restore } = nestedTestEnv()
  try {
    return await f.tools.get('agent_teams_update_task').execute(
      {
        task_id: taskId, attempt_id: attemptId, status: 'completed',
        changedPaths: ['a.ts', 'scripts/suite.test.mjs'],
        acceptanceResults: [{ criterion: 'c', status: 'passed' }],
        commandsRun: [{ command: 'node --test scripts/suite.test.mjs', status: 'passed', exitCode: 0 }],
        ...overrides,
      },
      { agent: f.member('m1'), signal: new AbortController().signal },
    ).then(
      () => undefined,
      (error) => String(error.message),
    )
  } finally {
    restore()
  }
}

/**
 * ── 第 1 次拒绝：★ 这一次之后任务**还会往下走**（成员只是填错了一个字段）────────
 *
 * 用的仍是**真的** `completion.mutation` 拒绝（见 `rejectViaCompletionBlock`），
 * 所以"拒"这件事本身没有变松 —— 变的是**它算不算卡点**。
 */
const rejectOnce = rejectViaCompletionBlock

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★★ 核心臂 · 正向半边）：一次「拒绝后成员改字段再报」⇒ **不产生卡点**
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6（C1 正向半边）：「拒绝一次，成员改了字段再报」⇒ 台账里【不产生卡点】', async () => {
  /**
   * ── ★★ 本臂喂的是【该被放行（不记卡点）】的输入 ─────────────────────────────────
   *
   * 见本段头：只喂"该记卡点"的输入的臂**测不出**"一律记卡点"，而"一律记卡点"
   * 正是改动前的实际行为（207 条判据拒绝全被记成卡点）。
   */
  const f = fixture()
  await seedTeam(f.stateRoot, 't1', { baseRevision: f.baseRevision })

  /** ① 第一次上报：真的被拒（前置 —— 否则本臂测的是"一次成功调用有没有写台账"）。 */
  const first = await rejectOnce(f, 't1')
  assert.match(
    String(first), /^update_task rejected: /,
    `★ 前置：第一次必须真的被拒。实测：${String(first).slice(0, 200)}`,
  )
  assert.match(
    String(first), /\[completion\.mutation\]/,
    `★ 而拒绝它的必须是完工位那条变异判据。实测：${String(first).slice(0, 200)}`,
  )

  /**
   * ★ 判据层：这一次之后，任务**还在自己解**（`trying`），不是 `stalled`。
   */
  const afterFirst = stallOf(f.stateRoot, 't1')
  assert.equal(
    afterFirst?.state, 'trying',
    `★ 一次拒绝 ⇒ 任务还在自己解（\`trying\`）—— 它**不是**卡点。实测：${JSON.stringify(afterFirst)}`,
  )
  assert.equal(
    afterFirst?.count, 1,
    `★ 而这一次是第 1 次。实测：${JSON.stringify(afterFirst)}`,
  )
  await settle()

  /** ② 台账里那一条必须是 `rejection`，而**不是** `blocker`。 */
  const records = frictionRecords(f.stateRoot)
  assert.equal(records.length, 1, `★ 一次拒绝 ⇒ 恰好一条记录。实测 ${records.length} 条`)
  assert.equal(
    records[0].class, 'rejection',
    `★★ 判据拒绝记的是【事件】—— \`class\` 必须是 \`rejection\`。实测：${JSON.stringify(records[0].class)}`,
  )
  assert.equal(
    records[0].resolution?.blocking, false,
    '★★ 而它**不阻塞** —— `blocking: true` 会让读的人以为任务停住了（那正是本任务要修的那一半）',
  )
  assert.notEqual(
    records[0].resolution?.pool, 'escalate',
    '★★ 而一次判据拒绝**不许**进「要上报给人」的池子 —— 用户抱怨的正是"一堆本来不需要人的事被推给了人"',
  )

  /**
   * ── ★★★ 第二半：**任务继续走了** ────────────────────────────────────────────
   *
   * 「这次拒绝之后，任务有没有继续往下走」—— 本判据的名字就是它，所以必须有
   * 一条臂**真的让任务走起来**，然后断言"走起来之后不再产生卡点"。
   *
   * ★ 走起来的形式：成员把拒它的那件事改好（这里用一条**只有那一门会拦**的
   *   `status: 'failed'` —— 质量门放行失败态，而变异门只看证据不看 status）。
   *   ★ 用同一个 attempt、同一个任务 ⇒ 若实现把状态挂在任务上而**没在放行时清掉**，
   *     这一条会读到 `count: 2` 并错判成卡点 ⇒ 本臂当场红。
   */
  const second = await reportCompletion(f, 't1', 'a1', { status: 'failed' })
  /**
   * ★ 前置：这一次**不该**被完工判据拒（否则它就成了一次真卡点，
   *   而本臂测的"走起来了"这件事没成立）。
   */
  assert.ok(
    second === undefined || !/^update_task rejected: /u.test(String(second)),
    `★ 前置：改好之后再报，完工判据**不许**再拒它一次（否则任务没走起来）。实测：${String(second).slice(0, 200)}`,
  )
  const afterMove = stallOf(f.stateRoot, 't1')
  assert.equal(
    afterMove, undefined,
    `★★★ 任务继续走了 ⇒ 那条 \`stall\` 必须被【清掉】。留着它会让下一次拒绝读到 `
    + `count=2 而被误判成卡点（"每个任务最终都会变成卡点"）。实测：${JSON.stringify(afterMove)}`,
  )
  await settle()
  const after = frictionRecords(f.stateRoot)
  assert.equal(
    after.filter((record) => record.class === 'blocker').length, 0,
    `★★★ 一次「拒绝 → 改 → 再报 → 放行」的完整回合，**一条卡点都不许产生**。`
    + ` 实测卡点数：${after.filter((record) => record.class === 'blocker').length}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7（★★ 核心臂 · 反向半边）：任务**真的停住** ⇒ 必须产生卡点
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 7（C1 反向半边）：同一条判据拒 ≥2 次 ⇒ 任务真的停住，台账里**产生卡点**', async () => {
  /**
   * ── ★★ 为什么这一半必须有 ──────────────────────────────────────────────────────
   *
   * 一个"**永远**记 rejection（一个卡点都不产生）"的实现会让臂 6 全绿 ——
   * 而它把用户设定的东西整个删掉了（21 条真卡点再也不被记出来）。
   * ⇒ 唯一能把它和正确实现分开的，是喂**该产生卡点**的输入。
   */
  const f = fixture()
  await seedTeam(f.stateRoot, 't1', { baseRevision: f.baseRevision })

  const first = await rejectOnce(f, 't1')
  assert.match(String(first), /^update_task rejected: /, '★ 前置：第一次必须真的被拒')
  await settle()
  const afterFirst = frictionRecords(f.stateRoot)
  assert.equal(
    afterFirst.filter((r) => r.class === 'blocker').length, 0,
    '★ 前置：**第一次**拒绝不许产生卡点（这与臂 6 是同一条判据，这里当对照）',
  )

  /** ② 什么都不改，再报一次 —— 同一 `(task, gate)` 的第二次拒绝。 */
  const second = await rejectOnce(f, 't1')
  assert.match(
    String(second), /^update_task rejected: /,
    `★ 前置：第二次也必须真的被拒（成员什么都没改）。实测：${String(second).slice(0, 200)}`,
  )
  assert.match(
    String(second), /\[completion\.mutation\]/,
    '★ 而拒它的必须**还是同一条**判据 —— 换了一条就不是"卡在同一个地方"（见 `observeStall` 的键）',
  )

  const afterSecond = stallOf(f.stateRoot, 't1')
  assert.equal(
    afterSecond?.state, 'stalled',
    `★★ 同一条判据拒了第二次 ⇒ 任务**停住了**。实测：${JSON.stringify(afterSecond)}`,
  )
  assert.equal(afterSecond?.count, 2, `★ 而次数要如实记成 2。实测：${JSON.stringify(afterSecond)}`)
  assert.equal(
    afterSecond?.gate, 'completion.mutation',
    '★ 而"是哪条判据"必须一起落盘 —— 否则读的人无从复查（也不许猜，见 `observeStall`）',
  )
  await settle()

  const blockers = frictionRecords(f.stateRoot).filter((record) => record.class === 'blocker')
  assert.equal(
    blockers.length, 1,
    `★★★ 第二次拒绝 ⇒ 必须**恰好一条**卡点记录。实测 ${blockers.length} 条`,
  )
  const blocker = blockers[0]
  /**
   * ── ★★★ 两类记录必须【不同形】—— 这是"合并回一条 ⇒ 臂红"瞄准的那一格 ───────────
   *
   * ★ 判据不是"有没有 `class` 这个字段"（那是形状），而是**结论本身**：
   *   `class` / `resolution.blocking` / `resolution.pool` / `rescue.state`。
   *   把两类合并回一条（都写成 rejection 的取值）会让这里当场红。
   *
   * ── ★★★ C2 修正（本行是 `pool` 那一格第二次被改）────────────────────────────────
   *
   * MEASURED：C1 落地时本臂断言 `blocker.resolution.pool === 'escalate'`，
   * 而**那是 C2 之前的口径**。C2 把"停住"与"该不该上报"拆成两件事
   * （用户的原始设计，已由用户直接裁定）：
   *
   *     一个**刚停住**的卡点 ⇒ `rescue.state = 'trying'`（**还没有任何人去救过它**）
   *                          ⇒ `pool: 'self'`（默认目标是自己解）
   *     只有**试过而解不掉**（`cannot-solve`）才进 `escalate`。
   *
   * ⇒ 所以"真卡点 ⇒ escalate"这条断言，在 C2 之后是**错的**，而且它错得有意义：
   *   那正是 214 条被缺省推进上报池的成因（"停住 ⇒ 直接 ⇒ 上报"，中间那一步不存在）。
   *
   * ★★★ 而本臂的**真正主题一个字不改** —— 它要证明的是
   *   "**真卡点与判据拒绝不是同一个形状**"（这正是臂 6/7 成对存在的理由）。
   *   ⇒ 那个主题现在由**下面几格**共同承载，而 `pool` 从"必然 escalate"改成
   *     "由 rescue 决定、且此刻不是 escalate"：
   *
   *       `class`              : blocker ≠ rejection        （两类不同）
   *       `resolution.blocking`: true ≠ false               （有人必须动 vs 不用动）
   *       `rescue.state`       : trying（这一轴 C2 新增）    （还没有人去救过）
   *       `resolution.pool`    : self（**此刻**不占用人）     （默认自己解）
   *
   * ★★ 而"此刻不占用人"这一格，两类**取得相同的值**，所以它**不再是**分开两类的那一格 ——
   *   分开两类的是 `class` 与 `resolution.blocking`（见本臂末尾那段受控对照）。
   *   ★ 把这一点写清楚，是因为"两类都写 self"读起来像"两类同形"，
   *     而它们是**因为不同的理由**都不占用人：
   *       rejection ⇒ 它**不是**一个卡点（压根没有"要不要人动"这件事）；
   *       blocker   ⇒ 它是卡点、**有人必须动**（`blocking: true`），
   *                   只是那个动的人**是我们**，而不是用户。
   */
  assert.notEqual(
    blocker.resolution?.blocking, false,
    '★★★ 真卡点必须 `blocking: true` —— 与 rejection 的 `false` **不同形**。'
    + ' 合并回一条（都写 false）会让**真卡点**读成"不需要动"，那正是本任务要修的那一半',
  )
  assert.equal(
    blocker.resolution?.blocking, true,
    '★★★ 而它必须是 `true` 本身（不是缺席、不是别的真值）—— 三态不许合流',
  )
  assert.equal(
    blocker.rescue?.state, 'trying',
    '★★★ C2：一个**刚刚停住**的卡点，在"有没有人救过"这一轴上的答案是 `trying` —— '
    + '**还没有任何人去试过**。★ 而它**不许**落 `cannot-solve`：那会把 214 条的缺陷'
    + '换个入口请回来（`entities.ts` 的 `defaultRescueForStall` 长注释逐字记了这条）',
  )
  assert.equal(
    blocker.resolution?.pool, 'self',
    '★★★ C2 修正：真卡点此刻进的是【自己解】的池子，**不是**上报池。'
    + ' ★ 上报池只对 `cannot-solve` 开放（试过、解不掉）—— 那是本任务的验收 ② 。'
    + ' ★★ 而这一格与 rejection 的 `self` **不同形**，见本块末尾那条断言',
  )
  assert.notEqual(
    blocker.resolution?.pool, undefined,
    '★★ 而 `pool` 必须在场 —— "缺席"与"判成 self"不同形（本仓记账的形态）',
  )
  assert.equal(
    blocker.resolution?.whyPool, undefined,
    '★★ 而 `whyPool` 此刻**必须缺席**：一条**没有**进上报池的记录，'
    + '没有"为什么进这个池子"要交代 —— 违规地写上一句空话会让"没进池"读成"进了池而说不出理由"',
  )
  assert.notEqual(
    blocker.class, 'rejection',
    '★★ 而 `class` 这一格也必须是另一类',
  )
  /**
   * ★ 判据本身（连同 N）也要落盘：见 `recordFriction` 里那段
   *   （`PENDING-FRICTION-REFORM.md` §6 经验 A：一个数必须连同它的测量装置一起读）。
   */
  assert.equal(blocker.stall?.basis, 'repeated', '★ 判据要说清它是靠什么判的')
  assert.equal(blocker.stall?.count, 2, '★ 而次数要落进记录')
  assert.equal(
    typeof blocker.stall?.threshold, 'number',
    '★★ N 是**可注入**的 ⇒ 它必须一起落盘 —— 不记 N 的话，两条 count 相同的记录在读取端同形，而它们的结论相反',
  )
  /**
   * ★ 两类记录的受控对照：同一份夹具、同一个任务、同一条判据 —— 唯一变的是**次数**。
   *   ⇒ 两条记录的 `class` 必须不同（这就把"形状不同"钉在**同一条判据**上，
   *     而不是"两个不同的夹具碰巧长得不一样"）。
   */
  const all = frictionRecords(f.stateRoot)
  assert.equal(all.length, 2, `★ 两次拒绝 ⇒ 两条记录。实测 ${all.length} 条`)
  assert.deepEqual(
    all.map((record) => record.class), ['rejection', 'blocker'],
    '★★★ 同一个任务、同一条判据、唯一变的自变量是【次数】⇒ 两条记录必须分属两类。'
    + ` 实测：${JSON.stringify(all.map((record) => record.class))}`,
  )
  /**
   * ── ★★★ C2 之后，两类"不同形"到底落在哪几格（★ 这一块是 C2 的读数，不是猜测）────
   *
   * MEASURED（本臂当场读回来的两条记录）：
   *
   *                class       resolution.blocking   rescue.state   resolution.pool
   *   rejection    rejection   false                 trying         self
   *   blocker      blocker     true                  trying         self
   *
   * ★★ 于是有两个结论**必须说出来**，否则本臂会读成一个它没测过的东西：
   *
   *   ① `resolution.pool` **不再**把两类分开 —— 两条都是 `self`。
   *      这正是 C2 的**目的**：一个刚停住的卡点默认是"我们自己解"，与一条判据拒绝
   *      都不占用人。★ 而它**不是**"两类同形"：把人请进来的那条路只对
   *      `cannot-solve` 开放，而那需要一次**真实的、失败的救援**才写得出来。
   *   ② `rescue` 也**不**把两类分开（两条都是 `trying`）——
   *      `recordFriction` 对每条记录都写它（一个读数、两处使用，见那里的长注释）。
   *
   * ⇒ ★★★ 所以"两类不同形"在 C2 之后由**这两格**承载：
   *      `class`（rejection ≠ blocker）与 `resolution.blocking`（false ≠ true）。
   *   而它们恰是**后果相反**的那一格：`blocking: false` = 那条记录不用人动，
   *   `blocking: true` = **有人必须动**（只是那个人是我们，不是用户）。
   *
   * ★ 下面两条断言把这件事**钉成可核的**：若有人把两类合并回一条
   *   （rejection 也写 `blocking: true`、`class: 'blocker'`），这两条当场红。
   */
  const [rejection, blockerRecord] = all
  assert.equal(
    rejection?.resolution?.blocking, false,
    '★★★ `blocking` 才是 C2 之后真正分开两类的那一格：一条判据拒绝**不阻塞**。'
    + ' 它与下面那条成对 —— 合流会让"真卡点不需要动"与"判据拒绝不需要动"读成同一件事',
  )
  assert.equal(
    blockerRecord?.resolution?.blocking, true,
    '★★★ 而真卡点是 `true` —— 与上面那条成对。★ 合流会让"真卡点不需要动"与'
    + '"判据拒绝不需要动"读成同一件事，而那正是本任务要修的那一半',
  )
  assert.equal(
    rejection?.rescue?.state, blockerRecord?.rescue?.state,
    '★★ C2 的诚实读数：**两类此刻的 `rescue.state` 相同**（都是 `trying`）。'
    + ' ★ 记下这一条是为了不让读者以为"rescue 分开了两类"—— 它没有；'
    + ' 它给两类都补上"有没有人救过"这一轴，而该轴的第三态 `cannot-solve`'
    + ' 只在**一次失败的救援之后**才出现（那是 `pool: escalate` 的唯一入口）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（★★★ 定向突变臂）：把两类【合并回一条】⇒ 本臂必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 8（C1 定向突变臂）：合并回一条的变异体会让臂 6/7 红 —— 逐条实测', async () => {
  /**
   * ── ★★ 为什么要有这一条「对定向突变的读数」─────────────────────────────────────
   *
   * 契约的第三条验收是：**「两类不同形（定向突变：合并回一条 ⇒ 臂红）」**。
   * ★ 而"我声称它会长红"是一个**关于动作的猜想**（`PENDING-FRICTION-REFORM.md`
   *   §6 经验 F：「动作发生了」与「事实建立了」不同形，只有后者可测）。
   * ⇒ 所以这里不猜：**当场施加突变、当场跑、当场读回**那两条臂的裁决。
   *
   * ── 它怎么做（不碰 `src/`，也不碰盘上的 `lib/`）──────────────────────────────
   *
   * ★ 本文件的硬约束是"不碰 src/ 也不碰 lib/"。而这条臂要读的正是
   *   **被突变之后的产物** ⇒ 做法是在**临时目录**里造一份 `lib/` 的副本，
   *   在副本上做变异，然后**在子进程里**让那两条臂跑在副本上。
   *
   * ★★ 而"合并回一条"必须是一个**真的**变异体，不是改一个断言：
   *   它改的是 `lib/tools/shared/entities.js` 里那两个决定 `class` 的表达式
   *   （`blocker` ⇒ `rejection`，`blocking` ⇒ `false`）。
   *   这正是"把两类合并回一条"的**最小形态**。
   */
  const libRoot = fileURLToPath(new URL('../lib', import.meta.url))
  const recordsPath = join(libRoot, 'tools', 'shared', 'entities.js')
  const source = readFileSync(recordsPath, 'utf8')

  /**
   * ★ 定位那两个**真的**决定类别的表达式（而不是按行号猜）：
   *   `PENDING-FRICTION-REFORM.md` §3 记过那条教训 ——「夹具用 indexOf 应用变异体
   *   （打到别的行）+ 基线红」，四个 mutation score 全是坏的。
   *   ⇒ 这里按**内容**定位，且找不到就**当场红**（不静默跳过）。
   */
  const classExpr = /stall\.stalled \? 'blocker' : 'rejection'/u
  const blockingExpr = /recordClass === 'blocker'/u
  assert.match(source, classExpr, '★ 突变臂前置：要在产物里找到决定 `class` 的那一句（找不到就不能声称"施加了突变"）')
  assert.match(source, blockingExpr, '★ 突变臂前置：要在产物里找到决定 `resolution` 那一句')

  /** 突变体：把两类**合并回一条**（恒 rejection / 恒 blocking:false）。 */
  const mutated = source
    .replace(classExpr, "'rejection'")
    .replace(blockingExpr, 'false')

  /**
   * ── 副本树：只改那一个文件，其余**软链**回真的 `lib/` ─────────────────────────
   *
   * ★ 复制整棵 `lib/` 会很慢且会与队友的并发 build 抢盘；软链让它是一棵
   *   **除那一格之外逐字相同**的树 —— 于是"臂红了"这件事只能归因于那一格。
   */
  const dir = mkdtempSync(join(tmpdir(), 'friction-mutant-'))
  try {
    const mutantLib = join(dir, 'lib')
    /**
     * ── ★★★ 用**复制**而不是软链（MEASURED，本臂第三版）─────────────────────────────
     *
     * ★ 第一版用软链 + 默认解析 ⇒ 软链被 **realpath 解开** ⇒ 变异的
     *   `entities.js` **在盘上而没有任何代码读它**（静默：读数与未突变逐字相同）。
     * ★ 第二版改用 `--preserve-symlinks` 修好了那一格 —— **而它把别的东西弄坏了**：
     *   保留了软链之后，`node_modules` 的**嵌套解析**（`@deepseek-ai/cordis` →
     *   它自己的 `node_modules/@deepseek-ai/cosmokit`）也走了副本树，
     *   于是 `ERR_MODULE_NOT_FOUND` ⇒ 子进程根本起不来。
     *
     * ⇒ 修法是**不引入软链**：`lib/` 只有 3.3 MB，整棵**真复制**过来，
     *   而 `node_modules` 保持各引用方的正常解析（不在副本树里放它 ——
     *   Node 会从副本树往上找到主树的 `node_modules`）。
     * ★ 于是"副本树"这件事**不需要任何 flag** ⇒ 少一个会悄悄改变解析语义的变量。
     */
    cpSync(libRoot, mutantLib, { recursive: true })
    writeFileSync(join(mutantLib, 'tools', 'shared', 'entities.js'), mutated, 'utf8')

    /**
     * ★★ 在子进程里跑**臂 7**（反向半边）：突变体把 `blocker` 也记成 `rejection`
     *   ⇒ 「真卡点产生卡点记录」这条断言必须红。
     *
     * ★ 用 `--test-name-pattern` 只跑那一条：本臂要读的是**这一条**的裁决，
     *   不是整份文件的（整份里还有一半臂是绿的，那会盖住这个读数）。
     * ★ 子进程的 cwd 是**副本的父目录** —— 但 `--test` 跑的是主树的那个测试文件
     *   （它 import `../lib/` 是**相对它自己**解析的）… ⇒ 所以不能只换 cwd。
     *   做法：把测试文件也**软链**进副本树，让它 `../lib` 解析到副本的 `lib/`。
     */
    const mutantScripts = join(dir, 'scripts')
    mkdirSync(join(mutantScripts, 'fixtures'), { recursive: true })
    for (const name of ['gate-friction-capture.test.mjs']) {
      writeFileSync(join(mutantScripts, name), readFileSync(new URL(name, import.meta.url), 'utf8'), 'utf8')
    }
    cpSync(
      join(fileURLToPath(new URL('../scripts', import.meta.url)), 'fixtures'),
      join(mutantScripts, 'fixtures'),
      { recursive: true },
    )
    /**
     * ★ `src/` 里的 JSON 表（kind-requirements.json 等）也要可达 —— 那几处
     *   在夹具里是**相对测试文件**或**相对仓库根**读的（`src/` 只有几百 KB）。
     */
    cpSync(fileURLToPath(new URL('../src', import.meta.url)), join(dir, 'src'), { recursive: true })
    /**
     * ── ★★ `node_modules`：**一条软链** —— 而它与上面那个坑不同形 ─────────────────
     *
     * ★ 不能复制（1.6 GB），也不能不放（副本树在系统临时目录里，Node 逐级向上
     *   **永远走不到**本仓的 `node_modules` ⇒ `ERR_MODULE_NOT_FOUND:
     *   @deepseek-ai/dsh-agent`，MEASURED 已撞两次）。
     *
     * ★★ 而**软链这一个目录是安全的**，与第一版那个坑有一处决定性差别：
     *   第一版软链的是 `lib/` 里的**每一个文件**，于是"我在副本树里改的那个模块"
     *   与"运行时加载的那个模块"是两个不同的 realpath。
     *   这里副本树的 `lib/` 是**真文件**（改的就是被加载的那一份），
     *   软链只解决"去哪儿找第三方包" —— 那一格**本来就是共享的**，不是被测对象。
     */
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(dir, 'node_modules'))

    const run = (pattern) => {
      const result = spawnSync(
        'node',
        [
          '--test', '--test-reporter=tap',
          `--test-name-pattern=${pattern}`,
          'scripts/gate-friction-capture.test.mjs',
        ],
        /**
         * ★★ 子进程必须拿到**剥掉递归标记**的环境 —— 否则 `node --test` 判它是递归
         *   并把整个文件**静默跳过**，于是 exit=0、而"突变没造成红"这件事
         *   与"子进程根本没跑"同形（MEASURED：本臂第一版就撞了这个 ——
         *   exit=0 且输出里只有那句 "skipping running files"）。
         *   共享件仍然是唯一出处：`recursionFreeEnv`。
         */
        { cwd: dir, encoding: 'utf8', env: recursionFreeEnv(process.env), maxBuffer: 32 * 1024 * 1024 },
      )
      return { code: typeof result.status === 'number' ? result.status : -1, out: `${result.stdout ?? ''}\n${result.stderr ?? ''}` }
    }

    /**
     * ── ★★★ 前置断言：**子进程读到的到底是哪一份实体** ───────────────────────────
     *
     * ★ 本臂第一版栽的那个坑是**静默**的（软链被 realpath 解开 ⇒ 变异体在盘上而
     *   没有任何代码读它）⇒ 它必须有一条**自己的**断言，而不是相信"我把文件写对了"。
     * ★ 这正是本队那条纪律的可执行形式：**每一次「这样就该好了」都必须配一个
     *   【读回那个事实】的动作**，否则它只是一个关于动作的猜想。
     */
    const controlLib = join(dir, 'lib')
    /** 先放**未突变**的那一份，好让下面这个行为探针有一个可对照的读数。 */
    writeFileSync(join(controlLib, 'tools', 'shared', 'entities.js'), source, 'utf8')
    /**
     * ── ★★ 前置②：**突变体真的被加载了**（不是"我写了那个文件"）────────────────────
     *
     * ★ 判据是机械的、且读的是**被加载的那一份的行为**（而不是盘上文件的内容）：
     *   在副本树里跑一个最小脚本，让它**真的走一遍** `recordFriction`，
     *   然后读回那条记录的 `class`。
     *
     * ★★ 为什么不能用"读盘上文件里有没有 `'rejection'` 字面量"：
     *   那正是本臂第一版栽的那个坑 —— 变异体**在盘上**，而没有任何代码读它
     *   （软链被 realpath 解开）⇒ 盘的读数是绿的，行为却与未突变**逐字相同**。
     *   ⇒ 所以这一条必须**从行为读**，不能从盘读。
     */
    const behaviorProbe = () => {
      const result = spawnSync(
        'node',
        [
          '--input-type=module', '-e',
          [
            `const { recordFriction } = await import(${JSON.stringify(join(dir, 'lib', 'tools', 'shared', 'entities.js'))})`,
            `const { mkdtempSync, readFileSync, readdirSync } = await import('node:fs')`,
            `const { tmpdir } = await import('node:os')`,
            `const { join } = await import('node:path')`,
            `const root = mkdtempSync(join(tmpdir(), 'c1-probe-'))`,
            `await recordFriction({ stateRoot: root, point: 'completion', message: 'update_task rejected: [completion.mutation] probe',`,
            `  context: {}, mechanismState: {},`,
            `  stall: { stalled: true, count: 2, basis: 'repeated' } })`,
            `const dir2 = join(root, 'frictions')`,
            `const name = readdirSync(dir2)[0]`,
            `const record = JSON.parse(readFileSync(join(dir2, name), 'utf8'))`,
            `process.stdout.write(JSON.stringify({ class: record.class, blocking: record.resolution?.blocking }))`,
          ].join('\n'),
        ],
        { cwd: dir, encoding: 'utf8', env: recursionFreeEnv(process.env) },
      )
      return { code: typeof result.status === 'number' ? result.status : -1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
    }
    /**
     * ★ 未突变的副本：`stalled: true` ⇒ `class` 必须是 `blocker`、`blocking` 必须是 `true`。
     *   （★ 这是**行为**读数 —— 它证明"副本树读的是副本树的那一份"。）
     */
    const liveBefore = behaviorProbe()
    assert.equal(
      liveBefore.code, 0,
      `★ 突变臂前置：行为探针必须在副本树里跑得起来。实测：${liveBefore.out.slice(0, 400)}`,
    )
    assert.match(
      liveBefore.out, /"class":"blocker"/,
      '★★★ 突变臂前置：**未突变**的副本树上，一个 `stalled: true` 的输入必须落 `class: "blocker"`。'
      + ' 若这里是 `rejection`，说明**副本树根本没被读到**（变异体在盘上而没人读它）——'
      + ' 而那正是本臂第一版栽的那个静默坏法。实测：' + liveBefore.out,
    )
    /**
     * ── ★★★ 而这一条是本臂**真正的**前置：突变**必须改变行为** ───────────────────
     *
     * ★ 它把"突变体被加载了"这件事从**猜想**变成**读数**：
     *   同一个输入、同一棵树，只改那一格 ⇒ 输出必须**不同形**。
     * ★ 缺了它，"臂 7 在突变下变红"可能只是**副本树坏了**（那边 读数 ① 也在防，
     *   但两者防的不是同一件事：这一个防"突变没生效"，那一个防"树本来就不行"）。
     */

    /**
     * ── 读数 ①（前置）：副本树的**未突变**基线必须绿 ─────────────────────────────
     *
     * ★ 缺了这一半，"突变之后红了"可能只是因为**副本树本身**是坏的
     *   （`PENDING-FRICTION-REFORM.md` §6 经验 A 那四个 mutation score 里的第 2 个
     *   正是这个坏法：同一个坏 harness，基线红）。
     */
    const control = run('C1 反向半边')
    assert.equal(
      control.code, 0,
      `★ 突变臂前置：**未突变的副本树**上，臂 7 必须是绿的（否则本臂分不清"突变造成的红"与"副本树本来就是坏的"）。`
      + ` 实测 exit=${control.code}\n${control.out.slice(-2000)}`,
    )

    /** ── 读数 ②（★ 交付读数）：施加突变 ⇒ 臂 7 **必须**红 ─────────────────────── */
    writeFileSync(join(controlLib, 'tools', 'shared', 'entities.js'), mutated, 'utf8')
    /**
     * ★★★ 前置：同一个输入在突变体上必须**变成另一类** ─────────────────────────────
     *
     * ⇒ 这一条把"突变真的生效了"证完；下面那条红才有资格归因于它。
     */
    const liveAfter = behaviorProbe()
    assert.equal(liveAfter.code, 0, `★ 突变臂前置：突变体上的行为探针必须跑得起来。实测：${liveAfter.out.slice(0, 400)}`)
    assert.match(
      liveAfter.out, /"class":"rejection"/,
      '★★★ 突变臂前置：**合并回一条**的突变体上，同一个 `stalled: true` 的输入必须落 `rejection`'
      + '（这就是"两类被合成一类"的可执行形式）。若它仍是 `blocker`，说明突变**没有生效**，'
      + ` 而下面的红就不能归因于它。实测：${liveAfter.out}`,
    )
    const mutant = run('C1 反向半边')
    assert.notEqual(
      mutant.code, 0,
      '★★★ 定向突变：把两类**合并回一条**（`blocker` ⇒ `rejection`，`blocking` ⇒ `false`）之后，'
      + ' 臂 7（"任务真的停住 ⇒ 产生卡点"）**必须变红** —— 若它还是绿的，说明那两条臂测不出这个区别，'
      + ' 而"两类不同形"这句话就没有证据。'
      + ` 实测 exit=${mutant.code}\n${mutant.out.slice(-2000)}`,
    )
    /**
     * ★★ 而红的必须是**那一条断言**（不是"整个文件跑不起来"那种红）——
     *   否则"臂红了"与"夹具坏了"同形。
     *
     * ★ 判据用**断言正文里的那些词**（"卡点"/"blocking"/"不同形"），
     *   而不是"exit≠0"或"有没有异常"：一个加载期崩溃也会让 exit≠0，
     *   而它与"这条臂逮住了这个突变"在退出码上**同形**。
     */
    assert.match(
      mutant.out, /卡点|blocking|不同形/u,
      '★★ 而突变造成的红必须落在**关于两类记录不同形的那些断言**上，而不是一个加载期崩溃'
      + ` （后者也会让 exit≠0 ⇒ 两者在退出码上同形）。实测输出尾部：\n${mutant.out.slice(-2000)}`,
    )
    /** ★ 反向半边：红的**不许**是"模块找不到 / 语法错"那类（那说明副本树坏了，不是突变有效）。 */
    assert.doesNotMatch(
      mutant.out, /ERR_MODULE_NOT_FOUND|SyntaxError|Cannot find package/u,
      `★★ 反向半边：这个红**不许**是副本树自身的坏法（加载失败 / 找不到包）—— 那与"突变被逮住"不同形。`
      + ` 实测输出尾部：\n${mutant.out.slice(-1500)}`,
    )

    /**
     * ── 读数 ③（★ 反向半边 · 定向）：突变**臂 6**（正向半边）也必须是红的 ─────────
     *
     * ★ 只突变一半（`blocker` ⇒ `rejection`）会让臂 6**更绿**（一个卡点都不产生，
     *   而臂 6 要的正是"不产生卡点"）⇒ **臂 6 单独测不出这个突变**。
     *   ⇒ 这就是为什么两类**各自**都需要一条臂，而这一条读数把那个"为什么"钉住：
     *     只突变"该记卡点"的那一半 ⇒ 臂 7 红、臂 6 绿。
     * ★ 它是本臂最有价值的一格：它证明了**两条臂都不是冗余的**。
     */
    const arm6Only = run('C1 正向半边')
    assert.equal(
      arm6Only.code, 0,
      '★★ 定向读数：把"该记卡点"的那一半合并掉**不影响**臂 6（一次拒绝 ⇒ 不产生卡点）——'
      + ' 这正说明**正向臂单独测不出这个缺陷**（本队经验 B），所以臂 7 不是冗余的。'
      + ` 实测 exit=${arm6Only.code}\n${arm6Only.out.slice(-1500)}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


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

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9 / 臂 10（t24）：`dispatch` 点的卡点记账 —— 「拒绝 ⇒ 台账 +1」的守门臂
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★★ 它防的是什么（MEASURED，2026-10-14 队长复核）──────────────────────────────
 *
 * 台账 `.agent-teams/frictions/` 按**捕获点**拆开：
 *
 *     `dispatch`    67 条 · 最后一次 **2026-10-09**
 *     `completion`  53 条 · 最后一次 2026-10-10
 *     `contract`     9 条 · 2026-10-14（唯一还活着）
 *
 * 而根因是一个**可定位的提交**：
 *
 *     d231f74 fix(t39): move the dispatch evaluation to where dispatch actually happens
 *
 * 它把 dispatch 的求值从 `update_task` 搬到 `create_task`（★ 搬动本身是**对的** ——
 * `update_task` 的四个状态里没有一个是"派发"）。而它**没有把记账一起搬走**：
 *
 *     删除的 `recordFriction` 调用：**2 处**（`point: 'dispatch'`）
 *     新增的 `recordFriction` 调用：**0 处**
 *
 * ★★ 而它**没有任何东西报错**：判据照常拒绝、日志照常有、`throwWithSurface`
 *   照常带结论 —— 唯一消失的是**台账那一格**，而它是"事后补不上"的那一份材料
 *   （f-0014：记录必须在卡点发生时做）。⇒ 形态与 t39 拆 `tools.ts` 时把 t41 的
 *   接线搬回旧版**同族**：**一次纯搬运，少搬了「改动的可见面」。**
 *
 * ── 为什么必须配一条【真的会红】的臂 ────────────────────────────────────────────
 *
 * `completion` / `contract` 两处**各自有臂**（臂 1/2/4 与臂 3），而 `dispatch` 这一格
 * **没有** —— 全仓没有任何一条断言要求「**拒绝 ⇒ 台账 +1**」。
 * ⇒ 于是同一件事可以第三次发生。三条臂各钉一半：
 *
 *     臂 9  —— 「dispatch 判据拒绝 ⇒ 台账 +1」（**守门臂**，本段的核心）
 *     臂 10 —— 它的**反向实测**（去掉新加的记账 ⇒ 臂 9 必须红）
 *     臂 11 —— best-effort 那半边（写盘失败 ⇒ 拒绝一字不变，且"记不下"要出声）
 *
 * ── ★★ 本段三条臂**读的是可达的那一半**，而不可达的那一半如实写在这里 ──────────────
 *
 * 契约要求"四类不许被记"。实测（臂 9 第 ④ 节自己的断言给出读数）在 `create_task`
 * 这一条路径上：
 *
 *   ① `dispatchNotChecked` 放行支  ⇒ ★ **不可达**。两个成因各自被挡住：
 *        · `skippedAll`（一条判据都没跑）：dispatch 位注册的三条里，`changed-paths`
 *          与 `worktree` 的 `appliesTo` 都要 `update.changedPaths` 非空，而
 *          `create_task` 传的是 `changedPaths: undefined`（见 `wireDispatch` 调用点）
 *          ⇒ 它们**恒** skipped；而 `plan-reviewed` 对新任务恒 `appliesTo`
 *          （`createdAt` 由工具自己写、恒晚于那道门上线时刻）⇒ 不可能"一条都没跑"。
 *        · `unmeasured`（跑了而测不成）：`plan-reviewed` 唯一的 unmeasured 支是
 *          "戳在场而形状坏"，而**输入 schema 先把那些形状挡掉了**
 *          （臂 9 第 ④ 节逐条实测：空 `id` / 空 `verdict` 都在 schema 边界就被拒）。
 *   ② `inputSurface.incomplete > 0` 告警支 ⇒ ★ 在本路径上与**真拒绝同时发生**
 *      （`plan-reviewed` 只声明 `task.reviewed` 一格：它缺 ⇒ 既 incomplete、又 blocked）。
 *      ⇒ 臂 9 钉住的是它**能**钉的那一半：那一次调用**只多一条**记录
 *      （若有人把记录搬进告警支，就会多出第二条 ⇒ 当场红）。
 *
 * ★ 所以本段的措辞是"**这两类在本路径上不可达 / 不可分**"，而不是"本臂覆盖了它们"。
 *   把不可达说成已覆盖，正是本队记账里最贵的那个形状（把"没测到"读成"测过了"）。
 */

/**
 * 建一个团队（走**真工具**），返回一个 `call(name, args)`。
 *
 * ★ 落点在这个夹具**自己的** `stateRoot` 里 —— 与臂 1 同一条纪律（不许用进程级单值）。
 */
async function dispatchTeam(f) {
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
  await call('agent_teams_create', { name: 'team', description: 'dispatch friction fixture', approval: 'automatic' })
  await call('agent_teams_add_member', { name: 'worker', role: 'engineer' })
  return call
}

/** 这个夹具的团队 id（**从盘上读**，不猜工具怎么生成它）。 */
function teamIdOf(stateRoot) {
  const dir = readdirSync(stateRoot).find((name) => existsSync(join(stateRoot, name, 'team.json')))
  return JSON.parse(readFileSync(join(stateRoot, dir, 'team.json'), 'utf8')).id
}

/** 一次 `create_task`：返回错误原文，或被放行时返回 `undefined`。 */
function createTaskVia(call, args) {
  return call('agent_teams_create_task', args).then(
    () => undefined,
    (error) => String(error.message),
  )
}

test('★★★ 臂 9（★ 守门臂）：dispatch 判据拒绝 ⇒ 台账 +1；放行 / 契约拒绝 / 其它异常一律不记', async () => {
  const f = fixture()
  const call = await dispatchTeam(f)
  const teamId = teamIdOf(f.stateRoot)
  /** 本臂的触发：一条**没审过**的计划（`plan-reviewed` 真的拒绝它）。 */
  const base = {
    description: 'a task whose plan has not been reviewed',
    kind: 'work',
    assignee: 'worker',
    objective: 'o',
    acceptance: ['x'],
    verify: ['node --test scripts/suite.test.mjs'],
  }
  const ledger = () => frictionRecords(f.stateRoot)
  /** 主树那份**真台账**的条数 —— 本臂的反向半边（污染检查）。 */
  const mainLedger = join(process.cwd(), '.agent-teams', 'frictions')
  const mainCount = () => existsSync(mainLedger)
    ? readdirSync(mainLedger).filter((name) => /^f-\d+\.json$/.test(name)).length
    : 0
  const mainBefore = mainCount()

  /**
   * ── ① 放行半边（对照）：**审过了**的计划 ⇒ 建得出来，且台账**一条都不多** ──────────
   *
   * ★ 这一半与下面那一半**缺一不可**：只喂"该被拒"的输入的臂**测不出**
   *   "一律记一条"（`PENDING-FRICTION-REFORM.md` §6 经验 B）。
   */
  const passed = await createTaskVia(call, { ...base, subject: 'passed', reviewed: reviewedStamp() })
  assert.equal(
    passed, undefined,
    `★ 前置：审过了的计划必须真的被放行（否则本臂的对照半边测的是别的东西）。实测：${String(passed).slice(0, 200)}`,
  )
  await settle()
  assert.equal(
    ledger().length, 0,
    '★ 放行 ⇒ 一条都不记 —— "没有卡点"与"记不下"必须不同形（否则台账里全是噪音，'
    + `而噪音会教人忽略它）。实测：${JSON.stringify(ledger().map((r) => r.auto))}`,
  )

  /**
   * ── ② 拒绝半边（**本臂的靶子**）：dispatch 判据真的拒绝 ⇒ 台账 +1 ─────────────────
   */
  const rejected = await createTaskVia(call, { ...base, subject: 'blocked' })
  assert.match(
    String(rejected), /^create_task rejected: /,
    `★ 前置：这条调用必须是一条**真拒绝**。实测：${String(rejected).slice(0, 200)}`,
  )
  assert.match(
    String(rejected), /\[dispatch\.plan-reviewed\]/,
    `★ 而拒绝它的必须是 dispatch 位那条判据（本臂的触发就是它）。实测：${String(rejected).slice(0, 200)}`,
  )
  await settle()

  const afterReject = ledger()
  assert.equal(
    afterReject.length, 1,
    '★★★ 本臂的靶子：**dispatch 判据拒绝 ⇒ 台账 +1**。'
    + ' 这一条此前【全仓没有任何断言】（completion / contract 两处各自有臂，dispatch 这一格没有）'
    + ' ⇒ 于是 d231f74「搬走求值没搬走记账」静默了 5 天。'
    + ` 实测条数：${afterReject.length}`,
  )
  const [record] = afterReject

  /** ── ③ 记录的**身份**：`auto.point` / `auto.tool` / 判据 id / 团队 ──────────────── */
  assert.equal(
    record.auto?.point, 'dispatch',
    `★★ 契约要求：台账记录的 auto.point 必须是 'dispatch'。实测：${JSON.stringify(record.auto)}`,
  )
  assert.equal(
    record.auto?.tool, 'create_task',
    `★★ 契约要求：auto.tool 必须是 'create_task'（与契约位那条**同一个工具名**）。实测：${JSON.stringify(record.auto)}`,
  )
  assert.equal(
    record.auto?.gate, 'dispatch.plan-reviewed',
    `★ 判据 id 必须读得出来（它是"这条是谁拒的"的唯一可机读归因）。实测：${JSON.stringify(record.auto)}`,
  )
  assert.equal(
    record.index?.component, 'dispatch',
    `★ 记录自报的捕获点也必须是 dispatch。实测：${JSON.stringify(record.index)}`,
  )
  assert.equal(
    record.scene?.team, teamId,
    `★ 记录必须属于**这个夹具自己的**团队（本臂的 stateRoot 在临时目录里）。实测：${record.scene?.team}`,
  )
  assert.ok(
    String(record.title).includes('create_task rejected: '),
    `★ 标题必须是那条拒绝的原文（带 [rejection — not a blocker] 前缀）—— 台账与人读的那一份同源。实测：${String(record.title).slice(0, 160)}`,
  )
  assert.notEqual(
    record.observed?.mechanismState, null,
    '★ 判据当时的完整裁决必须随记录落地（否则事后读这条拒绝只能看到"被拒了"）。',
  )

  /**
   * ── ④ 四类**不许被记**（本路径上可达的那几类，逐条实测）─────────────────────────
   *
   * 不可达的两类（`dispatchNotChecked` 放行支 / `incomplete > 0` 单独出现）写在段头，
   * 这里钉住**能**钉的：
   */
  /** (a) 契约校验类拒绝：它走 `rejectOnContractGates`，**已经**记 contract 点。 */
  const contractRejected = await createTaskVia(call, {
    ...base,
    subject: 'contract',
    verify: ['grep -qx 7 <(wc -l < a.ts)'],
  })
  assert.match(
    String(contractRejected), /^create_task rejected: \[contract\.verify-command\]/,
    `★ 前置：本节的触发必须是**契约位**那条拒绝。实测：${String(contractRejected).slice(0, 200)}`,
  )
  await settle()

  /** (b) 工具抛的其他异常：schema 边界 / 契约校验 / 找不到成员 —— 一条都不许记。 */
  const toolErrors = [
    ['schema：缺 subject', { ...base, subject: undefined }],
    ['schema：acceptance 不是数组', { ...base, subject: 'e2', acceptance: 'x' }],
    ['schema：reviewed.checks[0].id 是空串', { ...base, subject: 'e3', reviewed: { at: 1, by: 'x', checks: [{ id: '', verdict: 'pass' }] } }],
    ['schema：reviewed.checks[0].verdict 是空串', { ...base, subject: 'e4', reviewed: { at: 1, by: 'x', checks: [{ id: 'scope', verdict: '' }] } }],
    ['契约校验：implementation 缺 inScope', { ...base, subject: 'e5', kind: 'implementation' }],
    ['找不到成员', { ...base, subject: 'e6', assignee: 'nobody' }],
  ]
  const thrown = []
  for (const [label, args] of toolErrors) {
    const message = await createTaskVia(call, args)
    assert.notEqual(message, undefined, `★ 前置：「${label}」必须真的抛出来（否则它测的是一次成功调用）`)
    thrown.push(`${label} ⇒ ${String(message).slice(0, 90)}`)
  }
  await settle()

  const afterExclusions = ledger()
  const dispatchRecords = afterExclusions.filter((item) => item.auto?.point === 'dispatch')
  const contractRecords = afterExclusions.filter((item) => item.auto?.point === 'contract')
  assert.equal(
    dispatchRecords.length, 1,
    '★★★ 四类**不许被记**：契约校验类拒绝（已记 `contract` 点）与工具抛的其他异常都不许再记一条 dispatch。'
    + ` 实测：dispatch 点 ${dispatchRecords.length} 条 · contract 点 ${contractRecords.length} 条。`
    + `\n  逐条抛出来的原文：\n  · ${thrown.join('\n  · ')}`,
  )
  assert.equal(
    contractRecords.length, 1,
    '★ 而契约位那条**照旧**记它自己的点（本任务没有动 completion / contract 两处的记账）——'
    + ` 实测 ${contractRecords.length} 条。`,
  )

  /**
   * ── ⑥ 反向半边：主树那份**真台账**不许因这次夹具而多东西 ─────────────────────────
   *
   * ★ 与臂 1 同一条纪律（`entities.ts` 记着上一版把夹具假卡点写进真台账的事故）。
   */
  assert.equal(
    mainCount(), mainBefore,
    '★ 夹具调用不得往【主树那份团队真台账】里加东西 —— 那是不可重算的记录，'
    + `污染之后与真卡点同形。实测 ${mainBefore} ⇒ ${mainCount()}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 11（★ best-effort 臂）：台账写不下去 ⇒ 拒绝**一字不变**，而"记不下"要出声
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 11（best-effort 臂）：台账写盘失败不许改变拒绝本身（措辞一字不变），且要留下一条 warn', async () => {
  /**
   * ── 契约原话（第二个半边）──────────────────────────────────────────────────────
   *
   * 「`recordFriction` 是 best-effort：**写盘失败不许改变拒绝本身**（拒绝措辞一字不变）」
   *
   * ★ 做法：把 `frictions` 从**目录**换成一个**文件** ⇒ `recordFriction` 里那句
   *   `mkdir(frictionDir, { recursive: true })` 必然失败（`EEXIST` / `ENOTDIR`）
   *   ⇒ 它 catch 住、返回 `undefined`（**记不下 ≠ 没有卡点**）。
   *
   * ── ★★ 为什么这条臂必须【两样都读】────────────────────────────────────────────
   *
   *   ① 拒绝措辞与"台账正常时"**逐字相同** —— 这一条证明记录**不改裁决**；
   *   ② 那句 "could not record the friction at the dispatch gate" 的 warn **真的出现**
   *      —— 缺 ② 的话，「写盘没失败」与「失败了而没人说」在读数上**同形**
   *      （本队记账里最久的那条：**"没有"与"没能读出来"必须不同形**）。
   *
   * ★ 而"措辞一字不变"这条断言必须有**对照读数**（两次调用的原文），不能只断言
   *   "它 throw 了" —— 一个"写台账失败就换一句话拒绝"的实现也满足后者。
   */
  const f = fixture()
  const call = await dispatchTeam(f)
  const base = {
    description: 'a task whose plan has not been reviewed',
    kind: 'work',
    assignee: 'worker',
    objective: 'o',
    acceptance: ['x'],
    verify: ['node --test scripts/suite.test.mjs'],
  }

  /** ① 台账**正常**时的拒绝原文 —— 这是下面要比对的对照读数。 */
  const healthy = await createTaskVia(call, { ...base, subject: 'healthy' })
  assert.match(
    String(healthy), /^create_task rejected: \[dispatch\.plan-reviewed\]/,
    `★ 前置：对照那一次必须是一条**真拒绝**（否则比的是两次别的什么）。实测：${String(healthy).slice(0, 200)}`,
  )
  await settle()
  assert.equal(
    frictionRecords(f.stateRoot).length, 1,
    '★ 前置：台账正常时，这条拒绝必须真的记下了一条（否则下面那半测的是"它从来就不记"）。',
  )

  /** ② 把台账落点弄坏：`frictions` 从目录换成文件。 */
  rmSync(join(f.stateRoot, 'frictions'), { recursive: true, force: true })
  writeFileSync(join(f.stateRoot, 'frictions'), 'not a directory\n')
  const warningsBefore = f.warnings.length

  const broken = await createTaskVia(call, { ...base, subject: 'broken' })
  await settle()

  assert.equal(
    broken, healthy,
    '★★ best-effort：台账写不下去时，拒绝措辞必须**一字不变** —— 记录是旁路动作，'
    + ' 它不许把一次判据拒绝变成另一次拒绝（也不许把它变成成功）。'
    + `\n  台账正常时：${String(healthy).slice(0, 400)}\n  台账坏掉时：${String(broken).slice(0, 400)}`,
  )
  assert.ok(
    f.warnings.slice(warningsBefore).some((line) => line.includes('could not record the friction at the dispatch gate')),
    '★ 而"记不下"必须**说出来**（一条 warn）—— 否则「写盘没失败」与「失败了而没人说」同形。'
    + ` 实测新增的 warn：${JSON.stringify(f.warnings.slice(warningsBefore))}`,
  )
  assert.equal(
    readFileSync(join(f.stateRoot, 'frictions'), 'utf8'), 'not a directory\n',
    '★ 而它确实没有写成功（那个占位的文件还在，没被换成目录）。',
  )
  assert.equal(
    statSync(join(f.stateRoot, 'frictions')).isDirectory(), false,
    '★ 台账落点仍然**不是**一个目录 ⇒ 这一轮一条都没落盘（"记不下"与"没有卡点"'
    + ' 在文件系统上同形 —— 这正是为什么它必须留一条 warn 才能分辨）。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10（★★★ 定向突变臂）：把新加的记账去掉 ⇒ 臂 9 必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 10（★ 定向突变臂）：去掉新加的那处记账 ⇒ 那条守门臂必须红（逐条实测）', async () => {
  /**
   * ── 为什么要有这一条（契约的第二个验收）─────────────────────────────────────────
   *
   * 「★ 新臂真的会红：把新加的 `recordFriction` 注释掉，这条臂必须失败（反向实测）」
   *
   * ★ 而"我声称它会长红"是一个**关于动作的猜想**（`PENDING-FRICTION-REFORM.md` §6 经验 F：
   *   「动作发生了」与「事实建立了」不同形，只有后者可测）。
   * ⇒ 所以这里不猜：**当场施加突变、当场跑、当场读回**臂 9 的裁决。
   *
   * ── 它怎么做（不碰 `src/`，也不碰盘上的 `lib/`）────────────────────────────────
   *
   * 与臂 8 同一套做法：在**临时目录**里造一份 `lib/` 的真副本，只改 `create_task`
   * 的产物那一格，然后**在子进程里**跑臂 9。
   *
   * ★★ 突变的形态：把 `void recordFriction({ … })` 的**被调函数**换成一个空实现
   *   （`(async () => undefined)`）—— 这与"把那一句注释掉"**行为等价**
   *   （调用点在、而不记账），且它让这个突变体仍然是**一棵可加载的树**
   *   （注释掉整段多行表达式需要自己配对括号，那会让突变本身变成一个手写解析器）。
   */
  const libRoot = fileURLToPath(new URL('../lib', import.meta.url))
  const target = join(libRoot, 'tools', 'create-task.js')
  const source = readFileSync(target, 'utf8')
  const callExpr = 'void recordFriction({'
  assert.ok(
    source.includes(callExpr),
    '★ 突变臂前置：要在**产物**里找到新加的那处记账（找不到就不能声称"施加了突变"）',
  )
  assert.equal(
    source.split(callExpr).length - 1, 1,
    '★ 突变臂前置：`create_task` 的产物里这条记账必须**只有一处**（多一处说明定位不准，'
    + '那样"臂红了"就不能归因于那一处）',
  )
  const mutated = source.replace(callExpr, 'void (async () => undefined)({')
  assert.notEqual(mutated, source, '★ 突变臂前置：突变体必须与原文不同')

  const dir = mkdtempSync(join(tmpdir(), 'friction-dispatch-mutant-'))
  try {
    const mutantLib = join(dir, 'lib')
    cpSync(libRoot, mutantLib, { recursive: true })
    const mutantScripts = join(dir, 'scripts')
    mkdirSync(join(mutantScripts, 'fixtures'), { recursive: true })
    writeFileSync(
      join(mutantScripts, 'gate-friction-capture.test.mjs'),
      readFileSync(new URL('gate-friction-capture.test.mjs', import.meta.url), 'utf8'),
      'utf8',
    )
    cpSync(
      join(fileURLToPath(new URL('../scripts', import.meta.url)), 'fixtures'),
      join(mutantScripts, 'fixtures'),
      { recursive: true },
    )
    /** ★ `src/` 里的 JSON 表是夹具相对仓库根读的（与臂 8 同一个理由）。 */
    cpSync(fileURLToPath(new URL('../src', import.meta.url)), join(dir, 'src'), { recursive: true })
    /**
     * ★ `node_modules` 只放**一条软链**：副本树在系统临时目录里，Node 逐级向上
     *   永远走不到本仓的 `node_modules` ⇒ 不加它，子进程根本起不来。
     *   （为什么软链这一格是安全的、而软链 `lib/` 里的每个文件**不**安全，
     *     见臂 8 那段实测：`lib/` 必须是**真文件**，否则被加载的不是被突变的那一份。）
     */
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(dir, 'node_modules'))

    /**
     * ★ 只跑**臂 9**（`--test-name-pattern`）：本臂要读的是**那一条**的裁决，
     *   不是整份文件的（整份里别的臂是绿的，那会盖住这个读数）。
     *   ★ 模式里带上"守门臂"三个字，是为了不误伤本臂自己的名字（它提到"那条守门臂"）。
     */
    const run = () => {
      const result = spawnSync(
        'node',
        ['--test', '--test-reporter=tap', '--test-name-pattern=臂 9（★ 守门臂）', 'scripts/gate-friction-capture.test.mjs'],
        { cwd: dir, encoding: 'utf8', env: recursionFreeEnv(process.env), maxBuffer: 32 * 1024 * 1024 },
      )
      return {
        code: typeof result.status === 'number' ? result.status : -1,
        out: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      }
    }

    /** ── 读数 ①（对照）：**未突变**的副本树上，臂 9 必须是绿的 ──────────────────── */
    writeFileSync(join(mutantLib, 'tools', 'create-task.js'), source, 'utf8')
    const control = run()
    assert.match(
      control.out, /臂 9（★ 守门臂）/,
      '★ 突变臂前置：子进程必须**真的跑到**臂 9（模式没匹配上会让"没跑"与"跑绿了"同形）。'
      + ` 实测输出尾部：\n${control.out.slice(-1200)}`,
    )
    assert.equal(
      control.code, 0,
      '★ 突变臂前置：**未突变**的副本树上臂 9 必须是绿的 —— 否则本臂分不清"突变造成的红"'
      + ` 与"副本树本来就是坏的"。实测输出尾部：\n${control.out.slice(-2000)}`,
    )

    /** ── 读数 ②（交付读数）：施加突变 ⇒ 臂 9 **必须**红 ─────────────────────────── */
    writeFileSync(join(mutantLib, 'tools', 'create-task.js'), mutated, 'utf8')
    const mutant = run()
    assert.notEqual(
      mutant.code, 0,
      '★★★ 交付读数：把新加的那处记账去掉之后，臂 9 **必须失败** —— 若它照样绿，'
      + ' 说明臂 9 对"记账没了"这件事**没有分辨力**（那正是 d231f74 能静默 5 天的原因）。'
      + ` 实测 exit=${mutant.code}\n${mutant.out.slice(-2000)}`,
    )
    assert.match(
      mutant.out, /台账|dispatch 判据拒绝/,
      '★★ 而突变造成的红必须落在**关于台账的那些断言**上，而不是一个加载期崩溃'
      + ' （后者也会让 exit≠0 ⇒ 两者在退出码上同形）。'
      + ` 实测输出尾部：\n${mutant.out.slice(-2000)}`,
    )
    assert.doesNotMatch(
      mutant.out, /ERR_MODULE_NOT_FOUND|SyntaxError|Cannot find package/,
      '★★ 反向半边：这个红**不许**是副本树自身的坏法（加载失败 / 找不到包）——'
      + ` 那与"突变被逮住"不同形。实测输出尾部：\n${mutant.out.slice(-1500)}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
