/**
 * ── 判据：回测 —— 证明这次改动【没把别的地方改坏】──────────────────────────────
 *
 * 插入点：`completion`（成员汇报完成时）
 * id     ：`completion.backtest`
 *
 * ── 它回答的不是"测试过没过"，而是"改动有没有被抓住" ───────────────────────────
 *
 * MEASURED（本轮立项依据，Meta PTS）：把测试选择放进变更级回测，成本减半，
 * 仍抓住 >99.9% 有缺陷的改动。⇒ 衡量单位是【改动被抓住了吗】，
 * 不是"每个测试有没有通过" —— 后者会把人骗去修一堆与本次改动无关的红灯。
 *
 * ── 三态：这条判据存在的全部理由是「不能归因」必须说得出口 ──────────────────────
 *
 *   ok         ：基准绿 + 选测跑完且绿（+ 全量跑完且绿，若给了全量执行器）
 *   blocked    ：测出来了 —— 基准红（无法归因）/ 选测把改动抓住了 / 全量回归
 *   unmeasured ：没测成 —— 拿不到基准状态 / 缺选测或全量的执行器
 *
 * ★ `unmeasured` 绝不允许并进 `ok`：拿不到基准状态时返回 ok，就等于
 *   "装上了但从不生效"，而它比没装更坏 —— 它会让人以为回测跑过了。
 *
 * ── ★ L1 前置：基准不绿 ⇒ 拒绝，且理由必须是【无法归因】────────────────────────
 *
 * 这一条是整条判据的支点。基准版本（父版本 / HEAD）不绿时：
 *
 *     红灯 = 本来就坏（与我无关）  ┐
 *     红灯 = 我改坏的              ┘ 这两件事【在观察上同形】
 *
 * 同形 ⇒ 抓不到改动【不等于】改动是干净的；也【不等于】改动有问题。
 * 此时若放行（ok），一次真实回归可以躲在"本来就坏"后面上线；
 * 此时若按"你改坏了"拒绝，成员会被任意归罪，而且它无法自证（它并没有改坏）。
 * ⇒ 唯一的诚实裁决是拒绝，并把理由写成 **attribution is impossible**，
 *   附上基准自己的失败，而不是把它算在这次改动头上（blocker 里明写
 *   "not the change's fault"）。
 *
 * ── ★ L2 选测：来源必须写在数据里，盲区必须报出来 ──────────────────────────────
 *
 * 选测 = 改动文件 → 依赖图的【传递】依赖者 → 覆盖它们的测试。
 *
 * 判据不读文件、不 import I/O：依赖图与"测试覆盖了谁"都由调用方注入
 * （`coverage`），判据只做纯数据变换。这是契约 §2 的硬要求，也让
 * "选测器藏起自己的近似性"这件事变得不可能：判据【不采信】选测器自报的
 * selection，它只采信 coverage，然后自己去问「覆盖这个改动文件的测试
 * 有没有全部被选中」。没被选中的那些就是【盲区】。
 *
 * 三种来源必须【不同形】，因为它们给结论的信度不同：
 *     'dependency-graph'  依赖图（本判据接受的那种）
 *     'runner-declared'   跑测试的框架自报的关联（近似黑箱）
 *     'unknown'           来源不明的选择
 * ⇒ 后两种 ⇒ `unmeasured`：一个隐藏自身近似性的选择器，正是回归上线的路径。
 *   拿一个看不见的选择器去下"没把别处改坏"的结论，是把没测到并进通过。
 *
 * ── 谁能成为"没被选中的测试"（★ 只有 coverage 说得准）─────────────────────────
 *
 * 「依赖者是测试」这件事有两种说法，只有一种算数：
 *   · `coverage` 里【明确列出】该文件的测试      ⇒ 算（这是被测量到的）
 *   · 测试文件的【路径长得像测试】              ⇒ 不算（这是猜的）
 * 后者会把一个明明覆盖了改动文件、只是名字不像测试的测试（`spec/…`、
 * `integration/…`、`*.mjs` 夹具）悄悄漏掉。漏掉一个盲区，就是把一个已知盲区
 * 变成一个未知盲区 —— 所以本判据【不猜】：名字不像测试不是漏选，是"它压根
 * 不在覆盖集里"，而覆盖集里没有它这件事本身会被 `testsWithNoCoverageData`
 * 报出来（见下）。
 *
 * ── 全量：范围必须来自数据，不能靠"执行器记得跑全量" ───────────────────────────
 *
 * 选测是近似（它按定义会漏掉测试，这正是上面要报盲区的原因），
 * 所以回测以【全量】收口。但"执行器就是跑了全量"是一个无法核验的声明 ——
 * ⇒ 全量的执行结果必须带上 `scope`，且必须覆盖所有已知测试；否则 `unmeasured`。
 * 于是"只跑了 3 个测试却说全量绿"与"真的全量绿"不同形。
 */

import { ok, blocked, unmeasured, type GateVerdict } from '../registry.ts'
import type { CtxPaths } from '../requires.ts'

export const id = 'completion.backtest'
export const point = 'completion'
export const description =
  '按依赖图选测并跑全量，证明改动没把别处改坏；基准不绿或选测来源不明即拒绝/未测量（不能归因时绝不放行）'

/**
 * ── 输入面声明（t4）───────────────────────────────────────────────────────────
 *
 * ★ 本条在上一轮【真的缺过输入】，缺的是 `baseline` / `coverage` / 两个执行器，
 *   而四种缺口的症状全是 `unmeasured` —— 与 `ok` 在日志里同形：
 *
 *   · `baseline` 缺席 ⇒ "the baseline state is unavailable"
 *   · `coverage` 缺席 ⇒ "no dependency graph / coverage data was provided"
 *   · `execBacktestCommand` 缺席 ⇒ "no full-suite executor was injected"
 *   · `execSelectedCommand` 缺席 ⇒ 只在真跑选测时才显形（见下面 §两个执行器不同形）
 *   ⇒ 一条**从未回测过任何东西**的判据，读起来是"回测通过了"。
 *
 * ★ `baseline` 不是"一个字段"，而是【父/HEAD 上的测试结果】——它的缺席不是
 *   "少了个参数"，是"这次改动没有基准可比"。判据的措辞说的正是这件事
 *   （"a regression could not be told apart from a pre-existing failure"）。
 *   所以它是**第一格必须声明的东西**：没有它，这条判据的核心结论（归因）
 *   根本无从谈起。同理 `coverage` 是【依赖图数据】，不是"可选的分析输入"。
 *
 * ── ★ 两个执行器必须分开声明（它们不同形）─────────────────────────────────────
 *
 * `execSelectedCommand` 与 `execBacktestCommand` **不是同一个开关的两半**：
 *
 *   · `execBacktestCommand` ⇒ 全量的执行器。它缺席是**无条件的失败**
 *     （"no full-suite executor was injected" ⇒ unmeasured，且这次裁决里
 *     没有任何一条测试被跑过）。
 *   · `execSelectedCommand` ⇒ 只在 `coverage.command !== undefined` 时才被用到。
 *     它是**有条件的**：判据刻意允许"不跑选测"（"没给 ⇒ 不假装跑过"），
 *     那时它缺席是**正常**的。
 *
 *   ⇒ 合成一格会让核对层在"本来就不该跑选测"的那些 ctx 上报一条假的缺口 ——
 *     而本队已经定过：**不适用不报**，噪音与误报同样有害。
 *
 * ★ MEASURED（本任务的臂 A 抓到的）：`execSelectedCommand` **不进声明**。
 *   第一版把它写进了数组，臂 A 立刻红：一份完全正常的 ctx（不跑选测 ⇒ 没有
 *   `coverage.command`）被核对报成 `incomplete`，而判据自己在同一份 ctx 上
 *   诚实地返回 `ok`。**核对层报了一个判据根本不认的缺口** —— 那不是"更严"，
 *   那是噪音，而噪音会教人把核对整体忽略（与漏报同样有害）。
 *
 *   ⇒ 判据自己就是这条口径的唯一权威：`execSelectedCommand` 缺席**不必然**
 *     使判据说不出话（`coverage.command === undefined` 时它压根不被调用），
 *     所以它不是"缺席 ⇒ 判据沉默"的那一类，**不属于输入面**。
 *     同理 `coverage.command` 也不声明：它是"要不要跑选测"的开关，缺席是正常的。
 *
 *   ★ 这正是"声明的是**哪几格缺席 ⇒ 判据说不出话**"那条分界线的第二次应用：
 *     第一次是 `operators` 那些有默认值的调参位（见 mutation），
 *     这一次是**有条件**的注入面。两次都是同一个问题：
 *     "这一格在不在声明里"由"它缺席时判据还能不能说话"回答，不由"它看起来重不重要"回答。
 *
 * ★ `changedPaths` 与 `update.changedPaths` 都声明：`appliesTo` 读的是这两格的
 *   **或**（`Array.isArray(fromUpdate) ? fromUpdate : fromCtx`），而 `gate()`
 *   读的也是这两格的或。两处口径必须一致 —— 只声明其中一格，会让"闸门说适用、
 *   声明说缺"这种自相矛盾的核对结论出现。
 */
export const requires: CtxPaths<BacktestContext>[] = [
  'baseline',
  'coverage',
  'coverage.source',
  'coverage.knownTests',
  'coverage.selected',
  'execBacktestCommand',
  'changedPaths',
]

/** 跑一次命令，返回退出码。与 `completion.verify-rerun` 同一个注入形状。 */
export type ExecCommand = (command: string) => Promise<number>

export interface BacktestContext {
  task?: { id?: string; kind?: string; inScope?: string[] }
  update?: { changedPaths?: string[] }
  /** ★ 本次改动涉及的文件（workspace 相对）。空数组 = 没声明，判据据此 unmeasured。 */
  changedPaths?: string[]

  /** 基准版本上的测试结果。缺席 ⇒ unmeasured（"没测到"不是"通过"）。 */
  baseline?: BaselineState
  /** 修复/候选版本上跑【全量】测试：`(command) => exitCode`。 */
  execBacktestCommand?: ExecCommand
  /** 跑【选测】的那条命令：`(command) => exitCode`。 */
  execSelectedCommand?: ExecCommand

  /**
   * 依赖图与覆盖率。★ 缺任一项 ⇒ unmeasured：没有它们，"选测没把改动抓住"
   * 这个结论无从谈起（无数据的空集会让判据看起来通过）。
   */
  coverage?: CoverageInput
}

interface BaselineState {
  /** 基准版本（父版本 / HEAD，例如 worktree 的 `base`）上的全量测试退出码。 */
  exitCode?: number
  /** 那个版本的可读标识（hash / 标签）。★ 交回调用方做落盘与人工追溯。 */
  label?: string
  failedTests?: string[]
}

interface CoverageInput {
  /**
   * ★ 选测的来源。只有 `'dependency-graph'` 是判据接受的那种；
   *   其余（含未声明）⇒ unmeasured（见文件头：隐藏自身近似性的选择器）。
   */
  source?: 'dependency-graph' | 'runner-declared' | 'unknown'
  /** 依赖图的【传递】依赖者：文件 → 依赖它的文件（含传递闭包）。 */
  dependents?: Record<string, string[]>
  /** 哪个测试覆盖了哪个文件：文件 → 覆盖它的测试。 */
  coverage?: Record<string, string[]>
  /** 本仓库【已知的全部测试】。全量与盲区都以它为全集。 */
  knownTests?: string[]
  /** 本次选测实际跑了哪些测试。 */
  selected?: string[]
  /** 选测用的命令（交回调用方，便于把结果落盘）。 */
  command?: string
}

/** `appliesTo` 关心的字段：只知道形状，不依赖具体类型。 */
type BacktestAppliesContext = { changedPaths?: unknown; update?: { changedPaths?: unknown } } | undefined

/**
 * 只对【声明了改动文件】的【实现/修复】任务生效。
 *
 * ★ 两个条件的由来与 `dispatch.changed-paths` 同源：
 *   · 没声明 changedPaths ⇒ 没有"哪些文件变了"这个输入，回测无从选测
 *     （它会诚实地说 unmeasured，但那是在每一类任务上都刷一条噪音）；
 *   · 只有 implementation/repair 的契约要求 changedPaths。
 */
export function appliesTo(ctx: BacktestAppliesContext): boolean {
  const fromUpdate = ctx?.update?.changedPaths
  const fromCtx = ctx?.changedPaths
  const paths = Array.isArray(fromUpdate) ? fromUpdate : fromCtx
  return Array.isArray(paths) && paths.length > 0
}

/** 把可能带 `./` 前缀、反斜杠、尾斜杠的路径规整成同一个可比较的形状。 */
export function normalizePathToken(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}
const norm = normalizePathToken

/** 读一个映射里某个 key 的值；规整后再查，避免 `./src/a.ts` 与 `src/a.ts` 不同形。 */
function lookup(map: Record<string, string[]> | undefined, path: string): string[] {
  if (map === undefined || map === null || typeof map !== 'object') return []
  const direct = map[path]
  if (Array.isArray(direct)) return direct.map(String)
  const wanted = norm(path)
  for (const key of Object.keys(map)) {
    if (norm(key) === wanted) {
      const value = map[key]
      return Array.isArray(value) ? value.map(String) : []
    }
  }
  return []
}

/** 依赖图的传递闭包（BFS + 已访问集合 ⇒ 环也终止）。★ 直接依赖者不算数。 */
function transitiveDependents(dependents: Record<string, string[]> | undefined, seeds: string[]): Set<string> {
  const seen = new Set<string>()
  const queue: string[] = []
  for (const seed of seeds) {
    for (const direct of lookup(dependents, seed)) {
      const key = norm(direct)
      if (!seen.has(key)) {
        seen.add(key)
        queue.push(direct)
      }
    }
  }
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const next of lookup(dependents, current)) {
      const key = norm(next)
      if (!seen.has(key)) {
        seen.add(key)
        queue.push(next)
      }
    }
  }
  return seen
}

/** 一个集合减去另一个集合，结果保持【输入顺序】稳定（日志可复现）。 */
function difference(items: readonly string[], exclude: Set<string>): string[] {
  const out: string[] = []
  const emitted = new Set<string>()
  for (const item of items) {
    const key = norm(item)
    if (exclude.has(key) || emitted.has(key)) continue
    emitted.add(key)
    out.push(item)
  }
  return out
}

/** 把测试集合规整成一个可比较的集合（名字统一成 norm 形状）。 */
function asSet(tests: readonly string[]): Set<string> {
  return new Set(tests.map((test) => norm(test)))
}

/**
 * 跑一条命令并把三态区分开：
 *   执行器抛错 / 非整数 ⇒ `unmeasured`（基础设施故障不是关于工作的结论）；
 *   否则 ⇒ exitCode（0 才算绿）。
 *
 * ★ 与 `completion.verify-rerun` 共用同一条纪律：把"我没能跑它"与
 *   "它跑了并且失败"并成一类，会让一次环境故障伪装成一个关于改动的结论。
 */
async function runCommand(
  exec: unknown,
  command: string,
  what: string,
): Promise<{ kind: 'exit'; exitCode: number } | { kind: 'unmeasured'; reason: string }> {
  if (typeof exec !== 'function') {
    return {
      kind: 'unmeasured',
      reason: `the ${what} suite could not be executed (no executor was injected), so the change's blast radius could not be measured`,
    }
  }
  let exitCode: unknown
  try {
    exitCode = await (exec as ExecCommand)(command)
  } catch (error) {
    return { kind: 'unmeasured', reason: `running the ${what} suite ("${command}") raised: ${String((error as Error | undefined)?.message)}` }
  }
  if (!Number.isSafeInteger(exitCode)) {
    return { kind: 'unmeasured', reason: `running the ${what} suite ("${command}") returned a non-integer exit code: ${JSON.stringify(exitCode)}` }
  }
  return { kind: 'exit', exitCode: exitCode as number }
}

export async function gate(ctx: BacktestContext): Promise<GateVerdict> {
  const changed = (Array.isArray(ctx?.changedPaths) ? ctx.changedPaths : ctx?.update?.changedPaths) ?? []

  /**
   * ★ 没有"改了哪些文件"⇒ 选测无从谈起 ⇒ unmeasured。
   *   空数组在这里是【输入缺席】的写法，不是"没改任何文件"——
   *   后者不存在（一次完成裁决至少改了一样东西，否则没有回测的对象）。
   */
  if (!Array.isArray(changed) || changed.length === 0) {
    return unmeasured(
      'the backtest has no change set to regress: the update declared no changedPaths, so nothing could be selected and nothing could be re-run',
    )
  }

  /**
   * ── L1：基准必须绿 ────────────────────────────────────────────────────────
   *
   * ★ 基准状态拿不到 ⇒ unmeasured。绝不把"没测到基准"当成"基准没问题"。
   */
  const baseline = ctx?.baseline
  if (baseline === undefined || baseline === null) {
    return unmeasured(
      `the baseline state is unavailable (no parent/HEAD test result was provided), so a regression could not be told apart from a pre-existing failure across the ${changed.length} changed file(s)`,
    )
  }
  if (!Number.isSafeInteger(baseline.exitCode)) {
    return unmeasured(
      `the baseline test result has no exit code (got ${JSON.stringify(baseline.exitCode)}), so it does not distinguish "green" from "not measured"`,
    )
  }

  /**
   * ★ 基准不绿 ⇒ 拒绝，且理由是【无法归因】。
   *   这里刻意【不】说"你改坏了"：观察上分不开的两种可能，裁决也不能替它们选一个。
   */
  if (baseline.exitCode !== 0) {
    const label = typeof baseline.label === 'string' && baseline.label.trim() !== '' ? baseline.label : '(unlabelled base)'
    const failed = Array.isArray(baseline.failedTests) && baseline.failedTests.length > 0
      ? ` Failing at the baseline: ${baseline.failedTests.map((test) => `"${test}"`).join(', ')}.`
      : ''
    return blocked(
      `attribution is impossible: the baseline (${label}) is not green — it exited ${baseline.exitCode} before any of this change existed.` +
      `${failed} A red backtest now would not tell "it was already broken" apart from "this change broke it", so the change can be neither credited nor blamed;` +
      ` fix or pin the baseline first (this red is not the change's fault), then re-run the backtest.`,
    )
  }

  /**
   * ── L2：选测必须来自依赖图，且必须报出未选中的测试 ──────────────────────────
   */
  const coverage = ctx?.coverage
  if (coverage === undefined || coverage === null || typeof coverage !== 'object') {
    return unmeasured(
      'no dependency graph / coverage data was provided, so the selected tests could not be checked against the change (an empty selection would be indistinguishable from a correct one)',
    )
  }
  const source = coverage.source
  if (source !== 'dependency-graph') {
    return unmeasured(
      `the test selection does not declare a dependency-graph source (got ${JSON.stringify(source ?? null)}); ` +
      'a selector that hides its own approximation is exactly how a regression ships, and its green run cannot support "nothing else broke"',
    )
  }
  if (coverage.dependents === null || coverage.dependents === undefined || typeof coverage.dependents !== 'object'
    || coverage.coverage === null || coverage.coverage === undefined || typeof coverage.coverage !== 'object') {
    return unmeasured(
      'the dependency-graph selection was declared but its graph/coverage data is missing, so the change set could not be mapped onto tests',
    )
  }
  if (!Array.isArray(coverage.knownTests) || coverage.knownTests.length === 0) {
    return unmeasured(
      'the set of known tests was not provided, so "which tests were NOT selected" (the blind spot) could not be reported — and an unreported blind spot is not the same as no blind spot',
    )
  }

  const known = asSet(coverage.knownTests)
  const selected = Array.isArray(coverage.selected) ? coverage.selected : null
  if (selected === null) {
    return unmeasured(
      'the selection result was not provided (an empty array would mean "selected nothing"), so the selected suite could not be checked against the change',
    )
  }

  /**
   * ★ 没有覆盖数据的测试：它们【不在依赖图上】，所以"没被选中"对它们不是
   *   漏选，而是"我们不知道它覆盖什么"。这类测试是选测器的已知边界，
   *   必须与"看不见每个测试覆不覆盖改动文件"区分开 —— 所以它们【不】进盲区，
   *   而是单独报出来（否则每个仓库都会有一片假的盲区，盲区就会被忽略）。
   */
  const hasCoverageData = new Set<string>()
  for (const tests of Object.values(coverage.coverage)) {
    if (Array.isArray(tests)) for (const test of tests) hasCoverageData.add(norm(test))
  }
  const testsWithNoCoverageData = [...known].filter((test) => !hasCoverageData.has(test)).sort()

  /** 改动文件的【传递】依赖者（不只看直接依赖者）。 */
  const dependents = transitiveDependents(coverage.dependents, changed)

  /**
   * ★ 谁覆盖了改动文件或它的传递依赖者。
   *   只认 `coverage` 里明确列出的测试 —— 不用"路径像不像测试"去猜（见文件头）。
   */
  const covering = new Set<string>()
  const coveringFiles = new Map<string, Set<string>>()
  for (const file of [...changed, ...dependents]) {
    for (const test of lookup(coverage.coverage, file)) {
      const key = norm(test)
      covering.add(key)
      if (!coveringFiles.has(key)) coveringFiles.set(key, new Set())
      coveringFiles.get(key)?.add(norm(file))
    }
  }

  const selectedSet = asSet(selected)
  /** ★ 报出依赖者时统一成 norm 形状 —— 否则同一组依赖者会有两种写法。 */
  const dependentsReport = [...dependents].map(norm).sort()
  /**
   * ★ 盲区 = 覆盖了改动或它的传递依赖者、但没有被选中的测试。
   *   不做这个比较，选测器【隐藏自身近似性】的做法在判据层就完全合法。
   */
  const blind = [...covering].filter((test) => !selectedSet.has(test)).sort()

  /**
   * ★ 选中的测试里，有谁【不在已知测试集里】—— 一个选测器幻觉出来的测试名，
   *   会让"选测绿了"看起来像证据。单列出来，不并进别的结论。
   */
  const selectedUnknown = [...selectedSet].filter((test) => !known.has(test)).sort()

  const selectionReport = {
    source,
    command: coverage.command,
    changedPaths: [...changed].map(norm),
    transitiveDependents: dependentsReport,
    selected: [...selectedSet].sort(),
    coveringTests: [...covering].sort(),
    /** ★ 未选中的覆盖测试 = 这一轮【已知的盲区】。 */
    unselectedCoveringTests: blind,
    selectedUnknownTests: selectedUnknown,
    testsWithNoCoverageData,
    /** 一条能让调用方直接渲染/落盘的句子，免得每个读者各拼一遍。 */
    blindSpotSummary:
      `selected ${selectedSet.size} of ${known.size} known test(s); ` +
      `${blind.length} covering test(s) were NOT selected (known blind spot); ` +
      `${testsWithNoCoverageData.length} test(s) have no coverage data at all (selection graph does not know what they cover)`,
  }

  /**
   * 选测命令：【显式给了】才跑。
   * ★ 没给 ⇒ 不假装跑过 —— 不填 `selection.command` 时它是 `undefined`，
   *   于是本次裁决里不含任何"选测跑过"的声明。
   */
  let selectedExit: number | undefined
  if (coverage.command !== undefined) {
    if (typeof coverage.command !== 'string' || coverage.command.trim() === '') {
      return unmeasured(
        `the selection command is not a usable command (got ${JSON.stringify(coverage.command)}), so the selected suite could not be run`,
      )
    }
    const run = await runCommand(ctx?.execSelectedCommand, coverage.command, 'selected-test')
    if (run.kind === 'unmeasured') return unmeasured(run.reason)
    selectedExit = run.exitCode
  }

  /**
   * ── 全量：选测是近似，全量收口 ─────────────────────────────────────────────
   *
   * ★ 全量不给 ⇒ 落回 `unmeasured`，【不是】"选测绿就算回测通过"。
   *   减少 2x 成本的那份数据说的是"改动仍被抓住 >99.9%"，
   *   不是"选测等价于全量"。等价性本身必须被测量过才敢用。
   */
  const fullCommand = typeof ctx?.execBacktestCommand === 'function' ? 'full test suite' : undefined
  if (fullCommand === undefined) {
    return unmeasured(
      `no full-suite executor was injected, so the ${changed.length} changed file(s) were only covered by a ${source} selection` +
      `${selectedExit === undefined ? '' : ` (which exited ${selectedExit})`}; a selected-suite result cannot stand in for the full backtest, ` +
      `and ${blind.length} covering test(s) were never run`,
    )
  }

  const full = await runCommand(ctx?.execBacktestCommand, 'full', 'full')
  if (full.kind === 'unmeasured') return unmeasured(full.reason)
  const fullExit = full.exitCode

  /**
   * ★ 标为全量的那次运行，必须真的覆盖了全部已知测试。
   *   否则"全量绿"与"只跑了三个测试却说全量"同形 —— 那是一条永远为真的判据。
   */
  const fullScope = (ctx as { fullScope?: { coveredTests?: string[] } } | undefined)?.fullScope
  const coveredTests = Array.isArray(fullScope?.coveredTests) ? asSet(fullScope.coveredTests) : null
  if (coveredTests !== null) {
    const notRun = [...known].filter((test) => !coveredTests.has(test)).sort()
    if (notRun.length > 0) {
      return blocked(
        `the run reported as the full suite did not cover ${notRun.length} known test(s): ${notRun.map((test) => `"${test}"`).join(', ')} — ` +
        'a suite that shrinks cannot answer "nothing else broke"',
      )
    }
  }

  const fullBacktest = {
    command: fullCommand,
    exitCode: fullExit,
    status: fullExit === 0 ? 'passed' : 'failed',
    scopeCovered: coveredTests === null ? 'declared' : `${coveredTests.size} known test(s)`,
  }

  const blockers: string[] = []
  /**
   * ★ 顺序是【读的人先看到什么】，所以先报"改动被抓住"这件关于改动的结论，
   *   再报关于本次测量本身的问题（选测非确定、选测把改动抓住了）。
   *   反过来写，一条真回归会被"你的选测器有问题"挡在后面。
   */
  if (fullExit !== 0) {
    blockers.push(
      `the full suite exited ${fullExit} on top of a green baseline (${baseline.label ?? '(unlabelled base)'}) — this change broke something that used to pass` +
      `${blind.length > 0 ? `. Known blind spot (never selected): ${blind.map((test) => `"${test}"`).join(', ')}` : ''}`,
    )
  }
  if (selectedExit !== undefined && selectedExit !== 0 && fullExit === 0) {
    blockers.push(
      `the selected suite exited ${selectedExit} while the full suite exited 0 — the selected run is a non-deterministic or mis-specified reproduction; ` +
      `fix the selection before trusting a green backtest. Not selected: ${blind.length > 0 ? blind.map((test) => `"${test}"`).join(', ') : '(none)'}`,
    )
  }
  if (selectedExit !== undefined && selectedExit !== 0 && fullExit !== 0) {
    blockers.push(
      `the selected suite exited ${selectedExit} (the change was caught by the dependency-graph selection, not only by the full run)`,
    )
  }
  if (blockers.length > 0) return blocked(blockers)

  /**
   * ★ 通过时【也把结果交出去】：调用方要落盘的是判据层亲眼看到的
   *   baseline/selection/full，而不是"回测通过了"这一句话。
   *   与 `completion.verify-rerun` 交回 `reruns` 同构。
   */
  return {
    ok: true,
    baseline: { label: baseline.label, exitCode: baseline.exitCode, status: 'passed' as const },
    selection: selectionReport,
    full: fullBacktest,
  } as unknown as GateVerdict
}
