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
export function parseKindRequirements(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { status: 'malformed', reason: `the kind-requirements data must be an object, got ${Array.isArray(raw) ? 'an array' : typeof raw}` };
    }
    const record = raw;
    const list = record.kinds;
    if (!Array.isArray(list)) {
        return { status: 'malformed', reason: 'the kind-requirements data has no "kinds" array' };
    }
    const byKind = new Map();
    for (const entry of list) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            return { status: 'malformed', reason: 'every entry under "kinds" must be an object' };
        }
        const item = entry;
        if (typeof item.kind !== 'string' || item.kind.trim() === '') {
            return { status: 'malformed', reason: 'every entry under "kinds" needs a non-empty "kind"' };
        }
        if (!Array.isArray(item.requiredGates) || !item.requiredGates.every((gate) => typeof gate === 'string')) {
            return { status: 'malformed', reason: `the entry for kind "${item.kind}" has no usable "requiredGates" (expected an array of strings; an EMPTY array is allowed, but it must be explicit)` };
        }
        /**
         * ★★ `because` 必填 —— 而它**恰恰**对本表最重要：
         *   一条"不要求任何门"的记录若没有理由，就无法与"忘了写"区分开。
         *   而那会把**一个决定**退化成一个**默认**。
         */
        if (typeof item.because !== 'string' || item.because.trim() === '') {
            return { status: 'malformed', reason: `the entry for kind "${item.kind}" has no "because": every requirement — and every NON-requirement — must say why, or it is a default rather than a decision` };
        }
        if (byKind.has(item.kind)) {
            return { status: 'malformed', reason: `the kind "${item.kind}" is declared twice` };
        }
        byKind.set(item.kind, { requiredGates: item.requiredGates, because: item.because });
    }
    if (byKind.size === 0) {
        return { status: 'malformed', reason: 'the "kinds" array is empty: a table that covers no kind says nothing, and "no kinds declared" is not "no kind needs a gate"' };
    }
    return { status: 'loaded', requirements: { byKind, knownKinds: [...byKind.keys()].sort() } };
}
/**
 * 问表：这个 kind 要求这条门吗？
 *
 * ★ 返回的是**三态**（`required` / `not-required` / `unknown`），而不是布尔 ——
 *   因为"不要求"与"表里没有这个 kind"必须**不同形**（见上面 `KindRequirementsLoad`）。
 *
 * ★ 而"这个 kind 不要求这条门"是**有理由的**（表里有 `because`）：
 *   调用方可以把那条理由交给读的人，于是"门没说话"不再是一个死寂的默认。
 */
export function gateRequirementFor(load, kind, gateId) {
    if (load.status !== 'loaded')
        return { status: 'unknown', why: `${load.status}: ${load.reason}` };
    if (kind === undefined || kind === '')
        return { status: 'unknown', why: 'the task carries no kind, so the table cannot be asked' };
    const entry = load.requirements.byKind.get(kind);
    /**
     * ★★ 表里没有这个 kind ⇒ `unknown`（**不是** `not-required`）。
     *   合成 `not-required` 会让"表没覆盖它"伪装成"它不需要门"。
     */
    if (entry === undefined) {
        return { status: 'unknown', why: `the kind "${kind}" is not in the table (it covers: ${load.requirements.knownKinds.join(', ')})` };
    }
    return entry.requiredGates.includes(gateId)
        ? { status: 'required', why: entry.because }
        : { status: 'not-required', why: entry.because };
}
/**
 * 取 kind 需求表 —— **没注入**与**读不到**收敛成同一个 `absent`。
 *
 * ★ 为什么两者可以合并成一条：它们的**后果**完全相同（门问不出这个 kind 要不要它），
 *   而它们的**区别**在措辞里保留（`reason` 不同）。
 *   ★ 而它们都**不是** `not-required` —— 那是本函数唯一不能让它们退化成的状态。
 */
export function loadKindRequirementsOfHost(ctx) {
    if (typeof ctx?.loadKindRequirements !== 'function') {
        return { status: 'absent', reason: 'no kind-requirements loader was injected, so the table could not be read at all' };
    }
    return ctx.loadKindRequirements();
}
