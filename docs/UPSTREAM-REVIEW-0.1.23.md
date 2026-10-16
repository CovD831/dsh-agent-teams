# 上游 v0.1.23 审阅：能吸收什么（2026-10-16）

> **用户要求**「看一下我们的上游仓库,它更新了什么,有没有什么我们可以吸收借鉴的」
>
> ★ **推送已完成**:223 个 commit 推到 `CovD831/dsh-agent-teams` 的
> `task-mutation-integrate` 分支（★ 新建分支,**未动 `origin/main`**）。

---

## 0. ★★★ 上游 33 个 commit,而它们的主题与我们【高度同族】

```
共同祖先: 98aac03
upstream/main 独有: 33   本分支独有: 356

改动规模: 104 文件 · +13967 / −761
新增模块: src/lineage.ts (248) · src/tool-policies.ts (219) · src/artifacts.ts (359)
```

★★ **而 33 个里有 8 个的标题直接命中本会话反复处理的形态:**
```
648fd9a fix(quality-gates): bind verdicts to revisions, wire repair rounds, keep contracts satisfiable
76d60a0 fix(quality-gates): only content-bound, covering verdicts may supersede
884d0a0 fix(quality-gates): bind the judged lineage and stop demoting drifted verifications
278ea20 fix(members): record a settled failure even while the member is working
57bc082 fix(members): only a terminal record may be described as settled
d5f4083 fix: never relax an owner-declared tool-policy name
6051a90 fix(client): match team cards by the host's canonical team id
38a84b9 fix(sessions): resolve team identity along fork chains
```

---

## 1. ★★★ 最该吸收的:**#161「判决绑定到它评的那个 revision」**

**上游逐字（commit `648fd9a`）:**
> 「**#161 A passing review was not bound to the revision it judged**:
>  delivery was computed from task records only, so it advertised
>  **"all gates passed" over bytes that had since been edited or deleted.**
>  Reviews/requirements/verification now **snapshot their scope at claim**,
>  record **the reviewed attempt**, **the real digests** and the scope they bound at close,
>  and **every delivery surface audits the current workspace bytes**
>  （status tool, activity-panel route, per-task verdict marker）.
>  ★ A legitimately superseded pass **converges as a warning instead of blocking**;
>  an incomplete or unreadable audit **blocks**.」

### ★★ 而我们有**同一个缺陷的浅版本**（T7）

```
★ 我们记账的 T7:「commit hash 当 done/not-done 的判据」——
  本会话反复遇到"按内容判定,不按哈希"
★★ 而我们的处置是【在判据层面】改（用内容比、用集合比）
⇒ ★★★ 上游做到了【交付面层面】:
   · 在 claim 时快照 scope
   · 记 reviewed attempt + 真实 digest
   · ★★ 而【三个出口】都审计当前工作区字节
   · ★ 而"合法被取代"⇒ warning,"不完整/读不出"⇒ blocking
```

### ★ 三条可吸收的（按价值排序）

| # | 上游的做法 | 我们的现状 |
|---|---|---|
| **①** | ★★★ **三个交付面都审计** | ⚠️ 我们只在一个地方判（判据层）|
| **②** | ★★ **`converges as a warning instead of blocking`** | ⚠️ 我们没有"合法被取代"这一态 |
| **③** | ★ **记 `reviewedAttempt` + 真实 digest（不只是 hash）** | ⚠️ 我们记 `baseRevision`，但**没有 digest** |

### ★★★ 而 ② 是本会话反复需要而没有的东西

```
★ 我们的处境:改动合法地被后来的改动取代 ⇒ 目前【没有表达方式】
  ⇒ 要么当成"通过"（错），要么当成"失败"（也错）
★★ 而上游给了第三态:warning（不阻塞，但可见）
⇒ ★★★ 而那与我们的 unmeasured 是【同一族】—— "既不是通过也不是失败"
```

### ★★ 而 ③ 直接对上我们 T7 的教训

```
★ 我们:T7 的教训是「cherry-pick 会改 hash ⇒ 不能用 hash 判 done」
⇒ ★★ 而我们没有给出【替代物】—— 只说"别用 hash"
★★★ 上游给了替代物:【真实 digest】（内容绑定）
⇒ ★★★ 所以我们的 T7 该补的是"用什么代替 hash"，而不只是"别用 hash"
```

---

## 2. ★★★ **#174「修复工单会腐坏」** —— 我们有对等缺陷

**上游逐字:**
> 「**#174 Auto-generated repair work orders were frozen at finding-generation time.**
>  They now record the workspace snapshot they were derived from,
>  **are flagged stale when a cited artifact changes**（status, panel and the dispatch prompt）,
>  and **their acceptance loses drifting line anchors** and states that
>  **the plugin did not verify the finding's claims.**」

★★★ **而"acceptance loses drifting line anchors"正是我们 t73 与 T3 那两条:**
```
★ 我们记账的 T3:「行号锚点」缺陷
★ 而 t73 修的正是「判据自毁参照」（参照从 HEAD 换成提交历史）
⇒ ★★ 上游做到了:【acceptance 里的行号锚点会被剥掉】
⇒ ★★★ 而它还给了一个我们没做的:
   「states that the plugin did not verify the finding's claims」
   ★★ 即:工单必须【声明它没验证过那个发现】——
      而那正是我们反复要求的"不许把未验证的写成已验证"
```

---

## 3. ★★★ **#183「不可满足的契约」** —— 我们也有

**上游逐字:**
> 「**#183 `repairScopeFromFindings` collected paths the completion gate classifies
> `out_of_scope` by default**（secrets/, .env*, .git, .dsh, .agent-teams）,
>  **producing unsatisfiable contracts.**
>  Derivation and gate now **share one exclusion predicate**;
>  findings whose every cited path is excluded **escalate with a reason
>  instead of dead-locking a member.**」

★★ **而这是本会话的一个热点:**
```
★ 我们遇到过【三次】「契约自身错了」（闸门拒了它自己的产出）
  · lib/types.d.ts 写成文件而它其实是目录（T5）
  · verify 命令指向本任务的产出
  · inScope 与 outOfScope 同一路径（我们的 #2b）
⇒ ★★★ 而上游的处置是【根本性】的:
   「derivation 与 gate **共用同一个排除谓词**」
   ★★ 即:两个地方不许各写一份排除规则 —— 而那正是我们"两表重叠"的根因
```

---

## 4. ★★★ **#176 / #160「fork 链上的团队身份」** —— 我们【完全没有】

**上游逐字（`src/lineage.ts`）:**
> 「**Forking is a first-class DSH operation**: the fork receives a new session id and
>  records the source session as `header.parentSession`.
>  **Team identity must therefore be resolved along that chain,
>  or a captain that continues in its own fork stops matching the team it leads (#176).**
>  ★ Membership keeps its exact id match: a member is a subagent child of its captain,
>  so its parent chain also contains the captain and **must never be read as lead identity.**
>  ★ Only a top-level conversation may inherit lead identity from an ancestor.」

### ★★★ 而我们的实现是**精确匹配**（实测）

```ts
// src/state.ts:727
if (team?.captainSessionId === captainSessionId) { ... }
```

⇒ ★★ **所以 captain 在自己 fork 里继续时,我们会【找不到它带的队】。**

★ **而它还有一条我们该注意的边界:**
```
★★ member 也是 captain 的 subagent child ⇒ 它的 parent 链【也含 captain】
   ⇒ ★ 所以"沿着 parent 链找"这条规则【不能】套用在成员上 —— 否则成员会被认成队长
```

⇒ ★★★ **即:同一个链,对 captain 要沿它解析,对 member 要保持精确匹配。**
**而那是一个"同一个数据结构,两种读取规则"的形状** —— 正是本会话反复的那类。

---

## 5. ★★ **#59「成员工具策略」** —— 一个完整的新能力

**上游新增 `src/tool-policies.ts`（219 行）,而它的两条修正是本会话的同族:**

```
d5f4083「never relax an owner-declared tool-policy name」
  ★ 上游:「一个 owner 声明了某个名字，而那个名字也是内置条目 ⇒
           host 报它 unknown 时，它会被【静默丢掉】⇒ 成员在【与声明不同】的策略下启动」
  ⇒ ★★ 那正是我们 t84 那条「role 有两个消费者」的形状:
     声明与实际【不同形】，而静默**
```

★ **而我们【没有任何】成员工具策略的功能** —— **那是一个完整的新模块（219 行）。**

---

## 6. ★ 我们的 356 个 commit 里,上游**没有**的（反向对照）

```
★ collection 插入点 + 四条判据（该不该采）      ← 我们独有
★ 评估器模块（收益的前后窗口）                  ← 我们独有（在做）
★ 分流（soft/hard/contract/none/unmeasured）    ← 我们独有
★ 两份规范文档体系（docs/ 86 份）               ← 我们独有
★ 树形存储 + KV 广播去重                        ← 我们独有
```

★★ **所以不是"我们落后"** —— 而是**两条不同的路**:
```
· 上游在做【质量闭环的深度】（revision 绑定 · 工单腐坏 · 契约可满足性 · fork 身份）
· 我们在做【自进化与评估器】（采集 · 分流 · 收益）
⇒ ★★ 而两者【互补】:上游那些正是"评估器"能产生收益的【前提】
```

---

## 7. ★★★ 建议吸收的四条（按价值/成本排序）

| # | 吸收什么 | 成本 | 价值 |
|---|---|---|---|
| **①** | ★★★ **`converges as a warning`（第三态）** | 小 | ★ 我们对"合法被取代"目前无表达 |
| **②** | ★★★ **digest 替代 hash（T7 的补全）** | 中 | ★ 我们只说了"别用 hash" |
| **③** | ★★ **derivation 与 gate 共用排除谓词** | 小 | ★ 那是我们"两表重叠"的根因 |
| **④** | ★★ **工单声明"插件没验证过那个发现"** | 小 | ★ 我们的验收里没有这句 |

★ **而 ①③④ 都【小】,且都在我们已有的文件里** ⇒ 可以直接吸收。
★★ **② 中等**,而它补的是我们 T7 的**缺口**。
★ **fork 身份（#176）与工具策略（#59）是两个完整模块**,该**单独评估**。

---

## 8. ★ 一条我如实说的

```
★ 我没有逐行读那 13967 行插入 —— ★ 我读的是【8 个提交的完整 message】
  + quality-gates.ts（1012 行）与 lineage.ts 的关键注释
⇒ ★★ 所以本审阅的结论基于【上游自己的问题陈述】,而不是它的实现细节
★ 若要吸收某一条,该【逐行读那一条的实现】再动手
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
