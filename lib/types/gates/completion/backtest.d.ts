/**
 * ── 判据：回测 —— 证明这次改动【没把别的地方改坏】──────────────────────────────
 *
 * 插入点：`completion`（成员汇报完成时）
 * id     ：`completion.backtest`
 *
 * ── 它回答的不是"测试过没过"，而是"改动有没有被抓住" ───────────────────────────
 *
 * MEASURED（本轮立项依据，Meta PTS）：把测试选择放进变更级回测，成本减半，
 * 仍抓住 >99.9% 有缺陷的改动。⇒ 衡量单位是【改动被抓住了吗】，
 * 不是"每个测试有没有通过" —— 后者会把人骗去修一堆与本次改动无关的红灯。
 *
 * ── 三态：这条判据存在的全部理由是「不能归因」必须说得出口 ──────────────────────
 *
 *   ok         ：基准绿 + 选测跑完且绿（+ 全量跑完且绿，若给了全量执行器）
 *   blocked    ：测出来了 —— 基准红（无法归因）/ 选测把改动抓住了 / 全量回归
 *   unmeasured ：没测成 —— 拿不到基准状态 / 缺选测或全量的执行器
 *
 * ★ `unmeasured` 绝不允许并进 `ok`：拿不到基准状态时返回 ok，就等于
 *   "装上了但从不生效"，而它比没装更坏 —— 它会让人以为回测跑过了。
 *
 * ── ★ L1 前置：基准不绿 ⇒ 拒绝，且理由必须是【无法归因】────────────────────────
 *
 * 这一条是整条判据的支点。基准版本（父版本 / HEAD）不绿时：
 *
 *     红灯 = 本来就坏（与我无关）  ┐
 *     红灯 = 我改坏的              ┘ 这两件事【在观察上同形】
 *
 * 同形 ⇒ 抓不到改动【不等于】改动是干净的；也【不等于】改动有问题。
 * 此时若放行（ok），一次真实回归可以躲在"本来就坏"后面上线；
 * 此时若按"你改坏了"拒绝，成员会被任意归罪，而且它无法自证（它并没有改坏）。
 * ⇒ 唯一的诚实裁决是拒绝，并把理由写成 **attribution is impossible**，
 *   附上基准自己的失败，而不是把它算在这次改动头上（blocker 里明写
 *   "not the change's fault"）。
 *
 * ── ★ L2 选测：来源必须写在数据里，盲区必须报出来 ──────────────────────────────
 *
 * 选测 = 改动文件 → 依赖图的【传递】依赖者 → 覆盖它们的测试。
 *
 * 判据不读文件、不 import I/O：依赖图与"测试覆盖了谁"都由调用方注入
 * （`coverage`），判据只做纯数据变换。这是契约 §2 的硬要求，也让
 * "选测器藏起自己的近似性"这件事变得不可能：判据【不采信】选测器自报的
 * selection，它只采信 coverage，然后自己去问「覆盖这个改动文件的测试
 * 有没有全部被选中」。没被选中的那些就是【盲区】。
 *
 * 三种来源必须【不同形】，因为它们给结论的信度不同：
 *     'dependency-graph'  依赖图（本判据接受的那种）
 *     'runner-declared'   跑测试的框架自报的关联（近似黑箱）
 *     'unknown'           来源不明的选择
 * ⇒ 后两种 ⇒ `unmeasured`：一个隐藏自身近似性的选择器，正是回归上线的路径。
 *   拿一个看不见的选择器去下"没把别处改坏"的结论，是把没测到并进通过。
 *
 * ── 谁能成为"没被选中的测试"（★ 只有 coverage 说得准）─────────────────────────
 *
 * 「依赖者是测试」这件事有两种说法，只有一种算数：
 *   · `coverage` 里【明确列出】该文件的测试      ⇒ 算（这是被测量到的）
 *   · 测试文件的【路径长得像测试】              ⇒ 不算（这是猜的）
 * 后者会把一个明明覆盖了改动文件、只是名字不像测试的测试（`spec/…`、
 * `integration/…`、`*.mjs` 夹具）悄悄漏掉。漏掉一个盲区，就是把一个已知盲区
 * 变成一个未知盲区 —— 所以本判据【不猜】：名字不像测试不是漏选，是"它压根
 * 不在覆盖集里"，而覆盖集里没有它这件事本身会被 `testsWithNoCoverageData`
 * 报出来（见下）。
 *
 * ── 全量：范围必须来自数据，不能靠"执行器记得跑全量" ───────────────────────────
 *
 * 选测是近似（它按定义会漏掉测试，这正是上面要报盲区的原因），
 * 所以回测以【全量】收口。但"执行器就是跑了全量"是一个无法核验的声明 ——
 * ⇒ 全量的执行结果必须带上 `scope`，且必须覆盖所有已知测试；否则 `unmeasured`。
 * 于是"只跑了 3 个测试却说全量绿"与"真的全量绿"不同形。
 */
import { type GateVerdict } from '../registry.ts';
/**
 * ★ t54：从**非判据**的纯模块拿（不是从 `./r5.ts`）——
 *   判据之间不许互相 import（`verify-gates-integration` ④ 的显式 allowlist），
 *   而那条约束防的正是"一条判据调另一条"。
 *   ★ 本文件与 r5 是**兄弟**，不是它的用户。
 */
import { type KindRequirementsLoad } from './kind-requirements.ts';
import type { CtxPaths } from '../requires.ts';
export declare const id = "completion.backtest";
export declare const point = "completion";
export declare const description = "\u6309\u4F9D\u8D56\u56FE\u9009\u6D4B\u5E76\u8DD1\u5168\u91CF\uFF0C\u8BC1\u660E\u6539\u52A8\u6CA1\u628A\u522B\u5904\u6539\u574F\uFF1B\u57FA\u51C6\u4E0D\u7EFF\u6216\u9009\u6D4B\u6765\u6E90\u4E0D\u660E\u5373\u62D2\u7EDD/\u672A\u6D4B\u91CF\uFF08\u4E0D\u80FD\u5F52\u56E0\u65F6\u7EDD\u4E0D\u653E\u884C\uFF09";
/**
 * ── 输入面声明（t4）───────────────────────────────────────────────────────────
 *
 * ★ 本条在上一轮【真的缺过输入】，缺的是 `baseline` / `coverage` / 两个执行器，
 *   而四种缺口的症状全是 `unmeasured` —— 与 `ok` 在日志里同形：
 *
 *   · `baseline` 缺席 ⇒ "the baseline state is unavailable"
 *   · `coverage` 缺席 ⇒ "no dependency graph / coverage data was provided"
 *   · `execBacktestCommand` 缺席 ⇒ "no full-suite executor was injected"
 *   · `execSelectedCommand` 缺席 ⇒ 只在真跑选测时才显形（见下面 §两个执行器不同形）
 *   ⇒ 一条**从未回测过任何东西**的判据，读起来是"回测通过了"。
 *
 * ★ `baseline` 不是"一个字段"，而是【父/HEAD 上的测试结果】——它的缺席不是
 *   "少了个参数"，是"这次改动没有基准可比"。判据的措辞说的正是这件事
 *   （"a regression could not be told apart from a pre-existing failure"）。
 *   所以它是**第一格必须声明的东西**：没有它，这条判据的核心结论（归因）
 *   根本无从谈起。同理 `coverage` 是【依赖图数据】，不是"可选的分析输入"。
 *
 * ── ★ 两个执行器必须分开声明（它们不同形）─────────────────────────────────────
 *
 * `execSelectedCommand` 与 `execBacktestCommand` **不是同一个开关的两半**：
 *
 *   · `execBacktestCommand` ⇒ 全量的执行器。它缺席是**无条件的失败**
 *     （"no full-suite executor was injected" ⇒ unmeasured，且这次裁决里
 *     没有任何一条测试被跑过）。
 *   · `execSelectedCommand` ⇒ 只在 `coverage.command !== undefined` 时才被用到。
 *     它是**有条件的**：判据刻意允许"不跑选测"（"没给 ⇒ 不假装跑过"），
 *     那时它缺席是**正常**的。
 *
 *   ⇒ 合成一格会让核对层在"本来就不该跑选测"的那些 ctx 上报一条假的缺口 ——
 *     而本队已经定过：**不适用不报**，噪音与误报同样有害。
 *
 * ★ MEASURED（本任务的臂 A 抓到的）：`execSelectedCommand` **不进声明**。
 *   第一版把它写进了数组，臂 A 立刻红：一份完全正常的 ctx（不跑选测 ⇒ 没有
 *   `coverage.command`）被核对报成 `incomplete`，而判据自己在同一份 ctx 上
 *   诚实地返回 `ok`。**核对层报了一个判据根本不认的缺口** —— 那不是"更严"，
 *   那是噪音，而噪音会教人把核对整体忽略（与漏报同样有害）。
 *
 *   ⇒ 判据自己就是这条口径的唯一权威：`execSelectedCommand` 缺席**不必然**
 *     使判据说不出话（`coverage.command === undefined` 时它压根不被调用），
 *     所以它不是"缺席 ⇒ 判据沉默"的那一类，**不属于输入面**。
 *     同理 `coverage.command` 也不声明：它是"要不要跑选测"的开关，缺席是正常的。
 *
 *   ★ 这正是"声明的是**哪几格缺席 ⇒ 判据说不出话**"那条分界线的第二次应用：
 *     第一次是 `operators` 那些有默认值的调参位（见 mutation），
 *     这一次是**有条件**的注入面。两次都是同一个问题：
 *     "这一格在不在声明里"由"它缺席时判据还能不能说话"回答，不由"它看起来重不重要"回答。
 *
 * ★ `changedPaths` 与 `update.changedPaths` 都声明：`appliesTo` 读的是这两格的
 *   **或**（`Array.isArray(fromUpdate) ? fromUpdate : fromCtx`），而 `gate()`
 *   读的也是这两格的或。两处口径必须一致 —— 只声明其中一格，会让"闸门说适用、
 *   声明说缺"这种自相矛盾的核对结论出现。
 */
export declare const requires: CtxPaths<BacktestContext>[];
/**
 * ── ★★★ t76：已知失败清单（"fix or pin the baseline first" 里的 **pin** 那一半）──────
 *
 * ── 它修的是什么（MEASURED：t66/t67/t69/t71/t74 五次独立撞到）────────────────────
 *
 *   L1 前置要一份【全绿的基线】，而本仓基线【几乎从不全绿】（本 worktree 实测 10 条）
 *   ⇒ ★ 它要求的那件事不可满足 ⇒ 而它卡住了今晚每一个 worktree 任务的终态。
 *
 *   ★ 而它自己的拒绝信息早就写对了方向：
 *     「fix or pin the baseline first (this red is not the change's fault)」
 *     —— 缺的正是 **pin** 那一半。
 *
 * ── ★★ 它【不是白名单】，而这是一条判据上的区别，不只是措辞 ──────────────────────
 *
 *     白名单       ⇒ 让判据**闭嘴**（"这些失败没关系"）
 *     已知失败清单 ⇒ 让判据**换一个更准的问句**：
 *                    不问「基线绿吗」（它不绿，而那一格不是本次造成的），
 *                    而问「这次改动【新增】了失败吗」
 *
 *   ⇒ 机制上：判据不再拿 `baseline.exitCode !== 0` 当作"无法归因"的**充分条件**，
 *     而是在清单在场时继续往下走，并拿它去**扣除**那些已知的失败。
 *
 * ── ★★ 而"新增的失败"从哪来（读之前必须知道这一格）─────────────────────────────
 *
 *   `fullScope.failedTests`（调用方已经在用同一格交回 `coveredTests`）。
 *   ★ 那一格**缺席**时，判据**不能**宣称"没有新增" —— 那是"我没能看到"，
 *     而它必须落回"无法归因"（见下面 gate() 里的两条分支）。
 *
 * ── 形状与纪律 ────────────────────────────────────────────────────────────────
 *
 *   每条必须带 `test`（那条失败的名字）+ `because`（为什么它不算本次的）。
 *   ★ 而**坏掉的清单必须抛错**，不许静默降级成空清单：
 *     一份坏清单与"真的没有已知失败"是两件事 —— 后者会让判据把所有红都当新增。
 */
export interface KnownBaselineFailure {
    test: string;
    because: string;
    fixture?: string;
}
export declare function parseKnownBaselineFailures(raw: unknown): KnownBaselineFailure[];
/** 跑一次命令，返回退出码。与 `completion.verify-rerun` 同一个注入形状。 */
export type ExecCommand = (command: string) => Promise<number>;
export interface BacktestContext {
    /**
     * ── ★★★ kind 需求表的**运行时**来源（t54）─────────────────────────────────────
     *
     * ★ 与 t53 的 `loadRules`、以及 r5 的同一格**并列同形**：全仓只有**一种**
     *   "数据怎么被读到"的写法（数据在 src/gates/…/*.json + 一格注入 + 调用方每次读盘）。
     * ★ **同步**：`appliesTo` 是同步契约，而 kind 守卫就住在那里。
     */
    loadKindRequirements?: () => KindRequirementsLoad;
    task?: {
        id?: string;
        kind?: string;
        inScope?: string[];
    };
    update?: {
        changedPaths?: string[];
    };
    /** ★ 本次改动涉及的文件（workspace 相对）。空数组 = 没声明，判据据此 unmeasured。 */
    changedPaths?: string[];
    /** 基准版本上的测试结果。缺席 ⇒ unmeasured（"没测到"不是"通过"）。 */
    baseline?: BaselineState;
    /**
     * ★★★ t76：已知失败清单。**在场**且基线不绿 ⇒ 按【差异】归因（而不是"无法归因"）。
     *
     * ★ 缺席 ⇒ 落回「attribution is impossible」—— 缺席的清单与一份恰好覆盖了
     *   所有失败的清单【必须不同形】（前者是"我没有那份记录"）。
     */
    knownBaselineFailures?: KnownBaselineFailure[];
    /** 修复/候选版本上跑【全量】测试：`(command) => exitCode`。 */
    execBacktestCommand?: ExecCommand;
    /** 跑【选测】的那条命令：`(command) => exitCode`。 */
    execSelectedCommand?: ExecCommand;
    /**
     * 依赖图与覆盖率。★ 缺任一项 ⇒ unmeasured：没有它们，"选测没把改动抓住"
     * 这个结论无从谈起（无数据的空集会让判据看起来通过）。
     */
    coverage?: CoverageInput;
}
interface BaselineState {
    /** 基准版本（父版本 / HEAD，例如 worktree 的 `base`）上的全量测试退出码。 */
    exitCode?: number;
    /** 那个版本的可读标识（hash / 标签）。★ 交回调用方做落盘与人工追溯。 */
    label?: string;
    failedTests?: string[];
}
interface CoverageInput {
    /**
     * ★ 选测的来源。只有 `'dependency-graph'` 是判据接受的那种；
     *   其余（含未声明）⇒ unmeasured（见文件头：隐藏自身近似性的选择器）。
     */
    source?: 'dependency-graph' | 'runner-declared' | 'unknown';
    /** 依赖图的【传递】依赖者：文件 → 依赖它的文件（含传递闭包）。 */
    dependents?: Record<string, string[]>;
    /** 哪个测试覆盖了哪个文件：文件 → 覆盖它的测试。 */
    coverage?: Record<string, string[]>;
    /** 本仓库【已知的全部测试】。全量与盲区都以它为全集。 */
    knownTests?: string[];
    /** 本次选测实际跑了哪些测试。 */
    selected?: string[];
    /** 选测用的命令（交回调用方，便于把结果落盘）。 */
    command?: string;
}
/** `appliesTo` 关心的字段：只知道形状，不依赖具体类型。 */
type BacktestAppliesContext = {
    task?: {
        kind?: string;
    };
    changedPaths?: unknown;
    update?: {
        changedPaths?: unknown;
    };
    /** ★ t54：kind 需求表的运行时来源（同步 —— `appliesTo` 是同步契约）。 */
    loadKindRequirements?: () => KindRequirementsLoad;
} | undefined;
/**
 * 只对【声明了改动文件】的【实现/修复】任务生效。
 *
 * ★ 两个条件的由来与 `dispatch.changed-paths` 同源：
 *   · 没声明 changedPaths ⇒ 没有"哪些文件变了"这个输入，回测无从选测
 *     （它会诚实地说 unmeasured，但那是在每一类任务上都刷一条噪音）；
 *   · 只有 implementation/repair 的契约要求 changedPaths。
 *
 * ── ★★★ 修（t48）：这一段注释**一直写着两个条件，而代码只实现了后一个** ──────────
 *
 * MEASURED（integrator6 发现、我独立复现）：
 *
 *     appliesTo({ task: { kind: 'integration' }, update: { changedPaths: ['a','b','c','d'] } })
 *         ⇒ **true**      ← 而它当时只检查了 changedPaths，`kind` 一眼没看
 *
 * ★ 后果（**f-0020 的同一形态，换了触发条件**）：
 *
 *     任何【非写域类】任务（integration / verification / review）**只要诚实申报
 *     changedPaths**，就被这条判据审判；而 `baseline` 对这类任务**根本不存在**
 *     （它不是"还没算出来"，是"这个概念不适用"）
 *     ⇒ **恒 unmeasured ⇒ 恒交不出终态**。
 *
 *   ★ 而它比 f-0020 更隐蔽：f-0020 是"repair 没有新测试"，
 *     这一条是"非写域任务没有 baseline" —— 触发条件换了一个，
 *     而形状完全相同：**一个永远打不开的门**。
 *
 *   ★★ 而"诚实申报 changedPaths"恰恰是本队**奖励**的行为
 *     （`dispatch.changed-paths` 专门堵不申报）——
 *     ⇒ 于是这条缺陷惩罚的正是最诚实的任务。这是它最坏的地方。
 *
 * ── 同族的三条为什么只有它漏了 ────────────────────────────────────────────────
 *
 *     r5.ts:116      `if (kind !== 'implementation' && kind !== 'repair') return false`
 *     mutation.ts:194 同上
 *     backtest.ts     ★ 这一条漏了
 *
 *   ⇒ 三条各自写守卫，而**一致性没有任何机制保证**。
 *     这正是本任务要求一条【普查臂】的原因（见
 *     `scripts/gate-completion-kind-guard.test.mjs`）——
 *     漏一个就多一类交不出终态的任务，而它不会在别处留下痕迹。
 */
export declare function appliesTo(ctx: BacktestAppliesContext): boolean;
/** 把可能带 `./` 前缀、反斜杠、尾斜杠的路径规整成同一个可比较的形状。 */
export declare function normalizePathToken(path: string): string;
export declare function gate(ctx: BacktestContext): Promise<GateVerdict>;
export {};
