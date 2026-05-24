# Review 2: Bounded Context Boundaries

**Date:** 2026-05-23  
**Scope:** Inter-context coupling across all 12 bounded contexts  
**Reviewer:** Automated code review (R2 re-review, deep boundary audit)  
**Branch:** feat/phase-15c-goal-ui

## Summary

Deep audit of inter-context coupling across all 12 bounded contexts. Cross-context imports through `application/public-api.ts` are well-maintained for behavioral dependencies (use cases, ports). However, **six contexts directly access other contexts' database tables** through the shared schema layer, bypassing public-API boundaries. The most critical violations: **Integration context directly INSERTs/UPDATEs the Property table** (bypassing PropertyPublicApi which already defines those operations), **Inbox context JOINs against Review/Guest/Property tables**, and **Dashboard queries Review/Metric tables in violation of its own ADR-0007** which mandates facade ports. Additionally, the **Metric context's public-api does not export event types**, forcing the Goal context to duplicate the `MetricRecorded` type inline, and the **Goal context has no `public-api.ts`** at all.

## Findings

### [BLOCKER] Integration directly INSERTs into Property table via property-import.repository.ts

File: src/contexts/integration/infrastructure/repositories/property-import.repository.ts
Quote:

```ts
import { properties } from '#/shared/db/schema'
// ...
await db.insert(properties).values({ ... })
```

Rule: Context A directly manipulating Context B's database tables. The Property context owns the `properties` table. Integration bypasses PropertyPublicApi and directly inserts rows. PropertyPublicApi already defines `findByGbpPlaceId`, `findIdsByGoogleConnection`, `clearGoogleConnectionRef` — but does NOT expose a creation method, so Integration built its own repo to bypass the boundary.
Fix: Add `importProperty` to `PropertyPublicApi` (or a dedicated `PropertyImportPort` in public-api). Integration should call the Property context's API, not write to its table directly.

### [BLOCKER] Integration build.ts directly UPDATEs/SELECTs Property table

File: src/contexts/integration/build.ts:55-82
Quote:

```ts
import { properties } from '#/shared/db/schema/property.schema'
// ...
const propertyFkCleanup: PropertyFkCleanupPort = {
  clearGoogleConnectionRef: async (orgId, connectionId) => {
    await deps.db.update(properties).set({ googleConnectionId: null, ... })
  },
}
const propertyQuery: PropertyQueryPort = {
  belongsToOrg: async (propertyId, orgId) => {
    const rows = await deps.db.select({ id: properties.id }).from(properties) ...
  },
  findIdsByGoogleConnection: async (connectionId, orgId) => {
    const rows = await deps.db.select({ id: properties.id }).from(properties) ...
  },
}
```

Rule: Context A reading/writing Context B's database tables directly. These operations (`clearGoogleConnectionRef`, `belongsToOrg`, `findIdsByGoogleConnection`) are **identical** to methods already defined in `PropertyPublicApi`. The build.ts eslint-disable comment (`no-restricted-imports`) acknowledges this is a restricted pattern. The composition root should wire `PropertyPublicApi` into Integration's ports instead of letting Integration implement them with direct DB queries.
Fix: Wire `PropertyPublicApi` methods as the implementations for `PropertyFkCleanupPort` and `PropertyQueryPort` in composition.ts. Remove direct schema imports from integration/build.ts.

### [BLOCKER] Inbox directly JOINs Review, Guest (feedback/ratings), and Property tables

File: src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:7-10
Quote:

```ts
import { reviews } from '#/shared/db/schema/review.schema'
import { feedback, ratings } from '#/shared/db/schema/guest.schema'
import { properties } from '#/shared/db/schema/property.schema'
// ...
.leftJoin(reviews, and(eq(inboxItems.sourceType, 'review'), eq(inboxItems.sourceId, reviews.id)))
.leftJoin(properties, sql`${inboxItems.propertyId}::uuid = ${properties.id}`)
// Also: findDetailById queries reviews, feedback, ratings tables
```

Rule: Context A reading Context B's database tables directly. Inbox JOINs against Review (`reviews`), Guest (`feedback`, `ratings`), and Property (`properties`) tables to enrich inbox items with reviewer names, review text, feedback comments, and property names. These are owned by other contexts and their schemas may change independently.
Fix: Define enrichment ports (e.g., `ReviewEnrichmentPort`, `FeedbackEnrichmentPort`, `PropertyEnrichmentPort`) in the Inbox application layer. Implement them in composition.ts by calling Review/Guest/Property public APIs. Alternatively, fully denormalize the needed fields into `inbox_items` during event handler processing (the `on-review-created`/`on-feedback-submitted` handlers already capture some data).

### [MAJOR] Dashboard queries Review/Metric tables directly, violating its own ADR-0007

File: src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts:19
Quote:

```ts
import { reviews, replies, metricReadings } from '#/shared/db/schema'
```

Rule: ADR-0007 states: "Context boundaries must be respected — dashboard cannot directly query other contexts' tables" and "Dashboard context defines facade ports for each data source. Other contexts implement adapters." The current implementation directly queries `reviews`, `replies`, and `metricReadings` — the exact anti-pattern the ADR was written to prevent. The ADR's consequences section says "Context boundaries respected — dashboard never directly queries other contexts' tables", which is factually incorrect given the implementation.
Fix: Introduce facade ports in Dashboard's application layer (e.g., `ReviewStatsPort`, `MetricStatsPort`). Implement adapters in composition.ts that delegate to Review and Metric public APIs. This is the architecture the ADR prescribes but the code does not follow.

### [MAJOR] Metric public-api does not export event types — Goal context duplicates MetricRecorded inline

File: src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts:21-32
Quote:

```ts
export type MetricRecordedEvent = Readonly<{
  _tag: 'metric.recorded'
  readingId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  // ... full type duplicated inline
}>
```

Rule: "Event imports — do they go through public-api?" The Metric context's `public-api.ts` exports only `MetricPublicApi`, `MetricReadingsQuery`, and `MetricReadingsAggregate`. It does NOT export `MetricRecorded` or `metricRecorded`. All other contexts with events (Review, Guest, Staff, Portal, Team, Identity, Property, Integration) correctly export event types from their public-api. The Goal context was forced to duplicate the type because it had no public-api source to import from.
Fix: Add `export type { MetricRecorded, MetricEvent } from '../domain/events'` and `export { metricRecorded } from '../domain/events'` to `metric/application/public-api.ts`. Update `goal/infrastructure/event-handlers/on-metric-recorded.ts` to import `MetricRecorded` from the metric public-api.

### [MAJOR] Goal context has no application/public-api.ts — missing boundary for consumers

File: src/contexts/goal/ (missing file: application/public-api.ts)
Quote:

```
// All 11 other contexts have application/public-api.ts.
// Goal is the only context without one.
```

Rule: "Cross-context: import from `application/public-api.ts` only." The Goal context has no public-api boundary. If any future context needs to consume Goal types or APIs, there is no sanctioned import path. The shared/events/events.ts already imports Goal event types from `domain/events` directly (acceptable for the master event union), but any other consumer would have no public-api entry point.
Fix: Create `goal/application/public-api.ts` that re-exports domain types (`Goal`, `GoalStatus`, `GoalType`, etc.), event types (`GoalCompleted`, `GoalProgressUpdated`), and any ports that other contexts might need.

### [MAJOR] guest/build.ts imports StaffAssignmentRepository from staff internal port, not public-api

File: src/contexts/guest/build.ts:4
Quote:

```ts
import type { StaffAssignmentRepository } from '#/contexts/staff/application/ports/staff-assignment.repository'
```

Rule: Cross-context imports must go through `application/public-api.ts`. The guest context reaches into the staff context's internal port file. The Staff public-api does not export `StaffAssignmentRepository`, forcing this violation.
Fix: Export `StaffAssignmentRepository` type from `staff/application/public-api.ts` and import from there. Alternatively, define a local port interface in the Guest context (like `ReferralCodeResolver` already defined in `record-scan-with-ref.ts`) and accept the staff repo through that interface at the build level.

### [MINOR] Guest resolvers directly query Portal and Property tables

File: src/contexts/guest/infrastructure/resolvers/public-portal-lookup.ts:7-8
Quote:

```ts
import {
  portals,
  portalLinkCategories,
  portalLinks,
} from '#/shared/db/schema/portal.schema'
import { properties } from '#/shared/db/schema/property.schema'
```

Rule: Context A reading Context B's database tables. The Guest context's `public-portal-lookup.ts` queries `properties` (by slug) and `portals`/`portalLinks`/`portalLinkCategories` tables. The `portal-context-resolver.ts` also queries `portals` directly. These are guest-facing resolvers that bypass the Portal context's public API.
Fix: The Guest context already imports `LinkResolverPort` from Portal's public-api (correct pattern). Extend the Portal public-api to expose a `PublicPortalLookupPort` and `PortalContextResolver` that Guest can consume through dependency injection rather than direct DB queries.

### [MINOR] Portal repository JOINs Property table for QR URL lookup

File: src/contexts/portal/infrastructure/repositories/portal.repository.ts:9,140-150
Quote:

```ts
import { properties } from '#/shared/db/schema/property.schema'
// ...
JOIN ${properties} pr ON pr.id = p.property_id
```

Rule: Context A reading Context B's database tables. Portal's `getPortalQrInfo` JOINs the `properties` table to resolve the property slug. This is a read-only cross-context table access.
Fix: Use `PropertyPublicApi.propertyExists` or add a `getPropertySlug(id)` method to PropertyPublicApi. Acceptable as-is if the JOIN is deemed trivial, but it couples Portal's repository to Property's schema.

### [NIT] Integration→Property Lookup: correctly uses PropertyLookupPort via composition root

File: src/composition.ts (propertyLookup wiring)
Quote:

```ts
const propertyLookup: PropertyLookupPort = {
  findByGbpPlaceId: property.publicApi.findByGbpPlaceId,
}
```

Rule: This is the correct pattern — composition root wires the property public API into an integration port.
Fix: No fix needed.

### [NIT] Inbox→Staff: correctly uses StaffPublicApi from public-api.ts

File: src/contexts/inbox/application/use-cases/update-inbox-status.ts:11
Quote:

```ts
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
```

Rule: Correct cross-context boundary usage for behavioral dependency.
Fix: No fix needed.

### [NIT] Goal→Metric: correctly uses MetricPublicApi for progress reconciliation

File: src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts:10-11
Quote:

```ts
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
```

Rule: Correct — Goal job uses MetricPublicApi interface for querying aggregates, not the metric repository directly.
Fix: No fix needed.

### [NIT] Goal event handlers: correctly import event types from public APIs (Portal, Team, Staff)

File: src/contexts/goal/infrastructure/event-handlers/on-portal-deleted.ts:5
Quote:

```ts
import type { PortalDeleted } from '#/contexts/portal/application/public-api'
```

Rule: Correct — event handler imports event type from portal's public API. Same correct pattern for `StaffUnassigned` and `TeamDeleted`.
Fix: No fix needed.

## Severity Counts

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 3      |
| MAJOR     | 4      |
| MINOR     | 2      |
| NIT       | 4      |
| **Total** | **13** |
