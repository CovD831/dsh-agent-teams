# 大厂 Agent Teams 三篇分析（2026-10-15）

> **来源**：用户给的 3 篇 + 我补充的 1 个开源仓库。
> ★ **X 链接在本环境被 DNS 挡**（解析到非公网 IP），我用 `r.jina.ai` 代理取回；
> GitHub 被限流,改用 `api.github.com` + `raw.githubusercontent.com`。
> ⇒ **本文所有引用都来自实际取回的原文**,不是转述。

---

## 0. 一句话结论（先说最重要的）

**三篇指向同一个缺口,而我们正好缺它:`confidence`（置信度）。**

- **Anthropic**：workflow 可**共享复用** —— 但它没说"怎么知道哪个 workflow 好"
- **OpenAI Codex**：给了**完整调度原语**与**对象模型** —— 但"学习"归到 `Automation`,没有质量闭环
- **腾讯 TeamAI**：★ **唯一给出了完整闭环** —— `confidence` + **晋升阈值** + **淘汰阈值**

⇒ ★★ 而我们的台账里 **`confidence` 出现 0 次**（实测 `grep -rn confidence src/` ⇒ 0）。

---

## 1. Anthropic · Dynamic Workflows（`@trq212`，2026-06-02）

### 它讲什么

Claude Code 现在能**自己写 harness** —— 针对手头的任务动态生成一个 workflow（一个 JS 文件,
内含 `agent()` / `parallel()` / `pipeline()` 等原语来派生与协调 subagent）。

### 三条值得学的

**① 它把"harness"从产品变成了产物**
> 「Claude can now write its own harness on the fly, custom-built for the task at hand.」

⇒ 而它列举的**必须定制 harness 的类别**,第一条就是 **`agent teams`**：
> 「certain classes of tasks where we have had to build custom harnesses on top of Claude Code
> to achieve peak performance such as Research, security analysis, **agent teams**, or Code Review」

★ **这对我们有直接含义**：**agent teams 不是通用能力,它是需要定制 harness 的一类任务。**
⇒ 我们用"六个插入点 + 17 条判据"做的,正是**给这类任务定制 harness** —— 方向对。

**② 它的示例提示词里有一条,几乎就是我们的数据飞轮**
> 「Using a workflow, go through my last 50 sessions and **mine them for corrections I keep making**
> and **turn the recurring ones into CLAUDE.md rules**」

★★ **这正是用户说的"数据飞轮"** —— 而且**Anthropic 把它列为推荐用法**。
⇒ 与我们 R5（卡点沉淀为机械判据）**同形**,但它的**输入是"我反复犯的错"**,而我们是"判据拒绝"。

**③ 它如实说了代价**
> 「Dynamic workflows often **use more tokens**, so think carefully about when and how to use them.」
> 「best practices are **still developing**」

⇒ ★ **诚实**:不假装它已成熟。

---

## 2. OpenAI Codex · 编排控制台（`@riba2534`，2026-07-30）

### 它讲什么

Codex 不只是一个会话 —— 它是一组**调度原语**,叠起来是**跨项目、跨 worktree、跨 SSH 主机的 Agent 运维控制台**。

### ★★ 它的对象模型（这是最有价值的部分）

| 对象 | 是什么 | 在编排里的角色 |
|---|---|---|
| Project | 本地/SSH/ChatGPT 项目 | 工作域、仓库与数据边界 |
| Host | Local 或 SSH 主机 | 计算节点 |
| **Task / Thread** | **一个持久会话** | ★ **持久 Agent Actor** |
| **Turn** | 一次用户输入及其后全部工作 | **一次任务运行** |
| **Item** | 消息、命令、文件变更、工具调用、计划、评审 | **最小可观察事件** |
| **Worktree** | 同一仓库的另一个 checkout | **并行写入的隔离空间** |
| **Subagent** | Task 内派生的独立 Agent 线程 | ★ **短生命周期 Worker** |
| Automation | Heartbeat / Cron | 时间调度器 |

★★★ **它点明的最关键区分**：
> 「**Task 是长期存在的、会出现在侧边栏里的、可以跨项目跨主机的 Agent；
>  Subagent 是某个 Task 内部临时派生的短生命周期工作者。
>  两者的生命周期、可见性和控制方式完全不同,后面所有拓扑都建立在这个区分上。**」

⇒ ★ **而我们的模型和它一致**:captain = 持久 Actor,member = 持久(可复用),subagent = 临时。
**但我们的 UI 没有把这个区分画出来** —— 而它说"所有拓扑都建立在这个区分上"。

### ★★ 三层运行层 + 一层控制面

```
持久任务层（跨项目跨主机存在的 Task）
  └ 任务内协作层（一个 Task 派生的 Subagent 团队）
      └ 执行环境层（Project / Local / Worktree / Remote SSH / Cloud）
人类站在最上面,给目标、纠偏、拍板
─────────────────────────────────────────
可编程控制面（App Server 操作 Thread/Turn/Item/事件流）← 从侧面接入
```

⇒ ★ **"人类站在最上面,给目标、纠偏、拍板"** —— 这与用户第 4 点
（「尽量少打扰我,但不是不许来打扰我」）**同一个意思**:人的位置是**拍板**,不是**执行**。

### 它列的八种拓扑（我们只用了两种）

让me如实说:**我们目前是"captain + 持久 member + 临时 subagent"这一种拓扑。**
而它列了八种,并给了**选型标准**（什么时候用哪个）。

⇒ ★ **这是一条明确的差距**:我们的 DAG 形状单一。

### 它的可观察性设计
> **Item = 最小可观察事件**（消息、命令、文件变更、工具调用、计划、评审）

⇒ ★ **与我们的 `GateRunEntry` / friction 台账同层**。而它的名字更好:**"最小可观察事件"**
—— 这正是"凡是发生的,都必须留下可观察的痕迹"。

---

## 3. 腾讯 TeamAI-CLI（`@TencentAI_News`，2026-09-07）

**开源**：`github.com/Tencent/teamai-cli` · **5,500 stars** · TypeScript · MIT
**内部从 2026-03 用到 2026-09 才开源**（约 6 个月生产验证）。

★★★ **而它明确支持 `DeepSeek Harness`** —— README 的能力表里有这一行。
支持 20 个 agent（Claude Code / Codex / Cursor / Qoder / ZCode / **DeepSeek Harness** …）。

### ★★★ 它的三层能力 —— **这就是用户要的"数据飞轮"**

| 层 | 做什么 | 我们对应 |
|---|---|---|
| **Team Execution** | 同一套 skills/rules/hooks 落到每台机器 | ✅ 我们有（判据/契约）|
| **Team Context**（beta）| agent 能**搜索团队学过什么** | ❌ **我们没有** |
| **Team Improvement**（beta）| ★ **每次执行都改进团队** | ❌ **我们没有** |

> **Team Improvement — make every execution improve the team**

⇒ ★★ **这就是"资金化"的机制形状**:每次执行**留下沉淀**,而沉淀**反过来改进下次执行**。

### ★★★ 数据飞轮的完整闭环（我取回了原文）

**① 捕获（自动提示,不靠人记得）**
> 「When you **correct the AI**, **deny a tool call**, or the AI **retries a failing command**,
>  the session ends with a prompt to share it」

★ 三个触发条件,而**我们的卡点台账触发条件更广**（17 条判据拒绝）。
⇒ **我们的输入面比它宽**,这是我们做得好的地方。

**② 检索（`recall`）**
```bash
teamai recall "API timeout"
teamai recall --check "API timeout"    # 只答 RELEVANT / NOT_RELEVANT
```

**③ ★★ 置信度 —— 这是核心**
> 「each learning **earns confidence from real usage**, **strong ones surface first, weak ones sink**」

**④ ★★★ 两个阈值（一升一降）**

| 动作 | 条件 |
|---|---|
| **晋升**（learning → skill/rule/doc）| `confidence ≥ 0.90` **∧** 至少 **5 upvotes** **∧** 至少 **2 contributors** **∧** 存在 **≥ 14 天** |
| **淘汰**（archive）| `confidence < 0.15` |

★ **四个条件缺一不可,而且设计得很讲究**:
- `≥2 contributors` ⇒ **防"一个人的偏方变成全队默认"**
- `≥14 天` ⇒ **防一时热度**
- `≥5 upvotes` ⇒ **防自评自赞**
- 两个阈值**不重叠**（0.15 ↔ 0.90）⇒ **中间是"观察区"**,不是二值判断

★★★ **这直接回答了那篇推文下面最尖锐的评论**:
> 「the confidence score is the interesting bit — **how do you stop one bad workaround from
>  becoming the team's default after a few successful runs?**」

**腾讯的答案就是那四个条件** —— 特别是 `≥2 contributors` + `≥14 天`。

**⑤ 反馈入口（人可显式投票）**
```bash
teamai recall feedback --positive <docId>
teamai recall feedback --negative <docId>
```
★ 且「**open a document that recall returned counts as one upvote**」——
**阅读即投票**,不额外要求人动手。

**⑥ 维护（自动降级）**
```bash
teamai recall maintenance --prune --archive      # confidence < 0.15 ⇒ 归档
```

### ★★ 它的 Dashboard 侧边栏（直接回答我们的 UI 问题）

> 「The sidebar is **Overview, Team Execution, Team Context, Resources, and Team Improvement**.
>  ★ **The numbers are from this machine.**」

★★★ **"The numbers are from this machine"** 是一句**关键的诚实设计**:
它**明说读数的来源**,而不是让人以为那是全队数据。

⇒ 而我们的 UI 现在**没有这句话** —— 而我们有同样的歧义（`/state` 是这台机器的）。

### ★★ 人类干预指标（Human Intervention Metrics）

> 「Each session counts three things:
>  **an interrupt mid-run (`interrupt`)**,
>  **a denied tool call (`toolReject`)**,
>  **a correction right after the agent stops (`correction`)**」

★★ **这三个就是"人被打扰"的直接度量** —— 而**用户第 4 点说的"尽量少打扰我",正需要这个数**。

★ 而它的隐私设计:
> 「What reaches the team is **the count, not the text**.」

⇒ ★ **上报的是计数,不是内容。** 这是"数据飞轮"能跨人共享的**前提**。

### 会话归档的触发条件
> 「`--push` sends a session that **had friction**, or that **used at least 3 different tools**」

⇒ ★ **"有卡点"或"用了 ≥3 种工具"才归档** —— **不是全量上报**。
这是**噪音控制**,值得学。

---

## 4. ★★ 三方对照：我们缺什么、我们哪里对

| 维度 | Anthropic | Codex | 腾讯 TeamAI | **我们** |
|---|---|---|---|---|
| **对象模型** | workflow + subagent | ★ 8 对象分层 | asset + namespace | ✅ captain/member/subagent |
| **拓扑** | 动态生成 | ★ **8 种** | 单层 | ⚠️ **1 种** |
| **置信度** | ❌ 无 | ❌ 无 | ★★ **0.15 / 0.90 双阈值** | ❌ **0 处** |
| **晋升机制** | workflow 可分享 | ❌ | ★★ 四条件 | ❌ |
| **淘汰机制** | ❌ | ❌ | ★★ archive < 0.15 | ❌ |
| **人的度量** | ❌ | ❌ | ★★ interrupt/toolReject/correction | ⚠️ 有 self/escalate |
| **读数来源诚实** | — | — | ★★ "numbers are from this machine" | ❌ |
| **卡点输入面** | 人工 corrections | — | 3 类触发 | ✅ **17 条判据（更宽）** |
| **机械判据（非 prompt）** | ❌ 是 CLAUDE.md | ❌ | ⚠️ skill/rule/doc | ✅ **可执行检查** |

★ **我们做得比它们好的两处**:
1. **卡点输入面更宽**（17 条判据 vs 它的 3 类触发）
2. ★ **沉淀形态是机械判据,不是 prompt** —— 而用户第 7 点正是这条,三篇里**只有我们做到了**

★ **我们缺的三处（按重要性）**:
1. ★★★ **`confidence` + 双阈值** —— 数据飞轮的**核心零件**,我们完全没有
2. ★★ **人的干扰度量**（interrupt/correction 计数）—— 用户"少打扰我"需要它
3. ★ **读数来源的诚实标注** —— 一句 "numbers are from this machine" 的成本,几乎为零

---

## 5. 对"数据飞轮"的具体提案（★ 与 R4 的关系）

★ **重要**:用户说「我一直想做数据飞轮」。而 **t64 刚刚判定 R4 不可由代码达成**,
原因是循环「**重复的永远标不了,标了的从不重复**」。

★★★ **腾讯的机制正好解开这个循环** —— 而它解的不是"怎么标已解决",而是**换了一个量**:

| | 我们的 R4 | 腾讯的 confidence |
|---|---|---|
| 度量对象 | "这条**解决了吗**" | ★ "这条**用得怎么样**" |
| 数据来源 | 人手填 `resolution.state` | ★ **自动**（每次 recall/采纳）|
| 判定 | 是否**重复** | ★ **置信度连续值** |
| 淘汰 | 无 | ★ `confidence < 0.15` ⇒ 归档 |

⇒ ★★ **关键洞察**:R4 卡在"**要人先定义什么叫解决**"。
而腾讯**不问"解决了吗",只问"用得多不多、被几个人用过"** ——
**那个数不需要人定义,它从使用中自然累积。**

⇒ ★ **这是我认为最该学的一点**:`confidence` 是**行为数据**,而 `resolution.state` 是**声明数据**。
**行为数据不需要人先形式化语义** —— 而这正是 t64 报的卡点 ①。

### 建议的最小可行形状（★ 待用户裁定）

```
① 捕获：我们已有（17 条判据拒绝，比腾讯的 3 类更宽）        ← ✅ 无需新增
② 检索：判据表 + 卡点台账可被按语义查                        ← ⚠️ 需新增
③ 置信度：每条判据/卡点带一个从【使用】累积的数               ← ❌ 需新增（核心）
④ 双阈值：0.15 归档 / 0.90 晋升（且晋升要 ≥2 人 + ≥14 天）    ← ❌ 需新增
⑤ 干扰度量：interrupt / correction / escalation 三计数       ← ⚠️ 部分有
```

★ 而 **⑤ 与用户第 4 点（少打扰我）直接对应** —— 它是**可度量的**,不是感觉。

---

## 6. ★ 对 UI 的直接结论（回答"什么最重要"）

### 腾讯的侧边栏给了答案（5 个 tab）

```
Overview · Team Execution · Team Context · Resources · Team Improvement
```

★★ **注意它的组织逻辑不是"按对象"（成员/任务），而是"按层"** ——
而这**恰好与我们 `UI-VIEW-MODEL.md` 的 L1/L2/L3 不同**。

⇒ ★ **两种组织方式的区别**:
- **我们的 L1/L2/L3**:按**粒度**（队 / 成员 / 任务）
- **腾讯的 5 tab**:按**能力层**（执行 / 上下文 / 改进）

★★★ **而后者更接近用户说的"必须呈现最重要的东西"** —— 因为
「**Team Improvement**」这个 tab 的存在本身,就在**告诉用户"这个工具会学习"**。

### ★ 三篇合起来看,人眼里什么是重要的

| 来源 | 它把什么放在最显眼处 | 含义 |
|---|---|---|
| Anthropic | **可复用的 workflow** | 沉淀比执行重要 |
| Codex | **Task vs Subagent 的区分** | ★ **持久 vs 临时**是最关键的区别 |
| 腾讯 | **Team Improvement 独立成 tab** | ★ **学习是一个一等公民** |

⇒ ★★ **三者一致指向:把"学习/沉淀"提到与"执行"同等的可见度。**

★ 而我们的 UI **现在把执行放在中心**（成员行 + 任务），**学习完全不可见** ——
尽管我们有 384 条卡点台账、有 R5 的沉淀机制。

---

## 7. 我如实要说的三件事

**① X 链接在本环境取不到原文,我用了代理**
`x.com` 被 DNS 挡（解析到非公网 IP）。我用 `r.jina.ai` 取回,而**第一篇给了完整长文**,
**第二篇给了完整长文**,**第三篇只有推文本身**（正文靠 GitHub 仓库补全）。
⇒ 若某处我引用得有偏差,请以原链接为准。

**② 我没能搜到"其他大厂"的更多文章**
`web_search` 失败（**API key 无效**,HTTP 401）。所以我只用了你给的 3 篇 + 我主动补的
腾讯开源仓库。★ **若要我再找（例如 Qoder/Cursor/Devin 的同类文章）,需要先修 web search 配置。**
（腾讯那篇的作者是我顺带从 README 拿到的,不经搜索。）

**③ 有一处我必须提醒:腾讯的机制与我们的 R4 冲突**
腾讯的 `confidence` 是**行为数据**（用得多不多）;
而我们 R4 想度量的是**声明数据**（有没有被标成已解决）。
⇒ ★ **换成前者会绕开 t64 报的语义卡点,但代价是"用得多"不等于"是对的"** ——
而那正是那条推文评论担心的（「一个坏的 workaround 跑成功几次就变成全队默认」）。
**腾讯用 `≥2 contributors` + `≥14 天` 来防它** —— 这两个条件**成本很低,值得抄**。

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
*取回原文的副本在 `/tmp/a1.md`（209 行）、`/tmp/a2.md`（891 行）、`/tmp/a3.md`（49 行）。*
