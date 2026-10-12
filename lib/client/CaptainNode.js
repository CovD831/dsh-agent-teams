import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { LEAD_ART } from "./artwork.js";
import { WorkGlyph } from "./DependencyGraph.js";
import css from './ActivityPanel.module.css';
/**
 * Render the captain row.
 *
 * ★ 文案的分支顺序**原样保留**：discarded > captainBusy > staged > 默认。
 *   重排它会让两张不同的读数在某些输入上换位 —— 而那正是"搬动改了行为"。
 */
export function CaptainNode({ discarded, captainBusy, busyCount, allCompleted, allSettled, staged, awaitingFeedback, assignedCount, captainTaskIds, taskCount, memberCount, t, }) {
    return (_jsxs("div", { className: css.captainNode, children: [_jsx("span", { className: css.captainAvatar, children: _jsx("img", { className: css.leadAvatar, src: LEAD_ART, alt: "", "aria-hidden": true }) }), _jsxs("span", { className: css.captainInfo, children: [_jsxs("span", { className: css.captainLine, children: [_jsx("span", { className: css.captainName, children: t('captain.name') }), _jsx("span", { className: css.captainRole, children: t('captain.role') })] }), _jsx("span", { className: css.captainSummary, children: discarded
                            ? t('captain.summary.discarded', { tasks: taskCount, members: memberCount })
                            : captainBusy
                                ? t('captain.summary.withTakeover', { tasks: assignedCount, captainTasks: captainTaskIds })
                                : staged
                                    ? t(awaitingFeedback
                                        ? 'captain.summary.awaitingFeedback'
                                        : 'captain.summary.staged', { tasks: taskCount, members: memberCount })
                                    : t('captain.summary', { tasks: assignedCount, members: memberCount }) })] }), _jsxs("span", { className: css.captainState, "data-busy": captainBusy || busyCount > 0, children: [_jsx(WorkGlyph, { active: captainBusy || busyCount > 0 }), discarded
                        ? t('captain.state.discarded')
                        : captainBusy
                            ? t('captain.state.takeover', { tasks: captainTaskIds })
                            : staged
                                ? t(awaitingFeedback
                                    ? 'captain.state.awaitingFeedback'
                                    : 'captain.state.staged')
                                : busyCount > 0
                                    ? t('captain.state.working', { count: busyCount })
                                    : t(allCompleted
                                        ? 'captain.state.collected'
                                        : allSettled
                                            ? 'captain.state.settled'
                                            : 'captain.state.waiting')] })] }));
}
