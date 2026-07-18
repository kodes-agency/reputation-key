---
status: accepted
date: 2026-07-18
---

# 0048 — Property region routing

## Context

SPEC-P1-01 found that a property's processing region was metadata only: nothing resolved it authoritatively, nothing enforced it, and no production path failed closed when it was absent. Phase BQC-4 §3 requires an explicit routing decision record covering region identifiers, resolution precedence, locked transitions, the workloads that require regional execution, control-plane allowances, unavailable-target behavior, and routing-policy versioning. ADR 0031 already denied silent cross-region fallback for provider execution, and ADR 0032 denied processing in unsupported regions; this ADR turns those denials into a concrete region model for beta.

The schema already carries the state (migration 0006): `properties.country_code`, `country_source`, `processing_region` (default `'unresolved'`), `processing_region_source`, `routing_policy_version`, and `processing_region_resolved_at`, plus a backfill index over unresolved, non-deleted properties. `resolveRegion` maps US + territories to `us`, EEA + GB + CH to `europe`, and everything else to `global`; no country yields `unresolved`.

## Decision

**Region identifiers and approval state.** `us` is the only APPROVED processing cell for beta — it names all existing infrastructure (default/background/domain-events/quarantine queues, the current database, Redis, object storage, and provider endpoints). `europe` is DENIED until its infrastructure and privacy/data-flow evidence pass (ADR 0031/0032). `global` is a DENIED PLACEHOLDER, not an approved cell: a property whose country resolves to `global` cannot process. `unresolved` means no authoritative country exists and fails closed like every other non-approved state.

**Resolution precedence.** `google_address` (GBP `storefrontAddress.regionCode` — authoritative source data) takes precedence over `manual` (operator/merchant correction), which takes precedence over `organization_default` (no property-level data — always yields `unresolved`).

**Locked transitions.** A resolved region is LOCKED: cross-region country edits throw `region_locked` (existing behavior in `update-property`). Cross-region moves go through the BQC-4.5 move workflow only. Same-region country corrections remain allowed.

**Workloads requiring regional execution.** Every property-scoped protected workload: property import, review sync, reply publication, metric rollups, inbox projection, and notification/activity persistence.

**Control-plane metadata allowed outside the cell.** Identifier-only facts and content-free audit/metrics (ADR 0030) — the region, source, and policy version themselves are content-free routing facts.

**Unavailable target or provider.** Fail closed into an operator-visible blocked state (refused enqueue, exhausted-and-quarantined job, or the reconciliation report's review rows). NEVER another region (ADR 0031).

**Enforcement (BQC-4.1).** `assertRegionResolved` (property domain) admits only the `us` cell and throws `region_unresolved` otherwise. Review sync asserts it at use-case entry before any external effect; property import skips locations with no resolvable country with an explicit `region_unresolved` reason and withholds the initial-sync trigger from properties created unresolved; the `property.created` consumer skips non-processable regions as defense in depth. The `ops:reconcile-regions` command reports `resolved`/`resolvable`/`missing`/`conflict`/`ambiguous` per property and applies only `resolvable` rows; conflict and ambiguous rows always require operator review.

**Routing-policy version.** `routing_policy_version` (integer on `properties`, existing column) is bumped by every resolution change: reconciliation apply, manual correction, and (later) the move workflow.

**Evidence.** This ADR, the reconciliation report, and the resolution/enforcement tests (domain resolution table, sync/import/consumer fail-closed tests, real-PostgreSQL reconciliation tests).

## Consequences

- Import requires a resolvable country per location; a location without one is skipped explicitly, and an import with zero resolvable locations fails closed with `region_unresolved`.
- Unresolved (and `global`/`europe`) properties cannot sync or process; the failure is operator-visible rather than silently routed elsewhere.
- Ambiguity and source-data conflicts always route to operator review; reconciliation never infers a fallback.
- BQC-4.2 owns job-envelope/queue-level region enforcement; BQC-4.5 owns the region move state machine. This ADR's cell model is the decision input for both.
