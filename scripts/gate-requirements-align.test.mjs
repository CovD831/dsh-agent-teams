/**
 * ── 需求对齐判据的臂（§23 的反向半边）──────────────────────────────────────────────
 *
 * ── 为什么这个文件必须存在 ────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-21 审计）：本仓的 `docs/REQUIREMENTS.md` 有 **832 行**，
 * 而在此之前**没有任何一个命令读它**（`grep -rn "REQUIREMENTS.md" scripts/ | grep -c claims`
 * ⇒ 0）。台账第 5 行写着「供 `workbench-align` 双向比对」，而那个工具住在另一个仓、
 * 37 条 claim 硬编码的是那个仓的文件路径 ⇒ 指向本仓跑出来是 26 条「证据消失」。
 *
 * ⇒ 后果：**这份台账在过去若干轮里没有任何东西检查它是否还在生效**，而它已经漂了三处
 *   （§12 的「⬜未实现」被两小时后的 `7309ed1` 实现了一半；§5 写 21 条判据而实测 22 条；
 *   README 仍写 14 个工具而实测 17 个）。
 *
 * ── ★ 本文件的重点不是"对齐能跑"，而是"它**会红**" ─────────────────────────────────
 *
 * 一个只在成功时被跑的对齐命令，与一个恒绿的命令在读数上同形。
 * ⇒ 下面每一条**反向臂**都是"把那个东西弄坏 ⇒ 必须红"：
 *
 * ```
 * 臂 2  一条 met 的 file 证据指向不存在的路径          ⇒ 必须 gone
 * 臂 3  一条 met 的 symbol 只出现在注释里               ⇒ 必须 gone（§12.4 那条实测）
 * 臂 4  一条 gap 的探针被强制成真                        ⇒ 必须 claim-stale（不是 verified）
 * 臂 5  台账少了一节（claim 指向不存在）                ⇒ 必须 non-empty sectionsMissing
 * 臂 6  台账多了一节而无人认领                            ⇒ 必须 non-empty unclaimedSections
 * 臂 7  拼错的探针名                                     ⇒ 必须 gone（不许静默变绿）
 * 臂 8  manual 永不并进 verified                          ⇒ 计数分列
 * ```
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const {
  CLAIMS, PROBES, buildAlignment, verdictOf, evaluateCheck, sectionsOf, isBlocking,
} = await import(join(ROOT, 'scripts', 'requirements-claims.mjs'))

/** 造一棵最小的假仓库：只放本臂要用的文件。 */
function fixture(t, { requirements = '## 1. 一条需求\n', files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'req-align-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(join(root, 'docs', 'REQUIREMENTS.md'), requirements)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

const claim = (patch) => ({
  id: 'X1', section: 1, status: 'met', claim: '一条', check: { kind: 'manual' }, note: '', ...patch,
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：正向半边 —— 本仓此刻的台账，没有 gone / stale / 未认领节
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 1（正向半边）：本仓的 38 条 claim 没有一条「证据消失」', () => {
  const report = buildAlignment({ claims: CLAIMS, root: ROOT })
  assert.deepEqual(
    report.gone.map((entry) => entry.id), [],
    '★★ 有 claim 声称已实现而证据不在 —— 去补实现，或把 claim 的 status 降级',
  )
  assert.deepEqual(
    report.stale.map((entry) => entry.id), [],
    '★★ 有 gap 已经闭合而台账还写着 gap —— 去**改台账**（这与"去补实现"方向相反，故分开断言）',
  )
  assert.deepEqual(report.unclaimedSections, [], '★ 台账有一节没有任何 claim 认领')
  assert.equal(isBlocking(report), false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：反向半边 —— file 证据指向不存在的路径 ⇒ gone
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 2（反向半边）：一条 `met` 的 file 证据指向不存在的路径 ⇒ `gone`', (t) => {
  const root = fixture(t)
  const missing = claim({ check: { kind: 'file', path: 'nope/missing.mjs' } })
  assert.equal(verdictOf(missing, root), 'gone', '★★ 这条臂是本文件存在的理由：证据消失必须变红')

  const present = fixture(t, { files: { 'here.mjs': 'x' } })
  assert.equal(verdictOf(claim({ check: { kind: 'file', path: 'here.mjs' } }), present), 'verified')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：反向半边 —— 只出现在**注释**里的符号不算能力（§12.4 那条实测）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 3：`symbol` 只在注释里出现 ⇒ `gone`（注释不是能力）', (t) => {
  const commented = fixture(t, {
    files: { 'src/a.ts': "// export const id = 'x.y'\n/* import * as z from './z.ts' */\nconst real = 1\n" },
  })
  assert.equal(
    verdictOf(claim({ check: { kind: 'symbol', file: 'src/a.ts', pattern: 'export const id' } }), commented),
    'gone',
    '★★ 一个把注释认证为能力的检查器，比没有检查器更糟：它把真实缺口变成一行绿色',
  )

  const real = fixture(t, { files: { 'src/a.ts': "export const id = 'x.y'\n" } })
  assert.equal(
    verdictOf(claim({ check: { kind: 'symbol', file: 'src/a.ts', pattern: 'export const id' } }), real),
    'verified',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★ 缺口闭合 ⇒ claim-stale（**不是** verified）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 4：一条 `gap` 的证据被**人为**弄成成立 ⇒ `claim-stale`，而不是 `verified`', (t) => {
  const root = fixture(t, { files: { 'closed.txt': 'x' } })
  /**
   * ★★ 这一条是**对称判据**的落点。若这里返回 `verified`，那么"缺口被补上了"
   *   与"台账早就写对了"同形 —— 而前者要求去**改文档**，后者要求什么都别做。
   * ★ 用 file 证据而不是往 PROBES 里塞函数：`PROBES` 是 `Object.freeze` 的，
   *   而**能被测试改写的判据表**本身就是一个缺陷（它允许"把红改绿"）。
   */
  assert.equal(
    verdictOf(claim({ status: 'gap', check: { kind: 'file', path: 'closed.txt' } }), root),
    'claim-stale',
  )
  assert.equal(
    verdictOf(claim({ status: 'gap', check: { kind: 'file', path: 'still-open.txt' } }), root),
    'gap-open',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：台账少了一节 ⇒ sectionsMissing 非空
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 5：claim 指向一个**不存在**的节 ⇒ `sectionsMissing` 非空', (t) => {
  const root = fixture(t, { requirements: '## 1. 只有这一节\n' })
  const report = buildAlignment({ claims: [claim({ section: 1 }), claim({ id: 'X2', section: 99 })], root })
  assert.deepEqual(report.sectionsMissing, ['X2'])
  assert.deepEqual(report.unclaimedSections, [], '§1 有认领 ⇒ 不该报未认领')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：台账多了一节而无人认领 ⇒ unclaimedSections 非空
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 6：台账有一节**没有任何 claim 认领** ⇒ `unclaimedSections` 非空，且判定阻塞', (t) => {
  const root = fixture(t, { requirements: '## 1. 甲\n\n## 2. 乙\n' })
  const report = buildAlignment({ claims: [claim({ section: 1 })], root })
  assert.deepEqual(report.unclaimedSections, [2], '★ 一条新增需求若不认领，它就不会被任何门看见')
  assert.equal(isBlocking(report), true)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：拼错的探针名 ⇒ gone（不许静默变绿）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 7：一条 typo 的探针名 ⇒ `gone`（未知的 check 种类同样不许读成通过）', (t) => {
  const root = fixture(t)
  assert.equal(verdictOf(claim({ check: { kind: 'probe', probe: 'not-a-probe' } }), root), 'gone')
  assert.equal(verdictOf(claim({ check: { kind: 'nonsense' } }), root), 'gone')
  /** ★ 而 `manual` 是**判不了**，不是"通过"，也不是"红"。 */
  assert.equal(verdictOf(claim({ check: { kind: 'manual' } }), root), 'unverified')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：manual 永不并进 verified（诚实分级）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 8：`manual` 的 claim 落在 byReadingOnly，**不**落 mechanicallyVerified', (t) => {
  const root = fixture(t)
  const report = buildAlignment({
    claims: [
      claim({ id: 'A', check: { kind: 'manual' } }),
      claim({ id: 'B', check: { kind: 'file', path: 'docs/REQUIREMENTS.md' } }),
    ],
    root,
  })
  assert.equal(report.counts.mechanicallyVerified, 1)
  assert.equal(report.counts.byReadingOnly, 1)
  assert.deepEqual(report.unverified.map((entry) => entry.id), ['A'])
  assert.deepEqual(report.verified.map((entry) => entry.id), ['B'])
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9：探针不翻转方向（方向属于 claim）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 9：同一个探针在 `met` 与 `gap` 两种 status 下给出**相反**结论', (t) => {
  const root = fixture(t, { files: { 'flag.txt': 'x' } })
  const holds = claim({ check: { kind: 'file', path: 'flag.txt' } })
  const missing = claim({ check: { kind: 'file', path: 'absent.txt' } })
  assert.equal(verdictOf({ ...holds, status: 'met' }, root), 'verified')
  assert.equal(verdictOf({ ...holds, status: 'gap' }, root), 'claim-stale')
  assert.equal(verdictOf({ ...missing, status: 'met' }, root), 'gone')
  assert.equal(verdictOf({ ...missing, status: 'gap' }, root), 'gap-open')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10：节号解析只看 `## N.` —— 不收 `### N.` 与代码块里的 `## `
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 10：节号只认二级标题 `## N.`', () => {
  assert.deepEqual(sectionsOf('# 标题\n\n## 3. 甲\n\n### 4. 乙\n\n```\n## 5. 代码块里\n```\n'), [3])
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 11：探针集合本身可枚举（一个拼错名字的 claim 能被这条臂抓到）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 11：每一条 claim 的 probe 都在 PROBES 里（拼错名字 ⇒ 本条红）', () => {
  const unknown = CLAIMS
    .filter((entry) => entry.check?.kind === 'probe')
    .filter((entry) => PROBES[entry.check.probe] === undefined)
    .map((entry) => `${entry.id}:${entry.check.probe}`)
  assert.deepEqual(unknown, [], '★ 拼错的探针名在运行期会 `gone`，但那要等到跑对齐时；本条在建的时候就拦')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 13：★ 反向半边 —— 文档里的工具数**漂一格就红**
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 13（反向半边）：文档写错工具数 ⇒ `doc-tool-counts-match` 变红', (t) => {
  const root = fixture(t, {
    requirements: '## 1. 一条需求\n',
    files: {
      'src/tool-names.ts': "export const TEAM_TOOL_NAMES = ['agent_teams_create', 'agent_teams_approve'] as const\n",
      'README.md': 'the plugin provides 2 coordination tools, persistent state\n',
    },
  })
  assert.equal(PROBES['doc-tool-counts-match'](root), true, '★ 2 个工具 + 文档写 2 ⇒ 一致')
  /** ★★ 把文档改成 14 ⇒ 必须红。这一格是本仓**真实发生过**的漂移（14 一路漂到 17）。 */
  writeFileSync(join(root, 'README.md'), 'the plugin provides 14 coordination tools, persistent state\n')
  assert.equal(
    PROBES['doc-tool-counts-match'](root), false,
    '★★ 文档写着过期工具数而没人发现 —— 这正是"一个写着过期数字的文档比没有那个数字更坏"',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 12：`evaluateCheck` 对 manual 返回 `holds: undefined`（不是 false）
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 12：`evaluateCheck` 对 `manual` 返回 `undefined`，**不是** false', () => {
  const result = evaluateCheck(claim({ check: { kind: 'manual' } }))
  assert.equal(result.kind, 'manual')
  /** ★★ 若这里返回 false，`manual` 会在 `met` 下被读成 `gone`（假红），在 `gap` 下被读成 `gap-open`（假绿）。 */
  assert.equal(result.holds, undefined)
})
