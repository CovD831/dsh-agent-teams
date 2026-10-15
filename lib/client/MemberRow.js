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
import { compactModelLabel, doingLineCandidates, GATE_GLYPH, latestOwnedTask, memberClock, memberClockStamp, memberGateReadouts, memberGateTone, memberHistoryState, memberRowKey, memberRound, memberSubagentReadout, memberRouteLabel, stageGateRows, stageGroupState, subagentTone, taskStage, } from "./activity-model.js";
import { MemberClock } from "./MemberClock.js";
import { MemberModelField, memberModelEditability } from "./StagingPlanEditor.js";
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
/**
 * Locale key for one member-level gate verdict.
 *
 * ★ Reuses **existing** keys rather than adding any: `src/client/locales.ts` is
 *   out of this task's scope, and every one of these four already says the
 *   right thing in both dictionaries.
 */
const MEMBER_GATE_LABEL = {
    ok: 'round.tone.completed',
    blocked: 'round.tone.failed',
    unmeasured: 'round.tone.unmeasured',
    observed: 'round.tone.converging',
};
/**
 * The one symbol for the compact band (`docs/B-VISUAL-SPEC.md` 四符号).
 *
 * ★ `⊘` never collapses into `✓`: an all-skipped run has `evaluated === 0`,
 *   so it **cannot** be a pass — see reverse-edge B in {@link memberGateReadouts}.
 */
const MEMBER_GATE_MARK = {
    ok: '✓',
    blocked: '✗',
    unmeasured: '●',
    observed: '✗',
};
/**
 * ── ★★★ S3：按【成员】渲染判据裁决（默认精简层）────────────────────────────────
 *
 * ★★ 主屏是【成员】；点开成员才是【约束的体现】（用户的裁定）。所以这一层只给
 *   **当前阶段的一句话裁决**，逐条判据的明细留给展开层。
 *
 * ★★ **四种答案不合流**（本队记账最久的形态）：
 *   · `absent`  ⇒ 「读不出」  ★ 绝不印成「全通过」（反向半边 A）
 *   · `empty`   ⇒ 「⊘ 未检查」★ 绝不印成「✓ 通过」（反向半边 B）
 *   · `verdict` ⇒ 裁决符号 + 人话
 *
 * @param readout - the one task's readout for this member.
 * @param t - locale lookup.
 */
export function memberGateBand(readout, t) {
    if (readout === undefined || readout.state === 'absent') {
        return { mark: '·', tone: 'absent', text: t('task.status.notRun') };
    }
    if (readout.state === 'empty')
        return { mark: '⊘', tone: 'skipped', text: t('round.tone.unmeasured') };
    return {
        mark: MEMBER_GATE_MARK[readout.verdict] ?? '✓',
        tone: readout.verdict,
        text: t(MEMBER_GATE_LABEL[readout.verdict] ?? 'round.tone.completed'),
    };
}
/**
 * ── ★★★ v4：一根判据的**全部阶段分组**（展开态画的就是这个）────────────────────
 *
 * 规格 §5：按**阶段**分组，每段给整段形状 + 逐条 `id` + `description`。
 *
 * ★★ **甲方案的边界落在这里**（与 `stageGateRows` 同一条纪律）：
 *   只有 `completion` 段有落盘裁决 ⇒ 其余段**逐条只能是 ○/·**，
 *   绝不许从别处推一个 `✓` 出来。`hasVerdicts` 就是那条边界的**可读标记**。
 *
 * ★ 目录（`catalog`）来自 `/state` 的 `gateCatalog` —— 它是**每份快照都带**的
 *   静态清单，于是"换掉一条判据 ⇒ UI 自动跟着变"（可插拔）。
 * @param stage - the stage this member's current task is in, or undefined.
 * @param catalog - the registered criteria for every stage.
 * @param evaluation - the completion-stage verdicts, when the wire carried them.
 * @returns one group per stage, in flow order; `rows` is empty for empty stages.
 */
export function stageGroups(stage, catalog, evaluation) {
    const evaluationView = readEvaluationView(evaluation);
    return catalog.map((point) => {
        const rows = stageGateRows(point.point, point.gates, evaluationView);
        return {
            stage: point.point,
            state: stageGroupState(point.point, rows, evaluationView),
            /** ★ 只有 completion 段**真的**有逐条裁决；其余段如实说"没有"。 */
            hasVerdicts: point.point === 'completion' && evaluationView !== undefined,
            rows,
        };
    });
}
/** The glyph for one row, from the single table in activity-model. */
function rowGlyph(row) {
    return GATE_GLYPH[row.state];
}
/**
 * ── ★★★ v4：行 2 的"**在做什么测试**" ──────────────────────────────────────────
 *
 * ★ 规格 §3：测试段来自 `registry.list()[该段]` 的 **id 后缀**。
 *   取后缀而不是整条 id：整条 `completion.mutation` 在行 2 上太长，
 *   而后缀 `mutation` 才是"哪一条测试"的可读部分 —— 完整 id 留在 `title` 上。
 *
 * ★★ 而"在跑哪一条"**优先取**逐条里 `running` 的那条：
 *   一句"completion 段 · mutation"里的 `mutation` 若与正在跑的那条无关，
 *   读者会以为整段都在跑它。都没有在跑 ⇒ 退回**第一条**（该段有判据可报）。
 *
 * ★ 该段**没有**判据 ⇒ 返回 `''`（行 2 就不出这一段，而不是印一个空占位）。
 * @param group - the stage group the member's current task is in.
 * @returns the short test label, or '' when the stage has no criteria.
 */
function testLabelOf(group) {
    if (group.rows.length === 0)
        return '';
    const running = group.rows.find((row) => row.state === 'running');
    const chosen = running ?? group.rows[0];
    /** ★ id 形如 `completion.mutation` ⇒ 取最后一个点号之后那一段。 */
    const parts = chosen.id.split('.');
    return parts[parts.length - 1] ?? chosen.id;
}
/**
 * The stage a member's row should report: the one its **current task** is in.
 *
 * ★ 用 `current`（`currentTask` 解析出来的那条），缺席时退回名下第一条非终结任务 ——
 *   与 `memberDoingText` 的口径同源，否则"在做什么"与"在哪个阶段"会指向两条任务。
 * @param current - the resolved current task, when there is one.
 * @param owned - every task assigned to this member.
 * @returns the stage, or undefined when the spec says to omit it.
 */
function currentStage(current, owned) {
    const task = current ?? owned.find((candidate) => candidate.status !== 'completed' && candidate.status !== 'failed' && candidate.status !== 'cancelled');
    if (task === undefined)
        return undefined;
    const hasEvaluation = task.gateEvaluation !== undefined
        && task.gateEvaluation !== null;
    return taskStage(task.status, hasEvaluation);
}
/**
 * Widen the wire's raw gate field into the view the stage helpers read.
 *
 * ★ 复用 `memberGateReadouts` 的**同一个**解析口径（它已经处理了"字符串 / 对象 /
 *   读不出"三种到达方式）—— 不在这里写第二份，否则两处会漂移。
 * @param raw - the raw `gateEvaluation` field.
 * @returns the parsed view, or undefined when unreadable/absent.
 */
function readEvaluationView(raw) {
    if (raw === undefined || raw === null || raw === '')
        return undefined;
    const readout = memberGateReadouts([{ id: 'probe', gateEvaluation: raw }]).get('probe');
    if (readout === undefined || readout.state !== 'verdict')
        return undefined;
    return readout.evaluation;
}
/**
 * What this member is doing right now, in one line.
 *
 * ★ Every branch says *something*: a member with no current task reads a sentence
 *   rather than an empty line, because "this cell has nothing" and "this member has
 *   nothing to do" must not look the same.
 *
 * ── ★★★ D12：句子**不只一句**（用户从截图发现的缺陷）──────────────────────────
 *
 * MEASURED：改前这里只有一个兜底 `return`，于是**四种情形同形**。用户截图里
 * 决定性的一对照 —— `ui-engineer`（完成 0 · 失败 1）与 `ui-dissect`（完成 12 ·
 * 失败 3）主行**都是**「等待队长派工」。而这两件事的处置**相反**：
 *   · 有历史（做完了在等下一件）⇒ 队长**欠它**一个任务；
 *   · 无历史（生成后没派过活）  ⇒ 它**还没参与过**。
 *
 * ★ 纪律与紧邻的注释同源：**"空 vs 非空"防住了，"干完了 vs 没开始"没防住。**
 *   所以这里必须**四种不同形**，而不是"有任务 / 没任务"两分。
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
    const history = memberHistoryState(owned);
    if (history === 'open') {
        const open = owned.filter((task) => task.state !== 'completed' && task.state !== 'failed' && task.state !== 'cancelled');
        return t('member.doing.task', { taskId: open[0].id });
    }
    /**
     * ★ 下面三句**必须**互不相同 —— "拆开了"与"拆了个恒等的"在屏幕上同形，
     *   而反向半边 A/B 就是用来挡住后者的（见 docs/D12-STATUS-COLLAPSE.md）。
     */
    if (history === 'failed') {
        return t('member.status.awaitingRedispatch', { taskId: latestTerminalId(owned) });
    }
    if (history === 'finished') {
        return t('member.status.awaitingAssignment', { taskId: latestCompletedId(owned) });
    }
    return t('member.status.waitingAssignment');
}
/** Id of the newest terminal task owned by this member (D12's failure line). */
function latestTerminalId(owned) {
    const terminal = owned.filter((task) => task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled');
    return latestOwnedTask(terminal)?.id ?? '';
}
/**
 * Id of the newest **completed** task owned by this member (D12's finished line).
 *
 * ★ 单独取 completed，而不是"最新那条终结任务"：最新那条可能是 cancelled，
 *   而"已完成 tN · 待派工"里的 tN 必须是**真的完成了的那个**，
 *   否则这句话会把一件被取消的任务说成已完成。
 */
function latestCompletedId(owned) {
    const completed = owned.filter((task) => task.status === 'completed');
    return latestOwnedTask(completed)?.id ?? '';
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
 * ── ★★★ v4：从团队快照里读**判据清单**（转发过来的那一格）──────────────────────
 *
 * ★ 这是"**可插拔**"的落点：UI **不硬编码**任何判据名，只读 `id` + `description`。
 *   换掉一条判据（改 `src/gates/**`）⇒ 两者都变 ⇒ UI 自动跟着变，不用改代码。
 *
 * ★ **结构化读取**而不是给 `ActivityTeam` 加字段：`activity-monitor.ts` **不在**
 *   本任务的写域里（与 `MemberRow.tsx` 上 `subagents` / `round` 同一条先例 ——
 *   面板读**线上真的有的**字段，等基类追上来时这个别名自然收敛）。
 *
 * ★ **缺席**（老快照没有这一格）⇒ 空数组 ⇒ 展开层报"读不到判据清单"。
 *   这与"注册了 0 条"**不同形** —— 前者是"我没读到"，后者是"确实没有"。
 * @param team - the team snapshot as it arrived on the wire.
 * @returns the catalog entries, or an empty array when the wire omitted them.
 */
function gateCatalogOf(team) {
    const raw = team.gateCatalog;
    if (!Array.isArray(raw))
        return [];
    return raw.filter((entry) => (typeof entry === 'object' && entry !== null
        && typeof entry.point === 'string'
        && Array.isArray(entry.gates)));
}
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
    /**
     * ★★ 判据清单**就地**从 `team` 上读 —— 不由调用方当 prop 传进来。
     *
     * ── 为什么（这是**写域**上的约束，不是风格偏好）────────────────────────────────
     *
     * 我第一版把它做成 prop，于是必须改 `MemberScreen.tsx` 去传 —— 而
     * **`MemberScreen.tsx` 不在本任务的 `inScope` 里**（闸门当场拒了，它是对的）。
     * ★ 而**就地读更好**：本行已经拿到了 `team`（它就在 props 上），再要调用方
     *   把 `team` 里的同一格拆出来单独传一遍是**多余的一跳**，而且多一个会漂移的接口。
     */
    const catalog = gateCatalogOf(team);
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
    /**
     * ── ★★★ v4（甲）：行 2 = `第 N 轮 · 阶段 · 测试` ──────────────────────────────
     *
     * ★ 阶段**从任务状态推出**（`taskStage`），测试名从**转发过来的判据清单**里取 ——
     *   两处都不硬编码，于是换掉一条判据 ⇒ 行 2 自动跟着变（可插拔）。
     * ★ 候选按优先级排好（先省"测试"，再省"阶段"），渲染层取第一个放得下的。
     */
    const stage = currentStage(current, owned);
    const groups = stageGroups(stage, catalog, current?.gateEvaluation);
    const stageGroup = stage === undefined ? undefined : groups.find((group) => group.stage === stage);
    const testLabel = stageGroup === undefined ? '' : testLabelOf(stageGroup);
    const line2 = doingLineCandidates(round?.round, stage, testLabel);
    const toggle = useCallback(() => { onToggle(key); }, [key, onToggle]);
    return (_jsxs("div", { className: css.memberBlock, "data-activity": member.activity, "data-member-key": key, "data-member-expanded": expanded ? 'true' : 'false', "data-member-gate-tone": memberGateTone(stage, groups), children: [_jsxs("button", { type: "button", className: css.memberRow, "data-activity": member.activity, "data-member-toggle": key, "aria-expanded": expanded, onClick: toggle, children: [_jsx("span", { className: css.memberDot, "data-tone": dotTone, role: "img", "aria-label": t(CLOCK_LABEL[clock.kind], { elapsed: '' }) }), _jsxs("span", { className: css.memberInfo, children: [_jsxs("span", { className: css.memberLine, children: [_jsx("span", { className: css.memberName, children: member.name }), member.unread > 0 && _jsx("span", { className: css.memberUnread, "data-unread": "true", "aria-hidden": true }), member.role !== '' && _jsx("span", { className: css.memberRole, children: member.role }), memberModel !== '' && (_jsx("span", { className: css.memberModel, role: "img", "data-member-model": memberModel, "data-member-model-state": editable, title: editable === 'sealed' ? t('member.model.sealedReason') : memberModel, "aria-label": memberModel, children: compactModelLabel(memberModel) })), _jsx("span", { className: css.memberStatusLine, title: doing, children: doing }), _jsx("span", { className: css.memberStatusTail, children: _jsx(MemberClock, { kind: clock.kind, stamp: stamp, frozenNow: frozenNow, t: t }) }), _jsx(IconChevronDownOutline14, {})] }), _jsx("span", { className: css.memberStageLine, "data-line2": line2[0], "data-line2-level": 0, children: line2[0] })] })] }), editable === 'editable' && modelDirectory !== undefined && !discarded && !stopped && team.phase !== 'staged' && (_jsx("div", { style: MEMBER_MODEL_LINE_STYLE, "data-member-model-editable": true, children: _jsx(MemberModelField, { team: team, member: member, modelDirectory: modelDirectory, disabledReason: undefined, t: t }) })), round !== undefined && (_jsxs("div", { className: css.memberRoundLine, "data-member-round": round.round, "data-tone": discarded ? 'cancelled' : round.tone, children: [_jsx("span", { className: css.memberRoundMark, children: t('member.round.mark', { round: round.round }) }), _jsx("span", { className: css.memberRoundTone, children: discarded ? t('task.status.notRun') : t(ROUND_TONE_LABEL[round.tone]) }), _jsx("span", { className: css.memberRoundTasks, children: round.tasks.map((task) => (_jsx("button", { type: "button", className: css.memberRoundTask, "data-tone": discarded ? 'cancelled' : task.round === undefined ? 'open' : round.tone, onClick: () => { onSelectTask?.(task.id); }, title: `${task.id}`, children: task.id }, task.id))) })] })), expanded && (_jsxs("div", { className: css.memberSubagents, "data-member-subagents": key, children: [_jsxs("div", { className: css.memberExpandedFacts, children: [member.role !== '' && _jsx("span", { className: css.memberExpandedRole, children: member.role }), memberModel !== '' && _jsx("span", { className: css.memberExpandedModel, children: memberModel }), _jsx("span", { className: css.memberExpandedDoing, children: doing })] }), catalog.length === 0 ? (_jsx("span", { className: css.memberGateNote, "data-member-gates": key, "data-member-gates-readout": "no-catalog", children: t('member.gates.noCatalog') })) : (_jsx("ul", { className: css.memberGateList, "data-member-gates": key, children: groups.map((group) => (_jsxs("li", { className: css.memberStageGroup, "data-member-stage": group.stage, "data-member-gate": key, "data-member-gate-state": group.state, "data-member-gate-readout": group.hasVerdicts ? 'verdict' : 'registered', "data-member-stage-state": group.state, "data-stage-state": group.state, "data-stage-has-verdicts": group.hasVerdicts ? 'true' : 'false', children: [_jsxs("span", { className: css.memberStageHead, children: [_jsx("span", { className: css.memberStageMark, "data-stage-mark": group.state, children: GATE_GLYPH[group.state] }), _jsx("span", { className: css.memberStageName, children: group.stage }), _jsx("span", { className: css.memberStageCount, children: group.hasVerdicts
                                                ? t('member.gates.count', { count: String(group.rows.length) })
                                                : t('member.gates.noVerdicts', { count: String(group.rows.length) }) })] }), group.rows.length > 0 && (_jsx("ul", { className: css.memberStageRows, children: group.rows.map((row) => (_jsxs("li", { className: css.memberStageRow, "data-gate-id": row.id, "data-gate-state": row.state, "data-gate-observing": row.observing ? 'true' : 'false', "data-verdict": row.state === 'passed' ? 'ok' : row.state === 'skipped' ? 'skipped' : row.state === 'observed' ? 'blocked' : undefined, "data-observed": row.state === 'observed' ? 'true' : undefined, children: [_jsx("span", { className: css.memberStageRowMark, "data-gate-mark": row.state, children: rowGlyph(row) }), _jsx("span", { className: css.memberStageRowId, title: row.id, children: row.id }), _jsx("span", { className: css.memberStageRowDesc, children: row.description })] }, row.id))) }))] }, group.stage))) })), subs.state === 'could-not-measure' ? (_jsx("span", { className: css.memberSubagentNote, "data-subagent-readout": "could-not-measure", title: subs.reason, children: t('subagent.unmeasured', { reason: subs.reason ?? '' }) })) : subs.subagents.length === 0 ? (_jsx("span", { className: css.memberSubagentNote, "data-subagent-readout": "observed-empty", children: t('subagent.none') })) : (_jsx("ul", { className: css.memberSubagentList, children: subs.subagents.map((subagent) => (_jsxs("li", { className: css.memberSubagent, "data-subagent-id": subagent.id, "data-tone": subagentTone(subagent.status), children: [_jsx("span", { className: css.memberSubagentDot, "data-tone": subagentTone(subagent.status), "aria-hidden": true }), _jsxs("button", { type: "button", className: css.memberSubagentOpen, "data-subagent-open": subagent.id, onClick: () => { onOpenSubagent(subagent.id); }, title: subagent.id, children: [_jsx("span", { className: css.memberSubagentLabel, children: subagent.label !== '' ? subagent.label : subagent.id }), _jsx("span", { className: css.memberSubagentDoing, children: subagentDoingText(subagent, t) })] }), _jsx("span", { className: css.memberSubagentMode, children: subagent.mode === undefined ? '' : t(subagent.mode === 'continuable' ? 'subagent.mode.continuable' : 'subagent.mode.oneShot') })] }, subagent.id))) })), _jsx("button", { type: "button", className: css.memberOpenSession, "data-member-open-session": member.id, disabled: member.id === '', title: member.id === '' ? t('member.openSession.unavailable') : t('member.openSession'), onClick: () => {
                            if (member.id === '')
                                return;
                            onOpenSubagent(member.id);
                        }, children: t('member.openSession') })] }))] }));
}
