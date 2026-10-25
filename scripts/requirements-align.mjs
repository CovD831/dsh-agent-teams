#!/usr/bin/env node
/**
 * ── ★★★ 需求对齐（本仓自己的）—— `docs/REQUIREMENTS.md` ↔ 实现的**双向**比对 ────────
 *
 * ── 它回答的那个问题 ──────────────────────────────────────────────────────────────
 *
 * `docs/REQUIREMENTS.md:5` 逐字写着「它是**一份可对齐的清单** —— 供 `workbench-align`
 * 双向比对」。MEASURED（2026-10-21）：那条承诺在本仓**零落点** ——
 *
 * ```
 * $ find . -name "requirements-contract*" -not -path "./node_modules/*"   ⇒ 空
 * $ find . -name "workbench-align*"       -not -path "./node_modules/*"   ⇒ 空
 * $ node ~/Desktop/自动化开发插件/bin/workbench-align.mjs --repo .
 *   ✖ 26 claim(s) marked MET whose evidence is GONE   ← 26 条全指向另一个仓的文件
 * ```
 *
 * ── ★ 所以本命令**不做**那 37 条 claim 的事 ────────────────────────────────────────
 *
 * 它只读**本仓**的 37 条（`scripts/requirements-claims.mjs`），每条指向本仓的一个落点。
 * 判据是三条，都能机械回答：
 *
 * ```
 * ① 证据还在不在        file / symbol / command 三类 ⇒ `verified` / `gone`
 * ② 有没有一节没被认领    REQUIREMENTS.md 的 `## N.` 每一节都要有 claim
 * ③ 有没有 claim 指向不存在的节   指向被删的节 ⇒ 红
 * ```
 *
 * ── ★★ 三态，且 `manual` 永不并进 `verified` ───────────────────────────────────────
 *
 * ```
 * verified    机械核对过
 * unverified  ★ 只能靠读 —— 本命令**不声称**验证过它
 * gone        ★★ 声称已实现、而证据不在（唯一会让 exit 非 0 的一态）
 * ```
 *
 * 保留 `manual` 不是设计缺陷，是**诚实分级**：像"每条断言都要能在反向变红"这种
 * 跨整个程序的行为属性，用 grep 去"验证"它就是**把谎话打扮成检查**。
 * 一个声称"全部已验证"的报告会被忽略 —— 而这份报告值得被读的前提，正是它不这么说。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/requirements-align.mjs            # 人读
 *   node scripts/requirements-align.mjs --json     # 机器读（CI / diff）
 *   node scripts/requirements-align.mjs --sections # 只打印"每节被哪条 claim 认领"
 *
 * 退出码：`0` 无 `gone` 且无未认领节 / `1` 有 `gone` / `2` 读不到台账
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CLAIMS, buildAlignment } from './requirements-claims.mjs'

const ROOT = join(import.meta.dirname, '..')
const args = new Set(process.argv.slice(2))

if (args.has('--help') || args.has('-h')) {
  process.stdout.write(`requirements-align —— 本仓需求台账的机械对齐（只读）

  node scripts/requirements-align.mjs            人读
  node scripts/requirements-align.mjs --json     JSON
  node scripts/requirements-align.mjs --sections 每节被哪条 claim 认领

★ 三态不并：verified / unverified（只能靠读）/ gone（声称有、证据没了）
★ 只有 gone 会让 exit 非 0 —— unverified 是诚实分级，不是缺陷。
`)
  process.exit(0)
}

if (!existsSync(join(ROOT, 'docs', 'REQUIREMENTS.md'))) {
  process.stderr.write('requirements-align: docs/REQUIREMENTS.md not found — 台账是比对的源，没有它就没有可检查的东西。\n')
  process.exit(2)
}

const report = buildAlignment({ claims: CLAIMS, root: ROOT })

if (args.has('--json')) {
  process.stdout.write(`${JSON.stringify({
    counts: report.counts,
    evidenceGone: report.gone.map((claim) => ({
      id: claim.id, section: claim.section, claim: claim.claim, status: claim.status, note: claim.note,
    })),
    unclaimedSections: report.unclaimedSections,
    claimsPointingAtMissingSections: report.sectionsMissing,
    byReadingOnly: report.unverified.map((claim) => claim.id),
  }, null, 2)}\n`)
  process.exit(report.gone.length === 0 && report.unclaimedSections.length === 0 ? 0 : 1)
}

if (args.has('--sections')) {
  const lines = []
  for (const section of report.sections) {
    const owners = report.results.filter((claim) => claim.section === section).map((claim) => claim.id)
    lines.push(`§${String(section).padStart(2)}  ${owners.length === 0 ? '★ 没有 claim 认领' : owners.join(' ')}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
  process.exit(report.unclaimedSections.length === 0 ? 0 : 1)
}

const lines = []
lines.push('REQUIREMENTS ALIGNMENT （本仓自己的）')
lines.push('')
lines.push(`  ${report.counts.total} claims: ${report.counts.mechanicallyVerified} mechanically checked, ${report.counts.byReadingOnly} by reading only`)
lines.push('')
if (report.gone.length === 0) {
  /**
   * ★ 这一行**故意**在为空时也打印 —— 一个静默的段落与一个没跑的段落
   *   在读的人眼里是不可区分的（本仓 accounting 过的形态）。
   */
  lines.push('  ✖ 0 claim(s) marked MET whose evidence is GONE.')
  lines.push('       This line is printed on purpose: a silent section cannot be told apart')
  lines.push('       from a section that did not run.')
} else {
  lines.push(`  ✖ ${report.gone.length} claim(s) marked MET whose evidence is GONE:`)
  for (const claim of report.gone) {
    lines.push(`      ${claim.id}  §${claim.section} · status=${claim.status}`)
    lines.push(`          ${claim.claim}`)
    lines.push(`          ${claim.note}`)
  }
}
lines.push('')
if (report.unclaimedSections.length > 0) {
  lines.push(`  ◦ ${report.unclaimedSections.length} section(s) of REQUIREMENTS.md that NO claim covers:`)
  lines.push(`      ${report.unclaimedSections.map((section) => `§${section}`).join(' · ')}`)
  lines.push('    ★ 一条新增需求若不认领，它就不会被任何门看见 —— 这正是 §23 存在的理由。')
} else {
  lines.push('  ◦ 0 unclaimed section(s) — 台账的每一节都有 claim 认领。')
}
lines.push('')
if (report.sectionsMissing.length > 0) {
  lines.push(`  ⚠ ${report.sectionsMissing.length} claim(s) point at a section that does not exist: ${report.sectionsMissing.join(' ')}`)
  lines.push('    ★ 指向被删的节：要么台账删了它，要么 claim 该跟着改 —— 两种补救动作不同，所以分开报。')
}
lines.push('  ── the honest split ──')
lines.push(`    mechanically verified : ${report.counts.mechanicallyVerified}`)
lines.push(`    by reading only       : ${report.counts.byReadingOnly}`)
lines.push('    This tool does NOT claim to have verified the second group.')
process.stdout.write(`${lines.join('\n')}\n`)

process.exit(report.gone.length === 0 && report.unclaimedSections.length === 0 ? 0 : 1)
