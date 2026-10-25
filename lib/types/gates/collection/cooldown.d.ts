/**
 * ── `collection.cooldown` ——— 这个来源**是不是刚说过话**（t86）──────────────────────
 *
 * 依据：`docs/COLLECTION-POINT-AND-EVALUATORS.md` §1.2 行 2
 *   「同一来源 N 分钟内 ⇒ ★ 不采（MemOS 的 `cooldownMs`）」
 *
 * ── ★ 它与 `dedupe` **问的不是同一个问题**（这一点决定了两条都必须在）──────────
 *
 * ```
 * dedupe    —— 「这条**内容**是不是已经有过？」     （按 内容 判）
 * cooldown  —— 「这个**来源**是不是刚说过话？」     （按 来源+时间 判）
 * ```
 * ★ 两者的失败**不同形**，所以不许合并：
 *   · 只留 `dedupe` ⇒ 一个来源在 10 秒内报了 **5 条不同**的缺陷，5 条全采
 *     （它们是不同的内容 ⇒ dedupe 放行）—— 而那时**还没有人来得及处理第一条**；
 *   · 只留 `cooldown` ⇒ 同一个缺陷隔天又来一次，冷却窗早过了 ⇒ 照采
 *     （而那正是 161 次那个形状）。
 * ⇒ ★★ 两条**互补**，不是重复。
 *
 * ── ★ 为什么"来源缺席"是 `unmeasured` 而不是 `ok` ──────────────────────────────
 *
 * 说不出这条信号**来自谁**时，"它是不是刚说过话"**根本无从谈起**。
 * ★ 若判 `ok`，那么"没有来源信息"与"来源很勤"会走向**同一个结局（都采）** ——
 *   而它们是两件事：前者是**归因缺口**（要么补来源，要么承认抓不到），
 *   后者是**真的发生了太多次**。
 */
import { type GateVerdict } from '../registry.ts';
import { COOLDOWN_MS, type CollectionContext } from './shared.ts';
export declare const id = "collection.cooldown";
export declare const point = "collection";
export declare const description = "\u8FD9\u4E2A\u6765\u6E90**\u662F\u4E0D\u662F\u521A\u8BF4\u8FC7\u8BDD**\uFF08\u540C\u4E00\u6765\u6E90 N \u5206\u949F\u5185\uFF09\u2014\u2014\u662F \u21D2 \u4E0D\u91C7\uFF1B\u8BF4\u4E0D\u51FA\u5B83\u6765\u81EA\u8C01 \u21D2 unmeasured";
export declare const requires: readonly ["candidate", "index"];
/** ★ 窗口长度在 `shared.ts`（与 `dedupe` 共用同一份形状，避免两处各写一个数）。 */
export { COOLDOWN_MS };
export declare function evaluateCollectionCooldown(context: CollectionContext): GateVerdict;
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
