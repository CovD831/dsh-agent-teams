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
 * 一个采集桶 —— 同一个 `(component, kind)` 下所有记录的聚合。
 *
 * ★ 它对应规格里 `CollectionHealth.buckets` 那一格的形状（逐字段一致）。
 */
export interface CollectionBucket {
    readonly component: string;
    readonly kind: readonly string[];
    readonly count: number;
    readonly firstAt: number;
    readonly lastAt: number;
}
/**
 * 采集层的**自我读数** —— 它是"该不该改判据"的唯一依据。
 *
 * ★ 规格逐字（`docs/COLLECTION-EVALUATOR-SELF-EVOLUTION.md` §4.1）：
 *   「★★ 采集层的自我读数 —— 它是"该不该改判据"的唯一依据"」
 */
export interface CollectionHealth {
    /** 每个 `(component, kind)` 桶的计数与时间跨度。 */
    readonly buckets: readonly CollectionBucket[];
    /**
     * ★★ AutoLibra 的 **redundancy**：**唯一桶数 / 总记录数**。
     *
     * MEASURED（372 条台账）：`54 / 372 ≈ 0.145`。
     * ★ 口径**必须**是这个 —— 若算出别的数，是**口径错了**，不是数据变了。
     *   ⇒ 见 `health.ts` 里那条自检。
     */
    readonly redundancy: number;
    /**
     * ★ AutoLibra 的 **coverage**：**有多少条记录落进了"已被区分的组合"**。
     *
     * ★ 与 `redundancy` 是一个比值的**两面**，但**不许合并成一个数**：
     *   它们答的是两个问题（"有多少是新的" vs "有多少被覆盖到了"），
     *   而合起来之后"桶很少"与"覆盖很窄"同形 —— 补救动作相反
     *   （前者是**分类太粗**，后者是**采集太窄**）。
     */
    readonly coverage: number;
    /** ★ 被 collection 判据拒掉的条数（**按判据 id 分组**）。 */
    readonly refused: Readonly<Record<string, number>>;
}
/**
 * 一条**判据变更**记录。
 *
 * ★ 依据 SkillClaw 的 `history/` + Raven 的"必须先读全部历史再决定"，逐字：
 *   > 「Without this context you risk **reverting previous improvements
 *   >   or repeating past mistakes**.」
 *   > 「Explicitly answer: What changed in each prior version?
 *   >   What evidence justified that change?」
 *
 * ⇒ 所以四格**一个都不能少**（`changed` 与 `evidence` 尤其是"防反复来回改"的那两格）。
 */
export interface CollectionGateChange {
    /** 改的是哪一条（`collection.dedupe` / …）。 */
    readonly gateId: string;
    /** 何时改的（毫秒）。 */
    readonly at: number;
    /** ★ **改前**是什么（一字不差地记下被替换的那个值/口径）。 */
    readonly before: string;
    /** ★ **改后**是什么。 */
    readonly after: string;
    /** ★ **证据**：凭什么改（读数、夹具、事故）。一条说不出证据的变更不该被记进来。 */
    readonly evidence: string;
}
/**
 * ── ★★★ 两个循环的**分层**，写成数据而不是注释 ─────────────────────────────────
 *
 * 依据 §3：循环 A 可自动，循环 B **只能人改**。
 * ★ 而"某件东西属于哪个循环"必须是**可机械读的**（否则它只是一句话，
 *   而本仓记过："一句话不是任务"）。
 */
export type EvolutionLoop = 'A' | 'B';
/**
 * ★ 哪些**改动对象**属于循环 B —— **只能提议，不能自改**。
 *
 * ★ 规格 §3 逐字列出的三项，一条不多一条不少。
 */
export declare const LOOP_B_SUBJECTS: readonly ["collection-gates", "verify-command", "confidence-threshold"];
export type LoopBSubject = typeof LOOP_B_SUBJECTS[number];
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
export declare function canLoopAAutoChange(subject: string): boolean;
