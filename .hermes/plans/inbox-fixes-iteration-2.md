# Phase 11 Inbox Fixes — Iteration 2

## Issues to Fix

1. [CRITICAL] `any` types in `get-unread-count.test.ts` → Use branded ID constructors for all test data
2. [CRITICAL] `get-inbox-item-detail.ts` throws instead of returning Result → Return `ResultAsync<InboxItemDetail, InboxError>`
3. [CRITICAL] `on-review-updated.ts` unsafe `as string` cast → Use proper unbrand helper
4. [MEDIUM] `bulk-update-inbox-status.ts` silently skips invalid transitions → Return partial failure info
5. [MEDIUM] `inbox-detail-sheet.tsx` unsafe casts → Use proper type narrowing
6. [MEDIUM] Redis decrement can go negative → Use Lua script or clamp
7. [MEDIUM] `inbox-bulk-actions.tsx` sends unnecessary orgId/userId → Remove from client payload (server resolves)
8. [MEDIUM] `inbox.repository.ts` double-cast → Use helper
9. [MEDIUM] `inbox-filters.tsx` unsafe casts → Use type-safe narrowing
10. [MEDIUM] `create-inbox-item.ts` null as UserId | null → Explicit type annotation
11. [MEDIUM] `bulk-update-inbox-status.ts` N Redis roundtrips → Batch decrement
12. [MINOR] Missing test for `get-inbox-item-detail` → Create test file
13. [MINOR] Duplicated formatDate → Extract to shared utility
14. [MINOR] handleRowClick no-op → Add minimal navigation/feedback
15. [MINOR] Schema index missing orgId on propertyId → Fix composite index

## Execution Order

1. Fix C1: Replace `any` with branded IDs in test
2. Fix C2: Refactor get-inbox-item-detail to use Result
3. Fix C3: Fix unsafe cast in event handler
4. Fix M3: Redis decrement clamping
5. Fix M5: Repository double-cast
6. Fix M6: Filters unsafe casts
7. Fix M7: Null assertion in create-inbox-item
8. Fix M8: Batch Redis decrement
9. Fix M2: Detail sheet type narrowing
10. Fix m1: Create missing test file
11. Fix m3: Extract shared formatDate
12. Fix m6: Schema index fix
13. Skip M1 (bulk partial failure reporting) and M4 (DTO cleanup) — these need design discussion
14. Skip m4 (author display) and m5 (no-op click) — UX decisions

## Verification

- Run full test suite after all fixes
- Verify no regressions
- Verify TypeScript compilation passes
