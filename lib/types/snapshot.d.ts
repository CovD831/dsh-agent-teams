/**
 * Team activity snapshot assembly for the activity panel.
 *
 * Server-side assembly mirrors the Claude Code desktop teamWatcher: read the
 * durable team files (the truth source) and enrich with live subagent
 * activity, so the panel always reflects the on-disk state even when a model
 * skipped a tool "ritual" (e.g. not calling update_task on completion).
 * @module dsh-agent-teams/snapshot
 */
import type { Context } from '@deepseek-ai/cordis';
import { type MemberLiveness, type StrandedWorktrees, type MemberSubagents, type LiveSubagent } from './members.ts';
import { type GateEvaluationRecord, type MemberStatus, type TeamState } from './types.ts';
import type { FailureKind, VisualTaskState } from './state.ts';
import type { CollectionHealth } from './evolution/types.ts';
import type { SignalsHealthRead } from './evolution/read.ts';
/**
 * ── ★★★ t4 / N2：分流层的**生产出口**（`propose.ts` + `history.ts` 的第一个生产消费者）──
 *
 * 背景（`docs/EVOLUTION-WIRING-GAP.md` §1）：`propose.ts` 零消费者、`history.ts` 零消费者
 * ⇒ "把一条信号转成一个提案"这一步**在代码里存在、而没有任何路径走过它**。
 * 本节把它接在与 `collectionHealth` **同一条路**上（`/state` → `collectTeamsActivity`
 * → `assembleTeamSnapshot`）—— 于是"产出了提案"这件事第一次**在盘上读得到**。
 */
import { type ProposalPipelineReadout } from './evolution/index.ts';
/**
 * Visual task state for the activity panel.
 *
 * ── ★★ M4 收敛（t65）：本类型**不再在这里声明** ────────────────────────────────
 *
 * 实测（t48 发现 A，我逐字复核过）：本行与 `src/state.ts` 的那一行**逐字相同**
 *   ⇒ 那是**重复声明**，不是巧合，也不是有意分叉。
 *
 * ★ 危害不是"多一行"，而是**两处可以各自漂移**：
 *   改一处、忘了另一处 ⇒ 两边的取值集合分叉，而 `state.ts` 的 `taskVisualState()`
 *   产出的值喂给 `TeamActivityMember.state`（本文件）—— 那时就是**类型说 A、
 *   运行期给 B**，而两者**都编译得过**（因为它们是两个独立的类型）。
 *
 * ⇒ 收敛为**单一来源**：声明留在 `src/state.ts`（那里有 `taskVisualState()`
 *   这个**生产者**，所以"类型与它的生产者同住"是正确的一侧），本文件**再导出**它。
 *   ★ 再导出而非直接 import：本文件的 `export type VisualTaskState` 是**对外面**，
 *     既有消费者从 `snapshot.ts` 取它 ⇒ 去掉会打断它们（导出面必须逐条不变）。
 */
export type { VisualTaskState } from './state.ts';
/** One member row of the activity snapshot. */
export interface TeamActivityMember {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort: string;
    readonly executionPrompt: string;
    readonly status: MemberStatus;
    readonly activity: 'working' | 'idle' | 'unknown';
    /**
     * ── ★★★ t4：会话存活读数（与 `activity` **并列**，不是它的替代）──────────────
     *
     * `activity` 回答的是「这个驱动此刻忙不忙」；这一格回答的是「**还有没有**那个
     * 驱动」。MEASURED（DISPATCH-RULES §39）：后者缺席时，`activity` 会读成
     * `idle`（驱动不见 ⇒ `ready` ⇒ 面板画成"闲着"）—— 而"闲着"与"那个会话已经
     * 没了、它的产物冻在 worktree 里"在面板上**同形**。
     *
     * ★ 两格不合并的理由与顶层 `status` 那处逐字相同：它们要人做的动作不同
     *   （"忙不忙" ⇒ 等；"还活着吗" ⇒ 去抢救）。
     */
    readonly liveness: MemberLiveness['state'];
    readonly livenessReadout: MemberLiveness['readout'];
    /** ★ 未能测量时的成因（`could-not-measure` 时在场）。 */
    readonly livenessReason?: string;
    /** ★ 名下有在飞任务而会话已不在 ⇒ 有一份工作悬在半空。 */
    readonly stranded: boolean;
    /**
     * ── ★★★ t27：这个成员底下**正在跑的**子代理（面板的展开层）───────────────────
     *
     * 用户的要求是明确的：第一屏显示持久成员，**点开一个成员**要能看到它底下
     * 正在跑的子代理，连同轮次信息。而 MEASURED（开工时）：`src/snapshot.ts` 里
     * `subagent` 只出现在**注释**里 —— 一处代码都没有 ⇒ 那次重建会有一个
     * **空的展开层**（本仓已经撞过两次的「做出来了但没接上」形状）。
     *
     * ★ 三态：`observed`（`subagents: []` = 真的没有）/ `could-not-measure`。
     *   把后者圆成前者会让面板**永远**说"没有子代理" —— 而那与"确实没有"同形。
     */
    readonly subagents: MemberSubagents['status'];
    /** `observed` 时在场：这个成员名下的活子代理（**空数组** = 真的没有）。 */
    readonly liveSubagents: MemberSubagents['subagents'];
    /** `could-not-measure` 时在场：未能测量的成因。 */
    readonly subagentsReason?: string;
    /**
     * ── ★★ 轮次信息（用户要求的那一半）────────────────────────────────────────────
     *
     * ★ 它**不**从子代理推：轮次挂在**任务**上（`TeamTask.round`），而子代理挂的是
     *   会话 —— 两者没有共同的外键。⇒ 这里报的是这个成员**名下有轮次的任务**里
     *   最大的那一轮（"它现在做到第几轮了"），而每一轮的细节仍由 `tasks[]` 承载。
     *
     * ★ 一个没有轮次的任务（`round === undefined`）**不进**这个最大值：
     *   把缺省当 `0` 会让"没有轮次概念"与"第 0 轮"同形。
     */
    readonly round?: number;
    readonly progress: number;
    readonly done: number;
    readonly total: number;
    readonly currentTask: string;
    readonly unread: number;
}
/** One task row of the activity snapshot. */
export interface TeamActivityTask {
    readonly id: string;
    readonly subject: string;
    readonly description: string;
    readonly status: string;
    readonly state: VisualTaskState;
    readonly assignee: string;
    readonly model: string;
    readonly dependencies: readonly string[];
    readonly depth: number;
    readonly kind?: string;
    readonly round?: number;
    readonly verdict?: string;
    /**
     * Why a `failed` task stopped, as classified by `failureKindOf` in src/state.ts.
     * ★ Present ONLY when `status === 'failed'`: its absence then means "not
     *   applicable", which must stay distinguishable from any of the three kinds —
     *   otherwise an unmeasured stop would read as one specific kind of failure.
     */
    readonly failureKind?: FailureKind;
    /** Durable last-write stamp; drives the finished-member ordering (issue #192). */
    readonly updatedAt: number;
    /**
     * ── ★★★ t78：判据求值结果（**端到端可见**的最后一跳）───────────────────────────
     *
     * 本仓有**两个互不相连**的 `/state`：client 轮询的是 `collectTeamsActivity`（本文件），
     * 而 `status` 工具的返回值**根本不流向浏览器**（实测 `lib/client.js` 里
     * `failure_kind` / `attempt_id` / `findings_open` 全是 **0 处**）。
     * ⇒ 判据结果若只做在 `status.ts`，就落在 **UI 不读的通道**上。本字段把它接到 UI 真读的那条路。
     *
     * ★ **缺席语义**：`undefined` ⇒ 投影里**整个 key 不出现**（用展开式，不用赋值式）。
     *   而这是**有意的**：客户端的 `memberGateReadouts` 靠"key 在不在"把**从未求值过**
     *   读成 `absent`，与"求值了但没有数据"**不同形**（本仓三态纪律）。
     *   ⇒ 拿到 `undefined` 时**不许**填一个假的 `{ ok: true, ran: [] }`：那会把
     *     "没测过"画成"测过且干净"，正是本仓记账最久的那条形态。
     */
    readonly gateEvaluation?: GateEvaluationRecord;
}
/**
 * ── ★★★ t100：一封信箱消息的**完整投影**（九格）────────────────────────────────────
 *
 * MEASURED（t100 开工实测）：本接口此前**只有两格**（`from` / `content`），
 * 而信箱的 jsonl 里有**十个**字段：
 * ```
 * ['content','deliveredAt','deliveredAt','from','id','readAt',
 *  'sourceAttemptId','sourceTaskId','sourceTaskStatus','to','ts']
 * ```
 * ⇒ ★★ 那时**丢掉八个**（`id` · `to` · `ts` · `readAt` · `sourceAttemptId` ·
 *   `sourceTaskId` · `sourceTaskStatus` · `deliveredAt`）。
 *
 * ── ★★★ 而"丢掉的字段"里有两个是**做不了别的事**的原因 ──────────────────────────
 *
 *   · **`taskId`**（← `sourceTaskId`）—— ★ **一条对话线程的分组键**。
 *     实测：同一 `sourceTaskId` 有多条的**有 9 个任务** ⇒
 *     ★ "一条线程" = **一组共享 `sourceTaskId` 的消息**，
 *     而"成员来的=提问 / captain 来的=裁决"**天然成对**。
 *     没有这一格，UI **只能**把消息摊成一条时间线，**分不出**哪些是同一件事的往返。
 *   · **`ts`** —— 排序与显示都要它。★ 没有它，"谁先谁后"只能靠**数组序**猜，
 *     而数组序是**投影顺序**，不是**时间顺序**（两者在截断后会分叉）。
 *
 * ★ 与 `TeamMessage` 的关系：**投影**，不是替代。
 *   ★★ 几格是**缺席可能**的（`taskId?` / `attemptId?` / `taskStatus?`）——
 *     它们**真的可能没有**（一封非"按任务"的消息），而**缺席 ≠ 空串**：
 *     前者是"这封信不属于任何任务"，后者是"它属于一个名字为空的任务"。
 */
/**
 * ── ★★ t100：快照里最多投影几封 captain 信箱的消息 ────────────────────────────────
 *
 * ★ 上限必须有：`/state` 是**每次轮询**都要传的载荷，而信箱实测 108 条、正文可能很长。
 * ★★ 而超过它时**必须报出截了多少条**（见 `TeamActivitySnapshot.captainInboxOmitted`）——
 *   静默截断会让"被截掉"与"没发过"同形。
 *
 * ★ 为什么取 5：与改造前的 `slice(-5)` **同一个数** ——
 *   本轮改的是"**投影几格**"与"**读哪些**"，**不是**"投影多少条"。
 *   把条数一起改大，会让"字段变多"与"载荷变大"这两个读数混在一起、无法归因。
 */
export declare const MAILBOX_PROJECTION_LIMIT = 5;
export interface TeamActivityMessage {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly content: string;
    /** ★ 时刻（排序与显示）。★ 不是数组下标 —— 那个在截断后会与它分叉。 */
    readonly ts: number;
    /** ★★ `sourceTaskId` —— **一条对话线程的分组键**（见上面的长注释）。 */
    readonly taskId?: string;
    readonly attemptId?: string;
    readonly taskStatus?: string;
    /** ★ `readAt` 在场 ⇒ 已读。★★ 已读的消息**仍然**在投影里（见下面的读法注释）。 */
    readonly read: boolean;
}
/**
 * One registered criterion, as the **UI** needs it (window v4 / t78-shaped hop).
 *
 * ★ 这是"**可插拔**"的落点（用户原话：这些测试信息需要是可插拔的）：
 *   UI 不硬编码任何判据名 —— 它读 `id` + `description`，于是**换掉一条判据**
 *   （改 `src/gates/**` 里的模块）⇒ 两者都变 ⇒ **UI 自动跟着变，不用改代码**。
 */
export interface TeamActivityGate {
    readonly id: string;
    readonly description: string;
    /** 观察模式（开火了但放过）。★ 必须在清单里看得见，否则"被把关了"是假的。 */
    readonly observing: boolean;
}
/**
 * ── ★★★ registry.list() 的**转发**（v4 甲，与 t78 同构）──────────────────────────
 *
 * ── 它修的是什么（MEASURED）────────────────────────────────────────────────────
 *
 * `registry.list()` 原本只在 `src/tools/status.ts` 里被读 —— 而那是
 * **UI 不读的通道**（t78 已实测：client 轮询的是 `collectTeamsActivity`，
 * status 工具的返回值根本不流向浏览器）。
 * ⇒ 判据**清单**若只做在 status.ts 上，UI 就永远拿不到"这个阶段挂着哪些判据"。
 *
 * ── ★ 为什么带 `registered` 而不只是数组 ──────────────────────────────────────
 *
 * 空位置（`registered: 0`）与"挂了判据但一条都没跑"是**两件事**，
 * 而只给一个数组会让两者同形（都是 `[]`）—— 本仓记账最久的那条形态。
 */
export interface TeamActivityGateCatalog {
    readonly point: string;
    /** 该位置**注册了几条**（与上下文无关）。`0` = 空位置（正常情形）。 */
    readonly registered: number;
    /** 逐条清单，按注册顺序。 */
    readonly gates: readonly TeamActivityGate[];
}
/** The full panel payload for one team. */
export interface TeamActivitySnapshot {
    readonly workspace: string;
    readonly teamId: string;
    readonly name: string;
    readonly description?: string;
    readonly captainSessionId: string;
    readonly phase: 'staged' | 'running';
    readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback';
    readonly halted?: boolean;
    readonly members: readonly TeamActivityMember[];
    readonly tasks: readonly TeamActivityTask[];
    /**
     * ── ★★★ t4：残留 `working` 的**后果面**（DISPATCH-RULES §39.2）───────────────
     *
     * t39 的树 12 个文件未提交（含 300 行改动），而"按 working 当它在跑而等着"
     * ⇒ 那些改动永远冻在那儿。这一格就是那句后果的出口。
     * ★ `clear` 与 `could-not-measure` **必须不同形**（见 `StrandedWorktrees`）。
     */
    readonly strandedWork: StrandedWorktrees;
    /**
     * ── ★★★ t27：父会话定不下来的活子代理 ──────────────────────────────────────────
     *
     * 一个活着的会话，其 `parentSession` **不是本队成员** —— 可能是一次性委派、
     * 本队之外的子代理、或父会话已不在的孤儿。★ 三件事**都不许**发生：
     * 丢掉它（读的人以为没有）、硬塞给某个成员（把**别人的**子代理画在这个成员底下，
     * 而"归属错了"与"归属对了"在界面上同形）、或并进 `could-not-measure`
     * （把一个**可判定的事实**报成一次读取失败）。
     * ⇒ 它自成一格，如实交出去。
     */
    readonly unattributedSubagents: readonly LiveSubagent[];
    readonly messageCount: number;
    readonly captainInbox: readonly TeamActivityMessage[];
    /**
     * ── ★★★ t101：采集健康读数（health.ts 的第一个生产消费者）────────────────────────
     *
     * ★ 它是 `collectionHealthOf`（`src/evolution/health.ts`）第一次被生产路径调用 ——
     *   在此之前该函数**零消费者**（`EVOLUTION-WIRING-GAP.md` §1 逐字）。
     *
     * ★★ 三态（`SignalsHealthRead` + `CollectionHealth` 各自承载一半）：
     *   · `collectionHealth: undefined`        —— 文件缺席（`file-absent`）＝ 采集流水线**还没开过**。
     *     ★ **不是**空读数：空读数会让"没开过"与"开了没采到"同形。
     *   · `collectionHealth` 在场 + `readout.records: []`
     *                                          —— 文件在、零条记录（**与缺席不同形**）。
     *   · `collectionHealth` 在场 + 有 records —— 正常读数（redundancy/coverage/buckets）。
     *
     * ★ `refused`（被 collection 判据拒掉的条数）从**每条信号自带的** `collection.verdicts`
     *   里数（`ok` 之外的裁决），**不重跑判据**（与 t87 那条"转发裁决，不重算"同纪律）。
     */
    readonly collectionHealth?: {
        /** `collectionHealthOf` 的产出（buckets/redundancy/coverage/refused）。 */
        readonly health: CollectionHealth;
        /** 读文件层的读数（三态 + 坏行计数 —— `skippedMalformed` 在场 = 有行被跳过）。 */
        readonly readout: SignalsHealthRead;
    };
    /**
     * ★★ t101：读数**算不了**时的原因（只在真的算不了时在场 —— 缺席 = 算出来了）。
     * ★ 与 `collectionHealth: undefined`（文件缺席，正常态）**不同形**：这一格是**异常**
     *   （读文件抛了非 ENOENT 的错等）。
     */
    readonly collectionHealthUnmeasurable?: string;
    /**
     * ── ★★★ t4 / N2：分流读数（`readProposalPipeline` 的产出）──────────────────────────
     *
     * ★ 四格各自回答一个**不同**的问题，不许互相顶替：
     * ```
     *   · 缺席                    ⇒ signals.jsonl 没开过（流水线没走过）
     *   · routing.produced        ⇒ 产出了几份提案（可执行：`createTaskParamsOf` → create_task）
     *   · routing.none            ⇒ 看过了、真的不必改
     *   · routing.unmeasured      ⇒ ★ 判不了（带 `unmeasuredReasons` 说清卡在哪）
     * ```
     * ★★ **三态不同形**是本格存在的全部理由：若把 `unmeasured` 并进 `none`，
     *   "分流层坏了"就会表现为"库里安静地没有提案" —— 而那与"确实没有提案"同形。
     */
    readonly proposalPipeline?: ProposalPipelineReadout;
    /**
     * ★★ t4：分流读数**算不了**时的原因（只在真的算不了时在场 —— 缺席 = 算出来了）。
     * ★ 与 `proposalPipeline: undefined`（signals 文件缺席，正常态）**不同形**。
     */
    readonly proposalPipelineUnmeasurable?: string;
    /**
     * ★★ t100：因为超过 {@link MAILBOX_PROJECTION_LIMIT} 而**没有**进 `captainInbox` 的条数。
     *
     * ★★ 只在**真的截了**时在场（缺席 = 没截）。
     *   ★ 它存在的唯一理由：**静默截断会让"被截掉"与"没发过"同形**。
     */
    readonly captainInboxOmitted?: number;
    /** ★ 截断前的总条数（与 `captainInboxOmitted` 一起读才完整）。 */
    readonly captainInboxTotal?: number;
    /**
     * ── ★★★ t100（反向半边 C）：**读不到**信箱时的原因 ─────────────────────────────
     *
     * ★★ 三态**互不同形**：
     * ```
     * captainInbox: []  且  这一格【缺席】   ⇒ ★ 读到了，确实没有信
     * captainInbox: []  且  这一格【在场】   ⇒ ★ 没读到（"没能测量"，不是"没有"）
     * captainInbox: [...]（非空）            ⇒ 读到了，有信
     * ```
     * ★ 为什么必须有它：没有它，一次读失败会让**整支队伍从快照列表里消失**
     *   （`collectTeamsActivity` 的 `catch` 吞掉），于是
     *   「**这支队读不到**」与「**这支队不存在**」在面板上同形。
     */
    readonly captainInboxUnreadable?: string;
    /**
     * ── ★★★ v4：判据**清单**（registry.list() 的转发，与 t78 同构）──────────────────
     *
     * 六个位置**都在**（含空位置），因为"这个位置没有判据"与"这个位置没被读"
     * 必须不同形。★ 它是**每份快照都带**的静态目录（判据注册表在模块加载时就建好），
     * 所以不依赖任何任务的状态 —— 于是"可插拔"才成立。
     */
    readonly gateCatalog: readonly TeamActivityGateCatalog[];
}
/** Snapshot projection switches for live and archived teams. */
export interface TeamSnapshotOptions {
    /** Historic review must retain members that were marked removed at shutdown. */
    readonly includeRemoved?: boolean;
    /** Archived teams have no meaningful live activity after their sessions stop. */
    readonly historic?: boolean;
}
/**
 * ── ★★★ v4：把判据清单投影成 UI 读得懂的形状（registry.list() 的转发）────────────
 *
 * ★ **为什么必须在这一侧做**：`registry.list()` 的条目里带 `appliesTo`
 *   （**函数**，不能过 JSON）与 `requires`（输入面声明）—— 那些是**求值侧**的东西。
 *   UI 要的是"这个阶段挂着哪些判据、它们各自是什么"，即 `id` + `description`。
 *   ⇒ 在**服务端**就投影掉，于是线上穿的全是可序列化的、且**没有多余的内部形状**。
 *
 * ★ 六个位置**逐个出现**（含 `gates: []` 的空位置）：空位置与缺席必须不同形。
 * @returns one catalog row per insertion point, in the registry's own order.
 */
export declare function gateCatalogForUi(): TeamActivityGateCatalog[];
/** Compact `provider/model` route for the activity panel, or just the model. */
export declare function memberModelRoute(member: {
    provider?: string;
    model?: string;
} | undefined): string;
/**
 * Assemble one team snapshot from its durable files plus live activity.
 * @param ctx - the plugin context (injects `subagents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @returns the panel snapshot.
 */
export declare function assembleTeamSnapshot(ctx: Context, stateRoot: string, workspace: string, state: TeamState, options?: TeamSnapshotOptions): Promise<TeamActivitySnapshot>;
/**
 * Collect every team under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @returns the snapshots in stable order (workspace, then team id).
 */
export declare function collectTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
}[]): Promise<TeamActivitySnapshot[]>;
/**
 * Collect every archived team under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Used by the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @returns the archived snapshots in stable order.
 */
export declare function collectArchivedTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
}[]): Promise<TeamActivitySnapshot[]>;
