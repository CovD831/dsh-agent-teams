/**
 * Pure quality-gate rules: contracts, path audit, completion, follow-up,
 * coverage, and resume. Tools and persistence call these; they do not I/O.
 * @module dsh-agent-teams/quality-gates
 */
import { existsSync, readFileSync } from 'node:fs';
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
/** Normalize a workspace-relative POSIX path. `undefined` means illegal. */
export function normalizeWorkspacePath(path) {
    if (typeof path !== 'string')
        return undefined;
    const trimmed = path.trim();
    if (trimmed === '')
        return undefined;
    if (trimmed.startsWith('~') || /^[A-Za-z]:/.test(trimmed))
        return undefined;
    const posix = trimmed.replaceAll('\\', '/');
    if (posix.startsWith('/'))
        return undefined;
    const parts = [];
    for (const part of posix.split('/')) {
        if (part === '' || part === '.')
            continue;
        if (part === '..')
            return undefined;
        parts.push(part);
    }
    return parts.join('/');
}
export function pathMatchesScope(path, pattern) {
    const normalizedPath = normalizeWorkspacePath(path);
    if (normalizedPath === undefined)
        return false;
    const rawPattern = pattern.trim().replaceAll('\\', '/');
    if (rawPattern.startsWith('~') || rawPattern.startsWith('/') || /^[A-Za-z]:/.test(rawPattern))
        return false;
    const directory = rawPattern.endsWith('/');
    const normalizedPattern = normalizeWorkspacePath(rawPattern);
    if (normalizedPattern === undefined) {
        if (directory && (rawPattern === './' || rawPattern === '/' || rawPattern === '.'))
            return true;
        return false;
    }
    if (directory || rawPattern === './' || rawPattern === '.') {
        if (normalizedPattern === '')
            return true;
        return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
    }
    return normalizedPath === normalizedPattern;
}
function isDefaultExcluded(path) {
    const normalized = normalizeWorkspacePath(path);
    if (normalized === undefined)
        return false;
    const segments = normalized.split('/');
    const base = segments[segments.length - 1] ?? '';
    if (segments[0] === '.git' || segments[0] === '.dsh')
        return true;
    if (base === '.env' || base.startsWith('.env.'))
        return true;
    if (segments.includes('secrets'))
        return true;
    if (base.startsWith('id_rsa'))
        return true;
    return false;
}
export function classifyChangedPath(path, inScope = [], outOfScope = []) {
    if (normalizeWorkspacePath(path) === undefined)
        return 'illegal';
    if (isDefaultExcluded(path))
        return 'out_of_scope';
    if (outOfScope.some((pattern) => pathMatchesScope(path, pattern)))
        return 'out_of_scope';
    if (inScope.some((pattern) => pathMatchesScope(path, pattern)))
        return 'in_scope';
    return 'undeclared';
}
/**
 * ── ★★ f-0020：repair 的判别力证据，不是「本次新增的测试」───────────────────────
 *
 * ── 它修的是什么（MEASURED：本队 6 次同形终止，全部由 captain 代落终态）─────────
 *
 *     t13 / t16 / t19 / t25 / t26 cancelled · t27 failed
 *
 * 原因不是交付物有问题，而是三道完工门的**问句与 repair 的验收不是同一件事**：
 *
 *     r5 / mutation 度量：「为【新工作】写了新测试吗」   ← 输入面 = `newTestFiles`
 *     repair 的验收    ：「改了【既有】夹具后它仍能判别吗」← 净改动全在既有文件上
 *
 * ⇒ `newTestFiles` 对一份 repair 恒为 `[]`（它数的是"新增"，而 repair 一个都没新增），
 *   于是 r5 报 `unmeasured`（"none of the 0 reported file(s)…"）、mutation 拿不到
 *   杀手套件。判据**没有撒谎** —— 它诚实地说"我没能测量"。
 *   但一个恒常的 `unmeasured` 同样**交不出终态** ⇒ 无人值守退化成 captain 逐个手收。
 *
 * ── ★★ 这一格**只换了文件来源**，没有降低判别的强度 ─────────────────────────────
 *
 * 判据问的仍是同一个问题：「这条夹具**还能不能抓住缺陷**」。
 * 变的只是"拿哪些文件去问"：
 *
 *     旧：本次【新增】的测试文件        ⇒ 对 repair 是空集 ⇒ 恒 unmeasured
 *     新：本次【改动过的既有的】测试夹具 ⇒ repair 的真实证据 ⇒ 可测量
 *
 * ★ 而"装饰性测试"这一路**一步都没让**：一条恒绿的既有夹具同样过不了 r5
 *   （它在父版本上就绿 ⇒ `decorative test` 拒绝）。见夹具的臂 3（定向突变）。
 *   ⇒ 换句话说：**"是不是新文件"是无关的；"它还能不能判别"才是问题。**
 *     旧口径读的是前者，代价是把后者的答案一起丢掉了。
 *
 * ── 三态（与 `observedChangedPaths` / `gitChangedPaths` 逐条对齐）──────────────
 *
 *   观察面缺席（`undefined`）    ⇒ 本函数返回 `[]`，且调用方**必须**报 unmeasured
 *        —— "我没能观察" 与 "观察了、确实没有" 不同形（本队记账最久的那条界线）。
 *   观察到了、一条夹具都没改动  ⇒ `[]`，同样是 unmeasured（没有可测量的判别力）。
 *   观察到了、改了既有夹具      ⇒ 那些路径 —— r5 拿它们去跑红前绿后。
 *
 * ★ 为什么不做成"猜一个默认目录"：猜出来的路径会让运行器返回 `[]`，
 *   而空集会被读成"没有新测试要查" ⇒ **ok**。那是把"没测到"并进"通过"，
 *   正是 r5 的注释里已经点名过的那个坑（"用没有根据的默认值…⇒ ok"）。
 *
 * @param ctx - 一份完成更新的上下文（任务是 `repair` / `implementation`）。
 * @returns 应当被当作判别力证据去测量的测试夹具路径（workspace 相对，已去重排序）。
 */
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
export function collectChangedPaths(gitStatusText) {
    const paths = [];
    const seen = new Set();
    for (const rawLine of gitStatusText.split(/\r?\n/u)) {
        const line = rawLine.trimEnd();
        if (line.trim() === '')
            continue;
        let candidate = line;
        const rename = /->\s+(\S+)$/u.exec(line);
        if (/^[ MADRCU?!]{1,2}\s+/u.test(line)) {
            candidate = rename?.[1] ?? line.replace(/^[ MADRCU?!]{1,2}\s+/u, '');
        }
        const cleaned = candidate.replace(/^"|"$/gu, '').trim();
        const normalized = normalizeWorkspacePath(cleaned);
        if (normalized === undefined || seen.has(normalized))
            continue;
        seen.add(normalized);
        paths.push(normalized);
    }
    return paths;
}
export function inScopeOverlap(left, right) {
    if (left === undefined || right === undefined)
        return [];
    const hits = [];
    for (const a of left) {
        for (const b of right) {
            if (pathMatchesScope(a, b) || pathMatchesScope(b, a) || a === b) {
                if (!hits.includes(a))
                    hits.push(a);
            }
        }
    }
    return hits;
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
function looksLikeRepoPath(token) {
    if (token === '' || token.startsWith('-') || token.startsWith('http'))
        return false;
    if (token.includes(' '))
        return false;
    /** ★ 必须像一条**仓库内**路径：含 `/`，且不以绝对路径/上跳开头。 */
    if (!token.includes('/'))
        return false;
    if (token.startsWith('/') || token.startsWith('..'))
        return false;
    return /^[A-Za-z0-9_.-]+\//.test(token);
}
function normalizeRepoPath(token) {
    return token.replace(/\\/g, '/').replace(/^\.\//, '').replace(/[.,;:)]+$/, '');
}
/**
 * 从一段自由文本（objective / acceptance）里取出**看起来像仓库路径**的 token。
 *
 * ★ 口径刻意**保守**：只认反引号里的那一类（本仓的契约几乎总是这样写路径），
 *   以及裸的 `dir/file.ext` 形态。
 * ★★ 而"取不到"⇒ 返回空数组（**不猜**）：一个靠猜的检查会在别的措辞上误报，
 *   而误报会教人忽略门禁 —— 与漏报同样有害。
 */
export function repoPathsNamedIn(text) {
    const found = new Set();
    for (const match of text.matchAll(/`([^`\n]+)`/g)) {
        const token = match[1].trim();
        if (looksLikeRepoPath(token))
            found.add(normalizeRepoPath(token));
    }
    for (const match of text.matchAll(/(?:^|[\s(])([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*\.[A-Za-z0-9]+)/g)) {
        const token = match[1].trim().replace(/[.,;:)]+$/, '');
        if (looksLikeRepoPath(token))
            found.add(normalizeRepoPath(token));
    }
    return [...found];
}
/** 一条 verify 命令里"被跑的那个文件"（`node --test <path>` / `node <path>`）。 */
export function verifyTargetOf(command) {
    const trimmed = command.trim();
    if (trimmed === '')
        return undefined;
    const words = trimmed.split(/\s+/);
    /** ★ 取最后一个**路径样**的词（`node --test scripts/x.test.mjs` ⇒ 第 3 个）。 */
    const paths = words.filter((word) => looksLikeRepoPath(word) || /\.(mjs|cjs|js|ts)$/.test(word));
    const candidate = paths[paths.length - 1];
    if (candidate === undefined)
        return undefined;
    return normalizeRepoPath(candidate);
}
/**
 * 一条验收标准"点名的臂"—— 例如 `scripts/gate-friction-capture.test.mjs` 里的 `臂 4`。
 *
 * ★ 这是 (iii) 的**要害**：文件存在**不等于**它里面那条臂存在。
 *   t8 那一例正是如此：文件在（51755 字节），而 **C1 的臂一个都没有**。
 */
export function armsNamedIn(text) {
    const found = new Set();
    for (const match of text.matchAll(/臂\s*(\d+[a-z]?)/gu))
        found.add(`臂 ${match[1]}`);
    for (const match of text.matchAll(/\barm\s+(\d+[a-z]?)\b/giu))
        found.add(`arm ${match[1]}`);
    return [...found];
}
/**
 * ── ★★★ t8 那一例的最强读数：**臂名存在，而它承载的东西不存在**────────────────────
 *
 * MEASURED（本任务实测，`git show ba5b23a:scripts/gate-friction-capture.test.mjs`）：
 *
 *     `臂 4` 在那个修订上**存在**（2 处）—— 而它是一个**与 C1 无关的**老臂：
 *         「臂 4（★ 重放臂）：拿记录去重跑那条判据 —— 卡点必须**再发生一次**」
 *     而 C1 的词汇（`observeStall` / `recordClass` / `FrictionRecordClass`）**零出现**。
 *
 * ⇒ ★★ 于是"验收说臂 4 证明 escalate 池"在那棵树上**是空的**：
 *   臂名对得上，而**它证明的东西不存在**。
 *   ⇒ 一个只比臂名的检查**会放它过去** —— 而那正是本任务要消灭的形态本身：
 *     **一条读起来像被验证过的标准，其实没有主语。**
 *
 * ── 所以这一梯补的是**主语**：验收标准里点名的标识符，必须在那个文件里真的出现 ────────
 *
 * ★ 口径保守（与 `repoPathsNamedIn` 同一条纪律）：只认**反引号里**、
 *   且形状像**代码标识符**（camelCase / snake_case / PascalCase，可带点）的那些。
 *   ⇒ 取不到 ⇒ 不报（**不猜**）：一个靠猜的检查会在散文上误报，
 *     而误报会教人忽略门禁 —— 与漏报同样有害。
 */
export function subjectTermsIn(text) {
    const found = new Set();
    for (const match of text.matchAll(/`([^`\n]+)`/g)) {
        const token = match[1].trim();
        /** ★ 反引号里**不是**路径、而像标识符的那些（`observeStall` / `pool: 'escalate'`）。 */
        if (token.includes('/') || token.includes(' ') || token === '')
            continue;
        const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token) ? token : undefined;
        if (identifier === undefined)
            continue;
        /** ★ 排除那些**不是这个仓库词汇**的常见词（否则每个 `true` / `ok` 都要去文件里找）。 */
        if (GENERIC_TERMS.has(identifier))
            continue;
        found.add(identifier);
    }
    return [...found];
}
/**
 * 一些"哪个文件里都可能有、因此证明不了任何事"的通用词。
 * ★ 排除它们是刻意的：`true` 出现在任何文件里都不说明那个文件测了这件事。
 */
const GENERIC_TERMS = new Set([
    'true', 'false', 'null', 'undefined', 'ok', 'error', 'id', 'name', 'type', 'value',
    'string', 'number', 'boolean', 'object', 'array', 'pnpm', 'node', 'npm', 'test',
]);
/**
 * 跑三条梯级，返回**全部**失败（不短路 —— 一次给全，与判据注册表同一条纪律）。
 *
 * ★ `root` 可注入 ⇒ 夹具能拿一棵私有树测它，而不必依赖真实仓库的形状。
 */
/**
 * ── ★★★ t23：`inScope` 里那些**结构上不可能**的路径（而非"还没生成"）────────────────
 *
 * 见 `checkTaskPremises` 里 (ii) 那一大段：契约字面要求"每个 inScope 文件存在"，
 * 而**照字面实现会打红四条诚实工作的臂** —— 任务的存在理由常常就是**创建一个还不存在的文件**。
 *
 * ⇒ 所以这里只查那一类**读的人一眼能看出写错了**的形状。实测的（t3）：
 *
 *     declarationDir = lib/types   ⇒ 声明文件落在 `lib/types/<name>.d.ts`
 *     ⇒ 契约里的 `lib/types.d.ts` **结构上产不出来**（不是"还没生成"，是"永远不会生成"）
 *
 * ★ 判据：路径是 `X/Y.d.ts` 的形状，而 `X/Y/` 是一个**真实存在的目录**
 *   ⇒ 那是"把目录名当成了文件名"，读的人想写的显然是 `X/Y/<name>.d.ts`。
 * ★ 而它**不**误伤"新建目录"（`src/newthing/` 只是还不存在）与"新建文件"
 *   （`src/a.ts` 此刻不存在，而任务就是去建它）。
 */
function structurallyImpossiblePath(normalized, root) {
    const match = /^(.*)\.d\.ts$/.exec(normalized);
    if (match === null)
        return undefined;
    const directoryLike = match[1];
    if (directoryLike === '' || !directoryLike.includes('/'))
        return undefined;
    try {
        if (!existsSync(join(root, directoryLike)))
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
export function validateCreateTask(team, input) {
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
        });
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
function baselinePin() {
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
    const push = (raw) => {
        const normalized = normalizeWorkspacePath(raw.replace(REPAIR_SCOPE_LINE_SUFFIX, ''));
        if (normalized === undefined || derived.includes(normalized))
            return;
        derived.push(normalized);
    };
    for (const finding of findings) {
        if (nonemptyString(finding.file))
            push(finding.file);
        for (const match of finding.requiredFix.matchAll(REPAIR_SCOPE_PATH_PATTERN))
            push(match[0]);
    }
    return derived.length > 0 ? derived : fallback === undefined ? undefined : [...new Set(fallback)];
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
            acceptance: sanitizeReviewAcceptance(unresolvedFindings(closed).map((finding) => finding.requiredFix)),
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
    const repairScope = repairScopeFromFindings(findings, source?.inScope);
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
        acceptance: findings.map((finding) => finding.requiredFix),
        sourceTaskId: sourceId,
        sourceFindingIds: findingIds,
    };
    const reviewer = schedulableAssignee(closed.assignee !== implementer ? closed.assignee : undefined, team, implementer);
    const review = {
        id: `review-round-${nextRound}`,
        kind: 'review',
        subject: `review-round-${nextRound}`,
        assignee: reviewer,
        dependencies: [repair.id ?? `repair-round-${nextRound}`],
        round: nextRound,
        objective: sanitizeReviewObjective(closed.objective, DEFAULT_REVIEW_OBJECTIVE),
        acceptance: sanitizeReviewAcceptance(closed.acceptance),
        reviewedTaskId: repair.id,
    };
    return { created: [repair, review], tasks: [repair, review] };
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
export function canDeclareDelivery(team) {
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
    return { ok: blockers.length === 0, blockers };
}
export function resumeTeamState(team, reason) {
    if (!nonemptyString(reason)) {
        return { ok: false, status: 'rejected', error: 'resume requires a non-empty reason' };
    }
    if (team.halted !== true) {
        return { ok: true, status: 'already_running', team };
    }
    return {
        ok: true,
        status: 'resumed',
        team: {
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
export function isTaskKind(value) {
    return typeof value === 'string' && TASK_KINDS.includes(value);
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
export function isFindingSeverity(value) {
    return typeof value === 'string' && FINDING_SEVERITIES.includes(value);
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
