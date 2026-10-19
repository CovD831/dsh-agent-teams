/**
 * Named team-profile templates: config types, normalization, invocation
 * parsing, and prompt rendering.
 *
 * Pure functions only — no I/O, no spawn. Runtime create/spawn stays in
 * `tools.ts`; this module only turns a config map + a profile name into a
 * validated, topologically ordered template (or parses `--profile` flags).
 *
 * @module dsh-agent-teams/profiles
 */

import { CAPTAIN_KEY, sanitizeKey } from './state.ts'
import { TASK_KINDS, type TeamState } from './types.ts'
import { validateCreateTask } from './quality-gates.ts'

/** Hard cap on named profiles so the usage prompt cannot grow without bound. */
export const MAX_TEAM_PROFILES = 16
/** Hard cap on seed tasks per profile. The software-delivery example has 13. */
export const MAX_PROFILE_TASKS = 32
/** Protocol excerpt length in the usage / prompt listing. */
export const PROFILE_PROTOCOL_PROMPT_LIMIT = 240

const PROFILE_KEYS = ['description', 'protocol', 'executionPrompt', 'fallback', 'model', 'reasoning_effort', 'members', 'tasks', 'taskPlanning', 'reviewPolicy'] as const
const REVIEW_POLICY_KEYS = ['requirementsMinRounds', 'requirementsMaxRounds', 'codeMaxRounds', 'maxRepairAttempts', 'requiredReviewers'] as const
const MEMBER_KEYS = ['name', 'role', 'provider', 'model', 'reasoning_effort', 'executionPrompt', 'fallback'] as const
const FALLBACK_KEYS = ['provider', 'model'] as const
/**
 * ── ★★★ t-new：`kind` 及其契约字段（这一格修的是**两条路不同形**）──────────────────
 *
 * 缺陷形态：队长协议 rule 3 逐字写着
 *   `Every task needs a subject; pass kind and assignee explicitly when the plan specifies them.`
 * 而 `create({plan:{tasks}})` 的 schema 只声明了 5 个键、且 `additionalProperties: false`
 * ⇒ 宿主校验器（`@deepseek-ai/dsh-tools` lib/index.js:467）会把 `kind` 判成
 *   `"tasks[0].kind" is not a declared property (additionalProperties: false)`
 * ⇒ **协议说"可以传"，工具说"没这个键"**。两个口径，一个动作。
 *
 * ★ 而这不是"少一个可选字段"：`kind` 决定一条任务走不走质量门（`isQualityKind`），
 *   而质量门要求 `objective`/`acceptance`/`inScope`/`verify`。所以要么**整组**支持，
 *   要么整组不支持 —— 只放 `kind` 进去会造出"质量 kind 缺契约"的任务，
 *   那正好是 `validateCreateTask` 会拒的形状（`${kind} tasks require ...`）。
 *
 * ⇒ 因此这里一次性放行**契约字段全集**，且 `makeTask` 本来就装得下它们
 *   （`entities.ts:1524` 逐键展开 `kind`/`objective`/`acceptance`/`verify`/...）。
 *   缺的从来不是"存"，是"允许传"与"搬过去"。
 */
const TASK_KEYS = [
  'id', 'subject', 'description', 'assignee', 'dependencies',
  'kind', 'objective', 'acceptance', 'verify', 'inScope', 'outOfScope',
  'deliverables', 'nonGoals', 'coverageOf', 'round', 'model', 'reasoning_effort',
  'reviewedTaskId',
] as const

/** One member row in a named team-profile template (unresolved). */
export interface TeamModelFallbackConfig {
  provider: string
  model: string
}

export interface TeamProfileMemberConfig {
  name: string
  role?: string
  provider?: string
  model?: string
  reasoning_effort?: string
  executionPrompt?: string
  fallback?: TeamModelFallbackConfig
}

/** One seed-task row in a named team-profile template (unresolved). */
export interface TeamProfileTaskConfig {
  id: string
  subject: string
  description?: string
  assignee?: string
  dependencies?: string[]
}

/** One named team-profile template from plugin config. */
export interface TeamProfileConfig {
  description?: string
  protocol?: string
  executionPrompt?: string
  fallback?: TeamModelFallbackConfig
  /**
   * ── ★★★ t15：这个花名册的**默认模型** —— 配一次，凡是这份 profile 建的队都照它起步 ──
   *
   * ★ 它补的是**粒度**上的一个缺口，而不是机制上的：`TeamProfileMemberConfig` 早就有
   *   `provider`/`model`/`reasoning_effort`，而且逐成员那条路**本来就是通的**
   *   （本任务实测：`members:[{name:'architect',model:'claude-opus'}]` 一路走到
   *   member 记录上是 `model: 'claude-opus'`）。
   *   但**没有**一个"这一队人默认都用某个模型"的落点 ⇒ 一支 8 人的花名册要把同一个
   *   模型名抄 8 遍，而**抄第 8 遍时漏一个**的表现是"那一个成员悄悄跑在队长的路由上"。
   *
   * ★★ 优先级（**从宽到窄**，而窄的一定赢）：
   *     成员显式声明 > 这份 profile 的默认 > 插件级 `memberModel` > 队长当前路由
   *   ⇒ 前两级是"配置说了算"，后两级是**今天的既有行为**（一行没动）。
   *
   * ★ 三态：给了 ⇒ 该 profile 里**没有自己声明 model 的**成员拿它当默认；
   *   不给 ⇒ **这一格不参与**，那些成员照旧走插件级/队长路由 ——
   *   "没配默认"绝不能被实现成"默认是一个空路由"。
   */
  model?: string
  /** 与 `model` 成对的默认推理档位。★ 只在成员自己没声明时生效。 */
  reasoning_effort?: string
  members: TeamProfileMemberConfig[]
  /**
   * `captain` means the profile supplies people and guardrails only; the
   * Captain derives the task graph from the user's goal at runtime.
   * `seed` preserves a fixed template workflow for explicitly scripted teams.
   */
  taskPlanning?: 'captain' | 'seed'
  tasks?: TeamProfileTaskConfig[]
  reviewPolicy?: import('./types.ts').ReviewPolicy
}

/** A profile member after trim / pairing / reserved-name checks. */
export interface NormalizedProfileMember {
  name: string
  role?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  executionPrompt?: string
  fallback?: TeamModelFallbackConfig
}

/** A profile seed task after assignee canonicalization; `sourceIndex` is the YAML order. */
export interface NormalizedProfileTask {
  id: string
  subject: string
  description?: string
  assignee?: string
  dependencies: string[]
  sourceIndex: number
  /**
   * ── ★ 契约字段：`kind` 决定一条任务走不走质量门，其余是质量门要求的入参 ──────────
   *
   * 与 `TaskDraft`（`tools/shared/entities.ts`）逐键同名，因为本结构**直接喂** `makeTask`。
   * 不给默认值：`undefined` ⇒ `makeTask` 不写这一格 ⇒ 与"改造前建的种子任务"同形
   * （见 `entities.ts:5524` 那段「`kind` **不传**」的注释 —— 本改造不推翻它，
   *  只是让**想传的时候**传得进去）。
   *
   * ★ `reviewedTaskId` / `sourceTaskId` **不在**这里：它们是审查/修复轮的
   *   **系统生成物**（`planQualityFollowUp` 写、`update_task` 写），不是建队种子该手工填的。
   *   而种子 id 与运行期 id 不同轴，让队长在种子图里手填 linkage 只会造出悬空引用。
   */
  kind?: import('./types.ts').TaskKind
  objective?: string
  acceptance?: string[]
  verify?: string[]
  inScope?: string[]
  outOfScope?: string[]
  deliverables?: string[]
  nonGoals?: string[]
  coverageOf?: string[]
  round?: number
  model?: string
  reasoningEffort?: string
  /**
   * ── ★★★ 审查任务要审的是哪条（**推翻**了本结构此前"这一格不该在这里"的裁定）──────
   *
   * OLD（此前写在 `:142-145`，逐字）：
   *   「`reviewedTaskId` / `sourceTaskId` **不在**这里：它们是审查/修复轮的
   *     **系统生成物**（`planQualityFollowUp` 写、`update_task` 写），不是建队种子该手工填的。
   *     而种子 id 与运行期 id 不同轴，让队长在种子图里手填 linkage 只会造出悬空引用。」
   *
   * ★ 为什么推翻：
   *   ① **"系统生成物"这个前提是错的。** `defaultQualityDeliveryGraph()`
   *      （`quality-gates.ts:2520`）本身就在**建队之前**生成一张含 review 的完整 DAG，
   *      而 `validateCreateTask`（`:1052`）要求 review 必须带 `reviewedTaskId`。
   *      ⇒ 那个函数产出的图**自己过不了自己的校验**（实测原文：
   *      `profile task "review-round-1" is not a valid review task — review tasks require reviewedTaskId`）。
   *      只要这一格不存在，"生成一个标准质量图"这条路就永远走不通。
   *   ② **"不同轴"这个理由站不住。** 建队时本来就把种子 id 映射成 `tN`
   *      （`entities.ts:5497 seedToActual`），而 `dependencies` 一直在用这套映射。
   *      让 `reviewedTaskId` 走**同一套**映射，它就在同一个轴上 —— 反例见
   *      `entities.ts:5562` 那段：不换名会写出一个永远指不中的引用。
   *   ③ 悬空引用现在也**不会静默**：`validateCreateTask` 会逐字拒
   *      `reviewed task "xxx" does not exist`。
   *
   * ★ 语义：填的是**种子 id**（模板 id），不是 `tN`。
   */
  reviewedTaskId?: string
}

/** A fully validated, topologically ordered team profile. */
export interface NormalizedTeamProfile {
  name: string
  description?: string
  protocol?: string
  executionPrompt?: string
  fallback?: TeamModelFallbackConfig
  taskPlanning: 'captain' | 'seed'
  members: NormalizedProfileMember[]
  tasks: NormalizedProfileTask[]
  reviewPolicy?: import('./types.ts').ReviewPolicy
}

/** The goal + optional named profile extracted from a slash / gesture line. */
export interface AgentTeamsInvocation {
  goal: string
  profile?: string
}

/** One configured profile after key trim, for listing / lookup. */
export interface ListedTeamProfile {
  name: string
  config: TeamProfileConfig
}

/**
 * Trim every profile key once, reject empty / colliding keys, and reject
 * more than {@link MAX_TEAM_PROFILES} entries. Does not validate profile
 * bodies — that belongs to {@link resolveTeamProfile}.
 */
export function listConfiguredProfiles(
  profiles: Record<string, TeamProfileConfig> | undefined | null,
): ListedTeamProfile[] {
  const record = asProfilesRecord(profiles)
  const keys = Object.keys(record)
  if (keys.length > MAX_TEAM_PROFILES) {
    throw new Error(`too many AgentTeams profiles (${keys.length}); the limit is ${MAX_TEAM_PROFILES}`)
  }
  const seen = new Map<string, string>()
  const listed: ListedTeamProfile[] = []
  for (const rawKey of keys) {
    const name = rawKey.trim()
    if (name === '') {
      throw new Error('configured AgentTeams profiles include an empty key')
    }
    const previous = seen.get(name)
    if (previous !== undefined) {
      throw new Error(`configured AgentTeams profiles have duplicate key "${name}"`)
    }
    seen.set(name, rawKey)
    listed.push({ name, config: record[rawKey] as TeamProfileConfig })
  }
  return listed
}

/**
 * Render the usage-prompt listing. One line per profile: name, member count,
 * task count, protocol excerpt (at most 240 characters). Returns `''` when
 * nothing is configured so callers can omit the capability entirely.
 */
export function formatProfilesForPrompt(
  profiles: Record<string, TeamProfileConfig> | undefined | null,
): string {
  const listed = listConfiguredProfiles(profiles)
  if (listed.length === 0) return ''
  const lines = [
    'Configured team profiles (pass profile= to agent_teams_create):',
    ...listed.map((entry) => formatProfileListingLine(entry)),
  ]
  return lines.join('\n')
}

/**
 * Walk `rawInput` from the front and eat standalone profile flags. Only
 * `--profile <name>`, `--profile=<name>`, and `profile=<name>` count; the
 * first ordinary token stops the scan so a mid-sentence `profile=` stays in
 * the goal. A leading ordinary token is never treated as a profile name.
 *
 * `--profile "name"` strips one matching pair of quotes. Repeat flags and a
 * `--profile` with no name throw.
 */
export function parseProfileInvocation(rawInput: string): AgentTeamsInvocation {
  const tokens = tokenize(rawInput)
  let index = 0
  let profile: string | undefined
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === undefined) break
    const parsed = parseLeadingProfileFlag(token, tokens[index + 1])
    if (parsed === undefined) break
    if (profile !== undefined) {
      throw new Error('duplicate AgentTeams profile flag')
    }
    profile = parsed.name
    index += parsed.consumed
  }
  const goal = tokens.slice(index).join(' ')
  return profile === undefined ? { goal } : { goal, profile }
}

/**
 * Normalize and pre-validate one named profile. Failures throw before any
 * caller should create a directory or spawn members.
 */
export function resolveTeamProfile(
  profiles: Record<string, TeamProfileConfig>,
  profileName: string,
  maxMembers: number,
): NormalizedTeamProfile {
  const listed = listConfiguredProfiles(profiles)
  const name = profileName.trim()
  if (name === '') {
    throw new Error('AgentTeams profile name must be a non-empty string')
  }
  const match = listed.find((entry) => entry.name === name)
  if (match === undefined) {
    const available = listed.map((entry) => entry.name)
    const shown = available.length === 0 ? '(none)' : available.join(', ')
    throw new Error(`unknown AgentTeams profile "${name}" — configured profiles: ${shown}`)
  }
  return normalizeListedProfile(match, maxMembers)
}

function formatProfileListingLine(entry: ListedTeamProfile): string {
  const memberCount = Array.isArray(entry.config.members) ? entry.config.members.length : 0
  const planning = resolveProfileTaskPlanning(entry.config)
  const graph = planning === 'captain'
    ? 'captain planning'
    : countLabel(Array.isArray(entry.config.tasks) ? entry.config.tasks.length : 0, 'task')
  const counts = `(${countLabel(memberCount, 'member')}, ${graph})`
  const summary = protocolSummary(entry.config.protocol) ?? protocolSummary(entry.config.description)
  return summary === undefined
    ? `- ${entry.name} ${counts}`
    : `- ${entry.name} ${counts}: ${summary}`
}

/** Public lookup used by activation text and status rendering. */
export function resolveProfileTaskPlanning(config: TeamProfileConfig | undefined): 'captain' | 'seed' {
  return config?.taskPlanning === 'captain' ? 'captain' : 'seed'
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function protocolSummary(protocol: string | undefined): string | undefined {
  if (typeof protocol !== 'string') return undefined
  const collapsed = protocol.trim().replace(/\s+/gu, ' ')
  if (collapsed === '') return undefined
  return collapsed.length <= PROFILE_PROTOCOL_PROMPT_LIMIT
    ? collapsed
    : collapsed.slice(0, PROFILE_PROTOCOL_PROMPT_LIMIT)
}

function tokenize(rawInput: string): string[] {
  const trimmed = rawInput.trim()
  if (trimmed === '') return []
  return trimmed.split(/\s+/u)
}

function parseLeadingProfileFlag(
  token: string,
  nextToken: string | undefined,
): { name: string; consumed: number } | undefined {
  if (token === '--profile') {
    if (nextToken === undefined) {
      throw new Error('--profile flag is missing a profile name')
    }
    return { name: readProfileToken(nextToken), consumed: 2 }
  }
  if (token.startsWith('--profile=')) {
    return { name: readProfileToken(token.slice('--profile='.length)), consumed: 1 }
  }
  if (token.startsWith('profile=')) {
    return { name: readProfileToken(token.slice('profile='.length)), consumed: 1 }
  }
  return undefined
}

function readProfileToken(raw: string): string {
  const name = stripOneQuotePair(raw).trim()
  if (name === '') {
    throw new Error('--profile flag is missing a profile name')
  }
  return name
}

/** Strip a single matching pair of `"` or `'` quotes; leave unmatched quotes alone. */
function stripOneQuotePair(value: string): string {
  if (value.length < 2) return value
  const first = value.at(0)
  const last = value.at(-1)
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1)
  }
  return value
}

function normalizeListedProfile(
  listed: ListedTeamProfile,
  maxMembers: number,
): NormalizedTeamProfile {
  const path = `profiles.${listed.name}`
  const raw = asRecord(listed.config, path)
  assertAllowedKeys(raw, PROFILE_KEYS, path)

  const description = optionalNonEmptyString(raw['description'], `${path}.description`)
  const protocol = optionalNonEmptyString(raw['protocol'], `${path}.protocol`)
  const executionPrompt = optionalNonEmptyString(raw['executionPrompt'], `${path}.executionPrompt`)
  const fallback = normalizeFallback(raw['fallback'], `${path}.fallback`)
  /**
   * ── ★★★ t15：这份 profile 的默认路由（两格，各自可选）──────────────────────────
   *
   * ★ 逐格读、**不合并成一个对象**：模型与档位是两件事，而"配了档位没配模型"是
   *   一个**真实的**配置（它只对**已经由别处定下模型**的成员有意义）。
   *   合成一个对象会让那种配置要么被拒、要么被静默丢掉一半。
   */
  const defaultModel = optionalNonEmptyString(raw['model'], `${path}.model`)
  const defaultReasoningEffort = optionalNonEmptyString(raw['reasoning_effort'], `${path}.reasoning_effort`)
  const taskPlanning = normalizeTaskPlanning(raw['taskPlanning'], `${path}.taskPlanning`)
  const reviewPolicy = normalizeReviewPolicy(raw['reviewPolicy'], `${path}.reviewPolicy`)
  const membersRaw = raw['members']
  if (!Array.isArray(membersRaw) || membersRaw.length === 0) {
    throw new Error(`AgentTeams profile "${listed.name}" has no members`)
  }
  if (membersRaw.length > maxMembers) {
    throw new Error(
      `profile "${listed.name}" has ${membersRaw.length} members but maxMembers is ${maxMembers}`,
    )
  }

  const members: NormalizedProfileMember[] = []
  const memberByName = new Map<string, NormalizedProfileMember>()
  const memberByKey = new Map<string, NormalizedProfileMember>()
  for (let index = 0; index < membersRaw.length; index += 1) {
    /**
     * ── ★★★ t15：先归一化，再**并入这份 profile 的默认** ────────────────────────
     *
     * ★ 顺序是要紧的：默认必须在**逐成员校验之后**才叠加。
     *   反过来（先并默认再校验）会让"profile 默认了 provider"这类配置
     *   得到一个**本来该被拒绝**的成员 —— 而那种配置的错处是真实的
     *   （`provider` 必须与 `model` 成对），不该被默认值掩盖。
     */
    const member = applyProfileModelDefaults(
      normalizeMember(membersRaw[index], `${path}.members[${index}]`, listed.name),
      { ...defaultModel === undefined ? {} : { model: defaultModel }, ...defaultReasoningEffort === undefined ? {} : { reasoningEffort: defaultReasoningEffort } },
    )
    const key = sanitizeKey(member.name)
    const colliding = memberByKey.get(key)
    if (colliding !== undefined) {
      throw new Error(
        `profile members "${colliding.name}" and "${member.name}" collapse to the same name`,
      )
    }
    memberByName.set(member.name, member)
    memberByKey.set(key, member)
    members.push(member)
  }

  const tasksRaw = raw['tasks']
  if (tasksRaw === undefined) {
    return omitUndefined({
      name: listed.name,
      description,
      protocol,
      executionPrompt,
      fallback,
      taskPlanning,
      reviewPolicy,
      members,
      tasks: [],
    })
  }
  if (!Array.isArray(tasksRaw)) {
    throw new Error(`profiles.${listed.name}.tasks must be an array`)
  }
  if (tasksRaw.length > MAX_PROFILE_TASKS) {
    throw new Error(
      `profile "${listed.name}" has ${tasksRaw.length} tasks but the limit is ${MAX_PROFILE_TASKS}`,
    )
  }

  const requireAssignee = tasksRaw.length > 0
  const draftTasks: NormalizedProfileTask[] = []
  const taskById = new Map<string, NormalizedProfileTask>()
  const taskByKey = new Map<string, NormalizedProfileTask>()
  for (let index = 0; index < tasksRaw.length; index += 1) {
    const task = normalizeTask(
      tasksRaw[index],
      `${path}.tasks[${index}]`,
      listed.name,
      index,
      memberByName,
      memberByKey,
      requireAssignee,
      /**
       * ★ 种子 linkage 只在**整张图都读完**之后才能判：`reviewedTaskId` 指的那条
       *   可能出现在本任务**之后**。⇒ 循环里跳过，读完再判（见下面 `assertSeedLinkage`）。
       */
      { deferLinkage: true },
    )
    const collidingId = taskById.get(task.id)
    if (collidingId !== undefined) {
      throw new Error(`profile "${listed.name}" has duplicate task id "${task.id}"`)
    }
    const key = sanitizeKey(task.id)
    const collidingKey = taskByKey.get(key)
    if (collidingKey !== undefined) {
      throw new Error(
        `profile tasks "${collidingKey.id}" and "${task.id}" collapse to the same id`,
      )
    }
    taskById.set(task.id, task)
    taskByKey.set(key, task)
    draftTasks.push(task)
  }

  assertSeedLinkage(draftTasks, listed.name)
  const tasks = topoSortTasks(draftTasks, listed.name)
  return omitUndefined({
    name: listed.name,
    description,
    protocol,
    executionPrompt,
    fallback,
    taskPlanning,
    reviewPolicy,
    members,
    tasks: taskPlanning === 'captain' ? [] : tasks,
  })
}

function normalizeTaskPlanning(value: unknown, path: string): 'captain' | 'seed' {
  if (value === undefined) return 'seed'
  if (value === 'captain' || value === 'seed') return value
  throw new Error(`${path} must be "captain" or "seed"`)
}

function normalizeReviewPolicy(value: unknown, path: string): import('./types.ts').ReviewPolicy | undefined {
  if (value === undefined) return undefined
  const raw = asRecord(value, path)
  assertAllowedKeys(raw, REVIEW_POLICY_KEYS, path)
  const requirementsMinRounds = optionalPositiveInt(raw['requirementsMinRounds'], `${path}.requirementsMinRounds`)
  const requirementsMaxRounds = optionalPositiveInt(raw['requirementsMaxRounds'], `${path}.requirementsMaxRounds`)
  const codeMaxRounds = optionalPositiveInt(raw['codeMaxRounds'], `${path}.codeMaxRounds`)
  const maxRepairAttempts = optionalPositiveInt(raw['maxRepairAttempts'], `${path}.maxRepairAttempts`)
  if (
    requirementsMinRounds !== undefined
    && requirementsMaxRounds !== undefined
    && requirementsMinRounds > requirementsMaxRounds
  ) {
    throw new Error(`${path}.requirementsMinRounds must be <= requirementsMaxRounds`)
  }
  let requiredReviewers: string[] | undefined
  if (raw['requiredReviewers'] !== undefined) {
    if (!Array.isArray(raw['requiredReviewers'])) {
      throw new Error(`${path}.requiredReviewers must be an array of strings`)
    }
    requiredReviewers = raw['requiredReviewers'].map((item, index) => {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new Error(`${path}.requiredReviewers[${index}] must be a non-empty string`)
      }
      return item.trim()
    })
  }
  return omitUndefined({
    requirementsMinRounds,
    requirementsMaxRounds,
    codeMaxRounds,
    maxRepairAttempts,
    requiredReviewers,
  })
}

function optionalPositiveInt(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${path} must be a positive integer`)
  }
  return value as number
}

/**
 * ── ★★★ t15：把 profile 的默认路由**并进**一个成员 —— 而"显式的一定赢" ────────────
 *
 * 优先级（从宽到窄，窄的赢）：
 *
 *     成员显式声明  >  这份 profile 的默认  >  插件级 `memberModel`  >  队长当前路由
 *     └────────── 本函数管这一段 ──────────┘   └──── 今天已有的行为，一行不动 ────
 *
 * ★★ 它只**填空白**，绝不覆盖：一个成员自己写了 `model` ⇒ 那两格**原样返回**。
 *   这一点是整个任务里最容易写错的一处 —— 写成"默认总是覆盖"的表现是
 *   **显式的逐成员选择被静默丢掉**，而那种错误在读数上与"默认生效了"同形
 *   （两边都得到一个不是用户要的模型）。
 *
 * ★ 而"没配默认"与"配了默认"必须**不同形**：`defaultModel === undefined` 时
 *   返回的成员**一个键都不加**，于是它照旧走插件级/队长那条链 ——
 *   绝不能把它变成 `model: undefined` 或空串（那会是一个**空路由**，
 *   而"没配"的本意是"照旧"）。
 *
 * ★ 档位**独立**判断：成员自己写了 `reasoning_effort` 就留着它，哪怕它的模型
 *   来自 profile 默认 —— 因为档位是"在这个模型上花多少算力"的**独立**选择。
 *
 * @param member - 已归一化的成员（`provider` 与 `model` 的配对已经校验过）。
 * @param defaults - 这份 profile 的默认（两格各自可选）。
 * @returns 该成员最终的路由片段；没有任何一格被填 ⇒ 原样返回。
 */
export function applyProfileModelDefaults(
  member: NormalizedProfileMember,
  defaults: { model?: string; reasoningEffort?: string },
): NormalizedProfileMember {
  /**
   * ★ 只在成员**完全没声明 model** 时才填。
   *   （`provider` 无 `model` 的组合在 `normalizeMember` 里已经被拒绝，
   *   所以这里不必再处理"有 provider 没 model"那一种。）
   */
  const model = member.model ?? defaults.model
  const reasoningEffort = member.reasoningEffort ?? defaults.reasoningEffort
  /**
   * ★ 三态落地：填不出任何东西时**返回原对象**（连一个键都不加）。
   *   这是"没配默认 ⇒ 照旧走既有链条"的机械形式。
   */
  if (model === undefined && reasoningEffort === undefined) return member
  return omitUndefined({ ...member, model, reasoningEffort })
}

function normalizeMember(
  value: unknown,
  path: string,
  profileName: string,
): NormalizedProfileMember {
  const raw = asRecord(value, path)
  assertAllowedKeys(raw, MEMBER_KEYS, path)
  const name = requiredNonEmptyString(raw['name'], `${path}.name`, `profile "${profileName}" has a member with an empty name`)
  if (isCaptainName(name)) {
    throw new Error(`member name "${name}" is reserved for the captain`)
  }
  const role = optionalNonEmptyString(raw['role'], `${path}.role`)
  const provider = optionalNonEmptyString(raw['provider'], `${path}.provider`)
  const model = optionalNonEmptyString(raw['model'], `${path}.model`)
  const reasoningEffort = optionalNonEmptyString(raw['reasoning_effort'], `${path}.reasoning_effort`)
  const executionPrompt = optionalNonEmptyString(raw['executionPrompt'], `${path}.executionPrompt`)
  const fallback = normalizeFallback(raw['fallback'], `${path}.fallback`)
  if (provider !== undefined && model === undefined) {
    throw new Error(`profile member "${name}" sets provider without model`)
  }
  return omitUndefined({ name, role, provider, model, reasoningEffort, executionPrompt, fallback })
}

function normalizeFallback(value: unknown, path: string): TeamModelFallbackConfig | undefined {
  if (value === undefined) return undefined
  const raw = asRecord(value, path)
  assertAllowedKeys(raw, FALLBACK_KEYS, path)
  const provider = requiredNonEmptyString(raw['provider'], `${path}.provider`, `${path}.provider must not be empty`)
  const model = requiredNonEmptyString(raw['model'], `${path}.model`, `${path}.model must not be empty`)
  return { provider, model }
}

function normalizeTask(
  value: unknown,
  path: string,
  profileName: string,
  sourceIndex: number,
  memberByName: Map<string, NormalizedProfileMember>,
  memberByKey: Map<string, NormalizedProfileMember>,
  requireAssignee: boolean,
  options: { deferLinkage?: boolean } = {},
): NormalizedProfileTask {
  const raw = asRecord(value, path)
  assertAllowedKeys(raw, TASK_KEYS, path)
  const id = requiredNonEmptyString(
    raw['id'],
    `${path}.id`,
    `profile "${profileName}" has a task with an empty id`,
  )
  const subject = requiredNonEmptyString(
    raw['subject'],
    `${path}.subject`,
    `profile task "${id}" is missing a subject`,
  )
  const description = optionalNonEmptyString(raw['description'], `${path}.description`)
  const dependencies = normalizeDependencies(raw['dependencies'], `${path}.dependencies`, id)
  const assignee = resolveTaskAssignee(
    raw['assignee'],
    `${path}.assignee`,
    id,
    requireAssignee,
    memberByName,
    memberByKey,
  )
  /**
   * ── ★ 契约字段的归一化：**在入口就判真伪**，而不是等到 `create_task` 那一层 ────────
   *
   * ★ 为什么在这里判：`create({plan})` 是**一次原子调用** —— 若一条任务的 `kind`
   *   拼错（`'implmentation'`）或质量 kind 缺 `acceptance`，最坏的结果不是报错，
   *   而是**建出一队任务、然后每条都在派发时被 `validateCreateTask` 弹回来**。
   *   那时人已经在看"计划已批准"，而账上是一队注定失败的任务。
   *   ⇒ 在这里拒，等于在**建队那一刻**把不合法的计划挡在门外。
   *
   * ★ 判据**复用** `validateCreateTask`（`quality-gates.ts:980`）而不是重写一份 ——
   *   两份"什么算合法质量任务"的真相一定会漂移，而漂移后**没人读得出来**。
   *   这里做的是把输入**整形成**它认识的形状，再让它裁。
   */
  const kind = normalizeTaskKind(raw['kind'], `${path}.kind`)
  const objective = optionalNonEmptyString(raw['objective'], `${path}.objective`)
  const acceptance = optionalStringList(raw['acceptance'], `${path}.acceptance`)
  const verify = optionalStringList(raw['verify'], `${path}.verify`)
  const inScope = optionalStringList(raw['inScope'], `${path}.inScope`)
  const outOfScope = optionalStringList(raw['outOfScope'], `${path}.outOfScope`)
  const deliverables = optionalStringList(raw['deliverables'], `${path}.deliverables`)
  const nonGoals = optionalStringList(raw['nonGoals'], `${path}.nonGoals`)
  const coverageOf = optionalStringList(raw['coverageOf'], `${path}.coverageOf`)
  const round = optionalPositiveInt(raw['round'], `${path}.round`)
  const model = optionalNonEmptyString(raw['model'], `${path}.model`)
  const reasoningEffort = optionalNonEmptyString(raw['reasoning_effort'], `${path}.reasoning_effort`)
  /**
   * ★ 审查 linkage：填的是**种子 id**（见 `NormalizedProfileTask.reviewedTaskId` 那段）。
   *   这里只判"非空字符串"，**不在这里**判"指向的队伍里有没有那条任务" ——
   *   那需要整张图的上下文，由落盘前的 `validateCreateTask` 判。
   */
  const reviewedTaskId = optionalNonEmptyString(raw['reviewedTaskId'], `${path}.reviewedTaskId`)
  assertTaskContract({
    path,
    id,
    kind,
    objective,
    acceptance,
    verify,
    inScope,
    reviewedTaskId,
    deferLinkage: options.deferLinkage === true,
  })
  return omitUndefined({
    id,
    subject,
    description,
    assignee,
    dependencies,
    sourceIndex,
    kind,
    objective,
    acceptance,
    verify,
    inScope,
    outOfScope,
    deliverables,
    nonGoals,
    coverageOf,
    round,
    model,
    reasoningEffort,
    reviewedTaskId,
  })
}

/**
 * ★ 只接 `TASK_KINDS` 里存在的值。拼错的 kind 一旦放过去，`taskKindOf` 会把它读成
 *   `'work'`（缺省），于是一条"本该走质量门"的任务**静默降级成普通任务** ——
 *   而它看起来是建成了、派发了、完成了。
 */
function normalizeTaskKind(value: unknown, path: string): import('./types.ts').TaskKind | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  const trimmed = value.trim()
  if (!(TASK_KINDS as readonly string[]).includes(trimmed)) {
    throw new Error(`${path} must be one of: ${TASK_KINDS.join(', ')} (got "${value}")`)
  }
  return trimmed as import('./types.ts').TaskKind
}

function optionalStringList(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${path} must be an array of strings`)
  const kept: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (typeof item !== 'string') throw new Error(`${path}[${index}] must be a string`)
    const trimmed = item.trim()
    if (trimmed === '') continue
    if (kept.includes(trimmed)) continue
    kept.push(trimmed)
  }
  return kept.length === 0 ? undefined : kept
}

/**
 * ── ★★★ 复用 `validateCreateTask` 的判据，而不是在这里重写一份 ────────────────────
 *
 * 它回答的正是"这条质量任务能不能建"：质量 kind 必须有 objective + acceptance，
 * 写类 kind（implementation / repair / integration）还必须有 inScope + verify。
 *
 * ★ 独立 import 会成环（`quality-gates.ts` → `types.ts`，而本文件也被它引），
 *   所以调用方把结果**作为函数参数**传进来 —— 见下面 `assertTaskContract` 的签名。
 *   不对：`profiles.ts` 本身**不**被 `quality-gates.ts` 引用（已核 import 方向），
 *   所以这里可以直接 import。
 */
function assertTaskContract(input: {
  path: string
  id: string
  kind: import('./types.ts').TaskKind | undefined
  objective: string | undefined
  acceptance: string[] | undefined
  verify: string[] | undefined
  inScope: string[] | undefined
  reviewedTaskId?: string | undefined
  deferLinkage?: boolean
}): void {
  /**
   * ★ 延迟模式（种子图）：`reviewedTaskId` 的两条判据**全部**交给 `assertSeedLinkage`
   *   对着整张图判，本层一条都不判。理由见下面那格注释 —— 本层是**空队**，
   *   任何"指向存在吗"都必然假，而这个假会把整张合法的图拒掉。
   */
  if (input.deferLinkage === true) {
    if (input.kind === undefined) return
    /**
     * ★ `assumeResolvable` 是**延迟契约**的显式表达，不是"造个假队骗过校验"：
     *   本层只判形状，"这条引用最终指得中吗"由 `assertSeedLinkage` 对着整张图判。
     *   不做这一步的话，空队会让**任何**合法引用都判 `does not exist` —— 那是
     *   "这里本来就判不了"，不是"引用悬空"，而它的后果是把整张合法的图拒掉。
     */
    const team = input.reviewedTaskId === undefined
      ? emptyTeamForContractCheck()
      : withResolvableStub(emptyTeamForContractCheck(), input.reviewedTaskId)
    const shapeVerdict = validateCreateTask(team, {
      subject: input.id,
      kind: input.kind,
      ...input.objective === undefined ? {} : { objective: input.objective },
      ...input.acceptance === undefined ? {} : { acceptance: input.acceptance },
      ...input.verify === undefined ? {} : { verify: input.verify },
      ...input.inScope === undefined ? {} : { inScope: input.inScope },
      ...input.reviewedTaskId === undefined ? {} : { reviewedTaskId: input.reviewedTaskId },
    })
    if (!shapeVerdict.ok) {
      throw new Error(`${input.path}: profile task "${input.id}" is not a valid ${input.kind} task — ${shapeVerdict.error}`)
    }
    return
  }
  if (input.kind === undefined) return
  /**
   * ★ 这里用的是一支**空队**，不是真的队 —— 因为在本函数的调用点，队还没建。
   *   `validateCreateTask` 对 `team` 的读取只有四处（已逐行核）：
   *   `team.halted`、以及 `reviewedTaskId`/`sourceTaskId`/repair 重复 三处 `team.tasks` 查找。
   *
   * ★★ 这段话此前写着「前三者本路径**都不产生**（种子任务没有 linkage）」——
   *   **已被推翻**：`reviewedTaskId` 现在**就是**种子图的一格（见
   *   `NormalizedProfileTask.reviewedTaskId` 那段为什么推翻）。
   *
   * ⇒ 处理方式：传 `undefined` 给校验器，即**在这一层跳过**"指向的任务存在吗"那一条。
   *   理由是那条判据在本层**判不了**（种子 id 要先经 `seedToActual` 才变成 `tN`，
   *   而映射表还没建）；它会在 `initializeProfileTeam` 落盘前由同一个
   *   `validateCreateTask` 用**真实队伍**再判一次 —— 那条路不会漏。
   *   ★ 这里若硬造一个假 team.tasks 去骗过校验，验的就不是产品行为了。
   */
  const verdict = validateCreateTask(emptyTeamForContractCheck(), {
    subject: input.id,
    kind: input.kind,
    ...input.objective === undefined ? {} : { objective: input.objective },
    ...input.acceptance === undefined ? {} : { acceptance: input.acceptance },
    ...input.verify === undefined ? {} : { verify: input.verify },
    ...input.inScope === undefined ? {} : { inScope: input.inScope },
    /**
     * ★ 延迟判：本函数一次只看得到**一条**任务，而 `reviewedTaskId` 可以指向
     *   本任务**之后**才出现的那条。而 `emptyTeam.tasks` 是**空的**，所以任何真 id
     *   都会被判 `does not exist` —— 那不是"引用悬空"，是"这里本来就判不了"。
     * ⇒ 这一格**整条不传**：本层只判形状（objective/acceptance/…），
     *   `reviewedTaskId` 的「填了没」与「指向存在吗」两条都交给 `assertSeedLinkage`
     *   对着**整张图**判。
     */
  })
  if (!verdict.ok) {
    throw new Error(`${input.path}: profile task "${input.id}" is not a valid ${input.kind} task — ${verdict.error}`)
  }
}

/** 一支只装了一条桩任务的队：用于让"指向存在吗"在**延迟模式**下不误报。 */
function withResolvableStub(team: TeamState, id: string): TeamState {
  return { ...team, tasks: [makeStubTask(id)] }
}

/** 桩任务：本层只读 `id`，其余字段不参与判定。 */
function makeStubTask(id: string): TeamState['tasks'][number] {
  return { id, subject: id, status: 'pending', dependencies: [], attempt: 0, createdAt: 0, updatedAt: 0 }
}

/**
 * ★ 本层只用来判"形状"的空队：队还没建，`team.tasks` 自然是空的。
 *   「指向存在吗」那一类判据在这里**必然假**，所以它们全部推迟（见 `assertSeedLinkage`）。
 */
function emptyTeamForContractCheck(): TeamState {
  return {
    name: 'contract-check',
    id: 'contract-check',
    captainSessionId: 'contract-check',
    createdAt: 0,
    members: [],
    tasks: [],
    taskSeq: 0,
  }
}

/**
 * ★ 种子 linkage 的**整图**校验（`reviewedTaskId` 必须指向本图里真的有的种子 id）。
 *
 * ★ 为什么单独一支：`normalizeTask` 一次只看一条，而引用可以指向后面那条。
 *   把它塞进单条归一化要么漏（读不到未来），要么逼作者按顺序写图 —— 后者是一条
 *   **没人会猜到**的暗规则，违反了会得到 `does not exist` 而图其实是对的。
 *
 * ★ 为什么种子层也判：等落盘后再判（`validateCreateTask`）那条路**也在**，
 *   但那时错误信息里 `t5` 与 `implementation` 两套 id 混在一起，离原因很远。
 *   在这里判，人能看见自己写下的那两个名字。
 */
function assertSeedLinkage(tasks: NormalizedProfileTask[], profileName: string): void {
  const ids = new Set(tasks.map((task) => task.id))
  for (const task of tasks) {
    if (task.kind !== 'review') {
      if (task.reviewedTaskId !== undefined) {
        throw new Error(
          `profile "${profileName}" task "${task.id}": reviewedTaskId is only meaningful on a review task (kind is "${task.kind}")`,
        )
      }
      continue
    }
    if (task.reviewedTaskId === undefined) {
      throw new Error(`profile "${profileName}" task "${task.id}": review tasks require reviewedTaskId`)
    }
    if (!ids.has(task.reviewedTaskId)) {
      throw new Error(
        `profile "${profileName}" task "${task.id}": reviewedTaskId "${task.reviewedTaskId}" is not a task in this plan (have: ${[...ids].join(', ')})`,
      )
    }
  }
}

function normalizeDependencies(value: unknown, path: string, taskId: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of task ids`)
  }
  const dependencies: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (typeof item !== 'string') {
      throw new Error(`${path}[${index}] must be a string`)
    }
    const dependency = item.trim()
    if (dependency === '') {
      throw new Error(`${path}[${index}] must not be empty`)
    }
    if (dependency === taskId) {
      throw new Error(`profile task "${taskId}" cannot depend on itself`)
    }
    if (seen.has(dependency)) continue
    seen.add(dependency)
    dependencies.push(dependency)
  }
  return dependencies
}

function resolveTaskAssignee(
  value: unknown,
  path: string,
  taskId: string,
  required: boolean,
  memberByName: Map<string, NormalizedProfileMember>,
  memberByKey: Map<string, NormalizedProfileMember>,
): string | undefined {
  if (value === undefined) {
    if (required) {
      throw new Error(`profile task "${taskId}" is missing an assignee`)
    }
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error(`profile task "${taskId}" is missing an assignee`)
  }
  if (isCaptainName(trimmed)) {
    throw new Error(`profile task "${taskId}" cannot assign work to the captain`)
  }
  const exact = memberByName.get(trimmed)
  if (exact !== undefined) return exact.name
  const fuzzy = memberByKey.get(sanitizeKey(trimmed))
  if (fuzzy !== undefined) return fuzzy.name
  throw new Error(`profile task "${taskId}" assignee "${trimmed}" is not a profile member`)
}

function topoSortTasks(tasks: NormalizedProfileTask[], profileName: string): NormalizedProfileTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency)) {
        throw new Error(`profile task "${task.id}" depends on unknown task "${dependency}"`)
      }
    }
  }

  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const task of tasks) {
    indegree.set(task.id, 0)
    outgoing.set(task.id, [])
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1)
      outgoing.get(dependency)?.push(task.id)
    }
  }

  const ready = tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
  const ordered: NormalizedProfileTask[] = []
  while (ready.length > 0) {
    const next = ready.shift()
    if (next === undefined) break
    ordered.push(next)
    for (const childId of outgoing.get(next.id) ?? []) {
      const remaining = (indegree.get(childId) ?? 0) - 1
      indegree.set(childId, remaining)
      if (remaining === 0) {
        const child = byId.get(childId)
        if (child === undefined) continue
        ready.push(child)
        ready.sort((left, right) => left.sourceIndex - right.sourceIndex)
      }
    }
  }

  if (ordered.length !== tasks.length) {
    const cyclic = tasks
      .filter((task) => !ordered.some((done) => done.id === task.id))
      .map((task) => task.id)
    throw new Error(formatCycleError(profileName, cyclic))
  }
  return ordered
}

function formatCycleError(_profileName: string, cyclic: string[]): string {
  const first = cyclic[0] ?? 'unknown'
  const second = cyclic[1]
  if (cyclic.length === 1 || second === undefined) {
    return `profile task "${first}" forms a dependency cycle`
  }
  if (cyclic.length === 2) {
    return `profile task "${first}" and "${second}" form a dependency cycle`
  }
  const head = cyclic.slice(0, -1).map((id) => `"${id}"`).join(', ')
  const tail = cyclic[cyclic.length - 1] ?? first
  return `profile tasks ${head}, and "${tail}" form a dependency cycle`
}

function isCaptainName(name: string): boolean {
  return name.trim().toLowerCase() === CAPTAIN_KEY || sanitizeKey(name) === CAPTAIN_KEY
}

function asProfilesRecord(
  profiles: Record<string, TeamProfileConfig> | undefined | null,
): Record<string, unknown> {
  if (profiles === undefined || profiles === null) return {}
  if (typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error('AgentTeams profiles must be an object map of named templates')
  }
  return profiles as Record<string, unknown>
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allow = new Set<string>(allowed)
  for (const key of Object.keys(value)) {
    if (allow.has(key)) continue
    const suggestion = suggestField(key, allowed)
    const hint = suggestion === undefined ? '' : `; did you mean ${suggestion}?`
    throw new Error(`${path}.${key} is unknown${hint}`)
  }
}

function suggestField(unknown: string, allowed: readonly string[]): string | undefined {
  const lower = unknown.toLowerCase()
  const exact = allowed.find((candidate) => candidate.toLowerCase() === lower)
  if (exact !== undefined) return exact
  let best: string | undefined
  let bestDistance = Infinity
  for (const candidate of allowed) {
    const distance = levenshtein(lower, candidate.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  if (best !== undefined && bestDistance <= 2) return best
  return undefined
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1
  const cols = right.length + 1
  const grid: number[][] = []
  for (let row = 0; row < rows; row += 1) {
    const line: number[] = []
    for (let col = 0; col < cols; col += 1) {
      if (row === 0) line.push(col)
      else if (col === 0) line.push(row)
      else line.push(0)
    }
    grid.push(line)
  }
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      const del = (grid[row - 1]?.[col] ?? 0) + 1
      const ins = (grid[row]?.[col - 1] ?? 0) + 1
      const sub = (grid[row - 1]?.[col - 1] ?? 0) + cost
      const cell = grid[row]
      if (cell !== undefined) cell[col] = Math.min(del, ins, sub)
    }
  }
  return grid[left.length]?.[right.length] ?? 0
}

function requiredNonEmptyString(
  value: unknown,
  path: string,
  emptyMessage: string,
): string {
  if (value === undefined || typeof value !== 'string') {
    throw new Error(`${path} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(emptyMessage)
  return trimmed
}

function optionalNonEmptyString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error(`${path} must not be empty`)
  }
  return trimmed
}

function omitUndefined<T extends object>(value: T): T {
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] === undefined) delete value[key]
  }
  return value
}
