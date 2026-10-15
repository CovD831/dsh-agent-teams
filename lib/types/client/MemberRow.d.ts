/**
 * One durable member of a team, as a single row on screen one.
 *
 * ── ★★★ 这一屏要回答什么（用户原话）────────────────────────────────────────────
 *
 *   "is the whole team working, and who is doing what"
 *
 * 而用户对第一屏的**结构**要求是：显示**持久成员**，点开一个成员就看到它底下的
 * **子代理**，轮次信息**一起**给出来（"round data moves UP into screen one"）。
 *
 * ── 一行的四件事（缺一件就是一个"看起来正常但读不出东西"的格子）──────────────
 *
 *   ① 身份      —— 头像 + 名字 + 角色
 *   ② 模型      —— 它跑在哪个路由上（未启动的成员就地可改，复用既有选择器）
 *   ③ 在做什么  —— 当前任务 id + 任务名，读不出就说清是"读不出"
 *   ④ 计时      —— worked N / waiting N / idle / unknown，★ **从不空白**
 *
 * 展开后是它底下的子代理（数据由 R1/t27 送到 /state），每个**各自**说明它在做什么。
 *
 * ── ★ 反例：为什么计时必须单独一个组件 ────────────────────────────────────────
 *
 * 秒表若挂在**这一行**上，一行一 tick ⇒ 整队每秒重渲染。所以时长交给
 * {@link MemberClock}（它自己拥有表），本组件**不持有** `now`。
 * @module dsh-agent-teams/client/member-row
 */
import { type FlowStage, type MemberGateReadout, type MemberSubagent, type StageGroupView } from './activity-model.ts';
import type { ActivityMember, ActivityTask, ActivityTeam } from './activity-monitor.ts';
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { AgentTeamsTranslate } from './locales.ts';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
/**
 * What the row needs from one member row of the `/state` payload.
 *
 * ★ R1/t27 added `subagents` / `liveSubagents` / `subagentsReason` to the wire
 *   payload, but `ActivityMember` (src/client/activity-monitor.ts) is OUT of
 *   this task's scope. Widening structurally here keeps the reading honest:
 *   the panel reads the fields that are actually on the wire, and the day the
 *   base interface catches up this alias collapses to `ActivityMember`.
 */
export type MemberRowMember = ActivityMember & {
    readonly subagents?: string;
    readonly liveSubagents?: readonly MemberSubagent[];
    readonly subagentsReason?: string;
    /** ★ R1/t27: the member's highest task round, absent when it has none. */
    readonly round?: number;
};
/**
 * One task as the row reads it, plus the S2 gate field when the wire carried it.
 *
 * ★ `gateEvaluation` is read **structurally**, not typed from `ActivityTask`:
 *   `src/client/activity-monitor.ts` declares a `src/tools/status.ts` field name
 *   (`gateEvaluation`) while the status tool actually serialises it to
 *   `gate_evaluation` **string**. Reading loosely here keeps the panel honest
 *   about both spellings instead of silently seeing `undefined` forever.
 */
export type MemberRowTask = ActivityTask & {
    readonly gateEvaluation?: unknown;
    readonly gate_evaluation?: unknown;
};
/** Presentation tone of one member's status dot (moved verbatim from the panel). */
export type MemberDotTone = 'running' | 'stalled' | 'delivered' | 'idle' | 'dormant';
/** Context flags that decide which member dot tone applies. */
export interface MemberDotContext {
    readonly discarded?: boolean;
    readonly stopped?: boolean;
    readonly staged?: boolean;
    readonly historic?: boolean;
}
/**
 * The tone of one member's status dot.
 *
 * ★ Liveness is read BEFORE `activity`, and the order is the whole point:
 *   `activity` is a durable field that keeps saying `working` after the member's
 *   session dies, so a dead member would keep a "running" dot forever — the
 *   residual reading task t4 exists to remove. A member whose session is gone
 *   while its work is still open therefore reads `stalled` (amber), not `running`.
 *
 * ★ When the host publishes no liveness field, this falls back to `activity`
 *   exactly as before rather than inferring a state nobody measured.
 */
export declare function memberDotTone(member: MemberRowMember, context: MemberDotContext): MemberDotTone;
/**
 * ── ★★★ S3：按【成员】渲染判据裁决（默认精简层）────────────────────────────────
 *
 * ★★ 主屏是【成员】；点开成员才是【约束的体现】（用户的裁定）。所以这一层只给
 *   **当前阶段的一句话裁决**，逐条判据的明细留给展开层。
 *
 * ★★ **四种答案不合流**（本队记账最久的形态）：
 *   · `absent`  ⇒ 「读不出」  ★ 绝不印成「全通过」（反向半边 A）
 *   · `empty`   ⇒ 「⊘ 未检查」★ 绝不印成「✓ 通过」（反向半边 B）
 *   · `verdict` ⇒ 裁决符号 + 人话
 *
 * @param readout - the one task's readout for this member.
 * @param t - locale lookup.
 */
export declare function memberGateBand(readout: MemberGateReadout | undefined, t: AgentTeamsTranslate): {
    readonly mark: string;
    readonly tone: string;
    readonly text: string;
};
/**
 * ── ★★★ v4：一根判据的**全部阶段分组**（展开态画的就是这个）────────────────────
 *
 * 规格 §5：按**阶段**分组，每段给整段形状 + 逐条 `id` + `description`。
 *
 * ★★ **甲方案的边界落在这里**（与 `stageGateRows` 同一条纪律）：
 *   只有 `completion` 段有落盘裁决 ⇒ 其余段**逐条只能是 ○/·**，
 *   绝不许从别处推一个 `✓` 出来。`hasVerdicts` 就是那条边界的**可读标记**。
 *
 * ★ 目录（`catalog`）来自 `/state` 的 `gateCatalog` —— 它是**每份快照都带**的
 *   静态清单，于是"换掉一条判据 ⇒ UI 自动跟着变"（可插拔）。
 * @param stage - the stage this member's current task is in, or undefined.
 * @param catalog - the registered criteria for every stage.
 * @param evaluation - the completion-stage verdicts, when the wire carried them.
 * @returns one group per stage, in flow order; `rows` is empty for empty stages.
 */
export declare function stageGroups(stage: FlowStage | undefined, catalog: readonly {
    readonly point: string;
    readonly gates: readonly {
        readonly id: string;
        readonly description: string;
        readonly observing: boolean;
    }[];
}[], evaluation: unknown): StageGroupView[];
/**
 * What this member is doing right now, in one line.
 *
 * ★ Every branch says *something*: a member with no current task reads a sentence
 *   rather than an empty line, because "this cell has nothing" and "this member has
 *   nothing to do" must not look the same.
 *
 * ── ★★★ D12：句子**不只一句**（用户从截图发现的缺陷）──────────────────────────
 *
 * MEASURED：改前这里只有一个兜底 `return`，于是**四种情形同形**。用户截图里
 * 决定性的一对照 —— `ui-engineer`（完成 0 · 失败 1）与 `ui-dissect`（完成 12 ·
 * 失败 3）主行**都是**「等待队长派工」。而这两件事的处置**相反**：
 *   · 有历史（做完了在等下一件）⇒ 队长**欠它**一个任务；
 *   · 无历史（生成后没派过活）  ⇒ 它**还没参与过**。
 *
 * ★ 纪律与紧邻的注释同源：**"空 vs 非空"防住了，"干完了 vs 没开始"没防住。**
 *   所以这里必须**四种不同形**，而不是"有任务 / 没任务"两分。
 * @param member - the member row.
 * @param current - the member's task that `currentTask` names, when it resolves.
 * @param owned - every task assigned to this member.
 * @param t - locale lookup.
 */
export declare function memberDoingText(member: MemberRowMember, current: ActivityTask | undefined, owned: readonly ActivityTask[], t: AgentTeamsTranslate): string;
/**
 * What one subagent is doing, in one line.
 *
 * ★ The host hands the raw session status through; an unrecognised value reads
 *   "状态未知" instead of being rounded to "工作中".
 * @param subagent - one live subagent from the /state payload.
 * @param t - locale lookup.
 */
export declare function subagentDoingText(subagent: MemberSubagent, t: AgentTeamsTranslate): string;
export type MemberRowProps = {
    readonly team: ActivityTeam;
    readonly member: MemberRowMember;
    /**
     * ★ S3：宽到 {@link MemberRowTask} —— 它需要读 `gate_evaluation`（status 工具
     *   序列化后的那一格），而 `ActivityTask` 尚未声明它。ActivityTask 兼容 widening，
     *   所以既有调用方（`MemberScreen` 传 `team.tasks`）**一行不用改**。
     */
    readonly tasks: readonly MemberRowTask[];
    /**
     * ★ 模型这一格由**调用方**算好交进来（面板用 `memberRouteLabel` 算一次）。
     *   判定口径只有一份：这里只负责**画**。
     */
    readonly memberModel?: string;
    /** `memberModelEditability` 的三态读数，同样由调用方算好。 */
    readonly memberModelEditable?: 'editable' | 'sealed' | 'unknown';
    readonly expanded: boolean;
    readonly onToggle: (key: string) => void;
    readonly onOpenSubagent: (childId: string) => void;
    readonly onSelectTask?: (id: string | null) => void;
    readonly modelDirectory?: ModelDirectory;
    readonly t: AgentTeamsTranslate;
    readonly historic?: boolean;
    readonly discarded?: boolean;
    readonly stopped?: boolean;
    /** Frozen observation instant; when omitted the clock owns a real timer. */
    readonly frozenNow?: number;
};
/** One registered stage of the forwarded criterion catalog. */
export interface MemberGateCatalogEntry {
    readonly point: string;
    readonly registered: number;
    readonly gates: readonly {
        readonly id: string;
        readonly description: string;
        readonly observing: boolean;
    }[];
}
/**
 * One member row: identity, model, current work, elapsed state; expansion
 * reveals the live subagents underneath it.
 */
export declare function MemberRow({ team, member, tasks, expanded, onToggle, onOpenSubagent, onSelectTask, modelDirectory, t, historic, discarded, stopped, frozenNow, memberModel: memberModelProp, memberModelEditable: editableProp, }: MemberRowProps): import("react").JSX.Element;
/** Exported for the panel: the session id a member's transcript lives under. */
export type MemberSessionId = SessionId;
