# 外部参照：Harness² / Open Code Review / ACP

> **本文用途**：把三个"会长期被引用"的外部系统一次记清 —— 它们各自解决哪一格、
> 我们能拿走什么、拿不走什么。
>
> **证据等级**（沿用本仓口径，逐条标注）：
>
> | 标签 | 含义 |
> |---|---|
> | `observed-R` | **主理人亲自读源码**（`/tmp/h2-probe`、`/tmp/ocr-probe`） |
> | `observed-A` | 成员读源码并给出 `文件:行`（本表未逐条复核） |
> | `observed-search` | 搜索结果 / 二手文章（最弱，标了日期） |
>
> **采集时间**：2026-10-23。这三个都是活跃项目，**结论会过期**。

---

## 0. 一句话：三者各占一格，缺一角都不成立

```
Harness²    自迭代    改哪个组件、怎么知道改对了、经验怎么留
OCR         评审内容  什么算问题（规则是数据）、怎么少误报
ACP         后端抽象  谁去执行（client ↔ agent 的标准接口）
本仓        机械证据  三态裁决 + 反事实 + 可寻址证据链
```

**它们没有一个是"我们的竞品"** —— 三个都在我们需要的方向上，但都缺"可核的证据"。

---

## 1. Harness²（Google Research）

### 1.1 基本事实

| 项 | 值 | 等级 |
|---|---|---|
| 论文 | arXiv `2610.14224`，2026-10-09 | `observed-search` |
| 仓库 | `github.com/google-research/harness2` | `observed-search` |
| 协议 | **Apache-2.0** | `observed-R`（LICENSE 存在） |
| 版本 | v0.1.0，Python，12.1k stars | `observed-search` |
| 支持的执行器 | **只有 OpenCode 与 Codex** | `observed-search` |
| 定位 | 研究发布，**非官方支持的产品** | `observed-search` |

### 1.2 核心机制：两层递归

```
任务级（一次任务内）
  Propose → Probe → Compose
    · 提两个候选：一个补通用弱点（规划/工具使用），一个补领域约束
    · 同一任务各跑一遍，比行为差异
    · 组合出更合适的（也可以选择保留原始 harness）
    · ★ 不要标准答案

Harness 级（跨任务）
  把采纳的 harness + 有证据支持的教训写入持久经验库
  下一个任务仍从基础 harness 开始，但改的时候能读库
```

**8 个可编辑组件**：system prompt · guardrails · memory · tool guidance · subagents · skills · scripts · plugins。

### 1.3 ★ 三个可以直接抄的设计（`observed-R`，逐字来自源码 docstring）

**① 经验库的目录就是检索算法** —— `harness2/core/library.py:16-24`

```
<root>/<run-tag>/<mode>/<domain>/INDEX.md
<root>/.../<domain>/harnesses/<task>/harness/<rel>     ← 完整采纳的组件树
<root>/.../<domain>/harnesses/<task>/EXPERIENCE.md     ← 为什么选它 + 教训
```

三条设计要点（docstring 逐字）：

- **Retrieval is by construction** —— 按 domain 分目录，不靠检索算法。同领域的东西只在该目录里。
- **The whole tree is carried, never a summary** —— 整棵树带走，**不做摘要**。
- **Roots are scoped per run and mode** —— 每次 sweep 从空开始，可复现。

**② 框架差异全是数据** —— `harness2/core/tree.py:16-20`

> Everything that differs between the two agent frameworks is **data on `SurfaceSpec`**
> (paths, caps, frontmatter rules, README seeds) plus a per-surface hooks-schema validator;
> **the shared logic exists once**.

编辑契约 **`omitted-is-inherited`**：提案只写它改的部分。

**③ 自迭代的成本是可算的** —— `harness2/core/ledger.py:16-28`

```
R = 4k   rollouts      = k 基线 + 2k 候选 + k 组合
P = 3k   改进会话      = k 通用 + k 领域 + k 组合
```

且明确：retries 单独计；**selection 与 reflection 不在这个账本里**（记在账外）。

### 1.4 它自己承认的边界（`observed-search`，论文原文转述）

- 行为对比**不能替代**标准答案：一个对比可以真实存在，但与正确性无关
- 选择器仍可能选错；错误的前提可能在多个候选中传播
- 经验迁移**没有稳定保证**
- 论文报告了 **9 次性能回退**
- 默认配置：executor 网络不受限、Codex 无沙箱、可能触达公开的 benchmark 答案

### 1.5 对我们意味着什么

**它是"没有标准答案时怎么自迭代"的答案；我们有判据，所以能做得更省、更可信。**

| | Harness² | 本仓 |
|---|---|---|
| 改进信号 | 行为对比（无 rubric） | 判据裁决 + 效果读数（有 rubric） |
| 成本 | k=1 需 **4 次执行**；k=5 需 **20 次** | 复用真实交付，**零额外执行** |
| 持久化 | 组件树 + EXPERIENCE.md + INDEX | 流程模板 + `gate-tally` + `confidence` |

★ **而且我们有它没有的一条约束**：Harness² 的 8 组件里 `guardrails` 是硬约束、`prompt/skills/scripts` 是软约束，
但它优化时**只改软的一侧**，没有任何机制要求「改了提示词必须配一条检查」。
⇒ 本仓的**软硬配对**（SPEC §18）是对它的实质改进，不是它的子集。

### 1.6 拿不走的

- **substrate**：只支持 OpenCode / Codex。接 Claude Code 或 Pi 要自己写 —— 这正是 §1.7 与 §3 的位置。

### 1.7 能拿的三样

| 拿什么 | 用在哪 |
|---|---|
| 经验库结构（组件树 + EXPERIENCE.md + INDEX，按 domain 分区、整树不摘要） | 「流程模板库」 |
| `omitted-is-inherited` 编辑契约 | 关卡配置的差异表达（不用每次写全量） |
| 预算恒等式（R=4k, P=3k） | 自迭代的成本必须可算，与 `gate-tally` 合起来才算得清 |

---

## 2. Open Code Review（阿里巴巴）

### 2.1 基本事实

| 项 | 值 | 等级 |
|---|---|---|
| 仓库 | `github.com/alibaba/open-code-review`，**Go**，24MB | `observed-R` |
| 版本 | v1.13.3（HEAD `375f64c`） | `observed-R` |
| 背景 | 阿里内部 AI 代码评审助手两年，数万开发者、数百万缺陷（**自述**） | `observed-search` |
| 形态 | **CLI**：读 git diff → 带工具调用的 agent 读全文/搜代码 → 行级 comment；另有 `ocr scan` 扫全文件 | `observed-R` |

### 2.2 ★ 它的规则是**数据驱动**的（最该抄的一格）

```
internal/config/rules/system_rules.json      审查点清单
internal/config/rules/rule_docs/*.md         按语言/框架的规则正文
internal/config/rules/system_rules.go        Resolver 加载
```

用户加规则**不改代码**，优先级链（`skills/open-code-review/SKILL.md:139-164`，`observed-A`）：

```
--rule  >  <repo>/.opencodereview/rule.json  >  ~/.opencodereview/rule.json  >  系统默认
```

⇒ **这正是"让每个人配自己的流程"的现成形状**：仓库级覆盖 → 用户级 → 系统默认，三层且不动代码。

### 2.3 它的三个缺口（正是我们的位置）

| 缺口 | 实测（`observed-A`） |
|---|---|
| **没有证据字段** | `LlmComment`（`internal/model/review.go:7-21`）= `path / content / suggestion_code / existing_code / start_line / end_line / thinking / category / severity`。**无 rule-ref、无 confidence** |
| **severity 只是枚举** | `critical/high/medium/low` 写在文档，**代码不强制校验** |
| **没有阈值** | 「丢弃 low 级」只出现在 `SKILL.md:73/126` 的文案，**代码层无实现** |

⇒ 它的裁决**不可复核**：看不到「依据哪条规则、证据是什么、多大把握」。
**这正是本仓三态裁决 + `requires` + 证据引用要补的那一格。**

### 2.4 它的 Precision 取舍，与我们的原则同源、解法不同

`review_filter_task` 的提示词逐字（`observed-A`）：
「**证据不足则 approve；删正确评论比留错误评论更糟**」

这与 `src/gates/requires.ts` 那句「**判据误伤的代价比漏报更贵**」是同一条原则 —— **两个独立来源印证。**

但解法有实质差别：

```
OCR：证据不足 → 直接丢弃（静默丢失，且没人知道丢了多少）
本仓：证据不足 → unmeasured（保留、标成"判不了"、不进结论）
```

⇒ **它的低 Recall 是静默的；我们的 unmeasured 是显式的。** 后者可统计、可改进，前者不能。

### 2.5 AACR-Bench（最值钱的一样）

| 项 | 值 |
|---|---|
| 位置 | HuggingFace `Alibaba-Aone/aacr-bench` |
| 规模 | **50** 个开源仓库 · **200** 个真实 PR · **10** 种语言 · **80+** 资深工程师交叉标注 · **1,505** 条 ground-truth 问题 |
| 用途 | ★ **评审判据的验证集** |

**⇒ 这是我们目前最缺的东西**：一个外部基准，能回答「评审判据到底有没有判别力」，
而不是「我们又加了几条判据」。

### 2.6 关于 `acp/`：一处必须澄清

`acp/` 有独立 `go.mod`，但：

- 它实现的是 **ACP v1 的 agent 侧**（stdio server，被 Zed/VSCode 这类客户端拉起）
- 接 Claude Code / Codex / Cursor / Kimi Code 走的是**插件 / slash 命令**（`.codex-plugin`、`.cursor-plugin`、`claude-code/commands/review.md`），**不是 ACP**
- `ocr-acp` 是**拉起 ocr 子进程的适配层**，协议层封在 `internal/adapter` 里，**不能当通用库**

⇒ **「直接拿 ACP 层当我们的后端」不成立，只能参考形状。**

### 2.7 `ASSURANCE_CASE.md` 是什么

**安全保证案例**（security assurance case），不是评审判据：威胁模型、信任边界（T1–T7）、
Saltzer & Schroeder 八原则映射、OWASP/CWE 映射。**与「什么算问题」无关。**
可借鉴的是**文档结构**（做我们判据层自己的安全论证），不是它的内容。

### 2.8 能拿的三样

| # | 拿什么 | 价值 |
|---|---|---|
| 1 | **AACR-Bench** | ★★★ 评审判据的验证集 |
| 2 | **规则数据驱动 + 三层优先级链** | 检查项可插拔的现成形状 |
| 3 | **二次确认范式**（filter 任务 + "证据不足则放行"） | "先软后硬"在评审位的具体写法 |

---

## 3. ACP（Agent Client Protocol）

### 3.1 基本事实（`observed-search`，2026-10）

| 项 | 值 |
|---|---|
| 发起 | Zed Industries（+ JetBrains 共建） |
| 协议 | Apache-2.0，JSON-RPC 2.0 over stdio |
| 版本 | v0.13.6（2026-06） |
| Registry | 2026-01-28 上线，已收录 Claude Code / Codex CLI / Copilot CLI / OpenCode / Gemini CLI |
| 定位 | 「**LSP for agents**」：把 N×M 的 agent×编辑器集成，变成 N+M |

### 3.2 它解决哪一格

```
MCP     agent → 工具
A2A     agent → agent
ACP     client → agent      ★ 这一格
```

协议面：能力协商、会话、带流式的 prompt turn、敏感操作前的权限请求、客户端提供的文件系统与终端访问。

### 3.3 对我们的意义

**它是「认证后端」的现成接口。**

```
控制面 ── ACP ──▶ Claude Code / Codex / Gemini / OpenCode
```

⇒ §13.5 里"第二个后端"不必自己写 `stream-json` 适配，接一个协议等于接一批。

### 3.4 但要说清它不管什么

- **不管编排**：没有任务 DAG、没有成员、没有评审顺序
- **不管判据**：它只传事件，不判断"这次交付算不算过"
- **不管证据**：没有"这条结论依据什么"

⇒ **它把"驱动"标准化了，恰好把"判断"留给了我们。** 这是我们能站的位置。

---

## 4. ★ 拼起来：四角关系

```
                    ┌──────────────────────────┐
                    │   控制面（本仓）          │
                    │   任务 DAG + 判据 + 证据   │
                    └───────┬──────────────────┘
             ┌──────────────┼───────────────┐
             ▼              ▼               ▼
        Harness²        ACP             OCR 的规则系统
       （自迭代方法）  （后端抽象）      （评审内容）
             │              │               │
             └──────────────┴───────────────┘
                            ▼
                    AACR-Bench（验证集）
```

**缺任一角**：

| 缺谁 | 后果 |
|---|---|
| 缺 Harness² | 流程改不动、经验留不下 |
| 缺 ACP | 每个后端写一套适配器，N×M |
| 缺 OCR 的规则系统 | 评审判据只能手写，没法让别人配 |
| 缺 AACR-Bench | 「评审好不好」只能靠感觉 |
| 缺本仓 | 三家都只能说"我改了/我报了"，**没人能证明改对了** |

---

## 5. 三个可执行动作（按性价比排序）

| # | 做什么 | 为什么是它 | 量级 |
|---|---|---|---|
| **1** | 用 AACR-Bench 的 200 个 PR 跑一次**现有评审判据的判别力** | 它同时给：标准答案、跨语言分布、别人做到的水平。**这是唯一能回答"你的判据有没有用"的东西** | 2–3 天 |
| 2 | 抄 `library.py` 的目录结构做**流程模板库**（domain 分区 / 整树不摘要 / run+mode 隔离） | 直接决定"经验能不能留下来" | 3–5 天 |
| 3 | 抄 `tree.py` 的 `SurfaceSpec` 思路，把**后端差异做成数据表** | 这是"多后端"唯一不失控的做法 | 3–5 天 |

★ 第 1 条排第一，因为它是唯一**能证伪**的：如果现有判据在 AACR-Bench 上没有判别力，
那么后面两条都白做。

---

## 6. 本文没有回答的（如实留白）

1. **Harness² 的数字全是作者自测**，未见独立复现。本文只转述，不当结论。
2. **OCR 的"数万开发者 / 数百万缺陷"是自述**，无第三方审计。
3. `acp/` 标为 experimental/unstable，**未在实际客户端上跑通验证**。
4. Harness² 的 `SurfaceSpec` 我只读了 docstring 与 `tree.py` 头部，**没有读完 427 行的全部字段**。
5. OCR 的 `review_filter_task` 提示词我只看到成员引用的片段，**没有通读全文**。

---

*本文只写 `docs/EXTERNAL-REFERENCES.md`。未改动 `src/`、`scripts/`、`lib/`。*
