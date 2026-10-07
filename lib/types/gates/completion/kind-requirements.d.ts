/**
 * ── 完工门的【kind 需求表】：类型 + 校验器（t54）────────────────────────────────────
 *
 * ── ★★ 它不是一条判据 ────────────────────────────────────────────────────────
 *
 *   `verify-gates-integration` ④ 用一条**显式 allowlist** 拦"判据之间互相 import"，
 *   理由写得很清楚：
 *
 *     「真正要拦的是 `completion/r5.ts imports "./mutation.ts"` 这种
 *       **一条判据调另一条**。」
 *
 *   ★ 而"这张表的类型与校验器"被三条门共同需要 ⇒ 它必须住在一个**不是判据**的地方。
 *     先例就在眼前：`../requires.ts` —— 它在 `src/gates/` 下、不是判据、
 *     被所有判据 import，而 allowlist 明确放行它，因为
 *     「它不 import 任何东西、也不带一条判据的语义」。
 *
 *   ⇒ 本文件正是同一类东西：**纯函数、无 I/O、无判据语义**。
 *     ★ 于是三条门各 import 它，而它们之间**不互相 import** —— 约束仍然成立。
 *
 * ── ★ 表与逻辑的边界（与 t53 同一条纪律）────────────────────────────────────────
 *
 *   表（进 JSON）：每个 kind 要求哪些门，以及**为什么**。
 *   逻辑（留代码）：**怎么用那张表判**、三态怎么分、措辞怎么生成。
 *
 * ★ 它**不读盘**（判据层不许 import I/O）—— "读"由调用方做，
 *   而"信不信它"由本文件的 `parseKindRequirements` 判。
 */
/**
 * ── ★★★ 三态（互不同形，且绝不静默退化）────────────────────────────────────────
 *
 *     `loaded`         —— 读到了、形状对
 *     `absent`         —— 读不到（文件不在 / 读失败）
 *     `malformed`      —— 读到了但形状坏
 *     `kind-unknown`   —— 表**读得到、形状对**，但**里面没有这个 kind**
 *
 *   ★★ 最后那一格是本表特有的，而它最容易做错：
 *
 *      「表里没有这个 kind」  **不等于**  「这个 kind 不要求任何门」
 *
 *     前者是**没能测量**（表没覆盖它），后者是一个**有理由的决定**
 *     （`requiredGates: []` 且带 `because`）。
 *     ⇒ 把它们合成一件事，会把「我没能测量」变成「测了，没问题」——
 *       而那是本队记账最久的那条界线。
 */
export type KindRequirementsLoad = {
    status: 'loaded';
    requirements: KindRequirements;
} | {
    status: 'absent';
    reason: string;
} | {
    status: 'malformed';
    reason: string;
} | {
    status: 'kind-unknown';
    reason: string;
    knownKinds: string[];
};
/** 表里的一条：这个 kind 要求哪些门，以及**为什么**。 */
export interface KindRequirement {
    /** 这个 kind 要求哪些门（门的 id，与 `completion.*` 逐字对应）。 */
    requiredGates: readonly string[];
    /** ★ 为什么是这一组 —— **空数组也必须给出理由**（"不要求"是一个决定）。 */
    because: string;
}
export interface KindRequirements {
    /** kind → 它的要求。 */
    readonly byKind: ReadonlyMap<string, KindRequirement>;
    /** 表里一共覆盖了哪些 kind（`kind-unknown` 的分支要用它说清"我知道哪些"）。 */
    readonly knownKinds: readonly string[];
}
/**
 * 把调用方交进来的**未校验数据**解析成需求表。
 *
 * ★ 它是**纯函数**（不读盘）："读"由调用方做，"信不信它"由本函数判。
 *   ⇒ 于是"文件读不到"与"文件里写的是垃圾"在**判据层**是两个不同的读数。
 *
 * ★ 为什么严格校验**每一条**：一条缺 `requiredGates` 的记录会静默地让那个 kind
 *   "不要求任何门" —— 而那**看起来像"这个 kind 没问题"**。
 *   ⇒ 缺字段必须是 `malformed`，不能是"那个字段就当空数组"。
 *
 * ★★ 而 `because` 是**必填**的：一条没有理由的要求（或没有理由的不要求）
 *   无法被复核 —— 而下一个人只会看到"门说不要"，看不到"为什么不要"。
 */
export declare function parseKindRequirements(raw: unknown): KindRequirementsLoad;
/**
 * 问表：这个 kind 要求这条门吗？
 *
 * ★ 返回的是**三态**（`required` / `not-required` / `unknown`），而不是布尔 ——
 *   因为"不要求"与"表里没有这个 kind"必须**不同形**（见上面 `KindRequirementsLoad`）。
 *
 * ★ 而"这个 kind 不要求这条门"是**有理由的**（表里有 `because`）：
 *   调用方可以把那条理由交给读的人，于是"门没说话"不再是一个死寂的默认。
 */
export declare function gateRequirementFor(load: KindRequirementsLoad, kind: string | undefined, gateId: string): {
    status: 'required' | 'not-required' | 'unknown';
    why?: string;
};
/**
 * 取 kind 需求表 —— **没注入**与**读不到**收敛成同一个 `absent`。
 *
 * ★ 为什么两者可以合并成一条：它们的**后果**完全相同（门问不出这个 kind 要不要它），
 *   而它们的**区别**在措辞里保留（`reason` 不同）。
 *   ★ 而它们都**不是** `not-required` —— 那是本函数唯一不能让它们退化成的状态。
 */
export declare function loadKindRequirementsOfHost(ctx: {
    loadKindRequirements?: () => KindRequirementsLoad;
} | undefined): KindRequirementsLoad;
