/**
 * ── ★★★ t20：非 implementation/repair 的任务重派后**永久不可达终态** ──────────────
 *
 * 本文件钉的是**「没有基准」的成因分类**。而它防的是一条**按设计成立的恒不可达**
 * （`decompose-author` 找到，captain 逐字复核）：
 *
 * ```
 * ① src/scheduler.ts 的 `needsWorktree`
 *      kind === 'implementation' || kind === 'repair'
 *    ⇒ 五种 kind（verification/review/integration/work/requirements）
 *      【永远不会】被建 worktree ⇒ 基准【从来没有】存在过
 *
 * ② src/tools/shared/entities.ts 的 resolveBaseRevision（修前）
 *      attempt > 0 ? 'not-recorded' : 'no-worktree'
 *    ⇒ 一旦被重派（attempt > 0）⇒ 判 'not-recorded'（"本该有却丢了"）
 *
 * ③ ⇒ completion.backtest 判 blocked ⇒ update_task 恒被拒
 *    ⇒ ★ 任何非 implementation/repair 的任务，只要被重派过一次，
 *      就【再也无法提交终态】—— 而它被拒的理由描述的原因【从来没有发生过】。
 * ```
 *
 * ── ★ 本条的形态：三态纪律的【镜像】────────────────────────────────────────────
 *
 *     三态纪律说：「**没能测量**不得读成**测得了零**」
 *     本条曾经是：「**按设计不存在**被读成**本该存在却丢了**」
 *     ⇒ 两个方向的合流**同源**：把两种不同的"没有"合成一个 `undefined`。
 *
 * ── ★★ 修法的形状：判据改成【kind】，而真值只有一份 ──────────────────────────────
 *
 * 判"该不该有父版本"的依据**不是** `attempt`（那与基准无关），
 * 而是**这个 kind 会不会被派发到隔离 worktree** —— 而那是**调度器的知识**。
 * ⇒ 它落在 `types.ts` 的 `KINDS_NEEDING_WORKTREE` / `needsWorktreeFor`，
 *   因为它**不 import 任何东西**（叶子模块），而 `scheduler.ts` 与
 *   `entities.ts` **都已经** import 它 ⇒ 两边共用不会造出新的 import 环。
 *
 * ── ★★ `scheduler.ts` 不在本任务写域 ⇒ 用一条【可检出的读数】钉住「两处是否一致」──
 *
 * 本任务是**不许两处各写一份**的（那是本队记账最久的形态）。而 `src/scheduler.ts`
 * 明写在 outOfScope 里 ⇒ 我**不能**把那一行改成从真值取。
 * ⇒ 臂 5 读**源码文本**里那一行，把它含的 kind 集合与真值集合比对：
 *   **一致 ⇒ 绿；分叉 ⇒ 红，且失败信息指名移交项**（改法一句话）。
 *   ★ 一旦那一行改成 `needsWorktreeFor(ticket.kind)`，它含的 kind 字面量变成 0 个
 *     ⇒ 臂 5 **自动转绿，不需要改本文件一个字**。
 *
 * ── ★ 定向突变（打红本文件的五条路）───────────────────────────────────────────
 *
 *   a) 把兜底改回 `attempt > 0 ? 'not-recorded' : …` ⇒ 臂 1 红
 *   b) 让 `implementation`/`repair` 也判 `no-worktree`（真的丢了也放过）⇒ 臂 2 红
 *   c) 让两种 `absent` 同形 ⇒ 臂 3 红
 *   d) 让 `needsWorktreeFor` 与 `KINDS_NEEDING_WORKTREE` 分叉 ⇒ 臂 4 红
 *   e) 让 `scheduler.ts` 的 kind 集合与真值分叉 ⇒ 臂 5 红（可检出）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveBaseRevision } from '../lib/tools/shared/entities.js'
import { KINDS_NEEDING_WORKTREE, TASK_KINDS, needsWorktreeFor } from '../lib/types.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/** 契约点名的五种「按设计不建 worktree」的 kind。 */
const KINDS_WITHOUT_WORKTREE = ['verification', 'review', 'integration', 'work', 'requirements']
/** 两种「会建 worktree」的 kind（真的丢了要拒绝）。 */
const KINDS_WITH_WORKTREE = ['implementation', 'repair']

/**
 * 一个**从未派发过**、`baseRevision` 也没落盘的任务。
 *
 * ★ `id` 必须每次不同：`worktreeBaseOf` 读的是**进程级 Map**，
 *   而同一个 id 会被前一条用例写进去 ⇒ 后一条读到的是 `resolved` 而不是 `absent`
 *   （那会让本文件的臂**恒真地通过**，因为 `resolved` 不带 `reason`）。
 */
let seq = 0
function freshTask(kind, attempt) {
  seq += 1
  return { id: `t20-${kind}-${attempt}-${seq}-${Math.random().toString(36).slice(2)}`, kind, attempt }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★★★ 五种 kind **不再**被判 `not-recorded`（不管 attempt 是几）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★★ 五种非 implementation/repair 的 kind ⇒ 永远 `no-worktree`（与 attempt 无关）', () => {
  /**
   * ── 本臂钉的就是那条恒不可达 ─────────────────────────────────────────────────
   *
   * ★ 关键是**跨 attempt 的稳定性**：`attempt` 与"这类任务该不该有父版本"
   *   是两件不相干的事，而旧写法把它们绑在一起 ⇒ **重派**（一个与基准无关的动作）
   *   会翻转诊断，把一个**按设计正常**的状态变成一次拒绝。
   *
   * ★ 定向突变 a（改回 `attempt > 0 ? 'not-recorded' : …`）⇒ 本臂红。
   */
  for (const kind of KINDS_WITHOUT_WORKTREE) {
    for (const attempt of [0, 1, 3, 7]) {
      const verdict = resolveBaseRevision(freshTask(kind, attempt))
      assert.equal(verdict.kind, 'absent', `★ ${kind}（attempt=${attempt}）：这一格必须说"没有基准"`)
      assert.equal(
        verdict.reason, 'no-worktree',
        `★★★ ${kind}（attempt=${attempt}）：这类任务**按设计**就没有父版本 —— 必须判 \`no-worktree\`，`
        + '而不是 `not-recorded`（"本该有却丢了"）。'
        + '★ 后者会让它被 completion.backtest 判 blocked ⇒ **重派一次就再也交不上终态**，'
        + '而拒绝的理由描述的原因从来没有发生过。定向突变 a ⇒ 本臂红',
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 对照臂 —— implementation/repair 真的丢了**仍须拒绝**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★★ 对照臂：`implementation`/`repair` 没有基准 ⇒ **仍然** `not-recorded`', () => {
  /**
   * ── 缺了本臂就无法区分「修好了」与「把拒绝也说成环境」───────────────────────
   *
   * 臂 1 要求五种 kind 判 `no-worktree`。一个**把所有 kind 都判 `no-worktree`**
   * 的实现同样能过臂 1 —— 而它比原缺陷更坏：**真的丢了父版本时不再有人被叫去看**。
   *
   * ⇒ 本臂是那条分界线。★ 定向突变 b（一律放过）⇒ 本臂红。
   */
  for (const kind of KINDS_WITH_WORKTREE) {
    for (const attempt of [0, 2, 5]) {
      const verdict = resolveBaseRevision(freshTask(kind, attempt))
      assert.equal(verdict.kind, 'absent', `★ ${kind}（attempt=${attempt}）：这一格必须是"没有基准"`)
      assert.equal(
        verdict.reason, 'not-recorded',
        `★★ ${kind}（attempt=${attempt}）：这类任务**本该有**父版本 ⇒ 没有就是"丢了"，必须让人看一眼。`
        + '定向突变 b（把这一类也放过）⇒ 本臂红',
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ 三态不同形 —— 三种成因各自的裁决不同
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 三态不同形：按设计没有 / 本该有却丢了 / 有（resolved）—— 三者可分辨', async () => {
  /**
   * ── 为什么必须"逐对断言"而不是"三者互不相等"─────────────────────────────────
   *
   * 三个值互不相等**不能**证明它们不同形：一个把三者都拼上随机数的实现照样互不相等。
   * ⇒ 每条都断言**它自己那一格在场、另外两格不在场**。这才是"不同形"的机械形式。
   *
   * ★ 定向突变 c（把两种 `absent` 合成一种）⇒ 本臂红。
   */
  const byDesign = resolveBaseRevision(freshTask('verification', 4))
  const lost = resolveBaseRevision(freshTask('implementation', 4))
  /** ★ "有"那一格：往**内存表**里写一格再读（那是 `resolveBaseRevision` 的第一段）。 */
  const { taskWorktreeBase } = await import('../lib/tools/shared/entities.js')
  const resolvedTask = freshTask('implementation', 1)
  taskWorktreeBase.set(resolvedTask.id, 'deadbeefcafe')
  const resolved = resolveBaseRevision(resolvedTask)

  assert.equal(byDesign.reason, 'no-worktree', '① 按设计没有 ⇒ 成因是【环境】')
  assert.equal(lost.reason, 'not-recorded', '② 本该有却丢了 ⇒ 成因是【丢失】')
  assert.equal(resolved.kind, 'resolved', '③ 有 ⇒ resolved')
  assert.equal(resolved.reason, undefined, '③ 它**不带** `reason` —— 带上会让"有"与"没有"在形状上合流')
  assert.equal(resolved.revision, 'deadbeefcafe', '③ 交出的必须是那个版本')

  const shapeOf = (verdict) => ({ kind: verdict.kind, reason: verdict.reason ?? null })
  assert.notDeepEqual(shapeOf(byDesign), shapeOf(lost), '①与②必须不同形（一个是环境，一个是丢失）')
  assert.notDeepEqual(shapeOf(byDesign), shapeOf(resolved), '①与③必须不同形')
  assert.notDeepEqual(shapeOf(lost), shapeOf(resolved), '②与③必须不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★ 真值只有一份 —— `needsWorktreeFor` 与清单不许分叉
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 ★★ 真值只有一份：`needsWorktreeFor(kind) === KINDS_NEEDING_WORKTREE.includes(kind)` 对全部 kind 成立', () => {
  /**
   * ★ 修法把"该不该有 worktree"的真值放进 `types.ts` 的 `KINDS_NEEDING_WORKTREE`，
   *   由 `needsWorktreeFor` 读出。**若有人日后改了清单而忘了函数（或反过来）**，
   *   那条判据就会与清单分叉 —— 而分叉之后 `判据说它该有、而调度器从没建过` 在日志里同形。
   *
   * ★ 定向突变 d（让两者分叉）⇒ 本臂红。
   * ★ 反向半边：`TASK_KINDS` 必须非空，否则"对全部 kind 成立"在空集上恒真。
   */
  assert.ok(TASK_KINDS.length > 0, '★ `TASK_KINDS` 为空时下面的遍历恒真 —— 至少要有 kind')
  assert.ok(
    TASK_KINDS.includes('implementation') && TASK_KINDS.includes('repair'),
    '★ 前置：两种会建 worktree 的 kind 必须在 `TASK_KINDS` 里（否则本臂测的是一个不在册的集合）',
  )

  for (const kind of TASK_KINDS) {
    assert.equal(
      needsWorktreeFor(kind),
      KINDS_NEEDING_WORKTREE.includes(kind),
      `★ kind "${kind}"：\`needsWorktreeFor\` 与 \`KINDS_NEEDING_WORKTREE\` 分叉了 —— `
      + '那正是本条缺陷的形状：两份实现慢慢分开，而"说它该有、却从没建过"在日志里同形',
    )
  }

  assert.deepEqual(
    [...KINDS_NEEDING_WORKTREE].sort(), [...KINDS_WITH_WORKTREE].sort(),
    '★ 真值清单必须恰好是 implementation/repair —— 多一个会让"按设计没有"的 kind 被误判成"丢了"',
  )

  /** ★ 未定义/未知 kind ⇒ 不建树（不是"该有"）—— 一个猜不出 kind 的任务不该被拒。 */
  assert.equal(needsWorktreeFor(undefined), false, '★ `kind` 读不到 ⇒ 不建树（那与"该有而丢了"不同形）')
  assert.equal(needsWorktreeFor('nonexistent-kind'), false, '★ 未知 kind ⇒ 不建树')
  assert.equal(
    resolveBaseRevision({ id: `t20-nokind-${Math.random()}`, attempt: 9 }).reason, 'no-worktree',
    '★ `kind` 整个缺席（且被重派过）⇒ 仍必须判 `no-worktree` —— 旧写法在这里判 `not-recorded`，而它会拒掉任务',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★★ 与调度器的口径一致性 —— 做成【可检出的读数】
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 5：调度器建树的 kind 集合必须与真值一致（分叉即可检出）', () => {
  /**
   * ── 本臂的处境：它是验收第 4 条，而 `scheduler.ts` **不在本任务写域** ────────────
   *
   * 验收原话：「判据说的『本该有』必须与调度器实际建树的 kind 集合**同一份真值**」。
   *
   * ★ 而本任务的 inScope 不含 `src/scheduler.ts` ⇒ 我**不能**把那一行改成从真值取。
   *
   * ⇒ 我能做到、且**应当**做到的是：把"两处是否一致"变成一条**可机械判定的读数**，
   *   而不是留一个沉默的分叉。⇒ 本臂读**源码文本**里那一行，把它含的 kind 集合
   *   与真值集合比对。
   *
   * ★★ 失败信息**必须指名移交项**：本臂红时要让人一眼看出
   *    "真值已经建好了，只差把那一行改成从它取" —— 而不是让人以为本任务没做完。
   *
   * ★ 定向突变 e（让调度器的集合与真值分叉）⇒ 本臂红。
   */
  const source = read('src/scheduler.ts')
  const line = source.split('\n').find((text) => /const needsWorktree =/.test(text))
  assert.notEqual(
    line, undefined,
    '★ 找不到 `const needsWorktree =` —— 调度器那一行的形状变了，本臂必须跟着看清它，'
    + '而不是静默变成一条恒真的断言',
  )

  /**
   * ★ 口径：从那一行里抽出**被比较的 kind 字面量**。
   *   ★ 这是"读源码文本"的一个刻意选择：若那一行改成 `needsWorktreeFor(ticket.kind)`
   *     （即**从真值取**），它含的 kind 字面量会变成 **0 个** ⇒ 本臂自动转绿。
   */
  const literals = [...line.matchAll(/'([a-z-]+)'/g)].map((match) => match[1])
  const fromScheduler = [...new Set(literals)].sort()

  if (fromScheduler.length === 0) {
    /** ★ 最好的一格：调度器已经**从真值取**了 ⇒ 两处同源，无需比对。 */
    assert.match(
      line, /needsWorktreeFor|KINDS_NEEDING_WORKTREE/,
      '★ 这一行既没有 kind 字面量、也没有引用真值 —— 那它是在别处决定"建不建树"，本臂读不到它',
    )
    return
  }

  assert.deepEqual(
    fromScheduler, [...KINDS_NEEDING_WORKTREE].sort(),
    '★★★ 调度器建树的 kind 集合与真值**分叉了** —— 而分叉之后'
    + '"判据说它该有、而调度器从没建过"在日志里同形（那正是本条缺陷的形状）。\n'
    + `    调度器实际建的（读 \`src/scheduler.ts\` 的 \`needsWorktree\` 行）：${JSON.stringify(fromScheduler)}\n`
    + `    真值（\`src/types.ts\` 的 KINDS_NEEDING_WORKTREE）：${JSON.stringify([...KINDS_NEEDING_WORKTREE].sort())}\n`
    + '★ ★★ 交接项：本任务的写域**不含** `src/scheduler.ts`（契约明写 outOfScope）。'
    + '真值已建好并落在 `types.ts`（叶子模块，两边都已 import ⇒ 无新环）。'
    + '修法是把那一行改成 `const needsWorktree = needsWorktreeFor(ticket.kind)` —— '
    + '**这一改需要在另一条任务里做**，而不是放宽本臂。',
  )
})
