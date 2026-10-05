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
export declare const id = "completion.r5";
export declare const point = "completion";
export declare const description = "\u628A\u65B0\u6D4B\u8BD5\u5728\u3010\u7236\u7248\u672C\u3011\uFF08worktree \u7684 base\uFF09\u4E0A\u8DD1\u4E00\u904D\uFF1A\u5B83\u5FC5\u987B\u5148\u7EA2\uFF1B\u518D\u5230\u4FEE\u590D\u7248\u672C\u4E0A\u5FC5\u987B\u7EFF\u3002\u7236\u7248\u672C\u62FF\u4E0D\u5230 \u21D2 unmeasured\uFF0C\u4E0D\u662F ok";
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
export declare function appliesTo(ctx: R5Context | undefined): boolean;
/** 调用方对"哪些文件是新测试"的声明（会话事件折叠后的结果）。 */
export interface R5Context {
    task?: {
        id?: string;
        kind?: string;
        /** 写域（workspace 相对）。用于把新测试文件折成路径/基名两种形态。 */
        inScope?: string[];
        /** ★ 任务的写域基准：判据只用它判断"这条测试在不在本任务的改动范围里"，不碰文件系统。 */
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
     */
    parentRevision?: string;
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
