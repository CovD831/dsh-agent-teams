/**
 * ── 判据：AgentTeams 的缺陷**不许**拖垮宿主的整棵插件树（t18）────────────────────
 *
 * ── 借来的设计（`@linxin666/dsh-web-all` 的 shell/degraded）──────────────────────
 *
 * 它 README 里把问题说得很直白：DSH 的 Loader 把 patch 的每一行当作**同一次挂载
 * 事务**里的一个插件，于是任何**一个**插件的 import / start 失败，都可能让
 * `dsh web` 整个起不来。它的答案是给每个插件套一个**永不抛错的外壳**，
 * 再加一条**只回环可达**的健康路由，列出到底哪个插件降级了、降在哪一步。
 *
 * ★ 而本仓库**已经真实发生过一次**：一个 `ERR_MODULE_NOT_FOUND` 让桌面 UI
 *   卡在 'starting'，一整棵插件树挂载失败。
 *
 * ── ★★★ 本夹具的第一条断言是【实测出来的】，而它修正了任务的表述 ─────────────────
 *
 * MEASURED（t18，本机 cordis 4.0.4）：`ctx.plugin()` 对 `apply()` 抛错**已经**
 * 是隔离的 —— 同步抛出被 `composeError` 捕获，**不冒给调用方**，兄弟插件照常挂载。
 * （见下面「臂 1：宿主那一层已经隔离了」——它把这个前提**钉住**，
 * 因为若哪天 cordis 改成向上抛，本判据的全部结论都要重估。）
 *
 * ⇒ ★★ 所以真正的缺口**不是**"宿主会崩"，而是**失败了读不出来**：
 *   错误只落进 `ctx.logger.error(...)` 一行，而**读不到原文的失败与健康启动
 *   在观测上同形** —— 这正是本队记账最久的形态，也正是契约原话要求
 *   "用路由而不是只用控制台"的原因。
 *
 * ── 四臂（契约 §6 的三臂 + 本任务特有的第四臂）────────────────────────────────────
 *
 *   臂 1  ★ 前提臂：宿主那一层**已经**隔离（补丁/回归两用的读数）
 *   臂 2  ★★★ 核心：注入一个**抛错的插件**，确认周边树**仍然挂载** + 我们降级可读
 *   臂 3  ★★ 三态臂：healthy / degraded / not-mounted **两两不同形**
 *   臂 4  ★★★ 定向突变：把外壳换成"吞掉异常"或"照抄原样" ⇒ 对应臂必须红
 *
 * ── ★★ 反向半边（防恒真）───────────────────────────────────────────────────────
 *
 * 每一条"降级"断言都必须与一条"健康"断言**成对**：一个"恒报 degraded"的外壳
 * 同样能让臂 2 全绿。⇒ 臂 2 里健康那半边是**必须**的。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

import { degradedEntryOf, loopbackOnlyRoute, pluginShell } from '../lib/web-routes.js'

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1：★ 前提臂 —— 宿主那一层**已经**隔离（这是本判据全部结论的地基）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★ 前提臂：一个 apply() 抛错的插件不会让兄弟插件挂不上（cordis 已隔离）', async () => {
  /**
   * ── 这一臂为什么必须存在，即使它"没在测我们的代码"────────────────────────────────
   *
   * 本任务的全部论证都建立在一个**外部依赖**的行为上：
   *
   *     一个插件的 apply() 抛错 ⇒ cordis 把它隔离 ⇒ 兄弟照常挂载
   *
   * ★★ 而**外部依赖的当前行为**必须被**当场测量**，不能靠假设：
   *   若哪天 cordis 改成把 `apply` 的抛出向上冒给调用方，
   *   那么"我们套一个外壳就够了"这句话就不成立了 —— 而**本判据会红**，
   *   于是读的人知道要重估，而不是继续相信一句已经过期的结论。
   *
   * ★ 这正是本队那条纪律：**一句话里的每个名词，要能指出它的来源。**
   *   这里的来源就是：本臂现在跑出来的读数。
   */
  const ctx = new Context()
  const errors = []
  ctx.logger.error = (...parts) => { errors.push(parts.map(String).join(' ')) }

  const mounted = []
  ctx.plugin({ name: 't18-healthy-before', apply: () => { mounted.push('before') } })

  /**
   * ★ 抛错的那一个：它模拟的正是"我们这一行自己坏了"。
   */
  let threwOut = false
  try {
    ctx.plugin({ name: 't18-thrower', apply: () => { throw new Error('t18 probe: apply failed') } })
  } catch {
    threwOut = true
  }

  ctx.plugin({ name: 't18-healthy-after', apply: () => { mounted.push('after') } })
  /** 让 fiber 的错误路径跑完（execute 的同步抛出在这里被消化）。 */
  await new Promise((resolve) => setTimeout(resolve, 30))

  console.log(`    ℹ 隔离前提实测：兄弟挂载 = ${JSON.stringify(mounted)} · 向外抛出 = ${threwOut}`)
  console.log(`    ℹ 宿主记录到的错误 = ${JSON.stringify(errors.map((line) => line.slice(0, 60)))}`)

  assert.equal(threwOut, false, '★ `ctx.plugin()` 把 apply 的抛出冒给了调用方 —— 隔离前提变了，本判据要重估')
  assert.deepEqual(
    mounted, ['before', 'after'],
    '★ 一个插件抛错后，它**前后**的兄弟都必须照常挂载 —— 这正是"同一棵插件树没被拖垮"的字面含义',
  )

  /**
   * ── 而这条读数**同时**是本任务的缺口证据 ────────────────────────────────────────
   *
   * ★ 失败**只**在日志里。一句 `ctx.logger.error` 会在滚动中消失，
   *   而**读不到原文的失败与健康启动在观测上同形**。
   * ⇒ 它就是"为什么必须有那条路由"的可执行理由，而不是一句主张。
   */
  assert.ok(
    errors.some((line) => /t18 probe: apply failed/.test(line)),
    '★ 宿主应当把失败记进日志（那是我们唯一的"读得到"出口，也正是要补上的那一格）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2：★★★ 核心臂 —— 注入一个抛错的插件，周边树照常挂载，且降级**可读**
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 2（核心）：注入抛错的 apply ⇒ 外壳不抛、状态可读、兄弟照常挂载', async () => {
  /**
   * ── 真实形状：三个插件，中间那一个（= 我们）坏掉 ─────────────────────────────────
   *
   * ★ 而断言分成**两半**，它们必须成对（见文件头"反向半边"）：
   *     降级那半：坏掉的那个 ⇒ `degraded` + 阶段 + 原文
   *     健康那半：好着的那些 ⇒ `healthy`，**且一条降级记录都没有**
   */
  const ctx = new Context()
  ctx.logger.error = () => {}

  const shelled = (name, apply) => {
    const shell = pluginShell(name, { apply })
    ctx.plugin({ name, apply: () => { void shell.mount() } })
    return shell
  }

  const before = shelled('t18-sibling-before', () => {})
  /** ★ 这就是"我们这一行"：apply 抛错。 */
  const ours = shelled('t18-agent-teams-probe', () => { throw new Error('t18 probe: this plugin failed') })
  const after = shelled('t18-sibling-after', () => {})

  await new Promise((resolve) => setTimeout(resolve, 30))

  console.log(`    ℹ 坏掉那个的状态 = ${JSON.stringify(ours.status)}`)
  console.log(`    ℹ 兄弟（前）       = ${before.status.state} · 兄弟（后） = ${after.status.state}`)

  /** ── 降级那半 ─────────────────────────────────────────────────────────────── */
  assert.equal(
    ours.status.state, 'degraded',
    '★★★ 一个 apply 抛错的外壳必须报 `degraded` —— 否则失败被吞成了"看起来没事"',
  )
  assert.equal(ours.status.degraded.length, 1, '★ 恰好一条降级记录')
  assert.equal(ours.status.degraded[0].stage, 'apply', '★ 阶段必须指名（`apply` 而不是笼统的"失败了"）')
  assert.match(
    ours.status.degraded[0].reason, /t18 probe: this plugin failed/,
    '★★★ 原文必须**原样**带出来 —— 一句"发生了错误"读的人无从补救',
  )

  /** ── 健康那半（反向半边：防"恒报 degraded"的实现蒙混过关）──────────────────── */
  assert.equal(before.status.state, 'healthy', '★ 没坏的插件必须报 `healthy`')
  assert.deepEqual(before.status.degraded, [], '★ 健康时**不许**造一条降级记录出来')
  assert.equal(after.status.state, 'healthy', '★ 抛错的那个**之后**的兄弟同样必须 healthy')

  /**
   * ── 而"周边树仍然挂载"这件事，由**三态都读得到**来证明 ───────────────────────────
   * ★ 若我们那一下把整棵树拖垮了，后一个兄弟根本不会走到 `mount()`，
   *   它的状态就会停在 `not-mounted` —— 而那与 `healthy` **不同形**（见臂 3）。
   */
  assert.notEqual(
    after.status.state, 'not-mounted',
    '★★ 抛错之后，后面的兄弟仍然**真的**挂载了（而不是停在"没挂过"）',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3：★★ 三态臂 —— healthy / degraded / not-mounted 两两不同形
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 3 三态臂：`healthy` / `degraded` / `not-mounted` 不许合并', async () => {
  /**
   * ── 第三态为什么必须单独存在 ────────────────────────────────────────────────────
   *
   * `not-mounted`（外壳建好了、但**从没被调用**）与 `healthy`（跑完了、没事）
   * 在只读一个布尔值的实现里**同形** —— 而那会把
   * 「宿主压根没挂这一行 / patch 漏了这一行」读成「一切正常」。
   *
   * ★ 这是本队反复记账的合流（"没测到"并进"通过"）在**挂载**这一格的实例。
   */
  const before = pluginShell('t18-probe', { apply: () => {} })
  const healthy = pluginShell('t18-probe', { apply: () => {} })
  await healthy.mount()
  const degraded = pluginShell('t18-probe', { apply: () => { throw new Error('x') } })
  await degraded.mount()

  const states = {
    'before mount': before.status.state,
    healthy: healthy.status.state,
    degraded: degraded.status.state,
  }
  console.log(`    ℹ 三态实测：${JSON.stringify(states)}`)

  assert.equal(before.status.state, 'not-mounted', '★ 外壳建好而没被调用 ⇒ `not-mounted`（**不是** healthy）')
  assert.equal(healthy.status.state, 'healthy')
  assert.equal(degraded.status.state, 'degraded')

  /** ★ 两两不同形 —— 逐对写，不循环（漏掉哪一对都看不出来）。 */
  assert.notEqual(before.status.state, healthy.status.state, '★ `not-mounted` 与 `healthy` 必须不同形')
  assert.notEqual(healthy.status.state, degraded.status.state, '★ `healthy` 与 `degraded` 必须不同形')
  assert.notEqual(before.status.state, degraded.status.state, '★ `not-mounted` 与 `degraded` 必须不同形')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4：★★★ 定向突变 —— 把外壳拆掉 ⇒ 对应臂必须红
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 4 定向突变：吞掉异常 / 照抄原样 ⇒ 本判据的断言必须翻脸', () => {
  /**
   * ── 规则二后半句：「把机制单独去掉，臂必须红。」──────────────────────────────────
   *
   * ★ 为什么用**对照实现**而不是改产品源码：那是本队既有的做法
   *   （见 `verify-unmeasured-consumers.test.mjs` 臂 4 的长注释），
   *   而且它把"臂 2 的失败模式（恰好也绿）"排除掉。
   *
   * 两个端点：
   *   `honest`    —— 外壳的形状（接住 + 报三态）        ← 应当的形状
   *   `swallowed` —— ★ 吞掉异常、并**照报 healthy**     ← 被拆掉机制之后的形状（最坏的那种）
   */
  const honest = (apply) => {
    try { apply() } catch { return { state: 'degraded' } }
    return { state: 'healthy' }
  }
  /** ★ 这就是"把机制拆掉"的版本：异常被吞，而世界看起来是健康的。 */
  const swallowed = (apply) => {
    try { apply() } catch { /* 吞掉 */ }
    return { state: 'healthy' }
  }

  const boom = () => { throw new Error('t18 probe: boom') }

  /** ★ 臂 2 的核心断言在两个端点上给出**相反**结论 —— 这就是它测到了机制的证据。 */
  assert.equal(honest(boom).state, 'degraded', '★ honest 端必须报 degraded（否则它不是"应当的形状"）')
  assert.equal(
    swallowed(boom).state, 'healthy',
    '★★★ swallowed 端必须报 healthy —— 那正是最坏的形态："吞掉异常然后报健康"',
  )
  assert.notEqual(
    honest(boom).state, swallowed(boom).state,
    '★★★ 两个端点在"一次抛错"上必须给出**相反**结论：\n'
    + '   ⇒ 否则臂 2 的断言在一个"吞掉异常"的实现上照样绿 —— 而那正是本臂要排除的失败模式。\n'
    + '   ★ 为什么"吞掉并报健康"比不隔离更坏：它把一次【可见的崩溃】换成一次【静默的半吊子启动】。',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5：★★★ 可读出口 —— 降级状态必须能**从路由读出来**，且回环围栏正确
// ─────────────────────────────────────────────────────────────────────────────

test('★★★ 臂 5 可读出口臂：降级状态经路由可读，且非回环请求读不到', async () => {
  /**
   * 契约原话：「**把失败状态通过一条路由报出来**，而不是只报在控制台 ——
   *   因为一行控制台会消失，而**读不到原文的失败与健康启动同形**。」
   *
   * ★★ 而它同时要防**泄露**：一条"我为什么没挂起来"的路由会说出模块路径与错误原文
   *   （`ERR_MODULE_NOT_FOUND` 里就带绝对路径）。⇒ 只许**回环**访问。
   */
  const routes = new Map()
  const host = {
    register(route) {
      assert(!routes.has(route.path), `duplicate route: ${route.path}`)
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }

  const shell = pluginShell('t18-agent-teams', { apply: () => { throw new Error('t18 probe: could not mount') } })
  await shell.mount()
  loopbackOnlyRoute(host, '/plugins/dsh-agent-teams/degraded', () => shell.status)

  const route = routes.get('/plugins/dsh-agent-teams/degraded')
  assert.notEqual(route, undefined, '★ 降级路由必须真的被注册了（否则"可查询"只是一句主张）')

  /** 一个最小 res 桩：把状态码与响应体都记下来 —— 两者都是读数。 */
  const call = async (remoteAddress) => {
    const captured = { status: undefined, body: '' }
    const res = {
      writeHead(status) { captured.status = status; return res },
      end(chunk) { if (chunk !== undefined) captured.body = String(chunk); return res },
    }
    await route.handler({ method: 'GET', url: '/plugins/dsh-agent-teams/degraded', socket: { remoteAddress } }, res)
    return captured
  }

  const loopback = await call('127.0.0.1')
  const remote = await call('10.1.2.3')

  console.log(`    ℹ 回环 ⇒ ${loopback.status} ${loopback.body.slice(0, 90)}`)
  console.log(`    ℹ 非回环 ⇒ ${remote.status} ${JSON.stringify(remote.body)}`)

  /** ── 回环：**读得到**那条降级，连原文一起 ───────────────────────────────────── */
  assert.equal(loopback.status, 200, '★ 本机排障的人必须读得到它')
  const payload = JSON.parse(loopback.body)
  assert.equal(payload.state, 'degraded', '★ 路由必须如实说"我降级了"')
  assert.match(
    JSON.stringify(payload), /t18 probe: could not mount/,
    '★★★ 原文必须随响应体一起出来 —— "这个插件为什么没挂起来"必须**不读宿主日志**就能回答',
  )
  assert.equal(payload.degraded[0].stage, 'apply', '★ 阶段要读得出来（降在哪一步）')

  /** ── 非回环：读不到，而**且**它与"没有这条路由"同形（404，不是 403）──────────── */
  assert.equal(
    remote.status, 404,
    '★★ 非回环必须读不到 —— 而用 404（**不是** 403）是刻意的：\n'
    + '   403 等于承认"这里有一条你不许看的路由"；404 让它与"这个插件没装"同形，\n'
    + '   于是探测者拿不到任何额外信息。',
  )
  assert.equal(remote.body, '', '★ 非回环的响应体里**不许**漏出任何降级细节')

  /** ★ 反向半边：**健康**时同一路由读出来的是 healthy —— 它不是"恒报降级"的。 */
  const healthyShell = pluginShell('t18-agent-teams', { apply: () => {} })
  await healthyShell.mount()
  const healthyRoutes = new Map()
  loopbackOnlyRoute({ register: (r) => { healthyRoutes.set(r.path, r); return () => {} } }, '/degraded', () => healthyShell.status)
  const healthyCall = { status: undefined, body: '' }
  await healthyRoutes.get('/degraded').handler(
    { method: 'GET', url: '/degraded', socket: { remoteAddress: '127.0.0.1' } },
    { writeHead(s) { healthyCall.status = s; return this }, end(c) { if (c !== undefined) healthyCall.body = String(c); return this } },
  )
  assert.equal(JSON.parse(healthyCall.body).state, 'healthy', '★ 健康时这条路由必须报 healthy（防"恒报降级"）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6：★★ 异步拒绝臂 —— `async apply` 的抛出与同步抛出必须**同一条路**接住
// ─────────────────────────────────────────────────────────────────────────────

test('★★ 臂 6 异步拒绝臂：`async apply` 的 rejected promise 不许漏过去', async () => {
  /**
   * ── 这一格**不是**设想的，它是写外壳时实测抓出来的 ───────────────────────────────
   *
   * 一个只写 `try { apply() } catch {}` 的外壳**接不住** `async` 的 apply：
   * 它的抛出表现为一个 **rejected promise**（返回值被丢弃，异常跑到
   * `unhandledRejection`）—— 而那与"它成功了"在返回值上**同形**。
   *
   * ⇒ 修法是 `await` 它的返回值：同步抛出与 rejected promise 在 `await` 下**同形**。
   * ★ 而本臂就是那条修法的守卫：`await` 一去掉，它立刻红。
   */
  const asyncShell = pluginShell('t18-probe', { apply: async () => { throw new Error('t18 probe: async failure') } })
  await asyncShell.mount()

  console.log(`    ℹ async apply 抛出 ⇒ ${JSON.stringify(asyncShell.status)}`)

  assert.equal(asyncShell.status.state, 'degraded', '★★ `async apply` 的抛出必须被接住（否则它静默变成"健康"）')
  assert.equal(asyncShell.status.degraded[0].stage, 'apply')
  assert.match(asyncShell.status.degraded[0].reason, /t18 probe: async failure/)

  /**
   * ── 第二轮：**import 阶段**失败（`ERR_MODULE_NOT_FOUND` —— 本仓真实发生过的那次）──
   */
  const importShell = pluginShell('t18-probe', {
    load: async () => {
      const error = new Error("Cannot find module '/x/y.js'")
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    },
    /** ★ 这一条**永不该**被调用 —— 拿不到模块就没有可调的东西。 */
    apply: () => { throw new Error('t18 probe: apply must NOT run after a failed import') },
  })
  await importShell.mount()

  console.log(`    ℹ import 失败 ⇒ ${JSON.stringify(importShell.status)}`)

  assert.equal(importShell.status.state, 'degraded')
  assert.equal(importShell.status.degraded[0].stage, 'import', '★ 阶段必须是 `import`（那是 `ERR_MODULE_NOT_FOUND` 那一格）')
  assert.equal(importShell.status.degraded[0].code, 'ERR_MODULE_NOT_FOUND', '★ `code` 读得出来时必须带出来')
  assert.equal(importShell.status.degraded.length, 1, '★ 加载失败**不许**再记一条 apply 失败（那会伪造第二次失败）')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7：★ 接线臂 —— 产品入口真的把这个外壳接上了（"有外壳"与"外壳被用上"是两件事）
// ─────────────────────────────────────────────────────────────────────────────

test('★ 臂 7 接线臂：`src/index.ts` 的 apply 真的走了外壳 + 降级路由被注册', async () => {
  /**
   * ★★ 本队记账最久的形态：「一个函数还在」与「有人调用它」在"函数还在而没人调用"
   *   时【同形】。⇒ 本臂断言的是**调用点**，不是"外壳存在"。
   *
   * ★ 读源码文本是这一格的合适口径：这是一个**接线**问题，而接线在运行时
   *   只能靠"真的挂一次宿主"来证明 —— 那需要一整套宿主服务，
   *   会把这个夹具变成一个与它要测的东西无关的装置。
   */
  const { readFileSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
  const source = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')

  assert.match(
    source, /pluginShell\(\s*name\s*,\s*\{/,
    '★★ `apply` 必须真的把本体交给 `pluginShell` —— 否则外壳写了而没人用，与没有它同形',
  )
  assert.match(
    source, /loopbackOnlyRoute\([\s\S]{0,120}?DEGRADED_ROUTE/,
    '★★ 降级路由必须真的被注册（而且用的是回环围栏的那一条）',
  )
  assert.match(
    source, /const DEGRADED_ROUTE = '\/plugins\/dsh-agent-teams\/degraded'/,
    '★ 路由路径必须是声明的那个常量（改名会让文档与读数分叉）',
  )

  /**
   * ── 反向半边：`applyInner` 必须**真的**装着原实现（不是被掏空的壳）──────────────
   *
   * ★ 若有人把本体删成一句 `return`，上面三条照样绿 —— 而插件什么也不干了。
   */
  assert.match(
    source, /function applyInner\(ctx: Context, config: Config\): void \{[\s\S]{200,}/,
    '★ `applyInner` 必须仍然装着原来的挂载逻辑（否则"隔离"变成了"什么都不做"）',
  )
  assert.match(source, /registerAgentTeamsTools\(ctx, resolved\)/, '★ 工具的注册点必须还在本体里')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8：★★★ 真实宿主臂 —— 挂载**真的**插件，健康时与今天逐字相同
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 这一臂是本任务最有价值的一格，因为它在写它的过程中**当场抓出了我自己的一个缺陷**──
 *
 * 我第一版把降级路由注册在 `authenticatedWebRoutes(...)` **之后**（即复用了
 * 我们插件自己的鉴权网闸）。实测它当时的读数是：
 *
 *     GET /plugins/dsh-agent-teams/degraded  ⇒ 503 {"error":"authentication unavailable"}
 *
 * ★★ 而那正是本任务**要消灭**的形状：一个"这个插件为什么没挂起来"的读数，
 *   如果它挂在**我们自己的鉴权链**上，那么**在我们坏掉的那一天它也跟着坏** ——
 *   于是它**永远说不了那句最该说的话**。
 *   ⇒ 修法：它只依赖宿主的 `webServer`，不依赖我们的 `connection` 网闸
 *     （见 `src/index.ts` 里那段长注释与臂 7 的接线断言）。
 *
 * ── 而这一臂钉的是**真实宿主**，不是桩 ──────────────────────────────────────────
 *
 * ★ 它用真的 `SystemPrompt` / `ToolRuntime` 与真的 `apply` —— 于是
 *   "健康挂载与今天逐字相同"这句**验收第 3 条**有一条可执行的读数，
 *   而不是一句我自己的主张。
 * ★★ 而它也把"降级路由**不**经过我们的鉴权链"这件事**实测**出来了：
 *   本臂故意**不**提供 `connection` 服务 —— 若降级路由走了那一条，
 *   它就会变成 503（我第一版就是那样），而本臂当场红。
 */
test('★★★ 臂 8 真实宿主臂：真的插件挂起来是 healthy，且降级路由不经过我们自己的鉴权链', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')

  const requireDsh = createRequire(import.meta.resolve('@deepseek-ai/dsh/package.json'))
  const requireBase = createRequire(requireDsh.resolve('@deepseek-ai/dsh-base/package.json'))
  const requireTools = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'))
  const { SystemPrompt } = await import(pathToFileURL(requireBase.resolve('@deepseek-ai/dsh-system-prompt')).href)
  const { ToolRuntime } = await import(pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-tools')).href)

  const host = new Context()
  const routes = new Map()
  const errors = []
  host.logger.error = (...parts) => { errors.push(parts.map(String).join(' ')) }
  host.logger.warn = () => {}
  host.logger.info = () => {}
  host.logger.debug = () => {}

  await host.plugin(SystemPrompt, { includeHarnessIdentity: false }).await()
  await host.plugin(ToolRuntime, { mode: 'native' }).await()

  host.provide('subagents', { followup: async () => {}, registerContinuableSetup: () => () => {} })
  host.provide('agents', { get: () => undefined, list: () => [] })
  host.provide('llm', {})
  host.provide('webServer', {
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path) },
  })
  host.provide('workspaceRegistry', { list: () => [] })
  /**
   * ★★★ 刻意**不**提供 `connection`：那正是本臂要证明的那件事 ——
   *   降级路由**不许**依赖我们的鉴权链。（第一版依赖它 ⇒ 实测 503。）
   */

  const { apply } = await import('../lib/index.js')
  let threw = null
  try { apply(host, {}) } catch (error) { threw = error }
  await new Promise((resolve) => setTimeout(resolve, 300))

  /**
   * ── 验收第 3 条：**健康挂载与今天逐字相同** ───────────────────────────────────
   *   `apply` 不抛（外壳接住了一切），且**一条 error 都没有** ——
   *   "什么都没发生"就是"与今天相同"的可执行形式。
   */
  assert.equal(threw, null, '★ `apply` 不许因为套了外壳而开始抛错')
  assert.deepEqual(
    errors, [],
    '★★★ 一个**真实且健康**的挂载不许产出任何 error —— 否则"隔离"把一个正常启动变成了噪音',
  )

  /** ── 降级路由真的注册了，而且它读得出真实状态 ─────────────────────────────── */
  const route = routes.get('/plugins/dsh-agent-teams/degraded')
  assert.notEqual(route, undefined, '★ 降级路由必须真的挂上（真实宿主上，不是桩上）')

  const read = async (remoteAddress) => {
    const captured = { status: undefined, body: '' }
    await route.handler(
      { method: 'GET', url: '/plugins/dsh-agent-teams/degraded', socket: { remoteAddress } },
      {
        writeHead(status) { captured.status = status; return this },
        end(chunk) { if (chunk !== undefined) captured.body = String(chunk); return this },
      },
    )
    return captured
  }

  const loopback = await read('127.0.0.1')
  const remote = await read('10.9.9.9')
  console.log(`    ℹ 真实宿主 · 回环 ⇒ ${loopback.status} ${loopback.body.slice(0, 120)}`)
  console.log(`    ℹ 真实宿主 · 非回环 ⇒ ${remote.status} ${JSON.stringify(remote.body)}`)

  assert.equal(
    loopback.status, 200,
    '★★★ 健康时本机也必须**读得到**这条路由 —— 若它返回 503，说明它挂在了我们自己的鉴权链上，\n'
    + '   而那会让它在"我们真的坏了"的那一天跟着坏（本臂刻意不提供 connection 就是为了抓这一格）。',
  )
  assert.equal(
    JSON.parse(loopback.body).state, 'healthy',
    '★ 健康挂载 ⇒ 路由必须如实报 healthy（不是恒报降级，也不是"读不到"）',
  )
  assert.equal(remote.status, 404, '★ 非回环读不到，且与"没有这条路由"同形')
})
