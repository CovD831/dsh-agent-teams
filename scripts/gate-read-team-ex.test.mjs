#!/usr/bin/env node
/**
 * ── 判据：`readTeamEx` 的三态**真的分得开**（t108）────────────────────────────────────
 *
 * ── 它防的是什么 ────────────────────────────────────────────────────────────────
 *
 * `readTeam` 把**两件不同的事**压成同一个 `undefined`：
 * ```
 *   ① 区（`stateRoot` 这个目录）**根本不存在**
 *   ② 区在，但**里面没有这个队**
 * ```
 * ★ 而它们的补救动作**相反**：① 是"你连地方都找错了"（配置 / 工作区选错），
 *   ② 是"那个队确实不在了"（被归档 / 从没建过）。
 *
 * ── ★★★ 而本文件最要紧的一条是【坑①】的机械证明 ──────────────────────────────────
 *
 * ```
 *   A 区不存在        ⇒ readFile("<root>/NO-REGION/team.json") ⇒ code ENOENT
 *   B team.json 不存在 ⇒ readFile("<root>/REGION/team.json")   ⇒ code ENOENT
 *   ★★ 两者 code 相同 ⇒ 靠 code 分辨不出来
 * ```
 * ⇒ 所以实现**必须先 `stat` 那个目录、再 `readTeam`**。
 * ★ 臂 1 把这一格**直接测出来**（不是靠读源码相信它）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { readTeamEx, readTeam } = await import('../lib/state.js')

/** 造一个临时 state root。 */
async function region() {
  return await mkdtemp(join(tmpdir(), 't108-'))
}

/** 一份最小的合法 team 记录（够 `coerceTeamState` 认出来即可）。 */
const minimalTeam = (id) => ({
  id,
  name: id,
  captainSessionId: 'cap',
  createdAt: 1,
  taskSeq: 1,
  members: [],
  tasks: [],
})

/** 把一份 team 落到 `stateRoot/<id>/team.json`。 */
async function putTeam(stateRoot, id) {
  await mkdir(join(stateRoot, id), { recursive: true })
  await writeFile(join(stateRoot, id, 'team.json'), JSON.stringify(minimalTeam(id), null, 2), 'utf8')
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 1：★★★ 坑① —— **两种缺失的错误码相同**（这是"必须先判区"的全部理由）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★★ 臂 1（坑①）：区缺失与 team.json 缺失 ⇒ **同一个 ENOENT**（所以不能靠 code 分辨）', async () => {
  const root = await region()
  try {
    /** ★ A：区**根本不存在**。 */
    let codeA
    try {
      await readFile(join(root, 'NO-SUCH-REGION', 'team.json'), 'utf8')
    } catch (error) {
      codeA = error.code
    }
    /** ★ B：区**在**，但没有 `team.json`。 */
    await mkdir(join(root, 'REGION'), { recursive: true })
    let codeB
    try {
      await readFile(join(root, 'REGION', 'team.json'), 'utf8')
    } catch (error) {
      codeB = error.code
    }
    assert.equal(codeA, 'ENOENT', '★ 前置：A 必须是 ENOENT')
    assert.equal(codeB, 'ENOENT', '★ 前置：B 必须是 ENOENT')
    assert.equal(codeA, codeB,
      '★★ 两种缺失的错误码**相同** —— 这就是为什么实现**必须先 stat 那个目录、再 readTeam**，'
      + '而不是去 catch `readTeam` 的 ENOENT 再猜来源')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 2：★★★ 反向半边 A —— **区不存在** ⇒ `no-region`
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★★ 臂 2（反向半边 A）：区不存在 ⇒ 必须是 `no-region`', async () => {
  const root = await region()
  try {
    const result = await readTeamEx(join(root, 'NO-SUCH-REGION'), 'T')
    assert.equal(result.kind, 'no-region',
      '★★ 区不存在 ⇒ `no-region` —— 补救动作是"去查路径/配置"，'
      + '而 `no-team` 的补救动作是"那个队确实不在了"，两者**不同形**')
    assert.equal('team' in result, false, '★ `no-region` 不许带 `team`（它不是 found）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 3：★★★ 反向半边 B —— **区在但没有那个队** ⇒ `no-team`
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★★ 臂 3（反向半边 B）：区在但没有那个队 ⇒ 必须是 `no-team`（与 A **不同形**）', async () => {
  const root = await region()
  try {
    /**
     * ★ 区**存在**（把 root 本身当区，它当然在），而里面**没有** `T`。
     *   ⇒ 这一格必须是 `no-team`。
     */
    const result = await readTeamEx(root, 'T')
    assert.equal(result.kind, 'no-team',
      '★★ 区在、队不在 ⇒ `no-team` —— 与臂 2 的 `no-region` **必须是两个值**')
    /** ★★ 而这一臂的**实质**是"它不等于 A"：把它们合成一个值，本判据就没有理由存在。 */
    const noRegion = await readTeamEx(join(root, 'NO-SUCH-REGION'), 'T')
    assert.notEqual(result.kind, noRegion.kind,
      '★★★ A 与 B **必须不同形** —— 那正是本任务的全部理由')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 4：★★★ 反向半边 C —— **区在、队也在** ⇒ `found` 且带回 `team`
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★★ 臂 4（反向半边 C）：区在、队也在 ⇒ 必须是 `found` 且带回 `team`', async () => {
  const root = await region()
  try {
    await putTeam(root, 'T')
    const result = await readTeamEx(root, 'T')
    assert.equal(result.kind, 'found',
      '★★ 正常路径不许被判别弄坏 —— 加了"先 stat 再 read"之后，'
      + '"找得到"这一格必须**仍然**是 `found`')
    assert.equal(result.team?.id, 'T', '★ 而且它必须把 **team 真的带回来**（不是只报 found）')
    assert.equal(result.team?.captainSessionId, 'cap', '★ 带回的是**完整记录**，不是空壳')
    /** ★ 对照：它与 `readTeam` 在同一情形下必须给同一条记录。 */
    const viaOld = await readTeam(root, 'T')
    assert.deepEqual(result.team, viaOld,
      '★ `readTeamEx` 在"找得到"这一格必须与 `readTeam` **给出同一条记录**（不许分叉）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 5：★★ 三态**两两不同形**（本判据声称的全部范围）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 臂 5：三种情形 ⇒ 三个**互不相同**的值', async () => {
  const root = await region()
  try {
    await putTeam(root, 'T')
    const found = await readTeamEx(root, 'T')
    const noTeam = await readTeamEx(root, 'NOPE')
    const noRegion = await readTeamEx(join(root, 'NO-SUCH-REGION'), 'T')
    const kinds = [found.kind, noTeam.kind, noRegion.kind]
    assert.deepEqual(kinds, ['found', 'no-team', 'no-region'],
      `★ 三态必须各自出现（实测 ${JSON.stringify(kinds)}）`)
    assert.equal(new Set(kinds).size, 3, '★★ 三个值互不相同')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 6：★★ `readTeam` **一字不动**（本任务最重要的边界，机械形式）
 * ───────────────────────────────────────────────────────────────────────────── */

test('★★ 臂 6（硬边界①）：`readTeam` 对"区不在"与"队不在"**仍然**都返回 `undefined`', async () => {
  const root = await region()
  try {
    /**
     * ★★ 这条断言的意义不是"`readTeam` 行为对不对"，而是
     *   **"它没有被改成三态"** —— 若有人为了复用而把它改成返回一个判别对象，
     *   那 28 处调用会**全部**拿到一个 object（而不是 `undefined`），
     *   而 `if (team === undefined)` 会**恒为假** ⇒ **静默地把"没有队"读成"有队"**。
     *   ⇒ 本臂钉住那个形状。
     */
    const absent = await readTeam(join(root, 'NO-SUCH-REGION'), 'T')
    const noTeam = await readTeam(root, 'NOPE')
    assert.equal(absent, undefined,
      '★★ `readTeam` 对"区不在"必须**仍然**返回 `undefined`（不是判别对象）—— '
      + '★ 若它变成对象，28 处 `if (team === undefined)` 会恒假')
    assert.equal(noTeam, undefined, '★ 对"队不在"同样仍是 `undefined`')
    /** ★ 而"找得到"那一格也必须照旧给记录（没被改坏）。 */
    await putTeam(root, 'T')
    const present = await readTeam(root, 'T')
    assert.equal(present?.id, 'T', '★ 正常路径照旧')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/* ─────────────────────────────────────────────────────────────────────────────
 * 臂 7：★ 区是一个**文件**（不是目录）⇒ `no-region`，而不是抛
 * ───────────────────────────────────────────────────────────────────────────── */

test('★ 臂 7：`stateRoot` 是一个**文件**（不是目录）⇒ `no-region`，不许抛', async () => {
  const root = await region()
  try {
    /**
     * ★ 若实现只 `stat` 而**不看 `isDirectory`**，`readTeam` 会拿到 **ENOTDIR**
     *   （**不是** ENOENT）而**抛出去** ⇒ "路径写成了一个文件"会变成一次异常，
     *   而它与"区不在"是**同一类**问题（路径错了）。
     */
    const filePath = join(root, 'not-a-region')
    await writeFile(filePath, 'i am a file, not a directory', 'utf8')
    const result = await readTeamEx(filePath, 'T')
    assert.equal(result.kind, 'no-region',
      '★ `stateRoot` 不是目录 ⇒ `no-region`（那一格与"区不存在"同归宿，都是"路径不对"）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
