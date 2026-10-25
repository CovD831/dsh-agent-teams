# 单一入口 + 多项目：DSH 里有什么（2026-10-17）

> **用户**「既然我说最终的改造,可能是类似于把 DSH 改造成像 **OpenAI 的 dot**,
>  或者 **Grok BOT** 之类的那种**单一入口**的形式,那你看看有没有类似的插件或者项目」

---

## 0. ★★★ 结论先说：**机制【已经存在】,而我们已经站在上面**

```
★ `@deepseek-ai/dsh-client-ui-sidebar-right` 提供了一个【公开的标签类型注册表】:
     ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, ... })
  ★ 而第二段把本体挂到槽位上:
     ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, Body)

★★ 而【我们已经在用它】:
     src/client/index.tsx:104   native.sidebarRightTabs.register({ id: TEAM_TAB_ID, kind: TEAM_TAB_KIND })
     src/client/index.tsx:117    slots.register({ name: 'sidebar.right.pane.tab', … })
     src/client/index.tsx:140    另一个 tab（ROSTER_SETTINGS_TAB_ID）
     src/client/WorkspaceActivity.tsx  已经在 sidebar.right.pane.tab 里渲染
⇒ ★★★ 所以"把 AgentTeam 做成单入口里的一个页"这件事【不需要改 DSH】
```

★ **而官方文档逐字说明那是公开路径:**
> 「A tab type registers in two stages, and **the shipped guide type goes through
>  exactly the same public path a type from another package does**
>  （`ui-sidebar-documentpreview` is the live proof）」

⇒ ★★ **即:官方自己的那个 guide 页,用的是【和插件一样】的公开路径。**

---

## 1. ★★★ 而"多项目"的地基也在:官方有 workspace picker

```
@deepseek-ai/dsh-client-ui-workspace
  = "Workspace picker plugin: one WorkspacePicker registered into
     the **sidebar and empty-state workspace slots**"

@deepseek-ai/dsh-client-ui-sidebar
  = "Sidebar plugin: **session multi-level tree, search, grouping, state dots**"
```

⇒ ★★ **所以"一个入口 + 多项目"的两块地基（项目选择器 + 会话树）官方已经有了。**

---

## 2. ★★★ 但那条限制**正对着你的需求**（官方自己写的）

> 「**No surface without a session.** State is keyed by session id,
>  so the **hero screen shows nothing on the right**.」

⇒ ★★★ **即:右侧栏是【会话绑定】的 —— 它的状态按 session id 索引。**

```
★ 你要的:单一入口 ⇒ 看到【好几个项目同时在干活】
★★ 而它现在的形状:会话绑定 ⇒ ★ 没有会话时右边【什么都不显示】
⇒ ★★★ 差别就在这一条:你要的是【会话无关】的聚合面
```

★ **而那正是你早先裁定里那张表说的:**
```
· C 多 Team 并排        ⇒ ❌ 等改造 DSH
· D 单一入口 + 项目切换  ⇒ ❌ 等改造 DSH（那是 DSH 层的事）
⇒ ★★ 而现在我要更正:它们【不一定要等】——
   因为 tab 注册表是公开的,而 workspace picker 已在
```

---

## 3. ★★ 所以"改造 DSH"这句话现在可以拆细

| 层 | 现状 | 要不要改 DSH |
|---|---|---|
| **① 一个标签页承载 AgentTeam** | ✅ **已实现**（我们的 TEAM_TAB_ID）| ❌ 不用 |
| **② 项目选择器** | ✅ 官方有 WorkspacePicker | ❌ 不用 |
| **③ 会话多级树** | ✅ 官方 sidebar 有 | ❌ 不用 |
| **④ ★ 会话无关的聚合面** | ❌ **官方明确没有**（hero screen shows nothing）| ★ **要**（或绕过它）|
| **⑤ 跨项目的 Team 并排** | ❌ 不存在 | ★ **要** |

⇒ ★★★ **所以真正要动的只有 ④⑤ 两格 —— 而它们不是"重写 DSH",**
**而是"提供一个不绑会话的面"。**

---

## 4. ★★ 而绕过 ④ 有两条路（都在插件层）

### 路线 A:★ 用 `shell.overlay`（我们已经注册了一个）—— ★ 而要把两件事分开

```
★ 我们已经在 src/client/index.tsx:169 注册了 shell.overlay
```

★★★ **而队长核实到一个必须分清的区分**（`dsh-client-ui-chat` 的 README 逐字）:

> 「本包注册在 `shell.overlay` 的**全局条目**,**它不随 Chat 面板消失**……
>  ★ 而:**只有本 Client 已绑定并已物化的 Session 会发布**提示;
>  它从未打开的 Session 中的欠费**不会发布**。」

⇒ ★★★ **即【载体】与【数据源】是两件事:**
```
· 载体（shell.overlay）⇒ ★ frame 级,不绑会话  ✅
· 数据源 ⇒ ★ 仍按【已绑定并已物化的 session】
⇒ ★★ 所以 overlay 只是"画在哪",不解决"数据从哪来"
```

★ **而对我们恰好【有利】:** AgentTeams 的队本来就活在**当前工作区**里,
**而"另一个项目在跑"意味着那个项目的 DSH 会话也开着** ⇒ ★ 它**已绑定**。
⇒ ★★ **所以路线 A 的障碍比看起来小** —— 但**要实测确认**那一条（见 §7）。

### 路线 B:★★ 用一个"不绑会话"的 tab 类型

```
★ 官方限制说的是【状态按 session id 索引】
★★ 而 tab 类型的 `kind` 是我们可以自己命名的（我们已有 TEAM_TAB_KIND）
⇒ ★★ 所以一个 kind 不读 session 状态的 tab 是可能的 ——
   ★ 而"可能"要写一个最小实验才能确认（本机没有视觉模型,只能靠代码路径判）
```

---

## 5. ★ 而"像 dot / Grok Bot"那种形态,关键在**什么**

```
★ OpenAI dot / Grok Bot 的共同形态:
   · 一个入口（输入框）
   · ★ 一个【跨会话/跨项目】的活动面（谁在干什么）
   · 对话本身退到一个可切换的位置
⇒ ★★★ 而我们与它的差距【只有一格】:那个活动面必须【不绑单个会话】
```

★ **而官方那条限制逐字说了:它现在【不提供】那个面。**
⇒ ★★ **所以这是我们的机会,而不是一个障碍。**

---

## 6. ★★ 市场里有没有做了这件事的（诚实的答案）

```
★ 查了 141 个插件的索引 + npm 搜索（multi-project / workspace+sidebar / dashboard）
★★ 相关的只有:
   · @deepseek-ai/dsh-client-ui-workspace   ← ★ 官方，项目选择器
   · @deepseek-ai/dsh-client-ui-sidebar     ← ★ 官方，会话树
   · dsh-better-sidebar                     ← 第三方，文件树/编辑器/任务，★ 仍是会话绑定
❌ 没有找到"跨项目的活动面"那一个
```

⇒ ★ **即:市场上暂时【没有】现成的 dot/Grok-Bot 形态 —— 而那些地基是官方铺的。**

---

## 7. ★ 一条我如实说的

```
★ 本文的结论基于【官方包的 README 与类型定义】+ 我们自己的 src/client/index.tsx
★★ 而我没有【跑起来看】—— 本机没有视觉模型,也没有起 web 服务
⇒ ★★ 所以"路线 B 可行"是【从代码路径推的】,不是实测的
★ 若要确认,该做一个最小实验:注册一个不读 session 的 tab,看它在无会话时是否出现
```

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`。*
