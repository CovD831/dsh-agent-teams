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
import { inputSurfaceOf } from "../shared/entities.js";
import { observeWorkspaces, observedChangedPaths } from "../../harness-compat.js";
/**
 * 构造 dispatch 位置的 ctx、核对它、求值。
 *
 * ★ 返回**两样**（核对结论 + 裁决），与本体原先"构造一次、用两次"的口径一致 ——
 *   写成两份字面量会让"核对的 ctx"与"求值的 ctx"在一次改动之后分叉。
 */
export async function wireDispatch(input) {
    /**
     * ★★ MEASURED（护栏当场抓到的）：我第一版把块搬到模块里时，**顺手改了两处表达式** ——
     *   `[...input.changedPaths]` 与 `input.caller.session as never`。
     *   ★ 而 `gate-update-task-injections` **当场报了两条 `wrong-expr`**。
     *
     *   ⇒ ★ 那正是它存在的理由，也正是 t39 与并入 t54 两次事故的形状：
     *     **丢的不是格名，而是格的右侧。** 而我这次是**改名**（不是搬旧版），
     *     形状不同、后果同族：**接线指向了与拆前不同的东西。**
     *   ⇒ 修法：把入参**拆成与原来同名的局部量**，于是块内一个字都不用改。
     */
    const caller = input.caller;
    const task = input.task;
    const workspace = input.workspace;
    const registry = input.registry;
    const observed = observeWorkspaces(workspace);
    const dispatchContext = {
        task: input.task,
        update: { changedPaths: input.changedPaths },
        observedChangedPaths: observedChangedPaths(caller.session),
        /**
         * ── ★★ 第二观察面（t17）─────────────────────────────────────────────────
         *
         * 会话事件只看得见**本 session** 的写入。而"写入发生在别的 session"
         * （captain 用 `cp` 并入、成员被 retire 后换人）与"零工作却自报改动"
         * 在 `observedChangedPaths === []` 时**同形** —— 于是一个诚实的申报
         * 被读成虚报，每一个被重派/并入的 attempt 都交不出终态。
         *
         * ⇒ 补一格"别处"的证据：工作区里到底脏没脏。改动**真的存在**这件事
         *   与"是谁写的"无关，而 git 知道。
         *
         * ★ 三态与前一格逐条对齐：读不到 git ⇒ `undefined` ⇒ 这一格**不参与判定**
         *   （判定退回原口径，**不是**放宽）。
         */
        /**
         * ★★ RESTORED（2026-10-08 00:25）：这两行在 f8fc671 被【搬回旧版】——
         *   而那是 captain 并入 t54 时的误操作（t54 的 worktree 基线早于 t59 的接线）。
         *   ⇒ ★ 形态与 t39 那次【完全相同】：纯搬运把别人刚接好的线覆盖回旧版。
         *   ★ 而这次它【没有静默】—— t62 的臂 1b 当场抓到并指名到行。
         */
        gitChangedPaths: observed?.paths,
        /**
         * ★ 而"看了几棵树"与"看到哪些路径"出自【同一次遍历】——
         *   把它们拆成两次调用会让两个读数分叉，而分叉之后
         *   "扫了 5 棵"与"5 棵里只有 1 棵读到了"在读数上同形。
         */
        observedWorkspaces: observed?.workspaces,
    };
    const dispatchInputSurface = inputSurfaceOf('dispatch', dispatchContext);
    const dispatchGates = await input.registry.evaluate('dispatch', dispatchContext);
    return { context: dispatchContext, inputSurface: dispatchInputSurface, gates: dispatchGates };
}
