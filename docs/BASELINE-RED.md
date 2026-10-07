# 基线为什么是红的：24 条既有失败的逐条归类

> **这份文件的读者是下一个会话。** 它回答一个问题：`pnpm test:gates` 在这条 HEAD 上
> 不是全绿，**而那 24 条各自是什么**。
>
> 为什么必须有这份文件：`completion.backtest` 的判据是"基准必须先绿，否则无法归因"。
> 而基线上有 24 条红 ⇒ 它拒判**每一个**任务，理由读起来像"这次改动弄坏了东西" ——
> ★ 那是本队记账的形态：**一个关于代码的结论，由一次基础设施工况伪装出来。**
> ⇒ 而"哪些是真缺陷、哪些是夹具过期、哪些是环境"这件事，
> 只有**人读过一遍**才写得出来，而它必须写下来（否则每个会话都要重读一次）。

---

## 0. 一句话结论

```
起点   24 条
结果    5 条
⇒ 本次消掉 19 条，而其中：
    · 1 条  真实的出口缺陷（拒绝不说什么事 —— 本次修掉的那个）
    · 15 条 夹具过期（口径被 t54/t58 有意改掉，而臂没跟上）
    · 3 条  环境（worktree 缺 gitignored 的 .agent-teams/）
```

★ 而**剩下的 5 条里有 2 条不是夹具过期、也不是环境** —— 那是**真实的缺陷**，
留给各自的任务（见 §3）。

---

## 1. 本次修掉的（19 条）

### 1.1 出口缺陷：拒绝**不说什么事**（1 条，本任务的第一交付）

```
症状：`update_task rejected: ` —— 冒号后面**空的**
根因：位置级聚合有**第三种** ok:false
        ok:false · blockers:[] · unmeasured:undefined · skippedAll:在场
      而消费它的两个出口（dispatch / completion）**只读前两者**
      ⇒ 模板插出来一个**空尾**
```

★ 它直接违反本队那条纪律：**拒绝必须说清为什么**。
★ 而它的坏法是记账过的那一种：读数**在场且可读**（`skippedAll` 是一句人话），
而**出口没读它** ⇒ "这一步没被检查"在错误信息里退化成"什么都没说"。

修法（`src/tools/update-task.ts`，两处）：三态各自成句，且**绝不产出空尾**。

### 1.2 调用点把"没检查"读成了"拒任务"（本次修的第二件事，而它**是 t58 自己开的单**）

`t58` 把「有判据却一条没跑」从 `ok:true` 改成 `ok:false`（**对的**：没检查不许读成通过），
而它在 `scripts/gate-position-verdict.test.mjs` 臂 4 里**逐字**记下了后果与修法：

> 「只改注册表，会把"没检查却报通过"换成"**没检查却拒任务**"。
>   而"这一轮没有适用的判据"本来**不该**拒绝任务（t13 明确要求保住的边界）。
>   ⇒ 本任务 inScope 只含 `registry.ts` —— **不含 `src/tools/`**
>   ⇒ 调用点的同步改动必须拆到另一张契约里。
>   ★ 而这一臂会在**那件事做完之后**翻转。」

⇒ **本任务就是那件事。** 修法：`skippedAll` 在场时 **只说、不拒**
（与输入面缺格那条纪律同形），并照旧写进卡点记录 + 一条 warn。

★ 而它**没有退化成沉默**：三态仍然可辨 —— 有 blocker ⇒ 拒；没测量 ⇒ 拒；**没检查 ⇒ 过、但记下**。

### 1.3 夹具过期：口径被有意改过，而臂没跟上（15 条）

| # | 夹具 | 过期的那一句 | 被谁改的 |
|---|---|---|---|
| 1 | `gate-registry.test.mjs` ×3 | `skipped.ok === true`（"全跳过不翻成 ok:false"） | t58 |
| 2 | `gate-admission-point.test.mjs` | 同上 | t58 |
| 3 | `gate-admission-checkpoint.test.mjs` | 同上 | t58 |
| 4 | `gate-admission-absorb.test.mjs` | 同上 | t58 |
| 5 | `gate-position-verdict.test.mjs` | 臂没注入 kind 需求表 ⇒ 四个 kind 读数**一模一样** | t54 |
| 6 | `gate-r5.test.mjs` | `verification 不该被 R5 管`（而表说它要） | t54 |
| 7 | `gate-kind-requirements.test.mjs` | 反向半边的前提（`verification 不要求 r5`）已过期 | t54 |
| 8 | `gate-index-assembly.test.mjs` | `logsGaps` 用 **80 行窗口**取代理读数 | 本次插入 4 行即打红 |
| 9 | `verify-runtime-integration.test.mjs` ×3 | 见 1.2 | t58 |

★★ 而第 8 条值得单独看，因为它是**代理读数**（j-0003 的原形）：

```
原写法： const window = lines.slice(index, index + 80)
         logsGaps = new RegExp(`${varName}\\.missing`).test(window)
```

我在同一文件里加 **4 行注释** ⇒ 那句日志从偏移 84 行处掉出窗口 ⇒ `logsGaps` 变 false ⇒ 臂红。
**而日志一个字都没少。** ⇒ 它测的是"两次出现的**距离**"，而它声称测"日志还在不在"。
修法：按**归属**取（全文找 `<varName>.missing`）—— 那**没有放宽**：
删了日志 ⇒ 全文找不到 ⇒ 仍红。

---

## 2. 环境（3 条，**不是**缺陷）

| 夹具 | 症状 | 成因 |
|---|---|---|
| `moment-facts.test.mjs` 臂 1 | `台账目录不存在：…/task-t69/.agent-teams/frictions` | `.agent-teams/` 是 **gitignored** ⇒ 干净检出里没有它 |
| `verify-task-atomicity.test.mjs` 臂 6 | `读不到语料 .agent-teams/planning-loop/team.json` | 同上 |

★ 而这两条**在队长工作区里是绿的**（那里有台账）—— 也就是说它们**只在隔离 worktree 里红**。
★ 而"夹具因为环境而红"与"夹具因为口径而红"必须**不同形**：前者的补救是**准备 worktree**，
后者的补救是**改夹具**。本文件把它们分开列，就是为了这个。

---

## 3. 剩下的 5 条：**2 条是真缺陷**，各自留给它的任务

### 3.1 ★ `verify-task-atomicity.test.mjs` 臂 4 —— 一个**真实的**形状检查缺陷

```
· ["src/registry.ts","src/index.ts"]          ⇒ ok
· ["src/registry.ts","src/index.ts","src/"]   ⇒ blocked
```
★ 两边**工作完全相同**（都只改目录下已有的两个文件，都不新建目录），
唯一的差别是第二个字符串以 `/` 结尾。

⇒ 判据说它判的是「会不会创建/重组一个目录」，而它实际判的是**字符串的最后一个字符**：
`task-atomicity.ts` 只做 `path.trim().endsWith("/")`，从不检查那个路径是不是目录、
是不是新建的、甚至是不是存在的路径。

★ 这是本队记过的**「换了名字的形状检查」**：检查的东西读得出，而它与它声称要判的东西无关。
★ 而 `src/` 那一侧**不在本任务写域**（inScope 只列 `src/tools.ts`）⇒ 留给它的任务。

### 3.2 ★ `verify-gate-tristate.test.mjs` 臂 0 —— 普查把数据文件当成判据模块

```
★ lib/gates/completion/kind-requirements.js 缺少导出 "id" —— 它不是一个完整的判据模块，
  普查会把它的缺陷当成"没有这一条"
```
★ 而那个文件**本来就不是判据**（它是 t54 的**数据表**，被放在判据目录旁边）⇒
普查的口径要能区分"判据模块"与"同目录的数据文件"。
★ 本任务改了那条普查的**取法**（见 1.3 第 8 条），而这一条是**另一件事**，留给它的任务。

### 3.3 `gate-friction-capture.test.mjs` 臂 4 —— 记录**不可重放**（值得单独立项）

```
记录里是「update_task rejected: the completion gate could not measure ([completion.mutation] …」
重放得到「[completion.verify-rerun] verify re-execution is unavailable (no executor injected)…」
⇒ 分叉说明 ctx 缺了关键一格，判据跑到了另一条分支
```
★ 而这一臂**是本文件的核心**（它自己的注释说的）：一条"写下来了"的记录与一条
"**能重放**"的记录，在其它所有臂上都同形 —— 唯一能把它们分开的判据就是**重放**。

⇒ ★ 而它今天红，说明**记录里的 ctx 与运行时那一份已经分叉**（很可能就是 t54 加的那一格）。
  那正是这一臂存在的理由 —— 它在**正常工作**。⇒ 留给它的任务（本任务写域不含那条链条的装配）。

---

## 4. ★ 一份给"下一个会话"的机械读数

```sh
# 全部失败，附文件与行
pnpm test:gates 2>&1 | grep -A 2 '^test at'

# 只看那几个**只在 worktree 里红**的（环境类）
ls .agent-teams 2>/dev/null || echo '★ worktree 缺 .agent-teams/ ⇒ 环境类失败会出现'
```

★★ 而**基线绿之后**，`completion.backtest` 才第一次能对**新任务**归因。
在那之前它说的"无法归因"是**真话**，而它读起来像归咎于你的改动 ——
本文件就是用来消掉那个歧义的。

---

## 5. 一条留给下一手的提醒

本次修的是「**基线**」，不是「**判据**」—— 一个字都没放宽：

```
· 有 blocker            ⇒ 仍然拒绝
· 没能测量(unmeasured)  ⇒ 仍然拒绝
· 没检查(skippedAll)    ⇒ 放过、但**记下来** + warn   ← 唯一改掉的那一格
· 输入面缺格            ⇒ 仍然只说、不拒（本来就是这样）
```

★ 而那 15 条夹具的修法**一律是改夹具**（对齐当前口径），**没有一条**是删断言。
只有在"臂的前提本身过期"时（1.3 第 7 条）才换了**自变量**，
而那是为了**保住**那条臂的分辨力 —— 否则它会变成恒真（加不加 r5 都是 true）。
