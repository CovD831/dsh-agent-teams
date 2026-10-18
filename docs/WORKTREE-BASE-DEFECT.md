# 隔离树从 HEAD 建、而下游看不见上游 —— 派活的最后一道结构性缺口

> 记录于 2026-10-19 04:1x（过夜运行期间）。
> 作者：captain。全部读数可复跑，命令逐条给出。

---

## 一句话

`implementation` / `repair` 任务各自从 **HEAD** 建隔离树；
而"任务 B 依赖任务 A"**不**让 B 的树包含 A 的提交。
⇒ 下游任务在**旧代码**上干活，且当两者写域重叠时，下游会**整文件覆盖**掉上游的修复。

---

## 代码位置（逐行）

| 事实 | 位置 |
|---|---|
| 建树的基版本是 HEAD | `src/worktree.ts:111 detectWorktreeSupport` → `const head = tryGit(repo, ['rev-parse', '--verify', 'HEAD'])`；`:120`；返回 `{ ok: true, base: head.value.trim() }` |
| 建树用那个 base，**不看依赖** | `src/worktree.ts:234 git worktree add --detach <path> support.base` |
| 调度器建树时不传任何上游信息 | `src/scheduler.ts:913 createTaskWorktree({ repo: workspace, taskId: ticket.taskId, teamId: team.id })` |
| 只有两种 kind 建树 | `src/types.ts:195 KINDS_NEEDING_WORKTREE = ['implementation','repair']` |
| 提交在树里做 | `src/tools/update-task.ts:1703 commitWorktree({...})` → `:1711 task.deliverableCommit = committed.commit` |
| **没有任何合回主干的动作** | `grep -rn "deliverableCommit" src/` 只有两处：`:1711` 写、`src/types.ts:684` 声明。**零读者**。 |
| 唯一的"合流"是判据，不是动作 | `src/worktree.ts:1170 const absorbed = isAncestor \|\| contentAbsorbed \|\| filesAbsorbed \|\| containedAbsorbed` —— 只回答"能不能删这棵树"，不负责把它合进去 |

---

## 实证（可复跑，30 秒）

在一棵一次性仓库里复现：

```bash
cd /tmp && rm -rf wt-probe && mkdir wt-probe && cd wt-probe
git init -q && printf 'line1\nline2\nline3\n' > f.txt
git add -A && git -c user.email=a@b -c user.name=a commit -qm init

# 模拟"任务 A"：从 HEAD 建树、改文件、提交
git worktree add --detach wtA HEAD -q
cd wtA && printf 'line1\nline2-MODIFIED-BY-A\nline3\n' > f.txt
git -c user.email=a@b -c user.name=a commit -qam "A change" && cd ..

# 模拟"任务 B"（依赖 A）：同样从 HEAD 建树
git worktree add --detach wtB HEAD -q
cat wtB/f.txt      # ⇒ line1 / line2 / line3  ——★ B 看不到 A 的修改
```

实测输出：`wtB/f.txt` 仍是 `line1\nline2\nline3`，`wtB` 的 HEAD 与初始 commit 相同。
⇒ **依赖边在这套机制里只表达"谁先做"，不表达"谁能看见谁"。**

---

## 真实语料里的规模

遍历 `.agent-teams/*/team.json`（6 个团队、425 任务体系中的主体）：

| 量 | 读数 |
|---|---|
| 同一团队内「实现任务依赖另一个实现/修理任务」的边 | **94 条** |
| 其中上游 `inScope` 与本任务重叠的边 | **60 条 = 63.8%** |
| 其中上游已有 `deliverableCommit` 的边（即上游真的提交了） | **47 条 = 50.0%** |

⇒ 约 64% 的实现→实现依赖边存在**写域重叠**风险；约 50% 的上游边**确实产生了提交**。
两个条件同时成立的那批，就是"下游在旧代码上改同一个文件"的现场。

复跑：

```bash
node -e '
const fs=require("fs"),path=require("path");
let edges=0,overlap=0,committed=0;
const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory()){if(["worktrees","inbox","archive"].includes(e.name))continue;walk(p);}
 else if(e.name==="team.json"){const t=JSON.parse(fs.readFileSync(p,"utf8"));
  const byId=new Map((t.tasks||[]).map(x=>[x.id,x]));
  for(const task of (t.tasks||[])){ if(!["implementation","repair"].includes(task.kind))continue;
   for(const d of (task.dependencies||[]).map(x=>byId.get(x)).filter(Boolean)
        .filter(x=>["implementation","repair"].includes(x.kind))){
    edges++; if((task.inScope||[]).some(p=>(d.inScope||[]).includes(p)))overlap++;
    if(d.deliverableCommit)committed++;}}}}};
walk(".agent-teams");
console.log({edges,overlap,committed});'
```

---

## 为什么它不是"小问题"

它把两个不同的东西压进了同一个词：

```
"依赖 A"  读起来是   A 做完之后我能接着做
真实语义  只是     A 做完之前我别开始        ← 代码我看不见
```

这与本仓已经记过的那一类缺陷**同源**（`failureKind` 记录上一代、
`status` 同时承载 exit 0 与"无新增失败"、`changedPaths` 同时承载"我改了什么"与"盘上有什么"）：
**一个字段承载两种事实**。这里是"依赖边"同时承载了**顺序**与**可见性**。

而它的后果不会被判据抓住：下游任务在自己的树里跑 verify **全绿**——
它测的是"旧代码 + 我的改动"，当然绿。绿完之后它的提交会把上游的修复整文件盖掉，
而两个任务在任务记录里都是 `completed`。

这正是 `src/scheduler.ts` 里已经写下过的那条实测（我这次没有重新触发它，只复述原文）：

> ★ MEASURED（本次并入实测）：t24 的 `src/scheduler.ts` 覆盖了那一行，
>   把它退回硬编码 —— 因为两个任务改同一个文件、而并入是整文件的。
>   ⇒ ★ "整文件覆盖"会让【另一处已经落地的修复】静默消失。

---

## 第二个缺口：产品里没有 integrator

`grep -rn "integrator" src/` 的 10 处命中里：

- `src/tools/update-task.ts:459` 措辞写「the trunk has not absorbed it yet, so this is the expected answer **until an integrator merges it**」
- `src/tools/update-task.ts:1813` 写「there is nothing for **an integrator** to merge」

⇒ 代码反复引用一个**不存在的角色**。`deliverableCommit` 有写者无读者，
`KINDS` 里没有 `integration` 建树，也没有任何一处把树的提交合回主干。

（这与 unified-pipeline 队里那条已诊断未派活的 **I1「integrator 这一环不存在」** 是同一件事。）

---

## 对本次过夜运行的直接影响（不是理论）

我原本设计的 DAG 里 `t2 → t3 → t4` 三条都改 `src/tools/update-task.ts`：

```
t2  完成判定吞 blocker        ~:1451 + create-task.ts:983
t3  归因记错代                ~:1636 appendExecution
t4  commandsRun 自相矛盾      ~:800 schema
```

三处在**不同代码区**，`git merge` 应当能干净合并 —— 但**机制不会替你合**。
⇒ 若不补这一步，三条提交各自躺在三棵隔离树里，主干上**一条都没有**；
集成任务的读数会显示"什么都没变"，而三条任务都记 `completed`。

**本次处置**：captain 充当 integrator —— 每件实现通过审查后，把它的
`deliverableCommit` 真正合进主干，再让下游与集成任务在**已含前序改动**的主干上跑。
这一步在做，且**必须被记录**：它是人（或队长）在替产品补一个不存在的环节，
不是自动化的一部分。

---

## 值得修的方向（记下来，不在本次范围内）

三条互斥程度递增的选项：

1. **建树时按依赖取 base**：`createTaskWorktree` 接一个 `base?: string`，
   调度器在依赖全部有 `deliverableCommit` 时传最早那个（或按拓扑序取最后一个）。
   最小改动，但仍要求依赖的提交已经在同一个可 reach 的历史里。
2. **把依赖产物先合进来再建树**：调度器在 `needsWorktree` 分支里，
   对本任务的直接上游做 `git cherry-pick` / `merge`，失败则**拒绝派发**并说明
   冲突在哪（而不是让下游在旧代码上闷头干）。
3. **让 `deliverableCommit` 有读者**：现在它对调度器完全不可见。
   哪怕只是"下游建树时若上游有未合入的 commit 就报 `unmeasured`"，
   也比让两个任务都记 `completed` 而主干什么都没有要好。

★ 三者都需要一个**能判断"合入了没有"**的读数；而那个读数已经存在于
`src/worktree.ts:1170` 的 `absorbed` 三元组里 —— 它今天只用于"能不能删"，没有被用于"派活前检查"。

---

## 补充（2026-10-19 05:15，过夜运行实测）

### 第二个面：建过的树**永远不会重新对齐**

`src/worktree.ts:224-232`（`createTaskWorktree`）：

```ts
// 已经建过 ⇒ 复用（重试一个任务的同一个 attempt 不该炸）
if (existsSync(join(path, '.git'))) {
  const base = tryGit(path, ['rev-parse', 'HEAD'])
  return { ok: true, path, base: base.ok ? base.value.trim() : support.base, ... }
}
```

⇒ **一次建树，永不再对齐。** 重派任务时 `git worktree add` 那一步被跳过，
树的 HEAD 还是**第一次建树时**那个 sha。它的 mtime 会变（复用路径也写文件），
所以「mtime 比某个提交晚」**不能**证明树含那个提交 —— 这一格骗过了一次排查。

### 实测

| 任务 | 树 HEAD | 建树时刻 | 主干当时 HEAD |
|---|---|---|---|
| t1 | `e1ef3b7` | 04:52:10 | 已是 `48d3418`+ |
| t2 | `e1ef3b7` | 04:10:56 | `e1ef3b7`（当时对） |

⇒ t1 的树**晚于** `c01fdb4`(04:49:31) 被建，却停在 `e1ef3b7`(04:04:37)：
因为复用路径直接返回旧 HEAD。两个成员各自独立探测到这一点并拒开工 ——
这个拦截是对的。

### 实害（成员实测，比"树旧了"严重得多）

`git log --oneline e1ef3b7..HEAD -- <t2 七个 inScope 路径>` 只返回 `9720ca9`，
而它改的正是 t2 inScope 里的 `src/tools/update-task.ts` 与 `lib/tools/update-task.js`：

- 陈旧基 `grep -c liveAgentOf src/tools/update-task.ts` = **0**
- 主干同文件 = **3**；`git diff --stat e1ef3b7 HEAD -- lib/tools/update-task.js` ⇒ `7 insertions(+), 16 deletions(-)`

⇒ worker 按 inScope 整文件写那个文件，会**静默回退**
「inactive context 不该读成回合失败」的修复。两个成员都因此拒派 worker。

### 今晚的绕行（队长执行）

两棵树 `git status --porcelain -uall` 均为 0 行后，逐树
`git checkout --detach $(git rev-parse HEAD)`，核 `merge-base --is-ancestor`
对 `c01fdb4`、`9720ca9` 均为 YES。⇒ 树在 `0e2fadb` 上，含全部上游改动。

### 应当的修法（没做，需人拍板）

复用分支必须判「树的 HEAD 是不是当前 base 的祖先」，不是就**重建**或
**FF 到当前 base**。难点是脏树：worker 可能正有未提交改动，
静默 FF 会盖掉它们 —— 所以三态：`clean-and-behind` ⇒ FF；
`dirty` ⇒ 拒绝派发并报「树脏、基底落后」；`already-current` ⇒ 直接用。
把它写成三态而不是一个 `if`，正是本仓反复记过的那条教训。
