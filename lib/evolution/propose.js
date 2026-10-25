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
export function nextProposalId(knownMax) {
    const safe = Number.isFinite(knownMax) && knownMax > 0 ? Math.floor(knownMax) : 0;
    return `p-${String(safe + 1).padStart(4, '0')}`;
}
export function createTaskParamsOf(proposal) {
    const c = proposal.contract;
    return {
        subject: c.subject,
        /** ★ 只在**真的给了**时才带那一格 —— 缺席与"给了个空"必须不同形。 */
        ...c.kind === undefined ? {} : { kind: c.kind },
        objective: c.objective,
        acceptance: c.acceptance,
        ...c.verify === undefined ? {} : { verify: c.verify },
        ...c.inScope === undefined ? {} : { inScope: c.inScope },
        ...c.outOfScope === undefined ? {} : { outOfScope: c.outOfScope },
        ...c.nonGoals === undefined ? {} : { nonGoals: c.nonGoals },
    };
}
/**
 * ── ★★ `create_task` 的 schema 里**被我们的适配器覆盖到的**字段（可机读）──────────────
 *
 * ★ 为什么把这张表**写出来**而不是只写在注释里：反向半边 B 要对拍
 *   「适配器产出的键 ⊆ schema 认的键」—— 而**一张可机读的表**才能被断言。
 * ★★ 而它**手工维护**：`create_task` 的 schema 是源码里的字面量（不是可导入的数据），
 *   所以本表**必须**与它一致 —— ★ 一旦分叉，反向半边 B 会在对拍时红。
 */
export const CREATE_TASK_PARAM_KEYS = [
    'subject', 'kind', 'objective', 'acceptance', 'verify', 'inScope', 'outOfScope', 'nonGoals',
];
/**
 * ── ★★★ 反向半边 B 的**对拍器**：适配器的输出里**有没有 schema 不认的键**──────────────
 *
 * ★★ 与 t81 那次实测同一条纪律：**内部字段漏进工具返回值会被
 *   `additionalProperties: false` 打红**（那次是 `gates` 漏进了 `create_task` 的输出 schema）。
 * ⇒ 本函数把那次的事故变成**一次可跑的检查**。
 *
 * @returns 不被 schema 认的键（空数组 ⇒ 对得上）。
 */
export function unknownCreateTaskKeys(params) {
    return Object.keys(params).filter((key) => !CREATE_TASK_PARAM_KEYS.includes(key));
}
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
export function unmeasuredDecision(why) {
    return { needChange: false, modality: 'unmeasured', why };
}
/**
 * ★ 靶的类型：判据 id 有 ⇒ `{kind:'gate', ref}`（**结构化**，新写入一律结构化）；
 * 没有 ⇒ 只能给一条**描述性字符串**（t88 的历史形状，对分流合格、对收益不合格）。
 */
function targetOf(signal) {
    if (signal.gateId !== undefined && signal.gateId.trim() !== '') {
        return {
            target: { kind: 'gate', ref: signal.gateId },
            why: `the signal names gate "${signal.gateId}" (source.gateId), so the change has a mechanical target`,
        };
    }
    if (signal.where !== undefined && signal.where.trim() !== '') {
        /**
         * ★ **不编判据名**：`source.where` 是"哪个入口拒的"，不是判据 id。
         *   把它写成 `{kind:'gate'}` 会让"这个位置没有判据"伪装成"有一条判据"。
         */
        return {
            target: `${signal.where}: the rejection point named by source.where (no gate id was recorded)`,
            why: `the signal names the rejection point "${signal.where}" but records no gate id, so the target can only be descriptive`,
        };
    }
    return undefined;
}
/**
 * ★★ 分流的**五态判定** —— 一条信号该以什么形态改。
 *
 * 规则（逐条可核，不猜）：
 * ```
 *   ① kind === 'success'                        ⇒ none（这条是成功记录，没有要改的东西）
 *      ★ **先判它**：这一问的答案不依赖 where，见下面判序那段实测
 *   ② where/message 有任何一格缺失或空白          ⇒ unmeasured（缺输入，不是"不必改"）
 *   ③ 有 gateId                                 ⇒ hard（机械靶：去改/加那条判据）
 *   ④ 只有 where、没有 gateId                    ⇒ contract（要人/agent 实施的一条任务）
 *   ⑤ 其余（两代形状都归不出来）                  ⇒ unmeasured（判不了，不硬塞）
 * ```
 *
 * ★★ 为什么 ③ 是 `hard` 而不是 `soft`：`source.gateId` 的存在**本身**就是
 *   "这件事有一条机读的判据在管"的证据（`observe` 只在判据求值处传 `gateId`）。
 *   ⇒ 要动它 = 动判据的**内容** ⇒ 机械可判 ⇒ `hard`。
 *   ★ 而 `contract` 那一路是"知道哪个入口拒的，但说不出是哪条判据" ⇒
 *   只能变成一条**要人写**的任务契约 —— 那正是本仓 `create_task` 的形状。
 *
 * ★★★ 而"五态各有非零实例"是本函数**必须能自证**的性质（§N2 acceptance ①）：
 *   真实台账上 `hard`（14 条带 gateId）/ `contract`（23 条只有 where）都会出现；
 *   `unmeasured` 由缺输入臂造出来；`none` 由 `success` 臂造出来；
 *   `soft` **不**由分流产出 —— ★ 它不是"没有实例"，而是**分流不产 `soft`**：
 *   `soft` 是"改 prompt / profile"，而一条**判据拒绝**信号说不清该改哪句 prompt。
 *   ⇒ ★ 如实写在这里，而不是为了凑五态编一条规则出来。
 */
function decideRouting(signal) {
    const where = signal.where?.trim() ?? '';
    const gateId = signal.gateId?.trim() ?? '';
    const message = signal.message.trim();
    /**
     * ── ★★★ 判序（t4 现场修正，**顺序本身就是这条判据的一部分**）──────────────────
     *
     * MEASURED（真实台账，47 行）：t88 那 10 行手工补录里**有 1 行 `kind: 'success'`**，
     * 而它同样没有 `source.where`。⇒ 若先判"缺输入"，这一行会被判成 `unmeasured`；
     * 而它**其实是"真的不必改"** —— 那正是本条验收禁止的合流。
     *
     * ★ 判序的理由（不是风格问题）：
     * ```
     *   · `success` 这一问的答案**不依赖 `where`** —— "这是成功记录，没有要改的东西"
     *     从 `kind` 一格就能判定。⇒ 缺 `where` 挡不住它。
     *   · 而 `rejection`/`insight` 那一问要的是"改哪里" ⇒ 缺 `where` **确实**挡得住它。
     * ⇒ 顺序：先判**结论不受缺格影响的**那一支，再判**依赖缺格的**那一支。
     * ★ 反过来（先判缺格）就会把"确实不必改"折叠进"判不了" —— 而两者的
     *   补救动作相反（一个是收工，一个是回去补输入）。
     * ```
     */
    /** ★ ① 成功记录 ⇒ 真的不必改（★ 与 ② 不同形：这一条**测得了**，且结论是"不用改"）。 */
    if (signal.kind === 'success') {
        return {
            needChange: false,
            modality: 'none',
            why: `routing: this signal recorded a SUCCESS (kind: 'success'), not a rejection — there is nothing to change`
                + (where === '' ? ' (it names no source.where, and it does not need to: the answer "nothing to change" does not depend on where it happened)' : ` at "${where}"`)
                + ' (a success signal that became a proposal would be the loop inventing work for itself)',
            ...(() => { const t = targetOf(signal); return t === undefined ? {} : { target: t.target }; })(),
        };
    }
    /** ★ ② 缺输入 ⇒ 判不了（说不清是谁在哪拒的，就谈不上怎么改）。 */
    if (where === '' || message === '') {
        return unmeasuredDecision(`routing: cannot decide what to change — the signal is missing `
            + `${where === '' ? 'source.where' : ''}${where === '' && message === '' ? ' and ' : ''}${message === '' ? 'message' : ''} `
            + `(a signal that cannot say where it was rejected cannot say what to change)`);
    }
    /** ★ ③ 有判据 id ⇒ 机械靶。 */
    if (gateId !== '') {
        return {
            needChange: true,
            modality: 'hard',
            why: `routing: the rejection at "${where}" names gate "${gateId}" — that gate is a machine-checkable predicate, `
                + 'so the change is to the predicate itself (add a clause / fix its input), not to a prompt',
            target: { kind: 'gate', ref: gateId },
        };
    }
    /**
     * ★ ④ 只有 where ⇒ 一条要人实施的任务契约。
     *   ★ 而 `target` 只能是描述性的（`targetOf` 的第二路）—— 不编判据名。
     */
    const described = targetOf(signal);
    return {
        needChange: true,
        modality: 'contract',
        why: `routing: the rejection at "${where}" records no gate id — the criterion that fired cannot be named, `
            + 'so the fix has to be spelled out as a task contract rather than as a predicate change',
        ...described === undefined ? {} : { target: described.target },
    };
}
/**
 * ★★ `effect` 的**靶**：这条提案生效后，哪个 `(component, kind)` 桶该下降。
 *
 * ★ 它必须**总是**给出（§N2 acceptance ② 要"至少一条带 target 与 effect"，
 *   而这里把 `effect` 做成**无条件**的）—— 理由：`effect` 是**与评估器的接口**
 *   （`MODULE-IO-CONTRACTS.md` §3.2：没有它，收益就只能靠感觉）。
 *   ★ 而缺省那条**不是编的**：它就是这条信号自己落进的那个桶
 *   （`read.ts` 的 `healthRecordOf` 用的同一套投影：`component ← source.where`、
 *   `kind ← [signal.kind]`），所以"这条不再发生"**必然**让那个桶下降。
 */
function effectOf(signal) {
    const component = signal.where?.trim() ?? '';
    const kind = signal.kind === undefined || signal.kind.trim() === '' ? '(unclassified)' : signal.kind.trim();
    /** ★ `component` 为空时**不编**一个桶名 —— 让它显式缺席（`(unattributed)` 是 health.ts 的兜底，不是这里编的）。 */
    return component === '' ? { component: '(unattributed)', kind: [kind] } : { component, kind: [kind] };
}
/**
 * ★ 一份提案的 `contract` —— 从信号**能读出什么就写什么**，读不出就**不写**。
 *
 * ★★ 这里最容易犯的错是"把 `message` 原文抄进 `objective` 就算完"——
 *   那会产出一张**看起来完整**、而 `acceptance` 是空的任务契约，
 *   而空验收的任务在派发闸门上是**会被拒**的（`implementation/repair` 类必须带验收）。
 *   ⇒ 所以 `acceptance` 至少给一条**可读真假**的断言："这条信号不再出现"。
 *
 * ★ 而 `verify` **不写**：一句机械命令要从一条自由文本 `message` 里编出来，
 *   编出来的那条命令**必然**是在杜撰 —— 那正是本仓反复记账的"恒真验收"的来源。
 *   ⇒ 缺 `verify` 是**诚实**的（`create_task` 里 `verify` 是可选）。
 */
function contractOf(signal) {
    const where = signal.where?.trim() ?? '';
    const gateId = signal.gateId?.trim() ?? '';
    const bucket = effectOf(signal);
    const subject = gateId !== ''
        ? `Stop the rejection at ${gateId}`
        : `Stop the rejection at ${where}`;
    return {
        subject,
        /** ★ 质量类才需要验收；这里给 `repair`（它**就是**在修一条反复发生的拒绝）。 */
        kind: 'repair',
        objective: `Make "${where}" stop rejecting with: ${signal.message}`,
        /** ★★ 至少一条**可读真假**的断言 —— 不是"改好了"，而是"这个桶降了"。 */
        acceptance: [
            `the (${bucket.component}, ${bucket.kind.join(',')}) bucket drops below its reading at the time this proposal was produced`
                + (gateId === '' ? '' : `, and the rejection message from ${gateId} no longer appears in signals.jsonl`),
        ],
        inScope: [where],
        nonGoals: [
            'this proposal does NOT widen or relax the criterion that fired — if the criterion is itself in loop B '
                + '(collection-gates / verify-command / confidence-threshold), changing it is a human decision',
        ],
    };
}
/**
 * ★★★ **把一条信号转成一份提案** —— `propose.ts` 的产生方（t4 / §N2 第 ② 步）。
 *
 * @param signal  - 一条信号（两代形状都收，见 {@link RoutableSignal}）。
 * @param knownMax - 既有提案的最大编号（★ 由调用方给：本模块**不读盘**）。
 * @param context - 分流要用的既有读数（**可选** —— 缺席时 `why` 会如实说明口径）。
 * @returns 三态之一（见 {@link SignalRoute}）。★ **从不抛**：一条坏信号不许让整批消失。
 */
export function routeSignal(signal, knownMax, context = {}) {
    const decision = decideRouting(signal);
    /** ★ 判不了 / 不必改 ⇒ **没有提案**，而两者的 `modality` 已经不同形。 */
    if (decision.modality === 'unmeasured')
        return { outcome: 'unmeasured', decision };
    if (decision.modality === 'none')
        return { outcome: 'none', decision };
    /**
     * ★ 这里只剩 `hard` / `contract`（`soft` 不由分流产出，见 {@link decideRouting}）。
     *   ⇒ 两者都产出一份**可执行**的提案。
     */
    const effect = effectOf(signal);
    const routed = {
        ...decision,
        effect,
        why: context.bucketCounts === undefined
            ? `${decision.why}. The effect bucket is derived from this signal alone `
                + `(${JSON.stringify(effect)}); no batch reading was supplied, so it does not claim a share of a total.`
            : `${decision.why}. The effect bucket is ${JSON.stringify(effect)}, `
                + `which currently holds ${context.bucketCounts.get(`${effect.component}|${effect.kind.join(',')}`) ?? 0} `
                + `of ${context.batchSize ?? 0} signals in this batch.`,
    };
    return {
        outcome: 'produced',
        decision: routed,
        proposal: {
            id: nextProposalId(knownMax),
            at: signal.at ?? 0,
            contract: contractOf(signal),
            routing: routed,
            from: [signal.id],
        },
    };
}
/**
 * ★ 分流一整批 —— `routeSignal` 的批处理面（**纯函数**，同一条纪律）。
 *
 * @param signals - 一批信号（顺序即 id 分配顺序 ⇒ 可复现）。
 * @param knownMax - 既有提案的最大编号（★ 由调用方给）。
 * @param context - 可选读数。
 */
export function routeSignals(signals, knownMax, context = {}) {
    const byModality = {
        hard: 0, soft: 0, contract: 0, none: 0, unmeasured: 0,
    };
    const proposals = [];
    const reasons = new Map();
    let produced = 0;
    let none = 0;
    let unmeasured = 0;
    /** ★ 逐条推进 id —— 同一条信号无论跑几次都拿到同一个 id（可复现）。 */
    let cursor = Number.isFinite(knownMax) && knownMax > 0 ? Math.floor(knownMax) : 0;
    for (const signal of signals) {
        const route = routeSignal(signal, cursor, context);
        byModality[route.decision.modality] += 1;
        if (route.outcome === 'produced') {
            produced += 1;
            cursor += 1;
            /** ★ `proposal` 在 `produced` 分支上必然在场（见 `routeSignal` 的三个 return）。 */
            proposals.push(route.proposal);
        }
        else if (route.outcome === 'none') {
            none += 1;
        }
        else {
            unmeasured += 1;
            reasons.set(route.decision.why, (reasons.get(route.decision.why) ?? 0) + 1);
        }
    }
    return {
        total: signals.length,
        produced,
        none,
        unmeasured,
        byModality,
        proposals,
        unmeasuredReasons: [...reasons.entries()]
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([why, count]) => ({ why, count })),
    };
}
