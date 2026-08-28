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

`application/public-api.ts` exposes only the content-free 13-table inventory
model and canonical report formatter. It has no ranking or Recognition product
operation. The production container does not construct or expose Leaderboard,
and no Leaderboard server operation exists.

## Prohibited beta behavior

- no per-metric or composite rank, normalized score, tie ordering, competition,
  weak-performer language, or Staff/Team comparison;
- no refresh on Metric events and no reconciliation schedule;
- no successful server-function behavior or data reachability, navigation, API,
  export, Dashboard, Staff-home, Portal, or notification surface; server
  declarations are absent;
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
