/**
 * AgentTeams for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `agent_teams_*` tools and one usage
 * agent-scoped usage section. Each session keeps a stable tool set and core
 * instructions. Existing business tools cover the complete team lifecycle.
 * After installation any session can
 * run multi-agent teamwork through natural language (e.g. "use AgentTeams to research X"):
 * the model creates a team (it becomes the captain), spawns members as
 * durable continuable subagents, breaks the goal into tasks with
 * dependencies, wakes members with messages, relays reports, and collects
 * results.
 *
 * Installation (bundle): `dsh plugin --profile <name> add @nanmicoder/dsh-agent-teams`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module dsh-agent-teams
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Declaration merges make ctx.subagents and ctx.systemPrompt visible.
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import {
  haltTeamWork,
  stagedPlanApprovedContext,
  registerAgentTeamsTools,
  type StagedPlanMutation,
  type ToolsConfig,
} from './tools.ts'
import { installAgentTeamsGestureBoundary, registerAgentTeamsCommand } from './command.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectArchivedTeamsActivity, collectTeamsActivity } from './snapshot.ts'
import { findTeamByCaptain } from './state.ts'
import { formatProfilesForPrompt, type TeamProfileConfig } from './profiles.ts'
import { installTeamCapabilities } from './capabilities.ts'
import { installHmrTrace } from './hmr-trace.ts'
import { pluginRoot } from './tools/shared/entities.ts'
import { TEAM_TOOL_NAMES } from './tool-names.ts'

import { authenticatedWebRoutes, loopbackOnlyRoute, pluginShell, readJsonRequest, RequestBodyError, type BrowserRequestGate, type ShellStatus, type WebRouteHost } from './web-routes.ts'

/** Web-server service key candidates, newest first. */
const WEB_SERVER_KEYS = ['webServer', 'httpServer'] as const
/** Workspace registry service key candidates, newest first. */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'] as const

export const name = 'agent-teams'
export const inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents']

/**
 * 本插件每一棵宿主 Context 上的**挂载状态**（t18）。
 *
 * ★ 用 `WeakMap` 而不是 `ctx.<我们的字段>`：宿主对象不是我们的公告板，
 *   而"我们往它上面挂过什么"不该成为别人要读源码才知道的事。
 * ★ 弱引用 ⇒ 一棵 Context 被丢弃时它跟着走，不留全局增长的状态。
 */
const shellState = new WeakMap<Context, ShellStatus>()

/** 降级状态的读取路径（回环围栏）。★ 与其余路由同一命名空间，但**不**共用鉴权链。 */
const DEGRADED_ROUTE = '/plugins/dsh-agent-teams/degraded'

/** Plugin configuration. */
export interface Config {
  /**
   * State directory name under the captain's workspace; team state lives at
   * `<workspace>/<stateDir>/<teamId>/` (default `.agent-teams`).
   */
  stateDir?: string
  /** `ctx.subagents` provider used to spawn members; must support continuable children and personas (default `spawn`). */
  memberProvider?: string
  /** Optional model override applied to every member. */
  memberModel?: string
  /** Prompt injected into member personas and automatic task assignments. */
  executionPrompt?: string
  /** Plugin-wide fallback route for unavailable member models. */
  fallback?: import('./profiles.ts').TeamModelFallbackConfig
  /** Member delegation depth cap (default `0`; `0` forbids delegation entirely). */
  memberMaxDepth?: number
  /** Team size cap in members (default `8`). */
  maxMembers?: number
  /** Named multi-role team profiles. */
  profiles?: Record<string, TeamProfileConfig>
  /** Prompt-section order for the usage policy (default `117`, after delegation policy). */
  promptSectionOrder?: number
  /**
   * Register the deterministic `/agent-teams` activation surfaces (the
   * closed-namespace slash command and the plain-text gesture boundary).
   * Disable to keep the natural-language trigger as the only entry point.
   */
  slashCommand?: boolean
}

// `z.object()` has an implicit `{}` default in Schemastery.  Fallback routes
// are optional, so model absence explicitly; otherwise a missing route is
// validated as an empty object and fails on the required provider/model keys.
const fallbackRouteConfig = z.union([
  z.object({ provider: z.string().required(), model: z.string().required() }),
  z.const(undefined),
])

export const Config: z<Config> = z.object({
  stateDir: z.string().default('.agent-teams'),
  memberProvider: z.string().default('spawn'),
  memberModel: z.string(),
  executionPrompt: z.string(),
  fallback: fallbackRouteConfig,
  profiles: z.dict(z.object({
    description: z.string(),
    protocol: z.string(),
    executionPrompt: z.string(),
    fallback: fallbackRouteConfig,
    members: z.array(z.object({
      name: z.string().required(),
      role: z.string(),
      provider: z.string(),
      model: z.string(),
      reasoning_effort: z.string(),
      executionPrompt: z.string(),
      fallback: fallbackRouteConfig,
    })).min(1).required(),
    taskPlanning: z.union([z.const('captain'), z.const('seed')]),
    reviewPolicy: z.object({
      requirementsMinRounds: z.natural().min(1),
      requirementsMaxRounds: z.natural().min(1),
      codeMaxRounds: z.natural().min(1),
      maxRepairAttempts: z.natural().min(1),
      requiredReviewers: z.array(z.string()),
    }),
    tasks: z.array(z.object({
      id: z.string().required(),
      subject: z.string().required(),
      description: z.string(),
      assignee: z.string(),
      dependencies: z.array(z.string()),
    })),
  })).default({}),
  memberMaxDepth: z.natural().default(0),
  maxMembers: z.natural().min(1).default(8),
  promptSectionOrder: z.natural().default(117),
  slashCommand: z.boolean().default(true),
})

/** The model-facing usage policy: when and how to drive AgentTeams. */
export function usageSectionText(toolNames: string, profilesText = ''): string {
  return `AgentTeams captain protocol:
1. Inspect current team state when needed, using agent_teams_status. Continue existing work without duplicating its roster/tasks. Create only when no current team exists, with the user's goal as description and approval="required"; automatic approval requires an explicit request to run immediately. Staged plans never spawn or schedule work.
2. Add each needed role once; members inherit your model route unless another is requested/needed. A requested profile goes to create({profile}); it supplies its roster. Seed profiles also supply tasks; captain-planning profiles require your DAG. Do not duplicate either.
3. Build the complete smallest useful DAG while staged. For an ordinary research/audit plan, pass the roster and dependency graph together in create({plan:{members,tasks}}) to avoid repeated setup rounds. Every task needs a subject; pass kind and assignee explicitly when the plan specifies them. Titles, descriptions and member roles do not set these fields. Dependencies represent prerequisites. Give every required contributor a task or explicit message. Present the plan and end your turn for review; never approve in that planning turn. Approve only after a later explicit user approval or the Web action.
4. Respect Web approve/return/discard control messages. On return, ask what to change before editing; after the answer, use one atomic agent_teams_edit_plan batch (edit downstream references before removals), summarize and await review again. Never inspect or edit .agent-teams state files or plugin source code to revise plans. Discard does not authorize a replacement.
5. The scheduler dispatches ready tasks after approval. Delegate; do not duplicate slow work or send messages merely to start a stage. Handle reports/user work, then yield when waiting is all that remains: reports wake you automatically. Use status after a delivery or user request, never busy-poll or wait for unassigned members.
6. Tasks carry attempt_id capabilities. Use the current attempt_id; stale means ownership changed. Pause members only on explicit request; later guidance via send_message continues that same attempt. Retry, transfer or take over through reassign_task first; it revokes the old attempt and waits for quiescence. Prefer a member. Captain implementation/review takeover requires a user request. Every takeover is one ready task at a time, finished in this turn; never yield with captain-owned work open.
7. In a running team, correct never-started pending tasks with edit_plan update_task; preserve dependency and ownership contracts instead of cancelling and recreating the graph. A captain can cancel a never-started pending task directly. Active attempts still require reassign_task. Quality kinds (requirements, implementation, verification, review, repair, integration) require objective + acceptance; implementation/repair also require inScope + verify. Derive paths/commands from the workspace/profile, never assume src/ or pnpm test. Review/requirements complete only with verdict=pass; needs_revision/reject fail with findings. Never approve your own implementation or ask for a deliberate failure. When a quality contract itself is wrong (a verify command that cannot pass, an inScope that forbids the file the objective requires), fix it with agent_teams_amend_task — captain-only, non-terminal tasks only, frozen after a passing review, and every amendment is recorded in the task's revisions ledger — instead of letting the worker dead-lock or game the gate.
8. When full quality mode is requested: requirements → implementation → verification → review → integration. Plan the entire DAG while staged, including implementation before requirements finishes and integration depending on review round 1. Failed review automatically adds repair + next review and rewires pending downstream gates. Do not recreate this loop, omit integration or depend on a failed task. Review acceptance judges the latest implementation. Do not put smoke-test scripts into task instructions. The worker does not hand its context to the captain on finishing: it reaches a terminal state, a reviewer judges that state, a repair answers the findings, and the SAME reviewer re-judges the repair — carrying reviewedTaskId and reviewedAttempt so "which revision was judged" is answerable. Only a passing review hands anything onward, and what it hands the integrator is changedPaths plus baseRevision, not the reasoning that produced them.
9. Halted means the user stopped work (including the captain turn). Resume only on a later explicit user request with a reason, via agent_teams_resume or create_task({resume:true,resumeReason}); creating tasks alone never resumes. Escalated means the review loop hit its limit, not a halt. Deployment requires explicit user confirmation.
10. Wait for all required tasks to be terminal and members idle/ready, present results, then delete/archive unless the user wants to continue. Never discard unfinished work without authorization.
Tools: ${toolNames}${profilesText === '' ? '' : `\n\n${profilesText}`}`
}

/**
 * ── ★★★ 挂载外壳（t18）：AgentTeams 的缺陷只让它自己降级 ──────────────────────────
 *
 * MEASURED（t18，本机 cordis 4.0.4；`scripts/gate-fault-isolation.test.mjs` 钉住）：
 *
 *     一个插件的 `apply()` 抛错 ⇒ cordis **已经**把它隔离了：
 *     同步抛出被 `composeError` 捕获 ⇒ `ctx.plugin()` 正常返回 ⇒ **兄弟插件照常挂载**
 *     ⇒ 而错误**只**落进 `ctx.logger.error(...)` 一行。
 *
 * ★★ 所以本任务的缺口**不是**"宿主会崩"，而是**失败了读不出来**：
 *   一行日志会随滚动消失，而**读不到原文的失败与健康启动在观测上同形** ——
 *   这正是本队记账最久的形态（也是本任务契约原话要求"用路由而不是只用控制台"的原因）。
 *
 * ── 因此外壳做两件事，而它们**缺一不可** ────────────────────────────────────────
 *
 *   ① **永不抛错**：`apply` 的同步抛出与 promise rejection 都接住（见 `pluginShell`）。
 *      ★ 这保证"我们这一行"再怎么坏也不会成为宿主挂载事务里的一个异常源。
 *   ② **把失败变成可查询的**：状态挂在 `ctx` 上的一个**弱引用**里，由
 *      `GET /plugins/dsh-agent-teams/degraded` 读出来（回环围栏，见 `loopbackOnlyRoute`）。
 *
 * ★ 而第 ① 条有个必须防的副作用：**"吞掉异常然后报健康"比不隔离更坏**
 *   （它把一次可见的崩溃换成一次静默的半吊子启动）⇒ 所以降级态**不许**并进 healthy，
 *   三态必须不同形（外壳自己保证了这一条，并由夹具的定向突变钉住）。
 */
export function apply(ctx: Context, config: Config): void {

  const shell = pluginShell(name, {
    apply: () => applyInner(ctx, config),
    log: (entry) => {
      /**
       * ★ 日志**保留**（它是给人看的第一现场），但它**不是**唯一的出口 ——
       *   那正是本任务要修的那一格。措辞把它与"普通告警"分开：
       *   读的人要能一眼看出"这一行**没挂起来**"，而不是"它抱怨了一句"。
       */
      ctx.logger.error(
        `agent-teams: this plugin FAILED TO MOUNT at stage "${entry.stage}" and is degraded`
        + ` (the host plugin tree is unaffected): ${entry.reason}`,
      )
    },
  })

  /**
   * ★ 把读到的状态**镜像**进弱表 —— 路由读的是它。
   *   外壳的 `status` 是活的 getter，所以每次挂载后重新镜像一次即可。
   *
   * ★★ 而**无论如何**都要同步（包括挂载失败之后）：
   *   路由必须在"我们这一行坏了"时**仍然读得到**，否则它就只是又一个"只在健康时可用"
   *   的读数 —— 而那与没有这个路由是同形的。
   */
  void shell.mount().then((status) => {
    shellState.set(ctx, status)
  }).catch((error: unknown) => {
    /**
     * ★ 这一支**理论上不可达**（外壳永不抛错），但"不可达"是**要防守的假设**：
     *   若它真的到了这里，那说明外壳自己坏了 —— 而那必须**读得出来**，
     *   不许因为"我们觉得不可能"而静默。
     */
    shellState.set(ctx, {
      plugin: name,
      state: 'degraded',
      degraded: [{
        plugin: name,
        stage: 'apply',
        reason: `the isolation shell itself threw (this should be unreachable): ${error instanceof Error ? error.message : String(error)}`,
        at: new Date().toISOString(),
      }],
    })
  })
}

/**
 * ★ `apply` 的**本体** —— 名字与原实现逐字相同，只是被外壳包了一层。
 *
 * ★★ 为什么保持它同步：外壳 `await` 它的返回值，于是同步抛出与 rejected promise
 *   在**同一条路**上被接住；把它改成 async 只会多一层没有信息量的包装。
 */
function applyInner(ctx: Context, config: Config): void {
  /**
   * ★ 起始态是 `not-mounted`（**不是** healthy）：外壳还没跑完。
   *   路由读它时若挂载还在进行，读到的就是这一态 —— 而它与"挂好了"不同形。
   */
  shellState.set(ctx, { plugin: name, state: 'not-mounted', degraded: [] })

  const resolved: ToolsConfig = {
    stateDir: config.stateDir ?? '.agent-teams',
    memberProvider: config.memberProvider ?? 'spawn',
    memberModel: config.memberModel,
    executionPrompt: config.executionPrompt,
    fallback: config.fallback,
    memberMaxDepth: config.memberMaxDepth ?? 0,
    maxMembers: config.maxMembers ?? 8,
    profiles: config.profiles ?? {},
  }

  // Provider registration is a sibling plugin's effect (`subagent-spawn` /
  // `subagent-fork` rows), which can land after this mount under the Loader's
  // concurrent activation — so capability validation happens at the first
  // member spawn (`spawnMember`), the earliest point the provider list is
  // settled, rather than here.

  const agentTeamsRuntime = registerAgentTeamsTools(ctx, resolved)
  /**
   * ── HMR 重载的痕迹（见 `src/hmr-trace.ts` 的文件头）─────────────────────────────
   *
   * ★ 它在这里接，而不是在 `hmr` 服务上 `inject`：**这个探针不许成为
   *   宿主能不能起来的一个条件**。事件名不存在时它永不触发，plugin 照常工作。
   *
   * ★ 落盘位置是**插件自己的目录**（`pluginRoot()`），而**不是** `process.cwd()`。
   *
   * MEASURED（2026-10-10，本条的作者自己踩的）：第一版写的是
   * `join(process.cwd(), resolved.stateDir)`，而**宿主进程的 `cwd` 是 profile 目录**
   * （实测：`lsof -p <host> -a -d cwd` ⇒ `~/.dsh/profiles/desktop`，而不是仓库）。
   * ⇒ 痕迹写去了 `~/.dsh/profiles/desktop/.agent-teams/`，
   *   而**找它的人在仓库里找** —— 实测找了两轮才找到。
   *
   * ★★ 这正是本仓记过的同一条形状：**"写对了"与"写在别人会去看的地方"是两件事**，
   *    而两者在"文件确实存在"这个读数上同形。
   *
   * ★ `pluginRoot()` 是**模块位置**推出的常量，不随 cwd 变
   *   （实测：插件的 `cwd` 与仓库根不同，而 `pluginRoot()` 恒为仓库根）
   *   ⇒ 于是痕迹与它描述的那个 `lib/` 永远在同一棵树里。
   */
  installHmrTrace(ctx, join(pluginRoot(), resolved.stateDir))
  installTeamCapabilities(ctx, {
    stateDir: resolved.stateDir,
    isPendingMember: agentTeamsRuntime.isPendingMember,
    order: config.promptSectionOrder,
    // Keep the bounded profile directory available without extra tool calls.
    // installTeamCapabilities snapshots this once; no business state rewrites it.
    captainPrompt: () => usageSectionText(TEAM_TOOL_NAMES.join(', '), formatProfilesForPrompt(config.profiles)),
  })

  // Deterministic activation surfaces: the closed-namespace `/agent-teams`
  // host command (surfaces in the Web GUI slash menu via the Harness
  // ui-commands client) and the plain-text gesture boundary for surfaces
  // without command adjudication (headless CLI). Both default on; a profile
  // can disable them to keep the natural-language trigger exclusive.
  //
  // `commands` is registered lazily (not a required inject): it ships in the
  // base bundle of every standard profile, but a minimal composition that
  // omits the command registry keeps the plugin fully functional — the fiber
  // never pends on it and simply never gains the slash command.
  if (config.slashCommand ?? true) {
    ctx.inject(['commands'], (commandCtx) => {
      registerAgentTeamsCommand(commandCtx, () => config.profiles ?? {})
    })
    installAgentTeamsGestureBoundary(ctx, () => config.profiles ?? {})
  }

  // The activity panel data/artwork routes need the Web server and the
  // workspace registry, which headless profiles do not mount; under
  // concurrent activation they may also bind after this plugin. Register the
  // routes lazily: try now, then on each service binding event. In a webless
  // profile the plugin stays tool-only and never blocks boot.
  let webRegistered = false
  const registerWebSurface = (): void => {
    if (webRegistered) return
    const rawWebServer = (ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])) as WebRouteHost | undefined
    const workspaceRegistry = (ctx.get(WORKSPACE_KEYS[0]) ?? ctx.get(WORKSPACE_KEYS[1])) as WorkspaceRegistry | undefined
    if (rawWebServer === undefined || workspaceRegistry === undefined) return
    const webServer = authenticatedWebRoutes(rawWebServer, () => ctx.get('connection') as BrowserRequestGate | undefined)
    webRegistered = true

    /**
     * ── ★★★ 降级状态路由（t18）—— 它**必须**是最早注册的那一条 ────────────────────
     *
     * 契约原话：「把失败状态通过一条路由报出来，而不是只报在控制台。」
     *
     * ★★★ 而它**不经过** `authenticatedWebRoutes`（那是**别的**路由要的网闸）：
     *   本路由自己带**回环围栏**（`loopbackOnlyRoute`）。理由是本任务的核心语义：
     *
     *     一个"这个插件为什么没挂起来"的读数，如果它挂在**我们插件自己的鉴权链**上，
     *     那么**在我们插件坏掉的那一天，它也跟着坏** ——
     *     而"插件降级"恰恰是它唯一该说话的时刻。
     *
     *   ⇒ ★ 这正是本队记账的形态：一个读数若与它所描述的东西共命运，
     *     它就**永远说不了那句最该说的话**。
     *     ⇒ 所以：它只依赖 `webServer`（宿主的），不依赖我们的 `connection` 网闸、
     *       不依赖 workspace 注册表、不依赖 `registerAgentTeamsTools` 的任何产出。
     *     ⇒ 也因此在 `registerWebSurface` 里**先于**那几条业务路由注册。
     *
     * ★ 回环围栏保护的是信息（错误原文里可能带绝对路径），见 `loopbackOnlyRoute`。
     */
    ctx.effect(() => loopbackOnlyRoute(rawWebServer, DEGRADED_ROUTE, () => shellState.get(ctx) ?? {
      plugin: name,
      state: 'not-mounted',
      degraded: [],
    }), 'agent-teams: degraded route')

    // Activity panel data route: the browser floater polls this for team
    // snapshots (disk truth + live subagent activity). Mirrors the Claude
    // Code desktop watcher's server-side snapshot pattern.
    ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-agent-teams/state',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const roots = workspaceRegistry.list().map((workspace) => ({
        workspace: workspace.title,
        stateRoot: join(workspace.path, resolved.stateDir),
      }))
      // ?archived=1 serves teams moved to archive/ (post-delete review).
      const snapshots = url.searchParams.get('archived') === '1'
        ? await collectArchivedTeamsActivity(ctx, roots)
        : await collectTeamsActivity(ctx, roots)
      const body = JSON.stringify({ teams: snapshots })
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(body)
    },
  }), 'agent-teams: activity route')

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-agent-teams/halt',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
          res.end()
          return
        }
        let payload: Record<string, unknown>
        try {
          payload = await readJsonRequest(req)
        } catch (error: unknown) {
          res.writeHead(error instanceof RequestBodyError ? error.status : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid request body' }))
          return
        }
        const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : ''
        const teamId = typeof payload.teamId === 'string' ? payload.teamId.trim() : ''
        if (sessionId === '' || teamId === '') {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: 'sessionId and teamId are required' }))
          return
        }
        const captain = ctx.agents.get(sessionId as import('@deepseek-ai/dsh-session').SessionId)
        if (captain === undefined) {
          res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: 'captain session is not attached' }))
          return
        }
        const workspace = captain.session.header.cwd ?? process.cwd()
        const stateRoot = join(workspace, resolved.stateDir)
        const team = await findTeamByCaptain(stateRoot, captain.id)
        if (team === undefined || team.id !== teamId) {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: 'team not found for this captain' }))
          return
        }
        try {
          const result = await haltTeamWork({
            ctx,
            stateRoot,
            teamId,
            captain,
          })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(result))
        } catch (error: unknown) {
          ctx.logger.warn(`agent-teams: halt failed for ${teamId}: ${String(error)}`)
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: 'failed to stop the team' }))
        }
      },
    }), 'agent-teams: halt route')

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-agent-teams/plan',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
          res.end()
          return
        }
        let payload: Record<string, unknown>
        try {
          payload = await readJsonRequest(req)
        } catch (error: unknown) {
          res.writeHead(error instanceof RequestBodyError ? error.status : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid request body' }))
          return
        }
        const sessionId = typeof payload['sessionId'] === 'string' ? payload['sessionId'].trim() : ''
        const teamId = typeof payload['teamId'] === 'string' ? payload['teamId'].trim() : ''
        const action = typeof payload['action'] === 'string' ? payload['action'] : ''
        if (sessionId === '' || teamId === '' || action === '') {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: 'sessionId, teamId, and action are required' }))
          return
        }
        const captain = ctx.agents.get(sessionId as import('@deepseek-ai/dsh-session').SessionId)
        if (captain === undefined) {
          res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: 'captain session is not attached' }))
          return
        }
        const workspace = captain.session.header.cwd ?? process.cwd()
        const stateRoot = join(workspace, resolved.stateDir)
        const team = await findTeamByCaptain(stateRoot, captain.id)
        if (team === undefined || team.id !== teamId) {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: 'team not found for this captain' }))
          return
        }
        try {
          if (action === 'approve') {
            const approved = await agentTeamsRuntime.approveStagedTeam(captain, teamId)
            // The browser receives the HTTP result, so the model needs its own
            // control message. steer wakes an idle captain or joins its next
            // step; the tool approve path already returns to the model itself.
            try {
              captain.steer(createUserMessage({
                content: [{ type: 'text', text: stagedPlanApprovedContext(team.name) }],
                source: { kind: 'agent-teams' },
              }))
            } catch (error) {
              // Approval is already committed. Do not report a failed approval
              // and invite a retry that could duplicate the user's action.
              ctx.logger.warn(`agent-teams: approval notification failed for ${teamId}: ${String(error)}`)
            }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ ok: true, phase: 'running', ...approved }))
            return
          }
          if (action === 'continue') {
            const continued = await agentTeamsRuntime.continueStagedPlanning(captain, teamId)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ ok: true, phase: 'staged', review: 'awaiting_feedback', ...continued }))
            return
          }
          if (action === 'discard') {
            const discarded = await agentTeamsRuntime.discardStagedTeam(captain, teamId)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(JSON.stringify({ ok: true, phase: 'archived', ...discarded }))
            return
          }
          const dependencies = Array.isArray(payload['dependencies'])
            ? payload['dependencies'].filter((item): item is string => typeof item === 'string')
            : []
          let mutation: StagedPlanMutation
          if (action === 'update_member') {
            if (typeof payload['memberName'] !== 'string'
              || typeof payload['provider'] !== 'string'
              || typeof payload['model'] !== 'string') throw new Error('memberName, provider, and model are required')
            mutation = {
              action,
              memberName: payload['memberName'],
              provider: payload['provider'],
              model: payload['model'],
              ...typeof payload['role'] === 'string' || payload['role'] === null ? { role: payload['role'] as string | null } : {},
              ...typeof payload['reasoningEffort'] === 'string' || payload['reasoningEffort'] === null
                ? { reasoningEffort: payload['reasoningEffort'] as string | null }
                : {},
              ...typeof payload['executionPrompt'] === 'string' || payload['executionPrompt'] === null
                ? { executionPrompt: payload['executionPrompt'] as string | null }
                : {},
            }
          } else if (action === 'update_task') {
            if (typeof payload['taskId'] !== 'string' || typeof payload['subject'] !== 'string') {
              throw new Error('taskId and subject are required')
            }
            mutation = {
              action,
              taskId: payload['taskId'],
              subject: payload['subject'],
              dependencies,
              ...typeof payload['description'] === 'string' || payload['description'] === null
                ? { description: payload['description'] as string | null }
                : {},
              ...typeof payload['assignee'] === 'string' || payload['assignee'] === null
                ? { assignee: payload['assignee'] as string | null }
                : {},
            }
          } else if (action === 'add_task') {
            if (typeof payload['subject'] !== 'string') throw new Error('subject is required')
            mutation = {
              action,
              subject: payload['subject'],
              dependencies,
              ...typeof payload['description'] === 'string' || payload['description'] === null
                ? { description: payload['description'] as string | null }
                : {},
              ...typeof payload['assignee'] === 'string' || payload['assignee'] === null
                ? { assignee: payload['assignee'] as string | null }
                : {},
            }
          } else if (action === 'remove_task') {
            if (typeof payload['taskId'] !== 'string') throw new Error('taskId is required')
            mutation = { action, taskId: payload['taskId'] }
          } else {
            throw new Error(`unknown plan action "${action}"`)
          }
          const updated = await agentTeamsRuntime.updateStagedPlan(captain, teamId, mutation)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ ok: true, phase: updated.phase, members: updated.members.length, tasks: updated.tasks.length }))
        } catch (error: unknown) {
          res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'plan operation failed' }))
        }
      },
    }), 'agent-teams: plan route')

  // Whale mascot artwork: serve the packaged V2 role/action images to the
  // activity panel. An explicit allowlist guards the route (no path
  // traversal); the images ship with the bundle (files: assets/).
  const artDir = fileURLToPath(new URL('../assets/agent-teams/', import.meta.url))
  const ART_ALLOWLIST = new Set([
    'team-lead-v2.png',
    'member-researcher-v2.png', 'member-engineer-v2.png',
    'member-qa-v2.png', 'member-designer-v2.png',
    'member-security-v2.png', 'member-docs-v2.png',
    'member-data-v2.png', 'member-operator-v2.png',
    'action-working-v2.png', 'action-thinking-v2.png',
    'action-reporting-v2.png', 'action-celebrating-v2.png',
    'action-sleeping-v2.png', 'action-sending-v2.png',
  ])
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/plugins/dsh-agent-teams/assets',
    handler: async (req, res) => {
      let name: string
      try {
        name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.split('/').pop() ?? '')
      } catch {
        // Malformed percent-encoding: treat as an unknown asset, not a 400.
        res.writeHead(404)
        res.end()
        return
      }
      if (!ART_ALLOWLIST.has(name)) {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        const data = await readFile(join(artDir, name))
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=86400',
        })
        res.end(data)
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams: artwork read failed for ${name}: ${String(error)}`)
        res.writeHead(404)
        res.end()
      }
      },
    }), 'agent-teams: artwork route')
  }

  registerWebSurface()
  ctx.on('internal/service', (name) => {
    if (WEB_SERVER_KEYS.includes(name as (typeof WEB_SERVER_KEYS)[number])
      || WORKSPACE_KEYS.includes(name as (typeof WORKSPACE_KEYS)[number])) {
      registerWebSurface()
    }
  })
}
