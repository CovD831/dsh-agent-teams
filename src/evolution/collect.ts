/**
 * ── ★★★ t87：采集层 —— 让 `collection` 四条判据在生产路径上**真的被求值** ──────────
 *
 * 规格：`docs/COLLECTION-LAYER-SPEC.md`（§1 在哪采 · §2 什么形式 · §3 存哪里 · §6 落地顺序）。
 *
 * ── ★ 本文件补的是什么缺口 ────────────────────────────────────────────────────
 *
 * MEASURED（t87 开工勘查）：`grep -rn "evaluate('collection'" src/` ⇒ **0 处**。
 * ⇒ 四条 `collection` 判据**装好了、注册了、能通过 `evaluate` 跑**，
 *   而**生产路径上一次都不会调用它们**。
 * ★★ 而那正是本仓记账最久的形态（`unwired`）—— **轮到我们自己的新代码犯它。**
 *
 * ── ★★ 三条纪律（都来自规格，且都不是我的发明）────────────────────────────────
 *
 * **① 不侵入**（规格 §1 原则）：采集走**宿主既有的失败汇合点**，
 *   而**不许**在 `src/gates/**` 或各业务模块里 `import evolution`。
 *   ⇒ 本模块**只被汇合点调用**，它自己不反向 import 那些模块。
 *
 * **② `mechanisms` 不重算，直接抄判据的 `ran[]`**（规格 §2 硬约束 3）：
 *   在观察点**重算**会与当时的裁决不同 ⇒ "记录说 X，当时实际是 Y" ⇒
 *   ★ **两个口径，一个事实**（本仓记账过）。所以只**转发**已有裁决。
 *
 * **③ 旁路，不参与裁决**（规格 §6 步骤 1 + 本仓既有注释逐字）：
 *   写入**必须**用 `void … .then(warn)` ——
 *   ★ 不许因为"写台账慢"而把一次拒绝**变成一次等待**（那会改变可观测的时序）。
 *
 * ── ★ 与既有 `frictions/` 的关系 ──────────────────────────────────────────────
 *
 * 规格 §3 逐字裁定 **选项 ②：并存，旧的冻结**（那 384 条是历史，口径不同）。
 * ⇒ 本模块写 `.agent-teams/evolution/signals.jsonl`（**追加一行**，复用本仓 mailbox
 *   的先例），**不碰** `frictions/`。
 * ★ 而"旧的冻结"是**可验证**的：它的 count 不再增长。
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
/**
 * ★ 2026-10-21：提案的写方（本模块 → `proposals.ts` 单向）。
 * ★ 方向与 `evolution → gates` 那条铁律一致：本模块**不**反向 import 任何业务模块。
 */
import { recordProposalForSignal } from './proposals.ts'

/**
 * ── 一条信号（规格 §2 的形状，**去掉**快照那两块）──────────────────────────────────
 *
 * ★ 本任务是规格 §6 的**步骤 1**：只加采集，**不改存储**（快照去重是步骤 3/4）。
 *   ⇒ 这里**不**实现 `stateRef` / content-addressed 快照 —— 那是后续步骤，
 *     而在这一步就把形状钉死会让步骤 3 的实测（"单条体积 35 KB → ~3 KB"）无处落。
 */
export interface EvolutionSignal {
  /** `e-0001`（单调，与 `f-` 同族）。★ 由 `nextSignalId` 从既有文件算，不用时间戳。 */
  readonly id: string
  readonly at: number
  /** ★ 三类（用户原话）：拒绝 / 成功 / 洞察。★ 本任务只采 `rejection`。 */
  readonly kind: 'rejection' | 'success' | 'insight'
  /**
   * ★ 确定性来源 —— 谁拒的 / 哪条判据 / 哪个工具。
   * ★ `gateId` 可空：**不是**所有拒绝都由判据给出（★ 闸门拒绝就没有）。
   */
  readonly source: {
    readonly where: string
    readonly gateId?: string
    readonly tool?: string
  }
  /** ★ 原文，**不改写**。 */
  readonly message: string
  /**
   * ★★★ 机制活动：**装上的机制本轮实际做了什么**（规格 §2 引 Raven §4）。
   * ★★ 数据来自判据的 `ran[]` —— **不是重算**（硬约束 3）。
   */
  readonly mechanisms?: readonly {
    readonly gateId: string
    readonly verdict: string
  }[]
  /**
   * ── ★★★ `collection` 四条的裁决 —— 这是本任务加的那一格 ────────────────────────
   *
   * ★ 规格 §2 的形状里**没有**这一格；t87 必须加，因为不放它的话
   *   "**采集了**"与"**采集被 collection 拒了**"在记录里**同形** ——
   *   而那是本仓记账最久的形态，且**恰好是本任务要实现的那件事**（判据要不要进库）。
   *
   * ★★ 三态**不同形**（与全仓的三态纪律一致）：
   *   · `collected: true`   ⇒ 四条都放行 ⇒ **真的采了**
   *   · `collected: false`  ⇒ 有条判据说"不采"（`ok === false`）⇒ **不采，但计数 +1，不静默丢**
   *   · `collected: undefined` ⇒ ★ **判不了**（`ran[]` 里有 `unmeasured`，
   *     或求值根本没跑）—— 与"不采"**不同形**
   */
  readonly collection?: {
    readonly collected: boolean | undefined
    readonly verdicts: readonly { readonly gateId: string; readonly verdict: string }[]
  }
  /**
   * ── ★★★ N1.1：**顶层**的 `collected` 三态（本任务要落盘的那一格）──────────────
   *
   * ── 为什么上面已经有 `collection.collected`，还要在顶层再来一格 ────────────────
   *
   *   上面那一格是**那次判据求值的原始结论**（`boolean | undefined`），
   *   它活在 `collection` 对象里 ⇒ ★ **整个 `collection` 对象缺席时它也跟着消失**。
   *   而 `collection` 恰好在"求值没跑"时缺席 ⇒ **"没跑"与"跑了但没记"同形**。
   *
   *   ⇒ 顶层这一格**永远在场**（`undefined` 写成 `null`，见 `withCollected`），
   *     让盘上的每一行都能被回答「这条到底采没采」，而不必去问 `collection` 在不在。
   *
   * ── ★★★ 四值，不是三值 —— 而 `null` 与 `'unmeasured'` **必须是两件事** ─────────
   *
   *   · `'collected'`  ⇒ 判据放行，**真的采了**
   *   · `'skipped'`    ⇒ 判据说**不采**（`ok === false`）—— 一个**决定**
   *   · `'unmeasured'` ⇒ 判据说**判不了**（`unmeasured`）—— 一个**读数**，不是决定
   *   · `null`         ⇒ ★ **这一行没有这一格**（存量 49 行、或写入方遗漏）
   *
   *   ★★ 把 `null` 与 `'unmeasured'` 合并是**这一格最容易犯的错**：
   *     `null` 意味着"写入方没写"（**缺陷**，该修代码），
   *     `'unmeasured'` 意味着"写了，读数是测不出来"（**事实**，该修判据的输入）。
   *     两者补救动作完全相反 ⇒ 合并会把一个缺陷读成一个读数。
   *
   *   ★ 类型上的 `| null` 是刻意的：`JSON.stringify` 会**保留** `null`、**丢弃** `undefined`，
   *     所以要让"这一格存在但为空"在盘上真的存在，只能用 `null`。
   */
  readonly collected?: 'collected' | 'skipped' | 'unmeasured' | null
  /**
   * ── ★★★ N1.2：这条信号**当时的候选面** —— 让盘上的行能被**逐字重建**成去重键 ────
   *
   * ── 要回答的那个问题：「`deriveCollectionIndex` 凭什么重建 `seen`？」──────────
   *
   *   去重键是 `dedupeKeyOf({kind, component, message})` —— 三段。
   *   而 `EvolutionSignal` 原本只落了 `kind`（**字符串** `'rejection'`）与 `message`：
   *     · `kind` 那一段**不是**候选类别数组（是两个同名字段，N1.1 的由来）；
   *     · `component` 那一段**整个没有落盘**（`source.where` 是别的东西）。
   *   ★★ ⇒ 从旧行**拼不出**去重键。若索引端自己猜一个（用 `source.where` 当 component），
   *     它算出的键与写端算出的键**永远不同** ⇒ `seen.has(key)` 恒假 ⇒
   *     **去重永远不拦，而读数上一切正常**（`ok`，看起来在正常工作）。
   *     这是本任务最贵的一格：一个**看起来接好了**、实则恒不命中的判据。
   *
   * ── ★ 所以落的是【候选面本身】，不是它的投影 ────────────────────────────────
   *
   *   落 `dedupeKey` 字符串也能让 `seen` 工作，但它把"键怎么算"**冻进了历史行**：
   *   公式一变（比如加一段），存量行与新行就分属两个键空间，而这一点在盘上
   *   **看不出来**。⇒ 落**原料**（`kind` 数组 + `component`），由读取端用
   *   当前那一份 `dedupeKeyOf` 现算 —— 公式只有一个真值，且对存量行同样成立。
   *
   * ★ `component` 缺席 ⇒ **不写这一格**（不写空串：缺席与"有但是空的"是两件事）。
   */
  readonly candidate?: {
    /** 候选类别（**数组**，进去重键的那一段）—— 与顶层 `kind` 是两个东西。 */
    readonly kind: readonly string[]
    /** 归属组件（进去重键的第二段）。★ 缺席 ⇒ 这一格不写。 */
    readonly component?: string
  }
}

/** `.agent-teams/evolution/signals.jsonl` 的路径（由调用方给 `stateRoot`，**不猜**）。 */
export function signalsPathOf(stateRoot: string): string {
  return join(stateRoot, 'evolution', 'signals.jsonl')
}

/**
 * ── ★ 从**既有**台账算下一个 id —— 与 `frictions/` 的 `f-0001` 同一条纪律 ──────────
 *
 * ★ 为什么不用时间戳：同一毫秒内的两条会撞车，而撞车后一条覆盖另一条 ——
 *   **被覆盖的信号与"没发生过"同形**（`recordFriction` 的注释逐字记过这一条）。
 * ★ 而这里读的是 **signals.jsonl**（不是 `frictions/`）：后者已冻结，
 *   它的编号空间与信号流无关（规格 §3 选项 ②）。
 * ★ 读不出来 ⇒ 从 1 开始（不是"猜一个大的"）—— 宁可撞一次也不伪造历史密度。
 */
export async function nextSignalId(stateRoot: string): Promise<string> {
  const text = await readSignalsText(stateRoot)
  return `e-${String(maxSignalNumberIn(text) + 1).padStart(4, '0')}`
}

/**
 * ── ★★★ t93：读 `signals.jsonl`（读不出来 ⇒ 空串，**不是**抛）──────────────────────
 */
async function readSignalsText(stateRoot: string): Promise<string> {
  try {
    const { readFile } = await import('node:fs/promises')
    return await readFile(signalsPathOf(stateRoot), 'utf8')
  } catch {
    /** 文件还不存在 ⇒ 没有已知的 id。 */
    return ''
  }
}

/**
 * ── ★★★ t93：从既有文本里算**已用过的最大编号**（两种序列化格式都要认）────────────
 *
 * ── 这里修的是一个**真缺陷**（MEASURED，2026-10-16）────────────────────────────────
 *
 * 旧实现是 `/"id":"e-(\d+)"/` —— ★ **它要求 `"id"` 与 `"e-…"` 之间【没有空格】**。
 * 而同一个文件里**两种写法共存**：
 * ```
 * t88 手工补录的那 10 行：  {"id": "e-0001", …}   ← ★ 冒号后有空格（JSON.stringify(x, null, 0) 之外的写法）
 * t87 `appendSignal` 写的：  {"id":"e-0001",…}     ← ★ 无空格（`JSON.stringify(signal)` 的默认形状）
 * ```
 * ⇒ ★★ 正则**只认得第二种** ⇒ 那 10 行对 `max` **完全不可见**
 *   ⇒ `max` 从 0 起算 ⇒ 分配出 `e-0001` ⇒ **覆盖了已存在的 `e-0001`**
 *   ⇒ 实测**五组 id 各出现两次**（`e-0001` … `e-0005`）。
 *
 * ── ★★★ 而真正的教训不是"正则少写了 `\s*`" ────────────────────────────────────────
 *
 * ★ 补一个 `\s*` 只修**这一次**。**根因是"靠解析文本推断状态"这件事本身** ——
 *   它假设了**写者与读者对序列化的约定一致**，而那个假设**没有任何地方强加**：
 *   任何人用 `JSON.stringify(x, null, 2)`（带缩进）都能让同一个正则**再次失明**。
 * ⇒ 所以本函数**不再假设格式**：它**逐行 `JSON.parse`**，从**解析出来的对象**上读 `id`。
 *   ★ 文本形状再怎么变（空格、缩进、键序、多了别的键），`JSON.parse` 都给出**同一个对象**
 *     ⇒ 读 id 这件事**与序列化格式解耦**。
 *   ★ 而**解析失败的那一行只跳过它自己**（不整文件放弃）：
 *     坏一行不该让**所有**既有 id 都变得不可见 —— 那正是旧实现会**静默放大**的错。
 *
 * ★ 保留一条**极轻的**文本兜底：若某行 `JSON.parse` 失败，仍试着用**容忍空白**的正则
 *   抠出编号。★ 理由：历史数据里若有半行，它的编号**已经被占用过**，
 *   漏掉它会让同一个 id 被分配第二次 —— 而"撞车"正是本函数要消灭的东西。
 */
export function maxSignalNumberIn(text: string): number {
  let max = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    /** ① 正路：**从解析出来的对象**读 —— 与序列化格式无关。 */
    try {
      const record = JSON.parse(line) as { readonly id?: unknown }
      const id = record?.id
      if (typeof id === 'string') {
        const matched = /^e-(\d+)$/.exec(id)
        if (matched !== null) max = Math.max(max, Number(matched[1]))
        continue
      }
    } catch {
      /** 落到下面的兜底。 */
    }
    /**
     * ② 兜底：这一行**解析不了**（半行/损坏），但它可能**已经占用过**一个编号。
     * ★ 正则**容忍空白** —— 这是旧实现缺的那一半（它只认无空格）。
     */
    const loose = /"id"\s*:\s*"e-(\d+)"/.exec(line)
    if (loose !== null) max = Math.max(max, Number(loose[1]))
  }
  return max
}

/**
 * ── ★★★ t93：`signals.jsonl` 里**重复出现**过的 id（审计读数，**不改数据**）─────────
 *
 * ★ 它的存在理由：那五组撞车是**既成事实**（审计数据不许改写），
 *   而"曾经撞过"**必须读得出来** —— 静默修好会让
 *   「**它曾经撞过**」与「**它从来没撞过**」**同形**（本仓记账最久的形态）。
 *
 * ★★ 读端为什么需要它：`e-0001` 指向**两条不同的记录**（一条 t88 手工补录、
 *   一条 t87 采集）⇒ **任何按 id 回溯的读取端会读到错的那条**。
 *   ⇒ 本函数就是那个"**明确的可区分读数**"：它让读取端能**先问一句**再决定信谁。
 *
 * ★ 返回 `{ id, lines: [行号…] }`（行号从 1 起，**给人去查的定位**）。
 */
export function duplicateSignalIds(text: string): readonly { readonly id: string; readonly lines: readonly number[] }[] {
  const seen = new Map<string, number[]>()
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.trim() === '') continue
    let id: unknown
    try {
      id = (JSON.parse(line) as { readonly id?: unknown })?.id
    } catch {
      const loose = /"id"\s*:\s*"e-(\d+)"/.exec(line)
      id = loose === null ? undefined : `e-${loose[1]}`
    }
    if (typeof id !== 'string') continue
    const at = seen.get(id) ?? []
    at.push(index + 1)
    seen.set(id, at)
  }
  return [...seen.entries()]
    .filter(([, at]) => at.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, lines2]) => ({ id, lines: lines2 }))
}

/**
 * ── ★★ 追加一条信号 —— `signals.jsonl`，**一行** ──────────────────────────────────
 *
 * ★ 为什么 jsonl 而不是一条一文件（规格 §3 的表）：
 *   append 是**一行**（不是建新文件）· 全量读**一次**（不是 384 次 open）·
 *   ★ **append 是原子的**（本仓 `inbox/*.jsonl` 已这么做，**不是新发明**）。
 * ★ 部分损坏 ⇒ 坏**一行**，而**每行自带 `id`** ⇒ 可跳过（步骤 4 的反向半边）。
 *
 * @returns 写成功的 id；写不进去 ⇒ `undefined`（**不抛** —— 调用方是拒绝路径，见下）
 */
export async function appendSignal(stateRoot: string, signal: EvolutionSignal): Promise<string | undefined> {
  try {
    const dir = join(stateRoot, 'evolution')
    await mkdir(dir, { recursive: true })
    await appendFile(signalsPathOf(stateRoot), `${JSON.stringify(signal)}\n`, 'utf8')
    return signal.id
  } catch {
    /**
     * ★★ **不抛** —— 本函数在**拒绝路径**上被调用。
     *   把"写不进台账"变成"这次拒绝变成异常"会**改变可观测的时序**，
     *   而那正是规格 §6 步骤 1 与本仓既有注释（`void … .then(warn)`）**逐字要求不许发生**的。
     *   ⇒ 失败由调用方写一条 `warn`（它是旁路，不是裁决）。
     */
    return undefined
  }
}

/**
 * ── ★★★ t93：**分配 id 并追加** —— 分配与占用合成一步（与 t89 同族）───────────────
 *
 * ── 要回答的那个问题：「**并发两次 `appendSignal`，怎么保证 id 不撞？**」────────────
 *
 * ★ 先说**不是**怎么修的：给 `nextSignalId` 的正则补一个 `\s*` **只修这一次**。
 *   根因是「**读-算-写**」这个三段式 —— 两个并发调用者**都读到同一个 max**，
 *   各自算出**同一个** `e-00NN` ⇒ 撞车。★ 而这一步**与序列化格式无关**：
 *   即使正则完全正确，那个竞态**照样存在**。
 *
 * ── ★★ 实测：这条流的 append **本身已经是原子的** ────────────────────────────────
 *
 * MEASURED（本任务）：**20 次并发 `appendFile`** 到同一路径
 * ⇒ **20/20 行都在，且 20/20 都能 `JSON.parse`**（`O_APPEND` 的写入是原子的）。
 * ⇒ ★★ **所以竞态只在【分配】那一段，不在【写入】那一段。**
 *   （这与 `frictions/` 那边不同：那边一次写一个**文件**，写入**不是**原子的 ⇒ t89 要修两处。）
 *
 * ── ★★ 修法：把"读-算-写"整段**串行化** ──────────────────────────────────────────
 *
 * 与 t89 的 `claimFrictionId` **同一条纪律**（"分配与占用是一步"），
 * 但**落点不同** —— 因为这里的占用**不是一个文件**，而是**一行**：
 * ```
 *   frictions/      占用 = 创建一个文件（O_EXCL 天然排他）⇒ t89 用 `open(path,'wx')`
 *   evolution/      占用 = 追加一行（O_APPEND 原子，但**不排他**）
 *   ⇒ ★ 所以这里排他的落点是【那个文件上的临界区】，而不是某个 id 的路径
 * ```
 * ⇒ 用本仓**已有**的进程内互斥（`state.ts` 的 `withTeamLock`，与 scheduler 同源）
 *   把「读 max → 算 id → 追加」整段包住 ⇒ **同一个进程里的两个并发调用必然拿到不同 id**。
 *
 * ── ★★ 而它的**边界**必须写清楚（不许让"一个进程内"读成"任何地方"）────────────────
 *
 * ★ `withTeamLock` 是**进程内**的（`locks` 是模块级 `Map`）⇒ 它**不跨进程**。
 *   ⇒ 若**两个进程**同时往同一棵树追加，它们仍可能撞 id。
 * ★ 而那个边界**现在有一个显式的读数**：`duplicateSignalIds()`。
 *   它让"撞了"**读得出来**，而不是表现为"某条记录不见了"。
 * ★ 为什么不干脆做**跨进程**的锁（`O_EXCL` 锁文件）：那会引入**清理问题** ——
 *   持锁进程崩溃留下的锁文件会让**整条采集流永远卡住**，而采集是**旁路**
 *   （`void … .then(warn)`）⇒ **卡住比偶尔撞一次更坏**（t89 那条注释逐字记过同一取舍）。
 *   ★ 所以本任务选择"**进程内串行 + 撞击可读**"，而不是"跨进程排他 + 可能永久卡死"。
 *
 * @param build - 由调用方给**除 id 以外**的那部分（id 由本函数在临界区内定）。
 * @returns 写成功的 id；写不进去 ⇒ `undefined`（**不抛** —— 同 `appendSignal`）。
 */
export async function appendSignalClaimingId(
  stateRoot: string,
  build: (id: string) => EvolutionSignal,
): Promise<string | undefined> {
  return withEvolutionLock(stateRoot, async () => {
    /**
     * ★★ **在临界区内**重读 —— 这是全部要点。
     *   把这一行挪到锁外面，两个并发调用就又会读到同一个 max（= 旧缺陷）。
     */
    const id = await nextSignalId(stateRoot)
    const signal = build(id)
    return await appendSignal(stateRoot, signal)
  })
}

/**
 * ── ★★ 进程内互斥（t93）────────────────────────────────────────────────────────
 *
 * ★ 自实现而不是 import `state.ts` 的 `withTeamLock`：与 t89 的 `writeFileAtomic`
 *   **同一条理由** —— 那个函数在 `state.ts` 里是**导出的**（可复用），但它绑的是
 *   "team" 语义；信号流的 key 是 **stateRoot 下的 evolution 目录**。
 *   ★ 而形状**完全相同**（前一个 promise 链尾 = 队列），注释注明同源。
 *
 * ★ 用 `Map` 而不是一把全局锁：两个**不同**的 `stateRoot` 互不影响
 *   （全局锁会把不相干的仓库串起来，那是本仓记账过的"用锁掩盖并发问题"）。
 */
const evolutionLocks = new Map<string, Promise<unknown>>()

async function withEvolutionLock<T>(stateRoot: string, fn: () => Promise<T>): Promise<T> {
  const key = `evolution:${stateRoot}`
  const previous = evolutionLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  evolutionLocks.set(key, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    /** ★ 仍是队尾才清掉（与 `withTeamLock` 的清理纪律一致，否则会留一条链）。 */
    if (evolutionLocks.get(key) === tail) evolutionLocks.delete(key)
  }
}

/**
 * ── ★★★ `collection` 四条的裁决 → 一个三态结论 ──────────────────────────────────
 *
 * ★ 输入是 `registry.evaluate('collection', …)` 的 `GateEvaluation`。
 * ★★ 判定规则（与全仓三态纪律一致，**不许合流**）：
 *
 *   ① `ran[]` 里有 `unmeasured` ⇒ ★ **判不了**（`undefined`）
 *      —— "测不了"与"不采"**不同形**：前者要补输入，后者是决定。
 *   ② 否则 `ok === false` ⇒ **不采**（`false`）
 *   ③ 否则 ⇒ **采**（`true`）
 *
 * ★ 而这与"**采集**"本身是两件事：本函数只回答"**要不要采**"，
 *   写盘由 {@link appendSignal} 做。⇒ 于是"采集了"与"不采"在记录里可辨。
 */
export function collectionDecisionOf(evaluation: {
  readonly ok: boolean
  readonly unmeasured?: string
  readonly ran: readonly { readonly id: string; readonly verdict: string }[]
} | undefined): { readonly collected: boolean | undefined; readonly verdicts: readonly { readonly gateId: string; readonly verdict: string }[] } {
  const verdicts = (evaluation?.ran ?? []).map((entry) => ({ gateId: entry.id, verdict: entry.verdict }))
  /**
   * ★ 求值对象**整个缺席** ⇒ 判不了（不是"采"）——
   *   一个缺席的求值与"四条都放行"在读取端必须不同形。
   */
  if (evaluation === undefined) return { collected: undefined, verdicts }
  /** ★ ① 有 `unmeasured` ⇒ 判不了（**先判它** —— 它是"我没测出来"，不是"我采"）。 */
  if (evaluation.unmeasured !== undefined || verdicts.some((v) => v.verdict === 'unmeasured')) {
    return { collected: undefined, verdicts }
  }
  /** ★ ②/③ 由 `ok` 定。 */
  return { collected: evaluation.ok, verdicts }
}

/**
 * ── ★★★ N1.1：把判据结论投影成**盘上那一格的四值** ──────────────────────────────
 *
 * ★ 这是一个**纯映射**（没有 I/O、没有判断）：它只回答"这三个内部状态各自该落成什么"。
 *   把它单独拿出来，是为了让"落什么"只有一处真值 —— 而调用方只负责**调用它**。
 *
 * ── ★ 为什么 `false` 与 `undefined` 要落到**不同**的字面量 ──────────────────────
 *
 *   它们是两个不同的事实（见 `EvolutionSignal.collected` 的注释）：
 *     `false`     ⇒ 判据**做了决定**：不采。补救动作 = 去看那条判据对不对。
 *     `undefined` ⇒ 判据**没能决定**。补救动作 = 去看看它的输入缺了什么。
 *   ★ 若两者都写成同一种字面量，则"判据判不了"会被读成"判据说别采" ——
 *     而那是本仓记账最久的形态（一个读数被当成一个决定）。
 *
 * ★ `null` 在这条映射里**不会**出现：它是给"这一格根本没写"留的（存量行）。
 *   本函数只要被调用，就一定写出三值之一 —— 这正是"键永远在场"的落点。
 */
export function collectedFieldOf(decision: {
  readonly collected: boolean | undefined
}): 'collected' | 'skipped' | 'unmeasured' {
  if (decision.collected === true) return 'collected'
  if (decision.collected === false) return 'skipped'
  return 'unmeasured'
}

/**
 * ── ★★★ `observe()` —— 三个汇合点调用的**唯一**入口（规格 §1）──────────────────────
 *
 * ★★ 为什么要一个统一入口，而不是三处各写一遍：
 *   三处各写一遍 ⇒ 三份"先问 collection 再写"的逻辑 ⇒ **它们会分叉**
 *   （本仓记账最贵的那类缺陷）。⇒ 采集形状只有这一处实现。
 *
 * ── ★ 调用形状（规格 §1 逐字）：在**已有的失败路径**上加一行 ────────────────────────
 *
 * ```ts
 * void observe({ stateRoot, registry, where, message, tool, gateId, mechanisms })
 * ```
 * ★ **`void` 是要求，不是风格**：拒绝路径必须**立刻抛出去**，
 *   不许因为"写台账慢"把一次拒绝变成一次等待（本仓既有注释逐字）。
 * ★ 而本函数**自己**也不抛 —— 它 catch 住一切并通过 `warn` 报出（见下）。
 *
 * ★★★ `registry` 由**调用方注入**（不是这里 import）—— 那是"不侵入"的落点：
 *   本模块因此**不依赖** `src/gates/**`，方向是 `调用方 → evolution`，单向。
 */
export interface ObserveInput {
  /** 这个团队自己的 stateRoot（**由调用方给，不许用进程级单值** —— 与 `recordFriction` 同一条纪律）。 */
  readonly stateRoot: string | undefined
  /** 采集前先问 `collection` 四条：值不值得记。★ 由调用方注入（不在这里 import）。 */
  readonly evaluateCollection?: (context: {
    readonly candidate: {
      readonly kind: readonly string[]
      readonly component?: string
      readonly message: string
      readonly source?: string
      readonly at: number
    }
    /**
     * ── ★★★ N1.2：`index` 在这里**必须是可选的** ────────────────────────────────
     *
     *   旧形状把它写成**必填** —— 而那恰恰是焊接的**类型面**：
     *   调用方要么编一个空索引来满足类型（旧 `observe` 正是这么干的），
     *   要么就得改类型。★ 必填的输入会让"我没有这个输入"在类型系统里**无法表达**，
     *   于是它只能表现为"我有一个空输入" —— 而两者在读数上正好相反
     *   （前者该 `unmeasured`，后者该 `ok`）。
     *   ⇒ 改成可选后，`CollectionContext` 的三态才真的能传过来。
     */
    readonly index?: {
      readonly seen: ReadonlySet<string>
      readonly lastBySource: ReadonlyMap<string, number>
      readonly counts: ReadonlyMap<string, number>
    }
  }) => Promise<{ readonly ok: boolean; readonly unmeasured?: string; readonly ran: readonly { readonly id: string; readonly verdict: string }[] }>
  /** 这份索引（从**既有**台账读；本任务是步骤 1，允许是空索引 —— 见下）。 */
  readonly index?: {
    readonly seen: ReadonlySet<string>
    readonly lastBySource: ReadonlyMap<string, number>
    readonly counts: ReadonlyMap<string, number>
  }
  /** 确定性来源：谁拒的。 */
  readonly where: string
  /** ★ 原文，不改写。 */
  readonly message: string
  /**
   * ── ★★★ 这是**候选类别**（`['unwired']` 那种），进**去重键** ──────────────────
   *
   * ★★ 它与 `EvolutionSignal.kind`（`'rejection' | 'success' | 'insight'`）是
   *   **两个不同的东西**，只是碰巧同名（N1.1 的由来）：
   *     · 这一个：**这条信号属于哪一类缺陷** —— 进 `dedupeKeyOf` 的三段之一；
   *     · 那一个：**这次采集是被谁触发的** —— 落在盘上的 `kind` 字段。
   *   MEASURED（N1 之前）：写盘那一行硬编码了 `kind: 'rejection'`，
   *   而本字段**整个被丢掉** ⇒ 去重键的 `kind` 段永远是同一个值 ⇒
   *   不同类别的信号在去重时**同形**（少采）。
   *   ★ 所以这里**不改名**（改名会动到三个调用点与既有夹具），
   *   而是把**写盘那一格**改成可注入的 `signalKind` —— 两个名字各自归位。
   */
  readonly kind: readonly string[]
  readonly component?: string
  readonly tool?: string
  /**
   * ── ★★★ N1.2：`collection.cooldown` 的**来源键** —— 不传 ⇒ 那条判据仍判不了 ──────
   *
   * ★ 三个调用点此前**一个都没传**它 ⇒ 即使 `index` 接上了，`cooldown` 仍答
   *   `unmeasured`（"this signal carries no source"）⇒ 那个数**从 34 变成 34**，
   *   只是理由从"没有索引"换成"没有来源"。⇒ 本任务必须同时接这一格。
   *
   * ★★ 口径由**计划 §2.1 裁定**，不让实现者临场定：传 `where`（粗粒度）。
   *   两个选项的收益靶都算过（`where` ⇒ 挡 15；`where+gateId` ⇒ 挡 13）——
   *   ⇒ 调用点因此只需传 `source: <这个 where 的字面量>`，
   *     而**怎么拼**由 `sourceKeyOf`（`gates/collection/shared.ts`）一处说了算。
   *   ★ 这里**不**由 `observe` 从 `input.where` 自动补：自动补会把
   *     "调用方有没有想清楚来源是什么"这件事**藏起来** —— 而那正是本任务要拆的焊点。
   */
  readonly source?: string
  readonly gateId?: string
  /**
   * ── ★★★ 写到盘上的 `EvolutionSignal.kind`（N1.1）────────────────────────────────
   *
   * ★ 缺省 `'rejection'`：三个调用点今天全都**不传**它 ⇒ 存量的
   *   `by kind = {rejection: 46, insight: 2, success: 1}` **逐字不变**。
   *   （★ 这是刻意的：本任务拆的是两格字段的焊点，**不**顺手改采集行为 ——
   *     改了之后"这个数变了"就分不清是拆焊的功劳还是改行为的功劳。）
   * ★ 而它一旦可注入，`success` / `insight` 那两条路就有了**真的落点**
   *   （今天它们只能靠人手写补录产生）。
   */
  readonly signalKind?: 'rejection' | 'success' | 'insight'
  /** ★★ 机制活动 —— **转发**已有裁决，**不重算**（规格 §2 硬约束 3）。 */
  readonly mechanisms?: readonly { readonly gateId: string; readonly verdict: string }[]
  /**
   * ── ★★★ N1.2：索引的**惰性**加载器 —— 由调用点注入，由本函数 await ────────────────
   *
   * ── 为什么不是一个现成的 `index`（那才是 `index` 这一格本来的样子）──────────────
   *
   *   三个调用点全都在**拒绝路径**上，而那里的纪律逐字是「拒绝必须**立刻**返回，
   *   不许因为写台账而等待」（`create-task.ts` 那段注释与 `void observe(...)` 一起）。
   *   ★ 取索引要读一次 `signals.jsonl`。若调用点 `await` 它再调 `observe`，
   *     就是**把一次文件读塞进拒绝路径** —— 一次拒绝多一次磁盘等待，
   *     而这条路径每轮要跑十几次。⇒ 纪要被破坏的形态正是本仓反复记过的：
   *     "为了防止一个问题而引入另一个更贵的问题"。
   *
   *   ★ 所以这里收一个**函数**而不是值：调用点把它顺手交给 `void observe(...)`，
   *     真正的读发生在**已经不被 await 的那一段里**。时序不变，索引照样有。
   *
   * ── ★ 为什么 `index` 与 `loadIndex` 两个形状都留着 ──────────────────────────────
   *
   *   `index` 给**已有索引**的调用方（夹具、未来的批处理），零 I/O；
   *   `loadIndex` 给**生产路径**（它必须自己去盘上取）。
   *   ★ 两个都在 ⇒ 优先级要写死：**显式 `index` 优先**（调用方已经拿到的东西不许被覆盖）。
   */
  readonly loadIndex?: () => Promise<{
    readonly seen: ReadonlySet<string>
    readonly lastBySource: ReadonlyMap<string, number>
    readonly counts: ReadonlyMap<string, number>
  } | undefined>
  /** 现在（毫秒）。★ 由调用方给，便于夹具复现。 */
  readonly now: number
  /** 写失败时的告警出口（旁路，不参与裁决）。 */
  readonly warn: (message: string) => void
}

/**
 * 采集一条信号 —— ★ **本函数从不抛**（它是旁路）。
 *
 * @returns 写成功 ⇒ 信号 id；被判据拒绝或写失败 ⇒ `undefined`（★ 由 `warn` 区分原因）
 */
export async function observe(input: ObserveInput): Promise<string | undefined> {
  const { stateRoot } = input
  /** ★ 没有 stateRoot 就不记 —— 记到别处比不记更坏（`recordFriction` 的注释逐字）。 */
  if (stateRoot === undefined || stateRoot === '') return undefined
  try {
    /**
     * ── ★★★ N1.2：三态「索引」在这里汇成一处 ─────────────────────────────────────
     *
     *   显式 `index`        ⇒ 用它（调用方已经拿到的东西不许被覆盖）
     *   `loadIndex()` 有索引 ⇒ 用它（生产路径：从盘上派生）
     *   `loadIndex()` 缺席   ⇒ ★ **不传** —— 判据自己答 `unmeasured`
     *   ★ 第三条是旧的空索引兜底被删掉之后唯一正确的落点：**如实不给**。
     *     空索引会被读成"这个仓库还什么都没采过" ⇒ 每条都 `ok` ⇒ 去重静默失效。
     */
    const index = input.index ?? (input.loadIndex === undefined ? undefined : await input.loadIndex())
    /**
     * ★★ 先问 `collection` 四条 —— **这是本任务的全部目的**：
     *   在此之前 `evaluate('collection', …)` 在生产路径上**一次都没被调用过**。
     */
    const collection = input.evaluateCollection === undefined
      ? undefined
      : await input.evaluateCollection({
          candidate: {
            kind: input.kind,
            ...input.component === undefined ? {} : { component: input.component },
            message: input.message,
            ...input.source === undefined ? {} : { source: input.source },
            at: input.now,
          },
          /**
           * ── ★★★ N1.2：**不再用空索引冒充"没有索引"** ─────────────────────────
           *
           *   旧写法逐字是 `input.index ?? { seen: new Set(), lastBySource: new Map(), counts: new Map() }`。
           *   ★★ 那个兜底让 `collection.dedupe` **永远不会** `unmeasured` ——
           *     它总拿到一个空索引，于是每一条都判 `ok`（"没见过"）。
           *     而空索引和"这个仓库还什么都没采过"在**读数上完全相同**
           *     ⇒ 去重**静默失效**，而读数上一切正常（本仓记账最久的形态）。
           *
           *   ⇒ 没给就**如实不给**：判据自己答 `unmeasured`（"说不出是不是重复"）。
           *     ★ 这比假的 `ok` 有用：`unmeasured` 会被人看见并去接线，
           *       `ok` 会让人以为去重在工作。
           *
           *   ★ 调用方要拿到真索引 ⇒ 传 `index: (await deriveCollectionIndex(...)).index`。
           */
          ...index === undefined ? {} : { index },
        })
    const decision = collectionDecisionOf(collection)
    /**
     * ★★ 判据说"**不采**"（`collected === false`）⇒ **不写这一条**。
     *   ★ 而"**判不了**"（`undefined`）⇒ ★ **仍然写** —— 两者**不同形**：
     *     前者是判据做的决定，后者是"我们没测出来"。
     *     ★ 若把"判不了"也当"不采"，那么"采集层坏了"会表现为"库里安静地没有新信号" ——
     *       而那与"确实没有信号"同形（本仓记账最久的形态）。
     */
    if (decision.collected === false) return undefined
    /**
     * ── ★★★ N1.1：顶层 `collected` **永远落盘**，且 `undefined` 写成 `null` ────────
     *
     * ★ 为什么不是 `collected: decision.collected ? 'collected' : ...`：
     *   那样两步就退化成两值（`collected === false` 那条在上面已经 return 了，
     *   但**判不了**那一条会走到这里）—— 而三态缺一态就等于两态。
     *
     * ★ 为什么用 `appendSignalClaimingId` 而不是继续 `nextSignalId` + `appendSignal`：
     *   本函数现在要写**两格**新字段（`collected` 与 `signalKind`），
     *   而"分配 id 与占用"必须仍是一步（t93 的并发缺陷）。
     *   ★ 保持原有的调用形态（`nextSignalId` + `appendSignal`）同样正确 —— 见下。
     *
     * ★★ 键**永远在场**：`collected` 一定被赋一个三值之一，
     *   `JSON.stringify` 因此一定会写出它（`null` 也会被写出，`undefined` 才不会）。
     */
    /**
     * ★★ 下面这一句**就是上面那段注释说的那一步** —— 分配 id 与占用是**一次**调用。
     *   ★ MEASURED（本任务实测）：这段注释写于 t93，而代码里一直是
     *     `nextSignalId(stateRoot)` + `appendSignal(...)` 的**两步式** ——
     *     正是 t93 判定为缺陷的那一条（两个并发调用者读到同一个 max ⇒ 撞 id）。
     *     注释说"用 appendSignalClaimingId"，代码没用 ⇒ 那条修复**写好了、
     *     测过了（`gate-signal-id-uniqueness.test.mjs` 臂 3 并发 12 次）、而从未被调用**。
     *   ⇒ 现在真的接上：`id` 在临界区内定，Build 回调拿到它再拼信号。
     */
    const written = await appendSignalClaimingId(stateRoot, (id) => ({
      id,
      at: input.now,
      /**
       * ★★★ N1.1：**不再硬编码** —— 可注入，缺省 `'rejection'`（三条现有路径行为不变）。
       *   ★ 缺省放在**这里**（读取的那一刻）而不是解构签名里，是为了让
       *     "调用方没传"在代码里**看得见**（`?? 'rejection'` 是一个显式的选择）。
       */
      kind: input.signalKind ?? 'rejection',
      source: {
        where: input.where,
        ...input.gateId === undefined ? {} : { gateId: input.gateId },
        ...input.tool === undefined ? {} : { tool: input.tool },
      },
      message: input.message,
      ...input.mechanisms === undefined ? {} : { mechanisms: input.mechanisms },
      /**
       * ── ★★★ N1.2：把**候选面原料**落盘，让 `deriveCollectionIndex` 能逐字重建去重键 ──
       *
       * ★ 为什么必须落：去重键是 `kind|component|message` 三段，而顶层 `kind`
       *   是 `'rejection'`（**另一个东西**）、`component` **原先根本不落盘**
       *   ⇒ 索引端从旧行拼不出写端算的那个键 ⇒ `seen.has(key)` 恒假
       *   ⇒ **去重永不命中**，而读数上一切正常。这是本任务最贵的那一格。
       * ★ 落的是**原料**（数组 + component），不是算好的键字符串 ——
       *   公式只有 `dedupeKeyOf` 一处真值，将来改公式对存量行同样成立。
       */
      candidate: {
        kind: input.kind,
        ...input.component === undefined ? {} : { component: input.component },
      },
      collection: decision,
      /** ★ N1.1：顶层三态（见 `EvolutionSignal.collected` 的四值说明）。**永远在场。** */
      collected: collectedFieldOf(decision),
    }))
    if (written === undefined) input.warn(`agent-teams: could not append an evolution signal at "${input.where}"`)
    /**
     * ── ★★★ 2026-10-21：信号落盘之后，**顺手**把它分流并落盘（R2.2 的前半）────────
     *
     * MEASURED（本次审计）：整条流水线此前只在**读的时候现算** ——
     * `readProposalPipeline` 每次点开面板都把同一批信号重算成提案，然后**丢掉**。
     * 于是"这一批产出了 2 份提案"与"盘上从来没有过一份提案"两句都真，而它们在面板上同形。
     *
     * ── ★★ 这里为什么可以 `await`，而上面那句 `void observe(...)` 不行 ──────────────
     *
     *   ```
     * 调用方 → void observe(...)          ⇒ 不等待的这一层**已经**把时序保住了
     * 本函数内部 → await 写提案            ⇒ 等的是**这一层之内**的事，对调用方不可观测
     * ```
     *   ★ 也就是说：**"拒绝立刻返回"这条纪律由调用点的 `void` 保证，不需要本函数再牺牲一次**。
     *   而 `await` 换来的是"返回值返回时盘上已经真的有那一行" —— 于是夹具与人都能**当场**核对。
     *   ★★ 第一版写的是 `void ... .then(...)`：夹具臂 1 立刻红了（`proposals.jsonl` 还没出现就断言了），
     *   而那个红**不是夹具太苛刻** —— 它暴露了"`observe` 返回了，而它的副作用还没发生"。
     *   一个 `undefined` 之后才落地的副作用，在任何调用方看来都等于"没发生"。
     *
     * ★ 仍然**绝不抛**：`recordProposalForSignal` 自己 catch 一切（见其文件头纪律 ①）。
     */
    if (written !== undefined) {
      await recordProposalForSignal(stateRoot, {
        id: written,
        message: input.message,
        where: input.where,
        ...input.gateId === undefined ? {} : { gateId: input.gateId },
        ...input.tool === undefined ? {} : { tool: input.tool },
        kind: input.signalKind ?? 'rejection',
        at: input.now,
      })
    }
    return written
  } catch (reason) {
    /**
     * ★★ **绝不抛** —— 调用方在拒绝路径上。把"采集坏了"变成"这次拒绝变成异常"
     *   会**改变可观测的时序**，而拒绝路径的行为是本任务的反向半边 C 要保的东西。
     */
    input.warn(`agent-teams: evolution.observe threw at "${input.where}" (recorded, not thrown at the caller): ${String(reason)}`)
    return undefined
  }
}
