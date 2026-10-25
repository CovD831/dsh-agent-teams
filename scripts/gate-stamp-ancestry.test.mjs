import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * ── ★★★ stamp 的"落后"与"分叉"必须不同形，且**落后不许报 stale** ────────────────
 *
 * MEASURED 的由来（队长与 runtime-eng 各自独立复现）：
 *
 *     commit N   跑 pnpm build ⇒ 写 stamp{commit: N}
 *     commit N   ……而【包含这个 stamp 的那个提交】是 N+1
 *
 * ⇒ 一个产物**无法描述包含它自己的那个提交** ⇒ `stamp.commit` 与 HEAD
 *   **必然**不同，而这是**构造性**的。若把"不相等"读成"落后"，那么**每提交一次**
 *   就产生一条**先于使用者存在的假红**。
 *
 * 实测代价：`gate-stale-module` 的臂 1/4/6 同时变红，而三条标题里**都没有
 * "stamp" 这个词** ⇒ 读起来像"谁弄坏了三条不相干的臂"，而**回滚自己的改动
 * 不会让它变绿**。
 *
 * ★ 而"祖先为真"有两种情形，补救动作相反，靠**第三维**分开：
 *   · 那两个提交之间**构建输入变了** ⇒ 真的落后 ⇒ 报 stale；
 *   · **一个字没变** ⇒ 旧构建描述的就是当前代码 ⇒ 报 current。
 */

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function repoWith(t) {
  const root = mkdtempSync(join(tmpdir(), 'stamp-ancestry-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  git(root, ['init', '-q', '-b', 'main', '.'])
  git(root, ['config', 'user.email', 't@t'])
  git(root, ['config', 'user.name', 't'])
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'README.md'), '# x\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'one'])
  return root
}

/** ★ 三态必须真的可分：`true` / `false` / `undefined`。 */
test('★ 臂 1：构建输入**变了** ⇒ true（真的落后）', async (t) => {
  const { buildInputsChangedBetween } = await import('../lib/tools.js')
  const root = repoWith(t)
  const a = git(root, ['rev-parse', 'HEAD'])
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 2\n')
  git(root, ['add', '-A']); git(root, ['commit', '-qm', 'two'])
  const b = git(root, ['rev-parse', 'HEAD'])
  assert.equal(buildInputsChangedBetween(a, b, root), true,
    '★ 构建输入变了 ⇒ 必须报 true（这才是真正该报 stale 的形态）')
})

test('★★ 臂 2（本任务的存在理由）：只有**文档**变了 ⇒ false，不许报落后', async (t) => {
  const { buildInputsChangedBetween } = await import('../lib/tools.js')
  const root = repoWith(t)
  const a = git(root, ['rev-parse', 'HEAD'])
  /** ★ 这正是现实中"build 之后 commit"的形状：只有非构建输入前进。 */
  writeFileSync(join(root, 'NOTES.md'), 'a later commit touching nothing build-relevant\n')
  git(root, ['add', '-A']); git(root, ['commit', '-qm', 'later'])
  const b = git(root, ['rev-parse', 'HEAD'])
  assert.equal(buildInputsChangedBetween(a, b, root), false,
    '★★ 只有非构建输入变了 ⇒ false ⇒ 调用方据此**不报**落后（否则每提交一次一条假红）')
})

test('★★★ 臂 3（反向臂）：问不出来 ⇒ `undefined`，**不许**折叠成 false', async (t) => {
  const { buildInputsChangedBetween } = await import('../lib/tools.js')
  const root = repoWith(t)
  const a = git(root, ['rev-parse', 'HEAD'])
  /**
   * ★ 用一个**不存在**的提交当起点 ⇒ git 失败。
   *   ⇒ 必须 `undefined`（"我没能核对"），而不是 `false`（"它没变"）——
   *     后者会把"说不清"读成"没事"，而那正是本队最贵的合流。
   */
  const bogus = '0'.repeat(40)
  assert.equal(buildInputsChangedBetween(bogus, a, root), undefined,
    '★★★ 跑不了 ⇒ undefined（保守），绝不许是 false')
})

test('★★ 臂 4：祖先判定本身也是三态（`false` 与 `undefined` 不同形）', async (t) => {
  const { isAncestorOf } = await import('../lib/tools.js')
  const root = repoWith(t)
  const a = git(root, ['rev-parse', 'HEAD'])
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 9\n')
  git(root, ['add', '-A']); git(root, ['commit', '-qm', 'two'])
  const b = git(root, ['rev-parse', 'HEAD'])
  assert.equal(isAncestorOf(a, b, root), true, '★ A 是 B 的祖先')
  assert.equal(isAncestorOf(b, a, root), false,
    '★★ 反过来说"不是祖先"—— 这是一个**答案**，不是一次失败')
  assert.equal(isAncestorOf('0'.repeat(40), b, root), undefined,
    '★★ 那条提交不存在 ⇒ undefined（判不了），不许与 false 合流')
})
