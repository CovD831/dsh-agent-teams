/**
 * ── 判据：inScope 含 `src/**` 却漏掉对应构建产物 ⇒ 建任务时就提示 ────────────────
 *
 * 插入点：`contract`（建任务 / 改契约 —— 契约 §1 ①）
 *
 * ── 它防的是什么失效（MEASURED ×3，代价是三个成员的往返）──────────────────────
 *
 * 本仓库强制 `lib/` 与 `src/` 同步：`scripts/git-artifacts.mjs` 会检查构建产物是否
 * 与源码一致，不一致就判 stale；而硬约束又要求"改 src 后必须 pnpm build"（已装插件
 * 是 `link:` 指向源码，不 build 就跑旧代码）。两件事叠起来的必然后果是：
 *
 *     一个 inScope 含 `src/gates/registry.ts` 却漏掉 `lib/gates/registry.js` 的
 *     质量任务，成员按纪律 build 之后，**必然**产出 lib/ 下的改动；
 *     而质量门禁看到的就是 `lib/gates/registry.js is undeclared` ⇒ 该任务永远
 *     无法诚实地完成 —— 契约在【建】的那一刻就已经写错了。
 *
 * 本轮实测发生了三次（t8/t11、t6、t9），每一次的代价是一个成员的往返 + 一次契约
 * 修订。而三次的形状完全相同、且**在 create_task 那一刻就完全可见**。
 *
 * ★ 为什么这条判据在 `contract` 位置而不是 completion 位置：后者只能在成员已经
 *   白跑一趟之后说"这个路径没声明"；前者在派发之前就把话说清楚。**同一个事实，
 *   在建任务时说是一次提醒，在完成时说是一次损失。**
 *
 * ★ 它为什么不是"放宽"（这是本任务唯一的硬约束）：
 *   本判据**只读 inScope 列表**，从不改判任何 changedPath 的分类。
 *   `classifyChangedPath` / `undeclared path` 的拒绝逻辑一个字都没动 ——
 *   没写进 inScope 的路径，无论本判据说什么，都仍然是 `undeclared`。
 *   一个"因为漏了 lib/ 就放它过"的判据会把本队刚吃过三次的那个洞**焊死成特性**。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：本文件不 import 任何 I/O，也不读磁盘去看 `lib/` 里有没有那个文件。
 *    它只做【路径字符串之间的映射】—— 与 `deriveCoverageInput` 那类"由调用方提供
 *    观察"的分工一致。拿不到 inScope ⇒ `unmeasured`（★ 不是 `ok`）。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 */
import { type GateVerdict } from '../registry.ts';
import type { CtxPaths } from '../requires.ts';
export declare const id = "contract.build-artifact-scope";
export declare const point = "contract";
export declare const description = "inScope \u58F0\u660E\u4E86 src/ \u4E0B\u4F1A\u6539\u52A8\u7684\u6587\u4EF6\u3001\u5374\u6CA1\u6709\u58F0\u660E\u5BF9\u5E94\u7684 lib/ \u6784\u5EFA\u4EA7\u7269 \u21D2 \u63D0\u793A\uFF08\u672C\u4ED3\u5E93\u5F3A\u5236 lib/ \u4E0E src/ \u540C\u6B65\uFF0C\u6210\u5458 build \u540E\u5FC5\u7136\u4EA7\u751F undeclared \u8DEF\u5F84\uFF09";
/**
 * ── ★ 输入面声明（B 层，编译期）────────────────────────────────────────────────
 *
 * ★ 这一份是本轮「可选输入怎么声明」的**第一个真实压力测试**，而结论是：
 *   **不需要新形状 —— 需要的是一条口径。**
 *
 * ── 口径（与 shape-dev 的 paths 层、delivery-owner 的 (a)/(b)/(c) 三分法同源）
 *
 *     `requires` 只声明【这条判据无条件读的那几格】。
 *     判据【可选地】读的东西不进 requires —— 它的在场与否由判据自己的裁决
 *     （ok / unmeasured）持有，并由一条夹具臂钉住。
 *
 * ── 为什么这里只声明 `'task'`，而【不】声明 `'task.inScope'` ────────────────────
 *
 * 这条判据的语义**恰好**是一句「缺席不是缺失」（t11 的收口，见下面 `gate()` 的
 * 两段注释 —— 它们逐字对着 `kind=work` 的真实契约：`create_task` 给 work 类
 * **本来就不带 `inScope`**）：
 *
 *     inScope 整个缺席    ⇒ 这份契约没有提出同步要求 ⇒ **ok**（不适用）
 *     inScope 在场但不可判 ⇒ 它提了要求而清单读不出   ⇒ **unmeasured**
 *
 * ⇒ 若把 `'task.inScope'` 写进 requires，核对层会在**每一个普通任务**上报
 *   「contract.build-artifact-scope declares 1 ctx path that this context does not
 *   carry: task.inScope」—— 而那正是这条判据明确拒绝报的东西。
 *   ★ 那是**假告警**，而本队的定论是：假告警与不报警同样有害，它教人忽略门禁。
 *
 * ── 那"没接上"还发不发现得了 ────────────────────────────────────────────────────
 *
 * 能，而且分得比"报缺"更准 —— 三件事各归其位（与 requires.ts 文件头那三层同源）：
 *
 *     ① 拼错路径（`'task.inScpoe'`）          ⇒ 编译期 TS2322，永远不可能漏。
 *     ② 调用方【整个没交出契约】（没有 task）  ⇒ 这不是静态判断，是**运行时**事实：
 *        `appliesTo` 为假 ⇒ 注册表在进 `gate()` 之前就把它记成
 *        `requires.checks[].status === 'skipped'`（`skippedBecause` 写明原因），
 *        `requires.skipped` 计数把它抬出来。★ 跳过 ≠ 齐（不同形），所以
 *        「这一轮根本没接上契约」不会被读成「判据通过了」。
 *     ③ 契约在、而 inScope 故意缺席           ⇒ 判据自己判 **ok**（不适用）。
 *
 * ★ `'task'` 这一格是**必填**的：它既是 `appliesTo` 读的那一格，也是判据里唯一
 *   一个**无条件**读的东西（`const inScope = ctx?.task?.inScope`）。它缺席 ⇒
 *   判据根本不说话。于是"声明到判据真的读到的那条边界"在这里是自洽的：
 *   声明 `'task'`、`appliesTo` 看 `ctx.task`、`gate()` 从 `ctx.task.inScope` 起读。
 *
 * ★ 它也不会让"漏接"从此看不见：真会产出 undeclared 路径的是**声明了 inScope 的
 *   质量任务**，而那些任务必然带着 `task` ⇒ 核对层照常核对这一格；一条把契约
 *   整个丢掉的调用点会在 `skipped` 计数上留下痕迹 —— 它本来就不在这条判据的
 *   输入面里，硬报成"缺 task"会把"不适用"说成"没接线"。
 */
export declare const requires: CtxPaths<BuildArtifactScopeContext>[];
interface BuildArtifactScopeContext {
    /**
     * 待建 / 待改的任务契约。取自 `create_task` 的任务草稿或 `amend_task` 修订后的任务。
     *
     * `inScope` 缺席（非质量类任务、或契约还没写 inScope）⇒ 本判据 `unmeasured`：
     * **拿不到清单不等于清单是对的**。
     */
    task?: {
        id?: string;
        kind?: string;
        /** inScope 是否在场 —— 与"在但为空数组"必须不同形（见 gate 里的 unmeasured 分支）。 */
        inScope?: string[];
        outOfScope?: string[];
    };
    /** true = 建任务，false = 改契约。两者都在契约位置求值。 */
    creating?: boolean;
}
/**
 * 凡是有任务在场的契约都进求值。
 *
 * ★ `appliesTo` 在这里刻意【不】按 kind 收窄、也**不**排除"没有 inScope"的情形。
 *
 *   为什么不用 `appliesTo: (ctx) => Array.isArray(ctx.task.inScope)`：
 *   那会让三种"没有可判清单"的情形一起落进 `skipped`，而 `skipped` 与"这条判据
 *   不适用"同形 —— 于是**契约里到底有没有提出同步要求**这件事永远不会有人说。
 *   这与 t9 里"观察模式不是 appliesTo"是同一个道理：**不适用**与**没能测量**必须
 *   不同形，而它们各自的**正确收场也不同**（见 gate 里两条分支的注释）。
 *
 * ★ 收窄在 gate 里按【事实】做，不按 kind 做：判据不去猜哪些 kind "应该"有 inScope
 *   （那是 `quality-gates.ts` 的知识），它只看手上这份契约有没有提出同步要求。
 */
export declare function appliesTo(ctx: BuildArtifactScopeContext | undefined): boolean;
export declare function gate(ctx: BuildArtifactScopeContext): GateVerdict;
export {};
