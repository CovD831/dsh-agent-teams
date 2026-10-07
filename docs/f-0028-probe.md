# f-0028 生产探针：成员进程是否嵌套在 `node --test` 下（t45）

**结论：`clean` —— 在生产里（本次读数来自一个**成员进程**的 bash 子进程），
`NODE_TEST_CONTEXT` **不在**那条链上。**

★ 但请连**射程**一起读：本读数覆盖"继承的环境"这一格（它对整条调用链有效），
而**不**覆盖宿主/成员进程**自己的 `execArgv`** —— 后者在技术上读不到（见 §4）。
⇒ 所以「不嵌套」是**观测到的**（环境格），而「祖先链上没有 `--test`」是**推断的**。

---

## §1 问题：嵌套会让测试**静默跳过**，而退出码分不开

f-0028 的最后一格此前空着：AgentTeams 的成员进程在生产里是否嵌套在 `node --test` 下。

它值钱，是因为嵌套的后果与"通过"**在退出码上同形**。本任务逐条复现（可重跑）：

```
宿主 env 里没有 NODE_TEST_CONTEXT ⇒ 内层 node --test 正常跑：
    INNER RAN
    ℹ tests 1 / pass 1 / fail 0            exitCode = 0

宿主 env 里有  NODE_TEST_CONTEXT ⇒ 内层 node --test 被静默跳过：
    (node:…) Warning: node:test run() is being called recursively within a test file.
                       skipping running files.
    ★ 测试一条都没跑                        exitCode = 0   ← 与上面同形
```

★ 而 `completion.r5` / `completion.mutation` 正是靠 **exitCode** 判"测试绿没绿"。
⇒ 一次被跳过的运行会被读成一次通过。这是本队记账的「把没测到并进通过」
在**子进程边界**上的又一次现身。

★ 复现入口：`node --test scripts/gate-member-process-probe.test.mjs` 的**臂 1**；
探针里另有一份不依赖环境的自证（`mechanism.verdict === 'reproduced'`）。

## §2 传递链：宿主 → 子进程（这条链是**代码里读得出来**的）

```
src/tools.ts:325-329 / :688-690
    spawn('/bin/sh', ['-c', command], { cwd: workspace, env: process.env, … })
                                                    ^^^^^^^^^^^^^^^
★ `env: process.env` ⇒ 宿主把**自己整份环境**交给子进程
⇒ 宿主若带 NODE_TEST_CONTEXT，则**每一条** verify 命令（含 `node --test <file>`）都继承它
```

**实测（模拟宿主两种情形）**：

| 宿主 env | 子进程 `node --test` | 输出 | exitCode |
|---|---|---|---|
| 无 `NODE_TEST_CONTEXT` | 真的跑 | `INNER RAN` + `pass 1` | **0** |
| 有 `NODE_TEST_CONTEXT` | **静默跳过** | 只有一句 warning | **0** |

⇒ 这就是"若宿主嵌套 ⇒ 那类任务永远收不了口"的完整机制。

## §3 生产读数（成员进程那一侧）

候选路径 ① **成员自己的 bash 子进程**（它继承成员进程的环境）—— **可用，已实测**：

```
$ node scripts/verify-nested-runtime.mjs          # 在成员进程里跑
{
  "verdict": "clean",
  "process": { "nodeTestContext": null, "execArgvHasTest": false, "pid": …, "ppid": … },
  "observed": {
    "inheritedEnvironmentLacksNodeTestContext": true,
    "thisProcessExecArgvLacksTest": true
  },
  "ancestry": { "available": false, "reason": "ps is not readable here (…EPERM)" },
  "couldNotObserve": [ … ],
  "mechanism": { "verdict": "reproduced" }
}
```

候选路径 ② **通过 `agent_teams_*` 工具的返回值**（t34 对 `deployment` 的做法）
—— ★ **不可用，如实报**：`grep -c NODE_TEST_CONTEXT src/tools.ts src/harness-compat.ts` ⇒ **0**。
没有任何工具出口携带这一格。⇒ 路径 ② 需要改 `src/`，而本任务是**只读侦察**（`src/` 在 inScope 之外）。

## §4 ★★ 一条**技术上不对称**，它决定了探针的设计（本任务实测）

| 信号 | 是否随 bash 子进程继承 | 从成员侧读它的意义 |
|---|---|---|
| `NODE_TEST_CONTEXT` | ★ **会**（走环境） | 覆盖**整条调用链** ⇒ 有资格作证 |
| `execArgv` | ★ **不会**（每进程） | 读到的**永远是自己** ⇒ 对宿主**零信息** |

**实测**：父进程 `execArgv=[]`，其 bash 子进程打印出的是**子进程自己的** `["-e", …]`；
而同一个子进程能读到父进程传下来的 `NODE_TEST_CONTEXT="child-v8"`。

⇒ 所以：
- `NODE_TEST_CONTEXT` 缺席 = **观测**（那条链上没有它）
- `execArgvHasTest === false` = **只说本进程**，**不能**读成"宿主没有 `--test`"

★ 这条如果不写清，下一个人会把成员 bash 的干净 `execArgv` 当成宿主的证据 ——
而那正是本队记账的「读错位置的出口」。

## §5 观测到的 vs 观测不到的（分开写）

**观测到的**：
- 成员进程链上**没有** `NODE_TEST_CONTEXT`（环境格，能继承 ⇒ 有链级效力）
- 本进程 `execArgv` 里没有 `--test`（**只**说明本进程）
- 机制本身可复现（`reproduced`）

**观测不到的**（各附原因）：
- **祖先链**：`ps` 在本沙箱被拒（`spawnSync ps EPERM`），且 macOS 无 `/proc`
  ⇒ `ancestry.available === false` + `reason`（**不是**空链 —— 空链会被读成"链上没有"）
- **祖先/宿主的 `execArgv`**：每进程，子进程看不到（§4）
- **工具出口那一格**：没有任何 `agent_teams_*` 返回它（§3 路径 ②）

## §6 结论与建议

**实测为【不嵌套】⇒ 按任务书，f-0028 应关闭为「夹具的环境限制」**：

```
夹具（`scripts/gate-nested-test-probe.test.mjs` 那一类）自己在 `node --test` 下跑
  ⇒ 它读自己的环境**必然**是 nested（本任务实测：夹具进程 NODE_TEST_CONTEXT=child-v8）
  ⇒ 那是【夹具的处境】，不是【生产的处境】
★ 本读数（成员侧）= clean ⇒ 生产不嵌套 ⇒ 那条"静默跳过"在生产路径上**不发生**
```

**但建议做防御性剥离**（理由：宿主可能变，而代价是"全部静默通过"）：

```
在起子进程处剥掉那一格：
    src/tools.ts:325-329（runVerifyCommand）与 :688-690（Captured 版）
    env: { ...process.env, NODE_TEST_CONTEXT: undefined }   ← 或 delete 后传入
★ 为什么值得做，即使今天不需要：它的**失效代价**是"所有测试看起来都过了"，
  而那种失效**不留痕迹**（退出码 0、输出为空）。防御的成本是一行。
★ 而它与本任务的关系：本任务**不能**做这个剥离 —— `src/` 在 inScope 之外（只读侦察）。
```

## §7 射程声明（读本文件任何结论前请先读这里）

| 在哪跑探针 | 读到的 | 有资格替谁作证 |
|---|---|---|
| **成员进程的 bash** | 成员那条链 | ★ 成员/宿主链的**环境**（本文件的读数） |
| 命令行 `node …` | 命令行进程 | **谁都不**（f-0027：命令行替插件进程作证的那次是错的） |
| 夹具（`node --test`） | 夹具自己 | 只有夹具 ⇒ **必然** nested |

⇒ 本文件 §3 的读数是**第一行**那一格（成员进程那一侧）。
