/**
 * ── ★★★ t97（吸收上游 #161 的 **S1**）：判决**绑定了哪些字节** ─────────────────────────
 *
 * 上游 #161 的原始缺陷（逐字）：
 * > 「A **passing review was not bound to the revision it judged**……
 * >   it advertised "all gates passed" over **bytes that had since been edited
 * >   or deleted**.」
 * > 「A verdict that **predates content binding** is reported as an **unauditable
 * >   gap** rather than being read as a pass over the current bytes.」
 *
 * ★★ 本夹具钉的是 **S1 的三态**（`bound` / `drifted` / `unbound`）——
 *   ★ 而**不**钉 S3/S4 的判据分级（那不在本任务边界内）。
 *
 * ── 三条反向半边（缺一不可）────────────────────────────────────────────────
 *   臂 1（A）：**没有** `reviewedArtifacts` ⇒ `unbound`（★ 不许当 sound）
 *   臂 2（B）：有摘要而**字节已变** ⇒ `drifted`（★ 含"已删除"）
 *   臂 3（C）：有摘要且**字节未变** ⇒ `bound`（★ 不许把所有带摘要的都判成 drifted）
 *
 * ★ 另钉两条：确定性（可复跑）与**安全规则**（符号链接不得逃出工作区）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { artifactBindingOf, canDeclareDelivery } = await import('../lib/quality-gates.js')
const { snapshotReviewedArtifacts, digestWorkspacePaths } = await import('../lib/artifacts.js')
const { VERDICT_KINDS } = await import('../lib/types.js')

/** 造一棵最小的工作区，返回它的根。 */
const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), 't97-ledger-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const a = 1\n', 'utf8')
  writeFileSync(join(root, 'src/b.ts'), 'export const b = 2\n', 'utf8')
  return root
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★ 反向半边 A：没有 reviewedArtifacts ⇒ unbound（不许当 sound）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（反向半边 A）：【没有】 reviewedArtifacts 的判决 ⇒ unbound，不许被当作 sound', () => {
  /**
   * ★★ 这条正是上游修的缺陷：一个**早于内容绑定**的判决**不许**被读成
   *   "对当前字节的一次通过"。
   */
  assert.equal(artifactBindingOf(undefined, {}), 'unbound', '★ 缺席 ⇒ unbound')
  /**
   * ★★ 而**空数组也算** `unbound`：`reviewedArtifacts: []` 说"这次判决没有绑定任何字节" ——
   *   那**回答不了**"它判的是哪批字节"这个问题。
   *   ★ 它仍然与"没有这一格"在**落盘形状**上不同形（在场 vs 缺席）。
   */
  assert.equal(artifactBindingOf([], { 'src/a.ts': 'x' }), 'unbound', '★ 空数组 ⇒ 同样 unbound')
  /** ★ 而 `unbound` **不是** `drifted` —— 缺席 ≠ "变了"。 */
  assert.notEqual(artifactBindingOf(undefined, {}), 'drifted', '★ 把"不知道"说成"变了"是造一个没发生过的绑定')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边 B：字节已变 ⇒ drifted
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（反向半边 B）：有 reviewedArtifacts 而【字节已变】⇒ drifted', async () => {
  const root = sandbox()
  try {
    const before = await snapshotReviewedArtifacts(root, ['src'])
    assert.equal(before.reviewedArtifacts.length, 2, '★ 前提：绑定了两个文件')
    const current = Object.fromEntries(before.reviewedArtifacts.map((a) => [a.path, a.digest]))
    assert.equal(artifactBindingOf(before.reviewedArtifacts, current), 'bound', '★ 前提：未变时是 bound')

    /** ① 改了内容。 */
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 999\n', 'utf8')
    const after = await snapshotReviewedArtifacts(root, ['src'])
    const current2 = Object.fromEntries(after.reviewedArtifacts.map((a) => [a.path, a.digest]))
    assert.equal(
      artifactBindingOf(before.reviewedArtifacts, current2), 'drifted',
      '★★ 改了一个文件后必须报 drifted —— 那次判决说的是【另一批字节】',
    )

    /** ② ★ 文件**已被删除**（上游逐字点名 "edited **or deleted**"）。 */
    const deleted = { ...current2 }
    delete deleted['src/b.ts']
    assert.equal(
      artifactBindingOf(before.reviewedArtifacts, deleted), 'drifted',
      '★★ 被点名绑定的文件已删除 ⇒ 同样 drifted（缺它的当前摘要 ⇒ 不可核）',
    )
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 反向半边 C：字节未变 ⇒ bound（挡"恒报 drifted"）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（反向半边 C）：有 reviewedArtifacts 且【字节未变】⇒ bound（不许把所有带摘要的都判成 drifted）', async () => {
  const root = sandbox()
  try {
    const snapshot = await snapshotReviewedArtifacts(root, ['src'])
    const current = Object.fromEntries(snapshot.reviewedArtifacts.map((a) => [a.path, a.digest]))
    /**
     * ★★★ 这条挡的是**最省事的错法**：「有摘要就报 drifted」。
     *   那种写法是**恒报** —— 与"什么都判不了"在补救动作上同形
     *   （都会让人去重做一次本来没问题的活）。
     */
    assert.equal(
      artifactBindingOf(snapshot.reviewedArtifacts, current), 'bound',
      '★★ 字节未变必须报 bound —— 否则本判据退化成"恒报 drifted"',
    )
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 确定性：同一批字节 ⇒ 同一摘要（可复跑）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4：摘要是【确定性】的（同一批字节 ⇒ 同一摘要，可复跑）', async () => {
  const root = sandbox()
  try {
    const first = await snapshotReviewedArtifacts(root, ['src'])
    const second = await snapshotReviewedArtifacts(root, ['src'])
    assert.deepEqual(second.reviewedArtifacts, first.reviewedArtifacts, '★ 两次快照逐条相同')
    /**
     * ★★ 而**必须是内容摘要**（64 位 hex = sha256），**不是** git 对象名 ——
     *   否则 `cherry-pick` / `rebase` 会改那个名字而字节没变（T7 的教训）。
     */
    for (const artifact of first.reviewedArtifacts) {
      assert.match(
        artifact.digest, /^[0-9a-f]{64}$/,
        `★★ ${artifact.path} 的 digest 不是 sha256 hex（${artifact.digest}）—— `
        + 'git 对象名的形状与它不同，而用 git 名字会在大改历史后误判',
      )
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 安全规则：符号链接不得逃出工作区 / 不得变成无限遍历
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5：符号链接【不得】变成读宿主机任意文件 —— 逃出工作区即拒并记 gap', async () => {
  const root = sandbox()
  const outside = mkdtempSync(join(tmpdir(), 't97-outside-'))
  try {
    writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET\n', 'utf8')
    /** ① 点名一个**逃出工作区**的路径 ⇒ 拒 + 记 gap（不静默省略）。 */
    const escaped = await digestWorkspacePaths(root, ['../' + outside.split('/').pop() + '/secret.txt'])
    assert.deepEqual(
      escaped.artifacts, [],
      '★★ 逃出工作区的路径不得被读到（否则一个符号链接就变成了读宿主机任意文件）',
    )
    /**
     * ★★ 而它**必须**记一条显式的 gap ——
     *   一份**静默省略**的清单会让"没读到"读成"没变"。
     */
    assert.equal(escaped.gaps.length, 1, '★★ 必须记一条显式的 gap（不是静默省略）')

    /** ② 目录里的符号链接：**不跟**（否则一个环会变成无限遍历）。 */
    symlinkSync(outside, join(root, 'escape'))
    const walked = await snapshotReviewedArtifacts(root, ['src', 'escape'])
    assert.ok(
      !walked.reviewedArtifacts.some((artifact) => artifact.path.includes('secret')),
      '★★ 递归展开不得穿过符号链接',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6 ★★ `audit.artifacts` 是审计的**输入面**（且三态经它可读）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6：`audit.artifacts` 传进 `canDeclareDelivery` ⇒ 逐条判决的三态可读', async () => {
  const root = sandbox()
  try {
    const snapshot = await snapshotReviewedArtifacts(root, ['src'])
    const task = {
      id: 'review-1', kind: 'review', status: 'completed', verdict: 'pass',
      subject: 'review-1', reviewedTaskId: 'impl-1',
      reviewedArtifacts: snapshot.reviewedArtifacts,
    }
    /** ★ 一条**没有**绑定的历史判决（模拟今天盘上那些）。 */
    const legacy = { id: 'review-0', kind: 'review', status: 'completed', verdict: 'pass', subject: 'review-0' }
    const team = {
      id: 'team1', phase: 'running', halted: false, escalated: false,
      members: [], tasks: [legacy, task],
    }
    /** ① **不传** audit ⇒ `verdictBindings` **缺席**（"没审计" ≠ "审计了全有效"）。 */
    const noAudit = canDeclareDelivery(team)
    assert.equal(noAudit.verdictBindings, undefined, '★ 不传 audit ⇒ 这一格缺席（不是空数组）')

    /** ② 传 audit ⇒ 两条判决的绑定状态**可读**，且**逐条不同形**。 */
    const audited = canDeclareDelivery(team, { artifacts: snapshot.reviewedArtifacts })
    assert.ok(Array.isArray(audited.verdictBindings), '★★ 传了 audit ⇒ 逐条读数在场')
    const byId = Object.fromEntries(audited.verdictBindings.map((reading) => [reading.taskId, reading]))
    assert.equal(byId['review-1'].binding, 'bound', '★ 有绑定且字节未变 ⇒ bound')
    assert.equal(byId['review-0'].binding, 'unbound', '★★ 没有绑定的历史判决 ⇒ unbound（不许被当作 sound）')

    /** ③ 字节变了 ⇒ 同一条判决报 drifted。 */
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 999\n', 'utf8')
    const after = await snapshotReviewedArtifacts(root, ['src'])
    const drifted = canDeclareDelivery(team, { artifacts: after.reviewedArtifacts })
    assert.equal(
      drifted.verdictBindings.find((reading) => reading.taskId === 'review-1').binding, 'drifted',
      '★★ 字节变了 ⇒ drifted',
    )
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7 ★ 前提臂：VERDICT_KINDS 只含"判决类"
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7（前提臂）：`VERDICT_KINDS` 只含判决类 —— 否则绑定语义被摊到"干活"上', () => {
  assert.deepEqual(
    [...VERDICT_KINDS].sort(), ['requirements', 'review', 'verification'],
    '★ 只有这三类的"完成"是【关于某个修订的判决】（说"这批字节行不行"）',
  )
  /**
   * ★★ 而 `implementation` / `repair` / `integration` / `work` **不在**其中 ——
   *   它们的完成是"我把活干了"，**不判决任何字节**。
   *   给它们也记一份绑定是**造一个不存在的语义**（"这次研究绑定了哪些字节"没有意义）。
   */
  for (const kind of ['implementation', 'repair', 'integration', 'work']) {
    assert.ok(!VERDICT_KINDS.includes(kind), `★ ${kind} 不是判决类`)
  }
})
