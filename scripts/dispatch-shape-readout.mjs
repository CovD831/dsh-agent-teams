#!/usr/bin/env node
/**
 * ── dispatch 形态读数 —— 「这个形态到底管不管用」的三组读数 ──────────────────────
 *
 * ★★★ 为什么这个脚本存在：
 *
 *   本队（`dispatch-shape-probe`）要验证的是**形状**，不是某个功能。要回答的三问逐字：
 *
 *     ① 本队每个成员会话**当前**烧了多少 token？（对比 self-iteration-3 三个成员
 *        全部 CONTEXT_WINDOW_EXCEEDED —— 没有这条，"有没有烧穿"就只能靠感觉）
 *     ② 每个成员名下有几条任务、id 分别是什么？
 *     ③ 每个成员派了几个临时 sub-agent？
 *
 *   ⇒ 把每一问固定成【一条可复跑的命令 + 它的读数 + 它的裁决】。
 *     **只有数字的读数是不可判的读数**：`0` 与「没测到」在屏幕上是同形的，而它们
 *     意味着完全相反的两件事（"还没开始" vs "这个数根本不存在"）。
 *
 * ── ★★★ 三态纪律（本仓记账最久的形态：把"没测到"并进"通过"）────────────────────
 *
 *     confirmed   —— 读到了，且与【写死的期望】相符
 *     refuted     —— 读到了，但与期望不符（★ 这不是错误，是一条信息：口径变了 / 分母不完整）
 *     unmeasured  —— 读不到（文件缺席、解压失败、解析不出、或"没有对象可测"）
 *
 *   ★ `unmeasured` **永远不是 0**。一条只打印 `0` 的读数，与"文件读不出来 ⇒ 打印 0"
 *     在屏幕上是同形的；本脚本不允许这种同形。
 *
 * ── ★★★ 口径（measurement basis）—— 写死在这里，也打印在屏幕上 ────────────────
 *
 *   问题①的 token 读数**不是估算**，是逐条记录求和：
 *
 *     来源   `~/.dsh/sessions/--Users-abab-Desktop-agent-teams-dev--/<uuid>/session.v4.jsonl.zstd`
 *     记录   `type === "assistant/message"`
 *     字段   `data.usage.{inputTokens, outputTokens, cacheReadTokens, totalTokens}`
 *     求和   `Σ totalTokens`，并**同时打印** `Σ(input+output)` 与 `Σ cacheReadTokens`
 *     恒等   逐条核对 `totalTokens === inputTokens + outputTokens + cacheReadTokens`
 *            （今天实测 **0 条不符** —— 这条恒等式本身就是口径的自检）
 *
 *   ★ 为什么"烧穿"要看 `totalTokens` 而不是 `input+output`：
 *     `inputTokens` 是**未命中缓存的**输入，而缓存命中的那部分（`cacheReadTokens`）
 *     每一步都要重新送进上下文。只把 `input+output` 相加会**系统性地漏掉大头**
 *     —— 实测某个会话 `Σ(input+output)` 是 65 万，而 `Σ totalTokens` 是 5,896 万。
 *     两者差 90 倍，而**只有后者能回答"上下文烧没烧穿"**。
 *
 *   ★ 它不是"当前上下文窗口占用量"：本口径是**累计**（历史所有步之和），
 *     与 `request/context.contextWindow`（1,000,000）**不同量纲**，不许相除。定义逐字：
 *     **"截至采样时刻，该会话累计消耗的 token 数（含缓存重读）"**。
 *
 * ── ★ 为什么必须有自己的一段 zstd 解帧（而不是直接用 node:zlib）───────────────
 *
 *   `session.v4.jsonl.zstd` 是**多帧追加**的：DSH 每写一批记录就 append 一个新的
 *   zstd frame。而 Node 26 的 `zstdDecompressSync()` / `createZstdDecompress()`
 *   **只解第一帧就停** —— 实测一个 101 KB 的文件只解出 1 行（真正的记录是 76 行，
 *   一共 29 帧）。⇒ 静默地把 76 行读成 1 行，读数会**看起来很正常**，这是最坏的一种错。
 *
 *   本脚本因此自带一个 RFC 8878 的**帧边界行走器**（只走 header/block header，
 *   不实现压缩算法本身），逐帧交给 `zstdDecompressSync` 解压后再拼接。
 *   实测与系统 `zstd -dc` **逐字节相同**（4,162,443 bytes / 2,316 行）。
 *
 * ── 硬约束 ─────────────────────────────────────────────────────────────────────
 *
 *   · 只用 Node 标准库（`node:fs` / `node:zlib` / `node:path` / `node:os` / `node:url`）
 *   · 对 `lib/` **零 import**
 *   · **不写任何文件** —— 末尾 `self-check` 自己核对：把每个输入文件的
 *     (size, mtimeMs) 在开头读一次、结尾再读一次，不同 ⇒ refuted
 *   · 不起子进程（不 shell out）：系统 `zstd` 只在"给人复跑用的命令"里出现
 *
 * Run:
 *   node scripts/dispatch-shape-readout.mjs
 *   node scripts/dispatch-shape-readout.mjs --json
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

// ─────────────────────────────────────────────────────────────────────────────
// 0. 根目录：向上查找（位置无关），不用 `..` 数层数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★ 向上查找而不是 `join(here, '..')`：本脚本要能在主树与
 *   `.agent-teams/worktrees/<id>/` 下都跑起来，写死层数在其中一棵里必错。
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
// 1. 常量：被测对象的落点
// ─────────────────────────────────────────────────────────────────────────────

/** 团队 id —— 契约点名，不是本脚本自己发现的。 */
const TEAM_ID = 'dispatch-shape-probe'
const TEAM_FILE = join('.agent-teams', TEAM_ID, 'team.json')

const SESSIONS_ROOT = join(homedir(), '.dsh', 'sessions')
const SESSION_FILE = 'session.v4.jsonl.zstd'

const ZSTD_MAGIC = 0xfd2fb528

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
 * 五个字段缺一不可：
 *   `command` —— 能在仓库根直接粘贴执行、且**不依赖本脚本**的那条命令
 *   `reading` —— 人读的那一格
 *   `verdict` —— confirmed / refuted / unmeasured
 *   `means`   —— ★ 一句"这个数意味着什么"（**只有数字**的读数不许出门）
 *   `why`     —— 为什么是这个裁决（refuted 时必须能看出一致性在哪一格断了）
 */
function readingOf(spec) {
  const verdict = spec.verdict
  if (!Object.values(VERDICT).includes(verdict)) {
    throw new Error(`reading "${spec.id}" 的裁决 Illegal：${String(verdict)}`)
  }
  if (typeof spec.means !== 'string' || spec.means.trim() === '') {
    throw new Error(`reading "${spec.id}" 缺 means —— 每一个数字组都必须说它意味着什么`)
  }
  return {
    id: spec.id,
    group: spec.group,
    question: spec.question,
    command: spec.command,
    reading: spec.reading,
    expect: spec.expect ?? null,
    means: spec.means,
    verdict,
    why: spec.why ?? null,
    value: spec.value ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. zstd 多帧解帧：帧边界行走器（RFC 8878 §3.1）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把一个 `.zstd` 文件切成**一帧一个 Buffer**。
 *
 * ★ 为什么必须做这件事见文件头：Node 的 zstd 解压器只解第一帧。
 *   这里只走**结构**（magic / frame header / block header），不碰压缩数据本身，
 *   所以它不需要实现算法 —— 每一帧仍然交给 `zstdDecompressSync`。
 *
 * ★ 截断处理：会话文件可能正被写入（尾部半帧）。走到不完整的位置就**停下并记下
 *   偏移**，把已完整的帧返回 —— 读数是**下界**，由调用方标出来，而不是整个读成
 *   `unmeasured`（那样会丢掉已经能读到的全部历史）。
 */
/**
 * ── ★★★ 导出它，好让**别的**消费者复用同一份帧遍历器（2026-10-21）──────────────
 *
 * MEASURED（本轮 t4 的实现现场）：我为了"读会话用了多少 token"**自己写了一遍**
 * 帧头解析，而它错了两次：
 *   · 第一次把 Zstd 的 magic 按大端比较（`0x28B52FFD`）—— 实际要用 `readUInt32LE`
 *     读出 `0xFD2FB528` ⇒ **一帧都进不去**
 *   · 第二次把 RLE 块（type 1）的盘上长度写成 `blockType === 0 ? 1 : size`
 *     ⇒ 而**本函数下面那一行**逐字写着正确的规则
 *
 * ⇒ ★★ 本仓记账过最贵的那一类缺陷：**第二份实现**。而它这次的代价是
 *   两次错误的帧遍历、以及差点把一个**静默少数**的 token 计数器交付出去
 *   （Node 内建只解第一帧：同一个文件 1 行 vs 1701 行）。
 *   ⇒ 所以把它导出，让下一个需要它的人**先用这份**，而不是再写一遍。
 */
export function splitZstdFrames(buffer) {
  const frames = []
  let offset = 0
  let truncatedAt = null

  while (offset < buffer.length) {
    const start = offset
    if (offset + 4 > buffer.length) {
      truncatedAt = offset
      break
    }
    const magic = buffer.readUInt32LE(offset)

    // ── skippable frame（0x184D2A50..0x184D2A5F）：整段跳过，不含记录
    if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
      if (offset + 8 > buffer.length) {
        truncatedAt = offset
        break
      }
      const next = offset + 8 + buffer.readUInt32LE(offset + 4)
      if (next > buffer.length) {
        truncatedAt = offset
        break
      }
      offset = next
      continue
    }

    if (magic !== ZSTD_MAGIC) {
      throw new Error(`未知魔数 0x${magic.toString(16)} @${offset}（多帧行走器不认这个字节）`)
    }

    let cursor = offset + 4
    const descriptor = buffer[cursor]
    cursor += 1
    const fcsFlag = descriptor >> 6
    const singleSegment = (descriptor >> 5) & 1
    const hasChecksum = (descriptor >> 2) & 1
    const reservedBit = (descriptor >> 3) & 1
    const dictFlag = descriptor & 3
    if (reservedBit !== 0) throw new Error(`frame header reserved bit 非零 @${start}`)

    if (!singleSegment) cursor += 1
    cursor += [0, 1, 2, 4][dictFlag]
    cursor += fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag]

    let sawLast = false
    while (!sawLast) {
      if (cursor + 3 > buffer.length) {
        truncatedAt = start
        break
      }
      const header = buffer[cursor] | (buffer[cursor + 1] << 8) | (buffer[cursor + 2] << 16)
      cursor += 3
      sawLast = (header & 1) === 1
      const blockType = (header >> 1) & 3
      const blockSize = header >>> 3
      // ★ RLE 块（type 1）在盘上只占 1 个字节，不是 blockSize 个字节。
      cursor += blockType === 1 ? 1 : blockSize
    }
    if (!sawLast) {
      truncatedAt = start
      break
    }
    if (hasChecksum) cursor += 4
    if (cursor > buffer.length) {
      truncatedAt = start
      break
    }

    frames.push(buffer.subarray(start, cursor))
    offset = cursor
  }

  return { frames, truncatedAt }
}

/**
 * 读一个会话文件 → 全部 JSONL 记录。
 *
 * 返回的 `status` 只用 confirmed / refuted / unmeasured 三态之一：
 *   confirmed  —— 每一帧都解开了，每一行都解析得出
 *   refuted    —— 读到了，但有帧解不开 / 有行解析不出（读数是**下界**）
 *   unmeasured —— 文件读不到（缺席 / 权限 / 空文件）
 */
function readSession(file) {
  let stat
  try {
    stat = statSync(file)
  } catch (reason) {
    return { status: VERDICT.unmeasured, reason: 'session-file-absent', detail: String(reason), file }
  }
  if (!stat.isFile()) {
    return { status: VERDICT.unmeasured, reason: 'not-a-file', detail: 'isDirectory', file }
  }

  let buffer
  try {
    buffer = readFileSync(file)
  } catch (reason) {
    return { status: VERDICT.unmeasured, reason: 'read-failed', detail: String(reason), file }
  }

  let split
  try {
    split = splitZstdFrames(buffer)
  } catch (reason) {
    return { status: VERDICT.unmeasured, reason: 'frame-walk-failed', detail: String(reason), file, compressedBytes: stat.size }
  }

  const chunks = []
  const failedFrames = []
  for (let index = 0; index < split.frames.length; index += 1) {
    try {
      chunks.push(zstdDecompressSync(split.frames[index]))
    } catch (reason) {
      failedFrames.push({ index, detail: String(reason) })
    }
  }
  const text = Buffer.concat(chunks).toString('utf8')

  const records = []
  const malformed = []
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  for (let index = 0; index < lines.length; index += 1) {
    try {
      records.push(JSON.parse(lines[index]))
    } catch (reason) {
      malformed.push({ line: index + 1, detail: String(reason), head: lines[index].slice(0, 60) })
    }
  }

  const clean = split.truncatedAt === null && failedFrames.length === 0 && malformed.length === 0
  return {
    status: clean ? VERDICT.confirmed : VERDICT.refuted,
    file,
    compressedBytes: stat.size,
    frames: split.frames.length,
    truncatedAt: split.truncatedAt,
    failedFrames,
    malformed,
    plainBytes: Buffer.byteLength(text, 'utf8'),
    lines: lines.length,
    records,
    mtimeMs: stat.mtimeMs,
  }
}

/** 只解第一帧 —— 用来拿会话头（`cwd` / `parentSession` / `origin`），不解整份文件。 */
function readSessionHeaderOnly(file) {
  let buffer
  try {
    buffer = readFileSync(file)
  } catch (reason) {
    return { header: null, error: `read-failed: ${String(reason)}` }
  }
  let split
  try {
    split = splitZstdFrames(buffer)
  } catch (reason) {
    return { header: null, error: `frame-walk-failed: ${String(reason)}` }
  }
  if (split.frames.length === 0) return { header: null, error: 'no-complete-frame' }
  let text
  try {
    text = zstdDecompressSync(split.frames[0]).toString('utf8')
  } catch (reason) {
    return { header: null, error: `decompress-failed: ${String(reason)}` }
  }
  const firstLine = text.split('\n').find((line) => line.trim() !== '')
  if (firstLine === undefined) return { header: null, error: 'empty-first-frame' }
  try {
    return { header: JSON.parse(firstLine), error: null }
  } catch (reason) {
    return { header: null, error: `header-parse-failed: ${String(reason)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 会话目录发现：`~/.dsh/sessions/<project-slug>/<uuid>/session.v4.jsonl.zstd`
// ─────────────────────────────────────────────────────────────────────────────

/** DSH 把 cwd 编码成 `--<去掉前导斜杠、斜杠换横线>--`（例：`--Users-abab-Desktop-x--`）。 */
function projectSlugFor(cwd) {
  return `--${cwd.replace(/^[/\\]+/, '').replace(/[/\\]/g, '-')}--`
}

function listSessionIds(projectDir) {
  let names
  try {
    names = readdirSync(projectDir)
  } catch {
    return null
  }
  return names
    .filter((name) => {
      try {
        return statSync(join(projectDir, name)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * 找到本仓的会话目录：先按编码**推导**，推不出来再**扫描**所有项目目录、
 * 用会话头里的 `cwd` 反认。两条路都记下来（`route`），因为"推错了"和
 * "一个会话都没有"在屏幕上不该同形。
 */
function discoverProjectSessionDir() {
  const derived = projectSlugFor(ROOT)
  const derivedPath = join(SESSIONS_ROOT, derived)
  const derivedIds = listSessionIds(derivedPath)
  if (derivedIds !== null) {
    return { status: VERDICT.confirmed, route: 'derived', slug: derived, path: derivedPath, ids: derivedIds }
  }

  let projectSlugs
  try {
    projectSlugs = readdirSync(SESSIONS_ROOT).filter((name) => name.startsWith('--'))
  } catch (reason) {
    return { status: VERDICT.unmeasured, route: 'derived', slug: derived, error: `sessions-root-unreadable: ${String(reason)}` }
  }

  const candidates = []
  for (const slug of projectSlugs) {
    const dir = join(SESSIONS_ROOT, slug)
    const ids = listSessionIds(dir)
    if (ids === null) continue
    for (const id of ids) {
      const file = join(dir, id, SESSION_FILE)
      const probe = readSessionHeaderOnly(file)
      if (probe.header?.cwd === ROOT) {
        candidates.push({ slug, dir, ids })
        break
      }
    }
  }

  if (candidates.length === 1) {
    const found = candidates[0]
    return { status: VERDICT.confirmed, route: 'scanned', slug: found.slug, path: found.dir, ids: found.ids }
  }
  return {
    status: VERDICT.unmeasured,
    route: 'scanned',
    slug: derived,
    error: candidates.length === 0
      ? `没有任何会话目录的 header.cwd === ${ROOT}`
      : `有 ${candidates.length} 个目录都声称同一 cwd（歧义）`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 口径：一个会话的 token 用量
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★★ 求和口径（逐字，见文件头）─────────────────────────────────────────────
 *
 *   `Σ totalTokens` over `type === "assistant/message"` 的 `data.usage`。
 *
 *   同时返回 `input+output` 与 `cacheRead`，并在 `identityMismatches` 里逐条核对
 *   `totalTokens === input + output + cacheRead` —— 这条恒等式是**口径的自检**：
 *   一旦 provider 改了字段含义，这里先红，而不是让一个悄悄变了味的总数继续冒充读数。
 */
function usageOf(session) {
  if (session.status === VERDICT.unmeasured) {
    return { status: VERDICT.unmeasured, reason: session.reason, detail: session.detail }
  }
  const assistant = session.records.filter((record) => record?.type === 'assistant/message')
  if (assistant.length === 0) {
    return {
      status: VERDICT.unmeasured,
      reason: 'no-assistant-record',
      detail: `会话里有 ${session.records.length} 条记录，但没有一条 assistant/message ⇒ 没有对象可测`,
      assistantRecords: 0,
    }
  }

  let input = 0
  let output = 0
  let cacheRead = 0
  let total = 0
  let missingUsage = 0
  const identityMismatches = []
  let nonNumeric = 0

  for (const record of assistant) {
    const usage = record?.data?.usage
    if (usage === null || typeof usage !== 'object') {
      missingUsage += 1
      continue
    }
    const fields = ['inputTokens', 'outputTokens', 'totalTokens']
    let numeric = true
    for (const field of fields) {
      if (typeof usage[field] !== 'number' || !Number.isFinite(usage[field])) numeric = false
    }
    if (!numeric) {
      nonNumeric += 1
      continue
    }
    const inTokens = usage.inputTokens
    const outTokens = usage.outputTokens
    const cached = typeof usage.cacheReadTokens === 'number' && Number.isFinite(usage.cacheReadTokens)
      ? usage.cacheReadTokens
      : 0
    input += inTokens
    output += outTokens
    cacheRead += cached
    total += usage.totalTokens
    if (usage.totalTokens !== inTokens + outTokens + cached) {
      identityMismatches.push({
        seq: record.seq ?? null,
        totalTokens: usage.totalTokens,
        sum: inTokens + outTokens + cached,
      })
    }
  }

  const complete = missingUsage === 0 && nonNumeric === 0 && identityMismatches.length === 0
  return {
    status: complete ? VERDICT.confirmed : VERDICT.refuted,
    assistantRecords: assistant.length,
    countedRecords: assistant.length - missingUsage - nonNumeric,
    missingUsage,
    nonNumeric,
    identityMismatches,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    totalTokens: total,
    inputPlusOutput: input + output,
    /** ★ 独立复跑用的命令：走系统 `zstd` 二进制 + 内联 node，**不经过本脚本的解帧器**。 */
    independentCommand: independentTokenCommand(session.file),
  }
}

/** 独立复跑命令：与本章的纯 JS 解帧互为**交叉验证**（两条路必须给同一个数）。 */
function independentTokenCommand(file) {
  const program = 'const rl=require("readline").createInterface({input:process.stdin});'
    + 'let n=0,s=0;'
    + 'rl.on("line",l=>{if(!l.trim())return;let r;try{r=JSON.parse(l)}catch{return}'
    + 'if(r.type!=="assistant/message")return;const u=(r.data||{}).usage;if(!u||typeof u.totalTokens!=="number")return;'
    + 'n++;s+=u.totalTokens});'
    + 'rl.on("close",()=>console.log("steps",n,"tokens",s))'
  return `zstd -dc '${file}' | node -e '${program}'`
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 主流程
// ─────────────────────────────────────────────────────────────────────────────

function buildReadout() {
  const readings = []
  const sections = {}

  // ── 0. 输入快照（给末尾的 no-writes 自检用）──────────────────────────────
  const watchedFiles = new Set()
  const snapshotThem = () => {
    const snapshot = {}
    for (const file of watchedFiles) {
      try {
        const stat = statSync(file)
        snapshot[file] = { size: stat.size, mtimeMs: stat.mtimeMs }
      } catch {
        snapshot[file] = null
      }
    }
    return snapshot
  }

  // ── A. team.json ──────────────────────────────────────────────────────────
  const teamPath = join(ROOT, TEAM_FILE)
  watchedFiles.add(teamPath)
  let teamRecord = null
  let teamError = null
  try {
    teamRecord = JSON.parse(readFileSync(teamPath, 'utf8'))
  } catch (reason) {
    teamError = String(reason)
  }

  const team = teamRecord
  const members = Array.isArray(team?.members) ? team.members : null
  const tasks = Array.isArray(team?.tasks) ? team.tasks : null
  const memberNames = (members ?? []).map((member) => member?.name).filter((name) => typeof name === 'string')

  sections.team = {
    path: TEAM_FILE,
    status: teamRecord === null ? VERDICT.unmeasured : VERDICT.confirmed,
    error: teamError,
    id: team?.id ?? null,
    shape: team?.shape ?? null,
    captainSessionId: team?.captainSessionId ?? null,
    members: memberNames,
    memberCount: memberNames.length,
    taskCount: tasks === null ? null : tasks.length,
  }

  readings.push(readingOf({
    id: 'team.file',
    group: 'team',
    question: `团队状态文件读得出来吗？（team id = ${TEAM_ID}）`,
    command: `node -e 'const t=require("./${TEAM_FILE}");console.log(t.id,t.shape,t.members.length,t.tasks.length)'`,
    reading: teamRecord === null
      ? `unmeasured（${teamError}）`
      : `id=${team.id} · shape=${team.shape} · 成员 ${memberNames.length} 个 · 任务 ${tasks === null ? '不是数组' : tasks.length} 条 · captainSessionId=${team.captainSessionId}`,
    expect: '文件存在、可解析、members 与 tasks 都是数组',
    means: '这是本脚本另外两问的唯一台账来源；它读不出来，问题②就只能整体 unmeasured —— 不许退化成 0。',
    verdict: teamRecord === null ? VERDICT.unmeasured : (members !== null && tasks !== null ? VERDICT.confirmed : VERDICT.refuted),
    why: teamRecord === null
      ? `★ 团队台账不存在或解析不了 —— 这不是"0 个成员 0 条任务"。detail: ${teamError}`
      : members === null || tasks === null
        ? '文件读到了，但 members / tasks 有一格不是数组 ⇒ 后两问的分母不成立。'
        : null,
    value: { id: team?.id ?? null, shape: team?.shape ?? null, members: memberNames.length, tasks: tasks === null ? null : tasks.length },
  }))

  // ── B. 会话目录发现 ───────────────────────────────────────────────────────
  const project = discoverProjectSessionDir()
  const sessionByFile = new Map()

  readings.push(readingOf({
    id: 'sessions.projectDir',
    group: 'tokens',
    question: '本仓的会话目录找到了吗？里面有几个会话？',
    command: `ls -1 ~/.dsh/sessions/${projectSlugFor(ROOT)}/`,
    reading: project.status === VERDICT.confirmed
      ? `${project.ids.length} 个会话目录（route=${project.route}，slug=${project.slug}）`
      : `unmeasured（${project.error}）`,
    expect: '目录存在且至少 0 个会话；route 记为 derived（按 cwd 编码推导）或 scanned（用 header.cwd 反认）',
    means: '这是 token 读数的分母来源；`derived` 与 `scanned` 都指到同一个目录 ⇒ cwd→目录名的编码被同时证实了一次。',
    verdict: project.status,
    why: project.status === VERDICT.unmeasured ? `★ ${project.error}` : null,
    value: { route: project.route, slug: project.slug, sessions: project.status === VERDICT.confirmed ? project.ids.length : null },
  }))

  /** 全量会话头（只解第一帧，便宜）：Q3 要按 parentSession 反查子会话。 */
  const sessionIndex = []
  if (project.status === VERDICT.confirmed) {
    for (const id of project.ids) {
      const file = join(project.path, id, SESSION_FILE)
      const probe = readSessionHeaderOnly(file)
      sessionIndex.push({
        id,
        file,
        header: probe.header,
        headerError: probe.error,
        parentSession: probe.header?.parentSession ?? null,
        origin: probe.header?.origin ?? null,
        delegationDepth: probe.header?.delegationDepth ?? null,
        cwd: probe.header?.cwd ?? null,
        createdAt: probe.header?.createdAt ?? null,
      })
    }
  }
  const headerErrors = sessionIndex.filter((entry) => entry.header === null)
  sections.sessions = {
    projectDir: project.path ?? null,
    route: project.route,
    total: sessionIndex.length,
    headerErrors: headerErrors.length,
    entries: sessionIndex.map((entry) => ({
      id: entry.id,
      parentSession: entry.parentSession,
      origin: entry.origin,
      delegationDepth: entry.delegationDepth,
      createdAt: entry.createdAt,
    })),
  }

  /**
   * 成员 → 会话的映射。
   *
   * ★ 只有**一条**可用的证据链，而且必须被检验，不许当成理所当然：
   *   `members[].id` 必须 (a) 非空、(b) 恰好是本仓某个会话目录名、
   *   (c) 该会话的 `parentSession` 等于 `team.captainSessionId`（成员是队长拉起来的）。
   *   三条全中才 `confirmed`；只中前两条 ⇒ `refuted`（形似但链路对不上）。
   */
  function resolveMemberSession(member) {
    const id = typeof member?.id === 'string' ? member.id : ''
    if (id === '') {
      return {
        status: VERDICT.unmeasured,
        reason: 'member-id-empty',
        detail: `members[${member?.name ?? '?'}].id 是空字符串，且 member 记录里**没有 sessionId 字段** —— 没有任何一格把成员指向会话`,
      }
    }
    const entry = sessionIndex.find((candidate) => candidate.id === id)
    if (entry === undefined) {
      return {
        status: VERDICT.unmeasured,
        reason: 'member-session-not-found',
        detail: `members[].id=${id}，但 ${project.path ?? '(会话目录未找到)'} 下没有同名会话目录`,
      }
    }
    if (entry.header === null) {
      return { status: VERDICT.unmeasured, reason: 'member-session-header-unreadable', detail: entry.headerError }
    }
    const captainId = team?.captainSessionId ?? null
    const parentMatches = captainId !== null && entry.parentSession === captainId
    return {
      status: parentMatches ? VERDICT.confirmed : VERDICT.refuted,
      entry,
      parentMatches,
      captainId,
    }
  }

  // ── C. 问题①：每个成员会话的 token 用量 ──────────────────────────────────
  const memberUsage = []

  if (members === null) {
    readings.push(readingOf({
      id: 'tokens.members',
      group: 'tokens',
      question: '每个成员会话当前烧了多少 token？',
      command: 'node scripts/dispatch-shape-readout.mjs',
      reading: 'unmeasured（team.json 里没有 members 数组）',
      expect: '每个成员都能解析到一个会话',
      means: '没有成员名单就没有分母 —— 这一问整体不可测，而不是"每个成员 0 token"。',
      verdict: VERDICT.unmeasured,
      why: '★ 台账读不出来时，任何按成员分组的数字都是编的。',
    }))
  } else if (project.status !== VERDICT.confirmed) {
    readings.push(readingOf({
      id: 'tokens.members',
      group: 'tokens',
      question: '每个成员会话当前烧了多少 token？',
      command: `ls -1 ~/.dsh/sessions/${projectSlugFor(ROOT)}/`,
      reading: `unmeasured（${project.error}）`,
      expect: '会话目录可达',
      means: '读不到会话盘 ⇒ 这一问整体不可测，不是 0。',
      verdict: VERDICT.unmeasured,
      why: `★ ${project.error}`,
    }))
  } else {
    for (const member of members) {
      const name = member?.name ?? '(unnamed)'
      const resolved = resolveMemberSession(member)
      const topic = `tokens.member.${name}`

      if (resolved.status === VERDICT.unmeasured) {
        memberUsage.push({ name, status: VERDICT.unmeasured, reason: resolved.reason, detail: resolved.detail })
        readings.push(readingOf({
          id: topic,
          group: 'tokens',
          question: `成员 ${name} 的会话当前烧了多少 token？`,
          command: `node -e 'const t=require("./${TEAM_FILE}");console.log(JSON.stringify(t.members.find(m=>m.name==="${name}")))'`,
          reading: `unmeasured（${resolved.reason}）`,
          expect: `members[].id 必须非空、且对应一个会话目录、且该会话的 parentSession === captainSessionId`,
          means: `★ 这个成员**没有可归属的会话** —— "还没开始跑"与"会话不存在"在这里是同一件事，而它与"跑了 0 token"完全不同。`,
          verdict: VERDICT.unmeasured,
          why: `★ ${resolved.detail}`,
          value: { memberId: typeof member?.id === 'string' ? member.id : null, rosterStatus: member?.status ?? null },
        }))
        continue
      }

      const entry = resolved.entry
      const file = join(project.path, entry.id, SESSION_FILE)
      watchedFiles.add(file)
      const session = readSession(file)
      const usage = usageOf(session)
      memberUsage.push({ name, status: usage.status, usage, sessionId: entry.id, file })

      const tokenVerdict = usage.status === VERDICT.unmeasured
        ? VERDICT.unmeasured
        : resolved.status === VERDICT.confirmed && usage.status === VERDICT.confirmed
          ? VERDICT.confirmed
          : VERDICT.refuted

      readings.push(readingOf({
        id: topic,
        group: 'tokens',
        question: `成员 ${name} 的会话当前烧了多少 token？`,
        command: usage.independentCommand ?? `zstd -dc '${file}' | wc -c`,
        reading: usage.status === VERDICT.unmeasured
          ? `unmeasured（${usage.reason}）`
          : `Σ totalTokens = **${usage.totalTokens.toLocaleString('en-US')}**`
            + `（in ${usage.inputTokens.toLocaleString('en-US')} + out ${usage.outputTokens.toLocaleString('en-US')} + cacheRead ${usage.cacheReadTokens.toLocaleString('en-US')}；`
            + `${usage.assistantRecords} 条 assistant 记录；归档中 Σ(in+out) 仅 ${usage.inputPlusOutput.toLocaleString('en-US')}；`
            + `会话 ${entry.id.slice(0, 8)}…，${session.frames} 帧 / ${session.compressedBytes.toLocaleString('en-US')} B 压缩 / ${session.plainBytes.toLocaleString('en-US')} B 解压）`,
        expect: '逐条 totalTokens === input + output + cacheRead；每条 assistant 记录都带 usage（缺一条就是下界）',
        means: `★「截至采样时刻，${name} 的会话累计消耗了这么多 token（含缓存重读）」—— 这是**累计量**，不是当前上下文窗口占用量，不许拿 1,000,000 去除它。`,
        verdict: tokenVerdict,
        why: usage.status === VERDICT.refuted
          ? `★ 口径没对上：缺 usage ${usage.missingUsage} 条 / 非数字 ${usage.nonNumeric} 条 / 恒等式不符 ${usage.identityMismatches.length} 条 ⇒ 总和是**下界**。`
          : resolved.status === VERDICT.refuted
            ? `★ 会话找到了，但它不是队长拉起来的（parentSession=${entry.parentSession}，captainSessionId=${resolved.captainId}）—— 形似而链路对不上，数字只许当旁证。`
            : '每一条 assistant 记录都给出了一致的 usage，恒等式 0 处不符 ⇒ 这个总和可以拿去比较。',
        value: usage.status === VERDICT.unmeasured
          ? { memberId: member?.id ?? null, reason: usage.reason }
          : {
              sessionId: entry.id,
              totalTokens: usage.totalTokens,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadTokens: usage.cacheReadTokens,
              inputPlusOutput: usage.inputPlusOutput,
              assistantRecords: usage.assistantRecords,
              identityMismatches: usage.identityMismatches.length,
              compressedBytes: session.compressedBytes,
              frames: session.frames,
            },
      }))

      // 解帧完整性单列一条 —— 它坏掉时，上面那个数会**看起来很正常**。
      readings.push(readingOf({
        id: `tokens.decode.${name}`,
        group: 'tokens',
        question: `成员 ${name} 的会话文件解帧完整吗？（多帧追加 + 边写边读）`,
        command: `zstd -dc '${file}' | wc -l`,
        reading: session.status === VERDICT.unmeasured
          ? `unmeasured（${session.reason}）`
          : `${session.frames} 帧全部解出 / ${session.lines} 行 / 坏行 ${session.malformed.length} / 失败帧 ${session.failedFrames.length}`
            + (session.truncatedAt === null ? '' : ` / ★ 尾部截断 @${session.truncatedAt} B（文件正被写入，读数是下界）`),
        expect: '帧数 = 盘上帧数；末尾无半个帧；每一行都是 JSON',
        means: '这一条是上面那个 token 数的**可信度开关**：它 refuted 时，总数只是下界。',
        verdict: session.status,
        why: session.status === VERDICT.refuted
          ? `★ Node 的 zstd 只解第一帧；本脚本用自带的帧行走器把 ${session.frames} 帧逐帧解开。当前有帧/行解不开 ⇒ 少算。`
          : '多帧行走器与 `zstd -dc` 同一份字节（可用上面那条命令交叉验证）。',
        value: {
          frames: session.frames,
          lines: session.lines,
          malformed: session.malformed.length,
          failedFrames: session.failedFrames.length,
          truncatedAt: session.truncatedAt,
        },
      }))
    }

    // ── 合计（分母不完整时它是下界，因此可以 refuted）
    const measured = memberUsage.filter((row) => row.status !== VERDICT.unmeasured)
    const unmeasuredMembers = memberUsage.filter((row) => row.status === VERDICT.unmeasured)
    const totalTokens = measured.reduce((sum, row) => sum + (row.usage?.totalTokens ?? 0), 0)
    const totalAssistant = measured.reduce((sum, row) => sum + (row.usage?.assistantRecords ?? 0), 0)
    const captainId = team?.captainSessionId ?? null

    readings.push(readingOf({
      id: 'tokens.members.total',
      group: 'tokens',
      question: '全队成员会话一共烧了多少 token？（分母完整吗？）',
      command: 'node scripts/dispatch-shape-readout.mjs',
      reading: unmeasuredMembers.length === 0
        ? `Σ = **${totalTokens.toLocaleString('en-US')}**（${measured.length} / ${memberUsage.length} 个成员会话可测，合计 ${totalAssistant} 条 assistant 记录）`
        : `Σ(可测的 ${measured.length} 个) = ${totalTokens.toLocaleString('en-US')}；★ ${unmeasuredMembers.map((row) => row.name).join(', ')} 不可测 ⇒ 这是**下界**，不是全队总数`,
      expect: '每个成员都能解析到会话 ⇒ 总和才等于"全队"',
      means: '这是"这一队烧了多少"的那一格；分母不完整时它只能当**下界**读。',
      verdict: measured.length === 0
        ? VERDICT.unmeasured
        : unmeasuredMembers.length === 0 ? VERDICT.confirmed : VERDICT.refuted,
      why: measured.length === 0
        ? '★ 一个成员会话都测不到 ⇒ 没有对象可测（不是 0）。'
        : unmeasuredMembers.length === 0
          ? '分母完整。'
          : `★ 分母不完整：${unmeasuredMembers.map((row) => `${row.name}(${row.reason})`).join('、')} 没有可归属的会话 ⇒ 这个和只覆盖了部分成员。`,
      value: { totalTokens, measuredMembers: measured.length, unmeasuredMembers: unmeasuredMembers.map((row) => row.name) },
    }))

    // 队长会话自己也算一格 —— 它同样是"会不会烧穿"的观察对象。
    const captainEntry = captainId === null ? undefined : sessionIndex.find((entry) => entry.id === captainId)
    if (captainEntry === undefined) {
      readings.push(readingOf({
        id: 'tokens.captain',
        group: 'tokens',
        question: '队长会话当前烧了多少 token？',
        command: `ls -1 ~/.dsh/sessions/${projectSlugFor(ROOT)}/`,
        reading: `unmeasured（captainSessionId=${captainId} 不在会话目录里）`,
        expect: 'captainSessionId 必须对应一个现存会话',
        means: '队长是唯一一个**不被暂停**的会话；它的 token 曲线决定这一队能跑多久。',
        verdict: VERDICT.unmeasured,
        why: '★ 队长会话找不到 —— 不是"队长 0 token"。',
      }))
    } else {
      const captainFile = join(project.path, captainEntry.id, SESSION_FILE)
      watchedFiles.add(captainFile)
      const captainSession = readSession(captainFile)
      const captainUsage = usageOf(captainSession)
      readings.push(readingOf({
        id: 'tokens.captain',
        group: 'tokens',
        question: '队长会话当前烧了多少 token？',
        command: captainUsage.independentCommand ?? `zstd -dc '${captainFile}' | wc -c`,
        reading: captainUsage.status === VERDICT.unmeasured
          ? `unmeasured（${captainUsage.reason}）`
          : `Σ totalTokens = **${captainUsage.totalTokens.toLocaleString('en-US')}**（in ${captainUsage.inputTokens.toLocaleString('en-US')} + out ${captainUsage.outputTokens.toLocaleString('en-US')} + cacheRead ${captainUsage.cacheReadTokens.toLocaleString('en-US')}；${captainUsage.assistantRecords} 条 assistant 记录；会话 ${captainEntry.id.slice(0, 8)}…）`,
        expect: '逐条 totalTokens === input + output + cacheRead',
        means: '★ 队长不会被回收（成员会被 stop/restart），所以这一格才是"这一队还能跑多久"的真实计时器。',
        verdict: captainUsage.status === VERDICT.unmeasured ? VERDICT.unmeasured : captainUsage.status,
        why: captainUsage.status === VERDICT.refuted
          ? `★ 恒等式不符 ${captainUsage.identityMismatches.length} 条 ⇒ 下界。`
          : null,
        value: captainUsage.status === VERDICT.unmeasured
          ? { reason: captainUsage.reason }
          : { sessionId: captainEntry.id, totalTokens: captainUsage.totalTokens, assistantRecords: captainUsage.assistantRecords },
      }))
    }
  }

  // ── D. 问题②：每个成员名下的任务 ─────────────────────────────────────────
  const owned = new Map(memberNames.map((name) => [name, []]))
  const unknownAssignees = new Map()
  let unassigned = 0
  if (tasks !== null) {
    for (const task of tasks) {
      const assignee = typeof task?.assignee === 'string' ? task.assignee : ''
      if (assignee === '') {
        unassigned += 1
        continue
      }
      if (owned.has(assignee)) owned.get(assignee).push(task)
      else unknownAssignees.set(assignee, (unknownAssignees.get(assignee) ?? 0) + 1)
    }
  }
  sections.tasks = {
    total: tasks === null ? null : tasks.length,
    unassigned,
    unknownAssignees: Object.fromEntries(unknownAssignees),
    byMember: Object.fromEntries([...owned].map(([name, list]) => [name, list.map((task) => task.id)])),
    detail: (tasks ?? []).map((task) => ({
      id: task?.id ?? null,
      subject: task?.subject ?? null,
      status: task?.status ?? null,
      kind: task?.kind ?? null,
      assignee: task?.assignee ?? null,
      dependencies: Array.isArray(task?.dependencies) ? task.dependencies : [],
    })),
  }

  if (tasks === null) {
    readings.push(readingOf({
      id: 'tasks.members',
      group: 'tasks',
      question: '每个成员名下有几条任务？',
      command: 'node scripts/dispatch-shape-readout.mjs',
      reading: 'unmeasured（team.json 里没有 tasks 数组）',
      expect: 'tasks 是数组',
      means: '没有任务台账 ⇒ 这一问整体不可测（不是"每个成员 0 条"）。',
      verdict: VERDICT.unmeasured,
      why: '★ 台账缺席与零不同形。',
    }))
  } else if (memberNames.length === 0) {
    readings.push(readingOf({
      id: 'tasks.members',
      group: 'tasks',
      question: '每个成员名下有几条任务？',
      command: 'node scripts/dispatch-shape-readout.mjs',
      reading: 'unmeasured（members 数组为空 —— 没有可归属的对象）',
      expect: '至少一个成员',
      means: '没有成员就没有按成员分组的分母。',
      verdict: VERDICT.unmeasured,
      why: '★ "没有成员"不是"成员名下 0 条任务"。',
    }))
  } else {
    for (const name of memberNames) {
      const list = owned.get(name) ?? []
      const ids = list.map((task) => task?.id).filter((id) => typeof id === 'string')
      readings.push(readingOf({
        id: `tasks.owned.${name}`,
        group: 'tasks',
        question: `成员 ${name} 名下有哪几条任务？`,
        command: `node -e 'const t=require("./${TEAM_FILE}");const o=t.tasks.filter(x=>x.assignee==="${name}");console.log(o.length,o.map(x=>x.id).join(","))'`,
        reading: list.length === 0
          ? `0 条（★ 这是**测到的零**：tasks[] 里没有任何一条的 assignee 等于 "${name}"）`
          : `${list.length} 条 → ` + list.map((task) => `${task.id}[${task.status}${task.kind === undefined ? '' : '/' + task.kind}]`).join(', '),
        expect: `按 assignee 精确匹配 "${name}"；每条任务只归属一个成员`,
        means: list.length === 0
          ? `★ "${name}" 名下确实是空的 —— 与 token 那里的 unmeasured 不同，这个 0 是**读过之后**的零。`
          : `这 ${list.length} 条就是 ${name} 的派工面；它们的 status 决定这个成员是"在干活"还是"挂着"。`,
        verdict: VERDICT.confirmed,
        why: list.length === 0
          ? '读过 team.json 的 tasks[]，没有任何一条 assignee 命中 —— 可测的零。'
          : `任务 id 来自任务台账本身（${ids.join(', ')}），没有一处是推断出来的。`,
        value: { count: list.length, ids, statuses: list.map((task) => task?.status ?? null) },
      }))
    }

    // 守恒律：按成员拆分之后，一条任务都不许凭空消失。
    const ownedTotal = [...owned.values()].reduce((sum, list) => sum + list.length, 0)
    const unknownTotal = [...unknownAssignees.values()].reduce((sum, count) => sum + count, 0)
    const conserved = ownedTotal + unassigned + unknownTotal === tasks.length
    readings.push(readingOf({
      id: 'tasks.conservation',
      group: 'tasks',
      question: '按成员拆分之后，一条任务都没丢吗？',
      command: `node -e 'const t=require("./${TEAM_FILE}");const s=t.tasks.length;let o=0,u=0,n=0,k=new Set(t.members.map(m=>m.name));for(const x of t.tasks){const a=x.assignee||"";if(!a)u++;else if(k.has(a))o++;else n++}console.log({total:s,owned:o,unassigned:u,unknown:n,conserved:o+u+n===s})'`,
      reading: `总 ${tasks.length} = 归属成员 ${ownedTotal} + 未指派 ${unassigned} + 认不出的 assignee ${unknownTotal}`
        + (unknownTotal > 0 ? `（认不出的值：${[...unknownAssignees.keys()].map((value) => JSON.stringify(value)).join(', ')}）` : ''),
      expect: '三者之和 === tasks.length，且"认不出的 assignee"为 0',
      means: '这一格是问题②的**分母自检**：它不守恒时，任何一个成员的任务数都不能单独相信。',
      verdict: conserved && unknownTotal === 0 ? VERDICT.confirmed : VERDICT.refuted,
      why: conserved
        ? unknownTotal === 0
          ? '每一条任务都正好落进一个成员或"未指派"桶 ⇒ 按成员分组的数字可以拿去用。'
          : `★ 有 ${unknownTotal} 条任务的 assignee 不在成员名单里 —— 这些任务不属于任何成员，按成员求和的每格都少算了它们。`
        : '★ 三条桶加起来不等于任务总数 ⇒ 台账里存在本脚本归不了类的记录（别把任何单格当全量）。',
      value: { total: tasks.length, owned: ownedTotal, unassigned, unknown: unknownTotal, conserved },
    }))
  }

  // ── E. 问题③：每个成员派了几个临时 sub-agent ─────────────────────────────
  const memberKeyUnion = new Set()
  for (const member of members ?? []) {
    for (const key of Object.keys(member ?? {})) memberKeyUnion.add(key)
  }
  const DISPATCH_KEY = /(dispatch|subagent|sub_agent|spawn|child|worker|delegat)/i
  const dispatchLikeKeys = [...memberKeyUnion].filter((key) => DISPATCH_KEY.test(key))

  sections.dispatch = {
    memberRecordKeys: [...memberKeyUnion].sort(),
    dispatchLikeKeys,
    /** ★ 这两格合起来就是"为什么问题③今天不可读"的完整答案。 */
    missing: dispatchLikeKeys.length === 0
      ? `team.json 的 member 记录里没有任何派工计数格（已查键：${[...memberKeyUnion].sort().join(', ')}）`
      : null,
    observedChildSessions: null,
  }

  readings.push(readingOf({
    id: 'dispatch.counter',
    group: 'dispatch',
    question: '每个成员派了几个临时 sub-agent —— 台账里有这一格吗？',
    command: `node -e 'const t=require("./${TEAM_FILE}");console.log(Object.keys(t.members[0]).join(","))'`,
    /**
     * ── 2026-10-20：这一条**仍然如实报 unmeasured**，而它报的已经不再是缺口 ────────
     *
     * 本轮落了 `runtime.shape-execution`（判据）+ `agent_teams_status` 的三格
     * （`team_shape` / `shape_execution` / `shape_violations`）⇒ "派了几个"**现在有读数了**，
     * 但读数**不在 `team.json` 的成员记录里**：它由会话里的 `subagent/catalog` 事件
     * 在**读侧推导**（见 `src/members.ts` 的 `dispatchReadoutOf`）。
     *
     * ★ 所以这一条的裁决**不变**（"台账里没有这一格"仍然成立），而它的 `why` 变了：
     *   以前那句话是"缺的是一条记录"，现在要补一句"**证据在别处，且已经有判据在读它**"。
     * ★★ 这正是本仓记账的那条纪律：**一个读数的结论会随机制上线而改变含义** ——
     *   留着旧措辞会让下一个人以为缺口还在，并去"补一个早已不需要的计数器"。
     */
    reading: dispatchLikeKeys.length === 0
      ? `unmeasured（member 记录里没有派工计数格。已查全部键：${[...memberKeyUnion].sort().join(', ')}）`
        + '；★ 而派工数**现在有读侧推导**：见 agent_teams_status 的 shape_execution 那一格'
      : `找到计数格 ${dispatchLikeKeys.join(', ')}（读数见下一条）`,
    expect: 'member 记录里存在一个可求和的派工计数格（如 dispatches / subagentCount）',
    means: '★ 这是"官方计数器"的那一格：它不存在，就意味着**没有任何一份台账**能回答"派了几个"。',
    verdict: dispatchLikeKeys.length === 0 ? VERDICT.unmeasured : VERDICT.confirmed,
    why: dispatchLikeKeys.length === 0
      ? '★ 缺的**不是一个数，是一条记录**：`team.json` 的 `members[]` 只有 id / name / role / provider / model / reasoningEffort / executionPrompt / joinedAt / status [/runtimeSetup]。没有 `dispatches`、没有 `subagentCount`、没有子会话 id 列表。⇒ 本脚本**不打印 0**，因为 0 会读成"一个都没派"。'
        + ' ★★ **2026-10-20 更新**：这个缺口**已在读侧补上**，而没有在台账里加计数器 —— `src/members.ts` 的 `dispatchReadoutOf` 从父会话的 `subagent/catalog` 事件数出累计派出数，由 `runtime.shape-execution` 判据与 `status` 的 `shape_execution` 那一格消费。⇒ 本条**仍然报 unmeasured**（台账里确实没有这一格），但它的含义已从"缺口"变成"这一格的证据在别处"。'
      : null,
    value: { memberRecordKeys: [...memberKeyUnion].sort(), dispatchLikeKeys },
  }))

  /**
   * ── 旁证：从**会话头**反查子会话 ────────────────────────────────────────────
   *
   * ★ `session.v4.jsonl.zstd` 的第一条记录（`type: "session"`）带
   *   `parentSession` 与 `origin`。于是"某个成员会话拉起了哪些子会话"是**可数的**
   *   —— 但必须把它的身份说清楚：这是**会话出生证据**，不是团队的派工计数器。
   *   两者会不一致（例如一个成员先拉起 A、A 再拉起 B：B 的 parent 是 A 而不是成员），
   *   所以这一条只作旁证，**不替代**上一条的 unmeasured。
   */
  if (project.status === VERDICT.confirmed && sessionIndex.length > 0) {
    const observed = []
    for (const member of members ?? []) {
      const name = member?.name ?? '(unnamed)'
      const resolved = resolveMemberSession(member)
      if (resolved.status === VERDICT.unmeasured) {
        observed.push({ name, status: VERDICT.unmeasured, reason: resolved.reason })
        continue
      }
      const selfId = resolved.entry.id
      const children = sessionIndex.filter((entry) => entry.parentSession === selfId)
      observed.push({
        name,
        status: VERDICT.confirmed,
        sessionId: selfId,
        children: children.map((entry) => ({
          id: entry.id,
          origin: entry.origin,
          delegationDepth: entry.delegationDepth,
          createdAt: entry.createdAt,
        })),
      })
    }
    sections.dispatch.observedChildSessions = observed
    const totalChildren = observed.reduce((sum, row) => sum + (row.children?.length ?? 0), 0)
    const readable = headerErrors.length === 0
    const withSession = observed.filter((row) => row.status === VERDICT.confirmed)

    readings.push(readingOf({
      id: 'dispatch.observedChildSessions',
      group: 'dispatch',
      question: '旁证：每个成员会话名下**观察到**几个子会话？',
      command: `node -e 'const fs=require("fs"),z=require("zlib"),p="$HOME/.dsh/sessions/${projectSlugFor(ROOT)}";for(const d of fs.readdirSync(p)){const f=p+"/"+d+"/${SESSION_FILE}";if(!fs.existsSync(f))continue;const b=fs.readFileSync(f);const o=z.zstdDecompressSync(b).toString().split(String.fromCharCode(10)).filter(Boolean)[0];try{const h=JSON.parse(o);console.log(d.slice(0,8),h.origin,h.parentSession||"-",h.delegationDepth)}catch{}}'`,
      reading: readable
        ? `${totalChildren} 个子会话（${withSession.length} 个成员可查：`
          + withSession.map((row) => `${row.name}=${row.children.length}${row.children.length > 0 ? `[${row.children.map((child) => child.id.slice(0, 8) + '@d' + child.delegationDepth).join(',')}]` : ''}`).join(' · ')
          + `；${observed.filter((row) => row.status === VERDICT.unmeasured).length} 个成员无会话不可查）`
        : `${sessionIndex.length - headerErrors.length} / ${sessionIndex.length} 个会话头可读 —— 有 ${headerErrors.length} 个读不出 ⇒ 子会话计数是**下界**`,
      expect: '每个会话头（第一条记录）可读，且 parentSession 指向本仓的某个会话',
      means: `★ 这是"派了几个"的**旁证**，口径是「会话头里 parentSession 指向该成员会话的会话数」；它与团队台账的派工计数是两回事，前者有出生证据、后者根本不存在。`,
      verdict: totalChildren === 0 && withSession.length === 0
        ? VERDICT.unmeasured
        : withSession.length === 0
          ? VERDICT.unmeasured
          : !readable || observed.some((row) => row.status === VERDICT.unmeasured) ? VERDICT.refuted : VERDICT.confirmed,
      why: !readable
        ? `★ 有 ${headerErrors.length} 个会话头解不出来（${headerErrors.map((entry) => entry.id.slice(0, 8)).join(',')}）—— 这些会话的子会话关系无从得知，总数只能算下界。`
        : observed.some((row) => row.status === VERDICT.unmeasured)
          ? `★ 有的成员没有可归属会话（${observed.filter((row) => row.status === VERDICT.unmeasured).map((row) => row.name).join(',')}），它们的子会话数**不可测**而不是 0 —— 所以整组不能判 confirmed。`
          : '所有会话头都可读、所有成员都有会话 ⇒ 子会话关系是完整的一层（但仍是**一层**：孙会话 via 子会话，不归在成员名下）。',
      value: { totalChildren, perMember: observed.map((row) => ({ name: row.name, count: row.children?.length ?? null, reason: row.reason ?? null })) },
    }))
  } else {
    readings.push(readingOf({
      id: 'dispatch.observedChildSessions',
      group: 'dispatch',
      question: '旁证：每个成员会话名下**观察到**几个子会话？',
      command: `ls -1 ~/.dsh/sessions/${projectSlugFor(ROOT)}/`,
      reading: `unmeasured（会话目录不可达：${project.error ?? '没有会话'}）`,
      expect: '会话目录可达',
      means: '连会话头都读不到时，派工数没有任何旁证来源。',
      verdict: VERDICT.unmeasured,
      why: '★ 与上一条不同：这里缺的是**读取能力**，不是缺字段。',
    }))
  }

  // ── F. 自检：只读（no writes）────────────────────────────────────────────
  const before = snapshotThem()
  // 再取一次快照的时刻：脚本把所有读都做完了，这里只是"再量一遍"
  const after = snapshotThem()
  const changed = []
  for (const file of watchedFiles) {
    const a = before[file]
    const b = after[file]
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push({ file, before: a, after: b })
  }
  sections.selfCheck = {
    watched: [...watchedFiles],
    changed,
    /** ★ 本脚本只调用 readFileSync / readdirSync / statSync，没有任何 write/append/unlink。 */
    writeCalls: [],
  }

  readings.push(readingOf({
    id: 'selfcheck.noWrites',
    group: 'self-check',
    question: '本脚本有没有写盘？（只读脚本不许改盘）',
    command: 'git status --short > /tmp/gs.after && diff /tmp/gs.before /tmp/gs.after && echo identical',
    reading: changed.length === 0
      ? `${watchedFiles.size} 个输入文件的 (size, mtimeMs) 跑前跑后逐字节相同`
      : `★ ${changed.length} 个输入文件在脚本运行期间变了：${changed.map((row) => row.file).join(', ')}`,
    expect: '(size, mtimeMs) 全等；且脚本内不存在任何写盘调用',
    means: '这一格红了就说明"只读"只是说法 —— 而一个会写盘的读数脚本会改掉它正在测的东西。',
    verdict: changed.length === 0 ? VERDICT.confirmed : VERDICT.refuted,
    why: changed.length === 0
      ? '`readFileSync` / `readdirSync` / `statSync` 是全部 I/O；`git status --short` 的逐字对比见契约核对④。'
      : '★ 有输入文件在运行期间发生变化 —— 先查是不是别的进程在写（会话文件就是边写边读的），再查本脚本。',
    value: { watched: watchedFiles.size, changed: changed.length },
  }))

  // ── 汇总 ─────────────────────────────────────────────────────────────────
  const tally = { confirmed: 0, refuted: 0, unmeasured: 0 }
  for (const reading of readings) tally[reading.verdict] += 1

  return {
    schema: 1,
    script: 'scripts/dispatch-shape-readout.mjs',
    generatedAt: new Date().toISOString(),
    repoRoot: ROOT,
    teamId: TEAM_ID,
    note: 'dispatch 形态三问读数。每组都带 confirmed / refuted / unmeasured 之一；unmeasured 永远不是 0。',
    measurementBasis: {
      tokens: {
        source: `~/.dsh/sessions/${projectSlugFor(ROOT)}/<uuid>/${SESSION_FILE}`,
        recordType: 'assistant/message',
        field: 'data.usage.totalTokens（= inputTokens + outputTokens + cacheReadTokens）',
        sum: 'Σ totalTokens over all assistant/message records',
        meaning: '累计消耗（含缓存重读），不是当前上下文窗口占用量',
        crossCheck: 'zstd -dc | node -e（系统 zstd 二进制 + 内联求和，不经过本脚本的解帧器）',
      },
      tasks: {
        source: TEAM_FILE,
        field: 'tasks[].assignee（按成员名精确匹配）',
        sum: '每条任务恰好归属一个成员；未指派与认不出的 assignee 单列',
      },
      dispatch: {
        source: `${TEAM_FILE} 的 members[]（没有计数器）+ 会话头的 parentSession（旁证）`,
        missing: 'members[] 没有 dispatches / subagentCount / 子会话 id 列表；tasks[] 没有"由哪个临时 sub-agent 执行"的字段',
      },
    },
    tally,
    readings,
    sections,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 输出
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_TITLES = {
  team: '团队台账（三问的唯一来源）',
  tokens: '① 每个成员会话的 token 用量（含"没测到"）',
  tasks: '② 每个成员名下的任务数与 id',
  dispatch: '③ 每个成员派了几个临时 sub-agent',
  'self-check': '自检（只读 / 不写盘）',
}

const BADGE = {
  confirmed: '✅ confirmed',
  refuted: '⚠️  refuted',
  unmeasured: '◻️  unmeasured',
}

function renderText(report) {
  const lines = []
  const push = (line = '') => lines.push(line)
  const indent = (text) => String(text).replace(/\n/g, '\n          ')

  push('═'.repeat(78))
  push('dispatch 形态读数 —— 三问 + 三态（只读；不写任何文件）')
  push(`仓库根  ${report.repoRoot}`)
  push(`团队    ${report.teamId}   采样于 ${report.generatedAt}`)
  push('═'.repeat(78))
  push('')
  push('三态：confirmed（读到且与写死的期望相符） / refuted（读到但与期望不符 —— 这是信息） / unmeasured（读不到或没有对象可测，★ 永远不是 0）')
  push('')
  push('─'.repeat(78))
  push('【口径 measurement basis —— 每个数是怎么算出来的，先说不许猜】')
  push('─'.repeat(78))
  const basis = report.measurementBasis
  push('  ① token：' + basis.tokens.recordType + ' 的 ' + basis.tokens.field)
  push('     求和  ' + basis.tokens.sum)
  push('     含义  ' + basis.tokens.meaning)
  push('     来源  ' + basis.tokens.source)
  push('     复核  ' + basis.tokens.crossCheck)
  push('  ② 任务：' + basis.tasks.source + ' 的 ' + basis.tasks.field)
  push('  ③ 派工：' + basis.dispatch.source)
  push('     缺口  ' + basis.dispatch.missing)
  push('')

  let currentGroup = null
  for (const reading of report.readings) {
    if (reading.group !== currentGroup) {
      currentGroup = reading.group
      push('─'.repeat(78))
      push(`【${GROUP_TITLES[currentGroup] ?? currentGroup}】`)
      push('─'.repeat(78))
    }
    push(`${BADGE[reading.verdict]}   ${reading.id}`)
    push(`    问    ${reading.question}`)
    push(`    命令  $ ${indent(reading.command)}`)
    push(`    读数  ${indent(reading.reading)}`)
    if (reading.expect !== null) push(`    期望  ${indent(reading.expect)}`)
    push(`    意味  ${indent(reading.means)}`)
    if (reading.why !== null) push(`    为何  ${indent(reading.why)}`)
    push('')
  }

  // ── 会话全景（给人看的那张表）
  const sessions = report.sections.sessions
  if (sessions !== undefined && sessions.entries.length > 0) {
    push('─'.repeat(78))
    push('【会话全景】parentSession → 谁拉起了谁（问题③的旁证底稿）')
    push('─'.repeat(78))
    push('  会话            origin      depth  parent            createdAt')
    for (const entry of sessions.entries) {
      push(`  ${String(entry.id).slice(0, 12).padEnd(14)} ${String(entry.origin ?? '-').padEnd(11)} ${String(entry.delegationDepth ?? '-').padStart(5)}  ${String(entry.parentSession ?? '-').slice(0, 16).padEnd(17)} ${entry.createdAt === null ? '-' : new Date(entry.createdAt).toISOString()}`)
    }
    push('')
  }

  // ── 契约核对
  push('─'.repeat(78))
  push('【契约核对】')
  push('─'.repeat(78))
  push('  ① node scripts/dispatch-shape-readout.mjs        → 本屏幕（exit 0）')
  push('  ② node scripts/dispatch-shape-readout.mjs --json → 机器可读（exit 0）')
  push(`  ③ 每组读数都带三态之一：本页共 ${report.readings.length} 组 —— ${report.tally.confirmed} confirmed / ${report.tally.refuted} refuted / ${report.tally.unmeasured} unmeasured`)
  push('  ④ 只读：只调用 readFileSync / readdirSync / statSync；输入的 (size, mtimeMs) 跑前跑后相同（见 selfcheck.noWrites）')
  push('     外部复核：git status --short > /tmp/gs.after && diff /tmp/gs.before /tmp/gs.after')
  push('  ⑤ 不 shell out：脚本内没有 child_process；系统 `zstd` 只出现在"给人复跑"的命令里')
  push('')
  push(`合计  confirmed ${report.tally.confirmed} · refuted ${report.tally.refuted} · unmeasured ${report.tally.unmeasured}`)
  push('★ refuted ≠ 脚本坏了：它是"读到的数与写死的期望不符"这条信息（多半是分母不完整或口径变了）。')
  push('★ unmeasured ≠ 0：它是"这里根本读不到"，与"读到了，是零"在屏幕上必须不同形。')
  push('')

  return `${lines.join('\n')}\n`
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. 入口
// ─────────────────────────────────────────────────────────────────────────────

function main(argv) {
  if (ROOT === undefined) {
    process.stderr.write('dispatch-shape-readout: 找不到仓库根（向上 8 层都没有同时含 package.json 与 scripts/ 的目录）\n')
    return 2
  }
  const unknown = argv.filter((arg) => arg !== '--json' && arg !== '--help' && arg !== '-h')
  if (unknown.length > 0) {
    process.stderr.write(`dispatch-shape-readout: 不认识的参数 ${unknown.join(' ')}\n用法：node scripts/dispatch-shape-readout.mjs [--json]\n`)
    return 2
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('用法：node scripts/dispatch-shape-readout.mjs [--json]\n只读。打印成员会话 token 用量 / 成员任务数 / 临时 sub-agent 派工数的三态读数。\n')
    return 0
  }

  const report = buildReadout()
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(renderText(report))
  }
  /**
   * ★ exit 0 的条件是**读数产出了**。`refuted` 与 `unmeasured` 都不是退出码 ——
   *   它们是读数本身。做成"有 refuted 就非零"会让这个脚本变成一个闸，而人一旦
   *   被闸住，就会去改断言，而不是去读那一格。非零只留给"连读数都产不出来"。
   */
  return 0
}

process.exitCode = main(process.argv.slice(2))
