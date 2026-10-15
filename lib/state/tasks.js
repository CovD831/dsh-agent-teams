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
import { randomUUID } from 'node:crypto';
import { TERMINAL_TASK_STATUSES, } from "../types.js";
/**
 * The allowed task status transitions, keyed by current status.
 * Terminal statuses have no outgoing transitions.
 */
export const TASK_TRANSITIONS = {
    pending: ['claimed', 'cancelled'],
    claimed: ['in_progress', 'failed', 'cancelled'],
    in_progress: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
};
/**
 * Validate one task status transition.
 * @param current - the task's current status.
 * @param next - the requested status.
 * @returns the transition error, or undefined when allowed.
 */
export function transitionError(current, next) {
    if (current === next)
        return undefined;
    if (!TASK_TRANSITIONS[current].includes(next)) {
        return `task status cannot move from "${current}" to "${next}"`;
    }
    return undefined;
}
/**
 * ── ★★ t74：这些落盘形状**不再在这里声明** ────────────────────────────────────
 *
 * `GateEvaluationRecord` · `GateRequiresSummary` · `GateRunEntryRecord`
 * 现在**只在** `src/types.ts` 里声明，本文件 `import type` 使用它们。
 *
 * ★ 为什么删的是**这一份**（而不是 types.ts 那份）：
 *   `TeamTask.gateEvaluation` 绑定的是 **`types.ts` 那份**（`TeamTask` 与它同文件，
 *   见 `lib/types/types.d.ts`）⇒ 那份是**活的**；本文件这份是**重复声明**。
 *   ★ 而两处**可以各自漂移**：改一处忘另一处就是「类型说 A、运行期给 B」，
 *     而**两者都编译得过**（它们是两个独立类型，编译器不会替你发现）——
 *     这正是 t65 为 `VisualTaskState` 删掉的那类缺陷。
 *
 * ★ 本文件**本来就 import `../types.ts`**（见下方 import 行）⇒ 这次改动
 *   **零新依赖、零新环**：`src/types.ts` 仍是零 import 的叶子（我们没往它加 import）。
 * ★ 而原先那段「为什么不复用」的论证已随之作废 —— 那条论证说
 *   「types.ts 不能 import 别的模块，所以形状只能住在这里」，
 *   但**形状本来就住在 types.ts 里**（TeamTask 就在那儿）⇒ 前提不成立。
 *   那正是这份重复的成因：以为自己在"必要时才复制"，实际是复制了一份已经存在的。
 */
/** Execution results belong to one attempt; a retry must produce its own evidence. */
function clearAttemptResult(task) {
    task.output = undefined;
    task.verdict = undefined;
    task.findings = undefined;
    task.changedPaths = undefined;
    task.acceptanceResults = undefined;
    task.commandsRun = undefined;
    /**
     * ── S1：判据结果与其它执行产物**同一代际** ──────────────────────────────────
     *
     * `task.gateEvaluation` 记的是【那一次求值】看到的判据结论。一次 retry/reassign
     * 开始新的一代 ⇒ 旧读数不再代表现在 —— 留着它，会让"上一次的判据结论"与
     * "这一次还没跑"在读取端同形。
     * ★ 与 `clearAttemptResult` 的其它行同一条纪律：清 = 拔掉旧一代的读数，
     *   而 `executions[]`（历史）不受影响 —— 那是有意保留的过去。
     */
    task.gateEvaluation = undefined;
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
export function gateEvaluationRecordOf(evaluation) {
    return {
        ok: evaluation.ok,
        blockers: [...evaluation.blockers],
        ...evaluation.unmeasured === undefined ? {} : { unmeasured: evaluation.unmeasured },
        ran: evaluation.ran.map(entry => ({
            id: entry.id,
            verdict: entry.verdict,
            ...entry.count === undefined ? {} : { count: entry.count },
            ...entry.produced === undefined ? {} : { produced: entry.produced },
            ...entry.observed === undefined ? {} : { observed: entry.observed },
        })),
        outputs: Object.fromEntries(Object.entries(evaluation.outputs).map(([id, given]) => [id, { ...given }])),
        evaluated: evaluation.evaluated,
        skipped: evaluation.skipped,
        registered: evaluation.registered,
        ...evaluation.skippedAll === undefined ? {} : { skippedAll: evaluation.skippedAll },
        ...evaluation.observedBlockers === undefined ? {} : { observedBlockers: evaluation.observedBlockers },
        observed: {
            blockers: [...evaluation.observed.blockers],
            unmeasured: [...evaluation.observed.unmeasured],
        },
        requires: {
            checked: evaluation.requires.checked,
            incomplete: evaluation.requires.incomplete,
            skipped: evaluation.requires.skipped,
            notApplicable: evaluation.requires.notApplicable,
            inputSurfaceAbsent: evaluation.requires.inputSurfaceAbsent,
            missing: [...evaluation.requires.missing],
            gateCellsUndeclared: [...evaluation.requires.gateCellsUndeclared],
        },
    };
}
/** Activate the task's current generation for one owner and return its capability id. */
export function activateTaskAttempt(task, assignee) {
    const attemptId = randomUUID();
    task.status = 'claimed';
    task.assignee = assignee;
    task.attemptId = attemptId;
    task.handoffId = undefined;
    task.reassigning = false;
    clearAttemptResult(task);
    task.updatedAt = Date.now();
    return attemptId;
}
/** Start a fresh task generation for one owner. */
export function beginTaskAttempt(task, assignee) {
    task.attempt = (task.attempt ?? 0) + 1;
    /**
     * ── ★★★ 新的一代开始 ⇒ 上一代那次投递失败【不再代表现在】（t43）──────────────
     *
     * ★ 清了它，`deliveryFailure` 在场就【一定】意味着【当前这一代没能送达】——
     *   而一条旧的失败原因与"现在仍然是坏的"必须不同形。
     *   ★ 而这里是唯一正确的清点：`attempt` 刚被推进，所以旧记录属于上一代。
     */
    delete task.deliveryFailure;
    return activateTaskAttempt(task, assignee);
}
/**
 * Revoke the current worker immediately. Clearing its capability makes old
 * updates stale; a separate handoff generation serializes async quiescence.
 */
/** Cancel one unfinished task without returning it to the ready pool. */
export function cancelUnfinishedTask(task, output) {
    if (TERMINAL_TASK_STATUSES.includes(task.status))
        return;
    task.status = 'cancelled';
    task.attemptId = undefined;
    task.handoffId = undefined;
    task.reassigning = false;
    if (output !== undefined)
        task.output = output;
    task.updatedAt = Date.now();
}
export function invalidateTaskAttempt(task, nextAssignee, reassigning = false) {
    task.attemptId = undefined;
    task.handoffId = randomUUID();
    task.status = 'pending';
    task.assignee = nextAssignee;
    task.reassigning = reassigning;
    clearAttemptResult(task);
    task.updatedAt = Date.now();
}
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
