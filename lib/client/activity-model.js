/** Pure relationship projections used by the AgentTeams activity panel. */
/**
 * Statuses after which a task no longer moves; every other status is open work.
 * ★ Single source for this fact: both the loop projection and the member clock
 *   read it from here, so a second list cannot drift out of step.
 */
export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'];
/** Whether a task stopped for good, independent of why. */
export function taskIsTerminal(status) {
    return TERMINAL_TASK_STATUSES.includes(status);
}
/** Reference-panel geometry: narrow nodes with enough room for curved edges. */
export const COMPACT_DAG_NODE_WIDTH = 92;
export const COMPACT_DAG_NODE_HEIGHT = 30;
export const COMPACT_DAG_COLUMN_GAP = 26;
export const COMPACT_DAG_ROW_GAP = 8;
/** Compact `provider/model` route, or just the model when the provider is absent. */
export function memberRouteLabel(member) {
    if (member === undefined)
        return '';
    const provider = member.provider?.trim() ?? '';
    const model = member.model?.trim() ?? '';
    if (provider !== '' && model !== '')
        return `${provider}/${model}`;
    return model;
}
/**
 * Compact route shown on a running task. Prefer the task's own snapshot
 * field; fall back to the assignee member when older hosts omit it.
 */
export function taskModelLabel(task, members) {
    const direct = task.model?.trim() ?? '';
    if (direct !== '')
        return direct;
    return memberRouteLabel(members.find((candidate) => candidate.name === task.assignee));
}
/** Short model id for tight DAG/chip surfaces (`openai/gpt-5.6-sol` → `gpt-5.6-sol`). */
export function compactModelLabel(route) {
    const trimmed = route.trim();
    if (trimmed === '')
        return '';
    const slash = trimmed.lastIndexOf('/');
    return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}
/** A live team the current captain still owns and has not halted. */
export function liveCaptainTeam(teams, sessionId) {
    const owner = sessionId?.trim() ?? '';
    if (owner === '')
        return undefined;
    return teams.find((team) => team.captainSessionId === owner && team.halted !== true);
}
/**
 * Latest terminal-task `updatedAt` owned by one member.
 * @param memberName - member whose owned tasks are scanned.
 * @param tasks - team tasks carrying durable `updatedAt` stamps.
 * @returns the newest terminal stamp, or undefined when the member owns none.
 */
export function memberFinishedAt(memberName, tasks) {
    let latest;
    for (const task of tasks) {
        if (task.assignee !== memberName)
            continue;
        if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled')
            continue;
        const stamp = task.updatedAt;
        if (typeof stamp !== 'number' || !Number.isFinite(stamp))
            continue;
        if (latest === undefined || stamp > latest)
            latest = stamp;
    }
    return latest;
}
/** Whether a member still has live work (running activity or an open task). */
function memberIsRunning(member, tasks) {
    if (member.activity === 'working' || member.status === 'working')
        return true;
    return tasks.some((task) => task.assignee === member.name
        && (task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress'));
}
/**
 * Order the delegation member list for issue #192.
 *
 * Running members keep their incoming relative order and come first; finished
 * members follow sorted by finish time, newest first. Members without a
 * derivable finish time keep their incoming relative order after the stamped
 * ones, so an older host that omits stamps never reorders them randomly.
 * @param members - delegation roster in snapshot order.
 * @param tasks - team tasks carrying durable `updatedAt` stamps.
 * @returns the members in display order.
 */
export function orderDelegationMembers(members, tasks) {
    const running = [];
    const finishedStamped = [];
    const finishedUnstamped = [];
    members.forEach((member, index) => {
        if (memberIsRunning(member, tasks)) {
            running.push({ member, index });
            return;
        }
        const finishedAt = memberFinishedAt(member.name, tasks);
        if (finishedAt === undefined)
            finishedUnstamped.push({ member, index });
        else
            finishedStamped.push({ member, index, finishedAt });
    });
    finishedStamped.sort((left, right) => right.finishedAt - left.finishedAt || left.index - right.index);
    return [
        ...running,
        ...finishedStamped,
        ...finishedUnstamped,
    ].map((entry) => entry.member);
}
/** Whether the captain chat should keep showing the in-progress banner. */
export function teamIsActive(team) {
    if (team.halted === true || team.phase === 'staged')
        return false;
    if (team.members.some((member) => member.activity === 'working' || member.status === 'working'))
        return true;
    if (team.tasks.some((task) => task.status === 'pending' || task.status === 'claimed' || task.status === 'in_progress'))
        return true;
    return team.members.length > 0 && team.tasks.length === 0;
}
/** Compact banner copy: running members, otherwise the current planning state. */
export function teamProgressSummary(team, separator) {
    const workingMembers = team.members.filter((member) => member.activity === 'working' || member.status === 'working');
    const runningTasks = team.tasks.filter((task) => task.status === 'claimed' || task.status === 'in_progress');
    const labels = runningTasks.map((task) => task.subject.trim() || task.id).filter((label) => label !== '');
    if (workingMembers.length > 0 || labels.length > 0) {
        return {
            working: Math.max(workingMembers.length, labels.length),
            detail: labels.slice(0, 2).join(separator),
        };
    }
    return { working: 0, detail: '' };
}
/** Use a fill-width grid when the task graph has no real dependency edges. */
export function usesParallelTaskGrid(tasks) {
    if (tasks.length === 0)
        return false;
    const taskIds = new Set(tasks.map((task) => task.id));
    return tasks.every((task) => task.dependencies.every((dependency) => !taskIds.has(dependency)));
}
/**
 * Whether an expanded activity panel still belongs to the current session.
 *
 * The panel is mounted in the root-scoped shell overlay, so React does not
 * remount it when the conversation route changes. Ownership keeps an expanded
 * panel from leaking onto the new-session screen (or another conversation)
 * while its local open state is being reset.
 */
export function activityPanelExpandedForSession(open, owner, current) {
    return open && owner !== undefined && owner === current;
}
/**
 * Auto-expand only for live teams that appear after the current session's
 * initial restore pass. Replayed cards, archived teams, and live teams restored
 * while reopening a conversation must remain behind the collapsed badge.
 */
export function activityPanelShouldAutoExpand({ alreadyAutoOpened, pageSettled, restoreComplete, previousLiveTeamIds, currentLiveTeamIds, }) {
    return !alreadyAutoOpened
        && pageSettled
        && restoreComplete
        && currentLiveTeamIds.some((teamId) => !previousLiveTeamIds.has(teamId));
}
/**
 * Resolve the task whose dependency chain should be highlighted.
 *
 * A pinned task is an explicit user choice. Keyboard focus takes precedence
 * over delayed pointer intent so an older hover timer cannot steal the active
 * chain from someone navigating the task map with the keyboard.
 */
export function dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId) {
    return pinnedTaskId ?? keyboardTaskId ?? hoverTaskId;
}
/**
 * Render-facing tone of one terminal task.
 *
 * ★ This is the one place the three outcomes become three UI states. The
 *   distinction is the whole point: a review that returned `needs_revision`
 *   (inconclusive) did its job and must read as convergence; a broken
 *   deliverable must stay red; an unmeasured stop is neither.
 */
export function taskLoopTone(task) {
    if (task.status === 'cancelled')
        return 'cancelled';
    if (task.status === 'completed')
        return 'completed';
    if (task.status !== 'failed')
        return task.status === 'in_progress' ? 'running' : 'open';
    const kind = task.failureKind;
    if (kind === 'inconclusive')
        return 'converging';
    if (kind === 'failed_delivery')
        return 'failed';
    if (kind === 'failed_context')
        return 'unmeasured';
    /** No classification ⇒ today's undifferentiated failure, never a guessed one. */
    return 'failed';
}
/**
 * The tone of one round as a whole.
 *
 * Precedence is deliberate: an unsettled outcome outranks a settled one, so a
 * round whose review found problems cannot be painted green by the completed
 * tasks riding alongside it. Within the unsettled group the order is
 * failed > converging > unmeasured > running, i.e. the most consequential
 * reading wins, and a round with nothing left to decide reads as completed.
 */
export function roundTone(tasks) {
    const tones = tasks.map((task) => taskLoopTone(task));
    if (tones.includes('failed'))
        return 'failed';
    if (tones.includes('converging'))
        return 'converging';
    if (tones.includes('unmeasured'))
        return 'unmeasured';
    if (tones.includes('running') || tones.includes('open') || tones.includes('blocked'))
        return 'running';
    if (tones.includes('completed'))
        return 'completed';
    return 'cancelled';
}
/**
 * Derive a loop's disclosure facts from durable data.
 *
 * @param loop - the loop projection.
 * @param discarded - a discarded plan has no outcomes, only "never ran".
 */
export function loopFacts(loop, discarded = false) {
    const tones = loop.rounds.map((entry) => (discarded ? 'cancelled' : entry.tone));
    const mode = tones.includes('failed') || tones.includes('converging') || tones.includes('cancelled')
        ? 'abnormal'
        : tones.includes('running') || tones.includes('open') || tones.includes('blocked')
            ? 'running'
            : 'clean';
    return { mode, count: loop.tracked };
}
/** Ordering used to decide whether the loop escalated. */
const LOOP_MODE_RANK = { clean: 0, running: 1, abnormal: 2 };
/**
 * Resolve the next disclosure state.
 *
 * ★ With no previous state the initial value is rebuilt from the durable facts,
 *   never remembered from a prior mount: a remount must not silently hide a
 *   loop that the facts say is abnormal.
 *
 * ★ Once `userSet`, an unchanged set of facts leaves the user's choice alone —
 *   that is what "the choice survives re-renders" means. But escalation or a
 *   new round reopens it: something happened, and hiding it would be the same
 *   defect as collapsing it in the first place.
 */
export function nextLoopDisclosure(current, facts) {
    if (current === undefined)
        return { ...facts, open: facts.mode !== 'clean', userSet: false };
    const escalated = LOOP_MODE_RANK[facts.mode] > LOOP_MODE_RANK[current.mode];
    if (escalated || facts.count !== current.count) {
        return { ...facts, open: true, userSet: current.userSet };
    }
    if (current.userSet)
        return current;
    return { ...facts, open: current.open, userSet: false };
}
/** Apply one explicit user toggle; the result is a user choice from then on. */
export function toggleLoopDisclosure(current) {
    return { ...current, open: !current.open, userSet: true };
}
/**
 * Project the review/repair loop as ordered rounds with round markers.
 *
 * A review that returns `needs_revision` is not a failure: the host generates
 * the next round (`planQualityFollowUp` in src/quality-gates.ts). Reading that
 * as an unrelated red task is exactly what this projection exists to prevent,
 * so tasks are grouped by their durable `round` index instead of being listed
 * by id and hoping the reader notices `review-round-2` follows `review-round-1`.
 *
 * @param tasks - team tasks; only those carrying a `round` index participate.
 * @returns rounds ascending by index; the ascending order IS the loop.
 */
export function reviewLoop(tasks) {
    const byRound = new Map();
    let tracked = 0;
    for (const task of tasks) {
        const value = task.round;
        if (value === undefined || !Number.isFinite(value))
            continue;
        tracked += 1;
        const round = Math.max(1, Math.floor(value));
        const group = byRound.get(round) ?? [];
        group.push(task);
        byRound.set(round, group);
    }
    const rounds = [...byRound.entries()]
        .sort(([left], [right]) => left - right)
        .map(([round, group]) => ({
        round,
        tasks: group.slice().sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true })),
        tone: roundTone(group),
    }));
    return { rounds, tracked };
}
/**
 * ── ★★★ R2：把轮次搬到成员行上（用户原话：round data moves UP into screen one）──
 *
 * MEASURED（用户 2026-10-11）：轮次/收敛原本单占一块（`ReviewLoopSection`），
 * 而成员行上**一个字都没有**。于是"这个成员在第几轮、那一轮什么结果"要看第二处
 * 才知道 —— 而用户要的第一屏口径是"整队在不在动、谁在做什么"。
 *
 * ★ 口径是**成员自己的**轮次，不是全队的：一个成员名下带 `round` 的任务里最大的
 *   那一轮。缺席 ⇒ `undefined`（"没有轮次概念"），**不是** `0`（"第 0 轮"）——
 *   两者必须不同形（与 `TeamActivityMember.round` 同一条判据，且不在这里重算规则）。
 *
 * ★ 反向半边：同一批任务，只看**这个成员的**任务 —— 一个把全队最大轮次印到每个人
 *   身上的实现，会让没参与那一轮的成员也印着"第 N 轮"。
 * @param tasks - the member's OWN tasks.
 * @returns the member's highest round, or undefined when none carries one.
 */
export function memberRound(tasks) {
    const rounds = [];
    for (const round of new Set(tasks.map((task) => task.round).filter((value) => typeof value === 'number' && Number.isFinite(value)))) {
        const group = tasks.filter((task) => task.round === round);
        rounds.push({ round: Math.max(1, Math.floor(round)), tasks: group, tone: roundTone(group) });
    }
    if (rounds.length === 0)
        return undefined;
    rounds.sort((left, right) => left.round - right.round);
    return rounds[rounds.length - 1];
}
/**
 * ── ★★★ What a member's *history* says, once it has no open work left (D12)─────
 *
 * MEASURED（用户截图）：一个**刚做完 12 件**的成员与一个**从没派过活**的成员，
 * 主行读出来是**同一句话**。而那两件事的处置**相反**：
 *   · 有历史 ⇒ 队长**欠它**一个任务（该派了）；
 *   · 无历史 ⇒ 它**还没参与过**（可能正常，也可能配置错了）。
 *
 * ★ 四种取值，且**两两不同形** —— 这正是本函数存在的理由：
 *   · `open`     —— 还有未终结任务 ⇒ 调用方去显示那个任务（不是本函数的兜底）。
 *   · `failed`   —— 最新的一条终结任务是失败 ⇒ 该**重派**。
 *   · `finished` —— 有已完成的任务、最新那条不是失败 ⇒ 该**派下一件**。
 *   · `never`    —— 名下一条任务都没有（或只有非终结且非完成的残留）⇒ 从未派工。
 *
 * ★ "最新"的判据必须是**确定**的：优先用宿主写的 `updatedAt`（唯一的持久时间戳），
 *   缺席时退回**传入顺序的最后一条** —— 快照顺序是稳定的，而"随机挑一条"会让
 *   同一份数据两次渲染给出不同的句子。
 *
 * ★ 反向半边：把 `failed` 与 `finished` 合流，或把 `finished` 与 `never` 合流，
 *   都会让"刚做完 12 件"与"从没派过活"重新同形 —— 即本轮要修的缺陷本身。
 * @param owned - the member's OWN tasks, in snapshot order.
 * @returns which of the four non-open situations this member is in.
 */
export function memberHistoryState(owned) {
    const open = owned.filter((task) => !isTerminalTask(task));
    if (open.length > 0)
        return 'open';
    const terminal = owned.filter((task) => isTerminalTask(task));
    if (terminal.length === 0)
        return 'never';
    const latest = latestOwnedTask(terminal);
    if (latest !== undefined && latest.status === 'failed')
        return 'failed';
    /** ★ 只有"确实完成过"才算 finished：一条 cancelled 的残留不是"干完了"。 */
    return terminal.some((task) => task.status === 'completed') ? 'finished' : 'never';
}
/** Whether a task has stopped for good (`state`, falling back to `status`). */
function isTerminalTask(task) {
    const state = task.state ?? task.status;
    return state === 'completed' || state === 'failed' || state === 'cancelled';
}
/**
 * The newest task by `updatedAt`, falling back to snapshot order.
 *
 * ★ 缺 `updatedAt` 时**不打乱**相对次序：早于该字段的宿主快照里，
 *   顺序是唯一可用的"先后"证据。
 * ★ 导出是给 D12 的两句文案取任务 id 用的（"tN 失败" / "已完成 tN"）——
 *   两处必须**同一口径**，否则两句话会指向不同的任务。
 * @param tasks - candidate tasks, in snapshot order.
 * @returns the newest one, or undefined for an empty list.
 */
export function latestOwnedTask(tasks) {
    if (tasks.length === 0)
        return undefined;
    let best = tasks[tasks.length - 1];
    for (const task of tasks) {
        const stamp = task.updatedAt;
        if (typeof stamp !== 'number' || !Number.isFinite(stamp))
            continue;
        const bestStamp = best.updatedAt;
        if (typeof bestStamp !== 'number' || !Number.isFinite(bestStamp) || stamp >= bestStamp)
            best = task;
    }
    return best;
}
/**
 * Format one round's status tail as counts per outcome.
 *
 * Statuses that need a decision come first and always list together, so a round
 * that found problems never reads as "everything finished". Completed rides
 * along only when the round is otherwise still open, mirroring the first-party
 * `phaseStatusSummary` ordering (completed leading when nothing is active).
 *
 * ★ The tail only ever counts outcomes the host actually measured: an
 *   unclassified failure falls back to `failed` inside {@link taskLoopTone},
 *   which is today's behaviour, so the tail never invents a fourth kind.
 */
export function roundTailCounts(tasks, t, separator) {
    const count = (tone) => tasks.filter((task) => taskLoopTone(task) === tone).length;
    const active = ['converging', 'failed', 'unmeasured', 'running']
        .filter((tone) => count(tone) > 0);
    const order = active.length === 0
        ? ['completed']
        : active.includes('converging') && count('completed') > 0
            ? ['completed', ...active]
            : active;
    return order.map((tone) => `${t(ROUND_TAIL_LABEL[tone], { count: count(tone) })}`).join(separator);
}
/**
 * Locale keys for one round-tail count.
 *
 * These reuse the pre-existing `task.status.*` vocabulary on purpose: adding a
 * parallel `round.*` dictionary would be a second source of truth for the same
 * words, and the two sets would drift the moment one of them is edited.
 */
export const ROUND_TAIL_LABEL = {
    converging: 'task.status.failed',
    failed: 'task.status.failed',
    unmeasured: 'task.status.notRun',
    running: 'task.status.inProgress',
    completed: 'task.status.completed',
};
/**
 * ── ★★★ R3：任务着色读数（从 ActivityPanel.tsx 搬来，逐字未改）───────────────────
 *
 * ★ 这里保留的是原来那段**逐字的**判据：`taskTone` 是旧行为，而
 *   `taskTerminalTone` 是 t13 引入的三态修正（"评审发现了问题"读成琥珀而不是红）。
 *   `DependencyGraph.tsx` 与面板都要用它，所以它必须在两边都能 import 的地方 ——
 *   而**不是**各留一份。
 */
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
export function taskTerminalTone(task) {
    if (task.status === 'cancelled')
        return 'cancelled';
    if (task.status !== 'failed')
        return taskTone(task.state, task.status);
    return taskLoopTone(task);
}
/* ─────────────────────────────────────────────────────────────────────────────
 * ── ★★★ R3：任务面的**纯**展示读数（从 ActivityPanel.tsx 搬来，逐字未改）──────
 *
 * 这些函数原来长在面板里，而 R3 把依赖图搬进 `DependencyGraph.tsx` 之后，
 * **两个文件都要用它们**。留在任一边都会造成两件事之一：
 *   · 让 `DependencyGraph` 反向 import 面板 ⇒ 循环依赖（面板要 import 图）；
 *   · 或者抄一份 ⇒ 同一句文案的第二份实现，一定会漂移。
 *
 * ⇒ 搬到本模块（两边都已经在 import 它），于是**各只有一份定义**。
 *   ★ 这是纯粹的搬家：函数体一个字都没改，所以"搬丢了什么"能被集合比对抓住。
 * ───────────────────────────────────────────────────────────────────────────── */
/** Badge text follows the raw task status (finer than the 4 visual states). */
const TASK_STATUS_LABEL = {
    pending: 'task.status.pending',
    claimed: 'task.status.claimed',
    in_progress: 'task.status.inProgress',
    completed: 'task.status.completed',
    failed: 'task.status.failed',
    cancelled: 'task.status.cancelled',
};
/** Human label for one raw task status, falling back to the status itself. */
export function taskStatusLabel(status, t) {
    const key = TASK_STATUS_LABEL[status];
    return key === undefined ? status : t(key);
}
/** One-line task description used as a `title` tooltip (`id · subject · extras`). */
export function taskTitle(task, model) {
    const extras = [
        task.kind,
        task.round === undefined ? undefined : `r${task.round}`,
        task.verdict,
        model === '' ? undefined : model,
    ].filter((item) => item !== undefined);
    return extras.length === 0 ? `${task.id} · ${task.subject}` : `${task.id} · ${task.subject} · ${extras.join(' · ')}`;
}
/** Compact task label for the tight DAG nodes. */
export function compactTaskLabel(subject) {
    const withoutVerb = subject.replace(/^开发\s*/u, '').replace(/^\d+[-_.、\s]*/u, '');
    const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb;
    return head.length > 18 ? `${head.slice(0, 17)}…` : head;
}
/** Joined task-id list using the locale's list separator. */
export function formatTaskIds(ids, t) {
    return ids.join(t('format.listSeparator'));
}
/* ─────────────────────────────────────────────────────────────────────────────
 * Member clock: how long this member has been on its current task
 * ───────────────────────────────────────────────────────────────────────────── */
/**
 * ── ★★★ R2：**谁该拥有秒表** ──────────────────────────────────────────────────
 *
 * MEASURED（R2 开工时）：秒表原本挂在 1599 行的 `TeamSection` 上 ——
 * `useElapsedNow` 一 tick，**整棵面板树重渲染**。而它每秒都在跑，
 * 哪怕队里只有一个人在动。
 *
 * ★ 判据（契约原句）："Only members that actually have a running clock
 *   subscribe to ticks; an idle or waiting member does not keep a timer alive."
 *
 * ★ 为什么只有 `running` 一格为真，另三格各自说清：
 *   · `running` ⇒ 时长**每秒都在变**（`now − updatedAt`）⇒ 必须有人 tick，否则读数不动。
 *   · `stale`   ⇒ 时长同样在变，但它数的是"没人推进它"——★ 而它是**告警**，
 *                 不是进度；让它每秒重排一次会把一个静态的坏消息画成"还在动"。
 *                 ⇒ 它读一次就够了（值本身就是"最后一次改动以来"）。
 *   · `idle`    ⇒ **不带时长**（`ms` 恒为 0）⇒ tick 只会重渲染一个不动的字符串。
 *   · `unknown` ⇒ 读不出戳 ⇒ 同样没有可更新的数字。
 *
 * ★ 反向半边（缺了它，一个"恒返回 true"的实现会让面板每秒重渲染每一行，
 *   而每一条断言照样绿）：本函数对四种读数**必须**给出**不同**的答案。
 * @param kind - the member's elapsed readout.
 * @returns whether a live per-second ticker is required for that readout.
 */
export function memberClockTicks(kind) {
    return kind === 'running';
}
/**
 * Read one member's subagent layer off the `/state` payload.
 *
 * ★★★ 三态不许塌：`observed` + 空数组是"**读了**，真的没有"；
 *   `could-not-measure` 是"**没读成**"。把后者圆成前者会让面板永远印着
 *   "没有子代理" —— 而那与"确实没有"在读者眼里**同形**（本仓三态纪律，
 *   也是 t27 立这一格的唯一理由）。
 *
 * ★ 缺省（老宿主根本没有这一格）同样归入 `could-not-measure`，而不是
 *   "这个成员没有子代理"：老宿主不是"测到了没有"，是"没这块数据"。
 * @param member - one member row from the snapshot (read structurally).
 * @returns the tri-state readout, with the host's own reason when it gave one.
 */
export function memberSubagentReadout(member) {
    const state = member.subagents;
    if (state !== 'observed' && state !== 'could-not-measure') {
        return {
            state: 'could-not-measure',
            subagents: [],
            reason: 'the host published no subagent reading for this member',
        };
    }
    const subagents = Array.isArray(member.liveSubagents) ? member.liveSubagents : [];
    if (state === 'observed')
        return { state, subagents };
    return {
        state,
        subagents: [],
        reason: typeof member.subagentsReason === 'string' && member.subagentsReason !== ''
            ? member.subagentsReason
            : 'the host could not measure this member\'s subagents',
    };
}
/**
 * Classify one live subagent's status for rendering.
 * @param status - the raw session status as the host reported it.
 * @returns `working`, `idle`, or `unknown` for anything unrecognised.
 */
export function subagentTone(status) {
    if (status === 'running' || status === 'working')
        return 'working';
    if (status === 'idle' || status === 'ready')
        return 'idle';
    return 'unknown';
}
/** Stable key for one member row's expansion slot. */
export function memberRowKey(member) {
    const id = member.id?.trim() ?? '';
    return id !== '' ? id : `name:${member.name}`;
}
/**
 * Whether one member row is expanded.
 *
 * ★ Collapsed by default is a *value*, not an absent branch: an unmapped row
 *   reads `false`, so a fresh render can never accidentally open every row.
 * @param expansion - the panel's expansion store.
 * @param key - the row's stable key (see {@link memberRowKey}).
 */
export function memberRowExpanded(expansion, key) {
    return expansion.get(key) === true;
}
/**
 * Apply one explicit user toggle to the expansion store.
 *
 * ★ The result is a user choice from then on: it is stored, so the next poll's
 *   re-render reads it back rather than re-deriving a default. That is the whole
 *   of "a user's choice is not reset".
 * ★ Returns the SAME map when nothing changed, so a redundant toggle cannot
 *   invalidate every row on the next render.
 * @param expansion - the current store.
 * @param key - the row's stable key.
 * @returns the next store.
 */
export function toggleMemberRow(expansion, key) {
    const next = new Map(expansion);
    if (next.get(key) === true)
        next.delete(key);
    else
        next.set(key, true);
    return next;
}
/**
 * Drop expansion entries for members that are no longer on the team.
 *
 * ★ Without this, a store keyed by member id grows for the life of the panel —
 *   the panel is a shell-overlay singleton and outlives every conversation
 *   route change. Rows the user never touched are never added in the first
 *   place, so the pruning is only ever removing what a re-spawn replaced.
 * ★ Returns the same map when nothing was pruned.
 * @param expansion - the current store.
 * @param keys - every key the current roster defines.
 */
export function pruneMemberRows(expansion, keys) {
    const live = new Set(keys);
    let changed = false;
    const next = new Map();
    for (const [key, open] of expansion) {
        if (live.has(key))
            next.set(key, open);
        else
            changed = true;
    }
    return changed ? next : expansion;
}
/**
 * Read how long a member has been on the task it is currently on.
 *
 * The stamp comes from the task's durable `updatedAt` — a fact the host writes
 * on every change — never from a timer started in the browser, which would be
 * a guess that resets on reload.
 *
 * ★ The clock distinguishes running from stale because a dead member's open
 *   task still carries a fresh-looking stamp. Counting that as elapsed work is
 *   precisely the reading task t4 removed, so it is rendered as stalled instead.
 *
 * @param member - the member row; `liveness` decides running vs stale when present.
 * @param tasks - the team's tasks, supplying the durable stamps.
 * @param now - observation instant, injected so this stays pure.
 */
export function memberClock(member, tasks, now) {
    const driving = memberIsDriving(member);
    /**
     * ── ★★★ 空闲与"等待"必须分开，而**不再都塌成 `none`** ──────────────────────────
     *
     * MEASURED（用户 2026-10-11 实测，见下）：此前这里对两者都返回 `kind:'none'`，
     * 于是面板**整格空白** —— 而"这一格没东西"与"这个成员没事做"在界面上同形。
     *
     * ★ 三态的口径（用户原话：「要么显示已工作多长时间，要么显示已等待多长时间」）：
     *   · 有活而且在跑   ⇒ `running`：**已工作**多久（它确实在推进）
     *   · 有活而没在跑   ⇒ `stale`  ：**已等待**多久（没人推进它 —— 这才是要看的数）
     *   · 没有活         ⇒ `idle`   ：**空闲**，一个明确的中性读数（不是空白）
     *
     * ★ 而"有活"不含还没开始的任务（用户 2026-10-13：「任务还没开始怎么已经有时间」）。
     *   `pending` 的 `updatedAt` 是创建时间，拿它走表等于把"还没开工"显示成已工作/已等待。
     *   认领（`claimed`）和进行中才算已经开始。
     */
    const timed = timedTask(member, tasks);
    if (timed === undefined)
        return { kind: 'idle', ms: 0 };
    const stamp = durableStamp(timed.updatedAt);
    /**
     * ★ 拿不到戳 ⇒ `could-not-measure`，**不塌进 `idle`**。
     *   一个"读不出时间"与一个"它没事做"必须不同形（本仓三态纪律）。
     */
    if (stamp === undefined)
        return { kind: 'unknown', ms: 0 };
    const ms = Math.max(0, now - stamp);
    return { kind: driving ? 'running' : 'stale', ms, stamp };
}
/**
 * The durable stamp a member's clock is currently measured from.
 *
 * ★ Same picks as {@link memberClock}, returned as the raw stamp instead of a
 *   duration: the ticking component re-derives the duration each second from
 *   this stamp, so the panel never has to re-render to move the number.
 * @param member - the member row.
 * @param tasks - the team's tasks.
 * @returns the durable `updatedAt` being counted from, or undefined.
 */
export function memberClockStamp(member, tasks) {
    const timed = timedTask(member, tasks);
    return timed === undefined ? undefined : durableStamp(timed.updatedAt);
}
/**
 * The task a member's clock is allowed to time.
 *
 * ★ `pending` is assigned but not started. Its durable stamp is the create
 *   time, so counting from it draws a duration before any work exists.
 *   Claimed and in-progress are the statuses that have actually begun.
 */
function timedTask(member, tasks) {
    const started = tasks.filter((task) => task.assignee === member.name && taskHasStarted(task.status));
    if (started.length === 0)
        return undefined;
    const current = member.currentTask === undefined || member.currentTask === ''
        ? undefined
        : started.find((task) => task.id === member.currentTask);
    return current ?? started.reduce((latest, task) => {
        const stamp = durableStamp(task.updatedAt);
        const best = durableStamp(latest.updatedAt);
        return stamp !== undefined && (best === undefined || stamp > best) ? task : latest;
    }, started[0]);
}
/** Whether this status has left "not started". Pending has not. */
function taskHasStarted(status) {
    return status === 'claimed' || status === 'in_progress';
}
/** Wall-clock stamps from a hostile JSON source must be finite numbers to be read. */
function durableStamp(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/**
 * Whether something is actually driving this member right now.
 *
 * ★ `liveness` wins when the host publishes it: `activity` is a durable field
 *   that keeps saying `working` after the session is gone (the residual reading
 *   t4 exists to surface). Without `liveness` we fall back to `activity`, which
 *   is exactly today's behaviour rather than an invented one.
 */
function memberIsDriving(member) {
    const liveness = member.liveness;
    if (liveness !== undefined && liveness !== '')
        return liveness === 'working';
    return member.activity === 'working';
}
/** Compact elapsed copy for one row: `4s`, `12m`, `1h 5m`. */
export function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    if (minutes > 0)
        return `${minutes}m`;
    return `${seconds}s`;
}
/** Group tasks by their precomputed dependency depth. */
export function taskStages(tasks) {
    const byDepth = new Map();
    for (const task of tasks) {
        const depth = Number.isFinite(task.depth) ? Math.max(0, Math.floor(task.depth)) : 0;
        const stage = byDepth.get(depth) ?? [];
        stage.push(task);
        byDepth.set(depth, stage);
    }
    return [...byDepth.entries()]
        .sort(([left], [right]) => left - right)
        .map(([depth, stageTasks]) => ({
        depth,
        tasks: stageTasks.slice().sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true })),
    }));
}
/**
 * Lay tasks out as the reference panel's compact left-to-right DAG.
 *
 * Columns are dependency-depth stages. Rows are stable task-id order within
 * each stage. Edges use cubic curves so fan-in remains readable without
 * turning every task into a large card.
 */
export function compactDagLayout(tasks, dimensions) {
    const nodeWidth = dimensions?.nodeWidth ?? COMPACT_DAG_NODE_WIDTH;
    const nodeHeight = dimensions?.nodeHeight ?? COMPACT_DAG_NODE_HEIGHT;
    const columnGap = dimensions?.columnGap ?? COMPACT_DAG_COLUMN_GAP;
    const rowGap = dimensions?.rowGap ?? COMPACT_DAG_ROW_GAP;
    const stages = taskStages(tasks);
    const positions = new Map();
    const nodes = [];
    for (const [column, stage] of stages.entries()) {
        for (const [row, task] of stage.tasks.entries()) {
            const x = column * (nodeWidth + columnGap);
            const y = row * (nodeHeight + rowGap);
            positions.set(task.id, { x, y });
            nodes.push({ task, x, y });
        }
    }
    const edges = [];
    for (const task of tasks) {
        const target = positions.get(task.id);
        if (target === undefined)
            continue;
        for (const dependency of task.dependencies) {
            const source = positions.get(dependency);
            if (source === undefined)
                continue;
            const x1 = source.x + nodeWidth;
            const y1 = source.y + nodeHeight / 2;
            const x2 = target.x;
            const y2 = target.y + nodeHeight / 2;
            edges.push({
                from: dependency,
                to: task.id,
                path: `M${x1} ${y1}C${x1 + 14} ${y1},${x2 - 14} ${y2},${x2} ${y2}`,
            });
        }
    }
    const rows = Math.max(1, ...stages.map((stage) => stage.tasks.length));
    return {
        width: stages.length === 0
            ? 0
            : stages.length * nodeWidth + (stages.length - 1) * columnGap,
        height: stages.length === 0
            ? 0
            : rows * nodeHeight + (rows - 1) * rowGap,
        nodes,
        edges,
    };
}
/**
 * Return the complete upstream/downstream chain around one task.
 *
 * Traversal uses both dependency directions and remains cycle-safe, so the UI
 * can highlight every handoff related to the focused task even if malformed
 * durable data contains a cycle.
 */
export function relatedTaskIds(taskId, tasks) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    if (!byId.has(taskId))
        return new Set();
    const dependents = new Map();
    for (const task of tasks) {
        for (const dependency of task.dependencies) {
            const targets = dependents.get(dependency) ?? [];
            targets.push(task.id);
            dependents.set(dependency, targets);
        }
    }
    const related = new Set();
    const upstreamSeen = new Set();
    const downstreamSeen = new Set();
    const visitUpstream = (id) => {
        if (upstreamSeen.has(id))
            return;
        upstreamSeen.add(id);
        related.add(id);
        for (const dependency of byId.get(id)?.dependencies ?? [])
            visitUpstream(dependency);
    };
    const visitDownstream = (id) => {
        if (downstreamSeen.has(id))
            return;
        downstreamSeen.add(id);
        related.add(id);
        for (const dependent of dependents.get(id) ?? [])
            visitDownstream(dependent);
    };
    visitUpstream(taskId);
    visitDownstream(taskId);
    return related;
}
/** How many `ran[]` entries carry one verdict. */
function verdictTally(entries, verdict) {
    return entries.filter((entry) => entry.verdict === verdict).length;
}
/**
 * The verdict for every task a member owns, keyed by task id.
 *
 * ★ Purely derived: one `Map` walk, no host calls, so it is testable from the
 *   compiled `lib/client/activity-model.js` without a browser.
 */
export function memberGateReadouts(tasks) {
    const out = new Map();
    for (const task of tasks) {
        const raw = task.gateEvaluation;
        // ★ Absent / unreadable ⇒ 'absent'. This branch is the whole reason an
        //   unread tape must not look like a clean run.
        if (raw === undefined || raw === null || raw === '') {
            out.set(task.id, { state: 'absent' });
            continue;
        }
        const evaluation = readGateEvaluation(raw);
        if (evaluation === undefined) {
            out.set(task.id, { state: 'absent' });
            continue;
        }
        if (Array.isArray(evaluation.ran) && evaluation.ran.length === 0) {
            out.set(task.id, {
                state: 'empty',
                registered: evaluation.registered,
                ...evaluation.skippedAll === undefined ? {} : { skippedAll: evaluation.skippedAll },
            });
            continue;
        }
        out.set(task.id, { state: 'verdict', verdict: memberGateVerdict(evaluation), evaluation });
    }
    return out;
}
/**
 * Normalise one task's gate field into a record, whether it arrived serialised
 * or as an object. `undefined` = **unreadable**, which stays its own answer.
 */
function readGateEvaluation(raw) {
    if (typeof raw === 'string')
        return parseGateEvaluation(raw);
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const record = raw;
    if (!Array.isArray(record.ran))
        return undefined;
    return {
        ok: record.ok === true,
        blockers: Array.isArray(record.blockers) ? record.blockers : [],
        ran: record.ran,
        evaluated: typeof record.evaluated === 'number' ? record.evaluated : 0,
        skipped: typeof record.skipped === 'number' ? record.skipped : 0,
        registered: typeof record.registered === 'number' ? record.registered : 0,
        ...record.unmeasured === undefined ? {} : { unmeasured: record.unmeasured },
        ...record.skippedAll === undefined ? {} : { skippedAll: record.skippedAll },
        ...record.observedBlockers === undefined ? {} : { observedBlockers: record.observedBlockers },
    };
}
/** Parse the stringified record the status tool emits; undefined when unreadable. */
function parseGateEvaluation(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null)
            return undefined;
        const record = parsed;
        if (!Array.isArray(record.ran))
            return undefined;
        return {
            ok: record.ok === true,
            blockers: Array.isArray(record.blockers) ? record.blockers : [],
            ran: record.ran,
            evaluated: typeof record.evaluated === 'number' ? record.evaluated : 0,
            skipped: typeof record.skipped === 'number' ? record.skipped : 0,
            registered: typeof record.registered === 'number' ? record.registered : 0,
            ...record.unmeasured === undefined ? {} : { unmeasured: record.unmeasured },
            ...record.skippedAll === undefined ? {} : { skippedAll: record.skippedAll },
            ...record.observedBlockers === undefined ? {} : { observedBlockers: record.observedBlockers },
        };
    }
    catch {
        // ★ Malformed text is "cannot read", NOT "read and clean". Same shape rule.
        return undefined;
    }
}
/**
 * The one symbol for a member's compact verdict band.
 *
 * ★ `observed` (fired but waived) is its own answer — it must not read as `ok`
 *   ("gentle, nothing happened") nor as `blocked` ("it stopped the flow").
 *
 * ── ★★★ 队长修复（2026-10-16）：`skippedAll` 在场 ⇒ 绝不是 `ok` ──────────────
 *
 * MEASURED（实测）：全跳过时 `ran` 里**有**条目（每条 `verdict:'skipped'`），
 * 而修前这里只数 `blocked`/`unmeasured` ⇒ **返回 `ok`** ⇒ 界面画成 **✓**。
 *
 * ★★ 而注册表**逐字**说了它的本意（`registry.ts:884-886`）：
 *   「采用 ② 的本意：**让裁决不再无条件给 `ok`**，而不复用 `unmeasured`：
 *      `ok: false` + `blockers: []` + `unmeasured: undefined` + `skippedAll: <说明>`」
 *   ⇒ 即 **`skippedAll` 在场就是"不是 ok"的机械标志**。
 *
 * ⇒ 所以这一支**按注册表自己的判据**判，不发明新的：
 *   `skippedAll` 在场 ⇒ `unmeasured`（"没测到"，与它的同为"没测到"一族）。
 */
export function memberGateVerdict(evaluation) {
    if (typeof evaluation.unmeasured === 'string' && evaluation.unmeasured !== '')
        return 'unmeasured';
    /**
     * ★ 全跳过：`ran` 非空（全是 `skipped`），而 `skippedAll` 在场。
     * ⇒ 它是"判据没跑"，**不是**"跑过且通过"。两者在界面上必须不同形。
     */
    if (typeof evaluation.skippedAll === 'string' && evaluation.skippedAll !== '')
        return 'unmeasured';
    const observed = evaluation.ran.filter((entry) => entry.observed === true);
    if (observed.length > 0 || (evaluation.observedBlockers ?? 0) > 0)
        return 'observed';
    const abnormal = verdictTally(evaluation.ran, 'blocked') + verdictTally(evaluation.ran, 'unmeasured');
    if (abnormal > 0)
        return 'blocked';
    return 'ok';
}
