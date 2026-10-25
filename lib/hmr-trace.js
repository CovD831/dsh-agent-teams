/**
 * ── HMR 重载的【可读痕迹】────────────────────────────────────────────────────────
 *
 * ── ★★★ 最重要的结论（2026-10-10 实测，先读这一段）────────────────────────────
 *
 * **「重载发生了」推不出「我的改动生效了」。** 实测把重载拆成三层：
 *
 *     ① watcher 追文件       ✅ 成立  —— `hmr/reload` 事件一条条记下来
 *     ② 模块被重新求值       ✅ 成立  —— 在 `state.js` / `update-task.js` 顶部插
 *                                      求值探针，两者都被重新求值
 *     ③ apply 被重新执行     ❌ 【不】成立 —— 重载 +1，而 apply 里的探针 0 次
 *
 * ── ③ 的确切机制（已坐实，不是猜的）────────────────────────────────────────────
 *
 * 宿主 `Registry.plugin/get` 都用**回调对象的身份**做键：
 *
 *     resolve(plugin) {
 *       if (typeof plugin === "function") return plugin;
 *       if (isApplicable(plugin)) return plugin.apply;   // ★ 键 = apply 函数对象
 *     }
 *
 * 而 HMR 的 `partialReload` 在重新 import 之后：
 *
 *     const plugin = this.ctx.loader.unwrapExports(job?.module?.getNamespace());
 *     ...
 *     reloads.set(plugin, { filename: job.url, runtime: this.ctx.registry.get(plugin) });
 *     //                                                        ^^^^^^^^^^^^^^^^^^^^^^^
 *     //   ★ 重新求值的模块给出【一个新的 apply 函数对象】 ⇒ 这个 get 查不到 ⇒
 *     //     下面那句 `if (!runtime) continue;` 直接跳过整段替换。
 *
 * 实测（本机）：
 *
 *     const m1 = await import('./lib/index.js?gen=1');
 *     const m2 = await import('./lib/index.js?gen=2');
 *     m1.apply === m2.apply   ⇒  false
 *
 * ⇒ ★ 这是**宿主侧的设计限制**（ESM 语义下"重新求值 ⇒ 新函数对象"是必然的），
 *   本仓改不动它。所以正确的动作不是"修它"，而是**让这件事可检测** ——
 *   见 `scripts/verify-reload.mjs`。
 *
 * ── ★★ 而三层在【外部读数上同形】──────────────────────────────────────────────
 *
 *     `hmr/reload` 有事件、`lib/` 是新的、`tsc` 退出码 0、`git status` 干净
 *     —— 而宿主执行的仍是旧代码。
 *
 * ⇒ 这正是本仓记账最久的那条形状：**一个静默的读数，被读成了它恰好想被读成的意思。**
 *   所以本模块只做**痕迹**（说清"重载发生过几次"），而"生效没生效"必须由一次
 *   真实的工具调用回答。
 *
 * ── 它解决的是什么 ────────────────────────────────────────────────────────────
 *
 * `@deepseek-ai/dsh-hmr` 在每次重载之后做两件事（app.asar 内逐字）：
 *
 *     this.ctx.logger.info("reload plugin at %C", path);   // 成功
 *     this.ctx.logger.warn("failed to reload plugin at %C", path);  // 失败
 *     await this.ctx.loader.await();
 *     this.ctx.emit("hmr/reload", reloads);                 // ★ 事件
 *
 * ★★ 而【日志那条路在桌面壳上读不到】——实测：
 *
 *     lsof -p <hostPid> | grep pipe
 *     DeepSeek  37006 abab   6      PIPE ...      ← 宿主日志走 pipe
 *     DeepSeek  37006 abab   7      PIPE ...
 *     DeepSeek  37006 abab  17      PIPE ...
 *     DeepSeek  37006 abab  18      PIPE ...
 *
 *   ⇒ 它**不落文件** ⇒ 从外部没有任何一条读数能回答
 *     「刚才那次重载到底发没发生」。
 *
 * ── ★ 而事件那条路是可用的，而它此前【没有人接】────────────────────────────────
 *
 * 官方声明的签名（app.asar 内逐字）：
 *
 *     name: 'hmr/reload'
 *     mode: 'emit'
 *     signature: "'hmr/reload'(reloads: Map<Plugin, Reload>): void"
 *     summary: 'Module replacements have finished loading.'
 *
 * ★ 本仓**没有**任何监听者（`grep -rn "hmr/reload" src/ scripts/` 为空）
 *   ⇒ 所以这里接上它，把每一次重载落成**磁盘上的一行**。
 *
 * ── ★★ 为什么这是一个【探针】，而不是"顺手记个日志"────────────────────────────
 *
 * 它要回答的是一个**具体且否则不可判定**的问题：
 *
 *     「我改了 src/ → pnpm build 之后，宿主内存里的代码到底换了没有？」
 *
 * ★ 而这个问题的答案**决定两件后果完全不同的事**：
 *   · 换了 ⇒ 本仓`pnpm build` 的工作流成立，改代码不必重启
 *   · 没换 ⇒ 那一次 pnpm build **什么也没生效**，而它读起来完全正常
 *     （`lib/` 是新的、`tsc` 退出码 0、`git status` 干净）
 *
 * ⇒ 与 `runtime.liveness` 同一条纪律：**一个不说话的探针，与被读成"没事"的探针，
 *   是同一件东西。** 所以这里必须留下可读的痕迹，而不是"应该会重载吧"。
 *
 * ── 三条设计约束（各自都实测过，不是偏好）──────────────────────────────────────
 *
 * ① **只写、不读业务状态。** 备份文件放在 `stateDir` 下，与团队状态分开：
 *    `hmr-reloads.jsonl`。它**不是**团队的一部分 —— 判据层不读它。
 * ② **失败不许冒泡。** 写盘失败（磁盘满 / 目录不在 / 权限）绝不能影响重载本身 ——
 *    重载已经发生了，一次记账失败不该把它变成一次失败的重载。
 *    ★ 而失败也**不静默**：往 logger 里留一行，读得到。
 * ③ **有界。** 只保留最近 N 条（默认 50），否则一个长会话会把它写成一个不断增长的文件
 *    —— 而"文件很大"与"它有用"同形。
 *
 * @module dsh-agent-teams/hmr-trace
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
/** 保留最近多少条重载记录（超出则重写成一份只含最新的文件）。 */
export const HMR_TRACE_LIMIT = 50;
/** 痕迹文件名（相对 `stateDir`）。★ 刻意不叫 `team.json` 一类 —— 它不是团队状态。 */
export const HMR_TRACE_FILE = 'hmr-reloads.jsonl';
/**
 * 从一个 `reloads` 载荷里取出模块路径。
 *
 * ★ 三种载荷形状都要能处理（而**分不清时返回 `undefined`，不返回 `[]`**）：
 *   ① `Map<Plugin, Reload>`（官方签名逐字）⇒ 取 value 里的 filename
 *   ② 数组（夹具或未来版本）⇒ 逐项取
 *   ③ 其它 ⇒ `undefined`
 */
export function modulesFromReloads(reloads) {
    const out = [];
    const pick = (entry) => {
        if (entry === null || typeof entry !== 'object')
            return undefined;
        const value = entry;
        for (const key of ['filename', 'file', 'path', 'url']) {
            const candidate = value[key];
            if (typeof candidate === 'string' && candidate !== '')
                return candidate;
        }
        return undefined;
    };
    if (reloads instanceof Map) {
        if (reloads.size === 0)
            return [];
        let decided = false;
        for (const value of reloads.values()) {
            const found = pick(value);
            if (found !== undefined) {
                out.push(found);
                decided = true;
            }
        }
        // ★ 一个都没认出 ⇒ 形状不是我们以为的那样 ⇒ `undefined`，不是 `[]`。
        return decided ? out : undefined;
    }
    if (Array.isArray(reloads)) {
        if (reloads.length === 0)
            return [];
        let decided = false;
        for (const item of reloads) {
            const found = pick(item);
            if (found !== undefined) {
                out.push(found);
                decided = true;
            }
        }
        return decided ? out : undefined;
    }
    return undefined;
}
/** 一句可读的形状摘要（当 `modules` 判不了时，它是唯一能说明"收到的是什么"的东西）。 */
export function shapeOf(reloads) {
    if (reloads instanceof Map)
        return `Map(${reloads.size})`;
    if (Array.isArray(reloads))
        return `Array(${reloads.length})`;
    if (reloads === null)
        return 'null';
    return typeof reloads;
}
/** 把一条记录追加到痕迹文件（有界；失败不影响调用方）。 */
export function appendHmrReload(stateRoot, entry) {
    const file = join(stateRoot, HMR_TRACE_FILE);
    try {
        mkdirSync(stateRoot, { recursive: true });
        let lines = [];
        try {
            lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
        }
        catch {
            /* 文件不存在 ⇒ 从零开始（正常：第一次重载） */
        }
        lines.push(JSON.stringify(entry));
        if (lines.length > HMR_TRACE_LIMIT)
            lines = lines.slice(lines.length - HMR_TRACE_LIMIT);
        writeFileSync(file, `${lines.join('\n')}\n`);
    }
    catch (error) {
        // ★ 失败不冒泡：重载已经发生了，一次记账失败不该把它变成一次失败的重载。
        //   而它也不静默 —— 调用方把这一句交给 logger。
        throw new Error(`could not record the hmr reload trace at ${file}: ${String(error)}`);
    }
}
/**
 * 接上 `hmr/reload`。
 *
 * ★★ 为什么这里需要一个窄化的类型逃逸（而不是直接 `ctx.on('hmr/reload', …)`）——
 *
 * `hmr/reload` 由 `@deepseek-ai/dsh-hmr` 声明，而**本插件不 inject 它**
 * （刻意：`hmr` 是可选的，见下面那条"不许成为启动条件"）。
 * ⇒ 它的名字不在本插件那份 `Events` 表里 ⇒ 直接写会落 `TS2345`（实测）。
 *
 * ★ 与 `harness-compat.ts:72` 处理 `agent/session-start` **同一种做法**：
 *   把"宿主版本相关的一个事件名"收在**一处**窄化里，并写明它为什么在那里。
 *   全仓唯一的 `hmr/reload` 字样就是下面这一行 —— 改宿主时只改它一处。
 *
 * ★ `ctx.on` 在 `hmr` 服务缺席的合成里【是安全的】：事件名不存在 ⇒ 永不触发，
 *   而它不会让 plugin 的 fiber 挂起（不 inject）。这正是我们要的：
 *   这个探针**不许**成为宿主能不能起来的一个条件。
 */
export function installHmrTrace(ctx, stateRoot) {
    /**
     * ★★ 事件名在这里**只出现一次**（下面那个 `on('hmr/reload', …)`）。
     *
     * 第一版把类型面写成 `on(name: 'hmr/reload', …)`，于是同一个字符串在
     * 【类型签名】与【调用】各有一份 —— 臂 7 当场抓到（实测 2 处 > 1 处）。
     * ★ 而那不是洁癖：两份拷贝会分叉，而"分叉了"与"一致"在源码里同形。
     * ⇒ 类型面只写 `name: string`，字面量由调用处那唯一一份给出。
     */
    const external = ctx;
    external.on('hmr/reload', (reloads) => {
        const modules = modulesFromReloads(reloads);
        const entry = {
            at: Date.now(),
            ...modules === undefined ? {} : { modules },
            shape: shapeOf(reloads),
            pid: process.pid,
        };
        try {
            appendHmrReload(stateRoot, entry);
        }
        catch (error) {
            ctx.logger.warn(`agent-teams: ${String(error)}`);
        }
    });
}
/**
 * 读出痕迹（供 `status` 或人读；**判据层不读它** —— 它不是团队状态）。
 *
 * ── ★★ `sincePid`：把"我这个进程写的"从混在一起的一堆里分出来──────────────
 *
 * 文件是**跨进程追加**的：宿主重启、开两个窗口、跑一次 CLI，都会往同一份
 * `hmr-reloads.jsonl` 里续写。于是"痕迹里有 3 条"回答不了真正被问的那个问题 ——
 *
 *     「**我这一次** build 之后，重载到底发生了几次？」
 *
 * ★ 而两者在"文件有内容"这个读数上同形：一个**别的进程**刚写下的重载，
 *   与"我这一进程刚重载过"，读起来一模一样 ⇒ 又是本模块要消灭的那个形状。
 *   `HmrReloadEntry.pid` 早就在场（第 135 行写明"让归属可判定"），这里只是让它**可用**。
 *
 * ── ★ 为什么是【可选】参数，而不是必选 / 也不是另开一个函数──────────────
 *
 * · **必选会让既有调用方静默变意**：`readHmrTrace(dir)` 现在返回全部，
 *   传 `undefined` 与"不传"必须是**同一件事** —— 即"我没有要筛的进程"⇒
 *   返回全部。★ 不许把"没传"读成"筛 pid=undefined"（那会返回 `[]`：
 *   一个**没能确定**的筛选条件，绝不许伪装成"筛出来是空的"这条结论）。
 * · 另开 `readHmrTraceForPid` 会让两份读盘/解析逻辑分叉，
 *   而"分叉了"与"一致"在源码里同形。
 * ⇒ 一个可选参数，一处实现。
 *
 * ★ 定向突变：把下面的 `sincePid === undefined` 删掉（改成无条件 `filter`）
 *   ⇒ 不传参数时返回 `[]` ⇒ 臂 10 的第一半当场红。
 */
export function readHmrTrace(stateRoot, sincePid) {
    try {
        const entries = readFileSync(join(stateRoot, HMR_TRACE_FILE), 'utf8')
            .split('\n')
            .filter((line) => line.trim() !== '')
            .map((line) => JSON.parse(line));
        // ★ 判据只在【传了】的时候生效：`undefined` = "没有要筛的进程" = 全部。
        //   不传 ⇒ 一次 filter 都不做 ⇒ 与改动前逐字同一条路径。
        return sincePid === undefined ? entries : entries.filter((entry) => entry.pid === sincePid);
    }
    catch {
        return [];
    }
}
/**
 * ── ★★ 一次失败距离一次重载多近，才「可能是那次重载造成的」──────────────────────
 *
 * ★ 这个数是**从实测到的间隙**上取的，不是拍的：
 *   `docs/DEFECT-HMR-DURING-MEMBER-TURN.md` 记的四次 `inactive context` 失败，
 *   距各自那一次重载分别是 **538 ms / 11 ms / 537 ms / 6 ms**。
 *   同一份记录里还有两次 `empty_output` 失败，距最近的重载 **65 s / 91 s**
 *   —— 它们与重载无关，而**这一点正是靠"窗口外"这个读数分出来的**。
 *
 * ★ 为什么取 5 s 而不是 1 s：宿主侧的重载是 `debounce: 100` 之后才跑的，
 *   而一次 `pnpm build` 会连写好几个产物 —— **一次构建产生的那一批重载
 *   可能横跨几百毫秒到一两秒**，成员回合落在那一批的尾巴上是常态。
 *   取 1 s 会把"这批里的第二次重载"判成窗口外。
 *
 * ★ 为什么不取 60 s 一类的大值：开发时每十几秒就构建一次，
 *   窗口一宽，**真正的**工作失败就会被成批地算成基础设施故障 ——
 *   那正是本判据要消灭的"两件事同形"，只是换了个方向。
 *
 * ★ 定向突变：把它改成 `0` ⇒ 窗口内一条也命中不了 ⇒ 豁免臂当场红。
 */
export const HMR_FAILURE_WINDOW_MS = 5_000;
/**
 * 在 `at` 之前（含）最近一次重载**是否落在窗口内**；在则返回那一条。
 *
 * ★★ 为什么返回整条记录而不返回 `boolean`：调用方要能把
 *   「哪一次重载、差了多少毫秒」写进它给队长的消息里。
 *   一个 `true` 只能说明"有"，**说不出是哪一次** —— 而人要复现时要的正是那一个数。
 *
 * ── ★ 三个边界，各自是【不同】的结论，不许合并 ─────────────────────────────────
 *
 *   ① 痕迹文件不存在 / 一行也没有 ⇒ `undefined`。这是**正常的初始态**
 *      （没构建过就没有重载），不是"读失败"。
 *   ② 有重载，但都早于窗口 ⇒ `undefined`。**"重载过，但那时还没到这次失败"**。
 *   ③ 有重载落在 `[at - 窗口, at]` ⇒ 返回**最近的那一条**。
 *   ★ 本该有记录却读不出来（`readHmrTrace` 的 `catch`）也落 `undefined` ——
 *     它和 ①② 在"没读到"这一点上同形。这里**故意不区分**：本函数的返回值
 *     只用来决定"要不要豁免一次失败"，而"读不出来"**必须**落回不豁免
 *     （保守的一侧 = 照常上报）。若把读不出来做成第三态让调用方去处理，
 *     迟早有人把它当"豁免"用。
 *
 * ★ 为什么复用 `readHmrTrace` 而不自己读一遍文件：一份读盘/解析逻辑，
 *   两处就会分叉，而"分叉了"与"一致"在源码里同形（见上面那条 `sincePid` 注释）。
 *
 * @param stateRoot - resolved state root（痕迹文件所在目录）。
 * @param at - 那次失败被观察到的时刻（ms epoch）。
 * @param pid - 只想认某个进程写下的重载；`undefined` = 不筛进程。
 */
export function reloadJustBefore(stateRoot, at, pid) {
    let latest;
    for (const entry of readHmrTrace(stateRoot, pid)) {
        // ★ 晚于失败时刻的不算：那是**之后**发生的事，解释不了这一次。
        //   （系统时钟回拨会让它出现；把它算进来等于用未来解释过去。）
        if (entry.at > at)
            continue;
        if (at - entry.at > HMR_FAILURE_WINDOW_MS)
            continue;
        if (latest === undefined || entry.at > latest.at)
            latest = entry;
    }
    return latest;
}
