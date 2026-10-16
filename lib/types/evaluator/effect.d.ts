/**
 * ── 评估器的**收益读数**（t92 · 来源 ③）────────────────────────────────────────
 *
 * ★★ 结构性判据（规格 `EFFECT-MEASUREMENT-RESEARCH.md` §1.1）—— 因为
 *   本仓 91% 的桶只有 1 条（54 个桶：最大 167 · 中位 1 · n===1 的 49 个），
 *   **统计判据无数据可用**：
 *
 * ```
 *   before.count === 0         ⇒ unmeasured（无基线，无从比较）
 *   after.count  <  before.count ⇒ improved（它降了 —— 无阈值）
 *   after.count  >= before.count ⇒ unchanged（它没降）
 *   ★ 幅度作读数，不进 verdict（MemOS 的"阈值永不触发"教训）
 * ```
 *
 * ★ 独立性：本文件**不 import `src/evolution/`** —— 桶的键口径与
 *   `evolution/health.ts` 的 `bucketKeyOf` 一致（`component` + 排序后 `kind`），
 *   但**形状独立**（与那个文件对 `CollectionCandidate` 的取舍同一条）。
 */
import type { EffectReading, EvaluatedSubject } from './types.ts';
/**
 * ★★★ 「最小观察期」—— ★★★ **这是一个猜测，没有任何依据能指**。
 *
 * 出处（研究 §4.3 逐字）：「而那个"最小观察期"是多少 —— 我没有依据，需要实测积累」。
 * 它的存在只有一个理由：after 窗口太短时，"计数没降"与"还没来得及降"在计数上**同形**
 * ⇒ 必须报 unmeasured，而"多短算太短"今天只能猜。
 *
 * ★★ 与"有依据的常量"**不同形**的三条硬要求（不许只写一个数字）：
 *   · 它叫 `GUESSED_…`（名字里带 GUESSED，而不是 `MIN_OBSERVATION_PERIOD` 那种测量口径的名字）；
 *   · 本注释声明它**没有依据**、来自研究 §4.3 的建议值；
 *   · 它**必须可改** —— 调用方可经 `options.minObservationMs` 覆盖（缺省才用它）。
 *
 * ★ 建议值 = 1 天（研究 §4.3 的代理口径：`max(1 天, 该桶中位间隔 × N)` 的下界）。
 */
export declare const GUESSED_MIN_OBSERVATION_MS: number;
/** 一个时间窗口里的**计数** —— 由调用方注入计数器（本模块不做 I/O，判据是纯函数）。 */
export type WindowCounter = (window: {
    readonly from: number;
    readonly to: number;
}) => number;
/** 评估的选项（`minObservationMs` 覆盖那个猜测常量 —— 它必须可改）。 */
export interface EffectOptions {
    /**
     * 覆盖「最小观察期」。★ 缺省用 `GUESSED_MIN_OBSERVATION_MS`（**猜测**，见其注释）。
     * 传 `undefined`（或省略）= 用猜测值；传数字 = 你有一个依据，请同时把它写下来。
     */
    readonly minObservationMs?: number;
}
/** 桶键：与 `evolution/health.ts` 的 `bucketKeyOf` 同一口径（component + 排序后 kind）。 */
export declare function effectBucketKeyOf(effect: {
    readonly component: string;
    readonly kind: readonly string[];
}): string;
/**
 * 算收益读数。
 *
 * @param subject  评估对象（靶 = `subject.effect`；**没有 effect ⇒ 整条收益读数缺席**，
 *                 而不是报 unmeasured —— "没声明靶"与"声明了但判不了"不同形）。
 * @param count    窗口计数器（调用方注入 —— 它知道台账在哪，本模块不知道）。
 * @param evaluatedAt  评估那一刻（after 窗口的右端点）。
 */
export declare function effectReadingOf(subject: EvaluatedSubject, count: WindowCounter, evaluatedAt: number, options?: EffectOptions): EffectReading | undefined;
