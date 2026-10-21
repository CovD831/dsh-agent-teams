/**
 * ── ★★★ 像素小人：24×24 的**字符画**（需求 §27.5）────────────────────────────────
 *
 * ── 为什么是字符画而不是位图 ──────────────────────────────────────────────────────
 *
 * ```
 * 位图 PNG sprite  ⇒ 体积进 lib/client.js（每个姿势几十 KB）+ 版权/来源问题
 * 字符画 + 调色板 ⇒ ★ 源码里就能读、零二进制、改一个字符就改一个像素
 * ```
 * 参照物用的是后者（`server/src/characters/cafe-character.md` 逐字：
 * 「24 strings of 24 characters: a palette letter, or . for transparent」）。
 *
 * ★★ 而它对本仓还有一个额外好处：**画对了没有可以单测** ——
 *   一个 24×24 的字符串数组，行数、列数、用到的调色板键都能断言。
 *   本机没有视觉模型，这比 PNG 强得多。
 *
 * ── 五个 `doing` 各有自己的姿势（§27.4 的纪律：五态两两不同形）──────────────────
 *
 * ```
 * working      坐姿 + 面向屏幕（手在键盘上）
 * idle         坐姿 + 双手放下（不敲）
 * not-spawned  **没有身体**（只有一圈虚线地贴）—— 它连会话都没有
 * away         椅子空着（不画小人本身，画一个灰影）
 * unknown      一个 `?` 形状（读不到，不是闲着）
 * ```
 *
 * @module dsh-agent-teams/client/room-sprite
 */
/** 一帧：24 行 × 24 字符。`.` = 透明，其余是调色板键。 */
export type SpriteRows = readonly string[];
/** 24×24 —— 参照物同款。★ 再小就画不出"眼睛"，再大就失去像素感。 */
export declare const SPRITE_GRID = 24;
/**
 * 调色板。★ 全部是**固定色**，不读宿主 token：
 * 小人是"画里的人"，它的配色属于**画面**；而宿主 token 属于**界面**。
 * ★★ 混用会让"深色主题下小人变灰" —— 那不是配色问题，是**角色的身份被界面吃了**。
 */
export declare const SPRITE_PALETTE: Readonly<Record<string, string>>;
/**
 * 把身形与姿势合成一帧。
 *
 * @param doing - `room-plan.ts` 的五态
 * @returns 24 行 × 24 字符
 * ★ 纯函数、无 DOM ⇒ 可单测（`gate-room-sprite.test.mjs`）。
 */
export declare function spriteOf(doing: 'working' | 'idle' | 'not-spawned' | 'away' | 'unknown'): SpriteRows;
