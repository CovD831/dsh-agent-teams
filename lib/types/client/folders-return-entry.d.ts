/**
 * ── ★★★ t112：**常驻的「回文件夹」入口**（修一个真实使用中发现的缺陷）──────────────
 *
 * 用户原话（逐字）：
 * > 「我刚才从那个大的界面点击侧面的 session 到了目前的界面,
 * >   但是现在**回不去那个大的界面**了」
 *
 * ── 根因（MEASURED，`src/client/index.tsx:302`）────────────────────────────────
 *
 * `ctx.layout.selectPanel(FOLDERS_MAIN_KEY)` **在一个启动期的 effect 里只调一次**：
 *   · 启动时它把文件夹页选中 ⇒ 你看得见；
 *   · 一旦点了侧边栏的 session ⇒ `activePanelId` 被改成 `conversation`；
 *   · ★★ **之后没有任何东西能把它切回来**。
 *
 * 而既有的入口都不顶用：`TeamChatEntry` 在**不是团队**的会话里
 * `if (!team) return null` ⇒ 它**不渲染**。
 * ⇒ ★ 所以缺的是一个"**任何会话里都在**"的回入口。
 *
 * ── ★★ 为什么放在 `shell.overlay` ──────────────────────────────────────────────
 *
 * 官方 SlotMap 逐字（`dsh-client-ui-layout/lib/types/client/index.d.ts:85`）：
 *
 *     'shell.overlay': { kind: 'list'; scope: 'root' }
 *
 *   · `kind: 'list'` ⇒ ★ **换一个新 `id` 就加在既有条目旁边**，不替换任何东西；
 *   · `scope: 'root'` ⇒ ★★ **不绑会话** ⇒ 任何界面上它都在。
 * ★ 而它是 frame 级浮层：`entries opt back into pointer events` ⇒ 本入口自己开 `pointer-events`。
 *
 * ── ★★★ 判据必须是【可编程的】（本机没有视觉模型）──────────────────────────────
 *
 * 所以本文件导出两样东西：
 *   ① 一个**进程内调用账本**（`noteSelectPanelCall` / `selectPanelLog`）——
 *      每次点入口都记一条 ⇒ "点了之后切没切回去"是**可数的**，不是截图的；
 *   ② 一个**纯函数** `returnEntryView()` —— 把"现在在哪个面板"折成"入口该显示成什么"，
 *      于是"在文件夹页时它该不该显示"也能在没有浏览器的地方判。
 *
 * ★ 本入口**只做一件事**：把面板切回文件夹页。它不改任何既有视图
 *   （`TeamChatEntry` 一行未动 —— 它"只在有队时显示"是**对的**）。
 * @module dsh-agent-teams/client/folders-return-entry
 */
import type { MainPanelId, UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client';
/** One recorded `selectPanel` call, in order. */
export interface SelectPanelCall {
    /** The panel id passed to `selectPanel`; `null` means "back to the conversation". */
    readonly panelId: string | null;
    /**
     * Where the call came from — ★ **每一条路线都必须可区分**。
     *
     * ★★ `room-open` 是 2026-10-22 加的（需求 §27 的房间页）：房间页的"回会话"出口
     *   与文件夹页的那一条**不是同一条路线**（它们是两个 `main` key）。
     *   ⇒ 合成 `folder-open` 会让"从房间出去了"与"从文件夹出去了"在账本上同形，
     *     而两者的补救动作不同（前者说明房间页可用，后者说明文件夹页还在）。
     */
    readonly from: 'return-entry' | 'folder-open' | 'room-open';
}
/** ★ 记一次调用（两个入口共用这一个账本 —— 它们的**方向**不同，靠 `from` 分开）。 */
export declare function noteSelectPanelCall(from: SelectPanelCall['from'], panelId: string | null): void;
/** ★ 读账本（副本 ⇒ 夹具读完之后别人再点也不会改它当时看到的那个数组）。 */
export declare function selectPanelLog(): readonly SelectPanelCall[];
/** ★ 清空（夹具每条臂开始时复位，避免臂与臂互相污染）。 */
export declare function resetSelectPanelLog(): void;
/**
 * ── ★★ 入口的三态（**两两不同形**）──────────────────────────────────────────────
 *
 *   · `'show'`     —— 当前**不在**文件夹页 ⇒ 显示「回到工作区」；
 *   · `'hidden'`   —— 当前**就在**文件夹页 ⇒ 不显示（在文件夹页里再给一个"回文件夹"是噪音）；
 *   · `'unknown'`  —— 读不到 `activePanelId` ⇒ ★ **仍然显示**。
 *
 * ★★ 为什么 `'unknown'` 也显示：这个入口是**唯一能回去的路**。
 *   "读不到面板状态"时**藏起**它，会让一个读数缺失直接变成一次**不可用** ——
 *   而那与"这个功能没做"在用户眼里完全同形。
 *   ⇒ 宁可多显示一个按钮（代价：一点视觉噪音），也不可让用户无路可回。
 *
 * @param activePanelId - the currently selected main panel; `undefined` = unreadable.
 * @returns which of the three states the entry is in.
 */
export declare function returnEntryState(activePanelId: string | null | undefined): 'show' | 'hidden' | 'unknown';
/**
 * One-line summary for the entry's own label (also the `data-` probe value).
 * @param state - the tri-state from {@link returnEntryState}.
 */
export declare function returnEntryLabel(state: 'show' | 'hidden' | 'unknown'): string;
/** What the entry needs from the host. */
export interface FoldersReturnEntryProps {
    readonly usePanelInfo: UsePanelInfo;
    /** ★ 切换的**唯一**出口（生产是 `ctx.layout.selectPanel`；夹具注入一个记录器）。 */
    readonly selectPanel: (panelId: MainPanelId | null) => void;
}
/**
 * ── ★★★ 常驻的「回到工作区」入口 ────────────────────────────────────────────────
 *
 * ★ **不接任何会话 prop** —— 那正是它能"在任何会话里都在"的原因。
 *   它只读**根作用域**的面板状态（`usePanelInfo`），而那与当前是哪个会话无关。
 *
 * ★ 每个渲染都落一个读数：`data-folders-return` / `-state` / `-hits`
 *   ⇒ "它出没出现、被点了几次"都是**可编程判据**。
 */
export declare function FoldersReturnEntry({ usePanelInfo, selectPanel }: FoldersReturnEntryProps): JSX.Element | null;
