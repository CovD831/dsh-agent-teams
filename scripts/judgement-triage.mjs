#!/usr/bin/env node
/**
 * ── 判决 → 判据：三处判断的【自动分类器】（t65）────────────────────────────────
 *
 * 用户的原话（这是本文件存在的全部理由）：
 *
 *     「是否该记录为可沉淀的经验这点需要做自动判断，而不是交给我，
 *       然后哪些经验能自动去做成判据也得自动化。」
 *
 * 而在此之前，这三处判断**全部靠 captain 手写**（判决 JSON + 提案表格）。
 * 本文件把它们变成一条可执行、可复现、可被质疑的规则。
 *
 * ── 三处判断，各自的判据（captain 已推导，本文件把它实现出来）──────────────────
 *
 *   ①【值不值得记成判决】
 *       判据：它能不能被写成一条【对某个输入返回真/假】的断言？
 *       能 ⇒ 判决；不能 ⇒ 纪律（只写文档）。
 *
 *   ②【能不能机械化】
 *       判据：那条断言读的东西【是不是现成可取的】？
 *       源码文本 / 文件系统 / git / 注册表读数 ⇒ 可机械化
 *       需要「理解任务在做什么」             ⇒ 只能诊断
 *       ★ 而"现成可取"有**第四类**（verifier6 报、captain 转来的）：
 *         **别的机制有没有把东西送过来**（表在不在、loader 注没注）——
 *         那同样是可机械检查的，而不是 diagnosis。
 *
 *   ③【做成什么形状】
 *       由【输入的种类】决定（一条映射表，见 {@link SHAPE_BY_INPUT}）。
 *
 * ── ★★ 输出是【四态】，而不是三态 ────────────────────────────────────────────────
 *
 *     `gate`        —— 可机械化，附建议形状（source-scan / disk-scan /
 *                       task-creation / completion / fixture-helper）
 *     `diagnosis`   —— 只能诊断（标记给人看，不拦）
 *     `discipline`  —— 表达不出断言（只能写进纪律）
 *     `unmeasured`  —— ★ **判不了**（claim 太含糊、或没给 claim）
 *
 * ★ 第四态**不得并进任何一态**：本队最贵的那条纪律是
 *   「'判不了'与'判了没问题'必须不同形」。一个把"看不出来"归到 `diagnosis`
 *   的实现会让"我读不懂这条 claim"伪装成"我读懂了、它只能诊断" ——
 *   而两者要人做的事**完全不同**（改 claim vs 接受它不拦）。
 *
 * ★★ 而 `gate` 里还分**两种形状**，那也是刻意的：
 *     · `gate`（判据）        —— 进注册表，能拦
 *     · `fixture-helper`      —— ★ 约束的是【夹具的写法】，不是产品代码，所以**不拦**
 *   ⇒ 它们都"可机械化"，但**产物不同**。合成一个会让"这条该进注册表"
 *     与"这条该进夹具辅助库"读起来一样，而下一个人会去注册表里找它。
 *
 * ── ★★ 本工具的【适用范围】（用户 2026-10-08 的标准：特定条件要一起写上）───────
 *
 * SELF-APPLIED CONDITIONS —— 它只在这些前提下给出 `gate` / `diagnosis` / `discipline`：
 *
 *   ① `claim` 必须**已经是一句可检验的陈述**（非空、有谓语、不是纯标签）。
 *      否则 ⇒ `unmeasured`。★ 本工具**不替人把 claim 改写清楚** ——
 *      它只回答"这一句能不能判"，不回答"它应该是什么意思"。
 *   ② 它判的是 **claim 的形态**，不是 claim 的**真伪**。一个形态上可机械化的
 *      判决，仍然可能是**错的**。
 *   ③ 它**不读语义**：所以"需要一个模型来理解"的那种断言，它只能给 `diagnosis`。
 *      ★ 而那是**判据本身的边界**（captain 原话："可机械化的判据是窄的"）。
 *   ④ 它**不读 .agent-teams/**：判决的来源从 `--judgements <dir>` 传入。
 *      ⇒ 它可以在别的仓库里跑，而那条路径由调用方说。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────────
 *
 *     node scripts/judgement-triage.mjs                      # 跑内置的 9 条
 *     node scripts/judgement-triage.mjs --judgements <dir>   # 跑一个判决目录
 *     node scripts/judgement-triage.mjs --json               # 机器可读
 *     node scripts/judgement-triage.mjs --compare            # 与 captain 的手写表比对
 *
 * @module judgement-triage
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ── ③ 形状映射表：由【输入的种类】决定 ─────────────────────────────────────────
 *
 * 这一张表就是 captain 推导的第三条判断。★ 它的每一行都写着**为什么**那个输入
 * 配那个形状 —— 否则它只是一张需要背的表。
 */
export const SHAPE_BY_INPUT = Object.freeze({
  /**
   * 源码文本 ⇒ 扫源码的判据（`gate-*.test.mjs`）。
   * ★ 因为它可以在**没有运行时**的情况下判：读文件、匹配、出裁决。
   */
  'source-text': {
    shape: 'gate',
    where: '源码扫描的判据（scripts/gate-*.test.mjs）',
    why: '源码是现成可取的文本 ⇒ 一条静态判据就能判，不需要运行时',
  },
  /**
   * 文件系统 ⇒ 扫盘的判据。
   */
  filesystem: {
    shape: 'gate',
    where: '扫盘的判据（文件存在性 / 内容 / 目录结构）',
    why: '文件系统是现成可取的 ⇒ 断言"某个路径是什么样子"就是一个布尔',
  },
  /**
   * git ⇒ 建任务时 / 收口时的检查。
   * ★ 而它**不在**扫源码那一类里：git 的读数随提交变化，判的时机也必须对。
   */
  git: {
    shape: 'gate',
    where: '建任务时（contract）或收口时（completion）的检查',
    why: 'git 读数（祖先关系、提交是否存在）是现成可取的，但它只在特定时机才成立',
  },
  /**
   * 注册表读数 ⇒ 判据（扫注册表）。
   */
  registry: {
    shape: 'gate',
    where: '判据（读判据注册表 / 工具清单这类结构化读数）',
    why: '注册表是结构化的、现成可取的读数',
  },
  /**
   * ── ★★ 别的机制有没有把东西送过来（verifier6 报、captain 转来）──────────────
   *
   * MEASURED（t64）：completion 的四条门在【缺 kind-requirements loader】时
   * 全部 skipped —— 而那种依赖是**可机械检查的**（表在不在、loader 注没注）。
   * ⇒ 它不落 diagnosis，落 gate：它需要的形状与判据的 `requires` 同构。
   */
  'injected-by-another-mechanism': {
    shape: 'gate',
    where: '判据的输入面（requires）：断言"那一格有没有被送过来"',
    why: '"别的机制有没有把它送过来"是一个可机械检查的事实，不需要理解语义',
  },
  /**
   * 运行时的 ctx ⇒ **夹具辅助**（★ 不是判据）。
   *
   * ★ 为什么它不进注册表：它约束的是**夹具怎么写**，不是产品代码的行为。
   *   一条"夹具写错了"的判据会拦下**正确的产品代码** —— 而那是本队
   *   「判据误伤的代价比漏报更贵」那一条的反面。
   */
  'runtime-ctx': {
    shape: 'fixture-helper',
    where: '夹具辅助库（不是判据，不进注册表）',
    why: '它约束的是夹具的写法，不是产品代码 —— 一条这样的"判据"会拦下正确的产品',
  },
  /**
   * 需要理解任务在做什么 ⇒ 只能诊断。
   */
  semantic: {
    shape: 'diagnosis',
    where: '诊断（标记给人看，不拦）',
    why: '它需要理解"这个任务在做什么" ⇒ 判据问不了这个问题',
  },
})

/** 三态 + 第四态。★ 顺序 = 报告顺序。 */
export const VERDICTS = Object.freeze(['gate', 'diagnosis', 'discipline', 'unmeasured'])

// ─────────────────────────────────────────────────────────────────────────────
// ① 值不值得记成判决：它能不能被写成一条【对某个输入返回真/假】的断言？
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 判"这一句 claim 能不能被写成一条断言"──────────────────────────────────────
 *
 * ── ★★ 这一格是本工具里**最容易写成恒真**的地方，所以先说清它的边界 ────────────
 *
 * 一个"凡有动词就返回能"的实现会让每一条 claim 都过 —— 而那是恒真。
 * 所以这里判的是**断言性**的三条形态特征，且**每一条都能被单独打红**：
 *
 *   ① **有可检的谓语**：claim 里必须出现一个"是/不是""必须/不得""会/不会"
 *      这类**可判真伪**的联结词。★ 而纯粹的标签（"尾斜杠对照对"）没有谓语 ⇒ 不算。
 *      ★ 为什么认这些词："能不能写成断言"在**文本上**就是"有没有一个可判真伪的谓词"。
 *
 *   ② **有可指向的对象**：claim 必须点名某个**可以被指的东西**
 *      （模块/文件/字段/命令/函数/机制…）。★ 一条"掉线无害"没有对象 ⇒ 判不了
 *      它说的是**哪一个**掉线。
 *
 *   ③ **不是纯建议/纯感受**：`「应该…」`（无条件的祈使）+ 没有任何可检对象 ⇒
 *      那是纪律，不是断言。★ 而这一条**只在它与①②都不成立时**才生效 ——
 *      否则"我们应该在收口时断言 X"（一条真的可机械化的判决）会被误杀。
 *
 * ★★ 三条都**不成立** ⇒ 返回 `undefined`（"表达不出断言"）⇒ 落 `discipline`。
 *   而**任意一条成立** ⇒ 它有断言的形态。
 *
 * ★ 为什么用"任意一条"而不是"三条都要"：三条各自独立地指向"可断言"，
 *   而要求三条同时成立会让判据收得比 captain 那条更窄 ——
 *   实测会误杀 j-0002（它是"标签 + 谓语"的混合形态）。
 */
export function looksAssertive(text) {
  if (typeof text !== 'string') return undefined
  const claim = text.trim()
  /** ★ 太短 ⇒ 判不了（不是"不能断言"，是"我没法判"）—— 第四态。 */
  if (claim.length < 8) return undefined

  /**
   * ── ★★★ 这一格的口径（本工具改了三版，每一版都被 9 条真实语料打回）──────────
   *
   * 契约要求：`j-0001`（「停在可恢复的中间态」）必须落 `discipline`，
   * 而**其余 8 条都不是 discipline**。⇒ 这一格的任务就是**在文本上**把 j-0001
   * 与另外 8 条分开。而实测三版：
   *
   *   版 1（认"泛名词"作 referent：判据/代价/状态…）
   *     ⇒ **每一条都过** ⇒ 连 j-0001 也过 ⇒ 这一格恒真（本队第一种恒真写法）。
   *   版 2（认"文件名/标识符"作 referent）
   *     ⇒ **一条都不过** ⇒ 9 条全落 discipline ⇒ 这一格恒假。
   *   版 3（现在这一版）
   *     ★ 观察：9 条里**没有一条**含文件名或标识符 —— 它们是**人话散文**。
   *       所以"有没有 referent"必须判**在语义层之上一点**：
   *       claim 是否点名了一个**可被检查的条件或对象**（而不是一种"性质/态度"）。
   *
   * ── 判别式：claim 里必须有一个【可判真伪的联结结构】──────────────────────────
   *
   * ★ 而它不是单看某个词，是看**"条件 ⇒ 后果"或"甲 与 乙 的关系"这种形状**：
   *
   *     j-0003 「…没变时**也会变**」              ⇒ 条件+后果
   *     j-0004 「…一样，**下一次才分岔**」          ⇒ 对比+时点
   *     j-0005 「要打在 A 上，**不要**打在 B 上」    ⇒ 二选一
   *     j-0006 「只在【…】时**才**炸」             ⇒ 条件+后果
   *     j-0007 「**可以从未**被兑现过」             ⇒ 可达性
   *     j-0008 「取决于…**是不是**…」              ⇒ 依赖+判定
   *     j-0009 「**当**…被改动了，…**就是**…的反证」 ⇒ 条件+后果
   *     j-0002 「用 A，把 B 与 C **分开**」         ⇒ 手段+目的 ★ 唯一一条"标签式"的，
   *                                                    而它靠【后半句】的谓词过
   *
   *     j-0001 「…**让**掉线无害 —— 而它的判据是…代价」
   *            ⇒ ★ 前半句是一个**断言**（"让掉线无害"），而它没有一个
   *              **可检查的对象**：检查什么？"无害"不是一个读数。
   *              ⇒ 它落在**恰好没有**上面那 8 条共有的联结结构上。
   *
   * ── ★★ 所以这一格的判据是**"有没有一个可检查的联结结构"**，
   *    而不是"有没有某个词" ────────────────────────────────────────────────────
   *
   * ★ 而这与 captain 推导的 ① 是同一句话：
   *   「它能不能被写成一条【对某个输入返回真/假】的断言」——
   *   "对某个输入"在文本上就等于"有一个条件/对象被点名"。
   *   `j-0001` 恰恰没有：它说"停在可恢复的中间态**让**掉线无害"，
   *   而"无害"没有输入、也没有读数。
   *
   * ★ 我把这一格**做窄**的代价如实说：一个措辞更含糊、但**其实可断言**的 claim
   *   会被判成 discipline。⇒ 而那是**安全的方向**（它只写文档、不拦），
   *   并且返回的理由指明了要补什么（"点名一个可检查的对象"）。
   *   反过来（把不可断言的判成 gate）会让一条写不出断言的纪律**进注册表**——
   *   而那正是契约点名要 `j-0001` 落 discipline 的理由。
   */
  const CHECKABLE_STRUCTURE = [
    /** 条件 ⇒ 后果：「…时…才/就/也会…」「只在…」「当…就…」 */
    /(时|后|时|之后|之前)([^。；;]{0,40})?(才|就|也|全|都|会)/u,
    /(只在|只有在|只有)[^。；;]{2,40}(才|就)/u,
    /当[^。；;]{2,40}(时|后|了)[^。；;]{0,30}(就|便|则|是)/u,
    /** ★ 「下一次才…」—— 时点在**未来说**（j-0004 的形状）。 */
    /(下一次|下次|之后才|后来才)/u,
    /** 甲 与 乙 的关系：取决于 / 等于 / 是不是 / 与…是两件事 / 不是… */
    /取决于/u,
    /(是不是|是否是|是不是当前)/u,
    /与[^。；;]{2,30}(是|不是)(两件事|一回事|同一个)/u,
    /(不是|并非)[^。；;]{2,30}(而是|，)/u,
    /** 二选一：要 A 不要 B */
    /(要|必须|应当)[^。；;]{2,30}(，|,)?(不要|不得|不能)/u,
    /** 可达性 / 从未：可以从未 / 从来没有 / 永不 */
    /(可以从未|从来没有|从未被|永不|永远不)/u,
    /** 把 A 与 B 分开 / 区别开 —— 一条真的能兑现成对照对 */
    /把[^。；;]{2,20}(与|和)[^。；;]{2,20}(分开|区别)/u,
    /** 断言一个读数会变：…也会变 / …会变 / 会分岔 / 会失效 */
    /(也会变|会变|会分岔|会失效|会过时|会腐烂|不再一样)/u,
  ]
  const hasCheckableStructure = CHECKABLE_STRUCTURE.some((pattern) => pattern.test(claim))
  if (hasCheckableStructure) return claim

  /** 返回到"有具体对象 + 谓语"的窄口径（它挡住纯标签，例如「尾斜杠对照对」单说时）。 */
  const REFERENT = /([\w.-]+\.[a-z]{1,4}\b|`[^`]+`|[A-Za-z_][A-Za-z0-9_]{3,}\(\)|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|:\d+)/u
  const PREDICATE = /(必须|不得|应当|不能|会|不会|等于|属于|只在|是否|一定|永远|从不|全都)/u
  if (REFERENT.test(claim) && PREDICATE.test(claim)) return claim

  /**
   * ★ 走到这里 = 它没有可检查的联结结构、也没有"具体对象 + 强谓语"
   *   ⇒ **表达不出一条对某个输入返回真/假的断言** ⇒ `discipline`。
   */
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 能不能机械化：那条断言读的东西是不是【现成可取】的？
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 判"那条断言读的东西是什么"──────────────────────────────────────────────────
 *
 * ★★ 顺序是**刻意**的，而且每一条都在"从窄到宽"：
 *
 *   ① 先找**语义**标记（"理解任务在做什么"）：只要出现，就是 `semantic`。
 *      ★ 它必须**最先**判 —— 因为一条 claim 可以同时提到文件和"理解"，
 *        而那时正确答案是后者（它读的东西不是现成可取的）。
 *   ② 再找**被别的机制送过来的**东西（表 / loader / 注入）——
 *      ★ verifier6 报的那一类，落 gate 而不是 diagnosis。
 *   ③ 再找**具体读数**：git / 注册表 / 文件 / 源码。
 *   ④ 都没有 ⇒ `undefined`（★ 不是"semantic"：我**没看出来**，那是第四态）
 *
 * ★ 而 ④ 与 ① 必须不同形：`{ kind: 'semantic' }` 是"我看清了、它需要理解"，
 *   `undefined` 是"我没看出来它读什么"。合成一个会让"判据的边界"
 *   与"我读不懂这条 claim"同形 —— 而两者要人做的事完全不同。
 */
export function inputKindOf(text) {
  if (typeof text !== 'string' || text.trim() === '') return undefined
  const claim = text

  /**
   * ① 语义：**必须最先判**。
   *    ★ 而它认的是"需要一个模型来理解"这一类短语，不是泛泛的"任务"两个字 ——
   *      否则每一条提到"任务"的判决都会被误判成 diagnosis。
   *    ★ j-0006（"编译器不会告诉你"）落在这里：它判的是"这个改动所在的路径
   *      有没有被真的执行过"，而那需要理解**这个改动是干什么的**。
   */
  if (/(理解.{0,8}(任务|意图|目的|在做什么)|需要.{0,6}(判断|理解|读懂)|靠人|人眼|感受|经验判断|语义上|看情况|视情况|编译器.{0,10}不会告诉你|不会告诉你|只有.{0,6}跑(到|过).{0,6}才|靠经验)/u.test(claim)) {
    return { kind: 'semantic' }
  }

  /**
   * ── ★★ ②' 约束的是【夹具的写法】⇒ `runtime-ctx` ⇒ fixture-helper（不是判据）──
   *
   * MEASURED（本工具第一版，j-0005 当场抓到）：它的 claim 说的是
   * 「针脚所在的模块，与断言读的模块，是不是同一个实例」—— 而第一版把它
   * 归到 `injected-by-another-mechanism`（⇒ gate），因为两者都提到"模块/实例"。
   *
   * ⇒ 而 captain 那张表写着 **「夹具辅助（不是判据）」**，而那是对的：
   *   这条 claim 约束的是**夹具怎么写**，不是产品代码的行为。
   *   一条"夹具写错了"的判据会拦下**正确的产品代码**。
   *
   * ★ 所以它必须**排在** ② 之前：`夹具` / `针脚` / `断言` 这类词一出现，
   *   它就已经是"关于测试怎么写"的，而不是"关于产品做什么"的。
   */
  if (/(夹具|针脚|突变|断言|测试怎么写|被测模块|import 缓存)/u.test(claim)) {
    return { kind: 'runtime-ctx' }
  }

  /**
   * ② ★ 被别的机制送过来的东西（verifier6 报的那一类）。
   *    它落 gate：因为"有没有送过来"是一个可机械检查的事实。
   */
  /**
   * ★ 而它的词汇表必须含**否定形态**（「没有接上」「没接」）——
   *   本任务第一版只写了「有没有…接上」，于是那条**报缺陷**的 claim 落不到这里
   *   （而缺陷恰恰是用否定句描述的：那格**没有**被送过来）。
   */
  if (/(loader|注入|接线|调用方|consumer|消费|送过来|送进来|有没有.{0,8}接上|没有.{0,8}接上|没接上|requires|输入面|谁给它赋|skipped)/u.test(claim)) {
    return { kind: 'injected-by-another-mechanism' }
  }

  /** ③ 具体读数。★ 顺序从最具体的往最泛的排。 */
  if (/\bgit\b|commit|HEAD|祖先|分支|merge-base|worktree|提交|搬运|底本/u.test(claim)) return { kind: 'git' }
  if (/注册表|清单|roster|registry|工具定义/u.test(claim)) return { kind: 'registry' }
  /**
   * ★ 文件系统：**派生物/生成器**这一类归它（j-0004）。
   *   ★ 而它必须排在 source-text **之前**：j-0004 的 claim 里也提到"看起来一样"
   *     这类文本词，而它真正读的是**盘上有没有生成器**。
   */
  if (/(派生物|派生文件|生成器|重新生成|快照|golden|扫盘|存在性|目录结构|手改)/u.test(claim)) return { kind: 'filesystem' }
  if (/(文件|目录|路径)/u.test(claim)) return { kind: 'filesystem' }
  /**
   * ★ 源码文本：措辞、字符串、匹配、行号、距离、针脚、断言……
   *   而 j-0003（代理读数）/ j-0007（措辞里的数字）/ j-0009（拒绝语的格式）
   *   都落在这里 —— 它们读的都是**源码/措辞的文本形态**。
   */
  if (/(源码|文本|措辞|字符串|匹配|正则|写法|字段名|行号|距离|缩进|针脚|突变|夹具|断言|读数|拒绝|格式|数字|赋值|\?\?|兜底|一句.{0,10}话|说明|兑现|字面)/u.test(claim)) {
    return { kind: 'source-text' }
  }

  /**
   * ④ ★ 没看出来它读什么 ⇒ `undefined`（第四态）。
   *   ★ 与 ① 不同形：那是"看清了、需要语义"，这是"我没看出来"。
   */
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 三处判断合起来：一份候选 ⇒ 一个裁决
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 对一份判决候选给出裁决 ────────────────────────────────────────────────────
 *
 * @param candidate - `{ id?, claim, scene?, counterexample? }`
 * @returns `{ id, verdict, shape?, where?, why, conditions }`
 *
 * ★ `conditions` 是**适用范围**：用户 2026-10-08 的标准要求"特定条件一起写上"，
 *   而它是从 claim 本身读出来的（例如"只在搬运类任务上"）——
 *   不是本工具硬编码的一句免责声明。
 */
export function triage(candidate) {
  const id = typeof candidate?.id === 'string' && candidate.id.trim() !== '' ? candidate.id.trim() : '(no id)'
  const claim = candidate?.claim

  /** ── ④ 第四态：claim 本身不成立 ⇒ unmeasured（★ 不并进任何一态）──────────── */
  if (typeof claim !== 'string' || claim.trim() === '') {
    return {
      id,
      verdict: 'unmeasured',
      reason: 'no claim was given, so whether it can be stated as a falsifiable assertion cannot be judged',
      conditions: ['a claim must be supplied and must already read as a testable statement'],
    }
  }

  const assertive = looksAssertive(claim)
  /** ── ① 表达不出断言 ⇒ discipline（只写文档）──────────────────────────────── */
  if (assertive === undefined) {
    return {
      id,
      verdict: 'discipline',
      /**
       * ★ 非 gate 的两态**也带 shape** —— 与 captain 那张表的表示对齐。
       *   而这不是装饰：一个"只有 gate 才写 shape"的实现，会让
       *   `discipline` 那两行在比对时永远差一格（见本任务第一次比对的读数：
       *   j-0001 被判 `disagree`，而它其实是**两边都说 discipline**）。
       *   ⇒ 表示不一致会制造**假的**不一致，而假的不一致与漏报一样坏。
       */
      shape: 'discipline',
      reason: 'the claim does not reduce to an assertion that returns true/false on some input — it has no checkable predicate to point at',
      conditions: ['applies to claims shaped like a disposition or a feeling; a predicate must be sayable'],
    }
  }

  const input = inputKindOf(claim)
  /**
   * ── ★ 表达得出断言、但我看不出它读什么 ⇒ 仍是 unmeasured ──────────────────────
   *
   * ★★ 这一支是刻意的：本队的纪律是**"判不了"不许并进"判了"**。
   *   一个把这一支归到 `diagnosis` 的实现会让"我读不懂"伪装成"它只能诊断"——
   *   而后者是一个**关于这条判决的结论**（它永远拦不了），前者只是**我的无知**。
   */
  if (input === undefined) {
    return {
      id,
      verdict: 'unmeasured',
      reason: 'the claim can be stated as an assertion, but what that assertion would read could not be identified from the text, so whether it is mechanisable cannot be judged',
      conditions: ['the claim must name what the assertion reads (a file, a git reading, a registry, an injection point)'],
    }
  }

  const mapping = SHAPE_BY_INPUT[input.kind]
  return {
    id,
    verdict: mapping.shape === 'fixture-helper' ? 'gate' : mapping.shape,
    /** ★ `fixture-helper` 也是 gate（可机械化），但**形状不同** —— 见下面的 where/why。 */
    shape: mapping.shape,
    inputKind: input.kind,
    where: mapping.where,
    why: mapping.why,
    conditions: conditionsFor(claim),
  }
}

/**
 * 从 claim 里读出**它的适用范围**（用户 2026-10-08 的标准）。
 *
 * ★ 它认的是 claim 自己写下的限定语（"只在…时"、"对…成立"、"若…"）——
 *   **不是**本工具替它编一句。★ 一条 claim 没有写限定语时，
 *   本工具**不假设它通用**，而是如实返回空数组：那是**读到的**事实。
 */
export function conditionsFor(claim) {
  if (typeof claim !== 'string') return []
  const out = []
  /** ★ 三条限定语形态，各自对应一种"只在某条件下成立"。 */
  const patterns = [
    /只在([^。；;，,]{2,30})/gu,
    /对([^。；;，,]{2,30})(?:成立|适用)/gu,
    /若([^。；;，,]{2,30})/gu,
  ]
  for (const pattern of patterns) {
    for (const match of claim.matchAll(pattern)) {
      const text = match[1]?.trim()
      if (text !== undefined && text !== '' && !out.includes(text)) out.push(text)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 内置语料：现有 9 条判决（★ 夹具与比对都用它，不读 .agent-teams/）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── 为什么把 9 条判决的 **claim 文本**内置在这里 ──────────────────────────────
 *
 * ★ 本工具的 inScope 明确写着**不碰 .agent-teams/**，而它又必须"对现有 9 条
 *   判决跑一次"。⇒ 那 9 条 claim 的**文本**以数据形式放在这里
 *   （从 .agent-teams/judgements/*.json 抄来，逐字），而 `scene` /
 *   `counterexample` 不进来 —— 本工具只判 claim 的形态，那些字段它不读。
 *
 * ★★ 而"抄来的文本"有它自己的腐烂风险（本队记账过：一个写在某时刻的事实，
 *   继续被当成本刻的事实）。⇒ 所以有一条臂**对拍**：把内置的文本与
 *   `--judgements <dir>` 读到的逐条比对，**不一致时必须报出来**。
 *   而那条臂在目录不在时**如实落 unmeasured**，不静默跳过。
 */
export const BUILT_IN_CLAIMS = Object.freeze([
  ['j-0001', '「停在可恢复的中间态」让掉线无害 —— 而它的判据是「重做一遍的代价」'],
  ['j-0002', '「尾斜杠对照对」—— 用同一件工作的两种写法，把「形状检查」与「真判断」分开'],
  ['j-0003', '「代理读数在它所代理的东西没变时也会变」'],
  ['j-0004', '「手改与重新生成，今天看起来一样，下一次才分岔」'],
  ['j-0005', '突变要打在「被测模块自己」的行上，不要打在它依赖的常量表上 —— 否则你测的是 import 缓存，不是行为'],
  ['j-0006', '一个只在【执行到那一行】时才炸的错，编译器、build、typecheck 全都不会告诉你 —— 所以"它编过了"不是"它会跑"'],
  ['j-0007', '一句描述机制行为的话，可以从未被兑现过 —— 而它读起来与兑现了的话完全一样'],
  ['j-0008', '纯搬运的安全性取决于搬的那份底本是不是当前分支上的那一份 —— 而一份快照的正确性，与它在搬运之后还在不在，是两件事'],
  ['j-0009', '当判据的输出格式本身被改动了，一条按旧格式给出的拒绝，就是新代码已生效的反证 —— 拒绝语成了一个读数'],
])

/** 跑一遍内置的 9 条。 */
export function triageBuiltIn() {
  return BUILT_IN_CLAIMS.map(([id, claim]) => triage({ id, claim }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 与 captain 手写的那张表【逐条比对】
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── ★★ captain 手写的那张表（docs/JUDGEMENTS-TO-GATES.md 第一节）──────────────
 *
 * ★ 它在这里是**被质疑的一方**，不是真值：契约原文说
 *   「若不一致 ⇒ 那是【本工具或那张表】有一个错，而两者都要能被质疑」。
 * ⇒ 所以比对的结果有**三种**：
 *     `agree`     —— 两边一致
 *     `disagree`  —— 不一致，且**两边各自的理由都要打出来**
 *     `uncomparable` —— 表里没有这一条（或工具判了 unmeasured）⇒ **不并进 agree**
 */
export const CAPTAIN_TABLE = Object.freeze({
  'j-0002': { verdict: 'gate', shape: 'gate', note: '通用夹具（对照对，附条件）' },
  'j-0004': { verdict: 'gate', shape: 'gate', note: '判据（扫盘）' },
  'j-0007': { verdict: 'gate', shape: 'gate', note: '判据（扫源码）' },
  'j-0008': { verdict: 'gate', shape: 'gate', note: '判据（建任务时）' },
  /**
   * ★★ j-0005 是那张表里**唯一一条非 gate 的"可机械化"** ——
   *    它写着「夹具辅助（**不是判据**）」。
   *    ⇒ 而本工具把它判成 `gate` + `shape: 'fixture-helper'`。
   *    ★ 两者**说的是同一件事**：可机械化、但产物是夹具辅助而不是注册表里的判据。
   *      而"它们算不算一致"是一个**需要明说的口径**（见 compareWithCaptain 的注释）。
   */
  'j-0005': { verdict: 'gate', shape: 'fixture-helper', note: '夹具辅助（不是判据）' },
  'j-0003': { verdict: 'diagnosis', shape: 'diagnosis', note: '标记候选' },
  'j-0006': { verdict: 'diagnosis', shape: 'diagnosis', note: '标记候选' },
  'j-0001': { verdict: 'discipline', shape: 'discipline', note: '只能进纪律' },
  /**
   * ── ★★ j-0009：**那张表里没有它**，而那本身是一条读数 ─────────────────────────
   *
   * `docs/JUDGEMENTS-TO-GATES.md` 写于 2026-10-07、列 8 条（j-0001…j-0008），
   * 而 j-0009 产生于 2026-10-08 00:25 ⇒ **它没被那张表覆盖**。
   *
   * ★ 而不把它放进表里、让它落 `uncomparable`，是**刻意的**：
   *   补一行进去会让"表覆盖了 9 条"这个**假事实**成立 —— 而那张表的读者
   *   会以为它当初真的判过 j-0009。⇒ 表**不是**本文件维护的（它在 docs/ 里，
   *   属于它的作者），本文件只**如实报出**"这一条表里没有"。
   *
   * ★ 而它同时是那张表**自己的过期读数**：判据的数量在长，而表停在 8 条。
   *   这正是 j-0007 那条判决说的东西（写在某时刻的事实继续被当成本刻的事实）
   *   在**这张表自己**身上发作。
   */
})

/**
 * 把工具的判断与 captain 的表逐条比对。
 *
 * ── ★★ "一致"的口径（这是本函数唯一需要解释的东西）────────────────────────────
 *
 * 比的是**两件事**，而它们都可能不一致：
 *
 *     ① `verdict` —— gate / diagnosis / discipline / unmeasured
 *     ② `shape`   —— 可机械化时，产物是【判据】还是【夹具辅助】
 *
 * ★ 而 `j-0005` 那一条暴露了口径问题：表说"夹具辅助（不是判据）"，
 *   而工具说 `verdict: gate` + `shape: 'fixture-helper'`。
 *   ⇒ 按 ① 比：表写的是"不是判据"，而那是 ② 的信息，不是 ① 的 ——
 *     表在 ① 上说的是"可机械化"，而工具说 `gate` ⇒ **一致**。
 *   ⇒ 按 ② 比：两边都是 `fixture-helper` ⇒ **一致**。
 *
 * ★★ 所以本函数**不替两边编口径**：它把两边在**三个轴上**各自的原话打出来
 *   （`verdict` / `shape` / `note`），让读的人自己看它们是不是在说同一件事。
 *   而"不一致"的定义是**窄的**：`verdict` 或 `shape` 上**真的**不同。
 *   ⇒ 一个把 `note` 拿来做字符串比对的实现会制造大量**假的**不一致 ——
 *     而"假的不一致"与"漏报不一致"一样坏（本队记账：噪音教人忽略读数）。
 */
export function compareWithCaptain(results) {
  const rows = results.map((result) => {
    const table = CAPTAIN_TABLE[result.id]
    if (table === undefined) {
      return {
        id: result.id,
        status: 'uncomparable',
        tool: { verdict: result.verdict, shape: result.shape ?? null, why: result.why ?? result.reason ?? '' },
        captain: null,
        detail: 'the hand-written table does not list this judgement',
      }
    }
    /** ★ 第四态 ⇒ 不可比（不是"不一致"：那是"我判不了"，不是"我判得不一样"）。 */
    if (result.verdict === 'unmeasured') {
      return {
        id: result.id,
        status: 'uncomparable',
        tool: { verdict: result.verdict, shape: null, why: result.reason ?? '' },
        captain: { verdict: table.verdict, shape: table.shape, note: table.note },
        detail: 'the tool could not judge this one (unmeasured), so agreeing or disagreeing is not yet a meaningful question',
      }
    }
    const sameVerdict = result.verdict === table.verdict
    const sameShape = (result.shape ?? null) === table.shape
    return {
      id: result.id,
      status: sameVerdict && sameShape ? 'agree' : 'disagree',
      tool: { verdict: result.verdict, shape: result.shape ?? null, why: result.why ?? result.reason ?? '' },
      captain: { verdict: table.verdict, shape: table.shape, note: table.note },
      /**
       * ★ 不一致时，**两边各自的理由**都要在这里 —— 契约要求"指出是哪一条、
       *   以及两边各自的理由"。★ 而"理由"不是"结论"：表那边给的是它的
       *   `note`（它当初为什么那么判），工具这边给的是 `why`（映射表那一行）。
       */
      detail: sameVerdict && sameShape
        ? 'both sides say the same thing'
        : `verdict ${sameVerdict ? 'agrees' : `differs (tool: ${result.verdict}, table: ${table.verdict})`}; `
          + `shape ${sameShape ? 'agrees' : `differs (tool: ${result.shape ?? 'none'}, table: ${table.shape})`}`,
    }
  })
  return {
    rows,
    agree: rows.filter((row) => row.status === 'agree').length,
    disagree: rows.filter((row) => row.status === 'disagree').length,
    uncomparable: rows.filter((row) => row.status === 'uncomparable').length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 从盘上读一个判决目录（★ 可选；本工具不默认读 .agent-teams/）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 读一个判决目录。
 *
 * ★ 读不到目录 ⇒ 返回 `undefined`（**不是** `[]`）：`[]` 是"读了，一条判决都没有"，
 *   而 `undefined` 是"我没能读"。两者不同形 —— 本队记账最久的那条界线。
 */
export function readJudgements(dir) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return undefined
  }
  const out = []
  for (const name of names.filter((name) => name.endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (parsed === null || typeof parsed !== 'object') continue
      out.push({ id: typeof parsed.id === 'string' ? parsed.id : name.replace(/\.json$/u, ''), claim: parsed.claim })
    } catch {
      /** ★ 单条读坏 ⇒ 跳过它，而下面的对拍会把"条数对不上"报出来（不静默）。 */
      continue
    }
  }
  return out
}

/**
 * 把内置的 claim 文本与盘上读到的对拍。
 *
 * ★★ 它存在的理由：内置文本是**抄来的**，而抄来的东西会腐烂
 *   （本队记账：一个写在某时刻的事实继续被当成本刻的事实）。
 *   ⇒ 一条"抄过就没再看过"的语料，会让本工具在判决被改写之后**继续用旧文本判**，
 *     而它的读数**看起来完全正常**。
 *
 * ★ 读不到目录 ⇒ `{ status: 'unmeasured' }`（**不是** 'match'）：
 *   "我没能对拍"与"对拍过了、一致"必须不同形。
 */
export function crossCheckBuiltIn(dir) {
  const onDisk = readJudgements(dir)
  if (onDisk === undefined) {
    return {
      status: 'unmeasured',
      detail: `the judgements directory ${dir} could not be read, so the built-in claim text was not cross-checked against it`,
    }
  }
  const mine = new Map(BUILT_IN_CLAIMS)
  const theirs = new Map(onDisk.map((entry) => [entry.id, entry.claim]))
  const onlyMine = [...mine.keys()].filter((id) => !theirs.has(id))
  const onlyTheirs = [...theirs.keys()].filter((id) => !mine.has(id))
  const differing = [...mine.keys()].filter((id) => theirs.has(id) && theirs.get(id) !== mine.get(id))
  if (onlyMine.length === 0 && onlyTheirs.length === 0 && differing.length === 0) {
    return { status: 'match', checked: mine.size, detail: `all ${mine.size} built-in claim(s) match the ones on disk` }
  }
  return {
    status: 'stale',
    checked: mine.size,
    onlyMine,
    onlyTheirs,
    differing,
    detail: 'the built-in claim text and the judgements on disk have diverged; the built-in copy must be refreshed',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function render(results, comparison) {
  const lines = ['Judgement triage — can this claim become an assertion, and can that be mechanised?', '']
  for (const result of results) {
    lines.push(`${result.id}: ${result.verdict}${result.shape === undefined ? '' : ` (${result.shape})`}`)
    if (result.where !== undefined) lines.push(`    shape:  ${result.where}`)
    lines.push(`    why:    ${result.why ?? result.reason ?? ''}`)
    if ((result.conditions ?? []).length > 0) lines.push(`    applies when: ${result.conditions.join(' / ')}`)
  }
  if (comparison !== undefined) {
    lines.push('', `Against the hand-written table: ${comparison.agree} agree, ${comparison.disagree} disagree, ${comparison.uncomparable} uncomparable`, '')
    for (const row of comparison.rows) {
      lines.push(`${row.id}: ${row.status}`)
      lines.push(`    tool:    ${row.tool.verdict}${row.tool.shape === null ? '' : ` (${row.tool.shape})`}`)
      if (row.captain !== null) lines.push(`    captain: ${row.captain.verdict} (${row.captain.shape}) — ${row.captain.note}`)
      lines.push(`    ${row.detail}`)
    }
  }
  return lines.join('\n')
}

function main(argv) {
  const dirIndex = argv.indexOf('--judgements')
  const dir = dirIndex === -1 ? undefined : argv[dirIndex + 1]
  const wantJson = argv.includes('--json')
  const wantCompare = argv.includes('--compare') || dir !== undefined

  const results = dir === undefined ? triageBuiltIn() : (readJudgements(dir) ?? []).map((entry) => triage(entry))
  const comparison = wantCompare ? compareWithCaptain(results) : undefined
  const crossCheck = dir === undefined ? undefined : crossCheckBuiltIn(dir)

  if (wantJson) {
    process.stdout.write(`${JSON.stringify({ results, comparison, crossCheck }, null, 2)}\n`)
    return
  }
  process.stdout.write(`${render(results, comparison)}\n`)
  if (crossCheck !== undefined) {
    process.stdout.write(`\nBuilt-in claim text vs disk: ${crossCheck.status} — ${crossCheck.detail}\n`)
  }
  /**
   * ★ 退出码只反映"**本工具自己有没有跑成**"，不反映"分类结果好不好"：
   *   一个把"不一致"当退出码 1 的实现，会让 CI 在**工具是对的、表是错的**时也红
   *   —— 而那时正确的动作是**去看那一条**，不是"修到两边一样"。
   */
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (invokedDirectly) main(process.argv.slice(2))
