// ── src/tools/restart.ts ────────────────────────────────────────────────
//
// t39：从 src/tools.ts **逐字搬出**的工具体 + 由调用方注入它需要的共享实体。
// ★ 工具体本身一个字符都没改；变的只是"这些东西从哪来"。
// ★ 本文件不 import src/tools.ts（会成环）。

import { appendTeamEvent } from '../events.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { RESTART_ESCAPE_HATCH_ENV, arbitrateRestartWithEscape, moduleFreshness, requireCaptain, requireCaptainTeam, restartArbitrationMessage, restartEscapeHatchFromEnv, stateRootOf, teamLockKey, workspaceOf } from './shared/entities.ts'
import type { ModuleFreshness } from './shared/entities.ts'
import { readTeam, withTeamLock } from '../state.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolsConfig } from './shared/entities.ts'

/**
 * ★ t49：排队状态机已搬到 `shared/entities.ts` —— 因为
 *   **工具模块之间不许互相 import**（`gate-tool-split` 臂 3）：
 *   `status.ts` 要读它、`restart.ts` 要写它，而那两个都是工具模块。
 *   ⇒ 放在 `shared/` 是这一条约束的**正确解**，不是绕过它。
 *   ★ 而那一条约束本身有道理：跨模块 import 会让"改一个工具"重新牵动另一个。
 */
import { clearRestartRequest, requestRestart } from './shared/entities.ts'

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
  | { readonly kind: 'yes'; readonly build: string }
  /**
   * 进程持有的是**另一版** ⇒ 那句承诺为假，且**这一次重载并没有、也不可能**改变它。
   * ★ 带上两个构建的指纹：只说"没生效"仍然要人去猜"那跑的是哪一版"。
   */
  | { readonly kind: 'no'; readonly loaded: string; readonly onDisk: string }
  /** 测不出来 ⇒ 明说测不出来（**不是** 'yes'，也**不是** 'no'）。 */
  | { readonly kind: 'unmeasured'; readonly reason: string }

/**
 * 把一次 `moduleFreshness()` 读数翻译成「盘上的代码生效了吗」。
 *
 * ★ 为什么**复用** `moduleFreshness` 而不是自己再读一遍盘：
 *   那个函数已经处理了"加载时读一次 / 调用时读一次"的取值时机（f-0025/f-0026）、
 *   提交维的祖先关系、以及三种"读不到"的成因。再写一份读盘逻辑 ⇒ 两份会分叉，
 *   而"分叉了"与"一致"在源码里同形。
 */
export function codeOnDiskInEffectFrom(freshness: ModuleFreshness): CodeOnDiskInEffect {
  if (freshness.status === 'current') return { kind: 'yes', build: freshness.onDisk }
  if (freshness.status === 'stale') {
    return { kind: 'no', loaded: freshness.loaded, onDisk: freshness.onDisk }
  }
  return { kind: 'unmeasured', reason: freshness.reason }
}

/**
 * 一句可读的结论 —— 它必须能**单独**回答「这一次到底生效了没有」。
 *
 * ★ 三个分支各自不同形（本队那条三态纪律）：一个读的人不该需要
 *   再去比对别处的读数才能知道这一句属于哪一侧。
 */
export function codeOnDiskInEffectMessage(effect: CodeOnDiskInEffect): string {
  if (effect.kind === 'yes') {
    return `this process already holds the build on disk (${effect.build.slice(0, 12)}…), `
      + 'so subsequent calls do run the code now on disk'
  }
  if (effect.kind === 'no') {
    return `this process still holds ${effect.loaded.slice(0, 12)}… while the build on disk is ${effect.onDisk.slice(0, 12)}… `
      + '— reloading the plugin does NOT change which code this process runs '
      + '(a fiber restart re-runs apply against the module already loaded); '
      + 'only restarting the host process makes that build take effect'
  }
  return `whether this process holds the build now on disk could NOT be determined `
    + `(${effect.reason}) — that is "not measured", NOT "in effect"`
}

/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx: Context, config: ToolsConfig): void {
    ctx.tools.register(defineTool({
      name: 'agent_teams_restart',
      description: 'Captain-only: re-run this plugin\'s apply() so it picks up its current config. ★ This does NOT change which code the process runs: a fiber restart re-executes apply against the module already loaded in memory (no import, no cache drop), so edits built to disk stay invisible until the HOST PROCESS is restarted. The result therefore reports `code_on_disk_in_effect` — measured, not assumed: "yes" means the process already holds the build on disk, "no" names the build it actually holds, "unmeasured" means it could not be determined. Use after a gate/tool change has been built AND verified. This is an ARBITRATION, not a re-check: it does not re-run the verdict — it only asks whether a passing verdict exists and whether any task is in progress. Refuses when either precondition fails, and says which one.',
      parameters: {
        /**
         * ★ `verdict` 由**调用方**交进来，而不是本工具去跑 `pnpm verify`：
         *   那正是"仲裁"与"状态检查"的分界 —— 判决已经跑完了（用户裁定），
         *   这里只接受它的**结论**。做成必填 ⇒ 一次不说结论的调用是本工具**拒收**的，
         *   而不是被当成"判决通过了"。
         */
        verdict: {
          type: 'string',
          required: true,
          enum: ['passed'],
          description: 'The already-completed verdict for the code now on disk. Only "passed" is accepted; this tool deliberately does not re-run the verdict.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            restarted: { type: 'boolean', required: true },
            /** `'verdict-passed-and-no-work-in-flight'` / `'escape-hatch'`。 */
            reason: { type: 'string', required: true },
            /** ★ 被挡时说明**是哪一条前置**不满足（三态可读）。 */
            blocked_by: { type: 'string' },
            detail: { type: 'string' },
            in_flight: { type: 'array', items: { type: 'string' } },
            /**
             * ★ t49：被拒时**是否已进入队列**（`true` = 收口后会**自动**重载）。
             *   ★ 与 `restarted: false` 并列而不是替代它 ——
             *     "这次没重载"与"它排上队了"是两件事，都要读得出来。
             */
            queued: { type: 'boolean' },
            /** ★ 排队状态：`'waiting'`（会收敛）。 */
            queue_state: { type: 'string' },
            /**
             * ── ★★★ 「这一次到底生效了没有」—— 一个**测量**，不是一个断言 ──────────────
             *
             * ★ 三态，与全仓纪律同源，而三者**互不同形**：
             *
             *     'yes'        —— 进程持有的就是盘上那一版 ⇒ 后续调用**确实**跑盘上的代码
             *     'no'         —— 进程持有另一版 ⇒ 那句承诺**为假**，且重载改变不了它
             *     'unmeasured' —— 测不出来。★ 它**不许**被读成 'yes'，而它的措辞里
             *                     逐字写着 `NOT "in effect"`，好让"没测到"不会被读成"没事"
             *
             * ★ 为什么它不是一个 boolean：`restarted: true` 与"代码生效了"是**两件事**
             *   （`docs/RESEARCH-RESTART-FREE.md` §2 的整条调用链）。
             *   合成一个布尔，本任务要消灭的那个合流就原样回来了。
             */
            code_on_disk_in_effect: {
              type: 'string',
              required: true,
              enum: ['yes', 'no', 'unmeasured'],
            },
            /**
             * ★ 那句承诺为假时，**它实际跑的是哪一版** —— 只说"没生效"还要人去猜。
             *   两个指纹都带上（`no` 那一态）：一个是它持有的，一个是盘上的。
             */
            code_loaded: { type: 'string' },
            code_on_disk: { type: 'string' },
            /** 三态里每一态的**可读**结论（与 `code_on_disk_in_effect` 一一对应）。 */
            code_on_disk_detail: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          /**
           * ★★ 第一行**不再**无条件说 "Subsequent calls run the code now on disk" ——
           *   那句话正是本任务修掉的假相。现在它按**测量结果**分三支，
           *   且 `restarted` 与 `code_on_disk_in_effect` **并列**出现：
           *   一个动作发生了没有，与它的效果在不在，读的人要能分别读出来。
           */
          text: value.restarted
            ? `Plugin reloaded (${value.reason}). ${value.code_on_disk_detail}`
            : `Reload refused (${value.blocked_by}): ${value.detail ?? ''} ${value.code_on_disk_detail}`,
        }],
      },
      async execute(args, exec) {
        const captain = requireCaptain(exec)
        const workspace = workspaceOf(captain)
        const stateRoot = stateRootOf(workspace, config)
        const team = await requireCaptainTeam(workspace, config, captain)
        /**
         * ★ 前置二的输入面：从**耐久态**读全部任务的 status（不是从内存缓存）。
         *   理由与判据层同源：内存缓存会与耐久态分叉，而分叉之后
         *   "闸门看到的工作"与"真实在跑的工作"不同形。
         */
        const tasks = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await readTeam(stateRoot, team.id)
          return (fresh?.tasks ?? []).map((task) => ({ id: task.id, status: task.status }))
        })
        /**
         * ── ★★ 先把「盘上的代码生效了吗」测出来，再谈重载 ──────────────────────────────
         *
         * ★ 为什么在**重载之前**测：一次 fiber restart 会 dispose 当前 fiber，
         *   之后本工具已经不再持有一个可靠的测量位置。★ 而这不损失答案 ——
         *   上面那段模块注释已经说清：重载**不可能**改变这个读数
         *   （整条 `restart()` 调用链里没有一次 import、没有一次缓存删除）。
         *   ⇒ 「重载之前」与「重载之后」是**同一个答案**，与其在失效位置再测一次
         *     （那会得到一个更不可信的读数），不如在这里测、并把理由写下来。
         *
         * ★ 为什么三条返回路径都要带上它：契约要求「能回答这一次到底生效了没有」，
         *   而**被拒也是一次"这一次"** —— 一次被拒的重载同样没有让新代码生效。
         *   ⇒ 只在成功路径上报，会让"被拒"读起来像"与代码新旧无关"，
         *     而那是另一个静默。
         */
        const codeOnDisk = codeOnDiskInEffectFrom(moduleFreshness())
        const codeDetail = codeOnDiskInEffectMessage(codeOnDisk)
        /**
         * ★ 三态的**字段**也只在该出现的路径上出现：
         *   `no` 才带两个指纹（`yes` 只有一个构建，`unmeasured` 一个都没有）。
         *   ⇒ 不写 `code_loaded: undefined` —— 缺省要**缺席**，不是写空。
         */
        const codeFields = {
          code_on_disk_in_effect: codeOnDisk.kind,
          code_on_disk_detail: codeDetail,
          ...codeOnDisk.kind === 'no' ? { code_loaded: codeOnDisk.loaded, code_on_disk: codeOnDisk.onDisk } : {},
        }
        const arbitration = arbitrateRestartWithEscape(
          { verdictPassed: args.verdict === 'passed', tasks },
          restartEscapeHatchFromEnv(process.env[RESTART_ESCAPE_HATCH_ENV]),
        )
        if (!arbitration.allowed) {
          /**
           * ── ★★ 被拒 ≠ 失败：它进入队列（t49 的核心）──────────────────────────────
           *
           * ★ 而**只有**「有工作在跑」那一条可以排队 —— 理由是结构性的：
           *
           *     `work-in-flight` 会因为**工作收口**而消失 ⇒ 等它是有意义的。
           *     `no-passing-verdict` **不会**因为任何人收口而出现 ⇒
           *     排队等判决永远是白等（而它该做的是回去跑 verify）。
           *
           *   ⇒ 让后者也排队，会把"回去改代码"伪装成"等一会儿就好了" ——
           *     而那正是本队记账的"把一个该行动的时刻伪装成一个该等待的时刻"。
           *
           *   ★ 而 `stuck`（第三态）由 `restartQueueFrom` 判定：等待名单里的任务
           *     若**不在任务表里**（被删了），它永远不会收口 ⇒ 那一等不会有结果。
           */
          if (arbitration.blockedBy === 'work-in-flight') {
            requestRestart(arbitration.inFlight, Date.now())
            ctx.logger.info(
              `agent-teams: reload QUEUED — it will run automatically once ${arbitration.inFlight.join(', ')} finish `
              + '(no new work will be dispatched while the request is pending)',
            )
          }
          ctx.logger.warn(`agent-teams: reload refused — ${restartArbitrationMessage(arbitration)}`)
          const queued = arbitration.blockedBy === 'work-in-flight'
          return {
            restarted: false,
            reason: arbitration.blockedBy,
            blocked_by: arbitration.blockedBy,
            detail: arbitration.detail,
            ...arbitration.blockedBy === 'work-in-flight' ? { in_flight: arbitration.inFlight } : {},
            ...queued ? { queued: true, queue_state: 'waiting' } : {},
            ...codeFields,
          }
        }
        /**
         * ★ 逃生口被**用过**时要留痕：一次"明知有工作在跑仍然重载"必须读得出来，
         *   否则它与"闸门本来就开着"在日志里同形（本队记账的合流形态）。
         */
        if (arbitration.reason === 'escape-hatch') {
          ctx.logger.warn(`agent-teams: reload used the escape hatch (${RESTART_ESCAPE_HATCH_ENV}=1), bypassing "${arbitration.bypassed}"`)
        }
        /**
         * ★ **不**用 `appendTeamEvent`：重载是**进程级动作**，不是团队生命周期事件。
         *   团队事件类型的并集（`AgentTeamsEventType`）里每一个都是"团队发生了什么"，
         *   而"这个进程换了代码"不属于那一类。
         *   ⇒ 强行塞进去要改 `src/event-types.ts`（**不在本任务 inScope**），
         *     而它会让那一份并集多出一个语义不同类的成员 —— 读者会以为团队状态变了。
         *   ★ 而它**没有因此变得不可读**：下面两处 logger 记录了成功/逃生口/失败三种情形，
         *     与 `moduleFreshness` 的出口同一条纪律（进程级事实走日志，不走团队状态）。
         */
        ctx.logger.info(`agent-teams: reloading the plugin (${arbitration.reason})`)
        /**
         * ★ 重载真的发生了 ⇒ 消费掉那条申请。
         *   ★ 若不消费，它会一直留在 `status` 里说"已申请" ——
         *     而那会让下一次读取把它读成"还有一次重载在等"（幽灵申请）。
         */
        clearRestartRequest()
        /**
         * ── 能力来源：cordis 的 `fiber.restart()`（已核实存在）──────────────────────
         *
         * 「Dispose and immediately reload this plugin with its current config.」
         *
         * ★ 与 **HMR** 的关键区别（本队已否决 HMR）：HMR 是**文件一变就换**（无闸门），
         *   而这里是一个**显式动作**，且它的前置是一个**已完成的判决**。
         *   ⇒ 两者在"什么时候换代码"上完全不同：一个由文件系统决定，一个由仲裁决定。
         *
         * ★ 重载**在本工具返回之后**发生（`restart()` 会 dispose 当前 fiber，
         *   而它的返回值已经不再需要本 fiber 存活）—— 所以这里**不 await**，
         *   否则调用方会等一个"永远不会返回"的承诺。
         */
        const fiber = (ctx as unknown as { fiber?: { restart?: () => Promise<void> } }).fiber
        if (typeof fiber?.restart !== 'function') {
          /**
           * ★ 拿不到 `fiber.restart` ⇒ **不是"重载成功"**，也不是静默失败：
           *   宿主形态不支持时要说出来（与"我持有旧模块"同一条纪律：读得出来才算数）。
           */
          ctx.logger.error('agent-teams: this host does not expose fiber.restart, so the plugin could not be reloaded')
          return {
            restarted: false,
            reason: arbitration.reason,
            blocked_by: 'host-cannot-restart',
            detail: 'this host does not expose fiber.restart; reload the plugin externally',
            ...codeFields,
          }
        }
        void fiber.restart().catch((error: unknown) => {
          ctx.logger.error(`agent-teams: plugin restart failed: ${String(error)}`)
        })
        return { restarted: true, reason: arbitration.reason, ...codeFields }
      },
    }))
}
