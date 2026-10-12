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
import { IconChevronDownOutline14, IconPanelLeftOutline16, IconStopFill16, IconWarningOutline16, } from "./icons.js";
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { MemberScreen } from "./MemberScreen.js";
import { DependencyGraph } from "./DependencyGraph.js";
import { currentSessionId } from "./session-navigation.js";
import { activityPanelExpandedForSession, activityPanelShouldAutoExpand, formatTaskIds, teamIsActive, } from "./activity-model.js";
import { ACTIVITY_HALT_URL, getActivityMonitorTargetsSnapshot, getActivitySnapshotsSnapshot, startActivityPolling, subscribeActivityMonitorTargets, subscribeActivitySnapshots, } from "./activity-monitor.js";
import { OPEN_PANEL_EVENT } from "./AgentTeamsCard.js";
import { StagingPlanEditor } from "./StagingPlanEditor.js";
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
export function TeamSection({ team, modelDirectory, onContinuePlanning, onDiscarded, onNavigate, t, historic = false, workspace = false }) {
    const [selectedTaskId, setSelectedTaskId] = useState(null);
    const selectedAssignee = team.tasks.find(task => task.id === selectedTaskId)?.assignee;
    const [stopOpen, setStopOpen] = useState(false);
    /**
     * ★ 打开一个会话（成员本身，或它底下的一个子代理）。两个都走同一条路：
     *   `navigateToSession` 会立刻收起浮动面板 —— 那是一次**明确的离开**。
     */
    const onNavigateMember = useCallback((childId) => {
        if (childId === '')
            return;
        onNavigate(team.captainSessionId, childId);
    }, [onNavigate, team.captainSessionId]);
    const [stopping, setStopping] = useState(false);
    const [stopError, setStopError] = useState('');
    /**
     * ★ 剪掉不在册的展开条目。放在 effect 里而**不是**渲染期：渲染必须是纯的。
     *   store 只在用户真的按过某一行时才有条目，所以这里剪的永远是"被重生成
     *   替换掉的那一行"留下的残条。
     */
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
    return (_jsxs(_Fragment, { children: [_jsxs("section", { className: css.team, "data-team-id": team.teamId, "data-workspace-team": workspace || undefined, children: [_jsxs("header", { className: css.teamHead, children: [_jsx("span", { className: css.teamName, title: team.name, children: team.name }), historic && _jsx("span", { className: css.historicPill, children: t(discarded ? 'team.discarded' : 'team.ended') }), stopped && _jsx("span", { className: css.historicPill, children: t('team.stopped') }), _jsxs("span", { className: css.teamStats, children: [_jsx("span", { "data-stat": "members", children: t('team.stats.members', { count: team.members.length }) }), _jsx("span", { "data-stat": "tasks", children: t('team.stats.completed', { completed: completedCount, total: team.tasks.length }) }), _jsx("span", { "data-stat": "messages", children: t('team.stats.messages', { count: team.messageCount }) })] }), canStop && (_jsx("button", { type: "button", className: css.teamStopButton, "aria-label": t('team.stop'), title: t('team.stop'), onClick: () => { setStopError(''); setStopOpen(true); }, children: _jsx(IconStopFill16, {}) }))] }), team.phase === 'staged' && !historic && modelDirectory !== undefined && onContinuePlanning !== undefined && onDiscarded !== undefined && (_jsx(StagingPlanEditor, { team: team, modelDirectory: modelDirectory, onContinuePlanning: onContinuePlanning, onDiscarded: onDiscarded, t: t })), _jsx(MemberScreen, { team: team, modelDirectory: modelDirectory, onNavigateMember: onNavigateMember, onSelectTask: setSelectedTaskId, t: t, historic: historic, workspace: workspace, discarded: discarded, stopped: stopped, staged: team.phase === 'staged', awaitingFeedback: team.planReviewState === 'awaiting_feedback', captainBusy: captainBusy, busyCount: busyCount, allCompleted: allCompleted, allSettled: allSettled, assignedCount: assignedCount, captainTaskIds: captainTaskIds }), _jsx(DependencyGraph, { tasks: team.tasks, members: team.members, t: t, discarded: discarded, workspace: workspace, onSelectTask: setSelectedTaskId })] }), _jsx(Modal, { open: stopOpen, onClose: () => { if (!stopping)
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
