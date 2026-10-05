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
export type MutantOutcome = 'killed' | 'survived' | 'error' | 'unmeasured';
/** 一条变异算子。`find` 在【改动行范围】内首次出现的位置被替换成 `replace`。 */
export interface MutationOperator {
    readonly id: string;
    readonly layer: MutationLayer;
    readonly kind: string;
    readonly find: string;
    readonly replace: string;
    readonly note?: string;
}
export type MutationLayer = 'L1' | 'L2' | 'L3';
/**
 * L1 —— 与语言无关的算子。任何文本都安全。
 *
 * ★ 每个符号【两个方向都要有】：实测（外部借鉴项目的同一形态）只列单向时，
 *   `gt-to-ge` 有而 `ge-to-gt` 没有，于是一批"边界不可观测"的变异体在分母里
 *   只出现一次 —— 分数被这个不对称抬高。
 */
export declare const L1_OPERATORS: readonly MutationOperator[];
/** L2 —— 语言算子（本仓库是 TypeScript/JavaScript）。 */
export declare const L2_OPERATORS: readonly MutationOperator[];
export declare const L1_LAYER: readonly MutationOperator[];
export declare const L2_LAYER: readonly MutationOperator[];
export declare const DEFAULT_OPERATORS: readonly MutationOperator[];
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
export declare const OFTEN_EQUIVALENT: ReadonlySet<string>;
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
    readonly id: string;
    readonly invariant: string;
    readonly contract: string;
    readonly file: string;
    readonly find: string;
    readonly replace: string;
    readonly expectRed?: readonly string[];
    readonly expectRedExact?: boolean;
}
export interface InvariantDefinition {
    id?: string;
    invariant?: string;
    contract?: string;
    file?: string;
    mutate?: {
        find?: string;
        replace?: string;
    };
    expect_red?: string[];
    expect_red_exact?: boolean;
}
export interface Mutant {
    readonly id: string;
    readonly layer: MutationLayer;
    readonly operator: string;
    readonly kind: string;
    /** 被变异的文件（workspace 相对）；L3 由定义给出。 */
    readonly file?: string;
    /** 1-based 行号。 */
    readonly line?: number;
    readonly find: string;
    readonly replace: string;
    /** ★ L1/L2：把原文这一段替换后的【完整文本】。契约违反体没有这个字段 —— 它不是一个替换。 */
    readonly mutated?: string;
    readonly oftenEquivalent: boolean;
    readonly invariant?: string;
    readonly contract?: string;
    readonly expectRed?: readonly string[];
    readonly expectRedExact?: boolean;
}
/** 被变异文件里的一个行区间（1-based，含两端）。 */
export interface LineRange {
    readonly startLine: number;
    readonly endLine: number;
}
/** 一条变异体的运行观察，由调用方注入的 runSuite 产出。 */
export interface MutantRun {
    readonly exitCode: number;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly timedOut?: boolean;
}
/** 一条变异体的裁决输入：观察 + 它变红了哪些文件。 */
export interface MutantResult {
    readonly mutant: Mutant;
    readonly outcome: MutantOutcome;
    /** 说清这个 outcome 是怎么来的（"3 failing" / "baseline was red" / ...）。 */
    readonly reason: string;
    /** ★ 变红的文件。没有红文件就不能说"是这条变异体被杀了"。 */
    readonly killedBy: readonly string[];
    /** ★ R2：等价只是【标记】，不是排除。 */
    readonly equivalent?: boolean;
}
/** 一组变异体该由哪个套件来杀 —— 见 probeReach。 */
export interface SuiteTarget {
    readonly id: string;
    readonly files: readonly string[];
}
/** 被变异文件的位置：文件 + 范围。★ 范围是必填的（R1）。 */
export interface MutationTarget {
    readonly file: string;
    readonly source: string;
    readonly startLine: number;
    readonly endLine: number;
    /** 这份 source 是怎么来的（git 证据 / 调用方直接给的文本）。 */
    readonly sourceFrom: 'git' | 'inline';
    readonly changedLines?: readonly number[];
}
/** 1-based, inclusive. 行号按 `\n` 数，与 git diff 的语义一致。 */
export declare function lineOf(text: string, index: number): number;
/**
 * 把 `--lines` 的语义变成一个行谓词。
 *
 * ★ 范围【必须在源文本里】，不能靠调用方自觉：一份 500 行的文件只改了一行时，
 *   全体变异的分数是关于那 500 行的，而不是关于那次改动的。两者在报告里同形。
 */
export declare function inRange(line: number, range: LineRange): boolean;
/** 某一行是否在【改动行】集合里。改动的定义来自调用方（git 证据，不是猜的）。 */
export declare function isChangedLine(line: number, changedLines: readonly number[] | undefined): boolean;
/**
 * 近似但保守的注释判定：`index` 是否落在一段 // 或 /* *\/ 注释里。
 *
 * 为什么要它：把注释里的 `+` 改成 `-` 生成的不是变异体，是【文本编辑】——
 * 它【永远不会红】，于是它必然"存活"，于是覆盖率被一堆假存活体拉低。
 * 这不是保守的方向，这是把噪声当信号。
 */
export declare function isInsideComment(text: string, index: number): boolean;
/** 同一行内 `index` 之前有没有未闭合的引号 ⇒ 它在字符串字面量里。 */
export declare function isInsideString(text: string, index: number): boolean;
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
export declare function isSkippableOccurrence(operatorId: string, text: string, index: number): boolean;
export interface GenerateOptions {
    startLine: number;
    endLine: number;
    /** 只变异这些行（git 证据）。缺省 = 整个范围。 */
    changedLines?: readonly number[];
    operators?: readonly MutationOperator[];
    /** 同一个算子最多产出几条（避免一个文件里 200 个 `+` 把分母撑爆）。 */
    maxPerOperator?: number;
    file?: string;
}
/**
 * 在【改动行范围】内生成 L1/L2 变异体。
 *
 * ★ R1 是这样落地的：`startLine..endLine` 先过滤行号，`changedLines` 再过滤改动。
 *   两者都缺席时才会变异整个文件 —— 而调用方（判据）在拿不到 git 证据时【不是】
 *   退回全文件，而是 unmeasured。不让机制层替它做这个决定。
 */
export declare function generateMutants(source: string, options: GenerateOptions): Mutant[];
/**
 * 把【声明的】L3 契约违反体载成变异体。
 *
 * ★ 声明缺件是【错误】而不是跳过：静默跳过一个坏定义，等于报告一份"L3 全覆盖"
 *   而 L3 一个都没测 —— 这与本文件存在的理由（证明测试真的在测）直接冲突。
 */
export declare function loadInvariants(definitions: readonly InvariantDefinition[]): {
    mutants: Mutant[];
    errors: string[];
};
/**
 * 核对每个 L3 因子的锚点【真的在它声明的文件里】。
 *
 * ★ 锚点找不到 ⇒ 硬错误。静默跳过它，就会在"契约被删了/片段漂移了"的时候
 *   报告一份满分的 L3 覆盖 —— 那正好是我们最该看见的那次失效。
 */
export declare function verifyAnchors(mutants: readonly Mutant[], readFile: (path: string) => string): string[];
export interface ProbeReach {
    /** 能杀这条变异体的套件文件。空数组 ⇒ 够不到。 */
    readonly files: readonly string[];
    /** ★ 观测到的：这些套件里提到过被变异文件。 */
    readonly observed: boolean;
    /** 这个结论是怎么来的。 */
    readonly reason: string;
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
export declare function probeReach(target: Pick<MutationTarget, 'file'>, candidates: readonly SuiteTarget[], readSuite: (path: string) => string): ProbeReach;
export interface TestSummary {
    pass: number | null;
    fail: number | null;
    total: number | null;
    format: 'tap' | 'spec' | 'vitest' | 'unknown';
}
/** 解析测试框架的汇总行（node:test 的 TAP / spec，以及 vitest/jest 风格）。 */
export declare function parseTestSummary(output: string): TestSummary;
/**
 * 把跑完的测试输出变成一组【变红的文件】。
 *
 * ★ 文本扫描而不是逐文件重跑：默认格式里没有"结构化"的失败清单。
 */
export declare function failingFiles(output: string): string[];
/**
 * 一次变异体运行的分类。
 *
 * ★ 三件事【不是】杀：
 *   · 挂起（超时）—— 它既不是红也不是绿，把它算成任一边都是发明。
 *   · 汇总解析不出来 —— 一次"没能测量"，不是"测试发现了"。
 *   · 基线本来就红 —— 一个本来就红的套件对任何变异体都"红"，那不能归功于变异体。
 */
export declare function classifyRun(run: MutantRun, mutant: Mutant, options?: {
    baselineRed?: boolean;
    redFilesInBaseline?: readonly string[];
}): {
    outcome: MutantOutcome;
    reason: string;
    killedBy: string[];
};
export type MutationDisposition = 
/** 实测到了：套件杀掉了部分/全部变异体 ⇒ 这是一个关于测试的判断。 */
'measured'
/** ★ 没测成：套件够不到 / 没有可变异的东西 / 基线不可用 ⇒ 绝不能变成"全存活"。 */
 | 'unmeasured';
export interface MutationTotals {
    considered: number;
    scored: number;
    killed: number;
    survived: number;
    errored: number;
    /** ★ R2：被【标记】为可能等价，但【仍然计分】。 */
    equivalent: number;
    unmeasured: number;
}
export interface LayerScore {
    total: number;
    killed: number;
    survived: number;
    errored: number;
    unmeasured: number;
    /** null = 这一层没有可计分的变异体（不是 0 分，也不是满分）。 */
    score: number | null;
}
export interface SurvivingMutant {
    id: string;
    layer: MutationLayer;
    operator: string;
    file: string | null;
    line: number | null;
    find: string;
    replace: string;
    invariant: string | null;
    oftenEquivalent: boolean;
}
export interface ExpectRedViolation {
    mutant: string;
    declared: readonly string[];
    actuallyRed: readonly string[];
    missing: readonly string[];
    note: string;
}
export interface MutationReport {
    /** ★ 三态：measured 才有分数；unmeasured 时 mutationScore 必须是 null。 */
    disposition: MutationDisposition;
    /** 未测量的原因（disposition=unmeasured 时必填）。 */
    unmeasured?: string;
    /** null = 没测成或无可计分变异体。★ 绝不用 1 / 100 代替。 */
    mutationScore: number | null;
    totals: MutationTotals;
    byLayer: Record<MutationLayer, LayerScore>;
    survivingMutants: SurvivingMutant[];
    expectRedViolations: ExpectRedViolation[];
    /** 探针射程的问题（够不到 = unmeasured 的候选；读不到 = 未测量）。 */
    probeProblems: string[];
    /** 变异体全部存活时，必须说清"覆盖范围"是什么。 */
    coverage: {
        file: string;
        startLine: number;
        endLine: number;
        linesMutated: number;
        mutantsInRange: number;
    };
}
export interface ScoreInput {
    target: Pick<MutationTarget, 'file' | 'startLine' | 'endLine'>;
    results: readonly MutantResult[];
    /** ★ 未测量的事实：探针够不到 SUT。给出来就【不是】报告全存活。 */
    probeProblem?: string | null;
    /** 反事实检查失败（变异体没能还原）—— 一次没还原的测量不可信。 */
    restoreVerified?: boolean | null;
    /** 基线本来就红：kill rate 的每个数字都不成立。 */
    baselineProblem?: string | null;
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
export declare function scoreMutants(input: ScoreInput): MutationReport;
/**
 * 分数是否落到"测试是装饰性的"那一档？
 *
 * ★ 这个判据只在 disposition=measured 时有意义。unmeasured 时**不许**调用它 ——
 *   那正是"把探针的失败报成被测物的失败"。所以它在 unmeasured 下直接抛错，
 *   而不是返回一个看起来合理的布尔。
 */
export declare function isDecorative(report: MutationReport, threshold: number): boolean;
export interface MutationEngineInput {
    /** 要被变异的位置（文件 + 改动行范围）。范围是必填的 —— 见 R1。 */
    target: MutationTarget;
    /** 跑一遍杀手套件。由调用方注入（判据不做 I/O）。 */
    runSuite: () => Promise<MutantRun>;
    /**
     * 应用 / 还原一条变异体。★ 每一步都必须被验证还原 —— 一次没还原的测量
     * 既不干净也不可信，且会污染之后每一条测量。
     */
    apply: (mutant: Mutant) => Promise<{
        ok: boolean;
        reason?: string;
    }>;
    restore: () => Promise<{
        ok: boolean;
        verified: boolean;
        reason?: string;
    }>;
    /** 杀手套件的候选，用于射程判定。 */
    suites: readonly SuiteTarget[];
    readSuite: (path: string) => string;
    /** L3 契约违反体的定义。 */
    invariants?: readonly InvariantDefinition[];
    /** 读 L3 定义里指到的文件（核对锚点）。 */
    readFile: (path: string) => string;
    /** 镜像套件：把一条变异体同时应用到这些文件（如 src 与它的编译产物 lib）。 */
    mirrors?: readonly string[];
    mirrorContent?: (path: string, mutatedText: string) => string;
    operators?: readonly MutationOperator[];
    /** 基线本来就红了哪些文件（一次"本来就红的套件"对任何变异体都红，那不算杀）。 */
    redFilesInBaseline?: readonly string[];
    /** 超过这个条数就截断（截断必须被报告，不能默默拉低分母）。 */
    maxMutants?: number;
}
/**
 * 跑一遍变异测试，产出报告。
 *
 * ★ 顺序是有意的：一切"能不能测"的前置检查都在【注入任何变异体之前】完成。
 *   一个在污染状态下跑出来的分数，精确到小数点后三位也是废的。
 */
export declare function runMutationEngine(input: MutationEngineInput): Promise<MutationReport>;
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
export declare function mirrorMutants(mutants: readonly Mutant[], mirrors: readonly string[], mutator?: (path: string, mutatedText: string) => string): Mutant[];
/** 范围内没有可计分变异体时的原因。★ 措辞必须是"无话可说"，不是"完全覆盖"。 */
export declare function noScorableMutants(target: Pick<MutationTarget, 'file' | 'startLine' | 'endLine'>): string;
