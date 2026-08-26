# Badge Context — Legacy, Beta-Dark

## Bounded context

This package retains the legacy Badge model only so existing rows can be
inspected, reconciled, exported, and removed safely. It is not active beta
product authority. `badge.use` remains denied, Badge jobs/consumers must not
evaluate or award, and no beta route may expose Badge data.

The agreed controlled post-core direction is a non-competitive **Healthy Guest
Gateway** recognition result derived from governed Portal Health for one
calendar month. That model does not yet exist and must not be simulated by
renaming or reactivating legacy badges.

## Invariants

1. `badge.use` remains denied in beta and no retained Badge path may become
   reachable through a route, worker, consumer, schedule, notification, or
   production artifact.
2. Retained Badge rows cannot influence access, Staff assessment, Goals,
   manager workflow, Portal publication, or recognition decisions.
3. Historical Badge data remains distinguishable from any future Healthy Guest
   Gateway model and is retained only for bounded inventory, export, restore,
   reconciliation, and contraction.

## Events produced

The package retains the historical `badge.awarded` event type for data and
restore compatibility. No beta-active path may emit it while `badge.use` is
denied.

## Public API

`application/public-api.ts` retains historical types and event exports for
compatibility. It is not an activation surface; runtime use remains governed by
the capability and entry-point authorities.

## Prohibited beta behavior

- no Badge creation, enablement, evaluation, award, reconciliation, or
  notification;
- no influence on authorization, Staff assessment, Goals, manager workflow, or
  Portal publication;
- no Team scope, ranking, score, streak, milestone, or comparative language;
- no route, navigation, dashboard, Staff-home, Portal-detail, or notification
  reachability;
- no reinterpretation of historical Badge rows as Healthy Guest Gateway
  results.

## Retained implementation

The domain types, repositories, server functions, event handlers, scheduled
jobs, tables, and historical tests describe the legacy system. They are retained
temporarily for contraction and restore compatibility, not as a product promise.
Any code change in this package must preserve hard denial and make deletion or
reconciliation safer.

## Exit criteria

Before legacy Badge paths can be removed, retain a bounded inventory and restore
proof for existing rows, prove no executable entry point or production artifact
depends on them, and document the migration/deletion decision. A future
recognition implementation requires Portal Health, separate authorization,
program/version/result records, neutral manager language, correction behavior,
fairness/privacy review, and its own accepted activation decision.

## Verification authority

- Capability darkness: `src/shared/auth/dark-capability-enforcement.test.ts`
- Runtime darkness: `src/shared/architecture/dark-context-matrix.test.ts` and
  `src/shared/architecture/dark-consumer-gating.test.ts`
- Entry-point/job dispositions: `src/shared/governance/entry-point-catalogue.ts`
  and `src/shared/governance/event-job-catalogue.ts`
- Product decision: `docs/comprehensive-beta-implementation-program-2026-08-25.md`
  (`REC-01`)
