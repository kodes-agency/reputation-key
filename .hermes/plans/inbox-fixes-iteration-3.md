# Phase 11 Inbox Fixes — Iteration 3

## Issues to Fix

1. [CRITICAL] Remove unsafe `as` casts in `inbox-detail-sheet.tsx` — use proper typing from use case return
2. [CRITICAL] Remove misleading `organizationId`/`userId` from client payloads in detail sheet status update
3. [CRITICAL] Remove misleading `organizationId`/`authorUserId` from client payloads in notes thread
4. [MEDIUM] Fix unsafe `as` cast in `inbox-unread-badge.tsx` for result type
5. [MEDIUM] Restrict `updateStatusDto` to valid forward-transition statuses (exclude 'new')
6. [MEDIUM] Extract shared `formatDate` from duplicated components to utility
7. [MEDIUM] Change dynamic `await import()` to static import in event handlers
8. [MEDIUM] Remove archived→read reopen action from detail sheet UI (domain rules block it)

## Execution Order

1. Fix critical issues (#1-3): frontend type safety and payload cleanup
2. Fix medium issues (#4-8): DTO restriction, shared utils, import consistency, UI correctness
3. Verify with test suite

## Verification

- Run `pnpm test --run` after all fixes
- Verify no type errors: `pnpm tsc --noEmit` if available
- Commit all changes
