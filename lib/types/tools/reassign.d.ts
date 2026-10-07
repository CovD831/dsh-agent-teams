import type { Context } from '@deepseek-ai/cordis';
import type { ToolsConfig } from './shared/entities.ts';
/** 注册本文件的工具。共享实体由调用方（装配点）注入 —— 它们不是本文件的依赖。 */
export declare function register(ctx: Context, scheduler: any, config: ToolsConfig): void;
