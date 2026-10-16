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
