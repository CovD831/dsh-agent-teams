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
export declare const id = "contract.build-artifact-scope";
export declare const point = "contract";
export declare const description = "inScope \u58F0\u660E\u4E86 src/ \u4E0B\u4F1A\u6539\u52A8\u7684\u6587\u4EF6\u3001\u5374\u6CA1\u6709\u58F0\u660E\u5BF9\u5E94\u7684 lib/ \u6784\u5EFA\u4EA7\u7269 \u21D2 \u63D0\u793A\uFF08\u672C\u4ED3\u5E93\u5F3A\u5236 lib/ \u4E0E src/ \u540C\u6B65\uFF0C\u6210\u5458 build \u540E\u5FC5\u7136\u4EA7\u751F undeclared \u8DEF\u5F84\uFF09";
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
