/**
 * ── `team.shape` 的臂（2026-10-20，用户裁定乙方案）────────────────────────────────
 *
 * ── 它修的是什么（用户原话，逐字）────────────────────────────────────────────────
 *
 * > 「你这个建团 是用早期插件的形态建的 而不是后来我规定的形态
 * >   而且关于这个问题 其实我已经做过修复了 但显然并没有起效」
 *
 * 前一次修复（`81d08df`）把"派临时工"从**不可能**变成**可能**：
 * 开了 `plan.members[].executionPrompt` 通道，并在 `TEAM_MEMBER_PROMPT` 末尾加了
 * 一句**条件句** ——`If your persona delegates the work to helpers, spawn subagents…`。
 *
 * ★★ 而 `src/capabilities.ts` 的注释自己写下了它的边界：
 *   「这一段只把"人设说了要派"这件事从【不可能】变成【可能】。」
 *   ⇒ **条件的前件由谁提供？没有人负责。**
 *
 * MEASURED（本队普查，可复跑）：8 个队里只有 **2 个**的人设提到了派临时工
 * （`mutation-quality` 6 员中 2 个、`overnight-registration-hardening` 3 员中 2 个），
 * 其余 5 个（含本轮那个 `self-iteration-3`）全是**早期形态**。
 * 而后果是实测的：**三个成员的会话先后烧穿 100 万 token 上限**
 * （`CONTEXT_WINDOW_EXCEEDED`，见 `docs/DEFECT-VERIFY-RERUN-WRONG-CWD.md` 附录）。
 *
 * ── 乙方案怎么修 ────────────────────────────────────────────────────────────────
 *
 * `team.json` 落一个 `shape: 'dispatch' | 'flat'`，`capabilities.ts` 按它选提示：
 *   `'dispatch'` ⇒ `TEAM_DISPATCH_MEMBER_PROMPT`（**命令式**：你就是派工点）
 *   `'flat'` / **缺席** ⇒ `TEAM_MEMBER_PROMPT`（原条件式 = 今天的行为）
 *
 * ★★ 为什么缺席落回**原行为**而不是落回 `'dispatch'`：
 *   存量 8 个队里 5 个是早期形态，若缺席默认成派工点，它们的成员会突然
 *   被告知"别自己干" —— 一次静默的**行为改写**，且发生在存量数据上。
 *   缺席 = 判不了 ⇒ 退回已经跑过的那个行为，并由这一格的可读性把事实报出去。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { TEAM_MEMBER_PROMPT, TEAM_DISPATCH_MEMBER_PROMPT, memberPromptFor } = await import(join(ROOT, 'lib', 'capabilities.js'))
const { createTeamDir, readTeamSync, writeTeam } = await import(join(ROOT, 'lib', 'state.js'))

/** 一个最小的、能被 `isTeamState` 接受的 team 记录。 */
const baseTeam = (patch) => ({
  name: 'shape-team', id: 'shape-team', captainSessionId: 'captain-1',
  createdAt: 1792440000000, taskSeq: 0,
  members: [{ id: '', name: 'worker', role: 'w', provider: 'p', model: 'm', reasoningEffort: 'default', joinedAt: 1792440000000, status: 'idle' }],
  tasks: [],
  ...patch,
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：两条提示必须是**不同的两条**，且 dispatch 那条不许是条件句
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 1：dispatch 提示是**命令式**的，不再是「若你的人设说要派」', () => {
  assert.notEqual(
    TEAM_DISPATCH_MEMBER_PROMPT, TEAM_MEMBER_PROMPT,
    '★★ 两条必须是不同的文本 —— 若相同，`shape` 这一格在读数上没有效果',
  )

  /**
   * ★ 这一条是本缺陷的**形状本身**：原来的提示让"派不派"取决于人设的措辞，
   *   而人设由每个建团的人自由撰写 ⇒ 5/8 的队没写 ⇒ 条件永远为假。
   *   ⇒ `dispatch` 那条必须**不含**那个条件句，否则它只是同一件事的复述。
   */
  assert.equal(
    TEAM_DISPATCH_MEMBER_PROMPT.includes('If your persona delegates'),
    false,
    '★★ dispatch 那条不许包含条件句 —— 那正是"没起效"的那个前件',
  )

  /**
   * ★ 而它必须**明说自己是什么形态**：读提示的人（成员）与读日志的人（人）
   *   都要能一眼看出这是一支派工点形态的队，而不是"某种可能派活的队"。
   */
  assert.match(
    TEAM_DISPATCH_MEMBER_PROMPT, /DISPATCH TEAM/u,
    '★ dispatch 那条必须明说自己是什么形态',
  )

  /**
   * ★ 而它必须**说清为什么**（"别自己干"是一个要求，不是一个理由）：
   *   本队的实测理由就是成员会话会烧穿上下文。成员读到理由才会照做。
   */
  assert.match(
    TEAM_DISPATCH_MEMBER_PROMPT, /context (window|length)/iu,
    '★ dispatch 那条必须给出理由（上下文会烧穿），否则它与一句口号同形',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★ 三态 —— 写了 dispatch / 写了 flat / 缺席，三者在盘上不同形
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 2：`shape` 三态在盘上不同形，且**非法值真的被校验器拒**', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shape-'))
  try {
    /**
     * ★★★ 这一臂必须**真的走一遍校验器**，而不是只看对象字面量。
     *
     * MEASURED（本臂第一版就是这么错的）：第一版只断言
     *   `baseTeam({shape:'dispatch'}).shape === 'dispatch'`
     * —— 那测的是"我给这个字面量赋了个值"，与 `isTeamState` 一点关系都没有。
     * 定向突变（把校验器放宽到接受 `'flatty'`）**零条红**，就是它抓到的。
     * ⇒ 现在改成：每个值都走一次 `createTeamDir` + `readTeamSync`，
     *   而"非法值被拒"必须是**读回来时那一条**的表现。
     */
    const roundTrip = async (id, shape) => {
      const team = baseTeam({ id, name: id, ...shape === undefined ? {} : { shape } })
      await createTeamDir(root, team)
      /**
       * ★ `readTeamSync` 走 `coerceTeamState`/`isTeamState`
       *   ⇒ 它接受不了的记录会返回 `undefined`，而不是抛。
       *   ★ 这正是"非法值被拒"可观测的那一侧：一条**写下去但读不回来**的记录，
       *     比一条当场抛的记录更危险 —— 它会在下一次重启时变成"这个队不见了"。
       */
      return { written: team, back: readTeamSync(root, id) }
    }

    for (const shape of ['dispatch', 'flat']) {
      const { written, back } = await roundTrip(`ok-${shape}`, shape)
      assert.ok(back !== undefined, `★ shape='${shape}' 必须读得回来`)
      assert.equal(back.shape, shape, `★ shape='${shape}' 必须原样读回`)
      assert.equal(written.shape, shape)
    }

    const absent = await roundTrip('ok-absent', undefined)
    assert.ok(absent.back !== undefined, '★ 缺席 shape 的队必须读得回来（存量队）')
    assert.equal('shape' in absent.back, false, '★ 缺席就是缺席，不许被补成任何一态')

    /**
     * ★★ 非法值：**必须读不回来**（`undefined`）。
     *   若它被"清洗"成一个合法值，那么"我写错了一个字"与"我声明了那个形态"
     *   在盘上同形 —— 而那正是本仓反复记的那类合流。
     */
    for (const bogus of ['flatty', 'Dispatch', 42]) {
      /**
       * ★★ `readTeamSync` 对非法状态是**抛**（不是返回 `undefined`）——
       *   实测：`Error: invalid AgentTeams state in team "bad-flatty"`。
       *   ★ 这比我原本预期的**更好**：一个静默返回 `undefined` 的实现会让
       *     "这个队状态非法"与"这个队不存在"同形，而前者要人去修数据、
       *     后者只要去别处找。**抛**把这两件事分开了。
       *   ⇒ 本臂断言的就是"它抛"，而不是"它返回 undefined"。
       */
      await assert.rejects(
        () => roundTrip(`bad-${String(bogus)}`, bogus),
        /invalid AgentTeams state/u,
        `★★ shape=${JSON.stringify(bogus)} 必须被拒（读回时抛 invalid AgentTeams state）`
          + ' —— 非法值不许被静默清洗成合法值',
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★★ 落盘 + 读回 —— `shape` 真的进 team.json，不是只活在参数里
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 3（落盘臂）：`shape` 真的写进 team.json 并能读回来', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shape-disk-'))
  try {
    for (const shape of ['dispatch', 'flat', undefined]) {
      const team = baseTeam({
        id: `shape-${shape ?? 'absent'}`,
        name: `shape-${shape ?? 'absent'}`,
        ...shape === undefined ? {} : { shape },
      })
      /**
       * ★ 先 `createTeamDir` 再 `writeTeam` —— `writeTeam` 只写文件，
       *   它假设目录已存在（`createTeamDir` 才建目录）。
       *   ★ 夹具踩这一步是**对的**：真实建队路径也是这两个动作分开的，
       *     若夹具绕过它，就测不到"目录都没建起来时 writeTeam 会怎样"。
       */
      await createTeamDir(root, team)
      await writeTeam(root, team)
      /**
       * ★ 读回来必须是**同一个值**（或同一个缺席）：
       *   若 `coerceTeamState` 把它清掉了，成员提示就永远落回条件式那条 ——
       *   而那正是本缺陷要治的"没起效"，只不过换了一个原因。
       */
      const back = readTeamSync(root, team.id)
      assert.ok(back !== undefined, `★ ${team.id} 必须读得回来`)
      assert.equal(back.shape, shape, `★ ${team.id} 的 shape 读回来必须与写进去的一致`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★ 反向半边 —— 存量队（无 shape）不许被读成 dispatch
// ─────────────────────────────────────────────────────────────────────────────
test('★★ 臂 4（反向半边）：`shape` 缺席**不得**被读成 `dispatch`', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shape-legacy-'))
  try {
    /**
     * ★ 这一臂对着**本格上线前的真实形态**：一个没有 `shape` 的队。
     *   若某个实现把它默认为 `'dispatch'`，那 8 个存量队（实测 5 个是早期形态）
     *   的成员会突然被告知"别自己干" —— 一次静默的行为改写。
     */
    const legacy = baseTeam({ id: 'legacy-team', name: 'legacy-team' })
    await createTeamDir(root, legacy)
    await writeTeam(root, legacy)
    const back = readTeamSync(root, 'legacy-team')
    assert.ok(back !== undefined)
    assert.equal(
      back.shape, undefined,
      '★★ 缺席必须仍是缺席 —— 补一个默认值会让"判不了"与"确实是 dispatch"同形',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★ 长度预算 —— 两条提示都不许无限长
// ─────────────────────────────────────────────────────────────────────────────
test('★ 臂 5：两条提示都在长度预算内（提示进的是每个成员的系统面）', () => {
  /**
   * ★ `scripts/capabilities.test.mjs` 断言 `TEAM_MEMBER_PROMPT < 600` 字节
   *   （因为它是**每个成员**的系统提示，长度是真成本）。
   *   这里给 dispatch 那条一个同量级的预算 —— 它同样进每个成员的系统面。
   *   ★ 而它比后者长是**有理由的**：它要说清"是什么形态 / 做什么 / 为什么"，
   *     而那三件事缺一件，成员就可能照旧自己干。
   */
  assert.ok(
    Buffer.byteLength(TEAM_MEMBER_PROMPT) < 600,
    `★ TEAM_MEMBER_PROMPT 必须 < 600 字节（实测 ${Buffer.byteLength(TEAM_MEMBER_PROMPT)}）`,
  )
  assert.ok(
    Buffer.byteLength(TEAM_DISPATCH_MEMBER_PROMPT) < 1200,
    `★ TEAM_DISPATCH_MEMBER_PROMPT 必须 < 1200 字节（实测 ${Buffer.byteLength(TEAM_DISPATCH_MEMBER_PROMPT)}）`
      + ' —— 它进每个成员的系统面，长度是真成本',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★★★ 选择臂 —— `shape` 真的**决定了**发哪条提示
// ─────────────────────────────────────────────────────────────────────────────
test('★★★ 臂 6（选择臂）：`shape` 真的决定发哪条提示；缺席落回原行为', () => {
  /**
   * ★★★ 这一臂补的是臂 1 的一个洞。
   *
   * MEASURED（本任务的定向突变）：臂 1 只断言"两条提示不同"，
   * 而把 `capabilities.ts` 里的选择逻辑**短路成永远返回 `TEAM_MEMBER_PROMPT`** 时，
   * 臂 1~5 **零条红** —— 因为没有任何臂问过"这一次到底发了哪一条"。
   * ⇒ 一个只检查"两个常量不相等"的臂，与一个检查"选择真的发生了"的臂，
   *   在**常量没变**的时候同形，在**选择坏掉**时分形。
   *
   * ★ 而这也是为什么选择逻辑被抽成 `memberPromptFor` 这个**导出的纯函数**：
   *   写在 `ctx.systemPrompt.section` 的 `text` 回调里，就没有任何臂够得着它。
   */
  assert.equal(memberPromptFor('dispatch'), TEAM_DISPATCH_MEMBER_PROMPT, '★★ dispatch ⇒ 派工点提示')
  assert.equal(memberPromptFor('flat'), TEAM_MEMBER_PROMPT, '★ flat ⇒ 条件式提示（成员自己实现）')

  /**
   * ★★ 三态里最要紧的一格：**缺席**。
   *   存量 8 个队没有这一格，其中 5 个实测是早期形态。
   *   若缺席落成 `'dispatch'`，它们的成员会突然被告知"别自己干" ——
   *   一次**静默的行为改写**，而且发生在没人改过它们的数据上。
   */
  assert.equal(
    memberPromptFor(undefined), TEAM_MEMBER_PROMPT,
    '★★ 缺席必须落回【今天的行为】—— 不许落成一个新默认值',
  )

  /**
   * ★ 反向半边：`dispatch` 那一支必须**真的不一样**。
   *   若某天有人把两条常量改成同一串，上面两条 assert 仍然会过
   *   （因为比的是同一个常量）—— 所以这里直接比内容。
   */
  assert.notEqual(memberPromptFor('dispatch'), memberPromptFor(undefined), '★ 两支必须不同形')
})
