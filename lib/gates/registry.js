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
/** 五个【位置】，不是五个判据。一个位置可挂零到多条。 */
export const INSERTION_POINTS = Object.freeze([
    'contract', // ① 建任务 / 改契约
    'dispatch', // ② 派发前（成员开工）
    'completion', // ③ 成员汇报完成
    'delivery', // ④ 团队宣布交付
    'runtime', // ⑤ 全程（跨步骤的过程约束；告警，不直接拒任务）
]);
/**
 * 一条判据的裁决。**三态，不是两态。**
 *
 *  - `{ ok: true }`                        —— 测了，没问题
 *  - `{ ok: false, blockers: [...] }`      —— 测了，发现问题（必须说清为什么）
 *  - `{ ok: false, unmeasured: string }`   —— ★ 没能测量
 */
export function ok() {
    return { ok: true };
}
export function blocked(...blockers) {
    const list = blockers.flat().filter((item) => typeof item === 'string' && item.trim() !== '');
    if (list.length === 0) {
        throw new Error('a gate that blocks must say why: blocked() needs at least one non-empty blocker');
    }
    return { ok: false, blockers: list };
}
export function unmeasured(reason) {
    if (typeof reason !== 'string' || reason.trim() === '') {
        throw new Error('unmeasured() must say what could not be measured');
    }
    return { ok: false, unmeasured: reason };
}
/** 校验一条裁决的形状。非法形状【抛错】而不是被当成通过 —— 一个形状错误的裁决是最危险的。 */
function assertVerdict(verdict, id) {
    if (verdict === null || typeof verdict !== 'object') {
        throw new Error(`gate "${id}" returned a malformed verdict (expected {ok:boolean}): ${JSON.stringify(verdict)}`);
    }
    const v = verdict;
    if (typeof v['ok'] !== 'boolean') {
        throw new Error(`gate "${id}" returned a malformed verdict (expected {ok:boolean}): ${JSON.stringify(verdict)}`);
    }
    if (v['ok'] === false) {
        const hasBlockers = Array.isArray(v['blockers']) && v['blockers'].length > 0;
        const hasUnmeasured = typeof v['unmeasured'] === 'string' && v['unmeasured'].trim() !== '';
        if (!hasBlockers && !hasUnmeasured) {
            throw new Error(`gate "${id}" returned ok:false but said neither why (blockers) nor that it could not measure (unmeasured)`);
        }
        if (hasBlockers && hasUnmeasured) {
            throw new Error(`gate "${id}" returned both blockers and unmeasured; pick one — "found problems" and "could not measure" are different claims`);
        }
    }
    return verdict;
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
export const OBSERVE_GATES_ENV = 'AGENT_TEAMS_OBSERVE_GATES';
/** 解析环境变量里的观察名单（导出以便夹具钉住解析规则本身）。 */
export function observeIdsFromEnv(value) {
    if (typeof value !== 'string')
        return [];
    return [...new Set(value.split(',').map((id) => id.trim()).filter((id) => id !== ''))];
}
export function createGateRegistry(options = {}) {
    /** @type {Map<string, object>} */
    const byId = new Map();
    /** id → 观察期说明（不在其中 ⇒ 该判据有否决权，即今天的行为）。 */
    const observing = new Map();
    /**
     * ★ 环境变量的求值时机：**构造时读一次**，不是每次 evaluate 时读。
     *   进程内改环境变量会让同一次运行里的两次求值用两套门禁 —— 那是最难归因的
     *   一类缺陷（同一个输入两次跑出不同裁决）。夹具要换名单就新建一个实例。
     *   `observeFromEnv` 参数让夹具不必去动 process.env（动全局状态会让用例互相污染）。
     */
    const envValue = options.observeFromEnv !== undefined ? options.observeFromEnv : process.env[OBSERVE_GATES_ENV];
    for (const id of observeIdsFromEnv(envValue)) {
        observing.set(id, `observed by ${OBSERVE_GATES_ENV}`);
    }
    return {
        /**
         * 注册一条判据。
         * ★ 重复 id ⇒ 抛错，**不静默覆盖** —— 静默覆盖会让"我换了一条判据"
         *   与"两条判据都在、后一条赢了"在日志里同形。
         */
        register(registration) {
            const { id, point, description, gate, appliesTo } = registration ?? {};
            if (typeof id !== 'string' || id.trim() === '') {
                throw new Error('a gate registration requires a non-empty id');
            }
            if (!INSERTION_POINTS.includes(point)) {
                throw new Error(`gate "${id}" names unknown insertion point "${point}" (known: ${INSERTION_POINTS.join(', ')})`);
            }
            if (typeof gate !== 'function') {
                throw new Error(`gate "${id}" has no gate function`);
            }
            if (typeof description !== 'string' || description.trim() === '') {
                throw new Error(`gate "${id}" requires a description (the console renders it)`);
            }
            if (byId.has(id)) {
                throw new Error(`gate "${id}" is already registered; unregister it first (silent replacement would make "swapped" and "both ran" look identical)`);
            }
            byId.set(id, { id, point, description, gate, appliesTo });
            return registration;
        },
        unregister(id) {
            /** 注销时连观察期标记一起撤掉 —— 否则同一个 id 重新注册会**继承**上一代的观察期，而"我观察过它"与"它现在在观察中"是两件事。 */
            observing.delete(id);
            return byId.delete(id);
        },
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
        observe(id, options = {}) {
            if (typeof id !== 'string' || id.trim() === '') {
                throw new Error('observe() requires a non-empty gate id');
            }
            const reason = typeof options.reason === 'string' ? options.reason.trim() : '';
            observing.set(id, reason);
            return { id, registered: byId.has(id), reason };
        },
        /** 结束观察：这条判据的裁决立刻恢复阻止流程。返回它此前是否在观察中。 */
        unobserve(id) {
            return observing.delete(id);
        },
        /** 这条判据当前是否处在观察模式（缺省 false —— 即今天的行为）。 */
        isObserving(id) {
            return observing.has(id);
        },
        /**
         * 当前观察名单（含尚未注册的 id）。控制台读它。
         *
         * ★ 读它与读 `isObserving` 都【不改裁决】—— 它是一份**配置视图**，
         *   而"谁这一轮真的开火了"是 `GateEvaluation.observed`。两者不同形是刻意的。
         */
        observingIds() {
            return [...observing.entries()].map(([id, reason]) => ({ id, reason, registered: byId.has(id) }));
        },
        /** 控制台读它。按 point 分组，组内保持注册顺序。 */
        list() {
            const out = {};
            for (const point of INSERTION_POINTS)
                out[point] = [];
            for (const reg of byId.values()) {
                const observingGate = observing.has(reg.id);
                const reason = observing.get(reg.id) ?? '';
                out[reg.point].push({
                    id: reg.id,
                    description: reg.description,
                    hasAppliesTo: typeof reg.appliesTo === 'function',
                    /**
                     * ★ 观察状态是控制台**必须**看得见的东西：一条"开火了却不拦"的判据若
                     *   在清单里与一条正常的判据同形，读清单的人会把流程当成被把关了。
                     */
                    observing: observingGate,
                    ...observingGate && reason !== '' ? { observeReason: reason } : {},
                });
            }
            return out;
        },
        /** 该位置已注册的判据条数（控制台/测试用）。 */
        count(point) {
            let n = 0;
            for (const reg of byId.values())
                if (reg.point === point)
                    n += 1;
            return n;
        },
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
        async evaluate(point, context) {
            if (!INSERTION_POINTS.includes(point)) {
                throw new Error(`evaluate() called with unknown insertion point "${point}"`);
            }
            const ran = [];
            const blockers = [];
            const unmeasuredReasons = [];
            /**
             * ★ 判据在被采纳时产出的【结果】(outputs)，按 id 收集。
             *
             * MEASURED（2026-10-05，接第一条真判据时）：`completion.verify-rerun` 通过时
             * 要把【判据层亲眼看到的 exitCode】交回调用方，让它替换掉成员自报的值。
             * 而本注册表此前只回 `{ok, blockers, ran}` —— **那条产出会被静默丢掉**，
             * 于是"通过"这条路径上，成员伪造的 exitCode 仍然留在记录里。
             *
             * ⇒ 一个只能表达"过/不过"的接线层，会强迫判据把结果写进副作用里（日志、
             *   全局变量），而那就又回到"结果散落在各处、无法被控制台读取"的老问题。
             */
            const outputs = new Map();
            /**
             * ★ 该位置【挂了】几条判据 —— 与上下文无关，只数注册表。
             *   它与"跑了 / 跳过"分开数，是为了让空位置与全跳过【不同形】。
             */
            let registered = 0;
            let skipped = 0;
            /** 观察模式：被放过的 blocker / unmeasured 原文（见 GateEvaluation.observed）。 */
            const observedBlockers = [];
            const observedUnmeasured = [];
            for (const reg of byId.values()) {
                if (reg.point !== point)
                    continue;
                registered += 1;
                if (typeof reg.appliesTo === 'function' && reg.appliesTo(context) !== true) {
                    skipped += 1;
                    ran.push({ id: reg.id, verdict: 'skipped' });
                    continue;
                }
                const produced = assertVerdict(await reg.gate(context), reg.id);
                const verdict = produced;
                /**
                 * ★ 这条判据这一轮是否【没有否决权】。
                 *   逐条读快照，而不是循环外读一次 —— 前者与"每条判据各自的状态"同义，
                 *   后者会在求值过程中观察集被改动时给出一个说不清的口径。
                 */
                const observeOnly = observing.has(reg.id);
                if (verdict['ok'] === true) {
                    /**
                     * 除 `ok` 之外的字段都是产出。★ 只在【真的被采纳】时收集 ——
                     * 一条被拒的判据的产出不该被当成结果使用。
                     *
                     * ★ 观察模式【不改这条】：观察中的判据通过时，它的产出照常被采纳 ——
                     *   观察模式放宽的是"否决权"，不是"判据的结论"。顺带钉住一件事：
                     *   `verdict: 'ok'` 的条目【不带】`observed` 字段，因为"放过"这个概念
                     *   在这里没有对象（没有任何裁决被拦下）。
                     */
                    const given = Object.fromEntries(Object.entries(verdict).filter(([key]) => key !== 'ok'));
                    if (Object.keys(given).length > 0)
                        outputs.set(reg.id, given);
                    ran.push({ id: reg.id, verdict: 'ok', produced: Object.keys(given).length > 0 });
                    continue;
                }
                if (Array.isArray(verdict['blockers'])) {
                    const list = verdict['blockers'];
                    const prefixed = list.map((item) => `[${reg.id}] ${item}`);
                    if (observeOnly) {
                        for (const item of prefixed)
                            observedBlockers.push(item);
                        ran.push({ id: reg.id, verdict: 'blocked', count: list.length, observed: true });
                        continue;
                    }
                    for (const item of prefixed)
                        blockers.push(item);
                    ran.push({ id: reg.id, verdict: 'blocked', count: list.length });
                    continue;
                }
                const reason = `[${reg.id}] ${String(verdict['unmeasured'])}`;
                if (observeOnly) {
                    observedUnmeasured.push(reason);
                    ran.push({ id: reg.id, verdict: 'unmeasured', observed: true });
                    continue;
                }
                unmeasuredReasons.push(reason);
                ran.push({ id: reg.id, verdict: 'unmeasured' });
            }
            const collected = Object.fromEntries(outputs);
            const evaluated = registered - skipped;
            /**
             * ★ 「有判据、却一条都没跑」的说明。
             *
             * 只有在【该位置确实挂了判据】时才产出：空位置（`registered === 0`）是正常
             * 情形，不是异常 —— 在那里产出这段话，会让每个还没接判据的位置都读起来像
             * 出了问题，而那正是"把正常读成异常"，与"把异常读成正常"一样有害。
             */
            const allSkipped = registered > 0 && evaluated === 0
                ? `none of the ${registered} gate(s) registered at "${point}" applied to this context; nothing was evaluated, so this step was not checked`
                : undefined;
            const counts = { evaluated, skipped, registered };
            /**
             * ★ `observed` 恒在场（空对象也算在场），另外给一个**可读的计数**。
             *
             * 恒在场是为了让调用方不必写 `?? { blockers: [], unmeasured: [] }`（与
             * `outputs` 同一条纪律：空即空，而不是缺席）。计数只在真有人开火时出现
             * —— 于是"观察期什么都没发生"与"放过了一条真实发现"不同形。
             */
            const observed = { blockers: observedBlockers, unmeasured: observedUnmeasured };
            const observedCount = observedBlockers.length + observedUnmeasured.length;
            const observedField = observedCount > 0 ? { observedBlockers: observedCount, observed } : { observed };
            if (unmeasuredReasons.length > 0) {
                return {
                    ok: false, unmeasured: unmeasuredReasons.join('; '), blockers, ran, outputs: collected,
                    ...counts, ...observedField, ...allSkipped === undefined ? {} : { skippedAll: allSkipped },
                };
            }
            if (blockers.length > 0) {
                return {
                    ok: false, blockers, ran, outputs: collected,
                    ...counts, ...observedField, ...allSkipped === undefined ? {} : { skippedAll: allSkipped },
                };
            }
            /**
             * ★ 全跳过时 `ok` **仍然为 true** —— 这是刻意的，理由见 `GateEvaluation.evaluated`：
             *   "这个位置这一轮没有适用判据"是正常情形（空位置同理），把它翻成 `ok:false`
             *   会让没装判据的位置卡死流程。区分靠 `evaluated` / `skippedAll` 这两个
             *   可读的字段，而不是靠把一个正常情形判成拒绝。
             *
             * ★ 注意：走到这里意味着 `blockers` 为空（上面的分支已拦），所以这里不可能
             *   出现"全跳过却带着 blocker"的自相矛盾 —— 真有 blocker 时它会在上一行返回。
             */
            return {
                ok: true, blockers, ran, outputs: collected,
                ...counts, ...observedField, ...allSkipped === undefined ? {} : { skippedAll: allSkipped },
            };
        },
    };
}
