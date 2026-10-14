import type { MutationLayer, MutationOperator } from './operators.ts'
import { DEFAULT_MAX_MUTANTS, DEFAULT_OPERATORS } from './operators.ts'
import type { InvariantDefinition, Mutant, MutantResult, MutantRun, MutationTarget, SuiteTarget } from './generate.ts'
import { capMutants, generateMutants, loadInvariants, verifyAnchors } from './generate.ts'
import { classifyRun, parseTestSummary, probeReach } from './suite.ts'

export type MutationDisposition =
  /** 实测到了：套件杀掉了部分/全部变异体 ⇒ 这是一个关于测试的判断。 */
  | 'measured'
  /** ★ 没测成：套件够不到 / 没有可变异的东西 / 基线不可用 ⇒ 绝不能变成"全存活"。 */
  | 'unmeasured'

export interface MutationTotals {
  considered: number
  scored: number
  killed: number
  survived: number
  errored: number
  /** ★ R2：被【标记】为可能等价，但【仍然计分】。 */
  equivalent: number
  unmeasured: number
  /**
   * 基线没执行到的行上的变异体。不进 `survived`，也不进 `killed`。
   * ★ 仍留在分数的分母里 —— 把它们剔出分母会把杀伤率抬高。
   */
  uncovered: number
}

export interface LayerScore {
  total: number
  killed: number
  survived: number
  errored: number
  unmeasured: number
  /** 这一层里基线没执行到的变异体。不进 survived。 */
  uncovered: number
  /** null = 这一层没有可计分的变异体（不是 0 分，也不是满分）。 */
  score: number | null
}

export interface SurvivingMutant {
  id: string
  layer: MutationLayer
  operator: string
  file: string | null
  line: number | null
  find: string
  replace: string
  invariant: string | null
  oftenEquivalent: boolean
}

export interface ExpectRedViolation {
  mutant: string
  declared: readonly string[]
  actuallyRed: readonly string[]
  missing: readonly string[]
  note: string
}

export interface MutationReport {
  /** ★ 三态：measured 才有分数；unmeasured 时 mutationScore 必须是 null。 */
  disposition: MutationDisposition
  /** 未测量的原因（disposition=unmeasured 时必填）。 */
  unmeasured?: string
  /** null = 没测成或无可计分变异体。★ 绝不用 1 / 100 代替。 */
  mutationScore: number | null
  totals: MutationTotals
  byLayer: Record<MutationLayer, LayerScore>
  survivingMutants: SurvivingMutant[]
  expectRedViolations: ExpectRedViolation[]
  /** 探针射程的问题（够不到 = unmeasured 的候选；读不到 = 未测量）。 */
  probeProblems: string[]
  /** 变异体全部存活时，必须说清"覆盖范围"是什么。 */
  coverage: {
    file: string
    startLine: number
    endLine: number
    linesMutated: number
    mutantsInRange: number
  }
}

export interface ScoreInput {
  target: Pick<MutationTarget, 'file' | 'startLine' | 'endLine'>
  results: readonly MutantResult[]
  /** ★ 未测量的事实：探针够不到 SUT。给出来就【不是】报告全存活。 */
  probeProblem?: string | null
  /** 反事实检查失败（变异体没能还原）—— 一次没还原的测量不可信。 */
  restoreVerified?: boolean | null
  /** 基线本来就红：kill rate 的每个数字都不成立。 */
  baselineProblem?: string | null
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

// ─────────────────────────────────────────────────────────────────────────────
// 行覆盖，以及（只有基线真的点了名时才有的）逐测试覆盖
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverageFileReading {
  /** 保留目录前缀的相对路径（posix）。basename 相同的两个文件靠它分开。 */
  readonly file: string
  /** 1-based。空 = 报告点了这个文件，且没有未执行行。 */
  readonly uncoveredLines: readonly number[]
}

/**
 * 把「指不出覆盖」说成未测量，并且把两种假读显式否定掉。
 * ★ 缺了后半句，调用方可以把这句话再读成「都存活」或「都没覆盖」。
 */
export function coverageUnmeasured(detail: string): string {
  return `${detail}, so this batch is unmeasured — this is not "everything survived" and not "everything uncovered"`
}

function normalizeCoveragePath(file: string): string {
  return file.replace(/\\/g, '/').trim().replace(/^(?:\.\/)+/, '')
}

function stripCoverageReporterPrefix(line: string): string {
  return line.replace(/^\s*(?:\u2139|ℹ|ℹ️|#)\s/, '')
}

function parseUncoveredSpec(spec: string): number[] | null {
  const text = spec.trim()
  if (text === '') return []
  const lines: number[] = []
  for (const token of text.split(/\s+/)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token)
    if (match === null) return null
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start > 100_000) return null
    for (let line = start; line <= end; line += 1) lines.push(line)
  }
  return lines
}

/**
 * Node `--experimental-test-coverage` 的 spec/TAP 表。
 *
 * 目录是单独一行、没有百分比；文件行按缩进挂在目录下面。两个同名 `mutation.js`
 * 只靠缩进才分得开 —— 把前缀剥掉再按 basename 合并，就会被折成 ambiguous。
 *
 * `null` = 输出里根本没有这份报告（没采到，不是「空覆盖」）。
 * `{ ok: false }` = 报告在，但有一行读不准 —— 整份作废，不许把读漏的行当成已覆盖。
 */
export function parseNodeCoverageReport(
  output: string,
): { ok: true; files: CoverageFileReading[] } | { ok: false; reason: string } | null {
  const text = String(output ?? '')
  const start = text.search(/start of coverage report/)
  if (start === -1) return null
  const endRel = text.slice(start).search(/end of coverage report/)
  if (endRel === -1) return { ok: false, reason: 'the coverage report started but did not end' }
  const body = text.slice(start, start + endRel)
  const stack: string[] = []
  const files: CoverageFileReading[] = []
  for (const rawLine of body.split(/\r?\n/)) {
    const line = stripCoverageReporterPrefix(rawLine)
    if (!line.includes('|')) continue
    const columns = line.split('|')
    const nameCell = columns[0] ?? ''
    const indent = nameCell.match(/^ */)?.[0].length ?? 0
    const name = nameCell.trim()
    if (name === '' || name === 'file' || name === 'all files' || /^-+$/.test(name)) continue
    const linePct = (columns[1] ?? '').trim()
    const uncoveredCell = (columns[4] ?? '').trim()
    stack.length = Math.min(stack.length, indent)
    if (linePct === '') {
      stack.push(name)
      continue
    }
    if (!/^\d+(?:\.\d+)?$/.test(linePct)) continue
    const uncovered = parseUncoveredSpec(uncoveredCell)
    if (uncovered === null) return { ok: false, reason: `the uncovered-line list for ${name} could not be read` }
    files.push({
      file: [...stack, name].join('/'),
      uncoveredLines: uncovered,
    })
  }
  return { ok: true, files }
}

/**
 * 用相对路径对上唯一文件。basename 相同不算冲突：`lib/mutation.js` 与
 * `src/gates/completion/mutation.js` 是两个文件。对不上、或目录前缀对上了
 * 不止一个 ⇒ 这个文件 unmeasured，【不是】整批 ambiguous。
 */
export function matchCoverageFile(
  files: readonly CoverageFileReading[],
  file: string,
): { status: 'measured'; uncoveredLines: readonly number[] } | { status: 'unmeasured' } {
  const want = normalizeCoveragePath(file)
  const exact = files.filter((entry) => normalizeCoveragePath(entry.file) === want)
  if (exact.length >= 1) {
    return {
      status: 'measured',
      uncoveredLines: [...new Set(exact.flatMap((entry) => entry.uncoveredLines))],
    }
  }
  const byPrefix = files.filter((entry) => {
    const got = normalizeCoveragePath(entry.file)
    return got.endsWith(`/${want}`) || want.endsWith(`/${got}`)
  })
  if (byPrefix.length === 1) {
    const only = byPrefix[0]
    if (only === undefined) return { status: 'unmeasured' }
    return { status: 'measured', uncoveredLines: only.uncoveredLines }
  }
  return { status: 'unmeasured' }
}

/**
 * 读调用方交来的 `executedLines`。
 *
 * `absent` = 字段不在（还可以再看覆盖报告）。
 * `malformed` = 在，但指不出一份行表。
 * 对象 = 采到了（允许空）。
 */
export function readExplicitExecutedLines(
  value: MutantRun['executedLines'] | null,
): Readonly<Record<string, readonly number[]>> | 'absent' | 'malformed' {
  if (value === undefined) return 'absent'
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'malformed'
  const executed: Record<string, number[]> = {}
  for (const [file, lines] of Object.entries(value)) {
    if (!Array.isArray(lines)) return 'malformed'
    const parsed: number[] = []
    for (const line of lines) {
      if (!Number.isSafeInteger(line) || line <= 0) return 'malformed'
      parsed.push(line)
    }
    executed[normalizeCoveragePath(file)] = parsed
  }
  return executed
}

type TestLineMap = Readonly<Record<string, readonly string[]>>

/**
 * 读 `testsByLine`。`absent` / `malformed` 都是「指不出逐测试」——
 * 调用方必须退回整份套件，不许把坏掉的名单当成一份覆盖。
 */
export function readExplicitTestsByLine(
  value: MutantRun['testsByLine'] | null,
): Readonly<Record<string, TestLineMap>> | 'absent' | 'malformed' {
  if (value === undefined) return 'absent'
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'malformed'
  const parsed: Record<string, Record<string, string[]>> = {}
  for (const [file, lines] of Object.entries(value)) {
    if (lines === null || typeof lines !== 'object' || Array.isArray(lines)) return 'malformed'
    const byLine: Record<string, string[]> = {}
    for (const [line, tests] of Object.entries(lines)) {
      if (!/^[1-9]\d*$/.test(line)) return 'malformed'
      if (!Array.isArray(tests)) return 'malformed'
      const names: string[] = []
      for (const test of tests) {
        if (typeof test !== 'string' || test.trim() === '') return 'malformed'
        names.push(test)
      }
      byLine[line] = names
    }
    parsed[normalizeCoveragePath(file)] = byLine
  }
  return parsed
}

/**
 * stdout 里的逐测试块。没有这块 ⇒ `null`（不是空覆盖）。
 * 开了头却读不准 ⇒ `malformed`，整块作废，不许用已经读到的那几行去猜。
 *
 *     start of per-test coverage
 *     <file>:<line> <test> [<test>...]
 *     end of per-test coverage
 */
export function parsePerTestCoverageBlock(
  output: string,
): Readonly<Record<string, TestLineMap>> | null | 'malformed' {
  const text = String(output ?? '')
  const start = text.indexOf('start of per-test coverage')
  if (start === -1) return null
  const end = text.indexOf('end of per-test coverage', start)
  if (end === -1) return 'malformed'
  const body = text.slice(start + 'start of per-test coverage'.length, end)
  const parsed: Record<string, Record<string, string[]>> = {}
  for (const rawLine of body.split(/\r?\n/)) {
    const line = stripCoverageReporterPrefix(rawLine).trim()
    if (line === '') continue
    const match = /^(\S+):([1-9]\d*)\s+(\S.*)$/.exec(line)
    if (match === null) return 'malformed'
    const file = normalizeCoveragePath(match[1] ?? '')
    const lineNo = match[2] ?? ''
    const tests = (match[3] ?? '').split(/\s+/).filter((test) => test !== '')
    if (file === '' || tests.length === 0) return 'malformed'
    const bucket = parsed[file] ?? {}
    parsed[file] = bucket
    bucket[lineNo] = tests
  }
  return parsed
}

function uniquePathMatch<T>(
  file: string,
  entries: readonly (readonly [string, T])[],
): T | 'ambiguous' | undefined {
  const want = normalizeCoveragePath(file)
  const exact = entries.filter(([key]) => normalizeCoveragePath(key) === want)
  if (exact.length === 1) return exact[0]?.[1]
  if (exact.length > 1) return 'ambiguous'
  const byPrefix = entries.filter(([key]) => {
    const got = normalizeCoveragePath(key)
    return got.endsWith(`/${want}`) || want.endsWith(`/${got}`)
  })
  if (byPrefix.length === 1) return byPrefix[0]?.[1]
  if (byPrefix.length > 1) return 'ambiguous'
  return undefined
}

export type LineCoverageReading = 'run' | 'uncovered' | 'unmeasured-file'

export interface MutationCoverage {
  /**
   * 这一行跑不跑。
   * `run` = 基线执行到了（或行号对不上，照旧跑，不把「对不上」说成未覆盖）。
   * `uncovered` = 点了名，且这一行没执行。
   * `unmeasured-file` = 报告没提到这个文件，或目录前缀对上了不止一个。
   *   ★ 只记这个文件，不取消别的文件。
   */
  line(file: string, line: number | undefined): LineCoverageReading
  /**
   * 碰到这一行的测试。
   * `null` = 指不出（整份已覆盖套件照跑，不许猜）。
   * 空数组 = 基线指出没有任何测试碰到它。
   */
  testsFor(file: string, line: number | undefined): readonly string[] | null
}

/**
 * 基线跑完之后，改动行有没有被执行、以及（仅当点了名时）是哪些测试执行的。
 *
 * 指不出【行】⇒ `unmeasured`，整批不能计分。
 * 行指得出、测试指不出 ⇒ 仍然成功：`testsFor` 返回 null，调用方跑整份套件。
 *
 * ★ 显式 `executedLines` / `testsByLine` 优先于文本。调用方已经对过账，就不要再猜。
 */
export function resolveMutationCoverage(
  run: Pick<MutantRun, 'stdout' | 'stderr' | 'executedLines' | 'testsByLine'>,
): MutationCoverage | { readonly unmeasured: string } {
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  const explicitTests = readExplicitTestsByLine(run.testsByLine)
  const blockTests = explicitTests === 'absent' ? parsePerTestCoverageBlock(output) : null
  const perTest: Readonly<Record<string, TestLineMap>> | null =
    explicitTests !== 'absent' && explicitTests !== 'malformed'
      ? explicitTests
      : blockTests !== null && blockTests !== 'malformed'
        ? blockTests
        : null

  const testsFor = (file: string, line: number | undefined): readonly string[] | null => {
    if (perTest === null || line === undefined) return null
    const matched = uniquePathMatch(file, Object.entries(perTest))
    if (matched === undefined || matched === 'ambiguous') return null
    const listed = matched[String(line)]
    if (listed === undefined) return null
    return listed
  }

  const explicitLines = readExplicitExecutedLines(run.executedLines)
  if (explicitLines === 'malformed') {
    return { unmeasured: coverageUnmeasured('the baseline executedLines value could not be read') }
  }
  if (explicitLines !== 'absent') {
    return {
      line(file, line) {
        if (line === undefined) return 'run'
        const matched = uniquePathMatch(file, Object.entries(explicitLines))
        if (matched === 'ambiguous') return 'unmeasured-file'
        if (matched === undefined) return 'uncovered'
        return matched.includes(line) ? 'run' : 'uncovered'
      },
      testsFor,
    }
  }

  const parsed = parseNodeCoverageReport(output)
  if (parsed === null) {
    return { unmeasured: coverageUnmeasured('the baseline run did not report which changed lines it executed') }
  }
  if (parsed.ok === false) return { unmeasured: coverageUnmeasured(parsed.reason) }
  return {
    line(file, line) {
      const match = matchCoverageFile(parsed.files, file)
      if (match.status === 'unmeasured') return 'unmeasured-file'
      if (line !== undefined && match.uncoveredLines.includes(line)) return 'uncovered'
      return 'run'
    },
    testsFor,
  }
}

/**
 * 把逐条观察汇成报告。**这是本模块唯一的裁决点。**
 *
 * ★ 三条判定顺序（每一条都防住一种把"没测到"并进"通过/不通过"的写法）：
 *
 *   ① 基线红 / 还原失败 / 探针够不到 —— 任何一条在场 ⇒ 整体 unmeasured。
 *      放在最前面，是因为它们污染【其余全部数字】：一份在污染下标出来的分数，
 *      精确到小数点后三位也是废的。
 *   ② 一条可计分变异体都没有（范围内没有算子，全是注释/声明，或全是 error）⇒ unmeasured，
 *      **不是 1.0**。实测形态：一次全是文档的改动会读成"代码被完全覆盖"。
 *   ③ 有可计分变异体 ⇒ measured，分数 = killed / (killed + survived + uncovered)。
 *
 * ★ 等价体【进分母】（R2）。把 `!r.equivalent` 过滤掉就是自我粉饰。
 * ★ `uncovered` 不进 survived，但留在分母里。只拿跑过的做分母会把「没执行到」拿掉，分数被抬高。
 */
export function scoreMutants(input: ScoreInput): MutationReport {
  const { target, results } = input
  const probeProblem = input.probeProblem ?? null
  const baselineProblem = input.baselineProblem ?? null
  const restoreVerified = input.restoreVerified ?? null

  const scored = results.filter((result) => result.outcome === 'killed' || result.outcome === 'survived')
  const errored = results.filter((result) => result.outcome === 'error')
  const unmeasuredRuns = results.filter((result) => result.outcome === 'unmeasured')
  /**
   * ★ 未覆盖不进 scored。把它算进 killed 会抬高分数；把它算进 survived 会把
   *   「测试没执行到」说成「执行了但没杀掉」。分母仍然算上它，见下面的 score。
   */
  const uncovered = results.filter((result) => result.outcome === 'uncovered')
  const killed = scored.filter((result) => result.outcome === 'killed')
  const survived = scored.filter((result) => result.outcome === 'survived')
  const equivalent = results.filter((result) => result.equivalent === true)

  const byLayer = {} as Record<MutationLayer, LayerScore>
  for (const layer of ['L1', 'L2', 'L3'] as const) {
    const inLayer = scored.filter((result) => result.mutant.layer === layer)
    const layerKilled = inLayer.filter((result) => result.outcome === 'killed')
    const layerErrored = errored.filter((result) => result.mutant.layer === layer)
    const layerUnmeasured = unmeasuredRuns.filter((result) => result.mutant.layer === layer)
    const layerUncovered = uncovered.filter((result) => result.mutant.layer === layer)
    const layerDenom = inLayer.length + layerUncovered.length
    byLayer[layer] = {
      total: inLayer.length,
      killed: layerKilled.length,
      survived: inLayer.length - layerKilled.length,
      errored: layerErrored.length,
      unmeasured: layerUnmeasured.length,
      uncovered: layerUncovered.length,
      score: layerDenom === 0 ? null : round(layerKilled.length / layerDenom),
    }
  }

  const expectRedViolations: ExpectRedViolation[] = []
  for (const result of results) {
    const declared = result.mutant.expectRed ?? []
    if (declared.length === 0) continue
    const observed = result.killedBy
    const missing = declared.filter((file) => !observed.some((seen) => seen.endsWith(file) || seen === file))
    if (result.outcome === 'killed' && missing.length > 0) {
      expectRedViolations.push({
        mutant: result.mutant.id,
        declared,
        actuallyRed: observed,
        missing,
        note: '变异体被杀了，但【不是被声明的那个文件】杀的。要么声明写错了，要么真正的守卫在别处 —— 两者都必须被看见。',
      })
    }
    if (result.outcome === 'survived') {
      expectRedViolations.push({
        mutant: result.mutant.id,
        declared,
        actuallyRed: [],
        missing: declared,
        note: '声明的 expect_red 一次都没红 —— 没有任何东西守这条不变量。',
      })
    }
  }

  const totals: MutationTotals = {
    considered: results.length,
    scored: scored.length,
    killed: killed.length,
    survived: survived.length,
    errored: errored.length,
    equivalent: equivalent.length,
    unmeasured: unmeasuredRuns.length,
    uncovered: uncovered.length,
  }

  const coverage = {
    file: target.file,
    startLine: target.startLine,
    endLine: target.endLine,
    linesMutated: target.endLine - target.startLine + 1,
    mutantsInRange: results.length,
  }

  const survivingMutants: SurvivingMutant[] = survived.map((result) => ({
    id: result.mutant.id,
    layer: result.mutant.layer,
    operator: result.mutant.operator,
    file: result.mutant.file ?? null,
    line: result.mutant.line ?? null,
    find: result.mutant.find,
    replace: result.mutant.replace,
    invariant: result.mutant.invariant ?? null,
    oftenEquivalent: result.mutant.oftenEquivalent,
  }))

  const unmeasuredReasons: string[] = []
  if (baselineProblem !== null) unmeasuredReasons.push(`baseline 不可用：${baselineProblem}`)
  if (restoreVerified === false) unmeasuredReasons.push('变异体没能被还原：一次没有还原的测量不可信')
  if (probeProblem !== null) unmeasuredReasons.push(`探针射程：${probeProblem}`)
  if (unmeasuredRuns.length > 0) {
    /**
     * ── ★★★ 原因必须被带出来（2026-10-12 修）────────────────────────────────────
     *
     * MEASURED（本轮加总预算时当场发现）：这一句此前只报**条数与 id** ——
     *
     *     `9 条变异体的运行没有给出可解释的结果（ge-to-gt@L4, gt-to-ge@L3, …）`
     *
     * 而每条运行自己的 `reason`（"套件挂起（硬超时）" / "BUDGET stop：…" /
     * "解析不出测试汇总" / "exitCode 与 0 failing 矛盾"）**一个字都没进裁决**。
     *
     * ⇒ 读的人看到的是同一句话，而**补救动作完全相反**：
     *   预算停止 ⇒ 去调预算 / 让链更快；套件挂起 ⇒ 去看那条命令为什么卡；
     *   汇总解析不出来 ⇒ 去看套件怎么打印的。把它们合成一句，等于让一个
     *   能立刻修的问题变成一次重新排查。
     *
     * ★ 去重后拼接（而不是逐条展开）：`unmeasured` 常常是**同一条原因**重复 N 次
     *   （预算一跑光，后面每一条都立刻抛），逐条展开会把裁决淹掉；
     *   而去重之后"有几种不同的说不出"这件事本身也是读数。
     */
    const why = [...new Set(unmeasuredRuns.map((result) => result.reason))]
    unmeasuredReasons.push(
      `${unmeasuredRuns.length} 条变异体的运行没有给出可解释的结果（${unmeasuredRuns.map((result) => result.mutant.id).join(', ')}）`
      + `—— 原因：${why.join(' | ')}`,
    )
  }

  if (unmeasuredReasons.length > 0) {
    return {
      disposition: 'unmeasured',
      unmeasured: unmeasuredReasons.join('; '),
      mutationScore: null,
      totals,
      byLayer,
      survivingMutants,
      expectRedViolations,
      probeProblems: probeProblem === null ? [] : [probeProblem],
      coverage,
    }
  }

  /**
   * ★ 分母 = 跑过的（killed + survived）+ 没执行到的（uncovered）。
   *   未覆盖不进分子。只拿跑过的做分母会把「没执行到」从分母里拿掉，分数被抬高。
   */
  const denominator = scored.length + uncovered.length
  if (denominator === 0) {
    /**
     * ── ★★★ 归因必须是真的（2026-10-12 修一句**无条件宣称**）────────────────────
     *
     * MEASURED（本轮加总预算时当场发现）：这一句此前**固定**说"全部落在
     * 注释/字符串/无算子区域"。而"`scored === 0`"只说明**没有可计分的**变异体，
     * 它至少有三种成因，且补救动作相反：
     *
     *   · 改动行里确实没有算子能命中 ⇒ 这次测量**无话可说**（改范围 / 接受）；
     *   · 候选运行**全部以 error 结束**（执行器故障 / 预算跑光 / 套件挂起）
     *     ⇒ 去看那条命令，与"改动行里没算子"毫无关系；
     *   · 一条候选都没生成 ⇒ 与"生成了但落在注释里"也不同形（前者是范围问题，
     *     后者是内容问题）。
     *
     * ★ 原句把三者**全都**归成第一种 ⇒ 一个"执行器炸了"的事故会被读成
     *   "这次改动没东西可测" —— 而读的人会因此**不去看那条命令**。
     *   这正是本仓最忌讳的那一类：一句**读起来完全合理、而事实是反的**话。
     *
     * ★ 现在按真实成因而分（仍然是一个 `unmeasured`，只是不再冒充别的成因）。
     */
    const cause = results.length === 0
      ? '一条候选都没生成 —— 这些改动行里没有任何算子能命中'
      : errored.length > 0
        ? `${errored.length} of ${results.length} 条候选的运行以 error 结束，所以一条都没能计分 —— 原因（去重后）：${[...new Set(errored.map((result) => result.reason))].join(' | ')}`
        : `${results.length} 条候选全部落在注释/字符串/无算子区域`
    return {
      disposition: 'unmeasured',
      unmeasured:
        `改动行范围 ${target.file}:${target.startLine}-${target.endLine} 里没有一条可计分变异体：`
        + `${cause} —— 这是"这次测量无话可说"，不是"完全覆盖"`,
      mutationScore: null,
      totals,
      byLayer,
      survivingMutants,
      expectRedViolations,
      probeProblems: [],
      coverage,
    }
  }

  return {
    disposition: 'measured',
    mutationScore: round(killed.length / denominator),
    totals,
    byLayer,
    survivingMutants,
    expectRedViolations,
    probeProblems: probeProblem === null ? [] : [probeProblem],
    coverage,
  }
}

/**
 * 分数是否落到"测试是装饰性的"那一档？
 *
 * ★ 这个判据只在 disposition=measured 时有意义。unmeasured 时**不许**调用它 ——
 *   那正是"把探针的失败报成被测物的失败"。所以它在 unmeasured 下直接抛错，
 *   而不是返回一个看起来合理的布尔。
 */
export function isDecorative(report: MutationReport, threshold: number): boolean {
  if (report.disposition !== 'measured') {
    throw new Error(
      'isDecorative() 只能用在 measured 的报告上：把 unmeasured 判成"装饰性测试"就是把探针的失败报成被测物的失败',
    )
  }
  if (report.mutationScore === null) throw new Error('a measured report must carry a mutation score')
  return report.mutationScore < threshold
}

// ─────────────────────────────────────────────────────────────────────────────
// 引擎：把变异体跑一遍
// ─────────────────────────────────────────────────────────────────────────────

export interface MutationEngineInput {
  /** 要被变异的位置（文件 + 改动行范围）。范围是必填的 —— 见 R1。 */
  target: MutationTarget
  /** 跑一遍杀手套件。由调用方注入（判据不做 I/O）。 */
  runSuite: () => Promise<MutantRun>
  /**
   * 应用 / 还原一条变异体。★ 每一步都必须被验证还原 —— 一次没还原的测量
   * 既不干净也不可信，且会污染之后每一条测量。
   */
  apply: (mutant: Mutant) => Promise<{ ok: boolean; reason?: string }>
  restore: () => Promise<{ ok: boolean; verified: boolean; reason?: string }>
  /** 杀手套件的候选，用于射程判定。 */
  suites: readonly SuiteTarget[]
  readSuite: (path: string) => string
  /** L3 契约违反体的定义。 */
  invariants?: readonly InvariantDefinition[]
  /** 读 L3 定义里指到的文件（核对锚点）。 */
  readFile: (path: string) => string
  /** 镜像套件：把一条变异体同时应用到这些文件（如 src 与它的编译产物 lib）。 */
  mirrors?: readonly string[]
  mirrorContent?: (path: string, mutatedText: string) => string
  operators?: readonly MutationOperator[]
  /** 基线本来就红了哪些文件（一次"本来就红的套件"对任何变异体都红，那不算杀）。 */
  redFilesInBaseline?: readonly string[]
  /** 超过这个条数就截断（截断必须被报告，不能默默拉低分母）。 */
  maxMutants?: number
}

/**
 * 跑一遍变异测试，产出报告。
 *
 * ★ 顺序是有意的：一切"能不能测"的前置检查都在【注入任何变异体之前】完成。
 *   一个在污染状态下跑出来的分数，精确到小数点后三位也是废的。
 */
export async function runMutationEngine(input: MutationEngineInput): Promise<MutationReport> {
  const {
    target,
    runSuite,
    apply,
    restore,
    suites,
    readSuite,
    invariants = [],
    readFile,
    mirrors = [],
    mirrorContent,
    operators = DEFAULT_OPERATORS,
    redFilesInBaseline = [],
    /** ★ 2026-10-12：200 → {@link DEFAULT_MAX_MUTANTS}（40）。理由见上面那条常量。 */
    maxMutants = DEFAULT_MAX_MUTANTS,
  } = input

  const emptyCoverage = {
    file: target.file,
    startLine: target.startLine,
    endLine: target.endLine,
    linesMutated: target.endLine - target.startLine + 1,
    mutantsInRange: 0,
  }

  /** 早退：任何一条前置检查不通过都直接 unmeasured，且【不去动文件】。 */
  const refuse = (reason: string): MutationReport => ({
    disposition: 'unmeasured',
    unmeasured: reason,
    mutationScore: null,
    totals: { considered: 0, scored: 0, killed: 0, survived: 0, errored: 0, equivalent: 0, unmeasured: 0, uncovered: 0 },
    byLayer: {
      L1: { total: 0, killed: 0, survived: 0, errored: 0, unmeasured: 0, uncovered: 0, score: null },
      L2: { total: 0, killed: 0, survived: 0, errored: 0, unmeasured: 0, uncovered: 0, score: null },
      L3: { total: 0, killed: 0, survived: 0, errored: 0, unmeasured: 0, uncovered: 0, score: null },
    },
    survivingMutants: [],
    expectRedViolations: [],
    probeProblems: [reason],
    coverage: emptyCoverage,
  })

  /**
   * ① 探针射程 —— 放在最前面，因为它是唯一一条【在跑之前就能确定】的失效：
   *    套件够不到被变异文件时，跑 100 条变异体得到的 100 个"存活"全是噪声。
   */
  const reach = probeReach(target, suites, readSuite)
  if (reach.files.length === 0) return refuse(reach.reason)

  /**
   * ② 基线必须绿。一个本来就红的套件对【任何】变异体都会红，于是每一条都会被
   *    记成"被杀"。那不是覆盖，那是把套件自己的问题算成变异体的功劳。
   */
  const baseline = await runSuite()
  if (baseline.timedOut === true) return refuse('基线运行超时（挂起）—— 红/绿都不是，不得据此计分')
  const baselineSummary = parseTestSummary(`${baseline.stdout ?? ''}\n${baseline.stderr ?? ''}`)
  if (baselineSummary.total === null) {
    return refuse(`基线跑不出一份可读的测试汇总（exitCode ${baseline.exitCode}）—— 先让套件可读，再来测量套件能发现什么`)
  }
  if (baselineSummary.fail !== 0 || baseline.exitCode !== 0) {
    return refuse(
      `基线不是绿的（fail=${baselineSummary.fail}, exit=${baseline.exitCode}）—— 在一个本来就红的套件上量"能发现什么"没有任何意义`,
    )
  }

  /**
   * ③ L3 定义必须可用。坏锚点静默跳过 = 报告一份并不存在的 L3 覆盖。
   */
  const { mutants: l3, errors: invariantErrors } = loadInvariants(invariants)
  const anchorProblems = verifyAnchors(l3, readFile)
  if (invariantErrors.length > 0 || anchorProblems.length > 0) {
    return refuse(
      `L3 契约违反体的定义不可用（${[...invariantErrors, ...anchorProblems].join('; ')}）—— 静默跳过坏锚点会报出一份并不存在的 L3 覆盖`,
    )
  }

  const generated = generateMutants(target.source, {
    startLine: target.startLine,
    endLine: target.endLine,
    changedLines: target.changedLines,
    operators,
    file: target.file,
  })
  const mirrorsMutants = mirrorMutants(generated, mirrors, mirrorContent)
  const all = [...generated, ...mirrorsMutants, ...l3]

  if (all.length === 0) return refuse(noScorableMutants(target))

  /**
   * ★ 2026-10-12：`all.slice(0, maxMutants)` → `capMutants(all, maxMutants)`。
   *   取前 N 会按**算子表的顺序**截断（表里靠前的算子全测、靠后的全丢），
   *   而等距抽样跨算子铺开。两者在"跑了多少条"这个读数上同形
   *   —— 差别只在"哪几条没跑"，而那正是这个上限最容易被误读的地方。
   */
  const selected = capMutants(all, maxMutants)
  const truncated = all.length - selected.length

  const results: MutantResult[] = []
  let restoreVerified = true

  for (const mutant of selected) {
    const applied = await apply(mutant)
    if (applied.ok !== true) {
      results.push({
        mutant,
        outcome: 'error',
        reason: `变异体没能被应用：${applied.reason ?? '未说明'}`,
        killedBy: [],
      })
      continue
    }
    let result: MutantResult
    try {
      const run = await runSuite()
      const classified = classifyRun(run, mutant, { redFilesInBaseline })
      result = { mutant, outcome: classified.outcome, reason: classified.reason, killedBy: classified.killedBy }
    } catch (error) {
      result = {
        mutant,
        outcome: 'error',
        reason: `运行器抛错：${error instanceof Error ? error.message : String(error)}`,
        killedBy: [],
      }
    } finally {
      const restored = await restore()
      if (restored.ok !== true || restored.verified !== true) {
        /**
         * ★ 一次没还原的测量会污染之后【每一条】测量，而且它在日志里与
         *   "变异体存活"长得一样。所以整份报告的分数作废。
         */
        restoreVerified = false
        result = {
          mutant,
          outcome: 'error',
          reason: `还原失败：${restored.reason ?? '未说明'} —— 之后的测量都不可信`,
          killedBy: [],
        }
      }
    }
    results.push(result)
  }

  const report = scoreMutants({
    target,
    results,
    restoreVerified,
    ...(truncated > 0 ? { baselineProblem: `变异体被截断：${all.length} 条候选里只跑了 ${selected.length} 条` } : {}),
  })
  return report
}

/**
 * ★ 镜像变异体：把同一条变异体同时应用到一份【镜像】上（如 `src/x.ts` 与它编译出的
 *   `lib/x.js`）。
 *
 *   为什么不是"重复"：实测形态是——两处都改才对，只改一处【永远不会红】，于是它
 *   必然存活、分数被拉低。把这种必然存活算进"测试没覆盖"就是扭曲。
 *   为什么不是"排除"：两处匹配不一致（产物过期）时它【照样是一条真实变异体】，
 *   而且要如实报告。
 *
 *   `mutator` 由调用方注入 —— 机制层不做文本改写。
 */
export function mirrorMutants(
  mutants: readonly Mutant[],
  mirrors: readonly string[],
  mutator?: (path: string, mutatedText: string) => string,
): Mutant[] {
  if (mirrors.length === 0 || mutator === undefined) return []
  const out: Mutant[] = []
  for (const mutant of mutants) {
    if (mutant.mutated === undefined) continue
    for (const mirror of mirrors) {
      const mutated = mutator(mirror, mutant.mutated)
      if (mutated === mutant.mutated) continue
      out.push({
        ...mutant,
        id: `${mutant.id}+mirror:${mirror}`,
        file: mirror,
        mutated,
      })
    }
  }
  return out
}

/** 范围内没有可计分变异体时的原因。★ 措辞必须是"无话可说"，不是"完全覆盖"。 */
export function noScorableMutants(target: Pick<MutationTarget, 'file' | 'startLine' | 'endLine'>): string {
  return (
    `改动行范围 ${target.file}:${target.startLine}-${target.endLine} 里没有一条可计分变异体 —— ` +
    `这是"这次测量无话可说"（注释、字符串、或没有算子的声明），不是"完全覆盖"`
  )
}

