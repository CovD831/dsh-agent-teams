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

**当前状态（`doctor` 实测）**：**4/16 渠道可用**
```
✅ 任意网页（Jina Reader）        ✅ RSS/Atom
✅ V2EX                          ✅ 全网语义搜索（装 mcporter 之后）
[!] GitHub（gh 已装，未做实时认证检查）
[!] YouTube（yt-dlp 已装，缺 --js-runtimes node 配置）
[!] B站（搜索 API 通；完整功能需 bili-cli）
[X] 其余 9 个可选渠道（Twitter / Reddit / Facebook / Instagram /
    小红书 / 小宇宙 / 雪球 / LinkedIn / Boss直聘）—— 都要登录态
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
