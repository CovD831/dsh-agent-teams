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
/** Hard cap on named profiles so the usage prompt cannot grow without bound. */
export declare const MAX_TEAM_PROFILES = 16;
/** Hard cap on seed tasks per profile. The software-delivery example has 13. */
export declare const MAX_PROFILE_TASKS = 32;
/** Protocol excerpt length in the usage / prompt listing. */
export declare const PROFILE_PROTOCOL_PROMPT_LIMIT = 240;
/** One member row in a named team-profile template (unresolved). */
export interface TeamModelFallbackConfig {
    provider: string;
    model: string;
}
export interface TeamProfileMemberConfig {
    name: string;
    role?: string;
    provider?: string;
    model?: string;
    reasoning_effort?: string;
    executionPrompt?: string;
    fallback?: TeamModelFallbackConfig;
}
/** One seed-task row in a named team-profile template (unresolved). */
export interface TeamProfileTaskConfig {
    id: string;
    subject: string;
    description?: string;
    assignee?: string;
    dependencies?: string[];
}
/** One named team-profile template from plugin config. */
export interface TeamProfileConfig {
    description?: string;
    protocol?: string;
    executionPrompt?: string;
    fallback?: TeamModelFallbackConfig;
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
    model?: string;
    /** 与 `model` 成对的默认推理档位。★ 只在成员自己没声明时生效。 */
    reasoning_effort?: string;
    members: TeamProfileMemberConfig[];
    /**
     * `captain` means the profile supplies people and guardrails only; the
     * Captain derives the task graph from the user's goal at runtime.
     * `seed` preserves a fixed template workflow for explicitly scripted teams.
     */
    taskPlanning?: 'captain' | 'seed';
    tasks?: TeamProfileTaskConfig[];
    reviewPolicy?: import('./types.ts').ReviewPolicy;
}
/** A profile member after trim / pairing / reserved-name checks. */
export interface NormalizedProfileMember {
    name: string;
    role?: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    executionPrompt?: string;
    fallback?: TeamModelFallbackConfig;
}
/** A profile seed task after assignee canonicalization; `sourceIndex` is the YAML order. */
export interface NormalizedProfileTask {
    id: string;
    subject: string;
    description?: string;
    assignee?: string;
    dependencies: string[];
    sourceIndex: number;
}
/** A fully validated, topologically ordered team profile. */
export interface NormalizedTeamProfile {
    name: string;
    description?: string;
    protocol?: string;
    executionPrompt?: string;
    fallback?: TeamModelFallbackConfig;
    taskPlanning: 'captain' | 'seed';
    members: NormalizedProfileMember[];
    tasks: NormalizedProfileTask[];
    reviewPolicy?: import('./types.ts').ReviewPolicy;
}
/** The goal + optional named profile extracted from a slash / gesture line. */
export interface AgentTeamsInvocation {
    goal: string;
    profile?: string;
}
/** One configured profile after key trim, for listing / lookup. */
export interface ListedTeamProfile {
    name: string;
    config: TeamProfileConfig;
}
/**
 * Trim every profile key once, reject empty / colliding keys, and reject
 * more than {@link MAX_TEAM_PROFILES} entries. Does not validate profile
 * bodies — that belongs to {@link resolveTeamProfile}.
 */
export declare function listConfiguredProfiles(profiles: Record<string, TeamProfileConfig> | undefined | null): ListedTeamProfile[];
/**
 * Render the usage-prompt listing. One line per profile: name, member count,
 * task count, protocol excerpt (at most 240 characters). Returns `''` when
 * nothing is configured so callers can omit the capability entirely.
 */
export declare function formatProfilesForPrompt(profiles: Record<string, TeamProfileConfig> | undefined | null): string;
/**
 * Walk `rawInput` from the front and eat standalone profile flags. Only
 * `--profile <name>`, `--profile=<name>`, and `profile=<name>` count; the
 * first ordinary token stops the scan so a mid-sentence `profile=` stays in
 * the goal. A leading ordinary token is never treated as a profile name.
 *
 * `--profile "name"` strips one matching pair of quotes. Repeat flags and a
 * `--profile` with no name throw.
 */
export declare function parseProfileInvocation(rawInput: string): AgentTeamsInvocation;
/**
 * Normalize and pre-validate one named profile. Failures throw before any
 * caller should create a directory or spawn members.
 */
export declare function resolveTeamProfile(profiles: Record<string, TeamProfileConfig>, profileName: string, maxMembers: number): NormalizedTeamProfile;
/** Public lookup used by activation text and status rendering. */
export declare function resolveProfileTaskPlanning(config: TeamProfileConfig | undefined): 'captain' | 'seed';
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
export declare function applyProfileModelDefaults(member: NormalizedProfileMember, defaults: {
    model?: string;
    reasoningEffort?: string;
}): NormalizedProfileMember;
