window.__ModuleLoader__.load({
	id: "@nanmicoder/dsh-agent-teams",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/client/icons.js
		/** Plugin-owned icons avoid depending on the host's generated design-export names. */
		const stroke = {
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.5,
			strokeLinecap: "round",
			strokeLinejoin: "round"
		};
		function IconBranchOutline16() {
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				...stroke,
				children: [
					(0, react_jsx_runtime.jsx)("circle", {
						cx: "4",
						cy: "3",
						r: "1.5"
					}),
					(0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "4",
						r: "1.5"
					}),
					(0, react_jsx_runtime.jsx)("circle", {
						cx: "4",
						cy: "13",
						r: "1.5"
					}),
					(0, react_jsx_runtime.jsx)("path", { d: "M4 4.5v7M4 9h3a5 5 0 0 0 5-3.5" })
				]
			});
		}
		function IconChevronDownOutline14() {
			return (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 14 14",
				"aria-hidden": "true",
				...stroke,
				children: (0, react_jsx_runtime.jsx)("path", { d: "m3 5 4 4 4-4" })
			});
		}
		function IconPanelLeftOutline16() {
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				...stroke,
				children: [(0, react_jsx_runtime.jsx)("rect", {
					x: "2",
					y: "2.5",
					width: "12",
					height: "11",
					rx: "2"
				}), (0, react_jsx_runtime.jsx)("path", { d: "M6 2.5v11" })]
			});
		}
		function IconStopFill16() {
			return (0, react_jsx_runtime.jsx)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				children: (0, react_jsx_runtime.jsx)("rect", {
					x: "4",
					y: "4",
					width: "8",
					height: "8",
					rx: "1",
					fill: "currentColor"
				})
			});
		}
		function IconCopyOutline16() {
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				...stroke,
				children: [(0, react_jsx_runtime.jsx)("rect", {
					x: "5.5",
					y: "5.5",
					width: "8",
					height: "8",
					rx: "1.5"
				}), (0, react_jsx_runtime.jsx)("path", { d: "M10.5 3.5A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5" })]
			});
		}
		function IconCheckOutline16() {
			return (0, react_jsx_runtime.jsx)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				...stroke,
				children: (0, react_jsx_runtime.jsx)("path", { d: "m3 8.5 3.5 3.5L13 4.5" })
			});
		}
		function IconWarningOutline16() {
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				...stroke,
				children: [(0, react_jsx_runtime.jsx)("path", { d: "m7 2-5.5 10a1 1 0 0 0 1 1.5h11a1 1 0 0 0 1-1.5L9 2a1.1 1.1 0 0 0-2 0Z" }), (0, react_jsx_runtime.jsx)("path", { d: "M8 6v3m0 2v.1" })]
			});
		}
		//#endregion
		//#region lib/client/activity-model.js
		/** Pure relationship projections used by the AgentTeams activity panel. */
		/**
		* Statuses after which a task no longer moves; every other status is open work.
		* ★ Single source for this fact: both the loop projection and the member clock
		*   read it from here, so a second list cannot drift out of step.
		*/
		const TERMINAL_TASK_STATUSES = [
			"completed",
			"failed",
			"cancelled"
		];
		/** Whether a task stopped for good, independent of why. */
		function taskIsTerminal(status) {
			return TERMINAL_TASK_STATUSES.includes(status);
		}
		/**
		* ── ★★★ t82：一个成员名下**还有没有活开着** ────────────────────────────────────
		*
		* ── 为什么需要它（缺陷：已完成的成员仍显示琥珀）────────────────────────────────
		*
		* 两条注释（`ActivityPanel.module.css:2053` 与 `MemberRow.tsx:126-127`）**逐字**
		* 都写了同一个条件：那是「**死会话 + 活还开着**」才会有的琥珀 ——
		*   · CSS：「a dead session **with open work** is a thing to act on」
		*   · TS ：「A member whose session is gone **while its work is still open**」
		*
		* ★★ 而实现里 `liveness === 'not-live'` **无条件**返回 `'stalled'`，且
		*   `MemberDotContext` 只有 `{discarded, stopped, staged, historic}` 四格 ——
		*   **"活还开着"这个条件在实现里根本无法表达**。
		* ⇒ 一个刚**成功交付**、会话被正常回收的成员，被画成"需要你去处理"的琥珀。
		* ★ 而琥珀是本仓唯一的"待处理"色 ⇒ "干完了"与"卡住了"同色 ⇒ 那个色不再是信号。
		*
		* ── 纯派生 ─────────────────────────────────────────────────────────────────
		*
		* ★ 从**已有的** `owned`（该成员名下全部任务）算，**不新开数据通道** ——
		*   终态判定复用本文件既有的 {@link taskIsTerminal}，与轮次投影、成员时钟**同一份**来源。
		*
		* ★★ **缺席语义（`owned` 为 undefined）＝ `true`（按"有活"处理）**，理由是**保守**：
		*   · 误判成琥珀 ⇒ 一个人去多看一眼（**代价小**）；
		*   · 误判成 idle ⇒ 一个**真的卡住**的成员被画成"收工了"（**代价是一个没人看的卡点**）。
		*   ⇒ 两边代价不对称时取代价小的那一侧；而"没人看的卡点"正是本仓记账最久的那一类。
		* @param owned - every task assigned to this member, or undefined when unavailable.
		* @returns true when at least one owned task is not terminal.
		*/
		function memberHasOpenWork(owned) {
			if (owned === void 0) return true;
			return owned.some((task) => !taskIsTerminal(task.status));
		}
		/** Compact `provider/model` route, or just the model when the provider is absent. */
		function memberRouteLabel(member) {
			if (member === void 0) return "";
			const provider = member.provider?.trim() ?? "";
			const model = member.model?.trim() ?? "";
			if (provider !== "" && model !== "") return `${provider}/${model}`;
			return model;
		}
		/**
		* Compact route shown on a running task. Prefer the task's own snapshot
		* field; fall back to the assignee member when older hosts omit it.
		*/
		function taskModelLabel(task, members) {
			const direct = task.model?.trim() ?? "";
			if (direct !== "") return direct;
			return memberRouteLabel(members.find((candidate) => candidate.name === task.assignee));
		}
		/** Short model id for tight DAG/chip surfaces (`openai/gpt-5.6-sol` → `gpt-5.6-sol`). */
		function compactModelLabel(route) {
			const trimmed = route.trim();
			if (trimmed === "") return "";
			const slash = trimmed.lastIndexOf("/");
			return slash === -1 ? trimmed : trimmed.slice(slash + 1);
		}
		/**
		* Latest terminal-task `updatedAt` owned by one member.
		* @param memberName - member whose owned tasks are scanned.
		* @param tasks - team tasks carrying durable `updatedAt` stamps.
		* @returns the newest terminal stamp, or undefined when the member owns none.
		*/
		function memberFinishedAt(memberName, tasks) {
			let latest;
			for (const task of tasks) {
				if (task.assignee !== memberName) continue;
				if (task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled") continue;
				const stamp = task.updatedAt;
				if (typeof stamp !== "number" || !Number.isFinite(stamp)) continue;
				if (latest === void 0 || stamp > latest) latest = stamp;
			}
			return latest;
		}
		/** Whether a member still has live work (running activity or an open task). */
		function memberIsRunning(member, tasks) {
			if (member.activity === "working" || member.status === "working") return true;
			return tasks.some((task) => task.assignee === member.name && (task.status === "pending" || task.status === "claimed" || task.status === "in_progress"));
		}
		/**
		* Order the delegation member list for issue #192.
		*
		* Running members keep their incoming relative order and come first; finished
		* members follow sorted by finish time, newest first. Members without a
		* derivable finish time keep their incoming relative order after the stamped
		* ones, so an older host that omits stamps never reorders them randomly.
		* @param members - delegation roster in snapshot order.
		* @param tasks - team tasks carrying durable `updatedAt` stamps.
		* @returns the members in display order.
		*/
		function orderDelegationMembers(members, tasks) {
			const running = [];
			const finishedStamped = [];
			const finishedUnstamped = [];
			members.forEach((member, index) => {
				if (memberIsRunning(member, tasks)) {
					running.push({
						member,
						index
					});
					return;
				}
				const finishedAt = memberFinishedAt(member.name, tasks);
				if (finishedAt === void 0) finishedUnstamped.push({
					member,
					index
				});
				else finishedStamped.push({
					member,
					index,
					finishedAt
				});
			});
			finishedStamped.sort((left, right) => right.finishedAt - left.finishedAt || left.index - right.index);
			return [
				...running,
				...finishedStamped,
				...finishedUnstamped
			].map((entry) => entry.member);
		}
		/** Whether the captain chat should keep showing the in-progress banner. */
		function teamIsActive(team) {
			if (team.halted === true || team.phase === "staged") return false;
			if (team.members.some((member) => member.activity === "working" || member.status === "working")) return true;
			if (team.tasks.some((task) => task.status === "pending" || task.status === "claimed" || task.status === "in_progress")) return true;
			return team.members.length > 0 && team.tasks.length === 0;
		}
		/** Use a fill-width grid when the task graph has no real dependency edges. */
		function usesParallelTaskGrid(tasks) {
			if (tasks.length === 0) return false;
			const taskIds = new Set(tasks.map((task) => task.id));
			return tasks.every((task) => task.dependencies.every((dependency) => !taskIds.has(dependency)));
		}
		/**
		* Whether an expanded activity panel still belongs to the current session.
		*
		* The panel is mounted in the root-scoped shell overlay, so React does not
		* remount it when the conversation route changes. Ownership keeps an expanded
		* panel from leaking onto the new-session screen (or another conversation)
		* while its local open state is being reset.
		*/
		function activityPanelExpandedForSession(open, owner, current) {
			return open && owner !== void 0 && owner === current;
		}
		/**
		* Auto-expand only for live teams that appear after the current session's
		* initial restore pass. Replayed cards, archived teams, and live teams restored
		* while reopening a conversation must remain behind the collapsed badge.
		*/
		function activityPanelShouldAutoExpand({ alreadyAutoOpened, pageSettled, restoreComplete, previousLiveTeamIds, currentLiveTeamIds }) {
			return !alreadyAutoOpened && pageSettled && restoreComplete && currentLiveTeamIds.some((teamId) => !previousLiveTeamIds.has(teamId));
		}
		/**
		* Resolve the task whose dependency chain should be highlighted.
		*
		* A pinned task is an explicit user choice. Keyboard focus takes precedence
		* over delayed pointer intent so an older hover timer cannot steal the active
		* chain from someone navigating the task map with the keyboard.
		*/
		function dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId) {
			return pinnedTaskId ?? keyboardTaskId ?? hoverTaskId;
		}
		/**
		* Render-facing tone of one terminal task.
		*
		* ★ This is the one place the three outcomes become three UI states. The
		*   distinction is the whole point: a review that returned `needs_revision`
		*   (inconclusive) did its job and must read as convergence; a broken
		*   deliverable must stay red; an unmeasured stop is neither.
		*/
		function taskLoopTone(task) {
			if (task.status === "cancelled") return "cancelled";
			if (task.status === "completed") return "completed";
			if (task.status !== "failed") return task.status === "in_progress" ? "running" : "open";
			const kind = task.failureKind;
			if (kind === "inconclusive") return "converging";
			if (kind === "failed_delivery") return "failed";
			if (kind === "failed_context") return "unmeasured";
			/** No classification ⇒ today's undifferentiated failure, never a guessed one. */
			return "failed";
		}
		/**
		* The tone of one round as a whole.
		*
		* Precedence is deliberate: an unsettled outcome outranks a settled one, so a
		* round whose review found problems cannot be painted green by the completed
		* tasks riding alongside it. Within the unsettled group the order is
		* failed > converging > unmeasured > running, i.e. the most consequential
		* reading wins, and a round with nothing left to decide reads as completed.
		*/
		function roundTone(tasks) {
			const tones = tasks.map((task) => taskLoopTone(task));
			if (tones.includes("failed")) return "failed";
			if (tones.includes("converging")) return "converging";
			if (tones.includes("unmeasured")) return "unmeasured";
			if (tones.includes("running") || tones.includes("open") || tones.includes("blocked")) return "running";
			if (tones.includes("completed")) return "completed";
			return "cancelled";
		}
		/**
		* ── ★★★ R2：把轮次搬到成员行上（用户原话：round data moves UP into screen one）──
		*
		* MEASURED（用户 2026-10-11）：轮次/收敛原本单占一块（`ReviewLoopSection`），
		* 而成员行上**一个字都没有**。于是"这个成员在第几轮、那一轮什么结果"要看第二处
		* 才知道 —— 而用户要的第一屏口径是"整队在不在动、谁在做什么"。
		*
		* ★ 口径是**成员自己的**轮次，不是全队的：一个成员名下带 `round` 的任务里最大的
		*   那一轮。缺席 ⇒ `undefined`（"没有轮次概念"），**不是** `0`（"第 0 轮"）——
		*   两者必须不同形（与 `TeamActivityMember.round` 同一条判据，且不在这里重算规则）。
		*
		* ★ 反向半边：同一批任务，只看**这个成员的**任务 —— 一个把全队最大轮次印到每个人
		*   身上的实现，会让没参与那一轮的成员也印着"第 N 轮"。
		* @param tasks - the member's OWN tasks.
		* @returns the member's highest round, or undefined when none carries one.
		*/
		function memberRound(tasks) {
			const rounds = [];
			for (const round of new Set(tasks.map((task) => task.round).filter((value) => typeof value === "number" && Number.isFinite(value)))) {
				const group = tasks.filter((task) => task.round === round);
				rounds.push({
					round: Math.max(1, Math.floor(round)),
					tasks: group,
					tone: roundTone(group)
				});
			}
			if (rounds.length === 0) return void 0;
			rounds.sort((left, right) => left.round - right.round);
			return rounds[rounds.length - 1];
		}
		/**
		* ── ★★★ What a member's *history* says, once it has no open work left (D12)─────
		*
		* MEASURED（用户截图）：一个**刚做完 12 件**的成员与一个**从没派过活**的成员，
		* 主行读出来是**同一句话**。而那两件事的处置**相反**：
		*   · 有历史 ⇒ 队长**欠它**一个任务（该派了）；
		*   · 无历史 ⇒ 它**还没参与过**（可能正常，也可能配置错了）。
		*
		* ★ 四种取值，且**两两不同形** —— 这正是本函数存在的理由：
		*   · `open`     —— 还有未终结任务 ⇒ 调用方去显示那个任务（不是本函数的兜底）。
		*   · `failed`   —— 最新的一条终结任务是失败 ⇒ 该**重派**。
		*   · `finished` —— 有已完成的任务、最新那条不是失败 ⇒ 该**派下一件**。
		*   · `never`    —— 名下一条任务都没有（或只有非终结且非完成的残留）⇒ 从未派工。
		*
		* ★ "最新"的判据必须是**确定**的：优先用宿主写的 `updatedAt`（唯一的持久时间戳），
		*   缺席时退回**传入顺序的最后一条** —— 快照顺序是稳定的，而"随机挑一条"会让
		*   同一份数据两次渲染给出不同的句子。
		*
		* ★ 反向半边：把 `failed` 与 `finished` 合流，或把 `finished` 与 `never` 合流，
		*   都会让"刚做完 12 件"与"从没派过活"重新同形 —— 即本轮要修的缺陷本身。
		* @param owned - the member's OWN tasks, in snapshot order.
		* @returns which of the four non-open situations this member is in.
		*/
		function memberHistoryState(owned) {
			if (owned.filter((task) => !isTerminalTask(task)).length > 0) return "open";
			const terminal = owned.filter((task) => isTerminalTask(task));
			if (terminal.length === 0) return "never";
			const latest = latestOwnedTask(terminal);
			if (latest !== void 0 && latest.status === "failed") return "failed";
			/** ★ 只有"确实完成过"才算 finished：一条 cancelled 的残留不是"干完了"。 */
			return terminal.some((task) => task.status === "completed") ? "finished" : "never";
		}
		/** Whether a task has stopped for good (`state`, falling back to `status`). */
		function isTerminalTask(task) {
			const state = task.state ?? task.status;
			return state === "completed" || state === "failed" || state === "cancelled";
		}
		/**
		* The newest task by `updatedAt`, falling back to snapshot order.
		*
		* ★ 缺 `updatedAt` 时**不打乱**相对次序：早于该字段的宿主快照里，
		*   顺序是唯一可用的"先后"证据。
		* ★ 导出是给 D12 的两句文案取任务 id 用的（"tN 失败" / "已完成 tN"）——
		*   两处必须**同一口径**，否则两句话会指向不同的任务。
		* @param tasks - candidate tasks, in snapshot order.
		* @returns the newest one, or undefined for an empty list.
		*/
		function latestOwnedTask(tasks) {
			if (tasks.length === 0) return void 0;
			let best = tasks[tasks.length - 1];
			for (const task of tasks) {
				const stamp = task.updatedAt;
				if (typeof stamp !== "number" || !Number.isFinite(stamp)) continue;
				const bestStamp = best.updatedAt;
				if (typeof bestStamp !== "number" || !Number.isFinite(bestStamp) || stamp >= bestStamp) best = task;
			}
			return best;
		}
		/**
		* ── ★★★ R3：任务着色读数（从 ActivityPanel.tsx 搬来，逐字未改）───────────────────
		*
		* ★ 这里保留的是原来那段**逐字的**判据：`taskTone` 是旧行为，而
		*   `taskTerminalTone` 是 t13 引入的三态修正（"评审发现了问题"读成琥珀而不是红）。
		*   `DependencyGraph.tsx` 与面板都要用它，所以它必须在两边都能 import 的地方 ——
		*   而**不是**各留一份。
		*/
		/** Badge/bar coloring key: visual state, widened for terminal statuses. */
		function taskTone(state, status) {
			if (status === "failed") return "failed";
			if (status === "cancelled") return "cancelled";
			return state;
		}
		/**
		* Terminal-outcome tone for every surface that colours a task.
		*
		* ★ This is the fix for "a review that found problems renders as a red failure".
		*   The three measured outcomes get three distinct tones: a consultative task
		*   whose job was to find problems renders AMBER (`converging`), a genuinely
		*   broken deliverable stays red, and an unmeasured stop renders as neither.
		*
		* ★ When the host has not published a classification, this returns the SAME
		*   value `taskTone` did before, so nothing regresses on an older snapshot —
		*   the new states only appear where they were actually measured.
		*/
		function taskTerminalTone(task) {
			if (task.status === "cancelled") return "cancelled";
			if (task.status !== "failed") return taskTone(task.state, task.status);
			return taskLoopTone(task);
		}
		/** Badge text follows the raw task status (finer than the 4 visual states). */
		const TASK_STATUS_LABEL = {
			pending: "task.status.pending",
			claimed: "task.status.claimed",
			in_progress: "task.status.inProgress",
			completed: "task.status.completed",
			failed: "task.status.failed",
			cancelled: "task.status.cancelled"
		};
		/** Human label for one raw task status, falling back to the status itself. */
		function taskStatusLabel(status, t) {
			const key = TASK_STATUS_LABEL[status];
			return key === void 0 ? status : t(key);
		}
		/** One-line task description used as a `title` tooltip (`id · subject · extras`). */
		function taskTitle(task, model) {
			const extras = [
				task.kind,
				task.round === void 0 ? void 0 : `r${task.round}`,
				task.verdict,
				model === "" ? void 0 : model
			].filter((item) => item !== void 0);
			return extras.length === 0 ? `${task.id} · ${task.subject}` : `${task.id} · ${task.subject} · ${extras.join(" · ")}`;
		}
		/** Compact task label for the tight DAG nodes. */
		function compactTaskLabel(subject) {
			const withoutVerb = subject.replace(/^开发\s*/u, "").replace(/^\d+[-_.、\s]*/u, "");
			const head = withoutVerb.split(/[（(·：:]/u)[0]?.trim() ?? withoutVerb;
			return head.length > 18 ? `${head.slice(0, 17)}…` : head;
		}
		/** Joined task-id list using the locale's list separator. */
		function formatTaskIds(ids, t) {
			return ids.join(t("format.listSeparator"));
		}
		/**
		* ── ★★★ R2：**谁该拥有秒表** ──────────────────────────────────────────────────
		*
		* MEASURED（R2 开工时）：秒表原本挂在 1599 行的 `TeamSection` 上 ——
		* `useElapsedNow` 一 tick，**整棵面板树重渲染**。而它每秒都在跑，
		* 哪怕队里只有一个人在动。
		*
		* ★ 判据（契约原句）："Only members that actually have a running clock
		*   subscribe to ticks; an idle or waiting member does not keep a timer alive."
		*
		* ★ 为什么只有 `running` 一格为真，另三格各自说清：
		*   · `running` ⇒ 时长**每秒都在变**（`now − updatedAt`）⇒ 必须有人 tick，否则读数不动。
		*   · `stale`   ⇒ 时长同样在变，但它数的是"没人推进它"——★ 而它是**告警**，
		*                 不是进度；让它每秒重排一次会把一个静态的坏消息画成"还在动"。
		*                 ⇒ 它读一次就够了（值本身就是"最后一次改动以来"）。
		*   · `idle`    ⇒ **不带时长**（`ms` 恒为 0）⇒ tick 只会重渲染一个不动的字符串。
		*   · `unknown` ⇒ 读不出戳 ⇒ 同样没有可更新的数字。
		*
		* ★ 反向半边（缺了它，一个"恒返回 true"的实现会让面板每秒重渲染每一行，
		*   而每一条断言照样绿）：本函数对四种读数**必须**给出**不同**的答案。
		* @param kind - the member's elapsed readout.
		* @returns whether a live per-second ticker is required for that readout.
		*/
		function memberClockTicks(kind) {
			return kind === "running";
		}
		/**
		* Read one member's subagent layer off the `/state` payload.
		*
		* ★★★ 三态不许塌：`observed` + 空数组是"**读了**，真的没有"；
		*   `could-not-measure` 是"**没读成**"。把后者圆成前者会让面板永远印着
		*   "没有子代理" —— 而那与"确实没有"在读者眼里**同形**（本仓三态纪律，
		*   也是 t27 立这一格的唯一理由）。
		*
		* ★ 缺省（老宿主根本没有这一格）同样归入 `could-not-measure`，而不是
		*   "这个成员没有子代理"：老宿主不是"测到了没有"，是"没这块数据"。
		* @param member - one member row from the snapshot (read structurally).
		* @returns the tri-state readout, with the host's own reason when it gave one.
		*/
		function memberSubagentReadout(member) {
			const state = member.subagents;
			if (state !== "observed" && state !== "could-not-measure") return {
				state: "could-not-measure",
				subagents: [],
				reason: "the host published no subagent reading for this member"
			};
			const subagents = Array.isArray(member.liveSubagents) ? member.liveSubagents : [];
			if (state === "observed") return {
				state,
				subagents
			};
			return {
				state,
				subagents: [],
				reason: typeof member.subagentsReason === "string" && member.subagentsReason !== "" ? member.subagentsReason : "the host could not measure this member's subagents"
			};
		}
		/**
		* Classify one live subagent's status for rendering.
		* @param status - the raw session status as the host reported it.
		* @returns `working`, `idle`, or `unknown` for anything unrecognised.
		*/
		function subagentTone(status) {
			if (status === "running" || status === "working") return "working";
			if (status === "idle" || status === "ready") return "idle";
			return "unknown";
		}
		/** Stable key for one member row's expansion slot. */
		function memberRowKey(member) {
			const id = member.id?.trim() ?? "";
			return id !== "" ? id : `name:${member.name}`;
		}
		/**
		* Whether one member row is expanded.
		*
		* ★ Collapsed by default is a *value*, not an absent branch: an unmapped row
		*   reads `false`, so a fresh render can never accidentally open every row.
		* @param expansion - the panel's expansion store.
		* @param key - the row's stable key (see {@link memberRowKey}).
		*/
		function memberRowExpanded(expansion, key) {
			return expansion.get(key) === true;
		}
		/**
		* Apply one explicit user toggle to the expansion store.
		*
		* ★ The result is a user choice from then on: it is stored, so the next poll's
		*   re-render reads it back rather than re-deriving a default. That is the whole
		*   of "a user's choice is not reset".
		* ★ Returns the SAME map when nothing changed, so a redundant toggle cannot
		*   invalidate every row on the next render.
		* @param expansion - the current store.
		* @param key - the row's stable key.
		* @returns the next store.
		*/
		function toggleMemberRow(expansion, key) {
			const next = new Map(expansion);
			if (next.get(key) === true) next.delete(key);
			else next.set(key, true);
			return next;
		}
		/**
		* Drop expansion entries for members that are no longer on the team.
		*
		* ★ Without this, a store keyed by member id grows for the life of the panel —
		*   the panel is a shell-overlay singleton and outlives every conversation
		*   route change. Rows the user never touched are never added in the first
		*   place, so the pruning is only ever removing what a re-spawn replaced.
		* ★ Returns the same map when nothing was pruned.
		* @param expansion - the current store.
		* @param keys - every key the current roster defines.
		*/
		function pruneMemberRows(expansion, keys) {
			const live = new Set(keys);
			let changed = false;
			const next = /* @__PURE__ */ new Map();
			for (const [key, open] of expansion) if (live.has(key)) next.set(key, open);
			else changed = true;
			return changed ? next : expansion;
		}
		/**
		* Read how long a member has been on the task it is currently on.
		*
		* The stamp comes from the task's durable `updatedAt` — a fact the host writes
		* on every change — never from a timer started in the browser, which would be
		* a guess that resets on reload.
		*
		* ★ The clock distinguishes running from stale because a dead member's open
		*   task still carries a fresh-looking stamp. Counting that as elapsed work is
		*   precisely the reading task t4 removed, so it is rendered as stalled instead.
		*
		* @param member - the member row; `liveness` decides running vs stale when present.
		* @param tasks - the team's tasks, supplying the durable stamps.
		* @param now - observation instant, injected so this stays pure.
		*/
		function memberClock(member, tasks, now) {
			const driving = memberIsDriving(member);
			/**
			* ── ★★★ 空闲与"等待"必须分开，而**不再都塌成 `none`** ──────────────────────────
			*
			* MEASURED（用户 2026-10-11 实测，见下）：此前这里对两者都返回 `kind:'none'`，
			* 于是面板**整格空白** —— 而"这一格没东西"与"这个成员没事做"在界面上同形。
			*
			* ★ 三态的口径（用户原话：「要么显示已工作多长时间，要么显示已等待多长时间」）：
			*   · 有活而且在跑   ⇒ `running`：**已工作**多久（它确实在推进）
			*   · 有活而没在跑   ⇒ `stale`  ：**已等待**多久（没人推进它 —— 这才是要看的数）
			*   · 没有活         ⇒ `idle`   ：**空闲**，一个明确的中性读数（不是空白）
			*
			* ★ 而"有活"不含还没开始的任务（用户 2026-10-13：「任务还没开始怎么已经有时间」）。
			*   `pending` 的 `updatedAt` 是创建时间，拿它走表等于把"还没开工"显示成已工作/已等待。
			*   认领（`claimed`）和进行中才算已经开始。
			*/
			const timed = timedTask(member, tasks);
			if (timed === void 0) return {
				kind: "idle",
				ms: 0
			};
			const stamp = durableStamp(timed.updatedAt);
			/**
			* ★ 拿不到戳 ⇒ `could-not-measure`，**不塌进 `idle`**。
			*   一个"读不出时间"与一个"它没事做"必须不同形（本仓三态纪律）。
			*/
			if (stamp === void 0) return {
				kind: "unknown",
				ms: 0
			};
			const ms = Math.max(0, now - stamp);
			return {
				kind: driving ? "running" : "stale",
				ms,
				stamp
			};
		}
		/**
		* The durable stamp a member's clock is currently measured from.
		*
		* ★ Same picks as {@link memberClock}, returned as the raw stamp instead of a
		*   duration: the ticking component re-derives the duration each second from
		*   this stamp, so the panel never has to re-render to move the number.
		* @param member - the member row.
		* @param tasks - the team's tasks.
		* @returns the durable `updatedAt` being counted from, or undefined.
		*/
		function memberClockStamp(member, tasks) {
			const timed = timedTask(member, tasks);
			return timed === void 0 ? void 0 : durableStamp(timed.updatedAt);
		}
		/**
		* The task a member's clock is allowed to time.
		*
		* ★ `pending` is assigned but not started. Its durable stamp is the create
		*   time, so counting from it draws a duration before any work exists.
		*   Claimed and in-progress are the statuses that have actually begun.
		*/
		function timedTask(member, tasks) {
			const started = tasks.filter((task) => task.assignee === member.name && taskHasStarted(task.status));
			if (started.length === 0) return void 0;
			return (member.currentTask === void 0 || member.currentTask === "" ? void 0 : started.find((task) => task.id === member.currentTask)) ?? started.reduce((latest, task) => {
				const stamp = durableStamp(task.updatedAt);
				const best = durableStamp(latest.updatedAt);
				return stamp !== void 0 && (best === void 0 || stamp > best) ? task : latest;
			}, started[0]);
		}
		/** Whether this status has left "not started". Pending has not. */
		function taskHasStarted(status) {
			return status === "claimed" || status === "in_progress";
		}
		/** Wall-clock stamps from a hostile JSON source must be finite numbers to be read. */
		function durableStamp(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : void 0;
		}
		/**
		* Whether something is actually driving this member right now.
		*
		* ★ `liveness` wins when the host publishes it: `activity` is a durable field
		*   that keeps saying `working` after the session is gone (the residual reading
		*   t4 exists to surface). Without `liveness` we fall back to `activity`, which
		*   is exactly today's behaviour rather than an invented one.
		*/
		function memberIsDriving(member) {
			const liveness = member.liveness;
			if (liveness !== void 0 && liveness !== "") return liveness === "working";
			return member.activity === "working";
		}
		/** Compact elapsed copy for one row: `4s`, `12m`, `1h 5m`. */
		function formatElapsed(ms) {
			const total = Math.max(0, Math.floor(ms / 1e3));
			const hours = Math.floor(total / 3600);
			const minutes = Math.floor(total % 3600 / 60);
			const seconds = total % 60;
			if (hours > 0) return `${hours}h ${minutes}m`;
			if (minutes > 0) return `${minutes}m`;
			return `${seconds}s`;
		}
		/** Group tasks by their precomputed dependency depth. */
		function taskStages(tasks) {
			const byDepth = /* @__PURE__ */ new Map();
			for (const task of tasks) {
				const depth = Number.isFinite(task.depth) ? Math.max(0, Math.floor(task.depth)) : 0;
				const stage = byDepth.get(depth) ?? [];
				stage.push(task);
				byDepth.set(depth, stage);
			}
			return [...byDepth.entries()].sort(([left], [right]) => left - right).map(([depth, stageTasks]) => ({
				depth,
				tasks: stageTasks.slice().sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }))
			}));
		}
		/**
		* Lay tasks out as the reference panel's compact left-to-right DAG.
		*
		* Columns are dependency-depth stages. Rows are stable task-id order within
		* each stage. Edges use cubic curves so fan-in remains readable without
		* turning every task into a large card.
		*/
		function compactDagLayout(tasks, dimensions) {
			const nodeWidth = dimensions?.nodeWidth ?? 92;
			const nodeHeight = dimensions?.nodeHeight ?? 30;
			const columnGap = dimensions?.columnGap ?? 26;
			const rowGap = dimensions?.rowGap ?? 8;
			const stages = taskStages(tasks);
			const positions = /* @__PURE__ */ new Map();
			const nodes = [];
			for (const [column, stage] of stages.entries()) for (const [row, task] of stage.tasks.entries()) {
				const x = column * (nodeWidth + columnGap);
				const y = row * (nodeHeight + rowGap);
				positions.set(task.id, {
					x,
					y
				});
				nodes.push({
					task,
					x,
					y
				});
			}
			const edges = [];
			for (const task of tasks) {
				const target = positions.get(task.id);
				if (target === void 0) continue;
				for (const dependency of task.dependencies) {
					const source = positions.get(dependency);
					if (source === void 0) continue;
					const x1 = source.x + nodeWidth;
					const y1 = source.y + nodeHeight / 2;
					const x2 = target.x;
					const y2 = target.y + nodeHeight / 2;
					edges.push({
						from: dependency,
						to: task.id,
						path: `M${x1} ${y1}C${x1 + 14} ${y1},${x2 - 14} ${y2},${x2} ${y2}`
					});
				}
			}
			const rows = Math.max(1, ...stages.map((stage) => stage.tasks.length));
			return {
				width: stages.length === 0 ? 0 : stages.length * nodeWidth + (stages.length - 1) * columnGap,
				height: stages.length === 0 ? 0 : rows * nodeHeight + (rows - 1) * rowGap,
				nodes,
				edges
			};
		}
		/**
		* Return the complete upstream/downstream chain around one task.
		*
		* Traversal uses both dependency directions and remains cycle-safe, so the UI
		* can highlight every handoff related to the focused task even if malformed
		* durable data contains a cycle.
		*/
		function relatedTaskIds(taskId, tasks) {
			const byId = new Map(tasks.map((task) => [task.id, task]));
			if (!byId.has(taskId)) return /* @__PURE__ */ new Set();
			const dependents = /* @__PURE__ */ new Map();
			for (const task of tasks) for (const dependency of task.dependencies) {
				const targets = dependents.get(dependency) ?? [];
				targets.push(task.id);
				dependents.set(dependency, targets);
			}
			const related = /* @__PURE__ */ new Set();
			const upstreamSeen = /* @__PURE__ */ new Set();
			const downstreamSeen = /* @__PURE__ */ new Set();
			const visitUpstream = (id) => {
				if (upstreamSeen.has(id)) return;
				upstreamSeen.add(id);
				related.add(id);
				for (const dependency of byId.get(id)?.dependencies ?? []) visitUpstream(dependency);
			};
			const visitDownstream = (id) => {
				if (downstreamSeen.has(id)) return;
				downstreamSeen.add(id);
				related.add(id);
				for (const dependent of dependents.get(id) ?? []) visitDownstream(dependent);
			};
			visitUpstream(taskId);
			visitDownstream(taskId);
			return related;
		}
		/** How many `ran[]` entries carry one verdict. */
		function verdictTally(entries, verdict) {
			return entries.filter((entry) => entry.verdict === verdict).length;
		}
		/**
		* The verdict for every task a member owns, keyed by task id.
		*
		* ★ Purely derived: one `Map` walk, no host calls, so it is testable from the
		*   compiled `lib/client/activity-model.js` without a browser.
		*/
		function memberGateReadouts(tasks) {
			const out = /* @__PURE__ */ new Map();
			for (const task of tasks) {
				const raw = task.gateEvaluation;
				if (raw === void 0 || raw === null || raw === "") {
					out.set(task.id, { state: "absent" });
					continue;
				}
				const evaluation = readGateEvaluation(raw);
				if (evaluation === void 0) {
					out.set(task.id, { state: "absent" });
					continue;
				}
				if (Array.isArray(evaluation.ran) && evaluation.ran.length === 0) {
					out.set(task.id, {
						state: "empty",
						registered: evaluation.registered,
						...evaluation.skippedAll === void 0 ? {} : { skippedAll: evaluation.skippedAll }
					});
					continue;
				}
				out.set(task.id, {
					state: "verdict",
					verdict: memberGateVerdict(evaluation),
					evaluation
				});
			}
			return out;
		}
		/**
		* Normalise one task's gate field into a record, whether it arrived serialised
		* or as an object. `undefined` = **unreadable**, which stays its own answer.
		*/
		function readGateEvaluation(raw) {
			if (typeof raw === "string") return parseGateEvaluation(raw);
			if (typeof raw !== "object" || raw === null) return void 0;
			const record = raw;
			if (!Array.isArray(record.ran)) return void 0;
			return {
				ok: record.ok === true,
				blockers: Array.isArray(record.blockers) ? record.blockers : [],
				ran: record.ran,
				evaluated: typeof record.evaluated === "number" ? record.evaluated : 0,
				skipped: typeof record.skipped === "number" ? record.skipped : 0,
				registered: typeof record.registered === "number" ? record.registered : 0,
				...record.unmeasured === void 0 ? {} : { unmeasured: record.unmeasured },
				...record.skippedAll === void 0 ? {} : { skippedAll: record.skippedAll },
				...record.observedBlockers === void 0 ? {} : { observedBlockers: record.observedBlockers }
			};
		}
		/** Parse the stringified record the status tool emits; undefined when unreadable. */
		function parseGateEvaluation(raw) {
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null) return void 0;
				const record = parsed;
				if (!Array.isArray(record.ran)) return void 0;
				return {
					ok: record.ok === true,
					blockers: Array.isArray(record.blockers) ? record.blockers : [],
					ran: record.ran,
					evaluated: typeof record.evaluated === "number" ? record.evaluated : 0,
					skipped: typeof record.skipped === "number" ? record.skipped : 0,
					registered: typeof record.registered === "number" ? record.registered : 0,
					...record.unmeasured === void 0 ? {} : { unmeasured: record.unmeasured },
					...record.skippedAll === void 0 ? {} : { skippedAll: record.skippedAll },
					...record.observedBlockers === void 0 ? {} : { observedBlockers: record.observedBlockers }
				};
			} catch {
				return;
			}
		}
		/**
		* The one symbol for a member's compact verdict band.
		*
		* ★ `observed` (fired but waived) is its own answer — it must not read as `ok`
		*   ("gentle, nothing happened") nor as `blocked` ("it stopped the flow").
		*
		* ── ★★★ 队长修复（2026-10-16）：`skippedAll` 在场 ⇒ 绝不是 `ok` ──────────────
		*
		* MEASURED（实测）：全跳过时 `ran` 里**有**条目（每条 `verdict:'skipped'`），
		* 而修前这里只数 `blocked`/`unmeasured` ⇒ **返回 `ok`** ⇒ 界面画成 **✓**。
		*
		* ★★ 而注册表**逐字**说了它的本意（`registry.ts:884-886`）：
		*   「采用 ② 的本意：**让裁决不再无条件给 `ok`**，而不复用 `unmeasured`：
		*      `ok: false` + `blockers: []` + `unmeasured: undefined` + `skippedAll: <说明>`」
		*   ⇒ 即 **`skippedAll` 在场就是"不是 ok"的机械标志**。
		*
		* ⇒ 所以这一支**按注册表自己的判据**判，不发明新的：
		*   `skippedAll` 在场 ⇒ `unmeasured`（"没测到"，与它的同为"没测到"一族）。
		*/
		function memberGateVerdict(evaluation) {
			if (typeof evaluation.unmeasured === "string" && evaluation.unmeasured !== "") return "unmeasured";
			/**
			* ★ 全跳过：`ran` 非空（全是 `skipped`），而 `skippedAll` 在场。
			* ⇒ 它是"判据没跑"，**不是**"跑过且通过"。两者在界面上必须不同形。
			*/
			if (typeof evaluation.skippedAll === "string" && evaluation.skippedAll !== "") return "unmeasured";
			if (evaluation.ran.filter((entry) => entry.observed === true).length > 0 || (evaluation.observedBlockers ?? 0) > 0) return "observed";
			if (verdictTally(evaluation.ran, "blocked") + verdictTally(evaluation.ran, "unmeasured") > 0) return "blocked";
			return "ok";
		}
		/**
		* Which stage a task is in, **derived from its status** (spec §4).
		*
		*   `pending`      ⇒ `dispatch`   （等派工）
		*   `in_progress`  ⇒ `completion` （成员在做）
		*   `completed` + 判据在场 ⇒ `delivery`（待交付）
		*   `completed` 无判据     ⇒ 省略阶段（`undefined`）
		*
		* ★ `undefined` 与任何一段都**不同形**：省略是"这一格没有阶段可报"，
		*   而不是"它在第一段"。
		* @param status - the durable task status.
		* @param hasEvaluation - whether a gate record is on the task at all.
		* @returns the stage, or undefined when the spec says to omit it.
		*/
		function taskStage(status, hasEvaluation) {
			if (status === "pending" || status === "claimed") return "dispatch";
			if (status === "in_progress") return "completion";
			if (status === "completed") return hasEvaluation ? "delivery" : void 0;
		}
		/**
		* ── ★★★ t81：段落的**层级** —— 决定它能不能出现在任务上 ──────────────────────────
		*
		* ★★ `delivery` / `runtime` **永不落盘到 task**（团队级 / 事件级）：
		*   · `delivery` —— `src/tools/delivery.ts`：**整个团队**宣布交付，不是某条任务的事实；
		*   · `runtime`  —— `evaluateRuntimeGates`：**跨步骤**的过程约束（告警，不直接拒任务）。
		*   ⇒ ★ **不许为了"凑齐六段"给它们编一个 per-task 裁决** —— 那会造出一个**错误的事实**。
		*     这与 `admission` 的"真的 0 条"是**两件不同的事**（一个是没判据，一个是不属于任务）。
		*/
		function segmentLevel(stage) {
			if (stage === "delivery") return "team";
			if (stage === "runtime") return "event";
			/**
			* ★ `admission` **已注册 3 条判据，但生产零求值点**（全仓无 `evaluate('admission', …)`）。
			*   ⇒ 它落在任务级面上、而永远拿不到裁决。
			* ★ 代码判的是 `registered === 0`（来自 `catalog` 的静态清单），**不写死**任何段名 ——
			*   所以这三条判据哪天真接上了线，这里**不需要改**。
			*/
			return "task";
		}
		/**
		* 判定一段"没有裁决"的**成因**。
		*
		* ★ 调用前提：调用方已经确定**这一段没有裁决**（拿不到 `evaluation`）。
		*   ⇒ 本函数只回答"**为什么没有**"，不回答"有没有"。
		*
		* @param stage - 是哪一段。
		* @param registered - 这一段**注册了**几条判据（来自 `catalog`，是静态清单）。
		* @param reached - 这条任务**走到过**这一段吗（由落盘字段/状态推）。
		*/
		function segmentAbsence(stage, registered, reached) {
			/**
			* ★ 顺序是刻意的：**层级**先判 —— 因为它与"走到没走到"**无关**。
			*   `delivery`/`runtime` 哪怕任务明明走到了那一步（交付、运行中），
			*   它们的裁决也**不在任务上** ⇒ 报"团队级"，而不是"还没走到"。
			*   ★ 这正是反向半边 C：不许说"还没到"，也不许编一个裁决。
			*/
			const level = segmentLevel(stage);
			if (level === "team" || level === "event") return "teamLevel";
			/** ★ 真的没判据（空段）—— 与"没走到"不同形。 */
			if (registered === 0) return "noGate";
			/** ★ 有判据、但这条任务还没走到那一段。 */
			if (!reached) return "notReached";
			/** ★ 走到了、有判据，而这一代没记（retry 清过 / 求值路径没落）。 */
			return "notRecorded";
		}
		/** The single glyph for each state. ★ 每个都不一样 —— 这是本模块存在的理由。 */
		const GATE_GLYPH = {
			passed: "✓",
			skipped: "⊘",
			running: "●",
			registered: "○",
			pending: "·",
			observed: "✗"
		};
		/**
		* ── ★★★ 一段的逐条投影 ──────────────────────────────────────────────────────
		*
		* ★★ **甲方案的边界就落在这个函数里**：`stage !== 'completion'` 时
		* **一律不看 `evaluation`**，因为那几个段的结果根本不落盘
		* ⇒ 逐条只能是 `registered` / `pending`，**不许**从别处推一个 `✓` 出来。
		*
		* ★ completion 段按 `evaluation.ran[]` 逐条对齐（**按注册顺序**，与注册表一致）：
		*   · `verdict: 'ok'`        ⇒ `passed`
		*   · `verdict: 'skipped'`   ⇒ ★ `skipped`（⊘）—— 而 `skippedAll` 在场时**整段**是 ⊘
		*   · `verdict: 'blocked'`   ⇒ `observed` 若是 observe 放过，否则 `observed`/✗
		*   · `verdict: 'unmeasured'`⇒ `observed`（"测不了"不是"通过"）
		*   · **不在 `ran[]` 里**     ⇒ `registered` ○（注册了但本轮没跑）
		*
		* ★★ **反向半边 A 的落点**：`evaluation` 缺席 ⇒ 每条都 `registered`（○），
		*   **一个 `✓` 都不许出现**。这条不是"顺手" —— 它是"从未跑过"与"跑过且干净"
		*   不同形的**唯一**保证。
		*/
		function stageGateRows(stage, catalog, evaluation, stageVerdicts) {
			/**
			* ★★ t81：**不再是** `stage === 'completion' ? evaluation : undefined`。
			*   现在三个任务级段（contract / dispatch / completion）都可能**真的**有裁决
			*   （它们在服务端落盘，见 `TeamTask.gateEvaluations`）。
			*   ★ 而 `delivery` / `runtime` **仍然永远没有** —— 那**不是**因为"没走到"，
			*     而是因为它们**不是任务级事实**。见 {@link segmentLevel}。
			*   ★ 这里**不**为它们编一个裁决：`stageVerdicts` 对面那两段恒为 `undefined`，
			*     调用方也会用 {@link segmentAbsence} 把它们显示成「团队级」。
			*/
			const verdicts = segmentLevel(stage) === "task" ? stageVerdicts ?? (stage === "completion" ? evaluation : void 0) : void 0;
			if (verdicts === void 0) return catalog.map((gate) => ({
				id: gate.id,
				description: gate.description,
				state: "registered",
				observing: gate.observing
			}));
			const byId = new Map(verdicts.ran.map((entry) => [entry.id, entry]));
			return catalog.map((gate) => {
				const entry = byId.get(gate.id);
				if (entry === void 0)
 /** ★ 注册了但这一轮的 `ran[]` 里没有它 ⇒ ○（"没跑"），**不是** ✓。 */
				return {
					id: gate.id,
					description: gate.description,
					state: "registered",
					observing: gate.observing
				};
				return {
					id: gate.id,
					description: gate.description,
					state: gateRunState(entry, verdicts),
					observing: gate.observing
				};
			});
		}
		/**
		* One `ran[]` entry's state.
		*
		* ★★ `skippedAll` 在场 ⇒ **整段都是 `skipped`（⊘）**，与逐条的 `verdict` 无关。
		*   这是 `c4cbeaf` 的判据在**逐条**这一层的对应物：全跳过时 `ran[]` 里
		*   **有**条目（每条 `verdict:'skipped'`），只按 `verdict` 分会让"跳过"落在
		*   "不是 blocked/unmeasured" ⇒ 读成通过。
		*/
		function gateRunState(entry, evaluation) {
			if (typeof evaluation.skippedAll === "string" && evaluation.skippedAll !== "") return "skipped";
			if (entry.verdict === "skipped") return "skipped";
			if (entry.verdict === "ok") return entry.observed === true ? "observed" : "passed";
			return "observed";
		}
		/**
		* ── ★★★ 整段的形状 ──────────────────────────────────────────────────────────
		*
		* ★ 一段的"状态"不是它第一条判据的状态：`skippedAll` 在场 ⇒ **整段** ⊘；
		*   一条 `✗` ⇒ 整段 ✗（这是要人看的那件事实）；全 `✓` ⇒ ✓；
		*   有 `●` ⇒ ●；否则 ○。
		*
		* ★ 甲方案：**非 completion 段**只报"有没有判据"，不报裁决 ——
		*   因为它们的结果不落盘，报裁决就是编。
		*/
		function stageGroupState(stage, rows, evaluation, stageVerdicts) {
			if (rows.length === 0) return "pending";
			const verdicts = segmentLevel(stage) === "task" ? stageVerdicts ?? (stage === "completion" ? evaluation : void 0) : void 0;
			if (verdicts === void 0) return "registered";
			if (typeof verdicts.skippedAll === "string" && verdicts.skippedAll !== "") return "skipped";
			/** ★ 一段里有任何一条不是"通过"，整段就不是"通过" —— 优先报最需要人看的那个。 */
			if (rows.some((row) => row.state === "observed")) return "observed";
			if (rows.some((row) => row.state === "running")) return "running";
			if (rows.some((row) => row.state === "skipped")) return "skipped";
			if (rows.every((row) => row.state === "passed")) return "passed";
			if (rows.some((row) => row.state === "passed")) return "running";
			return "registered";
		}
		/**
		* ── ★★★ 两行式的行 2：`第 N 轮 · 阶段 · 测试`，按优先级**截断**──────────────────
		*
		* 规格 §3：行 2 超出就**先省"测试"，再省"阶段"** —— **不许溢出**。
		* 所以返回的是**按优先级排好的候选清单**，从最全到最省；渲染层取**第一个放得下**的。
		*
		* ★ 为什么把"截断"做成**候选清单**而不是在渲染层现算：这样"放不下"这件事
		*   可以用纯函数测，不需要浏览器量宽度。
		* @param round - the member's round, or undefined when it has none.
		* @param stage - the derived stage, or undefined when the spec says to omit it.
		* @param testLabel - the "which test" text, or '' when there is none.
		* @returns candidates from fullest to sparsest; '' means "nothing to show".
		*/
		function doingLineCandidates(round, stage, testLabel) {
			/** 三段按**优先级从高到低**：轮次 > 阶段 > 测试。截断就是从这个列表的**尾部**丢。 */
			const byPriority = [
				round !== void 0 && Number.isFinite(round) ? `第 ${Math.max(1, Math.floor(round))} 轮` : "",
				stage === void 0 ? "" : `${stage} 段`,
				testLabel
			].filter((part) => part !== "");
			/** ★ 从最全到最省：每丢一次尾部的"测试"、再丢一次"阶段"。 */
			const candidates = [];
			for (let keep = byPriority.length; keep >= 1; keep -= 1) candidates.push(byPriority.slice(0, keep).join(" · "));
			return candidates.length > 0 ? candidates : [""];
		}
		/**
		* ── ★★★ v4：一个成员的**裁决 tone**（旧的 `data-member-gate-tone` 词表）────────────
		*
		* ★ 这个词表是**已经存在**的（旧的"一句话裁决"band 用它）：`absent` / `skipped` /
		*   `ok` / `blocked` / `unmeasured` / `observed` —— 而 v4 把那句话换成了**阶段分组**，
		*   于是这个 tone 改由"当前那一段的形状"推出来。
		*
		* ★ **保留它的理由**：臂 27 逐条比对渲染出的 `data-*` 探针，一个都不许无声消失。
		*   事实没丢（"这个成员的判据现在什么形状"仍然可读），只是换了承载 ——
		*   所以这里给出**同名同词表**的读数，而不是让探针消失。
		*
		* ★★ 映射**不发明新词**：六态压进旧词表时，"没跑"与"跳过了"必须仍然不同形 ——
		*   `registered`/`pending` ⇒ `absent`（没有任何裁决），`skipped` ⇒ `skipped`，
		*   `passed` ⇒ `ok`，`observed` ⇒ `observed`，`running` ⇒ `unmeasured`
		*   （"还在跑"与"测不了"同属"还没有结论"这一族，且都不是 `ok`）。
		* @param stage - the stage the member's current task is in, or undefined.
		* @param groups - the stage groups derived for this row.
		* @returns the legacy tone, or 'absent' when there is no stage at all.
		*/
		function memberGateTone(stage, groups) {
			if (stage === void 0) return "absent";
			const group = groups.find((candidate) => candidate.stage === stage);
			if (group === void 0) return "absent";
			switch (group.state) {
				case "passed": return "ok";
				case "skipped": return "skipped";
				case "observed": return "observed";
				case "running": return "unmeasured";
				/** ★ `registered` / `pending` 都是"还没有任何裁决" ⇒ `absent`（不是 `ok`）。 */
				default: return "absent";
			}
		}
		/**
		* Half-width characters that must **not** be counted as wide.
		*
		* ★ 这些码位是 CJK 兼容区里的**半宽形式**（Unicode `East_Asian_Width=Halfwidth`），
		*   实际只占 1 列：半宽片假名（`ｱｲｳ`，U+FF61–U+FF9F）与半宽谚文（U+FFA0–U+FFDC）。
		*
		* ── ★★★ 状态如实标注：**这一段现在是冗余的**（对拍臂 M2 的实测）───────────────
		*
		* MEASURED（变异体实测）：把 `inHalfwidthSpans` 那一行**删掉**，27 条断言**全绿**
		* —— 因为下面 `WIDE_SPANS` 里没有任何区间覆盖 `0xFF61–0xFF9F`／`0xFFA0–0xFFDC`
		* （全角那一段是 `0xFF00–0xFF60`，**到 FF60 就停了**）⇒ 这个例外**从不触发**。
		*
		* ★ 那为什么还留着：**它是一道防将来改错的护栏**。若有人为了让某个码位变宽而把
		*   全角区间写成 `[0xFF00, 0xFF60]` → `[0xFF00, 0xFFEF]`（"把 FF 段都算宽"），
		*   这一行就会**立刻承重**，而那些半宽字符不会被静默算成 2 列。
		* ★★ 而不许写一条"测得到它"的断言：**当前的实现里没有任何输入能区分开它**，
		*   硬造一条只会是自证。⇒ 如实记成"现在是护栏、不是主路径"。
		*/
		const HALFWIDTH_SPANS = [[65377, 65439], [65440, 65500]];
		/**
		* Codepoint ranges that occupy **2 columns** (`East_Asian_Width` W or F).
		*
		* ★ 分区依据是 Unicode 的 East Asian Width 属性，**按区间独立写**；
		*   对拍臂（见 `cjkWidthTableCrossCheck`）把它与另一条独立实现的算法逐字比对。
		*/
		const WIDE_SPANS = [
			[4352, 4447],
			[11904, 12350],
			[12353, 13311],
			[13312, 19903],
			[19968, 40959],
			[40960, 42191],
			[44032, 55203],
			[63744, 64255],
			[65040, 65049],
			[65072, 65135],
			[65280, 65376],
			[65504, 65510],
			[127744, 128591],
			[129280, 129535],
			[131072, 196605],
			[196608, 262141]
		];
		/** Whether one codepoint is in a halfwidth span (checked **before** the wide table). */
		function inHalfwidthSpans(code) {
			return HALFWIDTH_SPANS.some(([start, end]) => code >= start && code <= end);
		}
		/**
		* Whether one **codepoint** occupies two columns.
		* @param code - a Unicode codepoint (from `codePointAt`, **not** `charCodeAt`).
		*
		* ★★ 必须吃**码点**：补充平面（U+10000 以上）的字在 UTF-16 里是**代理对**，
		*   `charCodeAt` 给的是代理码元（U+D800–U+DFFF）⇒ 表里查不到 ⇒ 会被算成 1 列。
		*   ★ 这一点是**对拍臂抓出来的**（见文件里 `cjkWidthTableCrossCheck` 的注释）：
		*     我第一版用 `charCodeAt`，`😀` 与 `𠀀` 两条对不上，臂报 disagree=2。
		*/
		function isWideCode(code) {
			if (inHalfwidthSpans(code)) return false;
			return WIDE_SPANS.some(([start, end]) => code >= start && code <= end);
		}
		/**
		* ── ★★★ B5：这段文字的**列数**（不是字符数）────────────────────────────────────
		*
		* ★ 为什么需要它：`role` 是**自由文本**（队长写进去的是 106–209 字符的英文长句），
		*   而将来它可以由成员定义给出**中文**。中文字占 **2 列** ⇒
		*   **同样的字符数，中文占的宽度约两倍** ⇒ 用"字符数"判"放不放得下"会**判错**。
		*
		* ★ 逐**码元**累加（`charCodeAt`）：BMP 之外的字按两个码元各算 1 列，
		*   与"一个补充平面字符"的差异见文件头那段**已知边界**。
		* @param text - the text to measure.
		* @returns the number of terminal columns the text occupies.
		*/
		function charColumns(text) {
			let columns = 0;
			for (const char of text)
 /** ★ `for…of` 按**码点**迭代（自动合并代理对）—— 与 `charCodeAt` 的关键区别。 */
			columns += isWideCode(char.codePointAt(0) ?? 0) ? 2 : 1;
			return columns;
		}
		/**
		* ── ★★★ B6：把一行长文本**按列数**折成若干行（不是按字符数）────────────────────
		*
		* ★ 用 `charColumns` 而不是 `length`：`role` 里一旦出现中文，
		*   按字符数折行会让**中文行比英文行宽一倍** ⇒ 溢出。
		*
		* ★ 折行点优先取**空格**（英文长句不断词），中文没有空格 ⇒ 按**列**硬折。
		* @param text - the text to wrap.
		* @param maxColumns - the container's usable column count.
		* @returns the wrapped lines, at most `maxLines`.
		*/
		function wrapByColumns(text, maxColumns, maxLines = Number.POSITIVE_INFINITY) {
			if (maxColumns <= 0) return [text];
			const lines = [];
			let current = "";
			let currentColumns = 0;
			/** ★ 记录"最近一个空格的位置"，于是英文可以**在词间断**而不是断在词中。 */
			let lastSpace = -1;
			for (const char of text) {
				const charCols = isWideCode(char.codePointAt(0) ?? 0) ? 2 : 1;
				if (currentColumns + charCols > maxColumns) {
					if (lastSpace >= 0) {
						lines.push(current.slice(0, lastSpace));
						current = current.slice(lastSpace + 1);
					} else {
						lines.push(current);
						current = "";
					}
					currentColumns = charColumns(current);
					lastSpace = -1;
					if (lines.length >= maxLines) return lines.slice(0, maxLines);
				}
				current += char;
				currentColumns += charCols;
				if (char === " ") lastSpace = current.length - 1;
			}
			if (current !== "") lines.push(current);
			return lines.slice(0, maxLines === Number.POSITIVE_INFINITY ? void 0 : maxLines);
		}
		//#endregion
		//#region \0dsh-css:/Users/abab/Desktop/agent-teams-dev/src/client/ActivityPanel.module.css.mjs
		const css$8 = "html{--agent-teams-panel-shift:420px}html[data-agent-teams-panel-open] [data-phase=active]{box-sizing:border-box;padding-right:var(--agent-teams-panel-shift)}.Q6PinG_badge{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 92%, transparent);backdrop-filter:blur(16px);height:34px;box-shadow:0 8px 28px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 29%, transparent);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;align-items:center;gap:7px;padding:0 12px;font-size:12px;font-weight:600;line-height:20px;transition:border-color .15s,transform .12s;display:inline-flex;position:absolute;top:64px;right:18px}.Q6PinG_badge:hover{border-color:var(--dsw-alias-border-l3);transform:translateY(-1px)}.Q6PinG_badge:active{transform:translateY(0)scale(.98)}.Q6PinG_badge:focus-visible,.Q6PinG_iconButton:focus-visible,.Q6PinG_memberRow:focus-visible,.Q6PinG_membersToggle:focus-visible,.Q6PinG_sectionToggleTitle:focus-visible,.Q6PinG_dagNode:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.Q6PinG_badgeDot,.Q6PinG_panelDot{background:var(--dsw-alias-label-tertiary);border-radius:50%;width:7px;height:7px}.Q6PinG_badgeDot[data-busy=true],.Q6PinG_panelDot[data-busy=true]{background:var(--dsw-alias-state-business-primary);animation:1.25s ease-in-out infinite Q6PinG_agentTeamsPulse}.Q6PinG_badgeCount,.Q6PinG_memberCount,.Q6PinG_teamStats{font-variant-numeric:tabular-nums}.Q6PinG_panel{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l3) 58%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 95%, transparent);backdrop-filter:blur(20px)saturate(1.08);box-shadow:0 12px 32px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 25%, transparent), 0 32px 72px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 33%, transparent);will-change:transform;border-radius:16px;flex-direction:column;animation:.16s ease-out Q6PinG_agentTeamsPanelIn;display:flex;position:absolute;top:0;left:0;overflow:hidden}.Q6PinG_panel[data-dragging],.Q6PinG_panel[data-resizing]{user-select:none;box-shadow:0 16px 38px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 29%, transparent), 0 36px 78px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 38%, transparent)}@keyframes Q6PinG_agentTeamsPanelIn{0%{opacity:0}to{opacity:1}}@keyframes Q6PinG_agentTeamsPulse{0%,to{opacity:.42}50%{opacity:1}}.Q6PinG_panelHead{border-bottom:1px solid var(--dsw-alias-border-l2);cursor:grab;touch-action:none;flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:0 14px 0 16px;display:flex}.Q6PinG_panelHead:active,.Q6PinG_panel[data-dragging] .Q6PinG_panelHead{cursor:grabbing}.Q6PinG_panel[data-compact] .Q6PinG_panelHead{cursor:default;touch-action:auto}.Q6PinG_panelTitle{color:var(--dsw-alias-label-primary);align-items:center;gap:8px;font-size:14px;font-weight:600;line-height:20px;display:inline-flex}.Q6PinG_panelControls{flex:none;align-items:center;gap:2px;display:inline-flex}.Q6PinG_iconButton{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:7px;justify-content:center;align-items:center;padding:0;transition:background-color .12s,color .12s,transform .12s;display:inline-flex}.Q6PinG_iconButton:hover{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}.Q6PinG_iconButton:active{transform:scale(.94)}.Q6PinG_iconButton[data-control=dock][data-mode=docked] svg{transform:scaleX(-1)}.Q6PinG_resizeHandle{z-index:5;touch-action:none;pointer-events:auto;position:absolute}.Q6PinG_resizeHandle[data-resize-edge=left]{cursor:ew-resize;width:14px;top:44px;bottom:14px;left:0}.Q6PinG_resizeHandle[data-resize-edge=left]:after{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 42%, transparent);content:\"\";opacity:.45;border-radius:999px;width:3px;height:48px;transition:background-color .12s,opacity .12s;position:absolute;top:50%;left:4px;transform:translateY(-50%)}.Q6PinG_resizeHandle[data-resize-edge=bottom]{cursor:ns-resize;height:14px;bottom:0;left:20px;right:20px}.Q6PinG_resizeHandle[data-resize-edge=bottom]:after{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 42%, transparent);content:\"\";opacity:.45;border-radius:999px;width:48px;height:3px;transition:background-color .12s,opacity .12s;position:absolute;bottom:4px;left:50%;transform:translate(-50%)}.Q6PinG_resizeHandle[data-resize-edge=corner]{cursor:nwse-resize;width:28px;height:28px;bottom:0;right:0}.Q6PinG_resizeHandle[data-resize-edge=corner]:after{border-right:2px solid var(--dsw-alias-label-tertiary);border-bottom:2px solid var(--dsw-alias-label-tertiary);content:\"\";opacity:.58;width:10px;height:10px;transition:border-color .12s,opacity .12s;position:absolute;bottom:6px;right:6px}.Q6PinG_resizeHandle:hover:after,.Q6PinG_panel[data-resizing] .Q6PinG_resizeHandle:after{background-color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);opacity:.95}.Q6PinG_teams{overscroll-behavior:contain;scrollbar-color:color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent) transparent;scrollbar-width:thin;flex-direction:column;min-height:0;display:flex;overflow-y:auto}.Q6PinG_teams::-webkit-scrollbar{width:6px}.Q6PinG_teams::-webkit-scrollbar-track{background:0 0}.Q6PinG_teams::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent);background-clip:padding-box;border:2px solid #0000;border-radius:999px}.Q6PinG_teams:hover::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--dsw-alias-label-tertiary) 44%, transparent);background-clip:padding-box}.Q6PinG_team{border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;padding:12px 14px 16px;display:flex;container:Q6PinG_agent-team/inline-size}.Q6PinG_team:last-child{border-bottom:0}.Q6PinG_teamHead{align-items:center;gap:10px;min-width:0;display:flex}.Q6PinG_teamName{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px;font-weight:600;line-height:18px;overflow:hidden}.Q6PinG_teamStats{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;gap:8px;font-size:10.5px;line-height:16px;display:inline-flex}.Q6PinG_teamStopButton{border:1px solid var(--dsw-alias-border-l2);width:26px;height:26px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border-radius:7px;flex:none;place-items:center;padding:0;transition:border-color .15s,background .15s,color .15s;display:grid}.Q6PinG_teamStopButton:hover{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, transparent);color:var(--dsw-alias-state-error-primary)}.Q6PinG_teamStopButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.Q6PinG_stopModalActions{justify-content:flex-end;gap:8px;display:flex}.Q6PinG_stopModalActions button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-ghost-active-fill);min-height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:6px 13px;font-size:12px;font-weight:600;display:inline-flex}.Q6PinG_stopModalActions button[data-danger]{border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted)}.Q6PinG_stopModalActions button:disabled{cursor:wait;opacity:.58}.Q6PinG_stopModalError{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);color:var(--dsw-alias-state-error-primary);border-radius:8px;align-items:flex-start;gap:7px;margin:0;padding:9px 10px;font-size:12px;line-height:18px;display:flex}.Q6PinG_stopModalError svg{flex:none;margin-top:1px}.Q6PinG_sectionHead{justify-content:space-between;align-items:center;gap:8px;min-width:0;display:flex}.Q6PinG_sectionHint{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.Q6PinG_delegationSection{min-width:0}.Q6PinG_captainNode{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 32%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-1));border-radius:10px;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:9px;min-height:56px;padding:6px 10px;display:grid}.Q6PinG_captainAvatar,.Q6PinG_memberAvatar{flex:none;justify-content:center;align-items:center;display:inline-flex;position:relative}.Q6PinG_captainAvatar{width:46px;height:46px}.Q6PinG_leadAvatar,.Q6PinG_memberArt{object-fit:contain;filter:drop-shadow(0 1px 1px #122d4833);background:0 0;border:0;border-radius:0}.Q6PinG_leadAvatar{width:44px;height:44px}.Q6PinG_memberArt{width:40px;height:40px}.Q6PinG_captainInfo,.Q6PinG_memberInfo{flex-direction:column;min-width:0;display:flex}.Q6PinG_captainInfo{gap:2px}.Q6PinG_captainLine,.Q6PinG_memberLine{align-items:center;gap:6px;min-width:0;display:flex}.Q6PinG_captainName,.Q6PinG_memberName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;line-height:18px;overflow:hidden}.Q6PinG_captainRole,.Q6PinG_memberRole{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.Q6PinG_captainSummary,.Q6PinG_memberStatusLine{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:15px;overflow:hidden}.Q6PinG_taskDetailModel{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;line-height:14px;overflow:hidden}.Q6PinG_memberModel{min-width:0;max-width:148px;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:0 auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;line-height:15px;overflow:hidden}.Q6PinG_memberRow>.Q6PinG_memberInfo .Q6PinG_memberLine>svg:last-child{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .14s}.Q6PinG_memberRow[aria-expanded=true] .Q6PinG_memberLine>svg:last-child{transform:rotate(180deg)}.Q6PinG_captainState{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;align-items:center;gap:5px;font-size:10px;font-weight:500;line-height:15px;display:inline-flex}.Q6PinG_captainState[data-busy=true]{color:var(--dsw-alias-state-business-primary)}.Q6PinG_workGlyph rect{opacity:.5}.Q6PinG_workGlyph[data-active=true] rect{animation:1.1s ease-in-out infinite Q6PinG_agentTeamsDot}@keyframes Q6PinG_agentTeamsDot{0%,to{opacity:.25}50%{opacity:1}}.Q6PinG_membersToggle{background:var(--dsw-alias-bg-module-platform);width:100%;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border:0;border-radius:8px;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;font-size:10.5px;font-weight:600;line-height:15px;display:flex}.Q6PinG_membersToggle:hover{background:var(--dsw-alias-button-ghost-active-fill)}.Q6PinG_membersToggle>span{align-items:center;gap:5px;display:inline-flex}.Q6PinG_membersToggle>span:last-child{color:var(--dsw-alias-state-business-primary)}.Q6PinG_chevron{flex:none;transition:transform .14s}.Q6PinG_chevron[data-open=true]{transform:rotate(90deg)}.Q6PinG_delegationTree{flex-direction:column;gap:2px;margin-left:18px;padding:9px 0 0 20px;display:flex;position:relative}.Q6PinG_delegationTree:before{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-border-l2));content:\"\";width:1px;position:absolute;top:0;bottom:22px;left:0}.Q6PinG_memberBlock{flex-direction:column;min-width:0;padding:3px 0 7px;display:flex;position:relative}.Q6PinG_memberBranch{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-border-l2));width:20px;height:1px;display:block;position:absolute;top:27px;right:100%}.Q6PinG_memberBranch:before{background:var(--dsw-alias-state-business-primary);content:\"\";border-radius:50%;width:5px;height:5px;position:absolute;top:-2px;right:-1px}.Q6PinG_memberRow{box-sizing:border-box;width:100%;min-width:0;min-height:48px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;align-items:center;padding:4px 6px;transition:background-color .12s,transform .12s;display:grid}.Q6PinG_memberRow:active{transform:scale(.995)}.Q6PinG_memberAvatar{width:42px;height:42px}.Q6PinG_memberAvatar[data-unread=true]:after{box-sizing:border-box;border:1px solid var(--dsw-alias-bg-layer-1);background:var(--dsw-alias-state-business-primary);content:\"\";border-radius:50%;width:6px;height:6px;animation:1.8s ease-in-out infinite Q6PinG_agentTeamsUnreadPulse;position:absolute;top:0;right:-1px}@keyframes Q6PinG_agentTeamsUnreadPulse{0%,to{opacity:.78;transform:scale(.92)}50%{opacity:1;transform:scale(1.16)}}.Q6PinG_memberInitial{background:var(--dsw-alias-state-business-primary);width:34px;height:34px;color:var(--dsw-alias-label-primary-inverted);border-radius:50%;justify-content:center;align-items:center;font-size:14px;font-weight:600;line-height:20px;display:inline-flex}.Q6PinG_stateArt{box-sizing:border-box;object-fit:contain;width:22px;height:22px;filter:drop-shadow(0 0 1px var(--dsw-alias-bg-layer-1)) drop-shadow(0 1px 1px #122d483d);background:0 0;border:0;border-radius:0;position:absolute;bottom:-3px;right:-5px}.Q6PinG_stateArt[data-activity=working]{animation:2.4s ease-in-out infinite Q6PinG_agentTeamsFloat}.Q6PinG_stateArt[data-activity=idle]{animation:4.2s ease-in-out infinite Q6PinG_agentTeamsBreathe}.Q6PinG_stateArt[data-activity=unknown]{animation:2.8s ease-in-out infinite Q6PinG_agentTeamsThink}@keyframes Q6PinG_agentTeamsFloat{0%,to{transform:translateY(0)rotate(-4deg)}50%{transform:translateY(-2px)rotate(4deg)}}@keyframes Q6PinG_agentTeamsBreathe{0%,to{opacity:.82;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}@keyframes Q6PinG_agentTeamsThink{0%,to{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}.Q6PinG_memberCount{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:16px}.Q6PinG_dependencySection{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:7px;min-width:0;padding-top:10px;display:flex}.Q6PinG_sectionToggleTitle{color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;padding:0;font-size:11px;font-weight:600;line-height:16px;display:inline-flex}.Q6PinG_dagViewport{scrollbar-width:thin;min-width:0;padding:2px 0 4px;overflow-x:auto}.Q6PinG_dagCanvas{min-width:100%;position:relative}.Q6PinG_dagCanvas[data-layout=parallel]{flex-wrap:wrap;gap:8px;display:flex}.Q6PinG_dagCanvas[data-layout=parallel] .Q6PinG_dagNode{flex:92px;min-width:92px;position:relative}.Q6PinG_dagEdges{pointer-events:none;position:absolute;inset:0;overflow:visible}.Q6PinG_dagEdges path{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:1px;transition:opacity .14s,stroke .14s,stroke-width .14s}.Q6PinG_dagEdges path[data-active=true]{stroke:var(--dsw-alias-state-business-primary);stroke-width:1.6px}.Q6PinG_dagEdges path[data-dimmed=true]{opacity:.24}.Q6PinG_dagNode{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;border-radius:6px;flex-direction:column;justify-content:center;gap:1px;padding:0 6px;transition:border-color .14s,background-color .14s,opacity .14s;display:flex;position:absolute}.Q6PinG_dagNode:hover,.Q6PinG_dagNode[data-focused=true]{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-1))}.Q6PinG_dagNode[data-dimmed=true]{opacity:.3}.Q6PinG_dagNode[data-state=running][data-dimmed=true]{opacity:.58}.Q6PinG_dagNode[data-state=completed]{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 48%, var(--dsw-alias-border-l2))}.Q6PinG_dagNode[data-state=blocked]{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 52%, var(--dsw-alias-border-l2))}.Q6PinG_dagNode[data-state=failed]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 56%, var(--dsw-alias-border-l2))}.Q6PinG_dagNodeHead{color:var(--dsw-alias-label-primary);align-items:center;gap:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;font-weight:700;display:flex}.Q6PinG_dagNodeDot{background:var(--dsw-alias-border-l3);border-radius:1.5px;flex:none;width:5px;height:5px}.Q6PinG_dagNode[data-state=running] .Q6PinG_dagNodeDot{background:var(--dsw-alias-state-business-primary)}.Q6PinG_dagNode[data-state=running] .Q6PinG_dagNodeHead{padding-right:12px}.Q6PinG_dagRunningState{width:9px;height:9px;color:var(--dsw-alias-state-business-primary);pointer-events:none;justify-content:center;align-items:center;display:inline-flex;position:absolute;top:4px;right:5px}.Q6PinG_dagRunningState .Q6PinG_workGlyph{width:9px;height:9px}.Q6PinG_dagNode[data-state=blocked] .Q6PinG_dagNodeDot{background:var(--dsw-alias-state-warn-primary)}.Q6PinG_dagNode[data-state=completed] .Q6PinG_dagNodeDot{background:var(--dsw-alias-state-success-primary)}.Q6PinG_dagNode[data-state=failed] .Q6PinG_dagNodeDot{background:var(--dsw-alias-state-error-primary)}.Q6PinG_dagNodeLabel{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:8.5px;line-height:11px;overflow:hidden}.Q6PinG_taskDetail{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:9px;flex-direction:column;gap:3px;min-width:0;padding:7px 9px;display:flex}.Q6PinG_taskDetailHead{align-items:center;gap:6px;min-width:0;display:flex}.Q6PinG_taskDetailId{color:var(--dsw-alias-state-business-primary);flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:700}.Q6PinG_taskDetailSubject{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600;line-height:16px;overflow:hidden}.Q6PinG_taskDetailBadge{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:0 5px;font-size:8.5px;font-weight:600;line-height:14px}.Q6PinG_taskDetailBadge[data-state=running]{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted)}.Q6PinG_taskDetailBadge[data-state=blocked]{background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary-inverted)}.Q6PinG_taskDetailBadge[data-state=completed]{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-inverted)}.Q6PinG_taskDetailBadge[data-state=failed]{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted)}.Q6PinG_taskDetailLine{color:var(--dsw-alias-label-secondary)}.Q6PinG_taskDetailLine,.Q6PinG_taskDetailMeta{font-size:9.5px;line-height:14px}.Q6PinG_taskDetailMeta{color:var(--dsw-alias-label-tertiary)}.Q6PinG_emptyHint{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:11px;line-height:16px}.Q6PinG_planEditor{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 94%, var(--dsw-alias-state-business-primary));box-shadow:inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);border-radius:10px;flex-direction:column;gap:12px;margin:0 10px 12px;padding:12px;display:flex}.Q6PinG_planHeader>span{justify-content:space-between;align-items:center;gap:8px;display:flex}.Q6PinG_planHeader>span>span{flex-direction:column;gap:2px;min-width:0;display:flex}.Q6PinG_planHeader strong{color:var(--dsw-alias-label-primary);font-size:12px}.Q6PinG_planHeader small{color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:500;line-height:13px}.Q6PinG_planHeader em{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);border-radius:999px;flex:none;padding:1px 7px;font-size:9px;font-style:normal;line-height:16px}.Q6PinG_planHeader p{color:var(--dsw-alias-label-secondary);margin:5px 0 0;font-size:10px;line-height:15px}.Q6PinG_planFlow{grid-template-columns:repeat(3,minmax(0,1fr));margin:0;padding:0;list-style:none;display:grid}.Q6PinG_planFlow li{min-width:0;color:var(--dsw-alias-label-tertiary);align-items:center;gap:5px;font-size:9px;font-weight:600;line-height:14px;display:flex;position:relative}.Q6PinG_planFlow li:not(:last-child):after{background:var(--dsw-alias-border-l2);content:\"\";flex:1;min-width:8px;height:1px;margin-right:5px}.Q6PinG_planFlow li>span{border:1px solid var(--dsw-alias-border-l2);border-radius:50%;flex:none;place-items:center;width:18px;height:18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;display:grid}.Q6PinG_planFlow li[data-active]{color:var(--dsw-alias-state-business-primary)}.Q6PinG_planFlow li[data-active]>span{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent)}.Q6PinG_planSection{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:8px;overflow:hidden}.Q6PinG_planSectionToggle,.Q6PinG_planCardHeader{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:0}.Q6PinG_planSectionToggle{justify-content:space-between;align-items:center;gap:8px;min-height:42px;padding:7px 9px;display:flex}.Q6PinG_planSectionToggle:hover,.Q6PinG_planCardHeader:hover{background:color-mix(in srgb, var(--dsw-alias-button-ghost-active-fill) 46%, transparent)}.Q6PinG_planSectionToggle>span{align-items:baseline;gap:7px;min-width:0;display:flex}.Q6PinG_planSectionToggle strong{font-size:10.5px}.Q6PinG_planSectionToggle small{color:var(--dsw-alias-label-tertiary);font-size:9px}.Q6PinG_planList{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:0;display:flex}.Q6PinG_planEmpty{color:var(--dsw-alias-label-tertiary);text-align:center;margin:0;padding:12px;font-size:10px}.Q6PinG_planCard{background:0 0;border:0;border-radius:0;min-width:0;margin:0;padding:0;display:block;position:relative}.Q6PinG_planCard+.Q6PinG_planCard{border-top:1px solid var(--dsw-alias-border-l2)}.Q6PinG_planCard[data-open=true]{background:color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent)}.Q6PinG_planCardHeader{grid-template-columns:minmax(80px,.9fr) minmax(72px,1.15fr) auto 12px;align-items:center;gap:7px;min-height:40px;padding:6px 9px;display:grid}.Q6PinG_planCardIdentity{flex-direction:column;gap:1px;min-width:0;display:flex}.Q6PinG_planCardIdentity strong,.Q6PinG_planTaskSummary{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:650;line-height:14px;overflow:hidden}.Q6PinG_planCardIdentity>span,.Q6PinG_planCardMeta{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:8.5px;line-height:12px;overflow:hidden}.Q6PinG_planTaskId{background:var(--dsw-alias-button-ghost-active-fill);width:max-content;color:var(--dsw-alias-label-secondary);border-radius:4px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8.5px;font-weight:700;line-height:14px}.Q6PinG_planDirty{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 13%, transparent);color:var(--dsw-alias-state-warn-primary);border-radius:999px;justify-self:end;padding:1px 5px;font-size:8px;font-style:normal;font-weight:650;line-height:14px}.Q6PinG_planChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .18s cubic-bezier(.2,.7,.2,1)}.Q6PinG_planChevron[data-open=true]{transform:rotate(90deg)}.Q6PinG_planCardBody{flex-direction:column;gap:8px;padding:0 9px 9px;display:flex}.Q6PinG_planCardBody fieldset{border:0;flex-direction:column;gap:7px;min-width:0;margin:0;padding:0;display:flex}.Q6PinG_planCardBody label,.Q6PinG_planNewTask label{min-width:0;color:var(--dsw-alias-label-tertiary);flex-direction:column;flex:1;font-size:9px;display:flex}.Q6PinG_planCardBody label{gap:4px}.Q6PinG_planCardBody label small{color:var(--dsw-alias-label-tertiary);font-size:8px;line-height:11px}.Q6PinG_planCard input,.Q6PinG_planCard textarea,.Q6PinG_planCard select,.Q6PinG_planNewTask input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:100%;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;border-radius:6px;outline:none;font-size:10.5px;line-height:16px;transition:border-color .16s,box-shadow .16s}.Q6PinG_planCard input,.Q6PinG_planCard select,.Q6PinG_planNewTask input{min-height:32px;padding:6px 8px}.Q6PinG_planCard textarea{resize:vertical;min-height:58px;padding:7px 8px}.Q6PinG_planCard input:focus-visible,.Q6PinG_planCard textarea:focus-visible,.Q6PinG_planCard select:focus-visible,.Q6PinG_planNewTask input:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent)}.Q6PinG_planGrid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px;display:grid}.Q6PinG_planModelPicker{grid-template-columns:minmax(0,1fr);gap:5px;display:grid}.Q6PinG_planModelMenu{width:100%;display:flex}.Q6PinG_planModelTrigger{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:100%;min-height:38px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;border-radius:7px;justify-content:space-between;align-items:center;gap:8px;padding:7px 9px;transition:border-color .16s,background-color .16s,transform .12s;display:flex}.Q6PinG_planModelTrigger:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}.Q6PinG_planModelTrigger:active:not(:disabled){transform:translateY(1px)}.Q6PinG_planModelTrigger:focus-visible{border-color:var(--dsw-alias-state-business-primary);outline:2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);outline-offset:1px}.Q6PinG_planModelTrigger:disabled{cursor:wait;opacity:.64}.Q6PinG_planModelTriggerCopy{align-items:baseline;gap:6px;min-width:0;display:flex}.Q6PinG_planModelTriggerCopy strong,.Q6PinG_planModelTriggerCopy span{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.Q6PinG_planModelTriggerCopy strong{color:var(--dsw-alias-label-primary);font-size:10px;font-weight:650;line-height:15px}.Q6PinG_planModelTriggerCopy span{color:var(--dsw-alias-label-tertiary);font-size:9px;line-height:14px}.Q6PinG_planModelMenuRow{grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;min-width:0;display:grid}.Q6PinG_planModelMenuRow>span:first-child{color:var(--dsw-alias-label-primary)}.Q6PinG_planModelMenuRow strong{color:var(--dsw-alias-label-tertiary);text-align:right;text-overflow:ellipsis;white-space:nowrap;font-weight:450;overflow:hidden}.Q6PinG_planModelMenuBack{align-items:center;gap:7px;display:inline-flex}.Q6PinG_planModelMenuBack svg{transform:rotate(180deg)}.Q6PinG_planModelEffortRow{flex-direction:column;align-items:flex-start;min-width:0;display:flex}.Q6PinG_planModelEffortRow small{width:100%;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.Q6PinG_planModelHint{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:8.5px;line-height:12px;overflow:hidden}.Q6PinG_planModelNotice{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, transparent);color:var(--dsw-alias-label-secondary);border-radius:6px;grid-column:1/-1;justify-content:space-between;align-items:center;gap:8px;padding:6px 7px;font-size:8.5px;line-height:12px;display:flex}.Q6PinG_planModelNotice button{color:var(--dsw-alias-state-business-primary);cursor:pointer;font:inherit;background:0 0;border:0;flex:none;padding:2px 6px;font-weight:650}.Q6PinG_planActions,.Q6PinG_planApproveRow,.Q6PinG_planNewTask,.Q6PinG_planConfirm,.Q6PinG_planApproveActions,.Q6PinG_planSecondaryActions{align-items:center;gap:7px;display:flex}.Q6PinG_planReviewActions{grid-template-columns:minmax(0,1fr);gap:6px;width:100%;display:grid}.Q6PinG_planSecondaryActions{grid-template-columns:minmax(0,1fr) auto;display:grid}.Q6PinG_planActions{justify-content:flex-end}.Q6PinG_planActions button,.Q6PinG_planNewTask button,.Q6PinG_planConfirm button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-ghost-active-fill);min-height:30px;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:6px;flex:none;padding:5px 10px;font-size:9.5px;font-weight:600;transition:background .16s,border-color .16s,transform .16s}.Q6PinG_planApproveRow button{border:1px solid var(--dsw-alias-border-l2);cursor:pointer;border-radius:6px;flex:none;padding:5px 10px;font-size:9.5px;font-weight:600;transition:background .16s,border-color .16s,transform .16s}.Q6PinG_planActions button:hover:not(:disabled),.Q6PinG_planNewTask button:hover:not(:disabled),.Q6PinG_planApproveRow button:hover:not(:disabled),.Q6PinG_planConfirm button:hover:not(:disabled){border-color:var(--dsw-alias-label-tertiary)}.Q6PinG_planActions button:active:not(:disabled),.Q6PinG_planNewTask button:active:not(:disabled),.Q6PinG_planApproveRow button:active:not(:disabled),.Q6PinG_planConfirm button:active:not(:disabled){transform:scale(.98)}.Q6PinG_planActions button[data-danger],.Q6PinG_planConfirm button[data-danger]{color:var(--dsw-alias-state-error-primary)}.Q6PinG_planFeedback{min-width:0;color:var(--dsw-alias-label-secondary);flex:1;align-items:center;gap:5px;font-size:9px;line-height:13px;animation:.18s ease-out Q6PinG_plan-feedback-in;display:inline-flex}.Q6PinG_planFeedback[data-tone=success]{color:var(--dsw-alias-state-success-primary)}.Q6PinG_planFeedback[data-tone=error]{color:var(--dsw-alias-state-error-primary)}.Q6PinG_planFeedback>span{border:1px solid;border-radius:50%;flex:none;place-items:center;width:15px;height:15px;display:grid}.Q6PinG_planFeedback svg{width:11px;height:11px}@keyframes Q6PinG_plan-feedback-in{0%{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:translateY(0)}}.Q6PinG_planConfirm{border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, transparent);border-radius:7px;flex-wrap:wrap;justify-content:flex-end;padding:7px}.Q6PinG_planConfirm>span{min-width:140px;color:var(--dsw-alias-label-secondary);flex:1;font-size:9px;line-height:13px}.Q6PinG_planNewTask{align-items:flex-end}.Q6PinG_planNewTask label{gap:4px}.Q6PinG_planNewTask label>span{line-height:13px}.Q6PinG_planApproveRow{z-index:1;border:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 94%, transparent);min-height:50px;box-shadow:0 -5px 16px color-mix(in srgb, var(--dsw-alias-bg-base) 35%, transparent);backdrop-filter:blur(8px);border-radius:8px;flex-direction:column;justify-content:flex-end;align-items:stretch;margin:0 -4px -4px;padding:8px;position:sticky;bottom:0}.Q6PinG_planApproveRow[data-armed=true]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-border-l2))}.Q6PinG_planApproveRow[data-discard=true]{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2))}.Q6PinG_planApproveCopy{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.Q6PinG_planApproveCopy strong{color:var(--dsw-alias-label-primary);font-size:9.5px;line-height:13px}.Q6PinG_planApproveCopy small{color:var(--dsw-alias-label-tertiary);font-size:8.5px;line-height:12px}.Q6PinG_planApproveRow button{background:var(--dsw-alias-state-business-primary);min-height:32px;color:var(--dsw-alias-label-primary-inverted);padding-inline:13px}.Q6PinG_planReviewActions>button[data-plan-approve]{width:100%}.Q6PinG_planApproveActions>button:first-child{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}.Q6PinG_planSecondaryActions>button{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}.Q6PinG_planApproveActions>button[data-danger]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-button-ghost-active-fill)}.Q6PinG_planSecondaryActions>button[data-danger],.Q6PinG_planApproveActions>button[data-danger]{color:var(--dsw-alias-state-error-primary)}.Q6PinG_planSectionToggle:focus-visible,.Q6PinG_planCardHeader:focus-visible,.Q6PinG_planActions button:focus-visible,.Q6PinG_planNewTask button:focus-visible,.Q6PinG_planApproveRow button:focus-visible,.Q6PinG_planConfirm button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.Q6PinG_planActions button:disabled,.Q6PinG_planNewTask button:disabled,.Q6PinG_planApproveRow button:disabled{cursor:default;opacity:.55}.Q6PinG_historicPill{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-tertiary);border-radius:4px;flex:none;margin-left:auto;padding:1px 7px;font-size:9.5px;font-weight:600;line-height:15px}.Q6PinG_members{flex-direction:column;gap:3px;display:flex}.Q6PinG_archiveLabel{color:var(--dsw-alias-label-tertiary);padding:5px 14px 0;font-size:9.5px;font-weight:600;line-height:14px;display:block}@media (prefers-reduced-motion:reduce){.Q6PinG_panel,.Q6PinG_badge,.Q6PinG_badgeDot,.Q6PinG_panelDot,.Q6PinG_workGlyph rect,.Q6PinG_stateArt,.Q6PinG_memberAvatar[data-unread=true]:after,.Q6PinG_planChevron,.Q6PinG_planFeedback,.Q6PinG_planActions button,.Q6PinG_planNewTask button,.Q6PinG_planApproveRow button,.Q6PinG_planConfirm button,.Q6PinG_planCard input,.Q6PinG_planCard textarea,.Q6PinG_planCard select,.Q6PinG_planNewTask input{transition:none;animation:none}}@media (width<=960px){html[data-agent-teams-panel-open] [data-phase=active]{padding-right:0}}@media (width<=640px){.Q6PinG_badge{top:56px;right:10px}.Q6PinG_teamStats span[data-stat=messages]{display:none}.Q6PinG_captainNode{grid-template-columns:48px minmax(0,1fr)}.Q6PinG_captainState{display:none}.Q6PinG_delegationTree{margin-left:12px;padding-left:15px}.Q6PinG_memberBranch{width:15px}.Q6PinG_planFlow li{gap:4px;font-size:8px}.Q6PinG_planFlow li:not(:last-child):after{margin-right:3px}.Q6PinG_planCardHeader{grid-template-columns:auto minmax(0,1fr) auto}.Q6PinG_planCardHeader .Q6PinG_planCardMeta{display:none}.Q6PinG_planGrid,.Q6PinG_planModelPicker{grid-template-columns:minmax(0,1fr)}.Q6PinG_planNewTask,.Q6PinG_planApproveRow{flex-direction:column;align-items:stretch}.Q6PinG_planNewTask button,.Q6PinG_planApproveRow>button,.Q6PinG_planApproveActions,.Q6PinG_planReviewActions{width:100%}.Q6PinG_planApproveActions button,.Q6PinG_planReviewActions button,.Q6PinG_planSecondaryActions button{flex:1}}@container Q6PinG_agent-team (width<=360px){.Q6PinG_planEditor{margin-inline:0;padding-inline:10px}.Q6PinG_planHeader>span{align-items:flex-start}.Q6PinG_planFlow li{gap:3px;font-size:7.5px}.Q6PinG_planFlow li:not(:last-child):after{min-width:4px;margin-right:2px}.Q6PinG_planSecondaryActions,.Q6PinG_planApproveActions{grid-template-columns:minmax(0,1fr);width:100%;display:grid}.Q6PinG_planSecondaryActions button,.Q6PinG_planApproveActions button{width:100%}}.Q6PinG_dagOwner{text-overflow:ellipsis;max-width:64px;margin-left:auto;font-size:9px;font-weight:400;overflow:hidden}.Q6PinG_team[data-workspace-team]{background:0 0;border:0;width:100%;max-width:100%;padding:0;container:none}.Q6PinG_team[data-workspace-team] .Q6PinG_delegationSection,.Q6PinG_team[data-workspace-team] .Q6PinG_dependencySection,.Q6PinG_team[data-workspace-team] .Q6PinG_memberSlot,.Q6PinG_team[data-workspace-team] .Q6PinG_memberBlock{width:100%;max-width:100%}.Q6PinG_team[data-workspace-team] .Q6PinG_teamHead{flex-wrap:wrap;gap:8px;padding-bottom:18px}.Q6PinG_team[data-workspace-team] .Q6PinG_teamName{font-size:15px}.Q6PinG_team[data-workspace-team] .Q6PinG_teamStats{flex-wrap:wrap}.Q6PinG_team[data-workspace-team] .Q6PinG_delegationSection,.Q6PinG_team[data-workspace-team] .Q6PinG_dependencySection{min-width:0}.Q6PinG_team[data-workspace-team] .Q6PinG_dagNodeLabel{white-space:normal;overflow-wrap:break-word;width:100%;min-width:0;line-height:1.4;display:block;overflow:hidden}.Q6PinG_team[data-workspace-team] .Q6PinG_sectionHead{flex-wrap:wrap;gap:6px}.Q6PinG_team[data-workspace-team] .Q6PinG_sectionHint{white-space:normal}.Q6PinG_team[data-workspace-team] .Q6PinG_memberLine{flex-wrap:nowrap}.Q6PinG_team[data-workspace-team] .Q6PinG_memberStatusLine{white-space:nowrap}@container (width<=520px){.Q6PinG_team[data-workspace-team] .Q6PinG_memberRow{grid-template-columns:46px 16px minmax(0,1fr) auto}.Q6PinG_team[data-workspace-team] .Q6PinG_memberStatusTail{width:auto;max-width:72px}.Q6PinG_team[data-workspace-team] .Q6PinG_memberRole,.Q6PinG_team[data-workspace-team] .Q6PinG_memberModel{display:none}.Q6PinG_team[data-workspace-team] .Q6PinG_memberName{flex:auto;min-width:0}}.Q6PinG_team[data-workspace-team] .Q6PinG_memberBlock[data-member-expanded=true] .Q6PinG_memberStatusLine,.Q6PinG_team[data-workspace-team] .Q6PinG_memberSubagentNote,.Q6PinG_team[data-workspace-team] .Q6PinG_memberExpandedRole,.Q6PinG_team[data-workspace-team] .Q6PinG_memberExpandedModel,.Q6PinG_team[data-workspace-team] .Q6PinG_memberExpandedDoing{white-space:normal;width:100%;min-width:0;max-width:100%;text-overflow:unset;overflow-wrap:break-word;display:block;overflow:visible}.Q6PinG_team[data-workspace-team] .Q6PinG_memberSubagents,.Q6PinG_team[data-workspace-team] .Q6PinG_memberSubagentList,.Q6PinG_team[data-workspace-team] .Q6PinG_memberSubagent,.Q6PinG_team[data-workspace-team] .Q6PinG_memberSubagentOpen,.Q6PinG_team[data-workspace-team] .Q6PinG_memberExpandedFacts{width:100%;min-width:0;max-width:100%}.Q6PinG_team[data-workspace-team] .Q6PinG_memberSubagentLabel{white-space:normal;width:auto;min-width:0;max-width:100%;text-overflow:unset;overflow-wrap:break-word;flex:auto;overflow:hidden}.Q6PinG_team[data-workspace-team] .Q6PinG_memberSubagentDoing,.Q6PinG_team[data-workspace-team] .Q6PinG_memberSubagentMode{white-space:nowrap;flex:none;width:auto}.Q6PinG_team[data-workspace-team] .Q6PinG_taskDetail,.Q6PinG_team[data-workspace-team] .Q6PinG_taskDetailHead,.Q6PinG_team[data-workspace-team] .Q6PinG_taskDetailSubject{width:100%;min-width:0;max-width:100%}.Q6PinG_team[data-workspace-team] .Q6PinG_taskDetailSubject{white-space:normal;text-overflow:unset;overflow-wrap:break-word;overflow:visible}.Q6PinG_team[data-workspace-team] .Q6PinG_dagViewport{width:100%;padding-bottom:12px}.Q6PinG_team[data-workspace-team] .Q6PinG_dagNode{border-radius:9px;padding:10px 11px}.Q6PinG_team[data-workspace-team] .Q6PinG_dagNodeHead{margin-bottom:7px;font-size:10px}.Q6PinG_team[data-workspace-team] .Q6PinG_dagNodeLabel{letter-spacing:0;font-size:12px}.Q6PinG_team[data-workspace-team] .Q6PinG_dagOwner{font-size:10px}.Q6PinG_team[data-workspace-team] .Q6PinG_taskDetail{margin-top:14px;padding:14px}.Q6PinG_team[data-workspace-team] .Q6PinG_captainName{font-size:14px}.Q6PinG_team[data-workspace-team] .Q6PinG_captainRole{font-size:11px}.Q6PinG_team[data-workspace-team] .Q6PinG_captainSummary{font-size:12px;line-height:1.6}.Q6PinG_team[data-workspace-team] .Q6PinG_captainState{font-size:11px}.Q6PinG_team[data-workspace-team] .Q6PinG_memberName{font-size:13px}.Q6PinG_team[data-workspace-team] .Q6PinG_memberRole,.Q6PinG_team[data-workspace-team] .Q6PinG_memberCount{font-size:11px}.Q6PinG_team[data-workspace-team] .Q6PinG_memberStatusLine{font-size:12px;line-height:1.6}.Q6PinG_team[data-workspace-team] .Q6PinG_taskDetailSubject{font-size:13px;line-height:1.6}.Q6PinG_team[data-workspace-team] .Q6PinG_taskDetailLine,.Q6PinG_team[data-workspace-team] .Q6PinG_taskDetailMeta{font-size:12px;line-height:1.6}.Q6PinG_team[data-workspace-team] .Q6PinG_captainNode{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-border-l2)}.Q6PinG_team[data-workspace-team] .Q6PinG_planEditor{border-color:var(--dsw-alias-border-l2);background:0 0;margin:0 0 24px;padding:16px}@container (width>=1000px){.Q6PinG_team[data-workspace-team]:has(>[data-staging-editor]){grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.Q6PinG_team[data-workspace-team]>[data-staging-editor]{grid-row:2/4;grid-column:1!important}.Q6PinG_team[data-workspace-team]:has(>[data-staging-editor])>.Q6PinG_delegationSection{grid-area:2/2}.Q6PinG_team[data-workspace-team]:has(>[data-staging-editor])>.Q6PinG_dependencySection{border-left:0;grid-area:3/2;padding:24px 0 0}}.Q6PinG_team[data-workspace-team] .Q6PinG_dagOwner{white-space:nowrap;max-width:105px}.Q6PinG_team[data-workspace-team] .Q6PinG_planApproveRow{position:static}.Q6PinG_memberRow{grid-template-columns:46px 16px minmax(0,1fr) 96px;gap:6px}.Q6PinG_memberDot{box-sizing:border-box;border:2px solid var(--dsw-alias-bg-layer-1);background:var(--dsw-alias-label-tertiary);border-radius:50%;flex:none;justify-content:center;align-items:center;width:16px;height:16px;display:inline-flex}.Q6PinG_memberDot[data-tone=running]{background:var(--dsw-alias-state-business-primary)}.Q6PinG_memberDot[data-tone=stalled]{background:var(--dsw-alias-state-warn-primary)}.Q6PinG_memberDot[data-tone=delivered]{background:var(--dsw-alias-state-success-primary)}.Q6PinG_memberDot[data-tone=idle]{background:var(--dsw-alias-label-tertiary)}.Q6PinG_memberDot[data-tone=dormant]{border-color:var(--dsw-alias-border-l3);background:0 0}.Q6PinG_memberStatusTail{white-space:nowrap;flex:none;justify-content:flex-end;align-items:center;gap:6px;width:96px;display:inline-flex;overflow:hidden}.Q6PinG_dagNode[data-state=converging]{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 52%, var(--dsw-alias-border-l2))}.Q6PinG_dagNode[data-state=converging] .Q6PinG_dagNodeDot{background:var(--dsw-alias-state-warn-primary)}.Q6PinG_dagNode[data-state=unmeasured] .Q6PinG_dagNodeDot{background:var(--dsw-alias-label-tertiary)}.Q6PinG_taskDetailBadge[data-state=converging]{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 42%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-warn-primary)}.Q6PinG_taskDetailBadge[data-state=unmeasured]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-tertiary)}.Q6PinG_memberRoundLine{align-items:center;gap:6px;min-width:0;padding:1px 6px 0 72px;display:flex}.Q6PinG_memberRoundMark{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;font-size:9.5px;line-height:14px}.Q6PinG_memberRoundTone{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none;font-size:9.5px;font-weight:600;line-height:14px}.Q6PinG_memberRoundLine[data-tone=converging] .Q6PinG_memberRoundTone{color:var(--dsw-alias-state-warn-primary)}.Q6PinG_memberRoundLine[data-tone=failed] .Q6PinG_memberRoundTone{color:var(--dsw-alias-state-error-primary)}.Q6PinG_memberRoundLine[data-tone=unmeasured] .Q6PinG_memberRoundTone,.Q6PinG_memberRoundLine[data-tone=cancelled] .Q6PinG_memberRoundTone{color:var(--dsw-alias-label-tertiary)}.Q6PinG_memberRoundLine[data-tone=running] .Q6PinG_memberRoundTone{color:var(--dsw-alias-state-business-primary)}.Q6PinG_memberRoundLine[data-tone=completed] .Q6PinG_memberRoundTone{color:var(--dsw-alias-state-success-primary)}.Q6PinG_memberRoundTasks{flex-wrap:wrap;flex:1;gap:6px;min-width:0;display:flex}.Q6PinG_memberRoundTask{color:var(--dsw-alias-label-secondary);text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;background:0 0;border:0;padding:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;line-height:14px;overflow:hidden}.Q6PinG_memberRoundTask:hover{color:var(--dsw-alias-state-business-primary);text-decoration:underline}.Q6PinG_memberRoundTask[data-tone=converging]{color:var(--dsw-alias-state-warn-primary)}.Q6PinG_memberRoundTask[data-tone=failed]{color:var(--dsw-alias-state-error-primary)}.Q6PinG_memberRoundTask[data-tone=cancelled]{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}.Q6PinG_memberSubagents{flex-direction:column;gap:3px;min-width:0;padding:3px 6px 5px 72px;display:flex}.Q6PinG_memberSubagentList{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.Q6PinG_memberSubagent{grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:6px;min-width:0;display:grid}.Q6PinG_memberSubagentDot{box-sizing:border-box;background:var(--dsw-alias-label-tertiary);border-radius:50%;width:8px;height:8px}.Q6PinG_memberSubagentDot[data-tone=working]{background:var(--dsw-alias-state-business-primary)}.Q6PinG_memberSubagentDot[data-tone=idle]{background:var(--dsw-alias-label-tertiary)}.Q6PinG_memberSubagentDot[data-tone=unknown]{border:1px solid var(--dsw-alias-border-l3);background:0 0}.Q6PinG_memberSubagentOpen{min-width:0;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;align-items:baseline;gap:6px;padding:0;display:flex}.Q6PinG_memberSubagentOpen:hover .Q6PinG_memberSubagentLabel{color:var(--dsw-alias-state-business-primary);text-decoration:underline}.Q6PinG_memberSubagentLabel{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:600;line-height:15px;overflow:hidden}.Q6PinG_memberSubagentDoing{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;font-size:9.5px;line-height:15px}.Q6PinG_memberSubagentMode{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;font-size:9px;line-height:15px}.Q6PinG_memberSubagentNote{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;line-height:15px;display:block;overflow:hidden}.Q6PinG_memberSubagentNote[data-subagent-readout=could-not-measure]{color:var(--dsw-alias-state-warn-primary)}.Q6PinG_memberOpenSession{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;align-self:flex-start;padding:0;font-size:9.5px;line-height:15px;text-decoration:underline}.Q6PinG_memberOpenSession:hover:not(:disabled){color:var(--dsw-alias-state-business-primary)}.Q6PinG_memberOpenSession:disabled{cursor:not-allowed;text-decoration:none}.Q6PinG_memberSlot{min-width:0;display:block}.Q6PinG_teamTerminalNote{color:var(--dsw-alias-label-tertiary);margin:0;padding:2px 10px 4px;font-size:10px;line-height:15px}.Q6PinG_memberGateBand{white-space:nowrap;border-radius:3px;align-items:center;gap:3px;min-width:0;padding:0 4px;font-size:9.5px;line-height:14px;display:inline-flex}.Q6PinG_memberGateMark{flex:none;font-weight:700}.Q6PinG_memberGateText{text-overflow:ellipsis;font-weight:600;overflow:hidden}.Q6PinG_memberGateBand[data-member-gate-tone=absent],.Q6PinG_memberGateBand[data-member-gate-tone=skipped]{color:var(--dsw-alias-label-tertiary)}.Q6PinG_memberGateBand[data-member-gate-tone=ok]{color:var(--dsw-alias-state-success-primary)}.Q6PinG_memberGateBand[data-member-gate-tone=blocked]{color:var(--dsw-alias-state-error-primary)}.Q6PinG_memberGateBand[data-member-gate-tone=unmeasured]{color:var(--dsw-alias-label-secondary)}.Q6PinG_memberGateBand[data-member-gate-tone=observed]{color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-secondary)}.Q6PinG_memberGateList{flex-direction:column;gap:2px;margin:2px 0 0;padding:0 0 0 60px;list-style:none;display:flex}.Q6PinG_memberGateItem{align-items:center;gap:6px;min-width:0;font-size:9.5px;line-height:14px;display:flex}.Q6PinG_memberGateTask{color:var(--dsw-alias-label-accent);font:inherit;cursor:pointer;background:0 0;border:0;flex:none;padding:0;font-weight:600}.Q6PinG_memberGateTask:hover{text-decoration:underline}.Q6PinG_memberGateNote{color:var(--dsw-alias-label-tertiary);white-space:nowrap}.Q6PinG_memberGateEntries{flex-wrap:wrap;gap:4px;min-width:0;display:flex}.Q6PinG_memberGateEntry{font-variant-numeric:tabular-nums;align-items:center;gap:2px;min-width:0;display:inline-flex}.Q6PinG_memberGateEntryMark{flex:none;font-weight:700}.Q6PinG_memberGateEntryId{text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);overflow:hidden}.Q6PinG_memberGateEntry[data-verdict=ok] .Q6PinG_memberGateEntryMark{color:var(--dsw-alias-state-success-primary)}.Q6PinG_memberGateEntry[data-verdict=skipped] .Q6PinG_memberGateEntryMark{color:var(--dsw-alias-label-tertiary)}.Q6PinG_memberGateEntry[data-verdict=blocked] .Q6PinG_memberGateEntryMark{color:var(--dsw-alias-state-error-primary)}.Q6PinG_memberGateEntry[data-verdict=unmeasured] .Q6PinG_memberGateEntryMark{color:var(--dsw-alias-label-secondary)}.Q6PinG_memberGateEntry[data-observed=true]{background:var(--dsw-alias-state-warn-secondary);border-radius:3px;padding:0 3px}.Q6PinG_memberGateEntry[data-observed=true] .Q6PinG_memberGateEntryMark{color:var(--dsw-alias-state-warn-primary)}.Q6PinG_team[data-workspace-team] .Q6PinG_memberRow,.Q6PinG_memberRow{border-radius:0;grid-template-columns:3.5px minmax(0,1fr);align-items:start;gap:1px 8px;min-height:0;padding:5px 0}.Q6PinG_memberRow:hover,.Q6PinG_memberRow[data-activity=working]{background:color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)}.Q6PinG_memberDot{border:0;border-radius:50%;width:3.5px;height:3.5px;margin-top:6px}.Q6PinG_memberLine{flex-wrap:nowrap;align-items:baseline;gap:6px;min-width:0;display:flex}.Q6PinG_memberName{flex:none;font-size:12.5px;font-weight:500}.Q6PinG_memberLine>.Q6PinG_memberStatusLine{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-secondary);text-align:right;flex:0 auto;margin-left:auto;font-size:11.5px;font-weight:400;overflow:hidden}.Q6PinG_memberRow>.Q6PinG_memberInfo>.Q6PinG_memberLine>svg:last-child{flex:none}.Q6PinG_memberStageLine{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:10.5px;font-weight:400;line-height:15px;display:block;overflow:hidden}.Q6PinG_memberInfo{flex-direction:column;gap:1px;min-width:0;display:flex}.Q6PinG_memberBlock{border-bottom:1px solid #2b3036;padding:2px 0}.Q6PinG_memberBlock:last-child{border-bottom:0}.Q6PinG_memberBranch,.Q6PinG_memberBranch:before{display:none}.Q6PinG_memberStageGroup{flex-direction:column;gap:1px;padding:3px 0;display:flex}.Q6PinG_memberStageHead{align-items:baseline;gap:6px;min-width:0;font-size:11px;font-weight:400;display:flex}.Q6PinG_memberStageMark{text-align:center;flex:none;width:11px;font-size:10.5px}.Q6PinG_memberStageName{color:var(--dsw-alias-label-secondary);flex:none}.Q6PinG_memberStageCount{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:0 auto;margin-left:auto;font-size:10px;overflow:hidden}.Q6PinG_memberStageHead[data-stage-state=passed] .Q6PinG_memberStageMark{color:var(--dsw-alias-state-success-primary)}.Q6PinG_memberStageHead[data-stage-state=observed] .Q6PinG_memberStageMark{color:var(--dsw-alias-state-error-primary)}.Q6PinG_memberStageHead[data-stage-state=running] .Q6PinG_memberStageMark{color:var(--dsw-alias-state-business-primary)}.Q6PinG_memberStageHead[data-stage-state=skipped] .Q6PinG_memberStageMark,.Q6PinG_memberStageHead[data-stage-state=registered] .Q6PinG_memberStageMark{color:var(--dsw-alias-label-tertiary)}.Q6PinG_memberStageHead[data-stage-state=pending] .Q6PinG_memberStageMark{color:var(--dsw-alias-border-l3)}.Q6PinG_memberStageRows{flex-direction:column;gap:0;margin:0;padding:0 0 0 17px;list-style:none;display:flex}.Q6PinG_memberStageRow{align-items:baseline;gap:6px;min-width:0;font-size:10.5px;line-height:16px;display:flex}.Q6PinG_memberStageRowMark{text-align:center;flex:none;width:11px}.Q6PinG_memberStageRowId{text-overflow:ellipsis;white-space:nowrap;max-width:42%;color:var(--dsw-alias-label-secondary);flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;overflow:hidden}.Q6PinG_memberStageRowDesc{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;font-weight:400;overflow:hidden}.Q6PinG_memberStageRow[data-gate-state=passed] .Q6PinG_memberStageRowMark{color:var(--dsw-alias-state-success-primary)}.Q6PinG_memberStageRow[data-gate-state=observed] .Q6PinG_memberStageRowMark{color:var(--dsw-alias-state-error-primary)}.Q6PinG_memberStageRow[data-gate-state=running] .Q6PinG_memberStageRowMark{color:var(--dsw-alias-state-business-primary)}.Q6PinG_memberStageRow[data-gate-state=skipped] .Q6PinG_memberStageRowMark{color:var(--dsw-alias-label-tertiary)}.Q6PinG_memberStageRow[data-gate-state=pending] .Q6PinG_memberStageRowMark{color:var(--dsw-alias-border-l3)}.Q6PinG_memberStageRow[data-gate-observing=true] .Q6PinG_memberStageRowId{font-style:italic}.Q6PinG_memberUnread{background:var(--dsw-alias-state-business-primary);border-radius:50%;flex:none;align-self:center;width:4px;height:4px}.Q6PinG_memberStageRow[data-gate-state=registered] .Q6PinG_memberStageRowMark,.Q6PinG_memberStageHead[data-stage-state=registered] .Q6PinG_memberStageMark,.Q6PinG_memberStageSummary[data-gate-block-summary=silent] .Q6PinG_memberStageMark{color:var(--dsw-alias-border-l3)}.Q6PinG_memberStageSummary[data-gate-block-summary=ran] .Q6PinG_memberStageMark{color:var(--dsw-alias-state-success-primary)}.Q6PinG_memberStageBlocks{flex-direction:column;gap:6px;min-width:0;display:flex}.Q6PinG_memberStageSummary{align-items:baseline;gap:6px;min-width:0;padding:2px 0;font-size:10.5px;line-height:15px;display:flex}.Q6PinG_memberStageSummaryText{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-secondary);flex:0 auto;overflow:hidden}.Q6PinG_memberStageSummaryDetail{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:0 auto;overflow:hidden}.Q6PinG_memberStageTasks{align-items:baseline;gap:5px;margin-left:6px;display:inline-flex}.Q6PinG_captainNode{grid-template-columns:minmax(0,1fr) auto}@media (width<=640px){.Q6PinG_captainNode{grid-template-columns:minmax(0,1fr)}}.Q6PinG_memberRoleLine{min-width:0;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex-direction:column;gap:0;font-size:10.5px;font-weight:400;line-height:15px;display:flex}.Q6PinG_memberRoleRow{text-overflow:ellipsis;white-space:nowrap;min-width:0;display:block;overflow:hidden}";
		const tagId$8 = "@nanmicoder/dsh-agent-teams/ActivityPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$8) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId$8;
			tag.textContent = css$8;
			document.head.appendChild(tag);
		}
		var ActivityPanel_module_css_default = {
			"agent-team": "Q6PinG_agent-team",
			"agentTeamsBreathe": "Q6PinG_agentTeamsBreathe",
			"agentTeamsDot": "Q6PinG_agentTeamsDot",
			"agentTeamsFloat": "Q6PinG_agentTeamsFloat",
			"agentTeamsPanelIn": "Q6PinG_agentTeamsPanelIn",
			"agentTeamsPulse": "Q6PinG_agentTeamsPulse",
			"agentTeamsThink": "Q6PinG_agentTeamsThink",
			"agentTeamsUnreadPulse": "Q6PinG_agentTeamsUnreadPulse",
			"archiveLabel": "Q6PinG_archiveLabel",
			"badge": "Q6PinG_badge",
			"badgeCount": "Q6PinG_badgeCount",
			"badgeDot": "Q6PinG_badgeDot",
			"captainAvatar": "Q6PinG_captainAvatar",
			"captainInfo": "Q6PinG_captainInfo",
			"captainLine": "Q6PinG_captainLine",
			"captainName": "Q6PinG_captainName",
			"captainNode": "Q6PinG_captainNode",
			"captainRole": "Q6PinG_captainRole",
			"captainState": "Q6PinG_captainState",
			"captainSummary": "Q6PinG_captainSummary",
			"chevron": "Q6PinG_chevron",
			"dagCanvas": "Q6PinG_dagCanvas",
			"dagEdges": "Q6PinG_dagEdges",
			"dagNode": "Q6PinG_dagNode",
			"dagNodeDot": "Q6PinG_dagNodeDot",
			"dagNodeHead": "Q6PinG_dagNodeHead",
			"dagNodeLabel": "Q6PinG_dagNodeLabel",
			"dagOwner": "Q6PinG_dagOwner",
			"dagRunningState": "Q6PinG_dagRunningState",
			"dagViewport": "Q6PinG_dagViewport",
			"delegationSection": "Q6PinG_delegationSection",
			"delegationTree": "Q6PinG_delegationTree",
			"dependencySection": "Q6PinG_dependencySection",
			"emptyHint": "Q6PinG_emptyHint",
			"historicPill": "Q6PinG_historicPill",
			"iconButton": "Q6PinG_iconButton",
			"leadAvatar": "Q6PinG_leadAvatar",
			"memberArt": "Q6PinG_memberArt",
			"memberAvatar": "Q6PinG_memberAvatar",
			"memberBlock": "Q6PinG_memberBlock",
			"memberBranch": "Q6PinG_memberBranch",
			"memberCount": "Q6PinG_memberCount",
			"memberDot": "Q6PinG_memberDot",
			"memberExpandedDoing": "Q6PinG_memberExpandedDoing",
			"memberExpandedFacts": "Q6PinG_memberExpandedFacts",
			"memberExpandedModel": "Q6PinG_memberExpandedModel",
			"memberExpandedRole": "Q6PinG_memberExpandedRole",
			"memberGateBand": "Q6PinG_memberGateBand",
			"memberGateEntries": "Q6PinG_memberGateEntries",
			"memberGateEntry": "Q6PinG_memberGateEntry",
			"memberGateEntryId": "Q6PinG_memberGateEntryId",
			"memberGateEntryMark": "Q6PinG_memberGateEntryMark",
			"memberGateItem": "Q6PinG_memberGateItem",
			"memberGateList": "Q6PinG_memberGateList",
			"memberGateMark": "Q6PinG_memberGateMark",
			"memberGateNote": "Q6PinG_memberGateNote",
			"memberGateTask": "Q6PinG_memberGateTask",
			"memberGateText": "Q6PinG_memberGateText",
			"memberInfo": "Q6PinG_memberInfo",
			"memberInitial": "Q6PinG_memberInitial",
			"memberLine": "Q6PinG_memberLine",
			"memberModel": "Q6PinG_memberModel",
			"memberName": "Q6PinG_memberName",
			"memberOpenSession": "Q6PinG_memberOpenSession",
			"memberRole": "Q6PinG_memberRole",
			"memberRoleLine": "Q6PinG_memberRoleLine",
			"memberRoleRow": "Q6PinG_memberRoleRow",
			"memberRoundLine": "Q6PinG_memberRoundLine",
			"memberRoundMark": "Q6PinG_memberRoundMark",
			"memberRoundTask": "Q6PinG_memberRoundTask",
			"memberRoundTasks": "Q6PinG_memberRoundTasks",
			"memberRoundTone": "Q6PinG_memberRoundTone",
			"memberRow": "Q6PinG_memberRow",
			"memberSlot": "Q6PinG_memberSlot",
			"memberStageBlocks": "Q6PinG_memberStageBlocks",
			"memberStageCount": "Q6PinG_memberStageCount",
			"memberStageGroup": "Q6PinG_memberStageGroup",
			"memberStageHead": "Q6PinG_memberStageHead",
			"memberStageLine": "Q6PinG_memberStageLine",
			"memberStageMark": "Q6PinG_memberStageMark",
			"memberStageName": "Q6PinG_memberStageName",
			"memberStageRow": "Q6PinG_memberStageRow",
			"memberStageRowDesc": "Q6PinG_memberStageRowDesc",
			"memberStageRowId": "Q6PinG_memberStageRowId",
			"memberStageRowMark": "Q6PinG_memberStageRowMark",
			"memberStageRows": "Q6PinG_memberStageRows",
			"memberStageSummary": "Q6PinG_memberStageSummary",
			"memberStageSummaryDetail": "Q6PinG_memberStageSummaryDetail",
			"memberStageSummaryText": "Q6PinG_memberStageSummaryText",
			"memberStageTasks": "Q6PinG_memberStageTasks",
			"memberStatusLine": "Q6PinG_memberStatusLine",
			"memberStatusTail": "Q6PinG_memberStatusTail",
			"memberSubagent": "Q6PinG_memberSubagent",
			"memberSubagentDoing": "Q6PinG_memberSubagentDoing",
			"memberSubagentDot": "Q6PinG_memberSubagentDot",
			"memberSubagentLabel": "Q6PinG_memberSubagentLabel",
			"memberSubagentList": "Q6PinG_memberSubagentList",
			"memberSubagentMode": "Q6PinG_memberSubagentMode",
			"memberSubagentNote": "Q6PinG_memberSubagentNote",
			"memberSubagentOpen": "Q6PinG_memberSubagentOpen",
			"memberSubagents": "Q6PinG_memberSubagents",
			"memberUnread": "Q6PinG_memberUnread",
			"members": "Q6PinG_members",
			"membersToggle": "Q6PinG_membersToggle",
			"panel": "Q6PinG_panel",
			"panelControls": "Q6PinG_panelControls",
			"panelDot": "Q6PinG_panelDot",
			"panelHead": "Q6PinG_panelHead",
			"panelTitle": "Q6PinG_panelTitle",
			"plan-feedback-in": "Q6PinG_plan-feedback-in",
			"planActions": "Q6PinG_planActions",
			"planApproveActions": "Q6PinG_planApproveActions",
			"planApproveCopy": "Q6PinG_planApproveCopy",
			"planApproveRow": "Q6PinG_planApproveRow",
			"planCard": "Q6PinG_planCard",
			"planCardBody": "Q6PinG_planCardBody",
			"planCardHeader": "Q6PinG_planCardHeader",
			"planCardIdentity": "Q6PinG_planCardIdentity",
			"planCardMeta": "Q6PinG_planCardMeta",
			"planChevron": "Q6PinG_planChevron",
			"planConfirm": "Q6PinG_planConfirm",
			"planDirty": "Q6PinG_planDirty",
			"planEditor": "Q6PinG_planEditor",
			"planEmpty": "Q6PinG_planEmpty",
			"planFeedback": "Q6PinG_planFeedback",
			"planFlow": "Q6PinG_planFlow",
			"planGrid": "Q6PinG_planGrid",
			"planHeader": "Q6PinG_planHeader",
			"planList": "Q6PinG_planList",
			"planModelEffortRow": "Q6PinG_planModelEffortRow",
			"planModelHint": "Q6PinG_planModelHint",
			"planModelMenu": "Q6PinG_planModelMenu",
			"planModelMenuBack": "Q6PinG_planModelMenuBack",
			"planModelMenuRow": "Q6PinG_planModelMenuRow",
			"planModelNotice": "Q6PinG_planModelNotice",
			"planModelPicker": "Q6PinG_planModelPicker",
			"planModelTrigger": "Q6PinG_planModelTrigger",
			"planModelTriggerCopy": "Q6PinG_planModelTriggerCopy",
			"planNewTask": "Q6PinG_planNewTask",
			"planReviewActions": "Q6PinG_planReviewActions",
			"planSecondaryActions": "Q6PinG_planSecondaryActions",
			"planSection": "Q6PinG_planSection",
			"planSectionToggle": "Q6PinG_planSectionToggle",
			"planTaskId": "Q6PinG_planTaskId",
			"planTaskSummary": "Q6PinG_planTaskSummary",
			"resizeHandle": "Q6PinG_resizeHandle",
			"sectionHead": "Q6PinG_sectionHead",
			"sectionHint": "Q6PinG_sectionHint",
			"sectionToggleTitle": "Q6PinG_sectionToggleTitle",
			"stateArt": "Q6PinG_stateArt",
			"stopModalActions": "Q6PinG_stopModalActions",
			"stopModalError": "Q6PinG_stopModalError",
			"taskDetail": "Q6PinG_taskDetail",
			"taskDetailBadge": "Q6PinG_taskDetailBadge",
			"taskDetailHead": "Q6PinG_taskDetailHead",
			"taskDetailId": "Q6PinG_taskDetailId",
			"taskDetailLine": "Q6PinG_taskDetailLine",
			"taskDetailMeta": "Q6PinG_taskDetailMeta",
			"taskDetailModel": "Q6PinG_taskDetailModel",
			"taskDetailSubject": "Q6PinG_taskDetailSubject",
			"team": "Q6PinG_team",
			"teamHead": "Q6PinG_teamHead",
			"teamName": "Q6PinG_teamName",
			"teamStats": "Q6PinG_teamStats",
			"teamStopButton": "Q6PinG_teamStopButton",
			"teamTerminalNote": "Q6PinG_teamTerminalNote",
			"teams": "Q6PinG_teams",
			"workGlyph": "Q6PinG_workGlyph"
		};
		//#endregion
		//#region lib/client/DependencyGraph.js
		/**
		* Screen two: the task dependency graph, and nothing else.
		*
		* ── ★★★ R3：这是**纯搬运** + 一次**减法**（用户原话）─────────────────────────────
		*
		*   · "screen two probably only needs to keep the dependency graph"
		*   · "the dependency graph can stay collapsed by default, because most of the
		*      time you do not want to look at that thing"
		*   · 「整个东西挺冗余的，比如它做一些 badge 之类的东西」
		*
		* ⇒ 这个文件只做两件事：**装下那张图**，以及**默认把它收起来**。
		*   搬过来的每一行、每一个 `data-*` 探针、每一句文案都原样保留 ——
		*   于是"搬丢了什么"可以被**集合比对**抓住（见 workspace-activity.test.mjs 的 R3 符号臂）。
		*
		* ★ 收起是一个**值**（`useState(false)`），不是一条缺席分支：一次新渲染不可能
		*   顺手把它打开。展开后的悬停/键盘行为、`Escape` 取消固定、`aria-expanded` 全部照旧。
		* @module dsh-agent-teams/client/dependency-graph
		*/
		/**
		* Disclosure chevron — the ONE definition, shared with the panel.
		*
		* ★ 它原来长在 `ActivityPanel.tsx` 里；R3 把图搬出来之后，两边都要它。
		*   放在这里并导出，于是**只有一份**（抄一份就是同一件事的第二个实现）。
		*/
		function Chevron({ open }) {
			return (0, react_jsx_runtime.jsx)("svg", {
				className: ActivityPanel_module_css_default.chevron,
				"data-open": open,
				width: "9",
				height: "9",
				viewBox: "0 0 10 10",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				"aria-hidden": true,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M3.5 2l3 3-3 3" })
			});
		}
		/** Animated "this task is running" glyph — likewise the ONE definition. */
		function WorkGlyph({ active }) {
			return (0, react_jsx_runtime.jsx)("svg", {
				className: ActivityPanel_module_css_default.workGlyph,
				"data-active": active,
				width: "11",
				height: "11",
				viewBox: "0 0 11 11",
				fill: "currentColor",
				"aria-hidden": true,
				children: [
					[0, 0],
					[4.2, 0],
					[8.4, 0],
					[0, 4.2],
					[4.2, 4.2],
					[8.4, 4.2]
				].map(([x, y], index) => (0, react_jsx_runtime.jsx)("rect", {
					x,
					y,
					width: "2.6",
					height: "2.6",
					rx: ".6",
					style: { animationDelay: `${index * .15}s` }
				}, `${x}:${y}`))
			});
		}
		function DependencyGraph({ tasks, members, t, discarded = false, workspace = false, onSelectTask }) {
			/**
			* ── ★★★ R3：**默认收起**（用户原话）───────────────────────────────────────────
			*
			*   "the dependency graph can stay collapsed by default, because most of the
			*    time you do not want to look at that thing"
			*
			* ★ 收起是一个**值**（`false`），不是一条缺席分支 —— 一次新渲染不可能顺手
			*   把它打开。用户按下标题行之后才展开（`aria-expanded` 如实反映）。
			* ★ 而"收起"**不等于**"看不见"：标题行上的 `dependency.hint.*` 仍然说明
			*   这一屏有什么（悬停高亮/点击固定），所以收起态本身也是一个读数。
			*/
			const [open, setOpen] = (0, react.useState)(false);
			const [hoverTaskId, setHoverTaskId] = (0, react.useState)(null);
			const [keyboardTaskId, setKeyboardTaskId] = (0, react.useState)(null);
			const [pinnedTaskId, setPinnedTaskId] = (0, react.useState)(null);
			const hoverTimer = (0, react.useRef)(null);
			const focusedTaskId = dependencyFocusTaskId(pinnedTaskId, keyboardTaskId, hoverTaskId);
			const nodeWidth = workspace ? 164 : 92;
			const nodeHeight = workspace ? 76 : 30;
			const layout = (0, react.useMemo)(() => compactDagLayout(tasks, workspace ? {
				nodeWidth: 164,
				nodeHeight: 76,
				columnGap: 36,
				rowGap: 16
			} : void 0), [tasks, workspace]);
			const parallel = (0, react.useMemo)(() => usesParallelTaskGrid(tasks), [tasks]);
			const related = (0, react.useMemo)(() => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks), [focusedTaskId, tasks]);
			const scheduleHover = (id) => {
				if (hoverTimer.current !== null) {
					clearTimeout(hoverTimer.current);
					hoverTimer.current = null;
				}
				if (id === null) {
					setHoverTaskId(null);
					return;
				}
				hoverTimer.current = setTimeout(() => {
					hoverTimer.current = null;
					setHoverTaskId(id);
				}, 180);
			};
			(0, react.useEffect)(() => () => {
				if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
			}, []);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						setPinnedTaskId(null);
						onSelectTask?.(null);
					}
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [onSelectTask]);
			/**
			* ── ★★★ R3：**没有依赖结构就不画图**（空队 / 单任务 / 全是孤立任务）────────────
			*
			* MEASURED（本臂立之前实测到的形状）：一张"零条边"的图会被渲染成一个
			* **完整但空的画布** —— `dagViewport` + `dagCanvas` 都在 DOM 里，只是里面
			* 没有连线。而它与"这里真的有个依赖关系图"在读者眼里**同形**：
			* 一块占了位置却什么都没说的方块。
			*
			* ★ 判据不是"任务数 ≤ 1"，而是**有没有边**：`layout.edges.length === 0`。
			*   于是：
			*   · 0 个任务          ⇒ 不画（空队没有图可看）
			*   · 1 个任务          ⇒ 不画（一张只有节点的"图"不是依赖关系）
			*   · N 个孤立任务      ⇒ 不画（并行任务没有依赖，`usesParallelTaskGrid` 也说它没有）
			*   · 有任何一条边      ⇒ 画（这才是这一屏存在的原因）
			*
			* ★ 而"没有图可画"**不是**"这一屏坏了"：标题行仍然在（收起态也一样在），
			*   它如实说明这一队此刻没有依赖结构。所以这是一个**读数**，不是一块空白。
			*/
			const hasDependencyEdges = layout.edges.length > 0;
			if (tasks.length === 0 || !hasDependencyEdges) return (0, react_jsx_runtime.jsx)("section", {
				className: ActivityPanel_module_css_default.dependencySection,
				"aria-label": t("dependency.aria"),
				"data-dependency-map": true,
				"data-dependency-state": "no-structure",
				children: (0, react_jsx_runtime.jsxs)("header", {
					className: ActivityPanel_module_css_default.sectionHead,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.sectionToggleTitle,
						"data-dependency-empty-title": true,
						children: t("dependency.title")
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.sectionHint,
						children: t("dependency.hint.noStructure")
					})]
				})
			});
			const fallbackTask = tasks.find((task) => task.state === "blocked") ?? tasks.find((task) => task.state === "running") ?? tasks[0];
			const detailTask = tasks.find((task) => task.id === focusedTaskId) ?? fallbackTask;
			const detailModel = taskModelLabel(detailTask, members);
			const waitingOn = detailTask.dependencies.filter((dependency) => tasks.find((task) => task.id === dependency)?.status !== "completed");
			const dependents = tasks.filter((task) => task.dependencies.includes(detailTask.id));
			return (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.dependencySection,
				"aria-label": t("dependency.aria"),
				"data-dependency-map": true,
				children: [(0, react_jsx_runtime.jsxs)("header", {
					className: ActivityPanel_module_css_default.sectionHead,
					children: [(0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ActivityPanel_module_css_default.sectionToggleTitle,
						onClick: () => {
							setOpen((current) => !current);
						},
						"aria-expanded": open,
						children: [
							(0, react_jsx_runtime.jsx)(Chevron, { open }),
							(0, react_jsx_runtime.jsx)(IconBranchOutline16, {}),
							" ",
							t(parallel ? "dependency.parallel" : "dependency.title")
						]
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.sectionHint,
						children: pinnedTaskId === null ? t(parallel ? "dependency.hint.parallel" : workspace ? "workspace.dependencies" : "dependency.hint.chain") : t("dependency.hint.pinned", { taskId: pinnedTaskId })
					})]
				}), open && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("div", {
					className: ActivityPanel_module_css_default.dagViewport,
					children: (0, react_jsx_runtime.jsxs)("div", {
						className: ActivityPanel_module_css_default.dagCanvas,
						"data-layout": parallel ? "parallel" : "dependency",
						style: parallel ? void 0 : {
							width: layout.width,
							height: layout.height
						},
						children: [!parallel && (0, react_jsx_runtime.jsx)("svg", {
							className: ActivityPanel_module_css_default.dagEdges,
							width: layout.width,
							height: layout.height,
							"aria-hidden": true,
							children: layout.edges.map((edge) => {
								const active = related !== null && related.has(edge.from) && related.has(edge.to);
								return (0, react_jsx_runtime.jsx)("path", {
									d: edge.path,
									"data-active": active,
									"data-dimmed": related !== null && !active
								}, `${edge.from}:${edge.to}`);
							})
						}), layout.nodes.map(({ task, x, y }) => {
							const model = taskModelLabel(task, members);
							return (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.dagNode,
								style: parallel ? { height: nodeHeight } : {
									left: x,
									top: y,
									width: nodeWidth,
									height: nodeHeight
								},
								"data-task-id": task.id,
								"data-state": discarded ? "cancelled" : taskTerminalTone(task),
								"data-task-model": model || void 0,
								"data-focused": related?.has(task.id) ?? false,
								"data-dimmed": related !== null && !related.has(task.id),
								"aria-pressed": pinnedTaskId === task.id,
								title: taskTitle(task, model),
								onClick: () => {
									const next = pinnedTaskId === task.id ? null : task.id;
									setPinnedTaskId(next);
									onSelectTask?.(next);
								},
								onMouseEnter: () => {
									scheduleHover(task.id);
								},
								onMouseLeave: () => {
									scheduleHover(null);
								},
								onFocus: () => {
									setKeyboardTaskId(task.id);
								},
								onBlur: () => {
									setKeyboardTaskId(null);
								},
								children: [
									(0, react_jsx_runtime.jsxs)("span", {
										className: ActivityPanel_module_css_default.dagNodeHead,
										children: [
											(0, react_jsx_runtime.jsx)("span", { className: ActivityPanel_module_css_default.dagNodeDot }),
											task.id,
											workspace && (0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.dagOwner,
												children: task.assignee || t("task.assignee.unclaimed")
											})
										]
									}),
									(0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.dagNodeLabel,
										children: workspace ? task.subject : compactTaskLabel(task.subject)
									}),
									task.state === "running" && (0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.dagRunningState,
										"aria-label": t("task.runningAria"),
										children: (0, react_jsx_runtime.jsx)(WorkGlyph, { active: true })
									})
								]
							}, task.id);
						})]
					})
				}), (0, react_jsx_runtime.jsxs)("section", {
					className: ActivityPanel_module_css_default.taskDetail,
					"data-task-detail": detailTask.id,
					children: [
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.taskDetailHead,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.taskDetailId,
									children: detailTask.id
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.taskDetailSubject,
									title: detailTask.subject,
									children: detailTask.subject.replace(/^开发\s*/u, "")
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.taskDetailBadge,
									"data-state": discarded ? "cancelled" : taskTerminalTone(detailTask),
									children: discarded ? t("task.status.notRun") : taskStatusLabel(detailTask.status, t)
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.taskDetailLine,
							children: [
								detailTask.assignee || t("task.assignee.unclaimed"),
								" · ",
								discarded ? t("task.detail.notRun") : detailTask.status === "completed" ? t("task.detail.completed") : detailTask.status === "cancelled" ? t("task.detail.cancelled") : detailTask.status === "failed" ? t("task.detail.failed") : detailTask.dependencies.length === 0 ? t("task.detail.noPrerequisite") : waitingOn.length === 0 ? t("task.detail.ready") : t("task.detail.waitingOn", { tasks: formatTaskIds(waitingOn, t) })
							]
						}),
						detailModel !== "" && (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailModel,
							"data-task-model": detailModel,
							children: t("task.model", { model: detailModel })
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskDetailMeta,
							children: dependents.length === 0 ? t("task.detail.noDownstream") : t("task.detail.unlocks", { tasks: formatTaskIds(dependents.map((task) => task.id), t) })
						})
					]
				})] })]
			});
		}
		//#endregion
		//#region lib/client/CaptainNode.js
		/**
		* The captain row: who is coordinating, and what it is doing right now.
		*
		* ── ★★★ R4：这是从 `ActivityPanel.tsx` 里**整块搬出来**的（纯搬运）──────────────
		*
		* 它原来长在 `TeamSection` 的返回体里（`css.captainNode` 那一块）。搬出来是因为
		* 成员屏需要它，而成员屏现在有自己的模块 —— 留在面板里会让"这一屏由谁组成"
		* 只能靠读一个 1171 行的文件回答。
		*
		* ★ 每一行、每一个 `data-*` 探针、每一句文案都原样保留：搬动不得改变渲染结果。
		*   `scripts/workspace-activity.test.mjs` 的 R4 集合臂会把这一点**机械地**核一遍。
		* @module dsh-agent-teams/client/captain-node
		*/
		/**
		* ★ t80：`LEAD_ART` 的 import 已删 —— 本组件不再显示队长头像。
		*   ★ **资源仍在** `artwork.ts` 里（`verify.mjs:311` 的打包契约钉着它）。
		*/
		/**
		* Render the captain row.
		*
		* ★ 文案的分支顺序**原样保留**：discarded > captainBusy > staged > 默认。
		*   重排它会让两张不同的读数在某些输入上换位 —— 而那正是"搬动改了行为"。
		* ★ t80：头像那一格已按用户裁定去掉（见返回体里的注释）；其余逐行未动。
		*/
		function CaptainNode({ discarded, captainBusy, busyCount, allCompleted, allSettled, staged, awaitingFeedback, assignedCount, captainTaskIds, taskCount, memberCount, t }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ActivityPanel_module_css_default.captainNode,
				children: [(0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.captainInfo,
					children: [(0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.captainLine,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.captainName,
							children: t("captain.name")
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.captainRole,
							children: t("captain.role")
						})]
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.captainSummary,
						children: discarded ? t("captain.summary.discarded", {
							tasks: taskCount,
							members: memberCount
						}) : captainBusy ? t("captain.summary.withTakeover", {
							tasks: assignedCount,
							captainTasks: captainTaskIds
						}) : staged ? t(awaitingFeedback ? "captain.summary.awaitingFeedback" : "captain.summary.staged", {
							tasks: taskCount,
							members: memberCount
						}) : t("captain.summary", {
							tasks: assignedCount,
							members: memberCount
						})
					})]
				}), (0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.captainState,
					"data-busy": captainBusy || busyCount > 0,
					children: [(0, react_jsx_runtime.jsx)(WorkGlyph, { active: captainBusy || busyCount > 0 }), discarded ? t("captain.state.discarded") : captainBusy ? t("captain.state.takeover", { tasks: captainTaskIds }) : staged ? t(awaitingFeedback ? "captain.state.awaitingFeedback" : "captain.state.staged") : busyCount > 0 ? t("captain.state.working", { count: busyCount }) : t(allCompleted ? "captain.state.collected" : allSettled ? "captain.state.settled" : "captain.state.waiting")]
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/abab/Desktop/agent-teams-dev/src/client/MemberClock.module.css.mjs
		const css$7 = ".wA8Yjq_memberClock{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;line-height:16px}.wA8Yjq_memberClock[data-kind=stale]{color:var(--dsw-alias-state-warn-primary)}";
		const tagId$7 = "@nanmicoder/dsh-agent-teams/MemberClock.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$7) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId$7;
			tag.textContent = css$7;
			document.head.appendChild(tag);
		}
		var MemberClock_module_css_default = { "memberClock": "wA8Yjq_memberClock" };
		//#endregion
		//#region lib/client/MemberClock.js
		/**
		* One member's elapsed readout — and the ONLY thing that owns its timer.
		*
		* ── ★★★ Why this is its own component (MEASURED, R2 开工时) ────────────────────
		*
		* 秒表原本长在 1599 行的面板里（`useElapsedNow` 挂在 `TeamSection` 上）：
		* 它一 tick，`TeamSection` 连同**整棵面板树**重渲染。而它每秒都在跑，哪怕
		* 队里只有一个人在动。
		*
		* ★ 契约的原话是"the per-second timer lives inside a small component that owns
		*   only the elapsed text, so a tick re-renders that component and not the panel
		*   tree"，而且它是一条**可测**的要求。
		*
		* ⇒ 修法就是这个文件：把 `useState(now)` 与 `setInterval` 都关在这里，
		*   对外只交出一行字。父组件**不持有** `now`，所以它没有任何理由跟着 tick 重渲染。
		*
		* ★ 而"关在这里"还不够：一个每秒 setState 的组件会重渲染它**自己**的子树，
		*   所以这一格必须尽量小（一行 span），并且只在**真的在跑**时才起表
		*   （见 `memberClockTicks`）。
		*
		* ★ 第三种读数必须不同形：读不出时长时，这一格印"时间未知"，**不是空白**。
		*   用户实测过空白格："Integrator 前面是一个空白的显示，这说明显示就不对。"
		* @module dsh-agent-teams/client/member-clock
		*/
		/**
		* Per-second tick, in milliseconds.
		*
		* ★ Exported so the isolation arm drives the SAME cadence the browser uses
		*   instead of guessing a number that could drift from this one.
		*/
		const MEMBER_CLOCK_TICK_MS = 1e3;
		/**
		* The observation instant, ticking only while `active`.
		*
		* ★ `active` is derived from the readout (`memberClockTicks`), and the effect
		*   tears the interval down the moment it goes false — "an idle or waiting
		*   member does not keep a timer alive" is therefore a property of the effect,
		*   not of a comment.
		* ★ `frozenNow` replaces the ticking instant entirely (and creates no interval),
		*   so a fixture can render a determinate number.
		* @param active - whether this readout actually needs a live clock.
		* @param frozenNow - a caller-supplied instant that replaces the ticking one.
		* @returns the instant this readout should be measured against.
		*/
		function useMemberClockNow(active, frozenNow) {
			const [now, setNow] = (0, react.useState)(() => frozenNow ?? Date.now());
			(0, react.useEffect)(() => {
				if (!active || frozenNow !== void 0) return;
				const timer = setInterval(() => {
					setNow(Date.now());
				}, MEMBER_CLOCK_TICK_MS);
				return () => {
					clearInterval(timer);
				};
			}, [active, frozenNow]);
			return frozenNow ?? now;
		}
		/**
		* Render-facing copy for one elapsed readout.
		*
		* ★ Split out of the component so the four readings are asserted as *strings*
		*   rather than by reading CSS: a blank cell was the reported defect, and a
		*   blank is exactly what a missing branch produces.
		* ★ Every branch returns a non-empty string by construction — the fallthrough is
		*   the `running` copy, not `''`.
		* @param clock - the member's elapsed readout.
		* @param t - locale lookup.
		* @returns the line to print; never the empty string.
		*/
		function memberClockText(clock, t) {
			if (clock.kind === "idle") return t("member.clock.idle");
			if (clock.kind === "unknown") return t("member.clock.unknown");
			const elapsed = formatElapsed(clock.ms);
			return clock.kind === "stale" ? t("member.clock.waiting", { elapsed }) : t("member.clock.working", { elapsed });
		}
		/**
		* One member's elapsed state: `worked N` / `waiting N` / `idle` / `unknown`.
		*
		* ★ This component owns the timer and NOTHING else: exactly one `<span>` goes
		*   out, and no other fact about the row passes through here.
		*
		* ★ `stamp` is the member's durable `updatedAt`, and the duration is recomputed
		*   from it against the ticking instant *inside this component*. That is why a
		*   tick cannot require a parent render: the parent's props never change.
		* @param props.kind - the readout's meaning (running / stale / idle / unknown).
		* @param props.stamp - durable last-write stamp, present for running/stale.
		* @param props.active - when false, no timer is created at all.
		* @param props.frozenNow - a fixed instant for deterministic rendering.
		*/
		function MemberClock({ kind, stamp, active, frozenNow, t }) {
			const ticks = active ?? memberClockTicks(kind);
			const now = useMemberClockNow(ticks, frozenNow);
			/**
			* ★ The duration is derived HERE, from the durable stamp and the ticking
			*   instant, so `now` never becomes a prop of the row or of the panel.
			*/
			const clock = kind === "idle" || kind === "unknown" || stamp === void 0 ? {
				kind,
				ms: 0
			} : {
				kind,
				ms: Math.max(0, now - stamp)
			};
			return (0, react_jsx_runtime.jsx)("span", {
				className: MemberClock_module_css_default.memberClock,
				"data-kind": kind,
				"data-ticks": ticks ? "true" : "false",
				title: memberClockText(clock, t),
				children: memberClockText(clock, t)
			});
		}
		//#endregion
		//#region lib/client/StagingPlanEditor.js
		/**
		* Editable pre-run roster and DAG review for staged AgentTeams plans.
		*
		* This leaf owns only transient form/disclosure state. Durable truth remains
		* on the host and returns through the ordinary activity polling snapshot.
		* @module dsh-agent-teams/client/staging-plan
		*/
		const PLAN_URL = "/plugins/dsh-agent-teams/plan";
		/**
		* t16: styles for the member model field. ★ Inline rather than a CSS module
		*   because no stylesheet is inside this task's scope; the colours still come
		*   only from host --dsw-alias-* tokens, so the host theme (incl. dark mode)
		*   keeps applying and no second palette is introduced.
		*/
		const FIELD_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			minWidth: 0,
			flexWrap: "wrap"
		};
		/** ★ Sealed member: shown inert, and the `title` carries the reason. */
		const LOCKED_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			minWidth: 0,
			opacity: .55,
			cursor: "not-allowed"
		};
		const FEEDBACK_BASE = {
			overflow: "hidden",
			fontSize: "9.5px",
			lineHeight: "14px",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const SUCCESS_STYLE = {
			...FEEDBACK_BASE,
			color: "var(--dsw-alias-state-success-primary)"
		};
		const ERROR_STYLE = {
			...FEEDBACK_BASE,
			color: "var(--dsw-alias-state-error-primary)"
		};
		function useDismissSuccess(feedback, setFeedback) {
			(0, react.useEffect)(() => {
				if (feedback?.tone !== "success") return;
				const timeout = window.setTimeout(() => {
					setFeedback(void 0);
				}, 3500);
				return () => {
					window.clearTimeout(timeout);
				};
			}, [feedback, setFeedback]);
		}
		async function mutatePlan(payload) {
			const response = await fetch(PLAN_URL, {
				method: "POST",
				cache: "no-store",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			if (response.ok) return;
			let message = `HTTP ${response.status}`;
			try {
				const body = await response.json();
				if (typeof body.error === "string" && body.error.trim() !== "") message = body.error;
			} catch {}
			throw new Error(message);
		}
		function errorMessage(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function DisclosureChevron({ open }) {
			return (0, react_jsx_runtime.jsx)("svg", {
				className: ActivityPanel_module_css_default.planChevron,
				"data-open": open,
				width: "12",
				height: "12",
				viewBox: "0 0 12 12",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				"aria-hidden": true,
				children: (0, react_jsx_runtime.jsx)("path", { d: "M4 2.5 7.5 6 4 9.5" })
			});
		}
		function Feedback({ value }) {
			if (value === void 0) return null;
			return (0, react_jsx_runtime.jsxs)("span", {
				className: ActivityPanel_module_css_default.planFeedback,
				"data-tone": value.tone,
				role: value.tone === "error" ? "alert" : "status",
				"aria-live": value.tone === "error" ? "assertive" : "polite",
				children: [(0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": true,
					children: value.tone === "success" ? (0, react_jsx_runtime.jsx)("svg", {
						viewBox: "0 0 12 12",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.8",
						children: (0, react_jsx_runtime.jsx)("path", { d: "m2.5 6.2 2.2 2.2 4.8-5" })
					}) : (0, react_jsx_runtime.jsx)("svg", {
						viewBox: "0 0 12 12",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.8",
						children: (0, react_jsx_runtime.jsx)("path", { d: "M6 2.3v4.1M6 8.8v.1" })
					})
				}), value.message]
			});
		}
		function routeKey(provider, model) {
			return JSON.stringify([provider, model]);
		}
		const MODEL_MENU_OPEN_MODELS = "open:models";
		const MODEL_MENU_OPEN_EFFORT = "open:effort";
		const MODEL_MENU_BACK = "navigate:back";
		const MODEL_MENU_RETRY = "action:retry";
		const MODEL_MENU_DEFAULT_EFFORT = "effort:default";
		function modelMenuId(provider, model) {
			return `model:${routeKey(provider, model)}`;
		}
		function effortMenuId(effort) {
			return `effort:${effort}`;
		}
		/**
		* Thin staged-plan adapter over the official model directory. It deliberately
		* reads only catalog metadata: choosing a member route must not change the
		* captain session's composer model.
		*/
		function StagedModelPicker({ directory, provider, model, reasoningEffort, busy, onChange, t }) {
			const state = (0, react.useSyncExternalStore)(directory.store.subscribe, directory.store.getSnapshot);
			const [open, setOpen] = (0, react.useState)(false);
			const [pane, setPane] = (0, react.useState)("root");
			const catalogRoutes = state.groups.flatMap((group) => group.models.map((candidate) => ({
				key: routeKey(group.id, candidate.id),
				provider: group.id,
				providerName: group.name,
				model: candidate
			})));
			const selectedKey = routeKey(provider, model);
			const selected = catalogRoutes.find((candidate) => candidate.key === selectedKey);
			const efforts = selected?.model.reasoning?.efforts ?? [];
			const currentMissing = provider !== "" && model !== "" && selected === void 0;
			const defaultEffort = selected?.model.reasoning?.defaultEffort;
			const effectiveEffort = reasoningEffort === "" || reasoningEffort === "default" ? defaultEffort : reasoningEffort;
			const selectedEffort = efforts.find((effort) => effort.id === effectiveEffort);
			const modelLabel = selected?.model.name ?? (model === "" ? t("plan.model.choose") : model);
			const effortLabel = selectedEffort?.name ?? (effectiveEffort === void 0 ? t("plan.model.providerDefault") : effectiveEffort);
			const unavailable = state.status === "error" || state.failures.length > 0;
			const close = () => {
				setOpen(false);
				setPane("root");
			};
			const rootItems = [{
				id: MODEL_MENU_OPEN_MODELS,
				label: (0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.planModelMenuRow,
					children: [
						(0, react_jsx_runtime.jsx)("span", { children: t("plan.member.model") }),
						(0, react_jsx_runtime.jsx)("strong", { children: modelLabel }),
						(0, react_jsx_runtime.jsx)(DisclosureChevron, { open: false })
					]
				}),
				disabled: state.status === "loading" && catalogRoutes.length === 0
			}, {
				id: MODEL_MENU_OPEN_EFFORT,
				label: (0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.planModelMenuRow,
					children: [
						(0, react_jsx_runtime.jsx)("span", { children: t("plan.member.reasoning") }),
						(0, react_jsx_runtime.jsx)("strong", { children: effortLabel }),
						(0, react_jsx_runtime.jsx)(DisclosureChevron, { open: false })
					]
				}),
				disabled: selected?.model.reasoning === void 0
			}];
			const modelItems = [{
				id: MODEL_MENU_BACK,
				label: (0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.planModelMenuBack,
					children: [(0, react_jsx_runtime.jsx)(DisclosureChevron, { open: false }), t("plan.model.back")]
				})
			}, {
				type: "separator",
				id: "models:separator"
			}];
			if (catalogRoutes.length === 0) modelItems.push({
				id: "models:empty",
				label: state.status === "loading" ? t("plan.model.loading") : t("plan.model.empty"),
				disabled: true
			});
			else for (const group of state.groups) {
				modelItems.push({
					type: "label",
					id: `provider:${group.id}`,
					text: group.name
				});
				for (const candidate of group.models) modelItems.push({
					id: modelMenuId(group.id, candidate.id),
					label: candidate.name
				});
			}
			const effortItems = [
				{
					id: MODEL_MENU_BACK,
					label: (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.planModelMenuBack,
						children: [(0, react_jsx_runtime.jsx)(DisclosureChevron, { open: false }), t("plan.model.back")]
					})
				},
				{
					type: "separator",
					id: "effort:separator"
				},
				{
					id: MODEL_MENU_DEFAULT_EFFORT,
					label: defaultEffort === void 0 ? t("plan.model.providerDefault") : t("plan.model.modelDefault", { effort: efforts.find((effort) => effort.id === defaultEffort)?.name ?? defaultEffort })
				},
				...efforts.map((effort) => ({
					id: effortMenuId(effort.id),
					label: (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.planModelEffortRow,
						children: [(0, react_jsx_runtime.jsx)("span", { children: effort.name }), effort.description !== void 0 && (0, react_jsx_runtime.jsx)("small", { children: effort.description })]
					})
				}))
			];
			const items = pane === "models" ? modelItems : pane === "effort" ? effortItems : rootItems;
			const selectedId = pane === "models" ? modelMenuId(provider, model) : pane === "effort" ? reasoningEffort === "" || reasoningEffort === "default" ? MODEL_MENU_DEFAULT_EFFORT : effortMenuId(reasoningEffort) : void 0;
			const choose = (id) => {
				if (id === MODEL_MENU_OPEN_MODELS) {
					setPane("models");
					return;
				}
				if (id === MODEL_MENU_OPEN_EFFORT) {
					setPane("effort");
					return;
				}
				if (id === MODEL_MENU_BACK) {
					setPane("root");
					return;
				}
				if (id === MODEL_MENU_RETRY) {
					directory.load().catch(() => void 0);
					return;
				}
				const nextModel = catalogRoutes.find((candidate) => modelMenuId(candidate.provider, candidate.model.id) === id);
				if (nextModel !== void 0) {
					close();
					if (nextModel.provider === provider && nextModel.model.id === model) return;
					onChange({
						provider: nextModel.provider,
						model: nextModel.model.id,
						reasoningEffort: "default"
					});
					return;
				}
				if (id === MODEL_MENU_DEFAULT_EFFORT) {
					close();
					if (effectiveEffort === defaultEffort) return;
					onChange({
						provider,
						model,
						reasoningEffort: "default"
					});
					return;
				}
				const nextEffort = efforts.find((effort) => effortMenuId(effort.id) === id);
				if (nextEffort === void 0) return;
				close();
				if (nextEffort.id === reasoningEffort) return;
				onChange({
					provider,
					model,
					reasoningEffort: nextEffort.id
				});
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ActivityPanel_module_css_default.planModelPicker,
				"data-model-directory-status": state.status,
				children: [
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
						open,
						portal: true,
						align: "end",
						compact: true,
						className: ActivityPanel_module_css_default.planModelMenu,
						items,
						footer: unavailable ? [{
							id: MODEL_MENU_RETRY,
							label: t("plan.model.retry")
						}] : void 0,
						selectedId,
						onSelect: choose,
						onClose: close,
						anchor: (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ActivityPanel_module_css_default.planModelTrigger,
							"data-plan-model-trigger": true,
							"aria-label": t("plan.model.triggerAria", {
								model: modelLabel,
								effort: effortLabel
							}),
							"aria-haspopup": "menu",
							"aria-expanded": open,
							disabled: busy,
							onClick: () => {
								if (open) close();
								else {
									setPane("root");
									setOpen(true);
									directory.load().catch(() => void 0);
								}
							},
							children: [(0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.planModelTriggerCopy,
								children: [(0, react_jsx_runtime.jsx)("strong", { children: state.status === "loading" && catalogRoutes.length === 0 ? t("plan.model.loading") : modelLabel }), (0, react_jsx_runtime.jsx)("span", { children: effortLabel })]
							}), (0, react_jsx_runtime.jsx)(DisclosureChevron, { open })]
						})
					}),
					(0, react_jsx_runtime.jsx)("small", {
						className: ActivityPanel_module_css_default.planModelHint,
						children: currentMissing ? t("plan.model.currentUnavailable", {
							provider,
							model
						}) : selected?.model.description ?? t("plan.model.route", {
							provider,
							model
						})
					}),
					unavailable && (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.planModelNotice,
						role: state.status === "error" ? "alert" : "status",
						children: [(0, react_jsx_runtime.jsx)("span", { children: state.error ?? t("plan.model.partialFailure", { count: state.failures.length }) }), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy || state.status === "loading",
							onClick: () => {
								directory.load().catch(() => void 0);
							},
							children: t("plan.model.retry")
						})]
					})
				]
			});
		}
		function StagedMemberEditor({ team, member, modelDirectory, onPendingChange, t }) {
			const bodyId = (0, react.useId)();
			const [open, setOpen] = (0, react.useState)(false);
			const [role, setRole] = (0, react.useState)(member.role);
			const [provider, setProvider] = (0, react.useState)(member.provider ?? "");
			const [model, setModel] = (0, react.useState)(member.model ?? "");
			const [reasoningEffort, setReasoningEffort] = (0, react.useState)(member.reasoningEffort ?? "");
			const [executionPrompt, setExecutionPrompt] = (0, react.useState)(member.executionPrompt ?? "");
			const remoteSignature = JSON.stringify([
				member.role,
				member.provider ?? "",
				member.model ?? "",
				member.reasoningEffort ?? "",
				member.executionPrompt ?? ""
			]);
			const [savedSignature, setSavedSignature] = (0, react.useState)(remoteSignature);
			const [busy, setBusy] = (0, react.useState)(false);
			const [feedback, setFeedback] = (0, react.useState)();
			useDismissSuccess(feedback, setFeedback);
			const dirty = JSON.stringify([
				role,
				provider,
				model,
				reasoningEffort,
				executionPrompt
			]) !== savedSignature;
			(0, react.useEffect)(() => {
				onPendingChange(`member:${member.name}`, dirty || busy);
				return () => {
					onPendingChange(`member:${member.name}`, false);
				};
			}, [
				busy,
				dirty,
				member.name,
				onPendingChange
			]);
			(0, react.useEffect)(() => {
				setRole(member.role);
				setProvider(member.provider ?? "");
				setModel(member.model ?? "");
				setReasoningEffort(member.reasoningEffort ?? "");
				setExecutionPrompt(member.executionPrompt ?? "");
				setSavedSignature(remoteSignature);
			}, [
				member.role,
				member.provider,
				member.model,
				member.reasoningEffort,
				member.executionPrompt,
				remoteSignature
			]);
			const markEdited = () => {
				setFeedback(void 0);
			};
			const persist = async (selection = {
				provider,
				model,
				reasoningEffort
			}) => {
				const nextSignature = JSON.stringify([
					role,
					selection.provider,
					selection.model,
					selection.reasoningEffort,
					executionPrompt
				]);
				setProvider(selection.provider);
				setModel(selection.model);
				setReasoningEffort(selection.reasoningEffort);
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "update_member",
						memberName: member.name,
						role,
						provider: selection.provider,
						model: selection.model,
						reasoningEffort: selection.reasoningEffort,
						executionPrompt
					});
					setSavedSignature(nextSignature);
					setFeedback({
						tone: "success",
						message: t("plan.saved")
					});
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
				} finally {
					setBusy(false);
				}
			};
			const save = async (event) => {
				event.preventDefault();
				await persist();
			};
			const route = `${provider}/${model}`.replace(/^\//u, "");
			return (0, react_jsx_runtime.jsxs)("article", {
				className: ActivityPanel_module_css_default.planCard,
				"data-plan-member": member.name,
				"data-open": open,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ActivityPanel_module_css_default.planCardHeader,
					"aria-expanded": open,
					"aria-controls": bodyId,
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.planCardIdentity,
							children: [(0, react_jsx_runtime.jsx)("strong", { children: member.name }), (0, react_jsx_runtime.jsx)("span", { children: role || t("plan.member.roleFallback") })]
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.planCardMeta,
							title: route,
							children: route
						}),
						dirty && (0, react_jsx_runtime.jsx)("em", {
							className: ActivityPanel_module_css_default.planDirty,
							children: t("plan.unsaved")
						}),
						(0, react_jsx_runtime.jsx)(DisclosureChevron, { open })
					]
				}), open && (0, react_jsx_runtime.jsxs)("form", {
					id: bodyId,
					className: ActivityPanel_module_css_default.planCardBody,
					onSubmit: (event) => {
						save(event);
					},
					children: [(0, react_jsx_runtime.jsxs)("fieldset", {
						disabled: busy,
						children: [
							(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.member.role"), (0, react_jsx_runtime.jsx)("input", {
								name: "role",
								value: role,
								onChange: (event) => {
									setRole(event.currentTarget.value);
									markEdited();
								}
							})] }),
							(0, react_jsx_runtime.jsx)(StagedModelPicker, {
								directory: modelDirectory,
								provider,
								model,
								reasoningEffort,
								busy,
								onChange: (selection) => {
									persist(selection);
								},
								t
							}),
							(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.member.prompt"), (0, react_jsx_runtime.jsx)("textarea", {
								name: "executionPrompt",
								value: executionPrompt,
								onChange: (event) => {
									setExecutionPrompt(event.currentTarget.value);
									markEdited();
								},
								rows: 3
							})] })
						]
					}), (0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.planActions,
						children: [(0, react_jsx_runtime.jsx)(Feedback, { value: feedback }), (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: busy || !dirty || provider.trim() === "" || model.trim() === "",
							children: busy ? t("plan.saving") : t("plan.save")
						})]
					})]
				})]
			});
		}
		function StagedTaskEditor({ team, task, onPendingChange, t }) {
			const bodyId = (0, react.useId)();
			const taskDependencies = task.dependencies.join(", ");
			const [open, setOpen] = (0, react.useState)(false);
			const [subject, setSubject] = (0, react.useState)(task.subject);
			const [description, setDescription] = (0, react.useState)(task.description ?? "");
			const [assignee, setAssignee] = (0, react.useState)(task.assignee);
			const [dependencies, setDependencies] = (0, react.useState)(taskDependencies);
			const remoteSignature = JSON.stringify([
				task.subject,
				task.description ?? "",
				task.assignee,
				taskDependencies
			]);
			const [savedSignature, setSavedSignature] = (0, react.useState)(remoteSignature);
			const [busy, setBusy] = (0, react.useState)(false);
			const [confirmingRemove, setConfirmingRemove] = (0, react.useState)(false);
			const [feedback, setFeedback] = (0, react.useState)();
			useDismissSuccess(feedback, setFeedback);
			const signature = JSON.stringify([
				subject,
				description,
				assignee,
				dependencies
			]);
			const dirty = signature !== savedSignature;
			(0, react.useEffect)(() => {
				onPendingChange(`task:${task.id}`, dirty || busy);
				return () => {
					onPendingChange(`task:${task.id}`, false);
				};
			}, [
				busy,
				dirty,
				onPendingChange,
				task.id
			]);
			(0, react.useEffect)(() => {
				setSubject(task.subject);
				setDescription(task.description ?? "");
				setAssignee(task.assignee);
				setDependencies(taskDependencies);
				setSavedSignature(remoteSignature);
			}, [
				task.subject,
				task.description,
				task.assignee,
				taskDependencies,
				remoteSignature
			]);
			const markEdited = () => {
				setFeedback(void 0);
				setConfirmingRemove(false);
			};
			const save = async (event) => {
				event.preventDefault();
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "update_task",
						taskId: task.id,
						subject,
						description,
						assignee,
						dependencies: dependencies.split(",").map((item) => item.trim()).filter(Boolean)
					});
					setSavedSignature(signature);
					setFeedback({
						tone: "success",
						message: t("plan.saved")
					});
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
				} finally {
					setBusy(false);
				}
			};
			const remove = async () => {
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "remove_task",
						taskId: task.id
					});
					setFeedback({
						tone: "success",
						message: t("plan.removed")
					});
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
					setBusy(false);
				}
			};
			const dependencySummary = task.dependencies.length === 0 ? t("plan.dependencies.none") : t("plan.dependencies.count", { count: task.dependencies.length });
			return (0, react_jsx_runtime.jsxs)("article", {
				className: ActivityPanel_module_css_default.planCard,
				"data-plan-task": task.id,
				"data-open": open,
				children: [(0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ActivityPanel_module_css_default.planCardHeader,
					"aria-expanded": open,
					"aria-controls": bodyId,
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.planTaskId,
							children: task.id
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.planTaskSummary,
							title: subject,
							children: subject
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.planCardMeta,
							children: [
								assignee || t("plan.task.unassigned"),
								" · ",
								dependencySummary
							]
						}),
						dirty && (0, react_jsx_runtime.jsx)("em", {
							className: ActivityPanel_module_css_default.planDirty,
							children: t("plan.unsaved")
						}),
						(0, react_jsx_runtime.jsx)(DisclosureChevron, { open })
					]
				}), open && (0, react_jsx_runtime.jsxs)("form", {
					id: bodyId,
					className: ActivityPanel_module_css_default.planCardBody,
					onSubmit: (event) => {
						save(event);
					},
					children: [
						(0, react_jsx_runtime.jsxs)("fieldset", {
							disabled: busy,
							children: [
								(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.task.subject"), (0, react_jsx_runtime.jsx)("input", {
									name: "subject",
									required: true,
									value: subject,
									onChange: (event) => {
										setSubject(event.currentTarget.value);
										markEdited();
									}
								})] }),
								(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.task.description"), (0, react_jsx_runtime.jsx)("textarea", {
									name: "description",
									value: description,
									onChange: (event) => {
										setDescription(event.currentTarget.value);
										markEdited();
									},
									rows: 3
								})] }),
								(0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.planGrid,
									children: [(0, react_jsx_runtime.jsxs)("label", { children: [t("plan.task.assignee"), (0, react_jsx_runtime.jsxs)("select", {
										name: "assignee",
										value: assignee,
										onChange: (event) => {
											setAssignee(event.currentTarget.value);
											markEdited();
										},
										children: [(0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: t("plan.task.unassigned")
										}), team.members.map((member) => (0, react_jsx_runtime.jsx)("option", {
											value: member.name,
											children: member.name
										}, member.name))]
									})] }), (0, react_jsx_runtime.jsxs)("label", { children: [
										t("plan.task.dependencies"),
										(0, react_jsx_runtime.jsx)("input", {
											name: "dependencies",
											value: dependencies,
											onChange: (event) => {
												setDependencies(event.currentTarget.value);
												markEdited();
											}
										}),
										(0, react_jsx_runtime.jsx)("small", { children: t("plan.task.dependenciesHint") })
									] })]
								})
							]
						}),
						confirmingRemove && (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.planConfirm,
							role: "alert",
							children: [
								(0, react_jsx_runtime.jsx)("span", { children: t("plan.removeWarning", { task: task.id }) }),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										setConfirmingRemove(false);
									},
									children: t("plan.cancel")
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-danger": true,
									"data-confirming": true,
									onClick: () => {
										remove();
									},
									children: t("plan.removeConfirm")
								})
							]
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.planActions,
							children: [
								(0, react_jsx_runtime.jsx)(Feedback, { value: feedback }),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-danger": true,
									onClick: () => {
										setConfirmingRemove(true);
										setFeedback(void 0);
									},
									disabled: busy || confirmingRemove,
									children: t("plan.remove")
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									disabled: busy || !dirty || subject.trim() === "",
									children: busy ? t("plan.saving") : t("plan.save")
								})
							]
						})
					]
				})]
			});
		}
		function StagingPlanEditor({ team, modelDirectory, onContinuePlanning, onDiscarded, t }) {
			const membersId = (0, react.useId)();
			const tasksId = (0, react.useId)();
			const [membersOpen, setMembersOpen] = (0, react.useState)(true);
			const [tasksOpen, setTasksOpen] = (0, react.useState)(true);
			const [newTask, setNewTask] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [discardArmed, setDiscardArmed] = (0, react.useState)(false);
			const [pendingEditors, setPendingEditors] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [feedback, setFeedback] = (0, react.useState)();
			useDismissSuccess(feedback, setFeedback);
			const dependencyLinks = team.tasks.reduce((total, task) => total + task.dependencies.length, 0);
			const runnable = team.members.length > 0 && team.tasks.length > 0;
			const hasPendingEdits = pendingEditors.size > 0 || newTask.trim() !== "";
			const waitingForFeedback = team.planReviewState === "awaiting_feedback";
			(0, react.useEffect)(() => {
				modelDirectory.load().catch(() => void 0);
			}, [modelDirectory]);
			const onPendingChange = (0, react.useCallback)((key, pending) => {
				setPendingEditors((current) => {
					if (pending === current.has(key)) return current;
					const next = new Set(current);
					if (pending) next.add(key);
					else next.delete(key);
					return next;
				});
			}, []);
			const addTask = async (event) => {
				event.preventDefault();
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "add_task",
						subject: newTask,
						dependencies: []
					});
					setNewTask("");
					setFeedback({
						tone: "success",
						message: t("plan.taskAdded")
					});
					setTasksOpen(true);
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
				} finally {
					setBusy(false);
				}
			};
			const approve = async () => {
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "approve"
					});
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
					setBusy(false);
				}
			};
			const continueInChat = async () => {
				if (waitingForFeedback) {
					onContinuePlanning();
					return;
				}
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "continue"
					});
					onContinuePlanning();
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
					setBusy(false);
				}
			};
			const discard = async () => {
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutatePlan({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "discard"
					});
					onDiscarded();
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
					setBusy(false);
					setDiscardArmed(false);
				}
			};
			return (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.planEditor,
				"data-staging-editor": true,
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: ActivityPanel_module_css_default.planHeader,
						children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)("strong", { children: t("plan.title") }), (0, react_jsx_runtime.jsx)("small", { children: t("plan.readySummary", {
							members: team.members.length,
							tasks: team.tasks.length,
							links: dependencyLinks
						}) })] }), (0, react_jsx_runtime.jsx)("em", { children: t("plan.badge") })] }), (0, react_jsx_runtime.jsx)("p", { children: t("plan.description") })]
					}),
					(0, react_jsx_runtime.jsxs)("ol", {
						className: ActivityPanel_module_css_default.planFlow,
						"aria-label": t("plan.flow.aria"),
						children: [
							(0, react_jsx_runtime.jsxs)("li", {
								"data-active": true,
								children: [(0, react_jsx_runtime.jsx)("span", { children: "1" }), t("plan.flow.review")]
							}),
							(0, react_jsx_runtime.jsxs)("li", { children: [(0, react_jsx_runtime.jsx)("span", { children: "2" }), t("plan.flow.spawn")] }),
							(0, react_jsx_runtime.jsxs)("li", { children: [(0, react_jsx_runtime.jsx)("span", { children: "3" }), t("plan.flow.run")] })
						]
					}),
					(0, react_jsx_runtime.jsxs)("section", {
						className: ActivityPanel_module_css_default.planSection,
						children: [(0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ActivityPanel_module_css_default.planSectionToggle,
							"aria-expanded": membersOpen,
							"aria-controls": membersId,
							onClick: () => {
								setMembersOpen((current) => !current);
							},
							children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)("strong", { children: t("plan.members.title") }), (0, react_jsx_runtime.jsx)("small", { children: t("plan.members.count", { count: team.members.length }) })] }), (0, react_jsx_runtime.jsx)(DisclosureChevron, { open: membersOpen })]
						}), membersOpen && (0, react_jsx_runtime.jsx)("div", {
							id: membersId,
							className: ActivityPanel_module_css_default.planList,
							children: team.members.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: ActivityPanel_module_css_default.planEmpty,
								children: t("plan.members.empty")
							}) : team.members.map((member) => (0, react_jsx_runtime.jsx)(StagedMemberEditor, {
								team,
								member,
								modelDirectory,
								onPendingChange,
								t
							}, member.name))
						})]
					}),
					(0, react_jsx_runtime.jsxs)("section", {
						className: ActivityPanel_module_css_default.planSection,
						children: [(0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ActivityPanel_module_css_default.planSectionToggle,
							"aria-expanded": tasksOpen,
							"aria-controls": tasksId,
							onClick: () => {
								setTasksOpen((current) => !current);
							},
							children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)("strong", { children: t("plan.tasks.title") }), (0, react_jsx_runtime.jsx)("small", { children: t("plan.tasks.count", {
								count: team.tasks.length,
								links: dependencyLinks
							}) })] }), (0, react_jsx_runtime.jsx)(DisclosureChevron, { open: tasksOpen })]
						}), tasksOpen && (0, react_jsx_runtime.jsx)("div", {
							id: tasksId,
							className: ActivityPanel_module_css_default.planList,
							children: team.tasks.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: ActivityPanel_module_css_default.planEmpty,
								children: t("plan.tasks.empty")
							}) : team.tasks.map((task) => (0, react_jsx_runtime.jsx)(StagedTaskEditor, {
								team,
								task,
								onPendingChange,
								t
							}, task.id))
						})]
					}),
					(0, react_jsx_runtime.jsxs)("form", {
						className: ActivityPanel_module_css_default.planNewTask,
						onSubmit: (event) => {
							addTask(event);
						},
						children: [(0, react_jsx_runtime.jsxs)("label", { children: [(0, react_jsx_runtime.jsx)("span", { children: t("plan.newTaskLabel") }), (0, react_jsx_runtime.jsx)("input", {
							name: "newTask",
							value: newTask,
							onChange: (event) => {
								setNewTask(event.currentTarget.value);
								setFeedback(void 0);
							},
							placeholder: t("plan.newTask"),
							disabled: busy
						})] }), (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: busy || newTask.trim() === "",
							children: busy ? t("plan.adding") : t("plan.addTask")
						})]
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ActivityPanel_module_css_default.planApproveRow,
						"data-armed": discardArmed || void 0,
						"data-discard": discardArmed || void 0,
						"data-review-state": waitingForFeedback ? "awaiting-feedback" : "awaiting-review",
						children: [
							(0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.planApproveCopy,
								children: [(0, react_jsx_runtime.jsx)("strong", { children: discardArmed ? t("plan.discardConfirmTitle") : waitingForFeedback ? t("plan.feedbackTitle") : t("plan.approveTitle") }), (0, react_jsx_runtime.jsx)("small", { children: discardArmed ? t("plan.discardWarning") : waitingForFeedback ? t("plan.feedbackHint") : hasPendingEdits ? t("plan.pendingEdits") : t("plan.approveHint", {
									members: team.members.length,
									tasks: team.tasks.length
								}) })]
							}),
							(0, react_jsx_runtime.jsx)(Feedback, { value: feedback }),
							discardArmed ? (0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.planApproveActions,
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy,
									onClick: () => {
										setDiscardArmed(false);
									},
									children: t("plan.cancel")
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-plan-discard": true,
									"data-danger": true,
									"data-confirming": true,
									disabled: busy,
									onClick: () => {
										discard();
									},
									children: busy ? t("plan.discarding") : t("plan.discardConfirm")
								})]
							}) : (0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.planReviewActions,
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"data-plan-approve": true,
									disabled: busy || !runnable || hasPendingEdits,
									onClick: () => {
										approve();
									},
									children: t("plan.approve")
								}), (0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.planSecondaryActions,
									children: [(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"data-plan-continue": true,
										disabled: busy,
										onClick: () => {
											continueInChat();
										},
										children: t(waitingForFeedback ? "plan.returnToChat" : "plan.continue")
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"data-plan-discard": true,
										"data-danger": true,
										disabled: busy,
										onClick: () => {
											setDiscardArmed(true);
											setFeedback(void 0);
										},
										children: t("plan.discard")
									})]
								})]
							})
						]
					})
				]
			});
		}
		/**
		* Read whether one member's model is still editable.
		* @param member - the member row; `id` is the spawn marker (empty until spawned).
		* @returns the three-state reading.
		*/
		function memberModelEditability(member) {
			const id = member.id;
			if (typeof id !== "string") return "unknown";
			return id === "" ? "editable" : "sealed";
		}
		/** One member's persisted model change, sent through the same plan route. */
		async function mutateMemberModel(payload) {
			await mutatePlan(payload);
		}
		/**
		* The model picker bound to one member row, for BOTH staged and running teams.
		*
		* Reuses {@link StagedModelPicker} directly. Persists through the same plan
		* route the staged editor uses, so there is exactly one write path.
		*/
		function MemberModelField({ team, member, modelDirectory, disabledReason, t }) {
			const [provider, setProvider] = (0, react.useState)(member.provider ?? "");
			const [model, setModel] = (0, react.useState)(member.model ?? "");
			const [reasoningEffort, setReasoningEffort] = (0, react.useState)(member.reasoningEffort ?? "");
			const [busy, setBusy] = (0, react.useState)(false);
			const [feedback, setFeedback] = (0, react.useState)();
			useDismissSuccess(feedback, setFeedback);
			(0, react.useEffect)(() => {
				setProvider(member.provider ?? "");
				setModel(member.model ?? "");
				setReasoningEffort(member.reasoningEffort ?? "");
			}, [
				member.provider,
				member.model,
				member.reasoningEffort
			]);
			const persist = async (selection) => {
				setProvider(selection.provider);
				setModel(selection.model);
				setReasoningEffort(selection.reasoningEffort);
				setBusy(true);
				setFeedback(void 0);
				try {
					await mutateMemberModel({
						sessionId: team.captainSessionId,
						teamId: team.teamId,
						action: "update_member",
						memberName: member.name,
						role: member.role,
						provider: selection.provider,
						model: selection.model,
						reasoningEffort: selection.reasoningEffort,
						executionPrompt: member.executionPrompt ?? ""
					});
					setFeedback({
						tone: "success",
						message: t("plan.saved")
					});
				} catch (error) {
					setFeedback({
						tone: "error",
						message: t("plan.failed", { message: errorMessage(error) })
					});
				} finally {
					setBusy(false);
				}
			};
			if (disabledReason !== void 0) return (0, react_jsx_runtime.jsx)("span", {
				style: LOCKED_STYLE,
				"data-member-model-locked": true,
				title: disabledReason,
				children: (0, react_jsx_runtime.jsx)(StagedModelPicker, {
					directory: modelDirectory,
					provider,
					model,
					reasoningEffort,
					busy: true,
					onChange: () => void 0,
					t
				})
			});
			return (0, react_jsx_runtime.jsxs)("span", {
				style: FIELD_STYLE,
				"data-member-model-field": true,
				children: [(0, react_jsx_runtime.jsx)(StagedModelPicker, {
					directory: modelDirectory,
					provider,
					model,
					reasoningEffort,
					busy,
					onChange: (selection) => {
						persist(selection);
					},
					t
				}), feedback !== void 0 && (0, react_jsx_runtime.jsx)("span", {
					style: feedback.tone === "error" ? ERROR_STYLE : SUCCESS_STYLE,
					"data-tone": feedback.tone,
					role: "status",
					children: feedback.message
				})]
			});
		}
		//#endregion
		//#region lib/client/MemberRow.js
		/**
		* One durable member of a team, as a single row on screen one.
		*
		* ── ★★★ 这一屏要回答什么（用户原话）────────────────────────────────────────────
		*
		*   "is the whole team working, and who is doing what"
		*
		* 而用户对第一屏的**结构**要求是：显示**持久成员**，点开一个成员就看到它底下的
		* **子代理**，轮次信息**一起**给出来（"round data moves UP into screen one"）。
		*
		* ── 一行的四件事（缺一件就是一个"看起来正常但读不出东西"的格子）──────────────
		*
		*   ① 身份      —— 头像 + 名字 + 角色
		*   ② 模型      —— 它跑在哪个路由上（未启动的成员就地可改，复用既有选择器）
		*   ③ 在做什么  —— 当前任务 id + 任务名，读不出就说清是"读不出"
		*   ④ 计时      —— worked N / waiting N / idle / unknown，★ **从不空白**
		*
		* 展开后是它底下的子代理（数据由 R1/t27 送到 /state），每个**各自**说明它在做什么。
		*
		* ── ★ 反例：为什么计时必须单独一个组件 ────────────────────────────────────────
		*
		* 秒表若挂在**这一行**上，一行一 tick ⇒ 整队每秒重渲染。所以时长交给
		* {@link MemberClock}（它自己拥有表），本组件**不持有** `now`。
		* @module dsh-agent-teams/client/member-row
		*/
		/**
		* ★ t16 遗留：成员模型控件的行内样式。
		*
		* 原来它是 `ActivityPanel.tsx` 里的一个局部常量；R2 把它连同控件一起搬到这里，
		* 因为**用的那一行**才是它的归属。颜色仍然只来自宿主 `--dsw-alias-*` token。
		*/
		const MEMBER_MODEL_LINE_STYLE = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			minWidth: 0,
			padding: "2px 6px 0 60px"
		};
		/**
		* The tone of one member's status dot.
		*
		* ★ Liveness is read BEFORE `activity`, and the order is the whole point:
		*   `activity` is a durable field that keeps saying `working` after the member's
		*   session dies, so a dead member would keep a "running" dot forever — the
		*   residual reading task t4 exists to remove. A member whose session is gone
		*   while its work is still open therefore reads `stalled` (amber), not `running`.
		*
		* ── ★★★ t82：上面那句的「**while its work is still open**」现在真的被实现了 ──────
		*
		* MEASURED（用户截图：「目前已完成为什么是琥珀色的」）：改前这一格是
		* `if (liveness === 'not-live') return 'stalled'` —— **无条件**。于是
		* `ui-engineer`（刚成功交付 t79、名下未完成任务数 = **0**、会话被正常回收）
		* 被画成琥珀。而琥珀是本仓**唯一**的"待处理"色（CSS 注释逐字「a thing to act on」）
		* ⇒ "干完了"与"卡住了"**同色** ⇒ 那个色不再是信号，而两者的处置**相反**。
		*
		* ⇒ 现在 `not-live` **分两格**：
		*   · `openWork === true`  ⇒ `'stalled'`（琥珀）—— ★ 注释说的那一格（死会话 + 活还开着）
		*   · `openWork === false` ⇒ `'idle'`            —— ★ 它已收工，会话被回收是【正常的】
		*
		* ★ **只改了"何时用琥珀"，没改 CSS 的颜色规则**（琥珀仍是 warn 色）。
		*
		* ★ When the host publishes no liveness field, this falls back to `activity`
		*   exactly as before rather than inferring a state nobody measured.
		*/
		function memberDotTone(member, context) {
			if (context.discarded === true || context.staged === true) return "dormant";
			if (context.stopped === true || context.historic === true) return "idle";
			const liveness = member.liveness;
			if (liveness !== void 0 && liveness !== "") {
				if (liveness === "working") return "running";
				/**
				* ★★ t82：会话不在场时**必须再问一句"它名下还有活吗"** ——
				*   这是本函数自己的注释与 CSS 注释共同声明的那个条件。
				*   ★ 缺省（`openWork` 未给）按 `true` 处理 ⇒ 退回改前的行为，
				*     而不是安静地把一个可能的卡点画成收工。
				*/
				if (liveness === "not-live") return context.openWork === false ? "idle" : "stalled";
				if (liveness === "never-spawned") return "dormant";
				/** `idle` / `could-not-measure`: alive but not driving, or unmeasured. */
				return "idle";
			}
			if (member.activity === "working") return "running";
			return member.activity === "idle" ? "idle" : "dormant";
		}
		/**
		* ── ★★★ t80 缺陷②：把"**本轮真跑了的**"与"**没有落盘读数的**"分开 ────────────────
		*
		* ── 根因（MEASURED，用户截图：「展开详情之后会很杂乱」）──────────────────────────
		*
		* MEASURED（从 team.json 读 t79）：`gateEvaluation.ran` **只有 4 条**，全在
		* `completion` 段；而 UI 展开态把 `registry.list()` 的**全部 17 条**都列了出来
		* ⇒ 其余 **13 条**没有裁决 ⇒ 逐条都是 `registered`（○）。
		*
		* ⇒ ★★ 于是展开态把**两件不同的事**并列了：
		*
		*     "注册表里有哪些判据"    ← 17 条（一份**清单**）
		*     "这次实际跑了哪些判据"  ←  4 条（一个**事实**）
		*
		* ⇒ 13 个 ○ 淹没 4 条真实裁决 ⇒ **看起来像"什么都没跑"**。
		*
		* ★★★ 而"看起来什么都没跑"是**误导**：它**不是没跑**，是**其余段的结果不落盘**
		*   —— 那是甲方案的已知边界（只有 `completion` 段写 `task.gateEvaluation`）。
		*
		* ⇒ 所以切成两块，且**两块的措辞必须不同形**：
		*   · `ran`    —— 这一轮**真的**有裁决（`hasVerdicts`），逐条列出；
		*   · `silent` —— **没有落盘读数**，折叠成一行计数（**不是**"没跑"）。
		*
		* ★ 空段（`rows.length === 0`）**两块都不进** —— `admission 0 条` 不显示。
		*   而"不显示"与"显示 0 条"必须不同形：后者会让人以为那个位置**该有**判据却没有。
		*
		* ★ `hasVerdicts` 才是"有没有裁决"的**唯一**判据 —— 不是 `rows.some(r => r.state === 'passed')`：
		*   一个"跑了 4 条、全部 unmeasured"的段**有裁决**（只是结论不好看），
		*   按状态去推会把它错读成"没有读数"（实测变异体 M7 钉住这一点）。
		* @param groups - every stage group derived for this row.
		* @returns the two blocks, each in flow order.
		*/
		function splitStageGroups(groups) {
			const nonEmpty = groups.filter((group) => group.rows.length > 0);
			return {
				ran: nonEmpty.filter((group) => group.hasVerdicts),
				silent: nonEmpty.filter((group) => !group.hasVerdicts)
			};
		}
		/** Total criteria across one block of stage groups. */
		function stageGroupCount(groups) {
			return groups.reduce((total, group) => total + group.rows.length, 0);
		}
		/**
		* ── ★★★ v4：一根判据的**全部阶段分组**（展开态画的就是这个）────────────────────
		*
		* 规格 §5：按**阶段**分组，每段给整段形状 + 逐条 `id` + `description`。
		*
		* ★★ **甲方案的边界落在这里**（与 `stageGateRows` 同一条纪律）：
		*   只有 `completion` 段有落盘裁决 ⇒ 其余段**逐条只能是 ○/·**，
		*   绝不许从别处推一个 `✓` 出来。`hasVerdicts` 就是那条边界的**可读标记**。
		*
		* ★ 目录（`catalog`）来自 `/state` 的 `gateCatalog` —— 它是**每份快照都带**的
		*   静态清单，于是"换掉一条判据 ⇒ UI 自动跟着变"（可插拔）。
		* @param stage - the stage this member's current task is in, or undefined.
		* @param catalog - the registered criteria for every stage.
		* @param evaluation - the completion-stage verdicts, when the wire carried them.
		* @returns one group per stage, in flow order; `rows` is empty for empty stages.
		*/
		function stageGroups(stage, catalog, evaluation, evaluations) {
			const evaluationView = readEvaluationView(evaluation);
			const byPoint = readEvaluationsByPoint(evaluations, catalog.map((entry) => entry.point));
			/**
			* ★★ 「走到了吗」的**机械依据**：落盘里**有这一段的键**，或这一段的层级是任务级
			*   而任务当前正处在它**或更后面**的段。
			* ★ 而这里刻意**不**用"有键"单一判据：`contract` 段在 `create_task` 时就落了，
			*   而一个只跑到 `dispatch` 的任务，它的 `completion` **没有键** ⇒ 应报 `notReached`
			*   （★ 反向半边 A：不许把"还没到"说成"没读数"）。
			*   ⇒ 所以用"**当前段之后**"这一点来区分：当前段**之前或就是**它 ⇒ 走到过。
			*/
			/**
			* ★★★ t100：**顺序来自 `catalog`，不再来自手抄的 `FLOW_STAGES`**。
			*
			* ── 为什么必须这样（MEASURED，队长实测）────────────────────────────────────
			*
			* `FLOW_STAGES` 的注释逐字写着「Mirrors the host's `INSERTION_POINTS`」，
			* ★ 而它【手抄】了六个，主机已经有七个（`collection` 是后加的）
			* ⇒ 那次分叉【没有任何东西会红】。
			*
			* ★★★ 而 `catalog` 是**主机派生**的（`snapshot.ts` 的 `gateCatalogForUi()`
			*   按 `INSERTION_POINTS.map(...)` 生成）⇒ ★ 它是**唯一真值**，
			*   而手抄那份【结构上不可能与它保持一致】。
			*
			* ★ 顺序：`catalog` 的元素顺序**就是**主机的 `INSERTION_POINTS` 顺序
			*   （那正是它的生成方式）⇒ 所以下面 `indexOf` 换成在 catalog 里找下标。
			*/
			const orderedPoints = catalog.map((entry) => entry.point);
			const stageIndex = stage === void 0 ? -1 : orderedPoints.indexOf(stage);
			return catalog.map((point) => {
				const here = point.point;
				const stageVerdicts = byPoint.get(here) ?? (here === "completion" ? evaluationView : void 0);
				const rows = stageGateRows(here, point.gates, evaluationView, stageVerdicts);
				const state = stageGroupState(here, rows, evaluationView, stageVerdicts);
				/**
				* ★ 该段**有没有**裁决：按段字段在场，或 completion 的兼容来源在场。
				*/
				const hasVerdicts = stageVerdicts !== void 0;
				return {
					stage: here,
					state,
					hasVerdicts,
					absence: hasVerdicts ? void 0 : segmentAbsence(
						here,
						point.gates.length,
						/** ★ "走到过"= 这一段的键在落盘里，或任务当前段已经**越过**它。 */
						byPoint.has(here) || stageIndex >= 0 && stageIndex >= orderedPoints.indexOf(here)
					),
					rows
				};
			});
		}
		/**
		* ── ★★★ t81：一段"没有裁决"的成因 → **它该说哪句话** ─────────────────────────────
		*
		* ★ 四者**不同句**（而不是四者同印一个 ○）：补救动作不同 ⇒ 措辞不许同形。
		*   · `noGate`     ⇒ 判据自己该接线（或删掉）—— **不是**任务的问题
		*   · `teamLevel`  ⇒ 去团队级/事件级的读数里看 —— **永远**不会出现在任务上
		*   · `notReached` ⇒ 等 —— 它会自己出现
		*   · `notRecorded`⇒ 想知道上一代说了什么 ⇒ 看**历史**（`executions[]`）
		* ★ 类型是 `Record<SegmentAbsence, …>` ⇒ 将来加第五种成因时，**这里编译期就红**
		*   （而不是印出一个空字符串）。
		*/
		const ABSENCE_LOCALE_KEY = {
			noGate: "member.gates.absence.noGate",
			teamLevel: "member.gates.absence.teamLevel",
			notReached: "member.gates.absence.notReached",
			notRecorded: "member.gates.absence.notRecorded"
		};
		/** The glyph for one row, from the single table in activity-model. */
		function rowGlyph(row) {
			return GATE_GLYPH[row.state];
		}
		/**
		* ── ★★★ v4：行 2 的"**在做什么测试**" ──────────────────────────────────────────
		*
		* ★ 规格 §3：测试段来自 `registry.list()[该段]` 的 **id 后缀**。
		*   取后缀而不是整条 id：整条 `completion.mutation` 在行 2 上太长，
		*   而后缀 `mutation` 才是"哪一条测试"的可读部分 —— 完整 id 留在 `title` 上。
		*
		* ★★ 而"在跑哪一条"**优先取**逐条里 `running` 的那条：
		*   一句"completion 段 · mutation"里的 `mutation` 若与正在跑的那条无关，
		*   读者会以为整段都在跑它。都没有在跑 ⇒ 退回**第一条**（该段有判据可报）。
		*
		* ★ 该段**没有**判据 ⇒ 返回 `''`（行 2 就不出这一段，而不是印一个空占位）。
		* @param group - the stage group the member's current task is in.
		* @returns the short test label, or '' when the stage has no criteria.
		*/
		function testLabelOf(group) {
			if (group.rows.length === 0) return "";
			const chosen = group.rows.find((row) => row.state === "running") ?? group.rows[0];
			/** ★ id 形如 `completion.mutation` ⇒ 取最后一个点号之后那一段。 */
			const parts = chosen.id.split(".");
			return parts[parts.length - 1] ?? chosen.id;
		}
		/**
		* The stage a member's row should report: the one its **current task** is in.
		*
		* ★ 用 `current`（`currentTask` 解析出来的那条），缺席时退回名下第一条非终结任务 ——
		*   与 `memberDoingText` 的口径同源，否则"在做什么"与"在哪个阶段"会指向两条任务。
		* @param current - the resolved current task, when there is one.
		* @param owned - every task assigned to this member.
		* @returns the stage, or undefined when the spec says to omit it.
		*/
		function currentStage(current, owned) {
			const task = current ?? owned.find((candidate) => candidate.status !== "completed" && candidate.status !== "failed" && candidate.status !== "cancelled");
			if (task === void 0) return void 0;
			const hasEvaluation = task.gateEvaluation !== void 0 && task.gateEvaluation !== null;
			return taskStage(task.status, hasEvaluation);
		}
		/**
		* Widen the wire's raw gate field into the view the stage helpers read.
		*
		* ★ 复用 `memberGateReadouts` 的**同一个**解析口径（它已经处理了"字符串 / 对象 /
		*   读不出"三种到达方式）—— 不在这里写第二份，否则两处会漂移。
		* @param raw - the raw `gateEvaluation` field.
		* @returns the parsed view, or undefined when unreadable/absent.
		*/
		function readEvaluationView(raw) {
			if (raw === void 0 || raw === null || raw === "") return void 0;
			const readout = memberGateReadouts([{
				id: "probe",
				gateEvaluation: raw
			}]).get("probe");
			if (readout === void 0 || readout.state !== "verdict") return void 0;
			return readout.evaluation;
		}
		/**
		* ── ★★ t81：把按段字段（`gateEvaluations`）解析成 `段 -> 裁决视图` ─────────────────
		*
		* ★ **逐段解析、逐段独立**：某一段解析失败**只影响那一段**（它退回"没有裁决"），
		*   而**不许**让一整条任务的六段一起塌掉 —— 那会把"这一段坏了"读成"全都没跑"。
		*
		* ★★ 缺席与空**不同形**：
		*   · 键**不在** ⇒ 该段**没有落盘**（成因由 `segmentAbsence` 再细分）；
		*   · 键在、而值是空/坏 ⇒ 解析不出视图 ⇒ **同样算"没有裁决"**（不编一个 `ok`）。
		*   ★ 两者在这里**合流成"没有裁决"是对的** —— 因为本函数只回答"有没有可渲染的裁决"，
		*     而"为什么没有"由 `segmentAbsence` 单独回答（那是**另一个问题**，见它的注释）。
		*
		* @param raw - the raw `gateEvaluations` field off the task, when the wire carried it.
		*/
		function readEvaluationsByPoint(raw, knownPoints) {
			const out = /* @__PURE__ */ new Map();
			if (raw === void 0 || raw === null || typeof raw !== "object") return out;
			const allowed = new Set(knownPoints);
			for (const [key, value] of Object.entries(raw)) {
				if (!allowed.has(key)) continue;
				const view = readEvaluationView(value);
				if (view !== void 0) out.set(key, view);
			}
			return out;
		}
		/**
		* What this member is doing right now, in one line.
		*
		* ★ Every branch says *something*: a member with no current task reads a sentence
		*   rather than an empty line, because "this cell has nothing" and "this member has
		*   nothing to do" must not look the same.
		*
		* ── ★★★ D12：句子**不只一句**（用户从截图发现的缺陷）──────────────────────────
		*
		* MEASURED：改前这里只有一个兜底 `return`，于是**四种情形同形**。用户截图里
		* 决定性的一对照 —— `ui-engineer`（完成 0 · 失败 1）与 `ui-dissect`（完成 12 ·
		* 失败 3）主行**都是**「等待队长派工」。而这两件事的处置**相反**：
		*   · 有历史（做完了在等下一件）⇒ 队长**欠它**一个任务；
		*   · 无历史（生成后没派过活）  ⇒ 它**还没参与过**。
		*
		* ★ 纪律与紧邻的注释同源：**"空 vs 非空"防住了，"干完了 vs 没开始"没防住。**
		*   所以这里必须**四种不同形**，而不是"有任务 / 没任务"两分。
		* @param member - the member row.
		* @param current - the member's task that `currentTask` names, when it resolves.
		* @param owned - every task assigned to this member.
		* @param t - locale lookup.
		*/
		function memberDoingText(member, current, owned, t) {
			if (current !== void 0) {
				const subject = current.subject.replace(/^开发\s*/u, "").trim();
				return subject === "" ? t("member.doing.task", { taskId: current.id }) : t("member.doing.taskSubject", {
					taskId: current.id,
					subject
				});
			}
			if (member.activity === "working") return t("member.status.working");
			const history = memberHistoryState(owned);
			if (history === "open") return t("member.doing.task", { taskId: owned.filter((task) => task.state !== "completed" && task.state !== "failed" && task.state !== "cancelled")[0].id });
			/**
			* ★ 下面三句**必须**互不相同 —— "拆开了"与"拆了个恒等的"在屏幕上同形，
			*   而反向半边 A/B 就是用来挡住后者的（见 docs/D12-STATUS-COLLAPSE.md）。
			*/
			if (history === "failed") return t("member.status.awaitingRedispatch", { taskId: latestTerminalId(owned) });
			if (history === "finished") return t("member.status.awaitingAssignment", { taskId: latestCompletedId(owned) });
			return t("member.status.waitingAssignment");
		}
		/** Id of the newest terminal task owned by this member (D12's failure line). */
		function latestTerminalId(owned) {
			return latestOwnedTask(owned.filter((task) => task.state === "completed" || task.state === "failed" || task.state === "cancelled"))?.id ?? "";
		}
		/**
		* Id of the newest **completed** task owned by this member (D12's finished line).
		*
		* ★ 单独取 completed，而不是"最新那条终结任务"：最新那条可能是 cancelled，
		*   而"已完成 tN · 待派工"里的 tN 必须是**真的完成了的那个**，
		*   否则这句话会把一件被取消的任务说成已完成。
		*/
		function latestCompletedId(owned) {
			return latestOwnedTask(owned.filter((task) => task.status === "completed"))?.id ?? "";
		}
		/**
		* What one subagent is doing, in one line.
		*
		* ★ The host hands the raw session status through; an unrecognised value reads
		*   "状态未知" instead of being rounded to "工作中".
		* @param subagent - one live subagent from the /state payload.
		* @param t - locale lookup.
		*/
		function subagentDoingText(subagent, t) {
			const tone = subagentTone(subagent.status);
			if (tone === "working") return t("subagent.doing.working");
			if (tone === "idle") return t("subagent.doing.idle");
			return t("subagent.doing.unknown", { status: subagent.status });
		}
		/** Locale key for one elapsed readout's inline label (used by the row's aria text). */
		const CLOCK_LABEL = {
			running: "member.clock.working",
			stale: "member.clock.waiting",
			idle: "member.clock.idle",
			unknown: "member.clock.unknown"
		};
		/**
		* ── ★★★ B6：职责那一行**能放多少列**、**最多折几行**（见组件里的用法注释）。
		*
		* ★ 44 列的依据：面板最窄容器是 360px（`@container agent-team (max-width: 360px)`），
		*   减去状态点与间距后的可用宽度；按 10.5px 字号下 ~1 字符 ≈ 7px 估算，
		*   ★ **该换算是估算**，而反向半边 C 给的是**逐行的列数读数**（不依赖这个换算）。
		*/
		const MEMBER_ROLE_MAX_COLUMNS = 44;
		const MEMBER_ROLE_MAX_LINES = 2;
		/**
		* ── ★★★ v4：从团队快照里读**判据清单**（转发过来的那一格）──────────────────────
		*
		* ★ 这是"**可插拔**"的落点：UI **不硬编码**任何判据名，只读 `id` + `description`。
		*   换掉一条判据（改 `src/gates/**`）⇒ 两者都变 ⇒ UI 自动跟着变，不用改代码。
		*
		* ★ **结构化读取**而不是给 `ActivityTeam` 加字段：`activity-monitor.ts` **不在**
		*   本任务的写域里（与 `MemberRow.tsx` 上 `subagents` / `round` 同一条先例 ——
		*   面板读**线上真的有的**字段，等基类追上来时这个别名自然收敛）。
		*
		* ★ **缺席**（老快照没有这一格）⇒ 空数组 ⇒ 展开层报"读不到判据清单"。
		*   这与"注册了 0 条"**不同形** —— 前者是"我没读到"，后者是"确实没有"。
		* @param team - the team snapshot as it arrived on the wire.
		* @returns the catalog entries, or an empty array when the wire omitted them.
		*/
		function gateCatalogOf(team) {
			const raw = team.gateCatalog;
			if (!Array.isArray(raw)) return [];
			return raw.filter((entry) => typeof entry === "object" && entry !== null && typeof entry.point === "string" && Array.isArray(entry.gates));
		}
		/**
		* One member row: identity, model, current work, elapsed state; expansion
		* reveals the live subagents underneath it.
		*/
		function MemberRow({ team, member, tasks, expanded, onToggle, onOpenSubagent, onSelectTask, modelDirectory, t, historic = false, discarded = false, stopped = false, frozenNow, memberModel: memberModelProp, memberModelEditable: editableProp }) {
			const key = memberRowKey(member);
			const owned = tasks.filter((task) => task.assignee === member.name);
			const current = owned.find((task) => task.id === member.currentTask);
			const memberModel = memberModelProp ?? memberRouteLabel(member);
			const editable = editableProp ?? memberModelEditability(member);
			const clock = memberClock(member, tasks, frozenNow ?? Date.now());
			const stamp = clock.stamp ?? memberClockStamp(member, tasks);
			const round = memberRound(owned);
			const subs = memberSubagentReadout(member);
			/**
			* ★★ 判据清单**就地**从 `team` 上读 —— 不由调用方当 prop 传进来。
			*
			* ── 为什么（这是**写域**上的约束，不是风格偏好）────────────────────────────────
			*
			* 我第一版把它做成 prop，于是必须改 `MemberScreen.tsx` 去传 —— 而
			* **`MemberScreen.tsx` 不在本任务的 `inScope` 里**（闸门当场拒了，它是对的）。
			* ★ 而**就地读更好**：本行已经拿到了 `team`（它就在 props 上），再要调用方
			*   把 `team` 里的同一格拆出来单独传一遍是**多余的一跳**，而且多一个会漂移的接口。
			*/
			const catalog = gateCatalogOf(team);
			/**
			* ── ★★★ t82：把"名下还有没有活"交给状态点 ────────────────────────────────────
			*
			* ★ **纯派生**：`owned` 上面已经算好了（`tasks.filter(t => t.assignee === member.name)`）
			*   ⇒ 不新开任何数据通道、不读线上新字段。
			* ★ 终态判定复用 `activity-model.ts` 的 `memberHasOpenWork`（它又复用既有的
			*   `taskIsTerminal`）—— 与轮次投影、成员时钟**同一份**来源，不会各算各的。
			*/
			const dotTone = memberDotTone(member, {
				discarded,
				stopped,
				staged: team.phase === "staged",
				historic,
				openWork: memberHasOpenWork(owned)
			});
			/**
			* ── ★★★ B6：职责按**列数**折行 ──────────────────────────────────────────────
			*
			* ★ `MEMBER_ROLE_MAX_COLUMNS` 的来源**不是猜的**：面板最窄的容器是
			*   `@container agent-team (max-width: 360px)`（`ActivityPanel.module.css:1901`），
			*   而这一行左边还有状态点 + 间距 ⇒ 可用列数取 **44**（≈360px 在 12px 字号下
			*   能放的等宽列数，见本文档的反向半边 C 一节给出的逐行读数）。
			* ★ **上限 2 行**：职责最多占两行；再长靠 `title` 与展开层全文兜底。
			* ★ 折行本身是**纯函数**（`wrapByColumns`）⇒ "中文会不会溢出"可以在没有浏览器
			*   的地方被判据钉住。
			*/
			const roleLines = member.role === "" ? [] : wrapByColumns(member.role, MEMBER_ROLE_MAX_COLUMNS, MEMBER_ROLE_MAX_LINES);
			/**
			* ── ★★★ "它在做什么"，以及**三态下的终态口径**（原来长在面板里）─────────────
			*
			* ★ 一条被放弃的计划里的成员**不是**"待执行"：它**根本不会被创建**。
			*   MEASURED 的判据见 locales 的 `member.status.discarded` /
			*   `member.status.stopped` —— 两条文案说的都是"这一行不会再有下一步了"，
			*   而"待执行"会让读者以为它在排队。
			* ★ 计划待确认（`staged`）同样有自己的口径：它尚未被创建。
			*/
			const doing = discarded ? t("member.status.discarded") : stopped ? t("member.status.stopped") : team.phase === "staged" ? t("member.status.staged") : memberDoingText(member, current, owned, t);
			/**
			* ── ★★★ v4（甲）：行 2 = `第 N 轮 · 阶段 · 测试` ──────────────────────────────
			*
			* ★ 阶段**从任务状态推出**（`taskStage`），测试名从**转发过来的判据清单**里取 ——
			*   两处都不硬编码，于是换掉一条判据 ⇒ 行 2 自动跟着变（可插拔）。
			* ★ 候选按优先级排好（先省"测试"，再省"阶段"），渲染层取第一个放得下的。
			*/
			const stage = currentStage(current, owned);
			const groups = stageGroups(
				stage,
				catalog,
				current?.gateEvaluation,
				/** ★★ t81：按段字段（首选读法）。 */
				current?.gateEvaluations
			);
			const stageGroup = stage === void 0 ? void 0 : groups.find((group) => group.stage === stage);
			const testLabel = stageGroup === void 0 ? "" : testLabelOf(stageGroup);
			/**
			* ★★★ t80 缺陷①：轮次**在这里、且只在这里**渲染一次。
			*
			* ★ 经 `t('member.round.mark')` 而不是硬编码「第 N 轮」两步好处：
			*   · 这个词条仍是轮次的**唯一**出处（臂 25b 逐字钉住它出现在**本行**里）；
			*   · 缺席（没有带轮次的任务）⇒ `''` ⇒ **整段不出现**，而不是印"第 0 轮"
			*     （"没有轮次概念"与"第 0 轮"必须不同形）。
			*/
			const roundLabel = round === void 0 ? "" : t("member.round.mark", { round: round.round });
			/**
			* ★★ `doingLineCandidates` 内部硬编码了 `第 N 轮`（它在 `activity-model.ts` 里，
			*   **不在本任务写域**）⇒ 这里把那一小段**替换**为词条渲染的结果。
			*   MEASURED：不替换的话臂 25b 会红 —— 它逐字断言 `member.round.mark:2`
			*   出现在**本行**的渲染结果里，而硬编码那串**绕开了词条**。
			* ★ 只在行首匹配（`startsWith`），不会误伤任务名里恰好含同样字样的情形。
			*/
			/**
			* ★★ 替换的是候选**首段**（第一个 ` · ` 之前那段）—— 而不是 `startsWith('第 N 轮')`：
			*   词条渲染出来的是 `t('member.round.mark', …)` 的结果，它在真实 locale 下正好是
			*   「第 N 轮」，但在**夹具的 t 桩**下是 `member.round.mark:2` ⇒ 按字面 startsWith 匹配
			*   会**匹配不上、静默不替换**（而"没替换"与"替换了"在屏幕上同形 —— 正是本仓纪律
			*   要挡的那种）。⇒ 按**位置**（首段）替换，与文案无关。
			*/
			const line2 = roundLabel === "" ? doingLineCandidates(round?.round, stage, testLabel) : doingLineCandidates(round?.round, stage, testLabel).map((candidate) => {
				const separator = candidate.indexOf(" · ");
				return separator === -1 ? roundLabel : `${roundLabel}${candidate.slice(separator)}`;
			});
			/**
			* ★★★ t80 缺陷②：把分组切成「本轮真跑了的」与「没有落盘读数的」两块。
			*   ★ 读数在**渲染期之外**算（纯函数）⇒ 两块的分辨力可以被独立检验，
			*     而不是藏在一个组件的分支里。
			*/
			const split = splitStageGroups(groups);
			const toggle = (0, react.useCallback)(() => {
				onToggle(key);
			}, [key, onToggle]);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ActivityPanel_module_css_default.memberBlock,
				"data-activity": member.activity,
				"data-member-key": key,
				"data-member-expanded": expanded ? "true" : "false",
				"data-member-gate-tone": memberGateTone(stage, groups),
				children: [
					(0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ActivityPanel_module_css_default.memberRow,
						"data-activity": member.activity,
						"data-member-toggle": key,
						"aria-expanded": expanded,
						onClick: toggle,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.memberDot,
							"data-tone": dotTone,
							role: "img",
							"aria-label": t(CLOCK_LABEL[clock.kind], { elapsed: "" })
						}), (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.memberInfo,
							children: [
								(0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.memberLine,
									children: [
										(0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberName,
											children: member.name
										}),
										member.unread > 0 && (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberUnread,
											"data-unread": "true",
											"aria-hidden": true
										}),
										memberModel !== "" && (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberModel,
											role: "img",
											"data-member-model": memberModel,
											"data-member-model-state": editable,
											title: editable === "sealed" ? t("member.model.sealedReason") : memberModel,
											"aria-label": memberModel,
											children: compactModelLabel(memberModel)
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberStatusLine,
											title: doing,
											children: doing
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberStatusTail,
											children: (0, react_jsx_runtime.jsx)(MemberClock, {
												kind: clock.kind,
												stamp,
												frozenNow,
												t
											})
										}),
										(0, react_jsx_runtime.jsx)(IconChevronDownOutline14, {})
									]
								}),
								member.role !== "" && (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.memberRoleLine,
									"data-member-role": member.role,
									"data-member-role-columns": charColumns(member.role),
									"data-member-role-lines": roleLines.length,
									title: member.role,
									children: roleLines.map((line, index) => (0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.memberRoleRow,
										"data-member-role-row": index,
										children: line
									}, `${index}-${line}`))
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.memberStageLine,
									"data-line2": line2[0],
									"data-line2-level": 0,
									children: [line2[0], round !== void 0 && round.tasks.length > 0 && (0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.memberStageTasks,
										"data-member-round": round.round,
										"data-tone": discarded ? "cancelled" : round.tone,
										children: round.tasks.map((task) => (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: ActivityPanel_module_css_default.memberRoundTask,
											"data-tone": discarded ? "cancelled" : task.round === void 0 ? "open" : round.tone,
											onClick: (event) => {
												/** ★ 这一行整体是个展开/收起的 `<button>` ⇒ 必须拦住冒泡，否则点任务会顺带折叠。 */
												event.stopPropagation();
												onSelectTask?.(task.id);
											},
											title: `${task.id}`,
											children: task.id
										}, task.id))
									})]
								})
							]
						})]
					}),
					editable === "editable" && modelDirectory !== void 0 && !discarded && !stopped && team.phase !== "staged" && (0, react_jsx_runtime.jsx)("div", {
						style: MEMBER_MODEL_LINE_STYLE,
						"data-member-model-editable": true,
						children: (0, react_jsx_runtime.jsx)(MemberModelField, {
							team,
							member,
							modelDirectory,
							disabledReason: void 0,
							t
						})
					}),
					expanded && (0, react_jsx_runtime.jsxs)("div", {
						className: ActivityPanel_module_css_default.memberSubagents,
						"data-member-subagents": key,
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: ActivityPanel_module_css_default.memberExpandedFacts,
								children: [
									member.role !== "" && (0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.memberExpandedRole,
										children: member.role
									}),
									memberModel !== "" && (0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.memberExpandedModel,
										children: memberModel
									}),
									(0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.memberExpandedDoing,
										children: doing
									})
								]
							}),
							catalog.length === 0 ? (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.memberGateNote,
								"data-member-gates": key,
								"data-member-gates-readout": "no-catalog",
								children: t("member.gates.noCatalog")
							}) : 
							/**
							* ★ 空段（`rows.length === 0`）**两块都不进** ⇒ `admission 0 条` 不显示
							*   （规格硬约束 4）。而"不显示"与"显示 0 条"不同形 —— 后者会让人以为
							*   那个位置该有判据却没有。
							*/
(0, react_jsx_runtime.jsxs)("div", {
								className: ActivityPanel_module_css_default.memberStageBlocks,
								"data-member-gates": key,
								children: [split.ran.length > 0 && (0, react_jsx_runtime.jsxs)("ul", {
									className: ActivityPanel_module_css_default.memberGateList,
									"data-gate-block": "ran",
									children: [(0, react_jsx_runtime.jsxs)("li", {
										className: ActivityPanel_module_css_default.memberStageSummary,
										"data-gate-block-summary": "ran",
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberStageMark,
											"data-stage-mark": "passed",
											children: "✓"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberStageSummaryText,
											children: t("member.gates.ranSummary", {
												count: String(stageGroupCount(split.ran)),
												stages: split.ran.map((group) => group.stage).join("、")
											})
										})]
									}), split.ran.map((group) => (0, react_jsx_runtime.jsxs)("li", {
										className: ActivityPanel_module_css_default.memberStageGroup,
										"data-member-stage": group.stage,
										"data-member-gate": key,
										"data-member-gate-state": group.state,
										"data-member-gate-readout": group.hasVerdicts ? "verdict" : "registered",
										"data-member-stage-state": group.state,
										"data-stage-state": group.state,
										"data-stage-has-verdicts": group.hasVerdicts ? "true" : "false",
										"data-stage-absence": group.absence ?? "none",
										children: [(0, react_jsx_runtime.jsxs)("span", {
											className: ActivityPanel_module_css_default.memberStageHead,
											children: [
												(0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.memberStageMark,
													"data-stage-mark": group.state,
													children: GATE_GLYPH[group.state]
												}),
												(0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.memberStageName,
													children: group.stage
												}),
												(0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.memberStageCount,
													children: group.absence === void 0 ? t("member.gates.count", { count: String(group.rows.length) }) : t(ABSENCE_LOCALE_KEY[group.absence])
												})
											]
										}), (0, react_jsx_runtime.jsx)(StageRows, { rows: group.rows })]
									}, group.stage))]
								}), split.silent.length > 0 && (0, react_jsx_runtime.jsx)("ul", {
									className: ActivityPanel_module_css_default.memberGateList,
									"data-gate-block": "silent",
									"data-gate-readout-absent": String(stageGroupCount(split.silent)),
									children: (0, react_jsx_runtime.jsxs)("li", {
										className: ActivityPanel_module_css_default.memberStageSummary,
										"data-gate-block-summary": "silent",
										children: [
											(0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberStageMark,
												"data-stage-mark": "registered",
												children: "○"
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberStageSummaryText,
												children: t("member.gates.silentSummary", { count: String(stageGroupCount(split.silent)) })
											}),
											(0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberStageSummaryDetail,
												children: split.silent.map((group) => `${group.stage} ${t("member.gates.noVerdicts", { count: String(group.rows.length) })}`).join(" · ")
											})
										]
									})
								})]
							}),
							subs.state === "could-not-measure" ? (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.memberSubagentNote,
								"data-subagent-readout": "could-not-measure",
								title: subs.reason,
								children: t("subagent.unmeasured", { reason: subs.reason ?? "" })
							}) : subs.subagents.length === 0 ? (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.memberSubagentNote,
								"data-subagent-readout": "observed-empty",
								children: t("subagent.none")
							}) : (0, react_jsx_runtime.jsx)("ul", {
								className: ActivityPanel_module_css_default.memberSubagentList,
								children: subs.subagents.map((subagent) => (0, react_jsx_runtime.jsxs)("li", {
									className: ActivityPanel_module_css_default.memberSubagent,
									"data-subagent-id": subagent.id,
									"data-tone": subagentTone(subagent.status),
									children: [
										(0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberSubagentDot,
											"data-tone": subagentTone(subagent.status),
											"aria-hidden": true
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: ActivityPanel_module_css_default.memberSubagentOpen,
											"data-subagent-open": subagent.id,
											onClick: () => {
												onOpenSubagent(subagent.id);
											},
											title: subagent.id,
											children: [(0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberSubagentLabel,
												children: subagent.label !== "" ? subagent.label : subagent.id
											}), (0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberSubagentDoing,
												children: subagentDoingText(subagent, t)
											})]
										}),
										(0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberSubagentMode,
											children: subagent.mode === void 0 ? "" : t(subagent.mode === "continuable" ? "subagent.mode.continuable" : "subagent.mode.oneShot")
										})
									]
								}, subagent.id))
							}),
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.memberOpenSession,
								"data-member-open-session": member.id,
								disabled: member.id === "",
								title: member.id === "" ? t("member.openSession.unavailable") : t("member.openSession"),
								onClick: () => {
									if (member.id === "") return;
									onOpenSubagent(member.id);
								},
								children: t("member.openSession")
							})
						]
					})
				]
			});
		}
		/**
		* ── ★★★ t80：一个阶段里**逐条**判据的列表 ──────────────────────────────────────
		*
		* ★ 抽成组件而不是内联，理由与 `StageRows` 这个名字同一件：**两块（ran / silent）
		*   共用同一套逐条渲染**时，抽出来才能保证"跑了的"与"没读数的"**不会各写一份**
		*   —— 而两份一定会漂移（本仓判据：「第二份实现一定会漂移」）。
		*
		* ★ 每条自带 `data-gate-state`（六态之一）与它自己的符号 ⇒
		*   "通过了 / 没跑 / 跳过了"三者在 DOM 上就是三个不同的值。
		* ★★ 旧探针 `data-verdict` / `data-observed` 以**别名**保留在这里（臂 27 逐条比对
		*   `data-*`）：逐条裁决原来印在 `memberGateEntry` 那一族上，v4 换了承载
		*   （`data-gate-state`），但**事实是同一件**。`data-observed` 只在"观察模式放过"
		*   时为 `'true'` 在场 —— 与旧处同一缺席语义（**不是 false，是不在**）。
		* @param rows - the criteria to draw, in registration order.
		*/
		function StageRows({ rows }) {
			if (rows.length === 0) return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, {});
			return (0, react_jsx_runtime.jsx)("ul", {
				className: ActivityPanel_module_css_default.memberStageRows,
				children: rows.map((row) => (0, react_jsx_runtime.jsxs)("li", {
					className: ActivityPanel_module_css_default.memberStageRow,
					"data-gate-id": row.id,
					"data-gate-state": row.state,
					"data-gate-observing": row.observing ? "true" : "false",
					"data-verdict": row.state === "passed" ? "ok" : row.state === "skipped" ? "skipped" : row.state === "observed" ? "blocked" : void 0,
					"data-observed": row.state === "observed" ? "true" : void 0,
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.memberStageRowMark,
							"data-gate-mark": row.state,
							children: rowGlyph(row)
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.memberStageRowId,
							title: row.id,
							children: row.id
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.memberStageRowDesc,
							children: row.description
						})
					]
				}, row.id))
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/abab/Desktop/agent-teams-dev/src/client/ProgressSummary.module.css.mjs
		const css$6 = ".R8RXwW_progressOverview{flex-direction:column;gap:7px;display:flex}.R8RXwW_progressSummary{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-1));min-width:0;color:var(--dsw-alias-label-secondary);border-radius:8px;align-items:center;gap:6px;padding:5px 8px;font-size:10px;font-weight:600;line-height:15px;display:flex}.R8RXwW_progressSummary[data-state=warning]{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dsw-alias-bg-layer-1))}.R8RXwW_progressSummary[data-state=completed]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, var(--dsw-alias-bg-layer-1))}.R8RXwW_progressSummary[data-state=discarded]{background:var(--dsw-alias-button-ghost-active-fill)}.R8RXwW_progressSummary>span:last-child{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.R8RXwW_progressSummaryDot{background:var(--dsw-alias-state-business-primary);border-radius:50%;flex:none;width:5px;height:5px}.R8RXwW_progressSummary[data-state=warning] .R8RXwW_progressSummaryDot{background:var(--dsw-alias-state-warn-primary)}.R8RXwW_progressSummary[data-state=completed] .R8RXwW_progressSummaryDot{background:var(--dsw-alias-state-success-primary)}.R8RXwW_progressSummary[data-state=discarded] .R8RXwW_progressSummaryDot{background:var(--dsw-alias-label-tertiary)}";
		const tagId$6 = "@nanmicoder/dsh-agent-teams/ProgressSummary.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$6) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId$6;
			tag.textContent = css$6;
			document.head.appendChild(tag);
		}
		var ProgressSummary_module_css_default = {
			"progressOverview": "R8RXwW_progressOverview",
			"progressSummary": "R8RXwW_progressSummary",
			"progressSummaryDot": "R8RXwW_progressSummaryDot"
		};
		//#endregion
		//#region lib/client/ProgressSummary.js
		/**
		* Screen one's progress readout: one sentence plus a tone dot.
		*
		* ── ★★★ R4：从 `ActivityPanel.tsx` 整块搬出来（纯搬运）─────────────────────────
		*
		* `taskSummary` 与 `ProgressOverview` 是**同一件事**（"这一队做到哪了"）的两半：
		* 前者把持久任务状态翻成一句人话，后者把那句话连同一个语气点画出来。它们
		* 分开在两个文件里没有意义，所以一起搬。
		*
		* ★ R3 已经把色块条与图例删掉了（那是同一个数字的第二、三次表述），
		*   所以这里只剩"一句话 + 一个点" —— 搬动**不带回**任何被删掉的东西。
		* ★ 文案分支顺序原样保留：重排会让两个读数在边界输入上换位。
		* @module dsh-agent-teams/client/progress-summary
		*/
		function taskSummary(team, t, discarded = false) {
			const completed = team.tasks.filter((task) => task.status === "completed");
			const cancelled = team.tasks.filter((task) => task.status === "cancelled");
			const running = team.tasks.filter((task) => task.state === "running");
			const blocked = team.tasks.filter((task) => task.state === "blocked");
			const ready = team.tasks.filter((task) => task.state === "open" && task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled");
			const failed = team.tasks.filter((task) => task.status === "failed");
			if (discarded) return t("task.summary.discarded", { count: team.tasks.length });
			if (team.tasks.length === 0) return t("task.summary.waitingBreakdown");
			if (team.phase === "staged") return t("task.summary.staged", { count: team.tasks.length });
			if (completed.length === team.tasks.length) return t("task.summary.allDelivered", { count: completed.length });
			if (completed.length + cancelled.length + failed.length === team.tasks.length) return t("task.summary.ended", {
				completed: completed.length,
				cancelled: cancelled.length,
				failed: failed.length
			});
			if (failed.length > 0 && running.length === 0 && ready.length === 0 && blocked.length === 0) return t("task.summary.failedSettled", { count: failed.length });
			if (blocked.length > 0 && running.length > 0) return t("task.summary.blockedAndRunning", {
				tasks: formatTaskIds(blocked.slice(0, 3).map((task) => task.id), t),
				more: blocked.length > 3 ? t("task.summary.more", { count: blocked.length - 3 }) : ""
			});
			if (running.length > 0) return t("task.summary.running", { tasks: formatTaskIds(running.map((task) => task.id), t) });
			if (ready.length > 0) return t("task.summary.ready", { tasks: formatTaskIds(ready.map((task) => task.id), t) });
			if (blocked.length > 0) return t("task.summary.blocked", { tasks: formatTaskIds(blocked.map((task) => task.id), t) });
			return t("task.summary.waitingSchedule");
		}
		/**
		* ── ★★★ R2：秒表**不再**长在这里 ──────────────────────────────────────────────
		*
		* MEASURED：这里原来有一个 `useElapsedNow(active)` —— 它把 `now` 放进
		* `TeamSection` 的 state，于是**每秒**整棵面板树重渲染（契约原句：
		* "a tick must not re-render the 1586-line panel it sits inside"）。
		*
		* ★ 修法不是"少 tick 几次"，而是**搬家**：`now` 的 state 与 `setInterval`
		*   都搬进 `MemberClock.tsx`（一个只印一行时长的小组件）。本组件**不持有** `now`，
		*   所以它没有任何理由跟着 tick 重渲染。
		* ★ 而"只有真的在跑的成员才起表"由 `memberClockTicks` 判定（见 activity-model）。
		*/
		/**
		* ── ★★★ R3：进度**读数**只留一句话，色块条与图例都去掉 ────────────────────────────
		*
		* MEASURED（用户原话）：「整个东西挺冗余的，比如它做一些 badge 之类的东西」。
		*
		* ★ 原来的三件套是**同一个事实的三次表述**：
		*   · `progressSegments` —— 一排色块，每块一个任务；而"完成了几项"在下面那行
		*     已经用数字说了，色块只是把同一件事画了一遍；
		*   · `progressLegend` —— `■ 进行中 N / ■ 等待依赖 N / ■ 已交付 N`；其中
		*     "已交付 N" 与团队头上的 `{completed}/{total} 完成` 是**同一个数**；
		*   · `progressSummary` —— 一句人话的总结，**这一件留下**，因为它说的
		*     "等待前置/正在执行/全部交付"是前两者都没说的。
		*
		* ⇒ 减法之后：一句总结 + 一个语气点。数字仍在（团队头的 completed/total、
		*   成员行自己的 done/total），所以**没有任何读数丢失**。
		*/
		function ProgressSummary({ team, t, discarded = false }) {
			const blocked = discarded ? 0 : team.tasks.filter((task) => task.state === "blocked").length;
			const settled = !discarded && team.tasks.length > 0 && team.tasks.every((task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled");
			const summaryTone = discarded ? "discarded" : blocked > 0 || team.tasks.some((task) => task.status === "failed" || task.status === "cancelled") ? "warning" : settled ? "completed" : "running";
			if (team.tasks.length === 0) return null;
			return (0, react_jsx_runtime.jsx)("section", {
				className: ProgressSummary_module_css_default.progressOverview,
				"aria-label": t("progress.aria"),
				"data-progress-summary": true,
				children: (0, react_jsx_runtime.jsxs)("span", {
					className: ProgressSummary_module_css_default.progressSummary,
					"data-state": summaryTone,
					children: [(0, react_jsx_runtime.jsx)("span", { className: ProgressSummary_module_css_default.progressSummaryDot }), (0, react_jsx_runtime.jsx)("span", { children: taskSummary(team, t, discarded) })]
				})
			});
		}
		//#endregion
		//#region lib/client/MemberScreen.js
		/**
		* Screen one: the members, and what each of them is doing.
		*
		* ── ★★★ R4：这块内容原来内联在 `TeamSection` 的返回体里（纯搬运）─────────────────
		*
		* 用户对第一屏的口径（R2 立的）：「the first screen should show durable roles,
		* and clicking one expands to show the subagents working underneath it, together
		* with round information」。
		*
		* ★ 而它此前**没有自己的模块**：`TeamSection` 同时渲染两块屏，于是"第一屏由什么
		*   组成"只能靠读一个 1171 行的文件回答；两块屏共用一层容器网格，正是
		*   `docs/T30-LAYOUT-FINDING.md` 记下的那个布局缺陷的温床。
		*
		* ★ 这是**纯搬运**：队长行、终态提示、进度读数、成员开关与成员列表，逐块照搬，
		*   一个 `data-*` 探针、一句文案都没改。R4 的集合臂会机械核对这一点。
		* @module dsh-agent-teams/client/member-screen
		*/
		/**
		* Render screen one.
		*
		* ★ 成员的展开状态**留在这里**（而不是提到面板）：它是一个"这一屏看得怎么样"的
		*   本地读数，面板不需要知道它。而它按**成员 id** 存 —— 轮询会重排名册，
		*   按位置存会把一个成员的展开状态交给另一个成员。
		*/
		function MemberScreen({ team, modelDirectory, onNavigateMember, onSelectTask, t, historic = false, workspace = false, discarded, stopped, staged, awaitingFeedback, captainBusy, busyCount, allCompleted, allSettled, assignedCount, captainTaskIds }) {
			/**
			* ★ 默认**收起**（`workspace` 时展开）：`memberRowExpanded` 对"没有条目"返回
			*   `false`，所以初值是一个**值**，不是一条缺席分支 —— 一次新渲染不可能顺手
			*   把每一行都打开。
			*/
			const [membersOpen, setMembersOpen] = (0, react.useState)(workspace);
			const [expansion, setExpansion] = (0, react.useState)(() => /* @__PURE__ */ new Map());
			const toggleMember = (0, react.useCallback)((key) => {
				setExpansion((current) => toggleMemberRow(current, key));
			}, []);
			/**
			* ★ 剪掉不在册的展开条目。放在 effect 里而**不是**渲染期：渲染必须是纯的。
			*   store 只在用户真的按过某一行时才有条目，所以这里剪的永远是"被重生成
			*   替换掉的那一行"留下的残条。
			*/
			const rosterKey = team.members.map((member) => memberRowKey(member)).join("\0");
			(0, react.useEffect)(() => {
				setExpansion((current) => pruneMemberRows(current, rosterKey === "" ? [] : rosterKey.split("\0")));
			}, [rosterKey]);
			const orderedMembers = orderDelegationMembers(team.members, team.tasks);
			/**
			* ★ "谁在动"这条折叠口径保留（issue #192）：收起时只列**还在动**的成员，
			*   展开时把已结束的也列出来并按结束时间倒序。原因没变 —— 一个不动的成员
			*   占着行会让"整队在不在动"这个第一问读不出来。
			*/
			const runningMembers = orderedMembers.filter((member) => member.activity === "working" || member.status === "working" || team.tasks.some((task) => task.assignee === member.name && (task.status === "pending" || task.status === "claimed" || task.status === "in_progress")));
			const visibleMembers = membersOpen ? orderedMembers : runningMembers;
			const hiddenFinishedCount = orderedMembers.length - visibleMembers.length;
			const expandLabel = membersOpen ? t("members.collapse") : hiddenFinishedCount > 0 ? t("members.expandFinished", { count: hiddenFinishedCount }) : t("members.expand");
			return (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.delegationSection,
				"aria-label": t("delegation.aria"),
				"data-delegation-map": true,
				children: [
					(0, react_jsx_runtime.jsx)(CaptainNode, {
						discarded,
						captainBusy,
						busyCount,
						allCompleted,
						allSettled,
						staged,
						awaitingFeedback,
						assignedCount,
						captainTaskIds,
						taskCount: team.tasks.length,
						memberCount: team.members.length,
						t
					}),
					(discarded || stopped) && (0, react_jsx_runtime.jsx)("p", {
						className: ActivityPanel_module_css_default.teamTerminalNote,
						"data-team-terminal": discarded ? "discarded" : "stopped",
						children: discarded ? t("member.status.discarded") : t("member.status.stopped")
					}),
					(0, react_jsx_runtime.jsx)(ProgressSummary, {
						team,
						t,
						discarded
					}),
					(0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ActivityPanel_module_css_default.membersToggle,
						onClick: () => {
							setMembersOpen((current) => !current);
						},
						"aria-expanded": membersOpen,
						"data-members-toggle": true,
						children: [(0, react_jsx_runtime.jsxs)("span", { children: [(0, react_jsx_runtime.jsx)(Chevron, { open: membersOpen }), t("members.toggle", { count: team.members.length })] }), (0, react_jsx_runtime.jsx)("span", { children: expandLabel })]
					}),
					(membersOpen || visibleMembers.length > 0) && (0, react_jsx_runtime.jsxs)("div", {
						className: ActivityPanel_module_css_default.delegationTree,
						"data-member-rows": visibleMembers.length,
						children: [team.members.length === 0 && (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.emptyHint,
							children: t("members.empty")
						}), visibleMembers.map((member) => {
							const key = memberRowKey(member);
							/**
							* ── ★★ 面板在这一行上**探出**两件事，而不是"把它们交给子组件就算完"──
							*
							* ① `activity`：收起的成员列表要一眼看出"这一行在不在动"，
							*    而 `data-activity` 是宿主语义色（business color）挂上去的那个钩子。
							* ② `memberModel`：这个成员跑在哪个路由上 —— 用户要的第一屏是
							*    "谁在做什么"，而"用哪个模型做"是这件事的一部分。
							*
							* ★ 两格都是**读**，不是第二份真相：`MemberRow` 用的是同一个
							*   `memberRouteLabel` / `member.activity`，判定口径只有一个。
							*/
							const memberModel = memberRouteLabel(member);
							/**
							* ★ "这个成员正在做什么"，到**任务 + 模型**这一层。
							*   读不出当前任务时不编一个（`member.status.working` 兜底）。
							*/
							const currentTask = team.tasks.find((task) => task.id === member.currentTask && task.assignee === member.name);
							const doingModel = currentTask === void 0 ? "" : taskModelLabel(currentTask, [member]);
							const doingText = currentTask === void 0 ? t("member.status.working") : doingModel === "" ? t("member.status.executing", { taskId: currentTask.id }) : t("member.status.executingModel", {
								taskId: currentTask.id,
								model: doingModel
							});
							return (0, react_jsx_runtime.jsx)("div", {
								/**
								* ★ 槽的**布局类**由这一屏给：这一行有没有模型，这一层知道；
								*   而 `.memberModel` 是"就地省略号、不撑破面板"的排版口径。
								*/
								className: memberModel === "" ? ActivityPanel_module_css_default.memberSlot : `${ActivityPanel_module_css_default.memberSlot} ${ActivityPanel_module_css_default.memberModel}`,
								"data-activity": member.activity,
								"data-member-doing": doingText,
								children: (0, react_jsx_runtime.jsx)(MemberRow, {
									team,
									member,
									tasks: team.tasks,
									memberModel,
									memberModelEditable: memberModelEditability(member),
									expanded: memberRowExpanded(expansion, key),
									onToggle: toggleMember,
									onOpenSubagent: onNavigateMember,
									onSelectTask,
									modelDirectory,
									t,
									historic,
									discarded,
									stopped
								})
							}, key);
						})]
					})
				]
			});
		}
		//#endregion
		//#region lib/client/session-navigation.js
		/** Version-tolerant navigation into durable AgentTeams member transcripts. */
		/** Newer sessions retain view ownership instead of publishing list.current. */
		function currentSessionId(state) {
			if ("current" in state) return state.current;
			return Object.values(state.byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id;
		}
		/**
		* Open one member's persisted transcript.
		*
		* Harness rc.8 intentionally removed cold subagents from the ordinary session
		* list. They must first be rediscovered in their parent's catalog, then opened
		* with the exact parent/child/mode address. Older runtimes have only `open()`;
		* the fallback preserves ordinary-session navigation. New layouts also select
		* the Conversation panel and cancel catalog refreshes superseded by navigation.
		*/
		async function openAgentTeamMember(sessions, parentSessionId, childSessionId, layout, workspace) {
			if (sessions.open === void 0 && workspace !== void 0) {
				workspace.openSession({
					parentSessionId,
					childSessionId,
					mode: "continuable"
				});
				return "subagent";
			}
			const navigation = layout?.beginNavigation?.();
			if (sessions.openSubagent === void 0 || sessions.refreshSubagents === void 0) {
				if (sessions.open === void 0) throw new Error("Harness does not expose session navigation");
				sessions.open(childSessionId);
				layout?.selectPanel?.(null);
				return "session";
			}
			await sessions.refreshSubagents(parentSessionId);
			if (navigation?.aborted) return "cancelled";
			const retained = sessions.subagentAddress?.(childSessionId);
			sessions.openSubagent(retained?.parentSessionId === parentSessionId ? retained : {
				parentSessionId,
				childSessionId,
				mode: "continuable"
			});
			layout?.selectPanel?.(null);
			return "subagent";
		}
		//#endregion
		//#region lib/client/activity-monitor.js
		/**
		* ── ★★★ t102：`captainInbox` 的第一个消费者 ──────────────────────────────────────
		*
		* ── 它修的是什么（MEASURED）────────────────────────────────────────────────────
		*
		* 改前全仓 `captainInbox` 只有两处（`grep -rn "captainInbox" src/client/`）：
		*
		*     activity-monitor.ts:143   readonly captainInbox: readonly ActivityMessage[]   ← 只有声明
		*     ActivityPanel.tsx:362     captainInbox: [],                                   ← 硬编码空
		*
		* 而**活的那条路**（`body.teams as readonly ActivityTeam[]`）是**纯类型断言**：
		* 服务端给什么就是什么 ⇒ `captainInbox` **没有任何东西保证它存在**。
		* ⇒ 服务端**没给**时 `team.captainInbox` 是 `undefined`，而类型说它是数组 ——
		*   ★ **「没给」与「给了空数组」在类型上同形**，而那正是本仓记账最久的形状。
		*
		* ── ★★ 三态（本函数的全部意义）─────────────────────────────────────────────────
		*
		*     'absent'    —— 服务端**没给**这个字段（字段缺席 / 不是数组 / `null`）
		*                    ★ 与"给了空数组"**不同形**：前者是"读不到"，后者是"确实没有"
		*     'empty'     —— 服务端**给了**，而且是空数组（真的没有消息）
		*     'present'   —— 服务端给了 N 条
		*
		* ★ 为什么 `'absent'` 不熔进 `'empty'`：那会让「**这支队读不到消息**」与
		*   「**这支队没有消息**」变成同一句话 —— 而补救动作相反（前者要查服务端，后者什么都不用做）。
		*
		* ── 为什么在**这里**做，而不是在渲染处 ──────────────────────────────────────────
		*
		* 渲染是形态决策（队长在等用户定 A/B/C），本任务边界是**让数据可读**。
		* ⇒ 这里只保证"读得到且三态可分"，不决定画在哪。
		*
		* @param raw - the raw payload field, of unknown shape.
		* @returns the readout, plus the rows themselves (empty unless present).
		*/
		function readCaptainInbox(raw) {
			if (!Array.isArray(raw)) return {
				state: "absent",
				messages: [],
				unreadable: 0
			};
			const messages = [];
			let unreadable = 0;
			for (const entry of raw) {
				const row = entry;
				/**
				* ★ 只要求**形状的最小必需集**：`from` / `content`。
				*   其余格（`id` / `to` / `ts` / `read`）在旧载荷里可能缺席 ——
				*   按缺席给**保守默认**，但**不猜成"已读"**（那会让没读过的看起来读过了）。
				*/
				if (row === null || row === void 0 || typeof row.from !== "string" || typeof row.content !== "string") {
					unreadable += 1;
					continue;
				}
				messages.push({
					id: typeof row.id === "string" ? row.id : "",
					from: row.from,
					to: typeof row.to === "string" ? row.to : "",
					content: row.content,
					ts: typeof row.ts === "number" ? row.ts : 0,
					...row.taskId === void 0 ? {} : { taskId: row.taskId },
					...row.attemptId === void 0 ? {} : { attemptId: row.attemptId },
					...row.taskStatus === void 0 ? {} : { taskStatus: row.taskStatus },
					/** ★ 只认字面 `true`：缺省 ⇒ **未读**（保守），而不是"已读"。 */
					read: row.read === true
				});
			}
			return messages.length === 0 ? {
				state: "empty",
				messages: [],
				unreadable
			} : {
				state: "present",
				messages,
				unreadable
			};
		}
		/** A successfully-created conversation card that currently needs updates. */
		/**
		* ── ★★★ t102：把 `/state` 的原始 team 行过一遍 `captainInbox` 校验 ────────────────
		*
		* 改前那一行是**纯类型断言**（`body.teams as readonly ActivityTeam[]`）——
		* 于是 `captainInbox` **从来没有被读过**：服务端给没给，客户端都只是"信类型"。
		*
		* ★ 这里**只**补 `captainInbox` 一格，**不动**其它格：
		*   其余格的校验属于各自的改动，一起做会让"我改了哪一格"在回归里**同形**。
		* ★ 且它**不抛**：读不到就把状态如实报出来（`absent` / `empty` / `present`）。
		*   抛出去会被外层的 `catch` 吞掉，而那条路会让**整支队从列表里消失** ——
		*   "这支队读不到"与"这支队不存在"同形（t100 记过同一形状）。
		*/
		function withCaptainInbox(raw) {
			if (raw === null || typeof raw !== "object") return void 0;
			const team = raw;
			const inbox = readCaptainInbox(team.captainInbox);
			return {
				...team,
				captainInbox: inbox.messages,
				captainInboxState: inbox.state,
				captainInboxUnreadable: inbox.unreadable
			};
		}
		/**
		* Project the raw `/state` teams through {@link withCaptainInbox}, dropping
		* rows that are not objects at all (those are unreadable, not empty).
		*/
		function projectTeams(raw) {
			const out = [];
			for (const entry of raw) {
				const projected = withCaptainInbox(entry);
				if (projected !== void 0) out.push(projected);
			}
			return out;
		}
		const targets = /* @__PURE__ */ new Map();
		const targetListeners = /* @__PURE__ */ new Set();
		const snapshotListeners = /* @__PURE__ */ new Set();
		let targetSnapshot = [];
		let activitySnapshots = {
			teams: [],
			archivedTeams: []
		};
		function targetKey(sessionId, teamId) {
			return `${sessionId}\u0000${teamId}`;
		}
		function publishTargets() {
			targetSnapshot = [...targets.values()].filter((target) => target.active).map(({ key, sessionId, teamId }) => ({
				key,
				sessionId,
				teamId
			}));
			for (const listener of targetListeners) listener();
		}
		/** Subscribe to the active monitor-target list (React external-store shape). */
		function subscribeActivityMonitorTargets(listener) {
			targetListeners.add(listener);
			return () => {
				targetListeners.delete(listener);
			};
		}
		/** Read the stable active-target snapshot. */
		function getActivityMonitorTargetsSnapshot() {
			return targetSnapshot;
		}
		/**
		* Register one successful AgentTeams card as a monitoring demand.
		*
		* The returned cleanup is reference-counted so multiple cards and React
		* StrictMode remounts cannot stop another card's monitor.
		*/
		function monitorAgentTeam(sessionId, teamId) {
			const owner = sessionId.trim();
			const id = teamId.trim();
			if (owner === "" || id === "") return () => {};
			const key = targetKey(owner, id);
			const existing = targets.get(key);
			if (existing === void 0) {
				targets.set(key, {
					key,
					sessionId: owner,
					teamId: id,
					refs: 1,
					active: true
				});
				publishTargets();
			} else {
				existing.refs += 1;
				if (!existing.active) {
					existing.active = true;
					publishTargets();
				}
			}
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const current = targets.get(key);
				if (current === void 0) return;
				current.refs -= 1;
				if (current.refs <= 0) {
					targets.delete(key);
					if (current.active) publishTargets();
				}
			};
		}
		/** Stop polling targets whose final archived snapshot has been captured. */
		function settleActivityMonitorTargets(keys) {
			let changed = false;
			for (const key of keys) {
				const target = targets.get(key);
				if (target?.active !== true) continue;
				target.active = false;
				changed = true;
			}
			if (changed) publishTargets();
		}
		/** Subscribe to the shared live/archive snapshot. */
		function subscribeActivitySnapshots(listener) {
			snapshotListeners.add(listener);
			return () => {
				snapshotListeners.delete(listener);
			};
		}
		/** Read the stable shared live/archive snapshot. */
		function getActivitySnapshotsSnapshot() {
			return activitySnapshots;
		}
		/**
		* ── ★★★ t31：两个 snapshot 载荷**按内容**相等吗（而不是按对象身份）──────────────
		*
		* ── 它修的是什么（MEASURED，captain 实测）──────────────────────────────────────
		*
		* `updateActivitySnapshots` 此前用**引用**比较做闸门：
		*
		*     if (next.teams === activitySnapshots.teams
		*         && next.archivedTeams === activitySnapshots.archivedTeams) return
		*
		* ★ 而派发那一段每次都用 `response.json()` 造载荷（`JSON.parse` 的语义）——
		*   它**每次都新建一个对象图**。⇒ 两次**逐字节相同**的响应是两个不同的对象：
		*
		*     JSON.parse(s).teams === JSON.parse(s).teams   ⇒   **false**
		*
		* ⇒ 那个闸门**永远不成立** ⇒ 每一次成功的轮询都通知**每一个**订阅者 ⇒
		*   每秒一次全量重渲染（`ACTIVITY_POLL_MS = 1000`），即使一个字节都没变。
		*
		* ★ 用户的框定就是需求本身：**这是一层 projection** —— 它应该在
		*   **有东西变了**的时候重渲染，且只在那时候。
		*
		* ── ★★★ 为什么是"逐字段 + 只在字段真的被带上时才算" ─────────────────────────────
		*
		* `next` 是**合并**出来的（`update.teams ?? activitySnapshots.teams`）——
		* ⇒ 一次只带 `archivedTeams` 的调用，会让 `next.teams` **就是**旧的那个引用。
		*   于是"两个字段都按内容比"会把这种调用读成"没变"。那是对的，但**理由要写清**：
		*
		*     调用方交上来的那个字段           ⇒ 与旧值**按内容**比
		*     调用方**没**交上来的那个字段      ⇒ 沿用旧值 ⇒ **按定义没有变**（不是"比出来相等"）
		*
		* ★★ 这两条必须分开，否则会撞上两个相反方向的错：
		*   · 把"没交上来"也拿去按内容比 ⇒ 白比一次（结论相同，但语义不清）；
		*   · 把"交上来了但内容相同"当成变了 ⇒ **这正是本任务要修的那个 bug 的另一半**
		*     （只不过判据从"引用不同"换成"内容不同"而已）。
		*
		* ── ★★ 归档路径**不许**被这条去重削弱（验收第 5 条）─────────────────────────────
		*
		* 归档载荷走的是**另一个字段**（`archivedTeams`），而上面这条逐字段比较天然
		* 把它们分开：
		*
		*     归档变了、活的那个没变  ⇒ `archivedTeams` 那一半不等 ⇒ **通知**（正确）
		*     只有活的那个变了        ⇒ `archivedTeams` 沿用旧值   ⇒ 仍按活的那半判（正确）
		*
		* ⇒ 两个字段各自独立判定，**任一**按内容不等即通知。
		*   ★ 而"合成一个字符串再比"是**更坏**的写法（见下 `contentEquals` 的注释）。
		*/
		function contentEquals(a, b) {
			/**
			* ① 引用相等 ⇒ 内容必然相等（快路径，且它让"沿用旧值"这一情形零成本）。
			*/
			if (a === b) return true;
			/**
			* ── ★★ 为什么**不**用 `JSON.stringify(a) === JSON.stringify(b)` ────────────────
			*
			* 它是这一格里最显眼、也最坏的写法，理由是决定性的：它**对键序敏感**。
			*
			*     JSON.stringify({x:1,y:2}) === JSON.stringify({y:2,x:1})   ⇒   **false**
			*
			* ★ 而这些载荷来自 `JSON.parse` —— 键序跟随**响应体**的字节序，而响应体由
			*   宿主那边对象的属性顺序决定。⇒ 一次纯粹的服务端重构（字段顺序变了、
			*   内容一字未变）会让这里报"变了" ⇒ **每次轮询都重渲染**，即本 bug 原样复发 ——
			*   只不过这次它藏在"我已经修了去重"的错觉底下。
			*   ★ 那是本队记账最久的那条形态：**修好的那一半把没修的那一半盖住了。**
			*
			* ⇒ 用**结构化**比较：递归、键序无关、数组按序。
			*/
			if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
			/**
			* ② 数组：**按序**逐项比（顺序在这里是内容的一部分 —— 轮次/成员的次序是
			*   宿主刻意给的，重排就是一次真的变化）。
			*/
			if (Array.isArray(a) || Array.isArray(b)) {
				if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
				for (let index = 0; index < a.length; index += 1) if (!contentEquals(a[index], b[index])) return false;
				return true;
			}
			/**
			* ③ 普通对象：键集合相等（**不看顺序**），且每个键的值按内容相等。
			*/
			const left = a;
			const right = b;
			const leftKeys = Object.keys(left);
			const rightKeys = Object.keys(right);
			if (leftKeys.length !== rightKeys.length) return false;
			for (const key of leftKeys) {
				/**
				* ★ `Object.hasOwn` 而不是 `key in right`：后者会把**原型链**上的名字
				*   （`constructor`、`toString`…）读成"有这个键"—— 而一个来自
				*   `JSON.parse` 的载荷**不可能**有那些自有键。用 `in` 会让
				*   `{constructor: 1}` 与 `{}` 在这一格里同形。
				*/
				if (!Object.hasOwn(right, key)) return false;
				if (!contentEquals(left[key], right[key])) return false;
			}
			return true;
		}
		/**
		* Publish one or both successful state-route responses.
		*
		* ★★★ 通知的条件是【**内容**变了】，不是【对象换了】（t31）。
		*   判据见 {@link contentEquals}；"为什么引用比较在这里恒不成立"也写在那一格。
		*/
		function updateActivitySnapshots(update) {
			const next = {
				teams: update.teams ?? activitySnapshots.teams,
				archivedTeams: update.archivedTeams ?? activitySnapshots.archivedTeams
			};
			/**
			* ★ 逐字段判定，且**只在调用方真的带上那个字段时**才比 —— 见函数头那段：
			*   "没交上来"是**按定义**没变，不是"比出来相等"。
			*/
			const teamsChanged = update.teams !== void 0 && !contentEquals(next.teams, activitySnapshots.teams);
			const archivedChanged = update.archivedTeams !== void 0 && !contentEquals(next.archivedTeams, activitySnapshots.archivedTeams);
			/**
			* ★★★ 这条 `return` 就是本任务的全部目的：一个逐字节相同的轮询在这里停下，
			*   订阅者**一次都不被通知** ⇒ 不重渲染。
			*/
			if (!teamsChanged && !archivedChanged) return;
			activitySnapshots = next;
			for (const listener of snapshotListeners) listener();
		}
		/** Poll cadence for the live host snapshot route. */
		const ACTIVITY_POLL_MS = 1e3;
		/**
		* Low-frequency probe cadence while a cardless discovery session still owns
		* no team. The probe keeps the panel able to pick up a team created later in
		* that session (e.g. a run_code-wrapped agent_teams_create) without turning
		* every ordinary session into a one-second filesystem scan.
		*/
		const ACTIVITY_PROBE_MS = 5e3;
		/** Host route serving live and archived team snapshots. */
		const ACTIVITY_STATE_URL = "/plugins/dsh-agent-teams/state";
		const ACTIVITY_HALT_URL = "/plugins/dsh-agent-teams/halt";
		/**
		* Start the single polling loop for the current session's requested targets.
		*
		* With neither targets nor a discovery session this is deliberately inert.
		* Explicit card targets poll at the live cadence from the start. A discovery
		* session performs an immediate live+archive restore pass, then — while it
		* still owns no team — probes on a low-frequency cadence, so a team created
		* later in that session (e.g. a run_code-wrapped agent_teams_create) is
		* discovered without a manual reload, without turning every ordinary session
		* into a one-second filesystem scan. The moment a team for the discovery
		* session appears, the controller upgrades to the live one-second cadence for
		* the rest of its lifetime. The caller — the session view, which stops the
		* controller when the session is no longer current — bounds the lifetime, and
		* archive state is refreshed when a target or a previously discovered live
		* team disappears.
		*/
		function startActivityPolling(monitorTargets, runtime = {}) {
			const discoverySessionId = runtime.discoverySessionId?.trim();
			if (monitorTargets.length === 0 && (discoverySessionId === void 0 || discoverySessionId === "")) return {
				firstTick: Promise.resolve(),
				stop: () => {}
			};
			const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init));
			const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
			const cancel = runtime.cancel ?? ((timer) => {
				clearInterval(timer);
			});
			const publishSnapshots = runtime.publishSnapshots ?? updateActivitySnapshots;
			const settleTargets = runtime.settleTargets ?? settleActivityMonitorTargets;
			let cancelled = false;
			let inFlight = false;
			let hot = monitorTargets.length > 0;
			let discoveryComplete = false;
			let discoveredLiveKeys = /* @__PURE__ */ new Set();
			let controller;
			let timer;
			const intervalMs = () => hot ? ACTIVITY_POLL_MS : ACTIVITY_PROBE_MS;
			const reschedule = () => {
				cancel(timer);
				timer = schedule(() => {
					tick();
				}, intervalMs());
			};
			const tick = async () => {
				if (inFlight || cancelled) return;
				inFlight = true;
				controller = new AbortController();
				try {
					const liveResponse = await fetchState(ACTIVITY_STATE_URL, {
						cache: "no-store",
						signal: controller.signal
					});
					if (!liveResponse.ok) throw new Error("Activity unavailable");
					const body = await liveResponse.json();
					if (cancelled) return;
					if (!Array.isArray(body.teams)) throw new Error("Invalid activity response");
					runtime.onStatus?.("ready");
					/**
					* ★★★ t102：**这一行**以前是纯断言（`as readonly ActivityTeam[]`）⇒
					*   `captainInbox` 从未被读过。现在它过一次校验，三态（absent/empty/present）
					*   随行带出，下游可以区分「服务端没给」与「服务端给了空」。
					*/
					const liveTeams = projectTeams(body.teams);
					publishSnapshots({ teams: liveTeams });
					const previousDiscoveredKeys = discoveredLiveKeys;
					discoveredLiveKeys = new Set(discoverySessionId === void 0 || discoverySessionId === "" ? [] : liveTeams.filter((team) => team.captainSessionId === discoverySessionId).map((team) => team.teamId));
					if (!hot && discoveredLiveKeys.size > 0) {
						hot = true;
						reschedule();
					}
					const discoveredTeamArchived = [...previousDiscoveredKeys].some((teamId) => !discoveredLiveKeys.has(teamId));
					const missing = monitorTargets.filter((target) => !liveTeams.some((team) => team.captainSessionId === target.sessionId && team.teamId === target.teamId));
					const needsDiscoveryArchive = discoverySessionId !== void 0 && discoverySessionId !== "" && !discoveryComplete;
					if (missing.length === 0 && !needsDiscoveryArchive && !discoveredTeamArchived) return;
					const archivedResponse = await fetchState(`${ACTIVITY_STATE_URL}?archived=1`, {
						cache: "no-store",
						signal: controller.signal
					});
					if (!archivedResponse.ok) throw new Error("Archive unavailable");
					const archivedBody = await archivedResponse.json();
					if (cancelled) return;
					if (!Array.isArray(archivedBody.teams)) throw new Error("Invalid archive response");
					publishSnapshots({ archivedTeams: archivedBody.teams });
					discoveryComplete = true;
					settleTargets(new Set(missing.map((target) => target.key)));
				} catch (error) {
					if (error?.name === "AbortError") return;
					if (!cancelled) runtime.onStatus?.("error");
				} finally {
					inFlight = false;
				}
			};
			const firstTick = tick();
			if (timer === void 0) timer = schedule(() => {
				tick();
			}, intervalMs());
			return {
				firstTick,
				stop: () => {
					if (cancelled) return;
					cancelled = true;
					controller?.abort();
					cancel(timer);
				}
			};
		}
		//#endregion
		//#region lib/client/artwork.js
		/**
		* Shared whale artwork lookup for the activity panel and the conversation
		* card: role keywords map to the packaged role images; the captain always
		* uses the lead whale.
		* @module dsh-agent-teams/client/artwork
		*/
		/** Artwork route prefix served by the plugin host half. */
		const ART_BASE = "/plugins/dsh-agent-teams/assets/";
		/** V2 whale role artwork per role keyword. */
		const ROLE_ART = [
			[/data|analys|metric|performance|数据|分析|指标|性能/, "member-data-v2.png"],
			[/resear|investig|explor|study|研究|调查|探索|调研/, "member-researcher-v2.png"],
			[/\bqa\b|test|verif|quality|测试|质量|验证/, "member-qa-v2.png"],
			[/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程/, "member-engineer-v2.png"],
			[/design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题|无障碍/, "member-designer-v2.png"],
			[/secur|audit|risk|threat|review|安全|审计|审查|风险/, "member-security-v2.png"],
			[/docs|writer|product|spec|撰写|文案|写作|文档|规范/, "member-docs-v2.png"],
			[/release|\bbuild\b|deploy|\bops\b|\bci\b|ship|coordin|发布|构建|部署|运维|协调/, "member-operator-v2.png"]
		];
		/**
		* Member artwork URL, or null when no role matches (initial-letter fallback).
		* @param name - the member's display name.
		* @param role - the member's role text.
		* @returns the artwork URL, or null when unmatched.
		*/
		function memberArtUrl(name, role) {
			const identity = `${name} ${role}`.toLowerCase();
			for (const [pattern, art] of ROLE_ART) if (pattern.test(identity)) return `${ART_BASE}${art}`;
			return null;
		}
		//#endregion
		//#region \0dsh-css:/Users/abab/Desktop/agent-teams-dev/src/client/AgentTeamsCard.module.css.mjs
		const css$5 = ".qaPTmW_root{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:10px;flex-direction:column;gap:8px;width:100%;min-width:0;padding:10px 12px;display:flex}.qaPTmW_head{align-items:center;gap:8px;min-width:0;display:flex}.qaPTmW_leadAvatar{object-fit:contain;filter:drop-shadow(0 1px 1px #122d4833);background:0 0;border:0;border-radius:0;flex:none;width:30px;height:30px}.qaPTmW_teamName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:0 auto;font-size:13px;font-weight:600;line-height:20px;overflow:hidden}.qaPTmW_memberCount{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;margin-left:auto;font-size:11px;line-height:16px}.qaPTmW_panelButton{border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;flex:none;padding:2px 8px;font-size:10.5px;font-weight:600;line-height:16px;transition:border-color .12s,color .12s}.qaPTmW_panelButton:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.qaPTmW_panelButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.qaPTmW_members{flex-wrap:wrap;gap:6px;min-width:0;display:flex}.qaPTmW_member{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);max-width:160px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;align-items:center;gap:5px;padding:3px 8px 3px 3px;font-size:11px;font-weight:500;line-height:16px;transition:border-color .12s,background-color .12s;display:inline-flex}.qaPTmW_member:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-button-ghost-active-fill)}.qaPTmW_member:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.qaPTmW_memberArt{object-fit:contain;filter:drop-shadow(0 1px 1px #122d482e);background:0 0;border:0;border-radius:0;width:24px;height:24px}.qaPTmW_memberInitial{background:var(--dsw-alias-state-business-primary);width:20px;height:20px;color:var(--dsw-alias-label-primary-inverted);border-radius:50%;justify-content:center;align-items:center;font-size:10px;font-weight:600;line-height:20px;display:inline-flex}.qaPTmW_memberName{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.qaPTmW_chatEntry{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font:inherit;white-space:nowrap;cursor:pointer;background:0 0;border-radius:7px;align-items:center;gap:5px;padding:3px 8px;font-size:12px;display:inline-flex}.qaPTmW_chatEntry img{object-fit:contain;width:22px;height:22px}.qaPTmW_chatEntry:hover{background:var(--dsw-alias-bg-module-platform)}.qaPTmW_chatEntry:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.qaPTmW_turnCards{gap:8px;margin-block:10px;display:grid}@media (width<=600px){.qaPTmW_head{flex-wrap:wrap}}";
		const tagId$5 = "@nanmicoder/dsh-agent-teams/AgentTeamsCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$5) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId$5;
			tag.textContent = css$5;
			document.head.appendChild(tag);
		}
		var AgentTeamsCard_module_css_default = {
			"chatEntry": "qaPTmW_chatEntry",
			"head": "qaPTmW_head",
			"leadAvatar": "qaPTmW_leadAvatar",
			"member": "qaPTmW_member",
			"memberArt": "qaPTmW_memberArt",
			"memberCount": "qaPTmW_memberCount",
			"memberInitial": "qaPTmW_memberInitial",
			"memberName": "qaPTmW_memberName",
			"members": "qaPTmW_members",
			"panelButton": "qaPTmW_panelButton",
			"root": "qaPTmW_root",
			"teamName": "qaPTmW_teamName",
			"turnCards": "qaPTmW_turnCards"
		};
		//#endregion
		//#region lib/client/AgentTeamsCard.js
		/**
		* AgentTeams conversation card: the lightweight in-conversation summary for
		* one team — the captain's whale avatar and name, the member roster as
		* clickable whale avatars (opening the member's subagent transcript), and
		* an "activity panel" button that re-activates the top-right floater.
		*
		* The floater and this card share the `agent-teams:open-panel` window event
		* so the card can summon the panel even after it was closed (or when an old
		* session is re-opened for review).
		* @module dsh-agent-teams/client/card
		*/
		/** ★ t80：`LEAD_ART` 已从本文件的 import 里去掉（卡片不再显示队长头像；资源仍在 artwork.ts）。 */
		/** Window event name the floater listens for to open itself. */
		const OPEN_PANEL_EVENT = "agent-teams:open-panel";
		/** Open the matching team view, carrying this team's summary
		* so the panel can show it even when the team no longer exists on disk
		* (historical session review). */
		function openActivityPanel(data) {
			window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: {
				teamId: data.teamId,
				captainSessionId: data.captainSessionId,
				teamName: data.teamName,
				members: data.members
			} }));
		}
		/** Render one durable team as a compact conversation card. */
		const noWorkspace = () => void 0;
		const noSubscription = () => () => {};
		function AgentTeamsCard({ node, openMember, sessionId, t, workspaceBridge }) {
			const native = (0, react.useSyncExternalStore)(workspaceBridge?.subscribe ?? noSubscription, workspaceBridge?.getSnapshot ?? noWorkspace);
			const location = node.location;
			if (native && (location.kind === "turn" || location.kind === "step") && location.turn.status === "closed") return null;
			return (0, react_jsx_runtime.jsx)(AgentTeamsSummary, {
				data: node.data,
				openMember,
				sessionId,
				t
			});
		}
		function AgentTeamsSummary({ data, openMember, sessionId, t }) {
			const owner = data.captainSessionId || sessionId;
			const { teams, archivedTeams } = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
			(0, react.useEffect)(() => {
				return monitorAgentTeam(owner, data.teamId);
			}, [data.teamId, owner]);
			const snapshot = teams.find((team) => team.teamId === data.teamId && (owner === "" || team.captainSessionId === owner)) ?? archivedTeams.find((team) => team.teamId === data.teamId && (owner === "" || team.captainSessionId === owner));
			const resolved = (0, react.useMemo)(() => ({
				...data,
				captainSessionId: snapshot?.captainSessionId ?? owner,
				teamName: snapshot?.name ?? data.teamName,
				members: snapshot?.members.map((member) => ({
					id: member.id,
					name: member.name,
					role: member.role
				})) ?? data.members
			}), [
				data,
				owner,
				snapshot
			]);
			return (0, react_jsx_runtime.jsxs)("section", {
				className: AgentTeamsCard_module_css_default.root,
				"data-agent-teams-card": true,
				"data-team-id": resolved.teamId,
				children: [(0, react_jsx_runtime.jsxs)("header", {
					className: AgentTeamsCard_module_css_default.head,
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.teamName,
							title: resolved.teamName,
							children: resolved.teamName
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberCount,
							children: t("card.memberCount", { count: resolved.members.length })
						}),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: AgentTeamsCard_module_css_default.panelButton,
							onClick: () => {
								openActivityPanel(resolved);
							},
							"aria-label": t("workspace.focus"),
							title: t("workspace.focus"),
							children: t("workspace.focus")
						})
					]
				}), resolved.members.length > 0 && (0, react_jsx_runtime.jsx)("div", {
					className: AgentTeamsCard_module_css_default.members,
					children: resolved.members.map((member) => (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: AgentTeamsCard_module_css_default.member,
						onClick: () => {
							if (member.id !== "") openMember(owner, member.id);
						},
						title: member.role === "" ? member.name : `${member.name} · ${member.role}`,
						children: [memberArtUrl(member.name, member.role) !== null ? (0, react_jsx_runtime.jsx)("img", {
							className: AgentTeamsCard_module_css_default.memberArt,
							src: memberArtUrl(member.name, member.role) ?? "",
							alt: "",
							"aria-hidden": true
						}) : (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberInitial,
							children: member.name.trim().slice(0, 1).toUpperCase() || "?"
						}), (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberName,
							children: member.name
						})]
					}, member.id || member.name))
				})]
			});
		}
		//#endregion
		//#region lib/client/panel-geometry.js
		/** Pure persisted geometry rules for the AgentTeams shell-overlay panel. */
		const PANEL_LAYOUT_STORAGE_KEY = "dsh-agent-teams:activity-panel:v1";
		const DEFAULT_PANEL_LAYOUT = Object.freeze({
			mode: "docked",
			x: 0,
			y: 64,
			width: 388,
			height: 640,
			heightMode: "auto"
		});
		function clamp(value, minimum, maximum) {
			return Math.min(Math.max(value, minimum), maximum);
		}
		function finite(value) {
			return typeof value === "number" && Number.isFinite(value);
		}
		/** Decode one versioned localStorage value, rejecting partial/corrupt state. */
		function parsePanelLayout(value) {
			if (value === null) return DEFAULT_PANEL_LAYOUT;
			try {
				const parsed = JSON.parse(value);
				if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANEL_LAYOUT;
				const record = parsed;
				if (record.mode !== "docked" && record.mode !== "floating" || !finite(record.x) || !finite(record.y) || !finite(record.width) || !finite(record.height)) return DEFAULT_PANEL_LAYOUT;
				return {
					mode: record.mode,
					x: record.x,
					y: record.y,
					width: record.width,
					height: record.height,
					heightMode: record.mode === "floating" && record.heightMode === "manual" ? "manual" : "auto"
				};
			} catch {
				return DEFAULT_PANEL_LAYOUT;
			}
		}
		/** Whether the panel should become a simple inset overlay with no gestures. */
		function compactPanelForBounds(bounds) {
			return bounds.width <= 960;
		}
		/** Docked and compact panels always fit content; floating panels may be user-sized. */
		function panelUsesAutoHeight(layout, bounds) {
			return compactPanelForBounds(bounds) || layout.mode === "docked" || layout.heightMode === "auto";
		}
		/** CSS max-height ceiling that keeps an auto-height panel inside its shell. */
		function panelMaximumHeight(layout, bounds) {
			const bottomInset = compactPanelForBounds(bounds) || layout.mode === "floating" ? 12 : 48;
			return Math.max(1, bounds.height - layout.y - bottomInset);
		}
		/** Resolve persisted state into a visible rectangle inside the current shell. */
		function resolvePanelGeometry(layout, bounds) {
			const boundsWidth = Math.max(1, bounds.width);
			const boundsHeight = Math.max(1, bounds.height);
			if (compactPanelForBounds(bounds)) return {
				...layout,
				x: 12,
				y: 12,
				width: Math.max(1, boundsWidth - 24),
				height: Math.max(1, boundsHeight - 24)
			};
			const maximumWidth = Math.max(1, Math.min(640, boundsWidth - 24));
			const minimumWidth = Math.min(320, maximumWidth);
			const width = clamp(layout.width, minimumWidth, maximumWidth);
			const maximumHeight = Math.max(1, boundsHeight - 24);
			const minimumHeight = Math.min(360, maximumHeight);
			if (layout.mode === "docked") {
				const y = clamp(64, 12, Math.max(12, boundsHeight - minimumHeight - 12));
				const availableHeight = Math.max(1, boundsHeight - y - 48);
				const height = clamp(availableHeight, Math.min(minimumHeight, availableHeight), maximumHeight);
				const anchorRight = clamp(bounds.anchorRight, 0, boundsWidth);
				const maximumX = Math.max(12, boundsWidth - width - 12);
				return {
					mode: "docked",
					x: clamp(anchorRight - 18 - width, 12, maximumX),
					y,
					width,
					height,
					heightMode: layout.heightMode
				};
			}
			const height = clamp(layout.height, minimumHeight, maximumHeight);
			return {
				mode: "floating",
				x: clamp(layout.x, 12, Math.max(12, boundsWidth - width - 12)),
				y: clamp(layout.y, 12, Math.max(12, boundsHeight - height - 12)),
				width,
				height,
				heightMode: layout.heightMode
			};
		}
		/** Undock without a visual jump by adopting the panel's resolved rectangle. */
		function floatPanelLayout(geometry, bounds) {
			return resolvePanelGeometry({
				...geometry,
				mode: "floating"
			}, bounds);
		}
		/** Return to the right dock, preserving width and restoring content-fit height. */
		function dockPanelLayout(layout, bounds) {
			return resolvePanelGeometry({
				...layout,
				mode: "docked",
				heightMode: "auto"
			}, bounds);
		}
		/** Translate a floating panel and clamp it back into the visible shell. */
		function movePanelLayout(start, dx, dy, bounds) {
			return resolvePanelGeometry({
				...start,
				mode: "floating",
				x: start.x + dx,
				y: start.y + dy
			}, bounds);
		}
		/** Resize while keeping the edge opposite the active handle stationary. */
		function resizePanelLayout(start, edge, dx, dy, bounds) {
			if (start.mode === "docked") {
				if (edge !== "left") return resolvePanelGeometry(start, bounds);
				return resolvePanelGeometry({
					...start,
					width: start.width - dx
				}, bounds);
			}
			const resolved = resolvePanelGeometry(start, bounds);
			const minimumWidth = Math.min(320, resolved.x + resolved.width - 12);
			const minimumHeight = Math.min(360, bounds.height - resolved.y - 12);
			if (edge === "left") {
				const right = resolved.x + resolved.width;
				const maximumWidth = Math.max(1, Math.min(640, right - 12));
				const width = clamp(resolved.width - dx, Math.min(minimumWidth, maximumWidth), maximumWidth);
				return {
					...resolved,
					x: right - width,
					width
				};
			}
			const maximumHeight = Math.max(1, bounds.height - resolved.y - 12);
			const height = clamp(resolved.height + dy, Math.min(minimumHeight, maximumHeight), maximumHeight);
			if (edge === "bottom") return {
				...resolved,
				height,
				heightMode: "manual"
			};
			const maximumWidth = Math.max(1, Math.min(640, bounds.width - resolved.x - 12));
			const width = clamp(resolved.width + dx, Math.min(minimumWidth, maximumWidth), maximumWidth);
			return {
				...resolved,
				width,
				height,
				heightMode: "manual"
			};
		}
		//#endregion
		//#region lib/client/ActivityPanel.js
		/**
		* AgentTeams activity panel: the top-right floater monitoring every team.
		*
		* Modeled on the Claude Code desktop SessionActivityPanel: a shell-overlay
		* panel that docks at the conversation's top-right edge by default, can be
		* dragged into a floating window, resized, and folded into an activity badge.
		* On wide viewports the docked panel makes the conversation column yield
		* space; narrow viewports keep a simple inset overlay. It
		* polls the host `/plugins/dsh-agent-teams/state` route for
		* server-side snapshots (durable files + live subagent activity), with a
		* collapsed badge that auto-expands once when activity appears. Archived
		* teams stay available for the owning conversation after live work ends.
		*
		* The floater mounts in ui-layout's additive `shell.overlay`; it is not a
		* conversation node — the in-conversation panel was removed in favor of this
		* always-available monitor.
		* @module dsh-agent-teams/client/activity
		*/
		/**
		* ★ t80 缺陷③：`import { LEAD_ART } from './artwork.ts'` **已删** ——
		*   它在本文件里**只有 import 一处**（实测 `grep -c LEAD_ART` = 1），即**死 import**：
		*   本文件从不渲染队长头像。⇒ 四处里它是"核查后确认不显示"的那一处。
		*   ★ **资源仍在** `artwork.ts`（`verify.mjs:311` 的打包契约钉着 `team-lead-v2.png`）。
		*/
		/** Grace before the panel collapses once no team remains. */
		const AUTOCLOSE_GRACE_MS = 2e3;
		/**
		* Page-settle window after mount: activity restored on page load only shows
		* the collapsed badge, so the panel never yanks the conversation column
		* right after load. New activity after this window auto-expands as usual.
		*/
		const AUTO_OPEN_SETTLE_MS = 4e3;
		/** Root marker shared with the panel CSS while the shell overlay is expanded. */
		const PANEL_OPEN_ATTRIBUTE = "data-agent-teams-panel-open";
		/** Shared width concession consumed by the conversation root CSS. */
		const PANEL_SHIFT_PROPERTY = "--agent-teams-panel-shift";
		const PANEL_CONVERSATION_GAP = 14;
		const MOVE_THRESHOLD = 4;
		const CAPTAIN_ASSIGNEE = "captain";
		function initialPanelLayout() {
			if (typeof window === "undefined") return DEFAULT_PANEL_LAYOUT;
			return parsePanelLayout(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY));
		}
		function initialPanelBounds() {
			if (typeof window === "undefined") return {
				width: 1440,
				height: 900,
				anchorRight: 1440
			};
			return {
				width: window.innerWidth,
				height: window.innerHeight,
				anchorRight: window.innerWidth
			};
		}
		/** Collapsed badge: an always-visible corner pill while any team exists. */
		function CollapsedBadge({ count, busy, onClick, t }) {
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ActivityPanel_module_css_default.badge,
				"data-agent-teams-collapsed": true,
				"data-busy": busy,
				onClick,
				"aria-label": t("activity.badgeAria", { count }),
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: ActivityPanel_module_css_default.badgeDot,
					"data-busy": busy,
					"aria-hidden": true
				}), (0, react_jsx_runtime.jsx)("span", {
					className: ActivityPanel_module_css_default.badgeCount,
					children: count
				})]
			});
		}
		/**
		* ── ★★★ R2：这几段读数**搬进了 `MemberRow.tsx`** ────────────────────────────────
		*
		* `memberStateLabel` / `memberStatusText` / `memberDotTone` 原来长在这里，
		* 而它们全部是**关于一行成员**的读数。R2 把成员行变成一个真正的组件
		* （`src/client/MemberRow.tsx`）之后，它们跟着那一行走 —— 留在面板里就成了
		* 第二份实现，而本仓对"第二份实现"的判据是：它一定会漂移。
		*
		* ★ 一行只应有一个"它在做什么"的口径，所以这里**不留**转发壳。
		*/
		function TeamSection({ team, modelDirectory, onContinuePlanning, onDiscarded, onNavigate, t, historic = false, workspace = false }) {
			const [selectedTaskId, setSelectedTaskId] = (0, react.useState)(null);
			team.tasks.find((task) => task.id === selectedTaskId)?.assignee;
			const [stopOpen, setStopOpen] = (0, react.useState)(false);
			/**
			* ★ 打开一个会话（成员本身，或它底下的一个子代理）。两个都走同一条路：
			*   `navigateToSession` 会立刻收起浮动面板 —— 那是一次**明确的离开**。
			*/
			const onNavigateMember = (0, react.useCallback)((childId) => {
				if (childId === "") return;
				onNavigate(team.captainSessionId, childId);
			}, [onNavigate, team.captainSessionId]);
			const [stopping, setStopping] = (0, react.useState)(false);
			const [stopError, setStopError] = (0, react.useState)("");
			/**
			* ★ 剪掉不在册的展开条目。放在 effect 里而**不是**渲染期：渲染必须是纯的。
			*   store 只在用户真的按过某一行时才有条目，所以这里剪的永远是"被重生成
			*   替换掉的那一行"留下的残条。
			*/
			const discarded = historic && team.phase === "staged";
			const stopped = !historic && team.halted === true;
			const busyCount = team.members.filter((member) => member.activity === "working").length;
			const assignedCount = team.tasks.filter((task) => task.assignee !== "" && task.assignee !== CAPTAIN_ASSIGNEE).length;
			const captainOwned = team.tasks.filter((task) => task.assignee === CAPTAIN_ASSIGNEE && task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled");
			const captainBusy = captainOwned.length > 0;
			const captainTaskIds = formatTaskIds(captainOwned.map((task) => task.id), t);
			const completedCount = team.tasks.filter((task) => task.status === "completed").length;
			const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length;
			const allSettled = team.tasks.length > 0 && team.tasks.every((task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled");
			const unfinishedCount = team.tasks.filter((task) => task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled").length;
			const canStop = !historic && team.phase === "running" && team.halted !== true && teamIsActive(team);
			const stopTeam = async () => {
				if (stopping) return;
				setStopping(true);
				setStopError("");
				try {
					const response = await fetch(ACTIVITY_HALT_URL, {
						method: "POST",
						cache: "no-store",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							sessionId: team.captainSessionId,
							teamId: team.teamId
						})
					});
					if (!response.ok) {
						let message = t("team.stopRequestFailed");
						try {
							const body = await response.json();
							if (typeof body.error === "string" && body.error.trim() !== "") message = body.error;
						} catch {}
						throw new Error(message);
					}
					setStopOpen(false);
				} catch (error) {
					setStopError(t("team.stopFailed", { message: error instanceof Error ? error.message : String(error) }));
				} finally {
					setStopping(false);
				}
			};
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.team,
				"data-team-id": team.teamId,
				"data-workspace-team": workspace || void 0,
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: ActivityPanel_module_css_default.teamHead,
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.teamName,
								title: team.name,
								children: team.name
							}),
							historic && (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.historicPill,
								children: t(discarded ? "team.discarded" : "team.ended")
							}),
							stopped && (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.historicPill,
								children: t("team.stopped")
							}),
							(0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.teamStats,
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										"data-stat": "members",
										children: t("team.stats.members", { count: team.members.length })
									}),
									(0, react_jsx_runtime.jsx)("span", {
										"data-stat": "tasks",
										children: t("team.stats.completed", {
											completed: completedCount,
											total: team.tasks.length
										})
									}),
									(0, react_jsx_runtime.jsx)("span", {
										"data-stat": "messages",
										children: t("team.stats.messages", { count: team.messageCount })
									})
								]
							}),
							canStop && (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.teamStopButton,
								"aria-label": t("team.stop"),
								title: t("team.stop"),
								onClick: () => {
									setStopError("");
									setStopOpen(true);
								},
								children: (0, react_jsx_runtime.jsx)(IconStopFill16, {})
							})
						]
					}),
					team.phase === "staged" && !historic && modelDirectory !== void 0 && onContinuePlanning !== void 0 && onDiscarded !== void 0 && (0, react_jsx_runtime.jsx)(StagingPlanEditor, {
						team,
						modelDirectory,
						onContinuePlanning,
						onDiscarded,
						t
					}),
					(0, react_jsx_runtime.jsx)(MemberScreen, {
						team,
						modelDirectory,
						onNavigateMember,
						onSelectTask: setSelectedTaskId,
						t,
						historic,
						workspace,
						discarded,
						stopped,
						staged: team.phase === "staged",
						awaitingFeedback: team.planReviewState === "awaiting_feedback",
						captainBusy,
						busyCount,
						allCompleted,
						allSettled,
						assignedCount,
						captainTaskIds
					}),
					(0, react_jsx_runtime.jsx)(DependencyGraph, {
						tasks: team.tasks,
						members: team.members,
						t,
						discarded,
						workspace,
						onSelectTask: setSelectedTaskId
					})
				]
			}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: stopOpen,
				onClose: () => {
					if (!stopping) setStopOpen(false);
				},
				title: t("team.stopTitle", { team: team.name }),
				closeLabel: t("plan.cancel"),
				description: t("team.stopDescription", {
					tasks: unfinishedCount,
					members: busyCount
				}),
				footer: (0, react_jsx_runtime.jsxs)("span", {
					className: ActivityPanel_module_css_default.stopModalActions,
					children: [(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: stopping,
						onClick: () => {
							setStopOpen(false);
						},
						children: t("team.stopCancel")
					}), (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						"data-danger": true,
						disabled: stopping,
						onClick: () => {
							stopTeam();
						},
						children: [(0, react_jsx_runtime.jsx)(IconStopFill16, {}), stopping ? t("team.stopping") : t("team.stopConfirm")]
					})]
				}),
				children: stopError !== "" && (0, react_jsx_runtime.jsxs)("p", {
					className: ActivityPanel_module_css_default.stopModalError,
					role: "alert",
					children: [(0, react_jsx_runtime.jsx)(IconWarningOutline16, {}), stopError]
				})
			})] });
		}
		/** Legacy conversation cards may outlive their host archive. Project their
		* durable roster through the same rebuilt panel instead of a second UI. */
		function historicCardTeam(data, owner) {
			return {
				workspace: "",
				teamId: data.teamId,
				name: data.teamName,
				captainSessionId: data.captainSessionId || owner,
				phase: "running",
				members: data.members.map((member) => ({
					...member,
					status: "removed",
					activity: "idle",
					progress: 0,
					done: 0,
					total: 0,
					currentTask: "",
					unread: 0
				})),
				tasks: [],
				messageCount: 0,
				/**
				* ── ★★★ t102：这一格**为什么是空的**（判据在下面，不是"顺手留空"）────────────
				*
				* 任务书问我：这是"服务端没给时的兜底"，还是"客户端还需要"的占位？
				*
				* MEASURED 判定 —— **两者都不是**，它是**结构必需的空**：
				*
				*   1. 本函数（`historicCardTeam`）是**归档卡片的合成器** ——
				*      它把 `AgentTeamsCardData` 拼成一个 `ActivityTeam` 交给同一个面板渲染。
				*   2. 而 `AgentTeamsCardData`（`agent-teams-card-definition.ts`）**没有任何消息字段**：
				*      `awk '/interface AgentTeamsCardData/,/^}/' … | grep -ciE "inbox|message"` ⇒ **0**。
				*   3. ⇒ 归档卡片**物理上**拿不到消息 ⇒ 这里**只能**是 `[]`。
				*
				* ★ 所以它不是缺陷 —— **缺陷在【活的那条路】**：
				*   `activity-monitor.ts` 的 `body.teams as readonly ActivityTeam[]` 是**纯断言**，
				*   `captainInbox` 从未被读过。那条路现在由 `readCaptainInbox` 守（见该函数的注释）。
				*
				* ★ 但**留空仍要与"读不到"不同形**：归档卡片是"**确实没有消息**"（`'empty'`），
				*   不是"**读不到消息**"（`'absent'`）。
				*   ⇒ 所以这里**显式**声明 `'empty'`，而不是让它落进 `'absent'`。
				*   ★ 若省掉这一行，两种情形在读数上会**同形** —— 而补救动作相反
				*     （前者什么都不用做，后者要查服务端）。
				*/
				captainInbox: [],
				captainInboxState: "empty",
				captainInboxUnreadable: 0
			};
		}
		function ActivityPanel({ sessionsList, modelDirectories, openMember, t, conversationVisible = true }) {
			const navigateToSession = (parentId, childId) => {
				setOpen(false);
				setWasActive(false);
				openMember(parentId, childId);
			};
			const [open, setOpen] = (0, react.useState)(false);
			const [openOwner, setOpenOwner] = (0, react.useState)();
			const [autoOpened, setAutoOpened] = (0, react.useState)(false);
			const [wasActive, setWasActive] = (0, react.useState)(false);
			const [historic, setHistoric] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [layout, setLayout] = (0, react.useState)(initialPanelLayout);
			const [bounds, setBounds] = (0, react.useState)(initialPanelBounds);
			const [interaction, setInteraction] = (0, react.useState)(null);
			const panelRef = (0, react.useRef)(null);
			const boundsRef = (0, react.useRef)(bounds);
			const gestureRef = (0, react.useRef)(null);
			const frameRef = (0, react.useRef)(null);
			const pendingLayoutRef = (0, react.useRef)(null);
			const current = currentSessionId((0, react.useSyncExternalStore)(sessionsList.subscribe, sessionsList.getSnapshot));
			const autoOpenTrackerRef = (0, react.useRef)({
				sessionId: current,
				restoreComplete: false,
				liveTeamIds: /* @__PURE__ */ new Set()
			});
			const monitorTargets = (0, react.useSyncExternalStore)(subscribeActivityMonitorTargets, getActivityMonitorTargetsSnapshot);
			const returnToComposer = () => {
				setOpen(false);
				setOpenOwner(void 0);
				window.requestAnimationFrame(() => {
					document.querySelector("[data-composer-card] [contenteditable=\"true\"][role=\"textbox\"], [data-composer-card] textarea")?.focus();
				});
			};
			const { teams, archivedTeams } = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
			const currentTargets = (0, react.useMemo)(() => current === void 0 ? [] : monitorTargets.filter((target) => target.sessionId === current), [current, monitorTargets]);
			const currentRef = (0, react.useRef)(current);
			(0, react.useEffect)(() => {
				currentRef.current = current;
			}, [current]);
			const mountedAtRef = (0, react.useRef)(performance.now());
			const expanded = conversationVisible && activityPanelExpandedForSession(open, openOwner, current);
			const geometry = (0, react.useMemo)(() => resolvePanelGeometry(layout, bounds), [layout, bounds]);
			const compact = compactPanelForBounds(bounds);
			const commitLayout = (0, react.useCallback)((next) => {
				setLayout(next);
			}, []);
			(0, react.useEffect)(() => {
				window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
			}, [layout]);
			(0, react.useLayoutEffect)(() => {
				const overlay = document.querySelector("[data-shell-overlay]");
				if (overlay === null) return;
				const conversation = document.querySelector("[data-phase='active']");
				let frame = null;
				const measure = () => {
					frame = null;
					const overlayRect = overlay.getBoundingClientRect();
					const conversationRect = conversation?.getBoundingClientRect();
					const next = {
						width: overlayRect.width,
						height: overlayRect.height,
						anchorRight: conversationRect === void 0 ? overlayRect.width : Math.min(Math.max(conversationRect.right - overlayRect.left, 0), overlayRect.width)
					};
					const previous = boundsRef.current;
					if (previous.width === next.width && previous.height === next.height && previous.anchorRight === next.anchorRight) return;
					boundsRef.current = next;
					setBounds(next);
				};
				const scheduleMeasure = () => {
					frame ??= requestAnimationFrame(measure);
				};
				measure();
				const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
				observer?.observe(overlay);
				if (conversation !== null) observer?.observe(conversation);
				window.addEventListener("resize", scheduleMeasure);
				return () => {
					if (frame !== null) cancelAnimationFrame(frame);
					observer?.disconnect();
					window.removeEventListener("resize", scheduleMeasure);
				};
			}, [current]);
			(0, react.useLayoutEffect)(() => {
				const tracker = autoOpenTrackerRef.current;
				if (tracker.sessionId !== current) {
					tracker.sessionId = current;
					tracker.restoreComplete = false;
					tracker.liveTeamIds = /* @__PURE__ */ new Set();
					setWasActive(false);
					setAutoOpened(false);
				}
				if (openOwner === void 0 || openOwner === current) return;
				setOpen(false);
				setOpenOwner(void 0);
			}, [current, openOwner]);
			(0, react.useLayoutEffect)(() => {
				const root = document.documentElement;
				if (expanded && geometry.mode === "docked" && !compact) {
					root.setAttribute(PANEL_OPEN_ATTRIBUTE, "");
					root.style.setProperty(PANEL_SHIFT_PROPERTY, `${geometry.width + PANEL_CONVERSATION_GAP + 18}px`);
				} else {
					root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
					root.style.removeProperty(PANEL_SHIFT_PROPERTY);
				}
				return () => {
					root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
					root.style.removeProperty(PANEL_SHIFT_PROPERTY);
				};
			}, [
				compact,
				expanded,
				geometry.mode,
				geometry.width
			]);
			(0, react.useEffect)(() => {
				if (current === void 0) return;
				const controller = startActivityPolling(currentTargets, { discoverySessionId: current });
				let active = true;
				const tracker = autoOpenTrackerRef.current;
				if (tracker.sessionId === current && !tracker.restoreComplete) controller.firstTick.then(() => {
					const latest = autoOpenTrackerRef.current;
					if (!active || latest.sessionId !== current || latest.restoreComplete) return;
					latest.liveTeamIds = new Set(getActivitySnapshotsSnapshot().teams.filter((team) => team.captainSessionId === current).map((team) => team.teamId));
					latest.restoreComplete = true;
				});
				return () => {
					active = false;
					controller.stop();
				};
			}, [current, currentTargets]);
			(0, react.useEffect)(() => {
				const onOpenPanel = (event) => {
					const activeSession = currentRef.current;
					if (activeSession === void 0) return;
					setOpenOwner(activeSession);
					setOpen(true);
					const detail = event.detail;
					if (detail?.teamId !== void 0) {
						const owner = detail.captainSessionId !== "" ? detail.captainSessionId : currentRef.current ?? "";
						const teamKey = `${owner}:${detail.teamId}`;
						setHistoric((previous) => {
							const next = new Map(previous);
							next.set(teamKey, {
								data: detail,
								owner
							});
							return next;
						});
					}
				};
				window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel);
				return () => {
					window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel);
				};
			}, []);
			const visibleTeams = (0, react.useMemo)(() => current === void 0 ? [] : teams.filter((team) => team.captainSessionId === current), [teams, current]);
			const visibleHistoric = (0, react.useMemo)(() => current === void 0 ? [] : [...historic.values()].filter(({ data, owner }) => owner === current && !teams.some((live) => live.captainSessionId === current && live.teamId === data.teamId) && !archivedTeams.some((archived) => archived.captainSessionId === current && archived.teamId === data.teamId)), [
				historic,
				current,
				teams,
				archivedTeams
			]);
			const visibleArchived = (0, react.useMemo)(() => current === void 0 ? [] : archivedTeams.filter((team) => team.captainSessionId === current && !teams.some((live) => live.captainSessionId === current && live.teamId === team.teamId)), [
				archivedTeams,
				current,
				teams
			]);
			const visibleCount = visibleTeams.length + visibleArchived.length + visibleHistoric.length;
			const visibleLiveTeamIds = (0, react.useMemo)(() => visibleTeams.map((team) => team.teamId).sort(), [visibleTeams]);
			(0, react.useEffect)(() => {
				const tracker = autoOpenTrackerRef.current;
				const settled = performance.now() - mountedAtRef.current >= AUTO_OPEN_SETTLE_MS;
				const shouldAutoExpand = tracker.sessionId === current && activityPanelShouldAutoExpand({
					alreadyAutoOpened: autoOpened,
					pageSettled: settled,
					restoreComplete: tracker.restoreComplete,
					previousLiveTeamIds: tracker.liveTeamIds,
					currentLiveTeamIds: visibleLiveTeamIds
				});
				if (tracker.sessionId === current && tracker.restoreComplete) tracker.liveTeamIds = new Set(visibleLiveTeamIds);
				if (visibleCount > 0) {
					setWasActive(true);
					if (shouldAutoExpand) {
						setOpenOwner(current);
						setOpen(true);
						setAutoOpened(true);
					}
					return;
				}
				if (!wasActive) return;
				const timer = setTimeout(() => {
					setOpen(false);
					setOpenOwner(void 0);
					setWasActive(false);
					setAutoOpened(false);
				}, AUTOCLOSE_GRACE_MS);
				return () => {
					clearTimeout(timer);
				};
			}, [
				visibleCount,
				visibleLiveTeamIds.join("\0"),
				autoOpened,
				wasActive,
				current
			]);
			const busy = (0, react.useMemo)(() => visibleTeams.some((team) => team.members.some((member) => member.activity === "working")), [visibleTeams]);
			const hasTeams = visibleCount > 0;
			const panelGeometryForGesture = (0, react.useCallback)(() => {
				const measuredHeight = panelRef.current?.getBoundingClientRect().height;
				if (measuredHeight === void 0 || measuredHeight <= 0) return geometry;
				return {
					...geometry,
					height: measuredHeight
				};
			}, [geometry]);
			const flushScheduledLayout = (0, react.useCallback)(() => {
				if (frameRef.current !== null) {
					cancelAnimationFrame(frameRef.current);
					frameRef.current = null;
				}
				const pending = pendingLayoutRef.current;
				pendingLayoutRef.current = null;
				if (pending !== null) commitLayout(pending);
			}, [commitLayout]);
			const scheduleLayout = (0, react.useCallback)((next) => {
				pendingLayoutRef.current = next;
				frameRef.current ??= requestAnimationFrame(() => {
					frameRef.current = null;
					const pending = pendingLayoutRef.current;
					pendingLayoutRef.current = null;
					if (pending !== null) commitLayout(pending);
				});
			}, [commitLayout]);
			(0, react.useEffect)(() => () => {
				if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
			}, []);
			const beginMove = (0, react.useCallback)((event) => {
				if (compact || event.button !== 0 || event.target.closest("button") !== null) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				gestureRef.current = {
					kind: "move",
					pointerId: event.pointerId,
					originX: event.clientX,
					originY: event.clientY,
					start: panelGeometryForGesture(),
					activated: false
				};
			}, [compact, panelGeometryForGesture]);
			const beginResize = (0, react.useCallback)((edge, event) => {
				if (compact || event.button !== 0 || geometry.mode === "docked" && edge !== "left") return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				gestureRef.current = {
					kind: "resize",
					edge,
					pointerId: event.pointerId,
					originX: event.clientX,
					originY: event.clientY,
					start: panelGeometryForGesture(),
					activated: true
				};
				setInteraction("resizing");
			}, [
				compact,
				geometry.mode,
				panelGeometryForGesture
			]);
			const updateGesture = (0, react.useCallback)((event) => {
				const gesture = gestureRef.current;
				if (gesture === null || gesture.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
				const dx = event.clientX - gesture.originX;
				const dy = event.clientY - gesture.originY;
				const activeBounds = boundsRef.current;
				if (gesture.kind === "move") {
					if (!gesture.activated && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
					if (!gesture.activated) {
						gesture.activated = true;
						setInteraction("dragging");
					}
					scheduleLayout(movePanelLayout(floatPanelLayout(gesture.start, activeBounds), dx, dy, activeBounds));
					return;
				}
				scheduleLayout(resizePanelLayout(gesture.start, gesture.edge ?? "left", dx, dy, activeBounds));
			}, [scheduleLayout]);
			const endGesture = (0, react.useCallback)((event) => {
				const gesture = gestureRef.current;
				if (gesture === null || gesture.pointerId !== event.pointerId) return;
				updateGesture(event);
				flushScheduledLayout();
				if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
				gestureRef.current = null;
				setInteraction(null);
			}, [flushScheduledLayout, updateGesture]);
			const cancelGesture = (0, react.useCallback)((event) => {
				const gesture = gestureRef.current;
				if (gesture === null || gesture.pointerId !== event.pointerId) return;
				flushScheduledLayout();
				gestureRef.current = null;
				setInteraction(null);
			}, [flushScheduledLayout]);
			const toggleDock = (0, react.useCallback)(() => {
				const liveGeometry = panelGeometryForGesture();
				commitLayout(liveGeometry.mode === "docked" ? floatPanelLayout(liveGeometry, boundsRef.current) : dockPanelLayout(liveGeometry, boundsRef.current));
			}, [commitLayout, panelGeometryForGesture]);
			const autoHeight = panelUsesAutoHeight(geometry, bounds);
			const panelStyle = {
				width: geometry.width,
				height: autoHeight ? "auto" : geometry.height,
				maxHeight: panelMaximumHeight(geometry, bounds),
				transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)`
			};
			if (!conversationVisible || !hasTeams && !expanded) return null;
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [!expanded && (0, react_jsx_runtime.jsx)(CollapsedBadge, {
				count: visibleCount,
				busy,
				t,
				onClick: () => {
					if (current === void 0) return;
					setOpenOwner(current);
					setOpen(true);
				}
			}), expanded && (0, react_jsx_runtime.jsxs)("aside", {
				ref: panelRef,
				className: ActivityPanel_module_css_default.panel,
				style: panelStyle,
				"data-agent-teams-activity": true,
				"data-panel-mode": geometry.mode,
				"data-height-mode": autoHeight ? "auto" : "manual",
				"data-compact": compact || void 0,
				"data-dragging": interaction === "dragging" || void 0,
				"data-resizing": interaction === "resizing" || void 0,
				"aria-label": t("activity.panelAria"),
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: ActivityPanel_module_css_default.panelHead,
						onPointerDown: beginMove,
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"data-drag-handle": !compact || void 0,
						children: [(0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.panelTitle,
							children: [t("activity.title"), (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.panelDot,
								"data-busy": busy,
								"aria-hidden": true
							})]
						}), (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.panelControls,
							children: [!compact && (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.iconButton,
								"data-control": "dock",
								"data-mode": geometry.mode,
								onClick: toggleDock,
								"aria-label": t(geometry.mode === "docked" ? "activity.float" : "activity.dockRight"),
								title: t(geometry.mode === "docked" ? "activity.float" : "activity.dockRight"),
								children: (0, react_jsx_runtime.jsx)(IconPanelLeftOutline16, {})
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ActivityPanel_module_css_default.iconButton,
								"data-control": "collapse",
								onClick: () => {
									setOpen(false);
									setOpenOwner(void 0);
								},
								"aria-label": t("activity.collapse"),
								title: t("activity.collapse"),
								children: (0, react_jsx_runtime.jsx)(IconChevronDownOutline14, {})
							})]
						})]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.teams,
						children: visibleCount === 0 ? (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.emptyHint,
							children: t("activity.empty")
						}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							visibleTeams.map((team) => (0, react_jsx_runtime.jsx)(TeamSection, {
								team,
								modelDirectory: historic ? void 0 : modelDirectories.directoryFor(team.captainSessionId),
								onContinuePlanning: returnToComposer,
								onDiscarded: returnToComposer,
								onNavigate: navigateToSession,
								t
							}, team.teamId)),
							visibleArchived.map((team) => (0, react_jsx_runtime.jsxs)("div", {
								"data-team-id": team.teamId,
								"data-historic": true,
								className: ActivityPanel_module_css_default.archivedWrap,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.archiveLabel,
									children: t(team.phase === "staged" ? "archive.discardedLabel" : "archive.label")
								}), (0, react_jsx_runtime.jsx)(TeamSection, {
									team,
									onNavigate: navigateToSession,
									t,
									historic: true
								})]
							}, `${team.captainSessionId}:${team.teamId}`)),
							visibleHistoric.map(({ data: team, owner }) => {
								const teamKey = `${owner}:${team.teamId}`;
								return (0, react_jsx_runtime.jsx)(TeamSection, {
									team: historicCardTeam(team, owner),
									onNavigate: navigateToSession,
									t,
									historic: true
								}, teamKey);
							})
						] })
					}),
					!compact && (0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.resizeHandle,
						"data-resize-edge": "left",
						onPointerDown: (event) => {
							beginResize("left", event);
						},
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"aria-hidden": true
					}),
					!compact && geometry.mode === "floating" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.resizeHandle,
						"data-resize-edge": "bottom",
						onPointerDown: (event) => {
							beginResize("bottom", event);
						},
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"aria-hidden": true
					}), (0, react_jsx_runtime.jsx)("div", {
						className: ActivityPanel_module_css_default.resizeHandle,
						"data-resize-edge": "corner",
						onPointerDown: (event) => {
							beginResize("corner", event);
						},
						onPointerMove: updateGesture,
						onPointerUp: endGesture,
						onPointerCancel: cancelGesture,
						"aria-hidden": true
					})] })
				]
			})] });
		}
		//#endregion
		//#region lib/client/workspace-state.js
		function createWorkspaceState() {
			let snapshot = {
				statuses: /* @__PURE__ */ new Map(),
				history: /* @__PURE__ */ new Map(),
				selected: /* @__PURE__ */ new Map()
			};
			const listeners = /* @__PURE__ */ new Set();
			const publish = (next) => {
				snapshot = next;
				for (const listener of listeners) listener();
			};
			return {
				getSnapshot: () => snapshot,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				status(session, status) {
					if (snapshot.statuses.get(session) === status) return;
					publish({
						...snapshot,
						statuses: new Map(snapshot.statuses).set(session, status)
					});
				},
				select(session, team) {
					if (snapshot.selected.get(session) === team) return;
					publish({
						...snapshot,
						selected: new Map(snapshot.selected).set(session, team)
					});
				},
				remember(session, data) {
					const owner = data.captainSessionId || session;
					if (owner !== session) return;
					publish({
						...snapshot,
						history: new Map(snapshot.history).set(`${owner}:${data.teamId}`, {
							...data,
							captainSessionId: owner
						}),
						selected: new Map(snapshot.selected).set(owner, data.teamId)
					});
				}
			};
		}
		/** Records restored at mount never reopen a closed tab; new teams are announced once. */
		function createTeamDiscovery() {
			let restored = false;
			let known = /* @__PURE__ */ new Set();
			return (teams) => {
				const added = restored ? teams.find((team) => !known.has(team.teamId))?.teamId : void 0;
				known = new Set(teams.map((team) => team.teamId));
				restored = true;
				return added;
			};
		}
		//#endregion
		//#region \0dsh-css:/Users/abab/Desktop/agent-teams-dev/src/client/WorkspaceActivity.module.css.mjs
		const css$4 = ".vPbQda_root{height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:inherit;overflow:auto;container:vPbQda_team-workspace/inline-size}.vPbQda_content{max-width:1400px;margin:0 auto;padding:12px 20px 28px}.vPbQda_selector{flex-wrap:wrap;gap:6px;margin-bottom:24px;display:flex}.vPbQda_selector button{border:1px solid var(--dsw-alias-border-l2);text-align:left;overflow-wrap:anywhere;border-radius:8px;align-items:center;gap:12px;max-width:100%;padding:8px 10px;display:flex}.vPbQda_selector span{color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:10px}.vPbQda_selector button[aria-pressed=true]{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-label-tertiary)}.vPbQda_root button{color:inherit;cursor:pointer;font-family:inherit}.vPbQda_root button:active{transform:scale(.98)}.vPbQda_root button:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:3px}.vPbQda_empty{max-width:42ch;padding:36px 0}.vPbQda_emptyMark{color:var(--dsw-alias-label-tertiary);font-size:32px}.vPbQda_empty h3{margin:16px 0 10px;font-size:16px;font-weight:550}.vPbQda_empty p{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.8}.vPbQda_empty button,.vPbQda_error button{background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;font-size:12px}.vPbQda_error{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;align-items:start;gap:12px;margin-bottom:20px;padding:12px;font-size:12px;line-height:1.65;display:flex}.vPbQda_error button{flex:none}.vPbQda_skeleton{gap:16px;padding-top:20px;display:grid}.vPbQda_skeleton i{background:var(--dsw-alias-bg-module-platform);border-radius:8px;height:66px;animation:1.8s ease-in-out infinite alternate vPbQda_breathe}.vPbQda_skeleton i:first-child{width:70%;height:36px}.vPbQda_skeleton i:last-child{animation-delay:.3s}@keyframes vPbQda_breathe{to{opacity:.45}}@container (width>=720px){.vPbQda_content{padding:20px 28px 32px}}@media (prefers-reduced-motion:reduce){.vPbQda_skeleton i{animation:none}}";
		const tagId$4 = "@nanmicoder/dsh-agent-teams/WorkspaceActivity.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$4) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId$4;
			tag.textContent = css$4;
			document.head.appendChild(tag);
		}
		var WorkspaceActivity_module_css_default = {
			"breathe": "vPbQda_breathe",
			"content": "vPbQda_content",
			"empty": "vPbQda_empty",
			"emptyMark": "vPbQda_emptyMark",
			"error": "vPbQda_error",
			"root": "vPbQda_root",
			"selector": "vPbQda_selector",
			"skeleton": "vPbQda_skeleton",
			"team-workspace": "vPbQda_team-workspace"
		};
		//#endregion
		//#region lib/client/WorkspaceActivity.js
		/** Native workspace content; discovery remains mounted independently of tab lifetime. */
		const TEAM_TAB_KIND = "agent-teams";
		const TEAM_TAB_ID = "@nanmicoder/dsh-agent-teams/activity";
		/** Optional host integration is observable so installing/removing it also switches the fallback. */
		function createWorkspaceBridge() {
			let sidebar;
			const listeners = /* @__PURE__ */ new Set();
			return {
				getSnapshot: () => sidebar,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set(value) {
					sidebar = value;
					for (const listener of listeners) listener();
				}
			};
		}
		function ActivitySurface({ bridge, state, ...props }) {
			const sidebar = (0, react.useSyncExternalStore)(bridge.subscribe, bridge.getSnapshot);
			return sidebar === void 0 ? (0, react_jsx_runtime.jsx)(ActivityPanel, { ...props }) : (0, react_jsx_runtime.jsx)(WorkspaceMonitor, {
				...props,
				sidebar,
				state
			});
		}
		function WorkspaceMonitor({ sessionsList, sidebar, state }) {
			const current = currentSessionId((0, react.useSyncExternalStore)(sessionsList.subscribe, sessionsList.getSnapshot));
			const targets = (0, react.useSyncExternalStore)(subscribeActivityMonitorTargets, getActivityMonitorTargetsSnapshot);
			const currentTargets = (0, react.useMemo)(() => targets.filter((target) => target.sessionId === current), [targets, current]);
			const discover = (0, react.useMemo)(() => createTeamDiscovery(), [current]);
			(0, react.useEffect)(() => {
				if (current === void 0) return;
				state.status(current, "loading");
				const controller = startActivityPolling(currentTargets, {
					discoverySessionId: current,
					onStatus(status) {
						state.status(current, status);
					},
					publishSnapshots(update) {
						updateActivitySnapshots(update);
						if (update.teams === void 0) return;
						const added = discover(update.teams.filter((team) => team.captainSessionId === current));
						if (added !== void 0 && sidebar.mounted.getSnapshot() === current && !sidebar.isExpanded()) {
							state.select(current, added);
							sidebar.openTab(TEAM_TAB_KIND);
						}
					}
				});
				return () => {
					controller.stop();
				};
			}, [
				current,
				currentTargets,
				discover,
				sidebar,
				state
			]);
			(0, react.useEffect)(() => {
				const open = (event) => {
					if (current === void 0 || sidebar.mounted.getSnapshot() !== current) return;
					const data = event.detail;
					if (data?.captainSessionId && data.captainSessionId !== current) return;
					if (data?.teamId) state.remember(current, data);
					sidebar.openTab(TEAM_TAB_KIND);
				};
				window.addEventListener(OPEN_PANEL_EVENT, open);
				return () => {
					window.removeEventListener(OPEN_PANEL_EVENT, open);
				};
			}, [
				current,
				sidebar,
				state
			]);
			return null;
		}
		function WorkspaceActivity({ sessionId, useTabInfo, t, state, modelDirectories, openMember }) {
			const { tab } = useTabInfo();
			const snapshots = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
			const local = (0, react.useSyncExternalStore)(state.subscribe, state.getSnapshot);
			const [retry, setRetry] = (0, react.useState)(0);
			const live = snapshots.teams.filter((team) => team.captainSessionId === sessionId);
			const archived = snapshots.archivedTeams.filter((team) => team.captainSessionId === sessionId && !live.some((item) => item.teamId === team.teamId));
			const historic = [...local.history.values()].filter((team) => team.captainSessionId === sessionId && !live.some((item) => item.teamId === team.teamId) && !archived.some((item) => item.teamId === team.teamId)).map((team) => historicCardTeam(team, sessionId));
			const records = [
				...live,
				...archived,
				...historic
			];
			const selected = records.find((team) => team.teamId === local.selected.get(sessionId)) ?? records[0];
			const history = selected !== void 0 && !live.includes(selected);
			const status = local.statuses.get(sessionId) ?? "loading";
			(0, react.useEffect)(() => {
				if (retry === 0 || !tab.visible) return;
				const controller = startActivityPolling([], {
					discoverySessionId: sessionId,
					onStatus: (value) => state.status(sessionId, value)
				});
				controller.firstTick.finally(() => {
					controller.stop();
				});
				return () => {
					controller.stop();
				};
			}, [
				retry,
				sessionId,
				state,
				tab.visible
			]);
			const backToChat = () => {
				tab.actions.close();
				requestAnimationFrame(() => document.querySelector("[data-composer-card] [contenteditable=\"true\"][role=\"textbox\"], [data-composer-card] textarea")?.focus());
			};
			return (0, react_jsx_runtime.jsx)("div", {
				className: WorkspaceActivity_module_css_default.root,
				"data-agent-teams-workspace": true,
				"data-session-id": sessionId,
				children: (0, react_jsx_runtime.jsxs)("div", {
					className: WorkspaceActivity_module_css_default.content,
					children: [
						status === "error" && (0, react_jsx_runtime.jsxs)("div", {
							className: WorkspaceActivity_module_css_default.error,
							role: "alert",
							children: [(0, react_jsx_runtime.jsx)("span", { children: t("workspace.error") }), (0, react_jsx_runtime.jsx)("button", {
								onClick: () => setRetry((value) => value + 1),
								children: t("workspace.retry")
							})]
						}),
						records.length > 1 && (0, react_jsx_runtime.jsx)("nav", {
							className: WorkspaceActivity_module_css_default.selector,
							"aria-label": t("workspace.title"),
							children: records.map((team) => (0, react_jsx_runtime.jsxs)("button", {
								"aria-pressed": selected?.teamId === team.teamId,
								onClick: () => state.select(sessionId, team.teamId),
								children: [team.name, (0, react_jsx_runtime.jsx)("span", { children: t(live.includes(team) ? "workspace.current" : "workspace.history") })]
							}, team.teamId))
						}),
						selected === void 0 ? status === "loading" ? (0, react_jsx_runtime.jsxs)("div", {
							className: WorkspaceActivity_module_css_default.skeleton,
							role: "status",
							"aria-label": t("workspace.loading"),
							children: [
								(0, react_jsx_runtime.jsx)("i", {}),
								(0, react_jsx_runtime.jsx)("i", {}),
								(0, react_jsx_runtime.jsx)("i", {})
							]
						}) : (0, react_jsx_runtime.jsxs)("section", {
							className: WorkspaceActivity_module_css_default.empty,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: WorkspaceActivity_module_css_default.emptyMark,
									"aria-hidden": true,
									children: "↳"
								}),
								(0, react_jsx_runtime.jsx)("h3", { children: t("workspace.emptyTitle") }),
								(0, react_jsx_runtime.jsx)("p", { children: t("workspace.emptyBody") }),
								(0, react_jsx_runtime.jsx)("button", {
									onClick: backToChat,
									children: t("workspace.back")
								})
							]
						}) : (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: (0, react_jsx_runtime.jsx)(TeamSection, {
							team: selected,
							workspace: true,
							historic: history,
							modelDirectory: history ? void 0 : modelDirectories.directoryFor(sessionId),
							onContinuePlanning: backToChat,
							onDiscarded: backToChat,
							onNavigate: openMember,
							t
						}, `${sessionId}:${selected.teamId}`) })
					]
				})
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/abab/Desktop/agent-teams-dev/src/client/roster-settings.module.css.mjs
		const css$3 = ".PJfhlW_root{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);min-width:0;color:var(--dsw-alias-label-primary);border-radius:10px;flex-direction:column;gap:8px;padding:10px 12px;font-family:inherit;display:flex}.PJfhlW_head{align-items:center;gap:8px;min-width:0;display:flex}.PJfhlW_title{flex:1;min-width:0;margin:0;font-size:12.5px;font-weight:600;line-height:18px}.PJfhlW_readonlyBadge{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;padding:1px 7px;font-size:9px;font-weight:600;line-height:15px}.PJfhlW_reason{color:var(--dsw-alias-label-tertiary);margin:0;font-size:9.5px;line-height:14px}.PJfhlW_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:10.5px;line-height:16px}.PJfhlW_list{flex-direction:column;gap:3px;margin:0;padding:0;list-style:none;display:flex}.PJfhlW_row{background:var(--dsw-alias-bg-layer-1);border-radius:6px;align-items:baseline;gap:6px;min-width:0;padding:3px 5px;font-size:10.5px;line-height:16px;display:flex}.PJfhlW_team{max-width:96px;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:none;font-size:9.5px;overflow:hidden}.PJfhlW_name{flex:none;font-weight:600}.PJfhlW_role{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:none;font-size:9.5px;overflow:hidden}.PJfhlW_model{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;flex:none;margin-left:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;overflow:hidden}.PJfhlW_unset{color:var(--dsw-alias-label-tertiary);flex:none;margin-left:auto;font-size:9.5px;font-style:italic}.PJfhlW_effort{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-tertiary);border-radius:4px;flex:none;padding:0 5px;font-size:8.5px;font-weight:600;line-height:15px}@media (prefers-reduced-motion:reduce){.PJfhlW_row{transition:none}}";
		const tagId$3 = "@nanmicoder/dsh-agent-teams/roster-settings.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var roster_settings_module_css_default = {
			"effort": "PJfhlW_effort",
			"empty": "PJfhlW_empty",
			"head": "PJfhlW_head",
			"list": "PJfhlW_list",
			"model": "PJfhlW_model",
			"name": "PJfhlW_name",
			"readonlyBadge": "PJfhlW_readonlyBadge",
			"reason": "PJfhlW_reason",
			"role": "PJfhlW_role",
			"root": "PJfhlW_root",
			"row": "PJfhlW_row",
			"team": "PJfhlW_team",
			"title": "PJfhlW_title",
			"unset": "PJfhlW_unset"
		};
		//#endregion
		//#region lib/client/roster-settings.js
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
		/**
		* 把团队快照摊成"每个身份在哪个模型上"的读数行。
		*
		* ★ 抽成纯函数（不碰 React）是**故意的**：这样"读数的形状"可以被夹具直接钉住，
		*   而不必去渲染一棵组件树 —— 而渲染夹具测到的往往是"夹具自己搭的 DOM"。
		*
		* ★ 顺序**稳定**（按团队、再按快照给的成员顺序）：一张会自己重排的表
		*   在用户眼里像"它变了"，而其实没有任何东西变。
		*/
		function rosterIdentityRoutes(teams) {
			const rows = [];
			for (const team of teams) for (const member of team.members) {
				/**
				* ★ `removed` 的成员**不进这张表**：他们已经不在花名册上了，
				*   列出来会让"当前有哪些身份"这句话失真。
				*/
				if (member.status === "removed") continue;
				rows.push({
					team: team.name,
					name: member.name,
					role: member.role,
					provider: member.provider?.trim() ?? "",
					model: member.model?.trim() ?? "",
					reasoningEffort: member.reasoningEffort?.trim() ?? ""
				});
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
		const ROSTER_READONLY_REASON = "Roster profiles live in the server-side plugin config (src/index.ts), and this client has neither a read nor a write route for them. Closing that needs a server route first, so this view reports what each identity actually resolved to instead of offering an edit that would not apply.";
		/** 一个短标签：`provider/model`，只有 model 时就是 model，都没有时是空串。 */
		function routeLabel(row) {
			if (row.provider !== "" && row.model !== "") return `${row.provider}/${row.model}`;
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
		function RosterSettingsSurface({ snapshots, subscribe, t }) {
			const store = (0, react.useSyncExternalStore)(subscribe, snapshots);
			/**
			* ★ 现役团队与归档团队**都**列出来：一份"这些身份用什么模型"的读数在
			*   历史团队上同样有信息量（"上个队当时用的是哪个模型"是可核对的事实）。
			*/
			return (0, react_jsx_runtime.jsx)(RosterSettings, {
				teams: [...store.teams, ...store.archivedTeams],
				t
			});
		}
		/**
		* 花名册与成员模型一览。
		*
		* ★ 它是**只读**的，而且**明说**自己是只读的（含原因）——
		*   见 `ROSTER_READONLY_REASON`。
		* ★ `t` 由宿主按 `PropsLocale<'agentTeams'>` 注入（与其它客户端表面同一口径），
		*   所以本组件不 import 任何"全局翻译函数" —— 那种第二份取词路径会与宿主的分叉。
		*/
		function RosterSettings({ teams, t }) {
			const rows = rosterIdentityRoutes(teams);
			return (0, react_jsx_runtime.jsxs)("section", {
				className: roster_settings_module_css_default.root,
				"data-agent-teams-roster-settings": true,
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: roster_settings_module_css_default.head,
						children: [(0, react_jsx_runtime.jsx)("h3", {
							className: roster_settings_module_css_default.title,
							children: t("roster.title")
						}), (0, react_jsx_runtime.jsx)("span", {
							className: roster_settings_module_css_default.readonlyBadge,
							"data-roster-writable": "false",
							children: t("roster.readonly")
						})]
					}),
					(0, react_jsx_runtime.jsx)("p", {
						className: roster_settings_module_css_default.reason,
						"data-roster-readonly-reason": true,
						children: ROSTER_READONLY_REASON
					}),
					rows.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: roster_settings_module_css_default.empty,
						"data-roster-empty": true,
						children: t("roster.empty")
					}) : (0, react_jsx_runtime.jsx)("ul", {
						className: roster_settings_module_css_default.list,
						children: rows.map((row) => (0, react_jsx_runtime.jsxs)("li", {
							className: roster_settings_module_css_default.row,
							"data-roster-identity": row.name,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: roster_settings_module_css_default.team,
									children: row.team
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: roster_settings_module_css_default.name,
									children: row.name
								}),
								row.role === "" ? null : (0, react_jsx_runtime.jsx)("span", {
									className: roster_settings_module_css_default.role,
									children: row.role
								}),
								routeLabel(row) === "" ? (0, react_jsx_runtime.jsx)("span", {
									className: roster_settings_module_css_default.unset,
									children: t("roster.noModel")
								}) : (0, react_jsx_runtime.jsx)("span", {
									className: roster_settings_module_css_default.model,
									children: routeLabel(row)
								}),
								row.reasoningEffort === "" ? null : (0, react_jsx_runtime.jsx)("span", {
									className: roster_settings_module_css_default.effort,
									children: row.reasoningEffort
								})
							]
						}, `${row.team}:${row.name}`))
					})
				]
			});
		}
		//#endregion
		//#region lib/client/agent-teams-card-definition.js
		/**
		* AgentTeams conversation card: a lightweight in-conversation summary shown
		* when a team is created — the captain's name, the member roster with whale
		* avatars, and an entry point that re-activates the top-right activity
		* panel (useful after the floater was closed, or when re-opening an old
		* session for review).
		*
		* The fold anchors to the Harness's durable `tool/call` + `tool/result`
		* records for `agent_teams_create`. Those are first-party session events, so
		* the card survives restarts without writing an out-of-repo event type.
		* @module dsh-agent-teams/client/card
		*/
		/** Parse the only create-call fields the historic card owns. */
		function parseAgentTeamsCreateArgs(value) {
			try {
				const parsed = JSON.parse(value);
				if (typeof parsed !== "object" || parsed === null || !("name" in parsed) || typeof parsed.name !== "string") return;
				const name = parsed.name.trim();
				if (name === "") return void 0;
				const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
				return {
					teamId: cleaned === "" ? "team" : cleaned,
					name
				};
			} catch {
				return;
			}
		}
		/** Durable first-party tool events folded into one keyed Chat node. */
		const agentTeamsCardDefinition = {
			kind: "agent-teams",
			target: "chat",
			match: (event) => {
				if (event.type === "tool/call" && event.data.name === "agent_teams_create") return parseAgentTeamsCreateArgs(event.data.arguments) === void 0 ? null : {
					id: String(event.data.callId),
					role: "start"
				};
				if (event.type === "tool/result" && event.data.message.source.kind === "tool") return {
					id: String(event.data.message.source.callId),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "tool/call") throw new Error("agent-teams card start requires agent_teams_create tool/call");
				const parsed = parseAgentTeamsCreateArgs(match.event.data.arguments);
				if (parsed === void 0) throw new Error("agent-teams card start requires valid create arguments");
				return {
					...parsed,
					accepted: false
				};
			},
			update: (context, match) => {
				if (match.event.type !== "tool/result") return context.state;
				if (match.event.data.error !== void 0 || toolResultFailed(match.event.data.message)) return context.state;
				return {
					...context.state,
					accepted: true
				};
			},
			buildViewNode: (context) => {
				if (context.start === void 0) return null;
				const state = context.state;
				if (!state.accepted) return null;
				return {
					key: context.key,
					kind: "agent-teams",
					id: context.id,
					target: "chat",
					anchorSeq: context.start.event.seq,
					location: context.start.location,
					visibility: "visible",
					data: {
						teamId: state.teamId,
						captainSessionId: "",
						teamName: state.name,
						members: []
					}
				};
			}
		};
		/** V4 tool-role results carry isError directly; older logs nest tool-result blocks. */
		function toolResultFailed(message) {
			return message.isError === true || message.content.some((block) => typeof block === "object" && block !== null && "type" in block && block.type === "tool-result" && "isError" in block && block.isError === true);
		}
		/** Keep summaries tied to the create turn, including multiple teams in one turn. */
		function teamCardsForTurn(nodes, turn) {
			return [...nodes].filter((node) => node.kind === "agent-teams" && (node.location.kind === "turn" || node.location.kind === "step") && node.location.turn.turn === turn);
		}
		//#endregion
		//#region lib/client/TeamChatEntry.js
		/** Session-owned entry points: a persistent title action and a durable turn card. */
		/**
		* ★ t80：`LEAD_ART` 的 import 已删 —— 聊天入口不再显示队长头像。
		*   ★ **资源仍在** `artwork.ts`（`verify.mjs:311` 的打包契约钉着 `team-lead-v2.png`）。
		*/
		function TeamChatEntry({ sessionId, t }) {
			const { teams, archivedTeams } = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
			const team = [...teams, ...archivedTeams].find((team) => team.captainSessionId === sessionId);
			if (!team) return null;
			return (0, react_jsx_runtime.jsx)("button", {
				className: AgentTeamsCard_module_css_default.chatEntry,
				"data-team-chat-entry": true,
				type: "button",
				title: t("workspace.focus"),
				onClick: () => openActivityPanel({
					teamId: team.teamId,
					captainSessionId: sessionId,
					teamName: team.name,
					members: team.members
				}),
				children: t("workspace.focus")
			});
		}
		function TeamTurnCard({ sessionId, turn, useChat, t, openMember }) {
			const cards = teamCardsForTurn(useChat((snapshot) => snapshot.nodes).values(), turn.turn);
			if (turn.status !== "closed" || cards.length === 0) return null;
			return (0, react_jsx_runtime.jsx)("div", {
				className: AgentTeamsCard_module_css_default.turnCards,
				"data-team-turn-cards": true,
				children: cards.map((node) => (0, react_jsx_runtime.jsx)(AgentTeamsSummary, {
					data: node.data,
					sessionId,
					t,
					openMember
				}, node.key))
			});
		}
		/**
		* Shorten a session id for the header chip, keeping both ends.
		*
		* ★ 保留**尾部**而不是只取前缀：会话 ID 是 UUID，而 UUID 的**末尾**是
		*   区分度最高的部分（前缀是版本号与变体位，同一批会话里往往相同）。
		*   只取前缀会让两个会话显示成同一个字符串 —— 那与"这个按钮没用"同形。
		*
		* ★ 空串**原样返回空串**，不返回 `'…'`：调用方据此判断"没有 ID 可显示"，
		*   而一个只有省略号的按钮会看起来像坏了。
		*
		* @param sessionId - the raw session id, or undefined/empty when none is bound.
		* @returns the display string; never a lone ellipsis.
		*/
		function shortSessionId(sessionId) {
			if (typeof sessionId !== "string" || sessionId === "") return "";
			if (sessionId.length <= 22) return sessionId;
			return `${sessionId.slice(0, 14)}…${sessionId.slice(-8)}`;
		}
		/**
		* Write `text` to the clipboard, preferring the modern API and falling back to
		* `execCommand`.
		*
		* ★ 返回**三态里的两态**（`copied` / `failed`），因为"没试过"由调用方在
		*   进这个函数之前就排除了（没有 ID 时不渲染按钮）。把"没试过"也塞进来
		*   会让"复制失败"与"还没点"在类型上同形 —— 那正是本队在防的形状。
		*
		* ★ 现代路径**抛出**时也要退到旧路径，而不是直接报失败：
		*   `writeText` 在文档失焦、权限被拒、或非安全上下文下都会 reject，
		*   而 `execCommand` 在这些情形里**仍然可用**（它走的是用户手势）。
		*
		* @param text - the exact string to place on the clipboard.
		* @param env - the mechanisms available in this host.
		* @returns which path succeeded, or `failed` when every path was refused.
		*/
		async function copySessionId(text, env) {
			if (text === "") return "failed";
			const modern = env.clipboard;
			if (modern !== void 0 && typeof modern.writeText === "function") try {
				await modern.writeText(text);
				return "copied";
			} catch {}
			const exec = env.execCommand;
			const createTextarea = env.createTextarea;
			if (typeof exec !== "function" || typeof createTextarea !== "function") return "failed";
			try {
				const area = createTextarea();
				area.value = text;
				area.select();
				const ok = exec("copy");
				area.remove();
				return ok ? "copied" : "failed";
			} catch {
				return "failed";
			}
		}
		//#endregion
		//#region \0dsh-css:/Users/abab/Desktop/agent-teams-dev/src/client/SessionIdAction.module.css.mjs
		const css$2 = "._79jSEa_sessionId{border:1px solid var(--dsw-alias-border-l2);height:22px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;flex:none;align-items:center;gap:4px;padding:0 7px;font-size:11px;line-height:1;display:inline-flex}._79jSEa_sessionId:hover{background:var(--dsw-alias-bg-module-platform)}._79jSEa_sessionId:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}._79jSEa_sessionId svg{flex:none}._79jSEa_text{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}._79jSEa_sessionId[data-status=copied] ._79jSEa_text,._79jSEa_sessionId[data-status=failed] ._79jSEa_text{font-variant-numeric:normal;font-family:inherit}._79jSEa_sessionId[data-status=failed]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}._79jSEa_sessionId[data-status=copied]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}";
		const tagId$2 = "@nanmicoder/dsh-agent-teams/SessionIdAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var SessionIdAction_module_css_default = {
			"sessionId": "_79jSEa_sessionId",
			"text": "_79jSEa_text"
		};
		//#endregion
		//#region lib/client/SessionIdAction.js
		/**
		* The session-ID chip in the conversation header: shows the current session id
		* and copies it on click.
		*
		* ── ★★★ 为什么这个功能住在**本插件**里，而不是装一个社区插件 ────────────────────
		*
		* MEASURED（2026-10-12，在官方 desktop 0.2.0-rc.2 上实测）：
		*
		*   社区里确实有做这件事的插件（`dsh-session-id`、`@moon16u/dsh-plugin-session-id`），
		*   而**本插件已经持有这个位置需要的全部东西**：
		*
		*     · `conversation.session.header.actions` 槽位 —— `TeamChatEntry` 已注册在 :107；
		*     · `sessionId` 这个 prop —— 框架按 `scope: 'session'` **自动注入**，
		*       `TeamChatEntry` 的签名已经在消费它。
		*
		*   ⇒ 同一个槽位再加一格，成本是**一个文件**；而装一个社区包的成本是
		*     一个新依赖 + 一份版本约束 + 一条新的 HMR 面。
		*
		* ── ★ 为什么挂在 `utilities` 而不是 `actions` ──────────────────────────────────
		*
		* `actions` 是**标题旁**的会话动作区（"查看团队"按钮在那里，靠左）；
		* `utilities` 是**右对齐**的会话工具区。会话 ID 属于"关于这个会话的元信息"，
		* 与"这个会话里有什么"不是一回事 —— 两格并排会让用户把 ID 读成团队的一部分。
		*
		* ★ 而两个槽位的 owner props 是**同一个类型**（`ConversationHeaderActionOwnerProps`，
		*   见宿主 `dsh-client-ui-conversation` 的 `slots.d.ts:155/161`），
		*   所以 `PropsRuntime<'conversation.session.header.utilities'>` 拿到的
		*   `sessionId` 与 `actions` 那边**同源**，不需要额外的取值路径。
		*
		* ── ★★ 三态：这里没有"第四个状态"─────────────────────────────────────────────
		*
		*   · `idle`    —— 按钮显示截断的 ID（默认）
		*   · `copied`  —— 刚刚复制成功（短暂）
		*   · `failed`  —— 两条剪贴板路径都失败（短暂，且**说出来**）
		*
		* ★ `sessionId` 缺失时**整格返回 null**，而不是渲染一个空按钮：
		*   一个点了没反应的按钮与"功能坏了"同形，而"没有会话"本来就不该有这个控件。
		*
		* @module dsh-agent-teams/client/session-id-action
		*/
		/**
		* How long the transient `copied` / `failed` label stays up, in milliseconds.
		*
		* ★ Exported so a fixture drives the SAME duration the browser uses instead of
		*   restating it (a fixture that hard-codes 1200 keeps passing after this
		*   number changes, which is how a stale assertion looks like a live one).
		*/
		const SESSION_ID_FEEDBACK_MS = 1400;
		/**
		* The two mechanisms this component will use, read from the real globals.
		*
		* ★ Kept as a separate exported function so the fallback path is reachable in a
		*   fixture without a browser: pass a fake env to {@link copySessionId} instead
		*   of monkey-patching globals.
		*
		* ★ `document.execCommand` is deprecated but still the only synchronous path in
		*   a non-secure context, so it is read defensively rather than assumed.
		* @returns the clipboard mechanisms this host actually exposes.
		*/
		function sessionIdClipboardEnv() {
			const doc = typeof document === "undefined" ? void 0 : document;
			return {
				clipboard: typeof navigator === "undefined" ? void 0 : navigator.clipboard,
				execCommand: doc === void 0 ? void 0 : (command) => doc.execCommand(command),
				createTextarea: doc === void 0 ? void 0 : () => {
					const area = doc.createElement("textarea");
					area.setAttribute("readonly", "");
					area.style.position = "fixed";
					area.style.left = "-9999px";
					doc.body.appendChild(area);
					return {
						get value() {
							return area.value;
						},
						set value(text) {
							area.value = text;
						},
						select: () => {
							area.select();
						},
						remove: () => {
							area.remove();
						}
					};
				}
			};
		}
		/**
		* One session-ID chip: truncated id by default, click to copy, transient
		* confirmation or failure.
		*
		* @param props.sessionId - framework-injected id for this header's session.
		* @param props.t - `agentTeams` locale lookup.
		*/
		function SessionIdAction({ sessionId, t }) {
			const [status, setStatus] = (0, react.useState)("idle");
			const timer = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => () => {
				if (timer.current !== void 0) clearTimeout(timer.current);
			}, []);
			const onCopy = (0, react.useCallback)(() => {
				if (typeof sessionId !== "string" || sessionId === "") return;
				copySessionId(sessionId, sessionIdClipboardEnv()).then((outcome) => {
					setStatus(outcome === "copied" ? "copied" : "failed");
					if (timer.current !== void 0) clearTimeout(timer.current);
					timer.current = setTimeout(() => {
						setStatus("idle");
					}, SESSION_ID_FEEDBACK_MS);
				});
			}, [sessionId]);
			const shown = shortSessionId(sessionId);
			if (shown === "") return null;
			const label = status === "copied" ? t("sessionId.copied") : status === "failed" ? t("sessionId.copyFailed") : shown;
			return (0, react_jsx_runtime.jsxs)("button", {
				className: SessionIdAction_module_css_default.sessionId,
				"data-session-id-chip": true,
				"data-status": status,
				type: "button",
				title: status === "idle" ? t("sessionId.copyTitle", { id: sessionId }) : label,
				"aria-label": t("sessionId.copyTitle", { id: sessionId }),
				onClick: onCopy,
				children: [status === "copied" ? (0, react_jsx_runtime.jsx)(IconCheckOutline16, {}) : (0, react_jsx_runtime.jsx)(IconCopyOutline16, {}), (0, react_jsx_runtime.jsx)("span", {
					className: SessionIdAction_module_css_default.text,
					children: label
				})]
			});
		}
		//#endregion
		//#region lib/client/folders-probe.js
		/**
		* ── ★★★ 最小实验①：不绑会话的 `main` key 在【无会话】时会不会出现 ──────────────────
		*
		* 规格：`docs/UI-V5-SINGLE-ENTRY.md` §0。
		*
		* ── 它验的是什么（v5 方案的地基）────────────────────────────────────────────────
		*
		* 官方有**两条**说明，而它们说的是**不同的槽位** —— 哪一条管我们，只有跑一次才知道：
		*
		*   ① `dsh-client-ui-sidebar-right` 的 Known Limitations：
		*      「No surface without a session. State is keyed by session id,
		*        so the hero screen shows nothing on the right.」      ← ★ 说的是 rightbar
		*   ② `dsh-client-ui-layout` 的 SlotMap for `'main'`：
		*      「Central panel selected by sidebar entry id. The reserved `conversation`
		*        key hosts the Conversation; ★ **other keys receive no Session binding.**」
		*                                                              ← ★ 说的是 main
		*
		* ── ★ 本组件刻意【不画界面】──────────────────────────────────────────────────────
		*
		* 硬边界：本实验只验「**能不能注册 + 无会话时出不出现**」，内容只要能辨识即可。
		* ⇒ 它渲染的是一个**可编程可辨识的标记**（`data-*` + 文本），不是界面。
		*
		* ── ★★ 判据必须是【可编程的】（本机没有视觉模型）────────────────────────────────
		*
		* 所以本组件的全部意义在于：**它每次被渲染都会往一个进程内计数器上加一**。
		* ⇒ 「出没出现」变成 **`rendered > 0`** 这个布尔读数，而不是"截个图看看"。
		*/
		/**
		* ── ★★ 可编程的判据载体 ────────────────────────────────────────────────────────
		*
		* 进程内单例。渲染函数每被调用一次，对应 key 的计数 +1。
		*
		* ★ 为什么用**模块级单例**而不是 props/ref：
		*   判据的读法必须与 React 的生命周期解耦 —— 我们要回答的是
		*   「**这个 key 的组件到底有没有被渲染过**」，而不是「某一个组件实例的局部状态」。
		*   ⇒ 放模块级，夹具 import 进来就能读，**不需要起浏览器**。
		*
		* ★ 三态的分辨力来源：两个 key **各自有独立的计数格** ⇒
		*   「我们的 key 被渲染了」与「conversation 被渲染了」是**两个不同的读数**，
		*   而不是同一个布尔 —— 这正是反向半边要的"两者必须不同形"。
		*/
		const renderCounts = /* @__PURE__ */ new Map();
		/** ★ 记录一次渲染。导出是为了让夹具可以在**不重新 import** 的前提下读它。 */
		function noteProbeRender(key) {
			const next = (renderCounts.get(key) ?? 0) + 1;
			renderCounts.set(key, next);
			return next;
		}
		/**
		* 我们要验的那个 key。
		*
		* ★ 命名空间化（`agent-teams/`）—— 与官方保留的 `conversation` 分开，
		*   否则我们的 key 会与宿主自己的面板**撞在同一个 cell** 上（keyed 槽一个 key 一个 cell）。
		*/
		const FOLDERS_MAIN_KEY = "agent-teams/folders";
		/**
		* ── ★★★ 2026-10-22：**房间**是第二个 `main` key（需求 §27，用户裁定）────────────
		*
		* 用户原话：「一个工作区（或者说一个项目）就是一个**房间**」；而他对文件夹的评语是
		* 「**单纯的像素文件夹其实没有意义啊**」。
		*
		* ★★ 为什么是**新增一个 key**，而不是把 `FoldersPanel` 换掉：
		* ```
		* `scripts/gate-folders-panel.test.mjs` 的 11 条臂把 `FoldersPanel` 钉在
		* `FOLDERS_MAIN_KEY` 上（含"面板 import 了 noteProbeRender"这条反向半边的落点）。
		* ⇒ 直接替换会让那 11 条**失去落点**，而"失去落点"与"那条判据不适用"同形。
		* ⇒ 所以：**两个 key 并存**，由用户/路由选哪个被激活。
		*   ★ 而"哪一个是默认"是一个**产品决策**，本轮不替用户定 —— 见 §27.5。
		* ```
		* ★ 房间面板同样喂 `noteProbeRender`（用下面这个 key）⇒ 它也有自己的渲染读数，
		*   于是"房间页出现过没有"可编程判，而不是只能靠截图。
		*/
		const ROOM_MAIN_KEY = "agent-teams/room";
		/** 本探针占用的槽位名（`main` 是 keyed + scope: 'root'，见 §0 的官方逐字）。 */
		const PROBE_SLOT_NAME = "main";
		/** ★ 被调用过几次 `selectPanel`（含被拒的那次）。 */
		let selectionCalls = 0;
		/** ★ 选择**被接受**过几次（没抛）。`0` ⇒ 要么没调，要么全被拒。 */
		let selectionAccepted = 0;
		/** ★ 记一次 `selectPanel` 调用。 */
		function noteProbeSelection(_panelId) {
			selectionCalls += 1;
		}
		/** ★ 记一次**被接受**的选择（没抛）。 */
		function noteProbeSelectionAccepted() {
			selectionAccepted += 1;
		}
		//#endregion
		//#region \0dsh-css:/Users/abab/Desktop/agent-teams-dev/src/client/folders-panel.module.css.mjs
		const css$1 = "._6IID9G_panel{box-sizing:border-box;background:var(--dsw-alias-bg-base);min-height:100%;color:var(--dsw-alias-label-primary);background-image:linear-gradient(to right, color-mix(in srgb, var(--dsw-alias-border-l2) 40%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--dsw-alias-border-l2) 40%, transparent) 1px, transparent 1px);image-rendering:pixelated;background-size:8px 8px;flex-direction:column;gap:12px;padding:20px 24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex}._6IID9G_head{border-bottom:2px solid var(--dsw-alias-border-l2);align-items:baseline;gap:10px;min-width:0;padding-bottom:8px;display:flex}._6IID9G_title{letter-spacing:.08em;font-size:15px;font-weight:700}._6IID9G_count{border:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:0;margin-left:auto;padding:1px 8px;font-size:11px;font-weight:700}._6IID9G_grid{flex-wrap:wrap;gap:14px;margin:0;padding:0;list-style:none;display:flex}._6IID9G_folder{box-sizing:border-box;border:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:132px;min-width:0;box-shadow:3px 3px 0 0 color-mix(in srgb, var(--dsw-alias-bg-mask-3) 55%, transparent);border-radius:0;flex-direction:column;align-items:center;gap:6px;padding:12px 8px 10px;display:flex}._6IID9G_folderGlyph{image-rendering:pixelated;shape-rendering:crispedges;flex:none}._6IID9G_folderBody{fill:var(--dsw-alias-state-business-primary)}._6IID9G_folderHighlight{fill:color-mix(in srgb, var(--dsw-alias-bg-base) 70%, transparent)}._6IID9G_folderName{text-overflow:ellipsis;white-space:nowrap;text-align:center;max-width:100%;font-size:12px;font-weight:700;overflow:hidden}._6IID9G_folderMeta{text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:var(--dsw-alias-label-tertiary);font-size:10px;overflow:hidden}._6IID9G_empty{border:2px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);border-radius:0;margin:0;padding:18px 20px;font-size:12px;line-height:1.6}@media (prefers-reduced-motion:reduce){._6IID9G_folder,._6IID9G_folderGlyph{transition:none;animation:none}}._6IID9G_returnEntryHost{z-index:60;pointer-events:auto;align-items:center;gap:4px;display:inline-flex;position:fixed;top:10px;right:12px}._6IID9G_returnEntry{box-sizing:border-box;border:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;box-shadow:2px 2px 0 0 color-mix(in srgb, var(--dsw-alias-bg-mask-3) 55%, transparent);border-radius:0;align-items:center;padding:4px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:700;display:inline-flex}._6IID9G_returnEntry:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}._6IID9G_returnEntry:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}._6IID9G_returnEntryHits{min-width:10px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px}._6IID9G_folderCell{margin:0;padding:0;list-style:none}";
		const tagId$1 = "@nanmicoder/dsh-agent-teams/folders-panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var folders_panel_module_css_default = {
			"count": "_6IID9G_count",
			"empty": "_6IID9G_empty",
			"folder": "_6IID9G_folder",
			"folderBody": "_6IID9G_folderBody",
			"folderCell": "_6IID9G_folderCell",
			"folderGlyph": "_6IID9G_folderGlyph",
			"folderHighlight": "_6IID9G_folderHighlight",
			"folderMeta": "_6IID9G_folderMeta",
			"folderName": "_6IID9G_folderName",
			"grid": "_6IID9G_grid",
			"head": "_6IID9G_head",
			"panel": "_6IID9G_panel",
			"returnEntry": "_6IID9G_returnEntry",
			"returnEntryHits": "_6IID9G_returnEntryHits",
			"returnEntryHost": "_6IID9G_returnEntryHost",
			"title": "_6IID9G_title"
		};
		//#endregion
		//#region lib/client/folders-panel.js
		/**
		* ── ★★★ v5 第一层：**文件夹 = 工作区**（`docs/UI-V5-SINGLE-ENTRY.md` §1–§3）─────────
		*
		* 用户裁定（逐字）：「前端首先做一个**统一入口**,呈现出来类似于**一个文件夹的形式,
		* 一个文件夹就相当于一个工作区**」；「风格可以往**像素风**上做（因为像素风比较好做）」。
		*
		* ── ★★ 本文件的形状：**纯函数在前、组件在后** ────────────────────────────────────
		*
		* 判据必须【可编程】（本机没有视觉模型）⇒ "画对了没有"要落成**可读的数据形状**：
		*   · `foldersFromSnapshots()` —— 从 `/state` 的 teams 聚合出工作区列表（纯函数）；
		*   · `FoldersPanel` —— 把那个列表画成像素风文件夹（每次渲染落一个可读的 `data-*` 读数）。
		*
		* ★ **不加数据通道**：数据源是既有的 `activitySnapshots`（`/state` 已经遍历所有工作区）。
		*   本层只把**已有的那份**画成文件夹。
		*
		* ★ **不碰既有视图**：`MemberRow` / `ActivityPanel` 一行未改 —— 这是**新增一层**。
		* @module dsh-agent-teams/client/folders-panel
		*/
		/**
		* ★★★ 判据载体：**渲染计数**（t103 建立的进程内单例）。
		*
		* ★ 为什么本面板必须继续喂它：**反向半边 A** 判的是
		*   「**不调** `selectPanel` ⇒ 渲染计数 = 0」——
		*   而"渲染计数"这件事的**唯一**载体就是 `noteProbeRender`。
		*   ⇒ 若这里换成别的载体，那条判据就失去了落点（测的是一个没人写过的格子）。
		* ★ 它也顺带保留 t103/t105 已验的两条读数（注册成功 / 选择后被渲染），
		*   于是本轮**不需要重新论证地基**，只需要证明"它仍然成立"。
		*/
		/**
		* ★★★ t112（反向半边 B）：文件夹页**必须能出去** —— 否则它是**死路**，
		*   与"进了会话回不去文件夹"那个用户报告的缺陷**对称**。
		*   ★ 出去的官方写法是 `selectPanel(null)`（官方逐字：`null` ⇒ 回到 Conversation）。
		*
		* ★★ **为什么本文件不 import 任何新东西**：本层的 import 面被
		*   `gate-folders-panel.test.mjs` 的臂 8 用**白名单**钉住了（零新依赖）。
		*   而那个夹具**不在本轮写域** ⇒ 我不能去放宽它。
		*   ⇒ 所以"记账"这一步挪到**注入处**（`index.tsx` 的 `openConversation`），
		*     本文件只负责**调用**它拿到的那个回调。
		*/
		/**
		* ── ★★★ 从 `/state` 的 teams 聚合出**工作区文件夹列表**（纯函数）──────────────────
		*
		* ★ 聚合键是 `team.workspace`（`ActivityTeam` 上已有的字段，见 `activity-monitor.ts:156`）
		*   ⇒ **不加任何数据通道**，也不改 `snapshot.ts`（它不在本任务写域）。
		*
		* ★★ 两种来源**合并**（`teams` 与 `archivedTeams`）：一个工作区若只剩已归档的队，
		*   它**仍然是一个工作区** —— 从列表里消失会让"这里曾经有工作区"与"从来没有"同形。
		*   `liveCount` 单列，于是"这个文件夹里还有没有活的队"读得出来。
		*
		* ★ 空工作区名（`''`）**照收**：它是"`/state` 报了一个无名工作区"，与"没有工作区"
		*   不同形 —— 后者才是空态。丢掉它会**静默少一个文件夹**。
		*
		* @param teams - live teams from `/state`.
		* @param archivedTeams - archived teams from `/state` (may be empty).
		* @returns one folder per distinct workspace, in **first-seen order** (stable across polls).
		*/
		function foldersFromSnapshots(teams, archivedTeams = []) {
			/** ★ `Map` 保持插入序 ⇒ 列表顺序**跨轮询稳定**（排序抖动会让 UI 看起来在"跳"）。 */
			const byWorkspace = /* @__PURE__ */ new Map();
			const touch = (workspace) => {
				const existing = byWorkspace.get(workspace);
				if (existing !== void 0) return existing;
				const created = {
					teamIds: [],
					liveCount: 0
				};
				byWorkspace.set(workspace, created);
				return created;
			};
			for (const team of teams) {
				const entry = touch(team.workspace);
				if (!entry.teamIds.includes(team.teamId)) entry.teamIds.push(team.teamId);
				entry.liveCount += 1;
			}
			for (const team of archivedTeams) {
				const entry = touch(team.workspace);
				if (!entry.teamIds.includes(team.teamId)) entry.teamIds.push(team.teamId);
			}
			return [...byWorkspace.entries()].map(([workspace, entry]) => ({
				workspace,
				teamIds: entry.teamIds,
				liveCount: entry.liveCount
			}));
		}
		/**
		* Classify the snapshot pair into the three-way view.
		*
		* @param teams - live teams, or `undefined` when the store never published.
		* @param archivedTeams - archived teams, or `undefined` when never published.
		*/
		function foldersView(teams, archivedTeams) {
			if (teams === void 0 || archivedTeams === void 0) return { state: "empty" };
			return {
				state: "loaded",
				folders: foldersFromSnapshots(teams, archivedTeams)
			};
		}
		/**
		* ── ★★★ 像素风文件夹图标：**内联 SVG，几个矩形**（零依赖、零位图）──────────────────
		*
		* ★ 用户要"像素风"而 B0.6 那套成本论证同样适用：**位图 sprite = 体积 + 版权**。
		*   ⇒ 用几个 `<rect>` 拼一个 16×16 网格的文件夹：像素风的本质就是**对齐到格子的方块**。
		* ★ 每个像素块用 `shapeRendering="crispEdges"` ⇒ 缩放时**不插值**（那才是像素风的观感）。
		* ★ `aria-hidden`：它是装饰，旁边的文字才是读数。
		*/
		const PIXEL = 2;
		const FOLDER_PIXELS = [[
			2,
			3,
			5,
			2
		], [
			0,
			5,
			16,
			8
		]];
		const FOLDER_HIGHLIGHT = [[
			2,
			7,
			3,
			1
		], [
			2,
			9,
			5,
			1
		]];
		function FolderGlyph() {
			return (0, react_jsx_runtime.jsxs)("svg", {
				className: folders_panel_module_css_default.folderGlyph,
				width: 16 * PIXEL,
				height: 16 * PIXEL,
				viewBox: "0 0 16 16",
				shapeRendering: "crispEdges",
				"aria-hidden": "true",
				"data-folders-glyph": "pixel",
				children: [FOLDER_PIXELS.map(([x, y, w, h]) => (0, react_jsx_runtime.jsx)("rect", {
					x,
					y,
					width: w,
					height: h,
					className: folders_panel_module_css_default.folderBody
				}, `b${x}-${y}`)), FOLDER_HIGHLIGHT.map(([x, y, w, h]) => (0, react_jsx_runtime.jsx)("rect", {
					x,
					y,
					width: w,
					height: h,
					className: folders_panel_module_css_default.folderHighlight
				}, `h${x}-${y}`))]
			});
		}
		function FoldersPanel({ openConversation } = {}) {
			/** ★ 每次渲染喂一次渲染计数（反向半边 A 的落点，见文件头的 import 注释）。 */
			noteProbeRender(FOLDERS_MAIN_KEY);
			const { teams, archivedTeams } = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
			const view = foldersView(teams, archivedTeams);
			const folders = view.state === "loaded" ? view.folders : [];
			return (0, react_jsx_runtime.jsxs)("section", {
				className: folders_panel_module_css_default.panel,
				"data-folders-panel": "agent-teams/folders",
				"data-folders-state": view.state,
				"data-folders-count": folders.length,
				children: [(0, react_jsx_runtime.jsxs)("header", {
					className: folders_panel_module_css_default.head,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: folders_panel_module_css_default.title,
						children: "工作区"
					}), (0, react_jsx_runtime.jsx)("span", {
						className: folders_panel_module_css_default.count,
						"data-folders-total": folders.length,
						children: folders.length
					})]
				}), view.state === "empty" ? (0, react_jsx_runtime.jsx)("p", {
					className: folders_panel_module_css_default.empty,
					"data-folders-empty": "true",
					children: "还没有工作区。这里会列出你打开过的每一个工作区。"
				}) : (0, react_jsx_runtime.jsx)("ul", {
					className: folders_panel_module_css_default.grid,
					"data-folders-grid": "true",
					children: folders.map((folder) => (0, react_jsx_runtime.jsx)("li", {
						className: folders_panel_module_css_default.folderCell,
						children: (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: folders_panel_module_css_default.folder,
							"data-folder": folder.workspace,
							"data-folder-teams": folder.teamIds.length,
							"data-folder-live": folder.liveCount,
							"data-folder-open": "true",
							onClick: () => {
								openConversation?.();
							},
							title: `进入 ${folder.workspace === "" ? "(未命名工作区)" : folder.workspace}`,
							children: [
								(0, react_jsx_runtime.jsx)(FolderGlyph, {}),
								(0, react_jsx_runtime.jsx)("span", {
									className: folders_panel_module_css_default.folderName,
									title: folder.workspace,
									children: folder.workspace === "" ? "(未命名工作区)" : folder.workspace
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									className: folders_panel_module_css_default.folderMeta,
									children: [
										folder.teamIds.length,
										" 个团队",
										folder.liveCount > 0 ? ` · ${folder.liveCount} 进行中` : ""
									]
								})
							]
						})
					}, folder.workspace === "" ? "\0unnamed" : folder.workspace))
				})]
			});
		}
		/** 读一个人的"在做什么"。★ 五态映射，**不许**把 could-not-measure 折进 idle。 */
		function doingOf(member) {
			/**
			* ★ 用**既有的** `liveness`（服务端 `MemberLiveness['state']` 的原值，五态），不重算。
			*
			* ★★ 而它在**线上**是 `string`（`ActivityMember.liveness?: string`）——
			*   因为客户端不 import 服务端类型。⇒ 这里必须**显式列出认识的五个值**，
			*   而不是 `switch` 一个宽字符串（那样拼错一个值会静默落进 `default`）。
			*   ★ 认不出 ⇒ `'unknown'`：**"读不到"不是"闲着"**（本仓记账最久的合流）。
			*/
			const state = member.liveness;
			if (state === "working") return "working";
			if (state === "idle") return "idle";
			if (state === "never-spawned") return "not-spawned";
			if (state === "not-live") return "away";
			/** `could-not-measure` / 缺席 / 认不出的值 —— 三者都落 `unknown`（**都**是"读不到"）。 */
			return "unknown";
		}
		/**
		* ── ★★★ 把一个工作区的**全部团队**投影成一间房间 ─────────────────────────────────
		*
		* @param teams - 同一个 workspace 下的团队（★ 传**这个工作区**的，不是全部工作区）
		* @returns 房间几何 + 每个小人的站位
		*
		* ★ 布局规则（可单测，不依赖渲染）：
		* ```
		* 每个团队占一段行（1 个团队 = 1 段）
		* 每行放 SEATS_PER_ROW 个人；团队人多就往下多吃几行
		* 团队之间留 1 行过道（否则"两个团队"看起来像"一个大队"）
		* ```
		* ★★ 为什么"团队 = 一段行"而不是"随便排"：用户裁定"房间里面一般只有一个团队"，
		*   而"也可能有两三个" ⇒ **分界必须看得出来**。★ 而分界只靠颜色是不够的
		*   （色弱看不出、截图也说不清），所以它落在**几何**上。
		*/
		function roomPlanOf(teams) {
			const actors = [];
			const teamBands = [];
			let cursor = 1;
			for (const [groupIndex, team] of teams.entries()) {
				const members = team.members ?? [];
				const rowCount = Math.max(1, Math.ceil(members.length / 4));
				const fromRow = cursor;
				for (const [index, member] of members.entries()) {
					const offsetRow = Math.floor(index / 4);
					const offsetCol = index % 4;
					actors.push({
						/** ★ 键里带 teamId：两个团队里同名的成员（`worker`）必须是两个不同的人。 */
						key: `${team.teamId}/${member.name}`,
						memberName: member.name,
						role: member.role ?? "",
						doing: doingOf(member),
						currentTask: member.currentTask ?? "",
						done: member.done ?? 0,
						total: member.total ?? 0,
						seat: {
							col: offsetCol + 1,
							row: fromRow + offsetRow
						},
						groupIndex,
						teamId: team.teamId
					});
				}
				teamBands.push({
					teamId: team.teamId,
					name: team.name,
					fromRow,
					toRow: fromRow + rowCount - 1
				});
				/** ★ +1 是团队之间的**过道**；空团队也占一行（"这个团队一个人都没有"也是事实）。 */
				cursor = fromRow + rowCount + 1;
			}
			return {
				/** ★ 列数固定为一行座位数 —— 房间往**下**长（与参照物 `rows` 的取舍一致）。 */
				cols: 4,
				rows: Math.max(3, cursor - 1),
				actors,
				teams: teamBands,
				/** ★ 没有任何团队 = 真·空房间。与 `roomPlanOf(undefined)` 不同形（那个根本不该被调用）。 */
				empty: teams.length === 0
			};
		}
		/** 每个 `doing` 的可读标签（★ 渲染层与夹具都用这一份，不许各写一遍）。 */
		const DOING_LABEL = {
			working: "在干活",
			idle: "闲着",
			"not-spawned": "还没上岗",
			away: "不在房间",
			unknown: "读不到"
		};
		/**
		* ── ★★★ 一个工作区 = 一间房间：**挑队**的那两个函数 ───────────────────────────────
		*
		* ★ 它们住在这里而不是 `room-panel.tsx`，理由是**可测性**：
		*   `room-panel.tsx` import 了 `./room-panel.module.css`，而那个模块在 Node 里**不可 import**
		*   ⇒ 只要筛队函数住在那边，任何不跑浏览器的夹具都读不到它。
		*   MEASURED（本条的第一版红在这里）：臂 8 直接 `import lib/client/room-panel.js` ⇒
		*   `ERR_MODULE_NOT_FOUND: room-panel.module.css`。
		* ★★ 而"把纯逻辑挪进纯文件"是修**夹具**还是修**产品**？——修产品：
		*   §27.4 的纪律是"状态机与渲染分开"，而筛队逻辑属于状态机那一侧。
		*   夹具只是**迫使**那条纪律被真的遵守。
		*/
		/** 从快照里挑出某个工作区的全部**活**团队。 */
		function teamsOfWorkspace(teams, workspace) {
			if (teams === void 0) return [];
			return teams.filter((team) => team.workspace === workspace);
		}
		/** 快照里有哪些工作区（去重、保序）。★ 与 `foldersFromSnapshots` 同一条稳定序纪律。 */
		function workspacesOf(teams) {
			if (teams === void 0) return [];
			const seen = [];
			for (const team of teams) if (!seen.includes(team.workspace)) seen.push(team.workspace);
			return seen;
		}
		//#endregion
		//#region \0dsh-css:/Users/abab/Desktop/agent-teams-dev/src/client/room-panel.module.css.mjs
		const css = ".O13hAq_room{--room-tile:46px;box-sizing:border-box;background:var(--dsw-alias-bg-base);min-height:100%;color:var(--dsw-alias-label-primary);image-rendering:pixelated;flex-direction:column;gap:10px;padding:20px 24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex}.O13hAq_head{border-bottom:2px solid var(--dsw-alias-border-l2);align-items:baseline;gap:10px;min-width:0;padding-bottom:8px;display:flex}.O13hAq_title{text-overflow:ellipsis;white-space:nowrap;letter-spacing:.08em;font-size:15px;font-weight:700;overflow:hidden}.O13hAq_meta{border:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:0;flex:none;padding:1px 7px;font-size:10px;font-weight:700}.O13hAq_meta:last-child{margin-left:auto}.O13hAq_floor{border:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);align-self:flex-start;gap:0;display:grid;position:relative}.O13hAq_tile{width:var(--room-tile);height:var(--room-tile);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 62%, transparent)}.O13hAq_tile:nth-child(2n){background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 42%, transparent)}.O13hAq_tile[data-tile-team=\"\"]{background:color-mix(in srgb, var(--dsw-alias-bg-mask-2) 55%, transparent)}.O13hAq_actorLayer{pointer-events:none;position:absolute;inset:0}.O13hAq_actor{width:var(--room-tile);height:var(--room-tile);box-sizing:border-box;left:calc((var(--seat-col,1) - 1) * var(--room-tile));top:calc((var(--seat-row,1) - 1) * var(--room-tile));pointer-events:auto;flex-direction:column;align-items:center;gap:1px;padding:3px 2px 2px;display:flex;position:absolute}.O13hAq_actorHead{background:var(--dsw-alias-label-secondary);width:8px;height:8px}.O13hAq_actorBody{background:var(--dsw-alias-label-tertiary);width:12px;height:10px}.O13hAq_actorScreen{background:var(--dsw-alias-bg-mask-3);width:6px;height:5px;position:absolute;top:6px;right:4px}.O13hAq_actor[data-actor-doing=working] .O13hAq_actorScreen,.O13hAq_actor[data-actor-doing=working] .O13hAq_actorBody{background:var(--dsw-alias-state-business-primary)}.O13hAq_actor[data-actor-doing=idle] .O13hAq_actorBody{background:var(--dsw-alias-label-tertiary)}.O13hAq_actor[data-actor-doing=not-spawned] .O13hAq_actorHead,.O13hAq_actor[data-actor-doing=not-spawned] .O13hAq_actorBody{border:1px dashed var(--dsw-alias-border-l2);background:0 0}.O13hAq_actor[data-actor-doing=away] .O13hAq_actorHead,.O13hAq_actor[data-actor-doing=away] .O13hAq_actorBody{background:color-mix(in srgb, var(--dsw-alias-border-l2) 40%, transparent)}.O13hAq_actor[data-actor-doing=unknown] .O13hAq_actorHead,.O13hAq_actor[data-actor-doing=unknown] .O13hAq_actorBody{background:repeating-linear-gradient(45deg, var(--dsw-alias-border-l2) 0 2px, transparent 2px 4px)}.O13hAq_actorName{text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:var(--dsw-alias-label-secondary);text-align:center;font-size:9px;font-weight:700;overflow:hidden}.O13hAq_legend{flex-wrap:wrap;gap:8px 14px;margin:0;padding:0;list-style:none;display:flex}.O13hAq_legendItem{border:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:0;align-items:baseline;gap:6px;padding:2px 8px;font-size:10px;display:inline-flex}.O13hAq_legendName{color:var(--dsw-alias-label-primary);font-weight:700}.O13hAq_legendRows{color:var(--dsw-alias-label-tertiary)}.O13hAq_notice{border:2px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);border-radius:0;margin:0;padding:18px 20px;font-size:12px;line-height:1.6}@media (prefers-reduced-motion:reduce){.O13hAq_actor,.O13hAq_tile{transition:none;animation:none}}";
		const tagId = "@nanmicoder/dsh-agent-teams/room-panel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@nanmicoder/dsh-agent-teams";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var room_panel_module_css_default = {
			"actor": "O13hAq_actor",
			"actorBody": "O13hAq_actorBody",
			"actorHead": "O13hAq_actorHead",
			"actorLayer": "O13hAq_actorLayer",
			"actorName": "O13hAq_actorName",
			"actorScreen": "O13hAq_actorScreen",
			"floor": "O13hAq_floor",
			"head": "O13hAq_head",
			"legend": "O13hAq_legend",
			"legendItem": "O13hAq_legendItem",
			"legendName": "O13hAq_legendName",
			"legendRows": "O13hAq_legendRows",
			"meta": "O13hAq_meta",
			"notice": "O13hAq_notice",
			"room": "O13hAq_room",
			"tile": "O13hAq_tile",
			"title": "O13hAq_title"
		};
		//#endregion
		//#region lib/client/room-panel.js
		/**
		* ── ★★★ 工作区 = 一个**房间**（需求 §27，用户 2026-10-22 第二轮裁定）──────────────
		*
		* ── 用户原话（逐字）────────────────────────────────────────────────────────────
		*
		* 「一个工作区（或者说一个项目）就是一个**房间**，你可以参考一些**经营类或者像素游戏**
		*  的房间概念，去看看它的画面是怎么做的。」
		* 「房间里面**一般只有一个团队**，当然也不排除有两个或几个团队，**这样应该就不会显得很空吧**。」
		*
		* ── ★★★ 本文件**只负责画**：几何与站位全部由 `room-plan.ts` 算好 ────────────────
		*
		* MEASURED（本机没有视觉模型）⇒ "画对了没有"不能靠看图判。
		* ⇒ 分工与参照物（`ypyik0669/claude-web` 的 `cafe/`）同构：
		* ```
		* room-plan.ts   纯函数：团队 → 房间几何 + 每个小人坐哪 + 在做什么   ← 有 7 条单测
		* room-panel.tsx 本文件：把那些数字画成像素（**不做任何判断**）
		* ```
		* ★ 而它同时是本仓纪律的落点：**每一格都有 `data-*` 读数**，
		*   于是"这个格子的读数对不对"可编程判，"好不好看"归人。
		*
		* ── ★★ 它替换的是什么（用户明确否决的那一半）──────────────────────────────────
		*
		* `folders-panel.tsx` 画的是"一个像素文件夹 + 两行字" ⇒ 它表达了"有几个工作区"，
		* 而**没有表达"里面的人在干什么"**。用户原话：「**单纯的像素文件夹其实没有意义啊**」。
		* ⇒ 房间的第一性目的不是好看，是**一眼看出谁在干活、谁卡住了**。
		*
		* ── ★ 像素风的三条纪律（沿用 `folders-panel.module.css` 那一套，不引第二套）──────
		*
		* ```
		* ① 无圆角      ② 硬阴影（整像素偏移、0 blur）      ③ 等宽字体 + 整数间距
		* ```
		* ★ 美术全部是 **CSS 方块**，零位图、零新依赖（引位图 = 体积进 lib/client.js + 版权）。
		*
		* @module dsh-agent-teams/client/room-panel
		*/
		/**
		* 一个小人 —— **纯 CSS 方块**，不引位图。
		*
		* ★ 五态各有可辨识的形状 + `data-doing`（★ 形状给眼睛，读数给判据）：
		* ```
		* working     坐姿 + 屏幕亮（业务色方块）
		* idle        坐姿 + 屏幕暗
		* not-spawned 没有椅子（空心方块）—— 与 idle **不同形**
		* away        椅子空着（一个虚线框）
		* unknown     一个 `?`（★ 读不到，不是闲着）
		* ```
		*/
		function ActorSprite({ actor }) {
			return (0, react_jsx_runtime.jsxs)("span", {
				className: room_panel_module_css_default.actor,
				/**
				* ★★ 座位坐标用**内联 CSS 变量**给（`--seat-col` / `--seat-row`），
				*   而它同时有一个 `data-actor-seat` 的**可读读数**。
				*   ⇒ 这是一个刻意的"两处"：变量给渲染（快、无重算），
				*     读数给判据（可编程核对）。★ 两者由**同一个** `actor.seat` 派生，
				*     所以"它们不一致"这件事在结构上写不出来。
				*/
				style: {
					"--seat-col": actor.seat.col,
					"--seat-row": actor.seat.row
				},
				"data-actor": actor.key,
				"data-actor-doing": actor.doing,
				"data-actor-task": actor.currentTask,
				"data-actor-seat": `${actor.seat.col},${actor.seat.row}`,
				"data-actor-progress": actor.total === 0 ? "" : `${actor.done}/${actor.total}`,
				"data-actor-team": actor.teamId,
				title: `${actor.memberName}${actor.role === "" ? "" : `（${actor.role}）`} · ${DOING_LABEL[actor.doing]}` + (actor.currentTask === "" ? "" : ` · ${actor.currentTask}`) + (actor.total === 0 ? "" : ` · ${actor.done}/${actor.total}`),
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: room_panel_module_css_default.actorHead,
						"aria-hidden": "true"
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: room_panel_module_css_default.actorBody,
						"aria-hidden": "true"
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: room_panel_module_css_default.actorScreen,
						"aria-hidden": "true"
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: room_panel_module_css_default.actorName,
						children: actor.memberName
					})
				]
			});
		}
		/** 房间的**地板格** —— 一格一个 `span`，于是"房间多大"在 DOM 上也是可读的。 */
		function floorCells(plan) {
			const cells = [];
			for (let row = 1; row <= plan.rows; row += 1) for (let col = 1; col <= plan.cols; col += 1) {
				/**
				* ★ 同一团队的行段用同一底色（`data-team-row`）——
				*   而**分界主要靠几何**（团队之间留过道，见 `roomPlanOf`），颜色只是第二层提示。
				*   ★★ 只靠颜色分团队是错的：色弱看不出、截图也说不清。
				*/
				const band = plan.teams.find((entry) => row >= entry.fromRow && row <= entry.toRow);
				cells.push((0, react_jsx_runtime.jsx)("span", {
					className: room_panel_module_css_default.tile,
					"data-tile": `${col},${row}`,
					"data-tile-team": band?.teamId ?? ""
				}, `${col}-${row}`));
			}
			return cells;
		}
		/**
		* 一间房间 = 一个工作区。
		*
		* ★ 三态（`undefined` / `empty` / 有内容），且三者**两两不同形**：
		* ```
		* snapshots === undefined  ⇒ 「读不到」（store 还没发布过第一份）—— 查 /state
		* plan.empty === true      ⇒ 「这个工作区还没有团队」—— 去建一个队
		* 有内容                    ⇒ 画房间
		* ```
		* ★★ 合流它们的后果与 `folders-view` 那一格逐字相同：白屏与"读不到"同形。
		*/
		function RoomPanel({ workspace } = {}) {
			const teams = (0, react.useSyncExternalStore)(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)?.teams;
			const target = workspace ?? workspacesOf(teams)[0] ?? "";
			const plan = roomPlanOf(teamsOfWorkspace(teams, target));
			return (0, react_jsx_runtime.jsxs)("section", {
				className: room_panel_module_css_default.room,
				"data-room": target,
				"data-room-cols": plan.cols,
				"data-room-rows": plan.rows,
				"data-room-actors": plan.actors.length,
				"data-room-teams": plan.teams.length,
				"data-room-empty": plan.empty ? "true" : "false",
				"data-room-state": teams === void 0 ? "unknown" : plan.empty ? "empty" : "present",
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: room_panel_module_css_default.head,
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: room_panel_module_css_default.title,
								children: target === "" ? "(未命名工作区)" : target
							}),
							(0, react_jsx_runtime.jsxs)("span", {
								className: room_panel_module_css_default.meta,
								"data-room-team-count": plan.teams.length,
								children: [plan.teams.length, " 队"]
							}),
							(0, react_jsx_runtime.jsxs)("span", {
								className: room_panel_module_css_default.meta,
								"data-room-people-count": plan.actors.length,
								children: [plan.actors.length, " 人"]
							}),
							(0, react_jsx_runtime.jsxs)("span", {
								className: room_panel_module_css_default.meta,
								"data-room-working-count": plan.actors.filter((actor) => actor.doing === "working").length,
								children: [plan.actors.filter((actor) => actor.doing === "working").length, " 在干活"]
							})
						]
					}),
					teams === void 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: room_panel_module_css_default.notice,
						"data-room-notice": "unknown",
						children: "还没读到工作区数据（`/state` 尚未返回）。这不等于「这里没有团队」。"
					}) : plan.empty ? (0, react_jsx_runtime.jsx)("p", {
						className: room_panel_module_css_default.notice,
						"data-room-notice": "empty",
						children: "这个工作区还没有团队。建一个队，它的成员就会出现在这间屋子里。"
					}) : (0, react_jsx_runtime.jsxs)("div", {
						className: room_panel_module_css_default.floor,
						style: { gridTemplateColumns: `repeat(${plan.cols}, var(--room-tile))` },
						children: [floorCells(plan), (0, react_jsx_runtime.jsx)("div", {
							className: room_panel_module_css_default.actorLayer,
							"aria-hidden": "false",
							children: plan.actors.map((actor) => (0, react_jsx_runtime.jsx)(ActorSprite, { actor }, actor.key))
						})]
					}),
					plan.teams.length > 1 ? (0, react_jsx_runtime.jsx)("ul", {
						className: room_panel_module_css_default.legend,
						"data-room-legend": plan.teams.length,
						children: plan.teams.map((entry) => (0, react_jsx_runtime.jsxs)("li", {
							className: room_panel_module_css_default.legendItem,
							"data-legend-team": entry.teamId,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: room_panel_module_css_default.legendName,
								children: entry.name
							}), (0, react_jsx_runtime.jsxs)("span", {
								className: room_panel_module_css_default.legendRows,
								"data-legend-rows": `${entry.fromRow}-${entry.toRow}`,
								children: [
									"第 ",
									entry.fromRow,
									entry.toRow === entry.fromRow ? "" : `–${entry.toRow}`,
									" 排"
								]
							})]
						}, entry.teamId))
					}) : null
				]
			});
		}
		//#endregion
		//#region lib/client/folders-return-entry.js
		/**
		* 进程内调用账本（模块级单例）。
		*
		* ★ 为什么是模块级而不是 React state：判据要回答的是
		*   「**这个会话里点了几次、切到哪去了**」，而不是某一个组件实例的局部状态。
		*   放模块级 ⇒ 夹具 import 进来就能读，**不需要起浏览器**。
		* ★ 它是一个**列表**而不是计数器：`A → B → A` 与 `A → A` 的计数可能相同，
		*   而两者的**顺序证据**不同 ⇒ 存下来才能区分。
		*/
		const calls = [];
		/** ★ 记一次调用（两个入口共用这一个账本 —— 它们的**方向**不同，靠 `from` 分开）。 */
		function noteSelectPanelCall(from, panelId) {
			calls.push({
				from,
				panelId
			});
		}
		/** ★ 读账本（副本 ⇒ 夹具读完之后别人再点也不会改它当时看到的那个数组）。 */
		function selectPanelLog() {
			return [...calls];
		}
		/**
		* ── ★★ 入口的三态（**两两不同形**）──────────────────────────────────────────────
		*
		*   · `'show'`     —— 当前**不在**文件夹页 ⇒ 显示「回到工作区」；
		*   · `'hidden'`   —— 当前**就在**文件夹页 ⇒ 不显示（在文件夹页里再给一个"回文件夹"是噪音）；
		*   · `'unknown'`  —— 读不到 `activePanelId` ⇒ ★ **仍然显示**。
		*
		* ★★ 为什么 `'unknown'` 也显示：这个入口是**唯一能回去的路**。
		*   "读不到面板状态"时**藏起**它，会让一个读数缺失直接变成一次**不可用** ——
		*   而那与"这个功能没做"在用户眼里完全同形。
		*   ⇒ 宁可多显示一个按钮（代价：一点视觉噪音），也不可让用户无路可回。
		*
		* @param activePanelId - the currently selected main panel; `undefined` = unreadable.
		* @returns which of the three states the entry is in.
		*/
		function returnEntryState(activePanelId) {
			if (activePanelId === void 0) return "unknown";
			return activePanelId === "agent-teams/folders" ? "hidden" : "show";
		}
		/**
		* One-line summary for the entry's own label (also the `data-` probe value).
		* @param state - the tri-state from {@link returnEntryState}.
		*/
		function returnEntryLabel(state) {
			return state === "unknown" ? "回到工作区（面板状态未知）" : "回到工作区";
		}
		/**
		* ── ★★★ 常驻的「回到工作区」入口 ────────────────────────────────────────────────
		*
		* ★ **不接任何会话 prop** —— 那正是它能"在任何会话里都在"的原因。
		*   它只读**根作用域**的面板状态（`usePanelInfo`），而那与当前是哪个会话无关。
		*
		* ★ 每个渲染都落一个读数：`data-folders-return` / `-state` / `-hits`
		*   ⇒ "它出没出现、被点了几次"都是**可编程判据**。
		*/
		function FoldersReturnEntry({ usePanelInfo, selectPanel }) {
			const state = returnEntryState(usePanelInfo((info) => info).activePanelId);
			const hits = selectPanelLog().filter((call) => call.from === "return-entry").length;
			/**
			* ★ 在文件夹页里**不渲染**（返回 `null`）—— 但那**不是**"不常驻"：
			*   它仍然在每个会话里被挂载、被求值，只是当前这一刻没有可去的地方。
			*   ★ 而 `unknown` **仍然渲染**，理由见 `returnEntryState` 的注释。
			*/
			if (state === "hidden")
 /**
			* ★ 即便如此，也留一个**可编程的痕迹**：夹具要能区分
			*   "在文件夹页所以不显示" 与 "**根本没挂载**" —— 两者在 DOM 上都是"没有按钮"。
			*   ⇒ 这里渲染一个 `hidden` 的标记节点（`` hidden`` 属性 ⇒ 不可见、不可点，但读得到）。
			*/
			return (0, react_jsx_runtime.jsx)("span", {
				className: folders_panel_module_css_default.returnEntryHost,
				"data-folders-return": "hidden",
				"data-folders-return-state": "hidden",
				hidden: true
			});
			return (0, react_jsx_runtime.jsxs)("span", {
				className: folders_panel_module_css_default.returnEntryHost,
				"data-folders-return": "shown",
				"data-folders-return-state": state,
				children: [(0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: folders_panel_module_css_default.returnEntry,
					"data-folders-return-button": "true",
					/**
					* ★★ 点击 ⇒ **把面板切回文件夹页**。这是本缺陷的**唯一**修复点。
					*   ★ 先记账、再调用：若 `selectPanel` 抛（未注册 id），账本里仍留下"**试过**"，
					*     而"试过并失败"与"没试过"必须不同形。
					*/
					onClick: () => {
						noteSelectPanelCall("return-entry", FOLDERS_MAIN_KEY);
						selectPanel(FOLDERS_MAIN_KEY);
					},
					title: "回到工作区列表（文件夹大页面）",
					children: returnEntryLabel(state)
				}), (0, react_jsx_runtime.jsx)("span", {
					className: folders_panel_module_css_default.returnEntryHits,
					"data-folders-return-hits": hits,
					children: hits > 0 ? hits : ""
				})]
			});
		}
		//#endregion
		//#region lib/client/locales.js
		/** `agentTeams` namespace dictionaries for every plugin-owned Web surface. */
		/** Dictionary namespace owned by the AgentTeams client plugin. */
		const AGENT_TEAMS_LOCALE_NAMESPACE = "agentTeams";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"workspace.dependencies": "从左到右：完成前置后解锁 · 点击查看详情",
			"workspace.title": "团队协作",
			"workspace.emptyTitle": "当前会话还没有团队",
			"workspace.emptyBody": "在聊天中使用 /agent-teams 描述目标，确认计划后即可在这里查看协作进度。",
			"workspace.loading": "正在读取团队状态",
			"workspace.error": "暂时无法连接团队服务，正在自动重试。已加载的状态可能不是最新。",
			"workspace.retry": "重新连接",
			"workspace.current": "当前团队",
			"workspace.history": "历史记录",
			"workspace.back": "返回对话",
			"workspace.focus": "查看团队",
			"card.memberCount": "{count} 名成员",
			"activity.badgeAria": "AgentTeams 活动与历史，{count} 条团队记录",
			"activity.panelAria": "AgentTeams 活动面板",
			"activity.title": "AgentTeams 活动",
			"activity.float": "切换为浮动面板",
			"activity.dockRight": "停靠到右侧",
			"activity.collapse": "收起活动面板",
			"activity.empty": "暂无团队活动",
			"team.stop": "停止团队",
			"team.stopped": "已停止",
			"team.stopTitle": "确认停止“{team}”？",
			"team.stopDescription": "将取消 {tasks} 项未完成任务，并停止 {members} 名正在工作的成员。已完成的结果会保留。",
			"team.stopCancel": "继续运行",
			"team.stopConfirm": "确认停止",
			"team.stopping": "正在停止…",
			"team.stopFailed": "停止失败：{message}",
			"team.stopRequestFailed": "服务器未能停止团队，请重试",
			"team.discarded": "已放弃",
			"format.listSeparator": "、",
			"task.status.pending": "待领取",
			"task.status.claimed": "已认领",
			"task.status.inProgress": "进行中",
			"task.status.completed": "已完成",
			"task.status.failed": "失败",
			"task.status.cancelled": "已取消",
			"task.status.notRun": "未执行",
			"member.model.sealedReason": "该成员已启动，模型已冻结进它的会话描述符；现在改只会被记录而不会生效 —— 请新建一个替代成员",
			"member.clock.working": "已工作 {elapsed}",
			"member.clock.waiting": "已等待 {elapsed}",
			"member.clock.idle": "空闲",
			"member.clock.unknown": "时间未知",
			"member.doing.task": "正在执行 {taskId}",
			"member.doing.taskSubject": "{taskId} · {subject}",
			"member.round.mark": "第 {round} 轮",
			"member.gates.noCatalog": "读不到判据清单",
			"member.gates.count": "{count} 条判据",
			"member.gates.noVerdicts": "{count} 条 · 结果不落盘",
			/**
			* ★★ t80 缺陷②：两块，且**措辞必须不同形**（前者是事实，后者是数据缺口）。
			* 「跑了」= 关于**这一轮**的结论；「没有落盘读数」= 关于**我们能看到什么**的陈述。
			*/
			"member.gates.ranSummary": "本轮跑了 {count} 条判据 · {stages}",
			"member.gates.silentSummary": "其余 {count} 条在别的段 —— 本轮没有落盘读数（不是没跑）",
			/**
			* ── ★★★ t81：一段"**没有裁决**"的**四种成因** —— ★ 四者必须**不同形** ─────────────
			*
			* 本仓记账最久的形态是「**没找到**」与「**确实没有**」合流。这一组键就是把它们分开：
			*   · `noGate`      —— 该段**取不到任务级裁决**（`admission` 已注册 3 条但生产零求值点）
			*   · `teamLevel`   —— 该段**不是任务级事实**（`delivery` 团队级 / `runtime` 事件级）
			*   · `notReached`  —— 任务**还没走到**这一段
			*   · `notRecorded` —— 走了，但**这一代没记**（retry 清过）
			* ★ 四句话的**补救动作各不相同** ⇒ 措辞也不许同形。
			*/
			"member.gates.absence.noGate": "0 条判据 —— 这一段没有注册任何判据",
			"member.gates.absence.teamLevel": "团队级/事件级 —— 它的裁决不属于单条任务",
			"member.gates.absence.notReached": "未开始 —— 这条任务还没走到这一段",
			"member.gates.absence.notRecorded": "未落盘 —— 走到了，但这一代没有记（retry 会清）",
			"round.tone.converging": "评审发现问题 · 继续下一轮",
			"round.tone.failed": "本轮有失败",
			"round.tone.unmeasured": "本轮未测量",
			"round.tone.running": "本轮进行中",
			"round.tone.open": "本轮待开工",
			"round.tone.completed": "本轮已完成",
			"member.openSession": "打开该成员的会话",
			"member.openSession.unavailable": "该成员尚未启动，因此没有可打开的会话",
			"subagent.none": "该成员名下没有正在运行的子代理",
			"subagent.unmeasured": "读不到该成员的子代理：{reason}",
			"subagent.doing.working": "工作中",
			"subagent.doing.idle": "空闲",
			"subagent.doing.unknown": "状态未知（{status}）",
			"subagent.mode.continuable": "可续",
			"subagent.mode.oneShot": "一次性",
			"roster.title": "花名册与成员模型",
			"roster.readonly": "只读",
			"roster.empty": "当前还没有团队，因此暂时没有可显示的成员模型。",
			"roster.noModel": "未解析出模型",
			"member.state.notCreated": "未创建",
			"member.status.executing": "正在执行 {taskId}",
			"member.status.executingModel": "正在执行 {taskId} · {model}",
			"member.status.working": "正在处理已派任务",
			"member.status.waitingAssignment": "从未派工",
			"member.status.awaitingAssignment": "已完成 {taskId} · 待派工",
			"member.status.awaitingRedispatch": "{taskId} 失败 · 待重派",
			"member.status.staged": "确认后创建并启动",
			"member.status.discarded": "计划已放弃，未创建",
			"member.status.stopped": "团队已停止，需显式恢复",
			"task.assignee.unclaimed": "待认领",
			"task.summary.waitingBreakdown": "等待队长拆解任务",
			"task.summary.staged": "{count} 项计划等待确认",
			"task.summary.discarded": "{count} 项计划已放弃，均未执行",
			"task.summary.allDelivered": "全部 {count} 项任务已交付",
			"task.summary.ended": "终态：{completed} 已交付 · {cancelled} 已取消 · {failed} 失败",
			"task.summary.blockedAndRunning": "{tasks}{more} 等待前置，其余已开工",
			"task.summary.more": " 等 {count} 项",
			"task.summary.running": "{tasks} 正在执行",
			"task.summary.ready": "{tasks} 已就绪待开工",
			"task.summary.blocked": "{tasks} 等待前置",
			"task.summary.failedSettled": "{count} 项已失败，自动循环已停止",
			"task.summary.waitingSchedule": "等待下一轮调度",
			"progress.aria": "团队总进度",
			"dependency.aria": "任务依赖链",
			"dependency.parallel": "并行任务",
			"dependency.title": "任务依赖",
			"dependency.hint.parallel": "无前后依赖 · 点击查看详情",
			"dependency.hint.chain": "悬停高亮依赖链 · 点击固定",
			"dependency.hint.pinned": "{taskId} 已固定 · Esc 取消",
			"dependency.hint.noStructure": "当前没有任务依赖关系（无连线可画）",
			"task.runningAria": "运行中",
			"task.model": "{model}",
			"task.detail.cancelled": "任务已取消，不会继续执行",
			"task.detail.failed": "任务失败，等待明确重试",
			"task.detail.completed": "已完成并交付",
			"task.detail.noPrerequisite": "无前置，可立即开工",
			"task.detail.ready": "前置已就绪，可开工",
			"task.detail.waitingOn": "等待 {tasks}",
			"task.detail.notRun": "计划已放弃，任务未执行",
			"task.detail.noDownstream": "无下游任务",
			"task.detail.unlocks": "完成后解锁 {tasks}",
			"team.ended": "已结束",
			"plan.badge": "待确认",
			"plan.title": "执行前计划审查",
			"plan.description": "成员尚未创建、任务尚未调度。可直接调整计划，也可返回对话告诉队长哪里需要修改。",
			"plan.member.role": "角色",
			"plan.member.model": "模型",
			"plan.member.reasoning": "推理等级",
			"plan.model.choose": "选择模型",
			"plan.model.currentUnavailable": "{provider}/{model}（当前目录不可用）",
			"plan.model.route": "路由：{provider}/{model}",
			"plan.model.providerDefault": "Provider 默认值",
			"plan.model.modelDefault": "模型默认值（{effort}）",
			"plan.model.triggerAria": "选择成员模型，当前 {model}，推理等级 {effort}",
			"plan.model.back": "返回",
			"plan.model.loading": "正在加载模型…",
			"plan.model.empty": "暂无可用模型",
			"plan.model.partialFailure": "{count} 个 Provider 的模型目录加载失败",
			"plan.model.retry": "重试",
			"plan.member.prompt": "角色提示词",
			"plan.member.roleFallback": "未设置角色",
			"plan.task.subject": "任务名称",
			"plan.task.description": "任务说明",
			"plan.task.assignee": "负责人",
			"plan.task.dependencies": "依赖任务 ID（逗号分隔）",
			"plan.task.dependenciesHint": "例如 task-1, task-2；不得形成循环依赖",
			"plan.task.unassigned": "共享任务池",
			"plan.unsaved": "未保存",
			"plan.save": "保存",
			"plan.saving": "保存中…",
			"plan.remove": "删除",
			"plan.removed": "任务已删除",
			"plan.removeConfirm": "确认删除",
			"plan.removeWarning": "删除 {task} 后将重新计算依赖关系。",
			"plan.cancel": "取消",
			"plan.addTask": "添加任务",
			"plan.adding": "添加中…",
			"plan.taskAdded": "任务已添加",
			"plan.newTask": "新任务名称",
			"plan.newTaskLabel": "新增计划任务",
			"plan.readySummary": "{members} 名成员 · {tasks} 项任务 · {links} 条依赖",
			"plan.flow.aria": "团队启动流程",
			"plan.flow.review": "审查计划",
			"plan.flow.spawn": "创建成员",
			"plan.flow.run": "开始执行",
			"plan.members.title": "成员与模型路由",
			"plan.members.count": "{count} 名成员",
			"plan.members.empty": "尚未规划成员",
			"plan.tasks.title": "任务与依赖",
			"plan.tasks.count": "{count} 项任务 · {links} 条依赖",
			"plan.tasks.empty": "尚未规划任务",
			"plan.dependencies.none": "无依赖",
			"plan.dependencies.count": "{count} 条依赖",
			"plan.approve": "确认并启动团队",
			"plan.approveTitle": "计划检查完毕？",
			"plan.approveHint": "确认后将创建 {members} 名成员并调度 {tasks} 项任务。",
			"plan.continue": "返回对话修改",
			"plan.returnToChat": "回到对话",
			"plan.feedbackTitle": "正在等你说明修改方向",
			"plan.feedbackHint": "队长会在对话中追问；收到你的回复后，只修改这份草案并再次等待确认。",
			"plan.discard": "放弃本次计划",
			"plan.discardConfirmTitle": "放弃本次计划？",
			"plan.discardWarning": "该计划会结束并归档；尚未创建任何成员，也不会执行任务。",
			"plan.discardConfirm": "确认放弃",
			"plan.discarding": "正在放弃…",
			"plan.pendingEdits": "请先保存当前修改，再启动团队。",
			"plan.saved": "计划已保存",
			"plan.failed": "操作失败：{message}",
			"team.stats.members": "{count} 名成员",
			"team.stats.completed": "{completed}/{total} 完成",
			"team.stats.messages": "{count} 条消息",
			"delegation.aria": "队长派工关系",
			"captain.name": "队长",
			"captain.role": "拆解 · 派发 · 汇总",
			"captain.summary": "已派发 {tasks} 项任务给 {members} 名成员",
			"captain.summary.staged": "已规划 {tasks} 项任务与 {members} 名成员，等待确认",
			"captain.summary.awaitingFeedback": "草案已保留，等待你在对话中说明修改方向",
			"captain.summary.discarded": "计划已放弃：{members} 名成员未创建，{tasks} 项任务未执行",
			"captain.summary.withTakeover": "已派发 {tasks} 项给成员 · 队长接管 {captainTasks}",
			"captain.state.working": "{count} 人执行中",
			"captain.state.takeover": "正在执行 {tasks}",
			"captain.state.collected": "已收齐",
			"captain.state.waiting": "等待回报",
			"captain.state.staged": "待确认",
			"captain.state.awaitingFeedback": "待反馈",
			"captain.state.discarded": "已放弃",
			"captain.state.settled": "已终结",
			"members.toggle": "{count} 名成员",
			"members.collapse": "收起",
			"members.expand": "展开",
			"members.expandFinished": "展开已结束（{count}）",
			"members.empty": "暂无成员，等待队长组建团队",
			"archive.label": "已结束 · 历史归档",
			"archive.discardedLabel": "计划已放弃 · 历史归档",
			"sessionId.copyTitle": "复制会话 ID：{id}",
			"sessionId.copied": "已复制",
			"sessionId.copyFailed": "复制失败"
		};
		/** English dictionary, checked complete against the Chinese source key set. */
		const en = {
			"workspace.dependencies": "Left to right: prerequisites unlock tasks · Select for details",
			"workspace.title": "Team workspace",
			"workspace.emptyTitle": "No team in this conversation yet",
			"workspace.emptyBody": "Use /agent-teams in chat to describe your goal. Review the plan, then follow the team here.",
			"workspace.loading": "Loading team activity",
			"workspace.error": "The team service is unavailable. Retrying automatically; loaded activity may be out of date.",
			"workspace.retry": "Reconnect",
			"workspace.current": "Current team",
			"workspace.history": "History",
			"workspace.back": "Back to conversation",
			"workspace.focus": "View team",
			"card.memberCount": "{count} members",
			"activity.badgeAria": "AgentTeams activity and history, {count} team records",
			"activity.panelAria": "AgentTeams activity panel",
			"activity.title": "AgentTeams activity",
			"activity.float": "Switch to floating panel",
			"activity.dockRight": "Dock to the right",
			"activity.collapse": "Collapse activity panel",
			"activity.empty": "No team activity",
			"team.stop": "Stop team",
			"team.stopped": "Stopped",
			"team.stopTitle": "Stop “{team}”?",
			"team.stopDescription": "This cancels {tasks} unfinished tasks and stops {members} working members. Completed results are kept.",
			"team.stopCancel": "Keep running",
			"team.stopConfirm": "Stop team",
			"team.stopping": "Stopping…",
			"team.stopFailed": "Could not stop team: {message}",
			"team.stopRequestFailed": "The server could not stop this team. Try again.",
			"team.discarded": "Discarded",
			"format.listSeparator": ", ",
			"task.status.pending": "Unclaimed",
			"task.status.claimed": "Claimed",
			"task.status.inProgress": "In progress",
			"task.status.completed": "Completed",
			"task.status.failed": "Failed",
			"task.status.cancelled": "Cancelled",
			"task.status.notRun": "Not run",
			"member.model.sealedReason": "Already spawned: this model is frozen into its session descriptor, so changing it now would be recorded without being applied - spawn a replacement member instead",
			"member.clock.working": "Worked {elapsed}",
			"member.clock.waiting": "Waiting {elapsed}",
			"member.clock.idle": "Idle",
			"member.clock.unknown": "Elapsed unknown",
			"member.doing.task": "Working on {taskId}",
			"member.doing.taskSubject": "{taskId} · {subject}",
			"member.round.mark": "Round {round}",
			"member.gates.noCatalog": "Criteria list unreadable",
			"member.gates.count": "{count} criteria",
			"member.gates.noVerdicts": "{count} · results are not persisted",
			"member.gates.ranSummary": "{count} criteria ran this round · {stages}",
			"member.gates.silentSummary": "The other {count} sit in other stages — no persisted reading this round (not \"did not run\")",
			"member.gates.absence.noGate": "0 criteria — nothing is registered for this stage",
			"member.gates.absence.teamLevel": "Team/event level — its verdict is not a single task’s fact",
			"member.gates.absence.notReached": "Not started — this task has not reached this stage",
			"member.gates.absence.notRecorded": "Not persisted — it ran, but this generation did not record it (retry clears)",
			"round.tone.converging": "Review found problems · next round follows",
			"round.tone.failed": "This round failed",
			"round.tone.unmeasured": "This round was not measured",
			"round.tone.running": "This round is running",
			"round.tone.open": "This round has not started",
			"round.tone.completed": "This round completed",
			"member.openSession": "Open this member’s session",
			"member.openSession.unavailable": "Not spawned yet, so there is no session to open",
			"subagent.none": "No subagents are running under this member",
			"subagent.unmeasured": "Cannot read this member’s subagents: {reason}",
			"subagent.doing.working": "Working",
			"subagent.doing.idle": "Idle",
			"subagent.doing.unknown": "Status unknown ({status})",
			"subagent.mode.continuable": "Continuable",
			"subagent.mode.oneShot": "One-shot",
			"roster.title": "Roster and member models",
			"roster.readonly": "Read-only",
			"roster.empty": "No team yet, so there are no member models to show.",
			"roster.noModel": "No model resolved",
			"member.state.notCreated": "Not created",
			"member.status.executing": "Working on {taskId}",
			"member.status.executingModel": "Working on {taskId} · {model}",
			"member.status.working": "Working on assigned tasks",
			"member.status.waitingAssignment": "Never assigned work",
			"member.status.awaitingAssignment": "Finished {taskId} · awaiting assignment",
			"member.status.awaitingRedispatch": "{taskId} failed · awaiting re-dispatch",
			"member.status.staged": "Will be spawned after approval",
			"member.status.discarded": "Plan discarded; member was not created",
			"member.status.stopped": "Team stopped; explicit resume required",
			"task.assignee.unclaimed": "Unclaimed",
			"task.summary.waitingBreakdown": "Waiting for the captain to break down the work",
			"task.summary.staged": "{count} planned tasks awaiting approval",
			"task.summary.discarded": "{count} planned tasks discarded; none ran",
			"task.summary.allDelivered": "All {count} tasks delivered",
			"task.summary.ended": "Final: {completed} delivered · {cancelled} cancelled · {failed} failed",
			"task.summary.blockedAndRunning": "{tasks}{more} waiting on prerequisites; other work has started",
			"task.summary.more": " and {count} more",
			"task.summary.running": "{tasks} in progress",
			"task.summary.ready": "{tasks} ready to start",
			"task.summary.blocked": "{tasks} waiting on prerequisites",
			"task.summary.failedSettled": "{count} failed; the automatic loop has stopped",
			"task.summary.waitingSchedule": "Waiting for the next scheduling round",
			"progress.aria": "Overall team progress",
			"dependency.aria": "Task dependency chain",
			"dependency.parallel": "Parallel tasks",
			"dependency.title": "Task dependencies",
			"dependency.hint.parallel": "No dependencies · Click for details",
			"dependency.hint.chain": "Hover to highlight dependencies · Click to pin",
			"dependency.hint.pinned": "{taskId} pinned · Esc to clear",
			"dependency.hint.noStructure": "No task dependencies yet (nothing to connect)",
			"task.runningAria": "Running",
			"task.model": "{model}",
			"task.detail.cancelled": "Cancelled; execution will not continue",
			"task.detail.failed": "Failed; awaiting an explicit retry",
			"task.detail.completed": "Completed and delivered",
			"task.detail.noPrerequisite": "No prerequisites; ready to start",
			"task.detail.ready": "Prerequisites ready; can start",
			"task.detail.waitingOn": "Waiting for {tasks}",
			"task.detail.notRun": "Plan discarded; task was not run",
			"task.detail.noDownstream": "No downstream tasks",
			"task.detail.unlocks": "Unlocks {tasks} when complete",
			"team.ended": "Ended",
			"plan.badge": "Awaiting approval",
			"plan.title": "Pre-run plan review",
			"plan.description": "Members have not been spawned and tasks have not been scheduled. Edit the draft here, or return to chat and tell the Captain what should change.",
			"plan.member.role": "Role",
			"plan.member.model": "Model",
			"plan.member.reasoning": "Reasoning effort",
			"plan.model.choose": "Choose a model",
			"plan.model.currentUnavailable": "{provider}/{model} (not in the current catalog)",
			"plan.model.route": "Route: {provider}/{model}",
			"plan.model.providerDefault": "Provider default",
			"plan.model.modelDefault": "Model default ({effort})",
			"plan.model.triggerAria": "Choose member model, currently {model}, reasoning effort {effort}",
			"plan.model.back": "Back",
			"plan.model.loading": "Loading models…",
			"plan.model.empty": "No models available",
			"plan.model.partialFailure": "{count} provider catalogs could not be loaded",
			"plan.model.retry": "Retry",
			"plan.member.prompt": "Role prompt",
			"plan.member.roleFallback": "Role not set",
			"plan.task.subject": "Task subject",
			"plan.task.description": "Task description",
			"plan.task.assignee": "Assignee",
			"plan.task.dependencies": "Dependency task IDs (comma-separated)",
			"plan.task.dependenciesHint": "For example task-1, task-2; cycles are rejected",
			"plan.task.unassigned": "Shared task pool",
			"plan.unsaved": "Unsaved",
			"plan.save": "Save",
			"plan.saving": "Saving…",
			"plan.remove": "Remove",
			"plan.removed": "Task removed",
			"plan.removeConfirm": "Confirm remove",
			"plan.removeWarning": "Removing {task} will recalculate downstream dependencies.",
			"plan.cancel": "Cancel",
			"plan.addTask": "Add task",
			"plan.adding": "Adding…",
			"plan.taskAdded": "Task added",
			"plan.newTask": "New task subject",
			"plan.newTaskLabel": "Add a planned task",
			"plan.readySummary": "{members} members · {tasks} tasks · {links} dependencies",
			"plan.flow.aria": "Team launch flow",
			"plan.flow.review": "Review plan",
			"plan.flow.spawn": "Create members",
			"plan.flow.run": "Start work",
			"plan.members.title": "Members & model routes",
			"plan.members.count": "{count} members",
			"plan.members.empty": "No members planned yet",
			"plan.tasks.title": "Tasks & dependencies",
			"plan.tasks.count": "{count} tasks · {links} dependencies",
			"plan.tasks.empty": "No tasks planned yet",
			"plan.dependencies.none": "No dependencies",
			"plan.dependencies.count": "{count} dependencies",
			"plan.approve": "Approve & Run",
			"plan.approveTitle": "Plan ready?",
			"plan.approveHint": "Approval creates {members} members and schedules {tasks} tasks.",
			"plan.continue": "Return to chat & revise",
			"plan.returnToChat": "Return to chat",
			"plan.feedbackTitle": "Waiting for your revision direction",
			"plan.feedbackHint": "The Captain will ask in chat. After your reply, it will revise this draft and wait for approval again.",
			"plan.discard": "Discard this plan",
			"plan.discardConfirmTitle": "Discard this plan?",
			"plan.discardWarning": "The plan will end and be archived. No members have been spawned and no tasks will run.",
			"plan.discardConfirm": "Discard plan",
			"plan.discarding": "Discarding…",
			"plan.pendingEdits": "Save the current edits before launching the team.",
			"plan.saved": "Plan saved",
			"plan.failed": "Operation failed: {message}",
			"team.stats.members": "{count} members",
			"team.stats.completed": "{completed}/{total} completed",
			"team.stats.messages": "{count} messages",
			"delegation.aria": "Captain delegation map",
			"captain.name": "Captain",
			"captain.role": "Break down · Delegate · Synthesize",
			"captain.summary": "Assigned {tasks} tasks to {members} members",
			"captain.summary.staged": "Planned {tasks} tasks and {members} members; awaiting approval",
			"captain.summary.awaitingFeedback": "Draft preserved; waiting for your revision direction in chat",
			"captain.summary.discarded": "Plan discarded: {members} members were not created and {tasks} tasks did not run",
			"captain.summary.withTakeover": "Assigned {tasks} to members · Captain owns {captainTasks}",
			"captain.state.working": "{count} active",
			"captain.state.takeover": "Working on {tasks}",
			"captain.state.collected": "All reports received",
			"captain.state.waiting": "Waiting for reports",
			"captain.state.staged": "Awaiting approval",
			"captain.state.awaitingFeedback": "Awaiting feedback",
			"captain.state.discarded": "Discarded",
			"captain.state.settled": "Settled",
			"members.toggle": "Members {count}",
			"members.collapse": "Collapse",
			"members.expand": "Expand",
			"members.expandFinished": "Show finished ({count})",
			"members.empty": "No members yet; waiting for the captain to assemble the team",
			"archive.label": "Ended · Archived history",
			"archive.discardedLabel": "Plan discarded · Archived history",
			"sessionId.copyTitle": "Copy session ID: {id}",
			"sessionId.copied": "Copied",
			"sessionId.copyFailed": "Copy failed"
		};
		//#endregion
		//#region lib/client/index.js
		/**
		* ★★★ t111：真的**文件夹面板**（v5 第一层）。
		*   ★ 探针模块（`folders-probe.tsx`）**仍在**：它承载 key 常量与三个可读计数格子
		*     （渲染计数 / 注册错误 / 选择结果），那三格是三条反向半边的落点。
		*   ⇒ 本轮只把**组件**换掉，判据载体一个都没动。
		*/
		/**
		* ★★★ 2026-10-22：**房间**（需求 §27）。与文件夹**并存**，不是替换 ——
		* 理由见 `folders-probe.tsx` 的 `ROOM_MAIN_KEY` 注释（11 条臂钉在 FoldersPanel 上）。
		*/
		/**
		* ★★★ t112：**常驻的「回到工作区」入口**。
		*
		* 修的是一个用户在**真实使用**里发现的缺陷：启动时文件夹页被选中（见下面那次
		* `selectPanel`），但一旦点侧边栏的 session，`activePanelId` 就变成 `conversation`,
		* ★ **之后没有任何东西能把它切回来** —— 而 `TeamChatEntry` 在非团队会话里 `return null`，
		* 顶不上这个缺。⇒ 本入口挂在 `shell.overlay`（**frame 级 + root 作用域** ⇒ 不绑会话）。
		*/
		/**
		* ── ★★★ t118：这个**浏览器标签页**里是否已经为"呈现工作区"切过一次面板 ─────────────
		*
		* 存储位置的选择是这一格的全部内容（三个候选都试过）：
		*
		*   · **模块级 `let`** —— HMR 重载清空模块状态 ⇒ 每次重载都返回 false ⇒ 又切一次。
		*     ★ 那**正是**用户报的那个缺陷本身，不是它的解法。
		*   · **`localStorage`** —— 跨标签页共享 ⇒ "新开一页"读到的还是上一页留下的标记，
		*     于是新页面**永远不切**。把一个"太吵"的缺陷换成一个"太哑"的。
		*   · **`sessionStorage`** —— ★ 每个标签页一份、页面刷新保留、关掉重开为空，
		*     且 **HMR 重载不动它**。三条恰好对上"每次页面生命周期一次"。
		*
		* ★ 读不出来（无 `window` / 存储被禁用抛错）⇒ 当作**没切过**。
		*   理由：那会让面板**切过去**（多打扰一次），而不是**永久不切**（功能静默消失）。
		*   ★ 两者不对称，而取舍是刻意的 —— 能看见的过度好过看不见的缺失。
		*/
		const FOLDERS_SELECTED_THIS_VISIT_KEY = "dsh-agent-teams:folders-selected:v1";
		function hasSelectedPanelThisPageVisit() {
			try {
				return typeof window !== "undefined" && window.sessionStorage.getItem(FOLDERS_SELECTED_THIS_VISIT_KEY) === "1";
			} catch {
				return false;
			}
		}
		/** ★ 标记"这一页已经呈现过了"。写失败**不阻塞**本次呈现（能切就切，别把功能搭进去）。 */
		function markPanelSelectedThisPageVisit() {
			try {
				if (typeof window !== "undefined") window.sessionStorage.setItem(FOLDERS_SELECTED_THIS_VISIT_KEY, "1");
			} catch {}
		}
		/** Required services: conversation nodes, slots, sessions navigation, and locale. */
		const inject = [
			"uiConversation",
			"slots",
			"sessions",
			"locale",
			"modelDirectories",
			"layout"
		];
		/**
		* ── ★★★ t20：花名册表面的 tab key ────────────────────────────────────────────
		*
		* ★ 它与 `TEAM_TAB_ID` **不同的一个 key**：两个表面回答两个不同的问题
		*   （"这个队在干什么" / "这些身份用什么模型"）。
		* ★ 而 key 里**不含**任何 slot 名 ——
		*   这个表面挂的是 `sidebar.right.pane.tab`，而那个 slot **真实存在**
		*   （本文件在 :103 已经注册过它）。
		*/
		const ROSTER_SETTINGS_TAB_ID = "@nanmicoder/dsh-agent-teams/roster";
		const useLegacyPanelInfo = (select) => select({ activePanelId: null });
		/** The replayed user message is the canonical transcript entry. */
		function HiddenAgentTeamsCommand() {
			return null;
		}
		/**
		* Register the activity monitor in the shell's additive overlay and the
		* in-conversation team card. The card's activity button re-opens a folded
		* monitor via a window event — the recovery path for an old session.
		*/
		function apply(ctx) {
			const bridge = createWorkspaceBridge();
			const state = createWorkspaceState();
			ctx.effect(() => ctx.locale.register(AGENT_TEAMS_LOCALE_NAMESPACE, {
				zh,
				en
			}), "agent-teams: dictionaries");
			const openMember = (parentId, childId) => {
				openAgentTeamMember(ctx.sessions, parentId, childId, ctx.layout, ctx.get("uiWorkspace")).catch((error) => {
					console.warn(`agent-teams: failed to open member transcript ${childId}: ${String(error)}`);
				});
			};
			const Panel = ({ t, usePanelInfo }) => {
				const conversationVisible = (usePanelInfo ?? useLegacyPanelInfo)((panel) => panel.activePanelId === null);
				return (0, react_jsx_runtime.jsx)(ActivitySurface, {
					bridge,
					state,
					conversationVisible,
					sessionsList: ctx.sessions.list,
					modelDirectories: ctx.modelDirectories,
					openMember,
					t
				});
			};
			ctx.inject(["sidebarRight", "sidebarRightTabs"], (native) => {
				const t = native.locale.bind(AGENT_TEAMS_LOCALE_NAMESPACE);
				native.effect(() => native.sidebarRightTabs.register({
					id: TEAM_TAB_ID,
					kind: TEAM_TAB_KIND,
					title: () => t("workspace.title")
				}));
				native.slots.inject("conversation.session.header.actions", () => native.slots.register({
					name: "conversation.session.header.actions",
					id: "agent-teams-entry",
					order: 50,
					locale: AGENT_TEAMS_LOCALE_NAMESPACE
				}, TeamChatEntry));
				native.slots.inject("conversation.chat.turnTail", () => native.slots.register({
					name: "conversation.chat.turnTail",
					id: "agent-teams-summary",
					order: 50,
					locale: AGENT_TEAMS_LOCALE_NAMESPACE,
					inject: () => ({ openMember })
				}, TeamTurnCard));
				native.slots.inject("sidebar.right.pane.tab", () => {
					const dispose = native.slots.register({
						name: "sidebar.right.pane.tab",
						key: TEAM_TAB_ID,
						locale: AGENT_TEAMS_LOCALE_NAMESPACE,
						inject: () => ({
							state,
							modelDirectories: native.modelDirectories,
							openMember
						})
					}, WorkspaceActivity);
					bridge.set(native.sidebarRight);
					return () => {
						bridge.set(void 0);
						dispose();
					};
				});
				/**
				* ── ★★★ t20：花名册 / 成员模型一览 —— 挂在**同一个**已存在的 slot 上 ──────────
				*
				* ★ 用的是 `sidebar.right.pane.tab`（本文件第 :103 处已经注册过的那一个），
				*   而**不是**那个被借来的 settings 分区槽位 —— 后者在**本依赖树里不存在**
				*   （实测：在 node_modules/@deepseek-ai/ 下 grep 该槽位名零命中，
				*    `SlotMap` 按设计声明为空，`@linxin666` 也不在 store 里）。
				*   ★ 挂在一个不存在的 slot 上的表面**永远不会被渲染**，
				*     而那与"没做这个功能"在用户眼里完全同形。
				*
				* ★ 为什么另起一个 `key` 而不是塞进 `WorkspaceActivity`：两个表面回答**两个不同的问题**
				*   （"这个队在干什么" / "这些身份用什么模型"）。合成一个会让其中一个
				*   在另一个的加载态里消失 —— 而"看不见"与"没有数据"又会同形。
				*/
				native.slots.inject("sidebar.right.pane.tab", () => native.slots.register({
					name: "sidebar.right.pane.tab",
					key: ROSTER_SETTINGS_TAB_ID,
					locale: AGENT_TEAMS_LOCALE_NAMESPACE,
					inject: () => ({
						snapshots: getActivitySnapshotsSnapshot,
						subscribe: subscribeActivitySnapshots
					})
				}, RosterSettingsSurface));
			});
			/**
			* ── ★★★ 会话 ID 复制按钮（2026-10-12）────────────────────────────────────────
			*
			* ★ 它注册在**可选服务作用域之外**，而这不是风格问题：
			*   上面那一块整体挂在 `ctx.inject(['sidebarRight', 'sidebarRightTabs'], …)` 里，
			*   于是宿主一旦不提供侧边栏，**那一块里的每一格都会消失**。
			*   而"复制会话 ID"与侧边栏**没有任何关系** —— 它只需要 `slots`（必选服务）
			*   与框架按 `scope: 'session'` 注入的 `sessionId`。
			*   ⇒ 放进那个作用域会让一个**与本功能无关**的宿主差异把它一起摘掉。
			*
			* ★ 用 `utilities` 而不是 `actions`：`actions` 是标题旁的会话动作
			*   （"查看团队"在那里），`utilities` 是右对齐的工具区。
			*   会话 ID 是**关于这个会话的元信息**，不是"这个会话里有什么"。
			*
			* ★ `order: 90` 让它排在团队入口（`order: 50`）**之后** ——
			*   团队入口是内容，ID 是元信息；内容在前、元信息在后，扫读顺序才对。
			*/
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "agent-teams-session-id",
				order: 90,
				locale: AGENT_TEAMS_LOCALE_NAMESPACE
			}, SessionIdAction));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "agent-teams-activity",
				order: 80,
				label: "AgentTeams activity",
				locale: AGENT_TEAMS_LOCALE_NAMESPACE
			}, Panel));
			/**
			* ── ★★★ t112：**常驻的「回到工作区」入口**（修真实缺陷）───────────────────────
			*
			* 用户原话：「我刚才从那个大的界面点击侧面的 session 到了目前的界面,
			*          但是现在**回不去那个大的界面**了」。
			*
			* ── 为什么必须是 `shell.overlay` ────────────────────────────────────────────
			*
			* 官方 SlotMap 逐字（`dsh-client-ui-layout/lib/types/client/index.d.ts:85`）：
			*
			*     'shell.overlay': { kind: 'list'; scope: 'root' }
			*
			*   · `kind: 'list'` ⇒ ★ **换一个新 `id` 就加在既有条目旁边**，不替换任何东西
			*     （所以上面那条 `agent-teams-activity` 不受影响 —— 那是 `list` 的语义，不是我猜的）；
			*   · `scope: 'root'` ⇒ ★★ **不绑会话** ⇒ 任何界面上它都在，**包括不是团队的会话**。
			*
			* ★★★ 而"任何会话里都在"正是本缺陷的要害：`TeamChatEntry` 挂在
			*   `conversation.session.header.actions` 上，且 `if (!team) return null` ——
			*   在不是团队的会话里它**不渲染**，所以它顶不上这个缺。
			*   ★ 而本入口**不接任何会话 prop**，只读根作用域的面板状态。
			*
			* ★ `order: 78`：排在活动面板（`order: 80`）**之前**（数值小者先）——
			*   浮层里条目自排；让"回入口"先出现，是"它是唯一能回去的路"这一点在顺序上的落实。
			*/
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "agent-teams-folders-return",
				order: 78,
				label: "AgentTeams return to workspaces",
				locale: AGENT_TEAMS_LOCALE_NAMESPACE,
				/**
				* ★ 只注入两格，**都不绑会话**：
				*   · `usePanelInfo` —— 根作用域的面板选择（判断"现在在不在文件夹页"）；
				*   · `selectPanel` —— 切换的**唯一出口**（生产是 `ctx.layout.selectPanel`）。
				* ★ 而这里**刻意不注入 `sessionId`** —— 那正是"常驻"的实现：
				*   一个需要会话 id 的入口，在无会话/非团队会话里就又没了。
				*/
				/**
				* ★★ `usePanelInfo` 是**槽位注入的运行时面**（`PropsRuntime` 给的），不是我们自己从
				*   `ctx.layout.panelInfo` 拼的 —— 官方 `UsePanelInfo` 是一个 **hook**，
				*   而 hook 只有在 React 渲染期才存在。
				*   ⇒ 这里只注入**动作**；`usePanelInfo` 由框架按 `shell.overlay` 的 spec 送达。
				* ★ 于是本入口拿到的东西里**没有一个是会话相关的** —— 那正是它能常驻的原因。
				*/
				inject: () => ({ selectPanel: (panelId) => {
					noteSelectPanelCall("return-entry", panelId === null ? null : String(panelId));
					ctx.layout.selectPanel(panelId);
				} })
			}, FoldersReturnEntry));
			/**
			* ── ★★★ t103 最小实验①：注册一个**不绑会话**的 `main` key ────────────────────
			*
			* ── 它验的是什么（v5 方案的地基，`docs/UI-V5-SINGLE-ENTRY.md` §0）──────────────
			*
			* 官方有**两条**说明，而它们说的是**不同的槽位** —— 哪一条管我们，只有跑一次才知道：
			*
			*   ① `dsh-client-ui-sidebar-right`：「**No surface without a session.**」
			*      ⇒ ★ 说的是 **rightbar**
			*   ② `dsh-client-ui-layout` 的 `'main'` SlotMap：
			*      「The reserved `conversation` key hosts the Conversation;
			*        ★ **other keys receive no Session binding.**」
			*      ⇒ ★ 说的是 **main**
			*
			* ── ★ 形状照抄官方先例，不自造 ─────────────────────────────────────────────────
			*
			* `dsh-client-ui-plugin-manager` 是一个**活着的先例**（非会话面板）：
			*
			*     yield ctx.slots.register({ name: "main", key: PANEL_ID, locale: NS, store, inject, children })
			*     ctx.layout.selectPanel(PANEL_ID)      // ← 激活
			*
			* ⇒ 本探针用同一个形状：`{ name: 'main', key: ... }`。
			*   ★ 而 `'main'` 的 spec 实测是 `{ kind: 'keyed', scope: 'root' }`
			*     —— **keyed** ⇒ 可以多 key；**scope: 'root'** ⇒ 不绑会话。
			*
			* ── ★ 本注册**不画界面**（硬边界）──────────────────────────────────────────────
			*
			* 它渲染的只是一个**可编程可辨识**的标记，且每次渲染都会给一个**进程内计数器**加一
			* ⇒ "无会话时出不出现"变成 `probeRenderCount(key) > 0` 这个**可读的布尔**，
			*   而不是"截个图看看"（本机没有视觉模型）。
			*
			* ★ 注册失败**不抛出去**：把错误收进一个可读的格子里。
			*   抛出去会被外层的 catch 吞掉，而"注册失败"与"注册了但没显示"**同形** ——
			*   而那正是本实验要分开的两个态（补救动作相反：前者改方案，后者换槽位）。
			*/
			/**
			* ── ★★★ t111：探针 → **真的文件夹面板**（v5 第一层）───────────────────────────
			*
			* t103/t105 用这个 key 验过两件事：① 无会话时 **注册得进去**；② 调 `selectPanel`
			* 之后 **真的被渲染**。本任务把那个"只画一个标记"的探针换成**真正的工作区文件夹视图**
			* （`docs/UI-V5-SINGLE-ENTRY.md` §1–§3）。
			*
			* ★ **形状一字未改**：仍是 `{ name: 'main', key: FOLDERS_MAIN_KEY }` —— 同一个 key、
			*   同一个槽位、同一个 `inject` 空面。换的只有**组件**（`FoldersProbe` → `FoldersPanel`）。
			*   ⇒ 那两条已验的读数**仍然成立**，而本层不需要重新论证地基。
			*
			* ★★ **探针的计数器仍在**：`FoldersPanel` 每次渲染也会 `noteProbeRender` ——
			*   反向半边 A（不调 `selectPanel` ⇒ 渲染计数 = 0）靠的正是它。
			*   若这里改用别的计数载体，那条判据就失去了落点。
			*
			* ★ 注册失败**仍收进可读的格子**（理由同 t103：裸抛会被外层 catch 吞掉，
			*   而"注册失败"与"注册了但没显示"同形 —— 两者补救动作相反）。
			*/
			ctx.slots.inject(PROBE_SLOT_NAME, () => {
				try {
					return ctx.slots.register({
						name: PROBE_SLOT_NAME,
						key: FOLDERS_MAIN_KEY,
						/**
						* ★ `inject` 是**类型强制**的（编译期实测：`Property 'inject' is missing`）。
						*   本面板只读**模块级**的 `/state` 快照（`activitySnapshots` 单例），
						*   不需要框架注入任何面 ⇒ 保持那个空面。
						*   ★ 而给它一个**真**面会引入"注入失败"这条与本层无关的失败路径。
						*/
						/**
						* ★★★ t112（反向半边 B）：把「出去」的出口交给面板。
						*   ★ 官方：`selectPanel(null)` ⇒ 回到 Conversation。
						*   ★ 而**在这里**注入而不是让面板自己拿服务：面板保持纯表现，
						*     夹具就能注入一个记录器 ⇒ "点文件夹之后切到哪"是可编程判据。
						*/
						inject: () => ({ openConversation: () => {
							noteSelectPanelCall("folder-open", null);
							ctx.layout.selectPanel(null);
						} })
					}, FoldersPanel);
				} catch (error) {
					error instanceof Error && error.message;
					return () => {};
				}
			});
			/**
			* ── ★★★ 2026-10-22：第二个 `main` key —— **房间**（需求 §27）───────────────────
			*
			* 形状与上面那个**逐字相同**（`{ name: 'main', key }` + 空 `inject` 面）：
			* 上面那一段已经用真实宿主演到过「无会话时注册得进去 / `selectPanel` 之后真的被渲染」
			* ⇒ ★ 本层**不需要重新论证地基**，只需要证明"房间也是同一个形状"。
			*
			* ★★ 它**不出现在**默认路径上：`main` 一次只显示一个 key，而"哪个 key 默认"
			*   是一个**产品决策**（要不要让房间取代文件夹页？）⇒ 见 §27.5 的待裁定。
			*   本轮只保证：**这个 key 注册得进去、且被选中时真的渲染**。
			*
			* ★ 注册失败**仍收进可读的格子** —— 与上面那个逐字同源：
			*   "注册失败"与"注册了但没显示"同形，而两者补救动作相反。
			*/
			ctx.slots.inject(PROBE_SLOT_NAME, () => {
				try {
					return ctx.slots.register({
						name: PROBE_SLOT_NAME,
						key: ROOM_MAIN_KEY,
						/** ★ 房间同样是纯表现：数据来自模块级 `/state` 快照，`inject` 留空面。 */
						inject: () => ({ openConversation: () => {
							noteSelectPanelCall("room-open", null);
							ctx.layout.selectPanel(null);
						} })
					}, RoomPanel);
				} catch (error) {
					error instanceof Error && error.message;
					return () => {};
				}
			});
			/**
			* ── ★★★ t105 最小实验①b：调【公开写入口】`selectPanel`，补上最后一跳 ──────────
			*
			* t103 实测：我们的 key **注册成功**（真的占了 cell）但**默认不被选中** ——
			* 因为官方 `MainPanel` 逐字 `entryKey = activePanelId ?? "conversation"`，
			* 而 `activePanelId` 的初值是 `null`。
			*
			* ★ 而官方**给了写入口**（`ctx.layout`，本插件**已经注入**，见 `inject` 的 `'layout'`）：
			*
			*     LayoutController.selectPanel(panelId)                      // client.js:462
			*       if (panelId !== null && !hasMainPanel(panelId)) throw …  //   自己的守卫
			*       this.panels.selectPanel(panelId)                         //   ⇒ activePanelId = panelId
			*
			* ⇒ ★ 本步就是问：**调了之后，它真的被渲染吗？**
			*
			* ── ★★ 两条刻意的不变量（它们就是两条反向半边）──────────────────────────────
			*
			*   ① ★ **不改默认**：本调用是**显式**的，不是把 `activePanelId` 的初值改掉。
			*      ⇒ 若把默认改成我们的 key，"默认也渲染"与"调了才渲染"就**同形**了 ——
			*        而 t103 实测的默认是 `conversation`，那条读数必须**仍然成立**。
			*   ② ★ **调用点唯一**：只在这里调一次 ⇒ 让"渲染计数 > 0"能**归因**到这一次选择，
			*      而不是"页面上某处在渲染它"。
			*
			* ★ 调失败**不裸抛**：收进可读的格子（理由同上面的注册 —— 裸抛会被外层 catch 吞掉，
			*   而"选择被拒"与"没选"**同形**，两者补救动作相反）。
			*/
			try {
				/**
				* ── ★★★ t117 / t118：**每次页面生命周期只切一次** ──────────────────────────────
				*
				* USER-REPORTED（两次，逐字）：
				* > 「是因为你一直在重启吗，怎么时不时就会被切到工作区那个页面，
				* >   很影响我在其他会话的工作，不应该时不时就切到工作区页面」
				* > 「为什么还是会不停地切到工作区，不要这样」
				*
				* ── 机制（MEASURED，不是推测）────────────────────────────────────────────────
				*
				* 本块是 `apply()` 的副作用：插件每被加载一次，就 `selectPanel(我们的 key)`。
				* 而"加载"不只发生在页面打开：
				*   `~/.dsh/profiles/desktop/cordis.patch.yml:536` 的 HMR `root: ['.']`
				*   ⇒ `lib/**` 每次被 `pnpm build` 重写后约 100ms 就重载客户端插件。
				*   实测 `.agent-teams/hmr-reloads.jsonl`：50 次重载，最小间隔 **181ms**，
				*   10 秒内连击 **28** 次。⇒ 我在另一侧敲一次构建，你这一侧就被推走一次。
				*
				* ── ★★★ t117 的第一次修法是【错的】，记在这里免得再犯 ─────────────────────────
				*
				* 第一版判据：`activePanelId === null` 时才切。理由是"null ⇒ 用户不在任何面板上"。
				* ★★ 而 `service.d.ts:18` 逐字：`null displays the current Conversation` ——
				*   **`null` 恰恰是"用户正在会话里"**，也就是**最常见**的状态。
				*   ⇒ 这个守卫在最常见的场景下**恰好放行**，等于没修。
				*   用户复测当场打回：「为什么还是会不停地切」。
				*
				* ── ★ 正确的判据是【页面生命周期】，不是【面板位置】──────────────────────────
				*
				* 用户要的是"打开页面时给我看一眼工作区，之后别再来打扰我"。
				* 那件事的对象是**这个浏览器标签页**，而它的真值是 `sessionStorage`：
				*   · 每个**标签页**一份，刷新页面 ⇒ 还在（不重复切）；
				*   · **关掉标签页再开** ⇒ 空（该给的那一眼还是给）；
				*   · HMR 重载 ⇒ **不动它**（那正是我们要的：重载 ≠ 新的一页）。
				*
				* ★★ 为什么不是模块级 `let firstLoad = true`：HMR 重载会把模块状态全清，
				*   于是每次重载都是 `true` ⇒ 又切一次。**那正是本缺陷本身**，不是它的解法。
				* ★ 为什么不是 `localStorage`：它跨标签页共享，"新开一页"就读不到"这是新的一页"。
				*
				* ── ★ 反向半边（这一格不许被收紧成"永不切"）────────────────────────────────
				*
				* 首次打开**仍然要切** —— 那是 v5 的设计（文件夹页就是入口）。
				* ⇒ 臂 14 断言：没有标记时**必须**调 `selectPanel` 并**写下**标记；
				*   有标记时**必须不调**。两半都要绿，否则修法就变成了"把功能删掉"。
				*/
				noteProbeSelection(FOLDERS_MAIN_KEY);
				if (!hasSelectedPanelThisPageVisit()) {
					markPanelSelectedThisPageVisit();
					/**
					* ★ `selectPanel` 收的是**品牌类型** `MainPanelId`（`= string & { readonly [BRAND]: 'MainPanelId' }`），
					*   不是裸 `string` —— 编译期实测报错：`Argument of type 'string' is not assignable to MainPanelId`。
					*
					* ★★ 官方给的构造器是 `brandString<T>()`（`@deepseek-ai/dsh-brand`），
					*   但那个包**不是本插件的依赖**（实测：从本包 `require.resolve` ⇒ 解析失败），
					*   且本任务**零新依赖** ⇒ 不引它。
					*
					* ⇒ 这里用**类型层**的断言把品牌补上：**运行期零成本**（品牌只存在于类型里，
					*   `MainPanelId` 的值就是那个字符串），且**不引入任何 import**。
					* ★ 这不是"绕过类型" —— 品牌在这里的**唯一**作用就是挡住"随手传一个错 id"，
					*   而我们这个 id 与 `slots.register` 用的是**同一个常量** ⇒ 不可能漂移。
					*/
					const probePanelId = FOLDERS_MAIN_KEY;
					ctx.layout.selectPanel(probePanelId);
					noteProbeSelectionAccepted();
				}
			} catch (error) {
				error instanceof Error && error.message;
			}
			ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
				name: "conversation.chat.commandview",
				key: "agent-teams"
			}, HiddenAgentTeamsCommand));
			ctx.uiConversation.events.register(agentTeamsCardDefinition);
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "agent-teams",
				locale: AGENT_TEAMS_LOCALE_NAMESPACE,
				inject: () => ({
					openMember,
					workspaceBridge: bridge
				})
			}, AgentTeamsCard));
		}
		//#endregion
		exports.ROSTER_SETTINGS_TAB_ID = ROSTER_SETTINGS_TAB_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map