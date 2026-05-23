# Review #2: Bounded Context Boundaries

**Date:** 2026-05-23
**Reviewer:** Automated (Hermes cron)
**Scope:** Cross-context coupling across all 12 bounded contexts

---

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 3     |
| MAJOR    | 4     |
| MINOR    | 3     |
| NIT      | 0     |

Three contexts (Dashboard, Inbox, Integration) directly query other contexts' DB tables. Two contexts (Goal, Guest) take another context's repository instead of its application service. Event types are imported from `domain/events` in 17 places instead of `application/public-api`.

No entity-ownership violations, no leaked secrets, no scattered permissions. The architecture is broadly sound — the violations are concentrated in read-aggregation layers and wiring.

---

## Findings

### BLOCKERS

#### [BLOCKER-1] Dashboard directly queries Review and Metric tables

```
File:  src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts:19
Quote: import { reviews, replies, metricReadings } from '#/shared/db/schema'
```

**Rule:** Context reading another context's DB tables directly. Must go through owning context's application layer.

The dashboard repository performs raw SQL queries against `reviews`, `replies` (owned by Review context), and `metricReadings` (owned by Metric context). Six methods (`getKPIs`, `getRecentReviews`, `getRatingDistribution`, `getRatingTrend`, `getReviewVolume`, `getReplyPerformance`, `getEngagementFunnel`) all JOIN or SELECT from these foreign tables.

**Fix:** Create read-only query ports in Review and Metric contexts' application layers (e.g. `ReviewQueryPort.getAggregates()`, `MetricQueryPort.getAggregates()`). Dashboard's repository implements these against its own DB or the ports are injected. Alternative: define a `DashboardQueryPort` in dashboard's application layer and implement it in an infrastructure adapter that uses the shared schema — acceptable if the port is owned by dashboard and the adapter is a shared infrastructure concern.

---

#### [BLOCKER-2] Inbox directly queries Review, Guest, and Property tables

```
File:  src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:8-10
Quote: import { reviews } from '#/shared/db/schema/review.schema'
       import { feedback, ratings } from '#/shared/db/schema/guest.schema'
       import { properties } from '#/shared/db/schema/property.schema'
```

**Rule:** Context reading another context's DB tables directly. Must go through owning context's application layer.

The inbox repository JOINs to `reviews` (lines 130–136, 283–290) for reviewer name, text, and profile photo; to `feedback` and `ratings` (lines 305–322) for feedback comments and linked rating values; and to `properties` (line 138) for property name.

ADR 0004 acknowledges this trade-off explicitly: _"Cross-context read for detail view (JOIN to reviews or feedback table)"_ and _"Full detail (text, reviewer name, photos) fetched via JOIN on detail view."_ This is an intentional design decision but still violates the strict bounded-context rule.

**Fix:** Introduce read-only query ports in Review, Guest, and Property contexts' public APIs:

- `ReviewPublicApi.getReviewDetail(id, orgId)` → `{ reviewerName, text, reviewerProfilePhotoUrl }`
- `GuestPublicApi.getFeedbackDetail(id, orgId)` → `{ comment, ratingValue }`
- `PropertyPublicApi.getPropertyName(id, orgId)` → `string`

Wire in composition root. Inbox repository uses only its own `inbox_items` table + the injected ports.

---

#### [BLOCKER-3] Integration directly updates and queries Property table

```
File:  src/contexts/integration/build.ts:35
Quote: import { properties } from '#/shared/db/schema/property.schema'
       // eslint-disable-next-line no-restricted-imports -- wiring layer implements cross-context ports with shared schema
```

**Rule:** Context reading another context's DB tables directly. Must go through owning context's application layer.

The integration build function implements `PropertyFkCleanupPort` (lines 54–65: UPDATE properties SET googleConnectionId = NULL) and `PropertyQueryPort` (lines 68–89: SELECT from properties WHERE googleConnectionId = ?) by directly querying the `properties` table. The eslint-disable comment acknowledges this is a restricted import.

**Fix:** Move the FK cleanup and property query implementations to the Property context's public API:

- Add `clearGoogleConnectionRef(orgId, connectionId)` and `findIdsByGoogleConnection(connectionId, orgId)` to `PropertyPublicApi`
- Integration build function receives `PropertyPublicApi` instead of accessing the schema directly
- Remove the eslint-disable comment

---

### MAJOR

#### [MAJOR-1] Goal context takes MetricRepository directly instead of Metric application service

```
File:  src/contexts/goal/build.ts:7
Quote: import type { MetricRepository } from '#/contexts/metric/application/ports/metric.repository'
```

Also: `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts:10-11`

**Rule:** Use case in context A taking context B's repository instead of B's application service.

The Goal context's reconcile job directly uses `MetricRepository.queryAggregate()` to read metric data. Composition root wires `metricRepo: metricApi.metricRepo` (composition.ts:243). The metric context even exposes `metricRepo` in its public API (`MetricContextApi.metricRepo`), encouraging this pattern.

**Fix:**

1. Create `MetricPublicApi` with a `queryAggregate(query: MetricReadingsQuery): Promise<MetricReadingsAggregate>` method
2. Goal build function takes `MetricPublicApi` instead of `MetricRepository`
3. Remove `metricRepo` from `MetricContextApi` public surface

---

#### [MAJOR-2] Guest context takes StaffAssignmentRepository directly

```
File:  src/contexts/guest/build.ts:4
Quote: import type { StaffAssignmentRepository } from '#/contexts/staff/application/ports/staff-assignment.repository'
```

**Rule:** Use case in context A taking context B's repository instead of B's application service.

The guest build function imports `StaffAssignmentRepository` and uses it as a dep type. The use case (`record-scan-with-ref.ts`) correctly defines a local port `ReferralCodeResolver` to decouple itself — but the build function couples to the concrete repository type.

**Fix:** Change `GuestContextDeps.staffRepo` type from `StaffAssignmentRepository` to `ReferralCodeResolver` (the local port). The composition root can still wire the concrete repo since `StaffAssignmentRepository` satisfies the `ReferralCodeResolver` interface via duck typing.

---

#### [MAJOR-3] Event types imported from domain/events instead of application/public-api (17 instances)

Event types are domain-layer internals. Per the architecture comment in `review/application/public-api.ts`: _"Per boundary rules: external code may import from application/public-api but NOT from domain/."_ Yet 17 cross-context imports reach into `domain/events` directly.

**Where public-api already exports events (should import from public-api instead):**

| Source | Target   | Event               | File                                                               |
| ------ | -------- | ------------------- | ------------------------------------------------------------------ |
| Metric | Guest    | `RatingSubmitted`   | `metric/infrastructure/event-handlers/on-rating-submitted.ts:2`    |
| Metric | Guest    | `FeedbackSubmitted` | `metric/infrastructure/event-handlers/on-feedback-submitted.ts:2`  |
| Metric | Guest    | `ScanRecorded`      | `metric/infrastructure/event-handlers/on-scan-recorded.ts:2`       |
| Metric | Guest    | `ReviewLinkClicked` | `metric/infrastructure/event-handlers/on-review-link-clicked.ts:2` |
| Metric | Review   | `ReviewCreated`     | `metric/infrastructure/event-handlers/on-review-created.ts:2`      |
| Inbox  | Guest    | `FeedbackSubmitted` | `inbox/infrastructure/event-handlers/on-feedback-submitted.ts:4`   |
| Inbox  | Review   | `ReviewCreated`     | `inbox/infrastructure/event-handlers/on-review-created.ts:4`       |
| Inbox  | Review   | `ReviewUpdated`     | `inbox/infrastructure/event-handlers/on-review-updated.ts:4`       |
| Inbox  | Review   | `ReplyPublished`    | `inbox/infrastructure/event-handlers/on-reply-published.ts:4`      |
| Review | Property | `PropertyCreated`   | `review/infrastructure/event-handlers/on-property-created.ts:1`    |
| Goal   | Team     | `TeamDeleted`       | `goal/infrastructure/event-handlers/on-team-deleted.ts:5`          |
| Goal   | Team     | `TeamDeleted`       | `goal/infrastructure/event-handlers/on-team-deleted.test.ts:3`     |
| Goal   | Portal   | `PortalDeleted`     | `goal/infrastructure/event-handlers/on-portal-deleted.ts:5`        |
| Goal   | Portal   | `PortalDeleted`     | `goal/infrastructure/event-handlers/on-portal-deleted.test.ts:3`   |

**Where public-api doesn't export events (root cause: missing export):**

| Source | Target | Event             | Missing export in target                 |
| ------ | ------ | ----------------- | ---------------------------------------- |
| Goal   | Staff  | `StaffUnassigned` | `staff/application/public-api.ts`        |
| Goal   | Staff  | `StaffUnassigned` | `staff/application/public-api.ts` (test) |
| Metric | Review | `ReviewCreated`   | `review/application/public-api.ts`       |

**Fix:**

1. Add event re-exports to contexts missing them:
   - `review/application/public-api.ts`: add `export type { ReviewCreated, ReviewUpdated, ReplyPublished }` and `export { reviewCreated, reviewUpdated, replyPublished }` from `../domain/events`
   - `staff/application/public-api.ts`: add `export type { StaffUnassigned }` and `export { staffUnassigned }` from `../domain/events`
   - `portal/application/public-api.ts`: add `export type { PortalDeleted }` and `export { portalDeleted }` from `../domain/events`
2. Update all 17 import sites to use `application/public-api` instead of `domain/events`

---

#### [MAJOR-4] MetricContextApi exposes metricRepo in public surface

```
File:  src/contexts/metric/build.ts:19
Quote: metricRepo: MetricRepository
```

**Rule:** Cross-context access should go through application layer, not repository.

`MetricContextApi` returns `metricRepo` directly, which is how Goal context ends up using the repository. The metric context has no application service or public-api.ts — only a repository port.

**Fix:** Create `src/contexts/metric/application/public-api.ts` with a `MetricPublicApi` type that exposes only `queryAggregate()`. Remove `metricRepo` from `MetricContextApi`.

---

### MINOR

#### [MINOR-1] review/application/public-api.ts missing event re-exports

```
File:  src/contexts/review/application/public-api.ts
Quote: (file only exports GoogleReview, StarRating, ReviewQueuePort, GoogleReviewApiPort)
```

**Rule:** Per the file's own comment: _"external code may import from application/public-api but NOT from domain/"_. Events `ReviewCreated`, `ReviewUpdated`, `ReplyPublished` are not re-exported, forcing inbox and metric to import from `domain/events`.

**Fix:** Add event re-exports to the public-api file.

---

#### [MINOR-2] staff/application/public-api.ts missing event re-exports

```
File:  src/contexts/staff/application/public-api.ts
Quote: (file only exports StaffPublicApi type)
```

**Rule:** `StaffUnassigned` event is consumed by Goal context via `domain/events` because it's not available through public-api.

**Fix:** Add `export type { StaffUnassigned }` and `export { staffUnassigned }` from `../domain/events`.

---

#### [MINOR-3] portal/application/public-api.ts missing event re-exports

```
File:  src/contexts/portal/application/public-api.ts
Quote: (file only exports StoragePort, LinkResolverPort)
```

**Rule:** `PortalDeleted` event is consumed by Goal context via `domain/events` because it's not available through public-api.

**Fix:** Add `export type { PortalDeleted }` and `export { portalDeleted }` from `../domain/events`.

---

## Dependency Matrix

Rows = source context, columns = target context. Cell = coupling type.

|                 | Identity | Property                    | Portal                     | Guest                           | Team              | Staff                    | Integration | Review                          | Inbox | Dashboard | Metric          | Goal |
| --------------- | -------- | --------------------------- | -------------------------- | ------------------------------- | ----------------- | ------------------------ | ----------- | ------------------------------- | ----- | --------- | --------------- | ---- |
| **Identity**    | —        | none                        | via app (StoragePort)      | none                            | none              | none                     | none        | none                            | none  | none      | none            | none |
| **Property**    | none     | —                           | none                       | none                            | none              | via app (StaffPublicApi) | none        | none                            | none  | none      | none            | none |
| **Portal**      | none     | via app (PropertyPublicApi) | —                          | none                            | none              | none                     | none        | none                            | none  | none      | none            | none |
| **Guest**       | none     | none                        | via app (LinkResolverPort) | —                               | none              | ⚠️ via repo              | none        | none                            | none  | none      | none            | none |
| **Team**        | none     | via app (PropertyPublicApi) | none                       | none                            | —                 | via app (StaffPublicApi) | none        | none                            | none  | none      | none            | none |
| **Staff**       | none     | none                        | none                       | none                            | none              | —                        | none        | none                            | none  | none      | none            | none |
| **Integration** | none     | 🔴 direct table + via app   | none                       | none                            | none              | none                     | —           | via app (port impl)             | none  | none      | none            | none |
| **Review**      | none     | via domain/events           | none                       | none                            | none              | none                     | none        | —                               | none  | none      | none            | none |
| **Inbox**       | none     | 🔴 direct table             | none                       | 🔴 direct table + domain/events | none              | via app (StaffPublicApi) | none        | 🔴 direct table + domain/events | —     | none      | none            | none |
| **Dashboard**   | none     | none                        | none                       | none                            | none              | none                     | none        | 🔴 direct table                 | none  | —         | 🔴 direct table | none |
| **Metric**      | none     | none                        | none                       | via domain/events               | none              | none                     | none        | via domain/events               | none  | none      | —               | none |
| **Goal**        | none     | none                        | via domain/events          | none                            | via domain/events | via domain/events        | none        | none                            | none  | none      | ⚠️ via repo     | —    |

### Legend

| Symbol            | Meaning                                                    |
| ----------------- | ---------------------------------------------------------- |
| —                 | Same context (no dependency)                               |
| none              | No coupling detected                                       |
| via app           | Via application/public-api (✅ correct)                    |
| via repo          | ⚠️ Direct repository import (MAJOR)                        |
| via domain/events | ⚠️ Import from domain/events instead of public-api (MAJOR) |
| 🔴 direct table   | BLOCKER — directly queries another context's DB tables     |

### Blocked dependency highlights

| Source → Target        | Type            | Finding   |
| ---------------------- | --------------- | --------- |
| Dashboard → Review     | 🔴 direct table | BLOCKER-1 |
| Dashboard → Metric     | 🔴 direct table | BLOCKER-1 |
| Inbox → Review         | 🔴 direct table | BLOCKER-2 |
| Inbox → Guest          | 🔴 direct table | BLOCKER-2 |
| Inbox → Property       | 🔴 direct table | BLOCKER-2 |
| Integration → Property | 🔴 direct table | BLOCKER-3 |
| Goal → Metric          | ⚠️ via repo     | MAJOR-1   |
| Guest → Staff          | ⚠️ via repo     | MAJOR-2   |

---

## Architecture Observations

### What's working well

1. **Facade port pattern** — Integration implements Review context's `GoogleReviewApiPort`. Clean hexagonal dependency inversion via composition root.
2. **Public API layer** — Most contexts expose a typed `PublicApi` or `public-api.ts` with application-level contracts. Staff, Property, and Team contexts all consume each other via `StaffPublicApi` and `PropertyPublicApi`.
3. **Event-driven communication** — Contexts subscribe to each other's domain events (review.created, feedback.submitted, etc.) rather than making synchronous cross-context calls.
4. **Branded IDs** — Cross-context references use branded ID types from `shared/domain/ids` (e.g. `GoogleConnectionId`), never entity types. No entity-ownership violations found.
5. **Permission centralization** — All `can()` calls go through `shared/domain/permissions`. No scattered permission logic.
6. **Composition root** — All cross-context wiring is in `composition.ts`. Contexts don't directly instantiate each other.

### Structural debt

1. **Read-path shortcuts** — Dashboard and Inbox bypass the application layer for read aggregation. This is pragmatic but creates a slippery slope: if Review renames a column, Dashboard and Inbox break silently.
2. **Inconsistent event exports** — Team, Guest, and Property contexts properly re-export events from public-api. Review, Staff, and Portal do not. Metric has no public-api at all.
3. **No MetricPublicApi** — Metric context exposes its repository directly, which is how Goal ends up with a MAJOR violation. Adding an application service would close the gap.

---

## Recommendations (Priority Order)

1. **BLOCKER-3** (Integration → Property table) — Easiest fix. Add two methods to `PropertyPublicApi`, wire in composition root. Low risk, high clarity.
2. **MAJOR-3** (Event re-exports) — Mechanical fix. Add exports to 3 public-api files, update 17 import sites. No logic changes.
3. **MAJOR-1 + MAJOR-4** (Goal → Metric repo) — Create `MetricPublicApi`, update Goal build function and job.
4. **MAJOR-2** (Guest → Staff repo) — One-line type change in `build.ts`.
5. **BLOCKER-2** (Inbox direct tables) — Introduce query ports in Review, Guest, Property contexts. Larger refactor.
6. **BLOCKER-1** (Dashboard direct tables) — Introduce aggregation query ports. Largest refactor but dashboard is read-only so risk is low.
