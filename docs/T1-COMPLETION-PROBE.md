# t1 的 completion.mutation：一次**补测量**（t13）

> **读数**：`scripts/gate-t1-completion-probe.test.mjs`（6 臂，exit=0）
> **本文回答**：t1 的那次拒绝 `改动行范围 …:5-5 里没有一条可计分变异体` 是
> **一条关于交付的结论**，还是**一次缺了输入的测量**？

---

## 〇、一句话

> **判据在有一个 base 的时候，它真的跑了 —— 而且它给出的裁决是 `blocked`，
> 不是 `unmeasured`。原来那条 `unmeasured` 是【缺 base 那一格】造成的。**

```
缺 base  ⇒  unmeasured（"这次测量无话可说"）
有 base  ⇒  blocked，mutation score 0.5 < 0.6（63/126 存活）
```

★ 两条**都是判据自己说的**。区别只在**有没有那个 base**。

---

## 一、★★★ 补测量的结果（判据自己的裁决）

> ★★ **本节是一份【冻结的读数】** —— 它说的是**交付那一刻**的 t1 检出
> （`2 files changed, 1536 insertions(+), 58 deletions(-)`，基线 `ba321305baae`）。
>
> ★ 而 t1 的检出**是会动的**：本任务交付之后，`pipeline-author` 按 §一 的结论补测试
> ⇒ **同一个判据的裁决已经翻过一次面**。三次实测（同一命令）：
>
> | 时刻 | 交付规模 | changedLines | mutants | `completion.mutation` 的裁决 |
> |---|---|---|---|---|
> | 交付那一刻（本节） | 1536 insertions | 1025 | 126 | **blocked**（score 0.5 < 0.6） |
> | 中途 | 1839 → 1899 | 1313 → 1373 | 136 → 141 | `unmeasured`（套件正红，编辑中） |
> | ★ **t15 落地之后** | 1899 insertions | 1373 | **163** | ★ **`ok`**（score ≥ 0.6） |
>
> ⇒ ★★ **判据没有变，变的是它量的那棵树。** 而这一列本身就证明了一件事：
> **判据会跟着交付一起动** —— 它不是一条"一次通过就永远通过"的门。
>
> ★ **下面的每一个数字都属于"交付那一刻"，不属于"永远"** —— 而这是**对的**：
> 判据说的话是**对某一棵树**说的，把它当常数才是错的。
>
> ★★ 而夹具本身**不冻结**：它每次**重新量**当前那一棵树（臂 1/3 都是实测），
> 所以它在检出变化之后**仍然是绿的**（7/7）。**这才是它该有的形状** ——
> 一个把 `126` 写成常数的夹具会在 t1 一改就红，而那个红是**假的**
> （它测的是"t1 没变"，不是"判据没跑"）。
> ★ 而它的臂 2 走**三态分支**（ok / blocked / unmeasured 都接受并如实打印）
> ⇒ 上面那三次**不同的裁决**它一次都没有误报成"夹具坏了"。

在一个**持有 `taskWorktreeBase` 的进程**里，走生产接线
（`wireCompletion` ← `src/tools/update-task/completion.ts`）为 t1 求值 `completion` 位置：

```
workspace   = .agent-teams/worktrees/task-t1          ← t1 的交付就在这里（【未提交】）
base        = ba321305baae…（resolveBaseRevision ⇒ { kind: 'resolved', from: 'memory' }）
changedLines= 1025 行（64…2454）
位置裁决    = evaluated=4  skipped=0  registered=4
ran         = [ verify-rerun: ok
                r5:            blocked
                mutation:      blocked  ← ★ 本任务问的那一条
                backtest:      blocked ]
```

### `completion.mutation` 原话

```
[completion.mutation] the delivered tests are decorative on the lines this task changed:
    mutation score 0.5 < 0.6 (63/126 mutant(s) survived)
[completion.mutation] survivor: gt-to-ge@L2070 in scripts/friction-triage.mjs (often-equivalent, still scored)
[completion.mutation] survivor: gt-to-ge@L2083 … / @L2094 … / @L2101 …
[completion.mutation] survivor: and-to-or@L2128 in scripts/friction-triage.mjs
[completion.mutation] survivor: and-to-or@L2262 in scripts/friction-triage.mjs
[completion.mutation] survivor: true-to-false@L2178 in scripts/friction-triage.mjs
[completion.mutation] survivor: plus-to-minus@L1507 in scripts/friction-triage.mjs (often-equivalent, still scored)
[completion.mutation] ...and 55 more survivor(s)
[completion.mutation] coverage: scripts/friction-triage.mjs, scripts/friction-triage.test.mjs
    lines 64-2454 (2391 line(s) in range, 126 mutant(s) considered, 126 scored)
```

### ★ 生/存与杀手套件的读数

| 读数 | 值 |
|---|---|
| 可计分变异体（scored） | **126** |
| 杀死（killed） | **63** |
| 存活（survived） | **63** |
| 杀伤率 | **0.5**（阈值 0.6） |
| 裁决 | **blocked** |
| 杀手套件 | `scripts/friction-triage.test.mjs` |
| 探针射程 | **够得到**（两个被变异文件的 basename 都出现在套件文本里）|
| 基线 | 绿（`ℹ pass 65 · fail 0`，exit=0）|

★ 判据**跑了 126 次套件**（每个变异体一次），整条臂耗时 **82 秒** ——
这是"真的测过"与"判据说测不了"在**时间**上的区别。

---

## 二、★★★ 一个被两方都算错的数字（本任务纠正它）

成员报过「114 条可计分变异体」，captain 复算得 542+589 ——
**两个都不对**，因为它们数的都是 `git diff` 的 `+` 行数。

| 口径 | 值 | 它是什么 |
|---|---|---|
| `git diff` 的 `+` 行数 | **1536** | **文本行的规模**（两个人数的就是它）|
| `changedLineNumbers(base)` 的长度 | **1025** | ★ **判据看到的那一格** |
| `generateMutants()` 合计 | **126** | ★★ **真正进分母的那一个** |

逐文件：

```
scripts/friction-triage.mjs       文件内改动行  839  ⇒ generateMutants  66
scripts/friction-triage.test.mjs  文件内改动行 1025  ⇒ generateMutants  60
```

★ 为什么三者**必须**各自可读：把任意两个合成一个数，就会让
「**改动很大**」与「**改动很可测**」在下游**同形**。

★ 而 `changedLineNumbers` ≠ `+` 行数**是必然的**，不是巧合：
它数的是 `git diff --unified=0` 里 `@@ … +start,count @@` 的**新文件行号**，
而 `+` 行数只数新增的文本行 —— 被**删除**的行所在的位置也占了新行号。

---

## 三、★★★ 根因链：`baseRevision` 为什么缺席（逐跳复核）

captain 给的链**成立**，逐跳都独立复核过：

| # | 位置 | 事实 | 本任务怎么核的 |
|---|---|---|---|
| 1 | `src/tools/update-task.ts:429` | `resolveBaseRevision(task)` 被调用 | 读源码 |
| 2 | `…/team.json` 的 t1 记录 | **没有 `baseRevision` 这一格** | 直接读 JSON：`Object.hasOwn(t1,'baseRevision') === false` |
| 3 | `src/tools/shared/entities.ts:306` | `taskWorktreeBase` 是一个 **Map**，只在派发建 worktree 的进程里写 | 读源码 + `documented` 于 `src/tools.ts:242` |
| 4 | `entities.ts:518` | `changedLineNumbers(ws, undefined)` **首行守卫直接 return undefined** | 实测：`undefined` 与 `''` 都返回 `undefined` |
| 5 | `gates/completion/mutation.ts:275` | ⇒ 判据第一格就返回 **`unmeasured`** | 实测：缺 base 时判据说"the changed-line ranges … could not be established" |
| 6 | `src/tools/update-task.ts:700-706` | `if (unmeasured !== undefined) throw…` / `throw…` —— ★ **两个分支都 throw** | 读源码；实测拒绝信息里带 `[deployment]` 那一行（`throwWithSurface` 的产物） |

### ★★ 而第 2 跳的**成因**：**未定**（本任务第一版给了一个**错的**成因，已撤）

`persistTaskBaseRevision`（`src/tools.ts:260`）是**唯一**把 base 落盘的地方，
而它由 `scheduler.onWorktree` 触发（`src/scheduler.ts:857`），而 `onWorktree` **只在真的建出 worktree 时**被调用。

```
① 内存那份：`taskWorktreeBase`（`entities.ts:306`）—— 只在建出 worktree 的那个进程里写
② 耐久那份：`persistTaskBaseRevision`（落进 team.json 的 `baseRevision`）
⇒ 两条路都没落上 ⇒ resolveBaseRevision ⇒ { kind: 'absent', reason: 'not-recorded' }
```

#### ★ 撤掉的那一条（第一版写错了，留在这里当记录）

第一版我写的是：

```
t1.updatedAt = 14:53:21  <  task-t1 检出建立 = 14:56:13
⇒ 那次 update 被评估时 worktree 还不存在 ⇒ onWorktree 从没为 t1 触发过
```

★★ **这条不成立，已撤。** 实测（git 自己的元数据）：

```
.git/worktrees/task-t1/HEAD  mtime = 2026-10-08 14:24:17   ← 检出建立
.agent-teams/worktrees/task-t1/.git = 2026-10-08 14:24:17
t1.createdAt                        = 2026-10-08 13:56:59
t1.updatedAt                        = 2026-10-08 14:53:21   ← 被挡住的那次 update
```

⇒ ★ 检出**早于**那次 update **29 分钟** ⇒ **worktree 当时是存在的**，
`onWorktree` 的触发条件（`created.ok === true`）**不因时间而不成立**。

★ 而我那个 `14:56:13` **复现不出来**（`.git/worktrees/task-t1` 目录 mtime 是 14:24，
后来被别的写动过；`.git` 文件是 14:24）。**一个复现不出来的读数不是读数** ——
这正是本队那条「读数必须能重跑」的纪律，而第一版违反了它。

#### 成因的两类候选（**都未证实**，写在这里而不是选一个）

```
候选 A（captain 提出）：`STATE_DIR_FOR_BASE_PERSIST` 是模块级变量
  （src/tools.ts:1696 赋值，:261 读），落盘那一刻 `root === undefined` ⇒ 静默 return。
  ★ 实测：赋值（:1696）**早于** `installTeamScheduler`（:1697）⇒ **同一次装配内 root 已就位**。
  ⇒ 这条只在"派发发生在装配之前"或"装配它的实例与派发它的不是同一个"时成立，
    而这两种情形**本任务没有证据**（需要当时那个进程的 PID / cwd，已不可得）。

候选 B：`readdir(root)` 列出的目录里没有那个团队 —— 落盘是**逐团队**扫的
  （`src/tools.ts:260-280`），而 `root` 由 `process.cwd()` 拼出。
  ⇒ 若那一刻的 `cwd` 不是主树（例如是某个 worktree），扫的就是另一棵 `.agent-teams/`。
  ★ 同样**没有证据**（当时的 cwd 不可得）。
```

★★ **所以正确的写法是：成因未定，两类候选见上，而两者都需要"当时那个进程的 cwd / PID"才能判定 ——
那个事实没有留下任何痕迹。** 而这本身就是一条读数：
**`baseRevision` 的缺席在事后无法归因**（见下面 §3 的修法②，它正是冲着这一格去的）。


### ★ 是否可修？—— **可修，且修法不在判据里**

```
✔ 可修。三条互不冲突的路，都不需要动判据的 unmeasured 语义：

①【最小，且最对症】评估时**不要只信一个来源**：
   `resolveBaseRevision` 已经有"内存 → 记录"两段；
   而 t1 这种情形下 base 其实**推得出来**（worktree 的 HEAD 就是它被切出来的那个提交）。
   ⇒ 但"推"有风险：worktree 的 HEAD 会随成员自己的提交前进 ⇒ 推出来的是**错的** base。
     ★ 所以正确的形式是：**评估时若发现没有 base、而 worktree 存在，就报一条
      "缺失的 base"的可读读数**（而不是让它退化成一句 `unmeasured`）。

②【治本】把 base 的登记**与 worktree 的建立解耦**：
   `onWorktree` 不触发时（无论成因是 A 还是 B）落一条 **`baseRevision: null`**
   （"明确没有"）而**不是什么都不写**。
   ⇒ 于是 `resolveBaseRevision` 能分辨第三种：`no-worktree` / `not-recorded` /
     **`never-registered-despite-a-worktree`**。
   ★★ 而这一条**正是冲着上面"成因未定"那一格去的**：现在的事后归因**不可能**
     （需要当时那个进程的 cwd / PID，而那没留下痕迹）；落一条 null 之后，
     "本该有而丢了"与"明确没有"就**分得开**了。

③【与 t13 无关但同样成立】`src/tools/update-task.ts:700-706` 那两个分支
   —— 它把 `unmeasured` 当拒绝对待，而 `unmeasured` 是**"我没能测量"**。
   ★ 判据的语义是对的（`unmeasured` 就是不能当成 ok）；要修的是**调用方的措辞与出路**：
   现在它给不出"补哪一格就能过"的线索，读的人只会以为交付有问题。
```

★ **不可修的部分（如实说）**：那条 `unmeasured` **不能**被放宽成 `ok` ——
一个没有 base 的变异测量确实**无话可说**（全文件变异会扭曲分母，
而这是 `mutation.ts` 文件头用一次实测立的规矩）。这一格**必须**保持 unmeasured。

---

## 四、★★ 一条**独立发现**的挡路缺陷（只报告，不修）

### `update_task` 的 **dispatch** 位置把「判据没说话」读成了拒绝，且消息是**空的**

实测（本探针第 3 次跑到它）：

```
registry.evaluate('dispatch', { …没有任何判据适用… })
  ⇒ { ok: false, blockers: [], unmeasured: undefined,
      evaluated: 0, skipped: 2, registered: 2,
      skippedAll: 'none of the 2 gate(s) registered at "dispatch" applied to this context;
                   nothing was evaluated, so this step was not checked' }
```

而 `src/tools/update-task.ts:398`（dispatch 那一处）与 `:700`（completion 那一处）的形状**逐字相同**：

```js
if (gates.ok === false) {
  const msg = gates.unmeasured !== undefined
    ? `update_task rejected: the … gate could not measure (${gates.unmeasured})`
    : `update_task rejected: ${gates.blockers.join('; ')}`   // ← blockers 是 [] ⇒ msg 是一句空话
  throwWithSurface(msg, …)                                    // ★ 两个分支都 throw
}
```

**实测到的拒绝原文**（一次 `in_progress` 的更新）：

```
update_task rejected:
[deployment] this process holds the current build
```

★ 「拒绝」后面是**空的** —— 因为 `blockers` 是 `[]`。

### 它与 `docs/HANDOVER.md` 第五节的关系

那里记着同一条在 **delivery** 位置被 t64 修过（"an unchecked step must not read as a refusal"）。
本任务实测：**dispatch 与 completion 两处仍是同一形状**。

★ 本任务是 verification，**只报告不修**（`src/` 是 outOfScope）。

---

## 五、★ 三态如实：本任务**没有**把任何一格并进另一格

| 态 | 本任务的读数 | 落在哪里 |
|---|---|---|
| **ok** | ✗ 不是这一态 | — |
| **blocked** | ★ **有 base 时**：`mutation score 0.5 < 0.6 (63/126)` | 臂 2 |
| **unmeasured** | ★ **缺 base 时**：`the changed-line ranges … could not be established (no git evidence)` | 臂 4 |

★ 而**两者**都是本任务**实测**出来的，**不是推断**：

* 臂 2 在**有 base 的活进程**里拿到 `blocked`（判据跑了 126 次套件，82 秒）；
* 臂 4 把同一个判据在**缺 base** 时跑一遍 ⇒ 拿到 `unmeasured`，且它**不带** `blockers`、
  **不带** `mutationScore`、**不带** `survived` —— 两态在**形状上**就不同。

★ 这正是本任务要纠正的那个合流：**t1 收到的 `unmeasured` 从来不是一条关于交付的结论。**

### ★ 而本任务**不能**声称的（射程边界）

```
① 它不能声称"t1 的交付是装饰性的" —— 那是一个**关于那份交付的判断**，
   而判据只说了"在它看到的改动行上，杀伤率是 0.5"。
   ★ 而"改动行"这一格本身依赖 base 的正确性，本任务的 probe 用的是
     rememberWorktreeBase(t1, HEAD) —— 与生产同一个入口，而**值**是探针选的。
   ★★ 所以正确的读法是：**判据真的会跑**，而它跑出来的分数是 0.5。
     至于 0.5 这个数是不是 t1 应得的，取决于它被派发时的真实 base ——
     而那**不在盘上任何地方**（见 §3 第 2 跳）。

② 它不能声称覆盖了 t1 在生产进程里的那一次调用 —— 本探针是**另一个进程**。
   ★ 两者共享的是【同一份代码 + 同一个入口 + 同一个 base 的来源形式】。

③ 它不能声称 `completion.r5` / `completion.backtest` 的裁决是对的 ——
   本任务只为 mutation 补测量，另两条（r5 blocked / backtest blocked）
   只作为**同一次求值的读数**被记下，没有被独立验证。
```

---

## 六、臂一览（`scripts/gate-t1-completion-probe.test.mjs`，6/6 绿）

| 臂 | 它钉什么 | 实测 |
|---|---|---|
| **1** | 前置：t1 的交付在它自己的检出里，且有真的 base | 1536 insertions / base `ba321305baae` |
| **2** ★核心 | **在有 base 的进程里**取判据自己的裁决 | `blocked` · score 0.5 · 63/126 · 82 秒 |
| **3** | 实测可计分变异体数（**`generateMutants()`**，不是 `git diff` 行数） | 1536 / 1025 / **126** |
| **4** ★反向半边 | 缺 base ⇒ `unmeasured`，且与 `blocked` **不同形** | 不带 blockers / 分数 / 存活数 |
| **5** | `resolveBaseRevision` 两种"没有"的成因**不同形** | `no-worktree` vs `not-recorded` |
| **6** | dispatch 位置把「没说话」读成拒绝，且消息为空（只报告） | 实测确认 |

### ★ 它被 `test:gates` **真的收进去了**（否则等于没有）

★ 文件名以 `gate-` 开头，所以它命中 `scripts/gate-*.test.mjs` 那个 glob ——
**不需要改 `package.json`**（那不在本任务的写域里）。
`docs/START-HERE.md` §2③ 记过这件事：**一个没有人跑的夹具，与不存在的夹具在观测上完全相同。**

```
node --test scripts/gate-t1-completion-probe.test.mjs
  ⇒ tests 6 · pass 6 · fail 0 · skipped 0 · exit=0

pnpm test:gates（含本夹具）
  ⇒ tests 1089 · pass 1046 · fail 16 · exit=1
     ★ 而基线（把本夹具移走、其余一字不动）**也是** 1089 / 1046 / 16
```

### ★★ 关于 exit=1：那 16 条是**存量**，不是本任务引入的

★ 本任务的 `verify` 第三条是 `pnpm test:gates`，它的读数**必须如实**：

```
把本夹具【移走】，其余一字不动，连跑同一套夹具 ⇒ fail 16（与本夹具在场时逐条相同）
把本夹具【放回】                                  ⇒ fail 16
⇒ ★ 失败集合【完全相同】（只有耗时那一列不同）
```

★ 而仓库本身的这套夹具**在本轮里是不稳定的**（实测：同一命令连跑三次，
`tests` 分别是 1089 / 961 / 981，`fail` 分别是 16 / 29 / 22）——
**而这个不稳定与本夹具无关**：把本夹具移走后连跑，同样得到 1089/16 与 1065/30。

★★ 本夹具在**所有 8 次运行里**的失败数都是 **0**。

### 一条**只有跑才现形**的坑（写在这里，因为它会让读数变成假的）

★★ 本夹具自己跑在 `node --test` 里，而 `NODE_TEST_CONTEXT` 会让**孙进程**
（判据起的那个 `node --test <suite>`）变成**子报告器** —— 它不再打印 `ℹ pass N` 汇总行
⇒ **判据读不到汇总 ⇒ 它诚实地报 `unmeasured`**：

```
[completion.mutation] the killer suite did not report a readable summary (exitCode 0),
    so the kill rate could not be computed
```

★ 而这条**看起来完全像**"套件真的够不到" —— 也就是**探针的失败伪装成被测物的结论**。
⇒ 修法：子进程环境里清掉 `NODE_TEST*` / `NODE_OPTIONS`
（与 `scripts/gate-mutation.test.mjs` 记的那条**同源**）。

★ 本任务第一次跑出来的正是这个 `unmeasured`，**差点被记成"判据测不了"** ——
而它其实是夹具自己造成的。**这就是为什么"没测到"必须能与"测了而不过"分形。**

---

## 七、本任务**没有**做什么（边界）

```
① 没有改 t1 的交付物（那是 pipeline-author 的写域）
② 没有改判据本体（`completion.mutation` 的 unmeasured 语义是对的）
③ 没有改 src/ —— §3 的修法与 §4 的缺陷都是【只报告】
④ 没有"人放行"：本任务做的恰恰相反 —— 它让**判据自己**测了一次
⑤ 没有把 t1 的状态改成 completed —— 本任务产出的是**读数与结论**，不是修法
```

---

## 八、★ 一句与全文同源的话

t1 撞上的那条拒绝**读起来像**一条关于交付的结论，而它是**一次缺了输入的测量**。

> **"这次测量无话可说"与"这次交付有问题"在读数上必须不同形。**

★ 而本任务补上的正是那个**缺掉的输入** —— 补完之后，判据说了完全不同的一句话。
