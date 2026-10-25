/**
 * Event-driven shared task scheduler.
 *
 * Claude Code teammates keep polling the shared task list after a turn. DSH
 * continuable agents instead expose explicit idle/running edges, so this
 * scheduler closes the same loop without keeping a polling turn alive: every
 * idle edge and every task-graph mutation attempts one atomic claim and wakes
 * the selected durable member. A resident member that becomes idle while it
 * still owns an open attempt is parked: only an explicit captain reassignment
 * may rotate that capability. Automatic retry is reserved for cold recovery,
 * when this process has not observed the durable owner settle its open attempt.
 * @module dsh-agent-teams/scheduler
 */
import { join } from 'node:path';
import { liveAgentOf } from "./events.js";
import { deliverToMember, deliverToMemberDetailed } from "./members.js";
import { sessionLeadsTeam } from "./lineage.js";
import { identityOfTeam, liveRefsOf } from "./members.js";
import { isCurrentMail, mailboxPrompt } from "./mailbox.js";
import { createTaskWorktree, describeBaseline, provisionWorktreeDependencies, worktreePromptLine } from "./worktree.js";
import { snapshotTestFiles } from "./artifacts.js";
import { shouldSnapshotTestFiles } from "./quality-gates.js";
import { restartQueueFrom } from "./tools/shared/entities.js";
import { markMailboxDelivered, discardMailboxMessages, beginTaskAttempt, CAPTAIN_KEY, claimMailboxDelivery, dependencyStatuses, describeDependencyOutcomes, findTeamByParticipant, invalidateTaskAttempt, readTeam, readPendingMailbox, releaseMailboxDelivery, unsatisfiedDependencies, withTeamLock, writeTeam, } from "./state.js";
/**
 * ★ t28：终态判定用**唯一那份真值**（`types.ts`），不在本模块重写一遍列表。
 *   「哪些状态是终态」是一条会变的规则；两份拷贝会漂移 —— 而漂移的那一天，
 *   scheduler 与 state 会对同一个任务给出相反的答案，且两者读起来都很正常。
 */
import { TERMINAL_TASK_STATUSES, needsWorktreeFor } from "./types.js";
/** Per-dependency output cap in the assignment prompt. */
export const DEPENDENCY_OUTPUT_MAX_CHARS = 2_000;
/** Combined dependency-output budget in the assignment prompt. */
export const DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS = 12_000;
/**
 * ── ★★★ 一次邮箱投递的**硬上限** ────────────────────────────────────────────────
 *
 * MEASURED：投递外层套着 `serializeMember`，而那条队列是**链式**的 ——
 * 一次不返回，`release()` 就永不执行，**之后所有**对同一成员的写入永久排队；
 * 又因为 `withTeamLock(teamLockKey…)` 在它内部，**整个团队**的写入一起卡住。
 * 表现出来就是工具调用"卡在 complete / reassign_task 上"。
 *
 * ★ 30 秒是**取决于用途**的：投递是"把一条已经在邮箱里的消息推给一个活着的会话"，
 *   正常是毫秒级。超过 30 秒它不是慢，而是**那个会话已经不接东西了** ——
 *   此时正确的处置是把消息**留在邮箱**（`releaseMailboxDelivery`），
 *   让下一次扫描再试，而不是**无限期占着队列**。
 */
export const DELIVER_TIMEOUT_MS = 30_000;
/**
 * 不注入的顶层条目 —— **闭集，每条带理由**。
 *
 * ★ 理由不是给人看的注释，它是**读数的一部分**：它会被打出来，而"为什么没注入"
 *   决定了下一步该做什么（自我复制 ⇒ 别管它；包仓 ⇒ 别管它）。
 */
const REFUSED_DEPENDENCY_ENTRIES = [
    {
        entry: '.agent-teams',
        /**
         * ★ 这一条尤其严重：`.agent-teams` 是**正在被写的运行时状态**，
         *   而且它里面**装着所有 worktree**（每棵都有自己的目录）。
         *   ⇒ 注入它 = **把一个目录拷进它自己里面**，而且是 4.7G × N。
         */
        reason: 'refused: this is this repository\'s own live runtime state (it contains every worktree, '
            + 'including this one) — copying it into a worktree is self-replication, not a dependency',
    },
    {
        entry: '.pnpm-store',
        reason: 'refused: this is the shared package store — a content-addressed cache that is shared on purpose; '
            + 'copying it per worktree buys nothing and costs gigabytes',
    },
    {
        entry: '.DS_Store',
        reason: 'refused: Finder metadata, not a dependency',
    },
];
/**
 * 把 `missingIgnored` 的【候选】变成【该注入的清单】。
 *
 * ★ 这是唯一一处做这个决定的地方 —— 而它的输入仍是 `missingIgnored`（唯一来源），
 *   没有另读 `.gitignore`（那是 git 的事，t24 边界）。
 */
export function planDependencyInjection(candidates) {
    const refused = new Map(REFUSED_DEPENDENCY_ENTRIES.map(item => [item.entry, item.reason]));
    const injected = [];
    const excluded = [];
    for (const entry of candidates) {
        const reason = refused.get(entry);
        if (reason === undefined) {
            /** ★ 默认注入：不认识的新条目按候选的意思来（见上面"为什么不是默认排除"）。 */
            injected.push(entry);
            continue;
        }
        excluded.push({ entry, reason });
    }
    return { injected, excluded };
}
function taskProfileSeedId(task) {
    const seed = task.profileSeedId?.trim();
    return seed === undefined || seed === '' ? undefined : seed;
}
function teamProfileProtocol(team) {
    return team.profile?.protocol;
}
/**
 * ── ★★★ 一条任务的**直接上游**（t5）：它们是建树基线的唯一来源 ──────────────────
 *
 * `docs/WORKTREE-BASE-DEFECT.md`：依赖边此前只表达**顺序**，不表达**可见性** ——
 * 于是下游的树从主树 HEAD 建，上游的提交**不在**里面 ⇒ 下游在旧代码上干活，
 * 且两者写域重叠时下游会整文件覆盖掉上游的修复（实测 94 条实现→实现边里
 * 60 条写域重叠、47 条上游真的提交了）。
 *
 * ── 为什么只取【直接】边，而不是全祖先 ─────────────────────────────────────────
 *
 * 递归会让"可见性"从一个可核对的**局部**性质变成一次闭包推理。而直接边已经
 * 足够，理由是**归纳的**：B 依赖 A ⇒ B 的树含 A 的产物 commit ⇒ B 自己的产物
 * commit 是 A 的后代 ⇒ C 依赖 B ⇒ C 的树含 B（因而也含 A）。
 * ★ 而这条归纳**只在每一层都真的按产物定基线时成立** —— 所以这里宁可少收，
 *   也不要把"我以为它含了"当成读数。
 *
 * ── ★ 反向半边：没有依赖边 ⇒ 返回空数组 ────────────────────────────────────────
 *
 * 空数组是**有意义**的：它让 `resolveWorktreeBaseline` 走 `source: 'trunk'`，
 * 也就是"这条任务的上游就是主干本身"。⇒ 与之并行的任务**看不见**彼此的产物，
 * 那是**对的**（它们之间没有边），而这一格必须与"有边但上游没提交"不同形
 * （后者是 `[{kind:'not-committed'}]`，见 `describeBaseline` 的措辞）。
 */
export function collectUpstreamBaselines(tasks, task) {
    const byId = new Map(tasks.map(candidate => [candidate.id, candidate]));
    return task.dependencies.map((dependencyId) => {
        const dependency = byId.get(dependencyId);
        if (dependency === undefined) {
            /**
             * ★ 未知依赖 id ⇒ `unreadable`，**不是** `not-committed`。
             *   两者后果相反：前者要人去查"那条任务怎么没了"，后者是"它确实没产出"。
             *   （`unsatisfiedDependencies` 也把未知 id 当阻塞 —— 同一条纪律。）
             */
            return { taskId: dependencyId, unreadable: 'it is not in this team any more' };
        }
        return dependency.deliverableCommit === undefined
            ? { taskId: dependency.id }
            : { taskId: dependency.id, deliverableCommit: dependency.deliverableCommit };
    });
}
/**
 * ── ★★ 递归收集【已了结】的上游及其结论（t28 修 f-0018）─────────────────────────
 *
 * 按拓扑序（依赖在前、下游在后）收集 `taskId` 的祖先。环只截断那一条分支。
 *
 * ── MEASURED（2026-10-07，本任务复现的基线）────────────────────────────────────
 *
 * 这一行此前是：
 *
 *     return ordered
 *       .filter(task => task.status === 'completed')
 *
 * ⇒ 它把 failed / cancelled 的上游**整个丢掉**。而 t26 刚把依赖口径改成
 *   「终态即满足」⇒ 下游会因为一条 failed 上游而**开工**，然后拿到：
 *
 *     Completed dependency results:
 *     (none)
 *
 * ★ 那是本队记账的"把没测到并进通过"在同一条链上的第二次发作，只是这次
 *   并进去的是**整个上游**：
 *
 *     下游看不见的那件事（"上面失败了"）
 *     在下游眼里与"没有前置依赖"长得一模一样
 *
 * ── 修法是换一个更准的问题 ────────────────────────────────────────────────────
 *
 *     「哪些上游【成功了】」        —— 旧口径（下游于是永远不知道别的终态存在）
 *     「哪些上游【已经了结】」      —— 新口径（终态 = 不再欠工作 = 有结论可交）
 *
 * ── ★ 但"交出去"与"审核过"是两件事 ──────────────────────────────────────────
 *
 * 本函数**只负责把结论交出去**：它不判定那份 failed 要不要紧、不替下游决定
 * 该不该继续。用户裁定的口径是乙 —— "不替下游做决定，而是把状态交出去"。
 * 所以每一项都带 {@link DependencyOutput.status}，下游据此自己决定。
 *
 * ★ 而"还没了结"的上游**仍然不进来**：pending / claimed / in_progress 的任务
 *   没有结论可交（它还在写）。把它们也塞进来会让下游读到半截输出，
 *   而"上游还在做"与"上游做完了、结果是这样"必须不同形。
 *
 * ★ 函数的**名字**保留 `collectCompletedDependencyOutputs`：它在 `src/tools.ts`
 *   与 `scripts/verify.mjs` 里各有一个已经存在的调用者，而两者都在本任务的
 *   Out of scope 里。改名会让那两个文件立刻编译不过 —— 那是把一次口径修复
 *   变成一次跨文件重构。口径的说明在这里，名字的历史包袱留一行注释交代。
 */
export function collectCompletedDependencyOutputs(tasks, taskId, warn) {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const visiting = new Set();
    const visited = new Set();
    const ordered = [];
    const walk = (id) => {
        if (visiting.has(id)) {
            warn?.(`agent-teams: dependency cycle involving "${id}" while collecting outputs; stopping this branch`);
            return;
        }
        if (visited.has(id))
            return;
        visiting.add(id);
        const task = byId.get(id);
        if (task !== undefined) {
            for (const dependency of task.dependencies)
                walk(dependency);
            if (id !== taskId)
                ordered.push(task);
        }
        visiting.delete(id);
        visited.add(id);
    };
    walk(taskId);
    return ordered
        /**
         * ★ 只放行【终态】：终态即"有结论可交"。非终态的上游还在写，
         *   把它交出去等于把半截输出当成结论。
         */
        .filter(task => TERMINAL_TASK_STATUSES.includes(task.status))
        .map((task) => {
        const profileSeedId = taskProfileSeedId(task);
        return {
            id: task.id,
            subject: task.subject,
            /**
             * ★ 终态本身（`completed` / `failed` / `cancelled`）。它**必须**在场：
             *   下游要能问出"上面是成功了还是出事了"，而那是它决定怎么往下走的
             *   唯一输入。缺了它，failed 与 completed 在派发文本里又同形了 ——
             *   那正是这次要修的东西。
             */
            status: task.status,
            ...profileSeedId === undefined ? {} : { profileSeedId },
            ...task.output === undefined ? {} : { output: task.output },
        };
    });
}
/**
 * ── ★★ 把已了结的依赖渲染成下游读得懂的一段（t28）─────────────────────────────
 *
 * 每条带上它的**终态**。这一格不是装饰：t28 修的正是"下游解锁了却拿不到东西"，
 * 而只把 output 印出来还不够 —— 一条 `failed` 上游与一条 `completed` 上游
 * 如果都只印出一行文字，下游仍然读不出"上面出过事"。
 *
 * ★ 渲染成 `[failed]` 这样的标记，而不是把 status 塞在正文里：
 *   下游（以及读日志的人）要能**一眼**扫出哪几条不是 completed，
 *   而一行正文里的一个词做不到这件事。
 *
 * ★ 缺席 `status` 时**不印任何标记**（只印老的形状）：
 *   一个伪造 `[completed]` 的兜底会让"这一项没带终态"与"它真的成功了"同形 ——
 *   而那是本次修复要消灭的形态本身。
 */
export function formatDependencyOutputs(items) {
    if (items.length === 0)
        return '(none)';
    const formatted = items.map((item) => {
        const seed = item.profileSeedId === undefined ? '' : ` [${item.profileSeedId}]`;
        /**
         * ★ 非 completed 的终态用大写标记，completed 用普通标记：
         *   读的人要能**扫**出哪一条需要先看一眼，而不是逐字读完每一行。
         *   两者都印（不是只印异常的），因为"全都印不出标记"与"全都没问题"同形。
         */
        const marker = item.status === undefined ? '' : ` [${item.status}]`;
        const raw = item.output === undefined || item.output === ''
            ? '(no output recorded)'
            : item.output;
        const truncated = raw.length > DEPENDENCY_OUTPUT_MAX_CHARS;
        const body = truncated ? `${raw.slice(0, DEPENDENCY_OUTPUT_MAX_CHARS)} [truncated]` : raw;
        return `- ${item.id}${seed}${marker} ${item.subject}:\n  ${body}`;
    });
    let selected = formatted;
    while (selected.length > 1 && selected.join('\n').length > DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS) {
        selected = selected.slice(1);
    }
    const last = selected[0];
    if (selected.length === 1 && last !== undefined && last.length > DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS) {
        selected = [`${last.slice(0, DEPENDENCY_OUTPUTS_TOTAL_MAX_CHARS)} [truncated]`];
    }
    return selected.join('\n');
}
function stateRootOf(workspace, config) {
    return join(workspace, config.stateDir);
}
function teamLockKey(stateRoot, teamId) {
    return `team:${stateRoot}:${teamId}`;
}
function liveCaptain(ctx, captainSessionId, supplied) {
    if (supplied !== undefined && supplied.id === captainSessionId)
        return supplied;
    return liveAgentOf(ctx, captainSessionId);
}
function liveMember(ctx, member) {
    return liveAgentOf(ctx, member.id);
}
function isMemberAvailable(ctx, member) {
    if (member.stopping === true)
        return false;
    const live = liveMember(ctx, member);
    return live === undefined || live.status === 'idle';
}
function ownedOpenTask(tasks, memberName) {
    return tasks.find(task => task.assignee === memberName
        && (task.status === 'claimed' || task.status === 'in_progress'));
}
/**
 * ── ★★ 派发的第三个闸门：重载排队（t50）─────────────────────────────────────────
 *
 * ★ 它与 `halted` / `phase === 'staged'` **并列**，理由是同一条：
 *   三者都回答"此刻**不该**开新工作"，而它们各有各的成因 ⇒ 必须**分别**判。
 *
 * ── ★ 为什么它【不是】halted ────────────────────────────────────────────────────
 *
 *   `halted` 是一个**持久**的、由人设的状态（团队被叫停）；而重载排队是
 *   **暂时**的（换完版本就没了）。把两者合成一个状态，会让"等人拍板要不要继续"
 *   与"等这一次交接做完"在日志里**同形**。
 *
 * ★★★ MEASURED（2026-10-09，captain 实测）：本函数与它的三处调用曾被
 *   `t24` 的【整文件 `cp` 覆盖】**静默删除** —— 而"它一直不在"与
 *   "它刚被删掉"在代码里同形，所以没有任何读数会说。
 *   ⇒ 本次恢复，并补一条臂钉住它（删掉 ⇒ 臂红）。
 */
function dispatchHeldByReload(tasks) {
    const state = restartQueueFrom(tasks.map((task) => ({ id: task.id, status: task.status })));
    if (state.status === 'none')
        return { held: false, state: 'none', detail: '' };
    if (state.status === 'waiting') {
        return {
            held: true,
            state: 'waiting',
            detail: state.waitingOn.length === 0
                ? 'a reload has been requested and nothing is in flight — it is about to run'
                : `a reload has been requested and is waiting on ${state.waitingOn.join(', ')}`,
        };
    }
    /**
     * ★ `stuck` 与 `waiting` **分别**处理：两者都"不派发"，而只有 `stuck` 要上报。
     *   把它们合成一条会让"再等一会儿"与"叫人来"同形 —— 而那正是本队记过的那条。
     */
    return { held: true, state: 'stuck', detail: state.reason };
}
function nextReadyTask(tasks, memberName) {
    const ready = tasks.filter(task => task.status === 'pending'
        && task.reassigning !== true
        && unsatisfiedDependencies([...tasks], task.dependencies).length === 0);
    return ready.find(task => task.assignee === memberName)
        ?? ready.find(task => task.assignee === undefined);
}
export function assignmentPrompt(ticket, stateDir, teamId) {
    const description = ticket.description === undefined ? '' : `\n\n${ticket.description}`;
    const seed = ticket.profileSeedId === undefined ? '' : ` [${ticket.profileSeedId}]`;
    const goal = ticket.teamDescription?.trim() || '(not provided)';
    const protocol = ticket.profileProtocol?.trim() || '(none)';
    const executionPrompt = ticket.executionPrompt?.trim();
    const kind = ticket.kind?.trim() || 'work';
    /**
     * ── ★ 隔离工作目录：告诉成员"在哪干活" ────────────────────────────────────────
     *
     * 子会话的 cwd 硬编码继承父会话（START-HERE §5②），**改不了** ⇒ 隔离只能靠
     * "给一个独立目录 + 在提示里告诉成员"。没有路径时本块为空 ——
     * **绝不产出一个伪造的工作目录指令**（那会让成员以为有隔离，实际没有）。
     *
     * ★ 缺依赖必须明说：worktree 是干净的检出，gitignore 的 `node_modules`
     *   不在里面（实测边界③）。不说 ⇒ 成员跑 `pnpm test` 失败，然后把一次
     *   "环境没准备好"误报成"工作没做出来"——这两件事不同形（契约 §3.4）。
     */
    const worktreeLine = worktreePromptLine(ticket.worktreePath);
    const missingIgnored = ticket.worktreeMissingIgnored ?? [];
    const worktreeBlock = worktreeLine === ''
        ? ''
        : `
${worktreeLine}${missingIgnored.length === 0 ? '' : `
Note: ${missingIgnored.join(', ')} exist in the captain's workspace but not in this worktree (they are gitignored, so a clean checkout does not carry them). Install/set them up inside the worktree before running verification commands, or a missing dependency will look like a failing test.`}
`;
    /**
     * ── ★ 降级派发时必须【明说】没有隔离 ─────────────────────────────────────────
     *
     * 这里不产出工作目录指令（绝不伪造一个），但也不能沉默：成员会以为自己在一个
     * 隔离的检出里，而实际上它正和全队共用目录。措辞必须让"没隔离"与"不需要隔离"
     * 不同形 —— 前者是环境限制，后者是这一步本来就不涉及写文件。
     */
    const unavailableLine = typeof ticket.worktreeUnavailable === 'string' && ticket.worktreeUnavailable.trim() !== ''
        ? `
No isolated worktree: ${ticket.worktreeUnavailable.trim()}
Work directly in the shared workspace. Work that needs a parent revision (R5 red-then-green, mutation testing) cannot be measured here and will be reported as such rather than as passing.`
        : '';
    const contract = [
        `Kind: ${kind}${ticket.round === undefined ? '' : ` (round ${ticket.round})`}`,
        ticket.objective === undefined || ticket.objective === '' ? '' : `Objective: ${ticket.objective}`,
        ticket.inScope === undefined || ticket.inScope.length === 0 ? '' : `In scope: ${ticket.inScope.join(', ')}`,
        ticket.outOfScope === undefined || ticket.outOfScope.length === 0 ? '' : `Out of scope: ${ticket.outOfScope.join(', ')}`,
        ticket.acceptance === undefined || ticket.acceptance.length === 0 ? '' : `Acceptance: ${ticket.acceptance.join('; ')}`,
        ticket.verify === undefined || ticket.verify.length === 0 ? '' : `Verify: ${ticket.verify.join('; ')}`,
        ticket.reviewedTaskId === undefined ? '' : `Reviewed task: ${ticket.reviewedTaskId}`,
    ].filter((line) => line !== '').join('\n');
    const structuredCompletion = ['implementation', 'repair', 'verification', 'integration'].includes(kind)
        ? `
Structured completion payload (keep these arrays in contract order):
acceptanceResults: ${JSON.stringify((ticket.acceptance ?? []).map((criterion) => ({ criterion, status: 'passed', evidence: '<what proved it>' })))}
commandsRun: ${JSON.stringify((ticket.verify ?? []).map((command) => ({ command, status: 'passed', exitCode: 0, evidence: '<observed result>' })))}
${kind === 'implementation' || kind === 'repair' ? 'changedPaths: list the actual workspace-relative POSIX paths you changed.\n' : ''}`
        : '';
    return `AgentTeams automatic task assignment from the shared task list.

You are executing as configured member "${ticket.memberName}".
Do not start a teammate's assigned task.
${worktreeBlock}${unavailableLine}
Team goal:
${goal}

Profile protocol:
${protocol}
${executionPrompt === undefined || executionPrompt === '' ? '' : `
Execution guidance:
${executionPrompt}
`}
Completed dependency results:
${formatDependencyOutputs(ticket.dependencyOutputs)}
${ticket.dependencyOutcomes === '' ? '' : `
${ticket.dependencyOutcomes}
`}

Task: ${ticket.taskId}${seed} — ${ticket.subject}${description}
${contract === '' ? '' : `\nContract:\n${contract}\n`}
${structuredCompletion}
Attempt: ${ticket.attempt}
Attempt id: ${ticket.attemptId}

Call agent_teams_claim_task for ${ticket.taskId}; it will return this same attempt_id. Include attempt_id=${ticket.attemptId} in every agent_teams_update_task call. If it is rejected as stale, stop work because the task was reassigned. claimed cannot jump to completed. Mark in_progress first, then completed or failed. Include attempt_id on every update. Then send_message to captain with source_task_id and source_attempt_id and become idle.
When finishing: use status=completed only when the task's success criteria are satisfied; use status=failed when blocking findings or validation failures mean downstream work must not proceed; include a concise output in either case. Quality kinds must submit structured fields: review/requirements need verdict=pass to complete (needs_revision/reject must fail with findings); implementation/repair/verification/integration need acceptanceResults and commandsRun, while implementation/repair also need in-scope changedPaths. Use status values "passed" or "failed" inside those arrays. After the work and verification finish, call agent_teams_update_task immediately; do not wait for captain confirmation and do not continue exploring. Do not approve your own implementation. Mail is not a formal next review. Completed work must not be repeated to attach late evidence: call update_task on the original task with its attempt_id and acceptanceResults/commandsRun/evidence_note; supplements are append-only and cannot change its verdict. Treat the dependency results above as source material. Do not ignore them. Work only this task and only its in-scope paths in this turn.

State policy: ${stateDir}/${teamId}/ is read-only diagnostics; mutate team state only through agent_teams_* tools.`;
}
/** Install one scheduler and its member activity observer. */
export function installTeamScheduler(ctx, config) {
    const memberQueues = new Map();
    // An idle edge in this process proves that the resident member ended its
    // turn while the current attempt was still open. Remember that capability
    // even after Harness disposes the continuable AgentHandle: later status or
    // graph kicks must keep it parked. A cold process starts with an empty map,
    // so durable open attempts are still recovered after restart.
    const parkedAttempts = new Map();
    const memberQueueKey = (stateRoot, teamId, memberName) => (`${stateRoot}\u0000${teamId}\u0000${memberName}`);
    /**
     * ★ 时钟（t5）：调度器只从这一个地方读时间。
     *
     * 默认实现是 `Date.now`（生产路径），注入的假时钟让夹具能在**不真的等待**的
     * 情况下构造"派发之后过了 11 分钟"。判据层绝不自己读时间（契约 §2 性质 1），
     * 而这个时间戳就是它唯一的来源。
     */
    const clock = () => config.now?.() ?? Date.now();
    const serializeMember = async (key, operation) => {
        const previous = memberQueues.get(key) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const tail = previous.then(() => gate);
        memberQueues.set(key, tail);
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
            if (memberQueues.get(key) === tail)
                memberQueues.delete(key);
        }
    };
    const runtime = {
        async kickTeam(workspace, teamId, suppliedCaptain) {
            const stateRoot = stateRootOf(workspace, config);
            const team = await readTeam(stateRoot, teamId);
            if (team === undefined || team.halted === true || team.phase === 'staged')
                return;
            /**
             * ★ t50：重载排队期间**不派发新成员工作**。
             *   ★ 放在 `kickTeam` 这一层，意味着"连一次扫描都不做" ——
             *     比逐个成员拒绝更早、也更省（而两者都不派发）。
             */
            const heldAtTeam = dispatchHeldByReload(team.tasks);
            if (heldAtTeam.held) {
                ctx.logger.info(`agent-teams: dispatch held while a reload is queued (${heldAtTeam.state}) — ${heldAtTeam.detail}`);
                return;
            }
            const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain);
            if (captain === undefined)
                return;
            for (const member of team.members) {
                if (member.status === 'removed')
                    continue;
                await runtime.kickMember(workspace, teamId, member.name, captain);
            }
        },
        async kickMember(workspace, teamId, memberName, suppliedCaptain) {
            const stateRoot = stateRootOf(workspace, config);
            const queueKey = memberQueueKey(stateRoot, teamId, memberName);
            await serializeMember(queueKey, async () => {
                let team = await readTeam(stateRoot, teamId);
                if (team === undefined || team.halted === true || team.phase === 'staged')
                    return;
                /**
                 * ★ t50：同上 —— 单成员派发也要被挡住。
                 *   ★ 两处都判是**刻意的**：`kickMember` 可被单独调用（不是每次都经过 `kickTeam`），
                 *     只挡一处会让另一条路径成为**绕过闸门**的路。
                 */
                const heldAtMember = dispatchHeldByReload(team.tasks);
                if (heldAtMember.held) {
                    ctx.logger.info(`agent-teams: dispatch held while a reload is queued (${heldAtMember.state}) — ${heldAtMember.detail}`);
                    return;
                }
                const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain);
                if (captain === undefined)
                    return;
                let member = team.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed');
                if (member === undefined || !isMemberAvailable(ctx, member))
                    return;
                // A mailbox-only fallback is real pending work. Deliver it before a
                // fresh task and acknowledge only after Harness accepts the follow-up.
                const unread = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                    const fresh = await readTeam(stateRoot, team.id);
                    if (fresh === undefined)
                        return [];
                    const pending = await readPendingMailbox(stateRoot, fresh.id, member.name);
                    await discardMailboxMessages(stateRoot, fresh.id, member.name, pending.filter(message => !isCurrentMail(fresh, message)).map(message => message.id));
                    const current = pending.filter(message => isCurrentMail(fresh, message));
                    await claimMailboxDelivery(stateRoot, fresh.id, member.name, current.map(message => message.id));
                    return current;
                });
                if (unread.length > 0) {
                    const prompt = mailboxPrompt(team.id, member.name, unread);
                    /**
                     * ── ★★★ 投递必须**有上限**，否则它会把整条成员队列钉死 ─────────────────────
                     *
                     * MEASURED（本仓实测）：这里原来写的是 `new AbortController().signal`，
                     * 而全文件**创建了 2 个 AbortController、`.abort()` 出现 0 次**
                     * （`grep -c` 当场可数）。⇒ 那个 signal **永远不可能触发**，是死重：
                     * 代码**看起来**有取消能力，而实际一步都取消不了。
                     *
                     * ★ 而它与本函数外层的 `serializeMember(queueKey, …)` 合起来就卡死了：
                     *   队列是**链式**的（`previous.then(() => gate)`，见 `serializeMember`），
                     *   只要**一次** `deliverToMember` 不返回，`gate` 就永不 `release()`，
                     *   于是**之后所有**对同一成员的写操作全部**永久排队**。
                     *   ⇒ 而 `withTeamLock(teamLockKey…)` 在它内部 ⇒ **整个团队的写入**一起卡住。
                     *
                     * ★ 表现出来就是用户看到的那一幕：`reassign_task`、`update_task`、
                     *   `complete` **看起来"卡在工具调用上"**，而落盘**可能早就完成了** ——
                     *   于是重试既成功又失败，来回几次之后整轮就再也推不动。
                     *
                     * ★ 处置：给投递一个**真实的**上限。超时**不算投递成功**（`accepted = false`），
                     *   消息**留在邮箱里**由下一次扫描再投 —— 这正是 `else` 那一支已经在做的
                     *   `releaseMailboxDelivery`，所以没有事实丢失，只是**不再无限期占着队列**。
                     */
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS);
                    let accepted;
                    try {
                        accepted = config.dispatch === undefined
                            ? await deliverToMember(ctx, captain, member.id, prompt, controller.signal, 'steer')
                            : await config.dispatch(captain, team.id, member.name, prompt, controller.signal, 'steer');
                    }
                    finally {
                        clearTimeout(timer);
                    }
                    if (accepted) {
                        await withTeamLock(teamLockKey(stateRoot, team.id), () => (markMailboxDelivered(stateRoot, team.id, member.name, unread.map(message => message.id))));
                    }
                    else {
                        await withTeamLock(teamLockKey(stateRoot, team.id), () => (releaseMailboxDelivery(stateRoot, team.id, member.name, unread.map(message => message.id))));
                    }
                    return;
                }
                /**
                 * ── ★★★ 测试文件基线：**在锁外**拍（2026-10-20，补 t5）───────────────────────
                 *
                 * ★★ 理由与 `claim.ts` 那处逐字相同：`withTeamLock` 串行化**整个团队**的
                 *   写操作，而下面这个锁里要做的是"构造派工票"这件**关键路径**上的事。
                 *   在锁内遍历目录 + 读 200 个文件的字节，会把所有人一起拖住 ——
                 *   而这只是一条**记录**，不是裁决。
                 *
                 * ★ 口径：它拍的是"**即将派出去那一刻**"的字节（成员还没开工）
                 *   ⇒ 与"开工那一刻"的距离是一次锁等待，而那正是要的边界。
                 */
                const testFileSnapshot = await snapshotTestFiles(workspace);
                const ticket = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                    const fresh = await readTeam(stateRoot, team.id);
                    if (fresh === undefined || fresh.halted === true || fresh.phase === 'staged')
                        return undefined;
                    /**
                     * ★ t50：第三处 —— 票从队列里取出之前再判一次。
                     *   此处与上两处**同一读数、不同位置**：上两处挡"开始扫描"，
                     *   这一处挡"把已经选好的票送出去"（两者之间隔着 await，状态可能变）。
                     */
                    const held = dispatchHeldByReload(fresh.tasks);
                    if (held.held) {
                        ctx.logger.info(`agent-teams: dispatch held while a reload is queued (${held.state}) — ${held.detail}`);
                        return undefined;
                    }
                    const currentMember = fresh.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed');
                    if (currentMember === undefined || !isMemberAvailable(ctx, currentMember))
                        return undefined;
                    const owned = ownedOpenTask(fresh.tasks, currentMember.name);
                    // An idle edge observed by this scheduler parks the exact open
                    // capability. Harness may dispose its AgentHandle after settlement,
                    // so registry absence is not evidence that the owner was lost. Keep
                    // the marker sticky across later kicks; only a durable attempt that
                    // this process has not observed is eligible for one cold recovery.
                    const parkedAttemptId = parkedAttempts.get(currentMember.id);
                    const recoverOwned = owned !== undefined
                        && (owned.attemptId === undefined || owned.attemptId !== parkedAttemptId);
                    const task = recoverOwned ? owned : owned === undefined
                        ? nextReadyTask(fresh.tasks, currentMember.name)
                        : undefined;
                    if (task === undefined) {
                        if (currentMember.status !== 'idle') {
                            currentMember.status = 'idle';
                            await writeTeam(stateRoot, fresh);
                        }
                        return undefined;
                    }
                    const previousAssignee = task.assignee;
                    const previousStatus = recoverOwned ? task.status : undefined;
                    const previousAttempt = recoverOwned ? task.attempt : undefined;
                    const previousAttemptId = recoverOwned ? task.attemptId : undefined;
                    const previousResult = recoverOwned ? {
                        output: task.output, verdict: task.verdict, findings: task.findings,
                        changedPaths: task.changedPaths, acceptanceResults: task.acceptanceResults, commandsRun: task.commandsRun,
                    } : undefined;
                    /**
                     * ★ 只在**写类 kind** 上写基线（与 `claim.ts` 同一口径）——
                     *   非写类传 `undefined` ⇒ 一个键都不写 = "没能拍"，**不是**"没有测试文件"。
                     */
                    const attemptId = beginTaskAttempt(task, currentMember.name, shouldSnapshotTestFiles(task.kind) ? testFileSnapshot.baseline : undefined);
                    // A recovered generation is parked before delivery. This makes each
                    // (member, attempt) recovery idempotent even if every status poll
                    // sees a disposed handle. Fresh pending work remains unparked so a
                    // genuinely lost first delivery can be recovered once.
                    if (recoverOwned)
                        parkedAttempts.set(currentMember.id, attemptId);
                    else
                        parkedAttempts.delete(currentMember.id);
                    currentMember.status = 'working';
                    await writeTeam(stateRoot, fresh);
                    const profileSeedId = taskProfileSeedId(task);
                    const protocol = teamProfileProtocol(fresh);
                    return {
                        taskId: task.id,
                        memberName: currentMember.name,
                        memberId: currentMember.id,
                        attempt: task.attempt ?? 1,
                        attemptId,
                        previousAssignee,
                        recoveredOwned: recoverOwned,
                        ...previousResult === undefined ? {} : { previousResult },
                        ...previousStatus === undefined ? {} : { previousStatus },
                        ...previousAttempt === undefined ? {} : { previousAttempt },
                        ...previousAttemptId === undefined ? {} : { previousAttemptId },
                        subject: task.subject,
                        description: task.description,
                        teamDescription: fresh.description,
                        ...protocol === undefined ? {} : { profileProtocol: protocol },
                        ...profileSeedId === undefined ? {} : { profileSeedId },
                        ...fresh.profile?.executionPrompt === undefined && config.executionPrompt === undefined
                            ? {}
                            : { executionPrompt: fresh.profile?.executionPrompt ?? config.executionPrompt },
                        kind: task.kind ?? 'work',
                        ...task.round === undefined ? {} : { round: task.round },
                        ...task.objective === undefined ? {} : { objective: task.objective },
                        ...task.inScope === undefined ? {} : { inScope: task.inScope },
                        ...task.outOfScope === undefined ? {} : { outOfScope: task.outOfScope },
                        ...task.acceptance === undefined ? {} : { acceptance: task.acceptance },
                        ...task.verify === undefined ? {} : { verify: task.verify },
                        ...task.reviewedTaskId === undefined ? {} : { reviewedTaskId: task.reviewedTaskId },
                        dependencyOutputs: collectCompletedDependencyOutputs(fresh.tasks, task.id, (message) => ctx.logger.warn(message)),
                        /**
                         * ★ 每一条**直接**依赖落在哪一态（见 {@link DispatchTicket.dependencyOutcomes}）。
                         *   ★ 在票里算，与 `dependencyOutputs` 同源、同一刻 —— 两者之间不许隔着
                         *     一次 `await`（那会让两份读数看两个不同时刻的队状态）。
                         */
                        dependencyOutcomes: describeDependencyOutcomes(dependencyStatuses(fresh.tasks, task.dependencies)),
                        upstreamBaselines: collectUpstreamBaselines(fresh.tasks, task),
                    };
                });
                if (ticket === undefined)
                    return;
                /**
                 * ── ★ 建隔离工作目录（在锁外做：git 是 I/O，不该拖长持锁时间）─────────────
                 *
                 * 只给【会写文件的】任务建 —— review / requirements 这类只读任务不需要
                 * 自己的检出，给它们建只会浪费磁盘并让清理面变大。
                 *
                 * ★ 建失败【拒绝派发】（见下面的分支）：隔离是"这个成员能不能在正确的
                 *   地方干活"的前置条件，不是可选装饰。此前"warn 后继续"的写法把隔离
                 *   变成了提示 —— 成员在共享工作区干活，而没有任何一步会拒绝它。
                 */
                /**
                 * ★★ 真值来自 `types.ts`（t20 建的单一来源），不在这里再写一份。
                 *
                 * 此前这一行与 `resolveBaseRevision` 各写一份同样的 kind 判断 ——
                 * 而两份实现会分叉：判据说"本该有基准"、而调度器从没建过那棵树，
                 * 在日志里读起来像"记录丢了"。⇒ 现在两边都从 `needsWorktreeFor` 取。
                 *
                 * ★ MEASURED（本次并入实测）：t24 的 `src/scheduler.ts` 覆盖了那一行，
                 *   把它退回硬编码 —— 因为两个任务改同一个文件、而并入是整文件的。
                 *   ⇒ ★ "整文件覆盖"会让【另一处已经落地的修复】静默消失。
                 */
                const needsWorktree = needsWorktreeFor(ticket.kind);
                let worktreePath;
                let worktreeMissingIgnored;
                let worktreeUnavailable;
                let worktreeBaseline;
                if (needsWorktree) {
                    /**
                     * ★ `teamId` 必须传：任务 id 按团队重新计数（每个团队的 t1 都叫 t1），
                     *   而只用 `task-<id>` 会让新团队命中上一轮的树 —— 实测过，
                     *   见 `worktreeDirName` 上面那段。
                     *
                     * ── ★★★ t5：基线由【上游产物】定，不再是主树 HEAD ────────────────────
                     *
                     * `ticket.upstreamBaselines` 是这条任务的直接上游。`resolveWorktreeBaseline`
                     * 会挑其中最早那个可解析的产物 commit 当起点；没有可用产物时**退回**
                     * 主树 HEAD（那是"上游没提交"的正确行为，不是降级）。
                     *
                     * ★ 空数组（这条任务没有依赖边）⇒ 基线仍是主树 HEAD，而这是**对的** ——
                     *   并行任务之间本就没有可见性关系。两种情形在 `baseline.source` 上
                     *   给出同一个 `'trunk'`，但在 `baseline.upstream` 上不同形
                     *   （`[]` vs `[{kind:'not-committed'}]`），且 `describeBaseline` 的措辞
                     *   把"没有上游依赖"与"有上游而它没提交"写成两句不同的话。
                     */
                    const created = createTaskWorktree({
                        repo: workspace,
                        taskId: ticket.taskId,
                        teamId: team.id,
                        upstream: ticket.upstreamBaselines,
                    });
                    if (created.ok !== true && created.unsupported === true) {
                        /**
                         * ── ★ 这个仓库【没有】隔离能力 ⇒ 降级派发，但留下痕迹 ──────────────
                         *
                         * MEASURED（2026-10-05）：此前这里对**所有**建不出来的情形都拒绝派发。
                         * 而非 git 仓库不是"这次没成"，是"这里根本没有"：拒绝 ⇒ 任务回
                         * pending、成员回 idle ⇒ `agent/status` 的 idle 边再踢一次 ⇒ 再拒绝
                         * ⇒ **无限循环，任务永久卡死**（实测：非 git 项目里每一个
                         * implementation/repair 任务都卡死，而只有一条 warn 说原因）。
                         *
                         * ★ 为什么降级是对的（而不是"再放宽一点"）：隔离是**能力**，
                         *   不是**裁决**。没有能力时，该做的是【如实说没有】并让成员干活，
                         *   而"没有隔离"这件事必须留下痕迹 —— 于是依赖父版本的判据
                         *   （R5 / 变异 / 回测的基准）拿到的是"我测不了"，不是"通过了"。
                         *   这正是"没测到不得并进通过"在调度层的同一条纪律。
                         *
                         * ★ 与下面 `failed` 分支的区别是本质的：那里是 git 仓库却建不出来，
                         *   属于环境坏了，**重试是合理的**；这里重试一万次也还是同一个环境。
                         *   一个"重试也不会有不同结果"的守卫，只会把任务卡死。
                         */
                        worktreeUnavailable = created.reason;
                        ctx.logger.warn(`agent-teams: task "${ticket.taskId}" has no isolated worktree (${created.reason}); dispatching into the shared workspace and recording the task as un-isolated`);
                    }
                    else if (created.ok !== true) {
                        /**
                         * ── ★ 机制化：本该能隔离却建不出来 ⇒ 拒绝派发 ────────────────────────
                         *
                         * 此前这里是 `logger.warn(...)` 之后【继续派发】。而"继续"的实际含义是
                         * 成员在【共享工作区】里干活 —— 于是隔离从机制退化成提示：
                         *
                         *   ① 隔离目录从未被真正使用，`dispatch.worktree` 到达判据也拿不到
                         *      任何可核对的东西（一次 warn 不是一条记录）；
                         *   ② 依赖父版本的判据（R5 / 变异）在这条路径上永远只能 unmeasured；
                         *   ③ 而"工作落到了主树"这件事【没有任何入口会拒绝】。
                         *
                         * ⇒ 现在:是 git 仓库却建不出来 ⇒ 该成员这一步【不派发】，工作回到
                         *   共享任务池。没有 fallback。理由与"判据不得把未测量并进通过"同源：
                         *   一个能被绕过的守卫等于没有守卫，而它还会让人以为有。
                         *
                         * ★ 回滚用与派发失败【同一条】路径 —— 那条路径已经处理了所有困难情形
                         *   （恢复中的 attempt、被队长接管的 capability、并发交接）。这里再写
                         *   一份"只把任务置回 pending"的轻量回滚，就会造出第二个语义不同的
                         *   回滚，而两者在日志里看不出区别。
                         */
                        ctx.logger.warn(`agent-teams: refusing to dispatch task "${ticket.taskId}" to "${ticket.memberName}": no isolated worktree (${created.reason})`);
                        /**
                         * ── ★★★ t43：这一处也【必须留痕】（2026-10-10 实测补的）──────────────
                         *
                         * MEASURED：t40 被 reassign 之后，`attempt` 推进 · `handoff` 被清 ·
                         *   ★ 而 `deliveryFailure` **没有写** —— 因为【拒绝发生在投递之前】，
                         *   走到了这一格，而不是回滚那一格。
                         *   ⇒ ★ 于是"worktree 建不出来 ⇒ 拒绝派发"与"从来没派过"
                         *     在 `team.json` 上【完全同形】—— 与那条 warn 的处境一模一样。
                         *
                         * ★★ 而这一格比投递失败那一格【更值得留痕】：
                         *   它是一个【结构性的拒绝】（隔离退化成提示是它要防的事），
                         *   而"我不知道为什么这个成员一直不干活"正是它造成的。
                         */
                        await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                            const fresh0 = await readTeam(stateRoot, team.id);
                            const t0 = fresh0?.tasks.find(candidate => candidate.id === ticket.taskId);
                            if (t0 !== undefined) {
                                t0.deliveryFailure = { at: Date.now(), attempt: ticket.attempt, reason: `no isolated worktree: ${created.reason}` };
                            }
                            if (fresh0 !== undefined)
                                await writeTeam(stateRoot, fresh0);
                        });
                        await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                            const fresh = await readTeam(stateRoot, team.id);
                            if (fresh === undefined)
                                return;
                            const task = fresh.tasks.find(candidate => candidate.id === ticket.taskId);
                            if (task?.attemptId !== ticket.attemptId)
                                return;
                            if (ticket.recoveredOwned && ticket.previousStatus !== undefined && ticket.previousAttemptId !== undefined) {
                                task.status = ticket.previousStatus;
                                task.assignee = ticket.previousAssignee;
                                task.attempt = ticket.previousAttempt;
                                task.attemptId = ticket.previousAttemptId;
                                Object.assign(task, ticket.previousResult);
                                parkedAttempts.set(ticket.memberId, ticket.previousAttemptId);
                            }
                            else {
                                task.status = 'pending';
                                task.assignee = ticket.previousAssignee;
                                task.attemptId = undefined;
                                parkedAttempts.delete(ticket.memberId);
                            }
                            task.handoffId = undefined;
                            task.reassigning = false;
                            task.updatedAt = Date.now();
                            const currentMember = fresh.members.find(candidate => candidate.name === ticket.memberName);
                            if (currentMember !== undefined && currentMember.status !== 'removed')
                                currentMember.status = 'idle';
                            await writeTeam(stateRoot, fresh);
                        });
                        return;
                    }
                    else {
                        worktreePath = created.path;
                        worktreeMissingIgnored = created.missingIgnored;
                        worktreeBaseline = created.baseline;
                        /**
                         * ── ★★★ t5：基线的三态**必须读得出来**（这一行就是那条验收）───────────
                         *
                         * `docs/WORKTREE-BASE-DEFECT.md` 的第二个形态：基线此前是一个**位置**
                         * （永远是主树 HEAD），没有任何读数能回答"这棵树里看得见上游吗"。
                         *
                         * ⇒ 现在每一次建树都留一句，而 `describeBaseline` 把三态写成**三句
                         *   不同的话**：
                         *
                         *     · 上游已提交   ⇒ `baseline is upstream deliverable t3@abc1234`
                         *     · 上游没提交   ⇒ `... (N upstream task(s), none of them has a
                         *                       readable deliverable commit)` 或 `not committed: t3`
                         *     · 上游读不到   ⇒ `unreadable: t3 (its deliverable commit "abc"
                         *                       does not resolve in <repo> (...))`
                         *     · 没有依赖边   ⇒ `... (this task has no upstream dependency)`
                         *
                         * ★ 用 `info` 而不是 `warn`：前两种是**正常**结果。把"上游没提交"
                         *   报成 warn 会让每一次正常派发都留一条噪音，而噪音会让人开始忽略
                         *   warn —— 那时第三条（真的读不到）也一起被忽略。
                         */
                        ctx.logger.info(`agent-teams: task "${ticket.taskId}" worktree baseline — ${describeBaseline(created.baseline)}`);
                        /**
                         * ★ 把这个任务的【隔离基准】交回调用方。
                         *
                         * `base` 是 R5（红前绿后）与回测（baseline）唯一的父版本来源，而它只
                         * 在这里可得（`createTaskWorktree` 的产物）。判据层在成员汇报完成时
                         * 需要它，那时派发早已结束 ⇒ 必须在这里交出去。
                         *
                         * ★ 只有真的建出 worktree 才回调：没有隔离就没有父版本，判据应当
                         *   说"我没能测量"，而不是拿一个猜出来的版本去比较。
                         *
                         * ★ t18 补：第三个参数 `stateRoot` —— 调用方要把这个 `base` 落进
                         *   **耐久态**（`team.json` 的 `baseRevision`），那就必须知道团队住在哪。
                         *   而这正是调度器手上已经有、调用方**推不出来**的那一格
                         *   （`stateRootOf(workspace, config)`，本函数体第一行）。
                         *   ⇒ 交出去，而不是让调用方拿 `process.cwd()` / `pluginRoot()` 去猜。
                         */
                        config.onWorktree?.(ticket.taskId, created.base, stateRoot);
                        /**
                         * ── ★★★ t24：依赖按需注入的【生产调用方】────────────────────────────
                         *
                         * MEASURED（t24 之前）：`provisionWorktreeDependencies` 全仓**只有夹具在调**
                         * ⇒ 每个 worktree 各自 `pnpm install` ⇒ 装什么、装成什么样**各不相同**
                         * ⇒ 「两个成员各自验证」这个前提**不成立**；而磁盘是 579M × N
                         * （所以并发上限被磁盘卡住，而不是被成员数卡住）。这正是本队记账最久的
                         * 形态：**机制建好了，中间那一格没接上。**
                         *
                         * ★ 时机**必须**在建树之后、派发之前：
                         *   · 建树之前 ⇒ 没有 worktree 可写（而且 `missingIgnored` 还不存在）
                         *   · 派发之后 ⇒ 成员已经可能开始跑命令了 —— 那正是"环境没准备好"被
                         *     误报成"工作没做出来"的那条路
                         *   ⇒ 所以它紧跟在 `onWorktree` 之后、`assignmentPrompt` 之前。
                         *
                         * ★★ 而 entries **不是** `missingIgnored` 原样 —— 见 `planDependencyInjection`
                         *   上面那段：那份是【候选】，不是【该注入的清单】。
                         */
                        const plan = planDependencyInjection(created.missingIgnored);
                        if (plan.injected.length > 0) {
                            const provisioned = provisionWorktreeDependencies({
                                repo: workspace,
                                worktree: created.path,
                                entries: plan.injected,
                            });
                            /**
                             * ★ 读数三态（与判据层同一条纪律）：**注入成功 / 没注成 / 没需要注**
                             *   必须说得出是哪一种。而"没注成"要指名是哪一件 + 为什么。
                             */
                            if (provisioned.failed.length > 0) {
                                ctx.logger.warn(`agent-teams: task "${ticket.taskId}" could not prepare ${provisioned.failed.length} `
                                    + `dependencies in its isolated worktree: `
                                    + provisioned.failed.map(entry => `${entry.entry} (${entry.reason})`).join('; '));
                            }
                            for (const excluded of plan.excluded) {
                                ctx.logger.warn(`agent-teams: task "${ticket.taskId}" did NOT inject "${excluded.entry}" `
                                    + `into its isolated worktree: ${excluded.reason}`);
                            }
                        }
                        else if (plan.excluded.length > 0) {
                            /** ★ 一件都不注 ⇒ 【也要留读数】（"没复制" ≠ "没发生什么"）。 */
                            for (const excluded of plan.excluded) {
                                ctx.logger.warn(`agent-teams: task "${ticket.taskId}" did NOT inject "${excluded.entry}" `
                                    + `into its isolated worktree: ${excluded.reason}`);
                            }
                        }
                    }
                }
                const dispatched = {
                    ...ticket,
                    ...worktreePath === undefined ? {} : { worktreePath },
                    ...worktreeMissingIgnored === undefined || worktreeMissingIgnored.length === 0
                        ? {}
                        : { worktreeMissingIgnored },
                    ...worktreeUnavailable === undefined ? {} : { worktreeUnavailable },
                    ...worktreeBaseline === undefined ? {} : { worktreeBaseline },
                };
                const prompt = assignmentPrompt(dispatched, config.stateDir, team.id);
                /**
                 * ★★★ 同一个死重 pattern（见上面邮箱投递那一处的长注释）：这一行原来也是
                 *   `new AbortController().signal`，而全文件的 `.abort()` 出现 0 次 ⇒
                 *   一个**永远不会触发**的 signal。这里的后果同形 —— 派发也在
                 *   `serializeMember` 的链式队列里，一次不返回就把该成员的后续写入全部钉死。
                 *   ⇒ 给一个真实上限；超时走**已有的**失败分支（带成因），消息留在邮箱。
                 */
                const controller = new AbortController();
                const signal = controller.signal;
                const timer = setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS);
                let delivered;
                try {
                    /**
                     * ★★★ t43：把投递结果【带成因】地取回来 —— 见下面的失败分支。
                     *   ★ 旧写法 `accepted = await deliverToMember(…)` 丢掉成因，
                     *     而 `if (accepted) {…}` 之外【什么都不记】⇒ 静默回滚。
                     */
                    delivered = config.dispatch === undefined
                        ? await deliverToMemberDetailed(ctx, captain, ticket.memberId, prompt, signal)
                        : await (async () => {
                            const ok = await config.dispatch(captain, team.id, ticket.memberName, prompt, signal, 'queue', ticket.attemptId);
                            return ok ? { ok: true } : { ok: false, reason: 'the configured dispatch hook returned false' };
                        })();
                }
                finally {
                    clearTimeout(timer);
                }
                const accepted = delivered.ok;
                if (accepted) {
                    /**
                     * ★ runtime 位置的接线（t6）：投递【被接受之后】才记录这次派发。
                     *   只记录、不拒流程（契约 §5）—— 回调的返回值被有意忽略，因为一个
                     *   过程约束不该、也不能改变派发结果。失败路径不记录（见下面的回滚）。
                     *
                     * ★ `dispatchedAt`（t5）取在**投递已被接受之后**，所以它是"成员真的要
                     *   开始干活"的时刻，而不是"我们打算派发"的时刻 —— 投递本身可能很慢
                     *   （起一个子代理、等 provider），把等待起点记在投递之前，会让探活
                     *   把一个**还没开工**的成员读成"已经等了很久没产出"。
                     */
                    config.onDispatched?.({
                        teamId: team.id,
                        taskId: dispatched.taskId,
                        memberName: dispatched.memberName,
                        memberId: dispatched.memberId,
                        attempt: dispatched.attempt,
                        attemptId: dispatched.attemptId,
                        kind: dispatched.kind,
                        dispatchedAt: clock(),
                        continued: dispatched.recoveredOwned,
                        ...worktreePath === undefined ? {} : { worktreePath },
                        ...worktreeUnavailable === undefined ? {} : { worktreeUnavailable },
                    });
                    return;
                }
                // Roll back only our exact failed dispatch. A concurrent captain
                // handoff has already changed the capability and wins.
                await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
                    const fresh = await readTeam(stateRoot, team.id);
                    if (fresh === undefined)
                        return;
                    const task = fresh.tasks.find(candidate => candidate.id === ticket.taskId);
                    if (task?.attemptId !== ticket.attemptId)
                        return;
                    if (ticket.recoveredOwned && ticket.previousStatus !== undefined && ticket.previousAttemptId !== undefined) {
                        // Recovery delivery failed. Restore the durable generation instead
                        // of returning it to pending, then keep it parked so later status
                        // kicks cannot spend an unbounded sequence of fresh attempts.
                        task.status = ticket.previousStatus;
                        task.assignee = ticket.previousAssignee;
                        task.attempt = ticket.previousAttempt;
                        task.attemptId = ticket.previousAttemptId;
                        Object.assign(task, ticket.previousResult);
                        parkedAttempts.set(ticket.memberId, ticket.previousAttemptId);
                    }
                    else {
                        task.status = 'pending';
                        task.assignee = ticket.previousAssignee;
                        task.attemptId = undefined;
                        parkedAttempts.delete(ticket.memberId);
                    }
                    /**
                     * ★★★ t43：把【投递失败】写进记录 —— 而它是本格存在的全部理由。
                     *
                     * ★ 它必须落在这里（回滚处），因为那是【唯一知道"这次派发试过而没有送达"】的位置。
                     * ★ 而它带 `attempt`：一条旧的失败原因与"这次又失败了"必须不同形。
                     * ★ 而它在成功派发时【不被清】—— 见下面 `onDispatched` 那一支（那里会删它）。
                     */
                    if (!delivered.ok) {
                        task.deliveryFailure = { at: Date.now(), attempt: ticket.attempt, reason: delivered.reason };
                    }
                    task.handoffId = undefined;
                    task.reassigning = false;
                    task.updatedAt = Date.now();
                    const currentMember = fresh.members.find(candidate => candidate.name === ticket.memberName);
                    if (currentMember !== undefined && currentMember.status !== 'removed')
                        currentMember.status = 'idle';
                    await writeTeam(stateRoot, fresh);
                });
            });
        },
    };
    const syncMemberStatus = async (agent, status) => {
        const workspace = agent.session.header.cwd ?? process.cwd();
        const stateRoot = stateRootOf(workspace, config);
        const located = await findTeamByParticipant(stateRoot, agent.id);
        if (located === undefined) {
            parkedAttempts.delete(agent.id);
            return;
        }
        /**
         * ── ★★★ #176（乙）：队长那一半走活的 fork 链（t98）───────────────────────────
         * ★ 传 `liveRefsOf(ctx)` ⇒ 一个**队长 fork 出来的**会话也认得出自己带的队。
         *   ★ 缺席/枚举不可用 ⇒ 退回精确相等（与今天同结论）。
         */
        if (sessionLeadsTeam(agent.id, identityOfTeam(located), liveRefsOf(ctx))) {
            // Captain takeover is scoped to the captain's current turn. Unlike a
            // durable member, the captain has no scheduler lane that can resume an
            // abandoned attempt later. Returning unfinished captain-owned work to
            // the shared pool on the idle edge prevents it from becoming a
            // permanently parked `claimed` task after the captain answers, is
            // interrupted, or the user switches conversations.
            if (status === 'running')
                return;
            let requeued = false;
            await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
                const fresh = await readTeam(stateRoot, located.id);
                if (fresh === undefined || fresh.captainSessionId !== agent.id)
                    return;
                for (const task of fresh.tasks) {
                    if (task.assignee !== CAPTAIN_KEY
                        || task.status === 'completed'
                        || task.status === 'failed'
                        || task.status === 'cancelled')
                        continue;
                    invalidateTaskAttempt(task);
                    task.reassigning = false;
                    requeued = true;
                }
                if (requeued)
                    await writeTeam(stateRoot, fresh);
            });
            if (requeued)
                await runtime.kickTeam(workspace, located.id, agent);
            return;
        }
        const member = located.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed');
        if (member === undefined) {
            parkedAttempts.delete(agent.id);
            return;
        }
        await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
            const fresh = await readTeam(stateRoot, located.id);
            const current = fresh?.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed');
            if (fresh === undefined || current === undefined)
                return;
            const next = status === 'running' ? 'working' : 'idle';
            if (next === 'idle') {
                const owned = ownedOpenTask(fresh.tasks, current.name);
                if (owned?.attemptId === undefined)
                    parkedAttempts.delete(agent.id);
                else
                    parkedAttempts.set(agent.id, owned.attemptId);
            }
            else {
                parkedAttempts.delete(agent.id);
            }
            if (current.status === next)
                return;
            current.status = next;
            await writeTeam(stateRoot, fresh);
        });
        if (status === 'idle')
            await runtime.kickMember(workspace, located.id, member.name);
    };
    ctx.on('agent/status', ({ agent, status }) => {
        void syncMemberStatus(agent, status).catch((error) => {
            ctx.logger.warn(`agent-teams: member status scheduling failed for ${agent.id}: ${String(error)}`);
        });
    });
    return runtime;
}
