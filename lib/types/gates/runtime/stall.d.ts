/**
 * ── C4：机械化的停滞哨兵（t6）────────────────────────────────────────────────────
 *
 * 契约原话：*"a mechanical stall sentinel … It decides 'the task has stopped' by:
 * the same (taskId, attemptId) rejected by the same gate >= N times (N injectable,
 * default 2), or sitting in in_progress beyond N rounds. … It must NOT rely on a
 * member honestly reporting that it is stuck."*
 *
 * ── 它防的是什么（用户原话，这份文件的全部依据）────────────────────────────────────
 *
 * > 「卡点就是让任务停下来的地方……而很多停下来的卡点，都是可以自己去解决的。」
 *
 * ★★ 而"任务停下来了"**不能**靠成员自报：一个卡住的成员**恰恰是最不可能
 *   如实报告"我卡住了"的那一个**（它可能一直在重试、也可能已经放弃但还在产出日志）。
 *   ⇒ 所以本判据读的是**机械的事实**：任务记录上那个已经被数出来的拒绝次数与状态。
 *
 * ── ★★★ 判据的输入是【C1 已经解码好的状态】，不是重新数一遍 ────────────────────────
 *
 * `TaskStall`（`src/types.ts` 里那个零 import 的叶子）逐字带着：
 *
 *     state: 'trying' | 'stalled'   ← ★ C1 已经判完了
 *     count: number                 ← 这个 `(task, gate)` 被拒了几次（含第一次）
 *     gate? / point                 ← 是谁拒的（读不出来 ⇒ 缺席，不猜）
 *
 * ⇒ ★★ 本判据**不重新实现**那个计数：本仓最贵的一条纪律是"一个判据只有一个来源"
 *   （`docs/GATE-REGISTRY.md`；t6 三次失败的记录里也有它）。
 *   再数一遍就是**第二份真相**，而两份会漂移。
 *
 * ── ★★★ 为什么可以直接读 `ctx.team.tasks[].stall`（而不是 import C1 的纯函数）──────
 *
 * MEASURED（t6 attempt 4，本 worktree 的基线 88d1bdd）：
 *
 *     `src/tools/shared/entities.ts:27  import { registry } from '../../gates/index.ts'`
 *
 * ⇒ 若本判据 `import { observeStall } from '../../tools/shared/entities.ts'`，
 *   就形成 **cycle**：`gates/runtime/stall.ts → tools/shared/entities.ts → gates/index.ts → 本文件`。
 *   ★ 而 gates 层今天**不 import 任何 tools/**（`grep -rn "from '../../tools" src/gates/` 为空）——
 *     那条纯度是**载荷**，不是风格。
 *
 * ⇒ ★ 而**不需要**那个 import：`TaskStall` 住在 `src/types.ts`（**零 import 的叶子**），
 *   运行时判据经由 `ctx.team` 拿到**整个 TeamState**（`evaluateRuntimeGates` 把
 *   `source.team` 原样交给判据）⇒ 本判据直接读那个**已经解码好**的字段。
 *   ★ 于是既没有 cycle，也没有第二份计数 —— 两个约束同时满足。
 *
 * ── ★★ 它【不能拒绝任务】，而那是**类型**保证的，不是约定 ──────────────────────────
 *
 * `evaluateRuntimeGates` 在 runtime 位置**只记录、不拒绝**（契约 §5）。
 * 而 liveness 依赖"约定 + 调用方"来避免拒绝 —— t6 要比它**更强**：
 * 本文件导出的 `gate` 的返回类型被**收窄到 `GateVerdict` 里不拒绝的那一半**
 * （`StallVerdict`，见下）。⇒ ★ 一个 `return blocked([...])` 在这里是**TS2322**，
 *   而不是一次 code review 才能发现的事。验收第 2 条点名的就是这一格。
 *
 * @module dsh-agent-teams/gates/runtime/stall
 */
import type { TeamTask } from '../../types.ts';
import type { CtxPaths } from '../requires.ts';
export declare const id = "runtime.stall";
export declare const point = "runtime";
export declare const description: string;
/**
 * ── ★★★ 本判据的返回类型：**不拒绝的那一半**（验收第 2 条）───────────────────────
 *
 * `GateVerdict` 是三态联合，其中 `{ok:false; blockers:[...]}` 是"拒绝"。
 * ★ 把返回类型收窄到**排除那一支** ⇒ "本判据不能拒绝"从一个**约定**
 *   变成**编译期的事实**：写 `return blocked([...])` 当场 TS2322。
 *
 * ★ 为什么不是"把 GateVerdict 改宽/改窄"：那是**共享**类型，别的判据需要那一支。
 *   这里收窄的是**本文件导出的那一个函数**的签名。
 */
export type StallVerdict = {
    ok: true;
    [produced: string]: unknown;
} | {
    ok: false;
    unmeasured: string;
};
/** 本判据开口的事件白名单（与 liveness 同一形状：判据自己决定说不说话）。 */
export declare const STALL_EVENTS: readonly string[];
/**
 * ── ★ 默认 N（同一个 (task, gate) 被拒几次算"停下来"）───────────────────────────
 *
 * 契约原话：*"N injectable, default 2"*。
 * ★ 而**可注入**这一条是有历史的：`docs/PENDING-FRICTION-REFORM.md` 逐字写着
 *   「N 必须可注入」—— 一个写死的阈值会在别的仓库形态里要么永远不响、要么吵个不停，
 *   而两种都读不出来（一个恒不响的哨兵与没装它在观测上同形）。
 */
export declare const DEFAULT_STALL_ROUNDS = 2;
export interface RuntimeStallContext {
    /** 六个调用点里 discriminator 之一；本判据只在 {@link STALL_EVENTS} 上开口。 */
    event?: string;
    /**
     * ── ★ 团队面：**整个 TeamState**（`tasks[]` 是本判据唯一真正需要的东西）───────
     *
     * ★ 缺席 ⇒ **没能测量**（不是"没人停住"）：那说明这一轮没接上团队。
     *   `team.tasks` 缺席 ⇒ 同样 `unmeasured` —— "观察面没给我"与"我看了、没人停住"
     *   必须不同形，而前者被读成后者就是一个**恒不响的哨兵**。
     */
    team?: {
        id?: string;
        tasks?: TeamTask[];
    };
    /**
     * ── ★★ N：可注入（验收第 3 条）────────────────────────────────────────────────
     *
     * 缺席或非法 ⇒ {@link DEFAULT_STALL_ROUNDS}（**绝不抛错**：一个判据不该
     * 因为配置没给而炸掉整个 runtime 位置）。
     * ★ 而它同时**进入读数**（`threshold` 随产出交出去）——
     *   `docs/PENDING-FRICTION-REFORM.md` §6 那条：**一个数必须与它的量具一起读**，
     *   否则"被拒 3 次"在 N=2 与 N=5 下读起来一样，而它们的含义相反。
     */
    rounds?: number;
}
export declare const requires: CtxPaths<RuntimeStallContext>[];
/** N 的解析：非法/缺省 ⇒ 默认值（**不抛错** —— 见上面那段）。 */
export declare function stallRoundsOf(raw: number | undefined): number;
export declare function appliesTo(ctx: RuntimeStallContext | undefined): boolean;
export interface StallObservation {
    taskId: string;
    /** 这个 `(task, gate)` 被拒了几次（**直接来自 C1 的读数**，本判据不重数）。 */
    count: number;
    /** 谁拒的（可能缺席 —— 读不出来就不猜，见 C1 的 `unknown` basis）。 */
    gate?: string;
    point?: string;
    /**
     * 它是怎么被判为停下的：`repeats`（同一个 (task,gate) 被拒 ≥ N 次）
     * 或 `rounds`（在 in_progress 上超过 N 轮）。★ 两种**不同形** ——
     * 因为补救动作不同：一个去看那条判据为什么反复拒，一个去看这个任务为什么一直没完成。
     */
    basis: 'repeats' | 'rounds';
}
/**
 * ── 判据本体 ────────────────────────────────────────────────────────────────────
 *
 * ★★ 返回类型是 {@link StallVerdict} —— **它排除了 `blockers` 那一支**。
 *   于是"本判据不能拒绝任务"是**编译期**的事实（验收第 2 条）。
 */
export declare function gate(ctx: RuntimeStallContext): StallVerdict;
