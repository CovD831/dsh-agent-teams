/**
 * The captain row: who is coordinating, and what it is doing right now.
 *
 * ── ★★★ R4：这是从 `ActivityPanel.tsx` 里**整块搬出来**的（纯搬运）──────────────
 *
 * 它原来长在 `TeamSection` 的返回体里（`css.captainNode` 那一块）。搬出来是因为
 * 成员屏需要它，而成员屏现在有自己的模块 —— 留在面板里会让"这一屏由谁组成"
 * 只能靠读一个 1171 行的文件回答。
 *
 * ★ 每一行、每一个 `data-*` 探针、每一句文案都原样保留：搬动不得改变渲染结果。
 *   `scripts/workspace-activity.test.mjs` 的 R4 集合臂会把这一点**机械地**核一遍。
 * @module dsh-agent-teams/client/captain-node
 */
import type { AgentTeamsTranslate } from './locales.ts';
export type CaptainNodeProps = {
    /** Which copy the summary line shows; the three states are exclusive. */
    readonly discarded: boolean;
    readonly captainBusy: boolean;
    readonly busyCount: number;
    readonly allCompleted: boolean;
    readonly allSettled: boolean;
    /** `staged` plans have not been created yet, so their copy is its own case. */
    readonly staged: boolean;
    readonly awaitingFeedback: boolean;
    readonly assignedCount: number;
    /** Already-joined captain task ids, for the takeover copy. */
    readonly captainTaskIds: string;
    readonly taskCount: number;
    readonly memberCount: number;
    readonly t: AgentTeamsTranslate;
};
/**
 * Render the captain row.
 *
 * ★ 文案的分支顺序**原样保留**：discarded > captainBusy > staged > 默认。
 *   重排它会让两张不同的读数在某些输入上换位 —— 而那正是"搬动改了行为"。
 * ★ t80：头像那一格已按用户裁定去掉（见返回体里的注释）；其余逐行未动。
 */
export declare function CaptainNode({ discarded, captainBusy, busyCount, allCompleted, allSettled, staged, awaitingFeedback, assignedCount, captainTaskIds, taskCount, memberCount, t, }: CaptainNodeProps): JSX.Element;
