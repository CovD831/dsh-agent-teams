# t96 交付记录 · 吸收上游 #174（一半）：行号锚点剥除 + 未验证声明

> **上游逐字**（v0.1.23 `648fd9a`）：「#174 Auto-generated repair work orders were frozen at finding-generation time. They now record the workspace snapshot …, are flagged stale …, and their acceptance **loses drifting line anchors** and **states that the plugin did not verify the finding's claims.**」

## 1. 落地了什么

| 格 | 内容 |
|---|---|
| `stripLineAnchors(text): string` | 纯函数，导出自 `src/quality-gates.ts`（与 repair-scope 家族同区）。剥掉会漂移的行号锚点，**路径本体保留**（那是能活过编辑的内容锚点）。 |
| 修复任务 acceptance（repair 轮次） | ① 每条 `finding.requiredFix` 过一遍剥离；② 末尾追加**未验证声明**（上游逐字要求的"states that the plugin did not verify the finding's claims"）。 |
| requirements 轮次 acceptance | 同样过剥离 + 同样追加声明（同一根因：acceptance 同样取自 `requiredFix`）。 |

**未验证声明文本**：`the plugin has NOT verified these findings' claims - verify each against the current code before fixing (finding line numbers may have drifted)` —— 它同时把"行号可能已漂移"这句话也说了，与剥离动作互补。

## 2. ★★ 剥得准：三条 lookbehind（这是本任务最难的格，实测迭代出来的）

第一版照上游的正则（`(?<!\/\/)(?<=[A-Za-z0-9_./\\-][A-Za-z0-9_./\\-]*):\d+…`）实测**剥掉了时间**（`12:30`→`12`）、比分（`3:1`→`3`）、版本段（`v1:2`→`v1`）、甚至 URL 端口（`localhost:3000`→`localhost`）—— 因为它的 lookbehind 只要求"前两个字符是路径字符"，裸数字也是路径字符。**反向半边 B 当场红 —— 这正是它存在的意义。**

最终判据（三条 lookbehind，缺一不可）：

```
/(?<!\/\/)                                  ← ② 前面不是 //（URL scheme）
  (?<!\/\/[A-Za-z0-9_./\\-]*)               ← ③ 前面那段不以 // 开头（主机:端口 —— localhost:3000 的
                                               "localhost" 本身带点形态，②拦不住它，必须靠这条）
  (?<=[A-Za-z0-9_./\\-]*\.[A-Za-z0-9_./\\-]*)  ← ① 前面的词必须【含一个点】（文件形态）
  :\d+(?:-\d+)?\b
/gu
```

- ① 排掉 `12:30`（裸数字无点）、`3:1`（比分）、`v1:2`（版本段无点）；
- ② 排掉 `https://example.com/docs`（scheme 后的 `//`）；
- ③ 排掉 `http://localhost:3000` / `http://example.com:8080`（**主机带端口**的 URL —— `localhost`/`example.com` 自身满足①，必须靠③）；
- 保留被剥：`src/a.ts:42` · `foo.go:503-505` · `README.md:3` · `lib/y.ts:7-9`。

★ 上游用的是同一条思路（lookbehind + 路径字符前缀）；本仓反向半边 B/C 更严（要保住 `http://host:port`），所以比上游多第 ③ 条 —— 这是**实测逼出来的**，不是审美。

## 3. 三条反向半边（夹具 `scripts/gate-strip-line-anchors.test.mjs`，6 test 全绿）

| 臂 | 钉什么 |
|---|---|
| **A** | `src/a.ts:42` / `foo.go:503-505` / `README.md:3` / `lib/y.ts:7-9` 全被剥，**路径保留** |
| **B** | `12:30` · `9:15-9:45` · `https://…` · `http://localhost:3000/health` · `v1:2` · `3:1` **原样保留** |
| **C** | 同一条混合文本（时间+行号+URL+版本段）⇒ 剥行号、留时间/URL/版本 —— 一刀切实现在这条当场红 |
| 4 / 4b | 走**真实编排路径** `planQualityFollowUp`：repair 与 requirements 两个轮次的 acceptance ① 行号已剥 ② 路径与时间幸存 ③ 未验证声明恒在场（最后一条）④ 剥离不产出空条目 |
| 5 | 纯函数：同输入两次调用同输出；无锚点文本逐字不变；空串 |

## 4. Verify

- `npx tsc -p tsconfig.json --noEmit` exit=0；`npx tsc -p tsconfig.client.json --noEmit` exit=0；`pnpm build` exit=0（`stripLineAnchors` 与两处调用点均进 `lib/quality-gates.js`）。
- 净变化用**失败文件集合**对照跑判定（见 §6）。

## 5. 不许越界（如实遵守）

上游 #174 的另一半 —— **记录 workspace snapshot + 被引用物变化时标 stale** —— 需要 S1（内容摘要）那个模型，本任务**没做**；t95 交付物已记本仓与上游在 `648fd9a` 上仍有 #161/#174(这一半)/#175 三处差距。

## 6. 净变化判定

**两轮对照**（均 `git stash --include-untracked` + 先确认对照跑建得起来）：
- 对照（改动前）**1503 tests / 1442 pass / 23 fail / 16 文件**；改后 **1509 tests / 1448 pass / 23 fail / 16 文件**（+6 tests = 我的夹具 6 臂；fail 数不变：那 3 条 `quality-gates-repair-scope` 旧断言红**在对照跑不存在**——旧行为本来就绿，改后由更新后的断言钉新形状，依旧绿）。
- **失败文件集合 16 vs 16，逐文件失败测试名剥用时戳后零差异**；我的夹具 6 臂全绿。一次中间红（build-atomic 臂 10）再次溯源为并发 build 竞态，干净重跑一致。

## 6b. ★ 既有夹具的断言更新（队长裁定 (a) 授权）

`scripts/quality-gates-repair-scope.test.mjs:127` 的旧断言钉的是**逐字透传**（`repair.acceptance == requiredFix`）——那正是 #174 改掉的行为。经队长授权（同等强度要求），更新为：

- **前 n−1 条** = 每条 requiredFix 的**字面**期望（`deepEqual`）—— 本夹具三条 case 均无行号锚点，字面=原文；**不许**调 `stripLineAnchors` 自算期望（用被测函数算期望 ⇒ 函数坏了断言恒真，那正是裁定要防的形态）；
- **末条** = 未验证声明，**内容**单独点名（`/NOT verified these findings' claims/i` + 补救动作 regex）；
- **条数钉死**：`length === findings.length + 1`（不许有别的夹带）。

★ **改动范围**（裁定边界）：该夹具只动了 import 一行 + 这一条断言及其注解；**其它臂零改动、条数不减、finding 数据零改动**（diff 实测：删除行 = 2，其中 1 行是 import；无任何 `test(`/`finding({` 行被改）。

★ **反向半边的诚实记账**（队长裁定 ③ 的核心要求）：
- **disclaimer 反向半边在两个夹具上都成立**：把声明从 src 移除并重建 ⇒ `quality-gates-repair-scope` **3 臂红**、我的夹具 **1 臂红**；恢复后全绿。
- **strip 反向半边在本夹具结构性不可检**：该夹具三条 case 的 requiredFix **均不含行号锚点**（带锚点的 finding 在另外两个只测 scope 推导的测试里，不经过 planQualityFollowUp 的 acceptance）⇒ identity-strip 下新旧断言**必然同绿**。**裁定 ③ 由我的夹具兑现**：identity-strip ⇒ `gate-strip-line-anchors` **4/6 红**。这条不对称已如实记下，不是被隐瞒的弱化。

## 7. 局限

1. **未验证声明只加在自动生成的轮次任务上** —— 其它手工契约的 acceptance 不在本任务落点内。
2. 剥离只对 `requiredFix` 文本；`finding.line`（数字格）仍在 `ReviewFinding` 上未动 —— 它是**记录**（问题在哪发现的），不是 acceptance 的一部分；S1 之后由 stale 标记处理它的漂移。
3. 判"必须保留"的案例集来自本仓会话的真实形态（时间/URL/版本/比分）；一个新形态（如 IPv6 `::1`）今天不在名单里 —— 夹具臂 2 的保全体可以随实测扩充。
