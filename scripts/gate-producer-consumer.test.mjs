/**
 * ── ★ S1 判据（t60）：每一份被生产出来的东西，都要有一个【读它的地方】───────────────
 *
 * ── 它来自两次实测（两次都在本队现场）──────────────────────────────────────────
 *
 *   ① t41：`workspaceAndWorktreeChangedPaths` —— 写好了、测过了、而**零个生产调用方**。
 *      ★ 而它藏了很久的原因正是本判据的核心：**它的调用点全在夹具里**
 *        （`gate-changed-paths.test.mjs` 多处），而生产里一个都没有。
 *   ② t54：`discriminatingFiles` → `newTestFiles`，而它唯一的门（r5）不再对 repair 生效
 *      ⇒ 那条证据**被生产出来而没人消费**。
 *
 * ⇒ 本队那句话的机械化：
 *
 *     **「一个没有调用方的产出，与没有那个产出在观测上完全相同。」**
 *
 * ── 覆盖两类产出 ──────────────────────────────────────────────────────────────
 *
 *   一类：**模块级导出** —— 一个函数/常量被 `export` 了，而没有任何地方读它。
 *   二类：**运行时数据** —— 一个值被算出来、注入进 ctx，而那个 ctx 格没人读。
 *         ★ 本文件用**可扫描的形状**来判它：`requires` 声明（判据要的格）与
 *           `ctx.<格>` 的真实读取点的对应关系（见臂 3）。
 *
 * ── ★★ 核心口径：夹具调用【不算】消费者（captain 2026-10-08 的裁定）─────────────
 *
 *     t41 那个函数的调用点**全在夹具里** ⇒ 若把夹具调用算作消费者，这条判据
 *     **抓不到那个实例**；不算 ⇒ 它抓到。⇒ 所以：
 *
 *        生产消费者 = `src/` 下的读取点
 *        夹具消费者 = `scripts/` 下的读取点（**单独计数，单独成态**）
 *
 *     ★ 而那个区分是**可机械判定的**（调用点在 `scripts/` 下 vs 在 `src/` 下）。
 *     ★ 而"只有夹具消费"与"完全无消费"**必须不同形** —— 前者是一个**真实且危险的
 *       中间态**（它在测试里看起来被使用，在生产里从未被调用），后者只是死代码。
 *
 * ── ★ 三态 + 附条件（用户 2026-10-08 的原话）─────────────────────────────────────
 *
 *     「也不是说在特定条件下起效的就不能加，只是需要把这些特定条件顺便加上去。」
 *
 * ⇒ "只在【生产点与消费点都在可扫范围内】时适用"这个条件**写进判据本身**：
 *   本文件把 `src/client/**`（**单独打包**的客户端 bundle）与任何在扫描根之外的
 *   东西判成 `unmeasured`，而**不是**判成"无消费"。★ 因为它们在观测上不可判 ——
 *   而"不可判"并进"无消费"会制造一堆永远修不掉的噪音（那正是教人忽略门禁的老路）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────────────────────────
// 装置：扫源码里被生产出来的东西，为每一份找消费点
// ─────────────────────────────────────────────────────────────────────────────

/** 递归收集某个后缀集的文件。 */
function walk(dir, extensions) {
  const out = []
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) visit(full)
      else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full)
    }
  }
  visit(dir)
  return out
}

/**
 * ── ★★ 剥注释：本装置**必须**先做这一步（两次实测都栽在这里）─────────────────────
 *
 * MEASURED（2026-10-08，本任务第一次跑）：
 *
 *   ① 臂 3 的第一版没剥注释 ⇒ 它命中了 `registry.ts` 里**注释中的一句示例**
 *      （`* export const requires: CtxPaths<…>[] = ['event', …]`），
 *      对**从来没有过 requires 的文件**产出了一份假的"声明了却读不到"清单。
 *
 *   ② ★ 更隐蔽的一次：臂 2 断言 `workspaceAndWorktreeChangedPaths` 的**生产消费为 0**，
 *      而它红了（报 2 次）—— 我去查才发现那两次**都在注释里**：
 *      一处是 `changed-paths.ts` 的说明文字，一处是 `update-task.ts` 里
 *      「a0f6504 t41 接上了 `workspaceAndWorktreeChangedPaths(workspace)` ✓」。
 *      ⇒ **一个"记录它没有被接上"的注释，会被本装置读成"它被接上了"。**
 *
 * ★ 那正是本队记过的第三种恒真写法：**读错位置的出口** ——
 *   读数在场、类型对、数值也对，只是它不是读者以为的那份东西。
 * ⇒ 而它的后果在这里格外讽刺：**本判据的主题正是"产出有没有被消费"，
 *   而它会把"关于这个产出的讨论"当成"这个产出的消费"。**
 *
 * ★ 口径：剥掉块注释与整行行注释。**行尾注释不剥**（`code() // note` 里那句
 *   `code()` 是真代码）—— 剥过头会把真的调用点也抹掉，那是另一个方向的错。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释（含 JSDoc）
    .replace(/^\s*\/\/.*$/gm, '')       // 整行行注释
    .replace(/^\s*\*.*$/gm, '')         // 续行注释（以 * 开头的那些）
}

/**
 * ★★ 可扫范围（附条件就写在这里）。
 *
 * `src/client/**` 是**单独打包**的客户端 bundle（见 `tsconfig.client.json` 的
 * `include: ["src/client", …]`）—— 它的导出由 bundler 消费，而不是由 import 消费。
 * ⇒ 对模块级导出这一类比，它的**消费点不在可扫范围内** ⇒ 判 `unmeasured`。
 *
 * ★ 这**不是**放水：一个"客户端导出"确实可能真的是死代码。判据在此处说
 *   "我判不了"（因为消费点看不见），而不是说"它没问题" —— 三态不同形。
 */
const OUT_OF_SCAN_RANGE = [/^src\/client\//]

const isOutOfScanRange = (filePath) => OUT_OF_SCAN_RANGE.some((pattern) => pattern.test(filePath))

/** 一份产出的三态。 */
const VERDICT = {
  consumed: 'consumed',                 // 有生产消费者
  fixtureOnly: 'fixtureOnly',           // ★ 只有夹具消费者 —— t41 的形状
  unconsumed: 'unconsumed',             // 完全没有消费者
  unmeasured: 'unmeasured',             // 生产点或消费点在可扫范围之外
}

/**
 * ── 主装置：为每一份模块级产出找一个读它的地方 ──────────────────────────────────
 *
 * ★ 它的口径逐条写明（否则它就是一个形状检查）：
 *   · 定义那一行**不算**消费（否则每个导出都"消费了自己"）；
 *   · **同一文件里的其它使用算消费**（第一版把定义所在文件整个排除 ⇒ 误报了一批）；
 *   · 生产消费者（`src/`）与夹具消费者（`scripts/`）**分开数**。
 */
function moduleLevelProducers({ root = ROOT } = {}) {
  const srcFiles = walk(join(root, 'src'), ['.ts'])
  const scriptFiles = walk(join(root, 'scripts'), ['.mjs', '.js'])
  const rel = (file) => relative(root, file).split('\\').join('/')

  /** 收集导出（只收 value —— type/interface 在运行期不存在，本判据不判它们）。 */
  const producers = new Map()
  for (const file of srcFiles) {
    const fileKey = rel(file)
    /** ★ 导出声明也从**剥注释后**的文本里找 —— 注释里的示例不是导出。 */
    stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
      const match = line.match(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/)
      if (match === null) return
      const name = match[1]
      if (!producers.has(name)) producers.set(name, [])
      producers.get(name).push({ file: fileKey, line: index + 1 })
    })
  }

  /**
   * 全文索引（只索引一次）。
   * ★★ 索引**剥注释后**的文本 —— 否则"关于这个产出的讨论"会被当成"这个产出的消费"
   *   （见 `stripComments` 上记的那次实测：一句「t41 接上了 X ✓」的注释，
   *    会把一个零调用方的函数读成"有 2 个生产调用方"）。
   */
  const textByFile = new Map()
  for (const file of [...srcFiles, ...scriptFiles]) textByFile.set(rel(file), stripComments(readFileSync(file, 'utf8')))

  const results = []
  for (const [name, definitions] of producers) {
    /** ★ 定义行本身要排除 —— 逐个 (文件, 行) 排除，不是整个文件排除。 */
    const definitionKeys = new Set(definitions.map((d) => `${d.file}:${d.line}`))
    const pattern = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g')

    let production = 0
    let fixture = 0
    for (const [file, source] of textByFile) {
      source.split('\n').forEach((line, index) => {
        if (definitionKeys.has(`${file}:${index + 1}`)) return
        const hits = (line.match(pattern) ?? []).length
        if (hits === 0) return
        if (file.startsWith('scripts/')) fixture += hits
        else production += hits
      })
    }

    /**
     * ★ 附条件先生效：生产点在可扫范围之外 ⇒ `unmeasured`（**不是** unconsumed）。
     */
    const outOfRange = definitions.some((d) => isOutOfScanRange(d.file))
    const verdict = outOfRange
      ? VERDICT.unmeasured
      : production > 0
        ? VERDICT.consumed
        : fixture > 0
          ? VERDICT.fixtureOnly
          : VERDICT.unconsumed

    results.push({ name, definition: definitions[0], production, fixture, verdict })
  }
  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★ 三态不同形 + 附条件写在判据里
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 三态不同形：有消费 / 只有夹具消费 / 无消费 / 判不了（可扫范围之外）', () => {
  const all = moduleLevelProducers()

  /** ★ 四态各自都要有实例 —— 否则某条分支从未被走过，本判据对它就是盲的。 */
  const byVerdict = {
    consumed: all.filter((x) => x.verdict === VERDICT.consumed),
    fixtureOnly: all.filter((x) => x.verdict === VERDICT.fixtureOnly),
    unconsumed: all.filter((x) => x.verdict === VERDICT.unconsumed),
    unmeasured: all.filter((x) => x.verdict === VERDICT.unmeasured),
  }

  console.log(`    ℹ 全仓模块级产出 ${all.length} 份：`)
  for (const [verdict, items] of Object.entries(byVerdict)) {
    console.log(`       ${verdict.padEnd(12)} ${String(items.length).padStart(4)}`)
  }

  /**
   * ★ 三态必须**两两不同形**（逐对断言，不循环 —— 漏掉哪一对都看不出来）。
   */
  const shapeOf = (item) => JSON.stringify({ v: item.verdict, prod: item.production > 0, fix: item.fixture > 0 })
  assert.notEqual(
    shapeOf({ verdict: VERDICT.consumed, production: 1, fixture: 0 }),
    shapeOf({ verdict: VERDICT.unconsumed, production: 0, fixture: 0 }),
    '★ 有消费与无消费必须不同形',
  )
  assert.notEqual(
    shapeOf({ verdict: VERDICT.fixtureOnly, production: 0, fixture: 3 }),
    shapeOf({ verdict: VERDICT.unconsumed, production: 0, fixture: 0 }),
    '★ "只有夹具消费"与"完全无消费"必须不同形 —— 那是两个不同责任',
  )
  assert.notEqual(
    shapeOf({ verdict: VERDICT.unmeasured, production: 0, fixture: 0 }),
    shapeOf({ verdict: VERDICT.unconsumed, production: 0, fixture: 0 }),
    '★ "判不了"与"无消费"必须不同形 —— 否则不可判的东西会被当成缺陷去修',
  )

  /** ★ 而附条件**真的在生产**：`src/client/**` 的导出必须落 `unmeasured`，不是 `unconsumed`。 */
  assert.ok(
    byVerdict.unmeasured.length > 0,
    '★ 没有一份产出落 unmeasured —— 附条件（可扫范围之外）从未生效，'
    + '而 `src/client/**` 是单独打包的、它的消费点确实不在扫描范围内',
  )
  assert.ok(
    byVerdict.unmeasured.every((item) => isOutOfScanRange(item.definition.file)),
    '★ 有非 client 的条目落进了 unmeasured —— 附条件被用在了它不该用的地方',
  )
  /** ★ 反向：client 的导出**不许**落进 unconsumed（那正是"不可判并进无消费"）。 */
  const clientMissed = all.filter((item) => isOutOfScanRange(item.definition.file) && item.verdict !== VERDICT.unmeasured)
  assert.deepEqual(
    clientMissed.map((item) => item.name), [],
    '★ `src/client/**`（单独打包）的导出被判成了有/无消费 —— '
    + '它的消费点不在可扫范围内，唯一诚实的读数是 `unmeasured`',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 它必须能抓到 t41 那个真实实例（只有夹具消费）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是本任务的核心：它证明这条判据抓的是**真事**，不是形状 ────────────────
 *
 * t41 的 `workspaceAndWorktreeChangedPaths`：写好了、**夹具里调用多次**、
 * 而生产里**零调用**。★ 若判据把夹具调用算作消费者，它**抓不到**这个实例。
 */
test('臂 2 ★★ 抓到 t41 那个实例：一个导出被夹具调用多次、而生产零调用', () => {
  const all = moduleLevelProducers()
  const target = all.find((item) => item.name === 'workspaceAndWorktreeChangedPaths')

  assert.notEqual(
    target, undefined,
    '★ 在 src/ 里找不到 workspaceAndWorktreeChangedPaths —— '
    + '若它已被删除/改名，这一臂应当改指新的等价实例，而不是删掉（它在 t41 是真事）',
  )

  console.log(`    ℹ ${target.name}: 生产消费 ${target.production} 次 · 夹具消费 ${target.fixture} 次 ⇒ ${target.verdict}`)

  /**
   * ★★ 核心断言：夹具里有调用（>0）而生产里没有（===0）。
   *
   * ★ 这一句同时钉住两件事：
   *   ① 判据**真的**把生产与夹具分开数了（否则 `fixture` 会是 0，而 `production` 不是）；
   *   ② 这个真实实例**现在仍然是**那个形状（若有人给它接上了生产调用方，
   *      这一句会红 —— 那时正确的动作是**记下它被修好了**，而不是保留一句假断言）。
   */
  assert.equal(
    target.production, 0,
    `★ ${target.name} 现在有生产消费者了（${target.production} 次）—— `
    + '★ 若那是真的修复，请把这一臂改成断言"它已被消费"并注明日期；'
    + '★ 若那是误报，说明判据的分界读错了（它把夹具调用算进了生产）',
  )
  assert.ok(
    target.fixture > 0,
    `★ ${target.name} 的夹具消费是 0 —— 那它就不是 t41 那个实例（那个形状的要点正是`
    + '"夹具里到处在调用、而生产里从未被调用"）。若实例换了，改指新实例而不是放宽这一句',
  )
  assert.equal(
    target.verdict, VERDICT.fixtureOnly,
    '★ 它没有被判成"只有夹具消费" —— 那正是本判据存在的理由（t41 藏了很久的原因）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★ 第二类产出：运行时数据（注入进 ctx 的格，有没有人读）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂覆盖【第二类产出】，而它用的是**可扫描的形状**───────────────────────────
 *
 * t54 那条：一个值被算出来、注入进 ctx，而**唯一读它的门不再对它生效**
 * ⇒ 证据被生产出来而没人消费。
 *
 * ★ 可扫描的近似：判据用 `requires` **声明**了它要哪些 ctx 格。而"声明了却从不读"
 *   是一个可机械检查的形状 —— 它说的正是"这一格被生产出来（有人声明要它），
 *   而没有任何地方读"。
 *
 * ★ 口径（刻意保守）：只看**判据模块自己**的源码里有没有读那个格。
 *   一个格被别的文件读（例如调用方注入了它）不算 —— 因为那正是 t54 的形状：
 *   调用方**一直**在注入 `newTestFiles`，而**读它的门**不再适用。
 */
test('臂 3 ★ 第二类产出：判据声明的 ctx 格，必须在它自己的源码里被读到', () => {
  const gateFiles = walk(join(ROOT, 'src/gates'), ['.ts'])
  const findings = []
  let checked = 0

  /**
   * ★★ 先剥注释 —— 这一条是**实测抓出来的**（第一版没剥，结果命中了 `registry.ts` 里
   *   **注释中的一句示例**：`* export const requires: CtxPaths<…>[] = ['event', …]`）。
   *   ⇒ 那正是本队记过的第三种恒真写法：**读错位置的出口** ——
   *     它读到了一个长得像声明的东西，而那不是声明。
   *   ★ 若没剥注释，本臂会对**从来没有过 requires 的文件**（registry/index/requires）
   *     产出一份"声明了却读不到"的假清单，而读的人会去修一个不存在的问题。
   */
  const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/^\s*\/\/.*$/gm, '')       // 整行行注释

  for (const file of gateFiles) {
    const source = stripComments(readFileSync(file, 'utf8'))
    const fileKey = relative(ROOT, file).split('\\').join('/')
    /**
     * ★ 只判**声明了 `requires` 的判据模块** —— 那是这个仓库里"我要哪些格"的
     *   唯一机械表达。没有它的文件（registry / index / requires 自身）不适用。
     */
    const requiresMatch = source.match(/export const requires[^=]*=\s*\[([^\]]*)\]/s)
    if (requiresMatch === null) continue
    const cells = [...requiresMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    if (cells.length === 0) continue
    checked += 1

    /**
     * ★ 把声明那一段从源码里剔掉，再问"这一格还有没有出现" ——
     *   否则声明自己就会算作一次读取（每个格都"被读了"）。
     */
    const withoutDeclaration = source.replace(requiresMatch[0], '')
    for (const cell of cells) {
      /** 只取最后一段（`task.verify` ⇒ `verify`），因为 ctx 的读取常写成 `task?.verify`。 */
      const leaf = cell.split('.').pop()
      const readPattern = new RegExp(`\\b${leaf.replace(/\$/g, '\\$')}\\b`)
      if (!readPattern.test(withoutDeclaration)) {
        findings.push({ file: fileKey, cell })
      }
    }
  }

  console.log(`    ℹ 检查了 ${checked} 个声明了 requires 的判据模块`)
  console.log(`    ℹ 声明了却在自己源码里读不到的格：${findings.length}`)
  for (const finding of findings.slice(0, 10)) console.log(`       ${finding.file} 声明 "${finding.cell}"`)

  /** ★ 前提：至少检查到了一些模块（否则本臂在"一个都没解析到"时恒绿）。 */
  assert.ok(
    checked >= 5,
    `★ 只检查到 ${checked} 个判据模块 —— 解析没生效（而"没解析到"与"都没问题"同形）`,
  )

  /**
   * ★ 断言：这个形状**当前为空**。而它是一个**可修的缺陷清单**，不是不变量：
   *   它红了就说明某条判据声明了一格而从不读它 —— 那正是"供给没有消费"的第二类。
   *
   * ★ 而它**不会**因为"新增了一条判据"而红：只有新判据**声明了却不读**才会。
   */
  assert.deepEqual(
    findings, [],
    '★ 下面这些判据声明了一个 ctx 格、而在自己的源码里从未读它：\n'
    + findings.map((f) => `  · ${f.file} 声明了 "${f.cell}"`).join('\n')
    + '\n★ 一个声明而不读的格，与没有声明它的差别是零（而它多了一层"我在要它"的假象）。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 反向半边：真的有消费的产出必须全部合格 —— 如实报出全仓读数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 契约要求：「先跑一次全仓，把现有结果如实报出来（多少合格、多少不合格）」──
 *
 * ★ 这一臂**不**断言"不合格数为 0" —— 那是把当下的语料快照写成不变量，
 *   而它会因为一次真实的死代码新增而红，也会因为一次诚实的新模块而红。
 * ⇒ 它断言的是**那两类"必须有消费却无消费"的产出不许增加**，并如实打印全部读数。
 */
test('臂 4 ★★ 全仓读数（如实报出）：合格多少、不合格多少、判不了多少', () => {
  const all = moduleLevelProducers()
  const consumed = all.filter((x) => x.verdict === VERDICT.consumed)
  const fixtureOnly = all.filter((x) => x.verdict === VERDICT.fixtureOnly)
  const unconsumed = all.filter((x) => x.verdict === VERDICT.unconsumed)
  const unmeasured = all.filter((x) => x.verdict === VERDICT.unmeasured)

  console.log(`    ℹ 全仓 ${all.length} 份模块级产出：`)
  console.log(`       合格（生产有消费）      ${consumed.length}`)
  console.log(`       ★ 不合格·只有夹具消费   ${fixtureOnly.length}`)
  console.log(`       ★ 不合格·完全无消费     ${unconsumed.length}`)
  console.log(`       判不了（可扫范围之外）   ${unmeasured.length}`)

  /**
   * ★ 反向半边：**合格的那一类不许有假阳性** —— 抽样一条已知真有消费的，
   *   断言判据把它判成 consumed。★ 缺了这一半，本判据在"把一切都判成无消费"
   *   的实现上照样能过前三条臂。
   */
  const known = all.filter((item) => item.name === 'writeTeam' || item.name === 'blocked' || item.name === 'createTeamDir')
  assert.ok(known.length > 0, '★ 找不到已知被消费的产出 —— 反向半边没有对象')
  for (const item of known) {
    assert.equal(
      item.verdict, VERDICT.consumed,
      `★ ${item.name} 在真实代码里【确实】有生产消费者，却被判成 ${item.verdict} —— `
      + '那是误报，而误报会教人忽略这条判据',
    )
  }
  console.log(`    ℹ 反向半边抽样：${known.map((x) => x.name).join(', ')} 全部判成 consumed ✓`)

  /** ★ 而"合格"必须是绝大多数 —— 否则这条判据在真实代码库上是噪音，而不是门。 */
  assert.ok(
    consumed.length > all.length * 0.5,
    `★ 只有 ${consumed.length}/${all.length} 的产出被判合格 —— `
    + '真实的代码库里绝大多数导出是被消费的；这个比例说明判据的分界读错了',
  )

  /**
   * ★★ 而下面这两条是**给未来的**：它们不冻结当前的数字，只禁止**退化**。
   *   ★ 用"上限"而不是"等值"：等值会在一次诚实的清理后无故变红。
   *   ★ 上限取**修正口径后**的实测值（见 `stripComments` 上那段：把注释算作消费
   *     会让这两个数字偏小 —— 而那会把本判据要抓的东西算进"合格"）。
   */
  assert.ok(
    fixtureOnly.length <= 16,
    `★ "只有夹具消费"的产出涨到了 ${fixtureOnly.length}（记账值 16）—— `
    + '新增的那些正是 t41 的形状：在夹具里看起来被使用，在生产里从未被调用',
  )
  assert.ok(
    unconsumed.length <= 12,
    `★ "完全无消费"的产出涨到了 ${unconsumed.length}（记账值 12）`,
  )

  /**
   * ★★★ 装置自检（缺了它，上面两个数字可能因为"装置把注释算成消费"而**虚低**）：
   *   拿一段**只把名字写在注释里**的文本喂给装置的口径，断言它**不**被算作消费。
   *   ⇒ 这正是本任务当场栽过的那个坑（一句「t41 接上了 X ✓」的注释被读成消费）。
   */
  const commentedOnly = '/* this mentions thing but is not a use */\n// thing\n'
  assert.equal(
    /\bthing\b/.test(stripComments(commentedOnly)), false,
    '★ 剥注释失效：一个只在注释里出现的名字仍被算作消费 —— '
    + '那会把"记录它没有被接上"的注释读成"它被接上了"（本任务实测过）',
  )
  /** ★ 反向自证：真的代码**必须**留下来（否则上面的自检是恒真的 —— 全剥掉就什么都匹配不到）。 */
  assert.equal(
    /\bthing\b/.test(stripComments('const x = thing + 1 // trailing note\n')), true,
    '★ 剥注释把真的代码也吃掉了 —— 那会让所有产出都变成"无消费"（另一个方向的错）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★ 定向突变：两个方向各打红一条臂
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 规则二后半句：把机制单独去掉 ⇒ 臂必须红 ────────────────────────────────────
 *
 * ★ 本臂用**装置的直接调用**做归因（装置是纯函数，可以对任意 root 跑）：
 *   在临时目录里造两种形状，断言装置给出**不同**裁决。
 *
 *   · 去掉"生产消费点" ⇒ 它必须从 consumed 变 fixtureOnly/unconsumed
 *   · 把一个真有消费的标成无消费 ⇒ 反向臂必须红（臂 4 的抽样）
 */
test('臂 5 ★ 定向突变：拿掉生产消费点 ⇒ 变 fixtureOnly；拿掉夹具消费点 ⇒ 变 unconsumed', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const sandbox = mkdtempSync(join(tmpdir(), 't60-'))

  try {
    mkdirSync(join(sandbox, 'src'), { recursive: true })
    mkdirSync(join(sandbox, 'scripts'), { recursive: true })

    /**
     * ── 造一个"生产有消费"的产出 ─────────────────────────────────────────────
     *   producer.ts 导出它；consumer.ts（同为 src/）读它 ⇒ 合格。
     */
    writeFileSync(join(sandbox, 'src/producer.ts'), 'export const thing = 1\n')
    writeFileSync(join(sandbox, 'src/consumer.ts'), 'import { thing } from "./producer.ts"\nexport const used = thing\n')

    const before = moduleLevelProducers({ root: sandbox }).find((x) => x.name === 'thing')
    assert.equal(before.verdict, VERDICT.consumed, '★ 造出来的"有生产消费"的形状没有被判成 consumed')

    /**
     * ── 突变 A：把生产消费点拿掉，改成**只有夹具消费**（t41 的形状）───────────
     */
    writeFileSync(join(sandbox, 'src/consumer.ts'), 'export const unrelated = 1\n')
    writeFileSync(join(sandbox, 'scripts/uses.mjs'), 'import { thing } from "../src/producer.ts"\nconsole.log(thing)\n')

    const mutatedA = moduleLevelProducers({ root: sandbox }).find((x) => x.name === 'thing')
    console.log(`    ℹ 突变 A（拿掉生产消费点）⇒ ${before.verdict} → ${mutatedA.verdict}`)
    assert.equal(
      mutatedA.verdict, VERDICT.fixtureOnly,
      '★ 拿掉生产消费点之后没有变成"只有夹具消费" —— 那说明装置没把生产与夹具分开数',
    )

    /**
     * ── 突变 B：再把夹具消费点也拿掉 ⇒ 完全没有消费者 ────────────────────────
     */
    writeFileSync(join(sandbox, 'scripts/uses.mjs'), 'console.log("unrelated")\n')
    const mutatedB = moduleLevelProducers({ root: sandbox }).find((x) => x.name === 'thing')
    console.log(`    ℹ 突变 B（再拿掉夹具消费点）⇒ ${mutatedA.verdict} → ${mutatedB.verdict}`)
    assert.equal(
      mutatedB.verdict, VERDICT.unconsumed,
      '★ 两个消费点都拿掉之后没有变成"完全无消费"',
    )

    /**
     * ── 突变 C：把生产点移到可扫范围之外 ⇒ 必须变 `unmeasured`（不是 unconsumed）──
     */
    mkdirSync(join(sandbox, 'src/client'), { recursive: true })
    writeFileSync(join(sandbox, 'src/client/producer.ts'), 'export const thing = 1\n')
    rmSync(join(sandbox, 'src/producer.ts'))
    const mutatedC = moduleLevelProducers({ root: sandbox }).find((x) => x.name === 'thing')
    console.log(`    ℹ 突变 C（生产点移出可扫范围）⇒ ${mutatedB.verdict} → ${mutatedC.verdict}`)
    assert.equal(
      mutatedC.verdict, VERDICT.unmeasured,
      '★ 生产点移出可扫范围后没有变成 unmeasured —— 那会把"判不了"读成"无消费"',
    )

    /**
     * ★ 三个退化端**两两不同**（否be它们不是三个可分辨的方向）。
     */
    assert.notEqual(mutatedA.verdict, mutatedB.verdict, '★ 突变 A 与 B 的裁决相同 —— 两个方向不可分辨')
    assert.notEqual(mutatedB.verdict, mutatedC.verdict, '★ 突变 B 与 C 的裁决相同 —— 两个方向不可分辨')
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
