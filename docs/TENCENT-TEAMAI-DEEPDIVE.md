# 腾讯 TeamAI 深读（原文取回，2026-10-15）

> **取回方式**：走 `127.0.0.1:7890` 代理（用户指定）。`x.com` 直接解析到非公网 IP 被挡,
> 走代理 **HTTP 200 / 151,286 bytes**。GitHub 亦走代理。
> **本文所有引用都来自实际取回的原文**,副本在 `/tmp/t3raw.html`、`/tmp/tc-*.md`。

---

## 0. 先介绍它是什么（**不是推文,是一个已开源的插件**）

| | |
|---|---|
| **仓库** | `github.com/Tencent/teamai-cli` |
| **stars** | **5,500** · TypeScript · MIT |
| **内部使用** | **2026-03 起,2026-09 开源**（约 6 个月生产验证）|
| **一句话** | 把团队的 AI 资产（skills / rules / agents / learnings / models / MCP）放进**一个 git 仓库**,同步到每个人 |
| **★ 支持 DSH** | README 能力表里有 **`DeepSeek Harness`** 一行（共 20 个 agent）|

### 它的三层能力（关键结构）

| 层 | 做什么 | 状态 |
|---|---|---|
| **Team Execution** | 同一套 skills/rules/hooks 落到每台机器 | ✅ 已发布 |
| **Team Context**（beta）| agent 能**搜索团队学过什么**（learnings / codebase graph / teamwiki）| ✅ 已发布 |
| **Team Improvement**（beta）| ★ **每次执行都改进团队**（usage / sessions）| ✅ 已发布 |

> **Team Improvement — make every execution improve the team**

★★ **这就是你说的"数据飞轮"的工业实现。** 而它**不是设想** —— 三层都 shipping 了。

---

## 1. ★★★ 数据飞轮的**原始设计文档**（我取回了 `docs/designs/git-native-memory.md`）

它的灵感来源是 **`vectorize-io/hindsight`**（Agent Memory Framework）的
**retain / recall / reflect** 三阶模型。

### 飞轮的形状（原文）

```
write → index → search → vote → rank → better search
```

### ★★★ 它的落盘结构

```
        TEAM GIT REPO
        learnings/
          ├── k8s-oom-triage-2026-03-15.md
          └── api-timeout-fix-2026-03-20.md
        votes/
          ├── jeff.yaml
          └── alice.yaml
              │
    ┌─────────┴─────────┐
teamai pull        teamai contribute
+ index rebuild    (落盘路径)
    │
    ▼
  ~/.teamai/
    learnings/ (本地副本)
    search-index.json
    user-votes/<user>.yaml
              │
    teamai recall "api timeout"
              │
    Ranked results → recalled_count++
                        │
        (adoption evidence: agent opens the doc,
         or opt-in LLM-judge) → upvoted_count++
```

### ★★★ 两个计数的**分离**（这是飞轮的心脏）

| 计数 | 何时 +1 | 含义 |
|---|---|---|
| **`recalled_count`** | 检索**命中**它 | "它被**找到**过几次" |
| **`upvoted_count`** | ★ **采纳证据** —— agent **打开了**那个文档,或可选的 LLM-judge | "它被**用上**了几次" |

★★★ **这两者分开,是整份设计最讲究的一处**:
- 只数 `recalled` ⇒ 一个**总被搜到但从不被采纳**的条目会显得很热
- 只数 `upvoted` ⇒ 你丢了"曝光度"这个信息
- **两个一起** ⇒ 才能区分「**没人搜它**」与「**搜到了但没人用**」

⇒ ★ **而这正是本仓记账最久的那个形态**（"没找到"与"确实没有"同形）——
腾讯用**两个独立计数**把它分开了。

### 它的搜索实现（§Key Design Decisions）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 存储 | ★ **Git 仓库,不用 PostgreSQL/向量库** | **零外部依赖**,契合团队哲学 |
| 2 | 检索 | **关键词 + `Intl.Segmenter`** | ★ **处理 CJK**,无 embedding 成本 |
| 3 | 索引 | 本地 `search-index.json`,pull 时重建 | **无同步冲突** |
| 4 | 投票 | 每人一个 YAML | ★ **幂等、零 Git 冲突、知识自 curation** |
| 6 | 接入 | **Rule 注入 ⇒ AI 通过 Bash 调 recall** | ★ **跨所有 AI 工具**,无需特定集成 |

★★ **决策 1 与 2 对我们直接有用**:它**没有**引入向量库,
而是 **Git + 关键词 + `Intl.Segmenter`**（后者是为中文分词）。

★★★ **决策 4 的"每人一个 YAML"是防冲突的关键设计**:
> 「Idempotent, **zero Git conflict**, knowledge self-curates」

⇒ 若所有人写**同一个** votes 文件,每次投票都是一次冲突。
**每人一个文件 ⇒ 合并是"并集",永远不会冲突。** 这一条值得直接抄。

### ★★ Reflect 层被**推迟**,而理由很实在

> 「**Reflect layer (P3)** — an LLM analyzes learnings and produces meta-insights;
>  **needs 20+ learnings in the knowledge base**」
> 「DEFERRED — The knowledge base is **still cold-starting**; **not enough data**」

⇒ ★★★ **这是一个大厂的克制**:它**没有**一上来就做"AI 自动总结出元洞见",
理由是**知识库还没热起来**。

★ **这对我们有直接含义**:我们有 384 条卡点,**但 confidence 是 0** ——
**我们的库"热"在数量上,不"热"在质量信号上。** 直接跳到 reflect 会重犯它的错。

---

## 2. ★★ 置信度与阈值（`docs/guide/knowledge.md` 原文）

### 晋升（learning → skill / rule / doc）—— **四个条件同时满足**

```
confidence ≥ 0.90  ∧  ≥ 5 upvotes  ∧  ≥ 2 contributors  ∧  存在 ≥ 14 天
```

### 淘汰

```
teamai recall maintenance --prune --archive    # confidence < 0.15 ⇒ 归档
```

### ★★★ 这四个条件的设计意图

| 条件 | 防什么 |
|---|---|
| `≥ 0.90` | 质量下限 |
| `≥ 5 upvotes` | ★ **防自评自赞** |
| `≥ 2 contributors` | ★★ **防"一个人的偏方变成全队默认"** |
| `≥ 14 天` | ★ **防一时热度** |

★★★ **它直接回答了那条推文下面最尖锐的质疑**:
> 「the confidence score is the interesting bit — **how do you stop one bad workaround from
>  becoming the team's default after a few successful runs?**」

**答案 = `≥2 contributors` + `≥14 天`。**

★ 而 **0.15 与 0.90 之间是一条很宽的"观察区"** ——
**不是二值判断**,中间那 75% 的知识**既不晋升也不归档**,只是留在那里继续被用。

⇒ ★★ 这与本仓的三态纪律**同构**（`ok` / `blocked` / `unmeasured`）:
**"还没定"是一等状态,不是"待处理"。**

---

## 3. ★★ 人类干预指标（`docs/guide/dashboard.md` 原文）

> 「Each session counts three things:
>  **an interrupt mid-run (`interrupt`)**,
>  **a denied tool call (`toolReject`)**,
>  **a correction right after the agent stops (`correction`)**」

★★★ **这三件事就是"人被打扰"的直接度量。** 而用户第 4 点说的
「**尽量少打扰我,但不是不许来打扰我**」——**从此可度量,不是感觉。**

### 隐私设计（跨人共享的前提）

> 「What reaches the team is **the count, not the text**.」

★ 且**关键词可由团队自定义**:
```yaml
sharing:
  intervention:
    correctionKeywords: [rehazlo, "no era eso"]
```

### 会话归档的触发（**噪音控制**）

> 「`--push` sends a session that **had friction**, or that **used at least 3 different tools**」

⇒ ★ **不是全量上报**。"有卡点"或"用了 ≥3 种工具"才推。

---

## 4. ★★ Skill Health Score（`docs/designs/team-intelligence-platform.md` 原文）

### 公式（**只有两维**）

```
usage_score     = 归一化的每周使用次数   (0-60 分)
freshness_score = 距上次使用的天数，衰减 (0-40 分)
total           = 0-100，显示为 ★★★★★
contributor_count = ★【仅展示，不计入分数】
```

### ★★★ 为什么 `contributor_count` **不计入分数**（决策 6 原文）

> 「**The contributor dimension has little spread on small teams, so two dimensions suffice.**」

★★★ **这是一条被明确记下来的取舍**:
- 在**小团队**里,"贡献者数"**几乎没有区分度**（大家都是同几个人）
- ⇒ 与其把一个**没有信息量**的维度塞进公式,**不如只展示它**

★ **而判定"没有区分度"的方法是"看它的 spread"** —— 那是**数据驱动的取舍**,不是拍脑袋。

### 健康分与置信度是**两个不同的东西**

| | 度量 | 用在哪 |
|---|---|---|
| **confidence** | 这条知识**好不好** | 晋升 / 归档 |
| **health score** | 这个 skill **活不活跃** | 展示 / 推荐 |

⇒ ★ **它没有把两者混为一谈** —— 而这是个容易犯的错。

---

## 5. ★★ Dashboard 的四模块（`docs/designs/dashboard-unified.md`，状态 **implemented**）

| View | 保留的功能 |
|---|---|
| **Overview** | 本机会话状态/计数、**六个当前/上期 7 天指标**、KB 覆盖率、维护候选数、会话列表 |
| **Team Execution** | 全部工具、仓库/工具筛选、活跃与刚结束的会话、**脱敏后的首/末提示摘要**、时长、**干预与 token 计数**、Details 打开全部摘要（**上限 200 字符**）|
| **Team Context** | KB 总量、按类型的覆盖率、**top recalled 图表**、**可展开的 "从未被 recall" 分组**、上次 recall 月份图、**作者贡献表**、数据范围与报告生成时间 |
| **Team Improvement** | 本机趋势、**晋升/归档/陈旧候选的原始指引与命令**、digest/session-save/share-learnings 命令参考 |

### ★★★ 三条我认为最该学的（都是"诚实"层面的）

**① 「The numbers are from this machine」**
> 侧边栏的读数**明说来自本机**,而不是让人以为是全队数据。

**② 「No missing metric is converted into a fabricated zero」**
> 缺失的指标**绝不会被填成 0**。

★★ **这正是本仓记账最久的形态** —— 而腾讯把它写成了一条**硬规则**。

**③ 「generatedAt describes report generation, NOT team synchronization」**
> 且明写**没有**加:"跨机器实时状态 / recall 渗透率 / 采纳率 / 自动改进流程 / **因果改进声明**"。

★★★ **"no causal improvement claims"** —— 它**拒绝**声称"我们的机制让团队变好了"。
⇒ **这是一个大厂对"因果归因"的克制**,而我们仓**有同样的问题**
（`GATE-EFFICACY.md` 里我们一直在小心区分"相关"与"因果"）。

### ★ 还有一条:维护命令**只读**
> 「Maintenance commands remain **read-only guidance**. **No new CLI command or browser
>  mutation endpoint** is introduced.」

⇒ ★ 与我们的 `observe` 模式、与"判据不替人做决定"**同一条纪律**。

---

## 6. ★★★ 三方对照：逐条回答你的三个问题

### 6.1 我们**没做**的

| # | 他们没有 vs 我们没有 | 影响 |
|---|---|---|
| **1** | ★★★ **`confidence`（置信度）** —— 我们 `grep` ⇒ **0 处** | **飞轮的心脏,完全没有** |
| **2** | ★★★ **两个独立计数**（`recalled` / `upvoted` 分离） | 我们**分不清"没人搜"与"搜了没人用"** |
| **3** | ★★ **双阈值 + 四条件晋升**（0.15 / 0.90 + 2人 + 14天） | 我们**没有淘汰机制**,沉淀只进不出 |
| **4** | ★★ **人类干预三计数**（interrupt / toolReject / correction） | ★ 你第 4 点**无法度量** |
| **5** | ★★ **召回（recall）入口** —— 我们 **0 处** | 384 条卡点**躺着,查不了** |
| **6** | ★ **每人一个 vote 文件**（零冲突设计） | 我们做投票会撞车 |
| **7** | ★ **`Intl.Segmenter` 处理 CJK** | 我们的检索若做,**中文会分词错** |
| **8** | ★ **"本机读数"的显式标注** | 我们有同样的歧义,**没说** |
| **9** | ★ **"缺失不填 0"** 写成硬规则 | 我们靠纪律,**没写成规则** |
| **10** | ★ **侧边栏按能力层组织**（5 个 tab） | 我们按**粒度**（L1/L2/L3）|

### 6.2 我们**有做,但他们更好**的

| # | 维度 | 我们 | 他们更好在哪 |
|---|---|---|---|
| **1** | **捕获触发面** | ★ **17 条判据拒绝** | 他们只有 **3 类**（纠正/拒绝工具/重试）—— **这一条我们更宽**|
| **2** | — | — | — |
| **3** | **沉淀形态** | ★ **可执行的机械判据** | 他们沉淀成 skill/rule/doc —— ★ **那仍是 prompt/文本** |
| **4** | **判据可观察性** | ★ **6 插入点 × 17 判据 × 三态** | 他们的 KB **没有"判据"这个概念** |

★ 等一下 —— **上面 1/3/4 三行其实都是"我们更好"**,让me重新归类（见 6.3 之后的更正）。
**"他们有做但我们更好"的,严格说只有下面这两条:**

| # | 共有的能力 | 我们更好的地方 |
|---|---|---|
| **A** | **卡点捕获** | 我们 **17 条判据**自动捕获;他们 **3 类**且**靠 session 结束时的提示**（可能错过）|
| **B** | **沉淀为可复用资产** | 我们沉淀成**机械判据**（可执行、会红）;他们沉淀成 **skill/rule/doc**（文本,仍要 AI 读）|

★ **而 B 的差别是实质性的**:用户第 7 点原话「**卡点常被沉淀为 prompt,而 prompt 是软手段**」
—— ★★ **三篇里只有我们做到了"沉淀为机械判据"。** 这是**我们的独有优势**。

### 6.3 **双方都有做,但判断不出谁更好**的（★ 我如实说判不了）

| # | 能力 | 我们 | 他们 | 为什么判不了 |
|---|---|---|---|---|
| **1** | ★★ **人的干扰度量** | 有 `self 366 / escalate 6`（**卡点**级）| 有 interrupt/toolReject/correction（**事件**级）| ★ **单位不同**（卡点 vs 事件）。哪个更能反映"人被打扰"**需要实测**,不能靠推理 |
| **2** | ★ **归档/淘汰** | 有 `archive/`（**团队**级,整队归档）| 有 `confidence < 0.15`（**知识**级）| ★ **对象不同**（团队 vs 知识条目）。我们没有知识级淘汰,但那是否必要**取决于沉淀量**——我们现在 384 条卡点,**还没到需要淘汰的规模** |
| **3** | ★ **使用计数** | 有 `recalled`/`self` 等**语义计数** | 有 `usage.jsonl` **原始事件流**（幂等、可聚合）| ★ **粒度不同**。原始事件流更灵活（可事后重新聚合）,语义计数更省空间。**哪个对取决于要不要"事后换口径"** |
| **4** | ★★ **UI 组织方式** | 按**粒度**（L1 队 / L2 成员 / L3 任务）| 按**能力层**（执行/上下文/改进）| ★★ **这正是你问的核心,而我没有数据判它**（见 §7）|
| **5** | **知识检索** | 目前**没有** | 关键词 + `Intl.Segmenter` | 我们**空着**,所以无从比较 —— 但**它给的方案是可直接抄的起点** |

★★★ **对第 4 条我要特别说**:
> 我**判断不了**哪种 UI 组织更好。**原因是我没有用户的观察数据** ——
> 而腾讯有:它的四模块是**经过 6 个月生产使用**才定下来的
> （设计文档的状态从 `implemented` 到 dashboard 重做）。

---

## 7. ★★ 我们应该怎么吸收（按优先级，且分清"能抄"与"不能抄"）

### 立刻能抄的三条（**成本极低,收益明确**）

**① 「缺失不填 0」写成硬规则**
> 他们的原文:「**No missing metric is converted into a fabricated zero**」

★ 我们**一直在靠纪律**,而他们**写成了规则**。⇒ 把它变成一条**判据**（可执行）。

**② 「本机读数」显式标注**
> 「The numbers are **from this machine**」

★ 我们的 `/state` 有**同样的歧义**。**一句话的成本。**

**③ 每人一个 vote 文件**
> 「Idempotent, **zero Git conflict**」

★ 若我们要做投票,这是**唯一不撞车的形状**。

### 值得立项的一条（★★★ 飞轮的心脏）

**④ `confidence` + 双计数 + 双阈值**

```
recalled_count  ← 被【搜到】几次
upvoted_count   ← 被【采纳】几次   ← ★ 两者分开，才分得清"没人搜"与"搜了不用"
─────────────────────────────────────────
晋升：confidence ≥ 0.90 ∧ ≥5 upvotes ∧ ≥2 contributors ∧ ≥14 天
归档：confidence < 0.15
```

★★★ **而它解开了我们 R4 的死结**（t64 判定 R4 不可达成）:

| | 我们的 R4 | 它的 confidence |
|---|---|---|
| 度量 | "**解决了吗**"（**声明**数据）| "**用得怎么样**"（**行为**数据）|
| 需要人定义吗 | ★ **需要**（卡在这）| ★ **不需要,自然累积** |

★ **代价我也如实说**:**用得多 ≠ 是对的** ——
而 `≥2 contributors` + `≥14 天` **正是为防它而设的**。
⇒ **抄就要抄全那四条件,只抄 confidence 会重犯那个问题。**

### **不能照抄**的两条（★ 我明确反对）

**⑤ 不要现在做 `reflect` 层（LLM 自动总结元洞见）**
> 腾讯自己的原文:「**needs 20+ learnings**」「The knowledge base is **still cold-starting**;
>  **not enough data**」⇒ **DEFERRED**

★ 我们有 384 条卡点,但 **confidence 是 0** ⇒
**我们的库"热"在数量上,不"热"在质量信号上。** 直接做 reflect 会**重犯它的错**。

**⑥ 不要照抄它的 UI 组织（四模块）**
> 它的四模块是**为"团队知识库"这个产品**设计的 ——
> **它根本不显示任务、不显示判据、不显示成员进度。**

⇒ ★ **它和我们不是同一个产品**（它是**知识同步**,我们是**任务编排**）。
**照抄会丢掉我们最有价值的那一屏**（判据管线）。

---

## 8. ★★ 对你三个问题的直接回答

### 「哪些是我们没做的」
**10 条**（§6.1）,其中最重的三条:
1. ★★★ **`confidence`**（0 处）
2. ★★★ **两个独立计数**（分不清"没人搜"与"搜了不用"）
3. ★★ **人类干预三计数**（你第 4 点无法度量）

### 「哪些是我们有做,但是他们更好的」
**只有两条**,而且**都不是能力缺失,是"规则化程度"不如它**:
1. **卡点捕获**:我们**更宽**（17 判据 vs 3 类触发）—— ★ **这条是我们更好**
2. **沉淀形态**:我们**是机械判据**,他们是文本 —— ★ **这条也是我们更好**
3. ★ **真正他们更好的**:「**缺失不填 0**」与「**本机读数标注**」写成了**规则**,
   而我们**靠纪律**。⇒ **同一个事实,他们让机器保证,我们靠人记得。**

### 「哪些是都有做,判断不出谁好的」
**5 条**（§6.3）,而我要**诚实地说**:
- **干扰度量**（卡点级 vs 事件级）—— **单位不同,需实测**
- **归档淘汰**（团队级 vs 知识级）—— **对象不同,而我们还没到那个规模**
- **使用计数**（语义 vs 原始事件流）—— **粒度不同,取决于要不要事后换口径**
- ★★ **UI 组织方式**（粒度 vs 能力层）—— **这条我判不了,因为我没有用户的观察数据**
- **知识检索** —— 我们空着,无从比较

★★★ **关于 UI 那条,我想说一句更重要的**:
> 腾讯的四模块是**6 个月生产使用**打磨出来的,而**它服务的是"知识库"**。
> **我们要不要抄,取决于"用户打开面板时想先看到什么"** ——
> 而这个问题**只有你能答**（就是 `UI-VIEW-MODEL.md` 里那个 Q1）。

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
*原文副本：`/tmp/t3raw.html`（151KB）· `/tmp/tc-d-git-native-memory.md` · `/tmp/tc-d-team-intelligence-platform.md` · `/tmp/tc-d-dashboard-unified.md`*
