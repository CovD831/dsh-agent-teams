/**
 * Screen one's progress readout: one sentence plus a tone dot.
 *
 * ── ★★★ R4：从 `ActivityPanel.tsx` 整块搬出来（纯搬运）─────────────────────────
 *
 * `taskSummary` 与 `ProgressOverview` 是**同一件事**（"这一队做到哪了"）的两半：
 * 前者把持久任务状态翻成一句人话，后者把那句话连同一个语气点画出来。它们
 * 分开在两个文件里没有意义，所以一起搬。
 *
 * ★ R3 已经把色块条与图例删掉了（那是同一个数字的第二、三次表述），
 *   所以这里只剩"一句话 + 一个点" —— 搬动**不带回**任何被删掉的东西。
 * ★ 文案分支顺序原样保留：重排会让两个读数在边界输入上换位。
 * @module dsh-agent-teams/client/progress-summary
 */
import type { ActivityTeam } from './activity-monitor.ts';
import type { AgentTeamsTranslate } from './locales.ts';
export declare function taskSummary(team: ActivityTeam, t: AgentTeamsTranslate, discarded?: boolean): string;
/**
 * ── ★★★ R2：秒表**不再**长在这里 ──────────────────────────────────────────────
 *
 * MEASURED：这里原来有一个 `useElapsedNow(active)` —— 它把 `now` 放进
 * `TeamSection` 的 state，于是**每秒**整棵面板树重渲染（契约原句：
 * "a tick must not re-render the 1586-line panel it sits inside"）。
 *
 * ★ 修法不是"少 tick 几次"，而是**搬家**：`now` 的 state 与 `setInterval`
 *   都搬进 `MemberClock.tsx`（一个只印一行时长的小组件）。本组件**不持有** `now`，
 *   所以它没有任何理由跟着 tick 重渲染。
 * ★ 而"只有真的在跑的成员才起表"由 `memberClockTicks` 判定（见 activity-model）。
 */
/**
 * ── ★★★ R3：进度**读数**只留一句话，色块条与图例都去掉 ────────────────────────────
 *
 * MEASURED（用户原话）：「整个东西挺冗余的，比如它做一些 badge 之类的东西」。
 *
 * ★ 原来的三件套是**同一个事实的三次表述**：
 *   · `progressSegments` —— 一排色块，每块一个任务；而"完成了几项"在下面那行
 *     已经用数字说了，色块只是把同一件事画了一遍；
 *   · `progressLegend` —— `■ 进行中 N / ■ 等待依赖 N / ■ 已交付 N`；其中
 *     "已交付 N" 与团队头上的 `{completed}/{total} 完成` 是**同一个数**；
 *   · `progressSummary` —— 一句人话的总结，**这一件留下**，因为它说的
 *     "等待前置/正在执行/全部交付"是前两者都没说的。
 *
 * ⇒ 减法之后：一句总结 + 一个语气点。数字仍在（团队头的 completed/total、
 *   成员行自己的 done/total），所以**没有任何读数丢失**。
 */
export declare function ProgressSummary({ team, t, discarded }: {
    readonly team: ActivityTeam;
    readonly t: AgentTeamsTranslate;
    readonly discarded?: boolean;
}): import("react").JSX.Element | null;
