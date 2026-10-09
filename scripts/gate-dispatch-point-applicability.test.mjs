/**
 * ── ★★★ t43：`changed-paths` 与 `worktree` 的【插入点】—— 实测读数，而不是照搬假设 ──────
 *
 * ── 本任务的前提，与我在这个 worktree 上实测到的东西，**不一致** ──────────────────
 *
 * 任务书写着：「两条判据挂错了点：changed-paths 与 worktree 在**真正的派发点**上永不适用」。
 *
 * ★★★ 而我把那条路**逐点走了一遍**，读数是这样的（下面每条都由臂复现）：
 *
 *   ① ★ `dispatch` 位置在生产里**只有一个求值点**：
 *        `src/tools/update-task/dispatch.ts:117` → `registry.evaluate('dispatch', …)`
 *      而它就在【成员申报改动那一刻】（`update_task`）。它喂的 ctx 逐字含
 *      `update: { changedPaths: input.changedPaths }` —— 而那正是两条判据要的那一格。
 *
 *   ② ★★ 而 `src/scheduler.ts`【从不求值任何判据】（`grep -c "evaluate(" = 0`）——
 *      所以「真正的派发点」（scheduler 派发那一刻）**根本没有 dispatch 位置**。
 *      ⇒ 「在派发点上永不适用」这句话**描述的是一条不存在的路**：
 *        判据没有被挂在那个点上，所以它们不会"在那里 skipped"。
 *
 *   ③ ★★★ 而在**唯一的那个求值点**上，两条判据**已经真的被求值**：
 *        `evaluate('dispatch', { task: implementation, update: { changedPaths: ['src/a.ts'] } })`
 *        ⇒ `evaluated = 2`，而 `ran` 里两条都是 **`ok`**（不是 `skipped`）。
 *      ⇒ 那正是本任务「核心验收」要的那条读数，而它**在现有代码上已成立**。
 *
 * ⇒ ★★ 所以本文件的用途**不是**"把判据挪到一个新点"（那会改掉一条已经正确的接线），
 *   而是**把那条接线钉住** —— 使"它真的在申报那一刻被求值"成为一条**可核的读数**。
 *   ★ 而"钉住"这件事**是本任务的前提被证否之后仍然有价值的产物**：
 *     一个被证否的前提，只有在**留下一条会红的臂**之后，才算被真的查过。
 *
 * ── ★ 而任务书里那条"最贵的纪律"，我是这样落的 ─────────────────────────────────
 *
 *   > 若【两个插入点都要】是不可判定的 ⇒ 如实报出那一格不可判定，而不是硬造一个点。
 *
 *   ★ 我没有硬造一个插入点（那会改掉已正确的接线）。
 *   ★ 我也没有说"它不可判定" —— 因为**它可判定，而且已经判过**：
 *     插入点就是 `dispatch`，而它**已经在**成员申报那一刻被求值（臂 3 实测 `evaluated = 2`）。
 *   ⇒ 我报的是**读数**：不是"我定了一个新点"，而是"那个点已经是这个，而它真的在跑"。
 *
 * ── 三态（互不同形，而本文件逐条钉）──────────────────────────────────────────────
 *
 *     申报了 `changedPaths`  ⇒ ★ **求值**（`evaluated >= 1`，两条都在 `ran` 里且非 skipped）
 *     没申报                ⇒ ★ **不适用**（`appliesTo` 为 false ⇒ 计入 `skipped`）
 *     非 implementation/repair ⇒ 同样不适用（`worktree.ts:152` 逐字："只对声明了
 *                              changedPaths 的 implementation/repair 任务生效"）
 *
 * ── ★ 定向突变（打红本文件的几条路）────────────────────────────────────────────
 *
 *   a) 把两条之一的 `appliesTo` 改成恒 false ⇒ 臂 2 / 臂 4 红
 *   b) 把 `appliesTo` 改成恒 true（去掉 kind 守卫）⇒ 臂 5 红
 *   c) 去掉 `changedPaths.length > 0` 那一半 ⇒ 臂 5 红（没申报时也会"求值"）
 *   d) 在 `evaluate` 之前把 `update.changedPaths` 抹掉 ⇒ 臂 2 / 臂 3 红
 *     ★ 而 d 正是"把判据挂到一个喂不出那一格的求值点上"的形状 —— 也就是任务书设想的那个失效。
 *
 * Run: node --test scripts/gate-dispatch-point-applicability.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registry } from '../lib/gates/index.js'
import { appliesTo as changedPathsApplies } from '../lib/gates/dispatch/changed-paths.js'
import { appliesTo as worktreeApplies } from '../lib/gates/dispatch/worktree.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BOTH = ['dispatch.changed-paths', 'dispatch.worktree']

/** 真实调用点喂的那份 ctx（逐字取自 `src/tools/update-task/dispatch.ts` 的 dispatchContext）。 */
function realCtx({ kind = 'implementation', changedPaths = ['src/a.ts'] } = {}) {
  return {
    task: { id: 't43-fixture', kind, status: 'in_progress' },
    update: { changedPaths },
    observedChangedPaths: changedPaths,
    gitChangedPaths: changedPaths,
    observedWorkspaces: [ROOT],
  }
}

/** 这次求值里，两条判据各自是"跑了"还是"被跳过"。 */
async function readings(ctx) {
  const ev = await registry.evaluate('dispatch', ctx)
  const verdictOf = (id) => (ev.ran ?? []).find((entry) => entry.id === id)?.verdict
  return {
    ev,
    changedPaths: verdictOf('dispatch.changed-paths'),
    worktree: verdictOf('dispatch.worktree'),
    ranNotSkipped: (ev.ran ?? []).filter((entry) => BOTH.includes(entry.id) && entry.verdict !== 'skipped'),
  }
}

// ── 臂 1 ★★★ 生产里 `dispatch` 位置只有一处求值点，而它在成员申报那一刻 ────────────
test('臂 1 ★★★ 插入点的事实：`dispatch` 只有一处求值点，而在 `update_task`（申报那一刻）', () => {
  /**
   * ★ 这一条钉的是**结构事实**，不是我的说法：
   *   源码里 `evaluate('dispatch'` 只出现一次，且它在 update-task 那条路上。
   */
  const dispatchSite = readFileSync(join(ROOT, 'src/tools/update-task/dispatch.ts'), 'utf8')
  assert.match(dispatchSite, /registry\.evaluate\('dispatch'/u,
    '★★ `dispatch` 位置的求值点必须在 `src/tools/update-task/dispatch.ts` —— 那是【成员申报那一刻】')

  /**
   * ★★★ 而它喂的那一格必须**真的接到调用方的申报**，不只是"那一格在"。
   *
   *   ⚠️ MEASURED（我第一版写错了，被定向突变 D 抓出来）：
   *     第一版是 `/update:\s*\{\s*changedPaths:/` —— ★ 而它**只钉"那一格在不在"**，
   *     不钉"它接到哪儿"。把 `input.changedPaths` 换成 `undefined`（★ 那就是本任务设想的
   *     "挂到一个喂不出那一格的点上"）之后，那条正则**照样匹配** ⇒ 臂仍然绿。
   *     ⇒ ★ 那正是本队最贵的那种形状：**测试很绿，而它测的是"形状在"，不是"接线对"。**
   *
   *   ⇒ 修法：钉**绑定本身** —— `changedPaths` 右侧必须读 `input.`（调用方交进来的那份）。
   */
  assert.match(dispatchSite, /update:\s*\{\s*changedPaths:\s*input\.[A-Za-z_$][\w$]*/u,
    '★★★ 那个求值点必须把 `update.changedPaths` 接到**【调用方交进来的那一格】**（`input.*`）——'
    + '★ 只钉"那一格在"是不够的：把它换成 `undefined` 时，'
    + '"形状还在"而"接线断了"，而那在读数上几乎同形。')

  /** ★ 反向半边：scheduler 从不算判据 ⇒ "真正的派发点"上根本没有 dispatch 位置。 */
  const scheduler = readFileSync(join(ROOT, 'src/scheduler.ts'), 'utf8')
  assert.equal(/registry\.evaluate\(|\.evaluate\('/u.test(scheduler), false,
    '★ `src/scheduler.ts` 不该有任何判据求值 —— 所以"真正的派发点"上没有 dispatch 位置，'
    + '而"判据在那里 skipped"这件事也就不存在（不是"不适用"，是"那个点根本不求值"）')
})

// ── 臂 2 ★★★ 核心验收：申报那一刻，**两条都真的被求值** ──────────────────────────
test('臂 2 ★★★ 核心：成员申报 `changedPaths` 那一刻 ⇒ 两条判据都【真的被求值】（evaluated >= 1）', async () => {
  const { ev, changedPaths, worktree, ranNotSkipped } = await readings(realCtx())

  assert.ok(ev.evaluated >= 1, `★★★ 核心验收：申报那一刻必须真的求值（实测 evaluated=${ev.evaluated}）`)
  assert.equal(ranNotSkipped.length, 2,
    `★★★ 而**两条都要**跑：实测跑了的 = ${JSON.stringify(ranNotSkipped.map((e) => e.id))}。`
    + '★ 一条跑了、另一条 skipped，会让"它被检查过"在位置上读出来是假的。')
  assert.notEqual(changedPaths, 'skipped', '★ `dispatch.changed-paths` 必须真的跑（不是 skipped）')
  assert.notEqual(worktree, 'skipped', '★ `dispatch.worktree` 必须真的跑（不是 skipped）')
})

// ── 臂 3 ★★★ 而它跑出来的裁决**不是**"因为没人喂而空转" ──────────────────────────
test('臂 3 ★★★ 两条都交出**实质裁决**（不是"跑了但什么都没说"）', async () => {
  const { changedPaths, worktree } = await readings(realCtx())
  /**
   * ★★ 为什么这一条与臂 2 **不同形**：
   *   臂 2 问的是"它跑了吗"，这一条问的是"它跑了之后说了什么"。
   *   ★ 一个恒返回"没问题"的判据同样能让臂 2 绿（`verdict !== 'skipped'`）——
   *     而那正是"看起来被检查了"的最危险形状。
   *   ⇒ 所以这里断言两条都给出**三态之一的具体值**（`ok` / `blocked` / `unmeasured`）。
   */
  const legal = new Set(['ok', 'blocked', 'unmeasured'])
  assert.ok(legal.has(changedPaths), `★ changed-paths 的裁决必须是三态之一（实测 ${String(changedPaths)}）`)
  assert.ok(legal.has(worktree), `★ worktree 的裁决必须是三态之一（实测 ${String(worktree)}）`)
})

// ── 臂 4 ★★★ 三态不同形：申报 ⇒ 求值；没申报 ⇒ **不适用** ────────────────────────
test('臂 4 ★★★ 三态不同形：申报 ⇒ 求值（evaluated=2）；没申报 ⇒ 不适用（evaluated=0, 两条都 skipped）', async () => {
  const withPaths = await readings(realCtx({ changedPaths: ['src/a.ts'] }))
  assert.equal(withPaths.ev.evaluated, 2, '★ 申报了 ⇒ 本任务那两条都求值')
  /**
   * ⚠️ MEASURED（我第一版写错了，被本臂当场打红）：我原以为"申报了 ⇒ `skipped === 0`"。
   *   ★ 而错了：`dispatch` 位置上有**三条**判据，第三条是 `dispatch.plan-reviewed`
   *     —— 它在本夹具的 ctx 上没有 `reviewed` 戳 ⇒ 它 `skipped`。
   *   ⇒ 所以 `skipped === 1` 是**对的**，而"0"是我的假设。
   *   ★ 本臂的实质**不是**那个数，而是**那两条自己的读数**：它们必须**不在** skipped 里。
   */
  assert.equal(withPaths.ev.skipped, 1,
    '★ 申报了 ⇒ 那两条求值，而 `plan-reviewed`（位置的第三条）在本 ctx 上不适用（无 reviewed 戳）')

  /** ★ 没申报（空数组）⇒ 不适用。 */
  const empty = await readings(realCtx({ changedPaths: [] }))
  assert.equal(empty.ev.evaluated, 0, '★★ 没申报 ⇒ 一条都不求值（不适用）')
  assert.equal(empty.changedPaths, 'skipped', '★ 而它是 `skipped`，**不是** `ok`')
  assert.equal(empty.worktree, 'skipped', '★ 两条都一样')

  /**
   * ★★★ 而两者**必须不同形**：`evaluated` 2 vs 0、`skipped` 0 vs 2。
   *   ★ 把"没申报"读成 `ok` 会让"没有可核对的东西"伪装成"核对过了"。
   */
  assert.notEqual(withPaths.ev.evaluated, empty.ev.evaluated,
    '★★★ 申报与没申报必须不同形（求值 vs 不适用）—— 否则"没东西可核"与"核过了"同形')
})

// ── 臂 5 ★★ 不适用那一半的两条成因（kind 与 changedPaths），各自可核 ──────────────
test('臂 5 ★★ 不适用有两条成因：kind 不在 {implementation, repair}，或没声明 changedPaths', async () => {
  /** ① kind = work ⇒ 不适用（`worktree.ts:152`："只对声明了 changedPaths 的 implementation/repair 生效"）。 */
  const wrongKind = await readings(realCtx({ kind: 'work', changedPaths: ['src/a.ts'] }))
  assert.equal(wrongKind.ev.evaluated, 0, '★ kind=work ⇒ 不适用（两条都不跑）')

  /** ② kind 对而没申报 ⇒ 不适用。 */
  const noPaths = await readings(realCtx({ kind: 'implementation', changedPaths: [] }))
  assert.equal(noPaths.ev.evaluated, 0, '★ 没申报 ⇒ 不适用')

  /** ★★ 而 `repair` 必须**适用**（它是 `worktree.ts:152` 逐字列的那一类之一）。 */
  const repair = await readings(realCtx({ kind: 'repair', changedPaths: ['src/a.ts'] }))
  assert.equal(repair.ev.evaluated, 2, '★★ kind=repair 且申报了 ⇒ 两条都要跑（它在那句话里逐字被列了）')

  /**
   * ★ 而两条成因**都要说得出** —— `appliesTo` 是那个判定本身，直接问它：
   */
  assert.equal(changedPathsApplies(realCtx({ kind: 'work' })), false, '★ 成因①：kind 不在那两类')
  assert.equal(changedPathsApplies(realCtx({ changedPaths: [] })), false, '★ 成因②：没声明 changedPaths')
  assert.equal(changedPathsApplies(realCtx()), true, '★ 两条都满足 ⇒ 适用')
  assert.equal(worktreeApplies(realCtx()), true, '★★ 而 `worktree` 的判定与它**逐字同源**（同一组条件）')
})

// ── 臂 6 ★★ 两条判据的 `appliesTo` 逐字一致（同一组条件、同一个理由）────────────
test('臂 6 ★★ 两条的 `appliesTo` 对同一份 ctx 给出**同一个**答案（它们是一组条件）', () => {
  /**
   * ★★ 为什么这一条重要：`worktree.ts:152` 自己写着「与 `dispatch.changed-paths`
   *   同一组条件，理由也同源」。⇒ 若两者分叉，一条会跑而另一条不跑 ——
   *   而"隔离发生了没有"与"成员有没有虚报"是同一件事的两面，分叉之后读的人
   *   会以为其中一面被查过了。
   */
  const cases = [
    realCtx(),
    realCtx({ kind: 'work' }),
    realCtx({ kind: 'repair' }),
    realCtx({ kind: 'review' }),
    realCtx({ changedPaths: [] }),
    realCtx({ kind: 'implementation', changedPaths: ['a', 'b'] }),
  ]
  for (const ctx of cases) {
    assert.equal(changedPathsApplies(ctx), worktreeApplies(ctx),
      `★★ 两者必须同判（ctx: kind=${String(ctx.task.kind)} changedPaths=${JSON.stringify(ctx.update.changedPaths)}）`)
  }
})

// ── 臂 7 ★★ 判决语义一字未动：两条判据的裁决**照旧**由它们自己的规则给 ────────────
test('臂 7 ★★ 判决语义未动：虚报被发现 ⇒ 仍然拒（而"没申报"只是不适用，不是放行）', async () => {
  /**
   * ★ 本任务**不改判决语义**。所以：
   *   ① 一个**自报与观察对不上**的申报 ⇒ 仍然要被拒（那正是这条判据存在的理由）；
   *   ② 而"没申报" ⇒ `skipped`（不适用），**不是** `ok` —— 它不是"放行"，是"没什么可核"。
   */
  const mismatched = {
    task: { id: 't43-mismatch', kind: 'implementation', status: 'in_progress' },
    /** ★ 自报两条，而两个观察面都说"什么都没发生" —— 那正是虚报的形状。 */
    update: { changedPaths: ['src/a.ts', 'src/b.ts'] },
    observedChangedPaths: [],
    gitChangedPaths: [],
    observedWorkspaces: [ROOT],
  }
  const ev = await registry.evaluate('dispatch', mismatched)
  const verdict = (ev.ran ?? []).find((entry) => entry.id === 'dispatch.changed-paths')?.verdict
  assert.equal(verdict, 'blocked',
    '★★ 判决语义一字未动：自报与观察对不上 ⇒ 仍然 `blocked`（这条判据存在的理由就是拦虚报）')
  assert.equal(ev.ok, false, '★ 而它让整个位置报 ok:false')

  /** ★ 反向半边：而"没申报"是 `skipped`，**不是** `blocked` —— 两者不同形。 */
  const absent = await readings(realCtx({ changedPaths: [] }))
  assert.equal(absent.changedPaths, 'skipped',
    '★ 没申报 ⇒ `skipped`（不适用）—— 不是 `ok`（放行）、也不是 `blocked`（拒绝）')
})
