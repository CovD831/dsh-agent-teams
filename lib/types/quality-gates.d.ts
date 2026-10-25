/**
 * Pure quality-gate rules: contracts, path audit, completion, follow-up,
 * coverage, and resume. Tools and persistence call these; they do not I/O.
 * @module dsh-agent-teams/quality-gates
 *
 * ── ★ M3 拆分（t59）：QG-A 已挪到 `./quality-gates/predicates.ts` ──────────────────
 *
 * `PathClassification` · `normalizeWorkspacePath` · `pathMatchesScope` ·
 * `classifyChangedPath` · `collectChangedPaths` · `inScopeOverlap` ·
 * `repoPathsNamedIn` · `verifyTargetOf` · `armsNamedIn` · `subjectTermsIn`
 * —— 这些**纯谓词**（零 I/O）搬到了 `./quality-gates/predicates.ts`，
 * 并由下面的 re-export **保持本模块的导出面逐条不变**。
 *
 * ★ 为什么（载荷级纪律，不是审美）：`src/gates/{admission,dispatch}/*.ts` 的 4 个文件
 *   只从本模块取 `normalizeWorkspacePath`，而**本模块 import `node:fs`**
 *   ⇒ 「判据不 import I/O」这条不变量**在传递闭包上破了**。
 *   拆出去后它们改指 `./quality-gates/predicates.ts`（**零 `node:` import**）⇒ 闭包恢复。
 *   ★ **本文件仍然 import `node:fs`** —— 那是因为 `checkTaskPremises` / `baselinePin`
 *   确实要做文件系统检查；但**它们不是判据层可达的**（那 4 个 gates 文件不取它们）。
 *   可复跑的 import 图证明见 `docs/MODULE-MAP.md` §7c。
 */
import type { ArtifactDigest, ArtifactScopeGap, ReviewedArtifact } from './types.ts';
/**
 * ★ 本模块【也】把 QG-A 原样再导出 —— 于是 `src/quality-gates.ts` 的导出面
 *   与拆分前**逐条相等**（老消费者一个都不用改）。
 *   ★ 与上面的 `import` 并存是**有意**的：`import` 给出**本文件内部**要用的绑定，
 *     这一段给出**对外**的导出面。两者缺一：只 import 则导出面塌了；
 *     只 export-from 则本文件内部 8 处调用会 TS2304（实测踩到）。
 */
export { normalizeWorkspacePath, pathMatchesScope, classifyChangedPath, collectChangedPaths, inScopeOverlap, repoPathsNamedIn, verifyTargetOf, armsNamedIn, subjectTermsIn, } from './quality-gates/predicates.ts';
export type { PathClassification } from './quality-gates/predicates.ts';
import { type AcceptanceResult, type CommandResult, type ReviewFinding, type ReviewPolicy, type ReviewedStamp, type ReviewVerdict, type TaskKind, type TaskEvidence, type TaskRevision, type TaskStatus, type TeamState, type TeamTask } from './types.ts';
declare const QUALITY_KINDS: readonly TaskKind[];
declare const WRITE_KINDS: readonly TaskKind[];
declare const DEFAULT_REVIEW_POLICY: Required<Pick<ReviewPolicy, 'requirementsMinRounds' | 'requirementsMaxRounds' | 'codeMaxRounds' | 'maxRepairAttempts'>>;
/**
 * ── ★★★ 计划审查环的轮次上限（N5 / t8）─────────────────────────────────────────
 *
 * ★ 它**不是** `ReviewPolicy` 的第六格 —— 这是实测决定的，不是偏好：
 *
 *   `ReviewPolicy` 是**四处封闭**的五格：`src/types.ts:311` 的 interface、
 *   `src/profiles.ts:24` 的 `REVIEW_POLICY_KEYS`、`src/index.ts:132` 的 zod schema、
 *   以及 `isReviewPolicy` 的 `Object.keys(value).every(k => allowed.has(k))`。
 *   塞第六格会让 `profiles.ts:1068-1073` 的 `assertAllowedKeys` **直接抛错**，
 *   而 `profiles.ts` 与 `index.ts` 都不在计划环的写域里。
 *
 * ★★ 而且两个数**依据不同**，不该并进同一个接口：
 *   质量环那个（`codeMaxRounds: 3`）是**产品配置** —— 不同 kind 需要不同次数；
 *   计划环这个是**这个功能的常数** —— 今天没有任何证据说明不同团队需要
 *   不同的"计划最多被打回几次"。
 *   强行并进一个接口，会让将来调其中一个时，不得不为什么都没变的那一个负责。
 *
 * ★ 将来若要 profile 覆盖：那要同时改上述四处，那是**另一个决定**，
 *   不该夹在计划环的落地里。这段注释存在，就是为了让下一个人知道那一格要动四处。
 *
 * ★ 与 `DEFAULT_REVIEW_POLICY` **并列**而不合并（N5.15）。
 */
export declare const PLAN_REVIEW_MAX_ROUNDS = 3;
export interface CreateTaskInput {
    subject: string;
    description?: string;
    dependencies?: string[];
    assignee?: string;
    kind?: TaskKind;
    round?: number;
    objective?: string;
    inScope?: string[];
    outOfScope?: string[];
    acceptance?: string[];
    verify?: string[];
    deliverables?: string[];
    nonGoals?: string[];
    /**
     * ── ★★★ t11：那一格「已审查」的盖章 —— 而它可选，**但一旦在场就要形状正确** ──────
     *
     * ★ 三态（而三者不同形 —— 契约点名的那一条）：
     *
     *     缺席            ⇒ ★ **通过**。它不是错误 —— 它是"这条路没走自动生成"
     *                        （问过用户、用户裁决过的）的正规形态。
     *     在场且形状正确   ⇒ 通过
     *     在场而形状坏     ⇒ ★ **拒绝**，而消息要**说清是"形状坏"**，
     *                        不是"缺了什么" —— 见 `validateCreateTask` 里那一格。
     *
     * ★ 而"区分缺失与类型错"是 §54 那条口径在**这一格**上的落点：
     *   一个说成 `reviewed is required` 的消息会把"在场而坏"读成"缺失"，
     *   而两者的**补救动作相反**（一个去补字段、一个去修那个字段的内容）。
     */
    reviewed?: ReviewedStamp;
    reviewedTaskId?: string;
    sourceTaskId?: string;
    sourceFindingIds?: string[];
    coverageOf?: string[];
    resume?: boolean;
    resumeReason?: string;
    /**
     * ── ★★ 这次校验里，`inScope` 是不是【真的被改的那个字段】（t40 修 f-0019 的第二半）──
     *
     * ── 它修的是什么 ────────────────────────────────────────────────────────────
     *
     * MEASURED（2026-10-07，captain 实测）：他在清空 `t18` 的 **dependencies**
     * （为一个合法依赖链重新接线），却被一条**关于 inScope 的**规则拦住 ——
     * 而他一个字节的 inScope 都没碰。
     *
     * 根因是触发点偏了：`updatePlanBatch` 对每个 `update_task` 变更**整任务重校验**，
     * 于是"改依赖/改描述"这类改动会连带把 inScope 的重叠检查再跑一遍。
     * ⇒ 一条规则在**它没被触碰**的时候开火，而它的错误信息还在谈论 inScope ——
     *   读的人会去翻 inScope，而问题根本不在那里。
     *
     * ── 三态：`undefined` 不是 `false`（这条与全库的纪律一致）────────────────────
     *
     *     `undefined` ⇒ 【没有声明】⇒ 保持**今天的行为**（照常检查）
     *     `false`     ⇒ 调用方明确说"这次改的不是 inScope" ⇒ 跳过重叠判定
     *     `true`      ⇒ 调用方明确说"inScope 在场且是被校验的字段" ⇒ 照常检查
     *
     * ★ 缺省方向是**照常检查**，不是跳过：`undefined` 落回今天的行为，
     *   所以一个还没接线的调用方不会**静默地**失去这条护栏。
     *   反过来（缺省跳过）会让"调用方忘了传"与"确实不该检查"同形 ——
     *   而那正是本库记账最久的形态。
     *
     * ★ 为什么这个判定必须在**判据侧**而不是调用方侧：
     *   调用方侧收口只挡住"那一次调用"，任何别的调用方仍会踩到同一个坑；
     *   而"这条规则在它没被触碰时不该开火"是**规则自己的性质**。
     */
    inScopeTouched?: boolean;
    /**
     * ── ★★★ t9：这条路**要求**调用方显式声明 kind（三态，缺省落回今天的行为）────────────
     *
     * ★ 为什么需要这一格，而不是直接把 `?? 'work'` 删掉：
     *   `create_task` 的 schema 里 `kind` **不在 `required`**，且它的 description 逐字写着
     *   "Omission means work with no quality gates" —— 那是**被文档承认的**路径。
     *   删掉缺省等于对它做一次产品语义变更，而本任务的范围是"计划路线不许静默造 work"。
     *
     * ★★ MEASURED（t9，推翻"`create_task` 自己补了 work 所以不受影响"这个前提）：
     *   `src/tools/create-task.ts:536` 逐字是 `kind: input.kind as TaskKind | undefined`
     *   —— 它把 `undefined` **原样**传进来。⇒ 本函数里任何"缺省即拒"的改动都**当场**
     *   作用于 `create_task`。同理也作用于 `scripts/preflight-contracts.mjs`
     *   这类不传 kind 的既有调用方（`scripts/` 不在 t9 写域）。
     *
     * ── 三态（与 `inScopeTouched` 同一种极性）───────────────────────────────────────
     *
     *     `undefined` ⇒ 没表态 ⇒ **落回今天的行为**（`?? 'work'`）
     *     `true`      ⇒ 这条路要求显式声明 ⇒ `kind` 缺席即**拒绝**
     *     `false`     ⇒ ★ 本格**不接受**（`false` 会读成"这条路明确不要求"，
     *                    而那与 `undefined` 在效果上相同却携带一个假的声明）
     *
     * ★ 计划路线的消费点（`src/tools.ts` 的 add_task 分支）传 `true`。
     *   于是"没人声明过类型"这件事**在它进来的那一刻**就被拒，
     *   而不是被一个静默缺省读成 `'work'` 之后**再也分不出来**。
     */
    requireExplicitKind?: boolean;
}
export interface ValidateCreateTaskResult {
    ok: boolean;
    error?: string;
    kind?: TaskKind;
    task?: Partial<TeamTask>;
    team?: TeamState;
}
export interface QualityCompletionUpdate {
    status?: TaskStatus;
    output?: string;
    verdict?: ReviewVerdict;
    findings?: ReviewFinding[];
    changedPaths?: string[];
    acceptanceResults?: AcceptanceResult[];
    commandsRun?: CommandResult[];
}
export interface QualityCompletionResult {
    ok: boolean;
    error?: string;
    requiredStatus?: TaskStatus;
    /**
     * ── ★★★ 通过时也要说得出**凭什么**（t19 验收第 5 条）────────────────────────────
     *
     * 本字段是那条"允许 completed，因为失败都在基线里"留下的**读数**。
     * ★ 缺了它，「通过」与「没有遇到失败」在读的人眼里**同形** ——
     *   而"通过了，因为这几条都在 `<commit>` 的基线里"是**可核的**那一句。
     * ★ 而它**不是**一块放行牌：它只在 `ok === true` 且确有存量失败时出现，
     *   而"该不该放行"由上面的三态裁决决定，不由这里决定。
     */
    notes?: string[];
}
export interface PlannedFollowUpTask {
    id?: string;
    kind: TaskKind;
    subject?: string;
    assignee?: string;
    dependencies?: string[];
    round?: number;
    objective?: string;
    inScope?: string[];
    outOfScope?: string[];
    acceptance?: string[];
    verify?: string[];
    sourceTaskId?: string;
    sourceFindingIds?: string[];
    reviewedTaskId?: string;
    /**
     * ★★★ 这次审查的**独立性读数**（2026-10-20，补 t6）——
     *   在**生成那一刻**算，因为那是它唯一能被确定的时刻
     *   （之后 `assignee` 可能被改，而"生成时指没指人"是一个**历史事实**）。
     */
    reviewIndependence?: IndependenceReading;
}
export interface PlanQualityFollowUpResult {
    created: PlannedFollowUpTask[];
    tasks: PlannedFollowUpTask[];
    escalated?: boolean;
    status?: 'escalated';
    /**
     * ★★ t95（上游 #183）：**为什么**自动循环停下了 —— 交给队长看。
     * ★ 缺它时"升级"只有一个布尔 ⇒ 读的人**不知道去做什么**，
     *   而"升级了但没说为什么"与"没升级"在读端补救动作上其实一样。
     */
    reason?: string;
    /**
     * ★★★ t95（上游 #183）：被**拒绝作为契约材料**的 finding id
     *   （它们报的每条路径都被默认排除）。
     * ★ 与 `reason` 分工：`reason` 给人读，这一格给**机器**读
     *   （"哪几条 finding 需要人裁决"是一个可枚举的集合）。
     */
    excludedFindings?: string[];
}
export interface CoverageRow {
    goal_item: string;
    task_ids: string[];
    status: 'missing' | 'in_progress' | 'passed' | 'blocked';
    evidence?: string;
}
/**
 * ── ★★★ t97（S1）：一份判决**与当前字节**的关系 —— ★ **三态，不是两态** ──────────────
 *
 * 上游 #161 逐字：
 * > 「A verdict that **predates content binding** is reported as an **unauditable gap**
 * >   rather than being read as a pass over the current bytes.」
 *
 * ★★ 三态**必须不同形**（本仓最久的形态是「没找到」与「确实没有」合流）：
 *
 * | 取值 | 什么情况 | 补救动作 |
 * |---|---|---|
 * | `bound` | ★ 有摘要，且**当前字节与它一致** | 无需动作（判决仍有效） |
 * | `drifted` | ★ 有摘要，而**字节已变** | 重判 —— 那次判决说的是**另一批字节** |
 * | `unbound` | ★ **根本没有摘要**（早于内容绑定） | ★ **不能读成通过** —— 它判的是不可知的东西 |
 *
 * ★★★ 而 `unbound` **不是**"drifted 的一个特例"：
 *   drifted 说"我判过那批字节，而它们变了"（**知道**）；
 *   unbound 说"我不知道它判的是什么"（**不知道**）。
 *   ⇒ 把后者塞进前者会**造出一个没发生过的绑定**。
 */
export type ArtifactBinding = 'bound' | 'drifted' | 'unbound';
/**
 * 一份"绑定了哪些字节"的摘要集合（workspace 相对路径 → sha256 hex）。
 * ★ 由**调用方**算并注入（本仓同一条纪律：这里不做 I/O）。
 */
export type ArtifactDigestMap = Readonly<Record<string, string>>;
/**
 * ── ★★★ t97（S1）：回答那**三个问题** ──────────────────────────────────────────────
 *
 * @param reviewed - 判决落盘时记下的摘要（`TeamTask.reviewedArtifacts`）。
 *   ★ **缺席或空** ⇒ `unbound`（那个判决早于内容绑定）。
 * @param current - **当前**这些路径的摘要。★ 由调用方算（这里不做 I/O）。
 *   ★★ 一个路径在 `reviewed` 里而**不在** `current` 里 ⇒ 那个文件**已被删除** ⇒ `drifted`
 *     （上游逐字点名了"**edited or deleted**"两种）。
 *
 * ── ★★ 反向半边 C 是本函数最容易做错的地方 ────────────────────────────────────
 *
 * "有摘要就报 drifted" 是最省事的写法，而那是**恒报** ——
 * ★ 它与「什么都判不了」在补救动作上同形（都会让人去重做一次本来没问题的活）。
 * ⇒ 所以字节**一致**时必须报 `bound`。本函数**逐条比对**，不是"有就报"。
 */
/**
 * ── ★★★ 「已存在的测试文件被改松了吗」（2026-10-20，补 t5）────────────────────────
 *
 * ── 它防的是什么（MEASURED：一条三条重判据都拦不住的路径）────────────────────────
 *
 * ```
 *   1. 真跑 `pnpm test`      —— 退出码 0 是**真的**
 *   2. 同一轮改松断言       —— `expect(x).toBe(3)` → `toBe(2)`
 *   3. 三条判据全部沉默：
 *      · completion.verify-rerun  不管（退出码确实是真的）
 *      · completion.r5            不管（它只管【新增】测试的父/子红绿）
 *      · completion.mutation      不管（重活，且只在被触发时跑）
 * ```
 * ⇒ 我们花了很大代价建了「测试**强不强**」的三条重判据，而
 *   「测试**被改松了没**」这一道几乎零成本的关，**没有任何人管**。
 *   ★ 参考（外部，逐字）：`portable-dsh-multi-agent-plugin`
 *     「Test files are pinned by hash, so they can't be weakened.」
 *
 * ── 三态，且三者**不同形** ────────────────────────────────────────────────────
 *
 *   `intact`       —— 开工时拍过快照，而每一个测试文件**逐字节没变**
 *   `weakened`     —— 有测试文件的摘要变了（或被删了）⇒ **拒绝**，并指名是哪几个
 *   `unmeasured`   —— **没能拍快照** / 没能读回 ⇒ ★ **绝不并进 `intact`**
 *
 * ★★ 为什么 `unmeasured` 不许并进 `intact`：那会让"我没能检查"与"检查了、没被改"
 *   在读数上同形 —— 本仓记了十几次的那条合流，这一格是它最新的一次机会。
 *   ★ 而它的**方向**是保守的：判不了**不拒绝**（先软后硬），但**如实报 unmeasured**。
 *
 * ── ★ 一个必须处理的**反面**：修复任务本来就可能要改测试 ────────────────────────
 *
 * 见 {@link TestFileBaselineReading.baselineWasEmpty} 与下面 `newFiles` 的处理：
 * **新写的**测试文件不算"改松"（那是**加**，不是减）；只有**快照里存在而后来变了或没了**
 * 的才算。★ 这个区分是本函数的核心，不是装饰 —— 没有它，每一个合法的
 * "补一个测试"都会被拒，而那条判据会在第一天就被学会忽略。
 */
export type TestFileBaselineVerdict = 'intact' | 'weakened' | 'unmeasured';
export interface TestFileBaselineReading {
    readonly verdict: TestFileBaselineVerdict;
    /** `weakened` 时：哪些**已存在**的测试文件被改了（或被删了）。 */
    readonly weakened: readonly string[];
    /** `unmeasured` 时的成因（人话）。 */
    readonly why?: string;
    /** 开工时快照里有几个测试文件（0 ⇒ 这条任务开工时工作区里没有测试文件）。 */
    readonly baselineCount: number;
}
/**
 * 比对**开工时的测试文件快照**与**现在**。
 *
 * ★ 纯函数：两份摘要都由调用方给（与 `artifactBindingOf` 同一条纪律）。
 *
 * @param baseline - 开工那一刻拍下的（`TeamTask.testFileBaseline`）。
 *   **`undefined` 与 `[]` 必须不同形**：前者是"没能拍"（⇒ `unmeasured`），
 *   后者是"拍了、当时一个测试文件都没有"（⇒ `intact`，且是一条**读数**）。
 * @param current - 现在这些路径的字节（`digestWorkspacePaths` 的产出）。
 *   **缺席**（`undefined`）⇒ 没能读回 ⇒ `unmeasured`，绝不读成"没被改"。
 */
/**
 * ── ★★★ 同一条 verify 命令，**建契约时**与**完成时**跑出的结论一样吗（2026-10-21，施工单序 4）
 *
 * ── 它补的是什么（MEASURED，`docs/OUTPUTS-CONSUMER-AUDIT.md` 的 (a)-4）──────────
 *
 * 同一条命令被跑了**两次**：
 *
 *   `contract.verify-command`  建契约那一刻跑一次 ⇒ 落进 `gateEvaluations.contract.outputs.verifyProbe`
 *   `completion.verify-rerun`  成员汇报完成时再跑一次 ⇒ 落进 `outputs.reruns`
 *
 * 实测：盘上 **44 条**任务都**同时**带着这两份读数（`verifyProbe` 44/44）。
 * ★★ 而**没有任何一处代码把它们放在一起看** —— 于是"同一命令两次结论不一致"
 *   这件事，今天**一个字都读不出来**。
 *
 * ── 它为什么值得读 ──────────────────────────────────────────────────────────
 *
 * 两次之间隔着成员的全部工作。结论变了**不一定是坏事**（那正是 verify 在测的东西），
 * 但有两种变化是**信号**：
 *   · 建契约时 `passed`、完成时 `failed` ⇒ 成员把东西弄坏了（**正常的失败**，不是信号）
 *   · 建契约时 `failed`、完成时 `passed` ⇒ ★ 那条命令当初就判不出真假，
 *     而它现在"过了"—— 这恰好是 `contract.verify-command` 存在的理由
 *     （"A verify command must be able to go green when the work was done
 *       and red when it was not"）。
 *     ★★ 若建契约时它就是 `failed`，那契约本身有问题；而它却**一路通过了**。
 *
 * ── ★ 三态，且 `unmeasured` 不并进 `agree` ────────────────────────────────────
 *
 *   `agree`      —— 两份都在，且同一命令的结论**逐条一致**
 *   `disagree`   —— 有命令的结论不一致（`changed` 里逐条给）
 *   `unmeasured` —— **缺一份**（老任务没有 `verifyProbe` / 这一轮没重跑）
 *     ★★ 这与 `agree` **不同形**："我没法比"与"比过、一样"是两件事。
 *
 * ★ 它**只报告，不拒绝**（施工单序 4 的建议是 `warn`）：
 *   两次不一致**可以**是正常的工作进展，硬拒会让每一个"修好了一个坏测试"的任务被拦。
 *   而它必须**留痕** —— 否则这条读数不存在。
 */
export type VerifyProbeAgreement = 'agree' | 'disagree' | 'unmeasured';
export interface VerifyProbeComparison {
    readonly status: VerifyProbeAgreement;
    /** `disagree` 时：同一命令的两次结论不同的那些（逐条给）。 */
    readonly changed: readonly {
        readonly command: string;
        readonly atContract: 'passed' | 'failed' | 'unknown';
        readonly atCompletion: 'passed' | 'failed' | 'unknown';
    }[];
    /** `unmeasured` 时的成因（人话）。 */
    readonly why?: string;
    /** 参与比对的命令数（0 ⇒ 两条都没跑，见 `unmeasured`）。 */
    readonly compared: number;
}
/**
 * 比一份**建契约时**的 `verifyProbe` 与一份**完成时**的 `reruns`。
 *
 * ★ 纯函数：两份都由调用方给（与 `artifactBindingOf` / `testFileBaselineOf` 同一条纪律）。
 */
export declare function compareVerifyProbe(atContract: readonly {
    readonly command?: unknown;
    readonly exitCode?: unknown;
    readonly status?: unknown;
}[] | undefined, atCompletion: readonly {
    readonly command?: unknown;
    readonly exitCode?: unknown;
    readonly status?: unknown;
}[] | undefined): VerifyProbeComparison;
export declare function testFileBaselineOf(baseline: readonly {
    readonly path: string;
    readonly digest: string;
}[] | undefined, current: ReadonlyMap<string, string> | undefined): TestFileBaselineReading;
/**
 * ── ★ 一条任务**该不该**被拍测试文件快照（闸门，不是判据）──────────────────────
 *
 * ★ `write` 类 kind 才会碰文件。`review` / `requirements` 是只读判断，
 *   给它们拍快照只会产生一份**永远用不上**的记录（而"一个没人读的读数"正是
 *   本轮审计在清理的东西）。
 * ★ 它的口径**就是** `WRITE_KINDS`（`['implementation', 'repair']`）——
 *   ★★ 而这两个常量今天是**同一个集合**，不是巧合也不是疏忽：
 *     `lib/` lockstep 与"会写测试文件"都只对真正改源码的那两类成立。
 *   ★ 我**不**在这里另写一份 `['implementation','repair']` —— 两份会分叉，
 *     而分叉之后"要拍快照"与"要建树"会给出不同的答案（本仓记账过多次）。
 *
 * ── ★ 一处如实标出的边界 ────────────────────────────────────────────────────────
 *
 * `integration` 也会写文件（它做合并），而它**不在**这个集合里
 * ⇒ 它的测试文件基线**不会被拍** ⇒ 它的比对落 `unmeasured`（**不是** `intact`）。
 * ★ 这是**已知且刻意**的：本轮先让"最常发生的路径"（成员在自己的树里改测试）
 *   有读数；扩到 `integration` 是另一条改动，而它需要先想清"合并时改了上游的测试"
 *   算不算 weakened（那是一个语义问题，不是一个开关）。
 * ★★ 而三态保证了这件事**读得出来**：`unmeasured` 与 `intact` 不同形，
 *   所以没人会把"integration 没被检查"读成"integration 的测试没被改"。
 */
export declare function shouldSnapshotTestFiles(kind: TaskKind | undefined): boolean;
export declare function artifactBindingOf(reviewed: readonly ReviewedArtifact[] | undefined, current: ArtifactDigestMap): ArtifactBinding;
/**
 * ── ★★★ t97（S1）：审计的**输入面** —— 「**当前**这些路径是什么字节」 ──────────────────
 *
 * 上游逐字：
 * > 「Current bytes of the paths recorded by verdicts and work orders.」
 *
 * ★★ 为什么它必须由**调用方**给、而不是在这里读盘：
 *   判据层是**纯**的（`src/gates/**` 有一条臂逐字钉住"caller injects I/O"）。
 *   本文件虽已 import `node:fs`（它做契约校验），但**审计**这条路上
 *   仍按同一条纪律走：**值**由调用方算好传进来。
 *
 * ★★★ 而 `artifacts` 与 `gaps` 是**两件事**，不许合流：
 *   · `artifacts` —— 读到了的（**当前**字节）
 *   · `gaps`      —— **没能读完**的那部分
 *   ⇒ 一份**不完整**的读取若被当成完整，会让"没读到"读成"没变"。
 *     ★ 上游逐字：「a non-empty list means the audit itself is incomplete,
 *       so **no verdict may be confirmed from it**」。
 *
 * ★ 本任务（S1）**只**把它作为输入面引入并转发；★ 用不用它做裁决是 S3 的事。
 */
export interface DeliveryAudit {
    /** ★ 判决与工单记下的那些路径的**当前**字节。 */
    readonly artifacts?: readonly ArtifactDigest[];
    /**
     * ★ 这次读取**没能完成**的部分（上限、读不了的目录/文件、非法模式）。
     * ★★ 非空 ⇒ **审计本身不完整** ⇒ 不许据它确认任何判决。
     */
    readonly gaps?: readonly ArtifactScopeGap[];
}
export interface DeliveryResult {
    ok: boolean;
    blockers: string[];
    /**
     * ── ★★★ t97（S1）：每条**判决类**任务的绑定读数（"它判的是哪批字节"）─────────────
     *
     * ★★ 三态（见 {@link ArtifactBinding}）：`bound` / `drifted` / `unbound`。
     * ★ 只有在**传了 `audit`** 时才有这一格 —— 缺席（`undefined`）= "这次没做审计"，
     *   而**不是**"审计过了、全部有效"。★ 两者补救动作相反。
     * ★★ 本任务（S1）**只报读数，不改 `ok`** —— 拿它去拦交付是 S3/S4 的事
     *   （那会改既有交付语义，而本任务的硬纪律是"不许改既有判据的 verdict 语义"）。
     */
    verdictBindings?: readonly VerdictBindingReading[];
}
/**
 * ── ★★★ t97（S1）：一条判决**与当前字节**的关系读数 ────────────────────────────────
 *
 * ★ 它就是那三个问题的答案，逐条可读：
 *   · `unbound` —— **早于内容绑定**（没有 `reviewedArtifacts`）
 *   · `drifted` —— 绑过，而**字节已变**（含"文件已被删除"）
 *   · `bound`   —— 绑过，且**字节未变** ⇒ 仍然有效
 */
export interface VerdictBindingReading {
    readonly taskId: string;
    readonly kind: string;
    readonly binding: ArtifactBinding;
    /** 这条判决记下的绑定数（0 表示没有可核的绑定）。 */
    readonly bound: number;
}
export interface ResumeTeamResult {
    ok?: boolean;
    status: 'resumed' | 'already_running' | 'rejected';
    team?: TeamState;
    error?: string;
    /**
     * ── ★★★ 本次恢复**显式归零**了计划审查环（`planReviewRounds = 0` + 清 flag）─────
     *
     * ★ 调用方**必须**在这一个为真时把 `team.planReviewRounds` / `team.planReviewEscalated`
     *   一起写回盘。只写 `halted` 会让归零**只存在于返回值里** ——
     *   而那正是 2026-10-20 实测出来的缺陷：一个被文档承诺为"唯一出路"的动作，
     *   在盘上什么都没改。
     *
     * ★ 为什么由本函数**说出来**而不是让调用方去比两边的 `rounds`：
     *   "只有超轮才归零"这条规则住在这里；另一处比 round 就是第二份真相，
     *   而两份真相会漂移（改一次规则就得记得改两处）。
     */
    clearedPlanReview?: true;
}
export type QualityLoopState = 'running' | 'halted' | 'escalated' | 'deliverable' | 'blocked';
export interface QualityLoopSnapshot {
    state: QualityLoopState;
    halted: boolean;
    escalated: boolean;
    deliverable: boolean;
    summary: string;
}
/**
 * ── ★★★ 计划审查环的五态（N5 / t8）─────────────────────────────────────────────
 *
 * 与 `QualityLoopState` **同形但不同位**：`describePlanLoop` 不读 `team.escalated`，
 * `describeQualityLoop` 不读 `team.planReviewEscalated` —— 两个环各读自己的位。
 *
 * ★ 为什么不复用 `team.escalated`（这是本次设计里最贵的一条教训）：
 *   `team.escalated` 全仓**只有一个写入点**（`applyQualityFollowUp`）且**没有清除点**
 *   （`resume` 只清 `halted`）。它同时是两个交付阻断项的来源
 *   （`canDeclareDelivery` 的 `team requires escalation resolution`）。
 *   ⇒ 若计划环写它，**一次计划超轮 = 整队永久不可交付，连 resume 都解不开**。
 *   ⇒ 复用别人的状态位之前，先数它有几个**清除点**。
 */
export type PlanLoopState = 'halted' | 'awaiting-review' | 'reviewing' | 'escalated' | 'approved';
export interface PlanLoopSnapshot {
    state: PlanLoopState;
    /** 已发生的计划审查轮次数。★ 缺席按 `0` 读（存量团队没有这一格）。 */
    rounds: number;
    /** 上限。★ 模块常量 `PLAN_REVIEW_MAX_ROUNDS` —— 不从 `reviewPolicy` 取（见那里的注释）。 */
    maxRounds: number;
    /**
     * ★★ **这一层真正的产出**（`state` 只是它的索引）。
     *
     * 它必须逐字说清"为什么还不能结束"，因为调用方若只用 `canEnd`（= `state === 'approved'`），
     * 拿到的就是一个可读的**否定**答案，而不是一个布尔。
     *
     * ★ 三态在这一个字里也要成立：`unmeasured` 的格子**不拦**但**必须点名** ——
     *   "N 条任务的表面读不出来"要逐条写出来，不许静默并进"通过"。
     */
    reason: string;
    /** ★ 唯一的放行读数：**只有** `state === 'approved'` 时计划可以开跑。 */
    canEnd: boolean;
    /**
     * ── ★★ 轮次这一格是**读到的**还是**缺席按 0 读的**（三态纪律）──────────────
     *
     *   `persisted` ⇒ 盘上真有 `planReviewRounds` ⇒ `rounds` 是实测值
     *   `absent`    ⇒ 存量团队（这一格在本轮之前不存在）⇒ `rounds` 是 **0**，
     *                 ★ 而"我把它读成 0"与"它确实是 0"必须不同形 ——
     *                 后者会让存量团队看起来像"审了 0 轮就通过"，前者才说得清成因。
     *
     * ★ 另开一格而不是并进 `reason`：`reason` 是人读的散文，这一格是**机器可判**的。
     *   把可判的东西只写进散文，等于让下游去 `includes` 一个句子。
     */
    roundsSource: 'persisted' | 'absent';
    /**
     * ── ★★ 契约表面的逐条读数（**读数，不是闸**）─────────────────────────────────
     *
     * ★★ 分档那一层（large 必须带 reviewed 戳）已被对抗性审查推翻并**明文砍掉**，
     *   不许重装。理由（审查者原话，逐字）：它的判据方向是**反的** ——
     *   奖励少写 `inScope`、惩罚诚实声明，且能被被审方自己缩域绕过。
     *   ⇒ 所以这里只做**读数**，一个字都不参与放行。
     *
     * 三态**不同形**（与全库那条最贵的纪律一致）：
     *   `readable`       ⇒ 契约声明了表面 ⇒ 能判
     *   `unreadable`     ⇒ 这条**是写类任务**（`implementation`/`repair`）而表面缺席/为空
     *                      ⇒ ★ 这是**真缺口**（`validateCreateTask` 对写类强制 `inScope`）
     *   `notApplicable`  ⇒ 这条**不是写类** ⇒ 契约本来就不要求它 ⇒ ★ **噪音，不是缺口**
     *
     * ★ 把后两者并成一个"缺"会让噪音淹没真缺口；并成一个"齐"会让真缺口消失 ——
     *   两种合流都已被本仓记账（t6 的同一格）。
     */
    surfaces: PlanLoopSurfaces;
}
export interface PlanLoopSurfaces {
    /** 任务总数（全量，不是抽样）。 */
    total: number;
    /** 契约声明了表面 ⇒ 能判。 */
    readable: number;
    /** ★ 写类任务而表面缺席/为空 ⇒ 真缺口。`unreadableIds` 逐条点名。 */
    unreadable: number;
    unreadableIds: string[];
    /** ★ 非写类任务没有表面 ⇒ 契约本来就不要求 ⇒ 噪音。`notApplicableIds` 逐条点名。 */
    notApplicable: number;
    notApplicableIds: string[];
}
export interface QualityGraphDraft {
    subject: string;
    kind: TaskKind;
    assignee?: string;
    dependencies: string[];
    objective: string;
    acceptance: string[];
    inScope?: string[];
    verify?: string[];
    coverageOf?: string[];
    /**
     * ── ★★★ 审查任务要审的是哪条（这一格此前**缺**，于是生成器产出的图自己过不了校验）──
     *
     * MEASURED（本轮，我直接拿生成器的输出去喂 `create({plan})`）：
     *   `profile task "review-round-1" is not a valid review task — review tasks require reviewedTaskId`
     *
     * ★ 而 `validateCreateTask`（`:1052`）对 review 的要求是**两条**：
     *   非空 + 指向的队伍里**真的存在**那条任务。
     *   所以这一格必须填**种子图里那条任务的 id**（`implementation`），
     *   它会在 `initializeProfileTeam` 里经 `seedToActual` 换成真实 id —— 与 `dependencies` 同一条路。
     *
     * ★ 这是"生成器与校验器不同源"的第三个实例（前两个：契约字段无处可放、
     *   `inScope: ['src/']` 硬编码违反它自己第 4 条规则）。它们共同的形态是：
     *   **一段代码生产的东西，另一段代码拒绝接收，而两者之间没有夹具**。
     */
    reviewedTaskId?: string;
    /** 同 `reviewedTaskId`，但用于 `repair`：这些 finding 从哪里来。 */
    sourceTaskId?: string;
    sourceFindingIds?: string[];
}
export declare const DEFAULT_REVIEW_ACCEPTANCE: readonly ["The latest implementation meets the user goal", "No unresolved blocker or high findings"];
export declare const DEFAULT_REVIEW_OBJECTIVE = "Review whether the latest implementation satisfies the user goal";
export declare function taskKindOf(task: Pick<TeamTask, 'kind'> | undefined): TaskKind;
export declare function isQualityKind(kind: TaskKind | undefined): boolean;
export declare function resolveReviewPolicy(policy: ReviewPolicy | undefined): Required<typeof DEFAULT_REVIEW_POLICY> & ReviewPolicy;
export declare function isReviewPolicy(value: unknown): value is ReviewPolicy;
export declare function repairEvidenceFiles(ctx: RepairCompletionContext | undefined): string[];
/**
 * ── ★★ repair 的完工裁决：把「判别力证据」与「测量」分开报 ──────────────────────
 *
 * 这一格**不自己跑测试**（本文件保持零 I/O 的纪律）—— 它只回答一个可以在数据上
 * 回答的问题：**这份 repair 有没有可测量的判别力证据**。
 *
 *   有 ⇒ `{ ok: true, evidence }`，调用方拿它去注入 r5/mutation
 *        （于是 r5 能跑红前绿后，装饰品照旧被拒）。
 *   没有 ⇒ `{ ok: false, unmeasured }`，且**必须**是 unmeasured 而不是 blocked：
 *        没有夹具不等于"夹具是装饰品"（那是关于工作的结论，需要真的测过才能说）。
 *        两者不同形 —— 把"我没能测量"说成"它有问题"，是反向的同一类错误。
 *
 * ★ 两句话必须不同形（本队记账）：
 *     (i)  没能观察文件改动        ⇒ "could not observe any file change"
 *     (ii) 观察到了、但没有既有夹具 ⇒ "the repair changed no test fixture"
 *   否则"我瞎了"与"我看清了、确实没有"在日志里同形。
 *
 * ── ★★★ 而上面那个 `unmeasured` **还不够**：它是 f-0020 的另一半 ─────────────────
 *
 * MEASURED（2026-10-07，t44 复现；本队 t26/t28/t32/t40/t41 五次同形终止）：
 *
 *     「带 changedPaths ⇒ changedPaths 判据拒；不带 ⇒ completion 门拒」
 *
 * t41 修好了第一半（观察面从主树扩到「主树 ∪ 成员 worktree」）。而第二半仍在，
 * 且它的形状是**反直觉的**：
 *
 *     一份【确实把证据交齐了】的 repair，在真实路径上拿到的 `newTestFiles`
 *     是**空数组**（不是缺席）⇒ `r5.appliesTo` 为真（它只问 `Array.isArray`）
 *     ⇒ 进 `gate()` ③ 支 ⇒ 恒 `unmeasured` ⇒ **永远交不出终态**
 *
 * ★ 而**缺席**（`undefined`）反而**不会**被拒：`appliesTo` 为假 ⇒ 判据直接跳过。
 *   ⇒ **空数组比没有数组更坏** —— 它触发一次永远不可能通过的检查。
 *   这是本队记账的「触发点偏了」的第二次发作（第一次是 t40 的 inScope 覆盖检查）：
 *   一条规则在**它没有对象可判**的时候仍然开火，而它开火的产物是一个恒常的拒绝。
 *
 * ── 所以这一格要**多交一个事实**：这次到底有没有"可判的对象" ────────────────────
 *
 * 调用方需要区分三件事，而它们今天被压成了两件：
 *
 *     `evidence` 非空        ⇒ 去测量那些文件（正常路径）
 *     `evidence` 空 + 有观察 ⇒ ★【没有可判的对象】⇒ 调用方**必须不要**注入空数组，
 *                              否则就是上面那个恒常拒绝（f-0020 的第二半）
 *     `evidence` 空 + 无观察 ⇒ 没能观察（unmeasured，保留原样）
 *
 * ★ 这就是新增的 `discriminable` 那一格：`false` 时调用方**不注入** `newTestFiles`
 *   （让它缺席），于是 r5 正确地跳过 —— 与 `verify-rerun` 对空 `verify` 的处理
 *   逐字同形（`ctx.task.verify.length > 0` 才开火）。
 *   ⇒ **不是放宽**：没有任何证据被跳过，因为**本来就没有证据可跳**。
 *     而"有证据、但证据不判别"那一路**一步都没让** —— 见夹具的定向突变臂。
 *
 * ★ 为什么把这件事放在本文件而不是让调用方自己看 `evidence.length === 0`：
 *   调用方已经**写着**那个判断，而它写成 `repairEvidence.ok === false ? newTestFiles`
 *   —— 也就是回落到空数组。要点不是"再写一遍"，是**把口径放在产生它的地方**：
 *   "有没有可判的对象" 是这一格的知识，调用方不该重新推导一遍
 *   （两份推导会漂移，而漂移之后两者读起来都正常 —— 本队记账过）。
 */
export declare function repairCompletionVerdict(ctx: RepairCompletionContext | undefined): RepairCompletionResult;
export interface RepairCompletionContext {
    task?: {
        id?: string;
        kind?: string;
        inScope?: string[];
        changedPaths?: string[];
    };
    update?: {
        changedPaths?: string[];
        newTestFiles?: string[];
    };
    [key: string]: unknown;
}
/**
 * ── ★★★ 「判别证据」这条供给链，喂给了哪一格，而那一格有没有人读（t67）──────────
 *
 * ── 它修的是什么（MEASURED，2026-10-07/08）────────────────────────────────────
 *
 * `discriminatingFiles → newTestFiles` 这条链的**唯一消费者是 r5**。
 * 而 kind 需求表说 **repair 不要求 r5** ⇒ 那条证据在 repair 上**没人读**，
 * 而它**仍然被生产出来**。
 *
 * ★ 而那正是本队反复记账的形态：
 *     **一个没有调用方的产出，与没有那个产出在观测上完全相同。**
 *
 * ── ★★ 为什么它必须【可读】，而不能停在"我们知道它没人读"──────────────────────
 *
 * 今天的它**是沉默的**：没有任何一行日志、任何一个返回值会告诉你
 * "这份证据生产出来了、而没人消费它"。⇒ 下一个会话只会看到
 * `repairEvidence.ok === true` 然后以为一切正常。
 *
 * ⇒ 所以本函数把那条链的**每一格**都变成可读的读数，而它有三态（★ 不同形）：
 *
 *     `consumed`    —— 有判据真的会读它（★ 由 kind 需求表回答，不是猜）
 *     `produced`    —— 生产出来了，而**没有**任何门会读（★ 沉默的那一格，现在可读）
 *     `unmeasured`  —— **无法判断**（需求表读不到 / 这个 kind 不在表里）
 *
 * ── ★ 为什么"有没有人读"要问【表】，而不是在这里写一张名单 ────────────────────
 *
 * 判据的 kind → 门 的映射**已经在 `kind-requirements.json` 里**（t54 建的）。
 * 在这里再写一张"谁读 newTestFiles"的名单，就是**两份真相** ——
 * 而它们会漂移，漂移之后两边读起来都正常。⇒ 问表。
 *
 * ★ 而"哪条判据读哪一格"这件事**仍然是本文件的知识**（`GATE_INPUT_FIELDS`）——
 *   它是"判据的输入面"这一事实，不是"某个 kind 要什么门"那个决定。
 *   两者不同轴：前者随判据实现变，后者随项目决定变。
 */
export declare const GATE_INPUT_FIELDS: Readonly<Record<string, readonly string[]>>;
/** 一条供给链的读数。★ 三态，且第二种**必须**可读（那正是本任务要修的）。 */
export interface EvidenceConsumerReading {
    /** 这份证据落在哪一格（`update.<field>`）。 */
    field: string;
    status: 'consumed' | 'produced' | 'unmeasured';
    /** 读它的门的 id（`consumed` 时非空）。 */
    consumers: string[];
    /** 人话一句。★ 三种状态的措辞**必须不同形**。 */
    detail: string;
}
/**
 * 判定"这份候选证据会被谁读"。
 *
 * @param field - 证据落在哪一格（例如 `newTestFiles` / `killerSuites`）。
 * @param requiredGateIds - 这个 kind 要求的门的 id（来自需求表）。
 *        ★ 传 `undefined` ⇒ **无法判断**（表读不到 / 这个 kind 不在表里）
 *          ⇒ `unmeasured`，**不是** `produced`。
 */
export declare function traceEvidenceConsumer(field: string, requiredGateIds: readonly string[] | undefined): EvidenceConsumerReading;
/**
 * ── ★★ `discriminable`：这次到底有没有【可判的对象】（t44 加）──────────────────
 *
 * 它**不是** `ok` 的重复，也不是"能不能判"的同义改写 —— 两者回答不同的问题：
 *
 *     `ok === true`      ⇒ 有证据，**去测量它们**（`evidence` 非空）
 *     `discriminable`    ⇒ 这一次**有没有东西可测**
 *
 * 三态读数（调用方必须分开处理，合成一个布尔就会回到 f-0020）：
 *
 *     `{ ok: true,  discriminable: true,  evidence: [...] }`  ⇒ 注入 evidence
 *     `{ ok: false, discriminable: false, unmeasured: '…' }`  ⇒ ★ **不要注入**
 *     `{ ok: false, discriminable: true,  unmeasured: '…' }`  ⇒ 理论支（今天不产出）
 *
 * ★ 为什么 `false` 时调用方要"不要注入"而不是"注入空数组"：
 *   注入 `[]` 会让 `r5.appliesTo` 为真（它只问 `Array.isArray`）⇒ 进 ③ 支
 *   ⇒ 恒 `unmeasured` ⇒ **永远交不出终态**。而**缺席**会让 `appliesTo` 为假
 *   ⇒ 判据正确跳过。⇒ 空数组比没有数组更坏，这是本格的**全部理由**。
 *
 * ★★ 边界（刻意的，且必须有臂钉住）：`discriminable: false` **不表示**"这份工作
 *   没问题"。它表示"这条判据没有对象可判，所以它不说话"。
 *   ⇒ 一个**改了测试夹具、而那个夹具不再能判别**的 repair **仍然** `discriminable: true`
 *     （它有对象），于是照常被 r5 按红前绿后拒绝。★ 见夹具的定向突变臂：
 *     把这一格改成恒 `false` ⇒ 那条"装饰品必须被拒"的臂必须红。
 *   ⇒ 换句话说：本格放宽的是「没有对象」，**不是**「对象不合格」。
 */
export type RepairCompletionResult = {
    ok: true;
    evidence: string[];
    discriminable: true;
} | {
    ok: false;
    unmeasured: string;
    discriminable: boolean;
};
/**
 * ── ★★★ t23：契约的【文件级前提】在**建任务时**就核对，而不是让成员在派发中途发现 ──────
 *
 * ── 它修的是什么（MEASURED：同一个缺陷类吃过**五次**完整往返，四个成员独立撞到）──────
 *
 *   t1 契约**整份是空的**（objective / inScope / acceptance / verify 全缺席）
 *      ⇒ 成员分不出"这个任务不需要契约"与"契约在途中丢了"。
 *   t3 契约点名 `lib/types.d.ts` —— 而本仓的 build **永远产不出那个路径**
 *      （`declarationDir` 是 `lib/types`）。
 *   t6 的 objective 点名 `observeStall`，由它的依赖 t3 产出 —— 而 t3 的交付是
 *      **worktree 局部的提交**，不是基线的祖先（本仓按【落文件】合流）
 *      ⇒ 那个产物**在它跑的那棵树上根本不存在**。
 *   t8 ★ **最强的一例**：它【被强制的 verify 命令】本身在基线上就编不出来 ——
 *      `scripts/gate-friction-capture.test.mjs` 在那个修订上**一个 C1 臂都没有**
 *      ⇒ 于是它的验收第 2 条**是空的**（那条要 gate 的 escalate 池在基线上不存在）。
 *      照写一个臂**能变绿而什么都没证明** —— 而"读起来像被验证过"正是本队存在的理由。
 *
 * ── 为什么放在这里（验收第 2 条）────────────────────────────────────────────────
 *
 * `validateCreateTask` **已经**在校验 `inScope` / `verify` / `acceptance`
 * （见下面那几个 `nonemptyStringList` 分支）⇒ 在这里加一道**存在性断言**，
 * 成本是一次 `existsSync`，而不是一整次派发往返。
 *
 * ── 三条梯级（验收第 3 条），每条各自可读、各自指名（验收第 4 条）──────────────
 *
 *   (i)   objective 里**点名**的产物存在
 *   (ii)  inScope 里**每一个**文件存在
 *   (iii) 每一条 verify 命令的**目标文件存在**，且**含验收标准点名的臂**
 *
 * ── ★★ 而它**不许**用 git ancestry（验收第 5 条）────────────────────────────────
 *
 * 本仓**按落文件合流**：一个内容相同的落地提交**永远不是** worktree 提交的祖先
 * ⇒ 祖先检查会在**正确落地的活**上误报，而那是最坏的一种误报
 *   （它惩罚的正是这个仓库做对的那件事）。
 * ⇒ 所以这里**一律按内容**判：文件在不在、里面有没有那句话。
 */
/** 一条被核对的前提；读得出来才算数 ⇒ 每条都带**它是哪一条**与**实测到的什么**。 */
export interface PremiseFailure {
    /** 梯级：(i) 目标产物 / (ii) inScope 文件 / (iii) verify 目标与臂。 */
    readonly tier: 'i' | 'ii' | 'iii';
    /** 人话，指名**哪一条前提**失败（验收第 4 条）。 */
    readonly detail: string;
}
export declare function checkTaskPremises(input: {
    objective?: string;
    acceptance?: readonly string[];
    inScope?: readonly string[];
    verify?: readonly string[];
}, root?: string, 
/**
 * ── ★★★ 2026-10-21：**第二棵可看的树** ────────────────────────────────────────────
 *
 * ── 为什么需要它（MEASURED：两个夹具要的是**不同的**树）──────────────────────
 *
 *   `scripts/lifecycle-verify.mjs`  在**临时 workspace** 里写 `scripts/parser.test.mjs`
 *     ⇒ 那条 `verify` 目标只在**临时树**里存在
 *   `scripts/gate-assignment-parity.test.mjs`  植入的三条违规（`contradiction`/`emit`/`touch`）
 *     **依赖插件仓库自己的真实文件**（`src/types.ts` …）
 *     ⇒ 它们只在**插件树**里成立
 *
 * ★★ 我先只传 `workspace` ⇒ 那个夹具的 premises 检查**抢先**拒绝（多出 2 条红）；
 *   再撤回不传 ⇒ 这个夹具的目标又"不存在"（红回来）。
 *   ⇒ **两个都对，而只给一棵树时它们互斥。**
 *
 * ── 正确的读法：前提核对问的是"**这件事在这棵树上能不能做**" ─────────────────
 *
 *   一棵文件在**任一棵**可看的树上存在 ⇒ 那条前提就**没被证伪**。
 *   ★ 这是**保守的**方向：它只会**减少**误拒，不会让一条真的"结构上不可能"通过
 *     —— 后者由 (ii) 的 `structurallyImpossiblePath` 判，那条与 root 无关（它看目录结构）。
 *   ★★ 而"两棵树都没有"仍然报 —— 那才是要拦的那种。
 */
extraRoot?: string): PremiseFailure[];
export declare function validateCreateTask(team: TeamState, input: CreateTaskInput, 
/**
 * ── ★★★ 2026-10-21：`root` —— 前提核对该看**哪棵树** ─────────────────────────────
 *
 * MEASURED（本轮实测，`scripts/lifecycle-verify.mjs`）：`checkTaskPremises` 此前
 * **不传 root**，于是它用 `localPluginRoot()`（**插件自己的仓库**）。
 * ⇒ 一个在**别的 workspace** 里建的任务（夹具、以及**任何非本仓的部署**），
 *   它的 `verify` 目标会被判成"不存在" —— 而那棵树里**明明有那个文件**。
 *
 * ★★ 这不是"夹具的特殊情况"：本插件**装到任何别的项目**时，
 *   每一个 `implementation` 任务的 `verify` 都会被这条判据误拒 ——
 *   因为它去读的是**插件包自己的目录**，不是用户的仓库。
 *   ⇒ 那是本仓记账最久的形态：**读对了规则，读错了对象**。
 *
 * ── ★★★ 而"传 workspace"**不是**无条件的正确答案（2026-10-21 实测撤回）──────────
 *
 * 我把两个调用点都改成传 `workspace`，全量立刻多出 **2 条**新增失败：
 *
 *   ✖ ★★★ 臂 5（真入口臂）：三条检查在 `create_task` 上真的拒绝，且**指名是哪一条**
 *   ✖ 臂 2 ★ 对照臂：review 可以用与它判的 implementation **不同**的模型
 *
 * ★ 成因：那个夹具用**临时 workspace**，而它植入的三条违规
 *   （`contradiction` / `emit` / `touch`）**依赖插件仓库自己的真实文件**
 *   （`src/types.ts`、`src/tools/shared/entities.ts` …）。
 *   传了临时目录 ⇒ 那些文件不在那里 ⇒ `checkTaskPremises` **抢先**拒绝了，
 *   而它拒绝的理由（"premises do not hold"）与那条臂要测的（"指名哪一条违规"）**不是同一件事**。
 *
 * ⇒ ★★ 所以本参数**保留**（它是对的能力），但**调用点暂不传**：
 *   现有两个调用点都还没有"一个可信的工作树根"这个信息 ——
 *   `create_task` 拿到的 `workspace` 对**本仓自身**是对的，对**夹具**是错的，
 *   而判据分不出这两者。
 *   ★ 要让它在真实部署上生效，需要先有一个"这个 workspace 是不是一棵真树"的读数
 *     —— 那是另一条改动，而**这一轮不做**（避免用一个猜测去替换另一个）。
 *
 * ★ 缺席 ⇒ 退回 `localPluginRoot()`（**既有行为逐字节不变**，存量调用方不用改）。
 */
root?: string, 
/**
 * ★ 第二棵可看的树（见 `checkTaskPremises` 的 `extraRoot`）。
 *   ★★ 与 `root` **并列而不是替换**：两棵都看，任一存在即算前提成立。
 */
workspaceRoot?: string): ValidateCreateTaskResult;
/**
 * ── ★★★ 「这次交付有没有新增失败」—— 三态，而三态必须不同形（t19）──────────────
 *
 * ★★ 而它是本仓那条跨层规则的直接应用（`docs/GATE-REGISTRY.md` 规则一）：
 *   「正确的分界不是『能不能读到那个东西』，而是『这件事可不可判定』。」
 * ```
 * no-new-failures  ⇒ 可判定: 这次 verify 的失败【逐条都在基线里】⇒ 允许 completed
 * new-failures     ⇒ 可判定: 至少一条【不在基线里】⇒ 只能 failed
 * undecidable      ⇒ ★ 读不到证据（没有 failures 明细 / 读不到基线清单）
 *                    ⇒ 退回旧行为（仍拒）—— 因为"没能测量"不得读成"没事"
 * ```
 *
 * ★ 而它要的是【集合比对】：同一个命令在三次运行里给出过 47 / 14 / 14 条失败
 *   （本会话实测）⇒ ★ 计数不是证据，只有【哪几条】是。
 */
/**
 * 读【钉住的基线已知失败】清单（`scripts/fixtures/baseline-known-failures.json`，t18 的产物）。
 *
 * ★ 三态而非布尔：读得到 ⇒ 名字数组 + **它是谁钉的**；读不到 / 形状不对 ⇒ `undefined`（= 判不了）。
 *   ⇒ ★ 而调用方拿 `undefined` 时必须【保守】（仍拒）——
 *     把"读不到清单"读成"清单是空的"就等于说"仓库里没有存量红"，而那是错的。
 *
 * ── ★★★ 为什么返回值里必须带上「基线是什么」（t19 验收第 5 条）────────────────────
 *
 * 判据说「这几条失败**在基线里**」时，它引用的是一个**参照物**。
 * ★ 而一个说不出自己参照物是什么的判断，读的人**无从核它**：
 *   基线是哪一次测的？那时的仓库存量红是哪几条？—— 两个问题都必须有答案，
 *   否则"存量"这个词在这句话里只是一个**承诺**，而不是一个事实。
 *
 * ⇒ 所以这里连同名单一起交出那两格（`_verified_at` / `_pinned_by`）：
 *     · `at`      —— 那次测量所基于的 commit（`_verified_at` 的行首 ref）
 *     · `by`      —— 谁钉的（`_pinned_by`）
 *   ★ 而**任何一格读不出来** ⇒ 整份判不了（不是"那一格空着"）：
 *     一个说不出参照物的基线，与一个说不清在哪测出来的读数**同形** ——
 *     而"同形"正是本仓那条纪律要拦的东西。
 *
 * ★ 注意这**没有**让判定更宽：`at/by` 读不到 ⇒ `undefined` ⇒ 调用方仍【保守地拒】。
 *   它只是把"我凭什么说它是存量"这件事**从注释搬进了读数**。
 */
export interface BaselinePin {
    readonly names: readonly string[];
    /** 那次测量所基于的 commit / ref（从 `_verified_at` 的行首取）。 */
    readonly at: string;
    /** 谁钉的（`_pinned_by`）。 */
    readonly by: string;
}
/**
 * ── ★★★ 导出它：让**盘上那份真实清单**可以被一条臂直接问出来 ──────────────────────
 *
 * MEASURED（2026-10-20）：本函数此前是模块私有 ⇒ 没有任何臂能问
 * "盘上那份 `baseline-known-failures.json` 读得出来吗"。于是它可以
 * **在所有臂都绿的情况下失效** —— 而队长就是这么把它写坏的：
 * 把 `_verified_at` 从 `"ba32130（…）"` 改成 `"2026-10-20（…）"`，
 * `pinRefFromVerifiedAt` 逐字只接受 `^[0-9a-f]{7,40}$` 或 `^refs\//`，
 * ⇒ 返回 `undefined` ⇒ **整份基线读不出来** ⇒ 29 条存量红变回 `undecidable`
 * ⇒ 完成门对每一条任务都说"判不了"。
 *
 * ★★ 而后果的方向是反的，这正是它难发现的原因：
 *   pin 从 18 条补到 36 条，本意是**放宽**（存量红不再挡完工），
 *   结果因为一个字段格式写错，反而**更严**了。
 *   ⇒ 「改了一个让人能过关的东西」与「把所有路都堵死」在同一次提交里同形。
 *
 * ★ 导出之后，`scripts/gate-baseline-increment.test.mjs` 的臂 7 直接调它问盘上那份 ——
 *   用的是**产品自己的读取路径**，而不是在夹具里重写一遍格式判断
 *   （重写就多一份真值，而两份会分叉）。
 */
export declare function baselinePin(): BaselinePin | undefined;
/**
 * ── ★ 这一条判据【已搬到注册表】────────────────────────────────────────────────
 *
 * 重跑 verify 的逻辑现在在 `src/gates/completion/verify-rerun.mjs`，由
 * `src/gates/index.mjs` 装配、`tools.ts` 通过
 * `registry.evaluate('completion', ...)` 调用。
 *
 * ★ 为什么搬走：留在这里会是**同一个规则的第二份实现**（§3.6）——
 *   两处都实现"重跑 verify"，改一处不改另一处时，其中一份变成死代码而没人知道。
 *   本文件（`quality-gates.ts`）保持【零 I/O 的纯规则】这一纪律，判据层在它外面。
 */
export type ContractGateDisposition = 'ok' | 'blocked' | 'unmeasured';
export interface ContractGateReading {
    /** ★ 三态之一 —— 而它决定**处置**，不是决定"要不要看一眼"。 */
    readonly disposition: ContractGateDisposition;
    /** ★ 要不要**拒绝**这次调用。`blocked` ⇒ 是；另两态 ⇒ 否。 */
    readonly rejects: boolean;
    /**
     * ★ 要不要**留痕**（"这一步没被检查"）。
     *   ★ 只有 `unmeasured` 为真 —— 它是那条口径的落点：**放行，但别静默**。
     *   ★ `ok` **不留痕**：一个每次都通过的判据不该把日志淹掉。
     */
    readonly leavesTrace: boolean;
    /** ★ 可读的理由（给人看的那一份）。三态**措辞不同形**。 */
    readonly reason: string;
}
export declare function readContractGateVerdict(gates: {
    readonly ok: boolean;
    readonly blockers: readonly string[];
    readonly unmeasured?: string | undefined;
}): ContractGateReading;
export declare function evaluateQualityCompletion(task: TeamTask, update: QualityCompletionUpdate): QualityCompletionResult;
/**
 * Remove drifting line anchors from generated contract text.
 *
 * 纯函数：输入文本 ⇒ 输出文本；不改写其余任何内容（时间、URL、版本号原样保留）。
 * ★ 落点：repair/requirements 轮次的 `acceptance` 直接取 `finding.requiredFix`
 *   （那里面常带 `file.ts:42`）⇒ 生成契约前过一遍本函数（上游 #174 的落点）。
 */
export declare function stripLineAnchors(text: string): string;
/**
 * Derive the repair round's inScope from the findings that caused it.
 *
 * `finding.file` records where the problem was OBSERVED, but the fix often
 * targets a different file named in `requiredFix` (docs vs sample data,
 * config vs code). Deriving the scope from both keeps the auto-generated
 * repair contract satisfiable; deriving from `file` alone can produce a
 * contract where the acceptance ("edit README.md") names a path the scope
 * forbids, so no honest completion exists and the repair dead-locks.
 *
 * Absolute and otherwise illegal paths are dropped (they can never match
 * workspace-relative scope patterns anyway); when nothing legal remains,
 * the source task's own inScope is kept as the fallback. Over-inclusion is
 * accepted: inScope is an audit upper bound, and the requiredFix text still
 * tells the implementer what to touch.
 *
 * Keep all derived paths until the generator resolves inherited exclusions;
 * filtering first would silently discard a required fix target.
 */
export declare function repairScopeFromFindings(findings: readonly ReviewFinding[], fallback: string[] | undefined): string[] | undefined;
/**
 * ── ★★ t95：一条 finding 报出的**全部**候选路径（**在任何排除规则之前**）──────────────
 *
 * ★ 为什么要把它**单独**提出来：{@link excludedFindingsOf} 要问的是
 *   「这条 finding 的**每一条**路径是不是都被排除了」——
 *   而那要求"路径集合"与"排除判定"**分开**。
 * ★★ 若把它们揉在一个函数里，就只能得到"过滤后的结果"，
 *   而**分不出**「它本来就没路径」与「它的路径全被排除」——
 *   两者补救动作相反（前者不是排除问题，后者要人裁决）。
 *
 * ★ 输入侧含 `requiredFix` 里的路径引用（与改造前[逐字同源]，只是搬了位置）。
 */
export declare function findingDerivedPaths(finding: ReviewFinding): string[];
/**
 * ── ★★★ t95：**每一条**候选路径都被默认排除的 finding（上游 #183）──────────────────
 *
 * 上游逐字：
 * > 「findings whose every cited path is excluded **escalate with a reason
 * >   instead of dead-locking a member.**」
 *
 * ★★ 为什么它必须存在（而不是"过滤掉就算了"）：
 *   一条 finding 若**所有**路径都被排除 ⇒ 它**进不了任何可满足的契约** ⇒
 *   成员无法诚实地完成它。⇒ **静默丢掉它 = 让那个缺陷消失**
 *   （而"修好了"与"从来没修"在报告里同形 —— 本仓记账最久的形态）。
 *   ⇒ 所以它被**挑出来交给调用方**，由调用方**升级 + 给理由**。
 *
 * ★★ 而一条**根本没报路径**的 finding **不算**被排除
 *   （`paths.length > 0` 那个条件）—— 它不是"路径被排除"，而是"没给路径"，
 *   两者补救动作不同：前者要人裁决，后者要审查员补一条路径。
 */
export declare function excludedFindingsOf(findings: readonly ReviewFinding[]): ReviewFinding[];
/** Captain-only amendment payload: replacement values for contract fields. */
export interface ContractAmendmentInput {
    objective?: string;
    acceptance?: string[];
    verify?: string[];
    inScope?: string[];
    outOfScope?: string[];
}
export interface AmendTaskContractResult {
    ok: boolean;
    error?: string;
    task?: TeamTask;
    revision?: TaskRevision;
}
/**
 * Controlled contract amendment (the pure rule; tooling keeps it
 * captain-only). When a quality contract is wrong — a verify command that
 * cannot pass, an inScope that forbids the file the objective names — the
 * worker has no honest completion and either dead-locks or games the gate.
 * Instead the captain may fix the contract mid-flight: every amendment is
 * recorded on the task as a {@link TaskRevision} (previous values + reason),
 * and once a review/requirements task has passed judgment on this task the
 * contract is frozen. Amendments replace whole fields (lists are full
 * replacements, not deltas); the implementer re-reads the amended contract
 * before its next quality gate. Completion gates need no special casing:
 * they read the task's current fields, so they naturally evaluate the
 * amended contract.
 */
export declare function amendTaskContract(team: TeamState, task: TeamTask, input: ContractAmendmentInput, by: string, reason: string): AmendTaskContractResult;
/**
 * ── ★★★ 「这次审查**独立**吗」—— 一条**可读的**读数（2026-10-20，补 t6）──────────────
 *
 * ── 它补的是什么（MEASURED：一个静默的兜底）────────────────────────────────────
 *
 * `schedulableAssignee(preferred, team, forbidden)` 找不到可用的人时**返回 `undefined`**，
 * 而 `makeTask` 对 `assignee === undefined` 的处理是**直接不写这一格**
 * （`src/tools/shared/entities.ts`：`...draft.assignee === undefined ? {} : { assignee: draft.assignee }`）
 * ⇒ 那条 review 任务落进**共享池**，**谁都能领，包括刚写完它的实现者**。
 *
 * ★★ 于是"这次审查其实是自审"这件事，在读数上**不可见**。
 *   而我们在 `unmeasured` 上极严（`registry.ts` 甚至为"判据开火了但被放过"专门加了
 *   `observedBlockers`），却在这一格没有对应读数 —— 同一个纪律，两个不同的落实程度。
 *
 * ── 参考（外部，市场调研逐字，两个插件独立做了同一件事）─────────────────────────
 *
 *   `portable-dsh-multi-agent-plugin`：独立性三档（审查者≠计划者≠作者，且**不同 provider**），
 *     做不到时**命名拒绝** `INDEPENDENCE_REQUIRED`
 *   `dsh-switchman`：做不到时声明 `DOWNGRADED`
 *   ★★ 两者的共同点：**降级必须可读**。
 *
 * ── 三态，且三者**不同形** ────────────────────────────────────────────────────
 *
 *   `independent`   —— 审查者**在生成时**就被指到一个不是实现者的人
 *   `not-independent` —— 审查者就是实现者（或生成时压根没指人 ⇒ 共享池）
 *   `undecidable`   —— 读不出实现者是谁（实现任务没有跑到过终态的 execution）
 *
 * ★★ 为什么 `not-independent` 不并进 `undecidable`：
 *   前者是一个**结论**（补救动作：给这条 review 指名一个别的成员），
 *   后者是"判不了"（补救动作：去查那条实现任务为什么没有 execution）。
 *   ★ 合并会让读的人去做另一件事 —— 本仓记账最久的形态。
 *
 * ── ★ 它**不做**硬拒绝（刻意的边界）────────────────────────────────────────────
 *
 * 单人团队里"没人可指"是**结构事实**，硬拒会把那种队直接死锁。
 * ⇒ 这一轮只做**可读**：让"这次独立性如何"随任务记录交出去，由读的人决定要不要信。
 *   ★ 而它**不是**"先软后硬"的临时状态 —— "降级必须可读"本身就是终态的设计
 *     （`DOWNGRADED` 那两个先例就是这么用的）。
 */
export type ReviewIndependence = 'independent' | 'not-independent' | 'undecidable';
export interface IndependenceReading {
    readonly status: ReviewIndependence;
    /** 审查者是谁；生成时没指人 ⇒ 缺席（**不是**空串）。 */
    readonly reviewer?: string;
    /** 实现者是谁；读不出 ⇒ 缺席。 */
    readonly implementer?: string;
    /** 人话成因（`not-independent` / `undecidable` 时在场）。 */
    readonly why?: string;
}
/**
 * 判一条 review / requirements 任务的**独立性**。
 *
 * ★ 纯函数：只读传入的两格（与 `artifactBindingOf` / `testFileBaselineOf` 同一条纪律）。
 *
 * @param reviewer - 生成时指给它的审查者（`assignee`）。**缺席 = 落进共享池**。
 * @param implementer - 它审的那件事的实现者。**读不出 ⇒ 缺席**。
 */
export declare function independenceOf(reviewer: string | undefined, implementer: string | undefined): IndependenceReading;
export declare function planQualityFollowUp(team: TeamState, closed: TeamTask): PlanQualityFollowUpResult;
export declare function buildCoverageMatrix(goalItems: readonly string[], tasks: readonly TeamTask[]): CoverageRow[];
export declare function canDeclareDelivery(team: TeamState, audit?: DeliveryAudit): DeliveryResult;
export declare function resumeTeamState(team: TeamState, reason: string): ResumeTeamResult;
export declare function isReviewFinding(value: unknown): value is ReviewFinding;
export declare function isAcceptanceResult(value: unknown): value is AcceptanceResult;
export declare function isCommandResult(value: unknown): value is CommandResult;
export declare function isTaskRevision(value: unknown): value is TaskRevision;
/**
 * Normalize blank optional task fields to omitted ("blank means absent").
 * Blank string scalars are deleted; string lists have blank entries filtered
 * out, and a list that only contained blanks is omitted entirely. Non-blank
 * values and every other field are passed through untouched, so durable-state
 * validation stays strict.
 */
export declare function normalizeBlankOptionalTaskFields<T extends object>(task: T): T;
export declare function hasValidQualityTaskFields(value: Record<string, unknown>): boolean;
export declare function isReviewVerdict(value: unknown): value is ReviewVerdict;
/**
 * ── ★★★ 逐条 check 的三态 —— 而它与 `REVIEW_VERDICTS` **是不同的东西** ──────────────
 *
 * MEASURED（t11 的对**对照臂**抓出来的）：第一版把 `reviewed.checks[i].verdict`
 * 拿 `isReviewVerdict` 去判 ⇒ `'fail'` 与 `'unmeasured'` 被**错误地拒掉**。
 *
 * ★ 两套取值的**对象不同**，而那正是它们必须分开的原因：
 *
 *     `REVIEW_VERDICTS`            `pass / needs_revision / reject`
 *       ⇒ 对象是**一条任务**的审查结论（`TeamTask.verdict`）
 *
 *     本常量                        `pass / fail / unmeasured`
 *       ⇒ 对象是**一问**（`ReviewedCheck`）的结论 ——
 *         三态，且 `unmeasured` **绝不并进 `pass`**（"我没能审明白"与"审过了"不同形）
 *
 * ★★ 而"用哪一套"不是一个措辞问题：拿错一套会让**每一条正当的 `fail` / `unmeasured`**
 *   都被拒 —— 即"一个审查说它有问题"这件事**传不进契约**。
 */
export declare const REVIEWED_CHECK_VERDICTS: readonly ["pass", "fail", "unmeasured"];
/** `ReviewedCheck.verdict` 的取值判定。★ 不是 `isReviewVerdict` —— 见上面那一格。 */
export declare function isReviewedCheckVerdict(value: unknown): boolean;
export declare function looksLikeGateTestContract(value: string | undefined): boolean;
export declare function sanitizeReviewObjective(value: string | undefined, fallback?: string): string;
export declare function sanitizeReviewAcceptance(values: readonly string[] | undefined): string[];
export declare function defaultQualityDeliveryGraph(input: {
    goal: string;
    implementer?: string;
    reviewer?: string;
    analyst?: string;
    tester?: string;
    integrator?: string;
}): QualityGraphDraft[];
/**
 * ── ★★★ 自审拒斥：谁实现的不许自己判过（协议第 7 条的**硬半边**）────────────────
 *
 * ── 缺陷形态（本函数存在的理由）──────────────────────────────────────────────
 *
 * 队长协议第 7 条逐字：
 *   `Never approve your own implementation or ask for a deliberate failure.`
 * 而全仓**没有任何一行代码**判过它：在 `src/` 里 grep `selfReview` 与 `self-review`
 * 都是 **0 命中**（本判据就是第一处命中）。
 *
 * MEASURED（本轮，盘上每个队伍的 team.json 全量）：
 *   可判的 13 条审查任务里，**4 条是真自审**，且**全部**判 `verdict=pass`：
 *     `mutation-quality | t4  | reviewer=ledger | impl=ledger | pass`
 *     `mutation-quality | t8  | reviewer=ledger | impl=ledger | pass`
 *     `mutation-quality | t12 | reviewer=ledger | impl=ledger | pass`
 *     `mutation-quality | t14 | reviewer=ledger | impl=ledger | pass`
 *   ⇒ 这不是一条"可能被违反"的规则，它**已经在生产里被违反了四次、每次都过了**。
 *
 * ── ★ 判据的两个输入，各自来自哪里（都在盘上，不需要新字段）────────────────────
 *
 * · **实现者** = 被审那条任务（`reviewedTaskId`）的 `executions` 里，最后一条
 *   `status === 'completed'` 的 `by`。
 *   ★ 为什么读 `executions` 而不是 `assignee`：`assignee` 说的是"派给谁"，
 *     而 `executions[].by` 说的是"**谁真的把它做完了**"。一次重派之后两者会分叉，
 *     而自审说的是后者。
 * · **审查者** = 本次更新的 `identity.name`（正在提交 verdict 的那个身份）。
 *
 * ── ★★★ `requirements` 也在范围内（它此前被那一行 `!== 'review'` 放走了）───────────
 *
 * BEFORE：本函数对**任何** kind !== 'review' 的任务返回
 *   `{ ok: true, undecidable: 'task X is requirements, not a review' }`
 * ⇒ 而 `canDeclareDelivery`（本文件 ~`:2489`）对 requirements 的完成规则与 review
 *   **逐字相同**：
 *     `if ((kind === 'review' || kind === 'requirements') && item.verdict !== 'pass')`
 *   ⇒ 于是"同一身份批准自己的产物"这件事，在 review 上被拒、在 requirements 上被放行。
 *   ★ 而质量生成器默认 `analyst: spec.analyst ?? spec.implementer`
 *     （`src/tools/create.ts:438`）—— **默认就由实现者写需求**，
 *     所以这条缝不是"理论上的可能"，它是**默认路径**。
 *
 * ── ★★ requirements 的"作者"为什么要从【被治理的实现】读，而不是它自己的 `executions` ────
 *
 * 三个候选来源，只有第三个站得住：
 *
 *   ① requirements 自己的 `executions`（最近一条 completed 的 `by`）
 *      ⇒ ★ **读不到**：`verdict=pass` 落盘的那一刻，这条任务**还没有** completed 的
 *        execution（第一条 completed 恰恰是这一次收口本身）。拿它当证据，
 *        判据在自己该说话的那一刻永远只会说"判不了"。
 *
 *   ② requirements 自己的 `assignee`
 *      ⇒ ★ **不能用**，而理由不是"它不好读"，是它会让补救动作**指向自毁** ——
 *        pass 一旦由另一个身份发出，生产流程会把这条 requirements 任务的 assignee
 *        交给那个新身份（它要接着收敛下一轮）⇒ 于是判据下一刻读到的是
 *        "作者 = 盖章的人"，**同一个 pass 会先绿后红**。一条判据若依赖一个
 *        会因为它自己放行而改变的量，它就不是判据，而是回音。
 *
 *   ③ **被治理的实现**（本函数采用的）：`governed` = 队里 kind 是
 *      `implementation` / `repair`、且**依赖闭包**里含这条 requirements 任务 id 的每一条
 *      （复用 `dependencyClosureContains`，本文件 `:906`）。
 *      ⇒ 它们最后一条 completed execution 的 `by`，就是"谁将要做 / 已经做了
 *        这些需求所规定的工作"。而"同一身份既写需求又实现它"正是
 *        `analyst === implementer` 那个形状要禁的东西 —— 判的是那个形状，不是纸面签名。
 *      ★ 对**还没跑过**的实现任务（依赖闭包已建好、活还没干），
 *        `assignee` 是盘上**唯一可读**的"谁会做它"的归属证据。
 *        这是本函数唯一一处读 `assignee` —— 而它读的是**实现任务**的 `assignee`，
 *        不是 requirements 的（见 ② 的不自毁理由）。
 *
 * ── requirements 的三态（与 review 同一套纪律，各自不同形）────────────────────
 *
 *   · 队里没有任何被治理的实现 ⇒ `{ ok: true, undecidable: … governs no implementation … }`
 *     判不了，不许读成"通过"（"没有对象"≠"对象合格"）。
 *   · 有被治理的实现、而每一条都读不出身份 ⇒ `{ ok: true, undecidable: … implementer could not be read }`
 *   · 盖章者 ∈ 那些身份 ⇒ `{ ok: false, error: '<id> cannot pass: "<reviewer>" would also implement …' }`
 *     ★ 措辞说 **"the same identity"**，不说 "the same name" —— 判的是身份，
 *       而"名字相同"会把下一个读到这里的人送去查一张不存在的改名表。
 *   · 否则 ⇒ `{ ok: true }`
 *
 * ── ★ 明确【没有】覆盖的：`verification` ───────────────────────────────────────────
 *
 * `verification` 也属于 `VERDICT_KINDS`（它的判决会记 `reviewedArtifacts`），但
 * `canDeclareDelivery` 对它的完成**不要求** `verdict=pass`（只有 review / requirements 那一行）
 * ⇒ 把"同一身份批准自己的 verdict"套到它身上，会拒绝一批**没有这条规则**的完成。
 * 这是一个**单独的决定**，不是本函数的遗漏：它需要先回答"verification 的 pass
 * 算不算一次自我批准"，而那个答案今天在仓库里**不存在**。这里如实说不知道，
 * 而不是悄悄把它并进 requirements 那一支 —— 一条覆盖了自己说不清的 kind 的判据，
 * 会把"我扩了范围"读成"我顺手修好了"。
 *
 * ── ★★ 三态（与全仓纪律同源）───────────────────────────────────────────────────
 *
 * · 判得了  ⇒ `{ ok: true }` 或 `{ ok: false, error }`
 * · **判不了 ⇒ `{ ok: true }`，且 `undecidable` 说明为什么**
 *   判不了的情形有三种，**都不许**被读成"通过"：
 *     ① `reviewedTaskId` 缺席（这条 review 没声明审谁）
 *     ② `reviewedTaskId` 指向的任务不在队里
 *     ③ 被审任务没有一条 completed 的 execution（⇒ 实现者未知）
 *   ★ 为什么不在这里硬拒这四种：它们各自已被**别的**判据管着
 *     （`validateCreateTask` 管 ① 的存在性与悬空；`canDeclareDelivery` 管 ③ 的完成度）。
 *     在这里再拒一次会让同一件事有两个口径，而两个口径会漂移。
 *   ★★ **但 `undecidable` 必须可以被读出来** —— 否则"判过了、没问题"与
 *     "判不了、放过去了"在读数里同形，而那正是本仓记录过最多的那类事故。
 *
 * ── ★ 反向半边（为什么不是"一律拒"）───────────────────────────────────────────
 *
 * 不拒的两种情形必须是**绿的**，否则这条判据会自己把正常流程打红：
 *   · 审查者 ≠ 实现者（13 条里的 9 条）
 *   · 实现者未知（上面 ③）
 *
 * @param team  本队当前状态（review 读被审任务的 `executions`；requirements 读治理到的实现任务）
 * @param task  正在被更新的那条任务（`kind` 是 `review` 或 `requirements` 且提交 `verdict`）
 * @param reviewerName 提交这次判决的身份名（`identity.name`）
 */
export declare function judgeSelfReview(input: {
    team: TeamState;
    task: TeamTask;
    reviewerName: string | undefined;
}): SelfReviewJudgement;
/** {@link judgeSelfReview} 的三态结果。 */
export interface SelfReviewJudgement {
    readonly ok: boolean;
    /** 只在 `ok === false` 时给：为什么拒。 */
    readonly error?: string;
    /** 只在判不了时给：为什么判不了（★ 与"通过"不同形，调用方必须能区分）。 */
    readonly undecidable?: string;
}
export declare function qualityPlanningPrompt(): string;
export declare function describeQualityLoop(team: TeamState): QualityLoopSnapshot;
export { QUALITY_KINDS, WRITE_KINDS };
/**
 * ── ★★★ 计划审查环：让"这个循环能不能结束"有一个可读的答案（N5 / t8）──────────────
 *
 * 用户原话（m01373）：
 * > 「加进去，然后计划是否能开始跑也是希望有一个门禁把关，
 * >   其实就是计划的审查循环是否可以结束的问题。」
 *
 * ★ 它答的是**终止性**，不是**准入**：「这个循环会自己停下来吗」，
 *   而不是「这一份计划够不够好」。两者的修法完全不同 —— 前者要一条单调不减的度量
 *   加一个有界的天花板，后者要一套判据。
 *
 * ── ★★ 判定顺序（第二版；第一版被对抗性审查推翻）────────────────────────────────
 *
 * ```
 *   team.halted === true                    ⇒ 'halted'          ★ 最前
 *   team.planReviewEscalated === true       ⇒ 'escalated'       ★ 本队自己的位
 *   rounds >= maxRounds                     ⇒ 'escalated'       ★ 读时也要能算出来
 *   team.phase === 'running'                ⇒ 'approved'        ★★ 必须在这两条【之后】
 *   planReviewState === 'awaiting_feedback' ⇒ 'reviewing'
 *   否则                                     ⇒ 'awaiting-review'
 * ```
 *
 * ★★★ **`halted` 必须最先**（`describeQualityLoop` 同序）：
 *   `haltTeamWork` **不要求 `phase === 'running'`** —— 它只查 `requireFreshCaptainTeam`，
 *   然后 `fresh.halted = true`。⇒ **一个 staged 团队也能被 halt**。
 *   若把 `phase === 'running'` 判在最前，**一个被停止的团队会被读成 `approved`**。
 *
 * ★★★ **`approved` 必须排在两条 `escalated` 之后**：
 *   ```
 *   {phase:'staged',  rounds:4} ⇒ 'escalated'
 *   {phase:'running', rounds:4} ⇒ 'approved'   ← 第一版就是这个结果
 *   ```
 *   对一个正在跑的团队，`rounds=4 > max=3` 与 `rounds=0` **读出同一个 `approved`**
 *   ⇒ 「这个循环审到顶了没有」这条读数**恰恰在批准之后不可读** —— 而用户问的就是它。
 *   ⇒ 上限必须在**放行之前**就拦住，而不是等它跑起来之后被 `phase` 遮掉。
 *
 * ★ 副作用（**必须承认的设计后果**）：一个 `rounds >= max` 的 running 团队会读成
 *   `escalated`，而它其实已经在跑。这不是错 —— 那是「它当初是被放行的，而放行点上
 *   没有读上限」的**如实记录**。修法不在读侧（读侧若也遮掉，那段历史就查不出来了），
 *   在放行点（`approveStagedTeam` 的轮次闸）。
 *
 * ── ★★ 三态：`unmeasured` 不拦，但**必须点名** ──────────────────────────────────
 *
 * ★ 契约表面读不出来的那些任务**不参与放行判定**（"没说改哪里"不是"改得很大"），
 *   但 `reason` 里要**逐条**写出来 —— 不许静默并进"通过"。
 *   放行 ≠ 通过：一个是"它可以跑了"，一个是"它被看清楚了"。
 */
export declare function describePlanLoop(team: TeamState): PlanLoopSnapshot;
/** Persisted evidence must remain loadable after process restart. */
export declare function isTaskEvidence(value: unknown): value is TaskEvidence;
/** Append observations without mutating the original result or its completion time. */
export declare function appendTaskEvidence(task: TeamTask, input: QualityCompletionUpdate & {
    evidence_note?: string;
}, by: string): boolean;
