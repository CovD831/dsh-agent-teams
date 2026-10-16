/**
 * ── 评估器的**打分与合成**（t92 · 来源 ①②④ + 出口）─────────────────────────────
 *
 * ★★★ 输出 = **一个概率**（用户裁定）+ 逐条读数。
 *
 * 用户原话（队长核实过数学前提）：「好像不需要两个数字去打分……决策模型对选项
 * 输出一个概率分布……这个概率其实就相当于是一种置信度了,所以可能只需要一个数字」。
 *
 * ★★ 数学前提成立：`Σp = 1` ⇒ 分布同时编码**选择**与**把握**。
 * ★★★ **但它无法表达弃权**：`p = [0.5, 0.5]` 是"两个都一样可能"，
 *   而那与"我判不了"是**两件事** ⇒ `unmeasured` 必须是**第三个答案**
 *   （verdict 层面），**不能**靠 `p = 0.5` 表达。
 *   ⇒ 本模块的形状：`probability: number | undefined` —— `undefined` ⇒ 判不了（**不是 0**），
 *     与 `confidenceOf` 对缺席计数返回 `undefined` 是**同一条纪律**。
 *
 * ★★ **复用 `src/confidence.ts` 的 `confidenceOf`，不重写**（它已实现、零调用，
 *   且它就是 Beta 后验均值（Add-k 平滑）—— 与"决策模型的概率输出"是同一个数学对象）。
 *   本文件不 import 它的实现，**调用它**（import 是复用，重写才是违规）。
 */
import { confidenceOf } from "../confidence.js";
import { effectReadingOf } from "./effect.js";
/**
 * 从 subject 读出**两个本地来源**（验收 / 机械验证）的计数 —— 纯读，不做 I/O。
 *
 * ★ 收益（来源 ③）**不在**这里：它需要台账窗口计数器（调用方注入），
 *   本函数没有台账 ⇒ 塞一个恒 0 计数器会造出一条**假的** "no-baseline" 读数 ——
 *   那正是"没测到"被悄悄制造出来的形状。⇒ effect 只在 `evaluateSubject`（有计数器）里算。
 *
 * ★ 三态纪律：**一格缺席就是缺席**，不补 0 ——
 *   `acceptanceResults` 缺席 ⇒ `total: 0` 且调用方据字段缺席判"没填"，
 *   "没填验收"与"填了全过"在读取端**不同形**。
 */
export function sourceTalliesOf(subject) {
    const delivered = subject.delivered;
    const acceptance = delivered?.acceptanceResults ?? [];
    const commands = delivered?.commandsRun ?? [];
    return {
        acceptance: { passed: acceptance.filter(item => item.status === 'passed').length, total: acceptance.length },
        verify: { passed: commands.filter(item => item.status === 'passed' || (item.exitCode !== undefined && item.exitCode === 0)).length, total: commands.length },
    };
}
/**
 * 把来源计数折成一个 **UsageTally**，喂给**既有的** `confidenceOf`。
 *
 * ★ 对应关系（逐格可核）：
 *   `upvoted` = 判"好"的次数（验收过 + 命令过 + 收益 improved）
 *   `recalled` = 能判的总次数（同一分母）
 * ⇒ `confidenceOf` 的三条性质（采纳率驱动 / 小样本收缩 / 缺席 ⇒ undefined）
 *   **原封不动**地适用于"这条改动有多可信地有效"。
 */
export function tallyOf(tallies) {
    const upvoted = tallies.acceptance.passed + tallies.verify.passed
        + (tallies.effect?.verdict === 'improved' ? 1 : 0);
    const recalled = tallies.acceptance.total + tallies.verify.total
        + (tallies.effect !== undefined ? 1 : 0);
    return { upvoted, recalled };
}
/**
 * ★★★ 评估一个 subject —— 本模块的**出口**。
 *
 * @param subject    评估对象（契约形状）。
 * @param count      收益窗口计数器（调用方注入 —— 它知道台账在哪）。
 * @param evaluatedAt 评估那一刻（after 窗口右端点）。
 * @param options    `minObservationMs` 等可覆盖项（透传给 `effectReadingOf`）。
 */
export function evaluateSubject(subject, count, evaluatedAt, options = {}) {
    const readings = [];
    const reasons = [];
    /** 来源 ①：验收 —— `declared: false` ⇒ "没填"，ok: undefined（判不了）。 */
    const acceptance = subject.delivered?.acceptanceResults;
    if (acceptance === undefined) {
        readings.push({ name: 'acceptance', value: undefined, ok: undefined });
        reasons.push('acceptance: absent — this subject declared no acceptance results (not "all passed")');
    }
    else {
        const passed = acceptance.filter(item => item.status === 'passed').length;
        readings.push({ name: 'acceptance', value: `${passed}/${acceptance.length}`, ok: acceptance.length > 0 && passed === acceptance.length });
        reasons.push(`acceptance: ${passed}/${acceptance.length} passed`);
    }
    /** 来源 ②：机械验证 —— `commandsRun` 的 status/exitCode。 */
    const commands = subject.delivered?.commandsRun;
    if (commands === undefined) {
        readings.push({ name: 'verify', value: undefined, ok: undefined });
        reasons.push('verify: absent — no commands were recorded for this subject');
    }
    else {
        const passed = commands.filter(item => item.status === 'passed' || (item.exitCode !== undefined && item.exitCode === 0)).length;
        readings.push({ name: 'verify', value: `${passed}/${commands.length}`, ok: commands.length > 0 && passed === commands.length });
        reasons.push(`verify: ${passed}/${commands.length} commands passed`);
    }
    /** 来源 ③：收益 —— 靶从 subject 读出（`effect`），结构性判据在 effect.ts。 */
    const effect = effectReadingOf(subject, count, evaluatedAt, options);
    if (effect === undefined) {
        /**
         * ★★ 无靶 ⇒ 这一条**读数整条缺席**（不是 value: undefined 的占位）——
         *   "没声明靶"（这条读数不存在）与"声明了但判不了"（ok: undefined 在场）
         *   必须不同形（契约：靶从 subject 读出，不许另立一套）。
         *   读取端问"为什么没有 effect 那一条"⇒ reasons 里这句在。
         */
        reasons.push('effect: no target declared — the subject does not name a (component, kind) bucket, so this reading is absent (not "cannot judge")');
    }
    else {
        readings.push({ name: 'effect', value: effect.verdict === 'unmeasured' ? `unmeasured (${effect.reasons[0]?.split(':')[0] ?? 'unknown'})` : `before=${effect.before?.count} after=${effect.after?.count} delta=${effect.delta}`, ok: effect.verdict === 'improved' ? true : effect.verdict === 'unchanged' ? false : undefined });
        reasons.push(`effect[${effect.bucketKey}]: ${effect.verdict} — ${effect.reasons.join('; ')}`);
    }
    /**
     * ── ★ 概率：复用 confidenceOf（不重写）───────────────────────────────────────
     *
     * 三来源折成一个 tally ⇒ `confidenceOf` 给出 Beta 后验均值。
     * ★ 缺席的处理是**继承**它的：任一来源"能判的总数"为 0（什么都没填）⇒
     *   recalled === 0 ⇒ 它返回 0.5 —— 而那**不是**"判不了"的正确表达
     *   （0.5 是"两个都一样可能"，与弃权是两件事）。
     *   ⇒ **先判结构性弃权**：三来源全部缺席 ⇒ verdict unmeasured + probability undefined，
     *   只有"至少一条来源真的测了"才把 tally 交给 confidenceOf。
     */
    const anyMeasured = (acceptance !== undefined && acceptance.length > 0)
        || (commands !== undefined && commands.length > 0)
        || effect !== undefined;
    const tallies = {
        acceptance: { passed: acceptance?.filter(item => item.status === 'passed').length ?? 0, total: acceptance?.length ?? 0 },
        verify: { passed: commands?.filter(item => item.status === 'passed' || (item.exitCode !== undefined && item.exitCode === 0)).length ?? 0, total: commands?.length ?? 0 },
        effect,
    };
    const rawProbability = anyMeasured
        ? confidenceOf(tallyOf(tallies)) ?? undefined
        : undefined;
    /**
     * ── ★ verdict：三态，unmeasured 是第三个答案（不是 0.5、不是低分）─────────────
     *
     * 结构性优先级：
     *   ① 三来源**全部缺席** ⇒ unmeasured（弃权 —— p=0.5 表达不了的那件事）；
     *   ② 收益读数是 unmeasured（无基线 / 窗口太短）⇒ 整体 unmeasured
     *      （★ 有一条核心证据判不了，就不许下"有效/无效"的结论）；
     *   ③ 否则：**有任一来源测了且测出问题**（验收/验证有 failed，或收益 unchanged）
     *      ⇒ ineffective；
     *   ④ 否则（测了且没测出问题）⇒ effective。
     * ★ 幅度不进 verdict（effect.delta 只是读数）；概率不进 verdict（它是把握，不是结论）。
     */
    const anyFailed = (acceptance !== undefined && acceptance.some(item => item.status === 'failed'))
        || (commands !== undefined && commands.some(item => item.status === 'failed' || (item.exitCode !== undefined && item.exitCode !== 0)));
    const verdict = !anyMeasured ? 'unmeasured'
        : effect !== undefined && effect.verdict === 'unmeasured' ? 'unmeasured'
            : anyFailed || effect?.verdict === 'unchanged' ? 'ineffective'
                : 'effective';
    /**
     * ── ★★★ 弃权不带数：verdict unmeasured ⇒ probability **undefined** ──────────────
     *
     * 一个数字在读者眼里是"把握有多大"的回答；**弃权是对另一个问题的拒绝**。
     * 把 0.333 挂在 unmeasured 上，读者会把它读成"低把握的判断" —— 而那正是
     * 用户点名的那个合流：p=0.5（或任何数）表达不了"我判不了"。
     * ⇒ 数字只在 verdict 是 effective/ineffective 时在场（那时它才有对象）。
     * ★ 弃权的那一格去了哪：reasons（为什么判不了）与 readings（哪几条 ok:undefined）。
     */
    const probability = verdict === 'unmeasured' ? undefined : rawProbability;
    if (verdict === 'unmeasured' && rawProbability !== undefined) {
        reasons.push(`probability withheld: the tally (${rawProbability.toFixed(3)}) exists but the verdict is unmeasured — a number on an abstention would be read as a low-confidence answer, not as "cannot judge"`);
    }
    return {
        subjectId: subject.id,
        verdict,
        probability,
        reasons,
        readings,
    };
}
