/**
 * ── ★★★ t107（最小实验③）：跨工作区【写】与取锁能不能成（t104 只验了读）──────────────
 *
 * ── 缺的那一格（t104 读数 ③ 逐字）────────────────────────────────────────────────
 *
 *   `teamLockKey(stateRoot, teamId) = team:${stateRoot}:${teamId}`
 *   `captainLockKey(stateRoot, capId) = captain:${stateRoot}:${capId}`  ← ★ 同形
 *   ⇒ 两个锁键都按 stateRoot 分 ⇒ 跨区写要拿【别的区】的锁 —— 而 t104 没验"能不能成"。
 *
 * ── 本夹具钉的六件事 ────────────────────────────────────────────────────────────
 *
 *   臂 0 ★ 先决条件自检：临时区真的建成了（PRECONDITION-DISCIPLINE ——
 *          建不成 ⇒ 后面什么都不许跑，**不许让断言跑出一个"看着像真的"读数**）
 *   臂 1 ★★ 主实验：从"本会话"对【另一个 stateRoot】取 `teamLockKey` 并完成一次写 ⇒ 能不能成
 *   臂 2 ★★ 反向半边 A：两个不同 stateRoot ⇒ 锁键必须【不同】（否则跨区写在同一把锁下竞争）
 *   臂 3 ★★ 反向半边 B：同一 stateRoot 同一 teamId ⇒ 锁键必须【相同】（否则同队并发写不再互斥）
 *          ★ A 与 B 方向相反，两条都要 —— 只有 A 会漏掉"锁键恒按 teamId 分"那种实现
 *   臂 4 ★ 三态不同形：写成 / 区不存在 / 区在但没那个队 —— 各自可读
 *   臂 5 ★★ t104 预警实测：拼错区名 ⇒ 看到的是"那个区没有队"还是"指错了区"
 *
 * ★★ 硬边界：全部用 `mkdtempSync` 造的临时区 —— **不碰任何真实区**（包括队长的与本工作区的）。
 * ★ 判据全部可编程（无截图）；写域 = 本夹具 + `docs/AGGREGATE-CAPTAIN.md` 追加节。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { teamLockKey, captainLockKey, stateRootOf } = await import('../lib/tools/shared/entities.js')
const { withTeamLock } = await import('../lib/state.js')
const { writeTeam, readTeam, createTeamDir } = await import('../lib/state.js')

/** 造两个临时 stateRoot（★ 全部临时，跑完删）。返回 `null` = 建区失败（先决条件失败）。 */
function twoTempRoots() {
  try {
    const rootA = mkdtempSync(join(tmpdir(), 't107-rootA-'))
    const rootB = mkdtempSync(join(tmpdir(), 't107-rootB-'))
    const stateDirA = join(rootA, '.agent-teams')
    const stateDirB = join(rootB, '.agent-teams')
    mkdirSync(stateDirA, { recursive: true })
    mkdirSync(stateDirB, { recursive: true })
    /** ★ 先决条件自检：目录必须真的存在且可写（PRECONDITION-DISCIPLINE 的"建目录若失败"那半）。 */
    if (!existsSync(stateDirA) || !existsSync(stateDirB)) return null
    return { rootA, rootB, stateDirA, stateDirB }
  } catch {
    /** ★ 任何异常 = 先决条件失败 ⇒ 返回 null，调用方什么都不输出。 */
    return null
  }
}

const cleanup = (roots) => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }) }

/** 一个最小可信的 TeamState（`coerceTeamState` 能收的形状）。 */
const minimalTeam = (id, name) => ({
  id, name,
  captainSessionId: 'cap-session',
  createdAt: 1,
  updatedAt: 1,
  phase: 'running',
  taskSeq: 0,
  members: [],
  tasks: [],
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 0 ★ 先决条件自检（失败 ⇒ 整个文件后续的臂全部 t.skip —— 什么都不输出假读数）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 0（先决条件自检）：临时区能建成、库能写入读出（否则后续臂全部无意义）', async (t) => {
  const roots = twoTempRoots()
  if (roots === null) {
    t.skip('PRECONDITION FAILED: mkdtemp/mkdir failed — no readings can be trusted this run')
    return
  }
  const { stateDirA } = roots
  try {
    /** ★ 先在区 A 真写真读一轮 —— 库这一层的写/读都不通的话，后面的"跨区"读数全是假的。 */
    await createTeamDir(stateDirA, minimalTeam('t0', 'Precheck'))
    const back = await readTeam(stateDirA, 't0')
    assert.notEqual(back, undefined, '★ 前提：同区写后必须能读回（否则是库坏了，不是跨区问题）')
    assert.equal(back.id, 't0')
  } finally {
    cleanup([roots.rootA, roots.rootB])
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★ 主实验：对【另一个 stateRoot】取锁并完成一次写
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（主实验）：对另一个 stateRoot 取 teamLockKey 并完成一次写 ⇒ 能成', async (t) => {
  const roots = twoTempRoots()
  if (roots === null) { t.skip('PRECONDITION FAILED'); return }
  const { rootA, rootB, stateDirA, stateDirB } = roots
  try {
    /** ★ 前提：两个区都得真的在盘上（对照 PRECONDITION-DISCIPLINE：不检查 = 后面读数可能变假）。 */
    assert.ok(existsSync(stateDirA) && existsSync(stateDirB), '★ 前提：两个临时 stateRoot 必须真实存在')

    /**
     * ★★ "从一个会话里"的可编程对应物：**先在区 A 写一个队并确认在**（那是"我们所在的区"），
     *   然后对【区 B】取 `teamLockKey(stateDirB, 'tX')` 并完成一次写。
     *   ★ 库层没有任何"当前会话"概念 —— 锁与写都只认 stateRoot ⇒ 这正是要验的。
     */
    await createTeamDir(stateDirA, minimalTeam('t-home', 'Home'))
    const home = await readTeam(stateDirA, 't-home')
    assert.notEqual(home, undefined, '★ 前提：本区（A）的队写成了 —— "我们在这里"成立')

    /**
     * ★★ 实测（t107 的第一格读数）：`writeTeam` **不**自动建队目录 ——
     *   `atomicWriteText` 直接 open `<stateRoot>/<teamId>/team.json.tmp…` ⇒ 对一个
     *   **空白的 stateRoot** 直接写会 ENOENT。生产路径里目录是 `createTeamDir` 建的。
     *   ⇒ 跨区写的完整链 = createTeamDir（若队不存在）→ 取锁 → writeTeam；
     *   ★ 本臂照生产链做，并把"不建目录直接写会 ENOENT"作为一条独立读数记下（臂 4）。
     */
    await createTeamDir(stateDirB, minimalTeam('t-cross', 'Cross'))

    /** ★★ 主读数：对【另一个区】取锁并在锁内完成一次写。 */
    const keyB = teamLockKey(stateDirB, 't-cross')
    assert.equal(typeof keyB, 'string', '★ 锁键是字符串')
    assert.ok(keyB.includes(stateDirB), `★ 锁键必须含【目标区】的 stateRoot（实测 ${keyB.slice(0, 40)}…）`)

    const written = { ...minimalTeam('t-cross', 'Cross'), note: 'written from another workspace' }
    let lockAcquired = false
    await withTeamLock(keyB, async () => {
      lockAcquired = true
      await writeTeam(stateDirB, written)
    })
    assert.equal(lockAcquired, true, '★★ 别区的锁【取到了】')

    /** ★ 写成必须可读回（否则"写成功"与"写丢"同形）。 */
    const back = await readTeam(stateDirB, 't-cross')
    assert.notEqual(back, undefined, '★★ 跨区写 ⇒ 在目标区读得回')
    assert.equal(back.id, 't-cross')
    assert.equal(back.note, 'written from another workspace')
    assert.ok(existsSync(join(stateDirB, 't-cross', 'team.json')), '★ team.json 真的落在目标区的盘上')

    /** ★ 而本区（A）的队不被波及。 */
    assert.notEqual(await readTeam(stateDirA, 't-home'), undefined, '★ 写 B 不影响 A 的队')
  } finally {
    cleanup([rootA, rootB])
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边 A：不同 stateRoot ⇒ 锁键不同（否则跨区写在同一把锁下竞争）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（反向半边 A）：两个不同 stateRoot ⇒ teamLockKey/captainLockKey 都必须【不同】', () => {
  const roots = twoTempRoots()
  if (roots === null) { t.skip('PRECONDITION FAILED'); return }
  const { stateDirA, stateDirB } = roots
  try {
    /** ★ teamLockKey：不同区 + 同 teamId ⇒ 键必须不同（键含 stateRoot 才分得开）。 */
    const keyA = teamLockKey(stateDirA, 't1')
    const keyB = teamLockKey(stateDirB, 't1')
    assert.notEqual(keyA, keyB, '★★ 反向半边 A：不同区的锁键相同 ⇒ 跨区写会在同一把锁下竞争（真缺陷）')
    assert.ok(keyA.includes(stateDirA) && keyB.includes(stateDirB), '★ 各自的键都含自己的区')
    /** ★ captainLockKey 同形（t104 读数 ③ 说它同形 ⇒ 它必须同样分得开）。 */
    const capA = captainLockKey(stateDirA, 'cap-session')
    const capB = captainLockKey(stateDirB, 'cap-session')
    assert.notEqual(capA, capB, '★ captainLockKey 同样必须按区分')
  } finally {
    cleanup([roots.rootA, roots.rootB])
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 反向半边 B：同一 stateRoot 同一 teamId ⇒ 锁键相同（并发互斥的前提）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（反向半边 B）：同一 stateRoot 同一 teamId ⇒ 锁键相同；且互斥真的在', async (t) => {
  const roots = twoTempRoots()
  if (roots === null) { t.skip('PRECONDITION FAILED'); return }
  const { stateDirA } = roots
  try {
    /** ★ 同区同队，两次取键 ⇒ 键必须【相同】（否则同队并发写不再互斥）。 */
    const key1 = teamLockKey(stateDirA, 't1')
    const key2 = teamLockKey(stateDirA, 't1')
    assert.equal(key1, key2, '★★ 反向半边 B：同区同队的锁键必须相同（互斥的前提）')
    /** ★ 而同区【不同队】⇒ 键不同（锁的粒度是队，不是区 —— 别把粒度弄粗）。 */
    assert.notEqual(key1, teamLockKey(stateDirA, 't2'), '★ 同区不同队 ⇒ 键不同（粒度=队）')

    /**
     * ★★ 互斥的**行为级**验证（光看键相等不够 —— 一个"每次新造 Map 键"的实现键也相等却不互斥）：
     *   同一把锁下排队两个临界区，断言它们【不重叠】。
     */
    const events = []
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const job = (tag) => withTeamLock(key1, async () => {
      events.push(`${tag}:enter`)
      await sleep(20)
      events.push(`${tag}:exit`)
    })
    await Promise.all([job('first'), job('second')])
    assert.deepEqual(events, ['first:enter', 'first:exit', 'second:enter', 'second:exit'],
      `★★ 同键两次取锁必须串行（实测顺序：${events.join(' → ')}）`)
  } finally {
    cleanup([roots.rootA])
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★ 三态不同形：写成 / 区不存在 / 区在但没那个队
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4：三态不同形 —— 写成 / 区不存在 / 区在但没那个队（读侧各自可读）', async (t) => {
  const roots = twoTempRoots()
  if (roots === null) { t.skip('PRECONDITION FAILED'); return }
  const { rootA, stateDirA, stateDirB } = roots
  try {
    /** ① 写成：先 createTeamDir（生产链），再取锁写，读回非 undefined。 */
    await createTeamDir(stateDirB, minimalTeam('t-ok', 'Ok'))
    await withTeamLock(teamLockKey(stateDirB, 't-ok'), async () => {
      await writeTeam(stateDirB, minimalTeam('t-ok', 'Ok'))
    })
    assert.notEqual(await readTeam(stateDirB, 't-ok'), undefined, '① 写成 ⇒ 读得回')
    /**
     * ★★ 读数（如实）：对**存在但空白**的 stateRoot 直接 writeTeam（不建队目录）⇒ ENOENT。
     *   ⇒ "跨区写"在库层的完整前置 = createTeamDir；锁与写本身都不建目录。
     *   ★ 这决定聚合入口的实现清单：锁内写之前必须有"确保队目录"那一步。
     */
    await assert.rejects(
      () => writeTeam(stateDirB, minimalTeam('t-never-made-dir', 'NoDir')),
      (error) => error.code === 'ENOENT',
      '★ writeTeam 不自动建队目录（对空白区直接写 ⇒ ENOENT）',
    )

    /** ② 区不存在：读一个【没建过目录】的 stateRoot ⇒ undefined。 */
    const ghostRoot = join(stateDirA, 'does-not-exist')
    assert.equal(existsSync(ghostRoot), false, '★ 前提：那个区真的不在盘上')
    assert.equal(await readTeam(ghostRoot, 't-any'), undefined, '② 区不存在 ⇒ undefined')

    /** ③ 区在但没那个队：同样 undefined —— ★ 与②同形（t104 读数②，本次在【写后】复测）。 */
    assert.notEqual(await readTeam(stateDirA, 't-home') ?? await readTeam(stateDirB, 't-ok'), undefined)
    assert.equal(await readTeam(stateDirA, 't-never-created'), undefined, '③ 区在、队不在 ⇒ undefined（与②同形，t104 读数②复现）')

    /**
     * ★★ 而【写侧】的三态有各自可读的形状：
     *   · 写成一个存在的区 ⇒ team.json 落盘；
     *   · 写进一个不存在的区 ⇒ **writeTeam 的 atomicWriteText 会不会自动建目录** ——
     *     ★★ 这正是"拼错区名"实测的一部分（见臂 5 的读取读数 + 本臂的落盘事实）。
     */
    const misspelledRoot = join(tmpdir(), 't107-rootA-typo')   // ★ 临时区拼错的形状（不是真实区）
    try {
      /**
       * ★★ 实测（与臂 4 开头那条 ENOENT 读数一致）：writeTeam **不**自动建父目录 ⇒
       *   拼错区名 = **抛 ENOENT**（不是"静默建出一个新区"）。
       *   ⇒ 写侧"指错了区"是【可读的】—— 比读侧好（读侧三种"错"同形，见臂 5）。
       *   ★ 用 assert.rejects 钉死这个方向：将来若 writeTeam 改成自动建目录，这里当场红
       *     （那将是【静默建出新区】的回归 —— 必须有人看见）。
       */
      await assert.rejects(
        () => withTeamLock(teamLockKey(misspelledRoot, 't-typo'), async () => {
          await writeTeam(misspelledRoot, minimalTeam('t-typo', 'Typo'))
        }),
        (error) => error.code === 'ENOENT',
        '★ 实测：writeTeam 不自动建父目录 ⇒ 拼错区名 = 抛 ENOENT（"指错了区"在写侧可读）',
      )
      assert.equal(existsSync(join(misspelledRoot, 't-typo', 'team.json')), false,
        '★ 拼错的区上没有落下任何文件（没有静默建区）')
    } finally {
      rmSync(misspelledRoot, { recursive: true, force: true })
    }
  } finally {
    cleanup([rootA])
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ t104 预警实测：拼错区名 ⇒ 看到的是"那个区没有队"还是"指错了区"？
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5（t104 预警实测）：拼错区名【读侧】的读数 —— 与"区里没那个队"同形还是可分辨？', async (t) => {
  const roots = twoTempRoots()
  if (roots === null) { t.skip('PRECONDITION FAILED'); return }
  const { stateDirA, stateDirB } = roots
  try {
    await createTeamDir(stateDirA, minimalTeam('t-real', 'Real'))
    /** ★ 前提：真的有一个队（否则"没那个队"的读数没有对象）。 */
    assert.notEqual(await readTeam(stateDirA, 't-real'), undefined)

    /**
     * ★★ 拼错区名 = 把 stateRoot 写错（一个真实存在其它内容的目录，但不存在的 stateRoot）。
     *   ★ 用 tmpdir 下一个【真的存在但不存在的区】的路径 —— 与"凭空捏造的路径"分开测。
     */
    const existingButWrongRoot = mkdtempSync(join(tmpdir(), 't107-wrong-root-'))
    try {
      /** ① 拼错的区【不存在】⇒ 读侧 undefined —— 与"区在没队"同形？（t104 说同形，实测复认） */
      const readGhost = await readTeam(existingButWrongRoot, 't-real')
      assert.equal(readGhost, undefined, '① 拼错区（不存在）⇒ undefined')

      /** ② 而【凭空捏造】的路径同样 undefined ⇒ 两种"错"在读侧同形。 */
      const readFabricated = await readTeam(join(stateDirB, 'no-such-subdir'), 't-real')
      assert.equal(readFabricated, undefined, '② 凭空子路径 ⇒ undefined（同样）')

      /**
       * ★★★ 实测结论（写进交付文档）：读侧两种"错"与"区里没那个队"**三者同形**
       *   （都是 undefined，错误码 ENOENT 在 state.ts 的 catch 里合流）。
       *   ★ 而这正是 t104 预警的实锤：**聚合入口若只看 readTeam 的返回值，
       *     "指错了区"会被读成"那个区没有队"** ⇒ 需要人裁定（甲 statSync / 乙改返回）。
       *
       * ★ 但**写侧** today 的形状是**实测出来的**（臂 4 已落）：若 atomicWriteText 自动建目录，
       *   拼错的区名会**静默建出一个新区** —— 那比读侧更危险（不是"没写进去"，是"写进了错的地方"）。
       *   ⇒ 本臂只把读数固定下来；修法选哪条（甲/乙）是产品决策，不归本实验。
       */
      const readCorrect = await readTeam(stateDirA, 't-real')
      assert.notEqual(readCorrect, undefined, '★ 对照：正确区名 ⇒ 读得到（排除"库坏了"）')
    } finally {
      rmSync(existingButWrongRoot, { recursive: true, force: true })
    }
  } finally {
    /** ★ cleanup 精确清两个临时根。 */
    cleanup([stateDirA, stateDirB])
  }
})
