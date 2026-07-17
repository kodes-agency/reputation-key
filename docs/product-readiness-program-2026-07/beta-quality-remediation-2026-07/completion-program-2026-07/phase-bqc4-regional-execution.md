# BQC-4 — Enforced Property-Region Execution

**Status:** `not_started`  
**Estimate:** 6–9 engineering days  
**Dependencies:** BQC-1, BQC-2, and selected BQC-3 runtime primitives  
**Unlocks:** US real-property pilot, later European cell, Phase 17 provider routing

## 1. Outcome

A property's approved processing region selects the actual queue, worker, data/cache/object-storage boundary, and external provider endpoint for every protected workload. `unresolved` or unavailable routing fails closed and becomes an operator-visible state. No code or infrastructure silently falls back to another region.

## 2. Findings owned

- SPEC-P1-01 — processing region is metadata only.
- Regional portion of SPEC-P0-03.
- Topology/alert portions of SPEC-P1-05.

## 3. Routing decisions

Record or confirm an ADR defining:

- supported region identifiers (`us`, `europe`, `global`, `unresolved`) and whether `global` is an actual approved cell or a denied placeholder;
- resolution sources and precedence (verified Google address, merchant/operator decision, contractual override);
- immutable/locked transitions and an approved move workflow;
- workloads requiring regional execution;
- control-plane metadata allowed outside the property cell;
- queue, database, cache, object storage, log/trace, backup, support access, and provider endpoint mapping;
- behavior when the target or provider is unavailable;
- routing-policy version and evidence.

For initial beta, activate only the US cell. Europe remains denied until its infrastructure and privacy/data-flow evidence pass.

## 4. Target deep module

`ProcessingRouter` resolves `(propertyId, workloadClass)` to a typed `ProcessingTarget` containing only approved execution references and routing-policy version. It hides property lookup, region resolution, cell/provider configuration, health/availability, and no-fallback policy.

Callers do not switch on country codes or construct provider endpoints. Jobs cannot choose their own region. The router has a production configuration adapter and a deterministic test adapter.

## 5. Slices

### BQC-4.1 — Active-property region reconciliation

- Backfill every property from authoritative country/source data.
- Produce explicit `resolved`, `ambiguous`, `missing`, and `conflict` reports.
- Prevent activation/import/sync for `unresolved` properties.
- Require operator review for ambiguity; do not infer a fallback.
- Lock cross-region changes behind a dedicated move workflow.

### BQC-4.2 — Regional job envelope and queues

- Stamp property ID, resolved region, workload class, and routing-policy version at enqueue without content.
- Enqueue through the router to region-specific queues/connections.
- Workers declare their cell and reject/quarantine jobs for another cell.
- Re-resolve current policy before protected work; stale routing policy stops and reschedules through an approved workflow.
- Region is never accepted only because it is present in the payload.

### BQC-4.3 — Data and provider execution

- Region-specific adapters are selected only by `ProcessingTarget`.
- Google/source access, future AI calls, caches, object storage, logs/traces, and backups follow the approved data-flow map.
- Raw content never appears in a global control plane.
- Provider unavailability in the target cell produces retry/degraded/blocked state, not another-region execution.

### BQC-4.4 — Regional reads and operations

- Interactive requests route property-local reads to the correct cell.
- Fleet/global views use permitted content-free aggregates only.
- Operator tooling displays region, source, policy version, health, and blocked reason without raw content.
- Support access is least-privilege and audited by cell.

### BQC-4.5 — Region move workflow

Design a deliberate state machine even if moves remain operator-only:

- requested → writes paused → queues drained/quarantined → data copied/verified according to policy → target activated → source erased → completed;
- failure/rollback states preserve one authoritative cell and do not duplicate external effects;
- a country edit cannot silently move existing content.

### BQC-4.6 — No-fallback fault proof

Inject unavailable queue, worker, database/cache, and provider conditions in the US target. Prove jobs remain in the approved cell, age/alert visibly, and resume/reconcile there. Repeat the routing decision tests for a denied/unprovisioned Europe property.

## 6. Tests

- Resolution table for supported countries, missing country, conflicts, overrides, and locked changes.
- Property activation/import/sync denies `unresolved`.
- Wrong-cell worker rejects/quarantines a job.
- Tampered payload region cannot override current property policy.
- Queue/provider target selection matches routing configuration.
- Target outage never invokes a fallback adapter.
- Global dashboards cannot load raw property content.
- Region move crash/retry cases leave one authoritative state.

## 7. Migration and rollout

1. Expand routing/cell configuration and policy-version fields.
2. Backfill and reconcile all properties.
3. Block unresolved activation before switching queues.
4. Deploy US queues/workers/adapters in shadow with synthetic content-free jobs.
5. Switch one workload family at a time: sync, review lifecycle, inbox projection, publication, then other enabled jobs.
6. Verify wrong-cell rejection and no-fallback alerts.
7. Contract direct/global queue/provider construction.

Rollback pauses the workload in its approved cell and preserves jobs. It does not route elsewhere.

## 8. Evidence

- Approved routing ADR and data-flow map.
- Property reconciliation report with zero active unresolved properties.
- Queue/worker/provider selection report.
- Wrong-cell and tamper results.
- US cell outage/no-fallback fault report.
- Europe denied/unprovisioned test.
- Region move rehearsal with synthetic data.

## 9. Exit matrix

| Criterion                                                             | Required result |
| --------------------------------------------------------------------- | --------------- |
| Every active property has an approved resolved region                 | Pass            |
| Unresolved/ambiguous properties cannot process                        | Pass            |
| Queue, worker, data, and provider targets derive from property policy | Pass            |
| Wrong/stale/tampered region jobs fail closed                          | Pass            |
| Target outage causes no cross-region fallback                         | Pass            |
| Raw content is absent from global control/observability planes        | Pass            |
| US cell is accepted; Europe remains denied until separately proven    | Pass            |

## 10. Out of scope

- Multi-region active-active processing.
- Automatic property moves.
- Phase 17 AI provider calls; the router interface is prepared but AI remains dark.
