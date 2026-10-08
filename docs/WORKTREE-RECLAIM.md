# worktree 的两层回收

> **能力**：`judgeWorktreeReclaimable` / `describeReclaimability`（`src/worktree.ts`）
> **脚本**：`node scripts/worktree-reclaim.mjs`（干跑）· `--apply`（真删）
> **判据**：`scripts/worktree-reclaim.test.mjs`
> **一句话**：**产物已被主树吸收，才可以回收。**

---

## 一、它修的是什么

用户原话：

> 「不能每次都让我手动清理，得有一个自动清理的机制。」

MEASURED（2026-10-08）：

```
.agent-teams/worktrees/   4.6G
  其中 node_modules       2.4G（只有 5 个 worktree 有依赖）
  其余 46 个              约 25M 每个
★ 而 79 个已终态任务的 worktree 【全部还在】
```

★ 而 `src/worktree.ts` 有 `provisionWorktreeDependencies`（**装**）
而**没有**对应的**收** —— 只有装没有收，就是那 4.6G。

---

## 二、★★★ 判据**不是**「任务已终态」

两条理由：

```
① 一个 worktree 在【它的产物并入主树之前】不能删 —— 否则那份工作就丢了
   ★ 今晚 t39 那次正是靠 worktree 找回的（它的产物在 worktree 里）
② 成员常常需要【重跑一次】—— 例如收口时再跑一次护栏
   ⇒ 若依赖已被清掉，那次重跑要重新 install（★ 而那比保留更贵）
```

⇒ 正确的判据是：**它的产物已被主树吸收，且不再需要重跑。**

---

## 三、★★★★ 而 `--is-ancestor` 【一条不够】—— 这是实测出来的

`git merge-base --is-ancestor <wt HEAD> main` 成立 ⇒ **37 个**（50 个里）。
看起来那 37 个就可以删了。

**★★ 而往下查一步，结论就反了：**

```
那 37 个里，35 个有未提交的改动
再往里查：7 个持有【内容在整个历史里都不存在】的源码

最极端的样本 task-t64：
  scripts/gate-admission-absorb.test.mjs    68257 bytes
  scripts/gate-admission-checkpoint.test.mjs 50087 bytes
  src/tools/update-task.ts                  69797 bytes
  …共 7 个源码文件，内容不在任何提交里
```

⇒ ★ 只看 `--is-ancestor` 会**删掉这 7 份唯一的产物**。

### ★ 所以判据是两个条件的**合取**

```
(a) 已提交的：`--is-ancestor <wt HEAD> main`
(b) 未提交的：每一个脏的源码文件的内容，都能在历史里找到
              （`git log --all --find-object=<blob>`）
```

★ 而 (b) 只算**源码**（`src/` `scripts/` `docs/`）——
`lib/` 是构建产物，每次 `pnpm build` 重生成，它脏不构成"唯一产物"。

★ **这个区分也是实测逼出来的**：不做它，`task-t16` 会因为
`lib/git-artifact-stamp.json` 一个 stamp 文件被误判成"有唯一产物" ——
而一个把 46 个 worktree 都判成不可清的机制，等于没做。

---

## 四、★★ 两层，而第二层才是大头

| 层 | 条件 | 回收 |
|---|---|---|
| ① 依赖 | 落后主干 ≥ N 个提交 | `node_modules` |
| ② **整个 worktree** | (a) ∧ (b) 成立 | **大头** |

---

## 五、★★★ 「自动」意味着三件事（缺一不可）

### ① 它在【某个必然发生的时刻】跑

**答案：`pnpm verify` 的末尾**（与 `verify:frictions` 同一条先例）。

★ 为什么不挂在「交终态时」：**那个时刻不是必然发生的** ——
一个任务可能被 cancelled、可能被 reassign、可能 captain 代落，
**而那些恰恰是 worktree 最容易积压的情形**（本仓 79 个已终态任务的 worktree 全在）。

★ 为什么不挂在「status 被读时」：那是一个**会被频繁调用**的出口，
在它上面做删除会让一个只读操作产生副作用。

⇒ `verify` 是【每次全链跑完必然发生】的那个时刻，
而且它本来就在做"收口"这件事（它已经在那儿重新生成台账）。

### ② 它**必须留下痕迹**

删了什么 / 回收多少 / 为什么删 ⇒ 落 `.agent-teams/reclaim-log.jsonl`。

★ 没有它，**「清理过」与「没清理」在观测上同形**（本队那条纪律）。

### ③ 它**必须可关闭**

```
AGENT_TEAMS_NO_RECLAIM=1 node scripts/worktree-reclaim.mjs
```

★ 一个自动删除的机制若不能停，在它误判时会造出**不可逆**的损失。

---

## 六、★★ 而它默认是【干跑】

```
node scripts/worktree-reclaim.mjs           ⇒ 干跑（打印清单 + 预计回收）
node scripts/worktree-reclaim.mjs --apply   ⇒ 真删
AGENT_TEAMS_NO_RECLAIM=1 …                  ⇒ 完全停手（连扫描都不做）
```

---

## 七、★ 三态不同形

| 态 | 什么时候 | 带什么 |
|---|---|---|
| `reclaimable` | (a) ∧ (b) | `reason: 'absorbed'` + `behind` |
| `keep` | 不满足 (a) 或 (b) | `reason: 'not-absorbed' \| 'unique-work'` + `detail`（+ `orphaned`） |
| `undecidable` | 读不到 HEAD / 读不到主干 | `why` |

★ **三者没有任何两个共用同一组字段** —— 而 `undecidable` **绝不**读成 `reclaimable`
（那是把"没测到"并进"可以删"）。

---

## 八、★★★ 对本仓的实测读数（干跑）

```
回收扫描：51 个 worktree
  可清 30 · 保留 21 · 判不了 0
  预计回收 2488.2 MiB

  保留 21 个的原因：{ "unique-work": 7, "not-absorbed": 14 }
```

★ 而那 7 个 `unique-work` 正是第三节那 7 个 —— **它们会被保住**。

### ★★ 两条独立实现交叉核对

`src/worktree.ts` 的 `judgeWorktreeReclaimable` 与脚本的 `judgeWorktree`
是**两份独立实现**（一份在 src、一份在 scripts，各自从头写）。

```
逐条比对 51 个 worktree 的判定 ⇒ mismatches: 0
```

★ 而那是一个比"夹具全绿"更强的证据：**两个独立的读法给出同一个答案**。

---

## 九、臂

| 臂 | 它钉什么 |
|---|---|
| 1 | 已吸收且无唯一产物 ⇒ `reclaimable` |
| **2** | **不可清 · 未吸收** ⇒ `keep`，并给出差多少提交 |
| **3** | **★ 核心安全臂**：已吸收**但**有唯一源码 ⇒ 必须 `keep` |
| 4 | 只有 `lib/` 脏**不**构成唯一产物（否则等于没做） |
| 5 | 三态不同形 |
| **6** | **干跑臂**：默认绝不删除，而清单如实报出 |
| 7 | 反向半边 · 不许恒不删（可清时 `apply` 真的删） |
| 8 | 反向半边 · 不许恒删（不可清时 `apply` 不删它） |
| **9** | **定向突变**：造一个"未并入" ⇒ 必须判 `keep` |
| **10** | **定向突变**：去掉 (b) ⇒ 臂 3 的情形会被误判为可清 |
| 11 | **可关闭臂**：`AGENT_TEAMS_NO_RECLAIM` 真的停手 |
| 12 | **痕迹臂**：每次运行都留下可读的记录 |
| **13** | **真实读数臂**：对本仓干跑一次并如实报出 |

### 两个定向突变（都实测打红）

```
A 去掉 (a)（只看脏不脏）    ⇒ 臂 2 / 臂 9 红
B 去掉 (b)（只看 --is-ancestor）⇒ 臂 3 / 臂 8 / 臂 10 红
```

★ 而 B 正是第三节那个真实缺陷的机械形式。

---

## 十、★ 已知边界

```
① 它【不】决定"什么时候该删" —— 那是接线（package.json 的 verify 链）。
   ★ 而 `package.json` 不在本任务的 inScope，所以那一步留待接线。
   ★ 在那之前：能力已建、夹具已绿、干跑可跑，而**没有任何东西自动跑它** ——
     ★ 本队那条纪律：**一个没有调用方的修法，与没有修法在观测上完全相同。**
     ⇒ 所以这一条被**写下来**，而不是让"能力存在"替它作证。

② 它【不】判断"任务是否终态"。判据是产物是否被吸收 —— 而那是故意的：
   一个 cancelled 的任务，其产物可能早已并入（⇒ 可回收）；
   一个 completed 的任务，其产物可能还没并入（⇒ 不可回收）。

③ (b) 用的是 `git log --all --find-object` —— 它问的是"内容是否在**任何**引用里出现"。
   ★ 一个被 `git gc` 收掉的对象可能查不到 ⇒ 那会让它保守地判 `keep`
     （★ 方向是对的：宁可留，不可误删）。
```
