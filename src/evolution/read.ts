/**
 * ── ★★★ t101：把 `signals.jsonl` 读成 `HealthRecord[]`（health.ts 的**第一个消费者**）─────
 *
 * ★★ 背景（`EVOLUTION-WIRING-GAP.md` §1 逐字）：`health.ts` 此前**零消费者** ——
 *   `collectionHealthOf` 能算，但从**没有任何生产路径算过它**。
 *   而"造一个函数 + 一个夹具"**不会改变那件事** ⇒ 本模块把**读文件**与**算读数**接起来，
 *   并由 `src/snapshot.ts`（生产出口：`/state` 路由）调用。
 *
 * ── 三态（本模块的全部难点：三种"没有读数"必须互不同形）──────────────────────────
 *
 * ```
 *   A · 文件缺席（还没采过任何东西）      ⇒ { status: 'unmeasured', reason: 'file-absent' }
 *   B · 文件在、但解析不出任何记录（空文件/全坏行） ⇒ { status: 'measured', records: [] } ← 与 A 不同形
 *   C · 一行坏 JSON                        ⇒ 只跳那一行（`skippedMalformed` 计数），**不整文件放弃**
 * ```
 * ★ A 与 B 的差别是**实打实的**：A = "这条流水线还没开过"（读数无对象）；
 *   B = "流水线开了、但目前一条都没采到"（读数对象是空集 —— `redundancy/coverage` 按空集口径给 0）。
 * ★ C 的先例：t93 的 `maxSignalNumberIn` 逐行 `JSON.parse`、坏行走兜底 ——
 *   **一行坏掉不许让整个读数归零**。
 */

import { duplicateSignalIds, signalsPathOf } from './collect.ts'
import type { HealthRecord } from './health.ts'

/** 读取的结果 —— 三态（`unmeasured` / 空集 / 有记录），外加坏行计数。 */
export interface SignalsHealthRead {
  /**
   * ★ 三态：`unmeasured`（文件缺席，无对象）/ `measured`（文件在 —— **哪怕零条记录**）。
   * ★★ `measured` + `records: []` 与 `unmeasured` **不同形**：前者答"采了 0 条"，
   *   后者答"这条流水线还没开过" —— 合起来会把"没开"读成"开了没采到"。
   */
  readonly status: 'unmeasured' | 'measured'
  /** 为什么 `unmeasured`（只在 `status === 'unmeasured'` 时在场）。 */
  readonly reason?: 'file-absent'
  /** 解析成功的记录（**已投影成 `HealthRecord`**，可直接喂 `collectionHealthOf`）。 */
  readonly records: readonly HealthRecord[]
  /**
   * ★ 坏行计数（**跳过的**，不是吞掉的）—— C 的读数面：
   *   "有 2 行坏掉但其余 13 行照常算" 必须可读，否则坏行与"没这行"同形。
   *   ★ `status === 'unmeasured'` 时缺席（没有行可言）。
   */
  readonly skippedMalformed?: number
  /** 读到的原始行数（含空行与坏行）—— 给"跳了多少"一个分母。 */
  readonly totalLines: number | undefined
  /**
   * ★★ 被采集判据拒掉的条数，**按判据 id 分组**（直接喂 `collectionHealthOf` 的第二参）。
   *
   * ★ 来源：每条信号自带的 `collection.verdicts`（t87 转发的裁决）——
   *   **数 `ok` 之外的裁决**（`unmeasured` 也算"这一条没被采进来"，但它单列语义更准：
   *   ★ 如实记：本计数把 `unmeasured` 与 `false` 都算"没进来" —— 而两者的补救动作不同
   *   （前者是判据说测不了，后者是判据说不要）。★ 本模块**不合并**它们：`refused` 只数
   *   `ok` 之外的，**读的人若要分**，原始行还在（本模块不丢）。
   *   ★ 为什么这里数而不是 snapshot 数：坏行/缺席该格的行**没有 verdicts 可言**，
   *   在读行的那一层计数才不会把"没这格"错算成 0。
   */
  readonly refused?: Readonly<Record<string, number>>
  /**
   * ── ★★★ t93：**撞过车的 id** —— "曾经撞过"必须读得出来 ────────────────────────────
   *
   * `docs/SIGNAL-ID-COLLISION.md:222` 逐字：「那五组撞车**仍在文件里**（审计数据）。
   * ★ 读取端要靠 `duplicateSignalIds` **主动问**；**不问就仍会读到错的那条**」。
   *
   * ★ 本模块就是那个「读取端」：它已经把整份 `text` 读进来了，而 `duplicateSignalIds`
   *   正是拿 `text` 判的 ⇒ 这一问在这里是**零额外 I/O** 的（补一行读取，不新造链路）。
   *
   * ★ 为什么它必须与 `skippedMalformed` 分开计数：坏行是"这一行不能用"，
   *   撞车是"这两行都用得了、但按 id 索引会取到错的那条" —— 补救动作不同
   *   （前者去查写入端，后者去查**读的人按 id 信了谁**）。
   * ★ `status === 'unmeasured'` 时缺席（没有文件就没有行，也就没有 id 可撞）。
   * ★ **只有真的撞了才在场**：空数组会与"没撞过"不同形，而这里两者同一件事。
   */
  readonly duplicateIds?: readonly { readonly id: string; readonly lines: readonly number[] }[]
}

/**
 * 一条信号里能当**桶分类**用的字段 —— 两代形状并存（逐行 parse，**不许假设形状**）：
 *
 * ```
 *   t88 手工补录（10 行）：顶层是 `title/observed/...`，分类住在 `routing.target/effect` 里，
 *                          且**多为自由文本串**（t91 注释记过：字符串对分流合格、对收益不合格）
 *   t87 `observe` 采集（5 行）：`source.{where,gateId,tool}` + `collection.verdicts`
 * ```
 * ★★ 投影规则（**保守**：分类不出来就落 `(unattributed)`，**不编**）：
 *   · `kind[]`   ← t87 的 `routing.kind[]`？没有 —— 真数据里 t87 行没有结构化类别，
 *                  ⇒ 用**它真的有的**：`source.where`（确定性来源）作 component 候选；
 *   · ★ 而那意味着本读数今天**主要回答"按来源分桶的重复率"**，不是规格里那个
 *     `(component, kind)` 的完整语义 —— ★ 如实记下，这是**数据形状决定的**，
 *     等分流（规格顺序 ②）落地后有结构化类别，这里的投影再升级。
 */
function healthRecordOf(signal: Record<string, unknown>): HealthRecord {
  const at = typeof signal.at === 'number'
    ? signal.at
    : typeof signal.at === 'string' ? Date.parse(signal.at) || 0 : 0
  /** `source.where`：两代形状**都有**（t88 的 `source.where` / t87 的 `source.where`）。 */
  const source = (signal.source as { readonly where?: unknown } | undefined)?.where
  const component = typeof source === 'string' && source.trim() !== '' ? source : undefined
  /**
   * ★ `kind[]`：t87 行**没有**结构化类别 ⇒ 兜底成一个**单元素**类别，
   *   取信号的三分类（`rejection/success/insight`）—— 它两代都有，且**是真实的语义分类**。
   *   （比编一个"unwired"强：那类标签今天只活在自由文本里。）
   */
  const signalKind = typeof signal.kind === 'string' && signal.kind !== '' ? signal.kind : '(unclassified)'
  return { component, kind: [signalKind], at }
}

/**
 * 读 `signals.jsonl` 并投影成 `HealthRecord[]`。
 *
 * @param stateRoot 状态根（`signalsPathOf` 拼路径 —— **不猜**）。
 * @param readFile  注入的读文件函数（生产给 `fs/promises.readFile`；夹具注入内存版）。
 */
export async function readSignalsHealth(
  stateRoot: string,
  readFile: (path: string, encoding: 'utf8') => Promise<string>,
): Promise<SignalsHealthRead> {
  let text: string
  try {
    text = await readFile(signalsPathOf(stateRoot), 'utf8')
  } catch {
    /**
     * ── ★★★ 反向半边 A：文件缺席 ⇒ `unmeasured`，**不是空读数** ────────────────────
     *
     * 文件不存在 = 采集流水线**还没开过**（t87 之前连目录都没有）。
     * 此时 `records: []` 会让"没开过"与"开了没采到"同形 ⇒ 整格缺席语义由 `status` 承载。
     */
    return { status: 'unmeasured', reason: 'file-absent', records: [], totalLines: undefined }
  }
  const lines = text.split('\n')
  const records: HealthRecord[] = []
  const refused: Record<string, number> = {}
  let skippedMalformed = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    /**
     * ── ★★★ 反向半边 C：一行坏 JSON ⇒ **只跳那一行**（t93 纪律）────────────────────
     *
     * 一个半写坏的行（进程在 append 中途死掉会造出这种行）不该让**全部**读数消失。
     * ★ 跳过是**计数的**（`skippedMalformed`），不是静默的 —— "跳了 2 行"与"没这 2 行"不同形。
     */
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        skippedMalformed += 1
        continue
      }
      records.push(healthRecordOf(parsed))
      /**
       * ★ 数 refused：该行自带的 `collection.verdicts` 里 **`ok` 之外**的裁决各计一次。
       *   ★ 没有该格的行照实跳过（不补 0 —— 那会把"没跑采集判据"算成"全过"）。
       */
      const verdicts = (parsed.collection as { readonly verdicts?: readonly { readonly gateId?: unknown; readonly verdict?: unknown }[] } | undefined)?.verdicts
      if (Array.isArray(verdicts)) {
        for (const verdict of verdicts) {
          if (typeof verdict.gateId !== 'string' || typeof verdict.verdict !== 'string') continue
          if (verdict.verdict === 'ok') continue
          refused[verdict.gateId] = (refused[verdict.gateId] ?? 0) + 1
        }
      }
    } catch {
      skippedMalformed += 1
    }
  }
  /**
   * ── ★★★ 反向半边 B：文件在 ⇒ `measured`，**哪怕零条记录** ─────────────────────────
   *
   * 与 A 不同形：B 答"流水线开了、目前一条都没采到"（空集口径的 redundancy/coverage = 0），
   * A 答"流水线还没开"。两者的补救动作相反（B 看采集为什么没采到；A 看流水线为什么没开）。
   */
  return {
    status: 'measured',
    records,
    refused,
    ...skippedMalformed > 0 ? { skippedMalformed } : {},
    /**
     * ★ 撞过车的 id（见 {@link SignalsHealthRead.duplicateIds} 的注释）。
     *   判据是**已经读进内存的那份 text** —— 不重读文件，因此不可能与上面
     *   `records` 看的是两份不同的字节。
     *   ★ 只在撞过时在场：`[]` 与"从来没撞过"在这里是同一件事，写出来只是噪音。
     */
    ...(() => {
      const duplicates = duplicateSignalIds(text)
      return duplicates.length === 0 ? {} : { duplicateIds: duplicates }
    })(),
    totalLines: lines.length,
  }
}

/**
 * ── ★★★ N1.2：`deriveCollectionIndex` —— 给 `collection.cooldown` 一个**真实输入** ────
 *
 * ── 它修的是什么（MEASURED，本任务的由来）──────────────────────────────────────
 *
 *   `collection.cooldown` 在真实台账上 **39/39 判不了**，而那不是"判据坏了"：
 *   它的 `requires = ['candidate', 'index']`，而**三个调用点一个都没传 `index`**
 *   ⇒ `index === undefined` ⇒ 判据照规程答 `unmeasured`。
 *   ★ 也就是说：那条判据**从来没有机会**回答它被造出来要回答的问题。
 *
 *   ⇒ 本函数把"盘上已有的信号"投影成 {@link CollectionIndex} 的形状：
 *     三份（`seen` / `lastBySource` / `counts`）各自有**明确的来源**，不猜。
 *
 * ── ★★★ 为什么它住在 `evolution/` 而**不**住在 `gates/collection/` ─────────────
 *
 *   `shared.ts` 的注释逐字写着「判据不查库」——**判据层零 I/O 是载荷级不变量**
 *   （`src/gates/runtime/stall.ts` 的注释：那条纯度是载荷，不是风格）。
 *   而本函数要读 `signals.jsonl` ⇒ 它**必须**在 I/O 那一侧，即 `evolution/`。
 *
 * ── ★★★ 去重键的计算**注入**进来，不在这里重写一遍 ────────────────────────────
 *
 *   `dedupeKeyOf` 的真值在 `src/gates/collection/shared.ts`。
 *   ★ 而 `evolution/` **不许** import `src/gates/**`（规格 §1 的单向原则，
 *     `entities.ts` 那一侧也是这么绕的：把 `registry.evaluate` 包成回调传下去）。
 *   ⇒ 所以这里收一个 `keyOf` 回调。**公式只有一份**，而依赖方向不变。
 *   ★ 若在这里再写一遍 `kind.sort().join(',')`，就等于把"同一件事"的定义变成两份 ——
 *     而两份会在某一天分叉，分叉的表现是"去重没拦住"（少采，且静默）。
 *
 * ── ★★ 三态：读不到 ≠ 空索引 ──────────────────────────────────────────────────
 *
 *   `signals.jsonl` **缺席** ⇒ `{ status: 'absent' }`，**不是**一个空索引。
 *   ★ 空索引会被 cooldown 读成"这个来源从没说过话" ⇒ `ok` ⇒ **放行**
 *     ⇒ "采集流水线还没开过"被读成"每条都是第一次，全都该采"。
 *   ⇒ 缺席时调用方**不传** `index`，判据自己答 `unmeasured` —— 那是正确读数。
 */
export interface DerivedCollectionIndex {
  /**
   * ★ 三态：`'derived'`（读到了台账，哪怕零条）/ `'absent'`（文件还没有）。
   * ★ `'derived'` + 零条 与 `'absent'` **不同形**（与 `readSignalsHealth` 同一条纪律）。
   */
  readonly status: 'derived' | 'absent'
  /** 投影出来的索引（只在 `status === 'derived'` 时给调用方用）。 */
  readonly index?: {
    readonly seen: ReadonlySet<string>
    readonly lastBySource: ReadonlyMap<string, number>
    readonly counts: ReadonlyMap<string, number>
  }
  /** 读到了几行（分母 —— 让"零条"可复核，而不是只说一句"空"）。 */
  readonly rowsRead: number
  /** 坏行数（**跳过**，不整文件放弃 —— 与 `readSignalsHealth` 同一条纪律）。 */
  readonly skippedMalformed: number
  /**
   * ── ★★ 键**重建不出来**的行数（旧行：N1.2 之前没落 `candidate`）──────────────
   *
   * ★ 这些行**不参加去重**（它们确实没有那份原料），但**参加** cooldown
   *   （它们的 `source`/`at` 是真的，见 `indexProjectionOf`）。
   * ★ 与 `skippedMalformed` **不同形**：那些是坏数据；这些是好数据、只是当时没写全。
   * ★ 必须报出来的理由：否则"去重在这批行上没生效"与"这批行本来不重复"同形 ——
   *   而把这种同形拆开，正是本任务的全部工作。
   */
  readonly keysUnreconstructable: number
}

/**
 * 一条信号在索引里的三份投影分别取什么。
 *
 * ★ 每一份的来源都写在这里，**不散落在实现里**（读的人要能一眼看出"这个数从哪来"）。
 */
interface IndexProjection {
  /**
   * 去重键（`seen` / `counts` 用）—— 由注入的 `keyOf` 算。
   * ★ `undefined` ⇒ **这一行参加不了去重**（见 `indexProjectionOf` 的"算不出来就不算"）。
   */
  readonly key: string | undefined
  /** 这个来源**是谁**（`lastBySource` 用）。★ 缺席 ⇒ 这一条不参与 cooldown 索引。 */
  readonly source: string | undefined
  /** 这一条**被采的时刻**（`lastBySource` 用）。 */
  readonly at: number | undefined
}

/**
 * 从一条原始行算出它的三份投影 —— ★ **保守**：算不出来就是 `undefined`，**不编**。
 *
 * ── ★★★ 这里曾经有一个真缺陷，而且它正是本文件头警告过的形态 ──────────────────
 *
 *   第一版这样重建去重键：
 *     `kind`      ← `row.kind`            （**信号**类别 `'rejection'`）
 *     `component` ← `row.source.where`    （**来源**位置）
 *     `message`   ← `row.message`
 *   而写端算的是 `dedupeKeyOf({kind: input.kind, component: input.component, message})`
 *   ⇒ 写端 `unwired|contract|the message`，索引端 `rejection|validateCreateTask|the message`。
 *
 *   ★★ 两个键**永远不同** ⇒ `seen.has(key)` 恒假 ⇒ **去重永不命中**，
 *      而读数上一切正常（每条都 `ok`，看起来判据在工作）。
 *      MEASURED（探针实测）：`wantKey "unwired||same message" in seen? false`，
 *      `seen ["rejection|probe|same message"]`。
 *      ⇒ 这不是"去重判据坏了"，是**喂给它的索引不是它要的那个东西**。
 *
 * ── 修法：**新行**逐字重建，**旧行**如实承认重建不了 ──────────────────────────────
 *
 *   新行有 `candidate: {kind: string[], component?}`（N1.2 落盘的原料）⇒ 键**逐字**重建，
 *   与写端算的是同一个（同一个 `keyOf`、同一份原料）。
 *   ★ 旧行（N1.2 之前的 49 条）**盘上没有候选面**，而 `kind` 那一格装的是信号类别 ——
 *     ⇒ **重建不出来**。三个选择里只有一个诚实：
 *       ① 用 `row.kind` 硬凑  ⇒ 造一个**永远匹配不上**的键（第一版就是这么错的）
 *       ② 跳过整行          ⇒ 连它的 `source`/`at` 也丢，cooldown 白丢 39 行真实历史
 *       ③ **只要它真的有的**：`source`/`at` 留下（cooldown 能用），键留空（去重不用）
 *     ⇒ 选 ③。而"有多少行是这种"必须**计数报出来**（`keysUnreconstructable`），
 *       否则"去重在旧行上没生效"就是静默的 —— 那正是本任务在拆的东西。
 *
 * ★ 这也解释了为什么 acceptance 把存量与新行的 `keyPresent` 分成两个数：
 *   同一件事在两个人群里的**可测性不同**，合成一个数就会读成"修好了"。
 */
function indexProjectionOf(line: string, keyOf: (candidate: {
  readonly kind: readonly string[]
  readonly component?: string
  readonly message: string
}) => string): IndexProjection | undefined {
  let row: Record<string, unknown>
  try {
    row = JSON.parse(line) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (row === null || typeof row !== 'object') return undefined
  const at = typeof row.at === 'number'
    ? row.at
    : typeof row.at === 'string' ? Date.parse(row.at) || undefined : undefined
  const source = (row.source as { readonly where?: unknown } | undefined)?.where
  /**
   * ★ `source` / `at` 与 `message` 无关：**只要这一行有来源与时刻，它就参加 cooldown**。
   *   ⇒ 先算这两份，键算不出来也照样返回（`key: undefined`）。
   */
  const projectionOf = (key: string | undefined): IndexProjection => ({
    key,
    source: typeof source === 'string' && source !== '' ? source : undefined,
    at,
  })
  const candidate = row.candidate as { readonly kind?: unknown; readonly component?: unknown } | undefined
  const message = typeof row.message === 'string' ? row.message : undefined
  if (message === undefined) return projectionOf(undefined)
  /**
   * ★★ **只从 `candidate` 重建** —— 不从 `row.kind` 凑。
   *   缺 `candidate`（N1.2 之前的行）⇒ `key: undefined`，如实不参加去重。
   */
  const rawKind = candidate?.kind
  const kind = Array.isArray(rawKind)
    ? rawKind.filter((entry): entry is string => typeof entry === 'string')
    : []
  if (kind.length === 0) return projectionOf(undefined)
  const rawComponent = candidate?.component
  const key = keyOf({
    kind,
    ...typeof rawComponent === 'string' && rawComponent !== '' ? { component: rawComponent } : {},
    message,
  })
  return projectionOf(key)
}

/**
 * 读 `signals.jsonl` 并投影成一份索引（**只读**；不写盘、不加锁）。
 *
 * @param stateRoot 状态根（`signalsPathOf` 拼路径 —— **不猜**）。
 * @param readFile  注入的读文件函数（生产给 `fs/promises.readFile`）。
 * @param keyOf     去重键的计算（**注入** —— 见文件头那一节）。
 */
export async function deriveCollectionIndex(
  stateRoot: string,
  readFile: (path: string, encoding: 'utf8') => Promise<string>,
  keyOf: (candidate: { readonly kind: readonly string[]; readonly component?: string; readonly message: string }) => string,
): Promise<DerivedCollectionIndex> {
  let text: string
  try {
    text = await readFile(signalsPathOf(stateRoot), 'utf8')
  } catch {
    /**
     * ★★ 缺席 ⇒ **不**返回空索引（那会被 cooldown 读成"每条都是第一次"）。
     *   ⇒ 明确答 `absent`，由调用方**不传** `index`。
     */
    return { status: 'absent', rowsRead: 0, skippedMalformed: 0, keysUnreconstructable: 0 }
  }
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  const lastBySource = new Map<string, number>()
  let skippedMalformed = 0
  /**
   * ★★ `keysUnreconstructable`：**键重建不出来的行数**（旧行 —— N1.2 之前没有 `candidate`）。
   *
   *   为什么要一个计数：这些行**不参加去重**（它们确实没有那份原料），
   *   于是"去重在这批行上没生效"。★ 若不报数，它就与"这批行本来就没有重复"同形 ——
   *   而本任务的全部工作就是把这种"同形"拆开。
   *   ★ 注意它**不是** `skippedMalformed`：那些行是好的、可读的、参与 cooldown 的，
   *     只是缺一份当时没落的原料。合成一个数会把"坏数据"与"没写全"读成一件事。
   */
  let keysUnreconstructable = 0
  for (const line of lines) {
    const projection = indexProjectionOf(line, keyOf)
    if (projection === undefined) {
      skippedMalformed += 1
      continue
    }
    /**
     * ★ 键算不出来 ⇒ **这一行不进 `seen`/`counts`**，但它的 `source`/`at` 照旧进 `lastBySource`。
     *   ⇒ 去重说"我没见过它"（真话：没有可比的键），cooldown 仍能用它的时间（也是真话）。
     */
    if (projection.key === undefined) {
      keysUnreconstructable += 1
    } else {
      seen.add(projection.key)
      counts.set(projection.key, (counts.get(projection.key) ?? 0) + 1)
    }
    /**
     * ── ★★ `lastBySource` 取**最大** `at`，不是"最后一行" ──────────────────────
     *
     *   台账是**追加**的，但 `at` 不保证单调（信号可能被补录、夹具会伪造时间）。
     *   ★ 取"最后一行"会让一条补录的老信号把窗口**往回拨** ——
     *     而 cooldown 的全部意义就是"最近一次说话是什么时候"。
     *   ★ 只在这一格上取 max 是**判据那边的要求**（它算 `candidate.at - last`）：
     *     若 `last` 可能比真实最大值小，冷却窗就会被**低估** ⇒ 多采。
     */
    if (projection.source !== undefined && projection.at !== undefined) {
      const previous = lastBySource.get(projection.source)
      if (previous === undefined || projection.at > previous) lastBySource.set(projection.source, projection.at)
    }
  }
  return {
    status: 'derived',
    index: { seen, lastBySource, counts },
    rowsRead: lines.length,
    skippedMalformed,
    keysUnreconstructable,
  }
}
