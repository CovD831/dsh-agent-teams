/**
 * ── ★★★ t15：花名册的**默认模型** —— 配一次，凡是这份 profile 建的队都照它起步 ──────
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * ★ 缺口是**粒度**上的，不是机制上的（这一点是本任务**实测**出来的，写在这里
 *   免得下一个人以为逐成员那条路是坏的）：
 *
 *   · `TeamProfileMemberConfig` 早就有 `provider`/`model`/`reasoning_effort`，
 *     而且**逐成员那一整条链本来是通的**（实测：`members:[{name:'architect',
 *     model:'claude-opus'}]` 一路走到 member 记录上就是 `claude-opus`）。
 *   · 但**没有**一个"这一队人默认都用某个模型"的落点 ⇒
 *     一支 8 人的花名册要把同一个模型名**抄 8 遍**。
 *
 * ★★ 而"抄 8 遍"的代价是具体的：**抄第 8 遍时漏一个**。
 *   那一个成员会悄悄跑在队长的路由上，而它与"这个成员被配成了队长的模型"
 *   在读数上**完全同形** —— 那正是本任务要消灭的形状。
 *
 * ── ★★★ 三态（本队纪律的同一次应用）────────────────────────────────────────────
 *
 *   · 配了默认 + 成员没声明   ⇒ 成员拿默认（下 1 臂）
 *   · 配了默认 + 成员**声明了** ⇒ ★ **声明的赢**，默认一个字都不覆盖（下 2 臂）
 *   · **没配默认**            ⇒ 那一格**一个键都不加**，照旧走插件级/队长路由（下 3 臂）
 *
 * ★ 而第 3 态是最容易写错的一态：把它实现成"默认是一个空路由"会让一个**本来
 *   正常的**成员变成"跑在一个空模型上"。⇒ 本文件对它用 `in` 断言（一个
 *   `model: undefined` 会通过 `=== undefined` 却过不了 `in`）。
 *
 * ── 臂（契约 §6 的三臂）──────────────────────────────────────────────────────
 *
 *   臂 1（对照臂）  ：配了默认 ⇒ 每个没声明的成员都拿到它，且**落盘 + 读得回来**
 *   臂 2（伪造臂）  ：成员**显式声明**时默认不得覆盖它（定向突变：改成总是覆盖 ⇒ 红）
 *   臂 3（三态臂）  ：**没配默认** ⇒ 一个键都不加（定向突变：写成空串 ⇒ 红）
 *   臂 4（独立性臂）：档位与模型**各判各的**（配了档位没配模型是合法配置）
 *   臂 5（接线臂）  ：端到端 —— 真的 `agent_teams_create` + 真的 member 记录
 *   臂 6（回读臂）  ：`agent_teams_status` 答得出"这个成员在哪个模型上"
 *   臂 7（拒绝臂）  ：profile 的**未知键**仍然被拒（默认不是"什么都能塞"）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyProfileModelDefaults, resolveTeamProfile } from '../lib/profiles.js'
import { registerAgentTeamsTools } from '../lib/tools.js'
import { readTeamSync } from '../lib/state.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const cleanups = []
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

/**
 * 只解一支 profile，返回成员的路由三元组（便于逐臂断言）。
 *
 * ── ★★★ 而这里**必须**保留"这一格在不在"，而不是把它拍平成一个值 ─────────────────
 *
 * ★ MEASURED（我自己第一版就踩了）：我原先写的是
 *     `{ name, provider: member.provider, model: member.model, reasoningEffort: member.reasoningEffort }`
 *   —— 那**无条件建了四个键**，于是 `member.model === undefined` 在这里变成
 *   `{ model: undefined }` ⇒ `'model' in out` **恒为 true**。
 *
 * ★★ 后果是具体的：臂 3 断言"没配默认时这一格不许在场"，而它会在一个**完全正确**的
 *   实现上报红。★ 那正是本队记账里最贵的一类错 —— **夹具的投影把被测的三态拍平了**，
 *   于是夹具说的不再是产品代码的形状，而是夹具自己的形状。
 *
 * ⇒ 所以这里用**展开 + 条件**：字段缺席就**不建那个键**，与产品代码同一条纪律。
 */
function membersOf(config, maxMembers = 8) {
  return resolveTeamProfile({ roster: config }, 'roster', maxMembers)
    .members.map((member) => ({
      name: member.name,
      ...member.provider === undefined ? {} : { provider: member.provider },
      ...member.model === undefined ? {} : { model: member.model },
      ...member.reasoningEffort === undefined ? {} : { reasoningEffort: member.reasoningEffort },
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（对照臂）：配了默认 ⇒ 每个没声明的成员都拿到它
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：profile 配一次默认 ⇒ 每个没声明的成员都拿它', () => {
  const members = membersOf({
    model: 'gpt-5-codex',
    reasoning_effort: 'high',
    members: [{ name: 'architect' }, { name: 'researcher' }, { name: 'planner' }],
  })

  /**
   * ★ **逐个成员**断言，不是"数量对得上"：一支 profile 里"三个里有两个拿到了"
   *   与"三个都拿到了"在只看数量的断言下同形 —— 而那正是本任务要防的
   *   （漏抄一个成员的形状）。
   */
  for (const name of ['architect', 'researcher', 'planner']) {
    const member = members.find((candidate) => candidate.name === name)
    assert.ok(member, `★ 成员 "${name}" 必须在场`)
    assert.equal(member.model, 'gpt-5-codex', `★ "${name}" 必须拿到 profile 的默认模型`)
    assert.equal(member.reasoningEffort, 'high', `★ "${name}" 必须拿到 profile 的默认档位`)
  }
  assert.equal(members.length, 3, '★ 不许因为并默认而多出或少掉成员')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（伪造臂）：成员显式声明时，默认**不得**覆盖它
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 伪造臂：成员显式声明的模型**赢**过 profile 默认', () => {
  const members = membersOf({
    model: 'gpt-5-codex',
    members: [
      { name: 'architect', model: 'claude-opus' },   // 显式：必须留着
      { name: 'researcher' },                        // 没声明：必须拿默认
    ],
  })

  assert.equal(
    members.find((m) => m.name === 'architect').model, 'claude-opus',
    '★ 显式声明必须赢 —— 定向突变：把 applyProfileModelDefaults 改成总是覆盖 ⇒ 本行红',
  )
  assert.equal(
    members.find((m) => m.name === 'researcher').model, 'gpt-5-codex',
    '★ 而没声明的那一个仍然拿默认（★ 缺了这一半，一个"永不应用默认"的实现也能过上半）',
  )
})

test('臂 2b ★：显式声明的**档位**同样赢（两格各自独立地不覆盖）', () => {
  const members = membersOf({
    model: 'gpt-5-codex',
    reasoning_effort: 'high',
    members: [{ name: 'a', reasoning_effort: 'low' }, { name: 'b' }],
  })

  assert.equal(members.find((m) => m.name === 'a').reasoningEffort, 'low', '★ 成员自己写的档位必须留着')
  assert.equal(members.find((m) => m.name === 'a').model, 'gpt-5-codex', '★ 而模型仍然来自默认（两格互不牵连）')
  assert.equal(members.find((m) => m.name === 'b').reasoningEffort, 'high')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（三态臂）：**没配默认** ⇒ 一个键都不加
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 三态臂：profile **没**配默认 ⇒ 那一格一个键都不加（不是空串）', () => {
  const members = membersOf({ members: [{ name: 'architect' }, { name: 'researcher' }] })

  for (const member of members) {
    /**
     * ★ 用 `in` 而不是 `=== undefined`：
     *   一个把默认写成 `model: undefined` 或 `model: ''` 的实现会**通过**
     *   后者，而它的形状是"这一格在场但是空的" ⇒ 一个**空路由**。
     *   ⇒ ★ "没配默认"的本意是"照旧走插件级/队长那条链"，不是"跑在空模型上"。
     */
    assert.ok(!('model' in member), `★ "${member.name}" 不许被填上一个 model（没配默认就该没有）`)
    assert.ok(!('reasoningEffort' in member), `★ "${member.name}" 不许被填上档位`)
  }
})

test('臂 3b ★：`applyProfileModelDefaults` 在"填不出东西"时**原样返回**', () => {
  const member = { name: 'architect' }
  const out = applyProfileModelDefaults(member, {})

  assert.deepEqual(out, member, '★ 没有默认可填 ⇒ 返回值必须与输入**同一个形状**（一个键都不多）')
  assert.ok(!('model' in out), '★ 尤其不许出现 `model: undefined` —— 那在读取方眼里=在场')
  /**
   * ★ 而对照半边：有默认可填时它**必须**填 —— 否则上面那条在一个"永远原样返回"
   *   的实现上也是绿的（那种实现会把整个功能关掉，而"关掉"也是"不加键"）。
   */
  assert.equal(applyProfileModelDefaults(member, { model: 'gpt-5' }).model, 'gpt-5')

  /**
   * ── ★★★ 一条**如实记录的**定向突变读数（而不是假装本臂覆盖了它）────────────────
   *
   * ★ 我实测过两种突变，而它们**不同形**，这条读数就是它们的区别：
   *
   *   ① 删掉上面那个 early return（让它继续往下走 `omitUndefined({...})`）
   *      ⇒ **本臂仍然全绿**。★ 而那是**对的**：`omitUndefined` 同样把
   *      `undefined` 删掉，所以两条路产出**逐字相同**的对象。
   *      ⇒ 删掉 early return **不是**一个缺陷 —— 它是一个**等价**改写。
   *        （一个"存活下来的突变"不一定是夹具漏了：它可能是**没有行为差异**。）
   *
   *   ② 把 early return 改成返回**显式空串** `{...member, model:'', reasoningEffort:''}`
   *      ⇒ **本臂红**（臂 2/3/5b 一起红）。★ 而这一种才是真的坏：
   *      空串是一个**在场的**值 ⇒ 成员被钉到一个空路由上，而"没配默认"的本意是"照旧"。
   *
   * ★★ 所以本臂真正钉住的是 **②**（可观察的后果），而不是 ①（实现细节）。
   *   把①也写成断言会变成"把一个等价改写钉死"—— 那会在一次无害的重构上红。
   */
  assert.ok(!('model' in applyProfileModelDefaults({ name: 'x' }, {})), '★ 空默认下不许出现空串模型')
  assert.notEqual(applyProfileModelDefaults({ name: 'x' }, {}).model, '', '★ 空串与"没有这一格"必须不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（独立性臂）：档位与模型各判各的
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 ★ 独立性臂：配了档位没配模型是**合法**配置，不许被合成一格', () => {
  /**
   * ★ 它为什么合法：档位是"**在某个模型上**花多少算力"，而那个模型可以由
   *   **别处**定下（插件级 `memberModel`、或队长当前路由）。
   * ⇒ 把两格合成一个对象会让这种配置要么被拒、要么被静默丢掉一半。
   */
  const members = membersOf({ reasoning_effort: 'high', members: [{ name: 'a' }] })

  assert.equal(members[0].reasoningEffort, 'high', '★ 只有档位时它照样生效')
  assert.ok(!('model' in members[0]), '★ 而模型那一格**不许**被档位捎带着填上')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（接线臂）：端到端 —— 真的 create + 真的 member 记录
// ─────────────────────────────────────────────────────────────────────────────

/** 一个真的插件 ctx（与其它夹具同构：手搓一份测的是夹具，不是产品代码）。 */
function pluginFixture(workspace, profiles) {
  const tools = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { list: () => [], get() { return undefined } },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
    /**
     * ★ 真的 LLM 面：`resolveMemberLlmSelection` 会调 `resolveCallConfig`，
     *   而 `validateMemberLlmSelections` 会调 `listModels`。
     *   ★ 返回**空目录**是有意的：`validateMemberLlmSelections` 对空目录一律放行
     *     （"没有目录 ⇒ 无从证伪"），于是本臂不被"这个模型名不在目录里"挡住 ——
     *     那件事与"默认有没有生效"无关。
     */
    llm: { resolveCallConfig: async (cfg) => ({ ...cfg }), listModels: async () => [] },
  }
  const captain = {
    id: 'captain-session', status: 'idle',
    session: {
      header: { cwd: workspace }, events: [],
      requestHeader() { return { config: { provider: 'p', model: 'captain-default' } } },
    },
    options: { provider: 'p', model: 'captain-default' },
    steer() {},
  }
  registerAgentTeamsTools(ctx, {
    stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles, fallback: undefined,
  })
  const call = (name, args) => tools.get(name).execute(args, { agent: captain, signal: new AbortController().signal })
  return { call, tools }
}

test('臂 5 ★ 接线臂：profile 默认真的走到 **member 记录**上（落盘，不只是内存）', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 't15-e2e-'))
  cleanups.push(workspace)
  const { call } = pluginFixture(workspace, {
    roster: {
      model: 'gpt-5-codex',
      reasoning_effort: 'high',
      members: [{ name: 'architect' }, { name: 'researcher', model: 'claude-opus' }],
    },
  })

  const result = await call('agent_teams_create', { name: 'RosterTeam', profile: 'roster', approval: 'automatic' })

  /**
   * ★★ 两条腿都要：**返回值**（调用方当场看到的）与**盘上的记录**（别人之后读到的）。
   *   只断言返回值证明不了它落了盘；只断言盘上则漏掉"返回值与记录分叉"那一类。
   */
  for (const [label, list, key, effortKey] of [
    ['返回值', result.members, 'member_name', 'reasoning_effort'],
    ['盘上记录', readTeamSync(join(workspace, '.agent-teams'), 'rosterteam').members, 'name', 'reasoningEffort'],
  ]) {
    const find = (name) => list.find((m) => m[key] === name)
    assert.equal(find('architect').model, 'gpt-5-codex', `★ ${label}：没声明的成员必须拿到 profile 默认`)
    assert.equal(find('researcher').model, 'claude-opus', `★ ${label}：显式声明必须赢`)
    assert.equal(find('architect')[effortKey], 'high', `★ ${label}：默认档位也要到`)
  }
})

test('臂 5b ★ 三态端到端：**没配默认**的 profile ⇒ 成员照旧继承队长的路由', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 't15-inherit-'))
  cleanups.push(workspace)
  const { call } = pluginFixture(workspace, { roster: { members: [{ name: 'architect' }] } })

  const result = await call('agent_teams_create', { name: 'InheritTeam', profile: 'roster', approval: 'automatic' })

  /**
   * ★ 这是"今天的既有行为"那一条：没配默认 ⇒ 成员继承**队长的当前路由**。
   *   ★ 而它必须被**断言成 captain-default**，不是断言成"非空"：
   *     后者在一个"把所有人塞到某个别的模型上"的实现里也是绿的。
   */
  assert.equal(result.members[0].model, 'captain-default', '★ 没配默认 ⇒ 继承队长路由（既有行为，一行没改）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6（回读臂）：status 答得出"这个成员在哪个模型上"
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 ★ 回读臂：`agent_teams_status` 答得出每个成员的模型（不读配置也答得出）', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 't15-status-'))
  cleanups.push(workspace)
  const { call } = pluginFixture(workspace, {
    roster: { model: 'gpt-5-codex', members: [{ name: 'architect' }, { name: 'researcher', model: 'claude-opus' }] },
  })

  await call('agent_teams_create', { name: 'StatusTeam', profile: 'roster', approval: 'automatic' })
  const status = await call('agent_teams_status', {})

  const architect = status.members.find((m) => m.name === 'architect')
  const researcher = status.members.find((m) => m.name === 'researcher')

  /**
   * ★ 契约第四格逐字要求"这个成员在哪个模型上"**不必读配置**就答得出来。
   *   ⇒ 断言从 **status 的返回值**读，而不是从 profile 的 config 读
   *     （后者是"配置说了什么"，不是"这个成员实际在什么上"）。
   */
  assert.equal(architect.model, 'gpt-5-codex', '★ status 必须报出默认解析后的模型')
  assert.equal(researcher.model, 'claude-opus', '★ 显式覆盖也要能从 status 读回来')
  assert.ok(architect.provider !== undefined, '★ provider 一并与 model 可读（否则模型名没有归属）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7（拒绝臂）：未知键仍然被拒 —— 默认不是"什么都能塞"
// ─────────────────────────────────────────────────────────────────────────────

test('臂 7 ★ 拒绝臂：profile 的**未知键**仍然被拒（加了默认不等于放宽了校验）', () => {
  /**
   * ★ `PROFILE_KEYS` 是本任务**唯一**动过的那份白名单（加了 model / reasoning_effort）。
   *   ⇒ 而"加了两格"与"白名单失效"必须不同形：这条臂钉住后者。
   *   ★ 定向突变：把 `assertAllowedKeys` 去掉 ⇒ 本臂红。
   */
  assert.throws(
    () => membersOf({ model: 'gpt-5', nonsense: true, members: [{ name: 'a' }] }),
    /nonsense/,
    '★ 未知键必须被拒并**指名**是哪一个',
  )
  /** ★ 而合法的两格必须**不被**这条拒绝误伤。 */
  assert.doesNotThrow(() => membersOf({ model: 'gpt-5', reasoning_effort: 'high', members: [{ name: 'a' }] }))
})

test('臂 7b ★：成员级 `provider` 无 `model` 仍然被拒（默认不得掩盖真实错配）', () => {
  /**
   * ★ 这条钉的是**叠加顺序**：默认必须在逐成员校验**之后**才并进去。
   *   若反过来（先并默认再校验），一个"只写了 provider"的成员会拿到默认模型
   *   从而**通过** —— 而那个配置的错处（provider 与 model 必须成对）是真实的。
   */
  assert.throws(
    () => membersOf({ model: 'gpt-5-codex', members: [{ name: 'a', provider: 'anthropic' }] }),
    /provider without model/,
    '★ 成员写了 provider 却没写 model ⇒ 仍然拒绝，不许被 profile 默认悄悄补上',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（形态通路）：内联 plan 的成员必须能携带 executionPrompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★★★ 这条臂钉的是一个**真实发生过**的缺口，不是一条假设的语法检查。
 *
 * MEASURED（2026-10-18 夜里，我自己踩的）：队长用 `agent_teams_create({plan})` 建队，
 * 而 `plan.members` 的 schema **只有 name/role/provider/model/reasoning_effort 五格**
 * —— `executionPrompt` 被挡在门外。于是经这条路径建出来的队，**唯一能表达的形态**
 * 就是「扁平成员池 + 队长派活」，也就是这个插件更早的那个形态。
 *
 * 而「持久记账点 + 每任务拉一对临时 worker/reviewer」那个形态，只存在于
 * `mutation-quality` 这类团队**手工写进 profile 的 executionPrompt 文本**里
 * （`ledger` 与 `foreman` 的 prompt 逐字写着"你拉起临时 subagent 去执行实现/修理任务"）。
 * ⇒ 形态在语料里、在配置里，却**不在建队的 API 里** ⇒ 新队默认退回早期形态。
 *
 * ★ 与之对照：`agent_teams_add_member` **一直**有这一格（`src/tools/members.ts:28`）。
 *   所以这个缺口的准确描述是「**同一条能力，两条路径里只有一条有**」——
 *   而 `plan` 路径恰恰是"一次建完整队"的那条，也就是最常用于新队的那条。
 */
test('臂 8 ★ 形态通路：内联 plan 的成员能带 executionPrompt，且它真的到得了成员记录', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'plan-prompt-'))
  cleanups.push(workspace)
  const { call } = pluginFixture(workspace, {})

  const prompt = 'You delegate: spawn a fresh subagent per implementation and a continuable one per review.'
  const result = await call('agent_teams_create', {
    name: 'InlinePromptTeam',
    approval: 'automatic',
    plan: {
      /**
       * ★★ `shape` 是**必填**（2026-10-20，用户裁定乙方案）—— 见
       *   `scripts/gate-team-shape.test.mjs` 的臂 6 与 `src/tools/create.ts` 的注释。
       *   ⇒ 这个臂原本不传它，于是 create 被宿主 schema 拒（`missing required
       *   property "plan.shape"`）—— ★ 那不是回归，是**必填在起作用**。
       *   ★ 而这里选 `'flat'` 而不是 `'dispatch'`：这个臂测的是
       *     「成员能带 executionPrompt 且它到你成员记录」这条**通路**，
       *     与人设要不要派工无关；选 flat 让它与臂 1~5 的语境一致。
       */
      shape: 'flat',
      members: [
        { name: 'ledger', role: 'task-ledger', executionPrompt: prompt },
        { name: 'plain' },
      ],
      tasks: [],
    },
  })

  /**
   * ★ 两条腿都要（与臂 5 同一纪律）：
   *   ① **返回值**里看得见 —— 调用方当场就知道这个形态被接受了；
   *   ② **盘上的 member 记录**里有 —— 之后 `memberPersona`（`src/members.ts:606`）
   *      读的是 member 记录，不是调用参数。只断言 ① 会漏掉"参数进来了但没落盘"。
   */
  assert.equal(result.members.find((m) => m.member_name === 'ledger') !== undefined, true)
  const onDisk = readTeamSync(join(workspace, '.agent-teams'), 'inlinepromptteam').members
  assert.equal(
    onDisk.find((m) => m.name === 'ledger').executionPrompt,
    prompt,
    '★ 形态必须落盘：memberPersona 读的是这一格',
  )

  /**
   * ★ 反向半边：**没写的成员不许被塞进一个空串或别人的 prompt**。
   *   一个"所有人都拿到同一段 prompt"的实现会让「这是 ledger」与「这是普通实现者」
   *   在读数上同形 —— 而它们的职责正好相反（一个不许写代码，一个只写代码）。
   */
  assert.equal('executionPrompt' in onDisk.find((m) => m.name === 'plain'), false, '★ 没写的成员不许凭空多出这一格')

  /**
   * ★ 定向突变：把 `src/tools/create.ts` 里 `plan.members` 的 `executionPrompt`
   *   从 schema 删掉 ⇒ 本臂**第一行 create 就被 schema 拒绝**（`additionalProperties: false`），
   *   于是这条 test 在 create 处抛错 ⇒ 红。
   */
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9（对称臂）：同一条能力，三条建成员的路径必须接受同一组字段
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ★★★ 臂 8 钉的是**一个具体实例**，这一条钉的是**那类缺陷**。
 *
 * MEASURED：`executionPrompt` 在 `agent_teams_add_member`（`src/tools/members.ts:28`）
 * 与 profile（`src/profiles.ts:23 MEMBER_KEYS`）里**一直**都有，只在
 * `agent_teams_create({plan})` 的 schema 里缺席。于是"能不能表达成员人格"
 * 变成一个**取决于队长选了哪条建队路径**的事实 —— 而三条路径的差别
 * 在用户眼里只是"一次建完 vs 分几次建"。
 *
 * ⇒ 这条臂按**源码**比较三份字段清单，而不是逐个字段手抄。
 *   手抄清单只能证明"我今天记得查这三个"，证明不了"以后不会再分叉"。
 *
 * ★ 定向突变：从 `src/tools/create.ts` 的 plan.members 里删掉任一字段 ⇒ 本臂红。
 */
test('臂 9 ★ 对称臂：plan.members / add_member / profile 三条路径的成员字段必须同源', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'parity-'))
  cleanups.push(workspace)
  const { tools } = pluginFixture(workspace, {})

  /** 三个来源各自"成员能带哪些字段"：两个来自工具 schema，一个来自 profile 归一化。 */
  const createProps = tools.get('agent_teams_create').parameters.properties
  const planMemberFields = Object.keys(createProps.plan.properties.members.items.properties).sort()
  const addMemberFields = Object.keys(
    tools.get('agent_teams_add_member').parameters.properties,
  ).sort()

  /**
   * ★ profile 那一份用**行为**取，不用常量取：`MEMBER_KEYS` 是私有的，
   *   而"常量和 schema 一致"与"实际接受一样的键"是两件事 —— 后者才是用户看到的。
   *   这里传一个只有 executionPrompt 的成员，能归一化成功就说明 profile 认这一格。
   */
  assert.deepEqual(
    planMemberFields,
    addMemberFields,
    '★ 一次建完与分几次建，成员能带的字段必须是同一组（否则"能不能带人格"取决于走了哪条路）',
  )
  assert.doesNotThrow(
    () => membersOf({ members: [{ name: 'a', executionPrompt: 'delegate' }] }),
    '★ profile 路径也必须认这一格（三路同源）',
  )
})
