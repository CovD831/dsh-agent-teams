/**
 * ── 线 B：软硬配对（`readouts.pairing`）的**侧表** ──────────────────────────────────
 *
 * ── 这一线要消灭的形态 ────────────────────────────────────────────────────────
 *
 * 一条判据只有**硬**的那一半（一个可执行函数）时，它能判出"过 / 不过"，
 * 却说不清"人该看什么"。⇒ 于是遇到它没覆盖的情形，读的人只能读到一句拒绝，
 * 而不知道下一步该查哪儿 —— 那种拒绝最终教会人的是"门禁可以忽略"。
 *
 * ⇒ 每条判据要**两半**：`hard`（可机械判的判据）+ `soft`（人读说明 / 提示词）。
 *   **单边不许生效**：只有 hard ⇒ 拒绝时说不出人话；只有 soft ⇒ 没人真的判它。
 *
 * ── ★★ 为什么是**侧表**，而不是给 21 个判据文件各加一个 `soft` 导出 ──────────────
 *
 * 加导出要动 `src/gates` 下那 21 个判据文件 —— 每个文件里 `soft` 都会落在
 * **与其他改动相同的区域**（判据的导出区），而那是并行开发中冲突最贵的地方
 * （`src/gates/index.ts` 文件头逐字记过这条：一人一行、不要重排）。
 * ⇒ 侧表把"N 条判据的 soft"集中在**一个文件**里，冲突面从 N 处变成 1 处。
 *
 * ── ★★★ 全部价值在**双向校验**上（不做它就静默漂移）────────────────────────────
 *
 * ```
 *   侧表多一个 key（判据被删/改名了）  ⇒ 报错（否则一条 ghost 说明永远留在读数里）
 *   侧表少一个 key（新判据没写 soft）  ⇒ 报错，且**列出缺哪几个 id**
 *   soft 是空白串（占位符）            ⇒ 报错（"有 soft"与"soft 是空的"不同形）
 * ```
 *
 * ★ 三者都**不是**"警告一下继续跑"：那会让"这条判据还没配 soft"与"它配好了"
 *   在读数上同形 —— 而这一线存在的唯一理由就是让前者可见。
 * ★ 报错的形态：三支各自一句、各自列出**全部**相关 id（只报第一个会让人改 N 轮）。
 *
 * ── ★ `hasHard` 怎么判（**如实交代判据来源**）───────────────────────────────────
 *
 * `registry.list()`（`src/gates/registry.ts:648`）交出的是**配置视图**：
 * `{ id, description, hasAppliesTo, appliesTo?, observing, requires?, hasRequires }`
 * —— **没有** `gate` 函数本身，也没有任何"这条判据会不会做裁决"的标记字段。
 * ⇒ 所以本文件能拿到的、与"硬"有关的**唯一**事实是：
 *
 * ```
 *   registry.register() 拒绝 gate 非函数的注册（registry.ts:"has no gate function"）
 *   asRegistration() 也显式校验 typeof module.gate === 'function'（gates/index.ts:604）
 *   ⇒ 一个 id **出现在注册表里** ⇔ 它有一条可执行的判据函数
 * ```
 *
 * ⇒ `hasHard` 由**"这个 id 是否已注册"**判定。★ 这意味着它**今天恒为 true**。
 *   ★★ 更正（伪造代价审计 2026-10-24）：上一版这里写着"判别力全在 `hasSoft` 那一侧"，
 *     那是**错的** —— `hasSoft` 也被 `assertPairingClosed` 钉成了恒 true
 *     （不闭合在返回之前就抛了）⇒ 旧读数是 22 行 `{true,true}`，**信息量为 0**。
 *   ⇒ 所以现在读数自带 `discrimination: 'full' | 'none'`，它**从 entries 算出来**
 *     （见 {@link pairingOf}）：将来哪一半开始分化，它自己变成 `'full'`。
 *   ★ 我**不**用 `description` 之类的散文去猜 —— 那才是编。
 *   ★ 判别力实测见 `scripts/readout-lanes.test.mjs` 的线B 臂（少一条 ⇒ 红 / 注入 false ⇒ 'full'）。
 *
 * ── ★ 为什么这里**不**产出三态字符串 ──────────────────────────────────────────
 *
 * 读数只有**两个布尔**（`hasSoft` / `hasHard`）。三态徽标（"两半齐 / 只有硬 /
 * 只有软"）是**前端据这两个布尔派生**的事 —— `docs/prototype/readout.schema.json`
 * 的 `check` 定义逐字写了这一点（"与 hasHard 共同推导前端三态徽标"），
 * 而 `docs/TEAM-CONTROL-PLANE-SPEC.md` §23.6 的裁定是**派生方向单向**：
 * "schema 里的 `hasSoft`/`hasHard` 必须从 `readouts.pairing` 派生；
 *  后端不许并行产一个 `hasSoft` 字段"。
 * ⇒ 这里多吐一个 `state: 'both' | 'hard-only' | …` 就是那条裁定的**第二表达**。
 *
 * @module dsh-agent-teams/gates/pairing
 */

import type { ReadoutProvider } from '../readouts.ts'

/** 侧表的一行：`soft` 是给**人与提示词**读的那一半。 */
export interface PairingSoft {
  /** 人读说明 / 提示词：这条判据在问什么、人该去看什么。**不许是空白串**。 */
  readonly soft: string
}

/**
 * ── 侧表本体：key = 判据 id（必须与注册表里的 id 逐字相同）──────────────────────
 *
 * ★ 加一条判据 ⇒ 在这里加一行；删/改名一条 ⇒ 在这里删/改那一行。
 *   漏做的话，读数会变成 `{ unmeasured: '…' }` 并列出缺哪几个 id（不是静默通过）。
 * ★ 顺序按插入点分组（与 `ALL_GATES` 同序），便于"看着注册表对表"。
 *   ★ 但**顺序不影响读数**（读数的键序按注册表来，见 `pairingOf`）。
 * ★ `soft` 的写法：一句**人话**，说的是"这条在问什么 / 人该查什么"，
 *   而不是把 `description` 抄一遍（抄一遍会立刻分叉成两份真相）。
 */
export const PAIRING: Readonly<Record<string, PairingSoft>> = Object.freeze({
  // ── admission（立项/吸收）──────────────────────────────────────────────────
  'admission.absorb': {
    soft: '主会话说"审查意见我都吸收了"时，人该看的是产物真的动过（或明确记下无需改）。只声称不改是这一条要拦的。',
  },
  'admission.checkpoint': {
    soft: '需求/计划文档自上次审查以来有没有人偷偷改过？拿不到 git 版本就别当成"没改"。',
  },
  'admission.convene': {
    soft: '成团前四件事要齐：产物非空、无未审改动、无待确认问题、意见吸收成立。缺哪条就说哪条，别合成一句"还不能开始"。',
  },

  // ── contract（契约面）────────────────────────────────────────────────────
  'contract.build-artifact-scope': {
    soft: '声明要改 src/ 就得声明对应的 lib/ 产物 —— 本仓要求两边同步，成员 build 之后必然多出没声明的路径。',
  },
  'contract.verify-command': {
    soft: '契约里那条 verify 命令真的分得清好坏吗？空命令、写死的真/假、拿 -x 去比命令输出，都在建任务那一刻就该被说清。',
  },
  'contract.task-atomicity': {
    soft: '这条任务听起来像几件独立的事吗？（verify 只有一条、inScope 跨了几组概念上独立的目录、objective 列了多个并列交付 —— 都是征兆，不是判决。）',
  },

  // ── dispatch（派发）──────────────────────────────────────────────────────
  'dispatch.changed-paths': {
    soft: '成员自报改了哪些文件，与它会话里真的写过的是不是一回事？虚报和隐瞒都在这一条上。',
  },
  'dispatch.worktree': {
    soft: '活是不是真的落在隔离 worktree 里、没落到主检出？读不到 worktree 就说"没测到"，别当成"隔离成立"。',
  },
  'dispatch.plan-reviewed': {
    soft: '这份计划审过了吗？没带审查戳是正常的（这条路本来就不自动生成计划）；带了却读不出审了什么，才是最该停下来问的情形。',
  },

  // ── completion（完工）────────────────────────────────────────────────────
  'completion.verify-rerun': {
    soft: '成员说 verify 过了 —— 自己再跑一遍看退出码对不对得上。对不上就是自报有问题，不是环境问题。',
  },
  'completion.r5': {
    soft: '新加的测试先得在改动之前红一次，再在改动之后绿。父版本拿不到就承认没测到，别当成"测试有效"。',
  },
  'completion.mutation': {
    soft: '把关键行故意改坏，测试会不会叫？改坏了还全绿，说明那些测试只是装饰。',
  },
  'completion.backtest': {
    soft: '这一改有没有把别处弄坏？基准不绿、或选测来源说不清，都不算"没影响到别处"。',
  },

  // ── delivery（交付）──────────────────────────────────────────────────────
  'delivery.coverage': {
    soft: '用户提的每一条目标，都有任务声称负责它吗？没人认领的那条不会因为别的任务全绿就消失。',
  },
  'delivery.convergence': {
    soft: '交付时每个人是不是都收敛了？还在 working 不算，回了空白更不算 —— 空白不是"没意见"。',
  },

  // ── runtime（运行期）────────────────────────────────────────────────────
  'runtime.liveness': {
    soft: '两轮探活之间最后活动时刻没动 = 大概卡住了；还在动就只说"还在跑，已 N 分钟"。它是探活，不是超时。',
  },
  'runtime.stall': {
    soft: '同一个 (任务, 判据) 被拒了两三次、或一条任务在 in_progress 上耗了很多轮 —— 先看它是不是停下来了。别指望卡住的人说自己卡住了。',
  },
  'runtime.shape-execution': {
    soft: '声明是派工制的队，成员是不是真的为每个任务拉了临时工？干完活却一个都没拉，说明形态只是写在配置里。',
  },

  // ── collection（信号采集）────────────────────────────────────────────────
  'collection.dedupe': {
    soft: '这条信号与窗口里已有的是不是同一件事？（同 kind + 同 component + 同 message）是就只加计数，不重复采。',
  },
  'collection.cooldown': {
    soft: '这个来源刚说过话吗？说过就先别采；连它来自谁都说不出，那是"没测到"。',
  },
  'collection.attributable': {
    soft: '这条信号能不能落到一个具体的 component 上？落不到就先别塞进任何桶。',
  },
  'collection.immunity': {
    soft: '这是不是已知的噪声源（比如 worktree 路径差异）？是就永久豁免，别再让它占采集预算。',
  },
})

/** 双向校验的结果：三支各自一组 id，全是**空的**才算闭合。 */
export interface PairingDrift {
  /** 侧表里有、注册表里没有的 id（判据被删/改名了，说明成了 ghost）。 */
  readonly unknown: readonly string[]
  /** 注册表里有、侧表里没有的 id（新判据没配 soft —— 这一支必须**列出全部**缺失 id）。 */
  readonly missing: readonly string[]
  /** 侧表里有、但 soft 是空白串的 id（占位符不算配好了）。 */
  readonly blank: readonly string[]
}

/**
 * 算双向校验的缺口（**纯函数、不抛**，便于夹具与调用方各自决定怎么处置）。
 *
 * @param registeredIds - 注册表里此刻的**全部** id（真值来源：`registry.list()`）。
 * @param table - 侧表；默认 {@link PAIRING}。
 *
 * ★ 参数化不是为了"让夹具绕过真实表"：它是一个**纯函数**，所以两种缺口的
 *   判定逻辑可以被同一段代码驱动；而生产路径（`providePairingReadout`）
 *   永远用缺省表 + 真注册表。
 */
export function pairingDrift(
  registeredIds: readonly string[],
  table: Readonly<Record<string, PairingSoft>> = PAIRING,
): PairingDrift {
  const registered = new Set(registeredIds)
  const inTable = new Set(Object.keys(table))
  const unknown: string[] = []
  const missing: string[] = []
  const blank: string[] = []
  for (const id of inTable) {
    if (!registered.has(id)) unknown.push(id)
    const soft: unknown = table[id]?.soft
    if (typeof soft !== 'string' || soft.trim() === '') blank.push(id)
  }
  for (const id of registered) {
    if (!inTable.has(id)) missing.push(id)
  }
  return { unknown, missing, blank }
}

/**
 * 双向校验不闭合就**抛**（带上全部相关 id）。
 *
 * ★ 抛的时机很重要：它**不在模块加载期**。这条抛错发生在 provider 被调用时，
 *   于是读数容器把它落成 `{ unmeasured: '…threw(原因)…' }` —— 面板上看得见
 *   "配对表漂了，缺的是这几个 id"，而**整个插件的加载不受影响**。
 *   ★ 若在模块加载期抛，`snapshot.ts` 的副作用 import 会让整个插件起不来 ——
 *     一条"某个新判据忘了写 soft"的疏漏升级成"面板打不开"，那是错误的量级。
 */
export function assertPairingClosed(registeredIds: readonly string[], table: Readonly<Record<string, PairingSoft>> = PAIRING): void {
  const drift = pairingDrift(registeredIds, table)
  const parts: string[] = []
  if (drift.unknown.length > 0) {
    parts.push(`${drift.unknown.length} side-table key(s) are not registered gates: ${drift.unknown.join(', ')} — the criterion was deleted or renamed, so that soft explanation now describes nothing (a ghost row keeps reading as "paired" forever)`)
  }
  if (drift.missing.length > 0) {
    parts.push(`${drift.missing.length} registered gate(s) have no side-table row: ${drift.missing.join(', ')} — a criterion with hard-only pairing rejects without ever telling a human what to look at, and nothing else in the repo would notice`)
  }
  if (drift.blank.length > 0) {
    parts.push(`${drift.blank.length} side-table row(s) have a blank "soft": ${drift.blank.join(', ')} — "a row exists" and "that row says something" are different claims and only the first one is true here`)
  }
  if (parts.length > 0) {
    throw new Error(`the soft/hard pairing side table has drifted from the registry: ${parts.join(' | ')}`)
  }
}

/**
 * ── ★★★ 配对读数：**必须自己声明"这份读数有没有判别力"** ─────────────────────────
 *
 * 由来（伪造代价审计 2026-10-24，team-lead 裁定）：上一版直接返回
 * `{ [gateId]: { hasSoft: true, hasHard: true } }`，而那是一个**字面量** ——
 * 22 行全部相同，取值域只有一个点 ⇒ **携带的信息量是 0**。
 *
 * ```
 *   hasHard 恒 true  ⇒ registry.list() 不交 gate 函数，也[没有]判决字段；
 *                      "注册了"就是"有一条可执行判据"（注册表拒绝 gate 非函数的注册）
 *   hasSoft 恒 true  ⇒ assertPairingClosed() 在返回之前就把
 *                      "缺 id / soft 空白"抛掉了 ⇒ 走到这里时它只可能为 true
 * ```
 * ★ 而它的**后果比不报更坏**：界面会显示「22 项成对」——一个恒真式冒充测量结果。
 *
 * ── 改法：判别力**从数据里算**，不是常量 ─────────────────────────────────────
 *
 * `discrimination` = "所有条目的 `hasSoft/hasHard` 取值组合是否多于一种"。
 * ⇒ 将来注册表若交出 `gate` 函数（`hasHard` 会开始分化），或某条判据没有 soft
 *   （`hasSoft` 会开始分化），这里**自己**变成 `'full'` —— 不需要有人记得改这一行。
 *   这是本条要求的核心：**自动失效，不靠人记得改**。
 *
 * ★ 形状变了（从裸 map 变成 `{ entries, discrimination, why }`），这是**必要的破坏**：
 *   把"22 项成对"与"22 项，但我判不出差别"放进同一形状，就是本仓一直在防的那种同形。
 */
export interface PairingReadout {
  /** 逐判据的两个布尔（键序 = 注册表顺序，可做 golden 对比）。 */
  readonly entries: Readonly<Record<string, { readonly hasSoft: boolean; readonly hasHard: boolean }>>
  /**
   * 这份读数**有没有**逐条判别力。
   *
   * · `'full'` —— 至少两条判据的 `hasSoft/hasHard` 组合不同 ⇒ 读数真的在区分东西
   * · `'none'` —— 全部条目取值相同 ⇒ **它今天是一句恒真式**，不许当成"22 项都成对"来读
   */
  readonly discrimination: 'full' | 'none'
  /** `'none'` 时说明为什么（`'full'` 时**整个键缺席** —— 没有理由就没有键，不写空串）。 */
  readonly why?: string
}

/**
 * 产出配对读数。
 *
 * @param registeredIds - 注册表里此刻的全部判据 id（顺序即读数键序）。
 * @param table - 侧表，默认 {@link PAIRING}。
 * @param hardOf - "这条判据有没有可执行的判据函数"的判定。
 *   ★ **生产路径用缺省值**（`() => true`，依据见文件头：注册即"有可执行判据"）。
 *     参数化的唯一用途是让 `discrimination` 的**两条分支**都能被夹具钉住
 *     （"人为造一个 false ⇒ 'full'"）—— 它不能让生产读数造假，因为生产路径不传它。
 * @throws 侧表与注册表不闭合（多 key / 少 id / soft 空白）—— 见 {@link assertPairingClosed}。
 */
export function pairingOf(
  registeredIds: readonly string[],
  table: Readonly<Record<string, PairingSoft>> = PAIRING,
  hardOf: (id: string) => boolean = () => true,
): PairingReadout {
  assertPairingClosed(registeredIds, table)
  const entries: Record<string, { readonly hasSoft: boolean; readonly hasHard: boolean }> = {}
  for (const id of registeredIds) {
    /**
     * ★ 两个布尔各自的依据：
     *   · `hasSoft` —— 侧表里有这一行，且 soft 非空白（`assertPairingClosed` 已保证）。
     *   · `hasHard` —— 缺省下由 `hardOf` 回答（"注册了 ⇒ 有可执行判据"），见文件头。
     */
    entries[id] = { hasSoft: true, hasHard: hardOf(id) }
  }

  /**
   * ★ 判别力**从 entries 算**（不是从注册表或表里推）：
   *   算出来的东西才会随数据变，写死的东西不会。
   */
  const values = new Set(Object.values(entries).map((cell) => `${cell.hasSoft}/${cell.hasHard}`))
  const discrimination = values.size > 1 ? 'full' : 'none'

  return {
    entries,
    discrimination,
    ...discrimination === 'none'
      ? {
          why: 'every entry carries the same value pair (hasHard is true by construction: registry.list() exposes no gate function and no decision flag, so "registered" is the only available evidence of an executable criterion; hasSoft is true because the closure assertion rejects the contrary case before this function returns) — so this readout carries no per-gate information today and must not be rendered as "22 criteria are paired"',
        }
      : {},
  }
}

/**
 * 注册表里此刻的全部判据 id（**唯一真值来源**）。
 *
 * ★ 为什么用**动态** `import()` 而不是顶层 import：
 *   本模块是被 `src/readouts/index.ts`（`snapshot.ts` 的副作用 import）拉起来的，
 *   而 `gates/index.ts` 会连带装配**全部**判据模块。顶层 import 会把那条重装配
 *   搬到快照模块的加载路径最前面 —— 那是一个不必要的加载顺序依赖（也是成环的
 *   风险面）。动态 import 只在**真的收集这条读数时**才付这份成本。
 * ★ 也**不**从静态的 `ALL_GATES` 拿：它没有导出，且它只是"装配入口"不是表
 *   （`gates/index.ts` 的 t10 记录逐字写过："真值只有一份：注册表"）。
 */
export async function registeredGateIds(): Promise<string[]> {
  const { registry } = await import('./index.ts')
  const grouped = registry.list()
  const ids: string[] = []
  for (const point of Object.keys(grouped) as Array<keyof typeof grouped>) {
    for (const listed of grouped[point] ?? []) ids.push(listed.id)
  }
  return ids
}

/**
 * 线 B 的读数提供者。
 *
 * ★ 接不到注册表 / 侧表漂了 ⇒ 抛（由容器落成 `unmeasured` 并带出原因与 id 清单）。
 * ★ 不读 `teamId` / `stateRoot`：配对是**判据注册面**的性质，与哪个队无关 ——
 *   所以它在任何队上都给同一份读数（这也是它与线A/线C的区别，写清楚以免被误读成
 *   "忘了用 context"）。
 */
export const providePairingReadout: ReadoutProvider = async () => pairingOf(await registeredGateIds())
