/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a shell-overlay
 * panel that docks at the conversation's top-right edge by default, can be
 * dragged into a floating window, resized, and folded into an activity badge.
 * On wide viewports the docked panel makes the conversation column yield
 * space; narrow viewports keep a simple inset overlay. It
 * polls the host `/plugins/dsh-agent-teams/state` route for
 * server-side snapshots (durable files + live subagent activity), with a
 * collapsed badge that auto-expands once when activity appears. Archived
 * teams stay available for the owning conversation after live work ends.
 *
 * The floater mounts in ui-layout's additive `shell.overlay`; it is not a
 * conversation node — the in-conversation panel was removed in favor of this
 * always-available monitor.
 * @module dsh-agent-teams/client/activity
 */
import type { ModelDirectory, ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import { type ActivityTeam } from './activity-monitor.ts';
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts';
import type { AgentTeamsTranslate } from './locales.ts';
/**
 * ── ★★★ R2：这几段读数**搬进了 `MemberRow.tsx`** ────────────────────────────────
 *
 * `memberStateLabel` / `memberStatusText` / `memberDotTone` 原来长在这里，
 * 而它们全部是**关于一行成员**的读数。R2 把成员行变成一个真正的组件
 * （`src/client/MemberRow.tsx`）之后，它们跟着那一行走 —— 留在面板里就成了
 * 第二份实现，而本仓对"第二份实现"的判据是：它一定会漂移。
 *
 * ★ 一行只应有一个"它在做什么"的口径，所以这里**不留**转发壳。
 */
export declare function TeamSection({ team, modelDirectory, onContinuePlanning, onDiscarded, onNavigate, t, historic, workspace }: {
    readonly team: ActivityTeam;
    readonly modelDirectory?: ModelDirectory;
    readonly onContinuePlanning?: () => void;
    readonly onDiscarded?: () => void;
    /** Navigate to a member transcript (floater hides immediately). */
    readonly onNavigate: (parentId: SessionId, childId: SessionId) => void;
    readonly t: AgentTeamsTranslate;
    readonly historic?: boolean;
    readonly workspace?: boolean;
}): import("react").JSX.Element;
/** Legacy conversation cards may outlive their host archive. Project their
 * durable roster through the same rebuilt panel instead of a second UI. */
export declare function historicCardTeam(data: AgentTeamsCardData, owner: string): ActivityTeam;
/** The top-right activity floater. Teams follow the current session: live
 * snapshots and historic card summaries are only shown while their captain
 * session is the one currently open. */
export type ActivityPanelProps = {
    readonly conversationVisible?: boolean;
    readonly sessionsList: ObservableSnapshot<SessionListState>;
    readonly modelDirectories: ModelDirectoryResolver;
    readonly openMember: (parentId: SessionId, childId: SessionId) => void;
} & PropsLocale<'agentTeams'>;
export declare function ActivityPanel({ sessionsList, modelDirectories, openMember, t, conversationVisible }: ActivityPanelProps): import("react").JSX.Element | null;
