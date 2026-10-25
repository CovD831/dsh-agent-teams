/**
 * ── ★★★ t101：把 `signals.jsonl` 读成 `HealthRecord[]`（health.ts 的**第一个消费者**）─────
 *
 * ★★ 背景（`EVOLUTION-WIRING-GAP.md` §1 逐字）：`health.ts` 此前**零消费者** ——
 *   `collectionHealthOf` 能算，但从**没有任何生产路径算过它**。
 *   而"造一个函数 + 一个夹具"**不会改变那件事** ⇒ 本模块把**读文件**与**算读数**接起来，
 *   并由 `src/snapshot.ts`（生产出口：`/state` 路由）调用。
 *
 * ── 三态（本模块的全部难点：三种"没有读数"必须互不同形）──────────────────────────
 *
 * ```
 *   A · 文件缺席（还没采过任何东西）      ⇒ { status: 'unmeasured', reason: 'file-absent' }
 *   B · 文件在、但解析不出任何记录（空文件/全坏行） ⇒ { status: 'measured', records: [] } ← 与 A 不同形
 *   C · 一行坏 JSON                        ⇒ 只跳那一行（`skippedMalformed` 计数），**不整文件放弃**
 * ```
 * ★ A 与 B 的差别是**实打实的**：A = "这条流水线还没开过"（读数无对象）；
 *   B = "流水线开了、但目前一条都没采到"（读数对象是空集 —— `redundancy/coverage` 按空集口径给 0）。
 * ★ C 的先例：t93 的 `maxSignalNumberIn` 逐行 `JSON.parse`、坏行走兜底 ——
 *   **一行坏掉不许让整个读数归零**。
 */
import { duplicateSignalIds, signalsPathOf } from "./collect.js";
/**
 * 一条信号里能当**桶分类**用的字段 —— 两代形状并存（逐行 parse，**不许假设形状**）：
 *
 * ```
 *   t88 手工补录（10 行）：顶层是 `title/observed/...`，分类住在 `routing.target/effect` 里，
 *                          且**多为自由文本串**（t91 注释记过：字符串对分流合格、对收益不合格）
 *   t87 `observe` 采集（5 行）：`source.{where,gateId,tool}` + `collection.verdicts`
 * ```
 * ★★ 投影规则（**保守**：分类不出来就落 `(unattributed)`，**不编**）：
 *   · `kind[]`   ← t87 的 `routing.kind[]`？没有 —— 真数据里 t87 行没有结构化类别，
 *                  ⇒ 用**它真的有的**：`source.where`（确定性来源）作 component 候选；
 *   · ★ 而那意味着本读数今天**主要回答"按来源分桶的重复率"**，不是规格里那个
 *     `(component, kind)` 的完整语义 —— ★ 如实记下，这是**数据形状决定的**，
 *     等分流（规格顺序 ②）落地后有结构化类别，这里的投影再升级。
 */
function healthRecordOf(signal) {
    const at = typeof signal.at === 'number'
        ? signal.at
        : typeof signal.at === 'string' ? Date.parse(signal.at) || 0 : 0;
    /** `source.where`：两代形状**都有**（t88 的 `source.where` / t87 的 `source.where`）。 */
    const source = signal.source?.where;
    const component = typeof source === 'string' && source.trim() !== '' ? source : undefined;
    /**
     * ★ `kind[]`：t87 行**没有**结构化类别 ⇒ 兜底成一个**单元素**类别，
     *   取信号的三分类（`rejection/success/insight`）—— 它两代都有，且**是真实的语义分类**。
     *   （比编一个"unwired"强：那类标签今天只活在自由文本里。）
     */
    const signalKind = typeof signal.kind === 'string' && signal.kind !== '' ? signal.kind : '(unclassified)';
    return { component, kind: [signalKind], at };
}
/**
 * 读 `signals.jsonl` 并投影成 `HealthRecord[]`。
 *
 * @param stateRoot 状态根（`signalsPathOf` 拼路径 —— **不猜**）。
 * @param readFile  注入的读文件函数（生产给 `fs/promises.readFile`；夹具注入内存版）。
 */
export async function readSignalsHealth(stateRoot, readFile) {
    let text;
    try {
        text = await readFile(signalsPathOf(stateRoot), 'utf8');
    }
    catch {
        /**
         * ── ★★★ 反向半边 A：文件缺席 ⇒ `unmeasured`，**不是空读数** ────────────────────
         *
         * 文件不存在 = 采集流水线**还没开过**（t87 之前连目录都没有）。
         * 此时 `records: []` 会让"没开过"与"开了没采到"同形 ⇒ 整格缺席语义由 `status` 承载。
         */
        return { status: 'unmeasured', reason: 'file-absent', records: [], totalLines: undefined };
    }
    const lines = text.split('\n');
    const records = [];
    const refused = {};
    let skippedMalformed = 0;
    for (const line of lines) {
        if (line.trim() === '')
            continue;
        /**
         * ── ★★★ 反向半边 C：一行坏 JSON ⇒ **只跳那一行**（t93 纪律）────────────────────
         *
         * 一个半写坏的行（进程在 append 中途死掉会造出这种行）不该让**全部**读数消失。
         * ★ 跳过是**计数的**（`skippedMalformed`），不是静默的 —— "跳了 2 行"与"没这 2 行"不同形。
         */
        try {
            const parsed = JSON.parse(line);
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                skippedMalformed += 1;
                continue;
            }
            records.push(healthRecordOf(parsed));
            /**
             * ★ 数 refused：该行自带的 `collection.verdicts` 里 **`ok` 之外**的裁决各计一次。
             *   ★ 没有该格的行照实跳过（不补 0 —— 那会把"没跑采集判据"算成"全过"）。
             */
            const verdicts = parsed.collection?.verdicts;
            if (Array.isArray(verdicts)) {
                for (const verdict of verdicts) {
                    if (typeof verdict.gateId !== 'string' || typeof verdict.verdict !== 'string')
                        continue;
                    if (verdict.verdict === 'ok')
                        continue;
                    refused[verdict.gateId] = (refused[verdict.gateId] ?? 0) + 1;
                }
            }
        }
        catch {
            skippedMalformed += 1;
        }
    }
    /**
     * ── ★★★ 反向半边 B：文件在 ⇒ `measured`，**哪怕零条记录** ─────────────────────────
     *
     * 与 A 不同形：B 答"流水线开了、目前一条都没采到"（空集口径的 redundancy/coverage = 0），
     * A 答"流水线还没开"。两者的补救动作相反（B 看采集为什么没采到；A 看流水线为什么没开）。
     */
    return {
        status: 'measured',
        records,
        refused,
        ...skippedMalformed > 0 ? { skippedMalformed } : {},
        /**
         * ★ 撞过车的 id（见 {@link SignalsHealthRead.duplicateIds} 的注释）。
         *   判据是**已经读进内存的那份 text** —— 不重读文件，因此不可能与上面
         *   `records` 看的是两份不同的字节。
         *   ★ 只在撞过时在场：`[]` 与"从来没撞过"在这里是同一件事，写出来只是噪音。
         */
        ...(() => {
            const duplicates = duplicateSignalIds(text);
            return duplicates.length === 0 ? {} : { duplicateIds: duplicates };
        })(),
        totalLines: lines.length,
    };
}
/**
 * 从一条原始行算出它的三份投影 —— ★ **保守**：算不出来就是 `undefined`，**不编**。
 *
 * ── ★★★ 这里曾经有一个真缺陷，而且它正是本文件头警告过的形态 ──────────────────
 *
 *   第一版这样重建去重键：
 *     `kind`      ← `row.kind`            （**信号**类别 `'rejection'`）
 *     `component` ← `row.source.where`    （**来源**位置）
 *     `message`   ← `row.message`
 *   而写端算的是 `dedupeKeyOf({kind: input.kind, component: input.component, message})`
 *   ⇒ 写端 `unwired|contract|the message`，索引端 `rejection|validateCreateTask|the message`。
 *
 *   ★★ 两个键**永远不同** ⇒ `seen.has(key)` 恒假 ⇒ **去重永不命中**，
 *      而读数上一切正常（每条都 `ok`，看起来判据在工作）。
 *      MEASURED（探针实测）：`wantKey "unwired||same message" in seen? false`，
 *      `seen ["rejection|probe|same message"]`。
 *      ⇒ 这不是"去重判据坏了"，是**喂给它的索引不是它要的那个东西**。
 *
 * ── 修法：**新行**逐字重建，**旧行**如实承认重建不了 ──────────────────────────────
 *
 *   新行有 `candidate: {kind: string[], component?}`（N1.2 落盘的原料）⇒ 键**逐字**重建，
 *   与写端算的是同一个（同一个 `keyOf`、同一份原料）。
 *   ★ 旧行（N1.2 之前的 49 条）**盘上没有候选面**，而 `kind` 那一格装的是信号类别 ——
 *     ⇒ **重建不出来**。三个选择里只有一个诚实：
 *       ① 用 `row.kind` 硬凑  ⇒ 造一个**永远匹配不上**的键（第一版就是这么错的）
 *       ② 跳过整行          ⇒ 连它的 `source`/`at` 也丢，cooldown 白丢 39 行真实历史
 *       ③ **只要它真的有的**：`source`/`at` 留下（cooldown 能用），键留空（去重不用）
 *     ⇒ 选 ③。而"有多少行是这种"必须**计数报出来**（`keysUnreconstructable`），
 *       否则"去重在旧行上没生效"就是静默的 —— 那正是本任务在拆的东西。
 *
 * ★ 这也解释了为什么 acceptance 把存量与新行的 `keyPresent` 分成两个数：
 *   同一件事在两个人群里的**可测性不同**，合成一个数就会读成"修好了"。
 */
function indexProjectionOf(line, keyOf) {
    let row;
    try {
        row = JSON.parse(line);
    }
    catch {
        return undefined;
    }
    if (row === null || typeof row !== 'object')
        return undefined;
    const at = typeof row.at === 'number'
        ? row.at
        : typeof row.at === 'string' ? Date.parse(row.at) || undefined : undefined;
    const source = row.source?.where;
    /**
     * ★ `source` / `at` 与 `message` 无关：**只要这一行有来源与时刻，它就参加 cooldown**。
     *   ⇒ 先算这两份，键算不出来也照样返回（`key: undefined`）。
     */
    const projectionOf = (key) => ({
        key,
        source: typeof source === 'string' && source !== '' ? source : undefined,
        at,
    });
    const candidate = row.candidate;
    const message = typeof row.message === 'string' ? row.message : undefined;
    if (message === undefined)
        return projectionOf(undefined);
    /**
     * ★★ **只从 `candidate` 重建** —— 不从 `row.kind` 凑。
     *   缺 `candidate`（N1.2 之前的行）⇒ `key: undefined`，如实不参加去重。
     */
    const rawKind = candidate?.kind;
    const kind = Array.isArray(rawKind)
        ? rawKind.filter((entry) => typeof entry === 'string')
        : [];
    if (kind.length === 0)
        return projectionOf(undefined);
    const rawComponent = candidate?.component;
    const key = keyOf({
        kind,
        ...typeof rawComponent === 'string' && rawComponent !== '' ? { component: rawComponent } : {},
        message,
    });
    return projectionOf(key);
}
/**
 * 读 `signals.jsonl` 并投影成一份索引（**只读**；不写盘、不加锁）。
 *
 * @param stateRoot 状态根（`signalsPathOf` 拼路径 —— **不猜**）。
 * @param readFile  注入的读文件函数（生产给 `fs/promises.readFile`）。
 * @param keyOf     去重键的计算（**注入** —— 见文件头那一节）。
 */
export async function deriveCollectionIndex(stateRoot, readFile, keyOf) {
    let text;
    try {
        text = await readFile(signalsPathOf(stateRoot), 'utf8');
    }
    catch {
        /**
         * ★★ 缺席 ⇒ **不**返回空索引（那会被 cooldown 读成"每条都是第一次"）。
         *   ⇒ 明确答 `absent`，由调用方**不传** `index`。
         */
        return { status: 'absent', rowsRead: 0, skippedMalformed: 0, keysUnreconstructable: 0 };
    }
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    const seen = new Set();
    const counts = new Map();
    const lastBySource = new Map();
    let skippedMalformed = 0;
    /**
     * ★★ `keysUnreconstructable`：**键重建不出来的行数**（旧行 —— N1.2 之前没有 `candidate`）。
     *
     *   为什么要一个计数：这些行**不参加去重**（它们确实没有那份原料），
     *   于是"去重在这批行上没生效"。★ 若不报数，它就与"这批行本来就没有重复"同形 ——
     *   而本任务的全部工作就是把这种"同形"拆开。
     *   ★ 注意它**不是** `skippedMalformed`：那些行是好的、可读的、参与 cooldown 的，
     *     只是缺一份当时没落的原料。合成一个数会把"坏数据"与"没写全"读成一件事。
     */
    let keysUnreconstructable = 0;
    for (const line of lines) {
        const projection = indexProjectionOf(line, keyOf);
        if (projection === undefined) {
            skippedMalformed += 1;
            continue;
        }
        /**
         * ★ 键算不出来 ⇒ **这一行不进 `seen`/`counts`**，但它的 `source`/`at` 照旧进 `lastBySource`。
         *   ⇒ 去重说"我没见过它"（真话：没有可比的键），cooldown 仍能用它的时间（也是真话）。
         */
        if (projection.key === undefined) {
            keysUnreconstructable += 1;
        }
        else {
            seen.add(projection.key);
            counts.set(projection.key, (counts.get(projection.key) ?? 0) + 1);
        }
        /**
         * ── ★★ `lastBySource` 取**最大** `at`，不是"最后一行" ──────────────────────
         *
         *   台账是**追加**的，但 `at` 不保证单调（信号可能被补录、夹具会伪造时间）。
         *   ★ 取"最后一行"会让一条补录的老信号把窗口**往回拨** ——
         *     而 cooldown 的全部意义就是"最近一次说话是什么时候"。
         *   ★ 只在这一格上取 max 是**判据那边的要求**（它算 `candidate.at - last`）：
         *     若 `last` 可能比真实最大值小，冷却窗就会被**低估** ⇒ 多采。
         */
        if (projection.source !== undefined && projection.at !== undefined) {
            const previous = lastBySource.get(projection.source);
            if (previous === undefined || projection.at > previous)
                lastBySource.set(projection.source, projection.at);
        }
    }
    return {
        status: 'derived',
        index: { seen, lastBySource, counts },
        rowsRead: lines.length,
        skippedMalformed,
        keysUnreconstructable,
    };
}
