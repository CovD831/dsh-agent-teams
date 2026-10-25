import type { MutationLayer, MutationOperator } from './operators.ts';
import type { InvariantDefinition, Mutant, MutantResult, MutantRun, MutationTarget, SuiteTarget } from './generate.ts';
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
    /**
     * 基线没执行到的行上的变异体。不进 `survived`，也不进 `killed`。
     * ★ 仍留在分数的分母里 —— 把它们剔出分母会把杀伤率抬高。
     */
    uncovered: number;
}
export interface LayerScore {
    total: number;
    killed: number;
    survived: number;
    errored: number;
    unmeasured: number;
    /** 这一层里基线没执行到的变异体。不进 survived。 */
    uncovered: number;
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
export interface CoverageFileReading {
    /** 保留目录前缀的相对路径（posix）。basename 相同的两个文件靠它分开。 */
    readonly file: string;
    /** 1-based。空 = 报告点了这个文件，且没有未执行行。 */
    readonly uncoveredLines: readonly number[];
}
/**
 * 把「指不出覆盖」说成未测量，并且把两种假读显式否定掉。
 * ★ 缺了后半句，调用方可以把这句话再读成「都存活」或「都没覆盖」。
 */
export declare function coverageUnmeasured(detail: string): string;
/**
 * Node `--experimental-test-coverage` 的 spec/TAP 表。
 *
 * 目录是单独一行、没有百分比；文件行按缩进挂在目录下面。两个同名 `mutation.js`
 * 只靠缩进才分得开 —— 把前缀剥掉再按 basename 合并，就会被折成 ambiguous。
 *
 * `null` = 输出里根本没有这份报告（没采到，不是「空覆盖」）。
 * `{ ok: false }` = 报告在，但有一行读不准 —— 整份作废，不许把读漏的行当成已覆盖。
 */
export declare function parseNodeCoverageReport(output: string): {
    ok: true;
    files: CoverageFileReading[];
} | {
    ok: false;
    reason: string;
} | null;
/**
 * 用相对路径对上唯一文件。basename 相同不算冲突：`lib/mutation.js` 与
 * `src/gates/completion/mutation.js` 是两个文件。对不上、或目录前缀对上了
 * 不止一个 ⇒ 这个文件 unmeasured，【不是】整批 ambiguous。
 */
export declare function matchCoverageFile(files: readonly CoverageFileReading[], file: string): {
    status: 'measured';
    uncoveredLines: readonly number[];
} | {
    status: 'unmeasured';
};
/**
 * 读调用方交来的 `executedLines`。
 *
 * `absent` = 字段不在（还可以再看覆盖报告）。
 * `malformed` = 在，但指不出一份行表。
 * 对象 = 采到了（允许空）。
 */
export declare function readExplicitExecutedLines(value: MutantRun['executedLines'] | null): Readonly<Record<string, readonly number[]>> | 'absent' | 'malformed';
type TestLineMap = Readonly<Record<string, readonly string[]>>;
/**
 * 读 `testsByLine`。`absent` / `malformed` 都是「指不出逐测试」——
 * 调用方必须退回整份套件，不许把坏掉的名单当成一份覆盖。
 */
export declare function readExplicitTestsByLine(value: MutantRun['testsByLine'] | null): Readonly<Record<string, TestLineMap>> | 'absent' | 'malformed';
/**
 * stdout 里的逐测试块。没有这块 ⇒ `null`（不是空覆盖）。
 * 开了头却读不准 ⇒ `malformed`，整块作废，不许用已经读到的那几行去猜。
 *
 *     start of per-test coverage
 *     <file>:<line> <test> [<test>...]
 *     end of per-test coverage
 */
export declare function parsePerTestCoverageBlock(output: string): Readonly<Record<string, TestLineMap>> | null | 'malformed';
export type LineCoverageReading = 'run' | 'uncovered' | 'unmeasured-file';
export interface MutationCoverage {
    /**
     * 这一行跑不跑。
     * `run` = 基线执行到了（或行号对不上，照旧跑，不把「对不上」说成未覆盖）。
     * `uncovered` = 点了名，且这一行没执行。
     * `unmeasured-file` = 报告没提到这个文件，或目录前缀对上了不止一个。
     *   ★ 只记这个文件，不取消别的文件。
     */
    line(file: string, line: number | undefined): LineCoverageReading;
    /**
     * 碰到这一行的测试。
     * `null` = 指不出（整份已覆盖套件照跑，不许猜）。
     * 空数组 = 基线指出没有任何测试碰到它。
     */
    testsFor(file: string, line: number | undefined): readonly string[] | null;
}
/**
 * 基线跑完之后，改动行有没有被执行、以及（仅当点了名时）是哪些测试执行的。
 *
 * 指不出【行】⇒ `unmeasured`，整批不能计分。
 * 行指得出、测试指不出 ⇒ 仍然成功：`testsFor` 返回 null，调用方跑整份套件。
 *
 * ★ 显式 `executedLines` / `testsByLine` 优先于文本。调用方已经对过账，就不要再猜。
 */
export declare function resolveMutationCoverage(run: Pick<MutantRun, 'stdout' | 'stderr' | 'executedLines' | 'testsByLine'>): MutationCoverage | {
    readonly unmeasured: string;
};
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
export {};
