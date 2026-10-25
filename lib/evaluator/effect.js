/**
 * ── 评估器的**收益读数**（t92 · 来源 ③）────────────────────────────────────────
 *
 * ★★ 结构性判据（规格 `EFFECT-MEASUREMENT-RESEARCH.md` §1.1）—— 因为
 *   本仓 91% 的桶只有 1 条（54 个桶：最大 167 · 中位 1 · n===1 的 49 个），
 *   **统计判据无数据可用**：
 *
 * ```
 *   before.count === 0         ⇒ unmeasured（无基线，无从比较）
 *   after.count  <  before.count ⇒ improved（它降了 —— 无阈值）
 *   after.count  >= before.count ⇒ unchanged（它没降）
 *   ★ 幅度作读数，不进 verdict（MemOS 的"阈值永不触发"教训）
 * ```
 *
 * ★ 独立性：本文件**不 import `src/evolution/`** —— 桶的键口径与
 *   `evolution/health.ts` 的 `bucketKeyOf` 一致（`component` + 排序后 `kind`），
 *   但**形状独立**（与那个文件对 `CollectionCandidate` 的取舍同一条）。
 */
/**
 * ★★★ 「最小观察期」—— ★★★ **这是一个猜测，没有任何依据能指**。
 *
 * 出处（研究 §4.3 逐字）：「而那个"最小观察期"是多少 —— 我没有依据，需要实测积累」。
 * 它的存在只有一个理由：after 窗口太短时，"计数没降"与"还没来得及降"在计数上**同形**
 * ⇒ 必须报 unmeasured，而"多短算太短"今天只能猜。
 *
 * ★★ 与"有依据的常量"**不同形**的三条硬要求（不许只写一个数字）：
 *   · 它叫 `GUESSED_…`（名字里带 GUESSED，而不是 `MIN_OBSERVATION_PERIOD` 那种测量口径的名字）；
 *   · 本注释声明它**没有依据**、来自研究 §4.3 的建议值；
 *   · 它**必须可改** —— 调用方可经 `options.minObservationMs` 覆盖（缺省才用它）。
 *
 * ★ 建议值 = 1 天（研究 §4.3 的代理口径：`max(1 天, 该桶中位间隔 × N)` 的下界）。
 */
export const GUESSED_MIN_OBSERVATION_MS = 24 * 60 * 60 * 1000;
/** 桶键：与 `evolution/health.ts` 的 `bucketKeyOf` 同一口径（component + 排序后 kind）。 */
export function effectBucketKeyOf(effect) {
    return `${effect.component}|${[...effect.kind].sort().join(',')}`;
}
/**
 * 算收益读数。
 *
 * @param subject  评估对象（靶 = `subject.effect`；**没有 effect ⇒ 整条收益读数缺席**，
 *                 而不是报 unmeasured —— "没声明靶"与"声明了但判不了"不同形）。
 * @param count    窗口计数器（调用方注入 —— 它知道台账在哪，本模块不知道）。
 * @param evaluatedAt  评估那一刻（after 窗口的右端点）。
 */
export function effectReadingOf(subject, count, evaluatedAt, options = {}) {
    const effect = subject.effect;
    if (effect === undefined)
        return undefined;
    const bucketKey = effectBucketKeyOf(effect);
    const reasons = [];
    const before = { from: Number.NEGATIVE_INFINITY, to: subject.at };
    const after = { from: subject.at, to: evaluatedAt };
    const beforeCount = count(before);
    const afterCount = count(after);
    /**
     * ── ★★★ 反向半边 A：无基线 ⇒ unmeasured，**不许报 ineffective** ────────────────
     *
     * `before.count === 0` 有两种成因（"桶本来就干净" / "桶还没有记录"），
     * 而无论哪种，"没降"都**不能**读成"没用" —— 那是把"没测到"并进"不合格"
     * （本仓记账最久的合流）。★ 窗口照实给出（读数仍可读），verdict 只能是 unmeasured。
     */
    if (beforeCount === 0) {
        reasons.push('no-baseline: before.count === 0 — nothing to compare against (structural criterion, spec §1.1)');
        return { bucketKey, before: { count: beforeCount, window: before }, after: { count: afterCount, window: after }, verdict: 'unmeasured', delta: undefined, reasons };
    }
    /**
     * ── ★ 最小观察期：after 窗口太短 ⇒ unmeasured ────────────────────────────────
     * ★★ 而阈值本身是【猜测】（见 `GUESSED_MIN_OBSERVATION_MS` 的注释）——
     *   这里只做"标为猜测的检查"，不假装它是测量。
     */
    const minObservationMs = options.minObservationMs ?? GUESSED_MIN_OBSERVATION_MS;
    if (after.to - after.from < minObservationMs) {
        reasons.push(`observation-window-too-short: after window ${after.to - after.from}ms < minObservationMs ${minObservationMs}ms — the count has not had a fair chance to move`);
        reasons.push('minObservationMs is a GUESS (spec research §4.3: no basis today); it is overridable via options.minObservationMs');
        return { bucketKey, before: { count: beforeCount, window: before }, after: { count: afterCount, window: after }, verdict: 'unmeasured', delta: undefined, reasons };
    }
    /**
     * ── ★ 结构性裁决：无阈值，只看"降了没有"；幅度作读数 ─────────────────────────
     *
     * ★★ 反向半边 B 在这里落地：走到这一步 ⇒ 有基线（before > 0）且窗口不短 ⇒
     *   verdict 只会是 `improved` 或 `unchanged` —— **绝不会是 unmeasured**。
     *   "无基线"（上一支，`unmeasured` + no-baseline）与"降了但没降够"（本支，
     *   `unchanged` + delta 读数）**不同形**：verdict 不同、reasons 说的不是一件事。
     */
    const delta = beforeCount - afterCount;
    const verdict = afterCount < beforeCount ? 'improved' : 'unchanged';
    reasons.push(`structural: before.count=${beforeCount} → after.count=${afterCount} (delta=${delta}); threshold-free (spec §1.1 / §4.3 MemOS lesson: magnitude is a reading, not a verdict)`);
    return { bucketKey, before: { count: beforeCount, window: before }, after: { count: afterCount, window: after }, verdict, delta, reasons };
}
/**
 * ── ★★★ 2026-10-22：**一批提案**的收益读数（R6.2 的出口）────────────────────────────
 *
 * ── 这个函数补的是哪一格 ────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-22 审计）：
 *
 * ```
 * $ grep -rn "from ['\"].*evaluator/" src/ --include=*.ts | grep -v '^src/evaluator/'   ⇒ 空
 * $ grep -rn "effectReadingOf(" src/ --include=*.ts                                     ⇒ 只有它自己
 * ```
 *
 * ⇒ 整个 `src/evaluator/` 在**生产上零消费者**：收益判据写对了、也测过，而**没有人在读**。
 *   ★ 这正是 §18 那条「接上了 = ① 注册 ② 生产求值点 ③ 输入面真有产出」的第三格：
 *     它连 ② 都没有。
 *
 * ── ★★ 为什么它住在这里，而不在 `src/evolution/` ─────────────────────────────────
 *
 * 需求 §1 的规则 A：**别人 → evolution 只许 import 一个接口面**；而 §2/§3 裁定
 * 评估器是**独立模块**（`src/evaluator/` 三文件剥注释后零 import 于 evolution/gates）。
 * ⇒ 两个方向都不能互相 import。
 *
 * 所以正确的落点是**同时看得见两边的那个装配层**（`src/snapshot.ts`）：
 * 它把「提案的 `effect` 靶」（evolution 侧）与「信号台账的窗口计数」（也是 evolution 侧，
 * 但由调用方以**纯函数**注入）一起喂进本函数。
 * ★ 本函数因此**不认识** `Proposal` / `EvolutionSignal` 任何一个类型 ——
 *   它只收一个最小的结构（`{ id, at, effect }`），这样模块边界在**类型层面**就是真的。
 *
 * ── ★★ 三态，且"没靶"与"判不了"不同形 ────────────────────────────────────────────
 *
 * ```
 * 没有 effect 靶     ⇒ 这条提案**不进结果**（不是 unmeasured —— 它没有被问过这个问题）
 * before.count === 0 ⇒ unmeasured（无基线；★ 绝不读成"没用"）
 * before > 0         ⇒ improved / unchanged（结构性判据，无阈值）
 * ```
 *
 * @param subjects - 每个待评估对象：`id` · `at`（提案产出的时刻，前后窗口的分界点）· `effect`（靶）。
 * @param count    - 窗口计数器：给一个时间窗，返回该窗内的**信号条数**（调用方注入）。
 * @param evaluatedAt - 评估那一刻（after 窗口的右端点）。
 */
/** `effectReadingOf` 的两条 return 都会给窗口；缺席 ⇒ 抛（**不补 0**，见上面的注释）。 */
function requireWindow(value, id, which) {
    if (value === undefined) {
        throw new Error(`evaluator: effect reading for subject "${id}" carries no ${which} window — that shape is not produced by effectReadingOf, so it must not be silently zero-filled`);
    }
    return value;
}
export function effectReadoutOf(subjects, count, evaluatedAt, options = {}) {
    /** ★ 用可变中间量再转只读 —— 直接推只读数组会撞 `readonly T[]`（类型层拦住的是"原地改结果"）。 */
    const rows = [];
    for (const subject of subjects) {
        /** ★ 没有靶 ⇒ **不进结果**（"没被问过"不是"判不了"）。 */
        if (subject.effect === undefined)
            continue;
        const reading = effectReadingOf({ id: subject.id, at: subject.at, contract: {}, effect: subject.effect }, count, evaluatedAt, options);
        if (reading === undefined)
            continue;
        rows.push({
            id: subject.id,
            bucketKey: reading.bucketKey,
            verdict: reading.verdict,
            /**
             * ★ `EffectReading.before/after` 在类型上是**可缺席**的（那个类型要覆盖
             *   "窗口还没算出来"的形态）。而**本函数**只在 `effectReadingOf` 返回后填，
             *   那个函数在两条 return 上都给了它们 ⇒ 这里缺席**不该发生**。
             *   ★★ 所以缺的时候不能补 0（那会把"没有这个窗口"伪装成"窗口里有 0 条"）——
             *     如实抛，让调用方看见"这里有一条不该发生的形状"。
             */
            before: requireWindow(reading.before, subject.id, 'before').count,
            after: requireWindow(reading.after, subject.id, 'after').count,
            ...reading.delta === undefined ? {} : { delta: reading.delta },
            reasons: reading.reasons,
        });
    }
    const tally = (verdict) => rows.filter((row) => row.verdict === verdict).length;
    return {
        considered: rows.length,
        improved: tally('improved'),
        unchanged: tally('unchanged'),
        unmeasured: tally('unmeasured'),
        rows,
    };
}
