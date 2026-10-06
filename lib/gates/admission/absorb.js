/**
 * ── 判据：主会话【声称吸收了审查意见】必须伴随真实痕迹 ──────────────────────────
 *
 * 插入点：`admission`（成团【之前】：这份需求 / 计划够不够格进场）
 *
 * ── 它防的是什么失效 ──────────────────────────────────────────────────────────
 *
 * 用户对这一段的形态要求是原话：**「★ 不把子代理的话原样给用户看」** ——
 * 主会话要自己判断采纳哪些、不采纳哪些。但"模型自主判断"不等于"可以不发生"：
 *
 *     子代理审完 → 主会话回一句"我吸收了" → 产物一个字没动 → 成团
 *     子代理审完 → 主会话真的改了三处       → 成团
 *
 * 这两条路径在**任何现有判据**下都完全同形：产物都在，循环都"走完了"，
 * 而前者是一次空操作 —— 审查的开销付了，采纳一步没做。
 *
 * ⇒ 本判据把「我吸收了」这句**自报**，与「文档真的变了 / 明确记了无需改」这个
 *   **真实痕迹**对起来。一个空操作必须与真的吸收不同形。
 *
 * ── ★ 与 `dispatch.changed-paths` 同构（同一个病，换了观察对象）───────────────
 *
 *     dispatch.changed-paths（已有）   本判据（新）
 *     ─────────────────────────────   ────────────────────────────────────────
 *     自报：`update.changedPaths`      自报：`absorb.claims`（"已吸收"）
 *     真相：会话事件里观察到的写入     真相：一次【真的去看过】的文件读取
 *     对象：**代码**（源文件）         对象：**文档**（需求 / 计划产物）
 *     缺陷：虚报 / 隐瞒改动            缺陷：声称吸收而产物没动
 *
 * ★ 两者**不重复**，也**不许合成一条**：一个成员可以真的改了代码却对需求文档
 *   一行未动（那正是"审查意见没进产物"），也可以真的动了文档却没改代码。
 *   把两类痕迹合成一条判据，会让"代码没改"与"需求没吸收"在日志里同形。
 *
 * ── ★ 三条不可协商的性质 ──────────────────────────────────────────────────────
 *
 * ① 纯数据变换：本文件不 import 任何 I/O。调用方把【观察到的事实】传进来；
 *    缺席时返回 `unmeasured`（★ 不是 `ok`）—— 没能观察就不能声称它吸收了。
 * ② 不调用别的判据（契约 §2）。
 * ③ 三态：ok / blocked / unmeasured，且后两者不同形（见下面的分支）。
 *
 * ── ★ 观察分成两格，而它们【不同形】（本判据最容易写错的那一处）───────────────
 *
 *     `observedDocumentChanged`  —— 这个主会话的会话事件里，**产物文档**被写入过吗
 *     `documentsRead`            —— 这次被**真的读过**的产物：path → 内容快照
 *
 * 为什么不是一格"读过的文件们"：本判据要回答的是两个**不同**的问题 ——
 *
 *     (a)「产物动过吗」   —— 这是**属主**问题（谁改的、改的是不是产物）
 *     (b)「吸收当时产物长什么样」—— 这是**因果**问题（结论是不是从这一份读出来的）
 *
 * 一个"写入过就 ok"的算法（只有 (a)）是可被绕开的：主会话随便加一行字就过了。
 * 所以在 (a) 成立之后再加一道 (b)：**写入必须接在一次真的读过该产物的后面**，
 * 且**吸收当时读到的内容**必须与**产物当前的内容**不同。
 *
 * ★ 这一半的措辞里没有"审查"两个字，是刻意的：本判据只依赖"读到了什么"这一件
 *   可观察的事实，不依赖"外面有没有真的开过一次对抗性审查"。判"审查发生过"
 *   是 `admission.checkpoint` 那一格的事（`parentRevision` 与版本比较都在它那里）。
 *   两条判据观察的是不同的东西 —— 本判据的输入里**没有**任何版本号。
 *
 * ★★ 而"读到了什么"为什么必须由**调用方**注入：
 *
 *   一个判据若自己去读文件，它就有了 I/O；更坏的是，**"吸收当时读到的内容"与
 *   "产物现在的样子"会由同一次读产生** —— 于是两者恒等，整条判据恒真。
 *   ⇒ 读盘的那一次必须发生在**吸收那一刻**（调用方），之后的那一次取产物当前
 *     状态。两次读取分属两个时刻，比较才有分辨力。
 */
import { blocked, unmeasured } from "../registry.js";
import { normalizeWorkspacePath } from "../../quality-gates.js";
export const id = 'admission.absorb';
export const point = 'admission';
export const description = '把主会话自报的「已吸收审查意见」与真实痕迹比对：产物必须真的变了，或明确记下「无需改」；只声称却一行未动即拒绝';
/**
 * ── ★ 输入面声明（B 层，编译期）────────────────────────────────────────────────
 *
 * ★ 与 `dispatch.changed-paths` 的同一条纪律：这里声明的**不是"ctx 上有个字段"**，
 *   而是"**有人真的去看过**"。三格都是【调用方注入的观察】（产物当前内容 / 该返回
 *   那份文档改过没有 / 吸收时读过什么），没有一格能由 ctx 自己长出来。
 *
 * ★ 为什么没有 `documents`（"这次要审哪几份产物"）：这个判断要读**仓库里的文件**
 *   （`docs/REQUIREMENTS.md` 之类）—— 那是 I/O，判据不做（性质 ①）。产物表也是
 *   调用方交进来的一部分事实。
 *
 * ★ 为什么 `absorb`（闸门格）**不进** requires：它缺席时 `appliesTo` 为假 ⇒ 注册表
 *   直接跳过这条判据（`status: 'skipped'`），`gate()` 根本不会被调用。把它写进
 *   requires 会让每一次"没有吸收声明"的派发都产出一份缺格清单 —— 而噪音会教人
 *   忽略门禁（requires.ts 的闸门那一节）。
 *
 *   ★ t12：`task.kind` 曾经也被写在这里，理由是"它在 `appliesTo` 与 `gate()` 两处
 *     都被读"。修完之后 `kind` **一处都不再被读**（见 `appliesTo` 的长注释），
 *     所以它既不进 requires，也不再是任何形式的口径差异 —— 本判据对 `kind`
 *     零依赖，ctx 上有没有它都不影响任何一个裁决。
 */
export const requires = [
    'observedDocumentChanged',
    'documentsRead',
    'producedDocuments',
];
/** 自报的两个取值。★ 不写成字符串字面量类型：ctx 可能来自真实 LLM 的 JSON。 */
const CLAIMED_ABSORBED = 'absorbed';
const CLAIMED_NOTHING = 'nothing-to-change';
/**
 * 只对【声称吸收了审查意见】的主会话生效。
 *
 * ★ 唯一的闸门是**声明本身**：没有 `absorb.claims` ⇒ 没有可核对的东西
 *   （多数调用点本就不填），本判据不说话。
 *
 * ★ 这一格**不进 `requires`**（见上面的声明）：它缺席时本函数为假 ⇒ 注册表跳过
 *   ⇒ "这条判据这一轮不说话"与"它说话了、但输入面缺一格"必须不同形。
 *
 * ── ★★ 为什么闸门【不】依赖 `task.kind`（t12 修，本队记账的第 7 次同族缺陷）────
 *
 * MEASURED（2026-10-06，本任务）：本函数曾经还有第二个条件 ——
 *
 *     return kind === 'requirement' || kind === 'plan'
 *
 * 而 `src/types.ts` 的 `TASK_KINDS` 是：
 *
 *     ['requirements','implementation','verification','review','repair','integration','work']
 *      ↑ 是 `requirements`（复数），本仓**压根没有** `'requirement'` / `'plan'` 这两个值
 *
 * 实测（把 kind 逐个换成真实值）：**七个真实 kind 全部 ⇒ false**，
 * 而两个**不存在的** kind ⇒ true。⇒ 本判据在真实运行中**永远不发言**。
 *
 * ★ 为什么这一次特别难发现 —— 它是前 6 次「装了但调不到」的**升级版**：
 *
 *     前几次：判据没被调用 / 输入面没接上   ⇒ 症状是"它不见了"
 *     这一次：判据被调用了、输入面也给了，
 *             而它自己说"这一轮不适用"      ⇒ 症状是"它很有礼貌"
 *
 *   ⇒ 而"不适用 ⇒ 不报"是本队**刻意保护的纪律**（requires.ts 的闸门那一节：
 *     不制造噪音，因为噪音教人忽略门禁）。于是这个缺陷恰好被那条纪律**庇护**了：
 *     它读起来完全正常，且与"这一轮本来就不该审"**同形**。
 *     ⇒ 纪律本身没有错，但它需要一条臂来防止**永不适用的闸门**借用它。
 *       `scripts/gate-admission-absorb.test.mjs` 的「臂 0」就是那条臂。
 *
 * ── ★ 为什么选「不依赖 kind」而不是「改成 'requirements'」──────────────────────
 *
 * 改成 `'requirements'` 只有一行，但它保留了一个**更根本**的问题：
 *
 *     `kind` 是**调用方自己贴的标签**。用调用方给的标签来决定判据说不说话，
 *     与本层存在的全部理由（"不采信自述"、`dispatch.changed-paths` /
 *     `completion.verify-rerun` 堵的都是"把判据的输入交给被判的一方"）**同源**。
 *     一个把产物写成 `.md`、却把任务标成 `work` 的主会话，会让本判据静默闭嘴
 *     —— 而那正是这条判据唯一该开口的时刻。
 *
 * ★ 判据真正需要的信号是「**有没有要审的产物文档**」，而那是 `producedDocuments`
 *   （调用方注入的**观察**，不是自报的标签）。于是：
 *
 *     有产物清单 ⇒ 说话（产物可能是 `[]`，那本身就是一条可判定的结论）
 *     没有产物清单 ⇒ 那是 `gate()` 里的 `unmeasured`，**不是**这里的"不适用"
 *
 *   两者不同形，而后者比"安静地跳过"有用得多：`unmeasured` 会说
 *   "我没能测量"，而跳过什么都不说 —— 本队记账的"把没测到并进通过"。
 *
 * ── ★ 与两条兄弟判据的口径（三条都在 `admission`，口径必须说得清）────────────
 *
 *     `admission.checkpoint`  闸门 = `Array.isArray(ctx.documents)`
 *                             —— **同样不依赖 kind**：它要的信号是"有没有产物清单"
 *     `admission.convene`     闸门 = 恒真 —— 它问的是"成团这个动作"本身，
 *                             每一次成团尝试都该被问起
 *     `admission.absorb`（本条）闸门 = **有没有声明**（`absorb.claims`）
 *                             ★ 与 checkpoint 同源：不依赖 kind，依赖"观察/声明在不在场"
 *
 * ★ 本条与 checkpoint 唯一的差别是**第一格**：checkpoint 问"有没有产物要审"，
 *   本条问"有没有人声称他吸收了"。两条都在自己的第一格上无条件开口，都不看 kind。
 *   ⇒ 口径一致：**闸门只判"这一轮有没有我要审的东西"，绝不判"调用方说这是什么"**。
 */
export function appliesTo(ctx) {
    const claims = ctx?.absorb?.claims;
    return claims === CLAIMED_ABSORBED || claims === CLAIMED_NOTHING;
}
/**
 * 把一组路径规整成集合；非法路径单独交出来（与 changed-paths 的 bucket 同构）。
 */
function bucket(paths) {
    const legal = new Set();
    const illegal = [];
    for (const path of paths) {
        const normalized = normalizeWorkspacePath(path);
        if (normalized === undefined)
            illegal.push(path);
        else
            legal.add(normalized);
    }
    return { legal, illegal };
}
/** 只有字符串、非空白的条目才算"点名了一份文档"（其余静默丢掉，由形状决定）。 */
function namedDocuments(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === 'string' && item.trim() !== '');
}
/**
 * ── ★ 把一份"路径 → 内容"的观察也规整一遍（本判据的第一版在这里错了）────────────
 *
 * MEASURED（本任务，夹具当场抓出来的）：`documentsRead` 与 `producedContent` 的**键**
 * 此前是**逐字**拿去和规整过的产物路径比较的。于是 `./docs/REQUIREMENTS.md` 与
 * `docs/REQUIREMENTS.md` 成了两份不同的文件 —— 一次路径写法的差别被读成
 * **"这份产物被删了"**，而它的形状与"读到了、产物还在"完全同形。
 *
 * ★ 这个缺陷的形状正是本队反复记账的那一种：**同一个东西有两个名字，而比较用的是
 *   另一个名字**（守卫检查了另一个同名的东西）。修法不是"记得调用方会规整"，
 *   而是把规整做在**判据读到的每一格上** —— 调用方少规整一次就是一次误判。
 *
 * ★ 非法路径仍然**保留原样**（不静默丢弃）：它们会各自走自己的拒绝分支。
 */
function contentByPath(map) {
    const out = new Map();
    for (const [raw, content] of Object.entries(map ?? {})) {
        const normalized = normalizeWorkspacePath(raw);
        if (normalized === undefined)
            continue;
        out.set(normalized, content);
    }
    return out;
}
export function gate(ctx) {
    const absorbed = ctx?.absorb?.claims === CLAIMED_ABSORBED;
    const nothingToChange = ctx?.absorb?.claims === CLAIMED_NOTHING;
    /**
     * ── ★ 先问"这次能不能观察"，而不是先问"产物是什么" ──────────────────────────
     *
     * 顺序是刻意的，两个理由：
     *
     * ① 闸门（`claims`）不进 `requires`，所以**判据要自己对它负责**：
     *    一个没声称吸收的 ctx 走到这里，正确答案是"我没能测量"（我还没被喂饱），
     *    **不是** "产物一个都没有 ⇒ 拒绝"。后者会在一份完全合规的空 ctx 上开火
     *    —— 那就是误伤，而误伤的代价比漏报更贵（判据注册表 §3.5）。
     *
     * ② `producedDocuments` 缺席与为空不同形（见上面 interface 的注释）。把这条
     *    排在"有没有产物"之前，是为了让"没人接线"在这条判据上**永远**是 unmeasured。
     *
     * ★★ t12：这里此前还有第三段 —— `kind` 不是 `'requirement'` / `'plan'` 就
     *    unmeasured。它与 `appliesTo` 的闸门是同一条错（两个值在本仓都不存在），
     *    而且它更坏：`appliesTo` 为假时注册表**直接跳过**，这段代码根本到不了；
     *    而一旦 `appliesTo` 被修正、这段却留着，判据就会在真实运行里改说
     *    "这不是需求阶段" —— 一个**同样永远为真**的挡箭牌。
     *    ⇒ 两处必须一起改。这正是本队记账的「守卫检查了另一个同名的东西」：
     *      两处检查着同一个 `kind`，只修一处等于没修。
     */
    if (absorbed !== true && nothingToChange !== true) {
        return unmeasured(`this run never claimed to have absorbed a review (neither "${CLAIMED_ABSORBED}" nor "${CLAIMED_NOTHING}"), so there is no claim to check against reality`);
    }
    const documents = ctx?.producedDocuments;
    if (!Array.isArray(documents)) {
        return unmeasured('the requirement/plan documents for this run could not be observed (producedDocuments was not provided), so the claim of absorption could not be checked against reality');
    }
    const read = ctx?.documentsRead;
    if (read === undefined || read === null || typeof read !== 'object' || Array.isArray(read)) {
        return unmeasured('what this session had actually read when it absorbed the review could not be observed (documentsRead was not provided), so "was the document rewritten from what was read" could not be checked');
    }
    const produced = bucket(documents);
    const blockers = [];
    for (const path of produced.illegal) {
        blockers.push(`"${path}" was listed as a produced requirement/plan document but is not a workspace-relative path (absolute paths and ".." can never be compared with what was read)`);
    }
    /**
     * ★ 产物一个都没有 ⇒ **可判定的事实**，不是"没能测量"（规则一）：这不是"我不知道
     *   产物是什么"（那时 `producedDocuments` 缺席 ⇒ 上面已经 unmeasured），
     *   而是"产物集是空的"—— 它答不了"够不够格进场"这个问题。
     */
    if (produced.legal.size === 0 && produced.illegal.length === 0) {
        blockers.push('this run declares no requirement/plan document at all, so "the review was absorbed into the document" cannot hold: there is no artefact for the absorption to show up in');
        return blocked(blockers);
    }
    const observedChange = ctx?.observedDocumentChanged;
    if (typeof observedChange !== 'boolean') {
        return unmeasured(`this session's write history could not be observed (no session events were available), so the claim of absorption could not be checked against whether the ${produced.legal.size} produced document(s) were ever written`);
    }
    const producedContent = ctx?.producedContent;
    if (producedContent === undefined || producedContent === null || typeof producedContent !== 'object') {
        return unmeasured('the current content of the produced documents could not be observed, so whether the document changed after it was read could not be checked');
    }
    const readPaths = bucket(Object.keys(read)).legal;
    const readContent = contentByPath(read);
    const nowContent = contentByPath(producedContent);
    /** ★ 点名过、且**真的被读过**的产物（路径规整到同一空间之后比较）。 */
    const namedByClaim = bucket(namedDocuments(ctx?.absorb?.documents));
    const namedAndRead = [...namedByClaim.legal].filter((path) => readPaths.has(path));
    const changedAtReadTime = [];
    const unchangedAtReadTime = [];
    /** ★ 读出了内容、但产物【现在】读不到（被删了 / 被移走了）—— 与"没变"不同形。 */
    const vanished = [];
    for (const path of readPaths) {
        if (!produced.legal.has(path))
            continue;
        const then = readContent.get(path);
        if (typeof then !== 'string')
            continue;
        const now = nowContent.get(path);
        if (typeof now !== 'string')
            vanished.push(path);
        else if (now !== then)
            changedAtReadTime.push(path);
        else
            unchangedAtReadTime.push(path);
    }
    if (absorbed) {
        /**
         * ── 出口 1：自报「已吸收」 ⇒ 产物必须真的变了 ──────────────────────────────
         *
         * ★ 而且这一变必须**接在一次真的读过它之后**：(b) 那一半。缺了它，本判据
         *   就退化成"产物动过没有"—— 主会话可以先动文档、再声称吸收，声明与痕迹之间
         *   的因果关系不被检查。
         */
        if (observedChange === false) {
            blockers.push(`this session reported having absorbed the review (claims: "${CLAIMED_ABSORBED}") but no write to any of the ${produced.legal.size} produced document(s) was ever observed in it — the review cost was paid and nothing landed in the artefact`);
        }
        if (readPaths.size === 0) {
            blockers.push(`this session reported having absorbed the review (claims: "${CLAIMED_ABSORBED}") but no produced document was ever read — a verdict cannot have been reached from a document that was never opened`);
        }
        else if (changedAtReadTime.length === 0) {
            const unchanged = unchangedAtReadTime.length > 0
                ? `the content of ${unchangedAtReadTime.map((path) => `"${path}"`).join(', ')} is byte-identical to what was read`
                : `none of the ${readPaths.size} document(s) that were read is among the produced documents (${[...produced.legal].map((path) => `"${path}"`).join(', ')})`;
            const vanishedNote = vanished.length > 0
                ? ` ("${vanished.join('", "')}" was read but cannot be read back now)`
                : '';
            blockers.push(`this session reported having absorbed the review (claims: "${CLAIMED_ABSORBED}") but the document did not change after it was read: ${unchanged}${vanishedNote}`);
        }
    }
    else {
        /**
         * ── 出口 2：自报「无需改」 ⇒ 产物不必变，但必须【点名】且被真的读过 ──────────
         *
         * ★ 这一条出口不是"另一种通过"，它有自己的代价：点名是哪几份产物无需改。
         *   "无需改"整份审查的人必须说得出来"我读的是哪一份、它为什么不用改"。
         *
         * ★ 而且**它不许与出口 1 的读数同形**（三态不同形的一部分）：走到这里时
         *   产物可能真的一个字没动 —— 这与出口 1 的 blocked 在"文件状态"上完全一样，
         *   区别只在**声明**。判据能说的只有一句：这一轮申报的是"无需改"，所以缺的
         *   不是改动，而是点名。谁在部署上把两者读混，谁就得自己回答"他是真的判断了，
         *   还是随口一说"—— 判据不假装它能回答那个问题。
         */
        for (const path of namedByClaim.illegal) {
            blockers.push(`"${path}" was named as a document that needs no change but is not a workspace-relative path`);
        }
        if (namedByClaim.legal.size === 0) {
            blockers.push(`this session reported that no change was needed (claims: "${CLAIMED_NOTHING}") without naming a single produced document — "nothing to change" has to say which document was judged and found sufficient`);
        }
        else if (namedAndRead.length === 0) {
            blockers.push(`this session reported that no change was needed (claims: "${CLAIMED_NOTHING}") naming ${[...namedByClaim.legal].map((path) => `"${path}"`).join(', ')}, but none of those was ever read — a judgement about a document nobody opened is not a judgement about that document`);
        }
        /**
         * ★ 反向半边：申报"无需改"、却把**点名的那几份**都改了 ⇒ 声明与痕迹对不上。
         *   这一半的存在理由，与 `dispatch.changed-paths` 的"隐瞒改动与虚报改动同样
         *   危险"是同一个：否则"无需改"会变成一条**永远安全**的出口 —— 说什么都不用
         *   承担，那它就取代出口 1 成为默认路径，而本判据整个失效。
         */
        const namedChanged = namedAndRead.filter((path) => {
            const then = readContent.get(path);
            return typeof then === 'string' && typeof nowContent.get(path) === 'string' && nowContent.get(path) !== then;
        });
        if (namedChanged.length > 0) {
            blockers.push(`this session reported that no change was needed (claims: "${CLAIMED_NOTHING}") for ${namedChanged.map((path) => `"${path}"`).join(', ')}, but that document was rewritten after it was read — "needs no change" and "was changed" are different claims`);
        }
    }
    if (blockers.length > 0)
        return blocked(blockers);
    /**
     * ★ 通过时**也交出产出**：让调用方能把判据层亲眼核对的结论落进记录，而不是
     *   只留主会话填的那一份（与 verify-rerun 交回 `reruns`、changed-paths 交回
     *   `verifiedChangedPaths` 同构）。
     *
     * ★ `absorbedDocuments` 只列**真的被读、且真的变了**的那些：它是"吸收发生了"
     *   的凭据，不是"产物有哪些"。把它写成产物全集会让下一步（成团闸门）以为
     *   每一份产物都被吸收过。
     */
    return {
        ok: true,
        absorbReport: {
            claim: absorbed ? CLAIMED_ABSORBED : CLAIMED_NOTHING,
            producedDocuments: [...produced.legal],
            readDocuments: [...readPaths],
            absorbedDocuments: [...changedAtReadTime].sort(),
            noChangeDocuments: absorbed ? [] : [...namedAndRead].sort(),
        },
    };
}
