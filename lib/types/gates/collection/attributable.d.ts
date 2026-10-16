/**
 * ── `collection.attributable` ——— 这条**能否落到一个 component**（t86）────────────
 *
 * 依据：`docs/COLLECTION-POINT-AND-EVALUATORS.md` §1.2 行 3
 *   「落不到 ⇒ ★ **unmeasured**，不硬塞」
 *
 * ★★ **"不硬塞"这三个字是本判据的全部内容**，而它对照的正是本仓**已经发生过**的
 *   一件真事：一条落不到具体组件的信号，被**塞进**某个看起来最像的桶里 ——
 *   于是"我们不知道它是什么"与"它是 X 那个组件的缺陷"**在台账里同形**。
 *   而下一次读那份台账的人，会拿 X 的组件名去做决定。
 *
 * ── ★★ 为什么它是 `unmeasured` 而**不是** `blocked`（这一格最容易写错）─────────
 *
 * 两者补救动作**相反**：
 * ```
 * blocked     ⇒ 「这条信号**不值得采**」       ⇒ 下游啥也不做（它是正常结局）
 * unmeasured  ⇒ ★ 「我**说不出它是什么**」     ⇒ 要么改信号，要么补归因
 * ```
 * ★ 若写成 `blocked`，那么**归因机制有缺口**与**这条信号没价值**同形 ——
 *   于是"采集层抓不到组件"这件事**永远不会浮出来**，而它会一直悄悄丢信号。
 * ⇒ 所以本判据**只答 `ok` 或 `unmeasured`，永不 `blocked`**（见下面那条断言性注释）。
 *
 * ── ★ 它与 `dedupe` 的分工（都是"不采"，但理由不同形）──────────────────────────
 *
 * `dedupe` 说"见过"（**知道**它是什么，只是已经有了）；
 * 本判据说"不知道它是什么"。★ 前者进 `redundancy` 那个读数，
 * 后者**根本不进桶**（它连一个 component 都没有）—— 所以它**不能**被算进 redundancy，
 * 否则"重复"会被"不知道"稀释。
 */
import { type GateVerdict } from '../registry.ts';
import type { CollectionContext } from './shared.ts';
export declare const id = "collection.attributable";
export declare const point = "collection";
export declare const description = "\u8FD9\u6761\u4FE1\u53F7**\u80FD\u5426\u843D\u5230\u4E00\u4E2A component** \u2014\u2014 \u843D\u4E0D\u5230 \u21D2 unmeasured\uFF08\u4E0D\u786C\u585E\u8FDB\u4EFB\u4F55\u6876\uFF09\uFF1B\u843D\u5F97\u5230 \u21D2 \u91C7";
export declare const requires: readonly ["candidate"];
export declare function evaluateCollectionAttributable(context: CollectionContext): GateVerdict;
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
