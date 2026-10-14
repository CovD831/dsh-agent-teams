/**
 * ── 判据：变异测试（交付的测试真的在测吗）──────────────────────────────────────
 *
 * 插入点：`completion`（成员汇报完成时）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（外部借鉴项目的一轮真实交付，本仓库本轮把它作为机制迁过来）：
 * 一个任务加了 25KB 的测试文件、全套绿、审查也过了 —— 而把 `||` 翻成 `&&` 之后
 * 【一条红的都没有】（杀伤率 33.3%）。套件是装饰性的，而它在日志里与"做完了"
 * 完全同形。`completion.verify-rerun` 与 `dispatch.changed-paths` 都堵不住它：
 * 那两条问的是"命令真跑了吗""文件真是你动的吗"，本条问的是【改坏代码，测试会不会红】。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：本文件不 import 任何 I/O。调用方把观察注入进来
 *    （读文件、跑套件、应用/还原变异体、读 git 改动行）；缺席时 `unmeasured`。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 *
 * ── ★ 本判据最重要的一条：区分「测试没覆盖」与「探针够不到」───────────────
 *
 * 「存活变异体」这个数字有两个来源，而它们在输出里【长得一模一样】：
 *
 *     ① 测试没覆盖到那个分支        → 关于【测试】的信号 ⇒ blocked
 *     ② 杀手套件根本够不到被变异文件 → 关于【测量】的信号 ⇒ unmeasured
 *
 * MEASURED（外部借鉴项目 RUN-009）：评分器变异 `bin/workbench-loop.mjs`，却拿
 * `test/escalation.test.mjs` 当杀手套件 —— 而那个文件里 grep 该模块名 = 0。
 * 后果：该文件每一个变异体都【必然】存活。读起来是"测试不够"，事实是"探针指错了"。
 * 该形态在那个项目里已经犯过【九次】。
 *
 * ⇒ 本判据把它变成一条硬规则：**每一个候选套件都够不到被变异文件 ⇒ unmeasured，
 *   绝不记成"全存活"**。
 *
 * ── 另一条：只对【改动行范围】变异（--lines 语义）────────────────────────────
 *
 * 全文件变异会把无关区域算进分母，从而【扭曲分数】（分母里混进一堆没人碰过的行）。
 * 所以改动行范围是【必填】的：拿不到 git 证据时不是退回全文件，而是 unmeasured。
 * 这条同样适用于 L3 的契约违反体 —— 定义里的锚点必须落在这个范围内。
 */
import { blocked, unmeasured } from "../registry.js";
/**
 * ★ 预算停止的认出（2026-10-12）。同层 import —— 见 `../budget-stop.ts` 文件头。
 */
import { isCompletionBudgetStop } from "../budget-stop.js";
/**
 * ★ t54：从**非判据**的纯模块拿（不是从 `./r5.ts`）——
 *   判据之间不许互相 import（`verify-gates-integration` ④ 的显式 allowlist），
 *   而那条约束防的正是"一条判据调另一条"。
 *   ★ 本文件与 r5 是**兄弟**，不是它的用户。
 */
import { gateRequirementFor, loadKindRequirementsOfHost } from "./kind-requirements.js";
import { capMutants, classifyRun, DEFAULT_MAX_MUTANTS, DEFAULT_MAX_PER_OPERATOR, generateMutants, loadInvariants, MIN_SCORED_FOR_VERDICT, noScorableMutants, parseTestSummary, probeReach, resolveMutationCoverage, scoreMutants, verifyAnchors, } from "../../mutation.js";
export const id = 'completion.mutation';
export const point = 'completion';
export const description = '对【改动行范围】注入 L1/L2/L3 变异体并重跑杀手套件：变异体存活即拒绝（防止装饰性测试）；套件够不到被变异文件 ⇒ unmeasured';
/**
 * ── 输入面声明（t4）───────────────────────────────────────────────────────────
 *
 * ★ 本条在上一轮【真的缺过输入】，而且缺的正是它自己写在文件头里的那三样：
 *
 *   MEASURED（本轮开工前的复盘）：`readFile` / `runTest` / `writeFile` 三个执行器
 *   曾经没接上。`gate()` 把它们拼成一条 `unmeasured`："mutation testing is
 *   unavailable (no runTest / writeFile injected), so whether the delivered tests
 *   detect a broken implementation could not be measured" —— 而 `unmeasured`
 *   在日志里与 `ok` 同形。**装饰性测试就这样溜过去了**，因为那条判据压根没跑。
 *
 * ★ 三格与 `gate()` 里那个 `missing` 数组逐条对齐（声明与未测量臂必须一致）：
 *   判据自己算一遍 `missing`、核对层再按声明算一遍 —— 两份清单说的是同一件事，
 *   而声明把这件事提前到了**求值之前**（不必先跑一遍才知道没执行器）。
 *
 * ★ `changedLines` 是【git 证据】，与 `changedFiles` 不同形，两者都要声明：
 *   · `changedFiles` 缺席 ⇒ "this task declared no changed files"；
 *   · `changedLines` 缺席 ⇒ "the changed-line ranges … could not be established
 *     (no git evidence)"。
 *   后者是 R1（`--lines` 语义）的入口：拿不到 git 证据时**不是**退回全文件，
 *   而是 unmeasured。这正是那次缺口里最容易看漏的一格 —— 它看起来像"一个可选的
 *   优化参数"，实际是判据正确性的前提（全文件变异会扭曲分母）。
 *
 * ★ `killerSuites` 也声明：空缺 ⇒ "no killer suite was declared for these changed
 *   files, so survivors would be a fact about the probe rather than about the
 *   tests" —— 这是本条判据存在的核心理由（探针够不到 ≠ 测试不够）。
 *
 * ★ 不声明的：`operators` / `invariants` / `minKillRate` / `mirrors` / `maxMutants`
 *   等**有缺省值**的调参位。它们缺席时判据照常测量（用默认算子、默认镜像、
 *   默认阈值），不是"没测成"。★ 这正是"声明"与"把 ctx 里每个字段都列一遍"的
 *   分界线：**声明的是"这一格缺席 ⇒ 判据说不出话"的那些格**。多列会制造噪音，
 *   而噪音会教人忽略核对 —— 与漏列同样有害。
 */
export const requires = [
    'readFile',
    'runTest',
    'writeFile',
    'changedLines',
    'killerSuites',
    'task.kind',
    'wantsCompleted',
    'taskNotTerminal',
];
/** 默认的"装饰性"界线。杀伤率低于它 ⇒ 说清有多少条存活、覆盖范围是什么。 */
export const DEFAULT_MIN_KILL_RATE = 0.6;
function unique(items) {
    return [...new Set(items)];
}
/**
 * 只对【本次试图置为 completed】的【非终态】【写文件类】任务生效。
 *
 * ★ 三个条件的由来，与 `completion.verify-rerun` 同源且每条都有实测依据：
 *   · 非 completed 的中间状态没有裁决要复核；
 *   · 任务【已是终态】是在追加署名证据（issue159），不是一次新的完成裁决 ——
 *     而变异测试会重跑套件、会改文件，用它重新审判历史结论是错的；
 *   · 没有实现/修复类改动 ⇒ 没有可变异的东西（review/requirements 本就不写 changedPaths）。
 */
export function appliesTo(ctx) {
    /**
     * ── ★★★ kind 守卫从【硬编码】改成【问表】（t54）───────────────────────────────
     *
     * ★ 此前写死 `kind !== 'implementation' && kind !== 'repair'` ⇒ 而 `TASK_KINDS`
     *   有 7 个 ⇒ 5 个 kind **完全没有完工门**（实测 29% 的任务）。
     *   ★ 而那不是设计，是**默认**：门只认两个 kind，其余的它**不说话**。
     *
     * ★ 三态各有去处：`required` ⇒ 生效；`not-required` ⇒ 按**有理由的决定**闭嘴；
     *   `unknown` ⇒ 仍不说话，但 `gate()` 会报 `unmeasured`（不静默通过）。
     */
    const requirement = gateRequirementFor(loadKindRequirementsOfHost(ctx), ctx?.task?.kind, id);
    if (requirement.status !== 'required')
        return false;
    return ctx?.wantsCompleted === true && ctx?.taskNotTerminal === true;
}
export async function gate(ctx) {
    /**
     * ── ★★★ 表不可用 ⇒ **不静默通过**（t54）───────────────────────────────────────
     *
     * ★ `appliesTo` 在表不可用时返回 `false`（门不说话），而那是**没能测量** ——
     *   它与"这个 kind 有理由地不要求这条门"在读数上**完全同形**。
     * ⇒ 所以在开火处再问一次表，让两者分得开（与 r5 逐字同一口径）。
     */
    const kindRequirement = gateRequirementFor(loadKindRequirementsOfHost(ctx), ctx?.task?.kind, id);
    if (kindRequirement.status === 'unknown') {
        return unmeasured(`Mutation could not tell whether this task needs it (kind=${ctx?.task?.kind ?? 'unspecified'}): ${kindRequirement.why ?? 'the kind-requirements table could not be consulted'}. `
            + `"the table could not be consulted" is NOT "this kind does not need Mutation"`);
    }
    const readFileMaybe = ctx?.readFile;
    const runTestMaybe = ctx?.runTest;
    const writeFileMaybe = ctx?.writeFile;
    /**
     * ★ 注入口径：三种能力缺任何一个都 ⇒ `unmeasured`，不是 `ok`。
     *   一个不能注入变异体的判据如果返回 ok，就是"装上了但从不生效"。
     */
    const missing = [
        typeof readFileMaybe === 'function' ? null : 'readFile',
        typeof runTestMaybe === 'function' ? null : 'runTest',
        typeof writeFileMaybe === 'function' ? null : 'writeFile',
    ].filter((item) => item !== null);
    if (missing.length > 0) {
        return unmeasured(`mutation testing is unavailable (no ${missing.join(' / ')} injected), so whether the delivered tests detect a broken implementation could not be measured`);
    }
    /** ★ 收窄：上面已证明三者都是函数。执行器永远由调用方注入，判据自己不做 I/O。 */
    const readFile = readFileMaybe;
    const runTest = runTestMaybe;
    const writeFile = writeFileMaybe;
    const declaredFiles = unique([
        ...(ctx.changedFiles ?? []),
        ...(ctx.update?.changedPaths ?? []),
        ...(ctx.task?.changedPaths ?? []),
    ]);
    if (declaredFiles.length === 0) {
        return unmeasured('this task declared no changed files, so there is nothing to mutate and no range to restrict the measurement to');
    }
    const changedLines = ctx.changedLines;
    if (changedLines === undefined) {
        return unmeasured(`the changed-line ranges for ${declaredFiles.length} file(s) could not be established (no git evidence), and whole-file mutation would count unrelated regions in the denominator and distort the score — so the kill rate is not measured`);
    }
    const ranges = toRanges(changedLines);
    if (ranges.length === 0) {
        return unmeasured(`the change touched ${declaredFiles.length} file(s) but no mutable line could be located, so this measurement has nothing to say (this is NOT "fully covered")`);
    }
    const suites = ctx.killerSuites ?? [];
    if (suites.length === 0) {
        return unmeasured('no killer suite was declared for these changed files, so survivors would be a fact about the probe rather than about the tests (this is not "everything survived")');
    }
    const commandTemplate = ctx.testCommand ?? 'node --test *';
    const mirrorMap = ctx.mirrors ?? defaultMirrors(declaredFiles);
    /** 逐文件收集：读不到文件 ⇒ 一次性 unmeasured（不是"这个文件没有变异体"）。 */
    const texts = new Map();
    const unreadable = [];
    for (const file of declaredFiles) {
        try {
            texts.set(file, readFile(file));
        }
        catch (error) {
            unreadable.push(`${file} (${error instanceof Error ? error.message : String(error)})`);
        }
    }
    if (unreadable.length === declaredFiles.length) {
        return unmeasured(`none of the ${declaredFiles.length} changed file(s) could be read: ${unreadable.join('; ')}`);
    }
    const corpus = ctx.corpus === undefined ? declaredFiles : unique([...ctx.corpus, ...declaredFiles]);
    /**
     * ★ 基线：套件本来就红 ⇒ 任何变异体都会"红"，那不能归功于变异体。
     *   与 `runMutationEngine` 同一条规则，这里显式跑一次是为了让 blocked/unmeasured
     *   的措辞落在判据层（调用的命令要能出现在报告里）。
     */
    const suiteFiles = unique(suites.flatMap((suite) => suite.files));
    /**
     * 基线要带上行覆盖，否则「改动行有没有被执行」指不出来。
     * 已经带了这个开关、或者根本不是 `node --test` 的命令，原样返回。
     * ★ 变异体若能收窄到逐测试，用的是同一条模板，只把 `*` 换成那一条测试。
     */
    const narrowedTemplate = requestLineCoverage(commandTemplate);
    const command = narrowedTemplate.replace('*', suiteFiles.join(' '));
    let baseline;
    try {
        baseline = await runTest(command);
    }
    catch (error) {
        return unmeasured(`running the killer suite raised: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (baseline.timedOut === true) {
        return unmeasured(`the killer suite hung (${command}); a hang is neither red nor green and must not be scored either way`);
    }
    const baselineSummary = parseTestSummary(`${baseline.stdout ?? ''}\n${baseline.stderr ?? ''}`);
    if (baselineSummary.total === null) {
        return unmeasured(`the killer suite did not report a readable summary (exitCode ${baseline.exitCode}), so the kill rate could not be computed`);
    }
    if (baselineSummary.fail !== 0 || baseline.exitCode !== 0) {
        return unmeasured(`the killer suite is not green before mutation (fail=${baselineSummary.fail}, exit=${baseline.exitCode}); measuring what a red suite detects is meaningless`);
    }
    /** L3 定义与锚点：坏定义【不静默跳过】—— 那会报出一份并不存在的 L3 覆盖。 */
    const { mutants: l3, errors: invariantErrors } = loadInvariants(ctx.invariants ?? []);
    const anchorProblems = verifyAnchors(l3, (path) => readFile(path));
    if (invariantErrors.length > 0 || anchorProblems.length > 0) {
        return unmeasured(`the L3 contract-violation declarations are not usable (${[...invariantErrors, ...anchorProblems].join('; ')}), and silently skipping them would claim L3 coverage that does not exist`);
    }
    /**
     * ★ R1：L3 的锚点必须落在【改动行范围】内。落在外面就是在变异无关区域 ——
     *   与"全文件变异"是同一个错误，只是换了个入口。
     *   用的是同一个 range 集合，指针指向的正是范围覆盖的那个文件。
     */
    const enforceL3Range = ctx.enforceL3Range !== false;
    if (enforceL3Range) {
        const strays = l3.filter((mutant) => {
            const text = texts.get(mutant.file ?? '');
            if (text === undefined)
                return true;
            const index = text.indexOf(mutant.find);
            if (index === -1)
                return true;
            return !inAnyRange(lineOfIn(text, index), ranges);
        });
        if (strays.length > 0) {
            return unmeasured(`L3 contract-violation anchor(s) ${strays.map((m) => m.id).join(', ')} do not lie inside the changed-line ranges, so applying them would mutate regions this task never touched`);
        }
    }
    /**
     * ── ★★★ 两条闸门（2026-10-12）───────────────────────────────────────────────
     *
     * `maxPerOperator` 收紧**分布**，`maxMutants` 收紧**总量**。两者都在
     * `gate()` 内部生效，而不是靠调用方自觉 —— 上一版它们只在类型里存在。
     */
    const maxPerOperator = ctx.maxPerOperator ?? DEFAULT_MAX_PER_OPERATOR;
    const maxMutants = ctx.maxMutants ?? DEFAULT_MAX_MUTANTS;
    /** 组装全部变异体（含镜像），逐条应用 → 跑套件 → 还原。 */
    const plans = [];
    for (const file of declaredFiles) {
        const text = texts.get(file);
        if (text === undefined)
            continue;
        const lineCount = text.split('\n').length;
        /**
         * ★ 只按【改动行集合】变异，不做包络展开。
         *
         *   `changedLines` 是 git 给的【离散行号】。把它折成一个 `startLine..endLine`
         *   的包络再变异，就等于把两个孤立改动之间的整段没碰过的代码也放进分母 ——
         *   这正是 R1（`--lines` 语义）要防的那个失真，只是换了个入口。
         *
         *   MEASURED（本任务的夹具臂 1b 抓到）：`changedLines=[1,40]` 折成包络 1-40 后，
         *   算子层只看到"第 1 行与第 40 行"两处（toRanges 的相邻合并语义），
         *   结果一条变异体都生不出来，报告说"没有可变异的东西"。
         *   只有当【连续区间】真的连续时，包络才等于集合本身。
         */
        const effective = changedLines.filter((line) => line >= 1 && line <= lineCount);
        if (effective.length === 0)
            continue;
        const generated = generateMutants(text, {
            startLine: Math.min(...effective),
            endLine: Math.max(...effective),
            changedLines: effective,
            file,
            maxPerOperator,
            ...(ctx.operators === undefined ? {} : { operators: ctx.operators }),
        });
        for (const mutant of generated) {
            plans.push({ mutant, file, originalText: text });
            for (const mirror of mirrorMap) {
                if (mirror.sourcePath !== file)
                    continue;
                const mirrorText = texts.get(mirror.mirrorPath) ?? tryRead(readFile, mirror.mirrorPath);
                if (mirrorText === undefined)
                    continue;
                texts.set(mirror.mirrorPath, mirrorText);
                const mirrorMutant = applyToMirror(mirrorText, mutant);
                if (mirrorMutant === undefined)
                    continue;
                plans.push({
                    mutant: { ...mirrorMutant, id: `${mirrorMutant.id}+mirror:${mirror.mirrorPath}`, file: mirror.mirrorPath },
                    file: mirror.mirrorPath,
                    originalText: mirrorText,
                });
            }
        }
    }
    for (const mutant of l3) {
        const file = mutant.file ?? '';
        const text = texts.get(file) ?? tryRead(readFile, file);
        if (text === undefined)
            continue;
        texts.set(file, text);
        plans.push({ mutant, file, originalText: text });
    }
    if (plans.length === 0) {
        return unmeasured(noScorableMutants({ file: declaredFiles.join(', '), startLine: ranges[0].startLine, endLine: ranges[ranges.length - 1].endLine }));
    }
    /**
     * ── ★★★ 总量闸门，以及它的【读数】─────────────────────────────────────────────
     *
     * ★ 截断必须被报出来，理由与 R1（只变异改动行）逐字同源：分母的大小**改变
     *   这条分数的含义**。一个"40 条里杀掉 30 条"与"325 条里杀掉 30 条"读起来都是
     *   `0.75` 与 `0.09`，但前者是抽样估计、后者是全量测量 —— 而它们在只看分数时同形。
     *
     * ★ 所以截断作为一条**自己的文本**进裁决（ok 与 blocked 两条路径都带），
     *   而不是被并进 `scope` 那句已经很长的话里 —— 读的人要能一眼看到它。
     */
    const selected = capMutants(plans, maxMutants);
    const dropped = plans.length - selected.length;
    const truncation = dropped === 0
        ? ''
        : `the mutant batch was truncated by its own total cap: ${selected.length} of ${plans.length} candidate(s) were run (even-stride sample), so ${dropped} mutant(s) were NOT measured — the kill rate below is over a sample, not over every changed line`;
    /**
     * ★ 基线必须能指出改动行有没有被执行。
     *   指不出 ⇒ 整批 unmeasured，并且【不再】对变异体调用 runTest。
     *   不许把「没采到覆盖」读成「都存活」或「都没覆盖」。
     *
     * ★ 行指得出、但指不出【哪一条测试】碰到这一行 ⇒ 整份已覆盖套件照跑。
     *   不许从 killerSuites 里猜一条。报告没提到的文件单独记 unmeasured，
     *   不取消已经对上的文件。同名 basename 用目录前缀对上，对不上的那个文件
     *   单独 unmeasured，不把整批当成 ambiguous。
     */
    const coverage = resolveMutationCoverage(baseline);
    if ('unmeasured' in coverage)
        return unmeasured(coverage.unmeasured);
    const earlyStop = { executed: 0, skipped: 0, stoppedEarly: 0 };
    const coverageUnmeasuredFiles = [];
    /**
     * 跑一条命令并分类。预算停止与执行器故障不同形，见下面那条注释。
     */
    const classifyCommand = async (mutant, mutantCommand) => {
        try {
            const run = await runTest(mutantCommand);
            return classifyRun(run, mutant);
        }
        catch (error) {
            /**
             * ── ★★★ 预算停止 ≠ 变异体出错（2026-10-12，修一个**假通过**）────────────────
             *
             * MEASURED（本轮加总预算时当场发现）：`scoreMutants` 里
             *
             *     scored = results.filter(o => o.outcome === 'killed' || o.outcome === 'survived')
             *     errored = results.filter(o => o.outcome === 'error')      ← 不进分母
             *
             * ⇒ 若预算在半路跑光，**剩下每一条变异体都会立刻抛**（`inBudget` 见
             *   `remaining <= 0` 即抛），而它们全被记成 `error` ⇒ **不进分母**。
             *   分母于是塌缩成"还来得及跑的那几条"：前面几条若恰好都被杀，
             *   `mutationScore` 会是 1.0 > 阈值 ⇒ ★ **报 ok**。
             *
             *   一次「那条链今天没跑完」因此被读成「这个成员的测试很强」—— 假通过，
             *   而且它与一次真正的满分在报告里**完全同形**。
             *
             * ── 修法：预算停止记 `unmeasured`，其余抛出仍记 `error` ─────────────────────
             *
             * `unmeasuredRuns.length > 0` 本来就会把整份报告打成 `disposition: 'unmeasured'`
             * （`scoreMutants`）⇒ 位置级给 `unmeasured`、**不给分、也不给 ok**。
             * 那正是这件事的正确读法：没能测量。
             *
             * ★ 而"其余抛出仍记 error"是刻意的：一次真正的执行器故障（套件起不来、
             *   路径不存在）必须与"预算跑光"不同形 —— 前者要人去看代码/环境，
             *   后者要人去调预算或让链更快。把两者并进同一个 outcome 就是把
             *   两种相反补救动作合流（本仓的老账）。
             */
            return isCompletionBudgetStop(error)
                ? {
                    outcome: 'unmeasured',
                    reason: `BUDGET stop（不是测试失败、也不是这条变异体的问题）：${error instanceof Error ? error.message : String(error)}`,
                    killedBy: [],
                }
                : {
                    outcome: 'error',
                    reason: `running the killer suite raised: ${error instanceof Error ? error.message : String(error)}`,
                    killedBy: [],
                };
        }
    };
    /**
     * 只跑基线点名的测试。一条杀死 ⇒ 其余不跑，记进 `early-stop.skipped`。
     * 预算停止不是杀死：剩下的测试不记成 skipped，整条变异体按没能测量交回去。
     */
    const runCoveringTests = async (mutant, tests) => {
        let killed = null;
        let problem = null;
        for (let index = 0; index < tests.length; index += 1) {
            if (killed !== null) {
                earlyStop.skipped += 1;
                continue;
            }
            const test = tests[index];
            if (test === undefined)
                continue;
            const observed = await classifyCommand(mutant, narrowedTemplate.replace('*', test));
            earlyStop.executed += 1;
            if (observed.outcome === 'killed') {
                killed = observed;
                continue;
            }
            if (observed.outcome === 'unmeasured' && observed.reason.startsWith('BUDGET stop'))
                return observed;
            if (observed.outcome !== 'survived')
                problem = observed;
        }
        if (killed !== null) {
            earlyStop.stoppedEarly += 1;
            return killed;
        }
        return problem ?? { outcome: 'survived', reason: 'covering tests stayed green', killedBy: [] };
    };
    const results = [];
    for (const plan of selected) {
        const line = planLine(plan);
        const reading = coverage.line(plan.file, line);
        if (reading === 'unmeasured-file') {
            if (!coverageUnmeasuredFiles.includes(plan.file))
                coverageUnmeasuredFiles.push(plan.file);
            continue;
        }
        if (reading === 'uncovered') {
            results.push({
                mutant: plan.mutant,
                outcome: 'uncovered',
                reason: `baseline did not execute ${plan.file}:${line ?? '?'}, so this mutant was not run and is not survived`,
                killedBy: [],
            });
            continue;
        }
        /**
         * `null` = 指不出逐测试，整份套件照跑。
         * 空数组 = 基线指出没有测试碰到这一行，不跑，也不另猜一条。
         * 非空 = 只跑这些测试；一条杀死则其余计入 early-stop.skipped。
         */
        const tests = coverage.testsFor(plan.file, line);
        if (tests !== null && tests.length === 0) {
            results.push({
                mutant: plan.mutant,
                outcome: 'uncovered',
                reason: `baseline named no test that executes ${plan.file}:${line ?? '?'}, so this mutant was not run and is not survived`,
                killedBy: [],
            });
            continue;
        }
        const mutatedText = plan.mutant.mutated ?? spliceOnce(plan.originalText, plan.mutant.find, plan.mutant.replace);
        try {
            await writeFile(plan.file, mutatedText);
        }
        catch (error) {
            results.push({
                mutant: plan.mutant,
                outcome: 'error',
                reason: `applying the mutant raised: ${error instanceof Error ? error.message : String(error)}`,
                killedBy: [],
            });
            continue;
        }
        let observed;
        let restoreProblem = null;
        try {
            if (tests !== null && tests.length > 0 && narrowedTemplate.includes('*')) {
                observed = await runCoveringTests(plan.mutant, tests);
            }
            else {
                /**
                 * 指不出逐测试，或命令里没有 `*` 可以收窄 ⇒ 整份已覆盖套件照跑。
                 * ★ 这里不许改成「挑 killerSuites 的第一条」。那是猜测。
                 */
                observed = await classifyCommand(plan.mutant, command);
                earlyStop.executed += 1;
            }
        }
        finally {
            /** ★ 还原必须被【验证】：把原文写回去并读回来比对。一次没还原的测量不可信。 */
            try {
                await writeFile(plan.file, plan.originalText);
                const readBack = readFile(plan.file);
                if (readBack !== plan.originalText)
                    restoreProblem = `${plan.file} did not read back byte-identical after restore`;
            }
            catch (error) {
                restoreProblem = `restoring ${plan.file} raised: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
        if (restoreProblem !== null) {
            results.push({ mutant: plan.mutant, outcome: 'error', reason: `restore FAILED: ${restoreProblem}`, killedBy: [] });
            continue;
        }
        results.push({ mutant: plan.mutant, outcome: observed.outcome, reason: observed.reason, killedBy: observed.killedBy });
    }
    /**
     * ★ 探针射程：逐文件问一次"声明的套件够不够得到它"。
     *   够不到 ⇒ 那份文件的每一个存活体都是【必然】的 ⇒ 整份报告 unmeasured。
     *   这是本判据存在的核心理由，且它必须在 scorer 之前被判定。
     *
     * ★ 读套件用 `readSuite`（可以为空），不借用 `readFile`：两者的路径空间不同 ——
     *   `readFile` 收的是【workspace 相对路径】，而杀手套件是从命令模板里来的
     *   【路径列表】（可能是绝对路径）。混用会让一次 ENOENT 被读成"套件够不到"，
     *   也就是把一次读取失败伪装成一条关于覆盖的结论 —— 这正是探针射程要防的形态。
     */
    const readSuite = ctx.readSuite ?? ((path) => readFile(path));
    const unreachable = [];
    /**
     * ★ 2026-10-12：这里此前读的是 `plans`（**全部候选**）而跑的是 `plans` —— 两者
     *   同源所以看不出来。现在跑的是 `selected`，于是这一格必须跟着改：否则
     *   "某个文件的变异体一条都没跑（被截断）"会被读成"它的探针够不到"
     *   ⇒ 一份关于**分片**的事实被报成一份关于**探针**的事实。
     */
    /**
     * ★ 报告没点名的文件不在这里问射程。够不到是探针的事实，没被点名是覆盖报告的事实。
     *   把后者送进 probeReach 会让整份报告 unmeasured，从而取消已经对上的文件。
     */
    const measuredFiles = unique(results.flatMap((result) => {
        const file = result.mutant.file;
        return file === undefined || file === '' ? [] : [file];
    }));
    /**
     * ── ★★★ 归因回退的修复（2026-10-14）：报告一份都没对上时，先问探针 ──────────────
     *
     * MEASURED（t7 把这条回退引入，3 条消费夹具当场变红）：
     *
     *   下面那格 `results.length === 0` 的早退**只看覆盖报告**，于是它把
     *   「覆盖报告真的没提到这个文件」（去修覆盖）与
     *   「杀手套件够不到被变异文件」（去改套件声明）**并成了同一句话**。
     *   而这两件事的补救动作相反 —— 正是本仓最忌的那一类合流。
     *
     *   实测形态：一个套件**根本没 import 被变异文件**时，Node 的覆盖报告里
     *   自然不会有那个文件 ⇒ 走到这里时 `results` 是空的 ⇒ 报"报告没提到"。
     *   读的人于是去查覆盖，而真正的问题是**套件声明**。
     *
     * ★ 修法：这一格只在**探针够得到**时才是"报告的事实"。够不到时，报告的沉默
     *   正是**探针**造成的后果，那份事实更具体、更接近根因，所以由它先说话
     *   （`probeProblem` 走 scorer 的常规通道，与其它够不到的场景逐字同形）。
     *
     * ★ 为什么不干脆把这一格删掉：报告点名的文件里**确实**可能没有我们关心的那个
     *   （工具只列它加载过的文件），那时"报告没提到"就是正确且唯一可说的成因。
     *   两种成因都要留着，只是不许并成一句。
     *
     * ★ 这里**不**把 `measuredFiles` 扩成"全部改动文件"：报告点名的文件与没点名的
     *   文件混在一批时（有的跑得了、有的跑不了），把没点名的送进 `probeReach` 会把
     *   整批打成 unmeasured，从而取消**已经对上**的那些文件的测量 —— 那是 t13 修掉的
     *   另一个方向。所以只在**这一批一条都没跑成**时才补问探针。
     */
    const probeFiles = unique([
        ...measuredFiles,
        ...(results.length === 0 ? coverageUnmeasuredFiles : []),
    ]);
    for (const file of probeFiles) {
        const reach = probeReach({ file }, suites, readSuite);
        if (reach.files.length === 0)
            unreachable.push(`${file}: ${reach.reason}`);
    }
    if (results.length === 0 && coverageUnmeasuredFiles.length > 0 && unreachable.length === 0) {
        return unmeasured(`the coverage report did not mention ${coverageUnmeasuredFiles.join(', ')}; those files are unmeasured, not survived and not uncovered, and no executed line remained to run — this is not "everything survived" and not "everything uncovered"`);
    }
    const report = scoreMutants({
        target: { file: declaredFiles.join(', '), startLine: ranges[0].startLine, endLine: ranges[ranges.length - 1].endLine },
        results,
        probeProblem: unreachable.length > 0 ? unreachable.join(' | ') : null,
    });
    if (report.disposition === 'unmeasured') {
        return unmeasured(report.unmeasured ?? 'the mutation run produced no interpretable result');
    }
    /**
     * ── ★★★ 样本下限：我们自己裁出来的小样本，不许产生任何裁决（2026-10-12）──────────
     *
     * MEASURED（本轮加配额时当场发现，方向是**放行**，也就是最贵的方向）：
     *
     *     截断到 6 条、杀 5 条 ⇒ 0.833 ≥ 0.6 ⇒ **ok**
     *     同样一份实现不截断（135 条里杀 5 条）⇒ 0.037 < 0.6 ⇒ blocked
     *
     * ⇒ 一个 n=6 的估计被**直接**拿去和一个固定阈值比，没有任何样本量意识：
     *   分数够高就放行，而"分数够高"在 n=6 时可以是运气。
     *
     * ★ 只对【被截断】的跑批生效（`dropped > 0`）：候选本来就少是**这次改动的事实**
     *   （样本即总体，没有抽样误差），对它设下限等于凭空造拒；而被我们裁过是
     *   **这次测量的选择**，选择造成的弱样本由我们负责。
     *
     * ★ 返回 `unmeasured` 而不是 `blocked`：这份跑批没能给出读数（去调配额 / 缩小改动面），
     *   与"这个成员的测试是装饰性的"（去补测试）是两件不同的事 —— 补救动作相反。
     */
    if (dropped > 0 && report.totals.scored < MIN_SCORED_FOR_VERDICT) {
        return unmeasured(`the mutant batch was truncated to ${selected.length} (from ${plans.length} candidate(s)) by its own total cap, `
            + `which is below the ${MIN_SCORED_FOR_VERDICT}-mutant floor for ANY verdict — a kill rate over so few mutants `
            + `can fall on either side of the threshold by luck, so this run says nothing about the delivered tests. `
            + `Raise the cap (ctx.maxMutants) or shrink what this task changed, then re-run.`);
    }
    const threshold = ctx.minKillRate ?? DEFAULT_MIN_KILL_RATE;
    const scope = `coverage: ${report.coverage.file} lines ${report.coverage.startLine}-${report.coverage.endLine} ` +
        `(${report.coverage.linesMutated} line(s) in range, ${report.totals.considered} mutant(s) considered, ${report.totals.scored} scored)` +
        /**
         * ★ 截断读数**并入 scope**（而不是只挂在 ok 那一支上）：被拒的成员同样需要
         *   知道"这个分数是抽样出来的" —— 否则他会去修一个抽样噪声，而那与真正的
         *   覆盖缺口在报告里同形。
         */
        (truncation === '' ? '' : `; ${truncation}`) +
        (report.totals.uncovered > 0
            ? `; ${report.totals.uncovered} uncovered mutant(s) were not run and are not survivors, but stay in the denominator`
            : '') +
        (coverageUnmeasuredFiles.length > 0
            ? `; ${coverageUnmeasuredFiles.length} file(s) absent from the coverage report are unmeasured (${coverageUnmeasuredFiles.join(', ')}), not survived and not uncovered`
            : '') +
        (earlyStop.skipped > 0
            ? `; early-stop.skipped=${earlyStop.skipped}`
            : '');
    const earlyStopReadout = {
        executed: earlyStop.executed,
        skipped: earlyStop.skipped,
        stoppedEarly: earlyStop.stoppedEarly,
    };
    /**
     * ★ 装饰性测试 ⇒ blocked，且必须【报出存活数与覆盖范围】。
     *   只报一个分数是不够的：读日志的人要能看见"哪几条活着、在哪一行"。
     */
    if (report.mutationScore !== null && report.mutationScore < threshold) {
        const survivors = report.survivingMutants
            .slice(0, 8)
            .map((mutant) => `${mutant.id}${mutant.file === null ? '' : ` in ${mutant.file}`}${mutant.oftenEquivalent ? ' (often-equivalent, still scored)' : ''}`);
        return blocked([
            `the delivered tests are decorative on the lines this task changed: mutation score ${report.mutationScore} < ${threshold} ` +
                `(${report.totals.survived}/${report.totals.scored} mutant(s) survived${report.totals.equivalent > 0 ? `, ${report.totals.equivalent} tagged as often-equivalent but still counted` : ''})`,
            ...survivors.map((survivor) => `survivor: ${survivor}`),
            report.survivingMutants.length > survivors.length ? `...and ${report.survivingMutants.length - survivors.length} more survivor(s)` : '',
            scope,
        ].filter((item) => item !== ''));
    }
    return {
        ok: true,
        mutationReport: report,
        mutationScore: report.mutationScore,
        killed: report.totals.killed,
        survived: report.totals.survived,
        corpus: [...corpus],
        /**
         * ★ 这一轮的**闸门读数**：两条上限的生效值 + 被丢弃的条数。
         *   ★ 只在真的发生截断时才挂 `truncated`（`undefined` 与 `0` 不同形：
         *     前者是"没截断"，后者是"截断了 0 条"—— 后者不可能，但不该靠约定）。
         *   ★ 上限值**恒在场**：它是"这一轮的分数是在什么界内量出来的"的一部分，
         *     而读数缺席会让"用了缺省"与"限制没生效"同形。
         */
        batch: {
            maxMutants,
            maxPerOperator,
            considered: plans.length,
            ran: selected.length,
            ...dropped === 0 ? {} : { truncated: dropped },
        },
        scope,
        /** ★ 逐测试早停的读数。skipped 是「点了名、但因为前面已经杀死而没跑」的次数。 */
        'early-stop': earlyStopReadout,
        /** 报告没提到的文件。空数组 = 没有这种文件（不是「没采到覆盖」）。 */
        coverageUnmeasured: [...coverageUnmeasuredFiles],
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// 小工具（纯函数，无 I/O）
// ─────────────────────────────────────────────────────────────────────────────
/** 把一串行号折成尽量少的连续区间。 */
export function toRanges(lines) {
    const sorted = [...new Set(lines.filter((line) => Number.isSafeInteger(line) && line > 0))].sort((a, b) => a - b);
    const ranges = [];
    for (const line of sorted) {
        const last = ranges[ranges.length - 1];
        if (last !== undefined && line === last.endLine + 1)
            last.endLine = line;
        else
            ranges.push({ startLine: line, endLine: line });
    }
    return ranges;
}
function inAnyRange(line, ranges) {
    return ranges.some((range) => line >= range.startLine && line <= range.endLine);
}
/**
 * ★ 这里【没有】rangeFor：包络展开是 R1 的失效形态本身。
 *   一次改动落在第 10 行与第 400 行时，包络 10-400 会把 390 行没人碰过的代码
 *   放进分母。改动行集合必须原样传到算子层（见上面的 `effective`）。
 */
function lineOfIn(text, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1)
        if (text[i] === '\n')
            line += 1;
    return line;
}
function spliceOnce(text, find, replace) {
    const index = text.indexOf(find);
    if (index === -1)
        return text;
    return text.slice(0, index) + replace + text.slice(index + find.length);
}
/**
 * 基线命令带上 Node 的行覆盖。已经有这个开关、或不是 `node --test`，原样返回。
 * ★ 变异之后若收窄到一条测试，用的是同一条模板。
 */
function requestLineCoverage(command) {
    if (command.includes('--experimental-test-coverage'))
        return command;
    if (!/(?:^|\s)node(?:\s|$)/.test(command) || !/(?:^|\s)--test(?:\s|$)/.test(command))
        return command;
    return command.replace(/(?:^|\s)node(?=\s)/, (match) => `${match} --experimental-test-coverage`);
}
/** 变异体落在哪一行。对不上 ⇒ undefined，调用方照旧跑，不把「对不上」说成未覆盖。 */
function planLine(plan) {
    if (plan.mutant.line !== undefined)
        return plan.mutant.line;
    const index = plan.originalText.indexOf(plan.mutant.find);
    if (index === -1)
        return undefined;
    return lineOfIn(plan.originalText, index);
}
function tryRead(readFile, path) {
    try {
        return readFile(path);
    }
    catch {
        return undefined;
    }
}
/** 编译产物镜像：`src/x.ts` ⇒ `lib/x.js`。仅对 src 下的 TS 生效。 */
export function defaultMirrors(files) {
    const mirrors = [];
    for (const file of files) {
        if (!file.startsWith('src/') || !file.endsWith('.ts'))
            continue;
        mirrors.push({ sourcePath: file, mirrorPath: `lib/${file.slice('src/'.length, -'.ts'.length)}.js` });
    }
    return mirrors;
}
/** 把一条变异体套到镜像文本上。原文匹配不上 ⇒ 返回 undefined（产物过期）。 */
function applyToMirror(mirrorText, mutant) {
    const find = mutant.find.trim() === mutant.find ? mutant.find : mutant.find;
    const index = mirrorText.indexOf(find);
    if (index === -1)
        return undefined;
    const line = lineOfIn(mirrorText, index);
    return {
        ...mutant,
        line,
        mutated: mirrorText.slice(0, index) + mutant.replace + mirrorText.slice(index + find.length),
    };
}
