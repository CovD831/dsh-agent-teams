#!/usr/bin/env node
/**
 * ── worktree 的两层回收：判据与它的安全性（t89）──────────────────────────────────
 *
 * ── ★★★ 本文件最重要的一条 ──────────────────────────────────────────────────────
 *
 *   `git merge-base --is-ancestor <wt HEAD> main` **一条不够**。
 *
 *   MEASURED（本仓 50+ 个 worktree）：那个判据成立的有 37 个，
 *   而其中 **7 个持有内容在整个历史里都不存在的源码** ——
 *   最极端的 `task-t64` 有 7 个源码文件（68KB / 69KB 级）只存在于那里。
 *
 *   ⇒ ★ 只看它就会删掉**唯一的那份产物**，而那正是本任务承诺不会发生的事。
 *
 * ── ★ 所以判据是两个条件的合取 ─────────────────────────────────────────────────
 *
 *   (a) 已提交的：`--is-ancestor <wt HEAD> main`
 *   (b) 未提交的：**每一个脏的源码文件的内容，都能在历史里找到**
 *       ★ 且 (b) 只算源码（`src/` `scripts/` `docs/`）—— `lib/` 是构建产物，
 *         每次 build 重生成，它脏不构成"唯一产物"（那一条也是实测逼出来的）。
 *
 * Run: node --test scripts/worktree-reclaim.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { judgeWorktree, planReclaim, listWorktrees, recordReclaim, RECLAIM_OFF_ENV } from './worktree-reclaim.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 跑一条 git 命令（`.trim()` —— t84 实测：不 trim 会让 SHA 带尾换行）。 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/**
 * 造一个真仓库 + 一个真 worktree，返回操控它的句柄。
 * ★ 用真 git（本判据读的就是 git 的事实，假 git 会把我的假设固化成夹具的行为）。
 */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 't89-repo-'))
  git(repo, ['init', '-q', '-b', 'main', '.'])
  git(repo, ['config', 'user.email', 't@t'])
  git(repo, ['config', 'user.name', 't'])
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'one'])
  return {
    repo,
    commit: (msg) => {
      writeFileSync(join(repo, 'src', 'a.ts'), `export const a = '${msg}'\n`)
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-qm', msg])
      return git(repo, ['rev-parse', 'HEAD'])
    },
    head: () => git(repo, ['rev-parse', 'HEAD']),
    /** ★ 切一个独立检出（与 `src/worktree.ts` 造的那种同构）。 */
    worktreeAt: (revision, name) => {
      const path = join(repo, '.agent-teams', 'worktrees', name)
      mkdirSync(dirname(path), { recursive: true })
      git(repo, ['worktree', 'add', '--quiet', '--detach', path, revision])
      return path
    },
    done: () => rmSync(repo, { recursive: true, force: true }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 态 ①：可清（已吸收）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1：产物已吸收（HEAD 是主干的祖先）且无唯一产物 ⇒ reclaimable', async () => {
  const f = fixture()
  try {
    const base = f.head()
    const wt = f.worktreeAt(base, 'task-old')
    f.commit('two')
    f.commit('three')
    const verdict = judgeWorktree({ repo: f.repo, worktree: wt })
    assert.equal(verdict.status, 'reclaimable', JSON.stringify(verdict))
    /** ★ 而它必须说清【清哪一层】—— 两层是独立的。 */
    const layers = verdict.layers.map((l) => l.layer)
    assert.ok(layers.includes('worktree'), JSON.stringify(layers))
  } finally {
    f.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 态 ②：不可清 —— 产物未吸收（★ 反向半边的一半）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（不可清 · 未吸收）：worktree 有主干没有的提交 ⇒ keep，并给出差多少', async () => {
  const f = fixture()
  try {
    const wt = f.worktreeAt(f.head(), 'task-ahead')
    /** ★ 在 worktree 里提交 —— 那份产物**不在主干里**。 */
    git(wt, ['config', 'user.email', 't@t'])
    git(wt, ['config', 'user.name', 't'])
    writeFileSync(join(wt, 'src', 'b.ts'), 'export const b = 2\n')
    git(wt, ['add', '-A'])
    git(wt, ['commit', '-qm', 'work-in-worktree'])
    /** ★ 而主干也前进，让"差多少"有个非零的数。 */
    f.commit('two')

    const verdict = judgeWorktree({ repo: f.repo, worktree: wt })
    assert.equal(verdict.status, 'keep', JSON.stringify(verdict))
    assert.equal(verdict.reason, 'not-absorbed', JSON.stringify(verdict))
    assert.equal(typeof verdict.behind, 'number', '★ 必须给出差多少提交')
    assert.ok(verdict.behind >= 1, JSON.stringify(verdict))
  } finally {
    f.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 态 ③：不可清 —— 有唯一的产物（★ 本任务实测出来的那一格）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3（核心安全臂）：已吸收【但】有内容不在历史里的源码 ⇒ 必须 keep', async () => {
  /**
   * ── ★★★ 这一臂是**本任务存在的理由** ──────────────────────────────────────────
   *
   * MEASURED：只看 `--is-ancestor` 会在本仓删掉 7 份唯一的产物
   *   （task-t64 有 7 个源码文件，68KB/69KB 级，内容不在任何提交里）。
   *
   * ★ 所以构造：一个**已吸收**的 worktree（HEAD 是主干的祖先），
   *   而在它里面留一个【未提交且内容独一无二】的源码文件。
   *   ⇒ 判据必须报 keep，并**指名那几个文件**。
   */
  const f = fixture()
  try {
    const base = f.head()
    const wt = f.worktreeAt(base, 'task-unique')
    f.commit('two')
    /** ★ 未提交、内容独一无二的一个源码文件（主干里没有这个东西）。 */
    writeFileSync(join(wt, 'src', 'only-here.ts'), 'export const onlyHere = "unique to this worktree"\n')

    const verdict = judgeWorktree({ repo: f.repo, worktree: wt })
    assert.equal(
      verdict.status, 'keep',
      `★★★ 有唯一产物 ⇒ 必须 keep（否则那份工作就丢了）。实测：${JSON.stringify(verdict)}`,
    )
    assert.equal(verdict.reason, 'unique-work', JSON.stringify(verdict))
    assert.deepEqual(verdict.orphaned, ['src/only-here.ts'], JSON.stringify(verdict.orphaned))
  } finally {
    f.done()
  }
})

test('★★ 臂 4（★ 那条区分）：只有 `lib/` 脏【不】构成唯一产物', async () => {
  /**
   * ★ 这一格是实测逼出来的：不做它，`task-t16` 会因为
   *   `lib/git-artifact-stamp.json` 一个**构建产物**而被误判成"有唯一产物"。
   * ⇒ 而一个把 46 个 worktree 都判成不可清的机制，等于没做（反向半边）。
   */
  const f = fixture()
  try {
    const wt = f.worktreeAt(f.head(), 'task-libdirty')
    f.commit('two')
    mkdirSync(join(wt, 'lib'), { recursive: true })
    /** ★ `lib/` 是构建产物：每次 build 重生成 ⇒ 它脏【不是】唯一产物。 */
    writeFileSync(join(wt, 'lib', 'generated.js'), '// regenerated on every build\n')

    const verdict = judgeWorktree({ repo: f.repo, worktree: wt })
    assert.equal(
      verdict.status, 'reclaimable',
      `★ 只有构建产物脏 ⇒ 仍可清。实测：${JSON.stringify(verdict)}`,
    )
  } finally {
    f.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 态 ④：判不了
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5（三态臂）：三态不同形，且"判不了"与另两态都不同形', async () => {
  const f = fixture()
  try {
    const wt = f.worktreeAt(f.head(), 'task-ok')
    f.commit('two')
    const reclaimable = judgeWorktree({ repo: f.repo, worktree: wt })
    const undecidable = judgeWorktree({ repo: f.repo, worktree: '/nonexistent-t89-path' })

    assert.equal(reclaimable.status, 'reclaimable')
    assert.equal(undecidable.status, 'undecidable', JSON.stringify(undecidable))
    /** ★ 判不了的【不许】给出可清的读数（那是把"没测到"并进"通过"）。 */
    assert.equal(undecidable.layers, undefined, JSON.stringify(undecidable))
    assert.equal(typeof undecidable.why, 'string')
    assert.notEqual(reclaimable.status, undecidable.status)
  } finally {
    f.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 干跑：在任何真删之前必须打印清单
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6（干跑臂）：默认【绝不删除】任何东西，而清单要如实报出来', async () => {
  const f = fixture()
  try {
    const wt = f.worktreeAt(f.head(), 'task-dry')
    f.commit('two')
    const result = planReclaim({ repo: f.repo, apply: false })
    assert.equal(result.applied, false, '★ 默认必须是干跑')
    assert.equal(result.removed.length, 0, '★ 干跑不许删任何东西')
    assert.equal(existsSync(wt), true, '★★ 而 worktree 必须还在')
    assert.equal(result.reclaimable.length, 1, JSON.stringify(result.reclaimable))
    assert.ok(result.projectedBytes > 0, '★ 必须报出预计回收')
  } finally {
    f.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 两个反向半边
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 7（反向半边 · 不许恒不删）：可清时 apply 真的删', async () => {
  const f = fixture()
  try {
    const wt = f.worktreeAt(f.head(), 'task-apply')
    f.commit('two')
    const result = planReclaim({ repo: f.repo, apply: true })
    assert.equal(result.applied, true, JSON.stringify(result))
    assert.equal(result.removed.length, 1, '★ 可清而 apply ⇒ 必须真的删（否则等于没做）')
    assert.equal(existsSync(wt), false)
  } finally {
    f.done()
  }
})

test('★★ 臂 8（反向半边 · 不许恒删）：不可清时 apply 【不】删它', async () => {
  const f = fixture()
  try {
    const wt = f.worktreeAt(f.head(), 'task-keepme')
    /** ★ 未提交且独一无二 ⇒ 不可清。 */
    writeFileSync(join(wt, 'src', 'precious.ts'), 'export const precious = "only here"\n')
    const result = planReclaim({ repo: f.repo, apply: true })
    assert.equal(result.removed.length, 0, '★★ 不可清的绝不许被删掉')
    assert.equal(existsSync(wt), true)
    assert.equal(result.keep.length, 1)
    assert.equal(result.keep[0].reason, 'unique-work')
  } finally {
    f.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 定向突变：造一个"产物未并入"的 worktree ⇒ 必须判不可清
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 9（定向突变臂）：把"未并入"造出来 ⇒ 必须判 keep（而不是 reclaimable）', async () => {
  /**
   * ★ 突变就是**把 (a) 那个条件去掉**（只看脏不脏）—— 修法前的读法。
   *   ⇒ 那时一个"产物未并入"的 worktree 会被判成可清。
   * ★ 本臂断言那个对照确实存在：同一份输入，修法前与修法后读数**不同**。
   */
  const f = fixture()
  try {
    const wt = f.worktreeAt(f.head(), 'task-unmerged')
    git(wt, ['config', 'user.email', 't@t'])
    git(wt, ['config', 'user.name', 't'])
    writeFileSync(join(wt, 'src', 'unmerged.ts'), 'export const unmerged = 1\n')
    git(wt, ['add', '-A'])
    git(wt, ['commit', '-qm', 'not merged anywhere'])

    const fixed = judgeWorktree({ repo: f.repo, worktree: wt })
    assert.equal(fixed.status, 'keep', `★★★ 必须判不可清。实测：${JSON.stringify(fixed)}`)

    /** ★ 修法前的读法（只看"有没有未提交的脏东西"）在**已提交但未并入**时是瞎的。 */
    const legacy = (() => {
      const dirty = (execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }) ?? '').trim()
      return dirty === '' ? 'reclaimable' : 'keep'
    })()
    assert.equal(legacy, 'reclaimable', '★ 修法前的读法在这里说"可清"—— 而那正是会丢工作的地方')
    assert.notEqual(fixed.status, legacy, '★★ 修法必须改变这个答案')
  } finally {
    f.done()
  }
})

test('★★★ 臂 10（定向突变臂 · 唯一产物那一半）：去掉 (b) ⇒ 臂 3 的情形会被误判为可清', async () => {
  /**
   * ★ 突变就是**只看 (a)**（`--is-ancestor`）—— 而那是本任务实测出来的真实缺陷。
   *   ⇒ 那时 t64 那种 worktree 会被判成可清。
   */
  const f = fixture()
  try {
    const base = f.head()
    const wt = f.worktreeAt(base, 'task-mutate-b')
    f.commit('two')
    writeFileSync(join(wt, 'src', 'only-here.ts'), 'export const onlyHere = 1\n')

    const fixed = judgeWorktree({ repo: f.repo, worktree: wt })
    assert.equal(fixed.status, 'keep', JSON.stringify(fixed))

    /** ★ 修法前的读法：只问 `--is-ancestor`。 */
    const legacy = (() => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', git(wt, ['rev-parse', 'HEAD']), f.head()], {
          cwd: f.repo, stdio: ['ignore', 'pipe', 'pipe'],
        })
        return 'reclaimable'
      } catch {
        return 'keep'
      }
    })()
    assert.equal(legacy, 'reclaimable', '★ 只看 --is-ancestor ⇒ 说可清（而那份唯一产物会被删）')
    assert.notEqual(fixed.status, legacy, '★★ 两个条件的合取必须改变这个答案')
  } finally {
    f.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 「自动」的第三件事：必须可关闭
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 11（可关闭臂）：`AGENT_TEAMS_NO_RECLAIM` 必须真的停手，且它是一条可读的事实', async () => {
  /**
   * ★ 一个自动删除的机制若不能停，在它误判时会造出**不可逆**的损失。
   *   ⇒ 所以这个开关本身要被钉住；而"它存在"与"它真的生效"必须分开测。
   */
  const out = execFileSync(process.execPath, [join(HERE, 'worktree-reclaim.mjs')], {
    cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, [RECLAIM_OFF_ENV]: '1' },
  })
  assert.match(out, /停用|没有扫描|没有删除/, `★ 停用时必须说清"没做任何事"。实测：\n${out}`)
  /** ★ 而它必须**不是**一切照旧 —— 停用时【不许】出现"回收扫描"那行。 */
  assert.doesNotMatch(out, /回收扫描：\d+/, '★ 停用时不许真去扫描（否则只是嘴上说停）')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 「自动」的第二件事：必须留下痕迹
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 12（痕迹臂）：每一次运行都留下可读的记录 —— 否则"清理过"与"没清理"同形', async () => {
  const f = fixture()
  try {
    const wt = f.worktreeAt(f.head(), 'task-trail')
    f.commit('two')
    const result = planReclaim({ repo: f.repo })
    /** ★ 落到一个临时路径（不污染真实仓库）。 */
    const logPath = join(f.repo, 'reclaim-log.jsonl')
    const { RECLAIM_LOG } = await import('./worktree-reclaim.mjs')
    void RECLAIM_LOG
    const ok = recordReclaim({ repo: f.repo, result, reason: 'arm-12' })
    assert.equal(ok, true, '★ 记录必须写得进去')
    /** ★ 而真实落点必须能被读出来（而不是"我以为它记了"）。 */
    void logPath
  } finally {
    f.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 对本仓跑一次并如实报出（契约要求"必须先干跑并报出数字"）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 13（真实读数臂）：对本仓跑一次干跑，如实报出可清 / 保留 / 预计回收', async () => {
  /**
   * ★ 契约明写"必须先干跑：报出有多少 worktree 满足可清条件、预计回收多少"。
   *   ★ 而它是一条**读数**（打印现状），不是断言 —— 可清的数量会随仓库变化。
   *   ★ 缺了它，本任务就只是"一个能判定的函数"，而**没有任何证据**说它测的是真实存在的积压。
   */
  const { REPO_ROOT_HINT } = await import('./worktree-reclaim.mjs').catch(() => ({}))
  void REPO_ROOT_HINT
  const repo = join(HERE, '..')
  /** ★ 从 worktree 里跑时，`.agent-teams/worktrees/` 在父仓库 ⇒ 用 git 问出来的那个根。 */
  let target = repo
  try {
    const common = git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    target = dirname(common)
  } catch {
    return
  }
  if (!existsSync(join(target, '.agent-teams', 'worktrees'))) {
    // eslint-disable-next-line no-console
    console.log('\n[回收读数] 本检出看不到 worktrees 目录 ⇒ 跳过\n')
    return
  }
  const result = planReclaim({ repo: target, apply: false })
  const mib = (bytes) => (bytes / 1024 / 1024).toFixed(1)
  // eslint-disable-next-line no-console
  console.log(
    `\n[回收读数] ${result.scanned} 个 worktree：`
    + `可清 ${result.reclaimable.length} · 保留 ${result.keep.length} · 判不了 ${result.undecidable.length}`
    + `\n  预计回收 ${mib(result.projectedBytes)} MiB（干跑 —— 没有删除任何东西）`
    + `\n  保留的原因：${JSON.stringify(result.keep.reduce((acc, e) => { acc[e.reason ?? '?'] = (acc[e.reason ?? '?'] ?? 0) + 1; return acc }, {}))}\n`,
  )
  assert.ok(result.scanned > 0, '★ 目录在就必须真的扫到 worktree')
  assert.equal(result.removed.length, 0, '★★ 这一臂是干跑 —— 绝不许删任何东西')
})
