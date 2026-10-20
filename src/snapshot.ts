/**
 * Team activity snapshot assembly for the activity panel.
 *
 * Server-side assembly mirrors the Claude Code desktop teamWatcher: read the
 * durable team files (the truth source) and enrich with live subagent
 * activity, so the panel always reflects the on-disk state even when a model
 * skipped a tool "ritual" (e.g. not calling update_task on completion).
 * @module dsh-agent-teams/snapshot
 */

import type { Context } from '@deepseek-ai/cordis'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { memberActivity, memberLiveness, strandedWork, strandedWorktrees, liveSessionRefs, parentSessionOf, attributeSubagents, memberSubagents, type MemberLiveness, type StrandedWorktrees, type SubagentAttribution, type MemberSubagents, type LiveSubagent } from './members.ts'
import { gitChangedPaths } from './harness-compat.ts'
import { worktreeDirName } from './worktree.ts'
import {
  CAPTAIN_KEY, failureKindOf, listArchivedTeamIds, readArchivedTeam, readMailbox, readTeam, readUnreadMailbox,
  taskDepthsById, taskVisualState,
} from './state.ts'
import { TERMINAL_TASK_STATUSES, type GateEvaluationRecord, type MemberStatus, type TeamMessage, type TeamState, type TeamTask } from './types.ts'
import type { FailureKind, VisualTaskState } from './state.ts'
import { registry, INSERTION_POINTS } from './gates/index.ts'
/**
 * ── ★★★ t101：采集健康读数（health.ts 的**第一个生产消费者**）────────────────────────
 *
 * 背景（`EVOLUTION-WIRING-GAP.md` §1）：`collectionHealthOf` 能算但从**没有任何生产路径
 * 算过它**（health.ts 零消费者）⇒ "把采集读数画到界面上"在那之前是**不可能的** ——
 * 读数从未存在过。本模块把「读 `signals.jsonl` → `collectionHealthOf` → 快照」接成一条线。
 */
import { collectionHealthOf } from './evolution/health.ts'
import { readSignalsHealth } from './evolution/read.ts'
import type { CollectionHealth } from './evolution/types.ts'
import type { SignalsHealthRead } from './evolution/read.ts'
/**
 * ── ★★★ t4 / N2：分流层的**生产出口**（`propose.ts` + `history.ts` 的第一个生产消费者）──
 *
 * 背景（`docs/EVOLUTION-WIRING-GAP.md` §1）：`propose.ts` 零消费者、`history.ts` 零消费者
 * ⇒ "把一条信号转成一个提案"这一步**在代码里存在、而没有任何路径走过它**。
 * 本节把它接在与 `collectionHealth` **同一条路**上（`/state` → `collectTeamsActivity`
 * → `assembleTeamSnapshot`）—— 于是"产出了提案"这件事第一次**在盘上读得到**。
 */
import { readProposalPipeline, type ProposalPipelineReadout } from './evolution/index.ts'

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
export type { VisualTaskState } from './state.ts'

/** One member row of the activity snapshot. */
export interface TeamActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly executionPrompt: string
  readonly status: MemberStatus
  readonly activity: 'working' | 'idle' | 'unknown'
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
  readonly liveness: MemberLiveness['state']
  readonly livenessReadout: MemberLiveness['readout']
  /** ★ 未能测量时的成因（`could-not-measure` 时在场）。 */
  readonly livenessReason?: string
  /** ★ 名下有在飞任务而会话已不在 ⇒ 有一份工作悬在半空。 */
  readonly stranded: boolean
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
  readonly subagents: MemberSubagents['status']
  /** `observed` 时在场：这个成员名下的活子代理（**空数组** = 真的没有）。 */
  readonly liveSubagents: MemberSubagents['subagents']
  /** `could-not-measure` 时在场：未能测量的成因。 */
  readonly subagentsReason?: string
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
  readonly round?: number
  readonly progress: number
  readonly done: number
  readonly total: number
  readonly currentTask: string
  readonly unread: number
}

/** One task row of the activity snapshot. */
export interface TeamActivityTask {
  readonly id: string
  readonly subject: string
  readonly description: string
  readonly status: string
  readonly state: VisualTaskState
  readonly assignee: string
  readonly model: string
  readonly dependencies: readonly string[]
  readonly depth: number
  readonly kind?: string
  readonly round?: number
  readonly verdict?: string
  /**
   * Why a `failed` task stopped, as classified by `failureKindOf` in src/state.ts.
   * ★ Present ONLY when `status === 'failed'`: its absence then means "not
   *   applicable", which must stay distinguishable from any of the three kinds —
   *   otherwise an unmeasured stop would read as one specific kind of failure.
   */
  readonly failureKind?: FailureKind
  /** Durable last-write stamp; drives the finished-member ordering (issue #192). */
  readonly updatedAt: number
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
  readonly gateEvaluation?: GateEvaluationRecord
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
export const MAILBOX_PROJECTION_LIMIT = 5

export interface TeamActivityMessage {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly content: string
  /** ★ 时刻（排序与显示）。★ 不是数组下标 —— 那个在截断后会与它分叉。 */
  readonly ts: number
  /** ★★ `sourceTaskId` —— **一条对话线程的分组键**（见上面的长注释）。 */
  readonly taskId?: string
  readonly attemptId?: string
  readonly taskStatus?: string
  /** ★ `readAt` 在场 ⇒ 已读。★★ 已读的消息**仍然**在投影里（见下面的读法注释）。 */
  readonly read: boolean
}

/**
 * One registered criterion, as the **UI** needs it (window v4 / t78-shaped hop).
 *
 * ★ 这是"**可插拔**"的落点（用户原话：这些测试信息需要是可插拔的）：
 *   UI 不硬编码任何判据名 —— 它读 `id` + `description`，于是**换掉一条判据**
 *   （改 `src/gates/**` 里的模块）⇒ 两者都变 ⇒ **UI 自动跟着变，不用改代码**。
 */
export interface TeamActivityGate {
  readonly id: string
  readonly description: string
  /** 观察模式（开火了但放过）。★ 必须在清单里看得见，否则"被把关了"是假的。 */
  readonly observing: boolean
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
  readonly point: string
  /** 该位置**注册了几条**（与上下文无关）。`0` = 空位置（正常情形）。 */
  readonly registered: number
  /** 逐条清单，按注册顺序。 */
  readonly gates: readonly TeamActivityGate[]
}

/** The full panel payload for one team. */
export interface TeamActivitySnapshot {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly phase: 'staged' | 'running'
  readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback'
  readonly halted?: boolean
  readonly members: readonly TeamActivityMember[]
  readonly tasks: readonly TeamActivityTask[]
  /**
   * ── ★★★ t4：残留 `working` 的**后果面**（DISPATCH-RULES §39.2）───────────────
   *
   * t39 的树 12 个文件未提交（含 300 行改动），而"按 working 当它在跑而等着"
   * ⇒ 那些改动永远冻在那儿。这一格就是那句后果的出口。
   * ★ `clear` 与 `could-not-measure` **必须不同形**（见 `StrandedWorktrees`）。
   */
  readonly strandedWork: StrandedWorktrees
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
  readonly unattributedSubagents: readonly LiveSubagent[]
  readonly messageCount: number
  readonly captainInbox: readonly TeamActivityMessage[]
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
    readonly health: CollectionHealth
    /** 读文件层的读数（三态 + 坏行计数 —— `skippedMalformed` 在场 = 有行被跳过）。 */
    readonly readout: SignalsHealthRead
  }
  /**
   * ★★ t101：读数**算不了**时的原因（只在真的算不了时在场 —— 缺席 = 算出来了）。
   * ★ 与 `collectionHealth: undefined`（文件缺席，正常态）**不同形**：这一格是**异常**
   *   （读文件抛了非 ENOENT 的错等）。
   */
  readonly collectionHealthUnmeasurable?: string
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
  readonly proposalPipeline?: ProposalPipelineReadout
  /**
   * ★★ t4：分流读数**算不了**时的原因（只在真的算不了时在场 —— 缺席 = 算出来了）。
   * ★ 与 `proposalPipeline: undefined`（signals 文件缺席，正常态）**不同形**。
   */
  readonly proposalPipelineUnmeasurable?: string
  /**
   * ★★ t100：因为超过 {@link MAILBOX_PROJECTION_LIMIT} 而**没有**进 `captainInbox` 的条数。
   *
   * ★★ 只在**真的截了**时在场（缺席 = 没截）。
   *   ★ 它存在的唯一理由：**静默截断会让"被截掉"与"没发过"同形**。
   */
  readonly captainInboxOmitted?: number
  /** ★ 截断前的总条数（与 `captainInboxOmitted` 一起读才完整）。 */
  readonly captainInboxTotal?: number
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
  readonly captainInboxUnreadable?: string
  /**
   * ── ★★★ v4：判据**清单**（registry.list() 的转发，与 t78 同构）──────────────────
   *
   * 六个位置**都在**（含空位置），因为"这个位置没有判据"与"这个位置没被读"
   * 必须不同形。★ 它是**每份快照都带**的静态目录（判据注册表在模块加载时就建好），
   * 所以不依赖任何任务的状态 —— 于是"可插拔"才成立。
   */
  readonly gateCatalog: readonly TeamActivityGateCatalog[]
}

/** Snapshot projection switches for live and archived teams. */
export interface TeamSnapshotOptions {
  /** Historic review must retain members that were marked removed at shutdown. */
  readonly includeRemoved?: boolean
  /** Archived teams have no meaningful live activity after their sessions stop. */
  readonly historic?: boolean
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
export function gateCatalogForUi(): TeamActivityGateCatalog[] {
  const listed = registry.list()
  return INSERTION_POINTS.map((point) => {
    const gates = listed[point] ?? []
    return {
      point,
      registered: gates.length,
      gates: gates.map((gate) => ({
        id: gate.id,
        description: gate.description,
        observing: gate.observing,
      })),
    }
  })
}

/** The current task of a member: its first unfinished owned task. */
function currentTaskOf(memberName: string, tasks: readonly TeamTask[]): string {
  for (const task of tasks) {
    if (task.status === 'in_progress' && task.assignee === memberName) return task.id
  }
  return ''
}

/** Compact `provider/model` route for the activity panel, or just the model. */
export function memberModelRoute(member: { provider?: string; model?: string } | undefined): string {
  if (member === undefined) return ''
  const provider = member.provider?.trim() ?? ''
  const model = member.model?.trim() ?? ''
  if (provider !== '' && model !== '') return `${provider}/${model}`
  return model
}

/**
 * Assemble one team snapshot from its durable files plus live activity.
 * @param ctx - the plugin context (injects `subagents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @returns the panel snapshot.
 */
export async function assembleTeamSnapshot(
  ctx: Context,
  stateRoot: string,
  workspace: string,
  state: TeamState,
  options: TeamSnapshotOptions = {},
): Promise<TeamActivitySnapshot> {
  const tasks = state.tasks
  const depths = taskDepthsById(tasks)
  const roster = options.includeRemoved === true
    ? state.members
    : state.members.filter((member) => member.status !== 'removed')
  const activity = options.historic === true
    ? new Map<string, 'running' | 'idle' | 'ready'>()
    : memberActivity(ctx, roster.map((member) => member.id))
  /**
   * ── ★★★ t27：枚举**一次**活会话，然后按父会话归组（全员共用那一份）───────────────
   *
   * ★ 为什么只枚举**一次**而不是每个成员各枚举一次：`ctx.agents.list()` 是
   *   O(全会话) 的，而按成员各调一次会让这一份快照变成 O(成员 × 全会话) ——
   *   面板是轮询的，那个乘积会直接变成 UI 的延迟。
   *
   * ★ 归档团队（`historic`）**不读**：那些会话按定义已经停了，读它会报一整排
   *   "没有子代理"，而那是关于"它是历史"的**已知事实**，不是一次观测
   *   （与 `memberLiveness` 的归档支同一条口径）。
   *
   * ★★ 三态在这里被**如实传递**：枚举读不到 ⇒ `projection` 报
   *   `could-not-measure` ⇒ `attribution` 是 `undefined` ⇒ 每个成员的
   *   `subagents` 都是 `could-not-measure`（**不是**空数组）。
   *   这条链上任何一环把它圆成"空"，面板就会静默地说"没有子代理"。
   */
  const projection = options.historic === true ? undefined : liveSessionRefs(ctx)
  /**
   * ★ 归组只在**读到了**的时候做。`undefined` 是"这一层没能观察"的载体 ——
   *   而 `attributeSubagents` 永不返回 `undefined`，所以两者不同形。
   */
  const attribution: SubagentAttribution | undefined = projection?.status !== 'observed'
    ? undefined
    : attributeSubagents(projection.subagents, roster.map((member) => member.id))
  const unreadByMember = new Map<string, number>()
  for (const member of roster) {
    try {
      unreadByMember.set(member.name, (await readUnreadMailbox(stateRoot, state.id, member.name)).length)
    } catch (error: unknown) {
      ctx.logger.warn(`agent-teams: mailbox read failed for ${member.name}: ${String(error)}`)
      unreadByMember.set(member.name, 0)
    }
  }
  const members: TeamActivityMember[] = roster.map((member) => {
    const owned = tasks.filter((task) => task.assignee === member.name)
    const done = owned.filter((task) => task.status === 'completed').length
    /**
     * ★ t4：存活读数与 `activity` **并列**。历史（归档）团队没有"活着"可言
     *   —— 它的会话按定义已经停了，所以那一支**不读**（读它会报一整队 `not-live`，
     *   而那是一条关于"它是历史"的已知事实，不是一次故障）。
     */
    const live = options.historic === true ? undefined : memberLiveness(ctx, member)
    const open = owned.filter((task) => !TERMINAL_TASK_STATUSES.includes(task.status)).map((task) => task.id)
    /**
     * ★ t27：这个成员名下的活子代理。归档团队支报 `observed` + 空数组 ——
     *   那些会话按定义已经停了（"它是历史"是一个**已知事实**，不是一次观测），
     *   与 `liveness` 的归档支同一条口径。
     */
    const subs = options.historic === true
      ? { status: 'observed' as const, subagents: [] }
      : memberSubagents(ctx, member.id, attribution, projection?.status === 'observed' ? undefined : projection?.reason)
    /**
     * ★ 轮次：这个成员名下**有轮次的任务**里最大的那一轮。
     *   缺省（没有任务带 `round`）⇒ 这一格**缺席**，而不是 `0` ——
     *   "没有轮次概念"与"第 0 轮"必须不同形。
     */
    const rounds = owned.map((task) => task.round).filter((round): round is number => typeof round === 'number')
    return {
      id: member.id,
      name: member.name,
      role: member.role ?? '',
      provider: member.provider?.trim() ?? '',
      model: member.model?.trim() ?? '',
      reasoningEffort: member.reasoningEffort?.trim() ?? '',
      executionPrompt: member.executionPrompt ?? '',
      status: member.status,
      activity: options.historic === true
        ? 'idle'
        : member.id !== ''
          ? (activity.get(member.id) === 'running'
              ? 'working'
              : activity.get(member.id) === 'idle' || activity.get(member.id) === 'ready'
                ? 'idle'
                : 'unknown')
          : 'idle',
      /**
       * ★ 归档团队支：`liveness` 报 `could-not-measure` 而不是 `not-live` ——
       *   因为"历史团队的会话停了"是**可判定的**（它是历史），而 `not-live` 的
       *   含义是"它本该在跑而现在不在" ⇒ 把那件事报成 `not-live` 会让每一份
       *   历史快照都带着一整队假死亡告警（而那正是"恒常告警会被永久忽略"）。
       */
      liveness: live === undefined ? 'could-not-measure' : live.state,
      livenessReadout: live === undefined ? 'driver-status-unreadable' : live.readout,
      ...live?.state !== 'could-not-measure' ? {} : {
        livenessReason: live?.reason ?? 'this is an archived team, so whether its member sessions are alive is not a question about the present',
      },
      stranded: live !== undefined && strandedWork(live, open),
      subagents: subs.status,
      liveSubagents: subs.subagents,
      ...subs.reason === undefined ? {} : { subagentsReason: subs.reason },
      ...rounds.length === 0 ? {} : { round: Math.max(...rounds) },
      progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
      done,
      total: owned.length,
      currentTask: currentTaskOf(member.name, tasks),
      unread: unreadByMember.get(member.name) ?? 0,
    }
  })
  /**
   * ★ 冻着的树：只有**真的有**死掉的成员时才去读 git（干净的情形零成本）。
   *
   * ★ 用 `workspace`（面板显示的那个工作区根）而不是 `stateRoot` 去拼路径：
   *   `.agent-teams/worktrees/<name>` 的父目录是**工作区**，而 `stateRoot` 可能
   *   被配置到别处（`stateDir`）。两者在缺省下相同，但用错了那一格会在一次
   *   自定义 `stateDir` 下静默地读一个不存在的目录 ⇒ 恒报"没有东西会丢"。
   * ★ 树名用 `worktreeDirName`（与建树、找树同一个函数）—— 按成员名拼是第二份真相。
   */
  const frozenCandidates = members
    .filter((member) => member.liveness === 'not-live' && member.stranded)
    .flatMap((member) => tasks
      .filter((task) => task.assignee === member.name && !TERMINAL_TASK_STATUSES.includes(task.status))
      .map((task) => ({
        member: member.name,
        path: join(workspace, '.agent-teams', 'worktrees', worktreeDirName(state.id, task.id)),
        name: worktreeDirName(state.id, task.id),
      })))
  const strandedWorkReadout: StrandedWorktrees = strandedWorktrees(frozenCandidates, (tree) => {
    const dirty = gitChangedPaths(tree)
    return dirty === undefined ? undefined : dirty.length
  })
  /**
   * ── ★★★ t100：读**全部**信箱，而不是只读未读 ──────────────────────────────────
   *
   * MEASURED（t100 开工实测）：这里此前是 `readUnreadMailbox(...)`。
   * ★★ 而"未读"是**读的那一刻**的状态 ⇒ **一旦读过，那条就从快照里消失**
   *   ⇒ ★★★ 后果：**对话线程会自己变短** ——
   *     而"消息没了"与"从来没发过"在界面上**同形**（本仓记账最久的形态）。
   *
   * ★ 为什么现在只读未读会**特别**坏（以前不那么明显）：
   *   本轮把投影扩到九格、并引入 `taskId` 作为**线程分组键** ⇒
   *   ★ 一条线程现在要显示「**提问 → 裁决**」的**往返**。
   *   而裁决一旦被判据/成员读过，它就消失 ⇒ **往返只剩一半**，
   *   而"只问没答"与"根本没问"在界面上同形。
   *
   * ★★ 所以读**全部** —— `readMailbox` 是既有的"读全部"入口
   *   （`readUnreadMailbox` 就是它再 filter 一次，实测两行）。
   *   ⇒ 这**不是**新开一条读路径，是**改用**既有那条。
   * ★ 而"已读/未读"这件事**没有丢**：`read` 那一格（← `readAt`）如实带着它。
   */
  /**
   * ── ★★★ t100（反向半边 C）：**空信箱**与**读不到信箱**必须不同形 ───────────────────
   *
   * MEASURED（t100 开工实测，两条既有行为）：
   * ```
   * 信箱文件不存在 ⇒ readMailbox 返回 []      （"确实没有"）
   * 信箱文件读不了 ⇒ readMailbox **抛错**     （"没能测量"）
   * ```
   * ★★ 而本调用此前**不接错** ⇒ 抛出后被 `collectTeamsActivity` 的
   *   `catch { logger.warn(...) }` 吞掉 ⇒ **整支队伍从快照列表里消失**。
   *   ★★★ 于是"这支队读不到"与"这支队不存在"在**面板上同形** ——
   *     而那正是本仓记账最久的形态，只是换了个入口。
   *
   * ⇒ 修法：**接住它**，并把那一态**如实投影出来**（`captainInboxUnreadable`）。
   *   ★ 三态**互不同形**：缺席（读到了）· 在场（读不到）· `[]`（读到了、确实没有）。
   */
  let captainInbox: readonly TeamMessage[] = []
  let captainInboxUnreadable: string | undefined
  try {
    /**
     * ★★ 而**只**滤掉"已丢弃"，**不**滤"已读" —— 两者的过滤意图不同：
     *   · `readAt` 在场  ⇒ ★ **不该**让它消失（那正是本任务要修的：线程自己变短）
     *   · `discardedAt` 在场 ⇒ ★ **是另一种状态**（那封信被显式作废了：
     *     `discardMailboxMessages` 在 create-task / members / reassign 三处被真的调用）
     *
     * ★★★ 为什么这一句是**必要的**而不是"顺手加的"：
     *   MEASURED（t100 实测）：`readMailbox` **不**滤 `discardedAt`
     *   （`readUnreadMailbox` 才滤，它滤的**两半**是 `readAt` + `discardedAt`）。
     *   ⇒ 我这次把调用从后者换成前者，**会顺手把"已丢弃"的信也放出来**，
     *     而它们在九格里**没有对应的格** ⇒ 读起来与普通消息**同形**。
     *   ★★ 那是**我自己引入的回归**，不是我该修的那个缺陷 ⇒ 在这里堵掉。
     *   ★ 若将来要让"已丢弃"可见，那需要**第 10 格**，而那是**形态决策**
     *     （任务书给的是九格）⇒ 由队长裁定，我不擅自加。
     */
    captainInbox = (await readMailbox(stateRoot, state.id, CAPTAIN_KEY))
      .filter((message) => message.discardedAt === undefined)
  } catch (error: unknown) {
    /**
     * ★★ **不**让整支队消失：信箱读不了是**一个字段**的问题，
     *   而不是"这支队伍不存在"。⇒ 降级成"这一格读不到"，其余照常投影。
     */
    captainInboxUnreadable = String((error as { message?: unknown })?.message ?? error)
  }
  /**
   * ── ★★★ t101：算采集健康读数（health.ts 的第一个生产消费者）──────────────────────
   *
   * ★ 落点在**快照组装**（`/state` 路由经 `collectTeamsActivity` 走到这里）——
   *   那是 UI **真读**的通道；接在这里之后，`collectionHealthOf` 在 `src/` 里
   *   第一次有了【非测试】调用方（判据：grep 可核）。
   *
   * ★ 归档团队（`historic`）**不算**：归档团队的 `stateRoot` 指向 archive 树，
   *   其 signals.jsonl 不是"采集流水线"的现役读数 —— 读了会把历史树混进现役面板
   *   （与 `historic` 对活会话的同一条口径，见上面的 `projection`）。
   */
  let collectionHealth: TeamActivitySnapshot['collectionHealth']
  let collectionHealthUnmeasurable: string | undefined
  if (options.historic === true) {
    collectionHealthUnmeasurable = 'archived team: the collection pipeline readout is only computed for live teams'
  } else {
    try {
      const readout = await readSignalsHealth(stateRoot, async (path, encoding) => {
        const { readFile } = await import('node:fs/promises')
        return readFile(path, encoding)
      })
      if (readout.status === 'unmeasured') {
        /** ★ 文件缺席（`file-absent`）＝ 流水线没开过 ⇒ `collectionHealth` 整格缺席（**不是**空读数）。 */
        collectionHealth = undefined
      } else {
        /**
         * ★ `refused`：从**每条信号自带**的 `collection.verdicts` 数（`ok` 之外的裁决）——
         *   **转发**已有裁决，**不重跑判据**（t87 的硬约束 3 同一条）。
         *   ★ 坏行/无该格的行 ⇒ 它们没有 refused 可言，照实不数（不补 0）。
         */
        collectionHealth = { health: collectionHealthOf(readout.records, readout.refused), readout }
      }
    } catch (error: unknown) {
      /** ★ 算不了是**异常**（读文件抛了 ENOENT 之外的错等）—— 与"文件缺席"不同形。 */
      collectionHealthUnmeasurable = String((error as { message?: unknown })?.message ?? error)
    }
  }
  /**
   * ── ★★★ t4 / N2：算分流读数（`propose.ts` / `history.ts` 的第一个生产消费者）────────
   *
   * ★ 落点与 `collectionHealth` **完全相同**（`/state` → `collectTeamsActivity` → 这里）——
   *   理由也一样：那是 UI **真读**的通道。接在这里之后，
   *   `routeSignals` / `readProposalPipeline` 在 `src/` 里第一次有了【非测试】调用方。
   *
   * ★★ 读**同一份** `signals.jsonl`，**不**再开第二个口径：`readProposalPipeline` 内部
   *   用的是 `signalsPathOf(stateRoot)`（与 `readSignalsHealth` 同一个函数）——
   *   所以"两个读数看的是不是同一份文件"在这份形状下**写不出分叉**。
   *
   * ★★ 归档团队（`historic`）同样**不算**：理由与上面那格逐字相同（archive 树的
   *   `signals.jsonl` 不是现役读数）。★ 但**措辞不同形**：这里留给它一条
   *   `proposalPipelineUnmeasurable`，而不是让整格静默缺席 ——
   *   因为归档团队**确实**有一条"为什么这格算不出来"的原因可讲。
   */
  let proposalPipeline: TeamActivitySnapshot['proposalPipeline']
  let proposalPipelineUnmeasurable: string | undefined
  if (options.historic === true) {
    proposalPipelineUnmeasurable = 'archived team: the routing readout is only computed for live teams'
  } else {
    try {
      const readout = await readProposalPipeline(stateRoot, async (path, encoding) => {
        const { readFile } = await import('node:fs/promises')
        return readFile(path, encoding)
      })
      /**
       * ★★ `unmeasured` ⇒ 整格缺席（**不是**空读数）：
       *   把"流水线没开过"投影成 `{ total: 0, produced: 0, none: 0 }` 会让它与
       *   "开了、看了 0 条、确实没有提案"同形 —— 而两者的补救动作相反。
       */
      if (readout.status === 'unmeasured') {
        proposalPipeline = undefined
      } else {
        proposalPipeline = readout
      }
    } catch (error: unknown) {
      /** ★ 算不了是**异常** —— 与"文件缺席"不同形（同 `collectionHealthUnmeasurable` 口径）。 */
      proposalPipelineUnmeasurable = String((error as { message?: unknown })?.message ?? error)
    }
  }
  return {
    workspace,
    teamId: state.id,
    name: state.name,
    ...state.description !== undefined ? { description: state.description } : {},
    captainSessionId: state.captainSessionId,
    phase: state.phase ?? 'running',
    ...state.phase === 'staged'
      ? { planReviewState: state.planReviewState ?? 'awaiting_review' as const }
      : {},
    ...state.halted === true ? { halted: true } : {},
    members,
    strandedWork: strandedWorkReadout,
    /**
     * ★★★ t27：父会话定不下来的活子代理（见 `TeamActivitySnapshot` 上那段）。
     *   ★ 归档团队支 ⇒ `attribution` 缺席 ⇒ 空数组：那些会话已经停了，
     *     "没有正在跑的外来子代理"是一个**已知事实**，不是一次观测。
     */
    unattributedSubagents: attribution?.unattributed ?? [],
    tasks: tasks.map((task) => ({
      id: task.id,
      subject: task.subject,
      description: task.description ?? '',
      status: task.status,
      state: taskVisualState(task.status, task.dependencies, tasks),
      assignee: task.assignee ?? '',
      model: memberModelRoute(roster.find((member) => member.name === task.assignee)),
      dependencies: task.dependencies,
      depth: depths.get(task.id) ?? 0,
      ...task.kind === undefined ? {} : { kind: task.kind },
      ...task.round === undefined ? {} : { round: task.round },
      ...task.verdict === undefined ? {} : { verdict: task.verdict },
      /**
       * ── ★★★ t78：把**判据结果**也送到浏览器（最后那一跳）─────────────────────────
       *
       * ── 它修的是什么（MEASURED）────────────────────────────────────────────────────
       *
       * 本仓存在**两个互不相连**的 `/state`：
       *
       *     · **client 真正轮询的那个** → `collectTeamsActivity`（本函数）
       *     · status 工具的返回值       → `src/tools/status.ts`
       *
       * MEASURED（队长实测 `lib/client.js` 的引用计数）：
       *
       *     failure_kind   : 0 处
       *     attempt_id     : 0 处
       *     findings_open  : 0 处
       *     gate_evaluation: 0 处   ← ★ 连刚加的也没有
       *
       * ⇒ **status 工具的返回值【根本不流向浏览器】** ⇒ 做在 `status.ts` 里的那一跳
       *   落在**UI 不读的通道**上。⇒ 本行就是把判据结果接到**UI 真读的那条路**上。
       *
       * ── ★ 缺字段的语义（与上面 `kind` / `round` / `verdict` 逐字相同的先例）───────
       *
       * 用**展开式**而不是 `gateEvaluation: task.gateEvaluation`：
       *
       *     展开式：  key **整个不出现**   ⇒ "**从来没求值过**"
       *     赋值式：  key 出现、值为 undefined ⇒ 与"求值了但没有数据"**同形**
       *
       * ★ 而这两件事必须不同形（本仓三态纪律）：前者是"这一格没有任何读数"，
       *   后者是"读了、但读出来是空的"。客户端的 `readGateEvaluation` 靠
       *   **key 在不在**把前者读成 `absent` ⇒ 缺字段**不许**被填成空对象或 fake `ok`。
       */
      ...task.gateEvaluation === undefined ? {} : { gateEvaluation: task.gateEvaluation },
      /**
       * ── ★★ t81：按**段**的判据裁决（`gateEvaluations`）—— 与上一格同构转发 ────────────
       *
       * ★ 为什么**照抄**上面那条展开式而不是合并两个字段：同一条三态纪律 ——
       *     `...task.gateEvaluations === undefined ? {} : {...}`
       *   key **整个不出现** ⇒ "这条任务一个段都没落过盘"；
       *   key 出现而某段缺席 ⇒ "那一段没走到 / 不是任务级"。
       *   ★ 两者**不同形**，客户端的四态判定靠的就是这个差别。
       *
       * ★ 而**不在这里**补齐 delivery/runtime 两段：它们**不是任务级事实**
       *   （团队级/事件级）⇒ 补一个会让读取端以为"判过而通过了"。
       *   ★ UI 侧必须把它们显示成「团队级」，不是 ○、更不是 ✓。
       * ★ 也不补齐 admission：它**已注册 3 条判据，但生产零求值点**（全仓没有
       *   `evaluate('admission', …)` 调用）⇒ 任务级**永远**拿不到它的裁决
       *   ⇒ UI 显示「0 条」。★ 这两件事在 UI 上同形，而补救动作相反：
       *   前者是"该段没有这个说法"，后者是"有判据但没接线"。
       */
      ...task.gateEvaluations === undefined ? {} : { gateEvaluations: task.gateEvaluations },
      /**
       * ── ★★★ `failed` 的【三种】成因（t13 的客户端那一半）──────────────────────
       *
       * `status` 只有一个值 `failed`，而它同时盖着三件补救动作完全不同的事：
       *
       *     inconclusive    —— 这个任务的性质就是"找问题"，而它【找到了】
       *                        （审查给了 needs_revision / reject）
       *     failed_delivery —— 交付物【真的坏了】（验收项 failed / verify 非 0）
       *     failed_context  —— 没有测到任何证据（★ 缺省，最保守）
       *
       * ★ 把它们压成一个 `failed`，面板就只能画成红色 —— 于是"这道门做成了它
       *   该做的事"被读成"东西做砸了"。分类的判据**不在本文件**：它逐字来自
       *   `src/state.ts` 的 `failureKindOf`，这里只是把它【交出去】。
       *
       * ★ 只在 `status === 'failed'` 时在场 —— 于是"不适用"与"三种之一"不同形：
       *   一个没有失败的任务不带这一格，而不是带一个假的 `failed_context`。
       */
      ...task.status !== 'failed' ? {} : { failureKind: failureKindOf(task) },
      updatedAt: task.updatedAt,
    })),
    messageCount: captainInbox.length
      + members.reduce((count, member) => count + member.unread, 0),
    /**
     * ★★★ t100：投影**九格**（此前只有两格：`from` / `content`）。
     *
     * ★ 逐格说明**为什么它必须在**（不是"顺手多给几格"）：
     *   · `id`         —— 定位一封信（点开、引用、去重**都**要它）
     *   · `to`         —— 收件人。★ 有了它，"谁发给谁"才**可读**；
     *                    而从 `from` 反推收件人**做不到**（同一个 `from` 可以发给多个）
     *   · `ts`         —— ★ **排序与显示**。★ 没有它只能靠**数组序**猜先后，
     *                    而数组序是**投影顺序**、不是时间顺序（截断后会分叉）
     *   · `taskId`     —— ★★ **一条线程的分组键**（`sourceTaskId`）
     *   · `attemptId`  —— 这条消息**针对哪一代**（同一任务多代时不能混）
     *   · `taskStatus` —— ★ 写信**当时**任务是什么状态（事后会变，所以要记当时的）
     *   · `read`       —— ★ 已读/未读。★ 而"已读"**不再**让它从投影里消失
     *   · `from`·`content` —— 原有的两格
     */
    captainInbox: captainInbox.slice(-MAILBOX_PROJECTION_LIMIT).map((message) => ({
      id: message.id,
      from: message.from,
      to: message.to,
      content: message.content,
      ts: message.ts,
      /** ★ 缺席时**整个键不出现** —— "不属于任何任务"与"属于一个空名字的任务"不同形。 */
      ...message.sourceTaskId === undefined ? {} : { taskId: message.sourceTaskId },
      ...message.sourceAttemptId === undefined ? {} : { attemptId: message.sourceAttemptId },
      ...message.sourceTaskStatus === undefined ? {} : { taskStatus: message.sourceTaskStatus },
      read: message.readAt !== undefined,
    })),
    /**
     * ── ★★ t100：截断**必须**有明确读数 ────────────────────────────────────────────
     *
     * ★ 为什么要设上限：信箱实测有 **108 条**，而正文可能很长 ——
     *   全量塞进快照会撑爆载荷（而 `/state` 是**每次轮询**都要传的）。
     * ★★ 而超过上限时**必须报出截了多少条**：
     *   ★ 静默截断会让"**被截掉**"与"**没发过**"同形 ——
     *     而那是本任务要修的那条形态的**同一个形状**（只是换了个入口）。
     *
     * ★ 这一格**只在真的截了**的时候在场（`undefined` = 没截）。
     *   ★★ 与"截了 0 条"不同形：后者是"截过、但一条都没超"。
     */
    ...captainInbox.length > MAILBOX_PROJECTION_LIMIT
      ? {
          captainInboxOmitted: captainInbox.length - MAILBOX_PROJECTION_LIMIT,
          captainInboxTotal: captainInbox.length,
        }
      : {},
    /**
     * ★★ t100（反向半边 C）：读不出来时**如实标出**，且**只在真的读不出来时在场**。
     * ★ 缺席 = 读到了（可能是空的）⇒ 与"读不到"不同形。
     */
    ...captainInboxUnreadable === undefined ? {} : { captainInboxUnreadable },
    /**
     * ── ★★★ v4：判据**清单**（最后一跳，与 t78 的 gateEvaluation 同构）──────────────
     *
     * `registry.list()` 原本只在 `src/tools/status.ts` 被读，而那是**UI 不读的通道**。
     * 这一行把它接到 UI **真读**的那条路上（`collectTeamsActivity`），
     * 于是展开态才有"这个阶段挂着哪些判据、各自是什么"可画。
     *
     * ★ 它是**静态目录**：判据注册表在模块加载时就建好，与任务状态无关。
     *   所以它每份快照都带同一份 —— 这正是"可插拔"成立的前提（换判据 ⇒ UI 自动变）。
     */
    gateCatalog: gateCatalogForUi(),
    /**
     * ── ★★★ t101：采集健康读数（只【算出来】时在场）───────────────────────────────
     *
     * · `collectionHealth` **缺席** = 文件缺席（`file-absent`，流水线没开过）——
     *   ★ **不是**空读数：空读数会把"没开过"读成"开了没采到"。
     *   ★ 在场时自带两半：`health`（collectionHealthOf 的产出）+ `readout`（三态 + 坏行计数）。
     * · `collectionHealthUnmeasurable` **在场** = 真的算不了（异常）—— 与缺席**不同形**。
     */
    ...collectionHealth === undefined ? {} : { collectionHealth },
    ...collectionHealthUnmeasurable === undefined ? {} : { collectionHealthUnmeasurable },
    /**
     * ── ★★★ t4 / N2：分流读数（只【算出来】时在场）─────────────────────────────────
     *
     * · `proposalPipeline` **缺席** = `signals.jsonl` 没开过（流水线没走过）。
     * · `proposalPipelineUnmeasurable` **在场** = 真的算不了（异常 / 归档团队）。
     * ★ 两者不同形：前者是**正常态**（还没开始采集），后者是**异常**。
     */
    ...proposalPipeline === undefined ? {} : { proposalPipeline },
    ...proposalPipelineUnmeasurable === undefined ? {} : { proposalPipelineUnmeasurable },
  }
}

/**
 * Collect every team under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @returns the snapshots in stable order (workspace, then team id).
 */
export async function collectTeamsActivity(
  ctx: Context,
  roots: readonly { workspace: string; stateRoot: string }[],
): Promise<TeamActivitySnapshot[]> {
  const snapshots: TeamActivitySnapshot[] = []
  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root.stateRoot, { withFileTypes: true })
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const state = await readTeam(root.stateRoot, entry.name)
        if (state === undefined) continue
        snapshots.push(await assembleTeamSnapshot(ctx, root.stateRoot, root.workspace, state))
      } catch {
        ctx.logger.warn(`agent-teams: skipped unreadable team state "${entry.name}" in workspace "${root.workspace}"`)
      }
    }
  }
  return snapshots
}

/**
 * Collect every archived team under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Used by the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @returns the archived snapshots in stable order.
 */
export async function collectArchivedTeamsActivity(
  ctx: Context,
  roots: readonly { workspace: string; stateRoot: string }[],
): Promise<TeamActivitySnapshot[]> {
  const snapshots: TeamActivitySnapshot[] = []
  for (const root of roots) {
    for (const teamId of await listArchivedTeamIds(root.stateRoot)) {
      try {
        const state = await readArchivedTeam(root.stateRoot, teamId)
        if (state === undefined) continue
        snapshots.push(await assembleTeamSnapshot(
          ctx,
          join(root.stateRoot, 'archive'),
          root.workspace,
          state,
          { includeRemoved: true, historic: true },
        ))
      } catch {
        ctx.logger.warn(`agent-teams: skipped unreadable archived team "${teamId}" in workspace "${root.workspace}"`)
      }
    }
  }
  return snapshots
}
