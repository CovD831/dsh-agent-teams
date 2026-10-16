/**
 * ── ★★★ 对拍臂的**落地**：`cjkWidthTableCrossCheck` 必须真的被跑到 ────────────────
 *
 * ── 为什么需要这一条（MEASURED，t83）────────────────────────────────────────────
 *
 * t83 按 `REFACTOR-PLAN.md` 的 **B0.6** 加了一张零依赖的内联 CJK 宽度表，
 * 而 B0.6 **逐字要求**：「该内联表的准确度未验证（t26 未测中文渲染）⇒ 若采用，
 *   **必须先出一条对拍臂**」。
 *
 * ★★ 而它确实写了那条对拍臂（`cjkWidthTableCrossCheck`），并且它**当场抓出两个真缺陷**
 *    （`😀` U+1F600 与 `𠀀` U+20000 因为用 `charCodeAt` 走【码元】而算成 1 列）。
 *
 * ★★★ **但那条臂【没有任何调用方】**：
 *   ```
 *   grep -rn cjkWidthTableCrossCheck src/ scripts/
 *     ⇒ 只有 src/client/activity-model.ts 的三处（定义 + 两处注释）与 docs 一处
 *   ```
 *   ⇒ 它的样本是**调用方传进来的**（`samples: readonly number[]`）⇒
 *     **没有调用方 ⇒ 它从来没跑过,也永远不会跑。**
 *
 *   ★ 而"写了但没跑"与"跑了且通过"**在报告里同形** —— 那正是本仓记账最久的形态。
 *
 * ── 本臂做什么 ────────────────────────────────────────────────────────────────
 *
 * ① 喂进 t83 在文档里**逐字列出**的那些样本类别（ASCII / Latin-1 / 希腊 / CJK统一 /
 *    假名 / 谚文 / 谚文Jamo / 康熙部首 / 全角 / 半宽假名 / 半宽谚文 / emoji /
 *    补充平面 CJK / 全角空格），断言 **`disagree === 0`**；
 * ② ★ 并**钉住它当场抓到的那两个补面字符**（回归臂）—— 若有人把 `for…of`/`codePointAt`
 *    改回 `charCodeAt`，这一条与 ① 都会红；
 * ③ ★ 断言 `authority` **如实声明它不能证明什么**（那正是它自我设限的那一处，
 *    不许被后人"顺手"删成一句更强的宣称）。
 *
 * ── 一条边界（t83 自己指出、本臂保留）───────────────────────────────────────────
 *
 * ★ 对拍臂只能发现"**两张表不一致**"，**发现不了**"**两张表犯同一个错**"。
 *   ⇒ 本臂**不声称**宽度等于 `EastAsianWidth.txt` —— 引那个文件本身就是依赖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cjkWidthTableCrossCheck, charColumns } from '../lib/client/activity-model.js'

/**
 * t83 文档里列出的那些类别，每类取代表。
 * ★ 每一行都写清它属于哪一类 —— 于是"覆盖了哪些类别"是**可读的**，
 *   而不是一条看不出覆盖面的数字。
 */
const SAMPLES = [
  [0x41, 'ASCII 大写 A'],
  [0x7A, 'ASCII 小写 z'],
  [0x31, 'ASCII 数字 1'],
  [0xE9, 'Latin-1 é'],
  [0x3B1, '希腊 α'],
  [0x4E00, 'CJK 统一 一'],
  [0x3042, '平假名 あ'],
  [0x30A2, '片假名 ア'],
  [0xAC00, '谚文 가'],
  [0x1100, '谚文 Jamo ᄀ'],
  [0x2F00, '康熙部首 一'],
  [0xFF01, '全角 ！'],
  [0xFF61, '半宽假名 ｡'],
  [0xFFA0, '半宽谚文 ﾠ'],
  [0x3000, '全角空格'],
  [0x1F600, 'emoji 😀（补面）'],
  [0x20000, '补充平面 CJK 𠀀'],
]

test('★★★ 对拍臂（落地）：两张独立宽度表在这些样本上【必须一致】', () => {
  const codes = SAMPLES.map(([code]) => code)
  const result = cjkWidthTableCrossCheck(codes)

  /**
   * ★ 先测**前置**（照 t83 自己的纪律）：样本真的进去了吗。
   *   若 `rows` 长度不等于样本数，说明函数内部把样本弄丢了 ——
   *   那时下面的 `disagree === 0` 会因为**什么都没比**而恒真。
   */
  assert.equal(
    result.rows.length, SAMPLES.length,
    `★★ 前置：对拍臂必须真的收到全部 ${SAMPLES.length} 个样本 —— `
    + `实测 ${result.rows.length} 个。`
    + ' （样本数不对时，"零分歧"会因为没比而恒真。）',
  )

  const disagreements = result.rows
    .filter((row) => !row.agrees)
    .map((row) => `${row.char} U+${row.code.toString(16).toUpperCase()} 表=${row.table} 独立源=${row.independent}`)

  assert.deepEqual(
    disagreements, [],
    '★★★ 两张独立宽度表出现分歧 —— 每一行都是"某个字符的宽度算错了"：\n'
    + disagreements.map((line) => `     ${line}`).join('\n'),
  )
})

test('★★ 回归臂：t83 抓到的那两个【补面】字符必须仍算 2 列', () => {
  /**
   * ── 这两个是 t83 的对拍臂**实际抓到**的缺陷 ────────────────────────────────────
   *
   * 第一版用 `charCodeAt`（**码元**）遍历 ⇒ 补面字符是**代理对** ⇒
   * 查到的是 U+D800–U+DFFF 的代理码元 ⇒ 表里没有 ⇒ **算成 1 列**。
   *
   * ★ `𠀀`（U+20000）是**补充平面的 CJK** —— 不修就是"中文里有字算错宽度"。
   */
  assert.equal(charColumns('😀'), 2, '★ emoji 😀（U+1F600）必须是 2 列（补面 ⇒ 代理对）')
  assert.equal(charColumns('𠀀'), 2, '★★ 𠀀（U+20000，补充平面 CJK）必须是 2 列 —— 它曾因 charCodeAt 算成 1')
  assert.equal(charColumns('𠀀一'), 4, '★ 两个 CJK 字符 ⇒ 4 列')
})

test('★★ 措辞臂：`authority` 必须如实声明它【不能】证明什么', () => {
  const result = cjkWidthTableCrossCheck([0x4E00])
  /**
   * ★ 这一条防的是"后人把自我设限删成更强的宣称"。
   *   对拍臂能证明的只是"**两张独立表在这些样本上一致**"，
   *   **不**能证明"等于 `EastAsianWidth.txt`" —— 引那个文件本身就是依赖。
   */
  assert.match(
    result.authority, /does NOT prove/i,
    '★★ `authority` 必须含一条明确的"**不能**证明什么" —— '
    + '否则读者会以为这条对拍臂验了全部 Unicode。\n'
    + `   实测 authority = ${JSON.stringify(result.authority)}`,
  )
})
