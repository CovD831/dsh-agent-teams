# UI v5：文件夹 → 工作区 → 团队 → 会话（2026-10-17）

> **用户裁定（逐字要点）**
> 1. 「侧边栏的项目和 session **可以没有,或者保留**」
> 2. 「整个主界面需要**一个图形化的界面**,因为**前端做得好看,是一个产品能够宣传的很重要的因素**」
> 3. 「前端首先做一个**统一入口**,呈现出来类似于**一个文件夹的形式,一个文件夹就相当于一个工作区**」
>    (a) 「一般来说,一个工作区跑一个 session,就对应一个团队;如果跑多个会话,就可以有多个团队,
>        类似于**公司的组织形式**」
>    (b) 「界面要**非常形象化和图形化**,风格可以往**像素风**上做（因为像素风比较好做）,
        有点像**游戏界面**。比如可以把团队和每个成员都**画出来**,简洁地显示他们在干什么」
>    (c) 「**点击工作区**进入后,可以显示 session。如果原本有其他工作需要其他团队,
        进入该工作区后,就**只会显示该工作区内的团队**,并且团队的信息会显示得**更详细**一点
        （因为占用的空间更大了）」
>    (d) 「**再点击具体的团队**,就会进入到**目前我们这个形式**,
        即有一个**主会话,侧边栏显示团队的前端界面**」
> ★★ **而定位不是 Grok BOT 那种云端 24 小时个人助手 —— 要学的只是【把入口聚合成一个】。**

---

## 0. ★★★ 技术可行性：**官方槽位完全支持,而这是查出来的,不是猜的**

### `'main'` 是 keyed 且 **scope: 'root'**

**官方逐字（`dsh-client-ui-layout` 的 SlotMap）:**
> 「`'main'`: **Central panel selected by sidebar entry id.**
>  The reserved `conversation` key hosts the Conversation;
>  ★ **other keys receive no Session binding.**」

⇒ ★★★ **那一句就是整个方案的成立依据:**
```
★ main 是【keyed】⇒ 可以注册多个 key（一个工作区一个?或一个"文件夹视图"一个）
★★ scope: 'root' ⇒ ★ 【不绑会话】
★★★ 而 "other keys receive no Session binding" ⇒ ★ 官方明确允许一个【没有会话】的中央面板
```

### ★★ 而官方的 `ConversationPanel` 就是那个形状的先例

```ts
export declare function ConversationPanel({ renderSlot }:
  PropsRuntime<'main'> & PropsRenderSlots<'main.conversation'>)
```
⇒ ★★ **即:注册一个 `main` 的 key,再**声明自己的子槽位** —— 那正是"画整个主界面"的官方形状。**

### ★★★ 而整屏浮层也有官方位:`shell.overlay`

**官方逐字:**
> 「**Frame-wide floating layer, above every column and outside their scroll containers.**
>  Deliberately generic and **unowned by any feature**……
>  ★ **The layer itself is click-through — entries opt back into pointer events —
>  so an occupant never blocks the app underneath.**」
> 「★ This is **the additive seat for a frame-wide surface of your own**」

⇒ ★★ **两级可用:**
```
· 'main' 的 key      ⇒ ★ 一个【真正的中央面板】（推荐:整屏、可交互）
· 'shell.overlay'    ⇒ ★ 一个【浮层】（click-through 缺省 ⇒ 适合"徽章/状态"而非主界面）
```

### ★★ 而侧边栏条目：官方 `sidebar` 槽位的措辞说明了它的归属

> 「The whole left column. **OCCUPIED by ui-sidebar's SidebarRoot, which declares
>  the workspace and settings seats inside it** —— registering here **replaces
>  the navigation column outright**, and the seats it declares **disappear with it**.
>  ⇒ **To add something to the sidebar, register into one of those inner seats instead.**」

⇒ ★★★ **即:【不许替换侧边栏】,而要注册进它的内层席位。**
★ **而那正好回答你的第 1 条（"侧边栏的项目和 session 可以没有,或者保留"）:**
```
★ 我们能【加】一个席位（例如"工作区"入口）
★★ 而【不能】把它的项目/session 树拆掉 —— 那是 ui-sidebar 的
⇒ ★★★ 所以第 1 条的答案是:保留它,而我们只在它上面【加一个入口】
   ★ 若真要"没有",那需要改 DSH 本身（或替换 sidebar 槽位,而那会连带丢掉
     workspace 与 settings 两个席位）
```

---

## 1. ★★ 所以四级形态映射到官方能力

```
① 文件夹（统一入口）    ⇒ ★ 我们自己的一个 main key（例:'agent-teams/folders'）
② 工作区内部（更详细）  ⇒ ★ 同一个 key 的下一层（或第二个 key）
③ 团队（目前的形式）    ⇒ ★ 已实现:sidebar.right.pane.tab（TEAM_TAB_ID）
④ 会话（主会话）        ⇒ ★ 官方的 'main/conversation'
```

★ **而"点击进入下一层"是【我们自己的状态】**,不是官方的路由 ——
**所以三层都在一个 `main` key 里由我们渲染。**
★★ **而那意味着:实现是一次性的,不需要 DSH 改动。**

---

## 2. ★★★ 而像素风那一条,要先核一件事

```
★ 用户说「风格可以往像素风上做（因为像素风比较好做）」
★★ 而"好做"要看【素材从哪来】:
   · 纯 CSS/内联 SVG 像素画 ⇒ ★ 好做（无外部依赖、无版权）
   · 位图素材（PNG sprite）⇒ ⚠️ 要画/要找，且**体积与版权**
⇒ ★★★ 所以建议【纯 CSS + 内联 SVG】,零新依赖
```

★ **而可用的表达（都在现有能力内）:**
```
· 成员 = 一个小人（SVG 像素格）
· 状态 = 颜色 + 动画（★ 六态字形已经有了:✓ ⊘ ● ○ · ✗）
· 团队 = 一间屋子/一排工位
· 工作区 = 一个文件夹图标
★ 而"简洁地显示他们在干什么" ⇒ ★ 现成的:MemberRow 已有 statusLine / roleLine / gateBand
```

---

## 3. ★★ 所以我的建议：分三步,而第一步今天就能做

| 步 | 做什么 | 依赖 |
|---|---|---|
| **①** | ★★ **最小实验**:注册一个 `main` key（一个不绑会话的面）,确认**无会话时它出现** | ★ 无 |
| **②** | ★ **文件夹视图**（工作区列表,像素风）| ① 成立 |
| **③** | ★ **工作区内部**（该工作区内各团队,更详细）| ② |
| **④** | **点击团队 ⇒ 走现有的 sidebar.right tab** | ★ 已实现 |

★★★ **而 ①【必须先做】,因为它验证的是整个方案的地基:**
```
★★ 官方那条限制说「No surface without a session. hero screen shows nothing on the right」
⇒ ★★★ 而 'main' 的 "other keys receive no Session binding" 是【另一条】说明
★ 两条【哪一条管我们】—— ★ 只有跑一次才知道
```

---

## 4. ★ 一条我如实说的

```
★ 本文的可行性结论来自【官方包的类型定义与 README】,不是跑起来的
★★ 而"无会话时 main key 会不会出现"是【两条官方说明的交界】——
   ★ 一条说 rightbar 无会话时不显示，另一条说 main 的其他 key 不绑会话
⇒ ★★★ 所以 ① 那个最小实验【不是形式】，它是【唯一的判据】
★ 若它不成立 ⇒ 方案要退到 shell.overlay（而那是 click-through 的浮层，弱一档）
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*

---

# 最小实验① 结果：不绑会话的 `main` key **注册得进去，但默认不会被选中**（t103）

> 基线：HEAD `df5d786`（`git merge-base --is-ancestor 71790be HEAD` ⇒ **成功**）。
> 探针：`src/client/folders-probe.tsx`；注册点：`src/client/index.tsx`；夹具：`scripts/gate-main-key-probe.test.mjs`（6 臂）。

## R1. ★★★ 结论：三态里的 **(b)**，不是 (a)，也不是 (c)

```
★ main 接受我们的 key（注册不抛、真的占了一个 cell）
★★ 但无会话时【默认不选我们】—— 选择器落到 conversation
⇒ 三态 = (b) registered-but-hidden
   ★ 不是 (c) registration-failed（那会连注册都进不去）
   ★ 不是 (a) appears-without-session（那才是"地基成立"）
```

★ **对应下一步**（任务书写明的映射）：**(b) ⇒ 方案要退到 `shell.overlay`**。

## R2. ★★ 官方那两条说明，哪一条管我们？—— **都不是直接管**

| 说明 | 说的是 | 实测它管不管我们 |
|---|---|---|
| ① `sidebar-right`：「**No surface without a session**」 | **rightbar** | ❌ **不管** —— 逐字写着 "shows nothing on the **right**" |
| ② `layout` 的 `'main'`：「other keys receive **no Session binding**」 | **main** | ⚠️ **半对** |

★ ② 的准确含义被我们测清楚了：**"no Session binding" 说的是"不绑会话也能注册"**（实测 ✅ 注册成功、真的占了 cell），
**而不是**"无会话时它会显示"。⇒ ★★ **"能注册"与"会被选中"是两件事**，而官方那句话只保证了前者。

★ **`main` 真正的门在【选择器】**，不在槽位声明：

```
dsh-client-ui-layout 的 MainPanel 逐字：
    entryKey = usePanelInfo((info) => info.activePanelId) ?? "conversation"
```

`activePanelId` 的**初值是 `null`**（store 的初值，实测 `panelInfo: { activePanelId: null }`）
⇒ `?? "conversation"` 把它折成 **`conversation`** ⇒ **我们的 key 不被渲染**。

## R3. ★★ 反向半边：两者行为**不同形**（测量是可信的）

| 读数 | `agent-teams/folders` | `conversation` |
|---|---|---|
| 注册是否抛 | **否** | **否** |
| 占用 cell | ✅ | ✅ |
| 无会话时被选中 | ❌（落 conversation） | ✅ |

★ **为什么必须做这一条**：若两者**完全一样**，那说明我们测的**不是"main 的其它 key"这件事**
（例如根本没走到选择那一步）。⇒ 判据层把它做成一个**读数**（`discriminates`），
且**负向也测**（两者同形 ⇒ `discriminates === false`，且那是判据给出的结论，不是靠人看）。

## R4. ★★ 判据全部是【可编程的】（本机没有视觉模型）

| 判据 | 怎么读 |
|---|---|
| 槽位形状 | `SlotCore.spec('main')` ⇒ `{kind:'keyed', scope:'root'}`（**真服务**，不是复刻） |
| 注册成没成 | `register(...)` 抛没抛 |
| 占了几个 cell | `entriesOfSlot('main')` ⇒ cell key 列表 |
| **出没出现** | ★ 探针每次渲染 `noteProbeRender(key)` +1 ⇒ `probeRenderCount(key) > 0` |
| 注不注册失败 | `noteProbeRegistrationError()` 收下的原文（★ **不裸抛**，见 R6） |

⇒ ★ **没有任何一条需要截图或肉眼**。

## R5. ★★ 一个反直觉的发现：`register` 成功 **不代表** 会被渲染

`SlotCore.entriesOfSlot` 的语义是「每个 key 一个 cell」⇒ 注册**只解决"占不占 cell"**，
**不解决"谁被画出来"** —— 后者完全由**外部选择器**（`activePanelId`）决定。

★ 这对 v5 的影响是**结构性的**：**"注册一个不绑会话的 main key"不是方案的地基**，
**"让选择器在无会话时选到它"才是**。
⇒ 退到 `shell.overlay` 之所以被列为 (b) 的下一步，是因为 `shell.overlay` 的语义是**总是渲染**
（官方逐字：「Frame-wide floating layer… Deliberately generic」），**没有选择器那道门**。

## R6. ★★ 注册失败**不裸抛**（一个刻意的设计）

`index.tsx` 的注册处把异常**收进** `noteProbeRegistrationError(message)` 并返回一个空 disposer。

★ **理由**：抛出去会被外层 `catch` 吞掉 ⇒ **"注册失败"与"注册了但没显示"同形** ——
而这两者的补救动作**相反**：(b) 换槽位即可，(c) 换槽位也没用、要改方案。
⇒ 把 (b)/(c) 分开是**这整个实验的第一性要求**（任务书逐字列了三态）。

## R7. 硬验收与净变化

| 项 | 读数 |
|---|---|
| `tsc -p tsconfig.json` | **exit=0** |
| `tsc -p tsconfig.client.json` | **exit=0** |
| `pnpm build` | **exit=0** |
| 新夹具 | **6 pass / 0 fail** |
| 零新依赖 | `package.json` 未改 |

**净新失败 = 0（臂级失败【集合】+ 对照跑）**：改后 **13** vs 对照（`git stash --include-untracked` + 重建）**13**，`diff` **无输出**。
★ 对照跑**先确认建得起来**（`build=0`）才取基线（t91/t93 的功课）。

### R7.1 ★ 三个变异体全部被检出

| # | 突变 | 期望 | 实测 |
|---|---|---|---|
| A | 把 (b) 并进 (c)（`registered-but-hidden` → `registration-failed`） | 三态臂红 | **臂 4 红** ✅ |
| B | `discriminates` 恒为 `true` | 反向半边负向臂红 | **臂 5 红** ✅ |
| C | 接线里的 key 改成 `'wrong/key'` | 接线臂红 | **臂 6 红** ✅ |

⇒ 每次突变后还原并重跑 **6/6 绿**。

## R8. 本节**没有**做的（如实留白）

1. ★ **没有画界面**（硬边界）：探针只吐一个可辨识的字符串标记，**不渲染任何 UI**。
2. ★ **没有跑真实浏览器** —— 判据落在**真实 slots 服务 + 真源码选择器**上，
   但**没有**经过「真浏览器 → AppFrame → MainPanel」那一次真实渲染。
   ⇒ 所以 R1 的结论是**"按官方选择器源码推定的 (b)"**，而"我们的 key 在真浏览器里被选中"**未实测**。
3. **没有改 `src/snapshot.ts` / `src/gates` / `src/evolution` / `src/evaluator`**（不在 inScope）。
4. **没有裁定 v5 的下一步** —— (b) ⇒ 退 `shell.overlay` 是任务书给的映射，**执行与否由队长定**。

---

## R9. ★★★ 队长复核：**t103 的 (b) 结论【过早】** —— 那个面立得起来

> ★ t103 的实测是对的,而它**漏了一个东西**:`main` 的选择器有【公开的写入口】。

### 它测到的（★ 成立）

```
★ MainPanel 逐字：entryKey = usePanelInfo(i => i.activePanelId) ?? "conversation"
★★ 而 activePanelId 初值 null ⇒ 折成 "conversation" ⇒ 我们的 key 注册成功却【不被渲染】
⇒ 它的结论：(b) registered-but-hidden ⇒ 按任务书映射退到 shell.overlay
```

### ★★★ 而队长找到了那个写入口

```js
// node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js
/** Select a global panel or return to the Conversation. */
selectPanel(panelId) {
  if (panelId !== null && !this.hasMainPanel(panelId))
    throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
  …
  this.panels.selectPanel(panelId)
}
```
★ **而它是公开 API（`service.d.ts:64`）:**
```ts
selectPanel(panelId: MainPanelId | null): void
```

### ★★★ 而我们**已经注入了那个服务**

```ts
// src/client/index.tsx:47
export const inject = ['uiConversation','slots','sessions','locale','modelDirectories','layout']
//                                              ★ 而第 84 行已经在用 ctx.layout ↑
```

⇒ ★★★ **所以完整的形状是:**
```
① 注册 main key（★ t103 实测：注册得进去，且真的占了一个 cell）✅
② ★ 调 ctx.layout.selectPanel('agent-teams/folders') ⇒ ★ 它【被选中、被渲染】
⇒ ★★★ 而两步都是公开 API ⇒ ★ 那个面【立得起来】，不必退到 shell.overlay
```

### ★★ 而那解释了 t103 为什么得出 (b)

```
★ 它测的是【默认状态下】会不会显示 —— 而那确实是"不会"
★★ 而它没有找"怎么让它显示" —— ★ 而那是本实验真正要回答的问题
⇒ ★★★ 教训:「默认不显示」与「不能被显示」是【两件事】
   ★ 而本会话那条主轴正是这个形状
```

### ★ 一条仍要如实说的

```
★★ "调 selectPanel 之后真的渲染"—— ★ 那【还没实测】
★ 而它现在是一个【有依据的推断】（选择器读 activePanelId，而 selectPanel 写它）
⇒ ★★★ 所以最小实验 ① 的结论该是:
   【注册 ✅ + 选择器是唯一那道门 ✅ + 写入口存在且已注入 ✅】
   ⇒ ★ 唯一未验的是"调用之后真的渲染"
```

★ **而那正是下一个最小实验该测的。**
