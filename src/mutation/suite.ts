import type { MutantOutcome } from './operators.ts'
import type { Mutant, MutantRun, MutationTarget, SuiteTarget } from './generate.ts'

export interface ProbeReach {
  /** 能杀这条变异体的套件文件。空数组 ⇒ 够不到。 */
  readonly files: readonly string[]
  /** ★ 观测到的：这些套件里提到过被变异文件。 */
  readonly observed: boolean
  /** 这个结论是怎么来的。 */
  readonly reason: string
}

/**
 * ★ 这条判据的第三臂：杀手套件与被变异文件的关系。
 *
 * 「存活变异体」这个数字有【两个来源，而它们在输出里长得一模一样】：
 *
 *     ① 测试没覆盖到那个分支       → 关于【测试】的信号，是真实缺口 ⇒ blocked
 *     ② 杀手套件根本够不到那个文件  → 关于【测量】的信号，不是缺口 ⇒ unmeasured
 *
 * MEASURED（外部借鉴项目 RUN-009，本形态在该项目里犯过【九次】）：
 * 评分器变异 `bin/workbench-loop.mjs`，却拿 `test/escalation.test.mjs` 当杀手套件，
 * 而那个文件里 `grep -c workbench-loop` = **0** ⇒ 该文件里每一个变异体都【必然】
 * 存活。读起来是"测试不够"，事实是"探针指错了"。
 *
 * ⇒ 当【每一个】候选套件的文本里都没有出现过被变异文件的名字时，这是一条关于
 *   探针的事实，必须记成 unmeasured，**不得记成"全存活"**。
 *
 * ★ 与借鉴项目的差别（这是有意的）：那边是 `KILLER_SUITES` 表 + 未声明就
 *   回退全套。这里没有那张表，因为【回退是错的】—— 回退会把"没人给这条变异体
 *   指过杀手"伪装成"全套都杀不死它"，也就是同一类错误的另一个形态。所以：
 *   调用方必须【显式声明】候选套件；候选为空或全部够不到 ⇒ unmeasured。
 */
export function probeReach(
  target: Pick<MutationTarget, 'file'>,
  candidates: readonly SuiteTarget[],
  readSuite: (path: string) => string,
): ProbeReach {
  const basename = target.file.split('/').pop() ?? target.file
  if (candidates.length === 0) {
    return {
      files: [],
      observed: false,
      reason: `没有为 ${target.file} 声明任何杀手套件（候选套件为空）—— 未测量：这不是"测试没覆盖"，是"没人给这条变异体指过杀手"`,
    }
  }

  const reachable: string[] = []
  const unreadable: string[] = []
  for (const suite of candidates) {
    let text: string
    try {
      text = readSuite(suite.id)
    } catch (error) {
      /**
       * ★ 读不到套件 ⇒ 这条候选【不能算作够不到】。够不到是关于内容的结论；
       *   读不到是关于读取的结论。把两者并成一类，会把一次基础设施故障
       *   伪装成"这个套件不覆盖它"。
       */
      unreadable.push(`${suite.id} (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    if (text.includes(basename) || text.includes(target.file)) reachable.push(suite.id)
  }

  if (reachable.length > 0) {
    return { files: reachable, observed: false, reason: `declared suites reach ${target.file}: ${reachable.join(', ')}` }
  }
  if (unreadable.length > 0) {
    return {
      files: [],
      observed: false,
      reason: `候选套件读不到（${unreadable.join('; ')}）—— 没能观察射程，未测量`,
    }
  }
  return {
    files: [],
    observed: false,
    reason:
      `声明的 ${candidates.length} 个套件（${candidates.map((s) => s.id).join(', ')}）里没有任何一处提到 ${basename} —— 杀手套件【够不到】被变异文件，` +
      `所以这里的每一个变异体都【必然】存活。这是关于探针的事实，不是关于测试的事实。`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 观察 → 分类
// ─────────────────────────────────────────────────────────────────────────────

export interface TestSummary {
  pass: number | null
  fail: number | null
  total: number | null
  format: 'tap' | 'spec' | 'vitest' | 'unknown'
}

/** 解析测试框架的汇总行（node:test 的 TAP / spec，以及 vitest/jest 风格）。 */
export function parseTestSummary(output: string): TestSummary {
  const text = String(output ?? '')
  const tapPass = matchInt(text, /^# pass (\d+)$/m)
  const tapFail = matchInt(text, /^# fail (\d+)$/m)
  if (tapPass !== null || tapFail !== null) {
    const pass = tapPass ?? 0
    const fail = tapFail ?? 0
    return { pass, fail, total: pass + fail, format: 'tap' }
  }
  const specPass = matchInt(text, /^\s*ℹ\s*pass (\d+)$/m)
  const specFail = matchInt(text, /^\s*ℹ\s*fail (\d+)$/m)
  if (specPass !== null || specFail !== null) {
    const pass = specPass ?? 0
    const fail = specFail ?? 0
    return { pass, fail, total: pass + fail, format: 'spec' }
  }
  const vtTests = matchInt(text, /Tests\s+(\d+) failed/)
  if (vtTests !== null) {
    const passed = matchInt(text, /Tests\s+.*?(\d+) passed/) ?? 0
    return { pass: passed, fail: vtTests, total: passed + vtTests, format: 'vitest' }
  }
  const vtAll = matchInt(text, /Tests\s+(\d+) passed/)
  if (vtAll !== null) return { pass: vtAll, fail: 0, total: vtAll, format: 'vitest' }
  return { pass: null, fail: null, total: null, format: 'unknown' }
}

function matchInt(text: string, re: RegExp): number | null {
  const m = text.match(re)
  return m?.[1] === undefined ? null : Number(m[1])
}

/**
 * 把跑完的测试输出变成一组【变红的文件】。
 *
 * ★ 文本扫描而不是逐文件重跑：默认格式里没有"结构化"的失败清单。
 */
export function failingFiles(output: string): string[] {
  const files = new Set<string>()
  const text = String(output ?? '')
  const patterns = [
    /^\s*✖\s+(.+?)\s*\(/gm,
    /^not ok \d+ - (.+)$/gm,
    /(?:FAIL|❯)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)/g,
    /(\S+\.(?:test|spec)\.[cm]?[jt]sx?)/g,
  ]
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const candidate = match[1]?.trim()
      if (candidate !== undefined && candidate !== '') files.add(candidate)
    }
  }
  return [...files]
}

/**
 * 一次变异体运行的分类。
 *
 * ★ 三件事【不是】杀：
 *   · 挂起（超时）—— 它既不是红也不是绿，把它算成任一边都是发明。
 *   · 汇总解析不出来 —— 一次"没能测量"，不是"测试发现了"。
 *   · 基线本来就红 —— 一个本来就红的套件对任何变异体都"红"，那不能归功于变异体。
 */
export function classifyRun(
  run: MutantRun,
  mutant: Mutant,
  options: { baselineRed?: boolean; redFilesInBaseline?: readonly string[] } = {},
): { outcome: MutantOutcome; reason: string; killedBy: string[] } {
  if (run.timedOut === true) {
    return { outcome: 'error', reason: '套件挂起（硬超时）—— 红/绿都不是，不得记成杀死', killedBy: [] }
  }
  const summary = parseTestSummary(`${run.stdout ?? ''}\n${run.stderr ?? ''}`)
  if (summary.total === null) {
    return {
      outcome: 'error',
      reason: `解析不出测试汇总（exitCode ${run.exitCode}）—— 记为 error，不是 kill`,
      killedBy: [],
    }
  }
  if (summary.fail === 0) {
    /**
     * ★ 只有【exit=0 且 0 failing】才是存活。exit≠0 而汇总说 0 failing 是矛盾的
     *   观测（例如进程在打印汇总之后被杀），而矛盾观测不得被读成"测试没发现"。
     */
    if (run.exitCode !== 0) {
      return {
        outcome: 'error',
        reason: `exitCode ${run.exitCode} 与"0 failing"矛盾 —— 记为 error，不是 survived`,
        killedBy: [],
      }
    }
    return { outcome: 'survived', reason: `${summary.pass} passing, 0 failing`, killedBy: [] }
  }
  const red = failingFiles(`${run.stdout ?? ''}\n${run.stderr ?? ''}`)
  /**
   * ★ 基线红比：一次"基线本来就红"的运行，红的是那几个文件，与这条变异体无关。
   *   扣掉它们之后如果一条都不剩，这条运行【没有告诉我们任何关于变异体的事】。
   */
  const newlyRed = red.filter((file) => !(options.redFilesInBaseline ?? []).includes(file))
  if (newlyRed.length === 0) {
    return {
      outcome: 'unmeasured',
      reason:
        `套件变红了，但红的只有基线里本来就红的那些文件（${red.join(', ') || '无'}）—— 这条运行没有告诉我们任何关于${mutant.id}的事`,
      killedBy: [],
    }
  }
  const killedBy = [...new Set(newlyRed.flatMap((file) => [file, relativeish(file)]))]
  return { outcome: 'killed', reason: `${summary.fail} failing`, killedBy }
}

function relativeish(path: string): string {
  return path.replace(/^\.\//, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// 裁决
// ─────────────────────────────────────────────────────────────────────────────

