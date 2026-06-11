# Metric Context — Infrastructure & Server Review

**Date:** 2026-06-10  
**Scope:** `src/contexts/metric/infrastructure/`, `src/contexts/metric/server/` (does not exist — correct per CONTEXT.md)  
**Dimensions:** D5, D7, D8, D12, D15

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 1     |
| MAJOR    | 5     |
| MINOR    | 4     |
| NIT      | 2     |

---

## Findings

### [D15] MAJOR `throw new Error` in infrastructure adapter — should use domain error or structured infra error

File: src/contexts/metric/infrastructure/repositories/metric.repository.ts:35
Quote: ```ts
    throw new Error(`Invalid metric_key in DB row: ${row.metricKey}`)

````
Rule:  D15 — "No throw new Error in domain/application". While this is infrastructure, bare `Error` lacks context for observability. The codebase uses tagged errors (`MetricError`) for domain failures; infrastructure should use a structured infra error or at minimum wrap in a typed error.
Fix:   Define an `InfrastructureError` tagged type (or reuse a shared one) so callers and error handlers can distinguish infra failures from domain failures.

### [D15] MAJOR `throw new Error` on insert failure — bare string, unstructured
File: src/contexts/metric/infrastructure/repositories/metric.repository.ts:70
Quote: ```ts
  throw new Error('Metric reading insert failed — no row returned')
````

Rule: D15 — consistent error envelope. A bare `Error` with no code or context makes this impossible to handle programmatically at the boundary.
Fix: Use a structured error (e.g. `{ _tag: 'InfrastructureError', code: 'insert_failed', message: ... }`).

### [D15] MAJOR `throw new Error` on invalid DB row reconstruction

File: src/contexts/metric/infrastructure/repositories/metric.repository.ts:48
Quote: ```ts
    throw new Error(`Invalid metric reading from DB: ${result.error.message}`)

````
Rule:  D15 — same as above. The `readingFromRow` function has 3 `throw new Error` sites, all unstructured.
Fix:   Consolidate into a single structured error type for DB-to-domain mapping failures.

### [D15] MAJOR Event handlers silently swallow all errors — violates "no bare catch"
File: src/contexts/metric/infrastructure/event-handlers/on-review-created.ts:22-27
Quote: ```ts
  } catch (err) {
    getLogger().error(
      { err, event: event._tag, propertyId: event.propertyId },
      'metric: failed to record property.review',
    )
  }
````

Rule: D15 — "No bare catch." The error is logged but silently swallowed. All 5 event handlers (`on-review-created`, `on-scan-recorded`, `on-rating-submitted`, `on-feedback-submitted`, `on-review-link-clicked`) share this pattern. If the metric recording fails, there is no retry, no dead-letter queue, and no indication to upstream that data was lost.
Fix: Either re-throw (let the event bus handle retry/DLQ), or at minimum return a typed failure that the event bus infrastructure can route to a dead-letter mechanism. Logging alone is insufficient for data-correctness guarantees.

### [D5] MINOR Fake repository in test file does not implement `queryAggregate`

File: src/contexts/metric/infrastructure/repositories/metric.repository.test.ts:17-39
Quote: ```ts
const createFakeMetricRepository = () => {
...
repo: {
insertReading: async (input: InsertInput) => { ... },
findByOrganizationId: async (...) => { ... },
},
}

````
Rule:  D5 — The fake implements `insertReading` and `findByOrganizationId` but omits `queryAggregate`. This means the test fake drifts from the `MetricRepository` port interface. If someone adds a `queryAggregate` test, the fake will need to be updated, but the TypeScript compiler won't catch the mismatch because the fake isn't typed against the port.
Fix:   Type the fake explicitly as `MetricRepository` or add a `queryAggregate` stub.

### [D7] BLOCKER `queryAggregate` does not enforce organizationId is present in WHERE clause when conditions are built dynamically
File: src/contexts/metric/infrastructure/repositories/metric.repository.ts:99-103
Quote: ```ts
    const conditions = [
      eq(metricReadings.organizationId, unbrand(query.organizationId)),
      eq(metricReadings.propertyId, unbrand(query.propertyId)),
      eq(metricReadings.metricKey, query.metricKey),
    ]
````

Rule: D7 — "Every DB query on tenant-owned table has organizationId." The current code DOES include `organizationId` in the WHERE clause. However, the type `MetricReadingsQuery` makes `organizationId` required (not optional), so this is structurally safe. **On closer inspection this is correct — no actual leak. Downgrading.**

UPDATE: After re-examination, all three repository methods (`insertReading`, `findByOrganizationId`, `queryAggregate`) correctly include `organizationId`. The `insertReading` inserts it from the reading. `findByOrganizationId` filters by it. `queryAggregate` requires it in the query type. **No BLOCKER found.** Downgrading this to a note.

### [D7] MAJOR Materialized view refresh job has no organizationId scoping

File: src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts:16-22
Quote: ```ts
  const REFRESH_QUERIES: Readonly<Record<string, SQL>> = {
    dailyMetrics: sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_metrics`,
    weeklyMetrics: sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_weekly_metrics`,
    dailyInboxMetrics: sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_inbox_metrics`,
}

````
Rule:  D7 — The MV refresh operates globally across all tenants. If the materialized views contain per-org data, a refresh without org scoping is correct (MV refreshes recompute the entire view atomically). This is expected for MV refresh jobs. **Not a violation** — MV refreshes are inherently cross-tenant operations that rebuild the full view.

UPDATE: Actually this is correct behavior for MVs. Removing from findings count.

### [D12] MAJOR CONTEXT.md claims `review.created` records value=1, but code uses `event.rating`
File: src/contexts/metric/CONTEXT.md:29
Quote: ```
- **`review.created`** — Records a `property.review` metric (value = 1).
````

Actual code (`infrastructure/event-handlers/on-review-created.ts:19`):

```ts
value: event.rating,
```

Rule: D12 — CONTEXT.md accuracy. The documentation says the value is always 1, but the handler actually passes the star rating value from the event (e.g., 1–5). This is a documentation mismatch.
Fix: Update CONTEXT.md to: `Records a property.review metric (value = event.rating, the star rating).`

### [D12] MINOR CONTEXT.md does not mention `findByOrganizationId` in the repository port

File: src/contexts/metric/CONTEXT.md:41
Quote: ```
application/
ports/ metric.repository.ts

````
Rule:  D12 — CONTEXT.md lists the architecture layers and files but doesn't describe the repository port methods. The port has 3 methods (`insertReading`, `findByOrganizationId`, `queryAggregate`) but CONTEXT.md only describes `queryAggregate` under Public API. `findByOrganizationId` is undocumented.
Fix:   Add a Repository section to CONTEXT.md listing the three port methods.

### [D5] MINOR Duplicate VALID_METRIC_KEYS in repository and constructors
File: src/contexts/metric/infrastructure/repositories/metric.repository.ts:25-31
Quote: ```ts
const VALID_METRIC_KEYS: Set<string> = new Set([
  'portal.scan',
  'portal.rating',
  ...
])
````

Rule: D5 / architecture — The same set is defined in `domain/constructors.ts:16-22` and `application/use-cases/record-metric.ts:20` (which imports from `shared/domain/metric-keys`). The infrastructure repository duplicates it instead of importing the shared `METRIC_KEYS`. While the repository only uses it for `readingFromRow` (a safety guard for DB corruption), the values should come from the single source of truth.
Fix: Import `METRIC_KEYS` from `#/shared/domain/metric-keys` in the repository and build the set from it.

### [D5] MINOR Repository test file imports domain constructors for fake — layer-aware but untyped

File: src/contexts/metric/infrastructure/repositories/metric.repository.test.ts:1-39
Quote: ```ts
import { ... metricReadingId, type OrganizationId } from '#/shared/domain/ids'
...
const createFakeMetricRepository = () => {
const readings: MetricReading[] = []
...
}

````
Rule:  D5 — The test creates a fake repository that isn't typed against `MetricRepository`, so if the port interface changes, the test fake silently drifts.
Fix:   Add `satisfies MetricRepository` to the fake or type it explicitly.

### [D8] N/A — No server functions (correct per CONTEXT.md)
CONTEXT.md states "None. Metric is an internal context with no HTTP surface." Confirmed: no `server/` directory exists. This is correct.

### [D12] MINOR CONTEXT.md mentions `recordedAt` but domain type uses `occurredAt`
File: src/contexts/metric/CONTEXT.md:10
Quote: ```
- **MetricReading** — A single raw metric data point. Has `metricKey`, `value`, `organizationId`, `propertyId`, optional `portalId`, optional `groupId`, `recordedAt`.
````

Actual domain type (`domain/types.ts:17-26`):

```ts
export type MetricReading = Readonly<{
  ...
  occurredAt: Date
}>
```

Rule: D12 — Field name mismatch. The type uses `occurredAt`, not `recordedAt`.
Fix: Update CONTEXT.md glossary to say `occurredAt` instead of `recordedAt`.

### [D12] NIT CONTEXT.md says events have `correlationId` in envelope but constructor hardcodes it to null

File: src/contexts/metric/domain/events.ts:34
Quote: ```ts
correlationId: null,

````
Rule:  D12 — The event envelope specification (D2) requires `correlationId`. The constructor accepts it in the type but hardcodes `null` instead of propagating it from upstream events. This means metric events are never correlated to the originating event chain.
Fix:   Accept an optional `correlationId` in the constructor args and propagate from the incoming event in the event handlers.

### [D1] NIT Event handlers import `RecordMetricInput` from application use-case layer
File: src/contexts/metric/infrastructure/event-handlers/on-review-created.ts:3
Quote: ```ts
import type { RecordMetricInput } from '../../application/use-cases/record-metric'
````

Rule: D1 — Infrastructure is allowed to import from application, so this is not a layer violation. However, importing a use-case input type couples the handler to the use-case's input shape. An alternative would be to have the handler call the use-case function directly rather than through a deps record. This is a design note, not a violation.

## Revised Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 4     |
| MINOR    | 5     |
| NIT      | 1     |

**Total findings: 10**

### Key Takeaways

1. **Error handling (D15)** — 3 `throw new Error` sites in the repository + 5 event handlers that silently swallow errors. This is the highest-priority concern. Metrics data could be silently lost without any recovery path.
2. **CONTEXT.md accuracy (D12)** — Two factual errors: `review.created` value description (says 1, actually `event.rating`), and field name (`recordedAt` vs `occurredAt`). Plus missing `findByOrganizationId` documentation.
3. **Deduplicated constants** — `VALID_METRIC_KEYS` is defined in 3 places. Should consolidate on `shared/domain/metric-keys`.
4. **Multi-tenancy (D7)** — Clean. All repository methods enforce `organizationId` filtering. No leaks found.
5. **No server layer** — Correct per architecture. No D8 violations possible.
