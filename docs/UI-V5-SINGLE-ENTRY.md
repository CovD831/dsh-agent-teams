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

---

# R9 · 最小实验①b：调 `selectPanel` 之后，那个 main key **真的被渲染**（t105）

> 基线：HEAD `6977a97`（`git merge-base --is-ancestor 71790be HEAD` ⇒ **成功**）。
> 探针：`src/client/folders-probe.tsx`；接线：`src/client/index.tsx`；夹具：`scripts/gate-main-key-probe.test.mjs`（**12 臂**）。

## R9.1 ★★★ 结论：**通了** —— 调 `selectPanel` 之后我们的 key 真的被选中并渲染

t103 停在「注册成功但**默认不被选中**」。t105 补上**最后一跳**，实测 **✅ 成立**。

**真链条（每一环都从官方源码逐字核实，不是推断）：**

| 步 | 官方出处 | 逐字 |
|---|---|---|
| ① | `layout/lib/client.js:462` | `selectPanel(panelId) { if (panelId !== null && !this.hasMainPanel(panelId)) throw …; this.panels.selectPanel(panelId) }` |
| ② | `layout/lib/client.js:401` | `selectPanel: (d, panelId) => { d.panelInfo.activePanelId = panelId }` |
| ③ | `layout/lib/client.js:118` | `entryKey = usePanelInfo((info) => info.activePanelId) ?? "conversation"` |
| ④ | `renderer/lib/client.js:1154` | `entriesOfSlot(slotKey).find((e) => e.options.key === opts?.entryKey)` |

⇒ ★★ **`selectPanel(我们的 key)` ⇒ `activePanelId` 被写上 ⇒ `entryKey` 解析成我们的 key ⇒ keyed 槽把它选出来渲染。**

**实测读数**（真 `SlotCore` + 真动作/守卫 + 产品代码的 `resolveEntryKey`）：
```
不调          ⇒ activePanelId = null          ⇒ rendered = "conversation"
调了(我们的)  ⇒ activePanelId = "agent-teams/folders" ⇒ rendered = "agent-teams/folders"  ★
调未注册的    ⇒ 抛 layout.selectPanel: main panel "no/such/panel" is not registered
```

★ **所以 R1 的 (b) 结论**（"要退到 `shell.overlay`"）**需要重新评估**：
`main` 的路是**通的**，只是**必须先选择**。⇒ 两条路都可行，取舍交给队长/用户。

## R9.2 ★★ 两条反向半边（方向不同，都成立）

| 半边 | 要求 | 实测 |
|---|---|---|
| **A** | ★ **不调** ⇒ 渲染计数必须是 0 | ✅ 不调 ⇒ `rendered === "conversation"`，**不是我们**。★ 这条其实在守「**我的接线没有意外改掉那个默认**」—— t103 实测的默认是 `conversation`，它必须**仍然成立** |
| **B** | ★ 传**未注册**的 id ⇒ 必须抛 | ✅ 抛，且报文**逐字等于**官方那条（`client.js:463`） |

★ **B 为什么特别重要**：它证明**我们调的是真那个函数**。光看"渲染了"无法区分
"我们选中的"与"某个'什么都渲染'的实现"—— **守卫的报文**能区分。

## R9.3 ★ 三态不同形（各自可达）

```
注册了 + 选了   ⇒ renders   （★ 最后一跳通了）
注册了 + 没选   ⇒ hidden    （t103 实测的那个默认）
未注册 + 选了   ⇒ throws    （selectPanel 自己的守卫）
```
★ 三者的**结论完全不同**，尤其 (b)/(c)：`hidden` 是"我们没事，只是没被选"（**补救：把选择做出来**）；
`throws` 是"你给了一个不存在的 panel"（**补救：先注册**）。

## R9.4 ★ 一处类型层的处置：`MainPanelId` 是**品牌类型**

编译期实测：`selectPanel` 收的是 `MainPanelId`（`= string & { readonly [BRAND]: 'MainPanelId' }`），
**裸 `string` 会被拒**（`Argument of type 'string' is not assignable to MainPanelId`）。

★ 官方构造器是 `brandString<T>()`（`@deepseek-ai/dsh-brand`），但实测**从本包 `require.resolve` 解析失败**
（它不是本插件的依赖）⇒ 而本任务**零新依赖** ⇒ **不引它**。
⇒ 改用**类型层**断言补品牌（**运行期零成本**，品牌只存在于类型里）：
```ts
const probePanelId = FOLDERS_MAIN_KEY as unknown as MainPanelId
```
★ 这不弱化安全性：品牌在这里的唯一作用是挡住"随手传一个错 id"，
而这个 id 与 `slots.register` 用的是**同一个常量** ⇒ **不可能漂移**。

## R9.5 ★★★ 我自己的两条测试缺陷（**由突变测试查出，不是靠推想**）

第一版 12 臂**全绿**，但突变测试抓出**两条臂是假的**：

| 突变 | 第一版 | 为什么漏掉 | 修法 | 修后 |
|---|---|---|---|---|
| **M1** 把 `ctx.layout.selectPanel(...)` **整行删掉** | **pass 12 / fail 0** ★漏 | 臂 11 的正则 `/ctx\.layout\.selectPanel\(/` **在注释里也命中**（本文件的 doc 注释逐字写着那行）⇒ **代码删了它照样绿** | **先剥注释**（块注释 + 行注释）再匹配 | **臂 11 红** ✅ |
| **M3** 改掉守卫的报文 | **pass 12 / fail 0** ★漏 | 臂 9 拿 `unregisteredPanelMessage(bogus)` 当**期望值**，而 harness **自己就调那个函数**拼报文 ⇒ **两边一起变，恒真** | 期望值改为**官方逐字写死的字符串**（独立于被测函数） | **臂 9 红** ✅ |

★★ **这两条是本轮最有价值的产出**，因为它们**都是"绿色的假判据"**：
- M1 的形态是「**检查到了注释**」——"检查了"与"检查了但匹配的是注释"**同形**；
- M3 的形态是「**期望值与被测物同源**」——自证式断言，**改坏了也不会红**。

★ 而这与本仓记过的 **t82/M6 形状**是同一族：**只测一层会漏**。
⇒ 修完重跑：**M1 ✓ M2 ✓ M3 ✓ M4 ✓ 全部被检出**，还原后 **12/12 绿**。

★ 另记一条**勘误**：我第一轮做 M3/M5 时 `fail=0`，一度以为"漏检" —— 查下来是**我的替换没落在真代码上**
（M3 的 pattern 先命中了**注释**；M5 的守卫**根本在夹具里、不在产品源码里**）⇒ **那两次是无效突变，不是漏检**。
★ 教训：**"突变后没红"必须先确认"突变真的发生了"**，否则会把"没改到"读成"判据无效"。

## R9.6 硬验收与净变化

| 项 | 读数 |
|---|---|
| `tsc -p tsconfig.json` | **exit=0** |
| `tsc -p tsconfig.client.json` | **exit=0** |
| `pnpm build` | **exit=0** |
| 夹具 | **12 pass / 0 fail** |
| 零新依赖 | `package.json` **未改** |

**净新失败 = 0（臂级失败【集合】+ 对照跑）**：改后 **13** vs 对照（`git stash --include-untracked` + 重建，`build=0`）**13**，`diff` **无输出**。

## R9.7 本节**没有**做的（如实留白）

1. ★ **没有画界面**：探针仍只吐一个可辨识字符串标记。
2. ★★ **没有跑真实浏览器** —— 判据落在**真 `SlotCore` + 官方动作/守卫逐字复刻 + 产品代码的选择规则**上，
   但**没有**经过「真浏览器 → React → AppFrame → MainPanel」那一次真实渲染。
   ⇒ ★ 所以 R9.1 的结论是**"按官方链条推定的 ✅"**，而"我们的 key 在真浏览器里被画出来"**仍未实测**。
3. **没有裁定 v5 走 `main` 还是 `shell.overlay`** —— 两条都可行（R9.1 末），**取舍由队长/用户定**。
4. **没有改 `src/snapshot.ts` / `src/gates` / `src/evolution` / `src/evaluator`**（不在 inScope）。

---

# 实施记录：第一层（文件夹 = 工作区，t111）

**基线**：HEAD = `78d2fc7`（`git merge-base --is-ancestor 71790be HEAD` ✅）。
开工 stamp = `67b28c7` ≠ HEAD ⇒ **先 `pnpm build` 取新鲜基线**。
**写域**：`src/client/index.tsx` · 新建 `folders-panel.tsx` + `.module.css` · 新建 `scripts/gate-folders-panel.test.mjs` + 产物。
★ 实测改动 **10 条路径，逐条在 inScope 内**。**零新依赖**。**`MemberRow` / `ActivityPanel` 一行未改**（`git status` 对拍）。

## 0. 验收读数

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | **exit=0** |
| `npx tsc -p tsconfig.client.json --noEmit` | **exit=0** |
| `pnpm build` | **exit=0**（`lib/client.js` 415.83 kB；stamp == HEAD） |
| `scripts/gate-main-key-probe.test.mjs`（t103/t105 的地基） | **12/12 仍绿** |
| `scripts/gate-folders-panel.test.mjs`（本层新增） | **11/11 绿** |
| `pnpm test:gates` 失败**文件集合** | 基线 16 == 改后 16，`diff` 无输出 ⇒ **净新 = 0** |
| 变异体 | **6/6 被检出** |

★ 基线取法：开工 `pnpm build` 取新鲜基线 ⇒ `1576 / 1515 / 23 / 16 文件`；改后 `1587 / 1526 / 23 / 16`（新增 11 条本层判据，通过数同步 +11）。

## 1. ★★★ 地基是**已验的**，本轮没有重新论证

t103/t105 已经用同一个 key 验过三件事，而那三条**仍在** `gate-main-key-probe.test.mjs` 里跑、**仍然绿**：

| 臂 | 验的是什么 | 本轮 |
|---|---|---|
| 臂 7 | 调 `selectPanel(我们的 key)` ⇒ **真的被选中并渲染** | ✅ 仍绿 |
| 臂 8 | **反向半边 A**：不调 `selectPanel` ⇒ 渲染的**不是**我们 | ✅ 仍绿 |
| 臂 9 | **反向半边 B**：传未注册 panelId ⇒ **必须抛**，报文是官方那条 | ✅ 仍绿 |

★ **反向半边 B 的权威性来自官方源码本身**（不是我的断言凑出来的）：
```js
// dsh-client-ui-layout/lib/client.js:463
if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
```
官方 `.d.ts` 逐字：`@throws if the selected main key is not registered; preserves the current selection.`

## 2. 本轮到底改了什么（一句话）

**`FoldersProbe` → `FoldersPanel`**：同一个 `main` key（`agent-teams/folders`）、同一个槽位、
同一个 `inject` 空面 —— **形状一字未改**，只把"只画一个标记"的探针换成**真正的工作区文件夹视图**。

★ 探针模块（`folders-probe.tsx`）**仍在**：它承载 key 常量与三个可读格子
（渲染计数 / 注册错误 / 选择结果），那三格是三条反向半边的落点 ⇒ **判据载体一个都没动**。

## 3. 内容：工作区列表（`foldersFromSnapshots`，纯函数）

聚合键是 `team.workspace`（`ActivityTeam` 上**已有**的字段）⇒ **不加数据通道**。

| 判据 | 读数 |
|---|---|
| 一个 workspace 一个文件夹（不是一队一个） | 3 个队 / 2 个工作区 ⇒ **2 个文件夹** |
| **归档队仍算一个工作区** | 只剩归档队的工作区仍在列表里，`liveCount = 0` |
| 顺序**跨轮询稳定** | 按首次出现序（`Map` 插入序），**不是字母序** |
| 空 workspace 名**照收** | `''` 仍是一个文件夹（丢掉 = 静默少一个） |

★ 为什么归档队要算：**"这里曾经有工作区"与"从来没有"必须不同形** —— 从列表消失会让两者同形。

## 4. 像素风（零依赖、零位图）

| 做法 | 落点 |
|---|---|
| 内联 SVG 的 **`<rect>` 拼文件夹** | `folders-panel.tsx` 的 `FolderGlyph` |
| `shapeRendering="crispEdges"` | 缩放**不插值**（像素风的观感） |
| `border-radius: 0` | 圆角是平滑世界的东西 |
| `box-shadow: 3px 3px 0 0` | **硬阴影**：整像素偏移 + **0 blur** |
| 颜色只来自 `var(--dsw-alias-*)` | 不引第二套调色板（本仓纪律） |
| ❌ 不用 `<img>` / 不 import 任何 `.png|.svg` / 不引外链 | 位图 = 体积 + 版权 |

## 5. ★★ 反向半边 C：空态与"读不到"不同形

```
foldersView([], [])              ⇒ { state: 'loaded', folders: [] }   ← 读到了、确实没有
foldersView(undefined, undefined) ⇒ { state: 'empty' }                 ← 没发布过快照
```
★ 而面板**两种都渲染**：`data-folders-state` 标态、`data-folders-empty="true"` 标空态，
空态有**一句话**（「还没有工作区。…」）。
★★ **白屏与"读不到"同形** —— 而两者的补救动作相反（去建一个 vs 去看 `/state` 为什么没回来）。

## 6. ★★★ 变异体 6/6（含一处本轮自抓的假绿）

| 变异体 | 被检出 |
|---|---|
| M1 不聚合（一个队一个文件夹） | ✅ FAIL=8 |
| M2 丢掉归档队（"曾经有" = "从来没有"） | ✅ FAIL=2 |
| M3 空态退回白屏 | ✅ FAIL=2 |
| M4 改用 `<img>` 位图 sprite | ✅ FAIL=2 |
| M5 引一个外部包（`clsx`） | ✅ FAIL=2 |
| **M6 面板不再喂渲染计数** | ✅ FAIL=2（**补判据后**） |

### ★★★ M6：判据的**载体本身**也要被钉住
M6（把 `noteProbeRender(FOLDERS_MAIN_KEY)` 变成 `void noteProbeRender`）第一版让我 10 条断言**全绿**。

★ 为什么那是一条**必须**被挡住的变异体：**反向半边 A** 判的是
`probeRenderCount(FOLDERS_MAIN_KEY) === 0`"不调 selectPanel 就不渲染"。
⇒ 若面板不喂那个格子，它就退化成**"一个从来没人写过的格子永远是 0"** —— **恒真**，证明不了任何事。

⇒ 补了臂 9b：断言面板**import 并真的调用**了 `noteProbeRender(FOLDERS_MAIN_KEY)`。
★★ 这是本会话反复记下的同一形态：**判据的载体必须自己也有一条判据。**

### ★ 另一处：把注释算进了计数（与 t80 同一种错）
臂 9 第一版用 `src.includes('FoldersProbe')` 断言"探针组件不再被渲染"，
而 `index.tsx` 的**注释**里逐字写着"探针换成真的面板" ⇒ **假红**。
⇒ 改成只在**代码行**里查。

## 7. 尚未验证的部分（如实报出）

★ **我没有验证过真实浏览器渲染**（本机 `launchChrome()` 不 resolve，干净树同样 —— 与前几轮一致）。
⇒ "像素风**看起来**对不对"**没有验证**；本轮能保证的是**可编程的那几条**：
内联 SVG 的几个 `<rect>` · `crispEdges` · 无圆角 · 硬阴影 · 只用语义色 · 空态有可辨识标记。

★ **下一层（点进工作区 → 该工作区的团队）本轮没做** —— 规格 §3 的 ②③ 步。
本层只负责"文件夹"，且**没有拦截点击**（点中文件夹目前不会进入下一层）。

## 8. 改动清单

```
src/client/index.tsx                 FoldersProbe → FoldersPanel（形状不变，只换组件）
src/client/folders-panel.tsx         + 新增：foldersFromSnapshots / foldersView / FoldersPanel / FolderGlyph
src/client/folders-panel.module.css  + 新增：像素风样式（无圆角 / 硬阴影 / 语义色）
scripts/gate-folders-panel.test.mjs  + 新增：11 条本层判据（含反向半边 C 与载体臂）
lib/**（对应产物）+ lib/git-artifact-stamp.json
docs/UI-V5-SINGLE-ENTRY.md           本节
```

**未动**：`MemberRow.tsx` · `ActivityPanel.tsx`（W 线那一层）· `src/snapshot.ts` · `src/gates/**` ·
`src/tools/**` · `folders-probe.tsx` · `gate-main-key-probe.test.mjs`。
★ **零新依赖**（`package.json` / `pnpm-lock.yaml` 未改）。

# 实施记录：修可用缺陷 —— 常驻回入口 + 文件夹页可出去（t112）

**基线**：HEAD = `885f4b1`（71790be 是祖先 ✅）。开工 stamp = `78d2fc7` ≠ HEAD ⇒ 先 `pnpm build` 取新鲜基线。
**写域**：`index.tsx` · `folders-panel.tsx` · 新建 `folders-return-entry.tsx` · `folders-panel.module.css` ·
新建 `scripts/gate-folders-navigation.test.mjs` + 产物。**`TeamChatEntry.tsx` 一行未改**（`git status` 为空）。

## 0. 验收读数

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` / `--client` | **exit=0 / exit=0** |
| `pnpm build` | **exit=0**（`lib/client.js` 426.69 kB；stamp == HEAD） |
| `gate-folders-navigation.test.mjs`（本轮新增） | **10/10 绿** |
| `gate-folders-panel.test.mjs`（t111 的） | **11/11 绿**（未放宽） |
| `pnpm test:gates` 失败**文件集合** | 基线 16 == 改后 16，`diff` 无输出 ⇒ **净新 = 0** |
| 变异体 | **6/6 被检出**（3 条在 typecheck 层） |

★ 基线取法：开工 `pnpm build` ⇒ `1587/1526/23/16`；改后 `1597/1536/23/16`（**+10 通过 = 新增判据**，失败数不变）。

## 1. 修的是什么

用户原话：「我刚才从那个大的界面点击侧面的 session 到了目前的界面,但是现在**回不去那个大的界面**了」。

**根因**（`index.tsx`）：`selectPanel(FOLDERS_MAIN_KEY)` 在**启动期只调一次** ⇒
进了会话后 `activePanelId` 变成 `conversation`，**没有任何东西能把它切回来**。
而 `TeamChatEntry` 在非团队会话里 `if (!team) return null` ⇒ 顶不上这个缺。

### ① 常驻回入口（`shell.overlay`）

官方 SlotMap 逐字（`lib/types/client/index.d.ts:85`）：
```
'shell.overlay': { kind: 'list'; scope: 'root' }
```
· `kind: 'list'` ⇒ **换一个新 id 加在既有条目旁边**（实测：`agent-teams-activity` 仍在）；
· `scope: 'root'` ⇒ **不绑会话** ⇒ 任何界面都在，**包括不是团队的会话**。

★ 新增 `folders-return-entry.tsx`：**不接任何会话 prop**（臂 2 逐字断言 props 里没有 `sessionId`/`team`）。
★★ `pointer-events: auto` 是**承重**的：浮层缺省 click-through —— 不开这一行就"看得见、点不着"，而那与"没有这个入口"同形（臂 9）。

### ② 文件夹页能出去（反向半边 B）

文件夹从静态 `<li>` 变成 **`<button>`**（键盘可达）⇒ 点击走 `openConversation()`
⇒ 生产实现是 **`selectPanel(null)`**（官方：`null` ⇒ 回到 Conversation）。

## 2. 三条反向半边

| | 判据 | 结果 |
|---|---|---|
| **A** | 回入口的 props 里**没有会话**；`TeamChatEntry` 仍 `return null` | ✅ 臂 2 + 臂 3 |
| **B** | 从文件夹点出去 ⇒ 记到 `selectPanel(null)` | ✅ 臂 5 + 臂 8 |
| **C** | **两次往返**：序列必须是 `[folder, null, folder, null]` | ✅ 臂 6 |

★★ **C 的关键**：`A→B→A` 与 `A→A` 的**计数**可能相同 ⇒ 账本存的是**序列**，并显式断言
"进文件夹 2 次、出到会话 2 次" —— 单向可用（`[folder, null]`）与**死路**（`[folder, folder]`）都会红。

### ★ 一个刻意的不对称：`unknown` 也显示
读不到 `activePanelId` 时入口**仍然显示**（`returnEntryState(undefined) === 'unknown'`）。
理由：它是**唯一能回去的路**；藏起它会把一次读数缺失变成一次**不可用**，而那与"功能没做"同形。

## 3. 变异体 6/6

| 变异体 | 被检出 |
|---|---|
| M1 回入口绑会话（加 `sessionId` prop） | ✅ **typecheck** |
| M2 `unknown ⇒ hidden`（藏起唯一的路） | ✅ 臂 4 FAIL=2 |
| M3 只进不出（B 缺失） | ✅ 臂 5/8 FAIL=2 |
| M4 浮层不开 `pointer-events` | ✅ 臂 9 FAIL=2 |
| M5 注入面改名（`selectPanel` 缺失） | ✅ **typecheck** |
| M6 注册时注入 `sessionId` | ✅ **typecheck** |

★ **3/6 在 typecheck 层就被挡住** —— 那是比夹具断言更强的检出（编译期 vs 运行期）。

## 4. ★★ 我踩到的一处真回归，以及为什么**没有**去放宽它

第一次跑全量 gates：**净新失败 1 个** —— `scripts/gate-folders-panel.test.mjs`（**t111 的**）红了。
根因：我在 `folders-panel.tsx` 里加了两个 import（`./folders-return-entry.tsx`、
`@deepseek-ai/dsh-client-ui-layout/client`），而那个夹具的**臂 8 是 import 白名单**。

★★ **而那个夹具不在本轮写域**（本轮只给了 `gate-folders-navigation.test.mjs`）⇒
**我不能去放宽它**，也不该为了让它绿而扩白名单。
⇒ 改法是**让改动不越界**：把"记账"从面板里挪到**注入处**（`index.tsx` 的 `openConversation`），
`folders-panel.tsx` 的 import 面**恢复成 t111 那一份**（实测 4 条，逐字相同）。

★ 结果：t111 的 11/11 与 t112 的 10/10 **同时绿**，且**一个字都没改别人的夹具**。

## 5. 尚未验证的部分（如实报出）

★ **没有真实浏览器验证**（本机 `launchChrome()` 不 resolve，干净树同样）。
⇒ 回入口**在屏幕上长什么样、位置会不会挡住别的东西**，**没有验证**。
本轮能保证的是**可编程的那几条**：`shell.overlay` 的真 spec · 入口的 props 里没有会话 ·
三态纯函数 · `selectPanel` 的**调用序列** · `pointer-events: auto` 在 CSS 里 · 注入面的键名。

★ 另：`order: 78` 让回入口排在活动面板（`order: 80`）之前 —— **浮层里条目自排**这一点是官方措辞，
而"78 与 80 在像素上谁先谁后"**需要浏览器确认**（本轮只断言它们不同）。

## 6. 改动清单

```
src/client/index.tsx                  + shell.overlay 上注册 agent-teams-folders-return；面板注入 openConversation
src/client/folders-return-entry.tsx   + 新增：调用账本 · returnEntryState 三态 · FoldersReturnEntry
src/client/folders-panel.tsx          文件夹 <li> → <button>，点击走出到 conversation（import 面不变）
src/client/folders-panel.module.css   + 回入口样式（含承重的 pointer-events: auto）
scripts/gate-folders-navigation.test.mjs + 新增 10 条判据（A/B/C + 地基 + 接线 + 零依赖）
lib/**（产物）+ lib/git-artifact-stamp.json
docs/UI-V5-SINGLE-ENTRY.md            本节
```

**未动**：`TeamChatEntry.tsx`（硬边界②，`git status` 为空）· `folders-probe.tsx` · `MemberRow` / `ActivityPanel` ·
`scripts/gate-folders-panel.test.mjs` · `src/snapshot.ts` · `src/tools` · `src/gates`。
★ **零新依赖**（`package.json` / `pnpm-lock.yaml` 未改）。
