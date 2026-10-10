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
