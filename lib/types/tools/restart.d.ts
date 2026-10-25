import type { ModuleFreshness } from './shared/entities.ts';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolsConfig } from './shared/entities.ts';
/**
 * ── ★★★ 一次重载之后，「这个进程跑的到底是不是盘上的代码」── 由【测量】回答 ─────────
 *
 * ★ 缺陷（t11 记账的对象）：本工具的 description 曾逐字写
 *   「reload this plugin so subsequent calls run the code now on disk」，
 *   而那个承诺是假的。两处实测各自独立坐实了它：
 *
 *     · `src/hmr-trace.ts` 文件头 ③：重载 +1，而 apply 里的求值探针 **0 次**
 *       （宿主的 `Registry.plugin/get` 用**回调对象身份**做键 ⇒ 重新求值给出的
 *        是一个**新的** apply 函数对象 ⇒ 查不到 ⇒ 整段替换被跳过）
 *     · `docs/RESEARCH-RESTART-FREE.md` §2：`fiber.restart()` 的调用链
 *       `_unload() → _reload() → _execute(this._runner)` 里，
 *       `_runner.execute` 调的是**构造时捕获的** `runtime.callback`
 *       ⇒ 重跑的是【同一份已缓存模块】的 apply：**能拿新配置，永远拿不到新代码**
 *
 * ⇒ 所以「重载成功」这个动作结果，与「盘上的代码生效了」这个状态变化，
 *   是**两件事**，而旧措辞把它们写成了一件。这正是本队记账最久的那条形状：
 *   **一个动作说它做了某件事，而它做的是另一件事，而两者在措辞上同形。**
 *
 * ── ★ 修法不是"把话说模糊"，而是【换一个能被测量的问句】───────────────────────
 *
 * 契约明确禁止 `may or may not take effect` 那种措辞 —— 它与旧措辞**同样不可判**。
 * 所以这里不做"重载可能没生效"的免责声明，而是回答一个**有读数**的问题：
 *
 *     此刻，这个进程持有的构建，与盘上的构建，是不是同一个？
 *
 * ★ 这个问题**恰好**就是"后续调用会不会跑盘上的代码"—— 因为 `fiber.restart()`
 *   **不可能**改变答案（上面那条调用链里没有一次 import、没有一次缓存删除）。
 *   ⇒ 于是"重载之后"与"重载之前"是同一个答案，**不必**在重载之后再测一次
 *     （重载之后本 fiber 已被 dispose，那时的读数反而更不可靠）。
 *   ★ 而这不构成恒真：这个读数**照实**可以在 'yes' 与 'no' 之间取值 ——
 *     进程本来就持有当前构建时会答 'yes'（此时"后续调用跑盘上代码"是**真的**），
 *     持有旧构建时答 'no' 并**指名两个构建**。两个方向都有臂钉住。
 *
 * ★ 三态，与全仓纪律同源：`yes` / `no` / `unmeasured`。
 *   **绝不**把"没能测量"并进任何一侧 —— 那会把『不知道』读成『生效了』。
 */
export type CodeOnDiskInEffect = 
/** 进程持有的就是盘上那一版 ⇒ 「后续调用跑盘上的代码」为真。 */
{
    readonly kind: 'yes';
    readonly build: string;
}
/**
 * 进程持有的是**另一版** ⇒ 那句承诺为假，且**这一次重载并没有、也不可能**改变它。
 * ★ 带上两个构建的指纹：只说"没生效"仍然要人去猜"那跑的是哪一版"。
 */
 | {
    readonly kind: 'no';
    readonly loaded: string;
    readonly onDisk: string;
}
/** 测不出来 ⇒ 明说测不出来（**不是** 'yes'，也**不是** 'no'）。 */
 | {
    readonly kind: 'unmeasured';
    readonly reason: string;
};
/**
 * 把一次 `moduleFreshness()` 读数翻译成「盘上的代码生效了吗」。
 *
 * ★ 为什么**复用** `moduleFreshness` 而不是自己再读一遍盘：
 *   那个函数已经处理了"加载时读一次 / 调用时读一次"的取值时机（f-0025/f-0026）、
 *   提交维的祖先关系、以及三种"读不到"的成因。再写一份读盘逻辑 ⇒ 两份会分叉，
 *   而"分叉了"与"一致"在源码里同形。
 */
export declare function codeOnDiskInEffectFrom(freshness: ModuleFreshness): CodeOnDiskInEffect;
/**
 * 一句可读的结论 —— 它必须能**单独**回答「这一次到底生效了没有」。
 *
 * ★ 三个分支各自不同形（本队那条三态纪律）：一个读的人不该需要
 *   再去比对别处的读数才能知道这一句属于哪一侧。
 */
export declare function codeOnDiskInEffectMessage(effect: CodeOnDiskInEffect): string;
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export declare function register(ctx: Context, config: ToolsConfig): void;
