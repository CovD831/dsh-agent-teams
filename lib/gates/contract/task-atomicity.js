/**
 * ── 判据：契约【声明面的形状】是不是可能不可归因（★ 而不是"够不够原子"）─────────
 *
 * 插入点：`contract`（建任务 / 改契约 —— 契约 §1 ①）
 *
 * ── ★★★ 开头这句是 t75 改过的，而它原来写的是「够不够【原子】」 ────────────────
 *
 * MEASURED（t43 证伪，t69 又撞到一次，t75 复现，**t3 修好**）：
 *
 *     同一件工作，两种写法（t43 的原始读数 —— 那是一个**真缺陷**）：
 *       ['src/registry.ts', 'src/index.ts']          ⇒ ok
 *       ['src/registry.ts', 'src/index.ts', 'src/']   ⇒ blocked
 *
 *     ⇒ 当时判据只做 `path.trim().endsWith('/')` —— **它判的是字符串最后一个字符**，
 *       于是"多写一个尾斜杠"这件**纯写法**的差别把裁决翻了过来。
 *
 * ★★ t3 的修法（现在实现的就是它）：把信号从"字符串末字符"换成
 *   **归一化之后的目录前缀 + 集合覆盖** —— 见下面的 `uncoveredDirectoryPrefixes`。
 *   ⇒ `'src/'` 与 `'src'` 归一化成**同一个路径键**，而一个路径键若被另一个
 *     更具体的声明（`Q.startsWith(P + '/')`）覆盖，它就不算"没说清"。
 *   ⇒ 于是上面那两行**同裁**，而"它判结构"这件事变成了真的。
 *   ★ 而它**仍然不读盘**（性质 1）：它判的是**这份声明**有没有说清那个目录下的哪一格，
 *     不是"那个目录在不在盘上"。
 *
 * ★ 所以本文头、以及 `description`（控制台渲染给读的人看的那一句）都**不许**
 *   再声称它判"原子性" —— 那是替一个**做不到的结论**作证。
 *
 * ★★ 而"原子性不可机械化"这个结论（t43）：它不是本判据的缺陷，是**标准本身**的性质。
 *   ⇒ 于是本判据的定位只能是：**一个形状信号**，其读数**可能**指向"不可归因"，
 *     而它**不能**判定那件事。下面的分析仍然有效 —— 只是它的**称谓**必须诚实。
 *
 * ── 它防的是什么失效（用户裁定 + 本轮实测）────────────────────────────────────
 *
 * 用户原话：

 * ── 它防的是什么失效（用户裁定 + 本轮实测）────────────────────────────────────
 *
 * 用户原话：
 *
 *   「关于长任务，以后在派任务时，除了写域不重叠、需要并行以及其他任务要求外，
 *     任务还要**尽可能原子化**，以便失败后能最好直接归因到某个问题。」
 *
 * ★ 而实测支撑它的是 absorb-dev 那句话（它掉线三次而三次都停在可恢复的中间态）：
 *
 *   「我不想在一个 attempt 里同时做『搬运 3302 行』和『重接 57 个依赖』两件事 ——
 *     那样一旦全量红了，**我分不清是搬运错了还是重接错了**。」
 *
 * ⇒ 一句话概括这条判据要抓的形态：**一个 attempt 里有两类可能的原因时，
 *   失败不可归因。** 而"归因"是有代价的：一个不可归因的失败会把一次
 *   `pnpm verify` 的红变成**一轮对话**（问"哪里错了"→ 猜 → 再跑 → 还是红）。
 *
 * ── ★★ 核心问题：怎么把"可归因"变成**可机械判定**的？────────────────────────────
 *
 * "这个任务大不大"是**感觉**，判不了。所以本判据**不判大小**，它判一个更窄、
 * 但可以机械回答的问题：
 *
 *     契约里声明的【判别面】是不是超过一条？
 *
 * 什么叫判别面？**一条会因为一个独立原因而红/绿的东西。** 三条信号，各自可加：
 *
 *   ┌── 信号 ①：`verify` 里有几条**会因不同原因失败**的命令 ──────────────────
 *   │  契约的 `verify` 是"这个任务算不算做完"的判别面。两条**互不相关**的命令
 *   │  ⇒ 它们红的原因是两个。⇒ 判据问：这几条命令是不是在**同一个覆盖面**上？
 *   │    判"同一覆盖面"的口径：它们是否**读同一批产物**（见 `commandFootprint`）。
 *   └── 信号 ②：`inScope` 是不是跨越了**概念上独立的文件组** ────────────────────
 *      判"独立"的口径：文件的**一级目录**（`src/gates/**` vs `scripts/**`）。
 *      ⇒ 而它需要一条**豁免**：`src/` 与 `lib/` 是**同一个概念**的两种形态
 *        （源码与它自己的构建产物，见 `contract.build-artifact-scope`）——
 *        把那一对算成"两个组"会让**每一个** inScope 含 src/ 的任务都被判不原子，
 *        而那是**恒红**（比恒真更坏：它阻断所有诚实的工作）。
 *   ┌── 信号 ③：`objective` 里含多个**并列的**交付动词 ────────────────────────
 *   │  这一条**最难做准**（自然语言），所以它**只作为信号 ①②的旁证**：
 *   │  它单独成立时**不**判 blocked，而是把读数交出去（见"误报"一节）。
 *   └──────────────────────────────────────────────────────────────────────────
 *
 * ── ★ 为什么主判据是 ①（判别面的条数），而不是 ② 或 ③ ───────────────────────────
 *
 *   ① 它**最接近归因**：归因失败靠的是"跑什么去看哪个原因成立"，而那正是 verify。
 *      一个任务的 verify 只有一条 ⇒ 它红/绿只有一个读数 ⇒ **归因是免费的**。
 *   ② inScope 跨目录**常常是合理的**（一次重构本来就会碰到几个目录），
 *      把它当主判据会大量误报 —— 而误报的代价见下。
 *   ③ 自然语言最不可靠。
 *   ⇒ 于是：**① 主判，② 加重，③ 只记录**。三者都进返回值（可读），
 *     而只有 ①（± ②）能把裁决推到 blocked。
 *
 * ── ★★ 它一定会误报，而这一节比"覆盖多少"重要（用户的提醒）─────────────────────
 *
 * 本队的定论：「**噪音会教人忽略门禁，与误报同样有害。**」
 * ⇒ 所以本判据**默认进观察集**（`observe()` / `AGENT_TEAMS_OBSERVE_GATES`），
 *   即：照常求值、照常记录，但裁决**不阻止流程**。观察到它不误伤之后才放出来。
 *
 * ★ 而它在这些情形下**会**误报（如实写在这里，不藏）：
 *
 *   · 一个任务**故意**要改多个概念不相干的目标，且有**多条互不相关的 verify**
 *     —— 例如"修复两个独立的缺陷，每个缺陷有自己的回归命令"。
 *     那在**归因**上其实是可接受的（两条命令各自红，原因各自清楚），
 *     而本判据会给 blocked。⇒ 修法：那种任务应当拆成两个，或者声明一条
 *     **合并的** verify（它红的时候两类原因都能被看到）。
 *   · `inScope` 跨目录但**概念上同源**（例如 `src/a.ts` 与 `docs/a.md` 一起改）。
 *     本判据按一级目录判 ⇒ 会报。⇒ 这是信号 ② 的已知粗糙之处。
 *   · verify 用**同一个命令模板**但参数不同（例如 `node --test a.mjs` 与
 *     `node --test b.mjs`）：本判据按"参数里的路径集合"判 ⇒ 它们**算两个覆盖面**
 *     ⇒ 若两个套件测的是同一件事，会误报。
 *
 * ── ★★ t3 修好之后，剩下的诚实边界（**这两个仍然会报**）─────────────────────────
 *
 *   · 一个**真的新建目录**的原子任务（"新建一个目录，里面放一个文件"）仍然会被报 ——
 *     ★ 因为判据**不读盘**：它看不出那个目录是新的。它看到的是
 *     "这份声明没说清那个目录**下的哪一格**"，而那正是可归因性的**形式**。
 *   · `src/x/` 与"只改 `src/x/y.ts`"被判成**两件事**（前者更宽、后者覆盖它）——
 *     若那其实是一条指令，报错了。
 *   ★ 这两条**不是待修的缺陷**，它们就是"一个纯函数判据"能给出的东西的边界。
 *
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：不 import 任何 I/O —— 只读契约里的字符串，不读磁盘、不跑命令。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者**不同形**。
 *    ★ 而"判不了"**绝不允许**当成"原子"：没有 verify 也读不到 inScope ⇒
 *      `unmeasured`（它就是"我说不出这个任务能不能归因"）。
 */
import { blocked, unmeasured } from "../registry.js";
export const id = 'contract.task-atomicity';
export const point = 'contract';
/**
 * ── ★★★ 它判的是【声明面的形状】，**不是**「原子性」（t75 / t43 / t69 / t3）─────────
 *
 * MEASURED：t43 用一对**同一件工作**（`['src/registry.ts','src/index.ts']` 与
 * 在它基础上多一个 `'src/'`）证伪了当时那个信号 —— 两边的工作完全相同，而判据
 * 一个 ok、一个 blocked。
 *
 * ⇒ 那时它实际上只做 `path.trim().endsWith('/')`：**它判的是字符串最后一个字符。**
 *
 * ★★ t3 修好了这一格（把末字符换成归一化之后的目录前缀 + 集合覆盖，见
 *   `uncoveredDirectoryPrefixes`）：`'src/'` 与 `'src'` 现在是**同一个键** ⇒ 同裁。
 *
 * ★★ 而 `description` 里【不许】出现"够不够原子"这类措辞 ——
 *   它是**控制台渲染给读的人看的那一句**（`registry.ts`：`description` 是
 *   "the console renders it"）。把它写成"判原子性"，就是在替一个
 *   **做不到的结论**作证 —— 而那正是本队记了一整天的那个形态：
 *   **一句话里的每个名词，能不能指出它的来源？**
 *
 * ⇒ 新的措辞**如实说出它做了什么**，并把那件事的边界写在句子里：
 *   · 它判的是【声明面的形状】（verify 条数 / inScope 的分组 / 并列动词）
 *   · 判定信号是【inScope 里有没有"没被更具体声明覆盖的目录前缀"】——
 *     ★ 那是一个**语法层面**的读数：它**不读盘**，所以它判不了"这个目录是不是新建的"
 *   · 而"形状不原子"是"失败可能不可归因"的**一个征兆**，不是它的判据
 *   · 且它**不接生产**（t38 刻意如此），所以这句话只对直接调用它的人有效
 */
export const description = '★ 它判的是【契约声明面的形状】，不是「原子性」本身 —— 三条可机械读出的信号：verify 的条数与覆盖面、inScope 是否跨了概念上独立的目录组、objective 是否列了多个并列交付。★ 判定信号是【inScope 里有没有"没被更具体声明覆盖的目录前缀"】（归一化之后的集合覆盖，`src/` 与 `src` 是同一个键）—— 那是一个**语法层面**的结构读数：它**不读盘**，所以它判不了"这个目录是不是新建的"。★ 而"形状看起来不原子"只是"失败可能不可归因"的一个【征兆】，不是它的判据（t43 已用"只差一个尾斜杠的同一件工作"证伪过那个更强的声称）。判不了时报 unmeasured（绝不当成原子）。★ 本判据【不接生产】（t38：接线会让没有 verify 的任务全部建不出来）';
/**
 * ── ★ 输入面声明 ──────────────────────────────────────────────────────────────
 *
 * 只声明 `'task'`：它是本判据**无条件**读的那一格（`ctx?.task`），
 * 且它是 `appliesTo` 读的那一格。缺席 ⇒ 判据根本不说话（"不适用"，不是"缺输入"）。
 *
 * ★ 而 `task.verify` / `task.inScope` / `task.objective` **不进 requires** ——
 *   与 `build-artifact-scope` 同一条口径，理由在这里更硬：
 *
 *     本判据的**核心裁决分支**就是"哪几格在场"：
 *          verify 缺席 + inScope 缺席  ⇒ **unmeasured**（判不了 —— 这是它的答案之一）
 *          verify 缺席 + inScope 在场  ⇒ 按信号 ② 判
 *          verify 在场                 ⇒ 按信号 ① 判
 *     ⇒ 把它们写进 requires，等于要求调用方**总是**交出这三格；
 *       而"没交"恰恰是本判据要**如实说成 unmeasured** 的那种情形。
 *       声明它会让核对层把"这条判据还没法判"报成"调用方没接线" ——
 *       两件事不同形，合成一件就是本队反复记账的那个形态。
 *
 * ★ 边界（与另两条 contract 判据对齐）：**appliesTo 管说不说话，requires 管说话时缺不缺输入。**
 */
export const requires = ['task'];
/**
 * 仓库里**真的存在**的顶层目录。
 *
 * ★ 为什么需要它：`inScope` 里可能出现**根下的单文件**（`package.json`、`README.md`），
 *   而把它的文件名当成"一个文件组"会让"加一个测试 + 挂进脚本"这种**日常**任务
 *   被判成跨组（t38 语料实测：t9/t20/t21 三条误报）。
 * ⇒ 只有**目录**才算组；一个不在本集合里的顶层名，说明它是文件而非目录。
 * ★ 而这份集合是**硬编码**的 —— 它是"本仓库的顶层布局"，那是一个稳定的事实；
 *   用 `existsSync` 会让判据 import I/O（违反契约 §2 性质 1），而判据不读磁盘。
 */
const ROOT_LEVEL_DIRECTORIES = new Set([
    'src', 'lib', 'scripts', 'docs', 'skills', 'assets', 'release-notes', 'node_modules', 'compatibility.json',
]);
/** 只有质量类任务才有"判别面"这回事；`work` 类不判（它没有 verify 的契约要求）。 */
const QUALITY_KINDS = new Set([
    'requirements', 'implementation', 'verification', 'review', 'repair', 'integration',
]);
/**
 * ── 信号 ①：把一条 verify 命令折算成它**读的那批产物** ──────────────────────────
 *
 * "两条命令会不会因**不同原因**失败"—— 判据是：它们**读的是不是同一批东西**。
 *
 * ★ 口径：从命令里取出**路径样式的 token**（含 `/` 或含 `.` 且不是选项），
 *   归一到一级目录 + 文件名太粗 ⇒ 这里取**去掉公共前缀后的路径集合**。
 *
 * ★ 为什么用"路径集合相等"而不是"命令字符串相等"：
 *   `node --test scripts/a.test.mjs` 与 `node --test scripts/a.test.mjs --test-reporter=tap`
 *   是**同一个覆盖面**（后者只是多一个开关），而字符串不相等。
 *   取路径集合能把这种"同一条命令的不同写法"合并掉。
 *
 * ★ 而它不是完美的（见文件头"会误报"一节第三条）：两个路径不同的套件若测同一件事，
 *   会被算成两个覆盖面。**这一格是刻意的**：宁可让它多报（而它默认在观察集里），
 *   也不要让它漏报 —— 漏报会让"不可归因"继续静默发生。
 */
export function commandFootprint(command) {
    const tokens = command
        .split(/\s+/u)
        .map((token) => token.replace(/^["']|["']$/gu, ''))
        .filter((token) => token !== '')
        .filter((token) => !token.startsWith('-'))
        /**
         * ★ 只留"像路径"的：含 `/`，或含 `.` 且不在开头（`./x` 那种开头的也算路径）。
         *   一个没有路径的命令（`pnpm test`、`true`）⇒ footprint 为空
         *   ⇒ 它**无法**与其他命令比较覆盖面 ⇒ 上层把它算成一个独立的判别面
         *     （一条不带路径的命令是什么都判不了的，那本身就该被看见）。
         */
        .filter((token) => token.includes('/') || (token.includes('.') && !/^\.+$/u.test(token)))
        .map((token) => token.replace(/^\.\//u, ''));
    return [...new Set(tokens)].sort();
}
/**
 * 两条命令是不是**同一个覆盖面**。
 *
 * ★ 三条判定，缺一不可（每一条都对着一种真实的"同一条命令的不同写法"）：
 *   ① footprint 完全相同            —— 同一条命令
 *   ② 其中一条的 footprint 为空      —— 那条命令没法比较 ⇒ 算**不同**（见 `commandFootprint`）
 *   ③ footprint 互为**真子集**       —— 例如一条跑目录、一条跑目录里的一个文件
 *      ⇒ 算**同一个覆盖面**（后者的红只是前者的一部分，没有引入第二个原因）
 */
export function sameFootprint(left, right) {
    if (left.length === 0 || right.length === 0)
        return false;
    const a = [...left].sort().join('\u0000');
    const b = [...right].sort().join('\u0000');
    if (a === b)
        return true;
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const leftSubset = left.every((path) => rightSet.has(path));
    const rightSubset = right.every((path) => leftSet.has(path));
    return leftSubset || rightSubset;
}
/**
 * 把 verify 清单折算成**判别面**（每个面是一组同覆盖面的命令）。
 *
 * ★ 返回的是**分组**而不是计数：因为"说清该拆成什么"要用到每一组的内容
 *   （见 `splitSuggestion`）。只给一个数字的判据说不出补救动作。
 */
export function discriminatingSurfaces(verify) {
    const groups = [];
    for (const command of verify) {
        const footprint = commandFootprint(command);
        /**
         * ★ `group[0] ?? ''`：`noUncheckedIndexedAccess` 下数组下标是 `string | undefined`。
         *   ★ 而这里**不能**用 `group[0]!`：一个空组会让 `commandFootprint('')` 返回 `[]`，
         *     于是 `sameFootprint([], …)` 恒为 false（见它的第 ② 条）—— 那正是想要的语义
         *     （空组不吞任何命令），而不是一个被断言掩盖的崩溃点。
         */
        const hit = groups.find((group) => sameFootprint(commandFootprint(group[0] ?? ''), footprint));
        if (hit === undefined)
            groups.push([command]);
        else
            hit.push(command);
    }
    return groups;
}
/**
 * ── 信号 ②：inScope 跨了几个**概念上独立**的文件组 ──────────────────────────────
 *
 * 口径：取路径的**一级目录**。
 *
 * ★★ 而这里有一条**必须**的豁免（缺了它本判据会恒红）：
 *
 *     `src/` 与 `lib/` 是**同一个概念**的两种形态 —— 源码与它自己的构建产物。
 *     `contract.build-artifact-scope` 整整一条判据在讲这件事：
 *     本仓库强制 `lib/` 与 `src/` 同步，所以**任何**改了 `src/` 的任务
 *     **按设计**也会改 `lib/`。
 *
 *   ⇒ 把 `src/` 与 `lib/` 算成"两个独立的组"，会判**每一个**这样的任务不原子
 *     —— 那不是"发现缺陷"，那是**恒红**。而恒红比恒真更坏：
 *     恒真让人看不见问题，恒红**阻断所有诚实的工作**。
 *
 * ★ 第二条例外：`scripts/` 与 `src/` 在**判据自己那个任务**上确实是一对
 *   （一条判据 = 一个 `.ts` + 一个 `.test.mjs`）。⇒ 与 `src/lib` 同理，
 *   把它们算成同源。★ 而这条**更弱**（`scripts/` 里也可能放着与 `src/` 无关的东西），
 *   所以它只把组数减一，不改变"两组以上才算跨组"的门槛。
 */
export function scopeGroups(inScope) {
    const groups = new Set();
    for (const path of inScope) {
        const normalized = path.replace(/\\/gu, '/').replace(/^\.\//u, '').trim();
        if (normalized === '')
            continue;
        const top = normalized.split('/')[0] ?? '';
        groups.add(top);
    }
    /**
     * ★ `lib` 归并到 `src`（构建产物的两种形态）；`scripts` 也归并到 `src`
     *   （一条判据的两个文件）。⇒ 归并后 `groups` 里的 `src` 代表"这个仓库的源码面"。
     */
    if (groups.has('lib')) {
        groups.delete('lib');
        groups.add('src');
    }
    if (groups.has('scripts')) {
        groups.delete('scripts');
        groups.add('src');
    }
    /**
     * ── ★★ 第三条例外：**仓库根下的单个文件**不是"一个文件组"（t38 语料实测）───────
     *
     * MEASURED：`inScope: ['scripts/x.test.mjs', 'package.json']` 被判成**两个组**
     *   （`src` 与 `package.json`）⇒ 三个真实任务（t9/t20/t21）被误报。
     *
     * ★ 而它们**不**是两个概念：`package.json` 是**仓库根下的单文件**，
     *   一个"加一个测试并把它挂进脚本"的任务本来就同时碰两者。
     *   ⇒ 把"根下的文件名"当成一个组名，等于把每一个碰了根的健壮任务都判成跨组。
     *
     * ★ 口径：**只有目录**算组。一个路径若没有 `/`（就是一个根下的文件），
     *   它**不产生组** —— 它跟着别的那一组走，或者（若整个 inScope 只有根文件）
     *   产生零组，而那按下面的裁决是 ok（"改一个根文件"是可归因的）。
     */
    for (const name of [...groups]) {
        /** ★ 一个"组名"若其实是**根下的文件名**（不含 `/` 且不是已知目录）⇒ 不成立为组。 */
        if (!ROOT_LEVEL_DIRECTORIES.has(name))
            groups.delete(name);
    }
    return [...groups].sort();
}
/**
 * ── ★★★ 归一化：把一条 inScope 条目折成【路径键】（t3 修正的核心）───────────────
 *
 * 口径（三步，顺序固定，全部是纯字符串变换 —— 不读盘）：
 *
 *   ① `trim()`           —— 去掉首尾空白
 *   ② 反斜杠 → `/`        —— Windows 写法与 posix 写法是同一件事
 *   ③ **反复**去掉开头的 `./` —— `././src/a.ts` 与 `src/a.ts` 是同一个键
 *   ④ 去掉**尾部**的 `/`（含 `//` 之类反复去掉）—— ★ 这一步是本修法的关键：
 *
 *        'src/'      → 'src'
 *        'src'       → 'src'      ★ 同一个目录的两种写法 ⇒ 同一个键
 *        './src/'    → 'src'
 *        'src/a.ts'  → 'src/a.ts'
 *        'src/x/'    → 'src/x'
 *
 * ★★ 为什么这一步能取代旧的 `endsWith('/')`：旧信号判的是**字符串最后一个字符**，
 *   于是 `['src/registry.ts','src/index.ts']`（ok）与它加上一个 `'src/'`（blocked）
 *   得到**相反**裁决 —— 而那是**同一件工作**。归一化之后两者是同一个键集合。
 *
 * ★ 空串（`''`、`'/'`、`'./'`）不作为键：它们什么都没声明，不是"一个目录前缀"。
 *
 * ★★ 而"哪些键算**目录前缀**"要用**归一化之前的原始写法**来认（见
 *   `uncoveredDirectoryPrefixes` 的第二步）—— 因为归一化**故意**把两种写法折成同一个键，
 *   而信号要的恰恰是那个被折掉的信息。
 */
export function pathKey(entry) {
    let key = entry.trim().replace(/\\/gu, '/');
    while (key.startsWith('./'))
        key = key.slice(2);
    while (key.endsWith('/'))
        key = key.slice(0, -1);
    return key;
}
/**
 * 一个 inScope 条目**声明的是一段写域**（"这些路径的集合"）还是一个**具名文件**。
 *
 * ★ 口径：满足**任意一条**即算声明了一段写域 ——
 *
 *   ① 归一化之前以 `/` 结尾（`'src/'`、`'src/x/'`、`'./src/'`）
 *      ⇒ 字面写法就说了"这是一段面，不是一个点"。
 *   ② 归一化之后**没有扩展名**（`'src'`、`'scripts/fixtures'`）
 *      ⇒ 它指不出一个具体文件，所以它声明的是一段写域。
 *
 * ★★ 为什么 ② 不违反 brief 那句"**无扩展名即目录**这条启发式不许用"：
 *   那条被禁的启发式断言的是【**盘上**它是目录】—— 而本判据**不读盘**，
 *   所以它做不出那个断言，也不做。这里 ② 说的是**声明面**那一侧的事：
 *   `'src'` 指不出一个文件 ⇒ 读它的人无从知道"改的是哪一格" ⇒ 它是一段面。
 *   ⇒ ★ 于是 `['src']` 与 `['src/']` **同裁**（brief:79 明令这一条），
 *     而 `['src/a.ts']`（指得出一个文件）落 ok（brief:69 的形状）。
 *   ★ 一个**无扩展名的真文件**（`'LICENSE'`）会因此被算成一段面 —— 那是一条
 *     **已知的**误报，而它写在这里、与文件头"它会误报"那一节同一纪律。
 *
 * ★ 为什么 ① 只看原始写法、不看归一化结果：归一化**故意**让 `'src/'` 与 `'src'`
 *   折成同一个键（那正是 t3 要的"同裁"）；而 ① 是给**另一条**路径用的兜底，
 *   它对 `'./src/'`、`'src\\\\'` 这种写法也要认（归一化之前先折叠反斜杠）。
 *
 * ── ★★★ 这条线索（末段无扩展名 ⇒ 目录）**为什么不读盘**，以及它的**先例** ──────────
 *
 *   ★ 它是一条**关于声明面**的线索，不是一条**关于磁盘**的线索 —— 这两件事不同形：
 *
 *     · 被 brief 禁掉的那条启发式断言的是【**盘上** `'src'` 是一个目录】
 *       —— 那需要 `statSync`/`existsSync`，而本判据**不 import 任何 I/O**（性质 1）。
 *     · 本判据做的断言是【**这条声明**指不出一个具体文件】——
 *       那是一个**纯字符串**读数：`'src'` 的末段没有 `.`，所以读它的人
 *       无从知道"改的是哪一格"。★ 它**不声称**盘上有没有 `'src'`。
 *
 *   ⇒ ★★ 先例（同一仓库、同一条口径，**不是**本判据自己发明的）：
 *     `src/gates/contract/build-artifact-scope.ts` 的 `isDirectoryEntry`
 *     （约 `:179-197`）做的是**同一件事**：`raw.endsWith('/')` ⇒ 目录；
 *     否则 `!/\\.[A-Za-z0-9]+$/.test(normalized)`（**末段无扩展名**）⇒ 也算目录。
 *     它的注释把理由写得很清楚：「只认尾斜杠会让同一个意图的两种写法得到相反的裁决
 *     —— 而那种不一致会让这条判据读起来像随机噪音」，并明说**宽松的方向是对的**。
 *   ⇒ 本判据 ② 与它**逐字同一条判据**（末段没有 `.` ⇒ 目录），
 *     所以这不是一条为了应付 brief 而临时发明的启发式，而是**本仓库的既有口径**；
 *     ★ 而两者都**不读盘** —— `isDirectoryEntry` 也从未调用过 I/O。
 *
 *   ★ 一个**无扩展名的真文件**（`'LICENSE'`）会因此被算成一段面 —— 那是一条
 *     **已知的**误报，与 `build-artifact-scope` 承受的是**同一条**代价
 *     （它的注释也承认「它对无扩展名的源文件是宽松的」）。
 */
export function declaresScope(entry) {
    const raw = entry.trim().replace(/\\/gu, '/');
    if (raw.endsWith('/'))
        return true;
    const key = pathKey(entry);
    if (key === '')
        return false;
    /** ★ ② 末段没有 `.` ⇒ 指不出具体文件 ⇒ 它是一段声明面。 */
    const last = key.split('/').pop() ?? '';
    return !last.includes('.');
}
/**
 * ── ★★★ 信号：inScope 里的**目录前缀**（t3 的真判据；★ t3-R2 按裁定 B 改了口径）───
 *
 * ── 判定（★ 这是 B 之后的口径，与它上一版**不同**）─────────────────────────────
 *
 *   ① 一个**写域键**（`declaresScope` 对它的**原始写法**为真）⇒ **一律**进清单，
 *      **不看**它有没有被更具体的声明覆盖。
 *   ② 一个**具名文件键** ⇒ 只在**没被任何更具体的声明覆盖**时才进清单。
 *
 * 「一个声明 P 被覆盖」⇔ 存在**另一个**声明 Q（归一化后 Q ≠ P）满足
 * `Q.startsWith(P + '/')`。
 *
 * ── ★★ 为什么①不许用覆盖来豁免（裁定 B：这是本次的口径变更）────────────────────
 *
 *   上一版对①也做覆盖判定，于是 `['src/registry.ts','src/index.ts','src/']` ⇒ ok
 *   —— 理由是"`'src'` 被那两条更具体的声明覆盖了"。
 *
 *   ★ 而那个理由**替判据断言了一件它无从知道的事**：
 *     "`src/` 下只有那两条"是一个**关于磁盘的事实**；
 *     而"这个目录下有没有**未列出**的路径"在**字符串层面推不出来** ——
 *     判据**不读盘**（性质 1）。⇒ 被更具体的声明覆盖**不蕴含**穷尽。
 *
 *   ⇒ 裁定 B：写域声明**一律**算结构信号。覆盖判定只保留它能做的那个字符串层面的
 *     动作 —— 认出具名文件被更宽的写域收进去（`'src/x/y.ts'` 落在 `'src/x/'` 里）。
 *     ★ 注意这不是在防一个假阴性：它是"不读盘"这条**不可协商性质**的直接后果，
 *       所以它是**已知边界**（见本文件头与 `gate()` 里的 B 节），不是缺陷。
 *
 * ★ 两步（顺序不能换）：
 *   ① 把**每一条**条目归一化成路径键（`pathKey`）—— 折叠写法差别，去重。
 *   ② 对每一步的键分两类处置（写域 ⇒ 直接收；具名文件 ⇒ 看覆盖）。
 *   ⇒ ★ 第 ② 步**不看扩展名去读盘、不读盘**（性质 1）：`'src'` 单独出现算声明面，
 *       而 `'src/a.ts'` **永远不算写域** —— 哪怕盘上 `src/a.ts` 真是一个目录。
 *
 * ★ 它**返回字符串数组**（那些前缀），不是布尔 —— 因为"哪里没说清"必须能被指名，
 *   否则读的人拿到的只有一个"不行"。`gate()` 用 `.length > 0` 来裁决。
 *
 * ★★ 它**不读盘**（契约 §2 性质 1）：它判的是**这份声明**说不说得清那个目录下的哪一格，
 *   而不是"那个目录在不在盘上、是不是新的"。`src/gates/` 这种**一定存在**的目录，
 *   现在**也** blocked（B 之前它只在没被覆盖时 blocked）—— 而那条正是"不读盘"的后果。
 *
 * MEASURED（★ 按**最终裁定 γ** 重测，自己 import 真 `.js` 跑出来的 —— 全部逐条实测）：
 *
 *     ['src/']                                         ⇒ ['src']          ⇒ blocked
 *     ['src']                                          ⇒ ['src']          ⇒ blocked ★ 与 'src/' **同读数**
 *     ['./src/']                                       ⇒ ['src']          ⇒ blocked ★ 同上（同族归一化）
 *     ['src/a.ts','src/b.ts']                          ⇒ []               ⇒ **ok**
 *        ★ 具名文件**一律不进**清单 ⇒ 一份只列具名文件的契约**不开火**。
 *          ⇒ 这正是臂 3（"已知原子的契约不许 blocked"）那批形状的来源。
 *          ★★ 若让具名文件键进清单，则真实语料会变成 **ok 0 · blocked 94**（判据恒红）——
 *             那是 t38 花整轮修掉的病。见下面"为什么只收写域键"。
 *     ['src/registry.ts','src/index.ts']               ⇒ []               ⇒ **ok**
 *     ['src/registry.ts','src/index.ts','src/']        ⇒ ['src']          ⇒ **blocked**
 *        ★★★ 这一对**不同裁** —— 而这**不是**缺陷，是"不读盘"的直接后果：
 *          `'src/'` 是一条**写域声明** ⇒ 一律开火；而两份声明里**具名条目的多寡**
 *          **不影响任何一方**（上一行加不加 `'src/a.ts'` 全是 `['src']`，见 γ-1）。
 *          ⇒ 差异来自『声明面有没有写域』，**不是**来自『列出文件的多少』。
 *          ⇒ ★ 这是一条【已知边界】，由臂 4 的"如实降级"那段逐字写着。
 *            **不许**把它读成"已修好"，也**不许**把它读成"同裁成立"。
 *     ['src/a.ts','src/']                              ⇒ ['src']          ⇒ blocked（臂 1b 要的）
 *     ['src/x/','src/x/y.ts']                          ⇒ ['src/x']        ⇒ blocked
 *     ['src/','src/x/']                                ⇒ ['src','src/x']  ⇒ blocked
 *        ★ 同级写域 ⇒ **两条都开火**（读数两个键，理由里两条都出现）。
 *          ★ 而"写域被写域覆盖"（哪条真的被更深的写域收进去）的区分**需要读盘**，
 *            判据做不到 ⇒ 它**不**承诺"只报最深那条"（γ 的已知边界）。
 *     ['scripts/fixtures/']                            ⇒ ['scripts/fixtures'] ⇒ blocked
 *     ['docs/PLAN.md']                                 ⇒ []               ⇒ **ok**
 *        ★ 它是**具名文件**（末段带 `.`）⇒ 不进清单 ⇒ 放行。
 *          ★★ 而一个**纯文档单文件**任务因此**不再**被误报 —— 这是 γ 收窄口径的收益。
 *
 * ★ 由此得出**这条信号的全部内容**（一句话）：**清单 = 写域声明的路径键集合**。
 *   ⇒ 具名文件既不进清单，也不产生任何额外信号；它们只影响**信号 ②**（`scopeGroups`）
 *     与拆分建议，与 `gate()` 的裁决无关。
 *
 * ★ 为什么不用 `ROOT_LEVEL_DIRECTORIES` 过滤：那个集合是给**信号 ②**（跨几个概念组）
 *   用的，它回答"这个顶层名是不是一个目录"。本信号问的是另一个问题
 *   （"这一格有没有被更具体的声明说清"），而它**不需要**知道盘上有没有那个目录 ——
 *   那正是"不读盘"的意思。两个问题用两套口径，别合成一个。
 */
export function uncoveredDirectoryPrefixes(inScope) {
    const keys = [];
    /** ★ 与 `keys` 同步：哪些键在**原始写法**上声明的是一段写域。 */
    const scopeKeys = new Set();
    for (const entry of inScope) {
        if (typeof entry !== 'string')
            continue;
        const key = pathKey(entry);
        if (key === '')
            continue;
        if (declaresScope(entry))
            scopeKeys.add(key);
        if (!keys.includes(key))
            keys.push(key);
    }
    /** ★ 只对**具名文件键**做覆盖判定（写域键一律开火 —— 见 `uncoveredDirectoryPrefixes`）。 */
    const isCovered = (prefix) => keys.some((other) => other !== prefix && other.startsWith(`${prefix}/`));
    /**
     * ── ★★★ 约定 B（t3-R2）：**写域键一律开火**，覆盖判定不再豁免它们 ────────────────
     *
     *   `scopeKeys.has(key)` ⇒ 直接收进返回值（**无条件**，不看它有没有被覆盖）。
     *   否则（它是具名文件键）⇒ 只在**没被任何更具体的声明覆盖**时才收。
     *
     * ── 为什么 B 是对的（这是把上一版口径反过来）──────────────────────────────────
     *
     *   上一版（口径 C）豁免了"被更具体的声明覆盖"的写域键，于是
     *   `['src/registry.ts','src/index.ts','src/']` 判 ok。★ 而那不是修好了，
     *   那是**把两件事按同一档处理**：
     *
     *     · "`src/` 这个目录下有没有**未列出**的路径" —— 判据**不读盘**，
     *       所以它在**字符串层面推不出来**；
     *     · "`src/` 下只有 `src/registry.ts` 与 `src/index.ts`" —— 那是一个
     *       **关于磁盘的事实**，而本判据没有那个事实（性质 1：不读盘）。
     *
     *   ⇒ 拿"被更具体的声明覆盖"去豁免一个写域声明，等于**替一个不读盘的判据
     *     断言了一件它无从知道的事**。而裁定 B 说：**不许**这么豁免。
     *   ⇒ 一个写域声明（`declaresScope` 为真）**一律**算结构信号 ⇒ 无条件进清单。
     *
     * ── 覆盖判定**仍然在**，而它的作用域被收窄到具名文件键 ──────────────────────────
     *
     *   它现在只做一件它能做的事：`['src/x/','src/x/y.ts']` 里 `'src/x/y.ts'` 被
     *   `'src/x/'` 覆盖（前者在后者里面）—— 具名文件被更宽的写域收进去，那件事
     *   在字符串层面**是**能推出来的。
     *
     *   ── ★★★ 而"覆盖"在这里的作用是**收窄**，不是**开火** ────────────────────────
     *
     *   ★ 所以清单里**只收写域键**（`scopeKeys.has(key)`），具名文件键**一律不收**
     *     —— 它们不是"一段没说清的面"，它们是**一个点**。
     *   ⇒ ★★ 为什么具名文件键**不许**单独进清单（这是实测逼出来的，不是偏好）：
     *
     *     MEASURED：若让"没被覆盖的具名文件键"也进清单，则
     *       `['src/a.ts','src/b.ts']` ⇒ `['src/a.ts','src/b.ts']` ⇒ **blocked**
     *     ⇒ 而**真实 94 条语料**会变成 **ok 0 · blocked 94** ——
     *       **判据恒红**（每一条任务的 inScope 都列了具名文件）。
     *     ★ 那正是 t38 花整轮修掉的病（当时 39/39 全红），
     *       也是本文件头"恒红比恒真更坏：它阻断所有诚实的工作"那一段说的东西。
     *   ⇒ 具名文件键**永不单独开火**；覆盖判定只用来说明
     *     "这个具名文件落在某个更宽的写域里"（供读数与拆分建议用）。
     *   ★ 而这条与裁定 B **不冲突**：B 管的是**写域声明**一律开火
     *     （`'src/'` 不许被 `'src/registry.ts'` 豁免）—— 那一条**完整保留**在下面。
     */
    return keys.filter((key) => scopeKeys.has(key));
}
/**
 * ── 信号 ③：objective 里的**并列交付动词**（只记录，不单独判 blocked）────────────
 *
 * ★ 为什么单独不判：自然语言不可靠。一个 objective 里出现两个动词，
 *   可能是一次"改并测"（同一件事的两面），也可能真是两件事 —— 判据说不出区别。
 *   ⇒ 它只作为**旁证**进返回值，让读的人自己看。
 *
 * ★ 而"并列"的判据是**连词**（`and` / `并` / `且` / `以及` / `同时`），
 *   不是"动词出现次数" —— 一句话里两个动词用一个连词连着才是并列。
 */
const DELIVERY_VERBS = [
    'move', 'migrate', 'refactor', 'rewire', 'extract', 'split', 'rename', 'rewrite', 'replace',
    'add', 'implement', 'wire', 'fix', 'repair', 'remove', 'delete', 'merge', 'port',
    '搬运', '迁移', '重构', '重接', '抽出', '拆分', '改名', '重写', '替换',
    '新增', '实现', '接线', '修', '接上', '删除', '合并',
];
const CONJUNCTIONS = /\b(and|plus|then)\b|以及|并且|同时|且|并(?=[\u4e00-\u9fff])/iu;
/** 找出 objective 里**被连词并列**的交付动词（只用于旁证与措辞）。 */
export function conjoinedVerbs(objective) {
    if (typeof objective !== 'string' || objective.trim() === '')
        return [];
    const text = objective.toLowerCase();
    if (!CONJUNCTIONS.test(text))
        return [];
    const hits = [];
    for (const verb of DELIVERY_VERBS)
        if (text.includes(verb))
            hits.push(verb);
    return [...new Set(hits)];
}
/**
 * ── 拆分建议：**说清该拆成什么**（契约要求"给出可执行的拆分建议"）──────────────
 *
 * ★ 它必须**可执行**：读的人要能照着它建两个任务，而不是读一句"请拆细一点"。
 *   ⇒ 所以它按**判别面**来拆（每一个面一个任务），并带上那个面自己的 verify 命令
 *     与它碰到的 inScope 子集。那是本判据**能**给出的最小可执行形式 ——
 *     它知道的东西就这些，多一句都是编。
 */
export function splitSuggestion(surfaces, inScope) {
    const lines = [];
    surfaces.forEach((commands, index) => {
        const paths = commandFootprint(commands[0] ?? '');
        lines.push(`task ${index + 1}: verify = ${JSON.stringify(commands)}`
            + (paths.length === 0 ? '' : ` — touches ${JSON.stringify(paths)}`));
    });
    if (surfaces.length <= 1 && inScope.length > 0) {
        const groups = scopeGroups(inScope);
        groups.forEach((group, index) => {
            lines.push(`task ${index + 1}: inScope = ${JSON.stringify(inScope.filter((path) => path.replace(/^\.\//u, '').split('/')[0] === group || (group === 'src' && /^(src|lib|scripts)\//u.test(path.replace(/^\.\//u, '')))))}`);
        });
    }
    return lines;
}
/**
 * 这条判据**什么时候说话**。
 *
 * ★ 与另两条 contract 判据同一条口径：闸门管"说不说话"，`requires` 管"说话时缺不缺输入"。
 *
 *   质量类任务 + 契约在场   ⇒ 说话
 *   其余（`work` 类、契约缺席）⇒ 不说话（skipped，不是"缺输入"，也不是"原子"）
 *
 * ★ 为什么不判 `work` 类：它们的契约**本来就不要求** verify / inScope
 *   （见 `contract.build-artifact-scope` 的同一段论证）。对它们判原子性
 *   会在每一个普通任务上产出噪音 —— 而噪音会教人忽略门禁。
 */
export function appliesTo(ctx) {
    if (ctx === undefined)
        return false;
    const task = ctx.task;
    if (task === undefined || task === null)
        return false;
    return QUALITY_KINDS.has(task.kind ?? 'work');
}
export function gate(ctx) {
    const task = ctx?.task;
    const verify = Array.isArray(task?.verify) ? task.verify.filter((item) => typeof item === 'string' && item.trim() !== '') : undefined;
    const inScope = Array.isArray(task?.inScope) ? task.inScope.filter((item) => typeof item === 'string' && item.trim() !== '') : undefined;
    /**
     * ── ★★ 三态的第一态：**判不了**（`unmeasured`）────────────────────────────────
     *
     * MEASURED（这条判据的核心口径，也是最容易做错的一格）：
     * 两条信号**都**读不到时，本判据**说不出**这个任务能不能归因 ——
     * 而"说不出"**绝不允许**当成"原子"。
     *
     *   verify 缺席 **且** inScope 缺席 ⇒ 判别面与写域都无从得知 ⇒ `unmeasured`
     *
     * ★ 为什么不是 ok：`ok` 是"我看了，它原子"。而这里我**没得看**。
     *   把它报成 ok 会让"契约没写清"与"契约写得原子"在读数上同形 ——
     *   而前者恰恰是**最该被说出来的**那一种（一个连判别面都没写的契约，
     *   它的失败必然不可归因）。
     *
     * ★ 为什么一条在场就够：一条 verify ⇒ 信号 ① 有得算；一个 inScope ⇒ 信号 ② 有得算。
     *   两者都缺席才是真的没得看。
     */
    if (verify === undefined && inScope === undefined) {
        return unmeasured(`cannot judge whether this task is atomic: the contract carries neither a verify list nor an inScope, `
            + `so there is no discriminating surface to count and no write scope to compare — `
            + `"cannot judge" is NOT the same as "atomic", and a task whose contract states neither `
            + `is precisely the kind whose failure cannot be attributed`);
    }
    /** 信号 ①：判别面的条数。 */
    const surfaces = verify === undefined ? [] : discriminatingSurfaces(verify);
    /** 信号 ②：写域跨了几组。 */
    const groups = inScope === undefined ? [] : scopeGroups(inScope);
    /** 信号 ③：并列动词（旁证）。 */
    const verbs = conjoinedVerbs(task?.objective);
    /**
     * ── 裁决：**① 为主，② 加重，③ 只记录** ────────────────────────────────────────
     *
     * ★ 三条信号的不对称是刻意的，理由见文件头"为什么主判据是 ①"。
     */
    /**
     * ── ★★★ 真实语料实测**否定了**我第一版的信号（t38，最重要的修正）──────────────
     *
     * 第一版判「判别面 > 1 或 写域跨组 > 1」。拿**真实的 39 条质量任务**跑：
     *
     *     ok 0 · blocked 39        ⇒ **100% 判"不原子"**
     *
     * ★ 根因：**那是两个常数，不是两个变量。**
     *   · verify 条数 —— 每个任务的 verify 都是 `pnpm build / typecheck / <套件> /
     *     test:gates / verify` 这套仓库惯例（3–6 条）⇒ 数它 = 数"本仓库有几条验证惯例"。
     *   · inScope 跨组 —— `src`/`lib` 已被豁免，而语料里**没有**跨别的组的任务。
     * ⇒ 两个信号在真实语料上**恒为真**，于是判据恒红。而恒红阻断一切诚实的工作。
     *
     * ── 换成什么：**只有一个信号真的分开了样本** ──────────────────────────────────
     *
     *     信号                                      命中（39 条）
     *     `inScope` 里有【目录条目】                  ⇒ t30, t39      ← 且这两个正是已知不原子
     *     `inScope` 目录条目 > 1                      ⇒ t30, t39
     *     项目级 verify > 1                           ⇒ t25, t35      ← ★ 含已知**原子**的 t35 ⇒ 误伤
     *
     * ★ 而它为什么**语义上**说得通（不只是拟合样本）：
     *   一个 inScope 里出现【目录】而不是文件，意味着这个任务会**创建/重组一个目录**
     *   —— 那是一次**结构改动**，而结构改动的失败模式**不止一种**（新文件放错位置、
     *   旧引用没跟上、目录布局本身被否定）。
     *   ⇒ 一个"改若干**已存在的**文件"的任务，失败原因是可数的；
     *     一个"造一个新目录"的任务，失败原因是**开放的**。
     *
     * ── ★★★ t3 把上面这个信号**修准了**（它此前判的是字符串末字符）──────────────────
     *
     * MEASURED（t43 证伪，t3 修好）：当时的实现是
     * `(inScope ?? []).filter((path) => path.trim().endsWith('/'))` ——
     * **字符串最后一个字符**。于是：
     *
     *     ['src/registry.ts','src/index.ts']            ⇒ ok
     *     ['src/registry.ts','src/index.ts','src/']     ⇒ blocked      ★ 同一件工作，相反裁决
     *
     * ⇒ 现在换成 `uncoveredDirectoryPrefixes`（归一化 `pathKey` + `declaresScope` 分类）：
     *   `'src/'` 归一化成键 `'src'`，而 `'src'` 是一段**写域声明** ⇒ 它**一律**开火。
     *   ★ 为什么不是"写域可被更具体的声明覆盖就豁免"：那是**口径 C**（旧协议），
     *     它用"被更具体的声明覆盖"豁免写域声明 —— 而那等于替一个**不读盘**的判据断言
     *     "那个目录下没有未列出的路径"，那是**字符串层面推不出来**的事（性质 1）。
     *   ⇒ **最终裁定 γ**：**写域条目一律开火；具名文件不产生额外信号。**
     *
     * ── ★★★ γ 的后果：落点变了，而**它不是回归**（必须写明）──────────────────────────
     *
     *   ★ γ 之后清单**只由写域键构成**（`keys.filter((key) => scopeKeys.has(key))`）——
     *     具名文件键**一律不进**清单，也不产生任何额外信号。
     *
     *   ⇒ 于是读数与旧版的对应关系**逐条如下**（别把它读成"判据变松了"）：
     *
     *       ['src/registry.ts','src/index.ts']          ⇒ []      ⇒ **ok**（旧版：blocked）
     *          ★ 这一行**回到 ok** —— 因为一份只列具名文件、没有任何写域声明的契约
     *            确实没有"没说清的面"：它把要改的**点**逐个指了出来。
     *          ★★ 而它与臂 3（"已知原子的契约不许 blocked"）**不再冲突**：
     *             臂 3 的每一条（`['src/a.ts']`、`['src/x.ts','src/y.ts']`、
     *             `['package.json','scripts/x.mjs','docs/x.md']`…）现在**全部 ok**，
     *             与臂 3 的期望**逐条一致**。这正是收窄口径要买的东西。
     *       ['src/registry.ts','src/index.ts','src/']   ⇒ ['src']  ⇒ **blocked**
     *          ★ 这两行**不同裁** —— 而差异**只**来自"声明面里有没有写域条目"，
     *            **不是**来自"列了几个文件"（见 γ-1 的读数断言）。
     *          ⇒ ★ 它是【已知边界】（"不读盘"的直接后果），**不是**"已修好"，
     *            也**不是**"同裁成立"。逐字写在臂 4 的"如实降级"那一段里。
     *       ['src/']                                    ⇒ ['src']  ⇒ blocked（臂 1b 要的）
     *       ['src/a.ts','src/b.ts']                     ⇒ []       ⇒ ok
     *          ★ 若让具名文件键进清单，则真实语料会变成 **ok 0 · blocked 94** —— 判据恒红。
     *
     * ── ★ 而它的边界我必须写明（这是本队纪律：不藏剩余代价）────────────────────────
     *
     *   语料里只有 **2 个正例**（t30/t39），而它们**恰好**都是"要新建目录"的任务
     *   ⇒ "写域声明"与"不原子"在样本上**重合**，而两个假设**无法分辨**。
     *   一个**新建目录的原子任务**（例如"新建一个目录并放一个文件进去"）会被误伤 ——
     *   而语料里没有这样的样本可以证伪它。
     *   ★ 而 γ 之后这条误报的**理由**（理由必须说真实的那一条）是：
     *     它红**不是**因为"字符串以 / 结尾"，而是因为**这份声明里出现了一段写域，
     *     而该写域下的哪一格没有被说清** —— 即"这个目录下有什么"在这份契约里看不见，
     *     所以它的失败原因开放。
     *
     *   ★★ 真实语料实测（★ γ 之后重测，**这是本判据的 ground truth**）：
     *
     *       ok 41 · blocked 2 · unmeasured 0 · skipped 0（`scripts/fixtures/gate-corpus.json`，43 条）
     *       blocked 的 2 条：t30, t39
     *       ★ 而这 2 条**都含有写域声明**；**没有一条**是"只有具名文件"而被判红的。
     *
     *   ⇒ ★ 所以本判据**不接生产**（它是诊断），而这条边界写在这里供下一个人判断。
     *     「一份『看起来能分开』的信号，可能只是**在两个样本上重合**。」
     */
    const uncovered = uncoveredDirectoryPrefixes(inScope ?? []);
    const touchesNewStructure = uncovered.length > 0;
    /**
     * ★★ 裁决的形状（语料实测后的最终版）：
     *
     *   结构改动（inScope 里有目录条目）  ⇒ **单独**足以判"不原子"
     *   其余                             ⇒ 不判（诊断，不拦）
     *
     * ★ 为什么"结构改动"单独成立而"多个判别面"不：语料实测 ——
     *   verify 条数是仓库惯例的常数（每个任务 3–6 条），数它 = 恒红；
     *   而"新建/重组目录"在 39 条里只有 2 条命中，而那两条正是已知不原子的。
     */
    const tooManySurfaces = touchesNewStructure;
    /**
     * ── ★★★ 语料实测**第二次**否定了我的信号：`scopeGroups` 也不能判（t38）──────────
     *
     * MEASURED（语料从 39 条长到 44 条时暴露）：新出现的两个任务
     * （t45 `scripts/* + docs/*.md`、t47 `package.json + scripts/* + docs/*`）
     * 被 `scopeGroups > 1` 判成了**不原子** —— 而它们是**两件很正当的单一工作**
     * （"加一个探针脚本并写它的说明"、"把台账 HTML 接进流程"）。
     *
     * ★ 根因：**"跨目录"是文档工作的常态**。一个写脚本的人**总是**同时改
     *   `scripts/` 与 `docs/`（说明跟着代码走）。⇒ 那个信号在**新增样本上立刻失效**。
     *
     * ⇒ 而它从未被独立检验过：第一版语料里**没有**任何"跨 docs/scripts 的原子任务"，
     *   于是"跨组"与"不原子"在那份样本上**恰好不冲突** —— 而那只是**样本的巧合**
     *   （与"目录条目恰好只在 t30/t39"是同一种巧合，只是这次它被抓到了）。
     *
     * ★ 结论：**只用有证据的那个信号**（结构改动 = inScope 里有目录条目）。
     *   `scopeGroups` 仍然**照常报出来**（它是读数），但**不参与裁决**。
     *
     * ★★ 这一条值得单独记：**一个信号"在语料上成立"不等于它成立** ——
     *   语料会长大，而没被反例检验过的信号会在下一次长大时失效。
     *   判别动作：问「**什么样本会证伪它**？」—— 若答不出来，它还没被检验过。
     */
    const tooManyGroups = false;
    /**
     * ★ `unmeasured` 的第二态：**该有的那几格在场、但不构成可判的形状**。
     *   例如 verify 在场而**全是空串**（被上面的 filter 清掉了）——
     *   那时 `verify` 是 `[]`（在场），`surfaces` 是 `[]`（无从算判别面）。
     *   ⇒ 这也是"我说不出"，不是"它原子"。
     */
    if (verify !== undefined && verify.length === 0 && inScope === undefined) {
        return unmeasured(`cannot judge whether this task is atomic: the contract declares a verify list but every entry is blank, `
            + `and there is no inScope — a blank command is not a discriminating surface, so counting them would report "0 reasons" `
            + `for a task that has no reason written down at all`);
    }
    if (!tooManySurfaces && !tooManyGroups) {
        return {
            ok: true,
            /**
             * ★ 通过时**也把三个读数交出去**（与 `verify-command` 交出 `verifyProbe` 同构）：
             *   "我看着 atomic"这句话没有信息量；"判别面 1 条、写域 1 组、并列动词 0 个"
             *   才有 —— 而且它能被独立复核。
             */
            atomicityReadout: {
                /**
                 * ★ 主信号（★ t3 改了**口径**，而**名字与类型不变**）：`inScope` 里
                 *   **没有被任何一个更具体的声明覆盖**的目录前缀条数。
                 *
                 * ★ 为什么名字不许改：`scripts/gate-task-atomicity.test.mjs` 臂 1 用
                 *   `deepEqual(atomicityReadout, {...})` 钉着这四格，而那是"读数形状"的契约。
                 *   ⇒ 口径可以在注释里说清，名字不能悄悄换。
                 *
                 * ★ 而 `discriminatingSurfaces` 与 `scopeGroups` **仍然照常报出来** ——
                 *   它们是读数，不是裁决依据。语料实测证明它们不能用来判（那不是变量）。
                 *   ⇒ 保留它们是为了**攒语料**：等样本够了再决定要不要给它们否决权。
                 */
                directoryEntries: uncovered.length,
                discriminatingSurfaces: surfaces.length,
                scopeGroups: groups.length,
                conjoinedVerbs: verbs,
            },
        };
    }
    /**
     * ── blocked：说清【为什么】与【该拆成什么】────────────────────────────────────
     */
    const reasons = [];
    /**
     * ★★ 理由必须说**真实的那一条**（语料实测后的修正）：
     *
     *   第一版这里报的是 "N discriminating surfaces: …"，而判据实际上**不靠它**判
     *   （它是仓库惯例的常数，语料实测 39/39 都 > 1）。
     *   ⇒ 一条**理由与判据不一致**的 blocker，读的人会去改 verify 列表 ——
     *     而那不是能修好它的动作。**理由必须指名那个真的把它判红的信号。**
     */
    if (tooManySurfaces) {
        /**
         * ★ 理由里把前缀**带尾斜杠**报出来（`"src/tools/"`），而不是归一化后的键（`"src/tools"`）——
         *   归一化是**判据内部**的口径（它让 `'src/'` 与 `'src'` 同裁）；
         *   而**报给人看**的时候要还原成"这是一段写域"的形状，否则读的人会以为
         *   判据在说"某个叫 src/tools 的东西"。★ 两种写法的裁决相同，只是**显示**不同。
         */
        reasons.push(`inScope names ${uncovered.length} directory prefix(es) (${uncovered.map((key) => `"${key}/"`).join(', ')}) `
            + `that no more specific entry covers, `
            + `so this task creates or restructures a directory — a structural change whose failure modes are open-ended `
            + `(a new file in the wrong place, a stale reference, the layout itself being wrong), not a fixed list`);
    }
    if (tooManyGroups) {
        reasons.push(`${groups.length} independent scope groups: ${JSON.stringify(groups)}`);
    }
    const blockers = [
        `this contract is not atomic: it carries ${reasons.join('; ')}. `
            + `A failure here cannot be attributed to one cause — when the task goes red you would have to work out WHICH of these failed, `
            + `and that costs a conversation rather than a glance.`,
    ];
    const suggestion = splitSuggestion(surfaces, inScope ?? []);
    if (suggestion.length > 0) {
        blockers.push(`split it into atomic tasks (one discriminating surface each): ${suggestion.join(' / ')}`);
    }
    if (verbs.length > 0) {
        /**
         * ★ 信号 ③ 出现在**建议**里而不是**理由**里 —— 它是旁证，不是判据。
         *   而放在建议里是诚实的：它给了"为什么可能真的该拆"的一层人话依据，
         *   而读的人可以不同意它（因为它不可靠），却仍然要处理上面那条机械的理由。
         */
        blockers.push(`the objective also conjoins several delivery verbs (${verbs.join(', ')}), which is consistent with this being two jobs `
            + `— this signal is advisory only and may be wrong (natural language), so it is not the reason for the refusal`);
    }
    return blocked(blockers, [
        `★ The point is attribution, not size: one discriminating surface means a red is one fact; several mean the red is a question.`,
        `★ False positives are real here — that is why this gate starts in the observe set (AGENT_TEAMS_OBSERVE_GATES). `
            + `If a task genuinely needs several unrelated commands, the honest fix is either to split it or to declare ONE command that covers the whole job.`,
    ]);
}
