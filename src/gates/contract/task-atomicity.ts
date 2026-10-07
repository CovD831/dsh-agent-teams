/**
 * ── 判据：契约【声明面的形状】是不是可能不可归因（★ 而不是"够不够原子"）─────────
 *
 * 插入点：`contract`（建任务 / 改契约 —— 契约 §1 ①）
 *
 * ── ★★★ 开头这句是 t75 改过的，而它原来写的是「够不够【原子】」 ────────────────
 *
 * MEASURED（t43 证伪，t69 又撞到一次，t75 复现）：
 *
 *     同一件工作，两种写法：
 *       ['src/registry.ts', 'src/index.ts']          ⇒ ok
 *       ['src/registry.ts', 'src/index.ts', 'src/']   ⇒ blocked
 *
 *     ⇒ 而判据实际只做 `path.trim().endsWith('/')` —— **它判的是字符串最后一个字符。**
 *
 * ★ 所以本文头、以及 `description`（控制台渲染给读的人看的那一句）都**不许**
 *   再声称它判"原子性" —— 那是替一个**已知做不到的结论**作证。
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
 * ── 三条不可协商的性质（契约 §2）──────────────────────────────────────────────
 *
 * ① 纯数据变换：不 import 任何 I/O —— 只读契约里的字符串，不读磁盘、不跑命令。
 * ② 不调用别的判据。
 * ③ 三态：ok / blocked / unmeasured，且后两者**不同形**。
 *    ★ 而"判不了"**绝不允许**当成"原子"：没有 verify 也读不到 inScope ⇒
 *      `unmeasured`（它就是"我说不出这个任务能不能归因"）。
 */

import { ok, blocked, unmeasured, type GateVerdict } from '../registry.ts'
import type { CtxPaths } from '../requires.ts'

export const id = 'contract.task-atomicity'
export const point = 'contract'
/**
 * ── ★★★ 它判的是【字符串形状】，**不是**「原子性」（t75 / t43 / t69）─────────────
 *
 * MEASURED：t43 用一对**同一件工作**（`['src/registry.ts','src/index.ts']` 与
 * 在它基础上多一个 `'src/'`）证伪了这个信号 —— 两边的工作完全相同，而判据
 * 一个 ok、一个 blocked。
 *
 * ⇒ 而本判据实际上只做 `path.trim().endsWith('/')`：**它判的是字符串最后一个字符。**
 *
 * ★★ 所以 `description` 里【不许】再出现"够不够原子"这类措辞 ——
 *   它是**控制台渲染给读的人看的那一句**（`registry.ts`：`description` 是
 *   "the console renders it"）。把它写成"判原子性"，就是在替一个
 *   **已知做不到的结论**作证 —— 而那正是本队记了一整天的那个形态：
 *   **一句话里的每个名词，能不能指出它的来源？**
 *
 * ⇒ 新的措辞**如实说出它做了什么**，并把那件事的边界写在句子里：
 *   · 它判的是【声明面的形状】（verify 条数 / inScope 的分组 / 并列动词）
 *   · 而"形状不原子"是"失败可能不可归因"的**一个征兆**，不是它的判据
 *   · 且它**不接生产**（t38 刻意如此），所以这句话只对直接调用它的人有效
 */
export const description =
  '★ 它判的是【契约声明面的形状】，不是「原子性」本身 —— 三条可机械读出的信号：verify 的条数与覆盖面、inScope 是否跨了概念上独立的目录组、objective 是否列了多个并列交付。★ 而"形状看起来不原子"只是"失败可能不可归因"的一个【征兆】，不是它的判据（t43 已用"只差一个尾斜杠的同一件工作"证伪过那个更强的声称）。判不了时报 unmeasured（绝不当成原子）。★ 本判据【不接生产】（t38：接线会让没有 verify 的任务全部建不出来）'

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
export const requires: CtxPaths<TaskAtomicityContext>[] = ['task']

interface TaskAtomicityContext {
  /**
   * 待建 / 待改的任务契约。
   *
   * ★ 与 `build-artifact-scope` 的同一份形状：只读我们真的用到的字段，
   *   全可选 —— 因为"哪几格在场"本身就是本判据的输入。
   */
  task?: {
    kind?: string
    subject?: string
    objective?: string
    inScope?: string[]
    verify?: string[]
  }
  /**
   * ★ 建 vs 改。与 `verify-command` 同源：契约位置有两个调用点，
   *   而"改契约"那一刻同样要能判原子性（一个任务被改得不原子了，那也是缺陷）。
   */
  creating?: boolean
  /** 已建的旧契约（改契约时用来对照"这次改动有没有让它变得不原子"）。 */
  amended?: readonly string[]
}

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
])

/** 只有质量类任务才有"判别面"这回事；`work` 类不判（它没有 verify 的契约要求）。 */
const QUALITY_KINDS = new Set([
  'requirements', 'implementation', 'verification', 'review', 'repair', 'integration',
])

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
export function commandFootprint(command: string): string[] {
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
    .map((token) => token.replace(/^\.\//u, ''))
  return [...new Set(tokens)].sort()
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
export function sameFootprint(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false
  const a = [...left].sort().join('\u0000')
  const b = [...right].sort().join('\u0000')
  if (a === b) return true
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const leftSubset = left.every((path) => rightSet.has(path))
  const rightSubset = right.every((path) => leftSet.has(path))
  return leftSubset || rightSubset
}

/**
 * 把 verify 清单折算成**判别面**（每个面是一组同覆盖面的命令）。
 *
 * ★ 返回的是**分组**而不是计数：因为"说清该拆成什么"要用到每一组的内容
 *   （见 `splitSuggestion`）。只给一个数字的判据说不出补救动作。
 */
export function discriminatingSurfaces(verify: readonly string[]): string[][] {
  const groups: string[][] = []
  for (const command of verify) {
    const footprint = commandFootprint(command)
    /**
     * ★ `group[0] ?? ''`：`noUncheckedIndexedAccess` 下数组下标是 `string | undefined`。
     *   ★ 而这里**不能**用 `group[0]!`：一个空组会让 `commandFootprint('')` 返回 `[]`，
     *     于是 `sameFootprint([], …)` 恒为 false（见它的第 ② 条）—— 那正是想要的语义
     *     （空组不吞任何命令），而不是一个被断言掩盖的崩溃点。
     */
    const hit = groups.find((group) => sameFootprint(commandFootprint(group[0] ?? ''), footprint))
    if (hit === undefined) groups.push([command])
    else hit.push(command)
  }
  return groups
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
export function scopeGroups(inScope: readonly string[]): string[] {
  const groups = new Set<string>()
  for (const path of inScope) {
    const normalized = path.replace(/\\/gu, '/').replace(/^\.\//u, '').trim()
    if (normalized === '') continue
    const top = normalized.split('/')[0] ?? ''
    groups.add(top)
  }
  /**
   * ★ `lib` 归并到 `src`（构建产物的两种形态）；`scripts` 也归并到 `src`
   *   （一条判据的两个文件）。⇒ 归并后 `groups` 里的 `src` 代表"这个仓库的源码面"。
   */
  if (groups.has('lib')) { groups.delete('lib'); groups.add('src') }
  if (groups.has('scripts')) { groups.delete('scripts'); groups.add('src') }
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
    if (!ROOT_LEVEL_DIRECTORIES.has(name)) groups.delete(name)
  }
  return [...groups].sort()
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
] as const

const CONJUNCTIONS = /\b(and|plus|then)\b|以及|并且|同时|且|并(?=[\u4e00-\u9fff])/iu

/** 找出 objective 里**被连词并列**的交付动词（只用于旁证与措辞）。 */
export function conjoinedVerbs(objective: string | undefined): string[] {
  if (typeof objective !== 'string' || objective.trim() === '') return []
  const text = objective.toLowerCase()
  if (!CONJUNCTIONS.test(text)) return []
  const hits: string[] = []
  for (const verb of DELIVERY_VERBS) if (text.includes(verb)) hits.push(verb)
  return [...new Set(hits)]
}

/**
 * ── 拆分建议：**说清该拆成什么**（契约要求"给出可执行的拆分建议"）──────────────
 *
 * ★ 它必须**可执行**：读的人要能照着它建两个任务，而不是读一句"请拆细一点"。
 *   ⇒ 所以它按**判别面**来拆（每一个面一个任务），并带上那个面自己的 verify 命令
 *     与它碰到的 inScope 子集。那是本判据**能**给出的最小可执行形式 ——
 *     它知道的东西就这些，多一句都是编。
 */
export function splitSuggestion(surfaces: readonly string[][], inScope: readonly string[]): string[] {
  const lines: string[] = []
  surfaces.forEach((commands, index) => {
    const paths = commandFootprint(commands[0] ?? '')
    lines.push(
      `task ${index + 1}: verify = ${JSON.stringify(commands)}`
      + (paths.length === 0 ? '' : ` — touches ${JSON.stringify(paths)}`),
    )
  })
  if (surfaces.length <= 1 && inScope.length > 0) {
    const groups = scopeGroups(inScope)
    groups.forEach((group, index) => {
      lines.push(`task ${index + 1}: inScope = ${JSON.stringify(inScope.filter((path) => path.replace(/^\.\//u, '').split('/')[0] === group || (group === 'src' && /^(src|lib|scripts)\//u.test(path.replace(/^\.\//u, ''))))) }`)
    })
  }
  return lines
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
export function appliesTo(ctx: TaskAtomicityContext | undefined): boolean {
  if (ctx === undefined) return false
  const task = ctx.task
  if (task === undefined || task === null) return false
  return QUALITY_KINDS.has(task.kind ?? 'work')
}

export function gate(ctx: TaskAtomicityContext): GateVerdict {
  const task = ctx?.task
  const verify = Array.isArray(task?.verify) ? task!.verify!.filter((item) => typeof item === 'string' && item.trim() !== '') : undefined
  const inScope = Array.isArray(task?.inScope) ? task!.inScope!.filter((item) => typeof item === 'string' && item.trim() !== '') : undefined

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
    return unmeasured(
      `cannot judge whether this task is atomic: the contract carries neither a verify list nor an inScope, `
      + `so there is no discriminating surface to count and no write scope to compare — `
      + `"cannot judge" is NOT the same as "atomic", and a task whose contract states neither `
      + `is precisely the kind whose failure cannot be attributed`,
    )
  }

  /** 信号 ①：判别面的条数。 */
  const surfaces = verify === undefined ? [] : discriminatingSurfaces(verify)
  /** 信号 ②：写域跨了几组。 */
  const groups = inScope === undefined ? [] : scopeGroups(inScope)
  /** 信号 ③：并列动词（旁证）。 */
  const verbs = conjoinedVerbs(task?.objective)

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
   *     `inScope` 里有【目录条目】（以 `/` 结尾）   ⇒ t30, t39      ← 且这两个正是已知不原子
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
   * ── ★ 而它的边界我必须写明（这是本队纪律：不藏剩余代价）────────────────────────
   *
   *   语料里只有 **2 个正例**（t30/t39），而它们**恰好**都是"要新建目录"的任务
   *   ⇒ "跨目录数"与"不原子"在样本上**重合**，而两个假设**无法分辨**。
   *   一个**新建目录的原子任务**（例如"新建一个目录并放一个文件进去"）会被误伤 ——
   *   而语料里没有这样的样本可以证伪它。
   *
   *   ⇒ ★ 所以本判据**不接生产**（它是诊断），而这条边界写在这里供下一个人判断。
   *     「一份『看起来能分开』的信号，可能只是**在两个样本上重合**。」
   */
  const directoryEntries = (inScope ?? []).filter((path) => path.trim().endsWith('/'))
  const touchesNewStructure = directoryEntries.length > 0
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
  const tooManySurfaces = touchesNewStructure
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
  const tooManyGroups = false
  /**
   * ★ `unmeasured` 的第二态：**该有的那几格在场、但不构成可判的形状**。
   *   例如 verify 在场而**全是空串**（被上面的 filter 清掉了）——
   *   那时 `verify` 是 `[]`（在场），`surfaces` 是 `[]`（无从算判别面）。
   *   ⇒ 这也是"我说不出"，不是"它原子"。
   */
  if (verify !== undefined && verify.length === 0 && inScope === undefined) {
    return unmeasured(
      `cannot judge whether this task is atomic: the contract declares a verify list but every entry is blank, `
      + `and there is no inScope — a blank command is not a discriminating surface, so counting them would report "0 reasons" `
      + `for a task that has no reason written down at all`,
    )
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
         * ★ 主信号：inScope 里有没有【目录条目】（= 会创建/重组一个目录）。
         *
         * ★ 而 `discriminatingSurfaces` 与 `scopeGroups` **仍然照常报出来** ——
         *   它们是读数，不是裁决依据。语料实测证明它们不能用来判（那不是变量）。
         *   ⇒ 保留它们是为了**攒语料**：等样本够了再决定要不要给它们否决权。
         */
        directoryEntries: directoryEntries.length,
        discriminatingSurfaces: surfaces.length,
        scopeGroups: groups.length,
        conjoinedVerbs: verbs,
      },
    }
  }

  /**
   * ── blocked：说清【为什么】与【该拆成什么】────────────────────────────────────
   */
  const reasons: string[] = []
  /**
   * ★★ 理由必须说**真实的那一条**（语料实测后的修正）：
   *
   *   第一版这里报的是 "N discriminating surfaces: …"，而判据实际上**不靠它**判
   *   （它是仓库惯例的常数，语料实测 39/39 都 > 1）。
   *   ⇒ 一条**理由与判据不一致**的 blocker，读的人会去改 verify 列表 ——
   *     而那不是能修好它的动作。**理由必须指名那个真的把它判红的信号。**
   */
  if (tooManySurfaces) {
    reasons.push(
      `inScope names ${directoryEntries.length} directory entr(ies) (${directoryEntries.map((path) => `"${path}"`).join(', ')}), `
      + `so this task creates or restructures a directory — a structural change whose failure modes are open-ended `
      + `(a new file in the wrong place, a stale reference, the layout itself being wrong), not a fixed list`,
    )
  }
  if (tooManyGroups) {
    reasons.push(`${groups.length} independent scope groups: ${JSON.stringify(groups)}`)
  }

  const blockers = [
    `this contract is not atomic: it carries ${reasons.join('; ')}. `
    + `A failure here cannot be attributed to one cause — when the task goes red you would have to work out WHICH of these failed, `
    + `and that costs a conversation rather than a glance.`,
  ]
  const suggestion = splitSuggestion(surfaces, inScope ?? [])
  if (suggestion.length > 0) {
    blockers.push(`split it into atomic tasks (one discriminating surface each): ${suggestion.join(' / ')}`)
  }
  if (verbs.length > 0) {
    /**
     * ★ 信号 ③ 出现在**建议**里而不是**理由**里 —— 它是旁证，不是判据。
     *   而放在建议里是诚实的：它给了"为什么可能真的该拆"的一层人话依据，
     *   而读的人可以不同意它（因为它不可靠），却仍然要处理上面那条机械的理由。
     */
    blockers.push(
      `the objective also conjoins several delivery verbs (${verbs.join(', ')}), which is consistent with this being two jobs `
      + `— this signal is advisory only and may be wrong (natural language), so it is not the reason for the refusal`,
    )
  }
  return blocked(blockers, [
    `★ The point is attribution, not size: one discriminating surface means a red is one fact; several mean the red is a question.`,
    `★ False positives are real here — that is why this gate starts in the observe set (AGENT_TEAMS_OBSERVE_GATES). `
    + `If a task genuinely needs several unrelated commands, the honest fix is either to split it or to declare ONE command that covers the whole job.`,
  ])
}
