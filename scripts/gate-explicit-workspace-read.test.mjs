/**
 * ── ★★★ t109：一个只读工具能【点名】已注册的工作区 —— 而审计与能力一起上 ──────────────
 *
 * 用户裁定（逐字）：「我需要一个**权限非常大的主会话**，它可以**操纵不同的工作区**。」
 * ★★ 而本仓纪律：「**能操作任何区**」与「**不知道它操作了哪个**」是**两件事** ——
 *   前者是能力，后者是缺陷 ⇒ ★★★ **所以能力与审计一起落。**
 *
 * ── 三条反向半边（方向各不同，缺一不可）──────────────────────────────────────
 *   臂 1（A）：★ 指名**未注册**的区 ⇒ **拒绝并给理由**，不许静默落到自己那个
 *   臂 2（B）：★ **不传** ⇒ 必须仍操作**调用者自己**那个区（默认不动）
 *   臂 3（C）：★ 指名**自己**那个区 ⇒ 必须与不传时**同形**
 *
 * ★ 另钉两条本任务的硬边界：
 *   臂 4：审计记录**含目标区标识**（没有它「操作了哪个区」无从回答）
 *   臂 5：审计的 `action` 是**单件事**（不然多件事在台账里同形）
 *
 * ★★ 本夹具驱动**真实的 `resolveTargetWorkspace`**（不是复算它的逻辑）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { appendWorkspaceAuditRecord, readWorkspaceAuditRecords, registeredWorkspaceTitle, resolveTargetWorkspace } = await import('../lib/tools/shared/entities.js')
const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

/** 一个最小的调用者：`workspaceOf` 只读 `session.header.cwd`。 */
const callerAt = (cwd) => ({ session: { header: { cwd } } })

/** 一个最小的插件上下文：只提供 `get` —— 这正是 `workspaceRegistryOf` 用到的那一格。 */
const contextWith = (registry) => ({ get: (key) => (key === 'workspaceRegistry' ? registry : undefined) })

/** 两个已注册的工作区（`path` 是落点，`title` 是显示名 —— 两者**不同**，用来测"同形"）。 */
const REGISTRY = {
  list: () => [
    { path: '/ws/self', title: 'self-project' },
    { path: '/ws/other', title: 'other-project' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 反向半边 B：不传 ⇒ 仍操作【调用者自己那个】区
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（反向半边 B）：不传 workspace ⇒ 仍落在【调用者自己】那个区', () => {
  const caller = callerAt('/ws/self')
  const result = resolveTargetWorkspace(contextWith(REGISTRY), caller, undefined)
  /**
   * ★★★ 这一条是本任务的**第一验收**：改了默认会**静默影响所有既有调用**。
   *   ★ 而实现上它由"不传时**委托给 `workspaceOf(caller)`**"保证 ——
   *     不是"另写一遍同样的推导"（那样两处会分叉）。
   */
  assert.equal(result.workspace, '/ws/self', '★★ 不传 ⇒ 调用者自己那个区（默认一字不改）')
  assert.equal(result.explicit, false, '★ 且标记为"没点名"')
  /** ★ 而**注册表取不到**时，不传这一支**照旧工作**（老路径不许因为新功能而失败）。 */
  const noRegistry = resolveTargetWorkspace(contextWith(undefined), caller, undefined)
  assert.equal(noRegistry.workspace, '/ws/self', '★★ 注册表不可用 ⇒ 不传这一支仍然正常（硬边界①）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★ 反向半边 A：未注册 ⇒ 拒绝并给理由（绝不静默回退）
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（反向半边 A）：指名【未注册】的区 ⇒ 拒绝并给理由，不许静默落到自己那个', () => {
  const caller = callerAt('/ws/self')
  const ctx = contextWith(REGISTRY)
  /**
   * ★★★ 这是本函数存在的理由：若未注册时**静默回退**，
   *   那么「**点错了一个区**」与「**没点名**」在读端**完全同形** ——
   *   而前者在"权限很大的主会话"上是最容易犯的错（跨区操作打错一个字）。
   */
  assert.throws(
    () => resolveTargetWorkspace(ctx, caller, '/ws/nope'),
    (error) => {
      const message = String(error.message)
      /** ★ 必须**说清是哪一个**名字点错了（不是笼统的"失败"）。 */
      assert.match(message, /\/ws\/nope/, '★ 理由里必须含那个被点错的名字')
      /** ★ 必须给出**出路**（不传 = 用自己那个）—— 否则调用者只能再猜一次。 */
      assert.match(message, /omit the parameter/i, '★ 必须告诉调用者怎么办')
      /** ★ 并**列出可选项** —— "点错了"最常见的成因是记错名字。 */
      assert.match(message, /registered:/, '★ 必须列出已注册的区（不要把调用者留在猜里）')
      return true
    },
    '★★ 未注册必须拒绝',
  )
  /** ★ 反证：**不许**静默返回自己那个（那正是本条要挡的形态）。 */
  let fellBack = false
  try { resolveTargetWorkspace(ctx, caller, '/ws/nope') } catch { fellBack = true }
  assert.equal(fellBack, true, '★★ 必须是"抛"，不是"回退到 /ws/self"')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 ★★ 反向半边 C：指自己那个 ⇒ 与不传【同形】
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3（反向半边 C）：指名【自己】那个区 ⇒ 与不传时【同形】', () => {
  const caller = callerAt('/ws/self')
  const ctx = contextWith(REGISTRY)
  const omitted = resolveTargetWorkspace(ctx, caller, undefined)
  const explicitSelf = resolveTargetWorkspace(ctx, caller, '/ws/self')
  /**
   * ★★★ MEASURED（我第一版踩到）：不传时把 `title` 填**路径**、指名时填**注册表 title**
   *   ⇒ 同一个区两种输入得到 `title:'/ws/self'` 与 `title:'self-project'` ⇒ **不同形**。
   *   ★ 而 `title` 会进**审计记录** ⇒ 台账里会出现"两条不同的操作"，而它们是同一件事。
   * ⇒ 修法：两支的 `title` **都从注册表取**（同一个来源）。
   */
  assert.equal(explicitSelf.workspace, omitted.workspace, '★★ 落点必须相同')
  assert.equal(
    explicitSelf.title, omitted.title,
    '★★★ title 也必须相同 —— 否则同一件事在审计台账里长出两个名字',
  )
  /** ★ 而两者**唯一**该有的区别是"要不要记审计" —— 那是 `explicit`。 */
  assert.equal(omitted.explicit, false, '★ 不传 ⇒ 不记跨区审计（它不是跨区）')
  assert.equal(explicitSelf.explicit, true, '★ 指名 ⇒ 记一条（哪怕指的就是自己）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ 审计：目标区标识必须在，且"从哪到哪"成对
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 4：审计记录必须含【目标区标识】，且"从哪个区发起到哪个区"要成对', () => {
  const caller = callerAt('/ws/self')
  const target = resolveTargetWorkspace(contextWith(REGISTRY), caller, '/ws/other')
  /**
   * ★ 这一臂钉的是**审计记录的字段面**（`AgentTeamsWorkspaceAuditedData`）：
   *   五个必答 —— 谁 · 何时 · 对哪个区 · 什么工具 · 什么动作。
   *   ★ "何时"不在本结构里：它由宿主事件流自带时间戳（★ 重复存会造**两个时间口径**）。
   */
  const audit = {
    teamId: 'team-1',
    actor: 'captain',
    callerWorkspace: caller.session.header.cwd,
    targetWorkspace: target.workspace,
    /**
     * ★★ 显示名**不来自解析器**，而来自审计侧的 `registeredWorkspaceTitle(ctx, workspace)`
     *   —— 因为解析器的"不传"那一支**不许碰 `ctx`**（碰了会让 4 个既有夹具红）。
     *   ⇒ 本臂照**真实调用点**的写法：显示名由审计侧从注册表取。
     */
    targetTitle: registeredWorkspaceTitle(contextWith(REGISTRY), target.workspace) ?? target.workspace,
    tool: 'agent_teams_declare_delivery',
    action: 'read-delivery',
  }
  /** ★★★ 「对哪个区」是**必须**的那一格 —— 没有它，跨区操作不可审计。 */
  assert.equal(audit.targetWorkspace, '/ws/other', '★★★ 目标区标识必须在（没有它这一整条没意义）')
  assert.equal(audit.targetTitle, 'other-project', '★ 显示名也要在 —— 路径与名字两个口径都要能读')
  /** ★★ "从哪到哪"**成对**才读得出 —— 只有 target 时，看不出是谁去动的。 */
  assert.equal(audit.callerWorkspace, '/ws/self', '★★ 发起方也要在（跨区审计里"从哪到哪"要成对）')
  assert.notEqual(audit.callerWorkspace, audit.targetWorkspace, '★ 这一条是真正的跨区')
  /** ★ 五个必答逐个在。 */
  for (const key of ['actor', 'targetWorkspace', 'tool', 'action']) {
    assert.ok(key in audit, `★ 审计必须有 ${key}`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ 硬边界③ + 动作粒度：成功也要记，且 action 是【单件事】
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 5：审计的 `action` 是【单件事】—— 与"多件事写一个词"不同形', () => {
  /**
   * ★★★ 为什么要单独钉这一条：任务书要求"每次跨区操作记一条"，
   *   而**若一条记录只写 `action: 'delivery'`**，那么
   *   「读另一个区的交付状态」与将来任何"对交付做了什么"在台账里**同形**。
   *
   * ⇒ ★★ 取值域**只收单件事**，当前只有 `'read-delivery'`（**只读、不改那个区**）。
   *   ★ 将来加"写"**必须是新取值**，不许复用。
   */
  const ACTIONS = ['read-delivery']
  assert.deepEqual(ACTIONS, ['read-delivery'], '★ 当前只有一个动作，且它是"只读"的')
  /** ★ 而"读写混在一个词里"的形状必须不成立：一个词不许既表示读又表示写。 */
  const ambiguous = ['delivery', 'status', 'workspace']
  for (const word of ambiguous) {
    assert.ok(
      !ACTIONS.includes(word),
      `★★ "${word}" 这类"工具名当动作"的词会让多件事同形 —— 不许出现在 action 里`,
    )
  }
  /** ★ 命名上必须自证"这是读"：`read-` 前缀。 */
  assert.ok(ACTIONS.every((action) => action.startsWith('read-')), '★ 只读动作以 read- 开头（自证不改状态）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6 ★★★ 审计必须【落盘】—— 因为事件流那条今天不产生任何记录
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 6：审计必须【落盘】—— 事件流那条今天不产生记录，磁盘才是权威源', async () => {
  const root = mkdtempSync(join(tmpdir(), 't109-audit-'))
  try {
    const record = {
      at: 1700000000000,
      actor: 'captain',
      callerWorkspace: '/ws/self',
      targetWorkspace: '/ws/other',
      targetTitle: 'other-project',
      tool: 'agent_teams_declare_delivery',
      action: 'read-delivery',
    }
    /**
     * ★★★ 为什么必须落盘（裁定甲，队长实测）：
     *   宿主的 `KNOWN_SESSION_EVENT_TYPES` **59 个里 `agent-teams` 一个都没有**
     *   ⇒ `appendTeamEvent` 对**全部** agent-teams 事件**静默 return**。
     *   ⇒ 若只写事件流，一次跨区操作**不留下任何东西** ——
     *     而那正是"**能操作任何区**"与"**不知道它操作了哪个**"同形。
     */
    await appendWorkspaceAuditRecord(root, record)
    await appendWorkspaceAuditRecord(root, { ...record, targetWorkspace: '/ws/third', at: 1700000000001 })

    /** ① 真的写进去了（磁盘上的行数） */
    const raw = readFileSync(join(root, 'audit', 'workspace.jsonl'), 'utf8')
    assert.equal(raw.trim().split('\n').length, 2, '★★ 两条记录必须真的落到磁盘上')

    /** ② 读得回来，且**逐条不同形**（不是覆盖） */
    const back = await readWorkspaceAuditRecords(root)
    assert.equal(back.length, 2, '★ 两条都在（append-only，不是覆盖）')
    assert.equal(back[0].targetWorkspace, '/ws/other', '★ 第一条的目标区')
    assert.equal(back[1].targetWorkspace, '/ws/third', '★★ 第二条的目标区 —— 与第一条不同 ⇒ 没有被覆盖')

    /** ③ ★★ 字段与 event 版**逐字一致**（两个出口读同一份事实，不许两套口径） */
    for (const key of ['at', 'actor', 'callerWorkspace', 'targetWorkspace', 'targetTitle', 'tool', 'action']) {
      assert.ok(key in back[0], `★★ 审计记录必须有 ${key}`)
    }
    /**
     * ★★★ 「目标区标识」是**必须**的那一格 —— 本臂就是为它存在的：
     *   没有它，"操作了哪个区"无从回答，而审计的名字就落空了。
     */
    assert.equal(back[0].targetWorkspace, '/ws/other', '★★★ 目标区标识必须在（本任务的全部意义所在）')

    /** ④ ★ 三态：没有记录 ⇒ `[]`（而**不是**抛错 —— 那是"确实没有"）。 */
    const empty = mkdtempSync(join(tmpdir(), 't109-empty-'))
    try {
      assert.deepEqual(await readWorkspaceAuditRecords(empty), [], '★ 没有记录 ⇒ 空数组（不是错误）')
    } finally { rmSync(empty, { recursive: true, force: true }) }

    /** ⑤ ★★ 坏行**不许静默跳过** —— 否则"这条审计坏了"与"这条审计不存在"同形。 */
    const corrupt = mkdtempSync(join(tmpdir(), 't109-bad-'))
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(join(corrupt, 'audit'), { recursive: true })
      writeFileSync(join(corrupt, 'audit', 'workspace.jsonl'), '{"ok":1}\n{broken\n', 'utf8')
      await assert.rejects(
        () => readWorkspaceAuditRecords(corrupt),
        /corrupt audit record/,
        '★★ 坏行必须抛（不许跳过 —— "坏了"与"没有"必须不同形）',
      )
    } finally { rmSync(corrupt, { recursive: true, force: true }) }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
