# Harness 0.2.1-rc.2 compatibility

Target: published desktop/CLI `0.2.1-rc.2`. Previous supported host: `0.2.0-rc.2`.

`0.1.23` was rejected by the rc.2 host before activation, because its exact peer
requirements stopped at `0.2.0-rc.2`. That rejection is silent from the user's
point of view: the whole profile bundle is skipped during composition, so every
`agent_teams_*` tool and the `agent-teams:usage` system prompt section simply do
not exist. Nothing reports an error to the conversation.

The skip takes the plugin's **client half** with it, which is easy to overlook
because the two halves fail in unrelated-looking places: the "copy session ID"
chip that lives in `conversation.session.header.utilities` disappears too, even
though nothing about that chip depends on the tool surface. A missing header
control is therefore not evidence of a slot-contract change — check whether the
package composes at all first. On a composing `0.2.1-rc.2` host the slot is
still declared (`dsh-client-ui-conversation` contract: `kind: 'list'`,
`scope: 'session'`), the client bundle is advertised in the boot graph as
`@nanmicoder/dsh-agent-teams` → `plugins/??@nanmicoder/dsh-agent-teams/client.js`,
and the served bundle still registers `agent-teams-session-id`.

## What the host changed

Two independent breaking changes, and the first one alone is not enough to fix:

1. **Composition-time version gate.** A profile bundle whose peer requirements do
   not admit the running host is skipped whole. Declaring `0.2.1-rc.2` in the
   peers and in `compatibility.json` is what makes the plugin load at all.
2. **Member creation contract.** rc.2 removed `startContinuable` and `start`
   from `SubagentRuntime` (verified against the packaged
   `@deepseek-ai/dsh-subagent/lib/index.js`: the prototype carries
   `startActivation`, `prepareContinuable`, `drainChildren`, but neither
   `startContinuable` nor `start`). `SubagentContinuationManager.startContinuable`
   still exists in `lib/types/continuation.js` but is no longer imported by the
   runtime entry, so it is dead code rather than an available API.

The in-process spawn provider also dropped capabilities: rc.2 advertises
`{ agentOptions, agentPreset, outputSchema, depthLimit }`, while `0.2.0-rc.2`
advertised `{ agentOptions, outputSchema, depthLimit, toolFilter, persona }`.
A member creation path that asserts `provider.capabilities.persona` or
`.toolFilter` therefore throws on rc.2 even after the gate is satisfied.

## Source changes

Five files, mirroring the shape the host now expects:

- `src/harness-compat.ts` — new activation adapter: `MemberStartSpec`,
  `usesManagedActivations`, `startMember`, `guardSubagentCreation`,
  `drainMemberChildren`. Member creation now goes through `startActivation`
  when the runtime exposes it, else `startContinuable`. The delegation guard
  wraps every creation entry point the host exposes instead of monkey-patching
  the two that existed before.
- `src/members.ts` — capability assertions became conditional on the host
  generation (`managed` hosts restore persona and tool filters themselves via
  `runtimeSetup`), member startup goes through the adapter, and the spawn result
  records `runtimeSetup` on managed hosts.
- `src/types.ts` — `TeamMember.runtimeSetup` carries the exact child-scoped
  setup so a cold resume can reinstall it. `MemberToolFilter` moved here: this
  file is the leaf of the module graph and a gate pins it at zero imports.
- `src/state.ts` — validates `runtimeSetup` when reading durable records.
- `src/tools.ts` — member hydration moved after tool registration, because
  restoring a saved filter calls `childCtx.tools.restrict()` and the filter
  names tools that must already exist.

## Verification

Local macOS, node 24.21.0 (the runtime the desktop app ships):

- `pnpm build`, `pnpm typecheck`, `node scripts/doctor.mjs` — clean against
  `0.2.1-rc.2` (295 DSH package identities, no split identities).
- `scripts/harness-compat-tdd.mjs` 19/19, `stability-tdd.mjs` 7/7,
  `member-failure-tdd.mjs` 10/10 in both `--modern-harness` and
  `--delivery-harness`, `web-routes-verify.mjs`, `compatibility.mjs` plus its
  test suite, and the capabilities/corrupt-state/release/readme/frictions
  suites.
- Real host: an isolated `DSH_HOME` profile on `0.2.1-rc.2` composes the plugin
  with zero stderr, and a launched `dsh web` reports
  `/plugins/dsh-agent-teams/degraded` ⇒ `200 {"plugin":"agent-teams","state":"healthy","degraded":[]}`.
  The authenticated routes answer `401` without a browser session (registered
  but gated) and `200 {"teams":[]}` with one — the same readings an
  already-working plugin produces.

Two check families stay red, and both are pre-existing in this workspace rather
than caused by the migration — each reproduces identically on the pre-migration
commit in a detached worktree:

- `scripts/lifecycle-verify.mjs` and `scripts/stress-verify.mjs` stop at
  `create_task rejected: [dispatch.plan-reviewed]`, tracked as
  [DECISIONS-PENDING ⑥](../DECISIONS-PENDING.md). Their cleanup also races
  `rm` against async state writes (`ENOTEMPTY`).
- Eight client-rendering checks in `scripts/verify.mjs` (event registry, locale
  namespace, business color, badge layout) fail the same way before the change.

`scripts/gate-t1-completion-probe.test.mjs` arm 5 reads a gitignored
`.agent-teams/unified-pipeline/team.json` off this machine's disk. That fixture
has a `baseRevision` recorded, so the arm's "not recorded" premise is false here;
it passes on a clean checkout where the file is absent.

## Recovery

`0.1.23` cannot run on `0.2.1-rc.2` and never could — do not add a version
exemption to a `0.1.23` install, because the member creation calls it makes no
longer exist on the host. Upgrade the plugin instead. Rolling the host back to
`0.2.0-rc.2` still works with this release, since the old contract remains
supported through the same adapter.
