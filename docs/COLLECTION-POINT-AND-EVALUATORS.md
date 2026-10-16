# `collection` 插入点 + 四条判据 · 与评估器体系（2026-10-16）

> 回答用户两问：
> ① 「`collection` 插入点 + 那四条判据**是什么**」
> ② 「关于评估器,你可以去搜一些论文或者项目 ——
>    **很多自进化的东西都会去做一个评估器**」

---

## 一、`collection` 插入点 + 四条判据,具体是什么

### 1.1 本仓的插入点是什么（现状）

```ts
// src/gates/registry.ts:288
export const INSERTION_POINTS = Object.freeze([
  'admission',   // ⓪ 成团之前：够不够格进场
  'contract',    // ① 建任务 / 改契约
  'dispatch',    // ② 派发前（成员开工）
  'completion',  // ③ 成员汇报完成
  'delivery',    // ④ 团队宣布交付
  'runtime',     // ⑤ 全程
])
```

**而一条判据的形状:**
```ts
export interface GateRegistration {
  id: string                    // 'contract.verify-command'
  point: InsertionPoint         // 挂在哪
  description: string           // ★ 给 UI 显示（可插拔的那一半）
  appliesTo?: (ctx) => boolean  // 何时适用
  gate: (ctx) => GateVerdict    // ★ 三态：ok / blocked / unmeasured
}
```

★ **而它已经有三条纪律（本会话反复受益）:**
```
· 注册式：加一条 = 加一行 import + 一行 ALL_GATES ⇒ index 写错【启动即炸】
· 三态：ok / blocked / unmeasured —— ★ "没能测量"不许并进"测出来了"
· 可插拔：id + description 由注册表读，UI 不硬编码
```

### 1.2 ★★ 所以"加 `collection` 插入点"是什么

**就是在那个数组里加第七个位置:**
```ts
'collection',  // ⑥ ★ 一条信号【要不要进库】—— 判的是采集，不是任务
```

**而它与我上一份规格里那四条判据的关系:**

| # | 判据 id | 它判什么 | 不采的情形 |
|---|---|---|---|
| **1** | `collection.dedupe` | 这条与窗口内已有的**是否同一件事** | 同一 `(kind, component, message)` 已存在 ⇒ ★ 只加计数 |
| **2** | `collection.cooldown` | 这个来源**是不是刚说过话** | 同一来源 N 分钟内 ⇒ ★ 不采（MemOS 的 `cooldownMs`）|
| **3** | `collection.attributable` | 这条**能否落到一个 component** | 落不到 ⇒ ★ **unmeasured**，不硬塞 |
| **4** | `collection.immunity` | 是不是**已知的噪声源** | 如 worktree 路径差异 ⇒ ★ 不采 |

★ **四条都是【纯函数级】的**（输入是信号 + 已有索引,输出是三态裁决）——
**与本仓 17 条判据同构,不需要任何新机制。**

### 1.3 ★★ 而它为什么必须是【位置 + 判据】,而不是一段 if

```
❌ 写在 collect.ts 里的几个 if
   ⇒ 不可插拔、不可显示、不可由人改

✅ 作为一个插入点 + 四条注册判据
   ⇒ ★ 加一条判据 = 改一行（写错启动即炸）
   ⇒ ★ UI 能显示"采集为什么被拒了"（id + description）
   ⇒ ★ 而那正是用户要的"透明化"
```

★★ **而先例与纪律都在**:`index.ts` 逐字说过
> 「本任务只加位置,一条判据都不加……
>  而"它现在为空"这句话**不是不变量**」

★ **今天接 admission 用的就是这套**（六位置全有判据）。

---

## 二、★ 评估器:我去搜了,而**这确实是一个独立的研究领域**

### 2.1 ★★★ 最有用的发现:一张**"rubric rewards"的完整调研清单**

**`chrisliu298/awesome-rubric-rewards`** —— 它的定位逐字:

> 「**rubric rewards**: rubrics, checklists, criteria sets, principles,
>  constitutions, and scoring guides used to **score, rank, verify, filter,
>  or train** modern generative models.」

★★★ **而它给的三个性质,正是我们判据体系的性质:**
> 「Three properties separate it from an ordinary reward model:
>  the criteria are **written down** rather than latent in weights,
>  **decomposed** into many items rather than collapsed to one scalar,
>  and **inspectable** so a person can **read, audit, and edit** them.」

⇒ ★★★ **"written down · decomposed · inspectable"** ——
**那正是我们的 17 条判据（可读、可审、可改）。**
**所以我们已经有正确的形状,只是缺"采集"这一处。**

### 2.2 ★★★ 而它逐字点出了那个风险

> 「Rubrics supply an **auditable proxy** where none did……
>  The proxy is **not a guarantee**: its validity depends on
>  whether the criteria capture the intended construct,
>  whether the **judge applies them faithfully**, and
>  whether the **policy exploits what they omit**.」

⇒ ★★★ **最后一句:"策略会利用它们【省略掉的东西】"** ——
**那正是本会话"为了让测试变绿而放宽断言"的论文形式。**

### 2.3 ★★★ AutoLibra（ICLR 2026）—— 与我们场景几乎一致

> 「AutoLibra turns **open-ended natural-language feedback** on agent trajectories
>  into **fine-grained, interpretable evaluation metrics**.」

**它的三步流水线:**
```
① Feedback grounding  —— 把反馈拆成 (behavior, feedback, sign) 三元的【方面】
② Behavior clustering —— 把相似的方面聚类成【指标】（带定义 + 正反例）
③ LLM-as-a-Judge      —— 用归纳出的指标给轨迹打分
```

★★★ **而它有两个【元指标】—— 那正是"该不该采"的判据:**
> 「**`coverage` and `redundancy` meta-metrics** then measure how well
>  the induced metric set **covers unseen human feedback**.」

⇒ ★★★ **所以"该不该采"有现成的判据形状:**
```
coverage   —— 这个指标集【覆盖】了多少新反馈？
              ⇒ ★ 一条反复出现却没进库的模式，是 coverage 缺口
redundancy —— 这个指标集【重复】了多少？
              ⇒ ★ 一条与既有指标同义的新信号，是 redundancy 浪费
```

★ **而那两条正好对应我给的四条判据里的第 1 与第 3:**
```
collection.dedupe        ≈ redundancy（同义 ⇒ 不加）
collection.attributable  ≈ coverage（落不到 component ⇒ 无覆盖价值）
```

### 2.4 ★★ 而 PRM 那一支给了**第三种评估器**

**`mukhal/ThinkPRM`（TMLR）逐字:**
> 「Our verifiers…… **outperform LLM-as-a-judge, discriminative PRMs**,
>  on most in- and out-of-domain setups.」

⇒ ★★★ **所以评估器有三种实现,而它们是【递进】的:**
| 类型 | 是什么 | 成本 | 我们的对应 |
|---|---|---|---|
| **LLM-as-a-judge** | 让模型读清单打分 | ★ 每次一次调用 | ★ 现成的（我/成员读契约）|
| **判别式 PRM** | 训一个打分模型 | 要标注数据 | ⚠️ 无数据 |
| **生成式 PRM** | 模型**写出验证推理链**再判 | ★ 更贵但更准 | ★★ **值得注意** |

★★ **而"生成式"那一条对我们有启发:**
> 「ThinkPRM enables **scaling up verifier compute** either in parallel or
>  sequentially by **thinking longer**.」

⇒ ★★ **即:验证器可以"想更久"来提高准度** ——
**而我们现在的验证器（`test:gates` / `verify:fast` / `tsc`）是【确定性的、固定成本的】。**
**两者的分工该是:**
```
确定性验证器  ⇒ ★ 能判的（编译、测试、判据）—— 快、免费、可复跑
生成式验证器  ⇒ ⚠️ 只能判"主观"的（这条 prompt 改得好不好）—— 贵、要模型
```

---

## 三、★★★ 于是评估器体系是**三层,而各用不同工具**

| # | 问什么 | 用什么 | 依据 |
|---|---|---|---|
| **①** | ★ **该不该采** | ★ **`collection` 插入点 + 四条判据** | AutoLibra 的 coverage / redundancy |
| **②** | **该怎么分流**（软/硬）| 判据 + 阈值 | MemOS 的 δ 守卫（噪声不写修复）|
| **③** | ★ **改完好了没有** | ★ **确定性验证器**（可复跑） | GEPA 的 Constraint gates |
| **④** | **这条 prompt 改得好不好** | ⚠️ **生成式验证器** | ThinkPRM（★ 无标注数据时不可用）|

★★★ **而 (④) 我必须标出来:那是唯一需要"训一个模型"的地方,
而我们【没有标注数据】—— 那正是你说的"数据回填"要解决的。**

### ★★ 而三层必须分开（理由同前）

```
· ① 判"值不值得记"      —— 数据问题
· ② 判"该怎么治"        —— 路由问题
· ③ 判"治好了没有"      —— 效果问题
· ④ 判"这改动本身好不好" —— 质量问题（★ 最难，最需要数据）

★ 合任何两个 ⇒ "没采" / "采了没用" / "治了没好" 三者会合流
```

---

## 四、★ 一条我要如实说清的**边界**

**那份清单逐字警告过:**
> 「whether the **policy exploits what they omit**」

⇒ ★★★ **所以"加判据"这件事本身有它的极限:**
```
判据能覆盖的  ⇒ ★ 它写下来的那些
判据【没写】的 ⇒ ★ 循环会去利用
⇒ 所以每加一条判据，都要问："它【漏掉】了什么？"
```

★ **而本会话已经有两次实例:**
```
· 我的验收写成"pnpm test:gates 集合不变"，而那条命令【不含】被测文件（t73）
· "全跳过"被画成 ✓ —— 因为判据只数 blocked/unmeasured（c4cbeaf）
```
⇒ ★★ **两次都是"判据漏掉了它该覆盖的格"。**

---

## 五、★ 所以现在待你定的

| # | 问题 | 我的建议 |
|---|---|---|
| **7** | 加 `collection` 插入点 + 那四条判据? | ★ **加** —— 它是"该不该采"的唯一机械保障 |
| **8** | 评估器体系按四层分开? | ★ **是** —— 但 (④) 生成式验证器**暂不做**（无数据）|
| **9** | success/insight 的确认者 | 🔄 待你定（§上一份规格）|

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
