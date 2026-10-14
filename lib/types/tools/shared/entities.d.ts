import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
/**
 * ★ t53：规则表的**校验器**从判据那边借来（它是纯函数，不读盘）。
 *   ★ 方向不会成环：`verify-command.ts` 只 import `registry.ts` / `requires.ts`，
 *     它不知道 tools 层存在。
 *   ★ 而校验与读盘分开是刻意的：读不到是**调用方**的事实（`absent`），
 *     形状坏是**数据本身**的事实（`malformed`）—— 两者不同形，由两个地方各自判。
 */
import { type RulesLoad } from '../../gates/contract/verify-command.ts';
import type { GatePoint } from '../../gates/index.ts';
import { installMemberSelectionRuntime } from '../../members.ts';
import type { AcceptanceResult, ReviewFinding } from '../../types.ts';
import type { CommandResult, TeamMember, TeamState, TeamTask, TaskStall } from '../../types.ts';
import type { StallObservation } from '../../types.ts';
import { CAPTAIN_KEY } from '../../state.ts';
export declare function withInputSurfaceOnError<T extends {
    execute: (...args: never[]) => unknown;
}>(tool: T): T;
export interface ToolsConfig {
    /** State directory name under the captain's workspace. */
    stateDir: string;
    /** Member subagent provider name. */
    memberProvider: string;
    /** Optional member model override. */
    memberModel?: string;
    /** Prompt injected into member personas and assignments. */
    executionPrompt?: string;
    /** Plugin fallback route. */
    fallback?: import('../../profiles.ts').TeamModelFallbackConfig;
    /** Member delegation depth cap. */
    memberMaxDepth?: number;
    /** Team size cap (members). */
    maxMembers: number;
    /** Named team profiles from the active DSH profile. */
    profiles: Record<string, import('../../profiles.ts').TeamProfileConfig>;
    /**
     * ── ★ 时钟（t5）：探活判据唯一的读数来源 ─────────────────────────────────────
     *
     * 契约 §2 性质 1 说判据是纯数据变换、**I/O 与时钟由调用方注入**。所以
     * `src/gates/runtime/liveness.ts` 里没有 `Date.now()`，它读的是 ctx 里的
     * `wait.now` —— 而那个值来自这里。
     *
     * ★ 缺省 `Date.now` 是**生产**的缺省，不是夹具的。夹具注入假时钟才能在不真等
     *   10 分钟的情况下构造"两次探活之间成员一点产出都没有"。
     *   **一个测不了超时的探活判据等于没有探活** —— 而不注入时钟就只剩真等这一条路。
     *
     * ★ 不注入 ⇒ 判据按自己的契约报 unmeasured（缺 `now`），**不是**退回系统时钟。
     *   偷偷退回 `Date.now` 会让"夹具以为自己在控制时间"与"判据读了真实时间"
     *   在日志里同形 —— 那种缺陷只在跨零点或长会话里出现。
     */
    now?: () => number;
}
export type StagedPlanMutation = {
    action: 'update_member';
    memberName: string;
    role?: string | null;
    provider: string;
    model: string;
    reasoningEffort?: string | null;
    executionPrompt?: string | null;
} | {
    action: 'update_task';
    taskId: string;
    subject: string;
    description?: string | null;
    assignee?: string | null;
    dependencies: string[];
} | {
    action: 'add_task';
    subject: string;
    description?: string | null;
    assignee?: string | null;
    dependencies: string[];
} | {
    action: 'remove_task';
    taskId: string;
} | {
    action: 'remove_member';
    memberName: string;
};
export interface AgentTeamsRuntime {
    isPendingMember(agent: Agent): boolean;
    updateStagedPlan(captain: Agent, teamId: string, mutation: StagedPlanMutation, signal?: AbortSignal): Promise<TeamState>;
    updateStagedPlanBatch(captain: Agent, teamId: string, mutations: readonly StagedPlanMutation[], signal?: AbortSignal): Promise<TeamState>;
    approveStagedTeam(captain: Agent, teamId: string, signal?: AbortSignal): Promise<{
        teamId: string;
        members: number;
        tasks: number;
    }>;
    continueStagedPlanning(captain: Agent, teamId: string): Promise<{
        teamId: string;
        alreadyWaiting: boolean;
    }>;
    discardStagedTeam(captain: Agent, teamId: string): Promise<{
        teamId: string;
    }>;
}
export declare function requireCaptain(exec: ToolRunContext): Agent;
export declare function workspaceOf(agent: Agent): string;
export declare const VERIFY_COMMAND_TIMEOUT_MS = 120000;
/**
 * ── ★★★ 规则表的**运行时**读取（t53）────────────────────────────────────────────
 *
 * ★ 为什么读盘这一件事必须在这里（而不是判据里）：
 *
 *   判据**不许 import 任何 I/O**（`scripts/verify-gates-integration.test.mjs` ④
 *   逐行检查 import 子句）⇒ 它只能拿到调用方交进去的东西。
 *   ⇒ 于是"改数据 ⇒ 立刻生效"这件事的**成立条件**就是：**调用方每次调用时读**。
 *
 * ★★ 而这正是那个三分类里**唯一**兑现"不必重载"的一类：
 *
 *     改【跑着的代码】（.ts 的逻辑）        ⇒ 要 build + 重载
 *     改【被内联进 lib 的数据】（静态 import）⇒ ★ 要 build + 重载（只省了"懂 TS"）
 *     改【运行时读盘的数据】（这里）        ⇒ ★ 不 build、不重载
 *
 *   MEASURED（t53）：静态 `import rules from './….json'` 在本仓库连编译都过不去
 *   （`TS1543 … requires a 'type: "json"' import attribute when 'module' is NodeNext`）；
 *   即便打开 `resolveJsonModule`，JSON 也会被 `tsc` 内联进 `lib/` ⇒ 改数据仍要 build。
 *   ★ 所以中间那一类**看起来像数据**，而它在运行时与代码同命。
 *
 * ★ 四态**互不同形**（`parseRules` 判后两者，这里判前两者）：
 *     loaded / absent（读不到）/ malformed（形状坏）/ empty（空表）
 *   ⇒ 后三者会让判据降级成 `unmeasured` —— **绝不静默退化成"没有规则"**。
 */
export declare function loadVerifyCommandRules(workspace: string): Promise<RulesLoad>;
/**
 * ── ★★★ 杀子进程：要杀【进程组】，不是杀那个 `sh`（2026-10-12）────────────────────
 *
 * MEASURED（本仓 t34 事故的现场取证）：`spawn('/bin/sh', ['-c', cmd])` 之后
 * `child.kill('SIGKILL')` **只杀掉 `sh` 本身** —— `sh` 派出去的那棵树
 * （`node --test`、`pnpm`、`tsc`…）不会被一起杀，于是它们变成 `ppid = 1` 的孤儿。
 *
 * 实测现场：4 个孤儿 node 进程，`cwd` 都是插件仓库、带 `--test-concurrency=0`、
 * **CPU 0%**、存活 5.7–6.5 小时，**跨了两次宿主重启都没被清理**。
 * ★ 它们的形态是最坏的一种：不报错、不占 CPU、只是**一直占着** ——
 *   于是"有过一次超时"与"这台机器上有一批不死的东西"在日志里完全不同形。
 *
 * ── 修法：`detached: true` + 杀 `-pid` ────────────────────────────────────────
 *
 *   `detached: true` 让子进程成为**新进程组的组长**（pgid = 它的 pid），
 *   于是 `process.kill(-pid, 'SIGKILL')` 杀的是**整组**。
 *   ★ `-pid` 里的负号是「进程组」这个语义本身，不是笔误。
 *
 * ★ 四条边界（每条都对着一种会把读数弄坏的写法）：
 *   · `detached` **不**去掉管道（`stdio: 'pipe'` 仍在），也**不** `unref` ——
 *     调用方照样等 `close`，对外行为一字未变；
 *   · 组已经不在了（`ESRCH`）⇒ 退回杀单个 pid；
 *   · 两种都失败 ⇒ **不再纠缠**：在超时路径上抛错会把一次"超时"变成一次
 *     "执行器抛错"，而那是**另一种读数**（判据对两者的措辞完全不同）；
 *   · 只在**超时**路径上调它。正常收尾时组已经空了，多杀一次是无意义的系统调用。
 */
export declare function killShellTree(child: {
    pid?: number | undefined;
    kill: (signal?: NodeJS.Signals) => boolean;
}, signal?: NodeJS.Signals): void;
/**
 * ── ★★★ t84：单条命令的超时可以【收窄】，但只许收窄（2026-10-12）─────────────────
 *
 * `VERIFY_COMMAND_TIMEOUT_MS` 管的是**一条命令**。整条 completion 链
 * （verify-rerun + backtest + r5 + mutation 判据串行）此前**没有任何总预算** ——
 * 实测长尾 53 分钟。⇒ 调用方需要把一个"剩余总预算"传下来。
 *
 * ★ 语义是**收窄不是放宽**：调用方传的是 `min(单命令上限, 剩余总预算)`，
 *   于是"单条命令最多 120 s"这条既有纪律一个字没动，而"整条链有界"成为可能。
 * ★ 非有限值 / 负数 ⇒ 退回缺省（**不**读成"立即超时"）：一个 0 会让每条命令
 *   立刻返回 125，而 125 在判据里读作"超时"—— 那会把一次**参数写错**
 *   伪装成"这些命令都超时了"。
 */
export interface VerifyCommandOptions {
    timeoutMs?: number;
}
export declare function runVerifyCommand(workspace: string, command: string, options?: VerifyCommandOptions): Promise<number>;
export declare const taskWorktreeBase: Map<string, string>;
export declare function worktreeBaseOf(taskId: string): string | undefined;
export type BaseRevisionResolution = {
    kind: 'resolved';
    revision: string;
    from: 'memory' | 'record';
} | {
    kind: 'absent';
    reason: 'no-worktree' | 'not-recorded';
};
export declare function resolveBaseRevision(task: {
    id: string;
    attempt?: number;
    kind?: string;
}): BaseRevisionResolution;
export declare function runInDetachedRevision(options: {
    workspace: string;
    revision: string;
    command: string;
    /**
     * ★ 2026-10-12：把调用方的**剩余预算**传进来（只收窄）。
     *   本函数内部有**三条**命令，若只包外层，一次调用最坏能跑 3 × 120 s
     *   —— 于是"预算有界"只对一半，而那一半在日志里看不出来。
     */
    timeoutMs?: number;
}): Promise<number | undefined>;
export declare function deriveCoverageInput(options: {
    workspace: string;
    testFiles: readonly string[];
    knownTests: readonly string[];
}): Promise<Record<string, unknown> | undefined>;
export declare function runVerifyCommandCaptured(workspace: string, command: string, options?: VerifyCommandOptions): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
}>;
export declare function readWorkspaceFileSync(workspace: string, relativePath: string): string;
export declare function writeWorkspaceFileSync(workspace: string, relativePath: string, contents: string): void;
/**
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * `VERIFY_COMMAND_TIMEOUT_MS = 120_000` **只是单条命令**的上限。整条 completion 链
 * （`verify-rerun` → `backtest`(full) → `r5` → `mutation`，判据**串行**求值）
 * 此前**没有任何总预算** —— 实测 914 次 `update_task` 的 completed 分支
 * p90 = 127.7 s、**max = 3215.6 s（53 分钟）**，而一次失败还会让 attempt 翻倍、
 * 于是整条链**从头再跑一遍**（t34 已 attempt 5）。
 *
 * ⇒ ★ 单命令超时在读数上会**冒充**总预算：看到代码里有 timeout 的人很容易得出
 *   "不可能挂"的结论，而那个 timeout 覆盖的只是一小段。
 *
 * ── 为什么预算是**调用方**的事实，而不是判据的 ────────────────────────────────
 *
 * 判据是纯数据变换（契约 §2 性质 1）：**它不读时钟**。所以"这一轮还剩多少时间"
 * 只能由调用方持有，并通过**执行器的超时**落到地上 —— 见 {@link runWithinBudget}。
 *
 * ★ 缺省给得宽（20 分钟）：它要挡的是**病态长尾**（53 分钟那一档），而不是正常
 *   路径（p90 才 2 分钟）。把缺省压到分钟级会让这条判据**常态性**报 unmeasured
 *   —— 那是"判据被自己的预算关掉了"，比慢更坏，而且它与"测试不够"在报告里同形。
 */
export declare const COMPLETION_BUDGET_MS: number;
/** 用环境变量覆盖总预算。非正数 / 非法值 ⇒ 退回缺省（**没有"无限"这个档位**）。 */
export declare const COMPLETION_BUDGET_ENV = "AGENT_TEAMS_COMPLETION_BUDGET_MS";
export interface CompletionBudget {
    readonly totalMs: number;
    readonly deadlineMs: number;
    remainingMs: () => number;
    elapsedMs: () => number;
    /** 记一笔"有人被预算挡下"，并留下是谁。 */
    noteExhausted: (label: string) => void;
    /** 被预算挡下的调用标签（发生顺序，去重）。 */
    exhaustedBy: () => readonly string[];
    exhausted: () => boolean;
    /** 受预算约束发出的调用条数。 */
    calls: () => number;
    noteCall: () => void;
}
export declare function createCompletionBudget(totalMs?: number): CompletionBudget;
/**
 * ── ★ 把一次执行器调用包进预算 ────────────────────────────────────────────────
 *
 * 两条纪律：
 *
 * ① **超预算 ⇒ 抛一条自述的错误**，不返回一个"看起来像命令失败"的退出码。
 *    理由：判据对"执行器抛错"与"命令失败"的措辞**完全不同** —— 前者说
 *    "我没能跑它"，后者说"它跑了并且失败"。返回 125 会让一次**预算停止**
 *    被读成"这些命令都超时了"，也就是把基础设施的读数伪装成关于代码的读数。
 *
 * ② 传下去的超时是 `min(单命令上限, 剩余)` ⇒ **只收窄、不放宽**：单条命令最多
 *    120 s 这条既有纪律一个字没动，而累加起来整条链有界。
 */
export declare function runWithinBudget<T>(budget: CompletionBudget, label: string, run: (timeoutMs: number) => Promise<T>): Promise<T>;
/**
 * mutation 会【就地】改生产文件、跑测试、再改回来：
 *
 *     writeFile(target, mutated)
 *     try { runTests() } finally { writeFile(target, original) }
 *
 * `finally` 只覆盖**正常退出**。它不覆盖 SIGKILL / 宿主崩溃 / 关掉 App。
 *
 * MEASURED（本仓 2026-10-12，t34 事故**已兑现**的后果）：
 *   主仓库 `src/worktree.ts:366` 被留在变异态 —— `failed: Array<{…}>` 后面多了
 *   一个 `=`。它**不是手误**：没有任何人会自然写出 `}> =`，而 `gt-to-ge` 算子
 *   （`find:'>'` → `replace:'>='`）在改动行范围内唯一命中的位置正是那里。
 *   后果是 `pnpm build` **从此必失败**（2 s，exit 2），而 378 那行报错是**级联**。
 *
 * ★ 而 `src/mutation-guard.ts` 早就写好了"事后发现残留"的守卫
 *   （`checkMutationGuard`，三态 + git 证据）—— 但**全仓没有一个调用方**。
 *   于是"发现了"这件事本身也不存在。
 *
 * ── 本机制提供的是【恢复】，而不只是【发现】───────────────────────────────────
 *
 * 一个只报告残留的守卫能让人**知道**插件坏了；它不能让人**不必**手动修。而
 * "插件自己的 `pnpm build` 挂了"这条症状，与"某处代码写错了"在日志里同形。
 *
 * ── 机制：写之前先记日志；恢复时按【内容】判定，冲突就不动 ─────────────────────
 *
 *   条目（每个文件一条，落在 `<workspace>/.agent-teams/mutation-journal/`）：
 *
 *       { file, original, mutated, at }
 *         original —— 这一轮**第一次**写它之前的内容（`null` = 当时不存在）
 *         mutated  —— **最后一次**被写进去的、与 original 不同的内容
 *
 *   恢复逐条判定（四态，互不同形）：
 *
 *     ① current === original            ⇒ 干净（正常收尾过）        ⇒ 删条目
 *     ② current === mutated             ⇒ 残留确实是变异体写的      ⇒ **写回 original**
 *     ③ 两者都不是                       ⇒ **冲突**：崩溃之后有人
 *                                           动过这个文件 ⇒ **不动**，留条目报出来
 *     ④ 读不到 / 条目坏                  ⇒ 未测量 ⇒ **不动**，报出来
 *
 * ★ ③ 是这套机制里最要紧的一态，也是它**不做**自动覆盖的理由：崩溃之后成员完全
 *   可能合法地编辑过那个文件。把它写回"变异前的样子"会**丢掉一次真实的工作**，
 *   而那种损失在日志里与"恢复成功"同形。⇒ 只在内容**逐字等于**我们写进去的
 *   那一份时才回滚。
 *
 * ★ 顺序是【先记日志、再写文件】：于是"记完日志就崩"落在情形 ①（干净），
 *   而不是留下一个半截的条目。
 */
export declare const MUTATION_JOURNAL_STATE_DIR = ".agent-teams";
export interface MutationJournalEntry {
    /** workspace 相对路径。 */
    readonly file: string;
    /** 这一轮第一次写它【之前】的内容；`null` = 当时它不存在。 */
    readonly original: string | null;
    /** 最后一次被写进去的、与 `original` 不同的内容。 */
    readonly mutated?: string;
    readonly at: string;
}
export declare function mutationJournalDir(workspace: string, stateDir?: string): string;
/**
 * 在一次【就地写】之前记账。
 *
 * ★ 由调用方在注入给判据的 `writeFile` 里调 —— 判据自己做不了这件事（它是纯的）。
 * ★ 幂等：同一个文件重复写只更新 `mutated`，`original` **永远是第一次那一份**
 *   （后面读到的都已经被污染了）。
 */
export declare function recordMutationWrite(workspace: string, relativePath: string, contents: string, stateDir?: string): void;
export interface MutationRecoveryReport {
    /** 被写回原文的文件（残留确实是我们写的）。 */
    restored: string[];
    /** 已经干净、只把条目删掉的文件。 */
    clean: string[];
    /** 需要人看一眼：内容既不是原文、也不是我们写进去的变异体。条目**保留**。 */
    conflicts: Array<{
        file: string;
        reason: string;
    }>;
    /** 恢复过程本身失败。条目**保留**。 */
    failed: Array<{
        file: string;
        reason: string;
    }>;
    /** 有没有真的动过盘（用于决定要不要打日志）。 */
    touched: boolean;
}
/**
 * 扫一遍某个 workspace 的变异日志并恢复。
 *
 * ★ 两种调用时机，各有各的必要：
 *   · **插件启动时** —— 上一次崩溃留下的残留在这一步被修掉，而不是等下一次
 *     `update_task` 顺手修（那可能永远不来）；
 *   · **每条 completion 链的入口** —— 兜住"上一次没走完"的那一类。
 * ★ 正常收尾也走它：那时每个条目的 `current === original` ⇒ 只删条目、不动文件。
 *   所以它同时是"清理"，不需要另设一个 clear 函数（两个入口会分叉）。
 */
export declare function recoverMutationJournal(workspace: string, stateDir?: string): MutationRecoveryReport;
/**
 * ── ★★★ 启动时的收残留：扫【插件自己的树】以及它派出去的每一棵树 ─────────────────
 *
 * ★ 为什么"启动时"这一步不可省：`wireCompletion` 里那两次调用只在**下一次有人
 *   报完成**时才会发生。而本条机制要修的那个事故恰恰是 ——
 *   **插件自己的 `pnpm build` 从此必失败**（`src/worktree.ts:366` 的 `=`）。
 *   从崩溃到"下一个人报完成"之间，插件的构建一直是坏的，而那条症状
 *   （"某处代码写错了"）与真实的代码错误完全同形。
 *   ⇒ 必须有一个**与成员行为无关**的时点去修它，那就是挂载。
 *
 * ★ 扫两处、不只扫根：
 *   · `root` —— 队长的工作区**就是插件仓库**（实测：t34 的 `assignee` 是 captain，
 *     而 `workspaceOf(caller)` 给出的是 `session.header.cwd`，即插件根）
 *     ⇒ 事故就落在这里；
 *   · `root/.agent-teams/worktrees/*` —— 成员被派到隔离树里干活，那里同样会跑
 *     mutation（workspace = 那棵树）⇒ 同一类残留，只是位置不同。
 *
 * ★ 返回**逐棵树的读数**（而不是一个合并后的数组）："哪一棵树被修了"是这条读数
 *   的全部价值 —— 合并之后，一棵树的冲突会淹没在另一棵树的干净里。
 */
export declare function recoverMutationJournalsUnder(root: string, stateDir?: string): Array<{
    workspace: string;
    report: MutationRecoveryReport;
}>;
export declare function deriveScanDirs(changedFiles: readonly string[]): string[] | undefined;
export declare function changedLineNumbers(workspace: string, base: string | undefined): Promise<number[] | undefined>;
export declare function mergeRerunIntoCommandsRun(claimed: readonly CommandResult[] | undefined, reruns: readonly CommandResult[]): CommandResult[];
export declare function stateRootOf(workspace: string, config: ToolsConfig): string;
export declare function teamLockKey(stateRoot: string, teamId: string): string;
export declare function captainLockKey(stateRoot: string, captainId: string): string;
export declare function requireCaptainTeam(workspace: string, config: ToolsConfig, captain: Agent): Promise<TeamState>;
export declare function requireParticipantTeam(workspace: string, config: ToolsConfig, caller: Agent): Promise<TeamState>;
export type ParticipantIdentity = {
    kind: 'captain';
    name: typeof CAPTAIN_KEY;
} | {
    kind: 'member';
    name: string;
};
export declare function participantIdentityOf(team: TeamState, agentId: string): ParticipantIdentity | undefined;
export declare function requireFreshTeam(stateRoot: string, teamId: string): Promise<TeamState>;
export declare function requireFreshCaptainTeam(stateRoot: string, teamId: string, captainId: string): Promise<TeamState>;
export declare function requireFreshParticipant(stateRoot: string, teamId: string, callerId: string): Promise<{
    team: TeamState;
    identity: ParticipantIdentity;
}>;
export declare function requireMember(team: TeamState, name: string): TeamMember;
export declare function requireTask(team: TeamState, taskId: string): TeamTask;
export declare function trimmedOptional(value: string | null | undefined): string | undefined;
export declare function memberOpenTask(team: TeamState, memberName: string, exceptTaskId?: string): TeamTask | undefined;
/**
 * ── ★★★ t26：作用域的**两条机械检查**（在**建任务的那一刻**跑）──────────────────────
 *
 * 契约原话：*"Two distinct failures, each one assertion"* —— 而它们在本轮里
 * 各自吃过完整的派发往返，由四个成员独立撞到。
 *
 * ── ① CONTRADICTION：同一个路径同时出现在 `inScope` 与 `outOfScope` ──────────────
 *
 * MEASURED（t19）：一次修订更新了 `inScope` 而没更新 `outOfScope`，于是
 * `src/types.ts` **两边都在**。★ 而校验器**按 out-of-scope 那一侧执行** ⇒
 * 那个任务**无解**：它要改的文件是它被禁止改的文件。
 * ★★ 最坏的地方不是"任务难做"，而是**它读起来完全正常** ——
 * 一行 `In scope: …; Out of scope: …`，两个列表都在场，而**交集没人算**。
 *
 * ── ② TOUCH：为了满足某条验收标准，**必须改的每一个路径**是否都在 `inScope` 里 ────
 *
 * MEASURED（t24）：它的验收标准是**把判据从 `src/tools/shared/entities.ts` 搬走**，
 * 于是那个文件需要**两处**改动（一个 import、一个 re-export 中转），
 * 而 `inScope` 只写了**目的地**。
 * ★★ 这一类在**任何** move / relocate / extract 任务上都会复发 ——
 * 因为它们**天生**有一个源与一个目的地，而生成器只列目的地。
 *
 * ── ★ 判据是保守的：**只在能机械读出时开火** ─────────────────────────────────────
 *
 * 一个靠猜的检查会在散文上误报，而**误报会教人忽略门禁**（与漏报同样有害）。
 * ⇒ 下面两条都只认**明确读得出来的东西**：路径形的 token、以及 move 类动词。
 */
/** 一条作用域检查的失败（**逐条指名** —— 读的人要能直接去改）。 */
export interface ScopeContradiction {
    /**
     * ★ t26：三条各自可指名的检查（队长证据包里的第 1/2/3 条子类）。
     *   ★ 逐条指名是刻意的：读的人要能直接知道**哪一条**拦住了它，以及去改什么。
     */
    readonly check: 'contradiction' | 'emit' | 'touch';
    readonly detail: string;
}
/**
 * ① 同一个路径同时在 inScope 与 outOfScope 里。
 * ★ 复用 `quality-gates.ts` 的 `inScopeOverlap`（**同一份**判据，不重写一份 —— 两份会漂移）。
 */
export declare function scopeContradictions(inScope: readonly string[] | undefined, outOfScope: readonly string[] | undefined): ScopeContradiction[];
export declare function scopeTouchGaps(acceptance: readonly string[] | undefined, inScope: readonly string[] | undefined, outOfScope: readonly string[] | undefined): ScopeContradiction[];
/**
 * ── ★★★ ④（EMIT）构建产物的声明 —— 队长证据包里**最便宜、最可机械计算**的一条 ──────────
 *
 * 契约原话把它称为 *"the build-products rule, now proved twice and in both directions"*。
 * 两次实测：
 *
 *   · t24 写了 `lib/types.d.ts` —— 而本仓 `declarationDir` 是 `lib/types`
 *     ⇒ 那一路径**永远产不出来**（`lib/types/types.d.ts` 在，`lib/types.d.ts` 不在）。
 *   · t19 写了 `lib/types/types.d.ts` 而**漏了 `lib/types.js`** ——
 *     而后者才是**真正跑起来的那一个**（+61 行，夹具 import 的就是它）。
 *
 * ★★★ 而 t19 那一次的决定性证据是：**每一个别的列了 `src/types.ts` 的任务
 *   （t3 / t14 / t24）都已经声明了 `lib/types.js`**。
 *   ⇒ 所以那从来不是一次判断，**只是一次分叉** —— 而这正是本判据要消灭的东西。
 *
 * ── 规则（纯计算，不读盘、不猜）─────────────────────────────────────────────────
 *
 *     每一个 `src/X.ts` 在 inScope 里 ⇒ 产出集必须声明：
 *        `lib/X.js`              （tsc 的 outDir 产物 —— 真正被 import 的那一个）
 *        `lib/types/X.d.ts`      （declarationDir 产物 —— 类型面）
 *     ★ 见 `tsconfig.json`：`outDir: lib`、`declarationDir: lib/types`、`rootDir: src`。
 *     ⇒ 所以 `<root>/<rel>` 那张映射是**编译配置的直接后果**，不是约定。
 *
 * ★ 而 `lib/types.d.ts` 那种"把目录名当成文件名"的形状由 t23 的
 *   `structurallyImpossiblePath` 负责（它在 `quality-gates.ts`，不在这里）——
 *   本函数**只**管"漏了产出"，两条各司其职、不重叠。
 */
export declare function emittedProductGaps(inScope: readonly string[] | undefined, 
/**
 * ── ★★★ 根目录**可注入**，而判据是"**这个文件真的在盘上吗**"（t26 实测的修正）──────
 *
 * MEASURED（t26）：第一版对**每一个** `src/*.ts` 都要求声明产物 ——
 * 而那当场打红了**九条既有的臂**，因为它们的夹具用的是**象征性路径**
 * （`src/a.ts` / `lib/a.js`，那些文件**根本不存在**，永远不会被 build 产出）。
 *
 * ★★ 而真正的缺陷（t19 漏 `lib/types.js`、t24 写 `lib/types.d.ts`）都发生在
 *   **真实存在的、被 git 跟踪的**源文件上。⇒ 判据是：
 *
 *     这个 `src/X.ts` **真的在盘上**（⇒ build 真的会为它产出东西）⇒ 要求声明产物
 *     它不在盘上（⇒ 这是一个**还没被创建**的文件，或一个**象征性**的夹具路径）
 *       ⇒ ★ 不报：产物**还不存在**是正常的，那不是"漏声明"
 *
 * ★ 这与 t23 的 (ii) 是**同一条纪律的两面**：
 *   那边管"inScope 里的路径**结构上不可能**产出来"，
 *   这边管"**真的会**产出来的那些，产物有没有被声明"。
 *   而两者都只对**能机械核对**的事实说话 —— 不猜。
 */
root?: string): ScopeContradiction[];
/** 跑上面两条并合集 —— 建任务时调用一次，**逐条指名**。 */
export declare function scopeViolations(input: {
    inScope?: readonly string[];
    outOfScope?: readonly string[];
    acceptance?: readonly string[];
}): ScopeContradiction[];
/**
 * ── ★★★ t26：成员收到的**任务说明**是从**被强制执行的那份记录**投影出来的 ─────────────
 *
 * 契约原话：*"the ASSIGNMENT TEXT handed to members has now diverged from the enforced
 * team.json list FIVE times"*（t22 / t13 / t16 / t24 / t19）—— 而 t13 那次
 * **差一点发出去一个 inert 的 UI**：真正喂面板的那个文件在**被强制**的清单里、
 * 却在**说明文字**里缺席。
 *
 * ── 本函数**就是**那句"assignment text" ─────────────────────────────────────────
 *
 * MEASURED（t26）：成员拿到的那段说明是 `taskDetails(...)` 的返回值，
 * 由 `src/tools/claim.ts` 在两处（首领 / 幂等重领）交给 `task_details`。
 * ⇒ 所以"说明文字"**不是一个单独维护的副本** —— 它就是这里的投影。
 *
 * ── ★★ 而"投影"必须**被核对过**，否则它只是"把存着的原样印出来" ────────────────────
 *
 * 此前它把两个列表原样拼成一行：
 *
 *     `In scope: …; Out of scope: …`
 *
 * ★ 于是**交集没人算**：一条 `src/types.ts` 同时在两边、从而**无解**的任务，
 *   在说明里读起来**完全正常**（t19 的实测形状）。
 * ⇒ 现在投影**先跑一遍那两条检查**，并把结果**写进那段说明本身**：
 *   一条有矛盾的任务**不许**以"看起来没问题"的样子交到成员手上。
 *
 * ★★★ 而它**不**在这里抛错：`taskDetails` 是一条**只读**的投影（成员在 claim 时拿到它），
 *   在那个时刻拒绝会**卡住一个已经在跑的任务** —— 而"已经在跑"与"该不该建"是两件事。
 *   ⇒ **拒绝**发生在**建任务时**（`create-task.ts` 调 `scopeViolations`）；
 *     投影这一侧的职责是**如实标出来**，而不是替它做那个决定。
 *   ★ 两者是同一个判据的两个出口：一个拦在门口，一个让已在里面的人看得见。
 */
export declare function taskDetails(team: TeamState, task: TeamTask): string;
export declare function captainOpenTask(team: TeamState, exceptTaskId?: string): TeamTask | undefined;
export declare function stopTeamMemberActivations(ctx: Context, captain: Agent, members: readonly TeamMember[], signal?: AbortSignal): Promise<void>;
export declare const RUNTIME_GATE_LOG_LIMIT = 50;
export declare const runtimeGateLog: Array<{
    at: number;
    event: string;
    outcome: string;
}>;
/**
 * ── ★★ f-0026：三态里【两维各自可读】，不合成一个布尔 ────────────────────────────
 *
 * 这两维测的**不是同一件事**（本任务硬要求：两个都要，且各自可读）：
 *
 *   `output` 维（t23 起）：盘上自本进程启动以来，有没有被 rebuild 过？  —— 「内容变没变」
 *   `commit` 维（本任务）：本进程加载的是哪个 commit 的代码？            —— 「代码落后没落后」
 *
 * ★ 合成一个布尔会让 `{output 同, 提交落后}` 这种组合**消失** —— 而那正是
 *   f-0026 的全部内容：进程启动前盘上就是当前版 ⇒ 旧读数恒报 current。
 *
 * ★ `stale` 带一个可选的 `behind` / `aheadOf`（提交），**不是**可选的措辞：
 *   只说"旧了"仍然要人去猜从哪旧起，而那个猜测正是误诊开始的时刻。
 */
export type ModuleFreshness = {
    status: 'current';
    loaded: string;
    onDisk: string;
    commit?: string;
    head?: string;
} | {
    status: 'stale';
    loaded: string;
    onDisk: string;
    commit?: string;
    head?: string;
    behind?: string;
    why: 'content' | 'commit' | 'both';
} | {
    status: 'unknown';
    loaded?: string;
    onDisk?: string;
    commit?: string;
    head?: string;
    reason: string;
};
export declare const BUILD_STAMP_FILE = "git-artifact-stamp.json";
/** stamp 里与 git 有关的那一格。★ 缺省缺席（旧 stamp）⇒ `undefined`，不是空串。 */
export interface BuildStamp {
    schema?: unknown;
    output?: unknown;
    commit?: unknown;
}
export declare function readStamp(root: string): BuildStamp | undefined;
export declare function readStampOutput(root: string): string | undefined;
/**
 * ── ★★ 「构建时的提交」从 stamp 读；「当前 HEAD」在【调用时】读 ─────────────────────
 *
 * ★ f-0025「按取值时机区分」的可执行形式：
 *
 *     「构建时的提交」 —— **常量**。它随 stamp 落盘，进程加载后不会变 ⇒ 加载时读一次即可。
 *     「当前 HEAD」    —— **每次调用都可能变**的量 ⇒ 必须在**调用时**重新取。
 *
 * ★ 把后者也做成"加载时读一次"，它就退化成与 `output` 同一个问句 ——
 *   而"答的是另一个问题"正是 f-0026 要修的那一格。
 */
export declare function stampCommitOf(stamp: BuildStamp | undefined): string | undefined;
/**
 * 读【此刻】的 HEAD。取不到 ⇒ `undefined`（**不是**空串）。
 *
 * ★ 三种"取不到"必须都是 `undefined`，而**成因写进 reason**（由调用方区分）：
 *   不是 git 仓库 / git 不可用 / 仓库还没有任何提交（`HEAD` 未出生）。
 *   ★ 而它与"读到了但内容为空"不同形 —— 后者不是一个合法 sha，也走不到这里。
 */
export declare function currentHead(root?: string): string | undefined;
/**
 * ── ★★ 新鲜度的【全部输入】都注入进来 —— 于是它可以被夹具精确驱动 ────────────────
 *
 * ★ 这条与 `r5` / `mutation` / `backtest` 同一纪律：判据本身是纯数据变换，
 *   I/O 由调用方注入。★ 而它有一个额外好处：**"取值时机"可以被测**——
 *   同一份 `loaded` 配两个不同的 `head`，必须给出两个不同的读数（臂 15）。
 */
export interface FreshnessInput {
    /** 进程加载时读到的 stamp（常量，只读一次）。 */
    loaded?: BuildStamp;
    /** 此刻盘上的 stamp。 */
    onDisk?: BuildStamp;
    /** 此刻的 HEAD。★ 由调用方在**调用时**取。 */
    head?: string;
    /**
     * ── ★★★ 构建时那条提交【是不是 HEAD 的祖先】────────────────────────────────
     *
     * MEASURED（2026-10-09，captain 自己踩进去的）：
     *   `commitBehind = builtCommit !== head` 用【不相等】判【落后】——
     *   而"构建时的提交是 HEAD 的祖先"也被读成了落后
     *   （实测：stamp=`49894d0` 而 HEAD=`d457d9c`，`git merge-base --is-ancestor` 为**真**，
     *    即代码没有落后，只是 stamp 没更新）。
     *
     * ★★ 而它的后果是一个【循环】：`build` 之后 `commit`（提交 lib/ 与 stamp）
     *   必然让 stamp 落后 HEAD 一格 ⇒ 那条门【每轮都会说话】。
     *
     * ⇒ ★ 所以"落后"的正确判据是【祖先关系】：
     *   · 是祖先   ⇒ 构建基于更早的提交，而它在 HEAD 的历史里 ⇒ ★ 不是"你手上的代码旧了"
     *   · 不是祖先 ⇒ 构建基于一条【不在当前线上】的提交（换分支 / rebase）⇒ 那才是
     *
     * ★ 三态：`true`（是祖先 ⇒ 不算落后）· `false`（不是祖先 ⇒ 真落后）·
     *   `undefined`（**跑不了 git ⇒ 判不了**）⇒ ★ 而判不了时【保守】：维持"落后"。
     *   —— 因为"说不清"不得读成"没事"（本队那条三态纪律）。
     */
    builtCommitIsAncestorOfHead?: boolean;
}
export declare function moduleFreshnessFrom(input: FreshnessInput): ModuleFreshness;
export declare function moduleFreshness(): ModuleFreshness;
/**
 * ── ★★★ 第三维：`from..to` 之间，**构建的输入**有没有真的变？─────────────────────
 *
 * MEASURED 的由来：`stamp.commit` 与 HEAD **必然**不同，而这是构造性的 ——
 * 产物无法描述包含它自己的那个提交（commit N 写 stamp{commit: N}，而包含它的提交是 N+1）。
 * ⇒ 若把"不相等"直接读成"落后"，那么**每提交一次**就产生一条
 *   **先于使用者存在的假红**。实测代价：`gate-stale-module` 的臂 1/4/6 同时变红，
 *   而三条标题里**都没有 "stamp" 这个词** ⇒ 读起来像"谁弄坏了三条不相干的臂"。
 *
 * ★ 而"祖先为真"其实有两种情形，补救动作相反：
 *   · **有人动了历史**（改了又改回来 / amend）⇒ 该报 stale；
 *   · **build 之后 commit** ⇒ 不该报。
 * 分开它们要问的正是这一格：**那两个提交之间，构建的输入变了吗？**
 *
 * ★ 三态，与全仓纪律同源：
 *   `true`      —— 输入变了（真的落后）
 *   `false`     —— **输入一个字没变** ⇒ 旧构建描述的就是当前代码 ⇒ 不算落后
 *   `undefined` —— 问不出来（跑不了 git / 那条提交不在库里）⇒ 调用方**保守处理**
 *
 * ★★ 为什么看的是**路径清单**而不是"摘要相等"：摘要需要重新计算整棵 `src/`，
 *   而这一问发生在**每一次状态读取**上（`moduleFreshness()` 是被高频调用的）。
 *   `git diff --name-only` 是 git 自己算的、与工作树无关，代价可忽略；而
 *   "清单为空"与"摘要相等"在这个问题上**等价**（输入一个字没变 ⇒ 摘要必然相同）。
 */
export declare function buildInputsChangedBetween(from: string, to: string, root?: string): boolean | undefined;
/**
 * `ancestor` 是不是 `descendant` 的祖先（用 git 判，而不是用字符串比）。
 *
 * ★ 三态：`true` / `false` / `undefined`（**跑不了 git ⇒ 判不了**）。
 *   ★ 而"判不了"与"不是祖先"必须不同形 —— 前者的处置是"保守地当作落后"，
 *     后者是"真的换了线"。而调用方拿 `undefined` 时按保守处理。
 */
export declare function isAncestorOf(ancestor: string, descendant: string, root?: string): boolean | undefined;
/** ★ 加载时读一次的整份 stamp —— 「构建时的提交」是常量，与 `output` 同一时机。 */
export declare let LOADED_STAMP: BuildStamp | undefined;
export declare let LOADED_STAMP_READ: boolean;
export declare function loadedStamp(): BuildStamp | undefined;
export declare function pluginRoot(): string;
/**
 * ── ★★★ 卡点/判决 ⇒ 任务：把 `friction-triage` 接上【生产调用方】（t26）───────────────
 *
 * ── 它接的是什么 ───────────────────────────────────────────────────────────────
 *
 * `scripts/friction-triage.mjs` 早已能把**卡点/判决**变成一份**审查过的、分好档的**
 * 任务契约（`triage` → `runPipeline` → `emitReviewedContract` → `dispatchable` 四态）。
 * ★ 而它此前**零生产调用方**：`src/` 里对它的引用**全部在注释里**，
 *   真正 `import` 它的只有 `scripts/*.test.mjs`。
 * ⇒ 于是盘上的卡点与判决**没有任何东西**把它们变成任务 ——
 *   「机制建好了，没有接线」的第 8 个实例。
 *
 * ── ★★★ 而它为什么需要【动态 import + `pluginRoot()`】─────────────────────────────
 *
 * `scripts/` 在 `tsconfig.json` 的 `rootDir = "src"` **之外** ⇒ 静态
 * `import '../../scripts/friction-triage.mjs'` 会落 `TS2307`（实测），
 * 且 `rootDir=src` 意味着 **`lib/` 里不会有 `scripts/`**。
 *
 * ★ 而这**不构成障碍**，因为本仓【已经在这么做】了：
 *   `src/quality-gates.ts` 读基线清单时走的是
 *   `readFileSync(join(pluginRoot(), 'scripts', 'fixtures', 'baseline-known-failures.json'))`
 *   —— ★ 运行时路径，不经 `tsc` 的 `rootDir`。
 * ⇒ 本条沿用**同一种做法**（裁定 A1），而不是新开一个先例。
 *
 * ★ 类型面由 `scripts/friction-triage.d.ts`（最小声明）给出 —— 而**不是**
 *   `@ts-expect-error`：后者会让「这个模块不存在」与「这个模块存在而导出改名了」
 *   读成同一件事，而那正是本仓那条最贵纪律的同形。
 *
 * ── ★★ 边界：本条**只加调用方**，不改 `friction-triage.mjs` 的判据语义 ────────────
 *
 * 分档（`tierOf`）、五问（`adversarialReview`）、四态（`dispatchable`）都是对的。
 * 用户 §38 那条判据由**它**实现，而本条只负责把它的结论**读出来并交出去**：
 *
 *     ✓ 小档 + 审查通过 + 契约完整  ⇒ 可派（`ready`）
 *     ✗ 大档（要拆解）/ 审不过 / 契约不全
 *       ⇒ 分别进 `awaitingRuling` / `rejected` / `cannotEmit`
 *
 * ★★★ 而 `awaitingRuling` 的**长度本身是一条读数**（用户 §38：
 *   「需要人拍板是**缺陷指标**，不是交付方式」）⇒ 它长了说明"能自己解决的事太少"，
 *   而那正是要消灭的那个指标。⇒ 所以下面把四个数字**分别**交出去，**不合并成一个**。
 */
export interface ExperienceDispatchReadout {
    /** ★ 四态的**各自条数**（不合并 —— 合并会抹掉"为什么没进 ready"）。 */
    readonly ready: number;
    readonly awaitingRuling: number;
    readonly rejected: number;
    readonly cannotEmit: number;
    /** 拆解那一栏（每条大活拆成了几条、各去哪）。 */
    readonly decomposed: number;
    /** ★ 「为什么没进 ready」的分栏（主干的 stage → 那一栏的名字，只有一处映射）。 */
    readonly notReadyBecause: Record<string, number>;
    /** ★ `ready` 里那些提案的**完整契约**（调用方拿它去建任务）。 */
    readonly contracts: readonly ExperienceDispatchCandidate[];
}
/** 一条**可派**的提案：它带着完整契约与来源。 */
export interface ExperienceDispatchCandidate {
    readonly sourceId?: string;
    readonly tier?: string;
    /** ★ 审查过的契约 —— `ready` 池里只可能是 `emitReviewedContract` 给的。 */
    readonly contract: Record<string, unknown>;
}
/**
 * ── ★★ 三态（而它们**不同形**）──────────────────────────────────────────────────
 *
 *   `ok`          读到了卡点/判决（`unreadable` 为空）
 *   `partial`     ★ **有一侧读不到**（附是哪一侧）—— 而它**不是** `ok`
 *   `unmeasured`  ★ 整个 `friction-triage` 引不进来（模块不在 / 导出改名）
 *
 * ★★★ 而 `unreadable` 那格**绝不许**被读成"没有待派的"：
 *   「我没能读」与「我看了，确实没有」**不同形** —— 后者是"确实为空"，
 *   前者是"我根本不知道有多少"。合并它们会让"卡点目录写错了"伪装成"一切都好"。
 */
export type ExperienceDispatchState = 'ok' | 'partial' | 'unmeasured';
export interface ExperienceDispatchResult {
    readonly state: ExperienceDispatchState;
    /** ★ 读不到的那几侧（空数组 = 都读到了）。 */
    readonly unreadable: readonly string[];
    /** 判据层给出的四态读数（`unmeasured` 时为 `undefined` —— 它没算出来）。 */
    readonly readout?: ExperienceDispatchReadout;
    /** `unmeasured` 时说明**为什么**（模块不在 / 导出对不上）。 */
    readonly why?: string;
}
/**
 * 走一遍「卡点/判决 ⇒ 任务」：调 `friction-triage` 的 `triage` + `dispatchable`。
 *
 * @param options.frictionsDir 卡点目录（**由调用方注入** —— 判据层不猜路径）
 * @param options.judgementsDir 判决目录
 * @param options.occupied 已被占用的写域（避免派到别人的文件上）
 * @param options.loadModule ★ 注入点：默认走 `pluginRoot()` 动态 import；
 *   夹具可以换掉它（**而它只换装载，不换判据**）。
 */
export declare function readExperienceDispatch(options?: {
    readonly frictionsDir?: string;
    readonly judgementsDir?: string;
    readonly occupied?: readonly unknown[];
    readonly loadModule?: () => Promise<FrictionTriageModule>;
}): Promise<ExperienceDispatchResult>;
/** `scripts/friction-triage.mjs` 里**本调用方真正用到**的那两格（见 `scripts/friction-triage.d.ts`）。 */
interface FrictionTriageModule {
    readonly triage?: (options?: Record<string, unknown>) => {
        readonly unreadable?: readonly string[];
        readonly [key: string]: unknown;
    };
    readonly dispatchable?: (report: unknown, options?: Record<string, unknown>) => {
        readonly ready: readonly {
            readonly sourceId?: string;
            readonly tier?: {
                readonly tier?: string;
            };
            /** ★ 契约**直接挂在条目上**（实测形状）—— 不是嵌在 `emitted` 里。 */
            readonly contract?: Record<string, unknown>;
        }[];
        readonly awaitingRuling: readonly unknown[];
        readonly rejected: readonly unknown[];
        readonly cannotEmit: readonly unknown[];
        readonly decomposed: readonly unknown[];
        readonly notReadyBecause?: Record<string, number>;
    };
}
export declare function moduleFreshnessMessage(freshness?: ModuleFreshness): string;
export declare function freshnessLine(): string;
export type RestartArbitration = 
/** 两个前置都满足 ⇒ 可以重载。 */
{
    allowed: true;
    reason: 'verdict-passed-and-no-work-in-flight';
}
/** 判决未通过（或被声明为未通过）⇒ 新代码对不对没有结论，不许换。 */
 | {
    allowed: false;
    blockedBy: 'no-passing-verdict';
    detail: string;
}
/** 有工作在跑 ⇒ 重载会打断它。 */
 | {
    allowed: false;
    blockedBy: 'work-in-flight';
    detail: string;
    inFlight: string[];
};
export declare function arbitrateRestart(input: {
    /** ★ 前置一：一份**已经通过**的判决。`false` / 缺席都表示"没有可用的结论"。 */
    verdictPassed: boolean;
    /** ★ 前置二：当前全部任务（只读它们的 `status` 与 `id`）。 */
    tasks: ReadonlyArray<{
        id: string;
        status: string;
    }>;
}): RestartArbitration;
export declare function restartArbitrationMessage(arbitration: RestartArbitration): string;
export declare const RESTART_ESCAPE_HATCH_ENV = "AGENT_TEAMS_RESTART_ESCAPE_HATCH";
export declare function restartEscapeHatchFromEnv(value: string | undefined): boolean;
export declare function arbitrateRestartWithEscape(input: Parameters<typeof arbitrateRestart>[0], escapeHatchOpen: boolean): RestartArbitration | {
    allowed: true;
    reason: 'escape-hatch';
    bypassed: string;
};
export declare function judgeRuntimeGates(event: string, outcome: string): void;
export declare const WAIT_RECORD_LIMIT = 200;
export interface WaitRecord {
    readonly teamId: string;
    readonly taskId: string;
    readonly memberName: string;
    readonly attemptId: string;
    /**
     * ── ★ V3-2：等待窗口的起点，**跨代继承** ────────────────────────────────────
     *
     * MEASURED（2026-10-06，verifier3 / t3）：`agent_teams_status` 每次都会 `kickTeam`，
     * 而 kick 会给一个非 `working` 的成员 `beginTaskAttempt` **换新一代 capability**。
     * 于是每次探活看到的都是一个**刚出生**的等待：`startedAt = 现在`、
     * `previousPollAt` 缺席 ⇒ 「两次探活之间它动过没有」这个前提**在真实路径上不成立**，
     * 探活退化成"每次都报第一次"。实测三次探活，记录从 1 条变 2 条、`startedAt`
     * 从 1600000 跳到 2200000。
     *
     * ⇒ 修法：`startedAt`（**窗口起点**）由"这个任务的等待从哪里开始"决定，
     *   而不是由"这一代 attempt 什么时候被创建"决定。换代时**继承上一代的起点**，
     *   于是窗口跨代连续，"两次探活之间"重新有意义。
     *
     * ★ 与"键用 attemptId"的关系（两者不矛盾，分工不同）：
     *   · **键**仍然是 `attemptId`（capability 是身份，换代就是另一次尝试）；
     *   · **窗口起点**是任务的属性，跨代继承。
     *   把键换成 taskId 才是错的（reassign 之后旧起点会留在原地），
     *   而把【起点】随换代重置同样错 —— 两个方向都会让读数不属于它声称的那段等待。
     *
     * ★ 继承是**有界**的：只在同一 (teamId, taskId) 上继承，且只在上一代记录仍在
     *   表里时继承（LRU 淘汰之后退回本代派发时刻 —— 那时"窗口从哪开始"确实无据可依，
     *   而这比编一个起点诚实）。
     */
    readonly startedAt: number;
    /**
     * ── ★ 最近一次【观察到产出】的时刻 ─────────────────────────────────────────
     *
     * `undefined` 表示**还没有观察到任何产出**，它必须在形状上与"观察到了一次产出"
     * 不同 —— 判据据此分辨"这个成员一直在动"与"这个成员压根没动过"。
     *
     * ★★ 为什么不能从会话事件里读：**会话事件没有时间戳**。
     *
     * MEASURED（2026-10-06，与本队开工前实测一致）：`dsh-session` 的
     * `assistant/message` 事件只有 `message.content`，**没有 `at` / `ts`**。
     * 所以"最后活动时刻"**不是读出来的，是记下来的** —— 在【观察到产出的那一刻】
     * 由我方取一次时钟。这正是契约 §5 那句"runtime 可以带状态"。
     *
     * ⇒ 它的含义精确地是："**我们最后一次看见它说话**是在什么时候"。
     *   这与"它最后一次说话是什么时候"不同形，而后者在本 Harness 版本上**不可得**。
     *   判据与日志都必须按前者理解（措辞上的区别在这里是**语义**，不是文风）。
     */
    lastActivityAt?: number;
    /** 上一次探活（求值）的时刻。缺席 ⇒ 这是第一次探活。 */
    lastPollAt?: number;
    /**
     * ── ★ 上一次探活【读到的】活动时刻（V3-3 的输入面）─────────────────────────────
     *
     * 与 `lastActivityAt` 不同形，且**两个都要**：
     *   · `lastActivityAt`         —— 我们至今观察到的最新一次产出（**至今**）
     *   · `lastPolledActivityAt`   —— **上一次探活那一刻**看到的那个值（**快照**）
     *
     * 判据问的是"这两次探活之间它动过没有"，所以它要的是**两个快照**，
     * 而不是"最新值"与"某个别的值"。把两者合成一个字段，会让"上一次探活之后
     * 它才动过"这件事**无法表达** —— 而那恰好是"还在跑"与"卡死"的唯一分界。
     */
    lastPolledActivityAt?: number;
    /**
     * ── ★ 已经**观察到**的那次产出的指纹（见 `sessionOutputKey`）───────────────
     *
     * ★ 它不是诊断字段，而是判据能不能工作的**前提**：成员会话里的
     *   `assistant/message` 是**历史日志**，会一直留在那里。没有这一位，
     *   每次探活都会"看见输出"⇒ 刷新 `lastActivityAt` ⇒ 一个卡死的成员
     *   看起来永远刚动过 ⇒ **这条判据永远不报警**。
     */
    lastOutputKey?: string;
    /** 已经观察到的产出次数（诊断用；判据不用它判"第一次"，见下）。 */
    activityCount: number;
}
export declare const waitRecords: Map<string, WaitRecord>;
export declare const PROBE_EVENTS: readonly string[];
export declare const waitWindows: Map<string, WaitWindow>;
export declare const WAIT_WINDOW_LIMIT = 200;
export interface WaitWindow {
    readonly teamId: string;
    readonly taskId: string;
    readonly memberName: string;
    /** 这一次等待从何时开始（ms epoch）。★ 换代的语义是"这一轮重来"，但探活问的是"它还活着吗"—— 后者跨代成立。 */
    startedAt: number;
    /** 上一次探活的时刻（窗口作用域，不属于任何一代 attempt）。 */
    lastPollAt?: number;
    /** 上一次探活读到的活动时刻（窗口作用域）。 */
    lastPolledActivityAt?: number;
    /** 最近一次被**任何**探活碰过的时刻（`lastPollAt` 的同义词，但即使还没探过也有值：建窗口那一刻）。 */
    touchedAt: number;
    /**
     * ── ★ 这个窗口认的是第几代尝试（"连续 vs 重来"的判别面）─────────────────────
     *
     * MEASURED（2026-10-06，两种合法需求打起来的那一格）：
     *   · t5 的臂 5：**重派发**（任务回 pending、换 attempt）必须开一个**新窗口** ——
     *     否则一个刚开工的成员会被读成"等了 30 分钟"；
     *   · t3 的 V3-2：**换代**（status ⇒ kickTeam 给闲成员换 capability）必须
     *     **继承**窗口 —— 否则探活永远在"第一次"，静默成员永不报警。
     * 两者都对，区别只在"任务是不是真的重来了"。
     *
     * ⇒ 判别面用 `attempt` 计数：`beginTaskAttempt` 每次都会 `attempt += 1`，
     *   **重来一定跳号**；而 kickTeam 给已在等待的成员补一次派发时，那一代数与
     *   窗口记的相同 ⇒ 判为**连续**，继承窗口。
     *   两个方向都在夹具里各有一条臂（clock-dev 的臂 5 / 本文件的 V3-2 臂）。
     */
    attempt: number;
}
export declare function waitWindowKey(teamId: string, taskId: string, memberName: string): string;
export declare function putWaitWindow(key: string, window: WaitWindow): void;
export declare function forgetWaitWindow(teamId: string, taskId: string): void;
export declare function putWaitRecord(record: WaitRecord): void;
export declare function observeMemberActivity(ctx: Context, memberId: string, attemptId: string | undefined, now: number): boolean;
export declare function sessionOutputKey(session: unknown): string | undefined;
export declare function teamWaitObservations(team: TeamState, now: number, event: string): Record<string, unknown>[];
export declare function waitObservationFor(teamId: string, taskId: string, attemptId: string | undefined, now: number, memberName: string | undefined, 
/**
 * ★ 这一次求值是不是**一次探活**（见 {@link PROBE_EVENTS}）。
 *   它决定窗口的探活戳要不要在这一次交接里推进 —— 换代不是探活。
 */
event: string): Record<string, unknown> | undefined;
export declare function auditGateRequires(point: GatePoint, context: unknown): import("../../gates/requires.ts").RequiresAudit;
export declare function inputSurfaceSchema(): {
    type: "object";
    additionalProperties: false;
    properties: {
        checked: {
            type: "number";
        };
        incomplete: {
            type: "number";
        };
        skipped: {
            type: "number";
        };
        missing: {
            type: "array";
            items: {
                type: "string";
            };
        };
    };
};
export declare function runtimeGatesSchema(): {
    type: "json";
};
export declare function diagnosticFields(which: {
    inputSurface?: boolean;
    runtimeGates?: boolean;
    dispatchInputSurface?: boolean;
    completionInputSurface?: boolean;
}): Record<string, unknown>;
export declare function inputSurfaceOf(point: GatePoint, context: unknown): {
    checked: number;
    incomplete: number;
    skipped: number;
    missing: string[];
} | undefined;
export interface FrictionCapture {
    /** 判据位置（`contract` / `dispatch` / …）。 */
    point: string;
    /** 拒绝的原话（判据说的那一句）。 */
    message: string;
    /** ① 判据读到的那一份 ctx —— **结构化快照**，不是引用。 */
    context: unknown;
    /** ③ 机制状态：这一轮输入面核对结论 + 判据裁决。 */
    mechanismState: unknown;
    /** 会话（用来取事件定位）—— 拿不到 ⇒ `eventRefs` 缺席，并在 `unknown` 里写明。 */
    session?: unknown;
    taskId?: string;
    teamId?: string;
    /** 工具名（台账 `scene.trigger.tool`）。 */
    tool?: string;
    /**
     * ★★ 这个团队自己的 `stateRoot`（`workspaceOf(caller)` + stateDir）。
     *   **必须由调用方给**，不许用进程级单值 —— 见 `recordFriction` 里那段实测。
     */
    stateRoot?: string;
    /** 这条调用路径上读到的**未能测量**原文；缺席表示这一轮不是"没能测量"。 */
    couldNotObserve?: readonly string[];
    /**
     * ★ t23：记这条卡点时，本进程持有的 build 与盘上是否一致。
     *   缺席 ⇒ 由 `recordFriction` 现读一次（生产路径不必显式传）。
     */
    moduleFreshness?: ModuleFreshness;
    /**
     * ── ★★★ t91：这条卡点是【自动记录】的还是**人**记的 ─────────────────────────────
     *
     * MEASURED（t91 实测当前台账）：209 条里 **165 条是自动记录的拒绝**
     * （`update_task rejected…` / `create_task rejected…`），而它们**没有 resolution 是设计如此** ——
     * 自动记录发生在"判据拒绝那一下"，那时没有任何人做过决定。
     *
     * ★★ 而分诊器此前把它们算进「台账待回填」⇒ 那个数字是 **174**，
     *   而真正需要人看的是 **9**（人工记录且没有 state）。
     *   ⇒ 一个读数把两类东西算成同一类：**"不需要回填"与"还没回填"在它眼里同形。**
     *
     * ── ★ 为什么它是【调用方显式声明】的，而不是在这里猜 ──────────────────────────
     *
     * 本条的唯一调用方是拒绝路径（`throwWithSurface` 那两级），那里**知道**
     * 自己是不是一次自动拒绝。⇒ 由它声明；而 `recordFriction` **不替它猜** ——
     * 猜错的后果是单向的：**它会把人工记录算成"不需要回填"**，
     * 而那正是本任务要消掉的那个误导（只是方向反过来）。
     *
     * ★ 缺省 = 人工记录：一个"忘了声明"的自动条目会落回待回填（**显眼**），
     *   而不会伪装成"不需要人管"（**隐形**）。⇒ 错的那一侧选可见的那一侧。
     */
    auto?: FrictionAutoOrigin;
    /**
     * ── ★★★ C1：这一次拒绝之后，任务**有没有继续往下走** ──────────────────────────
     *
     * 用户裁定：卡点 = **任务停下来了**（`docs/PENDING-FRICTION-REFORM.md` §0）。
     * ⇒ 判据是机械的：**同一个 `(taskId, gateId)` 被同一个判据拒 ≥2 次**。
     *
     * ★ 「1 次」是正常的"填错了改一下"（实测那 207 条判据拒绝日志正是这一类）；
     *   「2 次」说明它卡在同一个地方了 ⇒ 任务**真的停住**。
     *
     * ★★ 为什么由**调用方**给，而不是在 `recordFriction` 里现读一次任务：
     *   与 `stateRoot` 同一条纪律 —— 调用方手里本来就有那份 `team.json`
     *   （而在锁里），再读一次既慢又会与它正在写的那一份**不同源**。
     *   ★ 缺席 ⇒ 按 `trying` 处理（**不假设它停了**）—— 错的那一侧选"还没停"：
     *     多记一条 rejection 不会误导人，少记一条真卡点才会。
     */
    stall?: StallObservation;
}
/**
 * 一个卡点的救解读数。
 *
 * ★ 它与 `resolution` **不同轴**，所以**并列**在记录上，而不是塞进 `resolution`：
 *     `resolution` —— 回答「**这条记录**是怎么被处置的」（台账的动作：
 *                      `state` / `fix` / `pool` / `leaderRuling`）
 *     `rescue`     —— 回答「**那个阻塞**是我们自己解掉的、还是解不掉的」
 *                      （救援的动作，与"台账写没写"无关）
 *   ★ 合成一格会让"没人回填台账"与"没人解过这个卡点"同形 —— 而它们的补救
 *     动作相反：前者要人补一个 `state`，后者要人去**解**，或如实上报。
 *
 * ★★ 而 `solvedBy` / `howSolved` **只在 `solved` 时在场** —— 与 C1 的 `whyPool`
 *   同一条纪律：一个没有被解掉的卡点**没有**"是谁解的"要交代，
 *   于是"缺席"与"写了一句空的"必须不同形。
 */
/**
 * ── ★★★ C2：一个**真卡点**（C1 的 `stalled`）后来怎么了 ──────────────────────────
 *
 * 用户的原话（`docs/PENDING-FRICTION-REFORM.md` §0）：
 *
 * > 「1. 如果卡点阻塞了任务，需要主会话**直接救援**，把这个阻塞解掉。
 * >   2. 如果不阻塞任务，其实不算卡点。」
 *
 * ⇒ 一句话：**卡点的默认归宿是"我们自己解掉它"，而不是"上报给人"**。
 *   上报是**例外**，而它必须是**说得出理由**的那一种。
 *
 * ── ★★ 为什么是三态，而不是一个布尔 ────────────────────────────────────────────
 *
 * 实测（同一份文档 §1）：**214 条记录被默认写进了 `pool: 'escalate'`** ——
 * 它们把"本来不需要人做的事"推给了人。而它们的成因是**缺省值**：
 * 一条记录若没有人为它写处置，读起来就落进了"要上报"。
 *
 * ⇒ 若只有 `solved` / `cannot-solve` 两态，"还没有人去试过"就**无处可放**，
 *   于是它必然被并进某一态。并进 `solved` 是**谎报**（没人解过，而它读起来像解了）；
 *   并进 `cannot-solve` 是**把 214 条请回来**（没人试过就上报给人）。
 *   ⇒ 所以第三态 `trying` 是**必须**的，而不是三种里可选的一种。
 *   ★ 而它与 C1 的 `trying` **是同一条生命周期上的同一个意思**（"还在自己解"），
 *     不是一条并行的生命周期 —— 见本文件 `TaskStall` 与 `rescueFromStall`。
 *
 * ★★ 三态**必须不同形**，且"缺席"是**第四种**形状：缺席 = 没有 rescue 读数
 *    （那与 `trying` 不同形：`trying` 是"有人看过、判定还在自己解"）。
 */
export type RescueState = 'solved' | 'cannot-solve' | 'trying';
/**
 * 三态的**完整名单**（供"读不出来 ⇒ 不猜"的读取端复用）。
 *
 * ★ 明写成一列，而不是散在各处的 `=== 'solved' || === 'trying'` ——
 *   两处各写一遍，就会在加第四态时于其中一处漏掉（本仓反复记账的形态）。
 */
export declare const RESCUE_STATES: readonly RescueState[];
/**
 * 一个卡点的救解读数。
 *
 * ★ 它与 `resolution` **不同轴**，所以**并列**在记录上，而不是塞进 `resolution`：
 *     `resolution` —— 回答「**这条记录**是怎么被处置的」（台账的动作：
 *                      `state` / `fix` / `pool` / `leaderRuling`）
 *     `rescue`     —— 回答「**那个阻塞**是我们自己解掉的、还是解不掉的」
 *                      （救援的动作，与"台账写没写"无关）
 *   ★ 合成一格会让"没人回填台账"与"没人解过这个卡点"同形 —— 而它们的补救
 *     动作相反：前者要人补一个 `state`，后者要人去**解**，或如实上报。
 *
 * ★★ 而 `solvedBy` / `howSolved` **只在 `solved` 时在场** —— 与 C1 的 `whyPool`
 *   同一条纪律：一个没有被解掉的卡点**没有**"是谁解的"要交代，
 *   于是"缺席"与"写了一句空的"必须不同形。
 */
export interface FrictionRescue {
    /** ★ 三态本体。读不出来 ⇒ 别猜（见 {@link rescueStateOf}）。 */
    state: RescueState;
    /**
     * ★ 解掉它的是谁（成员名 / `main-session` / …）。
     *   只在 `solved` 时在场 —— ★ 且 `solved` 时**必须**在场（见
     *   {@link missingRescueEvidence}：缺它就是"有人说解了，而说不出是谁解的"）。
     */
    solvedBy?: string;
    /**
     * ★ **怎么**解掉的 —— 而这一格是"下次遇到同一个坑"时唯一可复用的东西
     *   （文档 §0：「经验 = 同一个坑被踩出来的次数」）。只在 `solved` 时在场。
     */
    howSolved?: string;
    /**
     * ★ **为什么解不掉** —— 只在 `cannot-solve` 时在场，且那时**必须**在场。
     *
     * ★★ 它是本三态里**最要紧**的一格：`cannot-solve` 是**唯一**会把人请进来的那一态
     *   （见 {@link poolForRescue}），而"把人请进来"这个动作必须**说出理由** ——
     *   否则上报池又会变成 214 条那样的默认归宿。
     *   ★ 这也是三态**不同形**的落点：`solved` 有"solved 那两格"，
     *     `cannot-solve` 有"为什么解不掉"这一格，`trying` **两样都没有**。
     */
    whyCannotSolve?: string;
}
/**
 * 从一条台账记录里读出救解三态 —— ★ **读不出来 ⇒ `undefined`，不猜**。
 *
 * ★★ 为什么**不**把缺席当 `trying`：缺席是"这条记录没有 rescue 读数"，
 *   而 `trying` 是"有人看过、判定还在自己解"。把前者读成后者会让
 *   **"没人标注过"伪装成"有人管着"** —— 本仓记账的正是这一形态
 *   （`frictions-html.mjs` 的 `statusOf` 对 `state` 做的正是同一件事）。
 *
 * ★ 而它**只认** {@link RESCUE_STATES} 里的取值：一个不认识的字符串
 *   （比如有人写了 `'fixed'`）⇒ `undefined`，与缺席同形 —— 而不是被猜成
 *   最接近的那一态（猜错的方向必然是"把要人管的读成不用管"）。
 */
export declare function rescueStateOf(record: {
    rescue?: {
        state?: unknown;
    };
} | undefined): RescueState | undefined;
/**
 * ── ★★★ C2：从 C1 的 `stall` 读数给出**缺省救援读数** ────────────────────────────
 *
 * ★ 这里**不新建**一条生命周期：它把 C1 已经算出来的 `stall` 当作**唯一输入**，
 *   产出一条 `trying` 的缺省 rescue —— 也就是"**还没有人去救过它**"。
 *
 * ── ★★ 为什么缺省是 `trying`，而不是从 `stalled` 推出 `cannot-solve` ─────────────
 *
 * 契约逐字：「`stalled` 是**什么可能变成** `solved` 或 `cannot-solve`；
 *   **不要**发明一条并行的生命周期」。
 *
 * ⇒ 救援三态回答的是「**有人去救了吗、救成了吗**」，而"任务停没停"是**另一个问题**：
 *   一个任务可以停住而**还没有任何人**去救它。那正是 `trying`。
 *   ★ 若把 `stalled` 直接落成 `cannot-solve`，那 214 条会立刻回到上报池 ——
 *     本任务要消掉的缺陷换个入口就回来了。
 *   ★ 而若把 `stalled` 落成 `solved`，那是**谎报**（没人解过，而它读起来像解了）。
 *
 * ★★ 所以本函数**故意不读 `stall.state` 去分派** —— 因为 C1 的两态在这里
 *   **都不足以**推出 `solved` 或 `cannot-solve`（那两态要一次**真实的救援**才写得出来）。
 *   它唯一的用途是：给"被判据拒过、或从未被拒"的任务一个**显式的、可断言的**
 *   缺省读数，好让读取端不必各自 `?? 'trying'`（四处各写一遍就是四处会分叉）。
 *
 * ★ 而 `stall` **在场/缺席**这个差别**不**在这里丢掉：它由 `noteStall` / `clearStall`
 *   管着（C1 已钉），而 `class` / `resolution.blocking` 已经把它落进记录。
 *   ⇒ 本函数不重复编码那件事，也不假装它读了。
 */
export declare function defaultRescueForStall(stall: TaskStall | undefined): FrictionRescue;
/**
 * ── ★★★ C2：**只有** `cannot-solve` 进"上报给人"的池子 ──────────────────────────
 *
 * 用户的原话：卡点的默认归宿是**自己解掉**；上报是例外。
 * 而实测的现状是反过来的 —— 214 条被默认推进了 `escalate`。
 *
 * ★ 判据是**机械的**（不是措辞判断）：池子由**救援三态**决定，一个函数，一处：
 *
 *     `solved`       ⇒ `self` —— 已经解掉了。★ 它**不进上报池**，而且它
 *                      **也不再是待办**（见 `actionForFriction` 的 no-action 分支）。
 *     `trying`       ⇒ `self` —— 还在自己解。★ 这是**默认**，也是绝大多数。
 *     `cannot-solve` ⇒ `escalate` —— **只有它**。
 *     `undefined`（没有 rescue 读数）⇒ ★ 这里**不猜**
 *
 * ── ★★ 为什么"没有 rescue 读数"**不**落 `escalate` ────────────────────────────────
 *
 * 那正是 214 条的成因：**缺省值**把"还没人标注过"读成了"要上报给人"。
 * ★ 而反过来落 `self` 也不是猜 —— 它**就是**用户裁定的默认（"默认目标是自己解"）。
 *   ⇒ 缺省落 `self` 是**按裁定取默认值**，而不是从缺数据里推断事实。
 *   ★ 而"这条有没有 rescue 读数"这件事**另外可见**（`rescueStateOf` 返回
 *     `undefined`，HTML 与分诊器都把它单独报出来）—— 于是"没人标注过"不会
 *     被藏起来，只是它不再自动等于"要人去管"。
 */
export declare function poolForRescue(state: RescueState | undefined): 'self' | 'escalate';
/**
 * ── ★★★ C2：三态**必须不同形** —— 这是"缺一即红"的那条判据 ──────────────────────
 *
 * 契约逐字：「The three rescue states are distinct in **shape**」。
 *
 * ★ 而"形状"不是措辞：一个把三态都写成 `{ state }` 的实现里，
 *   `solved` 与 `cannot-solve` 只有**一个字符串**不同 —— 于是读取端要判断
 *   "这条到底解没解掉"就**只能靠比那个字符串**，而那是代理读数。
 *
 * ⇒ 形状判据（可机械核，且**定向突变**打得红）：
 *
 *   `solved`       ⇒ 必须带 `solvedBy` **且** `howSolved`（谁解的 + 怎么解的）
 *   `cannot-solve` ⇒ 必须带 `whyCannotSolve`，且**不许**带 `solvedBy` / `howSolved`
 *   `trying`       ⇒ ★ 两者**都缺席**（没有人解过、也还没放弃）
 *
 * ★ 于是"它解掉了"这句话**在形状上**就与"它解不掉"不同：
 *   前者有"solved"那两格，后者有"为什么解不掉"那一格。这也是"缺一即红"的落点 ——
 *   一个写了 `state: 'solved'` 而没说**谁**解、**怎么**解的记录，
 *   与"有人声称它解了"同形（README：未检验的声称与猜测同形）。
 */
export declare function missingRescueEvidence(rescue: FrictionRescue | undefined): string[];
/**
 * 自动记录的**来源**。★ 它不是一个布尔 —— 布尔只回答"是不是自动的"，
 * 而读台账的人接下来要问的是「**是哪条判据**把它拒了」。
 */
export interface FrictionAutoOrigin {
    /** 触发这条记录的工具（`agent_teams_update_task` / …）。 */
    tool: string;
    /** 卡点位置（`completion` / `dispatch` / `contract` / …）。 */
    point: string;
    /**
     * ★ 拒绝原文里的**判据 id**（`completion.backtest` 那一类），读得出来时才写。
     *   读不出来 ⇒ 缺席（**不猜**：编一个 id 会让"这条是谁拒的"变成一条假事实）。
     */
    gate?: string;
}
/**
 * ── ★ 从拒绝原文里读出【是哪条判据】拒的 ────────────────────────────────────────
 *
 * 拒绝原文里判据 id 的形态是 `[… ]`（实测：`update_task rejected: [dispatch.changed-paths] "…"`）。
 * ★ 读不出来 ⇒ `undefined`（**不猜**）—— 编一个 id 会让"这条是谁拒的"变成一条**假事实**，
 *   而假的归因比没有归因坏：读的人会照着它去查那条判据。
 */
export declare function gateIdFromMessage(message: string): string | undefined;
export declare function toReplayableSnapshot(value: unknown, depth?: number, seen?: WeakSet<object>): unknown;
/**
 * ── ★★★ 重放：把记录里的 ctx 还原成【能真的跑】的那一份（t79）────────────────────
 *
 * ── 它修的是什么失效（MEASURED，t69 报、t79 定位）──────────────────────────────
 *
 * `gate-friction-capture` 臂 4 自称「记录 vs 日志的分水岭」，而它红着：
 *
 *     · 记录里写的是 `[completion.mutation]`
 *     · 而重放得到的是 `[completion.verify-rerun]`
 *
 * ★ 根因（本任务实测，比"缺一格"更精确）：
 *
 *   `toReplayableSnapshot` 把**每一个函数**序列化成 `{ __absent: 'function' }`
 *   —— 而那是**忠实**的：函数确实进不了 JSON。实测记录里 8 个注入点是：
 *
 *       loadKindRequirements · loadRules · execVerifyCommand · runTestOnRevision
 *       readFile · runTest · scanDirs · （killerSuites 是数组，留下来了）
 *
 *   ⇒ 于是重放时的 ctx 里，那些位置上是**对象**而不是函数。
 *   ⇒ 而 `loadKindRequirementsOfHost` 判的是 `typeof ctx.loadKindRequirements === 'function'`
 *     ⇒ 它读到 `absent` ⇒ **kind 表不可用** ⇒ `mutation.appliesTo` 返回 `false`
 *       ⇒ ★ **门不说话（silently skipped）** ⇒ 裁决落到另一条分支上。
 *
 * ── ★★ 为什么"把缺什么记进记录"（②）不够 ──────────────────────────────────────
 *
 *   ★ 它**已经**记了：`{ __absent: 'function' }` 就是"这一格是个函数，而它没被带来"。
 *   ⇒ 而它没用：记录是诚实的，**撒谎的是重放** —— 重放拿着一个它兑现不了的
 *     ctx 照常跑，然后交出一个**属于另一条分支**的结论，而那个结论看起来完全正常。
 *
 * ⇒ 所以修法必须是 ①：**重放时把那些函数重新注入**（从宿主拿，而不是从 JSON 拿）。
 *   ★ 而这正是本函数做的事。
 *
 * ── 它怎么工作 ────────────────────────────────────────────────────────────────
 *
 * 把记录里的快照与一份**注入表**合并：
 *   · 注入表里有那一格的函数 ⇒ 用**宿主的**实现（与生产同形）
 *   · 注入表里没有         ⇒ ★ **如实标成不可兑现**，而不是留一个 `{__absent}` 让它
 *     在判据里被误读成"一个对象"（那正是"缺 loader 时四条门一起沉默"的成因）
 *
 * ★ 而"注入表里没有"这一态**必须与"注入成功"不同形**：
 *   前者的补救动作是"去把那一格接上"，后者是"无"（见 `replayCtx().unreplayable`）。
 */
export declare function rehydrateReplayCtx(snapshot: unknown, injections: Record<string, unknown>): {
    ctx: Record<string, unknown>;
    injected: string[];
    unreplayable: string[];
};
export declare function sessionEventRefs(session: unknown): {
    sessionId?: string;
    eventIndices: number[];
} | undefined;
/**
 * ── ★★★ C1：这一次拒绝之后，任务**有没有继续往下走** ───────────────────────────
 *
 * 用户裁定（`docs/PENDING-FRICTION-REFORM.md` §0，逐字）：
 *   「卡点就是让任务停下来的地方」「如果不阻塞任务，其实不算卡点」。
 * ⇒ 判据是机械的：**同一个 `(taskId, gateId)` 被拒 ≥2 次 = 停住了**。
 *
 * ── ★★ 为什么"同一个判据"必须是键的一部分 ────────────────────────────────────
 *
 * 五个**不同**的判据各拒一次是**五件不同的事**（成员每次都在改，只是每次
 * 撞上另一条门）。把它们数成一个数字会让"每次都被不同的门拦"读成"卡在同一处"
 * —— 而那正好是本任务要消灭的那个合流（换成计数版本）。
 *
 * ── ★★ 为什么 N 是【可注入】的（本仓教训，逐字）───────────────────────────────
 *
 * `docs/PENDING-FRICTION-REFORM.md` §2：「`with-timeout` 那族缺陷连躲三次，
 * 根因都是『上限是硬编码常量，短测试复现不了』」⇒ N 必须能注入。
 * ★ 而注入的是**上限**，不是判据本身 —— 判据仍然只有一处实现。
 * ★ 注入口是环境变量（与 `restartEscapeHatchFromEnv` 同一形态：**明写的、可核的**），
 *   缺省 2（用户已确认）。★ 读不出数就**回落缺省**，而不是当成 0：
 *   一个坏值会让每一片拒绝都变成卡点（或一条都不变）。
 */
/**
 * ── ★★★ C1 的判据【搬了家】（t24）—— 而这里**只转交**，不留第二份实现 ────────────
 *
 * 本文件此前**自己实现**了 `observeStall` / `stallRepeatThreshold` /
 * `STALL_REPEAT_THRESHOLD` / `StallObservation`。它们搬去了 `src/types.ts` ——
 * 理由在那份长注释里（**判据层要用它，而本文件 import 了 `gates/index.ts`**，
 * ⇒ 判据要用它就只能复制或成环，两条都不可接受）。
 *
 * ── ★★ 为什么这里是 `export … from` 而不是 `import` + `export` ────────────────
 *
 * 两者在本文件里**读起来几乎一样**，而它们不是一回事：
 *   · `export { x } from './y'`  —— **纯转交**，本模块作用域里**没有** `x` 的绑定；
 *   · `import { x } …; export { x }` —— 多了一个**本地绑定**。
 *
 * ★ 而第一条路径还有一个更要紧的性质：它是**重导出**，读的人一眼看得出
 *   "这东西的真身在别处"。第二条长得像"它住在这里、只是从别处拿的"。
 *   ⇒ 本队反复记账的那条（**"声明的家"与"真身"必须同形**）在这里的落点是：
 *     谁将来在本文件里加第二个 `observeStall`，`export … from` 这种写法会当场
 *     报重复导出，而 `import` + `export` 不会那么明显地挡住他。
 *
 * ★★★ 而"**不许有第二份实现**"是一条**可断言**的性质，不是一句忠告：
 *   `scripts/gate-stall-leaf-home.test.mjs` 臂 3 扫全仓，断言
 *   "计数判据"这个词只在 `src/types.ts` 里被**实现**过一次。
 *
 * ── ★ 而 C1 的调用点**一个字都不用改** ─────────────────────────────────────────
 *
 * `src/tools/update-task.ts` import 的是 `'./shared/entities.ts'` 的那几个名字。
 * 重导出之后它们仍然从这里拿得到，且**类型与运行期绑定都不变**。
 * ⇒ 见 `scripts/gate-stall-leaf-home.test.mjs` 臂 1（搬家前后逐字同判）。
 */
export { STALL_REPEAT_THRESHOLD, stallRepeatThreshold, observeStall, } from '../../types.ts';
export type { StallObservation } from '../../types.ts';
/**
 * ── ★★★ C1：两类记录的判别面 ───────────────────────────────────────────────────
 *
 *   `rejection` —— 一条**事件**：判据拒了一下，而任务**继续走了**。不是卡点。
 *   `blocker`   —— 一条**状态**：任务在这里**停住了**（同一个判据拒了 ≥N 次）。
 *
 * ★ 两者合流正是本轮要修的缺陷（实测 253 条里 207 条是判据拒绝日志，
 *   而真正让任务停下来的只有 21 条 —— 82% 不是卡点）。
 *
 * ★ 它**没有**跟着判据一起搬走：它描述的是**记录的分类**（`recordFriction` 的产物），
 *   而判据描述的是**任务停没停**。两件事不同轴 —— 判据层不需要知道记录分几类。
 *   ⇒ 搬到 types.ts 会让判据层多背一个与它无关的概念（而"多背一个"正是
 *     那条叶子性质最容易被弄脏的方式）。
 */
export type FrictionRecordClass = 'rejection' | 'blocker';
/**
 * `rejection` 记录的标题前缀。
 *
 * ★ 它是**人**读那一份台账时唯一的判别面（`frictions-html`）——
 *   而机读那一份用 `class` 字段，不靠这个前缀（代理读数会随措辞漂）。
 */
export declare const REJECTION_TITLE_PREFIX = "[rejection \u2014 not a blocker] ";
/**
 * ── ★★★ C1：把这一次拒绝的读数【落进任务】，好让下一次拒绝能跟它比 ────────────────
 *
 * ★ 这是判据成立的全部理由：「这次拒绝之后，任务有没有继续往下走」这句话
 *   在**一次**拒绝的那一下无从判断 —— 唯一能回答它的是**下一次拒绝**
 *   （成员改字段再报 ⇒ 下一次不拒了 ⇒ 任务走了；同样的拒绝又来一次 ⇒ 停了）。
 *   ⇒ 所以判据必须是**跨调用**的，而跨调用就必须落盘。
 *
 * ── ★ 为什么改的是【同一格】而不是追加一条历史 ────────────────────────────────
 *
 * `stall` 回答的是"**现在**它停没停"，而不是"它历史上被拒过几次"。
 * 一个持续增长的数组会让读取端必须自己算"最近连续了几次" ——
 * 而那段算逻辑一旦在读取端出现第二份，两处就会分叉（本仓反复记账的形态）。
 *
 * ── ★★ 而【放行】必须清掉它 ────────────────────────────────────────────────────
 *
 * 这是本函数最容易写错的一格：若一条记录**已经**是 `stalled` 而任务随后被放行了，
 * 却**不**清掉它，那么下一次拒绝会读到 `count = 3 ≥ 2` ⇒ **第一次**拒绝就被
 * 判成卡点。⇒ 于是"每个任务最终都会变成卡点"，而那正是本任务要消灭的那个
 * 「把 82% 的事件算成卡点」的**计数版本**。
 * ⇒ 所以 {@link clearStall} 与 {@link noteStall} 是**成对的**，各自有调用点。
 */
export declare function noteStall(task: TeamTask, point: string, gate: string | undefined, now: number): StallObservation;
/**
 * 放行 ⇒ 忘掉那条 stall。
 *
 * ★ 与 {@link noteStall} 成对：见那里的长注释（不清会让下一次的**第一次**拒绝
 *   就被判成卡点）。
 * ★ 只在**真的有一条**时才动 `updatedAt` —— 否则每一次放行都会让任务"看起来
 *   刚被改过"，而那会让"它什么时候真的动过"这条读数失去分辨力。
 */
export declare function clearStall(task: TeamTask): void;
export declare function recordFriction(capture: FrictionCapture): Promise<string | undefined>;
export declare function evaluateRuntimeGates(ctx: Context, event: string, context: unknown, clock?: () => number): Promise<JsonValue | undefined>;
export declare function rejectOnContractGates(ctx: Context, context: Record<string, unknown>, what: string, 
/** ★ t22：这个团队自己的 stateRoot（台账落点）。**不许用进程级单值**，见 recordFriction。 */
stateRoot: string, inject?: Record<string, unknown>): Promise<{
    input_surface: ReturnType<typeof inputSurfaceOf>;
} | undefined>;
export declare function throwWithSurface(message: string, surface: ReturnType<typeof inputSurfaceOf>, 
/**
 * ★★ 这一次拒绝属于**哪个位置** —— 决定结论在工具结果上落到**哪个字段名**（t4 修）。
 *
 * MEASURED（2026-10-06，verifier5 的臂 1/7 复跑时暴露）：
 *   成功路径上，一次 `update_task` 的两个位置**各挂各的**
 *   （`dispatch_input_surface` / `completion_input_surface`）—— 那是刻意的，
 *   因为"哪一个位置缺哪一格"必须读得出来。
 *   而**拒绝路径**当时只有一格泛用的 `input_surface` ⇒ 同一个位置在两条路径上
 *   **字段名不同形**。读者按位置的名字去找（`dispatch_input_surface`）会读不到，
 *   而"读不到"与"这个位置没判据"在断言层面同形 —— 正是本任务要消灭的那件事。
 *
 * ⇒ 现在拒绝也带位置：`dispatch` ⇒ `dispatch_input_surface`，`completion` ⇒
 *   `completion_input_surface`，其余位置（contract / delivery 各只有一个入口）
 *   仍用泛用的 `input_surface`（与它们成功路径上的字段名一致）。
 */
field?: string, 
/**
 * ── ★★★ t5：这次拒绝是**哪一种** —— 「判据说不出」的原文，缺席即"发现了问题"──────
 *
 * MEASURED（t5）：契约位置的拒绝有两种成因，而**它们的补救动作相反**：
 *
 *     `unmeasured`（本参数在场）  ⇒ 判据**没能测量** ⇒ 去补它缺的那一格输入
 *     `blockers`  （本参数缺席）  ⇒ 判据**发现了问题** ⇒ 去改契约
 *
 * ★ 为什么它必须走到**抛出侧**而不是留在返回值上：本函数是被**抛出**路径调用的，
 *   而抛出之后调用方拿到的只有这个异常 —— 于是"哪一种拒绝"如果不随异常走，
 *   它就在**唯一真正被读到的那个出口**上缺席。
 * ★★ 而它**不改变措辞**（`message` 已经把两种成因分开写了），它补的是**结构化**那一份：
 *   读的人不必去正则匹配一句英文，就能分出"没能测量"与"发现问题"。
 *   ★ 与 `field` 那条注释同一条纪律：**同一个事实必须在两条路径上同形**。
 * ★ 传 `undefined` ⇒ 字段**不出现**（而不是出现一个空串）。缺席与"空"必须不同形。
 */
unmeasured?: string): never;
/**
 * ★ t5：拒绝的**第三种**成因在结构化面上的字段名 —— "判据没能测量"。
 *
 * ★ 为什么与 `INPUT_SURFACE_PROPERTY` **分列**（不合流）：
 *   `inputSurface` 说的是"**调用方**少交了一格"（接线缺陷），
 *   本字段说的是"**判据**拿到齐的输入仍然说不出"（判据的能力边界）。
 *   两者的补救动作相反 ⇒ 合成一格就是本队记账最久的那个合流。
 */
export declare const CONTRACT_UNMEASURED_PROPERTY = "agentTeamsContractUnmeasured";
export declare const INPUT_SURFACE_PROPERTY = "agentTeamsInputSurface";
export declare const INPUT_SURFACE_FIELD_PROPERTY = "agentTeamsInputSurfaceField";
/**
 * 读回"哪一种拒绝"—— 与 {@link inputSurfaceFieldOf} 同一形状的读数装置。
 * ★ 属性缺席 ⇒ `undefined`（**不是**空串）：缺席与"空"必须不同形。
 */
export declare function contractUnmeasuredOf(error: unknown): string | undefined;
export declare function inputSurfaceFieldOf(error: unknown): string;
export declare function inputSurfaceFromThrown(error: unknown): ReturnType<typeof inputSurfaceOf>;
export type MemberConvergenceObservation = {
    name: string;
    /** ★ 与判据 `MemberConvergenceInput['state']` 同一套取值（含 `never-spawned`）。 */
    state: 'idle' | 'reported' | 'working' | 'failed' | 'never-spawned' | 'unknown';
    spoke?: boolean;
};
/**
 * ── 观察面之外的旁路：被略过的成员（t46）──────────────────────────────────────
 *
 * ★ 为什么需要它：驱动不在场时，那个成员**不可观察** —— 它可能做完了、也可能
 *   崩在半路，而这两件事在没有它自己那句发言记录时**无从分辨**。
 *   此前的写法是 `return undefined`（把整份观察面扔掉），于是：
 *     · 一个做完了的成员让**整队**失去观察 ⇒ 交付位置恒 unmeasured ⇒ 恒拒绝；
 *     · 而 `status` 的渲染只印 blockers ⇒ 用户看到的是 `Delivery: blocked ()`
 *       （空括号）—— 一句看不出成因的拒绝。
 *
 * ★ 正确的分界（本文件反复那条纪律）：**可判定的事实不得写成「没能测量」**。
 *   `id === ''`（从未起来）是**可判定的事实** ⇒ 它仍然进观察面，由判据 blocked。
 *   驱动不在 ≠ 从未起来：它是"这一维这次不可用" ⇒ 该成员不进入观察面，
 *   **但必须留名**，否则"略过一个不可观察的成员"与"这个队没有成员"同形。
 */
export interface MemberConvergenceBypass {
    readonly name: string;
    /** 为什么它被略过。 */
    readonly reason: 'driver-absent';
}
/** `observeMemberConvergence` 的完整返回：观察面 + 被略过的成员。 */
export interface MemberConvergenceReading {
    readonly observed: readonly MemberConvergenceObservation[];
    readonly bypassed: readonly MemberConvergenceBypass[];
}
export declare function observedSpoke(session: unknown): boolean | undefined;
export declare function observeMemberConvergence(ctx: Context, team: TeamState): MemberConvergenceReading;
export declare function initializeProfileTeam(input: {
    ctx: Context;
    config: ToolsConfig;
    memberSelections: ReturnType<typeof installMemberSelectionRuntime>;
    captain: Agent;
    exec: ToolRunContext;
    stateRoot: string;
    teamName: string;
    teamId: string;
    profileName: string;
    inlinePlan?: import('../../profiles.ts').TeamProfileConfig;
    description?: string;
    staged: boolean;
}): Promise<{
    committed: true;
    state: TeamState;
}>;
export declare function parseFindings(value: unknown): ReviewFinding[] | undefined;
export declare function parseAcceptanceResults(value: unknown): AcceptanceResult[] | undefined;
export declare function parseCommandResults(value: unknown): CommandResult[] | undefined;
export declare function applyQualityFollowUp(team: TeamState, closed: TeamTask): {
    created: TeamTask[];
    escalated: boolean;
};
export declare function renderStatus(value: JsonValue): string;
/**
 * ── ★★ 重载的【排队】通道（t49）──────────────────────────────────────────────────
 *
 * ── 它修的是什么（用户实测的结构性矛盾，原话）──────────────────────────────────
 *
 *   「不管是我手动重启，还是调用最新的 restart 去重启，都需要等待团队成员的工作完成。
 *     我对这个插件的想法是，它需要尽可能把并发打满，尽可能去做快速迭代。
 *     也就是说，如果有团队成员在工作，就不可能进行手动重启或 restart。
 *     只要是跟 restart、重载相关的线，都会被阻塞。」
 *
 * ★ 那个矛盾的精确形状：
 *
 *     重载需要【无进行中工作】  ∧  并发干活 ⇒ 永远有进行中工作
 *     ⇒ 两者**结构上互斥** ⇒ 旧模块永远换不掉
 *
 * ★ 而 captain 的实测给了它两条硬证据：
 *   ① 调 `agent_teams_restart` ⇒ 拒：「2 task(s) are in progress」
 *   ② **用户手动重启两次**（PID 52994 → 54529 → 18909），而 `[deployment]` 仍报 stale
 *      ⇒ ★ **换进程 ≠ 换模块**（比 "reload ≠ restart" 更精确）
 *
 * ── 于是：被拒 ≠ 失败，而是**进入队列** ─────────────────────────────────────────
 *
 *   一次被拒的重载申请**不丢掉** —— 它变成「已申请」，并带来三件事：
 *     ① **不再派发新任务**（否则永远有新的工作在跑，闸门永远不满足）
 *     ② 当前在跑的**收口后自动重载**（不必让 captain 再调一次）
 *     ③ **能被 `status` 读到**（好让 captain 知道该不该继续派发）
 *
 * ── ★★ 三态不同形（本队反复学到的那条）──────────────────────────────────────────
 *
 *     `none`       —— 没有申请（重载仍走原闸门）
 *     `waiting`    —— 已申请，且**还等得到**（附「还要等哪些任务」）
 *     `stuck`      —— 已申请，但**等不到**（某个任务永不终态 ⇒ 要人工介入）
 *
 *   ★ 第三态为什么必须与第二态不同形：`waiting` 会自己收敛，`stuck` **不会**。
 *     把它们写成同一形状，读的人会一直等一个不会发生的事 ——
 *     而"等不到"与"还在等"在读数上同形，是本队记过的那条最贵的形态之一。
 *
 *   ★ 判定 `stuck` 的口径：**申请之后还有没有可能收敛**。
 *     一个任务的 status 若已经不可能再变（终态），它不该在等待名单里；
 *     而"等待名单非空、且其中某个任务**已经很久没有任何变化**"才是最可疑的信号。
 *     本实现用一条**可机械判定**的口径：等待名单里的任务若**不在当前任务表里**
 *     （被删了 / 从未存在）⇒ 它永远不会变成终态 ⇒ `stuck`。
 *
 *     ★ 为什么不用"超时"：超时需要一个时长阈值，而本队实测任务时长是
 *       **重尾分布**（最短 1.4 分钟、最长 767 分钟）⇒ 任何阈值都会误判。
 *       用户提的「预估时长后派发更短的」已被 captain 用 44 条真实数据否定，
 *       同一个理由在这里也成立：**不要给不可预测的东西设一个预测性的阈值**。
 */
export type RestartQueueState = {
    status: 'none';
} | {
    status: 'waiting';
    requestedAt: number;
    waitingOn: string[];
} | {
    status: 'stuck';
    requestedAt: number;
    waitingOn: string[];
    reason: string;
};
/** 此刻的排队状态（**纯函数**：只读入参，不读模块状态 —— 便于夹具直接构造三态）。 */
export declare function restartQueueState(input: {
    requestedAt?: number;
    waitingOn: readonly string[];
    /** 当前任务表里**存在**的任务 id（用来发现"等待一个不存在的任务"）。 */
    knownTaskIds: readonly string[];
    /** 当前仍在进行中的任务 id。 */
    inFlight: readonly string[];
}): RestartQueueState;
/** 记下一次申请（进程级）。 */
export declare function requestRestart(waitingOn: readonly string[], now: number): void;
/** 读当前的申请（`undefined` = 没申请过）。 */
export declare function pendingRestartRequest(): {
    at: number;
    waitingOn: string[];
} | undefined;
/** 消费掉申请（重载真的发生了，或申请被放弃）。 */
export declare function clearRestartRequest(): void;
/**
 * 用**当前的任务表**算出排队状态（`restartQueueState` 的薄封装）。
 *
 * ★ 与闸门同一条纪律：输入从**耐久态**来（调用方读 team），不从这个模块缓存。
 */
export declare function restartQueueFrom(tasks: ReadonlyArray<{
    id: string;
    status: string;
}>): RestartQueueState;
/** 一句人话（供工具结果与 status 读）。★ 三态措辞必须互不同形。 */
export declare function restartQueueMessage(state: RestartQueueState): string;
