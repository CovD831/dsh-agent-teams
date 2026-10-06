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

import { checkRequires, createRequiresAuditPolicy, type RequiresAuditMode, type RequiresCheck } from './requires.ts'

/**
 * 一条判据的裁决。**三态，不是两态。**
 *
 *  - `{ ok: true, ...产出 }`              —— 测了，没问题（可附带给出的结果）
 *  - `{ ok: false, blockers: [...] }`     —— 测了，发现问题
 *  - `{ ok: false, unmeasured: string }`  —— ★ 没能测量
 */
export type GateVerdict =
  | { ok: true; [produced: string]: unknown }
  | { ok: false; blockers: string[] }
  | { ok: false; unmeasured: string }

export type InsertionPoint = typeof INSERTION_POINTS[number]

/**
 * ── ★ 输入面：核对结果（旁路字段，t6）──────────────────────────────────────────
 *
 * 见 `requires.ts` 的文件头。要点只有一句：**它不参与裁决**。核对结果挂在这里，
 * 与 `observed` 平级 —— 因为观察模式（决定"裁决算不算数"）与输入面核对（决定
 * "这条判据要的那一格接没接上"）是**两个不同的问题**，合流会让"判据开火了"
 * 与"判据根本没被喂饱"在日志里同形。
 *
 * ★ 恒在场（空即空），与 `observed` / `outputs` 同一纪律：调用方不必写
 *   `?? { checked: 0 }`。而"一个位置一条判据都没核对到"与"核对过、都齐"不同形
 *   —— 差别在 `checked` 与 `skipped` 两个可读的计数上。
 */
export interface RequiresAuditFieldView {
  checked: number
  incomplete: number
  skipped: number
  missing: string[]
  checks: ReadonlyArray<{ id: string; status: 'ok' | 'incomplete' | 'skipped'; missing: string[]; present: string[]; skippedBecause?: string; undeclared?: string }>
}

export interface GateRunEntry {
  id: string
  verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped'
  count?: number
  produced?: boolean
  /**
   * ── ★ 这条判据【开火了，但裁决没有被采纳】（观察模式）────────────────────────
   *
   * 只在「判据交出了 blocked / unmeasured，而它处在观察模式」时为 `true`。
   * 其余情形【缺席】—— 尤其：`ok` 的判据在观察模式下**不产出这个字段**。
   *
   * ★ 为什么不能只靠 `verdict` 表示：观察模式下这条判据的 verdict 仍是
   *   `'blocked'`（它确实发现了问题，这件事本身是真的），而整体 `ok` 仍是
   *   `true`（裁决没有被采纳）。**只读 verdict 的调用方会以为流程被拒了，
   *   只读 ok 的调用方会以为这条判据温和。** ⇒ 必须有第三个字段说清
   *   "它开火了，而它的裁决被按观察模式放过了"。
   *
   * ★ 为什么与 `verdict: 'skipped'` 不同形：跳过是"判据根本没跑"
   *   （`appliesTo` 为假），这里是"跑了、开火了、被放过"。两者在日志里
   *   都是"没有拦住流程"，但成因与责任完全不同。
   */
  observed?: boolean
}

export interface GateEvaluation {
  ok: boolean
  blockers: string[]
  unmeasured?: string
  ran: GateRunEntry[]
  outputs: Record<string, Record<string, unknown>>  /**
   * ── ★ 这一步【真的跑了】几条判据 ──────────────────────────────────────────────
   *
   * 该位置挂了【至少一条】判据、但全部被 `appliesTo` 跳过时，本字段是 `0`。
   *
   * ★ 为什么必须有它（MEASURED，2026-10-05）：
   *
   *     ① kind=work、这一轮不试图完成 ⇒ `{ok:true, blockers:[]}`  ran=[全部 skipped]
   *     ② 判据跑了且都通过             ⇒ `{ok:true, blockers:[]}`  ran=[都有裁决]
   *
   *   **返回对象在 `ok` 这一字段上完全一样。** 只读 `r.ok` 的调用方读不出
   *   "一条都没跑"。信息其实还在 `ran` 里，但 `ok` 是那个会被人读、会被 `if`
   *   判的字段 —— 一处未来忘了传 `wantsCompleted` 的重构，就会让四条判据静默
   *   全跳过，而门禁返回 `ok: true`。**跳过的代价与失败的代价不同，输出却相同。**
   *
   * ★ 与 `unmeasured` 的区别（刻意不让它们合流）：
   *
   *     `unmeasured` —— 判据【跑了】，但它说"我测不了"。这是关于**测量**的结论。
   *     `evaluated:0` —— 判据【根本没跑】。这是关于**这一步有没有被检查**的结论。
   *
   *   把后者的整体裁决翻成 `ok:false` 是【错的】：`contract`/`delivery`/`runtime`
   *   位置现在一条判据都没有，而"这个位置这一轮没有适用的判据"是**正常情形**，
   *   拒掉它会让没装判据的位置卡死流程。⇒ 所以 `ok` 保持 true，多给一个**可读的
   *   计数**，让调用方能区分；要靠它把关的调用方自己判 `evaluated === 0 && count > 0`。
   */
  evaluated: number
  /** 该位置这一轮被 `appliesTo` 跳过的条数（`evaluated + skipped` 即本次涉及的判据总数）。 */
  skipped: number
  /**
   * 该位置【挂了】几条判据（与上下文无关）。
   *
   * ★ `registered === 0`（空位置）与 `registered > 0 && evaluated === 0`（全跳过）
   *   必须【不同形】—— 前者是"这里还没有判据"，后者是"有判据却一条没跑"。
   *   把这两件事混起来，一次静默全跳过就会伪装成"这个位置本来就没判据"。
   */
  registered: number
  /**
   * 该位置【有判据、却一条都没跑】时的一句人话；其余情形缺席。
   *
   * ★ 与 `unmeasured` 同属"没测到"，但不同形（见上）：这里说的是"判据没跑"，
   *   不是"判据跑了说测不了"。空位置【不产出】它 —— 那是正常情形，不是异常。
   */
  skippedAll?: string
  /**
   * ── ★ 观察模式：这一轮有几条判据【开火了，而裁决被放过】───────────────────────
   *
   * 只在至少一条观察中的判据开火时出现，且恒 `> 0`；其余情形缺席（对照臂钉住
   * "都通过"那条路径不得产出它）。
   *
   * ★ 分布与 `observed` 的关系：整份清单（`observedGates`）是"**配置**说谁在观察"，
   *   本字段是"**这一轮**谁真的开火了"。两者必须都能读到：
   *
   *     ① 观察中但没开火   —— 清单里有它，本计数不含它（它没说话）
   *     ② 观察中且开了火   —— 两者都有（这是"放过了一条真实发现"，要曝光）
   *     ③ 没观察、开了火   —— 清单里没有，本字段也不含它（它已经被采纳，流程被拒）
   *
   *   把 ①②③ 合成一个"有没有在观察"的布尔值，正是本队反复见过的合流形态。
   */
  observedBlockers?: number
  /**
   * ── ★ 开火了、被观察模式放过的那些裁决【原文】─────────────────────────────────
   *
   * 与 `blockers` / `unmeasured` 的关系是刻意的：被放过的裁决**不并进**那两个字段
   * （并进去就等于它进了裁决，而观察模式的定义就是"不进裁决"），但也**不许丢**
   * —— 它是一条真实的发现，只是暂时没有否决权。丢掉它，观察期就变成了"什么都
   * 看不见"，那时候没人能从日志里决定"这条判据该不该开火"。
   */
  observed: {
    /** 被放过的 blocker，形状与原 blocker 一样（带 `[判据 id]` 前缀）。 */
    blockers: string[]
    /** 被放过的"没能测量"，形状与原 unmeasured 一样。 */
    unmeasured: string[]
  }
  /**
   * ── ★ 输入面核对结果（t6）：这条判据要的 ctx 路径，真实 ctx 上接没接上 ──────────
   *
   * **恒在场**；**只增不改**：它不进 `ok` / `blockers` / `unmeasured`（除硬化时，
   * 见 `RequiresAuditPolicy`），也不改 `evaluated` / `skipped` / `registered`
   * 任何一个计数。`observed` 与它必须能分别读出来：
   *
   *   · 判据开火了、而它的输入面是齐的  ⇒ `observed.blockers` 非空，`requires.incomplete === 0`
   *   · 判据开火了、而它要的一格没接上  ⇒ 两者都非空（**这一条才是本轮要抓的形态**：
   *     "判据说它测不了"与"这一格没接线"在旧的输出里同形）
   *   · 判据根本没跑（不适用）          ⇒ `requires.skipped` +1，**不报缺失**（不制造噪音）
   *
   * ★ 为什么不放进 `ran[]`：那会改一条既有数组的形状（`ran` 的读者在做等价断言），
   *   而本轮的第一条硬约束是"不改任何现有判据的裁决行为"。旁路字段是唯一
   *   零风险的位置，也是"先软后硬"的字面落点。
   */
  requires: RequiresAuditFieldView
}

/** 五个【位置】，不是五个判据。一个位置可挂零到多条。 */
export const INSERTION_POINTS = Object.freeze([
  'contract',    // ① 建任务 / 改契约
  'dispatch',    // ② 派发前（成员开工）
  'completion',  // ③ 成员汇报完成
  'delivery',    // ④ 团队宣布交付
  'runtime',     // ⑤ 全程（跨步骤的过程约束；告警，不直接拒任务）
])

/**
 * 一条判据的裁决。**三态，不是两态。**
 *
 *  - `{ ok: true }`                        —— 测了，没问题
 *  - `{ ok: false, blockers: [...] }`      —— 测了，发现问题（必须说清为什么）
 *  - `{ ok: false, unmeasured: string }`   —— ★ 没能测量
 */
export function ok(): { ok: true } {
  return { ok: true }
}

export function blocked(...blockers: Array<string | string[]>): { ok: false; blockers: string[] } {
  const list = blockers.flat().filter((item) => typeof item === 'string' && item.trim() !== '')
  if (list.length === 0) {
    throw new Error('a gate that blocks must say why: blocked() needs at least one non-empty blocker')
  }
  return { ok: false, blockers: list }
}

export function unmeasured(reason: string): { ok: false; unmeasured: string } {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error('unmeasured() must say what could not be measured')
  }
  return { ok: false, unmeasured: reason }
}

/** 校验一条裁决的形状。非法形状【抛错】而不是被当成通过 —— 一个形状错误的裁决是最危险的。 */
function assertVerdict(verdict: unknown, id: string): GateVerdict {
  if (verdict === null || typeof verdict !== 'object') {
    throw new Error(`gate "${id}" returned a malformed verdict (expected {ok:boolean}): ${JSON.stringify(verdict)}`)
  }
  const v = verdict as Record<string, unknown>
  if (typeof v['ok'] !== 'boolean') {
    throw new Error(`gate "${id}" returned a malformed verdict (expected {ok:boolean}): ${JSON.stringify(verdict)}`)
  }
  if (v['ok'] === false) {
    const hasBlockers = Array.isArray(v['blockers']) && (v['blockers'] as unknown[]).length > 0
    const hasUnmeasured = typeof v['unmeasured'] === 'string' && (v['unmeasured'] as string).trim() !== ''
    if (!hasBlockers && !hasUnmeasured) {
      throw new Error(`gate "${id}" returned ok:false but said neither why (blockers) nor that it could not measure (unmeasured)`)
    }
    if (hasBlockers && hasUnmeasured) {
      throw new Error(`gate "${id}" returned both blockers and unmeasured; pick one — "found problems" and "could not measure" are different claims`)
    }
  }
  return verdict as GateVerdict
}

/**
 * 一个注册表实例。判据按 point 分组，组内按注册顺序求值（顺序稳定，便于复现）。
 */
export interface GateRegistration {
  id: string
  point: InsertionPoint
  description: string
  appliesTo?: (context: any) => boolean
  gate: (context: any) => GateVerdict | Promise<GateVerdict>
  /**
   * ── ★ 输入面声明（t6）：这条判据需要 ctx 上的哪些路径 ───────────────────────────
   *
   * **类型的来源是判据自己的 ctx 类型**，不是手写字符串：
   *
   * ```ts
   * export const requires: CtxPaths<RuntimeLivenessContext>[] = ['event', 'wait', 'waits', 'task']
   * //                                                             ↑ 'event.typo' ⇒ TS2322
   * ```
   *
   * ★ 缺席与空数组**不同形**（核对层分别给 `undeclared` 与 `ok`）：缺席是
   *   "这条判据的输入面还没有被声明"（本轮要逐步消灭的东西），`[]` 是"它不需要
   *   任何一格"。合成一个会让接线覆盖率的读数虚高。
   *
   * ★ 注册时**不做类型校验**（运行时不认识类型）：一份拼错的路径能不能过，
   *   由 `tsc` 回答（`pnpm typecheck`）；这里只校验它是个字符串数组，
   *   因为 `requires: 'wait.now'` 这种形状会让核对层去逐字符切路径，报出一堆
   *   谁也没写过的格子。
   */
  requires?: readonly string[]
}

/**
 * ── ★ 观察模式（observe-only）：新判据先只记录、不拒绝 ─────────────────────────
 *
 * 由来（t9，契约 §3.5）：**判据误伤的代价比漏报更贵。** 一条写错的新判据若
 * 立刻有否决权，会把真实任务卡死；而"被门禁坑过"的人学到的不是"这条判据要修"，
 * 是"门禁可以忽略"—— 此后所有判据都白装。本队已经见过这个形态（棘轮断言在成功
 * 路径上报错）。
 *
 * ⇒ 新判据可以先**进来观察**：照常求值、照常记录，但裁决不阻止流程；确认它不误伤
 *   之后再把它移出观察集。
 *
 * ── 三条设计决定 ─────────────────────────────────────────────────────────────
 *
 * ① **缺省 = 今天的行为**（有否决权）。观察必须**显式选择加入**：漏读一个字段的
 *    结果是"判据正常把关"，而不是"判据悄悄失效"。一个默认放宽的开关会让
 *    "配置丢了"与"判据通过了"在日志里同形 —— 而那正是本注册表存在的理由。
 *
 * ② **开关不需要改代码**：观察集是**运行时数据**（`observe(id)` / `unobserve(id)`），
 *    不是注册字段。关掉观察只是 `unobserve(id)` 一次调用 —— 没有 code change，
 *    也就没有"改代码 → 漏了 build → 装的位置跑的是旧代码"那条窗口（本队实测过）。
 *    ★ 且它**不是** `appliesTo`：把一条判据"观察着"写成 `appliesTo: () => false`
 *      会让它【根本不跑】，于是观察期什么都看不见，而"观察"与"跳过"同形。
 *
 * ③ **开火与没跑不同形**：被放过的裁决进 `observed`，不进 `blockers`/`unmeasured`
 *    （否则它就进了裁决）；同时 `ran[].observed === true` 与
 *    `evaluation.observedBlockers` 让"开火了但被放过"可被计数。它与
 *    `verdict: 'skipped'`（判据没跑）在形状上不同。
 */
export interface ObserveOptions {
  /** 观察期说明（为什么这条判据先进来观察）；会被 `list()` 渲染出来。 */
  reason?: string
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
export const OBSERVE_GATES_ENV = 'AGENT_TEAMS_OBSERVE_GATES'

/** 解析环境变量里的观察名单（导出以便夹具钉住解析规则本身）。 */
export function observeIdsFromEnv(value: string | undefined): string[] {
  if (typeof value !== 'string') return []
  return [...new Set(value.split(',').map((id) => id.trim()).filter((id) => id !== ''))]
}

export function createGateRegistry(options: { readonly observeFromEnv?: string | undefined; readonly enforceRequiresFromEnv?: string | undefined } = {}) {
  /** @type {Map<string, object>} */
  const byId = new Map()
  /** id → 观察期说明（不在其中 ⇒ 该判据有否决权，即今天的行为）。 */
  const observing = new Map<string, string>()
  /**
   * ★ 环境变量的求值时机：**构造时读一次**，不是每次 evaluate 时读。
   *   进程内改环境变量会让同一次运行里的两次求值用两套门禁 —— 那是最难归因的
   *   一类缺陷（同一个输入两次跑出不同裁决）。夹具要换名单就新建一个实例。
   *   `observeFromEnv` 参数让夹具不必去动 process.env（动全局状态会让用例互相污染）。
   */
  const envValue = options.observeFromEnv !== undefined ? options.observeFromEnv : process.env[OBSERVE_GATES_ENV]
  for (const id of observeIdsFromEnv(envValue)) {
    observing.set(id, `observed by ${OBSERVE_GATES_ENV}`)
  }
  /**
   * ★ 输入面核对策略（t6）：**缺省只观察、不拒绝**。构造时读一次环境变量，
   *   与观察名单同一条纪律（见上面 `envValue` 的注释）。
   */
  const requiresPolicy = createRequiresAuditPolicy({ enforceFromEnv: options.enforceRequiresFromEnv })

  return {
    /**
     * 注册一条判据。
     * ★ 重复 id ⇒ 抛错，**不静默覆盖** —— 静默覆盖会让"我换了一条判据"
     *   与"两条判据都在、后一条赢了"在日志里同形。
     */
    register(registration: GateRegistration): GateRegistration {
      const { id, point, description, gate, appliesTo, requires } = registration ?? {}
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('a gate registration requires a non-empty id')
      }
      if (!INSERTION_POINTS.includes(point)) {
        throw new Error(`gate "${id}" names unknown insertion point "${point}" (known: ${INSERTION_POINTS.join(', ')})`)
      }
      if (typeof gate !== 'function') {
        throw new Error(`gate "${id}" has no gate function`)
      }
      if (typeof description !== 'string' || description.trim() === '') {
        throw new Error(`gate "${id}" requires a description (the console renders it)`)
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
          throw new Error(`gate "${id}" declares "requires" but it is not an array of ctx paths (got ${JSON.stringify(requires)}); declare it as CtxPaths<ThatGateContext>[] so a mistyped path is a compile error instead of a runtime surprise`)
        }
      }
      if (byId.has(id)) {
        throw new Error(`gate "${id}" is already registered; unregister it first (silent replacement would make "swapped" and "both ran" look identical)`)
      }
      byId.set(id, { id, point, description, gate, appliesTo, ...requires === undefined ? {} : { requires } })
      return registration
    },

    unregister(id: string): boolean {
      /** 注销时连观察期标记一起撤掉 —— 否则同一个 id 重新注册会**继承**上一代的观察期，而"我观察过它"与"它现在在观察中"是两件事。 */
      observing.delete(id)
      return byId.delete(id)
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
    observe(id: string, options: ObserveOptions = {}): { id: string; registered: boolean; reason: string } {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('observe() requires a non-empty gate id')
      }
      const reason = typeof options.reason === 'string' ? options.reason.trim() : ''
      observing.set(id, reason)
      return { id, registered: byId.has(id), reason }
    },

    /** 结束观察：这条判据的裁决立刻恢复阻止流程。返回它此前是否在观察中。 */
    unobserve(id: string): boolean {
      return observing.delete(id)
    },

    /** 这条判据当前是否处在观察模式（缺省 false —— 即今天的行为）。 */
    isObserving(id: string): boolean {
      return observing.has(id)
    },

    /**
     * 当前观察名单（含尚未注册的 id）。控制台读它。
     *
     * ★ 读它与读 `isObserving` 都【不改裁决】—— 它是一份**配置视图**，
     *   而"谁这一轮真的开火了"是 `GateEvaluation.observed`。两者不同形是刻意的。
     */
    observingIds(): Array<{ id: string; reason: string; registered: boolean }> {
      return [...observing.entries()].map(([id, reason]) => ({ id, reason, registered: byId.has(id) }))
    },

    /** 控制台读它。按 point 分组，组内保持注册顺序。 */
    list(): Record<InsertionPoint, Array<{ id: string; description: string; hasAppliesTo: boolean; observing: boolean; observeReason?: string; requires?: readonly string[]; hasRequires: boolean }>> {
      const out = {} as Record<InsertionPoint, Array<{ id: string; description: string; hasAppliesTo: boolean; observing: boolean; observeReason?: string; requires?: readonly string[]; hasRequires: boolean }>>
      for (const point of INSERTION_POINTS) out[point] = []
      for (const reg of byId.values()) {
        const observingGate = observing.has(reg.id)
        const reason = observing.get(reg.id) ?? ''
        out[reg.point]!.push({
          id: reg.id,
          description: reg.description,
          hasAppliesTo: typeof reg.appliesTo === 'function',
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
        })
      }
      return out
    },

    /** 该位置已注册的判据条数（控制台/测试用）。 */
    count(point: InsertionPoint): number {
      let n = 0
      for (const reg of byId.values()) if (reg.point === point) n += 1
      return n
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
    async evaluate(point: InsertionPoint, context: unknown): Promise<GateEvaluation> {
      if (!INSERTION_POINTS.includes(point)) {
        throw new Error(`evaluate() called with unknown insertion point "${point}"`)
      }
      const ran: GateRunEntry[] = []
      const blockers: string[] = []
      const unmeasuredReasons: string[] = []
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
      const outputs = new Map<string, Record<string, unknown>>()
      /**
       * ★ 该位置【挂了】几条判据 —— 与上下文无关，只数注册表。
       *   它与"跑了 / 跳过"分开数，是为了让空位置与全跳过【不同形】。
       */
      let registered = 0
      let skipped = 0
      /** 输入面核对（t6）：逐条结论，按注册顺序；**旁路**，见 GateEvaluation.requires。 */
      const requiresChecks: RequiresCheck[] = []
      /** 观察模式：被放过的 blocker / unmeasured 原文（见 GateEvaluation.observed）。 */
      const observedBlockers: string[] = []
      const observedUnmeasured: string[] = []
      for (const reg of byId.values()) {
        if (reg.point !== point) continue
        registered += 1
        if (typeof reg.appliesTo === 'function' && reg.appliesTo(context) !== true) {
          skipped += 1
          ran.push({ id: reg.id, verdict: 'skipped' })
          /**
           * ★ 不适用 ⇒ **不核对、不报缺失**（t6 的核心闸门）。
           *
           * 11 条判据 × 8 个调用点 = 88 种组合，大部分本来就该"不适用"；在那些
           * 组合上喊"缺这缺那"，正是"教人忽略门禁"的那条老路。⇒ 这一条只记
           * `status:'skipped'`，它进 `requires.skipped` 计数，**不进** `missing`。
           *
           * ★ 为什么调用方要给 `applies`（而不是让核对层自己再调一次 appliesTo）：
           *   跳过与否是**注册表的结论**。核对层自己调第二遍会造出两套口径
           *   （判据的 appliesTo 若有副作用或读到时间，两次调用可能不同）。
           */
          requiresChecks.push(checkRequires(reg, context, false))
          continue
        }
        const produced = assertVerdict(await reg.gate(context), reg.id)
        const verdict = produced as Record<string, unknown>
        /**
         * ── ★ 输入面核对（t6）：在判据【已经说完话】之后核对一次 ────────────────
         *
         * ★ 顺序是刻意的：核对**不决定判据跑不跑**。它只描述"这条判据要的格子，
         *   真实 ctx 上接没接上" —— 若让核对有权力拦下判据，那就不是"先软后硬"，
         *   而是把新机制直接升成门禁（本轮明确不做）。
         */
        requiresChecks.push(checkRequires(reg, context, true))
        /**
         * ★ 这条判据这一轮是否【没有否决权】。
         *   逐条读快照，而不是循环外读一次 —— 前者与"每条判据各自的状态"同义，
         *   后者会在求值过程中观察集被改动时给出一个说不清的口径。
         */
        const observeOnly = observing.has(reg.id)
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
          const given = Object.fromEntries(Object.entries(verdict).filter(([key]) => key !== 'ok'))
          if (Object.keys(given).length > 0) outputs.set(reg.id, given)
          ran.push({ id: reg.id, verdict: 'ok', produced: Object.keys(given).length > 0 })
          continue
        }
        if (Array.isArray(verdict['blockers'])) {
          const list = verdict['blockers'] as string[]
          const prefixed = list.map((item) => `[${reg.id}] ${item}`)
          if (observeOnly) {
            for (const item of prefixed) observedBlockers.push(item)
            ran.push({ id: reg.id, verdict: 'blocked', count: list.length, observed: true })
            continue
          }
          for (const item of prefixed) blockers.push(item)
          ran.push({ id: reg.id, verdict: 'blocked', count: list.length })
          continue
        }
        const reason = `[${reg.id}] ${String(verdict['unmeasured'])}`
        if (observeOnly) {
          observedUnmeasured.push(reason)
          ran.push({ id: reg.id, verdict: 'unmeasured', observed: true })
          continue
        }
        unmeasuredReasons.push(reason)
        ran.push({ id: reg.id, verdict: 'unmeasured' })
      }
      const collected: Record<string, Record<string, unknown>> = Object.fromEntries(outputs)
      const evaluated = registered - skipped
      /**
       * ★ 「有判据、却一条都没跑」的说明。
       *
       * 只有在【该位置确实挂了判据】时才产出：空位置（`registered === 0`）是正常
       * 情形，不是异常 —— 在那里产出这段话，会让每个还没接判据的位置都读起来像
       * 出了问题，而那正是"把正常读成异常"，与"把异常读成正常"一样有害。
       */
      const allSkipped = registered > 0 && evaluated === 0
        ? `none of the ${registered} gate(s) registered at "${point}" applied to this context; nothing was evaluated, so this step was not checked`
        : undefined
      const counts = { evaluated, skipped, registered }
      /**
       * ★ `observed` 恒在场（空对象也算在场），另外给一个**可读的计数**。
       *
       * 恒在场是为了让调用方不必写 `?? { blockers: [], unmeasured: [] }`（与
       * `outputs` 同一条纪律：空即空，而不是缺席）。计数只在真有人开火时出现
       * —— 于是"观察期什么都没发生"与"放过了一条真实发现"不同形。
       */
      const observed = { blockers: observedBlockers, unmeasured: observedUnmeasured }
      const observedCount = observedBlockers.length + observedUnmeasured.length
      const observedField = observedCount > 0 ? { observedBlockers: observedCount, observed } : { observed }
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
      const incompleteChecks = requiresChecks.filter((check) => check.status === 'incomplete')
      const requiresField = {
        checked: requiresChecks.filter((check) => check.status !== 'skipped').length,
        incomplete: incompleteChecks.length,
        skipped: requiresChecks.filter((check) => check.status === 'skipped').length,
        missing: incompleteChecks.map(
          (check) => `[${check.id}] declares ${check.missing.length} ctx path(s) that this context does not carry: ${check.missing.join(', ')}`,
        ),
        checks: requiresChecks,
      }
      for (const item of requiresPolicy.blockers(requiresField)) blockers.unshift(item)
      if (unmeasuredReasons.length > 0) {
        return {
          ok: false, unmeasured: unmeasuredReasons.join('; '), blockers, ran, outputs: collected,
          ...counts, ...observedField, requires: requiresField, ...allSkipped === undefined ? {} : { skippedAll: allSkipped },
        }
      }
      if (blockers.length > 0) {
        return {
          ok: false, blockers, ran, outputs: collected,
          ...counts, ...observedField, requires: requiresField, ...allSkipped === undefined ? {} : { skippedAll: allSkipped },
        }
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
      }
    },
  }
}
