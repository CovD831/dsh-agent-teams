/**
 * ── ★★★ t95（吸收上游 #183 / `648fd9a`）：推导侧与闸门侧**共用同一个排除谓词** ────────
 *
 * ── 缺陷是什么（t95 开工在本仓复现）────────────────────────────────────────────
 *
 * ```
 * repairScopeFromFindings([{ file: 'secrets/k.json' }, { file: 'src/a.ts' }])
 *   ⇒ 推导出的 inScope = ["secrets/k.json","src/a.ts"]
 * ★ 而闸门对第一条的裁决 = `out_of_scope`（`classifyChangedPath` 的【第一行】就查它）
 * ⇒ ★★ 一条路径被【写进】 inScope，而闸门仍然判它 out_of_scope
 * ⇒ ★★★ 【契约自身不可满足】—— 成员无论怎么做都过不了，于是死锁。
 * ```
 *
 * ★★ 而根因**不是"两份谓词"**（本仓只有一份），而是：
 *   **推导侧【根本没用它】** —— 那一侧自己收集路径，**从不问闸门**。
 *
 * 上游 #183 逐字：
 * > 「`repairScopeFromFindings` collected paths the completion gate classifies
 * >   `out_of_scope` by default (secrets/, .env*, .git, .dsh, .agent-teams),
 * >   **producing unsatisfiable contracts.**
 * >   ★ Derivation and gate now **share one exclusion predicate**;
 * >   findings whose every cited path is excluded **escalate with a reason
 * >   instead of dead-locking a member.**」
 *
 * ── 本夹具钉的四件事（前三条是反向半边）──────────────────────────────────────
 *
 *   臂 1（反向半边 A）：被排除的路径**不许**出现在推导出的 inScope 里
 *   臂 2（反向半边 B）：正常路径**必须**仍在（不许把全部路径都滤掉）
 *   臂 3（反向半边 C）：每条候选路径都被排除的 finding ⇒ **升级并给理由**
 *   臂 4（共用性）：推导侧与闸门侧**用同一个谓词** —— 且改规则时只有一处改
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  repairScopeFromFindings,
  findingDerivedPaths,
  excludedFindingsOf,
  planQualityFollowUp,
} = await import('../lib/quality-gates.js')
const { classifyChangedPath, isDefaultExcludedPath } = await import('../lib/quality-gates/predicates.js')

/** 一条最小的 finding（只填本判据读的那几格）。 */
const finding = (id, file, requiredFix = 'fix it') => ({ id, severity: 'high', file, problem: 'p', requiredFix })

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★ 反向半边 A：被排除的路径不许进 inScope
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（反向半边 A）：被默认排除的路径【不许】出现在推导出的 inScope 里', () => {
  /**
   * ★ 用**闸门自己**的判据来挑"哪些是被排除的" ——
   *   而不是在本夹具里另抄一份名单（抄一份就是分叉的开始）。
   */
  const excludedCandidates = ['secrets/k.json', '.env', '.git/config', '.dsh/x', '.agent-teams/foo.json']
  for (const path of excludedCandidates) {
    assert.equal(
      classifyChangedPath(path), 'out_of_scope',
      `★ 前提：${path} 必须被闸门判为 out_of_scope（否则本臂没有对象）`,
    )
  }
  const scope = repairScopeFromFindings(
    [...excludedCandidates.map((path, index) => finding(`F${index}`, path)), finding('F9', 'src/a.ts')],
    undefined,
  )
  for (const path of excludedCandidates) {
    assert.ok(
      !(scope ?? []).includes(path),
      `★★ 被排除的路径 ${path} 出现在了 inScope 里 —— `
      + '而那会让闸门把一条【它自己写进 inScope 的路径】判成 out_of_scope ⇒ 契约自身不可满足',
    )
  }
  console.log(`    ℹ 推导出的 inScope = ${JSON.stringify(scope)}（${excludedCandidates.length} 条被排除的都没进去）`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边 B：正常路径必须仍在（不许全滤掉）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（反向半边 B）：正常路径【必须】仍在 inScope 里 —— 不许把全部路径都滤掉', () => {
  const scope = repairScopeFromFindings([finding('F1', 'src/a.ts'), finding('F2', 'tests/b.mjs')], undefined)
  assert.ok((scope ?? []).includes('src/a.ts'), '★ src/a.ts 必须仍在（过滤不是"清空"）')
  assert.ok((scope ?? []).includes('tests/b.mjs'), '★ tests/b.mjs 必须仍在')
  /**
   * ★★ 这条断言看着笨，但它挡的是最坏的那一类"修法"：
   *   把 `repairScopeFromFindings` 改成**恒返回空**也能让臂 1 变绿 ——
   *   而那样每个修复任务的 inScope 都空了，**比原缺陷更坏**。
   */
  assert.equal(scope.length, 2, '★ 两条正常路径都要在（不是 0，也不是 1）')

  /** ★ 而 `requiredFix` 里引用的路径同样要能推导出来。 */
  const viaFix = repairScopeFromFindings([finding('F3', 'src/x.ts', 'also touch src/y.ts and src/z.ts')], undefined)
  assert.ok(viaFix.includes('src/y.ts') && viaFix.includes('src/z.ts'), `★ requiredFix 里的路径也要推出来：${JSON.stringify(viaFix)}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★★ 反向半边 C：每条候选路径都被排除 ⇒ 升级并给理由
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 3（反向半边 C）：每条候选路径都被排除的 finding ⇒ 【升级并给理由】，不许静默丢', () => {
  /** ① 谓词层：`excludedFindingsOf` 要能把它挑出来。 */
  const all = [
    finding('F1', 'secrets/k.json'),
    finding('F2', 'src/a.ts'),
    finding('F3', '.env'),
  ]
  const excluded = excludedFindingsOf(all)
  assert.deepEqual(
    excluded.map((item) => item.id).sort(), ['F1', 'F3'],
    '★★ 只有【每条路径都被排除】的才被挑出来（F2 有正常路径 ⇒ 不算）',
  )
  /**
   * ★★ 而"一条 finding **根本没报路径**"**不算**被排除 ——
   *   那不是"路径被排除"，而是"没给路径"，两者补救动作不同。
   */
  const noPath = excludedFindingsOf([{ id: 'F4', severity: 'high', problem: 'p', requiredFix: 'fix it' }])
  assert.deepEqual(noPath, [], '★ 没报路径的 finding 不算"被排除"（那是另一个问题：审查员漏填了 file）')

  /** ② 编排层：全部 finding 都被排除 ⇒ 升级，且**带 reason**。 */
  const closed = {
    id: 'review-1', kind: 'review', status: 'failed', verdict: 'needs_revision',
    subject: 'review-1', findings: [finding('F1', 'secrets/k.json'), finding('F3', '.env')],
    reviewedTaskId: 'impl-1', round: 1,
  }
  const impl = { id: 'impl-1', kind: 'implementation', status: 'completed', subject: 'impl', assignee: 'alice' }
  const team = {
    id: 'team1', phase: 'running', halted: false,
    members: [
      { id: 'm1', name: 'alice', status: 'active' },
      { id: 'm2', name: 'bob', status: 'active' },
    ],
    tasks: [impl, closed],
  }
  const planned = planQualityFollowUp(team, closed)
  assert.equal(planned.escalated, true, '★★ 全部被排除 ⇒ 必须升级（不许静默丢、也不许死锁）')
  assert.equal(planned.status, 'escalated')
  /**
   * ★★★ 而 `reason` 是**这次改动的重点之一**：
   *   缺它时"升级"只有一个布尔 ⇒ 读的人**不知道去做什么**。
   */
  assert.equal(typeof planned.reason, 'string', '★★ 升级必须**给理由**（不是只有一个布尔）')
  assert.ok(planned.reason.includes('out_of_scope'), `★ 理由要说清【为什么】不可满足：${planned.reason}`)
  assert.ok(planned.reason.includes('human must decide'), '★ 理由要指出补救动作是【找人】')
  assert.deepEqual(planned.excludedFindings, ['F1', 'F3'], '★★ 哪些 finding 需要人裁决，要可机读')
  assert.deepEqual(planned.created, [], '★ 升级时**不**生成任务（那正是"不死锁"的落点）')
  console.log(`    ℹ 升级理由：${planned.reason}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 共用性：一个谓词，两处共用（改规则时只有一处改）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4：推导侧与闸门侧【用同一个谓词】—— 改排除规则时只有一处改', () => {
  /**
   * ★★ 判据是**机械的**：对同一批路径，闸门说"排除"的那些，
   *   推导侧**必须**同样把它们排除掉 —— 两侧不许有任何一条不一致。
   *
   * ★ 而这条臂**不需要知道排除名单是什么**（那是 `isDefaultExcludedPath` 的事）：
   *   它只要求**两侧结论一致** ⇒ 将来**改规则**（加一条被排除的前缀）时，
   *   本臂**照样**成立，而那些"两侧分叉"的实现会当场红。
   */
  const probes = [
    'src/a.ts', 'tests/b.mjs', 'docs/c.md',
    'secrets/k.json', '.env', '.env.local', '.git/config', '.dsh/x',
    '.agent-teams/frictions/f-0001.json', 'id_rsa', 'nested/secrets/deep.txt',
    'src/secrets.md',            // ★ 名字里有 secrets 但是个文件名（不是目录段）
    'a/.env.example',            // ★ .env.example —— base 以 .env. 开头 ⇒ 排除
  ]
  for (const path of probes) {
    const gateSaysExcluded = classifyChangedPath(path) === 'out_of_scope' && isDefaultExcludedPath(path)
    const derivationKeepsIt = (repairScopeFromFindings([finding('F', path)], ['FALLBACK']) ?? []).includes(path)
    assert.equal(
      derivationKeepsIt, !gateSaysExcluded,
      `★★ 两侧对 ${path} 的结论不一致：闸门 ${gateSaysExcluded ? '排除' : '保留'}，`
      + `而推导侧 ${derivationKeepsIt ? '保留' : '排除'} —— 那正是"契约不可满足"的成因`,
    )
  }
  /**
   * ★★ 而"共用"的**唯一可核证据**是：推导侧的排除结论**完全由**
   *   `isDefaultExcludedPath` 决定 —— 即"去掉它，推导侧就不再排除任何东西"。
   *   ★ 若推导侧自己另写了一份名单，这条对拍**不会**呈现这个性质。
   */
  const everyProbe = probes.filter((path) => isDefaultExcludedPath(path))
  assert.ok(everyProbe.length >= 5, '★ 前提：探针里要有足够多的"被排除"样本（否则本臂没有对象）')
  for (const path of everyProbe) {
    const kept = (repairScopeFromFindings([finding('F', path)], ['FALLBACK']) ?? []).includes(path)
    assert.equal(kept, false, `★★ ${path} 被 isDefaultExcludedPath 判为排除，而推导侧仍保留了它`)
  }
  console.log(`    ℹ 对拍 ${probes.length} 条路径：两侧结论**逐条一致**（${everyProbe.length} 条被排除）`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★ 前提臂：这个缺陷曾经真的存在（否则本夹具是空转）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 5（前提臂）："契约自身不可满足"是可复现的 —— 一条被排除的路径确实会被闸门拒', () => {
  /**
   * ★★ 本臂不测修复后的行为，而是**钉住"这个洞是真的"**：
   *   若某天 `classifyChangedPath` 不再先看默认排除，
   *   那么臂 1 就没有对象了（它会恒真）⇒ 本臂当场红，提醒"该重审这个判据了"。
   */
  assert.equal(classifyChangedPath('secrets/k.json'), 'out_of_scope', '★ 闸门必须先看默认排除（那是臂 1 的前提）')
  assert.equal(classifyChangedPath('secrets/k.json', ['secrets/k.json'], []), 'out_of_scope',
    '★★ 而**哪怕它被明确写进 inScope**，闸门仍然拒它 —— ★ 这就是"契约自身不可满足"的精确形态')
  assert.equal(findingDerivedPaths(finding('F', 'secrets/k.json')).length, 1,
    '★ 而 finding 确实会报出这条路径（收集侧看见它了）')
})
