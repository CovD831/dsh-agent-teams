import { jsx as _jsx } from "react/jsx-runtime";
import { ActivitySurface, WorkspaceActivity, createWorkspaceBridge, TEAM_TAB_ID, TEAM_TAB_KIND } from "./WorkspaceActivity.js";
import { RosterSettingsSurface } from "./roster-settings.js";
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots } from "./activity-monitor.js";
import { TeamChatEntry, TeamTurnCard } from "./TeamChatEntry.js";
import { createWorkspaceState } from "./workspace-state.js";
import { AgentTeamsCard } from "./AgentTeamsCard.js";
import { agentTeamsCardDefinition } from "./agent-teams-card-definition.js";
import { AGENT_TEAMS_LOCALE_NAMESPACE, en, zh, } from "./locales.js";
import { openAgentTeamMember } from "./session-navigation.js";
/** Required services: conversation nodes, slots, sessions navigation, and locale. */
export const inject = ['uiConversation', 'slots', 'sessions', 'locale', 'modelDirectories', 'layout'];
/**
 * ── ★★★ t20：花名册表面的 tab key ────────────────────────────────────────────
 *
 * ★ 它与 `TEAM_TAB_ID` **不同的一个 key**：两个表面回答两个不同的问题
 *   （"这个队在干什么" / "这些身份用什么模型"）。
 * ★ 而 key 里**不含**任何 slot 名 ——
 *   这个表面挂的是 `sidebar.right.pane.tab`，而那个 slot **真实存在**
 *   （本文件在 :103 已经注册过它）。
 */
export const ROSTER_SETTINGS_TAB_ID = '@nanmicoder/dsh-agent-teams/roster';
const useLegacyPanelInfo = select => select({ activePanelId: null });
/** The replayed user message is the canonical transcript entry. */
function HiddenAgentTeamsCommand() {
    return null;
}
/**
 * Register the activity monitor in the shell's additive overlay and the
 * in-conversation team card. The card's activity button re-opens a folded
 * monitor via a window event — the recovery path for an old session.
 */
export function apply(ctx) {
    const bridge = createWorkspaceBridge();
    const state = createWorkspaceState();
    ctx.effect(() => ctx.locale.register(AGENT_TEAMS_LOCALE_NAMESPACE, { zh, en }), 'agent-teams: dictionaries');
    const openMember = (parentId, childId) => {
        void openAgentTeamMember(ctx.sessions, parentId, childId, ctx.layout, ctx.get('uiWorkspace')).catch((error) => {
            console.warn(`agent-teams: failed to open member transcript ${childId}: ${String(error)}`);
        });
    };
    const Panel = ({ t, usePanelInfo }) => {
        // A host's standard hook set is fixed for this mounted plugin instance.
        const usePanel = usePanelInfo ?? useLegacyPanelInfo;
        const conversationVisible = usePanel(panel => panel.activePanelId === null);
        return (_jsx(ActivitySurface, { bridge: bridge, state: state, conversationVisible: conversationVisible, sessionsList: ctx.sessions.list, modelDirectories: ctx.modelDirectories, openMember: openMember, t: t }));
    };
    // Optional service scope keeps legacy hosts working and removes every native
    // contribution when the host provider disappears (including HMR).
    ctx.inject(['sidebarRight', 'sidebarRightTabs'], (native) => {
        const t = native.locale.bind(AGENT_TEAMS_LOCALE_NAMESPACE);
        native.effect(() => native.sidebarRightTabs.register({
            id: TEAM_TAB_ID, kind: TEAM_TAB_KIND,
            title: () => t('workspace.title'),
        }));
        native.slots.inject('conversation.session.header.actions', () => native.slots.register({
            name: 'conversation.session.header.actions', id: 'agent-teams-entry', order: 50,
            locale: AGENT_TEAMS_LOCALE_NAMESPACE,
        }, TeamChatEntry));
        native.slots.inject('conversation.chat.turnTail', () => native.slots.register({
            name: 'conversation.chat.turnTail', id: 'agent-teams-summary', order: 50,
            locale: AGENT_TEAMS_LOCALE_NAMESPACE,
            inject: () => ({ openMember }),
        }, TeamTurnCard));
        native.slots.inject('sidebar.right.pane.tab', () => {
            const dispose = native.slots.register({
                name: 'sidebar.right.pane.tab', key: TEAM_TAB_ID,
                locale: AGENT_TEAMS_LOCALE_NAMESPACE,
                inject: () => ({ state, modelDirectories: native.modelDirectories, openMember }),
            }, WorkspaceActivity);
            bridge.set(native.sidebarRight);
            return () => { bridge.set(undefined); dispose(); };
        });
        /**
         * ── ★★★ t20：花名册 / 成员模型一览 —— 挂在**同一个**已存在的 slot 上 ──────────
         *
         * ★ 用的是 `sidebar.right.pane.tab`（本文件第 :103 处已经注册过的那一个），
         *   而**不是**那个被借来的 settings 分区槽位 —— 后者在**本依赖树里不存在**
         *   （实测：在 node_modules/@deepseek-ai/ 下 grep 该槽位名零命中，
         *    `SlotMap` 按设计声明为空，`@linxin666` 也不在 store 里）。
         *   ★ 挂在一个不存在的 slot 上的表面**永远不会被渲染**，
         *     而那与"没做这个功能"在用户眼里完全同形。
         *
         * ★ 为什么另起一个 `key` 而不是塞进 `WorkspaceActivity`：两个表面回答**两个不同的问题**
         *   （"这个队在干什么" / "这些身份用什么模型"）。合成一个会让其中一个
         *   在另一个的加载态里消失 —— 而"看不见"与"没有数据"又会同形。
         */
        native.slots.inject('sidebar.right.pane.tab', () => native.slots.register({
            name: 'sidebar.right.pane.tab', key: ROSTER_SETTINGS_TAB_ID,
            locale: AGENT_TEAMS_LOCALE_NAMESPACE,
            inject: () => ({ snapshots: getActivitySnapshotsSnapshot, subscribe: subscribeActivitySnapshots }),
        }, RosterSettingsSurface));
    });
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'agent-teams-activity',
        order: 80,
        label: 'AgentTeams activity',
        locale: AGENT_TEAMS_LOCALE_NAMESPACE,
    }, Panel));
    // The host command is only the slash-menu/admission surface. Its input is
    // replayed as the visible user message, so the generic result row would be
    // a duplicate placed before that message by command lifecycle ordering.
    ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
        name: 'conversation.chat.commandview',
        key: 'agent-teams',
    }, HiddenAgentTeamsCommand));
    ctx.uiConversation.events.register(agentTeamsCardDefinition);
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
        name: 'conversation.chat.node',
        key: 'agent-teams',
        locale: AGENT_TEAMS_LOCALE_NAMESPACE,
        inject: () => ({
            openMember, workspaceBridge: bridge,
        }),
    }, AgentTeamsCard));
}
