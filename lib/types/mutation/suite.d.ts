import type { MutantOutcome } from './operators.ts';
import type { Mutant, MutantRun, MutationTarget, SuiteTarget } from './generate.ts';
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
