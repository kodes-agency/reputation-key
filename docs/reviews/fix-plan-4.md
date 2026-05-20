# Fix Plan 4 — Fourth Review Pass

## Scope

Phase 10 (review, integration) + Phase 11 (inbox, inbox components)

## Issues to Fix

### B1: In-memory repo `nextCursor` always set, never null on last page

**File:** `src/shared/testing/in-memory-inbox-repo.ts` L40-45
**Problem:** Always returns `nextCursor` from last item of slice. Drizzle repo fetches `limit+1` and only returns cursor when more pages exist.
**Fix:** Fetch `limit+1` from filtered array, check if `rows.length > limit`, slice to `limit`, set `nextCursor` only when overflow detected.

### B2: Bulk update test wrong comment + weak assertion

**File:** `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts` L103-105
**Problem:** Comment says "archived→read is valid" but `archived` has NO valid transitions per rules.ts. Assertion `toBeGreaterThan(0)` masks potential double-update.
**Fix:** Fix comment. Change assertion to `toBe(1)`.

### S1: Stale closure in `inbox-unread-badge.tsx`

**File:** `src/components/inbox/inbox-unread-badge.tsx` L13-23
**Problem:** `loadAction` captured in `useCallback([], [])` with empty deps. If `useAction` returns new reference on re-render, stale closure. `use-inbox-detail.ts` uses ref pattern correctly.
**Fix:** Add ref pattern for `loadAction`.

### I1: ~~Inconsistent branded ID handling~~ — NOT A BUG (reverted)

After closer inspection, the handlers operate at different abstraction levels:

- `on-review-created` calls USE CASE (expects branded `ReviewId | FeedbackId`) — correct
- `on-review-updated` calls REPO directly (expects plain `string`) — correct, uses `unbrand()`
  This is intentional layer-appropriate behavior. Reverted.

## Advisory (document, don't fix)

### P1: Sequential event emission in bulk update

`bulk-update-inbox-status.ts` emits events one-by-one with `await`. Could use `Promise.all` for parallel emission. Not a bug, but limits throughput on large bulk ops.

### T1: Missing counter failure test for create-inbox-item

Code handles Redis failure gracefully (try/catch), but no test verifies item is still created when counter throws.

### T2: Missing last-page pagination test

No test verifies `nextCursor === null` on last page. Drizzle repo is correct, but in-memory repo (B1 fix) now also correct — test would validate both.

## Execution Order

1. B1 → fixes test infrastructure correctness
2. B2 → fixes test accuracy
3. S1 → fixes potential stale closure
4. I1 → REVERTED — not a bug
