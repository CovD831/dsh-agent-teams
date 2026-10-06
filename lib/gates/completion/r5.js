/**
 * ── 判据：新测试必须在【父版本】上变红，再在【修复版本】上变绿（R5：红前绿后）──────
 *
 * 插入点：`completion`（成员汇报完成时）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * 一条【装饰性测试】：它什么都不断言，或者它断言的东西在改动前就已经成立。
 * 于是它
 *
 *   · 在任何版本上都是绿的 ⇒ 它从不保护任何东西，而它占着"有测试"的位置；
 *   · 与一条真的能抓住回归的测试在报告里【完全同形】（都是 "1 test passed"）；
 *   · 成员还会把它写进 acceptance 的 evidence，于是"验过了"这句话也失去内容。
 *
 * ★ 这与 `completion.verify-rerun` 堵的洞【同源但不是同一条】：
 *   verify-rerun 问「命令真的跑了吗」（自报的 exitCode 可不可信）；
 *   本判据问「那条测试真的测到了东西吗」（它是绿的是因为代码对，还是因为它没测）。
 *   一个成员可以真跑命令、真贴出绿色的输出，而那条测试是装饰品 —— verify-rerun
 *   对它是无话可说的，因为它报的 exitCode 是真的。
 *
 * ── 为什么需要【两个版本】而不只是一个 ────────────────────────────────────────
 *
 * 只看修复版本：装饰性测试与真测试都是绿的 ⇒ 不可区分。
 * 只看父版本：真测试红、装饰性测试绿 ⇒ ★ 可分。这就是 R5 的全部内容。
 *
 * 而"父版本"只能来自 git 历史（START-HERE §5.1）：会话事件给的是
 * `{ path, oldText, newText }`——一次编辑的前后文本，拼不出一个可 checkout 的
 * 版本。⇒ 父版本由 `src/worktree.ts` 提供，`createTaskWorktree(...).base`
 * 就是那个父版本 hash（§5.2）。
 *
 * ── 执行器由调用方注入（保持判据本身是纯数据变换）──────────────────────────────
 *
 * ★ 本文件【不 import 任何 I/O】—— 不 import node:fs / node:child_process，
 *   也不 import `src/worktree.ts`（那是个 I/O 模块）。要跑测试、要读文件、
 *   要 checkout 父版本，全部由调用方注入：
 *
 *       runTestOnRevision(test, revision) → Promise<{ exitCode, output }>
 *
 *   判据只做数据变换：把两轮的退出码变成 ok / blocked / unmeasured。
 *
 * ★ 契约里那条纪律不是形式主义，它正是本判据唯一能被测的原因：夹具用一个
 *   【假的 git】就能造出"父版本上红、修复版本上绿"，而不需要真的建仓库
 *   （见 `scripts/gate-r5.test.mjs` 的三臂）。
 *
 * ── 三态，且后两者不同形（契约 §3.4）────────────────────────────────────────────
 *
 *   ok         —— 两轮都测成了，每一条声明的测试都在父版本上红、在修复版本上绿
 *   blocked    —— 测成了，发现问题：某条测试在父版本上【没有红】（装饰品）。
 *                 报错必须【指名是哪一条测试】。口径取严（见下），所以这一态
 *                 必然可复现，而不是"偶尔拦一下"。
 *   unmeasured —— 没能测量，且必须说清是哪一种"没能"：
 *                 ① 不知道哪些文件是新测试（没有会话事件）；
 *                 ② 拿不到父版本（没有 worktree / 不是 git 仓库）；
 *                 ③ 测试跑不起来（执行器抛错、输出截断）。
 *                 ★ 三种都【不是 ok】。把"没隔离"当成"检查通过"，就是这条判据存在的理由。
 *
 * ── 口径取严：为什么"两次都红"要算伪造 ────────────────────────────────────────
 *
 * 一条测试可能与某条【无关的】既有失败绑定：父版本红、修复版本也红。
 * 这时不能宣称"它在父版本上红了"（红的原因是别的），也不能宣称"它在修复版本上绿了"
 * —— 两句话都不成立，因为没有一个值得测量的状态可言。
 *
 * 留着一个更松的口径（"父版本红就够了"）就会有一个【只在第一次运行时关掉】的
 * 检查：那条测试与既有失败绑定之后，本判据再也说不了它什么 —— 而它在报告里
 * 依旧是 "R5 ok"。⇒ 取严，并【同时报出】父版本与修复版本的退出码，让人看得见
 * 是"没红"还是"红了两次"。
 *
 * ── 归属与版本（两种原料缺一不可）─────────────────────────────────────────────
 *
 *   哪些文件是新测试 ← 由调用方从会话事件折叠后传入（START-HERE §5.1）
 *   父版本在哪个 hash ← 由调用方从 worktree 传入（§5.2）
 *   两者的扫描范围由调用方【显式】给出（scanDirs）—— 本判据不猜文件名。
 *   ★ 一个没被扫描到的测试【不在】结论里，不是"通过了"。
 */
import { blocked, unmeasured } from "../registry.js";
export const id = 'completion.r5';
export const point = 'completion';
export const description = '把新测试在【父版本】（worktree 的 base）上跑一遍：它必须先红；再到修复版本上必须绿。父版本拿不到 ⇒ unmeasured，不是 ok';
/**
 * 只对【声明了新增测试】的【实现/修复】任务生效。
 *
 * ★ 两个条件的由来：
 *   · 只有 implementation/repair 的契约要求 changedPaths / 写域（与
 *     `dispatch.changed-paths` 同一条边界：对其余类别做核对会把"本就不该填"
 *     误判成"漏报"）；
 *   · 没声明新增测试 ⇒ 没有"新测试"这个对象，R5 无从谈起。
 *
 * ★ 这里【故意】不看 `newTestFiles` 是否为空：见 gate() 里的注释 ——
 *   "声明了但一个文件都没落"必须与"压根没声明"不同形。
 *
 * ── ★ 为什么必须有 `wantsCompleted` / `taskNotTerminal` 两个守卫（MEASURED）────
 *
 * 本判据此前只问 kind 与 `newTestFiles`，于是它在**每一次** implementation 更新上
 * 都会求值 —— 包括成员刚开工的那一次 `in_progress`。实测：
 *
 *     r5.appliesTo({ kind:'implementation', newTestFiles:[…], wantsCompleted:false }) ⇒ true
 *     而三条兄弟判据（verify-rerun / mutation / backtest）在同一 ctx 上 ⇒ false
 *
 * ⇒ 后果：一条"我开始干活了"的更新会被"红前绿后"审判并拒绝，而那时父版本与
 *   扫描范围根本还不存在。lifecycle-verify 实测断在 `:801`（正是那条 in_progress）。
 *
 * ★ 这个缺陷此前一直被掩盖着：注入面没接入 `newTestFiles` ⇒ 本判据恒 `skipped`。
 *   注入面一补齐它立刻显形。**"没被调用"不等于"没问题"。**
 *
 * ★ 为什么修在【判据侧】而不是让调用方各自记得只在该问的时候注入：
 *   调用方侧收口只挡住"那一次调用"，任何别的调用方仍会踩到同一个坑。三条兄弟
 *   判据都已经带着这两个守卫 —— **这是判据之间的不一致，属于判据自己的事**。
 */
export function appliesTo(ctx) {
    const kind = ctx?.task?.kind;
    if (kind !== 'implementation' && kind !== 'repair')
        return false;
    /**
     * ★ 与 verify-rerun / mutation 同一口径：
     *   · 不是试图置为 completed ⇒ 没有完成裁决要复核（开工/中途更新不该被审判）；
     *   · 终态补证据不是新的完成裁决（issue159 路径）。
     */
    if (ctx?.wantsCompleted !== true || ctx?.taskNotTerminal !== true)
        return false;
    return Array.isArray(ctx?.update?.newTestFiles);
}
/**
 * ── 输入面声明（t4）───────────────────────────────────────────────────────────
 *
 * ★ 本条在上一轮【真的缺过输入】，而缺口就在这三格上，且症状与"通过"同形：
 *
 *   MEASURED（本轮开工前的复盘）：`parentRevision` / `scanDirs` /
 *   `runTestOnRevision` 都曾经没接上。三者的缺口各自返回一条 `unmeasured`
 *   （"no parent revision is available" / "no scan directories were declared" /
 *   "no revision runner was injected"），而 `unmeasured` 在日志里与 `ok` 同形。
 *   ⇒ 一条**从未运行过**的判据被读成了"R5 检查过了，没问题"。
 *
 * ★ 三格各自对着文件里的一处 `unmeasured`，逐条对齐（声明与未测量臂必须一致）：
 *
 *   · `runTestOnRevision` ⇒ `gate()` ① "no revision runner was injected"
 *   · `scanDirs`          ⇒ `gate()` ② "no scan directories were declared by the caller"
 *   · `parentRevision`    ⇒ `gate()` ④ "no parent revision is available"
 *
 * ★ `parentRevision` 是【来自 worktree 的 base】——由 t5 的 `onWorktree` 传递。
 *   实测过的一次缺口正是它：没有 worktree ⇒ 没有 base ⇒ 判据静默 unmeasured。
 *   声明它 = 把"这条判据需要一个隔离的父版本"变成一次机械核对，而不是一句注释。
 *
 * ★ `update.newTestFiles` 是【被审的对象】（③ 的 `targets.length === 0` 那支），
 *   且 `appliesTo` 的第三个条件读的就是它。它与 `parentRevision` 不同形：
 *   前者是"测什么"，后者是"拿什么当基准"。两格都缺时的措辞也不同（②/③ vs ④），
 *   所以分开声明 —— 合成一格会让"没有新测试"与"没有基准"在核对结果里同形。
 *
 * ★ `task.kind` / `wantsCompleted` / `taskNotTerminal` 是 `appliesTo` 的闸门
 *   （见上面的注释：它们是判据之间的不一致被修掉的那一处）。声明它们是同一口径的
 *   要求 —— 不适用就不报，而"为什么不适用"必须读得出来（requires.ts 的闸门）。
 */
export const requires = [
    'runTestOnRevision',
    'scanDirs',
    'parentRevision',
    'update.newTestFiles',
    'task.kind',
    'wantsCompleted',
    'taskNotTerminal',
];
/** 测试文件后缀。★ 两种都用：`.test.mjs` 不是"以 .mjs 结尾的测试"以外的意思。 */
const TEST_SUFFIXES = ['.test.mjs', '.test.js', '.spec.mjs', '.spec.js', '.test.ts', '.spec.ts'];
/**
 * 折掉一个写路径的根前缀（两个调用方给前缀，一个不给）。
 *
 * `src/gates/completion/r5.ts` ⇒ `gates/completion/r5.ts`
 * 这样即便调用方交来的是"相对 src 的路径"，也能与本仓库根相对的上报路径对上。
 */
function stripSourceRoot(path) {
    return path.replace(/^src\//, '');
}
/**
 * 一条被声明的测试在运行器眼里可能叫哪些名字。
 *
 * ★ 为什么是【多个候选】而不是一个折出来的路径：
 *
 *   `node --test` 报的是"它第一次遇到该文件时的路径形态"，可能是
 *   `gate-r5.test.mjs`（相对 cwd）也可能是 `scripts/gate-r5.test.mjs`。
 *   只看一种形态，就会出现"父版本上真的红了、却因为名字对不上而被判没测到"
 *   —— 那是把一次测量失败伪装成一条装饰性测试。
 *
 * ★ 为什么候选之间是【集合成员判断】而不是子串包含：
 *   子串会把 `a.test.mjs` 与 `b/a.test.mjs` 混起来（跨目录同名）。
 *   候选里只有"同一个文件的两种写法"：`src/` 前缀折掉的前后两种，
 *   以及裸基名（因为基名可能正是相对 cwd 的形态）。
 */
function testKeyCandidates(path) {
    const trimmed = path.trim().replace(/^\.\//, '');
    const basename = trimmed.split('/').pop();
    return [trimmed, stripSourceRoot(trimmed), basename];
}
/**
 * 一条被声明的路径是不是【测试】，以及它在不在调用方给的扫描范围里。
 *
 * 两条规则合起来 = "一个文件算被测的 ⇔ 它是一条测试文件【且】在扫描范围之内"：
 *   · 后缀是 `.test.*` / `.spec.*`（本仓库的约定，两种都是）；
 *   · 在某个 scanDir 之下 —— 扫描范围由调用方显式给出，判据【不猜】目录名。
 *
 * ★ 一个没被扫描到的测试【不在】结论里，不是"通过了"：若一条都被扫不到，
 *   gate() 返回 unmeasured（见下），而不是 ok。
 */
function isTestInside(path, scanDirs) {
    if (!TEST_SUFFIXES.some((suffix) => path.endsWith(suffix)))
        return false;
    const directories = scanDirs.map((dir) => dir.replace(/\/+$/, '')).filter((dir) => dir !== '' && dir !== '.');
    return directories.some((dir) => path === dir || path.startsWith(`${dir}/`) || stripSourceRoot(path).startsWith(`${dir}/`));
}
/** 执行器交回来的东西可能是半截的（测试在编辑器里、输出被截断）—— 那是没测成，不是通过。 */
function exitCodeOf(result) {
    return typeof result?.exitCode === 'number' && Number.isSafeInteger(result.exitCode)
        ? result.exitCode
        : undefined;
}
export async function gate(ctx) {
    const run = ctx?.runTestOnRevision;
    const scanDirs = ctx?.scanDirs;
    /**
     * ★ ① 没有执行器 ⇒ unmeasured，不是 ok。
     *   一个不能重跑测试的判据如果返回 ok，就是"装上了但从不生效"——比没装更坏，
     *   因为它会让人以为验过了。
     */
    if (typeof run !== 'function') {
        return unmeasured('R5 could not run any test: no revision runner was injected, so no new test could be shown to fail on the parent revision');
    }
    /**
     * ★ ② 猜不出测试路径 ⇒ unmeasured。
     *   用没有根据的默认值（比如猜 "scripts"）会把"我没能测量"伪装成一次真测量：
     *   运行器会返回 []，而空集会被当成"没有新测试要查" ⇒ ok。
     */
    if (!Array.isArray(scanDirs)) {
        return unmeasured('R5 could not locate the new test files: no scan directories were declared by the caller, so the reported new tests could not be folded into runnable test paths');
    }
    const targets = [...new Set((ctx?.update?.newTestFiles ?? []).map(testKeyCandidates).flat())]
        .filter((path) => isTestInside(path, scanDirs))
        .sort();
    /**
     * ★ ③ 一条新测试都没找到 ⇒ unmeasured，不是 ok。
     *
     *   三种情形必须与"某条测试在父版本上没红"那个 blocked 分开：
     *     · 声明了 newTestFiles，但里面没有测试文件（比如只报了 `src/impl.ts`）；
     *     · 一条都没声明（空数组）；
     *     · 测试文件写了，但落在调用方给的扫描范围之外。
     *   三者都不是"检查通过"，也都不该说"某条测试是装饰品"——因为我们连那条测试
     *   都没找到。把它们并进 ok 就是判据在自我背书。
     */
    if (targets.length === 0) {
        const reported = ctx?.update?.newTestFiles ?? [];
        return unmeasured(`R5 could not locate the new test files: none of the ${reported.length} reported file(s) resolve to a test path inside ${JSON.stringify(scanDirs)}`);
    }
    const parent = ctx?.parentRevision;
    /**
     * ★ ④ 拿不到父版本 ⇒ unmeasured，且措辞必须说清是"隔不了"而不是"不需要"
     *   （与 `src/worktree.ts` 的拒绝同一条口径）。
     *
     *   这是本判据最容易走偏的一步：没有隔离时返回 ok，会把"我测不了"变成
     *   "检查通过"，读日志的人再也看不出这条测试有没有被 R5 检查过。
     */
    if (typeof parent !== 'string' || parent.trim() === '') {
        return unmeasured(`R5 could not check the ${targets.length} reported new test file(s): no parent revision is available (this task has no isolated worktree), so no test could be shown to fail before the fix`);
    }
    const results = [];
    const fabricated = [];
    for (const test of targets) {
        let parentResult;
        let fixedResult;
        try {
            parentResult = await run(test, parent.trim());
            fixedResult = await run(test, 'working-tree');
        }
        catch (error) {
            /**
             * ★ 执行器抛错 ⇒ unmeasured，不是 blocked。
             *   两者不同形：前者说"我没能跑它"，后者说"它跑了并且说明这条测试是装饰品"。
             *   把它们并成一类，会让一次基础设施故障伪装成一个关于工作的结论（§3.4）。
             */
            return unmeasured(`R5 could not run "${test}": the revision runner raised ${String(error?.message)}`);
        }
        const parentExit = exitCodeOf(parentResult);
        const fixedExit = exitCodeOf(fixedResult);
        if (parentExit === undefined || fixedExit === undefined) {
            return unmeasured(`R5 could not measure "${test}": the revision runner returned no integer exit code (parent=${JSON.stringify(parentResult?.exitCode)}, fixed=${JSON.stringify(fixedResult?.exitCode)})`);
        }
        results.push({ test, parentExitCode: parentExit, fixedExitCode: fixedExit });
        if (parentExit === 0 || fixedExit !== 0)
            fabricated.push({ test, parentExitCode: parentExit, fixedExitCode: fixedExit });
    }
    if (fabricated.length > 0) {
        return blocked(fabricated.map((item) => item.parentExitCode === 0
            ? `"${item.test}" is a decorative test: it already passed on the parent revision (exit 0), so it cannot be demonstrating the fix (fixed revision exit ${item.fixedExitCode})`
            : `"${item.test}" failed on both revisions (parent exit ${item.parentExitCode}, fixed exit ${item.fixedExitCode}); it never turned green, so it is not evidence for this fix`));
    }
    /**
     * ★ 通过时【也把两轮结果交出去】：让调用方把"父版本上红、修复版本上绿"
     *   这个观测落进记录，而不是让读者只能相信"R5 说它过了"。
     *   （与 verify-rerun 交回 reruns、changed-paths 交回 verifiedChangedPaths 同构。）
     */
    return { ok: true, r5: { parentRevision: parent.trim(), verified: results } };
}
