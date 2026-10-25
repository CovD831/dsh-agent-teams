# 本机的互联网能力（Agent Reach）—— 装了什么、怎么用、边界在哪

> 建立：2026-10-22。**触发**：用户第二次让我去搜索时说的那句话 ——
> 「你要不去装一个 agent reach 吧，应该可以帮你把一些搜索成功做掉吧。
>  **你一直都是搜索不到**，我一直都让你用 CUI 呀去做，但是其实这也不是个事儿，对吧」

---

## 0. 一句话

**「没有通道」与「搜了没结果」在对话里同形** —— 用户只看到我在原地打转。
装完之后它们**不同形了**：缺安装报 exit 2 并说清缺什么，搜不到才是空结果。

---

## 1. 装之前是什么状态（MEASURED，两次）

```
web_search 工具        ⇒ HTTP 401：「Your api key: ****dbc1 is invalid」
                          （搜索端点的 base URL 与 chat 端点不是一回事）
web_fetch github.com   ⇒ 「URL hostname "github.com" resolves to a non-public IP address」
```

⇒ ★ 这不是"模型不会搜"，是**本机没有可用的互联网通道**。
  而它挡住了两件事：**读参照物源码之外的东西**、以及**这个仓的自迭代里"查资料"那一环**。

---

## 2. 装了什么

```
Agent Reach v1.5.0（Panniantong/Agent-Reach，MIT，10 万★）
  定位：选择器 / 安装器 / 体检器 / 路由器 —— **不是包装器**
        上游工具直连（Jina Reader · gh · yt-dlp · bili-cli · twitter-cli …）

位置（★ 都在工作区内，已 gitignore）：
  .agent-reach-venv/        Agent Reach 本体（venv 安装）
  .agent-reach-npm/         mcporter（全网搜索的调用器）
  config/mcporter.json      ★ **进仓**：只含一个公开 MCP 地址，无凭据

搜索：Exa MCP（https://mcp.exa.ai/mcp，免费、无需 key）
```

### ★★ 为什么装在工作区里（而不是 `~/.agent-reach-venv`）

```
装的时候：python3 -m venv ~/.agent-reach-venv  ⇒ EPERM（沙箱只允许写工作区）
          npm install -g mcporter              ⇒ 两个 ~/.npm 目录是 root-owned
          mcporter config --scope home         ⇒ EPERM 写 ~/.mcporter
⇒ 三个路径全被沙箱或权限挡住
```

★ 用户裁定：**留在工作区 + 加 .gitignore**。
★★ 代价如实记：这棵树被移动/重建时，互联网能力要重装（见 §3 的一行命令）。

---

## 3. 怎么用

```bash
node scripts/agent-reach.mjs doctor             # 哪些渠道通、哪些要配（只读）
node scripts/agent-reach.mjs search "<query>"   # 全网语义搜索（Exa）
node scripts/agent-reach.mjs read <url>         # 读任意网页（Jina Reader）
```

**重装（若目录被清）**：
```bash
python3 -m venv .agent-reach-venv
.agent-reach-venv/bin/pip install https://github.com/Panniantong/agent-reach/archive/main.zip
npm install --prefix .agent-reach-npm --cache .agent-reach-npm/.cache mcporter
.agent-reach-npm/node_modules/.bin/mcporter config add exa https://mcp.exa.ai/mcp --scope project
```

**当前状态（`doctor` 实测，2026-10-22 第二轮配完登录态之后）**：**5/16 渠道可用 + 1 条已配好登录态**
```
✅ 任意网页（Jina Reader）        ✅ RSS/Atom
✅ V2EX                          ✅ 全网语义搜索（装 mcporter 之后）
✅ B站（bili-cli，★ 复用 Edge 登录态，已实测搜到结果）
[~] X/Twitter（twitter-cli，★ 复用 Edge 登录态，已实测搜到结果；
    doctor 只报 warn —— 它**拒绝**执行 `twitter status`，因为上游验证失败时会
    自动回读浏览器 cookie。★ 这一格是 doctor 的诚实，不是渠道没通）
[!] GitHub（gh 已装，未做实时认证检查）
[!] YouTube（yt-dlp 已装，缺 --js-runtimes node 配置）
[X] 其余 8 个可选渠道（Reddit / Facebook / Instagram / 小红书 /
    小宇宙 / 雪球 / LinkedIn / Boss直聘）—— 都要各自的登录态
```

---

## 3b. ★★★ 两条渠道配了登录态 —— 以及它们**各自踩的坑**（2026-10-22 第二轮）

用户原话：
> 「你可以配置推特（其实现在就是 X），包括 B 站你也可以去配置。其实**你可以复用我 Edge 浏览器的登录状态**」

### ★★ 先说那个把两者连起来的机制：隔离的 `HOME`

Agent Reach 用 `HOME` 定位配置目录（`agent_reach/utils/paths.py` 逐字：`explicit_home` 优先）。
而沙箱只允许写工作区 ⇒ **把 `HOME` 指进工作区**，凭据才写得下、也才收得住：

```
.agent-reach-home/            ← 含凭据，**已 gitignore**
  .agent-reach/config.yaml            X 的 twitter_auth_token / twitter_ct0；B 站的 sessdata / csrf
  .bilibili-cli/credential.json       bili-cli 的凭据
  .twitter-cli/transaction_cache.json ★ X 的那个坑的修法（见下）
```

★★★ **一条顺序错误，如实记下**：我先 `mkdir` 了这个目录、把凭据写进去，**之后**才想到 gitignore。
中间那一段 `git status --short` 已经把它报成 `?? .agent-reach-home/` —— 一次 `git add -A`
就会把登录态提交进仓库。现在 `scripts/gate-agent-reach-channels.test.mjs` 臂 3 钉住它。

### 坑 ①（X）：`HTTP 404`，而真因不是没登录

```
症状   twitter search "…"  ⇒ HTTP 404（不是 401、不是 429）
真因   `x-client-transaction` 初始化失败：它去 x.com 首页找 `ondemand.s.<hash>a.js`
       的指纹，而**未登录的首页是登录墙、里面没有那段** ⇒ 请求缺 `x-client-transaction-id`
修法   带 cookie 取 `https://x.com/home`，把 home_html + ondemand 写进
       `~/.twitter-cli/transaction_cache.json`（twitter-cli 自己会读它，TTL 1 小时）
```

★ **一条走了的弯路**：我先怀疑是 queryId 过期，改了 `graphql.py` 里的常量 —— **改了没用**，已回退。
  ⇒ 这正是"症状同形"的代价：`404` 同时能由"queryId 过期"和"缺 transaction id"产生，
    而我只看了前者。

### 坑 ②（B 站）：`No cookies found`，而 Edge 明明登录着

```
症状   agent-reach configure --from-browser edge --platform bilibili ⇒ "No cookies found"
真因   Edge **开着**时 Cookies 库被锁/未落盘；而 browser_cookie3 直接读活库会
       `Unable to get key for cookie decryption`
修法   先 `cp` 一份到临时目录再解，解出来写进 bili-cli 的 credential.json
```

★ 实测：解出来的 `SESSDATA` 一写进去，`bili status` 立刻报 `authenticated: true`（用户名可见）。

### 用法（两条都进了包装器 —— 凭据只经**子进程环境**，不进 argv）

```bash
node scripts/agent-reach.mjs x search "pixel art office agents" -t photos -n 8
node scripts/agent-reach.mjs bili search "像素风 等距 房间 场景" --type video
```

★★ 为什么必须进包装器：这条链上有**三个隐含前提**（`HOME` 指向哪、`twitter`/`bili`
在不在 `PATH`、两个凭据从哪来）。任何一个缺了，症状都是**同一条** `404` / `未登录` ——
⇒ 让包装器自己负责，别让下一个人再猜一遍。

### ★★ `doctor` 为什么仍把 X 报成 `[!]` —— 那是它的**诚实**，不是没配好

```
上游 agent_reach/channels/twitter.py 逐字：
  「Doctor cannot disable that fallback, so executing it would violate
    the Cookie-Editor-only policy.」
⇒ 它**拒绝**执行 `twitter status`，因为上游在验证失败时会**自动回读浏览器 cookie**。
⇒ 于是它只能报 "凭据已配置，但未实时验证"。
```

★ 判据 `scripts/gate-agent-reach-channels.test.mjs` 臂 2 钉住的是**相反**的一件事：
  wrapper 的 `doctor` 必须是**只读**的（修之前它偷偷跑 `install --env=auto` ——
  一条叫 doctor 的命令在改机器状态）。体检 ≠ 治疗。

★★ 而"X 到底通没通"的**唯一**可信读数是**真跑一次搜索**：
```bash
node scripts/agent-reach.mjs x search "pixel art" -t latest -n 3   # 有结果 = 通
```

---

## 4. ★★★ 它第一次跑就纠正了我一个做法（这条最值）

搜到 `pixeli.pebbly.space/knowledge/rules/71-isometric` —— 一份**像素等距的规范**。
逐条对我们的房间实现（`src/client/room-iso.ts` / `room-canvas.ts`）：

| 规范 | 我们 | 判定 |
|---|---|---|
| rule 3：菱形 2:1，标准尺寸 `16×8` / `24×12` / `32×16` | `TW=16, TH=8` | ✅ 对 |
| rule 8：从远到近画，**按 `x+y` 升序**，再按高度 | `depthOf = u + v` 排序 | ✅ 对 |
| rule 18：世界坐标 → 屏幕 `((x−y)·W/2, (x+y)·W/4 − z)` | `toScreen` 逐字相同 | ✅ 对 |
| rule 5：**三个明度，一个光源，全场不许翻**：顶最亮 / 左中 / 右最暗 | 桌子 `deskTop #564a63` > `deskLeft #362e40` > `deskRight #41374d` | ⚠️ **左比右暗，方向错了** |
| rule 15：**每个物件都要有接地阴影** | 没有 | ⬜ 缺 |
| rule 16：人物 24–32px（网格 `32×16` 上） | 24px（网格 `16×8` 上） | ⚠️ **偏大**：规范说 8/16 的格子"props ≤ 16px" |
| 规范对尺寸表的说法 | — | ★ 「**8**：不值得用，8×4 的菱形会糊成一团。16：props ≤ 16px」 |

★★ **两条待定**（写在这里而不是擅自改，因为它们改的是"房间多大"）：

```
① 网格要不要从 16×8 升到 32×16？
   规范说 16×8 的格子里 props 不该超过 16px，而我们的角色是 24px。
   ⇒ 升级会让**一屏放不下一间房**（32×16 的格子，6 列就要 192px 宽 + 墙）。
   ★ 而这与"用户要一屏看完整间房"冲突 —— 所以它是个**取舍**，不是 bug。

② 左/右面的明度方向要不要翻？
   规范：光从左上来 ⇒ 顶最亮、**左面中**、**右面最暗**。
   我们：桌子左 `#362e40`（暗）右 `#41374d`（更亮）⇒ **方向反了**。
   ★ 这条**该改**（它是纯观感修正、零代价），但会动所有物件的配色。
```

---

## 5. ★★ 边界（这一节比上面所有内容都重要）

```
★ 它只解决「读得到网上的东西」。它不解决「读得对」。
★ 搜到的每一条仍然是**要核对的主张**，不是证据。
  ⇒ 本仓既有纪律不变：文档里的每条断言仍要能回答"它是否还在生效"。
★ 而"我搜到了"与"我核实了"是两件事 —— 与「我跑过了」和「跑对了」同一条纪律。
```

★ **一个具体的例子**：上面那份规范本身是**第三方的**像素画约定，
  不是"正确"的定义。它对我们有价值，是因为它把一些"手画容易错的地方"说成了可判定的规则
  （2:1、`x+y` 排序、三明度一个光源）—— 而**采纳哪几条仍是我们的判断**。

---

## 6. 与本仓需求的关系

这条能力服务于 `docs/REQUIREMENTS.md` §11 的**方向 2「深度挖掘」**：
> 「我给出几个方向之后，它能对这几个方向进行深挖」

★ 深挖要**读得到外部材料**（论文、参照实现、规范）。
  在此之前那一环只能用"我已 clone 下来的那一个仓"—— 那不是深挖，那是读一个样本。
★★ 所以它**不是**一个无关的工具安装：它是方向 2 的一个**前置**。

---

*本文只写 `docs/`。`.agent-reach-venv/` 与 `.agent-reach-npm/` 在 `.gitignore` 里。*
