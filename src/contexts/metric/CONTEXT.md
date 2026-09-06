# Metric Context

## Bounded context

Durable outbox projection and aggregation. Consumes domain facts from other contexts and records raw metric readings.

## Glossary

- **MetricKey** — Enum of known metric identifiers including governed `portal.qualified_scan`, legacy Portal analytics, and Property review measures.
- **MetricReading** — A single raw metric data point. Has `metricKey`, `value`, `organizationId`, `propertyId`, optional `portalId`, optional `groupId`, `occurredAt`.
- **MetricPublicApi** — Application-level API for cross-context consumption. Provides the legacy `queryAggregate`, version-pinned `queryGoalMetric`, governed correction-aware `portalAnalytics`, the separate `getCurrentOnGoogle` state read, and exact correction-impact facts used by Goal without cross-context repository reads.
- **PortalMetricEvidence** — Per-family proof for a requested Portal period: immutable definition version, availability, completeness, correction head, and distinct Verified Through, Latest Activity, and Computed At timestamps.
- **Portal Lifetime Aggregate** — Anonymous per-Portal All-Time counts, private-rating sum/star distribution, and Google/secondary selection counts. It contains no response/session/source/contact identity or exact activity time; a sealed baseline lets it survive governed source-fact expiry. Reads also identify the immutable governed versions represented by the combined projection and expose rebuild/seal metadata to Dashboard.
- **Current on Google** — The latest fully verified Google provider count and provider average for the Property's current source epoch. It is a point-in-time state snapshot with a verification time, not a private Portal rating, bounded-period measure, lifetime aggregate, or `metric_readings` row.

## Relationships

- Metric context consumes `review.created`, Guest diagnostic/Qualified Scan, rating/feedback submission and retraction facts, and `guest.review_link.clicked` through durable outbox consumers.
- Metric context **subscribes to** `review.google_reputation_snapshot.verified` through the distinct durable `metric.current-google-reputation` consumer. Review owns verification and its append-only source fact; Metric owns only the current state projection and read semantics.
- Goal context **depends on** `MetricPublicApi` for querying governed monthly
  evidence and for resolving the exact original/replacement reading facts
  affected by `metric.corrected`. Metric never queries Goal storage.

## Cross-context read authority

`src/shared/governance/metric-read-authority.ts` is the executable inventory for
every production `metric_readings` read outside this context. Its architecture
test discovers table reads from source and fails when a new reader has no
reviewed authority row.

- Active Goal Programs use `MetricPublicApi.queryGoalMetric` and the exact
  correction-impact lookup; the retained `queryAggregate` Goal job is not
  registered in the beta runtime.
- Dashboard Portal analytics and All Time reads use the Metric public API.
  Dashboard retains exactly two named optimized projections: the legacy KPI
  projection and the constant-query Fleet projection. Both pin immutable
  versions, registry consumer/source policy, append-only correction tips, and
  explicit availability evidence or signals.
- Identity's people-authority reconciliation is an audit-only read. It emits
  content-free exact/conflict/orphan outcomes and never serves a product metric.
- Badge, the superseded Leaderboard repository, and Recognition readers are
  explicitly legacy-dark. Their raw formulas are not trusted as governed
  contracts and cannot be treated as beta-available data.

## Invariants

- Only built-in metric keys are accepted. Unknown keys are rejected with `unknown_metric_key` error.
- Every metric reading records a `metric.recorded` outbox fact in the same transaction.
- Monthly Goal reads pin one immutable definition-version ID, one tenant-owned Property/Portal Group/Portal subject, and a half-open property-local period. Mutable metric keys never select source rows.
- A zero count is eligible only after the 24-hour late-arrival window and exact durable proof that every relevant Guest fact has an applied/duplicate `metric.guest-analytics` receipt, the expected projection/correction, no quarantine, and correct event-time attribution. A latest-seen timestamp is not completeness proof.
- Rating averages are weighted from eligible samples and require ten ratings. Missing or undersampled averages are never converted to zero.
- `portal.qualified_scan` is sourced only from `guest.qualified_scan.recorded`, never the legacy client-channel scan fact. Its governed definition accepts only `first_party_guest_gateway_metric`, and its event-time Portal Group ID is producer-captured provenance that replay must not recompute from current membership.
- Qualified Scan delivery is source-event idempotent. `guest.qualified_scan.retracted` adds one correction against the original reading; it never inserts a zero. Replaying either fact converges on the same effective contribution.
- Guest metric readings and their correction facts retain the same event-time
  Primary Staff attribution snapshot. Duplicate, replacement, and retraction
  commands fail closed when that provenance changes, so supporting Staff
  relationships cannot multiply Portal/Property totals.
- A replacement that arrives before its superseded reading remains retryable on
  the durable path rather than accepting a stranded quarantine.
- The Goal correction-impact lookup is identifier-only and exact-scoped: every
  returned reading must match the event Organization, Property, immutable
  definition version, and requested reading ID. It returns the reading's
  event-time Portal/Portal Group attribution and business timestamp; missing or
  drifted facts fail closed.
- Portal analytics reads pin immutable versions, permitted consumer/source policy, exact quality, current correction tips, and half-open event time. Distribution, KPI average, and daily trend therefore select the same effective rating population.
- Portal availability is proven independently for scans, private ratings, private feedback, and review-link selections. Unreceived projection receipts are `updating`; unresolved quarantine, obsolete source facts, or invalid governed readings are `unavailable`. A quiet period with no source facts is complete and may safely return zero.
- `Verified Through` is pipeline-completeness time, `Latest Activity` is the newest business fact in the period, and `Computed At` is the evidence calculation time. A quiet Portal can be current even when Latest Activity is absent or old.
- Public Reputation (`property.review`, Google review count/average) is never a
  private Portal rating. The lifetime aggregate accepts only qualified scans,
  private `portal.rating`, private feedback, and destination-classified Portal
  link selections; it explicitly rejects Google public-reputation readings and
  the count/average Goal fanout.
- Current on Google never derives from `property.review` readings. Its consumer accepts only Review's schema-validated verified-snapshot event, reserves a durable receipt, and applies the projection atomically. Replays converge, older versions become obsolete, equal-time conflicting versions fail closed, and a future source epoch retries instead of being accepted.
- A Property source rebind immediately makes an older current snapshot unreadable. `getCurrentOnGoogle` returns `null` until a verified snapshot for the Property's exact current source epoch is projected. A valid zero-review provider state is count `0` plus average `null`; positive counts retain the provider's finite `0..5` average without recomputing it.
- Each eligible reading/correction/retraction updates the anonymous lifetime row
  in the same transaction as Metric state and outbox. Rebuild is
  `sealed anonymous baseline + retained effective correction tips`. Retention
  must commit `sealThrough(Property-local exclusive cutoff)` before purging the
  corresponding source facts; corrections before that cutoff update both live
  and sealed totals.

## Events produced

| Tag                | Payload                                                                                                       | When recorded                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `metric.recorded`  | eventId, reading/scope IDs, definition version, source event, value/provenance, staff attribution, occurredAt | A successful Metric transaction commits a governed reading and its identifier/provenance-only fact |
| `metric.corrected` | eventId, corrected/replacement reading IDs, exact scope, staff attribution, occurredAt                        | A correction or retraction commits against an existing governed reading                            |

`metric.recorded` is the canonical outbox fact. REC-01 removed its unreachable
Badge and Leaderboard subscribers; Goal Programs read governed Metric state and
do not consume this fact.

## Events consumed

- **`review.created`** — Reloads the eligible rating through Review's owner-authorized port and records a version-pinned `property.review` Public Reputation reading. Durable replays converge on `(definition version, source event)`; expired content is obsolete, while persistence or definition-policy failures retry or fail visibly instead of being acknowledged.
- **`review.google_reputation_snapshot.verified`** — Upserts the separate Current on Google state only when Review has completed both provider scans and its bounded reconciliation. The consumer fences Organization, Property, source epoch, source run, source event, and verification time; it never inserts a bounded-period reading.
- **`guest.scan.recorded`** — Records a `portal.scan` metric (value = 1).
- **`guest.qualified_scan.recorded`** — Records one governed `portal.qualified_scan` reading with the producer-captured event-time Portal Group.
- **`guest.qualified_scan.retracted`** — Appends a retraction against the original Qualified Scan reading.
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
                       portal-analytics.repository.ts,
                       portal-lifetime-aggregate.port.ts,
                       current-google-reputation-snapshot.port.ts,
                       goal-metric-correction-impact.lookup.ts
    use-cases/         record-metric.ts, query-goal-metric.ts,
                       query-portal-analytics.ts
    public-api.ts      re-exports query types, MetricPublicApi, event types
  infrastructure/
    metric-command-store.ts (atomic reading + outbox fact, BQC-3.5)
    repositories/      metric.repository.ts, portal-analytics.repository.ts,
                       portal-lifetime-aggregate.repository.ts,
                       current-google-reputation-snapshot.repository.ts,
                       goal-metric-correction-impact.lookup.ts (Drizzle)
    portal-lifetime-aggregate-store.ts (atomic incremental projection)
    outbox-consumers.ts (durable Portal workflow projections)
    guest-outbox-consumers.ts (durable Guest analytics projections)
    record-portal-metric.ts (Guest fact-to-reading projection factories)
    public-reputation-outbox-consumers.ts (durable Google-review projection)
    current-google-reputation-outbox-consumers.ts (durable current provider state)
  build.ts             composition root
```

## Use cases

- **`recordMetric`** — Validates the metric key and commits the raw reading with its `metric.recorded` outbox fact in one transaction.
- **`queryGoalMetric`** — Returns correction-aware, definition-pinned Qualified Scan/rating Goal evidence only after durable source completeness and the month-end reconciliation delay.
- **`queryPortalAnalytics`** — Validates the half-open period and exposes Metric-owned governed Portal KPI/distribution/trend reads plus per-family availability evidence to Dashboard.
- **`portalLifetime.get/inspect/rebuild/sealThrough`** — Reads, performs a write-free parity inspection, parity-rebuilds, and advances the anonymous All-Time retention checkpoint under a per-Portal transaction lock. Dashboard consumes `get` for All Time; serving never invokes the mutating reconciliation methods or manufactures a time series from totals. Operators use `ops:rebuild-metric-projection` in report mode first, then apply only to the exact Organization/Property/Portal scope.
- **`findGoalMetricCorrectionImpacts`** — Resolves only the exact, tenant-bound
  original/replacement reading facts needed by Goal's correction command.
- **`getCurrentOnGoogle`** — Reads one tenant- and Property-scoped current provider snapshot only while its source epoch still matches Property authority. It returns literal `current_on_google` semantics and `verifiedAt`; it does not accept a reporting period or synthesize missing state as zero. No manager-facing screen consumes this seam yet.

## Public API

Exported from `application/public-api.ts`:

- Types: `MetricReadingsQuery`, `MetricReadingsAggregate`, `MetricPublicApi`, `PortalMetricSumRow`, `PortalRatingBucket`, `PortalRatingTrendPoint`, `PortalMetricEvidence`, `PortalMetricEvidenceSet`, `GoalMetricCorrectionImpact`
- Portal lifetime read seam: `PortalLifetimeAggregatePort`, `PortalLifetimeReadApi`
- Governed goal metric contracts: `GovernedGoalMetricQuery`, `GovernedGoalMetricResult`, `FindGoalMetricCorrectionImpactsInput`
- Metric definition registry: `METRIC_VERSION_IDS`, `GovernedMetricVersion`
- Event types: `MetricRecorded` and the `MetricEvent` union. The correction variant is reachable only through that union: no consumer may name it directly, because a context that handles corrections in isolation is recomputing an aggregate Metric owns.

## Server functions

None. Metric is an internal context with no HTTP surface. Metrics are queried through the dashboard context's server functions (`getDashboardData`, `getPortalAnalytics`).

## Permissions

None. Metric is a system-internal context with no HTTP surface and no own permissions. Metric readings are recorded exclusively by durable outbox consumers. Aggregated metric data is surfaced to users through the dashboard context, gated by `dashboard.read` (and `dashboard.fleet_read` for cross-property fleet views). Organization-level data scoping is enforced at the repository layer via `organizationId` filtering.

## Background jobs

None. Metric serving and projection maintenance run through durable event
consumers and explicit use cases rather than scheduled jobs.
