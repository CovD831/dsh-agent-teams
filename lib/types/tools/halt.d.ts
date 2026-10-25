import type { Context } from '@deepseek-ai/cordis';
import type { ToolsConfig } from './shared/entities.ts';
/**
 * ★★ 为什么本文件 `import { haltTeamWork } from '../tools.ts'` 而不是把它搬进来：
 *
 * 那是**唯一**一份实现，而它已经被两条生产路径调用（Web 路由 + 生命周期夹具）。
 * 搬进来会让"停下"这件事有两份判据 —— 而两份判据必然分叉，
 * 分叉之后"界面能停而模型停不了"或反过来，会成为一个更难查的不一致。
 * ★ 与 `src/tools/status.ts` 的 `NOT_EVALUATED_IN_STATUS` 同一条纪律的反面用法：
 *   **可以共享的，就该共享**；只有"这是某个调用点自己的知识"才该各写一份。
 */
/** 注册本文件的工具。 */
export declare function register(ctx: Context, config: ToolsConfig): void;
