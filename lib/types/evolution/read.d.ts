/**
 * ── ★★★ t101：把 `signals.jsonl` 读成 `HealthRecord[]`（health.ts 的**第一个消费者**）─────
 *
 * ★★ 背景（`EVOLUTION-WIRING-GAP.md` §1 逐字）：`health.ts` 此前**零消费者** ——
 *   `collectionHealthOf` 能算，但从**没有任何生产路径算过它**。
 *   而"造一个函数 + 一个夹具"**不会改变那件事** ⇒ 本模块把**读文件**与**算读数**接起来，
 *   并由 `src/snapshot.ts`（生产出口：`/state` 路由）调用。
 *
 * ── 三态（本模块的全部难点：三种"没有读数"必须互不同形）──────────────────────────
 *
 * ```
 *   A · 文件缺席（还没采过任何东西）      ⇒ { status: 'unmeasured', reason: 'file-absent' }
 *   B · 文件在、但解析不出任何记录（空文件/全坏行） ⇒ { status: 'measured', records: [] } ← 与 A 不同形
 *   C · 一行坏 JSON                        ⇒ 只跳那一行（`skippedMalformed` 计数），**不整文件放弃**
 * ```
 * ★ A 与 B 的差别是**实打实的**：A = "这条流水线还没开过"（读数无对象）；
 *   B = "流水线开了、但目前一条都没采到"（读数对象是空集 —— `redundancy/coverage` 按空集口径给 0）。
 * ★ C 的先例：t93 的 `maxSignalNumberIn` 逐行 `JSON.parse`、坏行走兜底 ——
 *   **一行坏掉不许让整个读数归零**。
 */
import type { HealthRecord } from './health.ts';
/** 读取的结果 —— 三态（`unmeasured` / 空集 / 有记录），外加坏行计数。 */
export interface SignalsHealthRead {
    /**
     * ★ 三态：`unmeasured`（文件缺席，无对象）/ `measured`（文件在 —— **哪怕零条记录**）。
     * ★★ `measured` + `records: []` 与 `unmeasured` **不同形**：前者答"采了 0 条"，
     *   后者答"这条流水线还没开过" —— 合起来会把"没开"读成"开了没采到"。
     */
    readonly status: 'unmeasured' | 'measured';
    /** 为什么 `unmeasured`（只在 `status === 'unmeasured'` 时在场）。 */
    readonly reason?: 'file-absent';
    /** 解析成功的记录（**已投影成 `HealthRecord`**，可直接喂 `collectionHealthOf`）。 */
    readonly records: readonly HealthRecord[];
    /**
     * ★ 坏行计数（**跳过的**，不是吞掉的）—— C 的读数面：
     *   "有 2 行坏掉但其余 13 行照常算" 必须可读，否则坏行与"没这行"同形。
     *   ★ `status === 'unmeasured'` 时缺席（没有行可言）。
     */
    readonly skippedMalformed?: number;
    /** 读到的原始行数（含空行与坏行）—— 给"跳了多少"一个分母。 */
    readonly totalLines: number | undefined;
    /**
     * ★★ 被采集判据拒掉的条数，**按判据 id 分组**（直接喂 `collectionHealthOf` 的第二参）。
     *
     * ★ 来源：每条信号自带的 `collection.verdicts`（t87 转发的裁决）——
     *   **数 `ok` 之外的裁决**（`unmeasured` 也算"这一条没被采进来"，但它单列语义更准：
     *   ★ 如实记：本计数把 `unmeasured` 与 `false` 都算"没进来" —— 而两者的补救动作不同
     *   （前者是判据说测不了，后者是判据说不要）。★ 本模块**不合并**它们：`refused` 只数
     *   `ok` 之外的，**读的人若要分**，原始行还在（本模块不丢）。
     *   ★ 为什么这里数而不是 snapshot 数：坏行/缺席该格的行**没有 verdicts 可言**，
     *   在读行的那一层计数才不会把"没这格"错算成 0。
     */
    readonly refused?: Readonly<Record<string, number>>;
}
/**
 * 读 `signals.jsonl` 并投影成 `HealthRecord[]`。
 *
 * @param stateRoot 状态根（`signalsPathOf` 拼路径 —— **不猜**）。
 * @param readFile  注入的读文件函数（生产给 `fs/promises.readFile`；夹具注入内存版）。
 */
export declare function readSignalsHealth(stateRoot: string, readFile: (path: string, encoding: 'utf8') => Promise<string>): Promise<SignalsHealthRead>;
/**
 * ── ★★★ N1.2：`deriveCollectionIndex` —— 给 `collection.cooldown` 一个**真实输入** ────
 *
 * ── 它修的是什么（MEASURED，本任务的由来）──────────────────────────────────────
 *
 *   `collection.cooldown` 在真实台账上 **39/39 判不了**，而那不是"判据坏了"：
 *   它的 `requires = ['candidate', 'index']`，而**三个调用点一个都没传 `index`**
 *   ⇒ `index === undefined` ⇒ 判据照规程答 `unmeasured`。
 *   ★ 也就是说：那条判据**从来没有机会**回答它被造出来要回答的问题。
 *
 *   ⇒ 本函数把"盘上已有的信号"投影成 {@link CollectionIndex} 的形状：
 *     三份（`seen` / `lastBySource` / `counts`）各自有**明确的来源**，不猜。
 *
 * ── ★★★ 为什么它住在 `evolution/` 而**不**住在 `gates/collection/` ─────────────
 *
 *   `shared.ts` 的注释逐字写着「判据不查库」——**判据层零 I/O 是载荷级不变量**
 *   （`src/gates/runtime/stall.ts` 的注释：那条纯度是载荷，不是风格）。
 *   而本函数要读 `signals.jsonl` ⇒ 它**必须**在 I/O 那一侧，即 `evolution/`。
 *
 * ── ★★★ 去重键的计算**注入**进来，不在这里重写一遍 ────────────────────────────
 *
 *   `dedupeKeyOf` 的真值在 `src/gates/collection/shared.ts`。
 *   ★ 而 `evolution/` **不许** import `src/gates/**`（规格 §1 的单向原则，
 *     `entities.ts` 那一侧也是这么绕的：把 `registry.evaluate` 包成回调传下去）。
 *   ⇒ 所以这里收一个 `keyOf` 回调。**公式只有一份**，而依赖方向不变。
 *   ★ 若在这里再写一遍 `kind.sort().join(',')`，就等于把"同一件事"的定义变成两份 ——
 *     而两份会在某一天分叉，分叉的表现是"去重没拦住"（少采，且静默）。
 *
 * ── ★★ 三态：读不到 ≠ 空索引 ──────────────────────────────────────────────────
 *
 *   `signals.jsonl` **缺席** ⇒ `{ status: 'absent' }`，**不是**一个空索引。
 *   ★ 空索引会被 cooldown 读成"这个来源从没说过话" ⇒ `ok` ⇒ **放行**
 *     ⇒ "采集流水线还没开过"被读成"每条都是第一次，全都该采"。
 *   ⇒ 缺席时调用方**不传** `index`，判据自己答 `unmeasured` —— 那是正确读数。
 */
export interface DerivedCollectionIndex {
    /**
     * ★ 三态：`'derived'`（读到了台账，哪怕零条）/ `'absent'`（文件还没有）。
     * ★ `'derived'` + 零条 与 `'absent'` **不同形**（与 `readSignalsHealth` 同一条纪律）。
     */
    readonly status: 'derived' | 'absent';
    /** 投影出来的索引（只在 `status === 'derived'` 时给调用方用）。 */
    readonly index?: {
        readonly seen: ReadonlySet<string>;
        readonly lastBySource: ReadonlyMap<string, number>;
        readonly counts: ReadonlyMap<string, number>;
    };
    /** 读到了几行（分母 —— 让"零条"可复核，而不是只说一句"空"）。 */
    readonly rowsRead: number;
    /** 坏行数（**跳过**，不整文件放弃 —— 与 `readSignalsHealth` 同一条纪律）。 */
    readonly skippedMalformed: number;
    /**
     * ── ★★ 键**重建不出来**的行数（旧行：N1.2 之前没落 `candidate`）──────────────
     *
     * ★ 这些行**不参加去重**（它们确实没有那份原料），但**参加** cooldown
     *   （它们的 `source`/`at` 是真的，见 `indexProjectionOf`）。
     * ★ 与 `skippedMalformed` **不同形**：那些是坏数据；这些是好数据、只是当时没写全。
     * ★ 必须报出来的理由：否则"去重在这批行上没生效"与"这批行本来不重复"同形 ——
     *   而把这种同形拆开，正是本任务的全部工作。
     */
    readonly keysUnreconstructable: number;
}
/**
 * 读 `signals.jsonl` 并投影成一份索引（**只读**；不写盘、不加锁）。
 *
 * @param stateRoot 状态根（`signalsPathOf` 拼路径 —— **不猜**）。
 * @param readFile  注入的读文件函数（生产给 `fs/promises.readFile`）。
 * @param keyOf     去重键的计算（**注入** —— 见文件头那一节）。
 */
export declare function deriveCollectionIndex(stateRoot: string, readFile: (path: string, encoding: 'utf8') => Promise<string>, keyOf: (candidate: {
    readonly kind: readonly string[];
    readonly component?: string;
    readonly message: string;
}) => string): Promise<DerivedCollectionIndex>;
