#!/usr/bin/env node
/**
 * ── r5 在【无 worktree】的任务上：第三态与它的判据（f-0020 的第三个成因）────────────
 *
 * ── ★★ 它修的是什么（MEASURED，absorb-dev 在 t68 报的，captain 核实成立）──────────
 *
 *   t68 是一个 `implementation` 任务，而它【没有 worktree】
 *   （`.agent-teams/worktrees/task-t68` 不存在）。
 *
 *   ⇒ `resolveBaseRevision` 落 `{ kind: 'absent', reason: 'no-worktree' }`
 *   ⇒ 调用方不注入 `parentRevision`（`worktreeBase === undefined` 那一支）
 *   ⇒ r5 走到 ④「no parent revision is available」⇒ **恒 unmeasured**
 *
 *   而 kind-requirements 表里 `implementation` 要三条门（r5 + mutation + backtest）
 *   ⇒ ★ 一个没有 worktree 的 implementation 任务在 r5 上**恒不可满足**。
 *
 * ── ★★★ 它把 f-0020 的成因补到第三个，而三者同形 ────────────────────────────────
 *
 *   ① 宿主持有旧模块          （今晚 20+ 次）
 *   ② 基线本身不绿            （t66/t67 实测）
 *   ③ 无 worktree ⇒ 拿不到父版本（t68 实测）
 *
 *   ⇒ 三者在「update_task rejected」这个**症状**上完全同形。
 *     而这一条是三条里唯一**结构性的**：它不依赖模块新鲜度，也不依赖仓库当时绿不绿 ——
 *     它只取决于"这个任务有没有被派发到一个独立目录"。
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ★★ 设计问题（它比实现重要 —— captain 要求先回答再动手）
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   **无 worktree 时，r5 该报 unmeasured，还是该有一条不同的路径？**
 *
 * ── 我的答案：**该有一条不同的路径，而那条路径的父版本是【工作区自己的 HEAD】** ──
 *
 *   理由一（语义）：r5 要的不是"一个 worktree"，它要的是
 *
 *       一个版本 R，使得「测试在 R 上红、在当前树上绿」
 *
 *       —— 也就是"这次改动【之前】的那棵树"。
 *
 *       ★ 一个【无 worktree】的任务，它的改动落在**共享工作区**里，
 *         而"改动之前的那棵树"**就是那个工作区的 HEAD**（未提交的改动才是"之后"）。
 *       ⇒ **那个父版本存在**，与被派发了 worktree 的任务一样存在。
 *         `absent / no-worktree` 说的是"没有独立目录"，**不是**"没有父版本"。
 *
 *       ★ 而现在的代码把这两件事读成了同一件 —— 那正是本队记账的那条：
 *         **读的量（有没有 worktree）超过了它声称的性质（有没有父版本）。**
 *
 *   理由二（"报 unmeasured"会让一条门恒不可满足）：
 *       `unmeasured` 的语义是"**这一轮**我没能测量"。它与"**永远**测不了"不同形。
 *       ★ 把一个【结构性】的、每一轮都相同的缺口报成 `unmeasured`，
 *         会让读者以为"再跑一次可能就好了" —— 而它永远不会好。
 *       ⇒ 那不是诚实，那是把**恒不可满足**伪装成**暂时测不到**。
 *
 * ── ★★ 而这个决定必须说清它的【代价】（否则它是半个决定）───────────────────────
 *
 *   用 HEAD 当父版本**不是紧的**：共享工作区意味着**别的任务可能已经提交过**，
 *   于是 HEAD 可能**已经包含**与本次改动等价的东西 ——
 *   那时成员的新测试在 HEAD 上就是**绿的**，而 r5 会判它「装饰性测试」。
 *
 *   ⇒ 那是一次**假拒绝**，而它是真实可能的（本仓实测：提交间隔以分钟计）。
 *
 *   ★ 而它仍比现状好，因为两者的失败方向**不同**：
 *
 *       现状（恒 unmeasured）  ⇒ **每一个**无 worktree 的 implementation 任务都收不了口
 *       新路径（HEAD 当父版本）⇒ **只有**"别人已经提交了等价改动"那一种情形会假拒绝
 *                               —— 而它是一个**可复核的具体主张**（有 hash、有补丁可比）
 *
 *   ⇒ ★ 而这个代价被**写进读数**（`base: 'workspace-head'` + 一句说明），
 *     不是被藏起来：读的人要能看出"这个父版本是退而求其次的那个"。
 *
 * ── ★★ 三态（契约）──────────────────────────────────────────────────────────────
 *
 *   ① `isolated`   —— 有 worktree 且父版本可用  ⇒ 正常判定（**语义一字不改**）
 *   ② `workspace-head` —— 无 worktree，父版本 = 工作区 HEAD ⇒ **判**，且标出来源
 *   ③ `unmeasurable` —— 连 HEAD 都读不到（不是 git 仓库 / 没有提交）
 *                       ⇒ unmeasured，且措辞与 ①② 都不同形
 *
 *   ★ 三者不得合并。而 ② 与 ③ 的分界是**可测量的**：读得到 HEAD 与否。
 *
 * ── ★★ 反向半边 ────────────────────────────────────────────────────────────────
 *
 *   有 worktree 时 r5 的既有语义**一字不改** —— 臂 6/7 钉住这一点。
 *
 * Run: node --test scripts/gate-r5-no-worktree.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gate, appliesTo, parseKindRequirements } from '../lib/gates/completion/r5.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ── ★ 本夹具用【真的那张 kind 需求表】（从盘上读），而不是手搓一个 ─────────────
 *
 * ★ 与 `scripts/gate-r5.test.mjs` 同一手法：`implementation` 要不要 r5
 *   是一个**数据事实**，而本任务不该在夹具里替它作主 ——
 *   否则"这条门对这个 kind 生效吗"会被夹具的假设掩盖。
 *   （★ 而那正是本任务【不该碰】的那一格：见臂 8。）
 */
function realRequirements() {
  return parseKindRequirements(
    JSON.parse(readFileSync(join(ROOT, 'src', 'gates', 'completion', 'kind-requirements.json'), 'utf8')),
  )
}

/**
 * 一份最小可用的 ctx。
 *
 * ★ `runTestOnRevision` 是【假的 git】：判据不 import I/O，两轮的退出码由它给出。
 *   这与 `scripts/gate-r5.test.mjs` 的既有手法同构（那份夹具测的是有 worktree 的路径）。
 */
function context(overrides = {}) {
  return {
    loadKindRequirements: () => realRequirements(),
    task: { id: 't68', kind: 'implementation', inScope: ['src/impl.ts'] },
    update: { newTestFiles: ['scripts/impl.test.mjs'] },
    scanDirs: ['scripts'],
    wantsCompleted: true,
    taskNotTerminal: true,
    runTestOnRevision: async (_test, revision) => ({ exitCode: revision === 'working-tree' ? 0 : 1 }),
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 态 ①：有 worktree 且有父版本 —— 正常判定（反向半边：语义不改）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（对照臂）：有父版本 ⇒ 照常判，且交出两轮观测', async () => {
  const verdict = await gate(context({ parentRevision: 'abc1234' }))
  assert.equal(verdict.ok, true, `实测：${JSON.stringify(verdict)}`)
  assert.equal(verdict.r5.verified.length, 1)
  assert.equal(verdict.r5.verified[0].parentExitCode, 1, '父版本上红')
  assert.equal(verdict.r5.verified[0].fixedExitCode, 0, '修复版本上绿')
})

test('★ 臂 2（反向半边）：有父版本时，装饰品仍然被拒 —— 语义一字不改', async () => {
  /**
   * ★ 这一臂防"修无 worktree 时把有 worktree 的路放宽了"。
   *   父版本上也绿 ⇒ 那就是装饰性测试 ⇒ 必须 blocked。
   */
  const verdict = await gate(context({
    parentRevision: 'abc1234',
    runTestOnRevision: async () => ({ exitCode: 0 }),
  }))
  assert.equal(verdict.ok, false)
  assert.ok(
    verdict.blockers.some((b) => b.includes('decorative test')),
    `★ 有 worktree 的路径上装饰品必须仍被拒。实测：${JSON.stringify(verdict.blockers)}`,
  )
})

test('★ 臂 3（反向半边）：有父版本时，两轮都红仍然被拒', async () => {
  const verdict = await gate(context({
    parentRevision: 'abc1234',
    runTestOnRevision: async () => ({ exitCode: 1 }),
  }))
  assert.equal(verdict.ok, false)
  assert.ok(verdict.blockers.some((b) => b.includes('never turned green')), JSON.stringify(verdict.blockers))
})

// ─────────────────────────────────────────────────────────────────────────────
// 态 ②：无 worktree —— ★ 本任务的核心
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4（核心臂）：无 worktree 而工作区 HEAD 可读 ⇒ 必须【判】，不是恒 unmeasured', async () => {
  /**
   * ── ★★ 这是本任务存在的理由的可执行形式 ────────────────────────────────────────
   *
   * 现状：`parentRevision` 缺席 ⇒ 「no parent revision is available」⇒ unmeasured
   *       ⇒ 那类任务**恒不可满足**。
   *
   * 新路径：无 worktree ⇒ 父版本取【工作区 HEAD】⇒ 照常判。
   */
  const verdict = await gate(context({
    /** ★ 无 `parentRevision`（调用方拿不到 worktree base）。 */
    workspaceHead: 'def5678',
  }))
  assert.equal(
    verdict.ok, true,
    `★★ 无 worktree 而 HEAD 可读 ⇒ 必须给出判定。实测：${JSON.stringify(verdict)}`,
  )
  assert.equal(verdict.r5.verified.length, 1, '★ 必须交出两轮观测，不能只说"过了"')
  assert.equal(verdict.r5.verified[0].parentExitCode, 1, '父版本（工作区 HEAD）上红')
  assert.equal(verdict.r5.verified[0].fixedExitCode, 0, '当前树上绿')
})

test('★★ 臂 5：那条读数的来源必须【写得出来】—— 它不是"等同"于有 worktree 的那条路', async () => {
  /**
   * ── ★ 为什么这一条必须有 ───────────────────────────────────────────────────────
   *
   * 用 HEAD 当父版本**不是紧的**（见文件头「代价」）：
   * 共享工作区里，别的任务可能已经提交过等价的东西 ⇒ 那时会**假拒绝**。
   *
   * ⇒ ★ 而这个退而求其次必须**写在读数里**，让人看得出"这是次优的那个父版本"。
   *   否则"工作区 HEAD"与"真父版本"在报告里同形 —— 那正是本队记账的那条。
   */
  const withWorktree = await gate(context({ parentRevision: 'abc1234' }))
  const noWorktree = await gate(context({ workspaceHead: 'def5678' }))
  assert.equal(withWorktree.ok, true)
  assert.equal(noWorktree.ok, true)
  /**
   * ★ 两条路都必须交出 `parentRevision`（给读者核对用了哪个版本），
   *   而**无 worktree 那条多一格 `base`** 说明它的来源。
   */
  assert.equal(noWorktree.r5.parentRevision, 'def5678', '★ 用的是哪个版本必须写出来')
  assert.equal(
    noWorktree.r5.base, 'workspace-head',
    `★★ 必须标出"这个父版本是工作区 HEAD"（不是 worktree base）。实测：${JSON.stringify(noWorktree.r5)}`,
  )
  assert.notEqual(
    noWorktree.r5.base, withWorktree.r5.base,
    '★ 两条路的读数字段必须不同形 —— 否则读者分不出他用的是哪一个',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 态 ③：连 HEAD 都读不到 —— unmeasured，且与 ①② 都不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6（三态臂）：读不到 HEAD ⇒ unmeasured，且与另两态不同形', async () => {
  /**
   * ★ ③ 是"这一轮真的没能测量"（不是 git 仓库 / 没有提交）。
   *   它与 ② 不同形：② 是"我用了次优的父版本"，③ 是"我连那个都拿不到"。
   *   它与 ① 不同形：① 有真父版本。
   */
  const verdict = await gate(context({
    /** ★ 两者都缺席：调用方既没有 worktree base，也没读出 HEAD。 */
    workspaceHead: undefined,
  }))
  assert.equal(verdict.ok, false, `实测：${JSON.stringify(verdict)}`)
  assert.equal(typeof verdict.unmeasured, 'string', '★ 这一态必须是 unmeasured')
  assert.equal(verdict.blockers, undefined, '★ 不许并进 blocked（那是"测出来有问题"）')
  assert.match(
    verdict.unmeasured, /no parent revision|could not determine/i,
    `★ 必须说清是"没能测量"。实测：${verdict.unmeasured}`,
  )
})

test('★★ 臂 7（三态不同形）：三态的读数两两不同形', async () => {
  const isolated = await gate(context({ parentRevision: 'abc1234' }))
  const head = await gate(context({ workspaceHead: 'def5678' }))
  const unmeasurable = await gate(context({ workspaceHead: undefined }))

  /** ★ ① 与 ② 都 ok，而【来源不同形】。 */
  assert.equal(isolated.ok, true)
  assert.equal(head.ok, true)
  assert.notEqual(isolated.r5.base, head.r5.base, '① 与 ② 的来源标记必须不同')
  /** ★ ③ 与前两者都不同形：它连 ok 都不是。 */
  assert.equal(unmeasurable.ok, false)
  assert.equal(typeof unmeasurable.unmeasured, 'string')
  assert.notEqual(unmeasurable.ok, head.ok, '③ 与 ② 不同形')
  assert.notEqual(unmeasurable.ok, isolated.ok, '③ 与 ① 不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 判据的适用面：无 worktree 不该改变"这条门生不生效"
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 8：无 worktree 不会让 `appliesTo` 变宽或变窄', () => {
  /**
   * ★ 这一臂防一次越界：本任务的改动只碰"父版本从哪来"，
   *   **不碰**"这条门对这个 kind 生不生效"（那由 kind-requirements 表决定）。
   */
  const base = {
    loadKindRequirements: () => realRequirements(),
    task: { kind: 'implementation' },
    update: { newTestFiles: ['a.test.mjs'] },
    wantsCompleted: true,
    taskNotTerminal: true,
  }
  assert.equal(appliesTo(base), true)
  assert.equal(appliesTo({ ...base, workspaceHead: 'x' }), appliesTo(base), '★ 加一格输入不许改变适用判定')
  assert.equal(appliesTo({ ...base, task: { kind: 'review' } }), false, '★ review 仍然不适用')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 定向突变：把无 worktree 那条改回"恒 unmeasured" ⇒ 臂必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 9（突变臂）：退回"无 worktree ⇒ 恒 unmeasured"的形状 ⇒ 臂 4 会红', async () => {
  /**
   * ★ 突变就是**修法前的读法**：`workspaceHead` 这一格被无视。
   *   ⇒ 那正是现状（调用方只注入 `parentRevision`）。
   *
   * ★ 本臂断言的是那个对照确实存在：同一份输入，修法前 `unmeasured`、修法后 `ok`。
   *   若两者相等，说明新增的那条路径**没有生效**（判据是恒 unmeasured 的）。
   */
  const fixed = await gate(context({ workspaceHead: 'def5678' }))
  /** 突变的等价形式：把 workspaceHead 那一格丢掉（= 修法前的 ctx）。 */
  const legacy = await gate(context({}))
  assert.equal(fixed.ok, true, '修法后：能判')
  assert.equal(legacy.ok, false, '修法前：恒 unmeasured')
  assert.notEqual(fixed.ok, legacy.ok, '★ 修法必须改变这个答案，否则它不是一条机制')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 臂 10：两个来源【都在】时，优先用 worktree base —— 这是反向半边的一部分
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 10（优先级臂）：两个来源都在 ⇒ 必须用 worktree base，不许用 HEAD', async () => {
  /**
   * ── ★ 这一臂补的是一个【实测发现的缺口】────────────────────────────────────────
   *
   * MEASURED：把代码里的 `isolatedParent ?? workspaceParent` 反过来写成
   * `workspaceParent ?? isolatedParent`（= 优先 HEAD），**所有臂仍然全绿** ——
   * 因为在此之前，**没有任何一臂同时提供两个来源**。
   *
   *   ⇒ ★ 而那个优先级正是"反向半边"的核心：有隔离时父版本必须是那个隔离的基准。
   *     反过来会让"有 worktree 的任务"悄悄改用共享工作区的 HEAD ——
   *     而共享工作区可能已经包含**别人的**改动 ⇒ 假拒绝。
   *
   * ★ 形态：**一个没有被任何臂覆盖的分支，与不存在的分支在观测上相同。**
   *   两个来源的优先级是这条判据的一等公民（它决定"紧"还是"松"），
   *   所以它必须有自己的臂。
   */
  const both = await gate(context({ parentRevision: 'abc1234', workspaceHead: 'def5678' }))
  assert.equal(both.ok, true)
  assert.equal(
    both.r5.parentRevision, 'abc1234',
    `★★ 两个来源都在时，必须用 worktree base（首选）。实测用了：${both.r5.parentRevision}`,
  )
  assert.equal(
    both.r5.base, 'worktree-base',
    `★ 而来源标记也必须说 worktree-base。实测：${JSON.stringify(both.r5)}`,
  )

  /**
   * ★ 而这一臂必须能**区分**两个来源（否则它测不出上面那件事）：
   *   两份 ctx 只差"哪个来源在场"，而它们必须给出不同的 `base`。
   */
  const onlyHead = await gate(context({ workspaceHead: 'def5678' }))
  assert.equal(onlyHead.r5.base, 'workspace-head')
  assert.notEqual(both.r5.base, onlyHead.r5.base, '★ 两种来源必须不同形')
})
