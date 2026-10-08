/**
 * ── completion 位置的接线（t70：从 update-task.ts 拆出）─────────────────────────────
 *
 * ── ★★ 为什么拆 ────────────────────────────────────────────────────────────────
 *
 * `update-task.ts`（1120 行）装着 contract / dispatch / completion **三个插入点**，
 * 而它今晚**连续挡住了 5 条任务** ⇒ 每一次都让另一条任务**必须等**。
 * 本模块是其中**最大**的一段：**271 行**（含基准、覆盖输入、以及那一份最长的 ctx）。
 *
 * ── ★★★ 而搬运必须【逐字】───────────────────────────────────────────────────────
 *
 * `scripts/gate-update-task-injections.test.mjs` 把拆前的 **17 格注入**
 * （字段名 + **右侧表达式**）抽成清单，逐条断言它们仍在对的位置、且**右侧逐字相同**。
 *
 * ★ 而那条护栏**第一次实战就抓到了本文件的第一版**：我在搬运 dispatch 那一段时
 *   顺手把 `changedPaths: input.changedPaths` 改成了 `[...input.changedPaths]`。
 *   ⇒ 形态与两次真实事故（t39 / 并入 t54）**不同、后果同族**：
 *     **丢的不是格名，而是格的右侧。**
 *
 * ── ★★ 正确的做法：让【搬运的单元保持逐字】，把差异挤到边界上 ────────────────────
 *
 *   ⇒ 入参在入口处**拆成与原来同名的局部量**（`const task = input.task` …），
 *     于是下面这 271 行**一个字都不用改**。
 *   ★ 而不是"让这一大段去适应新的环境" —— 那样一定会改动段内的东西，
 *     而改动段内就是那条护栏要抓的事。
 *
 * ── ★ 而"段"的边界是【数出来的】，不是看着像哪儿断了就在哪儿断 ──────────────────
 *
 *   MEASURED（我第一版）：我以为这一段只是 `const completionContext = { … }`
 *   （172 行），而编译当场告诉我 `baseline` / `coverageInput` / `wantsCompleted`
 *   也在段内 —— 它们就在 ctx 之前（第 627-707 行）。
 *   ⇒ ★ 真正的边界是 **271 行**：从 `baselineExit`（基准）到 `completionGates`（求值）。
 *     **一个段不是"那个对象字面量"，而是"为那个对象准备输入的全部"。**
 */

import { inputSurfaceOf, deriveCoverageInput, deriveScanDirs } from '../shared/entities.ts'
import { resolveBaseRevision, readWorkspaceFileSync, runVerifyCommand, runVerifyCommandCaptured, writeWorkspaceFileSync, loadVerifyCommandRules, runInDetachedRevision } from '../shared/entities.ts'
import { TERMINAL_TASK_STATUSES, type ReviewVerdict } from '../../types.ts'
import type { GateEvaluation } from '../../gates/registry.ts'
import { parseKnownBaselineFailures } from '../../gates/completion/backtest.ts'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * ── ★★★ t92：这一格是 t70 的拆分【丢掉】的那条接线（t76 的修复）───────────────────
 *
 * MEASURED（逐符号核对）：`parseKnownBaselineFailures` 在拆分前于
 * `src/tools/update-task.ts` 出现 3 次，拆分后在整个调用方面 **0 次**
 * （而判据侧仍在 `backtest.ts` 里）。
 * ⇒ 于是「判据在，而调用方不再喂它」—— 那与 t41/t83 是同一族。
 *
 * ★ 而它丢得**不留痕迹**：`gate-backtest-baseline` 的臂 12 一直在指名测它，
 *   而那条红被读成了"夹具读旧位置" ⇒ 真回退与"读错位置"在失败清单里同形。
 *
 * ★ 与 `loadKindRequirementsSync` 同形：每次调用都读盘，不缓存 ——
 *   改那张 pin 立刻生效，不需要重跑构建。
 * ★ 而读不到时【返回 undefined 而不是空数组】—— 因为「清单缺席」与
 *   「清单恰好覆盖了全部失败」必须不同形（判据的第三态靠这个区分）。
 */
function loadKnownBaselineFailures(): ReturnType<typeof parseKnownBaselineFailures> | undefined {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '..', '..', 'scripts', 'fixtures', 'baseline-known-failures.json'),
    join(process.cwd(), 'scripts', 'fixtures', 'baseline-known-failures.json'),
  ]
  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(readFileSync(candidate, 'utf8')) as { knownFailures?: unknown }
      return parseKnownBaselineFailures(raw.knownFailures)
    } catch {
      continue
    }
  }
  /** ★ 读不到 ⇒ **缺席**（不是"没有已知失败"）⇒ 判据落回第三态"无法归因"。 */
  return undefined
}

/** completion 位置需要的、来自调用方的输入（★ 名字与拆前同形，见文件头）。 */
export interface CompletionWiringInput {
  args: any
  changedLines: any
  loadKindRequirementsSync: () => any
  resolveBaseRevision: typeof resolveBaseRevision
  acceptanceResults: any
  changedFiles: any
  commandsRun: any
  discriminatingFiles: any
  findings: any
  gate: any
  input: any
  killerSuiteFiles: any
  newTestFiles: any
  observedTestFiles: any
  repairEvidence: any
  task: any
  worktreeBase: any
  /** 判据注册表（注入进来，而不是本模块去取单例）。 */
  registry: { evaluate: (point: 'completion', ctx: unknown) => Promise<GateEvaluation> }
  /** 工作区根。 */
  workspace: string
  deriveScanDirs: typeof deriveScanDirs
}

export interface CompletionWiringResult {
  context: unknown
  inputSurface: unknown
  gates: GateEvaluation
  /** ★ 段内算出、而**段外还要用**的那一格（`followUpMessage` 的调用点读它）。 */
  wantsCompleted: boolean
}

/**
 * 构造 completion 位置的 ctx、核对它、求值。
 *
 * ★ **逐字搬运**：下面这 271 行与拆前完全相同（唯一差别是"这些东西从哪来"）。
 */
export async function wireCompletion(raw: CompletionWiringInput): Promise<CompletionWiringResult> {
  /**
   * ★★ 入口处**拆成与原来同名的局部量** —— 于是下面一整段一个字都不用改。
   *   而这就是"让搬运的单元保持逐字，把差异挤到边界上"那条做法的落点：
   *   ★ **差异住在入口这 15 行里，而不是散在 271 行中间。**
   */
  const acceptanceResults = raw.acceptanceResults
  const changedFiles = raw.changedFiles
  const commandsRun = raw.commandsRun
  const discriminatingFiles = raw.discriminatingFiles
  const findings = raw.findings
  const gate = raw.gate
  const input = raw.input
  const killerSuiteFiles = raw.killerSuiteFiles
  const newTestFiles = raw.newTestFiles
  const observedTestFiles = raw.observedTestFiles
  const repairEvidence = raw.repairEvidence
  const task = raw.task
  const worktreeBase = raw.worktreeBase
  const workspace = raw.workspace
  const registry = raw.registry
  const args = raw.args
  const changedLines = raw.changedLines
  const loadKindRequirementsSync = raw.loadKindRequirementsSync

/**
 * 基准 = 【在父版本上跑一遍任务的 verify 命令】的退出码。
 *
 * 不注入（返回 undefined）的两种情形，都保持"没测到"：
 *   · 任务没有声明 verify ⇒ 没有可跑的东西（回测的 L1 前置要求基准先绿）；
 *   · 跑不起来（工作区不是 git 仓库、版本取不到…）⇒ 不能拿 0 充数。
 */
const baselineExit = async (revision: string): Promise<number | undefined> => {
  const commands = task.verify ?? []
  if (commands.length === 0) return undefined
  /**
   * ★ 基准 = 在【父版本】上跑一遍本任务的 verify 命令。
   *
   * 有一个必须说清的前提：本任务【新增的测试】在父版本上本来就是红的
   * （否则 R5 会说它是装饰性测试）。所以把整套命令原样搬到父版本上跑，
   * 基准必然不绿 ⇒ 回测说"无法归因、这红不是这次改动的错" ——
   * **那是判据在正确地工作**，不是缺陷。
   *
   * ⇒ 基准要问的是另一个问题：「在这次改动【之前】，这套测试是绿的吗」。
   *   也就是把命令里【本次新增的测试文件】剔掉，跑【改动前就存在的那部分】。
   *   两者是不同的问句：
   *     R5      ：新测试在父版本上红吗？      （它在不在证明什么）
   *     回测 L1 ：改动之前这里本来就是绿的吗？（红了能不能归因）
   *   把它们混成一条命令，两条判据就会互相打架 —— 而"打架"的表现是
   *   一个**永远无法归因**的基准，读起来像基础设施坏了。
   *
   * ★ 剔掉的只有【本次新增的测试】（`newTestFiles`）—— 既有的测试一条不少，
   *   也不去猜"哪些测试相关"。
   */
  const added = new Set<string>(newTestFiles ?? [])
  const withoutNewTests = (commands as string[])
    .map((command: string) => command.split(/\s+/).filter((token: string) => !added.has(token)).join(' '))
    .map((command: string) => command.trim())
    .filter((command: string) => command !== '')
  if (withoutNewTests.length === 0) return undefined
  const results = await Promise.all(withoutNewTests.map(async (command) => (
    runInDetachedRevision({ workspace, revision, command })
  )))
  if (results.some((code) => code === undefined)) return undefined
  // 基准取【最坏的一条】：任何一条在父版本上不绿 ⇒ 基准就不是绿的，
  // 而"基准不绿"时回测的正确结论是"无法归因"（判据自己会说）。
  return Math.max(...(results as number[]))
}
/**
 * ★ 基准的【声称】与它的【证据】必须分清：
 *   · label 有了（父版本 hash 可追溯，供人工追溯）；
 *   · exitCode 必须来自【真的在父版本上跑过一次】—— 见下面的 `baselineExit`。
 *   拿不到就跑不出退出码 ⇒ 保持 `undefined`：判据会说"基准没有退出码，
 *   所以它区分不了『绿』与『没测』"。**绝不能**在这里填一个 0 充数 ——
 *   那正是把"没测到"伪装成"基准是绿的"。
 */
/**
 * ── ★★ 父版本从哪来（t18）───────────────────────────────────────────────────
 *
 * 此前只有 `worktreeBase`（内存 Map）一个来源 ⇒ 无 worktree 的任务恒拿不到
 * ⇒ 回测恒 unmeasured ⇒ **这类任务永远无法收口**。
 *
 * ⇒ 现在走 {@link resolveBaseRevision} 的三段解析：内存 → 落盘 → 明确说"没有"。
 *   ★ 而"没有"的**两种成因各自可读**（`no-worktree` / `not-recorded`）——
 *     它们与"我跑了但基准不绿"是**三件不同的事**，读日志的人必须分得开。
 */
const baseResolution = resolveBaseRevision(task)
const baseline = baseResolution.kind === 'absent'
  ? undefined
  : { label: baseResolution.revision, exitCode: await baselineExit(baseResolution.revision) }
/**
 * ★ 把"父版本是哪种情形"作为**结构化读数**交出去（与 `input_surface` 同一条
 *   纪律：读得出来才算数）。
 *   ★ 三态，互不同形：
 *     · `resolved`（来源可读：memory / record）⇒ 有父版本，比较有基础；
 *     · `absent.no-worktree`                 ⇒ 这类任务本就没有父版本；
 *     · `absent.not-recorded`                ⇒ 本该有而丢了（要去看一眼）。
 *   ★ 只在**缺席**时挂这个字段：有父版本时它没有信息量，而"总是出现"会让
 *     三态里最该被看见的那两种淹没在噪音里。
 */
const baselineProvenance = baseResolution.kind === 'absent'
  ? { baseline_absent: baseResolution.reason }
  : {}
/**
 * ★ 回测的依赖图 / 覆盖数据。与跑测试一样是 I/O，所以在这一层做；
 *   拿不到就【不注入】⇒ 判据说"没有依赖图数据"（不是"选了 0 条"）。
 */
const coverageInput = await deriveCoverageInput({
  workspace,
  testFiles: observedTestFiles ?? [],
  knownTests: observedTestFiles ?? [],
})
const wantsCompleted = args.status === 'completed'
/**
 * ── ★ 输入面：这是**最长的一份 ctx**，也是历史缺陷最集中的一格 ────────────
 *
 * 上一轮五次同形缺陷里，`inScope 缺席` / `verify 缺席` / `执行器缺席` 三次
 * 都落在本调用点上（本队实测记录）—— 判据照常跑、照常说"我没能测量"，
 * 而那在日志里与"这一步没问题"同形。
 *
 * ⇒ 核对必须在**求值之前**、对着**同一份** ctx：所以下面把 ctx 提成一个
 *   具名常量，核对与求值**共用它**。写两份字面量之后，任何一次只改一处的
 *   编辑都会让核对结果变成关于**另一份 ctx** 的结论 —— 而它读起来完全正常。
 */
const completionContext = {
  task,
  update: {
    status: args.status,
    output: args.output,
    verdict: args.verdict as ReviewVerdict | undefined,
    findings,
    changedPaths: input.changedPaths,
    acceptanceResults,
    commandsRun,
    ...discriminatingFiles === undefined ? {} : { newTestFiles: discriminatingFiles },
  },
  wantsCompleted,
  taskNotTerminal: !TERMINAL_TASK_STATUSES.includes(task.status),
  execVerifyCommand: (command: string): Promise<number> => runVerifyCommand(workspace, command),
  /**
   * ── ★★★ t53：规则表**每次调用时读**（"改数据 ⇒ 立刻生效"的成立条件）──
   *
   * ★ 不缓存：缓存会让"改数据"在下一次**进程重启**前不生效 ——
   *   而那正是本任务要消灭的东西（改它读的东西不该需要换进程）。
   * ★ 也不在构建时内联（静态 import 会被 tsc 嵌进 lib/ ⇒ 改数据仍要 build）。
   */
  loadRules: () => loadVerifyCommandRules(workspace),
  /**
   * ── ★★★ t54：kind 需求表 —— 与上面那一格**并列同形**─────────────────────
   *
   * ★ 同一条路：数据在 `src/gates/completion/kind-requirements.json`，
   *   一格注入，调用方**每次求值时读盘**。
   *
   * ★ 而它与上面那格有一处**刻意的差别：这里是同步的**。
   *   理由：kind 守卫住在 `appliesTo` 里，而 registry 的契约要求
   *   `appliesTo(context) => boolean` **同步**返回。
   *   ⇒ `verify-command` 的 `appliesTo` 不读表（它只在 `gate()` 里读），
   *     所以它那格可以异步；本判据没有那个余地。
   *
   * ★ 读的是 `readFileSync`（表只有几百字节），**每次读、不缓存** ——
   *   "不缓存"这一条与上面那格逐字一致：缓存会让"改表"在下一次进程重启前不生效。
   */
  loadKindRequirements: () => loadKindRequirementsSync(),
  // ── r5：父版本 + 扫描范围 + 在指定版本上跑一条测试的执行器
  ...worktreeBase === undefined ? {} : { parentRevision: worktreeBase },
  ...worktreeBase === undefined ? {} : { worktreePath: workspace },
  scanDirs: deriveScanDirs(changedFiles),
  /**
   * ★ 在【父版本 / 修复版本】上跑一条测试。
   *
   * 实现要点（每一条都是踩出来的）：
   *   · 成员的工作区通常是**脏的**（它刚改了文件）⇒ `git checkout` 会拒绝。
   *     所以用 `git worktree` 临时检出一个干净副本去跑，而不是在原地切换 ——
   *     原地切换既会因脏工作区失败，也可能把成员的改动弄丢。
   *   · 跑完必须把临时检出删掉（finally），否则每次完成都漏一个目录。
   *   · 拿不到整数退出码 ⇒ `exitCode: undefined` ⇒ 判据 unmeasured。
   *     **绝不**把跑不起来当成 0（"没测到"不得并进"通过"）。
   */
  runTestOnRevision: async (test: string, revision: string) => {
    /**
     * ★ `'working-tree'` 是 R5 约定的【修复版本】哨兵值 —— 表示"成员现在
     *   交出来的那份树"，而它**不是**一个 git 引用（`git worktree add`
     *   对它必然失败）。这是判据与调用方之间的一个约定，不是笔误。
     *   ⇒ 它跑在【工作区本身】上；只有父版本才需要检出到一个干净副本。
     */
    if (revision === 'working-tree') {
      return { exitCode: await runVerifyCommand(workspace, `node --test ${test}`) }
    }
    const exitCode = await runInDetachedRevision({
      workspace, revision, command: `node --test ${test}`,
    })
    return exitCode === undefined ? {} : { exitCode }
  },
  // ── mutation：三个执行器 + 只变异改动行
  readFile: (path: string): string => readWorkspaceFileSync(workspace, path),
  writeFile: (path: string, contents: string): void => writeWorkspaceFileSync(workspace, path, contents),
  /**
   * ★ 变异判据的 runTest 必须交回【输出】，不只是退出码：
   *   杀伤率 = 被杀的变异体 / 全部变异体，而"某次运行里有几条测试失败"只能从
   *   输出里读出来（判据用 parseTestSummary 解析 `ℹ pass N` / `# pass N`）。
   *   只给退出码 ⇒ 判据会说"套件没报告可读的摘要"⇒ unmeasured。
   */
  runTest: async (command: string) => await runVerifyCommandCaptured(workspace, command),
  ...changedLines === undefined ? {} : { changedLines },
  changedFiles,
  /**
   * ★ 杀手套件：变异判据【要求显式声明】，没有回退（见 mutation.ts 文件头
   *   —— 一个没被声明的套件会让"存活者"变成关于探针的事实，而不是关于测试
   *   的事实）。
   *
   * 这里声明的来源是【会话事件观察到的测试文件】—— 与 newTestFiles 同源，
   * 但语义不同、不能合并：
   *     newTestFiles  = 本次【新增】的测试（R5 拿它跑红前绿后）
   *     killerSuites  = 拿哪些测试去杀变异体（既有的测试也算）
   * 把后者写成前者，"这次没新增测试"就会变成"没有杀手套件"⇒ unmeasured。
   *
   * ★ 观察不到 ⇒ 不注入 ⇒ 判据 unmeasured。**不猜、不回退到全套。**
   *
   * ── ★★★ t67：t54 之后这条供给链【接错了插座】─────────────────────────
   *
   * MEASURED（t67 复现，与 t54 的核实一致）：
   *
   *   `discriminatingFiles → newTestFiles` 这条链的**唯一消费者是 r5**；
   *   而 kind 需求表（`kind-requirements.json`）说 **repair 不要求 r5**
   *   ⇒ 那条证据在 repair 上**没人读**。
   *
   * ★ 而 mutation 读的是 `killerSuites` —— 它此前的**唯一**来源是
   *   `observedTestFiles`（**会话事件**）。于是 f-0020 那个形状里：
   *
   *     会话观察缺席（= f-0020 的成因）
   *       ⇒ observedTestFiles === undefined ⇒ killerSuites 不注入
   *       ⇒ mutation 拿不到任何杀手套件 ⇒ unmeasured
   *     而**同一时刻**，repairEvidence 从**任务契约**读出了那份夹具
   *       ⇒ discriminatingFiles 非空 ⇒ 喂给 newTestFiles ⇒ **没人读**
   *
   *   ⇒ ★ 证据落在没人读的那一格，而**该读它的那一格**空着。
   *     这不是"松了一根线"，是**线接错了插座**。
   *
   * ── 而需求表自己写着该接哪一格 ────────────────────────────────────────
   *
   * `kind-requirements.json` 的 repair 一节逐字写着：
   *
   *     "Mutation stays because it is what proves the discriminating
   *      fixture really discriminates"
   *
   *   ⇒ ★ 设计意图早就说了：**证明那份夹具真的能判别**是 mutation 的活。
   *     而它当时拿不到那份证据 ⇒ 表说的是 A，接线接的是 B。
   *
   * ── 修法：把两条来源**并起来**喂给 killerSuites ────────────────────────
   *
   *   `observedTestFiles`（会话观察到的测试写入）
   *   ∪ `repairEvidence.evidence`（契约里改动过的既有夹具）
   *
   * ★ 为什么是【并】而不是【换成后者】：
   *   · 只用后者 ⇒ implementation 类的既有行为变了（它有真新增的测试，
   *     而 `repairEvidenceFiles` 也收 changedPaths 里的测试 —— 两者本可互补）；
   *   · 只用前者 ⇒ 就是今天这个缺陷（f-0020 形状下它恒空）。
   *   ⇒ 并集让"会话看得到"与"契约里写着"**各自**都能单独成立。
   *
   * ★★ 而"没有套件"这一支**必须仍然存在**：两边都空 ⇒ 不注入 ⇒
   *   mutation 照旧 unmeasured（**不猜、不回退到全套**）。
   *   那一条纪律一个字没动 —— 本修法只是**多给了它一个真实的来源**。
   */
  ...killerSuiteFiles === undefined
    ? {}
    : { killerSuites: killerSuiteFiles.map((file: string) => ({ id: file, files: [file] })) },
  testCommand: 'node --test *',
  // ── backtest：基准 + 覆盖证据 + 两个执行器
  ...baseline === undefined ? {} : { baseline },
  /**
   * ── ★★★ t92：这两格是 t70 的拆分丢掉的（t76 与 t83 的修复）─────────────────────
   *
   * ★ 判据侧完整（`backtest.gate()` 会读它们），而**往这两格塞东西的是调用方** ——
   *   而那正是被搬没了的地方。⇒ 「判据在，而调用方不再喂它」。
   *
   * ★ 而两者的形状与既有先例逐条同形：
   *   · `knownBaselineFailures` ⇒ **只在有值时挂**（`undefined` 与 `[]` 不同形：
   *      前者是"清单缺席"，后者是"清单说没有已知失败"）
   *   · `baselineAbsent`        ⇒ **只在缺席时挂** —— 有父版本时它没有信息量，
   *      而"总是出现"会让三态里最该被看见的那两种淹没在噪音里
   */
  ...(() => {
    const known = loadKnownBaselineFailures()
    return known === undefined ? {} : { knownBaselineFailures: known }
  })(),
  ...baseResolution.kind === 'absent' ? { baselineAbsent: baseResolution.reason } : {},
  ...coverageInput === undefined ? {} : { coverage: coverageInput },
  /**
   * ★ 回测的执行器收的是【一个标签】，不是一条 shell 命令：
   *   `'full'`（全量）与选测标签。它们的能力是"跑整套测试"，而**整套测试
   *   是哪些**由本层决定（判据不知道本仓库的测试怎么跑，那是调用方的知识）。
   *   ⇒ 直接把标签丢给 sh 会得到 127（command not found），而那会被读成
   *     "全量红了 ⇒ 这次改动弄坏了东西" —— 一次基础设施工况伪装成关于代码的结论。
   *
   * ★ 全量 = 任务声明的 verify 命令（那正是"本任务认为什么算全量"）。
   *   跑不起来 ⇒ 127（非零）⇒ 判据按"全量红"处理并拒绝。
   *   **不把跑不起来伪装成绿。**
   */
  execBacktestCommand: async (): Promise<number> => {
    const commands = task.verify ?? []
    if (commands.length === 0) return 127
    const codes = await Promise.all(commands.map((command: string) => runVerifyCommand(workspace, command)))
    return Math.max(...codes)
  },
  execSelectedCommand: async (): Promise<number> => {
    const commands = task.verify ?? []
    if (commands.length === 0) return 127
    const codes = await Promise.all(commands.map((command: string) => runVerifyCommand(workspace, command)))
    return Math.max(...codes)
  },
}
const completionInputSurface = inputSurfaceOf('completion', completionContext)
const completionGates = await registry.evaluate('completion', completionContext)
  return { context: completionContext, inputSurface: completionInputSurface, gates: completionGates, wantsCompleted }
}
