/**
 * ── 评估器的**打分与合成**（t92 · 来源 ①②④ + 出口）─────────────────────────────
 *
 * ★★★ 输出 = **一个概率**（用户裁定）+ 逐条读数。
 *
 * 用户原话（队长核实过数学前提）：「好像不需要两个数字去打分……决策模型对选项
 * 输出一个概率分布……这个概率其实就相当于是一种置信度了,所以可能只需要一个数字」。
 *
 * ★★ 数学前提成立：`Σp = 1` ⇒ 分布同时编码**选择**与**把握**。
 * ★★★ **但它无法表达弃权**：`p = [0.5, 0.5]` 是"两个都一样可能"，
 *   而那与"我判不了"是**两件事** ⇒ `unmeasured` 必须是**第三个答案**
 *   （verdict 层面），**不能**靠 `p = 0.5` 表达。
 *   ⇒ 本模块的形状：`probability: number | undefined` —— `undefined` ⇒ 判不了（**不是 0**），
 *     与 `confidenceOf` 对缺席计数返回 `undefined` 是**同一条纪律**。
 *
 * ★★ **复用 `src/confidence.ts` 的 `confidenceOf`，不重写**（它已实现、零调用，
 *   且它就是 Beta 后验均值（Add-k 平滑）—— 与"决策模型的概率输出"是同一个数学对象）。
 *   本文件不 import 它的实现，**调用它**（import 是复用，重写才是违规）。
 */
import { type UsageTally } from '../confidence.ts';
import type { EffectReading, EvaluatedSubject, EvaluationReading } from './types.ts';
/** 一次 update_task 交付读数的**计数投影** —— 评估器自己的三来源。 */
export interface SourceTallies {
    /** 来源 ①：验收 passed/total（`acceptanceResults[]`）。 */
    readonly acceptance: {
        readonly passed: number;
        readonly total: number;
    };
    /** 来源 ②：机械验证 passed/total（`commandsRun[]` 的 status/exitCode）。 */
    readonly verify: {
        readonly passed: number;
        readonly total: number;
    };
    /** 来源 ③ 的裁决（`effect.ts` 产出；无靶 ⇒ undefined）。 */
    readonly effect: EffectReading | undefined;
}
/**
 * 从 subject 读出**两个本地来源**（验收 / 机械验证）的计数 —— 纯读，不做 I/O。
 *
 * ★ 收益（来源 ③）**不在**这里：它需要台账窗口计数器（调用方注入），
 *   本函数没有台账 ⇒ 塞一个恒 0 计数器会造出一条**假的** "no-baseline" 读数 ——
 *   那正是"没测到"被悄悄制造出来的形状。⇒ effect 只在 `evaluateSubject`（有计数器）里算。
 *
 * ★ 三态纪律：**一格缺席就是缺席**，不补 0 ——
 *   `acceptanceResults` 缺席 ⇒ `total: 0` 且调用方据字段缺席判"没填"，
 *   "没填验收"与"填了全过"在读取端**不同形**。
 */
export declare function sourceTalliesOf(subject: EvaluatedSubject): Omit<SourceTallies, 'effect'>;
/**
 * 把来源计数折成一个 **UsageTally**，喂给**既有的** `confidenceOf`。
 *
 * ★ 对应关系（逐格可核）：
 *   `upvoted` = 判"好"的次数（验收过 + 命令过 + 收益 improved）
 *   `recalled` = 能判的总次数（同一分母）
 * ⇒ `confidenceOf` 的三条性质（采纳率驱动 / 小样本收缩 / 缺席 ⇒ undefined）
 *   **原封不动**地适用于"这条改动有多可信地有效"。
 */
export declare function tallyOf(tallies: SourceTallies): UsageTally;
/**
 * ★★★ 评估一个 subject —— 本模块的**出口**。
 *
 * @param subject    评估对象（契约形状）。
 * @param count      收益窗口计数器（调用方注入 —— 它知道台账在哪）。
 * @param evaluatedAt 评估那一刻（after 窗口右端点）。
 * @param options    `minObservationMs` 等可覆盖项（透传给 `effectReadingOf`）。
 */
export declare function evaluateSubject(subject: EvaluatedSubject, count: (window: {
    readonly from: number;
    readonly to: number;
}) => number, evaluatedAt: number, options?: {
    readonly minObservationMs?: number;
}): EvaluationReading;
