#!/usr/bin/env node
/**
 * ── 经验 = 同一个坑被踩出来的次数（C3）────────────────────────────────────────
 *
 * ★ 用户的原话（本文件存在的全部理由，逐字）：
 *
 *   > 「关于经验，其实要么是不断踩坑的地方，要么是执行过程中得到的有价值的东西。」
 *
 *   ⇒ **经验 = 同一个坑被踩出来的次数。**
 *
 * ★★ 它【不改采集，只改聚合】—— 这是本任务的第一条纪律 ──────────────────────────
 *
 * 卡点是怎么记下来的、记成什么形状，本文件**一个字都不碰**。它只读
 * `.agent-teams/frictions/*.json`（记录的**唯一真源**），数出"同一个坑出现了几次"。
 *
 * ⇒ 判据：把本文件删掉，**没有任何一条记录会变**。
 *   （夹具里有这条臂：跑前跑后逐字节比对台账目录。）
 *
 * ── 为什么"计数"这件事值得单独一个脚本（而不是写进判据）──────────────────────
 *
 * 本仓库记过的那条归纳正对着它：
 *
 *   > **「一个没有调用方的判断，与没有判断在观测上完全相同。」**
 *
 * 踩坑记录早就有了（`recordFriction`），读它的分诊器也有了（`friction-triage.mjs`）。
 * 缺的是**把它们数起来的那个动作** —— 而"数次数"这件事**零 token、纯机械**，
 * 它不该等任何人（人或模型）想起来去做。
 *
 * ── ★★★ 三态：够次数 / 次数不够 / **判断不了** ─────────────────────────────────
 *
 *     `should-be-a-gate` —— 同一个坑 ≥ N 次 ⇒ 报「这该是判据了」（附那 N 次的原话）
 *     `below-threshold`  —— 只踩到 < N 次 ⇒ **不报**（★ 见下面那条控制臂）
 *     `cannot-tell`      —— ★ **读不出它属于哪个坑** ⇒ 既不算"够"也不算"不够"
 *
 * ★★ 第三态**不许**并进另外两个，两个方向都错：
 *   · 并进 `below-threshold` ⇒ **"我没能分类"被读成"这个坑只踩了一次"** ——
 *     于是最该被看见的那些（连 id 都读不出来的记录）恰恰被藏起来。
 *   · 并进 `should-be-a-gate` ⇒ 每一条读不出 id 的记录都变成一条"该建判据"的提案
 *     —— 而那正是本队已经修过一次的缺陷（207 条判据拒绝日志被算成卡点）。
 *
 * ── ★★ 控制臂（契约硬要求，也是本文件最容易被写坏的地方）────────────────────────
 *
 * **只踩一次 ⇒ 不报。**
 *
 * ★ 为什么它不是"顺手加的一条断言"：一个"凡出现就报"的实现会让**所有**正向臂
 *   全绿 —— 它报得比正确实现还多。⇒ 唯一能把"真的在计数"与"它什么都报"分开的，
 *   就是喂它一个**只出现一次**的坑，并要求它**闭嘴**。
 *   （本仓库记过的一般形式：「正向臂只喂『该被拒』的输入，所以它测不出『一律拒绝』」。）
 *
 * ── ★ 用法 ────────────────────────────────────────────────────────────────────
 *
 *     node scripts/experience-rollup.mjs [台账目录] [--threshold N] [--json]
 *
 * ★ 台账目录与 N **都从参数来**（与 `friction-triage.mjs` 同一条纪律）——
 *   写死路径会让夹具只能测生产那一个目录，而写死 N 会让"上限是硬编码常量、
 *   短测试复现不了"那族缺陷再躲一次（本仓已记过三次）。
 *
 * @module experience-rollup
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根（默认台账目录就从它推）。 */
export const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * ── ★ 阈值 N：默认 2，**可注入** ────────────────────────────────────────────────
 *
 * ★ N = 2 的理由（用户已确认，`docs/PENDING-FRICTION-REFORM.md` §2 逐字）：
 *   「1 次是正常的『填错了改一下』；**2 次说明它在同一个地方卡住了**。」
 *
 * ★★ 而它**必须可注入**，理由是本仓的教训（同一份文档 §2 记的）：
 *   「`with-timeout` 那族缺陷连躲三次，根因都是**上限是硬编码常量，短测试复现不了**。」
 *   ⇒ 一条只能靠"真的踩两次"来测的判据，在短夹具里永远测不到它的边界。
 */
export const DEFAULT_THRESHOLD = 2

/**
 * ── ★★★ 「同一个坑」是什么 —— 这是本文件唯一需要判断的地方，所以它必须是显式的 ────
 *
 * 一条记录里有三个候选的"身份"来源，而它们**回答的不是同一个问题**：
 *
 *   `index.component` —— ★ **判据位置**（`dispatch.changed-paths` 那一类）。
 *                        这是"**哪条门**拦的"。实测台账里 185/364 条**没有**它
 *                        （它们是人工记的观察，不是判据拒的）。
 *   `index.kind`      —— 分类标签（`unwired` / `misclassified` / …，实测 331 条是
 *                        `['unwired']`）。★ 它**几乎人人都一样** ⇒ 用它当键会把
 *                        整个台账数成一个坑，而那正好是"一律报告"那个坏法。
 *   `title` 里的 `[gate.id]` —— 判据自己报出来的 id。
 *
 * ★ 选 `index.component`：它是**声明式的、判据自己写的**那一格，且实测分布有分辨力
 *   （`dispatch.changed-paths` 57 次、`completion.backtest` 50 次……）。
 *   ★ 而 `title` 里的 id 只在**拒绝路径**上有（185/364 条没有）⇒ 用它当主键会让
 *     大多数记录落进"判断不了"，那不是保守，那是没接线。
 *
 * ⇒ 于是"读不出它属于哪个坑"**不是**一个可以事后补的字段，而是本函数如实交出的
 *   第三种结果（`cannot-tell`）。
 */
export function pitKeyOf(record) {
  /**
   * ── ★★★ 第一优先：`title` 里的判据 id（`[dispatch.changed-paths]` 那一类）─────────
   *
   * MEASURED（对真台账 364 条实测，本任务）：
   *   · `index.component` 在 329/364 条上是**位置**（`dispatch` 158 / `completion` 157 /
   *     `contract` 14），只在剩下 35 条上才是**具体判据**。
   *   · 而 `title` 里的判据 id 把那些位置**进一步区分开**：`dispatch.changed-paths` 57 次、
   *     `completion.backtest` 50 次、`completion.mutation` 23 次……
   *
   * ★★ 为什么这个区分是必需的（它决定本脚本是"有用"还是"误导"）：
   *   按位置归类会把 **158 条互不相干的拒绝**合成一个"坑" ⇒ 报出「dispatch 踩了 158 次」。
   *   而那不是"同一个坑被踩了 158 次"，是"**这个位置上有 158 次拒绝，分属好几条判据**"。
   *   ⇒ 提案会把一件分散的事说成一件集中的事 —— 而这正是本队反复记账的那条:
   *     **把 N 件不同的事数成一个数字，于是"每次都被不同的门拦"读成"卡在同一处"**。
   *     （★ 与 C1 的 `observeStall` 拒绝把不同 gate 合成一个计数是**同一条纪律**。）
   *
   * ★ 而它**不是**一个可以无条件用的键：只有**拒绝路径**写下的记录才带那个 id
   *   （实测 150/329 条没有它）。⇒ 读不出来时退回 `index.component`，退回不了才
   *   落 `cannot-tell`。三态各自如实。
   */
  const fromTitle = gateIdFromTitle(record?.title)
  if (fromTitle !== undefined) return { key: fromTitle, how: 'title gate id' }
  const component = record?.index?.component
  if (typeof component === 'string' && component.trim() !== '') {
    return { key: component.trim(), how: 'index.component' }
  }
  return { key: undefined, how: undefined }
}

/**
 * 从 `title` 里读出判据 id。
 *
 * ★ 形态与 `gateIdFromMessage`（`src/tools/shared/entities.ts`）**同一套措辞**：
 *   拒绝原文里判据 id 写作 `[… ]`（实测 `update_task rejected: [dispatch.changed-paths] "…"`）。
 *
 * ★ 读不出来 ⇒ `undefined`（**不猜**）。编一个 id 会让"这个坑踩了几次"变成一条**假事实**，
 *   而假的计数比没有计数坏：读者会照着它去建判据。
 */
export function gateIdFromTitle(title) {
  if (typeof title !== 'string') return undefined
  const matched = /\[([\w][\w.-]*)\]/u.exec(title)
  const id = matched?.[1]
  return id === undefined || id.trim() === '' ? undefined : id
}

/**
 * 一条记录的**原话**（提案里要附的那一段）。
 *
 * ★ 取 `title` 与判据当时说的那一句（`observed.verdict.note`）**两份**：
 *   `title` 是记账时写下的摘要，`verdict.note` 是判据的原话 —— 而后者可能缺席。
 *   ★ 拿不到就**如实说拿不到**，绝不编一句（"编一条原话"比"没有原话"坏：
 *     读者会照着它去查）。
 */
export function verbatimOf(record) {
  const title = typeof record?.title === 'string' ? record.title : undefined
  const note = record?.observed?.verdict?.note
  const unmeasured = record?.observed?.verdict?.unmeasured
  const spoken = typeof note === 'string' && note.trim() !== ''
    ? note
    : typeof unmeasured === 'string' && unmeasured.trim() !== ''
      ? unmeasured
      : undefined
  return { title, spoken }
}

/**
 * 读一个台账目录。
 *
 * ★★ 三态（与 `frictions-html.mjs` 同一条纪律）：
 *   · 目录在、都读得出来 ⇒ `records`
 *   · 目录在、有几条坏了 ⇒ `records` + `broken`（**降级**，不是"没有"）
 *   · 目录不在           ⇒ `absent: true` —— ★ **不是**"读了，是空的"
 *
 * ★ 为什么"目录不在"必须与"目录是空的"不同形：前者在干净 checkout 里是**正常**的
 *   （台账按项目分），后者是"这个项目真的零踩坑"。把两者合流会让第一次跑的人
 *   以为经验被算过了。
 */
export function loadLedger(dir) {
  if (!existsSync(dir)) return { records: [], broken: [], absent: true }
  const records = []
  const broken = []
  for (const name of readdirSync(dir).filter((f) => /^f-\d+\.json$/.test(f)).sort()) {
    try {
      records.push(JSON.parse(readFileSync(join(dir, name), 'utf8')))
    } catch (error) {
      broken.push({ file: name, why: String(error?.message ?? error) })
    }
  }
  return { records, broken, absent: false }
}

/**
 * ── ★★★ 聚合：把记录数成「同一个坑踩了几次」────────────────────────────────────
 *
 * 返回**三态各自单独一格**，而不是一个混合的列表 —— 因为它们的补救动作不同：
 *
 *     `shouldBeGates` —— 该派人去把它做成判据（附原话）
 *     `belowThreshold`—— 次数不够，**不需要做任何事**
 *     `cannotTell`    —— ★ **去把那一格接上**（它是接线缺陷，不是"次数不够"）
 */
export function rollup(records, threshold = DEFAULT_THRESHOLD) {
  const groups = new Map()
  const cannotTell = []

  for (const record of records) {
    const { key, how } = pitKeyOf(record)
    if (key === undefined) {
      cannotTell.push({
        id: typeof record?.id === 'string' ? record.id : '(no id)',
        at: typeof record?.at === 'string' ? record.at : undefined,
        verbatim: verbatimOf(record),
        why: 'this record does not say which gate/position it belongs to (index.component is absent), so how often THIS pit was hit could not be counted',
      })
      continue
    }
    const group = groups.get(key) ?? { key, how, occurrences: [] }
    group.occurrences.push({
      id: typeof record?.id === 'string' ? record.id : '(no id)',
      at: typeof record?.at === 'string' ? record.at : undefined,
      verbatim: verbatimOf(record),
    })
    groups.set(key, group)
  }

  const all = [...groups.values()].map((group) => ({ ...group, count: group.occurrences.length }))
  /**
   * ★ 排序：先按次数（多 ⇒ 更该被做成判据），再按名字。
   *   ★ 加 `key` 这个次键是为了让**同一组输入永远给出同一份输出** ——
   *     不然两次运行的顺序可能不同，而"顺序不同"会被读成"内容不同"（重放不成立）。
   */
  const byCount = (a, b) => b.count - a.count || a.key.localeCompare(b.key)
  return {
    threshold,
    shouldBeGates: all.filter((group) => group.count >= threshold).sort(byCount),
    belowThreshold: all.filter((group) => group.count < threshold).sort(byCount),
    cannotTell,
    countedRecords: records.length - cannotTell.length,
    totalRecords: records.length,
  }
}

/**
 * ── 给人读的那一份 ──────────────────────────────────────────────────────────────
 *
 * ★★ 「匹配不到东西」与「跑坏了」必须**不同形**（契约硬要求）——
 *   一个在空匹配上只打印"0 条"的脚本，与一个坏掉的脚本，在输出上同形。
 *   ⇒ 三种零结果各自有一句**完全不同**的话（见下面的三个分支）。
 */
export function render(report, { ledgerDir, absent, broken }) {
  const lines = []
  lines.push('── 经验聚合（C3）：同一个坑被踩出来的次数 ──')
  lines.push(`台账：${ledgerDir}`)
  lines.push(`阈值 N = ${report.threshold}（同一个坑出现 ≥ N 次 ⇒ 该是判据了）`)
  lines.push('')

  /**
   * ★ 三种"没有提案"，各自一句话 —— 这是本脚本诚实性的落点：
   *   ① 台账目录**不在** —— 正常情形（干净 checkout），不是"零经验"
   *   ② 台账在、**读不出任何可归类的记录** —— 接线缺陷（该去接 index.component）
   *   ③ 台账在、有记录、但**没有一个坑够次数** —— 真的不需要行动
   */
  if (absent) {
    lines.push('★ 台账目录不存在 —— 这不是"没有经验"，而是"这台机器上没有台账"。')
    lines.push('  （台账是按项目分的，一个干净 checkout 里没有它是正常的。）')
    lines.push('⇒ 未能测量：既不能说"有值得建判据的坑"，也不能说"没有"。')
    return lines.join('\n')
  }

  if (report.shouldBeGates.length === 0) {
    if (report.countedRecords === 0 && report.totalRecords > 0) {
      lines.push(`★ 读了 ${report.totalRecords} 条记录，而**没有一条**说得出它属于哪个坑`
        + `（\`index.component\` 全部缺席）。`)
      lines.push('⇒ 这是**接线缺陷**，不是"坑不够多"：聚合根本没能开始。')
      lines.push('  ★ 它与"看了、发现一个坑都没踩两次"不同形 —— 后者是结论，这是没能测量。')
    } else if (report.totalRecords === 0) {
      lines.push('台账目录在，而里面**一条记录都没有** ⇒ 这个项目还没有任何踩坑记录。')
      lines.push('⇒ 这是"看了、是空的"，不是"我没能看"。')
    } else {
      lines.push(`读了 ${report.totalRecords} 条记录，归到 ${report.countedRecords} 条`
        + `（${report.belowThreshold.length} 个坑，每个都不足 ${report.threshold} 次）。`)
      lines.push('★ 结论：**没有任何一个坑够次数** —— 不需要派人做判据。')
      lines.push('  （★ 这与"匹配不到东西"不同形：这里真的数过了，而结论是"不够"。）')
    }
    lines.push('')
  } else {
    lines.push(`★ 有 ${report.shouldBeGates.length} 个坑够次数了 —— 它们该变成判据：`)
    lines.push('')
    for (const group of report.shouldBeGates) {
      lines.push(`■ ${group.key} —— 踩了 ${group.count} 次（按 ${group.how} 归类）`)
      /**
       * ── ★★ 归类依据**不够具体**时必须当场说出来（本任务对真台账实测出来的）───────
       *
       * MEASURED：真台账里 88 条 `dispatch` 与 62 条 `completion` 的 title 形如
       * `update_task rejected: `（那条旧路径把判据 id 抹成了空）⇒ 它们的**具体判据
       * 读不出来**，只能退到位置。
       *
       * ★ 为什么必须在**输出里**说：否则读的人分不出
       *     「同一个坑踩了 88 次」 与 「88 次拒绝，而具体是哪条判据读不出来」。
       *   前者会让人去建一条覆盖 88 次的判据；后者才知道该先去补那一格。
       *   ★ 这正是本队那条纪律的又一次落点：**一个计数必须连同它的测量装置一起读。**
       */
      if (group.how === 'index.component') {
        lines.push(`  ⚠ 这一格是【位置】，不是具体判据 —— 上面这些记录里那条判据的名字读不出来`
          + `（旧路径把它们写成了 \`update_task rejected: \`）。`)
        lines.push(`    ⇒ 它们是 ${group.count} 次**同位置**的拒绝，未必是同一个坑；要判得更细，得先让记录带上判据 id。`)
      }
      for (const occurrence of group.occurrences) {
        const said = occurrence.verbatim.spoken ?? occurrence.verbatim.title
        lines.push(`    · ${occurrence.id}${occurrence.at === undefined ? '' : ` @ ${occurrence.at}`}`)
        lines.push(`      原话：${said === undefined ? '(这条记录没有留下原话)' : String(said).slice(0, 300)}`)
      }
      lines.push('')
    }
  }

  /** ★ 第三态**永远单独列**，绝不被折进上面任何一个计数。 */
  lines.push(`── 判断不了（${report.cannotTell.length} 条）—— ★ 它既不算够、也不算不够 ──`)
  if (report.cannotTell.length === 0) {
    lines.push('（没有：每一条记录都说得出它属于哪个坑。）')
  } else {
    lines.push('这些记录没有 `index.component`，所以"这个坑踩了几次"无从数起：')
    for (const entry of report.cannotTell.slice(0, 20)) {
      lines.push(`    · ${entry.id}${entry.at === undefined ? '' : ` @ ${entry.at}`}`)
    }
    if (report.cannotTell.length > 20) lines.push(`    … 另有 ${report.cannotTell.length - 20} 条`)
  }

  if (broken.length > 0) {
    lines.push('')
    lines.push(`── ★ 读不出来的（${broken.length} 条）：它们没有被计入上面任何一格 ──`)
    for (const entry of broken) lines.push(`    · ${entry.file}：${entry.why}`)
  }
  return lines.join('\n')
}

/** 解析命令行：目录 + `--threshold N` + `--json`。坏值**不加界**（回落缺省），不抛错。 */
export function parseArgs(argv) {
  let dir = join(ROOT, '.agent-teams', 'frictions')
  let threshold = DEFAULT_THRESHOLD
  let json = false
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--threshold') {
      const raw = argv[i + 1]
      i += 1
      const parsed = Number(raw)
      /**
       * ★ 坏值 ⇒ **回落缺省**，不是 0、不是抛错。与 liveness 的 `resolveIntervalMs`
       *   同一条纪律：一个因为参数没写对就炸的脚本，会在第一次出问题时被绕过。
       *   ★ 而回落**不是静默**：调用方从输出里的 `N = 2` 能看出它吃了缺省。
       */
      threshold = Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_THRESHOLD
      continue
    }
    if (argv[i] === '--json') { json = true; continue }
    if (!argv[i].startsWith('--')) positional.push(argv[i])
  }
  if (positional.length > 0) dir = positional[0]
  return { dir, threshold, json }
}

function main() {
  const { dir, threshold, json } = parseArgs(process.argv.slice(2))
  const { records, broken, absent } = loadLedger(dir)
  const report = rollup(records, threshold)
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ledgerDir: dir, absent, threshold: report.threshold,
      shouldBeGates: report.shouldBeGates, belowThreshold: report.belowThreshold,
      cannotTell: report.cannotTell, countedRecords: report.countedRecords,
      totalRecords: report.totalRecords, broken,
    }, null, 2)}\n`)
    return
  }
  process.stdout.write(`${render(report, { ledgerDir: dir, absent, broken })}\n`)
}

/**
 * ★ 只有**被直接执行**时才跑 `main()`（被 import 时只交出函数）。
 *   ⇒ 夹具能直接测 `rollup` / `pitKeyOf` / `loadLedger`，而"跑一次脚本"仍是一条臂。
 */
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) main()
