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
import { type MemberSubagent } from './activity-model.ts';
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
    readonly tasks: readonly ActivityTask[];
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
/**
 * One member row: identity, model, current work, elapsed state; expansion
 * reveals the live subagents underneath it.
 */
export declare function MemberRow({ team, member, tasks, expanded, onToggle, onOpenSubagent, onSelectTask, modelDirectory, t, historic, discarded, stopped, frozenNow, memberModel: memberModelProp, memberModelEditable: editableProp, }: MemberRowProps): import("react").JSX.Element;
/** Exported for the panel: the session id a member's transcript lives under. */
export type MemberSessionId = SessionId;
