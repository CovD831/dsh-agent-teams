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
/** 一个记录的桶键：`component` + 排序后的 `kind`。 */
function bucketKeyOf(record) {
    return `${record.component ?? '(unattributed)'}|${[...record.kind].sort().join(',')}`;
}
/**
 * 把记录聚合成桶。
 *
 * ★ 桶键 = `(component, kind)` —— **与本仓实测那个口径一致**（54 个唯一对）。
 * ★ `kind` **先排序再 join**：否则 `['a','b']` 与 `['b','a']` 会成为两个桶，
 *   于是"唯一桶数"被**虚假抬高**（而那会让 redundancy 变得好看 —— 正是要防的方向）。
 */
export function bucketsOf(records) {
    const acc = new Map();
    for (const record of records) {
        const key = bucketKeyOf(record);
        const component = record.component ?? '(unattributed)';
        const kind = [...record.kind].sort();
        const prior = acc.get(key);
        if (prior === undefined) {
            acc.set(key, { component, kind, count: 1, firstAt: record.at, lastAt: record.at });
            continue;
        }
        prior.count += 1;
        /** ★ 时间跨度：**首末**都要，因为"持续了多久"本身就是读数（161 次 / 8 天那个形状）。 */
        if (record.at < prior.firstAt)
            prior.firstAt = record.at;
        if (record.at > prior.lastAt)
            prior.lastAt = record.at;
    }
    /**
     * ★ 按**计数降序**排（同计数按桶键升序，保证**确定性** ——
     *   否则两次调用给出不同的顺序，而"顺序变了"与"内容变了"会无法区分）。
     */
    return [...acc.entries()]
        .sort(([ka, a], [kb, b]) => (b.count - a.count) || (ka < kb ? -1 : ka > kb ? 1 : 0))
        .map(([, value]) => ({ component: value.component, kind: value.kind, count: value.count, firstAt: value.firstAt, lastAt: value.lastAt }));
}
/* ─────────────────────────────────────────────────────────────────────────────
 * ★★★ 三条自检：把 `redundancy` 那三个**看起来对**的错法钉住
 * ───────────────────────────────────────────────────────────────────────────── */
/**
 * ★★ 自检 1：`redundancy` **必须落在 (0, 1]** —— 它是**比例**，不是计数。
 *   ★ 会抓到"分母用了桶数"（那会恒为 1）与"分子用了记录数减桶数"（那会 > 1 当且仅当桶数少）。
 */
export function checkRedundancyIsARatio(redundancy) {
    if (!(redundancy > 0) || redundancy > 1) {
        return `★ redundancy 必须是 (0, 1] 里的比例（唯一桶数 / 总记录数），实测 ${redundancy}`;
    }
    return undefined;
}
/**
 * ★★ 自检 2：`(component, kind)` 的对数**必须 ≥** `component` 单键的相异数。
 *   ★ 会抓到"用了单键"：实测本仓 `component` 单键 **35**、`(component, kind)` 对 **54**。
 */
export function checkBucketKeyIsTwoField(records, pairCount) {
    const single = new Set(records.map((record) => record.component ?? '(unattributed)')).size;
    if (pairCount < single) {
        return `★ (component, kind) 对数 ${pairCount} < 单键组件数 ${single} —— 桶键**必须**带 kind，`
            + '只用 component 会少算（本仓实测：单键 35，两段 54）';
    }
    return undefined;
}
/**
 * ── ★★ 自检 4（t86 实测加）：**多 `kind` 的记录不许被算成多个桶** ─────────────────
 *
 * ★ 这是上面那两种读法的**分界线**，而它是一条**要能被机械验证**的性质：
 *   本仓有 **18 条记录带多个 `kind`**（如 `["unwired","misclassified"]`）。
 *   ⇒ 读法 ①（桶）它们各算 **1** 个，读法 ②（对）它们各算 **N** 个。
 *   ⇒ 判据：**对数必须 ≥ 桶数**，且**两者相等当且仅当没有多 `kind` 记录**。
 *   ★ 没有这条，`redundancy` 用哪个读法**在读数上看不出差别**（两个都是"一个比例"）。
 */
export function checkMultiKindIsDistinguishable(buckets, pairCount) {
    const multiKind = buckets.filter((bucket) => bucket.kind.length > 1).length;
    if (pairCount < buckets.length) {
        return `★ 对数 ${pairCount} < 桶数 ${buckets.length} —— 对必须是把 kind 逐元素展开，不可能更少`;
    }
    if (multiKind === 0 && pairCount !== buckets.length) {
        return `★ 没有多 kind 的桶时，对数(${pairCount})必须等于桶数(${buckets.length}) —— 两者现在对不上`;
    }
    return undefined;
}
/**
 * ★★ 自检 3：**空记录的 redundancy 不许是 1**。
 *   ★ "没有记录"⇒ 比例**无从谈起** ⇒ 它必须是 `0`（并且**调用方要能看出这是空集**）。
 *   ★ 若返回 1，"什么都没采"会与"全都唯一"同形 —— 而那正是本仓记账最久的形态。
 */
export function checkEmptyIsNotPerfect(redundancy, recordCount) {
    if (recordCount === 0 && redundancy !== 0) {
        return `★ 空记录集的 redundancy 必须是 0，实测 ${redundancy} —— "没有记录"与"全都唯一"不许同形`;
    }
    return undefined;
}
/* ─────────────────────────────────────────────────────────────────────────────
 * 读数本体
 * ───────────────────────────────────────────────────────────────────────────── */
/**
 * 算 `CollectionHealth`。
 *
 * @param records 采集到的记录（调用方注入）
 * @param refused ★ 被拒的条数，**按判据 id 分组**（调用方注入；本函数不跑判据）
 */
export function collectionHealthOf(records, refused = {}) {
    const buckets = bucketsOf(records);
    const total = records.length;
    /**
     * ★★★ **唯一 `(component, 单个 kind)` 对数 / 总记录数** —— 规格那个 0.145 的口径。
     *   ★ 与 `buckets.length`（读法 ①）**刻意不是同一个数**：带多个 `kind` 的记录
     *     在桶里算 1、在对里算 N。实测本仓：桶 **38**、对 **54**（差 16，来自 18 条多 `kind` 记录）。
     *   ★ 空集 ⇒ 0（**不是 1**）—— 见 `checkEmptyIsNotPerfect`。
     */
    const pairs = new Set();
    for (const record of records) {
        for (const kind of record.kind)
            pairs.add(`${record.component ?? '(unattributed)'}|${kind}`);
    }
    const redundancy = total === 0 ? 0 : pairs.size / total;
    /**
     * ★ `coverage`：**有多少条记录落进了"已被区分的组合"**。
     *   ★ 第一版的口径（如实写明，且它**与 redundancy 是独立两个数**）：
     *     一条记录算"被覆盖"，当且仅当它属于一个**已被区分**的桶 ——
     *     即该桶的键里 `kind` **非空**（"我们说得清它属于哪一类"）。
     *   ⇒ 一个 `kind` 为空的记录，是一条**落进了桶却没有被区分**的记录。
     *   ★ 它**不是** `redundancy` 的补数：两者的分母相同（总记录数），
     *     但分子答的是不同的问题（"有多新" vs "我们说不说得清它是什么"）。
     */
    const covered = records.filter((record) => record.kind.length > 0).length;
    const coverage = total === 0 ? 0 : covered / total;
    return { buckets, redundancy, coverage, refused };
}
