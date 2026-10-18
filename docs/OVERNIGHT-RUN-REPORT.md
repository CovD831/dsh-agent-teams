# 过夜运行：形态验证 + 判定层/记账层缺陷修复

时间窗：2026-10-18 ~ 19 夜间。

## 一、形态验证（用户的核心诉求）

用户设计的形态：**持久领导成员（记账点）在子树内当 leader**——每张实现任务它拉起一个
一次性 subagent worker，每张审查它拉起一个可续 subagent reviewer；队长只派任务给领导成员，
不直接派 worker。

### 结论：形态可跑通，且今晚跑通了。

实测读数（可复跑：读 `~/.dsh/sessions/<workspace>/<sessionId>/session.v4.jsonl.zstd`，
**按 zstd magic `28 B5 2F FD` 切帧逐帧解压** —— 单次 `zstdDecompressSync` 只解第一帧）：

| 会话 | 深度 | 父 | 工具调用 |
|---|---|---|---|
| `cb95c8e7` foreman | 1 | captain | 567 条记录，含 `subagent`×3 |
| `0a87d7c8` foreman-b | 1 | captain | 509 条记录，含 `subagent`×1 |
| `45c85f41` t4 worker | 2 | foreman-b | **write×2 / edit×10**，产出 611 行脚本 |
| `9c003f33` t3 worker | 2 | foreman | **edit×14 / bash×49**，产出 138 行改动 |

⇒ 持久成员 → 一次性 subagent worker → 在隔离树里写盘的**三层链路真的通**。

### ★ 途中被推翻的三个错误判断（都是我的）

1. **"成员会话只有 290 字节、零轮次"** —— 错的。宿主把会话写成**多个 zstd frame 拼接**，
   单次解压只解第一帧。按 magic 切帧后 foreman 是 279,902 字节 / 157 帧 / 712 KB / 391 条记录。
2. **"子会话活着但不落盘"** —— 错的。t3 的第一个 worker 被 foreman **interrupt 掉**了
   （`turn/end` 记录 `reason: {"kind":"aborted","reason":{"kind":"parent"}}`），
   而它当时工具调用是 **write/edit = 0 次**（74 次全是 bash/read/grep）。它**从未尝试过写**。
3. **"写盘路径断了"** —— 被同时刻的 t4 worker 直接否掉：同一宿主、同样 depth=2，
   它写了 2 次 write + 10 次 edit，611 行落盘。

★ 教训：**「子会话说要做什么」不是「它做了什么」。**
判断 worker 有没有推进只认两样硬读数：①`tool/call` 里 write/edit 的**次数**
②worktree 的 `git status --porcelain`。**不许**用自然语言、也**不许**用文件 mtime
（读文件阶段 mtime 本来就不变）。

## 二、修掉的缺陷：inactive context 被读成一次失败的回合

### 现象
成员的 `agent_teams_update_task` / `send_message` 反复返回
`cannot get required service "agents" in inactive context (code UNKNOWN)`，
任务被标 failed，而**落盘其实已经完成**。

### 根因（两层）
1. **宿主机制**：`ctx.agents.get(...)` 的取值器沿 fiber 树往上找 `fiber.store`，
   而 store 只在 fiber active 时存在。本插件在顶层 `inject` 里声明了 `agents`
   （`src/index.ts:56`），于是 fiber 不在运行时取值器走到"我自己就声明了它"这一支
   ⇒ **当场抛，不再往上找**。
2. **★ 真正的放大器**：`captainSessionOf`（`src/events.ts`）在**每一个工具**的事件记录
   路径上。于是"成员回合结束"这一个事件，会把之后每一次工具调用的返回值都变成
   一次本来不存在的失败。调用方分不清"没做"与"做了但回执丢了" ⇒ 重试 ⇒
   重试又成功又失败 ⇒ 整轮卡死。

### 实测证据
foreman 的三次 `turn/end` **全是 `kind: error`**：
- turn 1 / 2：`empty_output: upstream returned no visible output (PI_AI_ERROR)`
- turn 3：`cannot get required service "agents" in inactive context (UNKNOWN)`

随后 `agent/error` 监听器（`src/members.ts:492`）调 `failMemberOpenAttempt`
（`src/members.ts:197`）把 t1 标成 failed。**实现没失败，基础设施失败了。**

### 修法（commit `9720ca9`）
在 `src/events.ts` 加一个共享的
`export function liveAgentOf(ctx: Context, sessionId: string): Agent | undefined`：
只对这一种错误降级成 `undefined`，**其余异常照旧往上抛**
（一个 catch 若把"读不到会话"与"记录逻辑自己坏了"读成同一件事，
就是把这一格修成一个更宽的盲区）。

七个裸奔点全部收口：
- `src/events.ts` `captainSessionOf` —— 每个工具的事件路径
- `src/tools/message.ts` —— 成员汇报队长的**唯一**出口
- `src/tools/shared/entities.ts` ×2 —— `observeMemberActivity` 与成员观察面
- `src/members.ts` ×6 —— `failMemberOpenAttempt`×2 / `deliverToMember` / 血缘上溯 /
  `sessionForMember` / `memberLiveness`
- `src/scheduler.ts` ×2 —— `liveCaptain` / `liveMember`
- `src/tools/update-task.ts` —— 本地那份 `readCaptainSession` 改为委托
  （★ 同一格曾有**三份**各自宽严不同的实现 —— 那比一份都没有更坏，因为读起来像已经处理过了）

读数：`pnpm typecheck` exit=0 · `pnpm build` exit=0 ·
`node --test scripts/gate-plan-reviewed.test.mjs` 12/12 ·
`scripts/review-unified-pipeline.test.mjs` 14/14 ·
`scripts/capabilities.test.mjs` pass 18 fail 0 ·
`mvp-failing-files --diff` 新增 1 / 修好 0 / 不变 15（新增的是我自己有意留红的钉子）。

## 三、形态本身还需要产品决定的两处（R4：只出读数不接线）

1. **成员拉完 worker 后就 `turn/end` 了**。宿主逐字：
   `The parent shares your workspace but does not automatically receive your transcript,
   tool output, or reasoning` ⇒ 子会话完成**不会**自动唤醒父。foreman-b 因此在 t2 上
   turn/end，任务挂在 in_progress 直到被标 failed。
   ⇒ 领导成员必须**留在回合里轮询**，或产品需要一条"子会话完成 → 唤醒父"的投递路径。
2. **interrupt 一个正在读文件的 worker，会看起来像"它什么都没干"**。
   而它可能只是还没到写的那一步。

## 四、尚未完成
- t1 / t2 因上述基础设施错误被判 failed，需重新派发。
- t3 / t4 在跑，尚未收口。
- t5 / t6~t9 未开始。

## 五、已落地并合入主干的改动（截至 05:00）

| commit | 内容 | 关键读数 |
|---|---|---|
| `9720ca9` | `inactive context` 不再被读成一次失败的回合 | 七处裸奔点收口；`liveAgentOf` 只降级这一种错误 |
| `48d3418` | R5 判据接线普查（t4） | 7 插入点 21 判据：wired 6·18 / **zero 1·3 = admission** / vacant 0·0 |
| `7a94837` | R6 夹具注册普查（t5） | 156 个夹具 **6 个永远不会被跑到**；`test` 脚本根本不存在 |
| `c01fdb4` | R7 plan-reviewed 读戳时间（t3） | 95 条不可能戳现在判 blocked；反向半边（NaN/Infinity/缺 at/边界）仍 ok |

### 三次契约 amend，三次都是契约写错而不是执行写错

这是今晚最有价值的副产物：**四条建任务路径里，契约本身不可满足是常态而非例外。**

1. **t5 · acc5 要求 `node --test scripts/gate-input-wiring.test.mjs` 全绿**
   —— 该夹具在树上结构上不可能 exit 0（两条先于任务的存量红）。改成本仓自己的
   净新失败口径，并明令禁止把存量红改绿（那两条臂红得正确）。

2. **t3 · inScope 只覆盖 4 个文件，而交付必然要改另外 4 个**
   —— 共享夹具 `scripts/fixtures/reviewed-stamp.mjs:42` 写死 `at: 1_700_000_000_123`
   （2023-11-14），它本身就是普查数出的 95 个不可能戳之一。判据一开始读时间，
   用它造戳的十个套件 21 条臂同时变红，读起来像"十个机制同时坏了"，
   实际是"一个共享夹具盖了一个不可能的戳"。
   ★ 我在一次性 worktree 上双向实测后才裁定：保留 4 条 ⇒ 五个套件逐条等于或优于
   基线、净新失败 0；回退 4 条 ⇒ 凭空多 6 条红。

3. **t5 · 我一开始把「报错=没建成」当前提** —— `create_task` 即使返回 Error
   也会把任务写进 `team.json`；相反，契约被门拒时不落盘。⇒ 建完必须读盘核对。

### 三条本该更早做的纪律

- **契约里的 verify 命令，必须在真实树上先跑一遍**，确认它有可能是绿的。
  t5 的 verify 从起草那天起就不可能绿，而它一路通过了 `preflight-contracts.mjs`
  —— 因为预检只查"命令合法"，不查"该命令当前是否红"。
  ★ 这是预检脚本的缺口，不是使用者的疏忽。
- **inScope 的边界要按"这件事的全部影响面"划，不是按"我想改的文件"划。**
  t3 的 4 个越界文件里没有一个是顺手改的，全都是同一件事的另一半。
- **一条断言真实盘面的臂，天生会被真实盘面打红。**
  `scripts/gate-plan-reviewed-stamp.test.mjs` 臂 8 断言"盘面零个不可能戳"，
  实测 90 条 ⇒ 它 7 pass / 1 fail 是**正确状态**，不是缺陷。
