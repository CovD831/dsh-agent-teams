/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-teams/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { AgentTeamsRuntime, ToolsConfig } from './tools/shared/entities.ts';
export { RESTART_ESCAPE_HATCH_ENV, applyQualityFollowUp, arbitrateRestart, arbitrateRestartWithEscape, moduleFreshness, 
/**
 * ★★ f-0026：新增的出口 —— 它们把"提交维"变成**可测的**：
 *   · `moduleFreshnessFrom` ⇒ 全部输入注入（纯数据变换，夹具能精确驱动两个时机）
 *   · `stampCommitOf`       ⇒ 「构建时的提交」这一格可被单独核对
 *   · `currentHead`         ⇒ 「当前 HEAD」可被单独核对
 * ★ 不导出它们，修法就只能靠"读 live 读数"去测 —— 而那正是 f-0027 记的
 *   「读错位置的出口」（命令行进程那次加载必然报 current，测不到任何东西）。
 */
moduleFreshnessFrom, stampCommitOf, currentHead, readStamp, moduleFreshnessMessage, restartArbitrationMessage, restartEscapeHatchFromEnv, } from './tools/shared/entities.ts';
export type { AgentTeamsRuntime, BaseRevisionResolution, ModuleFreshness, RestartArbitration, StagedPlanMutation, ToolsConfig, } from './tools/shared/entities.ts';
export { steerCaptainReport } from './members.ts';
/**
 * ── ★★ 工具边界：核对结论**挂在拒绝上也要出得来**（t3）───────────────────────────
 *
 * 四处里的三处（contract / dispatch / completion）走**异常路径**：一次被拒的
 * `create_task` / `update_task` / `amend_task` / `declare_delivery` 不返回结果对象，
 * 而拒绝**恰恰是最需要读到核对结论**的那一刻 —— 那里最容易合流的正是
 * "这个动作本身不合法"与"判据要的那一格调用方没接上"。
 *
 * ★ 做法：`throwWithSurface` 把结论挂成 `Error` 的一个自有属性（见它的长注释），
 *   本函数在**工具边界**把它原样搬进工具结果的 `input_surface` 字段。
 *
 * ── ★★ 三条纪律，每条都来自一次实测 ────────────────────────────────────────────
 *
 *   ① **只在"还没被搬运过"时搬运**（`INPUT_SURFACE_PROPERTY in error`）。
 *      MEASURED（本任务第一次跑真实入口就撞上）：`update_task` 一次调用**穿过两个
 *      位置**（dispatch 与 completion）。先拒绝的那个（dispatch）已经把结论挂在
 *      `error.input_surface` 上了，而**后**拒绝的那个（completion）再挂一次 ——
 *      于是 dispatch 那一份被**静默覆盖**，读出来的是 completion 的结论。
 *      那正是本队记账的第三种恒真写法（**读错位置的出口**）：字段在场、读得到、
 *      数值也对，只是它不是读者以为的那个位置报的。
 *      ⇒ 第一个报缺的位置赢。**不合并、不覆盖** —— 合并会让"哪一个位置缺哪一格"
 *        重新变得读不出来，而那是本任务存在的理由。
 *
 *   ② **失败结果仍然是一条失败结果**：本函数**不改变任何裁决**。抛出物**原样**
 *      继续抛出去（同一个对象，`instanceof` 与 `message` 都不变，调用方原有的
 *      错误处理一个字都不用改），只是它身上多了一个自有属性。
 *
 *   ③ **没有结论时行为逐字节不变**（连抛出的对象都不动）。
 *
 * ★ 为什么必须包在 `execute` 的外面，而不是在各工具里各 `try/catch` 一次：
 *   四处 → 五处 `catch` 就是五处会慢慢分叉的地方（而分叉之后，"哪一处带得出来结论"
 *   在断言层面同形 —— 这正是本任务要消灭的形状）。边界只有一处。
 *
 * ★ 副作用为零的证据：本函数只在 `error` 上**多挂一个自有属性**。不写盘、不记日志、
 *   不改控制流；`instanceof Error` 与 `message` 都逐字不变。
 *
 * ★ 类型上刻意用**结构化**的最小形状（而不是某个具体的 tool 泛型）：这样它既能包住
 *   `defineTool(...)` 的返回值，又不引入任何新的类型依赖。运行期它只是一次转发。
 */
/** Resolved plugin config consumed by the tools. */
/** Browser/UI mutations allowed while a plan is waiting for approval. */
/** Runtime bridge shared by model-facing tools and the Web staging surface. */
/** The caller agent, or a loud failure for non-agent callers. */
/** The captain's workspace directory (team state root parent). */
/**
 * ── ★ 判据层执行 verify 命令的执行器 ────────────────────────────────────────────
 *
 * 在队长的 workspace 里跑一条 verify 命令，返回真实退出码。
 * 这是整个修复里唯一做 I/O 的新增点，被注入进纯函数 `rerunVerifyCommands`，
 * 让 quality-gates.ts 保持零 I/O 的纪律（它自己的 verify 全套都在无 I/O 下跑）。
 *
 * ★ 超时：命令挂死时返回非零而不是让 update_task 永远不返回。125 是 shell
 * 惯用的"命令超时"退出码，与被测命令自己的退出码空间区分开。
 */
/**
 * ── ★ 判据的注入口径：I/O 在这一层，判据本身是纯数据变换 ────────────────────────
 *
 * MEASURED（2026-10-05，t7）：`registry.evaluate('completion', …)` 此前**只**注入
 * `execVerifyCommand`，于是三条新判据在生产路径上永远拿不到输入：
 *
 *     completion.mutation  ⇒ 永远 unmeasured（缺 readFile / runTest / writeFile）
 *     completion.backtest  ⇒ 永远 unmeasured（缺 baseline / coverage / 执行器）
 *     completion.r5        ⇒ 永远 skipped（缺 newTestFiles ⇒ appliesTo 为假）
 *
 * ⇒ 后果不是"少测了一点"，而是**每一次 completed 都会被拒**：一个永远无法测成的
 *   判据等于一道永远关着的门。补齐注入面才是修它 —— **绝不能靠放宽判据**。
 *
 * ★ 注入的边界（这一节的全部纪律）：
 *   · 判据不 import I/O；这里（tools.ts）是唯一做 I/O 的地方。
 *   · 拿不到证据时**不注入该字段**（而不是注入一个空值）—— 缺席 ⇒ 判据说
 *     "我没能测量"，那是诚实的；注入空值会让判据把"没数据"读成"测了是零"。
 */
/**
 * ★ 任务 → 它的隔离检出基准（worktree 的 `base`）。
 *
 * 为什么是【进程内】而不是写进 TeamTask：`base` 是【这一次派发】的属性，不是任务的
 * 持久契约的一部分；把它落进 team.json 会让一个派生事实变成需要维护的状态
 * （而它随时可以由 git 重算）。与 scheduler 的 `parkedAttempts` 同一形态。
 *
 * ★ 缺席 ⇒ 不注入 `parentRevision` / `baseline` ⇒ r5 与 backtest 诚实地说
 *   "我没能测量"。**不会**回退成 `HEAD` 或任何猜测出来的版本 —— 一个伪造的基准
 *   会让"在错误的基础上比较"读成"比较过了"。
 */
/** 派发时登记基准；判据层在完成时读它。 */
export declare function rememberWorktreeBase(taskId: string, base: string): void;
/** Captain work is immediate, not a durable scheduler lane: allow one unfinished takeover at a time. */
/** Stop every currently-resident member activation for one halted team.
 *
 * Interrupt requests only cancel the member's current model turn and retain its
 * activation. Draining the selected direct children is the stronger lifecycle
 * boundary: it waits for the activation handles to release, so a child cannot
 * keep executing after the captain-chat Stop control has reported success.
 */
export declare function haltTeamWork(input: {
    ctx: Context;
    stateRoot: string;
    teamId: string;
    captain: Agent;
    signal?: AbortSignal;
}): Promise<{
    teamName: string;
    cancelledTasks: number;
    alreadyHalted: boolean;
}>;
/** Web approval has no tool result in the captain's conversation. */
export declare function stagedPlanApprovedContext(teamName: string): string;
/** Context queued after the human rejects a staged plan. */
export declare function stagedPlanDiscardContext(teamName: string): string;
/** Model-facing continuation that turns the review UI back into a conversation. */
export declare function stagedPlanFeedbackContext(teamName: string): string;
/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
/**
 * ── ★ runtime 位置：每一条裁决的【运行记录】（进程内，跨步骤）───────────────────
 *
 * `runtime` 是【过程】的插入点，不是一步的裁决（契约 §5）：它的产物是"记录"，
 * 供控制台与交付时判读；它**不得拒绝任务**。本文件里它有一个统一出口
 * {@link recordRuntimeGates}，被派发、建任务、改契约、成员汇报、状态快照五处调用 ——
 * 于是"这个进程里这些事发生过"这件事，与判据层是同一份记录。
 *
 * ★ 为什么必须有个上限：这个 Map 是进程级状态，一次长会话里成员每次汇报都推进去
 *   一条。无上限的增长是一种"只在最长的那些会话里出现"的缺陷 —— 最难复现，也最难
 *   归因。保留最近 {@link RUNTIME_GATE_LOG_LIMIT} 条，够控制台与交付时判读。
 *
 * ★ 为什么不是"写进 team.json"：运行记录是【这一次运行】的属性，不是团队契约的一
 *   部分（与 `taskWorktreeBase` 同一形态）。落盘会让一个派生事实变成需要维护和
 *   迁移的状态。
 */
/**
 * ── ★★ 「本进程持有的模块是不是旧的」—— 一个**可检测、可上报**的读数（t23）────────
 *
 * ── 它修的是什么（MEASURED，本轮五次拦截）──────────────────────────────────────
 *
 * 本队今晚被同一个东西拦了 **5 次**（t14 / t17 / t19 / t22 / t23 开工），而每一次
 * 的**表面理由都不同**：
 *
 *     · dispatch.changed-paths 说"你虚报改动"
 *     · completion.backtest    说"基准不可得"
 *     · claim_task             说"依赖未满足"
 *
 * ⇒ 而真相只有一个：**进程加载的是构建前的模块**。
 *   ★ 形态：**一个机制级的失效，伪装成一条业务规则**。成员看到判据拒绝会去查代码、
 *     去查数据、去怀疑自己的申报 —— 而不是去重载。这个伪装是它最贵的地方：
 *     它把成本从"重载一次"转成了"每一轮都重新误诊一次"。
 *
 * ── 为什么 ESM 让这件事必然发生（机制级解释，不是现象描述）───────────────────────
 *
 * `import { f } from './state.ts'` 建立的是**命名绑定**，它在**模块求值时**建立，
 * 之后**永远指向同一个函数对象**。⇒ 盘上的 `.js` 被 `pnpm build` 覆盖之后，
 * 进程里那个函数**还是旧的** —— 因为函数的**闭包环境**也是旧的。
 *
 * ★ 所以"每次调用时求值"这句话**不精确**：函数体确实每次跑，但它**本身**是从旧模块
 *   实例拿来的。⇒ **任何静态 import 的东西都不会更新**，不只是 schema 类。
 *
 * ── 本读数回答什么、不回答什么（边界必须写清）──────────────────────────────────
 *
 *   回答：**该不该重载**（stamp 不一致 ⇒ 重载）。
 *   **不**回答：哪一段是旧的。
 *      （后者需要模块图内省，做不干净；而 5 次拦截里真正需要的判断是前者。）
 *   ★ 已知边界：即使 stamp 一致，也可能有段落是旧的（见上面对 ESM 的解释）。
 *     这一格**测不了** —— 把它写成边界，而不是假装覆盖了它（本队纪律）。
 *
 * ── ★ 三态，且「读不到」与「一致」必须不同形 ────────────────────────────────────
 *
 *   `unknown`     —— 读不到 stamp（还没 build / 文件被删 / 解析失败）⇒ **没能测量**
 *   `current`     —— 读到了，且与加载时一致
 *   `stale`       —— 读到了，且与加载时**不一致** ⇒ 明确报"请重载"
 *
 * ★ 把 `unknown` 读成 `current` 会让"我没能检查"伪装成"检查过了，是新的" ——
 *   而那正是本任务要消灭的那个形态的又一次出现。
 */
/** 构建产物的指纹文件（`scripts/git-artifacts.mjs` 写的那一份）。 */
/** 读盘上当前的 stamp 的 `output` 摘要；拿不到 ⇒ `undefined`（**不是**空串）。 */
/**
 * 插件根目录 —— 与 `STATE_DIR_FOR_BASE_PERSIST` 同一种做法（`__dirname` 的上两级）。
 *
 * ★ 为什么不用 `process.cwd()`：插件的产物位置与**用户的工作目录**无关，
 *   而 stamp 在插件的 `lib/` 里。用 cwd 会在"用户在别处起会话"时读错地方，
 *   而那会**静默**把 `unknown` 变成常态（于是这条读数永远不报）。
 */
/** 加载时记下的 output 摘要（**进程级、只在模块求值时写一次** —— 这正是被检测的对象）。 */
/**
 * 读一次**加载时**的 stamp。
 *
 * ★ 它必须**只做一次**：这个函数的返回值代表"这个进程当初加载的是什么"，
 *   而那不是每次调用都该重新问的问题 —— 重复读会把它变成"每次调用时的读数"，
 *   于是**它永远与盘上一致**，这条检测就恒为 `current`（本队记账的恒真写法）。
 */
/**
 * 这个进程持有的模块是新的还是旧的。
 *
 * ★ **不参与裁决**：它是部署状态的读数，判据不许因为它拒绝（先软后硬）。
 *   调用方把它挂在**记录**上（人读得到），而不是并进 `blockers`。
 */
/**
 * 一句人话（供工具记录与控制台读）。
 *
 * ★ 措辞必须**不用**业务语气：不能读起来像"你的申报有问题"。
 *   它要说的是"**这个进程该重载了**" —— 那正是它要消灭的那个伪装。
 */
/**
 * ── ★★ 附在【每一次拒绝】上的那一行（t37 / f-0027 的预防）───────────────────────
 *
 * 与 {@link moduleFreshnessMessage} 分开，只因为它要带一个**前缀**：拒绝信息里那一行
 * 必须一眼看出"它是关于**部署状态**的"，而不是关于这次调用本身。
 * ★ 而正文一律来自 `moduleFreshnessMessage()` ——（本函数**不重写**那三态措辞）：
 *   两处各写一遍就会分叉，而分叉之后"同一件事有两句话"在下游同形。
 *
 * ★ 前缀刻意**不带业务语气**：它不能读起来像"你的申报有问题"。它要说的是
 *   「**你正在依据的这个进程可能不是你以为的那个**」—— 那正是 f-0027 的形状。
 *
 * ★ 为什么放在 `throwWithSurface`（而不是每个调用点各加一次）：
 *   那是**唯一的**拒绝出口。放在那里 ⇒ 六处调用点自动都有，而不会出现
 *   "某几处记得加、另几处忘了"（本队记账的"逐格手接 ⇒ 第 6 次一定来"）。
 */
/**
 * ── ★★ 重载的【仲裁闸门】（t24 / D）──────────────────────────────────────────────
 *
 * ── 它是什么、不是什么（用户裁定的框架，原话）──────────────────────────────────
 *
 *   「我们在做代码修改的时候，应该已经跑过这种蓝绿判决了。所以最后在需要仲裁的时候，
 *     判决其实已经跑完了，只是需要进行仲裁。在这种情况下，**确实只需要检测任务情况
 *     就行了**。」
 *
 * ⇒ 它是**仲裁**，不是**状态检查**：
 *     · **不**重新验证"新代码对不对" —— 那是**蓝绿判决**（`pnpm verify exit=0`）
 *       已经给出结论的事。在这里重跑一遍会让"判决"有两个来源，而两个来源会分叉。
 *     · **只**回答一件事：**此刻重载会不会打断正在进行的工作**。
 *
 * ── 两个前置，缺一不可 ─────────────────────────────────────────────────────────
 *
 *   ① `verdict: 'passed'` —— 有一份【已经通过的判决】。它的**形状**是一个布尔，
 *      而不是"我这里再跑一次测试"：本函数**不做 I/O**，判决由调用方交进来。
 *   ② `tasks` 里**没有 `in_progress`** —— 判定 = 每条任务要么终态、要么未开工。
 *
 * ── ★ 为什么"无 in_progress"这个口径是对的（而不是"无未完成任务"）──────────────
 *
 *   `pending` / `claimed` 的任务**没有正在跑的成员**：前者还没开工，后者只是被认领。
 *   重载会 dispose 插件，但**不会**杀掉成员会话（它们是宿主的 subagent），
 *   而插件重新激活时会重新调度。
 *   ⇒ 把它们也算作"会被打断"，会让闸门在**任何有任务的团队**上恒不满足 ——
 *     而那是"闸门永不打开"，与"没有闸门"在无人值守下同效（都需要人来）。
 *
 *   ★ 而 `in_progress` 是**真的有工作在跑**：那一刻 dispose 会让它失去插件的记录面。
 *     这一格必须挡住。
 *
 * ── ★ 这个读数**不参与判据裁决**，但它**参与一个动作的准入** ─────────────────────
 *
 *   与 `moduleFreshness` 不同：那一个是纯诊断；本函数是**一次动作的闸门**。
 *   ⇒ 它必须能说"不"，而说"不"时必须说清**是哪一条前置不满足**（三态可读）。
 */
/**
 * 仲裁：这一刻能不能重载。
 *
 * ★ **纯函数、零 I/O** —— 与判据层同一条纪律（`docs/GATE-REGISTRY.md` §2 性质 1）。
 *   "判决跑过了吗"由调用方回答（它才是真的跑过的那个），"有没有工作在跑"由调用方
 *   从耐久态读出来。本函数只做**判定**。
 */
/**
 * 一句人话（供工具结果与控制台读）。
 *
 * ★ 三态措辞必须**互不同形**：说清"能不能"、以及"不能的是哪一条"。
 */
/**
 * ── ★ 逃生口（f-0021 的闭环）─────────────────────────────────────────────────────
 *
 * MEASURED（point-dev 与 integrator6 从相反方向独立得出）：
 *
 *     旧模块 ⇒ 任务开不了工 ⇒ 任务做不完 ⇒ 一直有"进行中工作"
 *           ⇒ 闸门（无进行中工作）永不满足 ⇒ 永远重载不了 ⇒ 旧模块永不被换掉
 *
 * ⇒ 这是一个**互相锁死的一对**，而它意味着：无人值守在**没有外部干预**时
 *   【证明性地】无法自行解锁（只有用户手动重启）。
 *
 * ★ 用户的裁定：闸门需要一个**逃生口** —— 在"整条链都冻住"时仍能重载。
 * ★ 而它的**边界**是一个显式的、可关的开关（下面这个环境变量），
 *   **不是**把闸门悄悄放宽：默认关闭，打开时才生效，且**每一次使用都被记录**。
 *
 * ★ 为什么用环境变量而不是一个参数：与 `AGENT_TEAMS_OBSERVE_GATES` 同一条纪律
 *   （见注册表 §3.5）—— 关掉/打开它不该需要改代码，而改代码会带来
 *   "漏了 build ⇒ 装的位置跑的是旧代码"那条窗口（本队实测过，而且今晚正是它）。
 */
/** 逃生口是不是开着（**只读到字面量 `1`**；空串/其它值一律 = 关）。 */
/**
 * 带逃生口的仲裁：**闸门不变，只在它关闭时说清"还有一条路"**。
 *
 * ★ 它的语义是刻意的：逃生口**不改变判定**（`allowed` 仍由 {@link arbitrateRestart}
 *   给出），它只是把"明知有工作在跑仍然重载"变成一次**显式的、被记录的动作**。
 *   ⇒ 于是"闸门挡住了"与"我用逃生口过去了"在读数上**不同形**。
 */
/** 记一条运行记录（供 {@link evaluateRuntimeGates} 与夹具共用）。 */
/** 运行记录的快照（控制台/夹具读它；返回副本，调用方改不动内部状态）。 */
export declare function runtimeGateLogSnapshot(): ReadonlyArray<{
    at: number;
    event: string;
    outcome: string;
}>;
/**
 * 等待记录的快照（控制台/夹具读它；返回**深**副本）。
 *
 * ★ 与 {@link runtimeGateLogSnapshot} 同形态，理由也同：进程级状态必须有只读出口，
 *   否则夹具只能通过"跑一次探活、看它说了什么"来间接推断内部状态 —— 而那正是
 *   最容易被夹具自己写错的一层（"我以为它在记录里"与"记录里真的有"同形）。
 */
export declare function waitRecordSnapshot(): ReadonlyArray<{
    teamId: string;
    taskId: string;
    memberName: string;
    attemptId: string;
    startedAt: number;
    lastActivityAt?: number;
    lastPollAt?: number;
    lastPolledActivityAt?: number;
    lastOutputKey?: string;
    activityCount: number;
}>;
/**
 * 等待**窗口**的快照（与 `waitRecordSnapshot` 同形态：进程级状态必须有只读出口）。
 *
 * ★ 它回答的是"这个任务这一次等待从哪里开始、上次何时被探活" —— 与记录表
 *   （"这一代读到过什么"）是**两个作用域**。夹具要分辨"换代没重置窗口"，
 *   唯一的办法就是把这两张表都读出来。
 */
export declare function waitWindowSnapshot(): ReadonlyArray<{
    teamId: string;
    taskId: string;
    memberName: string;
    startedAt: number;
    lastPollAt?: number;
    lastPolledActivityAt?: number;
    touchedAt: number;
}>;
/** 清空等待记录（★ 只给夹具用：进程级状态会跨用例残留，而残留会让"第一次探活"变形）。 */
export declare function resetWaitRecords(): void;
/**
 * ── ★ 调用点④：团队级观察（`task-status` / `delivery-declared` 共用）──────────────
 *
 * 这两个调用点【没有单个 task】—— 它们问的是"这个团队现在什么情况"。所以探活判据
 * 从它们那里拿到的是 `waits`（**每个未结束尝试一条**），而不是 `wait`。
 *
 * ★ `wait` 与 `waits` 不同形不是重复，是两种问题（与 t12 那条"记录 ≠ 观察"同源）：
 *     · `wait`  —— "**这个任务**等了多久"（发生在某一步的上下文里）
 *     · `waits` —— "**这个团队里**有谁在等、等了多久"（发生在快照/交付的时刻）
 *   把它们合成一个"wait 或 waits"的字段，会让"我知道这一个任务"与"我把队里所有
 *   等待都看了一遍"在判据里同形 —— 而后者才知道"谁卡住了"。
 *
 * ★★ 空数组与缺席必须不同形（本文件已经为 `members` 立过同一条界线）：
 *   · `waits: []`  —— 观察了：这个团队**此刻没有任何等待中的尝试**
 *   · `waits` 缺席 —— 没能观察（例如状态读取失败）⇒ 判据按自己的契约 unmeasured
 *
 * ★ 只有**未结束**的尝试才进来：一个已经 completed / failed / cancelled 的任务不在
 *   等任何人。把终结的任务也列进去，探活会为一个**早就结束**的尝试报"它卡住了"。
 */
/**
 * ── ★ 调用点③：把等待观察交给 runtime 判据（六个调用点共用）───────────────────
 *
 * 这是本模块**唯一**构造 `wait` 的地方。六处调用（member-dispatched /
 * task-created / task-update / task-update-settled / task-status /
 * delivery-declared）都经它取观察，于是"同一个尝试在不同步骤里读到不同的等待"
 * 这件事在**形状上**不可能发生。
 *
 * ★★ 读不到 ⇒ **不注入**，而不是注入一个默认值。
 *
 * 这是 t5 验收里那句"读不到时不得伪造 —— 不注入，让判据自己报 unmeasured"。
 * 具体地：没有匹配的等待记录 ⇒ 返回 `undefined` ⇒ `wait` 字段**不出现在 ctx 里**
 * ⇒ 判据按自己的契约说"我没能测量"。**调用方绝不在这里替判据决定"那就算通过"**
 * （本文件在 `inject` 那一段已经为这条纪律写过一段说明）。
 *
 * ★ 哪些情形"读不到"（每一种都必须不同形于"读到了"）：
 *   · 这个尝试没有派发记录（例如队长自己接管的任务）⇒ 没有起点 ⇒ 不注入；
 *   · `attemptId` 缺席（任务还没被派发过）⇒ 不注入；
 *   · 记录在，但起点不可用 ⇒ 不注入。
 *
 * ★ 每次交接都推进 `lastPollAt`：**"上一次探活"是这次探活产生的**，所以它属于
 *   交接这一步，而不是属于记录本身。判据不用它算"第几次"，只用它分辨
 *   「这是第一次探活」（字段缺席）与「上次探活在 T」（字段在）。
 */
/**
 * ── ★ 判据的输入面：A 层核对的【唯一】接线点（t10）────────────────────────────
 *
 * 这个函数是编排层对 `src/gates/requires.ts` 的全部使用。八处调用点一个不少地
 * 走它 —— 包括那六处 `runtime` 调用点，它们全部经 {@link evaluateRuntimeGates}
 * 进来，而那个入口是注入面（`wait` / `waits`）**唯一**的构造点。
 *
 * ── ★ 为什么必须逐格手接会输（这段话是本任务存在的理由）───────────────────────
 *
 * MEASURED（2026-10-05 复盘）：11 条判据的输入面**每一格都是手工单独接的**，而五次
 * 同形缺陷全部落在这一格上：
 *
 *     inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配 → 窗口表没接线
 *
 * 五次都不是判据写错，而是"判据要的那一格 ctx 没接上"。它们的共同形状是：
 * **判据照常跑、照常说话，只是它说的是"我没能测量"** —— 在日志里与"这一步没问题"
 * 同形。⇒ 判据自己声明 `requires`（B 层类型），编排层在这里按声明核对**真实 ctx**
 * （A 层实测），"接没接上"于是成为一次机械核对，而不是人眼审查。
 *
 * ── ★ 三条纪律，每条都对着一个已经踩过的坑 ────────────────────────────────────
 *
 * ① **先核对、再求值**。顺序是刻意的：核对读的是**调用方交出去的那份 ctx**，
 *    所以"判据要的格子在不在"这个问题必须在判据开口之前就回答。反过来（先求值
 *    再核对）会让核对结果依赖判据自己有没有副作用地补上某一格 —— 那时它核对的
 *    已经不是调用方的接线了。
 *
 * ② **不适用 ⇒ 不核对、不报**（`requires.ts` 的闸门）。11 条判据 × 8 个调用点
 *    = 88 种组合，**大部分本来就该"不适用"**：一条只在 `task-status` 上开口的
 *    探活判据，在 `task-created` 那一刻缺时钟，本来就是设计的一部分。在那些组合上
 *    喊"缺这缺那"正是"教人忽略门禁"的老路（本队已有实测：噪音与误报同样有害）。
 *    所以这里**原样转发**判据自己的 `appliesTo`，且用与注册表**同一份函数引用**
 *    —— 两份口径会分叉，而分叉的两次调用在日志里同形。
 *
 * ③ **核对不拒绝任何东西**（先软后硬，用户裁定）。本函数只**产出**一份旁路结果，
 *    它进求值结果的 `requires` 字段，与 `observed` 平级；它不参与
 *    `ok` / `blockers` / `unmeasured`，也不改 `evaluated` / `skipped` / `registered`
 *    任何一个计数。一个自己还没被验证过的新机制没有资格当场否决别人的任务 ——
 *    这正是本队"判据误伤的代价比漏报更贵"那条的同一个形态。
 *
 * ── ★ 三条边界，必须与注册表那一份对齐（否则核对会报出一个判据不认的结论）──────
 *
 *   · **核对谁**：`auditRequires(subjects, ctx)` 把 `applies` 交给
 *     `checkRequires` 去问 `subject.appliesTo` —— 与注册表求值时调的是**那个
 *     函数**，只不过它由审计层调一次、由注册表调一次（每轮各一次，纯读）。
 *     ⇒ 只有在 `appliesTo` 带副作用或自己读时间时两者才可能不同，而本仓库的
 *       11 条 `appliesTo` 全部是纯读（它们在 `src/gates/**` 里，本任务不改）。
 *     不适用的仍落在 `skipped`、不报缺失 —— 于是 `requires.checks` 与 `ran[]`
 *     按 id 一一对得上。
 *   · **`requires` 缺席**：`checkRequires` 给 `skipped` + `undeclared`，这**不是**
 *     噪音（它不进 `missing`）—— 它是"这条判据的输入面还没被声明"的覆盖率读数。
 *   · **`appliesTo` 抛错**：`checkRequires` **不捕获**（与注册表同口径）。一个
 *     "核对层能容错、求值层不能"的分叉会让那一刻的核对结果变成幻觉。
 */
/**
 * ── ★★ 核对结论的**结构化出口**（t3）：五处只有 `logger.warn` 的地方补齐 ──────────
 *
 * MEASURED（2026-10-06，integrator4 在 t9 钉住的不对称）：
 *
 *     六处 `auditGateRequires` 调用点里，**只有 runtime** 把核对结论随记录交出去
 *     （`runtime_gates.input_surface`）；contract / dispatch / completion / delivery×2
 *     **只有一个 `logger.warn`**。
 *
 * ⇒ 日志被截断或关掉时，「**报缺**」与「**输入面是齐的**」同形。这不是"日志不好"，
 *   是**同一个结论只有一条读取路径**时的固有弱点：本队已经栽过一次同名形态 ——
 *   `scripts/gate-input-wiring.test.mjs` 臂 8 的第一版挂在 contract 位置、却去读只有
 *   runtime 才有的 `input_surface` ⇒ 断言**恒真**（规则二点名的形态）。
 *
 * ── ★ 用户裁定（甲 + 总是出现）────────────────────────────────────────────────
 *
 * 四处统一挂 `input_surface`，且它**总是出现**（不省略）：
 *
 *     都齐            ⇒ 字段在场，`incomplete: 0`
 *     有缺格          ⇒ 字段在场，`incomplete: N` + `missing` 名单
 *     这个位置没判据  ⇒ **字段不出现**（与"有判据且都齐"不同形）
 *
 * ★ 为什么不能用「字段不出现」表达「齐」（乙方案被否的依据）：runtime 那边**既有**
 *   的注释（见 `evaluateRuntimeGates` 的返回处）已经写明过这条纪律 ——
 *   「缺席 ⇒ 字段不出现。**不是 `ok`**」。而「**有判据但都齐**」与「**这里没判据**」
 *   是**两件事**，必须不同形。
 *
 * ── ★ 形状与 runtime **完全一致**（可机械比对，不是"看起来差不多"）──────────────
 *
 *     { checked, incomplete, skipped, missing }
 *
 * ★ 只有 runtime 那处多一格 `outcome`（它回答的是另一个问题："判据跑了、说了什么"）。
 *   本函数**不**产出 `outcome`：那会让四处看起来也有一个"裁决"，而这个出口的
 *   语义只有一个 —— **输入面接没接全**。第四个字段也不加（`notApplicable` /
 *   `inputSurfaceAbsent` / `gateCellsUndeclared` / `checks` 都在 `RequiresAudit` 上）：
 *   多一格就多一处可以分叉的地方，而分叉之后两个 `input_surface` 在断言层面不同形。
 *
 * ── ★ 三态在两边的区分方式**刻意不同**，这不是分叉，是同一个决定的两种落点 ───────
 *
 *     runtime 调用点（六处）   核对结论是**它自己的返回记录**（`runtime_gates`）
 *                              ⇒ 包一层：`runtime_gates` 缺席 = 这个事件没挂判据
 *     contract/dispatch/…      核对没有自己的记录，结论只能挂在**调用方已经要交出去的**
 *                              那个对象上（`delivery` 字段 / 前置块声明的一次 `throw`）
 *                              ⇒ 那里没有"再包一层"的余地：`input_surface` 必须直接到场
 *
 *   ⇒ 于是本函数**只在有判据时**返回结果（`undefined` ⇒ 调用方挂不上字段）：
 *     字段缺席的唯一成因就是"这个位置这一轮没有挂判据的判据"。**它不是 `ok`** ——
 *     把"这里没有约束"读成"约束通过了"，正是三态要防的那种合流。
 *
 * ── ★ 末句：它不参与任何裁决 ───────────────────────────────────────────────────
 *
 * 与 {@link auditGateRequires} 同一条纪律（先软后硬）：本函数只**产出**一份读数。
 * 返回 `undefined` 的唯一后果是"少挂一个诊断字段"，**不是**拒绝、不是跳过、
 * 也不改任何既有控制流 —— 于是"补出口"这件事对生产路径的裁决零影响。
 */
/**
 * ── ★★ 诊断字段的【声明面】（t14）──────────────────────────────────────────────
 *
 * MEASURED（2026-10-06，captain 实调 `create_task` 时复现；本队同族形态第 9 次）：
 *
 *   15 个工具的 `output.schema` 全是 `additionalProperties: false`，而 t3/t7 的
 *   调用点接线往**返回值**里加了四个诊断字段（`input_surface` / `runtime_gates` /
 *   `dispatch_input_surface` / `completion_input_surface`）——
 *   **声明它们的地方（schema）没跟上**。⇒ 加了字段的返回值通不过自己的 schema，
 *   宿主在 `createSuccessResult` 里抛 `ToolOutputError`：
 *
 *       "value.input_surface" is not a declared property (additionalProperties: false)
 *
 *   ★ 这个缺陷的形状与前八次一模一样：**加了字段的地方改了，声明它的地方没改**。
 *     区别只在于这次的"声明它的地方"是 JSON Schema，而不是一个白名单数组。
 *
 * ── 修法：一个构造点，谁挂字段谁来取 ────────────────────────────────────────────
 *
 * 形状只有两族，且各自只有一个真值来源（下面这两个函数）。工具 schema 从这里
 * **取**片段，而不是各写一份字面量 —— 后者会在下一次加字段时重新分叉，
 * 而分叉之后"声明了的"与"实际返回的"在断言层面不再同形（那正是本任务的病根）。
 *
 * ★ 为什么是"按工具声明"而不是"给所有工具都加满四格"：那是一份**更大的**假声明 ——
 *   它会让"这个工具永远不会返回这个字段"与"它可能返回"在 schema 上同形，
 *   而本队的纪律是**空即空、不适用即不适用**（见 `INSERTION_POINTS` 的位置说明）。
 *   于是声明面必须与**真实的产出面**逐一对上，那条臂（见
 *   `scripts/gate-tool-output-schema.test.mjs`）逐工具核对的就是这件事。
 *
 * ★ 三态在这四个字段上同样成立，且 schema 必须容得下三态：
 *   · 字段**在场**且 `incomplete: 0`  ⇒ 都齐；
 *   · 字段**在场**且 `incomplete: N`  ⇒ 有缺格（`missing` 给出名单）；
 *   · 字段**缺席**                    ⇒ 这个位置这一轮没有判据（**不是** `ok`）。
 *   ⇒ `required` 一个字都不写：把"缺席"写成非法，就等于把第三种情形抹掉。
 */
/**
 * `runtime_gates` 的形状 = `registry.evaluate('runtime', …)` 的裁决 + `outcome`。
 *
 * ★ 为什么它比 `input_surface` 宽（多一层嵌套）：runtime 的结论是**它自己的求值
 *   记录**（`ok` / `blockers` / `unmeasured` / `ran` / `observed` / `counts` …），
 *   由 {@link evaluateRuntimeGates} 原样展开，再补一个 `input_surface` 与 `outcome`。
 *   ⇒ 它的字段集**不属于本文件**（判据注册表的裁决形状），所以这里声明它是一份
 *   **开放对象**：闭合它会再造一次"注册表加了字段、schema 没跟上"的同族缺陷。
 *   ★ 这是**刻意的**，不是偷懒：凡是形状属于另一层的嵌套对象，schema 用
 *     `additionalProperties: true` 表达"这一格是别人家的",而**本文件自己产出的
 *     字段**（四个诊断字段）一律**闭合声明**。
 */
/**
 * 一个工具可能挂上的四个诊断字段 —— **按工具取用**（见上面那段"为什么不是加满"）。
 *
 * ★ 用法：`properties: { …自己的字段, ...diagnosticFields({ inputSurface: true, runtimeGates: true }) }`
 *   ⇒ schema 里出现的就是它**真的会返回**的那几格。
 */
/**
 * ── ★★ 卡点台账：在【卡点发生时】自动落一条可重放的记录（t22 / f-0014）────────────
 *
 * ── 它修的是什么（MEASURED，本轮试跑）────────────────────────────────────────────
 *
 * 第一轮台账记了 12 条卡点，**12/12 条 `replayable: false`** —— 三样东西全是空的：
 *
 *     · `scene.ctx`               全为 null ⇒ **重建不出当时的输入**
 *     · `context.eventRefs`       指不到具体事件 ⇒ 原始观测存在但**不可定位**
 *     · `observed.mechanismState` 全为 null ⇒ 拿不到判据当时的**完整输出与内部状态**
 *
 * ★ 结论（f-0014 原话）：「记录必须在【卡点发生时】做，**事后补是补不上的**」。
 *   事后拿得到的只有任务 output（**已经过一轮解释**）与 git 历史（只有相关文件的
 *   revision）—— 而"判据当时读到的 ctx 是什么"在那个时刻之后就再也拿不回来了。
 *
 * ── 挂点：判据拒绝时 ───────────────────────────────────────────────────────────
 *
 * `throwWithSurface` 是**判据层拒绝的唯一出口**（contract / dispatch / completion /
 * delivery 全部经它）⇒ 在那里记，覆盖"判据说话并且拒绝了"这一类卡点。
 * ★ 而那个函数是**纯函数**（不读 ctx、不写盘）—— 那正是它的价值（可测、无副作用）。
 *   ⇒ 记录由**调用方**在它旁边做（调用方手里才有 ctx、会话、注册表）。
 *
 * ── ★★ 本记录自己的验收：**它必须能重放** ─────────────────────────────────────
 *
 * 这是本任务与"写日志"的分水岭：写完之后的判据是 —— **拿它去重跑那条判据，
 * 卡点必须能再发生一次**。要满足它，记录里必须含三样：
 *
 *     ① `scene.ctx`      —— ctx 的**结构化快照**（判据真的读到的那一份）
 *     ② `eventRefs`      —— 会话 id + 事件序号（把"当时"定位到具体事件）
 *     ③ `mechanismState` —— requires 核对结论 + 输入面三态 + 判据的完整输出
 *
 * ★ 形状对齐 `.agent-teams/frictions/README.md`（**不另发明一套**）：那条纪律是
 *   "记录【完整】、索引【可派生】"，键名与既有 12 条一致 —— 否则新旧记录在读取端
 *   要分两套解析，而两套会慢慢分叉。
 *
 * ── ★ 三态：记不下 与 "没有卡点" 必须不同形 ────────────────────────────────────
 *
 * 返回 `undefined` 表示**没能记**（拿不到 stateRoot / 写盘失败），而不是"没有卡点"。
 * 一个静默失败的台账会在最需要它的时候**看起来是空的**，而"空的台账"与"没有卡点"
 * 在读取端同形（与本队反复记账的形态同源）。
 */
/**
 * 把任意值压成**可重放**的形状：丢掉函数与循环引用，其余原样保留。
 *
 * ★ 为什么不用 `JSON.parse(JSON.stringify(x))`：
 *   · 循环引用直接抛错 ⇒ 一条**本该被记下的**卡点会因为"ctx 里有个环"而丢失，
 *     而丢的那一条与"没有卡点"在台账里同形；
 *   · `undefined` / 函数会被静默丢掉而不留痕 —— 那正是"记录不完整"的成因。
 *   ⇒ 这里逐层走一遍，把"丢掉了什么"**显式**记进对象，让"丢"这件事可见。
 */
/** 会话里的 `tool/result` 事件定位（台账 `context.eventRefs`）。 */
/**
 * 落一条卡点记录。
 *
 * ★ 路径：`<stateRoot>/frictions/<id>.json` —— 与既有 12 条**同一个目录、同一种形状**。
 *   `stateRoot` 的锚点与 `onWorktree` 的落盘共用 `STATE_DIR_FOR_BASE_PERSIST`。
 *
 * ★ 这一层只做 I/O，**不改任何裁决** —— 与 `inputSurfaceOf` 同一条纪律（旁路数据）。
 */
/**
 * 跑 `runtime` 位置，并且**无论它返回什么都继续**（契约 §5 硬要求）。
 *
 * ★ 三态 + 一个不同的第四种情形，四种在返回值里【互不同形】：
 *
 *   · 缺席（`undefined`）        —— 这个事件类型没有挂任何 runtime 判据。
 *                                  **不是** `ok`：把"这里没有约束"读成"约束通过了"
 *                                  正是本队要防的那种合流。
 *   · `ok`                       —— 判据跑了、没问题。
 *   · `blocked`                  —— 判据跑了、发现了问题（只记录，不拒流程）。
 *   · `unmeasured`               —— 判据跑了、说"我测不了"（★ 与 blocked 不同形）。
 *   · `threw`                    —— ★ 判据【自己抛了】。这是一条独立的结论：一条
 *                                  抛错的判据既不是"发现问题"也不是"没能测量"，
 *                                  而它在日志里与"通过"同形是最坏的形态。
 *
 * ★ 与调用点纪律的关系：只有调用方知道"这个事件是不是某条运行判据适用的事件"。
 *   本模块不读 context（不替判据猜），也不把"没跑"记成 `ok`。
 *
 * ★ `clock`（t5）：本入口是**唯一**给 runtime 判据注入时钟读数的地方。它由
 *   `registerAgentTeamsTools` 的 `config.now` 决定（缺省 `Date.now`），于是：
 *   · 生产路径上六处调用点读到的是同一个时钟；
 *   · 夹具注入一个假时钟，就能**不真的等待**地构造"两次探活之间没有任何产出"。
 *
 *   ★ 判据层绝不自己读时间（契约 §2 性质 1）—— 它拿到的是 ctx 里的 `wait.now`。
 */
/**
 * ── ★ 判据层：contract / delivery / runtime 三个位置的接线（t6）────────────────
 *
 * MEASURED（2026-10-05，t6）：注册表声明五个【位置】，此前只有 `dispatch`（1 处）
 * 与 `completion`（3 处）真的被调用。`contract` / `delivery` / `runtime` 三个位置
 * **没有任何 `registry.evaluate` 调用点** ⇒ 往那里挂判据永远不会跑。本队已经反复
 * 见过这个形态（"装了但调不到"），所以这三个位置的接线与 fixtures 是同一次改动。
 *
 * ★ 接线纪律（三条，都来自契约）：
 *
 *   ① **叠加，不替换**：新调用点一律落在既有检查【之后】。`contract` 在
 *      `validateCreateTask` / `amendTaskContract` 之后，`delivery` 在
 *      `canDeclareDelivery` 之后，`runtime` 在既有状态迁移之外。既有四个调用点的
 *      裁决顺序与语义一个字都没动。
 *
 *   ② **runtime 不得阻止流程**（契约 §5）：它返回任何裁决都只【记录】。拒任务该由
 *      `completion` / `delivery` 位置上的一条判据去读那条记录，而不是让过程约束
 *      当场把任务卡死。"过程"与"裁决"混在一处，正是契约 §5 要分开的东西。
 *
 *   ③ **缺席 ≠ 通过**：没有挂判据的位置保持今天的行为（不拦），但调用方拿到的
 *      返回值是 `undefined` 而不是 `{ok:true}` —— 两者必须不同形。
 */
/**
 * 在 `contract` 位置跑判据，并用与既有位置【完全同形】的方式拒绝。
 *
 * ★ 位置：`validateCreateTask`（建任务）与 `amendTaskContract`（改契约）**之后** ——
 *   契约层自己的校验先说话，判据层再叠加。这样"契约本身合法"这件事的既有裁决
 *   一点没变，而"契约是否可判"（例如 verify 命令能不能真的判定）可以后挂上来。
 *
 * ★ 为什么拒绝的措辞与 dispatch/completion 一致：读日志的人要能一眼看出"这是判据层
 *   拒的、拒的是哪个位置"，而三态的措辞必须分开（发现的问题 vs 没能测量）。
 *
 * ★ `inject`（t18）：判据需要的执行器由本层（唯一做 I/O 的地方）注入。此前两个
 *   contract 调用点都**没有**注入 `execVerifyCommand`，于是 `contract.verify-command`
 *   在生产路径上永远 `unmeasured` —— 见 create_task 处的详细说明。
 *
 * ── ★★ 返回值（t3）：本函数**交出**它这一次的核对结论 ──────────────────────────
 *
 * MEASURED（2026-10-06，t9）：本位置此前**只有一个 `logger.warn`** —— 日志被截断
 * 或被关掉时，「报缺」与「输入面是齐的」在返回值上同形。用户裁定：这四处统一挂
 * `input_surface`，形状与 runtime 完全一致（见 {@link inputSurfaceOf}）。
 *
 * ★ 它为什么是**返回值**而不是写进 `context` / 某个全局：成功路径上调用方
 *   （`create_task` / `amend_task`）本来就有一个要交出去的结果对象，核对结论挂在那里
 *   才与 `runtime_gates` 同一条纪律（"随记录交出去"）。返回 `undefined` ⇒ 这个位置
 *   这一轮没有挂判据 ⇒ **字段不出现**（三态里的第三种，不是 `ok`）。
 *
 * ★ 它与拒绝路径的关系**只有一个方向**：先算出结论，再交给 `rejectWithSurface` 包装
 *   任何一次真实的拒绝。⇒ 缺格的结论**永远到得了调用方**，而它一次也不曾参与裁决
 *   （"先软后硬"：核对报缺时流程照常走完，见 {@link auditGateRequires}）。
 */
/**
 * ── ★★ 「说出缺格」与「抛出拒绝」必须能同时发生（t3）────────────────────────────
 *
 * 这是本任务里唯一一处**形状上的**难点，值得写清楚它为什么是现在这样。
 *
 * 用户裁定四处都要挂 `input_surface`，而其中三处（contract / dispatch / completion）
 * 走的是**异常路径**：`create_task` / `update_task` 拒绝一次调用时不返回任何结果对象，
 * 只有一句 `throw new Error(...)`。于是"把结论交出去"在那里没有对象可挂 ——
 * 除非拒绝本身**带着**它走。
 *
 * ★ 为什么不是"先挂一个变量、让调用方去读"：那会让结论只在"读得到那个变量"的地方
 *   存在，而**拒绝路径**恰恰是最需要它的地方 —— 一次被拒的 create_task 里，
 *   "是契约本身不合法"与"是判据要的那一格没接上"正是最容易合流的两件事（前者是
 *   拒绝的理由，后者不是）。
 * ★ 也不是把结论并进 `error.message` 的那句话里：`missing` 的每一行本来就长，
 *   混进人话之后，"读字段"变成"解析字符串"，而那正是本任务要消灭的读取方式
 *   （"日志被截断时同形"）。
 *
 * ⇒ 结论挂成一个**结构化的自有属性**（`Error` 的自有可枚举属性，不经任何序列化）。
 *   钩子把它原样搬进工具结果的 `input_surface` 字段（见 `defineTool` 的返回处）。
 *   没有钩子的调用方（既有的测试、宿主）读不到它 —— 但那与"没挂"不同：属性在不在
 *   是**可判定**的，而"只写日志"在那些调用方那里根本无法判定。
 *
 * ★ 从 `throw new Error(...)` 改成 `throwWithSurface(...)` 是**行为等价**的：
 *   抛出的仍然是一个普通 `Error`（`instanceof Error` 与 `message` 逐字不变），
 *   只是多挂了一个自有属性。
 */
/**
 * 拒绝上挂的那一格叫什么。
 *
 * ★ 取一个**带命名空间前缀**的名字（而不是 `input_surface`）：它跟着一个异常对象
 *   走，而异常对象可能被宿主序列化、被日志打印。一个叫 `input_surface` 的自有属性
 *   会在任何一次 `{...error}` 里伪装成"工具结果的字段"，而它其实只在**工具边界**
 *   才被搬成那个字段（见 `defineTool` 的返回处）。两个名字分开，"挂在哪"读得出来。
 */
/**
 * 结论**应该落到哪个字段名**（见 {@link throwWithSurface} 的 `field` 参数）。
 *
 * ★ 与 `INPUT_SURFACE_PROPERTY` 分开的第二个名字：一个是"结论本体"，一个是"落点"。
 *   ★ 缺席 ⇒ 落点用缺省的 `input_surface`（那四个只有单一入口的位置）。
 */
/** 一次拒绝要落到工具结果的哪个字段上（缺省 `input_surface`）。 */
/**
 * 从一次抛出里取回核对结论（见 {@link throwWithSurface}）。
 *
 * ★ 三态之一"这个位置没有判据"与"这次抛出没带结论"在这里**合并成 `undefined`**，
 *   而且是刻意的：本函数的读者是**工具边界**，它问的是"这次调用有没有一份要交出去的
 *   核对结论"。至于"为什么没有" —— 那是*上面*那个结论自己回答的问题（字段在不在），
 *   边界没有资格替它回答，也不该发明第二种说法。
 */
/**
 * ── ★ 这里**没有*** `rejectOnDeliveryGates` 了（t18/B2）────────────────────────
 *
 * 它此前存在，并且被 `agent_teams_status` 调用 —— 那正是死结的来源：
 * **把一个读操作当成了宣告点**。一个还没收敛的团队于是连"现在什么情况"都读不到，
 * 而读不到状态正是队长判断"该不该让它收敛"的前提。
 *
 * ⇒ 现在交付位置分两处：
 *   · `agent_teams_status`  —— **只报告**（裁决并进返回值的 `delivery` 字段）
 *   · `agent_teams_declare_delivery` —— **承载拒绝**（本文件里那个工具）
 *
 * ★ 不保留一个"只在别处调用"的私有函数，是因为那会让人以为交付的拒绝逻辑有两条
 *   路径；而**两条路径会在措辞与合并口径上慢慢分叉，且它们在日志里同形**。
 *   拒绝逻辑只此一份，写在新工具的 execute 里。
 */
/**
 * ── ★ delivery 位置的输入面：成员【收敛】的观察 ────────────────────────────────
 *
 * MEASURED（2026-10-05，t12）：`delivery.convergence` 接进 delivery 位置之后，
 * 它的必需输入 `ctx.members` **没有被注入** ⇒ 它在任何真实路径上都返回 `unmeasured`。
 * 而注册表的合并规则是「未测量优先于 blockers」⇒ 它的 unmeasured **盖住**同一次求值里
 * 其他判据的 blocker ⇒ `declare_delivery` 永远返回「无法测量」。
 *
 * **一道永远关着的门** —— 与 t6 时 `completion.verify-rerun` 缺执行器同源：
 * 判据接进来了，但它的输入面没接。
 *
 * ── ★ 记录 ≠ 观察（这一节的纪律，也是 t12 验收专门钉住的一条）─────────────────
 *
 * 最省事的写法是把 `team.members[].status` 直接交出去。**那是错的**，而且错得很像对的：
 *
 *   · 那个字段是**持久记录**，由 `agent/status` 事件逐步写下来；
 *   · 一个被中断、崩溃、或压根没起来的成员，在记录里**仍然可能是 `idle`**；
 *   · 而它其实**没有交回任何东西** —— 正是收敛判据存在的理由（"空回复不是收敛"）。
 *
 * ⇒ 拿它冒充"观察到的收敛"，就是把**记录**当成**观察**：一次崩溃会读成"全队收敛"，
 *   而这个判据的全部价值恰恰在于分辨这两件事。
 *
 * ── 那么真正的观察从哪来 ────────────────────────────────────────────────────
 *
 * 成员是**持久 continuable subagent**，它的会话是一条**事件日志**。观察的入口就是
 * 那条日志本身（与 `observedChangedPaths` 读 `tool/result` 的 `meta.diffs` 是同一个
 * 先例、同一个取法）：
 *
 *   · `state` —— 用 **live Agent 的状态**（`ctx.agents.get(id).status`）。
 *                拿不到 live Agent（未 spawn / 已释放）⇒ **不注入**，而不是猜一个。
 *                ★ 注意这与 `memberActivity` 同源，但 `memberActivity` 会把
 *                "拿不到"折成 `'ready'` —— 那是给控制台看的**展示**口径；
 *                判据要的是**可判定**口径，两者不能合流。
 *   · `spoke` —— 从会话日志里读**最后一次 `assistant/message` 的内容是否为空**。
 *                没有 `assistant/message` ⇒ **不注入 spoke** ⇒ 判据按自己的契约
 *                unmeasured（"它有没有说过话没被观察到"与"它说了空的"不同形）。
 *
 * ★ 三种"没有可交的观察"要分开（t16 收口；这一节此前把前两种合流了）：
 *
 *     ① **不适用 / 可判定的事实**（成员从未 spawn）⇒ **如实交出去**
 *        ⇒ 判据判它不收敛（blocked）。这是本队那条跨层规则的调用方一侧：
 *        **「可判定的事实」不得写成「没能测量」**。
 *     ② **真的读不到**（有会话 id 但 live Agent 拿不到；或会话日志里读不出
 *        `spoke`）⇒ 不注入 ⇒ 判据 unmeasured。
 *     ③ 团队确实没有成员 ⇒ 注入 `[]`（"观察了，确实是零"，与①②都不同形）。
 *
 * ★ 原写法对①也 `return undefined`，于是**整个交付位置**只要队里有一个依赖未满足
 *   的成员就永远无法被测量 —— 同一道门从判据那边焊到了调用方这边。
 */
/**
 * 读一个成员会话里【最后一次 assistant 输出是不是空的】。
 *
 * ★ 返回值三态，与判据自己的 `spoke` 三态对齐：
 *   · `true`      —— 观察到了：最近一次输出非空
 *   · `false`     —— 观察到了：最近一次输出是空的（★ 这才是"空回复不是收敛"要抓的）
 *   · `undefined` —— **没能观察**（读不到会话日志 / 一条 assistant 消息都没有）
 */
/**
 * 观察每个成员的收敛面。
 *
 * ★ 只有【真的读不到】才返回 `undefined`（调用方据此不注入 ⇒ 判据说 unmeasured）。
 *   "读不到"与"读到了一条**可判定的事实**"必须分开 —— 见下面未 spawn 成员那一支。
 */
export declare function registerAgentTeamsTools(ctx: Context, config: ToolsConfig): AgentTeamsRuntime;
/** Render the status snapshot as compact text for the model. */
