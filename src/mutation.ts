/**
 * ── 变异测试：证明"测试真的在测" ────────────────────────────────────────────────
 *
 * 它防的是什么失效，以及为什么"测试过了"不够：
 *
 *   "测试通过"只能证明【已有的断言没被打破】。它【不能】证明一条【新写的】测试
 *   断言了任何东西。MEASURED（外部借鉴项目的一轮真实交付）：一个任务加了 25KB 的
 *   测试文件、全套绿、审查通过 —— 而把 `||` 翻成 `&&` 之后【一条红的都没有】。
 *   套件是装饰性的，而它在日志里与"做完了"完全同形。
 *
 * ⇒ 证明方式不是读测试，是【改坏被测代码，看测试会不会红】。
 *
 * ── 三层算子，分层不是分类学，是复用边界 ──────────────────────────────────────
 *
 *   L1 通用  与语言无关的符号：`>=`→`>`、`&&`→`||`、`true`↔`false`、`+`→`-`
 *   L2 语言  本仓库是 TS：`===`→`!==`、`??`→`||`、`await` 丢弃
 *   L3 契约  ★ 不是改符号，是【违反一条项目契约】
 *
 *   L1/L2 是【机制】，可以搬；L3 每个项目不一样 ⇒ 项目给【定义】，这里给【执行】。
 *   实测：L1/L2 能抓"改错了符号"，但永远抓不到"契约被违反"—— 一次契约违反
 *   看起来完全正常，它不是语法错误。
 *
 * ── 三条评分规则，每条都来自一次实测 ──────────────────────────────────────────
 *
 *   R1 只变异【改动行范围】（--lines 语义）。全文件变异会把无关区域算进分母，
 *      从而【扭曲分数】—— 分母里混进一堆没人碰过的行，分母大了，覆盖看起来就差了。
 *   R2 等价变异体【标记但不排除】。宁可低估覆盖，也不自我粉饰。
 *   R3 ★【杀手套件够不到被变异文件 ⇒ unmeasured/UNKNOWN】，不得记成"全存活"。
 *
 * ── 本模块是【纯数据变换】──────────────────────────────────────────────────────
 *
 * 它不读文件、不起进程、不看时钟。I/O 由调用方注入（读文件传文本、跑测试传
 * `runSuite`、读 git 传 `changedLines`）。理由是实测的：一个自己起进程的判据
 * 无法被离线复现，也就无法被夹具钉住。
 */

/** 一次变异能被执行器观察到的结果。★ 四态不是两态，见 scoreMutants。 */
export type MutantOutcome = 'killed' | 'survived' | 'error' | 'unmeasured'

/** 一条变异算子。`find` 在【改动行范围】内首次出现的位置被替换成 `replace`。 */
export interface MutationOperator {
  readonly id: string
  readonly layer: MutationLayer
  readonly kind: string
  readonly find: string
  readonly replace: string
  readonly note?: string
}

export type MutationLayer = 'L1' | 'L2' | 'L3'

/**
 * L1 —— 与语言无关的算子。任何文本都安全。
 *
 * ★ 每个符号【两个方向都要有】：实测（外部借鉴项目的同一形态）只列单向时，
 *   `gt-to-ge` 有而 `ge-to-gt` 没有，于是一批"边界不可观测"的变异体在分母里
 *   只出现一次 —— 分数被这个不对称抬高。
 */
export const L1_OPERATORS: readonly MutationOperator[] = Object.freeze([
  { id: 'ge-to-gt', layer: 'L1', kind: 'relational', find: '>=', replace: '>' },
  { id: 'gt-to-ge', layer: 'L1', kind: 'relational', find: '>', replace: '>=' },
  { id: 'le-to-lt', layer: 'L1', kind: 'relational', find: '<=', replace: '<' },
  { id: 'lt-to-le', layer: 'L1', kind: 'relational', find: '<', replace: '<=' },
  { id: 'and-to-or', layer: 'L1', kind: 'logical', find: '&&', replace: '||' },
  { id: 'or-to-and', layer: 'L1', kind: 'logical', find: '||', replace: '&&' },
  { id: 'true-to-false', layer: 'L1', kind: 'literal', find: 'true', replace: 'false' },
  { id: 'false-to-true', layer: 'L1', kind: 'literal', find: 'false', replace: 'true' },
  { id: 'plus-to-minus', layer: 'L1', kind: 'arithmetic', find: '+', replace: '-' },
])

/** L2 —— 语言算子（本仓库是 TypeScript/JavaScript）。 */
export const L2_OPERATORS: readonly MutationOperator[] = Object.freeze([
  { id: 'seq-to-sneq', layer: 'L2', kind: 'equality', find: '===', replace: '!==' },
  { id: 'sneq-to-seq', layer: 'L2', kind: 'equality', find: '!==', replace: '===' },
  { id: 'nullish-to-or', layer: 'L2', kind: 'coalescing', find: '??', replace: '||' },
  { id: 'await-dropped', layer: 'L2', kind: 'async', find: 'await ', replace: '', note: '丢弃 await 后 Promise 不再被等待，套件若不断言顺序/完成就抓不到' },
])

export const L1_LAYER = L1_OPERATORS
export const L2_LAYER = L2_OPERATORS

export const DEFAULT_OPERATORS: readonly MutationOperator[] = Object.freeze([
  ...L1_OPERATORS,
  ...L2_OPERATORS,
])

/**
 * 这些算子的变异体在【部分上下文里】与原文语义相同。
 *
 * ★ 标记 ≠ 排除（R2）：它们【照样进分母】。排除它们会让分数变好看，而"变好看"
 *   正是这里最不能做的事 —— 一次等价判定出错，就会把真实的覆盖缺口抹掉。
 *   标记的用途只有一个：让人审计一份低分时不必重新推导"这个存活体为什么活着"。
 *
 * ★ 为什么两个方向都标：一次比较的边界（`>` vs `>=`）与量词的重数是【极易不可
 *   观测】的 —— 套件碰巧用的输入里，两者对每一个断言都给出同样的结果。
 */
export const OFTEN_EQUIVALENT: ReadonlySet<string> = new Set([
  'ge-to-gt',
  'gt-to-ge',
  'le-to-lt',
  'lt-to-le',
  'seq-to-sneq',
  'sneq-to-seq',
  'plus-to-minus',
])

/**
 * L3 —— 项目契约变异体：违反契约 C，而不是改一个符号。
 *
 * ★ 定义由【项目】给（本仓库的契约清单见 `scripts/mutation-invariants.mjs`），
 *   执行机制由这里给。这不是可选的：L3 的条目必然随项目变化，把它硬编码进机制
 *   就等于把项目语义塞进通用层。
 *
 * `expectRed` / `expectRedExact` 是 R3 的落点：实测过一次【手写的 expect_red 是
 * 错的】—— 真正变红的是另外两个文件。所以声明了就得核对；对不上就是 violation，
 * 不是"反正是红的"。
 */
export interface MutantInvariant {
  readonly id: string
  readonly invariant: string
  readonly contract: string
  readonly file: string
  readonly find: string
  readonly replace: string
  readonly expectRed?: readonly string[]
  readonly expectRedExact?: boolean
}

export interface InvariantDefinition {
  id?: string
  invariant?: string
  contract?: string
  file?: string
  mutate?: { find?: string; replace?: string }
  expect_red?: string[]
  expect_red_exact?: boolean
}

export interface Mutant {
  readonly id: string
  readonly layer: MutationLayer
  readonly operator: string
  readonly kind: string
  /** 被变异的文件（workspace 相对）；L3 由定义给出。 */
  readonly file?: string
  /** 1-based 行号。 */
  readonly line?: number
  readonly find: string
  readonly replace: string
  /** ★ L1/L2：把原文这一段替换后的【完整文本】。契约违反体没有这个字段 —— 它不是一个替换。 */
  readonly mutated?: string
  readonly oftenEquivalent: boolean
  readonly invariant?: string
  readonly contract?: string
  readonly expectRed?: readonly string[]
  readonly expectRedExact?: boolean
}

/** 被变异文件里的一个行区间（1-based，含两端）。 */
export interface LineRange {
  readonly startLine: number
  readonly endLine: number
}

/** 一条变异体的运行观察，由调用方注入的 runSuite 产出。 */
export interface MutantRun {
  readonly exitCode: number
  readonly stdout?: string
  readonly stderr?: string
  readonly timedOut?: boolean
}

/** 一条变异体的裁决输入：观察 + 它变红了哪些文件。 */
export interface MutantResult {
  readonly mutant: Mutant
  readonly outcome: MutantOutcome
  /** 说清这个 outcome 是怎么来的（"3 failing" / "baseline was red" / ...）。 */
  readonly reason: string
  /** ★ 变红的文件。没有红文件就不能说"是这条变异体被杀了"。 */
  readonly killedBy: readonly string[]
  /** ★ R2：等价只是【标记】，不是排除。 */
  readonly equivalent?: boolean
}

/** 一组变异体该由哪个套件来杀 —— 见 probeReach。 */
export interface SuiteTarget {
  readonly id: string
  readonly files: readonly string[]
}

/** 被变异文件的位置：文件 + 范围。★ 范围是必填的（R1）。 */
export interface MutationTarget {
  readonly file: string
  readonly source: string
  readonly startLine: number
  readonly endLine: number
  /** 这份 source 是怎么来的（git 证据 / 调用方直接给的文本）。 */
  readonly sourceFrom: 'git' | 'inline'
  readonly changedLines?: readonly number[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 生成
// ─────────────────────────────────────────────────────────────────────────────

/** 1-based, inclusive. 行号按 `\n` 数，与 git diff 的语义一致。 */
export function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1
  return line
}

/**
 * 把 `--lines` 的语义变成一个行谓词。
 *
 * ★ 范围【必须在源文本里】，不能靠调用方自觉：一份 500 行的文件只改了一行时，
 *   全体变异的分数是关于那 500 行的，而不是关于那次改动的。两者在报告里同形。
 */
export function inRange(line: number, range: LineRange): boolean {
  return line >= range.startLine && line <= range.endLine
}

/** 某一行是否在【改动行】集合里。改动的定义来自调用方（git 证据，不是猜的）。 */
export function isChangedLine(line: number, changedLines: readonly number[] | undefined): boolean {
  if (changedLines === undefined) return true
  return changedLines.includes(line)
}

/**
 * 近似但保守的注释判定：`index` 是否落在一段 // 或 /* *\/ 注释里。
 *
 * 为什么要它：把注释里的 `+` 改成 `-` 生成的不是变异体，是【文本编辑】——
 * 它【永远不会红】，于是它必然"存活"，于是覆盖率被一堆假存活体拉低。
 * 这不是保守的方向，这是把噪声当信号。
 */
export function isInsideComment(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  let inString: string | null = null
  for (let i = lineStart; i < index; i += 1) {
    const ch = text[i]
    if (inString !== null) {
      if (ch === '\\') i += 1
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch
      continue
    }
    if (ch === '/' && text[i + 1] === '/') return true
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      if (close === -1 || close > index) return true
      i = close + 1
    }
  }
  const blockOpen = text.lastIndexOf('/*', index)
  if (blockOpen !== -1) {
    const blockClose = text.lastIndexOf('*/', index)
    if (blockClose < blockOpen) return true
  }
  return false
}

/** 同一行内 `index` 之前有没有未闭合的引号 ⇒ 它在字符串字面量里。 */
export function isInsideString(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  let inString: string | null = null
  for (let i = lineStart; i < index; i += 1) {
    const ch = text[i]
    if (inString !== null) {
      if (ch === '\\') i += 1
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') inString = ch
  }
  return inString !== null
}

/**
 * 这个出现位置该不该跳过？
 *
 * ★ 理由不是"避免误报"，是【一个语法错误也会变红】—— 而那种红证明不了任何关于
 *   断言的事。把语法错误算成"测试杀死了变异体"，是在给覆盖率注水。
 *
 * ★ MEASURED（本任务夹具抓到的真实缺陷）：`after` 必须从 `index + operator.length`
 *   起算，不能从 `index` 起算。第一版写的是 `text.slice(index, index + 3)` ——
 *   那个切片【永远以算子自身开头】，于是 `after.startsWith('=')` 对 `>=` 判断的是
 *   "`>` 后面是不是 `=`"（对），但对【单独一个 `>`】（如 `return value > 0`）判断的
 *   是"`>` 后面是不是 `>`" —— 永远为真 ⇒ **`gt-to-ge` 一条都生不出来**。
 *   实测后果：`value > 0` 这种最常见的边界比较完全进不了分母，而报告读起来
 *   与"这里没有被覆盖"完全同形。这是"算子静默失效"，不是"没有可变异的东西"。
 */
export function isSkippableOccurrence(operatorId: string, text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 2), index)
  /** 算子【之后】的文本。长度按各算子取，见下面每个 case 的注释。 */
  const restAfter = (length: number): string => text.slice(index + length, index + length + 3)
  const lengthOf = (id: string): number => {
    switch (id) {
      case 'plus-to-minus':
      case 'true-to-false':
        return 4
      case 'false-to-true':
        return 5
      case 'seq-to-sneq':
      case 'sneq-to-seq':
        return 3
      case 'nullish-to-or':
        return 2
      default:
        return 1
    }
  }
  const after = restAfter(lengthOf(operatorId))

  if (isInsideComment(text, index)) return true

  switch (operatorId) {
    case 'plus-to-minus':
      // `++` / `+=` 不是我们想变的那个二元 `+`
      if (before.endsWith('+') || after.startsWith('+')) return true
      break
    case 'ge-to-gt':
      // `>>=`：`>=` 前面还有一个 `>`
      if (before.endsWith('>')) return true
      break
    case 'gt-to-ge':
      // `>=` / `>>` 是另一种算子；`=>`（箭头函数）不是比较
      if (before.endsWith('=') || after.startsWith('=') || after.startsWith('>')) return true
      break
    case 'le-to-lt':
      // `<<=`：`<=` 前面还有一个 `<`
      if (before.endsWith('<')) return true
      break
    case 'lt-to-le':
      // `<=` / `<<`
      if (after.startsWith('=') || after.startsWith('<')) return true
      break
    case 'and-to-or':
    case 'or-to-and':
      // `&&=` / `||=`
      if (after.startsWith('=')) return true
      break
    case 'seq-to-sneq':
    case 'sneq-to-seq':
      // `====`（多余等号）或 `!==` 里的 `===`
      if (before.endsWith('=') || before.endsWith('!')) return true
      break
    case 'nullish-to-or':
      // `??=`、`?.` 都与 `??` 不是一回事
      if (after.startsWith('=') || after.startsWith('.')) return true
      break
    case 'true-to-false':
      // 标识符的一部分（`isTrue` / `trueValue`）不是布尔字面量
      if (/[\w$]/.test(before.slice(-1)) || /[\w$]/.test(after.slice(0, 1))) return true
      break
    case 'false-to-true':
      if (/[\w$]/.test(before.slice(-1)) || /[\w$]/.test(after.slice(0, 1))) return true
      break
    case 'await-dropped':
      /**
       * `await ` 出现在注释或字符串里已经被上面拦下。这里只拦一种：
       * 它前面紧挨着 `.`（如 `x.await `）不合法，保留判断即可。
       */
      break
    default:
      break
  }

  // ★ 字符串字面量里的符号是【数据】不是逻辑：改它不会改变任何行为。
  if (isInsideString(text, index)) return true

  return false
}

export interface GenerateOptions {
  startLine: number
  endLine: number
  /** 只变异这些行（git 证据）。缺省 = 整个范围。 */
  changedLines?: readonly number[]
  operators?: readonly MutationOperator[]
  /** 同一个算子最多产出几条（避免一个文件里 200 个 `+` 把分母撑爆）。 */
  maxPerOperator?: number
  file?: string
}

/**
 * 在【改动行范围】内生成 L1/L2 变异体。
 *
 * ★ R1 是这样落地的：`startLine..endLine` 先过滤行号，`changedLines` 再过滤改动。
 *   两者都缺席时才会变异整个文件 —— 而调用方（判据）在拿不到 git 证据时【不是】
 *   退回全文件，而是 unmeasured。不让机制层替它做这个决定。
 */
export function generateMutants(source: string, options: GenerateOptions): Mutant[] {
  const {
    startLine,
    endLine,
    changedLines,
    operators = DEFAULT_OPERATORS,
    maxPerOperator = 25,
    file,
  } = options

  const mutants: Mutant[] = []
  for (const op of operators) {
    let from = 0
    let emitted = 0
    while (emitted < maxPerOperator) {
      const index = source.indexOf(op.find, from)
      if (index === -1) break
      from = index + op.find.length

      const line = lineOf(source, index)
      if (line < startLine || line > endLine) continue
      if (!isChangedLine(line, changedLines)) continue
      if (isSkippableOccurrence(op.id, source, index)) continue

      mutants.push({
        id: `${op.id}@L${line}`,
        layer: op.layer,
        operator: op.id,
        kind: op.kind,
        ...(file === undefined ? {} : { file }),
        line,
        find: op.find,
        replace: op.replace,
        mutated: source.slice(0, index) + op.replace + source.slice(index + op.find.length),
        oftenEquivalent: OFTEN_EQUIVALENT.has(op.id),
      })
      emitted += 1
    }
  }
  return mutants
}

/**
 * 把【声明的】L3 契约违反体载成变异体。
 *
 * ★ 声明缺件是【错误】而不是跳过：静默跳过一个坏定义，等于报告一份"L3 全覆盖"
 *   而 L3 一个都没测 —— 这与本文件存在的理由（证明测试真的在测）直接冲突。
 */
export function loadInvariants(definitions: readonly InvariantDefinition[]): { mutants: Mutant[]; errors: string[] } {
  const errors: string[] = []
  const mutants: Mutant[] = []
  for (const def of definitions) {
    const label = def.id === undefined || def.id === '' ? '<no id>' : def.id
    for (const field of ['id', 'invariant', 'contract', 'file'] as const) {
      if (def[field] === undefined || def[field] === '') errors.push(`invariant ${label}: missing required field "${field}"`)
    }
    if (def.mutate?.find === undefined || def.mutate.find === '' || def.mutate.replace === undefined) {
      errors.push(`invariant ${label}: mutate requires { find, replace }`)
      continue
    }
    mutants.push({
      id: `L3:${label}`,
      layer: 'L3',
      operator: `L3:${label}`,
      kind: 'contract',
      file: def.file,
      find: def.mutate.find,
      replace: def.mutate.replace,
      oftenEquivalent: false,
      invariant: def.invariant,
      contract: def.contract,
      ...(def.expect_red === undefined ? {} : { expectRed: def.expect_red }),
      ...(def.expect_red_exact === undefined ? {} : { expectRedExact: def.expect_red_exact }),
    })
  }
  return { mutants, errors }
}

/**
 * 核对每个 L3 因子的锚点【真的在它声明的文件里】。
 *
 * ★ 锚点找不到 ⇒ 硬错误。静默跳过它，就会在"契约被删了/片段漂移了"的时候
 *   报告一份满分的 L3 覆盖 —— 那正好是我们最该看见的那次失效。
 */
export function verifyAnchors(
  mutants: readonly Mutant[],
  readFile: (path: string) => string,
): string[] {
  const problems: string[] = []
  for (const mutant of mutants) {
    if (mutant.layer !== 'L3') continue
    const file = mutant.file ?? ''
    let text: string
    try {
      text = readFile(file)
    } catch (error) {
      problems.push(`invariant ${mutant.id}: cannot read ${file} (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    const count = countOccurrences(text, mutant.find)
    if (count === 0) {
      problems.push(
        `invariant ${mutant.id}: anchor not found in ${file}. 契约 "${mutant.contract ?? ''}" 声称 ${mutant.invariant ?? ''} 被守着，` +
          `而代码里已经没有这段文本了 —— 契约被删了，或片段漂移了。这必须被解决，不能被跳过。`,
      )
    } else if (count > 1) {
      problems.push(`invariant ${mutant.id}: anchor appears ${count} times in ${file}; expected exactly 1（歧义锚点让变异不可复现）`)
    }
  }
  return problems
}

function countOccurrences(text: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const index = text.indexOf(needle, from)
    if (index === -1) break
    count += 1
    from = index + needle.length
  }
  return count
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ 探针射程：杀手套件够不到被变异文件
// ─────────────────────────────────────────────────────────────────────────────

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
}

export interface LayerScore {
  total: number
  killed: number
  survived: number
  errored: number
  unmeasured: number
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

/**
 * 把逐条观察汇成报告。**这是本模块唯一的裁决点。**
 *
 * ★ 三条判定顺序（每一条都防住一种把"没测到"并进"通过/不通过"的写法）：
 *
 *   ① 基线红 / 还原失败 / 探针够不到 —— 任何一条在场 ⇒ 整体 unmeasured。
 *      放在最前面，是因为它们污染【其余全部数字】：一份在污染下标出来的分数，
 *      精确到小数点后三位也是废的。
 *   ② 一条可计分变异体都没有（范围内没有算子，全是注释/声明）⇒ unmeasured，
 *      **不是 1.0**。实测形态：一次全是文档的改动会读成"代码被完全覆盖"。
 *   ③ 有可计分变异体 ⇒ measured，分数 = killed / scored。
 *
 * ★ 等价体【进分母】（R2）。把 `!r.equivalent` 过滤掉就是自我粉饰。
 */
export function scoreMutants(input: ScoreInput): MutationReport {
  const { target, results } = input
  const probeProblem = input.probeProblem ?? null
  const baselineProblem = input.baselineProblem ?? null
  const restoreVerified = input.restoreVerified ?? null

  const scored = results.filter((result) => result.outcome === 'killed' || result.outcome === 'survived')
  const errored = results.filter((result) => result.outcome === 'error')
  const unmeasuredRuns = results.filter((result) => result.outcome === 'unmeasured')
  const killed = scored.filter((result) => result.outcome === 'killed')
  const survived = scored.filter((result) => result.outcome === 'survived')
  const equivalent = results.filter((result) => result.equivalent === true)

  const byLayer = {} as Record<MutationLayer, LayerScore>
  for (const layer of ['L1', 'L2', 'L3'] as const) {
    const inLayer = scored.filter((result) => result.mutant.layer === layer)
    const layerKilled = inLayer.filter((result) => result.outcome === 'killed')
    const layerErrored = errored.filter((result) => result.mutant.layer === layer)
    const layerUnmeasured = unmeasuredRuns.filter((result) => result.mutant.layer === layer)
    byLayer[layer] = {
      total: inLayer.length,
      killed: layerKilled.length,
      survived: inLayer.length - layerKilled.length,
      errored: layerErrored.length,
      unmeasured: layerUnmeasured.length,
      score: inLayer.length === 0 ? null : round(layerKilled.length / inLayer.length),
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
    unmeasuredReasons.push(`${unmeasuredRuns.length} 条变异体的运行没有给出可解释的结果（${unmeasuredRuns.map((r) => r.mutant.id).join(', ')}）`)
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

  if (scored.length === 0) {
    return {
      disposition: 'unmeasured',
      unmeasured:
        `改动行范围 ${target.file}:${target.startLine}-${target.endLine} 里没有一条可计分的变异体` +
        `（${results.length} 条候选，全部落在注释/字符串/无算子区域）—— 这是"这次测量无话可说"，不是"完全覆盖"`,
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
    mutationScore: round(killed.length / scored.length),
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
    maxMutants = 200,
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
    totals: { considered: 0, scored: 0, killed: 0, survived: 0, errored: 0, equivalent: 0, unmeasured: 0 },
    byLayer: {
      L1: { total: 0, killed: 0, survived: 0, errored: 0, unmeasured: 0, score: null },
      L2: { total: 0, killed: 0, survived: 0, errored: 0, unmeasured: 0, score: null },
      L3: { total: 0, killed: 0, survived: 0, errored: 0, unmeasured: 0, score: null },
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

  const selected = all.slice(0, maxMutants)
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

