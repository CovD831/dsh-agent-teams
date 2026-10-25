import type { TaskKind } from '../types.ts';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolsConfig } from './shared/entities.ts';
/**
 * ── ★★★ 哪种 kind 要求哪些契约格（t22）────────────────────────────────────────────
 *
 * ★★ 与 `validateCreateTask` **同源**：那一条是质量 kind 要 `objective`+`acceptance`、
 *   写类 kind 要 `inScope`+`verify`。这里把**同一套判据**按"缺哪几格"的形状返回。
 *
 * ★ 为什么返回的是**清单**而不是一个布尔：
 *   验收要求"拒绝时**指名**缺的是哪几格"。一个只说"契约不完整"的拒绝会让下一个人
 *   去猜 —— 而"猜"在这里的后果是**编一个文件集合**（t1 那位成员正确地拒绝了去猜）。
 */
export declare const WRITE_KINDS: readonly TaskKind[];
export interface ContractRequirement {
    /** 这个 kind 要求哪些格（空数组 = 明确不要求）。 */
    required: readonly string[];
    /** ★ 缺了的那几格（人类可读的名字）。空数组 = 齐的。 */
    missing: string[];
    /**
     * ── ★★★ t22：第三态的**处置** —— 一条"判不了"且**四格全空**的任务必须被挡 ────────
     *
     * MEASURED（t22 实测，真工具入口）：
     *
     *     edit_plan { action:'update_task', task_id:'t1', assignee:'worker' }
     *       t1 = { subject:'a staged-plan task', status:'pending' }   ← kind 缺席、四格全空
     *     ⇒ **ALLOWED**，而那条任务随后仍然处在**可认领**状态
     *
     * ★ 那正是本任务要修的那个缺陷的**原始形状**（t1 本尊）：
     *   `contractRequirement(undefined, {})` 交回 `missing: []`
     *   ⇒ 上面那道 `requirement.missing.length > 0` 的闸门**不会开火**
     *   ⇒ 于是"判不了"被**静默**读成了"没问题"。
     *
     * ★★ 而这与第三态那条纪律**不矛盾**，恰恰是它的落实：
     *   "判不了"**不许**并进"明确不要求"（那会让缺陷隐身），
     *   也**不许**并进"要求且缺格"（那会去报一个它其实不知道的格名）。
     *   ⇒ 它有**自己的**处置：**拒绝**，并如实说"这条任务没声明 kind，
     *     而它的契约是空的 —— 我判不了它需不需要契约，所以不让它进工作"。
     *
     * ── 判据（机械）：`kind` 缺席 **且** 四格**全空** ─────────────────────────────
     *
     * ★ 为什么是"全空"而不是"任意一格空"：一条 `kind` 缺席却**填了** objective 的任务
     *   （真实的中间态：人先写了个目标、还没定 kind）**不是**这个缺陷 ——
     *   它有内容可读，认领的人看得出它在说什么。★ 本判据只挡**四格全空**那一种，
     *   因为那一种与"契约在途中丢了"**完全同形**，而那正是 t1 那位成员读到的形状。
     */
    unjudgeableEmpty: boolean;
}
/**
 * 一个 kind 要求哪些契约格。
 *
 * ★★★ 三态，而**第三态不许并进另外两个**：
 *
 *   `kind` 在场且是质量/写类 ⇒ 要求那几格（`required` 非空）
 *   `kind` 在场且是 `work`/`requirements` 等 ⇒ **明确不要求**（`required` 为空，
 *     而这是表里写明的决定，不是默认 —— `kind-requirements.json` 的 `work` 那条
 *     `because` 逐字写着"deliberately does not require a verify list or an inScope at all"）
 *   ★ `kind` **缺席** ⇒ **判不了**（`kind` 为 `undefined`）。它不是"不要求"：
 *     `taskKindOf` 把缺席读成 `work`（那是**运行时**的容错缺省），
 *     而"这条任务没声明 kind"是一件**没接线**的事 —— 与"它声明了 work"不同形。
 *     ⇒ 这里不替它选，如实交出去（见 `checkContract`）。
 */
export declare function contractRequirement(kind: TaskKind | undefined, task: Record<string, unknown>): ContractRequirement & {
    unknownKind: boolean;
};
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export declare function register(ctx: Context, scheduler: any, updatePlanBatch: any, config: ToolsConfig): void;
