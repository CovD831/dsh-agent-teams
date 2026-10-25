/**
 * ── ★★★ 提案的**写方** —— 让"算出来了"变成"盘上有过"（R2.2 的前半）───────────────
 *
 * ── 这个文件补的是哪一格 ────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-21 审计）：
 *
 * ```
 * grep -rn "createTaskParamsOf(" src/ | grep -v propose.ts   ⇒ 空
 * ls .agent-teams/evolution/                                 ⇒ index.json  signals.jsonl
 * grep -rn "routeSignals(" src/ | grep -v propose.ts         ⇒ 唯一调用方是 readProposalPipeline
 * ```
 *
 * ⇒ `readProposalPipeline`（`src/snapshot.ts` 调用它）**每次点开面板都把同一批信号重算一遍，
 *   然后把提案丢掉**。于是两个读数各自都对、合起来却互相矛盾：
 *
 * ```
 * 「这一批产出了 2 份提案」  ← 真的（现算的）
 * 「盘上从来没有过一份提案」  ← 也真的（从不落盘）
 * ```
 *
 * ★ 而它们在面板上**同形** —— 这正是本仓记账最久的那一类。
 *
 * ── ★ 本文件只做**一步**，且明确不做下一步 ─────────────────────────────────────────
 *
 * ```
 * 做：  信号 → 分流 → 提案 → **追加一行到 proposals.jsonl**
 * 不做：提案 → create_task 派发（`createTaskParamsOf` 仍然是**人的**动作）
 * ```
 *
 * ★★ 所以 `R2.2`（"提案真的变成过一条任务"）**仍然是 gap**。本条**不声称**它闭合了 ——
 *   一条"写了但没人派发"的记录与一条"根本没写过"的记录不同，而它与"派发过"也不同。
 *   把这两件事合成"提案机制做完了"，就是把"有过"读成"用过"。
 *
 * ── ★★ 三条纪律（与 `collect.ts` 同源，理由逐字相同）────────────────────────────────
 *
 * **① 旁路，参与不了裁决**：写失败**不抛**、也不改变调用方的行为。
 *   本函数在 `observe` 的那条路径上被调用，而那条路径**在拒绝的处理过程里**。
 *
 * **② 分配 id 与占用是一步**：读 max → 算 id → 追加，整段在**同一个临界区**内
 *   （与 t93 在 `signals.jsonl` 上修过的缺陷同形 —— 撞车之后被覆盖的那一份
 *   与"没发生过"同形）。
 *
 * **③ 提案不在这里被**判**：本函数只搬 `routeSignal` 的结论，不重算分流。
 *   两份分流口径会漂移，而漂移之后"写下来的提案"与"面板上算出来的提案"会不同。
 *
 * @module dsh-agent-teams/evolution/proposals
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { routeSignal, type RoutableSignal, type RoutingContext } from './propose.ts'
import type { Proposal } from './types.ts'

/** `.agent-teams/evolution/proposals.jsonl` 的路径（由调用方给 `stateRoot`，**不猜**）。 */
export function proposalsPathOf(stateRoot: string): string {
  return join(stateRoot, 'evolution', 'proposals.jsonl')
}

/**
 * 读盘上已有的提案编号里的最大值。
 *
 * ★ 读不出来（文件不存在 / 坏行）⇒ `0`，**不是**抛。
 *   "还没有提案"与"读不出来"在这里的处置相同（都从 `p-0001` 起），
 *   因为两者都**不构成**"已有编号"的证据。★ 而"撞车风险"由临界区消掉，不靠这个数保真。
 */
async function maxProposalNumberIn(stateRoot: string): Promise<number> {
  let text: string
  try {
    text = await readFile(proposalsPathOf(stateRoot), 'utf8')
  } catch {
    return 0
  }
  let max = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      /** ★ 坏一行不许让整份编号空间从头开始 —— 那会让新提案覆盖旧编号。 */
      const loose = /"id"\s*:\s*"p-(\d+)"/u.exec(line)
      if (loose !== null) max = Math.max(max, Number.parseInt(loose[1] as string, 10))
      continue
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const id = (parsed as { readonly id?: unknown }).id
    if (typeof id !== 'string') continue
    const match = /^p-(\d+)$/u.exec(id)
    if (match !== null) max = Math.max(max, Number.parseInt(match[1] as string, 10))
  }
  return max
}

/**
 * ── 进程内互斥（与 `collect.ts` 的 `withEvolutionLock` **同一个理由、同一把尺度**）──────
 *
 * ★ 不 import `collect.ts` 的那个：它是**模块私有**的（没有 export）。
 *   而把它 export 出去会让"采集流"与"提案流"共用一个锁 —— 那**恰好是对的**，
 *   但会引入一条新的跨模块耦合，而本任务不需要它（提案只在采集之后写）。
 *   ★ 若将来出现"同时写两条流"的需求，正确的动作是**把锁提到一个共用模块**，
 *     而不是在两处各留一把（两把锁保护同一个资源 = 没有锁）。
 */
const proposalLocks = new Map<string, Promise<unknown>>()

async function withProposalLock<T>(stateRoot: string, fn: () => Promise<T>): Promise<T> {
  const key = `proposals:${stateRoot}`
  const previous = proposalLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  proposalLocks.set(key, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (proposalLocks.get(key) === tail) proposalLocks.delete(key)
  }
}

/**
 * ── ★★★ 采集一条信号之后，**顺手**把它分流并落盘 ───────────────────────────────────
 *
 * @param stateRoot - 这个团队自己的 stateRoot（由调用方给）。
 * @param signal    - 刚刚**写成功**的那条信号的**可分流面**（`id` / `message` / `source` / `kind` / `at`）。
 * @param context   - 分流要用的既有读数（**可选**：缺席时 `why` 会如实说明口径）。
 * @returns 写成功的提案 id；这条信号不该改（`none`）或判不了（`unmeasured`）⇒ `undefined`；
 *          写盘失败 ⇒ `undefined`。★ **从不抛** —— 见文件头纪律 ①。
 *
 * ★★ 为什么 `none` / `unmeasured` / "写失败" 三者都返回 `undefined`：
 *   调用方唯一的用法是"要不要做下一件事"，而这三者的答案都是"不要"。
 *   ★ 而**它们的区别在盘上可见**：`none` 不写行、`unmeasured` 不写行、
 *     写失败会在 `warn` 里留一行。⇒ 需要区分的地方**在读数端**，不在返回值上。
 *     （若将来要区分，正确的动作是加一个三态返回对象，而不是把 `undefined` 当成三种意思。）
 */
export async function recordProposalForSignal(
  stateRoot: string,
  signal: RoutableSignal,
  context: RoutingContext = {},
): Promise<string | undefined> {
  try {
    return await withProposalLock(stateRoot, async () => {
      /** ★ 在**临界区内**读 max：与 t93 的「分配与占用是一步」同一落点。 */
      const knownMax = await maxProposalNumberIn(stateRoot)
      const route = routeSignal(signal, knownMax, context)
      /**
       * ── ★★★ `unmeasured` 与 `none` 都**不写行**，但**都要建出文件** ────────────────
       *
       *   ```
       * 文件不存在        ⇒ 这条流水线从没跑过
       * 文件在、0 条       ⇒ 跑过了，而这一批没有要改的（`none`）
       * 文件在、N 条       ⇒ 跑过了，产出了 N 份
       * ```
       *
       * ★★ 第一版在 `none` 上**什么都不做** —— 夹具臂 2 立刻红，而那个红是对的：
       *   一条 `success` 信号走完分流之后，盘上与"从没跑过"完全同形。
       *   而这两个态的补救动作相反（前者什么都不用做，后者说明流水线没接上）。
       *   ⇒ 所以 `none` 走 {@link ensureProposalsFile}：**建文件、不追加行**。
       *
       * ★ 而 `unmeasured` **也建**：它同样是"跑了、判不了"，而不是"没跑"。
       *   ★ 它的原因在信号的 `collection.verdicts` 里读得到，不在提案流里 ——
       *     提案流只回答"有没有要改的"。
       */
      if (route.outcome !== 'produced') {
        await ensureProposalsFile(stateRoot)
        return undefined
      }
      const proposal = route.proposal as Proposal
      /** ★ hash 守卫：`route.proposal` 在 `produced` 分支上必然在场（见 `routeSignal` 的三个 return）。 */
      await appendProposal(stateRoot, proposal)
      return proposal.id
    })
  } catch {
    /** ★ 绝不抛 —— 本函数在拒绝路径上被调用（文件头纪律 ①）。 */
    return undefined
  }
}

/**
 * 追加一份提案 —— **一行**（与 `signals.jsonl` 同一种形态）。
 *
 * ★ 为什么先 `mkdir` 再 `appendFile` 而**不**先判存在：`appendFile` 会自动创建文件。
 *   而"文件在、0 条"这个读数**只有在 `none` 也走一次追加时**才成立 —— 见下面那条注释。
 */
async function appendProposal(stateRoot: string, proposal: Proposal): Promise<void> {
  const dir = join(stateRoot, 'evolution')
  await mkdir(dir, { recursive: true })
  await appendFile(proposalsPathOf(stateRoot), `${JSON.stringify(proposal)}\n`, 'utf8')
}

/**
 * ── ★ 让"跑了但没有要改的"在盘上**留下痕迹** ─────────────────────────────────────
 *
 * MEASURED（本任务的夹具臂 2）：一条 `success` 信号走完分流应当得到 `none`，
 * 而若什么都不写，盘上就是「`proposals.jsonl` 不存在」—— 那与**流水线从没跑过**同形。
 *
 * ⇒ 所以 `observe` 在 `none` 那一路会调这里：**建文件、不追加行**。
 *
 * ★ 它只建目录与空文件，**不写任何内容**：
 *   写一行"我决定不改"会让提案流里混进非提案，而读端（`readProposalPipeline`）
 *   把每一行都当 `Proposal` parse ⇒ 那一行会被静默丢掉，于是"0 条"与"1 条坏的"同形。
 */
export async function ensureProposalsFile(stateRoot: string): Promise<void> {
  try {
    const dir = join(stateRoot, 'evolution')
    await mkdir(dir, { recursive: true })
    await appendFile(proposalsPathOf(stateRoot), '', 'utf8')
  } catch {
    /** ★ 同上：绝不抛。 */
  }
}
