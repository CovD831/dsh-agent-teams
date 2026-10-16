/** Browser plugin for the AgentTeams activity floater and conversation card. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the official browser locale service into ClientContext.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Conversation folding is target-neutral; keyed Chat rendering is owned by
// ui-chat, whose declaration is loaded above.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// The frame-level overlay is declared by ui-layout. This import is type-only;
// ctx.slots.inject below owns the runtime wait for the declaration.
import type { MainPanelId, UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
// Official model catalog/directory service. The staged roster reads its
// provider/model/effort metadata without mutating the captain's own selection.
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { ActivitySurface, WorkspaceActivity, createWorkspaceBridge, TEAM_TAB_ID, TEAM_TAB_KIND } from './WorkspaceActivity.tsx'
import { RosterSettingsSurface } from './roster-settings.tsx'
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots } from './activity-monitor.ts'
import { TeamChatEntry, TeamTurnCard } from './TeamChatEntry.tsx'
import { SessionIdAction } from './SessionIdAction.tsx'
import {
  FOLDERS_MAIN_KEY, FoldersProbe, PROBE_SLOT_NAME,
  noteProbeRegistrationError, noteProbeSelection, noteProbeSelectionAccepted, noteProbeSelectionError,
} from './folders-probe.tsx'
import { createWorkspaceState } from './workspace-state.ts'
import { AgentTeamsCard, type AgentTeamsCardInjected } from './AgentTeamsCard.tsx'
import { agentTeamsCardDefinition } from './agent-teams-card-definition.ts'
import {
  AGENT_TEAMS_LOCALE_NAMESPACE, en, zh, type AgentTeamsLocaleKey,
} from './locales.ts'
import { openAgentTeamMember, type AgentTeamsLayoutNavigator, type AgentTeamsWorkspaceNavigator } from './session-navigation.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** AgentTeams conversation card and activity monitor copy. */
    agentTeams: AgentTeamsLocaleKey
  }
}

/** Required services: conversation nodes, slots, sessions navigation, and locale. */
export const inject = ['uiConversation', 'slots', 'sessions', 'locale', 'modelDirectories', 'layout']

/**
 * ── ★★★ t20：花名册表面的 tab key ────────────────────────────────────────────
 *
 * ★ 它与 `TEAM_TAB_ID` **不同的一个 key**：两个表面回答两个不同的问题
 *   （"这个队在干什么" / "这些身份用什么模型"）。
 * ★ 而 key 里**不含**任何 slot 名 ——
 *   这个表面挂的是 `sidebar.right.pane.tab`，而那个 slot **真实存在**
 *   （本文件在 :103 已经注册过它）。
 */
export const ROSTER_SETTINGS_TAB_ID = '@nanmicoder/dsh-agent-teams/roster'

/** The host supplies this hook for the lifetime of a 0.1.5 root slot. */
interface PanelNavigationProps {
  usePanelInfo?: UsePanelInfo
}
const useLegacyPanelInfo: UsePanelInfo = select => select({ activePanelId: null })

/** The replayed user message is the canonical transcript entry. */
function HiddenAgentTeamsCommand(): null {
  return null
}

/**
 * Register the activity monitor in the shell's additive overlay and the
 * in-conversation team card. The card's activity button re-opens a folded
 * monitor via a window event — the recovery path for an old session.
 */
export function apply(ctx: ClientContext): void {
  const bridge = createWorkspaceBridge()
  const state = createWorkspaceState()
  ctx.effect(
    () => ctx.locale.register(AGENT_TEAMS_LOCALE_NAMESPACE, { zh, en }),
    'agent-teams: dictionaries',
  )
  const openMember = (parentId: SessionId, childId: SessionId): void => {
    void openAgentTeamMember(ctx.sessions, parentId, childId, ctx.layout as AgentTeamsLayoutNavigator, ctx.get('uiWorkspace') as AgentTeamsWorkspaceNavigator | undefined).catch((error: unknown) => {
      console.warn(`agent-teams: failed to open member transcript ${childId}: ${String(error)}`)
    })
  }
  const Panel = ({ t, usePanelInfo }: PropsLocale<'agentTeams'> & PanelNavigationProps) => {
    // A host's standard hook set is fixed for this mounted plugin instance.
    const usePanel = usePanelInfo ?? useLegacyPanelInfo
    const conversationVisible = usePanel(panel => panel.activePanelId === null)
    return (
    <ActivitySurface
      bridge={bridge}
      state={state}
      conversationVisible={conversationVisible}
      sessionsList={ctx.sessions.list}
      modelDirectories={ctx.modelDirectories}
      openMember={openMember}
      t={t}
    />
    )
  }
  // Optional service scope keeps legacy hosts working and removes every native
  // contribution when the host provider disappears (including HMR).
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (native) => {
    const t = native.locale.bind(AGENT_TEAMS_LOCALE_NAMESPACE)
    native.effect(() => native.sidebarRightTabs.register({
      id: TEAM_TAB_ID, kind: TEAM_TAB_KIND,
      title: () => t('workspace.title'),
    }))
    native.slots.inject('conversation.session.header.actions', () => native.slots.register({
      name: 'conversation.session.header.actions', id: 'agent-teams-entry', order: 50,
      locale: AGENT_TEAMS_LOCALE_NAMESPACE,
    }, TeamChatEntry))
    native.slots.inject('conversation.chat.turnTail', () => native.slots.register({
      name: 'conversation.chat.turnTail', id: 'agent-teams-summary', order: 50,
      locale: AGENT_TEAMS_LOCALE_NAMESPACE,
      inject: () => ({ openMember }),
    }, TeamTurnCard))
    native.slots.inject('sidebar.right.pane.tab', () => {
      const dispose = native.slots.register({
        name: 'sidebar.right.pane.tab', key: TEAM_TAB_ID,
        locale: AGENT_TEAMS_LOCALE_NAMESPACE,
        inject: () => ({ state, modelDirectories: native.modelDirectories, openMember }),
      }, WorkspaceActivity)
      bridge.set(native.sidebarRight)
      return () => { bridge.set(undefined); dispose() }
    })
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
    }, RosterSettingsSurface))
  })

  /**
   * ── ★★★ 会话 ID 复制按钮（2026-10-12）────────────────────────────────────────
   *
   * ★ 它注册在**可选服务作用域之外**，而这不是风格问题：
   *   上面那一块整体挂在 `ctx.inject(['sidebarRight', 'sidebarRightTabs'], …)` 里，
   *   于是宿主一旦不提供侧边栏，**那一块里的每一格都会消失**。
   *   而"复制会话 ID"与侧边栏**没有任何关系** —— 它只需要 `slots`（必选服务）
   *   与框架按 `scope: 'session'` 注入的 `sessionId`。
   *   ⇒ 放进那个作用域会让一个**与本功能无关**的宿主差异把它一起摘掉。
   *
   * ★ 用 `utilities` 而不是 `actions`：`actions` 是标题旁的会话动作
   *   （"查看团队"在那里），`utilities` 是右对齐的工具区。
   *   会话 ID 是**关于这个会话的元信息**，不是"这个会话里有什么"。
   *
   * ★ `order: 90` 让它排在团队入口（`order: 50`）**之后** ——
   *   团队入口是内容，ID 是元信息；内容在前、元信息在后，扫读顺序才对。
   */
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'agent-teams-session-id', order: 90,
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
  }, SessionIdAction))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'agent-teams-activity',
    order: 80,
    label: 'AgentTeams activity',
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
  }, Panel))

  /**
   * ── ★★★ t103 最小实验①：注册一个**不绑会话**的 `main` key ────────────────────
   *
   * ── 它验的是什么（v5 方案的地基，`docs/UI-V5-SINGLE-ENTRY.md` §0）──────────────
   *
   * 官方有**两条**说明，而它们说的是**不同的槽位** —— 哪一条管我们，只有跑一次才知道：
   *
   *   ① `dsh-client-ui-sidebar-right`：「**No surface without a session.**」
   *      ⇒ ★ 说的是 **rightbar**
   *   ② `dsh-client-ui-layout` 的 `'main'` SlotMap：
   *      「The reserved `conversation` key hosts the Conversation;
   *        ★ **other keys receive no Session binding.**」
   *      ⇒ ★ 说的是 **main**
   *
   * ── ★ 形状照抄官方先例，不自造 ─────────────────────────────────────────────────
   *
   * `dsh-client-ui-plugin-manager` 是一个**活着的先例**（非会话面板）：
   *
   *     yield ctx.slots.register({ name: "main", key: PANEL_ID, locale: NS, store, inject, children })
   *     ctx.layout.selectPanel(PANEL_ID)      // ← 激活
   *
   * ⇒ 本探针用同一个形状：`{ name: 'main', key: ... }`。
   *   ★ 而 `'main'` 的 spec 实测是 `{ kind: 'keyed', scope: 'root' }`
   *     —— **keyed** ⇒ 可以多 key；**scope: 'root'** ⇒ 不绑会话。
   *
   * ── ★ 本注册**不画界面**（硬边界）──────────────────────────────────────────────
   *
   * 它渲染的只是一个**可编程可辨识**的标记，且每次渲染都会给一个**进程内计数器**加一
   * ⇒ "无会话时出不出现"变成 `probeRenderCount(key) > 0` 这个**可读的布尔**，
   *   而不是"截个图看看"（本机没有视觉模型）。
   *
   * ★ 注册失败**不抛出去**：把错误收进一个可读的格子里。
   *   抛出去会被外层的 catch 吞掉，而"注册失败"与"注册了但没显示"**同形** ——
   *   而那正是本实验要分开的两个态（补救动作相反：前者改方案，后者换槽位）。
   */
  ctx.slots.inject(PROBE_SLOT_NAME as 'main', () => {
    try {
      return ctx.slots.register({
        name: PROBE_SLOT_NAME as 'main',
        key: FOLDERS_MAIN_KEY,
        /**
         * ★ `inject` 是**类型强制**的（编译期实测：`Property 'inject' is missing`）。
         *   本实验不需要向组件传任何东西 ⇒ 给一个空面。
         *   ★ 而给它一个**真**面会引入"注入失败"这条与实验无关的失败路径。
         */
        inject: (): Record<string, never> => ({}),
      }, FoldersProbe)
    } catch (error: unknown) {
      noteProbeRegistrationError(error instanceof Error ? error.message : String(error))
      return () => {}
    }
  })

  /**
   * ── ★★★ t105 最小实验①b：调【公开写入口】`selectPanel`，补上最后一跳 ──────────
   *
   * t103 实测：我们的 key **注册成功**（真的占了 cell）但**默认不被选中** ——
   * 因为官方 `MainPanel` 逐字 `entryKey = activePanelId ?? "conversation"`，
   * 而 `activePanelId` 的初值是 `null`。
   *
   * ★ 而官方**给了写入口**（`ctx.layout`，本插件**已经注入**，见 `inject` 的 `'layout'`）：
   *
   *     LayoutController.selectPanel(panelId)                      // client.js:462
   *       if (panelId !== null && !hasMainPanel(panelId)) throw …  //   自己的守卫
   *       this.panels.selectPanel(panelId)                         //   ⇒ activePanelId = panelId
   *
   * ⇒ ★ 本步就是问：**调了之后，它真的被渲染吗？**
   *
   * ── ★★ 两条刻意的不变量（它们就是两条反向半边）──────────────────────────────
   *
   *   ① ★ **不改默认**：本调用是**显式**的，不是把 `activePanelId` 的初值改掉。
   *      ⇒ 若把默认改成我们的 key，"默认也渲染"与"调了才渲染"就**同形**了 ——
   *        而 t103 实测的默认是 `conversation`，那条读数必须**仍然成立**。
   *   ② ★ **调用点唯一**：只在这里调一次 ⇒ 让"渲染计数 > 0"能**归因**到这一次选择，
   *      而不是"页面上某处在渲染它"。
   *
   * ★ 调失败**不裸抛**：收进可读的格子（理由同上面的注册 —— 裸抛会被外层 catch 吞掉，
   *   而"选择被拒"与"没选"**同形**，两者补救动作相反）。
   */
  try {
    noteProbeSelection(FOLDERS_MAIN_KEY)
    /**
     * ★ `selectPanel` 收的是**品牌类型** `MainPanelId`（`= string & { readonly [BRAND]: 'MainPanelId' }`），
     *   不是裸 `string` —— 编译期实测报错：`Argument of type 'string' is not assignable to MainPanelId`。
     *
     * ★★ 官方给的构造器是 `brandString<T>()`（`@deepseek-ai/dsh-brand`），
     *   但那个包**不是本插件的依赖**（实测：从本包 `require.resolve` ⇒ 解析失败），
     *   且本任务**零新依赖** ⇒ 不引它。
     *
     * ⇒ 这里用**类型层**的断言把品牌补上：**运行期零成本**（品牌只存在于类型里，
     *   `MainPanelId` 的值就是那个字符串），且**不引入任何 import**。
     * ★ 这不是"绕过类型" —— 品牌在这里的**唯一**作用就是挡住"随手传一个错 id"，
     *   而我们这个 id 与 `slots.register` 用的是**同一个常量** ⇒ 不可能漂移。
     */
    const probePanelId = FOLDERS_MAIN_KEY as unknown as MainPanelId
    ctx.layout.selectPanel(probePanelId)
    noteProbeSelectionAccepted()
  } catch (error: unknown) {
    noteProbeSelectionError(error instanceof Error ? error.message : String(error))
  }

  // The host command is only the slash-menu/admission surface. Its input is
  // replayed as the visible user message, so the generic result row would be
  // a duplicate placed before that message by command lifecycle ordering.
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'agent-teams',
  }, HiddenAgentTeamsCommand))

  ctx.uiConversation.events.register(agentTeamsCardDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'agent-teams',
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
    inject: (): AgentTeamsCardInjected => ({
      openMember, workspaceBridge: bridge,
    }),
  }, AgentTeamsCard))
}
