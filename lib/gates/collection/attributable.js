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
import { ok, unmeasured } from "../registry.js";
export const id = 'collection.attributable';
export const point = 'collection';
export const description = '这条信号**能否落到一个 component** —— 落不到 ⇒ unmeasured（不硬塞进任何桶）；落得到 ⇒ 采';
export const requires = ['candidate'];
export function evaluateCollectionAttributable(context) {
    const { candidate } = context;
    if (candidate === undefined) {
        return unmeasured('collection.attributable: no candidate was supplied');
    }
    /**
     * ★★★ **本判据的核心，也是它唯一的 `unmeasured` 分支**。
     *
     * ★ 判据是"`component` 缺席" —— 而**不是**"它是一个不认识的名字"：
     *   后一种要读一份"已知组件表"，而那是 I/O + 一份会腐烂的清单。
     *   本判据只问一件**当场可判**的事：**它有没有指向一个组件**。
     *   ★ "这个名字对不对"是**另一条判据**的事（若日后要加，它属于循环 B）。
     *
     * ★ 空串按缺席处置：`component: ''` 与 `component: undefined` 在**这一点上**
     *   是一件事（都没指向任何组件）。★ 这与本仓"缺字段与空值不同形"的纪律**不冲突** ——
     *   那条纪律说的是**落盘形状**（缺席与 `[]` 不许合成一个），
     *   而这里判的是"有没有指向"，`''` 与 `undefined` 同样指向不了任何东西。
     */
    if (candidate.component === undefined || candidate.component === '') {
        return unmeasured('collection.attributable: this signal does not point at any component, so it cannot be filed under one — '
            + 'refusing to force it into a bucket (a signal we cannot attribute must not look like one we could)');
    }
    /**
     * ★ 到这里它落得到 component ⇒ **采**。
     * ★ **本判据永远不返回 `blocked`** —— 那正是文件头那段说的："不采"有两理由,
     *   而"不知道它是什么"不是"不值得采"，它必须走 `unmeasured` 那条出口。
     */
    return ok();
}
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
export function appliesTo(context) {
    return context?.candidate !== undefined;
}
export function gate(context) {
    return evaluateCollectionAttributable(context);
}
