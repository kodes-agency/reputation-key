# Phase 5: Architecture + Build Functions + Server Functions

**Findings covered:** #8, #25, #72-#81, #98-#102, #108-#116, #196-#200, #212-#220
**Estimated effort:** 4-5 developer-days
**Parallelism:** All streams independent.

---

## Stream A: Build Function Shape [L]

**Findings:** #8, #25, #112-#116, #199-#200, #232-#233

### A1. Portal build.ts — inject config, return D4 shape [M]

**Findings:** #8, #112, #113
**File:** `src/contexts/portal/build.ts`

**Changes:**

1. Remove `getEnv()` call. Accept `portalBaseUrl: string` and `portalApiKey: string` via `PortalBuildDeps`
2. Change return shape to `{ publicApi, internal: { repos, useCases } }`
3. Fix `linkIdGen` to return branded `PortalLinkId`, not raw string
4. Replace `import { randomUUID } from 'crypto'` with injected `idGen`

### A2. Goal build.ts — return D4 shape, fix double repo [M]

**Findings:** #25, #115
**Files:** `src/contexts/goal/build.ts`, `src/composition.ts`

**Changes:**

1. Wrap return in `{ publicApi, internal: { repos: { goalRepo, goalProgressRepo }, useCases } }`
2. In `composition.ts`, use `goalContext.internal.repos.goalRepo` instead of creating a second instance
3. Fix `idGen` double-wrapping: build returns `StaffAssignmentId` but use case expects `string` — align types

### A3. Composition.ts — remove direct infra imports [M]

**Finding:** #111
**File:** `src/composition.ts`

**Changes:**

1. Replace 12 direct infrastructure imports with access through context `internal` exports
2. For job wiring that needs infrastructure constants (job names), export them from `public-api.ts` or a shared constants file
3. Ensure all `build.ts` functions return the D4 shape before this change

### A4. Staff build.ts — fix dependency ordering [S]

**Finding:** #200
**File:** `src/contexts/staff/build.ts:42-48`

**Fix:** Reorder use case creation to match dependency order (ports before use cases that use them).

### A5. Review build.ts — throw domain error for missing deps [S]

**Finding:** #199
**File:** `src/contexts/review/build.ts:64`

**Fix:** Replace `throw new Error('jobQueue required')` with `reviewError({ code: 'BUILD_CONFIG_ERROR', message: '...' })`.

### A6. Review build re-exports cleanup [S]

**Finding:** #219
**File:** `src/contexts/review/build.ts:26-34`

**Fix:** Re-export through public-api.ts only. Remove direct domain constructor re-exports from build.

### A7. Goal build.ts event bus wiring [S]

**Finding:** #233
**File:** `src/contexts/goal/build.ts:95-100`

**Fix:** Wire `eventBus` to all handlers consistently (some are missing).

---

## Stream B: Server Function Fixes [L]

**Findings:** #72-#81, #194, #195

### B1. Team server — add can() checks [S]

**Finding:** #72
**File:** `src/contexts/team/server/teams.ts:41-54`

**Fix:** Add `can(ctx.role, 'team.read')` and `can(ctx.role, 'team.update')` checks to all 4 server functions. These currently delegate to use cases but D8 requires explicit server-layer check.

### B2. Staff server — add can() to 4 functions [S]

**Finding:** #73
**File:** `src/contexts/staff/server/staff-assignments.ts:44-85`

**Fix:** Add `can(ctx.role, 'staff.read')` / `can(ctx.role, 'staff.manage')` to the 4 functions missing it.

### B3. Integration startPropertyImport — fix permission [S]

**Finding:** #76
**File:** `src/contexts/integration/server/gbp-import.ts:59-82`

**Fix:** Change `can(ctx.role, 'integration.manage')` to `can(ctx.role, 'property.create')` per CONTEXT.md.

### B4. Identity server functions — stop bypassing use case layer [L]

**Findings:** #77, #78, #79
**Files:** `src/contexts/identity/server/organizations.query.ts`, `organizations.invitations.ts`

**Fix:** Replace direct `getAuth().api.*` calls with calls to identity context's use cases or adapter methods. The auth adapter exists — route through it:

- `getActiveOrganization` → use `identityAdapter.getActiveOrg()`
- `listMembers` → use `identityAdapter.listMembers()`
- `cancelInvitation` → use `identityAdapter.cancelInvitation()`

### B5. Guest server — use tracedServerFn [S]

**Finding:** #80
**File:** `src/contexts/guest/server/public.ts`

**Fix:** Change `tracedHandler` to `tracedServerFn` for functions that require auth. Keep `tracedHandler` only for truly public endpoints (portal lookup, scan submission).

### B6. Activity server — use tracedServerFn [S]

**Finding:** #81
**File:** `src/contexts/activity/server/activity.ts`

**Fix:** Change `tracedHandler` to `tracedServerFn` since these are authenticated endpoints.

### B7. Review server — preserve error context [S]

**Finding:** #194
**File:** `src/contexts/review/server/reviews.ts:45-50`

**Fix:** When catching domain errors, preserve the original error code and message in the server response instead of wrapping in generic message.

### B8. Property searchProperties — document public access [S]

**Finding:** #195
**File:** `src/contexts/property/server/search-properties.ts:28`

**Fix:** Add comment documenting this is intentionally public (no can() check) and add rate limiting.

---

## Stream C: Cross-Context Boundary Fixes [M]

**Findings:** #85, #108, #109, #110, #196, #198, #220

### C1. Dashboard domain/types.ts boundary inversion [S]

**Findings:** #85, #220
**File:** `src/contexts/dashboard/domain/types.ts:7-8`

**Fix:** Move `StaffDashboardData` type to `application/` layer. `domain/types.ts` should not import from application. If domain needs to reference it, define a domain interface.

### C2. Staff server — portal repo direct access [S]

**Finding:** #108
**File:** `src/contexts/staff/server/staff-portals.ts:52`

**Fix:** Import from `portalContext.publicApi` instead of directly accessing portal repository. Resolve portal context from composition root.

### C3. Goal create-goal cross-context import [S]

**Finding:** #109
**File:** `src/contexts/goal/application/use-cases/create-goal.ts:10`

**Fix:** Import from `src/contexts/portal/application/public-api` instead of relative path into portal internals.

### C4. Integration test — review internal-ports import [S]

**Finding:** #110
**File:** `src/contexts/integration/infrastructure/event-handlers/handle-gbp-notification.test.ts:10`

**Fix:** Import test helpers from `review/application/public-api` or shared testing utilities instead of review's internal ports.

### C5. Review reply-operations — import from shared [S]

**Finding:** #196
**File:** `src/contexts/review/application/use-cases/reply-operations.ts:5`

**Fix:** Import `ReviewId` from `shared/domain/types` instead of directly from review's domain.

### C6. Dashboard composition inline wiring [S]

**Finding:** #198
**File:** `src/composition.ts:177-188`

**Fix:** Move the inline analytics wiring function into `dashboard/infrastructure/adapters/` as a proper adapter.

---

## Stream D: Port Standards [M]

**Findings:** #98-#102, #166-#173, #212-#216

### D1. Notification UserLookupPort — add orgId [S]

**Finding:** #98
**File:** `src/contexts/notification/application/ports/user-lookup.port.ts:12`

**Fix:** Add `organizationId: OrganizationId` parameter to `findAssignedManagers`.

### D2. Goal progress port — add orgId [S]

**Finding:** #99
**File:** `src/contexts/goal/application/ports/goal.repository.ts`

**Fix:** Add `organizationId` to `getProgress`, `getProgressBatch`, `updateProgress` signatures.

### D3. Integration gbp-cache port — use branded types [S]

**Finding:** #100
**File:** `src/contexts/integration/application/ports/gbp-cache.repository.ts:15`

**Fix:** Replace raw `string` orgId/connectionId params with `OrganizationId` / `ConnectionId` branded types.

### D4. Integration gbp-import repository — consistent param order [S]

**Finding:** #101
**File:** `src/contexts/integration/infrastructure/repositories/gbp-import.repository.ts`

**Fix:** Standardize parameter ordering to match other repos: `(db, orgId, ...)`.

### D5. Identity adapter — accept DB parameter [S]

**Finding:** #102
**File:** `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:67`

**Fix:** Accept DB connection as parameter to factory function, matching standard adapter pattern.

### D6. Property findIdsByGoogleConnection — use constructor [S]

**Finding:** #166
**File:** `src/contexts/property/infrastructure/repositories/property.repository.ts:147`

**Fix:** Replace `as PropertyId` cast with `propertyId()` constructor.

### D7. Notification findPendingUrgent — add LIMIT [S]

**Finding:** #212
**File:** `src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:97-110`

**Fix:** Add `.limit(100)` to prevent unbounded result sets.

### D8. Metric duplicate VALID_METRIC_KEYS [S]

**Finding:** #172
**File:** `src/contexts/metric/domain/constructors.ts` and `metric.repository.ts`

**Fix:** Define `VALID_METRIC_KEYS` once in domain, import in repository.

### D9. Metric repository port — return typed data [S]

**Finding:** #215
**File:** `src/contexts/metric/application/ports/metric.repository.ts:45-53`

**Fix:** Define a `MetricAggregateRow` type instead of returning raw `Record<string, unknown>[]`.

---

## Stream E: Minor Architecture Cleanup [S]

**Findings:** #197, #217, #218

### E1. Goal build.ts side-effect wiring [S]

**Finding:** #197
**File:** `src/contexts/goal/build.ts:134-137`

**Fix:** Replace `Object.assign` mutation with explicit return of all handlers.

### E2. Notification resend adapter singleton [S]

**Finding:** #217
**File:** `src/contexts/notification/infrastructure/adapters/resend-email.adapter.ts:7-8`

**Fix:** Move module-level mutable state into factory closure.

### E3. Notification duplicate InsertNotificationInput [S]

**Finding:** #218
**File:** `src/contexts/notification/application/use-cases/insert-notification.ts:26`

**Fix:** Import type from domain or DTO instead of redefining.

---

## Verification

```bash
# Type safety
pnpm typecheck

# Lint (boundary rules will catch cross-context violations)
pnpm lint

# Verify D4 shape: all build.ts return { publicApi, internal }
grep -rn 'publicApi' src/contexts/*/build.ts
grep -rn 'internal' src/contexts/*/build.ts

# Verify no direct infra imports in composition
grep -rn 'infrastructure' src/composition.ts

# Tests
pnpm test
```
