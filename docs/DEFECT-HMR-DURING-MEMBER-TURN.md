# 缺陷：宿主 HMR 在成员回合进行中重载插件，会把成员回合打成失败

**记账日期**：2026-10-19 · **发现于**：过夜无人值守运行 · **状态**：已定位，未修（需人拍板落点）

## 现象

成员回合反复以

```
turn/end { reason: { kind: "error",
  error: { message: 'cannot get required service "agents" in inactive context', code: "UNKNOWN" } } }
```

结束，随后 `agent/error` 监听器把该成员名下的任务标为 `failed`，
任务 `output` 逐字就是这句错误。

整晚它吞掉了 **t1（attempt 3）、t2、t5** 三张任务 —— 三张都是"实现根本没开工"
或"实现已完成但回执丢了"，**没有一张是真的实现失败**。

## 根因（两层，第二层才是关键）

### 第一层：cordis 的服务取值器

`node_modules/.pnpm/@deepseek-ai+cordis@4.0.5/.../lib/index.js` 的
`ReflectService.handler.get` 里：

```js
const impl = fiber.store?.[prop]
if (impl) return getTraceable(ctx, impl.value)
if (prop in fiber.inject) {
  error.message = `cannot get required service "${prop}" in inactive context`
  throw error
}
```

`fiber.store` 只在 fiber **active** 时存在。而本插件在**顶层** `inject` 里声明了
`agents`（[src/index.ts:56](src/index.ts#L56)），于是 fiber 不活跃时取值器走到
"我自己就声明了它"这一支 ⇒ **当场抛，不再往上找**。

### ★ 第二层：`*.dsh` profile 开着模块热重载，而它的 `base` 指向本仓

`~/.dsh/profiles/desktop/cordis.patch.yml:530`：

```yaml
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: false
  config:
    base: file:///Users/abab/Desktop/agent-teams-dev
    root: [ "." ]
    debounce: 100
```

⇒ **本仓的 `lib/**` 一被重写，宿主就在 100ms debounce 之后重载插件。**
重载让每一份已存在的 `ctx`/fiber 变成 inactive，而成员回合正拿着它们。

## ★ 可复跑的因果证据（不是相关性，是毫秒级对齐）

`.agent-teams/hmr-reloads.jsonl` 记录每次重载的 `at`。把它与成员的
`turn/end` 错误时刻对齐：

| 成员 | 回合 | 失败时刻 (UTC) | 距最近一次 HMR 重载 |
|---|---|---|---|
| foreman `cb95c8e7` | turn 3 | `20:13:02.200Z` | **538 ms** |
| foreman `cb95c8e7` | turn 6 | `20:56:43.824Z` | **11 ms** |
| foreman-b `0a87d7c8` | turn 1 | `20:13:02.199Z` | **537 ms** |
| foreman-b `0a87d7c8` | turn 4 | `20:46:27.722Z` | **6 ms** |

四次 `inactive context` 失败，**四次**都紧跟在一次重载之后。
同期 foreman 的另外两次 `turn/end` 错误是 `empty_output`（上游返回空），
它们距最近重载 65 s / 91 s —— **与重载无关**，是另一件事。
⇒ 这条因果只在"inactive context"这一个错误上成立，不是把所有失败都归给它。

## 谁触发的

**是队长（我）。** 我在主树跑 `pnpm build` 来刷新
`lib/git-artifact-stamp.json` 与合并后的产物。每一次都等于在成员脚下抽掉地板。

`pnpm build` 也会**写脏** `lib/client.js` 与 `lib/git-artifact-stamp.json`
（client bundle 的 CSS 注释里嵌了 worktree 的**绝对路径**，
产生 242 行纯路径差异）—— 这是同一件事的第二个面。

## 为什么它是产品缺陷而不是我的操作失误

三个理由，任一条都够：

1. **成员没有防御。** 插件在 `ctx.agents.get` 处一抛，成员回合就死，
   而它的任务被记成 `failed`。成员**读不到**"我刚才是被重载打断的"这个事实 ——
   它只看到一句 `cannot get required service`。
2. **失败被记到了错误的账上。** `src/members.ts:492` 的 `agent/error` 监听器
   调 `failMemberOpenAttempt`，把**基础设施重载**写成**任务失败**。
   这与今晚修掉的 `failureKind` 记错代是同一类毛病：一个格子承载两种事实。
3. **诚实重试也会失败。** 我被 `turn/end` 错误误导，reassign 了三次，
   每次都撞在下一轮构建上。没有读数能把二者分开。

## 建议的修法（三条，都有反向半边）

1. **`memberLiveness` / 投递路径上的 `agents.get` 在重载窗口内返回 `undefined`
   而不是抛** —— 但**只对这一种错误降级**，其余异常照旧往上抛。
   （`src/events.ts` 的 `liveAgentOf` 正是这个形状，已有实现可复用。）
   ★ 反向半边：让它在别的异常上也吞 ⇒ 臂红。
2. **成员回合失败时，插件先问一句"是不是刚重载过"** ——
   读 `hmr-reloads.jsonl` 的最后一条 `at`，若在一次回合的时间窗内，
   把该次失败标成 `infrastructure` 而不是 `failed`，并**不**触发
   `failMemberOpenAttempt`。这条与今晚修的 `failureKind` 同源。
3. **`pnpm build` 在成员活跃时应当拒绝执行**，或至少打一条醒目的
   "这会重载插件并打断 N 个正在跑的成员"。今天的读数：一次构建 = 4 次回合失败。

## 人需要拍板的部分

按 `docs/OVERNIGHT-MANDATE.md` 的 R4，以下**只出读数不接线**：

- 第 1 条会改变错误传播面（现在抛、改后吞）—— 是否可接受。
- 第 2 条会新增一个 `failureKind` 枚举值 —— 那是数据模型变更。
- 第 3 条会改 `pnpm build` 的行为 —— 构建脚本归仓库维护者。

**今晚的绕行**：队长在主树**不再跑 `pnpm build`**，所有构建在成员各自的
隔离树里做；队长只在全部任务收口后做一次构建。这条绕行不影响交付正确性，
只影响"我什么时候能看到合并后的产物生效"。
