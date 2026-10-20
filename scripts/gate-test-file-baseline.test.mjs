/**
 * ── 「已存在的测试文件被改松了吗」的臂（2026-10-20，补 t5）───────────────────────
 *
 * ── 它防的是什么（三条重判据都拦不住的一条路径）────────────────────────────────────
 *
 * ```
 *   1. 真跑 `pnpm test`   —— 退出码 0 是**真的**
 *   2. 同一轮改松断言     —— `expect(x).toBe(3)` → `toBe(2)`
 *   3. 三条判据全部沉默：
 *      · completion.verify-rerun  不管（退出码确实是真的）
 *      · completion.r5            不管（它只管【新增】测试的父/子红绿，这里没有新增）
 *      · completion.mutation      不管（重活，且只在被触发时跑）
 * ```
 * ⇒ 我们为「测试**强不强**」建了三条重判据，而「测试**被改松了没**」
 *   这一道几乎零成本的关，**没有任何人管**。本夹具就是那一道。
 *
 * ── 三态（★ 三者**不同形**，这是全部理由）────────────────────────────────────────
 *
 *   `intact`     —— 快照里每个测试文件**逐字节没变**
 *   `weakened`   —— 有测试文件变了或被删了 ⇒ 调用方**拒绝**完成
 *   `unmeasured` —— **没能拍快照** / **没能读回** ⇒ ★ **绝不并进 `intact`**
 *
 * ★★ 而 `intact` 与 `unmeasured` 的区分是本文件最贵的一格：
 *   一个静默放行的 `unmeasured` 与 `intact` 同形，那正是本条存在的理由要防的东西。
 *
 * ── 每一条臂都对着一次定向突变（写在注释里）────────────────────────────────────────
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { testFileBaselineOf, shouldSnapshotTestFiles } = await import(join(ROOT, 'lib', 'quality-gates.js'))

const snap = (path, digest) => ({ path, digest })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 伪造臂）：测试被改松 ⇒ weakened，且**指名**是哪个文件
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1（伪造臂）：测试被改松 ⇒ weakened，并指名哪个文件', () => {
  /**
   * 定向突变：把 `if (now !== artifact.digest)` 那行删掉 ⇒ 本臂红。
   */
  const reading = testFileBaselineOf(
    [snap('scripts/a.test.mjs', 'AAA'), snap('scripts/b.test.mjs', 'BBB')],
    new Map([['scripts/a.test.mjs', 'CHANGED'], ['scripts/b.test.mjs', 'BBB']]),
  )
  assert.equal(reading.verdict, 'weakened')
  assert.deepEqual(reading.weakened, ['scripts/a.test.mjs'], '★ 必须**指名**，否则读的人不知道该还原哪一个')
  assert.equal(reading.baselineCount, 2, '★ 基线数要说得出（"改了几个/共几个"才是可行动的读数）')
})

test('★ 臂 1b（伪造臂）：测试文件被**删掉** ⇒ 同样 weakened', () => {
  /**
   * ★ 一条"我找不到它了"与"它没变"是**相反**的读数 —— 删掉测试比改松更彻底。
   * 定向突变：把 `if (now === undefined)` 那一支改成 `continue` ⇒ 本臂红。
   */
  const reading = testFileBaselineOf([snap('scripts/a.test.mjs', 'AAA')], new Map())
  assert.equal(reading.verdict, 'weakened', '★ 快照说它存在、现在找不到 ⇒ 那本身就是一个结论')
  assert.deepEqual(reading.weakened, ['scripts/a.test.mjs'])
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 未测量臂）：判不了**绝不**并进 intact
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（未测量臂）：快照**缺席** ⇒ unmeasured，与 intact 不同形', () => {
  /**
   * ★★★ 这一臂是本文件存在的全部理由。
   *   MEASURED 的形态：一个"没能检查"被读成"检查了、没事"。
   * 定向突变：把第一支 `return { verdict: 'unmeasured' … }` 改成 `intact` ⇒ 本臂红。
   */
  const absent = testFileBaselineOf(undefined, new Map())
  assert.equal(absent.verdict, 'unmeasured', '★★ 没能拍快照 ⇒ 判不了')
  assert.ok((absent.why ?? '').length > 0, '★ 必须说清**缺什么**（一句"未能测量"没有成因就是空话）')

  /** ★★ 而它与"拍了、当时一个测试都没有"**必须不同形**（反向半边）。 */
  const emptyBaseline = testFileBaselineOf([], new Map())
  assert.equal(emptyBaseline.verdict, 'intact', '★ 空数组是一条**读数**：开工时工作区里没有测试文件')
  assert.notEqual(
    emptyBaseline.verdict, absent.verdict,
    '★★★ 「没能拍」与「拍了、当时没有测试文件」绝不许同形',
  )
})

test('★★★ 臂 2b（未测量臂）：**读不回来** ⇒ unmeasured，不是 intact', () => {
  /**
   * ★ 与臂 2 是**两种不同的未测量**：一个是没拍，一个是拍完读不回。
   * 定向突变：把第二支改成 `intact` ⇒ 本臂红。
   */
  const unreadable = testFileBaselineOf([snap('scripts/a.test.mjs', 'AAA')], undefined)
  assert.equal(unreadable.verdict, 'unmeasured')
  assert.match(unreadable.why ?? '', /could not be read back/, '★ 成因必须与"没拍快照"那句**措辞不同**')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★★ 对照臂）：没被改 ⇒ intact
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（对照臂）：逐字节没变 ⇒ intact', () => {
  /**
   * ★ 反向半边：一条"恒 weakened"的实现能过臂 1，而过不了本臂。
   */
  const reading = testFileBaselineOf(
    [snap('scripts/a.test.mjs', 'AAA'), snap('scripts/b.test.mjs', 'BBB')],
    new Map([['scripts/a.test.mjs', 'AAA'], ['scripts/b.test.mjs', 'BBB']]),
  )
  assert.equal(reading.verdict, 'intact')
  assert.deepEqual(reading.weakened, [], '★ intact 时名单必须为空（不是"没填"）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★ 反面臂）：**新写的**测试不算 weakened
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4（反面臂）：**新增**的测试文件不算"改松"', () => {
  /**
   * ── 为什么这一臂必须有（没有它，判据会在第一天被学会忽略）──────────────────────
   *
   * 修复任务**本来就可能要加测试**。而"加了"与"改松了"是**相反**的两件事：
   *   · 加了测试 ⇒ 判据变强 ⇒ **不该拒**
   *   · 改松断言 ⇒ 判据变弱 ⇒ **该拒**
   *
   * ★ 本判据的口径**结构上**就分开了这两件事：快照里只有**开工时已存在**的文件
   *   （`enumerateTestFiles` 只收 `isFile()` 的）⇒ 后写的自然不在快照里
   *   ⇒ 它不参与比对。
   * 定向突变：让 `testFileBaselineOf` 去比 `current` 里**所有**的键（而不是只比快照里的）
   *   ⇒ 本臂红。
   */
  const reading = testFileBaselineOf(
    [snap('scripts/old.test.mjs', 'AAA')],
    /** ★ 现在多了一个全新的测试文件，而快照里那个没变。 */
    new Map([['scripts/old.test.mjs', 'AAA'], ['scripts/brand-new.test.mjs', 'ZZZ']]),
  )
  assert.equal(reading.verdict, 'intact', '★★ 新增测试是**加**，不是减 —— 拒它会让每一个合法的补测试都被拦')
  assert.equal(reading.baselineCount, 1, '★ 而基线数只说快照里有几个（新文件不进这个数）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★ 闸门臂）：哪些 kind 该被拍
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（闸门臂）：只有写类 kind 才拍快照；只读类不拍', () => {
  /**
   * ★ 给 `review` / `requirements` 拍快照只会产生一份**永远用不上**的记录 ——
   *   而"一个没人读的读数"正是本轮审计在清理的东西。
   * 定向突变：把 `shouldSnapshotTestFiles` 改成恒 `true` ⇒ 本臂红。
   */
  assert.equal(shouldSnapshotTestFiles('implementation'), true)
  assert.equal(shouldSnapshotTestFiles('repair'), true)
  assert.equal(shouldSnapshotTestFiles('review'), false, '★ 只读判断不改文件 ⇒ 不拍')
  assert.equal(shouldSnapshotTestFiles('requirements'), false)
  assert.equal(shouldSnapshotTestFiles(undefined), false, '★ 缺省 kind 按 work 读 ⇒ 不拍')
  /**
   * ★★ 一处**如实标出**的边界：`integration` 也会写文件，而它**不在**这个集合里
   *   ⇒ 它的比对落 `unmeasured`（**不是** `intact`）。
   *   ★ 这一格由臂 2 的三态保证读得出来 —— 没人会把"没被检查"读成"没被改"。
   */
  assert.equal(
    shouldSnapshotTestFiles('integration'), false,
    '★ integration 不拍 —— 这是**已知边界**，而三态保证它读成 unmeasured 而不是 intact',
  )
})
