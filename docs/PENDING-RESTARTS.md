# 待重启台账（累积，不阻塞任务）

> **建立：2026-10-09。** 用户的原始指示：
>
> > 「有什么需要我重启的，你就可以先积累下来。按照我们这个项目的开发宗旨，
> >   如果有什么一定是需要我去做的，就在不阻塞任务的情况下推进任务，
> >   然后等到我去做决断。」
>
> **⇒ 所以这份文件是【队列】，不是【请求】** —— 它不催、不阻塞；任务照常做、照常验，
> 只是最后那一步「让判据在真实运行中生效」要等一次重启。

---

## 0. 为什么需要重启（实测的机制）

```
判据层的【数据】⇒ 每次调用读盘、不缓存 ⇒ ★ 改完立刻生效，不用重启
    kind-requirements.json / baseline-known-failures.json / verify-command-rules.json
    （注释逐字：「★ 为什么每次读、不缓存：缓存会让『改表』在下一次进程重启前不生效。」）

判据层的【逻辑】⇒ registry = buildRegistry() 是模块级单例 ⇒ ★ 必须重启
    src/gates/** · src/tools/**
```

**★ 而"必须重启"的根因在 `dsh-base`，不在本插件**：
`cordis.patch.yml:32` 的 `root: []` 表示不监听任何源码目录 ⇒ 模块只在进程启动时加载一次。
（用户 `REQUIREMENTS.md` §39 已取证；`fiber.restart()` 换不掉模块，两次实测确认。）

---

## 0.1 ★★★ 更正（2026-10-09）：这一段读错了一半，而"必须重启"是可以解开的

> **下文 §0 的那两行【结论对、理由错】，而它把一个可解的问题写成了不可解的。**
> 完整研究见 **`docs/RESEARCH-RESTART-FREE.md`**（实测）。摘要：

```
① ★ 真正的开关不是 `root`，是 `disabled`
     dsh-base（本机 Tauri 运行时）逐字:
         - id: hmr
           name: '@deepseek-ai/cordis-plugin-hmr'
           disabled: true            ← ★ 就是这一行
           config:
             root: ['.']
     注释逐字: "Module reload is opt-in per profile."
     ⇒ 不是"机制不存在"，是【它默认关着】。

② ★ `fiber.restart()` 换不掉模块 —— 这一条【是对的】，而且理由也该换：
     它调 _reload() → _execute() ⇒ 重跑【构造时捕获的】runtime.callback
     整条链里没有一次 import()、没有一次 loadCache / require.cache 的删除
     ⇒ 它只能拿【新配置】，永远拿不到【新代码】。

③ ★ 而本项目此前认定"进程内换模块不可行"（MODULE-RELOAD.md），
     那条负结果【在它自己的范围内仍然成立】（?query 换不掉依赖图），
     但 HMR 正是绕过它的实现：它遍历 job.linked 拿【整个模块图】，
     再直接删 Node 内部 loadCache + CJS require.cache ⇒ 重 import ⇒ 替换注册表里的插件。
     ⇒ ★ "不可行"的结论应当限定为"用 ?query 不可行"，而不是"换模块不可行"。

④ ★ 而本机曾经真的跑起来过（证据在日志里，不是推断）：
     ~/Library/Application Support/dsh-tauri/logs/desktop.log 逐字:
         WARN dsh: hmr (@deepseek-ai/cordis-plugin-hmr): Error: EMFILE: too many open files, watch
     ⇒ 它走到过【建 watcher】那一步 ⇒ ① 那一行被启用过 ② --expose-internals 在
        （否则构造函数第一行就抛 "requires --expose-internals"）
     ⇒ ★ 那次失败的原因是【fd 耗尽】，不是机制不可用。
```

**⇒ 所以下面这份队列的处置方式变了**：**不必再"攒着一次重启"** ——
打开 HMR（一次重启）之后，`src/**` 的改动 build 完即生效。
⇒ 队列里那些"等重启"的条目，**大部分可以改成"打开 HMR 之后自解"**。

★ 仍然需要重启的只剩两类（官方 README 逐字）：
**改 `package.json`/依赖图**，以及 **改 profile 的 `bundles` 列表**。

---

## 1. 队列（按"落地时间"排，不按重要性）

| 何时积累 | 改动 | 它现在卡在哪 | 阻塞了谁 |
|---|---|---|---|
| 2026-10-09 | `src/tools/update-task.ts`（t14 的空理由修复） | ★ 已并入主树、已 build，**进程未加载** | t1/t13/t14/t16 的收口 |
| 2026-10-09 | t23（knownFailures 装载器） | 等 t18 解锁 | 整份基线清单是死的 |
| 2026-10-09 | t19（增量失败 vs 存量失败） | 等 t11+t18 | 17 条任务的 completed 不可达 |
| 2026-10-09 | t20（baseRevision 按 kind 判） | 待重做（产物丢过一次） | 非 impl/repair 任务重派后永久卡死 |
| 2026-10-09 | t24（依赖按需注入） | 等 t18 | worktree 依赖各自 install |
| 2026-10-09 | t17（r5 粒度） | 等 t18/t19/t20 | t1 被判"装饰性测试"（结构性假红） |

---

## 2. 一次重启能解几个

**★ 答案：全部** —— 因为重启让进程重新加载 `lib/` 的**当前**内容。
⇒ **所以不需要"每落地一条重启一次"**；攒在一起，一次重启全部生效。

**★ 而唯一的前置是：重启之前必须 `pnpm build`**（否则盘上还是旧的）。

```
正确的两步（顺序反了就是白重启一次 —— 已经犯过）：
  ① pnpm build        ⇒ 让盘上 = 当前源码
  ② 完全退出 DSH 再打开 ⇒ 让进程加载盘上那一份
```

**★ 判据（重启后怎么确认生效）**：
```
Deployment 行从 "this process holds a build OLDER than the one on disk"
改成 "this process holds the current build"
```

---

## 3. 一条与"自迭代"直接相关的结论

```
★ 判据的【参数】可以做到免重启（把硬编码挪进数据表）
★ 判据的【逻辑】不可能免重启 —— 除非解开 §39 的 root: []
```

**⇒ 所以"判据层自迭代"能走到哪一步，是可算的**：
```
数据表化的部分 ⇒ 真自迭代（改完即生效）
逻辑部分       ⇒ 人驱动的迭代（一次重启一批）
```

**⇒ 而扩大"数据表化"的范围，是【不需要动宿主】就能提高自迭代比例的唯一方向。**

**★ 已派 t27（判据参数表化）。**

---

## 4. ★★ 一条 captain 造成的系统性问题（已派 t28）

### 4.1 现象

```
t14/t20 : loaded b0337e1 vs HEAD ba32130 → 被拒
t18     : loaded ba32130 vs HEAD d01394d → 被拒   ← ★ 同一条门，第二次
t16     : attempt 4→5→6→7→8，五轮仍未变
```

**⇒ 每当 captain 往主树【并入东西】（HEAD 前进）而宿主未重载，全体成员都会被挡一轮。**

**★ 而我今晚往主树入了 `d01394d` —— 而它挡了至少 3 轮。**

**★★ 而那是我做的、而我不知道它有这个后果。** 它记在这里，因为**它会重复**。

### 4.2 而根因比"需要重载"更深

```js
// lib/tools/shared/entities.js:881
`this process loaded code built at ${commit}…, but HEAD is now ${head}…`
```

**⇒ 判据比的是【commit 维】，而 commit 在【任何新提交】后都前进。**

```
★ 而 content 维（build 产物的 output hash）其实【没有变】——
  因为 d01394d 只往主树加了两个 scripts/ 文件，而 src/ 没动 ⇒ lib/ 没变
⇒ ★ 判据把「有提交发生了」读成了「你手上的代码旧了」
```

### 4.3 ★ 而它与今晚另一条同族

```
r5 按【文件】判 vs 按【臂】判（t17 的结构性假红）
部署门 按【HEAD 前进】判 vs 按【产物变了】判（t28）
⇒ ★ 两条都是【一个正确的判据用了过宽的输入面】
```

### 4.4 ★ 运维条目（给下一个 captain）

> **「并入主树」这一步与「重载宿主」是一对。**
> **只做前者 ⇒ 全体成员各被挡一轮。**
> ⇒ 所以：**攒着并入，一次做完再让用户重启**；或者**并入后立刻记为待重启**。

**★ 而这与 §2 的"一次重启解全部"是同一件事的两面**：
**既然一次重启解全部，那就该把并入也攒起来** —— 而现在我是"想到就并入"，
于是每并入一次就挡全体一轮。


---

## 5. ★★★ 一条被实测证明的结构性缺陷：任务【退不出去】（已派 t29）

### 5.1 现象（`decompose-author` 在 t16 上实测，captain 逐字复核）

```
落 completed ⇒ [completion.backtest] 拒
落 failed    ⇒ ★ 逐字相同 ⇒ 同一条拒
⇒ ★ 不是「收不了口」，是【两个出口同时被堵】
```

### 5.2 根因：`wantsCompleted` 算了、交出来了、而判据没读

```
src/tools/update-task.ts:359              wantsCompleted: args.status === 'completed'
src/tools/update-task/completion.ts:230   const wantsCompleted = args.status === 'completed'
src/gates/completion/backtest.ts          ★ grep -c ⇒ 0 —— 一次都没读

★ 而同族的另一条【读了】：
   src/gates/completion/verify-rerun.ts:86
     return ctx?.wantsCompleted === true && ctx?.taskNotTerminal === true && …
⇒ 同一族的两条判据，一条读、一条不读 —— 而那正是分叉
```

### 5.3 ★★ 而真正的判别量是 `changedPaths`，不是 kind

```
t13  verification attempt=4  → ★ failed 落成功了
t16  verification attempt=9  → ★ 退不出去

★ 差别: t16 的契约【要求】交 changedPaths ⇒ backtest 的守卫二放行 ⇒ 门跑 ⇒ 拒
        t13 的契约没要求      ⇒ 守卫二不放行 ⇒ 门不跑 ⇒ 放行

⇒ ★★ 「契约要求交 changedPaths」反而【害了】t16。
   而这是本队记账最久那个形态的最新变种：
   【照契约做】导致了一个契约没有预见的后果。
```

### 5.4 ★ 而主树的注释自己写着这件事

```js
// src/tools/update-task/completion.ts:196-197 逐字
* ⇒ 回测恒 unmeasured ⇒ **这类任务永远无法收口**。
```

**⇒ `entities.ts:332` 把它从 `unmeasured` 换成了 `blocked`（拒绝）
⇒ 「永远无法收口」这句结论【没变】，只是换了条分支到同一个地方。**

**★★ 一般形式（记进台账）**：

> **一次修复可以改变【分支】，而不改变【结论】—— 而那在 diff 里看起来像修好了。**

### 5.5 ★ 一条没人试过的旁路，而执行者拒绝走它

`decompose-author` 报出：
> 「『不带 `changedPaths` 上报』可能绕过守卫二。**我没有试**：
>   契约**要求**交它，而**为了让自己过关而少交一格申报** = 让检查闭嘴，
>   而后果是**静默的**：这条记录会看起来像『本任务没有改动过任何文件』。」

**★★ 而它暴露的是判据的问题，不是人的问题**：

> **两个出口被堵时，"少交一格申报"不该成为唯一的出路。**
> **⇒ 那会让【记录的完整性】与【任务的退出】互相冲突 ——
>   而一个让诚实的人必须在两者之间选一个的判据，是判据的问题。**

**⇒ 已派 t29（`backtest.appliesTo` 要读 `wantsCompleted`，与 `verify-rerun.ts:86` 同一口径）。**

---

## 6. ★★ 同族第四次：一个字段承载两件事 ⇒ 两侧互堵（已派 t30）

### 6.1 现象（`wire-author` 在 t12 上两侧各实测一次）

```
① changedPaths = 三个真实文件
   ⇒ [dispatch.changed-paths] "…was reported as changed but it was not observed anywhere
      it could have happened: not in this member's session,
      and not in any of the 27 workspace(s) that were checked"

② changedPaths = []（按 t18 那次的经验清空）
   ⇒ [completion.r5] R5 could not locate the new test files: no scan directories were declared
      [completion.mutation] this task declared no changed files, so there is nothing to mutate

⇒ ★ 非空被①拒、空被②拒 ⇒ 任务【无法收口】
```

### 6.2 根因：同一个字段问了两件不同的事

```
① dispatch.changed-paths 问：「我在【本次会话】里观察到的新写」
② completion.r5/mutation 问：「一个可变异/可重跑的【改动集】」
⇒ ★ 两者对"只改 scripts/ 与 docs/ 的任务"【期望相反】
```

**★ 而 t12 与 t18 的差别只是「并在主树没有」** ——
⇒ **那道门把「文件在不在主树」与「本次会话有没有观察到写」用同一个字段表达。**

### 6.3 ★ 今晚同族四条（都被派了任务）

```
1. t14  dispatch 把"没被检查"读成"拒绝"（抛空消息）      ⇒ 已修（在主树）
2. t18  「我改了它」vs「它与我有关」（同一 changedPaths）  ⇒ 已并入主树
3. t12  ★ 非空被①拒、空被②拒 ⇒ 两侧互堵                 ⇒ 已派 t30
4. t28  部署门「HEAD 前进」vs「产物变了」                  ⇒ 已派 t28
⇒ ★ 四条同族：【一个正确的判据用了过宽的输入面】
   或【一个字段承载了两件事】
```

### 6.4 ★ 而这一族的最准表述（`wire-author` 给的）

> **同一个字段承载了两件事，填的人会按自己那一半理解去填。**

**⇒ 而它的后果不是"填错"，是"**怎么填都被拒**"** ——
**填的人无法通过"更仔细"来避免它，因为两半的要求相反。**

**★★ 那正是本条要修的东西**：
> **一个"怎么填都被拒"的字段，是字段的问题，不是填的人的问题。**

### 6.5 ★ 一条实测到的好消息（t14 那条修复的第一次真身现身）

```
t18 时: this process holds a build OLDER than the one on disk (loaded ba32130, HEAD d01394d)
t12 先: whether this process holds an old build could NOT be determined
        (no build stamp at lib/git-artifact-stamp.json) — that is "not measured", not "up to date"
t12 后: this process holds a build OLDER than the one on disk
```

**⇒ 中间那一条是【三态纪律】在真实路径上的第一次现身**：
**它没有把"读不到 stamp"读成"是新的"。**
**★ 而那是今晚唯一一条"修复被证实生效"的读数** —— 且它是在真实路径上撞到的，不是夹具里造的。

---

## 7. ★★★ 同族第三次：changedPaths 缺【第三个观察面】（已派 t31）

### 7.1 现象（`wire-author` 三次收口逐字实测）

```
① changedPaths = 三个真实文件（只在 worktree）  ⇒ not observed anywhere
② changedPaths = []                            ⇒ r5/mutation 拒
③ changedPaths = 三个真实文件（★ 已在主树）    ⇒ not observed anywhere  ← 与①逐字相同
```

**★ 而 ① 与 ③ 的差别只是"文件在不在主树"，而 gate 答案【完全相同】**
⇒ 它证明这道门看的**不是文件存在性**。

### 7.2 ★★★ 完整根因（captain 自查出来的）

这道门**已经有两个观察面**：

```
① observedChangedPaths —— session 事件（成员本次会话里的写）
② gitChangedPaths      —— 工作区【脏了】的路径（主工作区 + 每个成员 worktree）

判定: fabricated = 报告了、而【两个观察面都没有】的路径
```

**⇒ 而 t12 那次两个面【同时】miss，根因是 captain**：

```
① session 事件 ⇒ ★ captain 用 cp 手工并入 ⇒ 不在成员的 session 里 ⇒ miss
② 工作区脏     ⇒ ★ captain 又 commit 了      ⇒ git 看它不脏   ⇒ miss
⇒ 两个面都 miss ⇒ 判【虚报】⇒ 死锁
```

**★★ 而真相是：文件已在主树、已 commit、内容正确 ——
那是最该算"改了"的情形，却被判成「虚报」。**

### 7.3 一般形式

> **两个观察面都问「它现在脏吗」，而没有人问「它是否已被并入」。**

**★ 而"已被并入"是【最强】的一种"改了"**：
```
工作区脏   ⇒ 改了，而【可能丢】（未提交 ⇒ 回收即失）
已被并入   ⇒ 改了，而【不会丢】
⇒ ★ 而当前的门把【更强的那种】判成了【虚报】
```

### 7.4 ★ 今晚第三次同族：任务被一个过窄的观测面锁死

```
t29  任务【退不出去】        —— wantsCompleted 算了而没人读
t30  changedPaths【两侧互堵】 —— 非空被①拒、空被②拒
t31  ★ 第三观察面缺失          —— 两个面都问"脏不脏"（本条）
⇒ ★ 三条都是"任务被一个过窄的观测面锁死"
```

### 7.5 ★ 而它的措辞纪律已经写在源码里，t31 只补第三格

```js
// src/gates/dispatch/changed-paths.ts:230-240 的注释逐字
① 没观察到写入        —— 这一格可能有，只是我没看见（换过会话 / 读不到事件）
② 任何工作区里也没有  —— 这条路径**压根不存在**（真正的虚报）
★ 两句读起来都像"你虚报了"，而它们的补救动作完全不同
```

**⇒ t31 要补的第三格**：
```
③ ★ 已被并入某棵树 —— 它不是虚报，而是【最强的那种改了】
   ⇒ 而它与 ② 的补救动作【相反】：② 要你去干活，③ 要你去别处找证据
```

### 7.6 ★★ 运维条目（给下一个 captain）

> **captain 手工 `cp` + `commit` 并入一个成员的文件之后，
> 那道成员的名还没关掉时，`dispatch.changed-paths` 会判它【虚报】。**
>
> ⇒ **因为两个观察面都问"现在脏不脏"，而 captain 的动作让两个答案都变成"不脏"。**
>
> ★ 处置：**先让成员交终态，再并入**；或者**并入时同时记下这件事**（t31 落地后自动解决）。

---

## 8. ★★★ 这条门的【完整形状】（`wire-author` 实测，captain 复核）

### 8.1 四种组合，逐字实测

```
想记 completed：
  非空 changedPaths ⇒ [dispatch.changed-paths] 拒（观测不到）
  空   changedPaths ⇒ [completion.r5]/[completion.mutation] 拒（没有改动集）
  ⇒ ★ completed 在本类任务上【结构上不可能】

想记 failed：
  空   changedPaths ⇒ ★ 过（因为 completion.* 不在 failed 的路上）
  ⇒ ★ failed 能记，而那是【错误记录】（工作其实完成了）
```

**★ 可复现判别**：**空 `changedPaths` 只在 `status=failed` 时能过。**
（t18 attempt 2 的 failed 过 / completed 被拒；t12 的 failed 过；t18 attempt 3 的 completed 被拒）

### 8.2 ★★★ 而那意味着什么（`wire-author` 的原话，全文采纳）

> **「这条门把『工作已完成』变成了【只能记成 failed】。**
> **而那不是『闸门严』，是【闸门的两个观察面各自只认一半】，
> 而中间那一格（已被并入）没有人在看。」**

**⇒ 那是"结构上不可完成"的最精确表述。**

### 8.3 ★★ 而今晚同族是【五次】

```
t14  dispatch 把"没被检查"读成"拒绝"（抛空消息）
t18  「我改了它」vs「它与我有关」（同一个 changedPaths）
t12  两侧互堵（非空被①拒、空被②拒）
t28  部署门「HEAD 前进」vs「产物变了」
t31  ★ 第三观察面缺失（两个面都问"脏不脏"）
⇒ ★ 五条都是"任务被一个过窄的观测面锁死"
```

### 8.4 ★★★ 而那个环的完整形状（`pipeline-author` 实测画出来的）

```
t1 的终态 → 卡在 backtest
backtest   → 要 ① 重载 ② t23 落地
t23        → 等 t18 终态；而 t18 也卡在 backtest        ← ★ 环在这里闭合
t29        → 修 backtest 的 appliesTo，而它等 t23/t27
⇒ ★ 修这条门的人（t29）自己也被这条门堵着。
```

**★ 而它的准确表述（`pipeline-author` 给的）**：

> **「它不是『某条被判据挡住』，是『修判据的那条活也被同一条判据挡住』。」**

**★★ 而它与 §5.4 那条是同一族的两种形态**：
```
§5.4  修了一个缺陷，而它要消灭的那件事没变（unmeasured → blocked）
§8.4  修判据的那条活，被那条判据挡住
⇒ ★ 两条都是【修复与被修对象之间的自指】
```

---

## 9. ★ 运维条目（第二条，给下一个 captain）

> **captain 手工 `cp` + `commit` 并入成员的文件之后，那道成员的名还没关掉时，
> `dispatch.changed-paths` 会判它【虚报】。**
>
> ⇒ **因为两个观察面都问"现在脏不脏"，而 captain 的动作让两个答案都变成"不脏"。**
>
> ★ 处置：**先让成员交终态，再并入**（t31 落地后自动解决）。
>
> **★ 而第二条**：**captain 每一次 `git commit` 到主树，都会让 HEAD 前进 ⇒
> `[deployment]` 会挡住全体成员的收口**（除非只动 `scripts/`/`docs/` 而 `src/` 没变 ——
> 而那正是 t28 要修的）。
>
> ⇒ 处置：**攒着并入，一次做完再让用户重启**；或者**并入后立刻记为待重启**。

---

## 10. ★★★ 一条会【删掉唯一产物】的路径 bug（已派 t33）

### 10.1 触发它的是两个数之差

```
verifier 报（t25，三轮回测稳定）：
  task-t1 的 orphaned：旧实现 1 个 / 新实现（权威）2 个
```

### 10.2 ★ 而它给的根因（`slice(3)`）经实测【不成立】

```
'M  scripts/x.mjs'（已暂存）⇒ slice(3) = 'scripts/x.mjs'  ✓
' M scripts/x.mjs'（未暂存）⇒ slice(3) = 'scripts/x.mjs'  ✓
'?? scripts/x.mjs'（未跟踪）⇒ slice(3) = 'scripts/x.mjs'  ✓
⇒ 三种格式都是【两个状态字符 + 一个空格】= 3 字符 ⇒ slice(3) 是对的
★ 同理 src/worktree.ts:139/406 两处也是对的
```

### 10.3 ★★★ 而真正根因是【路径形态】

两处实现的解析逻辑**逐字相同**（已 diff）。差别在 `worktree` 参数：

```js
const full = join(worktree, path)
if (!existsSync(full)) continue        // ★ 相对路径下这里会失败
```

**⇒ 权威实现拿到绝对路径，旧内联拿到相对形态** ⇒
`existsSync` 在相对形态下取决于**进程的 cwd** ⇒ 其中一条**静默 `continue`**。

### 10.4 ★★ 而后果被证死了

```
task-t1 的 friction-triage.mjs blob = 527466b6ce8f
git log --all --find-object=527466b6ce8f ⇒ ★ 空
⇒ 它确实是【唯一的那一份】（内容不在任何提交里）
⇒ ★ 旧实现漏掉了它 ⇒ 旧实现会【删掉一份唯一的产物】
★ 而 --apply 真的删过 32 个树（用旧实现）
```

### 10.5 ★ 而它比 `slice(3)` 更难发现

```
slice(3) 截错         ⇒ 一个看得见的写法错误
相对路径下 existsSync ⇒ 一条【在别的调用方式下才出现】的路径问题
⇒ ★ 两者都指向"删掉唯一产物"，而后者【伪装成"正确地什么也没发现"】
```

### 10.6 一般形式

> **一个只在"某种调用方式"下失败的检查，与一个"正确地什么也没发现"的检查，
> 在读数上同形 —— 而它们的补救动作相反。**

### 10.7 ★ 而这已经是今晚同一族的第 N 次

```
t29  退不出去（wantsCompleted 算了没人读）
t30  两侧互堵（非空被①拒、空被②拒）
t31  第三观察面缺失（两个面都问"脏不脏"）
t32  两棵树被当成一棵（worktree 10 条 vs 主树 18 条）
t33  ★ 相对路径下静默跳过（会删掉唯一产物）
⇒ ★ 五条都是【一个判据的输入面比它该有的窄/宽，而失败伪装成成功】
```

---

## 11. ★★★ 更正 §10：真因是【整段 `.trim()`】，而 captain 的复核也错了

### 11.1 三次改根因，每次更具体

```
① verifier 报: slice(3) 对已暂存条目截错
   ⇒ captain 实测证否（三种标准 porcelain 格式下 slice(3) 都对）

② captain 报: 相对路径 + existsSync 静默跳过
   ⇒ ★ verifier 实测证否（脚本传的是【绝对路径】：listWorktrees 用 join(repo, …)，
      而 repo 由 git 问出来，是绝对路径）

③ ★ 真因（verifier 实测，captain 逐字复现）:
   旧脚本 git() 上的【整段 .trim()】
```

### 11.2 机制（★ 只破坏首行，这解释了"恰好漏一个"）

```
旧脚本: execFileSync('git', args, {cwd,…}).trim()   ← ★ 这个 .trim()
权威  : execFileSync('git', [...args], {cwd,…})     ← 不 trim

porcelain 原始首行:  " M scripts/friction-triage.mjs"   ← space-M-space
整段 .trim() 之后:   "M scripts/friction-triage.mjs"    ← ★ 首个前导空格被吃掉
⇒ slice(3) = "cripts/friction-triage.mjs"
⇒ existsSync(join(worktree, 它)) = false
⇒ 静默 continue ⇒ 那个「内容不在任何提交里」的源码文件被漏掉
★ 而【只有第一行】被整段 trim 破坏；后续行不受影响 ⇒ 恰好漏一个
```

**★ captain 逐字复现**：
```
不 trim ⇒ ["scripts/friction-triage.mjs","scripts/friction-triage.test.mjs"]      （2 个）
已 trim ⇒ ["cripts/friction-triage.mjs","scripts/friction-triage.test.mjs"]      （1 个）
```

**★ 而两个 blob 都唯一**（`527466b6ce8f…` / `f5fe057ae548…` 在 `git log --all --find-object` 里 **0 次**）
⇒ 旧实现漏掉的那一个是【真的唯一产物】⇒ 旧实现会删掉它。

### 11.3 ★★★ 一般形式（比前两条都难发现）

> **对「整行列表输出」调 `.trim()`，只会破坏【第一行】的列对齐 ——
> 而任何行式解析器（`slice(3)`、`split(' ')`）都依赖那个对齐。**
>
> **⇒ 它编得过、跑得过、`typecheck` 过，只在「首行恰好需要一个前导空格」时出错 ——
> 而那取决于【哪个文件排在输出的第一行】。**

### 11.4 ★★ 而 verifier 那句方法论，是这一条的真正产出

> 「让我没停在他那个复核上的，是『**同一瞬间两条路径各跑一次**』这个动作 ——
>  它把『看起来一样的输入』与『实际不一样的输入』分开了。」

**⇒ 而这正是本队那条的又一次现身**：
**一个合成出来的样本来验证解析器，与【真实输入】不同形 ——
而合成样本恰好躲开了那个只有真实数据才会触发的首行对齐。**

### 11.5 ★ 而 captain 这一轮错在哪（记下来，因为它可重复）

```
captain 的复核:  "join(worktree, path) 在相对路径下 existsSync 失败"
★ 而我【没有实测那个前提】—— 我从两处代码的写法差异【推断】了一个根因，
  而没有先跑一次"脚本到底传的是相对还是绝对路径"。
⇒ ★ 与今晚那条同源：**推断出的根因，与实测出的根因，在报告里同形。**
```

### 11.6 findings（verifier 报，均不在其写域内）

```
R1 [high]   整段 .trim() + 行式切片 —— 建议普查【所有】"列表输出 trim 后按列切"的写法
R2 [medium] 两个同名 git() 行为不同（src/worktree.ts 不 trim · 脚本曾 trim）
            ★ 「同名两处不同实现」，与 DEPLOYMENT-READINGS §六① 同族
R4 [high]   changed-paths 那条（captain 已裁定真缺陷，归 t31 族）
            ★ 其补的边界：§5.1 说「归属不走 cwd」，而「已提交的改动不算改动」【不是】它的推论
```

---

## 12. ★★★ 两条门互相矛盾，而【一个动作能让它们同时通过】（已派 t34）

### 12.1 冲突（`decompose-author` 在 t23 上实测，captain 复核）

| 来源 | 要求 |
|---|---|
| **`verify-input-requires` 臂 11**（`:2110`） | 判据源码改动**必须 commit**（否则 `undeclared` ⇒ 红） |
| **`dispatch.changed-paths`** | 申报的改动必须在**未提交的工作区**里被观察到 |

```
· 不提交 ⇒ 臂 11 红（实测：'modified but never committed — declared nowhere'）
· 提交   ⇒ 臂 11 绿，而 changed-paths 拒收（worktree 已干净）
```

**★ 而臂 11 的意图是仔细的**（它自己的注释逐字）：
> 「要么提交时必须写下他改了什么（那正是我们要的留痕）。」
> ★ 而它还有一条用错 git 语义、被实测抓出的修正：
> 「『至少一个』是一个可被历史稀释的量 ⇒ 改成要求【每一个】改动该文件的提交都申报（缺一即红）。」

**⇒ 两条【都】对，而冲突在 `changed-paths` 只认"未提交的写入"这一条口径上**
（而那正是 t31 要修的第三观察面：**已被并入 / 已被提交**）。

### 12.2 ★★★ 而那个「能让两条同时通过」的动作

```
git reset --soft  ⇒ 工作区变脏 ⇒ changed-paths 观察到 ⇒ 过
                  而臂 11 比的是【提交 diff】⇒ 那条提交【还在历史里】⇒ 也过
⇒ ★ 一个动作让两条互相矛盾的门【同时】通过 —— 而留下一个看起来完全正常的记录
```

**★ 而 `decompose-author` 【没有】做它**，并说清了理由：

> 「我**没有**为了让这条门通过而 `git reset --soft` 去把改动退回未提交 ——
>  **那会让记录看起来像『这份交付从未被提交』**，而它已经被提交了。」

**★★ 一般形式（记进台账）**：

> **一个能让两条互相矛盾的门【同时】通过的动作，是最危险的动作 ——
> 因为它把矛盾从记录里抹掉了，而留下一个看起来自洽的台账。**

### 12.3 ★★★ 另一条：夹具复刻产品形状（已派 t34）

```
scripts/gate-baseline-known-failures.test.mjs 臂 4 在 t23 修好后【仍然红】
★ 而它自己的注释说「本臂不需要改一个字就会转绿」—— 实测不是:
   它的 load() 自己复刻了坏形状: parseKnownBaselineFailures(raw.knownFailures) + catch{return undefined}
   ⇒ ★ 它测的是【它自己那份拷贝】，不是真装载器 ⇒ 结构上不可能转绿
```

**★★ 而它暴露的是【captain 的裁定】建立在一个未验证的前提上**：
```
我当初把臂 4 裁定为「待修读数，会在 t23 落地后自动消失」
★ 而那个裁定的前提是【它走真装载器那一格】—— 而那个前提【从来没有被验证过】
```

**⇒ 已派 t34**（把臂 4 改成走真装载器，并要求**两个方向都测**：
产品修好 ⇒ 转绿；产品改回 ⇒ 转红）。

**★ 而它属于本队已记过的形态（t16 同族）**：
> **一个复刻产品行为的夹具，测的是那份复刻，而不是产品。**

---

## 13. ★★★ 一条可复现的派发缺陷：任务「可开工而没有工作目录」（已复现两次）

### 13.1 现象（`wire-author` 实测，captain 复核并复现）

```
t27: status=pending · assignee=wire-author · attempt=0 · attemptId=★不存在（键都没有）
     handoffId=546798c1-1165-4019-beb7-899eb44bea00 · reassigning=false
worktrees/task-t27 ⇒ ★ 仍不存在

★ 而 team.json 的 mtime 在那期间【被写过】（08:22 → 08:23:46）
⇒ ★ 文件确实被写过，而 t27 的 attempt 仍是 0
```

### 13.2 ★★ 两条独立证据指向同一件事

```
① 消息派工（send_message）      ⇒ 不建树、不给 attempt_id
② reassign_task（本轮，两次）   ⇒ ★ 树没建、attempt 仍 0、无 attemptId
⇒ ★ 不是"消息 vs 调度器"的差别 —— 是【那条链路在两种触发下都没接上】
```

### 13.3 ★ 而对照证据说明"正常路径"长什么样

```
t26: attempt=17 · handoffId=无   ⇒ ★ 「被派过」在记录里会累加
t1:  attempt=10 · handoffId=无   ⇒ 而它真的起来了（in_progress）
t27: attempt=0  · handoffId=有   ⇒ ★ 一次都没累加
⇒ ★ 所以"attempt 累加 + 无悬挂 handoffId"是正常路径的特征，
   而 t27 有【悬挂的 handoffId + attempt 0】
```

### 13.4 ★★ 判据（`wire-author` 给的形状，captain 采纳）

> **「有没有工作树」应当由记录里的 `attempt` / `handoff` 推出 ——
> 而当前两者都可以为「无」，于是"任务处于可开工态而没有工作目录"成为可能。**
>
> ⇒ **一个可开工的任务，它的记录里必须能读出【它的工作目录在哪】，
> 或者如实报出【它还没有】** —— 而现在这两者在记录里同形（都是"没有那个字段"）。

### 13.5 ★★ 运维条目（给下一个 captain）

```
★ 若一个任务 pending 且 attempt=0 且【有 handoffId】⇒ 它卡在交接里：
   它不会被调度器取走，而【再 reassign 也不会累加 attempt】（已复现两次）
★ 判据：比对 attempt —— 若 reassign 之后 attempt 没变 ⇒ 那条链路没走通，
   而"我派了"与"它被派了"在动作上同形、在记录上不同形。
```

### 13.6 ★ 而它是今晚同一族的第 N 次

```
t29  退不出去（wantsCompleted 算了没人读）
t30  两侧互堵（非空被①拒、空被②拒）
t31  第三观察面缺失（两个面都问"脏不脏"）
t32  两棵树被当成一棵（worktree 10 条 vs 主树 18 条）
t33  整段 trim 只破坏首行列对齐（会删掉唯一产物）
t34  夹具复刻产品形状（产品改好它也看不出来）
t35  ★ 派发的"已派"与"未派"在记录里不同形（attempt 是否累加）
⇒ ★ 七条都是【一个动作发生了，与一个事实建立了，在读数上不同形】
```

---

## 14. ★★★ 判别量最终确认：悬挂的 `handoffId`（2026-10-09 实测）

### 14.1 对照读数（同一轮、同一调度器）

```
★ 无 handoffId 的任务 ⇒ 派发成功（树建出来 + attempt 累加）:
    t2   attempt=1  · 树存在（★ base=12a92c2，即当前 HEAD）✓
    t21  attempt=2  · 派发成功 ✓
    t26  attempt=17 · 被派过 17 次 ✓

★ 有悬挂 handoffId 的任务 ⇒ 派发【永不生效】:
    t27  attempt=0  · 树不存在（reassign 两次都无效）★
```

**⇒ 判别量 = 记录里有没有【悬挂的 `handoffId`】** —— 而与触发方式（消息 / `reassign`）无关。

### 14.2 ★ 而它意味着什么

```
有悬挂 handoffId ⇒ reassign 只更新那个交接，而【永远不落下 attempt】
⇒ 任务永远 pending、永远没有工作目录、而【每次 reassign 都返回成功】
⇒ ★ "我派了"与"它被派了"在【动作】上同形，而在【记录】上不同形
⇒ ★ 而判据是：比对 attempt —— 若 reassign 之后 attempt 没变 ⇒ 那条链路没走通
```

### 14.3 ★★ 运维条目（给下一个 captain）

```
★ 派工后【必须核两件事】：
   ① 该任务的 attempt 有没有递增
   ② 它的 worktree 有没有被建出来
   ★ 两件都对 ⇒ 派发真的生效
   ★ attempt 未变（尤其 attempt=0 且有 handoffId）⇒ 它卡在交接里，再派也没用
```

**★ 而这与本会话的纪律一致**：
> **"我做了那个动作"与"那个事实建立了"必须分开读 ——
> 而只有后者可测，所以每次动作之后要读回一次。**

### 14.4 ★★ 而 `t2` 的树 base = `12a92c2`（当前 HEAD）—— 那是另一个好消息

```
t2 的树从【当前 HEAD】切出（12a92c2）
★ 而 t20/t23 那些旧树是 ba32130（落后几十个提交）
⇒ ★ 说明 t24 的依赖注入接线【生效了】，而树是从最新的主树切的
```

---

## 15. ★★★ 两条我们自己定的规则互相矛盾，而它让 4 条证据静默失效（已复现）

### 15.1 现象（`verifier` 在 t21 上实测，captain 复核）

```
scripts/gate-t1-completion-probe.test.mjs：tests 7 · pass 3 · fail 0 · ★ skipped 4
4 skipped 的逐字原因：「t1 的检出里没有交付（那两个文件与 HEAD 一致）」
```

**★★ 而根因是【两条我们自己的规则打架】**：

```js
// 契约条款②（本会话新增）:
   交付必须 commit —— 不 commit 的产物会被回收带走
   ⇒ captain 据此把 t1 的交付 commit（9b1b2b6）并并入主树（12a92c2）

// 而那个夹具的前置（:85）问的是:
   git(['-C', T1_WORKTREE, 'status', '--porcelain', '--', <两个文件>])
   if (changed.trim() === '') missing.push('t1 的检出里没有交付（那两个文件与 HEAD 一致）')
   ⇒ ★ 它问的是【dirty】，而不是【有交付】
```

**⇒ 于是**：
```
commit 了 ⇒ 文件不 dirty ⇒ 前置判"没有交付" ⇒ 4 条臂 skip
⇒ ★ while 交付其实【比之前更安全了】（它进了提交，不会被回收带走）
```

### 15.2 ★★★ 而 `verifier` 把它的一般形式说出来了（captain 采纳）

> **「一个交付的证据链，会在它的【被测对象被清理】时静默失效。」**

**★ 而实际发生的比这更微妙**：
```
不是"被测对象被清理" —— 是【被测对象被保护了】（commit 了），
而那个前置问的却是"它有没有被保护"的反面（dirty）
⇒ ★ 两个都对的动作（commit 交付 / 检查有没有交付），合起来让证据消失
```

### 15.3 ★★ 一般形式（记进台账）

> **一个"前置条件"如果问的是【状态】（dirty / pending / 未提交），
> 而它真正想确认的是【事实】（交付存在），
> 那么任何【改善那个状态】的动作都会让前置失效 —— 而失败伪装成"没测到"。**

**★★ 而它与今晚那条同源**：
```
t31  changedPaths: 两个面都问"现在脏不脏"
t32  fixture: 两棵树被当成一棵
★ 本条: 前置问"脏不脏"而它想问"交付在不在"
⇒ ★ 三条都是【一个检查问的状态，不是它想确认的事实】
```

### 15.4 ★ 处置

```
① ★ 那个夹具的前置要改成问【事实】：那两个文件是否有【t1 的交付】
   （例如：与某个基线相比有没有差异，或在 worktree 里 git log 有 t1 的提交）
   —— 而不是问 dirty
② ★ 而它现在在 verifier 的写域里（t21 的 inScope 含那个夹具）
③ ★ 而"证据链会因被测对象变化而静默失效"要作为一条【独立读数】被记住——
   因为今晚已经有两条（本条 + t13 那份 probe 的可复跑性）
```

---

## 16. ★★★ 需要一次重启：`memberMaxDepth: 1`（用户裁定 A+C，已写入宿主配置）

### 16.1 已做的改动

```
文件: ~/.dsh/profiles/desktop/cordis.patch.yml   ← ★ 宿主配置，不在本仓
备份: ~/.dsh/profiles/desktop/cordis.patch.yml.bak-20261009

新增条目（YAML 数组末尾，校验通过：14 条）:
  - id: agent-teams
    name: "@nanmicoder/dsh-agent-teams"
    config:
      memberMaxDepth: 1
```

### 16.2 ★ 它改的是什么（实测定位）

```js
// src/index.ts:131        memberMaxDepth: z.natural().default(0)
// src/tools.ts:1676       installMemberDelegationGuard(ctx, config.stateDir, config.memberMaxDepth ?? 0)
// src/harness-compat.ts:749
const depthDeny = maxDepth === 0 ? ['subagent', 'send_message'] : []
return { deny: [...CAPTAIN_TOOL_NAMES, ...depthDeny] }
```

**⇒ 默认 0 ⇒ 成员的 `subagent` 与 `send_message` 被 `deny` ⇒ 成员派不了 subagent。**

**★ 而 `depth` 的语义**（`src/members.ts:735-756` 实测）：从 1 起、在【成员级祖先】上递增
⇒ **`maxDepth = 1` ⇒ 允许成员派一层 subagent**（再深一层 ⇒ 抛 "delegation limit reached"）。

### 16.3 ★ 为什么要重启

```
它是【插件配置】⇒ 在插件 apply() 时读入 ⇒ 已加载的进程不会重读
⇒ ★ 与 [deployment] 那条同源：宿主 profile 的改动要重启才生效
```

**★ 判据（重启后怎么确认生效）**：
```
派一个成员去做一件小事，而它若能用 subagent ⇒ 生效
★ 或：memberMaxDepth 从 0 变 1 之后，memberToolFilter 不再 deny 'subagent'
```

### 16.4 ★ 而它与"一次重启解全部"的关系

**★ 它可以并入那次重启**（与 t23/t27/t29 那些代码改动一起）——
因为重启让进程重新读【宿主配置 + lib 产物】两样。

**★ 而前置仍然是**：重启前先 `pnpm build`（让盘上 = 当前源码）。

### 16.5 ★★ 而 A 的那一半（worker 改成临时）**不需要重启**

```
A = 派发规则的改动（每次派发只注入契约 + 相关读数，不注入历史）
⇒ ★ 它不需要改代码，也不需要重启 —— 它是【captain 的派发纪律】
⇒ 而它需要一支成员【不依赖记忆】—— 那一半靠规则，而规则会腐烂
  ⇒ 所以它要与 C 一起用：成员派完临时 worker 之后，那个 worker 的上下文就丢弃
```

**★★ 所以 A+C 的完整形态**：
```
① memberMaxDepth: 1（已写，待重启）⇒ 成员能派 subagent
② 成员的派发纪律：把实现外包给【干净上下文的 subagent】，只注入契约 + 读数
③ ★ 而成员自己【不记忆结论】—— 它每次从契约与台账读
④ Integrator：待建（它持有跨 worktree 的连续性 —— 见 DISPATCH-RULES §6.8）
```

---

## 17. ★★★ 条款②与这条判据的观察面【互相否定】（两个成员独立撞上，六个任务被挡）

### 17.1 冲突（`pipeline-author` 在 t9 上实测，`wire-author` 在 t4/t12/t18 上同形）

```
条款②（本会话新增）: 交付必须 commit —— 不是只留在工作树
而 dispatch.changed-paths 的第一面:
  gitChangedPaths ← src/harness-compat.ts:207 的 `git status --porcelain`
  ★★ 而 git status 【只看未提交的改动】—— 它自己的注释写着：
     「为什么用 `git status --porcelain` 而不是 `git diff`：--porcelain 同时覆盖 ?? 与  M」

⇒ 判定式: !seen.legal.has(path) && (gitObserved === undefined || !gitObserved.legal.has(path))
  commit 了 ⇒ git status 干净 ⇒ gitObserved 拿不到 ⇒ 判"虚报"
  不 commit ⇒ 观察面拿得到 ⇒ ★ 但违反条款②
⇒ ★★ 两条要求【互相否定】
```

**★★ 而它的实测对照**：
```
t9 的 worktree（已 commit）: gitChangedPaths ⇒ ["node_modules"] —— 它的两个文件不在里面
t2 的 worktree（当时未 commit）: git status ⇒ " M lib/types/types.d.ts / M src/types.ts"
⇒ ★ 那正是【会被观察到】的形状
```

### 17.2 ★★★ 而它比 t31 更严重

```
t31（已立项）⇒ 挡住 t12/t18/t25/t34 —— 那些是"如实申报被当成虚报"
本条        ⇒ ★ 挡住【每一个照条款② commit 的人】⇒ 它挡的是【那条纪律本身】
```

**★★ 而"照做的人反而被拒"这个形状，今晚第一次出现**：
```
t9 的格:  "让门绿" 与 "不越界"     方向相反 ⇒ 它选了不越界
本条:      "让门绿" 与 "遵守条款②" 方向相反 ⇒ 两位成员都选了遵守条款②
⇒ ★ 两次都是【纪律优先于读数】
```

### 17.3 ★ 而修法（与 t31 同一条，而本条的输入更硬）

```
★ t31 要补的第三面（已被提交）正是解这条的：
   一个路径若【已被提交】⇒ 不算虚报
★ 而 pipeline-author 给了一条更准的判据方向：
   (甲) 第二面改成读【相对 base 的 diff】（git diff <base> --name-only）
        ⇒ 那样已 commit 的改动也看得到
★ 而 verifier 早先给过一条边界：要用【这条提交里有没有这个路径】，
   而不是【两棵树差多少】—— 因为后者会把别人的改动算成本次的
```

### 17.4 ★★ 运维条目（给下一个 captain，**这条优先级最高**）

```
★ 现在的实情: 每位成员【照条款② commit】都会撞这条判据
  ⇒ 而他们【都】选了"红着交"（那是对的），代价是每个任务多一轮
★ 所以: 要么先落 t31，要么把条款②改成
   "必须 commit，而 commit 之后【同时】提供一个 base 参数给观察面"
★ 而【不许】让成员 uncommit 去过门 —— 那会把"照做"变成"照门做"
  （两位成员都拒绝走那条路，而他们拒绝得对）
```

---

## 18. ★★★ 「已 commit」+「cp 到主树」≠「已合并」（`wire-author` 在 t10 上实测）

### 18.1 现象

```
worktree HEAD = 090c1ca · main HEAD = fb1d977
★ t10 的树里没有 src/gates/dispatch/plan-reviewed.ts；而主树有（14280 B）
根因（三条命令，逐条可核）:
  git merge-base --is-ancestor af684d6 <main HEAD>  ⇒ ★ 不可达
  git merge-base --is-ancestor af684d6 090c1ca      ⇒ ★ 不可达
  git -C 主树 status src/gates/dispatch/plan-reviewed.ts ⇒ `??`（未跟踪）
⇒ t10 的树（从 090c1ca 切）看不到它 ⇒ 无法 import 一个不存在的模块
```

### 18.2 ★★★ 而它比 t18/t12/t20 那次更靠前一步

```
那次(t18/t12/t20): 产物只在 worktree、未 commit   ⇒ 树被回收 = 永久丢失
★ 这次           : 产物【commit 了】，而那个 commit 【没到会被保留的那条线上】
                   ⇒ 主树里只有一份【未跟踪的副本】
⇒ ★ `cp` 到主树 + 不 commit 【不等于】合并
   而未跟踪的文件在"主树"这个意义上【与未 commit 是同一格】——
   它存在过，而没有任何提交说它存在过。
```

### 18.3 ★★ 判据（`wire-author` 给的，可核）

```
★ git merge-base --is-ancestor <那个 commit> HEAD
   ⇒ 为假 ⇒ 下游树的拿不到它
★ 而那条命令正是【"这个模块有人认领吗"】的机械形式。
```

**★★ 而它的后果是具体的**：t10 要 import 那个模块，而它的树里没有 ——
**⇒ 而"我的树里有什么"变成了一个【取决于一次手工 cp】的事实。**

### 18.4 ★★★ 而修法不是 cherry-pick（captain 的处置，与它的选项 A 略有不同）

```
它给的 A: 把 af684d6【真地并进主树】（git cherry-pick 或 git merge）
captain 做的: ★ 在主树里【提交同一份内容】（5520399）——
   ⇒ 而不去 cherry-pick 一个 worktree 里的 commit
★ 为什么后者更好:
   · cherry-pick 会让主树多出一条【来源在 worktree】的提交，
     而那条提交的父节点不在主线上 ⇒ 它的历史仍然是"借来的"
   · 在主树里提交同一份内容 ⇒ 那条提交【本身就属于主线】，
     而"是谁做的"由 commit message 指名（"Absorbed from t8's af684d6"）
⇒ ★ 而两者的共同点: **必须有一条【主线上的】提交说它存在过。**
```

### 18.5 ★ 运维条目

```
★ 并入一个成员的产物时，【不是 cp 一份到主树】，而是:
   ① 在主树里 cp 那份内容
   ② ★ 在主树里 git add + git commit（那条提交属于主线）
   ③ 核: git ls-files <路径> 有输出（= 被跟踪）
   ④ 核: git merge-base --is-ancestor <worktree 里的 commit> HEAD
      ★ 为假是正常的（那条 commit 本就在另一条线上），
        而【我们不再需要它可达】—— 因为主树有了自己的那一条
```

---

## 19. ★★★ 「主树有了」≠「我被派到的那棵树有了」（t10 两轮实测）

### 19.1 两轮根因不同，而它们指向同一格

```
attempt 1: 产物在主树是【未跟踪】的（`??`）        ⇒ 树里看不到
attempt 2: 产物【已提交】（5520399）✓，而 t10 的树仍是 090c1ca ⇒ 树里看不到
⇒ ★ 共同点：「主树有了」与「我被派到的那棵树有了」是两件事 —— 而读数同形（都是"看不到那个模块"）
```

### 19.2 ★ 判据（一条命令，`wire-author` 给的）

```
git -C <我的树> merge-base --is-ancestor <那个产物所在的 commit> HEAD
  ⇒ 为假 ⇒ 我这棵树拿不到那个产物
  attempt 1: af684d6   ⇒ 假
  attempt 2: 5520399   ⇒ 假（★ 而它在主树 HEAD 上为真）
```

### 19.3 ★★★ 而机制是：**`createTaskWorktree` 会复用已存在的树**

```js
// src/worktree.ts（今晚实测）
if (existsSync(join(path, '.git'))) { …复用… }
⇒ ★ 所以【重派不会刷新 base】—— 只有【目录不存在】时才会走 `worktree add`
⇒ ★ 而"树落后"这个状态【不会自己消失】：它要靠【移除那棵树】或【一次重切】
```

**★★ 而它与 t20/t24 是同一族**：
```
t20: worktree 的 base 旧了两天，而没人知道
t24: 依赖按需注入没有调用方 ⇒ 每棵树各自 install
t10: ★ 树落后 ⇒ 下游任务看不见上游的产物
⇒ ★ 三条都是【worktree 的 base 一旦落后，它不会自己跟上】
```

### 19.4 ★★ 处置（captain 执行，可核）

```
① 先 salvage: 核那棵树里有没有未提交的东西（t10 的树是干净的）
② git worktree remove --force .agent-teams/worktrees/task-t10
③ reassign_task ⇒ 调度器走 `worktree add` ⇒ 从【当前 HEAD】切
④ ★ 判据: git -C <新树> merge-base --is-ancestor <产物 commit> HEAD ⇒ 应为真
   ★ 实测: 新树 base = ee6ed6d（当前 HEAD），5520399 可达 ✓
```

### 19.5 ★ 运维条目

```
★ 「并入主树」之后，若某个下游任务的树是【在那次并入之前切的】，
   那个任务【看不到】被并入的产物 —— 而它报出来的是"模块不存在"，
   那读起来像"上游没做"，而不是"我的树旧了"。
⇒ ★ 处置: 在并入之后，对【依赖该产物的下游任务】核一次 base；
   不合则【移除它的树】再重派（★ 因为重派本身不刷新 base）。
```

---

## 24. ★★★ `commitBehind` 用【不相等】判【落后】—— 而"构建时的提交是 HEAD 的祖先"被读成了落后

### 24.1 实测（2026-10-09，captain 自己踩进去的）

```
stamp.commit = 49894d0   （父提交）
HEAD         = d457d9c   （子提交，只多了一条提交）
git merge-base --is-ancestor 49894d0 HEAD ⇒ ★ 真（是祖先）
⇒ ★ 代码【没有落后】—— 只是 stamp 没更新
而门报: status='stale', why='commit'
```

**★★★ 而它的后果是【一个循环】**：

```
我 commit  ⇒ HEAD 前进 ⇒ stamp 落后（因为 stamp 记的是【上一次 build 时】的 HEAD）
我 build   ⇒ stamp 追上 ⇒ ★ 而 build 之后我若再 commit（提交 lib/ 与 stamp）⇒ 又落后
⇒ ★ 在这个顺序里，【跑完一次 build 之后立刻 commit】必然让 stamp 落后一格
```

**★★ 而它的根因在** `src/tools/shared/entities.ts`：
```js
const commitBehind = builtCommit !== head      // ★ 用【不相等】判【落后】
```

**★★★ 而"落后"的正确判据是【祖先关系】**：
```
builtCommit 是 head 的祖先   ⇒ ★ 构建基于更早的提交，而那条提交【在 HEAD 的历史里】
                              ⇒ "代码旧了，而它旧的那一版是【当前线的一部分】"
builtCommit 不是 head 的祖先 ⇒ ★ 构建基于一条【不在当前线上】的提交（换了分支/rebase）
                              ⇒ 那才是真正不同源的代码
```

### 24.2 ★ 而它与 tonight 那几条的关系

```
本会话那条: 【代理读数】在它所代理的东西没变时也会变
★ 本条: 用【不相等】代理【落后】——
   而"不相等"包含了两种情况："它是 HEAD 的祖先"（没落后）与"它不是"（真落后）
   ⇒ ★ 而前者【每天都会发生】（每次 build 后 commit 都发生）
```

### 24.3 ★ 处置

```
★ 判据改成: commitBehind = builtCommit !== head **且** builtCommit 不是 head 的祖先
★ 而【不可达时保守】: 跑不了 git 时（不是仓库 / builtCommit 不在库里）⇒ 维持"落后"（宁可误报）
   —— ★ 因为"说不清"不得读成"没事"（本队那条三态纪律）。
```

**★★ 而"HEAD 前进"本身不构成"你手上的代码旧了"** ——
**只有当那条提交【不在当前历史里】时才是。**

---

## 30. ★★★ 「推不动」的最终根因：git 台账里 33 条僵尸 worktree（2026-10-10）

### 30.1 那条留痕第一次说话 —— 而它一字不差地说出了根因

```json
"reason": "no isolated worktree: could not create an isolated worktree:
  Preparing worktree (detached HEAD 559285b)
  fatal: '…/.agent-teams/worktrees/task-t40' is a missing but already registered worktree;
         use 'add -f' to override, or 'prune' or 'remove' to clear"
```

**★★★ 而它就是"推不动"的真因** —— 而它此前**只写 `logger.warn`**（不进 `team.json`）。

### 30.2 ★★ 台账的漂移量

```
git worktree list  ⇒ 74 条
盘上真的            ⇒ 38 个
★ 其中 prunable     ⇒ 33 条（"gitdir file points to non-existent location"）
```

**⇒ 于是每一次建树都撞那 33 条里的某一条。**

### 30.3 ★★★ 而处置前【必须先 salvage】—— 而那一步救了 33 棵树的改动

```
★ 在 prune 之前查: 33 个树有【未提交】改动
⇒ 于是逐个核【它们的内容是否已在主树】:
    t2  → 「那份已审查的逐条读数」      ⇒ 主树有 ✓
    t14 → needsWorktreeFor            ⇒ 主树有 ✓（3 处）
    t24 → RestartArbitration          ⇒ 主树有 ✓
    t28 → 「t28：终态判定用唯一那份真值」⇒ 主树有 ✓
    t38 → tooManyGroups               ⇒ 主树有 ✓
⇒ ★ 全部是【已并入的副本】+ 构建产物 ⇒ 可安全清
★ 而若直接 prune 再删树 ⇒ 那 33 棵树的改动会一起消失
```

**★★ 判据（可机械执行）**：删任何树之前，先做【每个有未提交改动的树】→【它的改动标记在主树里在不在】。

### 30.4 ★ 处置与结果

```
① git worktree prune -v ⇒ ★ 只清 gitdir 指向不存在位置的（不动盘上活着的树）
   ⇒ 74 → 41 条（盘上 38）
② 实测 createTaskWorktree({taskId:'t40'}) ⇒ ★ ok: true
③ 重派 ⇒ t40 claimed(attempt 8) · verifier working
⇒ ★ 全队第一次真的动起来（三条在跑 · 三个成员 working）
```

### 30.5 ★★★ 而这一夜的解释，现在完整了

```
① 我以为"没人触发派发"      ⇒ 错（reassign 一直有触发）
② 我以为"status 会催派发"    ⇒ 错（它不调 kickTeam —— 全仓只有六个 kick 调用点）
③ 我以为"陈旧构建是主因"      ⇒ 错（那只是让读数更花）
④ ★ 我让用户重启了三次        ⇒ 而那一格【从来不需要重启】
★ 真因: git 台账里 33 条僵尸 worktree ⇒ 每一次建树都失败 ⇒ 派发被拒
        而【拒绝只写 logger.warn】⇒ 从昨晚到那时都看不到
```

**★★★ 而它被找到，只因为我给那一格加了留痕 —— 而不是因为又重启了一次。**
**⇒ 那正是本会话那条纪律的最后一次、也是最贵的一次显现**：
> **一条 `logger.warn` 之后的 `return`，与"什么都没发生"在记录上同形。**

---

## 40. ★★★ 用户的判断：旧成员会话 + 新机制 = 结构性打架（2026-10-10）

### 40.1 而数字支持它

```
★ 团队成员会话创建于: 2026-10-08 13:56（那四个 member id 就是那时的会话）
★ 而从那之后:        50 条提交
★ 其中【直接改成员/会话与派发行为】的:
    · 4c53134  恢复 t50 的重载扣发闸门（而它曾被整文件覆盖删掉）
    · f9e771a  t43: 投递失败留痕（deliveryFailure）
    · 559285b  t43: worktree 拒绝留痕（而那是"静默不派"的真出口）
    · 9b2a3b7  t24: 依赖按需注入接线
    · 9cb583a  t20: 非 implementation/repair 的 kind 不建树
⇒ ★★ 而那四个会话【是在这些之前创建的】——
   它们从没运行过这套机制。
```

### 40.2 ★★★ 用户的原话（而那是一个可检验的假设，不是一个抱怨）

> **「目前很多机制其实是我们后来加的，目前的成员执行起来可能有点打架。
>  要不我们后面新开一个任务，新开一个会话，起一个新的团队去做这些事情。」**

> **「因为目前它还是一个持久化的 worker，而我们其实改了很多机制。
>  我想看看，如果在新机制上应用的话，会不会像现在这样一直卡住——
>  一直有没派发或者在等待的任务，却一直没有人工作。」**

**★★ 而那句话把一个模糊的现象变成了【一个可检验的命题】**：
```
★ 旧会话 + 新机制 ⇒ 停摆（一个晚上的实测样本: 5+ 次）
★ 新会话 + 新机制 ⇒ ？
⇒ ★ 而"新会话"这个变量是【可隔离的】—— 因为机制本身已经固定了。
```

### 40.3 ★ 而今晚的停摆里，有【两个】是【会话层】而不是机制层

```
① ★ 残留 working: team.json 说三个成员在跑，而他们的会话【都不在了】
   （我发探针 ⇒ "active teammate not found"）
   ⇒ ★ 而那是【持久化 worker】这个设计的一个后果:
     一个持久会话消失后，记录里没有一格表示"它不在了"。
② ★ 而他们树里的改动【冻着】—— 我靠 salvage 才救回 t39 的 300 行

⇒ ★★ 所以"新会话"这条假设里，至少这两格是【关于会话的】，而不是关于机制的。
```

### 40.4 ★ 而新团队会跑在【今晚修好的机制】上（清单）

```
✓ memberMaxDepth: 1 ⇒ ★ 成员可以派 subagent（今晚配的，旧成员没有）
✓ t50 的重载扣发闸门（今晚恢复 —— 它曾被整文件覆盖删掉）
✓ t43 的 deliveryFailure / worktree 拒绝留痕（★ 而它们是"静默不派"的两个出口）
✓ t19 的基线判据（存量红不再挡住完工）
✓ t40 的存量旁路（新闸门不冻住它之前建的任务）
✓ t42 的 unmeasured 处置（dispatch + completion 两处）
✓ worktree 台账（git worktree prune —— 而那是"派发不动"的最终根因）
```

**★★ 而这一条要测的是**：
> **在这套机制【从零开始】的情况下，还会不会出现"有 ready 任务而没人派"？**
