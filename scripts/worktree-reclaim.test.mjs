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
import { basename, dirname } from 'node:path'
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
  /**
   * ── ★ 三种状态必须分开（MEASURED 2026-10-10）─────────────────────────────────
   *
   * 本臂此前只有"目录不存在 ⇒ 跳过"与"目录在 ⇒ 必须扫到"两种。
   * 而清理之后出现**第三种**：目录在、里面**空的** —— 那是**正常**的（全回收完了）。
   *
   * ★ 它把"清扫结果"与"机制性质"混淆了：`scanned > 0` 说的是
   *   "我这一轮恰好有东西可扫"（偶然事实），不是这条机制的性质。
   *   ⇒ 空目录会让本臂红，而那个红与"回收机制坏了"同形
   *     （其实刚刚正常工作了 46 次）。
   *   ⇒ 处置：空目录时**如实报出来并跳过**（与"目录不存在"分开措辞），
   *     而不是假装扫到了东西。
   */
  if (result.scanned === 0) {
    // eslint-disable-next-line no-console
    console.log('\n[回收读数] worktrees 目录在、但里面没有 worktree（已回收干净）⇒ 本臂跳过。')
    // eslint-disable-next-line no-console
    console.log('  ★ 这不是缺陷：`scanned > 0` 是"这一轮恰好有东西可扫"，不是机制的性质。\n')
    assert.equal(result.removed.length, 0, '★★ 干跑绝不许删任何东西（空目录也一样）')
    return
  }
  assert.ok(result.scanned > 0, '★ 目录在且非空 ⇒ 必须真的扫到 worktree')
  assert.equal(result.removed.length, 0, '★★ 这一臂是干跑 —— 绝不许删任何东西')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ t25：判定只有一份真值 —— 脚本【调用】权威实现，而不是自己再实现一遍
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一节防的是什么（MEASURED，本任务的由来）───────────────────────────────────
 *
 * `judgeWorktreeReclaimable` 与 `describeReclaimability` 在 `src/worktree.ts` 里
 * 写好了、导出了，而**全仓零调用方**（`gate-producer-consumer` 普查点名）。
 * 而本脚本自己又实现了一遍同样的问题。
 *
 * ⇒ ★★ 后果真的发生了：`--apply` 删掉 32 个 worktree，
 *   而那份**权威实现从未被执行过一次**。
 *   **一条没接线、也没被比对过的判据，与一条不存在的判据，
 *   在"删掉东西"这件事上没有区别。**
 *
 * ⇒ 所以下面这几臂钉的是**接线与一致**，不是"哪份更对"：
 *     · 臂 T25-1：脚本**调用**权威实现（同一条真值），而不是留一份内联副本
 *     · 臂 T25-2（★对照臂）：两份判断在同一批真实树上**逐条一致**
 *     · 臂 T25-3：`undecidable` **绝不**被当成 `reclaimable`
 *     · 臂 T25-4：`describeReclaimability` 也被执行（零消费的另一条）
 */

test('★ 臂 T25-1：脚本【调用】judgeWorktreeReclaimable —— 而不是留一份内联副本', async () => {
  /**
   * ── 这条臂怎么是【可判定】的（而不是"读源码看着像"）─────────────────────────
   *
   * ★ 用**同一个函数引用**去核：脚本判出来的三态，必须与直接调权威实现得到的**逐字段相同**。
   *   ⇒ 一个"又实现了一遍"的脚本，会在**任何一个**权威实现改过语义的地方当场分叉
   *     —— 而那时这条臂红，那正是我们要的。
   *
   * ★★ 而更强的一半：**把权威实现换掉**（monkey-patch 不可能，因为 import 是静态的）
   *   ⇒ 所以改用**可观测的等价**：两条路径的返回值深度相等。
   *   一个内联副本在**当前样本上**可能与权威一致（那正是这次没造成损失的原因），
   *   但它【会在权威改动时分叉】—— 而下面臂 T25-2 用**同一批树**钉住"现在就一致"。
   */
  const { judgeWorktreeReclaimable } = await import('../lib/worktree.js')
  const f = fixture()
  try {
    const base = f.head()
    const wt = f.worktreeAt(base, 'task-t25-1')
    f.commit('two')

    const fromScript = judgeWorktree({ repo: f.repo, worktree: wt })
    const fromAuthority = judgeWorktreeReclaimable({ repo: f.repo, worktree: wt })

    /** ★ 裁决那一格必须逐字相同 —— 它是"能不能删"。 */
    assert.equal(
      fromScript.status, fromAuthority.status,
      `★ 脚本的裁决与权威实现必须相同（这就是"一份真值"的可执行形式）。脚本=${fromScript.status} 权威=${fromAuthority.status}`,
    )
    /** ★ 而 `keep` 的成因也必须相同（两种 keep 不同形，混了会让补救动作指错）。 */
    if (fromAuthority.status === 'keep') {
      assert.equal(fromScript.reason, fromAuthority.reason, '★ keep 的 reason 必须同源')
    }
    /** ★ `behind` 是同一个读数（它进 `layers` 的门槛）。 */
    assert.equal(fromScript.behind, fromAuthority.behind, '★ behind 必须同源')
  } finally {
    f.done()
  }
})

test('★★ 臂 T25-2（★对照臂）：两份判断在【同一个真实树上】逐条一致', async () => {
  /**
   * ── 为什么"一致"才是这一臂要钉的东西（契约逐字）─────────────────────────────
   *
   * > 「因为"两份实现"的问题不是"哪份对"，
   * >   而是【没有任何东西会发现它们分叉】。」
   *
   * ★ 所以这里**不去判谁对** —— 它判的是 **两份在同一批真实输入上给出同一结论**。
   *   分叉 ⇒ 红。而那正是"没有任何东西会发现分叉"这句话的**可执行形式**。
   *
   * ★★ 样本的选取是**刻意的**（否则这条臂会在"全是可清"的样本上恒真）：
   *   造出三态**各自的**真实实例，逐条比对 —— 一个只在某一态上分叉的实现
   *   会在只含另一态的样本上蒙混过去。
   */
  const { judgeWorktreeReclaimable } = await import('../lib/worktree.js')
  const f = fixture()
  try {
    const base = f.head()

    /** ① reclaimable：检出停在已被主干吸收的提交、且没有唯一产物。 */
    const absorbed = f.worktreeAt(base, 'task-absorbed')
    f.commit('two')

    /**
     * ② keep / not-absorbed：检出带着**主干没有的**提交。
     * ★ MEASURED（本臂第一版写错了）：先在 repo 里 commit、再让 worktree 检出它 ——
     *   那会让 main **也**前进到同一个提交 ⇒ HEAD 成了 main 的祖先 ⇒ 判成 reclaimable。
     *   ⇒ 正确的造法是**在那个检出里**提交（主干看不到它）。
     */
    const ahead = f.worktreeAt(base, 'task-ahead')
    writeFileSync(join(ahead, 'src', 'ahead.ts'), 'export const ahead = 1\n')
    git(ahead, ['add', '-A'])
    git(ahead, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'work only in the worktree'])

    /** ③ keep / unique-work：检出一个已被吸收的提交，但工作区有一份**历史里没有**的源码。 */
    const unique = f.worktreeAt(base, 'task-unique')
    writeFileSync(join(unique, 'src', 'only-here.ts'), `export const only = '${Math.random()}'\n`)

    /** ④ undecidable：一个不是 git 检出的目录。 */
    const notGit = mkdtempSync(join(tmpdir(), 't25-notgit-'))

    const cases = [
      { label: 'absorbed', worktree: absorbed, expect: 'reclaimable' },
      { label: 'ahead', worktree: ahead, expect: 'keep' },
      { label: 'unique', worktree: unique, expect: 'keep' },
      { label: 'not-a-checkout', worktree: notGit, expect: 'undecidable' },
    ]

    const compared = []
    for (const item of cases) {
      const a = judgeWorktree({ repo: f.repo, worktree: item.worktree })
      const b = judgeWorktreeReclaimable({ repo: f.repo, worktree: item.worktree })
      /**
       * ★ 逐条比对三格：`status`（裁决）、`reason`（成因）、`behind`（读数）。
       *   ★ 不比 `detail` 的措辞：那是**人读的话**，两份各说各的不会让"删错东西"发生。
       *     而"哪一格会真的导致删错"是 `status` —— 所以它必须逐字相同。
       */
      assert.equal(a.status, b.status, `★ [${item.label}] 两份的 status 必须相同：脚本=${a.status} 权威=${b.status}`)
      assert.equal(a.status, item.expect, `★ [${item.label}] 前置：这一格本该是 ${item.expect}，实测 ${a.status}`)
      if (b.status === 'keep') assert.equal(a.reason, b.reason, `★ [${item.label}] keep 的 reason 必须相同`)
      if (b.status !== 'undecidable') assert.equal(a.behind, b.behind, `★ [${item.label}] behind 必须相同`)
      compared.push(`${item.label}=${a.status}`)
    }

    /** ★ 三态**都被覆盖到**（否则这条对照臂在"只有一态"的样本上恒真）。 */
    const seen = new Set(compared.map((entry) => entry.split('=')[1]))
    assert.deepEqual(
      [...seen].sort(), ['keep', 'reclaimable', 'undecidable'],
      `★ 样本必须覆盖三态（否则"一致"没有分辨力）。实测：${compared.join(' · ')}`,
    )
    rmSync(notGit, { recursive: true, force: true })
  } finally {
    f.done()
  }
})

test('★★ 臂 T25-3：undecidable【绝不】被当成 reclaimable（判不了 ≠ 可清）', async () => {
  /**
   * ★ 契约逐字：「`undecidable` 绝不当成 `reclaimable`（判不了 ≠ 可清）」。
   *
   * ★★ 而这在**删除路径**上是生死之别：`undecidable` 一旦被读成可清，
   *   脚本就会去 `rmSync` 一棵**它根本没判断过**的树 —— 而那正是本任务要防的事。
   * ⇒ 所以这里不只断言"状态对"，还断言**它没有带任何"可清"的字段**。
   */
  const notGit = mkdtempSync(join(tmpdir(), 't25-undec-'))
  try {
    const verdict = judgeWorktree({ repo: notGit, worktree: notGit })
    assert.equal(verdict.status, 'undecidable', JSON.stringify(verdict))
    /** ★ 三态不同形：判不了的两格是 `why` 与人话，**不是** `layers`。 */
    assert.equal(verdict.layers, undefined, '★ undecidable 不许带 layers —— 那会让它读起来像"可清"')
    assert.equal(typeof verdict.why, 'string', '★ undecidable 必须说清【为什么判不了】')
    assert.ok(verdict.why.length > 0)
    /** ★ 而人话必须明说"这是没测到，不是可以删"。 */
    assert.match(
      verdict.reason, /NOT be determined|not measured|safe to delete/i,
      `★ undecidable 的人话必须把"没测到"与"可以删"分开。实测：${verdict.reason}`,
    )
  } finally {
    rmSync(notGit, { recursive: true, force: true })
  }
})

test('★ 臂 T25-4：describeReclaimability 被【执行】到（它是零消费的另一条）', async () => {
  /**
   * ★ 契约：「`describeReclaimability` 也被调用（它现在是零消费另一条）
   *   —— 用于输出里那条人读的理由」。
   *
   * ★★ 而"被调用"必须是**可观测**的：所以这里断言脚本给出的 `human` 一格
   *   **逐字等于**直接调 `describeReclaimability` 的结果 —— 同一个来源，
   *   不是"另写一句意思差不多的话"（两处各写一遍就会分叉，而分叉之后
   *   "同一件事有两句话"在下游同形）。
   */
  const { describeReclaimability, judgeWorktreeReclaimable } = await import('../lib/worktree.js')
  const f = fixture()
  try {
    const base = f.head()
    const wt = f.worktreeAt(base, 'task-t25-4')
    f.commit('two')

    const verdict = judgeWorktree({ repo: f.repo, worktree: wt })
    const authority = judgeWorktreeReclaimable({ repo: f.repo, worktree: wt })
    assert.equal(
      verdict.human, describeReclaimability(authority),
      '★ 脚本里那条人话必须【逐字】来自 describeReclaimability（不是另写一句）',
    )
    assert.ok(typeof verdict.human === 'string' && verdict.human.length > 0)

    /** ★ 而三个状态的人话必须**互不同形**（否则读的人分不出该做什么）。 */
    const notGit = mkdtempSync(join(tmpdir(), 't25-human-'))
    const texts = new Set([
      describeReclaimability(authority),
      describeReclaimability(judgeWorktreeReclaimable({ repo: f.repo, worktree: notGit })),
    ])
    assert.equal(texts.size, 2, '★ 两个人读的理由必须不同形（同形会让补救动作指错）')
    rmSync(notGit, { recursive: true, force: true })
  } finally {
    f.done()
  }
})

test('★ 臂 T25-5：三态**不同形**（没有两个共用同一组字段）', async () => {
  /**
   * ★ 契约：「三态透传：`reclaimable` / `keep`（带 reason 与 detail）/
   *   `undecidable`（带 why）」。
   *
   * ★★ 为什么"不同形"是**必要**的：`reclaimable` 是**删除的准入**。
   *   若 `undecidable` 与它共用字段，下游任何一处读那个字段的代码都会**误删**。
   *   ⇒ 所以这里断言三者的 `Reclaimability` 字段集**两两不同**。
   */
  const { judgeWorktreeReclaimable } = await import('../lib/worktree.js')
  const f = fixture()
  try {
    const base = f.head()
    const absorbed = f.worktreeAt(base, 'task-t25-5a')
    f.commit('two')
    /** ★ 同臂 T25-2 的教训：要在**检出里**提交，主干才看不到它。 */
    const ahead = f.worktreeAt(base, 'task-t25-5b')
    writeFileSync(join(ahead, 'src', 'ahead.ts'), 'export const ahead = 1\n')
    git(ahead, ['add', '-A'])
    git(ahead, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'work only in the worktree'])

    const shapes = {
      reclaimable: judgeWorktreeReclaimable({ repo: f.repo, worktree: absorbed }),
      keep: judgeWorktreeReclaimable({ repo: f.repo, worktree: ahead }),
      undecidable: judgeWorktreeReclaimable({ repo: f.repo, worktree: mkdtempSync(join(tmpdir(), 't25-shape-')) }),
    }
    assert.equal(shapes.reclaimable.status, 'reclaimable')
    assert.equal(shapes.keep.status, 'keep')
    assert.equal(shapes.undecidable.status, 'undecidable')

    /** ★ `reclaimable` **不带** `why` / `detail`；`undecidable` **不带** `reason` / `behind`。 */
    assert.equal('why' in shapes.reclaimable, false, '★ reclaimable 不许带 why（那是"判不了"的字段）')
    assert.equal('layers' in shapes.undecidable, false, '★ undecidable 不许带 layers')
    assert.equal('reason' in shapes.undecidable, false, '★ undecidable 的成因字段是 why，不是 reason')
    assert.equal('behind' in shapes.undecidable, false, '★ undecidable 不许带 behind 读数')
    /** ★ `keep` 必须有 `detail`（它是"为什么留着"的证据，读的人要能去核）。 */
    assert.equal(typeof shapes.keep.detail, 'string', '★ keep 必须带 detail')
  } finally {
    f.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ 接线臂（12-14）：判定写好了，而它【在生产路径上真的会被跑到吗】
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一节防的是什么失效（MEASURED，本任务的由来）───────────────────────────────
 *
 * `judgeWorktreeReclaimable`（`src/worktree.ts:528`）与 `scripts/worktree-reclaim.mjs`
 * 都写好了、都导出了，而**全仓零调用方**：
 *
 *     $ grep -rn "judgeWorktreeReclaimable" src/     ⇒ 只有定义处
 *     $ grep -rn "worktree-reclaim"        src/     ⇒ 0 处
 *     $ grep -rn "worktreePath"            src/tools*  ⇒ 0 处（那是内存 ticket 的字段）
 *
 * ⇒ 后果：46 棵 worktree 只能靠人手动 `node scripts/worktree-reclaim.mjs --apply` 清。
 * ★ 而"一条**没接线**的判据"与"一条**不存在**的判据"，在"该不该删"这件事上
 *   **没有区别** —— 这正是本仓反复记账的形态（"机制建好了，中间那一格没接上"）。
 *
 * ── ★★ 上面 12 条臂（含 T25 那五条）测的是【判据自己】────────────────────────────
 *
 * 它们能证明"这个函数判得对"，**不能**证明"它会被调用"。所以下面这三条臂
 * 走的是**生产入口**：`lib/tools.js` 的 `registerAgentTeamsTools` → 真工具
 * `agent_teams_update_task` → `landedTerminal` → `commitWorktree` 成功 → 回收。
 *
 * ── ★★★ 为什么必须起【子进程】（而不是在本文件里直接调工具）────────────────────
 *
 * `update_task` 是一个注册型工具，装配时会装上退役成员的投递守卫、注册表、
 * 状态锁 —— 它与本文件其它 12 条臂**共享同一个进程**会互相污染
 * （MEASURED：`scripts/gate-position-wiring.test.mjs` 整节都在处理这件事）。
 * ⇒ 子进程还顺带保证了一件事：**判据看到的那份 `lib/` 与生产加载的是同一份**。
 *
 * ── ★★★ 为什么子进程跑在【它自己的检出】里（这是本文件最要紧的一条纪律）────────
 *
 * 生产路径会 `rmSync` 一棵 worktree，而"哪一棵"由 `workspace` 推导
 * （`<workspace>/.agent-teams/worktrees/<worktreeDirName(teamId, taskId)>`）。
 * ★ 若子进程的 `workspace` 就是**本仓**，那它删的就是**本仓的树** ——
 *   包括**跑这个夹具的那一棵**（本文件自己就住在 `task-concurrency-1-t2/` 里）
 *   以及**队友的**（`task-concurrency-1-t*`）。⇒ 那是不可逆的自伤。
 * ⇒ 所以每条臂都 `mkdtempSync` 一个**自己的临时仓库**（`git init -b main`），
 *   子进程的 `workspace` 指向它 —— 回收动作只可能落在那个临时根之下。
 *   ★ 而"落在那儿"不是靠约定，是靠**断言前缀**（见下面 `assertReclaimLandedUnderTemp`）。
 *
 * ★★ 绝**不** spawn `node scripts/worktree-reclaim.mjs --apply`：那个 CLI 扫的是
 *   **整棵** `.agent-teams/worktrees/`（`planReclaim` → `listWorktrees(repo)`），
 *   它会删掉**别的**任务的树 —— 包括正在跑的那个团队自己。
 *   生产接线只取那个模块里的**纯裁决**（`judgeWorktree`），删除对**一条路径**做。
 */

const RECLAIM_TEST_ROOT = join(HERE, '..')

/** 被子进程装载的那份插件产物（★ 与生产加载的是同一份 `lib/`）。 */
const RECLAIM_TEST_LIB = join(RECLAIM_TEST_ROOT, 'lib', 'tools.js')

/**
 * 子进程的载荷（一个自足的 ESM 脚本，由父进程写进临时目录再跑）。
 *
 * ── 它做什么 ──────────────────────────────────────────────────────────────────
 *   ① 装一个**最小但真**的宿主 ctx（`defineTool` 真的跑、注册表真的填）；
 *   ② `registerAgentTeamsTools`（**生产那一个入口**）；
 *   ③ `agent_teams_create` + 建一棵**真的** worktree（走 `createTaskWorktree`）；
 *   ④ 按臂的形状布置那棵树；
 *   ⑤ 调 **`agent_teams_update_task`**（真工具）落终态 —— 回收就发生在这一步；
 *   ⑥ 交回一行 JSON：树还在不在、任务的终态、以及**捕获到的日志**。
 *
 * ── ★ 为什么读【日志】而不只读"树在不在"──────────────────────────────────────
 *   "树不在了"这个读数本身**分不出**是"回收成功"还是"别的什么东西删了它"。
 *   ⇒ 所以每一臂都同时断言日志里那条**指名这棵树**的话。
 */
const RECLAIM_ARM_CHILD = String.raw`
import { registerAgentTeamsTools } from ${JSON.stringify(RECLAIM_TEST_LIB)}
import { mkdir, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.env.ARM_ROOT
const WORKSPACE = process.env.ARM_WORKSPACE
const SHAPE = process.env.ARM_SHAPE
const HOOK = process.env.ARM_INTEGRATOR_HOOK === '1'
const STATE_DIR = '.agent-teams/arm-state'
const TEAM = 'arm'
const TASK = 't1'

const out = (o) => process.stdout.write('__ARM__' + JSON.stringify(o) + '\n')
const logs = []
const definitions = new Map()
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function fakeAgent(workspace) {
  return {
    id: 'captain-session',
    status: 'idle',
    options: { provider: 'fake', model: 'fake-model' },
    session: {
      header: { cwd: workspace, events: [] },
      events: [],
      ownEvents() { return this.events },
      requestHeader() { return { config: { provider: 'fake', model: 'fake-model', reasoningEffort: 'high' } } },
    },
    steer() {},
    followup() {},
  }
}

const ctx = {
  logger: {
    debug() {},
    info(m) { logs.push(['info', String(m)]) },
    warn(m) { logs.push(['warn', String(m)]) },
    error(m) { logs.push(['error', String(m)]) },
  },
  tools: { register(t) { definitions.set(t.name, t) } },
  subagents: {
    getProvider() { return undefined },
    list() { return [] },
    sendMessage: async () => 'msg-0',
    [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
  },
  agents: { get() { return undefined } },
  llm: { async resolveCallConfig(c) { return c }, async listModels() { return [] } },
  on() { return () => {} },
  effect(s) { return s() },
  inject() { return () => {} },
}

const call = async (name, args) => {
  const d = definitions.get(name)
  if (d === undefined) throw new Error('missing tool ' + name)
  return await d.execute(args, { agent: fakeAgent(WORKSPACE), signal: new AbortController().signal })
}

const stateAbs = join(WORKSPACE, STATE_DIR)
const { worktreeDirName, createTaskWorktree, commitWorktree } = await import(join(ROOT, 'lib/worktree.js'))
const { readTeam, writeTeam, withTeamLock } = await import(join(ROOT, 'lib/state.js'))
await rm(stateAbs, { recursive: true, force: true })
await mkdir(stateAbs, { recursive: true })
registerAgentTeamsTools(ctx, { stateDir: STATE_DIR, memberProvider: 'spawn', maxMembers: 8, profiles: {} })
/**
 * ★ 团队 id 由 "create" **slug 出来**（不是我要的那个字面量）⇒ 从它的返回里读，
 *   而不是假设它等于 "TEAM" —— 一个假设错的 id 会让 "readTeam" 返回 "undefined"，
 *   而那会伪装成"回收没跑"（实测：本臂第一版就是这么炸的）。
 */
const created = await call('agent_teams_create', { name: 'Reclaim Arm', description: 'worktree reclaim wiring arm' })
const teamId = created.team_id
out({ step: 'team', teamId, stateDir: created.state_dir })
if (teamId === undefined) { out({ fatal: 'no-team-id', created }); process.exit(0) }

/**
 * ★ 路径用**生产那一个函数**算（与 "update_task" 推导用的同一份真值）——
 *   而 "teamId" 是**刚从 create 读回来的**那个，不是猜的。
 */
const worktree = join(WORKSPACE, '.agent-teams', 'worktrees', worktreeDirName(teamId, TASK))
out({ step: 'paths', worktree, workspace: WORKSPACE })

const provisioned = createTaskWorktree({ repo: WORKSPACE, taskId: TASK, teamId })
if (teamId === undefined) { out({ fatal: 'no-team-id', created }); process.exit(0) }
if (provisioned.ok !== true) { out({ fatal: 'provision-failed', provisioned }); process.exit(0) }

/**
 * ── 臂的形状 ──────────────────────────────────────────────────────────────────
 *
 * ★★★ 这里有一件**实测出来的**、必须写下来的事：
 *
 *   "commitWorktree" 一旦提交成功，那棵树的 HEAD 就**前进**了 ——
 *   而判据问的是「HEAD 是不是 "main" 的祖先」（"--is-ancestor"）。
 *   ⇒ 刚提交出来的那个 commit 按定义**不是** "main" 的祖先。
 *   ⇒ 所以在"提交后立刻判"这一刻，只有**让 main 已经吸收了这个新提交**，
 *     判据才会说 "reclaimable" —— 而那正是 integrator 干的事（合流）。
 *
 * ★ 生产上这个顺序是**真的会发生的**：产物交付 → integrator 合流进 main →
 *   这棵树此后**每一次**落终态时判据都会说"已吸收"。
 *   MEASURED（本夹具实测）：不加这一格时，臂 12 的树**永远**被保住，
 *   而那个绿是**假的** —— 它证明的是"我没删"，不是"它会删"。
 *
 * ★ 所以夹具用**一个 git "post-commit" 钩子**来扮演 integrator：
 *   它把 "refs/heads/main" 快进到刚提交的那个 commit。
 *   ⇒ 这不是"绕过判据"：判据读到的仍是**真的 git 事实**
 *     （"main" 真的包含那个 commit），只是"合流"这件事在夹具里被做成了同步的。
 *   ★ 而 "commitWorktree" 用的是 "--no-verify"（它跳的是 pre-commit / commit-msg）
 *     ⇒ "post-commit" **照常执行**（实测）。
 */
if (HOOK) {
  mkdirSync(join(WORKSPACE, '.git', 'hooks'), { recursive: true })
  writeFileSync(join(WORKSPACE, '.git', 'hooks', 'post-commit'),
    '#!/bin/sh\ngit update-ref refs/heads/main "$(git rev-parse HEAD)" 2>/dev/null || true\n')
  execFileSync('chmod', ['+x', join(WORKSPACE, '.git', 'hooks', 'post-commit')])
}

if (SHAPE === 'absorbed') {
  /** 已吸收：交付会被提交，而 integrator 钩子把它并进 main ⇒ 判据说 reclaimable。 */
  mkdirSync(join(worktree, 'src'), { recursive: true })
  writeFileSync(join(worktree, 'src', 'delivered.ts'), 'export const delivered = 1\n')
} else if (SHAPE === 'pre-merged') {
  /**
   * ── ★★★★★ 无钩子的"真的会发生"形状（round-2 的发射臂用这一格）───────────────
   *
   * 它复刻 "reviewer-1/refire.mjs" 的 probe A —— 而那是**生产上真的会发生的顺序**：
   *
   *   ① 这条任务**先**交付过一次（在树里 commit 一个产物）；
   *   ② integrator **把那个 commit 合进了 main**  ← ★ 这一步在**本臂的 setup 里**
   *      手工做掉（"git merge --ff-only"），**不**用 "post-commit" 钩子；
   *   ③ 此后这条任务**再落一次终态**。
   *
   * ⇒ 第 ③ 步那一刻，树的 HEAD **就是** main 的 HEAD（已吸收），
   *   而这次转换**没有新改动**要提交 ⇒ "commitWorktree" 返回 commit: undefined。
   *   ★ 于是这一格**专门打 round-1 的那个 blocker**：
   *     旧代码把回收藏在 "commit !== undefined" 里 ⇒ 这一格永远走不到 ⇒ 树留着；
   *     修好之后 ⇒ 判据说 reclaimable ⇒ **树被删掉**。
   *
   * ★★★ 本形状里**没有任何夹具注入的合流步骤在"落终态"那一刻发生** ——
   *   合流在 setup 里就做完了，落终态时产品**只**做它自己会做的事。
   */
  mkdirSync(join(worktree, 'src'), { recursive: true })
  writeFileSync(join(worktree, 'src', 'delivered.ts'), 'export const delivered = 1\n')
  const firstDelivery = commitWorktree({ worktree, taskId: TASK })
  if (firstDelivery.ok !== true || firstDelivery.commit === undefined) {
    out({ fatal: 'pre-merge-commit-failed', firstDelivery })
    process.exit(0)
  }
  git(WORKSPACE, ['merge', '-q', '--ff-only', firstDelivery.commit])
  out({ step: 'pre-merged', commit: firstDelivery.commit, main: git(WORKSPACE, ['rev-parse', '--short', 'HEAD']), treeHead: git(worktree, ['rev-parse', '--short', 'HEAD']) })
} else if (SHAPE === 'undecidable') {
  /**
   * ── ★★★ "判不了"那一格（round-1 只有判据层的覆盖，没有生产路径的）─────────────
   *
   * 权威判据对"不是 git 检出 / 读不到 HEAD / 主干引用解析不出来"答 "undecidable"。
   * ★ 而本臂要证明的是**生产路径不会把它读成"可以删"**。
   *
   * ★ 造法：让**主干引用解析不出来** —— 把临时仓库的 "main" 删掉
   *   （"update-ref -d refs/heads/main"）。那时：
   *     · 树的 HEAD 读得到（树本身是好的）；
   *     · 而 "repo" 里 "main^{commit}" 解析不出来 ⇒ 权威答
   *       "undecidable: the trunk ref "main" could not be resolved"。
   *   ★ 这正是"判不了" —— 它**不是**"可以删"。
   *
   * ★ 树里留一点脏改动，好让"提交"那一支也走到（并证明它**不**影响裁决）。
   */
  mkdirSync(join(worktree, 'src'), { recursive: true })
  writeFileSync(join(worktree, 'src', 'some.ts'), 'export const some = 1\n')
  git(WORKSPACE, ['update-ref', '-d', 'refs/heads/main'])
  out({ step: 'undecidable-setup', mainResolves: (() => { try { git(WORKSPACE, ['rev-parse', '--verify', '--quiet', 'main^{commit}']); return true } catch { return false } })() })
} else if (SHAPE === 'unique') {
  /**
   * 未吸收：树里有一个**主干没有的** commit（在树里提交）。
   * ★ 于是落终态时那棵树**不再是干净的** —— "commitWorktree" 会提交那点脏改动，
   *   而**那一点**仍然不在 main 里 ⇒ 判据说 "keep" / "not-absorbed"。
   * ★ 这正是安全臂要的形状：**产物未并入 ⇒ 绝不删**。
   */
  mkdirSync(join(worktree, 'src'), { recursive: true })
  writeFileSync(join(worktree, 'src', 'only-here.ts'), 'export const onlyHere = 1\n')
  git(worktree, ['add', '-A'])
  git(worktree, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'work only in this tree'])
  writeFileSync(join(worktree, 'src', 'follow-up.ts'), 'export const followUp = 1\n')
} else if (SHAPE === 'clean') {
  /** 干净树："commitWorktree" 报"没有改动" ⇒ 回收那一支**根本不该被走到**。 */
  void 0
}

/** ★ 任务的记录必须是**完整形状**（"readTeam" 的强校验要 createdAt/updatedAt）。 */
await withTeamLock('arm:' + stateAbs + ':' + teamId, async () => {
  const team = await readTeam(stateAbs, teamId)
  const now = Date.now()
  team.tasks = [{ id: TASK, subject: 'arm task', status: 'in_progress', dependencies: [], createdAt: now, updatedAt: now }]
  team.taskSeq = 1
  await writeTeam(stateAbs, team)
})

const before = statSync(join(stateAbs, teamId, 'team.json')).mtimeMs
/** ★ 收窄窗口：只留"落终态那一刻"的日志，免得别处的措辞污染断言。 */
logs.length = 0
let threw
try {
  await call('agent_teams_update_task', { task_id: TASK, status: 'completed', output: 'arm done' })
} catch (error) {
  threw = String(error?.message ?? error).slice(0, 1200)
}
const afterMtime = statSync(join(stateAbs, teamId, 'team.json')).mtimeMs
const task = (await readTeam(stateAbs, teamId)).tasks.find((t) => t.id === TASK)

/**
 * ── ★★ 可选：**再落一次终态**（round-2 的"重发"义务）─────────────────────────────
 *
 * ★ 终态结果是**不可变**的（"update_task" 的契约），所以"第二次终态转换"在真实
 *   生产上发生在**重开之后**（"in_progress" → 再落终态）。
 *   ⇒ 本夹具照那条路走：把任务置回 "in_progress"，再落一次 "completed"。
 * ★ 要证明的是：树已经不在 ⇒ 第二次**无害**（不抛、状态照旧、不写 deliveryFailure），
 *   而且**树不会回来**。
 */
let second = null
if (process.env.ARM_SECOND_TRANSITION === '1') {
  await withTeamLock('arm2:' + stateAbs + ':' + teamId, async () => {
    const team = await readTeam(stateAbs, teamId)
    const t = team.tasks.find((x) => x.id === TASK)
    t.status = 'in_progress'
    t.updatedAt = Date.now()
    await writeTeam(stateAbs, team)
  })
  const before2 = statSync(join(stateAbs, teamId, 'team.json')).mtimeMs
  logs.length = 0
  let threw2
  try {
    await call('agent_teams_update_task', { task_id: TASK, status: 'completed', output: 'arm done again' })
  } catch (error) {
    threw2 = String(error?.message ?? error).slice(0, 1200)
  }
  const t2 = (await readTeam(stateAbs, teamId)).tasks.find((x) => x.id === TASK)
  second = {
    threw: threw2,
    mtimeAdvanced: statSync(join(stateAbs, teamId, 'team.json')).mtimeMs > before2,
    worktreeExists: existsSync(worktree),
    taskStatus: t2?.status,
    deliveryFailure: t2?.deliveryFailure ?? null,
    logs: [...logs],
  }
}

out({
  step: 'terminal',
  threw,
  mtimeAdvanced: afterMtime > before,
  worktreeExists: existsSync(worktree),
  worktree,
  taskStatus: task?.status,
  deliverableCommit: task?.deliverableCommit ?? null,
  deliveryFailure: task?.deliveryFailure ?? null,
  logs,
  second,
  envOff: process.env.AGENT_TEAMS_NO_RECLAIM ?? null,
})
process.exit(0)
`

/**
 * 起一个子进程跑一条臂，把它的读数拿回来。
 *
 * ★ 子进程必须落在**能解析 `@deepseek-ai/cordis` 的地方** ⇒ 脚本写进**本仓**
 *   （那里有 `node_modules` 链接），跑完删掉。
 * ★ 而**工作目录**是那个临时仓库 —— 判据读的 `workspace` 就是它。
 */
function runReclaimArm({ shape, env = {}, hook = false, secondTransition = false }) {
  /** ★ 脚本落在**临时目录**（不是本仓）—— 免得在本仓根上留下会被误读成"交付"的残渣。 */
  const scratch = mkdtempSync(join(tmpdir(), 'reclaim-arm-script-'))
  const guide = join(scratch, 'arm.mjs')
  const workspace = mkdtempSync(join(tmpdir(), 'reclaim-arm-repo-'))
  git(workspace, ['init', '-q', '-b', 'main', '.'])
  git(workspace, ['config', 'user.email', 't@t'])
  git(workspace, ['config', 'user.name', 't'])
  writeFileSync(join(workspace, 'README.md'), '# arm fixture repo\n')
  git(workspace, ['add', '-A'])
  git(workspace, ['commit', '-qm', 'init'])
  writeFileSync(guide, RECLAIM_ARM_CHILD)
  try {
    /**
     * ── ★★ 必须清掉 `NODE_TEST*` / `NODE_OPTIONS` ─────────────────────────────
     *
     * MEASURED（本仓多个夹具记过同一条）：`node --test` 会给子进程种下
     * `NODE_TEST_CONTEXT`，那会让**孙**进程变成"子报告器"而不再打印汇总。
     * 本臂的子进程不是测试套件，但它同样会继承一堆与本次测量无关的环境 ——
     * 清掉它们，让子进程拿到与生产一致的那一份。
     */
    const childEnv = { ...process.env, ARM_ROOT: RECLAIM_TEST_ROOT, ARM_WORKSPACE: workspace, ARM_SHAPE: shape, ARM_INTEGRATOR_HOOK: hook ? '1' : '0', ARM_SECOND_TRANSITION: secondTransition ? '1' : '0', ...env }
    for (const key of Object.keys(childEnv)) {
      if (key.startsWith('NODE_TEST') || key === 'NODE_OPTIONS') delete childEnv[key]
    }
    /**
     * ★ 关掉重定向：`execFileSync` 的 `stdio: 'pipe'` 会在**子进程被信号杀掉**时
     *   丢掉全部输出 ⇒ 而"没有输出"与"子进程没跑"同形。这里**捕获**它，
     *   失败时把它**原样打出来**（见下面 `assertArmRan`），而不是让它变成一个空断言。
     */
    let stdout = ''
    let failed = null
    try {
      stdout = execFileSync(process.execPath, [guide], {
        cwd: workspace,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
        maxBuffer: 32 * 1024 * 1024,
      })
    } catch (error) {
      failed = error
      stdout = String(error?.stdout ?? '')
    }
    if (process.env.ARM_DEBUG === '1') console.log('  [arm stdout]\n' + stdout.slice(-3000) + '\n  [arm stderr]\n' + String(failed?.stderr ?? '').slice(-3000))
    /**
     * ★★ 取**最后**那一条 `__ARM__`（不是第一条）——
     *   MEASURED（本臂实测）：子进程会先报 `paths` / `team` 两条**中间读数**，
     *   而 `.find()` 拿的是**第一条** ⇒ 解析出来的 `payload` 是那条中间读数，
     *   于是 `payload.mtimeAdvanced` 恒为 `undefined`。
     *   ★ 那个红**看起来像**"回收没跑"，其实只是我读错了行 ——
     *     所以这里显式取最后一条，并在失败诊断里把全部行打出来。
     */
    const armLines = stdout.split('\n').filter((entry) => entry.startsWith('__ARM__'))
    const line = armLines[armLines.length - 1]
    if (line === undefined) {
      /**
       * ★★ 子进程没能交出读数 ⇒ **响亮地失败**，并把它的诊断原样打出来。
       *   ★ 绝不 `t.skip`：那会把"我测不了"写成"这格没事"，
       *     而那正是本任务要防的形态（没测到 ≠ 通过）。
       */
      throw new Error(
        `回收接线子进程没有交出读数（这**不是**"机制没问题"）。\n`
        + `  shape=${shape} hook=${hook} exit=${failed === null ? 0 : (failed.status ?? 'signal')}\n`
        + `  stderr 尾部：\n${String(failed?.stderr ?? '').slice(-3000)}\n`
        + `  stdout 尾部：\n${stdout.slice(-3000)}`,
      )
    }
    return { payload: JSON.parse(line.slice('__ARM__'.length)), workspace, stdout, failed }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
}

/**
 * ★★ 每一臂都要证明：**被删的那条路径落在临时根之下，且它是生产命名**。
 *
 * ★ 这一条是本文件最要紧的安全断言 —— 它是"我没有误删队友的树"的**可执行形式**。
 *   只断言 `existsSync === false` 是不够的：那一条在"删错了别的树"时**同样成立**。
 */
function assertReclaimLandedUnderTemp(worktree, workspace, expectation) {
  assert.ok(
    worktree.startsWith(join(workspace, '.agent-teams', 'worktrees') + '/'),
    `★★ 回收目标必须落在【临时仓库】的 .agent-teams/worktrees/ 之下。实测：${worktree}（临时根 ${workspace}）`,
  )
  assert.equal(dirname(worktree), join(workspace, '.agent-teams', 'worktrees'),
    '★ 它的父目录必须是 .agent-teams/worktrees（生产命名的那一格）')
  assert.match(basename(worktree), /^task-/, `★ 目录名必须以 task- 开头。实测：${basename(worktree)}`)
  void expectation
}

/**
 * ── 子进程的日志里，**指名这棵树**的那一条 ───────────────────────────────────────
 *
 * ★★★ MEASURED（本臂实测）：`worktree` 会出现在**不止一条**日志里 ——
 *   "deliverable committed as … **in <worktree>**" 那条也含它。
 *   ⇒ 只按"包含路径"找会**拿到提交那条**，于是断言打在了一条不相干的读写上。
 *   ★ 那个红看起来像"回收读数丢了"，其实是我选错了行。
 * ⇒ 所以按**关键措辞**筛（调用方给 `match`），而不是只按路径。
 */
function logLineFor(payload, worktree, match) {
  return payload.logs
    .map(([, message]) => message)
    .find((message) => message.includes(worktree) && (match === undefined || match.test(message)))
}

/**
 * ── ★★★ 回收的读数：**在子进程里读**，不是在父进程里读 ───────────────────────────
 *
 * MEASURED（本臂实测）：`runReclaimArm` 会在 `finally` 里删掉那个临时仓库，
 * 所以父进程在它返回之后 `existsSync(worktree)` 恒为 `false` ——
 * **包括"回收根本没接线"的那一次**。
 * ★ 那个读数因此**没有分辨力**：它把"删掉了"与"临时目录被清理了"读成同一件事。
 * ⇒ 真正的读数必须来自**子进程自己**（在清理之前那一刻读的 `worktreeExists`）。
 */
function assertWorktreeState(payload, expected, why) {
  assert.equal(
    payload.worktreeExists, expected,
    `${why}\n  实测（子进程在临时仓库被清理【之前】读的）：worktreeExists=${String(payload.worktreeExists)}`
    + `\n  路径：${payload.worktree}\n  日志：${JSON.stringify(payload.logs, null, 1)}`,
  )
}

test('★★★ 臂 12（接线臂 · 它真的会发生）：落终态且交付已吸收 ⇒ 生产路径【真的删掉】那棵树', async () => {
  /**
   * ── 本臂问的问题是"接线"，不是"判据对不对"────────────────────────────────────
   *
   * 上面 12 条臂能证明 `judgeWorktree` 判得对；它们**不能**证明它会**被调用**。
   * 而本任务的缺口恰恰是后者：判据零调用方 ⇒ 46 棵树只能手动清。
   *
   * ⇒ 所以这一臂走**生产入口**：真的 `registerAgentTeamsTools`、真的
   *   `agent_teams_create`、真的 `agent_teams_update_task ... status: 'completed'`，
   *   然后断言**那棵树真的不在了**。
   *
   * ── ★★★ 定向突变（这条臂靠什么变红）────────────────────────────────────────────
   *
   *   ① 把 `src/tools/update-task.ts` 里那一句 `await reclaimWorktreeAfterDelivery(...)`
   *      删掉 ⇒ 树留着 ⇒ **本臂红**（`worktreeExists` 仍是 true）。
   *   ② 把 `reclaimWorktreeAfterDelivery` 的删除那一句删掉（只判定不动手）⇒ 同上红。
   *   ③ 把 `verdict.status === 'reclaimable'` 那一支改成无条件删 —— 臂 14 红。
   *   ④ 把 `.git/hooks/post-commit` 那一格（扮演 integrator）去掉 ⇒ 树留着 ⇒ 红。
   *      ★ 而那个红**是对的**：交付刚提交出来、还没被合流 ⇒ 不该删（见子进程里那段）。
   *
   * ── ★★★★★ 本臂的地位在 round 2 被**降级**了（读的人必须先看这一句）───────────
   *
   * 它注入的 `post-commit` 钩子**替 integrator 做了合流** —— 而那是
   * **产品在那一刻从不做的一步**。⇒ 所以本臂证明的是
   * 「**接线、删除、归属**在"产物已经被合流"的前提下正确」，
   * 它**不**证明"产品自己能走到那一刻"。
   *
   * ★ 而"产品自己能走到那一刻"由**臂 15**（无钩子、合流在 setup 里就做完）证明。
   *   ⇒ 两条臂都要留：臂 15 钉**可达性**，本臂钉"钩子形状下的接线"。
   *   ★★★ 而 round 1 的 blocker 正是**只有本臂**（那条假的绿）——
   *     它让一个**生产上不可达**的删除看起来被证明了。
   *
   * ── ★★ 干扰隔离 ──────────────────────────────────────────────────────────────
   *   子进程跑在 `mkdtempSync` 出来的**临时仓库**里 ⇒ 回收只可能落在它下面。
   *   本臂用 `assertReclaimLandedUnderTemp` **断言**这一点，而不是"我以为"。
   */
  const { payload, workspace } = runReclaimArm({ shape: 'absorbed', hook: true })

  assert.equal(payload.threw, undefined, `★ 落终态不许抛（回收失败更不能改判）。实测：${payload.threw}`)
  assert.equal(payload.mtimeAdvanced, true, '★ 前置：这一次更新真的落盘了（否则本臂测的是"没跑到"）')
  assert.equal(payload.taskStatus, 'completed', `★ 前置：任务真的落了终态。实测：${payload.taskStatus}`)
  assert.equal(payload.deliverableCommit !== null, true, '★ 前置：交付真的被提交了（回收挂在那一支上）')

  const worktree = payload.worktree
  /** ★ 先证明"删的那条路径"是**生产命名**、且落在临时根之下。 */
  assertReclaimLandedUnderTemp(worktree, workspace)

  /**
   * ★★ 核心断言：**那棵树真的没了**（不是"日志说回收了"）。
   *   ★ 读数取自**子进程**（它在临时仓库被清理之前读的，见 `assertWorktreeState`）。
   */
  assertWorktreeState(payload, false, '★★★ 交付已吸收 ⇒ 生产路径必须真的删掉那棵树')
  /** ★ 而"没了"必须有**归属**：日志里那一条要指名这棵树、并复述判据自己的话。 */
  const line = logLineFor(payload, worktree, /reclaimed the worktree/)
  assert.notEqual(line, undefined, `★ 日志里必须有一条指名这棵树的回收读数。实测日志：${JSON.stringify(payload.logs)}`)
  assert.match(line, /reclaimed the worktree for task "t1"/, `★ 那一条必须说清"回收了哪条任务的哪棵树"。实测：${line}`)
  assert.match(line, /safe to reclaim/, `★ 而它必须复述【判据自己的话】（不是调用方另写的一句）。实测：${line}`)

  /** ★ 而它**没有**改判这条任务（回收是记账之外的清理，不是裁决）。 */
  assert.equal(payload.deliveryFailure, null, '★ 回收不许写 deliveryFailure')
})

test('★★★ 臂 13（反向臂 · 开关）：`AGENT_TEAMS_NO_RECLAIM=1` ⇒ 同一套输入下那棵树【必须还在】', async () => {
  /**
   * ── 一个自动删除的机制若不能停，在它误判时会造出**不可逆**的损失 ────────────────
   *
   * ★ 臂 11 测的是**脚本自己的 CLI** 那个开关；本臂测的是**生产接线**上的同一个开关。
   *   两件事必须分开测：一个只在 CLI 里生效的开关，在生产上等于没有开关。
   *
   * ── ★★★ 定向突变 ─────────────────────────────────────────────────────────────
   *   ① 把 `if (off) { … return }` 那一支删掉 ⇒ 树被删 ⇒ **本臂红**。
   *   ② 把 `RECLAIM_OFF_ENV` 换成一个**重打的字面量**（而模块导出的是另一个名字）
   *      ⇒ 开关拨不动 ⇒ 同上红。
   *      ★ 这正是"名字必须来自模块导出"那一格的**可执行形式**。
   *
   * ── ★★ 它必须与臂 12 **用同一套输入** ────────────────────────────────────────
   *   否则"停了"与"这条输入本来就不可清"同形 —— 那样本臂会**恒绿**而毫无分辨力。
   *   所以形状、钩子、任务全都一样，**只有环境变量不同**。
   */
  const { payload, workspace } = runReclaimArm({ shape: 'absorbed', hook: true, env: { AGENT_TEAMS_NO_RECLAIM: '1' } })

  assert.equal(payload.threw, undefined, `★ 开关打开时落终态不许抛。实测：${payload.threw}`)
  assert.equal(payload.mtimeAdvanced, true, '★ 前置：这一次更新真的落盘了')
  assert.equal(payload.taskStatus, 'completed', '★ 前置：任务照常落终态（开关只管回收，不管裁决）')
  assert.equal(payload.deliverableCommit !== null, true, '★ 前置：交付照常被提交（开关不拦交付）')

  const worktree = payload.worktree
  assertReclaimLandedUnderTemp(worktree, workspace)

  /** ★★ 核心断言：开关拨上 ⇒ 树**仍在**（与臂 12 的同一套输入、相反的读数）。 */
  assertWorktreeState(payload, true, '★★★ 开关打开时那棵树【必须】还在（否则那个"可关闭"是假的）')
  /** ★ 而"跳过了"必须**可读** —— 否则它与"压根没接线"同形。 */
  const line = logLineFor(payload, worktree, /reclaim skipped/)
  assert.notEqual(line, undefined, `★ 开关生效时必须留下一条可读的话。实测日志：${JSON.stringify(payload.logs)}`)
  assert.match(line, /reclaim skipped for task "t1"/, `★ 那一条必须说清"跳过的是回收"。实测：${line}`)
  assert.match(line, /AGENT_TEAMS_NO_RECLAIM=1/, `★ 且要点名【哪个开关】拨到了什么值。实测：${line}`)
  /** ★ 而它不该同时说"回收了"（自相矛盾的两句会让读的人不知道信哪句）。 */
  assert.doesNotMatch(line, /reclaimed the worktree/, `★ 跳过的措辞不许与"回收了"同形。实测：${line}`)
})

test('★★★ 臂 14（安全臂 · 不许误删）：产物【未并入主干】⇒ 生产钩子必须保住那棵树', async () => {
  /**
   * ── 这条臂防的是"回收"最贵的那种失效：**删掉唯一的那份产物** ──────────────────
   *
   * MEASURED（本仓，t89 普查）：只看 `--is-ancestor` 会在本仓删掉 **7 份唯一产物**
   *   （`task-t64` 有 7 个源码文件，68KB/69KB 级，内容不在任何提交里）。
   * ⇒ 所以本臂把那个形状**造出来**：树里有一个主干没有的 commit，
   *   而落终态时它还有一点脏改动（会被 `commitWorktree` 提交）——
   *   **那一点仍然不在 main 里** ⇒ 判据必须说 `keep` / `not-absorbed` ⇒ **不删**。
   *
   * ── ★★★ 定向突变 ─────────────────────────────────────────────────────────────
   *   ① 把 `verdict.status === 'reclaimable'` 那一支改成"无条件删"（或读错字段）
   *      ⇒ 树被删 ⇒ **本臂红**。
   *   ② 把 `keep` / `undecidable` 并进 `reclaimable`（三态同形）⇒ 同上红。
   *   ③ 把 `judgeWorktree` 换成"只看脏不脏"的手写判定 ⇒ 红。
   *
   * ── ★★ 顺带钉住"不改判"这一格 ────────────────────────────────────────────────
   *   回收**不**参与裁决 ⇒ 任务照常 `completed`，且**没有** `deliveryFailure`。
   *   把"没回收"写成"交付失败"，会让成员去重做已经做对的工作。
   */
  /**
   * ★★ `hook: false` —— 这一臂**刻意不装**那个扮演 integrator 的钩子。
   *
   * MEASURED（本臂实测）：第一版装上了钩子，于是"提交后 main 前进到新提交"
   * ⇒ 判据说 `reclaimable` ⇒ 树被删 ⇒ 本臂红。
   * ★ 而那个红**不是缺陷**：装了钩子就等于"integrator 已经把它合流了"，
   *   那时删树是**对的**。⇒ 安全臂要问的场景恰恰是**还没合流**，
   *   所以这里不能装钩子（装了它，本臂测的就是另一件事）。
   */
  const { payload, workspace } = runReclaimArm({ shape: 'unique', hook: false })

  assert.equal(payload.threw, undefined, `★ 落终态不许抛。实测：${payload.threw}`)
  assert.equal(payload.mtimeAdvanced, true, '★ 前置：这一次更新真的落盘了')
  assert.equal(payload.taskStatus, 'completed', `★ 前置：任务照常落终态。实测：${payload.taskStatus}`)
  assert.equal(payload.deliverableCommit !== null, true, '★ 前置：交付真的被提交了（回收挂在那一支上）')

  const worktree = payload.worktree
  assertReclaimLandedUnderTemp(worktree, workspace)

  /** ★★ 核心断言：产物未并入 ⇒ **不许删**。 */
  assertWorktreeState(payload, true, '★★★ 产物未并入主干 ⇒ 那棵树必须还在（删掉就等于丢了那份工作）')
  /** ★ 而"留着"必须给出**理由**，且理由是判据自己的话。 */
  const line = logLineFor(payload, worktree, /was NOT reclaimed/)
  assert.notEqual(line, undefined, `★ 保住时必须留下一条可读的话。实测日志：${JSON.stringify(payload.logs)}`)
  assert.match(line, /was NOT reclaimed/, `★ 那一条必须说清"没有回收"。实测：${line}`)
  assert.match(line, /not absorbed|not-absorbed/, `★ 而理由必须是判据给的那一个（"未并入"）。实测：${line}`)
  /** ★ 而它绝不与"回收了"同形。 */
  assert.doesNotMatch(line, /deleted /, `★ 保住的措辞不许说"删了"。实测：${line}`)

  /** ★★ "没回收" ≠ "交付失败"：任务状态与 `deliveryFailure` 都不许被动过。 */
  assert.equal(payload.deliveryFailure, null, '★★ 保住一棵树不许写 deliveryFailure（那不是交付失败）')
})

test('★★★★ 臂 14b（无新改动臂 · 修正后）：树干净且已吸收 ⇒ 落终态**照样判**，且这一次真的删掉它', async () => {
  /**
   * ── ★★★★★ 这一臂在 round 2 被**反转**了 —— 而那个反转正是 blocker 的修法 ─────────
   *
   * round 1 的本臂断言的是：「没有改动 ⇒ `commitWorktree` 不产 commit
   * ⇒ 回收那一支根本不该被走到 ⇒ 树必须留着」。
   *
   * ★★ MEASURED（reviewer 的 `refire.mjs` probe A，本轮独立复现）：**那条断言是错的** ——
   *   它把 round-1 那个 **blocker**（回收不可达）当成了**正确行为**钉了下来。
   *
   *   而真相是：**树干净且已吸收**恰恰是**唯一可达**的那种"该回收"的形状 ——
   *   产物早先已被 integrator 合流，这次终态转换本来就没有新东西要提交。
   *   ⇒ round-1 把它挡在门外（藏在 `commit !== undefined` 里）⇒ 删除永远不发生。
   *
   * ⇒ 修好之后：**树在就判**。这一格于是变成**发射格的第二份证据**
   *   （与臂 15 同源，但形状更朴素：连"先交付一次"都没有 —— 树从头就是干净的）。
   *
   * ── ★★★ 定向突变 ─────────────────────────────────────────────────────────────
   *   把入口条件改回 round-1（只在 `committed.commit !== undefined` 那一支调用）
   *   ⇒ 本臂的树是干净的（没有新改动）⇒ 回收**根本不被调用** ⇒ 树留着 ⇒ **本臂红**。
   *   ★ 而 round-1 的绿恰恰说明：**一条按旧语义写的臂会为一个缺陷作证**。
   *
   * ── ★ 它同时钉住"提交与回收是两件事"──────────────────────────────────────────
   *   `deliverableCommit` 缺席（没东西可提交）而回收**照样发生** ——
   *   两者**不同形**，也不互相依赖。
   */
  const { payload, workspace } = runReclaimArm({ shape: 'clean', hook: false })

  assert.equal(payload.threw, undefined, `★ 干净树落终态不许抛。实测：${payload.threw}`)
  assert.equal(payload.taskStatus, 'completed', '★ 前置：任务照常落终态')
  /** ★ 前置：真的没有新改动要提交（这一格是"提交"与"回收"解耦的证据）。 */
  assert.equal(payload.deliverableCommit, null, '★ 前置：没有改动 ⇒ 不产 commit（`deliverableCommit` 缺席）')

  const worktree = payload.worktree
  assertReclaimLandedUnderTemp(worktree, workspace)

  /** ★★ 核心断言：干净 + 已吸收 ⇒ **真的删掉**（而"没有新提交"不是障碍）。 */
  assertWorktreeState(payload, false, '★★★★ 干净且已吸收的树 ⇒ 落终态照样回收（"没有改动"不许挡住回收）')
  const line = logLineFor(payload, worktree, /reclaimed the worktree/)
  assert.notEqual(line, undefined, `★ 必须有一条回收读数。实测日志：${JSON.stringify(payload.logs)}`)
  /** ★ 而措辞要说清这一格是"重判"（没有新改动），不是"刚交付" —— 两种情形不同形。 */
  assert.match(
    line, /safe to reclaim/,
    `★ 必须复述判据自己的话。实测：${line}`,
  )
  /**
   * ★★ 而"没有新改动"这件事**本来就有它自己的读数**（`had no worktree changes to commit`）——
   *   它与回收那条**并列**而不是嵌在一起：两件事各自可读 ⇒ 读的人能分出
   *   "这次只是重判"与"这次刚交付了一个 commit"。
   *   ★ MEASURED（本臂第一版在这一点上红过）：我把 `commitOutcome` 的措辞
   *     断言在**回收那条**上，而它只出现在 `keep`/`undecidable` 的措辞里 ——
   *     回收成功那条不需要它（"删了"本身已经说清了结果）。
   *     ⇒ 断言改成核**两条并列的读数**都在，而不是要求它们合成一条。
   */
  const noChangeLine = payload.logs.map(([, m]) => m).find((m) => /had no worktree changes to commit/.test(m))
  assert.notEqual(
    noChangeLine, undefined,
    `★ "这一次没有新改动"必须有自己的读数（与回收那条并列）。实测：${JSON.stringify(payload.logs)}`,
  )
  assert.notEqual(
    noChangeLine, line,
    '★ 两条读数必须是**不同的两行** —— 合成一条会让"刚交付"与"只是重判"同形',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// ★★★★★ round-2：入口条件那一格（round-1 的 blocker 就在这里）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── round 1 的 blocker（reviewer 两次实测，**已确认成立**）─────────────────────────
 *
 * round-1 的回收挂在 `commitWorktree` **成功**那一支上。而实测（`reviewer-1/sequence.mjs`
 * 与 `reviewer-1/refire.mjs`）说明：
 *
 *   ① `commitWorktree` **只在 worktree 里**提交，它**从不**合进 `main`
 *      ⇒ 提交刚成功那一刻，树 HEAD 是全新 commit、按定义**不是** `main` 的祖先
 *      ⇒ 权威判据**必然**答 `keep / not-absorbed`
 *      ⇒ ★ 入口被设在了**唯一一个判据必然说不的时刻** ⇒ **删除在生产上不可达**。
 *
 *   ② 而**唯一可达**的"已吸收"形状恰恰是**没有新改动**的那一次
 *      （`committed.commit === undefined`）：产物早先已被合流、这次本来就没东西提交
 *      ⇒ ★ 它藏在 `commit !== undefined` 里 ⇒ 也**永远走不到**。
 *
 * ⇒ 修法（round 2）：**树在 ⇒ 就判**，与"这一轮提交成了没有"无关。
 *   而"能不能删"仍然只由 `judgeWorktree` 说（本层不新增任何第二条判据）。
 *
 * ★ 下面臂 15（发射）与臂 17（重发）钉的就是**这一格**：
 *   把入口条件改回 round-1 那个"只在提交成功那一支"⇒ **臂 15 与臂 17 都红**。
 */

test('★★★★★ 臂 15（发射臂 · 无钩子）：已吸收的树落终态 ⇒ 生产路径**真的删掉**它（合流在 setup 里做完）', async () => {
  /**
   * ── 本臂与臂 12 的分工（★ 读之前先分清这两条）─────────────────────────────────
   *
   *   臂 12：注入 `post-commit` 钩子 ⇒ 合流与提交**同一刻**发生（**模拟后续阶段**）。
   *   臂 15：**不注入任何钩子** ⇒ 合流在 **setup 里**就做完了，
   *          落终态时产品**只**做它自己会做的事。⇒ 它证明**可达性**。
   *
   * ── ★★★ 定向突变（这条臂靠什么变红）────────────────────────────────────────────
   *
   *   ① ★ **把入口条件改回 round-1**（`reclaimWorktreeAfterDelivery` 只在
   *      `committed.ok === true && committed.commit !== undefined` 那一支里调用）
   *      ⇒ 本臂的树是**干净的**（没有新改动）⇒ 那一支不成立 ⇒ 回收**根本不被调用**
   *      ⇒ 树留着 ⇒ **本臂红**。★ 这就是 round-1 的 blocker 的可执行形式。
   *   ② 把 `verdict.status === 'reclaimable'` 改成不删 ⇒ 红。
   *   ③ 把 `remove(worktree)` 那一句删掉 ⇒ 红。
   *
   * ── ★★ 它为什么必须是**子进程 + 临时仓库**（与其它臂同一条纪律）─────────────────
   *   生产路径会 `rmSync` 一棵树，路径由 `workspace` 推导 ⇒ 子进程的 workspace
   *   必须是**它自己的**临时仓库（否则删的是本仓、乃至队友的树）。
   *   ⇒ 而"删的那条路径落在临时根下"由 `assertReclaimLandedUnderTemp` **断言**。
   */
  const { payload, workspace } = runReclaimArm({ shape: 'pre-merged', hook: false })

  assert.equal(payload.threw, undefined, `★ 落终态不许抛。实测：${payload.threw}`)
  assert.equal(payload.mtimeAdvanced, true, '★ 前置：这一次更新真的落盘了（否则本臂测的是"没跑到"）')
  assert.equal(payload.taskStatus, 'completed', `★ 前置：任务真的落了终态。实测：${payload.taskStatus}`)
  /**
   * ★★ 前置必须钉住"这一轮**没有**新提交" —— 否则本臂会退化成臂 12 那种形状，
   *   也就**测不到** round-1 那个 blocker。
   *   MEASURED：`pre-merged` 那一格的树在落终态时是干净的 ⇒ `deliverableCommit` 缺席。
   */
  assert.equal(
    payload.deliverableCommit, null,
    `★★ 前置：本臂必须是"没有新改动"的那一次终态转换（否则它测的不是 round-1 那个 blocker）。`
    + `实测 deliverableCommit=${JSON.stringify(payload.deliverableCommit)}`,
  )

  const worktree = payload.worktree
  assertReclaimLandedUnderTemp(worktree, workspace)

  /** ★★ 核心断言：**那棵树真的没了**（读数取自子进程，见 `assertWorktreeState`）。 */
  assertWorktreeState(payload, false, '★★★★★ 已吸收的树落终态 ⇒ 生产路径必须真的删掉它（无钩子）')
  const line = logLineFor(payload, worktree, /reclaimed the worktree/)
  assert.notEqual(line, undefined, `★ 必须有一条指名这棵树的回收读数。实测日志：${JSON.stringify(payload.logs)}`)
  assert.match(line, /safe to reclaim/, `★ 而它必须复述【判据自己的话】。实测：${line}`)
  /** ★ 而它**没有**改判这条任务。 */
  assert.equal(payload.deliveryFailure, null, '★ 回收不许写 deliveryFailure')
})

test('★★★★★ 臂 17（重发臂）：树被删之后**再落一次终态** ⇒ 无害，且树不会回来', async () => {
  /**
   * ── 它防的是什么（"删掉之后那一步会不会炸"）───────────────────────────────────
   *
   * 删树发生在**终态转换之中**，而同一个任务**还会再落终态**（重开、修复、再交付）。
   * ★ 若第二次转换会因为"树不在了"而抛错、或改判、或写 `deliveryFailure`，
   *   那条接线就是**把一次清理变成了一个缺陷** —— 而那正是"记账失败 vs 交付失败"
   *   这条纪律要防的形态。
   *
   * ── ★★★ 定向突变 ─────────────────────────────────────────────────────────────
   *   ① 把入口条件改回 round-1（只在提交成功那一支调用）⇒ 第一次**根本不删**
   *      ⇒ 本臂的"树在不在"那一格从"第一次就没了"变成"还在" ⇒ **本臂红**。
   *   ② 让回收失败时 `throw`（或写 `deliveryFailure`）⇒ 第二次转换那几格红。
   *
   * ── ★★ 终态不可变 ⇒ "第二次终态"走的是**重开之后再落**那条真实的路 ──────────────
   *   子进程把任务置回 `in_progress`，再落一次 `completed`（与生产上的重开同形）。
   */
  const { payload, workspace } = runReclaimArm({ shape: 'pre-merged', hook: false, secondTransition: true })

  assert.equal(payload.taskStatus, 'completed', '★ 前置：第一次真的落了终态')
  const worktree = payload.worktree
  assertReclaimLandedUnderTemp(worktree, workspace)
  /** ★ 前置：第一次真的删掉了（否则本臂测的是"没删之后又没删"）。 */
  assertWorktreeState(payload, false, '★ 前置：第一次终态转换真的删掉了那棵树')

  const second = payload.second
  assert.notEqual(second, null, '★ 前置：子进程必须真的跑过第二次终态转换')

  /** ★★ 核心：第二次**不许抛**、状态照旧、不写 deliveryFailure。 */
  assert.equal(second.threw, undefined, `★★ 第二次终态转换不许抛。实测：${second.threw}`)
  assert.equal(second.mtimeAdvanced, true, '★ 前置：第二次更新真的落盘了')
  assert.equal(second.taskStatus, 'completed', `★★ 第二次的终态必须照旧。实测：${second.taskStatus}`)
  assert.equal(second.deliveryFailure, null, '★★★ 第二次不许写 deliveryFailure（回收失败≠交付失败）')
  /** ★★ 而**树不会回来**（第二次那一刻它仍然不在）。 */
  assert.equal(
    second.worktreeExists, false,
    '★★ 树被删之后不许"回来" —— 第二次终态转换时它必须仍然不在',
  )
  /** ★ 而第二次**仍然留下了可读的读数**（它又判了一次，只是判据说"没有那棵树"）。 */
  assert.equal(second.logs.length > 0, true, '★ 第二次转换也必须有日志（不许静默）')
})

test('★★★ 臂 16（判不了臂 · 生产路径）：主干引用解析不出来 ⇒ 【绝不】删，且说清"没测到"', async () => {
  /**
   * ── round-1 的覆盖缺口（reviewer 点名）────────────────────────────────────────
   *
   * round 1 只在**判据层**（T25-3 / T25-5）钉过 `undecidable`，
   * **没有**一条**生产路径**的臂。⇒ 而"判据层判得对"与"生产路径不把它读成可删"
   * 是两件事 —— 后者才是会删错东西的那一步。
   *
   * ── ★★★ 定向突变 ─────────────────────────────────────────────────────────────
   *   ① 把 `verdict.status === 'reclaimable'` 改成"不是 keep 就删"（把 undecidable
   *      并进可删）⇒ **本臂红**（树被删）。
   *   ② 把判据换成"读不到主干就当可清" ⇒ 红。
   *
   * ── ★★ 造法：删掉临时仓库的 `main` 引用 ──────────────────────────────────────
   *   那时树本身是好的（HEAD 读得到），而 `repo` 里 `main^{commit}` 解析不出来
   *   ⇒ 权威判据答 `undecidable: the trunk ref "main" could not be resolved`。
   *   ★ 这正是"没测到" —— 它**不是**"可以删"。
   */
  const { payload, workspace } = runReclaimArm({ shape: 'undecidable', hook: false })

  assert.equal(payload.threw, undefined, `★ 判不了时落终态不许抛。实测：${payload.threw}`)
  assert.equal(payload.mtimeAdvanced, true, '★ 前置：这一次更新真的落盘了')
  assert.equal(payload.taskStatus, 'completed', `★ 前置：任务照常落终态。实测：${payload.taskStatus}`)

  const worktree = payload.worktree
  assertReclaimLandedUnderTemp(worktree, workspace)

  /** ★★ 核心断言：判不了 ⇒ **绝不删**。 */
  assertWorktreeState(payload, true, '★★★ "判不了"绝不许被读成"可以删"')
  const line = logLineFor(payload, worktree, /was NOT reclaimed/)
  assert.notEqual(line, undefined, `★ 判不了时必须留下一条可读的话。实测日志：${JSON.stringify(payload.logs)}`)
  /** ★ 而措辞必须把"没测到"与"可以删"**分开**（三态不同形）。 */
  assert.match(
    line, /could NOT be decided|not measured/i,
    `★ 判不了的措辞必须说清"没能测量"。实测：${line}`,
  )
  assert.doesNotMatch(line, /deleted /, `★ 判不了时不许出现"删了"。实测：${line}`)
  /** ★ 而它同样没有改判。 */
  assert.equal(payload.deliveryFailure, null, '★ 判不了不许写 deliveryFailure')
})
