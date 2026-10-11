import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a shell-overlay
 * panel that docks at the conversation's top-right edge by default, can be
 * dragged into a floating window, resized, and folded into an activity badge.
 * On wide viewports the docked panel makes the conversation column yield
 * space; narrow viewports keep a simple inset overlay. It
 * polls the host `/plugins/dsh-agent-teams/state` route for
 * server-side snapshots (durable files + live subagent activity), with a
 * collapsed badge that auto-expands once when activity appears. Archived
 * teams stay available for the owning conversation after live work ends.
 *
 * The floater mounts in ui-layout's additive `shell.overlay`; it is not a
 * conversation node — the in-conversation panel was removed in favor of this
 * always-available monitor.
 * @module dsh-agent-teams/client/activity
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, } from 'react';
import { IconBranchOutline16, IconChevronDownOutline14, IconPanelLeftOutline16, IconStopFill16, IconWarningOutline16, } from "./icons.js";
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { currentSessionId } from "./session-navigation.js";
import { activityPanelExpandedForSession, activityPanelShouldAutoExpand, compactDagLayout, COMPACT_DAG_NODE_HEIGHT, COMPACT_DAG_NODE_WIDTH, dependencyFocusTaskId, memberRouteLabel, memberRowExpanded, memberRowKey, orderDelegationMembers, pruneMemberRows, relatedTaskIds, loopFacts, nextLoopDisclosure, reviewLoop, roundTailCounts, taskLoopTone, taskModelLabel, teamIsActive, toggleLoopDisclosure, toggleMemberRow, usesParallelTaskGrid, } from "./activity-model.js";
import { ACTIVITY_HALT_URL, getActivityMonitorTargetsSnapshot, getActivitySnapshotsSnapshot, startActivityPolling, subscribeActivityMonitorTargets, subscribeActivitySnapshots, } from "./activity-monitor.js";
import { LEAD_ART } from "./artwork.js";
import { OPEN_PANEL_EVENT } from "./AgentTeamsCard.js";
import { memberModelEditability, StagingPlanEditor } from "./StagingPlanEditor.js";
import { MemberRow } from "./MemberRow.js";
import { DEFAULT_PANEL_LAYOUT, PANEL_LAYOUT_STORAGE_KEY, compactPanelForBounds, dockPanelLayout, floatPanelLayout, movePanelLayout, panelMaximumHeight, panelUsesAutoHeight, parsePanelLayout, resizePanelLayout, resolvePanelGeometry, } from "./panel-geometry.js";
import css from './ActivityPanel.module.css';
/** Grace before the panel collapses once no team remains. */
const AUTOCLOSE_GRACE_MS = 2000;
/**
 * Page-settle window after mount: activity restored on page load only shows
 * the collapsed badge, so the panel never yanks the conversation column
 * right after load. New activity after this window auto-expands as usual.
 */
const AUTO_OPEN_SETTLE_MS = 4000;
/** Root marker shared with the panel CSS while the shell overlay is expanded. */
const PANEL_OPEN_ATTRIBUTE = 'data-agent-teams-panel-open';
/** Shared width concession consumed by the conversation root CSS. */
const PANEL_SHIFT_PROPERTY = '--agent-teams-panel-shift';
const PANEL_CONVERSATION_GAP = 14;
const MOVE_THRESHOLD = 4;
const CAPTAIN_ASSIGNEE = 'captain';
/**
 * t16: styles for the member model control. ★ Inline rather than a CSS module
 *   because no stylesheet is inside this task's scope; the values still come
 *   only from host --dsw-alias-* tokens, so the host theme keeps applying.
 */
const MEMBER_MODEL_LINE_STYLE = {
    display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '2px 6px 0 60px',
};
function initialPanelLayout() {
    if (typeof window === 'undefined')
        return DEFAULT_PANEL_LAYOUT;
    return parsePanelLayout(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY));
}
function initialPanelBounds() {
    if (typeof window === 'undefined')
        return { width: 1440, height: 900, anchorRight: 1440 };
    return { width: window.innerWidth, height: window.innerHeight, anchorRight: window.innerWidth };
}
/** Badge text follows the raw task status (finer than the 4 visual states):
 * claimed/pending/failed/cancelled keep their own labels and colors. */
const TASK_STATUS_LABEL = {
    pending: 'task.status.pending',
    claimed: 'task.status.claimed',
    in_progress: 'task.status.inProgress',
    completed: 'task.status.completed',
    failed: 'task.status.failed',
    cancelled: 'task.status.cancelled',
};
function taskStatusLabel(status, t) {
    const key = TASK_STATUS_LABEL[status];
    return key === undefined ? status : t(key);
}
function formatTaskIds(ids, t) {
    return ids.join(t('format.listSeparator'));
}
function taskTitle(task, model) {
    const extras = [
        task.kind,
        task.round === undefined ? undefined : `r${task.round}`,
        task.verdict,
        model === '' ? undefined : model,
    ].filter((item) => item !== undefined);
    return extras.length === 0 ? `${task.id} · ${task.subject}` : `${task.id} · ${task.subject} · ${extras.join(' · ')}`;
}
/** Badge/bar coloring key: visual state, widened for terminal statuses. */
function taskTone(state, status) {
    if (status === 'failed')
        return 'failed';
    if (status === 'cancelled')
        return 'cancelled';
    return state;
}
/**
 * Terminal-outcome tone for every surface that colours a task.
 *
 * ★ This is the fix for "a review that found problems renders as a red failure".
 *   The three measured outcomes get three distinct tones: a consultative task
 *   whose job was to find problems renders AMBER (`converging`), a genuinely
 *   broken deliverable stays red, and an unmeasured stop renders as neither.
 *
 * ★ When the host has not published a classification, this returns the SAME
 *   value `taskTone` did before, so nothing regresses on an older snapshot —
 *   the new states only appear where they were actually measured.
 */
function taskTerminalTone(task) {
    if (task.status === 'cancelled')
        return 'cancelled';
    if (task.status !== 'failed')
        return taskTone(task.state, task.status);
    return taskLoopTone(task);
}
/**
 * Locale key for one round's tone label.
 *
 * Reuses the pre-existing `task.status.*` vocabulary: a parallel `round.*`
 * dictionary would be a second source of truth for the same words.
 */
const ROUND_TONE_LABEL = {
    converging: 'task.status.failed',
    unmeasured: 'task.status.notRun',
    failed: 'task.status.failed',
    running: 'task.status.inProgress',
    open: 'task.status.pending',
    blocked: 'task.status.claimed',
    completed: 'task.status.completed',
    cancelled: 'task.status.cancelled',
};
function Chevron({ open }) {
    return (_jsx("svg", { className: css.chevron, "data-open": open, width: "9", height: "9", viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", "aria-hidden": true, children: _jsx("path", { d: "M3.5 2l3 3-3 3" }) }));
}
function WorkGlyph({ active }) {
    return (_jsx("svg", { className: css.workGlyph, "data-active": active, width: "11", height: "11", viewBox: "0 0 11 11", fill: "currentColor", "aria-hidden": true, children: [[0, 0], [4.2, 0], [8.4, 0], [0, 4.2], [4.2, 4.2], [8.4, 4.2]].map(([x, y], index) => (_jsx("rect", { x: x, y: y, width: "2.6", height: "2.6", rx: ".6", style: { animationDelay: `${index * 0.15}s` } }, `${x}:${y}`))) }));
}
/** Collapsed badge: an always-visible corner pill while any team exists. */
function CollapsedBadge({ count, busy, onClick, t }) {
    return (_jsxs("button", { type: "button", className: css.badge, "data-agent-teams-collapsed": true, "data-busy": busy, onClick: onClick, "aria-label": t('activity.badgeAria', { count }), children: [_jsx("span", { className: css.badgeDot, "data-busy": busy, "aria-hidden": true }), _jsx("span", { className: css.badgeCount, children: count })] }));
}
/**
 * ── ★★★ R2：这几段读数**搬进了 `MemberRow.tsx`** ────────────────────────────────
 *
 * `memberStateLabel` / `memberStatusText` / `memberDotTone` 原来长在这里，
 * 而它们全部是**关于一行成员**的读数。R2 把成员行变成一个真正的组件
 * （`src/client/MemberRow.tsx`）之后，它们跟着那一行走 —— 留在面板里就成了
 * 第二份实现，而本仓对"第二份实现"的判据是：它一定会漂移。
 *
 * ★ 一行只应有一个"它在做什么"的口径，所以这里**不留**转发壳。
 */
function compactTaskLabel(subject) {
    const withoutVerb = subject.replace(/^开发\s*/u, '').replace(/^\d+[-_.、\s]*/u, '');
    const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb;
    return head.length > 18 ? `${head.slice(0, 17)}…` : head;
}
function taskSummary(team, t, discarded = false) {
    const completed = team.tasks.filter((task) => task.status === 'completed');
    const cancelled = team.tasks.filter((task) => task.status === 'cancelled');
    const running = team.tasks.filter((task) => task.state === 'running');
    const blocked = team.tasks.filter((task) => task.state === 'blocked');
    const ready = team.tasks.filter((task) => task.state === 'open' && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled');
    const failed = team.tasks.filter((task) => task.status === 'failed');
    if (discarded)
        return t('task.summary.discarded', { count: team.tasks.length });
    if (team.tasks.length === 0)
        return t('task.summary.waitingBreakdown');
    if (team.phase === 'staged')
        return t('task.summary.staged', { count: team.tasks.length });
    if (completed.length === team.tasks.length)
        return t('task.summary.allDelivered', { count: completed.length });
    if (completed.length + cancelled.length + failed.length === team.tasks.length) {
        return t('task.summary.ended', {
            completed: completed.length,
            cancelled: cancelled.length,
            failed: failed.length,
        });
    }
    if (failed.length > 0 && running.length === 0 && ready.length === 0 && blocked.length === 0) {
        return t('task.summary.failedSettled', { count: failed.length });
    }
    if (blocked.length > 0 && running.length > 0) {
        return t('task.summary.blockedAndRunning', {
            tasks: formatTaskIds(blocked.slice(0, 3).map((task) => task.id), t),
            more: blocked.length > 3 ? t('task.summary.more', { count: blocked.length - 3 }) : '',
        });
    }
    if (running.length > 0)
        return t('task.summary.running', { tasks: formatTaskIds(running.map((task) => task.id), t) });
    if (ready.length > 0)
        return t('task.summary.ready', { tasks: formatTaskIds(ready.map((task) => task.id), t) });
    if (blocked.length > 0)
        return t('task.summary.blocked', { tasks: formatTaskIds(blocked.map((task) => task.id), t) });
    return t('task.summary.waitingSchedule');
}
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
 * Review/repair rounds with the round markers that make convergence visible.
 *
 * A gate that returns `needs_revision` is the system working: the host then
 * generates the next round. Rendered as disconnected red tasks, an external
 * observer sees a run of accidents; rendered as ordered rounds with tail
 * counts, the same durable data reads as one loop that is narrowing.
 *
 * ★ Disclosure follows the first-party rule: a loop with anything unsettled
 *   opens by default, so an amber marker can never hide inside a collapsed row.
 */
function ReviewLoopSection({ tasks, t, discarded = false, onSelectTask }) {
    const loop = useMemo(() => reviewLoop(tasks), [tasks]);
    const facts = useMemo(() => loopFacts(loop, discarded), [loop, discarded]);
    const [disclosure, setDisclosure] = useState(undefined);
    /**
     * ★ The disclosed state is REBUILT from durable facts on every change, and the
     *   initial value (no previous state) likewise comes from the facts — never
     *   from a remembered UI flag, so a remount cannot silently hide an abnormal
     *   loop. See {@link nextLoopDisclosure} for the precedence rules.
     */
    useEffect(() => {
        setDisclosure((current) => {
            const next = nextLoopDisclosure(current, facts);
            return current !== undefined
                && current.open === next.open
                && current.userSet === next.userSet
                && current.mode === next.mode
                && current.count === next.count
                ? current
                : next;
        });
    }, [facts]);
    const open = disclosure?.open ?? facts.mode !== 'clean';
    if (loop.tracked === 0 || loop.rounds.length === 0)
        return null;
    const tail = loop.rounds.map((entry) => `${entry.round}`).join(t('format.listSeparator'));
    return (_jsxs("section", { className: css.loopSection, "aria-label": t('dependency.aria'), "data-review-loop": true, "data-tracked": loop.tracked, children: [_jsxs("header", { className: css.loopHead, children: [_jsxs("button", { type: "button", className: css.loopToggle, onClick: () => { setDisclosure((current) => toggleLoopDisclosure(current ?? { ...facts, open: facts.mode !== 'clean', userSet: false })); }, "aria-expanded": open, "data-loop-toggle": true, children: [_jsx(Chevron, { open: open }), _jsx("span", { className: css.loopTitle, children: t('members.toggle', { count: loop.rounds.length }) })] }), _jsx("span", { className: css.loopHint, children: open ? t('dependency.hint.chain') : t('task.summary.waitingSchedule') })] }), open && (_jsx("ol", { className: css.loopList, children: loop.rounds.map((entry) => (_jsxs("li", { className: css.loopRound, "data-tone": discarded ? 'cancelled' : entry.tone, children: [_jsx("span", { className: css.loopRoundMarker, "aria-hidden": true, children: entry.round }), _jsxs("span", { className: css.loopRoundBody, children: [_jsx("span", { className: css.loopRoundTone, "data-tone": discarded ? 'cancelled' : entry.tone, children: discarded ? t('task.status.notRun') : t(ROUND_TONE_LABEL[entry.tone] ?? 'task.status.failed') }), _jsx("span", { className: css.loopRoundTasks, children: entry.tasks.map((task) => (_jsx("button", { type: "button", className: css.loopTask, "data-tone": discarded ? 'cancelled' : taskLoopTone(task), onClick: () => { onSelectTask?.(task.id); }, title: taskTitle(task, ''), children: task.id }, task.id))) })] }), _jsx("span", { className: css.loopStatusTail, "data-tone": discarded ? 'cancelled' : entry.tone, children: discarded ? t('task.status.notRun') : roundTailCounts(entry.tasks, (key, params) => t(key, params), t('format.listSeparator')) })] }, entry.round))) }))] }));
}
function ProgressOverview({ team, t, discarded = false }) {
    const running = discarded ? 0 : team.tasks.filter((task) => task.state === 'running').length;
    const blocked = discarded ? 0 : team.tasks.filter((task) => task.state === 'blocked').length;
    const completed = discarded ? 0 : team.tasks.filter((task) => task.status === 'completed').length;
    const settled = !discarded && team.tasks.length > 0 && team.tasks.every((task) => (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'));
    const summaryTone = discarded ? 'discarded' : blocked > 0 || team.tasks.some(task => task.status === 'failed' || task.status === 'cancelled') ? 'warning' : settled ? 'completed' : 'running';
    return (_jsxs("section", { className: css.progressOverview, "aria-label": t('progress.aria'), "data-progress-summary": true, children: [_jsx("span", { className: css.progressTitle, children: t('progress.title') }), team.tasks.length > 0 ? (_jsx("span", { className: css.progressSegments, "aria-hidden": true, children: team.tasks.map((task) => _jsx("span", { "data-state": discarded ? 'cancelled' : taskTerminalTone(task) }, task.id)) })) : _jsx("span", { className: css.progressEmpty }), _jsxs("span", { className: css.progressLegend, children: [_jsx("span", { "data-state": "running", children: t('progress.running', { count: running }) }), _jsx("span", { "data-state": "blocked", children: t('progress.blocked', { count: blocked }) }), _jsx("span", { "data-state": "completed", children: t('progress.delivered', { count: completed }) })] }), _jsxs("span", { className: css.progressSummary, "data-state": summaryTone, children: [_jsx("span", { className: css.progressSummaryDot }), _jsx("span", { children: taskSummary(team, t, discarded) })] })] }));
}
function DependencyMap({ tasks, members, t, discarded = false, workspace = false, onSelectTask }) {
    const [open, setOpen] = useState(true);
    const [hoverTaskId, setHoverTaskId] = useState(null);
    const [keyboardTaskId, setKeyboardTaskId] = useState(null);
    const [pinnedTaskId, setPinnedTaskId] = useState(null);
    const hoverTimer = useRef(null);
    const focusedTaskId = dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId);
    const nodeWidth = workspace ? 164 : COMPACT_DAG_NODE_WIDTH;
    const nodeHeight = workspace ? 76 : COMPACT_DAG_NODE_HEIGHT;
    const layout = useMemo(() => compactDagLayout(tasks, workspace
        ? { nodeWidth: 164, nodeHeight: 76, columnGap: 36, rowGap: 16 } : undefined), [tasks, workspace]);
    const parallel = useMemo(() => usesParallelTaskGrid(tasks), [tasks]);
    const related = useMemo(() => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks), [focusedTaskId, tasks]);
    const scheduleHover = (id) => {
        if (hoverTimer.current !== null) {
            clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
        if (id === null) {
            setHoverTaskId(null);
            return;
        }
        hoverTimer.current = setTimeout(() => {
            hoverTimer.current = null;
            setHoverTaskId(id);
        }, 180);
    };
    useEffect(() => () => {
        if (hoverTimer.current !== null)
            clearTimeout(hoverTimer.current);
    }, []);
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                setPinnedTaskId(null);
                onSelectTask?.(null);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => { window.removeEventListener('keydown', onKeyDown); };
    }, [onSelectTask]);
    if (tasks.length === 0)
        return null;
    const fallbackTask = tasks.find((task) => task.state === 'blocked')
        ?? tasks.find((task) => task.state === 'running')
        ?? tasks[0];
    const detailTask = tasks.find((task) => task.id === focusedTaskId) ?? fallbackTask;
    const detailModel = taskModelLabel(detailTask, members);
    const waitingOn = detailTask.dependencies.filter((dependency) => (tasks.find((task) => task.id === dependency)?.status !== 'completed'));
    const dependents = tasks.filter((task) => task.dependencies.includes(detailTask.id));
    return (_jsxs("section", { className: css.dependencySection, "aria-label": t('dependency.aria'), "data-dependency-map": true, children: [_jsxs("header", { className: css.sectionHead, children: [_jsxs("button", { type: "button", className: css.sectionToggleTitle, onClick: () => { setOpen((current) => !current); }, "aria-expanded": open, children: [_jsx(Chevron, { open: open }), _jsx(IconBranchOutline16, {}), " ", t(parallel ? 'dependency.parallel' : 'dependency.title')] }), _jsx("span", { className: css.sectionHint, children: pinnedTaskId === null
                            ? t(parallel ? 'dependency.hint.parallel' : workspace ? 'workspace.dependencies' : 'dependency.hint.chain')
                            : t('dependency.hint.pinned', { taskId: pinnedTaskId }) })] }), open && (_jsxs(_Fragment, { children: [_jsx("div", { className: css.dagViewport, children: _jsxs("div", { className: css.dagCanvas, "data-layout": parallel ? 'parallel' : 'dependency', style: parallel ? undefined : { width: layout.width, height: layout.height }, children: [!parallel && _jsx("svg", { className: css.dagEdges, width: layout.width, height: layout.height, "aria-hidden": true, children: layout.edges.map((edge) => {
                                        const active = related !== null && related.has(edge.from) && related.has(edge.to);
                                        return _jsx("path", { d: edge.path, "data-active": active, "data-dimmed": related !== null && !active }, `${edge.from}:${edge.to}`);
                                    }) }), layout.nodes.map(({ task, x, y }) => {
                                    const model = taskModelLabel(task, members);
                                    return (_jsxs("button", { type: "button", className: css.dagNode, style: parallel
                                            ? { height: nodeHeight }
                                            : { left: x, top: y, width: nodeWidth, height: nodeHeight }, "data-task-id": task.id, "data-state": discarded ? 'cancelled' : taskTerminalTone(task), "data-task-model": model || undefined, "data-focused": related?.has(task.id) ?? false, "data-dimmed": related !== null && !related.has(task.id), "aria-pressed": pinnedTaskId === task.id, title: taskTitle(task, model), onClick: () => { const next = pinnedTaskId === task.id ? null : task.id; setPinnedTaskId(next); onSelectTask?.(next); }, onMouseEnter: () => { scheduleHover(task.id); }, onMouseLeave: () => { scheduleHover(null); }, onFocus: () => { setKeyboardTaskId(task.id); }, onBlur: () => { setKeyboardTaskId(null); }, children: [_jsxs("span", { className: css.dagNodeHead, children: [_jsx("span", { className: css.dagNodeDot }), task.id, workspace && _jsx("span", { className: css.dagOwner, children: task.assignee || t('task.assignee.unclaimed') })] }), _jsx("span", { className: css.dagNodeLabel, children: workspace ? task.subject : compactTaskLabel(task.subject) }), task.state === 'running' && (_jsx("span", { className: css.dagRunningState, "aria-label": t('task.runningAria'), children: _jsx(WorkGlyph, { active: true }) }))] }, task.id));
                                })] }) }), _jsxs("section", { className: css.taskDetail, "data-task-detail": detailTask.id, children: [_jsxs("span", { className: css.taskDetailHead, children: [_jsx("span", { className: css.taskDetailId, children: detailTask.id }), _jsx("span", { className: css.taskDetailSubject, title: detailTask.subject, children: detailTask.subject.replace(/^开发\s*/u, '') }), _jsx("span", { className: css.taskDetailBadge, "data-state": discarded ? 'cancelled' : taskTerminalTone(detailTask), children: discarded ? t('task.status.notRun') : taskStatusLabel(detailTask.status, t) })] }), _jsxs("span", { className: css.taskDetailLine, children: [detailTask.assignee || t('task.assignee.unclaimed'), " \u00B7 ", discarded
                                        ? t('task.detail.notRun')
                                        : detailTask.status === 'completed'
                                            ? t('task.detail.completed')
                                            : detailTask.status === 'cancelled'
                                                ? t('task.detail.cancelled')
                                                : detailTask.status === 'failed'
                                                    ? t('task.detail.failed')
                                                    : detailTask.dependencies.length === 0
                                                        ? t('task.detail.noPrerequisite')
                                                        : waitingOn.length === 0
                                                            ? t('task.detail.ready')
                                                            : t('task.detail.waitingOn', { tasks: formatTaskIds(waitingOn, t) })] }), detailModel !== '' && (_jsx("span", { className: css.taskDetailModel, "data-task-model": detailModel, children: t('task.model', { model: detailModel }) })), _jsx("span", { className: css.taskDetailMeta, children: dependents.length === 0
                                    ? t('task.detail.noDownstream')
                                    : t('task.detail.unlocks', { tasks: formatTaskIds(dependents.map((task) => task.id), t) }) })] })] }))] }));
}
export function TeamSection({ team, modelDirectory, onContinuePlanning, onDiscarded, onNavigate, t, historic = false, workspace = false }) {
    const [selectedTaskId, setSelectedTaskId] = useState(null);
    const selectedAssignee = team.tasks.find(task => task.id === selectedTaskId)?.assignee;
    const [membersOpen, setMembersOpen] = useState(workspace);
    const [stopOpen, setStopOpen] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [stopError, setStopError] = useState('');
    /**
     * ── ★★★ R2：成员的**展开**状态 ────────────────────────────────────────────────
     *
     * ★ 默认**收起**：`memberRowExpanded` 对"没有条目"返回 `false`，所以初值是一个
     *   **值**，不是一条缺席分支 —— 一次新渲染不可能顺手把每一行都打开。
     *
     * ★ 用户的选择活得过重渲染：它存在这里（不是每次渲染重算的派生态），
     *   所以下一轮轮询回来读到的仍然是用户按下的那个。
     *
     * ★ 按**成员 id** 存（未启动的成员退化成名字）：轮询会重排名册，
     *   而按位置存会把一个成员的展开状态**交给另一个成员**。
     */
    const [expansion, setExpansion] = useState(() => new Map());
    const toggleMember = useCallback((key) => {
        setExpansion((current) => toggleMemberRow(current, key));
    }, []);
    /**
     * ★ 打开一个会话（成员本身，或它底下的一个子代理）。两个都走同一条路：
     *   `navigateToSession` 会立刻收起浮动面板 —— 那是一次**明确的离开**。
     */
    const onNavigateMember = useCallback((childId) => {
        if (childId === '')
            return;
        onNavigate(team.captainSessionId, childId);
    }, [onNavigate, team.captainSessionId]);
    /**
     * ★ 剪掉不在册的展开条目。放在 effect 里而**不是**渲染期：渲染必须是纯的。
     *   store 只在用户真的按过某一行时才有条目，所以这里剪的永远是"被重生成
     *   替换掉的那一行"留下的残条。
     */
    const rosterKey = team.members.map((member) => memberRowKey(member)).join('\u0000');
    useEffect(() => {
        setExpansion((current) => pruneMemberRows(current, rosterKey === '' ? [] : rosterKey.split('\u0000')));
    }, [rosterKey]);
    const discarded = historic && team.phase === 'staged';
    const stopped = !historic && team.halted === true;
    const busyCount = team.members.filter((member) => member.activity === 'working').length;
    const assignedCount = team.tasks.filter((task) => task.assignee !== '' && task.assignee !== CAPTAIN_ASSIGNEE).length;
    const captainOwned = team.tasks.filter((task) => task.assignee === CAPTAIN_ASSIGNEE
        && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled');
    const captainBusy = captainOwned.length > 0;
    const captainTaskIds = formatTaskIds(captainOwned.map((task) => task.id), t);
    const completedCount = team.tasks.filter((task) => task.status === 'completed').length;
    const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length;
    const allSettled = team.tasks.length > 0 && team.tasks.every((task) => (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'));
    const unfinishedCount = team.tasks.filter((task) => (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled')).length;
    const canStop = !historic && team.phase === 'running' && team.halted !== true && teamIsActive(team);
    const stopTeam = async () => {
        if (stopping)
            return;
        setStopping(true);
        setStopError('');
        try {
            const response = await fetch(ACTIVITY_HALT_URL, {
                method: 'POST',
                cache: 'no-store',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionId: team.captainSessionId, teamId: team.teamId }),
            });
            if (!response.ok) {
                let message = t('team.stopRequestFailed');
                try {
                    const body = await response.json();
                    if (typeof body.error === 'string' && body.error.trim() !== '')
                        message = body.error;
                }
                catch { }
                throw new Error(message);
            }
            setStopOpen(false);
        }
        catch (error) {
            setStopError(t('team.stopFailed', { message: error instanceof Error ? error.message : String(error) }));
        }
        finally {
            setStopping(false);
        }
    };
    return (_jsxs(_Fragment, { children: [_jsxs("section", { className: css.team, "data-team-id": team.teamId, "data-workspace-team": workspace || undefined, children: [_jsxs("header", { className: css.teamHead, children: [_jsx("span", { className: css.teamName, title: team.name, children: team.name }), historic && _jsx("span", { className: css.historicPill, children: t(discarded ? 'team.discarded' : 'team.ended') }), stopped && _jsx("span", { className: css.historicPill, children: t('team.stopped') }), _jsxs("span", { className: css.teamStats, children: [_jsx("span", { "data-stat": "members", children: t('team.stats.members', { count: team.members.length }) }), _jsx("span", { "data-stat": "tasks", children: t('team.stats.completed', { completed: completedCount, total: team.tasks.length }) }), _jsx("span", { "data-stat": "messages", children: t('team.stats.messages', { count: team.messageCount }) })] }), canStop && (_jsx("button", { type: "button", className: css.teamStopButton, "aria-label": t('team.stop'), title: t('team.stop'), onClick: () => { setStopError(''); setStopOpen(true); }, children: _jsx(IconStopFill16, {}) }))] }), team.phase === 'staged' && !historic && modelDirectory !== undefined && onContinuePlanning !== undefined && onDiscarded !== undefined && (_jsx(StagingPlanEditor, { team: team, modelDirectory: modelDirectory, onContinuePlanning: onContinuePlanning, onDiscarded: onDiscarded, t: t })), _jsxs("section", { className: css.delegationSection, "aria-label": t('delegation.aria'), "data-delegation-map": true, children: [_jsxs("div", { className: css.captainNode, children: [_jsx("span", { className: css.captainAvatar, children: _jsx("img", { className: css.leadAvatar, src: LEAD_ART, alt: "", "aria-hidden": true }) }), _jsxs("span", { className: css.captainInfo, children: [_jsxs("span", { className: css.captainLine, children: [_jsx("span", { className: css.captainName, children: t('captain.name') }), _jsx("span", { className: css.captainRole, children: t('captain.role') })] }), _jsx("span", { className: css.captainSummary, children: discarded
                                                    ? t('captain.summary.discarded', { tasks: team.tasks.length, members: team.members.length })
                                                    : captainBusy
                                                        ? t('captain.summary.withTakeover', { tasks: assignedCount, captainTasks: captainTaskIds })
                                                        : team.phase === 'staged'
                                                            ? t(team.planReviewState === 'awaiting_feedback'
                                                                ? 'captain.summary.awaitingFeedback'
                                                                : 'captain.summary.staged', { tasks: team.tasks.length, members: team.members.length })
                                                            : t('captain.summary', { tasks: assignedCount, members: team.members.length }) })] }), _jsxs("span", { className: css.captainState, "data-busy": captainBusy || busyCount > 0, children: [_jsx(WorkGlyph, { active: captainBusy || busyCount > 0 }), discarded
                                                ? t('captain.state.discarded')
                                                : captainBusy
                                                    ? t('captain.state.takeover', { tasks: captainTaskIds })
                                                    : team.phase === 'staged'
                                                        ? t(team.planReviewState === 'awaiting_feedback'
                                                            ? 'captain.state.awaitingFeedback'
                                                            : 'captain.state.staged')
                                                        : busyCount > 0
                                                            ? t('captain.state.working', { count: busyCount })
                                                            : t(allCompleted
                                                                ? 'captain.state.collected'
                                                                : allSettled
                                                                    ? 'captain.state.settled'
                                                                    : 'captain.state.waiting')] })] }), (discarded || stopped) && (_jsx("p", { className: css.teamTerminalNote, "data-team-terminal": discarded ? 'discarded' : 'stopped', children: discarded ? t('member.status.discarded') : t('member.status.stopped') })), _jsx(ProgressOverview, { team: team, t: t, discarded: discarded }), (() => {
                                const orderedMembers = orderDelegationMembers(team.members, team.tasks);
                                /**
                                 * ★★★ R2：第一屏是**成员中心**的（用户原话：the first screen should show
                                 *   durable roles, and clicking one expands to show the subagents working
                                 *   underneath it, together with round information）。
                                 *
                                 * ★ 而"谁在动"这条折叠口径保留（issue #192）：收起时只列**还在动**的成员，
                                 *   展开时把已结束的也列出来并按结束时间倒序。原因没变 —— 一个不动的成员
                                 *   占着行会让"整队在不在动"这个第一问读不出来。
                                 */
                                const runningMembers = orderedMembers.filter((member) => (member.activity === 'working' || member.status === 'working'
                                    || team.tasks.some((task) => task.assignee === member.name
                                        && (task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress'))));
                                const visibleMembers = membersOpen ? orderedMembers : runningMembers;
                                const hiddenFinishedCount = orderedMembers.length - visibleMembers.length;
                                const expandLabel = membersOpen
                                    ? t('members.collapse')
                                    : hiddenFinishedCount > 0
                                        ? t('members.expandFinished', { count: hiddenFinishedCount })
                                        : t('members.expand');
                                /**
                                 * ★ 展开存活的键 = 当前名册定义的那些键。不在册的条目会被**剪掉** ——
                                 *   否则这个 store 会随面板（一个跨会话存活的 shell-overlay 单例）
                                 *   一直长下去，而没有任何一行再引用那些键。
                                 */
                                const rosterKeys = orderedMembers.map((member) => memberRowKey(member));
                                return (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: css.membersToggle, onClick: () => { setMembersOpen((current) => !current); }, "aria-expanded": membersOpen, "data-members-toggle": true, children: [_jsxs("span", { children: [_jsx(Chevron, { open: membersOpen }), t('members.toggle', { count: team.members.length })] }), _jsx("span", { children: expandLabel })] }), (membersOpen || visibleMembers.length > 0) && _jsxs("div", { className: css.delegationTree, "data-member-rows": visibleMembers.length, children: [team.members.length === 0 && _jsx("span", { className: css.emptyHint, children: t('members.empty') }), visibleMembers.map((member) => {
                                                    const key = memberRowKey(member);
                                                    /**
                                                     * ── ★★ 面板在这一行上**探出**两件事，而不是"把它们交给子组件就算完"──
                                                     *
                                                     * ① `activity`：收起的成员列表要一眼看出"这一行在不在动"，
                                                     *    而 `data-activity` 是宿主语义色（business color）挂上去的那个钩子。
                                                     * ② `memberModel`：这个成员跑在哪个路由上 —— 用户要的第一屏是
                                                     *    "谁在做什么"，而"用哪个模型做"是这件事的一部分。
                                                     *
                                                     * ★ 两格都是**读**，不是第二份真相：`MemberRow` 用的是同一个
                                                     *   `memberRouteLabel` / `member.activity`，判定口径只有一个。
                                                     */
                                                    const memberModel = memberRouteLabel(member);
                                                    /**
                                                     * ★ "这个成员正在做什么"，到**任务 + 模型**这一层。
                                                     *   用户要的第一屏是 "who is doing what"，而"用哪个模型在做"
                                                     *   是同一件事的一半 —— 所以它是同一行字，不是另一个标签。
                                                     *   读不出当前任务时不编一个（`member.status.working` 兜底）。
                                                     */
                                                    const currentTask = team.tasks.find((task) => task.id === member.currentTask
                                                        && task.assignee === member.name);
                                                    const doingModel = currentTask === undefined ? '' : taskModelLabel(currentTask, [member]);
                                                    const doingText = currentTask === undefined
                                                        ? t('member.status.working')
                                                        : doingModel === ''
                                                            ? t('member.status.executing', { taskId: currentTask.id })
                                                            : t('member.status.executingModel', { taskId: currentTask.id, model: doingModel });
                                                    return (
                                                    /**
                                                     * ★★ 面板在这一格上**读**两件事（它们是宿主的语义色与模型探针）：
                                                     *   · `data-activity` —— 行在不在动（CSS 用宿主的 business color）
                                                     *   · 模型路由 —— 那一格的**读数**由 `MemberRow` 交出（见下）。
                                                     * ★ 判定口径只有一份：`memberRouteLabel` 与 `member.activity`。
                                                     */
                                                    _jsx("div", { 
                                                        /**
                                                         * ★ 槽的类名跟着**有没有模型**走：`.memberModel` 是那一格的
                                                         *   排版契约（就地省略号、不撑破面板），而"这一行有没有模型"
                                                         *   是面板这一层知道的事。行本身不认识这个类。
                                                         */
                                                        /**
                                                         * ★ 槽的**布局类**由面板给：这一行有没有模型，面板知道；
                                                         *   而 `.memberModel` 是"就地省略号、不撑破面板"的排版口径。
                                                         *   行负责**画**那一格，面板负责**给它留位置**。
                                                         */
                                                        className: memberModel === '' ? css.memberSlot : `${css.memberSlot} ${css.memberModel}`, "data-activity": member.activity, "data-member-doing": doingText, children: _jsx(MemberRow, { team: team, member: member, tasks: team.tasks, 
                                                            /**
                                                             * ★ 面板算一次，行里只负责画：模型路由与"能不能改"，
                                                             *   各只有一条判据（`memberRouteLabel` / `memberModelEditability`）。
                                                             */
                                                            memberModel: memberModel, memberModelEditable: memberModelEditability(member), expanded: memberRowExpanded(expansion, key), onToggle: toggleMember, onOpenSubagent: onNavigateMember, onSelectTask: setSelectedTaskId, modelDirectory: modelDirectory, t: t, historic: historic, discarded: discarded, stopped: stopped }) }, key));
                                                })] })] }));
                            })()] }), _jsx(ReviewLoopSection, { tasks: team.tasks, t: t, discarded: discarded, onSelectTask: setSelectedTaskId }), _jsx(DependencyMap, { tasks: team.tasks, members: team.members, t: t, discarded: discarded, workspace: workspace, onSelectTask: setSelectedTaskId })] }), _jsx(Modal, { open: stopOpen, onClose: () => { if (!stopping)
                    setStopOpen(false); }, title: t('team.stopTitle', { team: team.name }), closeLabel: t('plan.cancel'), description: t('team.stopDescription', { tasks: unfinishedCount, members: busyCount }), footer: (_jsxs("span", { className: css.stopModalActions, children: [_jsx("button", { type: "button", disabled: stopping, onClick: () => { setStopOpen(false); }, children: t('team.stopCancel') }), _jsxs("button", { type: "button", "data-danger": true, disabled: stopping, onClick: () => { void stopTeam(); }, children: [_jsx(IconStopFill16, {}), stopping ? t('team.stopping') : t('team.stopConfirm')] })] })), children: stopError !== '' && _jsxs("p", { className: css.stopModalError, role: "alert", children: [_jsx(IconWarningOutline16, {}), stopError] }) })] }));
}
/** Legacy conversation cards may outlive their host archive. Project their
 * durable roster through the same rebuilt panel instead of a second UI. */
export function historicCardTeam(data, owner) {
    return {
        workspace: '',
        teamId: data.teamId,
        name: data.teamName,
        captainSessionId: data.captainSessionId || owner,
        phase: 'running',
        members: data.members.map((member) => ({
            ...member,
            status: 'removed',
            activity: 'idle',
            progress: 0,
            done: 0,
            total: 0,
            currentTask: '',
            unread: 0,
        })),
        tasks: [],
        messageCount: 0,
        captainInbox: [],
    };
}
export function ActivityPanel({ sessionsList, modelDirectories, openMember, t, conversationVisible = true }) {
    // Navigating to a member's subagent transcript is an explicit departure:
    // hide the floater immediately instead of waiting out the autocollapse
    // grace, so the panel never lingers over the member session.
    const navigateToSession = (parentId, childId) => {
        setOpen(false);
        setWasActive(false);
        openMember(parentId, childId);
    };
    const [open, setOpen] = useState(false);
    const [openOwner, setOpenOwner] = useState();
    const [autoOpened, setAutoOpened] = useState(false);
    const [wasActive, setWasActive] = useState(false);
    const [historic, setHistoric] = useState(new Map());
    const [layout, setLayout] = useState(initialPanelLayout);
    const [bounds, setBounds] = useState(initialPanelBounds);
    const [interaction, setInteraction] = useState(null);
    const panelRef = useRef(null);
    const boundsRef = useRef(bounds);
    const gestureRef = useRef(null);
    const frameRef = useRef(null);
    const pendingLayoutRef = useRef(null);
    const current = currentSessionId(useSyncExternalStore(sessionsList.subscribe, sessionsList.getSnapshot));
    const autoOpenTrackerRef = useRef({ sessionId: current, restoreComplete: false, liveTeamIds: new Set() });
    const monitorTargets = useSyncExternalStore(subscribeActivityMonitorTargets, getActivityMonitorTargetsSnapshot);
    const returnToComposer = () => {
        setOpen(false);
        setOpenOwner(undefined);
        window.requestAnimationFrame(() => {
            document.querySelector('[data-composer-card] [contenteditable="true"][role="textbox"], [data-composer-card] textarea')?.focus();
        });
    };
    const { teams, archivedTeams } = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
    const currentTargets = useMemo(() => current === undefined ? [] : monitorTargets.filter((target) => target.sessionId === current), [current, monitorTargets]);
    const currentRef = useRef(current);
    useEffect(() => { currentRef.current = current; }, [current]);
    const mountedAtRef = useRef(performance.now());
    const expanded = conversationVisible && activityPanelExpandedForSession(open, openOwner, current);
    const geometry = useMemo(() => resolvePanelGeometry(layout, bounds), [layout, bounds]);
    const compact = compactPanelForBounds(bounds);
    const commitLayout = useCallback((next) => {
        setLayout(next);
    }, []);
    useEffect(() => {
        window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    }, [layout]);
    // The slot sits inside AppFrame, so all geometry is measured against the
    // shell overlay rather than the browser viewport. The conversation's real
    // right edge is the dock anchor and naturally follows sidebar/details
    // concessions without importing their hashed implementation classes.
    useLayoutEffect(() => {
        const overlay = document.querySelector('[data-shell-overlay]');
        if (overlay === null)
            return;
        const conversation = document.querySelector("[data-phase='active']");
        let frame = null;
        const measure = () => {
            frame = null;
            const overlayRect = overlay.getBoundingClientRect();
            const conversationRect = conversation?.getBoundingClientRect();
            const next = {
                width: overlayRect.width,
                height: overlayRect.height,
                anchorRight: conversationRect === undefined
                    ? overlayRect.width
                    : Math.min(Math.max(conversationRect.right - overlayRect.left, 0), overlayRect.width),
            };
            const previous = boundsRef.current;
            if (previous.width === next.width
                && previous.height === next.height
                && previous.anchorRight === next.anchorRight)
                return;
            boundsRef.current = next;
            setBounds(next);
        };
        const scheduleMeasure = () => {
            frame ??= requestAnimationFrame(measure);
        };
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
        observer?.observe(overlay);
        if (conversation !== null)
            observer?.observe(conversation);
        window.addEventListener('resize', scheduleMeasure);
        return () => {
            if (frame !== null)
                cancelAnimationFrame(frame);
            observer?.disconnect();
            window.removeEventListener('resize', scheduleMeasure);
        };
    }, [current]);
    // This shell overlay survives conversation route changes. Gate expansion by its
    // owning session during render, then clear stale state before paint. This
    // removes the old panel immediately instead of waiting for the no-team
    // autoclose grace period on the destination page.
    useLayoutEffect(() => {
        const tracker = autoOpenTrackerRef.current;
        if (tracker.sessionId !== current) {
            tracker.sessionId = current;
            tracker.restoreComplete = false;
            tracker.liveTeamIds = new Set();
            setWasActive(false);
            setAutoOpened(false);
        }
        if (openOwner === undefined || openOwner === current)
            return;
        setOpen(false);
        setOpenOwner(undefined);
    }, [current, openOwner]);
    // Only the wide docked mode asks the conversation column to yield. Floating
    // and compact modes are intentionally true overlays. The width is written as
    // one shared variable so the panel and the concession cannot drift apart.
    useLayoutEffect(() => {
        const root = document.documentElement;
        const shouldYield = expanded && geometry.mode === 'docked' && !compact;
        if (shouldYield) {
            root.setAttribute(PANEL_OPEN_ATTRIBUTE, '');
            root.style.setProperty(PANEL_SHIFT_PROPERTY, `${geometry.width + PANEL_CONVERSATION_GAP + 18}px`);
        }
        else {
            root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
            root.style.removeProperty(PANEL_SHIFT_PROPERTY);
        }
        return () => {
            root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
            root.style.removeProperty(PANEL_SHIFT_PROPERTY);
        };
    }, [compact, expanded, geometry.mode, geometry.width]);
    useEffect(() => {
        if (current === undefined)
            return;
        // Cards keep live teams on the normal cadence. The current-session scope
        // also performs one cold-start discovery pass so archived/cardless teams
        // survive a browser or `dsh web` restart.
        const controller = startActivityPolling(currentTargets, { discoverySessionId: current });
        let active = true;
        const tracker = autoOpenTrackerRef.current;
        if (tracker.sessionId === current && !tracker.restoreComplete) {
            void controller.firstTick.then(() => {
                const latest = autoOpenTrackerRef.current;
                if (!active || latest.sessionId !== current || latest.restoreComplete)
                    return;
                latest.liveTeamIds = new Set(getActivitySnapshotsSnapshot().teams
                    .filter((team) => team.captainSessionId === current)
                    .map((team) => team.teamId));
                latest.restoreComplete = true;
            });
        }
        return () => {
            active = false;
            controller.stop();
        };
    }, [current, currentTargets]);
    useEffect(() => {
        const onOpenPanel = (event) => {
            const activeSession = currentRef.current;
            if (activeSession === undefined)
                return;
            setOpenOwner(activeSession);
            setOpen(true);
            const detail = event.detail;
            if (detail?.teamId !== undefined) {
                // A card from a log that predates captainSessionId belongs to the
                // session that activated it (the current one at injection time).
                const owner = detail.captainSessionId !== '' ? detail.captainSessionId : currentRef.current ?? '';
                const teamKey = `${owner}:${detail.teamId}`;
                setHistoric((previous) => {
                    const next = new Map(previous);
                    next.set(teamKey, { data: detail, owner });
                    return next;
                });
            }
        };
        window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel);
        return () => {
            window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel);
        };
    }, []);
    // Teams follow the current session: live snapshots and historic card
    // summaries are visible only while their captain session is current.
    const visibleTeams = useMemo(
    // No current session (initial load): show nothing until one is picked,
    // so cross-session teams never leak into the floater.
    () => (current === undefined ? [] : teams.filter((team) => team.captainSessionId === current)), [teams, current]);
    const visibleHistoric = useMemo(() => (current === undefined ? [] : [...historic.values()].filter(({ data, owner }) => owner === current && !teams.some((live) => live.captainSessionId === current && live.teamId === data.teamId) && !archivedTeams.some((archived) => archived.captainSessionId === current && archived.teamId === data.teamId))), [historic, current, teams, archivedTeams]);
    const visibleArchived = useMemo(() => (current === undefined ? [] : archivedTeams.filter((team) => team.captainSessionId === current && !teams.some((live) => live.captainSessionId === current && live.teamId === team.teamId))), [archivedTeams, current, teams]);
    const visibleCount = visibleTeams.length + visibleArchived.length + visibleHistoric.length;
    const visibleLiveTeamIds = useMemo(() => visibleTeams.map((team) => team.teamId).sort(), [visibleTeams]);
    const visibleLiveTeamKey = visibleLiveTeamIds.join('\u0000');
    useEffect(() => {
        const tracker = autoOpenTrackerRef.current;
        const settled = performance.now() - mountedAtRef.current >= AUTO_OPEN_SETTLE_MS;
        const shouldAutoExpand = tracker.sessionId === current && activityPanelShouldAutoExpand({
            alreadyAutoOpened: autoOpened,
            pageSettled: settled,
            restoreComplete: tracker.restoreComplete,
            previousLiveTeamIds: tracker.liveTeamIds,
            currentLiveTeamIds: visibleLiveTeamIds,
        });
        if (tracker.sessionId === current && tracker.restoreComplete) {
            tracker.liveTeamIds = new Set(visibleLiveTeamIds);
        }
        if (visibleCount > 0) {
            setWasActive(true);
            // Existing state restored for a reopened conversation stays collapsed.
            // Only a live team that appears after the restore pass may auto-expand.
            if (shouldAutoExpand) {
                setOpenOwner(current);
                setOpen(true);
                setAutoOpened(true);
            }
            return;
        }
        if (!wasActive)
            return;
        const timer = setTimeout(() => {
            setOpen(false);
            setOpenOwner(undefined);
            setWasActive(false);
            // Re-arm auto-expand: a later activity (new team, new session) may
            // open the panel on its own again.
            setAutoOpened(false);
        }, AUTOCLOSE_GRACE_MS);
        return () => { clearTimeout(timer); };
    }, [visibleCount, visibleLiveTeamKey, autoOpened, wasActive, current]);
    const busy = useMemo(() => visibleTeams.some((team) => team.members.some((member) => member.activity === 'working')), [visibleTeams]);
    const hasTeams = visibleCount > 0;
    // Auto-height panels do not store their live content height. Capture the
    // rendered box when a pointer gesture starts so movement and a first manual
    // resize clamp against what the user actually sees.
    const panelGeometryForGesture = useCallback(() => {
        const measuredHeight = panelRef.current?.getBoundingClientRect().height;
        if (measuredHeight === undefined || measuredHeight <= 0)
            return geometry;
        return { ...geometry, height: measuredHeight };
    }, [geometry]);
    const flushScheduledLayout = useCallback(() => {
        if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
        const pending = pendingLayoutRef.current;
        pendingLayoutRef.current = null;
        if (pending !== null)
            commitLayout(pending);
    }, [commitLayout]);
    const scheduleLayout = useCallback((next) => {
        pendingLayoutRef.current = next;
        frameRef.current ??= requestAnimationFrame(() => {
            frameRef.current = null;
            const pending = pendingLayoutRef.current;
            pendingLayoutRef.current = null;
            if (pending !== null)
                commitLayout(pending);
        });
    }, [commitLayout]);
    useEffect(() => () => {
        if (frameRef.current !== null)
            cancelAnimationFrame(frameRef.current);
    }, []);
    const beginMove = useCallback((event) => {
        if (compact || event.button !== 0 || event.target.closest('button') !== null)
            return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = {
            kind: 'move',
            pointerId: event.pointerId,
            originX: event.clientX,
            originY: event.clientY,
            start: panelGeometryForGesture(),
            activated: false,
        };
    }, [compact, panelGeometryForGesture]);
    const beginResize = useCallback((edge, event) => {
        if (compact || event.button !== 0 || (geometry.mode === 'docked' && edge !== 'left'))
            return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = {
            kind: 'resize',
            edge,
            pointerId: event.pointerId,
            originX: event.clientX,
            originY: event.clientY,
            start: panelGeometryForGesture(),
            activated: true,
        };
        setInteraction('resizing');
    }, [compact, geometry.mode, panelGeometryForGesture]);
    const updateGesture = useCallback((event) => {
        const gesture = gestureRef.current;
        if (gesture === null || gesture.pointerId !== event.pointerId
            || !event.currentTarget.hasPointerCapture(event.pointerId))
            return;
        const dx = event.clientX - gesture.originX;
        const dy = event.clientY - gesture.originY;
        const activeBounds = boundsRef.current;
        if (gesture.kind === 'move') {
            if (!gesture.activated && Math.hypot(dx, dy) < MOVE_THRESHOLD)
                return;
            if (!gesture.activated) {
                gesture.activated = true;
                setInteraction('dragging');
            }
            scheduleLayout(movePanelLayout(floatPanelLayout(gesture.start, activeBounds), dx, dy, activeBounds));
            return;
        }
        scheduleLayout(resizePanelLayout(gesture.start, gesture.edge ?? 'left', dx, dy, activeBounds));
    }, [scheduleLayout]);
    const endGesture = useCallback((event) => {
        const gesture = gestureRef.current;
        if (gesture === null || gesture.pointerId !== event.pointerId)
            return;
        updateGesture(event);
        flushScheduledLayout();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        gestureRef.current = null;
        setInteraction(null);
    }, [flushScheduledLayout, updateGesture]);
    const cancelGesture = useCallback((event) => {
        const gesture = gestureRef.current;
        if (gesture === null || gesture.pointerId !== event.pointerId)
            return;
        flushScheduledLayout();
        gestureRef.current = null;
        setInteraction(null);
    }, [flushScheduledLayout]);
    const toggleDock = useCallback(() => {
        const liveGeometry = panelGeometryForGesture();
        commitLayout(liveGeometry.mode === 'docked'
            ? floatPanelLayout(liveGeometry, boundsRef.current)
            : dockPanelLayout(liveGeometry, boundsRef.current));
    }, [commitLayout, panelGeometryForGesture]);
    const autoHeight = panelUsesAutoHeight(geometry, bounds);
    const panelStyle = {
        width: geometry.width,
        height: autoHeight ? 'auto' : geometry.height,
        maxHeight: panelMaximumHeight(geometry, bounds),
        transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)`,
    };
    if (!conversationVisible || (!hasTeams && !expanded))
        return null;
    return (_jsxs(_Fragment, { children: [!expanded && (_jsx(CollapsedBadge, { count: visibleCount, busy: busy, t: t, onClick: () => {
                    if (current === undefined)
                        return;
                    setOpenOwner(current);
                    setOpen(true);
                } })), expanded && (_jsxs("aside", { ref: panelRef, className: css.panel, style: panelStyle, "data-agent-teams-activity": true, "data-panel-mode": geometry.mode, "data-height-mode": autoHeight ? 'auto' : 'manual', "data-compact": compact || undefined, "data-dragging": interaction === 'dragging' || undefined, "data-resizing": interaction === 'resizing' || undefined, "aria-label": t('activity.panelAria'), children: [_jsxs("header", { className: css.panelHead, onPointerDown: beginMove, onPointerMove: updateGesture, onPointerUp: endGesture, onPointerCancel: cancelGesture, "data-drag-handle": !compact || undefined, children: [_jsxs("span", { className: css.panelTitle, children: [t('activity.title'), _jsx("span", { className: css.panelDot, "data-busy": busy, "aria-hidden": true })] }), _jsxs("span", { className: css.panelControls, children: [!compact && (_jsx("button", { type: "button", className: css.iconButton, "data-control": "dock", "data-mode": geometry.mode, onClick: toggleDock, "aria-label": t(geometry.mode === 'docked' ? 'activity.float' : 'activity.dockRight'), title: t(geometry.mode === 'docked' ? 'activity.float' : 'activity.dockRight'), children: _jsx(IconPanelLeftOutline16, {}) })), _jsx("button", { type: "button", className: css.iconButton, "data-control": "collapse", onClick: () => {
                                            setOpen(false);
                                            setOpenOwner(undefined);
                                        }, "aria-label": t('activity.collapse'), title: t('activity.collapse'), children: _jsx(IconChevronDownOutline14, {}) })] })] }), _jsx("div", { className: css.teams, children: visibleCount === 0
                            ? _jsx("span", { className: css.emptyHint, children: t('activity.empty') })
                            : (_jsxs(_Fragment, { children: [visibleTeams.map((team) => (_jsx(TeamSection, { team: team, modelDirectory: historic
                                            ? undefined
                                            : modelDirectories.directoryFor(team.captainSessionId), onContinuePlanning: returnToComposer, onDiscarded: returnToComposer, onNavigate: navigateToSession, t: t }, team.teamId))), visibleArchived.map((team) => (_jsxs("div", { "data-team-id": team.teamId, "data-historic": true, className: css.archivedWrap, children: [_jsx("span", { className: css.archiveLabel, children: t(team.phase === 'staged' ? 'archive.discardedLabel' : 'archive.label') }), _jsx(TeamSection, { team: team, onNavigate: navigateToSession, t: t, historic: true })] }, `${team.captainSessionId}:${team.teamId}`))), visibleHistoric.map(({ data: team, owner }) => {
                                        const teamKey = `${owner}:${team.teamId}`;
                                        return (_jsx(TeamSection, { team: historicCardTeam(team, owner), onNavigate: navigateToSession, t: t, historic: true }, teamKey));
                                    })] })) }), !compact && (_jsx("div", { className: css.resizeHandle, "data-resize-edge": "left", onPointerDown: (event) => { beginResize('left', event); }, onPointerMove: updateGesture, onPointerUp: endGesture, onPointerCancel: cancelGesture, "aria-hidden": true })), !compact && geometry.mode === 'floating' && (_jsxs(_Fragment, { children: [_jsx("div", { className: css.resizeHandle, "data-resize-edge": "bottom", onPointerDown: (event) => { beginResize('bottom', event); }, onPointerMove: updateGesture, onPointerUp: endGesture, onPointerCancel: cancelGesture, "aria-hidden": true }), _jsx("div", { className: css.resizeHandle, "data-resize-edge": "corner", onPointerDown: (event) => { beginResize('corner', event); }, onPointerMove: updateGesture, onPointerUp: endGesture, onPointerCancel: cancelGesture, "aria-hidden": true })] }))] }))] }));
}
