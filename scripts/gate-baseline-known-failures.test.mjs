/**
 * ── t18（F2）：基线已知失败清单 —— 防它【腐化】────────────────────────────────
 *
 * ── 本文件钉的是什么 ──────────────────────────────────────────────────────────
 *
 * 不是判据的语义（那些在 `gate-backtest.test.mjs`），而是**这份清单本身的五件事**：
 *
 *     ① 每条 pin 必须说出**它为什么与本次改动无关**（不许写「已知」了事）
 *     ② 每条 pin 必须指向一个**真的存在**的夹具文件
 *     ③ 三态必须不同形：缺席 / 说没有已知失败 / 说了几条
 *     ④ 清单必须**真的可达判据**（装载器交得出来）
 *     ⑤ 清单**不许**包含它自己的臂（自指是循环的）
 *
 * ── ★★★ 本夹具【不跑全量】，而那是实测逼出来的（四条各自可核）───────────────
 *
 * **发现 ③：夹具不能嵌套跑 `pnpm test:gates`。**
 * ```
 * 在 node --test 之外跑 ⇒ 输出 144KB、25~37 条失败  ✓
 * 在 node --test 之内跑 ⇒ 输出长度 = 0              ✗
 * ```
 * ⇒ 第一版夹具（自己跑全量做集合比对）**必然拿到空读数**，于是它报"基线全绿"
 *   —— **一条恒假的红**。★ 一般形式：**一个"我跑了一遍全量"的夹具，
 *   必须先证明它【真的拿到了输出】**，否则"没输出"被读成"没有失败"。
 *
 * **发现 ①：全量红的【集合】在队友活动时会变。**
 * ```
 * 同一提交、零碰撞（ERR=0）：22 / 22 / 22（机器安静）  而 30 / 31 / 39（队友在 build）
 * ```
 * ⇒ 差异**不来自** `ERR_MODULE_NOT_FOUND` 碰撞，而来自 `lib/` 被并发 build 改写成
 *   不同的中间/最终态 ⇒ 不同夹具在不同时刻看到不同的库。
 * ⇒ **一份 pin 了"当前快照"的清单会在队友活动时立刻腐化**。
 * ★ 结论：**会抖的量不能当断言，而它可以当读数。**
 *   ⇒ 本夹具只断言**结构**（确定性的那部分），差集不作断言。
 *
 * **发现 ④：自指。**
 * 第一版夹具自己红 ⇒ 它自己的 4 条臂进了"已知失败"名单（22 条里 4 条是它自己）
 * ⇒ **一条会把自己写进"已知失败"的夹具是循环的**：它红 ⇒ 被 pin ⇒ 下次红不被发现。
 * ⇒ 臂 5 把"清单不许包含自己的臂"做成一条**可断言的规则**。
 *
 * **发现 ②（本队记账最久的形态）：清单根本到不了判据。**
 * 装载器传数组，判据又解一层 ⇒ 恒抛 ⇒ `catch { continue }` 吞掉 ⇒ `undefined`
 * ⇒ 判据永远看到「清单缺席」。⇒ 臂 4 把它做成一条**可检出的读数**（当前红）。
 *
 * ── ★★★ 为什么臂 4 红着却【不进清单】（captain 裁定 C 的落点）─────────────────
 *
 * 这里有一个**真的冲突**，值得写下来 —— 它也是本文件最容易被后人改错的一格：
 *
 *     仓的先例（`verify-task-atomicity` 那条）：一条**故意红**的夹具 ⇒ 应当被 pin
 *     本文件的臂 5                              ：清单**不许**含自己的臂（自指）
 *     ⇒ 而臂 4 **同时**落进两条：它故意红，且它属于本清单自己的夹具。
 *
 * ★ 裁定是 **C**：**保持红，但【不】pin 它**。而理由不是"诚实"，是：
 *
 *     ★★ 清单的语义是「与【任何改动】都无关的【存量】」，
 *        而臂 4 报的是「【本机制自己】的缺口」⇒ **两者不是同一类东西**。
 *        ⇒ 把不同类的东西并进同一栏，正是本队记账最久那个形态。
 *
 * ★ 而一般形式（captain 记入台账）：
 *
 *     **一个"已知失败"清单，只能收【与任何改动都无关的存量】。**
 *     **一旦它收进一个【某个机制自己的缺口】，那个缺口就永久免疫了 ——
 *       因为清单的语义是"不必再看"。**
 *
 * ★ 而判据是：
 *
 *     **一条红可以进清单的唯一条件：它已经被【处理过】** ——
 *     修好了、或明确裁定为不需要修。
 *     ⇒ 一条【还没被处理过】的红，无论它是存量还是新机制报的，都**不该**进清单。
 *     ⇒ 先例那条满足它（t38 作者 + t43 独立验证者**都确认过**）；
 *       而臂 4 **不满足** —— 它是那条缺陷的**首次报警**，还没被任何人处理过。
 *
 * ★ 所以臂 5 与先例**其实不冲突**：
 *     臂 5 防的是【空间的】自指（谁写的）；先例说的是【时间的】存量（改了也没关系）；
 *     ⇒ 而"首次报警"两者都碰上，且**都不该被 pin**。
 *
 * ★★ 对读者的交代：**`test:gates` 的失败数会 +1，而那不是回归** ——
 *   它是【新机制在报一个真实缺口】，而它会在装载器修好（把 `completion.ts:70` 那层
 *   多余的 `.knownFailures` 去掉）之后**自动消失**。★ 臂 4 **一个字都不需要改**。
 *
 * ── ★ 定向突变（打红本文件的五条路）───────────────────────────────────────────
 *
 *   a) 把某条的 `because` 写成空 / 写成「已知」        ⇒ 臂 1 红
 *   b) 把某条的 `fixture` 指向一个不存在的文件          ⇒ 臂 2 红
 *   c) 让清单文件读不到 / 形状坏                        ⇒ 臂 3 红
 *   d) 修好装载器（去掉那层多余的 `.knownFailures`）    ⇒ 臂 4 **自动转绿**
 *      ★ 而臂 4 **一个字都不需要改** —— 它钉的是【行为】而不是源码文本
 *   e) 让清单含它自己的臂                               ⇒ 臂 5 红
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseKnownBaselineFailures } from '../lib/gates/completion/backtest.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIST = join(ROOT, 'scripts', 'fixtures', 'baseline-known-failures.json')

/** 本清单的维护者（= 本文件）—— 它自己的臂**不许**进清单（见臂 5）。 */
const MAINTAINER = 'scripts/gate-baseline-known-failures.test.mjs'

/** 读这份清单（原始 JSON；读不到就抛 —— 那是"缺席"，由臂 3 处置）。 */
function rawList() {
  return JSON.parse(readFileSync(LIST, 'utf8'))
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 每条必须**指名**它为什么与本次改动无关
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 1：每条 pin 的 `because` 必须**具体**（不许写「已知」了事）', () => {
  /**
   * ★ 定向突变 a（把某条 `because` 写成空）⇒ 本臂红。
   *
   * ★ 为什么"具体的下限"要可断言：`because` 的全部价值是让下一个人判断
   *   "这条还成立吗"。一句「已知失败」不给出任何可验证的东西，于是它
   *   **与"我懒得写"同形** —— 而那正是本清单腐化的开始（t18 的命题）。
   */
  const failures = rawList().knownFailures
  assert.ok(failures.length > 0, '★ 清单为空时下面的遍历恒真 —— 至少要有一条')

  for (const entry of failures) {
    const where = `${entry.fixture} :: ${entry.test}`
    assert.equal(typeof entry.because, 'string', `★ ${where}：\`because\` 必须是字符串`)
    const because = entry.because.trim()
    assert.ok(because !== '', `★ ${where} —— \`because\` 是空的（定向突变 a ⇒ 本臂红）`)
    /**
     * ★ 下限取 24 个字符：它把「已知」「known」「pre-existing」这类**无信息**的写法
     *   与"说出成因"分开。★ 这不是形式主义 —— 它正是"不许写「已知」了事"的可断言形状。
     */
    assert.ok(
      because.length >= 24,
      `★ ${where} —— \`because\` 只有 ${because.length} 个字符（"${because}"）：`
      + '它没有说出**为什么与本次改动无关**。一句「已知失败」不给出任何可验证的东西，'
      + '于是它与"懒得写"同形 —— 而那是本清单腐化的开始',
    )
    /** ★ 而且必须说得出**属于哪里**：成因要指向一个可核查的对象。 */
    assert.match(
      because, /src\/|scripts\/|scheduler|注册表|接线|台账|t\d+|判据|语料|worktree|bundle/,
      `★ ${where} —— \`because\` 没有指向任何**可核查的对象**："${because}"。`
      + '它得说清成因在哪个文件/机制/事件上，否则下一个人无法判断"这条还成立吗"',
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★ 每条 pin 必须指向一个**真的存在**的夹具文件
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 2：每条 pin 的 `fixture` 必须是一个真的存在的文件', () => {
  /**
   * ★ 定向突变 b（把某条 `fixture` 指向一个不存在的文件）⇒ 本臂红。
   *
   * ★ 为什么这也要断言：一条指向**已删夹具**的 pin 永远不会再对上任何红
   *   ⇒ 它变成清单里的固定噪音，而噪音会淹没真失败（与臂 1 的"已知"同源）。
   */
  for (const entry of rawList().knownFailures) {
    assert.equal(typeof entry.fixture, 'string', `★ ${entry.test}：\`fixture\` 必须是字符串`)
    const fixture = entry.fixture.trim()
    assert.ok(fixture !== '', `★ ${entry.test}：\`fixture\` 是空的 —— 一条指不出夹具的 pin 没有用`)
    assert.equal(
      existsSync(join(ROOT, fixture)), true,
      `★ ${fixture} 不存在 —— 一条指向**已删夹具**的 pin 永远不会再对上任何红，`
      + '于是它是清单里的固定噪音。⇒ 要么删掉这条，要么修正 fixture 名',
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★ 三态不同形 —— 缺席 / 空 / 有
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3：清单的三态不同形 —— 缺席（读不到）∥ 说没有已知失败 ∥ 说了几条', () => {
  /**
   * ★ 这三格**必须**分得开，而它们各自对应判据的一条路（`backtest.ts:582`）：
   *
   *     缺席（`undefined`）⇒ 第三态「attribution is impossible」（不许凭空归因）
   *     空数组 `[]`      ⇒ ★ 一个**可疑**的状态：基线不绿却说"没有已知失败"
   *                         ⇒ 那意味着**清单腐化了**（真红的没被收进来）
   *     非空             ⇒ 第二态「按差异归因」（判据用 `knownFailures.length` 报数）
   *
   * ★ 定向突变 c（让清单读不到）⇒ 本臂第一节红。
   */
  /** ① 文件必须在（缺席与"没有"不同形 —— 而文件不在就是缺席那一格）。 */
  assert.ok(
    existsSync(LIST),
    '★ 清单文件读不到 ⇒ 判据落第三态「无法归因」。而一份缺席的清单与一份'
    + '「恰好覆盖了所有失败」的清单**必须不同形**（`completion.ts` 返回 `undefined` 而不是 `[]`，正是为此）',
  )

  /** ② 原始对象必须是容器（解析器的契约：它从对象上取 `.knownFailures`）。 */
  const raw = rawList()
  assert.equal(Array.isArray(raw.knownFailures), true, '★ 清单的容器形状必须是 `{ knownFailures: [...] }`')

  /** ③ 解析器的三态：对象 ⇒ 条目；坏形状 ⇒ **抛错**（不是 `[]`）。 */
  const parsed = parseKnownBaselineFailures(raw)
  assert.equal(parsed.length, raw.knownFailures.length, '★ 解析器交出的条数必须与原始清单一致')
  assert.throws(
    () => parseKnownBaselineFailures({ knownFailures: 'not-an-array' }),
    /must be an array/,
    '★ 形状坏了必须**抛错**而不是返回 `[]` —— 后者会让"清单坏了"读成"没有已知失败"（三态合流）',
  )
  assert.throws(
    () => parseKnownBaselineFailures({ knownFailures: [{ test: '  ', because: 'x' }] }),
    /non-empty `test`/,
    '★ 空 `test` 必须抛错 —— 一条指不出名字的 pin 没有任何用',
  )

  /** ④ ★★ 反向半边：本清单**不许**是空数组（那是"基线不绿却没已知失败"的可疑态）。 */
  assert.notEqual(
    raw.knownFailures.length, 0,
    '★★ 清单是空的 ⇒ 这是一个**可疑**状态：它意味着真红的没有被收进来（清单腐化）。'
    + '⇒ 要么补全，要么整份删掉（留着一份空清单＝噪音）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 待修读数 —— 清单必须**真的可达判据**（现在【不到】，故本臂红）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4（待修读数）：清单必须真的被装载器交给判据 —— 现在【不到】', () => {
  /**
   * ── ★★★ 本臂**故意写成红的**，而它是一个**读数**，不是本任务的失败 ────────────
   *
   * MEASURED（t18；captain 已在主树逐字复现）：
   *
   *     // src/tools/update-task/completion.ts:70   ← 传【数组】
   *     return parseKnownBaselineFailures(raw.knownFailures)
   *
   *     // src/gates/completion/backtest.ts:189     ← 又取一次 .knownFailures
   *     const failures = (raw)?.knownFailures
   *     if (!Array.isArray(failures)) throw new Error('… must be an array')
   *
   * ⇒ 传进去的是数组，而它去数组上找 `.knownFailures` ⇒ **恒 `undefined` ⇒ 恒抛**
   *   ⇒ 装载器的 `catch { continue }` 把它吞掉 ⇒ 两个候选都走完 ⇒ **返回 `undefined`**
   *   ⇒ 判据永远看到「清单**缺席**」⇒ **永远走第三态「attribution is impossible」**。
   *
   * ⇒ **这份清单做多少条都没有用。** 而它正是本队记账最久的形态：
   *   **机制建好了，而中间那一格没接上。**
   *
   * ★★ 而它之所以能藏这么久：**一个 `try/catch` 吞掉的异常，与"文件不存在"在读数上同形。**
   *   ⇒ 于是"我接错了"与"它不在这儿"不可分 —— **而两者的补救动作相反。**
   *
   * ★ 它落在 `src/`（本任务 out of scope）⇒ 我**不改它**，只把它做成**可检出的读数**。
   *   而"等它修好"是错的做法：把缺陷变成一条**可断言的读数**（当前红）更有用。
   *
   * ★★ 修好之后本臂**不需要改一个字**：它钉的是**行为**（装载器交出的东西），
   *   而不是源码文本。⇒ 这正是"断言钉性质，不钉字面"。
   */
  /**
   * ★ 复刻装载器的**真实**读法（逐字照抄 `completion.ts` 的那一步）——
   *   而不是另写一份"应该怎么读"。夹具另写一份的话，测的是夹具的算术。
   *
   * ── ★★★ 这里此前【照抄错了】，而注释还写着"逐字照抄"（t10 实测）──────────────
   *
   * MEASURED（verifier 在 t10 上实测，captain 逐字复核）：产品代码那一行传的是
   *   **`raw`**（整个对象，`parseKnownBaselineFailures` 自己取 `.knownFailures`），
   *   而本夹具传的是 **`raw.knownFailures`**（先把数组取出来再传）。
   * ⇒ 产品**通过**、夹具**抛错**，而那个手写的 `catch { return undefined }`
   *   把抛错吞成 `undefined` ⇒ 装载器读成"清单缺席" ⇒
   *   **`gate-backtest-baseline` 打印「实际 0 条 · 清单 17 条」，把 17 条 pin 全报成陈旧**。
   *
   * ★ 形态：同一个 bug（7742a27 修掉的那个）在夹具里**被复现**了一次，
   *   而注释声称它是逐字复制品 —— **一份"看起来是复制品"的副本与真品不同形**，
   *   正是本仓反复记账的那一类。
   *
   * ★ 而它**不许**再靠 `catch` 兜底：产品那句注释写明"形状坏了 ⇒ 让它抛出去，**不吞**"。
   *   吞掉的 catch 会让"读不出来"与"清单不存在"同形 —— 而这两件事的处置相反。
   */
  const load = () => {
    let raw
    try {
      raw = JSON.parse(readFileSync(LIST, 'utf8'))
    } catch {
      /** ★ 候选**不存在** ⇒ 这才是"清单缺席"（与产品同形：只在读文件那一步落回 undefined）。 */
      return undefined
    }
    /** ★ 逐字照抄产品代码：传的是 **`raw`**，不是 `raw.knownFailures` —— 且**不吞**。 */
    return parseKnownBaselineFailures(raw)
  }

  const loaded = load()
  assert.notEqual(
    loaded, undefined,
    '★★★ 装载器交不出清单（返回 `undefined` = 判据眼里的「清单缺席」）—— '
    + `而**本清单里有 ${rawList().knownFailures.length} 条**。`
    + '\n    ⇒ 成因（实测）：`completion.ts` 传 `raw.knownFailures`（**数组**），'
    + '而 `parseKnownBaselineFailures` 又取一次 `.knownFailures` ⇒ 恒抛 '
    + '`must be an array` ⇒ `catch { continue }` 吞掉 ⇒ 两个候选都失败 ⇒ `undefined`。'
    + '\n    ⇒ ★ 后果：判据**永远**走第三态「attribution is impossible」，'
    + '于是本清单**做多少条都没有用** —— 它是**死的**。'
    + '\n    ⇒ ★★ 修法（在 `src/`，本任务 out of scope ⇒ 我改不了）：'
    + '把 `parseKnownBaselineFailures(raw.knownFailures)` 改成 `parseKnownBaselineFailures(raw)`。'
    + '本臂**不需要改一个字**就会转绿（它钉的是行为，不是源码文本）。'
    + '\n    ⇒ 交接项：另立一条任务修 `src/tools/update-task/completion.ts:70`。',
  )
  assert.ok(Array.isArray(loaded), '★ 装载成功时它必须交出一个数组（而不是别的东西）')
  assert.equal(
    loaded.length, rawList().knownFailures.length,
    '★ 装载器交出的条数必须与清单一致（少一条意味着路上被吞了）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★ 自指 —— 清单不许包含它自己的臂
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5：清单**不许**包含本清单维护者自己的臂（自指是循环的）', () => {
  /**
   * ── ★★ 为什么这一条是**规则**而不是忠告（MEASURED，本任务第一版）───────────────
   *
   * 第一版夹具自己红 ⇒ 它自己的 **4 条臂进了"已知失败"名单**（canon 22 条里 4 条是它自己）。
   *
   * ⇒ **一条会把自己写进"已知失败"的夹具是循环的**：
   *     它红 ⇒ 被 pin 成"已知" ⇒ **下次它红就不再被发现** ⇒ 它永远不会被修。
   *   ★ 而这是本清单（"已知失败"）最尖锐的一个失效：**它可以把它的维护者吞掉。**
   *
   * ★ 定向突变 e（让清单含自己的臂）⇒ 本臂红。
   * ★ 反向半边：清单必须非空（否则"没有自己的臂"在空集上恒真）。
   */
  const failures = rawList().knownFailures
  assert.ok(failures.length > 0, '★ 清单为空时"不含自己的臂"恒真 —— 至少要有一条')

  const selfPinned = failures.filter((entry) => String(entry.fixture).trim() === MAINTAINER)
  assert.deepEqual(
    selfPinned.map((entry) => entry.test), [],
    `★★ 清单里含有维护者自己的臂（${MAINTAINER}）—— 那会**自指**：`
    + '该夹具一红就被 pin 成"已知"，于是"它红"这件事**再也不被发现**，它也永远不会被修。'
    + '⇒ 修法：把这条从清单里删掉，并去**修那个臂**（而不是把它记成"已知"）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★★ 报告臂 —— 清单的成因分类学自洽（确定性）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6：清单的成因分类学自洽 —— 每条都落在一个已知成因类里', () => {
  /**
   * ── ★★ 为什么这里是【分类学自洽】而不是【与当前红的差集】──────────────────────
   *
   * 「清单与**当前红的差集**」是一个**会抖的量**：同一提交、零碰撞的读数在
   * 队友活动时也得到过 30/31/39（安静时 22/22/22）。
   * ⇒ **会抖的量不能当断言** —— 否则本夹具会随机红，而红的原因不是清单腐化。
   * ⇒ 本臂只断言**清单自己的自洽性**（一个确定性的性质），
   *   而把"与当前红的比对"留给需要它的人**手动跑**（并附上抖动的原因）。
   *
   * ★ 这正是 captain 采纳的那句：「把能机械判定的部分钉死，把会抖的部分降级为报告。」
   */
  const failures = rawList().knownFailures
  /**
   * ★ 自洽性：每条 `because` 必须落在一个**已知的成因类**里。
   *   这不是"分类好看"——它让"这条为什么在这里"有一个**可核对**的答案，
   *   而下一个人在清单腐化时（某条其实绿了）能立刻知道该去哪一类里找原因。
   */
  const CLASSES = [
    { name: '核对接线', pattern: /核对接线|核对层|input_surface|出口接线/ },
    { name: '运行时接线', pattern: /运行时接线|runtime 位置|探活|时钟/ },
    { name: '全仓普查 / 存量', pattern: /全仓普查|存量|普查臂|记账值/ },
    { name: '夹具自身加载面', pattern: /夹具自身的加载面|bundle|加载失败/ },
    { name: '结构违规', pattern: /结构.*违规|互相 import/ },
    { name: '环境（worktree / 语料 / 台账）', pattern: /worktree|语料|台账/ },
    { name: '断言腐化（口径漂移）', pattern: /断言腐化|口径分叉|t58/ },
    { name: '记录在案的故意红', pattern: /故意留着/ },
  ]
  const unclassified = []
  for (const entry of failures) {
    if (!CLASSES.some((klass) => klass.pattern.test(entry.because))) {
      unclassified.push(`${entry.fixture} :: ${entry.test}`)
    }
  }
  assert.deepEqual(
    unclassified, [],
    '★ 有 pin 的成因类**落不进任何已知类** —— 要么它的 `because` 没说出成因，'
    + `要么它是一类**新的**存量（那要有人看一眼）。已知类：${CLASSES.map((k) => k.name).join(' / ')}`,
  )

  /**
   * ★ 报告（不判）：把每类各几条打印出来 —— 供读日志的人核对分布。
   *   ★ 它是 `console.log` 而不是断言：**分布会随队友活动变**（见文件头发现 ①）。
   */
  const census = CLASSES.map((klass) => [
    klass.name,
    failures.filter((entry) => klass.pattern.test(entry.because)).length,
  ]).filter(([, count]) => count > 0)
  console.log(`★ 本清单 ${failures.length} 条的成因分布（报告，非断言）：`,
    census.map(([name, count]) => `${name}=${count}`).join(' · '))
})
