/**
 * ── `collection.immunity` ——— 是不是**已知的噪声源**（t86）─────────────────────────
 *
 * 依据：`docs/COLLECTION-POINT-AND-EVALUATORS.md` §1.2 行 4
 *   「已知噪声源（如 worktree 路径差异）⇒ ★ 不采」
 *
 * ── ★★ 它与 `dedupe` / `cooldown` 的分工（三条都会说"不采"，理由三者不同形）────────
 *
 * ```
 * dedupe    ⇒ 「**这条内容**已经有过」          （按内容判，随时间累积）
 * cooldown  ⇒ 「**这个来源**刚说过话」          （按来源+时间判，会过期）
 * immunity  ⇒ ★ 「**这一类**是已知噪声」        （按形状判，[永远]不采）
 * ```
 * ★ 三者的**时效性不同**，所以不许合并：前两条是**暂时**的（窗口过了就采），
 *   而 immunity 是**永久**的 —— 一个噪声源**什么时候再出现都还是噪声**。
 *   把 immunity 写成"窗口很长的 cooldown"会让"暂时太勤"与"永远没价值"同形。
 *
 * ── ★★ 而"已知噪声"这份清单**本身就是本层最该被审计的东西**──────────────────────
 *
 * 它是一条**豁免**（"这条我们不采了"）—— 而豁免表是**最容易被滥用**的机制：
 * 只要往清单里加一行，任何信号就能被永久静音。
 * ⇒ 所以：
 *   · 清单**硬编码在这里**（`NOISE_PATTERNS`），**不读盘** —— 判据不做 I/O；
 *   · 而**改它就是改循环 B 的东西**（`docs/COLLECTION-EVALUATOR-SELF-EVOLUTION.md` §3：
 *     「collection 的四条判据本身 ⇒ 只能【提议】，不能自改」）；
 *   · 每条**必须带理由**（`why`）—— 一条说不出理由的豁免应当无法通过评审。
 *
 * ── ★ 第一版的口径：**只列本仓实测过的噪声**，不预言 ────────────────────────────
 *
 * ★ 依据 `docs/COLLECTION-EVALUATOR-SELF-EVOLUTION.md` §7 第 12 条的精神
 *   （"不设精确值 / 阈值永不触发"的教训）：**宁少勿多**。
 *   一条**猜出来的**噪声模式会把**真的缺陷**永久静音，而它看起来与"成功拦截"同形。
 */

import { blocked, ok, unmeasured, type GateVerdict } from '../registry.ts'
import type { CollectionContext } from './shared.ts'

export const id = 'collection.immunity'
export const point = 'collection'
export const description =
  '是不是**已知的噪声源**（如 worktree 路径差异）—— 是 ⇒ 不采（永久豁免）；不是 ⇒ 采'

export const requires = ['candidate'] as const

/**
 * ★ 已知噪声源清单。**每条必须带 `why`** —— 说不出理由的豁免不许存在。
 *
 * ★★ 加一条之前先问 §3 那个问题：**"它漏掉了什么？"**
 *   一份只写过噪声形状的清单，会让**符合那个形状的真缺陷**也一起被静音。
 */
export const NOISE_PATTERNS: readonly {
  readonly id: string
  readonly pattern: RegExp
  readonly why: string
}[] = [
  {
    id: 'worktree-path-difference',
    /**
     * ★ 规格逐字点名的那个例子（§1.2 行 4：「如 worktree 路径差异」）。
     *   匹配形如 `/…/.agent-teams/worktrees/<name>/…` 的路径。
     */
    pattern: /\/\.agent-teams\/worktrees\/[^/\s]+\//,
    why:
      'The same defect reads differently only because it was observed inside a task worktree rather than the '
      + 'captain workspace: the absolute path contains /.agent-teams/worktrees/<name>/. The path differs, the '
      + 'defect does not, so recording it again adds a bucket whose only content is which checkout was used.',
  },
]

export function evaluateCollectionImmunity(context: CollectionContext): GateVerdict {
  const { candidate } = context
  if (candidate === undefined) {
    return unmeasured('collection.immunity: no candidate was supplied')
  }
  /**
   * ★ 判据**只看 `message`**（信号说的那句话），不看 `component`：
   *   噪声源的定义是"**这句话的写法**因环境而异"，而组件名是稳定的 ——
   *   若连组件名一起扫，一个**恰好名字里带 `worktrees`** 的真实组件会被静音。
   */
  for (const entry of NOISE_PATTERNS) {
    if (entry.pattern.test(candidate.message)) {
      return blocked(
        `collection.immunity: this signal matches the known noise source "${entry.id}" — refused permanently. `
        + `Reason: ${entry.why}`,
      )
    }
  }
  return ok()
}

/** 注册表要的入口。 */
/**
 * ── ★ 何时适用：**有候选信号**时才跑 ─────────────────────────────────────────────
 *
 * ★ 与既有 17 条判据同一条纪律（`gate-index-assembly` 臂 2 逐字要求
 *   `hasAppliesTo === true`）：判据必须**按 kind 收窄**，否则它落进
 *   "对全部 kind 生效"那条**静默路径** —— 而那条路径下"不适用"与"跑了且没事"同形。
 *
 * ★ 而**缺输入不算不适用**：`candidate` 缺席 ⇒ 本判据仍进裁决，
 *   由 `gate()` 返回 `unmeasured`（见该函数）。"没测到"与"不适用"必须分开。
 */
export function appliesTo(context: CollectionContext | undefined): boolean {
  return context?.candidate !== undefined
}

export function gate(context: CollectionContext): GateVerdict {
  return evaluateCollectionImmunity(context)
}
