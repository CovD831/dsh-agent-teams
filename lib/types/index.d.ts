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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type TeamProfileConfig } from './profiles.ts';
export declare const name = "agent-teams";
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /**
     * State directory name under the captain's workspace; team state lives at
     * `<workspace>/<stateDir>/<teamId>/` (default `.agent-teams`).
     */
    stateDir?: string;
    /** `ctx.subagents` provider used to spawn members; must support continuable children and personas (default `spawn`). */
    memberProvider?: string;
    /** Optional model override applied to every member. */
    memberModel?: string;
    /** Prompt injected into member personas and automatic task assignments. */
    executionPrompt?: string;
    /** Plugin-wide fallback route for unavailable member models. */
    fallback?: import('./profiles.ts').TeamModelFallbackConfig;
    /** Member delegation depth cap (default `0`; `0` forbids delegation entirely). */
    memberMaxDepth?: number;
    /** Team size cap in members (default `8`). */
    maxMembers?: number;
    /** Named multi-role team profiles. */
    profiles?: Record<string, TeamProfileConfig>;
    /** Prompt-section order for the usage policy (default `117`, after delegation policy). */
    promptSectionOrder?: number;
    /**
     * Register the deterministic `/agent-teams` activation surfaces (the
     * closed-namespace slash command and the plain-text gesture boundary).
     * Disable to keep the natural-language trigger as the only entry point.
     */
    slashCommand?: boolean;
}
export declare const Config: z<Config>;
/** The model-facing usage policy: when and how to drive AgentTeams. */
export declare function usageSectionText(toolNames: string, profilesText?: string): string;
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
export declare function apply(ctx: Context, config: Config): void;
