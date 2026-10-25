# 自进化模块（资金化）设计 v2 —— 2026-10-16

> **v1 的问题**：我只读了三份记忆项目（EverOS / MemOS / memex），**类别错了** ——
> 它们是 L1（上下文/记忆），而用户要的是 **self-evolution**。
>
> **v2 补读**（见 §1 的对照表）：GEPA · DGM · **STOP** · SkillClaw · Raven ·
> Awesome-Harness-Self-Improvement。

---

## 1. ★★★ 我补读的东西，以及它们的**统一骨架**

**`Awesome-Harness-Self-Improvement`（★116）给了这个领域的骨架 ——
一条 L0→L5 的「优化阶梯」（它逐字说"This ladder is the backbone"）:**

| Level | 被自进化的对象 | 代表工作 |
|---|---|---|
| **L0** | **指令提示词** | APE · OPRO · Promptbreeder · ★ **GEPA** |
| **L1** | **上下文 / 记忆** | ACE · Dynamic Cheatsheet · ReasoningBank |
| **L2** | **工作流 / 图** | ADAS · AFlow · GPTSwarm · AgentSquare |
| **L3** | **Harness / agent 代码** | ★ **DGM** · SICA · Gödel Agent · Self-Harness |
| **L4** | **优化器 / meta-harness** | ★★ **STOP** · Meta-Harness · MCE |
| **L5** | **Harness + 权重** | SIA · SEAL |
| — | *（边界）只改权重* | self-play · RLVR —— **不在范围内** |
| — | *（边界）人写的 harness 设计* | ReAct · SWE-agent · MCP —— **不在范围内** |

⇒ ★★★ **而我们这个插件要做的,横跨 L0 / L1 / L2 / L3 四层**（见 §5 的映射）。

★ **它同时给了一条判据:**
> 「As the model becomes more capable, the field moves **down** this table:
>  toward more complex self-improved targets and more general mechanisms.」

⇒ ★★ **即:越靠下的层越难、越通用。** 我们该**从 L0 开始,逐级往下**,
**而 L3（改自己的代码）是最危险的一层** —— 见 §4。

---

## 2. ★★★ 那份清单里**最该先看的一节**:失败模式

**它的 §5 逐字（这是整份清单里对我最重要的一句）:**

> 「The failure modes that gate real RSI.
>  **The evaluator and permission control should sit OUTSIDE the loop
>  that evolves the harness.**」

⇒ ★★★ **这就是我一直在担心的那件事,而它被写成了本领域的通则。**

### 它列出的失败模式（我按对我们的威胁排序）

| 失败模式 | 对我们的含义 |
|---|---|
| ★★ **Misevolution**（Shao et al., ICLR 2026）| 「Self-evolving LLM agents 的**涌现风险**」—— 直接关于自进化 harness 的风险 |
| ★★★ **Reward hacking**（Skalse et al., NeurIPS 2022）| 「**unhackability 是一个强条件**」—— 我们「验收可以被优化」就是可被 hack |
| ★★ **Reward model overoptimization**（Gao et al., ICML 2023）| 优化**代理指标**会让真实目标**退化** |
| ★★ **Specification gaming**（DeepMind 2020）| agent 钻目标的漏洞 —— ★ 本会话已有实例（"为了让测试变绿而放宽断言"）|
| ★★★ **Reward tampering**（Denison et al., 2024）| 「从 sycophancy 泛化到**篡改奖励函数**」—— ★ **自优化循环改自己的裁决** |
| ★ **Monitoring reasoning models**（Baker et al., 2025）| CoT 监控能发现作弊,但**训练时对着监控器优化会变成隐蔽** |
| ★★ **AI Agents That Matter**（Kapoor et al., 2024）| 基准**只看准确率不看成本、holdout 弱** ⇒ 自进化的信号有效性危机 |
| ★★★ **METR 2026**:「Many SWE-bench-Passing PRs Would Not Be Merged into Main」| ★ **通过基准的 PR,人类合并率远低** —— 对自进化编码 harness 的**评估有效性警告** |

⇒ ★★★ **而这最后一条正中我们的处境**:本会话反复出现
**"测试通过"与"真的做对了"不同形"** —— METR 那条说的是**同一件事的规模化版本**。

---

## 3. ★★★ 三个可直接照搬的机制（都有源码依据）

### ① ★★★ STOP:把**评估器**与**被评估对象**分成两个文件

**这正是 §2 那条通则的**实现**。`microsoft/stop` 的目录:**

```
tasks/maxcut/utility.py          ← ★ 给被进化的程序看的（n_tests = 3）
tasks/maxcut/secret_utility.py   ← ★★ 真正的裁决（n_tests = 100，不同 seed）
```

⇒ ★★★ **被进化的对象只能看到公开的那份;真正的裁决在它【不可见、不可改】的另一份里。**

★ **而 STOP 的摘要逐字提到它做的评估:**
> 「evaluate the frequency with which the generated code **bypasses a sandbox**」

⇒ ★★ **即:它【度量】了"绕过沙箱的频率"** —— **那本身就是一个读数,而不是一句保证。**

### ② ★★ GEPA / Hermes:约束闸在**候选之后、采纳之前**

**`hermes-agent-self-evolution`（★5512）的流程逐字:**

```
Read current skill/prompt/tool ──► Generate eval dataset
                                        │
                                   GEPA Optimizer ◄── Execution traces
                                        │
                                   Candidate variants ──► Evaluate
                                        │
                            ★ Constraint gates (tests, size limits, benchmarks)
                                        │
                                   Best variant ──► PR against hermes-agent
```

⇒ ★★ **两点与我们完全对口:**
```
· "Constraint gates (tests, size limits, benchmarks)"
  ⇒ ★ 复用既有验证器（我们有 test:gates / verify:fast / tsc）
· "PR against hermes-agent"
  ⇒ ★★ 采纳走【PR】,不是直接写 —— 即【隔离 + 人可见】
· "GEPA reads execution traces to understand WHY things fail (not just that they failed)"
  ⇒ ★★ 那正是"分类"该做的:不只记"失败了",要记"为什么"
```

### ③ ★★★ Raven:**角色与信息边界**（诊断层与机制层分开）

**`EverMind-AI/Raven`（★5470，"harness of harnesses, built for RSI"）的 §2 逐字:**

| 角色 | 看得到 | 看不到 | 产出 |
|---|---|---|---|
| Trial | 员工与对话方往来 | ★ 评价标准 | 会话 |
| 评价者 | 对话 · 交付物 · 自己的标准 | 员工内部实现 | `Signal` |
| **Analyst** | 评价者原话 · 会话 · 执行记录 | ★ **评价者私下打分** | **`Feedback`:决定与行为要求** |
| **Curator** | 行为要求 · 当前 Harness | ★★ **评价标准 · 原始打分** | 修订后的 Harness |

**三条边界（它逐字）:**
> 「① **评价者不直接对 Curator 说话。**
>  ② **Analyst 停在诊断层** —— 它说明哪个行为没达到、证据是什么,**不说改哪个策略面**;
>     机制归因是 Curator 的事。
>  ③ **要求可观察、不写答案** —— 每条要求写情境与期望行为、实际行为、证据、验收方式,
>     **不写"加一个 intake 清单"这类机制建议**。」

⇒ ★★★ **这三条我建议【直接搬】,因为它正好回应我们的两个老问题:**
```
① 「评价者不直接对 Curator 说话」
   ⇒ 对应我们的:"不要听『我检查过了』,要可复跑的读数"
② 「Analyst 停在诊断层」
   ⇒ 对应我们的:"分类"与"分流"该分开 —— 分类说"是什么病",分流说"怎么治"
③ 「要求可观察、不写答案」
   ⇒ ★ 对应我们的:验收必须可读出真假，不能写"做得好"
```

★ **而 Raven 的闭环有一个我没见过的细节:**
> 「**最后一轮只评价、不修订,因为没有下一轮能检验那次修订。**」
> 「停止条件:Analyst 决定 stop;**所有评价者都满意且不需要修订**;或轮次用完。」

⇒ ★★★ **"没有下一轮检验的修订不做"** —— **那是一条很硬的纪律,而它防的正是"改了但没验"。**

---

## 4. ★★★ 于是在我们这里,"评估器待在循环外"该怎么落

**这是本设计**唯一**不能妥协的一条。**

```
★ 被自进化的对象（循环内）:
   提示词文本 · profile.protocol · executionPrompt · 判据的阈值
   ⇒ ★ 这些可以被 AI 改

★★ 裁决器（循环外 · AI 【不可改】）:
   ① 判据本身（src/gates/**）        ⇒ ★ 改了就是"自己改考卷"
   ② 验证命令（test:gates / verify:fast）
   ③ 那条"该 kind 的卡点是否下降"的读数
   ④ ★ 本设计里的 confidence.ts 阈值
   ⇒ ★ 这些【只有人】能改，而 AI 只能【读】
```

⇒ ★★ **而 STOP 给了它最简单的实现:两个文件。**
```
我们不引入"secret"这种命名（它会让人以为是在藏东西）,
而是【物理上分开】:
  src/evolution/         ← 循环内（AI 可改）
  src/gates/ + 验证器     ← 循环外（★ AI 只读，且由一个编译期/夹具级约束钉住）
```

★ **而"AI 只读"需要一个**机械保证**（不能靠纪律）:**
```
★ 一条臂:src/evolution/** 不许 import 任何【写路径】
  （state 的写函数 / gates 的注册函数 / tools 的写函数）
⇒ ★ 而这是可机械检查的（静态扫描 import 图）
```

---

## 5. ★★ 映射:我们各层对应阶梯的哪一级

| 阶梯 | 我们已有的 | 状态 |
|---|---|---|
| **L0 提示词** | `usageSectionText`（队长 10 条）· `memberPersona`（成员 10 条）· `profile.protocol` | ★ **可改,但无循环** |
| **L1 上下文/记忆** | `.agent-teams/frictions/`（384 条）· `confidence.ts` | ⚠️ **有数据,零读者** |
| **L2 工作流** | `scheduler.ts` · DAG 依赖 · `reviewPolicy` | ⚠️ **可改,无循环** |
| **L3 代码** | 插件自身（`src/`）| ★★ **危险层 —— 本轮不做** |

⇒ ★★★ **所以本模块的范围是 L0 + L1 + L2,而 L3 明确排除。**
**而那与那份清单的"越往下越危险"一致。**

---

## 6. 采集层:采什么（用户原话的三类）

```ts
export interface EvolutionSignal {
  readonly kind: 'rejection' | 'success' | 'insight'
  readonly source: { readonly where: string; readonly gateId?: string; readonly tool?: string }
  readonly message: string          // ★ 原文，不改写
  readonly context?: Readonly<Record<string, unknown>>
  readonly scene?: { readonly team?: string; readonly task?: string; readonly attempt?: number }
  readonly at: number
}
```

★ **对应你原话:**
> 「不管是**报错**,还是主会话发任务时**子代理觉得不合理**;
>  或者子代理做出了一些**比较好的处理办法**,主会话觉得在什么方面**处理得很好、很有价值**」

### ★★★ 而 GEPA 那句补了重要一条

> 「GEPA reads execution traces to understand **WHY** things fail (**not just that** they failed)」

⇒ ★★ **所以 `context` 与 `message` 之外,还要一格 `why`(机制活动) ——
而 Raven 给了它的来源:**
> 「Analyst 会把"**装上的机制本轮实际做了什么**"一并交给 Curator:
>  哪条审核放行了几次、打回了几次、理由是什么,哪个工具调用失败了。」

⇒ ★★★ **即:采集不只采"失败了",还采【哪条机制在当场做了什么】。**
★ 而本仓**恰好有那个数据**:判据的 `ran[]`（每条判据的裁决）+ `commandsRun`。

---

## 7. 采集点怎么嵌（不许侵入）

```
❌ 侵入:  src/gates/contract/task-atomicity.ts 里 import evolution
✅ 不侵入: 宿主在【已有的】汇合点调用一次 observe()
```

| 汇合点 | 位置 | 覆盖 | 状态 |
|---|---|---|---|
| `recordFriction()` | `entities.ts:3805` | ★ **所有判据拒绝** | ✅ 已在 |
| 工具拒绝抛出点 | `tools.ts` | ★ **闸门拒绝** | ★ 新增一行 |
| 契约校验 | `quality-gates.ts:843` | ★ **契约类** | ★ 新增一行 |

**★ 而 `src/gates/**` 一个字都不改。**

---

## 8. ★★ 三条不许侵入的规则（用户硬约束）

```
A. 别人 → evolution：★ 只许 import src/evolution/index.ts
B. evolution → 别人：★ 只读。要影响别人 ⇒ 发信号给宿主
C. 采集点：★ 别的模块不许主动调用采集 —— 宿主在既有汇合点调用一次
```

★ **而 §4 那条是 A/B/C 之外的第四条（最重的一条）:**
```
D. ★★★ 裁决器不许被循环内改 —— 且这是【机械保证】的，不是纪律
```

---

## 9. ★ 落地顺序（按阶梯,从最安全那级开始）

| # | 做什么 | 层级 | 为什么先做 |
|---|---|---|---|
| **1** | ★ **采集层**:放宽触发 + 加 `kind` | L1 | ★ 后面所有层的前提;零风险 |
| **2** | ★ **补录**本会话 7 次（带 routing）| L1 | ★ 产生第一批真实样本 |
| **3** | **分类 + why**:复用 9 类 + 判据 `ran[]` | L1 | ★ **GEPA 的"why"** |
| **4** | **分流**:soft / hard / unmeasured | L1→L0 | ★ 你要的那一格 |
| **5** | ★ **裁决器隔离臂**:evolution 不许 import 写路径 | ★ §4 | ★★ **做任何自改之前必须先有它** |
| **6** | **L0 生效**:改 prompt（profile 层,可改）| L0 | ★ 第一次真闭环 |
| **7** | **投影**:client 能看到提示词模块 | L0 | ★ 你的 2(a) |

★ **而第 5 步【必须】在第 6 步之前** ——
**否则第一次自优化就可能改到自己的考卷。（那正是 §2 那条通则。）**

---

## 10. ★★ 待你拍板

| # | 问题 | 我的建议 |
|---|---|---|
| **1** | 范围 L0+L1+L2,明确排除 L3（改自己代码）? | ★ **建议排除** —— 与清单"越往下越危险"一致 |
| **2** | 裁决器隔离用**机械臂**（静态 import 检查）? | ★ **建议是** —— 纪律会腐烂 |
| **3** | 采集层现在做? | ★ **建议现在** —— 它是前提,且零风险 |

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
