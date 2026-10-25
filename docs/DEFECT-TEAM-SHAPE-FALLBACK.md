# 缺陷：你的修复只把"派临时工"从**不可能**变成**可能**，没管**谁负责写那段文本**

**记账日期**：2026-10-20 · **发现于**：用户指出（建团时已睡，未能当场纠正）
**状态**：已定位，未修

---

## 用户原话

> 「你这个建团 是用早期插件的形态建的 而不是后来我规定的形态
>  而且关于这个问题 其实我已经做过修复了 但显然并没有起效」

---

## 1. 规定形态 vs 实际形态

用户已定的形态（`docs/NEW-TEAM-PLAN.md:74` 逐字）：

> **队长是持久的（captain），成员是持久的 dispatch 点 —— 而每一条任务用临时 worker 执行。**
> ★ Worker = 临时 sub agent，干净上下文，在【那棵 worktree】上
> ★ Reviewer = 也是临时的，在【同一棵 worktree】上，干净上下文
> ★ Integrator = 合并多棵 worktree

语料里的实现范本（`mutation-quality` 的 `ledger` / `foreman`）逐字：

> 你拉起临时 subagent 去执行实现/修理任务，拉起的临时 reviewer 去审查。
> 每张实现或修理任务只拉一个临时 worker。
> **你不写代码、不审代码。**

| | 规定形态 | `self-iteration-3`（本轮建的） |
|---|---|---|
| 成员是什么 | **持久记账点**——不写代码、不审代码 | 持久**实现者**——自己写代码 |
| 每条任务 | 拉一个临时 sub-agent，注入契约 | 成员**自己动手** |
| 上下文 | 每条任务干净 | 成员会话不断累积 |
| 观测到的后果 | —— | **三个成员的会话全部烧穿 100 万 token 上限** |

★ 最后一行不是巧合：那套形态存在的**理由**，就是避免本轮实际发生的那场失败
（见 `docs/DEFECT-TEAM-SHAPE-FALLBACK.md` 与 `CONTEXT_WINDOW_EXCEEDED` 那一族）。

## 2. 普查：8 个队里只有 2 个用了规定形态

```
队                                    members  有prompt  提到派临时工
agent-teams-hardening                    10        4          1
agent-teams-refactor                     11       11          0
mutation-cost                             3        0          0
mutation-quality                          6        6          2   ← 规定形态
overnight-registration-hardening          3        3          2   ← 规定形态
self-iteration                            4        4          0   ← 升级前建的老队
self-iteration-3                          4        4          0   ← 本轮建的
unified-pipeline                          4        4          0
```

可复跑：

```bash
node -e "
const fs=require('fs');
for(const t of fs.readdirSync('.agent-teams')){
  const p='.agent-teams/'+t+'/team.json';
  if(!fs.existsSync(p))continue;
  const d=JSON.parse(fs.readFileSync(p,'utf8'));
  const ms=d.members||[]; if(!ms.length)continue;
  console.log(t, 'members='+ms.length,
    'prompt='+ms.filter(m=>m.executionPrompt).length,
    'delegating='+ms.filter(m=>/sub-?agent|临时\s*worker|临时工/i.test(m.executionPrompt||'')).length);
}"
```

## 3. 用户的修复做了什么（`81d08df`，全部仍然有效）

```
· src/tools/create.ts   plan.members 接受 executionPrompt（schema 层，之前被挡在门外）
· src/capabilities.ts   TEAM_MEMBER_PROMPT 增加 subagent 提示（443 → 544 字节）
· scripts/gate-profile-models.test.mjs  arm 8 / arm 9（三条建员路径字段集一致）
```

★ 三件**都还在**，`node --test scripts/gate-profile-models.test.mjs` ⇒ **13/13 绿**。
`lib/capabilities.js` 里也查得到那句提示。
⇒ **机制层面没有坏，修复没有被回退。**

## 4. 那为什么"没起效"——精确的断点

`src/capabilities.ts:33` 那句是**条件句**：

> `If your persona delegates the work to helpers, spawn subagents for it rather than doing it yourself.`

而同文件 `:24` 的注释自己写下了它的边界：

> ★ 措辞刻意**条件化**……**这一段只把"人设说了要派"这件事从【不可能】变成【可能】。**

⇒ **条件的前件由谁提供？没有人负责。**
`executionPrompt` 是**可选**的；不写就不派，写了一份"你是实现者"的人设也不派。
修复把门打开了，但**没有一条规则要求建团的人走进去**。

★ 而这条修复的注释在 `:20` 已经预言过这个缺口：

> 没有那段文本的队，成员即使拿到 subagent 工具也不会用。

⇒ **修复自己的注释已经说清了它治不了这一半** —— 而本轮恰好在那一半上栽了。

## 5. 与"能力 vs 默认值"那一族的关系

这是本仓记账的第四条同族（前三条见 `docs/DEFECT-VERIFY-RERUN-WRONG-CWD.md`）：

| | 形状 |
|---|---|
| A | 门读对了命令，cwd 错了 |
| B | 判据读对了语义，期望的路径形状旧了 |
| G8 | 判据对，"这棵树还在被写"从未进入输入 |
| **本条** | **修复对，"谁来写那段人设"从未进入任何判据** |

一句话：**能力给了、提示也给了，而"默认走哪条路"没有任何东西管。**

## 6. 处置方向（未实施，三条按代价排序）

### (a) 让"成员是派工点"成为建团的**默认**，而不是需要队长记得写

`create({plan})` 在成员**没有** `executionPrompt` 时，注入一段
`capabilities.ts` 侧认定的**默认 persona**（"你是持久派工点：拉临时 worker 执行、
你只核字段与契约"）。要派活的队可以覆盖它。

★ 代价：改了所有**没写人设**的队的默认行为。回放 `agent-teams-refactor`（11 条 prompt
全是实现者风格）会受影响 —— 所以需要一条 `mode: 'implementer' | 'dispatcher'` 的显式选择，
而不是静默替换。

### (b) 在**建团那一刻**问一句并落盘

`create({plan})` 的 schema 加一格 `shape: 'dispatch' | 'flat'`（默认 `'dispatch'`），
`team.json` 落 `shape`。`capabilities.ts` 的提示按 `shape` 选措辞。

★ 代价：`TeamState` 加一格（要过 `coerceTeamState` 的校验），并有存量的 8 个队
没有这一格 ⇒ 必须定"缺席读成什么"（★ 按本仓纪律：缺席 ≠ 任一种，要么 `unmeasured`，要么显式迁移）。

### (c) 只在**文档/协议**层加一句（最轻，也最可能再次腐坏）

队长协议加一条：「建团时每个成员要么是人设里明说要派临时工的派工点，要么是实现者；
不许两者都不写。」★ 代价：**这正是本仓反复记过的"靠人记得"的规则**，
而它已经被证伪过一次（本条缺陷）。

★ 我的建议：**(b)**。理由：`shape` 是一个**可读的事实**（落在 `team.json` 里），
而 (a) 是"默认值猜对了就没问题"（猜错就静默）、(c) 是靠人记。
(b) 还能让 `team-shape` 变成一条可复跑的普查（像第 2 节那张表一样，但读的是**声明**而不是人设文本）。
