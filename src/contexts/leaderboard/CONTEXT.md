# Leaderboard Context — Legacy, Beta-Dark

## Bounded context

This package retains only an inert build and the content-free inventory needed
to export and restore historical ranking rows. Ranking repositories,
use cases, scoring, comparison, mapping, reconciliation, and Recognition
activation mechanics have been removed from the runtime source tree.
Competitive leaderboards are not approved beta behavior and are not the future
recognition model. `leaderboard.use` remains denied.

The former `/leaderboard` address may show only a mild **Achievement Board
unavailable** state. It must not load ranking data, calculate snapshots, expose a
comparison matrix, or imply that employees, Portals, Portal Groups, Properties,
or Teams are being ranked.

## Invariants

1. `leaderboard.use` remains denied and no ranking read, server operation,
   refresh, consumer, or schedule may exist in the beta runtime.
2. Retained snapshots cannot influence access, Staff assessment, Goals,
   notifications, manager workflow, or Portal publication.
3. Historical ranking data remains distinguishable from any future neutral
   recognition model and is retained only for bounded inventory, export,
   restore, and contraction.

## Events produced

Leaderboard defines no cross-context domain events and retains no refresh path.

## Public API

`application/public-api.ts` exposes only
`canonicalLegacyRecognitionInventoryReport`, the canonical content-free
inventory report formatter. It has no ranking or Recognition product operation.
The production container does not construct or expose Leaderboard, and no
Leaderboard server operation exists.

## Prohibited beta behavior

- no per-metric or composite rank, normalized score, tie ordering, competition,
  weak-performer language, or Staff/Team comparison;
- no refresh on Metric events and no reconciliation schedule;
- no successful server-function behavior or data reachability, navigation, API,
  Leaderboard-owned export surface, Dashboard, Staff-home, Portal, or
  notification surface; server declarations are absent. The Identity-owned
  Organization Export contribution below is not a Leaderboard surface: it is a
  read-only contributor invoked by Identity's bundle builder and exposes nothing
  to a tenant except the ZIP;
- no authorization or management decision derived from retained snapshots;
- no migration of Team memberships into Portal Groups.

## Retained implementation

The legacy schema and content-free inventory repository remain for restore
compatibility and deletion proof. Production composition does not call
`buildLeaderboardContext`; that build constructs no repository, use case,
consumer, job, or schedule. The entry/event catalogues contain no Leaderboard
server or consumer declaration. A removal-only scheduler tombstone remains so
an older deployed BullMQ schedule is deleted rather than orphaned. Ranking and
activation mechanics are absent, and an executable exact-source allowlist fails
if they return.

## Organization Export contribution

`LIF-01` requires a contribution from all seventeen contexts, so
`infrastructure/adapters/leaderboard-organization-export.adapter.ts` answers for
Leaderboard. The blocked capability suppresses new ranking behaviour; it does not
delete the tenant's record of what was already computed for it. The activation
row in particular is the consent record — who acknowledged Recognition for a
Property, under which jurisdiction, notice, and consultation status — and is
exactly what an Organization needs when auditing why a board existed. Rows are
exported as `tenant_visible`; the contributor returns `complete` when they exist
and the affirmative `no_data` when they do not, and never `omitted`.

It reads `recognition_activations`, `recognition_activation_groups`,
`recognition_board_snapshots`, `recognition_board_entries`,
`recognition_reconciliation_events`, `leaderboard_entries`, and
`leaderboard_snapshots` inside one read-only repeatable-read snapshot bounded to
fifteen minutes after the request. `leaderboard_snapshots` predates
tenant-scoped columns and carries only a `property_id`; because a dark context
may not read the Property table (BQC-5.10 row 2 WATCH register), it is scoped
through its own Organization-scoped entries. A legacy snapshot with no such
entry cannot be attributed to the Organization and is declared as an excluded
record class rather than guessed into the archive.

This is not a Leaderboard surface. The adapter constructs no repository,
registers no consumer, job, or schedule, exposes no route or server function,
and is not reachable from `buildLeaderboardContext`, which stays an empty
inventory boundary. `leaderboard.use` remains `legacy_blocked` and its fate
record is unchanged. Ranks and scores travel in the archive as historical facts
and never as a current comparison of people, Portals, Properties, or Teams.

## Future recognition boundary

If recognition is activated after core beta, it is implemented as the neutral
calendar-month **Healthy Guest Gateway** model in a separately authorized
program/result design based on governed Portal Health. It must not reuse
leaderboard ranks or snapshots as its decision authority.

## Exit criteria

The unreachable ranking paths, server operations, and consumer declaration are
already removed and can be recovered from version control if rollback is needed.
Inventory and disposition retained rows, prove no compatibility reader depends
on the schema, capture restore/export evidence, then remove the obsolete schema
through a separately reviewed reversible contraction plan.

The read-only `ops:report-legacy-recognition` command owns the exact table/count
and reconstructable schema-qualified inbound/outbound foreign-key inventory.
Both reads share one repeatable-read, read-only database snapshot. Its fixed
Staff lifecycle owner, bounded-contraction disposition, and REC-01/CNV-01
authority mirror the executable data-fate catalogue. Export/restore remains a
separate blocking step; the report never authorizes deletion.

## Verification authority

- Capability darkness: `src/shared/auth/dark-capability-enforcement.test.ts`
- Runtime darkness: `src/shared/auth/dark-context-matrix.test.ts`,
  `src/shared/architecture/dark-consumer-gating.test.ts`, and
  `src/shared/architecture/legacy-recognition-active-surfaces.test.ts`
- Entry-point/job dispositions: `src/shared/governance/entry-point-catalogue.ts`
  and `src/shared/governance/event-job-catalogue.ts`
- Direct metric-reader and raw-role absence:
  `src/shared/governance/metric-read-authority.test.ts` and
  `src/shared/governance/raw-role-decision-catalogue.test.ts`
- Product decision: `docs/comprehensive-beta-implementation-program-2026-08-25.md`
  (`REC-01`)
