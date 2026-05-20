# Fix Plan #3 — Based on Reviews #1 & #2 (Phase 10-11)

**Reviewer**: Senior Code Reviewer (3rd pass)
**Date**: 2026-05-20

## Issue Status from Review #1

| ID  | Description                              | Status                                       |
| --- | ---------------------------------------- | -------------------------------------------- |
| C1  | sync-reviews partial success returns Err | ✅ Fixed                                     |
| C2  | get-unread-count per-user fallback       | ✅ Fixed                                     |
| M1  | Variable shadowing `catch (err)`         | ✅ Fixed                                     |
| M2  | Hardcoded `new Date()` in repos          | ⚠️ Partial — `syncDenormalizedFields` missed |
| M3  | Hardcoded non-existent platforms         | ✅ Fixed                                     |
| M4  | N+1 query in bulk-update                 | ❌ Not fixed                                 |
| M5  | Replies unique constraint Phase 12       | ❌ Not fixed                                 |
| M6  | Access check called N times in loop      | ✅ Fixed                                     |
| m1  | Inconsistent branded ID handling         | ❌ Not fixed                                 |
| m2  | Rating cast without validation           | ❌ Not fixed                                 |
| m3  | InboxNotesThread shows UUID prefix       | ❌ Not fixed                                 |
| m4  | Redis Lua script re-evaluated            | ❌ Not fixed                                 |
| m5  | Error context type wrapping              | ✅ Fixed (via C1)                            |
| n1  | loadCount empty deps                     | ❌ Not fixed                                 |
| n2  | catch blocks silently swallow            | ⚠️ Partial                                   |
| n3  | Optional chain in deps                   | ❌ Not fixed                                 |

## New Issues Found in Review #3

| ID  | Severity | Description                                                        |
| --- | -------- | ------------------------------------------------------------------ |
| C3  | Critical | Unread counter never incremented when inbox items are created      |
| M7  | Major    | Test mock `decrement` has stale `userId` param in bulk-update test |
| M8  | Major    | N+1 in `findDetailById` — 3 sequential queries for feedback        |
| m6  | Minor    | `createInboxItem` constructor never validates — dead `Result` type |
| m7  | Minor    | Ugly inline type assertion for property ID comparison in use cases |

## Execution Plan

### Batch 1: Critical + Quick Wins

1. **C3**: Add `unreadCounter.increment()` to `create-inbox-item` use case
2. **M2-partial**: Fix `syncDenormalizedFields` to accept `now` param
3. **M7**: Fix test mock `decrement` signature

### Batch 2: Major structural

4. **M4**: Add `findByIds` to repo port, use in bulk-update (eliminate N+1)
5. **M5**: Document Phase 12 constraint in schema comment

### Batch 3: Minor consistency

6. **m1**: Standardize branded ID handling in event handlers (use `unbrand` consistently)
7. **m2**: Add rating validation to review mapper
8. **m4**: Extract Lua script to constant in Redis adapter
9. **m6**: Remove dead `Result` wrapper from `createInboxItem` constructor

### Batch 4: UX

10. **m3**: Fix InboxNotesThread to show "You" or resolve author name
