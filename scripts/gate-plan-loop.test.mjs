/**
 * ── `describePlanLoop` 的臂（t8 的实现，t15 复核后补）────────────────────────────
 *
 * ── 为什么这个文件存在 ──────────────────────────────────────────────────────────
 *
 * MEASURED（t15 独立复核，`git grep` 查了 **734 个 ref**）：
 * `describePlanLoop` / `plan_loop` / `planLoop` 在 `scripts/` 下**零命中**。
 * t8 交付时用的是**没进仓库的临时探针**（`/tmp/*.mjs`）——
 * 那证明过"我跑过"，但**没有**证明"以后改坏了会有人说话"。
 *
 * ⇒ 一个实现正确、却没有任何臂守着的判据，与一个正确但会被静默改坏的判据，
 *   在**今天**同形，在**下一次改它时**分形。
 *
 * ── 臂 5 是这一组里最要紧的一条 ────────────────────────────────────────────────
 *
 * t15 的定向突变 B「把 `approved` 提到 `halted` 之前」得到**零条红** ——
 * 那是 N5.8 逐字记过的错序（一个被 halt 的团队会被读成 `approved`）。
 * 臂 5 就是那个错序的机械形式。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { describePlanLoop, PLAN_REVIEW_MAX_ROUNDS } = await import(join(ROOT, 'lib', 'quality-gates.js'))

/** 最小 team —— `describePlanLoop` 只读那几格，其余留空即可。 */
const team = (patch) => ({
  name: 't', id: 't', captainSessionId: 'c', createdAt: 1, taskSeq: 0,
  members: [], tasks: [], ...patch,
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：五态逐个可判 —— 每个输入只动一格，结论各不相同
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 1：五态各有一个可复跑的最小输入，且结论两两不同', () => {
  const seen = new Map()

  const awaiting = describePlanLoop(team({}))
  assert.equal(awaiting.state, 'awaiting-review', '默认（staged + awaiting_review）⇒ awaiting-review')
  seen.set(awaiting.state, '{}')

  const reviewing = describePlanLoop(team({ planReviewState: 'awaiting_feedback' }))
  assert.equal(reviewing.state, 'reviewing', 'awaiting_feedback ⇒ reviewing')
  seen.set(reviewing.state, '{planReviewState:awaiting_feedback}')

  const approved = describePlanLoop(team({ phase: 'running' }))
  assert.equal(approved.state, 'approved', 'running ⇒ approved')
  seen.set(approved.state, '{phase:running}')

  const escalated = describePlanLoop(team({ planReviewEscalated: true }))
  assert.equal(escalated.state, 'escalated', 'planReviewEscalated ⇒ escalated（本队自己的位）')
  seen.set(escalated.state, '{planReviewEscalated:true}')

  const halted = describePlanLoop(team({ halted: true, phase: 'running' }))
  assert.equal(halted.state, 'halted', 'halted ⇒ halted')
  seen.set(halted.state, '{halted:true,phase:running}')

  assert.equal(seen.size, 5, '★ 五个输入必须给出五个**不同**的 state —— 否则某两态在读数上同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★★ 顺序臂 —— `halted` 必须排在 `approved` 之前（t15 突变 B 钉的那一格）
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 2（顺序臂）：一个被 halt 的 running 团队必须读成 halted，不是 approved', () => {
  /**
   * ★ 这是 N5.8 逐字记过的错序，也是 t15 定向突变 B 的目标：
   *   把 `approved` 提到 `halted` 之前 ⇒ **零条红**（因为当时没有臂）。
   *
   * ★ `haltTeamWork`（`src/tools.ts`）**不要求** `phase === 'running'`，
   *   所以"一个 staged 团队也能被 halt"是真实形态；而 `phase === 'running'` 的
   *   halted 团队同样存在（跑到一半被停）。
   * ⇒ 若 `approved` 排在前面，**这两条都会被读成"已批准"** —— 而那正好相反。
   */
  for (const patch of [
    { halted: true, phase: 'running' },
    { halted: true },                                   // staged 也能被 halt
    { halted: true, planReviewEscalated: true },        // halted 还要压在 escalated 之上
    { halted: true, planReviewRounds: 99 },             // ……以及压在"轮次超限"之上
  ]) {
    assert.equal(
      describePlanLoop(team(patch)).state, 'halted',
      `★ ${JSON.stringify(patch)} 必须读成 halted —— 顺序错了它就是 approved/escalated`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★ 轮次上限 —— 读到的不只是一个数，还要说清它是从哪来的
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 3：`rounds >= maxRounds` 判 escalated；且 `roundsSource` 把「缺席读成 0」与「确实是 0」分开', () => {
  assert.ok(PLAN_REVIEW_MAX_ROUNDS >= 2, '★ 前提：上限至少是 2，否则"刚好到顶"和"没开始"分不开')

  const atCap = describePlanLoop(team({ planReviewRounds: PLAN_REVIEW_MAX_ROUNDS }))
  assert.equal(atCap.state, 'escalated', `★ rounds == max(${PLAN_REVIEW_MAX_ROUNDS}) ⇒ escalated`)
  assert.equal(atCap.rounds, PLAN_REVIEW_MAX_ROUNDS)
  assert.equal(atCap.roundsSource, 'persisted', '★ 盘上有这一格 ⇒ persisted')
  assert.equal(atCap.maxRounds, PLAN_REVIEW_MAX_ROUNDS)

  const below = describePlanLoop(team({ planReviewRounds: PLAN_REVIEW_MAX_ROUNDS - 1 }))
  assert.notEqual(below.state, 'escalated', '★ 差一轮不能算到顶')

  /**
   * ★★ 这一格是"存量团队看起来像审了 0 轮就通过"的那个洞：
   *   `rounds: 0` 与 `rounds 缺席` 在数字上同形，而 `roundsSource` 让它们不同形。
   */
  const absent = describePlanLoop(team({}))
  assert.equal(absent.rounds, 0, '缺席按 0 读（口径）')
  assert.equal(absent.roundsSource, 'absent', '★★ 但必须说清"我是把它读成 0"，不是"它确实是 0"')

  const zero = describePlanLoop(team({ planReviewRounds: 0 }))
  assert.equal(zero.rounds, 0)
  assert.equal(zero.roundsSource, 'persisted', '★ 真写了 0 ⇒ persisted（与 absent 不同形）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★ `canEnd` 只在 approved 时为真 —— 且 reason 必须非空
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 4：`canEnd` 只有 approved 为真；每一态都给得出非空 reason', () => {
  const cases = {
    'awaiting-review': {},
    reviewing: { planReviewState: 'awaiting_feedback' },
    approved: { phase: 'running' },
    escalated: { planReviewEscalated: true },
    halted: { halted: true },
  }
  for (const [expected, patch] of Object.entries(cases)) {
    const snapshot = describePlanLoop(team(patch))
    assert.equal(snapshot.state, expected)
    assert.equal(
      snapshot.canEnd, expected === 'approved',
      `★ canEnd 只在 approved 时为真 —— ${expected} 读成了 ${snapshot.canEnd}`,
    )
    assert.ok(
      typeof snapshot.reason === 'string' && snapshot.reason.trim() !== '',
      `★ ${expected} 必须给出一条非空的 reason —— 「为什么还不能结束」是这一层真正的产出`,
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★ 表面三态 —— 「读不出来」不许并进「都合格」
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 5：契约表面是**三态**，且 `unmeasurable > 0` 必须出现在 reason 里（不许静默并进通过）', () => {
  /**
   * ★ t8 的契约第 6 条逐字：「任何一格 unmeasured 不拦但必须点名」。
   *   一条既没有 `inScope` 也没有 `objective` 的任务 ⇒ 它的表面**读不出来**。
   */
  const noSurface = team({
    tasks: [
      /**
       * ★ 必须是一条**写类**任务（`implementation`）才会有"表面读不出来"这一态：
       *   `work` 类按 kind-requirements 表**本来就不要求** inScope ⇒ 它落
       *   `notApplicable`（"这一问不适用"是看了之后的结论），而不是 `unmeasurable`。
       *   ⇒ 这两种必须分开测，否则"不要求"会被读成"读不出来"。
       */
      {
        id: 't1', subject: 'x', status: 'pending', dependencies: [], createdAt: 1, updatedAt: 1,
        kind: 'implementation', objective: '做点什么', acceptance: ['★ 可判'],
        // ★ 故意**没有** inScope 与 verify —— 写类任务缺这两格就是"表面读不出来"
      },
    ],
  })
  const snapshot = describePlanLoop(noSurface)
  assert.ok(snapshot.surfaces !== undefined, '★ surfaces 必须交出来（否则调用方分不清"没有"与"没算"）')
  /**
   * ★ 字段名是 `unreadable`（不是 `unmeasurable`）—— 而这一格的名字本身也在说事：
   *   "读不出来"（readable 的反面）与"没能测量"在本仓是两件事，
   *   这里用的是前者：任务在盘上，只是它的表面读不出来。
   */
  assert.ok(
    snapshot.surfaces.unreadable > 0,
    `★ 一条没有 inScope 的写类任务 ⇒ unreadable 必须 > 0，实测 ${JSON.stringify(snapshot.surfaces)}`,
  )
  assert.match(
    snapshot.reason, /读不出来|unmeasurable|没能|判不了/iu,
    '★★ ★ 而它必须**点名**出现在 reason 里 —— 否则"放行"与"通过"在读数上同形',
  )

  /** ★ 反向半边：一份**表面清楚**的计划，unmeasurable 必须是 0（否则这条臂恒真）。 */
  const withSurface = team({
    tasks: [
      {
        id: 't1', subject: 'x', status: 'pending', dependencies: [], createdAt: 1, updatedAt: 1,
        kind: 'work', objective: '做点什么', acceptance: ['★ 可判'], inScope: ['src/x.ts'], verify: ['true'],
      },
    ],
  })
  assert.equal(
    describePlanLoop(withSurface).surfaces.unreadable, 0,
    '★ 反向半边：契约齐备时 unreadable 必须为 0 —— 否则上一条断言恒真',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★★★ 2026-10-20）：「显式归零」必须**真的存在**，而且必须落得下盘
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 6：触顶但**未被 halt** 的队必须能解除 —— 且归零要能被调用方写回', async () => {
  /**
   * ── 这一臂钉的是一次**真实死锁**（本仓 2026-10-20，写它前一小时撞上的）────────
   *
   * MEASURED：
   * ```
   *   phase='staged' · planReviewRounds=5 · planReviewEscalated=true · halted=undefined
   *   approve      ⇒ 拒（对，轮次超了）
   *   而错误信息指向 resume 说"这是唯一出路"
   *   resume       ⇒ already_running，一格都不动        ← 那份计划没有任何工具能放行
   * ```
   *
   * ★ 而 `resumeTeamState` 的长注释**自己早就点名过这个缺口**，并写"记录为已知缺口，
   *   不在这里假装解决"。这一臂就是把它解决掉的那一半。
   *
   * ── 三态（每一种都必须与另外两种不同形）────────────────────────────────────
   *
   *   ① 触顶（halted 或 不 halted）  ⇒ `resumed` + `clearedPlanReview: true` + rounds 归零
   *   ② 正常未触顶、未 halt          ⇒ `already_running`，**不动**任何格
   *   ③ halted 但未触顶              ⇒ `resumed`，**不收**计划环那两格（普通恢复）
   */
  const { resumeTeamState } = await import(join(ROOT, 'lib', 'quality-gates.js'))
  const base = {
    id: 't', name: 'T', captainSessionId: 'c', createdAt: 1, taskSeq: 0,
    members: [], tasks: [], phase: 'staged',
  }

  /** ① 本案：**没有 halted**，但已经触顶 ⇒ 必须能解除。 */
  const escalatedOnly = resumeTeamState({ ...base, planReviewRounds: PLAN_REVIEW_MAX_ROUNDS, planReviewEscalated: true }, 'a human named it')
  assert.equal(
    escalatedOnly.status, 'resumed',
    '★★★ 触顶但未 halt 的队必须能解除 —— 否则 "approve 拒 + edit_plan 推高 + resume 不动" 是一个没有出口的三面墙',
  )
  assert.equal(escalatedOnly.clearedPlanReview, true, '★ 必须**说出来**"这次归零了"，调用方才能写回盘')
  assert.equal(escalatedOnly.team?.planReviewRounds, 0, '★ rounds 必须归零')
  assert.equal(escalatedOnly.team?.planReviewEscalated, false, '★ flag 必须同时清（只清 flag 不算解除）')

  /** ② 正常队：一个字节都不该动。 */
  const normal = resumeTeamState({ ...base, planReviewRounds: 1 }, 'x')
  assert.equal(normal.status, 'already_running', '★ 未触顶也未 halt ⇒ already_running（不是"顺手也归零了"）')
  assert.equal(normal.clearedPlanReview, undefined, '★★ 而它**不得**带 clearedPlanReview —— 否则调用方会把一次无关动作当成解除')
  assert.equal(normal.team?.planReviewRounds, 1, '★★ 一次与计划无关的 resume 不许抹掉"改过几轮"')

  /** ③ halted 但未触顶：恢复，但不收计划环。 */
  const haltedOnly = resumeTeamState({ ...base, halted: true, planReviewRounds: 1 }, 'x')
  assert.equal(haltedOnly.status, 'resumed', '★ 普通 halt/resume 仍然可用')
  assert.equal(haltedOnly.clearedPlanReview, undefined, '★★ 普通恢复**不**归零计划环（两种解除不同形）')
  assert.equal(haltedOnly.team?.planReviewRounds, 1, '★ rounds 原样保留')

  /** ④ 非空理由是硬要求 —— 解除一个触顶计划是一次**决定**，不是清理。 */
  const noReason = resumeTeamState({ ...base, planReviewRounds: PLAN_REVIEW_MAX_ROUNDS }, '   ')
  assert.equal(noReason.status, 'rejected', '★ 空理由必须拒 —— 否则"谁在什么时候放过了它"不可查')
})

test('★★★ 臂 6b：归零必须**落得下盘** —— 两个调用点都得写回，否则"唯一出路"只活在返回值里', async () => {
  /**
   * ★ 这一臂读的是**源码面**，因为它钉的是一个**调用点契约**：
   *   `resumeTeamState` 在返回值里归零，而调用方若只写 `halted`，盘上什么都没变。
   *   MEASURED：修复前 `resume.ts` 与 `create-task.ts` 两处**都是**只写 halted。
   *
   * ★★ 为什么这条不能用行为臂代替：它需要真的起一个团队、跑到 resume 路径上。
   *   而"调用方有没有把那一格写回去"是一个**结构事实** ——
   *   用源码面钉它，比造一整套夹具更直接，也与本仓其它"接线臂"同形
   *   （例如 `gate-critical-symbols.test.mjs` 就明确反对纯文本 grep，
   *    但本条钉的是**调用点是否转述了一个已知字段**，不是"能力在不在"）。
   *
   * ★ 反向半边：把任一处的写回删掉 ⇒ 本条红。
   */
  const { readFileSync } = await import('node:fs')
  for (const rel of ['src/tools/resume.ts', 'src/tools/create-task.ts']) {
    const source = readFileSync(join(ROOT, rel), 'utf8')
    assert.match(
      source, /clearedPlanReview/,
      `★★★ ${rel} 没有转述 clearedPlanReview —— 那么 resumeTeamState 算出来的归零**只活在返回值里**，`
      + '盘上 `planReviewRounds` 仍是原值，而 approve 会继续拒。'
      + '★ 这就是 2026-10-20 那个"唯一出路在生产上不存在"的缺陷。',
    )
    assert.match(
      source, /planReviewRounds\s*=\s*resumed\.team\.planReviewRounds/,
      `★★ ${rel} 收了标记却没把 rounds 写回去 —— 标记与写回必须成对，只收标记等于什么都没做`,
    )
  }
})
