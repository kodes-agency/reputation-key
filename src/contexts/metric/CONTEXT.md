# Metric Context

Event-driven metric recording and aggregation. Subscribes to domain events from other contexts and records raw metric readings.

## Glossary

- **MetricKey** — Enum of known metric identifiers: `portal.scan`, `portal.rating`, `portal.feedback`, `portal.review_link_click`, `property.review`.
- **MetricReading** — A single raw metric data point. Has `metricKey`, `value`, `organizationId`, `propertyId`, optional `portalId`, optional `staffId`, `recordedAt`.
- **MetricPublicApi** — Application-level API for cross-context consumption. Provides `queryAggregate` for aggregated queries (sum, count, max).

## Relationships

- Metric context **subscribes to** `review.created`, `scan.recorded`, `rating.submitted`, `feedback.submitted`, `review-link.clicked` events from other contexts.
- Goal context **depends on** `MetricPublicApi` for querying metric aggregates to reconcile goal progress.

## Invariants

- Only built-in metric keys are accepted. Unknown keys are rejected with `unknown_metric_key` error.
- Every metric reading emits a `metric.recorded` event.

## Events produced

- **`metric.recorded`** — readingId, organizationId, propertyId, portalId, staffId, metricKey, value, recordedAt. Emitted after every successful metric recording.

## Events consumed

- **`review.created`** — Records a `property.review` metric (value = 1).
- **`scan.recorded`** — Records a `portal.scan` metric (value = 1).
- **`rating.submitted`** — Records a `portal.rating` metric (value = rating value).
- **`feedback.submitted`** — Records a `portal.feedback` metric (value = 1).
- **`review-link.clicked`** — Records a `portal.review_link_click` metric (value = 1).

## Architecture layers

```
metric/
  domain/              types.ts, constructors.ts, events.ts, errors.ts
  application/
    ports/             metric.repository.ts
    use-cases/         record-metric.ts
    public-api.ts      re-exports query types, MetricPublicApi, event types/constructors
  infrastructure/
    repositories/      metric.repository.ts (Drizzle)
    event-handlers/    on-review-created.ts, on-scan-recorded.ts, on-rating-submitted.ts,
                       on-feedback-submitted.ts, on-review-link-clicked.ts, index.ts
    jobs/              refresh-materialized-view.job.ts
  build.ts             composition root
```

## Use cases

- **`recordMetric`** — Validates metric key, inserts raw reading, emits `metric.recorded` event.

## Public API

Exported from `application/public-api.ts`:

- Types: `MetricReadingsQuery`, `MetricReadingsAggregate`, `MetricPublicApi`
- Event types: `MetricRecorded`, `MetricEvent`
- Event constructors: `metricRecorded`

## Background jobs

- **refresh-materialized-view** — Refreshes pre-aggregated metric materialized views (daily, weekly, daily-inbox). Scheduled via `JOB_NAMES` constants.
