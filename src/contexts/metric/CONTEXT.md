# Metric Context

## Bounded context

Event-driven metric recording and aggregation. Subscribes to domain events from other contexts and records raw metric readings.

## Glossary

- **MetricKey** — Enum of known metric identifiers: `portal.scan`, `portal.rating`, `portal.feedback`, `portal.review_link_click`, `property.review`.
- **MetricReading** — A single raw metric data point. Has `metricKey`, `value`, `organizationId`, `propertyId`, optional `portalId`, optional `groupId`, `occurredAt`.
- **MetricPublicApi** — Application-level API for cross-context consumption. Provides `queryAggregate` for aggregated queries (sum, count, max).

## Relationships

- Metric context **subscribes to** `review.created`, `guest.scan.recorded`, `guest.rating.submitted`, `guest.feedback.submitted`, `guest.review_link.clicked` events from other contexts.
- Goal context **depends on** `MetricPublicApi` for querying metric aggregates to reconcile goal progress.

## Invariants

- Only built-in metric keys are accepted. Unknown keys are rejected with `unknown_metric_key` error.
- Every metric reading emits a `metric.recorded` event.

## Events produced

- **`metric.recorded`** — readingId, organizationId, propertyId, portalId, groupId, metricKey, value, recordedAt. Emitted after every successful metric recording.

## Events consumed

- **`review.created`** — Records a `property.review` metric (value = event.rating, the star rating value).
- **`guest.scan.recorded`** — Records a `portal.scan` metric (value = 1).
- **`guest.rating.submitted`** — Records a `portal.rating` metric (value = rating value).
- **`guest.feedback.submitted`** — Records a `portal.feedback` metric (value = 1).
- **`guest.review_link.clicked`** — Records a `portal.review_link_click` metric (value = 1).

## Architecture layers

```
metric/
  domain/              types.ts, constructors.ts, events.ts, errors.ts
  application/
    ports/             metric.repository.ts, metric-command-store.port.ts
    use-cases/         record-metric.ts
    public-api.ts      re-exports query types, MetricPublicApi, event types
  infrastructure/
    metric-command-store.ts (atomic reading + outbox fact, BQC-3.5)
    repositories/      metric.repository.ts (Drizzle)
    event-handlers/    on-review-created.ts, on-scan-recorded.ts, on-rating-submitted.ts,
                       on-feedback-submitted.ts, on-review-link-clicked.ts, index.ts
    jobs/              refresh-materialized-view.job.ts
  build.ts             composition root
```

## Use cases

- **`recordMetric`** — Validates metric key, inserts raw reading + records the `metric.recorded` fact atomically via the metric command store (BQC-3.5: one transaction, post-commit bus emit).

## Public API

Exported from `application/public-api.ts`:

- Types: `MetricReadingsQuery`, `MetricReadingsAggregate`, `MetricPublicApi`
- Event types: `MetricRecorded`, `MetricEvent`

## Server functions

None. Metric is an internal context with no HTTP surface. Metrics are queried through the dashboard context's server functions (`getDashboardData`, `getPortalAnalytics`).

## Permissions

None. Metric is a system-internal context with no HTTP surface and no own permissions. Metric readings are recorded exclusively by internal event handlers. Aggregated metric data is surfaced to users through the dashboard context, gated by `dashboard.read` (and `dashboard.fleet_read` for cross-property fleet views). Organization-level data scoping is enforced at the repository layer via `organizationId` filtering.

## Background jobs

- **`refresh-materialized-view.job.ts`** — Periodically refreshes metric materialized views for query performance.
