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
import { deriveScanDirs } from '../shared/entities.ts';
import { resolveBaseRevision } from '../shared/entities.ts';
import type { GateEvaluation } from '../../gates/registry.ts';
/** completion 位置需要的、来自调用方的输入（★ 名字与拆前同形，见文件头）。 */
export interface CompletionWiringInput {
    args: any;
    changedLines: any;
    loadKindRequirementsSync: () => any;
    resolveBaseRevision: typeof resolveBaseRevision;
    acceptanceResults: any;
    changedFiles: any;
    commandsRun: any;
    discriminatingFiles: any;
    findings: any;
    gate: any;
    input: any;
    killerSuiteFiles: any;
    newTestFiles: any;
    observedTestFiles: any;
    repairEvidence: any;
    task: any;
    worktreeBase: any;
    /** 判据注册表（注入进来，而不是本模块去取单例）。 */
    registry: {
        evaluate: (point: 'completion', ctx: unknown) => Promise<GateEvaluation>;
    };
    /** 工作区根。 */
    workspace: string;
    deriveScanDirs: typeof deriveScanDirs;
}
export interface CompletionWiringResult {
    context: unknown;
    inputSurface: unknown;
    gates: GateEvaluation;
    /** ★ 段内算出、而**段外还要用**的那一格（`followUpMessage` 的调用点读它）。 */
    wantsCompleted: boolean;
}
/**
 * 构造 completion 位置的 ctx、核对它、求值。
 *
 * ★ **逐字搬运**：下面这 271 行与拆前完全相同（唯一差别是"这些东西从哪来"）。
 */
export declare function wireCompletion(raw: CompletionWiringInput): Promise<CompletionWiringResult>;
