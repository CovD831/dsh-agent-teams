/**
 * ── 判据：每个目标都有人认领（交付时的【无人认领】检查）──────────────────────────
 *
 * 插入点：`delivery`（团队宣布交付 —— 契约 §1 ④）
 * id     ：`delivery.coverage`
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * `canDeclareDelivery` 检查的是**任务列表**："每个任务都完成了吗、review 通过了吗、
 * 有没有未入账的越界路径"。它从来不问一个更前面的问题：
 *
 *     用户提的那些目标，**有没有任何一条任务声称覆盖了它**？
 *
 * 而一个没有任何任务 `coverageOf` 它的目标，在任务列表里【不留痕迹】——
 * 任务全绿、review 全 pass、`canDeclareDelivery` 返回 `{ok:true}`。
 * 于是交付那一刻读起来是"全队的目标都完成了"，而实际上**有一个目标从来没人碰过**。
 * 这是"没测到"并进"通过"的同一形态，只不过被并进去的是【整个目标】。
 *
 * ★ 上游已经算了 `coverage`（矩阵，`buildCoverageMatrix`），但**没人据此拒交付** ——
 *   它只出现在 `agent_teams_status` 的输出里，供人肉读。一条只被人读的结论，
 *   在一次匆忙的交付里与不存在同形。
 *
 * ★ 为什么这条判据不是"重算 coverage"：矩阵由调用方提供（`ctx.coverage`），
 *   本文件只做【数据变换】—— 契约 §2 性质 1：判据不 import I/O。
 *
 * ── 它不做什么（刻意的边界）────────────────────────────────────────────────────
 *
 * · **不检查任务完成度**：那是 `canDeclareDelivery` 的事。这里只报 `missing`
 *   （没有任务认领），并把 `blocked`（有任务但失败了）说清楚 —— 后者上游已经在拒。
 * · **不猜目标清单**：拿不到 `coverage` ⇒ `unmeasured`。一个"没拿到目标清单"
 *   与"目标全都有人认领"在交付裁决上必须不同形，否则一次读取失败就伪装成
 *   "全都覆盖了"。
 * · **不在没有目标条目时拒绝**：用户目标拆不出条目是**正常情形**（普通 work 团队
 *   根本没有 goal 概念）。此时 `coverage` 是空数组 ⇒ `ok`，那是一个测量结论
 *   （"看过了，没有条目需要认领"），不是"没测到"。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：不 import 任何 I/O（连 `quality-gates.ts` 也不 import ——
 *    `CoverageRow` 在这里按形状本地声明，好让"覆盖矩阵是调用方给的观察"这件事
 *    在 import 列表上一眼可见）。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形。
 */
import { type GateVerdict } from '../registry.ts';
export declare const id = "delivery.coverage";
export declare const point = "delivery";
export declare const description = "\u7528\u6237\u76EE\u6807\u7684\u6BCF\u4E2A\u6761\u76EE\u90FD\u5FC5\u987B\u6709\u4EFB\u52A1\u58F0\u79F0\u8986\u76D6\u5B83\uFF1B\u6709\u76EE\u6807\u65E0\u4EBA\u8BA4\u9886 \u21D2 \u4EA4\u4ED8\u65F6\u62D2\u7EDD\uFF08\u5176\u4F59\u4EFB\u52A1\u5168\u7EFF\u4F1A\u8BA9\"\u6CA1\u4EBA\u505A\u7684\u76EE\u6807\"\u770B\u8D77\u6765\u50CF\u90FD\u5B8C\u6210\u4E86\uFF09";
export interface CoverageContext {
    /** 团队状态。本判据只读它的目标条目（`profile.protocol`），不做别的判断。 */
    team?: {
        id?: string;
        profile?: {
            protocol?: string;
        };
    };
    /**
     * 上游算好的覆盖矩阵（`buildCoverageMatrix` 的产出）。见 `goalItemsOf` ——
     * 它**不是**目标清单的唯一来源。
     */
    coverage?: readonly unknown[];
}
/**
 * 生效条件：`team` 被传进来了（"这一步就是交付判读"的信号）。
 *
 * ★ 为什么【不】按 kind / 按有没有目标收窄：
 *   · "没有目标条目"正是对照臂要表达的东西（⇒ `ok`），把它写成 `appliesTo: () => false`
 *     会让它落进 `skipped`，而 `skipped` 与"这条判据不适用"同形 —— 于是
 *     "这次交付一个目标都没有" 永远不会有人说。这与 `contract` 位置那条
 *     "未测量 ≠ 不适用"是同一个道理。
 *   · 一个**没有目标**的团队（普通 work 团队）必须照常交付 —— 但那件事由
 *     `gate` 用 `ok` 说，不是由 `appliesTo` 把它藏起来。
 *
 * ★ 也【不】要求 `coverage` 在场：矩阵缺席恰恰就是未测量臂的输入。
 *   一条"输入不全 ⇒ 我不跑"的 `appliesTo` 会让"没测到"与"不适用"同形 ——
 *   而那正是本判据最不该犯的错（它的整个存在理由就是不让"没测到"并进"通过"）。
 */
export declare function appliesTo(ctx: CoverageContext | undefined): boolean;
export declare function gate(ctx: CoverageContext): GateVerdict;
