/**
 * ── 自进化层的**类型**（t86）────────────────────────────────────────────────────
 *
 * ★ 本目录只放**读数与记录**，不放任何会改判据的东西 ——
 *   理由见 `docs/COLLECTION-EVALUATOR-SELF-EVOLUTION.md` §3 那条矛盾：
 *
 *   > 「如果 `collection` 的判据可以被自进化循环修改，那么：
 *   >    循环发现"我被 `collection.dedupe` 拦住了" ⇒ 它可以去**放宽那条判据**
 *   >    ⇒ 接下来所有重复都会被采 ⇒ 而那正是 reward tampering。」
 *
 * ── ★★ 这条矛盾在代码里的落点是**两个循环的分层**，而它是可机械检查的 ──────────────
 *
 * ```
 * ★ 循环 A（内层 · 可自动）：改 prompt · 改 profile · 改判据的【阈值】· 改采集的【范围】
 * ★★ 循环 B（外层 · 只能人改）：collection 的四条判据本身 · 验证命令 · confidence 阈值
 * ```
 *
 * ★ **所以本目录（`src/evolution/`）里不许出现对 `src/gates/**` 的写路径。**
 *   它只能**读**判据的读数（`health.ts`）、**记**判据的历史（`history.ts`），
 *   而"改判据"这件事**没有对应的函数** —— 不是"忘了写"，是**刻意不提供**。
 *   ★ 一条只禁止调用的注释会腐烂；**没有那个函数**则不会。
 */
/**
 * ★ 哪些**改动对象**属于循环 B —— **只能提议，不能自改**。
 *
 * ★ 规格 §3 逐字列出的三项，一条不多一条不少。
 */
export const LOOP_B_SUBJECTS = Object.freeze([
    'collection-gates', // ★ collection 的四条判据本身
    'verify-command', // ★ 验证命令
    'confidence-threshold', // ★ confidence 阈值
]);
/**
 * ★★ **循环 A 能不能自改某个对象** —— 本层唯一一条"规则"函数。
 *
 * ★ 它答的是那句矛盾的核心问题，而它的返回值是**布尔**（可机械断言）：
 *   `canLoopAAutoChange('collection-gates')` ⇒ **false**。
 *
 * ★★ 为什么把它放在 `types.ts` 而不是别处：它是**类型层的事实**
 *   （哪些对象属于哪个循环），而把它写在"决策"函数旁边会让它看起来像可调的策略 ——
 *   它不是策略，是**分层本身**。
 */
export function canLoopAAutoChange(subject) {
    return !LOOP_B_SUBJECTS.includes(subject);
}
