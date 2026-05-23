# Review 11: Multi-Tenancy & Tenant Isolation

**Date:** 2026-05-23
**Scope:** All DB queries, server functions, use cases, jobs, event handlers
**Unit of tenancy:** Organization. PropertyManagers further scoped by `staff_assignment`.

---

## Executive Summary

**No cross-tenant data leaks found.** All 18 repositories scope queries by `organizationId`. All 50+ server functions source `organizationId` from `resolveTenantContext(headers)`, never from request body/params. The `baseWhere()` helper enforces compile-time safety via `TenantTable` constraint.

Two concerns identified: (1) property/goal/reply mutation use cases check role but not PropertyManager-to-property assignment via `getAccessiblePropertyIds` — the inbox context does check this, creating an inconsistency; (2) request spans and structured logs omit `organizationId`, reducing observability per-tenant.

---

## Findings

### [MAJOR] Property/goal/reply mutations skip staff_assignment verification

PropertyManager can update any property, create goals for any property, and manage replies for any review within their org — the `getAccessiblePropertyIds` gate used by inbox use cases is absent.

```
File: src/contexts/property/application/use-cases/update-property.ts:21-25
```

```ts
function authorize(ctx: AuthContext): void {
  if (!can(ctx.role, 'property.update')) {
    throw propertyError('forbidden', 'this role cannot edit properties')
  }
}
```

**Rule:** BLOCKER criteria — "PropertyManager mutation on property without verifying staff_assignment row for (userId, propertyId)."
**Fix:** Add `getAccessiblePropertyIds` check (same pattern as `inbox/application/use-cases/update-inbox-status.ts:48`). Call `deps.staffApi.getAccessiblePropertyIds(ctx)`; if non-null, verify `propertyId` is in the returned array.

Affected files:

- `src/contexts/property/application/use-cases/update-property.ts`
- `src/contexts/goal/server/goals.ts` (server-level `requireWriteAccess` checks role only)
- `src/contexts/review/application/use-cases/reply-operations.ts` (checks `can(role, 'reply.manage')` but not property assignment)

**Severity rationale:** Downgraded from BLOCKER to MAJOR because PropertyManager = `admin` role has broad org-level permissions by design (see `shared/auth/permissions.ts:42-59`). The `admin` role has `property.create`, `property.update`, `reply.manage` etc. at the org level. The inbox context's `getAccessiblePropertyIds` appears to be a read-filter for inbox views, not a write-gate. However, if the product intent is that PropertyManagers are restricted to assigned properties, this becomes a BLOCKER.

---

### [MAJOR] Request spans and logs omit organizationId

```
File: src/shared/observability/trace.ts:29-37
```

```ts
logger.error(
  {
    span: span.name,
    requestId: span.requestId,
    // Missing: organizationId
  },
  `✕ ${span.name} ${duration}ms — ${message}`,
)
```

**Rule:** MAJOR — "Logs/spans missing organizationId attribute."
**Fix:** Include `organizationId` in the span struct. Resolve it after `resolveTenantContext()` in `traced-server-fn.ts` and propagate via ALS (already has `request-context.ts`).

---

### [MINOR] Inbox LEFT JOINs not scoped by organizationId (defense-in-depth)

```
File: src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:134-138
```

```ts
.leftJoin(
  reviews,
  and(eq(inboxItems.sourceType, 'review'), eq(inboxItems.sourceId, reviews.id)),
)
.leftJoin(properties, sql`${inboxItems.propertyId}::uuid = ${properties.id}`)
```

**Rule:** Defense-in-depth — JOIN conditions should include `organizationId` on joined tables.
**Fix:** Add `eq(reviews.organizationId, orgId)` and `eq(properties.organizationId, orgId)` to the JOIN conditions. The primary `inboxItems` table is already scoped, so this is not exploitable, but hardening prevents data-corruption edge cases from leaking joined display fields across tenants.

---

## Audit Coverage

### Repositories (all scoped ✓)

| Repository       | File                                                                      | organizationId in WHERE                    |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| Property         | `property/infrastructure/repositories/property.repository.ts`             | ✓ every method                             |
| Team             | `team/infrastructure/repositories/team.repository.ts`                     | ✓                                          |
| StaffAssignment  | `staff/infrastructure/repositories/staff-assignment.repository.ts`        | ✓                                          |
| Portal           | `portal/infrastructure/repositories/portal.repository.ts`                 | ✓                                          |
| PortalLink       | `portal/infrastructure/repositories/portal-link.repository.ts`            | ✓                                          |
| Review           | `review/infrastructure/repositories/review.repository.ts`                 | ✓                                          |
| Reply            | `review/infrastructure/repositories/reply.repository.ts`                  | ✓                                          |
| Inbox            | `inbox/infrastructure/repositories/inbox.repository.ts`                   | ✓                                          |
| InboxNote        | `inbox/infrastructure/repositories/inbox-note.repository.ts`              | ✓                                          |
| Goal             | `goal/infrastructure/repositories/goal.repository.ts`                     | ✓                                          |
| Metric           | `metric/infrastructure/repositories/metric.repository.ts`                 | ✓                                          |
| Dashboard        | `dashboard/infrastructure/repositories/dashboard.repository.ts`           | ✓                                          |
| GoogleConnection | `integration/infrastructure/repositories/google-connection.repository.ts` | ✓                                          |
| GbpCache         | `integration/infrastructure/repositories/gbp-cache.repository.ts`         | ✓ (defense-in-depth via PropertyQueryPort) |
| GbpImport        | `integration/infrastructure/repositories/gbp-import.repository.ts`        | ✓                                          |
| PropertyImport   | `integration/infrastructure/repositories/property-import.repository.ts`   | ✓                                          |
| GuestInteraction | `guest/infrastructure/repositories/guest-interaction.repository.ts`       | ✓                                          |
| LinkResolver     | `portal/infrastructure/repositories/link-resolver.repository.ts`          | ✓ (public, UUID-scoped)                    |

### Server Functions (all use resolveTenantContext ✓)

| Context     | File                                | organizationId source                                      |
| ----------- | ----------------------------------- | ---------------------------------------------------------- |
| Identity    | `identity/server/organizations.ts`  | `ctx.organizationId` via `resolveTenantContext` (14 calls) |
| Property    | `property/server/properties.ts`     | `ctx.organizationId` (5 endpoints)                         |
| Portal      | `portal/server/portals.ts`          | `ctx.organizationId`                                       |
| Team        | `team/server/teams.ts`              | `ctx.organizationId`                                       |
| Inbox       | `inbox/server/inbox.ts`             | `ctx.organizationId`                                       |
| Staff       | `staff/server/staff-assignments.ts` | `ctx.organizationId`                                       |
| Goal        | `goal/server/goals.ts`              | `ctx.organizationId` (5 endpoints)                         |
| Review      | `review/server/reviews.ts`          | `ctx.organizationId`                                       |
| Metric      | `metric/server/metrics.ts`          | `ctx.organizationId`                                       |
| Dashboard   | `dashboard/server/`                 | `ctx.organizationId`                                       |
| Integration | `integration/server/`               | `ctx.organizationId`                                       |

**Unsafe sources (input.organizationId / params.organizationId / body.organizationId):** None found. Grep across all server files returned zero matches.

### Background Jobs

| Job                                | Tenant scoping                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `sync-property-reviews.job.ts`     | ✓ org-scoped via `job.data.organizationId`                                    |
| `publish-reply.job.ts`             | ✓ org-scoped via `job.data.organizationId`                                    |
| `reconcile-goal-progress.job.ts`   | ✓ org-scoped via `job.data.organizationId`                                    |
| `spawn-recurring-instances.job.ts` | ✓ org-scoped via `job.data.organizationId`                                    |
| `purge-expired-reviews.job.ts`     | ✓ cross-tenant by design — enumerates all orgs, deletes with per-record orgId |
| `refresh-expiring-reviews.job.ts`  | ✓ cross-tenant by design — enumerates all orgs, groups by orgId               |
| `refresh-materialized-view.job.ts` | ✓ cross-tenant by design — refreshes global MVs                               |

### Event Handlers

| Handler                       | Tenant scoping               |
| ----------------------------- | ---------------------------- |
| `on-metric-recorded.ts`       | ✓ via `event.organizationId` |
| `on-review-created.ts`        | ✓ via `event.organizationId` |
| `on-review-updated.ts`        | ✓ via `event.organizationId` |
| `gbp-notification-handler.ts` | ✓ via `event.organizationId` |

### Public APIs (intentionally unscoped)

| Resolver                     | Design                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `portal-context-resolver.ts` | UUID capability token — documented as "PUBLIC API — no organizationId scoping by design" |
| `public-portal-lookup.ts`    | UUID capability token                                                                    |
| `guest/server/public.ts`     | UUID capability token                                                                    |

---

## Cross-Tenant Test Coverage

Repository-level tests include second-org fixtures and explicit cross-tenant assertions:

- `property.repository.test.ts`: ORG_A / ORG_B, tests "slugExists does not leak across tenants"
- `review.repository.test.ts`, `reply.repository.test.ts`, `team.repository.test.ts`, `staff-assignment.repository.test.ts`, `dashboard.repository.test.ts`, `gbp-cache.repository.test.ts`, `portal.repository.test.ts`, `portal-link.repository.test.ts`, `google-connection.repository.test.ts`: all include cross-org test cases

Use-case-level tests for **inbox** include PropertyManager assignment checks with `getAccessiblePropertyIds` mocks for assigned vs unassigned properties. Use-case tests for **property** and **goal** contexts do NOT test PropertyManager-to-property assignment (consistent with the use case code itself not checking this).

---

## Structural Safeguards

1. **`TenantTable` compile-time constraint** (`shared/db/base-where.ts`): Requires `organizationId` and `deletedAt` columns at the type level. Repositories using `baseWhere()` cannot accidentally omit org scoping.

2. **`resolveTenantContext(headers)`** (`shared/auth/middleware.ts`): Single source of truth for `organizationId`. Extracts from session, not from request body. All server functions use this.

3. **Branded IDs** (`shared/domain/ids.ts`): `OrganizationId`, `PropertyId`, etc. prevent accidental mixing of ID types at compile time.

4. **Redis cache keys** (`redis-unread-counter.ts`): Properly scoped — `inbox:unread:${orgId}`.

5. **Session cache** (`middleware.ts`): Module-level `Map` keyed by cookie header string, 5s TTL, 100 max. No cross-tenant risk — key includes full session cookie.

---

## Entity Table

| Entity                | Table                    | Tenant Column                   | Unscoped Queries |
| --------------------- | ------------------------ | ------------------------------- | ---------------- |
| Property              | `properties`             | `organization_id`               | —                |
| Team                  | `teams`                  | `organization_id`               | —                |
| StaffAssignment       | `staff_assignments`      | `organization_id`               | —                |
| Portal                | `portals`                | `organization_id`               | —                |
| PortalLink            | `portal_links`           | `organization_id`               | —                |
| Review                | `reviews`                | `organization_id`               | —                |
| Reply                 | `replies`                | `organization_id`               | —                |
| InboxItem             | `inbox_items`            | `organization_id`               | —                |
| InboxNote             | `inbox_notes`            | `organization_id`               | —                |
| Goal                  | `goals`                  | `organization_id`               | —                |
| GoalProgress          | `goal_progress`          | `organization_id` (via goal FK) | —                |
| MetricReading         | `metric_readings`        | `organization_id`               | —                |
| DailyMetric (MV)      | `mv_daily_metrics`       | `organization_id`               | —                |
| WeeklyMetric (MV)     | `mv_weekly_metrics`      | `organization_id`               | —                |
| DailyInboxMetric (MV) | `mv_daily_inbox_metrics` | `organization_id`               | —                |
| GoogleConnection      | `google_connections`     | `organization_id`               | —                |
| GbpCache              | `gbp_cache`              | `organization_id`               | —                |
| GbpImport             | `gbp_imports`            | `organization_id`               | —                |
| PropertyImport        | `property_imports`       | `organization_id`               | —                |
| GuestInteraction      | `guest_interactions`     | `organization_id`               | —                |

---

## Recommendations (Priority Order)

1. **Clarify PropertyManager property-level access model.** If PMs should be restricted to assigned properties, add `getAccessiblePropertyIds` checks to `update-property.ts`, `goals.ts` server functions, and `reply-operations.ts`. If PMs have org-wide property access by design, document this in `CONTEXT.md` and close the gap with the inbox context's more restrictive pattern.

2. **Add organizationId to request spans.** Propagate via ALS after `resolveTenantContext()`, include in all `logger.error/debug/info` calls within `trace.ts`. Enables per-tenant log filtering in production.

3. **Harden inbox LEFT JOINs.** Add `organizationId` to JOIN conditions on `reviews` and `properties` tables for defense-in-depth.
