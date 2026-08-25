# Metric Context

## Bounded context

Event-driven metric recording and aggregation. Subscribes to domain events from other contexts and records raw metric readings.

## Glossary

- **MetricKey** — Enum of known metric identifiers: `portal.scan`, `portal.rating`, `portal.feedback`, `portal.review_link_click`, `property.review`.
- **MetricReading** — A single raw metric data point. Has `metricKey`, `value`, `organizationId`, `propertyId`, optional `portalId`, optional `groupId`, `occurredAt`.
- **MetricPublicApi** — Application-level API for cross-context consumption. Provides the legacy `queryAggregate`, version-pinned `queryGoalMetric`, and governed correction-aware `portalAnalytics` values and availability evidence.
- **PortalMetricEvidence** — Per-family proof for a requested Portal period: immutable definition version, availability, completeness, correction head, and distinct Verified Through, Latest Activity, and Computed At timestamps.

## Relationships

- Metric context **subscribes to** `review.created`, Guest scan/rating/feedback submission and retraction facts, and `guest.review_link.clicked` events from other contexts.
- Goal context **depends on** `MetricPublicApi` for querying metric aggregates to reconcile goal progress.

## Invariants

- Only built-in metric keys are accepted. Unknown keys are rejected with `unknown_metric_key` error.
- Every metric reading emits a `metric.recorded` event.
- Monthly Goal reads pin one immutable definition-version ID, one tenant-owned Property/Portal Group/Portal subject, and a half-open property-local period. Mutable metric keys never select source rows.
- A zero count is eligible only after the 24-hour late-arrival window and exact durable proof that every relevant Guest fact has an applied/duplicate `metric.guest-analytics` receipt, the expected projection/correction, no quarantine, and correct event-time attribution. A latest-seen timestamp is not completeness proof.
- Rating averages are weighted from eligible samples and require ten ratings. Missing or undersampled averages are never converted to zero.
- `portal.qualified_scan` stays explicitly unavailable until signed Access Artifact provenance has a server-verified producer. The client-provided `qr`/`nfc`/`direct` label is not qualification evidence.
- Portal analytics reads pin immutable versions, permitted consumer/source policy, exact quality, current correction tips, and half-open event time. Distribution, KPI average, and daily trend therefore select the same effective rating population.
- Portal availability is proven independently for scans, private ratings, private feedback, and review-link selections. Unreceived projection receipts are `updating`; unresolved quarantine, obsolete source facts, or invalid governed readings are `unavailable`. A quiet period with no source facts is complete and may safely return zero.
- `Verified Through` is pipeline-completeness time, `Latest Activity` is the newest business fact in the period, and `Computed At` is the evidence calculation time. A quiet Portal can be current even when Latest Activity is absent or old.

## Events produced

- **`metric.recorded`** — readingId, organizationId, propertyId, portalId, groupId, metricKey, value, recordedAt. Emitted after every successful metric recording.

## Events consumed

- **`review.created`** — Records a `property.review` metric (value = event.rating, the star rating value).
- **`guest.scan.recorded`** — Records a `portal.scan` metric (value = 1).
- **`guest.rating.submitted`** — Records legacy `portal.rating` analytics plus independent governed `portal.rating_count` and `portal.rating_average` readings. A correction supersedes all three by source-event identity.
- **`guest.rating.retracted`** — Appends a retraction correction to all three rating readings; it never inserts a synthetic zero.
- **`guest.feedback.submitted`** — Records a `portal.feedback` metric (value = 1).
- **`guest.feedback.retracted`** — Retracts the feedback-count reading without exposing private text.
- **`guest.review_link.clicked`** — Records a `portal.review_link_click` metric (value = 1).

## Architecture layers

```
metric/
  domain/              types.ts, constructors.ts, events.ts, errors.ts
  application/
    ports/             metric.repository.ts, metric-command-store.port.ts,
                       portal-analytics.repository.ts
    use-cases/         record-metric.ts, query-goal-metric.ts,
                       query-portal-analytics.ts
    public-api.ts      re-exports query types, MetricPublicApi, event types
  infrastructure/
    metric-command-store.ts (atomic reading + outbox fact, BQC-3.5)
    repositories/      metric.repository.ts, portal-analytics.repository.ts (Drizzle)
    event-handlers/    on-review-created.ts, on-scan-recorded.ts, on-rating-submitted.ts,
                       on-feedback-submitted.ts, on-review-link-clicked.ts, index.ts
    jobs/              refresh-materialized-view.job.ts
  build.ts             composition root
```

## Use cases

- **`recordMetric`** — Validates metric key, inserts raw reading + records the `metric.recorded` fact atomically via the metric command store (BQC-3.5: one transaction, post-commit bus emit).
- **`queryPortalAnalytics`** — Validates the half-open period and exposes Metric-owned governed Portal KPI/distribution/trend reads plus per-family availability evidence to Dashboard.

## Public API

Exported from `application/public-api.ts`:

- Types: `MetricReadingsQuery`, `MetricReadingsAggregate`, `MetricPublicApi`, `PortalMetricSumRow`, `PortalRatingBucket`, `PortalRatingTrendPoint`, `PortalMetricEvidence`, `PortalMetricEvidenceSet`
- Event types: `MetricRecorded`, `MetricEvent`

## Server functions

None. Metric is an internal context with no HTTP surface. Metrics are queried through the dashboard context's server functions (`getDashboardData`, `getPortalAnalytics`).

## Permissions

None. Metric is a system-internal context with no HTTP surface and no own permissions. Metric readings are recorded exclusively by internal event handlers. Aggregated metric data is surfaced to users through the dashboard context, gated by `dashboard.read` (and `dashboard.fleet_read` for cross-property fleet views). Organization-level data scoping is enforced at the repository layer via `organizationId` filtering.

## Background jobs

- **`refresh-materialized-view.job.ts`** — Periodically refreshes metric materialized views for query performance.
