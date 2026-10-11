import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
/**
 * ── ★★★ 故障隔离外壳（t18）───────────────────────────────────────────────────────
 *
 * ── 它防的是什么（借自 `@linxin666/dsh-web-all` 的 shell/degraded 设计）────────────
 *
 * DSH 的 Loader 把 patch 里的每一行当作**同一次挂载事务**里的一个插件。任何一个插件
 * 的 import / start 失败，都可能让用户**整个 Web UI 起不来** —— 而这在本仓库里
 * 已经真实发生过一次：一个 `ERR_MODULE_NOT_FOUND` 让桌面 UI 卡在 'starting'，
 * 一整棵插件树挂载失败。
 *
 * ⇒ 我们要的形状是：**AgentTeams 自己的缺陷只让它自己降级，不牵连宿主。**
 *
 * ── ★ 实测：`ctx.plugin()` 对 `apply()` 抛错**已经**是隔离的（但只在日志里）──────
 *
 * MEASURED（t18，本机 cordis 4.0.4）：
 *
 *     ctx.plugin({ name:'thrower', apply(){ throw new Error('sync boom') } })
 *     ⇒ ctx.plugin() **正常返回**（同步抛错被 `composeError` 捕获，不冒给调用方）
 *     ⇒ 兄弟插件**照常**挂载（实测：thrower 之后的 sibling 仍然 mounted）
 *     ⇒ 而错误**只**落进 `ctx.logger.error(...)` 一行
 *
 * ⇒ ★★ 所以本任务**不是**"让 cordis 别崩"（那一层已经做到了）——
 *   而是**把那个失败变成可查询的**。一句日志会随滚动消失，
 *   而**读不到原文的失败与健康启动在观测上同形** —— 那正是本队记账最久的形态。
 *
 * ── 三态（本仓一贯的纪律：三者必须不同形）──────────────────────────────────────
 *
 *     `healthy`      —— apply 跑完了，一条降级记录都没有
 *     `degraded`     —— apply 在某个**阶段**抛了；带着阶段名 + 原文
 *     `not-mounted`  —— 外壳**根本没被调用过**（宿主没挂这一行 / patch 把这一行漏了）
 *     ★ 第三态**不许**并进 `healthy`：一个"从没尝试挂载"的插件与一个"挂好了"的插件
 *       在只读 `healthy/degraded` 的实现里同形，而那会把"这一行没接上"读成"一切正常"。
 *
 * ── ★★ 而"降级"绝不许被读成"成功"（反向半边）───────────────────────────────────
 *
 * 外壳**永不抛错**，所以它必须**同时**把失败说清楚：`degraded` 里带上阶段与原文，
 * 而总状态**不**是 healthy。一个"吞掉异常然后报健康"的外壳，比不隔离更坏 ——
 * 它把一次可见的崩溃换成一次静默的半吊子启动。
 */
export type ShellStage = 
/** 加载插件模块本体（动态 import）—— 对应 `ERR_MODULE_NOT_FOUND` 那一次事故。 */
'import'
/** 调用插件的 `apply()`。 */
 | 'apply';
/** 一条降级记录：**哪个阶段**失败、**原文**是什么、何时发生。 */
export interface DegradedEntry {
    /** 插件身份（本行 patch 的名字）。 */
    readonly plugin: string;
    readonly stage: ShellStage;
    /** 原文（`error.message`）。★ **不截断**：截断的原文会让"为什么"这半句读不出来。 */
    readonly reason: string;
    /** 错误的 `code`（`ERR_MODULE_NOT_FOUND` 那一类）；读不出来 ⇒ 缺席（**不猜**）。 */
    readonly code?: string;
    /** ISO 时刻。 */
    readonly at: string;
}
/**
 * 宿主插件的挂载结果 —— 外壳的**可查询**产出。
 */
export interface ShellStatus {
    readonly plugin: string;
    /**
     * 三态。★ 它们**必须**互不同形（见上面那段）。
     */
    readonly state: 'healthy' | 'degraded' | 'not-mounted';
    /** `state === 'degraded'` 时的那一条；其余情形为空数组（**不伪造**）。 */
    readonly degraded: readonly DegradedEntry[];
}
/** 把一次抛出读成一条降级记录 —— `code` 读不出来就**不写**（编一个比没有更坏）。 */
export declare function degradedEntryOf(plugin: string, stage: ShellStage, error: unknown, at?: Date): DegradedEntry;
/**
 * 一个**永不抛错**的挂载外壳。
 *
 * ★ 它与 `web-all` 的 shell 同一形状：动态 import 包 try/catch、`apply` 的同步抛出与
 *   **promise rejection 都捕获**，并把结果记进一份**可供第三方查询**的状态里。
 *
 * ★★ 为什么 `apply` 的返回值也要 `await`：`apply` 可以是 `async`，那时它的抛出
 *   表现为一个 **rejected promise** —— 与同步抛出**不同形**，而只做 `try/catch`
 *   外壳会**漏掉**后者（实测：`async apply(){ throw }` 在只捕同步的实现下静默通过）。
 *   ⇒ 两条路都要接。
 *
 * @returns 这份状态的**读取器**（恒可调用；挂载失败也照常可读 —— 那正是它的用途）。
 */
export declare function pluginShell(plugin: string, options: {
    /** 动态 import 插件模块本体；省略 ⇒ 跳到 `apply` 那一步。 */
    load?: () => Promise<unknown>;
    /** 插件的 `apply`。 */
    apply: (...args: never[]) => unknown;
    /** 记录降级的地方（缺省进 console）；**不许**依赖它来让状态可读。 */
    log?: (entry: DegradedEntry) => void;
}): {
    readonly status: ShellStatus;
    mount: (...args: never[]) => Promise<ShellStatus>;
};
/** Public WebServer route surface used by the plugin. */
export interface WebRouteHost {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
export type BrowserRequestGate = Pick<HostConnectionService, 'requestRejection'>;
export declare class RequestBodyError extends Error {
    readonly status: 400 | 413;
    constructor(message: string, status: 400 | 413);
}
/** Bound memory while draining oversized requests so the route can return 413. */
export declare function readJsonRequest(req: IncomingMessage, maxBytes?: number): Promise<Record<string, unknown>>;
/** Raw WebServer routes do not inherit Connection's authentication fence. */
export declare function authenticatedWebRoutes(server: WebRouteHost, connection: () => BrowserRequestGate | undefined): WebRouteHost;
/**
 * ── ★★★ 降级状态的可读出口（t18）：`GET /plugins/dsh-agent-teams/degraded` ─────────
 *
 * 契约原话：**「把失败状态通过一条路由报出来，而不是只报在控制台」** ——
 * 因为一行控制台会消失，而**读不到原文的失败与健康启动同形**。
 *
 * ── ★★ 它为什么只许回环访问（借 `web-all` 的 127.0.0.1 / ::1 围栏）──────────────
 *
 * 一条"这个插件为什么没挂起来"的路由会说出内部细节：模块路径、错误原文、
 * 甚至 (`ERR_MODULE_NOT_FOUND`) 里带的**绝对路径**。那些东西对**本机排障的人**是必需的，
 * 对**网络上的任何人**则是信息泄露。⇒ 围栏按**连接来源地址**判，不看 Host 头
 * （Host 头是调用方可控的，拿它当安全判据等于没有判据）。
 *
 * ★ 非回环 ⇒ **404**（**不是** 403）：403 等于承认"这里有一条你不许看的路由"，
 *   而 404 让它与"这个插件没装"同形 —— 探测者拿不到任何额外信息。
 *
 * ★ 三态在**响应体**上不同形（与外壳的 `state` 一致）：
 *   `healthy` / `degraded` / `not-mounted`，且 `degraded` 的那条带阶段 + 原文 + code。
 */
export declare function loopbackOnlyRoute(host: WebRouteHost, path: string, read: () => unknown): () => void;
