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
import { type TaskStatus, type TeamTask } from '../types.ts';
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
 * ── S1：completion 判据结果的**落盘形状**（`TeamTask.gateEvaluation`）──────────────
 *
 * ★★ 为什么**不复用** `src/gates/registry.ts` 的 `GateEvaluation` 类型，而是在这里
 *   声明一份**结构相同**的形状：`src/types.ts` 是一个**零 import 的叶子**
 *   （t24 立的规矩，且有夹具逐字断言它）—— 它不能 import 别的模块；而本文件
 *   （state 层）正是判据结果与任务记录**交汇**的地方，落盘形状住在这里
 *   与 `gateEvaluationRecordOf`（同文件）零距离。
 *   ★ 与 `FailureKindName` 那条取舍同族：类型复制必须有机械保障 ——
 *   `gateEvaluationRecordOf` 的入参类型逐字段对着 `registry.ts` 的 `GateEvaluation`，
 *   字段改名/删除的那一天，编译当场红。
 *
 * ★ 字段集是 `GateEvaluation` 的**持久化投影**（不是全抄）：
 *   · `ran` 原样保留 —— `skipped` 条目保留为 `verdict: 'skipped'`（"判据没跑"是记录，
 *     不是丢掉）；`observed` 原样保留（"开火了、被放过"必须可读，符号表 #4 的数据源）。
 *   · `outputs` 保留 —— 判据的**产物**（如 verify-rerun 的 reruns）本来就是数据流的一部分。
 *   · `requires` 的投影保留（计数 + 人话清单，去掉当场日志才需要的 `checks[]`）—— S2 转发 /state 时要用。
 *   · **不保留**：`context`（太大、且属于"当时那一刻"，不是结论）。
 *
 * ★ 三态在**这个形状本身**上就是可读的（见 `TeamTask.gateEvaluation` 的长注释）：
 *   字段缺席 / `ran: []` / 有内容 —— 三者由**读取端**直接分辨，不需要第二套字段。
 */
export interface GateEvaluationRecord {
    /** 整体裁决：本次求值有没有产出【位置级】的拒绝。 */
    ok: boolean;
    /** 位置级 blocker 原文（`[gate.id] …`）。空数组 = 没有位置级拒绝。 */
    blockers: string[];
    /** 判据【跑了】而说"测不了"时的原文；缺席 = 没有"测不了"。 */
    unmeasured?: string;
    /**
     * 逐条判据的结论，按注册顺序。
     * ★ `skipped` 条目**原样保留**（"判据没跑"是记录，不是丢掉）——
     *   它与"这条判据不存在"必须不同形（`registry.ts:136` 逐字警告过）。
     */
    ran: GateRunEntryRecord[];
    /** 判据自己的产物（键 = 判据 id）。**空对象 ≠ 缺席**：缺席 = 没有任何产物。 */
    outputs: Record<string, Record<string, unknown>>;
    /** 这次真的跑了（`verdict ≠ 'skipped'`）几条。`0` 且 `registered > 0` ⇒ 全跳过。 */
    evaluated: number;
    /** 这次被 `appliesTo` 跳过几条。`evaluated + skipped` = 本次涉及的判据总数。 */
    skipped: number;
    /** 该位置挂了几条判据（与上下文无关）。`0` = 空位置（正常情形）。 */
    registered: number;
    /** 「挂了判据却一条没跑」的人话说明；缺席 = 不是这个情形（空位置不产出它）。 */
    skippedAll?: string;
    /** 观察模式下开火并被放过的条数；缺席 = 这次没有（或没在观察）。 */
    observedBlockers?: number;
    /** 被放过的裁决原文（观察模式）；缺席 = 没有。 */
    observed?: {
        blockers?: readonly string[];
        unmeasured?: readonly string[];
    };
    /** 输入面核对结论（结构 = `registry.ts` 的 `RequiresAuditFieldView` 的持久化投影）。 */
    requires?: GateRequiresSummary;
}
/** 输入面核对结论的**落盘投影**（`registry.ts` 的 `RequiresAuditFieldView` 去掉 `checks[]` —— 那是给当场日志的，落盘只留计数与人话清单）。 */
export interface GateRequiresSummary {
    checked: number;
    incomplete: number;
    skipped: number;
    notApplicable: number;
    inputSurfaceAbsent: number;
    /** 缺了格子的（接线缺陷）人话清单。 */
    missing: string[];
    /** 声明缺口（`appliesTo` 读了、`requires` 没声明）清单 —— 与 `missing` 不同形。 */
    gateCellsUndeclared: string[];
}
/** 逐条判据的落盘条目（结构 = `registry.ts` 的 `GateRunEntry`，见上为何重声明）。 */
export interface GateRunEntryRecord {
    id: string;
    verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped';
    count?: number;
    produced?: boolean;
    /** 「开火了、裁决被观察模式放过」；缺席 = 不是这个情形（不许用 false 冒充缺席）。 */
    observed?: boolean;
}
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
 * ── S1：把 `gateEvaluation` 挂上 `TeamTask`（module augmentation）──────────────────
 *
 * ★ 为什么用 augmentation 而不是改 `src/types.ts`：本任务的 inScope 不含 `types.ts`
 *   （它在零 import 叶子的纪律下由独立任务持有写域）；而**落盘形状**必须与
 *   `TeamTask` 同处一个命名空间，读取端（S2 的 /state、D 线的卡点消费）才能
 *   从 `task.gateEvaluation` 直接读。
 * ★ TS 的 interface merging 是**结构性的**：声明合并后 `task.gateEvaluation`
 *   在所有消费者眼里与"定义在 types.ts 里"逐字等价 —— 包括 `JSON.stringify`
 *   的序列化行为（它由对象本身决定，与声明住在哪个文件无关）。
 * ★ 风险如实记下：`TeamTask` 若在 types.ts 改名，这里的 augment 会静默失联
 *   （TS 报 "cannot find name"，不会静默）⇒ 编译期兜底，不是运行期。
 */
declare module '../types.ts' {
    interface TeamTask {
        /**
         * ── ★★★ S1：completion 位置判据结果的【落盘】（此前：求值 → 裁决 → 丢弃）────────
         *
         * MEASURED（t69 实测、队长复核）：`completion` 位置的判据只在
         * `src/tools/update-task/completion.ts` 的 `registry.evaluate('completion', …)`
         * 求值一次；它的结果曾用于【那一次】裁决，然后**没有任何地方持久化到 task**。
         * ⇒ B 线"按成员呈现判据"缺的不是 UI，是【服务端没有按任务落盘的判据结果】。
         *
         * ── ★★ 三态（本任务的中心判据，三者必须不同形）────────────────────────────────
         *
         *   · **字段缺席**   —— 这一代（attempt）还**没有走过一次带求值的 update**，
         *                      或上一次的读数已被 `clearAttemptResult` 拔掉（retry/reassign）。
         *   · **`ran` 全 skipped** —— 求值了，但一条判据都没跑（`skippedAll` 在场）。
         *   · **有内容**     —— 求值了，`ran[]` 里有带裁决的条目。
         *
         * ★★ **不许把"没求值"写成"求值了且通过"**：投影原样抄 `ran[]` ——
         *   `skipped` 条目保留为 `verdict: 'skipped'`（不是丢掉、更不是翻成 ok），
         *   `observed` 原样保留（"开火了、被放过"必须可读，符号表 #4 的数据源）。
         *
         * ★ 与 `auto`（卡点台账）的 `taskId`/`teamId`（t69）**是两件事**：
         *   那个是【卡点台账】的归属落盘；这个是【任务自己】的判据结果落盘。
         * ★ 与 `TeamTask.verdict` 不同轴：那是"这次更新被不被接受"的裁决；
         *   这个是"判据看到了什么"的记录。
         */
        gateEvaluation?: GateEvaluationRecord;
    }
}
