/**
 * ── 判据：verify 由判据层重跑，不采信成员自报的 exitCode ──────────────────────────
 *
 * 插入点：`completion`（成员汇报完成时）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-05，gate-probe 探针，上游 v0.1.22）：一个成员【零真实工作】，
 * 提交两条 acceptanceResults 全 passed（evidence 里直接写 "FABRICATED"）+ 两条
 * commandsRun 全 passed（exitCode 填伪造的 0，命令根本没跑，产物文件不存在），
 * 任务被判 completed —— 与真实完成（t3 干净基线）在判据层【不可区分】。
 *
 * 根因：`evaluateQualityCompletion` 只比对【条数与 status】，而 status/exitCode
 * 都是【成员自报的】。那等于把判据的输入交给被判的一方。
 *
 * ── 它为什么是一条【判据】而不是编排里的一个特例 ────────────────────────────────
 *
 * 这条逻辑最初硬编码在 `tools.ts` 的 update_task 里。搬进注册表后：
 *   · 编排层只调 `registry.evaluate('completion', ctx)`，不知道有这条判据；
 *   · 换/删这条判据不改编排代码；
 *   · 它有自己的三臂夹具（`verify-rerun.test.mjs`），进 verify 链。
 *
 * ── 执行器由调用方注入（保持判据本身是纯数据变换）──────────────────────────────
 *
 * 判据不 import 任何 I/O。它从 context 里取 `execVerifyCommand`；缺席时返回
 * `unmeasured`（★ 不是 `ok`）—— 没能重跑就不能声称验过了。
 */
import { type GateVerdict } from '../registry.ts';
export declare const id = "completion.verify-rerun";
export declare const point = "completion";
export declare const description = "\u91CD\u8DD1\u4EFB\u52A1\u58F0\u660E\u7684 verify \u547D\u4EE4\uFF0C\u4E0E\u6210\u5458\u81EA\u62A5\u7684 exitCode \u6BD4\u5BF9\uFF1B\u4E0D\u4E00\u81F4\u5373\u62D2\u7EDD\uFF08\u9632\u6B62\u4F2A\u9020 passed\uFF09";
/**
 * 只对【本次试图置为 completed】且【声明了 verify 命令】的【非终态】任务生效。
 *
 * ★ 三个条件的由来，每条都有实测依据：
 *   · 非 completed 的中间状态不重跑 —— 没有裁决要复核；
 *   · ★ 任务【已经是终态】不重跑 —— issue159 的补证据路径：那是往已完成的任务上
 *     追加署名证据，不是一次新的完成裁决。重跑会用它今天的结果重新审判历史结论
 *     （实测：lifecycle-verify 的 issue159 夹具因此被误拒）；
 *   · 没声明 verify 的任务不重跑 —— 没有可重跑的东西。
 */
export declare function appliesTo(ctx: VerifyRerunContext | undefined): boolean;
interface VerifyRerunContext {
    task?: {
        id?: string;
        verify?: string[];
        commandsRun?: CommandResult[];
    };
    update?: {
        commandsRun?: CommandResult[];
    };
    execVerifyCommand?: (command: string) => Promise<number>;
    /** ★ 调用方表达的意图：本次是否试图置为 completed（判据据此决定要不要跑）。 */
    wantsCompleted?: boolean;
    /** ★ 任务当前是否非终态（终态补证据不是新的完成裁决）。 */
    taskNotTerminal?: boolean;
}
interface CommandResult {
    command: string;
    status?: string;
    exitCode?: number;
    evidence?: string;
}
export declare function gate(ctx: VerifyRerunContext): Promise<GateVerdict>;
export {};
