#!/usr/bin/env node
/**
 * ── 自进化链路的【改前读数】—— N0 ────────────────────────────────────────────────
 *
 * ★★★ 为什么这个脚本存在（而不是让每个人 `node -e` 敲一遍）：
 *
 *   `docs/REQUIREMENTS.md` §7 硬门槛② 逐字：「**改前读数必须在改产品之前就采到
 *   ⇒ 先写读数脚本，再改产品**」。而"采到"这个动作**重复了 12 次**（每次任务
 *   都重新敲一遍 `node -e`）⇒ 于是同一个数在不同任务里被读成 39 / 44 / 45 三个值，
 *   而**三个都像对的** —— 因为它们是同一份文件在三个时刻的样子。
 *
 *   ⇒ 本脚本把每一组读数固定成【一条可复跑的命令 + 它的读数 + 它的裁决】。
 *     第三格是重点：**只有数字的读数是不可判的读数**。
 *
 * ── ★★★ 三态纪律（本仓记账最久的形态：把"没测到"并进"通过"）────────────────────
 *
 *   每一条读数都必须带 `confirmed` / `refuted` / `unmeasured` 三者之一：
 *
 *     confirmed   —— 读到了，且与【写死的期望】相符
 *     refuted     —— 读到了，但与期望不符（★ 这不是错误，是一条信息：口径变了 / 基线过期）
 *     unmeasured  —— 读不到（文件缺席、解析不出、或"没有对象可测"）
 *
 *   ★ 一条只打印 `45` 的读数，与"文件读不出来 ⇒ 打印 0"在屏幕上是同形的。
 *     本脚本**不允许**这种同形：`unmeasured` 永远不是 0。
 *
 * ── ★★★ `directions` 一节（计划 §7.2 的"深挖入口"）────────────────────────────────
 *
 *   `frictions/index.component` 是**按机制位置**打的标签，而这张表就是
 *   "方向 → 真实缺陷密度"的原始语料。用途逐字：
 *
 *     用户给出两个方向 → 跑一次本脚本 → 当场看到这两个方向今天各有几个真实缺陷、
 *     几条信号、判据跑没跑 → 再决定先深挖哪一条。
 *
 * ── 硬约束（计划 §N0 ④）──────────────────────────────────────────────────────────
 *
 *   · 对 `lib/` **零 import**（只用 node 标准库）
 *   · **不写任何文件** —— 脚本末尾有一节 `self-check`，它**自己核对**这件事：
 *     把每个输入文件的 (size, mtimeMs) 在开头读一次、结尾再读一次，不同 ⇒ refuted
 *   · 不依赖 `lib/` 是否构建过（它读的是 `.agent-teams/` 下的数据，不是产物）
 *
 * Run:
 *   node scripts/evolution-readout.mjs
 *   node scripts/evolution-readout.mjs --json
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────
// 0. 根目录：向上查找（位置无关），不用 `..` 数层数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 为什么向上查找而不是 `join(here, '..')`：本仓的 `scripts/gate-path-depth.test.mjs`
 *   把"写死层数"判成 `depth-bound` —— 同一个文件住在 `<root>/scripts/`
 *   （主树）还是 `<root>/.agent-teams/worktrees/<id>/scripts/`（worktree）时，
 *   写死层数的常量在其中一棵里对、另一棵里错。本脚本要在两棵树里都能跑。
 */
function findRepoRoot(start) {
  let dir = start
  for (let step = 0; step < 8; step += 1) {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return undefined
    }
    if (entries.includes('package.json') && entries.includes('scripts')) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)))

// ─────────────────────────────────────────────────────────────────────────────
// 1. 常量：被测文件的落点（全部相对仓库根，**不猜绝对路径**）
// ─────────────────────────────────────────────────────────────────────────────

const FILES = {
  signals: join('.agent-teams', 'evolution', 'signals.jsonl'),
  evolutionIndex: join('.agent-teams', 'evolution', 'index.json'),
  proposals: join('.agent-teams', 'evolution', 'proposals.jsonl'),
  history: join('.agent-teams', 'evolution', 'history.jsonl'),
  hmr: join('.agent-teams', 'hmr-reloads.jsonl'),
  frictions: join('.agent-teams', 'frictions'),
}

/**
 * ★ 冷却窗宽度 —— 与 `src/gates/collection/shared.ts:108` 的 `COOLDOWN_MS`
 *   **逐字相同**（同一个数写两处是缺陷形状，所以这里写明它是**抄来的读数口径**，
 *   而不是本地策略：改判据必须同步改这里，否则 `wouldBlock` 会静默算错）。
 */
const COOLDOWN_MS = 5 * 60 * 1000

/**
 * ★ `src/hmr-trace.ts:114` 的 `HMR_TRACE_LIMIT = 50`（`:199` 处 `slice` 淘汰）。
 *   痕迹文件满了 ⇒ "50 条" 不是 "一共重载过 50 次"，而是 "最近 50 次"。
 *   ⇒ 这个上限必须被打印出来，否则读数会被人当成历史总数。
 */
const HMR_TRACE_LIMIT = 50

// ─────────────────────────────────────────────────────────────────────────────
// 2. 三态裁决装置
// ─────────────────────────────────────────────────────────────────────────────

const VERDICT = {
  confirmed: 'confirmed',
  refuted: 'refuted',
  unmeasured: 'unmeasured',
}

/**
 * ── 一条读数 ──────────────────────────────────────────────────────────────────
 *
 * 三个字段缺一不可（契约逐字：**可复跑的命令 + 它的读数**）：
 *   `command` —— 能在仓库根直接粘贴执行、且**不依赖本脚本**的那条命令
 *   `reading` —— 人读的那一格
 *   `verdict` —— confirmed / refuted / unmeasured
 *   `why`     —— ★ 为什么是这个裁决（refuted 时必须能看出一致性在哪一格断了）
 */
function readingOf(spec) {
  const verdict = spec.verdict
  if (!Object.values(VERDICT).includes(verdict)) {
    throw new Error(`reading "${spec.id}" 的裁决 Illegal：${String(verdict)}`)
  }
  return {
    id: spec.id,
    question: spec.question,
    command: spec.command,
    reading: spec.reading,
    expect: spec.expect ?? null,
    verdict,
    why: spec.why ?? null,
    value: spec.value ?? null,
  }
}

/** 读文件：缺席/读失败 ⇒ `unmeasured`（**不是**空串、**不是** 0 行）。 */
function readText(relativePath) {
  const absolute = join(ROOT, relativePath)
  let stat
  try {
    stat = statSync(absolute)
  } catch (reason) {
    return {
      status: VERDICT.unmeasured,
      reason: 'file-absent',
      detail: String(reason),
      absolute,
      relativePath,
    }
  }
  if (!stat.isFile()) {
    return { status: VERDICT.unmeasured, reason: 'not-a-file', detail: 'isDirectory', absolute, relativePath }
  }
  let text
  try {
    text = readFileSync(absolute, 'utf8')
  } catch (reason) {
    return { status: VERDICT.unmeasured, reason: 'read-failed', detail: String(reason), absolute, relativePath }
  }
  return {
    status: VERDICT.confirmed,
    absolute,
    relativePath,
    text,
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash('sha256').update(text).digest('hex'),
    /** ★ 文件以换行结尾 ⇒ `split('\n')` 末尾会多一个空串；**空行不是记录**。 */
    lines: text.split('\n').filter((line) => line.trim() !== ''),
  }
}

/**
 * 读 jsonl：**逐行解析，坏一行只跳过它自己**。
 *
 * ★ 为什么不用"整文件 JSON.parse"：`signals.jsonl` 里存在**半行**的可能性是本仓
 *   记过的账（`src/evolution/collect.ts` 的 `maxSignalNumberIn` 为此留了文本兜底）。
 *   整文件解析会让**一条坏行**把**全部**记录变成"读不出来" —— 那是静默放大。
 */
function readJsonLines(relativePath) {
  const text = readText(relativePath)
  if (text.status !== VERDICT.confirmed) return { ...text, rows: [], malformed: [] }
  const rows = []
  const malformed = []
  for (let index = 0; index < text.lines.length; index += 1) {
    const line = text.lines[index]
    try {
      const value = JSON.parse(line)
      rows.push({ line: index + 1, value })
    } catch (reason) {
      malformed.push({ line: index + 1, detail: String(reason), head: line.slice(0, 80) })
    }
  }
  return { ...text, rows, malformed }
}

function readJsonFile(relativePath) {
  const text = readText(relativePath)
  if (text.status !== VERDICT.confirmed) return text
  try {
    return { ...text, value: JSON.parse(text.text) }
  } catch (reason) {
    return { ...text, status: VERDICT.unmeasured, reason: 'parse-failed', detail: String(reason) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 口径：什么样的行算 `observeShaped`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★★ `observeShaped` 的定义（计划 §2.1 与 §12.1 表 #15 都钉死过）───────────────
 *
 * 口径：`s.source !== undefined && s.source.where !== undefined`
 *
 * ★★ 为什么**不是**"有 source 且有 message"：计划第一版这么写，而实测
 *   `message` 在 observe 形状的 29 行里**一条都没有**（那个 29 本身是对的，
 *   是定义错了）。⇒ 本脚本把定义写成**可复跑的谓词**，而不是一句话。
 *
 * ★★ 为什么 `wouldBlock` **只能**在这个子集上算：全部 45 行里那 10 行手写补录
 *   没有 `source` / `message` ⇒ 省事地拿全量算，它们会被塞进同一个键
 *   `undefined|undefined`，得到一个**看起来很像真的**错误读数。
 */
function isObserveShaped(signal) {
  return signal !== null && typeof signal === 'object'
    && signal.source !== null && typeof signal.source === 'object'
    && signal.source.where !== undefined
}

/** `at` 两种序列化形状都要认：t87 采集写 number，t88 手写补录写 ISO 字符串。 */
function epochMsOf(at) {
  if (typeof at === 'number' && Number.isFinite(at)) return at
  if (typeof at === 'string') {
    const parsed = Date.parse(at)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** dedupe 键 —— 与 `src/gates/collection/shared.ts:102` 的 `dedupeKeyOf` 同口径。 */
function dedupeKeyOf(candidate) {
  const kind = Array.isArray(candidate.kind) ? [...candidate.kind].sort().join(',') : String(candidate.kind)
  return `${kind}|${candidate.component ?? ''}|${candidate.message ?? ''}`
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 主流程
// ─────────────────────────────────────────────────────────────────────────────

function buildReadout() {
  const readings = []
  const sections = {}

  // ── A. 信号台账 ────────────────────────────────────────────────────────────
  const signals = readJsonLines(FILES.signals)
  const signalRows = signals.rows.map((row) => row.value)
  const observeShaped = signalRows.filter(isObserveShaped)
  const keyPresentRows = signalRows.filter((row) => row !== null && typeof row === 'object' && 'collected' in row)
  const keyMissingRows = signalRows.filter((row) => row !== null && typeof row === 'object' && !('collected' in row))

  const byKindCounts = {}
  for (const row of signalRows) {
    const kind = typeof row?.kind === 'string' ? row.kind : '(missing kind)'
    byKindCounts[kind] = (byKindCounts[kind] ?? 0) + 1
  }

  const ids = signalRows.map((row) => row?.id).filter((id) => typeof id === 'string')
  const idCounts = new Map()
  for (const id of ids) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  const duplicatedIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const distinctIds = idCounts.size
  const numericIds = [...idCounts.keys()]
    .map((id) => /^e-(\d+)$/.exec(id))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]))
  const maxNumericId = numericIds.length === 0 ? 0 : Math.max(...numericIds)

  const atShapes = {}
  let backwardsPairs = 0
  let atPrev
  for (const row of signalRows) {
    const shape = row === null || row === undefined ? 'missing' : typeof row.at
    atShapes[shape] = (atShapes[shape] ?? 0) + 1
    const at = epochMsOf(row?.at)
    if (at !== undefined && atPrev !== undefined && at < atPrev) backwardsPairs += 1
    if (at !== undefined) atPrev = at
  }

  sections.signals = {
    path: FILES.signals,
    status: signals.status,
    reason: signals.reason ?? null,
    bytes: signals.bytes ?? null,
    lines: signals.lines?.length ?? null,
    malformed: signals.malformed,
    sha256: signals.sha256 ?? null,
    total: signalRows.length,
    observeShaped: observeShaped.length,
    handShaped: signalRows.length - observeShaped.length,
    byKind: byKindCounts,
    collected: { keyPresent: keyPresentRows.length, keyMissing: keyMissingRows.length },
    ids: { distinct: distinctIds, maxNumeric: maxNumericId, duplicates: duplicatedIds.map(([id, count]) => ({ id, count })) },
    at: { shapes: atShapes, backwardsPairs },
  }

  if (signals.status !== VERDICT.confirmed) {
    readings.push(readingOf({
      id: 'signals.corpus',
      question: 'signals.jsonl 读得出来吗？',
      command: `wc -l ${FILES.signals}`,
      reading: `读不出来：${signals.reason}`,
      expect: '文件存在且每行可解析',
      verdict: VERDICT.unmeasured,
      why: `★ 这不是"0 条信号" —— 缺席与零必须不同形。detail: ${signals.detail ?? ''}`,
    }))
  } else {
    readings.push(readingOf({
      id: 'signals.total',
      question: '台账里现在有多少条信号？',
      command: `wc -l ${FILES.signals}`,
      reading: `${signalRows.length} 条（坏行 ${signals.malformed.length} 条）`,
      expect: '坏行 0；非空行数 = 记录数 + 坏行数',
      verdict: signals.malformed.length === 0 ? VERDICT.confirmed : VERDICT.refuted,
      why: signals.malformed.length === 0
        ? '每一行都解析成了记录；行数即记录数'
        : `★ 有 ${signals.malformed.length} 行解析不了（行号 ${signals.malformed.map((m) => m.line).join(',')}）—— 行数 ≠ 记录数`,
      value: signalRows.length,
    }))

    readings.push(readingOf({
      id: 'signals.observeShaped',
      question: '其中有多少条是 observe() 形状（来自一次真实的判据求值，而不是人写的笔记）？',
      command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x));console.log(L.length, L.filter(s=>s.source&&s.source.where).length, L.filter(s=>'collected' in s).length)"`,
      reading: `${observeShaped.length} / ${signalRows.length}（口径：s.source && s.source.where）`,
      expect: '0 < observeShaped <= total（手写补录的行不该多到吞掉台账）',
      verdict: observeShaped.length > 0 && observeShaped.length <= signalRows.length
        ? VERDICT.confirmed
        : VERDICT.refuted,
      why: `★ 不许用"有 source 且有 message"当口径 —— message 在这个子集里一条都没有（计划 §12.1 表 #15）。手写形状 ${signalRows.length - observeShaped.length} 条，不含 source。`,
      value: observeShaped.length,
    }))

    readings.push(readingOf({
      id: 'signals.collected.keyPresent',
      question: '`collected` 这一格在盘上的存在率是多少？（N1.1 要修的就是它）',
      command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x));console.log(L.filter(s=>'collected' in s).length, L.filter(s=>!('collected' in s)).length)"`,
      reading: `keyPresent ${keyPresentRows.length} / keyMissing ${keyMissingRows.length}（共 ${signalRows.length} 行）`,
      expect: '★ 三态：全缺 ⇒ confirmed（"键整个不存在"）；全有 ⇒ confirmed（"键整个存在"）；混合 ⇒ refuted（同一个数不再有意义）',
      verdict: keyPresentRows.length === 0 || keyMissingRows.length === 0
        ? VERDICT.confirmed
        : VERDICT.refuted,
      why: keyPresentRows.length === 0
        ? '★ 不是"有但为空"，是**键整个不存在**（`JSON.stringify` 把 `undefined` 静默丢掉 —— 见 N1.1）。这是今天的事实，也是 N1 之后**存量行仍然为 0** 的正确读数。'
        : keyMissingRows.length === 0
          ? '全量都有这一格 —— 若这是 N1 之后的新台账，正确；若存量还在，说明有人回填了历史（N1.1 明令禁止）。'
          : '★★ 台账变成【混合纪元】了：老行没有这一格、新行有 ⇒ 这个单一数字不再能回答任何问题，必须分段读（老行永久为 0，新行必须为 1）。',
      value: { keyPresent: keyPresentRows.length, keyMissing: keyMissingRows.length },
    }))

    readings.push(readingOf({
      id: 'signals.id.uniqueness',
      question: 'id 有撞车吗？（t93 记录的 e-0001…e-0005 各出现两次）',
      command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x));const c=new Map();for(const s of L)c.set(s.id,(c.get(s.id)||0)+1);console.log([...c].filter(([,n])=>n>1))"`,
      reading: `distinct ${distinctIds} / 最大编号 e-${String(maxNumericId).padStart(4, '0')}；撞车 ${duplicatedIds.map(([id, count]) => `${id}×${count}`).join(', ') || '无'}`,
      expect: 'distinct == maxNumeric 且无撞车（撞车是既成事实，只许读出来，不许改写）',
      verdict: duplicatedIds.length === 0 && distinctIds === maxNumericId
        ? VERDICT.confirmed
        : duplicatedIds.length > 0 && distinctIds === maxNumericId
          ? VERDICT.confirmed
          : VERDICT.refuted,
      why: duplicatedIds.length > 0
        ? `★ 撞车是**历史事实**（t93 的 \`maxSignalNumberIn\` 正则少写 \`\\s*\` 导致重分配）。现状：${signalRows.length} 行 ↔ ${distinctIds} 个不同 id。任何"按 id 回溯"的读取端都必须先问这一格。`
        : '没有撞车，且不同 id 数 = 最大编号（编号空间没有空洞）。',
      value: { distinct: distinctIds, maxNumeric: maxNumericId, duplicated: duplicatedIds.map(([id, count]) => ({ id, count })) },
    }))

    readings.push(readingOf({
      id: 'signals.at.monotonic',
      question: '`at` 能当时间序用吗？（cooldown 要靠它算间隔）',
      command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x));const ms=v=>typeof v==='number'?v:Date.parse(v);let b=0;for(let i=1;i<L.length;i++)if(ms(L[i].at)<ms(L[i-1].at))b++;console.log('backwards',b,'shapes',[...new Set(L.map(r=>typeof r.at))])"`,
      reading: `形状 ${JSON.stringify(atShapes)}；逆序相邻对 ${backwardsPairs} 对`,
      expect: '两种形状都要认；逆序对 > 0 必须被点名（cooldown 遇到回拨要判 unmeasured，不是 blocked）',
      verdict: Object.keys(atShapes).every((shape) => shape === 'number' || shape === 'string')
        ? VERDICT.confirmed
        : VERDICT.unmeasured,
      why: backwardsPairs > 0
        ? `★ 有 ${backwardsPairs} 对逆序 —— 手写补录的行按内容时间写、采集的行按写入时间写，两者不同序。任何按文件顺序推时间的算法都会在这里错，所以本脚本一律按 \`at\` 排序/比较，不按行号。`
        : '按 \`at\` 严格不降序。',
      value: { shapes: atShapes, backwardsPairs },
    }))

    /**
     * ── `by kind` —— 计划 §N0 表格里逐字点名的一格 ─────────────────────────────
     *
     * ★ 它不是装饰：`kind` 决定**这条信号该被谁读**（rejection 走向缺陷账、
     *   insight 走向提案、success 走向"这条判据证明过自己"）。三个桶的**比例**
     *   是判断"采集层只看得见失败、看不见成功"有没有发生的唯一入口 ——
     *   一个只会记 rejection 的采集层，其 `direction` 结论必然是片面的。
     */
    const kindEntries = Object.entries(byKindCounts).sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    const kindSum = kindEntries.reduce((sum, [, count]) => sum + count, 0)
    readings.push(readingOf({
      id: 'signals.byKind',
      question: '信号按 kind 各有多少条？（决定"这条路看得见什么、看不见什么"）',
      command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x));const c={};for(const s of L)c[s.kind]=(c[s.kind]||0)+1;console.log(c)"`,
      reading: `by kind → ` + kindEntries.map(([kind, count]) => `${kind} ${count}`).join(' / ') + `（合计 ${kindSum} / 台账 ${signalRows.length} 行）`,
      expect: '各 kind 之和 = 台账行数（每一行都必须被归到一个 kind）',
      verdict: kindSum === signalRows.length && kindEntries.every(([kind]) => kind !== '(missing kind)')
        ? VERDICT.confirmed
        : VERDICT.refuted,
      why: kindSum === signalRows.length
        ? `★ 只读事实，不是判定：rejection 占 ${byKindCounts.rejection ?? 0}/${kindSum}。success 与 insight 各只有个位数 ⇒ 采集层今天**几乎只看得见失败**。这直接限制任何"哪个方向值得深挖"的结论 —— 深挖表里的 signals 一列也因此是同一偏斜的投影。`
        : `★ 有 ${signalRows.length - kindSum} 行没有可归类的 kind（或 kind 不是字符串）—— 这一格不完整，比例的每个分母都要打问号。`,
      value: { byKind: byKindCounts, sum: kindSum, total: signalRows.length },
    }))
  }

  // ── B. collection 四条的裁决分布 ───────────────────────────────────────────
  const gateTable = {}
  for (const signal of observeShaped) {
    const verdicts = signal.collection?.verdicts
    if (!Array.isArray(verdicts)) {
      gateTable['(no collection.verdicts)'] = gateTable['(no collection.verdicts)'] ?? { ok: 0, blocked: 0, unmeasured: 0, other: 0 }
      gateTable['(no collection.verdicts)'].other += 1
      continue
    }
    for (const entry of verdicts) {
      const gateId = typeof entry?.gateId === 'string' ? entry.gateId : '(missing gateId)'
      const verdict = typeof entry?.verdict === 'string' ? entry.verdict : '(missing verdict)'
      gateTable[gateId] = gateTable[gateId] ?? { ok: 0, blocked: 0, unmeasured: 0, other: 0 }
      if (verdict === 'ok' || verdict === 'blocked' || verdict === 'unmeasured') gateTable[gateId][verdict] += 1
      else gateTable[gateId].other += 1
    }
  }
  sections.collection = { gates: gateTable }

  if (signals.status === VERDICT.confirmed) {
    const rowsWithCollection = observeShaped.filter((signal) => Array.isArray(signal.collection?.verdicts) && signal.collection.verdicts.length > 0).length
    const cooldown = gateTable['collection.cooldown'] ?? { ok: 0, blocked: 0, unmeasured: 0, other: 0 }
    readings.push(readingOf({
      id: 'collection.verdicts',
      question: '四条采集判据跑了吗？每条各判了什么？',
      command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x)).filter(s=>s.source&&s.source.where);const t={};for(const s of L)for(const v of s.collection.verdicts){const k=v.gateId+'.'+v.verdict;t[k]=(t[k]||0)+1};console.log(t)"`,
      reading: Object.entries(gateTable)
        .map(([gateId, counts]) => `${gateId}: ok ${counts.ok} / blocked ${counts.blocked} / unmeasured ${counts.unmeasured}${counts.other > 0 ? ` / other ${counts.other}` : ''}`)
        .join('\n      '),
      expect: `每条 observeShaped 行都带 4 条裁决；共 ${observeShaped.length * 4} 格`,
      verdict: rowsWithCollection === observeShaped.length && Object.keys(gateTable).length >= 4
        ? VERDICT.confirmed
        : rowsWithCollection === 0
          ? VERDICT.unmeasured
          : VERDICT.refuted,
      why: `带 collection 的行 ${rowsWithCollection} / ${observeShaped.length}。★ \`cooldown\` 今天 ${cooldown.unmeasured}/${observeShaped.length} 判不了 —— 那不是"判据坏了"，是**它的输入从未存在过**（三个调用点都没传 \`index\`/\`source\`）。`,
      value: gateTable,
    }))

    readings.push(readingOf({
      id: 'collection.cooldown.inputAbsent',
      question: '`cooldown` 是否整列 `unmeasured`？（N1.2 的收益靶）',
      command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x)).filter(s=>s.source&&s.source.where);console.log(L.filter(s=>s.collection.verdicts.some(v=>v.gateId==='collection.cooldown'&&v.verdict==='unmeasured')).length)"`,
      reading: `unmeasured ${cooldown.unmeasured} / ok ${cooldown.ok} / blocked ${cooldown.blocked}（分母 ${observeShaped.length}）`,
      expect: 'N1 之前：unmeasured == 分母（100% 判不了）；N1 之后：unmeasured == 0（要么 ok 要么 blocked）',
      verdict: observeShaped.length === 0
        ? VERDICT.unmeasured
        : cooldown.unmeasured === observeShaped.length || cooldown.unmeasured === 0
          ? VERDICT.confirmed
          : VERDICT.refuted,
      why: observeShaped.length === 0
        ? '没有 observeShaped 行 ⇒ 没有对象，不是"通过了"。'
        : cooldown.unmeasured === observeShaped.length
          ? '★ 100% 判不了 —— 与计划 §2.1 一致（`deriveCollectionIndex` 没填 `lastBySource`）。'
          : cooldown.unmeasured === 0
            ? '★ 整列都判出来了 —— N1.2 已落地。'
            : '★ 混合：一部分判出来了一部分没有 —— 说明有的调用点传了 index、有的没传（比全判不了更难发现）。',
      value: cooldown,
    }))
  }

  // ── C. 反事实读数 wouldBlock ───────────────────────────────────────────────
  /**
   * ★★★ 分母只能是 `observeShaped`（计划 §2.1 那条"我自己踩进去过的坑"）。
   *   同时打印两个 cooldown 口径：`where`（粗）与 `where+gateId`（细）——
   *   "`source` 传什么"直接决定 N1 的收益靶是 15 还是 13，这个选择不该留给实现者临场定。
   */
  function wouldBlockOf(rows, keyOf) {
    const last = new Map()
    let blocked = 0
    for (const signal of rows) {
      const key = keyOf(signal)
      const at = epochMsOf(signal.at)
      if (at === undefined) continue
      const previous = last.get(key)
      if (previous !== undefined && at - previous < COOLDOWN_MS) blocked += 1
      last.set(key, at)
    }
    return blocked
  }

  /**
   * ★ 链条语义的另一半：被判据挡掉的候选**不会写进台账** ⇒ 它也不会进
   *   `lastBySource`。所以"在已有台账上重放"得到的挡数，是**上界**
   *   （真实跑起来时被挡的那条不留下、不刷新窗口 ⇒ 后面可能少挡几条）。
   *   两个都给出来，并**指名**哪个是"会挡多少"、哪个是"如果全部写进来会挡多少"。
   */
  function wouldBlockStopAtFirstBlock(rows, keyOf) {
    const last = new Map()
    let blocked = 0
    for (const signal of rows) {
      const key = keyOf(signal)
      const at = epochMsOf(signal.at)
      if (at === undefined) continue
      const previous = last.get(key)
      if (previous !== undefined && at - previous < COOLDOWN_MS) {
        blocked += 1
        continue
      }
      last.set(key, at)
    }
    return blocked
  }

  function dedupeBlockedOf(rows) {
    const seen = new Set()
    let blocked = 0
    for (const signal of rows) {
      const key = dedupeKeyOf(signal)
      if (seen.has(key)) blocked += 1
      else seen.add(key)
    }
    return { blocked, distinct: seen.size }
  }

  const liveDedupe = dedupeBlockedOf(observeShaped)
  const liveCooldownWhere = wouldBlockOf(observeShaped, (signal) => signal.source.where)
  const liveCooldownWhereGate = wouldBlockOf(observeShaped, (signal) => `${signal.source.where}|${signal.source.gateId ?? ''}`)
  sections.wouldBlock = {
    scope: 'observeShaped only',
    denominator: observeShaped.length,
    totalRows: signalRows.length,
    dedupe: { key: 'kind|component|message', blocked: liveDedupe.blocked, distinct: liveDedupe.distinct },
    cooldownWhere: { key: 'source.where', windowMs: COOLDOWN_MS, blocked: liveCooldownWhere },
    cooldownWhereGate: { key: 'source.where+gateId', windowMs: COOLDOWN_MS, blocked: liveCooldownWhereGate },
    chainUpperBound: {
      cooldownWhere: wouldBlockStopAtFirstBlock(observeShaped, (signal) => signal.source.where),
      cooldownWhereGate: wouldBlockStopAtFirstBlock(observeShaped, (signal) => `${signal.source.where}|${signal.source.gateId ?? ''}`),
    },
  }

  if (signals.status === VERDICT.confirmed) {
    readings.push(readingOf({
      id: 'wouldBlock.dedupe',
      question: '如果 dedupe 真的跑，会挡掉几条？（只在 observeShaped 上算）',
      command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x)).filter(s=>s.source&&s.source.where);const seen=new Set();let b=0;for(const s of L){const k=[s.kind,s.source.where||'',s.message||''].join('|');if(seen.has(k))b++;else seen.add(k)}console.log('denominator',L.length,'distinct',seen.size,'wouldBlock',b)"`,
      reading: `分母 ${observeShaped.length}；distinct ${liveDedupe.distinct}；会挡 ${liveDedupe.blocked}`,
      expect: '分母必须是 observeShaped（不是全部行）；条数必须能被独立复算',
      verdict: observeShaped.length === 0
        ? VERDICT.unmeasured
        : liveDedupe.distinct + liveDedupe.blocked === observeShaped.length
          ? VERDICT.confirmed
          : VERDICT.refuted,
      why: observeShaped.length === 0
        ? '没有 observeShaped 行 ⇒ 无从反推。'
        : `★ 全部 ${signalRows.length} 行里那 ${signalRows.length - observeShaped.length} 行手写笔记没有 source/message —— 拿全量算会把它们塞进同一个键，得到一个**看起来很像真的**错误读数（计划 §2.1 记过这个坑）。`,
      value: { denominator: observeShaped.length, blocked: liveDedupe.blocked, distinct: liveDedupe.distinct },
    }))

    readings.push(readingOf({
      id: 'wouldBlock.cooldown',
      question: '如果 cooldown 真的跑，会挡掉几条？（两个 key 口径都印出来）',
      command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x)).filter(s=>s.source&&s.source.where).map(s=>({at:s.at,where:s.source.where,gate:s.source.gateId||''}));for(const key of ['where','gate']){const last=new Map();let b=0;for(const s of L){const k=key==='where'?s.where:s.where+'|'+s.gate;const t=typeof s.at==='number'?s.at:Date.parse(s.at);const p=last.get(k);if(p!==undefined&&t-p<300000)b++;last.set(k,t)}console.log(key,'denominator',L.length,'wouldBlock',b)}"`,
      reading: `分母 ${observeShaped.length}；key=where ⇒ ${liveCooldownWhere}；key=where+gateId ⇒ ${liveCooldownWhereGate}`,
      expect: '两个口径都必须打印 —— "传什么给 source"直接决定 N1 的收益靶是 15 还是 13',
      verdict: observeShaped.length === 0 ? VERDICT.unmeasured : VERDICT.confirmed,
      why: `★ 两个数都印出来，"传什么"这件事才有依据，而不是让实现者临场定。★ 另：链条上界（被挡的候选不写盘 ⇒ 不进 lastBySource）为 where ${sections.wouldBlock.chainUpperBound.cooldownWhere} / where+gateId ${sections.wouldBlock.chainUpperBound.cooldownWhereGate}。`,
      value: { denominator: observeShaped.length, where: liveCooldownWhere, whereGate: liveCooldownWhereGate, chain: sections.wouldBlock.chainUpperBound },
    }))
  }

  // ── D. 纪元切片：把每一个"历史基线"复现出来 ────────────────────────────────
  /**
   * ★★★ 这一节是给"数不一致而两边都像对的"准备的（计划 §8 S1 的停止点）。
   *
   *   同一个文件在 39 / 44 / 45 时刻被读过三次，三个数**都曾经是对的**。
   *   ⇒ 把"它当时是多少条"写成**前缀切片**，就能证明：分歧只在**纪元**，不在**方法**。
   *     任何一个历史基线不能复现 ⇒ 要么文件被改写过，要么口径漂了 —— 两者都必须停下。
   */
  const EPOCHS = [
    {
      id: 'plan-§2.1',
      source: 'docs/SELF-ITERATION-PLAN.md §2.1（39 行纪元）',
      signalsRows: 39,
      expect: {
        total: 39, observeShaped: 29, keyPresent: 0,
        byKind: { rejection: 36, insight: 2, success: 1 },
        verdicts: { 'collection.dedupe.ok': 29, 'collection.cooldown.unmeasured': 29, 'collection.attributable.ok': 28, 'collection.attributable.unmeasured': 1, 'collection.immunity.ok': 29 },
        wouldBlock: { dedupe: 3, cooldownWhere: 15, cooldownWhereGate: 13 },
      },
      frictionsMaxId: 393,
      frictionExpect: { dispatch: 170, completion: 164, contract: 24 },
    },
    {
      id: 'task-§t1',
      source: 't1 契约里给的"今天的基线"（44 行纪元）',
      signalsRows: 44,
      expect: { total: 44, observeShaped: 34, keyPresent: 0 },
      frictionsMaxId: 395,
      frictionExpect: null,
    },
  ]

  const frictionFiles = (() => {
    const absolute = join(ROOT, FILES.frictions)
    let names
    try {
      names = readdirSync(absolute)
    } catch (reason) {
      return { status: VERDICT.unmeasured, reason: 'dir-unreadable', detail: String(reason), names: [] }
    }
    const records = names
      .filter((name) => /^f-\d+\.json$/.test(name))
      .sort()
      .map((name) => ({
        name,
        number: Number(/^f-(\d+)\.json$/.exec(name)[1]),
      }))
    return { status: records.length === 0 ? VERDICT.unmeasured : VERDICT.confirmed, names, records }
  })()

  const frictionRecords = []
  if (frictionFiles.status === VERDICT.confirmed) {
    for (const file of frictionFiles.records) {
      let value
      try {
        value = JSON.parse(readFileSync(join(ROOT, FILES.frictions, file.name), 'utf8'))
      } catch (reason) {
        frictionRecords.push({ ...file, malformed: String(reason) })
        continue
      }
      frictionRecords.push({ ...file, value })
    }
  }

  const epochResults = []
  for (const epoch of EPOCHS) {
    const slice = signalRows.slice(0, epoch.signalsRows)
    const sliceObserve = slice.filter(isObserveShaped)
    const sliceKeyPresent = slice.filter((row) => row !== null && typeof row === 'object' && 'collected' in row).length
    const sliceKinds = {}
    for (const row of slice) sliceKinds[row?.kind] = (sliceKinds[row?.kind] ?? 0) + 1
    const sliceVerdicts = {}
    for (const signal of sliceObserve) {
      for (const entry of signal.collection?.verdicts ?? []) {
        const key = `${entry.gateId}.${entry.verdict}`
        sliceVerdicts[key] = (sliceVerdicts[key] ?? 0) + 1
      }
    }
    const sliceDedupe = dedupeBlockedOf(sliceObserve)
    const sliceCooldownWhere = wouldBlockOf(sliceObserve, (signal) => signal.source.where)
    const sliceCooldownWhereGate = wouldBlockOf(sliceObserve, (signal) => `${signal.source.where}|${signal.source.gateId ?? ''}`)

    /**
     * ★ 比较必须**规范化键序**：`JSON.stringify` 的键序 = 插入序，而"期望"是人在文档里
     *   写的字面量（`{rejection:…, insight:…}`），"实测"是按数据顺序累加出来的
     *   （`{insight:…, rejection:…}`）。直接 `JSON.stringify` 比 ⇒ **两个内容相同的对象
     *   判成不等**，于是这条读数会因为一个纯粹的书写顺序假红 —— 而假红比不读更坏：
     *   它教人去看错的地方。
     */
    const canonical = (value) => {
      if (Array.isArray(value)) return value.map(canonical)
      if (value === null || typeof value !== 'object') return value
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    }
    const checks = []
    const push = (label, expected, actual) => checks.push({
      label,
      expected,
      actual,
      equal: JSON.stringify(canonical(expected)) === JSON.stringify(canonical(actual)),
    })

    push('signals.total', epoch.expect.total, slice.length)
    push('rows.observeShaped', epoch.expect.observeShaped, sliceObserve.length)
    push('collected.keyPresent', epoch.expect.keyPresent, sliceKeyPresent)
    if (epoch.expect.byKind !== undefined) push('byKind', epoch.expect.byKind, Object.fromEntries(Object.entries(sliceKinds).sort(([a], [b]) => (a < b ? -1 : 1))))
    if (epoch.expect.verdicts !== undefined) push('verdicts', epoch.expect.verdicts, Object.fromEntries(Object.entries(sliceVerdicts).sort(([a], [b]) => (a < b ? -1 : 1))))
    if (epoch.expect.wouldBlock !== undefined) {
      push('wouldBlock.dedupe', epoch.expect.wouldBlock.dedupe, sliceDedupe.blocked)
      push('wouldBlock.cooldown(where)', epoch.expect.wouldBlock.cooldownWhere, sliceCooldownWhere)
      push('wouldBlock.cooldown(where+gateId)', epoch.expect.wouldBlock.cooldownWhereGate, sliceCooldownWhereGate)
    }

    let frictionSlice = null
    if (frictionFiles.status === VERDICT.confirmed && epoch.frictionExpect !== null) {
      const inSlice = frictionRecords.filter((record) => record.number <= epoch.frictionsMaxId && record.value !== undefined)
      const buckets = {}
      for (const record of inSlice) {
        const component = record.value?.index?.component
        if (typeof component !== 'string') continue
        buckets[component] = (buckets[component] ?? 0) + 1
      }
      frictionSlice = { maxId: epoch.frictionsMaxId, files: inSlice.length, buckets }
      for (const [component, expected] of Object.entries(epoch.frictionExpect)) {
        push(`frictions[${component}]`, expected, buckets[component] ?? 0)
      }
    }

    epochResults.push({
      id: epoch.id,
      source: epoch.source,
      signalsSliceRows: epoch.signalsRows,
      checks,
      frictionSlice,
      verdict: checks.length === 0
        ? VERDICT.unmeasured
        : checks.every((check) => check.equal) ? VERDICT.confirmed : VERDICT.refuted,
    })
  }
  sections.epochs = epochResults

  readings.push(readingOf({
    id: 'epochs.reproduce',
    question: '历史上出现过的每一个基线，还能被复现吗？（数不一致时先查纪元，别先改口径）',
    command: `node -e "const fs=require('fs');const L=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).map(x=>JSON.parse(x));for(const n of [39,44,45]){const s=L.slice(0,n);console.log(n,s.filter(x=>x.source&&x.source.where).length,s.filter(x=>'collected' in x).length)}"`,
    reading: epochResults
      .map((epoch) => `${epoch.id}（前 ${epoch.signalsSliceRows} 行）：${epoch.verdict}（${epoch.checks.filter((check) => check.equal).length}/${epoch.checks.length} 格相符）`)
      .join('\n      '),
    expect: '每一个历史纪元都能被前缀切片精确复现 ⇒ 分歧只在时间，不在方法',
    verdict: epochResults.length === 0 ? VERDICT.unmeasured : epochResults.every((epoch) => epoch.verdict === VERDICT.confirmed) ? VERDICT.confirmed : VERDICT.refuted,
    why: `★ 拿全量去对老基线**永远红**，而那个红没有信息量。反过来，拿老基线去对全量会得出"口径错了"的错误诊断 —— 这条读数就是为了不让这两种反应发生。`,
    value: epochResults.map((epoch) => ({ id: epoch.id, verdict: epoch.verdict, mismatched: epoch.checks.filter((check) => !check.equal) })),
  }))

  // ── E. proposals / history ────────────────────────────────────────────────
  const proposals = readJsonLines(FILES.proposals)
  const history = readJsonLines(FILES.history)
  sections.proposals = { path: FILES.proposals, status: proposals.status, reason: proposals.reason ?? null, rows: proposals.status === VERDICT.confirmed ? proposals.rows.length : null, malformed: proposals.malformed }
  sections.history = { path: FILES.history, status: history.status, reason: history.reason ?? null, rows: history.status === VERDICT.confirmed ? history.rows.length : null, malformed: history.malformed }

  readings.push(readingOf({
    id: 'proposals.rows',
    question: '提案库里有多少条提案？',
    /**
     * ★ 命令必须**自己打印裁决**，而不是"文件在的时候能打印数字、文件不在的时候打一行报错"。
     *   前者是读数，后者要人再去翻译一次错误信息 —— 而"翻译"正是把
     *   `No such file` 误读成 `0` 的那道缝。这里 `2>/dev/null || echo unmeasured`
     *   让两种情形**同一个形状**地输出，且退出码恒为 0。
     */
    command: `test -f ${FILES.proposals} && wc -l < ${FILES.proposals} || echo unmeasured`,
    reading: proposals.status === VERDICT.confirmed ? `${proposals.rows.length} 条` : `unmeasured（${proposals.reason}）`,
    expect: '★ 文件缺席 ⇒ unmeasured，**不是 0 条**',
    verdict: proposals.status === VERDICT.confirmed ? VERDICT.confirmed : VERDICT.unmeasured,
    why: '★ "0 条提案"与"提案库不存在"是两个不同的事实：前者说"分流判定一条都不该产出"，后者说"这一步根本没有落盘点"。并成一格会让人去修错的地方（计划 §N2 的验收④要求两者都行，但**不许静默为 0**）。',
    value: proposals.status === VERDICT.confirmed ? proposals.rows.length : null,
  }))

  readings.push(readingOf({
    id: 'history.rows',
    question: '分流历史有多少条？',
    command: `test -f ${FILES.history} && wc -l < ${FILES.history} || echo unmeasured`,
    reading: history.status === VERDICT.confirmed ? `${history.rows.length} 条` : `unmeasured（${history.reason}）`,
    expect: '★ 文件缺席 ⇒ unmeasured，不是 0 条',
    verdict: history.status === VERDICT.confirmed ? VERDICT.confirmed : VERDICT.unmeasured,
    why: '★ 与 proposals 同一条纪律：缺席与零不同形。',
    value: history.status === VERDICT.confirmed ? history.rows.length : null,
  }))

  // ── F. HMR 重载痕迹 ──────────────────────────────────────────────────────
  const hmr = readJsonLines(FILES.hmr)
  const hmrRows = hmr.rows.map((row) => row.value)
  let hmrBackwards = 0
  for (let index = 1; index < hmrRows.length; index += 1) {
    if (hmrRows[index]?.at < hmrRows[index - 1]?.at) hmrBackwards += 1
  }
  const hmrPids = [...new Set(hmrRows.map((row) => row.pid).filter((pid) => pid !== undefined))]
  sections.hmr = {
    path: FILES.hmr,
    status: hmr.status,
    reason: hmr.reason ?? null,
    rows: hmrRows.length,
    limit: HMR_TRACE_LIMIT,
    atCap: hmrRows.length >= HMR_TRACE_LIMIT,
    malformed: hmr.malformed,
    backwardsPairs: hmrBackwards,
    pids: hmrPids,
    first: hmrRows.length === 0 ? null : new Date(Math.min(...hmrRows.map((row) => row.at))).toISOString(),
    last: hmrRows.length === 0 ? null : new Date(Math.max(...hmrRows.map((row) => row.at))).toISOString(),
  }

  readings.push(readingOf({
    id: 'hmr.reloads',
    question: '重载痕迹里现在有多少条？它是不是已经滚动了？',
    command: `wc -l ${FILES.hmr}`,
    reading: hmr.status === VERDICT.confirmed
      ? `${hmrRows.length} 条；上限 ${HMR_TRACE_LIMIT} ⇒ ${hmrRows.length >= HMR_TRACE_LIMIT ? '★ 已到上限，老记录被淘汰（这是"最近 N 次"，不是"一共 N 次"）' : '未到上限'}；毫秒逆序 ${hmrBackwards} 对；pid ${hmrPids.join(',') || '无'}`
      : `unmeasured（${hmr.reason}）`,
    expect: '条数 ≤ 上限；逆序 0；pid 非空',
    verdict: hmr.status !== VERDICT.confirmed
      ? VERDICT.unmeasured
      : hmrBackwards === 0 && hmrPids.length > 0
        ? VERDICT.confirmed
        : VERDICT.refuted,
    why: `★ \`src/hmr-trace.ts:114\` 的 \`HMR_TRACE_LIMIT = 50\` 在 \`:199\` 处淘汰老行 ⇒ 到上限时"50 条"**不能**被读成历史总数（计划 §12.1 表 #17：HMR 的历史因果**无法回溯证实**，正是因为痕迹会滚）。`,
    value: { rows: hmrRows.length, limit: HMR_TRACE_LIMIT, atCap: hmrRows.length >= HMR_TRACE_LIMIT, pids: hmrPids },
  }))

  // ── G. frictions 语料 ─────────────────────────────────────────────────────
  const frictionParsed = frictionRecords.filter((record) => record.value !== undefined)
  const frictionMalformed = frictionRecords.filter((record) => record.value === undefined)
  const componentCounts = {}
  let missingComponent = 0
  let idMismatch = 0
  for (const record of frictionParsed) {
    const component = record.value?.index?.component
    if (typeof component !== 'string') {
      missingComponent += 1
      continue
    }
    componentCounts[component] = (componentCounts[component] ?? 0) + 1
    const idFromName = record.name.replace(/\.json$/, '')
    if (record.value?.id !== idFromName) idMismatch += 1
  }
  const exactBuckets = Object.entries(componentCounts).sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
  const prefixCounts = {}
  for (const [component, count] of exactBuckets) {
    const head = component.split('.')[0]
    prefixCounts[head] = (prefixCounts[head] ?? 0) + count
  }
  const exactSum = exactBuckets.reduce((sum, [, count]) => sum + count, 0)
  const prefixSum = Object.values(prefixCounts).reduce((sum, count) => sum + count, 0)

  sections.frictions = {
    path: FILES.frictions,
    status: frictionFiles.status,
    reason: frictionFiles.reason ?? null,
    files: frictionParsed.length,
    malformed: frictionMalformed.map((record) => ({ name: record.name, detail: record.malformed })),
    missingComponent,
    idMismatch,
    distinctComponents: exactBuckets.length,
    maxNumericId: frictionParsed.length === 0 ? 0 : Math.max(...frictionParsed.map((record) => record.number)),
    exactBuckets,
    prefixBuckets: Object.entries(prefixCounts).sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1)),
    exactSum,
    prefixSum,
  }

  readings.push(readingOf({
    id: 'frictions.files',
    question: '缺陷账本里有多少个 json 文件？能全部解析吗？',
    command: `ls ${FILES.frictions}/*.json | wc -l`,
    reading: frictionFiles.status !== VERDICT.confirmed
      ? `unmeasured（${frictionFiles.reason}）`
      : `${frictionParsed.length} 个可解析 / 坏 ${frictionMalformed.length} 个；id 与文件名不符 ${idMismatch} 个；最大编号 f-${String(sections.frictions.maxNumericId).padStart(4, '0')}`,
    expect: '坏文件 0；每个文件的 id 与其文件名一致；文件数 = 最大编号（无空洞）',
    verdict: frictionFiles.status !== VERDICT.confirmed
      ? VERDICT.unmeasured
      : frictionMalformed.length === 0 && idMismatch === 0 && frictionParsed.length === sections.frictions.maxNumericId
        ? VERDICT.confirmed
        : VERDICT.refuted,
    why: frictionMalformed.length === 0 && idMismatch === 0
      ? '文件数 = 最大编号 ⇒ 编号空间没有空洞（一次性的"少了一个文件"会在这里显形）。'
      : '★ 有洞/有坏文件 —— 别把总数当可靠分母。',
    value: { files: frictionParsed.length, malformed: frictionMalformed.length, idMismatch, maxNumericId: sections.frictions.maxNumericId },
  }))

  readings.push(readingOf({
    id: 'frictions.index.component',
    question: '每个缺陷都有 `index.component`（方向标签）吗？',
    command: `node -e "const fs=require('fs');const d='${FILES.frictions}';let n=0,miss=0;for(const f of fs.readdirSync(d).filter(f=>/^f-\\d+\\.json$/.test(f))){n++;const j=JSON.parse(fs.readFileSync(d+'/'+f,'utf8'));if(typeof (j.index&&j.index.component)!=='string')miss++}console.log('files',n,'missing',miss)"`,
    reading: `缺标签 ${missingComponent} / ${frictionParsed.length}；不同标签 ${exactBuckets.length} 个`,
    expect: '缺标签 0（方向分桶的分母是它）',
    verdict: frictionFiles.status !== VERDICT.confirmed
      ? VERDICT.unmeasured
      : missingComponent === 0 ? VERDICT.confirmed : VERDICT.refuted,
    why: missingComponent === 0
      ? '每一条都带方向标签 ⇒ 分桶的每一格都有分母。'
      : '★ 有缺陷没有方向标签 ⇒ directions 的分母不完整，长尾计数会偏低。',
    value: { missingComponent, distinctComponents: exactBuckets.length },
  }))

  // ── H. directions（计划 §7.2 的深挖入口）──────────────────────────────────
  /**
   * ★★★ 这一节的用途逐字（计划 §7.2）：
   *     **用户给出两个方向 → 跑一次本脚本 → 当场看到这两个方向今天各有几个
   *     真实缺陷、几条信号、判据跑没跑 → 再决定先深挖哪一条。**
   *
   * ★ 三格必须同时在场，缺一格就会做出错误的取舍：
   *     `frictions` —— 这个方向今天有多少条**真实缺陷**（分母）
   *     `signals`   —— 这个方向**产生过几条信号**（有没有被采集层看见）
   *     `verdicts`  —— 那些信号上**判据跑没跑**（ok / blocked / unmeasured）
   *   ⇒ 只看 frictions 会挑到一个"记了很多账但一条判据都没跑"的方向。
   */
  const directionKeys = ['dispatch', 'completion', 'contract']
  const directions = {}

  /** 信号按方向归档：★ 台账里**没有** `component` 字段，所以方向只能从 `source.where` 推。 */
  function directionOfSignal(signal) {
    if (!isObserveShaped(signal)) return '(hand-written: no source)'
    return signal.source.where
  }

  for (const component of Object.keys(componentCounts)) {
    directions[component] = { frictions: componentCounts[component], signals: 0, signalsByWhere: {}, verdicts: { ok: 0, blocked: 0, unmeasured: 0 } }
  }
  for (const signal of signalRows) {
    const where = directionOfSignal(signal)
    const bucket = directions[where] ?? (directions[where] = { frictions: 0, signals: 0, signalsByWhere: {}, verdicts: { ok: 0, blocked: 0, unmeasured: 0 } })
    bucket.signals += 1
    for (const entry of signal.collection?.verdicts ?? []) {
      const verdict = entry?.verdict
      if (verdict === 'ok' || verdict === 'blocked' || verdict === 'unmeasured') bucket.verdicts[verdict] += 1
    }
  }

  /**
   * ★ 长尾：`index.component` 有 35 个不同取值，其中 3 个占掉 91% —— 剩下 32 个
   *   每一个只有 1~2 条。**不截断地全列**会淹没主表；**悄悄丢掉**会让
   *   "长尾是 32 个方向"这件事消失。⇒ 打印前几名 + 显式给出长尾的**条数与方向数**。
   */
  const longTail = exactBuckets.filter(([component]) => !directionKeys.includes(component))
  const longTailFrictions = longTail.reduce((sum, [, count]) => sum + count, 0)

  /**
   * ★★ 三个"主方向"**必须无条件在场**，即使它们今天零记录。
   *
   *   实测过的一次崩溃（反向半边，空根夹具）：`frictions/` 是空目录 ⇒
   *   `directions['dispatch']` 是 `undefined` ⇒ 渲染时 `row.verdicts.ok` 抛
   *   `TypeError: Cannot read properties of undefined (reading 'ok')`。
   *   ⇒ **一份"什么都还没发生"的仓库会让脚本崩**，而崩溃与"没有数据"必须不同形。
   *   ⇒ 这里补空桶，让人读到"这个方向今天零证据"，而不是一行 stack。
   */
  for (const key of directionKeys) {
    directions[key] = directions[key] ?? {
      frictions: 0,
      signals: 0,
      signalsByWhere: {},
      verdicts: { ok: 0, blocked: 0, unmeasured: 0 },
    }
  }

  sections.directions = {
    unit: 'frictions/index.component（逐字分桶）',
    note: 'signals 按 source.where 归档（台账没有 component 字段）；手写补录的行没有 source，单独记为一格，**不并进任何方向**。',
    headline: directionKeys.map((key) => ({ component: key, ...directions[key] })),
    longTail: {
      directions: longTail.length,
      frictions: longTailFrictions,
      top: longTail.slice(0, 12),
      remaining: longTail.slice(12),
    },
    all: exactBuckets.map(([component, count]) => ({ component, frictions: count, signals: directions[component]?.signals ?? 0, verdicts: directions[component]?.verdicts ?? { ok: 0, blocked: 0, unmeasured: 0 } })),
    prefixCollapsed: Object.entries(prefixCounts).sort((left, right) => right[1] - left[1]).map(([component, count]) => ({ component, frictions: count })),
    sums: { exact: exactSum, prefix: prefixSum, files: frictionParsed.length },
  }

  readings.push(readingOf({
    id: 'directions.buckets',
    question: '按机制位置分桶，今天每个方向各有多少条真实缺陷？（给"先挖哪条"用的那张表）',
    command: `node -e "const fs=require('fs');const d='${FILES.frictions}';const c={};for(const f of fs.readdirSync(d).filter(f=>/^f-\\d+\\.json$/.test(f))){const j=JSON.parse(fs.readFileSync(d+'/'+f,'utf8'));const k=j.index.component;c[k]=(c[k]||0)+1}console.log(Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,6))"`,
    reading: `逐字分桶：${exactBuckets.slice(0, 3).map(([component, count]) => `${component} ${count}`).join(' / ')}；长尾 ${longTail.length} 个方向共 ${longTailFrictions} 条`
      + `\n      前缀折叠（对照）：${Object.entries(prefixCounts).sort((left, right) => right[1] - left[1]).slice(0, 3).map(([component, count]) => `${component} ${count}`).join(' / ')}`,
    expect: '逐字分桶之和 = 前缀折叠之和 = 可解析文件数（两个投影必须是同一个总量的两种切法）',
    verdict: frictionFiles.status !== VERDICT.confirmed
      ? VERDICT.unmeasured
      : exactSum === prefixSum && exactSum === frictionParsed.length
        ? VERDICT.confirmed
        : VERDICT.refuted,
    why: frictionFiles.status !== VERDICT.confirmed
      ? '缺陷目录读不出来 ⇒ 方向表没有分母。'
      : `★ 两种切法都要印：逐字分桶是计划 §7.2 引用的那张表（393 文件纪元：dispatch 170 / completion 164 / contract 24），而前缀折叠会把 \`contract.verify-command\` 这类**独立的判据 id**折进 \`contract\` 里 —— 只看折叠会以为那些子判据不存在。`,
    value: { exactSum, prefixSum, files: frictionParsed.length, longTailDirections: longTail.length, longTailFrictions },
  }))

  // ── I. 自检：本脚本真的没写盘 ─────────────────────────────────────────────
  /**
   * ★★★ 为什么把它做进脚本里，而不是靠外面 `git status` 对比：
   *
   *   `.gitignore` 第 4 行是 `.agent-teams/` ⇒ **整个被测目录都在版本控制之外**。
   *   于是"跑前跑后 git status 相同"这件事**恒真**，它测不到任何东西 ——
   *   一个在 `.agent-teams/` 里安静写文件的脚本照样绿。
   *   ⇒ 所以这里做的是**真读数**：把每个输入文件的 (size, mtimeMs) 记下来，
   *     结尾再 stat 一次。不同 ⇒ refuted。
   *
   * ★ 它还有一个副作用价值：若将来有人给本脚本加缓存/落盘，
   *   这一节会**立刻**从 confirmed 翻成 refuted。
   */
  const watched = [
    { relativePath: FILES.signals, absolute: join(ROOT, FILES.signals), before: signals },
    { relativePath: FILES.evolutionIndex, absolute: join(ROOT, FILES.evolutionIndex), before: readText(FILES.evolutionIndex) },
    { relativePath: FILES.hmr, absolute: join(ROOT, FILES.hmr), before: hmr },
    { relativePath: FILES.frictions, absolute: join(ROOT, FILES.frictions), before: frictionFiles, isDir: true },
  ]
  const writes = []
  let watchedExisting = 0
  for (const item of watched) {
    /** ★ 只有**跑之前存在**的东西才谈得上"被改动"；缺席到缺席不是写入。 */
    const existedBefore = item.isDir
      ? item.before?.status === VERDICT.confirmed
      : item.before?.status === VERDICT.confirmed
    if (existedBefore) watchedExisting += 1
    let after
    try {
      after = statSync(item.absolute)
    } catch {
      if (existedBefore) writes.push({ path: item.relativePath, change: 'disappeared' })
      continue
    }
    if (!existedBefore) {
      /** ★ 跑之前没有、跑之后有了 ⇒ **本脚本创建了它** —— 这是最严重的一格。 */
      writes.push({ path: item.relativePath, change: 'appeared (created by this run?)' })
      continue
    }
    if (item.isDir) {
      const beforeCount = item.before.names?.length
      const afterCount = readdirSync(item.absolute).length
      if (beforeCount !== undefined && beforeCount !== afterCount) {
        writes.push({ path: item.relativePath, change: `${beforeCount} → ${afterCount} entries` })
      }
      continue
    }
    if (item.before.bytes !== after.size || item.before.mtimeMs !== after.mtimeMs) {
      writes.push({ path: item.relativePath, change: `${item.before.bytes}B@${item.before.mtimeMs} → ${after.size}B@${after.mtimeMs}` })
    }
  }
  sections.selfCheck = { watched: watched.map((item) => item.relativePath), watchedExisting, writes }

  readings.push(readingOf({
    id: 'self-check.no-writes',
    question: '本脚本跑完之后，它读过的那些文件变了吗？',
    command: 'git status --short   # ★ 注意：.agent-teams/ 在 .gitignore 里 ⇒ 这条命令恒为绿，单靠它测不到写入',
    reading: writes.length === 0
      ? `${watchedExisting} 个在场输入，跑前跑后 (size, mtimeMs) 逐字相同；${watched.length - watchedExisting} 个本来就不在场（缺席到缺席不算写入）`
      : `★ 变了：${writes.map((item) => `${item.path} (${item.change})`).join('; ')}`,
    expect: '0 个在场输入发生变化；0 个新出现的文件',
    verdict: writes.length === 0 ? VERDICT.confirmed : VERDICT.refuted,
    why: '★ 真读数（stat 前后对比），而不是"git 说没变"——被测目录整个在 .gitignore 里，那条命令恒真、测不到东西。',
    value: writes,
  }))

  // ── 无关但必须被看见的：evolution/index.json 是不是过期的 ──────────────────
  const evolutionIndex = readJsonFile(FILES.evolutionIndex)
  let indexVerdict = VERDICT.unmeasured
  let indexWhy = '文件读不出来。'
  if (evolutionIndex.status === VERDICT.confirmed) {
    const counts = evolutionIndex.value?.counts ?? {}
    const declaredTotal = counts.total
    const liveTotal = signalRows.length + frictionParsed.length
    indexVerdict = declaredTotal === liveTotal ? VERDICT.confirmed : VERDICT.refuted
    indexWhy = declaredTotal === liveTotal
      ? '声明总量与盘上一致。'
      : `★ 它声明 total=${declaredTotal}，而盘上是 ${signalRows.length} 条信号 + ${frictionParsed.length} 条缺陷 = ${liveTotal} ⇒ **过期的人工快照**（\`note\` 自称"采集层索引"，但全仓零消费者：\`grep -rn "index.json" src/ scripts/\` 零命中）。⇒ 读它当"派生索引"会读到 372/382 那种陈旧数。`
  }
  sections.evolutionIndex = {
    path: FILES.evolutionIndex,
    status: evolutionIndex.status,
    reason: evolutionIndex.reason ?? null,
    declared: evolutionIndex.status === VERDICT.confirmed ? evolutionIndex.value?.counts ?? null : null,
    liveTotal: signalRows.length + frictionParsed.length,
    verdict: indexVerdict,
  }
  readings.push(readingOf({
    id: 'evolution.index.staleness',
    question: '`evolution/index.json` 还能当索引读吗？',
    command: `node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('${FILES.evolutionIndex}','utf8'));const s=fs.readFileSync('${FILES.signals}','utf8').split('\\n').filter(Boolean).length;const d=fs.readdirSync('${FILES.frictions}').filter(f=>/^f-\\d+\\.json$/.test(f)).length;console.log('declared',j.counts.total,'live',s+d)"`,
    reading: evolutionIndex.status === VERDICT.confirmed
      ? `声明 total ${evolutionIndex.value?.counts?.total}；盘上 ${signalRows.length} + ${frictionParsed.length} = ${signalRows.length + frictionParsed.length}`
      : `unmeasured（${evolutionIndex.reason}）`,
    expect: '声明总量 = 盘上总量',
    verdict: indexVerdict,
    why: indexWhy,
    value: evolutionIndex.status === VERDICT.confirmed ? evolutionIndex.value?.counts : null,
  }))

  // ── 汇总 ─────────────────────────────────────────────────────────────────
  const tally = { confirmed: 0, refuted: 0, unmeasured: 0 }
  for (const reading of readings) tally[reading.verdict] += 1

  return {
    schema: 1,
    script: 'scripts/evolution-readout.mjs',
    generatedAt: new Date().toISOString(),
    repoRoot: ROOT,
    note: 'N0 改前读数。每一条都带 confirmed / refuted / unmeasured 之一；unmeasured 永远不是 0。',
    tally,
    readings,
    sections,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 输出
// ─────────────────────────────────────────────────────────────────────────────

function renderText(report) {
  const lines = []
  const push = (line = '') => lines.push(line)

  push('═'.repeat(78))
  push('N0 改前读数 —— 自进化链路（只读；不写任何文件）')
  push(`仓库根  ${report.repoRoot}`)
  push(`采样于  ${report.generatedAt}`)
  push('═'.repeat(78))
  push('')
  push('三态：confirmed（读到且与期望相符） / refuted（读到但与期望不符） / unmeasured（读不到或没有对象）')
  /**
   * ★★ 词表映射必须**明写**：计划 §12.1 那条纪律的原始措辞是
   *   「readout 必须以"能打印出 `pass`/`fail`/`unmeasured` 三个字"为验收」，
   *   而本脚本的裁决词是 `confirmed`/`refuted`/`unmeasured`（三态含义相同、命名更准）。
   *   ⇒ 两套词同时出现在屏幕上，免得"找不到 pass 那三个字"被读成"没实现"。
   */
  push('词表：confirmed = pass · refuted = fail · unmeasured = unmeasured（两种写法指向同一件事）')
  push('')

  let currentSection = null
  for (const reading of report.readings) {
    const section = reading.id.split('.')[0]
    if (section !== currentSection) {
      currentSection = section
      push('─'.repeat(78))
      push(`【${section}】`)
      push('─'.repeat(78))
    }
    const badge = reading.verdict === VERDICT.confirmed ? '✅ confirmed'
      : reading.verdict === VERDICT.refuted ? '⚠️  refuted'
        : '◻️  unmeasured'
    push(`${badge}   ${reading.id}`)
    push(`    问    ${reading.question}`)
    push(`    命令  $ ${reading.command}`)
    push(`    读数  ${String(reading.reading).replace(/\n/g, '\n          ')}`)
    if (reading.expect !== null) push(`    期望  ${reading.expect}`)
    if (reading.why !== null) push(`    为何  ${String(reading.why).replace(/\n/g, '\n          ')}`)
    push('')
  }

  // directions 的"给人看的那张表"
  const directions = report.sections.directions
  if (directions !== undefined) {
    push('─'.repeat(78))
    push('【directions】方向 → 缺陷密度（决定先挖哪条用）')
    push('─'.repeat(78))
    push('  component              frictions   signals   verdicts(ok/blocked/unmeasured)')
    for (const row of directions.headline) {
      push(`  ${String(row.component).padEnd(22)} ${String(row.frictions).padStart(9)} ${String(row.signals).padStart(9)}   ${row.verdicts.ok}/${row.verdicts.blocked}/${row.verdicts.unmeasured}`)
    }
    push(`  ${'（其余长尾）'.padEnd(20)} ${String(directions.longTail.frictions).padStart(9)}   —— ${directions.longTail.directions} 个方向，逐条见下`)
    for (const [component, count] of directions.longTail.top) {
      push(`    · ${String(component).padEnd(52)} ${String(count).padStart(3)}`)
    }
    if (directions.longTail.remaining.length > 0) {
      push(`    · … 另有 ${directions.longTail.remaining.length} 个方向各 1~2 条（--json 里有全量）`)
    }
    push('')
    push('  注：signals 按 source.where 归档（台账没有 component 字段）；手写补录的行没有 source，单独一格，不并进任何方向。')
    push('')
  }

  // 纪元切片
  if (report.sections.epochs !== undefined) {
    push('─'.repeat(78))
    push('【epochs】历史基线能不能被复现（数不一致时先查纪元，别先改口径）')
    push('─'.repeat(78))
    for (const epoch of report.sections.epochs) {
      push(`  ${epoch.id}  —— ${epoch.verdict}（前 ${epoch.signalsSliceRows} 行切片）`)
      push(`    来源 ${epoch.source}`)
      for (const check of epoch.checks) {
        push(`    ${check.equal ? '✓' : '✗'} ${check.label}: 期望 ${JSON.stringify(check.expected)} / 实测 ${JSON.stringify(check.actual)}`)
      }
      push('')
    }
  }

  // 自检
  push('─'.repeat(78))
  push('【契约核对】')
  push('─'.repeat(78))
  push('  ① node scripts/evolution-readout.mjs            → 本屏幕（exit 0）')
  push('  ② node scripts/evolution-readout.mjs --json     → 机器可读（exit 0）')
  push('  ③ 每一组读数都带三态之一（本页共 ' + report.readings.length + ' 组：'
    + `${report.tally.confirmed} confirmed / ${report.tally.refuted} refuted / ${report.tally.unmeasured} unmeasured）`)
  push('  ④ 不写盘：见 self-check.no-writes（stat 前后对比；★ 不是 git status —— 被测目录在 .gitignore 里）')
  push('')
  push(`合计  confirmed(pass) ${report.tally.confirmed} · refuted(fail) ${report.tally.refuted} · unmeasured ${report.tally.unmeasured}`)
  push('★ refuted ≠ 脚本坏了：它是一条「读到的数与写死的期望不符」的信息。今天的 refuted 多半是历史基线过期，')
  push('  而 epochs 那一节会把过期的那一格精确复现出来 —— 分歧在纪元，不在方法。')
  push('')

  return `${lines.join('\n')}\n`
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 入口
// ─────────────────────────────────────────────────────────────────────────────

function main(argv) {
  if (ROOT === undefined) {
    process.stderr.write('evolution-readout: 找不到仓库根（向上 8 层都没有同时含 package.json 与 scripts/ 的目录）\n')
    return 2
  }
  const unknown = argv.filter((arg) => arg !== '--json' && arg !== '--help' && arg !== '-h')
  if (unknown.length > 0) {
    process.stderr.write(`evolution-readout: 不认识的参数 ${unknown.join(' ')}\n用法：node scripts/evolution-readout.mjs [--json]\n`)
    return 2
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('用法：node scripts/evolution-readout.mjs [--json]\n只读。打印 signals/frictions/proposals/hmr 的现状与三态裁决。\n')
    return 0
  }

  const report = buildReadout()
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(renderText(report))
  }
  /**
   * ★ exit 0 的条件：**读数产出了**。`refuted` 与 `unmeasured` 都**不是**退出码 ——
   *   它们是读数本身。把这个脚本做成"有 refuted 就非零退出"会让它变成一个闸，
   *   而当闸之后，人就会去改断言，而不是去读那一格。
   *   ⇒ 非零只留给"连读数都产不出来"（找不到仓库根 / 参数不认识）。
   */
  return 0
}

process.exitCode = main(process.argv.slice(2))
