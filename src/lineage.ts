/**
 * ── #176（乙）：沿**活的** fork 链解析 lead 身份（t98）────────────────────────────────
 *
 * ── 它修的是什么（上游 `38a84b9` 逐字）────────────────────────────────────────────
 *
 * > 「**#176: team identity now resolves through the durable fork chain** …
 * >   so a captain that continues in its fork still leads its team」
 *
 * ★ 今天的行为是**精确 id 相等**：`team.captainSessionId === <某个会话 id>`。
 *   而队长**在自己的 fork 里继续**时，那个 fork 是**另一个会话 id**
 *   ⇒ ★★ **它认不出自己带的队**（= 上游那句 "stops matching the team it leads"）。
 *
 * ── ★★★ 而本模块**只做前半**（live 链）—— 这是一条**刻意划下的边界** ────────────────
 *
 * 上游那套是「**live session first, stored header through `sessionPersistence.stat`
 * otherwise**」。★ 实测：`sessionPersistence` 在我们树里 **0 命中**（另一个工程）
 * ⇒ **拿不到**。
 * ★★ 所以本模块**不假装**支持冷父链：
 *   一个不驻留的父会话 ⇒ **`unmeasured`**（**不是** `not-lead`）。
 *
 * ★ 为什么这条边界必须显式：若冷链静默落回"不是队长"，那么
 *   **"我们测不出来"**与**"它确实不是队长"**会**同形** ——
 *   而那正是本仓记账最久的形态。★ 一个"看起来支持 fork、冷链时静默失败"的实现
 *   **比不实现更坏**：它给人虚假的信心。
 *
 * ── ★★ 纯函数：本模块**不碰 `ctx`**、不做 I/O ─────────────────────────────────────
 *
 * 输入是一份**已经取好的**活会话清单（`{ id, parentSession }[]`）。
 * ★ 与 `attributeSubagents(refs, …)` / `strandedWorktrees(candidates, dirtyOf)`
 *   **同一条纪律**：I/O 由调用方做，纯变换留在这里。
 * ★ 而"只读"因此是**签名上的事实**，不是"我记得它只读"。
 */

/**
 * 一份**活的**会话引用 —— 只留本模块真正读的两格。
 *
 * ★ 刻意**不是** `ctx`、也不是 `Agent`：它是一个**值**，
 *   拿不到任何能 spawn/steer 的句柄（同 `LiveSubagent` 的理由）。
 */
export interface LiveSessionRef {
  /** 这个会话自己的 id。 */
  readonly id: string
  /** 它的父会话 id（顶层会话缺席）。 */
  readonly parentSession?: string
}

/**
 * 一个队的身份面 —— 本模块只读**这两格**（`captainSessionId` 与 `memberIds`）。
 *
 * ★ 为什么要 `memberIds`：反向半边 B 的判据（见 `leadIdentityOf` 的注释）。
 */
export interface TeamIdentity {
  /** 这个队的队长会话 id（**就是今天被精确比较的那一格**）。 */
  readonly captainSessionId: string
  /** 这个队的**成员会话 id**（`members[].id`，`removed` 的已由调用方滤掉或含在这里都行）。 */
  readonly memberIds: readonly string[]
}

/**
 * ── ★★★ lead 身份的三态 ──────────────────────────────────────────────────────────
 *
 * ```
 *   lead        ⇒ ★ 这个会话（或它的**某个祖先**）就是这个队的队长
 *   not-lead    ⇒ ★ 它不是队长，**而且这件事是可判定的**（链走到了头）
 *   unmeasured  ⇒ ★★ **判不了**：链上有一环**不驻留** ⇒ 我们说不出它是不是队长
 * ```
 * ★★ `not-lead` 与 `unmeasured` **补救动作相反**：
 *   前者 ⇒ 照常（它不是队长）；后者 ⇒ **要么补上冷链支持，要么报出来**。
 *   把后者写成前者 = **静默地把"测不了"并进"不是"**。
 */
export type LeadIdentityKind = 'lead' | 'not-lead' | 'unmeasured'

/** 判定的结果 —— 连同**它是怎么得出的**（给人读的读数）。 */
export interface LeadIdentity {
  readonly kind: LeadIdentityKind
  /**
   * ★ 命中的那个会话 id（`kind === 'lead'` 时在场）：
   *   · 若它 === `subjectSessionId` ⇒ 会话**自己**就是队长（今天的行为）
   *   · 若它 !== `subjectSessionId` ⇒ ★★ **它是沿 fork 链认到的**（本任务修的那一格）
   */
  readonly viaSessionId?: string
  /** ★ 从 subject 到 lead 之间走了几跳（0 = 自己就是队长）。读的人据此知道"隔了几代"。 */
  readonly hops?: number
  /** `unmeasured` 时**必须**说清是哪一环断的（不许只说"测不了"）。 */
  readonly reason?: string
}

/**
 * ── ★★★ 沿【活的】父链解析 lead 身份（#176 乙）───────────────────────────────────
 *
 * ── 算法（三态各有明确出口）────────────────────────────────────────────────────
 *
 * ```
 *   从 subject 开始，沿 parentSession 向上走：
 *     · 命中 team.captainSessionId ⇒ ★ lead（记下 viaSessionId 与 hops）
 *     · 链走到头（没有 parent）    ⇒ not-lead
 *     · ★ 某一环不驻留（不在 live 清单里）⇒ unmeasured（★ 不许当成 not-lead）
 * ```
 *
 * ── ★★★ 而"谁有资格继承 lead 身份"是本函数最要紧的一条约束 ─────────────────────────
 *
 * 上游逐字警告过：
 * > 「Membership keeps its exact id match: **a member is a subagent child of its
 * >   captain, so its parent chain also contains the captain and must never be read
 * >   as lead identity.** ★ Only a **top-level** conversation may inherit lead
 * >   identity from an ancestor.」
 *
 * ★★ 即：**成员的父链里也有队长** —— 若本函数只看"祖先里有没有队长"，
 *   那么**每一个成员都会被算成它自己队的队长**。⇒ 后果不是"多认了一个",
 *   而是**每个成员都能以队长身份行事**（那一格会变成"谁都是队长"）。
 *
 * ⇒ 所以判据是**三段**，缺一不可：
 *   ① 它**自己不是**这个队的成员（精确相等）；**而且**
 *   ② ★★ 它向上走的**每一环都不许是成员**（见下面「链上不许经过成员」）；**而且**
 *   ③ §它确实走到了队长。
 *
 * ── ★★★ 为什么 ② 也必须有一条（MEASURED：本任务臂 4 当场抓到）───────────────────
 *
 * 我第一版**只有 ① ③**，而臂 4 当场给出 `lead`：
 * ```
 *   MFORK → MEM → CAP        MEM 是成员；MFORK 不在 memberIds 里
 *   ⇒ ① 不成立（MFORK 不是成员）⇒ 继续走 ⇒ 走到 CAP ⇒ ★ 给出 lead（错）
 * ```
 * ★★ 而 `MFORK` 是**一个成员的 fork** —— 即**子代理的子代理**，
 *   **不是**上游说的 `top-level conversation`。⇒ 它**不许**继承 lead 身份。
 *
 * ⇒ ★ 正确判据是「**链上不许经过成员**」：
 *   一旦走到一个成员会话，那条链就已经**离开了顶层**（它进了子代理树）
 *   ⇒ 从那里往上再认到队长，认的是**成员与它的队长**那条边，**不是** fork 关系。
 *
 * ★★ 一句话说明 ② 与 ① 的分工：
 *   · ① 挡的是**成员自己**（链的**起点**就在成员树上）
 *   · ② 挡的是**走到成员再往上**（链的**中间**进了成员树）
 *   ⇒ 少了 ② 就有一条**绕过 ①** 的路。
 */
export function leadIdentityOf(
  subjectSessionId: string,
  team: TeamIdentity,
  liveSessions: readonly LiveSessionRef[],
): LeadIdentity {
  /**
   * ── ① 成员**永远不是** lead（上游那条逐字警告）────────────────────────────────
   * ★ 放在最前面：它的父链里**必然**含队长，所以"先走链"会**必然**把它认成 lead。
   */
  if (team.memberIds.includes(subjectSessionId)) {
    return {
      kind: 'not-lead',
      reason: 'this session is a member of the team; a member is a subagent child of its captain, '
        + 'so its parent chain also contains the captain and must never be read as lead identity',
    }
  }

  /** 索引：id → 它的父会话（★ 只收活会话；不在表里的即"不驻留"）。 */
  const parentOf = new Map<string, string | undefined>()
  const known = new Set<string>()
  for (const ref of liveSessions) {
    known.add(ref.id)
    parentOf.set(ref.id, ref.parentSession)
  }
  /** ★ O(1) 的成员查表（`memberIds` 会被走链时反复问）。 */
  const isMember = new Set(team.memberIds)

  let current: string | undefined = subjectSessionId
  let hops = 0
  /**
   * ★ 环保护：一张会话图理论上可以有环（数据被手改过），而**无上限的 while**
   *   在环上会**永不返回**。★ 上限取 `liveSessions.length + 1`：
   *   合法链最长就是"把每个活会话各走一次"。
   */
  const limit = liveSessions.length + 1
  for (let step = 0; step < limit; step += 1) {
    /** ③ ★ **命中队长** ⇒ lead（`hops === 0` 就是"自己就是队长"，既有行为）。 */
    if (current === team.captainSessionId) {
      return {
        kind: 'lead',
        viaSessionId: current,
        hops,
        reason: hops === 0
          ? 'this session is the captain session of the team'
          : `this session continues a fork of the captain session (${hops} hop(s) up the live parent chain)`,
      }
    }
    /**
     * ★★ ④ **这一环不驻留** ⇒ `unmeasured`（**不是** `not-lead`）。
     *   ★ 判据是"它不在活清单里" —— 而**不是**"它的父为空"：
     *     顶层会话（在清单里、`parentSession` 为空）是**可判定**的链头 ⇒ `not-lead`。
     */
    if (!known.has(current)) {
      return {
        kind: 'unmeasured',
        reason: `the parent chain cannot be followed past "${current}": it is not resident, so whether it `
          + 'continues a fork of the captain cannot be measured. Cold parent chains would need '
          + '`sessionPersistence`, which this plugin does not have.',
      }
    }
    const parent: string | undefined = parentOf.get(current)
    /** ⑤ **链走到头** ⇒ `not-lead`（这是可判定的：确实没有更上面的了）。 */
    if (parent === undefined || parent === '') {
      return {
        kind: 'not-lead',
        reason: `the live parent chain from "${subjectSessionId}" ends at the top-level session "${current}" `
          + `without reaching the captain session "${team.captainSessionId}"`,
      }
    }
    /**
     * ── ② ★★★ **链上不许经过成员**（否则它就是"子代理的后代"，不是顶层会话）──────────
     * ★ 这一支**必须**在"走到 parent"**之前**判：走到成员之后再往上就晚了（已经进了成员树）。
     */
    if (isMember.has(parent)) {
      return {
        kind: 'not-lead',
        reason: `the parent chain from "${subjectSessionId}" passes through the member session "${parent}" `
          + `on its way to "${team.captainSessionId}". Only a top-level conversation may inherit lead `
          + 'identity from an ancestor; a descendant of a member is a subagent of a subagent, and the edge '
          + 'from there to the captain is membership, not a fork.',
      }
    }
    current = parent
    hops += 1
  }
  /** ★ 走满上限仍没结论 ⇒ `unmeasured`（**不猜**）：那是**环**，不是"不是队长"。 */
  return {
    kind: 'unmeasured',
    reason: `the parent chain from "${subjectSessionId}" did not terminate within ${limit} step(s); `
      + 'it may contain a cycle, so lead identity cannot be measured',
  }
}

/**
 * ── ★ `leadIdentityOf` 的**布尔收口** —— 给那 9 处精确匹配用 ───────────────────────
 *
 * ★ 为什么单独一个函数而不是让调用方各自 `=== 'lead'`：
 *   ★★ **`unmeasured` 必须有明确的后果**，而那后果是**调用点各自决定**的
 *   （见下面 `FallbackIsLead` 的注释）。
 *   ⇒ 本函数只回答**"能确定它是队长吗"**，把"不确定怎么办"留给调用点 ——
 *     因为那 9 处的答案**不一样**（有的保守放行、有的保守拒绝）。
 */
export function isLeadSession(
  subjectSessionId: string,
  team: TeamIdentity,
  liveSessions: readonly LiveSessionRef[],
): boolean {
  return leadIdentityOf(subjectSessionId, team, liveSessions).kind === 'lead'
}

/**
 * ── ★★ `unmeasured` 时的**退让策略**（调用点必须显式选一个）────────────────────────
 *
 * ★ 这不是"默认值"，是**每个调用点要写清的一个决定**：
 * ```
 *   'exact'  ⇒ ★ 回退到今天的行为（只认精确相等）
 *   'false'  ⇒ 不放行（保守拒绝）
 * ```
 * ★★ 而**两者都必须在场**，因为 9 处的语义不同：
 *   · **身份识别**（"这个会话是不是队长"）⇒ 回退 `'exact'`：
 *     冷链时**保持今天的结论**，即"不认它是队长" —— 那与"静默改成不是"**不同形**，
 *     因为它是**明确的回退**，且**根因（无 sessionPersistence）写在模块头**。
 *   · **准入检查**（"放行这个成员的动作吗"）⇒ 也回退 `'exact'`：
 *     保守方向与今天**一致**（今天就是精确匹配）。
 * ⇒ ★ 所以**统一取 `'exact'`**，而**理由是**："吸收上游"**不许**顺手改变
 *   任何一处今天的放行/拒绝结论 —— 它只**增加**一条"fork 认得到"的路。
 *   ★ 而 `unmeasured` **仍然可读**（`leadIdentityOf` 的返回值里有 `reason`），
 *     所以"冷链"这件事**没有消失**，只是**不改变裁决**。
 */
export type UnmeasuredPolicy = 'exact' | 'false'

/** ★ 收口用的最终判据：**三态 + 显式退让策略** ⇒ 一个布尔。 */
export function sessionLeadsTeam(
  subjectSessionId: string,
  team: TeamIdentity,
  liveSessions: readonly LiveSessionRef[],
  onUnmeasured: UnmeasuredPolicy = 'exact',
): boolean {
  const identity = leadIdentityOf(subjectSessionId, team, liveSessions)
  if (identity.kind === 'lead') return true
  if (identity.kind === 'not-lead') return false
  /** ★ `unmeasured` ⇒ 按调用点选的策略退让（**不是**静默当成 false）。 */
  return onUnmeasured === 'exact' ? subjectSessionId === team.captainSessionId : false
}
