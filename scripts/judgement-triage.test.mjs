#!/usr/bin/env node
/**
 * ── 判决归类器的夹具（t65）─────────────────────────────────────────────────────
 *
 * ── 它测的是什么 ──────────────────────────────────────────────────────────────
 *
 * 契约要求这个工具必须是【一个工具】，而不是一次人工分类。⇒ 这些臂因此不测
 * "某一条判得对不对"，而测**分类器本身的四条性质**：
 *
 *   臂 1（分辨力臂）：★ 它必须把 j-0001 判成 `discipline` ——
 *                     **一个"什么都能判成 gate"的工具会失败在这里**
 *   臂 2（四态臂）：  ★ `unmeasured` 是第四态，不得并进任何一态
 *   臂 3（一致臂）：  对现有 9 条，与 captain 手写那张表逐条比对 ——
 *                     ★ 而"不一致"必须**指出是哪一条、两边各自的理由**
 *   臂 4（形状臂）：  ★ `fixture-helper` 与 `gate` 都是"可机械化"，
 *                     但**产物不同** ⇒ 不许合成一个
 *   臂 5（范围臂）：  它自己的适用范围要被写出来（用户 2026-10-08 的标准）
 *
 * ── ★★ 本文件刻意不写的一句话（本队已因这类棘轮返工多次）────────────────────────
 *
 * 「现在有几条判决」「captain 那张表现在覆盖几条」**都不是不变量**。
 * 本文件里 9 条 claim 是**从工具的内置语料**读的，而那张表的覆盖数
 * 是**如实断言它当前是多少**（8 条 —— 它写于 j-0009 之前）。
 * ⇒ 而那条断言写成"表里没有 j-0009"，**不是**"表里有 8 行" ——
 *   后者会在有人给表补一行时按设计变红，而红的原因与分类器无关。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import {
  triage,
  triageBuiltIn,
  looksAssertive,
  inputKindOf,
  compareWithCaptain,
  crossCheckBuiltIn,
  readJudgements,
  conditionsFor,
  SHAPE_BY_INPUT,
  VERDICTS,
  BUILT_IN_CLAIMS,
  CAPTAIN_TABLE,
} from './judgement-triage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOL = join(ROOT, 'scripts', 'judgement-triage.mjs')

/** 内置 9 条的裁决，按 id 索引。 */
const results = new Map(triageBuiltIn().map((result) => [result.id, result]))

// ═════════════════════════════════════════════════════════════════════════════
// 臂 1（分辨力臂）：j-0001 必须落 discipline
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 1：j-0001 必须判 `discipline` —— ★ 一个"什么都能判成 gate"的工具会失败在这里', () => {
  /**
   * ── 这一臂是整份夹具里最重要的一条 ──────────────────────────────────────────
   *
   * 契约原文：「★ 而它必须检出那个【已知的反例】：j-0001（「停在可恢复的中间态」）
   *             ⇒ 工具必须判它 `discipline`，而不是硬判成 gate」
   *
   * ★ 为什么它是**分辨力**测试而不是"一条断言"：
   *   本工具的第一版把 `判据`/`代价` 这类**泛名词**当成"可指向的对象" ⇒
   *   j-0001 与其余 8 条**一律**过 `looksAssertive` ⇒ 那一格**恒真**。
   *   ⇒ 只断言"j-0001 是 discipline"会红，而**红是对的**。
   *   而反过来，一个 `return 'gate'` 的实现在臂 3 之前的所有臂上都绿 ——
   *   这一条把它挡住。
   */
  const result = results.get('j-0001')
  assert.equal(
    result.verdict, 'discipline',
    `★ 「停在可恢复的中间态」表达不出一条对某个输入返回真/假的断言：${JSON.stringify(result)}`,
  )
  /** ★ 而理由必须**说清它缺什么**（不是一句"不可判定"）—— 否则读的人不知道要补什么。 */
  assert.match(result.reason, /true\/false|predicate/, '★ 理由要说清"它缺一个可检验的谓词"')
})

test('★ 臂 1b：★ 反向半边 —— 其余 8 条**都不许**落 discipline（否则这一格恒"对"）', () => {
  /**
   * ── 只有"j-0001 是 discipline"这一条是不够的 ─────────────────────────────────
   *
   * 一个 `return 'discipline'` 的实现在臂 1 上**完全绿**。
   * ⇒ 必须同时断言：另外 8 条**没有一条**落 discipline。
   *   而那正是契约那句"对现有 9 条判决跑一次"的真正用处 ——
   *   它迫使我们看清"这一格在 9 条上分别给出什么"。
   */
  const others = [...results.values()].filter((result) => result.id !== 'j-0001')
  const wronglyDiscipline = others.filter((result) => result.verdict === 'discipline')
  assert.deepEqual(
    wronglyDiscipline.map((result) => result.id), [],
    '★ 其余 8 条都能表达出断言 —— 若它们落 discipline，说明这一格不是"判形态"而是"全否"',
  )
  assert.equal(others.length, 8, '★ 夹具自检：内置语料是 9 条')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 2（四态臂）：unmeasured 是第四态，不得并进任何一态
// ═════════════════════════════════════════════════════════════════════════════

test('★★ 臂 2：`unmeasured` 是【第四态】—— ★ 不许并进任何一态', () => {
  /**
   * 契约原文：「★ 且【无法判断】是第四态，不得并进任何一态（例如 claim 太含糊）」
   *
   * ★ 而它与本队那条最贵的纪律同源：
   *   「'判不了'与'判了没问题'必须不同形」。
   *   ⇒ 把"我看不懂这条 claim"归到 `diagnosis`，会让它伪装成
   *     **一条关于这条判决的结论**（"它只能诊断"）—— 而两者要人做的事
   *     **完全不同**（改 claim vs 接受它不拦）。
   */
  const noClaim = triage({ id: 'x' })
  assert.equal(noClaim.verdict, 'unmeasured', '★ 没有 claim ⇒ 判不了 ⇒ 第四态')
  assert.notEqual(noClaim.verdict, 'discipline', '★ 不许并进 discipline')
  assert.notEqual(noClaim.verdict, 'diagnosis', '★ 不许并进 diagnosis')
  assert.notEqual(noClaim.verdict, 'gate', '★ 不许并进 gate')

  /** ★ 而"判不了"与"表达不出断言"必须是**两句不同的话**（理由不同形）。 */
  const discipline = results.get('j-0001')
  assert.notEqual(
    noClaim.reason, discipline.reason,
    '★ "我没拿到 claim"与"它表达不出断言"必须不同形 —— 合成一句会让两者要人做的事同形',
  )

  /** ★ 第四态也要在常量表里（否则它是一条只写在函数里的话）。 */
  assert.deepEqual([...VERDICTS], ['gate', 'diagnosis', 'discipline', 'unmeasured'])
})

test('★ 臂 2b：四态的**字段形状**互不相同（形状上可分辨，不是靠读理由）', () => {
  /**
   * ★ 与 t26/t55 同一条纪律：三态（这里是四态）**不能只差别措辞**。
   *   本队记账过"两个出口长一样、只差一句话"的形态。
   */
  const gate = results.get('j-0002')
  const diagnosis = results.get('j-0006')
  const discipline = results.get('j-0001')
  const unmeasured = triage({ id: 'x' })

  assert.equal(typeof gate.where, 'string', '★ gate 必须给**建议形状**（它落哪个文件/位置）')
  assert.equal(typeof gate.why, 'string', '★ 以及"为什么这个形状"')
  assert.equal(gate.shape, 'gate')
  assert.equal(diagnosis.shape, 'diagnosis', '★ diagnosis 的形状是它自己那一种')
  /**
   * ★ 它与 gate 的差别**不在"有没有 where"**，而在 **where 说的是什么**：
   *   gate      ⇒ 一个**要造出来的产物位置**（判据文件 / 检查点）
   *   diagnosis ⇒ 一个**不拦的标记**（"标记给人看，不拦"）
   * ⇒ ★ 断言"diagnosis 没有 where"是**我一开始写错的口径**（实测当场红）：
   *   两者都有 where，而**内容不同形** —— 那才是真正要钉的东西。
   */
  assert.match(diagnosis.where, /标记|不拦/, '★ diagnosis 的 where 说的是"标记给人看、不拦"')
  assert.doesNotMatch(gate.where, /不拦/, '★ 而 gate 的 where 是一条会拦的产物 —— 两者不同形')
  assert.equal(discipline.shape, 'discipline')
  assert.equal(unmeasured.shape, undefined, '★ unmeasured **没有 shape** —— 判不了就说判不了')
  assert.match(unmeasured.reason, /cannot be judged|could not be identified/, '★ 它的理由说的是"我没能判"')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 3（一致臂）：与 captain 手写那张表逐条比对
// ═════════════════════════════════════════════════════════════════════════════

test('★★★ 臂 3：对现有 9 条与 captain 的表逐条比对，且**不一致必须两边理由都给出**', () => {
  /**
   * 契约原文：「★ 而它必须【对现有 9 条判决跑一次】，并把结果与 captain 手写的
   *             那张表【逐条比对】⇒ 若不一致 ⇒ 那是【本工具或那张表】有一个错，
   *             而两者都要能被质疑」
   *
   * ★ 所以本臂**不**断言"全部一致"（那会把"工具必须与表一样"写死成不变量，
   *   而表本身没有判据、只是人的判断）。它断言的是**比对这件事发生了、且可读**：
   *   · 每一条都有 `tool` 与 `captain` 两侧的原话；
   *   · 不一致的那些**必须**带上两边的理由；
   *   · 而"表里没有"的那一条落 `uncomparable`，**不并进 agree**。
   */
  const comparison = compareWithCaptain([...results.values()])
  assert.equal(comparison.rows.length, 9, '★ 9 条判决逐条出现（一条都不许静默丢掉）')

  for (const row of comparison.rows) {
    assert.ok(['agree', 'disagree', 'uncomparable'].includes(row.status), `★ ${row.id} 的状态必须是三者之一`)
    assert.equal(typeof row.tool.verdict, 'string', `★ ${row.id} 必须给出工具这一侧的原话`)
    if (row.status === 'disagree') {
      assert.notEqual(row.captain, null, '★ 不一致必须有对面那一侧可比')
      assert.match(row.detail, /differs/, `★ ${row.id} 不一致时必须说清哪一轴不同`)
      assert.ok(
        typeof row.tool.why === 'string' && row.tool.why !== ''
        && typeof row.captain.note === 'string' && row.captain.note !== '',
        `★ ${row.id} 不一致时，**两边各自的理由**都要在 —— 只给结论没法让人裁决`,
      )
    }
  }

  /** ★ 计数必须自洽（一个"扫了 9 条、报 3 条"的实现会让读者以为只有 3 条）。 */
  assert.equal(comparison.agree + comparison.disagree + comparison.uncomparable, 9)
})

test('★★ 臂 3b：j-0003 是**真的**不一致 —— ★ 本工具要如实报它，而不是改判去迎合那张表', () => {
  /**
   * ── 这一条是"两者都要能被质疑"的落点 ────────────────────────────────────────
   *
   * 实测（本任务）：
   *
   *     工具：gate      —— 「代理读数在它所代理的东西没变时也会变」这条断言
   *                        **读的东西是现成可取的**（夹具里的距离/行号/缩进）
   *                        ⇒ 按判断 ② 的判据，它落 gate
   *     表：  diagnosis —— captain 判"只能诊断"，理由是**找出哪个读数是代理**
   *                        需要理解语义
   *
   * ★ 而两边**说的不是同一件事**：
   *   · 工具回答的是"这条断言**一旦写出来**，读的东西现成可取吗"⇒ 是
   *   · 表回答的是"**构造这条断言**（挑出那些读数）需要理解吗"⇒ 需要
   *   ⇒ ★ 这是**判据边界**上的分歧（captain 原话："可机械化的判据是窄的"），
   *     而不是谁算错了。
   *
   * ★★ 而本工具**不替它改判**：改判会让"两者都要能被质疑"变成
   *    "工具向表看齐" —— 那时表就成了真值，而它明明只是人的判断。
   */
  const row = compareWithCaptain([...results.values()]).rows.find((entry) => entry.id === 'j-0003')
  assert.equal(row.status, 'disagree', '★ 这一条必须被如实报成不一致')
  assert.equal(row.tool.verdict, 'gate', '★ 工具这一侧的结论')
  assert.equal(row.captain.verdict, 'diagnosis', '★ 表那一侧的结论')
  assert.match(row.tool.why, /现成可取|source|静态/, '★ 工具的理由必须可读')
  assert.match(row.captain.note, /标记候选/, '★ 表的理由也必须可读')
})

test('★ 臂 3c：j-0009 不在那张表里 ⇒ `uncomparable`，★ 且**不许**并进 agree', () => {
  /**
   * ★ 这一条钉的是"那张表自己的覆盖范围"这件事：
   *   `docs/JUDGEMENTS-TO-GATES.md` 写于 j-0009 之前 ⇒ 它只覆盖 8 条。
   *
   * ★ 为什么**不**给表补一行让 9 条全可比：那会让"表当初判过 j-0009"这个
   *   **假事实**成立 —— 而本文件只如实报出"这一条表里没有"。
   *   （表是 docs/ 里那份，归它的作者；本工具只读它、不改它。）
   */
  const row = compareWithCaptain([...results.values()]).rows.find((entry) => entry.id === 'j-0009')
  assert.equal(row.status, 'uncomparable', '★ 表里没有它 ⇒ 不可比（★ 不是"一致"）')
  assert.equal(row.captain, null)
  assert.match(row.detail, /does not list/, '★ 理由要说清"表里没有这一条"')
  /** ★ 而它**必须**仍然出现（不许因为它不可比就从报告里消失）。 */
  assert.equal(row.tool.verdict, 'gate', '★ 工具对它仍然有判断 —— 只是没得可比')
})

test('★ 臂 3d：对拍内置语料与盘上的判决（★ 抄来的文本会腐烂）', () => {
  /**
   * ── 为什么这一条存在 ──────────────────────────────────────────────────────────
   *
   * 本工具的内置 9 条 claim 是**从 `.agent-teams/judgements/*.json` 抄来**的
   * （因为 inScope 不碰 .agent-teams/）。⇒ 而"抄来的东西会腐烂"是**本队的记账**
   *   （j-0004 / j-0007 说的都是这件事）。
   *
   * ★ 所以对拍**必须存在**，而它的三态必须不同形：
   *   · `match`      ⇒ 抄的是当前那一份
   *   · `stale`      ⇒ 分叉了（并列出哪些 id 不同）
   *   · `unmeasured` ⇒ 读不到目录（**不是** match！）
   */
  const missing = crossCheckBuiltIn(join(ROOT, 'no-such-judgements-dir'))
  assert.equal(missing.status, 'unmeasured', '★ 读不到目录 ⇒ unmeasured（不许并进 match）')
  assert.match(missing.detail, /could not be read/)

  /**
   * ★ 而目录**存在时**必须真的比对。用判决目录当输入（本 worktree 里它不存在，
   *   所以走 unmeasured 那一支）—— 而"抄得对不对"这条性质用**合成目录**测。
   */
  const scratch = join(ROOT, '.t65-scratch-judgements')
  const write = (name, body) => writeFileSync(join(scratch, name), body, 'utf8')
  try {
    spawnSync('mkdir', ['-p', scratch])
    /** ① 逐字一致 ⇒ match */
    for (const [id, claim] of BUILT_IN_CLAIMS) {
      write(`${id}.json`, JSON.stringify({ id, claim }))
    }
    assert.equal(crossCheckBuiltIn(scratch).status, 'match', '★ 逐字一致 ⇒ match')

    /** ② 改掉其中一条 ⇒ stale，且**指名**是哪一条。 */
    write('j-0002.json', JSON.stringify({ id: 'j-0002', claim: '改过的 claim' }))
    const stale = crossCheckBuiltIn(scratch)
    assert.equal(stale.status, 'stale', '★ 分叉 ⇒ stale')
    assert.deepEqual(stale.differing, ['j-0002'], '★ 必须指名是哪一条不同（不是一个汇总）')
    assert.ok(stale.onlyMine.length === 0 && stale.onlyTheirs.length === 0)
  } finally {
    spawnSync('rm', ['-rf', scratch])
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 4（形状臂）：fixture-helper 与 gate 都是"可机械化"，但产物不同
// ═════════════════════════════════════════════════════════════════════════════

test('★★ 臂 4：`fixture-helper` 是【另一种形状】—— ★ 不许与 `gate` 合成一个', () => {
  /**
   * 契约原文（判断 ③）：运行时的 ctx ⇒ 夹具辅助（★ **不是判据**）。
   *
   * ★ 为什么这一格必须单独存在：两者的**产地不同** ——
   *   · `gate`           ⇒ 进注册表，能拦产品代码
   *   · `fixture-helper` ⇒ 进夹具辅助库，**不拦**
   *   合成一个会让下一个人去注册表里找一个**不在那里**的东西。
   *
   * ★ 而 j-0005 就是那一条：它约束的是**夹具怎么写**，不是产品代码的行为 ——
   *   一条"夹具写错了"的判据会拦下**正确的产品代码**。
   */
  const result = results.get('j-0005')
  assert.equal(result.verdict, 'gate', '★ 它是可机械化的（verdict 仍是 gate）')
  assert.equal(result.shape, 'fixture-helper', '★ 而**形状**是夹具辅助，不是判据')
  assert.match(result.where, /夹具辅助/, '★ 它落的地方必须写明"不是判据"')

  /**
   * ★ 反向半边：`shape` 不许只有 `gate` 一种取值 ——
   *   一个把 `runtime-ctx` 也映射成 `gate` 的实现会让这一条红。
   */
  assert.equal(SHAPE_BY_INPUT['runtime-ctx'].shape, 'fixture-helper')
  assert.equal(SHAPE_BY_INPUT['source-text'].shape, 'gate')
  assert.notEqual(
    SHAPE_BY_INPUT['runtime-ctx'].shape, SHAPE_BY_INPUT['source-text'].shape,
    '★ 两种"可机械化"的产物必须不同 —— 合成一个就是三种补救动作合流',
  )
})

test('★ 臂 4b：verifier6 报的那一类（**别的机制有没有把东西送过来**）落 gate，不落 diagnosis', () => {
  /**
   * ── 这是 captain 转来的那条外延，必须有一条臂钉住 ─────────────────────────────
   *
   * verifier6 在枚举 t64 的 notChecked 路径时发现：「completion 的四条门在
   * **缺 kind-requirements loader** 时全部 skipped」⇒ 而那种依赖是
   * **可机械检查的**（表在不在、loader 注没注）⇒ 它落 **gate**。
   *
   * ★ 所以判断 ② 的"现成可取"不止"源码/文件/git"，还包括
   *   **别的机制有没有把东西送过来** —— 而那正是可机械检查的一类。
   */
  assert.equal(
    inputKindOf('某一格必须由别的机制注入进来，而它没有接上').kind,
    'injected-by-another-mechanism',
  )
  assert.equal(
    SHAPE_BY_INPUT['injected-by-another-mechanism'].shape, 'gate',
    '★ 它落 gate（可机械检查），**不是** diagnosis',
  )
  /**
   * ★ 夹具自检（本任务实测抓出来的）：第一版这条 claim 写成了
   *   「判据要的那一格必须由别的机制接上」—— 而它**没有"条件⇒后果"结构** ⇒
   *   工具诚实地判它 `discipline`。⇒ 那**不是**工具的错：**这句话确实表达不出
   *   一条对某个输入返回真/假的断言**（它是一句祈使）。
   *   ⇒ 换一句真的可断言的：它必须说清"**没有接上的时候，会看到什么**"。
   */
  const verdict = triage({ id: 'x', claim: '判据要的那一格没有接上时，那个位置就会整体 skipped —— 而 skipped 与"检查过、没问题"必须不同形' })
  assert.equal(verdict.verdict, 'gate', '★ 而它的裁决是 gate')
  assert.equal(verdict.inputKind, 'injected-by-another-mechanism')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 5（范围臂）：它自己的适用范围要写出来
// ═════════════════════════════════════════════════════════════════════════════

test('★★ 臂 5：★ 适用范围要**写进它自己**（用户 2026-10-08 的标准）', () => {
  /**
   * 用户原话：「也不是说在特定条件下起效的就不能加，只是需要把这些特定条件
   *             顺便加上去。」
   *
   * ★ 而这一条**每个裁决**都带 `conditions`：
   *   · 它是从 claim **自己写下的限定语**里读出来的（"只在…"、"对…成立"、"若…"），
   *     **不是**本工具替它编一句免责声明；
   *   · claim 没写限定语时，它**如实返回空数组** —— 那是"读到的"事实，
   *     不是"我们假设它通用"。
   */
  /** ① claim 写下了限定语 ⇒ conditions 里必须看得到。 */
  assert.deepEqual(
    conditionsFor('这条判据只在搬运类任务上成立，而它不是通则'),
    ['搬运类任务上成立'],
    '★ 从 claim 自己写下的"只在…"里读出适用范围',
  )
  assert.deepEqual(conditionsFor('它对派生文件成立'), ['派生文件'])
  /** ② 没写 ⇒ 空数组（不编）。 */
  assert.deepEqual(conditionsFor('突变要打在针脚自己那一行上'), [], '★ 没写限定语 ⇒ 如实返回空')
  /** ③ 而每个裁决都带着它。 */
  for (const result of results.values()) {
    assert.ok(Array.isArray(result.conditions), `★ ${result.id} 必须带 conditions（适用范围）`)
  }
  /** ④ 第四态的 conditions 是**它要求调用方满足什么**（那正是"判不了"的原因）。 */
  assert.match(
    triage({ id: 'x' }).conditions.join(' '), /claim/,
    '★ unmeasured 的 conditions 必须说清"要判它，claim 得先满足什么"',
  )
})

test('★ 臂 5b：工具**不读 .agent-teams/** —— 判决来源由 `--judgements` 传入', () => {
  /**
   * ★ 这是它能在别的仓库里跑的前提（inScope 也明确写着不碰 .agent-teams/）。
   *   而"没传目录"时用**内置语料**，且内置语料是 9 条 —— 那条数是**语料的**，
   *   不是"盘上现在有几条"（后者是快照，本队记账过）。
   */
  const source = readFileSync(TOOL, 'utf8')
  assert.doesNotMatch(
    source, /readdirSync\(['"]\.agent-teams/u,
    '★ 工具不许自己去读 .agent-teams/ —— 那是调用方的输入（`--judgements`）',
  )
  assert.equal(BUILT_IN_CLAIMS.length, 9, '★ 内置语料是 9 条（夹具与比对都用它）')
})

test('★ 臂 5c：读不到判决目录 ⇒ `undefined`，★ 不是 `[]`', () => {
  /**
   * ★ 与全库同一条纪律：`[]` 是"读了、一条都没有"，`undefined` 是"我没能读"。
   *   合成一个会让"目录不存在"伪装成"这个项目还没有判决"。
   */
  assert.equal(readJudgements(join(ROOT, 'no-such-dir')), undefined, '★ 读不到 ⇒ undefined')
})

// ═════════════════════════════════════════════════════════════════════════════
// 臂 6：CLI 真的能跑（契约的 Verify 行点名了它）
// ═════════════════════════════════════════════════════════════════════════════

test('★ 臂 6：`node scripts/judgement-triage.mjs` 能跑，且三种模式都出读数', () => {
  const plain = spawnSync('node', [TOOL], { encoding: 'utf8' })
  assert.equal(plain.status, 0, `★ 默认模式必须 exit=0：\n${plain.stderr}`)
  assert.match(plain.stdout, /judgement triage/i, '★ 出人话报告')
  /** ★ 9 条都要出现（一条都不许因为"没话可说"而消失）。 */
  for (const [id] of BUILT_IN_CLAIMS) {
    assert.match(plain.stdout, new RegExp(id), `★ ${id} 必须在报告里出现`)
  }

  const json = spawnSync('node', [TOOL, '--json'], { encoding: 'utf8' })
  assert.equal(json.status, 0)
  const parsed = JSON.parse(json.stdout)
  assert.equal(parsed.results.length, 9)
  assert.equal(parsed.comparison, undefined, '★ 没要 --compare 时不给比对（免得读者以为它总在比）')

  const compare = spawnSync('node', [TOOL, '--compare'], { encoding: 'utf8' })
  assert.equal(compare.status, 0)
  assert.match(compare.stdout, /hand-written table/i)
  assert.match(compare.stdout, /agree/)
})

test('★ 臂 6b：退出码反映"工具跑没跑成"，**不**反映"分类结果好不好"', () => {
  /**
   * ★ 一个把"与表不一致"当 exit=1 的实现，会让 CI 在
   *   **工具是对的、表是错的**时也红 —— 而那时正确的动作是**去看那一条**，
   *   不是"修到两边一样"。
   * ⇒ 本工具**有**不一致（j-0003），而它必须仍然 exit=0。
   */
  const comparison = compareWithCaptain([...results.values()])
  assert.ok(comparison.disagree > 0, '★ 夹具自检：当前确实存在不一致（否则这一条测不到东西）')
  const run = spawnSync('node', [TOOL, '--compare'], { encoding: 'utf8' })
  assert.equal(run.status, 0, '★ 有分歧也要 exit=0 —— 分歧是一个**读数**，不是工具失败')
})

// ═════════════════════════════════════════════════════════════════════════════
// ★★ 定向突变（真的执行）
// ═════════════════════════════════════════════════════════════════════════════

/**
 * ── 突变体必须用 cache-busting 重新 import（t6/t55 的实测教训）────────────────
 *
 * ★ 而 t55 更进一步：**transitively imported 的模块也要一起 bust**。
 *   本文件是**单模块**（没有跨模块 import），所以只需 bust 自己一份 ——
 *   而这一点**要写下来**，因为下一个人往里加 import 时它会立刻失效。
 *   ★ 见臂 7c 的自检：它**断言这个模块没有别的本地 import**。
 */
async function freshTool(tag) {
  return import(`${TOOL}?${tag}`)
}

function withMutatedTool(mutatedSource, body) {
  const original = readFileSync(TOOL, 'utf8')
  const restore = () => writeFileSync(TOOL, original)
  try {
    writeFileSync(TOOL, mutatedSource)
    return body()
  } finally {
    restore()
  }
}

/** 突变 A 的针脚：把三态并成两态（discipline 并入 diagnosis）。 */
const NEEDLE_THREE_STATES = `  if (assertive === undefined) {
    return {
      id,
      verdict: 'discipline',`
/** 突变 B 的针脚：把"表达不出断言"判成 gate。 */
const NEEDLE_DISCIPLINE_BRANCH = `  const assertive = looksAssertive(claim)`

test('★★ 定向突变 A：把三态并成两态（discipline 并入 diagnosis）⇒ 臂 1 必须红', async (t) => {
  /**
   * ★ 本仓的收口纪律是**串行**（`node --test` 之间会互相看见文件改动），
   *   所以这一条由环境变量显式开启，默认跳过，由本任务的验证读数那次单独运行。
   */
  if (process.env.AGENT_TEAMS_TRIAGE_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_TRIAGE_MUTATION=1 时运行（见任务 output 里的读数）')
    return
  }

  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_THREE_STATES,
    `  if (assertive === undefined) {
    return {
      id,
      verdict: 'diagnosis',`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行 —— 没匹配上的替换会让它恒不生效')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=two-states')
    /** ★ 这一条断言就是**臂 1 的红**：j-0001 不再落 discipline。 */
    const result = mutant.triage({ id: 'j-0001', claim: BUILT_IN_CLAIMS[0][1] })
    assert.equal(
      result.verdict, 'diagnosis',
      '★ 塌成两态之后，"表达不出断言"被记成了"只能诊断" —— 臂 1 就是靠这一条变红的',
    )
    assert.notEqual(result.verdict, 'discipline', '★ discipline 这一态整个消失了')
  })

  /** ★ 还原之后逐字相等。 */
  const restored = await freshTool('mutation=restored')
  assert.equal(
    restored.triage({ id: 'j-0001', claim: BUILT_IN_CLAIMS[0][1] }).verdict, 'discipline',
    '★ 还原之后必须回到 discipline',
  )
})

test('★★ 定向突变 B：把「表达不出断言」判成 gate ⇒ 臂 1/1b 必须红', async (t) => {
  if (process.env.AGENT_TEAMS_TRIAGE_MUTATION !== '1') {
    t.skip('串行突变：设 AGENT_TEAMS_TRIAGE_MUTATION=1 时运行')
    return
  }

  const original = readFileSync(TOOL, 'utf8')
  const mutated = original.replaceAll(
    NEEDLE_DISCIPLINE_BRANCH,
    `  const assertive = looksAssertive(claim) ?? claim // MUTANT: everything is assertive`,
  )
  assert.notEqual(mutated, original, '★ 突变必须真的改到那一行')

  await withMutatedTool(mutated, async () => {
    const mutant = await freshTool('mutation=always-assertive')
    const result = mutant.triage({ id: 'j-0001', claim: BUILT_IN_CLAIMS[0][1] })
    assert.notEqual(
      result.verdict, 'discipline',
      '★ 突变体把"表达不出断言"当成有断言 ⇒ 臂 1 变红（discipline 再也产不出来）',
    )
    /** ★ 而**后果**：j-0001 会被硬判成某种"能机械化"—— 正是契约要防的那个。 */
    assert.ok(['gate', 'unmeasured'].includes(result.verdict), '★ 它被硬判成了一条可机械化的东西，或干脆判不了')
  })
})

test('★ 二次对照：两条突变针脚在工具源码里【真的存在】', () => {
  const source = readFileSync(TOOL, 'utf8')
  assert.equal(source.includes(NEEDLE_THREE_STATES), true, '★ 突变 A 的针脚必须逐字存在')
  assert.equal(source.includes(NEEDLE_DISCIPLINE_BRANCH), true, '★ 突变 B 的针脚必须逐字存在')
})

test('★★ 夹具自检：本工具是**单模块**（`freshTool` 的 cache-busting 才够用）', () => {
  /**
   * ★★ 这一条钉的是上面那条 `freshTool` 的前提 ────────────────────────────────────
   *
   * MEASURED（t55）：夹具只 bust 了 `lib/state.js`，而它静态 import 的
   * `./types.js` 是**裸路径** ⇒ 与夹具用 `?tag` 加载的那一份是**两个模块实例**
   * ⇒ 突变根本没被读到，而报告会读作"突变没打红"（方向相反）。
   *
   * ⇒ 本工具今天**没有**本地 import（只 import `node:fs` / `node:path`），
   *   所以单个 bust 是够的。★ 而那一刻会被下一个人改掉 ——
   *   所以这一条**把它变成可执行的断言**：一旦有人加了本地 import，
   *   这里当场红，而不是等到某次突变"莫名其妙不打红"。
   */
  const source = readFileSync(TOOL, 'utf8')
  const localImports = [...source.matchAll(/^import .*? from '(\.[^']*)'/gmu)].map((match) => match[1])
  assert.deepEqual(
    localImports, [],
    '★ 工具若开始 import 本地模块，`freshTool` 必须改成**一起 bust**（t55 的实测）—— '
    + `否则突变会静默地测旧代码。当前本地 import：${JSON.stringify(localImports)}`,
  )
})

test('★★ 夹具自检：`freshTool` 读到的确实是【当前磁盘上】的那一份', async () => {
  const a = await freshTool('selfcheck=a')
  const b = await freshTool('selfcheck=b')
  assert.notEqual(a, b, '★ 不同的 query 必须拿到不同的模块实例 —— 否则突变臂会静默地测旧代码')
  assert.equal(typeof a.triage, 'function')
  assert.equal(typeof b.triageBuiltIn, 'function')
  assert.equal(typeof triage, 'function')
})
