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
        /**
         * ── ★ t11：`skipped` 的两种成因必须不同形 ──────────────────────────────────
         *
         * 到这一行，我们只知道"这一轮不适用"。**为什么**不适用，要再问一次 ——
         * 而这一步**不用**任何新声明：判据声明的那几格，`appliesTo` 到底读没读到？
         *
         *   · 声明里**至少有一格在场** ⇒ 判据拿到了它的判断依据，而结论是"不适用"
         *     （任务类型不匹配 / 这一轮不试图完成 / 终态补证据）⇒ `'not-applicable'`。**正常。**
         *   · 声明里**一格都没有**（`requires` 非空且全缺席）⇒ 判据**压根没拿到判断依据**
         *     ⇒ `'input-surface-absent'`。这条判据永远不会跑，而它**静默地**永远不跑
         *     —— 那是本轮要消灭的第 8 次同形缺陷。
         *
         * ★ 实测（completion.r5，见 {@link RequiresStatus} 的注释）：两种情形的差别
         *   恰好就落在这里 —— kind='work' 时 `task.kind` 在场（⇒ not-applicable），
         *   而"调用方没给 `wantsCompleted`"时声明里一格都不在场（⇒ input-surface-absent）。
         *
         * ★ **仍然不报缺陷**：两者都不进 `missing`、不进 `incomplete`、不产生 blocker。
         *   一条本就不该跑的判据去报"你缺格"是假告警，而假告警教人忽略门禁，
         *   与漏报同样有害。这里做的**只是把成因读出来**（候选 ②，不是候选 ①）。
         */
        const declared = subject.requires ?? [];
        const presentHere = declared.filter((path) => isPresent(readPath(context, path)));
        const gateCellsUndeclared = declared.length === 0 ? [] : undeclaredGateCells(subject, context, declared);
        /**
         * ── ★ 成因的判定：看【闸门格】接没接上，而不是看"有没有格子在场"────────────
         *
         * MEASURED（2026-10-06，t11 本机实测，我第一版写错过一次）：
         *
         * 第一版用的是"声明里有没有**任意一格**在场"：`presentHere.length === 0`。
         * **它错了**，而错法很隐蔽 —— `completion.r5` 在"调用方没给 `wantsCompleted`"
         * 那一轮里，`parentRevision` 与 `scanDirs`（**测量格**）是在场的：
         *
         *     场景 B（闸门格没接线）present = ['parentRevision', 'scanDirs', 'task.kind']
         *     ⇒ presentHere.length = 3 ≠ 0 ⇒ 被判成 'not-applicable'  ✗ 缺口原样存在
         *
         * ★ 原因是"在场"这件事与"闸门"无关：测量格在不在场，是判据能不能干活的问题；
         *   闸门格在不在场，才是判据**能不能做出"我不适用"这个判断**的问题。
         *   把两者合成一个计数，就是本轮反复见到的合流形态。
         *
         * ⇒ 判别式改成**推导出来的闸门格**：`appliesTo` 实测读了、而真实 ctx 上读不到的
         *   那几格为空 ⇒ 它压根没有判断依据 ⇒ `'input-surface-absent'`。
         *
         * ★ 推导只对"有 appliesTo"的判据有效；调用方直接说 `applies` 时成因是
         *   `'caller'`，与判据自己的闸门无关（所以那一条先行短路）。
         */
        const callerSaid = applies === false;
        const derived = declared.length === 0 ? [] : derivedGateCells(subject, context, declared);
        const skipReason = callerSaid
            ? 'caller'
            : declared.length === 0
                ? 'undeclared'
                : derived.length > 0 ? 'input-surface-absent' : 'not-applicable';
        return {
            id: subject.id,
            status: 'skipped',
            skipReason,
            missing: [],
            present: presentHere,
            ...declared.length === 0 ? {} : { gateCells: derived },
            ...gateCellsUndeclared.length === 0 ? {} : { gateCellsUndeclared },
            skippedBecause: callerSaid
                ? 'the caller reported this gate as not applicable to this context'
                : skipReason === 'input-surface-absent'
                    ? `this gate reached "not applicable" using a gating cell that the context does not carry (${derived.join(', ')}): `
                        + 'the verdict is about THIS ROUND being inapplicable, not about the gate being silent because a wiring is missing '
                        + '(nothing is blocked — a gate that is not meant to run must not raise an alarm)'
                    : 'appliesTo(context) read its own gating cells and concluded this gate does not speak for this context',
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
            skipReason: 'undeclared',
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
    /**
     * ★ 声明缺口：`appliesTo` 读了、而 `requires` 没声明的格子。
     *
     * MEASURED（2026-10-06，t11 实测）：`dispatch.worktree` 的 `appliesTo` 读了
     * `task.kind` 与 `update.changedPaths`，而它的 `requires` 只声明了
     * `['worktreePath', 'arrival']` ⇒ **那两格的接线没有任何东西在核**。
     * 这正是"闸门格"，而缺口的可发现性靠这一格。
     */
    const gateCellsUndeclared = undeclaredGateCells(subject, context, subject.requires);
    return {
        id: subject.id,
        status: missing.length > 0 ? 'incomplete' : 'ok',
        missing,
        present,
        gateCells: derivedGateCells(subject, context, subject.requires),
        ...gateCellsUndeclared.length === 0 ? {} : { gateCellsUndeclared },
    };
}
/**
 * ── ★ 推导 `appliesTo` 读了哪几格（t11）——**推导，不是声明** ────────────────────
 *
 * 做法是**差分探测**：对声明的每一格，构造一份"把这一格置空、其余照旧"的 ctx，
 * 再问一次 `appliesTo`。结论翻转 ⇒ 这一格是闸门格。
 *
 * ```
 * 真实 ctx            appliesTo = false
 * 把 wantsCompleted 补上  appliesTo = true   ⇒ wantsCompleted 是闸门格
 * 把 task.kind 换成 work  appliesTo = false  ⇒ 无关
 * ```
 *
 * ── ★ 为什么是推导而不是第二份声明（本任务的核心决定，两处实测支撑）────────────
 *
 * ① **两份声明会分叉**。判据改了闸门、忘了改另一份，而分叉**在日志里同形**——
 *    它看起来与"闸门本来就是那样"完全一样。那正是本轮从头到尾要消灭的形态。
 * ② 而推导**不可能与声明分叉**：它读的就是 `requires` 那一份，唯一的输入。
 *
 * ── 四条纪律（每一条都对着一个会误报的坑）────────────────────────────────────
 *
 * · **只在 `appliesTo` 为假时推导**。它的语义就是"为什么它说不适用"；在适用的
 *   判据上问"哪几格是闸门"既无对象、又会产出噪声。
 * · **一次只补一格，不做组合搜索**。组合会产出 `2^n` 个探针（r5 有 5 个缺席格），
 *   而闸门格通常各自独立就把结论翻过来了。少报一格是可以接受的（这只是一条读数），
 *   误报一格不可以 —— 误报会让"闸门格"这个说法失去信任。
 * · **最多补 4 格**。超过这个数说明判据的闸门是组合式（"任意两格同时在场"），
 *   单格差分测不出来，此时**如实少报**而不是猜。
 * · **补进去的值只用于触发"在场"**，不承诺语义。所以推导出的格子**只当读数用**，
 *   绝不参与裁决 —— 这一点由"它只出现在 `gateCells*` 与旁路字段里"保证。
 *
 * ★★ 但"不承诺语义"不等于"随便填一个值"（t11 本机实测，我第一版就栽在这里）：
 *
 *     探针填 `'(gate-cell-probe)'` 时，`completion.r5` 的闸门格**一个都推不出来**：
 *         appliesTo 的第一段是 `kind !== 'implementation' && kind !== 'repair'`
 *         ⇒ 给 `task.kind` 填一个字符串仍然不匹配 ⇒ 结论不翻转
 *         appliesTo 的第二段是 `ctx?.wantsCompleted !== true`
 *         ⇒ 给 `wantsCompleted` 填一个字符串仍然 !== true ⇒ 结论**也不翻转**
 *     实测 gateCells = []（本该是 ['wantsCompleted']）—— 判别式因此恒判
 *     'not-applicable'，t11 的缺口原样存在。
 *
 * ⇒ 探针必须**逐格按它在 ctx 上的形态**来试，而不是填一个固定值：见
 *   {@link gateCellProbesFor}。它按"闸门格在真实代码里长什么样"给出一小组候选
 *   （布尔真 / 非空数组 / 非空字符串），任何一个让结论翻转即算命中。
 *   ★ 这是**探测**，不是猜测：命中与否由 `appliesTo` 自己回答。
 */
function derivedGateCells(subject, context, declared) {
    const appliesTo = subject.appliesTo;
    if (typeof appliesTo !== 'function')
        return [];
    const absent = declared.filter((path) => !isPresent(readPath(context, path)));
    if (absent.length === 0)
        return [];
    /**
     * ★ 探测的基线是"这一格补上、其余照旧"。`withPath` 只写**一份新副本**，
     *   绝不改调用方的 ctx（判据随后还要拿原始的它去求值）。
     */
    const probe = (path) => {
        for (const candidate of gateCellProbesFor(context, path)) {
            try {
                if (appliesTo(withPath(context, path, candidate)) === true)
                    return true;
            }
            catch {
                /** ★ 某个候选让判据抛错 ⇒ 换下一个候选（抛错本身不是"是闸门格"的证据）。 */
                continue;
            }
        }
        return false;
    };
    const found = [];
    for (const path of absent.slice(0, MAX_GATE_CELL_PROBES)) {
        if (probe(path))
            found.push(path);
    }
    return found;
}
/**
 * `appliesTo` 读了、而 `requires` 没声明的格子 —— **声明缺口**。
 *
 * 做法与 `derivedGateCells` 同源的差分：对**未声明的**候选键做"补上再看结论翻不翻"。
 * 候选来自 ctx 上真实存在的键。
 *
 * ── ★ 这个方法有一个**实测出来的上限**，必须写在这里（t11）────────────────────────
 *
 * 候选只能来自"这一份 ctx 上真的有权"的地方。于是：
 *
 *     ctx = { task: { kind: 'implementation' }, update: {} }
 *     ⇒ `update.changedPaths` **不在候选里**（`update` 是空对象，`Object.keys` 是空的）
 *     ⇒ 而 `dispatch.worktree` 的闸门正是它 ⇒ 这一格**推不出来**（实测）
 *
 * ★ 换句话说：**纯差分探测只能看见"这一轮 ctx 里出现过的格子"**，看不见"这一轮
 *   压根没出现的格子"。这不是实现缺陷，是这条方法的天花板 —— 想要突破它就必须知道
 *   判据的完整形状，而那正是 `requires` 该说的事（所以缺口本身会以另一种方式暴露：
 *   调用方补上声明，候选就出现了）。
 *
 * ★ 因此这一格读数的契约是**"报了的一定真、没报的不一定没有"**（单向可信）。
 *   把它读成"没报 ⇒ 没缺口"是**过度解读**，会把一条单向读数变成一条假保险 ——
 *   而假保险比没有读数更坏。臂 16 的断言按这个契约写。
 *
 * ★ 最多探 12 个候选：防止形状怪异的 ctx 把核对层拖慢。少报不发噪音。
 */
function undeclaredGateCells(subject, context, declared) {
    const appliesTo = subject.appliesTo;
    if (typeof appliesTo !== 'function')
        return [];
    const candidates = Object.keys(candidateKeys(context, declared)).slice(0, MAX_UNDECLARED_PROBES);
    const found = [];
    for (const path of candidates) {
        /**
         * ★ 只在**真实 ctx 上这一格不在场**时才探：一个在场的格子若还是闸门格，
         *   判据早就不适用了；而我们要找的是"这一格没接 ⇒ 永远静默跳过"那种。
         */
        if (isPresent(readPath(context, path)))
            continue;
        for (const candidate of gateCellProbesFor(context, path)) {
            try {
                if (appliesTo(withPath(context, path, candidate)) === true) {
                    found.push(path);
                    break;
                }
            }
            catch {
                continue;
            }
        }
    }
    return found;
}
/**
 * ── ★ 一格闸门格的探针值：按真实代码里它**长什么样**给一小组候选 ────────────────
 *
 * 实测（t11）：固定填一个字符串推不出 `wantsCompleted`（判据写的是 `!== true`）。
 * 而闸门格在真实判据里只有三种形态 —— 这三种覆盖了仓库里全部 11 条判据：
 *
 *     wantsCompleted !== true        ⇒ 布尔（本轮试图完成吗）
 *     kind !== 'implementation'      ⇒ 字符串（任务类型；★ 这一种探不了，见下）
 *     Array.isArray(update?.newTestFiles) ⇒ 数组（这一轮声明了什么）
 *
 * ★ `task.kind` 这一类**故意不探字符串**：闸门对它的判断是"是不是某几个具体值"，
 *   而"正确答案"（'implementation'）是**判据内部的语义**，核对层无从知道它 ——
 *   猜一个等于把判据的语义抄进核对层，那正是本任务拒绝的第二份声明。
 *   ⇒ 这一类如实**推不出来**（少报），而不是猜一个。少报只让读数少一格；
 *     猜错会让"闸门格"这个说法失去信任，代价更大。
 *
 * ★ 数组那一支用 `['(gate-cell-probe)']`（**非空**）：真实闸门普遍还查 `.length > 0`
 *   （见 `dispatch.worktree`），空数组探不出来。
 */
function gateCellProbesFor(_context, _path) {
    return [true, ['(gate-cell-probe)'], ['(gate-cell-probe)'], 1, '(gate-cell-probe)'];
}
/** 单格差分的上限（超过它说明闸门是组合式，如实少报而不是猜）。 */
const MAX_GATE_CELL_PROBES = 4;
/** 未声明候选的探查上限（防止形状怪异的 ctx 拖慢核对）。 */
const MAX_UNDECLARED_PROBES = 12;
/**
 * ctx 上真实存在的一层键 —— 未声明格子的候选来源。
 *
 * ★ 只取**一层**（`a` 与 `a.b` 两种形态都产出）：闸门格实测都在这一层
 *   （`wantsCompleted` / `task.kind` / `update.changedPaths`）。
 *   更深会产出大量噪音候选，而噪音会让这一格读数失去可信度。
 */
function candidateKeys(context, declared) {
    const declaredSet = new Set(declared);
    const out = {};
    if (context === null || typeof context !== 'object' || Array.isArray(context))
        return out;
    for (const [key, value] of Object.entries(context)) {
        if (!declaredSet.has(key))
            out[key] = true;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            for (const inner of Object.keys(value)) {
                const path = `${key}.${inner}`;
                if (!declaredSet.has(path))
                    out[path] = true;
            }
        }
    }
    return out;
}
/**
 * 一份"只把 `path` 换成在场值、其余原样"的 ctx 副本。
 *
 * ★ 浅拷贝到路径的父级为止：判据随后还要拿**原始** ctx 求值，所以这里绝不许
 *   写穿调用方的对象。中途遇到标量（`{a: 'text'}` 而 path 是 `a.b`）就返回原对象
 *   —— 那种形态下这一格不能被"补上"，如实不补。
 */
function withPath(context, path, value) {
    if (context === null || typeof context !== 'object' || Array.isArray(context))
        return context;
    const segments = path.split('.');
    const head = segments[0];
    const source = context;
    if (segments.length === 1)
        return { ...source, [head]: value };
    const child = source[head];
    if (child === null || typeof child !== 'object' || Array.isArray(child))
        return source;
    return { ...source, [head]: withPath(child, segments.slice(1).join('.'), value) };
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
    const skippedChecks = checks.filter((check) => check.status === 'skipped');
    const undeclaredChecks = checks.filter((check) => (check.gateCellsUndeclared?.length ?? 0) > 0);
    return {
        checked: checks.filter((check) => check.status !== 'skipped').length,
        incomplete: incompleteChecks.length,
        skipped: skippedChecks.length,
        /**
         * ★ 两个成因分开数（t11）。`notApplicable` 是**好消息**（判据按设计闭嘴），
         *   `inputSurfaceAbsent` 是**要去看一眼的信号**（它静默跳过，而原因不是任务类型）。
         *   合成一个 `skipped` 正是 t11 要修的缺口本身。
         */
        notApplicable: skippedChecks.filter((check) => check.skipReason === 'not-applicable').length,
        inputSurfaceAbsent: skippedChecks.filter((check) => check.skipReason === 'input-surface-absent').length,
        checks,
        missing: incompleteChecks.map((check) => `[${check.id}] declares ${check.missing.length} ctx path(s) that this context does not carry: ${check.missing.join(', ')}`),
        /**
         * ★ 声明缺口与接线缺口分列两句（t11）：一个要人补声明，一个要人补接线。
         *   合起来会让补救动作不可判定。
         */
        gateCellsUndeclared: undeclaredChecks.map((check) => `[${check.id}] its appliesTo reads ${check.gateCellsUndeclared.join(', ')}, which the gate does not declare in requires — that wiring is not checked by anything (a declaration gap, not a wiring defect)`),
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
