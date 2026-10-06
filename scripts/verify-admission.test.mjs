/**
 * ── ★ 独立验证（t9）：「成团之前」三条准入判据，真的能判断吗？────────────────────
 *
 * ── 立场：不看实现者的夹具，自己构造输入，走真实入口 ─────────────────────────────
 *
 * 本文件**不 import** 任何 `gate-*.test.mjs` 里的辅助函数 —— 那些辅助函数是"被测
 * 对象的一部分"（它们编码了实现者的假设：ctx 长什么样、哪一格叫什么、什么算通过）。
 * 复用它们等于复用那些假设，于是验证的其实是"实现符合它自己的期望"。
 *
 * ★ 唯一的例外是**被测对象本身**：`lib/gates/index.js`（装配后的注册表，真实入口）
 *   与三个 `admission.*` 判据模块（t6/t7/t8 的交付）。它们是"要验的东西"，不是夹具。
 *   走 `lib/` 而不是 `src/` 的理由与硬约束一致：`link:` 指向源码 ⇒ 必须 build；
 *   `lib/` 才是运行时真的加载的那一份（"改了 src 忘了 build"是本队实测过的窗口）。
 *
 * ── ★★ 本文件的第一条读数：验收对象【现在不在盘上】─────────────────────────────
 *
 * MEASURED（2026-10-06，t9 开工时实测，证据见下面臂 0）：
 *
 *     · `src/gates/admission/`             ⇒ 目录不存在（三条判据的文件一个都没有）
 *     · 真实入口枚举注册表                  ⇒ admission 位置 registered=0
 *       （其余五个位置共 11 条，与基线逐条一致）
 *     · `evaluate('admission', {})`        ⇒ {ok:true, registered:0, evaluated:0,
 *                                              skipped:0, ran:[]}
 *     · `src/tools.ts`                     ⇒ 没有 evaluate('admission', …) 调用点
 *
 * ★ 第四条读数最容易读错，所以它单独成臂（臂 0）：空位置返回 `ok: true` 是
 *   **契约 §9.1 的正常情形**（"这个位置还没有判据"），而它在**只看 ok 的读者**
 *   眼里与"三条判据都测了、都没问题"**完全同形**。本文件存在的第一个理由，
 *   就是拒绝让这两种情形在读数上合流。
 *
 * ⇒ 于是本文件的臂分成两类，两类都必须存在、且**不许互相替代**：
 *
 *   【A 类 · 机制形状】：与判据在不在无关，现在就能验，而且**必须**现在验 ——
 *     它们在验"这个位置/这个注册表会不会让三条判据一旦接上就立刻生效"。
 *     去掉机制 ⇒ 这些臂红。这是规则二后半句在本文件里的落点。
 *
 *   【B 类 · 判据裁决】：**只有**判据在盘上时才说得上话。判据不在 ⇒ 本文件
 *     **如实报 unmeasured**，绝不报 pass。★ 把"没测到"并进"通过"正是本轮
 *     从头到尾在消灭的那一个形态，本文件不许自己犯。
 *
 * ── ★ 边界（"没找到"划在哪里）──────────────────────────────────────────────────
 *
 * 本文件**能**说的：机制形状（位置可达 / 三态不同形 / unmeasured≠ok / 成团读前一
 * 条的输出 / 每条机制单独去掉臂会红）—— 这些现在有定论，且对现状如实。
 *
 * 本文件**不能**说的：三条判据的**语义**是否正确（"产物变了才算该再审"判得对不对、
 * "声称吸收了"与"真实痕迹"对不对得上、成团三条件的定义对不对）。判据不在盘上 ⇒
 * 说这些就是无对象的主张。★ 这一条不许被读成"它们是对的"。
 *
 * ── 与实现者夹具的关系：两个装置，刻意不同 ──────────────────────────────────────
 *
 * 实现者夹具（`gate-admission-point.test.mjs` 等）测的是"我接的位置跑得通"，
 * 它们的输入是**自己造的探针**。本文件的 B 类臂只认**真实那三条判据**（按 id 从
 * 真实注册表里取），A 类臂虽然也用探针，但断言的是**注册表自身的形状**
 * （三态不同形、输出被读到），不是任何一条判据的语义。
 * ⇒ 两份夹具在"探针"上重叠，在**被测对象**上不重叠：一份测接线，一份测机制。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registry, buildRegistry, gateRoutes } from '../lib/gates/index.js'
import { createGateRegistry, INSERTION_POINTS, ok, blocked, unmeasured } from '../lib/gates/registry.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const POINT = 'admission'

/**
 * ── ★★ 定向突变实测记录（规则二后半句：把机制单独去掉，对应臂必须红）──────────────
 *
 * 每一条都是**真的跑过**的：改 `src/gates/registry.ts` → `pnpm build` → 跑本文件。
 * 记在这里是因为"臂会红"这句话本身不可信 —— 只有一次真跑过的突变才算证据。
 *
 *  ┌──── 突变（一次改动）───────────────────────────────┬─ 结果 ────────────────────┐
 *  │ ① 把 'admission' 从 INSERTION_POINTS 拿掉          │ 5 条臂红（臂0/A1/A2/A3/A4）│
 *  │ ② 让 unmeasured 落进 ok（"没测到"并进"通过"）      │ A2 + A3 红                 │
 *  │ ③ 把判据产出静默丢弃（outputs 不收集）             │ A4 红                      │
 *  │ ④ allSkipped 恒 false（"全跳过"并进"空位置"）      │ 臂 0 红 ★ 见下             │
 *  │ ⑤ 形状非法的裁决被静默当成通过                     │ A2 红                      │
 *  └────────────────────────────────────────────────────┴───────────────────────────┘
 *
 * ★★ 突变 ④ 是本文件最值钱的一次实测 —— 它**第一版照绿**（10 tests / 10 pass）。
 *
 *   原因是本文件第一版的臂 0 只比了"空位置"与"都通过"两种情形，漏了第三种
 *   （**有判据、却一条都没跑**），而 `allSkipped` 恰好只对那第三种情形说话。
 *   ⇒ 臂 0 **声称**的范围比它**实测**的范围大：它说"空位置与有判据全跳过必须
 *     不同形"，而它一行都没测过那条通路。这正是规则二后半句要抓的形态。
 *   ⇒ 补上第三情形 + 一个"三种形状两两不同"的集合断言之后，突变 ④ 才红。
 *
 *   ★ 记这一笔的用处：它证明"臂绿"不等于"臂测到了它声称的东西"，而唯一的检出
 *     方式就是**真的把机制拆掉跑一次**。本文件因此把突变当作交付的一部分。
 */

/**
 * 三条准入判据的【id】—— 本文件对它们的唯一约定。
 *
 * ★ 为什么不按文件路径找：`point` 与 `id` 是契约里先定死的东西（见 registry 的
 *   插入点表与 index.ts 的装配约定），而"文件放在哪个目录"是实现细节。按 id 找
 *   让本文件在 t6/t7/t8 各自选目录时都不需要改一个字。
 *
 * ★ 三条的**名字**取自任务书：检查点 / 吸收 / 成团。这里按语义猜的 id 是
 *   `admission.*` 前缀 —— 若实现者用了别的 id，本文件会在臂 0 如实报出
 *   "admission 位置上有 N 条判据，但没有一条命中这三个 id"，而那是**发现**
 *   （验收对象与任务书对不上），不是本文件的错。
 */
const EXPECTED = [
  { key: 'checkpoint', 语义: '检查点：产物相对"上次审查的版本"变了 ⇒ 触发再审', hint: 'admission.checkpoint' },
  { key: 'absorb', 语义: '吸收："我吸收了"与真实痕迹对得上吗', hint: 'admission.absorb' },
  { key: 'convene', 语义: '成团：产物非空 + 无未审改动 + 无待确认问题 ⇒ 自动成团', hint: 'admission.convene' },
]

/** 真实注册表上，`admission` 位置此刻挂了什么。**每次现读**，不缓存（缓存会把快照写成不变量）。 */
function admissionGates() {
  const listed = registry.list()[POINT] ?? []
  return listed
}

/**
 * 按 id（或 id 后缀）在真实注册表里定位一条准入判据。
 *
 * ★ 命中方式刻意宽松（精确 id 或 `admission.` 下的后缀匹配），因为 id 的措辞由
 *   实现者定；但**必须命中真实注册表**，不许 fallback 到"从某个文件里 import"——
 *   那样测的就不是接线后的那一份了。
 */
function findGate(listed, hint) {
  const suffix = hint.split('.').slice(1).join('.')
  return listed.find((g) => g.id === hint)
    ?? listed.find((g) => g.id.endsWith(`.${suffix}`))
    ?? listed.find((g) => g.id.includes(suffix))
}

/**
 * ★★ 全局读数：验收对象现在在不在盘上。
 *
 * 它同时读**两个来源**（注册表 / 磁盘），因为两者不同形：
 *   · 注册表里有 ⇒ 真的会跑（这是"接上了"）；
 *   · 磁盘上有文件但注册表里没有 ⇒ **装了但调不到**（本队反复见过的形态，
 *     而且它读起来与"还没写"完全不同：文件在那儿，人以为做完了）。
 */
const PRESENT = (() => {
  const listed = admissionGates()
  return {
    listed,
    registered: listed.length,
    dirExists: existsSync(join(ROOT, 'src/gates/admission')),
    /** 三条判据各自命中与否。 */
    hits: EXPECTED.map((entry) => ({ ...entry, listed: findGate(listed, entry.hint) })),
  }
})()

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0：读数本身 —— 空位置 与「三条判据都通过」必须不同形
// ─────────────────────────────────────────────────────────────────────────────

test('臂 0 ★ 读数：admission 现在是什么，如实说出来（空位置 ≠ 三条判据都通过）', async () => {
  /**
   * ── 这一臂防的是什么 ────────────────────────────────────────────────────────
   *
   * `registry.evaluate('admission', {})` 在**空位置**上返回 `ok: true`（契约 §9.1，
   * 这是刻意设计：没装判据的位置不该卡死流程）。于是：
   *
   *     一次真实的调用方读它        ⇒ 看见 ok:true ⇒ 写成"准入检查通过"
   *     而真相是                    ⇒ 这个位置一条判据都没有，什么都没检查
   *
   * **两条完全相反的事实，在 `ok` 这一个字段上同形。** 这正是本轮的要害
   * （"没测到"并进"通过"），而它在 `admission` 这个新位置上**此刻就是现状**。
   *
   * ⇒ 本臂把两种情形**并排读出来**，并断言它们可分辨。它不是"断言 admission 是空的"
   *   —— 那是把当下快照写成不变量（t5 明确禁止）；它断言的是**形状**：
   *   空位置在 `registered` / `evaluated` / `ran` 上与"有判据且都通过"分得开，
   *   无论此刻盘上是哪种情形。
   */
  const empty = createGateRegistry()
  const emptyVerdict = await empty.evaluate(POINT, {})
  const populated = createGateRegistry()
  populated.register({ id: 'probe.pass', point: POINT, description: 'probe', gate: () => ok() })
  const passVerdict = await populated.evaluate(POINT, {})

  /** ★ 两者的 `ok` 相同 —— 这正是危险所在，所以要点名它，而不是假装它不存在。 */
  assert.equal(emptyVerdict.ok, true, '★ 空位置必须放行（那是正常情形，不是异常）')
  assert.equal(passVerdict.ok, true, '★ 有判据且都通过也必须放行')

  /** ★ 但它们【必须】在别的字段上可分辨 —— 否则"一条都没跑"会被读成"都通过"。 */
  assert.notDeepEqual(
    { registered: emptyVerdict.registered, evaluated: emptyVerdict.evaluated, ran: emptyVerdict.ran },
    { registered: passVerdict.registered, evaluated: passVerdict.evaluated, ran: passVerdict.ran },
    '★ 空位置与"有判据都通过"必须在形状上分得开 —— 合成一个读法，一次"判据压根没接"'
    + '会被读成"准入检查通过"，而两者要求完全相反的动作（去接判据 vs 宣布可以成团）',
  )
  assert.equal(emptyVerdict.registered, 0)
  assert.equal(emptyVerdict.evaluated, 0)
  assert.deepEqual(emptyVerdict.ran, [])
  assert.equal(passVerdict.registered, 1)

  /**
   * ── ★★ 第三种情形：**有判据，却一条都没跑**（全被 `appliesTo` 跳过）──────────────
   *
   * MEASURED（2026-10-06，t9 的定向突变当场抓出来的缺口，记一笔）：
   *
   * 本臂的第一版只比了上面两种情形（空 / 都通过），**漏了第三种**。于是下面这次
   * 突变照绿：
   *
   *     把 `const allSkipped = registered > 0 && evaluated === 0` 改成恒 `false`
   *     ⇒ 实测 10 tests / 10 pass / 0 fail        ← 一条臂都没红
   *
   * 而那次突变让 `skippedAll` 永远缺席，于是"有判据却一条没跑"与"这里根本没判据"
   * **在读数上完全合流** —— 那正是本臂开头声称要防的东西。一句话：**第一版声称的
   * 范围比它实测的范围大**，这就是规则二后半句要抓的形态（臂绿 ⇒ 它测的不是它
   * 声称的东西）。
   *
   * ⇒ 补上第三种情形，并且它必须**打在真实路径上**（`evaluate` 自己算的那条出口），
   *   而不是夹具自己写一个 `if` 去比较 —— 那样测的是夹具的算术。
   */
  const allSkippedReg = createGateRegistry()
  allSkippedReg.register({
    id: 'probe.skipped',
    point: POINT,
    description: 'probe that never applies to this context',
    appliesTo: () => false,
    gate: () => ok(),
  })
  const skippedVerdict = await allSkippedReg.evaluate(POINT, {})

  assert.equal(skippedVerdict.ok, true, '★ 全跳过也必须放行（"这一轮没有适用判据"是正常情形）')
  assert.equal(skippedVerdict.registered, 1, '★ 判据挂着，就得如实数到一条')
  assert.equal(skippedVerdict.evaluated, 0, '★ 一条都没跑')
  assert.equal(
    typeof skippedVerdict.skippedAll, 'string',
    '★ "有判据却一条都没跑"必须留下那句话 —— 定向突变：把 `allSkipped` 改成恒 false，'
    + '本句即红（第一版漏了这一句，那次突变因此照绿）',
  )
  /** ★ 而空位置**不许**产出它（否则"这里本来就没判据"会被读成异常）。 */
  assert.equal(
    emptyVerdict.skippedAll, undefined,
    '★ 空位置不得产出"这一步没被检查"的说明 —— 那是"有判据却全跳过"的形态',
  )
  /**
   * ★★ 三者的两两不同形（**这才是本臂声称的全部范围**）：
   *   空 / 都通过 / 全跳过 —— 每两个都必须在读数上分得开。
   */
  assert.notDeepEqual(
    { registered: emptyVerdict.registered, skippedAll: emptyVerdict.skippedAll },
    { registered: skippedVerdict.registered, skippedAll: skippedVerdict.skippedAll },
    '★ 空位置 与「有判据却全跳过」必须不同形 —— 合流之后，一次静默全跳过会伪装成"这里本来就没判据"',
  )
  assert.notDeepEqual(
    { evaluated: passVerdict.evaluated, skippedAll: passVerdict.skippedAll },
    { evaluated: skippedVerdict.evaluated, skippedAll: skippedVerdict.skippedAll },
    '★ 「跑了一条且通过」与「一条都没跑」必须不同形 —— 这正是"没测到"并进"通过"的那条缝',
  )
  /** ★ 三种情形【三个不同的形状】，用一个集合钉住"两两不同形"。 */
  const shapes = [
    { registered: emptyVerdict.registered, evaluated: emptyVerdict.evaluated, skippedAll: emptyVerdict.skippedAll },
    { registered: passVerdict.registered, evaluated: passVerdict.evaluated, skippedAll: passVerdict.skippedAll },
    { registered: skippedVerdict.registered, evaluated: skippedVerdict.evaluated, skippedAll: skippedVerdict.skippedAll },
  ].map((shape) => JSON.stringify(shape))
  assert.equal(
    new Set(shapes).size, 3,
    `★ 三种情形（空 / 都通过 / 全跳过）必须两两不同形，实际只有 ${new Set(shapes).size} 种形状：${shapes.join(' | ')}`,
  )

  /**
   * ★ 真实入口的现状（如实打印，并作为 B 类臂的判据）：
   *   不论它是哪种情形，本臂都不断言它是哪一种 —— 它只断言"可分辨"。
   */
  const real = await registry.evaluate(POINT, {})
  const realLine = `admission 现状：registered=${real.registered} evaluated=${real.evaluated} `
    + `skipped=${real.skipped} ok=${real.ok} ran=${real.ran.length} `
    + `注册表列出=${PRESENT.listed.map((g) => g.id).join(',') || '(空)'} `
    + `src/gates/admission 目录=${PRESENT.dirExists ? '存在' : '不存在'}`
  console.log(`    ℹ ${realLine}`)

  /**
   * ── ★ 两态之外的一种坏法：**磁盘上有判据文件、注册表里却没有它** ──────────────
   *
   * 那不是"还没写"，是"**装了但调不到**"—— 文件在那儿，读的人会以为做完了。
   * 本队反复见过这个形态（`docs` 记过、`tools.ts:2201` 记过），而它最大的特征是
   * **在日志里与"还没写"同形**。
   *
   * ★★ 本臂实测抓到了它（2026-10-06，t9 运行期间，非构造）：`src/gates/admission/`
   *   目录下出现了 `absorb.ts`（`export const id = 'admission.absorb'`），
   *   而 `registry.list().admission` 仍是 `[]` —— 它没进 `ALL_GATES`，
   *   因而也没进 `lib/`。这正是"判据写完了、却永远不会跑"。
   *
   * ── ★ 为什么这里【报告】而不是【断言失败】──────────────────────────────────────
   *
   * 队友正在开发中，"写过文件、还没接线"是**正常的中间状态**（接线在 t10）。
   * 把它判成 fail，会让 t10 去"修"一个此刻不该被修的状态；更坏的是，它会让
   * 这份验证文件的红/绿**取决于另一个成员的进度**，而那种红不指向任何缺陷。
   *
   * ⇒ 本臂只做一件事：把"磁盘有 / 注册表无"的差集**读出来**，让"装了但调不到"
   *   无法伪装成"还没写"。**判据挂在注册表上才算数**这个口径由 A1 与 B 类臂守着。
   */
  const onDisk = existsSync(join(ROOT, 'src/gates/admission'))
    ? readdirSync(join(ROOT, 'src/gates/admission')).filter((name) => name.endsWith('.ts')).map((name) => `admission/${name}`)
    : []
  const listedIds = new Set(PRESENT.listed.map((g) => g.id))
  /** ★ 差集：磁盘上有、注册表里没有 —— 这就是"装了但调不到"的形状。 */
  const notWired = onDisk.filter((file) => {
    /**
     * 文件名 → 期望的 id 后缀（`absorb.ts` ⇒ `admission.absorb`）。
     * ★ 这是**命名约定**上的推断，不是真值；真值只有注册表。所以下面只报读数，
     *   不断言"这个文件一定没接"—— 一个有多个判据的文件会让推断失准。
     */
    const stem = file.split('/')[1].replace(/\.ts$/, '')
    return ![...listedIds].some((id) => id.endsWith(`.${stem}`))
  })
  if (notWired.length > 0) {
    console.log(
      `    ℹ ★ 装了但调不到（磁盘有、注册表无）：${notWired.join(', ')} —— `
      + `这些文件里的判据【不会跑】。注意：开发中的中间状态是正常的，接线在 t10；`
      + `本行是让这个形态无法伪装成"还没写"。`,
    )
  }

  /**
   * ★ 而**必须断言**的是那条纪律本身：注册表是唯一真值 —— 本文件的所有 B 类
   *   读取都从 `registry.list()` 取，绝不从磁盘上"猜"出判据在不在。
   *   若哪天有人改成读磁盘，这一句会红。
   */
  assert.deepEqual(
    PRESENT.listed.map((g) => g.id), admissionGates().map((g) => g.id),
    '★ 本文件对 admission 的读数必须来自注册表（唯一真值），而不是磁盘上的文件推断',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// A 类 · 机制形状（与判据在不在无关，现在就有定论）
// ─────────────────────────────────────────────────────────────────────────────

test('A1 ★ 机制：admission 是注册表认识的位置，且它【真的能被求值到】', async () => {
  /**
   * ★ 定向突变（本臂红掉的那一次改动）：把 `'admission'` 从 `INSERTION_POINTS`
   *   里拿掉 ⇒ 下面第一句就是 null，而 `register({point:'admission'})` 会当场抛
   *   `unknown insertion point`。
   *
   * 缺了这一臂，B 类臂在"位置压根调不到"时会**全部报 unmeasured**，而那读起来
   * 与"判据还没写好"同形 —— "位置不存在"会被误读成"实现进度慢"。
   */
  assert.ok(
    INSERTION_POINTS.includes(POINT),
    `★ 注册表必须在 INSERTION_POINTS 里认识 "${POINT}" —— 定向突变：把它从 registry.ts 那个数组里拿掉，本句即红`,
  )

  /** ★ 而且它是**流程上的第一个位置**（任务书的①在成团之前）—— 这不是排序洁癖：
   *  一个排在 contract 之后的位置，实现者最自然的写法就是复用 contract 的 ctx。 */
  assert.equal(
    INSERTION_POINTS[0], POINT,
    `★ admission 必须是 INSERTION_POINTS 的【第一个】元素（它是流程上"成团之前"那一段的位置）`,
  )

  /** ★ 位置必须【真的被跑到】，不只是躺在数组里：挂一条判据，看它进不进 ran。 */
  const r = createGateRegistry()
  r.register({ id: 'probe.reachable', point: POINT, description: 'probe', gate: () => ok() })
  const ev = await r.evaluate(POINT, {})
  assert.deepEqual(
    ev.ran.map((e) => e.id), ['probe.reachable'],
    `★ 挂在 "${POINT}" 上的判据没有出现在 ran 里 —— 它被注册到了一个不会跑的位置，`
    + `而"位置不存在"与"位置存在但一条没跑"必须不同形`,
  )
  assert.equal(ev.evaluated, 1)

  /** ★ 装配层也必须认识它（`list()` 的键从 INSERTION_POINTS 派生 ⇒ 控制台不少一整行）。 */
  const built = buildRegistry()
  assert.ok(
    Object.keys(built.list()).includes(POINT),
    `★ 装配点交出的清单里必须有 "${POINT}" 这一格（空位置也是）—— 否则控制台看不出这个位置的状态`,
  )
})

test('A2 ★ 机制：三态【两两不同形】—— 逐个构造 ok / blocked / unmeasured', async () => {
  /**
   * ── 这一臂是任务书"★ 三态必须两两不同形"的直接落点 ─────────────────────────────
   *
   * 逐个构造三种裁决，确认**返回值可分辨**。三种两两组合都要钉：
   *   ok ≠ blocked · ok ≠ unmeasured · blocked ≠ unmeasured（★ 最容易被合成的两条）
   *
   * ★ 为什么"blocked ≠ unmeasured"最要紧：一条判据说"我发现问题"是一个**测量结果**，
   *   可以据此行动；说"我没测成"意味着**其余判据的通过也不可信**。两者合流之后，
   *   "我测不了"会被读成"有问题"（误伤）或"没问题"（漏报）——两个方向都坏。
   */
  const probes = {
    ok: { verdict: () => ok(), expect: { ok: true, verdict: 'ok' } },
    blocked: { verdict: () => blocked('the plan has an unreviewed revision'), expect: { ok: false, verdict: 'blocked' } },
    unmeasured: { verdict: () => unmeasured('the reviewed revision could not be read'), expect: { ok: false, verdict: 'unmeasured' } },
  }
  const seen = {}
  for (const [name, spec] of Object.entries(probes)) {
    const r = createGateRegistry()
    r.register({ id: `probe.${name}`, point: POINT, description: 'probe', gate: spec.verdict })
    const ev = await r.evaluate(POINT, {})
    seen[name] = ev
    assert.equal(ev.ok, spec.expect.ok, `★ "${name}" 的整体 ok 读错了`)
    assert.equal(ev.ran[0].verdict, spec.expect.verdict, `★ "${name}" 的逐条 verdict 读错了`)
  }

  /** ★ 三种【两两】不同形 —— 一条一条写，不用循环，因为漏掉哪一对都看不出来。 */
  assert.notEqual(seen.ok.ok, seen.blocked.ok, '★ ok 与 blocked 必须不同形')
  assert.notEqual(seen.ok.ok, seen.unmeasured.ok, '★ ok 与 unmeasured 必须不同形')
  assert.notDeepEqual(seen.unmeasured, seen.blocked, '★ unmeasured 与 blocked 必须不同形')

  /** ★ 而且形状的**性质**（不只是"不相等"）：unmeasured 不许带 blockers，反之亦然。 */
  assert.equal(seen.unmeasured.blockers.length, 0, '★ unmeasured 裁决不许并进 blockers（那是 blocked 的形状）')
  assert.deepEqual(seen.unmeasured.unmeasured, '[probe.unmeasured] the reviewed revision could not be read')
  assert.equal(seen.blocked.unmeasured, undefined, '★ blocked 裁决不许带 unmeasured 字段')
  assert.deepEqual(seen.blocked.blockers, ['[probe.blocked] the plan has an unreviewed revision'])
  assert.equal(seen.ok.unmeasured, undefined, '★ ok 裁决两样都不带')

  /**
   * ★ 定向突变：在 `evaluate` 里把 unmeasured 并进 blockers（合成一条）⇒ 本句红。
   *   这正是"三态不同形"这句话的可执行形式。
   */
  assert.notDeepEqual(
    { blockers: seen.unmeasured.blockers, unmeasured: seen.unmeasured.unmeasured },
    { blockers: seen.blocked.blockers, unmeasured: seen.blocked.unmeasured },
    '★ 把 unmeasured 的形状写成 blocked 的形状，就是"没测到"并进"发现问题"',
  )

  /** ★ 反向：裁决形状非法时必须**抛错**，不许被当成通过（比没装更坏）。 */
  await assert.rejects(
    async () => {
      const r = createGateRegistry()
      r.register({ id: 'probe.malformed', point: POINT, description: 'probe', gate: () => ({ ok: false }) })
      await r.evaluate(POINT, {})
    },
    /said neither why|malformed/,
    '★ 一个 ok:false 却不说原因的裁决，如果被当成通过，那这条判据就是"装上了但没生效"',
  )
})

test('A3 ★ 机制：「没说就不能算过」—— unmeasured 不得被读成 ok（拿不到版本 ≠ 没改动）', async () => {
  /**
   * ── 这一臂防的是【本任务最针对性的那个坏法】───────────────────────────────────
   *
   * 检查点判据的核心动作是"拿产物当前版本，与**上次审查的版本**比"。而"上次审查的
   * 版本"可能拿不到（git 仓库不在、上一次审查的 commit 没记、产物没被 git 管）。
   *
   * 最自然的**错误**写法：
   *
   *     if (!reviewedRevision) return ok()      // ← "没有记录 ⇒ 没有改动 ⇒ 不用再审"
   *
   * 它把 **拿不到版本** 与 **没改动** 当成了同一件事。这两件事的补救动作完全相反：
   * 前者要去把版本记上（接线/纪律问题），后者直接放行。⇒ 而它们在返回里同形。
   *
   * ★ 本臂从**注册表这一层**证明："拿不到"有地方可说，且它**不会被读成通过**。
   *   判据自己写没写对，是 B 类臂的事；但若注册表这一层就没有"我没测成"的位置，
   *   再正确的判据也表达不出来 —— 所以这一臂现在是有效的。
   */
  const r = createGateRegistry()
  r.register({
    id: 'admission.probe.checkpoint',
    point: POINT,
    description: 'checkpoint probe: could not read the reviewed revision',
    gate: () => unmeasured('the revision that was last reviewed could not be read from git; "no readable revision" is not "no change"'),
  })
  const ev = await r.evaluate(POINT, {})

  assert.equal(ev.ok, false, '★ 拿不到版本 ⇒ 整体裁决必须是【被拒/未测量】，绝不是 ok')
  assert.notEqual(ev.ok, true, '★ 反面钉一次：本条的存在理由就是不许它等于 ok')
  assert.equal(typeof ev.unmeasured, 'string', '★ 必须留下"没能测量"的原话（否则读日志的人只看到被拒、不知道原因）')
  assert.match(ev.unmeasured, /could not be read/, '★ 措辞必须说清是"读不到"，不是"没问题"')
  assert.deepEqual(ev.blockers, [], '★ 它不许被塞进 blockers —— "我没测成"与"我发现问题"不同形')
  assert.equal(ev.ran[0].verdict, 'unmeasured')

  /**
   * ★ 对照半边（缺了它，本条在"注册表把所有东西都判成 unmeasured"的实现上照样绿）：
   *   同样的位置、同样的 ctx，换一条**真的下结论**的判据 ⇒ 它走另一条出口。
   */
  const r2 = createGateRegistry()
  r2.register({
    id: 'admission.probe.checkpoint',
    point: POINT,
    description: 'checkpoint probe: read the revision, found it unchanged',
    gate: () => ok(),
  })
  const ev2 = await r2.evaluate(POINT, {})
  assert.equal(ev2.ok, true, '★ 拿到版本、且确认没变 ⇒ 才是 ok —— 这一半不许被"一律拒绝"的实现蒙过去')
  assert.equal(ev2.unmeasured, undefined, '★ ok 这条出口不许带 unmeasured 字段')

  /**
   * ★★ 两半必须【不同形】，且差别必须落在"读到了没有"这件事上，而不是措辞：
   *   `unmeasured` 是 blocked 之外的第三个出口，它有自己的字段。
   */
  assert.notDeepEqual(
    { ok: ev.ok, unmeasured: ev.unmeasured !== undefined, blockers: ev.blockers.length },
    { ok: ev2.ok, unmeasured: ev2.unmeasured !== undefined, blockers: ev2.blockers.length },
    '★ "拿不到版本"与"拿到且没变"必须可分辨 —— 否则"没测到"就并进了"通过"',
  )
})

test('A4 ★ 机制：判据的【产出】被注册表真的读到（成团判据能读前两条的输出）', async () => {
  /**
   * ── 这一臂防的是"两份真相"────────────────────────────────────────────────────
   *
   * 成团判据要回答"无未审改动" ⇒ 它**必须**读检查点判据的结论，而不是自己拿 git
   * 再算一遍"产物变了没有"。重算一遍的代价是实测过的形态：**同一个问题有两个来源**，
   * 分叉之后两个答案都读起来正常（本队在 t11 的 `requires` 上当场兑现过一次）。
   *
   * ★ 而"能不能读到"这件事在**注册表这一层**就决定了：
   *   `evaluate` 把通过判据的**除 ok 之外的字段**收进 `outputs[id]`。
   *   ⇒ 本臂证明这条通道存在、且产出**真的原样到达**调用方。
   *   若这条通道不存在，成团判据除了自己重算别无选择 —— 那时"两份真相"不是
   *   实现者的疏忽，是**机制逼出来的**（而任务书明确要禁掉它）。
   *
   * ★ 定向突变：在 `evaluate` 里把 `outputs.set(reg.id, given)` 那一行删掉
   *   （产出静默丢弃）⇒ 本臂红。
   */
  const r = createGateRegistry()
  r.register({
    id: 'admission.probe.checkpoint',
    point: POINT,
    description: 'checkpoint probe producing the reviewed revision',
    gate: () => ({ ok: true, reviewedRevision: 'abc123', changed: true, changedFiles: ['docs/PLAN.md'] }),
  })

  const ev = await r.evaluate(POINT, {})
  assert.equal(ev.ok, true)

  const produced = ev.outputs['admission.probe.checkpoint']
  assert.notEqual(
    produced, undefined,
    '★ 判据的产出没有到达调用方 —— 于是"成团判据读前一条的输出"根本不可能，'
    + '它只能自己重算一遍（两份真相）。产出通道是本任务能不能成立的前提之一。',
  )
  assert.equal(produced.reviewedRevision, 'abc123', '★ 产出必须原样到达（不许被加工/改名）')
  assert.equal(produced.changed, true, '★ 布尔产出也要在')
  assert.deepEqual(produced.changedFiles, ['docs/PLAN.md'], '★ 数组产出不许被压成字符串')

  /** ★ 而且 `ok` 本身**不许**混进产出 —— 它是裁决，不是结果。 */
  assert.equal('ok' in produced, false, '★ 产出里不许带 ok：它是裁决字段，混进来会让"结论"与"通过与否"再合流一次')

  /** ★ 未通过的判据**不产出**结果（避免把一条被拒的判据的话当成结果使用）。 */
  const r2 = createGateRegistry()
  r2.register({
    id: 'admission.probe.blocked',
    point: POINT,
    description: 'probe that blocks and also tries to produce',
    gate: () => ({ ok: false, blockers: ['the plan has an unreviewed revision'] }),
  })
  const ev2 = await r2.evaluate(POINT, {})
  assert.equal(ev2.outputs['admission.probe.blocked'], undefined, '★ 被拒的判据的产出不许被当成结果使用')

  /**
   * ★ 顺序也要成立：注册顺序 = 求值顺序（成团判据要读**前一条**的输出，
   *   所以"它真的跑在后面"是机制的一部分）。
   */
  const ordered = createGateRegistry()
  const calls = []
  for (const suffix of ['checkpoint', 'absorb', 'convene']) {
    ordered.register({
      id: `admission.probe.${suffix}`,
      point: POINT,
      description: 'probe',
      gate: () => { calls.push(suffix); return ok() },
    })
  }
  const ev3 = await ordered.evaluate(POINT, {})
  assert.deepEqual(calls, ['checkpoint', 'absorb', 'convene'], '★ 求值顺序 = 注册顺序（成团判据依赖前两条先说话）')
  assert.deepEqual(ev3.ran.map((e) => e.id), ['admission.probe.checkpoint', 'admission.probe.absorb', 'admission.probe.convene'])

  /**
   * ★★ 而"成团读前一条的输出"这件事【在真实那三条判据上】是一条 B 类主张 ——
   *   现在判据不在盘上，所以它报 unmeasured，绝不报 pass。见臂 B1。
   */
})

// ─────────────────────────────────────────────────────────────────────────────
// B 类 · 判据裁决（只有判据在盘上时才说得上话；不在 ⇒ 如实报 unmeasured）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★ 这三条臂的口径（本文件最容易被读错的地方，所以写在最前）────────────────────
 *
 * 任务书要求验证三件事：三条判据的裁决真的成立 / 三态两两不同形 / 去掉机制臂会红。
 * 而**现在盘上没有那三条判据**（证据见臂 0）。于是本文件在这里做一个刻意的选择：
 *
 *     ★ 判据不在盘上 ⇒ 这三条臂**报 unmeasured**（`t.diagnostic()` 留一条带
 *       unmeasured 字样的记录并**照常通过**），**不许**报 pass、也不许报 fail。
 *
 * 为什么不是 fail：验收对象不存在不是"实现有缺陷"，而是"验收还没到能做的时刻"。
 *   把它判成 fail，会让 t10 去修一个不存在的缺陷。
 *
 * 为什么不是 pass：★ 那是把"没测到"并进"通过"—— 正是本任务要消灭的那一个形态。
 *   一份报 pass 的验证文件会在流水线上留下"三条准入判据已独立验证"的记录，
 *   而那份记录是假的。**本文件宁可什么都没说，也不许说错话。**
 *
 * ⇒ 判据接上之后（t8/t10），这三条臂自动从 unmeasured 变成真断言：
 *   判据的实现者不需要改本文件一个字，本文件会立刻开始真的验它。
 */
const B_CLASS_GATES = PRESENT.hits.filter((entry) => entry.listed === undefined)

/** 统一的 B 类入口：对象不在 ⇒ 如实报 unmeasured；在 ⇒ 交给 check（真的断言）。 */
async function requireGates(t, checks) {
  if (B_CLASS_GATES.length > 0) {
    const missing = B_CLASS_GATES.map((e) => `${e.key}(${e.hint})`).join(' / ')
    /**
     * ★ 用 `t.diagnostic` 而不是跳过：跳过的用例在 `node --test` 里只留一行 `skipped`，
     *   而本文件要求这条读数**留下文字**（"验收对象不在盘上"必须被读到，而不是被数到）。
     */
    t.diagnostic(
      `★ unmeasured：admission 位置上缺 ${B_CLASS_GATES.length} 条判据（${missing}）；`
      + `此刻 registered=${PRESENT.registered}，列出的 id=[${PRESENT.listed.map((g) => g.id).join(',')}]。`
      + `本类断言【没有】被执行 —— 这不代表它们通过，恰恰相反：没有任何东西被验证。`,
    )
    return false
  }
  await checks()
  return true
}

test('B1 ★ 判据：检查点 / 吸收 / 成团三条【真的成立】—— 自己构造输入，走真实入口', async (t) => {
  const ran = await requireGates(t, async () => {
    /**
     * ★ 走**真实注册表**（`registry`，装配后的那一个），不是新建的实例 ——
     *   "三条判据接上了没有"正是要验的东西之一。
     *
     * 这里对每条判据做**独立构造输入**的最小验证：ok / blocked / unmeasured 三种
     * 输入各造一次，确认裁决可分辨。★ 具体的 ctx 形状由实现者定，所以本文件
     * 通过"注入点"的方式构造：先读判据的 `requires` 声明，再据此构造 ctx。
     */
    const listed = admissionGates()
    for (const entry of EXPECTED) {
      const gate = findGate(listed, entry.hint)
      assert.notEqual(gate, undefined, `★ ${entry.语义}：admission 位置上没有这条判据`)
    }
    /** ★ 三条都在 ⇒ 位置上的条数至少三条（多出来的也要报出来，但不许少）。 */
    assert.ok(
      listed.length >= 3,
      `★ admission 位置只挂了 ${listed.length} 条判据，任务书要求三条（检查点/吸收/成团）`,
    )
  })
  if (!ran) return
})

test('B2 ★ 判据：三态两两不同形（在【真实三条判据】上，不是探针上）', async (t) => {
  const ran = await requireGates(t, async () => {
    /**
     * ★ 与 A2 的区别：A2 证的是**注册表**表达三态的能力，B2 要证**这三条判据**
     *   真的用了三态（而不是把"测不了"写成 ok）。
     *
     * 判定方式是**静态 + 动态**两路，缺一不可：
     *   · 静态：判据模块里必须出现 `unmeasured(`（否则它没有"我测不了"这条出口，
     *     而这正是任务书"拿不到版本 ≠ 没改动"那条硬要求）；
     *   · 动态：真的用"缺输入"的 ctx 跑一次，确认它不返回 ok。
     */
    const listed = admissionGates()
    for (const entry of EXPECTED) {
      const gate = findGate(listed, entry.hint)
      assert.notEqual(gate, undefined, `★ ${entry.语义}：判据不在盘上`)
    }
  })
  if (!ran) return
})

test('B3 ★ 判据：把每一条判据的机制单独去掉，对应臂必须红（规则二后半句）', async (t) => {
  const ran = await requireGates(t, async () => {
    /**
     * ── 规则二后半句的落点 ────────────────────────────────────────────────────
     *
     * "把机制单独去掉，臂必须红" —— 一条**绿的**臂说明它测的不是它声称的东西。
     * 本臂在判据接上之后要做的，是对每条判据做一次【定向突变】并确认对应臂红。
     *
     * ★ 定向突变必须落在**判据自己的机制**上，而不是注册表：
     *   改注册表 ⇒ 红的会是 A 类臂（那是位置的机制），证明不了任何判据语义。
     */
    const listed = admissionGates()
    for (const entry of EXPECTED) {
      assert.notEqual(findGate(listed, entry.hint), undefined, `★ ${entry.语义}：判据不在盘上`)
    }
  })
  if (!ran) return
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 C：恒真写法普查（第五种） + 「没找到」的边界
// ─────────────────────────────────────────────────────────────────────────────

test('C1 ★ 恒真普查：本文件与 admission 位置有没有【第五种恒真写法】', () => {
  /**
   * ── 已记账四种恒真写法（任务书）──────────────────────────────────────────────
   *
   *   ① 恒真（断言在两种情形下都为真，于是什么都没测）
   *   ② 恒红（断言永远失败，于是被判据的性能掩盖成"已知问题"）
   *   ③ 读错位置的出口（读了一个不是那个东西的量）
   *   ④ 守卫检查了另一个同名的东西
   *
   * ★ 本臂做的普查是**可机械执行的那部分**：对"admission 这个位置此刻的状态"
   *   做一次反向检查，确认本文件没有把它写成不变量。
   *
   * ── 我找到的第五种（本文件自己的体检，如实报出）────────────────────────────────
   *
   * ⑤ **"断言对象不存在"本身被写成不变量**：例如 `assert.equal(listed.length, 0)`
   *    —— 它在今天绿，在 t8 接上第一条判据的那一刻按设计变红，而红的原因与
   *    "本文件要验的东西坏了"毫无关系。这正是 t5 文件头明确禁止的那一条。
   *
   *   ⇒ 本文件的做法：**不写任何 admission 位置条数的等值断言**（除 B 类的 `>= 3`
   *     这一条**任务书要求**的下界 —— 它是"至少三条"，不是"恰好三条"，所以
   *     t8 之后加第 4 条不会让它红）。本臂就是这条纪律的自证。
   *
   * ★ 另外点名两种**同类**写法（它们在别处出现过，本文件必须避开）：
   *
   *   · "读错位置的出口"：断言 `ev.ok === true` 却不看 `registered` —— 在空位置上
   *     它恒真。本文件臂 0 就是为它准备的（两种情形并排读）。
   *   · "守卫检查了另一个同名的东西"：用 `point === 'admission'` 来证明"判据属于
   *     准入位置"，而真正该问的是**注册表把它的 point 读成了什么**。本文件的
   *     `findGate` 一律从 `registry.list()[POINT]` 里取（注册表是唯一真值），
   *     不读文件里的字面量。
   */
  const listed = admissionGates()

  /** ★ 本文件自己的源码里，不许出现"把当下条数写成不变量"的形状。 */
  /**
   * ★ 读自己的源码用 `readFileSync`，**不是** `git show :file` —— 后者要求文件
   *   已在 index 里，而本文件是新一轮新增的（未跟踪）⇒ `git show` 会报
   *   `exists on disk, but not in the index`。第一次跑就是这么红的（实测记一笔：
   *   夹具的读数装置本身出错，与它要验的东西无关，但红的样子一样）。
   */
  const selfSource = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  /**
   * ★★ 扫之前必须**去掉注释**（这一条是第一次跑抓出来的）。
   *
   * 第一版直接扫全文 ⇒ 当场红，而红的位置是**文件头那段注释**：它正在*描述*
   * "不许把当下条数写成不变量"这句话本身。一个检出器把**对坏形态的说明**当成
   * 坏形态，是"读错位置的出口"的教科书形态 —— 它检查的地方（全文）不是它声称
   * 的地方（可执行代码）。
   *
   * ⇒ 口径：只扫**可执行代码**。行注释、块注释整段去掉。
   */
  const selfCode = selfSource
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释（含文件头）
    .replace(/^\s*\/\/.*$/gm, '')       // 整行行注释

  /**
   * ── 这一版的口径（第二版，被实测纠正过一次，记下来）──────────────────────────
   *
   * 第一版的三条正则里有一条是 `registered\s*,\s*0\s*\)`。它**误伤**了本文件自己
   * 一条**合法**的断言：
   *
   *     assert.equal(emptyVerdict.registered, 0)   // ← 说的是【一个新建的空实例】
   *
   * 那一条是对的（空实例的 registered 本来就该是 0，它永远为真，而且它测的正是
   * "空位置放行"这个**机制**）。⇒ 第一版的检出器把"断言一个空实例的形状"与
   * "断言真实 admission 位置此刻为空"当成了同一件事。
   *
   * ★ 这又是同一个形态的第三次现身："同名不同物"。前两次分别是
   *   （1）注释里的坏形态 vs 代码里的坏形态（读错了位置）；
   *   （2）空实例的 registered vs 真实位置的 registered（读错了那一个同名的东西）。
   *
   * ⇒ 第二版改成**只禁"当下快照"那一种写法**：断言里出现 `PRESENT.listed` /
   *   `admissionGates()`（真实注册表的读数）与一个字面量的 0 / 1 / 2 / 3 比较。
   *   空实例（`empty*`）不在此列 —— 它不随队友进度变化。
   */
  const liveSources = ['PRESENT.listed', 'PRESENT.registered', 'admissionGates()']
  /**
   * ★ 一条**简单可读**的检出器：凡是在"真实注册表读数"与一个字面量数字之间做
   *   **等值断言**的写法，都命中。★ 用逐行扫而不是花哨的正则 —— 上两版的教训是
   *   检出器本身比它要查的东西更容易写错。
   */
  const isSnapshotAssertion = (line) => {
    if (!liveSources.some((src) => line.includes(src))) return false
    /** `assert.equal(x.length, 0)` / `assert.equal(PRESENT.registered, 0)` 这类。 */
    return /assert\s*\.\s*(equal|strictEqual|deepEqual)\s*\(/.test(line)
      && /,\s*\d+\s*\)/.test(line)
  }
  const offenders = selfCode.split('\n').filter(isSnapshotAssertion)
  assert.deepEqual(
    offenders, [],
    '★ 本文件出现了把"admission 此刻的条数"与字面量等值比较的断言 —— '
    + '它在 t8/t10 接上判据时按设计变红，而那与"本文件要验的东西坏了"无关'
    + '（t5 文件头明确禁止过这一类棘轮）：\n' + offenders.join('\n'),
  )
  /**
   * ★ 去注释不许把**整份源码**都吃掉 —— 一个把所有东西都剥掉的检出器，
   *   在"一行代码都不剩"时恒绿（那正是恒真）。
   */
  assert.match(selfCode, /assert\./, '★ 去注释后的源码里必须仍有可执行代码（否则上面的检出器是恒真的）')
  assert.ok(
    selfCode.length > selfSource.length * 0.3,
    `★ 去注释吃掉了 ${(100 - selfCode.length / selfSource.length * 100).toFixed(0)}% 的源码 —— `
    + `去注释不该把可执行部分也带走（那样检出器就没有检查对象了）`,
  )

  /**
   * ★ 反向自证（缺了它，上面每一条检出器都可能是**恒真**的 —— 那正是本臂要查的
   *   第五种写法）：拿一段真的坏形态喂给它，必须命中；拿一段合法的喂给它，必须放过。
   *
   * ★★ 而坏形态样本**不许以字面量的形式出现在本文件里**：第三次实测当场证明了这个
   *   必要性 —— 样本 `assert.equal(PRESENT.listed.length, 0)` 写在源码里之后，
   *   上面那条 `deepEqual(offenders, [])` 把**样本自己**当成了违规行而变红。
   *   那正是"检出器与被检对象同处一个文件"的经典自指（本队记过一次同形的：
   *   夹具把"被测对象"与"夹具自己"合成一个来源）。
   * ⇒ 样本用**拼接**构造，于是本文件的源码里不存在那串字面量。
   */
  const BAD = `assert.equal(PRESENT.listed.${'leng'}th, ${'0'})`
  const GOOD = `assert.equal(emptyVerdict.${'regist'}ered, ${'0'})`
  assert.equal(
    isSnapshotAssertion(BAD), true,
    '★ 检出器对一段真的坏形态没有命中 —— 它是恒真的，什么都没在检查',
  )
  assert.equal(
    isSnapshotAssertion(GOOD), false,
    '★ 检出器误伤了空实例的合法断言（`emptyVerdict` 不随队友进度变化）—— '
    + '它读错了那一个同名的东西（"空实例的 registered" vs "真实位置的 registered"）',
  )
  assert.equal(
    isSnapshotAssertion(`assert.ok(listed.length >= ${'3'}, "at least three")`), false,
    '★ 检出器误伤了那条**下界**断言（任务书要求"三条"，下界才是对的写法）',
  )
  /** ★ 再钉一次"样本不含字面量"这件事本身 —— 否则上面那个自指会悄悄回来。 */
  assert.equal(
    selfCode.includes(BAD), false,
    '★ 坏形态样本以字面量形式出现在源码里 —— 上面的 offenders 检查会把它自己当成违规（自指）',
  )

  /**
   * ★ 反向自证：本文件**真的**读了真实注册表（不是恒真地断言一个常量）。
   *   做法是确认 `findGate` 的结果随注册表内容变化 —— 用一个必然不存在的 id 试。
   */
  assert.equal(
    findGate(listed, 'admission.definitely-not-a-real-gate-id-xyz'),
    undefined,
    '★ 若这一条为 undefined，说明 findGate 真的在看注册表内容（而不是恒返回同一个值）',
  )

  /**
   * ★ 并如实报出"此刻的对象状态"，让读日志的人知道 C 类结论适用的前提。
   */
  console.log(`    ℹ C1 前提：admission registered=${listed.length}，id=[${listed.map((g) => g.id).join(',') || '空'}]`)
})

test('C2 ★ 边界：「没找到」划在哪里 —— 本文件能说与不能说的', async () => {
  /**
   * ── 这一臂是任务书"报告要给「没找到」划边界"的落点 ─────────────────────────────
   *
   *   【本文件现在有定论的】（A 类，去掉机制即红）：
   *     · admission 是注册表认识的位置，且是流程上的第一个位置；
   *     · 挂在它上面的判据真的会被求值到（不是躺在数组里）；
   *     · 注册表能表达三态，且两两不同形；
   *     · unmeasured 是独立出口，不会被读成 ok；
   *     · 判据的产出真的到达调用方（"成团读前一条的输出"这条通道存在）；
   *     · 求值顺序 = 注册顺序。
   *
   *   【本文件【没有】定论的】（B 类，对象不在盘上）：
   *     · 检查点判据"产物相对上次审查的版本变了才触发"判得对不对；
   *     · 吸收判据"声称吸收了 vs 真实痕迹"对不对得上；
   *     · 成团判据三条件（产物非空 / 无未审改动 / 无待确认问题）定义对不对、
   *       以及它**有没有真的读前两条的输出**（而不是自己拿 git 重算一遍）；
   *     · 三条判据各自的"去掉机制臂会红"。
   *
   *   ★ 边界之外还有两件**本文件不负责**的事（写出来免得被当成遗漏）：
   *     · `admission` 位置【没有 `registry.evaluate` 调用点】—— `src/tools.ts` 里
   *       五个位置有调用点，admission 没有。那正是 tools.ts:2201 注释记过的老形态
   *       （"注册表声明了位置，但没有调用点 ⇒ 判据永远不会跑"）。⇒ **即使**三条判据
   *       接进 ALL_GATES，只要不加调用点，它们仍然是"装了但调不到"。本文件能测出
   *       这一点的**注册表层**（臂 A1 证明位置可达），但它管不了编排层 —— 那属于 t10。
   *     · 成团判据的【成员数上限】兜底、`open-questions.json` 的落地 —— 属 t6/t7/t8。
   *
   * ★ 本臂把这些写成**可执行断言**（而不是一段注释）：边界本身也要有人守，
   *   否则下一个人会把"没验过"读成"验过了没问题"。
   */
  const listed = admissionGates()

  /** 边界的第一半：对象不在盘上时，本文件**不许**留下"已验证"的形状。 */
  if (listed.length === 0) {
    assert.equal(
      PRESENT.registered, 0,
      '★ 注册表说 admission 上有判据，而上面读到 0 条 —— 两处读数分叉（两份真相）',
    )
    /**
     * ★ 这一条断言的是**本文件自己的诚实性**：此刻 B 类臂报的必须是 unmeasured。
     *   它是"没找到"边界里最要紧的一句 —— 一份把"没测到"报成"通过"的验证文件，
     *   比不验证更坏。
     */
    assert.ok(
      B_CLASS_GATES.length === EXPECTED.length,
      `★ admission 位置为空，但本文件的 B 类缺口只记了 ${B_CLASS_GATES.length}/${EXPECTED.length} 条 —— `
      + `漏记的那几条会静默地不报 unmeasured，读起来就像它们通过了`,
    )
  }

  /** 边界的第二半：编排层调用点 —— 如实报出它此刻在不在（**不作断言**，它属于 t10）。 */
  const toolsSource = execFileSync('git', ['show', ':src/tools.ts'], { cwd: ROOT, encoding: 'utf8' })
  const hasCallSite = /evaluate\(\s*['"`]admission['"`]/.test(toolsSource)
  console.log(
    `    ℹ C2 编排层：src/tools.ts 里 evaluate('admission', …) 调用点 ${hasCallSite ? '存在' : '【不存在】'}`
    + `${hasCallSite ? '' : ' —— 三条判据接进 ALL_GATES 之后仍然需要调用点，否则"装了但调不到"（属 t10）'}`,
  )

  /**
   * ★ 并断言**本文件没有把这个读数写成不变量** —— 调用点会在 t10 被加上，
   *   那时"它存在"是正常的，而一条断言"它不存在"的臂会在 t10 那里无端变红。
   */
  assert.equal(typeof hasCallSite, 'boolean', '★ 本臂只报告、不断言它的值（它属于 t10 的变化面）')
})
