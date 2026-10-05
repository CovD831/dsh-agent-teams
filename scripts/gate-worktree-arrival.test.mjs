/**
 * ── `dispatch.worktree` 的三臂夹具 + 「建不出就拒绝派发」的闸门臂 ──────────────────
 *
 * 契约要求每条判据自带三臂（`docs/GATE-REGISTRY.md` §6）：
 *
 *   臂 1（伪造臂）：成员【没有】在 worktree 里干活 —— 声明的路径落在【主检出】，
 *                   或压根不存在 ⇒ 期望 blocked
 *   臂 2（未测量臂）：读不到 worktree（没建出来 / EACCES / git 抖动） ⇒ 期望 unmeasured
 *                    ★ 不是 blocked（一次读取失败不是"工作落到主树了"）
 *                    ★ 更不能是 ok（那等于认证一份没人看过的工作）
 *   臂 3（对照臂）：声明的路径都在 worktree 里、都不在主检出的【提交里】 ⇒ 期望 ok
 *
 * 外加两条【接线臂】——模块对了不等于机制生效（上一轮的教训）：
 *
 *   臂 4：worktree 建不出来时 kickMember【不派发】（此前是 warn 后照常派发）
 *   臂 5：依赖按需注入必须是【复制品】（软链会被写穿，实测）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-05，本机复现）：`src/scheduler.ts` 的 kickMember 在
 * `needsWorktree` 的 kind 上建失败只 `logger.warn` 后照常派发 ⇒ 成员在共享
 * 工作区干活 —— 这是唯一能让工作落到主树的入口，且没有任何一步会拒绝它。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gate, appliesTo, id, point } from '../lib/gates/dispatch/worktree.js'
import { createTaskWorktree, provisionWorktreeDependencies } from '../lib/worktree.js'
import { installTeamScheduler } from '../lib/scheduler.js'
import { readTeam, withTeamLock } from '../lib/state.js'

/** 收窄助手：把"期望哪一种裁决"写进断言本身（与其它 gate 夹具同构）。 */
function expectBlocked(v) {
  if (v.ok !== false || !('blockers' in v)) throw new Error(`expected a blocked verdict, got ${JSON.stringify(v)}`)
  return v.blockers
}
function expectUnmeasured(v) {
  if (v.ok !== false || !('unmeasured' in v)) throw new Error(`expected an unmeasured verdict, got ${JSON.stringify(v)}`)
  return v.unmeasured
}
function expectOk(v) {
  if (v.ok !== true) throw new Error(`expected an ok verdict, got ${JSON.stringify(v)}`)
  return v
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

const cleanups = []
function track(dir) { cleanups.push(dir); return dir }
process.on('exit', () => {
  for (const dir of cleanups) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})

/** 最小但真实的仓库：一个已提交文件 + gitignore 的依赖目录。 */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'wt-arrival-repo-'))
  git(root, ['init', '-q', '.'])
  git(root, ['config', 'user.email', 'probe@test'])
  git(root, ['config', 'user.name', 'probe'])
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'parser.ts'), 'export const parse = () => null\n')
  writeFileSync(join(root, '.gitignore'), 'node_modules\n*.log\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'init'])
  return root
}

/**
 * ★ 探针：判据是纯数据变换，I/O 在这里。它读两个地方 ——
 *   ① worktree 里有没有声明的路径（文件系统）；
 *   ② 主检出的【提交里】有没有（`git ls-files`）。
 *
 * ★ 为什么主检出那一侧走 git 而不是文件系统：**实现会同时改主检出与 worktree**。
 *   在实现判据/机制的任务里，`src/scheduler.ts` 本来就在主树被改过（那是派发
 *   机制的落点），若把"文件在主树存在"当成"工作落到了主树"，那么【每一个真实
 *   被判据覆盖的任务都会被误拒】。判据问的是最窄的那件事：「这条被声明的工作，
 *   是不是作为主检出的内容存在」—— git 的索引正是这个问题的读数，而且它是
 *   worktree 感知的（`git ls-files` 在 worktree 里读的是那个 worktree 的索引，
 *   所以两边的读数互不污染）。
 */
function probe(repo, worktree, paths, { worktreeReadable = true, mainReadable = true } = {}) {
  const absentInWorktree = []
  const presentInMain = []
  for (const path of paths) {
    if (worktreeReadable && !existsSync(join(worktree, path))) absentInWorktree.push(path)
    if (mainReadable && gitTracks(repo, path)) presentInMain.push(path)
  }
  return { absentInWorktree, worktreeReadable, mainReadable, presentInMain }
}

function gitTracks(repo, path) {
  try {
    git(repo, ['ls-files', '--error-unmatch', path])
    return true
  } catch {
    return false
  }
}

/**
 * ★ 在 worktree 里落一件【主检出里没有的】新文件（即成员的产出）。
 *
 * 为什么不能直接改 `src/parser.ts`：那个文件是【基线提交的一部分】，
 * 主检出里当然"有"它。以"文件存不存在"提问会把每一次合法改动都判成泄漏。
 * 判据问的最窄形式是「这条被声明的路径，是不是主检出的内容」——
 * 所以对照臂声明的必须是 worktree 里新产出的路径。
 */
function writeInWorktree(worktree, path, text) {
  const full = join(worktree, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, text)
}

function arrivalCtx(repo, worktree, changedPaths, probeOptions) {
  return {
    task: { id: 't1', kind: 'implementation' },
    update: { changedPaths },
    workspace: repo,
    worktreePath: worktree,
    arrival: probe(repo, worktree, changedPaths, probeOptions),
  }
}

test('★ 对照臂：声明的路径都在 worktree 里、都不在主检出 ⇒ ok', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-ok' })
  track(created.path)
  assert.equal(created.ok, true)
  writeInWorktree(created.path, 'src/extra/index.ts', 'export const extra = 1\n')
  writeInWorktree(created.path, 'scripts/probe.mjs', 'export const probe = 1\n')

  const verdict = expectOk(gate(arrivalCtx(repo, created.path, ['src/extra/index.ts', 'scripts/probe.mjs'])))
  assert.equal(verdict.landed, true, '★ 通过必须带上 landed: true 的产出')
  assert.deepEqual(verdict.declaredPaths, ['src/extra/index.ts', 'scripts/probe.mjs'])
})

test('★ 对照臂：成员合法留下【未声明】的文件 ⇒ 不因此被拒（检查的是声明路径这一最窄形式）', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-untidy' })
  track(created.path)
  writeInWorktree(created.path, 'src/extra.ts', 'export const extra = 1\n')
  // 草稿、临时输出、跑测试生成的快照 —— 都是合法的
  writeFileSync(join(created.path, 'src', 'scratch.log'), 'noise\n')
  mkdirSync(join(created.path, '.tmp-cache'), { recursive: true })
  writeFileSync(join(created.path, '.tmp-cache', 'x'), 'cache\n')

  expectOk(gate(arrivalCtx(repo, created.path, ['src/extra.ts'])))
})

test('★ 伪造臂：声明的路径【在主检出里是内容】⇒ blocked，且指名是哪一个', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-fake' })
  track(created.path)
  // ★ 一条【主检出里没有】的声明（证明判据不误伤正常成员）
  writeInWorktree(created.path, 'src/extra.ts', 'export const extra = 1\n')
  // 成员在主树里干了另一件活，却把它声明成自己的改动；
  // ★ 同时它也在 worktree 里留下了同名文件 —— 于是"没到达"这一面不成立，
  //   这一臂【只】检验"落到了主检出"这一条读数。
  writeInWorktree(repo, 'src/leaked.ts', 'export const leaked = 1\n')
  writeInWorktree(created.path, 'src/leaked.ts', 'export const leaked = 1\n')
  git(repo, ['add', 'src/leaked.ts'])
  git(repo, ['commit', '-qm', 'work that should have happened in the worktree'])

  const blockers = expectBlocked(gate(arrivalCtx(repo, created.path, ['src/extra.ts', 'src/leaked.ts'])))
  assert.equal(blockers.length, 1, '★ 只报真的对不上的那条，不连坐')
  assert.match(blockers[0], /src\/leaked\.ts/, '★ 必须指名是哪个路径')
  assert.match(blockers[0], /main checkout/, '★ 必须说清是"落到了主检出"')
  assert.equal(/never arrived/.test(blockers[0]), false, '★ 它在 worktree 里存在，所以"没到达"这一条不该出现')
})

test('★ 伪造臂：没到达【并且】主检出里有 ⇒ 两条都报（一次给全，不短路）', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-both' })
  track(created.path)
  writeInWorktree(repo, 'src/leaked.ts', 'export const leaked = 1\n')
  git(repo, ['add', 'src/leaked.ts'])
  git(repo, ['commit', '-qm', 'work in the main tree, never in the worktree'])

  const blockers = expectBlocked(gate(arrivalCtx(repo, created.path, ['src/leaked.ts'])))
  assert.equal(blockers.length, 2, '★ 两个观察面各出一条，不是只报第一条')
  assert.ok(blockers.some(text => /never arrived/.test(text)), '★ 一条说"没到达"')
  assert.ok(blockers.some(text => /main checkout/.test(text)), '★ 一条说"落到了主树"')
})

test('★ 伪造臂：声明的路径【哪儿都没有】（没到达）⇒ blocked，且与"落到主树"不同形', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-absent' })
  track(created.path)

  const blockers = expectBlocked(gate(arrivalCtx(repo, created.path, ['src/never-written.ts'])))
  assert.equal(blockers.length, 1)
  assert.match(blockers[0], /never arrived|does not exist in the task worktree/)
  assert.equal(/main checkout/.test(blockers[0]), false, '★ "没到达"与"落到了主树"必须是两条不同的 blocker')
})

test('★ 未测量臂：读不到 worktree ⇒ unmeasured，【不是】 blocked', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-unreadable' })
  track(created.path)
  writeInWorktree(created.path, 'src/extra.ts', 'export const extra = 1\n')

  const verdict = gate(arrivalCtx(repo, created.path, ['src/extra.ts'], { worktreeReadable: false, mainReadable: false }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /could not be read/)
  assert.match(reason, /not measured/)
  assert.equal('blockers' in verdict, false, '★ "读不到"不得并进 blocked —— git 抖动不是违规')
})

test('★ 未测量臂：worktree 目录不存在（没建出来）⇒ unmeasured', () => {
  const repo = track(makeRepo())
  const missing = join(repo, '.agent-teams', 'worktrees', 'task-t-gone')
  const verdict = gate({
    task: { id: 't-gone', kind: 'implementation' },
    update: { changedPaths: ['src/a.ts'] },
    workspace: repo,
    worktreePath: missing,
    arrival: probe(repo, missing, ['src/a.ts'], { worktreeReadable: false }),
  })
  expectUnmeasured(verdict)
})

test('★ 未测量臂：worktree 读得到，但【主检出读不到】⇒ 不得声称"没落到主树"', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-main-blind' })
  track(created.path)
  writeInWorktree(created.path, 'src/extra.ts', 'export const extra = 1\n')

  const verdict = gate(arrivalCtx(repo, created.path, ['src/extra.ts'], { mainReadable: false }))
  const reason = expectUnmeasured(verdict)
  assert.match(reason, /cannot be certified/, '★ 没有主检出的读数就不能认证"没落到主树"')
  assert.equal(verdict.ok, false)
  assert.equal('blockers' in verdict, false)
})

test('★ 未测量臂：调用方没注入探针 ⇒ unmeasured（判据自己不读文件系统）', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-noprobe' })
  track(created.path)
  const verdict = gate({
    task: { id: 't1', kind: 'implementation' },
    update: { changedPaths: ['src/a.ts'] },
    worktreePath: created.path,
    workspace: repo,
  })
  assert.match(expectUnmeasured(verdict), /no arrival probe was injected/)
})

test('★ 不适用：没有声明 worktree 的路径 ⇒ ok 且 landed: null（"不适用"不是"未测量"）', () => {
  const repo = track(makeRepo())
  const verdict = expectOk(gate({
    task: { id: 't1', kind: 'implementation' },
    update: { changedPaths: ['src/a.ts'] },
    workspace: repo,
  }))
  assert.equal(verdict.landed, null)
  assert.match(String(verdict.skipped), /no worktree was declared/)
})

test('★ appliesTo：只对声明了 changedPaths 的 implementation/repair 生效', () => {
  assert.equal(appliesTo({ task: { kind: 'implementation' }, update: { changedPaths: ['src/a.ts'] } }), true)
  assert.equal(appliesTo({ task: { kind: 'repair' }, update: { changedPaths: ['src/a.ts'] } }), true)
  assert.equal(appliesTo({ task: { kind: 'review' }, update: { changedPaths: ['src/a.ts'] } }), false)
  assert.equal(appliesTo({ task: { kind: 'implementation' }, update: { changedPaths: [] } }), false)
  assert.equal(appliesTo(undefined), false)
})

test('★ 判据身份与装配约定一致（id/point 是装配点的键）', () => {
  assert.equal(id, 'dispatch.worktree')
  assert.equal(point, 'dispatch')
})

// ── 接线臂：机制必须【真的】生效 ─────────────────────────────────────────────

/** 一个最小 ctx，够 installTeamScheduler 跑 kickMember。 */
function schedulerFixture(workspace) {
  const warnings = []
  const deliveries = []
  const child = {
    id: 'worker-session', status: 'idle',
    steer(message) { deliveries.push(message.content) },
    session: { header: { cwd: workspace }, events: [] },
  }
  const captain = { id: 'captain', status: 'idle', session: { append() {} }, steer() {} }
  const ctx = {
    logger: { debug() {}, warn(message) { warnings.push(message) } },
    agents: { get(id) { return id === child.id ? child : id === captain.id ? captain : undefined } },
    on() { return () => {} },
    effect(setup) { return setup() },
  }
  /**
   * ★ 用注入的 dispatch 捕获派发：`deliverToMember` 需要真实的 `ctx.subagents`，
   *   而本夹具关心的是【有没有派发出去】，不是 Harness 的投递细节。
   *   注入点正是插件自己用的那一个（`tools.ts` 也是这么注入的）。
   */
  const dispatch = async (_captain, _teamId, _memberName, text) => { deliveries.push(text); return true }
  return { ctx, child, captain, warnings, deliveries, dispatch }
}

async function seedTeam(workspace, kind) {
  const stateRoot = join(workspace, '.agent-teams')
  await withTeamLock(`probe:${stateRoot}`, async () => {})
  const { createTeamDir } = await import('../lib/state.js')
  await createTeamDir(stateRoot, {
    id: 'team', name: 'Team', captainSessionId: 'captain', createdAt: 1, taskSeq: 1,
    members: [{ id: 'worker-session', name: 'worker', status: 'idle', joinedAt: 1 }],
    tasks: [{
      id: kind === 'implementation' ? 't-impl' : 't-work', subject: 'work', assignee: 'worker',
      status: 'pending', dependencies: [], kind, createdAt: 1, updatedAt: 1,
    }],
  })
  return stateRoot
}

test('★ 接线臂（闸门）：是 git 仓库却建不出 worktree ⇒ kickMember【不派发】，任务回到待派发', async () => {
  /**
   * ★ 判别的关键在于【是 git 仓库但没有提交】—— 这是"本该能隔离却建不出来"，
   *   属于真异常 ⇒ 拒绝派发（重试是合理的：下一次有提交就好了）。
   *
   * ★ 此臂此前用的是"连 git 仓库都不是"的目录。那个输入在一轮之后被证明是
   *   **错的闸门**：非 git 仓库不是异常而是环境，拒绝它会让任务永远回 pending，
   *   而 idle 边再踢再拒绝 ⇒ 无限循环、任务永久卡死（实测，见下一条臂）。
   *   现在非 git 仓库走降级派发，由下面那条臂与
   *   `scripts/gate-worktree-fallback.test.mjs` 一起测。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wt-refuse-')))
  git(workspace, ['init', '-q', '.'])   // 是仓库，但一个提交都没有
  const stateRoot = await seedTeam(workspace, 'implementation')
  const { ctx, deliveries, warnings, dispatch } = schedulerFixture(workspace)
  const scheduler = installTeamScheduler(ctx, { stateDir: '.agent-teams', dispatch })

  await scheduler.kickMember(workspace, 'team', 'worker')

  assert.deepEqual(deliveries, [], '★ 本该能隔离却建不出来 ⇒ 一条派发都不许发出去（此处此前是 warn 后照常派发）')
  const team = await readTeam(stateRoot, 'team')
  const task = team.tasks.find(candidate => candidate.id === 't-impl')
  assert.equal(task.status, 'pending', '★ 任务必须回到待派发，而不是留在 claimed 上卡住')
  assert.equal(task.attemptId, undefined)
  assert.equal(team.members[0].status, 'idle', '★ 成员不得被标成 working（它什么都没收到）')
  assert.ok(warnings.some(message => /refusing to dispatch/.test(message)), '★ 拒绝必须留下一条记录，不能静默')
})

test('★ 接线臂（降级路）：非 git 仓库 ⇒ 【照常派发】但明说没有隔离（绝不永久卡死）', async () => {
  /**
   * ★ 本队最贵的一条实测教训：把"环境不支持隔离"也当成拒绝派发 ⇒ 任务回 pending、
   *   成员回 idle ⇒ idle 边再踢 ⇒ 再拒绝 ⇒ **无限循环**。非 git 项目里每一个
   *   implementation/repair 任务都会永久卡死，而只有一条 warn 说原因。
   *
   * ⇒ 现在的行为：降级派发 + 在提示里明说没有隔离（一次 warn 不是一条记录）。
   */
  const workspace = track(mkdtempSync(join(tmpdir(), 'wt-nonrepo-')))
  const stateRoot = await seedTeam(workspace, 'implementation')
  const { ctx, deliveries, warnings, dispatch } = schedulerFixture(workspace)
  const scheduler = installTeamScheduler(ctx, { stateDir: '.agent-teams', dispatch })

  await scheduler.kickMember(workspace, 'team', 'worker')

  assert.equal(deliveries.length, 1, '★ 非 git 仓库必须【派发出去】—— 拒绝它会让任务永久卡死')
  assert.match(deliveries[0], /No isolated worktree:/, '★ 必须明说没有隔离')
  assert.match(deliveries[0], /not a git repository/, '★ 必须带上原因')
  assert.equal(/Working directory:/.test(deliveries[0]), false, '★ 绝不伪造一个工作目录')
  const team = await readTeam(stateRoot, 'team')
  assert.equal(team.tasks[0].status, 'claimed', '★ 任务必须真的被领走，而不是留在 pending 上被反复踢')
  assert.ok(
    warnings.some(message => /has no isolated worktree/.test(message)),
    '★ 降级也要留下记录（措辞与"拒绝派发"必须不同形）',
  )
})

test('★ 接线臂（闸门对照臂）：仓库可用 ⇒ 照常派发，提示里带工作目录', async () => {
  const workspace = track(makeRepo())
  const stateRoot = await seedTeam(workspace, 'implementation')
  const { ctx, deliveries, dispatch } = schedulerFixture(workspace)
  const scheduler = installTeamScheduler(ctx, { stateDir: '.agent-teams', dispatch })

  await scheduler.kickMember(workspace, 'team', 'worker')

  assert.equal(deliveries.length, 1, '★ 能隔离就必须派发出去')
  assert.match(deliveries[0], /Working directory: .*task-t-impl/, '★ 成员必须看到自己的隔离目录')
  const team = await readTeam(stateRoot, 'team')
  assert.equal(team.tasks[0].status, 'claimed')
})

test('★ 接线臂（只读任务）：review 类不需要 worktree ⇒ 照常派发（闸门不得误伤）', async () => {
  const workspace = track(mkdtempSync(join(tmpdir(), 'wt-readonly-')))  // 连 git 仓库都不是
  await seedTeam(workspace, 'review')
  const { ctx, deliveries, dispatch } = schedulerFixture(workspace)
  const scheduler = installTeamScheduler(ctx, { stateDir: '.agent-teams', dispatch })

  await scheduler.kickMember(workspace, 'team', 'worker')

  assert.equal(deliveries.length, 1, '★ 只读任务本来就不需要检出，不能被闸门拦住')
  assert.equal(/Working directory:/.test(deliveries[0]), false, '★ 也不能伪造一个不存在的工作目录')
})

test('★ 接线臂（依赖注入）：是【复制品】，不是软链 —— 写穿必须被挡住', async () => {
  const repo = track(makeRepo())
  mkdirSync(join(repo, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(repo, 'node_modules', 'dep', 'index.js'), 'export const v = 1\n')

  const created = createTaskWorktree({ repo, taskId: 't-deps' })
  track(created.path)
  assert.deepEqual(created.missingIgnored, ['node_modules'], '★ 缺依赖必须被报出来')
  assert.equal(existsSync(join(created.path, 'node_modules')), false, '★ 已知边界：干净检出里没有依赖')

  const provisioned = provisionWorktreeDependencies({ repo, worktree: created.path, entries: created.missingIgnored })
  assert.deepEqual(provisioned.failed, [], '★ 不该有失败项')
  assert.deepEqual(provisioned.copied, ['node_modules'])
  assert.equal(lstatSync(join(created.path, 'node_modules')).isSymbolicLink(), false, '★ 必须是复制品，不能是软链（软链会被写穿）')

  // ★ 写穿测试：在 worktree 里改依赖，主检出必须【没变】。
  writeFileSync(join(created.path, 'node_modules', 'dep', 'index.js'), 'export const v = 999\n')
  const upstream = execFileSync('cat', [join(repo, 'node_modules', 'dep', 'index.js')], { encoding: 'utf8' })
  assert.match(upstream, /v = 1/, '★ worktree 里的安装/改写绝不允许穿到主检出的依赖树')

  // ★ 另一个方向：改主检出也不该影响 worktree（两个成员各自验证必须互不干扰）
  writeFileSync(join(repo, 'node_modules', 'dep', 'index.js'), 'export const v = 2\n')
  const inside = execFileSync('cat', [join(created.path, 'node_modules', 'dep', 'index.js')], { encoding: 'utf8' })
  assert.match(inside, /v = 999/)
})

test('★ 接线臂（依赖注入）：拒绝把路径穿到根外（entries 不能是 ../x 或 /abs）', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-dep-guard' })
  track(created.path)
  const result = provisionWorktreeDependencies({
    repo, worktree: created.path,
    entries: ['../outside', '/etc', 'a/b', '.', ''],
  })
  assert.equal(result.copied.length, 0)
  assert.equal(result.failed.length, 5, '★ 每一条非法 entries 都必须被报出来，不能静默跳过')
  assert.ok(result.failed.every(item => /refused|not present/.test(item.reason)))
})

test('★ 接线臂：依赖注入失败必须【报出来】，不能静默通过', () => {
  const repo = track(makeRepo())
  const created = createTaskWorktree({ repo, taskId: 't-dep-missing' })
  track(created.path)
  const result = provisionWorktreeDependencies({ repo, worktree: created.path, entries: ['node_modules'] })
  assert.deepEqual(result.copied, [])
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0].reason, /not present/)
})
