/**
 * ── `mutation-guard` 的三臂夹具 ────────────────────────────────────────────────
 *
 * 契约要求每条判据/守卫自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）：源码里【残留了一个变异体】（注入后没恢复）⇒ 期望【拒绝】
 *   臂 2（未测量臂）：读不到 git / 没有基线 ⇒ 期望 unmeasured
 *                     ★ 不是"干净" —— 没能观察就不许宣布源码是好的
 *   臂 3（对照臂）：正常的 tree（含"本来就有未提交改动"）⇒ 期望 ok
 *
 * ── 它防的是什么失效（MEASURED，借鉴项目的实测形态）───────────────────────────
 *
 * 变异测试的工作方式是【就地改坏生产文件，跑测试，再改回来】：
 *
 *     writeFileSync(target, mutated)
 *     try { runTests() } finally { writeFileSync(target, original) }
 *
 * `finally` 只覆盖正常退出。SIGKILL / 外部超时 / 宿主崩溃【都不覆盖】。
 * MEASURED：一个仓库被留在"变异体未还原"的状态里，随后 `npm test` 报了一个
 * 【看起来完全无关】的断言失败 —— 因为源码里现在有一处真实的缺陷。
 *
 * ★ 为什么绿测试证明不了源码没被改坏：变异测试的语义是"改坏了、测试应该红"。
 *   进程在注入与还原之间死掉 ⇒ 源码保持被改坏。此后任何绿色套件只说明
 *   "剩下的测试没覆盖那一行" —— **没有覆盖 ≠ 没被改坏**。
 *
 * ── 本夹具用【真实的 git 仓库】当沙箱 ────────────────────────────────────────
 *
 * 守卫的核心前提是"基线 × 现状"，而"现状"的一半来自 git。所以夹具必须起一个
 * 真的 git 仓库（`mkdtempSync` + `git init` + 一次提交），而不是拿字符串替身 ——
 * 拿替身测的是一套不存在的接口。
 *
 * ★ 每一个写入都由 `gitWrite` / `guardedWrite` 校验落在沙箱内再落盘；
 *   绝不触碰 workspace 里的任何文件。
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  checkMutationGuard,
  parseStatusLine,
  parseHunkHeader,
  changedLinesFromDiff,
  splitDiffChunks,
} from '../lib/mutation-guard.js'

// ─────────────────────────────────────────────────────────────────────────────
// 沙箱：一个真实的 git 仓库
// ─────────────────────────────────────────────────────────────────────────────

const SUT_PATH = 'src/sut.ts'

/** SUT 的原样。夹具会在它的拷贝上注入变异体，并在臂 3 之后还原。 */
const SUT_SOURCE = `export function withinBudget(steps: number, maxSteps: number): boolean {
  return steps < maxSteps
}

export function admit(value: number): boolean {
  return value > 0
}
`

let sandbox
let sutPath

/** git，在沙箱里跑。★ 只读 + 夹具自己的提交，绝不碰外部的仓库。 */
function git(args) {
  return execFileSync('git', args, { cwd: sandbox, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * ★ 写域守卫：任何写入都必须落在本次夹具的沙箱里。
 *   夹具会【改坏】被测文件，一个写错的目标路径就是在毁别人的仓库。
 */
function guardedWrite(path, contents) {
  const target = resolve(path)
  if (!target.startsWith(resolve(sandbox) + '/')) {
    throw new Error(`the fixture tried to write outside its sandbox: ${target}`)
  }
  writeFileSync(target, contents)
}

/** 沙箱里某个文件的当前指纹（sha256）。 */
function digestOf(relative) {
  return createHash('sha256').update(readFileSync(join(sandbox, relative))).digest('hex')
}

/** 一份"变异测试开始之前"的基线。 */
function baselineFor(files, plannedMutants = []) {
  return {
    digests: Object.fromEntries(files.map((file) => [file, digestOf(file)])),
    plannedMutants,
  }
}

/**
 * 一次【真实】的观察：把当下盘上的指纹、git 可达性、git diff 全都读出来。
 *
 * ★ `gitReadable` 必须来自真的跑了一次 git，而不是被硬编码成 true ——
 *   否则"读不到 git"那条臂测的是一个工厂参数，不是守卫的行为。
 */
function observeNow(files) {
  let gitReadable = true
  let gitStatus = []
  let gitDiff = ''
  try {
    gitStatus = git(['status', '--porcelain']).split('\n').filter((line) => line.trim() !== '')
    gitDiff = git(['diff', '-U0'])
  } catch {
    gitReadable = false
  }
  return {
    digests: Object.fromEntries(files.map((file) => [file, digestOf(file)])),
    gitStatus,
    gitDiff,
    gitReadable,
  }
}

function contextFor(baseline, files, extra = {}) {
  return {
    baseline,
    observation: extra.observation ?? observeNow(files),
    readFile: (path) => readFileSync(join(sandbox, path), 'utf8'),
    ...extra,
  }
}

function expectBlocked(verdict) {
  if (verdict.ok !== false || verdict.clean !== false) {
    throw new Error(`expected a rejecting verdict, got ${JSON.stringify(verdict)}`)
  }
  return verdict
}
function expectUnmeasured(verdict) {
  if (verdict.ok !== false || !('unmeasured' in verdict)) {
    throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(verdict)}`)
  }
  return verdict.unmeasured
}
function expectOk(verdict) {
  if (verdict.ok !== true || verdict.clean !== true) {
    throw new Error(`expected a clean verdict, got ${JSON.stringify(verdict)}`)
  }
  return verdict
}

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mutation-guard-'))
  mkdirSync(join(sandbox, 'src'), { recursive: true })
  sutPath = join(sandbox, SUT_PATH)
  writeFileSync(sutPath, SUT_SOURCE)
  // 起一个真仓库并提交一次 —— 没有 HEAD 就没有"与基线/HEAD 比对"这回事
  git(['init', '-q'])
  git(['config', 'user.email', 'fixture@example.test'])
  git(['config', 'user.name', 'mutation-guard fixture'])
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'fixture baseline'])
})

after(() => {
  if (sandbox !== undefined) rmSync(sandbox, { recursive: true, force: true })
})

/** 把 SUT 还原成原样（每条臂自己负责收尾，避免臂之间互相污染）。 */
function restoreSut() {
  guardedWrite(sutPath, SUT_SOURCE)
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★ 伪造臂：源码里残留了一个变异体 ⇒ 拒绝
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 伪造臂：注入变异体后未恢复 ⇒ 拒绝（不是报告）', () => {
  /**
   * 模拟 SIGTERM 恰好落在"注入变异体"与"恢复原文件"之间：
   * 变异体【还留在盘上】，而变异测试已经"结束"了。
   */
  const baseline = baselineFor([SUT_PATH], [
    { id: 'lt-to-le@L2', file: SUT_PATH, line: 2, find: 'steps < maxSteps', replace: 'steps <= maxSteps' },
  ])

  // 真实地改坏它（就像变异测试做的那样）
  guardedWrite(sutPath, SUT_SOURCE.replace('steps < maxSteps', 'steps <= maxSteps'))

  const verdict = expectBlocked(checkMutationGuard(contextFor(baseline, [SUT_PATH])))
  assert.equal(verdict.residues.length, 1, '★ 必须报出【哪个文件】残留')
  assert.equal(verdict.residues[0].file, SUT_PATH)
  assert.ok(
    verdict.residues[0].mutantIds.includes('lt-to-le@L2'),
    `★ 必须报出【残留的变异体 id】，实际 ${JSON.stringify(verdict.residues[0].mutantIds)}`,
  )
  assert.ok(verdict.residues[0].lines.includes(2), `★ 必须报出【位置（行号）】，实际 ${JSON.stringify(verdict.residues[0].lines)}`)
  assert.match(verdict.summary, /unrecovered|left/i, '★ 摘要必须说清留下了没还原的文件')

  restoreSut()
})

test('臂 1b ★ 伪造臂：拒绝理由是"绿色测试不能证明源码没被改坏"', () => {
  /**
   * ★ 这是本守卫存在的【全部理由】，必须写在裁决里而不是只写在注释里：
   *   变异测试的语义是"改坏了、测试应该红"。进程死于注入与还原之间 ⇒ 源码
   *   保持被改坏；此后任何绿色套件只说明"剩下的测试没覆盖那一行"。
   */
  const baseline = baselineFor([SUT_PATH])
  guardedWrite(sutPath, SUT_SOURCE.replace('return value > 0', 'return value >= 0'))
  const verdict = expectBlocked(checkMutationGuard(contextFor(baseline, [SUT_PATH])))
  assert.match(
    verdict.summary,
    /[Aa] green suite does not prove|没有覆盖|did not cover/,
    '★ 摘要必须点明"绿测试证明不了源码是完整的"',
  )
  restoreSut()
})

test('臂 1c ★ 伪造臂：残留能报到行（用真实 git diff 的行号）', () => {
  const baseline = baselineFor([SUT_PATH], [
    { id: 'gt-to-ge@L6', file: SUT_PATH, line: 6, find: 'value > 0', replace: 'value >= 0' },
  ])
  guardedWrite(sutPath, SUT_SOURCE.replace('value > 0', 'value >= 0'))
  const verdict = expectBlocked(checkMutationGuard(contextFor(baseline, [SUT_PATH])))
  assert.ok(verdict.residues[0].lines.includes(6), `★ 第 6 行被改，实际报 ${JSON.stringify(verdict.residues[0].lines)}`)
  restoreSut()
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★ 未测量臂：读不到 git / 没有基线 ⇒ unmeasured
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 未测量臂：读不到 git ⇒ unmeasured（不是"干净"）', () => {
  /**
   * ★ 为什么读不到 git 不能算干净：git 是【发现"有东西和 HEAD 不同"】的那只眼睛。
   *   拿不到它，就没法把"源码被改坏了"与"源码本来就有一堆未提交改动"分开 ——
   *   而这两件事在只看指纹时会长得一样。
   */
  const baseline = baselineFor([SUT_PATH])
  const observation = { ...observeNow([SUT_PATH]), gitReadable: false }
  const reason = expectUnmeasured(checkMutationGuard(contextFor(baseline, [SUT_PATH], { observation })))
  assert.match(reason, /git is unavailable|git/i)
  assert.match(reason, /uncommitted|told apart/i, '★ 必须说清"分不开残留与本来就没提交的改动"')
})

test('臂 2b ★ 未测量臂：gitReadable 缺席（没被观测）⇒ unmeasured，不得默认成可用', () => {
  const baseline = baselineFor([SUT_PATH])
  const observation = { digests: observeNow([SUT_PATH]).digests }
  const reason = expectUnmeasured(checkMutationGuard(contextFor(baseline, [SUT_PATH], { observation })))
  assert.match(reason, /not observed|readability/i, '★ "没报告" ≠ "可用"')
})

test('臂 2c ★ 未测量臂：没有基线 ⇒ unmeasured（脏 tree 本身不是证据）', () => {
  /**
   * ★ 本守卫的核心前提。没有基线的事后比对只能得到"git 脏"，而一个正在被开发的
   *   仓库【本来就脏】。拿它当残留会天天误报，拿它当干净会漏掉真残留 ——
   *   两种都是错的，所以宁可不说话。
   *
   * ★ 注意这里必须给 `baseline: undefined` 而不是 `{ digests: {} }`：
   *   后者是【有基线但为空】⇒ 走的是"没有可检查的目标"那条分支，
   *   与"根本没取到基线"是两件不同的事。两个都测（见下一条）。
   */
  const reason = expectUnmeasured(
    checkMutationGuard({ baseline: undefined, observation: observeNow([SUT_PATH]), targets: [SUT_PATH] }),
  )
  assert.match(reason, /baseline/i)
  assert.match(reason, /dirty/i, '★ 必须说清"脏 tree 本身不是证据"')
})

test('臂 2c2 ★ 未测量臂：基线在场但为空 ⇒ unmeasured（空基线不等于"没事"）', () => {
  const reason = expectUnmeasured(checkMutationGuard(contextFor({ digests: {} }, [])))
  assert.match(reason, /no target file|nothing could be verified/i)
})

test('臂 2d ★ 未测量臂：基线里没有这个文件 ⇒ unmeasured（不假装知道它的原样）', () => {
  const reason = expectUnmeasured(checkMutationGuard(contextFor({ digests: {} }, [], { targets: [SUT_PATH] })))
  assert.match(reason, /not in the pre-mutation baseline|baseline/i)
})

test('臂 2e ★ 未测量臂：完全没有观察 ⇒ unmeasured', () => {
  const reason = expectUnmeasured(checkMutationGuard({ baseline: baselineFor([SUT_PATH]), observation: undefined }))
  assert.match(reason, /could not be observed|observation/i)
})

test('臂 2f ★ 未测量臂：当前指纹读不到 ⇒ unmeasured', () => {
  const baseline = baselineFor([SUT_PATH])
  const observation = { gitReadable: true, gitStatus: [], gitDiff: '' }
  const reason = expectUnmeasured(checkMutationGuard(contextFor(baseline, [SUT_PATH], { observation })))
  assert.match(reason, /digest|could not be read/i)
})

test('臂 2g ★ 未测量与残留【不同形】：一个说"我没能确认"，一个说"我发现你留下了缺陷"', () => {
  const baseline = baselineFor([SUT_PATH])
  const unmeasured = checkMutationGuard(contextFor(baseline, [SUT_PATH], {
    observation: { digests: observeNow([SUT_PATH]).digests, gitReadable: false },
  }))
  guardedWrite(sutPath, SUT_SOURCE.replace('value > 0', 'value >= 0'))
  const residual = checkMutationGuard(contextFor(baseline, [SUT_PATH]))
  restoreSut()

  assert.ok('unmeasured' in unmeasured && !('residues' in unmeasured), '★ 未测量不得携带 residues')
  assert.ok('residues' in residual && !('unmeasured' in residual), '★ 残留不得携带 unmeasured')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★ 对照臂：正常的 tree ⇒ ok
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 对照臂：tree 干净（内容与基线一致）⇒ ok', () => {
  const baseline = baselineFor([SUT_PATH])
  const verdict = expectOk(checkMutationGuard(contextFor(baseline, [SUT_PATH])))
  assert.deepEqual(verdict.checked, [SUT_PATH], '★ 通过时也要交出检查了哪些文件')
})

test('臂 3b ★ 对照臂：仓库"本来就有未提交改动" ⇒ 仍然 ok（不误伤开发中的仓库）', () => {
  /**
   * ★ 这条是本守卫【不误报】的关键。一个正在被开发的仓库天然是脏的；
   *   若把"git 脏"当成残留，守卫会天天误报，然后被人关掉。
   *   判据是"与【基线】不符"，不是"与 HEAD 不符"。
   */
  guardedWrite(join(sandbox, 'src', 'unrelated.ts'), 'export const x = 1\n')
  const baseline = baselineFor([SUT_PATH])
  const verdict = expectOk(checkMutationGuard(contextFor(baseline, [SUT_PATH])))
  rmSync(join(sandbox, 'src', 'unrelated.ts'), { force: true })
  void verdict
})

test('臂 3c ★ 对照臂：残留被恢复之后 ⇒ 回到 ok（证明守卫不是只要见过就永久拒绝）', () => {
  const baseline = baselineFor([SUT_PATH])
  guardedWrite(sutPath, SUT_SOURCE.replace('value > 0', 'value >= 0'))
  expectBlocked(checkMutationGuard(contextFor(baseline, [SUT_PATH])))
  restoreSut()
  expectOk(checkMutationGuard(contextFor(baseline, [SUT_PATH])))
})

test('臂 3d ★ 对照臂：只检查被指定的 targets（不把别人的改动算进来）', () => {
  guardedWrite(join(sandbox, 'src', 'other.ts'), 'export const y = 2\n')
  const baseline = baselineFor([SUT_PATH])
  const verdict = expectOk(checkMutationGuard(contextFor(baseline, [SUT_PATH], { targets: [SUT_PATH] })))
  assert.deepEqual(verdict.checked, [SUT_PATH])
  rmSync(join(sandbox, 'src', 'other.ts'), { force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数（解析器）：它们的错会让上面每一条臂都读错
// ─────────────────────────────────────────────────────────────────────────────

test('解析器：parseStatusLine 认得 porcelain 的形状', () => {
  assert.deepEqual(parseStatusLine(' M src/a.ts'), { code: ' M', path: 'src/a.ts' })
  assert.deepEqual(parseStatusLine('?? new.ts'), { code: '??', path: 'new.ts' })
  assert.deepEqual(parseStatusLine('R  old.ts -> new.ts'), { code: 'R ', path: 'new.ts' })
  assert.equal(parseStatusLine(''), undefined)
  assert.equal(parseStatusLine('x'), undefined)
})

test('解析器：parseHunkHeader 读的是【新文件】侧的行号', () => {
  assert.deepEqual(parseHunkHeader('@@ -1,3 +10,4 @@'), { startLine: 10, lineCount: 4 })
  assert.deepEqual(parseHunkHeader('@@ -1 +1 @@'), { startLine: 1, lineCount: 1 })
  assert.equal(parseHunkHeader('not a hunk'), undefined)
})

test('解析器：changedLinesFromDiff 不计删除行（- 在旧文件里，新文件没有对应行号）', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,3 @@',
    ' const keep = 1',
    '-const gone = 2',
    '+const added = 2',
    ' const tail = 3',
  ].join('\n')
  assert.deepEqual(changedLinesFromDiff(diff), [2], '★ 只报 + 行的新文件行号')
})

test('解析器：changedLinesFromDiff 对空/垃圾输入返回空数组而不是抛错', () => {
  assert.deepEqual(changedLinesFromDiff(''), [])
  assert.deepEqual(changedLinesFromDiff('hello\nworld'), [])
})

test('★ 解析器：残留行号真的来自 git diff（不是静默回退到 plannedMutants）', () => {
  /**
   * ★ MEASURED（本任务实现里抓到的真实缺陷）：切片时把 `diff --git` 那一行丢掉了
   *   ⇒ 按 header 匹配文件名永远失败 ⇒ 行号静默变成空数组、静默回退到"我们计划的
   *   那一行"。报告看起来仍然合理，但它不再基于真实 diff —— 一个"看起来对、
   *   其实没生效"的解析器。
   *
   *   这条臂把两件事分开：故意让 diff 说的行（4）与计划的变异体行（5）【不同】，
   *   于是"来自 diff"与"回退了"在结果上不再同形。
   */
  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -3,2 +3,3 @@',
    ' const keep = 1',
    '+const added = 2',
  ].join('\n')
  assert.equal(splitDiffChunks(diff).length, 1, '★ diff --git 那一行必须进它自己的块')

  const verdict = checkMutationGuard({
    baseline: {
      digests: { 'a.ts': 'before' },
      plannedMutants: [{ id: 'planned@L5', file: 'a.ts', line: 5, find: 'a<b', replace: 'a<=b' }],
    },
    observation: { digests: { 'a.ts': 'after' }, gitReadable: true, gitStatus: [' M a.ts'], gitDiff: diff },
    readFile: () => 'a<=b',
  })
  assert.equal(verdict.ok, false, '与基线不符 ⇒ 必须被拒')
  assert.deepEqual(verdict.residues[0].lines, [4], '★ 行号必须来自 diff（4），不是计划里的 5')
})

// ─────────────────────────────────────────────────────────────────────────────
// ★ 反事实：本夹具的"残留"必须真的是残留
// ─────────────────────────────────────────────────────────────────────────────

test('夹具自检：注入后的文件与基线【真的不同】（否则臂 1 证明不了任何事）', () => {
  const baseline = baselineFor([SUT_PATH])
  guardedWrite(sutPath, SUT_SOURCE.replace('value > 0', 'value >= 0'))
  assert.notEqual(digestOf(SUT_PATH), baseline.digests[SUT_PATH], '★ 注入必须真的改变文件')
  const residual = checkMutationGuard(contextFor(baseline, [SUT_PATH]))
  assert.equal(residual.ok, false, '★ 变了就必须被拒')
  restoreSut()
  assert.equal(digestOf(SUT_PATH), baseline.digests[SUT_PATH], '★ 还原必须逐字节回到基线')
})

test('夹具自检：沙箱是一个真实的 git 仓库（否则"读不到 git"那条臂没意义）', () => {
  assert.equal(git(['rev-parse', '--is-inside-work-tree']).trim(), 'true')
  assert.match(git(['rev-parse', '--verify', 'HEAD']).trim(), /^[0-9a-f]{40}$/)
})
