import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectGitArtifacts, writeGitArtifactStamp, verifyGitArtifacts } from './git-artifacts.mjs'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent-teams-artifact-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, value = '') => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), value) }
  put('package.json', JSON.stringify({ name: 'test', version: '1.0.0', devDependencies: { typescript: '5.9.3' }, scripts: { build: 'compile' } }))
  for (const path of ['src/index.ts', 'lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts', 'tsconfig.json', 'tsconfig.client.json', 'tsdown.config.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/clean-build.mjs', 'scripts/git-artifacts.mjs']) put(path)
  return { root, put }
}
test('complete build matches its stamp and README changes do not invalidate it', t => {
  const { root, put } = fixture(t); writeGitArtifactStamp(root); put('README.md', 'new instructions'); assert.equal(verifyGitArtifacts(root).schema, 1)
})
test('source changes require rebuilding', t => {
  const { root, put } = fixture(t); writeGitArtifactStamp(root); put('src/index.ts', 'changed'); assert.throws(() => verifyGitArtifacts(root), /stale or modified/)
})
test('dependency settings require rebuilding', t => {
  const { root, put } = fixture(t); writeGitArtifactStamp(root); put('pnpm-workspace.yaml', 'changed'); assert.throws(() => verifyGitArtifacts(root), /stale or modified/)
})
test('modified and extra output cannot pass the stamp', t => {
  const { root, put } = fixture(t); writeGitArtifactStamp(root); put('lib/extra.js', 'unexpected'); assert.throws(() => verifyGitArtifacts(root), /stale or modified/)
})
test('missing entry cannot be stamped as a valid build', t => {
  const { root } = fixture(t); rmSync(join(root, 'lib/client.js')); assert.throws(() => writeGitArtifactStamp(root), /Missing Git artifact/)
})
test('a source tree with no build stamp cannot pass', t => {
  const { root } = fixture(t); assert.throws(() => verifyGitArtifacts(root), /Missing Git artifact stamp/)
})

/**
 * ── ★★★ t33：陈旧 stamp 与"真的对不上"必须**不同形** ─────────────────────────────
 *
 * 见 `git-artifacts.mjs` 里 `inspectGitArtifacts` 的文件头。要点重述一句：
 * 一处不符、一句话、一个退出码 ⇒ 「先于我的红」与「我引入的红」只能靠**推理**
 * 区分（翻 git log / stash 自己的改动再跑一次），而推理在不同的人那里会给出
 * 不同的答案。⇒ 本组臂钉的是**那个区分**。
 *
 * ── ★★ 怎么造"内容对得上而提交更早"这个形状 ────────────────────────────────────
 *
 * 上面那些臂的 fixture **不是 git 仓库** ⇒ `gitCommit` 返回 `undefined`
 * ⇒ 提交那一格**缺席**，于是 t33 那条路径在旧夹具里**从来没被走到过**。
 * ⇒ 这里必须先 `git init` + 一次提交，才能造出"stamp 记了 A，而 HEAD 是 B"。
 */

/** 一个**真的 git 仓库**的 fixture（于是 `commit` 那一格会在场）。 */
function gitFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent-teams-artifact-git-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, value = '') => { mkdirSync(join(root, dirname(path)), { recursive: true }); writeFileSync(join(root, path), value) }
  put('package.json', JSON.stringify({ name: 'test', version: '1.0.0', devDependencies: { typescript: '5.9.3' }, scripts: { build: 'compile' } }))
  for (const path of ['src/index.ts', 'lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'lib/types/client/index.d.ts', 'tsconfig.json', 'tsconfig.client.json', 'tsdown.config.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/clean-build.mjs', 'scripts/git-artifacts.mjs']) put(path)
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '-q', '.')
  git('add', '-A')
  git('commit', '-qm', 'init')
  return { root, put, git }
}

test('★★★ t33 臂 1：内容对得上而提交更早 ⇒ `stale-commit`，**不抛**，且说得出"先于我"', t => {
  /**
   * ★ 这就是 **t31 实测的那个 hazard**：worktree 从某提交建出来，
   *   而那条提交里的 stamp 是**父提交**写的 ⇒ 内容全对得上，而 HEAD 更晚。
   * ★ 它**不是**"这棵树坏了"⇒ 必须**不抛**（否则量"这棵树绿不绿"的人
   *   会看到一个**先于他存在**的红）。
   */
  const { root, put, git } = gitFixture(t)
  writeGitArtifactStamp(root)
  const stampedAt = git('rev-parse', 'HEAD').trim()
  /** ★ 第二次提交：**只动一个与摘要无关的文件** ⇒ 内容摘要不变，而 HEAD 变了。 */
  put('NOTES.md', 'a later commit that changes nothing the digests cover')
  git('add', '-A'); git('commit', '-qm', 'later')
  const head = git('rev-parse', 'HEAD').trim()
  assert.notEqual(head, stampedAt, '★ 前置：HEAD 必须真的动了')

  /** ★★ 前置（这一条是本臂的地基）：内容摘要**仍然对得上** —— 否则测的是另一件事。 */
  const inspection = inspectGitArtifacts(root)
  assert.equal(
    inspection.verdict, 'stale-commit',
    '★★★ 内容对得上 + 提交不同 ⇒ `stale-commit`（而不是 `content-differs`）',
  )
  assert.equal(inspection.savedCommit, stampedAt, '★ 而它要说清 stamp 记的是**哪一条**')
  assert.equal(inspection.headCommit, head, '★ 以及 HEAD 是**哪一条**')
  assert.match(inspection.why, /PRE-EXISTING/u, '★★★ 那句话必须**明说**它是先于当前工作存在的')
  /** ★★ 而**不抛** —— 这是本臂最关键的一半。 */
  assert.doesNotThrow(() => verifyGitArtifacts(root), '★★★ `stale-commit` **不许**抛：它是一次假红')
})

test('★★★ t33 臂 2（对照臂）：真的对不上 ⇒ `content-differs`，**抛**，且说出**哪一半**变了', t => {
  /**
   * ★★ 控制臂：一个把**所有**不符都报成 `stale-commit`（即"一律放行"）的实现
   *   会让臂 1**全绿** —— 它放得比正确实现还宽。
   *   ⇒ 唯一能把两者分开的，是喂它一次**真的**内容不符并要求它**抛**。
   */
  const { root, put } = gitFixture(t)
  writeGitArtifactStamp(root)
  put('src/index.ts', 'changed without rebuilding')
  assert.throws(() => verifyGitArtifacts(root), /stale or modified/u, '★★★ 内容不符**必须**抛')
  const inspection = inspectGitArtifacts(root)
  assert.equal(inspection.verdict, 'content-differs', '★★ 而裁决必须是 `content-differs`，不许是 `stale-commit`')
  assert.match(inspection.why, /source digest differs/u, '★★★ 它必须说清**哪一半**变了（这里是源摘要）')
  assert.notEqual(inspection.verdict, 'stale-commit', '★★★ 与臂 1 必须**不同形**')

  /** ★★ 反向半边二：**只动 lib/** ⇒ 报的是另一半（"手改了产物"），不许与"改了源"同形。 */
  const second = gitFixture(t)
  writeGitArtifactStamp(second.root)
  second.put('lib/extra.js', 'hand-edited artifact')
  const libInspection = inspectGitArtifacts(second.root)
  assert.equal(libInspection.verdict, 'content-differs', '★ 只动产物也是 `content-differs`')
  assert.match(
    libInspection.why, /build output differs/u,
    '★★ 而它必须说"产物变了而源没变" —— 两个成因的**补救动作不同**（重建 vs 查谁手改了 lib/）',
  )
  assert.notEqual(
    libInspection.why, inspection.why,
    '★★★ 同一种裁决里的两种成因，措辞必须不同形 —— 否则读的人分不出该查哪一半',
  )
})

test('★★ t33 臂 3（三态）：读不到提交 ⇒ `unknown-commit`，**不许**报成 `current`', t => {
  /**
   * ★★ 第四态：`commit` 读不出来（**没有 git 的安装包**）时，
   *   把"我没能核对提交"说成"提交对得上"正是本仓反复记账的那条
   *   （与 `moduleFreshness` 的三态同源）。
   *   ★ 而它**不抛**：一个没有 git 的安装包必须仍然能自检内容摘要，
   *     否则这条检查会在每个非仓库环境里红 —— 而那时人们会去**删掉它**。
   */
  const { root } = gitFixture(t)
  writeGitArtifactStamp(root)
  /** ★ 把 `.git` 挪走 ⇒ `gitCommit` 读不到（模拟"不在仓库里"）。 */
  rmSync(join(root, '.git'), { recursive: true, force: true })
  const inspection = inspectGitArtifacts(root)
  assert.equal(
    inspection.verdict, 'unknown-commit',
    '★★★ 读不到提交 ⇒ `unknown-commit`。★ 与 `current` **不同形**：后者是在断言"提交对得上"',
  )
  assert.notEqual(inspection.verdict, 'current', '★★★ 不许把"没能核对"读成"核对通过"')
  assert.doesNotThrow(() => verifyGitArtifacts(root), '★ 而不抛（没有 git 的环境是正常的）')
})

test('★★ t33 臂 4（可重现）：同一棵树跑两次 ⇒ **同一个裁决**', t => {
  /**
   * ★ 契约原话：「The measurement is reproducible: the same check run twice on
   *   an unchanged tree gives the same verdict」。
   * ★★ 而这条**必须**被直接读出来：一个把"当前时间/进程状态"掺进裁决的实现
   *   （本仓 `with-timeout` 那族的同源形态）会让同一次测量给出两个答案，
   *   而那时"这份读数是关于树的"这句话就不成立了。
   */
  const { root, put, git } = gitFixture(t)
  writeGitArtifactStamp(root)
  put('NOTES.md', 'later'); git('add', '-A'); git('commit', '-qm', 'later')
  const first = inspectGitArtifacts(root)
  const second = inspectGitArtifacts(root)
  assert.deepEqual(second, first, '★★★ 同一棵未变的树，两次核对必须给出**逐字相同**的裁决')
  /** ★ 而它真的走到了那条有意思的分支（不是两边都 `current` 而恰好相等）。 */
  assert.equal(first.verdict, 'stale-commit', '★ 前置：这次核对落在 `stale-commit` 上')
})

test('★★ t33 臂 5：刷新之后 ⇒ 检查**通过且说出来了**（不许沉默）', t => {
  /**
   * ★ 契约原话：「Refresh of the stamp produces a tree where the artifact check
   *   passes, and the check says so rather than staying silent」。
   * ★★ "不沉默"是可断言的：刷新后裁决必须是 `current`，**且**它必须与
   *   `stale-commit`（刷新前）**不同形** —— 否则"刷新好了"与"还是陈旧"
   *   在读数上分不开。
   */
  const { root, put, git } = gitFixture(t)
  writeGitArtifactStamp(root)
  put('NOTES.md', 'later'); git('add', '-A'); git('commit', '-qm', 'later')
  assert.equal(inspectGitArtifacts(root).verdict, 'stale-commit', '★ 前置：刷新前是陈旧的')
  /** ★ 刷新：重新写 stamp（于是它记的是**当前** HEAD）。 */
  writeGitArtifactStamp(root)
  const refreshed = inspectGitArtifacts(root)
  assert.equal(refreshed.verdict, 'current', '★★★ 刷新之后必须是 `current` —— 且它**说得出**自己是 current')
  assert.notEqual(refreshed.verdict, 'stale-commit', '★★ 与刷新前必须不同形')
  assert.equal(refreshed.savedCommit, refreshed.headCommit, '★ 而两者现在是同一条提交')
  assert.doesNotThrow(() => verifyGitArtifacts(root), '★ 刷新之后当然不抛')
})

test('★ t33 臂 6：缺 stamp / 缺产物 各自**自己的**裁决，不许并进"内容不一致"', t => {
  /**
   * ★ 不同成因、**不同补救动作**：
   *   缺 stamp   ⇒ 从没构建过 / stamp 被删了 ⇒ 去 build
   *   缺产物     ⇒ 构建不完整 ⇒ 去看 build 为什么没产出那几个文件
   *   内容不一致 ⇒ 有人改了没重建 / 手改了 lib/
   * ★★ 三者合流会让读的人去查错的东西。
   */
  const missingStamp = gitFixture(t)
  assert.equal(inspectGitArtifacts(missingStamp.root).verdict, 'missing-stamp', '★ 没有 stamp ⇒ 它自己那一态')
  const missingArtifact = gitFixture(t)
  /** ★ 先写 stamp 再删产物 —— 否则报的是"没有 stamp"（那是**上一条**臂的事）。 */
  writeGitArtifactStamp(missingArtifact.root)
  rmSync(join(missingArtifact.root, 'lib/client.js'))
  assert.equal(
    inspectGitArtifacts(missingArtifact.root).verdict, 'missing-artifact',
    '★★ 缺产物 ⇒ `missing-artifact`，**不许**并进 `content-differs`（补救动作不同）',
  )
  /** ★ 而两者都必须**抛**（它们是"真的对不上"，不是假红）。 */
  assert.throws(() => verifyGitArtifacts(missingStamp.root), /Missing Git artifact stamp/u)
  assert.throws(() => verifyGitArtifacts(missingArtifact.root), /Missing Git artifact/u)
})
