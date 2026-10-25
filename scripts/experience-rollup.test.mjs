/**
 * ── C3 经验聚合（`scripts/experience-rollup.mjs`）的臂 ────────────────────────────
 *
 * 契约见 `docs/PENDING-FRICTION-REFORM.md` §2（C3）与用户原话：
 *   > 「关于经验，其实要么是不断踩坑的地方，要么是执行过程中得到的有价值的东西。」
 * ⇒ **经验 = 同一个坑被踩出来的次数。**
 *
 * ── ★★★ 本文件的形状：正向臂 + **控制臂** + 三态臂 + 定向突变臂 ──────────────────
 *
 *   · 正向臂（臂 1）：同一个坑两次 ⇒ **报**。
 *   · 控制臂（臂 2）：同一个坑**一次** ⇒ **不报**。
 *     ★ **它是本文件最重要的一条**。一个"凡出现就报"的实现会让臂 1 全绿 ——
 *       它报得比正确实现还多。⇒ 只有"只踩一次的坑必须闭嘴"这条能把
 *       「真的在计数」与「它什么都报」分开。
 *       （本仓库记过的一般形式：「正向臂只喂『该被拒』的输入，所以它测不出『一律拒绝』」。）
 *   · 三态臂（臂 4/5）：`cannot-tell` **不许**并进另外两态 —— 两个方向各一条。
 *   · 突变臂（臂 7）：把阈值判据**反过来/抹平** ⇒ 控制臂必须变红。
 *     ★ 没有它，"控制臂存在"与"控制臂在起作用"是两件事（本仓 t79 那条教训）。
 *
 * ── ★ 用的是【临时台账】而不是真台账 ────────────────────────────────────────────
 *
 * 与 `gate-friction-capture.test.mjs` 的隔离臂同一条纪律：夹具**绝不**往真台账里
 * 写东西（台账是记录，污染之后不可重算）。本文件对真台账**只读**，且只在臂 6 里读。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { rollup, pitKeyOf, verbatimOf, loadLedger, render, parseArgs, gateIdFromTitle, DEFAULT_THRESHOLD } from './experience-rollup.mjs'

const SCRIPT = fileURLToPath(new URL('./experience-rollup.mjs', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 造一条**最小可信**的记录：只带 `rollup` 真正读的那几格。
 * ★ 刻意**不**造一个完整的 `recordFriction` 产物 —— 本脚本只读台账，
 *   而"台账里到底有哪些字段"是采集侧的事（C3 不改采集）。
 */
function record(id, component, { title, note } = {}) {
  return {
    id,
    at: '2026-10-11T00:00:00.000Z',
    title: title ?? `${id} title`,
    index: component === undefined ? {} : { component },
    observed: note === undefined ? {} : { verdict: { ok: false, note } },
    resolution: { blocking: false, pool: 'self' },
  }
}

/** 一个临时台账目录 + 它的记录。 */
function ledger(records) {
  const dir = mkdtempSync(join(tmpdir(), 'rollup-'))
  for (const item of records) {
    writeFileSync(join(dir, `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`, 'utf8')
  }
  return dir
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（★ 正向臂）：同一个坑踩 **2** 次 ⇒ 报「这该是判据了」
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 正向臂：同一个坑出现 2 次 ⇒ 报出它，且附那 2 次的原话', () => {
  const report = rollup([
    record('f-0001', 'dispatch.changed-paths', { note: '第一次的原话' }),
    record('f-0002', 'dispatch.changed-paths', { note: '第二次的原话' }),
  ])
  assert.equal(report.shouldBeGates.length, 1, '★ 一个坑踩了两次 ⇒ 恰好一条提案')
  const [group] = report.shouldBeGates
  assert.equal(group.key, 'dispatch.changed-paths', '★ 提案要说清是**哪个坑**')
  assert.equal(group.count, 2, '★ 而次数要如实数出来')
  /**
   * ★ 契约要求「附那 N 次的原话」—— 不是摘要，是**原文**。
   *   ⇒ 断言的是那两句**逐字在场**。
   */
  const said = group.occurrences.map((o) => o.verbatim.spoken)
  assert.deepEqual(said, ['第一次的原话', '第二次的原话'], `★ 那 N 次的原话必须都在。实测：${JSON.stringify(said)}`)
  assert.deepEqual(group.occurrences.map((o) => o.id), ['f-0001', 'f-0002'], '★ 还要指得出是哪几条记录')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★★★ 控制臂）：同一个坑只踩 **1** 次 ⇒ **不报**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（控制臂）：同一个坑只出现 1 次 ⇒ **不报**（否则分不清「在计数」与「什么都报」）', () => {
  const report = rollup([record('f-0001', 'completion.mutation', { note: '只踩了一次' })])
  assert.equal(
    report.shouldBeGates.length, 0,
    '★★★ 只踩一次的坑**不许**产出提案 —— 一个"凡出现就报"的实现会让臂 1 全绿，'
    + '所以只有这条能把「真的在计数」与「它什么都报」分开',
  )
  /**
   * ★ 而它必须出现在**另一格**（`belowThreshold`）——
   *   "没够次数"与"没看见它"不同形：前者是结论，后者是漏了。
   */
  assert.equal(report.belowThreshold.length, 1, '★ 它必须被**数到**，只是不够次数 —— 不是被丢掉')
  assert.equal(report.belowThreshold[0].key, 'completion.mutation')
  assert.equal(report.belowThreshold[0].count, 1)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 对照对）：同一条臂在 1 次与 2 次下**裁决不同形**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3（对照对）：唯一的自变量是**次数** ⇒ 1 次不报、2 次报', () => {
  /**
   * ★ 这一条把臂 1 与臂 2 钉成**一个对照对**：两个输入除了次数完全一样。
   *   ⇒ "报了"这件事只能归因于次数，而不能归因于"这两条记录碰巧不同"。
   */
  const one = rollup([record('f-0001', 'same.pit')])
  const two = rollup([record('f-0001', 'same.pit'), record('f-0002', 'same.pit')])
  assert.equal(one.shouldBeGates.length, 0, '★ 1 次 ⇒ 不报')
  assert.equal(two.shouldBeGates.length, 1, '★ 2 次 ⇒ 报')
  assert.notEqual(
    one.shouldBeGates.length, two.shouldBeGates.length,
    '★★ 同一个坑在两种次数下必须**不同形** —— 否则这条脚本对"次数"没有分辨力',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★★ 三态 · 方向一）：读不出坑 ⇒ `cannot-tell`，**不许**被读成"次数不够"
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4（三态 · 方向一）：读不出属于哪个坑 ⇒ cannot-tell，**不并进** below-threshold', () => {
  /**
   * ★ 这是三态里最容易写坏的那个方向：把"我没能分类"读成"这个坑只踩了一次"。
   *   后果是**最该被看见的那些记录被藏起来**（连 id 都读不出来的记录，
   *   恰恰说明接线有缺口）。
   */
  const report = rollup([record('f-0001', undefined, { note: '这条说不出自己属于哪个坑' })])
  assert.equal(report.cannotTell.length, 1, '★★ 它必须落在 cannot-tell 这一格')
  assert.equal(
    report.belowThreshold.length, 0,
    '★★★ 而**不许**落进 below-threshold —— 那会把"我没能分类"读成"这个坑只踩了一次"',
  )
  assert.equal(report.shouldBeGates.length, 0, '★ 当然也不许落进"够次数"那一格')
  /**
   * ★ 而它必须**说清为什么**判不了 —— 一句"判断不了"没有可操作性，
   *   而 `index.component` 缺席是一个能去接的缺口。
   */
  assert.match(
    String(report.cannotTell[0].why), /component/i,
    `★ 判不了的理由必须指名缺的是哪一格。实测：${JSON.stringify(report.cannotTell[0].why)}`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（★★ 三态 · 方向二）：读不出坑的**两条**记录不许被合成"踩了两次"
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5（三态 · 方向二）：两条都读不出坑的记录 ⇒ **不许**被算成"同一个坑踩了两次"', () => {
  /**
   * ★ 反方向的写法同样错，而它更隐蔽：用 `undefined` 当分组键，
   *   两条毫不相干的、都读不出 id 的记录会被数成**同一个坑的两次** ——
   *   于是最该被看见的接线缺口伪装成了一条"该建判据"的提案。
   *   （与 C1 的 `observeStall` 拒绝对 `undefined` gate 分组是同一条纪律。）
   */
  const report = rollup([
    record('f-0001', undefined, { note: '甲' }),
    record('f-0002', undefined, { note: '乙' }),
  ])
  assert.equal(
    report.shouldBeGates.length, 0,
    '★★★ 两条读不出坑的记录**不许**被算成一个坑的两次 —— 那会把接线缺口伪装成提案',
  )
  assert.equal(report.cannotTell.length, 2, '★ 它们各自是各自的一条 cannot-tell')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（★★★ 定向突变臂）：阈值判据被抹平 ⇒ 控制臂必须变红
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 6（定向突变臂）：把"凡出现就报"的突变体装上 ⇒ 控制臂必须红', () => {
  /**
   * ── ★ 为什么这一条必须有 ──────────────────────────────────────────────────────
   *
   * 臂 2 断言"只踩一次不报"。★ 而"有一条断言"与"那条断言真的在起作用"是两件事：
   *   · 一个**无论次数多少都报**的实现（突变体）会让臂 1 全绿 ——
   *     而臂 2 正是唯一会变红的地方。
   * ⇒ 所以这里**当场装上突变体、当场跑、当场读回**臂 2 的裁决，
   *   而不是声称"它会长红"（那是关于动作的猜想，本仓 `§6 经验 F` 记过）。
   *
   * ── 突变体是什么 ──────────────────────────────────────────────────────────────
   *
   * 把 `rollup` 里"够不够次数"的那一句改成 `true` ——
   * 也就是"凡出现的坑都算够次数"。这是"什么都报"的**最小形态**。
   */
  const source = readFileSync(SCRIPT, 'utf8')
  /**
   * ★ 按**内容**定位突变点（不按行号猜）—— 本仓记过"夹具用 indexOf 应用变异体
   *   打到别的行 + 基线红"那四个坏读数。⇒ 找不到就**当场红**，不静默跳过。
   */
  const thresholdExpr = /group\.count >= threshold/u
  assert.match(
    source, thresholdExpr,
    '★ 突变臂前置：要在脚本里找到决定"够不够次数"的那一句（找不到就不能声称"施加了突变"）',
  )
  const mutated = source.replace(thresholdExpr, 'true')

  const dir = mkdtempSync(join(tmpdir(), 'rollup-mutant-'))
  try {
    const mutant = join(dir, 'experience-rollup.mjs')
    writeFileSync(mutant, mutated, 'utf8')

    /**
     * ── 突变体夹具：把**臂 2** 单独拎出来，跑在突变后的脚本上 ─────────────────────
     *
     * ★ 只跑控制臂：本臂要读的是**那一条**的裁决。整份文件跑会有一半臂是绿的，
     *   而那会盖住这个读数。
     * ★ 用一个独立的小夹具（而不是本文件）⇒ 它 import 的是**突变体**那一份。
     */
    const probe = join(dir, 'probe.mjs')
    writeFileSync(probe, [
      `import { rollup } from ${JSON.stringify(mutant)}`,
      `const r = rollup([{ id: 'f-0001', title: 't', index: { component: 'completion.mutation' }, observed: {}, resolution: {} }])`,
      `process.stdout.write(JSON.stringify({ shouldBeGates: r.shouldBeGates.length }))`,
      '',
    ].join('\n'), 'utf8')

    const run = (file) => spawnSync('node', [file], { encoding: 'utf8', cwd: REPO_ROOT })

    /**
     * ── 读数 ①（前置）：**未突变**的那一份上，只踩一次 ⇒ 0 条提案 ────────────────
     *
     * ★ 缺了它，"突变后变红"可能只是因为探针本身坏了
     *   （本仓记过那个坏法：同一个坏 harness，基线红）。
     */
    const controlProbe = join(dir, 'probe-control.mjs')
    writeFileSync(controlProbe, readFileSync(probe, 'utf8').replace(JSON.stringify(mutant), JSON.stringify(SCRIPT)), 'utf8')
    const control = run(controlProbe)
    assert.equal(control.status, 0, `★ 突变臂前置：未突变的探针必须跑得起来。实测 stderr=${control.stderr?.slice(0, 400)}`)
    assert.equal(
      JSON.parse(control.stdout).shouldBeGates, 0,
      '★ 突变臂前置：**未突变**时，只踩一次的坑必须给出 0 条提案（这就是臂 2）',
    )

    /** ── 读数 ②（★ 交付读数）：施加突变 ⇒ 同一条控制臂上必须变成 1 ───────────── */
    const mutantRun = run(probe)
    assert.equal(mutantRun.status, 0, `★ 突变体探针必须跑得起来。实测 stderr=${mutantRun.stderr?.slice(0, 400)}`)
    assert.equal(
      JSON.parse(mutantRun.stdout).shouldBeGates, 1,
      '★★★ 定向突变：把"够不够次数"抹平成 true（凡出现就报）之后，'
      + ' "只踩一次 ⇒ 不报"这条**必须**被打破 —— 若它仍是 0，说明臂 2 测不出这个突变，'
      + ' 而"控制臂在起作用"这句话就没有证据。',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7（★ 不改采集）：跑一次脚本，台账目录**逐字节不变**
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7（不改采集）：脚本只读台账 —— 跑完之后目录内容逐字节不变', () => {
  /**
   * ★ 契约第一条：「Do not change collection -- change AGGREGATION.」
   *   ⇒ 判据是机械的：**跑之前与跑之后，台账目录的每一个字节都相同**。
   *   ★ 只断言"没有新文件"不够 —— 改一个已存在文件也会让记录失真，而记录不可重算。
   */
  const dir = ledger([
    record('f-0001', 'a.b', { note: 'x' }),
    record('f-0002', 'a.b', { note: 'y' }),
    record('f-0003', 'c.d', { note: 'z' }),
  ])
  try {
    const snapshot = () => readdirSync(dir).sort()
      .map((name) => `${name}:${readFileSync(join(dir, name), 'utf8')}`).join('\n')
    const before = snapshot()
    const run = spawnSync('node', [SCRIPT, dir], { encoding: 'utf8', cwd: REPO_ROOT })
    assert.equal(run.status, 0, `★ 脚本必须跑得成（exit 0）。实测 stderr=${run.stderr?.slice(0, 400)}`)
    assert.equal(
      snapshot(), before,
      '★★ 台账目录必须**逐字节不变** —— 本任务是"改聚合"，不是"改采集"。'
      + ' 有一条记录被改写，记录就不可重算了。',
    )
    /** ★ 而且它必须真的**说了话**（而不是"没写盘"顺便"没输出"）。 */
    assert.match(run.stdout, /a\.b/, `★ 输出里必须报出那个踩了两次的坑。实测：${run.stdout.slice(0, 300)}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（★★ 契约硬要求）：空匹配与"跑坏了"必须**不同形**
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 8：三种"没有提案"各自一句**不同的话**（空匹配 ≠ 跑坏了 ≠ 不够次数）', () => {
  /**
   * ★ 契约的 Plan-Review 原话：
   *   「A script that silently reports '0 findings' on an empty match is
   *     indistinguishable from one that is broken. That distinction must be
   *     visible in the output.」
   * ⇒ 三种情形的输出必须**互不相同**，且各自说得出自己属于哪一种。
   */
  /** ① 台账目录**不在**（干净 checkout 的正常情形）。 */
  const missing = render(rollup([]), { ledgerDir: '/nonexistent', absent: true, broken: [] })
  /** ② 台账在、有记录、但**没有一个坑够次数**（真的不需要行动）。 */
  const notEnough = render(
    rollup([record('f-0001', 'a.b')]),
    { ledgerDir: 'x', absent: false, broken: [] },
  )
  /** ③ 台账在、有记录、而**一条都读不出坑**（接线缺陷）。 */
  const unclassifiable = render(
    rollup([record('f-0001', undefined)]),
    { ledgerDir: 'x', absent: false, broken: [] },
  )

  assert.notEqual(missing, notEnough, '★★ ①（目录不在）与 ②（不够次数）必须不同形')
  assert.notEqual(notEnough, unclassifiable, '★★ ②（不够次数）与 ③（读不出坑）必须不同形')
  assert.notEqual(missing, unclassifiable, '★★ ①（目录不在）与 ③（读不出坑）必须不同形')

  assert.match(missing, /台账目录不存在/, '★ ① 必须说"目录不在"，且说清这不是"没有经验"')
  assert.match(notEnough, /没有任何一个坑够次数/, '★ ② 必须说"数过了，结论是不够"')
  assert.match(unclassifiable, /接线缺陷/, '★ ③ 必须说"这是接线缺陷"，而不是"不够次数"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9（★ 阈值可注入）：N=1 与 N=2 给出**不同**裁决
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 9：N 可注入 —— 同一个输入在 N=1 与 N=2 下裁决不同', () => {
  /**
   * ★ 契约硬要求「N 必须可注入」的由来（本仓教训，`docs/PENDING-FRICTION-REFORM.md` §2）：
   *   「`with-timeout` 那族缺陷连躲三次，根因都是**上限是硬编码常量，短测试复现不了**。」
   * ⇒ 判据是机械的：**同一份输入、只改 N**，裁决必须不同形。
   */
  const records = [record('f-0001', 'a.b')]
  assert.equal(rollup(records, 1).shouldBeGates.length, 1, '★ N=1 ⇒ 踩一次就该报')
  assert.equal(rollup(records, 2).shouldBeGates.length, 0, '★ N=2 ⇒ 踩一次不够')
  assert.notEqual(
    rollup(records, 1).shouldBeGates.length, rollup(records, 2).shouldBeGates.length,
    '★★ 同一个输入在两个 N 下必须不同形 —— 否则"N 可注入"这句话没有证据',
  )
  /** ★ 而命令行上也真的能注入（不只是函数参数）。 */
  assert.equal(parseArgs(['--threshold', '3']).threshold, 3, '★ 命令行要能把 N 传进去')
  assert.equal(
    parseArgs(['--threshold', 'nonsense']).threshold, DEFAULT_THRESHOLD,
    '★ 坏值要**回落缺省**（不抛错）—— 一个因为参数没写对就炸的脚本会被绕过',
  )
  assert.equal(parseArgs([]).threshold, DEFAULT_THRESHOLD, '★ 不给就用缺省 2')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10（★★ 真语料）：对真台账跑一次，并**如实**报出它是空匹配还是坏了
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 10：对**真** .agent-teams/frictions/ 跑一次，并如实说出匹配到什么', () => {
  /**
   * ── ★ 为什么要有一条"对真语料"的臂 ────────────────────────────────────────────
   *
   * 前面九条臂全在**临时台账**上 —— 而一个只在合成输入上正确的脚本，
   * 可能在真语料上静默给出零结果，而那与"它坏了"同形（契约 Plan-Review 第 ③ 条）。
   *
   * ★★ 而这条臂**只读**真台账，且**不**断言它的具体内容 ——
   *   语料会随每一轮任务增长（本仓记过"清单会随队友活动抖动"那条教训）。
   *   ⇒ 断言的是**形状与诚实性**，把读数**打印出来**：
   *     · 目录在          ⇒ 它必须真的读到了记录（或如实说一条都没有）
   *     · 目录不在        ⇒ 它必须说"不存在"，且**不许**说成"零经验"
   */
  const realDir = join(REPO_ROOT, '.agent-teams', 'frictions')
  const dirExists = readdirSync(REPO_ROOT).includes('.agent-teams')

  const run = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf8', cwd: REPO_ROOT })
  assert.equal(run.status, 0, `★★ 对真语料必须 exit 0（读不到台账是正常情形，不是故障）。实测 stderr=${run.stderr?.slice(0, 500)}`)
  const report = JSON.parse(run.stdout)

  console.log(`  [臂 10] 真台账：absent=${report.absent} · 读了 ${report.totalRecords} 条 · `
    + `归类得 ${report.countedRecords} 条 · 够次数 ${report.shouldBeGates.length} 个坑 · `
    + `不够 ${report.belowThreshold.length} 个 · 判断不了 ${report.cannotTell.length} 条 · 读不出 ${report.broken.length} 条`)

  /**
   * ★★ 诚实性：`absent` 必须与**目录是否真的在**一致 ——
   *   这是"我没能看"与"看了、是空的"不同形的**可执行形式**。
   */
  if (!dirExists) {
    assert.equal(report.absent, true, '★ 目录不在时，`absent` 必须为真（不许说成"零经验"）')
    console.log('  [臂 10] 本 worktree 没有 .agent-teams/ ⇒ 如实报 absent（这是正常情形）')
    return
  }
  /**
   * ★ 而"读了 N 条"必须与三个格子**对得上** —— 一个把记录丢掉却不说的实现
   *   会让总数与分格数目不符，而那个不符在只看某一格时**看不见**。
   */
  assert.equal(
    report.countedRecords + report.cannotTell.length, report.totalRecords,
    '★★ 归类得的 + 判断不了的 必须**恰好等于**读到的总数 —— 一条都不许凭空消失',
  )
  const buckets = report.shouldBeGates.length + report.belowThreshold.length
  const countedInBuckets = report.shouldBeGates.reduce((n, g) => n + g.count, 0)
    + report.belowThreshold.reduce((n, g) => n + g.count, 0)
  assert.equal(
    countedInBuckets, report.countedRecords,
    `★★ 两个次数格子里的记录数之和必须等于 countedRecords。实测 ${countedInBuckets} vs ${report.countedRecords}`,
  )
  assert.ok(buckets >= 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 14（★★★ 真语料 · 显式路径）：worktree 里没有台账 ⇒ 从主树那份**显式**读
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 14：把**真台账**用显式路径喂进去 —— 它必须真的数出东西，且不许把"位置"说成"同一个坑"', () => {
  /**
   * ── ★ 为什么臂 10 还不够（本任务实测）─────────────────────────────────────────
   *
   * 臂 10 用脚本的**缺省**路径（`<repo>/.agent-teams/frictions`）。而 worktree 里
   * 没有 `.agent-teams/`（它是 gitignored）⇒ 臂 10 每次都走 `absent` 那一支，
   * 于是"对真语料跑一次"这句话实际上**一次都没成立过** —— 一个恒走降级分支的臂。
   *
   * ⇒ 本臂从**主树**（`git rev-parse --show-toplevel` 的上层）**显式**找那份真台账。
   *   ★ 找不到就**如实跳过**（并打印），不假装跑过 —— 与全仓那条纪律一致。
   *
   * ── ★★ 而它断言的是**真实性**，不是具体数字 ─────────────────────────────────────
   *
   * 语料随每一轮任务增长（本仓记过"清单会随队友活动抖动"）⇒ 把某个计数写死会让
   * 本臂在下一次有人记一条卡点时误红。所以断言的是：
   *   ① 它真的读到了记录（总数 > 0）—— 证明"能跑"这件事成立；
   *   ② 三个格子与总数**对得上** —— 证明一条都没丢；
   *   ③ ★ 归到具体判据的那些，**不许**把"位置"当成"同一个坑"（本任务实测出来的
   *      那个陷阱：158 条 `dispatch` 会被合成一个坑）。
   */
  const worktreeRoot = fileURLToPath(new URL('..', import.meta.url))
  /** ★ 主树 = 本 worktree 的 git common dir 的父级（worktree 的 `.git` 是文件，不是目录）。 */
  let mainRoot
  try {
    const commonDir = execFileSync(
      'git', ['-C', worktreeRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8' },
    ).trim()
    /** `<主树>/.git` ⇒ 它的父目录就是主树。 */
    mainRoot = commonDir === '' ? undefined : fileURLToPath(new URL('..', `file://${commonDir}/`))
  } catch {
    mainRoot = undefined
  }
  /** ★ 候选路径各自**先判存在**再读 —— 不存在的目录是正常情形（worktree 就没有）。 */
  const hasLedger = (dir) => {
    try { return readdirSync(dir).some((name) => /^f-\d+\.json$/.test(name)) } catch { return false }
  }
  const realDir = [
    mainRoot === undefined ? undefined : join(mainRoot, '.agent-teams', 'frictions'),
    join(worktreeRoot, '.agent-teams', 'frictions'),
  ].find((dir) => dir !== undefined && hasLedger(dir))

  if (realDir === undefined) {
    console.log('  [臂 14] ★ 找不到真台账（主树与本 worktree 都没有）⇒ 如实跳过，不假装跑过')
    return
  }

  /** ★ 只读：跑一次脚本，把真台账喂给它。 */
  const run = spawnSync('node', [SCRIPT, realDir, '--json'], { encoding: 'utf8', cwd: REPO_ROOT })
  assert.equal(run.status, 0, `★★ 对真台账必须 exit 0。实测 stderr=${run.stderr?.slice(0, 500)}`)
  const report = JSON.parse(run.stdout)
  assert.equal(report.absent, false, '★ 这一次台账**真的在** ⇒ 不许走缺席那一支')
  assert.ok(report.totalRecords > 0, `★★ 真台账里必须真的读到记录（证明"能跑"成立）。实测 ${report.totalRecords}`)

  console.log(`  [臂 14] 真台账（${realDir}）：读 ${report.totalRecords} 条 · 归类 ${report.countedRecords} 条 · `
    + `够次数 ${report.shouldBeGates.length} 个坑 · 不够 ${report.belowThreshold.length} 个 · `
    + `判断不了 ${report.cannotTell.length} 条 · 读不出 ${report.broken.length} 条`)

  /** ② 一条都不许凭空消失。 */
  assert.equal(
    report.countedRecords + report.cannotTell.length, report.totalRecords,
    '★★ 归类得的 + 判断不了的 必须恰好等于读到的总数',
  )
  const inBuckets = report.shouldBeGates.reduce((n, g) => n + g.count, 0)
    + report.belowThreshold.reduce((n, g) => n + g.count, 0)
  assert.equal(inBuckets, report.countedRecords, '★★ 两个次数格子之和等于 countedRecords')

  /**
   * ③ ★★★ 本任务实测出来的那个陷阱：**同一个"位置"下有多个不同判据** ⇒
   *    它们**不许**被数成一个坑。判据是：真台账里"按位置归类"的那些组，
   *    其组内记录**不全是**同一个判据 id。
   *    ★ 这一条正是"数出来的次数是不是**同一个坑**的次数"的机械形式。
   */
  const positionGroups = report.shouldBeGates.filter((g) => g.how === 'index.component')
  if (positionGroups.length > 0) {
    const withIds = positionGroups.flatMap((g) => g.occurrences.map((o) => gateIdFromTitle(o.verbatim.title)))
      .filter((id) => id !== undefined)
    const distinct = new Set(withIds)
    console.log(`  [臂 14] 按位置归类的组：${positionGroups.length} 个 · 组内出现的**不同**判据 id：${distinct.size} 个 `
      + `(${[...distinct].slice(0, 6).join(', ')})`)
    /**
     * ★ 而"位置组里混着多个判据"这件事**必须被输出说出来** —— 否则读者会把
     *   「88 次同位置的拒绝」读成「同一个坑 88 次」。
     */
    const rendered = render(rollup(loadLedger(realDir).records), { ledgerDir: realDir, absent: false, broken: [] })
    if (distinct.size > 1) {
      assert.match(
        rendered, /不是具体判据/su,
        '★★★ 真台账里位置组内**确实**混着多个判据 ⇒ 输出**必须**当场声明"这一格是位置、不是具体判据" —— '
        + '否则那 88 次会被读成同一个坑的 88 次，而补救动作完全不同',
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 11（★ 单元）：`pitKeyOf` / `verbatimOf` 的两态分形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 11：pitKeyOf 与 verbatimOf 各自的两态不同形', () => {
  /** ★ 有 component ⇒ 说出它，并说清**是按哪一格归的类**（读取端要能复查）。 */
  const known = pitKeyOf(record('f-0001', 'a.b'))
  assert.equal(known.key, 'a.b')
  assert.equal(known.how, 'index.component', '★ 归类依据必须可读 —— 否则"按什么归的类"这件事无从复查')
  /** ★ 没有 ⇒ `undefined`，**不猜**（编一个键会让两条不相干的记录并成一个坑）。 */
  assert.equal(pitKeyOf(record('f-0001', undefined)).key, undefined)
  assert.equal(pitKeyOf({}).key, undefined, '★ 连 index 都没有时同样不猜')
  /** ★ 空白串不是"有值" —— 一个 `'  '` 当键会把它们全并成一个坑。 */
  assert.equal(pitKeyOf(record('f-0001', '   ')).key, undefined)

  /** ★ 原话：优先判据当时说的那一句，其次 title。 */
  assert.equal(verbatimOf(record('f-0001', 'a.b', { note: '判据原话' })).spoken, '判据原话')
  assert.equal(verbatimOf({ title: 'T', observed: {} }).spoken, undefined, '★ 拿不到就说拿不到，**不编一句**')
  assert.equal(verbatimOf({ title: 'T', observed: {} }).title, 'T', '★ 而 title 仍然照实交出')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 13（★★★ 具体判据优先）：位置 vs **具体判据** —— 两者不许合流
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 13：具体判据 id 优先于位置 —— 否则不同判据会被数成一个坑', () => {
  /**
   * ── ★ 这条臂的来历是**对真台账实测**出来的，不是推想的 ──────────────────────────
   *
   * MEASURED：真台账里 `index.component` 在 329/364 条上是**位置**
   * （`dispatch` 158 / `completion` 157），而 `title` 里的判据 id 把那些位置进一步
   * 区分开（`dispatch.changed-paths` 57 / `completion.backtest` 50 …）。
   *
   * ★★ 若按位置归类，**158 条互不相干的拒绝会被合成一个坑** ⇒ 报出
   *   「dispatch 踩了 158 次」。而那是把 N 件不同的事数成一个数字 ——
   *   正是本队反复记账的那条（与 C1 的 `observeStall` 拒绝合并 gate 是同一条纪律）。
   */
  const two = rollup([
    record('f-0001', 'dispatch', { title: 'update_task rejected: [dispatch.changed-paths] "a.ts" …' }),
    record('f-0002', 'dispatch', { title: 'update_task rejected: [dispatch.plan-reviewed] x' }),
  ])
  assert.equal(
    two.shouldBeGates.length, 0,
    '★★★ 两条**位置相同而判据不同**的记录**不许**被合成一个坑 —— '
    + '它们各自只踩了一次。合并会让"每次都被不同的门拦"读成"卡在同一处"',
  )
  assert.equal(two.belowThreshold.length, 2, '★ 而它们各自是各自的一个坑（各自 1 次）')

  /** ★ 而同一个判据真的踩了两次时，必须合并 —— 否则这条臂就变成了"永不聚合"。 */
  const same = rollup([
    record('f-0001', 'dispatch', { title: 'update_task rejected: [dispatch.changed-paths] "a.ts" …' }),
    record('f-0002', 'dispatch', { title: 'update_task rejected: [dispatch.changed-paths] "b.ts" …' }),
  ])
  assert.equal(same.shouldBeGates.length, 1, '★ 同一个判据两次 ⇒ 报（否则这条脚本没有聚合）')
  assert.equal(same.shouldBeGates[0].key, 'dispatch.changed-paths')
  assert.equal(same.shouldBeGates[0].how, 'title gate id', '★ 并说清它是按**判据 id**归的类')

  /**
   * ★★ 反向半边：**读不出**判据 id 时退回位置，且**如实标注**退回了。
   *   MEASURED：真台账里 88 条 `dispatch` 的 title 形如 `update_task rejected: `（id 被抹成空）
   *   ⇒ 它们只能退到位置，而**输出必须说得出这一点** —— 否则读者分不清
   *     「同一个坑 88 次」与「88 次拒绝、具体判据读不出来」。
   */
  const fellBack = rollup([
    record('f-0001', 'dispatch', { title: 'update_task rejected: ' }),
    record('f-0002', 'dispatch', { title: 'update_task rejected: ' }),
  ])
  assert.equal(fellBack.shouldBeGates.length, 1, '★ 读不出判据 id 时退回位置（不落 cannot-tell）')
  assert.equal(fellBack.shouldBeGates[0].how, 'index.component', '★ 而"是按位置归的"必须可读')
  const rendered = render(fellBack, { ledgerDir: 'x', absent: false, broken: [] })
  assert.match(
    rendered, /位置.*不是具体判据|不是具体判据/su,
    '★★★ 退回位置时，**输出里必须当场说出来** —— 否则读的人会把'
    + '「88 次同位置的拒绝」读成「同一个坑 88 次」，而补救动作完全不同',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 12（★ 台账目录缺席）：`loadLedger` 三态，且缺席与"空目录"不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 12：loadLedger 的三态 —— 缺席 / 有坏条目（降级） / 正常，且各自不同形', () => {
  /** ① 目录不在 ⇒ `absent: true`。 */
  assert.equal(loadLedger('/definitely/not/here').absent, true, '★ 目录不在 ⇒ absent')
  /** ② 目录在而**空** ⇒ 不是 absent（"看了、是空的"与"我没能看"不同形）。 */
  const empty = mkdtempSync(join(tmpdir(), 'rollup-empty-'))
  try {
    const loaded = loadLedger(empty)
    assert.equal(loaded.absent, false, '★★ 空目录**不是** absent —— 两者必须不同形')
    assert.equal(loaded.records.length, 0)
    assert.equal(loaded.broken.length, 0)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
  /** ③ 有坏条目 ⇒ **降级**：好的照收，坏的如实列出（不整份丢掉、也不静默跳过）。 */
  const mixed = mkdtempSync(join(tmpdir(), 'rollup-mixed-'))
  try {
    writeFileSync(join(mixed, 'f-0001.json'), JSON.stringify(record('f-0001', 'a.b')), 'utf8')
    writeFileSync(join(mixed, 'f-0002.json'), '{ this is not json', 'utf8')
    const loaded = loadLedger(mixed)
    assert.equal(loaded.records.length, 1, '★ 好的条目照收（降级，不是整份作废）')
    assert.equal(loaded.broken.length, 1, '★ 坏的条目如实列出')
    assert.equal(loaded.broken[0].file, 'f-0002.json', '★ 而要说清**是哪一个文件**坏了')
  } finally {
    rmSync(mixed, { recursive: true, force: true })
  }
})
