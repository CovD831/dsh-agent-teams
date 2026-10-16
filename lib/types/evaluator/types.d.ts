/**
 * ── 评估器的**类型**（t92）───────────────────────────────────────────────────────
 *
 * ★★★ 本目录（`src/evaluator/`）**独立于 `src/evolution/`**（用户裁定）：
 *
 *   ① 已有的 21 条判据 ⇒ 回答「这次改动【合规】吗」 ⇒ 单次、当下、机械
 *   ③ 评估器           ⇒ 回答「这次改动【有收益】吗」 ⇒ 前后【两个窗口】、趋势
 *   ⇒ 单次判据【结构上】回答不了趋势。
 *
 * ★ **通用，不只评估自净化**（用户 2b 原话）：
 *   「在项目开发过程中,我们做的一些改动,可能也需要评估器去评估其收益」
 *   ⇒ subject 是【契约形状】—— 自净化的提案与一次普通开发改动同形。
 *
 * ★★ 而它**不 import `src/evolution/`**：它读的是 `Proposal` 的**投影**（effect 靶），
 *   而不是 Proposal 本身 —— 两层各自演进，形状一致性由消费方（组装点）负责。
 */
/**
 * 评估器监督的对象 —— 一律是【契约形状】（规格 `MODULE-IO-CONTRACTS.md` §3.1 逐字）。
 *
 * ★ 复用契约字段（`TeamTask` / `create_task` 的那套），不发明第二套。
 */
export interface EvaluatedSubject {
    /** 任务 id 或提案 id。 */
    readonly id: string;
    /** 这条评估锚定的时刻（epoch ms）—— 前后窗口的分界点。 */
    readonly at: number;
    /** ★ 复用契约的形式（不发明第二套）。 */
    readonly contract: {
        readonly kind?: string;
        readonly objective?: string;
        readonly acceptance?: readonly string[];
        readonly verify?: readonly string[];
        readonly inScope?: readonly string[];
        readonly outOfScope?: readonly string[];
        readonly nonGoals?: readonly string[];
    };
    /** ★★ 交付后的读数（实施完才有；评估器据此算来源 ① 与 ②）。 */
    readonly delivered?: {
        readonly changedPaths?: readonly string[];
        /** 结构 = `types.ts` 的 `AcceptanceResult`（形状复用，类型独立 —— 与 evolution/health.ts 同一条取舍）。 */
        readonly acceptanceResults?: readonly {
            readonly criterion: string;
            readonly status: 'passed' | 'failed';
            readonly evidence?: string;
        }[];
        /** 结构 = `types.ts` 的 `CommandResult`。 */
        readonly commandsRun?: readonly {
            readonly command: string;
            readonly status: 'passed' | 'failed';
            readonly exitCode?: number;
            readonly evidence?: string;
        }[];
    };
    /**
     * ★★★ 收益的【靶】—— 来自 `Proposal.routing.effect`（结构化形式），
     *   或一次开发改动自己声明。
     * ★★ **字符串形式不在这里收**（与 t91 的 `RoutingEffectRef` 不同）：
     *   采集层收两种（历史形状），评估器**只收结构化** ——
     *   一个自由文本串没有 (component, kind) 桶，**算不出前后窗口**（t91 注释逐字警告过）。
     */
    readonly effect?: {
        readonly component: string;
        readonly kind: readonly string[];
    };
}
/** 收益的结构性裁决（规格 §4：每一层都有 unmeasured，且它不是"低分"）。 */
export type EffectVerdict = 'improved' | 'unchanged' | 'unmeasured';
/**
 * ── ★★★ 评估器的**输出**（用户裁定：**一个概率** + 逐条读数）─────────────────────
 *
 * ★ 规格 本章定义的是 `score` + `confidence` 两个数（jev 参照）；
 *   用户后来裁定合并：「决策模型对选项输出一个概率分布……这个概率其实就相当于
 *   是一种置信度了,所以可能只需要一个数字」。
 *   ⇒ ★ 本形状按用户裁定合并为**一个 `probability`**（Beta 后验均值，`score.ts` 复用
 *   `confidenceOf` 算出），而**规格的"两数不同轴"论证被保留为一条硬纪律**：
 *   概率回答"多可信"，verdict 回答"是什么" —— **概率不进 verdict**。
 *
 * ★★★ 而"一个数字"的前提（Σp = 1 ⇒ 分布编码选择与把握）**无法表达弃权**：
 *   `p = 0.5` 是"两个都一样可能"，与"我判不了"是**两件事**
 *   ⇒ `unmeasured` 是 verdict 的**第三个答案**，`probability: undefined` 是它的读数面
 *   （**不是 0、不是 0.5** —— 与 `confidenceOf` 对缺席计数返回 `undefined` 同一条纪律）。
 */
export interface EvaluationReading {
    /** 被评估对象的 id（任务 id 或提案 id）。 */
    readonly subjectId: string;
    /** ★★★ 综合判定 —— 三态；`unmeasured` 是"弃权"本身，不是低分。 */
    readonly verdict: 'effective' | 'ineffective' | 'unmeasured';
    /** ★★ 一个概率 0..1（Beta 后验均值）；`undefined` ⇒ 判不了（不是 0）。 */
    readonly probability: number | undefined;
    /** ★ 逐条机械理由（哪几条过、哪几条没过、哪几条判不了）。 */
    readonly reasons: readonly string[];
    /** ★★ 逐条读数（缺哪条一眼可见，而不是只给个 false）。 */
    readonly readings: readonly {
        /** `'acceptance'` / `'verify'` / `'effect'`。 */
        readonly name: string;
        readonly value: string | number | undefined;
        /** `undefined` ⇒ 这一条判不了。 */
        readonly ok: boolean | undefined;
    }[];
}
/**
 * 收益窗口的逐条读数（`effect.ts` 产出，进 `EvaluationReading.readings`）。
 *
 * ★★ 无基线（`before.count === 0`）与「降了但幅度小」必须【不同形】：
 *   前者 `verdict: 'unmeasured'` + `reason: 'no-baseline'`；
 *   后者 `verdict: 'ineffective'` + `reason` 说的是"没降到、或降了但窗口存疑"。
 */
export interface EffectReading {
    /** 靶桶键（`component` + 排序后的 `kind`）—— 与 evolution/health.ts 的桶键同一口径。 */
    readonly bucketKey: string;
    /** 改动前窗口里该桶的计数（`0` = 无基线）。 */
    readonly before: {
        readonly count: number;
        readonly window: {
            readonly from: number;
            readonly to: number;
        };
    } | undefined;
    /** 改动后窗口里该桶的计数。 */
    readonly after: {
        readonly count: number;
        readonly window: {
            readonly from: number;
            readonly to: number;
        };
    } | undefined;
    readonly verdict: EffectVerdict;
    /** 幅度（`before.count - after.count`）—— ★ 作读数，**不进 verdict**（规格 §4.3 的 MemOS 教训）。 */
    readonly delta: number | undefined;
    /** 机械理由（为什么是这个 verdict；`unmeasured` 时说清缺哪一格）。 */
    readonly reasons: readonly string[];
}
