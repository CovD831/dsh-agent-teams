import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * One durable member of a team, as a single row on screen one.
 *
 * ── ★★★ 这一屏要回答什么（用户原话）────────────────────────────────────────────
 *
 *   "is the whole team working, and who is doing what"
 *
 * 而用户对第一屏的**结构**要求是：显示**持久成员**，点开一个成员就看到它底下的
 * **子代理**，轮次信息**一起**给出来（"round data moves UP into screen one"）。
 *
 * ── 一行的四件事（缺一件就是一个"看起来正常但读不出东西"的格子）──────────────
 *
 *   ① 身份      —— 头像 + 名字 + 角色
 *   ② 模型      —— 它跑在哪个路由上（未启动的成员就地可改，复用既有选择器）
 *   ③ 在做什么  —— 当前任务 id + 任务名，读不出就说清是"读不出"
 *   ④ 计时      —— worked N / waiting N / idle / unknown，★ **从不空白**
 *
 * 展开后是它底下的子代理（数据由 R1/t27 送到 /state），每个**各自**说明它在做什么。
 *
 * ── ★ 反例：为什么计时必须单独一个组件 ────────────────────────────────────────
 *
 * 秒表若挂在**这一行**上，一行一 tick ⇒ 整队每秒重渲染。所以时长交给
 * {@link MemberClock}（它自己拥有表），本组件**不持有** `now`。
 * @module dsh-agent-teams/client/member-row
 */
import { useCallback } from 'react';
import { compactModelLabel, memberClock, memberClockStamp, memberRowKey, memberRound, memberSubagentReadout, memberRouteLabel, subagentTone, } from "./activity-model.js";
import { MemberClock } from "./MemberClock.js";
import { MemberModelField, memberModelEditability } from "./StagingPlanEditor.js";
import { ACTION_ART, memberArtUrl } from "./artwork.js";
import { IconChevronDownOutline14 } from "./icons.js";
import css from './ActivityPanel.module.css';
/**
 * ★ t16 遗留：成员模型控件的行内样式。
 *
 * 原来它是 `ActivityPanel.tsx` 里的一个局部常量；R2 把它连同控件一起搬到这里，
 * 因为**用的那一行**才是它的归属。颜色仍然只来自宿主 `--dsw-alias-*` token。
 */
const MEMBER_MODEL_LINE_STYLE = {
    display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '2px 6px 0 60px',
};
/**
 * The tone of one member's status dot.
 *
 * ★ Liveness is read BEFORE `activity`, and the order is the whole point:
 *   `activity` is a durable field that keeps saying `working` after the member's
 *   session dies, so a dead member would keep a "running" dot forever — the
 *   residual reading task t4 exists to remove. A member whose session is gone
 *   while its work is still open therefore reads `stalled` (amber), not `running`.
 *
 * ★ When the host publishes no liveness field, this falls back to `activity`
 *   exactly as before rather than inferring a state nobody measured.
 */
export function memberDotTone(member, context) {
    if (context.discarded === true || context.staged === true)
        return 'dormant';
    if (context.stopped === true || context.historic === true)
        return 'idle';
    const liveness = member.liveness;
    if (liveness !== undefined && liveness !== '') {
        if (liveness === 'working')
            return 'running';
        if (liveness === 'not-live')
            return 'stalled';
        if (liveness === 'never-spawned')
            return 'dormant';
        /** `idle` / `could-not-measure`: alive but not driving, or unmeasured. */
        return 'idle';
    }
    if (member.activity === 'working')
        return 'running';
    return member.activity === 'idle' ? 'idle' : 'dormant';
}
/** Initial-letter fallback for unmatched roles. */
function memberInitial(name) {
    return name.trim().slice(0, 1).toUpperCase() || '?';
}
function stableHash(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
}
const ACCENTS = [
    'var(--dsw-alias-state-business-primary)',
    'var(--dsw-alias-state-success-primary)',
    'var(--dsw-alias-state-error-primary)',
    'var(--dsw-alias-state-warn-primary)',
    'var(--dsw-alias-label-tertiary)',
];
function accentOf(id) {
    return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0];
}
/**
 * What this member is doing right now, in one line.
 *
 * ★ Every branch says *something*: a member with no current task reads "等待队长派工"
 *   rather than an empty line, because "this cell has nothing" and "this member has
 *   nothing to do" must not look the same.
 * @param member - the member row.
 * @param current - the member's task that `currentTask` names, when it resolves.
 * @param owned - every task assigned to this member.
 * @param t - locale lookup.
 */
export function memberDoingText(member, current, owned, t) {
    if (current !== undefined) {
        const subject = current.subject.replace(/^开发\s*/u, '').trim();
        return subject === ''
            ? t('member.doing.task', { taskId: current.id })
            : t('member.doing.taskSubject', { taskId: current.id, subject });
    }
    if (member.activity === 'working')
        return t('member.status.working');
    const open = owned.filter((task) => task.state !== 'completed' && task.state !== 'failed' && task.state !== 'cancelled');
    if (open.length > 0) {
        return t('member.doing.task', { taskId: open[0].id });
    }
    return t('member.status.waitingAssignment');
}
/**
 * What one subagent is doing, in one line.
 *
 * ★ The host hands the raw session status through; an unrecognised value reads
 *   "状态未知" instead of being rounded to "工作中".
 * @param subagent - one live subagent from the /state payload.
 * @param t - locale lookup.
 */
export function subagentDoingText(subagent, t) {
    const tone = subagentTone(subagent.status);
    if (tone === 'working')
        return t('subagent.doing.working');
    if (tone === 'idle')
        return t('subagent.doing.idle');
    return t('subagent.doing.unknown', { status: subagent.status });
}
/** Locale key for one elapsed readout's inline label (used by the row's aria text). */
const CLOCK_LABEL = {
    running: 'member.clock.working',
    stale: 'member.clock.waiting',
    idle: 'member.clock.idle',
    unknown: 'member.clock.unknown',
};
/**
 * Locale key for one round tone.
 *
 * ★ Typed against {@link AgentTeamsLocaleKey} rather than `string` so a typo is
 *   a typecheck failure, not a key that silently renders as its own id.
 */
const ROUND_TONE_LABEL = {
    converging: 'round.tone.converging',
    failed: 'round.tone.failed',
    unmeasured: 'round.tone.unmeasured',
    running: 'round.tone.running',
    open: 'round.tone.open',
    blocked: 'task.status.claimed',
    completed: 'round.tone.completed',
    cancelled: 'task.status.cancelled',
};
/**
 * One member row: identity, model, current work, elapsed state; expansion
 * reveals the live subagents underneath it.
 */
export function MemberRow({ team, member, tasks, expanded, onToggle, onOpenSubagent, onSelectTask, modelDirectory, t, historic = false, discarded = false, stopped = false, frozenNow, memberModel: memberModelProp, memberModelEditable: editableProp, }) {
    const key = memberRowKey(member);
    const owned = tasks.filter((task) => task.assignee === member.name);
    const current = owned.find((task) => task.id === member.currentTask);
    const memberModel = memberModelProp ?? memberRouteLabel(member);
    const editable = editableProp ?? memberModelEditability(member);
    const clock = memberClock(member, tasks, frozenNow ?? Date.now());
    const stamp = clock.stamp ?? memberClockStamp(member, tasks);
    const round = memberRound(owned);
    const subs = memberSubagentReadout(member);
    const dotTone = memberDotTone(member, { discarded, stopped, staged: team.phase === 'staged', historic });
    /**
     * ── ★★★ "它在做什么"，以及**三态下的终态口径**（原来长在面板里）─────────────
     *
     * ★ 一条被放弃的计划里的成员**不是**"待执行"：它**根本不会被创建**。
     *   MEASURED 的判据见 locales 的 `member.status.discarded` /
     *   `member.status.stopped` —— 两条文案说的都是"这一行不会再有下一步了"，
     *   而"待执行"会让读者以为它在排队。
     * ★ 计划待确认（`staged`）同样有自己的口径：它尚未被创建。
     */
    const doing = discarded
        ? t('member.status.discarded')
        : stopped
            ? t('member.status.stopped')
            : team.phase === 'staged'
                ? t('member.status.staged')
                : memberDoingText(member, current, owned, t);
    const art = memberArtUrl(member.name, member.role);
    const toggle = useCallback(() => { onToggle(key); }, [key, onToggle]);
    return (_jsxs("div", { className: css.memberBlock, "data-activity": member.activity, "data-member-key": key, "data-member-expanded": expanded ? 'true' : 'false', children: [_jsx("span", { className: css.memberBranch, "aria-hidden": true, children: _jsx("span", {}) }), _jsxs("button", { type: "button", className: css.memberRow, "data-activity": member.activity, "data-member-toggle": key, "aria-expanded": expanded, onClick: toggle, children: [_jsxs("span", { className: css.memberAvatar, "data-unread": member.unread > 0, children: [art !== null
                                ? _jsx("img", { className: css.memberArt, src: art, alt: "", "aria-hidden": true })
                                : _jsx("span", { className: css.memberInitial, style: { background: accentOf(member.id) }, children: memberInitial(member.name) }), _jsx("img", { className: css.stateArt, "data-activity": member.activity, src: ACTION_ART[member.activity], alt: "", "aria-hidden": true })] }), _jsx("span", { className: css.memberDot, "data-tone": dotTone, role: "img", "aria-label": t(CLOCK_LABEL[clock.kind], { elapsed: '' }) }), _jsxs("span", { className: css.memberInfo, children: [_jsxs("span", { className: css.memberLine, children: [_jsx("span", { className: css.memberName, children: member.name }), member.role !== '' && _jsx("span", { className: css.memberRole, children: member.role }), memberModel !== '' && (_jsx("span", { className: css.memberModel, role: "img", "data-member-model": memberModel, "data-member-model-state": editable, title: editable === 'sealed' ? t('member.model.sealedReason') : memberModel, "aria-label": memberModel, children: compactModelLabel(memberModel) })), _jsx(IconChevronDownOutline14, {})] }), _jsx("span", { className: css.memberStatusLine, children: doing })] }), _jsx("span", { className: css.memberStatusTail, children: _jsx(MemberClock, { kind: clock.kind, stamp: stamp, frozenNow: frozenNow, t: t }) })] }), editable === 'editable' && modelDirectory !== undefined && !discarded && !stopped && team.phase !== 'staged' && (_jsx("div", { style: MEMBER_MODEL_LINE_STYLE, "data-member-model-editable": true, children: _jsx(MemberModelField, { team: team, member: member, modelDirectory: modelDirectory, disabledReason: undefined, t: t }) })), round !== undefined && (_jsxs("div", { className: css.memberRoundLine, "data-member-round": round.round, "data-tone": discarded ? 'cancelled' : round.tone, children: [_jsx("span", { className: css.memberRoundMark, children: t('member.round.mark', { round: round.round }) }), _jsx("span", { className: css.memberRoundTone, children: discarded ? t('task.status.notRun') : t(ROUND_TONE_LABEL[round.tone]) }), _jsx("span", { className: css.memberRoundTasks, children: round.tasks.map((task) => (_jsx("button", { type: "button", className: css.memberRoundTask, "data-tone": discarded ? 'cancelled' : task.round === undefined ? 'open' : round.tone, onClick: () => { onSelectTask?.(task.id); }, title: `${task.id}`, children: task.id }, task.id))) })] })), expanded && (_jsxs("div", { className: css.memberSubagents, "data-member-subagents": key, children: [subs.state === 'could-not-measure' ? (_jsx("span", { className: css.memberSubagentNote, "data-subagent-readout": "could-not-measure", title: subs.reason, children: t('subagent.unmeasured', { reason: subs.reason ?? '' }) })) : subs.subagents.length === 0 ? (_jsx("span", { className: css.memberSubagentNote, "data-subagent-readout": "observed-empty", children: t('subagent.none') })) : (_jsx("ul", { className: css.memberSubagentList, children: subs.subagents.map((subagent) => (_jsxs("li", { className: css.memberSubagent, "data-subagent-id": subagent.id, "data-tone": subagentTone(subagent.status), children: [_jsx("span", { className: css.memberSubagentDot, "data-tone": subagentTone(subagent.status), "aria-hidden": true }), _jsxs("button", { type: "button", className: css.memberSubagentOpen, "data-subagent-open": subagent.id, onClick: () => { onOpenSubagent(subagent.id); }, title: subagent.id, children: [_jsx("span", { className: css.memberSubagentLabel, children: subagent.label !== '' ? subagent.label : subagent.id }), _jsx("span", { className: css.memberSubagentDoing, children: subagentDoingText(subagent, t) })] }), _jsx("span", { className: css.memberSubagentMode, children: subagent.mode === undefined ? '' : t(subagent.mode === 'continuable' ? 'subagent.mode.continuable' : 'subagent.mode.oneShot') })] }, subagent.id))) })), _jsx("button", { type: "button", className: css.memberOpenSession, "data-member-open-session": member.id, disabled: member.id === '', title: member.id === '' ? t('member.openSession.unavailable') : t('member.openSession'), onClick: () => {
                            if (member.id === '')
                                return;
                            onOpenSubagent(member.id);
                        }, children: t('member.openSession') })] }))] }));
}
