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
export declare const id = "completion.backtest";
export declare const point = "completion";
export declare const description = "\u6309\u4F9D\u8D56\u56FE\u9009\u6D4B\u5E76\u8DD1\u5168\u91CF\uFF0C\u8BC1\u660E\u6539\u52A8\u6CA1\u628A\u522B\u5904\u6539\u574F\uFF1B\u57FA\u51C6\u4E0D\u7EFF\u6216\u9009\u6D4B\u6765\u6E90\u4E0D\u660E\u5373\u62D2\u7EDD/\u672A\u6D4B\u91CF\uFF08\u4E0D\u80FD\u5F52\u56E0\u65F6\u7EDD\u4E0D\u653E\u884C\uFF09";
/** 跑一次命令，返回退出码。与 `completion.verify-rerun` 同一个注入形状。 */
export type ExecCommand = (command: string) => Promise<number>;
interface BacktestContext {
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
    changedPaths?: unknown;
    update?: {
        changedPaths?: unknown;
    };
} | undefined;
/**
 * 只对【声明了改动文件】的【实现/修复】任务生效。
 *
 * ★ 两个条件的由来与 `dispatch.changed-paths` 同源：
 *   · 没声明 changedPaths ⇒ 没有"哪些文件变了"这个输入，回测无从选测
 *     （它会诚实地说 unmeasured，但那是在每一类任务上都刷一条噪音）；
 *   · 只有 implementation/repair 的契约要求 changedPaths。
 */
export declare function appliesTo(ctx: BacktestAppliesContext): boolean;
/** 把可能带 `./` 前缀、反斜杠、尾斜杠的路径规整成同一个可比较的形状。 */
export declare function normalizePathToken(path: string): string;
export declare function gate(ctx: BacktestContext): Promise<GateVerdict>;
export {};
