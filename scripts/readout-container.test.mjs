/**
 * ── 读数容器（`src/readouts.ts`）的行为夹具：9 臂 ──────────────────────────────────
 *
 * 本文件是**容器本身**的夹具，不是四条线任何一条的夹具。它钉的是那三条"少一条就
 * 白做"的纪律（见 `src/readouts.ts` 文件头）：
 *
 *   臂 1 ★★★ **空态 + 接缝**（本夹具的核心，见下"两半"）
 *   臂 2 ★★  装配清单（`src/readouts/index.ts`）在，且"启用条数 === 登记条数"
 *   臂 3     注册 ⇒ 该槽位在场，且 provider 收到的 context 三格都是真值
 *   臂 4 ★★  provider **抛错** ⇒ `{ unmeasured: '…' }`（在场、带原因），不是缺席、不是 `{}`
 *   臂 5 ★★  provider 返回 **undefined** ⇒ 同上；并钉"没认领的槽位不出现"与"键序按预置槽位走"
 *   臂 6     认领纪律：未知槽位 / 重复认领 / 非函数 provider，三者都**当场抛**
 *   臂 7     归档支（`historic`）如实传给 provider
 *   臂 8 ★★  **async** provider reject ⇒ 仍落成 `unmeasured`（try/catch 必须覆盖 `await`）
 *   臂 9 ★★  **快照接缝保真**：登记的东西原样出现在快照的 `readouts` 上（见下"两分支"）
 *
 * ── ★★★ 本夹具 v1 的重大缺陷（2026-10-23，readout-architect 抓到，已修）
 *
 * v1 的臂 1/3/4/5/7 把「容器语义」与「四条线接了几条」**混在一起**了：它们在**主模块
 * 实例**（与 `snapshot.ts` 共享的那个）上登记 provider，并直接断言
 * "`collectReadouts()` 必须返回 `{}`"、"快照里必须没有 `readouts` 字段"。
 *
 * ⇒ 后果（在 `/tmp` 副本里模拟实测，**不是推测**）：
 *
 * ```
 *   今天（四槽全注释）      8 pass / 0 fail
 *   只落线 A（取消注释）     5 pass / 3 fail   ← 臂 1、3、4
 *   四线全落                3 pass / 5 fail   ← 臂 1、3、4、5、7
 * ```
 *
 * ① 臂 1 无条件断言"空"属于**把当下进度写成不变量**（`src/gates/index.ts:71-78`
 *    逐字记过这条纪律：任何夹具都不许把「现在没有」写成断言）；
 * ② 臂 3/4/5/7 在主实例上 `contributeReadout` ⇒ 四线一落地，装配清单已经认领了那些
 *    槽位，它们**当场抛 `already claimed`**；
 * ③ 臂 4 还断言 `snapshot.readouts.evidence` 等于**臂 3 注册的值** —— 臂 3 一抛，
 *    它连带红。**那条红是假的**（掩盖了真实数量）。
 *
 * ★★ 而它的坏法比"红"更糟：**红色来自"臂 1 说 readouts 必须缺席"**，
 *    于是最省事的修法就是**删掉臂 1 或加 skip** —— 那正好删掉本容器唯一一条
 *    "缺席 ≠ 空"的证据。**绿灯能冒充证据，红灯能诱导删证据，两头都坏。**
 *
 * ── ★★★ 修法：两种实例分开用（这是本文件最关键的一条纪律）
 *
 * ```
 *   主实例      import('../src/readouts.ts')          —— 与 snapshot.ts 共享；
 *                                                        装配清单在这里登记（0..4 条，随进度变）
 *   隔离实例    import('../src/readouts.ts?armN')      —— 每次一个新实例，登记表独立；
 *                                                        用于钉【容器语义】，与四条线进度无关
 * ```
 *
 * ⇒ **容器语义的断言一律落在隔离实例上**（它们因此与"四条线接了几条"完全无关，
 *    永不会因别人的 PR 变红）；**只有臂 1、2、9 碰主实例/快照**，而它们三个都被写成
 *    **在所有进度下都成立**的不变量（见各自注释）。
 *
 * ★ 隔离实例为什么可行（实测，不是假设）：ESM 按**完整 URL** 分实例，查询串不同
 *   ⇒ 模块各自求值一次 ⇒ 各自的 `providers` Map。臂 8 从 v1 起就是这么做的。
 *
 * ── ★★★ 为什么本夹具 import `../src/readouts.ts` / `../src/snapshot.ts`，而**不** import `../lib/*.js`
 *
 * 本仓 `.test.mjs` 的惯例是 import `../lib/*.js`（构建产物）。本文件**故意不照抄**：
 *
 *   ① **`lib/` 可能比 `src/` 旧，而旧产物会让本夹具"绿得没意义"**。
 *      本仓已为此单独记过一条判据（`scripts/gate-stale-module.test.mjs`：
 *      "进程加载的是构建前的模块"——一个机制级失效伪装成一条业务规则）。
 *      若 `lib/readouts.js` 尚未产出，import 会直接 `ERR_MODULE_NOT_FOUND`；
 *      若它是上一次构建的，这些臂会对着**上一版容器**跑出绿灯 —— 那是最坏的一种绿。
 *   ② **Node 22.19+ / 24 默认开启类型剥离**（`package.json: engines` 正是
 *      `^22.19.0 || >=24`）⇒ `.mjs` 里 `import '../src/readouts.ts'` 原生可跑，
 *      **零构建依赖、零新工具**；`scripts/gate-tally.test.mts` 是同源先例。
 *      ★ 实测开销：首次 import 要剥离整条 `snapshot.ts` 依赖图，约 **14 s**。
 *      ★★ MEASURED：把整个 `lib/` 目录移走之后，本夹具仍 **8/8 通过**（v1 实测），
 *        这就是"零构建依赖"的证据；改成 import `../lib/*.js` 会立刻 `ERR_MODULE_NOT_FOUND`。
 *
 * 跑法：`node --test scripts/readout-container.test.mjs`
 * 或 `pnpm verify:readouts`。
 *
 * ── ★★★ 判别力实测（2026-10-23，9 个定向突变，**在"四槽全空"与"四线全落"两种树上各跑一遍**）
 *
 * 一条说不出"什么改动会让它红"的断言，与一句注释同价。逐个施加、跑完即逐字节复原
 * （`diff -q` 核实）：
 *
 * ```
 *   突变                                  四槽全空树      四线全落树
 *   M1 抛错支写成 {}                      臂 4、8         臂 4、8
 *   M2 未登记槽位写成 {}                  臂 1、2、3、5、8 臂 1、3、5、8   ← 臂 2 只在前者红（见下）
 *   M3 按【登记顺序】遍历                 臂 5、8         臂 5
 *   M4 删掉快照侧的副作用 import          臂 2            臂 2
 *   M5 快照里 readouts 恒在场             臂 1             ★ 抓不住（见下）
 *   M6 undefined 原样写入                 臂 5、8         臂 5、8
 *   M7 snapshot 里 historic 恒 false      臂 9（spy 支）  臂 9（差分支）
 *   M8 snapshot 里 stateRoot 传空串       臂 9（spy 支）   ★ 取决于某个 provider 读不读 stateRoot
 *   M9 去掉"重复认领"检查                 臂 6            臂 6
 * ```
 *
 * ★★ **两处抓不住，如实记账**（不假装覆盖，也不为了变绿去动判据）：
 *
 *   · **M5 在四线全落树抓不住**：那时 `readouts` 本来就有四格，"恒在场"与"空才缺席"
 *     在那个树上**输出完全相同**。⇒ 这一条**只可能在空态树上被证伪**。
 *     ★★ 处置（team-lead 裁决 2026-10-24）：**不造第二棵树，也不移交四条线** ——
 *        改成臂 1 里的**状态检测**：主实例非空时**打印**"这条性质【无守卫】"
 *        （不是"不适用"：前者说明有个洞，后者听起来像"不需要"）。
 *        ⇒ 落地那天 CI 日志里会出现一行明确的"无守卫"，而不是静默通过；
 *          那时的处置（造树 or 认缺口）由当时的人决定，但**他必须看见**。
 *   · **M8 在四线全落树**只在"某个 provider **真的读出不一样的东西**"时才抓得住。
 *     ★★ 这里有一个**已经修掉**的假边界（2026-10-24，readout-architect 实测）：
 *        旧 `makeRoot` **只 mkdir、不写 team.json** ⇒ 任何真实写法的 provider 都读不到
 *        盘 ⇒ 两个 context 的读数退化成**同一句 `unmeasured`** ⇒ 差分判别力 0 ⇒ 免检。
 *        ★ 而且**越是写得好越抓不到**（读不到就 `unmeasured` 而不抛的写法最规范，却最漏检）。
 *        ⇒ 已改为**造根时真的写一份 team.json**（见 `makeRoot` 上那段实测表）：
 *          补上后基线仍 9/9，M8 立刻从"漏检"变成"8 pass / 1 fail（抓到）"。
 *     ★ 仍**未**覆盖的边界（如实记账）：**完全不读 `stateRoot` 的 provider**
 *        （只报静态能力位那种）—— 那时 `stateRoot` 传空串它在输出上看不出来，
 *        差分如实打印"测不了"。
 *     ★★ 而这一类**已经**有 owner 了（不是靠 provider 自觉）：**臂 10** 直接断言
 *        `readoutContextOf` 的输出（见下"三类证据"），与 provider 写法无关。
 *        ⇒ M8 现在有**两层**：臂 10 钉"**快照怎么构造 context**"（永久、无条件），
 *          臂 9 钉"**构造出来的那份真的进了 provider**"（条件性）。
 *
 * ── ★★★ 三类证据，各有各的盲区（读完这张表再改这个夹具）
 *
 * | 臂 | 钉什么 | 无条件？ | 盲区 |
 * |---|---|---|---|
 * | 臂 10 | `readoutContextOf` 的输出三格 | ✅ 永久，与 provider 无关 | **钉不住"快照有没有调用它"** |
 * | 臂 9 spy 支 | 快照真的把 context 交给了 provider，且值原样进 `readouts` | 仅当主实例有空槽 | 四线全落后不适用（打印） |
 * | 臂 9 保真支 | 转发不吞、不改形；`historic`/`stateRoot` 差分 | 条件性（取决于 provider 读不读） | provider 不读那一格时就"测不了"（打印） |
 *
 * ★★ MEASURED（2026-10-24）：**把调用点改成 `readoutContextOf(state.id, '', …)`
 *   （即 M8 经 `readoutContextOf` 传下去）⇒ 10 条臂全绿，漏检**。
 *   因为臂 10 只断言**函数本身**，而"快照是否用它、用什么参数调它"它看不见。
 *   ⇒ 这一条**仍未闭合**，如实记账。要闭合它需要**第四类证据**：在
 *     `assembleTeamSnapshot` 的调用点上可观察（例如让 `readoutContextOf` 的调用
 *     可被注入 / 或在快照输出里回显最后一次用的 context）。★ 未做，等裁定。
 *   ★ 今天这一半**由臂 9 的 spy 支兜着**（空态树上有空槽可 spy）：实测把调用点
 *     改成 `''` ⇒ **臂 9 红**。⇒ 盲区只在"四线全落之后"出现，不在今天。
 *
 * ── ★★★ 记账：两条读取路径的**校验强度不同**（这条比 M8 本身重要）
 *
 * ```
 * ★ MEASURED（2026-10-23）：同一份 team 记录，快照侧【不校验】、写盘侧【强校验】。
 *   ⇒ 夹具用 JS 对象构造的数据可以全绿，而同一份数据写进盘就是非法的。
 *   ⇒ 任何"用对象构造夹具"的地方，都必须用【真实校验器】序列化一遍，
 *      否则夹具证明的是"Shape 对"，不是"数据合法"。
 * ```
 *
 * ★ 本夹具当场踩过：`teamState()` 的成员写 `status: 'active'`（合法值是
 *   `idle | working | removed`）、缺 `captainSessionId`/`createdAt`/`joinedAt`。
 *   ⇒ `assembleTeamSnapshot` 直接吃这个对象 ⇒ **臂全绿**；而写进 `team.json`
 *     再 `readTeam` 回来 ⇒ `invalid AgentTeams state in team "t1"`。
 *   ⇒ 于是"以 `readTeam` 为写法"的 provider 永远读不到盘，M8 恒免检。
 *   ★ 修法是**用真实校验器序列化一遍**（本夹具直接 `JSON.stringify(teamState(...))`
 *     落盘，并有一条独立探针证明 `readTeam(真根)` 真能读回来）。
 *
 * ── ★★★ 记账（第二格）：夹具数据**缺一格**，能让一条真判据**恒免检**
 *
 * ```
 * ★ MEASURED（2026-10-24，readout-architect 的四组合实测，我逐条复现）：
 *   "合法"不等于"够用"。一份能过校验的记录，仍可能缺掉被测逻辑赖以工作的那一格。
 *   ⇒ 夹具的假数据必须在【被测代码真正读的那几格】上有真值，否则被测代码
 *     只能走"读不到"那一支 —— 而"读不到"是最容易被写成一句话的。
 * ```
 *
 * ★ 本夹具当场踩过（第二例）：成员的 `provider`/`model` 缺席（可选、但真实记录必有）
 *   ⇒ 从 `members[].provider` 推"本队用了哪些后端"的 provider 读出一片 `undefined`
 *     ⇒ 只能返回 `unmeasured` ⇒ 与"盘读不到"的 `unmeasured` 退化成**同一句话**
 *     ⇒ 差分判别力 0 ⇒ **M8 漏检**（哪怕线C 的实现、文案、判据都写对了）。
 *   ★ 四组合实测（详细矩阵见 `teamState` 上方那段）：**补数据**才真的兜住；
 *     只把两种"读不到"的文案分开，能让"成员无 provider + 分开文案"勉强抓到，
 *     但那是在靠文案碰巧不同来判别 —— 不是靠语义。
 *
 * ★ 八条**容器语义**臂（2-8）在两种树上判别力一致（它们用隔离实例，与进度无关）。
 *
 * ── ★★★ 逐臂隔离实测（`scripts/arm-isolation-check.mjs`，两种树各跑一遍）
 *
 * "整份跑绿"对**顺序依赖**结构性盲：一条臂可能靠别条臂留下的副作用活着，
 * 而 `node --test` 默认顺序跑 ⇒ 那种夹具在 CI 上**长期全绿**，直到有人跳过它。
 *
 * ```
 *   四槽全空树   9 条臂 整份 ok / 单跑 ok  —— 未发现顺序依赖
 *   四线全落树   9 条臂 整份 ok / 单跑 ok  —— 未发现顺序依赖
 * ```
 *
 * ★ 这条性质是**修出来的，不是本来就有的**：v1 的臂 4/5/6 单跑都红（它们读别臂的登记）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根（本文件在 `scripts/` 下）。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 四个预置槽位（与 `src/readouts.ts` 的 `READOUT_KEYS` 同序 —— 契约的一侧）。 */
const SLOTS = ['evidence', 'pairing', 'backends', 'templates']

/**
 * ★ `snapshot.ts` 的这一条 import 带着**副作用**：它会把 `src/readouts/index.ts`
 *   （四条线的装配清单）拉起来 —— 臂 2 要的"清单真的被加载"就是它保证的。
 * ★ 它 import 的 `./readouts.ts` 就是下面这个**主实例**（Node 按 URL 缓存）。
 */
const { assembleTeamSnapshot, readoutContextOf } = await import('../src/snapshot.ts')
const mainReadouts = await import('../src/readouts.ts')

/**
 * 取一个**隔离实例**（登记表独立，与装配清单无关）。
 * ★ 为什么用查询串：ESM 按完整 URL 分实例 ⇒ `?armN` 是各自求值一次的独立模块。
 * ★ 每个臂**必须**用自己的 tag：同一个 tag 会被复用（同一实例），
 *   于是"A 臂登记的槽位"会漏进"B 臂"—— 那正是 v1 的毛病换了层皮。
 */
const isolated = (tag) => import(`../src/readouts.ts?${tag}`)

/** 最小 ctx：只提供 `assembleTeamSnapshot` 真正会碰的两个成员。 */
const context = () => ({ agents: { list: () => [], get: () => undefined }, logger: { warn: () => {} } })

/**
 * 一个最小的团队记录 —— ★★ 它必须是一份**真的能过 `readTeam` 校验**的记录。
 *
 * ★ 为什么每一格都在（`isTeamState` / `isTeamMember`，`src/state.ts:1240/1362`）：
 *
 *   · `captainSessionId` —— 必填、非空字符串
 *   · `createdAt`        —— 必填、有限数
 *   · `members[].joinedAt` —— 必填、有限数
 *   · `members[].status`   —— 只接受 `idle | working | removed`
 *     ★★ 这一格我第一版写的是 `'active'`：**快照侧不校验**（直接吃 JS 对象，所以臂全绿），
 *        但**写进 `team.json` 再 `readTeam` 回来就是非法记录 ⇒ 抛错**。
 *        MEASURED：不改这一格时 `readTeam(真根)` 报 `invalid AgentTeams state in team "t1"`。
 *        ⇒ 这正是"**同一份记录，两条读取路径校验强度不同**"的形态：
 *          夹具用宽松那条路（直接把对象交给 `assembleTeamSnapshot`）造了一份
 *          **真实读回来会失败**的数据 —— 于是以 `readTeam` 为写法的 provider 永远读不到盘。
 *
 *   · `members[].provider` / `.model` —— ★★ **可选，但真实记录里一定有**。
 *     MEASURED（2026-10-24，readout-architect 的四组合实测，我逐条复现）：
 *     这两格缺席时，任何"从 `members[].provider` 推本队用了哪些后端"的 provider
 *     都读出一片 `undefined` ⇒ 它只能返回 `unmeasured`，而**这个 `unmeasured` 与
 *     "盘读不到"的 `unmeasured` 会退化成同一句话** ⇒ 差分判别力 0 ⇒ **M8 漏检**。
 *     ```
 *       夹具成员 provider | 两种"读不到"的文案 | M8
 *       无                | 分开               | ✅ 抓到
 *       无                | 合并               | ❌ 漏检   ← 只补文案不够
 *       有                | 分开               | ✅ 抓到
 *       有                | 合并               | ✅ 抓到   ← 补数据才真的兜住
 *     ```
 *     ⇒ 真实写点：成员创建时必然写 `provider` / `model`
 *       （`src/tools/shared/entities.ts:6066`）。
 *       值用本仓夹具惯例（`provider: 'fake'` / `model: 'fake-model'`，
 *       见 `scripts/lifecycle-verify.mjs:1740` 等）。
 */
const teamState = (id) => ({
  id, name: `team-${id}`, description: 'd', phase: 'running',
  captainSessionId: 'session-probe',
  createdAt: 1000,
  members: [{ id: 'm1', name: 'alice', status: 'idle', joinedAt: 1000, provider: 'fake', model: 'fake-model' }],
  tasks: [], taskSeq: 0,
})

/**
 * 一份可用的 durable 根 —— ★★ 它必须是一份**可读的真根**，不是空目录。
 *
 * ── 为什么必须真的写一份 `team.json`（2026-10-24，readout-architect 实测抓到的漏检）──
 *
 * v5 的 `makeRoot` 只 `mkdir` 了 `t1/inbox`，**不写 `t1/team.json`**。而 `readTeam`
 * 读的正是 `<stateRoot>/<teamId>/team.json`（`src/state.ts:632`）⇒ 任何**真实写法**
 * 的 provider（`readTeam(ctx.stateRoot, ctx.teamId)`）在本夹具的 root 上**永远读不到**。
 *
 * ⇒ 后果（实测，四种 provider 写法全跑过）：
 *
 * | provider 写法                                        | M8（snapshot 把 stateRoot 传 ''） |
 * |------------------------------------------------------|-----------------------------------|
 * | `readTeam(...)` 后取 `.tasks.length`（抛 TypeError）   | 抓到（错误消息里带路径）           |
 * | `readTeam(...)`，读不到就返回 `{ unmeasured }`（**最规范**）| ❌ **漏检**（两格同一句消息）    |
 * | `readFile(...)` 抛 ENOENT（消息含完整路径）            | 抓到                              |
 * | 硬编码路径 / 不读盘                                   | ❌ 漏检                            |
 *
 * ★★ **越是写得好（读不到就 unmeasured 而不抛），越抓不到** —— 因为 `unmeasured`
 *   消息里不含 `stateRoot`，两个 context 的读数退化成同一句 ⇒ 差分判别力 0 ⇒ 打印"测不了"。
 *   而这是**夹具给的数据**的问题，不是 provider 写法的问题 —— 前者我们能控制。
 * ★ 空目录还让"**读数读不到盘**"与"**盘上没有东西**"永远同形，那正是本仓反复记账的形态。
 *
 * ★ 修法：造根时**真的写一份 team.json**（内容与 `teamState('t1')` 一致，避免两个真相）。
 *   实测：补上之后基线仍 9/9，而 M8 从"漏检"变成"8 pass / 1 fail（抓到）"，
 *   臂 9 自述从 `stateRoot 无` 变成 `stateRoot 有（已对拍）`。
 */
const makeRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'readout-container-'))
  mkdirSync(join(root, 't1', 'inbox'), { recursive: true })
  /**
   * ★ 与 `teamState('t1')` **同源**（直接序列化它，不另写一份字面量）：
   *   两份手写的 team 记录会在某次改动后分叉，而那正是本仓记账的"两处真相"。
   */
  writeFileSync(join(root, 't1', 'team.json'), JSON.stringify(teamState('t1')), 'utf8')
  return root
}

/** 在最小团队上组装一份快照。 */
const snapshotOf = async (root, options) => assembleTeamSnapshot(context(), root, '/tmp/ws', teamState('t1'), options)

/** 主实例此刻登记了哪几个槽位（★ 会真的执行四条线的 provider，故只用来读**键集**）。 */
const mainKeys = async (root) => Object.keys(await mainReadouts.collectReadouts({ teamId: 't1', stateRoot: root, historic: false }))

/**
 * ── ★★★ 主实例在**任何臂动手之前**登记了几条线（= 四条线真实落地数）───────────────
 *
 * ★ 在臂 1 里取（它最先跑，那时主实例只反映真实落地）。
 *
 * ★★ 为什么不能等到臂 10 再取：**臂 9 会往主实例上占一个 spy 槽位**
 *    （`mainReadouts.contributeReadout(free, …)`）。若在臂 10 才数，
 *    那个 spy 会被算成"又落地了一条线" ⇒ **空态树上也会误报"调用点无守卫"**，
 *    而空态树上明明是臂 9 的 spy 支兜着的。
 *    ⇒ 这正是本仓那条"**守卫数了另一个同名的东西**"的形态，这里差一格就复现。
 *
 * ★ 单个臂单跑（`arm-isolation-check`）时臂 1 不跑 ⇒ 这个变量是 `undefined`，
 *   臂 10 会就地数一次（那时臂 9 也没跑过，所以就地数是对的）—— 两种跑法都对。
 */
let landedLinesAtStart = null

// ─────────────────────────────────────────────────────────────────────────────
// 臂 1 ★★★ 空态（隔离实例）+ 快照接缝（主实例）—— 两半，缺一半都是假保险
// ─────────────────────────────────────────────────────────────────────────────

test('臂 1 ★★★ 空态：隔离实例上不注册 ⇒ collectReadouts() 返回 {}；接缝：快照 readouts 的键集 === 主实例键集，且"空 ⇔ 缺席"', async () => {
  /**
   * ── 前半：**空态本身**（隔离实例 ⇒ 与四条线进度无关，永远成立）──────────────
   *
   * ★ 它证明的是容器的这条性质：**一个槽位都没登记 ⇒ 结果是 `{}`，不是四格
   *   `undefined`、不是四格 `{}`、不是 `{ evidence: { unmeasured } }`**。
   * ★ v1 把这一条写在**主实例**上，于是"四条线接了几条"会让它变红。
   *   现在它与那个进度**没有关系** —— 这就是它该待的地方。
   */
  const empty = await isolated('arm1')
  assert.deepEqual(
    await empty.collectReadouts({ teamId: 't1', stateRoot: '/tmp', historic: false }), {},
    '★ 空实例必须返回 {}（不是四格 unmeasured / 四格 {}）',
  )

  /**
   * ── 后半：**快照与容器之间的接缝**（主实例 + 真快照）────────────────────────
   *
   * ★ 这才是容器夹具该永久钉住的东西，**且它在所有进度下都成立**：
   *
   *     `Object.keys(snapshot.readouts ?? {})` 必须 ===  `Object.keys(主实例.collectReadouts(...))`
   *
   *   · 今天四条线都没接 ⇒ 两边都是 `[]`（且下面那条"空 ⇔ 缺席"要求 `readouts` 键不存在）
   *   · 某条线落地 ⇒ 两边都多一格（要求 `readouts` 键**必须存在**）
   *   · 四线全落 ⇒ 两边都是四格
   *
   * ⇒ 它把臂 1 从"记录某一刻的进度"变成"钉住 snapshot 与容器之间那个接口"。
   *   ★ 缺了这条，"`assembleTeamSnapshot` 到底有没有把读数交出去"就没有任何东西钉 ——
   *     而那正是本容器存在的**唯一理由**。
   */
  const root = makeRoot()
  try {
    const keys = await mainKeys(root)
    /**
     * ★★ 记录"真实落地了几条线"，供臂 10 的状态检测用。
     *   ★ **必须在这里记**（臂 1 最先跑、臂 9 的 spy 还没占位），理由见上面那段。
     */
    landedLinesAtStart = keys
    const snapshot = await snapshotOf(root)
    const snapshotKeys = Object.keys(snapshot.readouts ?? {})

    assert.deepEqual(snapshotKeys, keys, '★ 快照 readouts 的键集必须与容器的键集一致（多一格=凭空造读数，少一格=吞了读数）')

    /**
     * ── ★★★ 状态检测：让"未来失效"在**当下可见**（team-lead 裁决，2026-10-24）───────
     *
     * 「空 ⇒ 字段缺席」这条性质**只在空态树上可被证伪**（落地后 `readouts` 本来就有
     * 四格，"恒在场"与"空才缺席"在那个树上输出完全相同 —— 见文件头 M5 那一行的记账）。
     *
     * ⇒ 所以这里**按状态说不同的话**，而不是统一绿：
     *   · 主实例空（今天）⇒ 真断言"缺席"；
     *   · 主实例非空（某条线落地那天）⇒ 这条断言**今天不适用**，且
     *     ★ **不许静默通过、不许 skip**，必须打印"这条性质无守卫"并指出缺什么。
     *
     * ★★ 为什么这比"移交四条线"强：移交是让四个**不知道自己有这条不变量**的人接手；
     *   而打印是让**当时看见 CI 的那个人**必须做决定（造树 or 认缺口）。
     * ★ 为什么这比"现在就造树"合适：造树要每次 CI 多付约 4 分钟，换的是一条
     *   **四线尚未落地时**还用不上的断言 —— 现在买是给没发生的问题上保险。
     */
    if (keys.length === 0) {
      assert.equal('readouts' in snapshot, false, `★ 容器为空 ⇒ 快照里 readouts 必须**缺席**，实际是 ${JSON.stringify(snapshot.readouts)}`)
    } else {
      /** ★ 反向半边仍然成立且仍然断言（非空 ⇒ 必须在场）—— 它两种树都有效。 */
      assert.equal('readouts' in snapshot, true, '★ 容器非空 ⇒ 快照里 readouts 必须**在场**（否则读数被吞了）')
      /**
       * ★★ 而"空 ⇒ 缺席"那一半**今天没有守卫**了，必须喊出来。
       *   ★ 措辞刻意不是"不适用"（听起来像"不需要"），而是"**无守卫**"（说明有个洞）。
       */
      console.log(
        `  臂1 ▸ 空态断言【今天不适用】：主实例已有 ${keys.length} 条线落地（${keys.join(', ')}）。`
        + ' 若要继续验"空 ⇒ 缺席"，需要一棵人造空态树（见 docs/TEAM-CONTROL-PLANE-SPEC.md §23.7b 的'
        + ' "空态不做假读数" 行；人造树本身**未做**）。'
        + ' ★ 在它被造出来之前，这条性质【无守卫】。',
      )
    }

    console.log(`  臂1 ▸ 空实例 = {} | 主实例键集 = ${JSON.stringify(keys)} | 快照键集 = ${JSON.stringify(snapshotKeys)} | "readouts" in snapshot = ${'readouts' in snapshot}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 2 ★★ 装配清单在场，且"启用条数 === 主实例登记条数"（不变量，不冻结语料）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 2 ★★ 装配清单四个槽位各占一行，且"启用条数 === 主实例登记条数"（写了没接线 ⇒ 红）', async () => {
  /**
   * ── 这条臂要证的是什么 ────────────────────────────────────────────────────
   *
   * `src/readouts/index.ts` 是**四条线的槽位表**（一人一行）。它存在、被 import、
   * 被加载 —— **在一条都没接线时，读数上什么都看不出来**（`collectReadouts()` 仍是 `{}`）。
   *
   * ★★ 那正是本臂要说的那句话：**"装配清单写好了"与"清单根本没写"在读数上同形**。
   *   所以"清单存在"必须由**源码形状**来证，而不能靠读数 —— 靠读数的话，
   *   一条恒绿的断言就能冒充"接线做完了"。
   *
   * ── ★ 为什么断言的是**一致性**而不是"启用条数 === 0" ──────────────────────────
   *
   *   「清单里启用的 `contributeReadout(...)` 条数」必须等于「主实例里已登记的槽位数」：
   *
   *     · 今天 0 === 0 ⇒ 绿
   *     · 某条线取消注释 ⇒ 1 === 1 ⇒ **仍绿**（这就是它不冻结局面的原因）
   *     · 清单启用了、模块却没加载/没登记 ⇒ 1 !== 0 ⇒ **红** ← 本仓记账最久的形态：
   *       **写了，而一次都没被执行**
   */
  const listPath = join(ROOT, 'src', 'readouts', 'index.ts')
  const source = readFileSync(listPath, 'utf8')

  /** 逐行分类：启用行 vs 注释行（★ 只认行首，不认行中出现，避免把注释里的示例算成启用）。 */
  const enabled = []
  const commented = []
  for (const line of source.split('\n')) {
    const active = line.match(/^\s*contributeReadout\('([a-zA-Z]+)'/)
    const off = line.match(/^\s*\/\/\s*contributeReadout\('([a-zA-Z]+)'/)
    if (active !== null) enabled.push(active[1])
    if (off !== null) commented.push(off[1])
  }

  /** ★ 四槽位**各占一行**：四个人各改自己那一行 ⇒ 冲突面是 1 行；缺失或重复 ⇒ 红。 */
  for (const slot of SLOTS) {
    const seen = [...enabled, ...commented].filter((name) => name === slot).length
    assert.equal(seen, 1, `★ 槽位 ${slot} 在装配清单里必须**恰好占一行**，实际 ${seen} 行`)
  }

  /**
   * ── ★★ 普查：`src/**` 里必须**恰好有一处** import 了装配清单 ────────────────────
   *
   * ★ 为什么"恰好一处"：两处 ⇒ 同一模块实例被登记两次 ⇒ `contributeReadout` 在
   *   第二条线落地时**当场抛**（重复认领）。那是一条只在运行时才炸的缺陷，
   *   静态普查就能挡住。零处 ⇒ 清单挂了没人拉（四条线取消注释后一次都不会被调用，
   *   而读数上看起来只是"还没做"）。
   * ★ 不写死文件名（扫描全 `src/**`）⇒ 那个 import 搬到哪儿都跟得上。
   *   ★ v1 这里写死读 `src/snapshot.ts`，被 `gate-source-reading-convention.test.mjs`
   *     当场报成"写死 src 路径读文本"（**那条判据是对的**：我要问的是"清单在这条
   *     加载路径上吗"，不是"这行在某个文件里吗"）。改成本普查后搬走不误红。
   */
  const walk = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : []
    })
  /** ★ 只认**模块说明符**里的 `readouts/index.ts`（注释里提到它不算 —— 注释不加载模块）。 */
  const importsAssemblyList = (text) => text.split('\n').some((line) => {
    const bare = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '')
    return /^\s*(import|export)\b.*['"][^'"]*readouts\/index\.ts['"]/.test(bare)
  })
  const importers = walk(join(ROOT, 'src'))
    .filter((file) => importsAssemblyList(readFileSync(file, 'utf8')))
    .map((file) => relative(ROOT, file).split('\\').join('/'))
    .filter((rel) => !rel.startsWith('src/readouts/'))

  assert.equal(
    importers.length, 1,
    `★ \`src/**\` 里 import 装配清单的地方必须**恰好一处**，实际 ${importers.length} 处：${importers.join(', ') || '（零处！）'}`
    + ' —— 零处 ⇒ 四条线取消注释后 `contributeReadout` 一次都不会被调用（而读数上看起来只是"还没做"）；'
    + '两处 ⇒ 第二条线落地时重复认领当场抛',
  )

  const root = makeRoot()
  try {
    const keys = await mainKeys(root)
    assert.equal(
      enabled.length, keys.length,
      `★ 清单里启用了 ${enabled.length} 条（${enabled.join(',') || '无'}），而主实例里登记了 ${keys.length} 条（${keys.join(',') || '无'}）`
      + ' —— 两者不等，说明"清单写了"与"清单真的被 import 过"分了叉（写了没接线）',
    )
    console.log(`  臂2 ▸ 四槽位各 1 行（启用 ${enabled.length} / 注释 ${commented.length}）| 主实例登记 ${keys.length} 条 | importers = ${importers.join(', ')}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 3 注册 ⇒ 在场，且 context 三格如实转发（隔离实例）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 3 注册 ⇒ collectReadouts 里该槽位在场，且 provider 收到的 context 三格都是真值', async () => {
  const ro = await isolated('arm3')
  let seen = null
  ro.contributeReadout('evidence', (ctx) => {
    seen = ctx
    return { wired: true, closures: 2 }
  })

  const ctx = { teamId: 't1', stateRoot: '/tmp/some-root', historic: false }
  const collected = await ro.collectReadouts(ctx)

  assert.deepEqual(collected, { evidence: { wired: true, closures: 2 } }, `★ 期望只有 evidence 一格，实际 ${JSON.stringify(collected)}`)

  /**
   * ★ context 的每一格都必须是真值：`stateRoot` / `teamId` 若悄悄变成 `undefined`，
   *   provider 会去读一个不存在的目录，而读失败很容易被它自己圆成"没有证据" ——
   *   那正是"读不到"与"没有"同形。⇒ 三格逐字段比对（不是 `!== undefined` 那种弱断言）。
   */
  assert.deepEqual(seen, ctx, '★ 容器必须把 context 原样转发给 provider（三格逐字段）')
  console.log(`  臂3 ▸ collected = ${JSON.stringify(collected)} | context = ${JSON.stringify(seen)}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 4 ★★ provider 抛错 ⇒ { unmeasured } 而不是缺席（本地基的全部价值之一）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 4 ★★ provider 抛错 ⇒ 该槽位 = { unmeasured: … }，不是缺席、不是 {}，且不连坐别的槽位', async () => {
  const ro = await isolated('arm4')
  ro.contributeReadout('pairing', () => { throw new Error('disk went away mid-read') })
  /** ★ 同实例里的对照槽位：一个抛错不许影响它（★ v1 这条对照读的是**别臂**注册的值 ⇒ 别臂一抛它就连带红，那条红是假的）。 */
  ro.contributeReadout('evidence', () => ({ healthy: true }))

  const collected = await ro.collectReadouts({ teamId: 't1', stateRoot: '/tmp', historic: false })

  /** ① 该槽位必须在场（否则"崩了"与"没接"同形）。 */
  assert.ok('pairing' in collected, `★ 期望 pairing 在场，实际键：${Object.keys(collected)}`)
  /** ② 形状必须是 `{ unmeasured: string }`，且**带上原因**（原因丢了等于没测）。 */
  assert.equal(typeof collected.pairing.unmeasured, 'string', `★ 期望 { unmeasured }, 实际 ${JSON.stringify(collected.pairing)}`)
  assert.match(collected.pairing.unmeasured, /disk went away mid-read/, '★ 原始错误信息必须带出来，否则无法判断是什么坏')
  /** ③ 对照：同实例的正常槽位不受影响。 */
  assert.deepEqual(collected.evidence, { healthy: true }, '★ 一个槽位抛错不许影响别的槽位')

  console.log(`  臂4 ▸ collected.pairing = ${JSON.stringify(collected.pairing.unmeasured)}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 5 ★★ undefined ⇒ 同上；且钉"未认领不出现"与"键序按预置槽位走"
// ─────────────────────────────────────────────────────────────────────────────

test('臂 5 ★★ provider 返回 undefined ⇒ { unmeasured }；未认领的槽位不出现；键序按预置槽位而非登记顺序', async () => {
  const ro = await isolated('arm5')

  /**
   * ★★ 登记顺序**故意与预置顺序不同**（backends 先于 evidence）。
   *   否则"键序"那条断言会**恒真**（登记序恰好也是预置序）。
   */
  ro.contributeReadout('backends', () => undefined)
  ro.contributeReadout('evidence', () => ({ healthy: true }))
  /** templates / pairing 故意不登记。 */

  const collected = await ro.collectReadouts({ teamId: 't1', stateRoot: '/tmp', historic: false })

  assert.equal(typeof collected.backends?.unmeasured, 'string', `★ 期望 backends = { unmeasured }, 实际 ${JSON.stringify(collected.backends)}`)
  assert.match(collected.backends.unmeasured, /returned undefined/, '★ 原因里必须说清是 undefined')

  /** ★ 纪律 ③ 的对照：没认领的槽位**根本不出现**（不是 `{}`、不是 `undefined`）。 */
  assert.equal('templates' in collected, false, '★ 没认领的槽位不许出现在结果里')
  assert.equal('pairing' in collected, false, '★ 没认领的槽位不许出现在结果里')

  /** ★ 键序 = 预置槽位顺序（evidence 在 backends 前），不是登记顺序（backends 先登记）。 */
  assert.deepEqual(Object.keys(collected), ['evidence', 'backends'], '★ 键序必须按预置槽位走，而不是按登记顺序')

  console.log(`  臂5 ▸ 键集合 = ${JSON.stringify(Object.keys(collected))} | backends = ${JSON.stringify(collected.backends.unmeasured)}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 6 认领纪律：三种错误都必须当场抛（不静默新增 / 不静默覆盖）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 6 未知槽位 / 重复认领 / 非函数 provider 三者都抛错', async () => {
  /** ★ 隔离实例：不许动主实例（那里有装配清单的登记，碰了会误伤四条线）。 */
  const ro = await isolated('arm6')

  /** ① 拼错的槽位名（比 `evidence` 少一个字母）：不许被静默新增成一个第五槽位。 */
  assert.throws(() => ro.contributeReadout('evidance', () => 1), /not one of the 4 reserved slots/)

  /** ② 重复认领：不许"后写的赢"（那会让"两条线抢一个槽位"与"一条线改了实现"同形）。 */
  ro.contributeReadout('evidence', () => 1)
  assert.throws(() => ro.contributeReadout('evidence', () => 2), /already claimed/)

  /** ③ 非函数：一个永远不会被调用的 provider 不许占住槽位。 */
  assert.throws(() => ro.contributeReadout('templates', null), /without a provider function/)

  console.log('  臂6 ▸ 三种认领错误都抛出')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 7 归档支（historic）如实转发给 provider
// ─────────────────────────────────────────────────────────────────────────────

test('臂 7 归档支（historic）如实转发给 provider —— 归档团队不许被当成"活着"去探', async () => {
  const ro = await isolated('arm7')
  let seen = null
  ro.contributeReadout('templates', (ctx) => { seen = ctx; return { templates: 0 } })

  const collected = await ro.collectReadouts({ teamId: 't1', stateRoot: '/tmp', historic: true })

  assert.equal(seen.historic, true, `★ 必须转发 historic=true，实际 ${JSON.stringify(seen)}`)
  assert.deepEqual(collected.templates, { templates: 0 })
  console.log(`  臂7 ▸ historic = ${seen.historic}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 8 ★★ async reject 也必须落成 unmeasured（try/catch 必须覆盖 await）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 8 ★★ async provider reject ⇒ { unmeasured }；正常 async 读数在场；未登记的仍缺席', async () => {
  /**
   * ★ 为什么必须单独一条臂：臂 4 证的是**同步抛**（try 块里直接 throw）。
   *   四条线里有三条要读盘，它们会是 **async** 的 —— 而 async provider 的失败
   *   是 `await` 之后才发生的 reject。若实现写成 `const v = provider(ctx)` 再
   *   在 try 外面 await（或忘了 await），臂 4 仍绿，而真实故障会让
   *   `collectReadouts` 整只抛出 ⇒ 快照全没 ⇒ 整个面板空白。
   */
  const ro = await isolated('arm8')
  ro.contributeReadout('evidence', async () => { throw new Error('readTeam EIO') })
  ro.contributeReadout('pairing', async () => { await Promise.resolve(); return undefined })
  ro.contributeReadout('backends', async () => ({ bits: ['headless'] }))
  /** templates 故意不登记。 */

  const collected = await ro.collectReadouts({ teamId: 't9', stateRoot: '/tmp', historic: false })

  assert.match(collected.evidence.unmeasured, /readTeam EIO/, '★ async reject 必须被捕获并带出原因')
  assert.match(collected.pairing.unmeasured, /returned undefined/, '★ async 返回 undefined 同样落 unmeasured')
  assert.deepEqual(collected.backends, { bits: ['headless'] }, '★ 正常 async 读数不许被前面两个故障连坐')
  assert.equal('templates' in collected, false, '★ 未登记的 templates 必须不出现')

  console.log('  臂8 ▸ async reject ⇒ unmeasured | async undefined ⇒ unmeasured | 正常 async 读数在场 | templates 缺席')
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 9 ★★ 快照接缝保真：登记的东西**原样**出现在快照的 readouts 上
// ─────────────────────────────────────────────────────────────────────────────

test('臂 9 ★★ 快照接缝保真：provider 返回的值原样进快照，且 context 由快照构造（teamId/stateRoot/historic）', async () => {
  /**
   * ── 这条臂钉的是 `assembleTeamSnapshot` 那一侧（容器自己已被臂 3-8 钉完）────────
   *
   * ★★ 它有**两个分支**，走哪个由"主实例上还有没有空槽位"决定 —— **如实说明**：
   *
   *   ① **spy 分支**（主实例上还有空槽位时，今天就是这一支）：
   *      在**主实例**上占一个空槽位，然后走**真快照**，断言
   *      · 快照 `readouts[该槽位]` 等于 spy 返回的值（值**原样**转发，不被包一层）；
   *      · spy 收到的 context **三格** = 快照构造的那一份（`teamId` = state.id、
   *        `stateRoot` = 形参、`historic` = `options.historic === true`）。
   *      ⇒ **这一支判别力最强**：它钉住 M7（historic 恒 false）、M8（stateRoot 传空串）。
   *
   *   ② **保真分支**（四个槽位都被四条线占了 ⇒ 主实例没有空位可占）：
   *      退化为「快照 `readouts` 的**每一个**键值都必须等于主实例 `collectReadouts`
   *      在**同一个 context** 下的同名值」。⇒ 仍钉住"转发不吞、不改形"。
   *      ★★ 而这一支**也能钉住 M7/M8**，做法是**差分**（下面 `differential`）：
   *        先问"把 `historic` 从 false 换成 true，四条线的输出**会不会变**？"
   *          · 会变 ⇒ 快照在归档支必须等于 `historic:true` 那一份 ⇒ M7 会被打红；
   *          · 不变 ⇒ **本支测不了**（四条线的 provider 不依赖那一格）——
   *            如实打印"这一条今天测不了"，**不假装覆盖**（本仓三态纪律）。
   *      ★ 这不是"跳过"：两支**都**有断言，只是**覆盖范围不同**，且分支会打印出来。
   *      ★ M7/M8 在**测不了**那一阶段的处置交给四条线各自的夹具（它们的 provider 收到
   *        context，只有它们知道 `historic` 对自己意味着什么）—— 这条移交写在
   *        `src/readouts.ts` 的 `ReadoutContext` 注释里。
   */
  const root = makeRoot()
  try {
    const keysBefore = await mainKeys(root)
    const free = SLOTS.find((slot) => !keysBefore.includes(slot))

    if (free !== undefined) {
      /** ── 分支 ①：spy 分支 ─────────────────────────────────────────────── */
      let seen = null
      mainReadouts.contributeReadout(free, (ctx) => { seen = ctx; return { spy: free, marker: 1 } })

      const live = await snapshotOf(root)
      assert.deepEqual(live.readouts[free], { spy: free, marker: 1 }, `★ 快照 readouts.${free} 必须原样等于 provider 的返回值`)
      assert.deepEqual(
        seen, { teamId: 't1', stateRoot: root, historic: false },
        '★ 快照构造的 context 三格必须是真值（stateRoot 传空串 / historic 恒 false 都会在这里红）',
      )

      /** ★ 归档支单独再走一次：`options.historic === true` 必须如实传到 provider。 */
      const archived = await snapshotOf(root, { historic: true, includeRemoved: true })
      assert.equal(seen.historic, true, `★ 归档支必须传 historic=true，实际 ${JSON.stringify(seen)}`)
      assert.deepEqual(archived.readouts[free], { spy: free, marker: 1 })

      console.log(`  臂9 ▸ spy 分支（主实例空闲槽位 = ${free}）| context = ${JSON.stringify({ ...seen })} | 值原样转发 ✓`)
    } else {
      /** ── 分支 ②：保真分支（四个槽位都被真实线占了）───────────────────────── */
      /**
       * ★★ 差分：先量出"上下文每一格对四条线的输出**有没有影响**"。
       *   有影响 ⇒ 快照若传错，输出就会与"正确的那一份"不等 ⇒ 断言有判别力。
       *   没影响 ⇒ 那一格今天**测不了**，如实打印（不假装覆盖）。
       */
      const at = (historic, stateRoot) => mainReadouts.collectReadouts({ teamId: 't1', stateRoot, historic })

      const expectLive = await at(false, root)
      const expectArchived = await at(true, root)
      /** ★ `stateRoot` 的差分坐标用 `''`（一个真实的传错形态：形参没接上就成了空串）。 */
      const expectEmptyRoot = await at(false, '')
      const historicDiscriminating = JSON.stringify(expectLive) !== JSON.stringify(expectArchived)
      const rootDiscriminating = JSON.stringify(expectLive) !== JSON.stringify(expectEmptyRoot)

      const live = await snapshotOf(root)
      assert.deepEqual(live.readouts, expectLive, '★ 快照 readouts 必须与主实例 collectReadouts 的同 context 结果逐字段相等（转发不许吞、不许改形）')
      assert.deepEqual(Object.keys(live.readouts), SLOTS, '★ 四线全落时 readouts 必须四格都在')

      const archivedLive = await snapshotOf(root, { historic: true, includeRemoved: true })
      assert.deepEqual(Object.keys(archivedLive.readouts), SLOTS, '★ 归档支同样必须四格都在')
      if (historicDiscriminating) {
        /** ★ 走到这里 ⇒ `historic` 真的会改变输出 ⇒ 这一条**有判别力**，M7 会红。 */
        assert.deepEqual(
          archivedLive.readouts, expectArchived,
          '★ 归档支快照必须等于"historic:true 那一份" —— 传成 false（或恒 false）会在这里红',
        )
      }
      if (rootDiscriminating) {
        /**
         * ★ 走到这里 ⇒ `stateRoot` 真的会改变输出 ⇒ M8（传空串）会红。
         *   ★★ 若 `live.readouts` 已经等于 `expectEmptyRoot`（即快照真的传了空串），
         *     上面那条 `live.readouts === expectLive` 就已经红了 —— 这里再钉一次，
         *     是为了让"**两条路都能抓住 M8**"这一点不依赖于谓词求值顺序。
         */
        assert.notDeepEqual(live.readouts, expectEmptyRoot, '★ 非归档快照不许等于"stateRoot 传空串那一份"')
      }

      console.log(`  臂9 ▸ 保真分支（四槽位都被四条线占满，无空位可 spy）| 键集 = ${JSON.stringify(Object.keys(live.readouts))}`)
      console.log(`        ★ 差分判别力：historic ${historicDiscriminating ? '有（归档支已对拍）' : '无（四条线都不读那一格 ⇒ 测不了）'}`
        + ` · stateRoot ${rootDiscriminating ? '有（已对拍）' : '无（四条线都不读那一格 ⇒ 测不了）'}`)
      if (!historicDiscriminating || !rootDiscriminating) {
        console.log('        ★ 如实：上面标"无"的那一格本支**测不了**，不假装覆盖；'
          + '它移交给四条线各自的夹具（只有它们知道那一格对自己意味着什么）')
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 臂 10 ★★★ context 构造的**直接**证据（不依赖任何 provider 的写法）
// ─────────────────────────────────────────────────────────────────────────────

test('臂 10 ★★★ readoutContextOf 三格原样、不许兜底：空串仍是空串 / 正常串原样 / historic 如实', async () => {
  /**
   * ── 这条臂钉的是**函数的契约**，不是**调用点**（★ 这个区分必须写清）────────────
   *
   * 臂 9 的差分探针只管得住"读那一格的 provider"：一条**不读** `stateRoot` 的
   * provider（只报静态能力位那种）会让"值传错了"在读数上完全看不出来
   * ⇒ 那条不变量**无守卫**。MEASURED（2026-10-24）：把 `stateRoot` 改成 `''`，
   * 若四条线都不读它 ⇒ 全绿。
   *
   * ⇒ 提成导出纯函数 `readoutContextOf`（`src/snapshot.ts`）后，**这里**能无条件地
   *   钉住"这个函数**不篡改**任何一格、也不多吐一格" —— 与 provider 写法无关。
   *
   * ★★ **它钉不住的那一半，如实写明**：MEASURED（2026-10-24）——把**调用点**改成
   *   `readoutContextOf(state.id, '', …)`，本臂**照样绿**。因为本臂断言的是
   *   `readoutContextOf('/a/b') === '/a/b'`，它看不见"快照有没有用它、用什么参数调它"。
   *   ⇒ **调用点**那一半今天由臂 9 的 spy 支钉（主实例有空槽时），四线全落后**无守卫**。
   *   闭合它需要"在调用点上可观察"，那是另一件事（未做，见文件头那张三类证据表）。
   *
   * ★★ 每一格都钉"**不许兜底**"，因为兜底会让真实的传错形态**永久不可见**：
   *   · `stateRoot: ''` 若被兜底成 `'.'` / `process.cwd()`，那个缺陷就再也测不出来，
   *     而 provider 会去读一个"看起来合法"的错目录；
   *   · `teamId` 若被 trim/normalize，会让"读错了队"与"读到了空"同形；
   *   · `historic` 必须是 `=== true` 的那一支，不是"真值判断"。
   *
   * ★ 判别力实测（2026-10-24，逐个施加、跑完复原）：
   *   · 函数里 `stateRoot || '.'`      ⇒ 臂 10 红 ✅
   *   · 函数里 `teamId.trim()`         ⇒ 臂 10 红 ✅
   *   · 函数里 `historic: true` 硬编码 ⇒ 臂 10 红 ✅
   *   · 函数里多吐第四格               ⇒ 臂 10 红 ✅（下面那条形状断言）
   *   · **调用点传 `''`**              ⇒ ❌ 臂 10 **绿**（盲区，见上）
   */
  /** ① 空串必须原样（★ 这是 M8 的判据：谁把 `stateRoot` 传空，这里就红） */
  assert.deepEqual(
    readoutContextOf('t1', '', false), { teamId: 't1', stateRoot: '', historic: false },
    '★ `stateRoot: \'\'` 必须原样传出 —— **不许**兜底成 \'.\' / cwd / \'/\'（兜底会让"形参没接上"永久不可见）',
  )
  /** ② 正常串原样（不做 trim / resolve —— 它是路径，但归一化是调用方的事，不是这里的） */
  assert.deepEqual(
    readoutContextOf('t1', '/a/b', false), { teamId: 't1', stateRoot: '/a/b', historic: false },
    '★ `stateRoot` 必须原样（不 trim、不 resolve、不 join）',
  )
  /** ③ historic 两个方向都原样 */
  assert.deepEqual(readoutContextOf('t1', '/a/b', true), { teamId: 't1', stateRoot: '/a/b', historic: true }, '★ historic:true 必须原样')
  assert.deepEqual(readoutContextOf('t1', '/a/b', false), { teamId: 't1', stateRoot: '/a/b', historic: false }, '★ historic:false 必须原样')
  /** ④ teamId 原样（含空格 / 特殊字符也不许被归一化）—— 它是 durable 目录名 */
  assert.deepEqual(
    readoutContextOf(' t-1 ', '/a/b', false), { teamId: ' t-1 ', stateRoot: '/a/b', historic: false },
    '★ `teamId` 必须原样（不 trim、不 normalize）—— 归一化会让"读错了队"与"读到了空"同形',
  )

  /**
   * ★★ 第五格：**形状封闭** —— 不许悄悄多出第四格。
   *   （多一格意味着有个字段在没人审的情况下进了 provider 的输入面；
   *     `ReadoutContext` 是封闭契约，加字段要过裁定。）
   */
  assert.deepEqual(
    Object.keys(readoutContextOf('t1', '/a/b', false)), ['teamId', 'stateRoot', 'historic'],
    '★ context 必须**恰好**三格（加第四格是契约变更，不是本地改动）',
  )

  console.log(`  臂10 ▸ 三格原样（'' 不兜底 / '/a/b' 不归一化 / historic 双向如实）+ 形状恰好三格 ✓`)

  /**
   * ── ★★★ 状态检测（第二处）：**调用点**那一半有没有守卫（team-lead 裁决 2026-10-24）──
   *
   * 与臂 1 的那处**完全同构**：空态时断言 / 落地时打印"无守卫"。
   * ⇒ 两处告警合起来，读的人一眼看到"这个夹具在四线落地后有 N 条性质失效"。
   *
   * ★★ 为什么调用点今天由**臂 9 的 spy 支**兜着：
   *   臂 9 在**主实例**上空槽里登记一个 spy，然后走真快照 ⇒ 它断言 spy 收到的
   *   context 三格**逐字段**等于期望。那正好就是"快照用哪三个参数调"的证据。
   *   而它需要主实例**还有空槽位** —— 四线全落后没有空位，那一支退场。
   *
   * ★ 判据用的是 `landedLinesAtStart`（臂 1 在**臂 9 占位之前**记下的真实落地数），
   *   不是现在现数 —— 现数会把臂 9 的 spy 算成"又落地了一条线"。
   */
  /**
   * ★ 单个臂单跑（`arm-isolation-check`）时臂 1 没跑 ⇒ `landedLinesAtStart` 为 null，
   *   这里就地数一次。★ 就地数**要用一个随用随删的根**（不能漏临时目录）：
   *   那一步只是读**键集**，不关心根里有什么。
   */
  let landed = landedLinesAtStart
  if (landed === null) {
    const probeRoot = makeRoot()
    try { landed = await mainKeys(probeRoot) } finally { rmSync(probeRoot, { recursive: true, force: true }) }
  }
  if (landed.length === 0) {
    console.log(`  臂10 ▸ 调用点由**臂 9 的 spy 支**兜着（主实例空 ⇒ 有空槽可 spy）—— 这一半今天有守卫 ✓`)
  } else {
    console.log(
      `  臂10 ▸ 调用点【无守卫】：主实例已有 ${landed.length} 条线落地（${landed.join(', ')}），臂 9 的 spy 支已退场。`
      + ' 读数的 context 仍由 readoutContextOf 构造（函数契约已被臂 10 钉住），'
      + ' 但"快照用哪三个参数调它"现在没有任何臂能观察到。'
      + ' ★ 这条性质【无守卫】——若要闭合，需在调用点注入或回显（第四类证据），未做。',
    )
  }
})
