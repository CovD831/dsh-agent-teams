/**
 * ── 判据变更历史：`collection` 的 `history`（t86）────────────────────────────────
 *
 * ★ 依据 SkillClaw 的 `history/` + Raven 的"必须先读**全部**历史再决定"，逐字：
 *   > 「Raven Step 3: **Before deciding any action on an existing skill,
 *   >   read ALL files under history/. This is mandatory, not optional.**
 *   >   Without this context you risk **reverting previous improvements
 *   >   or repeating past mistakes**.」
 *
 * ⇒ 「**反复来回改**」是自进化系统里一种很常见的退化，而它防的正是那个。
 *
 * ── ★★★ 本文件是**记录**，不参与计算（这是一条要能被机械验证的性质）──────────────
 *
 * 反向半边 C 逐字要求：「删掉 history 后 **redundancy 结果不变**」。
 * ★ 而那条性质**不是靠"注意别写错"保证的** —— 它是**结构性**的：
 *   · 本文件**不被 `health.ts` import**（两者的依赖是单向的：`history → types`）；
 *   · 本文件**没有任何函数接受 `CollectionHealth` 或记录集**（它算不出 redundancy）；
 *   · 它唯一会做的事是**追加一条记录**与**读回一个列表**。
 *
 * ⇒ ★ 所以"history 参与了计算"这件事**在这份形状下写不出来**，
 *   除非有人**主动把两个模块接起来** —— 而那样 `tsc` 与夹具都会看见。
 *
 * ── ★★ 而"读全部历史再决定"必须有一个**入口**，不能只靠人记得 ─────────────────────
 *
 * `reviewBeforeChange` 就是那个入口：它**要求**调用方先拿到全部历史，
 * 并把"我读过哪些"如实返回。★ 它**不检查你有没有真的读**（那检查不了），
 * 但它让"没读"与"读了"在**调用形状上**不同形（后者必须传一个列表进来）。
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LOOP_B_SUBJECTS, canLoopAAutoChange } from "./types.js";
/**
 * ★ 判据历史：**追加**语义，`readonly` 返回。
 *
 * ★ 为什么是"追加"而不是"可改"：一条历史若可被改写，"上次为什么改"就丢了 ——
 *   而那正是它唯一的价值。⇒ 本模块**不提供** delete / update / clear。
 *   ★ 与 `types.ts` 里"不提供改判据的函数"同一条纪律：**没有那个函数**才不会腐烂。
 */
export class CollectionHistory {
    #changes = [];
    /** ★ 追加一条（**唯一**的写入口）。 */
    record(change) {
        /**
         * ★ 四格**都必须有内容**：`changed` 说不出改了什么、或 `evidence` 说不出凭什么 ——
         *   那条记录**没有价值**，而它会让历史看起来"有记录"（本仓记账过的"假账"形态）。
         *   ★ 所以在这里**当场拒**，而不是事后靠人审查。
         */
        if (change.before.trim() === '' || change.after.trim() === '') {
            throw new Error(`collection history: a change to "${change.gateId}" must record both before and after `
                + '(a record that cannot say what changed is not a record)');
        }
        if (change.evidence.trim() === '') {
            throw new Error(`collection history: a change to "${change.gateId}" must cite evidence `
                + '(a change nobody can justify later is exactly what this history exists to prevent)');
        }
        this.#changes.push({
            gateId: change.gateId,
            at: change.at,
            before: change.before,
            after: change.after,
            evidence: change.evidence,
        });
    }
    /** ★ 全部历史（**按时间升序**）—— Raven 那句"read ALL"要的就是它。 */
    all() {
        return [...this.#changes].sort((a, b) => a.at - b.at);
    }
    /** 某一条判据的历史（★ 决定"要不要再改它"时先读这份）。 */
    forGate(gateId) {
        return this.all().filter((change) => change.gateId === gateId);
    }
}
/**
 * ★★ "改之前先读全部历史"—— 本层唯一那个**入口**。
 *
 * @returns 全部历史 + 一句"这次改动属于哪个循环"的判定。
 *
 * ★ 它**不**检查人有没有真的读（检查不了），但它把**调用形状**定死：
 *   想改某条判据的人，**必须先拿到 `history` 才能拿到 `verdict`** ——
 *   而 `verdict` 会告诉他"这件事你能不能自己改"。
 */
export function reviewBeforeChange(history, subject, gateId) {
    const mayAutoChange = canLoopAAutoChange(subject);
    /**
     * ★★ 三条循环 B 的东西**一律不许自改**（规格 §3 逐字）：
     *   「collection 的四条判据本身 · 验证命令 · confidence 阈值 ⇒ ★★ 只能【提议】，不能自改」。
     */
    const loop = mayAutoChange ? 'A' : 'B';
    const relevant = gateId === undefined ? history.all() : history.forGate(gateId);
    const note = mayAutoChange
        ? `"${subject}" is loop A: an automated change may apply it directly, but only within what loop B allows.`
        : `"${subject}" is loop B (one of: ${LOOP_B_SUBJECTS.join(', ')}): an automated change may only PROPOSE it. `
            + 'If a loop could rewrite the criteria that judge its own output, it would first widen them — '
            + 'and after that every duplicate is collected again. That is the recursion this split exists to prevent.';
    return { loop, mayAutoChange, history: relevant, note };
}
/** ★ `history.jsonl` 的**唯一**路径口径（与 `signalsPathOf` 同源形状）。 */
export function historyPathOf(stateRoot) {
    return join(stateRoot, 'evolution', 'history.jsonl');
}
/**
 * ★★ 追加一条判据变更历史 —— **本模块唯一的写入口**。
 *
 * ★ 三条纪律（每条都能被夹具钉住）：
 *   ① **复用 `CollectionHistory.record` 的四格校验**，不另写一套 ——
 *      ★ 两套校验会分叉，而分叉之后"什么算一条记录"就有两个答案。
 *   ② **不抛** —— 调用方在"改判据"这条路径上（可能是一次自动改动）。
 *      ★ 把"记不了账"变成"这次改动失败"会**改变可观测的时序**（与 `appendSignal` 同纪律）。
 *   ③ **写入是原子的按行追加**（`O_APPEND`）：一行 = 一条记录，坏一行不影响其余行。
 *
 * @param stateRoot - 这个团队自己的状态根（★ 不许是进程级单值）。
 * @param change - 一条四格俱全的变更（`gateId` / `at` / `before` / `after` / `evidence`）。
 * @param write - 注入的追加函数（生产给 `fs/promises.appendFile`；夹具注入内存版）。
 */
export async function recordCollectionChange(stateRoot, change, write) {
    /** ★ 没有 stateRoot ⇒ **判不了**（不许静默丢弃：那会让"没记"与"没改"同形）。 */
    if (stateRoot === undefined || stateRoot.trim() === '') {
        return { status: 'unmeasured', why: 'history: no stateRoot was supplied, so the record has nowhere to land' };
    }
    /**
     * ★★ 复用那个**唯一的**校验器：造一个一次性历史，让它的 `record` 当场判。
     *   ⇒ 四格校验只有一处实现（`CollectionHistory.record`），这里不重复写。
     */
    try {
        new CollectionHistory().record(change);
    }
    catch (reason) {
        return {
            status: 'unmeasured',
            why: `history: the change to "${change.gateId}" was rejected before it reached disk — ${String(reason?.message ?? reason)}`,
        };
    }
    const path = historyPathOf(stateRoot);
    /** ★ 一行一条（`jsonl`）：追加是原子的，坏一行只坏那一行。 */
    const line = JSON.stringify({
        gateId: change.gateId,
        at: change.at,
        before: change.before,
        after: change.after,
        evidence: change.evidence,
    });
    try {
        await mkdir(join(stateRoot, 'evolution'), { recursive: true });
        await write(path, `${line}\n`);
        return { status: 'recorded', path, line };
    }
    catch (reason) {
        /**
         * ★★ 写不进去 = **判不了**（不是 `absent`）：这一格是**异常**，
         *   而"判据改了但历史没记上"正是本仓最贵的那类静默状态。
         */
        return {
            status: 'unmeasured',
            why: `history: could not append to "${path}" — ${String(reason?.message ?? reason)}`,
        };
    }
}
export async function readCollectionHistory(stateRoot, readFile) {
    let text;
    try {
        text = await readFile(historyPathOf(stateRoot), 'utf8');
    }
    catch {
        /** ★ 文件缺席 ⇒ `unmeasured`（"还没改过判据"与"改了没记"**不同形**）。 */
        return { status: 'unmeasured', reason: 'file-absent', history: new CollectionHistory() };
    }
    const history = new CollectionHistory();
    let skippedMalformed = 0;
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.trim() === '')
            continue;
        try {
            const parsed = JSON.parse(line);
            if (typeof parsed.gateId !== 'string' || typeof parsed.at !== 'number'
                || typeof parsed.before !== 'string' || typeof parsed.after !== 'string'
                || typeof parsed.evidence !== 'string') {
                skippedMalformed += 1;
                continue;
            }
            /** ★ 走 `record` 而不是直接 push：四格校验对**读回来的**记录同样成立。 */
            history.record({
                gateId: parsed.gateId, at: parsed.at, before: parsed.before, after: parsed.after, evidence: parsed.evidence,
            });
        }
        catch {
            skippedMalformed += 1;
        }
    }
    return {
        status: 'measured',
        history,
        ...skippedMalformed > 0 ? { skippedMalformed } : {},
        totalLines: lines.length,
    };
}
