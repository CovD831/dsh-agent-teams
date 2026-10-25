import type { Context } from '@deepseek-ai/cordis';
import type { ToolsConfig } from './shared/entities.ts';
/**
 * ── `scripts/plan-review-check.mjs` 里本文件真正用到的那几格 ──────────────────
 *
 * ★ 与 `entities.ts` 的 `PlanReviewModule` 同一条纪律：最小声明，
 *   **不用** `@ts-expect-error`（那会让「模块不在」与「导出改名了」读成同一件事）。
 */
interface PlanReviewCheckModule {
    readonly REQUIRED_PLAN_QUESTIONS?: readonly {
        readonly key?: string;
        readonly question?: string;
    }[];
    readonly checkPlanReview?: (plan: readonly unknown[]) => {
        readonly overall?: string;
        readonly detail?: string;
        readonly contracts?: readonly {
            readonly id?: string;
            readonly answers?: Readonly<Record<string, {
                readonly status?: string;
                readonly detail?: string;
            } | undefined>>;
        }[];
    };
}
/** `scripts/friction-triage.mjs` 里本文件真正用到的那几格。 */
interface TriageModule {
    readonly adversarialReview?: (contract: unknown, scopeVerdict?: unknown) => {
        readonly outcome?: string;
        readonly checks?: readonly {
            readonly id?: string;
            readonly verdict?: string;
            readonly why?: string;
        }[];
    };
    readonly tierOf?: (contract: unknown, options?: {
        readonly exists?: (path: string) => boolean;
    }) => {
        readonly tier?: string;
        readonly why?: string;
        readonly nextStep?: string;
    };
}
/** 某一问的结论 —— 戳里的一格。 */
interface StampCheck {
    readonly id: string;
    readonly verdict: 'pass' | 'fail' | 'unmeasured';
    readonly why: string;
}
/** 一条"因此不发戳"，连同补救动作。 */
interface Refusal {
    readonly id: string;
    readonly verdict: string;
    readonly why: string;
    readonly remedy: string;
}
export interface ReviewPlanReadout {
    /** ★ 能不能发戳。`false` 时 `refusals` 一定非空（除非 `unmeasured` 在场）。 */
    readonly stampable: boolean;
    /** 戳（`stampable === false` ⇒ **缺席**，不是 `null`）。逐字是 `create_task.reviewed` 的形状。 */
    readonly reviewed?: {
        readonly at: number;
        readonly by: string;
        readonly checks: StampCheck[];
    };
    /** 五问逐条结论（发不发戳都印 —— 那是审查的实际内容）。 */
    readonly checks: StampCheck[];
    /** ★ 不发戳的逐条理由 + 补救动作。 */
    readonly refusals: Refusal[];
    /** 四问「计划写清了吗」的原始读数。 */
    readonly plan: {
        readonly overall: string;
        readonly detail: string;
        readonly perQuestion: {
            readonly key: string;
            readonly status: string;
            readonly detail: string;
        }[];
    };
    /** 分档读数。 */
    readonly tier: {
        readonly tier: string;
        readonly why: string;
        readonly nextStep?: string;
    };
    /** ★ 模块调不起来 ⇒ 这一整份读数**不成立**（不是"没有问题"）。 */
    readonly unmeasured?: string;
}
/**
 * 跑完整审查，并按三态决定发不发戳 —— **纯逻辑**，不碰盘、不碰 ctx。
 *
 * ★ 抽出来是为了让夹具能**逐条**构造三种结论，而不必去造一棵真实的 team 树。
 *   生产路径（下面的 `execute`）调的就是这一个函数 —— **一条实现，两处使用**。
 */
export declare function reviewAndStamp(options: {
    readonly contract: Readonly<Record<string, unknown>>;
    readonly at: number;
    readonly by: string;
    readonly loadCheck?: () => Promise<PlanReviewCheckModule>;
    readonly loadTriage?: () => Promise<TriageModule>;
}): Promise<ReviewPlanReadout>;
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export declare function register(ctx: Context, config: ToolsConfig): void;
export {};
