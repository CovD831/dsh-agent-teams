import type { MutantOutcome, MutationLayer, MutationOperator } from './operators.ts';
export declare function capMutants<T>(items: readonly T[], max: number): T[];
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
    /**
     * 基线实际执行到的行，按【被变异文件】的路径索引（1-based）。
     *
     * ★ 只在【基线】那一次有意义。三态不许并：
     *   · 缺席 ⇒ 再看 stdout 里有没有覆盖报告；两处都指不出 ⇒ 整批 unmeasured。
     *   · 在场（含空对象、含某文件的空数组）⇒ 采到了。
     *     文件缺席，或行号不在列表里 ⇒ 那一行没被执行（未覆盖，不是存活）。
     *   · 形状不对 ⇒ 同样是指不出，整批 unmeasured。
     *     ★ 不许把「没采到」读成「都执行了」或「都没执行」。
     */
    readonly executedLines?: Readonly<Record<string, readonly number[]>>;
    /**
     * 基线能指出的【逐测试】行覆盖。
     *
     * file → 行号（十进制字符串或数字键）→ 执行了那一行的测试，顺序就是早停顺序。
     *
     * ★ 缺席，或这一行没有名单 ⇒ 分不清，整份已覆盖套件照跑。
     *   不许从 killerSuites 里猜一条，当成它盖住了这一行。
     * ★ 这一行的名单是空数组 ⇒ 基线指出没有任何测试碰到它。不跑，也不另猜一条。
     * ★ 名单非空 ⇒ 变异体只跑这些测试；其中一条杀死，其余不跑。
     */
    readonly testsByLine?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
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
