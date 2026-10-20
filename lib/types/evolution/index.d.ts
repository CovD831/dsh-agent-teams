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
import { type HistoryReadout } from './history.ts';
import { type RoutingReadout } from './propose.ts';
import type { Proposal } from './types.ts';
/**
 * ── ★★ 接口面（① 的那一半）─────────────────────────────────────────────────────
 *
 * ★ 用**具名**再导出而不是 `export *`：`export *` 会把内部辅助函数也变成对外承诺，
 *   而"接口面"的价值正在于**它是被人挑过的**（本仓 `src/gates/index.ts` 同一形状）。
 */
export type { CollectionBucket, CollectionGateChange, CollectionHealth, EvolutionLoop, LoopBSubject, Proposal, RoutingDecision, RoutingEffectRef, RoutingTargetRef, } from './types.ts';
export { LOOP_B_SUBJECTS, canLoopAAutoChange } from './types.ts';
export { bucketsOf, collectionHealthOf } from './health.ts';
export type { HealthRecord } from './health.ts';
export { deriveCollectionIndex, readSignalsHealth } from './read.ts';
export type { DerivedCollectionIndex, SignalsHealthRead } from './read.ts';
export { CREATE_TASK_PARAM_KEYS, createTaskParamsOf, nextProposalId, routeSignal, routeSignals, unmeasuredDecision, unknownCreateTaskKeys, } from './propose.ts';
export type { CreateTaskParams, RoutableSignal, RoutingContext, RoutingReadout, SignalRoute, } from './propose.ts';
export { CollectionHistory, historyPathOf, readCollectionHistory, recordCollectionChange, reviewBeforeChange } from './history.ts';
export type { HistoryReadout, HistoryWriteOutcome } from './history.ts';
/**
 * ── ★★★ 整条流水线的一次读数 —— `/state` 上那一格（② 的那一半）────────────────────
 *
 * 三态（与文件头那段同一条纪律）：
 * ```
 *   ⟂ signals.jsonl 缺席/读不了  ⇒ `status: 'unmeasured'` + `reason: 'signals-file-absent'`
 *   ● signals.jsonl 在、零行     ⇒ `status: 'measured'` + `routing.total: 0`（是读数，不是缺席）
 *   ● signals.jsonl 在、n 行     ⇒ `status: 'measured'` + 分流的四格计数 + 提案
 * ```
 *
 * ★ `proposals` 那一格**永远是"当前该有的那批"**（由 `signals → routeSignal` 现算），
 *   而不是"盘上已经存下的那批"：盘上那批还没人写过（本文件不写盘，见文件头）。
 *   ★ 而两批**都**在读数里（`proposals` 与 `storedProposals`），因为
 *   "算出来的"与"存下来的"若只印一个，另一个不见了就看不出来。
 *
 * @param stateRoot - 这个团队自己的状态根（★ 不许是进程级单值）。
 * @param readFile  - 注入的读文件函数（生产给 `fs/promises.readFile`；夹具注入内存版）。
 */
export interface ProposalPipelineReadout {
    readonly status: 'measured' | 'unmeasured';
    readonly reason?: 'signals-file-absent';
    /** ★ 分流读数（三态各一格 —— 不许合流）。 */
    readonly routing?: RoutingReadout;
    /** ★ 由这批信号**现算**出来的提案（可执行：`createTaskParamsOf` 直接喂 `create_task`）。 */
    readonly proposals?: readonly Proposal[];
    /** ★ 盘上已经存下的提案（`proposals.jsonl`）—— 缺席 ⇒ 空数组 + `storedProposalsAbsent`。 */
    readonly storedProposals?: readonly Proposal[];
    /** ★ 盘上没有 `proposals.jsonl`（★ 与"盘上有、但 0 条"不同形）。 */
    readonly storedProposalsAbsent?: true;
    /** ★ 判据变更历史的读数（**读**那一半；写那一半见 `history.ts` 的三态说明）。 */
    readonly history?: {
        readonly status: HistoryReadout['status'];
        readonly reason?: 'file-absent';
        readonly rows: number;
        readonly skippedMalformed?: number;
    };
    /**
     * ── ★★★ 分流**之前**的那一问：「这条判据以前改过几次」────────────────────────
     *
     * ★ 为什么它必须在生产路径上（而不是只在夹具里）：`docs/COLLECTION-EVALUATOR-SELF-EVOLUTION.md`
     *   §4.3 说历史的存在理由是让**「反复来回改」**看得见 —— 而"看得见"只有在
     *   **决定要不要再改一次的那一刻**读到才有用。改完再去看历史，是事后记账。
     *
     * ★★ 三态（与 `reviewBeforeChange` 一一对应，**不合流**）：
     * ```
     *   · 没有针对 collection 判据的提案   ⇒ 本格缺席（`undefined`）——「这一问没被问到」
     *   · 历史文件缺席                     ⇒ `historyStatus: 'unmeasured'` ——「问到了，答不了」
     *   · 历史读到了（哪怕 0 条）           ⇒ `historyStatus: 'measured'` + `mayAutoChange`
     * ```
     * ★★ 注意 `mayAutoChange` 与 `historyStatus` **不是一回事**：
     *   前者是「这条学科归谁改」（loop A/B 的裁定），后者是「我知不知道历史」。
     *   把它们并成一个布尔，就会让"归我改、而我不知道改过几次"读成"可以放心改"。
     */
    readonly reviews?: readonly {
        /** ★ 被问的那条判据（`gateId`）。 */
        readonly gateId: string;
        /** ★ 由 `canLoopAAutoChange(subject)` 定的归属（`A` 可自动 / `B` 要人）。 */
        readonly loop: 'A' | 'B';
        readonly mayAutoChange: boolean;
        /** ★ 历史**读到没有**（`measured` / `unmeasured`）—— 与 `mayAutoChange` 正交。 */
        readonly historyStatus: 'measured' | 'unmeasured';
        /** ★ 这条判据已经改过几次（`unmeasured` 时**不填** —— 不拿 0 冒充"没改过"）。 */
        readonly previousChanges?: number;
        readonly note: string;
    }[];
    /** ★ 坏行计数（两代形状之间还有半写坏的行 —— 跳过是**计数的**，不是静默的）。 */
    readonly skippedMalformed?: number;
    /** ★ 一共读了几行（分母：没有它，"跳过 2 行"说不出占比）。 */
    readonly totalLines?: number;
}
export declare function readProposalPipeline(stateRoot: string, readFile: (path: string, encoding: 'utf8') => Promise<string>): Promise<ProposalPipelineReadout>;
