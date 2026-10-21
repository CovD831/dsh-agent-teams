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

import { useSyncExternalStore } from 'react'
import type { MainPanelId, UsePanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { FOLDERS_MAIN_KEY } from './folders-probe.tsx'
import css from './folders-panel.module.css'

/* ─────────────────────────────────────────────────────────────────────────────
 * ① 调用账本：**可编程判据的载体**
 * ───────────────────────────────────────────────────────────────────────────── */

/** One recorded `selectPanel` call, in order. */
export interface SelectPanelCall {
  /** The panel id passed to `selectPanel`; `null` means "back to the conversation". */
  readonly panelId: string | null
  /**
   * Where the call came from — ★ **每一条路线都必须可区分**。
   *
   * ★★ `room-open` 是 2026-10-22 加的（需求 §27 的房间页）：房间页的"回会话"出口
   *   与文件夹页的那一条**不是同一条路线**（它们是两个 `main` key）。
   *   ⇒ 合成 `folder-open` 会让"从房间出去了"与"从文件夹出去了"在账本上同形，
   *     而两者的补救动作不同（前者说明房间页可用，后者说明文件夹页还在）。
   */
  readonly from: 'return-entry' | 'folder-open' | 'room-open'
}

/**
 * 进程内调用账本（模块级单例）。
 *
 * ★ 为什么是模块级而不是 React state：判据要回答的是
 *   「**这个会话里点了几次、切到哪去了**」，而不是某一个组件实例的局部状态。
 *   放模块级 ⇒ 夹具 import 进来就能读，**不需要起浏览器**。
 * ★ 它是一个**列表**而不是计数器：`A → B → A` 与 `A → A` 的计数可能相同，
 *   而两者的**顺序证据**不同 ⇒ 存下来才能区分。
 */
const calls: SelectPanelCall[] = []

/** ★ 记一次调用（两个入口共用这一个账本 —— 它们的**方向**不同，靠 `from` 分开）。 */
export function noteSelectPanelCall(from: SelectPanelCall['from'], panelId: string | null): void {
  calls.push({ from, panelId })
}

/** ★ 读账本（副本 ⇒ 夹具读完之后别人再点也不会改它当时看到的那个数组）。 */
export function selectPanelLog(): readonly SelectPanelCall[] {
  return [...calls]
}

/** ★ 清空（夹具每条臂开始时复位，避免臂与臂互相污染）。 */
export function resetSelectPanelLog(): void {
  calls.length = 0
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
export function returnEntryState(activePanelId: string | null | undefined): 'show' | 'hidden' | 'unknown' {
  if (activePanelId === undefined) return 'unknown'
  return activePanelId === FOLDERS_MAIN_KEY ? 'hidden' : 'show'
}

/**
 * One-line summary for the entry's own label (also the `data-` probe value).
 * @param state - the tri-state from {@link returnEntryState}.
 */
export function returnEntryLabel(state: 'show' | 'hidden' | 'unknown'): string {
  return state === 'unknown' ? '回到工作区（面板状态未知）' : '回到工作区'
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ③ 组件
 * ───────────────────────────────────────────────────────────────────────────── */

/** What the entry needs from the host. */
export interface FoldersReturnEntryProps {
  readonly usePanelInfo: UsePanelInfo
  /** ★ 切换的**唯一**出口（生产是 `ctx.layout.selectPanel`；夹具注入一个记录器）。 */
  readonly selectPanel: (panelId: MainPanelId | null) => void
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
export function FoldersReturnEntry({ usePanelInfo, selectPanel }: FoldersReturnEntryProps): JSX.Element | null {
  const panelInfo = usePanelInfo((info) => info)
  const state = returnEntryState(panelInfo.activePanelId as string | null | undefined)
  const hits = selectPanelLog().filter((call) => call.from === 'return-entry').length

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
    return (
      <span
        className={css.returnEntryHost}
        data-folders-return="hidden"
        data-folders-return-state="hidden"
        hidden
      />
    )
  }

  return (
    <span className={css.returnEntryHost} data-folders-return="shown" data-folders-return-state={state}>
      <button
        type="button"
        className={css.returnEntry}
        data-folders-return-button="true"
        /**
         * ★★ 点击 ⇒ **把面板切回文件夹页**。这是本缺陷的**唯一**修复点。
         *   ★ 先记账、再调用：若 `selectPanel` 抛（未注册 id），账本里仍留下"**试过**"，
         *     而"试过并失败"与"没试过"必须不同形。
         */
        onClick={() => {
          noteSelectPanelCall('return-entry', FOLDERS_MAIN_KEY)
          selectPanel(FOLDERS_MAIN_KEY as unknown as MainPanelId)
        }}
        title="回到工作区列表（文件夹大页面）"
      >
        {returnEntryLabel(state)}
      </button>
      <span className={css.returnEntryHits} data-folders-return-hits={hits}>{hits > 0 ? hits : ''}</span>
    </span>
  )
}
