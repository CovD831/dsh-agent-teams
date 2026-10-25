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
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ActivityTeam } from './activity-monitor.ts';
/**
 * 一个身份在某个团队里**实际解析到**的路由。
 *
 * ★ 它是**读数**，不是配置：同一个身份在不同团队里可以有不同的模型
 *   （花名册默认、逐成员覆盖、或继承队长路由 —— 三条路都合法）。
 *   ⇒ 于是这里按 `团队 × 身份` 列出，而不是假装存在一张"每个身份的固定模型"的全局表。
 */
export interface RosterIdentityRoute {
    /** 团队名（读数所属的队）。 */
    readonly team: string;
    /** 身份 / 成员名。 */
    readonly name: string;
    readonly role: string;
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort: string;
}
/**
 * 把团队快照摊成"每个身份在哪个模型上"的读数行。
 *
 * ★ 抽成纯函数（不碰 React）是**故意的**：这样"读数的形状"可以被夹具直接钉住，
 *   而不必去渲染一棵组件树 —— 而渲染夹具测到的往往是"夹具自己搭的 DOM"。
 *
 * ★ 顺序**稳定**（按团队、再按快照给的成员顺序）：一张会自己重排的表
 *   在用户眼里像"它变了"，而其实没有任何东西变。
 */
export declare function rosterIdentityRoutes(teams: readonly ActivityTeam[]): RosterIdentityRoute[];
/**
 * ── ★★★ 这份读数**为什么**是只读的 —— 一句话，而它是可核对的 ─────────────────────
 *
 * ★ 写成常量并被夹具直接断言，是因为"只读"这件事**必须有理由**：
 *   一个没有理由的只读与"我们懒得做"在用户眼里同形。
 * ★ 而理由里给的是**具体的**成因（配置在服务端、没有客户端路由），
 *   不是一句"暂不支持" —— 后者不告诉用户他还能怎么办。
 */
export declare const ROSTER_READONLY_REASON: string;
/** 一个短标签：`provider/model`，只有 model 时就是 model，都没有时是空串。 */
export declare function routeLabel(row: RosterIdentityRoute): string;
export interface RosterSettingsProps extends PropsLocale<'agentTeams'> {
    /** 客户端**真的**收到的团队快照（来自 `/plugins/dsh-agent-teams/state`）。 */
    readonly teams: readonly ActivityTeam[];
}
/**
 * 订阅层的 props：**不要** `teams` —— 它从 store 里取。
 *
 * ★ 它**单独**一个类型（而不是 `RosterSettingsProps & {...}`）是有原因的：
 *   slot 会把注入面**合成**进组件 props，而一个"既有 `teams` 又有 getter"的形状
 *   会让合成出的 props **缺 `teams`** ⇒ 类型当场报错。
 *   ⇒ 两个分层的 props 必须**各自完整**，而它们的公共面就是 `t`。
 */
export interface RosterSettingsSurfaceProps extends PropsLocale<'agentTeams'> {
    /** 共享快照读取器（`useSyncExternalStore` 的 getSnapshot）。 */
    readonly snapshots: () => {
        readonly teams: readonly ActivityTeam[];
        readonly archivedTeams: readonly ActivityTeam[];
    };
    readonly subscribe: (listener: () => void) => () => void;
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
export declare function RosterSettingsSurface({ snapshots, subscribe, t }: RosterSettingsSurfaceProps): import("react").JSX.Element;
/**
 * 花名册与成员模型一览。
 *
 * ★ 它是**只读**的，而且**明说**自己是只读的（含原因）——
 *   见 `ROSTER_READONLY_REASON`。
 * ★ `t` 由宿主按 `PropsLocale<'agentTeams'>` 注入（与其它客户端表面同一口径），
 *   所以本组件不 import 任何"全局翻译函数" —— 那种第二份取词路径会与宿主的分叉。
 */
export declare function RosterSettings({ teams, t }: RosterSettingsProps): import("react").JSX.Element;
