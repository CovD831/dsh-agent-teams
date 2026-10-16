/**
 * ── `collection.dedupe` ——— 这条信号与窗口内已有的**是不是同一件事**（t86）──────────
 *
 * ── ★★★ 它防的是本仓**实测过**的那个形状（不是设想）──────────────────────────────
 *
 * MEASURED（372 条台账，2026-10-16）：
 * ```
 * 唯一 (component, kind) 对 = 54
 * ★ 前两条就占 85.5%:
 *     dispatch   · unwired   161 条 · 2026-10-07 → 10-14
 *     completion · unwired   157 条 · 2026-10-07 → 10-10
 * ⇒ ★★ 同一个 unwired 在 dispatch 上重复了 161 次、持续 8 天，
 *    而【没有任何机制发现这件事】。
 * ```
 *
 * ⇒ ★ **本层要防的第一件事不是"采错的"，而是"采重复的"**。
 *   而本判据就是那个机制：**同样的三段已经见过 ⇒ 不采，只加计数。**
 *
 * ── ★★ 为什么"只加计数"而不是"什么都不做" ────────────────────────────────────
 *
 * 若有重复就**静默丢掉**，那么"这条发生了 161 次"这件事**读不出来** ——
 * 而 161 与 1 的区别**恰恰是唯一值得知道的信息**（它说明这个缺陷**一直在发生**）。
 * ⇒ 所以裁决是 `blocked`（不采），而**计数**由索引那一侧加 ——
 *   而那个计数就是 `CollectionHealth.redundancy` 的分子分母原料。
 *
 * ── ★ 纯函数：本文件不 import 任何 I/O ────────────────────────────────────────
 *
 * "窗口内已有的信号"是**调用方注入**的一份快照（见 `shared.ts` 的长注释）。
 */
import { type GateVerdict } from '../registry.ts';
import { type CollectionContext } from './shared.ts';
export declare const id = "collection.dedupe";
export declare const point = "collection";
export declare const description = "\u8FD9\u6761\u4FE1\u53F7\u4E0E\u7A97\u53E3\u5185\u5DF2\u6709\u7684**\u662F\u4E0D\u662F\u540C\u4E00\u4EF6\u4E8B**\uFF08\u540C kind + component + message\uFF09\u2014\u2014\u662F \u21D2 \u4E0D\u91C7\uFF0C\u53EA\u52A0\u8BA1\u6570\uFF1B\u5224\u4E0D\u4E86 \u21D2 unmeasured";
export declare const requires: readonly ["candidate", "index"];
/**
 * ★ 单条求值：输入 = 一条候选 + 已有索引，输出 = 三态。
 *
 * 三态各自的含义（★ 这三行是本次实现的口径，别处不许另立）：
 * ```
 * ok         ⇒ 没见过 ⇒ 采
 * blocked    ⇒ ★ 见过 ⇒ 不采（但计数要加 —— 见文件头）
 * unmeasured ⇒ 判不了（候选或缺席，或缺索引）
 * ```
 */
export declare function evaluateCollectionDedupe(context: CollectionContext): GateVerdict;
/** 注册表要的入口。 */
/**
 * ── ★ 何时适用：**有候选信号**时才跑 ─────────────────────────────────────────────
 *
 * ★ 与既有 17 条判据同一条纪律（`gate-index-assembly` 臂 2 逐字要求
 *   `hasAppliesTo === true`）：判据必须**按 kind 收窄**，否则它落进
 *   "对全部 kind 生效"那条**静默路径** —— 而那条路径下"不适用"与"跑了且没事"同形。
 *
 * ★ 而**缺输入不算不适用**：`candidate` 缺席 ⇒ 本判据仍进裁决，
 *   由 `gate()` 返回 `unmeasured`（见该函数）。"没测到"与"不适用"必须分开。
 */
export declare function appliesTo(context: CollectionContext | undefined): boolean;
export declare function gate(context: CollectionContext): GateVerdict;
