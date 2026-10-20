# 第三轮独立验收：全链读数复核 + 四次定向突变

> **这份文件的读者是下一个会话，以及需要拿它做决定的队长。** 它回答一个问题：
> 本轮（`a669781..00cfcb1`，31 个提交）的交付里，**哪些读数是可复跑的、哪些是量错输入的**。
>
> 我是本轮唯一的独立验收者。另外三个成员（researcher / architect / implementer）的会话
> 都已烧穿上下文上限（`CONTEXT_WINDOW_EXCEEDED`，100–120 万 token vs 上限 100 万），
> 它们的"完成"多数没有独立复核过。**本文件里没有任何一条读数是转述别人的** ——
> 每一条都有我自己的命令 + 原文输出。包括队长的。
>
> 起点 HEAD `a669781`（本轮开工前），验收时 HEAD `00cfcb1`。
> ★ 验收结束时 `git status --porcelain` **只有本文件一个 `??`** —— 四次突变全部逐字节还原。

---

## 0. 一句话结论

```
逐条裁决        30 格 ⇒ confirmed 22 · refuted 7 · could-not-measure 1
                （★ could-not-measure 只有 1 格，且它没有并进任何 confirmed）
                ★ 7 条 refuted 里，只有 1 条是"实现写错了"，其余 6 条是
                  「**实现对了、但没有任何东西守住它**」或「前提已被盘面改掉」
七条验收项      N1 ✓ Δ · N5 ✓ Δ · W1 ✓ · N6 ✓ Δ · 突变 ✓ · 磁盘 ✓ · 报告格式 ✗
                （Δ = 验收面成立，但**交付面**有缺口 —— 见下方四条）

★ 真正要紧的不是这七条，是下面四条【团队自己的读数与盘面不一致】：
  ① N1 的 collected 三态**落盘了**，但**没有任何一条已提交的臂读它** —— 定向突变 C 全绿
     ⇒ 「修好了」今天只有一个我手搭的读数作证，产品没有任何东西会守住它
  ② N5 的 describePlanLoop **全仓零已提交臂**（734 个 ref 的 scripts/ 全查过）
     ⇒ 定向突变 B（把 approved 提到 halted 之前）**一条臂都没红**，34 条失败集逐条不变
  ③ N6 的 review_plan 的 15 条臂**不在任何标准命令里**（`pnpm test:gates` / `pnpm verify`
     都不含 `scripts/tools/`）⇒ 它在隔离树里跑得过，而 CI 与本地 verify 永远跑不到它
  ④ 本轮把 34 条红里的 22 条算作"新"——而 **19 条在开工前的 HEAD 上就已经红了**
     ⇒ 「单侧读数把存量算成增量」这个陷阱，这一轮**又被踩了一次**（见 §7）
```

★ 而**队长记的 1669 tests / 1602 pass / 29 fail 这组基线，我一次也没复现出来**：
我在七个不同的状态上跑了全量，读数是 `1665/1598/30`、`1665/1594/34`（两次）、
`1660/1586/36`。见 §7.1 —— 差的不只是数字，是**分母本身在漂**。

---

## 1. 判据一 · N1（采集解焊）：`confirmed`（读数对得上）+ `refuted`（无人守）

### 1.1 验收原文

> N1：自己用 `node -e` 独立重算 `signals.total` / `observeShaped` / `collected.keyPresent`，
> 与 `node scripts/evolution-readout.mjs --json` 的输出对得上；对不上就报 refuted 并给两条读数

### 1.2 我的重算（不经过那个脚本，自己从头读盘）

```bash
$ node -e "
const fs=require('fs');
const raw=fs.readFileSync('.agent-teams/evolution/signals.jsonl','utf8');
const lines=raw.split('\n').filter(Boolean);
let rows=[],bad=[];
for(const [i,l] of lines.entries()){try{rows.push(JSON.parse(l))}catch(e){bad.push(i+1)}}
console.log('total',rows.length,'bad',bad.length);
console.log('observeShaped',rows.filter(s=>s&&s.source&&s.source.where).length);
console.log('keyPresent',rows.filter(s=>s&&typeof s==='object'&&'collected' in s).length);
console.log('keyMissing',rows.filter(s=>s&&typeof s==='object'&&!('collected' in s)).length);
const k={};for(const s of rows)k[s.kind]=(k[s.kind]||0)+1;console.log('byKind',JSON.stringify(k));
console.log('sha256',require('crypto').createHash('sha256').update(raw).digest('hex'));
"
total 49 bad 0
observeShaped 39
keyPresent 0
keyMissing 49
byKind {"rejection":46,"insight":2,"success":1}
sha256 678e71af3f0a02eb9e3d36760ef8af90646f0c514fdaaa07f67f1e2cd66d90ac
```

### 1.3 脚本的读数

```bash
$ node scripts/evolution-readout.mjs --json
"signals": {
  "bytes": 60945, "lines": 49, "malformed": [],
  "sha256": "678e71af3f0a02eb9e3d36760ef8af90646f0c514fdaaa07f67f1e2cd66d90ac",
  "total": 49, "observeShaped": 39, "handShaped": 10,
  "byKind": { "rejection": 46, "insight": 2, "success": 1 },
  "collected": { "keyPresent": 0, "keyMissing": 49 }
}
```

**逐格相同，连 sha256 都同源。⇒ `confirmed`。**

`collected.keyPresent = 0` 这条读数的**裁决**也是对的（脚本自己的三态纪律）：
`keyPresentRows === 0 || keyMissingRows === 0 ⇒ confirmed`，理由是「**键整个不存在**
不是"有但为空"」。它不是把 0 当成功 —— 它把 0 声明成"这一格今日的事实"。
`verdict` 逐字 `confirmed`，`why` 逐字：

> ★ 不是"有但为空"，是**键整个不存在**（`JSON.stringify` 把 `undefined` 静默丢掉 —— 见 N1.1）。
> 这是今天的事实，也是 N1 之后**存量行仍然为 0** 的正确读数。

### 1.4 ★★ 但写侧真的落盘了吗 —— 我单独验了（这一格队长没验）

「存量 49 行没有这一格」只说明**老行**是这样。N1 的交付是**新行**必须有。
我直接调 `observe()` 写两条（一条不给 index、一条给）：

```bash
$ node /tmp/probe-n1-write.mjs
files: signals.jsonl
row id=e-0001 | keys=id,at,kind,source,message,candidate,collection,collected | collected = "unmeasured" | has key? true
row id=e-0002 | keys=id,at,kind,source,message,candidate,collection,collected | collected = "unmeasured" | has key? true
```

**新行确实带 `collected`，且 `undefined` 被写成 `"unmeasured"` 而不是被丢掉。⇒ 落盘这一半 `confirmed`。**

### 1.5 ★★★ 但没有任何东西会守住它（`refuted`）

我把写侧那一行**整个拿掉**（定向突变 C，`lib/evolution/collect.js`，
`collected: collectedFieldOf(decision)` → 一个恒 `{}` 的展开）：

```bash
$ node /tmp/probe-n1-write.mjs      # 突变后
row id=e-0001 | keys=id,at,kind,source,message,candidate,collection | ... | has key? false
```

然后跑全量：

```
mutation C:  ℹ tests 1665  ℹ pass 1594  ℹ fail 34
baseline:    ℹ tests 1665  ℹ pass 1594  ℹ fail 34
=== mutC 相对基线的【新增】红 ===
（空）
```

**一条臂都没抓到。**

根因我也查了（不是猜）：全仓只有 `scripts/gate-signal-id-uniqueness.test.mjs` 一个文件
import 了 `lib/evolution/collect.js`，而它的 6 条臂全都关于 **id 不撞号**，
`collected` 只作为夹具里的一个**输入**出现（`:59  collection: { collected: true }`），
**没有一条臂写过一行信号再断言那一行有 `collected` 键**：

```bash
$ grep -rln "signals.jsonl" scripts/*.mjs
scripts/evolution-readout.mjs
scripts/gate-collection-health-readout.test.mjs
scripts/gate-signal-id-uniqueness.test.mjs
```

⇒ **N1 的三态纪律今天只活在"我会手动跑一遍探针"里。**
这正是本队记账最贵的形状（「一个数学上正确的判据，没有任何东西在跑它」）。

★ 而这不是我在挑刺：`gate-collection-health-readout.test.mjs` 的 6 条臂**全绿**，
而它的语料里 `collected: false` 是**手写进 JSON 字符串的**（`:110`），
不是走 `observe()` 写出来的。也就是说：**那 6 条臂测的是"读一个手写的 collected"，
不是"写一条带 collected 的信号"。** 两者在屏幕上都叫 "collection 健康读数"。

---

## 2. 判据二 · N5（计划环五态顺序）：`confirmed`（顺序对）+ `refuted`（零已提交臂）

### 2.1 验收原文

> N5：自己造一份会判 approved 的计划，调 halt 后重读 describePlanLoop，
> 确认得 halted 而不是 approved；再确认 team.escalated 没有被复用（grep 读数）

### 2.2 走**真实产品路径**（`haltTeamWork` 与 HTTP `/halt` 路由、`lifecycle-verify` 用的是同一个函数）

```bash
$ node /tmp/probe-halt.mjs
A. 造计划后:  phase = staged  | describePlanLoop.state = awaiting-review | rounds = 1
B. approve 后: phase = running | describePlanLoop.state = approved       | canEnd = true
   这道题要的 = 会判 approved ⇒ true
C. haltTeamWork 后: team.halted = true | describePlanLoop.state = halted | canEnd = false
   ★ 关键读数：halted 而不是 approved ? true
   reason 逐字 = "计划审查环 state=halted；轮次：1/3。 ★ 队伍被**人**停住了（halted 排在所有判定之前，包括 approved）——
                 这个环不会自己再转：要它继续，先调 `agent_teams_resume` 给一个非空理由。…"
D. 对照（同一份数据只把 halted 翻 false）: state = approved
E. 一个 phase=running 且 rounds=4 的团队: state = escalated
   （若 approved 排在 escalated 前面，这里会是 approved）
F. team.escalated=true（质量环的位）+ phase=running ⇒ planLoop.state = approved
   planLoopSnapshot 的键 = state,rounds,maxRounds,reason,canEnd,roundsSource,surfaces
```

**★ 关键是 B 那一行**：在 halt **之前**这个团队真的判 `approved`（`canEnd = true`）。
⇒ C 的 `halted` 不是"反正它永远到不了 approved"那种恒真读数 —— **D 就是反向半边**
（同一份数据只翻 `halted` 一格，立刻回到 `approved`）。

### 2.3 `team.escalated` 没有被复用 —— 三重读数（不是只看 grep）

```bash
$ grep -n "team.escalated\|planReviewEscalated" src/quality-gates.ts
459-462  ★ 与 QualityLoopState 同形但不同位：describePlanLoop 不读 team.escalated，
          describeQualityLoop 不读 team.planReviewEscalated
2443     if (team.escalated === true) blockers.push('team requires escalation resolution')
2968/2977/2982   describeQualityLoop 的四处（质量环自己的）
3020/3081/3082/3174/3175  describePlanLoop 的四处（本队自己的位）
```

- **源码面**：`planLoopStateOf` 只读 `team.planReviewEscalated`（`:3082`），从来没有 `team.escalated`。
- **行为面**：上面 F 那一行 —— 把**质量环的**位设成 `true`，`describePlanLoop` 仍答 `approved`。
  若它复用了那一位，这里必然是 `escalated`。
- **写点面**：`grep -rn "escalated" src/` 里 `team.escalated` 的写点仍只有
  `applyQualityFollowUp` 一处，`planReviewEscalated` 的写点只有 `src/tools.ts`（edit_plan）与
  `resumeTeamState`（归零）。两个环各写各位。

⇒ `confirmed`。★ 而且这一条**有反向对照**：不是我"没看到复用"，是**构造了一个必须区分的输入**。

### 2.4 计数口径与阈值：★ 我一开始读错了契约，逐条对完才判

```bash
$ node /tmp/probe-multi.mjs            # PLAN_REVIEW_MAX_ROUNDS = 3
一次 edit_plan 带 5 个 operation ⇒ rounds = 1 (契约：per CALL，应=1)
  第 2 次 ⇒ rounds=2 flag=undefined state=awaiting-review
  第 3 次 ⇒ rounds=3 flag=true      state=escalated
  第 4 次 ⇒ rounds=4 flag=true      state=escalated
```

**per-CALL 口径成立**（一次 5 operation 只算 1 轮）—— 这一格 `confirmed`。

★ **而阈值这一格我一开始判错了，如实记下怎么错的。**
我先按 t8 报告里那句"我实现在第 maxRounds 次就敲响，契约要的是第 maxRounds+1 次"，
判了「实现与契约不符（措辞偏差）」。**去读契约原文之后，这个判法不成立**：

```
t8 契约原文（.agent-teams/self-iteration-3/team.json，t8.acceptance）：
  · 「第 maxRounds+1 次后 planReviewEscalated 为 true 且 state === 'escalated'」
  · 「放行条件两条：① 图结构合法 ② planReviewRounds < maxRounds 或已显式归零」
```

第 4 次（= maxRounds+1）时 `rounds=4`、`flag=true`、`state=escalated` —— **契约逐字成立**。
第 3 次就敲响**不会让第 4 次不成立**（单调），它只是**更早**。
⇒ 契约⑶说的是"max+1 次之后必须为真"，不是"max 次时必须为假"。
**两个读法都真，我把"更严"读成了"不符"，那是我读宽了契约。**

★ 而这一条我要留一句：t8 报告里写的措辞（"契约⑶逐字要'第 maxRounds+1 次后 escalated'，
我实现在第 maxRounds 次就敲响。这不是偏离而是推论"）本身是对的，
**是我在验收时先信了"这是偏差"这个框，再去核对** —— 与本轮母题同形。
⇒ 裁决：`confirmed`（计数 per-CALL + 阈值两个读法都真）。

### 2.5 放行闸：它真的读了上限（不是只在 status 里算）

```bash
$ node /tmp/probe-approve-gate-order.mjs
rounds=2 (max=3) | describePlanLoop=awaiting-review | approve ⇒ OK phase=running
rounds=3 (max=3) | describePlanLoop=escalated       | approve ⇒ REJECTED: approve refused: the plan review loop
                                                              has hit its ceiling — 3 round(s) against a limit of 3
rounds=4 (max=3) | describePlanLoop=escalated       | approve ⇒ REJECTED: … 4 round(s) against a limit of 3
```

三行只动 `rounds` 一个自变量 ⇒ 闸门与读侧**同一条不等式**。`confirmed`。

### 2.6 解除路径：只清 flag 是死码，显式归零才有效

```bash
$ node /tmp/probe-n5b.mjs
C. resumeTeamState(超轮 halted)   ⇒ status = resumed | rounds = 0 | flag = false | describePlanLoop = awaiting-review
D. resumeTeamState(未超轮 halted) ⇒ rounds = 1 | flag = undefined | 键在不在 = true | describePlanLoop = awaiting-review
E. 只清 flag 不归零 ⇒ describePlanLoop.state = escalated （证明"只清 flag"是死码）
```

`confirmed`。★ D 是安全边界：**未超轮的团队 `rounds` 一个字节不变**（1 还在），
所以 `resume` 不会把"这份计划被改过几轮"抹掉。

### 2.7 ★★★ 但这一整块**没有任何一条已提交的臂**（`refuted`）

我把 `planLoopStateOf` 的 `approved` 挪到 `halted` 之前（= N5.8 那个错序，**正是本任务最贵的教训**），
然后在**同一个 HEAD** 上跑全量：

```
baseline @00cfcb1:  ℹ tests 1665  ℹ pass 1594  ℹ fail 34
mutation B:         ℹ tests 1665  ℹ pass 1594  ℹ fail 34
=== mutation B 新增红 ===（空）
=== mutation B 消失的红 ===（空）
```

**34 条失败集逐条不变，一条臂都没抓到。** 而且这不是"臂没跑到"：

```bash
$ grep -rn "describePlanLoop" --include=*.mjs --include=*.json . --exclude-dir=node_modules --exclude-dir=lib --exclude-dir=.agent-teams
（除 docs/self-iteration-plan.json 里的计划正文，零命中）
$ git grep -l "describePlanLoop" $(git rev-list --all) -- 'scripts/*.mjs'
（734 个提交里，任何 ref 的任何脚本都没有）
$ grep -rln "plan_loop" scripts/*.mjs
（空 —— 唯一命中是 scripts/fixtures/tool-definitions.json 里的 schema 快照）
```

★ 与 t8 的报告对照：t8 说"三处定向突变都变红（① 短路放行闸 ② `+1`→`+mutations.length` ③ halted 挪到 approved 之后）"。
**那三次突变是真的、读数也是真的，但它们跑在 t8 自己的临时探针上，而那些探针没有一行进仓库。**
⇒ t8 的交付里 **`describePlanLoop` 五态、轮次计数、放行闸、resume 归零，四条全都是零臂覆盖**。
今天谁把这个函数的顺序改错，**CI 与 `pnpm test:gates` 都不会说话**。

### 2.8 顺带：`plan_loop` 只有 JSON 那一半（t8 自己披露过，我复核成立）

```bash
$ node /tmp/probe-text2.mjs
text.length = 1698
includes("plan_loop") = false
包含 "awaiting-review" ? false
包含 "canEnd" ? false
plan_loop 那一节 JSON 键: state,rounds,maxRounds,reason,canEnd,roundsSource,surfaces
```

`renderStatus`（`src/tools/shared/entities.ts:6187`）里 `grep plan_loop` **零命中** ——
文本面**完全没有**这一节。人在纯文本视图里看不到"这个计划环能不能结束"。
★ 这一格是 t8 主动披露的（它写在"必须如实点明"的第 (ii) 条），我确认成立、不新增缺陷。

---

## 3. 判据三 · W1（回收判据的方向）：`confirmed`

### 3.1 验收原文

> W1：自己拿两棵已知的树复跑判据，确认修好之后 reclaimable 与 keep 两种结论都还能出现
> （★ 恒真的判据也是缺陷）

### 3.2 我自己造两棵（不借队长的任何夹具）

```bash
$ cd /tmp/w1-probe && git init -b main . && … && git worktree add -b absorbed ../w1-absorbed \
  && git worktree add -b unique ../w1-unique
# absorbed 的提交 ff 进 main；unique 的**不进**

$ node --input-type=module -e "…judgeWorktreeReclaimable…"
resolveTrunkRef ⇒ {"status":"resolved","ref":"main","commit":"94ecbf51d159…","source":"main-worktree-branch"}
w1-absorbed    ⇒ reclaimable "ancestor"
w1-unique      ⇒ keep "not-absorbed" | its HEAD (f965f4f72e1b…) is neither an ancestor of main …
```

**两侧都出现。⇒ 判据不是恒真、也不是恒假。**

### 3.3 ★ 反向对照：换主干引用，方向真的翻

```bash
主干=other（指向 unique 那条）时：
  absorbed 树 ⇒ keep "not-absorbed"
  unique 树   ⇒ reclaimable "ancestor"
```

⇒ 这是 W1 修的那件事本身：**判据跟着"拿谁当主干"变**。
若它仍写死 `main`，上面这四行不会翻。

### 3.4 真实盘面上的复跑（现盘只剩一棵）

```bash
$ node scripts/worktree-reclaim.mjs
回收扫描：1 个 worktree
  主干引用：task-mutation-integrate @ 00cfcb136168（来源：主树检出的分支）
  可清 0 · 保留 1 · 判不了 0

$ node --input-type=module -e "…judgeWorktreeReclaimable({repo, worktree: '…task-agent-teams-refactor-t108'})"
{"status":"keep","reason":"not-absorbed","trunk":{"ref":"task-mutation-integrate",…,"source":"main-worktree-branch"},"behind":84,…}
```

★ 注意 `resolveTrunkRef` 的读数：它现在答 `task-mutation-integrate`
（主树自己检出的分支），而不是 `main`。**修前这里是 `main`**（落后 84–209 个提交），
⇒ 这就是 W1 的病灶，且**修后的读数可复核**（`source: main-worktree-branch` 是自证的）。

### 3.5 ★★ 但 `planReclaim` 那条路仍然没有任务状态过滤 —— G8 未修，我复现了

```bash
# 造一棵【产物已被吸收】的树，放在 .agent-teams/worktrees/task-t1-x
$ node --input-type=module -e "…"
judge ⇒ reclaimable ancestor
listWorktrees ⇒ ["/tmp/g8d/r/.agent-teams/worktrees/task-t1-x"]
scanTerminal status=in_progress ⇒ scanned=0 reclaimable=0      ← 连判都不判
scanTerminal status=completed   ⇒ scanned=1 reclaimable=1      ← 对照，差异真来自任务状态
planReclaim（G8 那条路）⇒ scanned=1 reclaimable=1 ⇒ 正在写(in_progress)的树会被清? ★ YES — G8 复现
planReclaim 不传 tasks ⇒ reclaimable = 1 （同一个读数 ⇒ tasks 参数被静默忽略）
```

⇒ **W1 修的是"拿谁比"，G8 那条"按谁的终态决定删不删"仍然缺。** 这不在本轮任何
commit 的声明范围内（`docs/DEFECT-VERIFY-RERUN-WRONG-CWD.md:746-777` 已记账），
所以我把它记成**已知未修**，不算本轮 refuted —— 但**下一次有人跑
`pnpm reclaim:worktrees:apply` 会删掉正在写的树**，这条必须先被写进任何"可以清盘"的判据里。

---

## 4. 判据四 · N6（review_plan 接线）：`confirmed`（两半都成立）+ `refuted`（臂不在任何标准命令里）

### 4.1 验收原文

> N6：亲自走一遍「不调工具直接 create_task」⇒ 确认仍被 `dispatch.plan-reviewed` 拒，
> 措辞与 f-0395 逐字一致；再调工具拿戳建一条，确认不被拒

### 4.2 半 A：不调工具 ⇒ 逐字被拒（走**真实工具**，不是直调判据）

```bash
$ node /tmp/probe-n6-tool.mjs
=== 半 A：不调 review_plan，直接 create_task ===
  与 f-0395 逐字相同（f.title === 信封 + msg）? true
  msg.length = 510 | f.title.length = 538 | 信封长度 = 28
```

`510 + 28 = 538`，且 `f0395.title === '[rejection — not a blocker] ' + msg` **为 true**
（我逐字比了整串，不是比尾部）。⇒ `confirmed`。

★ 这一格我**第一次量错了**：我一开始比的是 `f.title.endsWith(msg)`，得到 `false`。
原因是信封前缀是 `'[rejection — not a blocker] '`（28 字符），而 `.title` 里
`create_task rejected:` 那一段**也属于 msg**。改对之后才 true。
**记下来是因为它与本轮的母题同形：判据算对了，但它读的输入不是你以为的那个。**

### 4.3 半 B：调工具拿戳 ⇒ 不被拒

```bash
=== 半 B：先调 review_plan 拿戳，再 create_task ===
  review_plan ⇒ stampable = true | reviewed 在场 = true | refusals = (none) | at 是否晚于门上线 = true
  create_task ⇒ {"task_id":"t2","subject":"把 review_plan 的发戳一侧接上","status":"pending","kind":"implementation",
                 "input_surface":{"checked":3,"incomplete":0,"skipped":0,"missing":[]},…}
```

⇒ `confirmed`。★ 而这一格**也有反向半边**（不是"反正它总是过"）：
第一次我用 `inScope: ['src/tools/review-plan.ts']` 时被**另一条判据**拒了：

```
create_task refused: the scope is internally inconsistent (contract defect, NOT an unmeasured reason) — 2 problem(s):
  (emit) `src/tools/review-plan.ts` is in scope, so the build emits `lib/tools/review-plan.js` … but that product is NOT declared
```

⇒ 这说明**发戳与整个契约校验都真的在跑**：戳过了，契约照样会被挑。

### 4.4 ★★★ 但 `review_plan` 的 15 条臂**不在任何标准命令里**（`refuted`）

```bash
$ node --test scripts/tools/review-plan.test.mjs
ℹ tests 15  ℹ pass 15  ℹ fail 0        ← 单独跑：全绿

$ node -e "const s=require('./package.json').scripts['test:gates'];console.log(s.includes('scripts/tools'), s.includes('review-plan'))"
false false
$ node -e "const v=require('./package.json').scripts.verify;console.log(v.includes('scripts/tools'))"
false
$ grep -rn "review-plan.test" --include=*.mjs --include=*.json --include=*.yml --include=*.md --include=*.ts . \
    --exclude-dir=node_modules --exclude-dir=.agent-teams --exclude-dir=lib
./scripts/tools/review-plan.test.mjs:81:  acceptance: [...]
./scripts/tools/review-plan.test.mjs:82:  verify: [...]
./src/tools/review-plan.ts:24://   这一点由 `scripts/tools/review-plan.test.mjs` 的臂 2 钉住。
```

`test:gates` 的 glob 是 `scripts/gate-*.test.mjs …`（不含 `scripts/tools/`），
`verify` 串起来的 24 个子命令**没有一个**指到那个目录。

★ 而**快环也够不着它**（我多查了一层，因为它最容易成为"我跑过了"的出口）：

```bash
$ grep -n "scripts/tools" scripts/select-fixtures.mjs scripts/verify-fast.mjs .github/workflows/*.yml
（空）
$ sed -n '63,70p' scripts/select-fixtures.mjs
/** 所有 `gate-*.test.mjs`（与 `package.json` 的 `test:gates` 同一个集合的**起点**）。 */
export function gateFixtures() {
  return readdirSync(join(ROOT, 'scripts'))
    .filter((name) => /^gate-.*\.test\.mjs$/.test(name))
```

⇒ `verify:fast` 的**总体**（population）就是 `scripts/gate-*.test.mjs`，
`scripts/tools/review-plan.test.mjs` **根本不在候选集里** —— 不是"这一轮没选到它"，
是"它永远不会被选到"。

⇒ **这 15 条臂（含最贵的"臂 2 不管线"）今天只在有人手动敲那个路径时才跑。**
t7 报告里写的 `15/15`、突变 `10 pass / 5 fail` 都是真的 —— 但它们**不会**在 CI 上重跑。

★ 而 t7 的 `verify` 字段逐字就是 `node --test scripts/tools/review-plan.test.mjs` ——
**它自己知道要跑哪条命令，只是没有人把这条命令接进任何入口。**

---

## 5. 判据五 · 定向突变（至少一次，必做）：`confirmed`（做了四次，两次有判别力）

### 5.1 四次突变汇总

| # | 改了什么 | 恢复后 sha256 | 抓到的臂 |
|---|---|---|---|
| **A** | `lib/worktree.js` 的 `resolveTrunkRef`：把 `mainWorktreeBranch(...)` 换成字面量 `'main'` | `deafcfe2…` ✔ 逐字节 | ★ **W1 臂 1 / 臂 3 / 臂 6 变红**（3 条） |
| **B** | `lib/quality-gates.js` 的 `planLoopStateOf`：把 `approved` 提到 `halted` 之前（N5.8 那个错序） | `a4457c3b…` ✔ 逐字节 | ✖ **零条**（34 条失败集逐条不变） |
| **C** | `lib/evolution/collect.js`：删掉顶层 `collected` 那一格 | `41114def…` ✔ 逐字节 | ✖ **零条** |
| **D** | `lib/quality-gates.js`：`requireExplicitKind` 分支短路成 `false` | `a4457c3b…` ✔ 逐字节 | ✖ **零条**（但见 5.4：另一层还在拦） |

★ 四次全部改回，最后 `git status --porcelain` **空**，且三个文件 sha256 与改前逐个相同。
★ 全部只动 `lib/`（产物），`src/` 一个字节没碰 —— 与 t7/t8 的做法一致。

### 5.2 突变 A 的原文（这是"臂真的抓到了"那一侧）

```bash
$ node --test scripts/worktree-reclaim.test.mjs      # 突变 A 下
✖ ★★★★★ W1 臂 1（本任务的目的臂）：引用选错 ⇒ 该回收的**没回收**
  AssertionError [ERR_ASSERTION]: ★★★ 走声明式来源必须答 reclaimable。实测：
    {"status":"keep","reason":"not-absorbed","trunk":{"ref":"main","commit":"a669efff0649…",
     "source":"main-worktree-branch"},"behind":0,"detail":"its HEAD (8f04c0edbb51…) is neither
     an ancestor of main (a669efff0649…), …"}
  + 'keep'  - 'reclaimable'
✖ ★★★★ W1 臂 3（反向半边 · 乙）：产物真的没被吸收 ⇒ 仍判 keep（判据不许被放宽成恒真）
  AssertionError: {"ref":"main",…,"source":"main-worktree-branch"}  + 'main'  - 'task-mutation-integrate'
✖ ★★★ W1 臂 6：显式给出的引用**优先**于主树检出的分支，且两种来源可分辨
ℹ tests 48 · pass 44 · fail 3
```

还原后：

```bash
$ node --test scripts/worktree-reclaim.test.mjs
ℹ tests 48 · pass 47 · fail 0
```

⇒ **W1 这一条有真正的判别力**（臂 1 甚至逐字点名了 `ref: "main"`）。
★ 而且臂 3 抓的是"来源"，不是"结果"—— 两条臂抓的是**不同**的东西，不是同一个断言抄两遍。

### 5.3 突变 B / C 的原文（"零条"那一侧，是本文件最有价值的两行）

```bash
$ pnpm test:gates > /tmp/gates-base3.log     # 干净 HEAD 00cfcb1
ℹ tests 1665  ℹ pass 1594  ℹ fail 34

$ pnpm test:gates > /tmp/gates-mutB2.log     # 突变 B（approved 提前）
ℹ tests 1665  ℹ pass 1594  ℹ fail 34
（comm 逐条比对：新增 0 条，消失 0 条）

$ pnpm test:gates > /tmp/gates-mutC.log      # 突变 C（collected 不落盘）
ℹ tests 1665  ℹ pass 1594  ℹ fail 34
（comm 逐条比对：新增 0 条，消失 0 条）
```

★ **"总数不变"是不够的** —— 我按集合差做的，逐条 `comm`，两边都空。
⇒ 这两处今天**没有判别力**，不是"红在别处被淹没了"。

### 5.4 突变 D 的额外发现：双层拒真的有两层（但都在同一侧）

短路 `requireExplicitKind` 之后：

```bash
B 不传 kind、requireExplicitKind:true（计划路线，第二层） ⇒ ok = true | kind = work   ← 突变后放行了
```

但走**真实工具** `edit_plan` 时**仍然被拒**：

```bash
$ node /tmp/probe-t9.mjs
① add_task 不带 kind ⇒ REJECTED: operation 1 (add_task) requires an explicit kind for add_task: …
```

⇒ 第一层（`src/tools/edit-plan.ts` 的 mapper）独立地拦住了。**这正是 t9 说的"两层防的是不同的事"**，
我独立确认了：拆一层不会让洞露出来。⇒ `confirmed`（且这一条我要给 t9 记一笔：它的双层设计**真的有用**）。

### 5.5 t9 反向半边（队长点名的第 1 优先项）：`confirmed`

队长要我证伪的是「**能传进去** 与 **传进去之后真的被用上** 是两件事」。
我造了第四条：`kind:'implementation'` 但**不带** `objective`/`acceptance`：

```bash
$ node /tmp/probe-t9.mjs        # 全走真实工具入口
① edit_plan add_task {subject,dependencies}（无 kind）
   ⇒ REJECTED: … requires an explicit kind for add_task …
② edit_plan add_task {kind:implementation, inScope, verify}（缺 objective+acceptance）
   ⇒ REJECTED: implementation tasks require a non-empty objective      ← ★ 核心那一行
③ edit_plan add_task {kind:implementation, objective, acceptance, inScope, verify}
   ⇒ OK  {"status":"staged","tasks":1,…}
④ edit_plan add_task {kind:work}
   ⇒ OK  {"status":"staged","tasks":2,…}

落盘逐条：
    t1 kind=implementation "impl full contract" | objective? true | acceptance? true | inScope? true
    t2 kind=work           "work task"           | objective? false | acceptance? false | inScope? false
```

**`kind` 传进去之后真的被用来判契约了** —— ② 不是"没传进去"，是"传进去了、被判据当场用了"。
⇒ 队长担心的"通道开了个洞"**不成立**，`confirmed`。

### 5.6 t9 的 `requireExplicitKind` 三态（队长点名的第 2 优先项）：`confirmed`

```bash
$ node /tmp/probe-kind4.mjs
A 不传 kind、不传 requireExplicitKind（既有 create_task 路）  ⇒ ok = true  | kind = work   ← 落回原行为
B 不传 kind、requireExplicitKind:true（计划路线，第二层）      ⇒ ok = false | "kind must be declared explicitly…"
C 显式 kind:work、requireExplicitKind:true                   ⇒ ok = true  | kind = work
D-F 显式 kind:implementation、逐格缺                        ⇒ 指名缺那一格（objective / acceptance / inScope）
G 显式 kind:work、requireExplicitKind 传 false               ⇒ ok = true  | kind = work
```

**A 那一行是关键**：一个既不传 `kind` 也不传开关的新调用方**落回 `'work'`**，
不是被静默当成"已表态"。⇒ 它是**三态**（`undefined` / `true` / `false`），不是布尔。`confirmed`。

---

## 6. 判据六 · 性能/磁盘：`confirmed`（t14 真的腾出了空间）+ 一句必须记住的口径

### 6.1 我的读数（按 t14 自己立的规矩：**必须报 `df` 差**）

| 时点 | `du -sh .agent-teams/worktrees/` | 树数 | `df` 可用 |
|---|---|---|---|
| 本轮 t14 之前（t14 报告） | 12G | 18 | 7.5 GiB |
| t14 之后（t14 报告） | 6.7G | 8 | 8.2 GiB（+0.7） |
| **我接手时**（`08:37`） | **5.6G** | **8** | 4.1 GiB |
| 二次清盘后（队长 `00cfcb1`） | **1.7G** | **1** | **4.5–4.7 GiB** |

```
$ du -sh .agent-teams/worktrees/          # 现在
1.7G
$ df -k . | tail -1
/dev/disk3s5 239362496 211705416 4739356 98% …      ⇒ 4.52 GiB 可用
$ git worktree list | wc -l
2                                        # 主树 + t108（1 棵任务树）
$ ls .agent-teams/worktree-salvage/*final*.patch | awk '{print $5, $9}'
0        self-iteration-3-t10-final.patch     ← 0 字节（那棵树无独有 commit）
0        self-iteration-3-t19-final.patch     ← 0 字节
75023    self-iteration-3-t16-final.patch
101505   self-iteration-3-t2-final.patch
821286   self-iteration-3-t7-final.patch
1081420  self-iteration-3-t8-final.patch
1313632  self-iteration-3-t9-final.patch
```

### 6.2 ★ 我独立复核了 t14 那条"`du` 高估约 7 倍"的根因（受控实验，不是推断）

```bash
$ df 前: 4731828 KiB
$ dd 300MB → /tmp/hl-probe/a · sync
$ df:    4417528 KiB        ⇒ 真的扣了 314300 KiB
$ ln a b                    ⇒ nlink=2
$ rm a                      ⇒ df 4414920（变化 -2608，≈ 0 —— 硬链接还在）
$ rm b（最后一条链接）      ⇒ df 4729000（+314080 KiB —— 这时才真正还盘）
```

**t14 的结论成立：「删中间的硬链接释放 0 字节，只有最后一条链接消失才真正还盘」**。
⇒ 报"腾出多少"必须报 `df` 差。这一条我也把它记在下面第 9 节的口径里。

★ 但**我没能复现 t14 给的 `nlink=9` 那个具体读数**：
现在 `.pnpm-store/v11/index.db` 是 `nlink=1`（`stat -f` 实测），
且八棵树的 `node_modules` 里 `-links +2` 的文件数是 **0**。
⇒ 那个 9 要么在别的 inode 上、要么在清盘过程中消失了。**机制成立，具体数字我没测到**。
（这一格如实记成"机制 confirmed，那个具体 nlink 值 could-not-measure"，**不并进 confirmed**。）

### 6.3 ★ 一个必须点名的口径冲突

`du` 在**同一天里**给出过 12G / 6.7G / 5.6G / 4.9G / 1.7G 五个值，
`df` 只给出 7.5 → 8.2 → 4.1 → 4.5 GiB。**`du` 的五个值都是真的**（它们是不同时刻的盘面），
但它们**回答不了"腾出多少"**。本轮有两次"读数对不上"的争论（8 vs 9 棵、6.7 vs 7.3G）
根因都是这个 —— 而它们**都不是谁量错了**，是同一份文件在三个时刻的样子。

---

## 7. 判据七 · 报告格式 & 全量复跑：`refuted`（我按集合差做了一次，抓到了"存量当增量"）

### 7.1 ★ 队长给的基线，我一次也没复现出来

| 状态 | 我实测 |
|---|---|
| 队长报的基线 | `1669 tests / 1602 pass / 29 fail` |
| 我第一次跑（HEAD `6eaa393`） | `1665 / 1598 / 30` |
| HEAD `8fd496d` | `1665 / 1594 / 34` |
| HEAD `00cfcb1`（干净） | `1665 / 1594 / 34` |
| 开工前 HEAD `a669781`（隔离 worktree） | **`1660 / 1586 / 36`** |

**四个数没有一个等于 1669/1602/29。** 差的不只是数字：
`test` 总数在 `1660 → 1665` 之间跳（`gate-path-depth` / `build-atomic` 这类会按盘面
动态生成用例的夹具在变），`fail` 在 `30 / 34 / 36` 之间跳。
⇒ **"总数"这个读数在本仓是不可比的**，任何"我跑过了，34 条"的说法都必须带**逐条名单**。

### 7.2 按集合差做（这就是本轮的第四个陷阱）

```bash
$ comm -13 /tmp/fails-preround.txt /tmp/fails-base3.txt     # 本轮【新增】的红：3 条
scripts/gate-readout-uniform.test.mjs :: scripts/gate-readout-uniform.test.mjs
scripts/gate-t1-completion-probe.test.mjs :: ★ 臂 5：`resolveBaseRevision` 的两条来源与两个"没有"的成因**不同形**
scripts/gate-tool-output-schema.test.mjs :: 臂 1 ★ 对照臂：每个工具带上它会返回的诊断字段 ⇒ 通过自己的 output schema

$ comm -23 /tmp/fails-preround.txt /tmp/fails-base3.txt     # 本轮【消掉】的红：5 条
scripts/gate-tool-split.test.mjs :: 臂 2 ★ 内容臂：每个工具的定义与【拆分前】逐字相同（golden 对拍）
scripts/gate-worktree-arrival.test.mjs :: ★ 接线臂（闸门对照臂）：仓库可用 ⇒ 照常派发，提示里带工作目录
scripts/moment-facts.test.mjs :: 臂 1 ★ 文档点名的每一个 f-XXXX 都真的存在于台账里
scripts/plan-review-tier.test.mjs :: ★ 臂 11（t12，读数臂）：对本团队当前计划跑一次，逐条给出四个必答项的结果
scripts/verify-task-atomicity.test.mjs :: 臂 6 真实语料分布（独立重算）：它在这批真实任务上是什么形状

交集 31 条；36 - 5 = 31；31 + 3 = 34 ✔（集合算术自洽）
```

### 7.3 ★★★ 而那 3 条"新增"里，只有 **1 条** 是本轮改出来的 —— 我逐条追到了成因

**① `gate-tool-output-schema` 臂 1** —— 与本轮 t11 的改动**无关**，是夹具自己的合成值：

```
AssertionError: ★ 工具的返回值通不过自己的 output schema …
  agent_teams_restart: "value.code_on_disk_in_effect" must be one of ["yes","no","unmeasured"]
```

夹具 `fullValueForAll` 给**必填字符串**造的是 `'x'`（`valueFor` 的 else 分支），
而 t11 新加的 `code_on_disk_in_effect` 是**全仓唯一一个 output 层 `required+enum`**：

```bash
$ grep -rn "enum: \[" src/tools/ | while read …分类 input/output…
enum@5731 [INPUT ] 'passed'
enum@7515 [OUTPUT] 'yes', 'no', 'unmeasured'     ← 全仓唯一
```

我用宿主自己的校验器验了：

```bash
$ node --input-type=module -e "const {validateJsonSchemaValue}=await import('@deepseek-ai/dsh-tools');…"
"yes"          ⇒ []
"no"           ⇒ []
"unmeasured"   ⇒ []
"x"            ⇒ ["\"value.code_on_disk_in_effect\" must be one of [\"yes\",\"no\",\"unmeasured\"]"]
```

⇒ **产品返回的三个值全都合法；红的唯一原因是夹具造了一个产品永远不会返回的字符串。**
这属于「声明面 vs 夹具的合成值」这条已知形态（夹具是 2026-10-19 的 `ab36de0`，
t11 是 2026-10-20 的 `3813158`——**新加一个枚举格子，把一个老夹具撞红了**）。
⇒ 我判它是**夹具需要跟上**（而不是产品有 bug），但这**必须记账**：它让 t11 的"我改对了"
与"CI 红了"同时成立，而 CI 红的原因与 t11 毫无关系。**这正好是本轮母题的第 N 次重演。**

**② `gate-t1-completion-probe` 臂 5** —— 依赖**盘面上的真实台账**，而台账被这一轮的活动改了：

```
AssertionError: ★ t1 的记录里【不该】有 baseRevision，且它的 kind 会建 worktree ⇒ 这正是 `not-recorded`
$ node -e "…读 .agent-teams/unified-pipeline/team.json 的 t1…"
t1 = {"id":"t1","kind":"implementation","attempt":10,"status":"completed",
      "baseRevision":"351c2e32a2a0527c0cbea041e8baa972654e975e","hasOwn":true}
```

臂的前提是「t1 从来不曾有 baseRevision」，而**现在它有了**（`attempt=10`，
说明这条任务被真实重跑过十次）。⇒ **不是本轮改坏了代码，是本轮的真实使用改掉了那条臂的语料。**
★ 这一条与 t7 撞到的"臂 8 对着真实台账断言"是**同一族**：夹具把**会变的数据**当成了不变量。
⇒ 它现在在这个工作区里**恒红**，而在干净 checkout 里**恒绿** —— 两个环境两个答案。

**③ `gate-readout-uniform`** —— ★ **这一条是真·本轮引入的，我把它追到了具体两行代码**

```
$ node --test scripts/gate-readout-uniform.test.mjs      # HEAD 00cfcb1
Error: Build failed with 1 error:
[INVALID_OPTION] Invalid value for option "output.file" - When building multiple chunks,
                 the "output.dir" option must be used, not "output.file".
```

同一份夹具文件在开工前 HEAD 上**绿**（12 tests / 11 pass / 0 fail），文件逐字相同
（`diff -q` 相同，且本轮 `git log a669781..HEAD -- scripts/gate-readout-uniform.test.mjs` **空**）。
⇒ 差异只能来自**被测源码的形状变了**。我把它量到底：

```bash
$ node -e "…用 rolldown 分别 bundle preround 与 HEAD 的 src/tools.ts…"
preround(a669781)    chunks = 1 | write(file:) = OK
HEAD(00cfcb1)        chunks = 3 | write(file:) = FAIL
```

**根因**：`a9cd9ff`（t2 / N1）在 `src/tools/shared/entities.ts:1409-1410` 新加了两处
**本地模块的**动态 import：

```ts
const { deriveCollectionIndex } = await import('../../evolution/read.ts')
const { dedupeKeyOf } = await import('../../gates/collection/shared.ts')
```

全仓此前**没有**任何本地动态 import（`grep "await import('\."`：preround 零命中，HEAD 两命中），
⇒ rolldown 从"单 chunk"变成"多 chunk"，而夹具用 `bundle.write({ file })`
在多 chunk 下是非法的。

★ 我试过把它归因于别的：先把这两处换成静态 import 再跑（定向突变 E）——**仍然红**，
因为 `shared.ts` 还被别处**静态** import（rolldown 自己报了 `INEFFECTIVE_DYNAMIC_IMPORT`）。
⇒ 结论要更窄：**不是"那两行 import 写错了"，而是"t2 让这棵依赖图出现了 chunk 分叉"。**
★ 这一条我判 **refuted（t2 引入）**，同时**不判"t2 的实现错了"**：
`await import` 在那里是刻意的（延迟加载），要修的是夹具的 `write({ file })` → `write({ dir })`。
两者必须分开记账，否则下一个人会去改产品代码。

### 7.4 pin 清单与盘面的一致性（`refuted`）

```bash
$ node -e "…读 scripts/fixtures/baseline-known-failures.json…"
pin 条数 18
含 gate-stale-module ? false      含 gate-tool-output-schema ? false
含 gate-t1-completion-probe ? false   含 gate-reviewed-passthrough ? false

$ comm -12 /tmp/fails-base3.txt /tmp/pin.txt | wc -l    ⇒ 12   （34 条里 12 条在 pin 内）
$ comm -23 /tmp/fails-base3.txt /tmp/pin.txt | wc -l    ⇒ 22   （22 条不在 pin 内）
$ comm -13 /tmp/fails-base3.txt /tmp/pin.txt | wc -l    ⇒  6   （pin 里 6 条今天不红）
```

⇒ 这份 pin 清单**已经与实际盘面分叉**：18 条里 6 条不再红，而 22 条在红着却没登记。
★ 这**不是**"清单没维护"那么简单 —— `_adding` 的规矩逐字要求「那条失败必须在你改动之前就存在」，
而这 22 条里有 **19 条**确实在我开工前就红了（§7.2 的 `preround` 读数）。
⇒ **它们本该被 pin，但没有。** 而 t7 之所以被完成门挡住三次，正是因为这份清单太窄。
**修清单比修那 19 条便宜得多，而它今天不在任何人的写域里。**

---

## 8. 逐条裁决表（★ `could-not-measure` 不并进 `confirmed`）

| # | 条目 | 裁决 | 依据 |
|---|---|---|---|
| 1 | **N1 读数**（total 49 / observeShaped 39 / keyPresent 0）与脚本对得上 | **confirmed** | §1.2 §1.3，连 sha256 同源 |
| 2 | **N1 写侧**真的把 `collected` 落盘（新行带键、`undefined` 写成 `"unmeasured"`） | **confirmed** | §1.4 自造两条信号 |
| 3 | **N1 有守**：有已提交的臂会在 collected 丢失时变红 | **refuted** | §1.5 突变 C 全量零新增红 |
| 4 | **N5 halted 先于 approved**（真实 `haltTeamWork` 路径） | **confirmed** | §2.2 B→C + D 反向对照 |
| 5 | **N5 未复用 `team.escalated`** | **confirmed** | §2.3 源码 / 行为 / 写点三重 |
| 6 | **N5 放行闸真的读上限**（rounds 2/3/4 三行只动一个自变量） | **confirmed** | §2.5 |
| 7 | **N5 解除 = 显式归零**（只清 flag 是死码） | **confirmed** | §2.6 C/D/E 三行 |
| 8 | **N5 有已提交的臂** | **refuted** | §2.7 突变 B 零新增红；734 refs 全查过 |
| 9 | **N5 计数口径 per-CALL**（一次调用 5 operation 只算 1 轮） | **confirmed** | §2.4 `rounds = 1` |
| 9b | **N5 阈值**：第 maxRounds+1 次后 `escalated` | **confirmed** | §2.4 第 4 次 `rounds=4 flag=true escalated`。★ **我一开始判成 refuted，是我读宽了契约**（见 §2.4 那段自纠） |
| 10 | **N5 文本面**：`plan_loop` 在 `renderStatus` 里可见 | **refuted** | §2.8 `includes('plan_loop')=false`；t8 已披露 |
| 11 | **W1 判据两侧都能出现**（reclaimable + keep），自造两棵已知树 | **confirmed** | §3.2 |
| 12 | **W1 方向随主干引用翻**（不是恒真/恒假） | **confirmed** | §3.3 换 `mainRef` 后四行全翻 |
| 13 | **W1 真实盘面读数**（`resolveTrunkRef` 答集成分支而非 `main`） | **confirmed** | §3.4 |
| 14 | **G8**：`planReclaim` 会删掉非终态任务的树 | **refuted（已知未修）** | §3.5 我复现：`in_progress` 的树被判可清 |
| 15 | **N6 半 A**：不调工具仍逐字被拒（含 f-0395 全串相等） | **confirmed** | §4.2 `510+28=538`，整串 === |
| 16 | **N6 半 B**：调工具拿戳建任务不被拒 | **confirmed** | §4.3 且被另一条判据反向挑中过 |
| 17 | **N6 的 15 条臂会在 CI / `pnpm verify` / `verify:fast` 上跑** | **refuted** | §4.4 三处入口全不含 `scripts/tools/`；`select-fixtures` 的总体只有 `gate-*.test.mjs` |
| 18 | **定向突变至少一次**（做了四次，两次有判别力） | **confirmed** | §5，A 抓到 3 条臂；B/C/D 零条 |
| 19 | **t9 反向半边**：`kind:'implementation'` 缺 objective/acceptance 必须被拒 | **confirmed** | §5.5 真实工具，指名缺 objective |
| 20 | **t9 `requireExplicitKind` 不是"更松"** | **confirmed** | §5.6 A 行落回 `work` |
| 21 | **t9 双层拒真的是两层** | **confirmed** | §5.4 短路第二层后第一层仍拦 |
| 22 | **t10/D2**：已完成任务的历史 assignee 不再挡住 edit_plan | **confirmed** | 附 §A.1（夹具 patched 真实 team.json，两半都成立） |
| 23 | **t14 真的腾出空间** | **confirmed（按 `df` 口径）** | §6.1 1.7G / 1 棵 / 4.5 GiB 可用 |
| 24 | **硬链接机制**（删中间链接释放 0 字节） | **confirmed** | §6.2 受控实验：`rm a` ⇒ −2608 KiB；`rm b` ⇒ +314080 KiB |
| 25 | **t14 报的 `nlink=9` 这个具体值** | **could-not-measure** | §6.2 现盘 `nlink=1`；八树里 `-links +2` 计 0 |
| 26 | **全量复跑按集合差报** | **refuted（队长基线不可复现）** | §7.1 四个读数都不是 1669/1602/29 |
| 27 | **本轮新增红 3 条里只有 1 条是本轮引入** | **confirmed（我自己的结论）** | §7.3 逐条追到成因 |
| 28 | **pin 清单与盘面一致** | **refuted** | §7.4 18 条里 6 条不红、22 条红着未登记 |
| 29 | **`review-plan` 的 15 条臂**单跑全绿 | **confirmed** | §4.4 `15/15` |

★ **`could-not-measure` 只有第 25 条一格，它没有并进任何 `confirmed`。**

---

## 9. 这一轮必须留给下一个会话的四条

```
① ★★ 三个新交付【零臂覆盖】：describePlanLoop（五态）、collected 三态落盘、
   requireExplicitKind（第二层）。定向突变 B/C/D 在这三处上全量零新增红。
   ⇒ 它们今天的状态是「实现正确、读数由我手搭的探针作证、产品没有任何东西会守住它」。
   最便宜的补法：三条各一条臂（我 §2.7 / §1.5 / §5.6 里的探针可直接改成 test()）。

② ★★ review_plan 的 15 条臂不在任何标准命令里（scripts/tools/ 不在 test:gates、
   不在 verify、也**不在 verify:fast 的候选集**里 —— `select-fixtures.gateFixtures()`
   只枚举 `scripts/gate-*.test.mjs`）。
   最便宜的补法：把 `scripts/tools/*.test.mjs` 加进 test:gates 的 glob（或给它换个
   `gate-` 前缀挪回 scripts/，让快环至少**有可能**选到它）。

③ ★ 基线读数不可比：同一天里 tests 在 1660/1665、fail 在 30/34/36 之间跳。
   报"我跑过了"必须带【逐条名单 + 集合差】，否则"存量当增量"必然重演（本轮已发生一次：
   22 条被当新红，其中 19 条在我开工前就红了）。

④ ★ `du` 回答不了"腾出多少"，只有 `df` 差能。t14 的受控实验我复核成立；
   而那个 `nlink=9` 的具体值今天测不到（现盘 nlink=1）。
```

---

## 附录 A · 我额外做、但不在验收清单上的三条

### A.1 t10/D2（已完成任务的历史 assignee）：`confirmed`，两半都成立

我用真实 `team.json` 造了那种形状（`t1` 已完成、`assignee: 'dev'`、roster 里把 `dev` 换掉）：

```bash
$ node /tmp/probe-d2b.mjs
夹具就绪：tasks = t1:completed:dev | members = newdev
① 已完成任务的历史 assignee=dev（不在 roster）⇒ edit_plan OK  ✓ D2 已修
② 反向半边：未终结任务的历史 assignee ⇒ REJECTED ✓ task "t1" assignee "dev" is not an active member
```

**反向半边真的还在**：把同一条任务改回 `pending`，`edit_plan` 立刻被拒。
⇒ 这不是"把校验删掉了"，是"只对未终结的任务校验"。`confirmed`。

### A.2 t14 删掉的七棵树，补丁是真的吗

```bash
$ for p in t2 t7 t8 t9 t16; do grep -c '^diff --git' .agent-teams/worktree-salvage/self-iteration-3-$p-final.patch; done
18 / 34 / 45 / 59 / 14          ← 五份都非空
$ for t in t2 t7 t8 t9 t16; do 抽首 3 个 diff 的文件 → git cat-file -e HEAD:<file>; done
全部 present in HEAD
```

★ 而 `t10-final.patch` 与 `t19-final.patch` 是 **0 字节** —— 队长在 commit message 与
`README.md` 里**主动写了原因**（那两棵树的 HEAD == base，实现是队长在主树直接写的）。
这与 t14 记的"补丁非空 ≠ 有未合流产出"是**同一个判据的两侧**，处置正确。

### A.3 我用过的环境有一处要说清

我的全量复跑在**同一个工作区**里跑，而队长在此期间又做了两次清盘（`00cfcb1`）。
⇒ 我的 `fails2`（`8fd496d`）与 `fails-base3`（`00cfcb1`）**是同一份失败集**
（`comm -3` 空），但**树数从 8 变成 1** 发生在两次之间。
`gate-t1-completion-probe` 的红就是这期间产生的（§7.3 ②）。
★ 这条写下来是因为它本身就是一个**读数陷阱**：两次跑的 HEAD 不同、盘面不同，
若我只报"34 → 34，没变"，就会把"盘面变了"这件事读成"什么都没发生"。

---

## 附录 B · 复跑清单（全部只读，不写仓库）

```bash
# ① N1 独立重算（我用的就是这条）
node -e "const fs=require('fs');const raw=fs.readFileSync('.agent-teams/evolution/signals.jsonl','utf8');const L=raw.split('\n').filter(Boolean).map(x=>JSON.parse(x));console.log(L.length, L.filter(s=>s.source&&s.source.where).length, L.filter(s=>'collected' in s).length)"

# ② N1 写侧（会往临时目录写，不碰仓库）
node /tmp/probe-n1-write.mjs

# ③ N5 五态 + halt（真实 haltTeamWork）
node /tmp/probe-halt.mjs

# ④ N5 放行闸三行 / 阈值三行 / 解除三行
node /tmp/probe-approve-gate-order.mjs ; node /tmp/probe-rounds3.mjs ; node /tmp/probe-n5b.mjs

# ⑤ W1 两侧 + 方向翻转
cd /tmp/w1-probe && node --input-type=module -e "…judgeWorktreeReclaimable…"
node scripts/worktree-reclaim.mjs

# ⑥ N6 两半（真实工具入口）
node /tmp/probe-n6-tool.mjs

# ⑦ 全量（★ 必须按集合差报，不要只报总数）
pnpm test:gates
```

★ 上面 `/tmp/probe-*.mjs` 是我在 `/tmp` 里手搭的探针，**不在仓库里** ——
这正是 §9 ① 那条缺口的来源。若要它们变成不会腐烂的东西，动作是把它们**改成 `test()` 进仓**，
而不是留在 `/tmp`。
