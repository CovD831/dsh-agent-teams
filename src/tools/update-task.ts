// ── src/tools/update-task.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent, captainSessionOf } from '../events.ts'
import { registry } from '../gates/index.ts'
import { gitChangedPaths, observedChangedPaths } from '../harness-compat.ts'
import { isCurrentMail, mailboxPrompt } from '../mailbox.ts'
import { appendTaskEvidence, repairCompletionVerdict } from '../quality-gates.ts'
import { TERMINAL_TASK_STATUSES } from '../types.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { auditGateRequires, changedLineNumbers, deriveCoverageInput, deriveScanDirs, diagnosticFields, evaluateRuntimeGates, inputSurfaceOf, memberOpenTask, mergeRerunIntoCommandsRun, observeMemberActivity, observeMemberConvergence, readWorkspaceFileSync, recordFriction, rejectOnContractGates, requireCaptain, requireCaptainTeam, requireFreshCaptainTeam, requireFreshParticipant, requireMember, requireParticipantTeam, requireTask, resolveBaseRevision, runInDetachedRevision, runVerifyCommand, runVerifyCommandCaptured, stateRootOf, teamLockKey, throwWithSurface, withInputSurfaceOnError, workspaceOf, writeWorkspaceFileSync, loadVerifyCommandRules, } from './shared/entities.ts'
import { ContractAmendmentInput } from '../quality-gates.ts'
import { CAPTAIN_KEY, amendTaskContract, appendMailbox, createMessage, evaluateQualityCompletion, markMailboxDelivered, normalizeBlankOptionalTaskFields, readMailbox, releaseMailboxDelivery, transitionError, withTeamLock, writeTeam } from '../state.ts'
import { steerCaptainReport } from '../tools.ts'
import { CommandResult, ReviewVerdict } from '../types.ts'
import { AgentTeamsRuntime, applyQualityFollowUp, parseAcceptanceResults, parseCommandResults, parseFindings } from './shared/entities.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolsConfig } from './shared/entities.ts'

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, clock: any, runtime: AgentTeamsRuntime, scheduler: any, config: ToolsConfig): void {
    ctx.tools.register(withInputSurfaceOnError(defineTool({
      name: 'agent_teams_update_task',
      description: 'Update a task status/output. Members must supply the current attempt_id returned by claim_task; stale attempts are rejected after takeover/reassignment. Terminal results are immutable, but owners and the captain can append acceptanceResults/commandsRun/evidence_note as attributed supplemental evidence, without reclaiming or changing the verdict. A captain must use reassign_task(assignee="captain") before updating active member-owned work.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'The task id to update.' },
        attempt_id: { type: 'string', description: 'Members must explicitly include the current attempt_id from their assignment/claim in EVERY update, including failed reviews with findings. If omitted, retry with the same current id; omission does not revoke the attempt.' },
        status: {
          type: 'string',
          enum: ['in_progress', 'completed', 'failed', 'cancelled'],
          description: 'New status (in_progress, completed, failed, cancelled).',
        },
        output: { type: 'string', description: 'Original result summary; immutable after completion/failure.' },
        evidence_note: { type: 'string', description: 'Append-only supplementary observation on a terminal task. Does not reopen work or change the original result.' },
        verdict: {
          type: 'string',
          enum: ['pass', 'needs_revision', 'reject'],
          description: 'Required for completing requirements/review. needs_revision and reject must fail the task.',
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              severity: { type: 'string', enum: ['low', 'medium', 'high', 'blocker'], required: true },
              problem: { type: 'string', required: true },
              requiredFix: { type: 'string', required: true },
              file: { type: 'string' },
              line: { type: 'number' },
              resolved: { type: 'boolean' },
            },
          },
          description: 'Structured review findings. Required when verdict is needs_revision or reject; each item needs id, severity, problem, and requiredFix.',
        },
        changedPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Workspace-relative POSIX paths changed by this implementation/repair.',
        },
        acceptanceResults: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              criterion: { type: 'string', required: true },
              status: { type: 'string', enum: ['passed', 'failed'], required: true },
              evidence: { type: 'string' },
            },
          },
          description: 'Acceptance evidence in contract order: {criterion, status:"passed"|"failed", evidence?}. Supply one item per acceptance criterion.',
        },
        commandsRun: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              command: { type: 'string', required: true },
              status: { type: 'string', enum: ['passed', 'failed'], required: true },
              exitCode: { type: 'number' },
              evidence: { type: 'string' },
            },
          },
          description: 'Verification evidence in contract order: {command, status:"passed"|"failed", exitCode?, evidence?}. Supply one item per verify command.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            /**
             * ★★ t14：`update_task` 是**唯一**穿过两个位置的工具，所以它挂的是
             *   两格**位置名**（`dispatch_input_surface` / `completion_input_surface`）
             *   —— 那正是"哪一个位置缺哪一格"读得出来的依据（见
             *   `withInputSurfaceOnError` 的 `field` 参数）。
             *
             * ★ 它**不挂**泛用的 `input_surface`：成功路径上这个工具从不产出它
             *   （在 `execute` 的返回对象里可以逐个字段核）。⇒ schema 也不许声明它，
             *   否则"这个工具会返回这个字段"与"它从来不返回"在声明面同形 ——
             *   而那正是本任务要消灭的形状。拒绝路径上边界**会**补一个泛用名，
             *   但那次调用已经失败了，走的是 `error` 而不是工具结果值。
             */
            ...diagnosticFields({ runtimeGates: true, dispatchInputSurface: true, completionInputSurface: true }),
            task_id: { type: 'string', required: true },
            status: { type: 'string', required: true },
            output: { type: 'string' },
            attempt: { type: 'number', required: true },
            attempt_id: { type: 'string' },
            evidence_count: { type: 'number' },
            follow_up: { type: 'string' },
          },
        },
        render: (args, value) => [{
          type: 'text',
          text: `Task ${value.task_id} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}${value.evidence_count === undefined ? '' : `\nSupplemental evidence records: ${value.evidence_count}. Original result unchanged.`}${value.follow_up ? `\n${value.follow_up}` : ''}`,
        }],
      },
      async execute(args, exec) {
        const caller = requireCaptain(exec)
        const workspace = workspaceOf(caller)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireParticipantTeam(workspace, config, caller)
        let followUpMessage: import('../types.ts').TeamMessage | undefined
        const updated = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
          const task = requireTask(fresh, args.task_id)
          if (identity.kind === 'captain'
            && task.assignee !== undefined
            && task.assignee !== CAPTAIN_KEY
            && !TERMINAL_TASK_STATUSES.includes(task.status)
            && !(args.status === 'cancelled' && task.status === 'pending' && (task.attempt ?? 0) === 0 && task.reassigning !== true)) {
            throw new Error(`task ${task.id} is owned by member "${task.assignee}"; call agent_teams_reassign_task with assignee="captain" before takeover`)
          }
          if (identity.kind === 'member') {
            if (task.assignee !== identity.name) {
              throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`)
            }
            if (task.attemptId !== undefined && (args.attempt_id === undefined || args.attempt_id.trim() === '')) {
              throw new Error(`missing attempt_id for task ${task.id}. Retry this update with attempt_id="${task.attemptId}" from your current assignment. This is a missing parameter, not a revoked attempt; do not restart the work or request reassignment.`)
            }
            if (task.attemptId !== undefined && args.attempt_id !== task.attemptId) {
              throw new Error(`stale attempt for task ${task.id}: expected the current attempt_id; stop work and request fresh assignment`)
            }
          }
          if (TERMINAL_TASK_STATUSES.includes(task.status)) {
            const appended = appendTaskEvidence(task, {
              ...args, findings: parseFindings(args.findings), changedPaths: normalizeBlankOptionalTaskFields(args).changedPaths,
              acceptanceResults: parseAcceptanceResults(args.acceptanceResults), commandsRun: parseCommandResults(args.commandsRun),
            }, identity.name)
            if (appended) await writeTeam(stateRoot, fresh)
            return {
              evidence_count: task.supplementalEvidence?.length ?? 0,
              task_id: task.id,
              status: task.status,
              attempt: task.attempt ?? 0,
              ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
              ...task.output !== undefined ? { output: task.output } : {},
            }
          }
          if (args.evidence_note?.trim()) throw new Error('evidence_note is for terminal tasks; record active work with output and structured evidence')
          // Blank optional list entries (e.g. changedPaths:[""]) must not be
          // persisted: hasValidQualityTaskFields rejects them on reload and
          // would brick the whole team state (issue #105 class).
          const input = normalizeBlankOptionalTaskFields(args)
          const findings = parseFindings(args.findings)
          const acceptanceResults = parseAcceptanceResults(args.acceptanceResults)
          const commandsRun = parseCommandResults(args.commandsRun)
          /**
           * ── ★ 判据层（可插拔）────────────────────────────────────────────────────
           *
           * 这一段此前【硬编码】了"重跑 verify"这一条判据。现在它只是
           * `registry.evaluate('completion', ...)` 的一次调用 —— 编排层不知道
           * 那个位置挂了哪些判据、也不知道它们的语义（契约 `docs/GATE-REGISTRY.md` §8）。
           *
           * ⇒ 换/加/删判据 = 改 `src/gates/index.mjs` 的清单一行，**不碰本文件**。
           *
           * 执行器在这里注入（本文件是这一层唯一做 I/O 的地方；判据本身是纯数据变换）。
           * 只在【非终态 → completed】时给出执行器：终态补证据（issue159）不是新的
           * 完成裁决。判据自己 `appliesTo` 也会跳过那种情形 —— 两处都表达同一条边界，
           * 是因为执行器缺席这条路径也必须能被审计。
           */
          /**
           * ── ★ 归属证据：这个成员【真的写过】哪些文件 ─────────────────────────────
           *
           * `dispatch.changed-paths` 需要"自报的 changedPaths 与真实写入是否对得上"。
           * 真相来自该成员自己的会话事件（dsh-tool-fs 挂在 tool/result 上的 meta.diffs），
           * 经 `observedChangedPaths(caller.session)` 折叠成一组路径。
           *
           * ★ 这正是 START-HERE §5③ 那个"共同障碍"的解法：git 只知道工作区脏了，
           *   而会话事件是逐成员的 ⇒ 不需要 worktree，也不需要改 cwd（§5②）。
           *
           * ★ 队长代报（caller 是队长）时拿不到成员会话 ⇒ 观察缺席 ⇒ 判据 unmeasured，
           *   而不是被当成通过。这是刻意的：没能观察就不能声称它诚实。
           */
          /**
           * ★ 输入面核对（t10）：**求值之前**，按每条判据声明的 `requires` 核对这份
           *   真实 ctx。★ 它是**旁路数据** —— 下面的拒绝逻辑一个字都不看它：
           *   核对报缺时流程照常走完（先软后硬，用户裁定）。见 {@link auditGateRequires}。
           *
           * ★ 这份 ctx 是【构造一次、用两次】的同一个对象（核对一次、求值一次）：
           *   写成两份字面量会让"核对的 ctx"与"求值的 ctx"在多一次改动之后分叉，
           *   而分叉之后核对结果会变成关于**另一份 ctx** 的结论 —— 它读起来完全正常。
           */
          const dispatchContext = {
            task,
            update: { changedPaths: input.changedPaths },
            observedChangedPaths: observedChangedPaths(caller.session),
            /**
             * ── ★★ 第二观察面（t17）─────────────────────────────────────────────────
             *
             * 会话事件只看得见**本 session** 的写入。而"写入发生在别的 session"
             * （captain 用 `cp` 并入、成员被 retire 后换人）与"零工作却自报改动"
             * 在 `observedChangedPaths === []` 时**同形** —— 于是一个诚实的申报
             * 被读成虚报，每一个被重派/并入的 attempt 都交不出终态。
             *
             * ⇒ 补一格"别处"的证据：工作区里到底脏没脏。改动**真的存在**这件事
             *   与"是谁写的"无关，而 git 知道。
             *
             * ★ 三态与前一格逐条对齐：读不到 git ⇒ `undefined` ⇒ 这一格**不参与判定**
             *   （判定退回原口径，**不是**放宽）。
             */
            gitChangedPaths: gitChangedPaths(workspace),
          }
          const dispatchInputSurface = inputSurfaceOf('dispatch', dispatchContext)
          const dispatchGates = await registry.evaluate('dispatch', dispatchContext)
          /**
           * ── ★ runtime 位置（跨步骤的过程约束，契约 §5）───────────────────────────
           *
           * 成员开始干活 + 改契约/建任务之后，把"这一步发生过"交给 runtime 判据。
           * ★ 它返回任何裁决都【不得阻止流程】—— 上面 dispatch 位置的拒绝逻辑在本
           *   调用点之后照常执行，本调用点对控制流零影响。理由见 `evaluateRuntimeGates`。
           */
          let runtimeGateRecord = await evaluateRuntimeGates(ctx, 'task-update', {
            team: fresh,
            task,
            update: { status: args.status, output: args.output, verdict: args.verdict as ReviewVerdict | undefined },
            updateGate: dispatchGates,
            wantsCompleted: args.status === 'completed',
          }, clock)
          if (dispatchGates.ok === false) {
            /**
             * ★★ t22：在卡点发生的此刻记账（含 ctx 快照 + 事件定位 + 机制状态）。
             *   与 contract 那处同一条纪律：**旁路、不改裁决、失败只写 warn**。
             */
            const frictionMessage = dispatchGates.unmeasured !== undefined
              ? `update_task rejected: the dispatch gate could not measure (${dispatchGates.unmeasured})`
              : `update_task rejected: ${dispatchGates.blockers.join('; ')}`
            void recordFriction({
              stateRoot,
              point: 'dispatch',
              message: frictionMessage,
              context: dispatchContext,
              mechanismState: { inputSurface: dispatchInputSurface, gates: dispatchGates },
              session: caller.session,
              taskId: task.id,
              teamId: team.id,
              tool: 'agent_teams_update_task',
              ...dispatchGates.unmeasured === undefined ? {} : { couldNotObserve: [String(dispatchGates.unmeasured)] },
            }).then((id) => {
              if (id === undefined) ctx.logger.warn(`agent-teams: could not record the friction at the dispatch gate (${frictionMessage})`)
            })
            if (dispatchGates.unmeasured !== undefined) {
              /**
               * ★ 未测量与"发现问题"不同形（§3.4）。措辞必须分开 —— 读日志的人要能
               *   看出"判据没能测量"，而不是"判据发现了问题"。
               */
              throwWithSurface(frictionMessage, dispatchInputSurface, 'dispatch_input_surface')
            }
            throwWithSurface(frictionMessage, dispatchInputSurface, 'dispatch_input_surface')
          }
          /**
           * ★ 输入面缺格 ⇒ **只说、不拒**（先软后硬）。它放在上面的拒绝逻辑【之后】，
           *   不是为了顺序好看：放在之前会让"核对报缺"看起来像拒绝的理由，
           *   而本机制的裁决权是零。措辞与判据的 `unmeasured` 不同形 ——
           *   那是"判据测不了"，这是"调用方没把这一格交出去"。
           *
           * ★★ t3：这条日志**保留**（给人看）；结构化出口本体在下面返回值的
           *   `input_surface` 里（`dispatchInputSurface`）。两条并存，缺一不可。
           */
          if (dispatchInputSurface !== undefined && dispatchInputSurface.incomplete > 0) {
            ctx.logger.warn(`agent-teams: update_task reached the dispatch gate with an unfinished input surface (recorded, not rejected): ${dispatchInputSurface.missing.join('; ')}`)
          }
          /**
           * ── ★ 注入面：让每条判据拿到它声明的输入（缺则缺席，不注入空值）─────────
           *
           * 每一项都只做【读】。拿不到 ⇒ 该字段不出现在 ctx 里 ⇒ 判据自己说
           * "我没能测量"。**绝不在这里替判据决定"那就算通过"。**
           */
          const changedFiles = input.changedPaths ?? task.changedPaths ?? []
          /**
           * ★ t18：这里与 `baseline` 用**同一个解析**（内存 → 落盘 → 明确没有）。
           *   理由：`parentRevision` 喂给 R5（红前绿后），它与回测问的是同一件事
           *   ——"改动之前的那个版本是什么"。两处若用不同来源，会出现
           *   「R5 说父版本是 A、回测说基线是 B」这种自相矛盾，而它在日志里同形。
           */
          const baseResolutionForLines = resolveBaseRevision(task)
          const worktreeBase = baseResolutionForLines.kind === 'resolved' ? baseResolutionForLines.revision : undefined
          const [changedLines, observedFiles] = await Promise.all([
            changedLineNumbers(workspace, worktreeBase),
            Promise.resolve(observedChangedPaths(caller.session)),
          ])
          /**
           * `newTestFiles`：本任务【新增】的测试文件。
           *
           * 来源是会话事件里观察到的写入（与 dispatch.changed-paths 同一入口），
           * 取那些"在声明范围内、且看起来是测试"的路径。
           * ★ 观察不到（`undefined`）⇒ 不注入 ⇒ r5 的 appliesTo 为假 ⇒ skipped。
           *   这与"观察到了、确实没有新测试"（`[]`）不同形 —— 后者仍是 skipped
           *   （没有测试就没有红前绿后可测），但成因不同，判据自己会表达。
           */
          /**
           * `newTestFiles`：本任务【新增】的测试文件。
           *
           * 来源是会话事件里观察到的写入（与 dispatch.changed-paths 同一入口），
           * 取那些看起来是测试的路径。
           *
           * ★ 只在【这一次确实试图置为 completed】时注入 —— 这是刻意的调用方纪律，
           *   与 `execVerifyCommand` 的既有先例一致（那条也只在"非终态 → completed"
           *   时给出执行器）。
           *
           * 由来（MEASURED，2026-10-05，t7）：`completion.r5` 的 `appliesTo` 只问
           * `kind ∈ {implementation, repair}` 与 `newTestFiles` 是否为数组，**不看
           * 完成意图** —— 而它的三条兄弟判据（verify-rerun / mutation / backtest）
           * 都带 `wantsCompleted === true` 守卫。实测：
           *
           *     r5.appliesTo({ kind:'implementation', newTestFiles:[…], wantsCompleted:false }) ⇒ true
           *
           * 于是"成员开始干活"（in_progress）那一步也会被"红前绿后"审判，而那时
           * 父版本/扫描范围都还没有 ⇒ 一条【开始工作】的更新被 rejected。
           * 这个缺陷此前被"newTestFiles 永不注入"掩盖着（r5 恒 skipped），注入面一补齐
           * 就露出来。⇒ 在这里收口：不把"有没有新测试"这件事在非完成更新里提出去，
           * 于是 r5 在那些更新上按自己的契约 skipped，与三条兄弟判据行为一致。
           *
           * ★ 观察不到写入（`undefined`）⇒ 不注入（不是注入 `[]`）—— 缺席意味着
           *   "我没能观察"，而 `[]` 意味着"观察了、确实没有新测试"。两者不同形。
           */
          const isTestPath = (path: string): boolean =>
            /(^|\/)(test|tests|__tests__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
          /** 观察到的测试文件（杀变异体用）—— 与"本次新增"无关，既有的也算。 */
          const observedTestFiles = observedFiles === undefined ? undefined : observedFiles.filter(isTestPath)
          const newTestFiles = args.status !== 'completed' || observedTestFiles === undefined
            ? undefined
            : observedTestFiles
          /**
           * ── ★★ 判别力证据：把 t31 的修法接到真实路径（t33 / f-0020 的最后一格）─────
           *
           * ── 缺口是什么（integrator6 报，captain 核实）─────────────────────────────
           *
           * `repairEvidenceFiles` / `repairCompletionVerdict`（`quality-gates.ts`）
           * 修好了一件事：**repair 的判别力证据来自"改动过的既有夹具"，而不是"新增的测试"**
           * —— 对 repair 而言后者恒为空集，于是 r5 恒报
           * `none of the 0 reported file(s)` ⇒ **恒 unmeasured ⇒ repair 永远交不出终态**。
           *
           * ★ 但那两个函数**零调用方**（除它们自己的夹具外）。integrator6 的原话：
           *   「**一个没有调用方的修法，与没有修法在观测上完全相同。**」
           *   ⇒ 它把缺口如实写成臂 9，而不是用"夹具 10/10 绿"冒充已修好。
           *
           * ── 接线的口径（**不是**"让 r5 变宽松"）──────────────────────────────────
           *
           * 判据问的仍然是同一个问题：「**这条夹具还能不能抓住缺陷**」。
           * 变的只是**拿哪些文件去问**：
           *
           *     旧：本次【新增】的测试文件  ⇒ 对 repair 恒空 ⇒ 恒 unmeasured
           *     新：本次【改动过的既有夹具】⇒ repair 的真实证据 ⇒ 可测量
           *
           * ★ 而"装饰性测试"这一路**一步都没让**：一条恒绿的既有夹具同样过不了 r5
           *   （它在父版本上就绿 ⇒ `decorative test` 拒绝）。见夹具臂 3 与臂 4。
           *
           * ── 三态：与 `newTestFiles` 同一纪律 ──────────────────────────────────────
           *
           * ★ 只在【非终态 → completed】时给出（与 `execVerifyCommand` / `newTestFiles`
           *   的既有先例一致）—— 否则"成员开始干活"那一步也会被"红前绿后"审判。
           *
           * ★★ 但它**不**以"会话观察到了写入"为条件 —— 这一点是本任务的要害（t33 实测）：
           *
           *   `repairEvidenceFiles` 读的是**任务契约**（`update.changedPaths` /
           *   `task.changedPaths`），**不是**会话事件。⇒ 会话观察缺席时它照样答得出来，
           *   而那**正是** f-0020 的场景：repair 的净改动落在既有夹具上，
           *   而"这个成员写过它"这件事未必在会话事件里。
           *
           *   MEASURED（t33 第一版写错了）：我原先把它 guard 在
           *   `observedFiles === undefined` 上 ⇒ 与 `newTestFiles` **同一个条件**
           *   ⇒ 两者一起为空 ⇒ r5 仍报 "none of the 0 reported file(s)"
           *   ⇒ **接线等于没接**（定向突变实测：去掉接线后臂照样绿）。
           *   ★ 形态：把新口径挂到旧口径的闸门上，于是它继承了旧口径的盲区。
           */
          const repairEvidence = args.status !== 'completed'
            ? undefined
            : repairCompletionVerdict({
              task: { id: task.id, kind: task.kind, inScope: task.inScope, changedPaths: changedFiles },
              update: {
                changedPaths: input.changedPaths,
                ...observedTestFiles === undefined ? {} : { newTestFiles: observedTestFiles },
              },
            })
          /**
           * ★ 把两格**合并**成 r5 要的那一格，且合并规则是刻意的：
           *   · `newTestFiles` 是"本次观察到的测试写入"（既有口径，**保留**）；
           *   · `repairEvidence` 是"改动过的既有夹具里**还能判别**的那些"（新增口径）。
           *   ⇒ 取**并集**并排序。取交集会让任一侧单独成立的情形丢失；
           *     只取后者会让 implementation 类的既有行为改变（那不是本任务该动的）。
           *
           * ★ 而 `repairEvidenceFiles` **本身**已做筛选（是测试夹具、落在写域里、
           *   去重排序），所以这里不再筛第二遍 —— 两处筛选会慢慢分叉，而分叉之后
           *   "r5 看到的文件"与"quality-gates 认为的证据"不再同形。
           */
          const discriminatingFiles = repairEvidence === undefined || repairEvidence.ok === false
            ? newTestFiles
            : observedTestFiles === undefined
              ? repairEvidence.evidence
              : [...new Set([...observedTestFiles, ...repairEvidence.evidence])].sort()
          /**
           * ★ `repairEvidence.ok === false` 时**不把它并进拒绝**：它是 unmeasured
           *   （"没能测量"），而本调用点的裁决由 r5/mutation 自己说 ——
           *   在这里抢先拒绝会让"没测到"伪装成"发现了问题"（反向的同一类错误）。
           */
          if (repairEvidence !== undefined && repairEvidence.ok === false) {
            ctx.logger.warn(`agent-teams: repair completion evidence is unmeasured (recorded, not rejected): ${repairEvidence.unmeasured}`)
          }
          /**
           * 基准 = 【在父版本上跑一遍任务的 verify 命令】的退出码。
           *
           * 不注入（返回 undefined）的两种情形，都保持"没测到"：
           *   · 任务没有声明 verify ⇒ 没有可跑的东西（回测的 L1 前置要求基准先绿）；
           *   · 跑不起来（工作区不是 git 仓库、版本取不到…）⇒ 不能拿 0 充数。
           */
          const baselineExit = async (revision: string): Promise<number | undefined> => {
            const commands = task.verify ?? []
            if (commands.length === 0) return undefined
            /**
             * ★ 基准 = 在【父版本】上跑一遍本任务的 verify 命令。
             *
             * 有一个必须说清的前提：本任务【新增的测试】在父版本上本来就是红的
             * （否则 R5 会说它是装饰性测试）。所以把整套命令原样搬到父版本上跑，
             * 基准必然不绿 ⇒ 回测说"无法归因、这红不是这次改动的错" ——
             * **那是判据在正确地工作**，不是缺陷。
             *
             * ⇒ 基准要问的是另一个问题：「在这次改动【之前】，这套测试是绿的吗」。
             *   也就是把命令里【本次新增的测试文件】剔掉，跑【改动前就存在的那部分】。
             *   两者是不同的问句：
             *     R5      ：新测试在父版本上红吗？      （它在不在证明什么）
             *     回测 L1 ：改动之前这里本来就是绿的吗？（红了能不能归因）
             *   把它们混成一条命令，两条判据就会互相打架 —— 而"打架"的表现是
             *   一个**永远无法归因**的基准，读起来像基础设施坏了。
             *
             * ★ 剔掉的只有【本次新增的测试】（`newTestFiles`）—— 既有的测试一条不少，
             *   也不去猜"哪些测试相关"。
             */
            const added = new Set(newTestFiles ?? [])
            const withoutNewTests = commands
              .map((command) => command.split(/\s+/).filter((token) => !added.has(token)).join(' '))
              .map((command) => command.trim())
              .filter((command) => command !== '')
            if (withoutNewTests.length === 0) return undefined
            const results = await Promise.all(withoutNewTests.map(async (command) => (
              runInDetachedRevision({ workspace, revision, command })
            )))
            if (results.some((code) => code === undefined)) return undefined
            // 基准取【最坏的一条】：任何一条在父版本上不绿 ⇒ 基准就不是绿的，
            // 而"基准不绿"时回测的正确结论是"无法归因"（判据自己会说）。
            return Math.max(...(results as number[]))
          }
          /**
           * ★ 基准的【声称】与它的【证据】必须分清：
           *   · label 有了（父版本 hash 可追溯，供人工追溯）；
           *   · exitCode 必须来自【真的在父版本上跑过一次】—— 见下面的 `baselineExit`。
           *   拿不到就跑不出退出码 ⇒ 保持 `undefined`：判据会说"基准没有退出码，
           *   所以它区分不了『绿』与『没测』"。**绝不能**在这里填一个 0 充数 ——
           *   那正是把"没测到"伪装成"基准是绿的"。
           */
          /**
           * ── ★★ 父版本从哪来（t18）───────────────────────────────────────────────────
           *
           * 此前只有 `worktreeBase`（内存 Map）一个来源 ⇒ 无 worktree 的任务恒拿不到
           * ⇒ 回测恒 unmeasured ⇒ **这类任务永远无法收口**。
           *
           * ⇒ 现在走 {@link resolveBaseRevision} 的三段解析：内存 → 落盘 → 明确说"没有"。
           *   ★ 而"没有"的**两种成因各自可读**（`no-worktree` / `not-recorded`）——
           *     它们与"我跑了但基准不绿"是**三件不同的事**，读日志的人必须分得开。
           */
          const baseResolution = resolveBaseRevision(task)
          const baseline = baseResolution.kind === 'absent'
            ? undefined
            : { label: baseResolution.revision, exitCode: await baselineExit(baseResolution.revision) }
          /**
           * ★ 把"父版本是哪种情形"作为**结构化读数**交出去（与 `input_surface` 同一条
           *   纪律：读得出来才算数）。
           *   ★ 三态，互不同形：
           *     · `resolved`（来源可读：memory / record）⇒ 有父版本，比较有基础；
           *     · `absent.no-worktree`                 ⇒ 这类任务本就没有父版本；
           *     · `absent.not-recorded`                ⇒ 本该有而丢了（要去看一眼）。
           *   ★ 只在**缺席**时挂这个字段：有父版本时它没有信息量，而"总是出现"会让
           *     三态里最该被看见的那两种淹没在噪音里。
           */
          const baselineProvenance = baseResolution.kind === 'absent'
            ? { baseline_absent: baseResolution.reason }
            : {}
          /**
           * ★ 回测的依赖图 / 覆盖数据。与跑测试一样是 I/O，所以在这一层做；
           *   拿不到就【不注入】⇒ 判据说"没有依赖图数据"（不是"选了 0 条"）。
           */
          const coverageInput = await deriveCoverageInput({
            workspace,
            testFiles: observedTestFiles ?? [],
            knownTests: observedTestFiles ?? [],
          })
          const wantsCompleted = args.status === 'completed'
          /**
           * ── ★ 输入面：这是**最长的一份 ctx**，也是历史缺陷最集中的一格 ────────────
           *
           * 上一轮五次同形缺陷里，`inScope 缺席` / `verify 缺席` / `执行器缺席` 三次
           * 都落在本调用点上（本队实测记录）—— 判据照常跑、照常说"我没能测量"，
           * 而那在日志里与"这一步没问题"同形。
           *
           * ⇒ 核对必须在**求值之前**、对着**同一份** ctx：所以下面把 ctx 提成一个
           *   具名常量，核对与求值**共用它**。写两份字面量之后，任何一次只改一处的
           *   编辑都会让核对结果变成关于**另一份 ctx** 的结论 —— 而它读起来完全正常。
           */
          const completionContext = {
            task,
            update: {
              status: args.status,
              output: args.output,
              verdict: args.verdict as ReviewVerdict | undefined,
              findings,
              changedPaths: input.changedPaths,
              acceptanceResults,
              commandsRun,
              ...discriminatingFiles === undefined ? {} : { newTestFiles: discriminatingFiles },
            },
            wantsCompleted,
            taskNotTerminal: !TERMINAL_TASK_STATUSES.includes(task.status),
            execVerifyCommand: (command: string): Promise<number> => runVerifyCommand(workspace, command),
            /**
             * ── ★★★ t53：规则表**每次调用时读**（"改数据 ⇒ 立刻生效"的成立条件）──
             *
             * ★ 不缓存：缓存会让"改数据"在下一次**进程重启**前不生效 ——
             *   而那正是本任务要消灭的东西（改它读的东西不该需要换进程）。
             * ★ 也不在构建时内联（静态 import 会被 tsc 嵌进 lib/ ⇒ 改数据仍要 build）。
             */
            loadRules: () => loadVerifyCommandRules(workspace),
            // ── r5：父版本 + 扫描范围 + 在指定版本上跑一条测试的执行器
            ...worktreeBase === undefined ? {} : { parentRevision: worktreeBase },
            ...worktreeBase === undefined ? {} : { worktreePath: workspace },
            scanDirs: deriveScanDirs(changedFiles),
            /**
             * ★ 在【父版本 / 修复版本】上跑一条测试。
             *
             * 实现要点（每一条都是踩出来的）：
             *   · 成员的工作区通常是**脏的**（它刚改了文件）⇒ `git checkout` 会拒绝。
             *     所以用 `git worktree` 临时检出一个干净副本去跑，而不是在原地切换 ——
             *     原地切换既会因脏工作区失败，也可能把成员的改动弄丢。
             *   · 跑完必须把临时检出删掉（finally），否则每次完成都漏一个目录。
             *   · 拿不到整数退出码 ⇒ `exitCode: undefined` ⇒ 判据 unmeasured。
             *     **绝不**把跑不起来当成 0（"没测到"不得并进"通过"）。
             */
            runTestOnRevision: async (test: string, revision: string) => {
              /**
               * ★ `'working-tree'` 是 R5 约定的【修复版本】哨兵值 —— 表示"成员现在
               *   交出来的那份树"，而它**不是**一个 git 引用（`git worktree add`
               *   对它必然失败）。这是判据与调用方之间的一个约定，不是笔误。
               *   ⇒ 它跑在【工作区本身】上；只有父版本才需要检出到一个干净副本。
               */
              if (revision === 'working-tree') {
                return { exitCode: await runVerifyCommand(workspace, `node --test ${test}`) }
              }
              const exitCode = await runInDetachedRevision({
                workspace, revision, command: `node --test ${test}`,
              })
              return exitCode === undefined ? {} : { exitCode }
            },
            // ── mutation：三个执行器 + 只变异改动行
            readFile: (path: string): string => readWorkspaceFileSync(workspace, path),
            writeFile: (path: string, contents: string): void => writeWorkspaceFileSync(workspace, path, contents),
            /**
             * ★ 变异判据的 runTest 必须交回【输出】，不只是退出码：
             *   杀伤率 = 被杀的变异体 / 全部变异体，而"某次运行里有几条测试失败"只能从
             *   输出里读出来（判据用 parseTestSummary 解析 `ℹ pass N` / `# pass N`）。
             *   只给退出码 ⇒ 判据会说"套件没报告可读的摘要"⇒ unmeasured。
             */
            runTest: async (command: string) => await runVerifyCommandCaptured(workspace, command),
            ...changedLines === undefined ? {} : { changedLines },
            changedFiles,
            /**
             * ★ 杀手套件：变异判据【要求显式声明】，没有回退（见 mutation.ts 文件头
             *   —— 一个没被声明的套件会让"存活者"变成关于探针的事实，而不是关于测试
             *   的事实）。
             *
             * 这里声明的来源是【会话事件观察到的测试文件】—— 与 newTestFiles 同源，
             * 但语义不同、不能合并：
             *     newTestFiles  = 本次【新增】的测试（R5 拿它跑红前绿后）
             *     killerSuites  = 拿哪些测试去杀变异体（既有的测试也算）
             * 把后者写成前者，"这次没新增测试"就会变成"没有杀手套件"⇒ unmeasured。
             *
             * ★ 观察不到 ⇒ 不注入 ⇒ 判据 unmeasured。**不猜、不回退到全套。**
             */
            ...observedTestFiles === undefined || observedTestFiles.length === 0
              ? {}
              : { killerSuites: observedTestFiles.map((file) => ({ id: file, files: [file] })) },
            testCommand: 'node --test *',
            // ── backtest：基准 + 覆盖证据 + 两个执行器
            ...baseline === undefined ? {} : { baseline },
            ...coverageInput === undefined ? {} : { coverage: coverageInput },
            /**
             * ★ 回测的执行器收的是【一个标签】，不是一条 shell 命令：
             *   `'full'`（全量）与选测标签。它们的能力是"跑整套测试"，而**整套测试
             *   是哪些**由本层决定（判据不知道本仓库的测试怎么跑，那是调用方的知识）。
             *   ⇒ 直接把标签丢给 sh 会得到 127（command not found），而那会被读成
             *     "全量红了 ⇒ 这次改动弄坏了东西" —— 一次基础设施工况伪装成关于代码的结论。
             *
             * ★ 全量 = 任务声明的 verify 命令（那正是"本任务认为什么算全量"）。
             *   跑不起来 ⇒ 127（非零）⇒ 判据按"全量红"处理并拒绝。
             *   **不把跑不起来伪装成绿。**
             */
            execBacktestCommand: async (): Promise<number> => {
              const commands = task.verify ?? []
              if (commands.length === 0) return 127
              const codes = await Promise.all(commands.map((command) => runVerifyCommand(workspace, command)))
              return Math.max(...codes)
            },
            execSelectedCommand: async (): Promise<number> => {
              const commands = task.verify ?? []
              if (commands.length === 0) return 127
              const codes = await Promise.all(commands.map((command) => runVerifyCommand(workspace, command)))
              return Math.max(...codes)
            },
          }
          const completionInputSurface = inputSurfaceOf('completion', completionContext)
          const completionGates = await registry.evaluate('completion', completionContext)
          /**
           * ── ★ t13 的运行时出口：有判据、却一条都没跑 ────────────────────────────
           *
           * `evaluated === 0 && registered > 0` 意味着这一轮**没有任何判据真的检查过**
           * 这个完成动作，而 `ok` 仍为 true。**只告警、不拒绝** —— 拒绝会把"这个位置
           * 这一轮没有适用判据"（正常情形）变成流程卡死，那正是 t13 明确要求保住的边界。
           * 但它必须【可读】：否则一次静默全跳过只有 `ok: true` 留给读日志的人。
           */
          if (completionGates.evaluated === 0 && completionGates.registered > 0) {
            ctx.logger.warn(
              `agent-teams: update_task for task "${task.id}" reached completion with no gate evaluated (${completionGates.registered} registered, all skipped); this step was not checked`,
            )
          }
          /**
           * ★ 输入面缺格 ⇒ **只说、不拒**（先软后硬），放在拒绝逻辑**之前**是因为
           *   它与下面三个分支讲的不是同一件事，而"这次完成本来会被拒"与"这次完成
           *   的输入面没接完"必须都能读到 —— 只读到前者会让人以为是判据的结论。
           *   与 t13 那条（`evaluated === 0`）也**不同形**：那是"判据一条都没跑"，
           *   这是"判据跑了、而它要的某一格调用方没交"。
           *
           * ★★ t3：这条日志**保留**（给人看）；结构化出口本体在下面返回值的
           *   `input_surface` 里（`completionInputSurface`）。两条并存。
           */
          if (completionInputSurface !== undefined && completionInputSurface.incomplete > 0) {
            ctx.logger.warn(
              `agent-teams: update_task for task "${task.id}" reached completion with an unfinished input surface (recorded, not rejected): ${completionInputSurface.missing.join('; ')}`,
            )
          }
          if (completionGates.ok === false) {
            /**
             * ★★ t22：在卡点发生的此刻记账。★ 这一处尤其重要 —— 本轮被它拦住的
             *   次数最多（三道完工门），而事后补的材料恰恰读不出"当时缺的是哪一格"。
             */
            const frictionMessage = completionGates.unmeasured !== undefined
              ? `update_task rejected: the completion gate could not measure (${completionGates.unmeasured})`
              : `update_task rejected: ${completionGates.blockers.join('; ')}`
            void recordFriction({
              stateRoot,
              point: 'completion',
              message: frictionMessage,
              context: completionContext,
              mechanismState: { inputSurface: completionInputSurface, gates: completionGates },
              session: caller.session,
              taskId: task.id,
              teamId: team.id,
              tool: 'agent_teams_update_task',
              ...completionGates.unmeasured === undefined ? {} : { couldNotObserve: [String(completionGates.unmeasured)] },
            }).then((id) => {
              if (id === undefined) ctx.logger.warn(`agent-teams: could not record the friction at the completion gate (${frictionMessage})`)
            })
            if (completionGates.unmeasured !== undefined) {
              /**
               * ★ 未测量与"发现问题"不同形（§3.4）。措辞必须分开 —— 读日志的人要能
               *   看出"判据没能测量"，而不是"判据发现了问题"。
               */
              throwWithSurface(frictionMessage, completionInputSurface, 'completion_input_surface')
            }
            throwWithSurface(frictionMessage, completionInputSurface, 'completion_input_surface')
          }
          /**
           * 判据【通过时】交出的产出：把判据层亲眼看到的 exitCode 并回 commandsRun，
           * 让落盘的是它看到的那个，而不是成员自报的。
           */
          const producedReruns = (completionGates.outputs['completion.verify-rerun']?.reruns ?? []) as CommandResult[]
          const mergedCommandsRun = producedReruns.length > 0
            ? mergeRerunIntoCommandsRun(commandsRun ?? task.commandsRun, producedReruns)
            : commandsRun
          const gate = evaluateQualityCompletion(task, {
            status: args.status,
            output: args.output,
            verdict: args.verdict as ReviewVerdict | undefined,
            findings,
            changedPaths: input.changedPaths,
            acceptanceResults,
            commandsRun: mergedCommandsRun ?? commandsRun,
          })
          if (!gate.ok) throw new Error(gate.error ?? 'update_task rejected by quality gates')
          if (args.status !== undefined) {
            const transition = transitionError(task.status, args.status)
            if (transition !== undefined) throw new Error(transition)
            task.status = args.status
          }
          if (args.output !== undefined) task.output = args.output
          if (args.verdict !== undefined) task.verdict = args.verdict as ReviewVerdict
          if (findings !== undefined) task.findings = findings
          if (input.changedPaths !== undefined) task.changedPaths = input.changedPaths
          if (acceptanceResults !== undefined) task.acceptanceResults = acceptanceResults
          if (commandsRun !== undefined) task.commandsRun = commandsRun
          task.updatedAt = Date.now()
          const priorDependencies = new Map(fresh.tasks.map(item => [item.id, [...item.dependencies]]))
          const followUp = (task.status === 'failed' && (task.verdict === 'needs_revision' || task.verdict === 'reject'))
            ? applyQualityFollowUp(fresh, task)
            : undefined
          let followUpSummary: string | undefined
          if ((followUp?.created.length ?? 0) > 0) {
            const rewired = fresh.tasks.filter(item => priorDependencies.has(item.id) && JSON.stringify(priorDependencies.get(item.id)) !== JSON.stringify(item.dependencies))
            followUpSummary = `Automatic quality follow-up for ${task.id}: ${followUp!.created.map(item => `${item.id} (${item.kind}, owner=${item.assignee ?? 'unassigned'}, deps=${item.dependencies.join(',') || 'none'})`).join('; ')}.${rewired.length ? ` Updated dependencies: ${rewired.map(item => `${item.id} -> ${item.dependencies.join(',')}`).join('; ')}.` : ''} Use these tasks; do not create duplicate repair/review work.`
            followUpMessage = createMessage(CAPTAIN_KEY, CAPTAIN_KEY, followUpSummary)
          }
          if (followUp?.escalated === true) {
            await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, createMessage(
              CAPTAIN_KEY,
              CAPTAIN_KEY,
              `Quality-gate loop escalated after ${task.id} (${task.kind ?? 'review'} verdict=${task.verdict}). Automatic repair/review stopped.`,
            ))
          }
          await writeTeam(stateRoot, fresh)
          /**
           * ── ★★ 成员提交一次更新 ⇒ 顺手**读一遍它的会话日志**（这是第二个观察时刻）──
           *
           * ── 两个"看起来都行"、而只有一个是错的写法 ─────────────────────────────
           *
           * ✗ 错的：把**这次工具调用**当成一次产出（`args.output` 非空 ⇒ 记一次活动）。
           *   它错得很像对的（"产出当场就在手上，何必去翻日志"），而后果是**关掉判据**：
           *   一个卡死的成员，只要它的工具还在被调用（重试、心跳、空转），
           *   `lastActivityAt` 就会被反复刷新 ⇒ 两次探活读数一直在变 ⇒ **永远不报警**。
           *   而那正是探活存在的全部理由。用户已裁定活动的定义是
           *   「**以产出为准（有 `assistant/message` 才算在动；`status` 可能因别的原因
           *   抖动）**」—— 工具参数**不是** `assistant/message`。
           *
           * ✓ 对的：在这里**读一次该成员的会话日志**（`observeMemberActivity`），
           *   与 `observeMemberConvergence` 同源、与探活同一个判据面。**产物仍然是
           *   `assistant/message`**，所以它不会把"工具被调用"读成"在动"：一个只被
           *   反复调用工具、却一句话都没说的成员，指纹不变 ⇒ 什么都不记。
           *
           * ── 为什么需要这第二个时刻（只留派发 + 探活是不够的）─────────────────────
           *
           * 观察时刻越多，活动时刻越**接近真实**。只留两个的话，最坏情形是：
           *
           *     成员在 T1..T2 之间一直在产出，而队长直到 T3 才查一次状态
           *     ⇒ 判据在 T3 才第一次看见那些产出 ⇒ `lastActivityAt = T3`
           *
           * 这不是假报警（那一轮反而看不到"没动"），但它是**迟到的观察**：在 T1 与 T3
           * 之间的任何一次探活，都会把"它其实一直在动"读成"它没动"。而
           * `agent_teams_update_task` 是**成员每次交进展都会经过的那一步** ——
           * 用它当观察时刻，代价是一次已有的会话读，换来的是探测精度。
           *
           * ★ 它**不能替代**探活时刻：一个成员可能长时间只在写文件、跑命令，
           *   一条更新都不发 —— 那时只有 `agent_teams_status` 能观察到它。
           *   两个时刻都要，因为探活问的是"它还在动吗"，而"动"发生在任何时刻。
           */
          {
            const activeMember = fresh.members.find(candidate => candidate.name === task.assignee)
            if (identity.kind === 'member' && activeMember !== undefined && activeMember.id !== '') {
              observeMemberActivity(ctx, activeMember.id, task.attemptId, clock())
            }
          }
          /**
           * ── ★ runtime 位置：这一步【做完了】（契约 §5）───────────────────────────
           *
           * 上面的调用点看的是"意图"（`args.status`），这里看的是"结果"（落盘后的 task）。
           * 两者不同形不是重复：一条运行判据可能想问"这个成员是不是在一个已超时的会话里
           * 报了完成"—— 而在意图那一刻还看不出来。仍然：**任何裁决都不阻止流程** ——
           * 状态已经写下去了，本调用点做的事只有记录。
           */
          runtimeGateRecord = await evaluateRuntimeGates(ctx, 'task-update-settled', {
            team: fresh,
            task,
            update: { status: task.status, output: task.output, verdict: task.verdict },
            updateGate: completionGates,
            wantsCompleted,
          }, clock)
          if (followUpMessage !== undefined) await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, followUpMessage)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
            teamId: fresh.id,
            taskId: task.id,
            status: task.status,
            ...task.assignee !== undefined ? { assignee: task.assignee } : {},
            ...task.output !== undefined ? { output: task.output } : {},
            ...task.verdict === undefined ? {} : { verdict: task.verdict },
            ...task.round === undefined ? {} : { round: task.round },
          })
          for (const created of followUp?.created ?? []) {
            appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-created', {
              teamId: fresh.id,
              taskId: created.id,
              subject: created.subject,
              dependencies: created.dependencies,
              ...created.assignee === undefined ? {} : { assignee: created.assignee },
              ...created.kind === undefined ? {} : { kind: created.kind },
              ...created.round === undefined ? {} : { round: created.round },
            })
          }
          return {
            ...followUpSummary === undefined ? {} : { follow_up: followUpSummary },
            task_id: task.id,
            status: task.status,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            ...task.output !== undefined ? { output: task.output } : {},
            /**
             * ★ runtime 位置的裁决【随返回值一起交出去】。
             *
             * 缺席（这个事件类型没有挂 runtime 判据）⇒ 字段不出现。**不是** `ok` ——
             * 把"这里没有过程约束"读成"过程约束通过了"，正是三态要防的那种合流。
             */
            ...runtimeGateRecord === undefined ? {} : { runtime_gates: runtimeGateRecord },
            /**
             * ── ★★ t3：**同一次 `update_task`** 走的是**两个**位置 ────────────────────
             *
             * 这一行之前，这两个位置的核对结论只有一个 `logger.warn`（见上面那两处
             * 分支）。⇒ 一次 `update_task` 被拒或成功之后，"**这两个位置的输入面
             * 接没接全**"在返回值里读不到 —— 而它们恰恰是历史上的缺陷集中地
             * （`observedChangedPaths` / 三个执行器 / `parentRevision` 都缺过一次）。
             *
             * ★ 两处**各挂各的、不合并**：它们核对的是两份不同的 ctx（一个是
             *   `{task, update, observedChangedPaths}`，一个是那份最长的 completion ctx），
             *   合成一份会让"哪一个位置缺哪一格"重新变得读不出来 —— 那正是本任务
             *   要消灭的形状。字段名相同（都与 runtime 同形），但挂的位置区分得开。
             *
             * ★ 三态（两处各自独立）：
             *   · 都齐            ⇒ 字段在场，`incomplete: 0`
             *   · 有缺格          ⇒ 字段在场，`incomplete: N` + `missing` 名单
             *   · 这个位置没判据  ⇒ 字段不出现（**不是** `ok`）
             */
            ...dispatchInputSurface === undefined ? {} : { dispatch_input_surface: dispatchInputSurface },
            ...completionInputSurface === undefined ? {} : { completion_input_surface: completionInputSurface },
          }
        })
        if (followUpMessage !== undefined) {
          const captain = ctx.agents.get(team.captainSessionId as SessionId)
          if (captain !== undefined && steerCaptainReport(captain, CAPTAIN_KEY, followUpMessage.content, mailboxPrompt(team.id, CAPTAIN_KEY, [followUpMessage]))) {
            await withTeamLock(teamLockKey(stateRoot, team.id), () => markMailboxDelivered(stateRoot, team.id, CAPTAIN_KEY, [followUpMessage!.id]))
          }
        }
        await scheduler.kickTeam(workspace, team.id, team.captainSessionId === caller.id ? caller : undefined)
        return updated
      },
    })))
}
