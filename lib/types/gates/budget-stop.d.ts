/**
 * 跨模块实例稳定的记号。★ 改名会静默失效 —— 见文件头。
 * 由 `scripts/gate-completion-hardening.test.mjs` 钉住。
 */
export declare const COMPLETION_BUDGET_STOP_NAME = "CompletionBudgetExceeded";
/**
 * 一次 `runWithinBudget` 因**总预算耗尽**而终止。
 *
 * ★ 刻意**不是**一个"看起来像命令失败"的退出码（125）：判据对"执行器抛错"与
 *   "命令失败"的措辞完全不同 —— 前者说"我没能跑它"，后者说"它跑了并且失败"。
 *   把预算停止返回成 125，就等于把它读成"这些命令都超时了"。
 */
export declare class CompletionBudgetExceeded extends Error {
    constructor(message: string);
}
/**
 * 这个抛出是不是"预算停止"。
 *
 * 判定顺序见文件头：先 `instanceof`（同实例的快路径），再 `name`（跨实例）。
 * ★ 只认 `name` 一条也能工作，但两条都留着是刻意的：快路径让同实例的判定
 *   不依赖字符串，而 `name` 让重载后的判定仍然成立。
 */
export declare function isCompletionBudgetStop(error: unknown): boolean;
