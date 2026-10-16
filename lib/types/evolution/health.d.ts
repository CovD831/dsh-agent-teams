/**
 * ── 采集层读数：`CollectionHealth`（t86）────────────────────────────────────────
 *
 * ★ 纯函数：**输入 = 记录快照，输出 = 读数**。本文件不读盘、不查库、不 import I/O ——
 *   "记录"由调用方注入（与判据同一条纪律）。
 *
 * ── ★★★ `redundancy` 的口径：**唯一 `(component, kind)` 对 / 总记录数** ─────────────
 *
 * 规格逐字：**唯一桶数 / 总记录数**；MEASURED（372 条台账）：`54 / 372 ≈ 0.145`。
 *
 * ── ★★ 而"唯一桶"这个词**有两种读法**，实测它们差 16 个数 ─────────────────────────
 *
 * 本文件第一版按「桶 = `(component, kind **集合**)`」算 ⇒ 得 **38** ⇒ `0.1022`
 * ⇒ **与队长实测的 0.145 不符**。⇒ 按纪律**停下核对口径**，实测出两种读法：
 *
 * | 读法 | 定义 | 实测 | redundancy |
 * |---|---|---|---|
 * | ① 桶 = `(component, kind 集合)` | 一条记录的 `kind` 整体当一个键 | **38** | `0.1022` ✗ |
 * | ② 对 = `(component, 单个 kind)` | `kind` 数组**逐元素**展开成对 | **54** | `0.1452` ✅ |
 *
 * ★ 差异来源**已定位**：台账里 **18 条记录有多个 `kind`**，例如
 *   `contract.verify-command · ["unwired","misclassified"]` ⇒ 它算 **1 个桶**、但算 **2 个对**。
 *
 * ⇒ ★★ **采用读法 ②**（规格那个数只有它能算出）。而**两者不是同一个东西**：
 *   · `buckets[]` 仍按**读法 ①** 聚合 —— 它是**给人看的聚合**（一条记录属于哪个桶）；
 *   · `redundancy` 用**读法 ②** —— 它度量的是**分类粒度**（"我们区分出多少个不同的类别标签"）。
 *   ★ 这也解释了它为什么叫 `redundancy` 而不是 `bucketUniqueness`。
 *
 * ★ 空集给出 **0**（不是 1）："什么都没采"与"全都唯一"不许同形。
 */
import type { CollectionBucket, CollectionHealth } from './types.ts';
/**
 * 一条**待聚合**的记录 —— 与 `gates/collection/shared.ts` 的 `CollectionCandidate` 同形，
 * 但**刻意不复用那个类型**：本目录**不许依赖 `src/gates/**` 的实现**（分层，见 types.ts）。
 * ★ 结构相同而类型独立 ⇒ 两边的演进不会互相绑架，而"形状一致"由夹具钉住。
 */
export interface HealthRecord {
    readonly component?: string;
    readonly kind: readonly string[];
    readonly at: number;
}
/**
 * 把记录聚合成桶。
 *
 * ★ 桶键 = `(component, kind)` —— **与本仓实测那个口径一致**（54 个唯一对）。
 * ★ `kind` **先排序再 join**：否则 `['a','b']` 与 `['b','a']` 会成为两个桶，
 *   于是"唯一桶数"被**虚假抬高**（而那会让 redundancy 变得好看 —— 正是要防的方向）。
 */
export declare function bucketsOf(records: readonly HealthRecord[]): readonly CollectionBucket[];
/**
 * ★★ 自检 1：`redundancy` **必须落在 (0, 1]** —— 它是**比例**，不是计数。
 *   ★ 会抓到"分母用了桶数"（那会恒为 1）与"分子用了记录数减桶数"（那会 > 1 当且仅当桶数少）。
 */
export declare function checkRedundancyIsARatio(redundancy: number): string | undefined;
/**
 * ★★ 自检 2：`(component, kind)` 的对数**必须 ≥** `component` 单键的相异数。
 *   ★ 会抓到"用了单键"：实测本仓 `component` 单键 **35**、`(component, kind)` 对 **54**。
 */
export declare function checkBucketKeyIsTwoField(records: readonly HealthRecord[], pairCount: number): string | undefined;
/**
 * ── ★★ 自检 4（t86 实测加）：**多 `kind` 的记录不许被算成多个桶** ─────────────────
 *
 * ★ 这是上面那两种读法的**分界线**，而它是一条**要能被机械验证**的性质：
 *   本仓有 **18 条记录带多个 `kind`**（如 `["unwired","misclassified"]`）。
 *   ⇒ 读法 ①（桶）它们各算 **1** 个，读法 ②（对）它们各算 **N** 个。
 *   ⇒ 判据：**对数必须 ≥ 桶数**，且**两者相等当且仅当没有多 `kind` 记录**。
 *   ★ 没有这条，`redundancy` 用哪个读法**在读数上看不出差别**（两个都是"一个比例"）。
 */
export declare function checkMultiKindIsDistinguishable(buckets: readonly CollectionBucket[], pairCount: number): string | undefined;
/**
 * ★★ 自检 3：**空记录的 redundancy 不许是 1**。
 *   ★ "没有记录"⇒ 比例**无从谈起** ⇒ 它必须是 `0`（并且**调用方要能看出这是空集**）。
 *   ★ 若返回 1，"什么都没采"会与"全都唯一"同形 —— 而那正是本仓记账最久的形态。
 */
export declare function checkEmptyIsNotPerfect(redundancy: number, recordCount: number): string | undefined;
/**
 * 算 `CollectionHealth`。
 *
 * @param records 采集到的记录（调用方注入）
 * @param refused ★ 被拒的条数，**按判据 id 分组**（调用方注入；本函数不跑判据）
 */
export declare function collectionHealthOf(records: readonly HealthRecord[], refused?: Readonly<Record<string, number>>): CollectionHealth;
