# 上下文与记忆机制调研（2026-10-17）

> **用户两问**
> ① 「**评估现有机制**:目前 DSH 默认的上下文机制是什么?**应该不支持无限对话吧**,
>    我们可能需要对这个**统一入口**做一个单独的上下文机制。」
> ② 「**调研记忆插件**:……既然这个入口被聚合了,它又**不会去开新的 session**,
>    那它的上下文对于用户来说就是**无限的**。所以不管是对上下文的控制还是记忆能力,
>    都需要有很高的要求。」

---

## 0. ★★★ 结论:① DSH **有**内置压缩,而它【不够】;② 有一个【原生支持 DSH】的成熟方案

```
① DSH 的机制:内置 compaction（★ 是一组事件,不是一个开关）
   ⇒ ★★ 它解决"窗口满了",而【不解决"永远只有一个会话"】
② billion-context（★1516）:★ 【原生支持 dsh】
   ⇒ ★★★ 它逐字就是为你的场景写的
```

---

## 1. ★★ ① DSH 现有的上下文机制（实测）

### 它有压缩,而它是**事件流**

```
$ grep -c compaction node_modules/@deepseek-ai/dsh-session/lib/index.js  ⇒ 6
★ 事件:compaction/start · compaction/prune · compaction/summary · compaction/end
```

★ **即:压缩是【会话事件流里的四类事件】** —— 而会话记录是 append-only 的,
**所以压缩【不删历史】,它标记一段被折叠。**

### ★★ 而"事件流 + 折叠"这个形状,**正好与 billion-context 的机制吻合**

```
★ billion-context:「compression here is **incremental, reversible, and prefix-cache friendly**:
  summaries are written in small ranges, **can be decompressed on demand**,
  and the **cache prefix stays intact**」
★★ 而 DSH 的四类事件里【已有】prune 与 summary 两半
⇒ ★★ 所以它不是"要不要引入压缩",而是"有没有比内置更好的压缩"
```

### ★ 一处我要如实说的边界

```
★★ 我【没有实测】DSH 内置压缩的触发条件与效果
   —— 它在 dsh-agent / dsh-session 的 bundle 里,而那是压缩过的代码
⇒ ★ 所以"内置够不够"这个判断,本文【不下】
   ★ 而下面的对比是基于 billion-context 自己声明的能力
```

---

## 2. ★★★ ② `billion-context` —— 而它**原生支持 DSH**

**它的定位（逐字）:**
> 「**A context-compression plugin for small context windows (a 100K context is enough),
>  token savings (5x fewer tokens), and month-long single sessions (billions of tokens)**」

**★ 而 DSH 是它【明确列出的客户端之一】:**
```
| **dsh** | `bili dsh`（launcher — full native plugin via `--patch`）
        | 或 `bili plugin install dsh` ≡ `dsh plugin --profile <name> add billion-context`
```

### ★★★ 而它的机制**恰好是"聚合入口"需要的**

```
★ 它坐在【任何 agent 与模型 API 之间】,重写请求/响应流
★★ 而它注入【四个上下文管理工具】,由【模型自己】决定何时压缩什么:
   · compress        —— 把一段消息折成详细摘要
   · decompress      —— 需要细节时【恢复】那一段
   · search_context  —— 在摘要与可见消息里做关键词搜索
   · acp_status      —— 上下文用量总览 + 哪几段还可压
⇒ ★★★ 即:【不是硬截断,而是可逆的分段折叠 + 可搜索】
```

★★★ **而那直接对上你的场景:**
```
★ 你的聚合入口:「永远只有一个窗口」「不开新 session」「上下文对用户是无限的」
★★ 而它:「month-long single sessions (billions of tokens)」
⇒ ★★★ 逐字是同一件事
```

### ★★ 而它有生产级数据（不是声明）

> 「A production-scale longitudinal study: **4.5 months, three hosts, 174,327 model calls,
>  18.76B cumulative input tokens (~24.7B across all hosts), zero window violations
>  on 204,800-token models, marathon sessions of 8,584–12,049 calls.**」

★ **而它的健康判据是可核的:**
> 「a healthy session keeps a **95–97% prefix-cache hit rate** — compression itself costs ≤2%」

⇒ ★★ **而那是一条【可复跑的读数】** —— 与我们本会话的纪律一致。

### ★★★ 而它有一篇论文,而论文的标题正是"长期会话"

> 「**Model-Driven Incremental Hierarchical Compression: Training-Free Multi-Generational
>  Context Management for Long-Lived Coding Agents**」

★ **"Training-Free"** ⇒ ★ **它不需要训练模型** —— 那意味着**可以当工具用,不必当模型用。**

---

## 3. ★★ 而市场里还有 5 个（按相关度）

| 插件 | 它解决什么 | 与我们的关系 |
|---|---|---|
| **`billion-context`** ★1516 | ★★★ **长会话 + 5× token** | ★★★ **最相关,且原生支持 dsh** |
| **`@falling-ts/dsh-force-compact`** | ★ **强制压缩**（hook `agent/pre-step` + `agent/request`）| ★★ **它的 hook 点值得读** |
| **`dsh-context-compression-improved`** | 工具结果压缩 + **代码骨架压缩门** | ★ 局部（工具结果）|
| **`dsh-context`** ★0.72 | ★ **context dashboard**（看清上下文怎么组成的）| ★ **可观测性**,与压缩互补 |
| **`dsh-recall-plugin`** · `@furongjun1999/dsh-memory` · `@kenz1117/dsh-engram` | 记忆/召回 | ⚠️ 与我们的 `memex` 重叠 |

★★ **而 `dsh-force-compact` 那一条值得单独看:**
> 「hooks the core model-request seam（**`agent/pre-step` + `agent/request`**）
>  to force-compact a session's context and disable thinking」

⇒ ★★ **即:DSH 有一个 `agent/request` 接缝,而第三方插件已经在用它做压缩。**
★ **那意味着我们【也能在那条缝上做自己的策略】** —— 不必只依赖别人的插件。

---

## 4. ★★★ 所以对"聚合入口的上下文"该怎么做

### 而它有一条**与我们的架构吻合**的推论

```
★ 你的设计:聚合入口【不干活】,把任务交给 session 主会话
★★ 而"不干活"本身就【大幅减少】它的上下文增长
   —— 它收到的是【结果】，不是【过程】
⇒ ★★★ 所以第一道防线【是架构，不是压缩】:
   委派得越彻底，聚合入口的上下文增长越慢
```

### ★★ 而第二道防线才是压缩

```
★ 而若它真的长到需要压缩 ⇒ ★ 三条路:
   ① 用 billion-context（★ 原生支持 dsh,有生产数据）
   ② 用 DSH 内置的 compaction（★ 已在,而我们没实测它的效果）
   ③ 在 `agent/request` 缝上自建（★ dsh-force-compact 是那条路的先例）
```

★ **而我的建议顺序:**
```
★★ 先量 —— 用 `dsh-context`（或我们自己的读数）看聚合入口【实际】怎么长
★ 再选 —— 因为"要不要压缩"取决于涨得多快，而那是一个读数，不是判断
```

---

## 5. ★ 一条我如实说的

```
★★ 本文全部基于【README / npm / 源码 grep】,而【没有装、没有跑】
⇒ ★★★ 所以"billion-context 适合我们"是【据它自己的声明与我们场景的相似度】推出的
★ 而它是 launcher / cert-MITM / `--patch` 三种接法之一 ——
  ★ "能不能在我们这个 profile 上跑通"是【要实测的】
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
