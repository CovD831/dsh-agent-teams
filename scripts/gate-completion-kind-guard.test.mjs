/**
 * ── ★★ 普查臂：所有 completion 判据的 kind 守卫必须**一致**（t48）────────────────
 *
 * ── 它防的是什么失效（integrator6 发现，我独立复现）──────────────────────────────
 *
 * MEASURED：`src/gates/completion/backtest.ts` 的 `appliesTo` **没有 kind 守卫**：
 *
 *     appliesTo({ task: { kind: 'integration' }, update: { changedPaths: ['a','b','c','d'] } })
 *         ⇒ **true**
 *
 * 而它的**文档注释逐字写着自己该守**（「只对【声明了改动文件】的【实现/修复】任务生效」）。
 * 同族另外两条都守着：
 *
 *     r5.ts:116        `if (kind !== 'implementation' && kind !== 'repair') return false`
 *     mutation.ts:194  同上
 *     backtest.ts      ★ 漏了
 *
 * ── 后果为什么是 f-0020 级 ────────────────────────────────────────────────────
 *
 * 非写域类任务（integration / verification / review）**只要诚实申报 changedPaths**
 * 就被这条判据审判，而 `baseline` 对这类任务**根本不存在**（不是"还没算出来"，
 * 是"这个概念不适用"）⇒ **恒 unmeasured ⇒ 恒交不出终态**。
 *
 * ★ 而"诚实申报 changedPaths"恰恰是本队**奖励**的行为（`dispatch.changed-paths`
 *   专门堵不申报）⇒ 这条缺陷惩罚的正是最诚实的任务。
 * ★ 形态：与 f-0020 完全相同（**一个永远打不开的门**），只换了触发条件
 *   （「repair 没有新测试」→「非写域任务没有 baseline」）。
 *
 * ── ★★ 为什么修法是【普查臂】而不是那一行 ───────────────────────────────────────
 *
 * 三条判据**各写各的守卫**，而"它们一致"这件事**没有任何机制保证**。
 * ⇒ 漏一个就多一类交不出终态的任务，**而它不会在别处留下痕迹**。
 * ⇒ 所以本文件断言的不是"backtest 现在有守卫了"，而是**这一族的一致性**：
 *    **任何一条 completion 判据，只要它的 `appliesTo` 读 `changedPaths`，
 *      就必须同时有 kind 守卫。**
 *
 * ★ 与 t15 的 output schema 普查臂同构：那一份断言"所有工具的产出面与声明面一致"，
 *   这一份断言"所有 kind 敏感判据的闸门一致"。两者的价值都在**抓未来的第 N 次**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseKindRequirements } from '../lib/gates/completion/r5.js'
import * as backtest from '../lib/gates/completion/backtest.js'
import * as mutation from '../lib/gates/completion/mutation.js'
import * as r5 from '../lib/gates/completion/r5.js'
import * as verifyRerun from '../lib/gates/completion/verify-rerun.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMPLETION_DIR = join(ROOT, 'src', 'gates', 'completion')

/**
 * ★ t54：真的那张表 —— 本文件的臂既用**它**做缺省，也用它证明"改表 ⇒ 行为变"。
 *   ★ 从**盘上**读（与生产同一条数据），而不是手搓一份替身。
 */
function loadKindRequirementsForFixture() {
  return parseKindRequirements(JSON.parse(readFileSync(join(COMPLETION_DIR, 'kind-requirements.json'), 'utf8')))
}

/**
 * ── 这一族的口径（**最重要的一格**）────────────────────────────────────────────
 *
 * ★ 「所有 completion 判据都要有 kind 守卫」是**错的** ——
 *   `verify-rerun` **有意**对所有 kind 生效：它重跑契约声明的 verify 命令，
 *   而"verify 被真的跑过"是**每一类**任务的义务（`work` 类也一样有 verify 吗？
 *   见下面的边界）。⇒ 一条"四选四都必须有守卫"的普查臂会**误伤**它，
 *   而误伤会让下一个人把 verify-rerun 的闸门改错以迎合本文件。
 *
 * ★ 所以本文件的口径是**条件式**的，而条件是**载荷**（payload）：读 `changedPaths` 的判据必须守 kind。
 *
 *   为什么是 changedPaths？因为它是**类型专属的契约字段**：
 *
 *     · `implementation` / `repair` 的契约**要求**它（成员必须申报改了什么）
 *     · 其余 kind **不要求**它 —— 所以它们身上出现 changedPaths 是**偶然的**
 *       （诚实申报、宿主事件、上游注入…），而不是**契约要求**的
 *
 *   ⇒ 一个按 `changedPaths` 决定说不说话的判据，会在**不要求那个字段的 kind**
 *     上被**偶然**触发 —— 而它要的 baseline 在那里不存在。
 *     ★ 这正是"读了一个只在某些 kind 上成立的字段，却没有守 kind"这个**一般形态**。
 */

/** 一个"什么都给了"的 ctx：`appliesTo` 的每个闸门都能满足。 */
function fullContext(kind) {
  return {
    wantsCompleted: true,
    taskNotTerminal: true,
    task: { kind, verify: ['pnpm verify'], inScope: ['src/a.ts'], changedPaths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] },
    update: { changedPaths: ['a.ts', 'b.ts', 'c.ts', 'd.ts'], newTestFiles: ['scripts/x.test.mjs'] },
  }
}

const GATES = {
  backtest,
  r5,
  mutation,
  'verify-rerun': verifyRerun,
}

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1（普查臂）：读了 changedPaths 的判据必须守 kind —— 而它抓未来的第 N 次
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 1（普查臂）：凡 `appliesTo` 读 `changedPaths` 的判据，都不许对非写域类 kind 生效', () => {
  /**
   * ── ★★ 这一臂必须能抓【未来的第 N 次】，而不是"当前三条都对" ──────────────────
   *
   * 做法：**不列举**那三条的名字，而是
   *   ① 从**目录**里发现全部 completion 判据（新增一条就自动进集合）；
   *   ② 从**源码**判断它读不读 `changedPaths`（读 ⇒ 它是 kind 敏感的）；
   *   ③ 对每一个 kind-敏感的判据，断言它在非写域类 kind 上 `appliesTo === false`。
   *
   * ⇒ 新增一条读 changedPaths 而没有 kind 守卫的判据 ⇒ **本臂红**。
   */
  /**
   * ★ t54：**排除非判据的纯模块** —— `kind-requirements.ts` 住在这个目录里，
   *   而它**不是判据**（它没有 `appliesTo`/`gate`，它与 `../requires.ts` 同类）。
   *   ★ 不排除它，本臂会把"共享模块没有 appliesTo"报成缺陷。
   *   ⇒ 判据的**判别式**仍然是"它有 `appliesTo`"（下面那句断言），
   *     而这里的过滤只是把明显不是判据的文件先摘掉。
   */
  const NON_GATE_MODULES = new Set(['kind-requirements.ts'])
  const sources = readdirSync(COMPLETION_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts') && !NON_GATE_MODULES.has(name))
  assert.ok(sources.length > 0, '★ 判据目录必须扫得到文件 —— 否则本臂在空集合上恒真')

  const kindSensitive = []
  for (const name of sources) {
    const source = readFileSync(join(COMPLETION_DIR, name), 'utf8')
    /**
     * ★ 判"读不读 changedPaths"用源码扫描，而**不是**用一个启发式的行为探测 ——
     *   因为行为探测会在"它恰好没触发"时漏掉（那正是 backtest 当初的形状）。
     *   `appliesTo` 的函数体里出现 `changedPaths` ⇒ 它按那个字段决定说不说话。
     */
    const body = /export function appliesTo[\s\S]*?\n}/.exec(source)
    assert.ok(body !== null, `★ ${name} 里找不到 appliesTo —— 它是 completion 判据的必备导出`)
    if (body[0].includes('changedPaths')) kindSensitive.push({ name, body: body[0] })
  }

  /**
   * ★ 反向半边（防恒真）：这个集合**不许为空**。
   *   一个空集合会让下面全部断言恒真 —— 而那正是"普查臂看着对、其实什么都没查"。
   *   语料今天有 backtest（它读 changedPaths）⇒ 集合非空是可断言的。
   */
  assert.ok(
    kindSensitive.some((entry) => entry.name === 'backtest.ts'),
    `★ backtest.ts 必须被认成 kind 敏感（它读 changedPaths）—— 否则扫描口径错了。实测集合：${JSON.stringify(kindSensitive.map((entry) => entry.name))}`,
  )

  const violations = []
  for (const { name } of kindSensitive) {
    const module = GATES[name.replace(/\.ts$/u, '')]
    assert.ok(module !== undefined, `★ ${name} 在 lib/ 里没有对应的已构建模块 —— 夹具的自检（避免对未构建的文件断言）`)
    for (const kind of ['integration', 'verification', 'review']) {
      if (module.appliesTo(fullContext(kind)) === true) {
        violations.push(`${name} applies to kind="${kind}" (a kind whose contract does not require changedPaths)`)
      }
    }
  }
  assert.deepEqual(
    violations, [],
    '★ 这些判据按 `changedPaths` 决定说不说话，却对**不要求那个字段的 kind** 生效 ⇒ '
    + '它们会在非写域类任务上被偶然触发，而它们要的 baseline 在那里根本不存在 '
    + '⇒ 恒 unmeasured ⇒ 恒交不出终态（f-0020 的同一形态）',
  )

  console.log(`[t48 普查] 扫描 ${sources.length} 条 completion 判据；其中 kind 敏感（读 changedPaths）的：${JSON.stringify(kindSensitive.map((entry) => entry.name))}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2（★ 一致性臂）：同族三条的守卫口径必须**逐字一致**
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 2（★ 一致性臂，t54 改造）：同族三条都【问表】—— 而不是各自写死名单', () => {
  /**
   * ── ★★ 这一臂的判法在 t54 被**换过**，而换的理由本身是结论 ────────────────────
   *
   * MEASURED（t48）：它此前断言三条的 kind 守卫**逐字相同**
   *   （`if (kind !== 'implementation' && kind !== 'repair') return false`），
   *   因为"三条各写各的"正是那次缺陷的成因。
   *
   * ★ 而 t54 把那张名单**移进了数据表** ⇒ 三条现在都写 `gateRequirementFor(…)`，
   *   而"逐字相同"这条断言因此**必然红** —— 它红得对：形状真的变了。
   *
   * ⇒ 判法换成**更强的**那条：三条都必须**问表**（`gateRequirementFor`），
   *   且都**不许**再出现写死的 kind 名单。
   *   ★ 这比"三处写法相同"更强：写法相同只保证它们此刻一致，
   *     而"都问同一张表"保证它们**由同一个来源决定**（表改了三条一起改）。
   */
  const family = ['backtest.ts', 'r5.ts', 'mutation.ts']
  const notAsking = []
  const stillHardcoded = []
  for (const name of family) {
    const source = readFileSync(join(COMPLETION_DIR, name), 'utf8')
    const body = /export function appliesTo[\s\S]*?\n}/.exec(source)
    assert.ok(body !== null, `★ ${name} 里找不到 appliesTo`)
    if (!body[0].includes('gateRequirementFor(')) notAsking.push(name)
    /**
     * ★ 而写死的名单必须**gone** —— 否则两条来源并存，而它们会在下一次分叉。
     *
     * ★ **剥掉注释再查**：这些文件的注释里**刻意**引用了那条旧写法
     *   （说明"此前是什么、为什么改"），而它们不是代码。
     *   ⇒ 不剥注释的话，本臂会把"诚实地记下历史"报成"仍然硬编码"。
     */
    const code = body[0]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
    if (/kind !== 'implementation' && kind !== 'repair'/.test(code)) stillHardcoded.push(name)
  }
  assert.deepEqual(notAsking, [], `★ 这一族（${family.join(' / ')}）的 kind 守卫必须**问表**（gateRequirementFor）`)
  assert.deepEqual(
    stillHardcoded, [],
    '★ 这些文件里仍留着写死的 kind 名单 ⇒ 表与硬编码**两条来源并存**，而它们会在下一次分叉',
  )

  /** ★ 反向半边：这一族**恰好**是这三条 —— `verify-rerun` 有意不守 kind。 */
  const rerun = readFileSync(join(COMPLETION_DIR, 'verify-rerun.ts'), 'utf8')
  const rerunBody = /export function appliesTo[\s\S]*?\n}/.exec(rerun)
  assert.ok(rerunBody !== null)
  assert.equal(
    rerunBody[0].includes('gateRequirementFor('), false,
    '★ verify-rerun **有意**对所有 kind 生效（它重跑 verify，是每类任务的义务）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3（★ 诱导复现臂）：原缺陷的形状必须被挡住
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 3（诱导复现）：诚实申报 changedPaths 的非写域任务**不许**被审判', () => {
  /**
   * ★ 这一臂复现的是 integrator6 那个真实场景，并且钉住"最坏的那一半"：
   *   **它惩罚的是最诚实的任务。**
   */
  const honestIntegration = {
    wantsCompleted: true,
    taskNotTerminal: true,
    task: { kind: 'integration' },
    update: { changedPaths: ['src/a.ts', 'lib/a.js', 'src/b.ts', 'lib/b.js'] },
  }
  assert.equal(
    backtest.appliesTo(honestIntegration), false,
    '★ 一个**诚实申报了改动文件**的 integration 任务不许被 backtest 审判 ——'
    + ' baseline 对这类任务不存在 ⇒ 审判它就是让它恒交不出终态',
  )

  /**
   * ★ 而反向半边：**repair** 仍然被审判（没有过度收紧）。
   *   ★ t54：这一格现在需要**表** —— 因为 kind 守卫改成问表了，
   *     不注入表就等价于"没能测量"（门不说话），而那不是"过度收紧"。
   */
  const table = loadKindRequirementsForFixture()
  assert.equal(
    backtest.appliesTo({ ...honestIntegration, loadKindRequirements: () => table, task: { kind: 'repair' } }), true,
    '★ repair 申报了 changedPaths ⇒ 必须仍然生效（否则这一臂对"恒 false 的实现"没有分辨力）',
  )
  /** ★ 而 implementation 也必须生效（表里那三样最大的那一条）。 */
  assert.equal(
    backtest.appliesTo({ ...honestIntegration, loadKindRequirements: () => table, task: { kind: 'implementation' } }), true,
  )
})

test('★ 臂 3b（边界）：kind 缺席（= work）不许生效', () => {
  /**
   * ★ `kind` 缺席在契约里读作 `work`（与 `taskKindOf` 同一口径）——
   *   而 `work` 类**不**要求 changedPaths ⇒ 它也不该被审判。
   *   ★ 这一格容易被漏：一个只写 `if (kind === 'integration') return false` 的守卫
   *     会在 kind 缺席时放行。
   */
  assert.equal(
    backtest.appliesTo({ wantsCompleted: true, taskNotTerminal: true, task: {}, update: { changedPaths: ['a.ts'] } }),
    false,
    '★ kind 缺席 = work ⇒ 不许生效',
  )
  assert.equal(
    backtest.appliesTo({ wantsCompleted: true, taskNotTerminal: true, update: { changedPaths: ['a.ts'] } }),
    false,
    '★ 连 task 都没有 ⇒ 同样不许生效',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4（★ 未被普查误伤的臂）：verify-rerun 的闸门形状不许被本文件改变
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 4（不误伤臂）：普查口径不许要求 verify-rerun 加 kind 守卫', () => {
  /**
   * ★ 这一臂保护的是**普查臂本身**：一条口径过宽的普查臂会逼人改错真相邻的判据。
   *
   *   `verify-rerun` 的设计：它重跑契约里声明的 verify 命令 ——
   *   那是**每一类**任务的义务（一个 integration 任务也要能证明它跑过自己的测试）。
   *   ⇒ 它**该**对所有 kind 生效。
   *
   * ★ 而它的"不许被审判"由**另外三格**保证：`wantsCompleted` / `taskNotTerminal` /
   *   `task.verify` 非空 —— 那三格缺席时它不说话。⇒ 它有自己的门，只是不是 kind。
   */
  assert.equal(
    verifyRerun.appliesTo({ wantsCompleted: false, taskNotTerminal: true, task: { kind: 'integration', verify: ['x'] } }),
    false,
    '★ 它的门是 wantsCompleted —— 缺了就沉默（与 kind 守卫不同的门，但同样是门）',
  )
  assert.equal(
    verifyRerun.appliesTo({ wantsCompleted: true, taskNotTerminal: true, task: { kind: 'integration' } }),
    false,
    '★ task.verify 缺席 ⇒ 沉默',
  )
  assert.equal(
    verifyRerun.appliesTo({ wantsCompleted: true, taskNotTerminal: true, task: { kind: 'integration', verify: [] } }),
    false,
    '★ verify 为空 ⇒ 沉默（空的命令清单不是"要重跑的东西"）',
  )
})
