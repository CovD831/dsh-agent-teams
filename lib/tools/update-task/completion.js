/**
 * ── completion 位置的接线（t70：从 update-task.ts 拆出）─────────────────────────────
 *
 * ── ★★ 为什么拆 ────────────────────────────────────────────────────────────────
 *
 * `update-task.ts`（1120 行）装着 contract / dispatch / completion **三个插入点**，
 * 而它今晚**连续挡住了 5 条任务** ⇒ 每一次都让另一条任务**必须等**。
 * 本模块是其中**最大**的一段：**271 行**（含基准、覆盖输入、以及那一份最长的 ctx）。
 *
 * ── ★★★ 而搬运必须【逐字】───────────────────────────────────────────────────────
 *
 * `scripts/gate-update-task-injections.test.mjs` 把拆前的 **17 格注入**
 * （字段名 + **右侧表达式**）抽成清单，逐条断言它们仍在对的位置、且**右侧逐字相同**。
 *
 * ★ 而那条护栏**第一次实战就抓到了本文件的第一版**：我在搬运 dispatch 那一段时
 *   顺手把 `changedPaths: input.changedPaths` 改成了 `[...input.changedPaths]`。
 *   ⇒ 形态与两次真实事故（t39 / 并入 t54）**不同、后果同族**：
 *     **丢的不是格名，而是格的右侧。**
 *
 * ── ★★ 正确的做法：让【搬运的单元保持逐字】，把差异挤到边界上 ────────────────────
 *
 *   ⇒ 入参在入口处**拆成与原来同名的局部量**（`const task = input.task` …），
 *     于是下面这 271 行**一个字都不用改**。
 *   ★ 而不是"让这一大段去适应新的环境" —— 那样一定会改动段内的东西，
 *     而改动段内就是那条护栏要抓的事。
 *
 * ── ★ 而"段"的边界是【数出来的】，不是看着像哪儿断了就在哪儿断 ──────────────────
 *
 *   MEASURED（我第一版）：我以为这一段只是 `const completionContext = { … }`
 *   （172 行），而编译当场告诉我 `baseline` / `coverageInput` / `wantsCompleted`
 *   也在段内 —— 它们就在 ctx 之前（第 627-707 行）。
 *   ⇒ ★ 真正的边界是 **271 行**：从 `baselineExit`（基准）到 `completionGates`（求值）。
 *     **一个段不是"那个对象字面量"，而是"为那个对象准备输入的全部"。**
 */
import { inputSurfaceOf, deriveCoverageInput, deriveScanDirs } from "../shared/entities.js";
import { resolveBaseRevision, readWorkspaceFileSync, runVerifyCommand, runVerifyCommandCaptured, writeWorkspaceFileSync, loadVerifyCommandRules, runInDetachedRevision, pluginRoot } from "../shared/entities.js";
/**
 * ── ★★★ 2026-10-12：completion 链的两件新基础设施（t84 家族）─────────────────────
 *
 *   · `createCompletionBudget` / `runWithinBudget` —— 整条链的 wall-clock 总预算。
 *     ★ 本模块是**唯一**持有它「有界」这一事实的地方：判据不读时钟（契约 §2），
 *       所以"还剩多少时间"只能在这里变成执行器的超时。
 *   · `recoverMutationJournal` / `recordMutationWrite` —— 就地变异的**可恢复性**。
 *     ★ mutation 判据会改 workspace 里的生产文件、跑测试、再改回来；`finally`
 *       不覆盖 SIGKILL。实测后果见 `entities.ts` 那段（`src/worktree.ts:366` 的
 *       `=`，让 `pnpm build` 从此必失败）。
 */
import { createCompletionBudget, recordMutationWrite, recoverMutationJournal, runWithinBudget } from "../shared/entities.js";
import { TERMINAL_TASK_STATUSES } from "../../types.js";
import { parseKnownBaselineFailures } from "../../gates/completion/backtest.js";
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
/**
 * ── ★★★ t92：这一格是 t70 的拆分【丢掉】的那条接线（t76 的修复）───────────────────
 *
 * MEASURED（逐符号核对）：`parseKnownBaselineFailures` 在拆分前于
 * `src/tools/update-task.ts` 出现 3 次，拆分后在整个调用方面 **0 次**
 * （而判据侧仍在 `backtest.ts` 里）。
 * ⇒ 于是「判据在，而调用方不再喂它」—— 那与 t41/t83 是同一族。
 *
 * ★ 而它丢得**不留痕迹**：`gate-backtest-baseline` 的臂 12 一直在指名测它，
 *   而那条红被读成了"夹具读旧位置" ⇒ 真回退与"读错位置"在失败清单里同形。
 *
 * ★ 与 `loadKindRequirementsSync` 同形：每次调用都读盘，不缓存 ——
 *   改那张 pin 立刻生效，不需要重跑构建。
 * ★ 而读不到时【返回 undefined 而不是空数组】—— 因为「清单缺席」与
 *   「清单恰好覆盖了全部失败」必须不同形（判据的第三态靠这个区分）。
 */
/**
 * ── ★★★ t23：那只 `catch { continue }` 把"接错了"读成了"没找到" ────────────────
 *
 * MEASURED（t23 复现，与本任务的正面/反面/反半边三条臂逐字对应）：
 *
 *     ① 装载器传数组、判据又解一层  ⇒ 恒抛 ⇒ 被这里吞掉 ⇒ `undefined`
 *     ② ★ **"清单在场且合法"也落 `undefined`** —— 与"文件不存在"【同形】
 *
 *   ⇒ ★ 后果：判据永远看到「清单缺席」⇒ 永远走第三态「无法归因」⇒
 *     **清单做多少条都没用**（18 条与 0 条在判据眼里同形）。
 *
 * ── 修法：三态必须在这里就分开，而不是靠一个 `catch` 合并 ──────────────────────
 *
 *   `readFileSync` 的失败与"文件读到了但内容坏了"是**两件不同的事**：
 *
 *     · 文件**不存在**（ENOENT）        ⇒ 这一棵候选树没有清单 ⇒ **试下一个**（正常）
 *     · 文件在、而**读/解析/判据拒收**失败 ⇒ ★ **不许静默** —— 那是"接错了"，
 *                                            与"它不在这儿"的**补救动作相反**
 *
 *   ★ 而"试下一个候选"这条语义必须保住：这是一个**候选列表**（两处路径），
 *     第一个不存在是正常的，不能因此报错。⇒ 只有【ENOENT】才 `continue`。
 *
 *   ★ 为什么判 `error.code === 'ENOENT'` 而不是"捕获一切"：
 *     `ENOENT` 是**这一件事的机械名字**，而它是内核给的，不是我猜的。
 */
function isMissingFileError(error) {
    return typeof error === 'object' && error !== null
        && error.code === 'ENOENT';
}
/**
 * ── ★★★ 锚点：`pluginRoot()`，而**不是** `import.meta.url` 的相对层数（2026-10-10 修）──
 *
 * MEASURED（本轮实测；这条缺陷正挡着全队终态写入）：
 *
 *   旧写法是**两个候选**，而**两个都落空** ⇒ 恒返回 `undefined`：
 *
 *   ① `join(here, '..', '..', 'scripts', …)`，`here = lib/tools/update-task/`
 *      ⇒ 得 `<仓库根>/lib/scripts/fixtures/…`
 *      ★ 而 `lib/` 下面**没有** `scripts/`（实测 `ls lib/scripts` ⇒ No such file）
 *        ⇒ 候选 ① **永远失败**。
 *      ★ 根因是**少一层**：从 `lib/tools/update-task/` 到仓库根是**三级**
 *        （update-task → tools → lib → 仓库根），需要 `'..','..','..'`。
 *      ★★ 而它**不报错** —— 层数错的表现是"读不到"，与"这个文件不在这儿"同形。
 *        这正是 `quality-gates.ts:1093` 记的那个坑（"层数抄错不会报错、
 *        只会指向一个不存在的目录"），本条是它的**第二个实例**。
 *
 *   ② `join(process.cwd(), 'scripts', …)` ⇒ 宿主 cwd 是 **profile 目录**
 *      ⇒ 也**永远失败**。★ 而它比"失败"更坏：它把"读到了**错地方**的那一份文件"
 *      与"读到了"做成同形 —— 若哪天 profile 下恰好也有一份同名文件，
 *      判据会拿**别人家的清单**去扣本队的已知失败，而那**不会报错**。
 *
 *   ⇒ 后果：见 `undefined` ⇒ 判据走第三态「attribution is impossible」
 *     ⇒ **pin 清单无论多少条都扣不掉任何已知失败**（18 条与 0 条同形）。
 *
 * ── 为什么这里 `pluginRoot()` 是**对的**锚点（与上面 `tools.ts` 那一处相反）──────
 *
 *   因为**这份文件是【插件自己的】数据文件**（`scripts/fixtures/baseline-known-failures.json`
 *   随源码走）—— 它不是被审对象的属性，与**用户的工作区无关**。
 *   ★ 这与 `tools/shared/entities.ts` 的 `loadVerifyCommandRules`（"数据文件跟着源码走"）
 *     是**同一族**，而与本文件隔壁 `tools.ts` 里那个 `stateRoot`（要的是 workspace）
 *     是**相反**的一族。⇒ 两处结论**相反而不是矛盾**：问的是"这是谁的树"。
 *
 * ── ★★★ 但它**不随包自动到达**：这条数据文件靠 `package.json` 的 `files` 显式收录 ────
 *
 *   MEASURED（本任务实测，独立审核工先发现、本处复核）：
 *
 *     · `scripts/git-artifacts.mjs` **没有任何 copy/拷贝动作**（`grep -n 'cp|copy|copyFile|mkdir'`
 *       ⇒ 零匹配）；`tsconfig.json` 的 `rootDir = "src"` ⇒ **`lib/` 里根本不会有 `scripts/`**。
 *     · 实测 `ls lib/scripts` ⇒ `No such file or directory`（**从未存在过**）。
 *     ⇒ ★ 所以"`lib/` 里也有一份副本被 build 拷进去"这句**是假的**，本注释此前写错了它。
 *
 *   ⇒ 对**这份文件**而言，真实的到达路径**只有一条**：`package.json` 的 `files` 白名单里显式列了
 *     `"scripts/fixtures/baseline-known-failures.json"`（本任务新增那一行）
 *     ⇒ 它才与 `lib/` 一起进 npm 包。
 *
 *   ★ 措辞精度（审核工指出，免得后人读错）：`"lib"` 那一项是**整树收录**，所以**任何**放进
 *     `lib/` 的文件都会随包走（实测：丢一个 `lib/scripts-probe.json` 进去 ⇒ 随包）。
 *     ⇒ 所以"只能靠 `files`"这句话**只对这份文件成立** —— 它之所以不能走 `lib/` 那条路，
 *       是因为 build 不拷贝而 `lib/scripts` 从不存在（上一段那两条实测）。
 *       ★ 别把它读成"包里任何文件都只能靠 `files` 白名单"。
 *
 *   ★ 不收录会怎样（这就是"为什么必须显式收录"）：用户机器上**只有 `lib/`**
 *     ⇒ `pluginRoot()/scripts/fixtures/baseline-known-failures.json` 不存在
 *     ⇒ 装载器返回 `undefined` ⇒ 判据第三态「attribution is impossible」
 *     ⇒ ★ **pin 清单 18 条与 0 条重新同形** —— 也就是本文件头刚刚修好的那一态，
 *       会在**发行形态**下原样复活。
 *
 *   ★★ 而本机**测不出来**：profile 用 `link:` 指向仓库 ⇒ `scripts/` 就躺在 `lib/` 隔壁
 *     （**巧合**，不是设计）⇒ 仓库内测试对"包缺文件"这一类缺陷是**盲**的。
 *     ⇒ 所以这类缺陷必须在【只有 `lib/` 的插件家】那种形态下验（见 `files` 那一行）。
 *
 * ── ★ 同族未修的一处（队长裁定：本处不修，如实记在这里）─────────────────────────
 *
 *   `tools/shared/entities.ts` 的 `loadVerifyCommandRules` 读的是
 *   `lib/gates/contract/verify-command-rules.json` —— ★ 该文件**同样不存在**，
 *   它的两个候选在**安装形态下都落空**（`lib/gates/contract/` 不是构建产物）。
 *   ⇒ 那是**同一族的缺陷**：本处（`baseline-known-failures.json`）已修，
 *     **那一处未修、另记**（不在本任务范围内，未改 `entities.ts` 的任何代码）。
 *
 * ★ `pluginRoot()` 已经把层数钉死了（`lib/tools/shared/entities.js` ⇒ ×4，
 *   见 `entities.ts` 那条 t39 注释），且已被 stamp 读数在生产里跑通
 *   ⇒ 比在这里自己数层数安全：**数层数这件事本身已经错过两次**。
 *
 * ── ★★ 为什么可以直接 import（不必照 `quality-gates.ts` 本地化）─────────────────
 *
 *   `src/quality-gates.ts` 的本地化先例是"**新增**一条能把既存环闭合的边"⇒ TDZ。
 *   这里不是：`completion.ts → shared/entities.ts` **早就存在两条边**
 *   （本文件第 36 / 37 行的顶层具名导入），本轮只是往第 37 行的**具名列表**里
 *   加了 `pluginRoot` 一个名字 ⇒ **模块图一字未变**。
 *   （★ 与 `tools.ts:98` 的情形完全同族：那也是"往既有边上加一个名字"。）
 *   ★ 而本地化在这里反而更危险：层数要按**本文件自己的位置**（`lib/tools/update-task/`
 *     ⇒ 三级）重算，而重算正是已经错过两次的那件事。
 */
function loadKnownBaselineFailures() {
    const candidates = [
        join(pluginRoot(), 'scripts', 'fixtures', 'baseline-known-failures.json'),
    ];
    for (const candidate of candidates) {
        let text;
        try {
            text = readFileSync(candidate, 'utf8');
        }
        catch (error) {
            /** ★ 只有"这个候选不存在"才轮到下一个 —— 别的失败一律不许静默。 */
            if (isMissingFileError(error))
                continue;
            throw new Error(`known baseline failures: could not read ${candidate}: ${String(error)}`);
        }
        /**
         * ★ t23：**解一层，且只解一层**。
         *   `parseKnownBaselineFailures` 接受的是**整份清单对象**（`{ knownFailures: [...] }`），
         *   所以这里传 `raw` 而不是 `raw.knownFailures` —— 后者会让判据再解一层 ⇒ 恒抛。
         *   ⇒ 两端口径**唯一**：解层住在判据侧（那里也校验形状），调用方只负责把文件读进来。
         */
        let raw;
        try {
            raw = JSON.parse(text);
        }
        catch (error) {
            throw new Error(`known baseline failures: ${candidate} is not valid JSON: ${String(error)}`);
        }
        /** ★ 判据拒收（形状坏了）⇒ 让它抛出去，**不吞** —— 那正是 `backtest.ts:192` 的意图。 */
        return parseKnownBaselineFailures(raw);
    }
    /** ★ 候选**不存在** ⇒ 这才是"清单缺席"（不是"没有已知失败"）⇒ 判据落回第三态。 */
    return undefined;
}
/**
 * 构造 completion 位置的 ctx、核对它、求值。
 *
 * ★ **逐字搬运**：下面这 271 行与拆前完全相同（唯一差别是"这些东西从哪来"）。
 */
export async function wireCompletion(raw) {
    /**
     * ★★ 入口处**拆成与原来同名的局部量** —— 于是下面一整段一个字都不用改。
     *   而这就是"让搬运的单元保持逐字，把差异挤到边界上"那条做法的落点：
     *   ★ **差异住在入口这 15 行里，而不是散在 271 行中间。**
     */
    const acceptanceResults = raw.acceptanceResults;
    const changedFiles = raw.changedFiles;
    const commandsRun = raw.commandsRun;
    const discriminatingFiles = raw.discriminatingFiles;
    const findings = raw.findings;
    const gate = raw.gate;
    const input = raw.input;
    const killerSuiteFiles = raw.killerSuiteFiles;
    const newTestFiles = raw.newTestFiles;
    const observedTestFiles = raw.observedTestFiles;
    const repairEvidence = raw.repairEvidence;
    const task = raw.task;
    const worktreeBase = raw.worktreeBase;
    const workspace = raw.workspace;
    const registry = raw.registry;
    const args = raw.args;
    const changedLines = raw.changedLines;
    const loadKindRequirementsSync = raw.loadKindRequirementsSync;
    /**
     * ── ★★★ 2026-10-12：预算与变异恢复，都只落在【入口这一小段】里 ────────────────
     *
     * ★ 位置是刻意的：上面那 15 行把差异挤在边界上（逐字搬运的纪律），
     *   这两件事同样只在**边界**上加 —— 段内那 271 行一个字不改。
     */
    const budget = createCompletionBudget();
    /**
     * ★ 恢复上一次崩溃留下的变异残留，**在求值之前**。
     *
     * ★ 为什么必须在这里、而不只是放在插件启动时：completion 是**唯一**会继续做
     *   就地变异的路径。若上一次崩溃把 `src/x.ts` 留在变异态，而这一次的 mutation
     *   又把它当"原文"读进来 —— 那就把一次**污染**当成了基线，于是后面每一次
     *   测量都是在污染之上做的。
     * ★ 正常路径上它是**空转**（没有日志目录 ⇒ 立刻返回），代价为零。
     */
    const recoveryBefore = recoverMutationJournal(workspace);
    /** 把一次执行器调用包进预算：超预算抛**自述**错误，不伪装成命令失败。 */
    const inBudget = (label, run) => runWithinBudget(budget, label, run);
    /**
     * ★ 就地写 workspace 文件的**唯一**入口：**先记账、再写**。
     *
     * 判据侧的 `writeFile` 注入点被包在这里 —— 于是"变异没还原"这件事从
     * 「只能事后发现」（`mutation-guard.ts` 有守卫，但全仓没有一个调用方）
     * 变成「下一次一定被修」。
     */
    const writeWorkspaceFileJournaled = (path, contents) => {
        recordMutationWrite(workspace, path, contents);
        writeWorkspaceFileSync(workspace, path, contents);
    };
    /**
     * 基准 = 【在父版本上跑一遍任务的 verify 命令】的退出码。
     *
     * 不注入（返回 undefined）的两种情形，都保持"没测到"：
     *   · 任务没有声明 verify ⇒ 没有可跑的东西（回测的 L1 前置要求基准先绿）；
     *   · 跑不起来（工作区不是 git 仓库、版本取不到…）⇒ 不能拿 0 充数。
     */
    const baselineExit = async (revision) => {
        const commands = task.verify ?? [];
        if (commands.length === 0)
            return undefined;
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
        const added = new Set(newTestFiles ?? []);
        const withoutNewTests = commands
            .map((command) => command.split(/\s+/).filter((token) => !added.has(token)).join(' '))
            .map((command) => command.trim())
            .filter((command) => command !== '');
        if (withoutNewTests.length === 0)
            return undefined;
        /**
         * ★ 2026-10-12：基准这一段也走预算。
         *   ★ 它超预算时**吞掉异常并交回 `undefined`**，而不是往上抛 —— 抛出去会让
         *     `wireCompletion` 在求值之前就炸掉，那与"基准没测到"（判据会说 unmeasured）
         *     是两件完全不同的事。**绝不**把跑不起来当成 0。
         */
        const results = await Promise.all(withoutNewTests.map(async (command) => {
            try {
                return await inBudget(`baseline: ${command}`, async () => await runInDetachedRevision({ workspace, revision, command }));
            }
            catch {
                return undefined;
            }
        }));
        if (results.some((code) => code === undefined))
            return undefined;
        // 基准取【最坏的一条】：任何一条在父版本上不绿 ⇒ 基准就不是绿的，
        // 而"基准不绿"时回测的正确结论是"无法归因"（判据自己会说）。
        return Math.max(...results);
    };
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
    const baseResolution = resolveBaseRevision(task);
    const baseline = baseResolution.kind === 'absent'
        ? undefined
        : { label: baseResolution.revision, exitCode: await baselineExit(baseResolution.revision) };
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
        : {};
    /**
     * ★ 回测的依赖图 / 覆盖数据。与跑测试一样是 I/O，所以在这一层做；
     *   拿不到就【不注入】⇒ 判据说"没有依赖图数据"（不是"选了 0 条"）。
     */
    const coverageInput = await deriveCoverageInput({
        workspace,
        testFiles: observedTestFiles ?? [],
        knownTests: observedTestFiles ?? [],
    });
    const wantsCompleted = args.status === 'completed';
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
            verdict: args.verdict,
            findings,
            changedPaths: input.changedPaths,
            acceptanceResults,
            commandsRun,
            ...discriminatingFiles === undefined ? {} : { newTestFiles: discriminatingFiles },
        },
        wantsCompleted,
        taskNotTerminal: !TERMINAL_TASK_STATUSES.includes(task.status),
        /**
         * ★ 2026-10-12：`verify-rerun` 与 `contract.verify-command` 共用这一格
         *   （同一个执行器，见 `gates/contract/verify-command.ts` 的注释）
         *   ⇒ 收窄它一处，两条判据一起有界。
         */
        execVerifyCommand: (command) => inBudget(`verify: ${command}`, (timeoutMs) => runVerifyCommand(workspace, command, { timeoutMs })),
        /**
         * ── ★★★ t53：规则表**每次调用时读**（"改数据 ⇒ 立刻生效"的成立条件）──
         *
         * ★ 不缓存：缓存会让"改数据"在下一次**进程重启**前不生效 ——
         *   而那正是本任务要消灭的东西（改它读的东西不该需要换进程）。
         * ★ 也不在构建时内联（静态 import 会被 tsc 嵌进 lib/ ⇒ 改数据仍要 build）。
         */
        loadRules: () => loadVerifyCommandRules(workspace),
        /**
         * ── ★★★ t54：kind 需求表 —— 与上面那一格**并列同形**─────────────────────
         *
         * ★ 同一条路：数据在 `src/gates/completion/kind-requirements.json`，
         *   一格注入，调用方**每次求值时读盘**。
         *
         * ★ 而它与上面那格有一处**刻意的差别：这里是同步的**。
         *   理由：kind 守卫住在 `appliesTo` 里，而 registry 的契约要求
         *   `appliesTo(context) => boolean` **同步**返回。
         *   ⇒ `verify-command` 的 `appliesTo` 不读表（它只在 `gate()` 里读），
         *     所以它那格可以异步；本判据没有那个余地。
         *
         * ★ 读的是 `readFileSync`（表只有几百字节），**每次读、不缓存** ——
         *   "不缓存"这一条与上面那格逐字一致：缓存会让"改表"在下一次进程重启前不生效。
         */
        loadKindRequirements: () => loadKindRequirementsSync(),
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
        runTestOnRevision: async (test, revision) => {
            /**
             * ★ `'working-tree'` 是 R5 约定的【修复版本】哨兵值 —— 表示"成员现在
             *   交出来的那份树"，而它**不是**一个 git 引用（`git worktree add`
             *   对它必然失败）。这是判据与调用方之间的一个约定，不是笔误。
             *   ⇒ 它跑在【工作区本身】上；只有父版本才需要检出到一个干净副本。
             */
            if (revision === 'working-tree') {
                return {
                    exitCode: await inBudget(`r5 working-tree: ${test}`, (timeoutMs) => runVerifyCommand(workspace, `node --test ${test}`, { timeoutMs })),
                };
            }
            /**
             * ★ `timeoutMs` 一路传进 `runInDetachedRevision`：它内部有**三条**命令
             *   （worktree add / 跑测试 / worktree remove），若只包外层，单次调用最多能跑
             *   3 × 120 s —— 预算会被**越过** 240 s 才生效，而"有界"这件事就只对了一半。
             */
            const exitCode = await inBudget(`r5 ${revision}: ${test}`, (timeoutMs) => runInDetachedRevision({
                workspace, revision, command: `node --test ${test}`, timeoutMs,
            }));
            return exitCode === undefined ? {} : { exitCode };
        },
        // ── mutation：三个执行器 + 只变异改动行
        readFile: (path) => readWorkspaceFileSync(workspace, path),
        /**
         * ── ★★★ 2026-10-12：就地写 workspace 文件的**唯一**入口，改成「先记账、再写」───
         *
         * ★ 这是那条事故（`src/worktree.ts:366` 的 `=` 让 `pnpm build` 从此必失败）的
         *   结构性修法：**让"写"这件事自带退路**，而不是靠 `finally` 一定跑得到。
         * ★ 注入面没变（还是一个 `(path, contents) => void`），所以判据侧一字未改 ——
         *   `mutation` 判据仍然是纯的，它只是**不知道**自己写的那个文件可被恢复。
         */
        writeFile: (path, contents) => writeWorkspaceFileJournaled(path, contents),
        /**
         * ★ 变异判据的 runTest 必须交回【输出】，不只是退出码：
         *   杀伤率 = 被杀的变异体 / 全部变异体，而"某次运行里有几条测试失败"只能从
         *   输出里读出来（判据用 parseTestSummary 解析 `ℹ pass N` / `# pass N`）。
         *   只给退出码 ⇒ 判据会说"套件没报告可读的摘要"⇒ unmeasured。
         */
        runTest: async (command) => await inBudget(`mutation suite: ${command}`, (timeoutMs) => runVerifyCommandCaptured(workspace, command, { timeoutMs })),
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
         *
         * ── ★★★ t67：t54 之后这条供给链【接错了插座】─────────────────────────
         *
         * MEASURED（t67 复现，与 t54 的核实一致）：
         *
         *   `discriminatingFiles → newTestFiles` 这条链的**唯一消费者是 r5**；
         *   而 kind 需求表（`kind-requirements.json`）说 **repair 不要求 r5**
         *   ⇒ 那条证据在 repair 上**没人读**。
         *
         * ★ 而 mutation 读的是 `killerSuites` —— 它此前的**唯一**来源是
         *   `observedTestFiles`（**会话事件**）。于是 f-0020 那个形状里：
         *
         *     会话观察缺席（= f-0020 的成因）
         *       ⇒ observedTestFiles === undefined ⇒ killerSuites 不注入
         *       ⇒ mutation 拿不到任何杀手套件 ⇒ unmeasured
         *     而**同一时刻**，repairEvidence 从**任务契约**读出了那份夹具
         *       ⇒ discriminatingFiles 非空 ⇒ 喂给 newTestFiles ⇒ **没人读**
         *
         *   ⇒ ★ 证据落在没人读的那一格，而**该读它的那一格**空着。
         *     这不是"松了一根线"，是**线接错了插座**。
         *
         * ── 而需求表自己写着该接哪一格 ────────────────────────────────────────
         *
         * `kind-requirements.json` 的 repair 一节逐字写着：
         *
         *     "Mutation stays because it is what proves the discriminating
         *      fixture really discriminates"
         *
         *   ⇒ ★ 设计意图早就说了：**证明那份夹具真的能判别**是 mutation 的活。
         *     而它当时拿不到那份证据 ⇒ 表说的是 A，接线接的是 B。
         *
         * ── 修法：把两条来源**并起来**喂给 killerSuites ────────────────────────
         *
         *   `observedTestFiles`（会话观察到的测试写入）
         *   ∪ `repairEvidence.evidence`（契约里改动过的既有夹具）
         *
         * ★ 为什么是【并】而不是【换成后者】：
         *   · 只用后者 ⇒ implementation 类的既有行为变了（它有真新增的测试，
         *     而 `repairEvidenceFiles` 也收 changedPaths 里的测试 —— 两者本可互补）；
         *   · 只用前者 ⇒ 就是今天这个缺陷（f-0020 形状下它恒空）。
         *   ⇒ 并集让"会话看得到"与"契约里写着"**各自**都能单独成立。
         *
         * ★★ 而"没有套件"这一支**必须仍然存在**：两边都空 ⇒ 不注入 ⇒
         *   mutation 照旧 unmeasured（**不猜、不回退到全套**）。
         *   那一条纪律一个字没动 —— 本修法只是**多给了它一个真实的来源**。
         */
        ...killerSuiteFiles === undefined
            ? {}
            : { killerSuites: killerSuiteFiles.map((file) => ({ id: file, files: [file] })) },
        testCommand: 'node --test *',
        // ── backtest：基准 + 覆盖证据 + 两个执行器
        ...baseline === undefined ? {} : { baseline },
        /**
         * ── ★★★ t92：这两格是 t70 的拆分丢掉的（t76 与 t83 的修复）─────────────────────
         *
         * ★ 判据侧完整（`backtest.gate()` 会读它们），而**往这两格塞东西的是调用方** ——
         *   而那正是被搬没了的地方。⇒ 「判据在，而调用方不再喂它」。
         *
         * ★ 而两者的形状与既有先例逐条同形：
         *   · `knownBaselineFailures` ⇒ **只在有值时挂**（`undefined` 与 `[]` 不同形：
         *      前者是"清单缺席"，后者是"清单说没有已知失败"）
         *   · `baselineAbsent`        ⇒ **只在缺席时挂** —— 有父版本时它没有信息量，
         *      而"总是出现"会让三态里最该被看见的那两种淹没在噪音里
         */
        ...(() => {
            const known = loadKnownBaselineFailures();
            return known === undefined ? {} : { knownBaselineFailures: known };
        })(),
        ...baseResolution.kind === 'absent' ? { baselineAbsent: baseResolution.reason } : {},
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
        execBacktestCommand: async () => {
            const commands = task.verify ?? [];
            if (commands.length === 0)
                return 127;
            const codes = await Promise.all(commands.map((command) => inBudget(`backtest(full): ${command}`, (timeoutMs) => runVerifyCommand(workspace, command, { timeoutMs }))));
            return Math.max(...codes);
        },
        execSelectedCommand: async () => {
            const commands = task.verify ?? [];
            if (commands.length === 0)
                return 127;
            const codes = await Promise.all(commands.map((command) => inBudget(`backtest(selected): ${command}`, (timeoutMs) => runVerifyCommand(workspace, command, { timeoutMs }))));
            return Math.max(...codes);
        },
    };
    const completionInputSurface = inputSurfaceOf('completion', completionContext);
    const completionGates = await registry.evaluate('completion', completionContext);
    /**
     * ── ★★★ 收尾：再扫一次变异日志（与入口那次成对，**不合并**）────────────────────
     *
     *   · 正常收尾 ⇒ 每个条目的 `current === original` ⇒ **只删条目**（这也就是"清空"，
     *     所以不需要另设一个 clear 函数 —— 两个入口必然分叉）。
     *   · 判据自己报了"还原失败"（`mutation.ts` 的 `restoreProblem`）⇒ 这里把它**真修回来**。
     *   · 有人在那之后动过那个文件 ⇒ `conflicts`，**不动**，报出来给人看。
     *
     * ★ 为什么入口与收尾**都要**：入口那次修的是**上一次**崩溃的残留，这一次收的是
     *   **本次**的尾巴。只留入口 ⇒ 本次崩了就永远没人收；只留收尾 ⇒ 上一次的残留会被
     *   本次的 mutation 当成"原文"读进来，于是每一次测量都建立在污染之上。
     */
    const recoveryAfter = recoverMutationJournal(workspace);
    const recovery = {
        restored: [...recoveryBefore.restored, ...recoveryAfter.restored],
        conflicts: [...recoveryBefore.conflicts, ...recoveryAfter.conflicts],
        failed: [...recoveryBefore.failed, ...recoveryAfter.failed],
    };
    return {
        context: completionContext,
        inputSurface: completionInputSurface,
        gates: completionGates,
        wantsCompleted,
        budget: {
            totalMs: budget.totalMs,
            elapsedMs: budget.elapsedMs(),
            calls: budget.calls(),
            exhausted: budget.exhaustedBy().length > 0,
            exhaustedBy: budget.exhaustedBy(),
        },
        /**
         * ★ 没事发生 ⇒ **不挂**这一格（缺省与"三个空数组"不同形：前者是"没有日志、
         *   没有残留"，后者不可能出现，所以它一旦出现就是在说别的事）。
         */
        ...recovery.restored.length === 0 && recovery.conflicts.length === 0 && recovery.failed.length === 0
            ? {}
            : { mutationRecovery: recovery },
    };
}
