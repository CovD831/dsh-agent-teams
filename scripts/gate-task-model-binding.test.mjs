/**
 * ── ★★★ t14：**每一次执行**的模型绑定 —— 而"已执行"是封条 ────────────────────────
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * 最初的框法是"改**成员**的模型"。而那个框法定不了位：
 *
 *   ★ 一个持久成员在**多轮里执行许多不同的任务** ⇒
 *     **"这个成员的模型"指不出"这条结果是谁产出的"**。
 *
 * ⇒ 本任务把它换成**任务自己带**：每条任务声明"哪个模型执行它"。
 *   来源：@linxin666/dsh-web-all 的 task-board 设计 ——
 *   每条 task 自带 model + `executions[]` 历史，
 *   ★ 于是**一次运行是历史里的一个元素，而不是一次状态转换**。
 *
 * ── ★★ 而本文件真正要钉死的是一个【硬约束】，不是一条好用的功能 ──────────────────
 *
 * MEASURED / 逐条推理：**改一个【已经在跑】的任务的模型会毁掉归属** ——
 *   "这条结果是谁产出的"从那一刻起**没有唯一答案**。
 * ⇒ 用户明确接受**推迟**这件事 ⇒ 所以本文件要求它**fail-closed**：
 *   一旦这条任务**执行过**，改绑定就是**拒绝**，不是"警告后照做"。
 *
 * ── ★★★ 四态在本文件里各自是什么（本队记账的"三态/四态"纪律的同一次应用）──────
 *
 *   · `pending` + `attempt === 0`  ⇒ **放行**（还没跑，没有归属可毁）
 *   · `attempt > 0`                ⇒ **拒绝**（跑过了）
 *   · `claimed` / `in_progress`    ⇒ **拒绝**（正在跑）
 *   · `completed`/`failed`/`cancelled` ⇒ ★ **拒绝**（收口了，产物已经在外面被引用）
 *
 * ★ 而这四态必须**互不同形** —— 一次被拒绝的改绑定与"它悄悄没生效"在只看最终
 *   记录时**完全同形**，所以本文件要求拒绝路径交出**可机械分辨的措辞与 code**。
 *
 * ── ★★ 本文件【不】假装传播已经接线（这是最重要的一条）─────────────────────────
 *
 * 契约第四格要求把"绑定到不到得了执行的那台机器"**查实并如实报告**；
 * 若路由不传播，要**明说**。★ 本文件对着**已安装的 Harness API** 把那条读数**钉住**：
 * 它先证明"交付面确实带不了路由"（一个**结构性**事实，不是我的断言），
 * 再要求工具的读数在**不一致时明说"NOT applied"** —— 而不是记一个不会被用的绑定
 * 还报成功。
 *
 * ── 臂（契约 §6 的三臂，外加一条结构臂）────────────────────────────────────────
 *
 *   臂 1（对照臂）  ：未执行的任务可以声明绑定，**从记录里读得回来**
 *   臂 2（对照臂）  ：审的任务与它判的实现可以**各用不同模型**，两边都读得回来
 *   臂 3（伪造臂）  ：**已执行**的任务改绑定 ⇒ **拒绝**，且 code/措辞可分辨
 *   臂 4（边界臂）  ：四态逐个走一遍 —— 哪一个被拒、哪一个放行，各自指名
 *   臂 5（结构臂）  ：交付面（`sendMessage`/`queuePrompt`/`coldResume`）**没有**路由位
 *   臂 6（诚实臂）  ：绑定与成员冻结路由**不一致**时，读数必须说 "NOT applied"
 *   臂 7（误报臂）  ：绑定与成员路由**一致**时，读数必须说 it runs this model
 *   臂 8（回读臂）  ：`output.schema` 容得下真的返回值（本队第 9 次同族形态）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerAgentTeamsTools } from '../lib/tools.js'
import { createTeamDir, readTeamSync } from '../lib/state.js'
/**
 * ★ `plan-reviewed` 那条 dispatch 门要求一个 `reviewed` 戳（见 docs/PLAN-REVIEW.md §8）。
 *   本文件测的是**模型绑定**，不是那条门 ⇒ 用一个共用件把戳盖上，
 *   否则每一条建任务的臂都会被那条门**意外挡住**（而挡住的原因与被测的事无关）。
 *   ★ 用共用件而不是自己写一份：那份形状由判据层的 `REVIEW_QUESTION_IDS` 决定，
 *     多份拷贝会在"五问改名"那天一起红，读起来像"多个机制同时坏了"。
 */
import { reviewedStamp } from './fixtures/reviewed-stamp.mjs'
import {
  MODEL_BINDING_SEALED_CODE,
  describeModelBindingForCreate,
  describeModelBindingPropagation,
  modelBindingIsSealed,
  modelBindingOf,
} from '../lib/tools/create-task.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

// ─────────────────────────────────────────────────────────────────────────────
// 共同夹具（与 `gate-input-wiring.test.mjs` / `gate-position-wiring.test.mjs` 同构：
// ★ 用【真的】`registerAgentTeamsTools` —— 手搓一份测的是夹具，不是产品代码）
// ─────────────────────────────────────────────────────────────────────────────

function fakeAgent(id, workspace) {
  return {
    id,
    status: 'idle',
    session: {
      header: { cwd: workspace },
      events: [],
      requestHeader() { return { config: { provider: 'p', model: 'captain-model' } } },
    },
    options: { provider: 'p', model: 'captain-model' },
    steer() {},
  }
}

function pluginFixture(workspace) {
  const tools = new Map()
  const warnings = []
  const ctx = {
    logger: { debug() {}, info() {}, warn(m) { warnings.push(String(m)) }, error(m) { warnings.push(String(m)) } },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    subagents: {
      getProvider() { return undefined },
      list() { return [] },
      sendMessage: async () => 'msg-0',
      [Symbol.for('dsh.subagent.queuePrompt')]: async () => 'msg-0',
    },
    agents: { get() { return undefined } },
    on() { return () => {} },
    effect(setup) { return setup() },
    inject() { return () => {} },
  }
  const config = { stateDir: '.agent-teams', memberProvider: 'spawn', maxMembers: 8, profiles: {}, fallback: undefined }
  registerAgentTeamsTools(ctx, config)
  const call = async (name, args, agentId) => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`tool "${name}" was not registered`)
    return await tool.execute(args, { agent: fakeAgent(agentId ?? 'captain-session', workspace), signal: new AbortController().signal })
  }
  return { ctx, tools, warnings, call }
}

/** 一个合法到能过 `coerceTeamState` 的团队。 */
async function seedTeam(workspace, { tasks = [], members = [] } = {}) {
  await createTeamDir(join(workspace, '.agent-teams'), {
    id: 'team',
    name: 'ModelBinding',
    captainSessionId: 'captain-session',
    createdAt: 1,
    taskSeq: tasks.length,
    members,
    tasks,
  })
}

/** 一个可派发的成员（有 provider/model ⇒ 有"冻结路由"可对照）。 */
function member(overrides = {}) {
  return {
    id: '', name: 'worker', role: 'engineer',
    provider: 'anthropic', model: 'claude-sonnet',
    joinedAt: 1, status: 'idle',
    ...overrides,
  }
}

function freshWorkspace(name) {
  return track(mkdtempSync(join(tmpdir(), `t14-${name}-`)))
}

/** 读回盘上的那一条任务 —— ★ 一律**从记录读**，不信内存里的对象。 */
function taskOnDisk(workspace, id) {
  return readTeamSync(join(workspace, '.agent-teams'), 'team')?.tasks.find((t) => t.id === id)
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（对照臂）：未执行的任务可以声明绑定，且**从记录里读得回来**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 对照臂：未执行的任务声明绑定 ⇒ 落盘，且**从记录里读得回来**', async () => {
  const workspace = freshWorkspace('bind')
  await seedTeam(workspace, { members: [member()] })
  const { call } = pluginFixture(workspace)

  const result = await call('agent_teams_create_task', {
    subject: 'bind me', kind: 'work', model: 'gpt-5-codex', reasoning_effort: 'high',
    reviewed: reviewedStamp(),
  })

  const task = taskOnDisk(workspace, result.task_id)
  assert.equal(task.model, 'gpt-5-codex', '★ 绑定必须真的落进任务记录')
  assert.equal(task.reasoningEffort, 'high')
  /**
   * ★ 而"落盘了"还要**从记录读得回来** —— 这正是"归属要能被别人回答"的成立条件。
   *   只断言 `execute` 的返回值，证明不了下一个人（审查者、integrator）读得到它。
   */
  assert.deepEqual(modelBindingOf(task), { model: 'gpt-5-codex', reasoningEffort: 'high' })
  assert.equal(result.model_binding.model, 'gpt-5-codex', '★ 读数里必须交回绑定')
})

test('臂 1b ★ 三态：没声明绑定 ⇒ 那一格【一个键都不写】（不是 null / undefined）', async () => {
  const workspace = freshWorkspace('unbound')
  await seedTeam(workspace, { members: [member()] })
  const { call } = pluginFixture(workspace)

  const result = await call('agent_teams_create_task', { subject: 'no model', kind: 'work', reviewed: reviewedStamp() })
  const task = taskOnDisk(workspace, result.task_id)

  /**
   * ★ 用 `in` 而不是 `=== undefined`：一个写成 `model: undefined` 的实现会**通过**
   *   后者，而它的形状是"这一格在场但是空的" —— 那与"没声明"在 `readTeamSync`
   *   之后同形。本队的纪律要求两者**不同形**。
   */
  assert.ok(!('model' in task), '★ 没声明时这一格不许在场（写 undefined/null 都是同一个错）')
  assert.equal(modelBindingOf(task), undefined)
  assert.ok(!('model_binding' in result), '★ 没声明 ⇒ 读数那一格也缺席，而不是报一个空的')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（对照臂）：审的任务与它判的实现各用不同模型，**两边都读得回来**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★ 对照臂：review 可以用与它判的 implementation **不同**的模型，两边都答得出', async () => {
  const workspace = freshWorkspace('review')
  await seedTeam(workspace, { members: [member()] })
  const { call } = pluginFixture(workspace)

  const impl = await call('agent_teams_create_task', {
    subject: 'implement', kind: 'implementation', model: 'claude-opus',
    objective: 'do the thing', acceptance: ['it works'],
    verify: ['node --test scripts/gate-task-model-binding.test.mjs'], reviewed: reviewedStamp(),
    inScope: ['src/a.ts', 'lib/a.js'], outOfScope: ['src/b.ts'],
  })
  const review = await call('agent_teams_create_task', {
    subject: 'review it', kind: 'review', model: 'gpt-5-codex', reviewedTaskId: impl.task_id,
    objective: 'judge it', acceptance: ['verdict is answered'], reviewed: reviewedStamp(),
    /**
     * ★ review 也要 `inScope`/`verify`：`contract.task-atomicity` 需要一组
     *   判别面 + 写域才判得出来，而"没法判"与"原子"**不是一回事**
     *   （那条门拒绝的正是前者）。★ 这不是本任务的事 —— 它只是这条臂必须满足的
     *   既有契约，与模型绑定无关。
     */
    inScope: ['src/a.ts', 'lib/a.js'], verify: ['node --test scripts/gate-task-model-binding.test.mjs'],
  })

  const implTask = taskOnDisk(workspace, impl.task_id)
  const reviewTask = taskOnDisk(workspace, review.task_id)

  /**
   * ── ★★★ 这就是"两个模型、两条记录、各自答得出"的全部内容 ─────────────────────
   *
   * ★ 而它必须**两个方向都断言**：只断言 review 是 codex，一个把两条都写成同一个
   *   模型的实现照样能过 ⇒ 断言不恒真要靠"它们**不同**"这一条来钉。
   */
  assert.equal(modelBindingOf(implTask).model, 'claude-opus', '★ 实现那条记的是它自己的模型')
  assert.equal(modelBindingOf(reviewTask).model, 'gpt-5-codex', '★ 审查那条记的是它自己的模型')
  assert.notEqual(
    modelBindingOf(implTask).model, modelBindingOf(reviewTask).model,
    '★ 两条记录的绑定必须**真的不同** —— 否则这条臂在"两边都写成同一个"时也通过',
  )
  /**
   * ★ 而"谁判了谁"这条关系**也要读得回来**：只有 `reviewedTaskId` 在场，
   *   "审查用 codex 判了 claude-opus 的产物"才是一句**可核对**的话，
   *   而不是两格各自孤立的模型名。
   */
  assert.equal(reviewTask.reviewedTaskId, impl.task_id, '★ 审的那条必须指回它判的实现')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（伪造臂）：**已执行**的任务改绑定 ⇒ 拒绝，且措辞与 code 可分辨
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 ★ 伪造臂：改一条【已经跑过】的任务的绑定 ⇒ 拒绝（不是默默改掉）', async () => {
  const workspace = freshWorkspace('sealed')
  await seedTeam(workspace, {
    members: [member()],
    tasks: [{
      id: 't1', subject: 'already ran', kind: 'work', status: 'in_progress',
      assignee: 'worker', attempt: 1, attemptId: 'a1', model: 'claude-opus',
      dependencies: [], createdAt: 1, updatedAt: 1,
    }],
  })
  const { call } = pluginFixture(workspace)

  await assert.rejects(
    () => call('agent_teams_create_task', { bindModelTo: 't1', model: 'gpt-5-codex', subject: 'rebind attempt' }),
    (error) => {
      /**
       * ── ★★★ 这一条臂的**全部价值**：拒绝必须**可机械分辨** ────────────────────
       *
       * ★ 断言 code（机器读）与措辞（人读）**两样都要**：
       *   只断言"抛了个错"会让任何一个无关的错误（例如参数校验）也通过 ——
       *   而那正是"封条拒了它"与"别的东西坏了"同形的形状。
       */
      assert.match(String(error.message), new RegExp(MODEL_BINDING_SEALED_CODE), '★ 措辞里要有可分辨的 code')
      assert.match(String(error.message), /destroys attribution/, '★ 要说清为什么拒绝（归属）')
      assert.match(String(error.message), /attempt 1/, '★ 要指名它是**凭什么**不能再改')
      assert.equal(error.model_binding_refused?.code, MODEL_BINDING_SEALED_CODE, '★ 结构化的拒绝形状也要在场')
      assert.equal(error.model_binding_refused?.task_id, 't1')
      return true
    },
  )

  /**
   * ★★ 而"拒绝了"必须**真的没改** —— 这是"fail-closed"这个词的**可观察后果**。
   *   一个"先改再抛"的实现会通过上面所有断言，而它在记录上留了一条**被改过的**
   *   绑定 ⇒ 归属已经被毁了却报"我拒绝了"。⇒ 这行断言把它挡住。
   */
  assert.equal(taskOnDisk(workspace, 't1').model, 'claude-opus', '★ 拒绝之后记录必须**一个字都没变**')
})

test('臂 3b ★「没有静默 no-op」：被拒绝时【不许】返回一个看起来成功的成功值', async () => {
  const workspace = freshWorkspace('nosilent')
  await seedTeam(workspace, {
    members: [member()],
    tasks: [{
      id: 't1', subject: 'settled', kind: 'work', status: 'completed',
      attempt: 2, model: 'claude-opus', output: 'done', dependencies: [], createdAt: 1, updatedAt: 1,
    }],
  })
  const { call } = pluginFixture(workspace)

  /**
   * ★ 本契约第五格逐字要求"拒绝路径产出可分辨的拒绝消息，而不是静默 no-op"。
   *   于是这条臂问的是一次**否定**的问句：这次调用**不能**正常返回。
   *   ★ 一个静默 no-op 的实现（`if (sealed) return {…}`）会在这里红。
   */
  let returned = false
  try {
    await call('agent_teams_create_task', { bindModelTo: 't1', model: 'gpt-5', subject: 'rebind attempt' })
    returned = true
  } catch { /* 期待的就是这个 */ }
  assert.equal(returned, false, '★ 被拒绝的改绑定绝不能返回一个成功值（那与"改成了"同形）')
  assert.equal(taskOnDisk(workspace, 't1').model, 'claude-opus')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（边界臂）：四态逐个走一遍 —— 放行的与被拒的各自指名
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 ★ 边界臂：四态各自指名（没跑的放行 / 三种"跑过"一律拒绝）', async () => {
  /**
   * ── ★★★ 为什么这条臂是**穷举**而不是挑两个例子 ──────────────────────────────
   *
   * ★ 本任务的硬约束是"已执行 ⇒ 封死"。而"已执行"在记录里**有三种不同的长相**
   *   （`attempt > 0` / 正在跑 / 已收口），外加一个**看起来像三种但其实不是**的
   *   边界（`pending` 且 `attempt === 0`）。
   *   ⇒ 少测一种，就会留下"那一种能悄悄改"的口子 —— 而那正是本任务要堵的东西。
   *
   * ★ 逐条**指名**（而不是一个循环断言"全部为真"）：循环会让失败信息说不出
   *   **是哪一态**漏了，而"哪一态"正是这里唯一有用的信息。
   */
  const sealed = [
    ['attempt > 0 while pending', { status: 'pending', attempt: 1 }],
    ['claimed', { status: 'claimed', attempt: 0 }],
    ['in_progress', { status: 'in_progress', attempt: 0 }],
    ['completed', { status: 'completed', attempt: 0 }],
    ['failed', { status: 'failed', attempt: 0 }],
    ['cancelled', { status: 'cancelled', attempt: 0 }],
  ]
  for (const [label, task] of sealed) {
    assert.equal(modelBindingIsSealed(task), true, `★ "${label}" 必须被判为已封死`)
  }
  /**
   * ★ 对照半边：`pending` + `attempt === 0` **必须放行**。
   *   没有这一半，一个"恒 true"的实现会通过上面**全部**断言 —— 而那会把
   *   每一条新建的任务都变成不可绑定（把功能整体关掉，也叫"安全"）。
   */
  assert.equal(modelBindingIsSealed({ status: 'pending', attempt: 0 }), false, '★ 没跑过的任务必须可绑定')
  assert.equal(modelBindingIsSealed({ status: 'pending' }), false, '★ 缺 attempt 的任务同样按"没跑过"处理')
})

test('臂 4b ★ 端到端：没跑过的任务真的**改得动**（封条不是把功能关掉）', async () => {
  const workspace = freshWorkspace('rebind')
  await seedTeam(workspace, {
    members: [member()],
    tasks: [{
      id: 't1', subject: 'never started', kind: 'work', status: 'pending',
      attempt: 0, model: 'claude-opus', dependencies: [], createdAt: 1, updatedAt: 1, assignee: 'worker',
    }],
  })
  const { call } = pluginFixture(workspace)

  const result = await call('agent_teams_create_task', { bindModelTo: 't1', model: 'gpt-5-codex', subject: 'rebind attempt' })

  assert.equal(taskOnDisk(workspace, 't1').model, 'gpt-5-codex', '★ 未执行的任务必须真的改得动')
  assert.equal(result.model_binding.model, 'gpt-5-codex')
  assert.equal(result.task_id, 't1')
  /**
   * ★ 而"只改绑定"**不许顺手建一条新任务** —— 否则任务列表会被污染，
   *   而那条多余的任务与"真的想建的任务"在记录里**同形**。
   */
  assert.equal(readTeamSync(join(workspace, '.agent-teams'), 'team').tasks.length, 1, '★ 改绑定不建新任务')
})

test('臂 4c ★ 「改绑定不给 model」⇒ 拒绝，而不是把绑定抹掉', async () => {
  const workspace = freshWorkspace('rebind-nomodel')
  await seedTeam(workspace, {
    members: [member()],
    tasks: [{
      id: 't1', subject: 'pending', kind: 'work', status: 'pending',
      attempt: 0, model: 'claude-opus', dependencies: [], createdAt: 1, updatedAt: 1,
    }],
  })
  const { call } = pluginFixture(workspace)

  await assert.rejects(() => call('agent_teams_create_task', { bindModelTo: 't1', subject: 'no model given' }))
  /** ★ 关键：**旧的绑定还在** —— "改绑定失败"不能退化成"把绑定删了"。 */
  assert.equal(taskOnDisk(workspace, 't1').model, 'claude-opus')
})

test('臂 4d ★：改一条【不存在】的任务 ⇒ 拒绝（指名那条 id）', async () => {
  const workspace = freshWorkspace('rebind-missing')
  await seedTeam(workspace, { members: [member()] })
  const { call } = pluginFixture(workspace)

  await assert.rejects(
    () => call('agent_teams_create_task', { bindModelTo: 't999', model: 'gpt-5', subject: 'x' }),
    /t999/,
    '★ 拒绝要说清是哪一条不存在',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5（结构臂）：交付面**带不了**路由 —— 这条是"传播"读数的依据
// ─────────────────────────────────────────────────────────────────────────────

test('臂 5 ★ 结构臂：交付面没有路由位（所以"换掉一台在跑的机器"确实未接线）', async () => {
  /**
   * ── ★★★ 为什么这条臂必须存在，而且必须读【已安装的 Harness】而不是我的注释 ─────
   *
   * ★ 契约第四格要求"绑定到不到得了执行的那台机器"**被查实**。
   *   而一句"我查过了，传播不了"是**断言**，不是**证据** ——
   *   本队的纪律是：这种判断要有一个**别人复核得了的形式**。
   *
   * ⇒ 这条臂直接去读**装着的那个包的声明文件**：
   *   · 交付/恢复的签名里**有没有**一个路由参数？
   *   · 冷恢复是从**哪里**取回路由的？
   *
   * ★ 两问都指向同一个事实：**路由在【创建那一刻】冻进描述符**，
   *   此后每一次投递都带不上新的 —— 这就是"未接线"的机械证据本身。
   *
   * ★ 定向突变：若将来的 Harness 给 `sendMessage` 加了路由参数，
   *   这条臂会红 ⇒ 那时"未接线"这句话就该被重新查一遍（而不是继续抄）。
   */
  const continuation = readFileSync(
    join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-subagent', 'lib', 'types', 'continuation.d.ts'),
    'utf8',
  )
  const continuationJs = readFileSync(
    join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-subagent', 'lib', 'types', 'continuation.js'),
    'utf8',
  )

  /** ① 交付签名：`(sender, targetId, content, options)` —— **没有**路由位。 */
  const sendMessage = /sendMessage\(([^)]*)\)/.exec(continuation)
  assert.ok(sendMessage, '★ 必须找得到 sendMessage 的声明')
  assert.doesNotMatch(sendMessage[1], /model|provider|reasoning/i, '★ 交付签名里不该有路由位（若有了，传播读数必须重查）')

  /** ② 排队交付：`(parent, childId, content, source, signal)` —— 同样没有路由位。 */
  const queuePrompt = /queuePrompt\(([^)]*)\)/.exec(continuation)
  assert.ok(queuePrompt, '★ 必须找得到 queuePrompt 的声明')
  assert.doesNotMatch(queuePrompt[1], /model|provider|reasoning/i, '★ 排队交付签名里也不该有路由位')

  /**
   * ★ ③ 冷恢复**从描述符**取回路由（不是从调用方）。
   *   这是"路由在创建那一刻冻住"最直接的证据 —— 而它逐字写在注释里。
   */
  assert.match(continuation, /supplies every reconstruction input/i,
    '★ 冷恢复的注释说它从描述符取全部重建输入（★ 读 .d.ts —— 它是**契约声明面**，比实现更该被钉）')
  assert.match(continuationJs, /descriptor\.agentModel/,
    '★ 冷恢复重建时用的是**描述符里那个** model（不是调用方给的）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6/7（诚实臂 + 误报臂）：传播读数必须**两边都不恒真**
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 ★ 诚实臂：绑定与成员冻结路由【不一致】⇒ 读数必须明说 NOT applied', async () => {
  /**
   * ★ 这条臂防的是本契约第四格指名的那件事：
   *   **"交出一个被记录、却从未被应用过的绑定"**。
   * ⇒ 不一致时读数必须**明说没生效**，而不是记完就报成功。
   */
  const reading = describeModelBindingPropagation({ model: 'gpt-5-codex' }, 'claude-sonnet')
  assert.equal(reading.enforced, false, '★ 不一致 ⇒ enforced 必须显式 false')
  assert.match(reading.note, /NOT applied/, '★ 读数必须明说它没被应用')
  assert.match(reading.note, /claude-sonnet/, '★ 要说清**实际**会跑哪一个')
})

test('臂 7 ★ 误报臂：绑定与成员路由【一致】⇒ 读数必须说它会跑这个模型', async () => {
  /**
   * ★ 没有这一半，一个"恒报 NOT applied"的实现在臂 6 上也是绿的 ——
   *   而那个实现的问题是它**把真的接线好的情形也说成坏的**（误报）。
   *   两臂成对，断言才不恒真。
   */
  const reading = describeModelBindingPropagation({ model: 'claude-sonnet' }, 'claude-sonnet')
  assert.equal(reading.enforced, true, '★ 一致 ⇒ enforced true')
  assert.match(reading.note, /runs this model/, '★ 一致时要说"派出去的 worker 真的跑这个"')
  assert.doesNotMatch(reading.note, /NOT applied/, '★ 一致时不许说"没生效"')
})

test('臂 7b ★ 三态：没有可对照的成员 ⇒ 【不猜】，enforced 缺席而不是 false', async () => {
  /**
   * ★ "没能判定"与"判定为不一致"必须**不同形**（本队记账最久的那条纪律）。
   *   池任务（无 assignee）就没有可对照的对象 ⇒ 如实说"未能判定"。
   */
  for (const absent of [undefined, '', '   ']) {
    const reading = describeModelBindingPropagation({ model: 'gpt-5-codex' }, absent)
    assert.ok(!('enforced' in reading), `★ 没有对照对象时 enforced 必须**缺席**（输入 ${JSON.stringify(absent)}）`)
    assert.match(reading.note, /NOT established/, '★ 并如实说"没能查实"，而不是报一个 false')
  }
})

test('臂 7c ★ 参数两用途不许混：正在改绑定时，新建的任务**不**继承那一格', async () => {
  /**
   * ★ `model` 参数有两个用途（建新任务 / 改已有任务的绑定）。
   *   分不开的后果是具体的：一次改绑定会**顺手**给新建的那条也记上同一个模型 ——
   *   读的人看到两条任务的绑定一起变了，**归因不到是哪一次调用干的**。
   */
  assert.equal(
    describeModelBindingForCreate({ model: 'gpt-5', rebinding: true }), undefined,
    '★ 正在改绑定时，新任务不许继承那一格',
  )
  assert.deepEqual(
    describeModelBindingForCreate({ model: 'gpt-5', rebinding: false }),
    { model: 'gpt-5' },
    '★ 正常建档时它才是新任务的绑定',
  )
  assert.equal(describeModelBindingForCreate({ rebinding: false }), undefined)
  assert.equal(describeModelBindingForCreate({ model: '   ', rebinding: false }), undefined, '★ 空白不是一个模型')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8（回读臂）：`output.schema` 必须容得下**真的**返回值
// ─────────────────────────────────────────────────────────────────────────────

test('臂 8 ★ 回读臂：绑定的返回值过得了工具**自己**的 output schema', async () => {
  /**
   * ── ★★★ 这条臂来自本队同族形态第 9 次（见 create-task.ts 里那段记账）──────────
   *
   * MEASURED：`output.schema` 是 `additionalProperties: false`，而**加了返回值
   *   却没加声明** ⇒ 宿主在 `createSuccessResult` 里抛 `ToolOutputError`
   *   ⇒ ★ **这个工具每次调用都失败**（比"少一个字段"严重得多）。
   *
   * ★ 所以这里必须走**宿主自己的校验器**，而不是自己写一遍"字段在不在 properties 里"：
   *   自己写的那份是**第二份真相**，它会与宿主的语义（required / 嵌套 / 三态）
   *   慢慢分叉，而分叉之后"夹具说通过了"与"宿主真的会接受"不再同形。
   *
   * ── ★★★ 而"宿主自己的校验器"长什么样，是我【实测】出来的（两次修正）──────────
   *
   * ★ 第 ① 次修正是**接口**：`validateJsonSchemaValue(schema, value, path)` **返回
   *   一个违规数组**，它**不抛**。我第一版写的是 `assert.throws(...)` ——
   *   那条断言在**任何**输入下都红（因为什么都不抛），
   *   而它红的样子（"缺少期望的异常"）读起来像是 schema 坏了。
   *   ⇒ ★ 一个**用错接口**的断言，它的失败信息会把人指向错误的方向。
   *
   * ★ 第 ② 次修正是**语义**：我据此一度以为"本仓的校验器不强制
   *   `additionalProperties`"。**那个结论是错的** —— 错在我拿一份**裸 JSON Schema**
   *   直接喂它（省略了 DSL 的转换）。喂对了之后它**真的**报：
   *   `"v.b" is not a declared property (additionalProperties: false)`
   *   ⇒ ★ 而这里正是那格读数该被记下来的地方：**"校验器不检查"这个结论，
   *     与"我喂错了它的输入"在当时的观测上同形。**
   *
   * ⇒ 本臂因此只做一件事：把**真的返回值**交给**那个真会用的校验器**，断言违规为空。
   */
  const { validateJsonSchemaValue } = await import('@deepseek-ai/dsh-tools')
  const workspace = freshWorkspace('schema')
  await seedTeam(workspace, { members: [member()] })
  const { tools, call } = pluginFixture(workspace)
  const schema = tools.get('agent_teams_create_task').output.schema

  /** 真的产出那个值 —— 不是手写一个像它的对象。 */
  const created = await call('agent_teams_create_task', {
    subject: 'schema check', kind: 'work', model: 'gpt-5-codex', assignee: 'worker',
    reviewed: reviewedStamp(),
  })
  assert.deepEqual(
    validateJsonSchemaValue(schema, created, 'value'), [],
    '★ 真的返回值必须过得了自己的 schema（违规数组必须为空）',
  )
  assert.equal(created.model_binding.enforced, false, '★ 绑定与成员路由不一致 ⇒ 读数必须说没生效')
  assert.match(created.model_binding.note, /NOT applied/, '★ 而这一句必须真的随着返回值交出去')

  /**
   * ── ★★ 对照半边（让这条臂不恒真）────────────────────────────────────────────
   *
   * ★ 没有这一半，一个写错的调用（永远返回 `[]`）也能让它绿 ——
   *   而那正是我上面第 ① 次修正撞到的形状。
   * ⇒ 拿掉一个**真的**字段，违规数组必须**非空**且**指名那一格**。
   */
  const withoutTaskId = { ...created }
  delete withoutTaskId.task_id
  const violations = validateJsonSchemaValue(schema, withoutTaskId, 'value')
  assert.ok(
    violations.length > 0,
    '★ 拿掉一个真的必填字段必须报违规 —— 否则"违规为空"这句话没有约束力',
  )
  assert.match(violations.join('; '), /task_id/, '★ 而报告必须**指名**是那一格缺了')

  /**
   * ★★ 而第二半对照钉的是**名字**（本任务实测撞到的那一次，见 create-task.ts 的记账）：
   *   `member_model` 这一格，我第一版**产出的**名字是 `memberModel`
   *   ⇒ 它**通不过**这条 schema。⇒ 所以这里把"名字对不上"这件事故意造出来，
   *   要求校验器**报它** —— 否则上面那条"违规为空"也就证明不了名字是对的。
   *
   * ★ 为什么值得单独钉：这是**本队同族形态第 10 次**（改了产出没改声明 / 名 A 产 B），
   *   而它的表现是**工具整个坏掉**，不是"少一个字段"。
   */
  const wrongName = {
    ...created,
    model_binding: { ...created.model_binding, memberModel: 'claude-sonnet' },
  }
  const nameViolations = validateJsonSchemaValue(schema, wrongName, 'value')
  assert.ok(
    nameViolations.some((line) => /memberModel/.test(line)),
    '★ 产出的名字与声明的不一致时必须被报出来（那正是把工具整个弄坏的那种错）',
  )
})
