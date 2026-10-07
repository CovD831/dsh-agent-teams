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
import { type GateVerdict } from '../registry.ts';
import type { CtxPaths } from '../requires.ts';
/**
 * ── ★★ t54：kind 需求表已抽到**非判据**的纯模块 `./kind-requirements.ts` ──────────
 *
 * ★ 为什么（这是我自己撞到的约束）：本判据最初把校验器与类型**放在自己这里**，
 *   然后让 `mutation.ts` / `backtest.ts` import 它 ——
 *   而 `verify-gates-integration` ④ 有一条**显式 allowlist**，理由写得很清楚：
 *
 *     「真正要拦的是 `completion/r5.ts imports "./mutation.ts"`
 *       这种**一条判据调另一条**。」
 *
 *   ⇒ ★ 而我做的正是那个形状。它会让**三条门互相耦合**：改 r5 的类型牵动另外两条。
 *   ⇒ ★ 所以修法不是放宽 allowlist（那是**拆掉一条真实约束**），
 *     而是让共享的东西住在**它不是判据**的地方 ——
 *     与 `../requires.ts` 完全同一个先例（「它不 import 任何东西、
 *     也不带一条判据的语义」，所以 allowlist 明确放行它）。
 */
export declare const id = "completion.r5";
export declare const point = "completion";
export declare const description = "\u628A\u65B0\u6D4B\u8BD5\u5728\u3010\u7236\u7248\u672C\u3011\uFF08worktree \u7684 base\uFF09\u4E0A\u8DD1\u4E00\u904D\uFF1A\u5B83\u5FC5\u987B\u5148\u7EA2\uFF1B\u518D\u5230\u4FEE\u590D\u7248\u672C\u4E0A\u5FC5\u987B\u7EFF\u3002\u7236\u7248\u672C\u62FF\u4E0D\u5230 \u21D2 unmeasured\uFF0C\u4E0D\u662F ok";
/**
 * ★ 而本文件**自己也要用**它们（`appliesTo` 的问表 + `gate()` 的表不可用分支）
 *   ⇒ 除了 re-export，还要 import 进本模块的作用域。
 */
import { gateRequirementFor, loadKindRequirementsOfHost, parseKindRequirements, type KindRequirement, type KindRequirements, type KindRequirementsLoad } from './kind-requirements.ts';
/**
 * ★ 还要 re-export：`tools` 层从**这里**拿 `parseKindRequirements`（它历史上就从这个模块拿），
 *   而本判据是那个模块最自然的门面。
 *   ★ 一条 import + 一条 re-export —— 而不是两条 `import … from` 同一处
 *     （那会让按行扫描的臂读到两份）。
 */
export { gateRequirementFor, loadKindRequirementsOfHost, parseKindRequirements };
export type { KindRequirement, KindRequirements, KindRequirementsLoad };
export declare function appliesTo(ctx: R5Context | undefined): boolean;
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
export declare const requires: CtxPaths<R5Context>[];
/** 调用方对"哪些文件是新测试"的声明（会话事件折叠后的结果）。 */
export interface R5Context {
    /**
     * ── ★★★ kind 需求表的**运行时**来源（t54）─────────────────────────────────────
     *
     * ★ 由调用方注入，且调用方**每次求值时读盘** —— 那正是"改表不必重载"成立的条件。
     *
     * ── ★★ 而它必须是**同步**的，这与 t53 的 `loadRules` 有一处关键差别 ──────────────
     *
     *   `registry` 的契约里 `appliesTo(context) => boolean` 是**同步**的
     *   （它决定"这条判据说不说话"，必须在求值前判定）。
     *   ★ 而 kind 守卫**恰恰住在 `appliesTo` 里** —— 所以这张表必须能在同步路径上拿到。
     *
     *   t53 的 `loadRules` 可以异步，因为 `verify-command` 的 `appliesTo` **不读它**
     *   （它只在 `gate()` 里读）。本判据没有那个余地。
     *
     *   ⇒ 调用方用 `readFileSync` 读这份**极小**的表（几百字节），每次求值读一次、不缓存。
     *     ★ 而"不缓存"这一条与 t53 逐字一致：缓存会让"改表"在下一次进程重启前不生效。
     */
    loadKindRequirements?: () => KindRequirementsLoad;
    task?: {
        id?: string;
        kind?: string;
        /** 写域（workspace 相对）。用于把新测试文件折成路径/基名两种形态。 */
        inScope?: string[];
        /**
         * ── ★ 这是【工作区路径】，不是父版本 hash ──────────────────────────────────
         *
         * MEASURED（t12，修一条会误导下一人的注释）：这一格的注释原本写着
         * "任务的写域基准"，读起来像是父版本 —— 而它**不是**。
         *
         * 接线实测（`src/tools.ts` 的 r5 注入点，搜 `parentRevision: worktreeBase`）：
         *
         *     parentRevision: worktreeBase   ← hash（父版本）
         *     worktreePath:   workspace      ← 一个**目录路径**
         *
         * 而 `createTaskWorktree(...)` 的产物是 `{ path, base, missingIgnored }`：
         *   · `base` 才是版本 hash ⇒ 派给 `parentRevision`；
         *   · `path` 是被派发到的那个隔离工作目录 ⇒ 与本格同源。
         *
         * ★ 引用用【可搜的代码片段】而不是行号：行号会随别人接线而漂移（这一条
         *   本身就实测印证过 —— 写这条注释的十分钟里，注入点从 3641 漂到 3833），
         *   而一条指错地方的注释比没有注释更坏：它把人送到错误的行上。
         *   ⇒ 只记片段 `parentRevision: worktreeBase`，不记行号。
         *
         * ⇒ 字段名 `worktreePath` 里的 "Path" 说的正是"路径"，不是"基准"。
         *
         * ── ★ 它现在【没有被任何代码读】────────────────────────────────────────────────
         *
         * 保留它是因为下一位接线的人会需要它（"这条测试在不在本任务的改动范围里"
         * 要在工作区目录下判断），而那正是最容易被名字带偏的一步：把目录当成 hash
         * 传给 `runTestOnRevision` 的第二个参数，会得到一条**永远失败**的 checkout
         * —— 而它的症状会是一条 unmeasured，与"没测到"同形（本队反复交过学费的形态）。
         *
         * ★ 所以这里的措辞是刻意的：【路径 vs hash】必须一眼分得开。
         *   要与它配对的父版本在下面那一格（`parentRevision`）。
         */
        worktreePath?: string;
    };
    update?: {
        newTestFiles?: string[];
    };
    /**
     * ★ 父版本 hash，来自 `createTaskWorktree(...).base`。
     *
     * `undefined`（没有 worktree）与一个空串必须都算"拿不到"—— 绝不产出
     * 一个伪造的父版本，也绝不因为"没隔离"就说"检查通过"。
     *
     * ★★ t71：它【不是唯一来源】了 —— 见下面的 `workspaceHead`。
     *   本格缺席不再直接落 unmeasured，而是走「换一个来源再试一次」那条路。
     */
    parentRevision?: string;
    /**
     * ── ★★ t71：无 worktree 时的父版本来源 —— **工作区自己的 HEAD** ────────────────
     *
     * ── 为什么需要它（MEASURED：t68 没有 worktree ⇒ r5 恒 unmeasured）──────────────
     *
     *   `resolveBaseRevision` 落 `{ kind: 'absent', reason: 'no-worktree' }`
     *   ⇒ 调用方不注入 `parentRevision` ⇒ r5 报「no parent revision is available」
     *   ⇒ ★ 而 kind-requirements 表里 `implementation` 要 r5
     *     ⇒ **一个没有 worktree 的 implementation 任务在 r5 上恒不可满足**。
     *     这是 f-0020 的第三个成因（前两个：宿主持有旧模块 / 基线本身不绿）。
     *
     * ── ★★ 而 r5 要的从来不是"一个 worktree"，是【一个"之前"的版本】───────────────
     *
     *   它要问的是：把这条测试拿到**这次改动之前**的那棵树上跑，它红不红。
     *
     *   ★ 一个【无 worktree】的任务，改动落在**共享工作区**里 ⇒
     *     "这次改动之前"**就是那个工作区的 HEAD**（未提交的改动才是"之后"）。
     *   ⇒ **那个父版本是存在的**，与有 worktree 的任务一样存在。
     *     `absent / no-worktree` 说的是"没有独立目录"，**不是**"没有父版本"。
     *
     *   ★ 而旧代码把这两件事读成了同一件 —— 本队记账：
     *     **读的量（有没有 worktree）超过了它声称的性质（有没有父版本）。**
     *
     * ── ★★ 代价必须写在读数里（这是一个有代价的决定，不是一个等价的替换）─────────
     *
     *   用 HEAD 当父版本**不是紧的**：共享工作区意味着**别的任务可能已经提交过**等价的东西，
     *   于是 HEAD 可能**已经包含**本次改动 ⇒ 成员的新测试在 HEAD 上就是绿的
     *   ⇒ r5 判它「装饰性测试」⇒ **一次假拒绝**。
     *
     *   ★ 而它仍比"恒 unmeasured"好，因为失败方向不同：
     *       恒 unmeasured ⇒ **每一个**无 worktree 的 implementation 都收不了口
     *       HEAD 当父版本 ⇒ **只有**"别人已提交等价改动"那一种会假拒绝，
     *                       而它是一个**可复核的具体主张**（有 hash、有补丁可比）
     *   ⇒ 所以读数里多一格 `base: 'workspace-head'`，让读者看得出这是次优的那个来源。
     *
     * ★ 由调用方注入（判据不 import I/O）。`undefined` ⇒ 连它都没有 ⇒ unmeasured。
     */
    workspaceHead?: string;
    /** 测试文件的扫描范围（workspace 相对目录）。缺席 ⇒ 无法把文件折成测试路径 ⇒ unmeasured。 */
    scanDirs?: string[];
    /**
     * 只在【某个版本】上跑一条测试。调用方注入（判据不 import I/O）：
     * git checkout <revision> 之后跑该测试，交回真实退出码。
     * 抛错 ⇒ unmeasured（没能测量），不是"测试失败"（那是关于工作的结论，两者不同形）。
     */
    runTestOnRevision?: (test: string, revision: string) => Promise<{
        exitCode?: number;
        output?: string;
    }>;
    /** ★ 调用方表达的意图：本次是否试图置为 completed（否则不产生完成裁决）。 */
    wantsCompleted?: boolean;
    /** ★ 任务当前是否非终态（终态补证据不是新的完成裁决，与 verify-rerun 同一口径）。 */
    taskNotTerminal?: boolean;
}
export declare function gate(ctx: R5Context): Promise<GateVerdict>;
