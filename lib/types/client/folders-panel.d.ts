/**
 * ── ★★★ v5 第一层：**文件夹 = 工作区**（`docs/UI-V5-SINGLE-ENTRY.md` §1–§3）─────────
 *
 * 用户裁定（逐字）：「前端首先做一个**统一入口**,呈现出来类似于**一个文件夹的形式,
 * 一个文件夹就相当于一个工作区**」；「风格可以往**像素风**上做（因为像素风比较好做）」。
 *
 * ── ★★ 本文件的形状：**纯函数在前、组件在后** ────────────────────────────────────
 *
 * 判据必须【可编程】（本机没有视觉模型）⇒ "画对了没有"要落成**可读的数据形状**：
 *   · `foldersFromSnapshots()` —— 从 `/state` 的 teams 聚合出工作区列表（纯函数）；
 *   · `FoldersPanel` —— 把那个列表画成像素风文件夹（每次渲染落一个可读的 `data-*` 读数）。
 *
 * ★ **不加数据通道**：数据源是既有的 `activitySnapshots`（`/state` 已经遍历所有工作区）。
 *   本层只把**已有的那份**画成文件夹。
 *
 * ★ **不碰既有视图**：`MemberRow` / `ActivityPanel` 一行未改 —— 这是**新增一层**。
 * @module dsh-agent-teams/client/folders-panel
 */
import { type ActivityTeam } from './activity-monitor.ts';
/** One workspace folder: the workspace name plus the teams inside it. */
export interface WorkspaceFolder {
    readonly workspace: string;
    /** Durable team ids under this workspace, in first-seen order (stable). */
    readonly teamIds: readonly string[];
    /** Live teams (not archived) under this workspace. */
    readonly liveCount: number;
}
/**
 * ── ★★★ 从 `/state` 的 teams 聚合出**工作区文件夹列表**（纯函数）──────────────────
 *
 * ★ 聚合键是 `team.workspace`（`ActivityTeam` 上已有的字段，见 `activity-monitor.ts:156`）
 *   ⇒ **不加任何数据通道**，也不改 `snapshot.ts`（它不在本任务写域）。
 *
 * ★★ 两种来源**合并**（`teams` 与 `archivedTeams`）：一个工作区若只剩已归档的队，
 *   它**仍然是一个工作区** —— 从列表里消失会让"这里曾经有工作区"与"从来没有"同形。
 *   `liveCount` 单列，于是"这个文件夹里还有没有活的队"读得出来。
 *
 * ★ 空工作区名（`''`）**照收**：它是"`/state` 报了一个无名工作区"，与"没有工作区"
 *   不同形 —— 后者才是空态。丢掉它会**静默少一个文件夹**。
 *
 * @param teams - live teams from `/state`.
 * @param archivedTeams - archived teams from `/state` (may be empty).
 * @returns one folder per distinct workspace, in **first-seen order** (stable across polls).
 */
export declare function foldersFromSnapshots(teams: readonly ActivityTeam[], archivedTeams?: readonly ActivityTeam[]): readonly WorkspaceFolder[];
/**
 * ── ★★ 三态：**有文件夹 / 明确空态 / 读不到** ─────────────────────────────────────
 *
 * ★ 为什么三态而不是两态：白屏与"读不到数据"**同形**，而两者的补救动作相反
 *   （前者是"去建一个工作区"，后者是"去看 `/state` 为什么没回来"）。
 *
 * ★ `'unknown'` 的载体是 `snapshots === undefined`（store 还没发布过第一份）。
 *   而**空数组**是"读到了、确实没有" —— 两者**不同形**。
 */
export type FoldersView = {
    readonly state: 'loaded';
    readonly folders: readonly WorkspaceFolder[];
} | {
    readonly state: 'empty';
};
/**
 * Classify the snapshot pair into the three-way view.
 *
 * @param teams - live teams, or `undefined` when the store never published.
 * @param archivedTeams - archived teams, or `undefined` when never published.
 */
export declare function foldersView(teams: readonly ActivityTeam[] | undefined, archivedTeams: readonly ActivityTeam[] | undefined): FoldersView;
/**
 * The folders panel: one pixel-art folder per workspace.
 *
 * ★ 空态**显式渲染**（不是"什么都不画"）—— 白屏与"读不到"同形，见 `FoldersView`。
 * ★ 每次渲染都落一个可读读数：`data-folders-count` / `data-folders-state`，
 *   于是"画了几个文件夹"是**可编程判据**，不是截图。
 */
/**
 * What the folders panel needs from the host.
 *
 * ★ 为什么要注入 `selectPanel` 而不是在这个文件里 `import` 服务：
 *   面板是**纯表现**，切换面板是**动作** —— 把它做成参数，夹具就能注入一个
 *   记录器，于是"点了文件夹之后切到哪去了"是**可编程判据**（反向半边 B/C）。
 */
export interface FoldersPanelProps {
    /** ★ 切到会话：官方写法是 `selectPanel(null)`。缺省 ⇒ 不提供出口（夹具可省）。 */
    readonly openConversation?: () => void;
}
export declare function FoldersPanel({ openConversation }?: FoldersPanelProps): JSX.Element;
