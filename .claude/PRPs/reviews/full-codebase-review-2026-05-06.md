# Comprehensive Codebase Review — 2026-05-06

**Branch:** `kodes-agency/gbp-import`
**Scope:** Full codebase — TypeScript, TanStack Start, DDD architecture, security, GBP import feature, component patterns
**Decision:** REQUEST CHANGES

---

## Executive Summary

The codebase demonstrates strong architectural discipline: DDD layers are clean, branded types are used consistently, immutability is enforced, and functional style is followed throughout. The TypeScript configuration is strict and well-tuned. However, there are **3 CRITICAL** and **11 HIGH** issues that must be addressed before production, primarily around missing dependencies, security gaps, and a non-functional job registration.

---

## CRITICAL Issues (3)

### C1. Missing `@tanstack/react-query` Dependency

**Files:** `src/routes/_authenticated/properties/import/index.tsx`, `import-connected-view.tsx`, `$importId.tsx`
**Issue:** Code imports `useQuery`/`useMutation` from `@tanstack/react-query` with `@ts-expect-error` suppressions, but the package is not in `dependencies`. Runtime failure on import pages.
**Fix:** Add `@tanstack/react-query` to dependencies or refactor to use TanStack Router's loader pattern.

### C2. Missing Job Handler Registration

**File:** `src/bootstrap.ts`
**Issue:** `import-property` and `sync-gbp-cache` handlers exist but are **never registered** in the job registry. GBP imports will be enqueued but never processed — silent failure.
**Fix:** Register handlers in `bootstrap()`:

```typescript
container.jobRegistry.register('import-property', importPropertyHandler)
container.jobRegistry.register('sync-gbp-cache', syncGbpCacheHandler)
container.jobRegistry.register('purge-expired-cache', purgeExpiredCacheHandler)
```

### C3. No Rate Limiting on OAuth Endpoints

**File:** `src/routes/api/auth/google/callback.ts`
**Issue:** OAuth callback has no rate limiting. Vulnerable to brute-force authorization code attacks, state parameter flooding, and token refresh abuse.
**Fix:** Apply rate limiting middleware to all `/api/auth/google/*` routes.

---

## HIGH Issues (11)

### H1. Use Cases Throw Instead of Returning Result

**Files:** All use cases in `src/contexts/integration/application/use-cases/`
**Issue:** Use cases `throw integrationError(...)` instead of returning `err(integrationError(...))` via neverthrow. Violates the documented Result pattern and makes error handling inconsistent.
**Fix:** Replace all `throw` with `return err(...)` and adjust return types to `Promise<Result<T, IntegrationError>>`.

### H2. Unsafe Type Casts in GBP API Adapter

**File:** `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts:103-137`
**Issue:** `mapGbpLocation` uses multiple `as` casts on untrusted Google API response data with no runtime validation.
**Fix:** Add a Zod schema to validate the Google API response shape before mapping.

### H3. Mutable Array Pattern in GBP API Adapter

**File:** `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts:15,36`
**Issue:** Uses `allLocations.push(...)` — mutable array accumulation violating immutability principles.
**Fix:** Use `concat` or spread pattern for immutable accumulation.

### H4. Missing HTTP Security Headers

**Files:** All API routes
**Issue:** No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, or `Strict-Transport-Security` headers.
**Fix:** Add middleware to set security headers on all responses.

### H5. OAuth State Parameter Not Cryptographically Validated

**File:** `src/routes/api/auth/google/callback.ts:34-50`
**Issue:** State is parsed but not signed/verified. An attacker who knows the format can forge OAuth flows.
**Fix:** Use signed JWT or HMAC for state parameter; verify signature before processing.

### H6. Token Encryption Key Not Validated at Startup

**File:** `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts:10-11`
**Issue:** If `ENCRYPTION_KEY` is missing or malformed, runtime errors occur. Should fail fast at startup.
**Fix:** Validate key format (64 hex chars for AES-256) in `getEnv()` or adapter factory.

### H7. `console.error` Leaking OAuth Details

**File:** `src/routes/api/auth/google/callback.ts:82`
**Issue:** `console.error('[google-callback] Connection failed:', e)` may expose sensitive OAuth response data.
**Fix:** Replace with structured logger that sanitizes sensitive data.

### H8. Race Condition in Import Handler

**File:** `src/shared/jobs/handlers/import-property.ts:38-66`
**Issue:** Duplicate check + insert is not atomic. The `23505` catch is a band-aid, not proper idempotency.
**Fix:** Remove explicit duplicate check, rely on unique constraint + catch for idempotency.

### H9. Missing Error Boundary in sync-gbp-cache Handler

**File:** `src/shared/jobs/handlers/sync-gbp-cache.ts:14-39`
**Issue:** No try-catch around DB queries. If the query fails, error propagates unhandled.
**Fix:** Wrap in try-catch with proper logging and re-throw for BullMQ retry.

### H10. Non-Existent Route References

**Files:** `src/components/layout/manager-sidebar.tsx:147`, `src/routes/_authenticated/dashboard.tsx:43,66`
**Issue:** References to `/properties/new` route that doesn't exist in the generated route tree (TS2820 errors).
**Fix:** Create the route or update references to point to the import flow (`/properties/import`).

### H11. Direct `process.env` Usage

**File:** `src/routes/api/portals/$id/qr.ts:22`
**Issue:** `process.env.BETTER_AUTH_URL` used directly instead of `getEnv()`.
**Fix:** Use `getEnv()` for consistent validation.

---

## MEDIUM Issues (18)

### Architecture & Patterns

| #   | Issue                                                                           | File(s)                                                               |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| M1  | String types instead of branded IDs in shared domain                            | `src/shared/domain/integration.ts`                                    |
| M2  | Architectural boundary violation — queue port imports from shared/jobs/handlers | `src/contexts/integration/application/ports/gbp-queue.port.ts:5`      |
| M3  | Duplicate `TOKEN_EXPIRY_BUFFER_MS` constant across use cases                    | `refresh-google-token.ts`, `list-gbp-locations.ts`                    |
| M4  | Inefficient DB queries in import handler (N updates per N inserts)              | `src/shared/jobs/handlers/import-property.ts:82-93`                   |
| M5  | Missing transaction in import handler                                           | `src/shared/jobs/handlers/import-property.ts`                         |
| M6  | Unnecessary DB read at end of import (counts tracked in memory)                 | `src/shared/jobs/handlers/import-property.ts:125-145`                 |
| M7  | Missing pagination limit in listLocations (no max pages cap)                    | `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts` |
| M8  | Missing rate limiting on GBP API calls                                          | `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts` |

### Security

| #   | Issue                                                  | File(s)                                                                        |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| M9  | Missing CSRF protection on state-changing endpoints    | All POST endpoints                                                             |
| M10 | OAuth error responses may leak internal Google details | `google-oauth.adapter.ts:57-59, 115-117`                                       |
| M11 | Session cookie security flags not explicitly set       | `src/shared/auth/auth.ts:73-79`                                                |
| M12 | Race condition in token refresh (no distributed lock)  | `src/contexts/integration/application/use-cases/refresh-google-token.ts:59-76` |

### Code Quality

| #   | Issue                                                           | File(s)                                                    |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| M13 | `console.warn`/`console.log` in job handlers                    | `src/shared/jobs/handlers/sync-gbp-cache.ts:36,51`         |
| M14 | Unused `@ts-expect-error` directive                             | `src/routes/_authenticated/properties/index.tsx:30`        |
| M15 | `useSearch({ strict: false })` — should define `validateSearch` | `src/routes/_authenticated/properties/import/index.tsx:17` |

### Components

| #   | Issue                                           | File(s)                                                            |
| --- | ----------------------------------------------- | ------------------------------------------------------------------ |
| M16 | Props interfaces not using `Readonly<>` wrapper | All integration components                                         |
| M17 | Missing ARIA labels on interactive elements     | Integration components                                             |
| M18 | `any` type in feedback-form                     | `src/components/features/guest/public-portal/feedback-form.tsx:28` |

---

## LOW Issues (9)

| #   | Issue                                                   | File(s)                                         |
| --- | ------------------------------------------------------- | ----------------------------------------------- |
| L1  | Inconsistent naming: `connectedAt` vs `createdAt`       | `src/shared/domain/integration.ts:18`           |
| L2  | Multiple `@ts-expect-error` suppressions in route files | `src/routes/_authenticated/properties/import/`  |
| L3  | Missing JSDoc on public port methods                    | Port files                                      |
| L4  | Silent token revocation failure in disconnect flow      | `disconnect-google-account.ts:53-59`            |
| L5  | Magic string in build.ts error message                  | `src/contexts/integration/build.ts:57-59`       |
| L6  | `dangerouslySetInnerHTML` for theme script              | `src/routes/__root.tsx:44`                      |
| L7  | Guest session cookie not HttpOnly                       | `src/routes/p/$propertySlug/$portalSlug.tsx:69` |
| L8  | Unused `_accountName` parameter in GBP API adapter      | `gbp-api.adapter.ts:44-46`                      |
| L9  | Dependency vulnerabilities (esbuild, ip-address)        | `npm audit`                                     |

---

## Validation Results

| Check                                 | Result                                  |
| ------------------------------------- | --------------------------------------- |
| TypeScript strict mode                | Pass (config is excellent)              |
| DDD layer compliance                  | **Pass** — all layers clean             |
| Functional style (no class/this/enum) | **Pass**                                |
| Branded types                         | **Pass** — consistently used            |
| verbatimModuleSyntax                  | **Pass** — `import type` used correctly |
| No `any` in domain/application        | **Pass** (1 instance in component)      |
| TanStack Router setup                 | **Pass** (with caveats above)           |
| TanStack Form patterns                | **Pass**                                |
| Drizzle SQL injection                 | **Pass** — parameterized queries only   |
| Build                                 | **Fail** — existing TS errors           |

---

## Strengths

1. **DDD architecture is clean** — domain is pure, dependency direction is correct, cross-context boundaries respected
2. **TypeScript discipline** — strict mode, branded IDs, `Readonly<>` everywhere, no `any` in domain/application
3. **Functional style** — no classes, no mutation in domain, factory functions, neverthrow Results
4. **Token encryption** — AES-256-GCM at rest, env-based keys
5. **Structured observability** — tracedHandler, correlation IDs, pino logger
6. **Tenant isolation** — `baseWhere()` in all repositories
7. **Form patterns** — TanStack Form + Zod v4 + useServerFn consistently
8. **Component organization** — clear hierarchy, proper mutation hooks, no direct server calls

---

## Recommended Action Plan

### Immediate (block merge)

1. Register GBP import job handlers in `bootstrap.ts` (C2)
2. Add `@tanstack/react-query` to dependencies or refactor import pages (C1)
3. Add rate limiting to OAuth endpoints (C3)
4. Convert use case `throw` to `return err()` (H1)
5. Fix non-existent route references (H10)

### Before Production

6. Add Zod validation to GBP API adapter response parsing (H2)
7. Add HTTP security headers middleware (H4)
8. Sign and validate OAuth state parameter (H5)
9. Validate encryption key at startup (H6)
10. Replace console.error/log with structured logger (H7, M13)
11. Add error boundary to sync-gbp-cache handler (H9)
12. Add transaction to import handler (M5)

### Short-term

13. Address remaining MEDIUM issues (branded IDs, CSRF, ARIA, Readonly props)
14. Fix TypeScript build errors
15. Run `npm audit fix` for dependency vulnerabilities
