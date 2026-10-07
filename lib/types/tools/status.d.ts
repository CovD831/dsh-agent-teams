import { AgentTeamsRuntime } from './shared/entities.ts';
/**
 * ★ t49：排队状态要能被 `status` 读到 —— 那是"captain 该不该继续派发"的唯一读数。
 *   ★ 它从 `shared/` 来（不是从 `restart.ts`）：**工具模块之间不许互相 import**
 *     （`gate-tool-split` 臂 3），而 `status.ts` 与 `restart.ts` 都是工具模块。
 *     `shared/` 正是为此存在的。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolsConfig } from './shared/entities.ts';
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export declare function register(ctx: Context, clock: any, runtime: AgentTeamsRuntime, scheduler: any, config: ToolsConfig): void;
