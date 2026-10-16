/**
 * ── ★★★ t87：采集层 —— 让 `collection` 四条判据在生产路径上**真的被求值** ──────────
 *
 * 规格：`docs/COLLECTION-LAYER-SPEC.md`（§1 在哪采 · §2 什么形式 · §3 存哪里 · §6 落地顺序）。
 *
 * ── ★ 本文件补的是什么缺口 ────────────────────────────────────────────────────
 *
 * MEASURED（t87 开工勘查）：`grep -rn "evaluate('collection'" src/` ⇒ **0 处**。
 * ⇒ 四条 `collection` 判据**装好了、注册了、能通过 `evaluate` 跑**，
 *   而**生产路径上一次都不会调用它们**。
 * ★★ 而那正是本仓记账最久的形态（`unwired`）—— **轮到我们自己的新代码犯它。**
 *
 * ── ★★ 三条纪律（都来自规格，且都不是我的发明）────────────────────────────────
 *
 * **① 不侵入**（规格 §1 原则）：采集走**宿主既有的失败汇合点**，
 *   而**不许**在 `src/gates/**` 或各业务模块里 `import evolution`。
 *   ⇒ 本模块**只被汇合点调用**，它自己不反向 import 那些模块。
 *
 * **② `mechanisms` 不重算，直接抄判据的 `ran[]`**（规格 §2 硬约束 3）：
 *   在观察点**重算**会与当时的裁决不同 ⇒ "记录说 X，当时实际是 Y" ⇒
 *   ★ **两个口径，一个事实**（本仓记账过）。所以只**转发**已有裁决。
 *
 * **③ 旁路，不参与裁决**（规格 §6 步骤 1 + 本仓既有注释逐字）：
 *   写入**必须**用 `void … .then(warn)` ——
 *   ★ 不许因为"写台账慢"而把一次拒绝**变成一次等待**（那会改变可观测的时序）。
 *
 * ── ★ 与既有 `frictions/` 的关系 ──────────────────────────────────────────────
 *
 * 规格 §3 逐字裁定 **选项 ②：并存，旧的冻结**（那 384 条是历史，口径不同）。
 * ⇒ 本模块写 `.agent-teams/evolution/signals.jsonl`（**追加一行**，复用本仓 mailbox
 *   的先例），**不碰** `frictions/`。
 * ★ 而"旧的冻结"是**可验证**的：它的 count 不再增长。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
/** `.agent-teams/evolution/signals.jsonl` 的路径（由调用方给 `stateRoot`，**不猜**）。 */
export function signalsPathOf(stateRoot) {
    return join(stateRoot, 'evolution', 'signals.jsonl');
}
/**
 * ── ★ 从**既有**台账算下一个 id —— 与 `frictions/` 的 `f-0001` 同一条纪律 ──────────
 *
 * ★ 为什么不用时间戳：同一毫秒内的两条会撞车，而撞车后一条覆盖另一条 ——
 *   **被覆盖的信号与"没发生过"同形**（`recordFriction` 的注释逐字记过这一条）。
 * ★ 而这里读的是 **signals.jsonl**（不是 `frictions/`）：后者已冻结，
 *   它的编号空间与信号流无关（规格 §3 选项 ②）。
 * ★ 读不出来 ⇒ 从 1 开始（不是"猜一个大的"）—— 宁可撞一次也不伪造历史密度。
 */
export async function nextSignalId(stateRoot) {
    let max = 0;
    try {
        const { readFile } = await import('node:fs/promises');
        const text = await readFile(signalsPathOf(stateRoot), 'utf8');
        for (const line of text.split('\n')) {
            const matched = /"id":"e-(\d+)"/.exec(line);
            if (matched !== null)
                max = Math.max(max, Number(matched[1]));
        }
    }
    catch {
        /** 文件还不存在 ⇒ 从 1 开始。 */
    }
    return `e-${String(max + 1).padStart(4, '0')}`;
}
/**
 * ── ★★ 追加一条信号 —— `signals.jsonl`，**一行** ──────────────────────────────────
 *
 * ★ 为什么 jsonl 而不是一条一文件（规格 §3 的表）：
 *   append 是**一行**（不是建新文件）· 全量读**一次**（不是 384 次 open）·
 *   ★ **append 是原子的**（本仓 `inbox/*.jsonl` 已这么做，**不是新发明**）。
 * ★ 部分损坏 ⇒ 坏**一行**，而**每行自带 `id`** ⇒ 可跳过（步骤 4 的反向半边）。
 *
 * @returns 写成功的 id；写不进去 ⇒ `undefined`（**不抛** —— 调用方是拒绝路径，见下）
 */
export async function appendSignal(stateRoot, signal) {
    try {
        const dir = join(stateRoot, 'evolution');
        await mkdir(dir, { recursive: true });
        await appendFile(signalsPathOf(stateRoot), `${JSON.stringify(signal)}\n`, 'utf8');
        return signal.id;
    }
    catch {
        /**
         * ★★ **不抛** —— 本函数在**拒绝路径**上被调用。
         *   把"写不进台账"变成"这次拒绝变成异常"会**改变可观测的时序**，
         *   而那正是规格 §6 步骤 1 与本仓既有注释（`void … .then(warn)`）**逐字要求不许发生**的。
         *   ⇒ 失败由调用方写一条 `warn`（它是旁路，不是裁决）。
         */
        return undefined;
    }
}
/**
 * ── ★★★ `collection` 四条的裁决 → 一个三态结论 ──────────────────────────────────
 *
 * ★ 输入是 `registry.evaluate('collection', …)` 的 `GateEvaluation`。
 * ★★ 判定规则（与全仓三态纪律一致，**不许合流**）：
 *
 *   ① `ran[]` 里有 `unmeasured` ⇒ ★ **判不了**（`undefined`）
 *      —— "测不了"与"不采"**不同形**：前者要补输入，后者是决定。
 *   ② 否则 `ok === false` ⇒ **不采**（`false`）
 *   ③ 否则 ⇒ **采**（`true`）
 *
 * ★ 而这与"**采集**"本身是两件事：本函数只回答"**要不要采**"，
 *   写盘由 {@link appendSignal} 做。⇒ 于是"采集了"与"不采"在记录里可辨。
 */
export function collectionDecisionOf(evaluation) {
    const verdicts = (evaluation?.ran ?? []).map((entry) => ({ gateId: entry.id, verdict: entry.verdict }));
    /**
     * ★ 求值对象**整个缺席** ⇒ 判不了（不是"采"）——
     *   一个缺席的求值与"四条都放行"在读取端必须不同形。
     */
    if (evaluation === undefined)
        return { collected: undefined, verdicts };
    /** ★ ① 有 `unmeasured` ⇒ 判不了（**先判它** —— 它是"我没测出来"，不是"我采"）。 */
    if (evaluation.unmeasured !== undefined || verdicts.some((v) => v.verdict === 'unmeasured')) {
        return { collected: undefined, verdicts };
    }
    /** ★ ②/③ 由 `ok` 定。 */
    return { collected: evaluation.ok, verdicts };
}
/**
 * 采集一条信号 —— ★ **本函数从不抛**（它是旁路）。
 *
 * @returns 写成功 ⇒ 信号 id；被判据拒绝或写失败 ⇒ `undefined`（★ 由 `warn` 区分原因）
 */
export async function observe(input) {
    const { stateRoot } = input;
    /** ★ 没有 stateRoot 就不记 —— 记到别处比不记更坏（`recordFriction` 的注释逐字）。 */
    if (stateRoot === undefined || stateRoot === '')
        return undefined;
    try {
        /**
         * ★★ 先问 `collection` 四条 —— **这是本任务的全部目的**：
         *   在此之前 `evaluate('collection', …)` 在生产路径上**一次都没被调用过**。
         */
        const collection = input.evaluateCollection === undefined
            ? undefined
            : await input.evaluateCollection({
                candidate: {
                    kind: input.kind,
                    ...input.component === undefined ? {} : { component: input.component },
                    message: input.message,
                    ...input.source === undefined ? {} : { source: input.source },
                    at: input.now,
                },
                index: input.index ?? { seen: new Set(), lastBySource: new Map(), counts: new Map() },
            });
        const decision = collectionDecisionOf(collection);
        /**
         * ★★ 判据说"**不采**"（`collected === false`）⇒ **不写这一条**。
         *   ★ 而"**判不了**"（`undefined`）⇒ ★ **仍然写** —— 两者**不同形**：
         *     前者是判据做的决定，后者是"我们没测出来"。
         *     ★ 若把"判不了"也当"不采"，那么"采集层坏了"会表现为"库里安静地没有新信号" ——
         *       而那与"确实没有信号"同形（本仓记账最久的形态）。
         */
        if (decision.collected === false)
            return undefined;
        const id = await nextSignalId(stateRoot);
        const written = await appendSignal(stateRoot, {
            id,
            at: input.now,
            kind: 'rejection',
            source: {
                where: input.where,
                ...input.gateId === undefined ? {} : { gateId: input.gateId },
                ...input.tool === undefined ? {} : { tool: input.tool },
            },
            message: input.message,
            ...input.mechanisms === undefined ? {} : { mechanisms: input.mechanisms },
            collection: decision,
        });
        if (written === undefined)
            input.warn(`agent-teams: could not append an evolution signal at "${input.where}"`);
        return written;
    }
    catch (reason) {
        /**
         * ★★ **绝不抛** —— 调用方在拒绝路径上。把"采集坏了"变成"这次拒绝变成异常"
         *   会**改变可观测的时序**，而拒绝路径的行为是本任务的反向半边 C 要保的东西。
         */
        input.warn(`agent-teams: evolution.observe threw at "${input.where}" (recorded, not thrown at the caller): ${String(reason)}`);
        return undefined;
    }
}
