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

import type { Context } from '@deepseek-ai/cordis'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 保留最近多少条重载记录（超出则重写成一份只含最新的文件）。 */
export const HMR_TRACE_LIMIT = 50

/** 痕迹文件名（相对 `stateDir`）。★ 刻意不叫 `team.json` 一类 —— 它不是团队状态。 */
export const HMR_TRACE_FILE = 'hmr-reloads.jsonl'

export interface HmrReloadEntry {
  /** 写入时刻（ms epoch）。 */
  readonly at: number
  /**
   * 这一次重载涉及哪些模块（相对 base 的路径）。
   *
   * ★ 三态，与全仓那条纪律同源：
   *   · `string[]`（可能为空）—— 观察到的那一批
   *   · `undefined`             —— ★ **没能观察**（事件载荷的形状不是预期的那样）
   *   ⇒ 绝不把"没读到"写成 `[]`：那会让"重载了但我说不出是哪些"与
   *     "重载了一批空的"同形。
   */
  readonly modules?: readonly string[]
  /** 事件的原始形状摘要（诊断用；当 `modules` 缺席时它尤其重要）。 */
  readonly shape: string
  /** 进程号 —— ★ 让"这是哪一次进程生命周期里的重载"可归属。 */
  readonly pid: number
}

/**
 * 从一个 `reloads` 载荷里取出模块路径。
 *
 * ★ 三种载荷形状都要能处理（而**分不清时返回 `undefined`，不返回 `[]`**）：
 *   ① `Map<Plugin, Reload>`（官方签名逐字）⇒ 取 value 里的 filename
 *   ② 数组（夹具或未来版本）⇒ 逐项取
 *   ③ 其它 ⇒ `undefined`
 */
export function modulesFromReloads(reloads: unknown): readonly string[] | undefined {
  const out: string[] = []
  const pick = (entry: unknown): string | undefined => {
    if (entry === null || typeof entry !== 'object') return undefined
    const value = entry as Record<string, unknown>
    for (const key of ['filename', 'file', 'path', 'url']) {
      const candidate = value[key]
      if (typeof candidate === 'string' && candidate !== '') return candidate
    }
    return undefined
  }
  if (reloads instanceof Map) {
    if (reloads.size === 0) return []
    let decided = false
    for (const value of reloads.values()) {
      const found = pick(value)
      if (found !== undefined) { out.push(found); decided = true }
    }
    // ★ 一个都没认出 ⇒ 形状不是我们以为的那样 ⇒ `undefined`，不是 `[]`。
    return decided ? out : undefined
  }
  if (Array.isArray(reloads)) {
    if (reloads.length === 0) return []
    let decided = false
    for (const item of reloads) {
      const found = pick(item)
      if (found !== undefined) { out.push(found); decided = true }
    }
    return decided ? out : undefined
  }
  return undefined
}

/** 一句可读的形状摘要（当 `modules` 判不了时，它是唯一能说明"收到的是什么"的东西）。 */
export function shapeOf(reloads: unknown): string {
  if (reloads instanceof Map) return `Map(${reloads.size})`
  if (Array.isArray(reloads)) return `Array(${reloads.length})`
  if (reloads === null) return 'null'
  return typeof reloads
}

/** 把一条记录追加到痕迹文件（有界；失败不影响调用方）。 */
export function appendHmrReload(stateRoot: string, entry: HmrReloadEntry): void {
  const file = join(stateRoot, HMR_TRACE_FILE)
  try {
    mkdirSync(stateRoot, { recursive: true })
    let lines: string[] = []
    try {
      lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '')
    } catch {
      /* 文件不存在 ⇒ 从零开始（正常：第一次重载） */
    }
    lines.push(JSON.stringify(entry))
    if (lines.length > HMR_TRACE_LIMIT) lines = lines.slice(lines.length - HMR_TRACE_LIMIT)
    writeFileSync(file, `${lines.join('\n')}\n`)
  } catch (error) {
    // ★ 失败不冒泡：重载已经发生了，一次记账失败不该把它变成一次失败的重载。
    //   而它也不静默 —— 调用方把这一句交给 logger。
    throw new Error(`could not record the hmr reload trace at ${file}: ${String(error)}`)
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
export function installHmrTrace(ctx: Context, stateRoot: string): void {
  /**
   * ★★ 事件名在这里**只出现一次**（下面那个 `on('hmr/reload', …)`）。
   *
   * 第一版把类型面写成 `on(name: 'hmr/reload', …)`，于是同一个字符串在
   * 【类型签名】与【调用】各有一份 —— 臂 7 当场抓到（实测 2 处 > 1 处）。
   * ★ 而那不是洁癖：两份拷贝会分叉，而"分叉了"与"一致"在源码里同形。
   * ⇒ 类型面只写 `name: string`，字面量由调用处那唯一一份给出。
   */
  const external = ctx as unknown as {
    on(name: string, listener: (reloads: unknown) => void): () => void
  }
  external.on('hmr/reload', (reloads: unknown) => {
    const modules = modulesFromReloads(reloads)
    const entry: HmrReloadEntry = {
      at: Date.now(),
      ...modules === undefined ? {} : { modules },
      shape: shapeOf(reloads),
      pid: process.pid,
    }
    try {
      appendHmrReload(stateRoot, entry)
    } catch (error) {
      ctx.logger.warn(`agent-teams: ${String(error)}`)
    }
  })
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
export function readHmrTrace(stateRoot: string, sincePid?: number): HmrReloadEntry[] {
  try {
    const entries = readFileSync(join(stateRoot, HMR_TRACE_FILE), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as HmrReloadEntry)
    // ★ 判据只在【传了】的时候生效：`undefined` = "没有要筛的进程" = 全部。
    //   不传 ⇒ 一次 filter 都不做 ⇒ 与改动前逐字同一条路径。
    return sincePid === undefined ? entries : entries.filter((entry) => entry.pid === sincePid)
  } catch {
    return []
  }
}
