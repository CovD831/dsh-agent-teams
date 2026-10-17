import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FOLDERS_MAIN_KEY } from "./folders-probe.js";
import css from './folders-panel.module.css';
/**
 * 进程内调用账本（模块级单例）。
 *
 * ★ 为什么是模块级而不是 React state：判据要回答的是
 *   「**这个会话里点了几次、切到哪去了**」，而不是某一个组件实例的局部状态。
 *   放模块级 ⇒ 夹具 import 进来就能读，**不需要起浏览器**。
 * ★ 它是一个**列表**而不是计数器：`A → B → A` 与 `A → A` 的计数可能相同，
 *   而两者的**顺序证据**不同 ⇒ 存下来才能区分。
 */
const calls = [];
/** ★ 记一次调用（两个入口共用这一个账本 —— 它们的**方向**不同，靠 `from` 分开）。 */
export function noteSelectPanelCall(from, panelId) {
    calls.push({ from, panelId });
}
/** ★ 读账本（副本 ⇒ 夹具读完之后别人再点也不会改它当时看到的那个数组）。 */
export function selectPanelLog() {
    return [...calls];
}
/** ★ 清空（夹具每条臂开始时复位，避免臂与臂互相污染）。 */
export function resetSelectPanelLog() {
    calls.length = 0;
}
/* ─────────────────────────────────────────────────────────────────────────────
 * ② 纯函数：入口该不该显示、显示成什么
 * ───────────────────────────────────────────────────────────────────────────── */
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
export function returnEntryState(activePanelId) {
    if (activePanelId === undefined)
        return 'unknown';
    return activePanelId === FOLDERS_MAIN_KEY ? 'hidden' : 'show';
}
/**
 * One-line summary for the entry's own label (also the `data-` probe value).
 * @param state - the tri-state from {@link returnEntryState}.
 */
export function returnEntryLabel(state) {
    return state === 'unknown' ? '回到工作区（面板状态未知）' : '回到工作区';
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
export function FoldersReturnEntry({ usePanelInfo, selectPanel }) {
    const panelInfo = usePanelInfo((info) => info);
    const state = returnEntryState(panelInfo.activePanelId);
    const hits = selectPanelLog().filter((call) => call.from === 'return-entry').length;
    /**
     * ★ 在文件夹页里**不渲染**（返回 `null`）—— 但那**不是**"不常驻"：
     *   它仍然在每个会话里被挂载、被求值，只是当前这一刻没有可去的地方。
     *   ★ 而 `unknown` **仍然渲染**，理由见 `returnEntryState` 的注释。
     */
    if (state === 'hidden') {
        /**
         * ★ 即便如此，也留一个**可编程的痕迹**：夹具要能区分
         *   "在文件夹页所以不显示" 与 "**根本没挂载**" —— 两者在 DOM 上都是"没有按钮"。
         *   ⇒ 这里渲染一个 `hidden` 的标记节点（`` hidden`` 属性 ⇒ 不可见、不可点，但读得到）。
         */
        return (_jsx("span", { className: css.returnEntryHost, "data-folders-return": "hidden", "data-folders-return-state": "hidden", hidden: true }));
    }
    return (_jsxs("span", { className: css.returnEntryHost, "data-folders-return": "shown", "data-folders-return-state": state, children: [_jsx("button", { type: "button", className: css.returnEntry, "data-folders-return-button": "true", 
                /**
                 * ★★ 点击 ⇒ **把面板切回文件夹页**。这是本缺陷的**唯一**修复点。
                 *   ★ 先记账、再调用：若 `selectPanel` 抛（未注册 id），账本里仍留下"**试过**"，
                 *     而"试过并失败"与"没试过"必须不同形。
                 */
                onClick: () => {
                    noteSelectPanelCall('return-entry', FOLDERS_MAIN_KEY);
                    selectPanel(FOLDERS_MAIN_KEY);
                }, title: "\u56DE\u5230\u5DE5\u4F5C\u533A\u5217\u8868\uFF08\u6587\u4EF6\u5939\u5927\u9875\u9762\uFF09", children: returnEntryLabel(state) }), _jsx("span", { className: css.returnEntryHits, "data-folders-return-hits": hits, children: hits > 0 ? hits : '' })] }));
}
