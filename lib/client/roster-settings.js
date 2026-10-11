import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ── AgentTeams 花名册 / 成员模型一览（t20）──────────────────────────────────────
 *
 * ── 这个表面存在的理由 ────────────────────────────────────────────────────────
 *
 * 用户要的是"**在 GUI 里看得见**花名册与每个身份用的模型，而不必手改 profile YAML"。
 * ★ 而本任务**实测**过两件事，它们共同决定了这个表面的形状：
 *
 *   ① 那个被借来的 settings 分区槽位在**本依赖树里根本不存在**
 *      （在 node_modules/@deepseek-ai/ 下 grep 该名零命中；
 *       `SlotMap` 按设计声明为空；`@linxin666` 也不在 store 里）。
 *      ⇒ 挂在一个不存在的 slot 上的表面**永远不会被渲染** ——
 *        而那与"没做这个功能"在用户眼里完全同形。
 *   ② 花名册（`config.profiles`，`src/index.ts`）住在**服务端配置**里，
 *      而客户端没有任何写路由、也没有读路由 ⇒ 它**不可编辑**。
 *
 * ⇒ 于是本组件只做**两件都说实话**的事：
 *
 *   · **可读的那一份照实显示**：每个团队、每个身份**实际解析到**的 provider/model/
 *     reasoning effort（这些来自 `/plugins/dsh-agent-teams/state` 的快照，
 *     客户端**真的收得到**）。
 *   · **不可读的那一份明说不可读**，并**给出原因**（配置在服务端插件配置里，
 *     客户端既没有读路由也没有写路由）。
 *
 * ── ★★★ 它绝不做的那一件事（原始契约第三格逐字禁止）──────────────────────────
 *
 * **不渲染任何"看起来能改、点了却什么也不发生"的控件。**
 * ★ 一个失效的输入框比"没有输入框"**更坏**：用户会以为自己改了，
 *   而配置没变 —— 那是一次**静默失败**，而它读起来像一次成功。
 * ⇒ 所以只读这件事必须**说出口**，而不是靠"没给控件"让用户自己猜。
 *
 * ── ★ 三态（本队纪律的同一次应用）──────────────────────────────────────────────
 *
 *   · 读到了团队快照   ⇒ 照实列出每个身份的模型
 *   · 还是空（没团队） ⇒ 说"还没有团队"，**不**假装"没有配置"
 *   · `readonlyReason` ⇒ 明说为什么这一份不可改
 *
 * ★ 而"这个身份没有解析出模型"与"读不到"同样必须不同形：
 *   前者是一个**具体的**读数（该成员没有 provider/model），后者是"没测到"。
 */
import { useSyncExternalStore } from 'react';
import css from './roster-settings.module.css';
/**
 * 把团队快照摊成"每个身份在哪个模型上"的读数行。
 *
 * ★ 抽成纯函数（不碰 React）是**故意的**：这样"读数的形状"可以被夹具直接钉住，
 *   而不必去渲染一棵组件树 —— 而渲染夹具测到的往往是"夹具自己搭的 DOM"。
 *
 * ★ 顺序**稳定**（按团队、再按快照给的成员顺序）：一张会自己重排的表
 *   在用户眼里像"它变了"，而其实没有任何东西变。
 */
export function rosterIdentityRoutes(teams) {
    const rows = [];
    for (const team of teams) {
        for (const member of team.members) {
            /**
             * ★ `removed` 的成员**不进这张表**：他们已经不在花名册上了，
             *   列出来会让"当前有哪些身份"这句话失真。
             */
            if (member.status === 'removed')
                continue;
            rows.push({
                team: team.name,
                name: member.name,
                role: member.role,
                provider: member.provider?.trim() ?? '',
                model: member.model?.trim() ?? '',
                reasoningEffort: member.reasoningEffort?.trim() ?? '',
            });
        }
    }
    return rows;
}
/**
 * ── ★★★ 这份读数**为什么**是只读的 —— 一句话，而它是可核对的 ─────────────────────
 *
 * ★ 写成常量并被夹具直接断言，是因为"只读"这件事**必须有理由**：
 *   一个没有理由的只读与"我们懒得做"在用户眼里同形。
 * ★ 而理由里给的是**具体的**成因（配置在服务端、没有客户端路由），
 *   不是一句"暂不支持" —— 后者不告诉用户他还能怎么办。
 */
export const ROSTER_READONLY_REASON = 'Roster profiles live in the server-side plugin config (src/index.ts), and this client has neither a read nor a write route for them. '
    + 'Closing that needs a server route first, so this view reports what each identity actually resolved to instead of offering an edit that would not apply.';
/** 一个短标签：`provider/model`，只有 model 时就是 model，都没有时是空串。 */
export function routeLabel(row) {
    if (row.provider !== '' && row.model !== '')
        return `${row.provider}/${row.model}`;
    return row.model;
}
/**
 * ── ★★★ 订阅那一层与**展示**那一层分开（而这不是为了好看）──────────────────────
 *
 * ★ 分开的理由是**可测性**：`RosterSettings` 是一个纯函数组件 —— 给它一组 teams，
 *   它给出确定的读数。于是夹具可以直接钉住"读数的形状"，
 *   而不必渲染一棵组件树（渲染夹具测到的常常是**夹具自己搭的 DOM**）。
 *
 * ★★ 而这一层（`RosterSettingsSurface`）只做一件窄事：**订阅共享状态、把 teams 递下去**。
 *   它里面**没有**任何"决定显示什么"的逻辑 —— 那种逻辑放这里就没法不渲染地测了。
 */
export function RosterSettingsSurface({ snapshots, subscribe, t }) {
    const store = useSyncExternalStore(subscribe, snapshots);
    /**
     * ★ 现役团队与归档团队**都**列出来：一份"这些身份用什么模型"的读数在
     *   历史团队上同样有信息量（"上个队当时用的是哪个模型"是可核对的事实）。
     */
    return _jsx(RosterSettings, { teams: [...store.teams, ...store.archivedTeams], t: t });
}
/**
 * 花名册与成员模型一览。
 *
 * ★ 它是**只读**的，而且**明说**自己是只读的（含原因）——
 *   见 `ROSTER_READONLY_REASON`。
 * ★ `t` 由宿主按 `PropsLocale<'agentTeams'>` 注入（与其它客户端表面同一口径），
 *   所以本组件不 import 任何"全局翻译函数" —— 那种第二份取词路径会与宿主的分叉。
 */
export function RosterSettings({ teams, t }) {
    const rows = rosterIdentityRoutes(teams);
    return (_jsxs("section", { className: css.root, "data-agent-teams-roster-settings": true, children: [_jsxs("header", { className: css.head, children: [_jsx("h3", { className: css.title, children: t('roster.title') }), _jsx("span", { className: css.readonlyBadge, "data-roster-writable": "false", children: t('roster.readonly') })] }), _jsx("p", { className: css.reason, "data-roster-readonly-reason": true, children: ROSTER_READONLY_REASON }), rows.length === 0 ? (
            /**
             * ★ 三态：**没有团队** ⇒ 说"还没有团队"。
             *   绝不说成"没有配置" —— 那是另一个事实，而用户会据此去改 YAML。
             */
            _jsx("p", { className: css.empty, "data-roster-empty": true, children: t('roster.empty') })) : (_jsx("ul", { className: css.list, children: rows.map((row) => (_jsxs("li", { className: css.row, "data-roster-identity": row.name, children: [_jsx("span", { className: css.team, children: row.team }), _jsx("span", { className: css.name, children: row.name }), row.role === '' ? null : _jsx("span", { className: css.role, children: row.role }), routeLabel(row) === ''
                            ? _jsx("span", { className: css.unset, children: t('roster.noModel') })
                            : _jsx("span", { className: css.model, children: routeLabel(row) }), row.reasoningEffort === '' ? null : _jsx("span", { className: css.effort, children: row.reasoningEffort })] }, `${row.team}:${row.name}`))) }))] }));
}
