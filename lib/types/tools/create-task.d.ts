import { AgentTeamsRuntime } from './shared/entities.ts';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolsConfig } from './shared/entities.ts';
/**
 * ── ★★★ t14：**每一次执行**的模型绑定 —— 任务自己声明"哪个模型跑它" ──────────────
 *
 * ── 它替换掉的那个更粗的框法 ──────────────────────────────────────────────────
 *
 * 最初的框法是"改**成员**的模型"。而那个框法定不了位：一个持久成员在
 * **多轮里执行许多不同的任务** ⇒ "这个成员的模型"**指不出"这个结果是谁产出的"**。
 *
 * ★ 而这里换成**任务自己带**：每个任务声明它由哪个模型执行 —— 因为
 *   **真正需要归属的是【那条结果】，而不是【那台机器】。**
 *   来源：@linxin666/dsh-web-all 的 task-board 设计（每条 task 自带 model +
 *   `executions[]` 历史 —— 于是**一次运行是历史里的一个元素，而不是一次状态转换**）。
 *
 * ── ★★ 而"已执行"的封条是【fail-closed】的（本任务的核心约束）────────────────────
 *
 * MEASURED / 逐条推理：**改一个【已经在跑】的任务的模型会毁掉归属** ——
 *   "这条结果是谁产出的"从那一刻起**没有唯一答案**。
 * ⇒ 用户明确接受**推迟**这件事。⇒ 于是这里**不许**悄悄放开它：
 *   一旦这条任务**执行过**，绑定就是**封条**，改它 ⇒ **拒绝**（不是警告）。
 *
 * ★ 三态里"拒绝了"与"没说话"必须不同形 —— 所以拒绝走一条**可辨认的措辞**
 *   （见 `MODEL_BINDING_SEALED_CODE`），而不是静默 no-op。
 *
 * ── ★★ 而这条封条的判据是【借来的】，并且逐字保留了它的宽口径 ────────────────────
 *
 * 借源 `canEditTaskContent()` 的口径是：**只有从未开始的任务**才可编辑内容。
 * 本文件把它落成同一条谓词 —— 三个条件是**或**的关系，缺一不可：
 *
 *   · `attempt > 0`              —— 已经被认领/执行过（代数已经推进）
 *   · status ∈ claimed|in_progress —— 正在跑（`attempt` 可能还没落盘）
 *   · status ∈ 终态               —— 已收口（有产物，归属已经写死）
 *
 * ★ 为什么终态也要算"封死"：一个 `completed` 的任务**已经有产物**了，
 *   而它的绑定正是那个产物的归属 —— 那时候改绑定比"在跑时改"**更坏**，
 *   因为那条结果已经交付、已经被引用。
 */
export declare const MODEL_BINDING_SEALED_CODE = "model_binding_sealed";
/**
 * 这条任务的**模型绑定是否已经封死**（= 已经执行过 ⇒ 不许再改）。
 *
 * ★ 抽成**一个**导出谓词、而不是在调用点内联三个条件：因为"哪几种任务算已执行"
 *   是**一条**规则。内联会让它在下一次加状态时**只改一处、漏另一处**，
 *   而那正是本队记账里"同一条规则的两个副本慢慢分叉"的形状。
 *
 * ★★ 而终态那份清单**不在这里重写一遍** —— 它 import 自 `src/types.ts` 的
 *   `TERMINAL_TASK_STATUSES`（全仓同一个定义）。
 *   ★ 我第一版在这里抄了一份 `['completed','failed','cancelled']`，而那是本文件
 *     正在记账的那个错**本身**：加一个终态时，两处会分叉，而分叉的表现是
 *     "新终态的任务可以悄悄改绑定"（一条**静默**的归属漏洞）。
 *   ⇒ 一个**定义**只许有一份。
 *
 * @param task - 任何带 `attempt` / `status` 的任务形状（夹具可以只给这两格）。
 * @returns true ⇒ 绑定已封死，改它必须**拒绝**。
 */
export declare function modelBindingIsSealed(task: {
    attempt?: number;
    status?: string;
}): boolean;
/**
 * ── ★★★ 绑定的**传播**：诚实读数，而不是"记了就当生效" ───────────────────────────
 *
 * 契约第四格要求把"这个绑定到不到得了执行的那台机器"**查实并如实报告**；
 * 若路由不传播，要**明说**，不许交出一个"记了却从没被用上"的绑定。
 *
 * ★ MEASURED（对着已安装的 `@deepseek-ai/dsh-subagent` 的声明与实现逐条读出来的）：
 *
 *   · `ContinuableStartSpec.request.agentOptions` **是**每次创建时可带的
 *     （`startContinuable` ⇒ `resolveChildAgentOptions(parent, request.agentOptions, …)`
 *      ⇒ 写进 descriptor 的 `agentProvider/agentModel/agentReasoningEffort`）
 *     ⇒ ★ 也就是说：**一个成员【首次创建】时，路由是能带进去的。**
 *
 *   · ★★ 但**交付**带不了：`sendMessage(sender, targetId, content, options)` 与
 *     `queuePrompt(parent, childId, content, source, signal)` 的签名里**没有路由**。
 *     而冷恢复更是**明写**它不重新取路由 —— `coldResume` 的注释逐字是
 *     "the descriptor supplies every reconstruction input"，它从**描述符**里
 *     读回 `agentProvider/agentModel` 重建子代理。
 *
 *   ⇒ ★ 结论（本任务如实报告的那一条）：**一个已经存在的成员，它的路由在【创建那一刻】
 *     就冻进描述符了**；后续每一次派发（`deliverToMember` / `queuePrompt` /
 *     `coldResume`）都**带不上**一条新路由。
 *
 *   ⇒ 于是本任务**交的是**：绑定**被记录、可读、可审计**（每一条任务的归属因此
 *     有唯一答案），而**"换掉一台已经在跑的机器"这件事被如实标为未接线**。
 *     ★ 这比"悄悄记一个不会被用的绑定"诚实，也比"假装它生效了"安全。
 *
 * ★ 三态（与全仓纪律同源 —— "没接线"与"接了但没用上"必须不同形）：
 *   · `enforced: true`  —— 绑定的模型 == 该成员创建时冻进描述符的模型（一致，无需迁移）
 *   · `enforced: false` —— 两者**不同**：绑定只是记录，派发仍走成员自己的路由（**必须明说**）
 *   · 未传 `memberModel` —— **不猜**：`enforced` 缺席（"没能判定" ≠ "一致"）
 */
export interface ModelBindingPropagation {
    /** 绑定的模型是否与执行这台机器的已冻结路由一致（缺席 = 未能判定，不是"一致"）。 */
    enforced?: boolean;
    /** 绑定的模型（记录下来的那一格）。 */
    model: string;
    /**
     * 该成员创建时冻进描述符的模型（有才给）。
     *
     * ★★★ MEASURED（本任务的臂 8 当场抓住）：这一格我第一版写的是 `memberModel`
     *   （camelCase），而 `output.schema` 里声明的是 **`member_model`**（snake_case）。
     *   ⇒ 返回值**通不过自己的 schema** ⇒ 宿主在 `createSuccessResult` 里抛
     *   `ToolOutputError` ⇒ ★ **这个工具每次调用都失败**。
     *
     * ★ 而这正是本队同族形态的**第 10 次**（前 9 次见本文件其它处的记账）：
     *   **改了产出，没改声明** —— 或反过来，**声明的是名 A、产出的是名 B**。
     *   两次的判别面都是"拿真的返回值去走宿主自己的校验器"。
     * ⇒ ★ 命名**跟随 schema**（snake_case），因为这个字段要跨工具边界交出去，
     *   而它在外面的名字由 schema 决定。
     */
    member_model?: string;
    /** 一句话说明这条读数——"记录"与"执行"的关系。 */
    note: string;
}
/**
 * 从**任务记录**里读出它的模型绑定（缺席 = 这条任务没声明 ⇒ 走成员自己的路由）。
 *
 * ★ 读的是【任务记录】而不是【成员记录】：这正是本任务替换掉的那个框法的落点 ——
 *   归属要挂在**结果**上，而结果是任务产出的。
 */
export declare function modelBindingOf(task: {
    model?: string;
    reasoningEffort?: string;
}): {
    model: string;
    reasoningEffort?: string;
} | undefined;
/**
 * 把「绑定」与「执行那台机器实际冻住的路由」对照，交出**可审计的读数**。
 *
 * ★ 不比较就不叫查实：只把 `model` 原样回读，**证明不了**它不是"记了却没用上"。
 */
export declare function describeModelBindingPropagation(binding: {
    model: string;
    reasoningEffort?: string;
}, memberModel: string | undefined): ModelBindingPropagation;
/**
 * 这次 create 调用要把**哪一格绑定**挂到**新任务**上。
 *
 * ── ★★★ 它存在的理由：一个参数、两种用途，而它们不许混 ────────────────────────────
 *
 * `agent_teams_create_task` 的 `model` 参数有**两个**用途：
 *
 *   · 建一条新任务时 ⇒ 它是**新任务的**绑定
 *   · `bindModelTo` 改一条已存在任务的绑定时 ⇒ 它是**那条任务的**新绑定
 *
 * ★ 两者的区别在**写完之后**才看得出来（一条记录多了一格 vs 另一条记录被改了），
 *   而"分不开"的后果是具体的：一次改绑定会**顺手**给新建的那条也记上同一个模型 ——
 *   读的人看到两条任务的绑定一起变了，**归因不到是哪一次调用干的**。
 *
 * ⇒ 所以这里把它变成**显式的**：正在重新绑定时，新任务**不**继承那一格。
 *
 * @returns 要挂在新任务上的绑定；`undefined` ⇒ **这一格一个键都不写**。
 */
export declare function describeModelBindingForCreate(input: {
    model?: string;
    reasoningEffort?: string;
    rebinding: boolean;
}): {
    model: string;
    reasoningEffort?: string;
} | undefined;
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export declare function register(ctx: Context, clock: any, runtime: AgentTeamsRuntime, scheduler: any, config: ToolsConfig): void;
