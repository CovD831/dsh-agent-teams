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
import { normalizeWorkspacePath, classifyChangedPath, inScopeOverlap, repoPathsNamedIn, verifyTargetOf, armsNamedIn, subjectTermsIn, 
/** ★★★ t95：与闸门**共用**的默认排除谓词（上游 #183 的 "share one exclusion predicate"）。 */
isDefaultExcludedPath, } from "./quality-gates/predicates.js";
import { VERDICT_KINDS } from "./types.js";
/**
 * ★ 本模块【也】把 QG-A 原样再导出 —— 于是 `src/quality-gates.ts` 的导出面
 *   与拆分前**逐条相等**（老消费者一个都不用改）。
 *   ★ 与上面的 `import` 并存是**有意**的：`import` 给出**本文件内部**要用的绑定，
 *     这一段给出**对外**的导出面。两者缺一：只 import 则导出面塌了；
 *     只 export-from 则本文件内部 8 处调用会 TS2304（实测踩到）。
 */
export { normalizeWorkspacePath, pathMatchesScope, classifyChangedPath, collectChangedPaths, inScopeOverlap, repoPathsNamedIn, verifyTargetOf, armsNamedIn, subjectTermsIn, } from "./quality-gates/predicates.js";
/**
 * ★ `normalizeRepoPath` 是 QG-A 里的**私有** helper（`predicates.ts` 里也不导出）。
 *   本文件仍有一处要用它（`checkTaskPremises` 的 (ii) 梯级）。
 *   ★ 为什么**不**把它从 `predicates.ts` 导出：本任务 ① 的对拍命令是
 *     `grep -rE "^export " src/quality-gates.ts src/quality-gates/*.ts`
 *     —— **after 侧把 predicates.ts 也算进去** ⇒ 在那里新增一个导出会改变并集，
 *     违反"导出集合逐条相等"。⇒ 保持它在两边都私有：这里保留一份**逐字相同**的副本。
 *     ★ 它是纯字符串处理（3 行、零 I/O），复制不引入第二份真相的风险：
 *       它没有分支、没有常量、没有 I/O —— 唯一会漂移的是正则本身。
 */
function normalizeRepoPath(token) {
    return token.replace(/\\/g, '/').replace(/^\.\//, '').replace(/[.,;:)]+$/, '');
}
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINDING_SEVERITIES, REVIEW_VERDICTS, TASK_KINDS, TERMINAL_TASK_STATUSES, } from "./types.js";
const QUALITY_KINDS = [
    'requirements',
    'implementation',
    'verification',
    'review',
    'repair',
    'integration',
];
const WRITE_KINDS = ['implementation', 'repair'];
const OPEN_STATUSES = ['pending', 'claimed', 'in_progress'];
const DEFAULT_REVIEW_POLICY = {
    requirementsMinRounds: 1,
    requirementsMaxRounds: 4,
    codeMaxRounds: 3,
    maxRepairAttempts: 2,
};
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
export const PLAN_REVIEW_MAX_ROUNDS = 3;
/** 把一份 probe/rerun 归一成 `命令 → 结论`。 */
function verdictsByCommand(runs) {
    if (!Array.isArray(runs))
        return undefined;
    const out = new Map();
    for (const run of runs) {
        const command = typeof run?.command === 'string' ? run.command.trim() : '';
        if (command === '')
            continue;
        /** ★ 优先读 `exitCode`（机械），读不到才退 `status`（自报）。 */
        const verdict = typeof run?.exitCode === 'number'
            ? (run.exitCode === 0 ? 'passed' : 'failed')
            : run?.status === 'passed' || run?.status === 'failed' ? run.status : 'unknown';
        out.set(command, verdict);
    }
    return out;
}
/**
 * 比一份**建契约时**的 `verifyProbe` 与一份**完成时**的 `reruns`。
 *
 * ★ 纯函数：两份都由调用方给（与 `artifactBindingOf` / `testFileBaselineOf` 同一条纪律）。
 */
export function compareVerifyProbe(atContract, atCompletion) {
    const before = verdictsByCommand(atContract);
    const after = verdictsByCommand(atCompletion);
    /**
     * ★ **任缺一份** ⇒ `unmeasured`。★ 不说"没变" —— 那是"没比过"。
     *   ★★ 而两者都缺席时 `compared: 0`，与"比了但都没异议"不同形。
     */
    if (before === undefined || after === undefined) {
        return {
            status: 'unmeasured',
            changed: [],
            compared: 0,
            why: before === undefined
                ? 'this task carries no verify probe from when its contract was created, so there is nothing to compare the completion re-run against'
                : 'the completion re-run produced no per-command results, so there is nothing to compare the contract probe against',
        };
    }
    /** ★ 只比**两份都有的命令** —— 只在一边出现的命令是另一件事（契约被改过 / 命令没重跑）。 */
    const changed = [];
    let compared = 0;
    for (const [command, atContractVerdict] of before) {
        const atCompletionVerdict = after.get(command);
        if (atCompletionVerdict === undefined)
            continue;
        compared += 1;
        if (atContractVerdict !== atCompletionVerdict) {
            changed.push({ command, atContract: atContractVerdict, atCompletion: atCompletionVerdict });
        }
    }
    if (compared === 0) {
        return {
            status: 'unmeasured',
            changed: [],
            compared: 0,
            why: 'the contract probe and the completion re-run share no command, so nothing could be compared (the contract may have been rewritten)',
        };
    }
    return { status: changed.length === 0 ? 'agree' : 'disagree', changed, compared };
}
export function testFileBaselineOf(baseline, current) {
    if (baseline === undefined) {
        return {
            verdict: 'unmeasured',
            weakened: [],
            baselineCount: 0,
            why: 'the test files were not snapshotted when this attempt started, so whether they were weakened since then cannot be decided',
        };
    }
    if (current === undefined) {
        return {
            verdict: 'unmeasured',
            weakened: [],
            baselineCount: baseline.length,
            why: 'the current bytes of the snapshotted test files could not be read back, so whether they were weakened cannot be decided',
        };
    }
    const weakened = [];
    for (const artifact of baseline) {
        const now = current.get(artifact.path);
        /**
         * ★ 不在当前读数里 ⇒ 两种情况，**都算 weakened**：
         *   · 文件被删了（`digestWorkspacePaths` 对不存在的路径记 gap，不产出条目）
         *   · 读不到了（逃出工作区 / 读失败）
         *   ★★ 为什么两者都不并进 `intact`：一条"我找不到它了"与"它没变"是**相反**的读数。
         *     ★ 保守方向是对的：判不了时**不拒绝**，但这里不是判不了 ——
         *       快照说它存在，现在找不到，那件事本身就是一个结论。
         */
        if (now === undefined) {
            weakened.push(artifact.path);
            continue;
        }
        if (now !== artifact.digest)
            weakened.push(artifact.path);
    }
    return { verdict: weakened.length === 0 ? 'intact' : 'weakened', weakened, baselineCount: baseline.length };
}
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
export function shouldSnapshotTestFiles(kind) {
    return WRITE_KINDS.includes((kind ?? 'work'));
}
export function artifactBindingOf(reviewed, current) {
    /**
     * ★ 缺席 **或** 空 ⇒ `unbound`。
     *   ★★ 为什么空数组也算：`reviewedArtifacts: []` 说"这次判决没有绑定任何字节" ——
     *     而那**回答不了**"它判的是哪批字节"这个问题 ⇒ 与"没有这一格"同一种**不可判**。
     *     ★ 它与"没有这一格"在**落盘形状**上仍不同形（在场 vs 缺席），
     *       但**在这个问题上**两者都是 `unbound`（这不是合流，是同一个答案）。
     */
    if (reviewed === undefined || reviewed.length === 0)
        return 'unbound';
    for (const artifact of reviewed) {
        const now = current[artifact.path];
        /** ★ 不在当前摘要里 ⇒ 文件**已被删除**（上游逐字含 "deleted"）⇒ drifted。 */
        if (now === undefined)
            return 'drifted';
        if (now !== artifact.digest)
            return 'drifted';
    }
    return 'bound';
}
export const DEFAULT_REVIEW_ACCEPTANCE = [
    'The latest implementation meets the user goal',
    'No unresolved blocker or high findings',
];
export const DEFAULT_REVIEW_OBJECTIVE = 'Review whether the latest implementation satisfies the user goal';
const GATE_TEST_CONTRACT = /needs[_ ]revision|拒绝路径|verdict\s*=\s*needs_revision|cannot complete|不能完成|触发拒绝/iu;
export function taskKindOf(task) {
    return task?.kind ?? 'work';
}
export function isQualityKind(kind) {
    return kind !== undefined && kind !== 'work' && QUALITY_KINDS.includes(kind);
}
export function resolveReviewPolicy(policy) {
    return {
        ...DEFAULT_REVIEW_POLICY,
        ...policy,
        requirementsMinRounds: policy?.requirementsMinRounds ?? DEFAULT_REVIEW_POLICY.requirementsMinRounds,
        requirementsMaxRounds: policy?.requirementsMaxRounds ?? DEFAULT_REVIEW_POLICY.requirementsMaxRounds,
        codeMaxRounds: policy?.codeMaxRounds ?? DEFAULT_REVIEW_POLICY.codeMaxRounds,
        maxRepairAttempts: policy?.maxRepairAttempts ?? DEFAULT_REVIEW_POLICY.maxRepairAttempts,
    };
}
export function isReviewPolicy(value) {
    if (value === undefined)
        return true;
    if (!isRecord(value))
        return false;
    const numbers = ['requirementsMinRounds', 'requirementsMaxRounds', 'codeMaxRounds', 'maxRepairAttempts'];
    for (const key of numbers) {
        const item = value[key];
        if (item === undefined)
            continue;
        if (!Number.isSafeInteger(item) || item < 1)
            return false;
    }
    const min = value['requirementsMinRounds'] ?? DEFAULT_REVIEW_POLICY.requirementsMinRounds;
    const max = value['requirementsMaxRounds'] ?? DEFAULT_REVIEW_POLICY.requirementsMaxRounds;
    if (min > max)
        return false;
    if (value['requiredReviewers'] !== undefined) {
        if (!Array.isArray(value['requiredReviewers']))
            return false;
        if (!value['requiredReviewers'].every((item) => typeof item === 'string' && item.trim() !== ''))
            return false;
    }
    const allowed = new Set([...numbers, 'requiredReviewers']);
    return Object.keys(value).every((key) => allowed.has(key));
}
export function repairEvidenceFiles(ctx) {
    /**
     * ★ 来源顺序是刻意的：**先看本次改动过的文件**，再看声明的新测试。
     *
     *   对 implementation：新增的测试通常也在 `changedPaths` 里 ⇒ 两者一致。
     *   对 repair：`changedPaths` 里有既有夹具，而 `newTestFiles` 是空的
     *     ⇒ 只有这一格能把它捞出来，而它正是 f-0020 的全部内容。
     */
    const declared = [
        ...asStringArray(ctx?.update?.changedPaths),
        ...asStringArray(ctx?.task?.changedPaths),
        ...asStringArray(ctx?.update?.newTestFiles),
    ];
    const scopes = asStringArray(ctx?.task?.inScope);
    const seen = new Set();
    const files = [];
    for (const path of declared) {
        const normalized = normalizeWorkspacePath(path);
        if (normalized === undefined)
            continue;
        /**
         * ★ 只有**测试夹具**才算判别力证据，且必须落在任务的写域里。
         *
         *   不筛"是不是测试"会让 `src/impl.ts` 混进来，r5 会把它折成一条跑不起来的
         *   测试路径 —— 那时的失败读起来像"夹具坏了"，而事实是"这压根不是夹具"。
         *   那正是本队记账的「假面替真实路径挡路」。
         *
         *   ★ 写域缺席时**不筛**（而不是筛成空）：缺席是"没有声明"，不是"什么都不许"。
         *     筛成空会让一个没声明 inScope 的任务永远拿不到证据 —— 一个新的恒 unmeasured。
         *     而"文件不在写域里"这件事另有 `dispatch.changed-paths` 负责，不在这里判。
         */
        if (!isTestFixturePath(normalized))
            continue;
        if (scopes.length > 0 && classifyChangedPath(normalized, scopes) !== 'in_scope')
            continue;
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        files.push(normalized);
    }
    return files.sort();
}
/** 测试夹具路径（与 `src/gates/completion/r5.ts` 的 `TEST_SUFFIXES` 同一口径）。 */
const TEST_FIXTURE_PATTERN = /\.(test|spec)\.(mjs|cjs|js|mts|cts|ts|jsx|tsx)$/u;
function isTestFixturePath(path) {
    return TEST_FIXTURE_PATTERN.test(path) || /(^|\/)(test|tests|__tests__)\//u.test(path);
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === 'string' && item.trim() !== '');
}
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
export function repairCompletionVerdict(ctx) {
    const changed = [
        ...asStringArray(ctx?.update?.changedPaths),
        ...asStringArray(ctx?.task?.changedPaths),
    ];
    const observed = Array.isArray(ctx?.update?.changedPaths) || Array.isArray(ctx?.task?.changedPaths);
    const evidence = repairEvidenceFiles(ctx);
    if (evidence.length > 0)
        return { ok: true, evidence, discriminable: true };
    if (!observed) {
        return {
            ok: false,
            discriminable: false,
            unmeasured: 'the repair completion could not be judged: no file change was observed for this task '
                + '(no changed-paths evidence was provided), so whether a test fixture still discriminates '
                + 'could not be established',
        };
    }
    return {
        ok: false,
        discriminable: false,
        unmeasured: `the repair completion could not be judged: none of the ${changed.length} changed file(s) `
            + 'is a test fixture that can demonstrate the fix, so there is no discriminating evidence to '
            + 'measure (this is not a finding about the work — nothing was run)',
    };
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
export const GATE_INPUT_FIELDS = Object.freeze({
    'completion.r5': ['newTestFiles'],
    'completion.mutation': ['killerSuites'],
    'completion.backtest': ['baseline', 'coverage'],
});
/**
 * 判定"这份候选证据会被谁读"。
 *
 * @param field - 证据落在哪一格（例如 `newTestFiles` / `killerSuites`）。
 * @param requiredGateIds - 这个 kind 要求的门的 id（来自需求表）。
 *        ★ 传 `undefined` ⇒ **无法判断**（表读不到 / 这个 kind 不在表里）
 *          ⇒ `unmeasured`，**不是** `produced`。
 */
export function traceEvidenceConsumer(field, requiredGateIds) {
    if (requiredGateIds === undefined) {
        return {
            field,
            status: 'unmeasured',
            consumers: [],
            detail: `whether anything reads "${field}" could not be judged: the kind-requirements table was unavailable, `
                + 'and a judgement that could not be made must not be reported as one that was',
        };
    }
    const withField = Object.entries(GATE_INPUT_FIELDS)
        .filter(([, fields]) => fields.includes(field))
        .map(([id]) => id);
    const consumers = withField.filter((id) => requiredGateIds.includes(id));
    if (consumers.length > 0) {
        return {
            field,
            status: 'consumed',
            consumers,
            detail: `"${field}" is read by ${consumers.join(', ')}, and this kind requires ${consumers.length === 1 ? 'it' : 'them'}`,
        };
    }
    /**
     * ★★ 这一格就是本任务的核心读数：生产出来了、而**没有任何门会读**。
     *   ★ 而它**不是**一个错误 —— 它是一个**事实**，而在此之前它是沉默的。
     */
    return {
        field,
        status: 'produced',
        consumers: [],
        detail: withField.length === 0
            ? `"${field}" is produced but no gate declares it as an input, so nothing can read it`
            : `"${field}" is produced and ${withField.join(', ')} would read it, but this kind does not require ${withField.length === 1 ? 'that gate' : 'those gates'} — so it is produced and never consumed`,
    };
}
function nonemptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}
function nonemptyStringList(value) {
    return Array.isArray(value) && value.length > 0 && value.every(nonemptyString);
}
function dependencyClosureContains(tasks, dependencies, targetId) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const pending = [...dependencies];
    const visited = new Set();
    while (pending.length > 0) {
        const id = pending.pop();
        if (id === undefined || visited.has(id))
            continue;
        if (id === targetId)
            return true;
        visited.add(id);
        pending.push(...(byId.get(id)?.dependencies ?? []));
    }
    return false;
}
/**
 * ── ★★★ T5 修复（2026-10-15，队长）：按【磁盘上是什么】判，不按"有没有同名目录" ──────
 *
 * MEASURED（t5-check，修前 3 处误报）：
 *   `lib/types/state.d.ts`       是**文件**，而 `lib/types/state` 也是**目录** —— 两者并存
 *   `lib/types/tools/update-task.d.ts`  同上
 *   `lib/types/quality-gates.d.ts`      同上
 *
 * ★ 修前的写法是 `if (existsSync(目录)) return '结构上不可能'` —— 它**只查目录**，
 *   从不查那个路径**本身**是不是文件 ⇒ **把真实存在的文件判成"不可能"**。
 *
 * ★★ 后果不是"多一条提示"，而是**死锁**：任务声明它 ⇒ 被拒（"那是目录"）；
 *   不声明 ⇒ 被另一条规则拒（"`src/X.ts` 会产出它"）⇒ **该任务无法创建**。
 *   已两次挡住一等线（D1 的 `update-task.ts`、S1 的 `state.ts`）。
 *
 * ⇒ 修法：**先看 `normalized` 自己** —— 若它已是**文件**，就**不是**不可能（返回 undefined）。
 *   只有当它**不存在**、而它去掉 `.d.ts` 的同名**目录存在**时，才是真正的
 *   "声明写在了目录上" ⇒ 才报错。
 */
function structurallyImpossiblePath(normalized, root) {
    const match = /^(.*)\.d\.ts$/.exec(normalized);
    if (match === null)
        return undefined;
    const directoryLike = match[1];
    if (directoryLike === '' || !directoryLike.includes('/'))
        return undefined;
    try {
        /**
         * ★★★ 第一问（T5 的新增）：**这个路径本身是文件吗？**
         * 是 ⇒ 它**真的存在** ⇒ 绝不能说"结构上不可能"。这一问修前没有。
         */
        if (existsSync(join(root, normalized)))
            return undefined;
        /**
         * ★ 第二问（保留修前的意图）：同名目录在不在？
         * 只有当**文件不在、目录在**时，才真的是"把声明写在目录上了"。
         */
        if (!existsSync(join(root, directoryLike)))
            return undefined;
        /**
         * ★ 第三问（新增，防目录误伤）：那个路径**是目录**吗？
         * 若它既不是文件、也不是目录，那只是**缺席**（由别的规则报"不存在"），
         * 不是"结构上不可能" —— 两件事必须不同形。
         */
        if (!statSync(join(root, directoryLike)).isDirectory())
            return undefined;
    }
    catch {
        return undefined;
    }
    return `inScope names \`${normalized}\`, which cannot be produced here: \`${directoryLike}\` is a DIRECTORY `
        + `(this repository puts declarations at \`${directoryLike}/<name>.d.ts\`), so that exact path is structurally `
        + 'impossible — not merely absent. Name the declaration file explicitly, or scope the directory itself';
}
export function checkTaskPremises(input, root = localPluginRoot()) {
    const failures = [];
    const exists = (relative) => {
        try {
            return existsSync(join(root, relative));
        }
        catch {
            return false;
        }
    };
    const readIfPresent = (relative) => {
        try {
            return readFileSync(join(root, relative), 'utf8');
        }
        catch {
            return undefined;
        }
    };
    /**
     * ── (i) objective 里点名的产物存在 ───────────────────────────────────────────
     *   ★★ 而**已经出现在 inScope 里的**不在这里重复报 —— 它们由 (ii) 负责，
     *     两处都报会让同一条事实读起来像两条（本队记账过的"同一件事报两遍"）。
     */
    const objective = input.objective ?? '';
    const scopeSet = new Set((input.inScope ?? []).map(normalizeRepoPath));
    for (const named of repoPathsNamedIn(objective)) {
        if (scopeSet.has(named))
            continue;
        if (!exists(named)) {
            failures.push({
                tier: 'i',
                detail: `the objective names \`${named}\`, and that file does not exist on this base — `
                    + 'if a dependency was supposed to produce it, that deliverable has not landed here '
                    + '(this repository merges by LANDING FILES, so a completed dependency is not proof the file is present)',
            });
        }
    }
    /**
     * ── (ii) inScope 的路径**合法且可达** ───────────────────────────────────────────
     *
     * ── ★★★ 这里我把契约的字面要求**收窄了**，而理由是实测的（见下）────────────────
     *
     * 契约第 3 条字面写的是"every inScope file exists"。★ 而**照字面实现会打红四条
     * 诚实工作的臂**（MEASURED：gate-input-wiring 臂 5/臂 12、gate-task-profile 臂 2、
     * 一条"放行臂"）—— 因为**任务的存在理由常常就是创建一个还不存在的文件**：
     *
     *     inScope: ['src/a.ts', 'lib/a.js']     ← 这两格此刻都不存在，而那是**正常的**
     *
     * ⇒ 所以"文件不存在"**不能**作为拒绝理由：它与"这个任务什么都没做"同形，
     *   而那正是本任务要消灭的那种合流。
     *
     * ── 那么 (ii) 该查什么？查【路径**结构上不可能**】那一类 —— 也就是 t3 的真实形状 ──
     *
     * MEASURED（t3）：它的契约点名 `lib/types.d.ts`，而本仓 `declarationDir` 是
     * `lib/types` ⇒ 声明文件永远落在 `lib/types/<name>.d.ts`，
     * **`lib/types.d.ts` 这个路径结构上产不出来**（不是"还没生成"，是"永远不会生成"）。
     *
     * ★★ 判据：`X/Y.d.ts` 这种"目录名 + `.d.ts`"的形状，当 `X/Y/` 是一个**真的存在的
     *   目录**时，它就是那个**结构错误** —— 读的人一眼能看出他想写的是 `X/Y/<name>.d.ts`。
     * ★ 而它**不**误伤"新建目录"：`src/newthing/` 只是还不存在，不是不可能。
     */
    for (const entry of input.inScope ?? []) {
        const normalized = normalizeRepoPath(entry);
        if (normalized === '' || normalized.endsWith('/'))
            continue;
        const impossible = structurallyImpossiblePath(normalized, root);
        if (impossible !== undefined) {
            failures.push({ tier: 'ii', detail: impossible });
        }
    }
    /**
     * ── (iii) verify 的目标存在，且含验收标准点名的臂 ──────────────────────────────
     *   ★★ 这是**最强**的一条，也是唯一能挡住 t8 那一例的（见文件头）。
     */
    const acceptanceText = (input.acceptance ?? []).join('\n');
    const namedArms = armsNamedIn(acceptanceText);
    for (const command of input.verify ?? []) {
        const target = verifyTargetOf(command);
        if (target === undefined)
            continue;
        const source = readIfPresent(target);
        if (source === undefined) {
            failures.push({
                tier: 'iii',
                detail: `verify command \`${command}\` runs \`${target}\`, which does not exist on this base — `
                    + 'the command cannot even be started here, so every acceptance criterion it is meant to prove is unprovable',
            });
            continue;
        }
        /**
         * ★ 臂名：**验收标准点名的那些**必须在文件里真的出现。
         *   ⇒ 缺一个就报一个（逐条指名），因为读的人要能直接去补那一格。
         */
        for (const arm of namedArms) {
            if (!source.includes(arm)) {
                failures.push({
                    tier: 'iii',
                    detail: `\`${target}\` does not contain "${arm}", which the acceptance criteria refer to — `
                        + 'as written, that criterion would be satisfied vacuously or not at all '
                        + '(a file that exists is not a file whose arms exist)',
                });
            }
        }
        /**
         * ── ★★★ 而**臂名对得上**也还不够：还要看它**承载的东西**在不在（t8 那一例）─────────
         *
         * 见 `subjectTermsIn` 那段 MEASURED：在 t8 的基线上 `臂 4` **存在**，
         * 而它是一个与 C1 无关的老臂，C1 的词汇**零出现**。
         * ⇒ ★ 只比臂名的检查会放它过去，而那条验收标准**因此是空的**。
         *
         * ★ 逐条指名缺的是哪一个标识符 —— 读的人要能直接去补那一格。
         */
        for (const term of subjectTermsIn(acceptanceText)) {
            if (!source.includes(term)) {
                failures.push({
                    tier: 'iii',
                    detail: `\`${target}\` does not mention \`${term}\`, which the acceptance criteria name as the thing to prove — `
                        + 'the arm name may match an unrelated pre-existing arm, in which case the criterion is VACUOUS '
                        + '(it reads as verified while its subject does not exist here). This is the strongest tier: it catches '
                        + 'the case a name-only check cannot',
                });
            }
        }
    }
    return failures;
}
export function validateCreateTask(team, input, 
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
root) {
    /**
     * ── ★★★ t9：`?? 'work'` 这个缺省**不再对所有调用方无条件生效** ──────────────────
     *
     * ── 它修的是什么（MEASURED，t9 修前）────────────────────────────────────────────
     *
     *   `src/tools.ts` 的 add_task 分支把 kind **硬编码成 `'work'`**，
     *   而 `StagedPlanMutation` 的 add_task **没有 kind 格** ⇒ 经 `edit_plan` /
     *   HTTP 计划路由加进来的任务**永远不是 quality kind**，也就永远不需要质量契约。
     *   ★ 下一行是这个缺省的**副本**：硬编码删了而缺省留着（或反过来），
     *     那条"没人声明"的读数仍然会被缺省读成 `'work'` ⇒ 双层拒必须两层都在。
     *
     * ── 为什么不是"全局收紧"（船长裁决 (a)：不做产品语义变更）────────────────────────
     *
     *   `create_task` 的 schema 里 `kind` **不在 `required`**，而它的 description
     *   逐字写着 "Omission means work with no quality gates, even if the subject says
     *   implementation/review" —— 那是**被文档承认的**路径。
     *   全局收紧会改掉它，而那是一次**产品语义变更**，不该塞进本任务。
     *
     *   ★★ MEASURED（t9，本条裁定所依据的前提**已被推翻**，如实记账）：
     *     裁定的假设是"`create_task` 显式传 `kind ?? 'work'` 所以全局收紧不影响它"。
     *     实测 `src/tools/create-task.ts:536` 逐字是 `kind: input.kind as TaskKind | undefined`
     *      —— 它**直接把 `undefined` 传进来**，一个 `??` 都没有。
     *     ⇒ 全局收紧（或"缺省即拒"）会**当场打断 `create_task` 的已文档化缺省**：
     *       `validateCreateTask(team, {subject:'x', dependencies:[]})` 今天 `ok=true`，
     *       全局收紧后 `ok=false`。（同一条读数也打断 `scripts/preflight-contracts.mjs`
     *       这类**不传 kind** 的既有调用方 —— 而 `scripts/` 不在本任务写域内。）
     *     ⇒ 若按裁定字面施工，(a) 与 (b) 两条路都会红一条：
     *       要么打断 `create_task`，要么就得去改 `src/tools/create-task.ts`
     *       —— ★ 而那个文件**不在** t9 的 inScope 里。
     *
     * ── ⇒ 于是落成【调用点显式声明】的三态，而不是改默认值：──────────────────────────
     *
     *     `kind` 在场                              ⇒ 照常校验（行为不变）
     *     `kind` 缺席 且 `requireExplicitKind:true` ⇒ ★ **拒绝**，指名"kind 未声明"
     *     `kind` 缺席 且 没声明这一格               ⇒ 保持今天的缺省（`'work'`）
     *                                                ★ 这是 `create_task` 那条
     *                                                **被文档承认**的路径
     *
     * ★★ 三态而不是布尔，与 `CreateTaskInput.inScopeTouched` 那条纪律同源：
     *   `undefined` = "这条路还没表态" ⇒ 落回**今天的行为**（不是落回"跳过检查"）。
     *   反过来的极性会让"调用方忘了接线"与"这条路确实不用声明"在读取方眼里同形 ——
     *   而那正是本库记账最久的形状。
     *
     * ★ 而"表态"这件事**必须写得出来**：`requireExplicitKind: true` 在调用点上是
     *   **一句可 grep 的话**，而一个静默的缺省无法被审计。
     *   ⇒ 计划路线（`src/tools.ts` 的 add_task 消费点）就是那个表态的调用方。
     */
    if (input.kind === undefined && input.requireExplicitKind === true) {
        return {
            ok: false,
            error: 'kind must be declared explicitly on this route: it does not treat an omitted kind as "work". '
                + 'Declare the kind ("work" for ordinary work, or a quality kind such as "implementation"). '
                + '★ An undeclared kind and a kind of "work" are indistinguishable at the adjudication surface, '
                + 'so an omitted kind cannot be recovered after the fact.',
        };
    }
    const kind = input.kind ?? 'work';
    if (!TASK_KINDS.includes(kind)) {
        return { ok: false, error: `unknown task kind "${String(kind)}"` };
    }
    if (team.halted === true) {
        const reason = input.resumeReason?.trim() ?? '';
        if (input.resume !== true || reason === '') {
            return { ok: false, error: 'team is halted; resume with a non-empty reason before create_task' };
        }
    }
    if (isQualityKind(kind)) {
        if (!nonemptyString(input.objective)) {
            return { ok: false, error: `${kind} tasks require a non-empty objective` };
        }
        if (!nonemptyStringList(input.acceptance)) {
            return { ok: false, error: `${kind} tasks require at least one acceptance criterion` };
        }
    }
    if (WRITE_KINDS.includes(kind)) {
        if (!nonemptyStringList(input.inScope)) {
            return { ok: false, error: `${kind} tasks require a non-empty inScope` };
        }
        if (!nonemptyStringList(input.verify)) {
            return { ok: false, error: `${kind} tasks require a non-empty verify list` };
        }
    }
    /**
     * ── ★★★ t23：文件级前提的核对（三条梯级）──────────────────────────────────────
     *
     * 位置是刻意的：**紧挨着**上面那几个"inScope / verify / acceptance 在不在"的校验
     * —— 验收第 2 条要的正是"在 already 校验 inScope 的地方加一次存在性断言"。
     *
     * ★★ 为什么是**拒绝**而不是告警：契约原话是
     *   "A task failing the premise check is refused with a message naming WHICH premise failed,
     *    rather than being dispatched into a guaranteed bounce"。
     *   ⇒ 一条**必然弹回来**的派发，比一次当场拒绝贵得多（成员拿到它、读它、
     *     确认前提不存在、写报告、返回）—— 而这段时间里它**做不了别的活**。
     *
     * ★ 健全的契约一条都不报（`checkTaskPremises` 返回空数组）⇒
     *   它们在**这条**路径上逐字节与今天相同。
     *
     * ★★ 只有**质量类**才跑（它们才有 objective / acceptance / verify 这套契约面）。
     *   `work` 类没有契约 ⇒ 对它们跑前提核对会在每一个普通任务上开火，
     *   而那正是"教人忽略门禁"的老路。
     */
    if (isQualityKind(kind)) {
        const premiseFailures = checkTaskPremises({
            objective: input.objective,
            acceptance: input.acceptance,
            inScope: input.inScope,
            verify: input.verify,
        }, root);
        if (premiseFailures.length > 0) {
            /**
             * ★ 措辞**逐条指名是哪一条梯级**（验收第 4 条），并说清**补救动作**
             *   —— 本队那条纪律：一句读不出"该去做什么"的消息，会让人去做另一件事。
             */
            const lines = premiseFailures.map((failure) => `  (${failure.tier}) ${failure.detail}`);
            return {
                ok: false,
                error: `the contract's file-level premises do not hold on this base — ${premiseFailures.length} broken:\n`
                    + `${lines.join('\n')}\n`
                    + '★ 这不是"契约写得不好"，是**它在这棵树上无法执行**：上面每一条都是当场实测的。\n'
                    + '★ 补救动作按梯级：(i) 先把产出它的依赖落进基线；(ii) 改 inScope 到真实存在的路径；'
                    + '(iii) 改 verify 指向真实的文件，或把验收标准改成那个文件里**真的有的**臂。',
            };
        }
    }
    if (kind === 'review') {
        if (!nonemptyString(input.reviewedTaskId)) {
            return { ok: false, error: 'review tasks require reviewedTaskId' };
        }
        if (!team.tasks.some((item) => item.id === input.reviewedTaskId)) {
            return { ok: false, error: `reviewed task "${input.reviewedTaskId}" does not exist` };
        }
    }
    if (kind === 'repair') {
        if (!nonemptyString(input.sourceTaskId) || !nonemptyStringList(input.sourceFindingIds)) {
            return { ok: false, error: 'repair tasks require sourceTaskId and at least one sourceFindingId' };
        }
        if (!team.tasks.some((item) => item.id === input.sourceTaskId)) {
            return { ok: false, error: `source task "${input.sourceTaskId}" does not exist` };
        }
        const duplicate = team.tasks.find(item => taskKindOf(item) === 'repair'
            && OPEN_STATUSES.includes(item.status) && item.sourceTaskId === input.sourceTaskId
            && findingKey(item.sourceFindingIds ?? []) === findingKey(input.sourceFindingIds ?? []));
        if (duplicate !== undefined)
            return { ok: false, error: `repair task ${duplicate.id} already covers these findings; use that task instead of creating duplicate work` };
    }
    /**
     * ── ★★★ t11：`reviewed` 那一格的校验 —— 而它是**三态**，且三者不同形 ─────────────
     *
     * 用户原话（这一格存在的理由）：
     * > 「有的任务是自动生成的，有的任务是需要问过我之后再生成、再派发的。
     * >   对于问过我、我裁决过的任务，在生成计划时就没有走自动生成的那一步，
     * >   也就没有『已审查』的字段，**那它就需要被审查一遍**。」
     *
     * ⇒ ★ 所以路由规则是：**带 `reviewed` ⇒ 放行；不带 ⇒ 派之前必须先审一遍**。
     *   而"不带"是**正常状态**，不是错误 —— 本函数**不许**把它拒掉。
     *
     * ── ★★★ 「区分『缺失』与『类型错』」在这里的确切落点（§54 那条口径）──────────────
     *
     * ★ 它**不是**"两种都要报错，只是措辞不同" —— 那是最容易被读错的一版：
     *
     *     缺席           ⇒ ★ **通过**（`ok: true`）。它是"还没审"，不是"缺了一格必填"。
     *     在场而形状坏    ⇒ 拒绝，而消息**指名"在场而形状坏"**，并说清**坏在哪**。
     *
     * ★★ 为什么这两者必须不同形（后果是具体的）：
     *   一个说成 `reviewed is required` 的消息，会让读的人去**补一个字段** ——
     *   而那条任务**本来就有那一格**（只是它内容坏了）⇒ 他去补的东西已经在。
     *   ⇒ ★ 而那正是本队记账过的形态：**一个错误的措辞让人去做另一件事。**
     *
     * ★ 而"坏在哪"也要**逐项指名**（与 `profiles.ts` 那条 `X must be an array` 同一口径）：
     *   读的人要能直接去修那一项，而不是把整个 `reviewed` 重写一遍。
     */
    if (input.reviewed !== undefined) {
        const reviewed = input.reviewed;
        /**
         * ★ ① 它必须是一个**普通对象** —— 而 `null` / 数组 / 字符串 / 数字都不算。
         *   ★ 复用 `isRecord`（它已把"非对象"与"null"与"数组"三件事分开判了）。
         */
        if (!isRecord(reviewed)) {
            /** ★ 而消息里带上**实际读到的是什么** —— 那让"类型错"可当场核。 */
            return {
                ok: false,
                error: 'reviewed is present but is not an object: '
                    + `a review stamp must be an object with {at, by, checks[]}, but the value is ${describeTypeOf(reviewed)}. `
                    + '★ 这不是"缺了 reviewed"（它在场）—— 是它的形状不对',
            };
        }
        if (typeof reviewed['at'] !== 'number' || !Number.isFinite(reviewed['at'])) {
            return {
                ok: false,
                error: 'reviewed.at must be a finite number (epoch ms): '
                    + `the value is ${describeTypeOf(reviewed['at'])}. ★ 这不是"缺了 reviewed"（它在场）`,
            };
        }
        if (!nonemptyString(reviewed['by'])) {
            return {
                ok: false,
                error: 'reviewed.by must be a non-empty string (who performed the review): '
                    + `the value is ${describeTypeOf(reviewed['by'])}. ★ 这不是"缺了 reviewed"（它在场）`,
            };
        }
        /**
         * ★ ② `checks` 必须是**数组** —— 而这一条与 `at`/`by` 分开报，因为它坏起来最常见
         *   （一个布尔 `reviewed: true` 会落在上面第 ① 条，而 `checks: "pass"` 落这一条）。
         */
        if (!Array.isArray(reviewed['checks'])) {
            return {
                ok: false,
                error: 'reviewed.checks must be an array of per-question verdicts: '
                    + `the value is ${describeTypeOf(reviewed['checks'])}. `
                    + '★ 这不是"缺了 reviewed"（它在场）—— 而一个布尔 `true` 也到不了这里（它会在"不是对象"那一格就被拒）',
            };
        }
        /** ★ ③ 而数组的**每一条**也要是良构的（一个空数组是合法的：审了、而一条都没记）。 */
        for (const [index, check] of reviewed['checks'].entries()) {
            if (!isRecord(check)) {
                return {
                    ok: false,
                    error: `reviewed.checks[${index}] must be an object ({id, verdict, why?}): the value is ${describeTypeOf(check)}`,
                };
            }
            if (!nonemptyString(check['id'])) {
                return { ok: false, error: `reviewed.checks[${index}].id must be a non-empty string: the value is ${describeTypeOf(check['id'])}` };
            }
            /**
             * ★★ `verdict` 必须是**认得的**取值 —— 而那与"它是不是一个字符串"是两件事：
             *   `verdict: "maybe"` 是一个良构的字符串，而它不是一个结论。
             *   ⇒ 分开报（一个说"要是字符串"，一个说"取值认不得"）。
             *
             * ── ★★★ MEASURED（本任务的对**对照臂**当场抓出来的一个真错）────────────────────
             *
             * ★ 第一版这里用的是 `isReviewVerdict` —— 而它判的是 **`REVIEW_VERDICTS`**
             *   （`pass / needs_revision / reject`），那是**任务级**的 review 结论。
             *   ⇒ 于是 `verdict: 'fail'` 与 `'unmeasured'` 被**错误地拒掉**，
             *     而那一格要的恰恰是 **逐条五问**的三态（`pass / fail / unmeasured`，
             *     见 `ReviewedCheck.verdict` 的文档与 `friction-triage` 的 `adversarialReview`）。
             *
             * ★★ 而抓到它的正是那条**对照臂**（"合法 reviewed 必须通过"）——
             *   若没有它，上面那些"形状坏 ⇒ 拒绝"的臂会**全部照样绿**，
             *   而实现会把**每一条正当的逐条结论**（fail / unmeasured）一并拒掉。
             *   ⇒ ★ 那就是契约为什么要那条对照臂：**缺它就无法区分"校验有效"与"校验在乱拒"。**
             *
             * ★ 所以这里用**逐条 check 自己的**三态，而不是任务级那一套 —— 两者是不同的东西。
             */
            if (!isReviewedCheckVerdict(check['verdict'])) {
                return {
                    ok: false,
                    error: `reviewed.checks[${index}].verdict must be one of ${REVIEWED_CHECK_VERDICTS.join(' / ')}: `
                        + `the value is ${describeTypeOf(check['verdict'])}`,
                };
            }
        }
    }
    const dependencies = input.dependencies ?? [];
    for (const dependency of dependencies) {
        const upstream = team.tasks.find((item) => item.id === dependency);
        if (upstream === undefined) {
            return { ok: false, error: `dependency "${dependency}" does not exist` };
        }
        if ((kind === 'repair' || kind === 'review') && (upstream.status === 'failed' || upstream.status === 'cancelled')) {
            return { ok: false, error: `${kind} must not depend on ${upstream.status} task "${dependency}"` };
        }
    }
    /**
     * ── ★★ 触发点收窄：只在 `inScope` 真的被校验时检查（t40 修 f-0019 的第二半）───
     *
     * `input.inScopeTouched === false` ⇒ 调用方明确说"这次改的不是 inScope" ⇒ 整块跳过。
     * ★ `undefined` **不**跳（见 interface 里那段三态说明）：缺省 = 今天的行为，
     *   于是一个还没接线的调用方不会静默地失去这条护栏。
     */
    if (WRITE_KINDS.includes(kind) && nonemptyStringList(input.inScope) && input.inScopeTouched !== false) {
        for (const other of team.tasks) {
            if (!WRITE_KINDS.includes(taskKindOf(other)))
                continue;
            if (!OPEN_STATUSES.includes(other.status))
                continue;
            /**
             * ── ★★ 豁免必须是【双向的】（t40 修 f-0019）─────────────────────────────
             *
             * MEASURED（2026-10-07，captain 亲手撞上、本任务复现）：
             *
             *     图中 t22 依赖 t18，两者 inScope 都含 src/tools.ts
             *     ⇒ 校验 t18 被拒：`inScope overlaps t22 at src/tools.ts; serialize
             *       these tasks or split the paths`
             *
             * 而护栏此前只豁免**一个方向**：
             *
             *     if (dependencies.includes(other.id) || other.dependencies.includes('pending-new')) continue
             *       ↑ "我依赖它"  ⇒ 当【别人依赖我】时这一句为假 ⇒ 拒绝
             *
             * ⇒ 一条**已声明的依赖链**恰恰**证明**这两个任务的写域会被串行执行
             *   （上游不到终态，下游就不会被派发）。那种重叠是**设计的一部分**，不是冲突。
             *   把它当成冲突，等于让合法链上的两个任务**无法同时被编辑** ——
             *   而"改依赖"正是这条链最需要被改的时刻。
             *
             * ★★ 而 `other.dependencies.includes('pending-new')` 那半句是**死代码**：
             *   任务 id 由调度器分配（`t1`/`t2`…），没有任何一条依赖会真的是那个字面量。
             *   它看起来像"已经考虑过第二个方向"，而实际一个方向都没豁免到。
             *   ⇒ 删掉，换成下面那条**真的**双向判定。
             *
             * ── 双向怎么判（两个方向各一条，缺一不可）───────────────────────────────
             *
             *   ① 我依赖它：`dependencies` 的闭包含 `other.id`
             *   ② 它依赖我：`other` 的闭包里含**本候选任务自己的 id**
             *
             * ★ 用【闭包】而不是直接那一格：依赖可以是**间接**的（t24 → t22 → t18），
             *   而间接关系同样保证串行。只查直接那一格，会让"隔一层的合法重叠"继续被
             *   误伤 —— 而那种误伤更难归因（报错只提 the other task 的 id）。
             *
             * ★★ 而本候选任务的 id 从哪来：`CreateTaskInput` **没有 id 那一格**
             *   （建任务时它还不存在）。但**更新路径**（`updatePlanBatch` / amend）
             *   传进来的就是一个**完整的既有任务**（带 id），且调用方已经把它从
             *   `team.tasks` 里滤掉。⇒ 取 `(input as { id?: unknown }).id`：
             *     · 有 id（更新路径）⇒ 方向 ② 可判
             *     · 无 id（建任务）  ⇒ 方向 ② 无从谈起（新任务不可能是别人的上游，
             *       因为还没有任何任务能依赖一个不存在的 id）⇒ 跳过方向 ② 是对的
             *   ★ 这**不是**放宽：建任务路径下方向 ② 在语义上**必然为假**，
             *     跳过它与"判了、结果为假"同义。
             */
            const candidateId = input.id;
            const iDependOnOther = dependencyClosureContains(team.tasks, dependencies, other.id);
            const otherDependsOnMe = typeof candidateId === 'string' && candidateId !== ''
                && dependencyClosureContains(team.tasks, [other.id], candidateId);
            if (iDependOnOther || otherDependsOnMe)
                continue;
            const overlap = inScopeOverlap(input.inScope, other.inScope);
            if (overlap.length > 0) {
                return {
                    ok: false,
                    error: `inScope overlaps ${other.id} at ${overlap.join(', ')}; serialize these tasks or split the paths`,
                };
            }
        }
    }
    if (kind === 'implementation') {
        const requirements = team.tasks.filter((item) => taskKindOf(item) === 'requirements');
        const passed = requirements.some((item) => item.status === 'completed' && item.verdict === 'pass');
        const behindRequirements = requirements.some((item) => (dependencyClosureContains(team.tasks, dependencies, item.id)));
        // Planning an implementation is safe in either approval mode when its
        // dependency chain fences execution behind requirements. Scheduling and
        // claiming still wait for successful dependency completion.
        if (requirements.length > 0 && !passed && !behindRequirements) {
            return {
                ok: false,
                error: 'implementation must depend on a requirements task until requirements completes with verdict=pass',
            };
        }
    }
    const nextTeam = team.halted === true && input.resume === true
        ? { ...team, halted: false, haltedAt: undefined }
        : team;
    return {
        ok: true,
        kind,
        team: nextTeam,
        task: {
            subject: input.subject,
            kind,
            ...input.description === undefined ? {} : { description: input.description },
            ...input.assignee === undefined ? {} : { assignee: input.assignee },
            dependencies,
            ...input.round === undefined ? {} : { round: input.round },
            ...input.objective === undefined ? {} : { objective: input.objective },
            ...input.inScope === undefined ? {} : { inScope: input.inScope },
            ...input.outOfScope === undefined ? {} : { outOfScope: input.outOfScope },
            ...input.acceptance === undefined ? {} : { acceptance: input.acceptance },
            ...input.verify === undefined ? {} : { verify: input.verify },
            ...input.deliverables === undefined ? {} : { deliverables: input.deliverables },
            ...input.nonGoals === undefined ? {} : { nonGoals: input.nonGoals },
            ...input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId },
            ...input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId },
            ...input.sourceFindingIds === undefined ? {} : { sourceFindingIds: input.sourceFindingIds },
            ...input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf },
        },
    };
}
const STATUS_TRANSITIONS = {
    pending: ['claimed', 'cancelled'],
    claimed: ['in_progress', 'failed', 'cancelled'],
    in_progress: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
};
function openHighFindings(findings) {
    return (findings ?? []).filter((finding) => (finding.resolved !== true && (finding.severity === 'high' || finding.severity === 'blocker')));
}
/**
 * 从 `_verified_at` 的自由文本里取出行首那个 ref。
 *
 * ★ 那一段是**给人读的**（`ba32130（本 worktree 的 HEAD，且无源码改动）。★ 名单由…`），
 *   所以只取**第一个 token**，并要求它看起来像一个 ref（十六进制串 / 常见的 ref 名）。
 *   ★ 取不到 ⇒ 返回 `undefined` ⇒ 整份判不了（不猜一个"大概的" commit）。
 */
function pinRefFromVerifiedAt(text) {
    const head = text.trim().split(/[\s（(]/)[0] ?? '';
    /** ★ 只接受两种形状：7 位以上的十六进制串，或 `refs/…` / 常见的分支名式 token。 */
    if (/^[0-9a-f]{7,40}$/i.test(head))
        return head;
    if (/^refs\/[\w./-]+$/.test(head))
        return head;
    return undefined;
}
/**
 * ── ★★★ 为什么这里【不能】import `pluginRoot()`（2026-10-10 实测）────────────────
 *
 * MEASURED（`verifier` 在 t22 上查出，而它跑的是【父修订的独立 worktree】）：
 *   曾有一版 `import { pluginRoot } from './tools/shared/entities.ts'` ——
 *   而那条边**闭合了一个既存的环**：
 * ```
 *   changed-paths.ts  → quality-gates.ts          ← 早已存在
 *   quality-gates.ts  → tools/shared/entities.ts  ← ★ 那一条（它新增的）
 *   entities.ts       → gates/index.ts            ← 早已存在
 *   gates/index.ts 在【顶层】执行 buildRegistry()
 * ```
 *   ⇒ ★ 从 `changed-paths` 进入时，`gates/index` 的模块体还没跑完
 *     ⇒ `Cannot access 'id' before initialization`（TDZ）
 *   ⇒ ★ 而 `typeof module.id === 'string'` **挡不住 TDZ**（TDZ 会抛，不返回 undefined）
 *
 * ★★ 所以这里【本地化】那份逻辑，而不是 import ——
 *   因为"读一个 fixtures 文件"不值得新开一条【跨模块的边】，
 *   而当那条边能把一个既存的环闭合时，它就不只是"多一个依赖"。
 * ★ 而它与 `pluginRoot()` 的语义**必须一致**（同一个 dirname 链，层数同）——
 *   见 `entities.ts` 里那条 `t39：层数 2 → 4` 的注释。
 */
function localPluginRoot() {
    /**
     * ★★★ 层数是【由这个文件自己的位置】定的，不是照抄别人的（2026-10-10 实测）──────
     *
     * MEASURED（我第一版照抄了 `entities.pluginRoot` 的 4 层 —— 而那把根算成了 `/Users`）：
     * ```
     *   entities.js      住在 lib/tools/shared/ ⇒ 4 层 = 仓库根
     *   quality-gates.js 住在 lib/             ⇒ ★ 只需 2 层
     * ```
     * ⇒ ★ 而它的后果【不是报错】—— `baselinePin()` 读不到那个文件 ⇒ 返回 `undefined`
     *   ⇒ 而下游把"读不到基线"读成【判不了】⇒ ★ 于是 t19 那条判据永久 undecidable
     *   ⇒ ★★ 而"我少算了两层"与"基线清单不存在"在读数上【同形】——
     *     两者都表现为 `baselinePin() === undefined`。
     *
     * ★ 所以这里按【本文件的真实位置】算，并用一条臂钉住它（臂 7：读出来的路径必须真的存在）。
     */
    return dirname(dirname(fileURLToPath(import.meta.url)));
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
export function baselinePin() {
    try {
        const raw = readFileSync(join(localPluginRoot(), 'scripts', 'fixtures', 'baseline-known-failures.json'), 'utf8');
        const parsed = JSON.parse(raw);
        const entries = parsed.knownFailures;
        if (!Array.isArray(entries))
            return undefined;
        const names = entries
            .map((entry) => (typeof entry === 'object' && entry !== null ? entry.test : undefined))
            .filter((name) => typeof name === 'string' && name.trim() !== '')
            .map((name) => name.trim());
        if (names.length === 0)
            return undefined;
        /** ★★ 参照物那两格：任一格读不出来 ⇒ 判不了（见上面的注释）。 */
        const atText = typeof parsed._verified_at === 'string' ? parsed._verified_at.trim() : '';
        const by = typeof parsed._pinned_by === 'string' ? parsed._pinned_by.trim() : '';
        const at = atText === '' ? undefined : pinRefFromVerifiedAt(atText);
        if (at === undefined || by === '')
            return undefined;
        return { names, at, by };
    }
    catch {
        return undefined;
    }
}
function classifyVerifyFailures(failedCommands) {
    /** ① 每一份失败明细都要能读出来 —— 缺一条就判不了（不猜）。 */
    const names = [];
    for (const command of failedCommands) {
        const failures = command.failures;
        if (!Array.isArray(failures)) {
            return { kind: 'undecidable', why: `the failed verify command "${command.command}" reported no per-test failures, so which tests failed could not be read` };
        }
        for (const failure of failures) {
            if (typeof failure !== 'string' || failure.trim() === '') {
                return { kind: 'undecidable', why: `the failed verify command "${command.command}" has a failure entry that is not a readable test name` };
            }
            names.push(failure.trim());
        }
    }
    /**
     * ② 而"一条失败明细都没有"与"read 不出明细"是两件事：
     *    前者是"失败了而说不出哪几条" ⇒ ★ 那仍然判不了（不是"没有新增"）。
     */
    if (names.length === 0) {
        return { kind: 'undecidable', why: 'a verify command failed but named no failing tests' };
    }
    /**
     * ③ 基线读不出来 ⇒ 判不了（不许读成"基线是空的"）。
     *   ★ 而"读不出来"含**两种**：名单读不出，或**参照物读不出**（见 `BaselinePin`）。
     */
    const pin = baselinePin();
    if (pin === undefined) {
        return { kind: 'undecidable', why: 'the pinned baseline of known failures could not be read (either its list or the commit it was measured at), so "is this one new" could not be answered' };
    }
    const known = new Set(pin.names);
    const fresh = names.filter((name) => !known.has(name));
    const alsoInBaseline = names.filter((name) => known.has(name));
    return fresh.length === 0
        ? { kind: 'no-new-failures', total: names.length, baseline: known.size, at: pin.at, by: pin.by }
        : { kind: 'new-failures', names: fresh, alsoInBaseline, at: pin.at, by: pin.by };
}
function distributionError(distinction) {
    if (distinction.kind === 'new-failures') {
        return 'verify failure must fail the task: these failures are NOT in the pinned baseline, so this delivery introduced them — '
            + distinction.names.join(' · ')
            + ` (baseline: ${distinction.at}, pinned by ${distinction.by})`
            /**
             * ★★ 而**基线里那几条也要点名**（t19 臂 2）：否则读的人只看到"新的那些"，
             *   无从分辨"这一堆里哪条是旧的、哪条是新的" —— 而分辨它们**正是这条判据的产物**。
             *   ★ 而措辞必须说清"这些**不是**拒的原因"，免得读的人以为它们也有问题。
             */
            + (distinction.alsoInBaseline.length === 0
                ? ''
                : `. Not the reason for the refusal (they are in the baseline): ${distinction.alsoInBaseline.join(' · ')}`);
    }
    if (distinction.kind === 'undecidable') {
        return 'verify failure must fail the task, and whether it is new could not be measured: '
            + distinction.why
            + ' — "could not measure" is not "nothing new", so this stays refused.';
    }
    return 'verify failure must fail the task';
}
/**
 * ── ★★ 而这句是**读数**，不是错误信息：交付【允许通过】时也必须说得出参照物 ─────────
 *
 * 它给调用方用来在"允许 completed"那条路上留痕 ——
 * ★ 否则"它通过了"与"它没有遇到失败"在读的人眼里同形，
 *   而"通过了，因为这几条都在 `<commit>` 的基线里"是**可核的**那一句。
 */
function noNewFailuresNote(distinction) {
    return `${distinction.total} verify failure(s) are all in the pinned baseline `
        + `(${distinction.at}, pinned by ${distinction.by}; ${distinction.baseline} known), so none of them is new here`;
}
function acceptanceCovered(required, results) {
    if (results === undefined)
        return false;
    const byCriterion = new Map(results.map((item) => [item.criterion, item]));
    if ((required ?? []).every((criterion) => byCriterion.get(criterion)?.status === 'passed'))
        return true;
    // Structured result arrays naturally preserve the contract order. Accept a
    // same-length all-pass report even when a model paraphrases punctuation or
    // whitespace in `criterion`; verification evidence remains independently
    // required below. This avoids turning display text into an opaque id.
    return results.length === (required ?? []).length && results.every((item) => item.status === 'passed');
}
/**
 * ── ★★★ `verify` 的每一条都被"覆盖"了吗（t19 修）─────────────────────────────────
 *
 * MEASURED（t19，本任务把这条量了出来）：
 *   本函数**曾经**只认 `status === 'passed'`（逐字）：
 *
 *     if ((required ?? []).every((command) => byCommand.get(command)?.status === 'passed')) return true
 *     return results.length === (required ?? []).length && results.every((item) => item.status === 'passed')
 *
 *   ⇒ ★★ 而它与 `classifyVerifyFailures` **对同一份 `commandsRun` 说话**：
 *     后者刚刚（在它之前）判出"这些失败都在基线里 ⇒ 允许 completed"，
 *     而本函数随后**无条件**要求每条 `passed` ⇒ **放行被架空**。
 *
 *   机械读数（t19 实测，同一份输入只动 `verify` 列表）：
 *     verify = ['pnpm test:gates']（该命令红、而失败全在基线里）
 *       ⇒ `{ ok: false, error: '… requires a passed commandsRun entry for every verify command' }`
 *       ★ 而那句来自【本函数】，不是来自三态裁决 —— 三态的放行【到不了】
 *     verify 只声明会绿的那条、把红的放进 `commandsRun` 但不列进 `verify`
 *       ⇒ `{ ok: true, notes: ['1 verify failure(s) are all in the pinned baseline …'] }`
 *   ⇒ ★ 同一个仓库事实，只因【它有没有被列进 verify】而给出相反裁决。
 *
 * ── 修法的边界（**不许放宽方向**）──────────────────────────────────────────────
 *
 *   一条 `failed` 的命令只有当**它的失败逐条都在钉住的基线里**时才算"覆盖"。
 *   ⇒ 而"新增了失败"仍然不覆盖（那一半不许松）；"判不了"也仍然不算覆盖（保守）。
 *   ★ 判据**不是**"命令是红的也能算覆盖"，而是"**这条红不是这次带来的**"。
 */
function verifyCovered(required, results) {
    if (results === undefined)
        return false;
    const byCommand = new Map(results.map((item) => [item.command, item]));
    /** ① 老路：每条都被一条 `passed` 的记录覆盖 ⇒ 覆盖（这一支一个字没动）。 */
    if ((required ?? []).every((command) => byCommand.get(command)?.status === 'passed'))
        return true;
    /**
     * ② 新路：某条 `verify` 命令是 `failed`，而**它的失败逐条都在基线里** ⇒ 也算覆盖。
     *    ★ 而它复用**同一个** `classifyVerifyFailures` —— 不许在这里另写一套"算不算存量"
     *      （两套会分叉，而分叉之后"这条算不算新"在两处给出不同答案，本仓那条纪律正是拦这个）。
     */
    const failedRequired = (required ?? [])
        .map((command) => byCommand.get(command))
        .filter((item) => item !== undefined && item.status === 'failed');
    if (failedRequired.length === 0) {
        /** 没有任何一条 `verify` 是"有记录且红"的 ⇒ 老路那条 `every(passed)` 已经判过了。 */
        return results.length === (required ?? []).length && results.every((item) => item.status === 'passed');
    }
    const distinction = classifyVerifyFailures(failedRequired);
    /** ★ 只有 `no-new-failures` 才算覆盖；`new-failures` 与 `undecidable` 都不算。 */
    return distinction.kind === 'no-new-failures';
}
export function readContractGateVerdict(gates) {
    /**
     * ★★★ 顺序有理由：**`unmeasured` 先判**。
     *   一份裁决可以同时 `ok:false` 而 `blockers` 为空（那就是 `unmeasured` 的形状）。
     *   ⇒ 先判 `blockers` 会把"测不了"读成"不行"，而那是本条要修的那条错的**镜像**。
     */
    if (gates.unmeasured !== undefined) {
        return {
            disposition: 'unmeasured',
            rejects: false,
            leavesTrace: true,
            reason: `the contract gate could not measure this: ${gates.unmeasured}`
                + ' ★ That is "I could not tell", not "it is wrong" — so the contract is allowed through '
                + 'and the fact that this step was NOT checked is recorded. A safety constraint that does '
                + 'not fire must not refuse everything.',
        };
    }
    if (gates.blockers.length > 0) {
        return {
            disposition: 'blocked',
            rejects: true,
            leavesTrace: false,
            reason: `the contract gate refused this: ${gates.blockers.join('; ')}`,
        };
    }
    return {
        disposition: 'ok',
        rejects: false,
        leavesTrace: false,
        reason: 'the contract gate evaluated this and found nothing to refuse',
    };
}
export function evaluateQualityCompletion(task, update) {
    const nextStatus = update.status;
    /**
     * ★ 存量失败那一格的读数**跨块**要用（`ok: true` 那几条路上要把它交出去）⇒ 声明在这里。
     *   ★ 放在内层块里会让最后那个 `return` 读不到它（而那正是"编译期就能抓到"的一类错）。
     */
    let baselineNote;
    if (nextStatus !== undefined && nextStatus !== task.status) {
        if (!STATUS_TRANSITIONS[task.status].includes(nextStatus)) {
            return { ok: false, error: `task status cannot move from "${task.status}" to "${nextStatus}"` };
        }
    }
    const kind = taskKindOf(task);
    if (kind === 'work')
        return { ok: true };
    const verdict = update.verdict ?? task.verdict;
    const findings = update.findings ?? task.findings;
    if (kind === 'review' || kind === 'requirements') {
        if (nextStatus === 'completed') {
            if (verdict === undefined)
                return { ok: false, error: `${kind} cannot complete without verdict=pass` };
            if (verdict !== 'pass')
                return { ok: false, error: `${kind} with verdict=${verdict} cannot complete` };
            if (openHighFindings(findings).length > 0) {
                return { ok: false, error: `${kind} pass cannot leave unresolved high/blocker findings` };
            }
        }
        if (nextStatus === 'failed' && (verdict === 'needs_revision' || verdict === 'reject')) {
            if ((findings ?? []).length < 1) {
                return { ok: false, error: `${kind} ${verdict} requires at least one finding` };
            }
        }
        return { ok: true };
    }
    if (kind === 'implementation' || kind === 'repair' || kind === 'verification' || kind === 'integration') {
        const commands = update.commandsRun ?? task.commandsRun;
        /**
         * ── ★★★ 区分【本任务新增的失败】与【仓库存量失败】（t19）────────────────────
         *
         * 由来（MEASURED 2026-10-09，`verifier` 在 t5 上给出，而 captain 复核）：
         *   ```
         *   pnpm test:gates 真实 exit=1（23 条红，**没有一条属本夹具**）
         *   ⇒ 而本规则说「commandsRun 里有 failed ⇒ 不许 completed」
         *   ⇒ ★ 于是【17 条任务全部不可达 completed】—— 而它们的工作都做完了
         *   ```
         *   ★ 而 t5 的七次尝试里，最后一次的成因正是这一条（前六次各有各的因）。
         *
         * ★★ 而正确的分界是【这次交付有没有新增失败】：
         *   · 新增了失败（本任务自己的 verify 真红）⇒ 仍然只能 `failed`（那一半不许放宽）
         *   · 新增 0 条而仓库有存量红  ⇒ ★ 允许 `completed`，而那【不是撒谎】——
         *     `exit=1` 说的是"仓库里有红"，而它说的是"我没有新增红"。★ 两者是不同的量。
         *
         * ★ 而判据要的是【集合比对】，不是计数：
         *   同一个命令在三次运行里给出过 47 / 14 / 14 条失败（本会话实测）
         *   ⇒ ★ 计数不是证据，只有【哪几条】是。
         *
         * ★★★ 而"看不清"时不许读成"没有新增"：
         *   读不到证据行 / 读不到基线清单 ⇒ 退回旧行为（仍拒）——
         *   因为"我没能测量"不得读成"它没问题"（本会话最贵那条）。
         */
        const failedCommands = commands?.filter((item) => item.status === 'failed') ?? [];
        if (failedCommands.length > 0) {
            if (nextStatus === 'completed') {
                const distinction = classifyVerifyFailures(failedCommands);
                if (distinction.kind !== 'no-new-failures') {
                    return {
                        ok: false,
                        error: distributionError(distinction),
                        requiredStatus: 'failed',
                    };
                }
                /**
                 * ★★ 放行了，而**留痕**：这一条就是"凭什么"。★ 它同时把基线**是哪一次**说出来 ——
                 *   否则读的人无法核"那几条当初真的在基线里"。
                 */
                baselineNote = noNewFailuresNote(distinction);
            }
        }
        /**
         * ★ 非完成态：`baselineNote` 若在场（= 这次交付带着存量失败、而没要求 completed）
         *   也一并交出 —— "仓库现在有红"这件事与"我要不要交完成态"无关，而读的人该知道。
         */
        if (nextStatus !== 'completed')
            return baselineNote === undefined ? { ok: true } : { ok: true, notes: [baselineNote] };
        const acceptanceResults = update.acceptanceResults ?? task.acceptanceResults;
        if (acceptanceResults === undefined || !acceptanceCovered(task.acceptance, acceptanceResults)) {
            return { ok: false, error: `${kind} completion requires passed acceptanceResults for every acceptance item` };
        }
        if (commands === undefined || !verifyCovered(task.verify, commands)) {
            return { ok: false, error: `${kind} completion requires a passed commandsRun entry for every verify command` };
        }
        if (kind === 'implementation' || kind === 'repair') {
            const changed = update.changedPaths ?? task.changedPaths;
            if (changed === undefined) {
                return { ok: false, error: `${kind} completion requires changedPaths` };
            }
            for (const path of changed) {
                const classification = classifyChangedPath(path, task.inScope ?? [], task.outOfScope ?? []);
                if (classification !== 'in_scope') {
                    return { ok: false, error: `${kind} cannot complete: ${path} is ${classification}` };
                }
            }
        }
    }
    return baselineNote === undefined ? { ok: true } : { ok: true, notes: [baselineNote] };
}
function unresolvedFindings(task) {
    return (task.findings ?? []).filter((finding) => finding.resolved !== true);
}
function findingKey(ids) {
    return [...ids].sort().join(',');
}
/**
 * Path-like tokens worth considering as repair-scope candidates. Two shapes:
 * slash paths (`src/parser.ts`, `docs/guide.md`) and bare filenames with a
 * known code/doc extension (`README.md`, `wc.js`). An optional `:line`
 * suffix is tolerated and stripped. The extension allowlist keeps version
 * tokens (`v0.1.17`), hex hashes, and prose out of the derived scope.
 */
const REPAIR_SCOPE_PATH_PATTERN = /(?:[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+|[\w.\-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|txt|ya?ml|py|rs|go|java|html?|css|scss|sh|ps1|toml|xml|sql))(?::\d+)?/gu;
const REPAIR_SCOPE_LINE_SUFFIX = /:\d+$/;
/**
 * ── ★★★ t96（上游 #174 的一半）：**行号锚点在编辑后无法存活** ───────────────────────
 *
 * Root cause (upstream #174, verbatim): "Auto-generated repair work orders were
 * frozen at finding-generation time." A finding carries `file + line` (and its
 * `requiredFix` text often spells `file.ts:42` or `foo.go:503-505`). The moment
 * ANY edit lands above that line, every downstream line number shifts — and the
 * acceptance text then points at code that is no longer the finding. The anchor
 * that DOES survive an edit is the file path plus the fix's own wording: a
 * content anchor. So generated contract text loses the line suffix and keeps
 * everything else.
 *
 * ★★ 为什么"剥得准"是本函数全部的难点（反向半边 B/C 的落点）：
 * ```
 *   ✅ 该剥：  src/a.ts:42 · foo.go:503-505 · lib/x.ts:12      ← 路径 + 行号
 *   ❌ 不该剥：12:30（时间）· https://x（URL）· v1:2（版本段）
 * ```
 * 判据（三条 lookbehind，缺一不可 —— 不是一刀切）：
 *   1. **锚点之前必须有一个"带点的路径形态"的词**（lookbehind：
 *      `[A-Za-z0-9_./\\-]*\.[A-Za-z0-9_./\\-]*` —— 词内**必须含一个点**）——
 *      这一条排掉 `12:30`（裸数字无点）、`3:1`（比分）、`v1:2`（版本段的 `v1` 无点）；
 *   2. **前面不能是 `//`**（`(?<!\/\/)`）—— URL 的 scheme；
 *   3. **前面那段路径不能以 `//` 开头**（`(?<!\/\/[A-Za-z0-9_./\\-]*)`，词类含 `/` 可左伸）——
 *      排掉 `http://localhost:3000` / `http://example.com:8080` 这类**主机带端口**的 URL
 *      （`localhost` 与 `example.com` 本身就"带点形态"，第 1 条拦不住它，必须靠这条）。
 * ★ 上游用的是同一条思路（lookbehind + 路径字符前缀）；本仓的反向半边 B/C 更严
 *   （要保住 `http://host:port`），所以比上游多第 3 条。
 */
const LINE_ANCHOR_PATTERN = /(?<!\/\/)(?<!\/\/[A-Za-z0-9_./\\-]*)(?<=[A-Za-z0-9_./\\-]*\.[A-Za-z0-9_./\\-]*):\d+(?:-\d+)?\b/gu;
/**
 * Remove drifting line anchors from generated contract text.
 *
 * 纯函数：输入文本 ⇒ 输出文本；不改写其余任何内容（时间、URL、版本号原样保留）。
 * ★ 落点：repair/requirements 轮次的 `acceptance` 直接取 `finding.requiredFix`
 *   （那里面常带 `file.ts:42`）⇒ 生成契约前过一遍本函数（上游 #174 的落点）。
 */
export function stripLineAnchors(text) {
    return text.replace(LINE_ANCHOR_PATTERN, '');
}
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
export function repairScopeFromFindings(findings, fallback) {
    const derived = [];
    /**
     * ── ★★★ t95：**推导侧现在用与闸门同一个谓词**（上游 #183）────────────────────
     *
     * ★ 上面那段长注释（"Keep all derived paths until the generator resolves
     *   inherited exclusions; filtering first would silently discard a required
     *   fix target"）**方向是对的，但只做了一半** —— 它说"等生成器去解析排除"，
     *   而**生成器从来没有做那个解析** ⇒ 被排除的路径**原样进了 inScope**。
     *
     * ★★ 后果（t95 开工实测）：
     * ```
     * 推导 ⇒ inScope = ["secrets/k.json", …]
     * 闸门 ⇒ classifyChangedPath("secrets/k.json") = "out_of_scope"   ← 它【第一行】就查这个
     * ⇒ ★★★ 契约自身不可满足：成员把那条路径做完，闸门照样拒。
     * ```
     *
     * ⇒ 所以排除**在这里做**，而且用 `isDefaultExcludedPath`（**同一个**）。
     *   ★ 那正是"不改注释、改行为"的那一半 —— 注释说"稍后解析"，而这里就是"稍后"。
     *
     * ★ 而"silently discard a required fix target"那条顾虑**仍然成立**，所以它
     *   **不是**被丢掉了：{@link excludedFindingsOf} 会把"每条候选路径都被排除"
     *   的 finding **单独挑出来**，由调用方**升级并给理由**（不是静默丢）。
     *   ⇒ 两条顾虑各有各的落点，不再互相抵消。
     */
    for (const finding of findings) {
        for (const path of findingDerivedPaths(finding)) {
            if (isDefaultExcludedPath(path) || derived.includes(path))
                continue;
            derived.push(path);
        }
    }
    return derived.length > 0 ? derived : fallback === undefined ? undefined : [...new Set(fallback)];
}
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
export function findingDerivedPaths(finding) {
    const paths = [];
    const push = (raw) => {
        const normalized = normalizeWorkspacePath(raw.replace(REPAIR_SCOPE_LINE_SUFFIX, ''));
        if (normalized === undefined || paths.includes(normalized))
            return;
        paths.push(normalized);
    };
    if (nonemptyString(finding.file))
        push(finding.file);
    for (const match of finding.requiredFix.matchAll(REPAIR_SCOPE_PATH_PATTERN))
        push(match[0]);
    return paths;
}
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
export function excludedFindingsOf(findings) {
    return findings.filter((finding) => {
        const paths = findingDerivedPaths(finding);
        return paths.length > 0 && paths.every((path) => isDefaultExcludedPath(path));
    });
}
const AMENDABLE_CONTRACT_FIELDS = ['objective', 'acceptance', 'verify', 'inScope', 'outOfScope'];
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
export function amendTaskContract(team, task, input, by, reason) {
    if (!nonemptyString(by))
        return { ok: false, error: 'contract amendment requires a non-empty author identity' };
    if (!nonemptyString(reason))
        return { ok: false, error: 'contract amendment requires a non-empty reason' };
    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
        return { ok: false, error: `task ${task.id} is ${task.status}; terminal contracts are immutable` };
    }
    if (taskKindOf(task) === 'work') {
        return { ok: false, error: `task ${task.id} has kind=work and no contract to amend` };
    }
    if (!AMENDABLE_CONTRACT_FIELDS.some((field) => input[field] !== undefined)) {
        return { ok: false, error: `amendment requires at least one of: ${AMENDABLE_CONTRACT_FIELDS.join(', ')}` };
    }
    const next = {};
    const previous = {};
    if (input.objective !== undefined) {
        if (!nonemptyString(input.objective)) {
            return { ok: false, error: 'amended objective must be a non-empty string' };
        }
        next['objective'] = input.objective;
        previous['objective'] = task.objective;
    }
    for (const field of ['acceptance', 'verify']) {
        const value = input[field];
        if (value === undefined)
            continue;
        if (!nonemptyStringList(value)) {
            return { ok: false, error: `amended ${field} must be a non-empty list of non-empty strings` };
        }
        next[field] = value;
        previous[field] = task[field];
    }
    for (const field of ['inScope', 'outOfScope']) {
        const value = input[field];
        if (value === undefined)
            continue;
        if (!nonemptyStringList(value)) {
            return { ok: false, error: `amended ${field} must be a non-empty list of non-empty strings` };
        }
        for (const entry of value) {
            if (normalizeWorkspacePath(entry) === undefined) {
                return {
                    ok: false,
                    error: `amended ${field} entry "${entry}" is not a workspace-relative path (absolute paths and ".." can never match scope patterns)`,
                };
            }
        }
        next[field] = value;
        previous[field] = task[field];
    }
    const reviewPassed = team.tasks.some((item) => ((taskKindOf(item) === 'review' || taskKindOf(item) === 'requirements')
        && item.reviewedTaskId === task.id
        && item.verdict === 'pass'));
    if (reviewPassed) {
        return { ok: false, error: `task ${task.id} already passed review; its contract is frozen` };
    }
    const revision = {
        at: Date.now(),
        by,
        reason,
        fields: Object.keys(next),
        previous,
    };
    return {
        ok: true,
        revision,
        task: {
            ...task,
            ...next,
            revisions: [...(task.revisions ?? []), revision],
            updatedAt: Date.now(),
        },
    };
}
const CAPTAIN_ASSIGNEE = 'captain';
const OPEN_FOLLOW_UP_STATUSES = ['pending', 'claimed', 'in_progress'];
function schedulableAssignee(preferred, team, forbidden) {
    if (preferred !== undefined && preferred !== CAPTAIN_ASSIGNEE && preferred !== forbidden) {
        const live = team.members.find((member) => member.name === preferred && member.status !== 'removed');
        if (live !== undefined)
            return live.name;
    }
    return team.members.find((member) => (member.status !== 'removed'
        && member.name !== CAPTAIN_ASSIGNEE
        && member.name !== forbidden))?.name;
}
function countRepairAttempts(team, sourceTaskId, findingIds) {
    const key = findingKey(findingIds);
    return team.tasks.filter((item) => (taskKindOf(item) === 'repair'
        && item.sourceTaskId === sourceTaskId
        && findingKey(item.sourceFindingIds ?? []) === key)).length;
}
function hasOpenFollowUp(team, sourceTaskId, findingIds) {
    const key = findingKey(findingIds);
    return team.tasks.some((item) => (taskKindOf(item) === 'repair'
        && item.sourceTaskId === sourceTaskId
        && findingKey(item.sourceFindingIds ?? []) === key
        && OPEN_FOLLOW_UP_STATUSES.includes(item.status)));
}
/** Drop previous-round exclusions that intersect this generated repair's scope. */
function withoutScopeConflicts(outOfScope, inScope) {
    if (outOfScope === undefined)
        return undefined;
    const conflicting = new Set(inScopeOverlap(outOfScope, inScope ?? []));
    return outOfScope.filter((pattern) => !conflicting.has(pattern));
}
/**
 * 判一条 review / requirements 任务的**独立性**。
 *
 * ★ 纯函数：只读传入的两格（与 `artifactBindingOf` / `testFileBaselineOf` 同一条纪律）。
 *
 * @param reviewer - 生成时指给它的审查者（`assignee`）。**缺席 = 落进共享池**。
 * @param implementer - 它审的那件事的实现者。**读不出 ⇒ 缺席**。
 */
export function independenceOf(reviewer, implementer) {
    /**
     * ★ 先判"读不出实现者" —— 因为在这一支里，即使审查者**在场**，
     *   我们也说不出"他是不是那个人"。★ 顺序不能反：反过来会把
     *   "审查者 ≠ 未知的人"读成 `independent`（一个**恒真**的判断）。
     */
    if (implementer === undefined || implementer === '') {
        return {
            status: 'undecidable',
            ...reviewer === undefined || reviewer === '' ? {} : { reviewer },
            why: 'the identity that did the work this review judges could not be read, so whether the reviewer is independent of it cannot be decided',
        };
    }
    /**
     * ── ★★ 一个**缺席的审查者**在这里**不是** `undecidable` ────────────────────────
     *
     * `assignee === undefined` ⇒ 这条任务落进**共享池** ⇒ **包括实现者在内的任何人**都能领它。
     * ⇒ 那不是"判不了"，那是一个**结论**："它的独立性没有被保证。"
     *   ★ 把这一支读成 `undecidable` 会让它看起来像"基础设施故障"，
     *     而真相是**设计上的一个缺口** —— 两者的补救动作不同。
     */
    if (reviewer === undefined || reviewer === '') {
        return {
            status: 'not-independent',
            implementer,
            why: 'no reviewer was named when this review was generated, so it went to the shared pool where the implementer can claim it — its independence is not guaranteed',
        };
    }
    if (reviewer === implementer) {
        return {
            status: 'not-independent',
            reviewer,
            implementer,
            why: `"${reviewer}" would also do the work this review judges — the same identity may not review its own work`,
        };
    }
    return { status: 'independent', reviewer, implementer };
}
export function planQualityFollowUp(team, closed) {
    const empty = { created: [], tasks: [] };
    const kind = taskKindOf(closed);
    if ((kind !== 'review' && kind !== 'requirements') || closed.status !== 'failed')
        return empty;
    if (closed.verdict === 'reject')
        return { ...empty, escalated: true, status: 'escalated' };
    if (closed.verdict !== 'needs_revision')
        return empty;
    const policy = resolveReviewPolicy(team.reviewPolicy);
    const currentRound = closed.round ?? 1;
    const nextRound = currentRound + 1;
    const maxRounds = kind === 'requirements' ? policy.requirementsMaxRounds : policy.codeMaxRounds;
    if (nextRound > maxRounds)
        return { ...empty, escalated: true, status: 'escalated' };
    if (kind === 'requirements') {
        const next = {
            kind: 'requirements',
            subject: `requirements-round-${nextRound}`,
            assignee: closed.assignee,
            dependencies: [],
            round: nextRound,
            objective: sanitizeReviewObjective(closed.objective, 'Converge remaining open questions'),
            /**
             * ★ t96：requirements 轮次的 acceptance **同样**取自 requiredFix ⇒ 同样过剥离
             *   （同一根因：行号锚点在这里一样活不过编辑）。★ 未验证声明在 requirements
             *   轮次同样成立 —— 那些是审查员对需求文本的判断，插件同样没验证过。
             *   ★ 它放在 sanitize **之后**追加（sanitize 会把空清单换成缺省，
             *     若在其前面追加会被那张缺省表淹没——而声明必须恒在场）。
             */
            acceptance: [
                ...sanitizeReviewAcceptance(unresolvedFindings(closed).map((finding) => stripLineAnchors(finding.requiredFix))),
                'the plugin has NOT verified these findings\' claims - verify each against the current requirements text before fixing',
            ],
        };
        return { created: [next], tasks: [next] };
    }
    const sourceId = closed.reviewedTaskId ?? closed.sourceTaskId;
    if (sourceId === undefined)
        return empty;
    const source = team.tasks.find((item) => item.id === sourceId);
    const findings = unresolvedFindings(closed);
    const findingIds = findings.map((finding) => finding.id);
    if (hasOpenFollowUp(team, sourceId, findingIds))
        return empty;
    if (countRepairAttempts(team, sourceId, findingIds) >= policy.maxRepairAttempts) {
        return { ...empty, escalated: true, status: 'escalated' };
    }
    // inScope is derived from the findings below: the observed file plus any
    // workspace-relative paths referenced by the requiredFix instructions.
    /**
     * ── ★★★ t95（上游 #183）：**每条候选路径都被排除**的 finding ⇒ 升级，不死锁 ─────────
     *
     * ★ 上游逐字：「findings whose every cited path is excluded **escalate with a
     *   reason instead of dead-locking a member.**」
     *
     * ★★ 为什么这比"过滤掉就算了"更对：把那些 finding 静默滤掉之后，
     *   生成的契约**看起来是干净的**（inScope 里没有被排除的路径），
     *   而它们**指出的缺陷一条都没被修** ⇒
     *   ★ **"修好了"与"从来没修"在报告里同形**（本仓记账最久的形态）。
     *   ⇒ 所以这里的判据是：**一条 actionable 的 finding 都不剩** ⇒ 停下来找人。
     *
     * ★ 而**还有** actionable 的 ⇒ 正常运行，但那些被排除的 finding
     *   **仍记在 `excludedFindings` 里**（不静默）—— 见下面的正常返回。
     */
    const excluded = excludedFindingsOf(findings);
    const actionable = findings.filter((finding) => !excluded.includes(finding));
    if (findings.length > 0 && actionable.length === 0) {
        return {
            ...empty,
            escalated: true,
            status: 'escalated',
            reason: `every finding of ${closed.id} cites only default-excluded paths`
                + ` (${excluded.map((finding) => finding.file ?? finding.id).join(', ')});`
                + ' the completion gate classifies those out_of_scope by default,'
                + ' so no honest repair contract exists - a human must decide',
            excludedFindings: excluded.map((finding) => finding.id),
        };
    }
    const repairScope = repairScopeFromFindings(actionable, source?.inScope);
    const implementer = schedulableAssignee(source?.assignee, team);
    const repair = {
        id: `repair-round-${nextRound}`,
        kind: 'repair',
        subject: `repair-round-${nextRound}`,
        assignee: implementer,
        dependencies: [sourceId],
        round: nextRound,
        objective: source?.objective ?? closed.objective ?? `Fix findings from ${sourceId}`,
        inScope: repairScope,
        outOfScope: withoutScopeConflicts(source?.outOfScope, repairScope),
        verify: source?.verify,
        /**
         * ── ★★★ t96（上游 #174 的落点）：acceptance 的两处生成时**都过一遍**剥离 ─────────
         *
         * ① `stripLineAnchors` —— `requiredFix` 常带 `file.ts:42` 形态的行号锚点，
         *    而锚点在编辑后无法存活（见 `LINE_ANCHOR_PATTERN` 的根因注释）。
         *    ★ 文件路径保留（那是能活过编辑的内容锚点的一部分）。
         * ② **未验证声明** —— 上游逐字："states that the plugin did not verify the
         *    finding's claims"。审查 finding 是**人/模型的判断**，本插件生成修复任务时
         *    **没有**独立验证过它说的是不是事实（那正是修复任务要去做的事）。
         *    ★★ 【未验证的不许读成已验证】：不写这句，成员会把 acceptance 文本
         *      当成"已被证实的问题清单"；写了这句，第一件事是**先核再修**。
         */
        acceptance: [
            ...findings.map((finding) => stripLineAnchors(finding.requiredFix)),
            'the plugin has NOT verified these findings\' claims - verify each against the current code before fixing (finding line numbers may have drifted)',
        ],
        sourceTaskId: sourceId,
        sourceFindingIds: findingIds,
    };
    const reviewer = schedulableAssignee(closed.assignee !== implementer ? closed.assignee : undefined, team, implementer);
    const review = {
        id: `review-round-${nextRound}`,
        kind: 'review',
        subject: `review-round-${nextRound}`,
        assignee: reviewer,
        /**
         * ── ★★★ 独立性读数：在**生成这一刻**算，并随任务落盘（2026-10-20，补 t6）────────
         *
         * ★ 为什么在生成时算、不留给下游：
         *   `reviewer` 是 `undefined` 时，那条任务进共享池 ⇒ 之后**谁领的都算数**
         *   ⇒ 真相（"生成时没指人"）在那一刻之后**就查不回来了**。
         *   而 `assignee` 后来被改成什么，与"它生成时独立吗"是两个量。
         *
         * ★★ 而没有这一格时，这个缺口是**静默**的：`reviewer === undefined`
         *   与"指了一个恰好等于实现者的人"在盘上**都是**"assignee 缺席 / 等于实现者"
         *   —— 但它们**不是同一件事**（一个能靠改派修，一个不能）。
         */
        reviewIndependence: independenceOf(reviewer, implementer),
        dependencies: [repair.id ?? `repair-round-${nextRound}`],
        round: nextRound,
        objective: sanitizeReviewObjective(closed.objective, DEFAULT_REVIEW_OBJECTIVE),
        acceptance: sanitizeReviewAcceptance(closed.acceptance),
        reviewedTaskId: repair.id,
    };
    return {
        created: [repair, review],
        tasks: [repair, review],
        /**
         * ★★ 而那些被排除的 finding **在这一支上也不能静默**（它们在下面是有账的）：
         *   正常支上它们不阻塞，但必须**读得出来** —— 否则"审查报了但它没进契约"这件事
         *   只能靠人去比对 findings 与 acceptance。
         * ★ 缺席（而不是空数组）当没有时：`undefined` = 没有，`[]` = "有这一格但是空的"。
         */
        ...excluded.length === 0 ? {} : { excludedFindings: excluded.map((finding) => finding.id) },
    };
}
export function buildCoverageMatrix(goalItems, tasks) {
    return goalItems.map((goalItem) => {
        const covering = tasks.filter((item) => item.coverageOf?.includes(goalItem));
        const taskIds = covering.map((item) => item.id);
        if (covering.length === 0)
            return { goal_item: goalItem, task_ids: taskIds, status: 'missing' };
        if (covering.some((item) => item.status === 'failed' || item.status === 'cancelled')) {
            return { goal_item: goalItem, task_ids: taskIds, status: 'blocked' };
        }
        if (covering.every((item) => item.status === 'completed')) {
            return { goal_item: goalItem, task_ids: taskIds, status: 'passed' };
        }
        return { goal_item: goalItem, task_ids: taskIds, status: 'in_progress' };
    });
}
export function canDeclareDelivery(team, audit) {
    const blockers = [];
    if (team.phase === 'staged')
        blockers.push('team plan is awaiting approval');
    if (team.halted === true)
        blockers.push('team is halted');
    if (team.escalated === true)
        blockers.push('team requires escalation resolution');
    if (team.tasks.length === 0)
        blockers.push('team has no completed work');
    for (const item of team.tasks.filter(item => !isQualityKind(taskKindOf(item)))) {
        if (item.status !== 'completed' && item.status !== 'cancelled')
            blockers.push(`${item.id} (${taskKindOf(item)}) is not completed`);
    }
    if (team.tasks.length > 0 && team.tasks.every(item => item.status === 'cancelled'))
        blockers.push('all work was cancelled');
    const quality = team.tasks.filter((item) => isQualityKind(taskKindOf(item)));
    const implementations = quality.filter((item) => taskKindOf(item) === 'implementation' || taskKindOf(item) === 'repair');
    const reviews = quality.filter((item) => taskKindOf(item) === 'review');
    for (const item of quality) {
        const kind = taskKindOf(item);
        if (item.status === 'completed') {
            if ((kind === 'review' || kind === 'requirements') && item.verdict !== 'pass') {
                blockers.push(`${item.id} completed without verdict=pass`);
            }
            continue;
        }
        if (item.status === 'failed') {
            const repaired = kind === 'review'
                ? quality.some((candidate) => (taskKindOf(candidate) === 'repair'
                    && candidate.sourceTaskId === (item.reviewedTaskId ?? item.sourceTaskId)
                    && (candidate.status === 'pending' || candidate.status === 'claimed' || candidate.status === 'in_progress' || candidate.status === 'completed')))
                : kind === 'requirements'
                    ? quality.some((candidate) => (taskKindOf(candidate) === 'requirements'
                        && (candidate.round ?? 1) > (item.round ?? 1)))
                    : quality.some((candidate) => (taskKindOf(candidate) === 'repair' && candidate.sourceTaskId === item.id));
            if (!repaired)
                blockers.push(`${item.id} failed without a follow-up repair`);
            continue;
        }
        if (item.status === 'cancelled')
            continue;
        blockers.push(`${item.id} (${kind}) is not completed`);
    }
    if (implementations.some((item) => item.status === 'completed') && !reviews.some((item) => item.status === 'completed' && item.verdict === 'pass')) {
        if (!blockers.some((item) => item.includes('review'))) {
            blockers.push('completed implementation has no passing review');
        }
    }
    for (const item of implementations) {
        for (const path of item.changedPaths ?? []) {
            if (classifyChangedPath(path, item.inScope ?? [], item.outOfScope ?? []) !== 'in_scope') {
                blockers.push(`${item.id} has unaudited path ${path}`);
            }
        }
    }
    /**
     * ── ★★★ t97（S1）：把每条**判决类**任务的绑定读数报出来 ────────────────────────────
     *
     * ★ 只在**传了 `audit`** 时算：缺席 ⇒ `verdictBindings` **缺席**
     *   （"这次没审计"与"审计了、全有效"必须不同形）。
     *
     * ★★ 而本函数**不用它改 `ok`**：S1 只"回答那三个问题"。
     *   拿它拦交付是 S3/S4 —— 那会改既有交付语义，超出本任务边界。
     */
    const verdictBindings = audit === undefined
        ? undefined
        : team.tasks
            .filter((item) => item.status === 'completed' && VERDICT_KINDS.includes(taskKindOf(item)))
            .map((item) => {
            /** ★ 当前摘要：只取这条判决**自己**绑过的那些路径（别人绑的不算它的）。 */
            const current = {};
            for (const artifact of item.reviewedArtifacts ?? []) {
                const now = (audit.artifacts ?? []).find((candidate) => candidate.path === artifact.path);
                if (now !== undefined)
                    current[artifact.path] = now.digest;
            }
            return {
                taskId: item.id,
                kind: taskKindOf(item),
                binding: artifactBindingOf(item.reviewedArtifacts, current),
                bound: (item.reviewedArtifacts ?? []).length,
            };
        });
    return {
        ok: blockers.length === 0,
        blockers,
        ...verdictBindings === undefined ? {} : { verdictBindings },
    };
}
export function resumeTeamState(team, reason) {
    if (!nonemptyString(reason)) {
        return { ok: false, status: 'rejected', error: 'resume requires a non-empty reason' };
    }
    /**
     * ── ★★★ 2026-10-20：补上本函数**自己在注释里点名过的那个缺口** ────────────────────
     *
     * 下面那段长注释逐字写着：
     * > 「**一个"已经超轮、但没被 halt"的 staged 团队，今天仍然没有解除路径**：
     * >   `approve` 会拒、`edit_plan` 只会把轮次推得更高、`resume` 返回 `already_running` 不动它。」
     *
     * ⇒ MEASURED（本仓真实死锁，就在写这一段的前一小时）：一个 `phase='staged'`、
     *   `planReviewRounds=5`、`planReviewEscalated=true`、**`halted` 为 undefined** 的队，
     *   批准被拒（对），而错误信息指向 `resume` 这条"唯一出路" —— 而 `resume` 对它
     *   答 `already_running` 且**一格都不动**。⇒ 那份计划**没有任何工具能放行**。
     *
     * ── 修法：把"已敲响计划审查上限"也算作**需要显式恢复的状态** ─────────────────
     *
     * ★ 它**不是**放宽：一个已经触顶的队本来就**不能开工**（`approve` 拒），
     *   所以它事实上处于"停着"的状态 —— 只是 `halted` 那个布尔没有表达它。
     *   把这一支并进来，等于让 `halted` 的语义从"被 halt"扩成
     *   "**当前不允许开工**"，而解除它的动作**仍然**是那个带非空理由的人工原语。
     *
     * ★★ 而它**必须仍然要求非空理由**（上面第一行已经管了）——
     *   解除一个触顶的计划是一个**决定**，不是一个清理动作。
     *   理由会进 `agent-teams/team-resumed` 事件，于是"谁在什么时候放过了它"可查。
     *
     * ★ 安全边界与原来**逐字相同**：只有 `planLoopEscalated` 为真时才动那两格；
     *   没超轮的队 ⇒ 一个字节都不变。
     */
    const roundsBefore = typeof team.planReviewRounds === 'number' && Number.isFinite(team.planReviewRounds)
        ? Math.max(0, Math.floor(team.planReviewRounds))
        : 0;
    const planLoopAlreadyEscalated = roundsBefore >= PLAN_REVIEW_MAX_ROUNDS || team.planReviewEscalated === true;
    if (team.halted !== true && !planLoopAlreadyEscalated) {
        return { ok: true, status: 'already_running', team };
    }
    /**
     * ── ★★★ N5 / t8：计划环的**显式归零**（这是"解除"两个允许落点之一）───────────────
     *
     * ★★ 为什么落在这里：N5.17 B4 实测出的死码 —— "下一次 `edit_plan` 打回 awaiting_review
     *   时清 flag" **毫无作用**，因为 `describePlanLoop` 会立刻从 `rounds >= maxRounds`
     *   重新算出 escalated。⇒ 解除**只能**是归零，而 `resume` 是唯一一个
     *   「带非空理由的显式人工动作」原语（另一个落点"人在批准时点名"需要
     *   `approveStagedTeam` 加第 4 个参数，而那个签名在 `entities.ts` 里，不在本任务写域）。
     *
     * ★ 安全边界是**收窄的**：只在**已经敲响上限**时才动那两格。
     *   - 没超轮的团队 ⇒ 一个字节都不变（存量行为逐字节相同，`quality-gates-tdd` 的
     *     `halted:true` 夹具因此仍然读到完全相同的结果）。
     *   - 超轮的团队 ⇒ `rounds = 0` ＋ `planReviewEscalated = false`。
     *   ★ 若把归零写成无条件，一次与计划无关的 halt/resume 就会抹掉
     *     "这份计划被改过几轮"——那正是本任务要保住的那条读数。
     *
     * ★★★ 而这里有个**必须如实记下的缺口**，不许用一段看起来在解除的代码盖住它：
     *   `resume` 只在 `halted === true` 时才走到下面（上面那行 early return）。
     *   ⇒ **一个"已经超轮、但没被 halt"的 staged 团队，今天仍然没有解除路径**：
     *      `approve` 会拒（t8 新加的那道闸）、`edit_plan` 只会把轮次推得更高、
     *      `resume` 返回 `already_running` 不动它。
     *   ⇒ 要补上它，需要一个"人点名放行"的落点（N5.16 的 `planReviewBypass`），
     *     而那要改 `src/tools/shared/entities.ts` / `src/tools/approve.ts` 的签名 ——
     *     **两者都不在 t8 的写域里**。⇒ 记录为已知缺口，不在这里假装解决。
     */
    /**
     * ★ 复用上面那一份读数（`roundsBefore` / `planLoopAlreadyEscalated`）而不是重算 ——
     *   两份读数分叉会让"要不要解除"与"解除之后写什么"用不同的判据。
     */
    const rounds = roundsBefore;
    const planLoopEscalated = planLoopAlreadyEscalated;
    return {
        ok: true,
        status: 'resumed',
        /**
         * ── ★★★ 2026-10-20：新增 `clearedPlanReview` 标记 ─────────────────────────────
         *
         * 调用方（`src/tools/resume.ts` / `create-task.ts`）必须据此把这两格**写回盘**。
         * ★ 为什么需要这个标记而不是让调用方自己比 `fresh.planReviewRounds !== resumed.team.planReviewRounds`：
         *   那种比法是**第二份真相** —— 它要知道"归零"这件事的规则（只有超轮才归零），
         *   而那条规则只住在这个函数里。改一次规则就会让两处漂移。
         * ⇒ 让**产生归零的那一方**说出来。
         * ★★ 而它不是可有可无的美化：**没有它，归零只活在返回值里，从不落盘** ——
         *    本仓 2026-10-20 实测的缺陷（一个"唯一出路"在生产上不存在）。
         */
        ...planLoopEscalated ? { clearedPlanReview: true } : {},
        team: planLoopEscalated
            ? {
                ...team,
                halted: false,
                haltedAt: undefined,
                /**
                 * ★ 显式写成 `0` / `false`（而不是 `delete`）：让"这里发生过一次解除"
                 *   在 JSON 里**看得见** —— 一个消失的键与一个从未存在过的键同形，
                 *   而这两种情形对"它当初为什么被卡住"的回答完全不同。
                 */
                planReviewRounds: 0,
                planReviewEscalated: false,
            }
            : {
                ...team,
                halted: false,
                haltedAt: undefined,
            },
    };
}
export function isReviewFinding(value) {
    if (!isRecord(value))
        return false;
    return nonemptyString(value['id'])
        && FINDING_SEVERITIES.includes(value['severity'])
        && nonemptyString(value['problem'])
        && nonemptyString(value['requiredFix'])
        && (value['file'] === undefined || nonemptyString(value['file']))
        && (value['line'] === undefined || (Number.isSafeInteger(value['line']) && value['line'] >= 0))
        && (value['resolved'] === undefined || typeof value['resolved'] === 'boolean');
}
export function isAcceptanceResult(value) {
    if (!isRecord(value))
        return false;
    return nonemptyString(value['criterion'])
        && (value['status'] === 'passed' || value['status'] === 'failed')
        && (value['evidence'] === undefined || typeof value['evidence'] === 'string');
}
export function isCommandResult(value) {
    if (!isRecord(value))
        return false;
    return nonemptyString(value['command'])
        && (value['status'] === 'passed' || value['status'] === 'failed')
        && (value['exitCode'] === undefined || (Number.isSafeInteger(value['exitCode'])))
        && (value['evidence'] === undefined || typeof value['evidence'] === 'string');
}
export function isTaskRevision(value) {
    if (!isRecord(value))
        return false;
    return Number.isSafeInteger(value['at'])
        && nonemptyString(value['by'])
        && nonemptyString(value['reason'])
        && nonemptyStringList(value['fields'])
        && isRecord(value['previous']);
}
// Optional fields whose persisted values must be non-empty when present
// (mirrors the checks in hasValidQualityTaskFields). Some models materialize
// optional tool parameters as "" instead of omitting them (e.g. GPT-5.6
// sending reviewedTaskId:"" or profile:""), which would otherwise be written
// to team.json and then brick the whole team state on reload.
const BLANK_SENSITIVE_STRING_FIELDS = ['objective', 'reviewedTaskId', 'sourceTaskId'];
const BLANK_SENSITIVE_STRING_LIST_FIELDS = [
    'inScope',
    'outOfScope',
    'acceptance',
    'verify',
    'deliverables',
    'nonGoals',
    'changedPaths',
    'sourceFindingIds',
    'coverageOf',
];
/**
 * Normalize blank optional task fields to omitted ("blank means absent").
 * Blank string scalars are deleted; string lists have blank entries filtered
 * out, and a list that only contained blanks is omitted entirely. Non-blank
 * values and every other field are passed through untouched, so durable-state
 * validation stays strict.
 */
export function normalizeBlankOptionalTaskFields(task) {
    const next = { ...task };
    for (const key of BLANK_SENSITIVE_STRING_FIELDS) {
        const value = next[key];
        if (typeof value === 'string' && value.trim() === '')
            delete next[key];
    }
    for (const key of BLANK_SENSITIVE_STRING_LIST_FIELDS) {
        const value = next[key];
        if (!Array.isArray(value))
            continue;
        const kept = value.filter((item) => !(typeof item === 'string' && item.trim() === ''));
        if (kept.length === value.length)
            continue;
        if (kept.length === 0)
            delete next[key];
        else
            next[key] = kept;
    }
    return next;
}
export function hasValidQualityTaskFields(value) {
    if (value['kind'] !== undefined && !TASK_KINDS.includes(value['kind']))
        return false;
    if (value['verdict'] !== undefined && !REVIEW_VERDICTS.includes(value['verdict']))
        return false;
    if (value['round'] !== undefined && !(Number.isSafeInteger(value['round']) && value['round'] >= 1))
        return false;
    if (value['objective'] !== undefined && !nonemptyString(value['objective']))
        return false;
    if (value['reviewedTaskId'] !== undefined && !nonemptyString(value['reviewedTaskId']))
        return false;
    if (value['sourceTaskId'] !== undefined && !nonemptyString(value['sourceTaskId']))
        return false;
    if (value['reviewedAttempt'] !== undefined && !(Number.isSafeInteger(value['reviewedAttempt']) && value['reviewedAttempt'] >= 0)) {
        return false;
    }
    const stringLists = ['inScope', 'outOfScope', 'acceptance', 'verify', 'deliverables', 'nonGoals', 'changedPaths', 'sourceFindingIds', 'coverageOf'];
    for (const key of stringLists) {
        if (value[key] === undefined)
            continue;
        if (!Array.isArray(value[key]) || !value[key].every(nonemptyString))
            return false;
    }
    if (value['findings'] !== undefined) {
        if (!Array.isArray(value['findings']) || !value['findings'].every(isReviewFinding))
            return false;
        const ids = value['findings'].map((finding) => finding.id);
        if (new Set(ids).size !== ids.length)
            return false;
    }
    if (value['acceptanceResults'] !== undefined) {
        if (!Array.isArray(value['acceptanceResults']) || !value['acceptanceResults'].every(isAcceptanceResult))
            return false;
    }
    if (value['commandsRun'] !== undefined) {
        if (!Array.isArray(value['commandsRun']) || !value['commandsRun'].every(isCommandResult))
            return false;
    }
    if (value['supplementalEvidence'] !== undefined && (!Array.isArray(value['supplementalEvidence']) || !value['supplementalEvidence'].every(isTaskEvidence)))
        return false;
    if (value['revisions'] !== undefined) {
        if (!Array.isArray(value['revisions']) || !value['revisions'].every(isTaskRevision))
            return false;
    }
    return true;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * ★ 一个值**是什么类型** —— 而它在错误消息里，所以措辞要**可读且可核**。
 *
 * ★ 为什么单独一个函数而不是内联 `typeof`：`typeof null === 'object'` 与
 *   `typeof [] === 'object'` 都会把读的人引向错的方向（"它说是个对象啊"）。
 *   ⇒ 而 `null` 与**数组**在这里是**两种不同的**形状错（一个"没有值"、一个"形状不对"），
 *     所以它们各自的措辞要分得开。
 */
function describeTypeOf(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'an array';
    if (typeof value === 'string')
        return `a string (${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)})`;
    if (typeof value === 'object')
        return 'an object';
    return `a ${typeof value}${value === undefined ? ' (the key is absent)' : ` (${String(value)})`}`;
}
export function isReviewVerdict(value) {
    return typeof value === 'string' && REVIEW_VERDICTS.includes(value);
}
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
export const REVIEWED_CHECK_VERDICTS = ['pass', 'fail', 'unmeasured'];
/** `ReviewedCheck.verdict` 的取值判定。★ 不是 `isReviewVerdict` —— 见上面那一格。 */
export function isReviewedCheckVerdict(value) {
    return typeof value === 'string' && REVIEWED_CHECK_VERDICTS.includes(value);
}
export function looksLikeGateTestContract(value) {
    return typeof value === 'string' && GATE_TEST_CONTRACT.test(value);
}
export function sanitizeReviewObjective(value, fallback = DEFAULT_REVIEW_OBJECTIVE) {
    if (!nonemptyString(value) || looksLikeGateTestContract(value))
        return fallback;
    return value.trim();
}
export function sanitizeReviewAcceptance(values) {
    const cleaned = (values ?? []).map((item) => item.trim()).filter((item) => item !== '' && !looksLikeGateTestContract(item));
    return cleaned.length > 0 ? cleaned : [...DEFAULT_REVIEW_ACCEPTANCE];
}
export function defaultQualityDeliveryGraph(input) {
    const goal = input.goal.trim() || 'the stated user goal';
    const analyst = input.analyst;
    const implementer = input.implementer;
    const tester = input.tester ?? input.implementer;
    const reviewer = input.reviewer;
    const integrator = input.integrator ?? input.reviewer;
    return [
        {
            subject: 'requirements-round-1',
            kind: 'requirements',
            assignee: analyst,
            dependencies: [],
            objective: `Converge requirements for: ${goal}`,
            acceptance: ['Open questions are closed or explicitly deferred', 'Acceptance criteria are testable'],
            coverageOf: [goal],
        },
        {
            subject: 'implementation',
            kind: 'implementation',
            assignee: implementer,
            dependencies: ['requirements-round-1'],
            objective: `Implement the approved requirements for: ${goal}`,
            acceptance: ['The implementation matches the approved requirements'],
            inScope: ['src/'],
            verify: ['pnpm test'],
            coverageOf: [goal],
        },
        {
            subject: 'verification',
            kind: 'verification',
            assignee: tester,
            dependencies: ['implementation'],
            objective: `Verify the implementation of: ${goal}`,
            acceptance: ['Declared verification commands pass'],
            coverageOf: [goal],
        },
        {
            subject: 'review-round-1',
            kind: 'review',
            assignee: reviewer,
            dependencies: ['verification'],
            objective: DEFAULT_REVIEW_OBJECTIVE,
            acceptance: [...DEFAULT_REVIEW_ACCEPTANCE],
            coverageOf: [goal],
            /**
             * ★ 种子 id（不是运行期 id）—— 与 `dependencies` 同一套约定：
             *   `initializeProfileTeam` 用 `seedToActual` 把它换成 `tN`。
             *   而 `validateCreateTask` 要的正是"队伍里真的有这条任务"，
             *   换成真实 id 之后那个条件才成立。
             */
            reviewedTaskId: 'implementation',
        },
        {
            subject: 'integration',
            kind: 'integration',
            assignee: integrator,
            dependencies: ['review-round-1'],
            objective: `Confirm the team can declare delivery for: ${goal}`,
            acceptance: ['All required quality tasks are completed with passing reviews'],
            coverageOf: [goal],
        },
    ];
}
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
export function judgeSelfReview(input) {
    const { team, task, reviewerName } = input;
    const kind = taskKindOf(task);
    /**
     * ── ★★★ `requirements`：判的是"写需求的人会不会同时实现它"──────────────────────
     *
     * 这一支必须排在下面那条 `!== 'review'` 的早返回**之前** —— 而那条早返回此前
     * 正是把 requirements 整类放走的那一行（见函数顶部文档的 BEFORE 一段）。
     */
    if (kind === 'requirements') {
        if (reviewerName === undefined || reviewerName === '') {
            /** ★ 与 review 支同一条纪律：身份读不出来 ⇒ 判不了，不是"通过"。 */
            return { ok: true, undecidable: `the reviewer identity for ${task.id} could not be read` };
        }
        /**
         * ★ `governed`：依赖闭包里含这条 requirements 的每一条实现/修复任务。
         *   ★ 排除 `item.id === task.id` 是**防御性**的（requirements 不是写类 kind，
         *     不该依赖自己），而一个自依赖的坏记录若出现在盘上，下面那句
         *     `dependencyClosureContains` 会立刻返回真 —— 那样它会把自己算成自己的实现者。
         */
        const governed = team.tasks.filter((item) => {
            const candidateKind = taskKindOf(item);
            if (candidateKind !== 'implementation' && candidateKind !== 'repair')
                return false;
            if (item.id === task.id)
                return false;
            return dependencyClosureContains(team.tasks, item.dependencies ?? [], task.id);
        });
        if (governed.length === 0) {
            return {
                ok: true,
                undecidable: `requirements ${task.id} governs no implementation in this team, `
                    + 'so the identity that would build it could not be read',
            };
        }
        /**
         * ★ 每条被治理任务的"作者"：最近一条 completed 的 `by`（= 真做完了它的人），
         *   否则退回 `assignee`（= **还没跑**时盘上唯一可读的"谁会做它"）。
         *   ★ 顺序不能反：一次重派之后 `assignee` 指向的是**下一个**人，
         *     而"谁将会实现它"在已经有人做过的情形下应当是那个人 —— 与 review 支同源。
         */
        const identities = [];
        for (const item of governed) {
            const completed = (item.executions ?? []).filter((entry) => entry.status === 'completed');
            const by = completed.length === 0 ? undefined : completed[completed.length - 1]?.by;
            const identity = by === undefined || by === '' ? item.assignee : by;
            if (identity !== undefined && identity !== '')
                identities.push(identity);
        }
        const governedIds = governed.map((item) => item.id).join(', ');
        if (identities.length === 0) {
            return {
                ok: true,
                undecidable: `requirements ${task.id} governs ${governedIds}, but its implementer could not be read`,
            };
        }
        if (identities.includes(reviewerName)) {
            return {
                ok: false,
                error: `requirements ${task.id} cannot pass: "${reviewerName}" would also implement `
                    + `the work these requirements specify (${governedIds})`
                    + ' — the same identity may not approve its own requirements (captain protocol rule 7)',
            };
        }
        return { ok: true };
    }
    if (kind !== 'review') {
        /**
         * ★ 这个早返回**留着**，而它的措辞必须**如实**：它说的不是"这不是一次审查"
         *   （requirements 也会走到这里吗？不会 —— 上面那一支接住了它），
         *   而是"这一条 kind 的产出，本插件没有可绑到作者身上的被判对象"。
         *   ★ `verification` 落在这里，而那是**刻意的缺口**（见函数顶部的说明），
         *     不是一个遗漏。
         */
        return {
            ok: true,
            undecidable: `task ${task.id} is ${kind}, which issues no judged output the plugin can bind to an author`,
        };
    }
    if (reviewerName === undefined || reviewerName === '') {
        /**
         * ★ 身份读不出来 ⇒ **判不了**，不是"通过"。
         *   而这条路径在生产上不该出现（每次更新都有 identity），
         *   所以它是一个**可读的洞**而不是一个静默的错。
         */
        return { ok: true, undecidable: `the reviewer identity for ${task.id} could not be read` };
    }
    if (task.reviewedTaskId === undefined || task.reviewedTaskId === '') {
        return { ok: true, undecidable: `review ${task.id} declares no reviewedTaskId` };
    }
    if (task.reviewedTaskId === task.id) {
        /**
         * ★ 审自己 —— 这是**最露骨**的自审形态，比"两人同名"更直接。
         *   它不该落到"实现者未知"那一支：`reviewedTaskId === task.id` 本身就是一个
         *   可判定的事实，而把它读成"判不了"会让最确定的那种自审变成放行。
         */
        return { ok: false, error: `review ${task.id} reviews itself; a review must judge another task` };
    }
    const target = team.tasks.find((item) => item.id === task.reviewedTaskId);
    if (target === undefined) {
        return { ok: true, undecidable: `review ${task.id} points at ${task.reviewedTaskId}, which is not in this team` };
    }
    /**
     * ★ 最后一条 `completed` 的 `by` —— **不是** `executions.at(-1)`：
     *   一条任务可以是 completed 之后又被重开过（历史里最后一条就不是 completed），
     *   而"谁把它做完了"问的是**最近一次完成**。
     */
    const completed = (target.executions ?? []).filter((entry) => entry.status === 'completed');
    const implementer = completed.length === 0 ? undefined : completed[completed.length - 1]?.by;
    if (implementer === undefined || implementer === '') {
        return { ok: true, undecidable: `${target.id} has no completed execution, so its implementer is unknown` };
    }
    if (implementer === reviewerName) {
        return {
            ok: false,
            error: `review ${task.id} cannot pass: "${reviewerName}" both implemented ${target.id} and is judging it`
                + ' — the same identity may not approve its own implementation (captain protocol rule 7)',
        };
    }
    return { ok: true };
}
export function qualityPlanningPrompt() {
    return [
        'When the user explicitly requests full quality-mode planning, use this order unless a constraint forbids a stage: requirements → implementation → verification → review → integration.',
        'Build that entire DAG while the team is staged: an implementation may be created before requirements finishes when its dependency chain includes that requirements task. This is supported; do not wait for requirements to run and do not inspect plugin source to confirm it.',
        'A staged integration task may depend on review round 1. If that review later returns needs_revision, the system automatically rewires still-pending downstream dependencies to the generated repair + next-review gate, so keep integration in the original plan instead of omitting or manually recreating it.',
        'Derive inScope and verification commands from the actual workspace or explicit profile; never assume src/ or pnpm test.',
        'Give every quality task a contract. Review acceptance must judge the latest implementation, not whether the gate rejects needs_revision.',
        'Do not write smoke-test scripts into tasks. Do not ask reviewers to submit needs_revision on purpose.',
        'Do not claim implementation or review yourself unless the user asked the captain to take over.',
        'After a failed review, wait for the automatic repair + next review. Do not recreate that loop by hand.',
        'halted means the human stopped the team; call agent_teams_resume before creating more work. escalated means the automatic review loop hit its ceiling; that is not halt.',
    ].join(' ');
}
export function describeQualityLoop(team) {
    const delivery = canDeclareDelivery(team);
    if (team.halted === true) {
        return {
            state: 'halted',
            halted: true,
            escalated: team.escalated === true,
            deliverable: false,
            summary: 'Team is halted. Call agent_teams_resume with a reason before creating more work.',
        };
    }
    if (delivery.ok) {
        return {
            state: 'deliverable',
            halted: false,
            escalated: team.escalated === true,
            deliverable: true,
            summary: 'All required work and quality gates passed. The captain may report delivery.',
        };
    }
    if (team.escalated === true) {
        return {
            state: 'escalated',
            halted: false,
            escalated: true,
            deliverable: false,
            summary: 'Automatic review/repair loop hit its ceiling. The team is still running; do not treat this as halt. Escalate to the user instead of inventing another needs_revision cycle.',
        };
    }
    const open = team.tasks.some((item) => OPEN_STATUSES.includes(item.status));
    return {
        state: open ? 'running' : 'blocked',
        halted: false,
        escalated: false,
        deliverable: false,
        summary: open
            ? 'Work remains on the shared task list; wait for the scheduler or complete owned tasks.'
            : `Delivery is blocked: ${delivery.blockers.join('; ') || 'unresolved quality gates'}.`,
    };
}
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
export function describePlanLoop(team) {
    const maxRounds = PLAN_REVIEW_MAX_ROUNDS;
    /**
     * ★ 存量团队**没有**这一格。缺席按 `0` 读 —— 但 `roundsSource` 把
     *   "我把它读成 0"与"它确实是 0"分开，否则存量团队看起来像"审了 0 轮就通过"。
     */
    const persistedRounds = typeof team.planReviewRounds === 'number' && Number.isFinite(team.planReviewRounds)
        ? Math.max(0, Math.floor(team.planReviewRounds))
        : undefined;
    const rounds = persistedRounds ?? 0;
    const roundsSource = persistedRounds === undefined ? 'absent' : 'persisted';
    const surfaces = planLoopSurfacesOf(team);
    const surfaceSentence = planLoopSurfaceSentence(surfaces);
    const state = planLoopStateOf(team, rounds, maxRounds);
    return {
        state,
        rounds,
        maxRounds,
        reason: planLoopReasonOf({ team, state, rounds, maxRounds, roundsSource, surfaceSentence }),
        canEnd: state === 'approved',
        roundsSource,
        surfaces,
    };
}
/** 五态判定。★ 顺序就是语义 —— 这个函数是它**唯一**的一个落点（各调用点不许各写一遍）。 */
function planLoopStateOf(team, rounds, maxRounds) {
    /** ★ 最前：staged 团队也能被 halt（见函数头）。 */
    if (team.halted === true)
        return 'halted';
    /** ★ 本队自己的位，**不是** `team.escalated`（那个位没有清除点，见 N5.14）。 */
    if (team.planReviewEscalated === true)
        return 'escalated';
    /** ★ 读时也要能算出来 —— 存量团队没有那一位，而 `rounds` 可能已经在盘上。 */
    if (rounds >= maxRounds)
        return 'escalated';
    /** ★★ 这两条必须排在上面两条之后（见函数头）。 */
    if (team.phase === 'running')
        return 'approved';
    if (team.planReviewState === 'awaiting_feedback')
        return 'reviewing';
    return 'awaiting-review';
}
/**
 * 契约表面的三态读数（**只读，不做闸**）。
 *
 * ★★ 分档那一层已被对抗性审查推翻并明文砍掉，**不许重装** —— 理由逐字：
 *   它的判据方向是**反的**：奖励少写 `inScope`、惩罚诚实声明，
 *   且能被被审方自己缩域绕过（`amend_task` 是唯一能改 `inScope` 的工具，而它不计轮次）。
 * ⇒ 这里只回答"这一份计划被看清楚了没有"，**不回答**"它该不该放行"。
 */
function planLoopSurfacesOf(team) {
    const unreadableIds = [];
    const notApplicableIds = [];
    let readable = 0;
    for (const task of team.tasks) {
        const kind = task.kind ?? 'work';
        /**
         * ★ 判据**不在这里新写一条**：`validateCreateTask` 已经在跑这两条
         *   （`isQualityKind ⇒ objective+acceptance`；`WRITE_KINDS ⇒ inScope+verify`）。
         *   这里读的是 `WRITE_KINDS` 那一条 —— 写类任务必须有 `inScope`。
         *   ★ 抄一份判断就是同一条规则的两个副本，而副本会分叉。
         */
        if (!WRITE_KINDS.includes(kind)) {
            notApplicableIds.push(task.id);
            continue;
        }
        if (nonemptyStringList(task.inScope))
            readable += 1;
        else
            unreadableIds.push(task.id);
    }
    return {
        total: team.tasks.length,
        readable,
        unreadable: unreadableIds.length,
        unreadableIds,
        notApplicable: notApplicableIds.length,
        notApplicableIds,
    };
}
/**
 * 把表面读数写成**一句话**（`reason` 里要用）。
 *
 * ★ 三种情形**不同形**，绝不合流：
 *   有真缺口     ⇒ 逐条点名是哪几条（"N 条任务的表面读不出来"）
 *   全不适用     ⇒ 说"没有写类任务 ⇒ 这一问不适用"（★ 而"不适用"是看了之后的结论）
 *   全读到了     ⇒ 说读到了几条（★ 不说"通过" —— 那是闸的字，这一层没有闸）
 */
function planLoopSurfaceSentence(surfaces) {
    if (surfaces.unreadable > 0) {
        return `${surfaces.unreadable} 条任务的表面读不出来（${surfaces.unreadableIds.join(', ')}）：`
            + '这些是写类任务，而契约没有声明 inScope ⇒ ✖ 不拦（"没说改哪里"不是"改得很大"），'
            + '但这条读数**不进"通过"那一格** —— 放行 ≠ 通过。';
    }
    if (surfaces.readable === 0) {
        return `0 条任务需要读表面（${surfaces.notApplicable} 条都不是写类，契约本来就不要求 inScope）`
            + ' ⇒ ★ 这一问不适用 —— 而"不适用"是看了之后的结论，不是"我忘了查"。';
    }
    return `${surfaces.readable} 条写类任务的表面都读到了`
        + (surfaces.notApplicable === 0 ? '' : `；另有 ${surfaces.notApplicable} 条非写类任务本来就不要求表面（${surfaces.notApplicableIds.join(', ')}）`);
}
/** `reason` 的构造 —— 它才是这一层真正的产出，`state` 只是它的索引。 */
function planLoopReasonOf(input) {
    const { team, state, rounds, maxRounds, roundsSource, surfaceSentence } = input;
    /**
     * ★ 计数这一句在**每一个**分支里都要出现 —— 否则"审了几轮"会在某些状态下消失，
     *   而那个缺口正是 N5.13 记的那一条（批准之后 `rounds` 永久丢失）。
     */
    const counter = roundsSource === 'absent'
        ? `轮次：这一队没有 \`planReviewRounds\`（本轮之前建的队 ⇒ 按 0 读，★ 而"读成 0"与"确实是 0"不同形）`
        : `轮次：${rounds}/${maxRounds}`;
    const head = `计划审查环 state=${state}；${counter}。`;
    switch (state) {
        case 'halted':
            return `${head} ★ 队伍被**人**停住了（halted 排在所有判定之前，包括 approved）—— `
                + '这个环不会自己再转：要它继续，先调 `agent_teams_resume` 给一个非空理由。'
                + ` 表面读数：${surfaceSentence}`;
        case 'escalated':
            return team.planReviewEscalated === true
                ? `${head} ★★ 轮次上限已敲响（\`planReviewEscalated\` 为 true）：这个环**自己不会结束** —— `
                    + `它已经改了 ${rounds} 次，而上限是 ${maxRounds}。`
                    + '解除**只能**是显式归零（`resume` 或人在批准时点名），'
                    + '★ 而"只清 flag 不归零"不算：那会让 `rounds >= maxRounds` 立刻重新算出 escalated（死码）。'
                    + ` 表面读数：${surfaceSentence}`
                : `${head} ★★ 「已经改了 ${rounds} 次，上限 ${maxRounds}」是**当场算出来的**（不是读盘上的 flag）：`
                    + '这个环**自己不会结束**，解除只能是显式归零。'
                    + ` 表面读数：${surfaceSentence}`;
        case 'approved':
            return `${head} ✔ 计划已被批准，环**可以**结束（\`canEnd = true\`）。`
                + '★ 而这不是"这个计划被审明白了"—— 那件事没有闸（分档层已被对抗性审查推翻并砍掉）。'
                + ` 表面读数：${surfaceSentence}`;
        case 'reviewing':
            return `${head} ↻ 正在等用户反馈（\`planReviewState = awaiting_feedback\`）：`
                + '环停在"人要说什么"上，不是停在"还能转几次"上。'
                + ` 表面读数：${surfaceSentence}`;
        default:
            return `${head} ⏳ 等审阅（\`planReviewState\` 缺席或为 \`awaiting_review\`）：`
                + '这一份计划还没有被批准，环可以继续转；每调一次 `edit_plan` 记 1 轮'
                + '（★ 一次调用含多个 operation 仍只算 1 轮 —— 那是"一轮反馈"，不是"5 轮"）。'
                + ` 表面读数：${surfaceSentence}`;
    }
}
/** Persisted evidence must remain loadable after process restart. */
export function isTaskEvidence(value) {
    if (!isRecord(value))
        return false;
    return typeof value['at'] === 'number' && Number.isFinite(value['at'])
        && nonemptyString(value['by']) && Number.isSafeInteger(value['attempt']) && value['attempt'] >= 0
        && (value['attemptId'] === undefined || nonemptyString(value['attemptId']))
        && (value['note'] === undefined || nonemptyString(value['note']))
        && (value['acceptanceResults'] === undefined || (Array.isArray(value['acceptanceResults']) && value['acceptanceResults'].every(isAcceptanceResult)))
        && (value['commandsRun'] === undefined || (Array.isArray(value['commandsRun']) && value['commandsRun'].every(isCommandResult)))
        && (value['note'] !== undefined || (Array.isArray(value['acceptanceResults']) && value['acceptanceResults'].length > 0) || (Array.isArray(value['commandsRun']) && value['commandsRun'].length > 0));
}
/** Append observations without mutating the original result or its completion time. */
export function appendTaskEvidence(task, input, by) {
    if (!TERMINAL_TASK_STATUSES.includes(task.status))
        throw new Error('supplemental evidence requires a terminal task');
    // Key order must not turn a retried JSON object into a different observation.
    const stable = (value) => JSON.stringify(value, (_key, item) => typeof item === 'object' && item !== null && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
    for (const key of ['status', 'output', 'verdict', 'findings', 'changedPaths']) {
        if (input[key] !== undefined && stable(input[key]) !== stable(task[key])) {
            throw new Error(`terminal task ${task.id} is immutable: cannot change ${key}; append evidence with evidence_note, acceptanceResults or commandsRun instead. Do not reclaim or redo completed work.`);
        }
    }
    const prior = (task.supplementalEvidence ?? []).filter(row => row.by === by && row.attempt === (task.attempt ?? 0) && row.attemptId === task.attemptId);
    const freshItems = (items, existing) => {
        const seen = new Set(existing.map(stable));
        return (items ?? []).filter(item => { const key = stable(item); if (seen.has(key))
            return false; seen.add(key); return true; });
    };
    const acceptanceResults = freshItems(input.acceptanceResults, [...task.acceptanceResults ?? [], ...prior.flatMap(row => row.acceptanceResults ?? [])]);
    const commandsRun = freshItems(input.commandsRun, [...task.commandsRun ?? [], ...prior.flatMap(row => row.commandsRun ?? [])]);
    const trimmed = input.evidence_note?.trim();
    const note = trimmed && !prior.some(row => row.note === trimmed) ? trimmed : undefined;
    if (!note && acceptanceResults.length === 0 && commandsRun.length === 0)
        return false;
    const entry = { at: Date.now(), by, attempt: task.attempt ?? 0,
        ...task.attemptId === undefined ? {} : { attemptId: task.attemptId },
        ...note === undefined ? {} : { note },
        ...acceptanceResults.length === 0 ? {} : { acceptanceResults },
        ...commandsRun.length === 0 ? {} : { commandsRun },
    };
    if (!isTaskEvidence(entry))
        throw new Error('invalid supplemental evidence');
    task.supplementalEvidence = [...task.supplementalEvidence ?? [], entry];
    return true;
}
