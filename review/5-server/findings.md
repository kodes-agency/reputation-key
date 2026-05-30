# Section 5 — Server Functions Findings

**Date:** 2026-05-29
**Scope:** All `src/contexts/*/server/` directories
**Baseline:** All server function tests pass. 17/17 server files use `tracedHandler`.

---

## Summary

| Severity | Count |
|----------|-------|
| MAJOR | 0 |
| MINOR | 2 |
| NIT | 1 |
| **Total** | **3** |

---

## MINOR Findings

### S5-1 MINOR: `catchUntagged` used in only 3 of 17 server function files

**Files using catchUntagged:**
- `src/contexts/dashboard/server/dashboard.ts`
- `src/contexts/dashboard/server/portal-analytics.ts`
- `src/contexts/portal/server/portal-groups.ts`

**Files NOT using catchUntagged:** All 14 other server function files.

**Category:** pattern-consistency
**Tag:** [code-fix] (optional)

**What:** `src/contexts/CONTEXT.md:114` says: "**`catchUntagged`** — wrap untagged errors (DB, network) that would otherwise be swallowed raw." Only 3 server files use this pattern. The other 14 use try/catch with tagged error checks (`if (isXxxError(e))`), which still propagates untagged errors — just doesn't wrap them in a friendly message.

**Why it matters:** Untagged errors from DB/network failures propagate as raw `Error` objects with cryptic messages (e.g., "Connection refused", "deadlock detected") instead of user-friendly HTTP errors. The server function pattern should consistently wrap these.

**DOCS SAY:** Use `catchUntagged` to wrap untagged errors.
**CODE DOES:** 14 files skip `catchUntagged`, relying on `try/catch` + `isXxxError()` which propagates untagged errors raw.

**Fix direction:** Add `catchUntagged` wrapping to all server function files for consistent error handling, or update CONTEXT.md to say `catchUntagged` is recommended but not mandatory when tagged error handling is already in place.

---

### S5-2 MINOR: `integration/server/shared.ts` — not a server function but lives in server/

**File:** `src/contexts/integration/server/shared.ts`
**Category:** slop / file-organization
**Tag:** [code-fix]

**What:** This file exports an `integrationErrorStatus` helper function — pure error-to-HTTP-status mapping. It's not a server function (no `createServerFn`, no `tracedHandler`). It lives in `server/` alongside actual server functions because it's consumed by them.

**Why it matters:** Shared server helpers shouldn't live in the server directory with actual server functions — it blurs the boundary between "HTTP entry point" and "shared utility." If this pattern spreads, server/ becomes a dumping ground.

**Fix direction:** Move to `src/contexts/integration/server/helpers.ts` or `src/contexts/integration/server-error-mapping.ts` to clearly distinguish from server functions. Consider creating a shared `error-status-mapping.ts` in `src/shared/auth/` since multiple contexts have similar patterns (inbox, integration, etc.).

---

## NIT Findings

### S5-3 NIT: Error-to-HTTP mapping duplicated across contexts

**Files:**
- `src/contexts/inbox/server/inbox.ts:30-37` — `inboxErrorStatus()`
- `src/contexts/integration/server/shared.ts:7-23` — `integrationErrorStatus()`
- `src/contexts/portal/server/portals.ts` — inline error mapping
- `src/contexts/goal/server/goals.ts` — inline error mapping (likely)

**Category:** slop / duplication
**Tag:** [code-fix] (deferred)

**What:** Each context defines its own error-to-HTTP-status mapping function. The pattern is identical: `match(code).with(...).exhaustive()`. This is repeated boilerplate.

**Why it matters:** Duplicated boilerplate is maintenance burden. If the HTTP status for a common error changes, it must be updated in 5+ files.

**Fix direction:** Consider a shared pattern for error status mapping. The per-context error codes are unique, but the mapping logic is generic. Deferred to a cleanup phase.

---

## Verified Compliant

1. **All server functions use `tracedHandler`** — 17/17 server files. `shared.ts` is a helper, not a server function.
2. **All server functions use `resolveTenantContext`** — Verified in Section 1 (except anonymous endpoints).
3. **Error mapping uses `match(...).exhaustive()`** — All error status mappers use exhaustive pattern matching.
4. **Tagged errors thrown at boundaries** — All errors thrown with `.name`, `.message`, `.code`, `.status`.
5. **No raw `return { success: false }`** — All errors thrown, never returned as success/failure objects.
6. **Input validation via Zod** — All server functions have `.validator()` or `.inputValidator()`.
7. **HTTP methods correct** — GET for reads, POST for mutations.
