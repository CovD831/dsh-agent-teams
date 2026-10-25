/**
 * AgentTeams session event types — pure types only, zero imports.
 *
 * This file intentionally imports nothing: both the host program (the
 * emitter in `events.ts`) and the browser program (the Conversation Node
 * definition) must be able to load these types and the `SessionEventMap`
 * declaration merge without pulling in host-side `Context` augmentations
 * (dsh-session's index declares `Context.sessions: SessionStore`, which
 * collides with the browser runtime's `ISessions` under the same name).
 * @module dsh-agent-teams/event-types
 */

/** Opens one team record: the captain created the team. */
export interface AgentTeamsTeamCreatedData {
  readonly teamId: string
  /** The captain session that owns this team (UI follows it). */
  readonly captainSessionId: string
  readonly name: string
  readonly description?: string
  readonly profile?: string
}

/** Records one member after its continuable subagent is spawned. */
export interface AgentTeamsMemberAddedData {
  readonly teamId: string
  readonly memberId: string
  readonly name: string
  readonly role?: string
}

/** Marks one member removed. */
export interface AgentTeamsMemberRemovedData {
  readonly teamId: string
  readonly memberId: string
}

/** Records one task in the team's task list. */
export interface AgentTeamsTaskCreatedData {
  readonly teamId: string
  readonly taskId: string
  readonly subject: string
  readonly dependencies: readonly string[]
  readonly assignee?: string
  readonly kind?: string
  readonly round?: number
}

/** Records one task status/assignee/output transition. */
export interface AgentTeamsTaskUpdatedData {
  readonly teamId: string
  readonly taskId: string
  readonly status: string
  readonly assignee?: string
  readonly output?: string
  readonly attempt?: number
  readonly attemptId?: string
  readonly verdict?: string
  readonly round?: number
}

/** Records one captain-only contract amendment on a task. */
export interface AgentTeamsTaskAmendedData {
  readonly teamId: string
  readonly taskId: string
  /** Amended contract field names (`objective`, `inScope`, …). */
  readonly fields: readonly string[]
  /** Why the previous contract was wrong. */
  readonly reason: string
}

/** Records a human halt from the captain chat. */
export interface AgentTeamsTeamHaltedData {
  readonly teamId: string
  readonly cancelledTasks: number
}

/** Records an explicit captain resume of a halted team. */
export interface AgentTeamsTeamResumedData {
  readonly teamId: string
  readonly reason: string
}

/**
 * ── ★★★ t109：一次**跨工作区**操作的审计记录 ────────────────────────────────────────
 *
 * 用户裁定：「我需要一个**权限非常大**的主会话，它可以**操纵不同的工作区**。」
 * ★★ 而本仓纪律（用户原话同向）：
 * 「**能操作任何工作区**」与「**不知道它操作了哪个**」是**两件事** ——
 * 前者是能力，后者是缺陷 ⇒ ★★★ **所以能力与审计一起上。**
 *
 * ── ★★★ 为什么"动作"要【一个词一个意思】 ───────────────────────────────────────
 *
 * ★ 若一条记录只写 `action: 'delivery'`，那么"**读另一个区的交付状态**"
 *   与将来任何"对交付做了什么"在台账里**同形**。
 * ⇒ ★★ 本字段的取值域**只收单件事**，而当前只有一件：
 *   `'read-delivery'`（读另一个区的交付状态 —— ★ 它不改变那个区的任何状态）。
 * ★ 将来若要加"写"，**必须是新的取值**，不许复用这一个。
 *
 * ── ★★ 五个必答（少一个，"谁在什么时候对哪个区做了什么"就答不出）──────────────
 *
 *   谁       ⇒ `actor`
 *   何时     ⇒ 由宿主事件流自带的时间戳（本块不重复存 —— 重复会造两个时间口径）
 *   对哪个区 ⇒ `targetWorkspace` + `targetTitle`
 *   什么工具 ⇒ `tool`
 *   什么动作 ⇒ `action`
 * ★ 另加 `callerWorkspace`：**从哪个区发起** —— 跨区审计里"从哪到哪"要成对才读得出。
 */
export interface AgentTeamsWorkspaceAuditedData {
  readonly teamId: string
  /** ★ 调用者身份（`captain` 或成员名）。 */
  readonly actor: string
  /** ★ 调用者**自己**所在的工作区（发起方）。 */
  readonly callerWorkspace: string
  /** ★★★ **目标区标识** —— 没有它，「操作了哪个区」无从回答。 */
  readonly targetWorkspace: string
  /** ★ 目标区的显示名（与 `/state` 路由的 `workspace.title` 同源）。 */
  readonly targetTitle: string
  /** ★ 用了什么工具（工具名，不是文件名）。 */
  readonly tool: string
  /** ★★ 什么动作 —— ★ **单件事**（见上面的取值域说明）。 */
  readonly action: 'read-delivery'
}

/** Closes one team record: the team was deleted. */
export interface AgentTeamsTeamDeletedData {
  readonly teamId: string
}

/** Records a staged plan that the user rejected before any member was spawned. */
export interface AgentTeamsPlanDiscardedData {
  readonly teamId: string
}

/** Records one mailbox message sent between team agents. */
export interface AgentTeamsMessageSentData {
  readonly teamId: string
  readonly messageId: string
  /** `captain` or a member name. */
  readonly from: string
  /** `captain` or a member name. */
  readonly to: string
  readonly content: string
  readonly ts: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one team record.
     * @param data - stable team identity and display name.
     */
    'agent-teams/team-created': AgentTeamsTeamCreatedData
    /**
     * Records one team member.
     * @param data - team identity, member child session, and display identity.
     */
    'agent-teams/member-added': AgentTeamsMemberAddedData
    /**
     * Records one member removal.
     * @param data - team identity and the member's child session id.
     */
    'agent-teams/member-removed': AgentTeamsMemberRemovedData
    /**
     * Records one task creation.
     * @param data - team identity, task id, subject, dependencies, assignee.
     */
    'agent-teams/task-created': AgentTeamsTaskCreatedData
    /**
     * Records one task transition.
     * @param data - team identity, task id, and the new status/assignee/output.
     */
    'agent-teams/task-updated': AgentTeamsTaskUpdatedData
    /**
     * Records one captain-only contract amendment.
     * @param data - team identity, task id, amended field names, and reason.
     */
    'agent-teams/task-amended': AgentTeamsTaskAmendedData
    /**
     * Records one mailbox message.
     * @param data - team identity, sender, recipient, and content.
     */
    'agent-teams/message-sent': AgentTeamsMessageSentData
    /**
     * Records a human halt from the captain chat.
     * @param data - team identity and how many unfinished tasks were cancelled.
     */
    'agent-teams/team-halted': AgentTeamsTeamHaltedData
    /**
     * Records an explicit captain resume.
     * @param data - team identity and the resume reason.
     */
    'agent-teams/team-resumed': AgentTeamsTeamResumedData
    /**
     * Records one cross-workspace operation (t109).
     * @param data - actor, caller/target workspace, tool, and the single action performed.
     */
    'agent-teams/workspace-audited': AgentTeamsWorkspaceAuditedData
    /**
     * Closes one team record after deletion.
     * @param data - stable team identity.
     */
    'agent-teams/team-deleted': AgentTeamsTeamDeletedData
    /**
     * Closes a staged plan rejected during pre-run review.
     * @param data - stable team identity.
     */
    'agent-teams/plan-discarded': AgentTeamsPlanDiscardedData
  }
}

/** The full set of `agent-teams/*` event names. */
export type AgentTeamsEventType =
  | 'agent-teams/team-created'
  | 'agent-teams/member-added'
  | 'agent-teams/member-removed'
  | 'agent-teams/task-created'
  | 'agent-teams/task-updated'
  | 'agent-teams/task-amended'
  | 'agent-teams/message-sent'
  | 'agent-teams/team-halted'
  | 'agent-teams/team-resumed'
  | 'agent-teams/workspace-audited'
  | 'agent-teams/team-deleted'
  | 'agent-teams/plan-discarded'
