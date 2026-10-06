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
/**
 * 一条路径在真实 ctx 上"接上了没有"。
 *
 * ★ 判据与核对层必须对"在场"有一致口径，否则核对会报出一个判据根本不认的结论。
 *   口径就是判据自己的读法（见 `gate` 里的 `typeof wait.now === 'number'`）：
 *   `undefined` 与 `null` 都是**没接上**。其余的值（含 `0` / `''` / `false` /
 *   空数组）**都算接上了** —— 一个"在但为空"的观察面是判据自己的事（它有专门的
 *   臂去区分 `waits: []` 与 `waits` 缺席），核对层不许替它把"空"读成"缺"。
 */
function isPresent(value) {
    return value !== undefined && value !== null;
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
export function checkRequires(subject, context, applies) {
    /**
     * ── ★ 闸门：不适用 ⇒ 不报 ────────────────────────────────────────────────────
     *
     * MEASURED（2026-10-06 开工前）：11 条判据 × 8 个调用点 = 88 种组合，
     * **大部分本来就该"不适用"**。无条件核对会在这些组合上报一大堆"缺这缺那"，
     * 而那些缺失是正常的（一条只在 `task-status` 上开口的探活判据，在
     * `task-created` 那一刻缺时钟，本来就是设计的一部分）。
     *
     * ⇒ 噪音会教人忽略门禁 —— 与误报同样有害。**不适用就不说话。**
     *
     * ★ 这一句就是 t6 的定向突变点：把它去掉（无条件核对），
     *   `scripts/gate-requires.test.mjs` 的臂 3 必须变红。
     */
    const applicable = applies ?? (typeof subject.appliesTo === 'function' ? subject.appliesTo(context) === true : true);
    if (!applicable) {
        return {
            id: subject.id,
            status: 'skipped',
            missing: [],
            present: [],
            skippedBecause: typeof subject.appliesTo === 'function'
                ? 'appliesTo(context) is not true for this context, so this gate does not speak this round and its input surface is not checked'
                : 'the caller reported this gate as not applicable to this context',
        };
    }
    if (subject.requires === undefined) {
        /**
         * ★ 没声明 `requires` ⇒ 不核对，且**明说**是没声明。
         *   与 `requires: []`（声明过、不需要任何一格）不同形：一个是"这条判据的
         *   输入面还没有被声明"，一个是"它的输入面是空的"。合成一个会让这次接线
         *   覆盖率的读数虚高 —— 而覆盖率虚高的代价，正是本轮要消灭的那件事。
         */
        return {
            id: subject.id,
            status: 'skipped',
            missing: [],
            present: [],
            undeclared: 'this gate declares no requires, so its input surface is unknown (this is not the same as requiring nothing)',
        };
    }
    const missing = [];
    const present = [];
    for (const path of subject.requires) {
        if (isPresent(readPath(context, path)))
            present.push(path);
        else
            missing.push(path);
    }
    if (missing.length > 0) {
        return { id: subject.id, status: 'incomplete', missing, present };
    }
    return { id: subject.id, status: 'ok', missing, present };
}
/**
 * 核对一组判据，合并成一份旁路结果。
 *
 * ★ 合并规则与"不短路"同源：**一次给全**（本队为串行发现已经交过一次学费）。
 *   缺了哪几格要一口气列出来，而不是修一个再跑又冒出一个。
 */
export function auditRequires(subjects, context) {
    const checks = subjects.map((subject) => checkRequires(subject, context));
    const incompleteChecks = checks.filter((check) => check.status === 'incomplete');
    return {
        checked: checks.filter((check) => check.status !== 'skipped').length,
        incomplete: incompleteChecks.length,
        skipped: checks.filter((check) => check.status === 'skipped').length,
        checks,
        missing: incompleteChecks.map((check) => `[${check.id}] declares ${check.missing.length} ctx path(s) that this context does not carry: ${check.missing.join(', ')}`),
    };
}
/**
 * 环境变量名：`AGENT_TEAMS_ENFORCE_REQUIRES=1` ⇒ 硬化。
 *
 * ★ 与 `AGENT_TEAMS_OBSERVE_GATES` 相反方向的同一个理由：**部署改动即可开关**。
 * ★ 只认白名单里的真值（`1` / `true` / `yes` / `on`，去空白、忽略大小写）：
 *   一个"设了任意非空值就硬化"的读法会让 `AGENT_TEAMS_ENFORCE_REQUIRES=0`
 *   把门禁拧到最硬 —— 而它在日志里读起来像"关掉了"。
 */
export const ENFORCE_REQUIRES_ENV = 'AGENT_TEAMS_ENFORCE_REQUIRES';
const ENFORCE_TRUTHY = Object.freeze(['1', 'true', 'yes', 'on']);
/** 解析硬化开关的环境变量。导出是为了让夹具钉住解析规则本身，不必去动全局状态。 */
export function requiresModeFromEnv(value) {
    if (typeof value !== 'string')
        return 'observe';
    const normalized = value.trim().toLowerCase();
    return ENFORCE_TRUTHY.includes(normalized) ? 'enforce' : 'observe';
}
/**
 * 一份**显式**的核对策略。缺省从环境变量读一次（构造时读，与 `createGateRegistry`
 * 同一条纪律：进程内改环境变量会让同一次运行里两次求值用两套门禁）。
 */
export function createRequiresAuditPolicy(options = {}) {
    const envValue = options.enforceFromEnv !== undefined ? options.enforceFromEnv : process.env[ENFORCE_REQUIRES_ENV];
    const mode = options.mode ?? requiresModeFromEnv(envValue);
    return {
        mode,
        blockers: (audit) => (mode === 'enforce' ? audit.missing.map((item) => `the input surface is not wired: ${item}`) : []),
    };
}
/**
 * 读一条路径。
 *
 * ★ `undefined` 与"值就是 undefined"在这里是同一件事 —— 而且**必须**是：
 *   一个在场上但值为 `undefined` 的格子，对判据来说与"缺席"没有任何区别
 *   （`ctx.wait?.now` 两种情形读出来都是 `undefined`）。把它们拆成两态会造出
 *   一个判据读不出来的区分，那就是"只有核对层知道"的信息。
 */
export function readPath(context, path) {
    if (path === '')
        return context;
    let cursor = context;
    for (const segment of path.split('.')) {
        if (cursor === null || typeof cursor !== 'object')
            return undefined;
        cursor = cursor[segment];
    }
    return cursor;
}
