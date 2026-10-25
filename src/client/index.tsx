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
  FOLDERS_MAIN_KEY, PROBE_SLOT_NAME,
  noteProbeRegistrationError, noteProbeSelection, noteProbeSelectionAccepted, noteProbeSelectionError,
  ROOM_MAIN_KEY,
} from './folders-probe.tsx'
/**
 * ★★★ t111：真的**文件夹面板**（v5 第一层）。
 *   ★ 探针模块（`folders-probe.tsx`）**仍在**：它承载 key 常量与三个可读计数格子
 *     （渲染计数 / 注册错误 / 选择结果），那三格是三条反向半边的落点。
 *   ⇒ 本轮只把**组件**换掉，判据载体一个都没动。
 */
import { FoldersPanel } from './folders-panel.tsx'
/**
 * ★★★ 2026-10-22：**房间**（需求 §27）。与文件夹**并存**，不是替换 ——
 * 理由见 `folders-probe.tsx` 的 `ROOM_MAIN_KEY` 注释（11 条臂钉在 FoldersPanel 上）。
 */
import { RoomPanel } from './room-panel.tsx'
/**
 * ── ★★★ t118：这个**浏览器标签页**里是否已经为"呈现工作区"切过一次面板 ─────────────
 *
 * 存储位置的选择是这一格的全部内容（三个候选都试过）：
 *
 *   · **模块级 `let`** —— HMR 重载清空模块状态 ⇒ 每次重载都返回 false ⇒ 又切一次。
 *     ★ 那**正是**用户报的那个缺陷本身，不是它的解法。
 *   · **`localStorage`** —— 跨标签页共享 ⇒ "新开一页"读到的还是上一页留下的标记，
 *     于是新页面**永远不切**。把一个"太吵"的缺陷换成一个"太哑"的。
 *   · **`sessionStorage`** —— ★ 每个标签页一份、页面刷新保留、关掉重开为空，
 *     且 **HMR 重载不动它**。三条恰好对上"每次页面生命周期一次"。
 *
 * ★ 读不出来（无 `window` / 存储被禁用抛错）⇒ 当作**没切过**。
 *   理由：那会让面板**切过去**（多打扰一次），而不是**永久不切**（功能静默消失）。
 *   ★ 两者不对称，而取舍是刻意的 —— 能看见的过度好过看不见的缺失。
 */
const FOLDERS_SELECTED_THIS_VISIT_KEY = 'dsh-agent-teams:folders-selected:v1'

function hasSelectedPanelThisPageVisit(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(FOLDERS_SELECTED_THIS_VISIT_KEY) === '1'
  } catch {
    return false
  }
}

/** ★ 标记"这一页已经呈现过了"。写失败**不阻塞**本次呈现（能切就切，别把功能搭进去）。 */
function markPanelSelectedThisPageVisit(): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(FOLDERS_SELECTED_THIS_VISIT_KEY, '1')
  } catch {
    /* 存储不可用 ⇒ 这一页下次重载会再切一次。可接受的降级，不抛。 */
  }
}

/**
 * ★★★ t112：**常驻的「回到工作区」入口**。
 *
 * 修的是一个用户在**真实使用**里发现的缺陷：启动时文件夹页被选中（见下面那次
 * `selectPanel`），但一旦点侧边栏的 session，`activePanelId` 就变成 `conversation`,
 * ★ **之后没有任何东西能把它切回来** —— 而 `TeamChatEntry` 在非团队会话里 `return null`，
 * 顶不上这个缺。⇒ 本入口挂在 `shell.overlay`（**frame 级 + root 作用域** ⇒ 不绑会话）。
 */
import { FoldersReturnEntry, noteSelectPanelCall } from './folders-return-entry.tsx'
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
   * ── ★★★ t112：**常驻的「回到工作区」入口**（修真实缺陷）───────────────────────
   *
   * 用户原话：「我刚才从那个大的界面点击侧面的 session 到了目前的界面,
   *          但是现在**回不去那个大的界面**了」。
   *
   * ── 为什么必须是 `shell.overlay` ────────────────────────────────────────────
   *
   * 官方 SlotMap 逐字（`dsh-client-ui-layout/lib/types/client/index.d.ts:85`）：
   *
   *     'shell.overlay': { kind: 'list'; scope: 'root' }
   *
   *   · `kind: 'list'` ⇒ ★ **换一个新 `id` 就加在既有条目旁边**，不替换任何东西
   *     （所以上面那条 `agent-teams-activity` 不受影响 —— 那是 `list` 的语义，不是我猜的）；
   *   · `scope: 'root'` ⇒ ★★ **不绑会话** ⇒ 任何界面上它都在，**包括不是团队的会话**。
   *
   * ★★★ 而"任何会话里都在"正是本缺陷的要害：`TeamChatEntry` 挂在
   *   `conversation.session.header.actions` 上，且 `if (!team) return null` ——
   *   在不是团队的会话里它**不渲染**，所以它顶不上这个缺。
   *   ★ 而本入口**不接任何会话 prop**，只读根作用域的面板状态。
   *
   * ★ `order: 78`：排在活动面板（`order: 80`）**之前**（数值小者先）——
   *   浮层里条目自排；让"回入口"先出现，是"它是唯一能回去的路"这一点在顺序上的落实。
   */
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'agent-teams-folders-return',
    order: 78,
    label: 'AgentTeams return to workspaces',
    locale: AGENT_TEAMS_LOCALE_NAMESPACE,
    /**
     * ★ 只注入两格，**都不绑会话**：
     *   · `usePanelInfo` —— 根作用域的面板选择（判断"现在在不在文件夹页"）；
     *   · `selectPanel` —— 切换的**唯一出口**（生产是 `ctx.layout.selectPanel`）。
     * ★ 而这里**刻意不注入 `sessionId`** —— 那正是"常驻"的实现：
     *   一个需要会话 id 的入口，在无会话/非团队会话里就又没了。
     */
    /**
     * ★★ `usePanelInfo` 是**槽位注入的运行时面**（`PropsRuntime` 给的），不是我们自己从
     *   `ctx.layout.panelInfo` 拼的 —— 官方 `UsePanelInfo` 是一个 **hook**，
     *   而 hook 只有在 React 渲染期才存在。
     *   ⇒ 这里只注入**动作**；`usePanelInfo` 由框架按 `shell.overlay` 的 spec 送达。
     * ★ 于是本入口拿到的东西里**没有一个是会话相关的** —— 那正是它能常驻的原因。
     */
    inject: () => ({
      selectPanel: (panelId: MainPanelId | null) => {
        noteSelectPanelCall('return-entry', panelId === null ? null : String(panelId))
        ctx.layout.selectPanel(panelId)
      },
    }),
  }, FoldersReturnEntry))

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
  /**
   * ── ★★★ t111：探针 → **真的文件夹面板**（v5 第一层）───────────────────────────
   *
   * t103/t105 用这个 key 验过两件事：① 无会话时 **注册得进去**；② 调 `selectPanel`
   * 之后 **真的被渲染**。本任务把那个"只画一个标记"的探针换成**真正的工作区文件夹视图**
   * （`docs/UI-V5-SINGLE-ENTRY.md` §1–§3）。
   *
   * ★ **形状一字未改**：仍是 `{ name: 'main', key: FOLDERS_MAIN_KEY }` —— 同一个 key、
   *   同一个槽位、同一个 `inject` 空面。换的只有**组件**（`FoldersProbe` → `FoldersPanel`）。
   *   ⇒ 那两条已验的读数**仍然成立**，而本层不需要重新论证地基。
   *
   * ★★ **探针的计数器仍在**：`FoldersPanel` 每次渲染也会 `noteProbeRender` ——
   *   反向半边 A（不调 `selectPanel` ⇒ 渲染计数 = 0）靠的正是它。
   *   若这里改用别的计数载体，那条判据就失去了落点。
   *
   * ★ 注册失败**仍收进可读的格子**（理由同 t103：裸抛会被外层 catch 吞掉，
   *   而"注册失败"与"注册了但没显示"同形 —— 两者补救动作相反）。
   */
  ctx.slots.inject(PROBE_SLOT_NAME as 'main', () => {
    try {
      return ctx.slots.register({
        name: PROBE_SLOT_NAME as 'main',
        key: FOLDERS_MAIN_KEY,
        /**
         * ★ `inject` 是**类型强制**的（编译期实测：`Property 'inject' is missing`）。
         *   本面板只读**模块级**的 `/state` 快照（`activitySnapshots` 单例），
         *   不需要框架注入任何面 ⇒ 保持那个空面。
         *   ★ 而给它一个**真**面会引入"注入失败"这条与本层无关的失败路径。
         */
        /**
         * ★★★ t112（反向半边 B）：把「出去」的出口交给面板。
         *   ★ 官方：`selectPanel(null)` ⇒ 回到 Conversation。
         *   ★ 而**在这里**注入而不是让面板自己拿服务：面板保持纯表现，
         *     夹具就能注入一个记录器 ⇒ "点文件夹之后切到哪"是可编程判据。
         */
        inject: (): { openConversation: () => void } => ({
          openConversation: () => {
            noteSelectPanelCall('folder-open', null)
            ctx.layout.selectPanel(null)
          },
        }),
      }, FoldersPanel)
    } catch (error: unknown) {
      noteProbeRegistrationError(error instanceof Error ? error.message : String(error))
      return () => {}
    }
  })

  /**
   * ── ★★★ 2026-10-22：第二个 `main` key —— **房间**（需求 §27）───────────────────
   *
   * 形状与上面那个**逐字相同**（`{ name: 'main', key }` + 空 `inject` 面）：
   * 上面那一段已经用真实宿主演到过「无会话时注册得进去 / `selectPanel` 之后真的被渲染」
   * ⇒ ★ 本层**不需要重新论证地基**，只需要证明"房间也是同一个形状"。
   *
   * ★★ 它**不出现在**默认路径上：`main` 一次只显示一个 key，而"哪个 key 默认"
   *   是一个**产品决策**（要不要让房间取代文件夹页？）⇒ 见 §27.5 的待裁定。
   *   本轮只保证：**这个 key 注册得进去、且被选中时真的渲染**。
   *
   * ★ 注册失败**仍收进可读的格子** —— 与上面那个逐字同源：
   *   "注册失败"与"注册了但没显示"同形，而两者补救动作相反。
   */
  ctx.slots.inject(PROBE_SLOT_NAME as 'main', () => {
    try {
      return ctx.slots.register({
        name: PROBE_SLOT_NAME as 'main',
        key: ROOM_MAIN_KEY,
        /** ★ 房间同样是纯表现：数据来自模块级 `/state` 快照，`inject` 留空面。 */
        inject: (): { openConversation: () => void } => ({
          openConversation: () => {
            noteSelectPanelCall('room-open', null)
            ctx.layout.selectPanel(null)
          },
        }),
      }, RoomPanel)
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
    /**
     * ── ★★★ t117 / t118：**每次页面生命周期只切一次** ──────────────────────────────
     *
     * USER-REPORTED（两次，逐字）：
     * > 「是因为你一直在重启吗，怎么时不时就会被切到工作区那个页面，
     * >   很影响我在其他会话的工作，不应该时不时就切到工作区页面」
     * > 「为什么还是会不停地切到工作区，不要这样」
     *
     * ── 机制（MEASURED，不是推测）────────────────────────────────────────────────
     *
     * 本块是 `apply()` 的副作用：插件每被加载一次，就 `selectPanel(我们的 key)`。
     * 而"加载"不只发生在页面打开：
     *   `~/.dsh/profiles/desktop/cordis.patch.yml:536` 的 HMR `root: ['.']`
     *   ⇒ `lib/**` 每次被 `pnpm build` 重写后约 100ms 就重载客户端插件。
     *   实测 `.agent-teams/hmr-reloads.jsonl`：50 次重载，最小间隔 **181ms**，
     *   10 秒内连击 **28** 次。⇒ 我在另一侧敲一次构建，你这一侧就被推走一次。
     *
     * ── ★★★ t117 的第一次修法是【错的】，记在这里免得再犯 ─────────────────────────
     *
     * 第一版判据：`activePanelId === null` 时才切。理由是"null ⇒ 用户不在任何面板上"。
     * ★★ 而 `service.d.ts:18` 逐字：`null displays the current Conversation` ——
     *   **`null` 恰恰是"用户正在会话里"**，也就是**最常见**的状态。
     *   ⇒ 这个守卫在最常见的场景下**恰好放行**，等于没修。
     *   用户复测当场打回：「为什么还是会不停地切」。
     *
     * ── ★ 正确的判据是【页面生命周期】，不是【面板位置】──────────────────────────
     *
     * 用户要的是"打开页面时给我看一眼工作区，之后别再来打扰我"。
     * 那件事的对象是**这个浏览器标签页**，而它的真值是 `sessionStorage`：
     *   · 每个**标签页**一份，刷新页面 ⇒ 还在（不重复切）；
     *   · **关掉标签页再开** ⇒ 空（该给的那一眼还是给）；
     *   · HMR 重载 ⇒ **不动它**（那正是我们要的：重载 ≠ 新的一页）。
     *
     * ★★ 为什么不是模块级 `let firstLoad = true`：HMR 重载会把模块状态全清，
     *   于是每次重载都是 `true` ⇒ 又切一次。**那正是本缺陷本身**，不是它的解法。
     * ★ 为什么不是 `localStorage`：它跨标签页共享，"新开一页"就读不到"这是新的一页"。
     *
     * ── ★ 反向半边（这一格不许被收紧成"永不切"）────────────────────────────────
     *
     * 首次打开**仍然要切** —— 那是 v5 的设计（文件夹页就是入口）。
     * ⇒ 臂 14 断言：没有标记时**必须**调 `selectPanel` 并**写下**标记；
     *   有标记时**必须不调**。两半都要绿，否则修法就变成了"把功能删掉"。
     */
    noteProbeSelection(FOLDERS_MAIN_KEY)
    if (!hasSelectedPanelThisPageVisit()) {
      markPanelSelectedThisPageVisit()
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
    }
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
