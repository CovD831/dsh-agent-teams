/** 把一次抛出读成一条降级记录 —— `code` 读不出来就**不写**（编一个比没有更坏）。 */
export function degradedEntryOf(plugin, stage, error, at = new Date()) {
    const code = typeof error?.code === 'string'
        ? error.code
        : undefined;
    return {
        plugin,
        stage,
        reason: error instanceof Error ? error.message : String(error),
        ...code === undefined ? {} : { code },
        at: at.toISOString(),
    };
}
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
export function pluginShell(plugin, options) {
    /**
     * ★ 起始态是 `not-mounted` —— **不是** healthy。
     *   一个"外壳建好了但还没被调用"的读数，与"挂载成功"必须不同形。
     */
    const entries = [];
    let attempted = false;
    const status = () => ({
        plugin,
        state: entries.length > 0 ? 'degraded' : attempted ? 'healthy' : 'not-mounted',
        degraded: [...entries],
    });
    const fail = (stage, error) => {
        const entry = degradedEntryOf(plugin, stage, error);
        entries.push(entry);
        options.log?.(entry);
    };
    return {
        /** ★ 读取器是**活的**（每次现读），不是一份快照 —— 否则挂载完成后它读不到新记录。 */
        get status() { return status(); },
        async mount(...args) {
            attempted = true;
            try {
                if (options.load !== undefined)
                    await options.load();
            }
            catch (error) {
                fail('import', error);
                /** ★ 加载失败 ⇒ **不再**尝试 `apply`（拿不到模块就没有可调的东西）。 */
                return status();
            }
            try {
                /**
                 * ★★ `await` 是刻意的：它同时接住同步抛出与 rejected promise。
                 *   （同步抛出在 `await` 下也表现为异常，两条路因此同形。）
                 */
                await options.apply(...args);
            }
            catch (error) {
                fail('apply', error);
            }
            return status();
        },
    };
}
export class RequestBodyError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
/** Bound memory while draining oversized requests so the route can return 413. */
export async function readJsonRequest(req, maxBytes = 1_000_000) {
    const raw = await new Promise((resolve, reject) => {
        let size = 0;
        let settled = false;
        const chunks = [];
        const finish = (error) => {
            if (settled)
                return;
            settled = true;
            req.off('data', onData);
            req.off('end', onEnd);
            req.off('aborted', onAborted);
            req.off('error', onError);
            if (error) {
                chunks.length = 0;
                // IncomingMessage may still receive data; discard it without buffering.
                req.once('error', () => { });
                req.resume();
                reject(error);
            }
            else {
                resolve(Buffer.concat(chunks).toString('utf8'));
            }
        };
        const onData = (chunk) => {
            const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += part.length;
            if (size > maxBytes)
                finish(new RequestBodyError('request body is too large', 413));
            else
                chunks.push(part);
        };
        const onEnd = () => finish();
        const onAborted = () => finish(new RequestBodyError('request body was aborted', 400));
        const onError = () => finish(new RequestBodyError('invalid request body', 400));
        req.on('data', onData);
        req.once('end', onEnd);
        req.once('aborted', onAborted);
        req.once('error', onError);
    });
    let value;
    try {
        value = raw.trim() === '' ? {} : JSON.parse(raw);
    }
    catch {
        throw new RequestBodyError('invalid JSON', 400);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new RequestBodyError('body must be an object', 400);
    }
    return value;
}
/** Raw WebServer routes do not inherit Connection's authentication fence. */
export function authenticatedWebRoutes(server, connection) {
    return {
        register(route) {
            return server.register({
                ...route,
                async handler(req, res) {
                    const gate = connection();
                    // Missing/disposing Connection is an assembly failure, never an
                    // invitation to expose workspace state or accept plan mutations.
                    const rejection = gate === undefined ? 503 : gate.requestRejection(req);
                    if (rejection !== undefined) {
                        res.writeHead(rejection, {
                            'content-type': 'application/json; charset=utf-8',
                            'cache-control': 'no-store',
                        });
                        res.end(JSON.stringify({ error: rejection === 503 ? 'authentication unavailable'
                                : rejection === 401 ? 'unauthorized' : 'forbidden' }));
                        return;
                    }
                    await route.handler(req, res);
                },
            });
        },
    };
}
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
export function loopbackOnlyRoute(host, path, read) {
    return host.register({
        kind: 'exact',
        path,
        handler(req, res) {
            /**
             * ★ 判据是**远端地址**，不是 `req.headers.host`。
             *   `undefined`（无 socket，例如被直接调用的夹具）⇒ 按**非回环**处置：
             *   安全默认值是"关"，而"关"必须能让排障的人看见 —— 见下面那条 `via` 说明。
             */
            const remote = req.socket?.remoteAddress;
            const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
            if (!isLoopback) {
                res.writeHead(404, { 'cache-control': 'no-store' });
                res.end();
                return;
            }
            res.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
            });
            res.end(JSON.stringify(read()));
        },
    });
}
