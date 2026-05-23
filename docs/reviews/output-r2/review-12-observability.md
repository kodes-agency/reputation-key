# Review 12: Observability — Tracing, Logging, Metrics (Re-audit R2)

**Date:** 2026-05-23  
**Scope:** All server functions (`src/contexts/*/server/`), adapters (`infrastructure/adapters/`), background jobs (`infrastructure/jobs/`), event handlers (`infrastructure/event-handlers/`), shared observability code (`src/shared/observability/`).  
**Branch:** `feat/phase-15c-goal-ui`

## Summary

Observability infrastructure is mature and consistently applied. Server functions are universally wrapped in `tracedHandler`. Event handlers and background jobs use `trace()` spans. The logger (pino) is used with structured fields throughout. No `console.log` calls exist anywhere in `src/`. No PII/secrets are logged. A few metric event handlers lack `trace()` wrappers, and a few bare `catch {}` blocks exist in domain/server code. Overall the codebase is well-instrumented.

## Findings

### 1. [MINOR] Metric event handlers missing `trace()` spans

**File:** `src/contexts/metric/infrastructure/event-handlers/on-scan-recorded.ts`  
**Quote:** `export const onScanRecorded = (deps) => async (event) => { try { ... } catch (err) { ... } }`  
**Rule:** Event handlers should have root trace spans for observability.  
**Fix:** Wrap handler body in `return trace('metric.onScanRecorded', async () => { ... })` like inbox and review handlers do.

**Also affects:**

- `src/contexts/metric/infrastructure/event-handlers/on-rating-submitted.ts`
- `src/contexts/metric/infrastructure/event-handlers/on-feedback-submitted.ts`
- `src/contexts/metric/infrastructure/event-handlers/on-review-created.ts`
- `src/contexts/metric/infrastructure/event-handlers/on-review-link-clicked.ts`

### 2. [MINOR] Goal event handlers `on-portal-deleted`, `on-team-deleted`, `on-staff-unassigned` missing `trace()` spans

**File:** `src/contexts/goal/infrastructure/event-handlers/on-portal-deleted.ts`  
**Quote:** `export const onPortalDeleted = (deps) => async (event) => { const goals = await deps.goalRepo.list({ ... }) ... }`  
**Rule:** Event handlers should have root trace spans. `on-metric-recorded` correctly uses `trace()`.  
**Fix:** Wrap handler body in `return trace('goal.onPortalDeleted', async () => { ... })`.

**Also affects:**

- `src/contexts/goal/infrastructure/event-handlers/on-team-deleted.ts`
- `src/contexts/goal/infrastructure/event-handlers/on-staff-unassigned.ts`

### 3. [NIT] Bare `catch {}` in domain `validateUrl` and `isValidExternalUrl`

**File:** `src/contexts/portal/domain/rules.ts` (lines 99, 109)  
**Quote:** `} catch { return err(portalError(...)) }` and `} catch { return false }`  
**Rule:** Domain layer should have no bare catches without at least binding the error. These are legitimate URL-parsing catch blocks where the error value is intentionally discarded, but they should bind `(_e)` for clarity.  
**Fix:** Change to `} catch (_e) {` to make intent explicit.

### 4. [NIT] Bare `catch {}` in inbox server function cursor parsing

**File:** `src/contexts/inbox/server/inbox.ts` (line 77)  
**Quote:** `} catch { return undefined // ignore malformed cursor }`  
**Rule:** Catch blocks should bind the error variable even when discarding.  
**Fix:** Change to `} catch (_e) {` for explicitness.

### 5. [NIT] Bare `catch {}` in shared infrastructure

**File:** `src/shared/observability/logger.ts` (line 12)  
**Quote:** `} catch { return false }` — checking `require.resolve('pino-pretty')`  
**Rule:** Acceptable in bootstrap/infrastructure code where the caught exception is `MODULE_NOT_FOUND`, but should bind `(_e)` for clarity.

**Also affects:**

- `src/shared/domain/timezones.ts` (line 79) — timezone parsing
- `src/shared/rate-limit/middleware.ts` (line 83) — rate limit fallback
- `src/shared/auth/auth.ts` (line 166) — auth plugin catch
- `src/routes/api/auth/google/callback.ts` (line 48) — OAuth callback

### 6. [NIT] Non-null assertions on `jobQueue` in build functions

**File:** `src/contexts/review/build.ts` (lines 60, 77)  
**Quote:** `await input.jobQueue!.add(...)`  
**Rule:** Non-null assertions are a code smell. The code is guarded by a ternary that checks `input.jobQueue` truthiness, so the `!` is technically safe but unnecessary — the reference is already in scope.  
**Fix:** Capture `input.jobQueue` in a local `const queue = input.jobQueue` inside the truthy branch and use `queue.add(...)` without `!`.

**Also affects:**

- `src/contexts/integration/build.ts` (line 111)

## Positive Observations

- **All 60+ server functions** consistently use `tracedHandler` — no exceptions found.
- **All infrastructure repositories** use `trace()` spans (goal, property, portal, inbox, metric, etc.).
- **All review/integration background jobs** use `trace()` spans.
- **Inbox event handlers** (`on-review-created`, `on-reply-published`, `on-feedback-submitted`, `on-review-updated`) all use `trace()` spans.
- **Zero `console.log` calls** anywhere in `src/` — pino logger used exclusively.
- **No PII/secrets in logs** — no tokens, emails, or reviewer names found in any `logger.*()` call. IDs are logged (goalId, propertyId, etc.) which is appropriate.
- **Structured fields** used consistently — `logger.info({ key: value }, 'message')` pattern followed everywhere.
- **External calls** (Google OAuth, GBP API, S3) wrapped in `trace()` spans in adapters and repositories.
- **`catchUntagged`** provides a safety net at the server boundary for untagged errors.

## Final Severity Counts

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 0     |
| MAJOR     | 0     |
| MINOR     | 2     |
| NIT       | 4     |
| **Total** | **6** |
