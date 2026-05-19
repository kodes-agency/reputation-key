# Phase 11 Inbox Fixes — Iteration 4

## Issues to Fix

1. [CRITICAL] Wire UnreadCounterPort into create-inbox-item use case — increment on new item creation
2. [CRITICAL] Fix unread counter decrement to fire on ALL `new → *` transitions (not just `new → read`)
3. [MEDIUM] Fix on-review-updated.ts dynamic import → static import
4. [MEDIUM] Remove `archived → read` from domain rules (make archived terminal, matching UI)
5. [MEDIUM] Add server import exception comment to inbox-notes-thread.tsx
6. [MEDIUM] Fix inbox-detail-content.tsx value import → type-only import

## Execution Order

1. Fix critical: wire unread counter into create-inbox-item + build.ts
2. Fix critical: expand decrement coverage in update/bulk-update use cases
3. Fix medium: static import in on-review-updated
4. Fix medium: domain rules archived → []
5. Fix medium: type import in inbox-detail-content
6. Fix medium: exception comment in inbox-notes-thread
7. Run tests + commit

## Verification

- Run `pnpm test` after all fixes
- Verify no regressions
