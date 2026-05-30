# Section 4 — Infrastructure Layer Findings

**Date:** 2026-05-29
**Scope:** All `src/contexts/*/infrastructure/` directories
**Baseline:** All infrastructure tests pass. No business logic in repos/adapters. Event handlers match CONTEXT.md.

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

### S4-1 MINOR: `goal.repository.findAllActive()` queries without orgId — intentional but undocumented in code

**File:** `src/contexts/goal/infrastructure/repositories/goal.repository.ts:180`
**Category:** false-positive-in-audit / doc-gap
**Tag:** [doc-fix]

**What:**
```typescript
findAllActive: async () => {
  const rows = await db.select().from(goals).where(eq(goals.status, 'active'))
  return rows.map(goalFromRow)
}
```
This queries ALL active goals across ALL organizations without a `WHERE organization_id` filter. The port interface documents this as intentional: "Safe: findAllActive is a background job that legitimately processes all orgs."

**Why it matters:** At first glance this looks like a tenant isolation violation. The port comment explains the intent, but the repository implementation itself has no such comment. A developer reading the repo in isolation might "fix" it by adding an orgId filter, breaking the background jobs.

**Fix direction:** Add a comment in the repository implementation explaining that this method intentionally crosses tenant boundaries for background job processing. Reference the port comment.

---

### S4-2 MINOR: Guest context — no `infrastructure/event-handlers/` directory

**File:** `src/contexts/guest/infrastructure/` (missing event-handlers/)
**Category:** pattern-compliance (verified OK)
**Tag:** [doc-fix]

**What:** Guest context has no event handlers. Its CONTEXT.md says "None. Guest context does not subscribe to events from other contexts." However, the directory structure convention expects `infrastructure/event-handlers/` even if empty.

**Why it matters:** The absence is correct — guest produces events, doesn't consume them. The pattern is documented but the directory doesn't exist, which could confuse someone adding a new handler.

**Fix direction:** Add a `.gitkeep` in `guest/infrastructure/event-handlers/` with a comment file explaining the intentional emptiness. Same for `integration/infrastructure/event-handlers/` which also has no handlers.

---

## NIT Findings

### S4-3 NIT: `integration/infrastructure/event-handlers/` — directory missing

**File:** Missing directory
**Category:** pattern-compliance
**Tag:** [code-fix]

**What:** Integration context has no event handlers (CONTEXT.md doesn't list any consumed events), but the directory doesn't exist. Eight other contexts have the directory even when sparsely populated.

**Fix direction:** Same as S4-2 — add structure documentation.

---

## Verified Compliant

1. **All event handlers match CONTEXT.md consumed events** — Goal (3 handlers), Inbox (4), Metric (5), Review (1). All documented events have handlers.
2. **`findAllActive()` tenant crossing is intentional** — Documented in port: "background job that legitimately processes all orgs."
3. **No business logic in repositories** — Repos are pure Drizzle queries + mappers.
4. **No business logic in adapters** — Adapters are thin wrappers around external services.
5. **All repos use `trace()` wrapper** — Query-level timing via shared observability.
6. **Mapper functions are pure** — No async, no side effects, no external imports beyond domain types.
7. **Event handlers are idempotent and don't throw** — Failures logged via shared logger.
8. **Repository tenant isolation** — All queries (except intentional `findAllActive`) use `organizationId` filter.
9. **Adapter error translation** — External service errors caught and translated to tagged errors.
