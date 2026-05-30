# Section 1 — Shared Infrastructure Findings

**Date:** 2026-05-29
**Scope:** `src/shared/` (all subdirectories)
**Baseline:** Build ✓ | Lint ✓ | All shared tests pass

---

## Summary

| Severity | Count |
|----------|-------|
| MAJOR | 2 |
| MINOR | 3 |
| NIT | 2 |
| **Total** | **7** |

---

## MAJOR Findings

### S1-1 MAJOR: `clearTenantCache()` missing from 14/15 server function files

**File:** 15 server files in `src/contexts/*/server/*.ts`
**Category:** doc-discrepancy
**Tag:** [doc-fix] (preferred) or [code-fix] (alternative)

**What:** `src/contexts/CONTEXT.md:112` says:
> **`clearTenantCache()`** — evict expired entries after each server function completes.

Only **one** server file calls it: `src/contexts/portal/server/portal-groups.ts`. The other 14 server function files never call `clearTenantCache()`.

**Why it matters:** The tenant cache (`middleware.ts:22`) has a max of 100 entries with oldest-entry eviction and 5-second TTL, so it won't leak memory. However, stale entries could linger for up to 5 seconds after a session expires — a minor security concern if a user's org membership changes mid-session. The real issue is that the CONTEXT.md mandates a pattern that the code doesn't follow.

**DOCS SAY:** `clearTenantCache()` should be called after each server function.
**CODE DOES:** Only `portal-groups.ts` calls it. All others rely on TTL expiry and max-size eviction.

**Fix direction:** Option A (preferred) — Update `src/contexts/CONTEXT.md` to note that `clearTenantCache()` is a safety measure, not mandatory; the cache self-manages via TTL + max-size eviction. Option B — Add `clearTenantCache()` to all server functions for consistency.

---

### S1-2 MAJOR: Dead code — `shared/domain/clock.ts` has zero importers

**File:** `src/shared/domain/clock.ts`
**Category:** dead-code
**Tag:** [code-fix]

**What:** `shared/domain/clock.ts` exports a `Clock` interface (`{ now(): Date }`) and a `realClock` implementation. Zero files import from this module. Use cases that need clock injection define `clock: () => Date` in their own deps interface instead.

**Why it matters:** The CONTEXT.md says "Use cases receive `clock` as a dependency instead of `new Date()`." The pattern is followed (goal and guest use cases use `deps.clock()`), but the shared `Clock` type is unused. Dead code in shared domain is misleading — developers might import it expecting it to be the canonical type.

**Fix direction:** Either (A) migrate use case deps to use the branded `Clock` type from this file, or (B) remove `clock.ts` entirely since the `() => Date` pattern works fine without a branded type. Option B is simpler and consistent with the rest of the codebase.

---

## MINOR Findings

### S1-3 MINOR: In-memory test fakes missing for 7 repository ports

**Files:** Missing fakes for:
- `inbox-note.repository.ts`
- `portal-group.repository.ts`
- `metric.repository.ts`
- `goal.repository.ts`
- `reply.repository.ts`
- `review.repository.ts`
- `guest-interaction.repository.ts`

**Category:** missing-coverage
**Tag:** [code-fix] (deferred)

**What:** 18 repository ports exist in `contexts/*/application/ports/`, but only 11 have corresponding in-memory fakes in `src/shared/testing/`. 7 ports lack fakes, meaning use-case-level unit tests for those contexts can't use fast in-memory repos.

**Why it matters:** Missing fakes mean those use cases must be tested with real DB integration tests (slower) or aren't unit-tested at all. Per `src/contexts/CONTEXT.md` testing table: "Use cases — Unit with in-memory port fakes — Default test-first."

**Fix direction:** Create in-memory fakes for the missing repos. Lower priority than existing work — these repos may already have integration test coverage that compensates.

---

### S1-4 MINOR: `fallow-ignore-next-line` directive — unused type in middleware

**File:** `src/shared/auth/middleware.ts:58`
**Category:** slop
**Tag:** [code-fix]

**What:**
```typescript
// fallow-ignore-next-line unused-type
export type AuthError = Readonly<{...}>
```
An eslint suppression directive for a type that's exported but only used internally (`throwAuthError` uses the code type but `AuthError` itself is never consumed externally).

**Why it matters:** ESLint directives are code smells. Either the type is needed (remove the suppression) or it's not (inline the type).

**Fix direction:** If `AuthError` type is genuinely unused outside this file, remove the export and inline the type in `throwAuthError`. Remove the suppression comment.

---

### S1-5 MINOR: `shared/auth/auth.ts` — commented-out import

**File:** `src/shared/auth/auth.ts:19`
**Category:** slop
**Tag:** [code-fix]

**What:**
```typescript
// import { sendVerificationEmail } from './emails' // Re-enable with email verification
```
Commented-out import left in production code. Email verification is not yet implemented — this is a feature flag disguised as a code comment.

**Why it matters:** If email verification is planned (Phase 19 — Notifications), it should be tracked as an issue, not a commented-out import. Commented-out code is slop.

**Fix direction:** Remove the commented-out import. Create a GitHub Issue for email verification if needed. The import can be re-added when the feature is actually built.

---

## NIT Findings

### S1-6 NIT: `shared/domain/errors.ts` — base error factory used sparingly

**File:** `src/shared/domain/errors.ts`
**Category:** pattern-consistency
**Tag:** [code-fix] (minor)

**What:** `createErrorFactory` from `shared/domain/errors` is used by only 4 modules (inbox, dashboard, review domain errors, and auth/emails). Other contexts (goal, guest, portal, property, etc.) define their own error factories or use inline error construction.

**Why it matters:** Inconsistent error creation patterns. Most contexts duplicate the error factory logic instead of importing from shared.

**Fix direction:** Standardize on `createErrorFactory` across all contexts, or accept that each context owns its error patterns. Either way, document the preferred approach in `src/contexts/CONTEXT.md`.

---

### S1-7 NIT: `shared/events/event-bus.ts` — commented explanation about fire-and-forget

**File:** `src/shared/events/event-bus.ts:7-8`
**Category:** slop
**Tag:** [code-fix]

**What:**
```typescript
// emits an event but before the handler completes, the event is lost. This is acceptable
// for current use cases (logging, cache invalidation). For critical side effects
```
Fragment comment about fire-and-forget semantics. The comment is incomplete (cuts off mid-sentence) and is embedded in the implementation rather than being a proper doc comment.

**Fix direction:** Convert to a proper JSDoc on the `emit` method, or add to the file header. Complete the sentence.

---

## Verified Compliant

1. **No shared imports from contexts** — Zero violations (events/events.ts exception confirmed — imports event types as allowed)
2. **No React in shared** — Zero React imports outside `hooks/usePermissions` (confirmed)
3. **No business logic in shared** — Shared contains only infrastructure and cross-cutting concerns
4. **Permission statement ↔ domain Permission type** — In sync. All `statement` resources have corresponding `Permission` union members
5. **ID types complete** — All 18 entity types have branded ID types + constructors
6. **Cache port fully implemented** — `redis-cache.ts` implements all 4 methods (get, set, delete, exists). `noop-cache.ts` provides safe defaults for dev.
7. **Auth middleware cache** — 5s TTL, max 100 entries, oldest-entry eviction. Self-managing.
8. **Event bus** — Fire-and-forget semantics, handlers don't throw, failures logged
9. **`tracedHandler` pattern** — Used consistently across all server functions
10. **`resolveTenantContext` pattern** — Used consistently, cached, correct
11. **`usePermissions` hook** — Only React in shared, allowed exception per CONTEXT.md
