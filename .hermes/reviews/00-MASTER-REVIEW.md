# Master Code Review — managua

**Date:** 2026-05-18
**Scope:** Full codebase — 602 .ts/.tsx files, ~51K lines
**Sections:** Shared Infrastructure · Identity · Property · Integration · Review · Portal · Guest · Team · Staff · Routes · Components
**Sub-reports:**

- [01-shared-infrastructure.md](./01-shared-infrastructure.md)
- [02-identity-property-integration-review.md](./02-identity-property-integration-review.md)
- [03-portal-guest-team-staff-routes-components.md](./03-portal-guest-team-staff-routes-components.md)

---

## Executive Summary

The codebase demonstrates strong architectural discipline. Hexagonal layers are clean, factory function pattern is consistent, tagged errors with `.exhaustive()` are everywhere, tenant isolation is structurally enforced via `baseWhere()`, branded IDs are used correctly, and `getLogger()` is universal. The convention adherence rate is high — roughly 90%+.

**However.** There are **5 critical issues** that need immediate attention, including a cross-tenant data leak, an open redirect, an unbounded memory leak, and an architecture-violating direct DB access in a server function. The GBP cache repository is the weakest link in the tenant isolation chain — missing `organizationId` in both reads and writes.

**Total findings: 48 across all sections.**

| Severity      | Count | Action Required               |
| ------------- | ----- | ----------------------------- |
| P0 (Critical) | 5     | Fix before next deploy        |
| P1 (High)     | 6     | Fix this sprint               |
| P2 (Warning)  | 16    | Backlog, fix within 2 sprints |
| P3 (Minor)    | 21    | Cleanup when convenient       |

---

## Critical Issues (P0) — Fix Before Next Deploy

### 🔴 C01 — GBP Cache upsert conflict target missing `organizationId`

**File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts:29-30`
**Impact:** Cross-tenant data corruption. If two tenants share a `propertyId` UUID (data migration, manual insert), upserts collide.

```
onConflictDoUpdate target: [propertyId, dataType]  ← MISSING organizationId
```

**Fix:** Add `organizationId` to conflict target AND the corresponding unique index in schema.

---

### 🔴 C02 — GBP Cache `findByPropertyAndType` has no tenant isolation

**File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts:13-21`
**Impact:** Cross-tenant read. Any caller who knows a `propertyId` can read another tenant's cached GBP data.

**Fix:** Add `organizationId` parameter and `eq(gbpCache.organizationId, orgId)` to WHERE clause.

---

### 🔴 C03 — Open redirect via click tracking

**File:** `src/contexts/guest/server/public.ts:191-235`
**Impact:** Any PropertyManager can insert `url: https://evil-phishing.com` into a portal link. The `/api/public/click/$linkId` endpoint 302-redirects guests to it with zero validation.

**Fix:** Validate URL scheme (`https://` only, reject `javascript:`, `data:`, `//`) at link creation time in the use case. Defense-in-depth: validate at redirect time too.

---

### 🔴 C04 — Tenant cache keyed on raw cookie header — unbounded memory leak + collision risk

**File:** `src/shared/auth/middleware.ts:19-34`
**Impact:** (1) `clearTenantCache()` only runs inside `tracedHandler()` — any unwrapped server fn leaks entries forever. (2) Two users with no cookies both get key `''` — second user gets first user's `AuthContext`. (3) No max-size eviction under high concurrency.

```ts
const tenantCache = new Map<string, { ctx: AuthContext; ts: number }>()
function tenantCacheKey(headers: Headers): string {
  return headers.get('cookie') ?? '' // collision on empty cookie
}
```

**Fix:** Add max-size eviction. Handle empty-cookie case (skip cache or use session ID). Ensure all server fns call `clearTenantCache()`.

---

### 🔴 C05 — `resolveLinkAndTrack` bypasses repository pattern — direct Drizzle in server fn

**File:** `src/contexts/guest/server/public.ts:196-210`
**Impact:** Architecture violation. Server function directly imports Drizzle ORM and portal schema for a JOIN query. This is NOT an OAuth callback or webhook — it must go through the use case / repository layer.

```ts
const { portalLinks, portals } = await import('#/shared/db/schema/portal.schema')
const { eq } = await import('drizzle-orm')
```

**Fix:** Create a `resolveLinkForClick` use case in the guest context that uses a port/interface.

---

## High Issues (P1) — Fix This Sprint

### P1-01 — GBP Cache `upsert` missing `updatedAt` in set clause

**File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts:29-37`
Convention #8 violated. Cache entry timestamps never update on conflict.

### P1-02 — `import-property.job.ts` — 191 LOC, cyclomatic ~15

**File:** `src/contexts/integration/infrastructure/jobs/import-property.job.ts`
Monolithic handler doing connection lookup, token refresh, API calls, property matching, creation, status updates, counters, events. Decompose into helper functions or extracted use cases.

### P1-03 — `mapGbpLocation` — cyclomatic ~21

**File:** `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts`
21 branches in one function. Break into focused per-field mappers.

### P1-04 — `updateOrganization` server fn contains business logic

**File:** `src/contexts/identity/server/organizations.ts:517-527`
Role check embedded directly in server function. Move authorization to a use case.

### P1-05 — `disconnectGoogleAccount` silently swallows revocation errors

**File:** `src/contexts/integration/application/use-cases/disconnect-google-account.ts:53-59`
Empty catch block. Add `logger.warn()` at minimum.

### P1-06 — QR code API has no authentication — portal ID enumeration + org slug leakage

**File:** `src/contexts/portal/server/portals.ts:244-290`, `src/routes/api/portals/$id/qr.ts`
Unauthenticated endpoint accepts internal IDs, leaks organization slugs, bypasses repository layer with direct `getContainer().db` query.

---

## Warnings (P2) — Fix Within 2 Sprints

| #   | ID    | File                                                        | Description                                                             |
| --- | ----- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | P2-01 | `shared/auth/auth-cli.ts`                                   | Bare `process.env` reads — violates convention                          |
| 2   | P2-02 | `shared/domain/roles.ts`                                    | `toDomainRole` silently defaults unknown to `Staff` — unintended access |
| 3   | P2-03 | `shared/auth/auth.functions.ts`                             | `ensureActiveOrg` blindly picks first org, never returns value          |
| 4   | P2-04 | `shared/testing/integration-helpers.ts`                     | SQL table name interpolation — injection template in tests              |
| 5   | P2-05 | `shared/auth/auth-client.ts`                                | Tab/space formatting inconsistency                                      |
| 6   | P2-06 | `shared/auth/permissions.ts`                                | Module-scope side effect `initPermissionTable()`                        |
| 7   | P2-07 | `shared/jobs/queue.ts`, `worker.ts`                         | Each `createJobQueue`/`createJobWorker` creates new Redis connection    |
| 8   | P2-08 | `identity/server/organizations.ts`                          | `signInUser` swallows all errors as "invalid credentials"               |
| 9   | P2-09 | `integration/use-cases/connect-google-account.ts`           | Select-then-write for existing connections (race window)                |
| 10  | P2-10 | `integration/use-cases/refresh-google-token.ts`             | 3 DB round-trips where 1 upsert+returning suffices                      |
| 11  | P2-11 | `review/use-cases/sync-reviews.ts`                          | Verify 429→`gbp_api_rate_limited` propagation through batch catch       |
| 12  | P2-12 | `integration/infra/repositories/gbp-cache.repository.ts`    | `deleteExpired` has no tenant filter — should be `deleteAllExpired`     |
| 13  | P2-13 | `identity/server/organizations.ts:574-645`                  | Upload server fns bypass container use cases, no error mapping          |
| 14  | P2-14 | `identity/server/organizations.ts:205-241`                  | `acceptInvitation`/`cancelInvitation` skip tenant validation            |
| 15  | P2-15 | `property/use-cases/create-property.ts:63-71`               | Event emit without `await` — may be lost on crash                       |
| 16  | P2-16 | `components/features/identity/profile-settings-form.tsx:76` | Direct `authClient.updateUser()` call — convention violation            |

---

## Minor (P3) — Cleanup When Convenient

| #     | Description                                                                 | File(s)                                                          |
| ----- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| P3-01 | `result.ts` uses tabs, rest of codebase uses spaces                         | `shared/domain/result.ts`                                        |
| P3-02 | `fallow-ignore-next-line` noise (22 occurrences)                            | `shared/events/events.ts`                                        |
| P3-03 | Rate limit `ttl()` race with `eval()` — separate network call               | `shared/rate-limit/middleware.ts`                                |
| P3-04 | Request ID truncated to 8 hex chars (32-bit, collision risk)                | `shared/observability/request-context.ts`                        |
| P3-05 | Test fixture defaults to `PropertyManager` role                             | `shared/testing/fixtures.ts`                                     |
| P3-06 | `ServerFunctionError` is the only class — convention violation or needs doc | `shared/auth/server-errors.ts`                                   |
| P3-07 | `Result` exported as value but re-exported as type-only                     | `shared/domain/result.ts` → `index.ts`                           |
| P3-08 | `fallow-ignore` comments in use case files                                  | `create-portal.ts`, `update-portal.ts`, `create-team.ts`         |
| P3-09 | Type aliases in server fn file instead of shared types                      | `identity/server/organizations.ts:56-92`                         |
| P3-10 | `SetValues` mutable type manually strips `readonly`                         | `property/infra/repositories/property.repository.ts`             |
| P3-11 | `extractOrgBillingFields` uses `as Record<string, unknown>` cast            | `identity/server/organizations.ts:99-116`                        |
| P3-12 | `dangerouslySetInnerHTML` in root layout — safe but needs comment           | `routes/__root.tsx:44`                                           |
| P3-13 | No `notFound()` for portal/team loaders                                     | Various portal/team routes                                       |
| P3-14 | `list`/`listByProperty` missing `trace()` wrapper                           | `portal/infra/repositories/portal.repository.ts`                 |
| P3-15 | `portal-link.repository.ts` exceeds 150-line limit (184 lines)              | `portal/infra/repositories/portal-link.repository.ts`            |
| P3-16 | `as unknown as string` brand coercion scattered in repos                    | portal, link, staff, team repos                                  |
| P3-17 | Guest `hasRated` TOCTOU race — needs UNIQUE constraint                      | `guest/use-cases/submit-rating.ts:30-37`                         |
| P3-18 | `getPortalForQR` uses `process.env` instead of `getEnv()`                   | `portal/server/portals.ts:271`                                   |
| P3-19 | Inline Zod schemas in 4 components                                          | profile-settings, assign-staff, create/edit-portal               |
| P3-20 | `people.tsx` route exceeds 150-line limit (342+ lines)                      | `routes/_authenticated/properties/$propertyId/people.tsx`        |
| P3-21 | `CopyButton` defined inline in route file                                   | `routes/_authenticated/properties/$propertyId/portals/index.tsx` |

---

## Security Summary

| Finding                                                           | Severity      | Status             |
| ----------------------------------------------------------------- | ------------- | ------------------ |
| Cross-tenant GBP cache read (no orgId filter)                     | **CRITICAL**  | 🔴 Must fix        |
| Cross-tenant GBP cache write (no orgId in conflict target)        | **CRITICAL**  | 🔴 Must fix        |
| Open redirect via click tracking                                  | **HIGH**      | 🔴 Must fix        |
| Unauthenticated QR endpoint (ID enumeration, slug leak)           | **MEDIUM**    | 🔴 Fix this sprint |
| Guest session ID never set as cookie (rate limit bypass)          | **LOW**       | 🟡 Fix soon        |
| Tenant cache collision on empty cookies                           | **MEDIUM**    | 🔴 Must fix        |
| Token encryption (AES-256-GCM)                                    | —             | ✅ Good            |
| JWT verification (issuer, audience, clock tolerance, JWKS TTL)    | —             | ✅ Good            |
| OAuth callback (HMAC state, timing-safe compare, freshness check) | —             | ✅ Excellent       |
| Webhook JWT verification                                          | —             | ✅ Good            |
| Error information leakage prevention                              | —             | ✅ Good            |
| Rate limiter fails open when Redis unavailable                    | —             | ✅ Documented      |
| No hardcoded secrets                                              | —             | ✅ Good            |
| SQL injection in test helpers (table name interpolation)          | **TEST-ONLY** | 🟡 Add warning     |

---

## Positive Findings — What's Done Right

1. **Hexagonal architecture is clean.** Layers are respected. Dependency arrows point inward. Cross-context communication via events and public APIs.
2. **Factory functions everywhere.** No classes (except the justified `ServerFunctionError`), no `this`, no `enum`. `(deps) => async (input, ctx) => Promise<T>` consistently.
3. **Tenant isolation is structural.** `baseWhere()` enforces `organizationId` at the type level. Property repo has runtime guard on insert. Review/reply repos are textbook.
4. **Tagged errors + `.exhaustive()`.** Every server fn error mapper uses ts-pattern exhaustiveness. New error codes = compiler errors at boundaries.
5. **Branded IDs.** Nominal typing everywhere. Unbranding only at Drizzle boundaries in mappers.
6. **Event-driven design.** Handlers isolated, idempotent, don't throw. Durable work → BullMQ jobs.
7. **Clock injection.** Testable time everywhere.
8. **Zod env validation.** Strong typing, regex checks, conditional requirements.
9. **BullMQ patterns.** `maxRetriesPerRequest: null`, dedicated connections, exponential backoff.
10. **Cross-context adapter wiring.** Integration context implements review's facade port. Review never sees access tokens.
11. **Reply mirroring.** `source='google_sync'` vs `source='internal'` properly distinguished.
12. **Test quality.** In-memory fakes for use cases, integration tests for repos, tenant isolation tests, exhaustive error code coverage, mapper round-trips.
13. **`getLogger()` universal.** Zero `console.*` calls in production code.
14. **OAuth callback security.** HMAC-SHA256 state, `timingSafeEqual`, 10-min freshness, hardcoded redirect base.
15. **Guest rate limiting.** Per-session with salted IP hashing and honeypot fields.

---

## Recommended Fix Order

### Sprint 1 (Critical — Before Next Deploy)

| Priority | Issue                                                                                            | Effort | Risk                      |
| -------- | ------------------------------------------------------------------------------------------------ | ------ | ------------------------- |
| 1        | C01 + C02: Add `organizationId` to GBP cache schema, repo queries, conflict target, unique index | S      | Cross-tenant data leak    |
| 2        | C03: URL validation in link creation use case + redirect-time defense                            | S      | Open redirect             |
| 3        | C04: Fix tenant cache (max-size, empty-cookie handling)                                          | S      | Memory leak + auth bypass |
| 4        | C05: Extract `resolveLinkAndTrack` to use case + repository                                      | M      | Architecture violation    |

### Sprint 1 (High — This Sprint)

| Priority | Issue                                                 | Effort |
| -------- | ----------------------------------------------------- | ------ |
| 5        | P1-01: Add `updatedAt` to GBP cache upsert set clause | XS     |
| 6        | P1-05: Add `logger.warn()` to revocation catch        | XS     |
| 7        | P1-06: QR endpoint auth or slug-based access          | S      |
| 8        | P1-04: Move role check from server fn to use case     | S      |

### Sprint 2 (Decomposition)

| Priority | Issue                                                                        | Effort |
| -------- | ---------------------------------------------------------------------------- | ------ |
| 9        | P1-02: Decompose `import-property.job.ts` (191 LOC → ~50 LOC main + helpers) | M      |
| 10       | P1-03: Decompose `mapGbpLocation` (cyclomatic 21 → ~5 per mapper)            | M      |

### Backlog (P2/P3)

Address P2 warnings in order of security relevance first (P2-02 role defaulting, P2-14 invitation tenant validation), then architectural consistency (P2-07 connection pooling, P2-15 event await), then cleanup.

---

## Methodology

- 3 parallel subagents, each reviewing a distinct architectural slice
- Subagent A: 71 files — shared infrastructure (auth, db, cache, jobs, observability, events, config, domain types, testing, root composition)
- Subagent B: ~50 files — identity, property, integration, review contexts (all layers)
- Subagent C: ~100+ files — portal, guest, team, staff contexts + all routes + all components
- Conventions checked against: CONTEXT.md, contexts/CONTEXT.md, shared/CONTEXT.md, routes/CONTEXT.md, components/CONTEXT.md
- Security scan: tenant isolation, injection, auth bypass, open redirect, information leakage, token handling
- ~170 files examined across all three reports

---

_Review complete. The slop count is lower than expected. Most issues are concentrated in the GBP cache repository and the guest click-tracking flow. The rest is solid engineering._
