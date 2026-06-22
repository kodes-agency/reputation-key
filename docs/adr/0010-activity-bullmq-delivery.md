# ADR 0010 — Activity Context: BullMQ Event Delivery

**Status:** Accepted
**Date:** 2026-06-02
**Context:** Activity Context, Event Delivery

## Context

The activity context records an immutable audit log of user actions. The original design (Q12, session `20260601_173316_58f765`) chose **in-process event delivery** via `eventBus.on()`, matching the metric context's subscriber pattern. The rationale: simpler deployment, no BullMQ infrastructure needed, event bus already catches handler errors.

During implementation review (2026-06-02 grill-with-docs), the decision was challenged. The codebase already has mature BullMQ infrastructure (`shared/jobs/queue.ts`, `shared/jobs/worker.ts`, job registry, worker process), used by review sync, reply publishing, and purge jobs. The metric context's in-process pattern was built before BullMQ adoption.

Activity logging is fundamentally different from metric recording: it's an **audit trail**. Lost entries are permanent gaps in the historical record. Metrics are counters — losing a scan count is a minor statistical deviation, not a compliance or UX issue.

## Decision

**Reverse Q12. Use BullMQ for activity event delivery.**

- Emitting use cases (inbox status change, reply lifecycle, etc.) continue to emit domain events in-process.
- Activity event handlers subscribe to those events and enqueue jobs to the shared `default` BullMQ queue (job name `insert-activity-log`), reusing the existing worker infrastructure rather than a dedicated queue.
- A BullMQ worker consumes jobs and calls the `insertActivityLog` use case.
- The worker provides automatic retry (3 attempts) and dead-letter queue on persistent failures.
- Idempotency is enforced by a DB-level unique constraint on `(eventId, organizationId)` (`activity_log_event_id_org_uniq`), backed by a `findDuplicate(eventId, organizationId)` pre-check for a fast path — BullMQ delivers at-least-once.

### Why the shared `default` queue (not a dedicated `activity-log` queue)?

The original draft specified a dedicated `activity-log` queue. In practice, activity jobs are lightweight single-row inserts with no external I/O (no email, no API calls). The shared `default` queue already serves review sync, reply publishing, and purge jobs. A dedicated queue would add operational overhead (separate Redis key space, separate concurrency tuning, separate dashboard panel) for no benefit. Activity's backpressure is bounded by BullMQ's existing concurrency controls on the shared queue. The job name `insert-activity-log` distinguishes it within the registry.

### Why not BullMQ everywhere?

The metric context remains in-process. Metrics are aggregate counters — losing a handful of scans or ratings has no user-visible impact. The operational simplicity of in-process delivery is justified. Activity entries are individually meaningful and their loss is observable.

## Consequences

### Positive

- **Durability** — Activity entries survive process crashes, deploys, and transient Redis failures. The audit trail is as durable as the database.
- **Backpressure** — BullMQ's rate limiting and concurrency control prevent handler storms during bulk operations (e.g., 500 bulk status changes).
- **Observability** — Failed jobs appear in the BullMQ dashboard. Dead-letter queue allows manual inspection and replay.
- **Consistency** — The pattern matches how review sync and reply publishing already work. No new infrastructure.

### Negative

- **Latency** — Activity entries are not visible in the timeline until the worker processes the job (typically < 100ms, but not synchronous).
- **More infrastructure dependencies** — The worker process must run alongside the web process. Already true for existing jobs.

### Risks

- If Redis goes down, events accumulate in BullMQ and replay on recovery. No events are lost — just delayed.
- The worker process must have access to the same database and identity port as the web process. Already true for existing workers.

## Related

- Activity context CONTEXT.md: `src/contexts/activity/CONTEXT.md`
- Codebase standards: `docs/standards.md` (event envelope, per-tag handlers, build function shape)
- Original Q12 decision: session `20260601_173316_58f765`
- Metric context CONTEXT.md: `src/contexts/metric/CONTEXT.md`
- Event bus: `src/shared/events/event-bus.ts`
- BullMQ infrastructure: `src/shared/jobs/queue.ts`, `src/shared/jobs/worker.ts`
