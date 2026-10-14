# 逐层模块清单：这个 fork 相对上游加了什么

> **判据来源**：本文每一条「加了什么」都指到 **commit** 或 **`文件:行`**，可以用 `git show` / 读源码逐条回源核对。
> **测量点**：HEAD = `b8f357e` ｜ 上游 = `upstream/main` = `1094b84` ｜ merge-base = `98aac03`。
> **一手/二手**：本文以 **git 与源码为准**。引用 `docs/START-HERE.md`、`docs/THREE-LINE-PLAN.md`、`docs/BASELINE-RED.md` 时逐条回源核对过，发现不一致的在 §8 明确标出「文档已过期」。
>
> 复核入口命令（全部实测跑过）：
> ```sh
> git rev-parse HEAD upstream/main
> git diff --stat upstream/main...HEAD
> grep -rn "^export const id = '" src/gates/*/*.ts          # ⇒ 17
> git log --oneline upstream/main..HEAD | wc -l             # ⇒ 258
> ```

---

## 0. 一句话总览

**上游负责「跑」，这个 fork 负责「判」。**

上游把全部质量判据摊在**一个 1233 行的文件**里（`src/quality-gates.ts`，fork 基线 `54eddb4` 实测 1233 行 / 52 个 `export`）。
加一条判据就要改那个文件 ⇒ 每次同步上游必冲突。

这个 fork 的解法：**把判据从那个大文件里挪出来，变成「注册表 + 插入点」**，编排层只认插入点、不认识判据的名字与语义。
于是「换一条判据 = 换注册清单里的一行」，「加一个判据 = 新增一个文件 + 一行装配」，两者都不碰上游文件。

### 规模读数（实跑，非记忆）

| 读数 | 上游 `upstream/main` | fork `HEAD` | 命令 |
|---|---:|---:|---|
| `src/` 总行数 | 18,793 | **47,310** | `find src -name '*.ts' -o -name '*.tsx' \| xargs wc -l \| tail -1` |
| `src/` 文件数 | 40 | **95** | `git ls-tree -r --name-only <ref> -- src/ \| wc -l` |
| `src/gates/` | **不存在** | **11,964** | `find src/gates -type f \| xargs wc -l \| tail -1` |
| `src/gates/` 文件数 | 0 | **24** | `find src/gates -type f \| wc -l`（含非 .ts 资源；仅 .ts 则 22，另有 2 个 .json） |
| `src/tools/` | 不存在（工具都在 `src/tools.ts`） | **11,325** | 同上 |
| `src/tools/` 文件数 | 0 | **18** | `find src/tools -type f \| wc -l` |
| `src/client/` | 6,810 | **9,666** | `find src/client -type f \| xargs wc -l \| tail -1`（**含 CSS**）<br>★ 口径对称：仅 .ts/.tsx 则 上游 **4,381** / fork **6,735** |
| `src/quality-gates.ts` | 2,109 | 2,520 | `wc -l` |
| 判据数量 | **0**（判据散在大文件里，没有 id/插入点概念） | **17** | §2 |
| commit 数（merge-base 之后） | — | **258** | `git log --oneline upstream/main..HEAD \| wc -l` |

> ★ 注意 `src/quality-gates.ts` **至今仍在**，而且**变大了**（2,109 → 2,520）。
> 它没有被删掉 —— 它从「判据的所在地」变成了「**纯谓词与校验器的所在地**」，判据自身搬到了 `src/gates/`。
> 证据：`src/gates/delivery/coverage.ts:39` 逐字写着「不 import 任何 I/O（连 `quality-gates.ts` 也不 import）」，
> 而 `src/gates/dispatch/changed-paths.ts:46` 只从它 import 一个纯函数 `normalizeWorkspacePath`。
> **这是「抽出来」不是「重写」**：概念（`inScopeOverlap`、`classifyChangedPath` 等）留在原处，**裁决权**搬走了。

---

## 1. 分层方法（为什么这样分，而不是按文件夹）

用户问的是「一层一层、一个一个加了什么模块进去，达成了什么功能」。
所以分层的判据是 **「达成什么能力」**，不是「在哪个目录」。同一条能力经常横跨 `src/` 根目录 + `src/gates/` + `src/tools/`。

定层用的是 **`git log --first-parent --reverse`** 的时间顺序，加上「某个能力第一次出现时改了什么」。
一个能力 = 一批 commit，它们各自可独立回退。

下图是**实测的**层序（日期取自 commit 的 author date）：

```
L0 基线          54eddb4 (10-05)  ─ fork 建立，版本 0.1.23
L1 判据注册表化   70c8c96 (10-05)  ─ 把 1233 行大文件里的判据挪成「插入点 + 注册表」   ★ 本 fork 的由来
L2 判据本体 1     626c59d…27e9613  ─ changed-paths / worktree / r5 / mutation / backtest 五条判据
L3 输入面声明      f7bbf65 (10-06)  ─ 判据自己声明「我要哪几格」，注册表按声明核对
L4 补齐六个位置   621e152…0b01104  ─ admission 三连 + contract/delivery/runtime 各归位
L5 接线纪律       6345750 (10-08)  ─ 「全跳过 ≠ 都通过」；写了没接线 = 装了没生效
L6 kind 需求表     f8fc671 (10-08)  ─ 「哪些 kind 要哪几道完工门」变成数据，不再是硬编码两个 kind
L7 worktree 隔离   68ee2c8 (10-05) ─ 每任务一个 detached 检出（版本可核对）
L8 变异测试        c396e71 (10-05) ─ L1/L2 机械变异 + L3 项目契约
L9 backtest 归因   27e9613 (10-05) ─ 基准必须先绿，否则无法归因
L10 工具面拆分     9779c58 (10-07) ─ 16 个工具停止共用一个文件
L11 故障隔离       (10-11 合并)    ─ web-routes 外壳：插件自己的缺陷只让自己降级
L12 计划编排       (上游已有, fork 扩展) ─ staged plan / review 戳
L13 UI 重构        (10-11~10-14)   ─ 成员屏 / 依赖图 / 名册设置 / 会话 id
L14 硬化与计量     887d98a (10-12)  ─ 完工链的墙钟预算、worktree 回收
```

★ **L7/L8/L9 在日期上早于 L4/L5/L6** —— 因为前者是 10-05 那条冲刺线，后者是 10-06 之后补齐的。
下面按**能力依赖**排列（注册表先有，判据才挂得上），并在每层标注真实引入日期。

---

## 2. ★ 核心层：判据注册表化（本 fork 的由来）

**这是回答「为什么 fork」的那一层。**

| 项 | 内容 |
|---|---|
| **入口文件** | `src/gates/registry.ts`（1,012 行）、`src/gates/index.ts`（554 行） |
| **关键符号** | `INSERTION_POINTS`（`registry.ts:288`）、`GateVerdict`（`registry.ts:44`）、`createGateRegistry()`（`:462`）、`evaluate()`（`:646`）、`ALL_GATES`（`index.ts:305`，★ **module-local，非导出** —— 只用给同文件的 `buildRegistry()`）、`asRegistration()`（`index.ts:419`）、`buildRegistry()`（`:459`）、`registry`（`:468`） |
| **达成的功能** | 判据从「一个 1233 行文件里的 52 个平铺 export」变成「**一条判据一个文件**，装配清单一行」。编排层只调 `registry.evaluate(point, ctx)`，**不知道任何判据的名字或语义**。 |
| **调用点数** | `registry.evaluate(...)` 在**源码里只有 6 处调用**（§下）。★ 精确口径：本口径**只覆盖带 `registry.` 前缀的写法**；已知 unprefixed 提及 1 处（`registry.ts:850` 写作 `evaluate('completion', …)`）**已单列**，不计入 6 处。★ 另：`grep -rn "registry.evaluate('completion'" src/` 会命中 **6 处**，但其中**只有 1 处是真代码**（`completion.ts:672`），**另 5 处是注释里的提及**（`verify-rerun.ts:19`、`update-task.ts:13`、`update-task.ts:916`、`quality-gates.ts:1624`、`tools.ts:225`）。**统计调用点时必须排除注释行**，否则「6 个调用点」会读成 11 个。复跑：`grep -rn "registry.evaluate(" src/ --include=*.ts \| grep -vE ":[0-9]+: *(\*\|//)"` |
| **上游侵入点** | **零**。`src/gates/` 在上游**整个目录不存在**（`git ls-tree -r upstream/main -- src/gates \| wc -l` ⇒ 0）。这是纯新增。 |
| **引入 commit** | `d38de30`（"gates: insertion-point registry (three-state verdicts, no short-circuit)"）、`70c8c96`（把第一条真判据搬进注册表）、`3b4f0a8`（装配契约 + 形状校验） |

### 六个插入点（时间顺序）

`src/gates/registry.ts:288`：

```ts
export const INSERTION_POINTS = Object.freeze([
  'admission',   // ⓪ 成团【之前】：够不够格进场
  'contract',    // ① 建任务 / 改契约
  'dispatch',    // ② 派发前（成员开工）
  'completion',  // ③ 成员汇报完成
  'delivery',    // ④ 团队宣布交付
  'runtime',     // ⑤ 全程（跨步骤；告警，不直接拒任务）
])
```

> ★ 同一处注释（`registry.ts:285`）逐字写明：**位置数组的顺序是给控制台与普查读的，不是流程顺序的判据 —— 流程顺序由调用方决定，注册表不认识它。**
> 实测：`admission` 是第一个元素，而它**在流程上也确实最早**（成团之前）。两者一致，但这是巧合而非机制 —— 图里画了流程箭头，那是调用方的顺序。

### 三态裁决（不是两态）

`src/gates/registry.ts:44` 定义 `GateVerdict` 为三支联合：

| 形态 | 含义 | 行号 |
|---|---|---|
| `{ ok: true }` | 测了，没问题 | `registry.ts:45` |
| `{ ok: false, blockers: [...] }` | 测了，发现问题（必须说清为什么） | `:46` |
| `{ ok: false, unmeasured: string }` | ★ 没能测量 | `:47-70` |

**存在的理由**（`registry.ts:302` 逐字）：`unmeasured` 在日志里与 `ok` **同形**。一条从未生效的判据，读起来是「判据通过」。
这个 fork 里被反复记录的形态就是这一条 —— 例如 `src/gates/completion/verify-rerun.ts:38-46` 逐字记着：

> `execVerifyCommand` 曾经没接上 ⇒ 判据照常跑、照常说话，说的是 `unmeasured`。而 `unmeasured` 与 `ok` 在日志里**同形** —— 读的人看到的是"这一步没问题"。一次【判据从未生效】被读成了【判据通过】。

### 不变量：「全跳过 ≠ 都通过」

`src/gates/registry.ts:890` 的三行表（逐字）：

```
┌ 空位置（registered === 0）        ok:true  · skippedAll 缺席     ← 正常
├ 全跳过（registered>0, eval===0）   ok:false · skippedAll 在场     ← 本任务修的那个
└ 判据报 unmeasured（eval >= 1）     ok:false · unmeasured 在场     ← 判据层的结论
```

实现：`registry.ts:841` `const allSkipped = registered > 0 && evaluated === 0`；`:898` `allSkippedVerdict`；字段声明 `skippedAll?: string` 在 `:205`。

**为什么重要**：`appliesTo` 为假的判据会被注册表**直接跳过**（`registry.ts:679`）。一次派发上 17 条判据可能全被跳过 —— 若那读作 `ok:true`，就是「没检查」被读成「检查过且通过」。修在 `6345750`（"fix: an all-skipped position stops reporting ok (t58, never committed)"）。

★ 注意 commit message 里那句 `(t58, never committed)` —— 这个 fix 在文档 `b0337e1` 里被记过「never got committed」，实际落点是 `6345750`。**这是「文档与代码不同步」的一个真实样本**，此处以代码为准。

### 装配层的形状校验（防「少写一个导出静默生效」）

`src/gates/index.ts:419` `asRegistration()` 显式校验四件（`:421` missing 检查、`:425` gate 非函数、`:428` appliesTo 非函数）。

理由写在 `index.ts:409-413`，是实测的：

> `register()` 只在【真的读了那个字段】时才发现它有问题 —— 一个模块若把 `appliesTo` 导出成非函数（例如常数 `true`），`typeof module.appliesTo === 'function'` 为假 ⇒ 它被静默丢掉，而 `register` 永远看不见 ⇒ **一条只对某些 kind 生效的判据会变成对全部 kind 生效**，且没有任何地方报错。

★ 这里还有一个「声明写对了、机制也建好了、而中间那个白名单没列它」的缺陷记录（`index.ts:439-455`）：`asRegistration` 一度只转发 `id/point/description/gate/appliesTo`，**不转发 `requires`** ⇒ `registry.list()` 读出来 `hasRequires: false`，「声明了输入面」与「压根没声明」在控制台上同形。

---

## 3. 17 条判据（按插入点）

**计数命令**（实测 ⇒ 17）：
```sh
grep -rn "^export const id = '" src/gates/*/*.ts | wc -l
```

★ **`src/gates/completion/kind-requirements.ts` 不是判据**：它是数据/解析模块，`grep -c "export const id"` ⇒ **0**。
它自己的文件头（`kind-requirements.ts:6`）逐字写着「**它不是一条判据**」，理由是三条完工门都要读这张表，而判据之间**不许互相 import**，所以表必须住在「不是判据」的地方。
同类的还有 `src/gates/requires.ts`（859 行，输入面核对）与 `src/gates/budget-stop.ts`（墙钟预算）。

### ⓠ admission（3 条）— 成团之前

| id | 入口文件 | 关键符号 | 达成的功能 | 上游侵入 | 引入 commit |
|---|---|---|---|---|---|
| `admission.absorb` | `src/gates/admission/absorb.ts` | `id:71` `point:72` `appliesTo:268` | 把主会话自报的「已吸收审查意见」与真实痕迹比对：产物必须真的变了，或明确记下「无需改」；只声称却一行未动即拒绝 | **零**（新目录） | `621e152` (10-06) |
| `admission.checkpoint` | `src/gates/admission/checkpoint.ts` | `id:88` `point:89` `appliesTo:238` | 产物**现在**的 git 版本 vs **上次审查时**的版本：有未审改动 ⇒ 触发对抗性审查（告警，不拒流程） | **零** | `621e152` (10-06) |
| `admission.convene` | `src/gates/admission/convene.ts` | `id:123` `point:124` `appliesTo:449` | 自动成团四条件：产物非空 + 无未审改动（读 checkpoint 结论）+ 无待确认问题 + 吸收成立（读 absorb 结论） | **零** | `ad7a3ed` (10-06) |

**闸门（`appliesTo` 实测条件）**：
- `absorb`：`claims ∈ {CLAIMED_ABSORBED, CLAIMED_NOTHING}`（`absorb.ts:268-271`）—— 即「这一轮有没有人声称吸收了」
- `checkpoint`：`Array.isArray(ctx.documents)`（`checkpoint.ts:238-249`）—— ★ 用 `Array.isArray` 而不是 `!== undefined`，刻意让「形状错」读作「这一轮没说话」（`:241-247` 有说明）
- `convene`：`return true`（`convene.ts:449-451`）—— **恒适用**

★ `admission` 位置是后加的：`index.ts:71` 逐字记着「本任务（t5）**只加位置，一条判据都不加**，所以这个位置现在是空的」，`index.ts:74` 又写「任何夹具都不许把' admission 现在没有判据'写成断言：接上第一条判据的那一刻它就会按设计变红」。
⇒ 那三条判据是 `621e152` / `ad7a3ed` 后来挂上去的。**这条「不许把空位置写成断言」的纪律，正是为了防「空位置」被误读成「都通过」。**

### ⓞ contract（3 条）— 建任务 / 改契约那一刻

| id | 入口文件 | 关键符号 | 达成的功能 | 上游侵入 | 引入 commit |
|---|---|---|---|---|---|
| `contract.build-artifact-scope` | `src/gates/contract/build-artifact-scope.ts` | `id:42` `appliesTo:236` | `inScope` 声明了 `src/` 下的文件却漏了对应 `lib/` 构建产物 ⇒ 提示（本仓强制 lib/ 与 src/ 同步） | **零** | `2370145` (10-06) |
| `contract.verify-command` | `src/gates/contract/verify-command.ts` | `id:63` `appliesTo:586` `VERIFY_COMMAND_GATE_ID:76` | verify 命令必须**可判**：既能为做对的工作变绿、也能为做错的工作变红。空命令、写死真/假、拿 `-x` 比命令输出都会被说清 | **零** | `2370145` (10-06) |
| `contract.task-atomicity` | `src/gates/contract/task-atomicity.ts` | `id:126` `appliesTo:650` `QUALITY_KINDS:216` | 判**声明面的形状**（不是「够不够原子」）：一个目录前缀是否被文件路径覆盖 | **零** | `485ec9e` (10-07) |

**闸门**：
- `build-artifact-scope` / `verify-command`：都是 `ctx?.task !== undefined`（`build-artifact-scope.ts:236-238`、`verify-command.ts:586-588`）
- `task-atomicity`：`QUALITY_KINDS.has(task.kind ?? 'work')`，其中 `QUALITY_KINDS = {requirements, implementation, verification, review, repair, integration}`（`task-atomicity.ts:650-655`，集合在 `:216-218`）

★ `task-atomicity` 有一段值得单独记的实测（`task-atomicity.ts:129-141`）：它一度**实际只做 `path.trim().endsWith('/')`** —— 「判的是字符串最后一个字符」。
t43 用**同一件工作**证伪：`['src/registry.ts','src/index.ts']`（ok）与它加上一个 `'src/'`（blocked），**两边工作完全相同而裁决相反**。
修法是「归一化之后的目录前缀 + 集合覆盖」（`uncoveredDirectoryPrefixes`），现在 `'src/'` 与 `'src'` 是**同一个键** ⇒ 同裁。
**这条是「一个判据判错了东西」的最佳样本：它一直在跑、一直在说话，只是说的不是它声称在说的事。**

### ⓞ dispatch（3 条）— 派发前

| id | 入口文件 | 关键符号 | 达成的功能 | 上游侵入 | 引入 commit |
|---|---|---|---|---|---|
| `dispatch.changed-paths` | `src/gates/dispatch/changed-paths.ts` | `id:49` `appliesTo:160` | 把成员自报的 `changedPaths` 与**它会话里观察到的真实写入**比对；虚报或隐瞒即拒绝 | **零** | `626c59d` (10-05) |
| `dispatch.worktree` | `src/gates/dispatch/worktree.ts` | `id:77` `appliesTo:169` | 核对声明的工作是否真的落在隔离 worktree 里、且没落到主检出；读不到 worktree 即「未测量」 | **零** | `0657f65` (10-05) |
| `dispatch.plan-reviewed` | `src/gates/dispatch/plan-reviewed.ts` | `id:67` `appliesTo:114` `requires:82` | 这份计划**审过了吗**：带 `reviewed` 且五问无 fail/unmeasured ⇒ 放行 | **零** | `5520399` (10-09) |

**闸门**：
- `changed-paths` / `worktree`：**同一套口径**（刻意逐字相同，便于普查臂用同一条口径核对）：
  ```ts
  const kind = ctx?.task?.kind
  if (kind !== 'implementation' && kind !== 'repair') return false
  return Array.isArray(ctx?.update?.changedPaths) && ctx.update.changedPaths.length > 0
  ```
  （`changed-paths.ts:160-163`、`worktree.ts:169-172`）
- `plan-reviewed`：`有 task` 且 `!predatesThisGate(task)`（`plan-reviewed.ts:114-` 末尾）

★ `plan-reviewed` 的闸门有一段**极重要**的实测记录（`plan-reviewed.ts:114` 上方长注释）：

> MEASURED：本队 **39 条任务里 0 条**带 `reviewed` 戳，而**全部建于**这道门之前 ⇒ 这道门对它们一律开口 ⇒ **每一次状态转换都被拒** ⇒ 全队停摆。

第一版把存量落成 `unmeasured` —— 那**违反了一条跨层规则**（`docs/GATE-REGISTRY.md` 规则一）：
> 「可判定的事实」不得写成「没能测量」；正确的表达：**不适用 ⇒ `ok`**。

因为「这条任务早于闸门」是**完全可判定**的（`createdAt` 是个数、上线时刻是常量），所以它的正确落点是 **`appliesTo` 返回 false**，而不是在 `gate` 里造一个假的三态 —— **只有前者能让注册表如实报 `skipped`**，而「跳过了」与「跑了而结论是通过」是不同形的两件事。

相关 commit：`eb72d3b`、`a6216f4`（"a gate that postdates a task does not apply to it -- not unmeasured"）。

### ⓞ completion（4 条）— 成员汇报完成

| id | 入口文件 | 关键符号 | 达成的功能 | 上游侵入 | 引入 commit |
|---|---|---|---|---|---|
| `completion.verify-rerun` | `src/gates/completion/verify-rerun.ts` | `id:32` `appliesTo:85` | 重跑任务声明的 verify 命令，与成员自报的 `exitCode` 比对；不一致即拒绝（防伪造 passed） | **零** | `70c8c96` (10-05) |
| `completion.r5` | `src/gates/completion/r5.ts` | `id:95` `appliesTo:118` | 把新测试在**父版本**（worktree 的 base）上跑一遍：**必须先红**；再到修复版本上必须绿 | **零** | `ebbacce` (10-05) |
| `completion.mutation` | `src/gates/completion/mutation.ts` | `id:80` `appliesTo:238` | 对**改动行范围**注入 L1/L2/L3 变异体并重跑杀手套件：变异体存活即拒绝；套件够不到被变异文件 ⇒ unmeasured | **零** | `c396e71` (10-05) |
| `completion.backtest` | `src/gates/completion/backtest.ts` | `id:82` `appliesTo:360` | 按依赖图选测并跑全量，证明改动没把别处改坏；基准不绿或选测来源不明即拒绝/未测量 | **零** | `27e9613` (10-05) |

**闸门**：
- `verify-rerun`：`wantsCompleted === true && taskNotTerminal === true && Array.isArray(task.verify) && task.verify.length > 0`（`verify-rerun.ts:85-89`，**硬编码，不问表**）
- `r5` / `mutation` / `backtest`：**都先问 kind 需求表**（见 §6），再叠各自的第二守卫：
  - `r5`：再要 `wantsCompleted && taskNotTerminal`，且 `update.newTestFiles` 是数组（`r5.ts:118-`）
  - `mutation`：再要 `wantsCompleted && taskNotTerminal`（`mutation.ts:238-`）
  - `backtest`：再要「声明了改动文件（`update.changedPaths` 或 `ctx.changedPaths` 非空）」（`backtest.ts:360-`）

★ **位置内顺序 = 求值顺序**（注册表按注册顺序跑，`index.ts:300-303` 逐字）：
`verify-rerun → changedPaths → worktree → r5 → mutation → backtest → …`
设计意图是「先跑便宜的机械判据，后跑要起进程的」（`index.ts:42-43`）。

### ⓞ delivery（2 条）— 团队宣布交付

| id | 入口文件 | 关键符号 | 达成的功能 | 上游侵入 | 引入 commit |
|---|---|---|---|---|---|
| `delivery.coverage` | `src/gates/delivery/coverage.ts` | `id:49` `appliesTo:191` | 用户目标的**每个条目**都必须有任务声称覆盖它；有目标无人认领 ⇒ 交付时拒绝 | **零** | `2370145` (10-06) |
| `delivery.convergence` | `src/gates/delivery/convergence.ts` | `id:73` `appliesTo:181` | 交付时每个成员都必须处在**收敛态**；`working`/`unknown`/空白回复都不是收敛 ⇒ 拒绝 | **零** | `2370145` (10-06) |

**闸门**：两条都是 `ctx?.team !== undefined`（`coverage.ts:191-193`、`convergence.ts:181-183`）。

**位置内顺序**：`coverage → convergence`（`index.ts:113-114` 逐字：「先问'有没有人做'，再问'做的人收敛了没有' —— 一个没人认领的目标谈不上'那个人的收敛'」）。

★ 两条都**故意不在 `requires` 里声明**它们读的那一格（`coverage.ts:55-65`、`convergence.ts:79-88`）：`coverage` 矩阵缺席**恰好就是** `unmeasured` 那一行的输入 —— 把它写进 `requires`，「核对层会在同一个事实上报第二遍」。

### ⓞ runtime（2 条）— 横跨全过程

| id | 入口文件 | 关键符号 | 达成的功能 | 上游侵入 | 引入 commit |
|---|---|---|---|---|---|
| `runtime.liveness` | `src/gates/runtime/liveness.ts` | `id:64` `appliesTo:163` `LIVENESS_EVENTS:161` | 周期性探活：两次探活之间最后活动时刻没变 ⇒ 告警「卡死了」；还在活动 ⇒ 只报「还在跑，已 N 分钟」 | **零** | `0b01104` (10-06) |
| `runtime.stall` | `src/gates/runtime/stall.ts` | `id:60` `appliesTo:127` `STALL_EVENTS:84` | 判「这个任务是不是停下来了」：同一个 (task, gate) 被拒次数 ≥ N，或任务在 in_progress 上超过 N 轮 | **零** | `5bc5b45` (10-11 合并) |

**闸门**：
- `liveness`：`typeof ctx?.event === 'string' && LIVENESS_EVENTS.includes(ctx.event)`，其中 `LIVENESS_EVENTS = ['task-status', 'runtime-liveness']`（`liveness.ts:161-165`）
- `stall`：`STALL_EVENTS.includes(String(ctx.event))`，其中 `STALL_EVENTS = ['task-status', 'task-update-settled', 'delivery-declared']`（`stall.ts:84`、`:127-130`）

★ **runtime 位置的结构性纪律**（`index.ts:344-351` 逐字）：
> 契约 §5 硬要求 runtime **不得拒绝任务** —— 六处调用点拿到的裁决只用于 `judgeRuntimeGates(...)` 记录（`src/tools.ts`），**不进任何控制流**。

`stall` 把这条从**约定**升级为**编译期事实**：它的返回类型收窄到 `GateVerdict` 里**不拒绝的那一半**（`StallVerdict`）—— 写 `return blocked([...])` 当场 TS2322（`stall.ts:70-75`）。
`liveness` 则靠「约定 + 调用方」：`onDispatched` 返回 `void`，回调在 `if (accepted)` 之内。

★ `liveness` 是**本插件第一条带状态的判据**（比较这次探活与上次探活），但状态由**调用方**持有，判据本身仍是纯函数（`index.ts:130-131`）。
三个「只有踩了才知道」的坑记在 `docs/START-HERE.md:79-92`，本文回源核对过 `liveness.ts` —— **一致**。

---

## 4. 输入面声明层（`requires`）

| 项 | 内容 |
|---|---|
| **入口文件** | `src/gates/requires.ts`（859 行） |
| **关键符号** | `auditGateRequires`、`requires` 导出（17 条判据里多数声明了它）、`GateRoute`/`gateModuleViews()`（`index.ts:489`/`:542`） |
| **达成的功能** | 判据自己声明「我无条件读哪几格」；注册表与调用方在**求值之前**按这份声明核对真实 `ctx`，报出 `checked / incomplete / skipped / missing` |
| **上游侵入点** | **零**（新目录） |
| **引入 commit** | `f7bbf65` (10-06)「gate: gates declare their input surface, and the registry audits it」、`a5d3dce`「all eleven gates declare their input surface」、`add7444`、`2065e21` |

**它解决的问题**（`index.ts:477-483` 逐字）：
> 如果核对层自己另判一遍（或干脆不判、无条件核对），它就会在 88 种组合里的大部分上喊"缺这缺那"，而那些组合**本来就该不适用**。**噪音会教人忽略门禁 —— 与误报同样有害。**

**核对的前提是「适不适用」**，而那条真值只有一份：注册表（`index.ts:527-541` 逐字记着一次实测）：
> 第一版按**静态的 `ALL_GATES`** 遍历 …… `ALL_GATES` 只有**装配时**那 11 条，于是运行期 `registry.register(...)` 加进来的判据在核对层里**根本不存在** ⇒ 核对报出的是一份**关于别的判据**的结论 —— 而那份结论读起来完全正常（`incomplete: 0`，一切齐整）。

⇒ 定论：**接线表不许有两个来源**。装配清单只是把判据送进注册表的一个入口，不是第二份表。

★ 注意「**11 条**」这个数字在 `index.ts:527-541` 是**历史记录**（写那段注释时的实测），不是现状。现状是 17 条（§3）。**注释里的历史数字不算过期文档，但读者必须能分辨**——本文在此标出。

★ 「不适用 ⇒ 不核对、不报缺失」这条闸门在 `registry.ts:679-703`，其中 `:689-698` 记录了 `skipReason` 恒为 `'caller'` 的缺陷（`'input-surface-absent'` 永远不会出现在生产路径上）。

---

## 5. 工具面拆分（16 个工具停止共用一个文件）

| 项 | 内容 |
|---|---|
| **入口文件** | `src/tools.ts`（2,227 行，**仍在**）+ `src/tools/*.ts`（16 个）+ `src/tools/shared/entities.ts`（4,691 行） |
| **关键符号** | `registry.evaluate` 的 6 个调用点；`TEAM_TOOL_NAMES`（15）/ `MEMBER_TOOL_NAMES`（4）/ `CAPTAIN_TOOL_NAMES`（差集） |
| **达成的功能** | 上游的 2,877 行 `src/tools.ts` 拆成「每个工具一个文件 + 一个共享实体层」，于是判据的调用点落在**它对应的那个位置文件**里 |
| **上游侵入点** | ★ **`src/tools.ts` 被大改**：`+1685 / -2335`（two-dot；上游保留该文件，但内容大幅变动） |
| **引入 commit** | `9779c58` (10-07)「refactor: sixteen tools stop sharing one file」 |

### 新增的工具文件（相对上游，全部为新增）

```
src/tools/amend-task.ts      138   src/tools/approve.ts         46   src/tools/claim.ts          117
src/tools/create-task.ts    1010   src/tools/create.ts         202   src/tools/delete.ts          70
src/tools/delivery.ts        169   src/tools/edit-plan.ts      346   src/tools/members.ts        173
src/tools/message.ts         151   src/tools/reassign.ts       147   src/tools/restart.ts        179
src/tools/resume.ts           67   src/tools/status.ts         923   src/tools/update-task.ts   2066
src/tools/shared/entities.ts 4691
src/tools/update-task/completion.ts 711   src/tools/update-task/dispatch.ts 119
```

★ **这一步是「为了接线」的**，不是洁癖：判据的调用点必须落在正确的位置。
`d231f74`（"fix(t39): move the dispatch evaluation to where dispatch actually happens"）与 `e7c889c`（"refactor: update-task stops carrying two whole positions in one file"）都指向同一个动机。

### 新增的两个工具名（★ 对上游 `tool-names.ts` 的直接侵入）

`git diff upstream/main...HEAD -- src/tool-names.ts` 实测 **+14 / -0**，只加两行有效内容：

| 工具名 | 引入 commit | 达成的功能 | 上游侵入点 |
|---|---|---|---|
| `agent_teams_declare_delivery` | （t18/B2） | 交付的**宣告点**：读取（status）只报告，宣告才被拒绝 | `src/tool-names.ts` 第 10 行后 |
| `agent_teams_restart` | `46eb6bc` (10-14) | captain-only 的**重载**：必须登记，否则「captain-only」只在运行时成立、在**可见性**上不成立 | `src/tool-names.ts` 第 21 行 |

**为什么这两行是「侵入点」而非「新增」**：`tool-names.ts:14-15` 逐字：
> deny 列表由 `TEAM_TOOL_NAMES` 减去 `MEMBER_TOOL_NAMES` 算出，所以【没进这张表 = 没进 deny 列表 = 成员看得见】。

⇒ 这是一处**改动上游文件内容**的地方。但它只有 14 行新增、0 行删除，**冲突面极小** —— 这正是「注册表化」那套纪律在别处的同一种应用。

**工具面计数**：`TEAM_TOOL_NAMES` = 15（`tool-names.ts:2-22`）、`MEMBER_TOOL_NAMES` = 4（`:24-26`）、`CAPTAIN_TOOL_NAMES` = 差集 = 11。

---

## 6. kind 需求表层（「哪些 kind 要哪几道完工门」变成数据）

| 项 | 内容 |
|---|---|
| **入口文件** | `src/gates/completion/kind-requirements.ts`（类型 + 校验器）、`src/gates/completion/kind-requirements.json`（**表本身**） |
| **关键符号** | `gateRequirementFor()`、`loadKindRequirementsOfHost()`、`parseKindRequirements()`、三态 `required` / `not-required` / `unknown` |
| **达成的功能** | 完工门要开在哪几个 kind 上，**从代码挪进运行时可读的数据** ⇒ 改表不需要重载插件 |
| **上游侵入点** | **零**（新文件） |
| **引入 commit** | `f8fc671` (10-08)「feat: which completion gates apply is now data, not a hardcoded pair of kinds」 |

**它修的是什么**（`kind-requirements.json` 的 `_why` 字段逐字）：
> 那三条门此前各自写死 `kind !== implementation && kind !== repair` ⇒ 而 `TASK_KINDS` 有 7 个 ⇒ 5 个 kind **完全没有完工门**。★ 而那【不是设计】—— 没有任何地方说 verification 类任务不需要新测试，它只是【默认】。⇒ 表把默认变成决定：每一个 kind 都要明写它要什么，或明写它为什么不要。量化：今天 51 个真实任务里 15 个（29%）属于无门的 kind。

`TASK_KINDS` 的 7 个值见 `src/types.ts:122-130`：`requirements / implementation / verification / review / repair / integration / work`。

**三态的去处**（`r5.ts:118-` 逐字）：
- `required` ⇒ 门生效
- `not-required` ⇒ 门按**有理由的决定**闭嘴（表里有 `because`）
- `unknown` ⇒ ★ **不是**「不需要门」—— 门仍然不说话，但那一轮由 `gate()` 报 `unmeasured`（**不静默通过**）

★ JSON 里有一段 `_history`（`verification` 条目）记着一次**数据与它自己的理由互相矛盾**的缺陷：`because` 一直写 `Not required: r5`，而 `requiredGates` 里却放着 `completion.r5`。
真跑之后：verification 任务按定义不新增测试 ⇒ r5 开火后必然落 `unmeasured` ⇒ 而完工位置对 `unmeasured` 的处置是拒绝 ⇒ **每个 verification 任务都无法完工**。
⇒ 结论逐字：「那不是'严格'，是一条**永远不能为真的门**」。修法是删掉 r5，保留 `because`。

**这条是本清单里最有价值的一例**：它证明「数据化的表」不是装饰 —— 表把「默认」变成了**可被审计、可被证伪的决定**。

---

## 7. 其余各层（清单式）

### 7.1 worktree 隔离

| 项 | 内容 |
|---|---|
| **入口文件** | `src/worktree.ts`（1,296 行，**新增文件**） |
| **关键符号** | `createTaskWorktree()`（`:213`）、`detectWorktreeSupport()`（`:111`）、`provisionWorktreeDependencies()`（`:454`）、`commitWorktree()`（`:599`）、`judgeWorktreeReclaimable()`（`:814`）、`worktreePromptLine()`（`:528`） |
| **达成的功能** | 每个任务一个 **detached 检出**，解决「版本」问题；隔离是**机制**而非提示 —— 建不出就拒，降级要如实记录 |
| **上游侵入点** | 零（新文件）；但 `src/scheduler.ts` 有 **+738 / -46** 改动（two-dot：`git diff --numstat upstream/main HEAD -- src/scheduler.ts`）去调它 |
| **引入 commit** | `68ee2c8` (10-05)、`0657f65` (10-05)、`5441b81`（硬链接依赖 + 自动回收）、`acbb866`、`ae6aa94`（重启看门狗） |

### 7.2 变异测试 L1/L2/L3

| 项 | 内容 |
|---|---|
| **入口文件** | `src/mutation.ts`（1,705 行，**新增**）、`src/mutation-guard.ts`（419 行，**新增**） |
| **关键符号** | `L1_OPERATORS`（`:65`）、`L2_OPERATORS`（`:78`）、`MutationLayer`（`:56`）、`generateMutants()`（`:504`）、`probeReach()`（`:668`）、`classifyRun()`（`:793`）、`MIN_SCORED_FOR_VERDICT = 20`（`:169`）、`checkMutationGuard()`（`mutation-guard.ts:226`） |
| **达成的功能** | 对改动行注入变异体并重跑杀手套件：**变异的对象是「测试有没有鉴别力」，不是「代码对不对」** |
| **上游侵入点** | 零（新文件） |
| **引入 commit** | `c396e71` (10-05) |

★ 相关裁定（`docs/THREE-LINE-PLAN.md:24-32`，回源核对 `src/mutation.ts` 一致）：
`scored = killed | survived`；分数分母 = `scored + uncovered`（保守）；**地板只读 `scored`**。
理由：`uncovered` 并进 `scored` 会让「一行覆盖都没有」时 `scored = 40` ⇒ **越过 20 地板拿到「0 分」裁决** —— 而「一行都没跑」本该是 `unmeasured`。

### 7.3 backtest 基线归因

| 项 | 内容 |
|---|---|
| **入口文件** | `src/gates/completion/backtest.ts`（869 行）、`docs/BASELINE-RED.md` |
| **关键符号** | 基准绿前置 + 选测 + 全量 + 基线 |
| **达成的功能** | 「基准必须先绿，否则无法归因」—— 一条关于代码的结论，不许由一次基础设施工况伪装出来 |
| **上游侵入点** | 零 |
| **引入 commit** | `27e9613` (10-05)、`25e8f94`（"backtest can attribute again — pin the known failures"）、`d334c0d`（"the gate's rerun no longer erases the failure names the member reported"） |

### 7.4 故障隔离外壳

| 项 | 内容 |
|---|---|
| **入口文件** | `src/web-routes.ts`（**新增文件**，+200 行） |
| **关键符号** | `pluginShell()`、`ShellStage`（`'import' \| 'apply'`）、`DegradedEntry`、三态 `healthy` / `degraded` / `not-mounted` |
| **达成的功能** | AgentTeams 自己的缺陷**只让它自己降级**，不牵连宿主 UI |
| **上游侵入点** | `src/web-routes.ts` 上游存在（98 行）→ 现在 200 行；调用方 `src/index.ts:48` |
| **引入 commit** | `64389b0` (10-11 合并)、`f3924c0` |

★ 关键实测（`web-routes.ts:17-27` 逐字）：`ctx.plugin()` 对 `apply()` 抛错**已经**是隔离的，但**错误只落进一行日志**。⇒ 本模块不是「让 cordis 别崩」，而是**把那个失败变成可查询的**。
第三态 `not-mounted` **不许**并进 `healthy`：一个「从没尝试挂载」的插件与一个「挂好了」的插件，在只读 `healthy/degraded` 的实现里**同形**。
★ 反向半边（`:40-45`）：外壳**永不抛错**，所以必须**同时**把失败说清楚 —— 「一个吞掉异常然后报健康的外壳，比不隔离更坏」。

### 7.5 计划编排（staging plan）

| 项 | 内容 |
|---|---|
| **入口文件** | `src/client/StagingPlanEditor.tsx`（981 行，**上游已有**，fork +153/-1）、`src/tools/edit-plan.ts`（346 行，新增）、`src/tools.ts` 的 `stagedPlan*Context()`（`:596`/`:606`/`:616`） |
| **达成的功能** | 分段批准的计划编辑；`dispatch.plan-reviewed` 是这条路由在判据层的落点 |
| **上游侵入点** | `StagingPlanEditor.tsx`（+153/-1）；`src/client/locales.ts`（+81） |
| **引入 commit** | `2fe95cc`（"review moves to the moment of generation, and the contract carries the stamp"）、`b982861`、`c3ca7ac`、`ee6ed6d` |

★ `dispatch.plan-reviewed` 补上的正是 `docs/PLAN-REVIEW.md` §8 里那条**没有人读**的准入条件（`index.ts:216-218` 逐字）：
> ① 值得做 ② **审查通过（带 `reviewed`）** ③ 分档是【小档】⇒ 在本次接线之前，② 只活在文档里。

### 7.6 UI 层（`src/client/`）

**新增 13 个文件**（`comm -13` 实测）：

| 文件 | 行数 | 引入 commit | 达成的功能 |
|---|---:|---|---|
| `src/client/MemberRow.tsx` | 453 | `2386323` (10-11) | 成员行展开/折叠（`e889922` 修「展开后一行一个字」） |
| `src/client/MemberScreen.tsx` | 214 | `fa023f6` (10-12) | 每个成员一屏（R4） |
| `src/client/MemberClock.tsx` | 128 | `2386323` | 成员时钟（`08db8dc` 修「空闲成员显示等待 12 小时」） |
| `src/client/DependencyGraph.tsx` | 258 | `3ce3e76` (10-11) | 第二屏变成纯依赖图（R3） |
| `src/client/ProgressSummary.tsx` | 98 | `fa023f6` | 进度汇总 |
| `src/client/CaptainNode.tsx` | 88 | `fa023f6` | 队长节点 |
| `src/client/roster-settings.tsx` | 203 | `b331ab7` (10-11) | 名册与模型选择从 GUI 可达（t20） |
| `src/client/SessionIdAction.tsx` | 131 | `12d822b` (10-13) | 从页头复制会话 id |
| `src/client/session-id-chip.ts` | 121 | `12d822b` | 会话 id 芯片逻辑 |
| `src/client/MemberClock.module.css` | — | `2386323` | — |
| `src/client/ProgressSummary.module.css` | — | `fa023f6` | — |
| `src/client/SessionIdAction.module.css` | 67 | `12d822b` | — |
| `src/client/roster-settings.module.css` | 151 | `b331ab7` | — |

**大幅修改的上游文件**：
`ActivityPanel.tsx`（+94/-530，**变小了** —— 拆分）、`ActivityPanel.module.css`（+564/-356）、`activity-model.ts`（+721/-0）、`activity-monitor.ts`（+200/-6）、`locales.ts`（+81/-0）、`index.tsx`（+55/-0）、`icons.tsx`（+6/-0）、`WorkspaceActivity.tsx`（+1/-1）。★ 全部为 two-dot 口径（`git diff --numstat upstream/main HEAD -- <f>`）。

★ 注意 `ActivityPanel.tsx` 是**净减少**的（-530）：新增的 13 个文件就是它拆出去的部分。这与 `src/tools.ts` 的拆分同构 —— **一个文件变多个文件，能力增加而非重写**。

### 7.7 硬化与计量

| 模块 | 入口 | 引入 commit | 功能 |
|---|---|---|---|
| 完工链墙钟预算 | `src/gates/budget-stop.ts` | `887d98a` (10-12) | 给完工链一个墙钟预算，并接上一条**此前是死的**配额 |
| worktree 自动回收 | `src/worktree.ts`（`judgeWorktreeReclaimable`）+ `scripts/worktree-reclaim.mjs` | `5441b81`、`02976b4`（19.6s 的回收扫描**阻塞了每一次完工**）、`69b9be6` | 回收 worktree 且不留下台账幽灵 |
| HMR 重载痕迹 | `src/hmr-trace.ts`（**新增**） | `f224b91` (10-10) | 记录重载轨迹 |
| 重启看门狗 | `scripts/restart-watchdog.sh` + `ae6aa94` | `ae6aa94` (10-11) | 「三条**实测**理由说明它为什么不能完全自动化」 |
| 摩擦台账 | `src/gates/dispatch/` 相关 + `46eb6bc` | `46eb6bc` (10-14) | 派发点的摩擦台账，并用一条闸门臂钉住 |

---

## 8. ★ 对上游的侵入点全景（fork 的真实成本）

用户 fork 的动机是「上游同步会冲突」，所以**这一节是本清单的重点**。

### 8.1 fork 相对上游 `HEAD` 的文件改动量（two-dot，按改动量排序）

**★ 口径（与本文上一版不同，务必读）**：本表用 **two-dot**：

```sh
git diff --numstat upstream/main HEAD -- src/ | sort -k1 -rn
```

**为什么换掉 three-dot**：上一版用的是 `git diff --numstat upstream/main...HEAD`（three-dot）。
three-dot 比较的是 **`upstream/main` 与 `HEAD` 的 merge-base（`98aac03`）对 `HEAD` 的差**，
**它看不见上游自己在 fork 之后做的改动** —— 于是「上游删了 958 行、fork 又写了别的」这种双向改动，
在 three-dot 里**只显示 fork 那一侧的净增**，读起来像「只增不删」。

实测对拍（同一文件，两个口径给出的结论相反）：

| 文件 | three-dot（旧，误导） | two-dot（本表） | 差在哪 |
|---|---|---|---|
| `src/quality-gates.ts` | `+1295 / -8` | **`+1369 / -958`** | 上游删了 958 行，three-dot 看不见 |
| `src/harness-compat.ts` | `+466 / -0` | **`+489 / -80`** | 上游删了 80 行 |
| `src/client/activity-monitor.ts` | `+202 / -0` | **`+200 / -6`** | 上游删了 6 行 |
| `src/web-routes.ts` | `+200 / -0` | `+200 / -0` | ✅ 两种口径相同（真·只增） |

⇒ **本表列的是「fork 相对上游 `HEAD` 的改动量」。** 它是同步冲突面的一个**上界近似**，
**不等于「上游冲突面」本身** —— 真正的冲突面取决于上游**之后**怎么改这些文件，那件事任何 diff 都测不出来。

| 上游文件 | 改动（two-dot） | 改动性质 |
|---|---|---|
| `src/tools.ts` | **+1685 / -2335** | ★★★ 大宗改动：工具拆出去了（双向） |
| `src/quality-gates.ts` | **+1369 / -958** | ★★ 双向：判据搬出去，同时上游改动被覆盖 |
| `src/scheduler.ts` | +738 / -46 | ★★ worktree 派发、队列、停滞检测 |
| `src/members.ts` | +713 / -342 | ★★ 成员模型、进程探针（双向） |
| `src/types.ts` | +647 / -94 | ★ 新增类型（`TASK_KINDS` 扩展、证据、执行历史）（双向） |
| `src/harness-compat.ts` | +489 / -80 | ★ `observeWorkspaces` 等观察面（双向） |
| `src/state.ts` | +448 / -229 | ★ 持久化形状（双向） |
| `src/client/ActivityPanel.module.css` | +564 / -356 | 样式大改（双向） |
| `src/client/activity-model.ts` | +721 / -0 | 投影逻辑（真·只增） |
| `src/web-routes.ts` | **+200 / -0** | ★ 故障隔离外壳（真·只增；两种口径相同） |
| `src/client/activity-monitor.ts` | +200 / -6 | 观察器 |
| `src/index.ts` | +191 / -54 | 注册新路由与外壳（双向） |
| `src/snapshot.ts` | +184 / -39 | 快照（双向） |
| `src/client/StagingPlanEditor.tsx` | +153 / -1 | 计划编辑器 |
| `src/client/ActivityPanel.tsx` | +94 / -530 | 拆分后**变小**（双向） |
| `src/profiles.ts` | +89 / -11 | 成员模型钉死（`bee6a57`）（双向） |
| `src/client/locales.ts` | +81 / -0 | 文案（真·只增） |
| `src/client/index.tsx` | +55 / -0 | 挂载新面板（真·只增） |
| `src/tool-names.ts` | **+14 / -0** | ★ 加两个工具名（真·只增） |
| `src/client/icons.tsx` | +6 / -0 | 图标（真·只增） |
| `src/client/agent-teams-card-definition.ts` | +6 / -119 | 卡片定义缩小 |
| `src/capabilities.ts` | +4 / -6 | — |
| `src/mailbox.ts` | +3 / -9 | — |
| `src/command.ts` | +2 / -3 | — |
| `src/client/WorkspaceActivity.tsx` | +1 / -1 | 一行 |

> 表中未列出的其余上游文件改动为 0（即 fork 未碰）。

### 8.2 上游有、fork 未采纳的文件（4 个：上游自 fork 后新增）

```
src/artifacts.ts        src/lineage.ts        src/tool-policies.ts        src/workspace-audit.ts
```

★ **这 4 个不是「被 fork 删除」，而是「上游在分叉点之后自己新增的、fork 尚未采纳」。** 三条实测：

```sh
# ① 它们在分叉点 98aac03 上【不存在】
for f in src/artifacts.ts src/lineage.ts src/tool-policies.ts src/workspace-audit.ts; do
  git cat-file -e 98aac03:$f 2>/dev/null && echo "PRESENT $f" || echo "ABSENT  $f"
done
# ⇒ 四行全 ABSENT

# ② 是上游自己新增的（98aac03 → upstream/main 显示 4 个 A）
git diff --name-status 98aac03 upstream/main -- src/ | grep '^A'
# ⇒ A  src/artifacts.ts  A  src/lineage.ts  A  src/tool-policies.ts  A  src/workspace-audit.ts

# ③ fork 侧删除数 = 0（fork 从分叉点起没删过任何文件）
git diff --name-status 98aac03 HEAD -- src/ | grep -c '^D'
# ⇒ 0
```

**结论与定级**：
- 这 4 个可以**干净合并**（fork 侧没有删除，所以 `git merge upstream/main` 不会产生删/改冲突）；
  风险是「**fork 尚未采纳**」，**不是**「拿不到」。
- 因此它们**不是**最高风险项。**最高风险是「不可合并」—— 即 §8.1 里被双向大改的文件**
  （`src/tools.ts`、`src/quality-gates.ts`、`src/members.ts`、`src/types.ts` 等），
  那些才是真正会在同步时撞车的地方。
- ★ 点名：上游由 `648fd9a`、`f21f37c`、`38a84b9` 带来的那部分能力，在当前 fork 里**缺席**。
  （口径说明：这三个 commit 是上游在这批文件上的引入点；本文只如实报「fork 未采纳这些能力」这个事实，
  它们在 fork 里是否有等价实现属于另一条工作流的题目。）

★ 本文上一版把这一节写成「被**删除**的上游文件（4 个）」并定级「**最高风险**」——**那是错的**，
错误来源是把 `comm -23`（集合差）读成了「fork 删除」。实测 `git diff --name-status 98aac03 HEAD -- src/ | grep -c '^D'` ⇒ **0**，
fork 一个文件都没删。已在 F3 修订中改正标题、正文与定级。

### 8.3 纯新增（零冲突面）

```
src/gates/                        24 个文件，11,964 行   ← 整个目录上游不存在
                                  （含非 .ts 资源：find src/gates -type f | wc -l ⇒ 24；
                                    仅 .ts 则 22 个；另有 2 个 .json 数据文件）
src/tools/                        18 个文件（除 tools.ts），11,325 行
                                  （find src/tools -type f | wc -l ⇒ 18）
src/mutation.ts + mutation-guard.ts  2,124 行
src/worktree.ts                    1,296 行
src/hmr-trace.ts                     292 行
src/client/（13 个新文件）          1,988 行
scripts/gate-*.test.mjs            88 个判据夹具
```

### 8.4 侵入点小结（回答「为什么 fork 有效」）

```
判据本体的冲突面         = 0        ← 全在 src/gates/，上游不存在这个目录
接线点的冲突面           = 6 处     ← 6 个 registry.evaluate() 调用点（源码调用，不含注释）
装配清单的冲突面         = 2 行/判据 ← src/gates/index.ts：新增一行 import + 在 ALL_GATES 里加一行（索引.ts:305，module-local 非导出）
工具面的冲突面           = 2 行     ← src/tool-names.ts（+14/-0）
────────────────────────────────────
真正的大宗冲突面只有       src/tools.ts（+1685/-2335）与 src/quality-gates.ts（+1369/-958）
```

⇒ **「加一条判据不需要碰上游文件」这个目标达成了** —— 装配清单的改动只有**两行**（一行 import、一行 `ALL_GATES` 条目），
且落在 fork 自己持有的 `src/gates/index.ts` 里，不碰上游任何文件。
但「同步上游不冲突」**没有完全达成** —— `src/tools.ts` 与 `src/quality-gates.ts` 是双向大改，同步时必然撞车。这是本清单要如实说清的一点。

---

## 9. ★ 文档核对结果（哪些已过期）

| 文档与原文 | 源码/git 实测 | 判定 |
|---|---|---|
| `docs/START-HERE.md:17`：「上游把全部判据放在一个 **1233 行**的文件里（**34 个导出**平铺）」 | `git show 54eddb4:src/quality-gates.ts \| wc -l` ⇒ **1233** ✅；`grep -c "^export "` ⇒ **52**，不是 34 | **行数对，导出数过期**（52 且至今仍是 `export`，上游现在是 80） |
| `docs/START-HERE.md:53`：「**判据层现状（十一条**，★ 六个位置全部接满）」 | `grep -rn "^export const id = '" src/gates/*/*.ts \| wc -l` ⇒ **17** | ★ **已过期。实测 17 条。** |
| `docs/START-HERE.md:55-62`：列出的「十一条」清单 | 该清单**缺** admission 三连、`contract.task-atomicity`、`dispatch.plan-reviewed`、`runtime.stall` | **已过期**（少了 6 条） |
| `docs/START-HERE.md:18-19`：「注册表把判据挪出来，编排层只认插入点」 | `index.ts:5` 逐字一致 | ✅ 有效 |
| `docs/START-HERE.md:79-92`：liveness 的三个坑（指纹换代、attemptId 键、参数坏不抛错） | `src/gates/runtime/liveness.ts` 回源核对 **一致** | ✅ 有效 |
| `docs/START-HERE.md:95-99`：注册表两条新能力（观察模式 / 全跳过可读） | `registry.ts:898`、`:205`、`:457` 逐字一致 | ✅ 有效 |
| `docs/START-HERE.md:121`：「**六条**判据在真实运行中还没生效」 | 现状 17 条，且 `docs/SELF-ITERATION.md` 的切换已完成 | **已过期** |
| `docs/THREE-LINE-PLAN.md:24-32`：裁定 A（`uncovered` 不进 `scored`） | `src/mutation.ts` 回源核对 **一致**（`scored = killed\|survived`，地板只读 `scored`） | ✅ 有效 |
| `docs/THREE-LINE-PLAN.md:6`：「账本未接入生产完成路径」 | 现状有生产调用方（`71de42a`「the friction/experience line gets a production caller」） | **已过期** |
| `docs/BASELINE-RED.md:1,17-18`：24 条红 ⇒ 5 条 | 该文件描述的是一次**已完成**的消红；**现状**实测 `pnpm test:gates` ⇒ **19 fail / 1471 tests**（本文件写作时实测） | **该文件对当时有效，对现状不适用**；现状是 19 条 |
| `docs/BASELINE-RED.md:7`：「而基线上有 24 条红 ⇒ 它拒判**每一个**任务」 | 与 `completion.backtest` 的「基准必须先绿」一致 | ✅ 逻辑有效 |

### 关于「11 条」这个数字的完整溯源

「十一条」不是笔误，它**确实曾经是十一**：

```
a5d3dce  gate: all eleven gates declare their input surface
         commit message 逐字：Five owners wired the declarations in parallel, one position each:
                            contract 2, dispatch 2, completion 4, delivery 2, runtime 1.
         实测：git ls-tree -r a5d3dce -- src/gates/ | grep -v index/registry/requires | wc -l  ⇒  11  ✅
```

后来加上的 6 条（全部实测）：

| 判据 | 引入 commit | 日期 |
|---|---|---|
| `contract.task-atomicity` | `485ec9e` | 10-07 |
| `dispatch.plan-reviewed` | `5520399` | 10-09 |
| `admission.absorb` | `621e152` | 10-06 |
| `admission.checkpoint` | `621e152` | 10-06 |
| `admission.convene` | `ad7a3ed` | 10-06 |
| `runtime.stall` | `5bc5b45` | 10-11 |

**⇒ 11 + 6 = 17。** `docs/START-HERE.md` 停在 `a5d3dce` 那个时刻，之后再没更新过判据清单。
**以代码为准：现状是 17 条。**

★ `src/gates/index.ts:527-541` 里也有一处「**11 条**」，那**不是**过期文档 —— 它是「写那段注释时的实测」的历史记录，读者需要能分辨。本文在此显式标出以免混淆。

---

## 10. 现状读数（本文写作时实跑）

```sh
$ grep -rn "^export const id = '" src/gates/*/*.ts | wc -l
17
$ grep -c "export const id" src/gates/completion/kind-requirements.ts
0                                          # ⇒ 不是判据
$ ls scripts/gate-*.test.mjs | wc -l
88                                         # ⇒ 判据夹具
$ ls scripts/*.test.mjs | wc -l
130                                        # ⇒ 全部测试文件
$ pnpm test:gates
ℹ tests 1471
ℹ pass  1415
ℹ fail  19                                 # ⇒ ★ 19 条未 pin 的失败
```

**19 条失败的分布**（★ 15 个文件，逐行实测；合计 = 19 显式成立）：

| 文件 | 失败数 |
|---|---:|
| `scripts/verify-runtime-integration.test.mjs` | 4 |
| `scripts/verify-input-requires.test.mjs` | 2 |
| `scripts/gate-baseline-known-failures.test.mjs` | 1 |
| `scripts/gate-contract-build-artifacts.test.mjs` | 1 |
| `scripts/gate-falsification-pairs.test.mjs` | 1 |
| `scripts/gate-input-wiring.test.mjs` | 1 |
| `scripts/gate-producer-consumer.test.mjs` | 1 |
| `scripts/gate-repair-completion.test.mjs` | 1 |
| `scripts/gate-reviewed-passthrough.test.mjs` | 1 |
| `scripts/gate-source-reading-convention.test.mjs` | 1 |
| `scripts/gate-stale-module.test.mjs` | 1 |
| `scripts/gate-t1-completion-probe.test.mjs` | 1 |
| `scripts/gate-worktree-arrival.test.mjs` | 1 |
| `scripts/verify-admission.test.mjs` | 1 |
| `scripts/verify-unified-pipeline.test.mjs` | 1 |
| **合计** | **19** |

一句话版：**`verify-runtime-integration` 4 · `verify-input-requires` 2 · 其余 13 个文件各 1**（4 + 2 + 13 = **19**）。

★ 复跑命令（把每个失败测试映射回它的文件）：
```sh
pnpm test:gates 2>&1 | tee /tmp/gates.txt
python3 - <<'PY'
import re
from collections import OrderedDict
txt = open('/tmp/gates.txt', encoding='utf-8', errors='replace').read()
pairs = re.findall(r'test at (scripts/[^\s:]+\.mjs):(\d+):(\d+)\s*\n\s*✖ ([^\n]+)', txt)
d = OrderedDict()
for f, ln, col, name in pairs: d.setdefault(f, []).append(name)
for f, items in sorted(d.items(), key=lambda kv: (-len(kv[1]), kv[0])):
    print(f"{len(items):3d}  {f}")
print("TOTAL =", sum(len(v) for v in d.values()), " FILES =", len(d))
PY
```
★ 本文上一版这张表**是错的**：它写成 `verify-runtime-integration 8 / verify-input-requires 4 / 其余 11 个文件各 2 each`，
合计会读成 8+4+22 = 34，与 `fail 19` **不自洽**。成因是把「✖ 出现次数」当成了「测试数」——
`✖` 在输出里同时出现在**子测试**与 `✖ failing tests:` 汇总块中，会重复计数。
**正确口径是按 `test at <file>:<line>` 配对计数**，结果即为上表 15 行、合计 19。

★ 典型失败样例（摘 `pnpm test:gates` 原文）：

```
✖ ★ 臂 1（P4 · 注册）：注册表逐位置枚举，并与基线逐条比对
  AssertionError: ★ 净增必须恰好 2 条（实测 11 → 14）。多出来 ⇒ 有别的接线没被记账；少了 ⇒ 有判据掉了
  3 !== 2

✖ 臂 0 ★ 读数：admission 现在是什么，如实说出来（空位置 ≠ 三条判据都通过）
✖ ★ 臂 12：八处调用点【都不拒绝】—— 核对的裁决权是零（逐位置实测，不是读源码）
```

★ **这些失败本身就是这套设计的证据**：夹具里硬编码的**历史基线数字**（「11 → 14」）在判据继续增加之后**按设计变红**。
这类红是「夹具过期」，不是「新缺陷」—— 分类与处置归另一条工作流（见 `docs/BASELINE-RED.md` 的既有方法：**真实缺陷 / 夹具过期 / 环境** 三分法）。
本文只如实报出读数，不做处置。

---

## 11. 一页速查：用户原话的逐条回答

> 「一层一层、一个一个加了什么模块进去，达成了什么功能」

| 层 | 加了什么模块 | 达成了什么功能 | 上游侵入点 |
|---|---|---|---|
| **L1** | `src/gates/registry.ts` + `src/gates/index.ts` | 判据从「一个 1233 行文件里的平铺导出」变成「插入点 + 注册表」；编排层只认插入点 | **零**（新目录） |
| **L2** | 17 条判据（一条一个文件，见 §3） | 把「成员的自报」换成「机械可证的观察」，分布到 6 个插入点 | **零** |
| **L3** | `src/gates/requires.ts` | 判据自己声明输入面；注册表按声明核对 ⇒ 逼出「声明了但没接线」 | **零** |
| **L4** | `admission/checkpoint.ts` `admission/absorb.ts` `admission/convene.ts` `runtime/liveness.ts` `runtime/stall.ts` 等 | 六个位置**全部接满**；补上「成团之前」这个位置 | **零** |
| **L5** | 注册表的 `skippedAll` 分支 | 「全跳过 ≠ 都通过」；三态在**返回值**里可分 | **零** |
| **L6** | `src/gates/completion/kind-requirements.{ts,json}` | 「哪些 kind 要哪几道完工门」从硬编码变成**可审计的数据** | **零** |
| **L7** | `src/worktree.ts` | 每任务一个 detached 检出；隔离是**机制**而非提示 | 零新增；`src/scheduler.ts` +738/-46（two-dot） |
| **L8** | `src/mutation.ts` + `src/mutation-guard.ts` | 变异测试 L1/L2/L3：测的是「测试有没有鉴别力」 | **零** |
| **L9** | `src/gates/completion/backtest.ts` | 基准必须先绿，否则无法归因 | **零** |
| **L10** | `src/tools/*.ts`（16 个新文件）+ `src/tools/shared/entities.ts` | 16 个工具停止共用一个文件 ⇒ 判据调用点落在正确的位置文件里 | ★★★ `src/tools.ts` +1685/-2335（two-dot） |
| **L11** | `src/web-routes.ts` | 故障隔离外壳：插件自己的缺陷只让自己降级，且**降级可查询** | `web-routes.ts` +200/-0 |
| **L12** | `src/tools/edit-plan.ts` + `StagingPlanEditor.tsx` + `dispatch.plan-reviewed` | 计划编排与「派发前这份计划审过了吗」 | `StagingPlanEditor.tsx` +153/-1 |
| **L13** | `src/client/` 13 个新文件 | 成员屏 / 依赖图 / 名册设置 / 会话 id / 进度汇总 | `ActivityPanel.tsx` +94/**-530**（two-dot，变小了） |
| **L14** | `src/gates/budget-stop.ts`、`src/hmr-trace.ts`、`scripts/worktree-reclaim.mjs` | 完工链墙钟预算、HMR 痕迹、worktree 自动回收 | 零 |

**总账**：`src/` 从 18,793 行 → **47,310** 行；文件从 40 → **95**；判据从 **0** → **17**；插入点从 **0** → **6**。
**真正的大宗改动面**只有 `src/tools.ts`（+1685/-2335）与 `src/quality-gates.ts`（+1369/-958）两处（§8.4）——**这两处才是同步时真正会撞车、因而风险最高的地方**。

---

*本文的每一条读数都可用 §0 的四条命令复现。图上随机抽 5 处回源，应全部命中 `文件:行`。*
