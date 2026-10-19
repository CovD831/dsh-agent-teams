/**
 * ── ★★★ t91：采集模块的**产出** —— 从信号到「提案」 ────────────────────────────────
 *
 * 规格：`docs/MODULE-IO-CONTRACTS.md` §1.2 / §1.3。
 *
 * ── ★ 本文件解决什么 ─────────────────────────────────────────────────────────
 *
 * MEASURED（t91 开工实测）：`src/evolution/` 此前的输出**只到"采不采"**
 * （`CollectionDecision = boolean | undefined`）——
 * ★ **没有"该怎么改"，也没有"结论"这个产出物本身。**
 *
 * ── ★★ 而本文件**不发明第二套语汇** ───────────────────────────────────────────────
 *
 * t88 补录的那 10 条**已经在用** `routing`（`decision` 三态 + `why` + `target` + `effect`）。
 * ⇒ ★ 本文件做的是把那个**已经在用的形状显式化**，并**补齐规格要的两态**
 *   （`contract` / `unmeasured`）—— 而不是另造一套。
 * ★★ 两条口径会漂移；一套不会。
 */
import type { Proposal, RoutingDecision } from './types.ts';
/**
 * ── ★★ 提案 id 的分配 —— ★ **从调用方给的既有 id 推进**（不在这里读盘）──────────────
 *
 * ★ 为什么不在本模块里扫文件：那会**与信号流的 `nextSignalId` 变成两处口径**
 *   （而 `nextSignalId` 刚刚被实测出**一个真缺陷**：它假设了单一的 JSON 序列化格式，
 *   于是 `"id": "e-0001"`（有空格）与 `"id":"e-0001"`（无空格）**被当成两个不同序列**，
 *   `max` 从 0 起算 ⇒ **覆盖了 e-0001..e-0003**）。
 * ⇒ ★ 本函数**只做纯计算**：给它已知的最大编号，返回下一个。
 *   **I/O 由调用方负责**，于是"怎么读既有编号"只有一处实现、只有一个口径。
 *
 * @param knownMax - 已知的最大编号（没有 ⇒ 0）。
 */
export declare function nextProposalId(knownMax: number): string;
/**
 * ── ★★★ 把一份提案**变成 `create_task` 的参数**（反向半边 B 的落点）──────────────────
 *
 * ★★ 用户的第 ② 点逐字：
 * > 「我们这个插件本身就是一个任务的实施，它可以走我们本身的 Agent Team 派发任务」
 *
 * ⇒ 所以"能直接喂进去"不是修辞，是**可实测的**：本函数输出的对象
 *   **必须逐字段落在 `agent_teams_create_task` 的 schema 里**。
 *
 * ── ★★ 而这里有一处**规格缺口**（t91 实测比对真 schema 查出来的）──────────────
 *
 * `create_task` 的 schema 里 **`subject` 是 `required: true`**（逐字：
 * 「Required non-empty title…**Never omit it**…」），而规格 §1.3 的
 * `Proposal.contract` **没有 `subject`** ⇒ ★ **按字面形状喂不进去**。
 * ★ 所以那一格由 {@link Proposal.contract} 补齐（类型层已补，见其注释）；
 *   本函数只负责**原样搬运**，不在这里补默认值 ——
 *   ★ 补默认值会让"缺 subject"这件事在**这里**被藏起来，
 *     而它该在**构造提案时**就被发现（那是唯一知道"这条任务叫什么"的地方）。
 *
 * ★ 而 `routing` **不进**返回值：它是**我们的**元数据（分流依据），
 *   不是 `create_task` 的参数 —— ★ 混进去会被 `additionalProperties: false` 拒掉
 *   （t81 实测过同一形态：把内部字段 spread 进工具返回值会被 schema 打红）。
 */
export interface CreateTaskParams {
    readonly subject: string;
    readonly kind?: string;
    readonly objective: string;
    readonly acceptance: readonly string[];
    readonly verify?: readonly string[];
    readonly inScope?: readonly string[];
    readonly outOfScope?: readonly string[];
    readonly nonGoals?: readonly string[];
}
export declare function createTaskParamsOf(proposal: Proposal): CreateTaskParams;
/**
 * ── ★★ `create_task` 的 schema 里**被我们的适配器覆盖到的**字段（可机读）──────────────
 *
 * ★ 为什么把这张表**写出来**而不是只写在注释里：反向半边 B 要对拍
 *   「适配器产出的键 ⊆ schema 认的键」—— 而**一张可机读的表**才能被断言。
 * ★★ 而它**手工维护**：`create_task` 的 schema 是源码里的字面量（不是可导入的数据），
 *   所以本表**必须**与它一致 —— ★ 一旦分叉，反向半边 B 会在对拍时红。
 */
export declare const CREATE_TASK_PARAM_KEYS: readonly string[];
/**
 * ── ★★★ 反向半边 B 的**对拍器**：适配器的输出里**有没有 schema 不认的键**──────────────
 *
 * ★★ 与 t81 那次实测同一条纪律：**内部字段漏进工具返回值会被
 *   `additionalProperties: false` 打红**（那次是 `gates` 漏进了 `create_task` 的输出 schema）。
 * ⇒ 本函数把那次的事故变成**一次可跑的检查**。
 *
 * @returns 不被 schema 认的键（空数组 ⇒ 对得上）。
 */
export declare function unknownCreateTaskKeys(params: CreateTaskParams): readonly string[];
/**
 * ── ★★ 反向半边 A 的**构造器**：一条"判不了"的结论 ─────────────────────────────────
 *
 * ★★ 规格 §3.1 逐字：`unmeasured` ⇒ 「判不了（例如**"这需要产品决策"**）——
 *   **不许硬塞**」。
 *
 * ⇒ 本函数存在的理由：让"判不了"有一个**具名的构造入口**，
 *   而不是让每个调用方各自写 `modality: 'soft'` 把产品决策塞进"走软"里。
 * ★★ 而两者的**补救动作相反**：
 *   · `soft`       ⇒ 去改 prompt / profile（**我们决定了**）
 *   · `unmeasured` ⇒ 去**找人**（**我们没测出来**）
 *
 * @param why - ★ **必须说清"卡在哪一步的什么信息上"**，不许写"不知道"。
 */
export declare function unmeasuredDecision(why: string): RoutingDecision;
/**
 * ── ★★★ t4 / N2：**分流** —— 把一条信号变成一份提案（`routeSignal`）────────────────
 *
 * 这是 `docs/EVOLUTION-WIRING-GAP.md` §3 说的那个"缺的产生方"：
 *
 * ```
 * ★ t91 造了 `RoutingDecision`（五态）与 `Proposal`
 * ★★ 而没有任何路径产生过一个 Proposal
 * ⇒ ★★★ 缺的是:"把一条信号转成一个 Proposal" —— ★ 那正是【分流】那一步
 * ```
 *
 * ── ★★ 本函数是**纯函数**（不 I/O、不读盘、不抛）─────────────────────────────────
 *
 * ★ 三个理由，缺一不可：
 *   ① 它跑在**快照组装**上（`/state` 每次轮询都会走到），一次磁盘读都不该有；
 *   ② `docs/SELF-ITERATION-PLAN.md` §N2 要求"纯函数，五态，不 I/O"；
 *   ③ ★★ 纯函数才**可被逐条复现** —— 同一条信号今天与明天必须给出同一个裁决，
 *      否则"这条为什么没成提案"就变成一句无法复核的解释。
 *
 * ★★ 而"纯"的边界写清：它**不做**两件看起来该做的事 ——
 *   · 它**不**扫既有的 `proposals.jsonl` 去算 id（id 由调用方给，见 {@link nextProposalId}）；
 *   · 它**不**决定"要不要派"（那是 `docs/PLAN-REVIEW.md` 的分档闸，不是分流）。
 *
 * ── ★★★ 三态：产出了 / 判不了 / 真的没有 —— **三条路径在读数上不同形** ───────────────
 *
 * ```
 *   produced    ⇒ 产出一份 Proposal（`proposal` 在场）
 *   unmeasured  ⇒ 判不了：缺输入（没有 `record` / 消息为空 / 归类不出来）
 *                 ⇒ `decision.modality === 'unmeasured'` 且**没有** `proposal`
 *   none        ⇒ 真的没有：看过了，这条信号不该变成提案
 *                 ⇒ `decision.modality === 'none'` 且**没有** `proposal`
 * ```
 *
 * ★★ 为什么 `unmeasured` 不许并进 `none`：两者的**补救动作相反** ——
 *   `none` 是"这条不必改"（事情做完了），`unmeasured` 是"我们还不知道"（回去补输入）。
 *   并起来之后，"分流层坏了"会表现为"库里安静地没有提案" —— 而那与"确实没有提案"同形。
 *   ★ 这正是本仓记账最久的那个形态，也是本文件存在的理由。
 *
 * ★ 而第三个字段 `{ produced, proposal }` 把**同一个判断**写成两格：
 *   `produced` 是机器读的（可数），`proposal` 是给 `create_task` 的（可执行）。
 *   两格必须同时在场/同时缺席 —— 那是**同一个事实的两种形状**，不是两个判断。
 */
export interface SignalRoute {
    /** ★ 哪种形态（三态之一，与 `decision.modality` 一致地解释）。 */
    readonly outcome: 'produced' | 'none' | 'unmeasured';
    /** ★★ 分流依据 —— **无条件的**（三态都有，连 `unmeasured` 也必须说清卡在哪）。 */
    readonly decision: RoutingDecision;
    /** ★ 产出的提案（只有 `outcome === 'produced'` 时在场）。 */
    readonly proposal?: Proposal;
}
/**
 * ★ 分流需要的那部分信号形状 —— **按结构收，不按 `EvolutionSignal` 收**。
 *
 * 理由与 `propose.ts` 的既有纪律同源（`nextProposalId` 不自己扫盘）：
 * 读盘那件事已经由 `read.ts` 做完并给了 `HealthRecord`，而**这一层只做判断**。
 * ★ 而两代形状（t88 手工补录 / t87 `observe` 采集）**都要能喂进来** ——
 * 所以这里只要求**两种形状都有的那几格**。
 */
export interface RoutableSignal {
    /** ★ 信号 id（`e-0007`）—— 进 `Proposal.from`，回溯用。 */
    readonly id: string;
    /** ★ 原文，不改写（`observe` 的 `message` / t88 的 `title`）。 */
    readonly message: string;
    /** ★ 确定性来源（`source.where`）—— 分流的**第一依据**。 */
    readonly where?: string;
    /** ★ 判据 id（`source.gateId`）—— 有它时**优先于 `where`** 当靶。 */
    readonly gateId?: string;
    /** ★ 工具名（`source.tool`）。 */
    readonly tool?: string;
    /** ★ 信号三分类（`rejection` / `success` / `insight`）。 */
    readonly kind?: string;
    readonly at?: number;
}
/** ★ 分流要用的**既有读数** —— 由调用方注入（本模块不读盘）。 */
export interface RoutingContext {
    /** ★ 这一批信号的条数（**缺席** ⇒ 判不了：没有分母就算不出"占多少"）。 */
    readonly batchSize?: number;
    /**
     * ★ 每个 `(component, kind)` 桶各多少条 —— `effect` 的**指向依据**。
     * ★ 缺席时 `effect` 仍然能给（用这条信号自己的 where/kind），
     *   但 `why` 里会**如实说明**"这是按本条信号自身归的桶，不是按整批读数"。
     */
    readonly bucketCounts?: ReadonlyMap<string, number>;
}
/**
 * ★★★ **把一条信号转成一份提案** —— `propose.ts` 的产生方（t4 / §N2 第 ② 步）。
 *
 * @param signal  - 一条信号（两代形状都收，见 {@link RoutableSignal}）。
 * @param knownMax - 既有提案的最大编号（★ 由调用方给：本模块**不读盘**）。
 * @param context - 分流要用的既有读数（**可选** —— 缺席时 `why` 会如实说明口径）。
 * @returns 三态之一（见 {@link SignalRoute}）。★ **从不抛**：一条坏信号不许让整批消失。
 */
export declare function routeSignal(signal: RoutableSignal, knownMax: number, context?: RoutingContext): SignalRoute;
/**
 * ★★ 一整批信号的分流读数 —— **三态各有一格计数，且不是同一个数**。
 *
 * ★ 为什么要有这个（而不是让调用方自己数）：三态若在调用点各数一遍，
 *   它们会分叉（本仓记账最贵的那类缺陷）。⇒ 聚合只有这一处实现。
 *
 * ★★ 而 `unmeasured` 那一格**必须**能说清"卡在哪"：`reasons` 是
 *   每条 `unmeasured` 的 `why`（去重后按出现次数降序）—— ★ 一句"3 条判不了"
 *   若说不出是哪三类的什么信息缺了，它就只是一句噪音。
 */
export interface RoutingReadout {
    /** ★ 这批一共看了几条（**分母**：没有它，"产出了 2 条"说不出比例）。 */
    readonly total: number;
    /** ★ 产出了提案的条数。 */
    readonly produced: number;
    /** ★ 真的不必改的条数。 */
    readonly none: number;
    /** ★ 判不了的条数（★ 与 `none` **不同形**）。 */
    readonly unmeasured: number;
    /** ★ 五态各自的条数（`modality` 逐格，含恒为 0 的 `soft` —— 缺格会被读成"没算"）。 */
    readonly byModality: Readonly<Record<RoutingDecision['modality'], number>>;
    /** ★ 产出的提案（按 `from` 里的信号 id 可回溯）。 */
    readonly proposals: readonly Proposal[];
    /** ★★ 判不了的**原因清单**（去重 + 计数）—— 说不出原因的 `unmeasured` 不算读数。 */
    readonly unmeasuredReasons: readonly {
        readonly why: string;
        readonly count: number;
    }[];
}
/**
 * ★ 分流一整批 —— `routeSignal` 的批处理面（**纯函数**，同一条纪律）。
 *
 * @param signals - 一批信号（顺序即 id 分配顺序 ⇒ 可复现）。
 * @param knownMax - 既有提案的最大编号（★ 由调用方给）。
 * @param context - 可选读数。
 */
export declare function routeSignals(signals: readonly RoutableSignal[], knownMax: number, context?: RoutingContext): RoutingReadout;
