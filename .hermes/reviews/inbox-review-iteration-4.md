# Phase 11 Inbox Review — Iteration 4

Date: 2026-05-19
Reviewer: Senior Code Review Agent (automated)
Base commit: 38f7b2e
Files reviewed: 59

## Summary

Fourth and final pass. Previous iterations fixed structural issues, type safety, tenant isolation, and client payloads. This iteration focuses on functional correctness gaps and convention consistency. The codebase is architecturally sound — hexagonal layers are clean, domain is pure, tenant isolation is complete, error handling follows conventions. The main findings are: (1) the Redis unread counter is never incremented on item creation, making the fast-path cache useless and forcing every badge render to hit the DB, (2) unread counter decrement only fires on `new → read` but should fire on any `new → *` transition, (3) `on-review-updated.ts` was missed during the dynamic→static import fix, (4) domain rules allow `archived → read` but the UI hides it — inconsistent, and (5) minor convention violations in component imports.

## Critical Issues (must fix)

| #   | File                                                                 | Issue                                                                                                                                                                                                                                                                           | Severity |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `src/contexts/inbox/application/use-cases/create-inbox-item.ts`      | Unread counter is never incremented when a new inbox item is created. `CreateInboxItemDeps` doesn't include `UnreadCounterPort`. The Redis counter always returns 0 → `getUnreadCount` always falls through to DB `countByStatus`. The entire Redis caching layer is dead code. | HIGH     |
| 2   | `src/contexts/inbox/application/use-cases/update-inbox-status.ts:62` | Unread counter decrements only for `new → read`, but `new → addressed`, `new → escalated`, and `new → archived` also leave the 'new' status. Counter becomes inaccurate for non-read transitions. Same issue in `bulk-update-inbox-status.ts:67`.                               | HIGH     |

## Medium Issues (should fix)

| #   | File                                                                       | Issue                                                                                                                                                                                                                                                                                          | Severity |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 3   | `src/contexts/inbox/infrastructure/event-handlers/on-review-updated.ts:28` | Still uses dynamic `await import('#/shared/observability/logger')`. Other two handlers were fixed to static imports in iteration 3 — this one was missed.                                                                                                                                      | MEDIUM   |
| 4   | `src/contexts/inbox/domain/rules.ts:14`                                    | `archived: ['read']` allows reopening, but `inbox-detail-helpers.tsx` returns `[]` for archived. Domain and UI are inconsistent. Either domain should block it (`archived: []`) or UI should offer it. Forward-only semantics suggest making archived terminal.                                | MEDIUM   |
| 5   | `src/components/inbox/inbox-notes-thread.tsx:4`                            | Imports `addInboxNoteFn` from server layer and calls `useMutationAction` directly. Per convention, server fn hooks should be defined in route and passed as props. Component is 3 levels deep (route → sheet → content → notes), so prop drilling >2 levels. Add exception comment to justify. | MEDIUM   |
| 6   | `src/components/inbox/inbox-detail-content.tsx:7`                          | `import { updateInboxStatusFn }` is a value import from server layer used only in type position (`typeof`). Should be `import type` to respect boundary rules.                                                                                                                                 | MEDIUM   |

## Minor Issues (nice to fix)

| #   | File                                                                                                      | Issue                                                                                                                                                                  | Severity |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 7   | `src/components/inbox/inbox-notes-thread.tsx:77`                                                          | `note.authorUserId.slice(0, 8)…` shows truncated UUID — meaningless to users. Show "You" for current user or "Team member" until user data is available.               | LOW      |
| 8   | `src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts:10`, `on-feedback-submitted.ts:10` | `OnReviewCreatedDeps` / `OnFeedbackSubmittedDeps` includes `events: EventBus` but handlers never call `deps.events`. The use case emits events internally. Unused dep. | LOW      |

## Positive Notes

- Architecture is genuinely clean after 3 iterations of fixes. Hexagonal layers are correct, dependency direction is right.
- Tenant isolation is solid — every query includes `organizationId`, DTOs don't accept identity fields.
- Domain rules use `Result<T, E>` pattern consistently. Constructors validate properly.
- Build function composition is well-structured — null Redis falls back gracefully.
- Mapper layer is clean — bidirectional, only place both shapes are known.
- Event handlers are idempotent (`already_exists` guard) and catch+log without throwing.
- Schema indexes are well-designed for the query patterns.

## Convergence Notes

- Iteration 1: structural issues (tenant isolation, `any` casts, missing indexes) → all fixed
- Iteration 2: test typing, negative Redis counter, DTO exports → all fixed
- Iteration 3: frontend type safety, client payloads, UI/domain inconsistency → all fixed
- Iteration 4: functional correctness (unread counter wiring, transition coverage) + consistency
- Issues are converging toward zero. No new architectural issues found in iterations 3-4.
- Remaining issues are minor convention nits and a functional gap (counter increment).
