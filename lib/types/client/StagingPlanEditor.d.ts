/**
 * Editable pre-run roster and DAG review for staged AgentTeams plans.
 *
 * This leaf owns only transient form/disclosure state. Durable truth remains
 * on the host and returns through the ordinary activity polling snapshot.
 * @module dsh-agent-teams/client/staging-plan
 */
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { ActivityMember, ActivityTeam } from './activity-monitor.ts';
import type { AgentTeamsTranslate } from './locales.ts';
export declare function StagingPlanEditor({ team, modelDirectory, onContinuePlanning, onDiscarded, t }: {
    readonly team: ActivityTeam;
    readonly modelDirectory: ModelDirectory;
    readonly onContinuePlanning: () => void;
    readonly onDiscarded: () => void;
    readonly t: AgentTeamsTranslate;
}): import("react").JSX.Element;
/**
 * Whether a member's model may still be changed.
 *
 * ★ Three states, never two. The server decides the rule (a spawned member's
 *   route is frozen into its session descriptor — see the update_member guard
 *   in src/tools.ts); this only READS the fact the snapshot already carries.
 *
 *   'editable' — not spawned yet, so a change will be applied on spawn.
 *   'sealed'   — already spawned; a change would be recorded without being
 *                applied. Must render as disabled WITH that reason.
 *   'unknown'  — the member's identity cannot be determined, so we cannot say.
 *
 * ★ The last state is load-bearing: an empty `id` on a member that has never
 *   been spawned and a snapshot that omits `id` entirely are indistinguishable
 *   here, so "cannot tell" must not be rounded to "editable" — that would be
 *   offering a control we cannot promise works.
 */
export type MemberModelEditability = 'editable' | 'sealed' | 'unknown';
/**
 * Read whether one member's model is still editable.
 * @param member - the member row; `id` is the spawn marker (empty until spawned).
 * @returns the three-state reading.
 */
export declare function memberModelEditability(member: {
    readonly id?: string;
}): MemberModelEditability;
/**
 * The model picker bound to one member row, for BOTH staged and running teams.
 *
 * Reuses {@link StagedModelPicker} directly. Persists through the same plan
 * route the staged editor uses, so there is exactly one write path.
 */
export declare function MemberModelField({ team, member, modelDirectory, disabledReason, t }: {
    readonly team: ActivityTeam;
    readonly member: ActivityMember;
    readonly modelDirectory: ModelDirectory;
    /** When set, the control renders disabled with this reason instead of silently doing nothing. */
    readonly disabledReason: string | undefined;
    readonly t: AgentTeamsTranslate;
}): import("react").JSX.Element;
