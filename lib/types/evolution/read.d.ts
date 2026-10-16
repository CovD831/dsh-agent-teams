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
