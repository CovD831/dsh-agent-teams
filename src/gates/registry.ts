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

export interface GateRunEntry {
  id: string
  verdict: 'ok' | 'blocked' | 'unmeasured' | 'skipped'
  count?: number
  produced?: boolean
}

export interface GateEvaluation {
  ok: boolean
  blockers: string[]
  unmeasured?: string
  ran: GateRunEntry[]
  outputs: Record<string, Record<string, unknown>>
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
}

export function createGateRegistry() {
  /** @type {Map<string, object>} */
  const byId = new Map()

  return {
    /**
     * 注册一条判据。
     * ★ 重复 id ⇒ 抛错，**不静默覆盖** —— 静默覆盖会让"我换了一条判据"
     *   与"两条判据都在、后一条赢了"在日志里同形。
     */
    register(registration: GateRegistration): GateRegistration {
      const { id, point, description, gate, appliesTo } = registration ?? {}
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
      if (byId.has(id)) {
        throw new Error(`gate "${id}" is already registered; unregister it first (silent replacement would make "swapped" and "both ran" look identical)`)
      }
      byId.set(id, { id, point, description, gate, appliesTo })
      return registration
    },

    unregister(id: string): boolean {
      return byId.delete(id)
    },

    /** 控制台读它。按 point 分组，组内保持注册顺序。 */
    list(): Record<InsertionPoint, Array<{ id: string; description: string; hasAppliesTo: boolean }>> {
      const out = {} as Record<InsertionPoint, Array<{ id: string; description: string; hasAppliesTo: boolean }>>
      for (const point of INSERTION_POINTS) out[point] = []
      for (const reg of byId.values()) {
        out[reg.point]!.push({ id: reg.id, description: reg.description, hasAppliesTo: typeof reg.appliesTo === 'function' })
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
      for (const reg of byId.values()) {
        if (reg.point !== point) continue
        if (typeof reg.appliesTo === 'function' && reg.appliesTo(context) !== true) {
          ran.push({ id: reg.id, verdict: 'skipped' })
          continue
        }
        const produced = assertVerdict(await reg.gate(context), reg.id)
        const verdict = produced as Record<string, unknown>
        if (verdict['ok'] === true) {
          /**
           * 除 `ok` 之外的字段都是产出。★ 只在【真的被采纳】时收集 ——
           * 一条被拒的判据的产出不该被当成结果使用。
           */
          const given = Object.fromEntries(Object.entries(verdict).filter(([key]) => key !== 'ok'))
          if (Object.keys(given).length > 0) outputs.set(reg.id, given)
          ran.push({ id: reg.id, verdict: 'ok', produced: Object.keys(given).length > 0 })
          continue
        }
        if (Array.isArray(verdict['blockers'])) {
          const list = verdict['blockers'] as string[]
          for (const item of list) blockers.push(`[${reg.id}] ${item}`)
          ran.push({ id: reg.id, verdict: 'blocked', count: list.length })
          continue
        }
        unmeasuredReasons.push(`[${reg.id}] ${String(verdict['unmeasured'])}`)
        ran.push({ id: reg.id, verdict: 'unmeasured' })
      }
      const collected: Record<string, Record<string, unknown>> = Object.fromEntries(outputs)
      if (unmeasuredReasons.length > 0) {
        return { ok: false, unmeasured: unmeasuredReasons.join('; '), blockers, ran, outputs: collected }
      }
      if (blockers.length > 0) return { ok: false, blockers, ran, outputs: collected }
      return { ok: true, blockers, ran, outputs: collected }
    },
  }
}
