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
import { type GateVerdict } from '../registry.ts';
/**
 * ★ t54：从**非判据**的纯模块拿（不是从 `./r5.ts`）——
 *   判据之间不许互相 import（`verify-gates-integration` ④ 的显式 allowlist），
 *   而那条约束防的正是"一条判据调另一条"。
 *   ★ 本文件与 r5 是**兄弟**，不是它的用户。
 */
import { type KindRequirementsLoad } from './kind-requirements.ts';
import type { CtxPaths } from '../requires.ts';
import { type InvariantDefinition, type MutantRun, type MutationOperator, type SuiteTarget } from '../../mutation.ts';
export declare const id = "completion.mutation";
export declare const point = "completion";
export declare const description = "\u5BF9\u3010\u6539\u52A8\u884C\u8303\u56F4\u3011\u6CE8\u5165 L1/L2/L3 \u53D8\u5F02\u4F53\u5E76\u91CD\u8DD1\u6740\u624B\u5957\u4EF6\uFF1A\u53D8\u5F02\u4F53\u5B58\u6D3B\u5373\u62D2\u7EDD\uFF08\u9632\u6B62\u88C5\u9970\u6027\u6D4B\u8BD5\uFF09\uFF1B\u5957\u4EF6\u591F\u4E0D\u5230\u88AB\u53D8\u5F02\u6587\u4EF6 \u21D2 unmeasured";
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
export declare const requires: CtxPaths<MutationContext>[];
/** 默认的"装饰性"界线。杀伤率低于它 ⇒ 说清有多少条存活、覆盖范围是什么。 */
export declare const DEFAULT_MIN_KILL_RATE = 0.6;
/** 镜像：改 `src/x.ts` 的源码，`lib/x.js` 是与它同源的编译产物，必须一起改。 */
export interface MutationMirror {
    readonly sourcePath: string;
    readonly mirrorPath: string;
}
export interface MutationContext {
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
        verify?: string[];
        changedPaths?: string[];
    };
    update?: {
        status?: string;
        changedPaths?: string[];
    };
    wantsCompleted?: boolean;
    taskNotTerminal?: boolean;
    /** 本次改动的文件（workspace 相对）。缺省回退到 update/task 的 changedPaths。 */
    changedFiles?: readonly string[];
    /**
     * ★ 只变异【改动行范围】。缺省时回退到与 changedFiles 配套的 `changedLines`。
     *   `undefined` 与 `[]` 必须不同形：
     *     undefined ⇒ 没能拿到 git 证据 ⇒ unmeasured（**不是**退回全文件）
     *     []        ⇒ 拿到了证据，且没有一行可变异 ⇒ 同样 unmeasured，但原因不同
     */
    changedLines?: readonly number[];
    /** 读一个文件（workspace 相对）。缺省 ⇒ unmeasured。 */
    readFile?: (path: string) => string;
    /** 跑一遍测试命令。缺省 ⇒ unmeasured。 */
    runTest?: (command: string) => Promise<MutantRun>;
    /**
     * 读一个杀手套件的文本，用于【探针射程】判定。
     *
     * ★ 与 `readFile` 分开是因为路径空间不同：`readFile` 收 workspace 相对路径，
     *   套件路径来自命令模板（可能是绝对路径）。缺省时回退到 `readFile`。
     */
    readSuite?: (path: string) => string;
    /** 就地写一个文件（应用变异体）。缺省 ⇒ unmeasured。 */
    writeFile?: (path: string, contents: string) => void | Promise<void>;
    /** 命令模板：`*` 会被替换成杀手套件路径列表。 */
    testCommand?: string;
    /** 杀手套件候选（显式声明 —— 没有回退，见 probeReach）。 */
    killerSuites?: readonly SuiteTarget[];
    /** 为什么是这些套件（审计用；不参与裁决）。 */
    killerSuitesReason?: string;
    /** L3 契约违反体的定义。 */
    invariants?: readonly InvariantDefinition[];
    /** 覆盖的镜像（源码 ↔ 编译产物），默认：改了 src/**\/*.ts ⇒ 也改 lib/**\/*.js。 */
    mirrors?: readonly MutationMirror[];
    operators?: readonly MutationOperator[];
    minKillRate?: number;
    /** L3 的锚点越界是否算错。默认 true —— 落在改动范围外就是"变异了无关区域"。 */
    enforceL3Range?: boolean;
    maxMutants?: number;
    /** 语料 = 这条判据覆盖到的文件，被交出去给下游读。 */
    corpus?: readonly string[];
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
export declare function appliesTo(ctx: MutationContext | undefined): boolean;
export declare function gate(ctx: MutationContext): Promise<GateVerdict>;
/** 把一串行号折成尽量少的连续区间。 */
export declare function toRanges(lines: readonly number[]): Array<{
    startLine: number;
    endLine: number;
}>;
/** 编译产物镜像：`src/x.ts` ⇒ `lib/x.js`。仅对 src 下的 TS 生效。 */
export declare function defaultMirrors(files: readonly string[]): MutationMirror[];
