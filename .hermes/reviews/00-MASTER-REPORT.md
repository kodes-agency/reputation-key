# GBP Import Feature — Master Review Report

> **Quality gate review** for the Google Business Profile property import feature.
> Reviews: `01-domain-application.md`, `02-infrastructure-server.md`, `03-frontend.md`

---

## Executive Summary

| Split                                 | Files  | Lines     | P0    | P1    | P2     | P3     |
| ------------------------------------- | ------ | --------- | ----- | ----- | ------ | ------ |
| Domain + Application + Build          | 30     | 1,462     | 0     | 1     | 5      | 3      |
| Infrastructure + Server + Shared Jobs | 22     | 2,083     | 3     | 5     | 7      | 6      |
| Frontend (Routes + Components)        | 20     | 1,066     | 0     | 3     | 9      | 5      |
| **Total**                             | **72** | **4,611** | **3** | **9** | **21** | **14** |

**Verdict:** 3 critical issues must be fixed before proceeding. The codebase architecture is strong — clean hexagonal boundaries, consistent error handling, proper tenant isolation, and good security posture (AES-256-GCM token encryption, HMAC-signed OAuth state). The critical issues are all dead code / error-handling gaps, not architectural flaws.

---

## Critical Issues (P0) — Must Fix

| #    | Area  | Issue                                                                                                                                                                                                | File                                              |
| ---- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| P0-1 | Infra | **Duplicate import-property handler** — `shared/jobs/handlers/import-property.ts` is a byte-for-byte copy of `infrastructure/jobs/import-property.job.ts`, never imported anywhere. Divergence risk. | `src/shared/jobs/handlers/import-property.ts`     |
| P0-2 | Infra | **OAuth adapter throws raw `Error`** — all 5 error paths throw untagged `new Error(...)` instead of `IntegrationError`. Server fns can't pattern-match → generic 500s.                               | `infrastructure/adapters/google-oauth.adapter.ts` |
| P0-3 | Infra | **Dead job handlers** — `syncGbpCacheHandler` and `purgeExpiredCacheHandler` are exported but never registered in bootstrap.                                                                         | `src/shared/jobs/handlers/sync-gbp-cache.ts`      |

---

## High Issues (P1) — Should Fix

| #    | Area     | Issue                                                              | File                              |
| ---- | -------- | ------------------------------------------------------------------ | --------------------------------- |
| P1-1 | Infra    | GBP API adapter mapping helpers throw raw `Error`                  | `gbp-api.adapter.ts`              |
| P1-2 | Infra    | sync-gbp-cache is a no-op stub (queries then discards)             | `sync-gbp-cache.ts`               |
| P1-3 | Infra    | Token encryption has no key-length validation                      | `token-encryption.adapter.ts`     |
| P1-4 | Infra    | `import-property.job.ts` is 207 lines (38% over limit)             | `import-property.job.ts`          |
| P1-5 | Infra    | `google-connection.repository.ts` is 187 lines (25% over)          | `google-connection.repository.ts` |
| P1-6 | Domain   | `GbpApiError` hybrid tagged-union + Error class breaks pure domain | `gbp-api-error.ts`                |
| P1-7 | Frontend | Domain import in route file (`$importId.tsx`)                      | `$importId.tsx`                   |
| P1-8 | Frontend | Unsafe `as unknown as` double cast in `index.tsx` loader           | `index.tsx`                       |
| P1-9 | Frontend | `import-connected-view.tsx` exceeds 150-line limit                 | `import-connected-view.tsx`       |

---

## Medium Issues (P2) — Nice to Fix

| #     | Area     | Issue                                                                                 |
| ----- | -------- | ------------------------------------------------------------------------------------- |
| P2-1  | Domain   | Email validation weak (`includes('@')`)                                               |
| P2-2  | Domain   | `GbpCacheEntry.payload` is `unknown` — no type safety                                 |
| P2-3  | Domain   | `connect-google-account` doesn't verify granted scopes match requested                |
| P2-4  | Domain   | `disconnect-google-account` silently succeeds on revocation failure (document intent) |
| P2-5  | Domain   | Queue fallback error message misleading after composition change                      |
| P2-6  | Infra    | `gbp-api.adapter.ts` 206 lines (over limit)                                           |
| P2-7  | Infra    | `google-connections.ts` 183 lines (over limit)                                        |
| P2-8  | Infra    | `batchGetReviews` returns `unknown` type                                              |
| P2-9  | Infra    | Queue factory passes shared Redis client                                              |
| P2-10 | Infra    | `getGoogleAuthUrl` doesn't use tenant context result                                  |
| P2-11 | Infra    | `health-check.job.ts` imports `pino` directly                                         |
| P2-12 | Infra    | `createJobQueue` type fragility                                                       |
| P2-13 | Frontend | Dead types in `import-types.ts`                                                       |
| P2-14 | Frontend | Missing `beforeLoad` auth guards on both routes                                       |
| P2-15 | Frontend | Unnecessary array spreads (2 instances)                                               |
| P2-16 | Frontend | Missing `useEffect` dependency in `$importId.tsx`                                     |
| P2-17 | Frontend | Duplicated connect-Google logic (inline vs component)                                 |
| P2-18 | Frontend | No loading state for initial import progress render                                   |
| P2-19 | Frontend | Error state not cleared on retry                                                      |
| P2-20 | Frontend | Shared types not `Readonly`                                                           |
| P2-21 | Frontend | Missing authorization guard (`beforeLoad`)                                            |

---

## Low Issues (P3) — Suggestions

| #     | Area     | Issue                                                     |
| ----- | -------- | --------------------------------------------------------- |
| P3-1  | Domain   | `constants.ts` has only one export                        |
| P3-2  | Domain   | Types re-export branded IDs redundantly                   |
| P3-3  | Domain   | DTO files could be consolidated                           |
| P3-4  | Infra    | Container singleton not thread-safe                       |
| P3-5  | Infra    | `getAuthUrlInputSchema` defined locally instead of in DTO |
| P3-6  | Infra    | Non-null assertion in `build.ts`                          |
| P3-7  | Infra    | `as` type assertions in GBP API mappers                   |
| P3-8  | Infra    | No rate-limiting on GBP API calls                         |
| P3-9  | Infra    | `fallow-ignore` comments may be unused                    |
| P3-10 | Frontend | Hardcoded UI strings (no i18n)                            |
| P3-11 | Frontend | Inline `import()` type syntax                             |
| P3-12 | Frontend | Missing aria attributes on empty/error states             |
| P3-13 | Frontend | Polling interval hardcoded                                |
| P3-14 | Frontend | Error div missing `role="alert"`                          |

---

## Top Positive Findings

1. **Hexagonal architecture is exemplary** — domain is pure, application throws tagged errors, infrastructure translates, server maps to HTTP
2. **Strong security** — AES-256-GCM token encryption, HMAC-signed OAuth state, no hardcoded secrets
3. **Proper multi-tenant isolation** — every repo query includes `organizationId`
4. **Clean frontend architecture** — zero `useQuery`/`useMutation` violations, server fns via `useServerFn` only
5. **Consistent UX** — loading/error/empty/disabled states across all components
6. **Robust import job handler** — handles race conditions (PG 23505), proper status transitions, outer try/catch guarantees final state
7. **No `console.*` anywhere** — all files use `getLogger()`
8. **No `class`, `this`, `enum` in domain/application** — functional style throughout

---

## Recommended Fix Priority

### Immediate (before proceeding)

1. Delete `src/shared/jobs/handlers/import-property.ts` (P0-1)
2. Fix `google-oauth.adapter.ts` to throw `integrationError()` instead of `new Error()` (P0-2)
3. Delete `src/shared/jobs/handlers/sync-gbp-cache.ts` (P0-3 + P1-2)

### Next sprint

4. Fix `gbp-api.adapter.ts` mapping helpers to throw domain errors (P1-1)
5. Add key-length validation to `token-encryption.adapter.ts` (P1-3)
6. Fix `GbpApiError` to be a pure tagged union or document the hybrid (P1-6)
7. Remove domain import from `$importId.tsx` route (P1-7)
8. Fix `as unknown as` double cast in `index.tsx` (P1-8)
9. Add `beforeLoad` auth guards to import routes (P2-14/21)

### Backlog

10. Refactor oversized files (P1-4, P1-5, P1-9, P2-6, P2-7)
11. Clean up dead types, unnecessary spreads, missing deps (P2 category)
12. Scope verification in OAuth connect use case (P2-3)

---

## Detailed Reports

- [01-domain-application.md](./01-domain-application.md) — Domain, Application, Build layers
- [02-infrastructure-server.md](./02-infrastructure-server.md) — Infrastructure, Server, Shared Jobs
- [03-frontend.md](./03-frontend.md) — Routes, Components, Hooks
