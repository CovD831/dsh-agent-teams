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
/** 24×24 —— 参照物同款。★ 再小就画不出"眼睛"，再大就失去像素感。 */
export const SPRITE_GRID = 24;
/**
 * 调色板。★ 全部是**固定色**，不读宿主 token：
 * 小人是"画里的人"，它的配色属于**画面**；而宿主 token 属于**界面**。
 * ★★ 混用会让"深色主题下小人变灰" —— 那不是配色问题，是**角色的身份被界面吃了**。
 */
export const SPRITE_PALETTE = {
    k: '#141018', // 轮廓（★ 不是纯黑：纯黑在深底上会"看不见边"）
    s: '#e8b98a', // 皮肤
    S: '#c9975f', // 皮肤暗部
    h: '#2f2a3a', // 头发
    c: '#4a6fa5', // 衣服主色
    C: '#345079', // 衣服暗部
    w: '#e8e6ef', // 眼白/高光
    e: '#1a1622', // 瞳孔
    a: '#f2b134', // 强调（领口/工牌）
};
/**
 * 坐姿（`working` 与 `idle` 共用身形，差别在**手** —— 见 `poseOf`）。
 *
 * ★ 画法取自参照物的三条规则（`cafe-character.md` 逐字）：
 *   「head about half the height, a small body, short legs」
 *   「Outline the whole silhouette with one dark colour」
 *   「Eyes are at least 2 × 2 pixels with a pupil, so the face reads」
 */
const SEATED_BODY = [
    '........................',
    '........................',
    '........kkkkkkkk........',
    '.......khhhhhhhhk.......',
    '......khhhhhhhhhhk......',
    '......khsssssssshk......',
    '......khsssssssshk......',
    '......ksweeseewsk.......',
    '......ksseeseessk.......',
    '.......kssssssssk.......',
    '........ksSSSSsk........',
    '........kkaaaakk........',
    '.......kcccccccck.......',
    '......kcccCCCCccck......',
    '......kcccCCCCcck.......',
    '......kcccCCCCcck.......',
    '......kkssCCCCssk.......',
    '.......kkcccccckk.......',
    '........kcccccck........',
    '........kCCCccCk........',
    '........kCCkkCCk........',
    '........kkkkkkkk........',
    '........................',
    '........................',
];
/** 双手放在键盘上（`working`）。★ 与 `idle` 的差别**只有这两行** —— 但那正是"在敲"与"坐着"的区别。 */
const TYPING_HANDS = [
    '.....kk..kkkkkk..kk.....',
    '.....kk..kkkkkk..kk.....',
];
/** 站姿（`not-spawned` 用：一个人还没上岗，是**站着**的空位，不是坐着的）。 */
const STANDING_BODY = [
    ...SEATED_BODY.slice(0, 17),
    '........kcccccck........',
    '........kCCCccCk........',
    '........kCCkkCCk........',
    '........kCkkkkCk........',
    '........kk....kk........',
    '........................',
    '........................',
];
/**
 * 把身形与姿势合成一帧。
 *
 * @param doing - `room-plan.ts` 的五态
 * @returns 24 行 × 24 字符
 * ★ 纯函数、无 DOM ⇒ 可单测（`gate-room-sprite.test.mjs`）。
 */
export function spriteOf(doing) {
    if (doing === 'not-spawned')
        return STANDING_BODY;
    if (doing === 'working') {
        /**
         * ★ 手覆盖在身体上半段（第 17–18 行）。
         * ★★ 用 `map` 而不是 `rows[17] = …` —— `SEATED_BODY` 是 `readonly string[]`，
         *   下标赋值会被类型拒（那是对的：共享的帧不该被改）。`map` 产出一份新的。
         */
        return SEATED_BODY.map((row, index) => {
            if (index === 17)
                return TYPING_HANDS[0];
            if (index === 18)
                return TYPING_HANDS[1];
            return row;
        });
    }
    if (doing === 'idle')
        return SEATED_BODY;
    if (doing === 'away')
        return SEATED_BODY.map(() => '.'.repeat(SPRITE_GRID));
    /** ★ `unknown`：一个 `?` —— **读不到**必须看得出来，而它不该长得像任何一个人。 */
    return [
        '........................',
        '........................',
        '........kkkkkkkk........',
        '.......k????????k.......',
        '......k??????????k......',
        '......k???kkkk???k......',
        '......k??kk..kk??k......',
        '......k??kk..kk??k......',
        '......k????..kk??k......',
        '......k????.kkk??k......',
        '.......k???kkk??k.......',
        '........kk????kk........',
        '........k??kk??k........',
        '........k??kk??k........',
        '........kk????kk........',
        '........kkkkkkkk........',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
    ];
}
