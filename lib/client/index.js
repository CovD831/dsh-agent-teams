import { jsx as _jsx } from "react/jsx-runtime";
import { ActivitySurface, WorkspaceActivity, createWorkspaceBridge, TEAM_TAB_ID, TEAM_TAB_KIND } from "./WorkspaceActivity.js";
import { RosterSettingsSurface } from "./roster-settings.js";
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots } from "./activity-monitor.js";
import { TeamChatEntry, TeamTurnCard } from "./TeamChatEntry.js";
import { SessionIdAction } from "./SessionIdAction.js";
import { FOLDERS_MAIN_KEY, PROBE_SLOT_NAME, noteProbeRegistrationError, noteProbeSelection, noteProbeSelectionAccepted, noteProbeSelectionError, } from "./folders-probe.js";
/**
 * ★★★ t111：真的**文件夹面板**（v5 第一层）。
 *   ★ 探针模块（`folders-probe.tsx`）**仍在**：它承载 key 常量与三个可读计数格子
 *     （渲染计数 / 注册错误 / 选择结果），那三格是三条反向半边的落点。
 *   ⇒ 本轮只把**组件**换掉，判据载体一个都没动。
 */
import { FoldersPanel } from "./folders-panel.js";
/**
 * ★★★ t112：**常驻的「回到工作区」入口**。
 *
 * 修的是一个用户在**真实使用**里发现的缺陷：启动时文件夹页被选中（见下面那次
 * `selectPanel`），但一旦点侧边栏的 session，`activePanelId` 就变成 `conversation`,
 * ★ **之后没有任何东西能把它切回来** —— 而 `TeamChatEntry` 在非团队会话里 `return null`，
 * 顶不上这个缺。⇒ 本入口挂在 `shell.overlay`（**frame 级 + root 作用域** ⇒ 不绑会话）。
 */
import { FoldersReturnEntry, noteSelectPanelCall } from "./folders-return-entry.js";
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
    }, SessionIdAction));
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'agent-teams-activity',
        order: 80,
        label: 'AgentTeams activity',
        locale: AGENT_TEAMS_LOCALE_NAMESPACE,
    }, Panel));
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
            selectPanel: (panelId) => {
                noteSelectPanelCall('return-entry', panelId === null ? null : String(panelId));
                ctx.layout.selectPanel(panelId);
            },
        }),
    }, FoldersReturnEntry));
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
    ctx.slots.inject(PROBE_SLOT_NAME, () => {
        try {
            return ctx.slots.register({
                name: PROBE_SLOT_NAME,
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
                inject: () => ({
                    openConversation: () => {
                        noteSelectPanelCall('folder-open', null);
                        ctx.layout.selectPanel(null);
                    },
                }),
            }, FoldersPanel);
        }
        catch (error) {
            noteProbeRegistrationError(error instanceof Error ? error.message : String(error));
            return () => { };
        }
    });
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
         * ── ★★★ t117：**只有在用户此刻不在别处时**才把面板切过来 ──────────────────────
         *
         * USER-REPORTED（逐字）：
         * > 「是因为你一直在重启吗，怎么时不时就会被切到工作区那个页面，
         * >   很影响我在其他会话的工作，不应该时不时就切到工作区页面」
         *
         * ── 根因（MEASURED，本轮）──────────────────────────────────────────────────
         *
         * 本块是 `apply()` 里的**无条件**副作用：只要本插件被加载，就 `selectPanel(我们的 key)`。
         * 而加载不只发生在"页面打开"：
         *   · `~/.dsh/profiles/desktop/cordis.patch.yml:530` 的 HMR `root: ['.']`
         *     ⇒ `lib/**` 每次被 `pnpm build` 重写后 100ms 就重载客户端插件
         *     （`.agent-teams/hmr-reloads.jsonl` 实测 50 次重载，最小间隔 **181ms**，
         *      10 秒内连击 **28** 次）；
         *   · 每次重载 `apply()` 重跑 ⇒ 又一次无条件 `selectPanel`。
         * ⇒ **用户正在别的会话里打字，插件的重建把我这侧的面板推到他眼前。**
         *   而官方 `ILayout.selectPanel(panelId: MainPanelId | null)` 的语义是
         *   "**用户想切换到某个面板**" —— 没人想切，却被切了。
         *
         * ── ★ 判据：只在 `activePanelId === null` 时切 ─────────────────────────────
         *
         * `PanelInfo`（`dsh-client-ui-layout/lib/types/client/service.d.ts:17`）逐字：
         *   `readonly activePanelId: MainPanelId | null;`
         *   `null` ⇒ **显示当前会话**（Conversation）。
         *
         * 所以：
         *   · `activePanelId === null`  ⇒ 用户没在任何面板上 ⇒ 切过去是**首次呈现**，保留；
         *   · `activePanelId !== null`  ⇒ 用户**正站在某个面板上**（可能是本插件的文件夹页，
         *     也可能是别的插件的面板）⇒ **一个字都不动**。
         *
         * ★ 反向半边（为什么不是"只在首次加载时切"）：本插件拿不到"这是第几次加载"
         *   —— HMR 重载后模块状态全清，`let firstLoad = true` 每次都是 `true`。
         *   而 `activePanelId` 是**宿主**的状态，重载不会重置它 ⇒ 它才是"用户此刻在哪"的真值。
         */
        noteProbeSelection(FOLDERS_MAIN_KEY);
        const currentPanel = ctx.layout.panelInfo?.getSnapshot?.()?.activePanelId ?? null;
        if (currentPanel === null) {
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
            const probePanelId = FOLDERS_MAIN_KEY;
            ctx.layout.selectPanel(probePanelId);
            noteProbeSelectionAccepted();
        }
    }
    catch (error) {
        noteProbeSelectionError(error instanceof Error ? error.message : String(error));
    }
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
