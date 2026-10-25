/**
 * ── ★★★ t4 / N2：`src/evolution/` 的**接口面**，以及**分流的生产出口** ────────────────
 *
 * 本文件做两件事，而它们**必须同时做**（只做第一件就是又一个"没人读的产出"）：
 *
 * ```
 *   ① 接口面：把 5 个深路径（`./types.ts` `./health.ts` `./read.ts` `./propose.ts`
 *              `./history.ts`）收口成**一个** import 源
 *              —— `docs/REQUIREMENTS.md` §1 规则 A：「别人 → evolution 只许 import 一个接口面」
 *   ② 生产出口：`readProposalPipeline()` —— 把「信号 → 分流 → 提案 + 判据历史」
 *              接成**一次**可被 `/state` 调用的读数
 * ```
 *
 * ── ★★ 为什么 ① 单独做没有意义 ──────────────────────────────────────────────────
 *
 * MEASURED（t4 开工，`docs/EVOLUTION-WIRING-GAP.md` §1）：`propose.ts` 零消费者、
 * `history.ts` 零消费者。★ 而"再交付一个读不到调用方的文件"正是这一整轮要消灭的病
 * （`deliverableCommit` 有写者无读者、`history.ts`/`propose.ts` 零消费者都是它）。
 * ⇒ 所以本文件**存在的前提**是 ②：`src/snapshot.ts` 真的会 `await` 它一次。
 *
 * ── ★★★ 三态纪律（本文件最重要的那一格）─────────────────────────────────────────
 *
 * ```
 *   unmeasured  ⇒ 读不到：`signals.jsonl` 缺席 / 读文件抛错
 *                 ⇒ ★ 不许降级成 `total: 0` —— "流水线没开过"与"开了没采到到信号"不同形
 *   measured    ⇒ 读到了：哪怕零条信号也是 measured（`records: []` 是一个**读数**）
 * ```
 * ★ 而**分流本身**的三态（产出了 / 判不了 / 真的没有）在 `RoutingReadout` 里
 *   各占一格（`produced` / `unmeasured` / `none`），**合流是被禁止的** ——
 *   理由写在 `propose.ts` 的 `SignalRoute` 注释里（补救动作相反）。
 *
 * ── ★ 本文件**不做**的两件事 ───────────────────────────────────────────────────
 *
 *   · **不写盘**：它是 `/state` 轮询路径上的一次读数。★ 一次 GET 不该改磁盘状态 ——
 *     把一个写动作藏在轮询里，会让"刷新了一次界面"与"产生了提案"在磁盘上同形。
 *   · **不派发**：`awaitingRuling` 是正常结局（`docs/SELF-ITERATION-PLAN.md` §N2 逐字）。
 */
import { join } from 'node:path';
import { signalsPathOf } from "./collect.js";
import { readCollectionHistory, reviewBeforeChange } from "./history.js";
import { routeSignals } from "./propose.js";
export { LOOP_B_SUBJECTS, canLoopAAutoChange } from "./types.js";
export { bucketsOf, collectionHealthOf } from "./health.js";
export { deriveCollectionIndex, readSignalsHealth } from "./read.js";
export { CREATE_TASK_PARAM_KEYS, createTaskParamsOf, nextProposalId, routeSignal, routeSignals, unmeasuredDecision, unknownCreateTaskKeys, } from "./propose.js";
export { CollectionHistory, historyPathOf, readCollectionHistory, recordCollectionChange, reviewBeforeChange } from "./history.js";
/**
 * ── ★★★ 一条信号的**投影**：从台账的原始 JSON 行 → {@link RoutableSignal} ───────────
 *
 * ★★ 为什么不复用 `read.ts` 的 `healthRecordOf`：那个投影**故意**只留
 * `(component, kind, at)` 三格（health 只要这三格就够算 redundancy/coverage）。
 * 而分流要的是**另外四格**（`id` / `message` / `gateId` / `tool`）。
 *
 * ★★ 而"同一份文件两个投影"这个形态是有风险的（两处口径会漂移）——
 *   所以这里把**口径对齐**写成可核的：`component ← source.where`、`kind ← [kind]`，
 *   与 `healthRecordOf` **逐字相同**的两条规则，而复核命令在 t4 报告里
 *   （同一份台账跑两个投影，逐行比对 `(component, kind)` 相等）。
 *   ★ 为什么不直接把两个投影合成一个：`read.ts` 不在 t4 的写域里（契约明文），
 *     而为了合并去动它会把一个"接线"任务变成一个"重写读数层"任务。
 *
 * ★ 两代形状（t88 手工补录 / t87 `observe` 采集）**都收**：
 *   t88 行的原文在 `title`（`message` 缺席），`source` 是字符串数组（没有 `where`）
 *   ⇒ 那种行**缺 `where`** ⇒ 分流会如实地判 `unmeasured`（缺输入），**不编**。
 */
function routableSignalOf(line) {
    let parsed;
    try {
        const raw = JSON.parse(line);
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
            return undefined;
        parsed = raw;
    }
    catch {
        return undefined;
    }
    const id = typeof parsed.id === 'string' ? parsed.id : undefined;
    if (id === undefined)
        return undefined;
    const source = parsed.source;
    const where = typeof source?.where === 'string' ? source.where : undefined;
    const gateId = typeof source?.gateId === 'string' ? source.gateId : undefined;
    const tool = typeof source?.tool === 'string' ? source.tool : undefined;
    /**
     * ★ 原文：`observe` 写在 `message`；t88 补录写在 `title`。
     *   ★ 两格都缺 ⇒ **不给** `message`（而不是给 `''`）—— `''` 会让
     *     "说不出原文"看起来像"原文是空的"，而分流会因为 `''` 判 unmeasured 的**理由**不同。
     */
    const message = typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.title === 'string' ? parsed.title : '';
    const kind = typeof parsed.kind === 'string' ? parsed.kind : undefined;
    const at = typeof parsed.at === 'number' ? parsed.at : undefined;
    return {
        id,
        message,
        ...where === undefined ? {} : { where },
        ...gateId === undefined ? {} : { gateId },
        ...tool === undefined ? {} : { tool },
        ...kind === undefined ? {} : { kind },
        ...at === undefined ? {} : { at },
    };
}
/** ★ 提案 id 的编号（`p-0007` → 7）—— 只为算 `knownMax`，不猜别的。 */
function proposalNumberIn(id) {
    const match = /^p-(\d+)$/.exec(id);
    return match === null ? 0 : Number.parseInt(match[1], 10);
}
export async function readProposalPipeline(stateRoot, readFile) {
    /**
     * ★★ 读 `signals.jsonl` —— **唯一的**"读不到"入口。
     *   ★ 这里**不**返回空读数：空读数会让"流水线没开过"读成"开了没采到"。
     */
    let signalsText;
    try {
        signalsText = await readFile(signalsPathOf(stateRoot), 'utf8');
    }
    catch {
        return { status: 'unmeasured', reason: 'signals-file-absent' };
    }
    const lines = signalsText.split('\n');
    const signals = [];
    let skippedMalformed = 0;
    for (const line of lines) {
        if (line.trim() === '')
            continue;
        const signal = routableSignalOf(line);
        if (signal === undefined) {
            skippedMalformed += 1;
            continue;
        }
        signals.push(signal);
    }
    /** ★ 盘上已有的提案（缺席 ⇒ 空 + 那个显式标记；**不是** 0 条）。 */
    let storedProposals = [];
    let storedProposalsAbsent;
    try {
        const proposalsText = await readFile(join(stateRoot, 'evolution', 'proposals.jsonl'), 'utf8');
        storedProposals = proposalsText
            .split('\n')
            .filter((line) => line.trim() !== '')
            .flatMap((line) => {
            try {
                const parsed = JSON.parse(line);
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
                    return [];
                const proposal = parsed;
                return typeof proposal.id === 'string' ? [proposal] : [];
            }
            catch {
                return [];
            }
        });
    }
    catch {
        storedProposalsAbsent = true;
    }
    const knownMax = storedProposals.reduce((max, proposal) => Math.max(max, proposalNumberIn(proposal.id)), 0);
    /**
     * ★★ `bucketCounts`：`effect` 的**分母**。
     *   口径与 `propose.ts` 的 `effectOf` / `read.ts` 的 `healthRecordOf` **逐字相同**
     *   （`component ← source.where`、`kind ← [kind]`，缺席时落 `(unattributed)` / `(unclassified)`）。
     */
    const bucketCounts = new Map();
    for (const signal of signals) {
        const key = `${signal.where ?? '(unattributed)'}|${signal.kind ?? '(unclassified)'}`;
        bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
    }
    const routing = routeSignals(signals, knownMax, { batchSize: signals.length, bucketCounts });
    const historyReadout = await readCollectionHistory(stateRoot, readFile);
    const history = historyReadout.status === 'unmeasured'
        ? { status: historyReadout.status, ...(historyReadout.reason === undefined ? {} : { reason: historyReadout.reason }), rows: 0 }
        : {
            status: historyReadout.status,
            rows: historyReadout.history.all().length,
            ...historyReadout.skippedMalformed === undefined ? {} : { skippedMalformed: historyReadout.skippedMalformed },
        };
    /**
     * ── ★★★ 分流之前的那一问（见 `reviews` 的注释）─────────────────────────────────
     *
     * ★ 只对**真的有靶**（`target` 是 `{kind:'gate'}`）的提案发问：
     *   描述性字符串靶说不出是哪条判据，问「它改过几次」会得到一个假答案。
     *   ⇒ ★ 那些提案**不进** `reviews`（缺席 = 这一问对它不成立，不是"改过 0 次"）。
     */
    const gateIds = [...new Set(routing.proposals.flatMap((proposal) => {
            const target = proposal.routing.target;
            return target !== null && typeof target === 'object' && target.kind === 'gate' ? [target.ref] : [];
        }))].sort();
    const reviews = gateIds.length === 0
        ? undefined
        : gateIds.map((gateId) => {
            /**
             * ★ 学科 = `collection-gates`（collection 判据的改动是 **loop B**，要人拍板）——
             *   这不是我挑的：`types.ts` 的 `LOOP_B_SUBJECTS` 逐字含它，
             *   而这里**走 `reviewBeforeChange`**（它内部调 `canLoopAAutoChange`），不自己判。
             */
            const review = reviewBeforeChange(historyReadout.history, 'collection-gates', gateId);
            return {
                gateId,
                loop: review.loop,
                mayAutoChange: review.mayAutoChange,
                historyStatus: historyReadout.status,
                ...historyReadout.status === 'unmeasured'
                    ? {}
                    : { previousChanges: review.history.length },
                note: review.note,
            };
        });
    return {
        status: 'measured',
        routing,
        proposals: routing.proposals,
        storedProposals,
        ...storedProposalsAbsent === undefined ? {} : { storedProposalsAbsent },
        history,
        ...reviews === undefined ? {} : { reviews },
        ...skippedMalformed > 0 ? { skippedMalformed } : {},
        totalLines: lines.length,
    };
}
