# ADR 0011 — Notification Context: BullMQ Event Delivery

**Status:** Accepted
**Date:** 2026-06-07
**Context:** Notification Context, Event Delivery

> **Amendment (2026-07-05, deep-review sweep):** The dedicated `notification-insert` queue specified in the original decision was never implemented — notification jobs enqueue to the shared `default` queue (see `src/composition.ts`, where `buildNotificationContext` receives `infra.jobQueue`). This amendment sanctions sharing `default` as the intended decision and adds the justification in the next subsection. The `notification-insert` references in `docs/plan/plan.md:597` are historical and superseded. This mirrors ADR 0010's identical call for activity jobs.

## Context

The notification context produces user-facing alerts about domain events (new reviews, escalations, pending approvals, etc.). Like the Activity context (ADR 0010), notifications arrive via domain event subscriptions.

Two delivery patterns exist in the codebase:

1. **In-process** (metric context) — event handlers run synchronously in the event bus. Fast but no durability guarantee.
2. **BullMQ-backed** (activity context) — handlers enqueue jobs, workers process them. At-least-once delivery, retry, dead-letter queue.

Notifications are user-facing promises. If a review is escalated and the PM isn't notified, that's a broken product expectation — not a minor statistical deviation like a lost scan count.

## Decision

**Use BullMQ for notification event delivery**, following the Activity pattern (ADR 0010).

- Emitting use cases (inbox status change, reply lifecycle, etc.) emit domain events in-process.
- Notification event handlers subscribe to those events and enqueue jobs to the shared `default` BullMQ queue (job names `insert-notification`, `urgent-email`, `digest-notification`), reusing the existing worker infrastructure rather than a dedicated queue (see amendment above and the subsection below).
- A BullMQ worker consumes jobs and inserts notification rows (one per user per channel).
- The worker provides automatic retry (3 attempts) and dead-letter queue on persistent failures.
- Idempotency enforced via composite unique on `(user_id, type, resource_id, event_id)`.

### Why the shared `default` queue (not a dedicated `notification-insert` queue)?

The original draft specified a dedicated `notification-insert` queue. In practice, notification jobs are short DB inserts (`insert-notification`) or a single email send (`urgent-email`), all bounded by BullMQ's existing concurrency and rate limiting on the shared `default` queue. A dedicated queue would require a second BullMQ worker consumer — the worker today consumes only `default` (`src/worker/index.ts`) — plus a separate Redis key space and separate concurrency tuning, for isolation benefits that do not materialize at current traffic. Activity (ADR 0010) made the identical call for the same reason. Notification jobs are distinguished by job name within the shared queue's registry; backpressure is bounded by BullMQ's shared-queue controls.

### Why not in-process?

Lost notifications are observable and user-facing. The metric context's in-process model is justified because metrics are aggregate counters. Individual notification delivery failures degrade trust.

### Job granularity

One BullMQ job per user per event (not per notification row). If an event produces notifications for 4 recipients × 2 channels = 8 rows, 4 jobs are enqueued. This gives per-user retry isolation: one user's insert failure doesn't block the other 3.

## Consequences

### Positive

- **Durability** — notifications survive process crashes, deploys, and transient Redis failures.
- **Backpressure** — rate limiting and concurrency control prevent handler storms during bulk operations.
- **Consistency** — matches Activity context's delivery pattern. No new infrastructure.

### Negative

- **Latency** — notifications are not visible until the worker processes the job (typically < 100ms).
- **Infrastructure** — worker process must run alongside the web process. Already true.

## Related

- ADR 0010 — Activity Context: BullMQ Event Delivery
- Notification context (Phase 16.1 in plan.md)
- Activity context CONTEXT.md: `src/contexts/activity/CONTEXT.md`
- BullMQ infrastructure: `src/shared/jobs/queue.ts`, `src/shared/jobs/worker.ts`
