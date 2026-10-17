import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useSyncExternalStore } from 'react';
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots } from "./activity-monitor.js";
/**
 * ★★★ 判据载体：**渲染计数**（t103 建立的进程内单例）。
 *
 * ★ 为什么本面板必须继续喂它：**反向半边 A** 判的是
 *   「**不调** `selectPanel` ⇒ 渲染计数 = 0」——
 *   而"渲染计数"这件事的**唯一**载体就是 `noteProbeRender`。
 *   ⇒ 若这里换成别的载体，那条判据就失去了落点（测的是一个没人写过的格子）。
 * ★ 它也顺带保留 t103/t105 已验的两条读数（注册成功 / 选择后被渲染），
 *   于是本轮**不需要重新论证地基**，只需要证明"它仍然成立"。
 */
import { FOLDERS_MAIN_KEY, noteProbeRender } from "./folders-probe.js";
/**
 * ★★★ t112（反向半边 B）：文件夹页**必须能出去** —— 否则它是**死路**，
 *   与"进了会话回不去文件夹"那个用户报告的缺陷**对称**。
 *   ★ 出去的官方写法是 `selectPanel(null)`（官方逐字：`null` ⇒ 回到 Conversation）。
 *
 * ★★ **为什么本文件不 import 任何新东西**：本层的 import 面被
 *   `gate-folders-panel.test.mjs` 的臂 8 用**白名单**钉住了（零新依赖）。
 *   而那个夹具**不在本轮写域** ⇒ 我不能去放宽它。
 *   ⇒ 所以"记账"这一步挪到**注入处**（`index.tsx` 的 `openConversation`），
 *     本文件只负责**调用**它拿到的那个回调。
 */
import css from './folders-panel.module.css';
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
export function foldersFromSnapshots(teams, archivedTeams = []) {
    /** ★ `Map` 保持插入序 ⇒ 列表顺序**跨轮询稳定**（排序抖动会让 UI 看起来在"跳"）。 */
    const byWorkspace = new Map();
    const touch = (workspace) => {
        const existing = byWorkspace.get(workspace);
        if (existing !== undefined)
            return existing;
        const created = { teamIds: [], liveCount: 0 };
        byWorkspace.set(workspace, created);
        return created;
    };
    for (const team of teams) {
        const entry = touch(team.workspace);
        if (!entry.teamIds.includes(team.teamId))
            entry.teamIds.push(team.teamId);
        entry.liveCount += 1;
    }
    for (const team of archivedTeams) {
        const entry = touch(team.workspace);
        if (!entry.teamIds.includes(team.teamId))
            entry.teamIds.push(team.teamId);
    }
    return [...byWorkspace.entries()].map(([workspace, entry]) => ({
        workspace,
        teamIds: entry.teamIds,
        liveCount: entry.liveCount,
    }));
}
/**
 * Classify the snapshot pair into the three-way view.
 *
 * @param teams - live teams, or `undefined` when the store never published.
 * @param archivedTeams - archived teams, or `undefined` when never published.
 */
export function foldersView(teams, archivedTeams) {
    if (teams === undefined || archivedTeams === undefined)
        return { state: 'empty' };
    return { state: 'loaded', folders: foldersFromSnapshots(teams, archivedTeams) };
}
/**
 * ── ★★★ 像素风文件夹图标：**内联 SVG，几个矩形**（零依赖、零位图）──────────────────
 *
 * ★ 用户要"像素风"而 B0.6 那套成本论证同样适用：**位图 sprite = 体积 + 版权**。
 *   ⇒ 用几个 `<rect>` 拼一个 16×16 网格的文件夹：像素风的本质就是**对齐到格子的方块**。
 * ★ 每个像素块用 `shapeRendering="crispEdges"` ⇒ 缩放时**不插值**（那才是像素风的观感）。
 * ★ `aria-hidden`：它是装饰，旁边的文字才是读数。
 */
const PIXEL = 2;
const FOLDER_PIXELS = [
    // [x, y, w, h] in pixel units —— 一个"文件夹"的最小像素画：底边 + 标签页 + 两点高光
    [2, 3, 5, 2], // tab
    [0, 5, 16, 8], // body
];
const FOLDER_HIGHLIGHT = [
    [2, 7, 3, 1],
    [2, 9, 5, 1],
];
function FolderGlyph() {
    return (_jsxs("svg", { className: css.folderGlyph, width: 16 * PIXEL, height: 16 * PIXEL, viewBox: "0 0 16 16", shapeRendering: "crispEdges", "aria-hidden": "true", "data-folders-glyph": "pixel", children: [FOLDER_PIXELS.map(([x, y, w, h]) => (_jsx("rect", { x: x, y: y, width: w, height: h, className: css.folderBody }, `b${x}-${y}`))), FOLDER_HIGHLIGHT.map(([x, y, w, h]) => (_jsx("rect", { x: x, y: y, width: w, height: h, className: css.folderHighlight }, `h${x}-${y}`)))] }));
}
export function FoldersPanel({ openConversation } = {}) {
    /** ★ 每次渲染喂一次渲染计数（反向半边 A 的落点，见文件头的 import 注释）。 */
    noteProbeRender(FOLDERS_MAIN_KEY);
    const { teams, archivedTeams } = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
    const view = foldersView(teams, archivedTeams);
    const folders = view.state === 'loaded' ? view.folders : [];
    return (_jsxs("section", { className: css.panel, "data-folders-panel": "agent-teams/folders", "data-folders-state": view.state, "data-folders-count": folders.length, children: [_jsxs("header", { className: css.head, children: [_jsx("span", { className: css.title, children: "\u5DE5\u4F5C\u533A" }), _jsx("span", { className: css.count, "data-folders-total": folders.length, children: folders.length })] }), view.state === 'empty' ? (
            /**
             * ★★ 反向半边 C 的落点：**明确的空态**，不是白屏。
             *   `data-folders-empty="true"` 是它的可辨识标记（判据读它）。
             */
            _jsx("p", { className: css.empty, "data-folders-empty": "true", children: "\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u533A\u3002\u8FD9\u91CC\u4F1A\u5217\u51FA\u4F60\u6253\u5F00\u8FC7\u7684\u6BCF\u4E00\u4E2A\u5DE5\u4F5C\u533A\u3002" })) : (_jsx("ul", { className: css.grid, "data-folders-grid": "true", children: folders.map((folder) => (_jsx("li", { className: css.folderCell, children: _jsxs("button", { type: "button", className: css.folder, "data-folder": folder.workspace, "data-folder-teams": folder.teamIds.length, "data-folder-live": folder.liveCount, "data-folder-open": "true", onClick: () => { openConversation?.(); }, title: `进入 ${folder.workspace === '' ? '(未命名工作区)' : folder.workspace}`, children: [_jsx(FolderGlyph, {}), _jsx("span", { className: css.folderName, title: folder.workspace, children: folder.workspace === '' ? '(未命名工作区)' : folder.workspace }), _jsxs("span", { className: css.folderMeta, children: [folder.teamIds.length, " \u4E2A\u56E2\u961F", folder.liveCount > 0 ? ` · ${folder.liveCount} 进行中` : ''] })] }) }, folder.workspace === '' ? '\u0000unnamed' : folder.workspace))) }))] }));
}
