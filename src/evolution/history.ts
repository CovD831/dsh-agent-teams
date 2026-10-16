/**
 * ── 判据变更历史：`collection` 的 `history`（t86）────────────────────────────────
 *
 * ★ 依据 SkillClaw 的 `history/` + Raven 的"必须先读**全部**历史再决定"，逐字：
 *   > 「Raven Step 3: **Before deciding any action on an existing skill,
 *   >   read ALL files under history/. This is mandatory, not optional.**
 *   >   Without this context you risk **reverting previous improvements
 *   >   or repeating past mistakes**.」
 *
 * ⇒ 「**反复来回改**」是自进化系统里一种很常见的退化，而它防的正是那个。
 *
 * ── ★★★ 本文件是**记录**，不参与计算（这是一条要能被机械验证的性质）──────────────
 *
 * 反向半边 C 逐字要求：「删掉 history 后 **redundancy 结果不变**」。
 * ★ 而那条性质**不是靠"注意别写错"保证的** —— 它是**结构性**的：
 *   · 本文件**不被 `health.ts` import**（两者的依赖是单向的：`history → types`）；
 *   · 本文件**没有任何函数接受 `CollectionHealth` 或记录集**（它算不出 redundancy）；
 *   · 它唯一会做的事是**追加一条记录**与**读回一个列表**。
 *
 * ⇒ ★ 所以"history 参与了计算"这件事**在这份形状下写不出来**，
 *   除非有人**主动把两个模块接起来** —— 而那样 `tsc` 与夹具都会看见。
 *
 * ── ★★ 而"读全部历史再决定"必须有一个**入口**，不能只靠人记得 ─────────────────────
 *
 * `reviewBeforeChange` 就是那个入口：它**要求**调用方先拿到全部历史，
 * 并把"我读过哪些"如实返回。★ 它**不检查你有没有真的读**（那检查不了），
 * 但它让"没读"与"读了"在**调用形状上**不同形（后者必须传一个列表进来）。
 */

import type { CollectionGateChange, EvolutionLoop } from './types.ts'
import { LOOP_B_SUBJECTS, canLoopAAutoChange } from './types.ts'

/**
 * ★ 判据历史：**追加**语义，`readonly` 返回。
 *
 * ★ 为什么是"追加"而不是"可改"：一条历史若可被改写，"上次为什么改"就丢了 ——
 *   而那正是它唯一的价值。⇒ 本模块**不提供** delete / update / clear。
 *   ★ 与 `types.ts` 里"不提供改判据的函数"同一条纪律：**没有那个函数**才不会腐烂。
 */
export class CollectionHistory {
  readonly #changes: CollectionGateChange[] = []

  /** ★ 追加一条（**唯一**的写入口）。 */
  record(change: CollectionGateChange): void {
    /**
     * ★ 四格**都必须有内容**：`changed` 说不出改了什么、或 `evidence` 说不出凭什么 ——
     *   那条记录**没有价值**，而它会让历史看起来"有记录"（本仓记账过的"假账"形态）。
     *   ★ 所以在这里**当场拒**，而不是事后靠人审查。
     */
    if (change.before.trim() === '' || change.after.trim() === '') {
      throw new Error(
        `collection history: a change to "${change.gateId}" must record both before and after `
        + '(a record that cannot say what changed is not a record)',
      )
    }
    if (change.evidence.trim() === '') {
      throw new Error(
        `collection history: a change to "${change.gateId}" must cite evidence `
        + '(a change nobody can justify later is exactly what this history exists to prevent)',
      )
    }
    this.#changes.push({
      gateId: change.gateId,
      at: change.at,
      before: change.before,
      after: change.after,
      evidence: change.evidence,
    })
  }

  /** ★ 全部历史（**按时间升序**）—— Raven 那句"read ALL"要的就是它。 */
  all(): readonly CollectionGateChange[] {
    return [...this.#changes].sort((a, b) => a.at - b.at)
  }

  /** 某一条判据的历史（★ 决定"要不要再改它"时先读这份）。 */
  forGate(gateId: string): readonly CollectionGateChange[] {
    return this.all().filter((change) => change.gateId === gateId)
  }

  /**
   * ★★ `readonly` 的证明面：本类**没有** `delete` / `update` / `clear` / `reset`。
   *   它不是"忘了写"，是**刻意不提供**（见类头那段）。
   *   ⇒ 一条只想追加的东西，接口越窄越不会腐烂。
   */
}

/**
 * ★★ "改之前先读全部历史"—— 本层唯一那个**入口**。
 *
 * @returns 全部历史 + 一句"这次改动属于哪个循环"的判定。
 *
 * ★ 它**不**检查人有没有真的读（检查不了），但它把**调用形状**定死：
 *   想改某条判据的人，**必须先拿到 `history` 才能拿到 `verdict`** ——
 *   而 `verdict` 会告诉他"这件事你能不能自己改"。
 */
export function reviewBeforeChange(
  history: CollectionHistory,
  subject: string,
  gateId?: string,
): {
  readonly loop: EvolutionLoop
  readonly mayAutoChange: boolean
  readonly history: readonly CollectionGateChange[]
  readonly note: string
} {
  const mayAutoChange = canLoopAAutoChange(subject)
  /**
   * ★★ 三条循环 B 的东西**一律不许自改**（规格 §3 逐字）：
   *   「collection 的四条判据本身 · 验证命令 · confidence 阈值 ⇒ ★★ 只能【提议】，不能自改」。
   */
  const loop: EvolutionLoop = mayAutoChange ? 'A' : 'B'
  const relevant = gateId === undefined ? history.all() : history.forGate(gateId)
  const note = mayAutoChange
    ? `"${subject}" is loop A: an automated change may apply it directly, but only within what loop B allows.`
    : `"${subject}" is loop B (one of: ${LOOP_B_SUBJECTS.join(', ')}): an automated change may only PROPOSE it. `
      + 'If a loop could rewrite the criteria that judge its own output, it would first widen them — '
      + 'and after that every duplicate is collected again. That is the recursion this split exists to prevent.'
  return { loop, mayAutoChange, history: relevant, note }
}
