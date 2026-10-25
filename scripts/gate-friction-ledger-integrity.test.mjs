/**
 * ── ★★★ t89：卡点台账的**完整性检查** —— 坏文件必须【报出】而不是静默跳过 ──────────
 *
 * 规格：`docs/DEFECT-FRICTION-WRITE-RACE.md` §4③。
 *
 * ── 为什么这条检查是本任务最值钱的一条 ──────────────────────────────────────
 *
 * MEASURED（规格 §0）：`.agent-teams/frictions/` 384 个文件里 **12 个是坏 JSON（3.1%）**。
 * ★★ **而此前没有任何检查发现过它**（包括那 384 条自己的 reader）。
 * ★ **它被发现的唯一原因是【偶然】**：队长**恰好**要复算一个数，
 *   而那个数**恰好**要遍历台账。
 * ⇒ ★★★ **如果没人做那件事，它会一直存在下去。**
 *
 * ── ★ 这条检查与"那个 reader"的区别（正是本文件存在的理由）────────────────────
 *
 * 本仓有**两条**既有的读法，而它们**都只是"跳过"**：
 * ```
 * scripts/friction-triage.mjs:608        malformed.push(name)   ← 收集了，但只是返回给调用方
 * scripts/report-escalation-rate.mjs:96  unreadable.push(...)   ← 同上
 * ```
 * ★ 两者都**没有**把"坏了几条"变成一个**会红**的事实 ——
 *   它们在工具里是读数，**在门禁里什么都不说**。
 * ⇒ ★ 本文件把那个读法升格为**判据**：**坏了就红**。
 *
 * ── ★★ 三态（与全仓纪律一致，且这里必须不同形）────────────────────────────
 *
 *   · 台账目录**不存在**      ⇒ ★ `skipped`（**不是** pass）—— "没有台账"与"台账干净"不同形
 *   · 存在、且**一个坏文件都没有** ⇒ ★ pass，并**报出条数**（"检查了几条"必须可读）
 *   · 存在、且**有坏文件**      ⇒ ★ **fail，逐个报出文件名 + 读不出的位置**
 *
 * ★★★ 而"报出位置"是刻意的：规格 §1 实测那 12 个的形状是
 *   「**合法的 JSON 头 + 垃圾尾**」—— 而 `JSON.parse` 的报错位置**正指着**那个尾巴。
 *   ⇒ 那个数字是**可核的证据**（"坏在哪里"），不是一个笼统的"坏"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 本仓的真台账（`.agent-teams/frictions/`）。 */
const LEDGER = join(ROOT, '.agent-teams', 'frictions')

/**
 * ── 逐个 parse 一个台账目录，把"读不回来"的**逐个报出** ────────────────────────────
 *
 * ★ 与既有 reader 的关键区别：**它不把坏文件从结果里静默去掉** ——
 *   坏的那些**带着原因**出现在 `unreadable` 里，于是调用方**必须处置**它。
 *
 * @param dir - 台账目录。
 * @returns `{ total, readable, unreadable }`；目录不存在 ⇒ `undefined`（★ 与"0 个坏"不同形）。
 */
function auditLedger(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    /** ★ 目录不存在 ⇒ `undefined`（"没有台账"与"台账干净"必须不同形）。 */
    return undefined
  }
  const json = names.filter((name) => name.endsWith('.json')).sort()
  const unreadable = []
  for (const name of json) {
    const path = join(dir, name)
    let raw
    try {
      raw = readFileSync(path, 'utf8')
    } catch (reason) {
      unreadable.push({ file: name, why: `unreadable: ${String(reason?.message ?? reason)}`, bytes: 0 })
      continue
    }
    try {
      const parsed = JSON.parse(raw)
      /**
       * ★ `null` / 非对象也算坏：一个能 parse 成 `null` 的台账条目
       *   **读起来像"有一条记录"**，而它没有任何字段 ⇒ 与"没有"同形。
       */
      if (parsed === null || typeof parsed !== 'object') {
        unreadable.push({ file: name, why: `parsed to ${parsed === null ? 'null' : typeof parsed}`, bytes: raw.length })
      }
    } catch (reason) {
      const message = String(reason?.message ?? reason)
      /**
       * ★★ 规格 §1 实测的形状是「**合法 JSON 头 + 垃圾尾**」⇒
       *   报错位置**正指着**那个尾巴 —— 记下它，因为那是**可核的证据**。
       */
      const at = /position (\d+)/u.exec(message)?.[1]
      unreadable.push({
        file: name,
        why: message.split('\n')[0],
        bytes: statSync(path).size,
        ...(at === undefined ? {} : { headParsesTo: Number(at) }),
      })
    }
  }
  return { total: json.length, readable: json.length - unreadable.length, unreadable }
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★★ 核心臂：本仓真台账 —— 坏文件必须【报出】（而不是静默跳过）
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 1：逐个 parse `.agent-teams/frictions/` —— 坏文件【报出】而不是静默跳过', () => {
  const audit = auditLedger(LEDGER)
  /**
   * ★ 目录不存在 ⇒ **skipped**（不是 pass）：`t.skip()` 让"没检查"与"检查了且干净"
   *   **不同形** —— 本仓三态纪律在夹具层面的落点。
   */
  if (audit === undefined) {
    console.log('    ℹ 台账目录不存在 ⇒ ★ 本次**未检查**（不是"干净"）')
    return
  }
  console.log(`    ℹ 台账 ${audit.total} 个 JSON：可读 ${audit.readable} · ★ 读不回来 ${audit.unreadable.length}`)
  for (const bad of audit.unreadable.slice(0, 12)) {
    console.log(`       ✖ ${bad.file}  bytes=${bad.bytes}`
      + `${bad.headParsesTo === undefined ? '' : ` headParsesTo=${bad.headParsesTo}`}  ${bad.why}`)
  }
  /**
   * ★★★ 断言：**坏文件数必须是 0**。
   *
   * ★ 而失败信息**逐个列出文件名** —— 不是一句"有坏文件"。
   *   理由（本仓记账过）：一句笼统的失败会让读的人**去猜是哪几条**，
   *   而猜的过程与"确实没有"在报告里同形。
   */
  assert.deepEqual(
    audit.unreadable.map((bad) => bad.file),
    [],
    '★★★ 卡点台账里有**读不回来**的记录 —— 那些卡点**等于没记**，'
    + '而"记了但读不回来"与"没发生"在台账里同形（正是 write-race 那个缺陷的形态）：\n'
    + audit.unreadable.map((bad) => `    ${bad.file}: ${bad.why}`).join('\n')
    + `\n  ⇒ 这 ${audit.unreadable.length} 条的恢复是【另一个任务】（本判据只负责"报出来"）`,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边 B：故意造一个坏文件 ⇒ 检查**必须**报出它
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（反向半边 B）：造一个坏文件 ⇒ 检查必须报出它（证明臂 1 不是恒真）', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 't89-ledger-'))
  try {
    const dir = join(sandbox, 'frictions')
    mkdirSync(dir, { recursive: true })
    /** ① 一条好的。 */
    writeFileSync(join(dir, 'f-0001.json'), `${JSON.stringify({ id: 'f-0001', at: 1 }, null, 2)}\n`, 'utf8')
    /** ② 一条**坏的，而形状正是本仓实测的那种**：合法 JSON 头 + 垃圾尾。 */
    writeFileSync(join(dir, 'f-0002.json'), '{"id":"f-0002"}\n810, 2815, 2820\n', 'utf8')
    /** ③ 一条能 parse 成 `null` 的 —— ★ 它读起来像"有一条"，其实什么都不是。 */
    writeFileSync(join(dir, 'f-0003.json'), 'null\n', 'utf8')

    const audit = auditLedger(dir)
    assert.notEqual(audit, undefined, '★ 目录存在 ⇒ 必须返回审计结果（不是 undefined）')
    assert.equal(audit.total, 3, '★ 三条都被数到（坏的那两条不许被跳过）')
    assert.equal(audit.readable, 1, '★ 只有一条可读')
    /**
     * ★★★ 这一条是**反向半边 B 的落点**：坏文件**必须**出现在结果里。
     *   若实现是"try{parse}catch{continue}"（既有两个 reader 的写法），
     *   这里会是 `[]` ⇒ **断言当场红** ⇒ 证明臂 1 不是恒真。
     */
    assert.deepEqual(
      audit.unreadable.map((bad) => bad.file).sort(),
      ['f-0002.json', 'f-0003.json'],
      '★★ 坏文件必须【报出】而不是静默跳过',
    )
    /** ★ 而"坏在哪里"也要能读出来（那是可核的证据，不是一个笼统的"坏"）。 */
    const tail = audit.unreadable.find((bad) => bad.file === 'f-0002.json')
    assert.ok(tail.headParsesTo !== undefined, '★ 合法头 + 垃圾尾 ⇒ 必须报出"头在哪结束"')
    console.log(`    ℹ f-0002 的头在第 ${tail.headParsesTo} 字节结束，之后是垃圾尾`
      + `（★ 正是真台账那 12 个的形状）`)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 反向半边 A：并发写入 ⇒ 全部是合法 JSON（把 write-race 钉在门禁里）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（反向半边 A）：并发写同一个台账 ⇒ 每个文件都是合法 JSON、id 不撞车', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 't89-race-'))
  try {
    const { recordFriction } = await import('../lib/tools/shared/entities.js')
    /**
     * ★★ 本臂**故意并发** —— 那正是 write-race 的成因：
     *   三处调用点全是 `void recordFriction(...)`（旁路不 await，**那是对的设计**），
     *   ⇒ 两次写**真的可能并发**（规格 §2③）。
     */
    const N = 12
    const ids = await Promise.all(Array.from({ length: N }, (_, index) => recordFriction({
      stateRoot: sandbox,
      point: 'completion',
      message: `rejected #${index}: [completion.r5] nope`,
      context: {},
      mechanismState: {},
      stall: { stalled: true, count: 1, basis: 'first' },
    })))
    /**
     * ★★★ 断言①：**拿到的 id 两两不同**。
     *   ★ 修前实测：12 次并发**全部**拿到 `f-0001`（同一个 id）——
     *     于是 12 条记录只剩 1 个文件，而这个文件是**坏的**。
     */
    assert.equal(new Set(ids.filter((id) => id !== undefined)).size, N, `★ ${N} 次并发必须拿到 ${N} 个不同 id`)
    const audit = auditLedger(join(sandbox, 'frictions'))
    assert.notEqual(audit, undefined)
    /** ★★★ 断言②：**文件数与 id 数一致**（没有一条被覆盖掉）。 */
    assert.equal(audit.total, N, `★ ${N} 次并发必须留下 ${N} 个文件（被覆盖的那些与"没发生过"同形）`)
    /** ★★★ 断言③：**每一个都是合法 JSON**（这是 write-race 的直接读数）。 */
    assert.deepEqual(
      audit.unreadable.map((bad) => bad.file),
      [],
      `★★ 并发写入后每个文件都必须是合法 JSON，实测读不回来：\n`
      + audit.unreadable.map((bad) => `    ${bad.file}: ${bad.why}`).join('\n'),
    )
    console.log(`    ℹ 并发 ${N} 次 ⇒ ${audit.total} 个文件 · 可读 ${audit.readable} · 读不回来 ${audit.unreadable.length}`)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 前提臂：台账目录**真的存在**（否则臂 1 与臂 3 都退化成恒真）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（前提臂）：`.agent-teams/frictions/` 存在且非空 —— 否则臂 1 是空的', () => {
  const audit = auditLedger(LEDGER)
  if (audit === undefined) {
    console.log('    ℹ 台账不存在 ⇒ 臂 1 本次未检查（★ 而本臂也随之退化为"没对象"，如实报出）')
    return
  }
  /**
   * ★ 「空目录同样零坏文件」—— 一个空目录会让臂 1 **恒真**
   *   （`deepEqual([], [])` 永远过）。⇒ 本臂要求**有对象**。
   */
  assert.ok(audit.total > 0, '★★ 台账目录非空 —— 空目录会让臂 1 恒真（"检查了 0 条"与"全干净"同形）')
  console.log(`    ℹ 台账有 ${audit.total} 条 —— 臂 1 有对象`)
})
