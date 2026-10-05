# 这个 fork 是什么，以及怎么继续工作

> **给下一个会话的第一份读物。** 它不是历史，是**当前状态与工作方式**。
> 上游：`NanmiCoder/dsh-agent-teams`（1927★）。本目录是它的 fork。

---

## 0. 一句话

**上游负责「跑」，我们负责「判」。**

```
上游：团队、成员、派活、调度、任务板、面板 —— 实测能跑通
我们：判据 —— 机械可证、评分器够不到、不采信自述
```

**为什么 fork**：上游把全部判据放在一个 1233 行的文件里（34 个导出平铺），
加一条判据就要改它 ⇒ 每次同步上游都冲突。**注册表把判据挪出来，编排层只认插入点。**

---

## 1. 起点状态（新会话从这里开始）

```sh
cd ~/Desktop/agent-teams-dev
git log --oneline | head -5
pnpm verify        # 期望 exit=0
pnpm typecheck     # 期望 exit=0
```

**已提交的九件事**（都可回退、都有验收）：

| commit | 做了什么 |
|---|---|
| `54eddb4` | fork 基线：版本 0.1.23、README 同步、lib 重建 |
| `04c8250` | ★ **判据：verify 由判据层重跑**（堵住伪造 completed） |
| `bee6a57` | 配置：钉死 `memberModel`（否则成员模型随队长漂移）|
| `d38de30` | ★ **注册表**（三态裁决、不短路、非法形状抛错） |
| `70c8c96` | ★ **把 verify 重跑搬进注册表**（证明注册表接得上真判据）|
| `626c59d` | ★ **判据：changedPaths 必须对得上真实写入**（dispatch 位置第一条）|
| `7cdf263` | ★ **把归属观察接进 update_task**（判据真的会开火，不再永远 unmeasured）|
| `8851e6e` | 文档更正：切开「归属」与「版本」，worktree 仍然需要 |
| `68ee2c8` | ★ **worktree 隔离**（每任务一个 detached 检出，解决"版本"）|

---

## 2. 工装（每次改完必跑）

```sh
pnpm build      # ★ 必须先 build：git-artifacts 检查要求 lib/ 与 src/ 同步
pnpm typecheck  # 期望 0 错误
pnpm verify     # 期望 exit=0
pnpm test:gates # 只跑判据测试（verify 里已含）
```

### 三条它自己的纪律（踩过才知道）

```
① lib/ 必须与 src/ 同步 —— 改完 src 不 build，verify 会报
   "Git artifacts are stale or modified"
② README 里的版本号必须等于 package.json 的 version
   改版本要同步 README.md 与 README_ZH.md
③ 它的 verify 只跑 scripts/*.test.mjs
   ⇒ 判据测试放 scripts/，import lib/ 的编译产物（与它现有 24 个测试同构）
   ⇒ 我们已加 verify:gates，否则判据测试会是"有 0 个读者"
   ⇒ ★ 判据夹具命名为 scripts/gate-<id>.test.mjs（被 gate-* glob 收进 test:gates）
     名字不匹配那个 glob 的夹具（如 observed-changed-paths.test.mjs）
     必须在 test:gates 里【显式列出】，否则它同样"有 0 个读者"
```

---

## 3. 判据层的形状（读 `docs/GATE-REGISTRY.md`）

```
五个插入点（按流程位置，不按模块）：
  contract    建任务/改契约
  dispatch    派发前                ← 现有 1 条：changed-paths
  completion  成员汇报完成          ← 现有 1 条：verify-rerun
  delivery    团队宣布交付
  runtime     全程

一条判据一个文件：src/gates/<point>/<id>.ts
装配清单：        src/gates/index.ts   ← 唯一知道"我们有哪些判据"的地方
编排层：          src/tools.ts 只调 registry.evaluate(point, ctx)
```

### 一条判据必须满足（契约 §2、§6）

```
① 三态裁决：ok / blocked([原因]) / unmeasured(为什么没测成)
   ★ unmeasured 与 blocked 必须不同形 —— 空回复不是"没问题"

② 自带三臂夹具：
   臂1 伪造臂（该拦的）· 臂2 未测量臂 · 臂3 对照臂（合法输入必须过）
   ★ 缺对照臂就无法区分"判据有效"与"判据在乱拒"

③ 纯数据变换；要 I/O 由调用方注入执行器
```

---

## 4. ★ 工作方式：每加一条判据走三步

**这是本项目唯一被验证有效的方法**（2026-10-05，`verify-rerun` 用它做成）：

```
【第一步：造夹具】在【未改造的】代码上证明缺陷存在
   三臂：伪造臂必须被接受（证明漏洞）· 对照臂必须通过

【第二步：加判据】
   每次只加一条；改完立刻 build + 跑夹具

【第三步：验证】
   伪造臂翻过来（被拒）· 对照臂不变（照常通过）
   pnpm verify 仍 exit=0
```

### 实测证据（verify-rerun 的三臂）

| 臂 | 输入 | 改前（上游 v0.1.22）| 改后 |
|---|---|---|---|
| 伪造 | 零工作 + 全伪造 passed | **completed（漏洞）** | **被拒** ✓ |
| 违规 | 真工作 + 绝对路径 changedPaths | 被拒（路径规则，**它是对的，是我契约写错**）| 同 |
| 对照 | 真工作 + 相对路径 | completed | **completed** ✓ |

**★ 教训**：t2 那一轮失败的原因是**我的契约写错了**（`changedPaths` 必须 workspace 相对），
而它与"判据抓到了伪造"在日志里同形。**只有对照臂能区分这两件事。**

---

## 5. 已知的上游约束（踩过的，别再踩）

```
① changedPaths 必须是【workspace 相对路径】
   normalizeWorkspacePath: 以 / 开头 ⇒ illegal
   ⇒ 一条无法与 inScope/outOfScope 匹配的路径 = 无法审计 ⇒ 拒绝它是对的

② 子会话的 cwd 【硬编码继承】父会话
   dsh-subagent 的 childSessionMeta: cwd = parentHeader.cwd
   ⇒ 隔离【不能】靠改 cwd，只能靠【任务里告诉成员去哪个路径干活】

③ 队长的 workspace = 会话的 cwd；成员在【同一个目录】里干活
   ⇒ git 只知道"工作区脏了"，不知道"哪个文件是这个成员改的"
   ⇒ ★ **"归属"这一半已解决**（2026-10-05，见 §5.1）—— 不走 git，走会话事件。
     但"版本"那一半【没解决】：要父版本仍然得靠 worktree / git 历史（见 §6①）。

④ 一个队长同一时间只能带一个活动团队
⑤ 终态（completed/failed/cancelled）不可改；但可追加署名证据
   ⇒ 补证据路径【不】做新的完成裁决（判据的 appliesTo 要跳过它）
```

---

## 5.1 ★ 归属问题已解决：走会话事件，不走 cwd / 不走 git

**2026-10-05 发现并落地。** §5②③ 曾被认为是"隔离"的拦路虎。它确实有一个
不靠 cwd、不靠 git 的解法 —— 但要**说清它解决了什么、没解决什么**。

```
dsh-tool-fs 给每次写入/编辑的 tool/result 挂 meta.diffs：
    meta.diffs: Array<{ path: string, oldText: string|null, newText: string }>
（已从 app.asar 抽出该包源码核实：isFileDiff 要求 path:string；
  diffsFromMeta 要求数组非空且每项合法 —— 形状是实测的，不是猜的）

而这些事件可以由插件【已有】的入口读到：sessionOwnEvents(memberAgent.session)
```

⇒ **归属走【会话事件】，它是逐成员的** ⇒ 同时绕开 §5②（不能改 cwd）与
§5③（git 不知道是谁改的）。

```
src/harness-compat.ts  observedChangedPaths(session): string[] | undefined
                       ★ undefined（没能观察）与 []（观察了，确实没写）必须不同形
src/gates/dispatch/changed-paths.ts
                       自报的 changedPaths 与观察到的写入比对；虚报或隐瞒都拒
```

### ★★ 它解决的是【归属】，不是【版本】—— 别把这两件事混起来

这是最容易搞错的一点。会话事件回答的是「**哪些文件是哪个成员改的**」，
它**不能**提供「一个可 checkout 的历史版本」：

```
会话事件给的是：{ path, oldText, newText } —— 一次编辑的前后文本
R5 需要的是：  一个干干净净的【父版本】工作树，让新测试在上面必须变红
               靠 oldText/newText 拼父版本既脆弱又不完整 ⇒ 它替代不了 git 历史
```

⇒ **worktree 仍然需要**，理由从"归属"换成了"版本"。**它已落地**（见 §5.2）。

**★ 一条既有约束**：`docs/quality-gates.md` §2 第 83 行与 §13 第 807 行
把独立 worktree 列为「后续 PR，不在本需求范围」——那条推迟属于**当时那个 PR
的范围约束**。本项目的管理者已明确要求现在做，所以它被推翻了，
但**推翻要记在这里**，不要让下一个会话以为它还在生效。

**★ 一个值得记住的接线教训**：把这条判据接进 `update_task` 后，`lifecycle-verify`
挂了。原因**不是判据错了**，而是它的合成成员会话里【只有 descriptor、没有
tool/result】—— 判据于是诚实地说"我没能观察"并拒绝。
**处理方式是修夹具（补上真实的 tool/result），不是把判据放松到能让测试过。**

---

## 5.2 ★ worktree 隔离已落地：每任务一个 detached 检出

**2026-10-05 落地。** 它解决的是**版本**（§5.1 解决的是归属）。

```
src/worktree.ts   createTaskWorktree({ repo, taskId })  → { ok, path, base, missingIgnored }
                  worktreePromptLine(path)              → 派发提示里"在哪干活"那一行
                  detectWorktreeSupport(repo)           → 能不能隔离，不能则带原因

接线：src/scheduler.ts 的 kickMember —— 【锁外】建，只给 implementation/repair，
      建失败【不】阻断派发（隔离是能力，不是裁决）
```

### ★ 四条实测边界（不是猜的，每条都有夹具）

```
① 同一分支不能检出到两个 worktree ⇒ 必须 --detach
   （并行成员必然在同一分支上，否则第二个直接失败）
② 新 worktree 是干净的 HEAD ⇒ 主工作区未提交的改动不会带过去
   ★ 这正是 R5 要的"父版本"；但也意味着成员看不到队长未提交的工作
③ worktree 里【没有】gitignore 的文件（如 node_modules）
   ⇒ 直接跑 pnpm test 会因缺依赖失败 ⇒ 我们把它报出来（missingIgnored），
     否则一次"环境没准备好"会被误报成"工作没做出来"
④ worktree 里的写入对主工作区完全隔离
```

### ★ cwd 仍然没动

子会话 cwd 硬编码继承父会话（§5②），**改不了** ⇒ 隔离靠两件事：
**给一个独立目录** + **在派发提示里告诉成员**。
提示里没有路径时**不产出任何指令** —— 绝不假装有隔离。

### 一个设计决定：建失败为什么不阻断

隔离是"能不能拿到父版本"的**能力**，不是"这一步过不过"的**裁决**。
建不出来时提示里没有工作目录，成员照常在共享目录干活，而需要父版本的判据
（R5/变异）会因为拿不到 worktree 而 `unmeasured` —— 判据自己会表达"我没测成"。
**把一次基础设施故障伪装成任务失败是更坏的结果。**

---

## 6. 下一步（按已定的顺序）

```
① ~~隔离：给成员一个 worktree~~ —— ★ 已完成（2026-10-05，见 §5.2）
   每任务一个 detached worktree；路径写进派发提示；四条边界都有夹具。

② R5（红前绿后）接到 completion 位置           ← 现在两样原料都齐了
   需要【两样，缺一不可】：
     · 父版本 + 修复版本          ← §5.2 的 worktree 提供（base = 那个 hash）
     · newTestFiles 是哪个成员写的 ← §5.1 的会话事件提供
   样板：src/gates/completion/verify-rerun.ts
   ★ 判据要能表达"没有 worktree ⇒ 我测不了"（unmeasured），
     而不是把"没隔离"当成"检查通过"。

③ 之后的候选（按性价比）：
   contract/verify-command    verify 命令写得对吗（实测：grep -qx N 会被 wc 的前导空格卡死）
   contract/scorer-reach      写域碰到判据文件了吗（归属证据已有，见 §5.1）
   completion/mutation        变异测试
   delivery/coverage          每个目标都有任务认领
   delivery/convergence       idle ≠ converged（空回复不是收敛）
   runtime/with-timeout       有界等待
```

---

## 7. 与会话的关系

**这个 fork 是可独立继续的项目。** 它不依赖任何一次会话的上下文：

```
· 状态在本文件 + git log + docs/GATE-REGISTRY.md
· 每一刀都有 commit、有测试、有验收
· 新会话读完本文件即可接手
```

**而"自动化开发插件"（`~/Desktop/自动化开发插件`）是【外部借鉴对象】**：

```
它的价值：判据核心（4,403 行 / 10 个模块 / 2,453 个测试）
          那些判据的【语义】可以迁过来，一条一条地
它的状态：与这个 fork 无关，不要在这里改它
```
