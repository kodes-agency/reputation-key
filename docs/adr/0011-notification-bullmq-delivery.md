# ADR 0011 — Notification Context: BullMQ Event Delivery

**Status:** Accepted
**Date:** 2026-06-07
**Context:** Notification Context, Event Delivery

## Context

The notification context produces user-facing alerts about domain events (new reviews, escalations, pending approvals, etc.). Like the Activity context (ADR 0010), notifications arrive via domain event subscriptions.

Two delivery patterns exist in the codebase:

1. **In-process** (metric context) — event handlers run synchronously in the event bus. Fast but no durability guarantee.
2. **BullMQ-backed** (activity context) — handlers enqueue jobs, workers process them. At-least-once delivery, retry, dead-letter queue.

Notifications are user-facing promises. If a review is escalated and the PM isn't notified, that's a broken product expectation — not a minor statistical deviation like a lost scan count.

## Decision

**Use BullMQ for notification event delivery**, following the Activity pattern (ADR 0010).

- Emitting use cases (inbox status change, reply lifecycle, etc.) emit domain events in-process.
- Notification event handlers subscribe to those events and enqueue jobs to a `notification-insert` BullMQ queue.
- A BullMQ worker consumes jobs and inserts notification rows (one per user per channel).
- The worker provides automatic retry (3 attempts) and dead-letter queue on persistent failures.
- Idempotency enforced via composite unique on `(user_id, type, resource_id, event_id)`.

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
