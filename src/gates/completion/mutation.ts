/**
 * ── 判据：变异测试（交付的测试真的在测吗）──────────────────────────────────────
 *
 * 插入点：`completion`（成员汇报完成时）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（外部借鉴项目的一轮真实交付，本仓库本轮把它作为机制迁过来）：
 * 一个任务加了 25KB 的测试文件、全套绿、审查也过了 —— 而把 `||` 翻成 `&&` 之后
 * 【一条红的都没有】（杀伤率 33.3%）。套件是装饰性的，而它在日志里与"做完了"
 * 完全同形。`completion.verify-rerun` 与 `dispatch.changed-paths` 都堵不住它：
 * 那两条问的是"命令真跑了吗""文件真是你动的吗"，本条问的是【改坏代码，测试会不会红】。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：本文件不 import 任何 I/O。调用方把观察注入进来
 *    （读文件、跑套件、应用/还原变异体、读 git 改动行）；缺席时 `unmeasured`。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 *
 * ── ★ 本判据最重要的一条：区分「测试没覆盖」与「探针够不到」───────────────
 *
 * 「存活变异体」这个数字有两个来源，而它们在输出里【长得一模一样】：
 *
 *     ① 测试没覆盖到那个分支        → 关于【测试】的信号 ⇒ blocked
 *     ② 杀手套件根本够不到被变异文件 → 关于【测量】的信号 ⇒ unmeasured
 *
 * MEASURED（外部借鉴项目 RUN-009）：评分器变异 `bin/workbench-loop.mjs`，却拿
 * `test/escalation.test.mjs` 当杀手套件 —— 而那个文件里 grep 该模块名 = 0。
 * 后果：该文件每一个变异体都【必然】存活。读起来是"测试不够"，事实是"探针指错了"。
 * 该形态在那个项目里已经犯过【九次】。
 *
 * ⇒ 本判据把它变成一条硬规则：**每一个候选套件都够不到被变异文件 ⇒ unmeasured，
 *   绝不记成"全存活"**。
 *
 * ── 另一条：只对【改动行范围】变异（--lines 语义）────────────────────────────
 *
 * 全文件变异会把无关区域算进分母，从而【扭曲分数】（分母里混进一堆没人碰过的行）。
 * 所以改动行范围是【必填】的：拿不到 git 证据时不是退回全文件，而是 unmeasured。
 * 这条同样适用于 L3 的契约违反体 —— 定义里的锚点必须落在这个范围内。
 */

import { ok, blocked, unmeasured, type GateVerdict } from '../registry.ts'
/**
 * ★ t54：从**非判据**的纯模块拿（不是从 `./r5.ts`）——
 *   判据之间不许互相 import（`verify-gates-integration` ④ 的显式 allowlist），
 *   而那条约束防的正是"一条判据调另一条"。
 *   ★ 本文件与 r5 是**兄弟**，不是它的用户。
 */
import { gateRequirementFor, loadKindRequirementsOfHost, type KindRequirementsLoad } from './kind-requirements.ts'
import type { CtxPaths } from '../requires.ts'
import {
  classifyRun,
  generateMutants,
  loadInvariants,
  noScorableMutants,
  parseTestSummary,
  probeReach,
  scoreMutants,
  verifyAnchors,
  type InvariantDefinition,
  type Mutant,
  type MutantOutcome,
  type MutantResult,
  type MutantRun,
  type MutationOperator,
  type MutationReport,
  type SuiteTarget,
} from '../../mutation.ts'

export const id = 'completion.mutation'
export const point = 'completion'
export const description =
  '对【改动行范围】注入 L1/L2/L3 变异体并重跑杀手套件：变异体存活即拒绝（防止装饰性测试）；套件够不到被变异文件 ⇒ unmeasured'

/**
 * ── 输入面声明（t4）───────────────────────────────────────────────────────────
 *
 * ★ 本条在上一轮【真的缺过输入】，而且缺的正是它自己写在文件头里的那三样：
 *
 *   MEASURED（本轮开工前的复盘）：`readFile` / `runTest` / `writeFile` 三个执行器
 *   曾经没接上。`gate()` 把它们拼成一条 `unmeasured`："mutation testing is
 *   unavailable (no runTest / writeFile injected), so whether the delivered tests
 *   detect a broken implementation could not be measured" —— 而 `unmeasured`
 *   在日志里与 `ok` 同形。**装饰性测试就这样溜过去了**，因为那条判据压根没跑。
 *
 * ★ 三格与 `gate()` 里那个 `missing` 数组逐条对齐（声明与未测量臂必须一致）：
 *   判据自己算一遍 `missing`、核对层再按声明算一遍 —— 两份清单说的是同一件事，
 *   而声明把这件事提前到了**求值之前**（不必先跑一遍才知道没执行器）。
 *
 * ★ `changedLines` 是【git 证据】，与 `changedFiles` 不同形，两者都要声明：
 *   · `changedFiles` 缺席 ⇒ "this task declared no changed files"；
 *   · `changedLines` 缺席 ⇒ "the changed-line ranges … could not be established
 *     (no git evidence)"。
 *   后者是 R1（`--lines` 语义）的入口：拿不到 git 证据时**不是**退回全文件，
 *   而是 unmeasured。这正是那次缺口里最容易看漏的一格 —— 它看起来像"一个可选的
 *   优化参数"，实际是判据正确性的前提（全文件变异会扭曲分母）。
 *
 * ★ `killerSuites` 也声明：空缺 ⇒ "no killer suite was declared for these changed
 *   files, so survivors would be a fact about the probe rather than about the
 *   tests" —— 这是本条判据存在的核心理由（探针够不到 ≠ 测试不够）。
 *
 * ★ 不声明的：`operators` / `invariants` / `minKillRate` / `mirrors` / `maxMutants`
 *   等**有缺省值**的调参位。它们缺席时判据照常测量（用默认算子、默认镜像、
 *   默认阈值），不是"没测成"。★ 这正是"声明"与"把 ctx 里每个字段都列一遍"的
 *   分界线：**声明的是"这一格缺席 ⇒ 判据说不出话"的那些格**。多列会制造噪音，
 *   而噪音会教人忽略核对 —— 与漏列同样有害。
 */
export const requires: CtxPaths<MutationContext>[] = [
  'readFile',
  'runTest',
  'writeFile',
  'changedLines',
  'killerSuites',
  'task.kind',
  'wantsCompleted',
  'taskNotTerminal',
]

/** 默认的"装饰性"界线。杀伤率低于它 ⇒ 说清有多少条存活、覆盖范围是什么。 */
export const DEFAULT_MIN_KILL_RATE = 0.6

/** 镜像：改 `src/x.ts` 的源码，`lib/x.js` 是与它同源的编译产物，必须一起改。 */
export interface MutationMirror {
  readonly sourcePath: string
  readonly mirrorPath: string
}

export interface MutationContext {
  /**
   * ── ★★★ kind 需求表的**运行时**来源（t54）─────────────────────────────────────
   *
   * ★ 与 t53 的 `loadRules`、以及 r5 的同一格**并列同形**：全仓只有**一种**
   *   "数据怎么被读到"的写法（数据在 src/gates/…/*.json + 一格注入 + 调用方每次读盘）。
   * ★ **同步**：`appliesTo` 是同步契约，而 kind 守卫就住在那里。
   */
  loadKindRequirements?: () => KindRequirementsLoad
  task?: { id?: string; kind?: string; verify?: string[]; changedPaths?: string[] }
  update?: { status?: string; changedPaths?: string[] }
  wantsCompleted?: boolean
  taskNotTerminal?: boolean

  /** 本次改动的文件（workspace 相对）。缺省回退到 update/task 的 changedPaths。 */
  changedFiles?: readonly string[]

  /**
   * ★ 只变异【改动行范围】。缺省时回退到与 changedFiles 配套的 `changedLines`。
   *   `undefined` 与 `[]` 必须不同形：
   *     undefined ⇒ 没能拿到 git 证据 ⇒ unmeasured（**不是**退回全文件）
   *     []        ⇒ 拿到了证据，且没有一行可变异 ⇒ 同样 unmeasured，但原因不同
   */
  changedLines?: readonly number[]

  /** 读一个文件（workspace 相对）。缺省 ⇒ unmeasured。 */
  readFile?: (path: string) => string
  /** 跑一遍测试命令。缺省 ⇒ unmeasured。 */
  runTest?: (command: string) => Promise<MutantRun>
  /**
   * 读一个杀手套件的文本，用于【探针射程】判定。
   *
   * ★ 与 `readFile` 分开是因为路径空间不同：`readFile` 收 workspace 相对路径，
   *   套件路径来自命令模板（可能是绝对路径）。缺省时回退到 `readFile`。
   */
  readSuite?: (path: string) => string
  /** 就地写一个文件（应用变异体）。缺省 ⇒ unmeasured。 */
  writeFile?: (path: string, contents: string) => void | Promise<void>
  /** 命令模板：`*` 会被替换成杀手套件路径列表。 */
  testCommand?: string
  /** 杀手套件候选（显式声明 —— 没有回退，见 probeReach）。 */
  killerSuites?: readonly SuiteTarget[]
  /** 为什么是这些套件（审计用；不参与裁决）。 */
  killerSuitesReason?: string
  /** L3 契约违反体的定义。 */
  invariants?: readonly InvariantDefinition[]
  /** 覆盖的镜像（源码 ↔ 编译产物），默认：改了 src/**\/*.ts ⇒ 也改 lib/**\/*.js。 */
  mirrors?: readonly MutationMirror[]
  operators?: readonly MutationOperator[]
  minKillRate?: number
  /** L3 的锚点越界是否算错。默认 true —— 落在改动范围外就是"变异了无关区域"。 */
  enforceL3Range?: boolean
  maxMutants?: number
  /** 语料 = 这条判据覆盖到的文件，被交出去给下游读。 */
  corpus?: readonly string[]
}

/** 一条 L3 定义，连带它声明的 expect_red —— 判据要把后者接进观察。 */
interface MutantPlan {
  mutant: Mutant
  file: string
  /** 这条变异体的原始文本（还原用）。 */
  originalText: string
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

/**
 * 只对【本次试图置为 completed】的【非终态】【写文件类】任务生效。
 *
 * ★ 三个条件的由来，与 `completion.verify-rerun` 同源且每条都有实测依据：
 *   · 非 completed 的中间状态没有裁决要复核；
 *   · 任务【已是终态】是在追加署名证据（issue159），不是一次新的完成裁决 ——
 *     而变异测试会重跑套件、会改文件，用它重新审判历史结论是错的；
 *   · 没有实现/修复类改动 ⇒ 没有可变异的东西（review/requirements 本就不写 changedPaths）。
 */
export function appliesTo(ctx: MutationContext | undefined): boolean {
  /**
   * ── ★★★ kind 守卫从【硬编码】改成【问表】（t54）───────────────────────────────
   *
   * ★ 此前写死 `kind !== 'implementation' && kind !== 'repair'` ⇒ 而 `TASK_KINDS`
   *   有 7 个 ⇒ 5 个 kind **完全没有完工门**（实测 29% 的任务）。
   *   ★ 而那不是设计，是**默认**：门只认两个 kind，其余的它**不说话**。
   *
   * ★ 三态各有去处：`required` ⇒ 生效；`not-required` ⇒ 按**有理由的决定**闭嘴；
   *   `unknown` ⇒ 仍不说话，但 `gate()` 会报 `unmeasured`（不静默通过）。
   */
  const requirement = gateRequirementFor(loadKindRequirementsOfHost(ctx), ctx?.task?.kind, id)
  if (requirement.status !== 'required') return false
  return ctx?.wantsCompleted === true && ctx?.taskNotTerminal === true
}

export async function gate(ctx: MutationContext): Promise<GateVerdict> {
  /**
   * ── ★★★ 表不可用 ⇒ **不静默通过**（t54）───────────────────────────────────────
   *
   * ★ `appliesTo` 在表不可用时返回 `false`（门不说话），而那是**没能测量** ——
   *   它与"这个 kind 有理由地不要求这条门"在读数上**完全同形**。
   * ⇒ 所以在开火处再问一次表，让两者分得开（与 r5 逐字同一口径）。
   */
  const kindRequirement = gateRequirementFor(loadKindRequirementsOfHost(ctx), ctx?.task?.kind, id)
  if (kindRequirement.status === 'unknown') {
    return unmeasured(
      `Mutation could not tell whether this task needs it (kind=${ctx?.task?.kind ?? 'unspecified'}): ${kindRequirement.why ?? 'the kind-requirements table could not be consulted'}. `
      + `"the table could not be consulted" is NOT "this kind does not need Mutation"`,
    )
  }
  const readFileMaybe = ctx?.readFile
  const runTestMaybe = ctx?.runTest
  const writeFileMaybe = ctx?.writeFile

  /**
   * ★ 注入口径：三种能力缺任何一个都 ⇒ `unmeasured`，不是 `ok`。
   *   一个不能注入变异体的判据如果返回 ok，就是"装上了但从不生效"。
   */
  const missing = [
    typeof readFileMaybe === 'function' ? null : 'readFile',
    typeof runTestMaybe === 'function' ? null : 'runTest',
    typeof writeFileMaybe === 'function' ? null : 'writeFile',
  ].filter((item): item is string => item !== null)
  if (missing.length > 0) {
    return unmeasured(
      `mutation testing is unavailable (no ${missing.join(' / ')} injected), so whether the delivered tests detect a broken implementation could not be measured`,
    )
  }
  /** ★ 收窄：上面已证明三者都是函数。执行器永远由调用方注入，判据自己不做 I/O。 */
  const readFile: (path: string) => string = readFileMaybe as (path: string) => string
  const runTest: (command: string) => Promise<MutantRun> = runTestMaybe as (command: string) => Promise<MutantRun>
  const writeFile: (path: string, contents: string) => void | Promise<void> = writeFileMaybe as (
    path: string,
    contents: string,
  ) => void | Promise<void>

  const declaredFiles = unique([
    ...(ctx.changedFiles ?? []),
    ...(ctx.update?.changedPaths ?? []),
    ...(ctx.task?.changedPaths ?? []),
  ])

  if (declaredFiles.length === 0) {
    return unmeasured('this task declared no changed files, so there is nothing to mutate and no range to restrict the measurement to')
  }

  const changedLines = ctx.changedLines
  if (changedLines === undefined) {
    return unmeasured(
      `the changed-line ranges for ${declaredFiles.length} file(s) could not be established (no git evidence), and whole-file mutation would count unrelated regions in the denominator and distort the score — so the kill rate is not measured`,
    )
  }

  const ranges = toRanges(changedLines)
  if (ranges.length === 0) {
    return unmeasured(
      `the change touched ${declaredFiles.length} file(s) but no mutable line could be located, so this measurement has nothing to say (this is NOT "fully covered")`,
    )
  }

  const suites = ctx.killerSuites ?? []
  if (suites.length === 0) {
    return unmeasured(
      'no killer suite was declared for these changed files, so survivors would be a fact about the probe rather than about the tests (this is not "everything survived")',
    )
  }

  const commandTemplate = ctx.testCommand ?? 'node --test *'
  const mirrorMap = ctx.mirrors ?? defaultMirrors(declaredFiles)

  /** 逐文件收集：读不到文件 ⇒ 一次性 unmeasured（不是"这个文件没有变异体"）。 */
  const texts = new Map<string, string>()
  const unreadable: string[] = []
  for (const file of declaredFiles) {
    try {
      texts.set(file, readFile(file))
    } catch (error) {
      unreadable.push(`${file} (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  if (unreadable.length === declaredFiles.length) {
    return unmeasured(`none of the ${declaredFiles.length} changed file(s) could be read: ${unreadable.join('; ')}`)
  }

  const corpus = ctx.corpus === undefined ? declaredFiles : unique([...ctx.corpus, ...declaredFiles])

  /**
   * ★ 基线：套件本来就红 ⇒ 任何变异体都会"红"，那不能归功于变异体。
   *   与 `runMutationEngine` 同一条规则，这里显式跑一次是为了让 blocked/unmeasured
   *   的措辞落在判据层（调用的命令要能出现在报告里）。
   */
  const suiteFiles = unique(suites.flatMap((suite) => suite.files))
  const command = commandTemplate.replace('*', suiteFiles.join(' '))
  let baseline: MutantRun
  try {
    baseline = await runTest(command)
  } catch (error) {
    return unmeasured(`running the killer suite raised: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (baseline.timedOut === true) {
    return unmeasured(`the killer suite hung (${command}); a hang is neither red nor green and must not be scored either way`)
  }
  const baselineSummary = parseTestSummary(`${baseline.stdout ?? ''}\n${baseline.stderr ?? ''}`)
  if (baselineSummary.total === null) {
    return unmeasured(
      `the killer suite did not report a readable summary (exitCode ${baseline.exitCode}), so the kill rate could not be computed`,
    )
  }
  if (baselineSummary.fail !== 0 || baseline.exitCode !== 0) {
    return unmeasured(
      `the killer suite is not green before mutation (fail=${baselineSummary.fail}, exit=${baseline.exitCode}); measuring what a red suite detects is meaningless`,
    )
  }

  /** L3 定义与锚点：坏定义【不静默跳过】—— 那会报出一份并不存在的 L3 覆盖。 */
  const { mutants: l3, errors: invariantErrors } = loadInvariants(ctx.invariants ?? [])
  const anchorProblems = verifyAnchors(l3, (path) => readFile(path))
  if (invariantErrors.length > 0 || anchorProblems.length > 0) {
    return unmeasured(
      `the L3 contract-violation declarations are not usable (${[...invariantErrors, ...anchorProblems].join('; ')}), and silently skipping them would claim L3 coverage that does not exist`,
    )
  }

  /**
   * ★ R1：L3 的锚点必须落在【改动行范围】内。落在外面就是在变异无关区域 ——
   *   与"全文件变异"是同一个错误，只是换了个入口。
   *   用的是同一个 range 集合，指针指向的正是范围覆盖的那个文件。
   */
  const enforceL3Range = ctx.enforceL3Range !== false
  if (enforceL3Range) {
    const strays = l3.filter((mutant) => {
      const text = texts.get(mutant.file ?? '')
      if (text === undefined) return true
      const index = text.indexOf(mutant.find)
      if (index === -1) return true
      return !inAnyRange(lineOfIn(text, index), ranges)
    })
    if (strays.length > 0) {
      return unmeasured(
        `L3 contract-violation anchor(s) ${strays.map((m) => m.id).join(', ')} do not lie inside the changed-line ranges, so applying them would mutate regions this task never touched`,
      )
    }
  }

  /** 组装全部变异体（含镜像），逐条应用 → 跑套件 → 还原。 */
  const plans: MutantPlan[] = []
  for (const file of declaredFiles) {
    const text = texts.get(file)
    if (text === undefined) continue
    const lineCount = text.split('\n').length
    /**
     * ★ 只按【改动行集合】变异，不做包络展开。
     *
     *   `changedLines` 是 git 给的【离散行号】。把它折成一个 `startLine..endLine`
     *   的包络再变异，就等于把两个孤立改动之间的整段没碰过的代码也放进分母 ——
     *   这正是 R1（`--lines` 语义）要防的那个失真，只是换了个入口。
     *
     *   MEASURED（本任务的夹具臂 1b 抓到）：`changedLines=[1,40]` 折成包络 1-40 后，
     *   算子层只看到"第 1 行与第 40 行"两处（toRanges 的相邻合并语义），
     *   结果一条变异体都生不出来，报告说"没有可变异的东西"。
     *   只有当【连续区间】真的连续时，包络才等于集合本身。
     */
    const effective = changedLines.filter((line) => line >= 1 && line <= lineCount)
    if (effective.length === 0) continue
    const generated = generateMutants(text, {
      startLine: Math.min(...effective),
      endLine: Math.max(...effective),
      changedLines: effective,
      file,
      ...(ctx.operators === undefined ? {} : { operators: ctx.operators }),
    })
    for (const mutant of generated) {
      plans.push({ mutant, file, originalText: text })
      for (const mirror of mirrorMap) {
        if (mirror.sourcePath !== file) continue
        const mirrorText = texts.get(mirror.mirrorPath) ?? tryRead(readFile, mirror.mirrorPath)
        if (mirrorText === undefined) continue
        texts.set(mirror.mirrorPath, mirrorText)
        const mirrorMutant = applyToMirror(mirrorText, mutant)
        if (mirrorMutant === undefined) continue
        plans.push({
          mutant: { ...mirrorMutant, id: `${mirrorMutant.id}+mirror:${mirror.mirrorPath}`, file: mirror.mirrorPath },
          file: mirror.mirrorPath,
          originalText: mirrorText,
        })
      }
    }
  }
  for (const mutant of l3) {
    const file = mutant.file ?? ''
    const text = texts.get(file) ?? tryRead(readFile, file)
    if (text === undefined) continue
    texts.set(file, text)
    plans.push({ mutant, file, originalText: text })
  }

  if (plans.length === 0) {
    return unmeasured(noScorableMutants({ file: declaredFiles.join(', '), startLine: ranges[0]!.startLine, endLine: ranges[ranges.length - 1]!.endLine }))
  }

  const results: MutantResult[] = []
  for (const plan of plans) {
    const mutatedText = plan.mutant.mutated ?? spliceOnce(plan.originalText, plan.mutant.find, plan.mutant.replace)
    try {
      await writeFile(plan.file, mutatedText)
    } catch (error) {
      results.push({
        mutant: plan.mutant,
        outcome: 'error' as const,
        reason: `applying the mutant raised: ${error instanceof Error ? error.message : String(error)}`,
        killedBy: [],
      })
      continue
    }
    let observed: { outcome: MutantOutcome; reason: string; killedBy: string[] }
    let restoreProblem: string | null = null
    try {
      const run = await runTest(command)
      observed = classifyRun(run, plan.mutant)
    } catch (error) {
      observed = {
        outcome: 'error',
        reason: `running the killer suite raised: ${error instanceof Error ? error.message : String(error)}`,
        killedBy: [],
      }
    } finally {
      /** ★ 还原必须被【验证】：把原文写回去并读回来比对。一次没还原的测量不可信。 */
      try {
        await writeFile(plan.file, plan.originalText)
        const readBack = readFile(plan.file)
        if (readBack !== plan.originalText) restoreProblem = `${plan.file} did not read back byte-identical after restore`
      } catch (error) {
        restoreProblem = `restoring ${plan.file} raised: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    if (restoreProblem !== null) {
      results.push({ mutant: plan.mutant, outcome: 'error', reason: `restore FAILED: ${restoreProblem}`, killedBy: [] })
      continue
    }
    results.push({ mutant: plan.mutant, outcome: observed.outcome, reason: observed.reason, killedBy: observed.killedBy })
  }

  /**
   * ★ 探针射程：逐文件问一次"声明的套件够不够得到它"。
   *   够不到 ⇒ 那份文件的每一个存活体都是【必然】的 ⇒ 整份报告 unmeasured。
   *   这是本判据存在的核心理由，且它必须在 scorer 之前被判定。
   *
   * ★ 读套件用 `readSuite`（可以为空），不借用 `readFile`：两者的路径空间不同 ——
   *   `readFile` 收的是【workspace 相对路径】，而杀手套件是从命令模板里来的
   *   【路径列表】（可能是绝对路径）。混用会让一次 ENOENT 被读成"套件够不到"，
   *   也就是把一次读取失败伪装成一条关于覆盖的结论 —— 这正是探针射程要防的形态。
   */
  const readSuite = ctx.readSuite ?? ((path: string) => readFile(path))
  const unreachable: string[] = []
  for (const file of unique(plans.map((plan) => plan.file))) {
    const reach = probeReach({ file }, suites, readSuite)
    if (reach.files.length === 0) unreachable.push(`${file}: ${reach.reason}`)
  }

  const report: MutationReport = scoreMutants({
    target: { file: declaredFiles.join(', '), startLine: ranges[0]!.startLine, endLine: ranges[ranges.length - 1]!.endLine },
    results,
    probeProblem: unreachable.length > 0 ? unreachable.join(' | ') : null,
  })

  if (report.disposition === 'unmeasured') {
    return unmeasured(report.unmeasured ?? 'the mutation run produced no interpretable result')
  }

  const threshold = ctx.minKillRate ?? DEFAULT_MIN_KILL_RATE
  const scope =
    `coverage: ${report.coverage.file} lines ${report.coverage.startLine}-${report.coverage.endLine} ` +
    `(${report.coverage.linesMutated} line(s) in range, ${report.totals.considered} mutant(s) considered, ${report.totals.scored} scored)`

  /**
   * ★ 装饰性测试 ⇒ blocked，且必须【报出存活数与覆盖范围】。
   *   只报一个分数是不够的：读日志的人要能看见"哪几条活着、在哪一行"。
   */
  if (report.mutationScore !== null && report.mutationScore < threshold) {
    const survivors = report.survivingMutants
      .slice(0, 8)
      .map((mutant) => `${mutant.id}${mutant.file === null ? '' : ` in ${mutant.file}`}${mutant.oftenEquivalent ? ' (often-equivalent, still scored)' : ''}`)
    return blocked([
      `the delivered tests are decorative on the lines this task changed: mutation score ${report.mutationScore} < ${threshold} ` +
        `(${report.totals.survived}/${report.totals.scored} mutant(s) survived${report.totals.equivalent > 0 ? `, ${report.totals.equivalent} tagged as often-equivalent but still counted` : ''})`,
      ...survivors.map((survivor) => `survivor: ${survivor}`),
      report.survivingMutants.length > survivors.length ? `...and ${report.survivingMutants.length - survivors.length} more survivor(s)` : '',
      scope,
    ].filter((item) => item !== ''))
  }

  return {
    ok: true,
    mutationReport: report,
    mutationScore: report.mutationScore,
    killed: report.totals.killed,
    survived: report.totals.survived,
    corpus: [...corpus],
    scope,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 小工具（纯函数，无 I/O）
// ─────────────────────────────────────────────────────────────────────────────

/** 把一串行号折成尽量少的连续区间。 */
export function toRanges(lines: readonly number[]): Array<{ startLine: number; endLine: number }> {
  const sorted = [...new Set(lines.filter((line) => Number.isSafeInteger(line) && line > 0))].sort((a, b) => a - b)
  const ranges: Array<{ startLine: number; endLine: number }> = []
  for (const line of sorted) {
    const last = ranges[ranges.length - 1]
    if (last !== undefined && line === last.endLine + 1) last.endLine = line
    else ranges.push({ startLine: line, endLine: line })
  }
  return ranges
}

function inAnyRange(line: number, ranges: ReadonlyArray<{ startLine: number; endLine: number }>): boolean {
  return ranges.some((range) => line >= range.startLine && line <= range.endLine)
}

/**
 * ★ 这里【没有】rangeFor：包络展开是 R1 的失效形态本身。
 *   一次改动落在第 10 行与第 400 行时，包络 10-400 会把 390 行没人碰过的代码
 *   放进分母。改动行集合必须原样传到算子层（见上面的 `effective`）。
 */

function lineOfIn(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1
  return line
}

function spliceOnce(text: string, find: string, replace: string): string {
  const index = text.indexOf(find)
  if (index === -1) return text
  return text.slice(0, index) + replace + text.slice(index + find.length)
}

function tryRead(readFile: (path: string) => string, path: string): string | undefined {
  try {
    return readFile(path)
  } catch {
    return undefined
  }
}

/** 编译产物镜像：`src/x.ts` ⇒ `lib/x.js`。仅对 src 下的 TS 生效。 */
export function defaultMirrors(files: readonly string[]): MutationMirror[] {
  const mirrors: MutationMirror[] = []
  for (const file of files) {
    if (!file.startsWith('src/') || !file.endsWith('.ts')) continue
    mirrors.push({ sourcePath: file, mirrorPath: `lib/${file.slice('src/'.length, -'.ts'.length)}.js` })
  }
  return mirrors
}

/** 把一条变异体套到镜像文本上。原文匹配不上 ⇒ 返回 undefined（产物过期）。 */
function applyToMirror(mirrorText: string, mutant: Mutant): Mutant | undefined {
  const find = mutant.find.trim() === mutant.find ? mutant.find : mutant.find
  const index = mirrorText.indexOf(find)
  if (index === -1) return undefined
  const line = lineOfIn(mirrorText, index)
  return {
    ...mutant,
    line,
    mutated: mirrorText.slice(0, index) + mutant.replace + mirrorText.slice(index + find.length),
  }
}
