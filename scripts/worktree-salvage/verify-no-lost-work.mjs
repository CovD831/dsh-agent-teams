/**
 * 安全核查：**删掉的那些树，工作丢了吗？**
 *
 * ── 这个脚本存在的理由：我为这条问题写过两版错判据，都记在这里 ─────────────────
 *
 * 【第一版错判据】「补丁能被 `git apply --numstat` 解析 + `grep -c '^diff --git'` > 0」
 *   → t2/t3 的假补丁**通过了**。对一棵**零改动**的树跑 `git format-patch -1 HEAD`，
 *     打出来的是它 HEAD 那个提交（别人的 `ad5be83`），非空、可解析、毫无价值。
 *   ★ 教训：**「补丁非空」≠「这棵树有未合流的产出」。**
 *
 * 【第二版错判据】「补丁的 `From <sha>` 不在集成分支里 ⇒ 真产物」
 *   → 反了。一棵被判 `reclaimable` 的树，其产物**按定义已经进主干**，
 *     于是它的补丁 sha **必然**是集成分支的祖先。用这条量，会把
 *     `task(t1): worktree deliverable` 这种**真交付**误判成假产物（我确实误报过 4 个）。
 *   ★ 教训：**一条对目标群体恒真的量，不是判据。**
 *
 * 【本脚本用的量】直接回答安全那一半，不问补丁：**承载工作的是提交对象，不是文件。**
 *   对每一棵（已删的或还在的）树的 HEAD 提交，逐个「非派生」文件问：
 *   这个 blob 在集成分支历史里存在吗？
 *     - 全都在 ⇒ 工作已合流 ⇒ 删掉**没有丢任何东西**（这才是安全的那一半）
 *     - 有缺席 ⇒ 该树有真未合流内容 ⇒ 它必须还活着，且有补丁
 *   ★ 为什么排除 `lib/` 与 stamp：它们是 build 产物，由源码重建；
 *     收它们等于要求一条永远不能满足的条件（src/worktree.ts:1445-1450 记过同形缺陷）。
 *
 * 【反向半边】拿 t2/t3 那种「零改动树」的形态喂进来，本判据必须能**指出它没有自有工作** ——
 *   见脚本末尾的 `--self-test` 那一节。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'

const DIR = '.agent-teams/worktree-salvage'
const INTEGRATION = 'task-mutation-integrate'
const WORKTREES = '.agent-teams/worktrees'
const isBuildProduct = (f) => f.startsWith('lib/') || f.endsWith('git-artifact-stamp.json')

const git = (args, cwd = '.') => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch { return null }
}

/** 这个提交里，有哪些「非派生」文件的 blob 在集成分支历史里找不到？ */
function unmergedFiles(commit) {
  if (git(['cat-file', '-e', `${commit}^{commit}`]) === null) return null // 对象不可达
  const files = (git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]) ?? '')
    .split('\n').filter(Boolean).filter((f) => !isBuildProduct(f))
  const missing = []
  for (const f of files) {
    const blob = git(['rev-parse', `${commit}:${f}`])
    if (blob === null) continue
    const hit = git(['log', INTEGRATION, '--oneline', `--find-object=${blob}`])
    if (hit === null || hit === '') missing.push(f)
  }
  return missing
}

const alive = new Set(existsSync(WORKTREES) ? readdirSync(WORKTREES) : [])
const patches = readdirSync(DIR).filter((f) => f.endsWith('.patch')).sort()

let lostWork = 0
console.log('树（按补丁索引）                          状态    未合流的非派生文件')
console.log('─'.repeat(92))
for (const p of patches) {
  const name = p.replace(/\.patch$/, '')
  const commit = (git(['apply', '--summary', `${DIR}/${p}`]) === null ? '' : '') // 不用于判断
  void commit
  const sha = execFileSync('bash', ['-c', `grep -m1 '^From ' ${JSON.stringify(`${DIR}/${p}`)}`], { encoding: 'utf8' })
    .trim().split(/\s+/)[1]
  const missing = unmergedFiles(sha)
  const present = alive.has(name)
  const state = present ? '还在' : '已删'

  if (missing === null) {
    console.log(`${name.padEnd(42)}${state.padEnd(8)}⚪ 提交对象不可达，无法核`)
    continue
  }
  // ★ 安全判据：已删的树必须「无未合流内容」；否则就是丢了工作
  const verdict = missing.length === 0
    ? '✔ 全部已合流'
    : `${present ? '◻ 有未合流内容（树还在，另有补丁）' : '★ 有未合流内容（树已删！）'}: ${missing.join(', ')}`
  if (missing.length > 0 && !present) lostWork += 1
  console.log(`${name.padEnd(42)}${state.padEnd(8)}${verdict}`)
}

console.log('')
if (lostWork === 0) {
  console.log(`✔ 安全判据成立：所有**已删**的树，其非派生内容全部已在集成分支里 ⇒ 没有丢工作。`)
} else {
  console.log(`★★ ${lostWork} 棵已删的树有未合流内容 —— 那是真丢失，必须从补丁恢复。`)
}

/* ── ★★ 反向半边：判据在「该报未合流」的时候真的会报吗？ ─────────────────────────
 *
 * 为什么必须有这一半：一条**恒答「已合流」**的判据，会让上面那张表全绿，
 * 于是"没丢工作"这个结论**不费吹灰之力就成立** —— 而它其实什么都没测。
 *
 * 这里造两个**合成**样本（不碰真仓库，用 mktemp git 仓）：
 *   臂 A（该报）：一个不在集成分支里的提交，改一个新文件 ⇒ 判据必须报「未合流」
 *   臂 B（不该报）：一个**已在**集成分支里的提交 ⇒ 判据必须报「已合流」
 * 两条一起才说明这条量有分辨力。
 */
if (process.argv.includes('--self-test')) {
  console.log('\n── 反向半边自测：同一判据必须**两条臂给出不同答案** ──')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const scratch = mkdtempSync(join(tmpdir(), 'nolost-selftest-'))
  const g = (args) => execFileSync('git', args, { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let armA, armB
  try {
    g(['init', '-q', '-b', 'integration', '.'])
    g(['config', 'user.email', 'x@x']); g(['config', 'user.name', 'x'])
    writeFileSync(join(scratch, 'base.txt'), 'base\n')
    g(['add', '.']); g(['commit', '-qm', 'base'])
    const baseSha = g(['rev-parse', 'HEAD'])

    /**
     * ★ 第一版自测**假绿**的原因（已修）：它拿 `work` 分支当「集成分支」，
     *   而 novel 提交就在 `work` 上 ⇒ `git log work --find-object` 当然找得到 ⇒ 臂 A 漏报。
     *   这是"对照组其实在实验组里"的同一类错误。
     *   正确形状：新工作在**侧分支**上，集成分支停在 base，两者分开。
     */
    g(['checkout', '-q', '-b', 'side'])
    writeFileSync(join(scratch, 'novel.ts'), 'export const x = 1\n')
    g(['add', '.']); g(['commit', '-qm', 'novel work'])
    const novelSha = g(['rev-parse', 'HEAD'])
    g(['checkout', '-q', 'integration']) // ★ 回到集成分支（新提交不在其上）

    // 臂 A：侧分支上的提交 ⇒ 内容尚未进入 integration ⇒ 必须报未合流
    armA = unmergedFilesIn(scratch, novelSha, 'integration')
    // 臂 B：base 提交本身 ⇒ 内容已在 integration 上 ⇒ 必须判为已合流
    armB = unmergedFilesIn(scratch, baseSha, 'integration')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  const aCatches = armA !== null && armA.includes('novel.ts')
  const bClears = armB !== null && armB.length === 0
  console.log(`  臂 A（该报未合流）: ${aCatches ? '✔ 报出了 novel.ts' : `✘ 漏报（得到 ${JSON.stringify(armA)}）`}`)
  console.log(`  臂 B（不该报）    : ${bClears ? '✔ 判为已合流' : `✘ 误报（得到 ${JSON.stringify(armB)}）`}`)
  console.log(aCatches && bClears
    ? '  ⇒ 判据有分辨力：既能报出未合流，也不会对已合流的瞎报。'
    : '  ★ 判据没有分辨力 —— 上面那张全绿的表不成立。')
  if (!(aCatches && bClears)) process.exitCode = 1
}

/** 与 `unmergedFiles` 同一条量，但作用于任意仓库与被比较的 ref（自测用）。 */
function unmergedFilesIn(cwd, commit, compareRef) {
  try {
    if (git(['cat-file', '-e', `${commit}^{commit}`], cwd) === null) return null
    const files = (git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit], cwd) ?? '')
      .split('\n').filter(Boolean).filter((f) => !isBuildProduct(f))
    const missing = []
    for (const f of files) {
      const blob = git(['rev-parse', `${commit}:${f}`], cwd)
      if (blob === null) continue
      const hit = git(['log', compareRef, '--oneline', `--find-object=${blob}`], cwd)
      if (hit === null || hit === '') missing.push(f)
    }
    return missing
  } catch { return null }
}

/**
 * ★ 这里原来是 `process.exit(lostWork === 0 ? 0 : 1)` —— 一个**把失败吞掉的 bug**：
 *   自测那一段已经设了 `process.exitCode = 1`，而这一行**无条件**调 `process.exit(0)`，
 *   把前面设的退出码覆盖掉。于是「自测变红」在 shell 里看起来是**通过**（EXIT=0）。
 *   ★ 同族的教训本仓记过：**通过/失败必须由被测进程的退出码说话，不能靠人读日志**。
 *   现在：只在 lostWork>0 时才强制失败，否则保留已经设好的 exitCode。
 */
if (lostWork > 0) process.exitCode = 1
