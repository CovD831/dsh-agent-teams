/**
 * ── 自进化层的**类型**（t86）────────────────────────────────────────────────────
 *
 * ★ 本目录只放**读数与记录**，不放任何会改判据的东西 ——
 *   理由见 `docs/COLLECTION-EVALUATOR-SELF-EVOLUTION.md` §3 那条矛盾：
 *
 *   > 「如果 `collection` 的判据可以被自进化循环修改，那么：
 *   >    循环发现"我被 `collection.dedupe` 拦住了" ⇒ 它可以去**放宽那条判据**
 *   >    ⇒ 接下来所有重复都会被采 ⇒ 而那正是 reward tampering。」
 *
 * ── ★★ 这条矛盾在代码里的落点是**两个循环的分层**，而它是可机械检查的 ──────────────
 *
 * ```
 * ★ 循环 A（内层 · 可自动）：改 prompt · 改 profile · 改判据的【阈值】· 改采集的【范围】
 * ★★ 循环 B（外层 · 只能人改）：collection 的四条判据本身 · 验证命令 · confidence 阈值
 * ```
 *
 * ★ **所以本目录（`src/evolution/`）里不许出现对 `src/gates/**` 的写路径。**
 *   它只能**读**判据的读数（`health.ts`）、**记**判据的历史（`history.ts`），
 *   而"改判据"这件事**没有对应的函数** —— 不是"忘了写"，是**刻意不提供**。
 *   ★ 一条只禁止调用的注释会腐烂；**没有那个函数**则不会。
 */
/**
 * 一个采集桶 —— 同一个 `(component, kind)` 下所有记录的聚合。
 *
 * ★ 它对应规格里 `CollectionHealth.buckets` 那一格的形状（逐字段一致）。
 */
export interface CollectionBucket {
    readonly component: string;
    readonly kind: readonly string[];
    readonly count: number;
    readonly firstAt: number;
    readonly lastAt: number;
}
/**
 * 采集层的**自我读数** —— 它是"该不该改判据"的唯一依据。
 *
 * ★ 规格逐字（`docs/COLLECTION-EVALUATOR-SELF-EVOLUTION.md` §4.1）：
 *   「★★ 采集层的自我读数 —— 它是"该不该改判据"的唯一依据"」
 */
export interface CollectionHealth {
    /** 每个 `(component, kind)` 桶的计数与时间跨度。 */
    readonly buckets: readonly CollectionBucket[];
    /**
     * ★★ AutoLibra 的 **redundancy**：**唯一桶数 / 总记录数**。
     *
     * MEASURED（372 条台账）：`54 / 372 ≈ 0.145`。
     * ★ 口径**必须**是这个 —— 若算出别的数，是**口径错了**，不是数据变了。
     *   ⇒ 见 `health.ts` 里那条自检。
     */
    readonly redundancy: number;
    /**
     * ★ AutoLibra 的 **coverage**：**有多少条记录落进了"已被区分的组合"**。
     *
     * ★ 与 `redundancy` 是一个比值的**两面**，但**不许合并成一个数**：
     *   它们答的是两个问题（"有多少是新的" vs "有多少被覆盖到了"），
     *   而合起来之后"桶很少"与"覆盖很窄"同形 —— 补救动作相反
     *   （前者是**分类太粗**，后者是**采集太窄**）。
     */
    readonly coverage: number;
    /** ★ 被 collection 判据拒掉的条数（**按判据 id 分组**）。 */
    readonly refused: Readonly<Record<string, number>>;
}
/**
 * 一条**判据变更**记录。
 *
 * ★ 依据 SkillClaw 的 `history/` + Raven 的"必须先读全部历史再决定"，逐字：
 *   > 「Without this context you risk **reverting previous improvements
 *   >   or repeating past mistakes**.」
 *   > 「Explicitly answer: What changed in each prior version?
 *   >   What evidence justified that change?」
 *
 * ⇒ 所以四格**一个都不能少**（`changed` 与 `evidence` 尤其是"防反复来回改"的那两格）。
 */
export interface CollectionGateChange {
    /** 改的是哪一条（`collection.dedupe` / …）。 */
    readonly gateId: string;
    /** 何时改的（毫秒）。 */
    readonly at: number;
    /** ★ **改前**是什么（一字不差地记下被替换的那个值/口径）。 */
    readonly before: string;
    /** ★ **改后**是什么。 */
    readonly after: string;
    /** ★ **证据**：凭什么改（读数、夹具、事故）。一条说不出证据的变更不该被记进来。 */
    readonly evidence: string;
}
/**
 * ── ★★★ 两个循环的**分层**，写成数据而不是注释 ─────────────────────────────────
 *
 * 依据 §3：循环 A 可自动，循环 B **只能人改**。
 * ★ 而"某件东西属于哪个循环"必须是**可机械读的**（否则它只是一句话，
 *   而本仓记过："一句话不是任务"）。
 */
export type EvolutionLoop = 'A' | 'B';
/**
 * ★ 哪些**改动对象**属于循环 B —— **只能提议，不能自改**。
 *
 * ★ 规格 §3 逐字列出的三项，一条不多一条不少。
 */
export declare const LOOP_B_SUBJECTS: readonly ["collection-gates", "verify-command", "confidence-threshold"];
export type LoopBSubject = typeof LOOP_B_SUBJECTS[number];
/**
 * ★★ **循环 A 能不能自改某个对象** —— 本层唯一一条"规则"函数。
 *
 * ★ 它答的是那句矛盾的核心问题，而它的返回值是**布尔**（可机械断言）：
 *   `canLoopAAutoChange('collection-gates')` ⇒ **false**。
 *
 * ★★ 为什么把它放在 `types.ts` 而不是别处：它是**类型层的事实**
 *   （哪些对象属于哪个循环），而把它写在"决策"函数旁边会让它看起来像可调的策略 ——
 *   它不是策略，是**分层本身**。
 */
export declare function canLoopAAutoChange(subject: string): boolean;
/**
 * ── ★★★ `target` / `effect`：★ **收两种形状**（对象与字符串）───────────────────────
 *
 * MEASURED（t91 开工实测，读 `.agent-teams/evolution/signals.jsonl`）：
 *   t88 补录的那 10 条**已经在用** `routing`，而它们的 `target` / `effect`
 *   **写的是字符串**：
 * ```
 *   target: "队长派工 protocol：定 inScope 前先核『这条验收要求的能力物理上住在哪个文件』"
 *   effect: "★ 生效后读数：『因落点错而 require amend_task 的任务数』→ 0"
 * ```
 * 而规格 §1.2 定义的是**结构化对象**（`{kind, ref}` / `{component, kind}`）。
 *
 * ⇒ ★★ **两种都收** —— 而这不是权宜，**是本仓已经裁定过的形状**：
 *   `MemberRow.tsx` 的 `readEvaluationView`（t77）就同时接受【对象】与【JSON 字符串】
 *   两种拼写，而那次是刻意的：「谁补上那一跳界面立刻生效」。
 *
 * ★★ 而两者的**能力不同**，必须写清（否则下一个人会用字符串去算收益）：
 * ```
 *   · 字符串形式 = 【历史形状】（t88 手工补录的）
 *     ⇒ ★ 对"分流"合格（人能读懂该改什么）
 *     ⇒ ★★ 对"收益"**不合格** —— 评估器要按 (component, kind) 桶比对，
 *        而一个自由文本串**没有桶** ⇒ 算不出"这条生效后哪个数该降"
 *   · 结构化形式 = 规格要求；★ **新写入一律用结构化**
 * ```
 */
export type RoutingTargetRef = string | {
    readonly kind: 'gate' | 'prompt' | 'profile' | 'threshold';
    /** 判据 id / profile 键 / 阈值名。 */
    readonly ref: string;
};
export type RoutingEffectRef = string | {
    readonly component: string;
    readonly kind: readonly string[];
};
/**
 * ── ★★★ `RoutingDecision`：该怎么改（规格 §1.2 第 2 层）───────────────────────────
 *
 * ★ 采集模块的第一层输出是 `CollectionDecision`（`boolean | undefined`）——
 *   那只回答「**采不采**」。本类型回答第二个问题：「**该怎么改**」。
 *
 * ── ★★ `modality` 是【五态】，不是两态（规格 §3.1 的判据）────────────────────────
 *
 * ```
 *   ① 能否【机械判定】？  能 ⇒ hard（加/改一条判据）
 *                       不能 ⇒ soft（改 prompt / profile）
 *   ★ contract   ⇒ 需要人/agent 实施的一条任务
 *   ★ none       ⇒ 判定为不必改
 *   ★★ unmeasured ⇒ 判不了（例如「这需要产品决策」）—— ★ 不许硬塞成 soft
 * ```
 * ★★ `unmeasured` 必须存在：把"判不了"塞进 `soft` 会让**"我们没测出来"**与
 *   **"我们决定了走软"**在读数上同形 —— 而那是本仓记账最久的形态。
 *
 * ★ **与 t88 已有数据的关系**：那 10 条用的是 `decision`（三态：hard/soft/none），
 *   而 `contract` / `unmeasured` **一条都没出现** —— 不是它们不存在，
 *   而是那次补录**只覆盖了会出现的两类**。⇒ 本次把它们**补进类型**。
 */
export interface RoutingDecision {
    /** ★ 是否需要修改。★ 与 `modality === 'none'` 不同轴：`none` 是"看过且判定不必改"。 */
    readonly needChange: boolean;
    /** ★★ 以什么形态改 —— **五态**。 */
    readonly modality: 'hard' | 'soft' | 'contract' | 'none' | 'unmeasured';
    /**
     * ★★ 理由必须**可核** —— 不许写"看起来该走软"。
     * ★ t88 那 10 条的 `why` 实测 80–193 字符，它们全都**指名了判据**
     *   （如「判据是『能否机械判定』——**能**，而且是一条纯谓词：`inScope ∩ outOfScope ≠ ∅`」）。
     */
    readonly why: string;
    /** 落到哪个对象（可选：`none` / `unmeasured` 时通常没有靶）。 */
    readonly target?: RoutingTargetRef;
    /**
     * ★★★ 收益的【靶】—— ★ **与评估器的接口**（规格 §3.2）。
     * ★ **没有它，收益就只能靠感觉** —— 而那是用户第 ③ 点要解决的事。
     */
    readonly effect?: RoutingEffectRef;
}
/**
 * ── ★★★ `Proposal`：采集模块的【最终产出】（规格 §1.3）───────────────────────────
 *
 * ★★ **`contract` 子集复用契约形式 —— 不许发明第二套**（用户第 ③ 点）。
 *   ⇒ 它必须能被**原样喂给 `agent_teams_create_task`**。
 *
 * ── ★★ 而规格 §1.3 的字段表**缺了两格**（t91 实测比对 `create_task` 的真 schema）──
 *
 * ```
 * create_task 的 schema:
 *   subject: { type: 'string', required: true,
 *              description: 'Required non-empty title…Never omit it…' }
 *   kind:    { enum: ['work','requirements','implementation','verification',
 *                     'review','repair','integration'] }
 * ```
 * ★ 而规格 §1.3 的 `contract` 只有 `objective/acceptance/verify/inScope`
 *   ⇒ ★★ **按字面形状【喂不进去】**（缺 `subject`，而它是 `required: true`）。
 * ★ 而规格**自己的两处也不一致**：§3.1 的 `EvaluatedSubject.contract` **有 `kind`**，
 *   §1.3 没有 ⇒ 本次**两格都补**（`subject` 必填、`kind` 可选），与 §3.1 对齐。
 *
 * ★ 而 `kind` 尤其不是美化：它决定"这条是 work 还是 quality kind"，
 *   **而质量类才需要 `acceptance` / `verify`** ⇒ 少了它，"要不要给验收"就判不出来。
 */
export interface Proposal {
    /** `p-0001`（与 `e-` / `f-` 同族）。 */
    readonly id: string;
    readonly at: number;
    /**
     * ★★ 契约形式 —— **直接喂给 `create_task`**。
     * ★ `subject` / `kind` 是 t91 依 `create_task` 的**真 schema** 补的两格（见类型注释）。
     */
    readonly contract: {
        /** ★ `create_task` 里是 `required: true` —— 缺它喂不进去。 */
        readonly subject: string;
        /** ★ 与规格 §3.1 的 `EvaluatedSubject.contract.kind` 对齐（`TaskKind` 那 7 个取值）。 */
        readonly kind?: string;
        /** ★ 要改什么（一句话，可核）。 */
        readonly objective: string;
        /** ★★ 怎么算改好了（**可读真假**）。 */
        readonly acceptance: readonly string[];
        /** 机械判据（若能给）。 */
        readonly verify?: readonly string[];
        readonly inScope?: readonly string[];
        readonly outOfScope?: readonly string[];
        readonly nonGoals?: readonly string[];
    };
    /** ★★★ 以什么形态改。 */
    readonly routing: RoutingDecision;
    /** ★ 来源：哪条信号触发的（**回溯用**）。 */
    readonly from: readonly string[];
}
