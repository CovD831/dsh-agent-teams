# 四方 harness 对比：qoder / claude-code / pi / ZCode

> **本文回答的问题**（用户原话）：
> 「希望你去看一下别人，特别是大厂的成熟实现，他们那边肯定有一些更成熟的地方值得我们吸收借鉴。目前我就做了一个 qoder，其实也可以去看看其他的 harness。」
>
> ⇒ 他要的不是"吸收 qoder"，而是把**"看成熟实现"当成一种持续方法**。本文是这套方法的第一份产出，也是第一份**它自己承认样本不足**的产出。

**本文只写本文件**，未改动 `src/`、`scripts/`、`lib/`、t22 产出、外部只读材料。

---

## 0. 一句话结论

**qoder 的绝大多数"机制"，在 claude-code 里都能找到同构物** —— 真正的独立发现是三条：

1. **本插件的 worktree 隔离不是学任何人的** —— 它是本 fork 自己加的（L7, `68ee2c8`），而 **DSH 上游把它明确列为"未承诺的未来方向"**。⇒ 这条和 qoder 无关，也和"通例"无关。
2. **qoder 的 `humanTurns` 硬闸门是四家里唯一的** —— claude-code 与 ZCode 用**完全不同层**的方式解决同一个问题（提示词标记 vs 硬编码白名单）。
3. **pi 根本没有团队机制** —— 它是"单 agent + 扩展"，不是多智能体 harness。⇒ 它**不能**被当作"多智能体通例"的一个样本。

★ 而本任务原本最想判的那条 —— "**worktree 隔离是通例、一家、还是场景权衡**" —— 答案是**出乎预料的第四种**：它是**本仓自己的选择**。

---

## 1. 证据基础与引用格式

### 1.1 四个参照系

| # | 名称 | 性质 | 位置 | HEAD / 证据等级 |
|---|---|---|---|---|
| 1 | **qoder** | 商业 Electron 产品（解密材料） | `/Users/abab/Desktop/qoder 解密`（只读） | 材料内自标 `observed-Q` / `inferred` / `unknown` |
| 2 | **claude-code** | **逆向重建的 Claude Code CLI** | `claude-code@77a7934e15d6` | `observed-R`（我读源码） |
| 3 | **pi** | 开源 coding agent（`pi-monorepo`） | `pi@b45e0ebcc5ae` | `observed-R` |
| 4 | **ZCode** | 商业 CLI（zai-org） | `ZCode@aac4755666d0` | `observed-R` |

**三个克隆的来源与 commit（必须写进文档，按契约要求）**：

```
pi          https://github.com/earendil-works/pi.git
            b45e0ebcc5ae2fc42a6f2f23104d10e656e6bedb   2026-10-14T14:29:58Z
ZCode       https://github.com/zai-org/ZCode.git
            aac4755666d09fdcd70272fcf063c077a639015f   2026-10-10T18:59:29+08:00
claude-code https://github.com/claude-code-best/claude-code.git
            77a7934e15d69da13879112ed7db695c9ee7a52a   2026-08-24T00:33:27Z
```

**取证方式**：`web_fetch` 对 `github.com` 报 `non-public IP` 被沙箱拦（我已复核），但 **`git` 协议可用** ⇒ 用 `git clone --depth 1 --filter=blob:none` 取回。
**规模**：pi 1922 文件 / ZCode 16880 / claude-code 3549（不含 `.git`）。
**克隆位置**：`/tmp/harness-study/`（队长的副本；我另有一份 `/tmp/harness-ref/`，**HEAD 与队长完全一致**，已核对）。

**证据等级约定**（沿用 t22 的口径）：
- `observed-Q` = qoder 材料里亲读到的原文
- `observed-R` = **我**在这三个仓库的源码里亲读到的行
- `inferred` = 由前两者推导
- `unknown` = **未取证，本文不当结论**

### 1.2 ★ 先纠正一个会污染整张表的计数陷阱

我第一轮扫描时得到"`cursor` 在材料里出现 **5743** 次"，看上去像"材料其实在对比 Cursor"。
**这是假的。** 实测拆分：

```sh
$ grep -roi "cursor" docs/  | wc -l     # ⇒ 2      （散文里真正的提及）
$ grep -roi "cursor" pretty/ | wc -l    # ⇒ 5741   （minified renderer 里的 DOM `cursor:` 属性）
```

⇒ **5741/5743 是 CSS 的 `cursor:` 属性**，不是 Cursor IDE。
同类假信号还有 `sweep`（10 次，全是英文词 "multi-modal sweep"，不是工具 Sweep）。

**修正后的真相**：qoder 材料的 `docs/` 散文里，潜在竞品提及是
`claude` 22 / `codex` 4 / `cursor` **2** / `cline` **1** / `windsurf` **0** / `copilot` **0**。
**而其中没有一处是竞品机制对比** —— 全表唯一的跨 harness 事实是一条**血缘声明**（§2.4）。

★ 这条写在这里，是因为它正是本队记账最久的错：**一个未经验证的计数被当成了结论**。

---

## 2. 四家横向对比表

**空格一律写「未观测」，不写留白、不写猜测。**
覆盖性口径见 §2.3（区分「确实没有」与「我没找到」）。

### 2.1 机制矩阵（固定维度）

| 维度 | qoder | claude-code | pi | ZCode | 本插件 |
|---|---|---|---|---|---|
| **拓扑** | 三套并存（②对等 / ①星型 / ③父子） | **对等 + 广播**（`Teammate by name` / `Broadcast to all teammates`） | **无团队**（只有扩展式 subagent） | teammates 存在，拓扑未判定 | **对等**（`to` = captain 或成员名） |
| **通信载体** | 文件邮箱 `inboxes/<b64>.json`（②）/ SQLite `agent_inbox_items`（①） | **文件邮箱** `~/.claude/teams/<team>/inboxes/<agent>.json` + UDS socket + `bridge:` 跨机 | 未观测 | 未观测 | **进程内内存表 + Promise 链锁**（既非文件也非 DB） |
| **锁机制** | `.lock` 文件锁（②）/ SQLite 行锁（①） | 未观测（有 inbox 文件，未见显式锁） | 未观测 | 未观测 | `withTeamLock` 内存 Promise 链（**不是文件锁**） |
| **隔离级别** | 进程隔离（②）/ 会话隔离（①） | **可选 worktree** + **终端窗格**（tmux / iTerm / WindowsTerminal）+ **InProcess** 四后端 | 未观测 | 未观测 | **worktree（git detached 检出）** |
| **任务模型** | task board + `round` | `TaskCreate/Get/List/Update/Stop/Output` 六件套 | 无 | 有 task 工具 | `create_task` / `claim_task` / `update_task` / `reassign_task` |
| **优雅退出** | shutdown 三步握手 `request→approved\|rejected` | **`shutdown_request` / `shutdown_response`**（同一个 SendMessage 内的协议消息） | 未观测 | 1 处 | `restart` 单向 + 禁重启仲裁（**非三步握手**） |
| **idle 同步** | **`TeammateIdle` hook** | **`TeammateIdle` hook**（12 文件） | 无 | **无** | 未观测 |
| **自我进化** | Skill Evolution 全闭环（confidence ≥0.6 / 幂等去重 / TTL 7d / 每会话上限 5） | **`skillLearning/` 21 文件**，含 `MIN_CONFIDENCE_TO_GENERATE_SKILL = 0.75` | 无 | 无 | **无**（判据只增不减，t22 §3-②1） |
| **工具面** | 三套各自一套 | Team×2 + SendMessage + Task×6 + Agent（**与本插件最同构**） | 扩展式 | 有 SendMessage/Task | `TEAM_TOOL_NAMES` 15 个，其中 `MEMBER_TOOL_NAMES` 4 个 |

**逐格证据（关键格）**：

| 格 | 证据 |
|---|---|
| claude-code 对等+广播 | `claude-code@77a7934:packages/builtin-tools/src/tools/SendMessageTool/prompt.ts:33-34` —— `` `"researcher"` \| Teammate by name ``（:33）、`` `"*"` \| Broadcast to all teammates ``（:34） |
| claude-code 文件邮箱 | `claude-code@77a7934:src/utils/teammateMailbox.ts:4` 逐字 `Each teammate has an inbox file at .claude/teams/{team_name}/inboxes/{agent_name}.json`；另 `docs/agent/coordinator-and-swarm.mdx:424` 给出 `~/.claude/teams/<team-name>/inboxes/<agent-name>.json` |
| claude-code 四后端 | `claude-code@77a7934:src/utils/swarm/backends/` 下 `TmuxBackend.ts:104` / `ITermBackend.ts:79` / `WindowsTerminalBackend.ts:93` / `InProcessBackend.ts:38`，各自 `implements PaneBackend` / `TeammateExecutor` |
| claude-code shutdown 握手 | `claude-code@77a7934:packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.ts:49,53` 两个 `z.literal('shutdown_request')` / `('shutdown_response')` |
| claude-code TeammateIdle | `claude-code@77a7934:src/utils/hooks.ts:3859` 注释 `Execute TeammateIdle hooks when a teammate is about to go idle`；`hooksConfigManager.ts:181` |
| claude-code 自进化 | `claude-code@77a7934:src/services/skillLearning/`（21 文件）+ `learningPolicy.ts:5` `MIN_CONFIDENCE_TO_GENERATE_SKILL = 0.75` |
| qoder 阈值 0.6 | `observed-Q`（qoder 材料 `README.md:118-131`）—— **与 claude-code 的 0.75 是两个不同阈值**（§2.5） |
| pi 无团队 | §2.3 覆盖性论证 |

### 2.2 ★ 隔离策略专节（队长预判最值钱的一处 —— 结论出乎预料）

**队长的预判**：DSH 用 git worktree，claude-code 用终端窗格 ⇒ 判"worktree 是通例、一家、还是场景权衡"。

**实测结论 —— 三种都不是，是第四种：worktree 隔离是「本仓自己的发明」。**

证据链：

**① claude-code 不是"用终端窗格替代 worktree"，而是两者都支持、且 worktree 是「可选的」**：

```ts
// claude-code@77a7934:src/utils/swarm/backends/types.ts:235-236
  /** Optional git worktree path */
  worktreePath?: string
```
⇒ `worktreePath` 是**可选字段**，另有 `useSplitPane?: boolean`（`:237`）控制是否用窗格。
⇒ **claude-code 的隔离是"可插拔的、按后端与配置选"** —— 不是它选择了窗格而放弃 worktree。

**② DSH 上游的 team 包明确声明「不做 worktree」**：

```
# dsh-ref/dsh-experimental-agent-team/README.md:207
- **One process and one shared checkout** — members share cwd and observe edits
  immediately; this package provides no worktree, remote member, merge, or
  filesystem lock.

# 同文件 :227
Undecided directions include nested Teams, automatic ownership release policies,
cross-process mailbox transactions, and filesystem isolation via worktrees;
none of these are committed.
```

⇒ **"成员共享同一个检出"是 DSH 上游的设计立场**，而 worktree 隔离被它列入**"未承诺的未来方向"**。

**③ 而本插件确实做了 worktree，且是它自己的一层**：
- `docs/LAYER-INVENTORY.md:68` —— `L7 worktree 隔离  68ee2c8 (10-05) ─ 每任务一个 detached 检出（版本可核对）`
- `src/worktree.ts` —— **1296 行**
- `src/gates/dispatch/worktree.ts:77` —— `export const id = 'dispatch.worktree'`

**⇒ 对"要不要保留 worktree 隔离"这个决定的直接含义**：
它既**不是**该向 qoder 学的东西，**也不是**"业内都这么做"，**更不是**上游给的。
它是 **L7 这一层自己的取舍**（10-05 那条冲刺线）。⇒ 要评估它，判据必须是**本仓自己的卡点读数**，而不是"别家怎么做"——因为别家根本没有同一个处境（claude-code 是本地 CLI 多窗格，DSH 上游是单进程共享检出）。
**★ 这条我标为 `inferred` 而非 `observed`**：我观测到了"claude-code 有可选 worktree + 窗格后端"与"DSH 上游声明不做 worktree"两个事实，但"本插件为何选 worktree"的**动机**我没有直接证据（需读 `68ee2c8` 的 commit message / 当时的卡点台账才能定）。

### 2.3 ★ 覆盖性口径：「确实没有」vs「我没找到」

这是本仓记账最久的一条（t22 §10 同款纪律）。我对下表每一格都注明**凭什么说没有**。

| 断言 | 种类 | 凭什么 |
|---|---|---|
| **pi 没有团队机制** | **确实没有** | pi 是 monorepo，`packages/` 11 个包全部列出；团队类标识符（`teammate` / `TeamCreate`）在 `pi/packages/*/src` 下 **0 命中**；其 subagent 只作为**示例扩展**存在（`pi/packages/coding-agent/examples/extensions/subagent/`）。⇒ 且 `pi/packages/agent/src` 只有 6 个文件（`agent-loop.ts` / `agent.ts` / `proxy.ts` / `stream-fn.ts` / `types.ts` / `index.ts`），**不含任何团队子系统**。 |
| **ZCode 没有 `TeammateIdle`** | **确实没有** | 覆盖 16880 个文件的 `grep -rl TeammateIdle`（已排除 node_modules/dist）**0 命中**，而它同时有 `teammate` 相关文件（`incoming-message.ts` 等）⇒ 是"有 teammate 概念但没有这个 hook"，不是"我没扫到"。 |
| **claude-code 没有 `humanTurns`** | **确实没有** | 3549 文件 0 命中；且我另查了它的等价物（下 §3.2），确认它用**另一层**解决。 |
| **claude-code 的 task 没有 attempt_id 式版本令牌** | **未判定** | `grep attempt_id` ⇒ 0；其 `TaskUpdateTool/prompt.ts:47` 有一个 `## Staleness` 小节，但**正文是"更新前先 TaskGet 读最新状态"的指令**（`observed-R`），**不是**版本令牌拒绝。⇒ 我**不能**断言"claude-code 没有等价机制，只是在别处或形态不同"—— 需要读完整 task 子系统才能定。 |
| **qoder 的 `humanTurns` 在别家** | **1/4 家（ZCode 的命中是异义）** | 见 §3.2。 |

### 2.4 qoder 材料内唯一的跨 harness 事实：一条血缘声明

**这是纯扫描最容易漏掉、但最重要的一条。**

qoder 材料里**唯一**的跨 harness 机制陈述是一条**血缘**（不是对比）：

```
# qoder 材料 docs/subagent-mechanism.md:221  （observed-Q）
这些是 Qoder CLI 直接转述 Claude Code 的同名协议，术语（`Agent`/`Task` 工具、
`subagent_type`、`fork`、`run_in_background`）在 E1 中逐字出现。

# 同文件 :227
### A.1 结论：是的，就是 `.claude/agents/*.md` + YAML frontmatter 的同构方案（**observed**）
```

**我的独立复核（`observed-R`）**：这条声明**可被四家扫描证实**
`subagent_type`：qoder 17 / ZCode 83 / claude-code 27 / **pi 0**
`.claude/agents`：claude-code 10 / ZCode 4 / **pi 0**
`run_in_background`：qoder 29 / ZCode 84 / claude-code 18 / **pi 0**

⇒ **含义（对决策很重要）**：qoder 不是这套机制的**作者**，它是**转述者**。
所以"qoder 这么做"这个理由的**证据价值被大幅削弱** —— 它更可能是"Claude Code 这么做"。
**⇒ 这直接支持本任务的核心判据：不能把 qoder 的做法当成最佳实践。**

### 2.5 ★ 一处真实的"同问题、两家独立解、数字不同"

| 主题 | qoder | claude-code | 判定 |
|---|---|---|---|
| 自进化产出的**置信度门** | `confidence ≥ 0.6`（`observed-Q`，材料 `README.md:118-131`） | `MIN_CONFIDENCE_TO_GENERATE_SKILL = 0.75`（`observed-R`，`skillLearning/learningPolicy.ts:5`） | **≥2 家观测**，但**阈值不同** |

⇒ **这是本文最有决策价值的一格**：两家**独立**实现了"置信度门 + 自进化"，但**阈值不一样**（0.6 vs 0.75）。
⇒ **⇒ 结论：连"置信度门"这个模式是共享的，具体阈值也不是通例，而是各自场景的调参。**
**任何人拿 qoder 的 0.6 来给本插件定阈值，都是在抄一个偶然数。**

### 2.6 ★ 收紧准三态（按队长要求，且 §2.2 证明了它必要）

| 判定 | 定义 | 本表条目 |
|---|---|---|
| **≥2 个独立 harness 观测** | 至少两家**独立**源码里有同一机制 | 文件邮箱通信、`TeammateIdle` idle 同步、shutdown 握手、worktree 概念、自进化闭环、置信度门、Task 六件套 |
| **仅 1 个观测** | 只有一家（或只有 qoder） | qoder 的 `humanTurns` 硬闸门、qoder 的 SQLite `agent_inbox_items`、claude-code 的四后端可插拔（pi/ZCode 未观测）、claude-code 的广播 `"*"` |
| **未判定** | 证据不足 | ZCode 的拓扑、ZCode 的隔离级别、claude-code 的锁机制、claude-code task 的版本令牌等价物 |

**★ 并且必须写死一句：`≥2` 仍不等于通例。**
本表里"≥2"的 7 条，样本是 **4 家**，而这 4 家里 **claude-code 与 qoder 有血脉关系**（§2.4）——
⇒ **它们不是独立同分布的两个样本**。一个机制在"qoder + claude-code"都出现，可能只等于**一个**观测。

---

## 3. 三条承重论断的逐条对照

### 3.1 承重论断① —— 「三套机制互不共享代码」

**qoder 的原话（`observed-Q`）**：材料 `README.md:11` 判定本插件最接近 ②，同时借用 ① 的 attempt_id，**两者不同构**。

**多面对照**：

| 家 | 是否分套 | 证据 |
|---|---|---|
| **qoder** | **是，三套**（①DiscussionTeam / ②InProcessSquad / ③Subagent），各用不同通信载体（SQLite / 文件邮箱 / tool_result） | `observed-Q` |
| **claude-code** | **否 —— 是一套统一的 Team/Teammate + SendMessage**，Task 六件套共用 | `observed-R`：工具面在**同一个** `packages/builtin-tools/src/tools/` 下并列（`TeamCreateTool` / `SendMessageTool` / `Task*Tool` / `AgentTool`），且 `SendMessageTool/prompt.ts` 同一份提示词里同时处理"teammate by name"与"cross-session bridge:" ⇒ **没有按机制分成三套协议** |
| **pi** | **不适用**（无团队机制） | §2.3 |
| **ZCode** | 未判定 | 未观测 |

**⇒ 判定：`仅 1 个观测`（qoder 独有）**
**⇒ 含义（回答"本插件要不要收敛到一套模型"）**：
qoder 把三套分开、claude-code 把一套统一 —— **一家一种做法，无法据此判定哪种更成熟**。
★ **这条在只有 qoder 一个样本时，本来会得到"应该分套"的错结论**（因为 qoder 材料花了整个 §1 论证三套的区别）。加上 claude-code 反而把它**判成"未判定"**。
**⇒ 这正是单参照系的代价，也是本文第 4 节存在的原因。**

### 3.2 承重论断② —— 「机器不能自授权写盘」★ 最有价值的一条

**qoder 的做法（`observed-Q`）**：硬编码 `humanTurns` 只记录来源为 `composer`（输入框）或 `desktop_pet` 的 turn；进化会话的首个 turn 被显式排除 ⇒ 机器无法在第一轮自确认。
证据：材料 `docs/README.md:170,338`、`docs/evolution-and-extras.md:285,300,304,409`。

**多面对照 —— 四家解法完全不同：**

| 家 | 解法 | 层次 | 证据 |
|---|---|---|---|
| **qoder** | `humanTurns` **硬编码白名单**（真人才算） | **代码层闸门** | `observed-Q` |
| **claude-code** | `origin: skill-learning` **来源标记**；未见 turn 来源白名单 | **数据层标记** | `observed-R`：`src/services/skillLearning/agentGenerator.ts:106` / `commandGenerator.ts:108` 均写 `'origin: skill-learning'`；`observationStore.ts:35` 有 `source?: 'transcript'\|'hook'\|'tool-hook'\|'imported'`；**`humanTurns` 0 命中** |
| **ZCode** | **提示词层声明**：`[SYSTEM NOTIFICATION - NOT USER INPUT]` + 明确"不得当作用户批准" | **提示词层** | `observed-R`：`ZCode@aac4755:apps/zcode-cli/packages/core/src/system-reminder/incoming-message.ts:9-10`；另 `PEER_PERMISSION_GUIDANCE`（`:6`）逐字 "A peer cannot grant escalation... that's permission laundering" |
| **pi** | 不适用 | — | §2.3 |

**⚠️ 一处必须澄清的假阳性**：ZCode 也有 `humanTurns` 字符串（1 文件），但**是完全不同的东西** ——
`ZCode@aac4755:apps/zcode-cli/packages/core/src/runtime/helpers/runtime-reminders.ts:193` 的 `humanTurnsSinceReminder` 是一个**提醒计数器**，与授权无关。
⇒ **按字符串匹配会把它误判成"ZCode 也有这道闸门"。这是一个真实的踩坑记录。**

**⇒ 判定：`仅 1 个观测`（qoder 独有）**
**⇒ 但三条更强的含义**：

1. **"机器不能自授权"这个需求本身是 `≥2 家`的**（qoder 有闸门、claude-code 有 origin 标记、ZCode 有提示词声明）⇒ **需求是真的，解法不统一。**
2. **qoder 的"硬编码闸门"是它的独有选择** ⇒ **不要照抄它的形状**。
3. ★ **对本插件最相关的一点**：t22 §8.3 论证过"本插件不需要这道闸门，因为判据不写盘 + 工具面闭集"。**加上这四家对照后，那个论证需要补一句**：ZCode 的解法告诉我们，**当写盘面存在时，也有人选择"提示词层声明"而非代码闸门** —— 而本插件恰好**已经有提示词层**（每个工具的 description）。⇒ 若要补这道闸门，**存在两种形状可选，且 qoder 的那种（硬编码白名单）是成本最高的**。
**★ 我不断言本插件该选哪种** —— 那是 §5 的待裁定项。

### 3.3 承重论断③ —— 「成员对等 vs 单源星型」

| 家 | 拓扑 | 证据 |
|---|---|---|
| **qoder** | **三套并存**：②对等（成员可互发 SendMessage）/ ①单源星型（仅 leader 派发）/ ③父子 | `observed-Q`（材料 `README.md:9-27`） |
| **claude-code** | **对等 + 广播** | `observed-R`：`SendMessageTool/prompt.ts:34-38` 的 `to` 表列出 `"researcher"`（Teammate by name）与 `"*"`（Broadcast to all teammates），**没有任何"仅 leader 可发"的约束** |
| **pi** | 不适用 | §2.3 |
| **ZCode** | 未判定 | 未观测 |
| **本插件** | **对等**（`to` = captain 或成员名），但**派发权 captain-only** | `src/tools/message.ts:25`；`src/tool-names.ts:24-26`（`MEMBER_TOOL_NAMES` 仅 4 个） |

**⇒ 判定：`≥2 家`（qoder ② + claude-code）选了「对等」**
**⇒ 但立刻要加的反向半边**：
- claude-code 的对等**比本插件更彻底** —— 它有**广播** `"*"`，本插件没有；而本插件多了**派发权 captain-only**（claude-code 未见等价约束）。
- ⇒ **"对等"是 `≥2 家`，但"对等到什么程度"三家各不同。**
**⇒ 对用户第 5 点的含义（救援由谁发起）**：qoder 与 claude-code 都让成员能**横向**发起通信 ⇒ **本插件的"成员对等"不是异类**，这一点上**没有被比下去**。

---

## 4. ★ 单参照系风险清单（本文最有用的部分）

**这一节直接服务用户"也可以去看看其他 harness"的意图。**

### 4.1 已经被第二样本推翻 / 降级的三条（**这就是单参照系的代价**）

| # | 只有 qoder 时会得出的结论 | 加上 claude-code 后 | 若不看第二家会怎样 |
|---|---|---|---|
| R1 | "本插件应把三套机制**分开**（qoder 花了整节论证三套的区别）" | **降级为未判定** —— claude-code 用**一套统一**的 Team 模型 | 会按 qoder 的形状重构，而那是**一家的偶然** |
| R2 | "worktree 隔离是通例 / 或该学 claude-code 的窗格" | **两者都不是** —— 它是本仓 L7 自己的取舍，DSH 上游明确不承诺 | 会把**本仓已有的一层**误判成"缺失"，去做反向工程 |
| R3 | "置信度门应该定在 0.6" | **阈值不是通例**，claude-code 独立选了 0.75 | 会抄下一个**偶然数**并写进代码 |

### 4.2 仍需第二个 harness 才能判定的结论（**下一步该看什么**）

按"看哪个产品 → 看它哪个机制 → 为什么它能判开某个问题"给出：

| # | 要判的问题 | 下一个该看谁 | 看它的什么 | 为什么它能判开 |
|---|---|---|---|---|
| **N1** | **claude-code 的 task 是否有 attempt_id 式版本令牌？**（决定本插件 `attempt_id` 是通例还是一家） | **claude-code 的完整 task 子系统**（本表未读完） | `packages/builtin-tools/src/tools/TaskUpdateTool/` + `src/tasks/` 全量；找 supersede / generation / optimistic-lock | 它是**唯一**与本插件工具面同构的一家；`## Staleness` 小节已给线索但方向未定 |
| **N2** | **ZCode 的拓扑与隔离级别** | **ZCode**（16880 文件的成果只用了 0.5%） | `apps/zcode-cli/packages/core/src/` 的 teammate 流程 + `harness/` 目录 | 它是四家里**规模最大**的，且**有 teammate 却无 TeammateIdle** ⇒ 它用别的办法做 idle 同步，那正是要看的 |
| **N3** | **"机器不能自授权"该用哪一层做闸门？**（§3.2 的待裁定） | **claude-code 的 `skillLearning/promotion.ts` + `skillLifecycle.ts`** | 它有没有**用户确认**环节、以及 `origin: skill-learning` 是否被下游消费 | 本插件若要补闸门，claude-code 提供了**代码层以外的两种形状** |
| **N4** | **pi 的"子代理作为扩展"是不是一种值得学的形态？** | **pi** | `packages/coding-agent/examples/extensions/subagent/` 全目录 | 它是四家唯一**不把多智能体做进内核**的 ⇒ 对"要不要收敛到一套模型"是**反向样本** |
| **N5** | **`TeammateIdle` 到底解决什么？**（claude-code 与 qoder 都有，但本插件无） | **claude-code**（12 文件，比 qoder 材料详细） | `src/utils/hooks.ts:3859` 起的完整实现 + `getTeammateIdleHookMessage` | 这是**≥2 家**的一条，最接近"通例"，也最可能真是一个缺口 |

### 4.3 ★ 一条我拒绝升格的（防止新增"看起来合理"的结论）

`TeammateIdle`（idle 同步）是本文里**唯一**同时出现在 qoder 与 claude-code 的"team 专属"机制。
它很容易被写成"**通例 ⇒ 本插件缺口**"。**我不这么写**，理由有三：

1. **两家有血脉关系**（§2.4）⇒ 不是两个独立观测。
2. **ZCode 有 teammate 却没有它** ⇒ 至少有一家**有团队机制但不需要它**。
3. **本插件侧的缺口证据我没有** —— 我没有任何读数说明"成员 idle 时本插件漏掉了什么"。

⇒ 归入 §5 的"**未证明是缺口**"，并进 §4.2 的 N5（要看 claude-code 的实现才知道它解决什么）。

---

## 5. 吸收清单：缺口 vs 差异

**★ 铁律：`qoder 有 X 而我们没有` ≠ `我们缺 X`。**
每条必须给出**本插件侧的证据（文件:行）**，或**明写「未证明是缺口」**。

### 5.1 判定为「本插件真实缺口」的 —— **0 条**

我必须如实报告：**本文没有判定出任何一条"有本插件侧证据的真实缺口"。**

**为什么这不是偷懒**：本任务要求"给出本插件侧证据（哪个卡点、哪条读数、哪个 文件:行）"。我逐一检查了所有候选，**没有一条能配上这样的读数**。而本队刚花三轮修正一批"看起来合理但实测为假"的归因 ——
⇒ **所以正确答案是 0 条，而不是硬凑几条。**

### 5.2 明写「未证明是缺口」的

| # | qoder/claude-code 的做法 | 为什么不构成缺口 | 别家为什么需要它 |
|---|---|---|---|
| G1 | **`TeammateIdle` hook**（≥2 家） | 本插件**无任何读数**显示 idle 时漏掉了什么 | claude-code 需要它是因为**teammate 是独立进程**，父进程要感知"它闲了"；本插件成员是**会话**，idle 由 `activity`/`liveness` 字段直接表达（`src/client/activity-monitor.ts:92` 的 `liveness` 注释即为此设） |
| G2 | **shutdown 三步握手**（≥2 家） | 本插件有 `restart` + 禁重启仲裁；**没有读数**说明单向退出造成过孤儿 | qoder/claude-code 要收拾**独立进程/窗格** |
| G3 | **worktree 隔离** | **不是缺口 —— 本插件已经有**（`src/worktree.ts` 1296 行，L7） | 反过来：DSH 上游**不做**它 |
| G4 | **自进化闭环（Skill Evolution）** | t22 §3-②1 已判"观察期结束条件没有落点"是**缺口**，但那**不是** qoder 指出的 —— 它有**本仓自己的证据**（见 5.3） | qoder 需要它是因为它的产物是**技能文件**（可自动写盘）；本插件的判据是**纯函数**（`src/gates/**` 零 I/O import） |
| G5 | **置信度门 / TTL / 每会话上限** | 同 G4：机制形状可疑，但**本插件不需要"对产物限额"**，因为没有自动产物 | qoder 要防自进化产物堆积 |
| G6 | **广播 `"*"`**（claude-code 独有） | 未证明是缺口；本插件 `send_message` 支持逐成员发送 | claude-code 的 team 规模可能更大 |

### 5.3 已有本仓独立证据的（**不是从 qoder 学来的**）

这三条是 t22 的产出，**证据全在本仓**。我在此**只做交叉引用，不改写**（`docs/QODER-LESSONS.md` 属 out-of-scope）：

| 项 | 本仓证据 | 与本文的关系 |
|---|---|---|
| `admission` 三条判据**从未进注册表** | `src/gates/index.ts` 的 `ALL_GATES` 仅 14 条（我实测复现），而 `grep -rn "^export const id = '" src/gates/*/*.ts` ⇒ 17 | **与 qoder 无关** —— 这是本仓自己的断链 |
| 判据**输出面未声明**（输入面已有 `requires`） | t22 §2-②2 | 与 qoder 无关 |
| `poolForRescue` 只有二值、**无上报出口** | `src/tools/shared/entities.ts:2868`；`AskUserQuestion` 在 `src/` **0 命中**（我实测复现） | 与 qoder **部分**相关：claude-code 有 `AskUserQuestionTool`（38 文件）、ZCode 有 119、pi 有 2 ⇒ **`≥2 家`都有"问人"这个出口，而本插件 0** —— ★ 见下 |

**★ 关于 `AskUserQuestion` 的一点补充（这是本文少有的、可能构成缺口的线索）**：
`grep -rl AskUserQuestion`（已排除 node_modules/dist）：

| qoder | claude-code | pi | ZCode | **本插件** |
|---|---|---|---|---|
| 材料未见此工具 | **38 文件** | **2 文件** | **119 文件** | **0**（`grep -rn src/` 实测） |

⇒ **"把问题送到人面前"这个能力，三家都有，本插件 0。**
**但我仍不判它是缺口**，因为：本插件的裁定路径是 **台账 + 人主动看**（t22 §4-②2 已描述），而"报不到人"是否真的造成过卡点，**我没有任何读数**。
⇒ 归入 **§5.4「建议优先验证」**，而不是直接判成缺口。★ 这个区分很重要：**"三家都有"是"通例"的最强证据，但仍不等于"我们缺"** —— 那需要一个本仓卡点。

### 5.4 ★ 建议优先验证的一条（附本插件挂载点，但**不判为缺口**）

| 项 | 内容 |
|---|---|
| **候选** | 上报出口（把 `pool: 'escalate'` 送到人面前） |
| **通例强度** | **`≥2 家`**（claude-code 38 / ZCode 119 / pi 2 文件均含 `AskUserQuestion` 类工具；本插件 **0**） |
| **本插件现挂载点** | 判据：`src/tools/shared/entities.ts:2868` `poolForRescue`（`cannot-solve ⇒ escalate`） |
| **缺口证据** | **我没有**。需要一条"某次 `escalate` 因为没人看台账而误了事"的读数 |
| **★ 两种解读都要写（按契约要求）** | 见 §6 |

---

## 6. ★ `self 378 / escalate 6` 的两种解读（本任务明确要求：两种都写）

**读数出处**：`docs/GATE-EFFICACY.md`（**我未修改该文档**，只标注其性质）。实测 **98.4% 的卡点自己消化**（`self 378 / escalate 6`）。

### 解读 A：救援机制**确实有用**（支持"保留并强化"）

- `self 378` 说明**绝大多数卡点被机械判据消化掉了** —— 这正是"尽量少打扰"的目标状态（用户第 4 点）。
- `escalate 6` 说明**该上报的确实被识别出来了**（没有全塌成 self）。
- ⇒ 若 `poolForRescue` 的缺省曾反着来（t22 §5-① 记着：实测曾有 **214 条被默认推进 `escalate`**），那么这个 6 是**修正后的读数**，说明**判据在起作用**。

### 解读 B：我们的救援需求**比 qoder 小**（支持"不必照抄 qoder 的重型闭环"）

- 6 次上报 / 384 条卡点 ⇒ **上报是极稀有的路径**。
- qoder 的 Skill Evolution 是**为"高频自进化产物"设计的重型闭环**（阈值 + 幂等去重 + TTL 7 天 + 每会话上限 5 + 独立进化会话）。
- ⇒ 一个**每 64 条才发生一次**的路径，**不值得**一整套 TTL/限额/独立会话。
- ⇒ **也可能说明：本插件的场景里，"上报"根本不该被优化成一条重型管线。**

### ★ 两个解读的**判据是同一个读数**，所以必须由用户裁定

我**不选**哪一个是结论。**能把它判开的那条读数在本文里不存在** ——
需要的是"**这 6 次上报，人花了多少时间、有没有一次误事**"。这需要：

```sh
# 判开这条所需的读数（本仓目前没有 → 进 §7 待取证）
# ① 6 条 escalate 的台账明细（时间、卡点内容、人的处置耗时）
grep -rn "escalate" .agent-teams/*/inbox/*.jsonl 2>/dev/null | wc -l
# ② 是否有"打扰预算"计数器 —— t22 §5-②3 判为缺失
grep -rn "escalat" src/tools/shared/entities.ts | head
```

⇒ **在新证据之前，"98.4% 自消化"是"机制有效"与"需求很小"的共同证据，不是任一方的判据。**

---

## 7. 待取证（外部分结论，未取证不许当结论）

| # | 待取证事项 | 为什么现在取不到 | 要什么才能取 |
|---|---|---|---|
| E1 | **三个 GitHub 仓库的源码** | `web_fetch` 对 `github.com` 报 `non-public IP`（沙箱拦） | ✅ **已解决** —— `git clone --depth 1 --filter=blob:none` 可用（§1.1 已给 URL 与 SHA） |
| E2 | **claude-code 是否有 attempt_id 等价物** | 我只读了 `TaskUpdateTool/prompt.ts` 的 `## Staleness` 小节，未读全 `src/tasks/` | 需要读 `claude-code@77a7934:src/tasks/` 全量 + `TaskUpdateTool.ts` 的实现 |
| E3 | **ZCode 的拓扑 / 隔离级别 / idle 同步** | 16880 文件只扫了标识符层面 | 需要读 `apps/zcode-cli/packages/core/src/` 的 teammate 流程 |
| E4 | **qoder `humanTurns` 之外的授权闸门** | 材料只有 `observed-Q` 级描述 | 需要 qoder 二进制里 `noteUserTurn` 的调用链 |
| E5 | **"本插件为何选 worktree"的动机** | 需要 commit 语境而非代码 | `git log -1 68ee2c8` 的 message + 当时的卡点台账 |
| E6 | **`self 378 / escalate 6` 的人侧成本** | 无计数器（t22 §5-②3 判为缺失） | 6 条 `escalate` 的明细 + 人工处置耗时 |
| E7 | **pi 的 subagent 扩展能否支撑团队场景** | 只看了它存在，未读实现 | `pi@b45e0eb:packages/coding-agent/examples/extensions/subagent/` 全目录 |

---

## 8. 方法建议（**建议，不是结论**）

按队长提示，评估"用工具持续看其他 harness"的可行性。**以下全部标为建议。**

**本次实际用的方法（可复制）**：

```sh
# ① 取回（web_fetch 被拦时 git 可用）
git clone --depth 1 --filter=blob:none <url> <dir>
# ② 四家并列扫标识符（★ 必须排除 vendored，否则满盘假阳性）
grep -rlE "<pattern>" <dir> --include=*.ts --include=*.tsx --include=*.md \
  | grep -vE '/(node_modules|\.git|dist|build|vendor|third_party)/' | wc -l
# ③ 命中后必须回读上下文判语义（§3.2 的 humanTurns 假阳性就是这么抓到的）
```

**★ 三条必须遵守的纪律（本次各踩过一次）**：
1. **排除 vendored**：不排除 `node_modules/dist` 会得到满盘假阳性。
2. **命中 ≠ 同义**：`humanTurns` 在 ZCode 是提醒计数器（§3.2）、`cursor` 5743 次是 CSS 属性（§1.2）。
   ⇒ **必须回读上下文**，否则得到的是"看起来很像的错数字"。
3. **区分"确实没有"与"我没找到"**（§2.3）。

**关于 `rea` 的评估（队长提示的增值项，标为建议）**：
`rea`（`REA: Reverse Engineer Anything`，`mcpName: io.github.morluto/rea`）**很可能就是产出这份 qoder 材料的工具本身**（`observed-R`：`rea/package.json` 的 name/mcpName）。
它的目标面覆盖 **binary / application / runtime behavior**，且在 `rea/tests/boundary/` 下能看到 **Electron / asar / CDP / 浏览器运行时** 的成套测试 ⇒ **对 Electron/Node 类产品（qoder、ZCode 都是）适用性是它已有的能力面**，不是要新开发的。
⇒ **建议**：把"取下一家 harness"做成**一次 rea 会话 + 上面三步扫描**的可重复流程。
**★ 但这只是建议** —— 我没有实测过一次端到端的 rea 取数，故不标结论。

---

## 9. 本文没有回答的（如实留白）

1. **本文判出 0 条"有本插件侧证据的真实缺口"**（§5.1）。这个 0 是**结论**，不是遗漏 —— 但若有人能给出本仓卡点读数，它会被改写。
2. **ZCode 的拓扑与隔离级别完全未判定**（16880 文件只做了标识符级扫描）。
3. **claude-code 的 task 版本令牌问题未判定**（§2.3、§4.2-N1）。
4. **"本插件为何选 worktree"是 `inferred`，不是 `observed`**（§2.2③）。
5. **§6 的两个解读我没有选**，因为判开它需要的那条读数不存在。
6. **`TeammateIdle` 我拒绝升格为缺口**（§4.3），理由已列三条。

---

*本文只写 `docs/HARNESS-COMPARISON.md`。未改动 `src/`、`scripts/`、`lib/`、`docs/QODER-LESSONS.md`、`docs/GATE-EFFICACY.md`、外部只读材料。未实现任何代码。*
*所有外部引用格式：`仓库@commit:文件:行`。三个克隆的 URL / HEAD / 日期见 §1.1。*
