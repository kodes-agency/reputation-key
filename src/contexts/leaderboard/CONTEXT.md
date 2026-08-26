# Leaderboard Context — Legacy, Beta-Dark

## Bounded context

This package retains historical ranking/snapshot code and rows for bounded
contraction only. Competitive leaderboards are not approved beta behavior and
are not the future recognition model. `leaderboard.use` remains denied; reads,
refreshes, consumers, and schedules must stay unreachable.

The former `/leaderboard` address may show only a mild **Achievement Board
unavailable** state. It must not load ranking data, calculate snapshots, expose a
comparison matrix, or imply that employees, Portals, Portal Groups, Properties,
or Teams are being ranked.

## Invariants

1. `leaderboard.use` remains denied and no ranking read, refresh, consumer, or
   schedule may be beta-reachable.
2. Retained snapshots cannot influence access, Staff assessment, Goals,
   notifications, manager workflow, or Portal publication.
3. Historical ranking data remains distinguishable from any future neutral
   recognition model and is retained only for bounded inventory, export,
   restore, and contraction.

## Events produced

Leaderboard currently defines no cross-context domain events. Its retained
refresh paths must remain inactive while the capability is denied.

## Public API

`application/public-api.ts` retains historical read types for compatibility.
It is not an activation surface; runtime use remains governed by the capability
and entry-point authorities.

## Prohibited beta behavior

- no per-metric or composite rank, normalized score, tie ordering, competition,
  weak-performer language, or Staff/Team comparison;
- no refresh on Metric events and no reconciliation schedule;
- no server-function, navigation, API, export, Dashboard, Staff-home, Portal, or
  notification reachability;
- no authorization or management decision derived from retained snapshots;
- no migration of Team memberships into Portal Groups.

## Retained implementation

The legacy schema, domain types, repository, server function, handlers, and jobs
remain temporarily for data inventory, restore compatibility, and deletion
proof. Their names and tests describe historical mechanics, not a current
product contract. Any maintenance change must strengthen darkness or bounded
contraction.

## Future recognition boundary

If recognition is activated after core beta, it is implemented as the neutral
calendar-month **Healthy Guest Gateway** model in a separately authorized
program/result design based on governed Portal Health. It must not reuse
leaderboard ranks or snapshots as its decision authority.

## Exit criteria

Inventory and disposition retained rows, prove no executable entry point or
production artifact depends on the model, capture restore/export evidence, then
remove the ranking paths and obsolete schema through a reversible contraction
plan.

## Verification authority

- Capability darkness: `src/shared/auth/dark-capability-enforcement.test.ts`
- Runtime darkness: `src/shared/auth/dark-context-matrix.test.ts`,
  `src/shared/architecture/dark-consumer-gating.test.ts`, and
  `src/shared/architecture/legacy-recognition-active-surfaces.test.ts`
- Entry-point/job dispositions: `src/shared/governance/entry-point-catalogue.ts`
  and `src/shared/governance/event-job-catalogue.ts`
- Product decision: `docs/comprehensive-beta-implementation-program-2026-08-25.md`
  (`REC-01`)
