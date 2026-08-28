# Badge Context — Legacy, Beta-Dark

## Bounded context

This package retains only the historical event vocabulary
needed while existing rows are inventoried, exported, restored, and deliberately
dispositioned. Legacy Badge repositories, evaluation, enablement, seed,
reconciliation, mappers, and award-domain mechanics have been removed from the
runtime source tree. It is not active beta product authority. `badge.use`
remains denied, and no dedicated beta route or control may expose the program.
Neutral notification-history rendering of an already-persisted
`badge.awarded` row is the only presentation compatibility path.

The agreed controlled post-core direction is a non-competitive **Healthy Guest
Gateway** recognition result derived from governed Portal Health for one
calendar month. That model does not yet exist and must not be simulated by
renaming or reactivating legacy badges.

## Invariants

1. `badge.use` remains denied in beta and no retained Badge path may become
   newly reachable through a route, worker, producer, schedule, or production
   artifact. Notification may render an already-persisted award row as neutral
   history, but cannot offer Badge controls or create a new award fact.
2. Retained Badge rows cannot influence access, Staff assessment, Goals,
   manager workflow, Portal publication, or recognition decisions.
3. Historical Badge data remains distinguishable from any future Healthy Guest
   Gateway model. Retained schema is used only for bounded inventory, export,
   restore, and later reviewed schema contraction.

## Events produced

| Tag             | Payload                                                                                                                             | When emitted                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `badge.awarded` | eventId, organizationId, propertyId, badgeDefinitionId, criteriaVersion, targetType, targetId, awardedAt, occurredAt, correlationId | Historical compatibility only; no beta producer may emit it |

The package retains this event type for data and restore compatibility. No
beta-active path may emit it while `badge.use` is denied.

## Public API

`application/public-api.ts` exports only the historical `badge.awarded` event
types — `BadgeAwarded`, the `BadgeEvent` union, and `BadgeTargetType`. It is a
type-only decoding boundary, not a Badge producer or product API.
The production container does not construct or expose Badge, and no Badge
server operation exists.

## Prohibited beta behavior

- no Badge creation, enablement, evaluation, award, reconciliation, Badge-side
  notification producer, or dedicated notification control;
- no influence on authorization, Staff assessment, Goals, manager workflow, or
  Portal publication;
- no Team scope, ranking, score, streak, milestone, or comparative language;
- no route, navigation, dashboard, Staff-home, Portal-detail, Badge-owned
  notification control, or Badge producer reachability; Notification's neutral
  historical row renderer is the only retained downstream compatibility seam;
- no reinterpretation of historical Badge rows as Healthy Guest Gateway
  results.

## Retained implementation

Only the inert build, historical event envelope, content-free Recognition
inventory/report, and database schema remain. Production composition does not
call `buildBadgeContext`; startup and demo seed tooling cannot seed, enable,
evaluate, or reconcile Badge data. The entry/event catalogues contain no Badge
server or consumer declaration. Notification retains only the
persistence vocabulary and neutral renderer needed to display existing rows; it
has no `badge.awarded` subscription, lookup adapter, replay path, or
materialization handler.

## Exit criteria

The unreachable legacy mechanics, server operations, and consumer declaration
are already removed and can be recovered from version control if rollback is
needed. Before the database schema or historical event envelope can be removed,
retain a bounded inventory and restore proof for existing rows, prove no
compatibility reader depends on them, and accept a separate migration/deletion
decision. A future recognition
implementation requires Portal Health, separate authorization,
program/version/result records, neutral manager language, correction behavior,
fairness/privacy review, and its own accepted activation decision.

The read-only `ops:report-legacy-recognition` command owns the exact table/count
and foreign-key inventory. Export/restore remains a separate blocking step; the
report never authorizes deletion.

## Verification authority

- Capability darkness: `src/shared/auth/dark-capability-enforcement.test.ts`
- Runtime darkness: `src/shared/auth/dark-context-matrix.test.ts`,
  `src/shared/architecture/dark-consumer-gating.test.ts`, and
  `src/shared/architecture/legacy-recognition-active-surfaces.test.ts`
- Entry-point/job dispositions: `src/shared/governance/entry-point-catalogue.ts`
  and `src/shared/governance/event-job-catalogue.ts`
- Product decision: `docs/comprehensive-beta-implementation-program-2026-08-25.md`
  (`REC-01`)
