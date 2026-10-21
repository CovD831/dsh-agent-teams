/**
 * ── ★★★ 本仓自己的需求台账（`docs/REQUIREMENTS.md`）的**可机械核对**部分 ─────────────
 *
 * ── 为什么这个文件存在 ────────────────────────────────────────────────────────────
 *
 * MEASURED（2026-10-21 审计）：
 *
 * ```
 * $ find . -name "requirements-contract*" -not -path "./node_modules/*"   ⇒ 空
 * $ find . -name "workbench-align*"       -not -path "./node_modules/*"   ⇒ 空
 * $ grep -rn "REQUIREMENTS.md" scripts/ | grep -c claims                   ⇒ 0
 * ```
 *
 * 而 `docs/REQUIREMENTS.md:5` 逐字写着「它是**一份可对齐的清单** —— 供 `workbench-align`
 * 双向比对」。⇒ ★ **那句承诺在本仓没有任何落点**：`workbench-align` 住在另一个仓，
 * 而它的 37 条 claim 硬编码的是那个仓的路径：
 *
 * ```
 * $ node ~/Desktop/自动化开发插件/bin/workbench-align.mjs --repo ~/Desktop/agent-teams-dev
 * ✖ 26 claim(s) marked MET whose evidence is GONE:
 *     R1.1 bin/workbench-loop.mjs does not exist     ← 本仓没有这个文件
 * ```
 *
 * ⇒ 后果不是"少一个工具"，是**这份台账在过去若干轮里没有任何东西检查它是否还在生效**，
 *   而它已经漂了（§12 的「⬜未实现」在写完两小时后被 `7309ed1` 实现了一半；
 *   §5 写 21 条判据而实测 22 条；README 与 README_ZH 仍写 14 个工具而实测 17 个）。
 *
 * ── ★★★ 四条判断，且 `gap` 与 `met` 是**对称**的（这一格最容易做错）──────────────────
 *
 * 一份"缺口清单"如果只在**缺口存在**时才通过，它就会**永远绿** —— 而永远绿的清单
 * 比没有清单更坏：它把"缺口被补上了"这件事变成**看不见**的。
 *
 * ```
 * status = met / partial  ⇒  证据**应当在**   · 在 ⇒ verified   · 不在 ⇒ ★ gone
 * status = gap            ⇒  缺口**应当还在** · 还在 ⇒ gap-open · 没了 ⇒ ★ claim-stale
 * status = open           ⇒  人还没决定       · 本文件不判它（不是缺陷）
 * ```
 *
 * ★ `claim-stale` 与 `gone` 的补救动作**相反**（一个去改文档、一个去补实现），所以不许合流。
 *
 * ── ★★ `manual` 永不并进 `verified`（本仓 §12.3 的诚实分级）─────────────────────────
 *
 * ```
 * verified     机械核对过
 * unverified   ★ 只能靠读 —— 本文件**不声称**验证过它
 * ```
 *
 * 保留 `manual` 不是设计缺陷：像"每条断言都要能在反向变红"这种**跨整个程序的行为属性**，
 * 用 grep 去"验证"它就是**把谎话打扮成检查**。一个声称"全部已验证"的报告会被忽略 ——
 * 而这份报告值得被读的前提，正是它不这么说。
 *
 * ── ★ 探针为什么是模块内具名函数，而不是 shell 字符串 ──────────────────────────────
 *
 * 第一版把每条探针写成 `node --input-type=module -e "…"` 的字符串。实测代价：
 * 转义层数一多就无法复核（一条 400 字符的字符串里，`\\(` 与 `(` 的差别决定它查的是什么）。
 * ⇒ 一律写成**具名函数**，放在下面 §探针 一节，逐条附"它能区分什么"的注释。
 *   仍然是机械的（读文件 / 跑正则 / 数命中），只是**人读得懂**。
 *
 * @module dsh-agent-teams/scripts/requirements-claims
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 剥注释 —— 拒绝「注释里提过」被认证成能力（`docs/REQUIREMENTS.md` §12.4 那条实测）。 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 活注册表里的业务工具数 —— 从 `src/tool-names.ts` 的 `TEAM_TOOL_NAMES` 数组数出来。
 * ★ 不 `import lib/tool-names.js`：那会把"构建过期"读成"文档写错了"（同 `readRegistryGateIds` 的取舍）。
 */
export function teamToolCountIn(root = DEFAULT_ROOT) {
  try {
    const text = stripComments(readFileSync(join(root, 'src', 'tool-names.ts'), 'utf8'))
    const block = /TEAM_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(text)
    if (block === null) return undefined
    return [...block[1].matchAll(/'agent_teams_[a-z_]+'/g)].length
  } catch {
    return undefined
  }
}

/** 递归收集某个目录下的全部 `.ts`。 */
function sourceFiles(root, dir = 'src') {
  const files = []
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) files.push(full)
    }
  }
  walk(join(root, dir))
  return files
}

/** 读一份源码并剥注释（`src/` 下的一律走它，防止注释被当成能力）。 */
function code(root, relative) {
  const file = join(root, relative)
  return existsSync(file) ? stripComments(readFileSync(file, 'utf8')) : undefined
}

/** 在 `src/**` 的**非注释**文本里找某个模式。 */
function grepSource(root, pattern, { exclude = [] } = {}) {
  const hits = []
  for (const file of sourceFiles(root)) {
    const relative = file.slice(root.length + 1).replaceAll('\\', '/')
    if (exclude.some((prefix) => relative.startsWith(prefix))) continue
    const text = stripComments(readFileSync(file, 'utf8'))
    text.split('\n').forEach((line, index) => {
      if (new RegExp(pattern).test(line)) hits.push({ file: relative, line: index + 1, text: line.trim() })
    })
  }
  return hits
}

/**
 * ── ★★★ 探针 ─────────────────────────────────────────────────────────────────────
 *
 * 每个探针回答**一个**问句，返回 `true` 表示"这件事成立"。
 * ★ 探针**不翻转方向** —— 方向由 claim 的 `status` 决定（见文件头那张表）。
 *   一个自己翻转方向的探针，与一条改了口径的判据同形，而两者在读数上分不出来。
 */
export const PROBES = Object.freeze({
  /**
   * §1：评估器三文件是否**剥注释后**零 import 于 evolution / gates。
   * ★ 能区分：「评估器真的独立」vs「只在注释里说它独立」。
   */
  'evaluator-is-independent'(root) {
    const files = ['src/evaluator/effect.ts', 'src/evaluator/score.ts', 'src/evaluator/types.ts']
    return files.every((relative) => {
      const text = code(root, relative)
      return text !== undefined && !/from\s+['"]\.\.\/(evolution|gates)/.test(text)
    })
  },

  /**
   * §2②：`recordProposalForSignal` 有没有**生产**调用方（`proposals.ts` 自己不算）。
   * ★ 能区分：「函数写好了」vs「它从没被调用过」。
   */
  'proposal-is-actually-written'(root) {
    return grepSource(root, 'recordProposalForSignal\\s*\\(', { exclude: ['src/evolution/proposals.ts'] }).length > 0
  },

  /**
   * §2②：`createTaskParamsOf` 有没有**生产**调用方（`propose.ts` 自己不算）。
   * ★ 能区分：「转换函数存在」vs「提案真的变成过一条任务」—— 前者恒真，后者才是这问句要的。
   */
  'proposal-reaches-create-task'(root) {
    return grepSource(root, 'createTaskParamsOf\\s*\\(').some((hit) => hit.file !== 'src/evolution/propose.ts')
  },

  /**
   * §6：`src/evaluator/` 有没有**外部**消费方（深路径 import 或 re-export）。
   * ★ 能区分：「写好了」vs「有人读它」。
   */
  'evaluator-has-consumer'(root) {
    return grepSource(root, "from\\s+['\"][^'\"]*evaluator/", { exclude: ['src/evaluator/'] }).length > 0
  },

  /**
   * §11：飞轮的两个计数有没有**生产写方**。
   * ★ 能区分：「`confidenceOf` 算得对」vs「有没有数据喂给它」。
   */
  'flywheel-has-tally-writer'(root) {
    return grepSource(root, 'tallyRecall\\(|tallyAdopt\\(', { exclude: ['src/confidence.ts'] }).length > 0
  },

  /**
   * §11：采集的 `collected` 三态是否**真的落过盘**（至少有一行带这一格）。
   * ★ 能区分：「写方修好了」vs「旧行占了全部、新行一条都没有」。
   * ★ 但**不能**区分"哪条路产出的"—— 那由 `gate-observe-call-sites` 单独判。
   */
  'signals-carry-collected'(root) {
    const file = join(root, '.agent-teams', 'evolution', 'signals.jsonl')
    if (!existsSync(file)) return false
    const rows = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '')
    let parsed = 0
    let withKey = 0
    for (const line of rows) {
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      parsed += 1
      if ('collected' in row) withKey += 1
    }
    return parsed > 0 && withKey > 0
  },

  /**
   * §12(iii)：模型侧工具面有没有终止动作（`halt` / `discard`）。
   * ★ 能区分：「Web 路由能停」vs「**模型**能停」—— 这一条问的正是后者。
   */
  'model-can-end-plan-loop'(root) {
    const text = code(root, 'src/tool-names.ts')
    return text !== undefined && /halt|discard/.test(text)
  },

  /**
   * §15：`judgeWorktreeReclaimable` 是否**调** `absorbPlanOf`（而不是复制一份判据）。
   * ★ 能区分：「判据只有一份」vs「两份判据今天恰好一致」。
   */
  'absorb-judgement-is-single'(root) {
    const text = code(root, 'src/worktree.ts')
    return text !== undefined && /absorbPlanOf/.test(text)
  },

  /**
   * §16：戳是否在落盘时绑定它审过的字节（**读写两处都在**才成立）。
   * ★ 能区分：「一处绑了」vs「两处都绑了」—— 只绑一处时普查会给出一个看着合理的数。
   */
  'stamp-binds-artifacts'(root) {
    const write = code(root, 'src/tools/create-task.ts') ?? ''
    const update = code(root, 'src/tools/update-task.ts') ?? ''
    return /reviewedArtifacts/.test(write) && /reviewedArtifacts/.test(update)
  },

  /**
   * §17：派活那一刻是否有 `landed` 三态出口。
   * ★ 能区分：「基线可用」vs「基线可用**且**说得出它进没进主干」。
   */
  'baseline-reports-landed'(root) {
    const text = code(root, 'src/worktree.ts')
    return text !== undefined && /landed/.test(text)
  },

  /**
   * §18：`admission` 的**第一件事**（3 条判据已注册）。
   * ★★ 第二、三件事（生产求值点 / 输入面产出）**刻意不在本探针里** ——
   *    它们各自需要一个不同的读数，合进一个布尔就等于把三件事合成一件（§18 逐字反对）。
   */
  'admission-is-registered'(root) {
    /**
     * ★ 认的是**三条 import**（`import * as admissionAbsorb from './admission/absorb.ts'`），
     *   不是注释里的 `admission.absorb` 那行字符串 —— 注释不能当能力。
     */
    const text = code(root, 'src/gates/index.ts')
    if (text === undefined) return false
    return ['absorb', 'checkpoint', 'convene'].every((name) => new RegExp(`from './admission/${name}\\.ts'`).test(text))
  },

  /**
   * §5：判据总数是否等于台账写的那个数（22）。
   * ★ 能区分：「台账里的数是现在的」vs「它是三个月前手抄的」。
   */
  'gate-count-is-22'(root) {
    return readRegistryGateIds(root).length === 22
  },

  /**
   * §13：`edit_plan` 的 plan 路线是否也跑契约门（`src/tools.ts` 里出现 `rejectOnContractGates`）。
   * ★ 能区分：「只有 create_task 跑」vs「两条路都跑」。
   */
  'plan-route-runs-contract-gate'(root) {
    const text = code(root, 'src/tools.ts')
    return text !== undefined && /rejectOnContractGates/.test(text)
  },

  /**
   * §19：CSS 类名是否**已不**依赖绝对路径（`true` = 这件事成立）。
   *
   * ★★ 这一格**踩过两次方向错**，两次都记下来，因为它们是同一个教训的两个面：
   *
   * ```
   * 第一次：写成"缺口还在就返回 true" ⇒ `status: 'gap'` 被读成 `claim-stale`
   *        ⇒ 方向写反的探针与"真的修好了"在读数上完全同形
   * 第二次：写成"pattern 不是 [hash]_[local] 就返回 true"
   *        ⇒ 那是把 **pattern 本身**当成了病灶。而 `[hash]_[local]` 是**正确**的配置：
   *          哈希这件事本来就该有，错的是**喂给它的 filename 是绝对路径**。
   *          实测：修好之后 pattern 一字未改，而产物已经可复现。
   * ```
   *
   * ⇒ 本探针问的是**那个真正决定可复现性的输入**：传给 lightningcss 的 `filename`
   *   是不是**相对**的。★ 与 `scripts/gate-client-reproducible.test.mjs` 的臂 1/2 同一问句
   *   （那边还有一条反向半边，证明"绝对路径确实会改变类名"——否则本探针是恒真的）。
   */
  'css-hash-is-path-independent'(root) {
    const file = join(root, 'tsdown.config.ts')
    if (!existsSync(file)) return false
    const text = stripComments(readFileSync(file, 'utf8'))
    const match = /transform\(\{[\s\S]*?filename:\s*(.+),\s*\n/.exec(text)
    /** ★ 找不到那段配置 ⇒ 判不了（返回 false 会读成"缺口还在"，而那是猜的）。 */
    if (match === null) return false
    const expression = match[1].trim()
    /** ★ 方向：**相对**才算成立。裸 `fileId` 是绝对路径 ⇒ 不成立。 */
    return expression !== 'fileId' && /relative\(/.test(expression) && !/^(['"`])?\//.test(expression)
  },

  /**
   * §25：**文档里的工具数**是否与活注册表一致。
   *
   * ★★ 这个探针存在的理由是一次**实测的漂移**：README 与两份 docs 从 14 一路漂到
   *   实际 17（加 `restart` / `review_plan` / `declare_delivery` 时都没跟），
   *   而**没有任何夹具守着这个数字**（`grep -rn "14 个业务工具" scripts/` ⇒ 空）。
   *   ⇒ 一个写着过期数字的文档，比没有那个数字更坏：它会让读的人**不再去数**。
   * ★ 只查**三份**会声称工具数的文档，不查全部 markdown（那是噪声，不是判据）。
   */
  'doc-tool-counts-match'(root) {
    /**
     * ★★ 按 `root` **现算**，不用模块级常量。MEASURED（本条的第一版红在这里）：
     *   常量在模块加载时按**真实仓库**求值 ⇒ 夹具造一棵 2 个工具的假树时，
     *   探针仍拿 18 去比 ⇒ 永远 false ⇒ 一条**有判别力**的探针被自己的取值器废掉。
     *   ★ 与 `readRegistryGateIds(root)` 同一条纪律：**读数必须跟着它被问的那棵树**。
     */
    const live = teamToolCountIn(root)
    if (live === undefined) return false
    const files = ['README.md', 'README_ZH.md', 'docs/progressive-loading.md', 'docs/usage.md']
    for (const relative of files) {
      const file = join(root, relative)
      if (!existsSync(file)) continue
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/(\d+)\s*(?:coordination|native team|个业务)?\s*(?:tools|工具)/gu)) {
        /** ★ 只认"业务工具/coordination tools/native team tools"这几种说法 —— 其余"工具"多半是别的意思。 */
        const context = text.slice(Math.max(0, match.index - 20), match.index + match[0].length + 10)
        if (!/(coordination|native team|业务工具|工具直接业务|个工具直接)/u.test(context)) continue
        if (Number(match[1]) !== live) return false
      }
    }
    return true
  },

  /**
   * §27：图形化界面是否**从既有事实**投影出"每个成员在干什么"。
   *
   * ★★ 问句是"数据来源"而不是"画出来没有"：
   * ```
   * 错的做法：为小人新开一条后端投影（`memberSprite` / `cafeSeat` 之类）
   *           ⇒ 界面上看到的与判据读到的变成**两份真相**
   * 对的做法：doing ← task.status · lastAction ← commandsRun / output
   *           · stuck ← runtime.liveness 的 blocked（★ 已有判据，不许另算）
   * ```
   * ★ 而"画得好不好看"**不在判据里** —— 本机没有视觉模型，判它必然靠人看图。
   */
  'graphical-view-reads-existing-facts'(root) {
    /**
     * ★ 这条当前是**缺口**（`src/client/folders-panel.tsx` 只表达"有几个工作区"）。
     *   探针照实答"这件事成立吗" —— 成立需要同时看到：
     *   ① 一个成员级的投影函数（纯函数，可单测）
     *   ② 它读的字段是既有的（`status` / `commandsRun` / `liveness`）
     * ★ 只要还没写，它答 false ⇒ claim 落 `gap-open`。★ 这是**待办**，不是失败。
     */
    for (const relative of ['src/client/folders-panel.tsx', 'src/client/member-panel.tsx']) {
      const file = join(root, relative)
      if (!existsSync(file)) continue
      const text = stripComments(readFileSync(file, 'utf8'))
      const projectsMembers = /(membersFromSnapshot|memberSpritesOf|seatPlanOf)/.test(text)
      const readsExisting = /task\.status|commandsRun|doing/.test(text)
      if (projectsMembers && readsExisting) return true
    }
    return false
  },

  /**
   * §26.5：`create_task` 与 `edit_plan` **两条路线**的 `inScope` 说明都要求列出每一个落点。
   *
   * ★★ 问句是"两条路线的提示是否**同源**" —— 只改一条会让换路线写契约的人
   *   拿到一句更弱的提示，而**更弱的提示不会红**，只会让那条路产出更差的契约。
   */
  'inscope-asks-for-every-landing-point'(root) {
    const routes = ['src/tools/create-task.ts', 'src/tools/edit-plan.ts']
    return routes.every((relative) => {
      const text = readFileSync(join(root, relative), 'utf8')
      /** ★ 认的是那句**可判定的问句**本身，不是"文件里有 inScope"（后者恒真）。 */
      return /EVERY place the work lands/i.test(text) && /landing point/i.test(text)
    })
  },

  /**
   * §23：本仓是否**有**自己的对齐命令（本条自指，刻意如此 —— 它问的就是"这个机制还在吗"）。
   */
  'alignment-command-exists'(root) {
    return existsSync(join(root, 'scripts', 'requirements-align.mjs'))
  },

  /**
   * §23：对齐命令是否有**反向半边**（证据消失必须变红）。
   * ★ 能区分：「有对齐命令」vs「有对齐命令**且**它真的会红」。
   */
  'alignment-has-counter-half'(root) {
    return existsSync(join(root, 'scripts', 'gate-requirements-align.test.mjs'))
  },

  /**
   * §24：`agent_teams_restart` 是否**继续**声明它换不了代码。
   * ★ 方向：这句话在 ⇒ 诚实仍在。谁把它改成"reload 后即生效"，本条立刻红。
   */
  'restart-still-honest'(root) {
    const text = code(root, 'src/tools/restart.ts')
    return text !== undefined && /does NOT change which code the process runs/.test(text)
  },
})

/**
 * 从 `src/gates/` 的源码里数出全部判据 id（`export const id = 'position.name'`）。
 *
 * ★ 为什么**不** `import lib/gates/index.js`：那条路要求 `lib/` 已构建且与 `src/` 同步，
 *   而"读数命令因为构建过期而读不出数"会把一次**构建问题**读成一次**需求问题**。
 *   ⇒ 本探针只读 `src/`：它问的是"源码里有几条判据"，不是"构建产物里注册了几条"。
 */
export function readRegistryGateIds(root = DEFAULT_ROOT) {
  const ids = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) {
        const text = stripComments(readFileSync(full, 'utf8'))
        for (const match of text.matchAll(/^export const id = '([a-z-]+\.[a-z0-9-]+)'/gm)) ids.push(match[1])
      }
    }
  }
  walk(join(root, 'src', 'gates'))
  return ids
}

/**
 * ── 一条 claim ────────────────────────────────────────────────────────────────────
 *
 * `status` 是**人裁定的现状**（与台账的「现状」一致）；`check` 是**能机械核的那一半**。
 * 两者不是同一件事：`status: 'met'` 而 `check` 只覆盖一部分 ⇒ 仍然算 `verified`，
 * 但 `note` **必须**说清覆盖到哪（本仓 §4：PARTIAL 要写"哪一半缺"，不许写笼统的"部分完成"）。
 */
export const CLAIMS = Object.freeze([
  // ── §0 元判据 ──────────────────────────────────────────────────────────────
  {
    id: 'R0.1', section: 0, status: 'met',
    claim: '每条需求都带三格（判据 / 现状 / 证据），且证据指向一个真实落点',
    check: { kind: 'file', path: 'docs/REQUIREMENTS.md' },
    note: '元判据：它的机械面就是本文件本身 —— 每条 claim 都有 section + status + check 三格。',
  },
  // ── §1 模块边界 ────────────────────────────────────────────────────────────
  {
    id: 'R1.1', section: 1, status: 'met',
    claim: '`src/evaluator/` 剥注释后**零** import 于 evolution / gates（评估器独立）',
    check: { kind: 'probe', probe: 'evaluator-is-independent' },
    note: '只读 `src/evaluator/` 三个文件本身；方向是 evaluator → confidence（单向）。',
  },
  {
    id: 'R1.2', section: 1, status: 'met',
    claim: '`src/evolution/` 有一个明确的对外接口面（`index.ts`），装配层从它取',
    check: { kind: 'symbol', file: 'src/evolution/index.ts', pattern: 'export .*readProposalPipeline' },
    note: '接口面存在；★ 但装配层仍有三处深路径 import —— 见 R1.3。',
  },
  {
    id: 'R1.3', section: 1, status: 'partial',
    claim: '别人 → evolution：★ 只许 import `src/evolution/`（**一个**接口面）',
    check: { kind: 'symbol', file: 'src/snapshot.ts', pattern: "from '\\./evolution/index\\.ts'" },
    note: '★ 缺的那一半：`src/snapshot.ts` 同时有 3 处深路径 import（`evolution/health.ts` / `evolution/read.ts` / `evolution/collect.ts`）⇒ 规则 A 只覆盖一半。',
  },
  // ── §2 三模块划分 ──────────────────────────────────────────────────────────
  {
    id: 'R2.1', section: 2, status: 'met',
    claim: '① 采集与处理 = `src/evolution/`；③ 评估器 = `src/evaluator/`；② 实施**不存在**（只是一个转换函数）',
    check: { kind: 'symbol', file: 'src/evolution/propose.ts', pattern: 'export function createTaskParamsOf' },
    note: '② 的落点就是那个转换函数本身。',
  },
  {
    id: 'R2.2', section: 2, status: 'met',
    claim: '② 实施的前半：`Proposal` **真的落过盘**（`recordProposalForSignal` 有生产调用方）',
    check: { kind: 'probe', probe: 'proposal-is-actually-written' },
    note: '★ 2026-10-21 补上：`observe` 写完信号之后顺手分流并追加提案。'
      + '★ 在此之前整条流水线只在**读的时候现算**（`readProposalPipeline` 算完就丢）⇒ '
      + '"产出了 2 份提案"与"从没落过一份"两句都真。',
  },
  {
    id: 'R2.3', section: 2, status: 'gap',
    claim: '② 实施的后半：`Proposal` 真的**变成过**一条 `create_task` 契约（`createTaskParamsOf` 有生产调用方）',
    check: { kind: 'probe', probe: 'proposal-reaches-create-task' },
    note: '★ 仍然是缺口，且本轮**刻意**不做：一旦派发，"提案 → 任务"就成了无人值守的动作。'
      + '而那要先把"谁的提案该被自动派发"这条判据写出来 —— 那是产品决策（R2.2 只做到"有记录"）。',
  },
  // ── §3 评估器待在循环外 ────────────────────────────────────────────────────
  {
    id: 'R3.1', section: 3, status: 'met',
    claim: '`LOOP_B_SUBJECTS` 三条对 `canLoopAAutoChange` 返回 false；evolution 不提供改判据的函数',
    check: { kind: 'symbol', file: 'src/evolution/types.ts', pattern: 'LOOP_B_SUBJECTS' },
    note: 'STOP 的结构：判据本体在 gates，evolution 侧没有任何写判据的出口（"没有那个函数"比一条禁令更难腐烂）。',
  },
  // ── §4 两件不同的事不许同形 ────────────────────────────────────────────────
  {
    id: 'R4.1', section: 4, status: 'met',
    claim: '判据层三态 `ok / blocked / unmeasured`',
    check: { kind: 'symbol', file: 'src/gates/registry.ts', pattern: 'unmeasured' },
    note: '§4 表里"评估 effective/ineffective/unmeasured"那一层**至今未接** —— 它由 R6.2 单独记。',
  },
  {
    id: 'R4.2', section: 4, status: 'partial',
    claim: '飞轮四态 `promote / observe / archive / unmeasured` 在类型里，且**真的取到过**其中两个以上',
    check: { kind: 'symbol', file: 'src/confidence.ts', pattern: 'promote.*observe.*archive' },
    note: '★ 缺的那一半：四态在类型里成立，而"有任何条目进入过 observe/archive"不成立（零计数写入，见 R11.3）⇒ 今天所有条目都落 `unmeasured`。',
  },
  // ── §5 采集 ────────────────────────────────────────────────────────────────
  {
    id: 'R5.1', section: 5, status: 'met',
    claim: '七个插入点 · **22** 条判据（旧台账写 21，2026-10-21 实测更正）',
    check: { kind: 'probe', probe: 'gate-count-is-22' },
    note: '★ 旧台账的「21 条」是过期读数。本条把"那个数是多少"变成一条会红的判据：判据增删改了而台账没跟 ⇒ 红。',
  },
  {
    id: 'R5.2', section: 5, status: 'partial',
    claim: '四条采集判据在**三个**生产调用点被求值',
    check: { kind: 'symbol', file: 'src/tools/shared/entities.ts', pattern: "evaluate\\('collection'" },
    note: '★ 缺的那一半：三处调用点都在，而 `collection.cooldown` 在生产上 **44/44 判不了**（输入面缺 `index`/`source`）⇒ 见 R11.4。',
  },
  // ── §6 收益衡量 ────────────────────────────────────────────────────────────
  {
    id: 'R6.1', section: 6, status: 'met',
    claim: '收益判据结构性、无阈值：`before===0 ⇒ unmeasured`，`after<before ⇒ improved`',
    check: { kind: 'symbol', file: 'src/evaluator/effect.ts', pattern: 'unmeasured' },
    note: '幅度只作读数、不进 verdict；`GUESSED_MIN_OBSERVATION_MS` 名字自带"猜的"，不许与测量同形。',
  },
  {
    id: 'R6.2', section: 6, status: 'met',
    claim: '收益**读数**在某个生产出口上可见（`src/evaluator/` 有消费者）',
    check: { kind: 'probe', probe: 'evaluator-has-consumer' },
    note: '★ 2026-10-22 补上：`snapshot` 的 `effectReadout` 是评估器的**第一个生产消费者**'
      + '（§1 规则 A / §3 决定了它必须落在装配层 —— evolution 与 evaluator 都不许互相 import）。'
      + '判据在 `scripts/gate-effect-readout.test.mjs`（6 臂：纯函数两态 + 生产出口 + 反向半边）。'
      + '★★ 而真实语料那一格**此刻仍无数据**（本仓零 stored proposal）—— 臂 3b 把那个读数如实报出来。',
  },
  // ── §7 最小 MVP ────────────────────────────────────────────────────────────
  {
    id: 'R7.1', section: 7, status: 'met',
    claim: '先写读数脚本，再改产品（改前读数必须早于产品改动）',
    check: { kind: 'file', path: 'scripts/mvp-measure.mjs' },
    note: '配套 `scripts/mvp-failing-files.mjs` —— 净变化按月**失败文件集合**，不按计数。',
  },
  // ── §8 三处登记 ────────────────────────────────────────────────────────────
  {
    id: 'R8.1', section: 8, status: 'met',
    claim: '`GATE_DIRS` 从 `INSERTION_POINTS` **派生**（不再是一份手抄清单）',
    check: { kind: 'symbol', file: 'scripts/verify-gate-tristate.test.mjs', pattern: 'GATE_DIRS = \\[\\.\\.\\.INSERTION_POINTS\\]' },
    note: '加位置的登记面从五处降到四处半；其余四处仍是手抄（§8 已逐条记账）。',
  },
  // ── §9 反向半边 ────────────────────────────────────────────────────────────
  {
    id: 'R9.1', section: 9, status: 'manual',
    claim: '每条断言都要能在反向变红（有判别力）',
    check: { kind: 'manual' },
    note: '★ 这是**跨全部夹具的行为属性**，本文件不声称验证过它。可读的那一半：`ls scripts/gate-*.test.mjs | wc -l` 与 §21 里逐条列出的突变次数。',
  },
  // ── §10 宿主版本闸门 ──────────────────────────────────────────────────────
  {
    id: 'R10.1', section: 10, status: 'met',
    claim: '声明一个宿主版本，唯一有效的证据是**在那个版本上真跑通**',
    check: { kind: 'file', path: 'docs/harness-0.2.1-rc.2/README.md' },
    note: '★ `compatibility.json` 的 supportedHosts 是**声明**，不是证据 ⇒ 本条的 evidence 指向那份真机读数。',
  },
  // ── §11 自迭代两方向 ──────────────────────────────────────────────────────
  {
    id: 'R11.1', section: 11, status: 'partial',
    claim: '方向 2「深挖」：人给方向 ⇒ 当场看到该方向的缺陷密度与信号量',
    check: { kind: 'symbol', file: 'scripts/evolution-readout.mjs', pattern: 'directions' },
    note: '★ 缺的那一半：`directions` 一节**已可用**；完整的勘探循环未实现，且按裁定必须等 N1–N3（先有数据与审查，再有深挖）。',
  },
  {
    id: 'R11.2', section: 11, status: 'met',
    claim: '采集层的四态 `collected` 在盘上**真的成立**（`collected / skipped / unmeasured / null`）',
    check: { kind: 'probe', probe: 'signals-carry-collected' },
    note: '修好之后写入的新行都带这一格；`null`（写入方没写）与 `unmeasured`（写了、判不了）在盘上不同形。',
  },
  {
    id: 'R11.3', section: 11, status: 'gap',
    claim: '知识沉淀飞轮有**计数写入方**（`tallyRecall` / `tallyAdopt` 在生产被调用）',
    check: { kind: 'probe', probe: 'flywheel-has-tally-writer' },
    note: '★ 零生产调用 ⇒ 398 条卡点全部落 `unmeasured`（"没人记过"而不是"判为低分"）—— 那正是腾讯点名要防的 `No missing metric is converted into a fabricated zero` 的另一半。',
  },
  {
    id: 'R11.4', section: 11, status: 'met',
    claim: '三个采集调用点**都**把 `source` 与 `index` 接上（N1.2 是**三**处，不是两处）',
    check: { kind: 'file', path: 'scripts/gate-observe-call-sites.test.mjs' },
    note: '★ 2026-10-21 补上第三处（`src/tools.ts` 的 `edit_plan` 汇合点，此前 `source` / `loadIndex` / '
      + '`component` / `gateId` 四格全缺）。★ 而它是**唯一还在产出新信号**的那条路 —— '
      + '修复之前落盘的 5 条信号里 3 条判据仍 `unmeasured`，因为那 5 条全来自这一处。'
      + '判据本体在 `scripts/gate-observe-call-sites.test.mjs`（5 臂，按调用点逐块核，不靠一条 grep 猜）。',
  },
  // ── §12 计划审查循环终止性 ────────────────────────────────────────────────
  {
    id: 'R12.1', section: 12, status: 'met',
    claim: '(i) 单调不减的轮次度量 `planReviewRounds`，在 `edit_plan` 的**同一个锁内** +1',
    check: { kind: 'symbol', file: 'src/tools.ts', pattern: 'fresh\\.planReviewRounds = rounds' },
    note: '口径：**+1 per `edit_plan` 调用**（不是 per operation）—— 一次批量修 5 处不该吃掉 5/3 轮。',
  },
  {
    id: 'R12.2', section: 12, status: 'met',
    claim: '(ii) 有界上界 + 触顶后**真的停**：`approve` 读 `rounds >= max` 并拒绝',
    check: { kind: 'symbol', file: 'src/tools.ts', pattern: 'rounds >= PLAN_REVIEW_MAX_ROUNDS' },
    note: '★ 台账 §12 原写「⬜ 未实现」是**过期读数**：`7309ed1`（07:51）晚于 §12 写成（04:10）两小时。本条即那次更正。',
  },
  {
    id: 'R12.3', section: 12, status: 'met',
    claim: '(iii) 终止动作在**循环执行者**手里（模型侧工具面能 halt）',
    check: { kind: 'probe', probe: 'model-can-end-plan-loop' },
    note: '★ 2026-10-22 补上 `agent_teams_halt`（第 18 个工具，captain-only）。'
      + '★★ 而它与 `agent_teams_delete` 的分界是本条的要害：halt 停但**可恢复**'
      + '（任务 cancel 而非 remove、团队仍在、`resume` 能拉回），delete 结束并**归档**（不可逆）。'
      + '★ 两者合并会让「我停一下」与「我不要了」同形。判据在 `scripts/gate-halt-tool.test.mjs`（6 臂，2 条反向半边）。',
  },
  // ── §13 契约建时自查 ──────────────────────────────────────────────────────
  {
    id: 'R13.1', section: 13, status: 'met',
    claim: '`create_task` 与 `edit_plan` 的 `add_task` **两条路**都跑契约门',
    check: { kind: 'probe', probe: 'plan-route-runs-contract-gate' },
    note: '★ `4f831b3` 补上了 plan 路线（此前 `grep -c rejectOnContractGates src/tools.ts` ⇒ 0）。',
  },
  {
    id: 'R13.2', section: 13, status: 'partial',
    claim: '契约在**建**的那一刻就查出"声明了 `src/` 却没配 `lib/`"',
    check: { kind: 'symbol', file: 'src/gates/contract/build-artifact-scope.ts', pattern: 'blocked\\(blockers\\)' },
    note: '★ 缺的那一半：只查 lockstep 配对；"**每个落点**都在 scope 里吗"至今无判据（§20 逐字记过：判据不许猜）。',
  },
  // ── §14 shape 是声明 ──────────────────────────────────────────────────────
  {
    id: 'R14.1', section: 14, status: 'met',
    claim: '`runtime.shape-execution` 判「声明了 dispatch 而一个 worker 都没派」',
    check: { kind: 'file', path: 'src/gates/runtime/shape-execution.ts' },
    note: '三态 `measured / unmeasured / not-applicable` 两两不同形；`status` 有 `shape_execution` 出口。',
  },
  // ── §15 产物进主干 ────────────────────────────────────────────────────────
  {
    id: 'R15.1', section: 15, status: 'met',
    claim: '「这个产物进主干了吗」在树被回收之后仍答得出（四态 + `how`）',
    check: { kind: 'probe', probe: 'absorb-judgement-is-single' },
    note: '★ 判据只有一份：`judgeWorktreeReclaimable` **调** `absorbPlanOf`，不复制它（两份吸收判据必然分叉）。',
  },
  // ── §16 戳可核 ────────────────────────────────────────────────────────────
  {
    id: 'R16.1', section: 16, status: 'met',
    claim: '戳在落盘时绑定它审过的字节（`reviewedArtifacts`，读写两处都在）',
    check: { kind: 'probe', probe: 'stamp-binds-artifacts' },
    note: '★ 历史 118 份仍然 `unbound`（已显式读成那样，由臂逐条钉住、只许变短）。',
  },
  // ── §17 派活知上游合流 ────────────────────────────────────────────────────
  {
    id: 'R17.1', section: 17, status: 'met',
    claim: '派活那一刻说出「上游产物进主干了吗」（三态 `landed`）',
    check: { kind: 'probe', probe: 'baseline-reports-landed' },
    note: '★ 只报告、不改基线 —— 把"还没合流"的上游排除，会让下游在**更旧**的代码上干活（方向反了）。',
  },
  // ── §18 「接上了」三件事 ──────────────────────────────────────────────────
  {
    id: 'R18.1', section: 18, status: 'partial',
    claim: '「这个位置接上了」= ① 注册 ② 生产求值点 ③ 输入面真有产出（三件事各自一个读数）',
    check: { kind: 'probe', probe: 'admission-is-registered' },
    note: '★ 缺的那两半：`admission` 只满足 ①（3 条已注册 / 生产求值 **0** / 四格输入面生产 **0** 产出）。文档已按用户裁定改成真话，接线本身没做。',
  },
  // ── §19 build 在 worktree 里不可复现 ─────────────────────────────────────
  {
    id: 'R19.1', section: 19, status: 'met',
    claim: 'CSS 类名**不再**依赖绝对路径（`lib/client.js` 字节可复现）',
    check: { kind: 'probe', probe: 'css-hash-is-path-independent' },
    note: '★ 2026-10-22 修好：`tsdown.config.ts` 把 `filename` 从绝对路径改成**相对仓库根 + POSIX 分隔符**。'
      + '★★ 实测（同一 commit、两棵树、同一份 src/）：主树 md5 `505c631b…` · worktree `7262cea9…`，'
      + '**归一化根路径后逐字节相同**（差异只在 esbuild 的 `//#region` module-id 注释里）。'
      + '★ 推翻了 §19 的旧判断「这不是缺陷，是 worktree 的固有属性」—— 见那里的追记。'
      + '判据在 `scripts/gate-client-reproducible.test.mjs`（4 臂，含反向半边：绝对路径确实会改变类名）。',
  },
  // ── §20 契约写窄 ──────────────────────────────────────────────────────────
  {
    id: 'R20.1', section: 20, status: 'manual',
    claim: '「这件事的**每个落点**都在 scope 里吗」有判据在问',
    check: { kind: 'manual' },
    note: '★ 现无判据，且 §20 逐字判定"判据层做不到、不许猜"。可行形态是成员开工后第一条读数报越界 ⇒ 现有的 `dispatch.changed-paths` 就红。',
  },
  // ── §21 六件短板 ──────────────────────────────────────────────────────────
  {
    id: 'R21.1', section: 21, status: 'met',
    claim: '六件短板各有夹具（self-review / review-independence / session-budget / test-file-baseline）',
    check: { kind: 'file', path: 'scripts/gate-self-review.test.mjs' },
    note: '配套 `gate-review-independence` / `gate-session-budget` / `gate-test-file-baseline`。',
  },
  // ── §22 三条裁定为不做 ────────────────────────────────────────────────────
  {
    id: 'R22.1', section: 22, status: 'met',
    claim: '三条「不做」写在台账里（附读数），防止下一轮重做',
    check: { kind: 'symbol', file: 'docs/REQUIREMENTS.md', pattern: '裁定为不做' },
    note: '★ "不做"必须写下来 —— 否则下一个人会重新发现、重新提案、重新讨论一遍。',
  },
  // ── §23 台账必须有自己的对齐判据（2026-10-21 新增）───────────────────────
  {
    id: 'R23.1', section: 23, status: 'met',
    claim: '本仓的 `docs/REQUIREMENTS.md` 有一条**本仓自己的**机械对齐命令',
    check: { kind: 'probe', probe: 'alignment-command-exists' },
    note: '★ 在此之前零落点（`find . -name "requirements-contract*"` 为空），而台账第 5 行写着"供 workbench-align 比对"。',
  },
  {
    id: 'R23.2', section: 23, status: 'met',
    claim: '对齐判据有反向半边（证据消失必须变红，不许恒绿）',
    check: { kind: 'probe', probe: 'alignment-has-counter-half' },
    note: '臂：把一条 `met` 的 file 证据改成不存在的路径 ⇒ 必须报 `gone`；'
      + '把一条 `gap` 的证据人为弄得成立 ⇒ 必须报 `claim-stale`；'
      + '一个拼错的探针名 ⇒ 必须报 `gone`（不许静默变绿）。12 臂，5 条是反向半边。',
  },
  // ── §27 统一入口要图形化到"能看懂在干什么" ───────────────────────────────
  {
    id: 'R27.1', section: 27, status: 'gap',
    claim: '成员级图形化：**每个成员**在界面上的"在干什么"来自既有事实（不是新开的数据通道）',
    check: { kind: 'probe', probe: 'graphical-view-reads-existing-facts' },
    note: '★ 用户 2026-10-22 逐字否决了"像素文件夹"：「单纯的像素文件夹其实没有意义」。'
      + '★★ 探针问的是"有没有一个成员级的可读投影、且它的来源是既有字段" —— '
      + '而"画得好不好看"**不进判据**（本机没有视觉模型）。'
      + '⚠️ 场景①（工作区=房间）与场景②（照抄网吧）**是产品决策**，待用户裁定；'
      + '本判据对两案同样成立（都要求成员级读数来自既有事实）。',
  },
  // ── §26 2026-10-22 的六个落地 ────────────────────────────────────────────
  {
    id: 'R26.1', section: 26, status: 'met',
    claim: '模型侧有了**可恢复的**终止动作（`agent_teams_halt`），且与 delete 语义分界',
    check: { kind: 'file', path: 'scripts/gate-halt-tool.test.mjs' },
    note: '★ 6 臂，2 条反向半边。★ 分界：halt = cancel（不是 remove）+ 团队仍在 + resume 能拉回；'
      + 'delete = 归档、不可逆。判据同时钉住"非队长拒绝且零副作用"与"重复 halt 不重复 cancel"。',
  },
  {
    id: 'R26.2', section: 26, status: 'met',
    claim: '供应商 400 拒绝服务时 fallback 真的会换路由（`INVALID_REQUEST` 在清单里）',
    check: { kind: 'symbol', file: 'src/members.ts', pattern: 'INVALID_REQUEST' },
    note: '★★ 修正了两处：删掉 harness **不会产出**的 `MISSING_CREDENTIAL` / `NO_ADAPTER`；'
      + '加入那次真实整队停摆的判定结果 `INVALID_REQUEST`。'
      + '★ 判据在 `scripts/fallback-tdd.mjs` 的**真实事故臂**（喂原始报错，再问该不该换路由）。',
  },
  {
    id: 'R26.3', section: 26, status: 'met',
    claim: '收益读数有生产出口（`snapshot.effectReadout`），且真实语料那一格如实报"没数据"',
    check: { kind: 'file', path: 'scripts/gate-effect-readout.test.mjs' },
    note: '★ 落点在装配层（§1 规则 A + §3：evolution 与 evaluator 互不 import）。'
      + '★ 臂 3b 在零提案时 `diagnostic` 报出来，**不**报成通过。',
  },
  {
    id: 'R26.4', section: 26, status: 'met',
    claim: '`lib/client.js` 在两棵树上字节可复现（归一化根路径后逐字节相同）',
    check: { kind: 'file', path: 'scripts/gate-client-reproducible.test.mjs' },
    note: '★ 4 臂，含反向半边（绝对路径确实会改变类名 —— 否则臂 1 是恒真的）。'
      + '★★ 推翻了 §19「worktree 的固有属性」那个判断。',
  },
  {
    id: 'R26.5', section: 26, status: 'met',
    claim: '`inScope` 在**两条路线**上要求作者列出落点（同一条说明，逐字同源）',
    check: { kind: 'probe', probe: 'inscope-asks-for-every-landing-point' },
    note: '★ 按 §20 裁定**不造新判据**（判据层不许猜），而是把可判定的问句放进说明里。'
      + '★ 探针要求**两条路线**都改到 —— 只改一条会让换路线写契约的人拿到更弱的提示。',
  },
  {
    id: 'R26.6', section: 26, status: 'met',
    claim: 'pin 清单 / 文档工具数 / 待决归档三件事各自留了可复跑的读数',
    check: { kind: 'file', path: 'scripts/fixtures/baseline-known-failures.json' },
    note: '★ 退 1 条（有归因）、三条环境依赖**刻意不退**并改写 `because`；'
      + '文档工具数 14→18 且由 `doc-tool-counts-match` 守护（它第一次跑就抓到漏改的两处）。',
  },
  // ── §25 三处接线修补的读数（2026-10-21 新增）─────────────────────────────
  {
    id: 'R25.1', section: 25, status: 'met',
    claim: '三处接线修补各自留下**改前/改后**读数，且每条都有一条先红后绿的夹具',
    check: { kind: 'file', path: 'scripts/gate-observe-call-sites.test.mjs' },
    note: '输入面（edit_plan）· 提案写方（proposals.jsonl）· 重载归因（★ 早已修好，本轮只记录不改）。'
      + '配套 `gate-proposal-writer` 5 臂与 `member-failure-tdd` 的 17 臂。',
  },
  // ── §24 重启环的边界（2026-10-21 新增）───────────────────────────────────
  {
    id: 'R24.1', section: 24, status: 'met',
    claim: '重启那一环**如实保持"人来做"**：`agent_teams_restart` 继续声明它换不了代码',
    check: { kind: 'probe', probe: 'restart-still-honest' },
    note: '★ 反向半边：谁把这句话改成"reload 后即生效"，本条立刻红 —— 因为那正是 t11 记过的那句假承诺。',
  },
])

/**
 * `docs/REQUIREMENTS.md` 里 `## N.` 的每一节编号。
 *
 * ★★ 必须先剥**围栏代码块**，再找标题。MEASURED（本夹具臂 10）：
 *   台账里有大量 ``` 块，其中一行以 `## 5. ` 开头（注释/示例），
 *   不剥就会被当成**一个真实存在的节** ⇒ 「有没有未认领的节」这个读数被污染。
 *   而那正是本文件要防的形态：一个把**代码块里的文字**认证成结构的解析器。
 *
 * ★ 四空格缩进块与行内反引号**不剥**：本仓台账不用缩进式代码块，而多剥一层
 *   会把正常的段落注释吃掉（少报一个真实节 = 一个需求永远不被检查）。
 */
export function sectionsOf(markdown) {
  const withoutFences = markdown.replace(/^```[\s\S]*?^```/gm, '')
  return [...withoutFences.matchAll(/^## (\d+)\./gm)].map((match) => Number(match[1]))
}

/**
 * ── 检查一条 claim 的**机械**那一半 ────────────────────────────────────────────────
 *
 * @returns `{ holds, kind }`
 *   · `kind: 'manual'`      ⇒ `holds: undefined` —— ★ 判不了（不是"通过"）
 *   · `kind: 'mechanical'`  ⇒ `holds: true | false`
 *
 * ★ 为什么返回"这件事成立吗"而不是"该不该红"：**方向属于 claim，不属于探针**。
 *   探针自己翻转方向的那一天，`met` 与 `gap` 会在同一个读数上同形。
 */
export function evaluateCheck(claim, root = DEFAULT_ROOT) {
  const check = claim.check ?? { kind: 'manual' }
  if (check.kind === 'manual') return { holds: undefined, kind: 'manual' }
  if (check.kind === 'file') return { holds: existsSync(join(root, check.path)), kind: 'mechanical' }
  if (check.kind === 'symbol') {
    const file = join(root, check.file)
    if (!existsSync(file)) return { holds: false, kind: 'mechanical' }
    const text = check.file.endsWith('.md')
      ? readFileSync(file, 'utf8')
      : stripComments(readFileSync(file, 'utf8'))
    return { holds: new RegExp(check.pattern).test(text), kind: 'mechanical' }
  }
  if (check.kind === 'probe') {
    const probe = PROBES[check.probe]
    /** ★ 拼错的探针名**不许**读成通过 —— 那会让一个 typo 静默变绿。 */
    if (probe === undefined) return { holds: false, kind: 'mechanical' }
    try {
      return { holds: probe(root) === true, kind: 'mechanical' }
    } catch (reason) {
      /**
       * ── ★★★ 探针自己抛 ⇒ **`broken`，不是 `unverified`** ─────────────────────────
       *
       * MEASURED（本文件的第一次自检）：`proposal-is-actually-written` 那个探针的正则
       * 少了一个转义（`'recordProposalForSignal('`），于是它抛 `Invalid regular expression`。
       * 而第一版把它读成 `unverified`（"只能靠读"）—— 于是那条 claim **从 gone 变成了
       * 一个诚实的分类**，看起来像是有人工复核过它。
       *
       * ⇒ ★★ **判据坏了**与**判据只能靠读**是两件事，补救动作相反：
       *    前者去修探针，后者去读文档。合成一态会让一个坏掉的探针永久隐身。
       *   ★ 而 `broken` 是**阻塞**的（`isBlocking` 收它）—— 一个坏掉的读数不该静默。
       */
      return { holds: false, kind: 'broken', reason: String(reason?.message ?? reason) }
    }
  }
  /** 未知的 check 种类同样不许读成通过。 */
  return { holds: false, kind: 'mechanical' }
}

/** 一条 claim 的**结论** —— 六态，两两不同形。 */
export function verdictOf(claim, root = DEFAULT_ROOT) {
  const { holds, kind } = evaluateCheck(claim, root)
  /** ★ 探针坏了 ⇒ 直说"读不出来"，**不许**落进 `unverified` / `gone` / `gap-open` 任何一侧。 */
  if (kind === 'broken') return 'broken'
  const status = claim.status ?? 'met'
  /** ★ `open` 是"人还没决定" —— 本命令不判它，也**绝不**把它算进任何一侧。 */
  if (status === 'open') return 'open'
  if (holds === undefined) return 'unverified'
  if (status === 'gap') return holds ? 'claim-stale' : 'gap-open'
  return holds ? 'verified' : 'gone'
}

/**
 * ── 整份报告 ────────────────────────────────────────────────────────────────────
 *
 * ★ 六组**不许合流**，因为补救动作各不相同：
 * ```
 * gone         ⇒ 去补实现，或把 claim 降级
 * claim-stale  ⇒ 去**改台账**（缺口已闭合，现状那一格过期了）
 * unverified   ⇒ ★ 只能靠读，本命令不声称验证过
 * gap-open     ⇒ 已知缺口，待办，**不是失败**
 * open         ⇒ ★ 人还没决定，**不是缺陷**
 * verified     ⇒ 机械核对过
 * ```
 */
export function buildAlignment({ claims = CLAIMS, root = DEFAULT_ROOT } = {}) {
  const requirementsPath = join(root, 'docs', 'REQUIREMENTS.md')
  const markdown = existsSync(requirementsPath) ? readFileSync(requirementsPath, 'utf8') : ''
  const sections = sectionsOf(markdown)
  const claimed = new Set(claims.map((claim) => claim.section))

  const results = claims.map((claim) => ({ ...claim, verdict: verdictOf(claim, root) }))
  const pick = (verdict) => results.filter((result) => result.verdict === verdict)

  return {
    sections,
    results,
    gone: pick('gone'),
    stale: pick('claim-stale'),
    unverified: pick('unverified'),
    broken: pick('broken'),
    gapOpen: pick('gap-open'),
    open: pick('open'),
    verified: pick('verified'),
    sectionsMissing: claims.filter((claim) => !sections.includes(claim.section)).map((claim) => claim.id),
    unclaimedSections: sections.filter((section) => !claimed.has(section)),
    counts: {
      total: results.length,
      mechanicallyVerified: pick('verified').length,
      byReadingOnly: pick('unverified').length,
      evidenceGone: pick('gone').length,
      claimStale: pick('claim-stale').length,
      broken: pick('broken').length,
      gapOpen: pick('gap-open').length,
      open: pick('open').length,
    },
  }
}

/** 只有这三类会让门变红（`unverified` / `gap-open` / `open` 都不是缺陷）。 */
export function isBlocking(report) {
  return report.gone.length > 0 || report.stale.length > 0 || report.unclaimedSections.length > 0
    || report.broken.length > 0
}
