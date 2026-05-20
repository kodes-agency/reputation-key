# Fix Plan #5 — Fifth & Final Review Pass

## Scope

Phase 10 (review, integration) + Phase 11 (inbox, inbox components)

## Issues Found (TypeScript Compilation Errors)

### T1: `bulk-update-inbox-status.ts:73` — TS2345 type error

**File:** `src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts` L73
**Problem:** `item.propertyId as string` compared against `accessiblePropertyIds` (which returns `PropertyId[]` after staff API call). The `as string` cast strips the branded type, causing TS to complain that `string` is not assignable to `PropertyId`. The other use cases use the correct pattern: `item.propertyId as ReturnType<typeof import('#/shared/domain/ids').propertyId>`.
**Fix:** Match the pattern used in other use cases.

### T2: `get-inbox-item-detail.test.ts:70` — missing `findByIds` in mock repo

**File:** `src/contexts/inbox/application/use-cases/get-inbox-item-detail.test.ts` L70
**Problem:** The inline mock `InboxRepository` doesn't include `findByIds`, which was added to the port in fix plan #3. Tests pass at runtime because the use case doesn't call `findByIds`, but TypeScript strict compilation fails.
**Fix:** Add `findByIds: async () => []` to the mock.

### T3: `inbox.repository.test.ts:54` — missing `findByIds` in mock repo

**File:** `src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts` L54
**Problem:** Same as T2 — local `createInMemoryInboxRepo` in the test file doesn't include `findByIds`.
**Fix:** Add `findByIds: async () => []` to the mock.

## Execution Order

1. T1 → fix type safety in bulk-update
2. T2 → fix test mock completeness
3. T3 → fix test mock completeness
4. Verify tsc --noEmit passes
5. Verify all 218 tests still pass
