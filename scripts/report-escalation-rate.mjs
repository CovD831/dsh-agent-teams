#!/usr/bin/env node
/**
 * ── R4 基线读数器：**同类卡点的重复上报次数**（t64）─────────────────────────────────
 *
 * ── 它回答什么 ────────────────────────────────────────────────────────────────
 *
 * 用户第 6 点：「通过上报解决过的卡点，**让同类以后不用再上报**」。
 * ★ 而 t43 的补审判定 R4 **目前不可判**：「无基线、无度量、无对照臂 ⇒ 是**愿望**」。
 * ⇒ 本文件造的就是那份**基线** —— **今天**同类卡点被重复上报了多少次。
 *
 * ★★ 注意它**不是** R4 的验收：R4 的验收是「**这个数下降**」，而本文件只给出**这个数**。
 *   两者必须**不同形**（见 `docs/R4-SELF-EVOLUTION.md` §0）。
 *
 * ── ★ 三态（本仓最久的纪律，也是本文件的第一约束）────────────────────────────────
 *
 *     number      —— 数出来了（附**分母**与**口径**）
 *     no-data     —— **真的没有**（语料目录不存在 / 一条记录都没有）
 *     unreadable  —— **读不出来**（文件在，但解析不了）
 *
 * ★ 三者**不许合并**：`0` 与"读不出"与"没有语料"在报告里必须**三种形状**。
 *   ★ 尤其：**坏文件不许静默丢**（`try{JSON.parse}catch{}` 会把"坏了"读成"不在" ——
 *     t47 那次 12 个「合法 JSON 头 + 垃圾尾」就是这么消失的）。
 *   ⇒ 本文件**逐条报出**坏文件的名字与失败原因。
 *
 * ── ★★ 为什么不用 `grep` 计数（t60 的教训）──────────────────────────────────────
 *
 * t60 实测：`grep -l '"gates"'` 命中 348 个文件，而**逐条解析**后 `auto.gates`
 * 是 **0** —— 那些命中是 **`observed.gates`**（另一个字段）。
 * ⇒ 凡"数一数语料里有几条 X"，**必须逐条解析 JSON**，不许用文本检索。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────
 *
 *   node scripts/report-escalation-rate.mjs [--dir <语料目录>] [--json] [--top N]
 *
 *   缺省语料目录：`.agent-teams/frictions`（相对仓库根）
 *   退出码：0 = 数出来了 ｜ 2 = **测不了**（no-data 或 unreadable > 0 且无可解析记录）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * ── 口径：什么算「同一条卡点」─────────────────────────────────────────────────
 *
 * ★★ **这是本文件最重要的一个决定，而它必须可核、且不许挑一个让数字好看的。**
 *
 * 候选（全部**如实并列报出**，不合并 —— 契约硬纪律「不许为了让数字好看而合并口径」）：
 *
 *     'exact'   —— `title` 逐字相同
 *     'hex'     —— 逐字相同，但把 ≥7 位十六进制串折成 `<hash>`
 *     'hex-path'—— 再进一步，把双引号里的内容折成 `<path>`
 *
 * **为什么需要后两种**：实测 4 条「重复 title」里嵌了 **commit 哈希**
 * （`…the baseline (634575063e638a…)…`）⇒ 逐字口径会把**同一件事**读成**不同的两件**。
 * ★ 而**折多少**是一个**口径选择**，不是一个事实 ⇒ 所以三种**全报**，
 *   并由读的人判断；本文件的"头条数字"取**最保守**的那个（`exact`，重复数最小）。
 */
const NORMS = {
  exact: (title) => String(title),
  hex: (title) => String(title).replace(/\b[0-9a-f]{7,}\b/gu, '<hash>'),
  'hex-path': (title) => String(title)
    .replace(/\b[0-9a-f]{7,}\b/gu, '<hash>')
    .replace(/"[^"]*"/gu, '"<path>"'),
}

/**
 * 逐条读语料 —— ★ **三态**，且坏文件**逐个报出**。
 *
 * ★ 解析失败时**不 `continue` 掉**：收集进 `unreadable`，并带上**失败原因**。
 *   一个"合法的 JSON 头 + 垃圾尾"会在这里留下名字，而不是消失。
 */
export function readCorpus(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (error) {
    /** ★ 目录不存在 ⇒ **no-data**（真的没有），不是 unreadable。 */
    return { state: 'no-data', why: `the corpus directory does not exist: ${dir}`, records: [], unreadable: [] }
  }
  const files = entries.filter((name) => /^f-\d+\.json$/u.test(name)).sort()
  if (files.length === 0) {
    return { state: 'no-data', why: `no f-*.json in ${dir}`, records: [], unreadable: [] }
  }
  const records = []
  const unreadable = []
  for (const name of files) {
    const raw = readFileSync(join(dir, name), 'utf8')
    try {
      records.push({ ...JSON.parse(raw), _file: name })
    } catch (error) {
      /**
       * ★ 记下**为什么**读不出，而不只是"读不出"：
       *   本仓那 12 个坏文件的形状是「**合法的 JSON 头 + 垃圾尾**」，
       *   而 `JSON.parse` 的报错位置**正指着**那个尾巴 —— 它是可核的证据。
       */
      const message = String(error?.message ?? error)
      const at = /position (\d+)/u.exec(message)?.[1]
      unreadable.push({
        file: name,
        why: message.split('\n')[0],
        bytes: statSync(join(dir, name)).size,
        ...(at === undefined ? {} : { headParsesTo: Number(at) }),
      })
    }
  }
  return {
    state: records.length > 0 ? 'number' : 'unreadable',
    why: records.length > 0
      ? undefined
      : `every one of the ${files.length} files failed to parse`,
    records,
    unreadable,
  }
}

/**
 * 基线本体：按口径分组，报出**重复上报**的分布。
 *
 * @returns 每个口径一份：`distinct`（不同卡点类型数）、`repeated`（重复过的类型数）、
 *   `recordsInRepeated`（落在重复类型里的记录数）、`maxRepeat`、`top[]`。
 *
 * ★ **分母写死在返回值里**（`total`）：一个"重复次数"没有分母是不可读的。
 */
export function repetitionBaseline(records) {
  const out = {}
  for (const [name, normalise] of Object.entries(NORMS)) {
    const groups = new Map()
    for (const record of records) {
      const key = normalise(record.title ?? '(no title)')
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    const all = [...groups.entries()]
    const repeated = all.filter(([, count]) => count > 1)
    out[name] = {
      total: records.length,
      distinct: all.length,
      repeated: repeated.length,
      /** ★ 落在"重复过的类型"里的记录数 —— 这些就是"本可以只报一次"的那些。 */
      recordsInRepeated: repeated.reduce((sum, [, count]) => sum + count, 0),
      /** ★ 可省的上报次数 = 每个重复组只留 1 次。 */
      avoidable: repeated.reduce((sum, [, count]) => sum + (count - 1), 0),
      maxRepeat: all.reduce((max, [, count]) => Math.max(max, count), 0),
      top: repeated.sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([key, count]) => ({ count, key: key.slice(0, 120) })),
    }
  }
  return out
}

function main(args) {
  const dirArg = args.indexOf('--dir')
  const dir = dirArg === -1 ? join(ROOT, '.agent-teams', 'frictions') : args[dirArg + 1]
  const topN = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 10
  const corpus = readCorpus(dir)

  /**
   * ★★ 三态**先分流**，且各自有**自己的**退出码与措辞 ——
   *   `no-data` 与 `unreadable` 的补救动作相反（一个去攒语料，一个去修文件）。
   */
  if (corpus.state !== 'number') {
    const payload = {
      state: corpus.state,
      why: corpus.why,
      dir,
      unreadable: corpus.unreadable,
    }
    process.stdout.write(args.includes('--json')
      ? `${JSON.stringify(payload, null, 2)}\n`
      : `[r4] CANNOT MEASURE (${corpus.state}): ${corpus.why}\n`
        + `${corpus.unreadable.length} unreadable file(s)\n`)
    return 2
  }

  const baseline = repetitionBaseline(corpus.records)
  const payload = {
    state: 'number',
    dir,
    files: corpus.records.length + corpus.unreadable.length,
    parsed: corpus.records.length,
    unreadableCount: corpus.unreadable.length,
    unreadable: corpus.unreadable,
    baseline,
  }

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return 0
  }

  const lines = []
  lines.push(`[r4] corpus: ${dir}`)
  lines.push(`  files            : ${payload.files}`)
  lines.push(`  parsed           : ${payload.parsed}`)
  /**
   * ★★ 坏文件**逐个报出**（不是一句"有一些读不出"）—— 名字 + 原因 + 大小。
   *   没有这一段，12 个坏文件会与"不存在"同形（t47 的教训）。
   */
  lines.push(`  unreadable       : ${corpus.unreadable.length}`
    + `${corpus.unreadable.length === 0 ? '' : '  ← ★ 不许静默丢，逐个列出：'}`)
  for (const item of corpus.unreadable) {
    lines.push(`      ${item.file}  (${item.bytes}B)  ${item.why}`)
  }
  lines.push('')
  lines.push('★ 基线＝今天同类卡点的重复上报分布（三种口径并列，**不合并**）：')
  for (const [name, stats] of Object.entries(baseline)) {
    lines.push(`  [${name}]`)
    lines.push(`    records            : ${stats.total}`)
    lines.push(`    distinct frictions : ${stats.distinct}`)
    lines.push(`    repeated types     : ${stats.repeated}`)
    lines.push(`    records in repeats : ${stats.recordsInRepeated}`
      + `  (${((stats.recordsInRepeated / stats.total) * 100).toFixed(1)}%)`)
    lines.push(`    ★ avoidable reports: ${stats.avoidable}`
      + `   ← 每个重复组只报 1 次本可省下的次数`)
    lines.push(`    max repeat         : ${stats.maxRepeat}`)
    for (const item of stats.top.slice(0, topN)) {
      lines.push(`      ${String(item.count).padStart(4)}×  ${item.key}`)
    }
    lines.push('')
  }
  lines.push('★ 这不是 R4 的验收 —— R4 要求【这个数下降】，而本文件只给出【这个数】。')
  process.stdout.write(`${lines.join('\n')}\n`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2))
}
