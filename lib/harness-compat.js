import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SubagentError } from '@deepseek-ai/dsh-subagent';
import { CAPTAIN_TOOL_NAMES } from "./tool-names.js";
/**
 * Exact protocol exported by dsh-subagent/internal in Alpha.5 and rc.1.
 * That subpath does not exist in Alpha.2, so importing it statically prevents
 * the plugin from loading there. This small adapter uses the same process-
 * stable symbol and call signature as upstream queueHostSubagentPrompt.
 * Source: packages/subagent/subagent/src/internal.ts at dsh-v0.1.2-rc.1.
 */
const hostPromptQueue = Symbol.for('dsh.subagent.queuePrompt');
// 0.1.5 keeps queueHostSubagentPrompt but replaces its symbol with this
// delivery-mode-aware implementation (packages/subagent/subagent/src/internal.ts).
const hostPromptDeliver = Symbol.for('dsh.subagent.deliverPrompt');
/**
 * Whether the running host owns member setup through managed activations.
 *
 * On those hosts the activation itself installs the child composition, so the
 * plugin's own persona/toolFilter installation is the only source of them and
 * the provider capability bits `persona`/`toolFilter` are not required (and no
 * longer advertised). On every older host this is false and the legacy checks
 * stay in force.
 */
export function usesManagedActivations(runtime) {
    return typeof runtime.startActivation === 'function';
}
/**
 * Start one member through whichever creation API the host actually exposes.
 *
 * @param runtime - the live `ctx.subagents` service.
 * @param spec - the version-independent creation request.
 * @returns the durable child id (and, on managed activations, keeps the
 *   activation's own settlement observed so a missing report or a failure
 *   still reaches the parent the way the host intends).
 */
export async function startMember(runtime, spec) {
    const host = runtime;
    if (typeof host.startActivation === 'function') {
        // persona/toolFilter are NOT activation fields on 0.2.1; they are installed
        // on the child context by installMemberSelectionRuntime.
        const { persona: _persona, toolFilter: _filter, ...request } = spec.request;
        const activation = await host.startActivation.call(runtime, { ...spec, request, delivery: 'parent' });
        // Preserve native settlement as the missing-report/error fallback on both
        // fresh and resumed activations. mailbox.ts deduplicates successful reports.
        void activation.result.catch(() => undefined);
        return activation;
    }
    if (typeof host.startContinuable !== 'function')
        return unsupported('missing member creation API');
    return host.startContinuable.call(runtime, spec);
}
/**
 * Wrap every creation API the host exposes, so one guard bounds descendant
 * creation regardless of which entry point a caller uses.
 *
 * ★ 0.2.1 adds `startActivation`; a guard that only wraps `start` and
 *   `startContinuable` would silently stop bounding anything on that host
 *   (the tool layer calls `startActivation` directly). Probing all three keys
 *   keeps the delegation budget enforced across host generations.
 * @param ctx - the plugin context (injects `subagents`).
 * @param check - called with the exact live parent before each creation.
 */
export function guardSubagentCreation(ctx, check) {
    const runtime = ctx.subagents;
    ctx.effect(() => {
        const disposers = [];
        for (const key of ['start', 'startContinuable', 'startActivation']) {
            const original = runtime[key];
            if (typeof original !== 'function')
                continue;
            const descriptor = Object.getOwnPropertyDescriptor(runtime, key);
            const guarded = async (...args) => {
                const request = key === 'start' ? args[1] : args[0].request;
                check(request.parent);
                return Reflect.apply(original, ctx.subagents, args);
            };
            Object.defineProperty(runtime, key, { value: guarded, writable: true, configurable: true });
            disposers.push(() => {
                if (Object.getOwnPropertyDescriptor(runtime, key)?.value !== guarded)
                    return;
                if (descriptor === undefined)
                    Reflect.deleteProperty(runtime, key);
                else
                    Object.defineProperty(runtime, key, descriptor);
            });
        }
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'agent-teams: member delegation budget');
}
/**
 * Targeted recursive cancellation, renamed with the unified activation manager.
 *
 * 0.2.1 renamed `drainContinuableChildren` to `drainChildren`; both mean the
 * same thing (close admission, clear queued work, await descendants) and the
 * older name is absent rather than deprecated on the newer host, so the call
 * site has to pick whichever exists.
 */
export async function drainMemberChildren(runtime, parent, ids) {
    const host = runtime;
    const drain = host.drainChildren ?? host.drainContinuableChildren;
    if (typeof drain !== 'function')
        return unsupported('missing targeted child drain');
    await drain.call(runtime, parent, ids);
}
function boundary(runtime) {
    return runtime;
}
function unsupported(detail) {
    throw new Error(`agent-teams: unsupported Harness subagent contract (${detail}); use an explicitly tested Harness version and a coherent dependency installation`);
}
/**
 * 0.1.6 moved startup admission to serial agent/created. Older created events
 * have no source and precede session-start; ignore those until the old hook.
 * Keep the removed event's type confined to this audited compatibility seam.
 */
export function onAgentReady(ctx, listener) {
    const stopCreated = ctx.on('agent/created', payload => {
        if ('source' in payload)
            listener(payload.agent, true);
        return undefined;
    });
    const legacy = ctx;
    const stopLegacy = legacy.on('agent/session-start', ({ agent }) => listener(agent, false));
    return () => { stopCreated(); stopLegacy(); };
}
/** Read child-owned history, excluding any descriptor inherited from a parent. */
/**
 * ── ★★★ Zstd 多帧遍历器（2026-10-21 从 `scripts/dispatch-shape-readout.mjs` **移进来**）──
 *
 * ── 为什么必须有一个：Node 的 `zstdDecompressSync` **静默只解第一帧** ────────────
 *
 * MEASURED（本仓真实会话，可复跑）：
 * ```
 *   node -e "zstdDecompressSync(readFileSync(p))"  ⇒ 290 字节 / 1 行
 *   zstd -dc < p | wc -l                           ⇒ 1701 行
 * ```
 * 同一个文件，**差 1700 倍**，而且**不抛错、不警告**。
 * ⇒ ★★ 一个用它写的 token 计数器会得到**看起来像真的**的错数 ——
 *   本仓记账最贵的那种形态（"读到了，但读的不是你以为的那份"）。
 *
 * ── ★ 为什么**移进来**而不是各留一份 ────────────────────────────────────────────
 *
 * `src/` 从不 import `scripts/`（那是脚本目录，不进 `lib/` 产物）。
 * 而 t4 的会话预算读数（`src/members.ts`）**必须**读会话 token。
 * ⇒ 若两处各留一份，就是本仓记账过最贵的**第二份实现**。
 *   ★ 而我为这件事**真的重复实现过一次**，并且**错了两次**：
 *     ① 按大端比较 magic（实际要用 `readUInt32LE`）⇒ 一帧都进不去
 *     ② RLE 块（type 1）的盘上长度写成 `blockType === 0 ? 1 : size`
 *        ⇒ 而正确规则就在下面那一行（`blockType === 1 ? 1 : blockSize`）
 *   ⇒ 移进来之后，`scripts/` 那份**从这里 import**，全仓只有一处。
 *
 * ── ★ 截断处理（原实现的语义，逐字保留）──────────────────────────────────────
 *
 * 会话文件可能正被写入（尾部半帧）。走到不完整的位置就**停下并记下偏移**，
 * 把已完整的帧返回 —— 读数是**下界**，由调用方标出来，而不是整个读成
 * `unmeasured`（那样会丢掉已经能读到的全部历史）。
 *
 * @param buffer - `session.v4.jsonl.zstd` 的**完整字节**。
 * @returns 每一帧的字节切片 + 截断偏移（`null` = 完整读到最后）。
 */
/** Zstd 帧魔数 —— ★ **小端**读出才是这个值（`readUInt32LE`）。
 *  ★★ 我第一版把它写成 `0x28B52FFD`（大端书写形式）⇒ 一帧都进不去。 */
const ZSTD_MAGIC = 0xfd2fb528;
export function splitZstdFrames(buffer) {
    const frames = [];
    let offset = 0;
    let truncatedAt = null;
    while (offset < buffer.length) {
        const start = offset;
        if (offset + 4 > buffer.length) {
            truncatedAt = offset;
            break;
        }
        const magic = buffer.readUInt32LE(offset);
        // ── skippable frame（0x184D2A50..0x184D2A5F）：整段跳过，不含记录
        if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
            if (offset + 8 > buffer.length) {
                truncatedAt = offset;
                break;
            }
            const next = offset + 8 + buffer.readUInt32LE(offset + 4);
            if (next > buffer.length) {
                truncatedAt = offset;
                break;
            }
            offset = next;
            continue;
        }
        if (magic !== ZSTD_MAGIC) {
            throw new Error(`未知魔数 0x${magic.toString(16)} @${offset}（多帧行走器不认这个字节）`);
        }
        let cursor = offset + 4;
        const descriptor = buffer[cursor] ?? 0;
        cursor += 1;
        const fcsFlag = descriptor >> 6;
        const singleSegment = (descriptor >> 5) & 1;
        const hasChecksum = (descriptor >> 2) & 1;
        const reservedBit = (descriptor >> 3) & 1;
        const dictFlag = descriptor & 3;
        if (reservedBit !== 0)
            throw new Error(`frame header reserved bit 非零 @${start}`);
        if (!singleSegment)
            cursor += 1;
        cursor += [0, 1, 2, 4][dictFlag] ?? 0;
        cursor += (fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag]) ?? 0;
        let sawLast = false;
        while (!sawLast) {
            if (cursor + 3 > buffer.length) {
                truncatedAt = start;
                break;
            }
            const header = (buffer[cursor] ?? 0) | ((buffer[cursor + 1] ?? 0) << 8) | ((buffer[cursor + 2] ?? 0) << 16);
            cursor += 3;
            sawLast = (header & 1) === 1;
            const blockType = (header >> 1) & 3;
            const blockSize = header >>> 3;
            // ★ RLE 块（type 1）在盘上只占 1 个字节，不是 blockSize 个字节。
            cursor += blockType === 1 ? 1 : blockSize;
        }
        if (!sawLast) {
            truncatedAt = start;
            break;
        }
        if (hasChecksum)
            cursor += 4;
        if (cursor > buffer.length) {
            truncatedAt = start;
            break;
        }
        frames.push(buffer.subarray(start, cursor));
        offset = cursor;
    }
    return { frames, truncatedAt };
}
export function sessionOwnEvents(session) {
    const current = session;
    if (typeof current.ownEvents === 'function')
        return current.ownEvents.call(session);
    const legacy = session;
    if (!Array.isArray(legacy.events))
        return unsupported('missing ownEvents/legacy session log');
    return legacy.events.slice(legacy.header.seedLength ?? 0);
}
/**
 * ── ★ 归属证据：这个成员【真的写过】哪些文件 ────────────────────────────────────
 *
 * `dsh-tool-fs` 给每次写入/编辑的 `tool/result` 挂 `meta.diffs`
 * （源码见 app.asar 内 `@deepseek-ai/dsh-tool-fs/lib/index.js`）：
 *
 *     meta.diffs: Array<{ path: string, oldText: string|null, newText: string }>
 *
 * `isFileDiff` 要求 `path: string`、`oldText` 为 null 或字符串、`newText` 为字符串；
 * `diffsFromMeta` 还要求数组非空且每一项都合法 —— 形状是实测的，不是猜的。
 *
 * ★ 为什么走【会话事件】而不是 cwd 或 git status：
 *   · START-HERE §5②：子会话 cwd 硬编码继承父会话 ⇒ 隔离不能靠 cwd；
 *   · START-HERE §5③：全队在同一目录 ⇒ git 只知道"工作区脏了"，不知道是谁改的。
 *   会话事件是**逐成员**的，所以它同时绕开这两条。
 *
 * ★ 返回 `undefined` 与 `[]` 必须不同形：
 *   · `undefined` ⇒ 没能读到事件（判据 ⇒ unmeasured）
 *   · `[]`        ⇒ 读到了，确实没有写入（判据 ⇒ 可以据此判定虚报）
 *
 * 形状不认识时返回 `undefined`（"没能测量"），**不是** `[]`（"测了是零"）——
 * 把这两件事混起来，会让一次读取失败伪装成一个关于工作的结论（契约 §3.4）。
 */
export function observedChangedPaths(session) {
    let events;
    try {
        events = sessionOwnEvents(session);
    }
    catch {
        return undefined;
    }
    if (!Array.isArray(events))
        return undefined;
    const paths = new Set();
    let sawAnyToolResult = false;
    for (const event of events) {
        const record = event;
        if (record?.type !== 'tool/result' && record?.kind !== 'tool/result')
            continue;
        sawAnyToolResult = true;
        const meta = record.meta;
        if (meta === null || typeof meta !== 'object')
            continue;
        const diffs = meta.diffs;
        if (!Array.isArray(diffs))
            continue;
        for (const diff of diffs) {
            if (diff === null || typeof diff !== 'object')
                continue;
            const path = diff.path;
            if (typeof path === 'string' && path.trim() !== '')
                paths.add(path);
        }
    }
    /**
     * ★ 一条 tool/result 都没看到 ⇒ 没能测量（不是"零改动"）。
     *   这区分了"这个成员没动过文件"与"我读不到这个成员的日志"。
     */
    if (!sawAnyToolResult)
        return undefined;
    return [...paths];
}
/**
 * ── ★★ 第二个观察面：工作区里【确实脏了】的路径（t17）─────────────────────────────
 *
 * ── 它解决的是什么问题（MEASURED，三人独立复现，含 captain 本人）─────────────────
 *
 * `observedChangedPaths` 只看得见**本 session** 的写入。而 `[]` 有两种成因，
 * 它们在返回值上**同形**：
 *
 *   (i)  写入发生在**另一个 session** —— captain 用 `cp` 并入、成员被 retire 后
 *        换人。此时改动**真实存在于工作区**，而本 session 一条写入都没有。
 *        ⇒ 诚实申报被读成"虚报" ⇒ **每一个被重派/并入的 attempt 都交不出终态**。
 *   (ii) **零工作却自报改动** —— `dispatch.changed-paths` 存在的理由。
 *
 * ⇒ 要区分它们，需要一格"别处"的证据。工作区就是那个别处：**改动真的存在**这件事，
 *   git 知道，而它**与哪个 session 写的无关**。
 *
 * ── 三态（与 `observedChangedPaths` 逐条对齐，绝不合并）────────────────────────
 *
 *   `undefined` —— 没能读工作区（不是 git 仓库 / git 跑不起来）⇒ 不参与判定
 *   `[]`        —— 读了，工作区是干净的
 *   `[paths]`   —— 读了，这些路径确实脏
 *
 * ★ 为什么 `undefined` 与 `[]` 必须不同形：前者是"我没有证据"，
 *   后者是"证据表明没有改动"。把前者当成后者，会让一次 git 故障被读成一个
 *   关于成员工作的结论 —— 而那正是本文件反复强调的那条界线。
 *
 * ★ 为什么用 `git status --porcelain` 而不是 `git diff`：
 *   新建文件（untracked）在 `diff` 里不出现，而它是最常见的一类真实改动。
 *   `--porcelain` 同时覆盖 `??`（新增）与 ` M`（修改）。
 *
 * ★ 诚实边界：git 只知道"工作区脏了"，**不知道是谁改的**（全队共用一个目录，
 *   见 START-HERE §5③）。⇒ 本函数**不能**用来判定归属，它只回答
 *   「这些路径在工作区里确实变了吗」。归属仍由会话事件回答 —— 两格合起来才完整。
 */
export function gitChangedPaths(workspace) {
    let text;
    /**
     * ★★ 前缀必须剔掉（MEASURED，t17 实测）─────────────────────────────────────────
     *
     * `git status --porcelain` 的路径是**仓库根相对**的，不是 cwd 相对的。当工作区
     * 本身就是仓库根时两者一致（最常见），但当工作区是仓库的**子目录**时，
     * 每一条都会带上那层前缀：
     *
     *     在 /repo/ws 里跑   ⇒  ` M ws/src/a.ts`
     *     而 reported 里写的是    `ws/src/a.ts` 或 `src/a.ts`（工作区相对）
     *
     * ⇒ 前缀不清掉，比较就**永远不相等** ⇒ 每一个真实改动都被判成"工作区里也没有"
     *   ⇒ 判据变成**恒红**，而它红得看起来完全正常（"你没写过这个文件"）。
     *   这正是本队记账的恒红写法，而它比恒真更危险：恒真让人看不见问题，
     *   恒红会**阻断所有诚实的工作**。
     *
     * ⇒ `git rev-parse --show-prefix` 给出"从仓库根到 cwd"的那一段（仓库根处为空串），
     *   逐条剥掉它。取不到 ⇒ 按空前缀处理（等价于"工作区就是仓库根"，最常见的情形）。
     */
    const prefix = (() => {
        try {
            return execFileSync('git', ['rev-parse', '--show-prefix'], {
                cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            }).trim();
        }
        catch {
            return '';
        }
    })();
    try {
        text = execFileSync('git', ['status', '--porcelain'], {
            cwd: workspace,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    }
    catch {
        /** 不是 git 仓库 / git 不可达 ⇒ **没能观察**（不是"工作区干净"）。 */
        return undefined;
    }
    const paths = new Set();
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trimEnd();
        if (line.trim() === '')
            continue;
        /**
         * `git status --porcelain` 的两种行形状：
         *   `XY path`          —— 普通（` M src/a.ts`）
         *   `XY old -> new`    —— 重命名（取**新**名字，它才是当前存在的那个）
         * ★ 与 `quality-gates.ts` 的 `collectChangedPaths` 同一口径：两处若分叉，
         *   "判据看到的路径"与"回测看到的路径"就会不一致，而它们在日志里同形。
         */
        const rename = /->\s+(\S+)$/u.exec(line);
        const candidate = rename?.[1] ?? line.replace(/^[ MADRCU?!]{1,2}\s+/u, '');
        const cleaned = candidate.replace(/^"|"$/gu, '').trim();
        if (cleaned === '')
            continue;
        /**
         * 剥前缀。★ 只剥**真的**是前缀的那些（`startsWith`）：一个恰好同名的文件
         * 不能被误剥 —— 那会把 `ws/src/a.ts` 削成 `src/a.ts`，而 reported 里写的
         * 也许正是 `ws/src/a.ts`（工作区相对于更外层）。两种情况各自都对，
         * 而判据只认"两边相等"，所以**两种拼法都要在场**（见下面两个 add）。
         */
        paths.add(cleaned);
        if (prefix !== '' && cleaned.startsWith(prefix))
            paths.add(cleaned.slice(prefix.length));
    }
    return [...paths];
}
/**
 * ── ★★ 成员的 worktree 也是一个工作区（t41 / f-0023）─────────────────────────────
 *
 * ── 它修的是什么（今天拦了成员 4 次，含本任务作者本人）──────────────────────────
 *
 * {@link gitChangedPaths} 的入参是**队长的**工作区（`workspaceOf(captain)`）。
 * 而被派发了 worktree 的成员在**自己的检出目录**里干活 —— 那是另一棵树：
 *
 *     /repo                        ← 判据看的（队长的工作区）
 *     /repo/.agent-teams/worktrees/task-t41   ← 成员真正改的地方
 *
 * ⇒ 成员改了 worktree 里的文件、如实申报，判据两个观察面**都**看不到它：
 *
 *     `observedChangedPaths`  只看得见本 session 的写入（换过会话就没有）
 *     `gitChangedPaths`       问的是队长那棵树，那里确实没脏
 *
 * ⇒ 于是诚实的申报被判成虚报。原文（今天 4 次实例逐字相同）：
 *   `… reported as changed but no write to it was observed … and it is not a
 *    changed path in the working tree either`
 *
 * ── ★★ 为什么它比一般的缺陷更贵：成员**拿不到任何合法输入**──────────────────────
 *
 *     · 填真实路径（worktree 里真的改了）  ⇒ 被本条判据拒
 *     · 填空数组                          ⇒ 被 completion 门拒（r5/mutation：
 *                                            "no changed files, nothing to mutate"）
 *
 * ⇒ 两条判据**各自都对**，合起来**没有任何合法输入**（t32 上实测的双向死锁）。
 *   而它的代价是：每一次都要人手工并入 —— 那正是"无人值守"要消灭的形态。
 *
 * ── ★ 修法的选择：让观察面**对上**，而不是放宽判定 ────────────────────────────
 *
 * 可能的三条路（任务书列的）：
 *   ① 把该成员 worktree 的写入算进观察面   ② 观察面同时接受 worktree diff
 *   ③ 把两种拒绝的成因分开说
 *
 * ★ 选了 **①+②**（它们是同一件事：判据要问**成员实际在哪个树里干活**），
 *   并把 ③ 一起做了 —— 因为"没能观察"与"任何工作区里都没有"是两种事实，
 *   而它们现在共用一句话。
 *
 * ★★ 而**不选**"放宽判定"（例如"只要 worktree 存在就放行"）：那会让
 *   "零工作却自报改动"变得可接受，而那是本判据存在的**全部理由**。
 *   本函数只做一件事：**把该看的那些树都看一遍**，判定规则一个字不改。
 *
 * ── 三态与 {@link gitChangedPaths} 逐条对齐（绝不合并）──────────────────────────
 *
 *   `undefined` —— 连主工作区都读不到（不是 git 仓库 / git 不可达）⇒ 不参与判定
 *   `[...]`     —— 读了：主工作区 + 每一个能读到的 worktree 的脏路径**并集**
 *
 * ★ 为什么 worktree 读不到时**不**把整格置为 `undefined`：主工作区那一份仍然
 *   是**有效的观察**（"这些路径在主树里脏了"这句话依然成立）。把它整格作废会让
 *   一条本来能核实许多路径的证据变成"没有证据" —— 那是**把观察丢掉**，
 *   与"把没测到并进通过"是同一个方向上的错。
 *   ★ 而读不到的 worktree 不产生任何路径：它只意味着"那一棵树没被算进来"，
 *     于是判定退回"主树 + 会话事件"。**不是放宽** —— 少一格证据只会让判定更严。
 *
 * ★★ 归属仍然不由 git 回答（与 `gitChangedPaths` 的诚实边界一致）：本函数说
 *   「这些路径**在某一棵树里**确实脏了」，**不说**是谁改的。归属仍由会话事件回答。
 *   两格合起来才完整 —— 而这里补的正是"另一棵树也可以作证"。
 */
export function workspaceAndWorktreeChangedPaths(workspace) {
    const observed = observeWorkspaces(workspace);
    return observed === undefined ? undefined : observed.paths;
}
/** 主干引用的候选，按顺序取第一个读得到的。★ 本地优先于远端追踪。 */
const TRUNK_REFS = ['main', 'origin/main', 'master', 'origin/master'];
/** 在某个目录里跑一条 git 命令；失败 ⇒ `undefined`（**不是**空串）。 */
function gitOut(cwd, args) {
    try {
        return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    }
    catch {
        return undefined;
    }
}
/**
 * 读一个工作区的基线是否落后于主干。
 *
 * @param workspace - 那个**检出目录**（worktree 或主工作区都适用）。
 *   ★ 主工作区传进来是正常的：它相对主干也可能落后（少见，但口径一致）。
 * @returns 三态读数。★ 每个取值自带它需要的字段，调用方不必再问一次 git。
 */
export function worktreeBaselineFreshness(workspace) {
    const head = gitOut(workspace, ['rev-parse', 'HEAD']);
    if (head === undefined) {
        return {
            status: 'undecidable',
            reason: `HEAD could not be read in ${workspace} (not a git repository, or no commit yet)`,
        };
    }
    /**
     * ★ 主干尖端：逐个候选试。
     *   ★ 一个都读不到 ⇒ **undecidable**，而不是"是最新的" ——
     *     没有主干就**无从比较**，而"无从比较"与"比过了、一样"是两件事。
     */
    let trunk;
    for (const ref of TRUNK_REFS) {
        const resolved = gitOut(workspace, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
        if (resolved !== undefined) {
            trunk = resolved;
            break;
        }
    }
    if (trunk === undefined) {
        return {
            status: 'undecidable',
            reason: `no trunk reference (${TRUNK_REFS.join(' / ')}) could be resolved in ${workspace}, `
                + 'so how far this checkout is behind could not be measured',
        };
    }
    /**
     * ★ 落后数 = **主干有而我没有**的提交数（`HEAD..main`）。
     *   ★ 只要计数：路径列表属于"哪些文件变了"，而那是**观察面**的问题，不是这一格的。
     *   ★ 而它因此**不含**"我自己提交了什么" —— 两个量必须分开（臂 6）。
     */
    const counted = gitOut(workspace, ['rev-list', '--count', `HEAD..${trunk}`]);
    const behind = counted === undefined ? undefined : Number.parseInt(counted, 10);
    if (behind === undefined || !Number.isSafeInteger(behind) || behind < 0) {
        return { status: 'undecidable', reason: `the commit distance to the trunk could not be counted in ${workspace}` };
    }
    return behind === 0
        ? { status: 'current', behind: 0, trunk, head }
        : { status: 'behind', behind, trunk, head };
}
/**
 * 把那个读数说成一句人话。
 *
 * ★ 而它必须说清【后果】，不只说数字：
 *   "落后 3 个提交"仍然要人去猜这意味着什么 —— 而后果是具体的
 *   （**你会读到已经不存在的缺口**，t72/t70 各撞一次）。
 */
export function describeBaselineFreshness(freshness) {
    if (freshness.status === 'current') {
        return 'this checkout is at the trunk tip, so the failures it reports are the failures that exist';
    }
    if (freshness.status === 'behind') {
        return `this checkout is ${freshness.behind} commit(s) BEHIND the trunk (${freshness.trunk.slice(0, 12)}…), `
            + `at ${freshness.head.slice(0, 12)}… — fixes made after it was cut are NOT here, so some of what it reports `
            + 'may already have been fixed (t72 read 28 reds where the trunk had 4; t70 reported a gap that was already closed); '
            + 're-cut from the trunk, or merge it, before trusting what this checkout says is broken';
    }
    return `whether this checkout is behind the trunk could NOT be determined (${freshness.reason}) — `
        + 'that is "not measured", not "up to date"';
}
/**
 * ── ★★★ 观察面 + **它到底看了几棵树**（t59 / j-0007）──────────────────────────────
 *
 * ── 它修的是什么失效 ──────────────────────────────────────────────────────────
 *
 * MEASURED（t59，本任务）：`dispatch.changed-paths` 的拒绝信息里写着
 *
 *     「… not in any of the [N] workspace(s) that were checked
 *        (the main workspace and every member worktree under it)」
 *
 * ★ 而那个 N 读的是 `ctx?.observedWorkspaces ?? 1` —— 而 `observedWorkspaces`
 *   **从来没有被任何地方赋过值**（全仓 grep：只有声明与读取，零个赋值点）。
 *   ⇒ 它恒为 `undefined` ⇒ `?? 1` 恒取 1。
 *
 * ⇒ ★ 于是那句话里，**数字是兜底值、名词是空头承诺**：
 *     · `1` 是一个**兜底值伪装成读数**（读起来像"算出来是 1"）
 *     · "every member worktree under it" 在当时还【没有调用方】——
 *       本函数的前身只在夹具里被调用过（见 t59 的因果链）
 *
 * ★★ 而这不只是措辞问题：**一个没有调用方的扫描，与没有扫描在观测上完全相同。**
 *
 * ── 修法：把"看了几棵树"变成【读数】，而不是【兜底】────────────────────────────
 *
 * 本函数把两条事实一起交出来：
 *
 *     paths       —— 并集（与从前逐字相同，**判定规则一个字不改**）
 *     workspaces  —— ★ **实际读到了**的工作区数（主工作区 + 每棵读到的 worktree）
 *
 * ★ 三态（与判据那一格逐条对齐，且**三者不同形**）：
 *
 *     ① `undefined`                    —— 连主工作区都读不到（不是 git 仓库 / git 不可达）
 *                                          ⇒ "没能观察"，判据那一格不参与判定
 *     ② `{ paths, workspaces: 1 }`     —— 读了：只有主工作区（没有 worktree，或全读不到）
 *     ③ `{ paths, workspaces: N>1 }`   —— 读了：主工作区 + N-1 棵读到的 worktree
 *
 * ★ 而 ② 与 ① **必须不同形**（它们的补救动作不同）：
 *     ① 的补救是"去把 git 接上 / 换个能读的工作区"
 *     ② 的补救是"读到了、确实只有一棵树" —— 那是**结论**，不是**失败**
 *   把两者合成一个 `?? 1`，正是本任务要消灭的那件事。
 *
 * ── ★★ 及物性：读不到的 worktree【不算进"检查过"】──────────────────────────────
 *
 * 与下面那个 `continue` 同一口径（它本来就"没被算进来"）。⇒ 于是 `workspaces`
 * 与 `paths` **出自同一次遍历、同一组事实** —— 而不是各算各的。
 * ★ 这一点是刻意的：两个来自不同遍历的计数会分叉，而分叉之后
 *   "扫了 5 棵"与"5 棵里只有 1 棵读到了"在读数上同形。
 * ★ 而"读不到"本身不失真：`memberWorktreesOf` 列出了目录里**存在**的 worktree，
 *   而 `workspaces` 数的是**真的读出了内容**的那些（`continue` 掉的不计）。
 */
export function observeWorkspaces(workspace) {
    const main = gitChangedPaths(workspace);
    /** ★ 主工作区读不到 ⇒ 整格没能观察（与 `gitChangedPaths` 同一三态，不另发明）。 */
    if (main === undefined)
        return undefined;
    const paths = new Set(main);
    /** ★ 主工作区那一棵已经读到了 —— 所以从 1 起算，而不是从 0。 */
    let workspaces = 1;
    for (const worktree of memberWorktreesOf(workspace)) {
        const dirty = gitChangedPaths(worktree);
        /** ★ 某一棵 worktree 读不到 ⇒ 它只是**没被算进来**（见上面注释），不是整格作废。 */
        if (dirty === undefined)
            continue;
        /** ★ 而且它**不算进"检查过"** —— 与上面那行 continue 同一口径。 */
        workspaces += 1;
        for (const path of dirty)
            paths.add(path);
    }
    return { paths: [...paths], workspaces };
}
/**
 * 一个工作区底下**有哪些成员 worktree**（`.agent-teams/worktrees/<task-id>`）。
 *
 * ── ★ 为什么在**这里**发现它们，而不是让调用方传进来 ────────────────────────────
 *
 * 调用方（`src/tools.ts`）只有队长的 `workspace` 与一个 `taskId`。它**知道**
 * 当前任务的 worktree 在哪（`worktreeBaseOf`），但判据要回答的问题比那更宽：
 *
 *     「这些路径在**任何**成员干过活的地方脏了吗」
 *
 * ★ 一个只问"**这个**任务的 worktree"的修法，会把"上周期的 worktree 里改过、
 *   本周期并入前又申报一次"判成虚报 —— 而那与 f-0023 是**同一个形态**，
 *   只是换了一个任务 id。⇒ 扫目录让观察面**统一**，与是哪个任务无关。
 *
 * ── ★ 为什么按目录扫而不是查询 git 的 worktree 列表 ──────────────────────────────
 *
 * 这些 worktree 是**独立的检出**（不是 `git worktree add` 的链接工作树）：
 * 每一个都有自己的 `.git`，所以 `git worktree list` 在主库里**看不到**它们。
 * ⇒ 只能按目录发现。目录不存在 ⇒ 返回空数组（**不是** `undefined`：
 *   "这里没有成员 worktree"是一个**观察到的结论**，不是"没能观察"）。
 *
 * ★ 排序是刻意的：让并集在输入相同时逐字可复现（否则同一份事实两次运行
 *   可能产出不同排列，而"排列不同"与"结论不同"在断言层面同形）。
 */
function memberWorktreesOf(workspace) {
    const root = join(workspace, '.agent-teams', 'worktrees');
    try {
        return readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(root, entry.name))
            .sort();
    }
    catch {
        /** 目录不存在 / 读不到 ⇒ **没有成员 worktree**（观察到了"这里没有"）。 */
        return [];
    }
}
/** Install before the first request, including cold resume, with HMR cleanup. */
export function installContinuableMemberSetup(ctx, setup) {
    const runtime = boundary(ctx.subagents);
    if (typeof runtime.registerContinuableSetup === 'function') {
        // Upstream owns this registration with this.ctx.effect. Cordis resolves
        // that ctx to the accessing plugin, so its disposal revokes installations
        // even while the subagents service and child Agents remain live.
        runtime.registerContinuableSetup.call(ctx.subagents, (childCtx) => {
            if (childCtx.agent === undefined)
                return unsupported('legacy setup lacks child Agent');
            return setup(childCtx, childCtx.agent);
        });
        return;
    }
    if ((typeof runtime[hostPromptQueue] !== 'function' && typeof runtime[hostPromptDeliver] !== 'function') || typeof runtime.sendMessage !== 'function') {
        return unsupported('missing continuable setup and modern host queue');
    }
    const installed = new WeakSet();
    const active = new Set();
    ctx.effect(() => {
        const attach = (agent, vetoable) => {
            if (installed.has(agent))
                return;
            // Deliberately synchronous: awaiting here loses the first-request race.
            let teardown;
            try {
                teardown = setup(agent.ctx, agent);
            }
            catch (error) {
                if (vetoable)
                    throw error;
                // session-start is a notification: Harness logs a thrown listener and
                // still admits the first prompt. Reject request assembly explicitly so
                // a malformed saved route cannot silently execute on a default model.
                const failure = new Error(`agent-teams: member initialization failed: ${String(error)}`, { cause: error });
                ctx.logger.warn(failure.message);
                teardown = agent.ctx.on('agent/request', () => { throw failure; });
            }
            installed.add(agent);
            let disposed = false;
            const dispose = () => {
                if (disposed)
                    return;
                disposed = true;
                active.delete(dispose);
                installed.delete(agent);
                teardown();
            };
            active.add(dispose);
            // Listeners contributed to agent.ctx already follow its lifetime. Also
            // release our bookkeeping and remove them if this plugin is reloaded.
            try {
                agent.ctx.effect(() => dispose, 'agent-teams: child compatibility setup');
            }
            catch (error) {
                dispose();
                throw error;
            }
        };
        const stop = onAgentReady(ctx, attach);
        const cleanup = () => {
            stop();
            for (const dispose of [...active])
                dispose();
        };
        try {
            /**
             * ★★ 热重载会**丢掉上一份插件装的 child setup，但 Agent 还活着**。
             *   而 0.2.1 起宿主不再把 persona/toolFilter 持久化进 descriptor
             *   ⇒ 只订阅事件的话，重载之后那些已经存在的成员**永远**不会重装 setup
             *     （它们不再触发 agent/created），于是成员以"无角色、无工具限制"的状态
             *     继续跑 —— 那正是上游 0.1.24 记录的那条回归。
             * ⇒ 先订阅、再把**当前活着的** Agent 补一遍；attach 是幂等的（WeakSet）。
             */
            for (const agent of ctx.agents.list())
                attach(agent, false);
        }
        catch (error) {
            cleanup();
            throw error;
        }
        return cleanup;
    }, 'agent-teams: member lifecycle compatibility');
}
/** Queue a distinct host-authored turn; never substitute model-message steer. */
export async function queueMemberPrompt(runtime, parent, childId, content, signal) {
    const host = boundary(runtime);
    const source = { kind: 'agent-teams' };
    if (typeof host.followup === 'function') {
        return host.followup.call(runtime, parent, childId, content, { source, signal });
    }
    const deliver = host[hostPromptDeliver];
    if (typeof deliver === 'function')
        return deliver.call(runtime, parent, childId, content, source, signal, 'queue');
    const queue = host[hostPromptQueue];
    if (typeof queue !== 'function')
        return unsupported('missing host FIFO delivery');
    return queue.call(runtime, parent, childId, content, source, signal);
}
/** Coordination joins the nearest step, including waking an idle/cold child. */
export async function steerMemberPrompt(runtime, parent, childId, content, signal, live) {
    const host = boundary(runtime);
    const source = { kind: 'agent-teams' };
    const deliver = host[hostPromptDeliver];
    if (typeof deliver === 'function')
        return deliver.call(runtime, parent, childId, content, source, signal, 'steer');
    if (typeof host.sendMessage === 'function')
        return host.sendMessage.call(runtime, parent, childId, content, { signal });
    if (typeof host.followup === 'function') {
        if (live === undefined)
            return queueMemberPrompt(runtime, parent, childId, content, signal);
        if (live.id !== childId || live.session.header.parentSession !== parent.id)
            throw new Error('invalid member steering authority');
        signal.throwIfAborted();
        const message = createUserMessage({ content, source });
        live.steer(message);
        return message.id;
    }
    return unsupported('missing step-boundary message delivery');
}
/** Guard all resumable delivery paths, preserving the native service receiver. */
export function guardSubagentDelivery(ctx, isRetired) {
    const runtime = ctx.subagents;
    const host = boundary(runtime);
    const legacy = host.followup;
    const queue = host[hostPromptQueue];
    const deliver = host[hostPromptDeliver];
    const send = host.sendMessage;
    if (typeof legacy !== 'function' && ((typeof queue !== 'function' && typeof deliver !== 'function') || typeof send !== 'function')) {
        return unsupported('cannot install complete retired-member guard');
    }
    ctx.effect(() => {
        const descriptors = new Map([
            ['followup', Object.getOwnPropertyDescriptor(host, 'followup')],
            [hostPromptQueue, Object.getOwnPropertyDescriptor(host, hostPromptQueue)],
            [hostPromptDeliver, Object.getOwnPropertyDescriptor(host, hostPromptDeliver)],
            ['sendMessage', Object.getOwnPropertyDescriptor(host, 'sendMessage')],
        ]);
        let active = true;
        const check = async (sender, targetId) => {
            if (active && await isRetired(sender, targetId)) {
                throw new SubagentError(`AgentTeams member "${targetId}" was retired and cannot be resumed`, 'NOT_RESUMABLE');
            }
        };
        const guardedLegacy = async (parent, childId, content, options) => {
            await check(parent, childId);
            return legacy.call(runtime, parent, childId, content, options);
        };
        const guardedQueue = async (parent, childId, content, source, signal) => {
            await check(parent, childId);
            return queue.call(runtime, parent, childId, content, source, signal);
        };
        const guardedSend = async (sender, targetId, content, options) => {
            await check(sender, targetId);
            return send.call(runtime, sender, targetId, content, options);
        };
        const guardedDeliver = async (parent, childId, content, source, signal, delivery) => {
            await check(parent, childId);
            return deliver.call(runtime, parent, childId, content, source, signal, delivery);
        };
        if (typeof legacy === 'function')
            host.followup = guardedLegacy;
        if (typeof queue === 'function')
            host[hostPromptQueue] = guardedQueue;
        if (typeof deliver === 'function')
            host[hostPromptDeliver] = guardedDeliver;
        if (typeof send === 'function')
            host.sendMessage = guardedSend;
        // Cordis wraps method reads in fresh Proxies. Compare the actual own
        // descriptor to restore only our contribution, including prototype methods.
        const restore = (key, installed) => {
            if (Object.getOwnPropertyDescriptor(host, key)?.value !== installed)
                return;
            const original = descriptors.get(key);
            if (original === undefined)
                Reflect.deleteProperty(host, key);
            else
                Object.defineProperty(host, key, original);
        };
        return () => {
            active = false;
            if (typeof legacy === 'function')
                restore('followup', guardedLegacy);
            if (typeof queue === 'function')
                restore(hostPromptQueue, guardedQueue);
            if (typeof deliver === 'function')
                restore(hostPromptDeliver, guardedDeliver);
            if (typeof send === 'function')
                restore('sendMessage', guardedSend);
        };
    }, 'agent-teams: retired member guard');
}
/**
 * Names the host's `tools.restrict()` would admit for this agent's layer
 * chain, or undefined when the host does not expose its registry view.
 * restrict() rejects unknown names with a hard error, so the spawn path must
 * check entries against this view before forwarding them. Source:
 * dsh-tools view()/restrict() in 0.1.5-rc.1; older Harness generations lack
 * the surface and keep the verbatim list.
 */
export function restrictableToolNames(agent) {
    const tools = agent?.ctx?.tools;
    if (typeof tools?.view !== 'function')
        return undefined;
    try {
        const names = tools.view.call(tools, agent.ctx)?.restrictableNames;
        return names instanceof Set ? names : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Member `toolFilter` for one spawn. Captain-only names are registered by
 * this plugin itself and always resolvable; the depth-related entries name
 * HOST tools and are only known under some compositions, so they must be
 * resolved against the running host's registry: the delegation tool name is
 * host configuration (dsh-tool-subagent `toolName`, default `subagent`,
 * renamed per composition, e.g. `subagent_fork` in web-style profiles), and
 * forwarding a name the host dropped aborts every member spawn (#163, #164).
 * Depth enforcement itself does not depend on these names —
 * installMemberDelegationGuard bounds descendant creation by parent chain.
 */
export function memberToolFilter(maxDepth, knownTools) {
    const depthDeny = maxDepth === 0 ? ['subagent', 'send_message'] : [];
    return {
        deny: [
            ...CAPTAIN_TOOL_NAMES,
            ...(knownTools === undefined ? depthDeny : depthDeny.filter(name => knownTools.has(name))),
        ],
    };
}
/**
 * Names a `tools.restrict()` rejection reported as unknown, or an empty list
 * for every other failure. The host names the offenders verbatim
 * (`tools.restrict() names unknown global tool "x"; known global tools: …`);
 * only that report may relax a filter (#164, #166).
 */
function unknownToolNames(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('unknown global tool'))
        return [];
    return [...message.matchAll(/"([^"]+)"/g)].map(match => match[1]);
}
/**
 * Start one member, dropping any filter name the host reports as unknown and
 * retrying.
 *
 * Resolving the filter against the registry view ({@link memberToolFilter})
 * only covers hosts that expose one. A rejected filter still leaves the member
 * without a session for the lifetime of the team, so the start must survive the
 * cases that resolution cannot see — no registry view, a name that is known but
 * not restrictable, a composition that mounted differently than expected. The
 * host names the offenders in its rejection, so they are removed and the start
 * retried; the retry only runs while the deny list strictly shrinks, and any
 * failure that is not an unknown-name report propagates untouched.
 * @param start - performs one start attempt for the given `toolFilter`.
 * @param filter - the filter to attempt first.
 * @returns the started member.
 */
export async function startMemberWithLenientFilter(start, filter) {
    let deny = [...filter.deny];
    for (;;) {
        try {
            return await start({ deny });
        }
        catch (error) {
            const unknown = unknownToolNames(error);
            const remaining = deny.filter(name => !unknown.includes(name));
            if (unknown.length === 0 || remaining.length === deny.length)
                throw error;
            deny = remaining;
        }
    }
}
