#!/usr/bin/env node
/**
 * ── ★★★ 停摆检测器（Stop Detector）────────────────────────────────────────────
 *
 * 由来（2026-10-09 实测）：本会话团队停摆【五次】，而每次的成因不同：
 *
 *   ① 成员被一条 in_progress/claimed 占着（协议：一人不能持两件）
 *   ② pending 卡在【failed 依赖】上，而那个 failed 的产物【已在主树】
 *   ③ 悬挂 `handoffId` 而 attempt 仍为 0（票在队列里，或调度器不再送它）
 *   ④ `[deployment]` 那条门 ⇒ 成员照做也交不上
 *   ⑤ captain yield 了而没核 ready 数（★ 而那是人记不住的）
 *
 * ★ 而 ①②③ 的共同点：**它们让 ready 变成 0，而 pending 看起来还很多** ——
 *   于是"看起来还有很多活"与"没有人能开工"在读数上同形。
 *
 * ★ 所以本脚本把【在 yield 之前必须算的三个数】做成机械的 ——
 *   因为一条靠人记得的规则会腐烂（本会话已证）。
 *
 * 用法:
 *   node scripts/team-stall-check.mjs <teamId>
 *   node scripts/team-stall-check.mjs unified-pipeline
 *
 * 退出码:
 *   0 ⇒ 真的在推进（三个数都为 0，且 ready > 0，或有成员在跑）
 *   1 ⇒ 停摆（三个数里至少一个不为 0，且 ready === 0）
 *   2 ⇒ 用法错误 / 读不到 team.json
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

function readTeam(teamId) {
  const path = join(ROOT, '.agent-teams', teamId, 'team.json')
  if (!existsSync(path)) return undefined
  return { path, team: JSON.parse(readFileSync(path, 'utf8')) }
}

/** 那条任务有没有一个【主树里的提交】—— 那是"产物已在主树"的机械形式。 */
function hasCommit(cwd, taskId) {
  try {
    const out = execFileSync('git', ['log', '--oneline', '--all', `--grep=(${taskId})`], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out.trim() !== ''
  } catch {
    return false
  }
}

async function analyse(teamId) {
  const found = readTeam(teamId)
  if (found === undefined) return undefined
  const { team } = found
  const byId = Object.fromEntries(team.tasks.map(t => [t.id, t]))

  /**
   * ① 成员被占着。
   *
   * ★★★ 判据是【成员自己的状态】，不是【多久没更新】（2026-10-09 实测，已更正）：
   *
   *   我第一版用"距上次更新多久"当"它在不在跑"的【代理】—— 而那是错的：
   *   ```
   *   成员 status = idle，而他名下有一条 claimed/in_progress
   *     ⇒ ★ 那就是占位，与"多久没更新"无关
   *   ```
   *   实测：t5/t15 停了 22 分钟，而阈值是 30 分钟
   *   ⇒ ★ 检测器判它们"在跑" ⇒ 报"在推进"，而实际【全队零 turn】。
   *
   * ★★ 所以正确的信号是那个成员【自己说它是什么状态】：
   *   · member.status === 'idle' 而名下有未完成 ⇒ ★ 占位（他没事做，而那件事还挂着他）
   *   · member.status === 'working'               ⇒ 真的在跑
   *   ⇒ ★ 而"多久没更新"只作【附注】（说明占位持续了多久），不作判据。
   *
   * ★ 而它正是本队那条纪律的又一次：**时间里没有"在不在跑"，只有成员状态里有。**
   */
  const occupying = []
  for (const member of team.members ?? []) {
    const mine = team.tasks.filter(
      t => t.assignee === member.name && (t.status === 'in_progress' || t.status === 'claimed'),
    )
    if (mine.length === 0) continue
    /** ★ 成员自己说 idle ⇒ 没有 turn 在跑 ⇒ 而这些任务挂着它 ⇒ 占位。 */
    if (member.status !== 'idle') continue
    for (const task of mine) {
      const idleMs = Date.now() - (task.updatedAt ?? Date.now())
      occupying.push({
        member: member.name,
        task: task.id,
        status: task.status,
        idleMinutes: Math.round(idleMs / 60000), // ★ 附注，不是判据
      })
    }
  }

  /**
   * ② 死边：pending 的依赖里有 failed/cancelled，而那个任务【有主树提交】。
   *
   * ★★ 而这里有一格必须分清（2026-09-09 实测）：
   *   · 依赖的那条任务【未开工】(attempt === 0) ⇒ 它【真的】会被卡住 ⇒ 计入
   *   · 依赖的那条任务【已开工】(attempt > 0) ⇒ 调度器已经取走过它 ⇒
   *     ★ 那条边【不阻塞】它的派发 ⇒ 不计入（否则会误报停摆）
   *   —— 而"依赖列表里有一条 failed"与"它因此开不了工"是两件事。
   */
  const deadEdges = []
  for (const task of team.tasks) {
    if (task.status !== 'pending') continue
    if ((task.attempt ?? 0) > 0) continue // ★ 已开工 ⇒ 那条边不阻塞它
    for (const dep of task.dependencies ?? []) {
      const d = byId[dep]
      if (d === undefined || !TERMINAL.has(d.status) || d.status === 'completed') continue
      deadEdges.push({ task: task.id, dependsOn: dep, depStatus: d.status, artefactInMain: hasCommit(ROOT, dep) })
    }
  }

  /**
   * ③ 悬挂交接：pending 且 attempt=0 且带 handoffId。
   *
   * ★★★ 而这里【必须】分清两件在记录上同形的事（2026-10-09 实测）：
   *
   *   (a) 【正常排队】—— 票已创建，而调度器【会】送它
   *       ⇒ 判据: 那个成员 idle、且名下没有未完成的任务 ⇒ 它会轮到
   *   (b) ★ 【真卡住】—— 票挂着而调度器【不再送它】
   *       ⇒ 判据: 那个成员正被别的任务占着，而那张票【一直轮不到】
   *         （t27 复现两次的情形；t35 要修的就是它）
   *
   * ⇒ ★ 而两者都是"pending + attempt=0 + 有 handoffId"，【读数同形】——
   *   所以只有加上"那个成员当前可不可用"才分得开。
   */
  const danglingHandoffs = []
  for (const t of team.tasks) {
    if (t.status !== 'pending' || t.attempt !== 0 || typeof t.handoffId !== 'string') continue
    const owner = (team.members ?? []).find(m => m.name === t.assignee)
    const ownerBusy = team.tasks.some(
      o => o.assignee === t.assignee && o.id !== t.id && (o.status === 'in_progress' || o.status === 'claimed'),
    )
    const ownerUsable = owner !== undefined && owner.status !== 'removed'
    danglingHandoffs.push({
      task: t.id,
      assignee: t.assignee,
      queued: ownerUsable && !ownerBusy, // ★ true ⇒ 正常排队；false ⇒ 真卡住
      ownerStatus: owner?.status ?? '(无此成员)',
    })
  }

  /** ready = pending ∩ 依赖全 completed */
  const ready = team.tasks.filter(
    t => t.status === 'pending' && (t.dependencies ?? []).every(d => byId[d]?.status === 'completed'),
  )

  const running = team.tasks.filter(t => t.status === 'in_progress' || t.status === 'claimed')

  /**
   * ④ ★ `[deployment]` 那条门 —— 它是【唯一重启能解】的那一条。
   *
   * 由来：本会话大量终态是"工作已完成而交不上"，而其中一类成因是
   *   `[deployment] this process holds a build OLDER than the one on disk`
   *   ⇒ 它挡着【每一次】update_task ⇒ 成员一轮又一轮 "试交 ⇒ 被拒 ⇒ 报"。
   *
   * ★★ 而它【不在 team.json 里】—— 所以前三个信号测不到它。
   *    它由 `moduleFreshness()` 给出（`src/tools/shared/entities.ts:853`）:
   *      loaded = 进程加载时读的 stamp（★ 只读一次，缓存常量）
   *      onDisk = 盘上当前 lib 的 stamp
   *      head   = 主树当前 commit
   *    ⇒ ★ "进程旧"与"盘上旧"是两件事 —— 而只有 reload 能修前者。
   *
   * ★★★ 而本条信号有一条【必须说清的边界】（诚实优先于好看）:
   *     本脚本在【一个新进程】里跑 ⇒ 它读到的 `loaded` 是【它自己加载的那份】，
   *     而【宿主进程持有的那份】它看不到。
   *   ⇒ 所以:
   *       报 "是" ⇒ ★ 板上钉钉：盘上的产物与它自己的加载不一致 ⇒ 要 build + reload
   *       报 "否" ⇒ ★ 只说明【盘上是一致的】——
   *                 而宿主可能是旧的（那要读宿主那行 `[deployment]`，而它不在此文件里）
   *   ⇒ ★ 所以 ④ 只能【确认要重启】，不能【确认不需要重启】。
   *     而这条边界写在这里，而不是让它读起来像"全部查过了"（本会话最贵那条）。
   */
  let freshness
  try {
    const mod = await import('../lib/tools/shared/entities.js')
    const f = mod.moduleFreshness()
    freshness = {
      status: f?.status,
      why: f?.why,           // ★ 'content' | 'commit' —— 两者补救动作不同
      behind: f?.behind,
      content: f?.content,
      loaded: f?.loaded,
      onDisk: f?.onDisk,
      head: f?.head,
      /**
       * ★★★ 两种陈旧【不同形】（verifier 在 t5 上实测后 captain 采纳）:
       *   why='content' ⇒ 盘上产物与加载的不是同一份 ⇒ ★ 要 build（重生成产物）
       *   why='commit'  ⇒ ★ 内容一致，而它构建时的 commit 落后于 HEAD
       *                   ⇒ 可能只是"有提交但没动那个产物" ⇒ 不一定要 build
       *   ⇒ ★ 而只报"stale / 否"是粗的 —— 它把这两种合成了一个字。
       */
      stale: f?.status === 'stale',
    }
  } catch (error) {
    freshness = { undecidable: String(error) }
  }

  /**
   * ⑤ ★★★ 【团队心跳】—— `team.json` 多久没被写过了（用户提的第二来源）
   *
   * 由来（2026-10-09，用户提问）：本会话反复出现"团队日志几个小时没写"，
   *   而**那条读数我一直在人肉看**（`ls -la team.json`），却从没让脚本看它。
   *
   * ★★ 而它与前四个信号探的是【不同的东西】：
   *   ```
   *   ①②③ 探的是【任务与成员的状态】
   *   ④   探的是【进程加载的代码】
   *   ⑤ ★ 探的是【这个队整体还在不在动】—— 它是【唯一一个不依赖任何假设】的信号
   * ```
   *   ⇒ ★ 前三者都可能"看起来正常而实际停了"（今晚就是：全部 idle、零占位、
   *     零死边、零悬挂交接，而**队已经不写了**）。
   *
   * ★★★ 而它与 `runtime.liveness`（探活）的分工值得说清：
   *   · `runtime.liveness` 探的是【一个等待窗口里，那个成员的 lastActivityAt 变没变】
   *     ⇒ 它需要【有等待窗口】才开口
   *   · 本信号探的是【整队有没有在写】⇒ ★ 它【不需要任何窗口】——
   *     而今晚的病正是"**根本没有等待窗口**"（任务是 pending、成员 idle、
   *     调度器不派）⇒ ★ 探活【无从开口】，而本信号照样说话。
   *   ⇒ 所以两者是【互补】的：一个探"等着的那个还活着吗"，
   *     一个探"有没有任何东西在动"。
   */
  let heartbeat
  try {
    const stat = statSync(join(ROOT, '.agent-teams', teamId, 'team.json'))
    const ageMs = Date.now() - stat.mtimeMs
    /**
     * ★ 阈值：默认 15 分钟（可注入 STALL_AFTER_MS_HEARTBEAT）。
     *   ★ 为什么比成员的 10 分钟探活宽松：`team.json` 只在**状态变化**时被写
     *     （派发、认领、落终态、写 mailbox），而一个健康的长任务可能十几分钟不动它。
     *   ⇒ ★ 而"比 15 分钟更久没写"在【有 ready 任务而没人接】时是真的异常。
     */
    const limitMs = Number(process.env.STALL_AFTER_MS_HEARTBEAT ?? 15 * 60 * 1000)
    heartbeat = {
      ageMinutes: Math.round(ageMs / 60000),
      silent: ageMs >= limitMs,
      mtime: stat.mtimeMs,
    }
  } catch (error) {
    heartbeat = { undecidable: String(error) }
  }

  /**
   * ⑥ ★★★ 【写域冲突而依赖里没有对方】—— 一个漏掉的边
   *
   * 由来（2026-10-09，captain 在给 t39 盖 review 戳时抓到）：
   *   `t39` 的 deps = **空**，而它的前提是【t26 释放 `src/tools/update-task.ts` 的写域】
   *   （实测 t26 / t32 / t42 的 inScope 都含那个文件）
   *   ⇒ ★ 四者串行，而 t39 的依赖里【没有 t26】—— 那是我的契约错误。
   *
   * ★★ 而它为什么没被抓住：`t39` **创建在 t42/t32 之前**（那时还没有那几个占写域的任务）
   *   ⇒ 而"写域冲突"是后来才出现的，而**依赖列表不会自动更新**。
   *   ⇒ 于是那个冲突只在 `edit_plan` 的写域门禁上暴露一次，而**事后不再有人看见**。
   *
   * ★ 判据：把 inScope 两两求交，交集非空而依赖里没有对方的 ⇒ 那是漏掉的边。
   */
  const missingEdges = []
  const pendingTasks = team.tasks.filter(t => t.status === 'pending' || t.status === 'claimed' || t.status === 'in_progress')
  for (let i = 0; i < pendingTasks.length; i += 1) {
    for (let j = 0; j < pendingTasks.length; j += 1) {
      if (i === j) continue
      const a = pendingTasks[i]
      const b = pendingTasks[j]
      const aScope = a.inScope ?? []
      const bScope = b.inScope ?? []
      const shared = aScope.filter(p => bScope.includes(p))
      /** ★ 只报【单向缺对方】的那一半，否则每对会报两次。 */
      if (shared.length === 0) continue
      if ((a.dependencies ?? []).includes(b.id)) continue
      if ((b.dependencies ?? []).includes(a.id)) continue
      if (i < j) missingEdges.push({ a: a.id, b: b.id, shared: shared.join(', ') })
    }
  }

  /**
   * ⑦ ★★★ 【git worktree 台账的僵尸条目】—— 2026-10-10 的"推不动"真因
   *
   * 由来（MEASURED）：`createTaskWorktree` 失败于
   *   `fatal: '…/worktrees/task-t40' is a missing but already registered worktree`
   *   ⇒ ★ 于是 `dispatch` 在 worktree 那一格【拒绝派发】，而它只写 `logger.warn`
   *   ⇒ ★ 而"被拒"与"没人派"在 `team.json` 上完全同形。
   *
   * ★★ 当时的漂移量: git 台账 74 条 vs 盘上 38 个 ⇒ 33 条僵尸。
   * ⇒ ★ 而它一旦积起来，【每一条新派工都会撞上】—— 因为任务 id 会复用（t40 被删过）。
   *
   * ★ 判据：`prunable` 的条数 > 0 ⇒ 报出来（它们是"已删而仍登记"的）。
   *   ★ 而处置是 `git worktree prune` —— 它【只清 gitdir 指向不存在位置的】。
   */
  let worktreeRegistry
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const entries = out.split('\n\n').filter(block => block.trim() !== '')
    const prunable = (out.match(/^prunable/gm) ?? []).length
    const onDisk = existsSync(join(ROOT, '.agent-teams', 'worktrees'))
      ? readdirSync(join(ROOT, '.agent-teams', 'worktrees')).filter(name => name.startsWith('task-')).length
      : 0
    worktreeRegistry = { registered: entries.length, prunable, onDisk, stale: prunable > 0 }
  } catch (error) {
    worktreeRegistry = { undecidable: String(error) }
  }

  return { team, occupying, deadEdges, danglingHandoffs, ready, running, freshness, heartbeat, missingEdges, worktreeRegistry }
}

async function main() {
  const teamId = process.argv[2]
  if (teamId === undefined) {
    console.error('usage: node scripts/team-stall-check.mjs <teamId>')
    process.exit(2)
  }
  const a = await analyse(teamId)
  if (a === undefined) {
    console.error(`★ 读不到 .agent-teams/${teamId}/team.json`)
    process.exit(2)
  }

  const { team, occupying, deadEdges, danglingHandoffs, ready, running, freshness, heartbeat, missingEdges, worktreeRegistry } = a
  console.log(`── 停摆检测: ${teamId} ──────────────────────────────`)
  console.log(`  在跑/已认领        ${running.length}  ${running.map(t => t.id).join(', ') || '—'}`)
  console.log(`  真可开工 (ready)   ${ready.length}  ${ready.map(t => t.id).join(', ') || '—'}`)
  console.log()
  console.log(`  ① 成员被占着        ${occupying.length}  (判定: 成员 status=idle 而名下有未完成)`)
  for (const o of occupying) console.log(`       ${o.member} ← ${o.task} (${o.status}, 已 ${o.idleMinutes} 分钟无更新)`)
  console.log(`  ② 卡在 failed 依赖  ${deadEdges.length}`)
  for (const e of deadEdges) {
    console.log(`       ${e.task} ← ${e.dependsOn} (${e.depStatus})  产物在主树: ${e.artefactInMain ? '★ 是 ⇒ 该按产物判' : '否'}`)
  }
  const stuckHandoffs = danglingHandoffs.filter(h => !h.queued)
  console.log(`  ③ 悬挂交接          ${danglingHandoffs.length}  (其中真卡住 ${stuckHandoffs.length} / 正常排队 ${danglingHandoffs.length - stuckHandoffs.length})`)
  for (const h of danglingHandoffs) {
    console.log(`       ${h.task} → ${h.assignee} (attempt=0)  ${h.queued ? '排队中（等调度器送）' : '★ 真卡住（该成员正忙）'}`)
  }
  console.log()

  /**
   * ★ 判据（与 DISPATCH-RULES §16.2 逐字同源）：
   *   三个数都为 0 且（ready > 0 或有任务在跑）⇒ 真的在推进
   *   否则 ⇒ 停摆，而它要靠人解
   */
  console.log(`  ④ 部署陈旧          ${freshness?.stale === true ? '★ 是（运行的代码比 HEAD 旧）' : freshness?.undecidable !== undefined ? '判不了' : '否'}`)
  if (freshness?.stale === true) {
    console.log(`       why=${freshness.why ?? '?'}  behind=${String(freshness.behind ?? '').slice(0, 12)}…  head=${String(freshness.head ?? '').slice(0, 12)}…`)
    if (freshness.why === 'content') console.log('       ⇒ ★ 产物不一致 ⇒ 先 `pnpm build` 再重启')
    else console.log('       ⇒ ★ 内容一致而 commit 落后 ⇒ 它跑的可能是【旧的一版修复】⇒ 核那一版与本版的差异')
  }
  console.log(`  ⑤ 团队心跳          ${heartbeat?.undecidable !== undefined ? '判不了' : heartbeat.silent ? `★ 静默 ${heartbeat.ageMinutes} 分钟（团队日志没被写过）` : `正常（${heartbeat.ageMinutes} 分钟前写过）`}`)
  console.log(`  ⑥ 写域冲突而缺边    ${missingEdges.length}${missingEdges.length ? '  ← ★ 那些任务会互撞，而依赖里没有对方' : ''}`)
  for (const e of missingEdges) console.log(`       ${e.a} ↔ ${e.b}  (共享 ${e.shared})`)
  console.log(`  ⑦ worktree 台账     ${worktreeRegistry?.undecidable !== undefined ? '判不了' : worktreeRegistry.stale ? `★ ${worktreeRegistry.prunable} 条僵尸（登记 ${worktreeRegistry.registered} · 盘上 ${worktreeRegistry.onDisk}）` : `干净（登记 ${worktreeRegistry.registered} · 盘上 ${worktreeRegistry.onDisk}）`}`)
  console.log()

  const stallSignals = occupying.length + deadEdges.length + stuckHandoffs.length
    + (freshness?.stale === true ? 1 : 0)
    + (heartbeat?.silent === true ? 1 : 0)
    + (worktreeRegistry?.stale === true ? 1 : 0)
  /**
   * ★★★ 「在推进」必须要求【真的有人在跑】，而不只是"有任务可开工"
   *   （2026-10-09 实测：我把 `ready > 0` 当成"在推进"，
   *    于是当 4 条任务挂着 2 个 idle 成员、而 3 条 ready 时，它报"在推进"，
   *    而实际【全队零 turn】—— 而那正是用户看到"进行中 0"的那一刻。）
   */
  const anyoneWorking = (team.members ?? []).some(m => m.status === 'working')
  const progressing = anyoneWorking || occupying.length > 0
  if (stallSignals === 0 && progressing) {
    console.log(`⇒ ★ 在推进（成员 working: ${(team.members ?? []).filter(m => m.status === 'working').map(m => m.name).join(', ') || '—'}）`)
    process.exit(0)
  }
  if (stallSignals === 0 && !progressing) {
    console.log('⇒ ★★ 停摆 —— 而且这次【不是】三种已知成因之一:')
    console.log(`     没有任何成员在 working（全 idle），而 ready = ${ready.length}、未完成 = ${running.length}`)
    console.log('     ⇒ ★ 那是【调度器没有把 ready 送出去】—— 一种新的成因，要单独查')
    process.exit(1)
  }
  console.log('⇒ ★★ 停摆 —— 而它【不会自己好】。按 DISPATCH-RULES §16.5 的处置表逐条解:')
  if (occupying.length > 0) console.log('     ① ⇒ reassign_task 解开那个占位')
  if (deadEdges.some(e => e.artefactInMain)) console.log('     ② ⇒ 产物已在主树 ⇒ edit_plan 改那条依赖（不许改记录去骗依赖）')
  if (stuckHandoffs.length > 0) console.log('     ③ ⇒ 真卡住（该成员正忙）⇒ reassign 或先释放那个成员')
  if (freshness?.stale === true) console.log('     ④ ⇒ ★ 只有【重启】能修：先 pnpm build，再重启宿主（它挡着每一次 update_task）')
  if (heartbeat?.silent === true) console.log('     ⑤ ⇒ ★ 整队静默：核【有没有 ready 任务而没人接】—— 那说明调度器没在送票')
  if (worktreeRegistry?.stale === true) console.log('     ⑦ ⇒ ★ 跑 `git worktree prune`（它只清 gitdir 指向不存在位置的）—— ★ 否则每一次建树都会失败')
  process.exit(1)
}

main()
