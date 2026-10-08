/**
 * ── dispatch 位置的接线（t70：从 update-task.ts 拆出）──────────────────────────────
 *
 * ── ★★ 为什么拆（理由是量化的）──────────────────────────────────────────────────
 *
 * `update-task.ts` 是 **1120 行**的单文件，装着 contract / dispatch / completion
 * **三个插入点**的 ctx 构造。而它今晚**连续挡住了 5 条任务**（t54 · t59 · t64 · t67 ·
 * 以及它自己）—— 每一次挡住都让**另一条任务必须等**，而不是让它们并行。
 *
 * ★ 而它与 t39 同源：那次拆 `tools.ts` 时留下的表写着"冲突面 16 → 2"，
 *   而那「2」就是从那时起的这个瓶颈 —— 它从"设计里标注的下一步"变成了**真实的阻塞源**。
 *
 * ── ★★★ 而搬运必须【逐行】证明接线还在 ──────────────────────────────────────────
 *
 * MEASURED（同一个错犯过两次）：t39 拆 `tools.ts` 时把 t41 的接线**搬回了旧版**
 * （`gitChangedPaths: workspaceAndWorktreeChangedPaths(workspace)`
 *   → `gitChangedPaths: gitChangedPaths(workspace)`），而**没有任何东西报** ——
 * 直到几小时之后 t56 的成员被那条拒绝挡住。
 * ★ 而 2026-10-08 00:25 并入 t54 时，**同一行又被覆盖了一次**。
 *
 * ⇒ 所以本文件是被 `scripts/gate-update-task-injections.test.mjs` **逐行钉住**的：
 *   那个夹具把拆前的 **17 格注入**（字段名 + 右侧表达式）抽成清单，
 *   而 `dispatch` 的这 4 格是其中一组。
 *   ★ 而那条护栏是**在动第一行之前先被证明会红**的（删掉一行 / 换成旧版，两种都实测）。
 *
 * ── 本模块只做一件事 ──────────────────────────────────────────────────────────
 *
 *   把 dispatch 位置要的 ctx 构造出来、核对它的输入面、并求值。
 *   ★ 而它**不改变任何语义** —— 逐字搬运，唯一的差别是"这些东西从哪来"。
 */
import type { GateEvaluation } from '../../gates/registry.ts';
/** dispatch 位置需要的、来自调用方的输入。 */
export interface DispatchWiringInput {
    /** 被更新的任务（耐久态里那一条）。 */
    task: unknown;
    /**
     * 成员这一次申报的改动。
     * ★ 类型是 `string[] | undefined` —— 与**调用方实际的类型**一致（不是我挑一个更好看的）。
     *   ⇒ 于是块内的 `changedPaths: input.changedPaths` 可以**逐字**保留。
     */
    changedPaths: string[] | undefined;
    /** 调用方（成员）的会话 —— 观察面之一读它。 */
    caller: {
        session: never;
    };
    /** 工作区根（`observeWorkspaces` 遍历它）。 */
    workspace: string;
    /** 判据注册表（注入进来，而不是本模块去取单例）。 */
    registry: {
        evaluate: (point: 'dispatch', ctx: unknown) => Promise<GateEvaluation>;
    };
}
/** 一次 dispatch 求值的全部产出（调用方据此决定流程）。 */
export interface DispatchWiringResult {
    /** ★ `recordFriction` 要用它（"卡点发生时当场记账"那一格）。 */
    context: unknown;
    inputSurface: unknown;
    gates: GateEvaluation;
}
/**
 * 构造 dispatch 位置的 ctx、核对它、求值。
 *
 * ★ 返回**两样**（核对结论 + 裁决），与本体原先"构造一次、用两次"的口径一致 ——
 *   写成两份字面量会让"核对的 ctx"与"求值的 ctx"在一次改动之后分叉。
 */
export declare function wireDispatch(input: DispatchWiringInput): Promise<DispatchWiringResult>;
