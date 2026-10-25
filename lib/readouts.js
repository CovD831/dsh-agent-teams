/**
 * ── 读数槽位容器：四条并行开发线的**唯一**汇合点（2026-10-23，地基件）─────────────
 *
 * ── 为什么需要一个容器 ────────────────────────────────────────────────────────
 *
 * 接下来四条线（证据链 / 软硬配对 / 后端能力位 / 模板库）都要把各自的读数暴露给 UI，
 * 而 UI 的出口只有一个：`src/snapshot.ts` 的 `assembleTeamSnapshot` 的**同一段**
 * `return { … }` 字面量。四条线各自往那里加一行 `...myReadout`,
 * 就是四次对**同一行**的编辑 ⇒ 必然冲突，而且冲突在 rebase 时最难解
 * （三个人的世界树都指向同一个位置）。
 *
 * ⇒ 本模块把"往快照上挂读数"变成"往一个**按槽位分格**的表里登记"，于是：
 *    · 四条线各改**自己那一行**（`contributeReadout('evidence', …)`），互不相邻；
 *    · `snapshot.ts` 只认一个入口（`collectReadouts`），**加第五条线不用改它**。
 *
 * ── ★ 这是一个**零 import 叶子**（硬约束，请勿破坏）────────────────────────────
 *
 * 本文件**不 import 任何模块**（src 内的一律不行，第三方的一律不行）。
 * 理由：它是四条线的共同依赖。一旦它开始依赖某个模块，那个模块的加载顺序、
 * 循环引用、甚至"它是不是已经被初始化"都会变成四条线共同的故障面 —— 而四条线
 * 对彼此的进度一无所知。零依赖是这份文件唯一能兑现"谁都不会被别人的加载卡住"的方式。
 *
 * ★ 推论：`ReadoutContext` 里**不能出现** `TeamState` / `Context` / `TeamTask`
 *   这类 src 内类型（那需要 import）。所以它是**原始值**组成的上下文，见下面那段。
 *
 * ── ★★ 三条"少一条就白做"的纪律（对应任务卡的硬要求）─────────────────────────
 *
 * ① **槽位是预置的，不是开放的**：`READOUT_KEYS` 里就那四个。
 *    一个拼错的 key（`'evidance'`）、或第五个线擅自加一个槽位，**抛错**而不是静默新增
 *    —— 后者会让"这条线的读数没画出来"与"这条线还没开始"在 UI 上同形。
 *
 * ② **失败不许静默**：provider 抛错、或返回 `undefined` ⇒ 该槽位**在场**，
 *    值是 `{ unmeasured: '<一句为什么>' }`。**不是**缺席，**不是** `{}`。
 *    ★ 这是本仓记账最久的一条纪律（「缺席」与「判不了」必须不同形，且两者都
 *      不能退化成"通过"）：如果 provider 崩了就让字段消失，UI 读到的
 *      `readouts.evidence === undefined` 与"这条线还没接"**一模一样**，
 *      于是"读数没出来"永远查不出来。
 *
 * ③ **没登记的槽位不许出现在结果里**：不是 `{}`，是**根本不出现**。
 *    ★ 与 ② 是同一条纪律的两侧：`key 不在对象里` = "这条线没接"（正常态）；
 *      `key 在、值里带 unmeasured` = "接了，但这次没测成"（异常态）。
 *      两者必须能一眼分清，否则 ② 那条就失去意义了。
 *
 * ── ★★★ `collectReadouts` **永不抛出**（它挂在快照的组装路径上）────────────────
 *
 * 它一旦抛，`assembleTeamSnapshot` 整份快照就没了 ⇒ UI 空白 ⇒ 一条读数的故障
 * 升级成"整个面板打不开"。所以：每个 provider **各自** try/catch，一个坏掉
 * 不影响其余三个；而本函数自身没有任何会抛的语句。
 *
 * ── 四条线怎么接（★ 复制这段，只改 key 与函数体）──────────────────────────────
 *
 *     // src/<你那一线>/readout.ts   ← 你自己的文件，别人的槽位不许碰
 *     import { contributeReadout } from '../readouts.ts'
 *     contributeReadout('evidence', async ({ teamId, stateRoot, historic }) => {
 *       // 读盘就用 stateRoot + teamId 自己读（读数=现读，不是读一份副本）
 *       return { … }   // 你这条线的读数；实在没有任何可报的就返回 { counted: 0 }
 *     })
 *
 * ★ 三条**会咬人**的事先写在前面：
 *   1. 认领发生在**模块加载期** ⇒ 你那个 `readout.ts` 必须**真的被 import 一次**
 *      （建议由你自己的模块链拉起来，而不是靠别人记得）。没人 import ⇒ 槽位永远空
 *      ⇒ 结果里那一格**根本不出现** ⇒ 面板上看起来就是"这条线没做"。
 *   2. 一个槽位只能认领一次，重复认领**当场抛**（启动期）。这是为"**两条线抢同一个
 *      槽位**"设的 —— 那种事故必须当场现形，不能靠"后写的赢"把它藏起来。
 *   3. **返回值必须 JSON 可序列化**：`/state` 路由对它整份 `JSON.stringify`
 *      （`src/index.ts` 的 activity route）⇒ 塞 `BigInt` / 循环引用进来，会让
 *      **整个 panels 500**，而不是"这一格坏掉"。★ 本容器**不**替你做这件事的兜底，
 *      因为它无从知道你想丢掉什么、还是想换成一个标记 —— 那是你那条线的决定。
 *
 * @module dsh-agent-teams/readouts
 */
/**
 * 四条线的槽位清单（**唯一的**遍历顺序来源）。
 *
 * ★ 结果里的键序按它走，而不是按登记顺序：于是"谁先加载"不会改变快照的键序
 *   （快照是要做 golden 对比的，键序抖动会让夹具红得莫名其妙）。
 */
const READOUT_KEYS = ['evidence', 'pairing', 'backends', 'templates'];
/** 已登记的 provider，按槽位分格。没登记过的键**不在**表里（见纪律 ③）。 */
const providers = new Map();
/**
 * 认领一个槽位。
 *
 * @param key - 四个预置槽位之一（四条线各认领**自己**那一个）。
 * @param provider - 该槽位的读数提供者。
 * @throws 槽位名不在预置清单里（拼错 / 擅自新增）；该槽位已被认领（重复登记）；
 *         provider 不是函数。
 *
 * ── ★ 为什么重复登记要**抛错**而不是"后者覆盖前者"────────────────────────────
 *
 * 与 `gates/registry.ts` 的 `register()` 同一条理由：静默替换会让
 * 「两条线都在往这个槽位写」与「只有一条线，且它的实现换了」**同形**。
 * 而前者恰恰是本容器要防的事故 —— 它必须当场炸，而不是让一个人悄无声息地消失。
 *
 * ★ 这个抛错发生在**模块加载期**（四条线在自己的模块顶层认领槽位），
 *   所以它表现为启动即失败 —— 这是有意的：一个槽位的归属冲突不该等到
 *   某个用户打开面板时才现形。
 */
export function contributeReadout(key, provider) {
    if (!READOUT_KEYS.includes(key)) {
        throw new Error(`readout slot "${String(key)}" is not one of the ${READOUT_KEYS.length} reserved slots (${READOUT_KEYS.join(', ')}); adding a slot is a product-shape change, not a local edit`);
    }
    if (typeof provider !== 'function') {
        throw new Error(`readout slot "${key}" was contributed without a provider function (got ${typeof provider}); a slot that can never be measured must not be claimed`);
    }
    if (providers.has(key)) {
        throw new Error(`readout slot "${key}" is already claimed; one line owns one slot (silent replacement would make "two lines wrote here" and "one line changed its mind" look identical)`);
    }
    providers.set(key, provider);
}
/**
 * 收集全部已登记槽位的读数。
 *
 * @param context - 见 {@link ReadoutContext}。
 * @returns 槽位 → 读数。**没登记的槽位不出现**；登记了但没测成的槽位值形如
 *          `{ unmeasured: '<一句为什么>' }`。
 *
 * ★ 永不抛出（见文件头）。
 * ★ 各 provider **串行**求值：它们是同一个 UI 刷新的四条读数，两两之间没有
 *   "谁先谁后"的语义；串行让一次故障的报告顺序与登记顺序一致、也让夹具可复现。
 */
export async function collectReadouts(context) {
    const readouts = {};
    for (const key of READOUT_KEYS) {
        const provider = providers.get(key);
        /** 纪律 ③：没登记 ⇒ **根本不出现**（不是 `{}`）。 */
        if (provider === undefined)
            continue;
        try {
            const value = await provider(context);
            /**
             * 纪律 ②：`undefined` 是"这一格没有任何人能给出值"，而"给了但值是 undefined"
             * 与"根本没给"在结果上是同一件事 ⇒ 必须显式变成 `unmeasured`。
             * ★ 说清楚"要报空就报 `{ counted: 0 }`"，否则下一个人还会这么写。
             */
            readouts[key] = value === undefined
                ? { unmeasured: `the ${key} readout provider returned undefined, so this slot was not measured — a provider with nothing to report must say so explicitly (e.g. { counted: 0 }) instead of returning undefined; "not measured" must not look like "nothing to report"` }
                : value;
        }
        catch (error) {
            /**
             * 纪律 ②：provider 抛错 ⇒ 这一格**在场**且带原因。
             * ★ 捕获范围只有 provider 的调用与取值本身 —— 容器自己不做任何可能抛的事。
             */
            readouts[key] = { unmeasured: `the ${key} readout provider threw (${error instanceof Error ? error.message : String(error)}), so this slot was not measured — this is "could not measure", not "nothing to report"` };
        }
    }
    return readouts;
}
