# Deep Review #1 — Architecture & Layering Fix Plan

## Scope
Fix all findings from the Architecture & Layering review (5 BLOCKER, 4 MAJOR, 2 MINOR, 2 NIT).

## Tasks

### B1: Route imports dashboard domain types
- **File:** `src/routes/_authenticated/properties/$propertyId/index.tsx:14`
- **Fix:** Export `KPIValue`, `RecentReview`, `DashboardReplyStatus` from `dashboard/application/public-api.ts` (or create a dashboard DTO). Update the route import.
- **Also check:** Any other routes importing from `dashboard/domain/`.

### B2: Route imports inbox port type directly
- **File:** `src/routes/_authenticated/inbox/index.tsx:24`
- **Fix:** Export `Cursor` from `inbox/application/public-api.ts`. Update the route import.

### B3: Integration infra imports normalizeSlug from property/domain
- **File:** `src/contexts/integration/infrastructure/jobs/import-property.job.ts:12`
- **Fix:** Move `normalizeSlug` to `shared/domain/utils/slug.ts` (it's a pure string utility). Update all consumers.

### B4: Integration infra imports propertyCreated event constructor
- **File:** `src/contexts/integration/infrastructure/jobs/import-property.job.ts:13`
- **Fix:** This is part of the larger job refactor (MAJOR-2). The job should call a use case that handles event emission internally.

### B5: Google adapter imports review domain types
- **File:** `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts:6-7`
- **Fix:** Re-export `GoogleReview` from `review/application/public-api.ts`. For `StarRating`, either re-export from there too or move to `shared/domain/` (it's a generic 1-5 union). Update adapter imports.

### B6: Webhook route does raw SQL + container access
- **File:** `src/routes/api/webhooks/gbp/notifications.ts`
- **Fix:** Create a server function in integration context (`handleGbpNotification`) that encapsulates:
  1. JWT verification (already in route)
  2. Property lookup by GBP place ID (via use case / repo)
  3. Queue job for review sync (via port / service)
  The route becomes a thin handler calling the server function.

### M1: Dashboard domain throws Error
- **File:** `src/contexts/dashboard/domain/types.ts:75-80`
- **Fix:** Change `toDashboardReplyStatus` to return a Result type, or move it to the infrastructure mapper where SQL results are decoded.

### M2: Import-property job has business logic
- **File:** `src/contexts/integration/infrastructure/jobs/import-property.job.ts`
- **Fix:** Extract `ImportPropertyUseCase` in `integration/application/use-cases/`. The job becomes a thin handler calling the use case. This also addresses B3 and B4 since the use case can import domain rules through proper channels.

### M3: Identity use cases import portal port directly
- **Files:** `identity/application/use-cases/finalize-avatar-upload.ts`, `request-avatar-upload.ts`, `request-org-logo-upload.ts`, `finalize-org-logo-upload.ts`
- **Fix:** Export `StoragePort` from `portal/application/public-api.ts`. Update identity imports.

### M4: Guest use case imports portal port directly
- **File:** `src/contexts/guest/application/use-cases/resolve-link-and-track.ts:4`
- **Fix:** Export `LinkResolverPort` from `portal/application/public-api.ts`. Update guest imports.

### m1: Server re-exports domain constant
- **File:** `src/contexts/review/server/reply.ts:15,17`
- **Fix:** Remove re-export. Components should import `MAX_REPLY_LENGTH` from `review/domain/rules` or get it from a DTO schema's `.max` property.

### m2: Webhook route accesses container.jobQueue
- **File:** `src/routes/api/webhooks/gbp/notifications.ts:93-112`
- **Fix:** Covered by B6 refactor. The server function will use an injected port for job queuing.

## Execution Order

1. **B6** (webhook refactor) — most impactful, independent
2. **M2** (import-property job refactor) — large, also resolves B3/B4
3. **B5** (google adapter types) — quick re-export
4. **B1** (dashboard types) — quick re-export
5. **B2** (inbox cursor) — quick re-export
6. **M3** (identity → portal port) — quick re-export
7. **M4** (guest → portal port) — quick re-export
8. **M1** (dashboard throw) — quick fix
9. **m1** (reply re-export) — quick fix
10. **Verify** — `npx tsc --noEmit`
