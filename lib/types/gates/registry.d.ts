/**
 * ── 判据注册表 ────────────────────────────────────────────────────────────────
 *
 * 契约见 `docs/GATE-REGISTRY.md`。本文件**只做三件事**：register / evaluate / list。
 * 它**不含任何判据** —— 判据在 `gates/<point>/<id>.mjs`，一个判据一个文件。
 *
 * ── 为什么要有它 ──────────────────────────────────────────────────────────────
 *
 * 上游把判据全放在一个 1233 行的文件里（34 个导出平铺）。想加一条判据就必须改
 * 那个文件 ⇒ 它一升级就冲突，而开发流程会变 ⇒ 冲突会反复发生。
 *
 * ⇒ 判据挪进注册表；编排层只认【插入点】，不认判据。
 *
 * ── 三个设计决定，都是为了"可插拔" ───────────────────────────────────────────
 *
 * ① 注册表【不认识】任何判据的名字与语义 —— 它只按 point 分组、按序求值。
 *    ⇒ 加/删判据不改编排，也不改本文件。
 *
 * ② 裁决有【三态】而不是两态：ok / blockers / unmeasured。
 *    上游只有两态，而两态正是我们今天验证过的漏洞的同源 —— 一个返回空回复的
 *    审查落进 "ok: true"，读起来像"审查通过、没发现问题"。
 *    ⇒ 判据必须能说"我没能测量"，而它与"我测了没问题"必须不同形（§3.4）。
 *
 * ③ 求值【不短路】：一条判据失败后继续跑其余的，收集全部 blocker。
 *    上游是遇错即返回（`return { ok:false, error }`）⇒ 修一个再跑又冒出一个。
 *    实测代价（2026-10-05）：`grep -qx 7` 与「绝对路径」是两个独立问题，
 *    串行发现花了三轮。 ⇒ 一次给全。
 */
/**
 * 一条判据的裁决。**三态，不是两态。**
 *
 *  - `{ ok: true, ...产出 }`              —— 测了，没问题（可附带给出的结果）
 *  - `{ ok: false, blockers: [...] }`     —— 测了，发现问题
 *  - `{ ok: false, unmeasured: string }`  —— ★ 没能测量
 */
export type GateVerdict = {
    ok: true;
    [produced: string]: unknown;
} | {
    ok: false;
    blockers: string[];
} | {
    ok: false;
    unmeasured: string;
};
export type InsertionPoint = typeof INSERTION_POINTS[number];
/**
 * ── ★ 输入面：核对结果（旁路字段，t6）──────────────────────────────────────────
 *
 * 见 `requires.ts` 的文件头。要点只有一句：**它不参与裁决**。核对结果挂在这里，
 * 与 `observed` 平级 —— 因为观察模式（决定"裁决算不算数"）与输入面核对（决定
 * "这条判据要的那一格接没接上"）是**两个不同的问题**，合流会让"判据开火了"
 * 与"判据根本没被喂饱"在日志里同形。
 *
 * ★ 恒在场（空即空），与 `observed` / `outputs` 同一纪律：调用方不必写
 *   `?? { checked: 0 }`。而"一个位置一条判据都没核对到"与"核对过、都齐"不同形
 *   —— 差别在 `checked` 与 `skipped` 两个可读的计数上。
 */
export interface RequiresAuditFieldView {
    checked: number;
    incomplete: number;
    skipped: number;
    /**
     * ── ★ `skipped` 的两种成因，分开数（t11）─────────────────────────────────────
     *
     * `notApplicable <= skipped`，其余落在 `inputSurfaceAbsent` / 未声明上。
     * ★ 只读 `skipped` 的调用方读不出"11 条都按设计闭嘴"与"11 条都因为一格没接而
     *   静默跳过"的区别 —— 而那正是 t11 要修的那件事，所以这两个计数必须都能读到。
     */
    notApplicable: number;
    inputSurfaceAbsent: number;
    /** 缺了格子的（接线缺陷）人话清单。 */
    missing: string[];
    /** ★ 声明缺口的人话清单（`appliesTo` 读了、`requires` 没声明）—— 与 `missing` 不同形。 */
    gateCellsUndeclared: string[];
    checks: ReadonlyArray<{
        id: string;
        status: 'ok' | 'incomplete' | 'skipped';
        missing: string[];
        present: string[];
        skippedBecause?: string;
        /** ★ `'skipped'` 的成因（t11）；`status === 'skipped'` 时恒在场。 */
        skipReason?: 'not-applicable' | 'input-surface-absent' | 'undeclared' | 'caller';
        /** `appliesTo` 实测读到的、且在 `requires` 里声明了的格子。 */
        gateCells?: string[];
        /** `appliesTo` 读了、而 `requires` 没声明的格子（声明缺口）。 */
        gateCellsUndeclared?: string[];
        undeclared?: string;
    }>;
}
export interface GateRunEntry {
    id: string;
    verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped';
    count?: number;
    produced?: boolean;
    /**
     * ── ★ 这条判据【开火了，但裁决没有被采纳】（观察模式）────────────────────────
     *
     * 只在「判据交出了 blocked / unmeasured，而它处在观察模式」时为 `true`。
     * 其余情形【缺席】—— 尤其：`ok` 的判据在观察模式下**不产出这个字段**。
     *
     * ★ 为什么不能只靠 `verdict` 表示：观察模式下这条判据的 verdict 仍是
     *   `'blocked'`（它确实发现了问题，这件事本身是真的），而整体 `ok` 仍是
     *   `true`（裁决没有被采纳）。**只读 verdict 的调用方会以为流程被拒了，
     *   只读 ok 的调用方会以为这条判据温和。** ⇒ 必须有第三个字段说清
     *   "它开火了，而它的裁决被按观察模式放过了"。
     *
     * ★ 为什么与 `verdict: 'skipped'` 不同形：跳过是"判据根本没跑"
     *   （`appliesTo` 为假），这里是"跑了、开火了、被放过"。两者在日志里
     *   都是"没有拦住流程"，但成因与责任完全不同。
     */
    observed?: boolean;
}
export interface GateEvaluation {
    ok: boolean;
    blockers: string[];
    unmeasured?: string;
    ran: GateRunEntry[];
    outputs: Record<string, Record<string, unknown>>; /**
     * ── ★ 这一步【真的跑了】几条判据 ──────────────────────────────────────────────
     *
     * 该位置挂了【至少一条】判据、但全部被 `appliesTo` 跳过时，本字段是 `0`。
     *
     * ★ 为什么必须有它（MEASURED，2026-10-05）：
     *
     *     ① kind=work、这一轮不试图完成 ⇒ `{ok:true, blockers:[]}`  ran=[全部 skipped]
     *     ② 判据跑了且都通过             ⇒ `{ok:true, blockers:[]}`  ran=[都有裁决]
     *
     *   **返回对象在 `ok` 这一字段上完全一样。** 只读 `r.ok` 的调用方读不出
     *   "一条都没跑"。信息其实还在 `ran` 里，但 `ok` 是那个会被人读、会被 `if`
     *   判的字段 —— 一处未来忘了传 `wantsCompleted` 的重构，就会让四条判据静默
     *   全跳过，而门禁返回 `ok: true`。**跳过的代价与失败的代价不同，输出却相同。**
     *
     * ★ 与 `unmeasured` 的区别（刻意不让它们合流）：
     *
     *     `unmeasured` —— 判据【跑了】，但它说"我测不了"。这是关于**测量**的结论。
     *     `evaluated:0` —— 判据【根本没跑】。这是关于**这一步有没有被检查**的结论。
     *
     *   ★★ 而上面那段论证（"把后者的整体裁决翻成 `ok:false` 是错的"）在本条 t58 里
     *      被**修正了一半**，理由如下 —— 修正的是**把两种 `evaluated:0` 合流**这个错误：
     *
     *        空位置（`registered === 0`）          ⇒ **仍然是 `ok`**  ← 那段论证是对的
     *        挂了判据却全跳过（`registered > 0`）   ⇒ **`unmeasured`**  ← 那段论证把它漏了
     *
     *      MEASURED（2026-10-07，t58；缺口先于本任务存在）：`registered > 0 && evaluated === 0`
     *      在真实注册表上意味着 integration / verification / review 三类任务**永远报 ok**
     *      （实测 `ok=true, evaluated=0, skipped=4, registered=4`）—— 而 `implementation`
     *      是 `ok=false, evaluated=1`。⇒ 那 5 个 kind 的完工位置**从来没有被检查过**，
     *      而日志留给读的人的是一个 `ok`。
     *
     *   ★ 那段论证真正的适用范围是**空位置**：一个还没接判据的位置读成异常，
     *     会让每个空位置都像出了问题。而**"挂了判据、一条都没跑"不是那个情形** ——
     *     它是"这里本来该有检查，而这一轮一条都没说话"。把它报成 ok，就是
     *     把"没测到"并进"通过"（契约 §3.4 明令禁止的那条合流）。
     *
     *   ★ 所以：`evaluated` 仍然是那个**可读的计数**（它没有被删掉，调用方仍可读），
     *     但**裁决**现在与它一致了 —— 不再要求每个调用方都记得去读旁边那一格。
     */
    evaluated: number;
    /** 该位置这一轮被 `appliesTo` 跳过的条数（`evaluated + skipped` 即本次涉及的判据总数）。 */
    skipped: number;
    /**
     * 该位置【挂了】几条判据（与上下文无关）。
     *
     * ★ `registered === 0`（空位置）与 `registered > 0 && evaluated === 0`（全跳过）
     *   必须【不同形】—— 前者是"这里还没有判据"，后者是"有判据却一条没跑"。
     *   把这两件事混起来，一次静默全跳过就会伪装成"这个位置本来就没判据"。
     */
    registered: number;
    /**
     * 该位置【有判据、却一条都没跑】时的一句人话；其余情形缺席。
     *
     * ★ 与 `unmeasured` 同属"没测到"，但不同形（见上）：这里说的是"判据没跑"，
     *   不是"判据跑了说测不了"。空位置【不产出】它 —— 那是正常情形，不是异常。
     */
    skippedAll?: string;
    /**
     * ── ★ 观察模式：这一轮有几条判据【开火了，而裁决被放过】───────────────────────
     *
     * 只在至少一条观察中的判据开火时出现，且恒 `> 0`；其余情形缺席（对照臂钉住
     * "都通过"那条路径不得产出它）。
     *
     * ★ 分布与 `observed` 的关系：整份清单（`observedGates`）是"**配置**说谁在观察"，
     *   本字段是"**这一轮**谁真的开火了"。两者必须都能读到：
     *
     *     ① 观察中但没开火   —— 清单里有它，本计数不含它（它没说话）
     *     ② 观察中且开了火   —— 两者都有（这是"放过了一条真实发现"，要曝光）
     *     ③ 没观察、开了火   —— 清单里没有，本字段也不含它（它已经被采纳，流程被拒）
     *
     *   把 ①②③ 合成一个"有没有在观察"的布尔值，正是本队反复见过的合流形态。
     */
    observedBlockers?: number;
    /**
     * ── ★ 开火了、被观察模式放过的那些裁决【原文】─────────────────────────────────
     *
     * 与 `blockers` / `unmeasured` 的关系是刻意的：被放过的裁决**不并进**那两个字段
     * （并进去就等于它进了裁决，而观察模式的定义就是"不进裁决"），但也**不许丢**
     * —— 它是一条真实的发现，只是暂时没有否决权。丢掉它，观察期就变成了"什么都
     * 看不见"，那时候没人能从日志里决定"这条判据该不该开火"。
     */
    observed: {
        /** 被放过的 blocker，形状与原 blocker 一样（带 `[判据 id]` 前缀）。 */
        blockers: string[];
        /** 被放过的"没能测量"，形状与原 unmeasured 一样。 */
        unmeasured: string[];
    };
    /**
     * ── ★ 输入面核对结果（t6）：这条判据要的 ctx 路径，真实 ctx 上接没接上 ──────────
     *
     * **恒在场**；**只增不改**：它不进 `ok` / `blockers` / `unmeasured`（除硬化时，
     * 见 `RequiresAuditPolicy`），也不改 `evaluated` / `skipped` / `registered`
     * 任何一个计数。`observed` 与它必须能分别读出来：
     *
     *   · 判据开火了、而它的输入面是齐的  ⇒ `observed.blockers` 非空，`requires.incomplete === 0`
     *   · 判据开火了、而它要的一格没接上  ⇒ 两者都非空（**这一条才是本轮要抓的形态**：
     *     "判据说它测不了"与"这一格没接线"在旧的输出里同形）
     *   · 判据根本没跑（不适用）          ⇒ `requires.skipped` +1，**不报缺失**（不制造噪音）
     *
     * ★ 为什么不放进 `ran[]`：那会改一条既有数组的形状（`ran` 的读者在做等价断言），
     *   而本轮的第一条硬约束是"不改任何现有判据的裁决行为"。旁路字段是唯一
     *   零风险的位置，也是"先软后硬"的字面落点。
     */
    requires: RequiresAuditFieldView;
}
/**
 * 六个【位置】，不是六个判据。一个位置可挂零到多条。
 *
 * ── ★ `admission`：成团【之前】的那一个位置（t5 加）────────────────────────────
 *
 * 在此之前，五个位置**全部在成团之后** —— 它们判的都是"已经决定要做之后，这一步
 * 做得对不对"。而这一段是零覆盖的：
 *
 *     ① 产物存在（需求 / 计划文档）
 *          ↓
 *     ② 触发对抗性审查（子代理，异步，干净上下文）
 *          ↓
 *     ③ 主会话【吸收】：判断采纳哪些、不采纳哪些
 *          ↓
 *     ④ 吸收 ⇒ 产物被改动
 *          ↓
 *     ⑤ 改动了 ⇒ 要不要再审？ ── 回到 ②
 *
 * ★ 为什么不复用 `contract`（这是这个位置存在的全部理由）：
 *
 *     `contract`  判的是：inScope 声明得对不对、verify 命令可不可判
 *     `admission` 判的是：需求 / 计划够不够格进场（有产物、审过了、没有待确认问题）
 *
 *   ⇒ 一个在"已经决定要做"【之后】，一个在"还没决定要不要做"【之前】。
 *     把两者合成一个位置，会让两类缺陷在日志里同形 ——
 *     "这个契约写得不合法"与"这份需求根本不该进场"读起来一模一样，
 *     而它们的补救动作完全不同（改契约 vs 回去接着聊）。
 *
 * ★ 顺序：它是 `INSERTION_POINTS` 的**第一个**元素，也是流程上的第一个位置
 *   （其余五个的相对顺序一字未动）。位置数组的顺序是给控制台与普查读的
 *   （`list()` 的键序、`gateRoutes()` 的遍历序），**不是**流程顺序的判据 ——
 *   流程顺序由调用方决定，注册表不认识它。
 */
export declare const INSERTION_POINTS: readonly string[];
/**
 * 一条判据的裁决。**三态，不是两态。**
 *
 *  - `{ ok: true }`                        —— 测了，没问题
 *  - `{ ok: false, blockers: [...] }`      —— 测了，发现问题（必须说清为什么）
 *  - `{ ok: false, unmeasured: string }`   —— ★ 没能测量
 */
export declare function ok(): {
    ok: true;
};
export declare function blocked(...blockers: Array<string | string[]>): {
    ok: false;
    blockers: string[];
};
export declare function unmeasured(reason: string): {
    ok: false;
    unmeasured: string;
};
/**
 * 一个注册表实例。判据按 point 分组，组内按注册顺序求值（顺序稳定，便于复现）。
 */
export interface GateRegistration {
    id: string;
    point: InsertionPoint;
    description: string;
    appliesTo?: (context: any) => boolean;
    gate: (context: any) => GateVerdict | Promise<GateVerdict>;
    /**
     * ── ★ 输入面声明（t6）：这条判据需要 ctx 上的哪些路径 ───────────────────────────
     *
     * **类型的来源是判据自己的 ctx 类型**，不是手写字符串：
     *
     * ```ts
     * export const requires: CtxPaths<RuntimeLivenessContext>[] = ['event', 'wait', 'waits', 'task']
     * //                                                             ↑ 'event.typo' ⇒ TS2322
     * ```
     *
     * ★ 缺席与空数组**不同形**（核对层分别给 `undeclared` 与 `ok`）：缺席是
     *   "这条判据的输入面还没有被声明"（本轮要逐步消灭的东西），`[]` 是"它不需要
     *   任何一格"。合成一个会让接线覆盖率的读数虚高。
     *
     * ★ 注册时**不做类型校验**（运行时不认识类型）：一份拼错的路径能不能过，
     *   由 `tsc` 回答（`pnpm typecheck`）；这里只校验它是个字符串数组，
     *   因为 `requires: 'wait.now'` 这种形状会让核对层去逐字符切路径，报出一堆
     *   谁也没写过的格子。
     */
    requires?: readonly string[];
}
/**
 * ── ★ 观察模式（observe-only）：新判据先只记录、不拒绝 ─────────────────────────
 *
 * 由来（t9，契约 §3.5）：**判据误伤的代价比漏报更贵。** 一条写错的新判据若
 * 立刻有否决权，会把真实任务卡死；而"被门禁坑过"的人学到的不是"这条判据要修"，
 * 是"门禁可以忽略"—— 此后所有判据都白装。本队已经见过这个形态（棘轮断言在成功
 * 路径上报错）。
 *
 * ⇒ 新判据可以先**进来观察**：照常求值、照常记录，但裁决不阻止流程；确认它不误伤
 *   之后再把它移出观察集。
 *
 * ── 三条设计决定 ─────────────────────────────────────────────────────────────
 *
 * ① **缺省 = 今天的行为**（有否决权）。观察必须**显式选择加入**：漏读一个字段的
 *    结果是"判据正常把关"，而不是"判据悄悄失效"。一个默认放宽的开关会让
 *    "配置丢了"与"判据通过了"在日志里同形 —— 而那正是本注册表存在的理由。
 *
 * ② **开关不需要改代码**：观察集是**运行时数据**（`observe(id)` / `unobserve(id)`），
 *    不是注册字段。关掉观察只是 `unobserve(id)` 一次调用 —— 没有 code change，
 *    也就没有"改代码 → 漏了 build → 装的位置跑的是旧代码"那条窗口（本队实测过）。
 *    ★ 且它**不是** `appliesTo`：把一条判据"观察着"写成 `appliesTo: () => false`
 *      会让它【根本不跑】，于是观察期什么都看不见，而"观察"与"跳过"同形。
 *
 * ③ **开火与没跑不同形**：被放过的裁决进 `observed`，不进 `blockers`/`unmeasured`
 *    （否则它就进了裁决）；同时 `ran[].observed === true` 与
 *    `evaluation.observedBlockers` 让"开火了但被放过"可被计数。它与
 *    `verdict: 'skipped'`（判据没跑）在形状上不同。
 */
export interface ObserveOptions {
    /** 观察期说明（为什么这条判据先进来观察）；会被 `list()` 渲染出来。 */
    reason?: string;
}
/**
 * 观察名单的环境变量名：逗号分隔的判据 id。
 *
 * ★ 为什么给一个环境变量入口：**"不改代码就能开关"**是这条需求的原话，而一个只有
 *   代码内部能调的 `observe()` 只满足了一半 —— 关掉观察仍然要有人写一行代码、
 *   重新 build。环境变量让"把这条判据从观察里放出来"是一次部署改动。
 *
 * ★ 它**只增不减**：环境变量能往名单里【加】id，绝不能把已经显式观察的判据
 *   移出去（一个"环境变量没设 ⇒ 全部有否决权"的读法会让线上与本地跑出两套
 *   不同的门禁，而两者的日志同形）。关掉观察用 `unobserve(id)`。
 *
 * ★ 空串/全空白 ⇒ 等价于没设：一个空的环境变量不是"有人在观察"，也不许被读成
 *   任何裁决上的放宽。这是"缺省不放宽"的一部分，所以它有一条专门的臂。
 */
export declare const OBSERVE_GATES_ENV = "AGENT_TEAMS_OBSERVE_GATES";
/** 解析环境变量里的观察名单（导出以便夹具钉住解析规则本身）。 */
export declare function observeIdsFromEnv(value: string | undefined): string[];
export declare function createGateRegistry(options?: {
    readonly observeFromEnv?: string | undefined;
    readonly enforceRequiresFromEnv?: string | undefined;
}): {
    /**
     * 注册一条判据。
     * ★ 重复 id ⇒ 抛错，**不静默覆盖** —— 静默覆盖会让"我换了一条判据"
     *   与"两条判据都在、后一条赢了"在日志里同形。
     */
    register(registration: GateRegistration): GateRegistration;
    unregister(id: string): boolean;
    /**
     * ── ★ 让一条判据进入观察模式（显式选择加入）─────────────────────────────────
     *
     * 关掉它用 `unobserve(id)`：**开关是运行时调用，不需要 code change**。
     *
     * ★ 为什么对未注册的 id 也接受（且不抛错）：观察集是**配置**，而配置可能比
     *   注册表先就位。把顺序耦合起来会造出"配置写得对、只是加载早了一步"这种
     *   只在特定装配顺序下出现的缺陷。控制台读 `observingIds()` 就能看出
     *   "名单里有一个当前没注册的 id"。
     *
     * ★ 但它**不是静默的**：返回一个可读的结果，让调用方能区分
     *   "已注册、现在开始观察"与"名单里记下了、而这条判据还没注册"。
     */
    observe(id: string, options?: ObserveOptions): {
        id: string;
        registered: boolean;
        reason: string;
    };
    /** 结束观察：这条判据的裁决立刻恢复阻止流程。返回它此前是否在观察中。 */
    unobserve(id: string): boolean;
    /** 这条判据当前是否处在观察模式（缺省 false —— 即今天的行为）。 */
    isObserving(id: string): boolean;
    /**
     * 当前观察名单（含尚未注册的 id）。控制台读它。
     *
     * ★ 读它与读 `isObserving` 都【不改裁决】—— 它是一份**配置视图**，
     *   而"谁这一轮真的开火了"是 `GateEvaluation.observed`。两者不同形是刻意的。
     */
    observingIds(): Array<{
        id: string;
        reason: string;
        registered: boolean;
    }>;
    /**
     * 控制台读它。按 point 分组，组内保持注册顺序。
     *
     * ── ★ `appliesTo` 是【函数本身】，不是"有没有"（t10）──────────────────────────
     *
     * MEASURED（2026-10-06，t10 第一版）：清单最初只报 `hasAppliesTo: boolean`。
     * 而编排层的**输入面核对**必须知道"这一轮每条判据适不适用"，且必须与注册表
     * 求值时调的是**同一个函数**（另写一份判断会让两套口径分叉，分叉之后
     * "注册表跳过了它、核对却报了缺失"这种自相矛盾的结论就会出现 —— 而它在
     * 日志里与正常情形同形）。
     *
     * ⇒ 清单里多一个 `appliesTo` 字段。★ 它**不改变控制台的读法**
     *   （`hasAppliesTo` 一个字节没动），只是让"这个函数是谁"也能被读到。
     *   一份只有"有没有"的视图，会逼核对层去别处找第二份真相 —— 而那正是
     *   本轮从头到尾在消灭的形状。
     */
    list(): Record<InsertionPoint, Array<{
        id: string;
        description: string;
        hasAppliesTo: boolean;
        appliesTo?: (context: any) => boolean;
        observing: boolean;
        observeReason?: string;
        requires?: readonly string[];
        hasRequires: boolean;
    }>>;
    /** 该位置已注册的判据条数（控制台/测试用）。 */
    count(point: InsertionPoint): number;
    /**
     * 跑某个位置的全部判据并合并裁决。**不短路** —— 收集全部 blocker。
     *
     * ★ 合并规则（语义的一部分，见契约 §3）：
     *     任何一条 unmeasured  ⇒ 整体 unmeasured（未测量优先于通过）
     *     否则任一条 blockers  ⇒ 整体 blockers（全部收集）
     *     否则                 ⇒ ok
     *
     * ★ 为什么 unmeasured 优先：一条判据说"我发现问题"是一个测量结果，可以据此
     *   行动；一条判据说"我没测成"意味着【其余判据的通过也不可信】。后者更重。
     *
     * ★ 为什么非法的裁决形状要抛错而不是忽略：一个形状错误的裁决（比如返回
     *   `{ok:false}` 却不说原因）如果被当成通过，那这条判据就是【装上了但没生效】
     *   —— 那比没装更坏，因为它会让人以为检查过了。
     */
    evaluate(point: InsertionPoint, context: unknown): Promise<GateEvaluation>;
};
