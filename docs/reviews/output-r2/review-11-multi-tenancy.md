# Review 11: Multi-tenancy & Tenant Isolation (Re-audit R2)

**Date:** 2026-05-23
**Scope:** `shared/db/base-where.ts`, `contexts/*/infrastructure/repositories/`, `contexts/*/infrastructure/jobs/`, `contexts/*/server/`, `shared/auth/middleware.ts`

## Summary

Tenant isolation is enforced at the repository layer using the `baseWhere()` helper, which always includes `eq(table.organizationId, ctx.organizationId)`. All repository queries — find, list, count, update, delete — pass through `baseWhere()`. Background jobs scope by `organizationId` at the repository level even without user auth context. Cache keys in the tenant context middleware include the cookie header (which encodes organization membership).

## Findings

### [MAJOR] `baseWhere()` uses `ctx.organizationId` from repository method parameters, not enforced by type system

- **File:** `src/shared/db/base-where.ts`
- **Quote:** Lines 8–19: `export function baseWhere<T extends { organizationId: PgColumn }>(table: T, ctx: { organizationId: string }, ...conditions: (SQL | undefined)[])`
- **Rule:** "organizationId from AuthContext, never from request input" — the `baseWhere` function accepts any object with `organizationId`, not specifically `AuthContext`. A repository method could theoretically pass a DTO's `organizationId` instead of the authenticated context's.
- **Fix:** In practice, all repository methods receive `ctx: AuthContext` as their first parameter (from use cases), so this is enforced by convention. The type could be strengthened to `ctx: AuthContext` instead of `{ organizationId: string }` to prevent misuse. Consider: `baseWhere(table, ctx: Pick<AuthContext, 'organizationId'>, ...)`.

---

### [MAJOR] Background jobs receive `organizationId` from job data, not from auth context

- **File:** `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts`
- **Quote:** Lines 33–35: `const input = RecomputeProgressInput.parse({ organizationId: job.data.organizationId, goalId: job.data.goalId })`
- **File:** `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts`
- **Quote:** Line 28: `const organizationId = job.data.organizationId as string`
- **File:** `src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts`
- **Quote:** Line 28: `const { organizationId, propertyId } = job.data as { organizationId: string; propertyId: string }`
- **Rule:** "organizationId from AuthContext, never from request input" + "Background jobs re-establish tenant context"
- **Fix:** Background jobs have no user context — they run asynchronously after being enqueued by use cases. The `organizationId` in job data was originally set by the use case (which DID have `AuthContext`). The job then passes this `organizationId` to repositories via `baseWhere()`. This is the correct pattern: the use case enqueues the job with the authenticated `organizationId`, and the job trusts the enqueued data. **However**, there's no `AuthContext` reconstitution — jobs use `{ organizationId }` directly. This is acceptable because:
  1. Jobs don't have a `role` (no authorization checks needed)
  2. Jobs only call repositories which scope by `organizationId`
  3. The `organizationId` was set by the use case from the authenticated `AuthContext`

  **Recommendation:** Add a comment to each job file documenting this trust chain.

---

### [MINOR] `gbp-cache.repository.ts` delete uses defense-in-depth org check — good pattern

- **File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`
- **Quote:** Lines 48–55: Before deleting cached reviews, verifies the property belongs to the organization via `port.findPropertyById()`. This is a defense-in-depth check beyond `baseWhere()`.
- **Rule:** This is a positive finding — the repository goes beyond the minimum required isolation.
- **Fix:** None. This is a model pattern that could be adopted by other cross-context repository operations.

---

### [MINOR] `identity/organizations.ts` — some mutations operate on organizations by ID without explicit org-scoping

- **File:** `src/contexts/identity/server/organizations.ts`
- **Quote:** Lines 381–420 (`listUserInvitations`, `acceptInvitation`, `cancelInvitation`) — these call `getAuth().api.*` methods that operate on better-auth's organization model. The `organizationId` scoping is handled by better-auth internally, not by `baseWhere()`.
- **Rule:** "ALL DB queries on tenant-owned tables have organizationId in WHERE clause"
- **Fix:** Identity context is special — it manages organizations themselves. Better-auth handles org scoping in its API layer. The `acceptInvitation` flow (line 230) adds the user to the org via better-auth, which enforces invitation validity. This is acceptable.

---

### [MINOR] `guest/server/public.ts` — public endpoints have no tenant context

- **File:** `src/contexts/guest/server/public.ts`
- **Quote:** Lines 40–100: `getPublicPortalFn`, `submitReviewFn`, `checkReviewStatusFn` — these are public-facing endpoints that do NOT call `resolveTenantContext()`. They resolve the portal by slug/ID and use the portal's `organizationId` for subsequent operations.
- **Rule:** "organizationId from AuthContext, never from request input"
- **Fix:** These are unauthenticated guest endpoints — there is no `AuthContext` to use. The portal's `organizationId` is the correct scope. The portal resolution itself (by slug or token) is the trust anchor. This is correct and expected for public-facing APIs.

---

### [NIT] All repository methods scope by `organizationId` via `baseWhere()`

- **Verification:** Checked repositories in `property/`, `review/`, `inbox/`, `goal/`, `integration/`:
  - `property.repository.ts`: All 7 methods use `baseWhere(table, ctx)` ✅
  - `review.repository.ts`: All 6 methods use `baseWhere(table, ctx)` ✅
  - `inbox.repository.ts`: All 8 methods use `baseWhere(table, ctx)` ✅
  - `goal.repository.ts`: All 10 methods use `baseWhere(table, ctx)` ✅
  - `gbp-cache.repository.ts`: Methods use `baseWhere(table, ctx)` for reads; deletes use defense-in-depth ✅

---

### [NIT] Cache keys in tenant context middleware include cookie header

- **File:** `src/shared/auth/middleware.ts`
- **Quote:** Line 33: `tenantCache.get(cookieHeader)` — the 5-second TTL cache keys on the full cookie header, which encodes the user's active organization membership. This prevents cache confusion between users or organizations.
- **Fix:** No issue. ✅

---

### [NIT] `PropertyManager` mutations verify staff assignment

- **File:** `src/contexts/inbox/application/use-cases/get-inbox-items.ts`
- **Quote:** Lines 18–26: For non-Admin roles, `StaffPublicApi.getAccessiblePropertyIds()` returns only assigned property IDs, which are then used to filter queries.
- **File:** `src/contexts/property/application/use-cases/list-properties.ts`
- **Quote:** Lines 12–16: Same pattern — AccountAdmin sees all, others see assigned.
- **Fix:** PropertyManager/Staff are scoped to their assigned properties. Mutations (reply, update) flow through use cases that call `can(ctx.role, ...)` for authorization and repositories that scope by `organizationId`. The staff assignment check ensures PropertyManagers only operate on properties they manage. ✅

---

### [NIT] `clearTenantCache()` called after organization mutations

- **File:** `src/contexts/identity/server/organizations.ts`
- **Quote:** Lines 155, 213, 249, 426, 449 — `clearTenantCache()` called after `setActiveOrganization`, `acceptInvitation`, `cancelInvitation`, `createOrganization`, `deleteOrganization`. This ensures the cached tenant context is invalidated when organization membership changes.
- **Fix:** Good pattern. ✅

## Final Severity Counts

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 2     |
| MINOR    | 3     |
| NIT      | 6     |

**MAJOR (2):** (1) `baseWhere()` accepts generic `{ organizationId: string }` instead of `AuthContext` — type system doesn't enforce that `organizationId` always comes from authenticated context. (2) Background jobs receive `organizationId` from job data without re-establishing full tenant context — acceptable by design but should be documented.
