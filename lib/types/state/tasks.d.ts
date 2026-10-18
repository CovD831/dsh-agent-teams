/**
 * ── S-B · 任务状态机（M4 从 `state.ts` 拆出）────────────────────────────────────
 *
 * 内容：`TASK_TRANSITIONS` 与那套「任务怎么从一态走到另一态」的动作
 * （`transitionError` / `activateTaskAttempt` / `beginTaskAttempt` /
 *  `cancelUnfinishedTask` / `invalidateTaskAttempt`，含私有 helper `clearAttemptResult`）。
 *
 * ★ 这是 M1 地图 §1 的 **S3**，落成 **S-B**（`docs/MODULE-MAP.md` 的 M4 一行）。
 * ★ **零外部依赖**：实测该块**不引用** `state.ts` 里任何其它顶层声明
 *   （脚本逐名核过），只需要 `TERMINAL_TASK_STATUSES` + `randomUUID` + 两个类型。
 *   ⇒ 搬出来不需要任何"内部耦合"的妥协。
 * ★ `state.ts` 仍**逐条再导出**它们 ⇒ 对外导出面不变（老消费者一字不改）。
 */
import { type GateEvaluationRecord, type TaskStatus, type TeamTask } from '../types.ts';
/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export declare const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>>;
/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export declare function transitionError(current: TaskStatus, next: TaskStatus): string | undefined;
/**
 * ── S1：把 `registry.evaluate()` 的裁决投影成**落盘形状**（`TeamTask.gateEvaluation`）─
 *
 * ★ 为什么是**投影**而不是原样塞入：求值对象上挂着 `requires.checks[]`
 *   （逐条判据的当场核对明细，含 present/skippedBecause）—— 那是**当场日志**的形状，
 *   落盘只留**计数 + 人话清单**（`missing` / `gateCellsUndeclared`）。
 *   ✔ 明细没了不影响 S2 的按成员呈现（B 线读的是 `ran[]` 与计数）；
 *   ✔ 每轮任务少存一大块当场日志（team.json 是持久文件，不是日志文件）。
 *
 * ★ 三态由**调用方**保证：本函数只在【真的求值过】时被调用，且它**原样抄写**
 *   `ran[]`（`skipped` 条目保留为 `verdict: 'skipped'`，`observed` 原样保留）——
 *   "没求值"（字段缺席）与"求值了"（字段在场）在形状上就分开。
 */
export declare function gateEvaluationRecordOf(evaluation: {
    ok: boolean;
    blockers: string[];
    unmeasured?: string;
    ran: readonly {
        id: string;
        verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped';
        count?: number;
        produced?: boolean;
        observed?: boolean;
        reason?: string;
    }[];
    outputs: Record<string, Record<string, unknown>>;
    evaluated: number;
    skipped: number;
    registered: number;
    skippedAll?: string;
    observedBlockers?: number;
    observed: {
        blockers: string[];
        unmeasured: string[];
    };
    requires: {
        checked: number;
        incomplete: number;
        skipped: number;
        notApplicable: number;
        inputSurfaceAbsent: number;
        missing: string[];
        gateCellsUndeclared: string[];
    };
}): GateEvaluationRecord;
/** Activate the task's current generation for one owner and return its capability id. */
export declare function activateTaskAttempt(task: TeamTask, assignee: string): string;
/** Start a fresh task generation for one owner. */
export declare function beginTaskAttempt(task: TeamTask, assignee: string): string;
/**
 * Revoke the current worker immediately. Clearing its capability makes old
 * updates stale; a separate handoff generation serializes async quiescence.
 */
/** Cancel one unfinished task without returning it to the ready pool. */
export declare function cancelUnfinishedTask(task: TeamTask, output?: string): void;
export declare function invalidateTaskAttempt(task: TeamTask, nextAssignee?: string, reassigning?: boolean): void;
/**
 * ── ★★ t74：这段 module augmentation 已删除（它是【同一个字段的第三份声明】）──
 *
 * 原文把 `gateEvaluation` 通过 `declare module '../types.ts'` 挂上 `TeamTask`，
 * 理由是"本任务不改 `types.ts`，所以只能 augment"。
 *
 * ★ 但**前提不成立**：`src/types.ts:566` 的 `TeamTask` **本来就声明了**
 *   `gateEvaluation?: GateEvaluationRecord` ⇒ augmentation 是**冗余的**。
 *   ★ 实测：把整段删掉 `tsc --noEmit` **仍 exit=0**（字段照样解析得到）。
 *
 * ★ 为什么删它也是**必要的**（不只是洁癖）：它让"这个字段有几个声明"变成 **3** 处
 *   （`types.ts` 的接口体 + 这里的 augment + 上面已删的本文件接口），
 *   而 augment 与真声明**漂移时不会红** —— 与上面三个接口是同一类缺陷。
 * ★ 附带：augmentation 本身会**拖入对模块声明的依赖**，而 `types.ts` 是零 import 叶子
 *   （t24 规矩）；删掉它后本文件对 `types.ts` 只剩**纯 type import**，方向单一。
 */
