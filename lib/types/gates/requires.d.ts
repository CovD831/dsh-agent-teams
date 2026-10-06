/**
 * ── 判据的输入面：路径类型 + 核对 ──────────────────────────────────────────────
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-06，上一轮的根因复盘）：11 条判据的**输入面每一格都是手工
 * 单独接的**，而五次同形缺陷全部落在这一格上：
 *
 *     inScope 缺席 → verify 缺席 → 执行器缺席 → event 名不匹配 → 窗口表没接线
 *
 * 五次都不是判据本身写错，而是**判据要的那一格 ctx 没接上**。而这类缺陷有一个
 * 共同形状：判据照常跑、照常说话，只是它说的是"我没能测量" —— 在日志里与
 * "这一步没问题"同形。只要输入面还是逐格手接，第 6 次一定会来。
 *
 * ⇒ 两层，声明 + 实测：
 *
 *     B 层（编译期，本文件上半）：判据声明 `requires`（它需要哪些 ctx 路径），
 *        路径用 **TS 字符串字面量类型**表达 ⇒ 拼错的路径在编译期就是 TS2322。
 *     A 层（运行时，本文件下半）：evaluate 之前按 `requires` 核对**真实 ctx**，
 *        把"这条判据这一格接没接上"变成一次机械核对，而不是人眼审查。
 *
 * ── 三层不同的东西，不许合流（本队反复见过的合流形态）───────────────────────────
 *
 *   ① 拼错的路径（`wait.typo`）—— 编译期就报错。它**不是**一条运行时数据。
 *   ② 声明了但这一格没接（`wait.now` 在做，而 ctx 里没有 `wait`）—— **运行时**核对。
 *   ③ 声明了、接了、但判据自己决定不说话（`appliesTo` 为假）—— **不适用，不报**。
 *
 * ★ 三者必须不同形：把 ① 并进 ② 会让一次拼写错误伪装成"调用方没接线"；
 *   把 ③ 并进 ② 会让"这个位置这一轮本来就没有适用判据"（正常情形，11 条判据
 *   × 8 个调用点里大部分组合都是这样）变成一片噪音 —— 而噪音会教人忽略门禁，
 *   与误报同样有害。
 *
 * ── ★ 先软后硬：核对【不拒绝】任何东西 ──────────────────────────────────────────
 *
 * 本文件只**产出一份核对结果**（{@link RequiresAudit}），它挂在求值结果的
 * `requires` 字段上（与 `observed` 平级，旁路）。它【不】改 `ok` / `blockers` /
 * `unmeasured` 任何一个字节 —— 一个自己还没被验证过的新机制，没有资格当场否决
 * 别人的任务（这正是本队"判据误伤的代价比漏报更贵"那条的同一个形态）。
 *
 * 硬化的开关必须**显式**，且**关得掉**：{@link createRequiresAuditPolicy}。
 * 缺省方向是"只看不说"—— 漏读一个字段的结果是"核对照常记录"，不是"核对悄悄失效"，
 * 也不是"流程被一个还没验证的机制卡死"。
 *
 * ── ★ 路径用的是【类型】，不是字符串列表 ────────────────────────────────────────
 *
 * 用户已裁定形状：`requires: ['wait.typo']` 这种**字符串路径**写错了没人会知道
 * （它要到运行时才发现，而且只在那条判据开火时才看得见）。改成类型层之后：
 *
 *     requires: ['wait.typo']   ⇒ TS2322  ✗ 编译期就红
 *     requires: ['wait.now']    ⇒ 通过    ✓
 *
 * 成本比预想低：ctx 类型**已经存在**（8 个 interface 散在各判据文件里，都已导出），
 * 本文件只提供把它们展开成路径联合的 {@link Paths}。
 */
/** 展开深度上限：ctx 类型最深到 ctx.team.profile.protocol（3 层），留一层余量。 */
type Prev = [never, 0, 1, 2, 3];
/**
 * ── ★ 两个"能不能往下展开"的守卫，各自都被实测打回过一次 ────────────────────────
 *
 * 它们要回答的是同一个问题的两半：**这个类型的成员是不是字段**。
 *   · `IsIndexBag`   —— 带**索引签名**的袋子（`Record<string, unknown>`、`Set`、
 *                        `Map`…）：它的成员是"任意字符串键"，展开出来的是
 *                        `'x.anything'` 这种没有意义的路径。
 *   · `HasNoMembers` —— 一个键都没有：展开出来空无一物。
 *
 * ★ 一个看起来更短、**实测更坏**的写法是 `Record<string, unknown> extends T`
 *   （"这个类型是不是一个袋子"）。它把**可选字段**误判成袋子：`{ wait?: {...} }`
 *   的每个成员都可选 ⇒ `Record<string, unknown>` 可以赋给它（TS 的结构兼容忽略
 *   可选性）⇒ 整份联合塌成兜底那一支 `''`。实测输出：
 *
 *     { v?: string }        ⇒ "是袋子" = true   ✗ 于是该类型的路径一条都留不下
 *     { v: string }         ⇒ "是袋子" = false  ✓
 *     { y?: { z: number } } ⇒ Paths = '""'      ✗ 本该是 '"y" | "y.z"'
 *
 *   ⇒ 而判据的 ctx 类型**全是可选字段**，那个守卫在它上面恰好恒为真：
 *     一个"看起来没报错、实际把所有路径都吃掉"的守卫。修法是换判据 ——
 *     问"字符串能不能索引到确定的类型"（`string extends keyof T`），它对具体
 *     对象类型恒为假、对索引签名恒为真，**与可选性无关**。
 */
type IsIndexBag<T> = string extends keyof T ? true : false;
/** 一个键都没有的类型（展开出来空无一物）。 */
type HasNoMembers<T> = keyof T extends never ? true : false;
/**
 * 把类型 `T` 展开成它的**点分路径联合**。
 *
 * ```
 * Paths<{ a?: { b?: number }; c: string }>
 *   ⇒ 'a' | 'a.b' | 'c'
 * ```
 *
 * ── 四条设计决定（每一条都对着一个真实会踩的坑）──────────────────────────────
 *
 * ① **叶子与分支都进联合**（`'a'` 与 `'a.b'` 都在）。判据常常需要的是"这一格
 *    整个在不在"（`requires: ['wait']` ⇒ `wait` 缺席就是没接上），而不是它的每
 *    一个子字段。只给叶子会让这条判据只能写成 `['wait.now']` 那一组，于是
 *    "整个观察面缺席"与"观察面在、只是少一个读数"就分不出来了 —— 而这两件事
 *    在诊断上恰恰不同形（见 liveness 判据的 `missing` 列表）。
 *
 * ② **可选字段与必填字段【一样展开】**。`wait?: {…}` 在 `keyof` 里照样出现，
 *    把它当普通字段展开就得到 `'wait' | 'wait.now' | …`。曾经在这里写过一个
 *    "是不是可选"的守卫，它把整份联合弄塌了（见上面那段实测记录）——
 *   而修法不是修那个守卫，是承认**展开与可选性无关**。
 *
 * ③ **空对象 `{}` 展开成 `''`（空串）**，不是 `never`。TS 里 `never` 会让整个
 *    联合塌成 `never`，于是**任何**路径都会报错 —— 一个恒红的类型断言会逼人把它
 *    关掉，那时它连"拼错路径"这一件事都保不住了。空串是一个合法字面量：它排除了
 *    所有真实路径，而报错信息仍然是可读的。
 *
 * ④ **`Date` / 数组 / 函数 / 带索引签名的袋子不再往下展开**（叶子）。
 *    跟进去会产出 `'members.0'`、`'members.length'` 这种没有意义的路径，
 *    而噪音会让整份联合失真 —— 判据要的是 `'members'`（整份观察面在不在）。
 *
 * ⑤ **一个键都没有的类型**（`{}`、`never` 的成员）也落在 ③ 那一支，理由同上。
 *    ③ 与 ⑤ 合起来读作一句话：**每个分支都必须留下至少一个能过的东西**，
 *    否则这个工具就从"抓拼写"变成"什么都抓"。
 *
 * ★ 深度用 `Prev` 递减到 `never` 那一支自然截断；ctx 里没有循环引用，但一个
 *   "展开深度"的显式上限让这个类型不会因为将来某条判据写了个自引用类型而
 *   把 tsc 拖死（TS 对此只会报 "excessively deep"）。
 */
/** 展开体。★ 名字与 {@link Paths} 分开不是装饰 —— 见下面那段实测记录。 */
type PathsOf<T, Depth extends 0 | 1 | 2 | 3> = [Depth] extends [never] ? never : T extends string | number | boolean | bigint | symbol | null | undefined ? never : T extends readonly unknown[] ? never : T extends (...args: never[]) => unknown ? never : T extends Date ? never : IsIndexBag<T> extends true ? '' : HasNoMembers<T> extends true ? '' : {
    [K in keyof T & string]: K | `${K}.${PathsOf<T[K], Prev[Depth]>}`;
}[keyof T & string];
/**
 * ── ★ 一个类型别名，**两个名字**：这不是风格，是实测出来的必须 ──────────────────
 *
 * MEASURED（2026-10-06，本文件的第一版）：把展开写成**一个自引用的类型别名**
 *
 *     type Paths<T, Depth = 3> = … { [K in keyof T & string]: K | `${K}.${Paths<T[K], Prev[Depth]>}` }[…]
 *
 * 在**推断位置**（`const x: Paths<Ctx>[] = ['wait.now']`、`Exclude<Paths<T>, ''>`）
 * 表现正常；但只要它被**别名**（`type A = Paths<O>`，`CtxPaths<T>` / `Requires<T>`
 * 内部就是这么用的），tsc 保留的是一条【延迟】求值的别名，而下游对它做键集运算
 * （`T[K]`、`Exclude`）时读到的是它的**声明**而不是它的**展开** —— 实测结果是
 * 整份联合塌成兜底那一支 `''`：
 *
 *     type O = { y?: { z: number } }
 *     Paths<O>              ⇒  '""'        ✗ 本该是 '"y" | "y.z"'
 *     Paths<O, 2> 直接内联  ⇒  '"y" | "y.z"' ✓
 *     CtxPaths<O>           ⇒  never       ✗ 于是【任何】路径都报 TS2322，包括对的
 *
 * ★ 它坏起来正是本队反复见过的形态：**恒红的断言**。每个 `requires` 都报错，
 *   于是人学会的不是"路径写错了"，是"这个检查没法用、把它注释掉"——那时它连
 *   拼错路径这一件事都保不住了（与"恒真的断言"同一个反面）。
 *
 * ★ 修法两半，缺一不可：
 *   ① 展开体只有一条（`PathsOf`），`Paths` 是它的**一层直接别名**，不再自引用；
 *   ② 那些要在下游做键集运算（`Exclude`）的类型，改用**内联展开体**而不是
 *      `Paths`（见 {@link CtxPaths}）：一次内联的求值不发别名，读到的就是真值。
 *   这两半各自都被一条臂钉住（`scripts/gate-requires.test.mjs` 臂 7/臂 8）。
 */
export type Paths<T, Depth extends 0 | 1 | 2 | 3 = 3> = PathsOf<T, Depth>;
/**
 * 一条判据的核对结论。**三态，不是两态** —— 与判据裁决同源的那条纪律。
 *
 *   · `'ok'`          —— 核对过，声明的每一格都在场
 *   · `'incomplete'`  —— 核对过，缺了至少一格（`missing` 逐条列出缺的是哪一个）
 *   · `'skipped'`     —— ★ **没适用，所以没核对**（`appliesTo` 为假，或没有 appliesTo
 *                        而调用方没给"这一轮适不适用"的证据）
 *
 * `'skipped'` 与 `'ok'` 必须不同形：前者是"这条判据这一轮压根不说话，所以它的输入面
 * 缺不缺无所谓"，后者是"它要说话，而它要的每一格都在"。合成一个"没问题"会让
 * "88 种组合里大部分不适用"这件事永远读不出来。
 *
 * ── ★ 为什么 `'skipped'` 自己还要再分（t11）────────────────────────────────────
 *
 * MEASURED（2026-10-06，completion-owner 发现、shape-dev 复核）：`'skipped'` 把
 * **两件不同的事**合成了一件事。取 `completion.r5`（它声明了 `wantsCompleted` /
 * `task.kind` / `taskNotTerminal` 三个**闸门格** —— `appliesTo` 自己读的那几格）：
 *
 *     A  kind = 'work'（任务类型不匹配）      ⇒ appliesTo 假 ⇒ skipped
 *     B  调用方**没给** `wantsCompleted`       ⇒ appliesTo 假 ⇒ skipped
 *
 * 实测两者逐字节相同。而 B 是**接线缺陷**：`wantsCompleted` 是调用方必须注入的一格，
 * 它缺席意味着这条判据**永远不跑** —— 那是本轮要消灭的第 8 次同形缺陷，
 * 却与"这一轮本来就不该跑"（A，正常）同形。
 *
 * ⇒ 修法**不是**加第二份声明（见 {@link RequiresCheck.gateCells} 那段实测记录），
 *   而是把 `'skipped'` 的**成因**读出来。
 */
export type RequiresStatus = 'ok' | 'incomplete' | 'skipped';
/**
 * `'skipped'` 的**成因**。★ 这几个值必须不同形，因为其中一个是缺陷、其余是正常。
 *
 *   · `'not-applicable'`        —— 判据**判定自己这一轮不该说话**：它读到了它要的
 *                                  判断依据，而结论是"不适用"（任务类型不匹配、
 *                                  这一轮不试图完成、终态补证据……）。**正常。**
 *   · `'input-surface-absent'`  —— 判据**压根没拿到判断依据**：它声明的那几格里，
 *                                  **一个都没接上**。⇒ 它静默跳过，而"它跳过"与
 *                                  "它这一轮不该跑"是**不同的两件事**。
 *   · `'undeclared'`            —— 这条判据没声明 `requires`，无从核对。
 *   · `'caller'`                —— 调用方直接说"不适用"（没走 `appliesTo`）。
 *
 * ── ★ 为什么 `'input-surface-absent'` **不是**接线缺陷（守住"不适用不报"）──────
 *
 * 两件必须同时成立、不许混：
 *
 *   ① 它**不得**被算成接线缺陷 ⇒ 不进 `missing`、不进 `incomplete`、不产生
 *      `blockers`（硬化时也不）。一条任务类型不匹配的判据本就不该跑，报它是假告警
 *      —— 而假告警教人忽略门禁，与漏报同样有害（本轮反复确认过的那条）。
 *   ② 但"它跳过了"与"它这一轮不该跑"**必须读得出区别** ⇒ 两者落在**不同的成因格**上，
 *      而不是合并成一个 `skipped`。
 *
 * 这就是措辞分流（本任务裁定采纳的候选 ②），不是新增一份声明。
 */
export type RequiresSkipReason = 'not-applicable' | 'input-surface-absent' | 'undeclared' | 'caller';
/** 一条判据的核对结论。 */
export interface RequiresCheck {
    /** 判据 id（与 `GateRegistration.id` 同一个）。 */
    id: string;
    status: RequiresStatus;
    /** 声明了、而真实 ctx 上读不到的路径，按 `requires` 的顺序。只在 `incomplete` 时非空。 */
    missing: string[];
    /** 声明了且真的读到了的路径（只报告在场/缺席，**绝不报告值** —— 值里可能有密钥与全文）。 */
    present: string[];
    /** `appliesTo` 为假 ⇒ 这里是理由原文（一条人话）。其余情形缺席。 */
    skippedBecause?: string;
    /** ★ `'skipped'` 的成因（t11）。只在 `status === 'skipped'` 时在场，且必在场。 */
    skipReason?: RequiresSkipReason;
    /**
     * ── ★ 为什么这里**没有**第二个 `appliesRequires` 字段（t11 的核心决定）──────────
     *
     * 这个缺口的**诱人修法**是另立一份声明：`appliesRequires`（"闸门需要哪几格"），
     * 与 `requires`（"判据需要哪几格"）分开。**shape-dev 与 completion-owner 都反对**，
     * 本任务裁定采纳，理由是实测过的形态：
     *
     *   两份声明**会分叉**（判据改了闸门、忘了改另一份），而分叉**在日志里同形** ——
     *   它看起来与"闸门本来就是那样"完全一样。那正是本轮从头到尾要消灭的形态，
     *   也是"每一格手工接"必然复发第 8 次的原因。
     *
     * ★ 所以下面这个 `gateCells` 是**推导出来的，不是声明出来的**：`checkRequires`
     *   实测 `appliesTo` 究竟读了 `requires` 里的哪几格（逐格置空、看结论是否翻转）。
     *   一份声明即唯一真相；推导只解释它【怎么被读的】。
     */
    gateCells?: string[];
    /**
     * ── ★ `appliesTo` 真的读了、而 `requires` **没声明**的格子 ─────────────────────
     *
     * **这是本任务最该被看见的一格。** 它说的是：判据用来自证"我不适用"的那几格里，
     * 有格子**不在它声明的输入面里** ⇒ 那几格的接线**没有任何东西在核**。
     *
     * ★ 与 `missing` 的关系：`missing` 是"声明了、真 ctx 上读不到"（**接线缺陷**，
     *   有硬证据）；这里是"没声明、但真的被读了"（**声明缺口**，另一件事）。
     *   两者不许合流 —— 前者要人补接线，后者要人补声明。
     *
     * ★ 它为什么不产生 blocker（即使硬化）：那会让本机制当场变成"判据作者必须一次性
     *   写全声明才能提交"的门禁，而本轮的纪律恰恰相反（本机制还没被验证过，不许当场
     *   否决别人的工作）。它只读数、只曝光。
     */
    gateCellsUndeclared?: string[];
    /** 判据没声明 `requires` ⇒ 这里说明"没声明"，与"声明了空数组"不同形。 */
    undeclared?: string;
}
/**
 * 一份核对结果。**它是旁路数据**：调用方读它来决定"要不要修那条接线"，
 * 而它进不了 `ok` / `blockers` / `unmeasured`。
 */
export interface RequiresAudit {
    /** 核对了几条（只数真的核对了的 —— 被跳过的记在 `skipped`，不混进来）。 */
    checked: number;
    /** 缺了至少一格的条数。 */
    incomplete: number;
    /** 因 `appliesTo` 为假而**没有**核对的条数（这一格是"不适用不报"的计数器）。 */
    skipped: number;
    /**
     * ★ 被跳过的那些里，**只有"任务类型不匹配"这一类**的条数（t11）。
     *
     * 与 `skipped` 的关系：`notApplicable <= skipped`，且剩下的那一部分落在
     * `inputSurfaceAbsent` / `undeclared` 上。★ 两个计数必须分开读 ——
     * 合起来读会让"11 条判据都跳过了"（正常）与"11 条都因为接线没接而跳过"（异常）
     * 在读数上同形，而那正是 t11 要修的那件事。
     */
    notApplicable: number;
    /**
     * ★ 被跳过的那些里，判据**一格输入面都没接到**的条数（t11）。
     *
     * ★ 它**不是**接线缺陷计数（那条在 `incomplete`），它是"这条判据这一轮静默跳过、
     *   而原因不是任务类型不匹配"的读数。缺口的可发现性就靠它：
     *   假如下次闸门格没接线，这个数会**大于 0**，而 `incomplete` 仍是 0 ——
     *   两份读数一起看才知道该去补哪一边。
     */
    inputSurfaceAbsent: number;
    /** 逐条结论，按注册顺序。 */
    checks: RequiresCheck[];
    /** 缺了格子的那些判据的人话清单（`incomplete > 0` 时非空）。 */
    missing: string[];
    /**
     * ★ 声明缺口的清单（`gateCellsUndeclared` 非空的人话版）。
     *
     * ★ 与 `missing` **刻意分开**：`missing` 说"接线上少一格"，这里说"声明里少一格"。
     *   两者合起来会让补救动作变得不可判定（是去补接线，还是去补声明？）。
     */
    gateCellsUndeclared: string[];
}
/** 一条判据这一轮适不适用的判断依据 —— 由调用方（或注册表）给。 */
export interface RequiresSubject {
    id: string;
    requires?: readonly string[] | undefined;
    appliesTo?: ((context: unknown) => boolean) | undefined;
}
/**
 * 给一条判据做核对。**纯函数**：不读磁盘、不读表、不看时间。
 *
 * @param subject  判据的形状（id + requires + appliesTo）
 * @param context  真实 ctx（注册表求值时拿到的那一个，原样）
 * @param applies  调用方对"这一轮适不适用"的裁决（缺省 = 让 `appliesTo` 自己说；
 *                 注册表按**它自己的**那一份 appliesTo 判定并传进来，
 *                 因为跳过与否是注册表的结论，核对层不许另建一套口径）
 */
export declare function checkRequires(subject: RequiresSubject, context: unknown, applies?: boolean): RequiresCheck;
/**
 * 核对一组判据，合并成一份旁路结果。
 *
 * ★ 合并规则与"不短路"同源：**一次给全**（本队为串行发现已经交过一次学费）。
 *   缺了哪几格要一口气列出来，而不是修一个再跑又冒出一个。
 */
export declare function auditRequires(subjects: readonly RequiresSubject[], context: unknown): RequiresAudit;
/**
 * 核对结果怎么用（**先软后硬**）。
 *
 *   · `'observe'`（缺省）—— 结果只进旁路字段 `requires`，**不动裁决**；
 *   · `'enforce'`        —— 缺格子的判据被计进 `blockers`（流程被拒）。
 *
 * ── 三条设计决定，每一条都对着这个仓库已经踩过的形态 ──────────────────────────
 *
 * ① **缺省 = 只看不说**。这与观察模式（registry 的 `observe`）的缺省方向**相反**，
 *    而这是刻意的，两者防的是不同的东西：
 *      · 观察模式放宽的是**判据的否决权** ⇒ 缺省必须严（否则"配置丢了"与
 *        "判据通过了"同形）；
 *      · 这里是**核对机制自己**的权限 ⇒ 它还没被任何一轮真实运行验证过，
 *        缺省必须松（否则第一次上线就会把真实任务卡死，而"被门禁坑过"的人
 *        学到的不是"这条接线要修"，是"门禁可以忽略"）。
 *    ⇒ 方向不同是因为**被放开的东西不同**：那边放开的是"一条已写好的判据"，
 *      这边放开的是"一个刚装上的核对器"。
 *
 * ② **开关是运行时数据，不是注册字段**。与观察模式同源：关掉它不该需要改代码
 *    —— 改代码就带来"漏了 build ⇒ 装的位置跑的是旧代码"那条窗口（本队实测过）。
 *
 * ③ **`enforce` 不是"把核对结论变成裁决"，而是"把缺格子的判据拦下来"**：
 *    真正被拒的理由仍然是"这条判据要的那一格没接上"，一句话能读懂。硬化的
 *    那一天要能一眼看出"是核对层拒的"，而不是在一堆判据结论里找。
 */
export type RequiresAuditMode = 'observe' | 'enforce';
/**
 * 环境变量名：`AGENT_TEAMS_ENFORCE_REQUIRES=1` ⇒ 硬化。
 *
 * ★ 与 `AGENT_TEAMS_OBSERVE_GATES` 相反方向的同一个理由：**部署改动即可开关**。
 * ★ 只认白名单里的真值（`1` / `true` / `yes` / `on`，去空白、忽略大小写）：
 *   一个"设了任意非空值就硬化"的读法会让 `AGENT_TEAMS_ENFORCE_REQUIRES=0`
 *   把门禁拧到最硬 —— 而它在日志里读起来像"关掉了"。
 */
export declare const ENFORCE_REQUIRES_ENV = "AGENT_TEAMS_ENFORCE_REQUIRES";
/** 解析硬化开关的环境变量。导出是为了让夹具钉住解析规则本身，不必去动全局状态。 */
export declare function requiresModeFromEnv(value: string | undefined): RequiresAuditMode;
export interface RequiresAuditPolicy {
    mode: RequiresAuditMode;
    /** 硬化时：把"缺格子的判据"翻成 blocker 原文。`observe` 模式下恒为空数组。 */
    blockers: (audit: RequiresAudit) => string[];
}
/**
 * 一份**显式**的核对策略。缺省从环境变量读一次（构造时读，与 `createGateRegistry`
 * 同一条纪律：进程内改环境变量会让同一次运行里两次求值用两套门禁）。
 */
export declare function createRequiresAuditPolicy(options?: {
    readonly mode?: RequiresAuditMode | undefined;
    readonly enforceFromEnv?: string | undefined;
}): RequiresAuditPolicy;
/**
 * 只留下**真正的路径**（不含空串那一条）。
 *
 * ★ 为什么单独包一层：空串是 ① 里说的"类型级兜底"，但它不是一个路径 —— 把它放进
 *   `requires` 会写出 `requires: ['']` 这种读不懂的东西。类型上排掉它，
 *   让"路径"这个概念的边界在类型里就说清。
 *
 * ── ★ 为什么这一层要单独存在（t6 的两条实测，缺一条都会写成错的）───────────────
 *
 * ① **`Exclude<Paths<T>, ''>` 不行**：`Paths` 被别名之后，tsc 保留的是一条延迟
 *    求值的别名，而键集运算（`Exclude`）读到的是它的**声明**而不是**展开** ⇒
 *    `CtxPaths<T>` 恒等于 `never` ⇒ **任何**路径都报 TS2322，包括写对的那些
 *    （实测：`CtxPaths<{y?:{z:number}}>` ⇒ `never`）。
 *
 * ② **把展开体在 `CtxPaths` 里再内联一遍也不行**：那让 tsc 在**每一个** `requires`
 *    上递归展开整棵 ctx 类型，实测直接崩：
 *
 *        RangeError: Maximum call stack size exceeded
 *          at instantiateTypeWorker (typescript/lib/_tsc.js)
 *
 *    ★ 这是个比"报错"更坏的失效形态 —— **整个 typecheck 崩掉**，于是没有人
 *      从中学到"路径写错了"，只学到"这个检查让 tsc 挂"。
 *
 * ⇒ 唯一同时成立的写法就是这里：`CtxPaths` 是 **`PathsOf` 的一层直接别名**，
 *   不是 `Paths` 的。`PathsOf` 的递归只被实例化一次，下游的 `Exclude` 读到的是
 *   已展开的联合。三条形状各被一条臂钉住（夹具臂 7/8/9），因为它们**互相之间
 *   只差一个别名**，而差别只在 tsc 的求值时机上。
 */
export type CtxPaths<T, Depth extends 0 | 1 | 2 | 3 = 3> = Exclude<PathsOf<T, Depth>, ''>;
/**
 * 一条判据的 `requires`：它需要 ctx 上的哪些路径。
 *
 * ★ 类型参数 `T` 就是**那条判据自己的 ctx 类型**（已经导出，成本为零）：
 *
 * ```ts
 * import type { CtxPaths } from '../requires.ts'
 * import type { RuntimeLivenessContext } from './liveness.ts'
 *
 * export const id = 'runtime.liveness'
 * export const point = 'runtime'
 * export const description = '…'
 * export const requires: CtxPaths<RuntimeLivenessContext>[] = ['event', 'wait', 'waits', 'task']
 * //                                                             ↑ 写成 'event.typo' ⇒ TS2322
 * ```
 *
 * ★ 为什么用**数组**而不是对象：数组的顺序是稳定的、可 diff 的、可读的，而
 *   "哪一格接没接上"这件事要能一条一条地报出来（`missing: ['wait.now']`）。
 *   一个 `{ wait: { now: true } }` 的对象形状会把顺序交给 key 的枚举顺序。
 *
 * ★ 空数组是合法的，且**语义明确**：这条判据不依赖 ctx 的任何一格 —— 它不是
 *   "还没写"，因为"还没写"与"不需要"在类型上同形但**声明上不同形**（前者是
 *   字段缺席，后者是 `requires: []`）。核对函数对两者给出的结论也不同：
 *   缺席 ⇒ 不核对（现状），空数组 ⇒ 核对过、且没有可缺的东西。
 */
export type Requires<T> = ReadonlyArray<CtxPaths<T>>;
/**
 * 读一条路径。
 *
 * ★ `undefined` 与"值就是 undefined"在这里是同一件事 —— 而且**必须**是：
 *   一个在场上但值为 `undefined` 的格子，对判据来说与"缺席"没有任何区别
 *   （`ctx.wait?.now` 两种情形读出来都是 `undefined`）。把它们拆成两态会造出
 *   一个判据读不出来的区分，那就是"只有核对层知道"的信息。
 */
export declare function readPath(context: unknown, path: string): unknown;
export {};
