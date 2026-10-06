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
import { checkRequires, createRequiresAuditPolicy } from "./requires.js";
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
    /**
     * ★ 输入面核对策略（t6）：**缺省只观察、不拒绝**。构造时读一次环境变量，
     *   与观察名单同一条纪律（见上面 `envValue` 的注释）。
     */
    const requiresPolicy = createRequiresAuditPolicy({ enforceFromEnv: options.enforceRequiresFromEnv });
    return {
        /**
         * 注册一条判据。
         * ★ 重复 id ⇒ 抛错，**不静默覆盖** —— 静默覆盖会让"我换了一条判据"
         *   与"两条判据都在、后一条赢了"在日志里同形。
         */
        register(registration) {
            const { id, point, description, gate, appliesTo, requires } = registration ?? {};
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
            /**
             * ★ `requires` 的形状校验（t6）：必须是字符串数组。
             *
             * MEASURED 的形态（本队见过很多次）：一个形状不对的**可选**字段会被静默丢掉
             * —— 于是"这条判据声明了输入面"与"它没有声明"在日志里同形，而后者正是本轮
             * 要消灭的东西。⇒ 写错就抛错，不静默降级。
             *
             * ★ 缺席是**合法**的（还没声明），空数组也是合法的（声明了"不需要任何一格"）；
             *   `null` / 字符串 / 带非字符串项的数组一律抛错。
             */
            if (requires !== undefined) {
                if (!Array.isArray(requires) || requires.some((entry) => typeof entry !== 'string')) {
                    throw new Error(`gate "${id}" declares "requires" but it is not an array of ctx paths (got ${JSON.stringify(requires)}); declare it as CtxPaths<ThatGateContext>[] so a mistyped path is a compile error instead of a runtime surprise`);
                }
            }
            if (byId.has(id)) {
                throw new Error(`gate "${id}" is already registered; unregister it first (silent replacement would make "swapped" and "both ran" look identical)`);
            }
            byId.set(id, { id, point, description, gate, appliesTo, ...requires === undefined ? {} : { requires } });
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
                    ...typeof reg.appliesTo === 'function' ? { appliesTo: reg.appliesTo } : {},
                    /**
                     * ★ 观察状态是控制台**必须**看得见的东西：一条"开火了却不拦"的判据若
                     *   在清单里与一条正常的判据同形，读清单的人会把流程当成被把关了。
                     */
                    observing: observingGate,
                    ...observingGate && reason !== '' ? { observeReason: reason } : {},
                    /**
                     * ── ★ 输入面声明（t6）也必须在清单里读得出来 ──────────────────────────
                     *
                     * `hasRequires` 与 `requires` 分两件事：前者回答"这条判据声明过输入面
                     * 没有"（本轮要逐步补全的覆盖率读数），后者是声明了哪几格。合成一个
                     * `requires?: string[]` 会让"没声明"与"声明了空数组"同形 —— 而这两件事
                     * 在"输入面接线覆盖率"这件事上恰好是相反的结论。
                     */
                    hasRequires: reg.requires !== undefined,
                    ...reg.requires === undefined ? {} : { requires: reg.requires },
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
            /** 输入面核对（t6）：逐条结论，按注册顺序；**旁路**，见 GateEvaluation.requires。 */
            const requiresChecks = [];
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
                    /**
                     * ★ 不适用 ⇒ **不核对、不报缺失**（t6 的核心闸门）。
                     *
                     * 11 条判据 × 8 个调用点 = 88 种组合，大部分本来就该"不适用"；在那些
                     * 组合上喊"缺这缺那"，正是"教人忽略门禁"的那条老路。⇒ 这一条只记
                     * `status:'skipped'`，它进 `requires.skipped` 计数，**不进** `missing`。
                     *
                     * ── ★ 但"跳过"的【成因】要交给核对层去读（t11 修）────────────────────
                     *
                     * 此前这里传的是 `applies = false`（"调用方说不适用"），于是
                     * `skipReason` 恒为 `'caller'` —— **`'input-surface-absent'` 永远不会出现在
                     * 生产路径上**，t11 的缺口在真实运行里**看不见**，只在夹具直呼
                     * `checkRequires` 时看得见。
                     *
                     * ★ 实测（臂 20 对拍）：同一个 ctx，注册表给 `inputSurfaceAbsent: 0`，
                     *   而 `auditRequires` 给 `2` —— 两个来源对同一批 checks 分叉，
                     *   而它们都被叫做"输入面读数"。
                     *
                     * ⇒ 现在传 `undefined`：注册表仍然**已经判过**适不适用（上面那一行就是），
                     *   它不再重复判定的承诺由"`appliesTo` 只在这一行被调一次"保证；
                     *   而核对层在 `appliesTo` 为假时**重读成因**（读的是 `requires` 声明面，
                     *   不重跑 `appliesTo` 的语义判断 —— 语义那块由推导的闸门格回答）。
                     *
                     * ★ 为什么这个折中不违反"两套口径"：核对层**不重跑** `appliesTo` 来做
                     *   "适不适用"这个决定（那个决定已经由注册表做出了、由这次跳过表达了）；
                     *   它只是**解释**这次跳过。解释需要的信息（声明了哪几格、真实 ctx 上有哪几格）
                     *   本来就只在 `requires` 那一面。
                     */
                    requiresChecks.push(checkRequires(reg, context));
                    continue;
                }
                const produced = assertVerdict(await reg.gate(context), reg.id);
                const verdict = produced;
                /**
                 * ── ★ 输入面核对（t6）：在判据【已经说完话】之后核对一次 ────────────────
                 *
                 * ★ 顺序是刻意的：核对**不决定判据跑不跑**。它只描述"这条判据要的格子，
                 *   真实 ctx 上接没接上" —— 若让核对有权力拦下判据，那就不是"先软后硬"，
                 *   而是把新机制直接升成门禁（本轮明确不做）。
                 */
                requiresChecks.push(checkRequires(reg, context, true));
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
            /**
             * ── ★ 输入面核对结果（t6）：**旁路**，恒在场 ──────────────────────────────
             *
             * `checked` / `skipped` 两个计数必须分开数：11 条判据里大部分在这一轮
             * **不适用**（`skipped`），把它并进 `checked` 会让"核对了 3 条、3 条都齐"
             * 与"核对了 0 条、11 条都跳过了"在读数上同形 —— 那正是本队反复见过的合流。
             *
             * ★ 硬化（`mode==='enforce'`，**显式开关**）时才把缺格子的判据并进 `blockers`：
             *   缺的每一格单独成条，措辞说清"是输入面没接线"，而不是让读日志的人
             *   在一堆判据结论里找。`observe`（缺省）下 `requiresPolicy.blockers()` 恒空，
             *   于是这段代码对裁决**零影响**。
             */
            const incompleteChecks = requiresChecks.filter((check) => check.status === 'incomplete');
            const skippedChecks = requiresChecks.filter((check) => check.status === 'skipped');
            const undeclaredChecks = requiresChecks.filter((check) => (check.gateCellsUndeclared?.length ?? 0) > 0);
            /**
             * ── ★ 这里的合并必须与 `auditRequires` 逐字段对齐（t11）───────────────────────
             *
             * 这一段以前是 `auditRequires` 的**抄写**：两处各写一遍合并规则。抄写的代价在
             * t11 当场兑现了 —— `auditRequires` 加了两个成因计数，而这里没加，于是两处
             * 对**同一批 checks** 产出不同的读数，而它们都被叫做 `requiresField`。
             * 那正是本队反复见过的形态：同一件事有两个来源，分叉之后在日志里同形。
             *
             * ★ 修法不是"记得同步改两处"（那要靠纪律），而是让**形状**提示差异：
             *   `RequiresAuditFieldView` 与 `RequiresAudit` 是同一个形状的两个视图，
             *   下面每一项都逐条对着它的一个字段；臂 12 钉住"两处产出的读数相等"——
             *   谁再抄漏一个字段，那条臂就红。
             */
            const requiresField = {
                checked: requiresChecks.filter((check) => check.status !== 'skipped').length,
                incomplete: incompleteChecks.length,
                skipped: skippedChecks.length,
                /**
                 * ★ 两个成因分开数（t11）：`notApplicable` 是"判据按设计闭嘴"（正常），
                 *   `inputSurfaceAbsent` 是"它静默跳过、而原因不是任务类型"（要去看一眼）。
                 *   合成一个 `skipped` 正是 t11 要修的缺口本身。
                 */
                notApplicable: skippedChecks.filter((check) => check.skipReason === 'not-applicable').length,
                inputSurfaceAbsent: skippedChecks.filter((check) => check.skipReason === 'input-surface-absent').length,
                /** ★ 声明缺口（要人补声明）与接线缺口 `missing`（要人补接线）分列，补救动作才可判定。 */
                gateCellsUndeclared: undeclaredChecks.map((check) => `[${check.id}] its appliesTo reads ${check.gateCellsUndeclared.join(', ')}, which the gate does not declare in requires — that wiring is not checked by anything (a declaration gap, not a wiring defect)`),
                missing: incompleteChecks.map((check) => `[${check.id}] declares ${check.missing.length} ctx path(s) that this context does not carry: ${check.missing.join(', ')}`),
                checks: requiresChecks,
            };
            for (const item of requiresPolicy.blockers(requiresField))
                blockers.unshift(item);
            if (unmeasuredReasons.length > 0) {
                return {
                    ok: false, unmeasured: unmeasuredReasons.join('; '), blockers, ran, outputs: collected,
                    ...counts, ...observedField, requires: requiresField, ...allSkipped === undefined ? {} : { skippedAll: allSkipped },
                };
            }
            if (blockers.length > 0) {
                return {
                    ok: false, blockers, ran, outputs: collected,
                    ...counts, ...observedField, requires: requiresField, ...allSkipped === undefined ? {} : { skippedAll: allSkipped },
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
                ...counts, ...observedField, requires: requiresField, ...allSkipped === undefined ? {} : { skippedAll: allSkipped },
            };
        },
    };
}
