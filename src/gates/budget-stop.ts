// ── src/gates/budget-stop.ts ───────────────────────────────────────────────────
//
// 「completion 链跑光了它的 wall-clock 总预算」这件事的**唯一**记号。
//
// ── 为什么它是一个【独立的叶子模块】，而不是挂在某一层里 ────────────────────────
//
// 认出这个记号的人分处两层，而两层之间的依赖**是单向的**：
//
//     tools/  →  gates/        （已成立：`tools/shared/entities.ts` 就 import gates）
//     gates/  ↛  tools/        （本仓明写的纪律，见 `gates/runtime/stall.ts` 的注释：
//                              「gates 层今天不 import 任何 tools/」）
//
// ⇒ 于是：
//   · 抛出方在 `tools/shared/entities.ts`（`runWithinBudget`）—— 它 import 本模块是**顺向**的；
//   · 认出方在 `gates/registry.ts` 与 `gates/completion/mutation.ts` —— 同层，无方向问题。
//
// ★ 若把这个类放进 `tools/shared/entities.ts`（最直觉的位置），gates 层就**必须**
//   import tools ⇒ 违反上面那条单向纪律，而且会把一个"判据框架"反向绑死在
//   "工具层的一个实现细节"上。本模块零依赖，正是为了让两个方向都合法。
//
// ── 为什么认的是【名字】而不只是 `instanceof` ───────────────────────────────────
//
// 本仓运行在宿主里，而宿主的插件重载会**重新求值模块**（`src/hmr-trace.ts` 记过这件事）。
// 两份模块实例 ⇒ 两个不同的类对象 ⇒ 父实例抛出的错误在子实例里 `instanceof` 为 **false**。
// 而这条判定的后果是"预算停止被读成普通错误"（见下），代价与收益完全不对等。
//
// ⇒ 判定按 **`name` 字段**（跨实例稳定），`instanceof` 只作为快路径。
//   ★ 代价：`name` 是字符串契约，改名字会静默失效 —— 由
//     `scripts/gate-completion-hardening.test.mjs` 的两条臂把它钉住
//     （一条直接构造、一条只带 name 的鸭子类型对象，两条都必须被认出）。
//
// ── 这个记号防的是什么失效（MEASURED，2026-10-12）──────────────────────────────
//
// 总预算是本次新加的。加完之后有两个**不同的**洞，而它们的后果相反：
//
//   ① 在 `mutation` 里：预算抛出被逐条变异体的 `catch` 吞成 `outcome: 'error'`，
//      而 `errored` **不进** `scored`（`scoreMutants`：`scored = killed | survived`）
//      ⇒ 分母塌缩成"还来得及跑的那几条" ⇒ 若前面几条恰好都被杀，`mutationScore`
//      会**大于**阈值 ⇒ **报 ok**。★ 一次"没能测量"被读成"测试很强" —— 假通过。
//
//   ② 在 `verify-rerun` / `backtest` / `r5` 里：`registry.evaluate()` 的
//      `await reg.gate(context)`（`registry.ts` 约 708 行）**没有 try/catch**
//      ⇒ 抛出**穿出整条 completion**，绕过 `blocked`/`unmeasured` 这套三态，
//      成员收到的是一个异常而不是一条裁决。
//
// ⇒ 两个洞都被"让判据框架**认出**这个记号"一并堵掉：①②都变成 `unmeasured`
//   （判据跑了、它说它测不了），而不是"通过"、也不是"崩了"。
//
// ── ★ 它不吞别的错误 ──────────────────────────────────────────────────────────
//
// `registry.evaluate` 只在这一条上转成 `unmeasured`，**其余抛出照旧穿出去**。
// 理由：判据里的一个真 bug（解引用 null、类型错）与"预算跑光"必须不同形 ——
// 前者是"这段代码坏了"，后者是"这条链今天没跑完"。把前者一起吞成
// "没能测量"会**静默掉一次真实的开发期故障**，那正是本仓反复记账的那种合流。

/**
 * 跨模块实例稳定的记号。★ 改名会静默失效 —— 见文件头。
 * 由 `scripts/gate-completion-hardening.test.mjs` 钉住。
 */
export const COMPLETION_BUDGET_STOP_NAME = 'CompletionBudgetExceeded'

/**
 * 一次 `runWithinBudget` 因**总预算耗尽**而终止。
 *
 * ★ 刻意**不是**一个"看起来像命令失败"的退出码（125）：判据对"执行器抛错"与
 *   "命令失败"的措辞完全不同 —— 前者说"我没能跑它"，后者说"它跑了并且失败"。
 *   把预算停止返回成 125，就等于把它读成"这些命令都超时了"。
 */
export class CompletionBudgetExceeded extends Error {
  constructor(message: string) {
    super(message)
    this.name = COMPLETION_BUDGET_STOP_NAME
  }
}

/**
 * 这个抛出是不是"预算停止"。
 *
 * 判定顺序见文件头：先 `instanceof`（同实例的快路径），再 `name`（跨实例）。
 * ★ 只认 `name` 一条也能工作，但两条都留着是刻意的：快路径让同实例的判定
 *   不依赖字符串，而 `name` 让重载后的判定仍然成立。
 */
export function isCompletionBudgetStop(error: unknown): boolean {
  if (error instanceof CompletionBudgetExceeded) return true
  return typeof error === 'object' && error !== null
    && (error as { name?: unknown }).name === COMPLETION_BUDGET_STOP_NAME
}
