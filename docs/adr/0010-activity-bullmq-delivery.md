# ADR 0010 — Activity Context: BullMQ Event Delivery

**Status:** Partially superseded by [ADR 0056](0056-operational-action-history-integrity-claims.md)
**Date:** 2026-06-02
**Context:** Activity Context, Event Delivery

The BullMQ delivery decision remains accepted. References below to an
immutable audit log or audit trail are historical rationale, not current
product or integrity claims. The current model is the rebuildable **Recent
Activity** projection defined by ADR 0056 and the Activity context contract.

**2026-09-07 (WP3.1):** the in-process EventBus and every bus handler are deleted.
The `activity.recent-activity` outbox consumer is the only delivery path; the
BullMQ accelerator described below no longer exists.

**2026-08-28 recovery amendment:** the EventBus-to-`project-recent-activity` BullMQ
path is retained only as a low-latency accelerator. Source-context transactional
outbox facts consumed by `activity.recent-activity` are the recovery authority.
That consumer atomically commits the projection, shared delivery receipt, and
Activity-owned content-free replay fact. The replay authority follows the
90-day feed lifetime and is independent of the shared outbox's shorter
retention. Redis/BullMQ alone is never described as loss-proof.

**2026-08-28 identifier amendment:** migration 0160 renames the physical
authority in place to `recent_activity_entries`. A simple, automatically
updatable `activity_log` view is retained temporarily so an older binary can be
rolled back without copying or losing rows. Current producers enqueue only
`project-recent-activity`; the worker also registers `insert-activity-log`
solely to drain jobs queued before cutover. Removing either compatibility seam
requires the zero-dependency evidence in the identifier-cutover runbook.

## Context

The original design described an immutable audit log of user actions. That
description is superseded: the current product is a rebuildable Recent Activity
convenience feed. The original delivery decision (Q12, session
`20260601_173316_58f765`) chose **in-process event delivery** via
`eventBus.on()`, matching the metric context's subscriber pattern.

During implementation review (2026-06-02 grill-with-docs), the decision was challenged. The codebase already has mature BullMQ infrastructure (`shared/jobs/queue.ts`, `shared/jobs/worker.ts`, job registry, worker process), used by review sync, reply publishing, and purge jobs. The metric context's in-process pattern was built before BullMQ adoption.

Recent Activity entries are individually user-visible, so missing projections
are observable even though they are neither audit evidence nor authorization
truth. Metrics are separate aggregate authorities.

## Decision

**Reverse Q12. Use BullMQ for activity event delivery.**

- Emitting use cases (inbox status change, reply lifecycle, etc.) continue to emit domain events in-process.
- Activity event handlers subscribe to those events and enqueue jobs to the shared `default` BullMQ queue (job name `project-recent-activity`), reusing the existing worker infrastructure rather than a dedicated queue.
- A BullMQ worker consumes jobs and calls the `projectRecentActivity` use case.
- The worker provides automatic retry (3 attempts) and dead-letter queue on persistent failures.
- Idempotency is enforced by a DB-level unique constraint on `(eventId, organizationId)` (`recent_activity_entries_event_id_org_uniq`), backed by a `findDuplicate(eventId, organizationId)` pre-check for a fast path — BullMQ delivers at-least-once.

### Why the shared `default` queue (not a dedicated `activity-log` queue)?

The original draft specified a dedicated `activity-log` queue. In practice, activity jobs are lightweight single-row inserts with no external I/O (no email, no API calls). The shared `default` queue already serves review sync, reply publishing, and purge jobs. A dedicated queue would add operational overhead (separate Redis key space, separate concurrency tuning, separate dashboard panel) for no benefit. Activity's backpressure is bounded by BullMQ's existing concurrency controls on the shared queue. The job name `project-recent-activity` distinguishes it within the registry.

### Why not BullMQ everywhere?

The metric context remains in-process. Metrics are aggregate counters — losing a handful of scans or ratings has no user-visible impact. The operational simplicity of in-process delivery is justified. Activity entries are individually meaningful and their loss is observable.

## Consequences

### Positive

- **Durability** — retained source facts allow missing Recent Activity projections to be rebuilt after process crashes or deploys.
- **Backpressure** — BullMQ's rate limiting and concurrency control prevent handler storms during bulk operations (e.g., 500 bulk status changes).
- **Observability** — Failed jobs appear in the BullMQ dashboard. Dead-letter queue allows manual inspection and replay.
- **Consistency** — The pattern matches how review sync and reply publishing already work. No new infrastructure.

### Negative

- **Latency** — Activity entries are not visible in the timeline until the worker processes the job (typically < 100ms, but not synchronous).
- **More infrastructure dependencies** — The worker process must run alongside the web process. Already true for existing jobs.

### Risks

- If Redis goes down, the durable outbox/replay authority remains the recovery path; BullMQ acceleration may be delayed.
- The worker process must have access to the same database and identity port as the web process. Already true for existing workers.

## Related

- Activity context CONTEXT.md: `src/contexts/activity/CONTEXT.md`
- Codebase standards: `docs/standards.md` (event envelope, per-tag handlers, build function shape)
- Original Q12 decision: session `20260601_173316_58f765`
- Metric context CONTEXT.md: `src/contexts/metric/CONTEXT.md`
- Outbox consumers: `src/contexts/activity/infrastructure/outbox-consumers.ts`
- BullMQ infrastructure: `src/shared/jobs/queue.ts`, `src/shared/jobs/worker.ts`
