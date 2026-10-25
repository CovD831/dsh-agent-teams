# 本次梳理的起点读数（2026-10-15）

> 本文记录**本次会话开工前实测的**事实，供本队成员与下一个会话复跑核对。
> 纪律：每条都附命令；不是"我记得"。

## 0. 一句话

fork 已从上游的约 2 万行膨胀到 **src/ 47,310 行**；两个 typecheck 全绿，
而 gate 测试是 **1031 pass / 11 个文件红**——其中只有 **1 条**是当前分支新引入的真实回归。

---

## 1. 会话与工作流状态（冲突边界）

| 事实 | 读数 |
|---|---|
| 本会话有无活动团队 | **无**（`agent_teams_status` 报 "no active team"） |
| 当前分支 / HEAD | `task-mutation-integrate` / `b8f357e` |
| 工作树 | 干净（`git status --short` 为空） |
| worktree 总数 | 28 |
| `task-mutation-*` 分支 | t1 / t3 / t11 / t13-t17 / t18 **未合并**；仅 t7 已并入 HEAD |
| 已合并进 HEAD 的最近任务 | t24（`46eb6bc`） |

**★ 冲突边界**：`docs/THREE-LINE-PLAN.md` 实测记录这 6 条分支**两两全部冲突**
（10 对组合 `git merge-tree --write-tree` 均 exit=1；`t11×t1` 单对 31 块冲突）。
⇒ 本次梳理**不动** `task-mutation-*` 分支、`.agent-teams/worktrees/**`、
以及 `src/mutation.ts` / `src/mutation-guard.ts` / `src/gates/completion/mutation.ts`。

★ 所有 worktree 均无未提交文件（逐棵 `git status --short` 为空）⇒ 没有东西会丢。

---

## 2. 构建与测试基线

```sh
npx tsc -p tsconfig.json        --noEmit   # exit=0
npx tsc -p tsconfig.client.json --noEmit   # exit=0
node --test scripts/gate-*.test.mjs        # 1031 pass / 11 个文件红
```

### 2.1 11 条红的分类（**已实测归类，非推测**）

**(a) 已被 pin 覆盖（5 条）**——`scripts/fixtures/baseline-known-failures.json` 的 17 条 pin 内：

```
gate-contract-build-artifacts · gate-input-wiring · gate-producer-consumer
gate-repair-completion · gate-source-reading-convention
```

**(b) 在 `main`(323f104) 上同样红（5 条）**——临时 worktree 实测：

```
gate-falsification-pairs · gate-reviewed-passthrough · gate-stale-module
gate-worktree-arrival · gate-baseline-known-failures
```

⇒ 这 5 条**不是**当前分支造成的。其中 `gate-baseline-known-failures` 臂 6
是**文档自洽缺陷**（一条 pin 的 `because` 文本落不进任何已知成因类），不是产品缺陷。

**(c) ★★ 关于 t1 探针：队长此处先前判错，已由 t4 推翻（保留原判以待对照）**

我最初把 `gate-t1-completion-probe` 判为「本分支新引入的真实回归」，依据是：

```
main(323f104) : ℹ pass 2  ℹ fail 0     ← ★ 这个读数被我读错了
HEAD(b8f357e) : ℹ pass 1  ℹ fail 1
```

**★ 该判据不成立。**三条独立复核（t4，我已自行复跑确认）：

1. `git diff 323f104 b8f357e -- scripts/gate-t1-completion-probe.test.mjs` = **空**
   ⇒ 该文件在两棵树上**逐字节相同**，不可能是 main/HEAD 差异的成因。
2. main 上它是 **`t.skip` 不是通过**。`scripts/gate-t1-completion-probe.test.mjs:886-890`：

   ```js
   const teamFile = join(ROOT, '.agent-teams', 'unified-pipeline', 'team.json')
   if (!existsSync(teamFile)) {
     console.log('  [t13] （unified-pipeline 的 team.json 不在盘上 ⇒ t1 那一半跳过）')
     return                       // ← 直接返回，不是断言通过
   }
   ```

   我当初是在一个**临时 worktree** 上跑 main 的，而 `.agent-teams/` 被 `.gitignore` 忽略、
   worktree 抽不出来 ⇒ 那条臂**跳过**了。**我把 `skip` 读成了 `pass`。**
3. 根因（可核）：`src/tools.ts` 的 `persistTaskBaseRevision` 枚举 stateRoot 下**所有团队**、
   只按**裸 taskId** 匹配（`fresh.tasks.find(c => c.id === taskId)`，在
   `for (const teamId of teamIds)` 内层）。实测 `.agent-teams/` 下**三个团队各有一条
   `id === 't1'`**（agent-teams-hardening / mutation-quality / unified-pipeline），
   其中两条 `updatedAt` 相差 **191ms** ⇒ 一次派发把 base **跨团队串写**进了
   unified-pipeline 的那条 t1。

⇒ **裁定**：这不是本分支引入的回归，而是**读数域被一次外来的跨团队同名 id 写入污染**。
`src/` 侧确有一条真缺陷（写错了对象），但它**不是本次改动造成的**，且在诊断阶段的
写域之外。⇒ 应拆成两件事：scripts 侧（臂该不该拿活的、被 gitignore 的仓库状态做断言）
与 src 侧（串写缺陷另立任务）分别裁定。

★★ **记在这里的理由**：这是一次**我自己犯的、本仓反复抓的那类错**——
用一次基础设施工况（worktree 里没有 `.agent-teams/`）伪造出一个关于代码的结论
（"这条分支弄坏了它"）。判据不是"两次跑出不同结果"，而是**先把 skip 与 pass 分开**：
`ℹ pass` 与 `ℹ skipped` 不同形。

### 2.2 ★ 其余六条的"预存在"判断仍成立（已复验）

我另行确认 `gate-falsification-pairs` / `gate-reviewed-passthrough` / `gate-stale-module` /
`gate-worktree-arrival` 在 main 上是**真失败**、**没有** skip 掩盖（四者的 `ℹ skipped` 均为 0）
⇒ 对它们"非本分支造成"的分类维持不变。

⇒ 因此 **(b) 类应从 5 条改为 4 条**，而 (c) 类**不再存在**。

---

## 3. 代码规模

| 区域 | 行数 |
|---|---|
| `src/**` 合计 | **47,310** |
| `src/gates/**` | 11,865（22 文件）|
| `src/tools/**` | 11,325（18 文件）|
| `src/client/**` | 6,735（24 文件）|
| `scripts/**` 测试 | **130 文件 / 81,210 行** |

单文件最大的几处（膨胀热点）：

```
src/tools/shared/entities.ts      4691
src/quality-gates.ts              2520
src/tools.ts                      2227
src/tools/update-task.ts          2066
src/mutation.ts                   1705      ← 未合并工作流，本次不动
src/client/ActivityPanel.module.css  61265 字节
src/client/activity-model.ts         48419 字节
src/client/ActivityPanel.tsx         37836 字节
```

---

## 4. 两条工作流为什么可以并行

实测：`src/client/**` 对 `src/gates/**`、`src/mutation*`、`src/quality-gates*`
的 import 数 = **0**。

```sh
grep -rn "from '\.\./gates\|from '\.\./mutation\|from '\.\./quality-gates" src/client/
# (无输出)
```

⇒ 模块/测试线（`scripts/**` + docs）与 UI 线（`src/client/**`）**写域不重叠**。

---

## 5. ★ 关于「构建陈旧」告警：已核实为**表观**陈旧

本会话中插件曾报：

```
[deployment] this process is running an OLDER build than the one on disk
  (loaded code built at 46eb6bc…, but HEAD is now b8f357e…)
```

**已实测澄清**：`46eb6bc` 就是 `HEAD~1`，而 `b8f357e` 是一个**只改 stamp 的提交**：

```sh
git show --stat b8f357e
#  lib/git-artifact-stamp.json | 6 +++---
#  1 file changed, 3 insertions(+), 3 deletions(-)
```

⇒ 载入的构建与 HEAD 之间**没有任何源码差异**，只有 stamp 指向自己这一点。
插件的**代码是当前的**；陈旧的只是 stamp 自身。

★ 记在这里的理由：这正是本仓反复抓的那类形态——**一个关于代码的结论，
由一次基础设施工况伪装出来**。若把它读成"插件是旧的所以拒绝不可信"，
就会去做一次毫无收益的重启；若把它**忽略**，则在真的陈旧时也会忽略。
⇒ 判据是 `git show --stat`，不是告警文本本身。

---

## 6. ★★ fork 与上游的真实冲突面（2026-10-15 实测，回答"同步上游有多痛"）

**方法**：冲突面 = **双方都改过**的文件。分叉点 `98aac03`（merge-base）。
★ 关键口径：**必须用 two-dot**（`98aac03 HEAD` / `98aac03 upstream/main`），
不能用 `upstream/main...HEAD` —— 后者算的是"从分叉点到 HEAD"，
对"deletions"会严重低报（见 §6.2 的实测对照）。

### 6.1 真正的冲突面：13 个文件

```sh
comm -12 <(git diff --name-only 98aac03 HEAD -- src/ | sort) \
         <(git diff --name-only 98aac03 upstream/main -- src/ | sort)
```

| 文件 | fork 侧 | 上游侧 | 风险 |
|---|---|---|---|
| `src/tools.ts` | +1673/−2018 | +395/−90 | ★★ 高（fork 大重写） |
| `src/quality-gates.ts` | +1295/−8 | +944/−68 | ★★ 高（双方各改近千行） |
| `src/scheduler.ts` | +737/−18 | +30/−3 | ★ 中 |
| `src/members.ts` | +663/−3 | +339/−50 | ★ 中 |
| `src/types.ts` | +653/−1 | +99/−0 | ★ 中 |
| `src/client/ActivityPanel.module.css` | +564/−345 | +11/−0 | 低 |
| `src/state.ts` | +439/−4 | +226/−10 | 低 |
| `src/harness-compat.ts` | +466/−0 | +80/−23 | 低 |
| `src/client/activity-monitor.ts` | +202/−2 | +6/−0 | 低 |
| `src/index.ts` | +187/−2 | +52/−4 | 低 |
| `src/snapshot.ts` | +184/−3 | +38/−2 | 低 |
| `src/client/ActivityPanel.tsx` | +94/−525 | +5/−0 | 低 |
| `src/profiles.ts` | +87/−2 | +9/−2 | 低 |

⇒ **只有两个文件是真正的高风险面**：`src/tools.ts` 与 `src/quality-gates.ts`。
其余 fork 的大宗新增（`entities.ts` +4691、`update-task.ts` +2066、`mutation.ts` +1705、
`worktree.ts` +1296、`gates/registry.ts` +1012 …）**上游从未碰过**（`−0`），不会冲突。

★ 这解释了 fork 的动机为何成立：**新增文件不冲突**，痛的是那两个被改写的上游文件。

### 6.2 ★ three-dot 陷阱（复核 F2，已实测对照）

文档 §8.1 曾用 `git diff --numstat upstream/main...HEAD` 却标成「同步冲突风险」：

```
quality-gates.ts   ...HEAD = +1295/-8      ← 文档用的（低报）
                   ..HEAD  = +1369/-958    ← 冲突风险应用的口径
```

逐个实测（`git diff --numstat upstream/main..HEAD` 对照）：

| 文件 | three-dot（文档） | two-dot（实际） | 低报 |
|---|---|---|---|
| `quality-gates.ts` | −8 | **−958** | ~120× |
| `members.ts` | −3 | **−342** | ~114× |
| `types.ts` | −1 | **−94** | ~94× |
| `harness-compat.ts` | −0 | **−80** | ∞（定性"只增不删"被证伪） |

★★ 这不只是数字错：它**推翻了"这些文件只增不删"的定性结论**，
而那正是判断"同步上游会不会撞车"的依据。

### 6.3 ★ 上游自 fork 以来新增、fork 未采纳的 4 个文件

```sh
git diff --name-status 98aac03 upstream/main -- src/     # ⇒ 恰好 4 个 A
git diff --name-status 98aac03 HEAD        -- src/ | grep '^D'   # ⇒ 空
```

| 文件 | 上游新增 commit | 日期 |
|---|---|---|
| `src/artifacts.ts` | `648fd9a` | 2026-10-10 23:35 |
| `src/workspace-audit.ts` | `648fd9a` | 2026-10-10 23:35 |
| `src/tool-policies.ts` | `f21f37c` | 2026-10-10 23:46 |
| `src/lineage.ts` | `38a84b9` | 2026-10-11 00:05 |

⇒ **正确类别是「上游有、fork 未采纳」，不是「fork 删除了上游文件」。**
fork 侧对上游文件的删除数 = **0**。
风险性质因此不同：这 4 个**可以干净合并**；真风险是"fork 至今没接进来"
（上游这 4 项能力在 fork 里不存在）。

★ 方法论教训（复核员提出，值得记牢）：
`comm -23` **命令本身没错**，错在**由集合差推出"fork 删了"** ——
**集合差无法区分「fork 删除」与「上游新增」**。要区分必须三向查
（分叉点 / 上游 / HEAD）并看 `--name-status` 的 A/D 字母。
