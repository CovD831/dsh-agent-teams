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

import { signalsPathOf } from './collect.ts'
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
    totalLines: lines.length,
  }
}
