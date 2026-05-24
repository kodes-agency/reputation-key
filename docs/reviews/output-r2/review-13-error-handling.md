# Review 13: Error Handling & Result Types (Re-audit R2)

**Date:** 2026-05-23  
**Scope:** All domain (`domain/`), application (`application/`), infrastructure (`infrastructure/`), and server (`server/`) layers across all bounded contexts in `src/contexts/`. Also `src/shared/`.  
**Branch:** `feat/phase-15c-goal-ui`

## Summary

Error handling follows the hexagonal architecture conventions closely. Domain errors use tagged shapes via `createErrorFactory`. Domain layer returns `Result<T, DomainError>` — never throws. Server functions use `throwContextError` / `catchUntagged` with exhaustive `match()` on error codes. However, there are several violations: `throw new Error()` in domain and application layers, missing `trace()` in domain exhaustive checks, and repository infrastructure using plain `throw new Error()` instead of tagged errors. Bare `catch {}` blocks exist in a few places but are legitimate (URL parsing, cursor deserialization).

## Findings

### 1. [MAJOR] `throw new Error()` in domain layer — exhaustive never checks

**File:** `src/contexts/goal/domain/constructors.ts` (line 140)  
**Quote:** `throw new Error(\`Unhandled goal type: ${\_exhaustive}\`)` 
**Rule:** Domain layer must never throw. "No throw in domain; return Result instead." (src/shared/domain/errors.ts line 12)  
**Fix:** These are exhaustive never-checks that should never execute. Return`err(goalError('invalid_type', ...))`instead, or use a helper that returns a`Result`.

**Also affects:**

- `src/contexts/goal/domain/progress-strategy.ts` (lines 125, 160) — same pattern
- `src/contexts/goal/domain/progress-strategy.ts` — `throw new Error('Unhandled goal type')` and `throw new Error('Unhandled aggregation')`

### 2. [MAJOR] `throw new Error()` in application use case layer

**File:** `src/contexts/goal/application/use-cases/create-goal.ts` (lines 193, 262)  
**Quote:** `throw new Error(\`Unexpected progress query error: ${progressQueryResult.error.tag}\`)` 
**Rule:** Application layer should throw *tagged* errors, not plain`Error`. Per conventions: "Throw tagged errors at the application boundary."  
**Fix:** Use `throw goalError('construction_error', '...')`or return`err(...)` from the use case. This is an internal invariant violation but should still use tagged errors for consistency.

### 3. [MINOR] `throw new Error()` in infrastructure repositories — untagged errors

**File:** `src/contexts/goal/infrastructure/repositories/goal.repository.ts` (lines 28, 109, 230, 252, 276, 296)  
**Quote:** `throw new Error('Goal insert failed — no row returned')`  
**Rule:** Infrastructure layer should "catch library errors, translate to tagged errors." These `throw new Error()` will be caught by `catchUntagged` at the server boundary and return a generic 500, but the error detail is lost for structured error handling.  
**Fix:** Throw tagged errors like `throw goalError('insert_failed', 'Goal insert failed — no row returned')` so the server layer can pattern-match and return appropriate status codes if needed.

**Also affects:**

- `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts` (lines 164, 189, 239)
- `src/contexts/inbox/infrastructure/repositories/inbox-note.repository.ts` (line 40)
- `src/contexts/review/infrastructure/repositories/review.repository.ts` (line 80)
- `src/contexts/review/infrastructure/repositories/reply.repository.ts` (line 97)
- `src/contexts/metric/infrastructure/repositories/metric.repository.ts` (lines 34, 47, 69)
- `src/contexts/portal/infrastructure/jobs/process-image.job.ts` (line 43)

### 4. [MINOR] `throw new Error()` in infrastructure mappers

**File:** `src/contexts/goal/infrastructure/mappers/goal.mapper.ts` (line 54)  
**Quote:** `throw new Error(\`Invalid ${label}: ${value}\`)` 
**Rule:** Mappers should translate DB rows to domain — invalid data should throw tagged errors.  
**Fix:** Use the context's tagged error factory:`throw goalError('invalid_data', \`Invalid ${label}: ${value}\`)`.

**Also affects:**

- `src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.ts` (line 26)

### 5. [MINOR] `throw new Error()` in build/composition functions

**File:** `src/contexts/review/build.ts` (lines 70, 87)  
**Quote:** `throw new Error('Job queue not available — Redis not configured')`  
**Rule:** Build functions are composition root — acceptable to throw during bootstrap, but should use tagged errors for consistency.  
**Fix:** Consider using a dedicated `ConfigurationError` tagged type or at minimum a descriptive error with a code field.

**Also affects:**

- `src/contexts/integration/build.ts` (line 120)

### 6. [MINOR] `throw new Error()` in integration adapters

**File:** `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts` (lines 11, 29)  
**Quote:** `throw new Error('ENCRYPTION_KEY must be 64 hex characters')` and `throw new Error('Invalid ciphertext format')`  
**Rule:** Infrastructure adapters should throw tagged errors for structured handling.  
**Fix:** Use `throw integrationError('encryption_error', '...')`.

### 7. [NIT] Error messages in infrastructure may leak DB details

**File:** `src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.ts` (line 26)  
**Quote:** `throw new Error(\`Invalid GBP cache entry from DB: ${result.error.message}\`)` 
**Rule:** Error messages should not leak internal details to clients. However, this is in infrastructure (not server boundary) so`catchUntagged`will sanitize at the boundary.  
**Fix:** Acceptable as-is since`catchUntagged` returns "Internal server error" to client. Low risk.

### 8. [NIT] `throw new Error()` in shared domain — `roles.ts` and `permissions.ts`

**File:** `src/shared/domain/roles.ts` (lines 38, 53)  
**Quote:** `throw new Error(\`Unknown better-auth role: ${betterAuthRole}\`)`  
**Rule:** These are exhaustive never-checks for switch statements — they should never execute at runtime. Acceptable as a defensive measure, but should ideally use a tagged error.  
**Fix:** Low priority — these indicate programmer errors (unhandled enum values).

**Also affects:**

- `src/shared/domain/permissions.ts` (line 72)

## Positive Observations

- **Consistent tagged error pattern**: Every context has a `domain/errors.ts` using `createErrorFactory` — `goalError`, `portalError`, `inboxError`, `teamError`, `staffError`, `integrationError`, `metricError`, `identityError`, `guestError`, `dashboardError`.
- **`isXxxError` type guards** used correctly in application and server layers.
- **Server boundary** consistently uses `match().exhaustive()` on error codes → HTTP status mapping.
- **`catchUntagged`** prevents raw errors (with stack traces, SQL queries) from leaking to clients — returns generic 500.
- **`throwContextError`** logs full error detail server-side but sends sanitized message to client.
- **No `catch { return null }` patterns** found — all error paths either throw or log and continue.
- **HTTP status codes** only in `server/` layer — no `status: 40x` found in domain or application layers.
- **Domain layer** correctly returns `Result<T, DomainError>` without throwing (except exhaustive never-checks).

## Final Severity Counts

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 0     |
| MAJOR     | 2     |
| MINOR     | 5     |
| NIT       | 2     |
| **Total** | **9** |
