// ── src/tools/review-plan.ts ────────────────────────────────────────────────
//
// t7（N6）：把「计划审查」变成**一次显式、可复跑的工具调用**。
//
// ★ 本文件不 import src/tools.ts（会成环）。
//
// ── ★★★ 这一格要修的缺陷（逐字来自 f-0395）────────────────────────────────────
//
// `dispatch.plan-reviewed` 会拒绝没有 `reviewed` 戳的任务，而**全仓没有任何工具
// 能产出那个戳** ⇒ 被门禁判的那一方只能手写 JSON 自签：
//
//     [rejection — not a blocker] create_task rejected: [dispatch.plan-reviewed]
//     this plan has not been reviewed: no `reviewed` stamp is attached, and dispatch
//     requires one (see docs/PLAN-REVIEW.md §8 …)
//
// ⇒ 这就是「闸只会拦、不会带你过」。
//
// ── ★★★ 而修法**不是**让 create_task 自己盖章 ────────────────────────────────
//
// ★ 一个"自动盖章"会让 `dispatch.plan-reviewed` 这条判据**永远通过** ——
//   而那道门存在的全部理由，就是"审没审过"这件事本身要有读数。
//   ⇒ 本工具**只**把审查的结论摆出来；**是否调用它**是调用方的一个显式动作。
//   ⇒ 而**没有调用它的 create_task 仍然必须被拒**（措辞逐字不变）。
//   这一点由 `scripts/tools/review-plan.test.mjs` 的臂 2 钉住。
//
// ── ★★★ 三态纪律：审查不过就**不发戳** ───────────────────────────────────────
//
//   outcome = passed        ⇒ 发戳（五问逐条 `pass`，四问逐条 `present`）
//   outcome = needs-review  ⇒ ★ **不发戳**，逐条列出"哪一问没判出来 + 补救动作"
//   outcome = rejected      ⇒ ★ **不发戳**，逐条列出"哪一问没过 + 补救动作"
//
//   ★ 一个"形状合法但内容没过"的戳比没有戳更坏：它过得去 `readReviewed`，
//     而它把"我判不了"洗成了"审过了"——那正是全库那条最贵的纪律要防的事。
//
// ── ★ 三个既有模块是**唯一真值**，本文件不重写任何一份 ──────────────────────────
//
//   `scripts/plan-review-check.mjs`         `checkPlanReview`   —— 四问「计划写清了吗」
//   `scripts/friction-triage.mjs`           `adversarialReview` —— 五问「这份契约能不能派」
//   `scripts/friction-triage.mjs`           `tierOf`            —— 分档（大活先拆）
//   `src/gates/dispatch/plan-reviewed.ts`   `REVIEW_QUESTION_IDS` —— 戳要答的那五问
//
//   ★ 本文件只做**汇合**：调它们、把结论拼成一个戳、或拼成一份"为什么不能发戳"。
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { defineTool } from '@deepseek-ai/dsh-tools';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REVIEW_QUESTION_IDS, PLAN_REVIEWED_GATE_ONLINE_AT } from "../gates/dispatch/plan-reviewed.js";
import { findTeamByParticipant } from "../state.js";
import { participantIdentityOf, pluginRoot, requireCaptain, stateRootOf, workspaceOf } from "./shared/entities.js";
/**
 * 动态 import 两个 `.mjs` 真值源。
 *
 * ★ 静态 `import '../../../scripts/…'` 会破 `tsc` 的 `rootDir`（`src`）——
 *   与 `entities.ts` 的 `loadPlanReviewModule` / `loadFrictionTriageModule`
 *   走**同一条**运行时路径。
 */
async function loadPlanReviewCheck() {
    const target = pathToFileURL(join(pluginRoot(), 'scripts', 'plan-review-check.mjs')).href;
    return await import(__rewriteRelativeImportExtension(/* @vite-ignore */ target));
}
async function loadTriage() {
    const target = pathToFileURL(join(pluginRoot(), 'scripts', 'friction-triage.mjs')).href;
    return await import(__rewriteRelativeImportExtension(/* @vite-ignore */ target));
}
/**
 * 一份"这一问没过，下一步做什么"的**补救动作**。
 *
 * ★ 逐问写死，而不是笼统一句"请改进计划"—— 后者让读的人不知道下一步做什么，
 *   而那正是本队记账过的形态：「一个错误的措辞让人去做另一件事」。
 */
const REMEDY_OF = Object.freeze({
    scope: '把 inScope 收窄成**具体文件**（不要以 `/` 结尾的目录格），并补上漏掉的文件（t54 的形态是漏三个）',
    prerequisite: '把缺的那个前置**先说清**（它依赖什么、那个东西现在在不在）；判不出来时写成一条显式依赖',
    move: '它要搬文件 ⇒ 在 verify 里补一条**能跑的核对**（t70 就是这样丢了 4 组接线）',
    acceptance: '把那条**恒真**的 acceptance 换成一条能被一次定向突变判红的（t94 的"恰好落一栏"就是恒真）',
    boundary: '把会产出的具体路径从 outOfScope 里挪出来，或把产物登记进 inScope —— 否则这条任务永远做不完',
    'why-now': '在 objective 里说清**为什么现在做**（这件事现在不做会坏在哪）',
    steps: '在 inScope 里列出它要改的那些文件（那是"怎么做"的可核形状）',
    'invariant-reading': '在 acceptance 里写一条**读数**（命令、退出码、计数、diff、hash 都算）—— 没有读数就无法判真假',
    'stop-points': '在 verify 里写清**什么时候该停**（哪条命令红了就停、停在哪个判据上）',
    '(tier)': '先把它拆成几条小活（每条一个可判的写域），再逐条来审查',
});
function remedyFor(id) {
    return REMEDY_OF[id] ?? `给 \`${id}\` 补一条能让读的人知道"下一步做什么"的说明`;
}
/**
 * `tierOf` 的 `exists` 探针 —— 相对**插件根**（仓库根）。
 * ★ 与 `readPlanReview` 的缺省同一条口径（那里也是 `join(pluginRoot(), relativePath)`）。
 */
function defaultExists(relativePath) {
    return existsSync(join(pluginRoot(), relativePath));
}
/** 一整块读数不成立时的返回值 —— ★ `stampable: false`，而**有** `unmeasured` 成因。 */
function unmeasurableReadout(why) {
    return {
        stampable: false,
        checks: [],
        refusals: [],
        plan: { overall: 'unmeasured', detail: why, perQuestion: [] },
        tier: { tier: 'unmeasurable', why },
        unmeasured: why,
    };
}
/**
 * 跑完整审查，并按三态决定发不发戳 —— **纯逻辑**，不碰盘、不碰 ctx。
 *
 * ★ 抽出来是为了让夹具能**逐条**构造三种结论，而不必去造一棵真实的 team 树。
 *   生产路径（下面的 `execute`）调的就是这一个函数 —— **一条实现，两处使用**。
 */
export async function reviewAndStamp(options) {
    const loadCheck = options.loadCheck ?? loadPlanReviewCheck;
    const loadTriageModule = options.loadTriage ?? loadTriage;
    let checkModule;
    try {
        checkModule = await loadCheck();
    }
    catch (error) {
        return unmeasurableReadout(`the plan review module could not be loaded: ${String(error?.message)}`);
    }
    if (typeof checkModule.checkPlanReview !== 'function') {
        return unmeasurableReadout('the plan review module loaded but no longer exports `checkPlanReview` '
            + `(saw: ${typeof checkModule.checkPlanReview}) — the shape moved, so this reading means nothing`);
    }
    let triageModule;
    try {
        triageModule = await loadTriageModule();
    }
    catch (error) {
        return unmeasurableReadout(`the friction triage module could not be loaded: ${String(error?.message)}`);
    }
    if (typeof triageModule.adversarialReview !== 'function') {
        return unmeasurableReadout('the friction triage module loaded but no longer exports `adversarialReview` '
            + `(saw: ${typeof triageModule.adversarialReview}) — the shape moved, so this reading means nothing`);
    }
    /**
     * ── ① 四问「计划写清了吗」（`checkPlanReview`）──────────────────────────────
     * ★ 只传**这一条**契约 ⇒ 报告里的 `total` 恒为 1，读数不会与别条混。
     */
    const checked = checkModule.checkPlanReview([options.contract]);
    const planContract = Array.isArray(checked.contracts) ? checked.contracts[0] : undefined;
    const requiredQuestions = Array.isArray(checkModule.REQUIRED_PLAN_QUESTIONS)
        ? checkModule.REQUIRED_PLAN_QUESTIONS
        : [];
    const perQuestion = [];
    for (const item of requiredQuestions) {
        const key = typeof item.key === 'string' ? item.key : '';
        if (key === '')
            continue;
        const answer = planContract?.answers?.[key];
        perQuestion.push({
            key,
            status: typeof answer?.status === 'string' ? answer.status : 'unmeasured',
            detail: typeof answer?.detail === 'string' ? answer.detail : '',
        });
    }
    /**
     * ── ② 五问「这份契约能不能派」（`adversarialReview`）──────────────────────────
     * `scopeVerdict` 传 `undefined`：本工具从**已写好的契约**出发，
     * 没有"收窄过程"这回事 ⇒ `adversarialReview` 会退回看"结尾有没有 /"。
     */
    const review = triageModule.adversarialReview(options.contract, undefined);
    if (typeof review.outcome !== 'string') {
        return unmeasurableReadout('the friction triage module loaded but `adversarialReview` returned no `outcome` — '
            + 'a review with no total verdict cannot decide whether to stamp');
    }
    const checks = [];
    for (const check of Array.isArray(review.checks) ? review.checks : []) {
        const id = typeof check.id === 'string' ? check.id : '';
        if (id === '')
            continue;
        checks.push({
            id,
            verdict: check.verdict === 'pass' || check.verdict === 'fail' || check.verdict === 'unmeasured'
                ? check.verdict
                : 'unmeasured',
            why: typeof check.why === 'string' ? check.why : '',
        });
    }
    const refusals = [];
    const byId = new Map(checks.map((check) => [check.id, check]));
    /**
     * ★★ 五问必须**逐条在场** —— 少一条就不算审过。
     *
     * ★ 而这不是"再判一次"：它把 `dispatch.plan-reviewed` 的**前提**提前摆到
     *   调用方面前。那条判据拒的正是"戳没答全五问"；若本工具在缺一问时也发戳，
     *   那个戳会在**派发那一刻**才被拒 —— 而在这里它还能被说清补救动作。
     */
    for (const questionId of REVIEW_QUESTION_IDS) {
        const answered = byId.get(questionId);
        if (answered === undefined) {
            refusals.push({
                id: questionId,
                verdict: '(missing)',
                why: `审查没有答这一问 —— 一个不答全部 ${REVIEW_QUESTION_IDS.length} 问的戳，`
                    + '在派发那一刻会被 `dispatch.plan-reviewed` 拒掉',
                remedy: remedyFor(questionId),
            });
            continue;
        }
        if (answered.verdict === 'pass')
            continue;
        refusals.push({
            id: questionId,
            verdict: answered.verdict,
            why: answered.why === '' ? '(审查没有给出理由)' : answered.why,
            remedy: remedyFor(questionId),
        });
    }
    /**
     * ── ③ 四问里任何一问**没写清**也不发戳 ─────────────────────────────────────
     *
     * ★ 这两组问句**不是**同一件事（一组问"计划写清了吗"，一组问"契约能不能派"），
     *   而它们都挡在"能不能发戳"前面：一条 why-now 都说不清的计划，即使五问
     *   形状上全 pass，也不该被盖章说"审过了"。
     */
    for (const answer of perQuestion) {
        if (answer.status === 'present')
            continue;
        refusals.push({
            id: answer.key,
            verdict: answer.status,
            why: answer.detail === '' ? '(四问读数没有给出理由)' : answer.detail,
            remedy: remedyFor(answer.key),
        });
    }
    /**
     * ── ④ 分档：**大活先拆** ────────────────────────────────────────────────────
     * ★ 理由不是"大活不能做"，而是 `tierOf` 自己的判据 —— 它给出的 `nextStep`
     *   逐字是 `decompose`。一份该拆还没拆的计划，审过了也只是"审过了这份不成立的计划"。
     *   这与 `docs/PLAN-REVIEW.md §8`「派出的不应该有大活」是同一条。
     * ★ `unmeasurable` 也挡：读不出它有多大 ⇒ 那一问没有答案（不是"应该很小"）。
     */
    const tierReading = typeof triageModule.tierOf === 'function'
        ? triageModule.tierOf(options.contract, { exists: defaultExists })
        : undefined;
    const tier = {
        tier: typeof tierReading?.tier === 'string' ? tierReading.tier : 'unmeasurable',
        why: typeof tierReading?.why === 'string'
            ? tierReading.why
            : 'the friction triage module loaded but no longer exports `tierOf` — the tier reading means nothing',
        ...typeof tierReading?.nextStep === 'string' ? { nextStep: tierReading.nextStep } : {},
    };
    if (tier.tier === 'large') {
        refusals.push({
            id: '(tier)',
            verdict: 'large',
            why: `分档判它是**大活**：${tier.why} ⇒ 下一步是 \`${tier.nextStep ?? 'decompose'}\`，不是盖章`,
            remedy: remedyFor('(tier)'),
        });
    }
    else if (tier.tier !== 'small') {
        refusals.push({
            id: '(tier)',
            verdict: tier.tier,
            why: `分档读不出它有多大：${tier.why} ⇒ "派出的不应该有大活"这一问没有答案`,
            remedy: '把 inScope 写成具体文件（空写域不是一个"小"的表面，是一个没说出口的表面）',
        });
    }
    /**
     * ── ⑤ 戳的时刻必须**晚于**这道门上线的那一刻 ────────────────────────────────
     *
     * ★ 这不是"再检查一遍"—— 它是 `dispatch.plan-reviewed` 的 `stampImpossibility`
     *   会拒掉的第二种形态（一个比门还早的戳）。生产里 `at` 来自注入的时钟
     *   （缺省 `Date.now()`），天然晚于 2026-10-09；但**夹具可以注入一个更早的时刻**
     *   ⇒ 那时必须**不发戳**，而不是发一个会被拒的戳。
     */
    if (options.at < PLAN_REVIEWED_GATE_ONLINE_AT) {
        refusals.push({
            id: '(at)',
            verdict: 'too-early',
            why: `盖戳时刻 ${new Date(options.at).toISOString()} 早于 \`dispatch.plan-reviewed\` `
                + `上线的时刻 (${new Date(PLAN_REVIEWED_GATE_ONLINE_AT).toISOString()}) `
                + '⇒ 这个戳不可能是这条路盖出来的',
            remedy: '用真实的当前时刻重跑一次审查；★ 把 `at` 改晚是伪造，不是修复',
        });
    }
    const stampable = refusals.length === 0 && review.outcome === 'passed';
    return {
        stampable,
        ...stampable ? { reviewed: { at: options.at, by: options.by, checks } } : {},
        checks,
        refusals,
        plan: {
            overall: typeof checked.overall === 'string' ? checked.overall : 'unmeasured',
            detail: typeof checked.detail === 'string' ? checked.detail : '',
            perQuestion,
        },
        tier,
    };
}
/**
 * 从团队里读出"这个 agent 是谁" —— 用来填戳的 `by`。
 *
 * ★ 读不到团队 ⇒ 用一个**说得出事实**的兜底值，而不是空串：
 *   `by` 空串会让 `validateCreateTask` 拒掉整个戳（"who performed the review"），
 *   而那会把"还没建队"读成"审查坏了"。
 */
async function callerLabelOf(stateRoot, agentId, workspace) {
    const team = await findTeamByParticipant(stateRoot, agentId);
    if (team !== undefined) {
        const identity = participantIdentityOf(team, agentId);
        if (identity !== undefined)
            return identity.name;
    }
    /**
     * ★ 没有队 ⇒ 用**工作区路径**当身份，而不是空白：它至少说得出"是谁在哪审的"，
     *   而 `callerLabelOf` 的调用方已经把 `workspace` 作为事实交进来了。
     */
    return `agent@${lastSegment(workspace)}`;
}
function lastSegment(path) {
    const trimmed = path.replace(/[\\/]+$/u, '');
    const index = trimmed.lastIndexOf('/');
    return index === -1 ? trimmed : trimmed.slice(index + 1);
}
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export function register(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'agent_teams_review_plan',
        description: 'Run the adversarial plan review on a task contract and, ONLY if every question passes, return a `reviewed` stamp you can pass to create_task/amend_task. '
            + 'Call this before dispatch: `dispatch.plan-reviewed` rejects any task without a stamp. '
            + 'When the review cannot settle a question (needs-review) or rejects it, this tool returns NO stamp and lists each failing question with the remedy — a stamp whose shape is legal but whose content failed would launder "cannot decide" into "reviewed".',
        parameters: {
            /**
             * ★ 契约本体**内联**传进来，而不是传一个任务 id。
             *
             * 理由：这条工具要在 `create_task` **之前**跑（任务还不存在），而
             * `amend_task` 之前也要能跑（改过契约要重审）。传 id 会把它绑死在
             * "已存在的任务"上 —— 而那恰恰是被拒的那条路。
             */
            contract: {
                type: 'object',
                required: true,
                additionalProperties: false,
                description: 'The contract to review: the same fields you are about to pass to create_task (subject, objective, inScope, outOfScope, acceptance, verify, dependencies, kind).',
                properties: {
                    subject: { type: 'string', description: 'Task subject.' },
                    kind: { type: 'string', description: 'Quality kind (implementation / repair / verification / review / requirements / integration / work).' },
                    objective: { type: 'string', description: 'Why this task exists — what breaks if it is not done now.' },
                    inScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task may change.' },
                    outOfScope: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative POSIX paths this task must not change.' },
                    acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria — each must be falsifiable by one directed mutation.' },
                    verify: { type: 'array', items: { type: 'string' }, description: 'Verification commands.' },
                    dependencies: { type: 'array', items: { type: 'string' }, description: 'Task ids this contract depends on.' },
                },
            },
            by: {
                type: 'string',
                description: 'Who performs the review (recorded in the stamp). Defaults to the caller identity (`captain` or the member name).',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    /**
                     * ★★ 三态纪律的机械形式：**能不能发戳**是一格布尔，而
                     *   "戳"与"为什么没有戳"是两格 —— `stampable === false` 时 `reviewed` 缺席。
                     */
                    stampable: { type: 'boolean', required: true },
                    /** ★ 戳本身，逐字是 `create_task.reviewed` 的形状 `{at, by, checks[]}`。 */
                    reviewed: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            at: { type: 'number', required: true },
                            by: { type: 'string', required: true },
                            checks: {
                                type: 'array',
                                required: true,
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        id: { type: 'string', required: true },
                                        verdict: { type: 'string', required: true },
                                        why: { type: 'string', required: true },
                                    },
                                },
                            },
                        },
                    },
                    /** 五问逐条结论。 */
                    checks: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                id: { type: 'string', required: true },
                                verdict: { type: 'string', required: true },
                                why: { type: 'string', required: true },
                            },
                        },
                    },
                    /**
                     * ★ 不发戳的逐条理由。★ 与 `checks` **不是**同一件事：
                     *   `checks` 是五问的结论，`refusals` 是"因此不发戳"的那几条
                     *   （还含四问、分档、时刻 —— 它们各自可能挡在前面）。
                     */
                    refusals: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                id: { type: 'string', required: true },
                                verdict: { type: 'string', required: true },
                                why: { type: 'string', required: true },
                                remedy: { type: 'string', required: true },
                            },
                        },
                    },
                    /**
                     * ── ★★★ 四问「计划写清了吗」**摊平**在顶层，而不是折进一个 `plan` 对象 ──────────
                     *
                     * ★ 这个形状是**被普查臂逼出来的**，理由值得写下来（它是本队记账的那条
                     *   「声明面必须能被执行面走到」的一个特例）：
                     *
                     *   `scripts/gate-tool-output-schema.test.mjs` 的 `valueFor()` 只会造
                     *   **顶层**必填格的最小合法值 —— `number ⇒ 1`、`boolean ⇒ true`、
                     *   `array ⇒ []`、`string ⇒ 'x'`，而 `object ⇒ {}`。
                     *   ⇒ 一个 `required: true` 的**对象**格会被填成 `{}`，于是它内部那些
                     *     `required: true` 的子格一律报 "missing required property"。
                     *   ⇒ 而那个 arm 是**普查**（遍历注册表里的全部工具），不是针对这一个工具，
                     *     所以要么把形状摊平，要么那个 arm 对**任何**带必填子对象的工具永远红。
                     *
                     * ★★ 我选**摊平**，而不是把 `plan`/`tier` 改成非必填：
                     *   非必填会让"这一份读数在场"变成一个**不被声明**的事实 ——
                     *   那正是本队反复记账的形态（字段加了、声明没跟上）。
                     *   摊平之后每一格仍然是 `required: true`，**声明只强不弱**。
                     */
                    plan_overall: { type: 'string', required: true },
                    plan_detail: { type: 'string', required: true },
                    plan_per_question: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                key: { type: 'string', required: true },
                                status: { type: 'string', required: true },
                                detail: { type: 'string', required: true },
                            },
                        },
                    },
                    /** 分档 —— ★ 同样摊平，理由同上。 */
                    tier: { type: 'string', required: true },
                    tier_why: { type: 'string', required: true },
                    tier_next_step: { type: 'string' },
                    /**
                     * ★ 模块调不起来时**这一格有值**，而 `stampable` 为 false、`refusals` 为空 ——
                     *   "我读不出"与"它没过"必须不同形。
                     */
                    unmeasured: { type: 'string' },
                },
            },
            render: (args, value) => {
                void args;
                const lines = [];
                if (value.unmeasured !== undefined) {
                    lines.push(`Plan review: unmeasured — ${value.unmeasured}`);
                    lines.push('★ 这不是"审过了"，也不是"没过"：审查模块没跑起来，所以没有任何结论。');
                    lines.push('★ 因此本工具**没有**发戳 —— 派发前仍然需要一次真的审查。');
                    return [{ type: 'text', text: lines.join('\n') }];
                }
                lines.push(value.stampable
                    ? `Plan review: passed — a \`reviewed\` stamp was produced (${value.checks.length} questions answered).`
                    : `Plan review: NOT stamped — ${value.refusals.length} reason(s). `
                        + '★ 一个形状合法而内容没过的戳，会把"我判不了"洗成"审过了"。');
                lines.push(`Tier: ${value.tier} — ${value.tier_why}`
                    + (value.tier_next_step === undefined ? '' : ` ⇒ next step: ${value.tier_next_step}`));
                lines.push(`Plan questions (${value.plan_overall}): ${value.plan_detail}`);
                for (const answer of value.plan_per_question) {
                    lines.push(`  · ${answer.key}: ${answer.status}${answer.detail === '' ? '' : ` — ${answer.detail}`}`);
                }
                if (value.checks.length > 0) {
                    lines.push('Adversarial review (5 questions):');
                    for (const check of value.checks)
                        lines.push(`  · ${check.id}: ${check.verdict} — ${check.why}`);
                }
                if (value.refusals.length > 0) {
                    lines.push(`Why no stamp (${value.refusals.length}):`);
                    for (const refusal of value.refusals) {
                        lines.push(`  - ${refusal.id} [${refusal.verdict}] ${refusal.why}`);
                        lines.push(`    remedy: ${refusal.remedy}`);
                    }
                }
                lines.push('');
                if (value.reviewed !== undefined) {
                    lines.push('Pass this as `reviewed` to create_task:');
                    lines.push(JSON.stringify(value.reviewed, null, 2));
                }
                else {
                    lines.push('★ 没有戳可传 —— 把上面每一条 remedy 做完，再调一次本工具。');
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(args, exec) {
            /**
             * ★ 身份：captain 与成员都可以调（谁审的都行 —— 戳里 `by` 记的是**谁**）。
             *   ★ 但**必须**有一个 agent：`by` 的缺省值来自它，而"审的人"不许是空白。
             */
            const agent = requireCaptain(exec);
            const workspace = workspaceOf(agent);
            const stateRoot = stateRootOf(workspace, config);
            /**
             * ★ 时钟：`config.now` 是**注入**的（夹具控制时间）；缺省 `Date.now` 是
             *   **生产**缺省。见 `ToolsConfig.now` 的文档（"不注入 ⇒ 判据按自己的契约报
             *   unmeasured，不是退回系统时钟"—— 而这里的 `at` 就是那个 `now`）。
             */
            const at = (config.now ?? Date.now)();
            const explicitBy = typeof args.by === 'string' && args.by.trim() !== '' ? args.by.trim() : undefined;
            const by = explicitBy ?? await callerLabelOf(stateRoot, agent.id, workspace);
            const readout = await reviewAndStamp({ contract: args.contract, at, by });
            return {
                stampable: readout.stampable,
                ...readout.reviewed === undefined ? {} : { reviewed: readout.reviewed },
                checks: readout.checks,
                refusals: readout.refusals,
                plan_overall: readout.plan.overall,
                plan_detail: readout.plan.detail,
                plan_per_question: readout.plan.perQuestion,
                tier: readout.tier.tier,
                tier_why: readout.tier.why,
                ...readout.tier.nextStep === undefined ? {} : { tier_next_step: readout.tier.nextStep },
                ...readout.unmeasured === undefined ? {} : { unmeasured: readout.unmeasured },
            };
        },
    }));
}
