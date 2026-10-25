# 吸收上游 #161 判决审计分级 —— **做不到，按纪律停下报队长**

> **任务**：吸收上游 `648fd9a` / `76d60a0` 的 `VerdictAuditNote`（`blocker` / `warning`）+「早于内容绑定 ⇒ unauditable gap」。
>
> **结论**：**判据 ③ 能做到；判据 ①② 与反向半边 B 做不到** —— 因为我们**没有内容绑定模型**。
> **按任务书「若发现做不到的，停下报队长」处置：本任务未落地任何代码。**
>
> **基线**：worktree `task-agent-teams-refactor-t94`，HEAD `36c6376`。
> 前置已核：`git merge-base --is-ancestor 71790be HEAD` ⇒ **成功**。

---

## 0. 一句话

**上游那份审计的每一条都建立在「判决绑定了哪些字节」之上。我们没有那个模型** ——
而任务书**自己划了这条边界**（「本任务只做分级与缺口读数，用我们已有的信息能判的部分」）。

诚实的读数是：**我们已有的信息只能判第 ③ 条。**

---

## 1. 上游的实现（我从仓里读的，不是转述）

`git show 76d60a0:src/quality-gates.ts` 的 `verdictAuditNotes`（`:1390`）**依赖六个符号**，
而它们**在我们树里一个都没有**：

```sh
for f in verdictDrift bindsRecordedRevision unboundVerdict ArtifactDriftDetail ArtifactDigest VERDICT_KINDS; do
  printf "%-24s %s\n" "$f" "$(grep -rn "$f" src/ --include=*.ts | wc -l)"
done
#   verdictDrift           0      ← 判「漂没漂」的核心
#   bindsRecordedRevision  0      ← 判「这条判决绑没绑字节」
#   unboundVerdict         0      ← 判「有没有记 identity」
#   ArtifactDriftDetail    0
#   ArtifactDigest         0      ← ★ 内容摘要的类型
#   VERDICT_KINDS          0
```

★ **注意**：`VerdictAuditNote` 与 `verdictAuditNotes` **在我们树里也都不存在**（`grep` ⇒ 0）
⇒ 这不是"改一改"，是**从零搬一个子系统**，而它**踩在任务书划的边界外**。

---

## 2. ★★ 关键：上游的每一格都读**我们不存在**的字段

`git show 76d60a0:src/quality-gates.ts` 的 `bindsRecordedRevision`（`:1446`）逐字读：

```ts
if ((item.reviewedArtifacts?.length ?? 0) === 0) return false
if ((item.reviewedGaps?.length ?? 0) > 0) return false
if ((item.reviewedDuringDrift?.length ?? 0) > 0) return false
const target = reviewedTargetOf(team, item)
if (target !== undefined && item.reviewedAttempt !== undefined && (target.attempt ?? 0) !== item.reviewedAttempt) return false
if (audit.artifacts === undefined) return false
return artifactDriftDetails(item.reviewedArtifacts, audit.artifacts).length === 0
```

而 `unboundVerdict`（`:1349`）逐字：

```ts
return (item.reviewedArtifacts?.length ?? 0) === 0
  && (item.reviewedGaps?.length ?? 0) === 0
  && item.reviewedAttempt === undefined
```

**这些字段在我们树里的命中数**：

| 上游读的字段 | 我们的 `src/` | 结论 |
|---|---:|---|
| `reviewedArtifacts` | **0** | ❌ 不存在 |
| `reviewedGaps` | **0** | ❌ 不存在 |
| `reviewedDuringDrift` | **0** | ❌ 不存在 |
| `audit.artifacts`（摘要列表） | **0** | ❌ 不存在 |
| `reviewedAttempt` | 1（`types.ts:691`） | ⚠️ **存在，但是 attempt 序号，不是内容摘要** |

⇒ ★★ **我们唯一有的那一格（`reviewedAttempt`）是"第几次尝试"，不是"哪几个字节"** ——
它**不能**回答"漂了没有"，而上游那条正是靠它 + `reviewedArtifacts` **合起来**判的。

---

## 3. ★★★ 逐条判据：我们**有没有**判它所需的信息

| # | 判据 | 它需要什么 | 我们有什么 | 能否判 |
|---|---|---|---|---|
| **①** | drifted 的 review/requirements ⇒ **blocker**（除非更晚 sound 判决覆盖**同一 lineage**） | (a) 该判决绑了**哪些字节**  (b) 当前字节是什么  (c) **lineage** | (a) ❌ 无  (b) ⚠️ 只有 `baseRevision`（**commit 引用，不是 digest**）  (c) ❌ **无**（`grep -rn "lineage\|supersede" src/` ⇒ 除一句注释外为 0） | ❌ **判不了** |
| **②** | drifted verification / **被取代**的判决 ⇒ **warning** | 同 (a)(b)(c) | 同上 | ❌ **判不了** |
| **③** | 没记 artifact identity 的旧判决 ⇒ **unauditable gap** | **只需判"有没有记 identity"** | ★ 我们**能判**（我们没有那个字段 ⇒ **等于所有判决都没记**） | ✅ **能判** |

### 3.1 ★ 而「我们所有判决都没记 identity」这句话，正是 ③ 要的输出

⇒ 按 ③ 的字面定义，**我们现有的每一条判决都应当落 `unauditable gap`**。
★ 这**不是**我在降低标准 —— 它**恰好**就是上游那段注释要的行为：

> 「A verdict that **predates content binding** is reported as an **unauditable gap**
>  rather than **being read as a pass over the current bytes**.」

⇒ 而我们**全部**判决都早于内容绑定 ⇒ **全部都是 gap**。这是**正确的结论，不是缺陷**。

---

## 4. ★★ 反向半边检验：为什么我**不能**只做 ③ 就交

任务书要求**两条反向半边，缺一不可**。逐条检验：

| 半边 | 要求 | 只做 ③ 时 |
|---|---|---|
| **A** | 没记 artifact identity 的旧判决 ⇒ 必须报 unauditable gap，**不许算 sound** | ✅ **成立**（③ 正是它） |
| **B** | ★ **合法被取代的 drift ⇒ warning · 未被覆盖的 drift ⇒ blocker —— 两者必须不同形** | ❌ **做不到** |

**B 为什么做不到**：它要求区分「**drifted**」与「**被覆盖**」两件事。
而这两件事**都**建立在 (a) 绑定字节 (b) 当前字节 (c) lineage 之上 —— **三者我们全无**。

⇒ **若我硬做，实现只能恒返回 `blocker` 或恒返回 `warning`** ——
**而"恒返回一个值"正是 B 要防的那件事**（"两者必须不同形"）。

★ 这与会话里刚记过的一条同形（t68 的自作自受）：
**一个只覆盖单侧输入的断言，会让整类缺陷不可见。**
⇒ 我**不制造"看起来通过了验收"的空壳**。

---

## 5. 我**没有**做什么（以及为什么）

| 我**没有**做 | 为什么 |
|---|---|
| 没有落地 `VerdictAuditNote` | 它的两个 `level` 里，`blocker` 的判据（①）我们判不了 ⇒ 落一个**只会恒 warning** 的字段，就是反向半边 B 要防的空壳 |
| 没有伪造 `reviewedArtifacts` 等字段 | 那会**造出一个假的"已绑定"事实**，比没有更坏（读的人会照着它信） |
| 没有把 `baseRevision` 当作 digest 用 | `baseRevision` 是 **commit 引用**；当成内容摘要会让"漂没漂"这个判定**建立在错的前提上** |
| 没有改既有 21 条判据的 `verdict` 语义 | 硬纪律；且本任务**没有改任何代码** |
| 没有写 `scripts/gate-verdict-audit-levels.test.mjs` | 没有实现可测 ⇒ 写一个测空壳的夹具等于**把"没做"包装成"做了"** |

**净工作区状态**：`git status --porcelain` ⇒ 只有 `M lib/git-artifact-stamp.json`（我 `pnpm build` 刷新了 stamp）。
★ 我另把 `lib/client.js` **还原**了 —— 它的改动实测是 **CSS 模块哈希前缀变动**（`_8qZE2a_` → `_69wvcq_` → `_9wXQ6a_`，三个前缀并存），
因 lightningcss 按**文件绝对路径**算哈希，而这是另一个 worktree，**与本次无关**（t78 记过同一现象）。

---

## 6. ★ 这条边界是任务书自己划的

任务书 §「一条边界（**不许越界**）」逐字：

> 「★ 上游的完整方案要【内容 digest】（它记 "the real digests"）
>  ★★ 而我们现在只有 baseRevision（不是 digest）
>  ⇒ ★★★ 所以本任务【只做分级与缺口读数】——
>    即:用【我们已有的】信息能判的部分」

⇒ **我的实测结论是：能判的部分只有 ③ 这一条**，而 ①② 需要的正是那条边界外的 digest + lineage。
★ 任务书同时说：「★ 若你发现"没有 digest 就判不了某一条" ⇒ **如实报出**，
并把那一条落成 `unauditable gap` —— ★ **那正好是它该有的行为**。」

⇒ **本文件就是"如实报出"那一步。** 而 ① 与 ② **无法落成 gap** ——
它们**不是"某一条判决是 gap"**，而是**"整个判据判不了"**（缺的是**判据的输入**，不是**某条数据的输入**）。
★ 这个区分很重要：**"这条判决没绑定"与"我们这套还没有绑定机制"是两件事**，
把它们混成一句 `unauditable gap` 会让**"机制缺失"**伪装成**"数据缺失"**。

---

## 7. 建议（供队长派活的依据）

按依赖序，最短路径：

| 序 | 动作 | 落在哪 | 说明 |
|---|---|---|---|
| **S1** | 判决落盘时记**它绑定的字节摘要**（`reviewedArtifacts: ArtifactDigest[]`） | `src/types.ts`（`TeamTask`）+ 写入点 | ★ **本任务缺的就是它**；没有它，①②永远判不了 |
| **S2** | `audit.artifacts`（当前摘要列表）进 `DeliveryAudit` | `src/quality-gates.ts` | 有了 S1 才能比"当时 vs 现在" |
| **S3** | 迁移 `verdictDrift` / `bindsRecordedRevision` / `unboundVerdict` / `artifactDriftDetails` | `src/quality-gates.ts` | 六个符号是一次搬迁，不是零散改动 |
| **S4** | `VerdictAuditNote` + 三条判据 + 三交付面 | 本任务的原定 inScope | **S1–S3 之后**才可做 |

★ **而 S1 需要重新审议一个设计决定**：`baseRevision` 今天是 **commit 引用**。
换成/补上 **内容摘要**是**改数据模型**（旧记录没有该字段 ⇒ 它们**全部**会落 `unauditable gap`，
而那**正是 ③ 的正确行为**，但**会**让所有历史判决立刻变成 gap ⇒ 需要用户/队长知情）。

---

## 8. 本文件**没有**做的（如实留白）

1. **没有实现任何代码**（本任务未落地一行）。
2. **没有跑 `pnpm test:gates` 的对照跑** —— 无改动即无净变化（但我**跑了**基线：臂级失败集合 **12** 条，
   ★ 与任务书写的「基线 16 文件」**口径不同**：我按**臂级**取，那个数是**文件级**）。
3. **没有写夹具** —— 没有实现可测。
4. **没有改** `src/client` / `src/gates` / `src/evolution` / `src/evaluator`。

---

*本次**只新增本文件**。未改 `src/**`、`lib/**`（除构建自身的 stamp 刷新，且已还原 `lib/client.js`）、`scripts/**`。*
