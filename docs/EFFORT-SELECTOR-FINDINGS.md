# Effort 选择器：根因与修法（2026-10-16）

> **用户诉求**：
> 「目前我在选择**非官方模型**的时候，**无法在前端选择 effort**。
>  1. 能在前端选择 effort。可能已经有插件可以做到了，你可以搜一下市场上的 DSH 插件。
>  2. 让选择 effort 的部分带有 **Codex 的动画效果**。」

---

## 0. ★★★ 根因：**不是代码问题,是配置缺一个字段**

**实测（队长从 `app.asar` 取回官方实现）**:

```js
function resolveModelReasoning(provider, entry, base) {
  const efforts = entry.reasoningEfforts
  if (efforts === void 0) return { reasoning: base?.reasoning ?? false }   // ★ 你的情况走这里
  if (efforts === false) return { reasoning: false }
  ...
```

**官方文档逐字**:
> 「`reasoningEfforts` **declares a model's selectable thinking levels**:
>  **each key is a level selectors offer**, its value the spelling dispatch sends on the wire,
>  so `max: ultra` renames a level for a gateway with its own vocabulary.
>  **Omitting the field keeps the installed catalog entry's capability**;
>  `false` declares a non-reasoning model.」

⇒ ★★ **前端的选择器 = 模型声明里 `reasoningEfforts` 的键列表。**
**声明里没有这个字段 ⇒ 选择器没有可选项 ⇒ 「无法选择 effort」。**

### 你的 `wb` provider 缺的正是它

`~/.dsh/profiles/desktop/cordis.patch.yml:35-47`:
```yaml
    providers:
      wb:
        apiKeyEnv: WB_API_KEY
        api: openai-responses
        baseURL: https://workbuddy2api.henryai.top/v1
        models:
          - inputModalities: [text]
            id: hy4-preview
            name: hy4-preview
            contextWindow: 1000000
            maxTokens: 64000
            # ★ 这里缺 reasoningEfforts
```

---

## 1. ★ 可选的等级（官方定义的 7 个）

```js
THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
```

★ **顺序即优先级**（`off` 最低 → `max` 最高）—— 那是 UI 滑块的**天然顺序**。

### 官方样例语法

```yaml
reasoningEfforts:
  off:
  high: high
```

★★ **两条硬规则（官方在解析时校验）**:
```
① 键必须在 THINKING_LEVELS 里 —— 否则 invalid
② 值 null 只允许 off；其余等级【必须】给值（那是发给网关的拼写）
③ 空对象 {} ⇒ invalid（"declare the offered levels, set false for a non-reasoning model,
   or omit the field"）
```

★ 即:**不能写 `reasoningEfforts: {}`** —— 要写就得给至少一个真等级。

---

## 2. ★★ 而第二条诉求（Codex 动画）需要**查证**

**用户**:「让选择 effort 的部分带有 **Codex 的动画效果**。
 或许插件市场也有，你可以去搜一下 DSH 的插件。」

★ **队长如实报告**:
| 查证方式 | 结果 |
|---|---|
| `web_search` | ❌ ★ **坏的**（HTTP 401,API key 无效）|
| GitHub 搜索（走代理） | ⚠️ 返回的是导航壳,没有实质结果 |
| `app.asar` 里的实现 | ✅ **拿到了**（见上）|

⇒ ★★ **所以"Codex 的动画效果具体长什么样"我【没有取到】** ——
我不能凭印象描述一个我没见过的动画。**需要用户提供截图或描述。**

---

## 3. ★ 修法（两步,第 1 步立刻可做）

### 第 1 步：给 `wb` 的模型加 `reasoningEfforts`（**改配置,不改代码**）

★ **但有一个前提必须先确认**:`wb` 网关（`workbuddy2api.henryai.top`）
**支不支持把 thinking level 传上去**。

★ **判据**:若网关不认那个拼写,前端选了也会**静默无效** ——
而**「选了但没生效」与「引擎不支持」在界面上同形**。

⇒ **建议先给一个模型加上试**（例如 `deepseek-v4.1-flash`）,实测它是否真的改变了行为。

### 第 2 步：动画效果

★ **依赖用户提供 Codex 的动画样子**（见 §2）。

---

## 4. ★ 与"搜市场上的 DSH 插件"的关系

**用户问**：「可能已经有插件可以做到了，你可以搜一下市场上的 DSH 插件。」

★ **队长如实答**:
- **`web_search` 坏的** ⇒ 我**没法搜**
- 但★ **从 `app.asar` 的官方实现看,这件事【不需要插件】** ——
  **它是宿主内建的能力,只是你的 provider 声明里缺了那个字段。**

⇒ ★★ **所以"找个插件"这条路可以省掉** —— **改两行 YAML 就行。**

---

## 5. 待办

| # | 事项 | 依赖 |
|---|---|---|
| **1** | 确认 `wb` 网关是否支持 thinking level 传递 | ★ **需实测**（或问 provider 方）|
| **2** | 给一个模型加 `reasoningEfforts` 并实测 | 依赖 1 |
| **3** | 拿 Codex 动画的样子 | ★ **需用户提供** |

---

*本文只写 `docs/`。未改动 `src/`、`scripts/`、`lib/`,也未改用户的 `~/.dsh/` 配置。*
