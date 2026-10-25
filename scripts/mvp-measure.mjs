#!/usr/bin/env node
/**
 * ── MVP 计划的读数装置（只读，不判裁）────────────────────────────────────────────
 *
 * 用途：`docs/MVP-FUSION-PLAN.md` 里引用的**每一组基线数字**都由本文件重新算出来。
 * 计划里任何一处读数，都能用 `node scripts/mvp-measure.mjs` 复现；改完产品之后再跑一次，
 * 就是"改前 / 改后"的对比 —— 这正是用户裁定（m0069）要求的第一条「证明收益」。
 *
 * ── 三条纪律（与 `scripts/verify-fast.mjs` 同源，理由逐字相同）──────────────────────
 *
 * ① **它不裁决。** 输出里没有 `ok` / `verdict` / `pass` / `fail` ——
 *    只有读数。理由：一个"绿了"的读数会被当成判决，而读数本身没有裁决权。
 *    ★ 且 `src/**` 里任何地方都**不许读**它的产物（本文件写到 stdout，不落盘）。
 *
 * ② **三态不许并。** 每一处"拿不到"都与"拿到了且为空"分家：
 *    `null`（没能测）≠ `0`（测了，是零）≠ `[]`（测了，没有条目）。
 *    合并它们的后果在本仓有过账：`161 条空白 update_task rejected:` 就是那样留下的。
 *
 * ③ **不读模型的自我陈述。** 只读磁盘（`team.json` / `frictions/*.json`）与 git。
 *
 * ── 它**不**做什么 ────────────────────────────────────────────────────────────────
 *
 * · 不写任何文件（除了 `--json` 时的 stdout）；
 * · 不跑测试、不 build、不改 git 状态（只 `rev-parse` / `for-each-ref` / `merge-base` 读）；
 * · 不在 CI 里被引用 —— 它是**人**用来对比改前改后的。
 *
 * 用法：
 *   node scripts/mvp-measure.mjs            # 人读的表格
 *   node scripts/mvp-measure.mjs --json     # 机器读（适合 diff）
 *   node scripts/mvp-measure.mjs --help
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const HELP = `mvp-measure —— MVP 计划的读数装置（只读）

  node scripts/mvp-measure.mjs           人读表格
  node scripts/mvp-measure.mjs --json    JSON（适合改前/改后 diff）
  node scripts/mvp-measure.mjs --help    本说明

★ 它不裁决：输出里没有 ok / verdict / pass / fail。
★ 三态不并：null（没能测）≠ 0（测了是零）≠ []（测了没有条目）。
`

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}
const asJson = args.has('--json')

// ── 工具 ──────────────────────────────────────────────────────────────────────────

/**
 * 跑一条 git 命令。★ 三态：`{ok:true,out}` / `{ok:false,why}` —— 调用方必须分别处理，
 * 不许用 `?? ''` 把失败折成空串（那会让"仓库没找到"与"这个 ref 是空的"同形）。
 */
function git(argv) {
  try {
    return {
      ok: true,
      out: execFileSync('git', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
    }
  } catch (error) {
    return { ok: false, why: String(error?.stderr ?? error?.message ?? error).trim() }
  }
}

/** 递归找 team.json。跳过 worktrees / node_modules / .git（depth ≤ 3，与勘查时同一口径）。 */
function findTeamJsons(rootDir = '.agent-teams', maxDepth = 3) {
  const skip = new Set(['node_modules', 'worktrees', '.git'])
  const found = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, depth + 1)
      else if (entry.name === 'team.json') found.push(path)
    }
  }
  walk(rootDir, 0)
  return found
}

/** 读全部团队。读不出的**计数并留名** —— 静默跳过 12 个文件正是 GATE-EFFICACY 记过的坑。 */
function loadTeams() {
  const files = findTeamJsons()
  const teams = []
  const unreadable = []
  for (const file of files) {
    try {
      teams.push({ file, ...JSON.parse(readFileSync(file, 'utf8')) })
    } catch (error) {
      unreadable.push({ file, why: String(error?.message ?? error) })
    }
  }
  return { files: files.length, teams, unreadable }
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== ''
const isNonEmptyArray = (v) => Array.isArray(v) && v.length > 0
const hasValue = (v) => v !== undefined && v !== null

// ── 读数 1：语料规模与字段使用率 ────────────────────────────────────────────────────

function corpus(t) {
  const tasks = t.teams.flatMap((team) => (team.tasks ?? []).map((task) => ({ team: team.id ?? team.name, ...task })))
  const status = {}
  for (const task of tasks) status[task.status ?? '(none)'] = (status[task.status ?? '(none)'] ?? 0) + 1
  const field = (name) => tasks.filter((task) => hasValue(task[name])).length
  return {
    teamJsons: t.files,
    teams: t.teams.length,
    unreadableTeams: t.unreadable.length,
    unreadableDetail: t.unreadable,
    tasks: tasks.length,
    status,
    fieldUsage: {
      coverageOf: field('coverageOf'),
      parentTaskId: field('parentTaskId'),
      handoffCommit: field('handoffCommit'),
      deliverableCommit: field('deliverableCommit'),
      delivery: field('delivery'),
      inScope: field('inScope'),
      acceptance: field('acceptance'),
      verify: field('verify'),
      objective: field('objective'),
      deliverables: tasks.filter((task) => isNonEmptyArray(task.deliverables)).length,
    },
    teamsWithDescription: t.teams.filter((team) => isNonEmptyString(team.description)).length,
  }
}

// ── 读数 2：后序交接 —— 产物提交的四种归宿 ──────────────────────────────────────────

function handoff(t) {
  const liveWorktreeHeads = new Set(
    (git(['worktree', 'list', '--porcelain']).out ?? '')
      .split('\n')
      .filter((line) => line.startsWith('HEAD '))
      .map((line) => line.slice(5).trim()),
  )

  /** sha → 引用它的 `team/task` 列表 */
  const bySha = new Map()
  let records = 0
  let noConsumer = 0
  for (const team of t.teams) {
    const teamTasks = team.tasks ?? []
    for (const task of teamTasks) {
      if (!isNonEmptyString(task.deliverableCommit)) continue
      records += 1
      if (!teamTasks.some((other) => (other.dependencies ?? []).includes(task.id))) noConsumer += 1
      const resolved = git(['rev-parse', '--verify', `${task.deliverableCommit}^{commit}`])
      const sha = resolved.ok ? resolved.out : task.deliverableCommit
      if (!bySha.has(sha)) bySha.set(sha, [])
      bySha.get(sha).push(`${team.id ?? team.name}/${task.id}`)
    }
  }

  const bucket = {
    inHead: [],
    inOtherBranchRef: [],
    inOtherRef: [],
    onlyLiveWorktree: [],
    fullyOrphan: [],
  }
  for (const sha of bySha.keys()) {
    if (git(['merge-base', '--is-ancestor', sha, 'HEAD']).ok) {
      bucket.inHead.push(sha)
      continue
    }
    const refs = git(['for-each-ref', '--contains', sha, '--format=%(refname)'])
    const list = refs.ok && refs.out !== '' ? refs.out.split('\n') : []
    if (list.some((ref) => ref.startsWith('refs/heads/') || ref.startsWith('refs/remotes/'))) {
      bucket.inOtherBranchRef.push(sha)
      continue
    }
    if (list.length > 0) {
      bucket.inOtherRef.push(sha)
      continue
    }
    if (liveWorktreeHeads.has(sha)) {
      bucket.onlyLiveWorktree.push(sha)
      continue
    }
    bucket.fullyOrphan.push(sha)
  }

  /**
   * ── 孤儿提交的**内容**是否也已经不在 HEAD 里 ────────────────────────────────
   *
   * ★ 这是最容易说错的一格：`fullyOrphan` 是【对象身份】不可达，而**内容**可能早已落盘
   *   （本仓的合流是"按文件落盘"，不是 merge ⇒ 同一份内容会得到两个不同的 commit）。
   *   ⇒ 必须分成三档报，不许把 80 当成 80 份丢失的工作。
   */
  const orphanContent = { identicalToHead: [], differFromHead: [], touchesFilesAbsentFromHead: [] }
  for (const sha of bucket.fullyOrphan) {
    const changed = git(['show', '--name-only', '--format=', sha])
    const files = changed.ok && changed.out !== '' ? changed.out.split('\n').filter((f) => f !== '') : []
    if (files.length === 0) continue
    const absent = files.filter((file) => !git(['cat-file', '-e', `HEAD:${file}`]).ok)
    if (absent.length > 0) {
      orphanContent.touchesFilesAbsentFromHead.push({ sha, files: absent })
      continue
    }
    // `git diff --quiet` 靠退出码，不靠输出
    const same = files.every((file) => git(['diff', '--quiet', sha, 'HEAD', '--', file]).ok)
    if (same) orphanContent.identicalToHead.push(sha)
    else orphanContent.differFromHead.push(sha)
  }

  /**
   * ★ 最后这一格是**唯一要紧的那一格**：内容也不在任何 ref 里。
   *   `cat-file -e` 只证明对象在库里，不证明它被任何东西指着 —— 所以还要问
   *   "这个路径在任何 ref 里出现过吗"。
   */
  const atRiskPaths = []
  for (const { sha, files } of orphanContent.touchesFilesAbsentFromHead) {
    for (const file of files) {
      const anywhere = git(['log', '--all', '--oneline', '--', file])
      atRiskPaths.push({ sha, file, inAnyRef: anywhere.ok && anywhere.out !== '' })
    }
  }

  const refCount = git(['for-each-ref', 'refs/agent-teams', '--format=%(refname)'])
  const unreachable = git(['fsck', '--unreachable'])
  const looseFiles = (() => {
    // gc 安全窗：最老的那个 loose 对象有多老
    const count = git(['count-objects', '-v'])
    return count.ok ? count.out : null
  })()

  return {
    taskRecords: records,
    distinctCommits: bySha.size,
    noDownstreamConsumer: noConsumer,
    // ★ 三态：null 表示"没有一条能判"，不是 0
    unresolvedCommits: bySha.size === 0 ? null : undefined,
    reachability: {
      inHead: bucket.inHead.length,
      inOtherBranchRef: bucket.inOtherBranchRef.length,
      inOtherRef: bucket.inOtherRef.length,
      onlyLiveWorktree: bucket.onlyLiveWorktree.length,
      fullyOrphan: bucket.fullyOrphan.length,
    },
    orphanContent: {
      identicalToHead: orphanContent.identicalToHead.length,
      differFromHead: orphanContent.differFromHead.length,
      touchesFilesAbsentFromHead: orphanContent.touchesFilesAbsentFromHead.length,
    },
    /** ★ 内容也只存在于孤儿提交里的路径 —— 这是真实的丢失风险，不是"80" */
    atRiskPaths,
    agentTeamsRefs: refCount.ok && refCount.out !== '' ? refCount.out.split('\n').length : 0,
    unreachableObjects: unreachable.ok
      ? unreachable.out.split('\n').filter((line) => line.startsWith('unreachable commit')).length
      : null,
    countObjects: looseFiles,
  }
}

// ── 读数 3：「不实现」只是 prompt 一句话吗 ────────────────────────────────────────────

function verifierWrites(t) {
  const kinds = new Set(['review', 'verification', 'integration'])
  const writable = new Set(['work', 'implementation', 'repair'])
  const rows = []
  let considered = 0
  /**
   * ★ 第二个口径：同一个成员既审又写。它是第 5 步真正要防的东西 ——
   *   `12 条写了非 lib/` 里 7 条是审查报告、4 条是 integration，那都不是"越界"。
   */
  const byMember = new Map()
  for (const team of t.teams) {
    for (const task of team.tasks ?? []) {
      if (!kinds.has(task.kind)) continue
      considered += 1
      const written = (task.changedPaths ?? []).filter((path) => !path.startsWith('lib/'))
      if (written.length > 0) rows.push({ team: team.id ?? team.name, task: task.id, kind: task.kind, written })
    }
    for (const task of team.tasks ?? []) {
      if (task.assignee === undefined) continue
      const key = `${team.id ?? team.name}/${task.assignee}`
      const entry = byMember.get(key) ?? { team: team.id ?? team.name, member: task.assignee, verifier: 0, writer: 0 }
      if (kinds.has(task.kind)) entry.verifier += 1
      else if (writable.has(task.kind) || task.kind === undefined) entry.writer += 1
      byMember.set(key, entry)
    }
  }
  const members = [...byMember.values()]
  const mixed = members.filter((m) => m.verifier > 0 && m.writer > 0)
  return {
    considered,
    wroteOutsideLib: rows.length,
    rows,
    /**
     * ★ 分母与三态：`membersWithTasks` 是"真派过活的成员"，`mixed` 是其中既审又写的。
     *   `verifierSourceWriters` 只数 review/verification 改了 src|scripts|package.json 的 ——
     *   那才是"审查者动了产品代码"的直接读数（integration 不算，它本来就该写）。
     */
    membersWithTasks: members.length,
    mixedMembers: mixed.length,
    mixedRows: mixed.map((m) => `${m.team}/${m.member} (v${m.verifier}/w${m.writer})`),
    verifierSourceWriters: rows.filter((row) => row.kind !== 'integration'
      && row.written.some((path) => /^(src\/|scripts\/|package\.json|tsconfig)/.test(path))).length,
  }
}

// ── 读数 4：早收（completed 的上游有 failed/cancelled 的下游） ──────────────────────

function prematureClosure(t) {
  let completed = 0
  let withBadDownstream = 0
  const rows = []
  for (const team of t.teams) {
    const tasks = team.tasks ?? []
    for (const task of tasks) {
      if (task.status !== 'completed') continue
      completed += 1
      const bad = tasks.filter((other) => (other.dependencies ?? []).includes(task.id)
        && (other.status === 'failed' || other.status === 'cancelled'))
      if (bad.length === 0) continue
      withBadDownstream += 1
      rows.push({
        team: team.id ?? team.name,
        task: task.id,
        kind: task.kind ?? null,
        badDownstream: bad.map((other) => `${other.id}:${other.kind ?? 'work'}`),
      })
    }
  }
  return { completed, withBadDownstream, rows }
}

// ── 读数 5：可派发但没人接的 pending ────────────────────────────────────────────────

function readyPending(t) {
  const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
  const ready = []
  for (const team of t.teams) {
    const tasks = team.tasks ?? []
    const byId = new Map(tasks.map((task) => [task.id, task]))
    for (const task of tasks) {
      if (task.status !== 'pending') continue
      const unmet = (task.dependencies ?? []).filter((id) => {
        const dep = byId.get(id)
        return dep === undefined || !TERMINAL.has(dep.status)
      })
      if (unmet.length === 0) ready.push({ team: team.id ?? team.name, task: task.id, assignee: task.assignee ?? null })
    }
  }
  return {
    ready: ready.length,
    unassigned: ready.filter((row) => row.assignee === null).length,
    rows: ready,
    /** ★ 样本量必须一起报：n 太小的时候，任何"更多任务被派出去"的主张都不成立 */
    caveat: ready.length < 10 ? `n=${ready.length} —— 样本太小，不足以支撑"rank 选人有大用"的收益主张` : undefined,
  }
}

// ── 读数 6：admission 三条判据在生产路径上的求值点 ──────────────────────────────────

function admissionWiring() {
  // 只读源码文本，不 import（本文件不是夹具，不该拉进产品的依赖图）
  const files = ['src/tools.ts', 'src/tools/create.ts', 'src/tools/approve.ts', 'src/tools/delivery.ts',
    'src/tools/status.ts', 'src/tools/create-task.ts', 'src/tools/shared/entities.ts',
    'src/tools/update-task/dispatch.ts', 'src/tools/update-task/completion.ts']
  const evaluators = []
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue
      const match = trimmed.match(/registry\.evaluate\('(admission|contract|dispatch|completion|delivery|runtime|collection)'/)
      if (match) evaluators.push({ file, point: match[1] })
    }
  }
  const byPoint = {}
  for (const row of evaluators) byPoint[row.point] = (byPoint[row.point] ?? 0) + 1
  return {
    evaluateCallSites: evaluators.length,
    byPoint,
    admissionCallSites: byPoint.admission ?? 0,
    /** ★ 三态：位置没有求值点不是"0 次求值"，是"这个位置在生产里根本没人问" */
    note: byPoint.admission === undefined ? 'admission 在生产路径上没有求值点（≠ 求值了 0 次）' : undefined,
  }
}

// ── 读数 7：卡点台账 ──────────────────────────────────────────────────────────────

function frictions() {
  const dir = '.agent-teams/frictions'
  let names
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return { files: null, unreadable: null, note: '读不到 .agent-teams/frictions' }
  }
  const component = {}
  const kind = {}
  let unreadable = 0
  let planReviewedBooked = 0
  for (const name of names) {
    let record
    try {
      record = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch {
      unreadable += 1
      continue
    }
    const c = record.index?.component ?? '(none)'
    component[c] = (component[c] ?? 0) + 1
    for (const k of record.index?.kind ?? []) kind[k] = (kind[k] ?? 0) + 1
    if (JSON.stringify(record).includes('plan-reviewed')) planReviewedBooked += 1
  }
  return {
    files: names.length,
    unreadable,
    byComponent: component,
    byKind: kind,
    /** ★ `plan-reviewed` 在生产里真的开火过 —— 它拒绝过 create_task，不是理论上的判据 */
    recordsMentioningPlanReviewed: planReviewedBooked,
  }
}

// ── 跑 ────────────────────────────────────────────────────────────────────────────

const loaded = loadTeams()
const readings = {
  at: new Date().toISOString(),
  head: git(['rev-parse', 'HEAD']).out ?? null,
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).out ?? null,
  corpus: corpus(loaded),
  handoff: handoff(loaded),
  verifierWrites: verifierWrites(loaded),
  prematureClosure: prematureClosure(loaded),
  readyPending: readyPending(loaded),
  admissionWiring: admissionWiring(),
  frictions: frictions(),
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(readings, null, 2)}\n`)
  process.exit(0)
}

const line = (label, value) => process.stdout.write(`  ${label.padEnd(46)} ${value}\n`)
const section = (title) => process.stdout.write(`\n${title}\n${'─'.repeat(78)}\n`)

process.stdout.write(`mvp-measure —— ${readings.branch} @ ${(readings.head ?? '(unknown)').slice(0, 12)}\n`)
process.stdout.write(`at ${readings.at}\n`)
process.stdout.write('★ 只报数，不裁判。三态不并：null ≠ 0 ≠ []\n')

section('1 · 语料')
line('team.json 个数', readings.corpus.teamJsons)
line('可读团队 / 不可读', `${readings.corpus.teams} / ${readings.corpus.unreadableTeams}`)
line('任务数', readings.corpus.tasks)
line('有 description 的团队', `${readings.corpus.teamsWithDescription} / ${readings.corpus.teams}`)
line('coverageOf 使用', readings.corpus.fieldUsage.coverageOf)
line('parentTaskId 使用', readings.corpus.fieldUsage.parentTaskId)
line('deliverableCommit 使用', readings.corpus.fieldUsage.deliverableCommit)
line('objective 使用', readings.corpus.fieldUsage.objective)

section('2 · 后序交接（产物提交的四种归宿）')
line('deliverableCommit 记录', readings.handoff.taskRecords)
line('distinct commit', readings.handoff.distinctCommits)
line('无下游消费者', readings.handoff.noDownstreamConsumer)
line('  inHead', readings.handoff.reachability.inHead)
line('  inOtherBranchRef', readings.handoff.reachability.inOtherBranchRef)
line('  inOtherRef', readings.handoff.reachability.inOtherRef)
line('  onlyLiveWorktree', readings.handoff.reachability.onlyLiveWorktree)
line('  fullyOrphan', readings.handoff.reachability.fullyOrphan)
line('  孤儿里：内容与 HEAD 相同', readings.handoff.orphanContent.identicalToHead)
line('  孤儿里：内容与 HEAD 不同', readings.handoff.orphanContent.differFromHead)
line('  孤儿里：动了 HEAD 没有的文件', readings.handoff.orphanContent.touchesFilesAbsentFromHead)
line('refs/agent-teams 条数', readings.handoff.agentTeamsRefs)
line('unreachable commits', readings.handoff.unreachableObjects)
for (const risk of readings.handoff.atRiskPaths) {
  line(`  ⚠ ${risk.inAnyRef ? '已在某个 ref 里' : '只在孤儿提交里'}`, `${risk.file} (${risk.sha.slice(0, 8)})`)
}

section('3 · 「不实现」只是 prompt 一句话吗')
line('verifier 类任务（review/verification/integration）', readings.verifierWrites.considered)
line('其中写了非 lib/ 文件', readings.verifierWrites.wroteOutsideLib)
line('★ 但那里面 review 写了源码的', readings.verifierWrites.verifierSourceWriters, '（integration 不算：它本来就该写）')
line('有任务的成员', readings.verifierWrites.membersWithTasks)
line('★ 既审又写的成员', readings.verifierWrites.mixedMembers, '← 这才是第 5 步真正要防的')
for (const row of readings.verifierWrites.mixedRows.slice(0, 5)) line('    ', row)

section('4 · 早收')
line('completed', readings.prematureClosure.completed)
line('下游有 failed/cancelled', readings.prematureClosure.withBadDownstream)

section('5 · 可派发电没人接')
line('ready 的 pending', readings.readyPending.ready)
line('其中 assignee 为空', readings.readyPending.unassigned)
if (readings.readyPending.caveat) line('★ 注意', readings.readyPending.caveat)

section('6 · admission 判据的接线')
line('registry.evaluate 调用点', readings.admissionWiring.evaluateCallSites)
line("其中 admission", readings.admissionWiring.admissionCallSites)
for (const [point, count] of Object.entries(readings.admissionWiring.byPoint)) line(`  ${point}`, count)
if (readings.admissionWiring.note) line('★ 注意', readings.admissionWiring.note)

section('7 · 卡点台账')
if (readings.frictions.files === null) {
  line('状态', readings.frictions.note)
} else {
  line('文件 / 读不出', `${readings.frictions.files} / ${readings.frictions.unreadable}`)
  for (const [key, count] of Object.entries(readings.frictions.byComponent)) line(`  component=${key}`, count)
  for (const [key, count] of Object.entries(readings.frictions.byKind)) line(`  kind=${key}`, count)
  line('提到 plan-reviewed 的记录', readings.frictions.recordsMentioningPlanReviewed)
}

process.stdout.write('\n★ 本文件不裁决：上面没有 ok / verdict / pass / fail。\n')
process.stdout.write('★ 改前跑一次、改后跑一次，`--json` 的 diff 就是收益证明。\n')
