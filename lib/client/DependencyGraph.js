import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Screen two: the task dependency graph, and nothing else.
 *
 * ── ★★★ R3：这是**纯搬运** + 一次**减法**（用户原话）─────────────────────────────
 *
 *   · "screen two probably only needs to keep the dependency graph"
 *   · "the dependency graph can stay collapsed by default, because most of the
 *      time you do not want to look at that thing"
 *   · 「整个东西挺冗余的，比如它做一些 badge 之类的东西」
 *
 * ⇒ 这个文件只做两件事：**装下那张图**，以及**默认把它收起来**。
 *   搬过来的每一行、每一个 `data-*` 探针、每一句文案都原样保留 ——
 *   于是"搬丢了什么"可以被**集合比对**抓住（见 workspace-activity.test.mjs 的 R3 符号臂）。
 *
 * ★ 收起是一个**值**（`useState(false)`），不是一条缺席分支：一次新渲染不可能
 *   顺手把它打开。展开后的悬停/键盘行为、`Escape` 取消固定、`aria-expanded` 全部照旧。
 * @module dsh-agent-teams/client/dependency-graph
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPACT_DAG_NODE_HEIGHT, COMPACT_DAG_NODE_WIDTH, compactDagLayout, compactTaskLabel, dependencyFocusTaskId, formatTaskIds, relatedTaskIds, taskModelLabel, taskStatusLabel, taskTerminalTone, taskTitle, usesParallelTaskGrid, } from "./activity-model.js";
import { IconBranchOutline16 } from "./icons.js";
import css from './ActivityPanel.module.css';
/**
 * Disclosure chevron — the ONE definition, shared with the panel.
 *
 * ★ 它原来长在 `ActivityPanel.tsx` 里；R3 把图搬出来之后，两边都要它。
 *   放在这里并导出，于是**只有一份**（抄一份就是同一件事的第二个实现）。
 */
export function Chevron({ open }) {
    return (_jsx("svg", { className: css.chevron, "data-open": open, width: "9", height: "9", viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", "aria-hidden": true, children: _jsx("path", { d: "M3.5 2l3 3-3 3" }) }));
}
/** Animated "this task is running" glyph — likewise the ONE definition. */
export function WorkGlyph({ active }) {
    return (_jsx("svg", { className: css.workGlyph, "data-active": active, width: "11", height: "11", viewBox: "0 0 11 11", fill: "currentColor", "aria-hidden": true, children: [[0, 0], [4.2, 0], [8.4, 0], [0, 4.2], [4.2, 4.2], [8.4, 4.2]].map(([x, y], index) => (_jsx("rect", { x: x, y: y, width: "2.6", height: "2.6", rx: ".6", style: { animationDelay: `${index * 0.15}s` } }, `${x}:${y}`))) }));
}
export function DependencyGraph({ tasks, members, t, discarded = false, workspace = false, onSelectTask }) {
    /**
     * ── ★★★ R3：**默认收起**（用户原话）───────────────────────────────────────────
     *
     *   "the dependency graph can stay collapsed by default, because most of the
     *    time you do not want to look at that thing"
     *
     * ★ 收起是一个**值**（`false`），不是一条缺席分支 —— 一次新渲染不可能顺手
     *   把它打开。用户按下标题行之后才展开（`aria-expanded` 如实反映）。
     * ★ 而"收起"**不等于**"看不见"：标题行上的 `dependency.hint.*` 仍然说明
     *   这一屏有什么（悬停高亮/点击固定），所以收起态本身也是一个读数。
     */
    const [open, setOpen] = useState(false);
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
    /**
     * ── ★★★ R3：**没有依赖结构就不画图**（空队 / 单任务 / 全是孤立任务）────────────
     *
     * MEASURED（本臂立之前实测到的形状）：一张"零条边"的图会被渲染成一个
     * **完整但空的画布** —— `dagViewport` + `dagCanvas` 都在 DOM 里，只是里面
     * 没有连线。而它与"这里真的有个依赖关系图"在读者眼里**同形**：
     * 一块占了位置却什么都没说的方块。
     *
     * ★ 判据不是"任务数 ≤ 1"，而是**有没有边**：`layout.edges.length === 0`。
     *   于是：
     *   · 0 个任务          ⇒ 不画（空队没有图可看）
     *   · 1 个任务          ⇒ 不画（一张只有节点的"图"不是依赖关系）
     *   · N 个孤立任务      ⇒ 不画（并行任务没有依赖，`usesParallelTaskGrid` 也说它没有）
     *   · 有任何一条边      ⇒ 画（这才是这一屏存在的原因）
     *
     * ★ 而"没有图可画"**不是**"这一屏坏了"：标题行仍然在（收起态也一样在），
     *   它如实说明这一队此刻没有依赖结构。所以这是一个**读数**，不是一块空白。
     */
    const hasDependencyEdges = layout.edges.length > 0;
    if (tasks.length === 0 || !hasDependencyEdges) {
        return (_jsx("section", { className: css.dependencySection, "aria-label": t('dependency.aria'), "data-dependency-map": true, "data-dependency-state": "no-structure", children: _jsxs("header", { className: css.sectionHead, children: [_jsx("span", { className: css.sectionToggleTitle, "data-dependency-empty-title": true, children: t('dependency.title') }), _jsx("span", { className: css.sectionHint, children: t('dependency.hint.noStructure') })] }) }));
    }
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
