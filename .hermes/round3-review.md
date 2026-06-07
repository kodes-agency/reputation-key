# Round 3 Consolidated Review Report

**Date:** 2026-06-07
**Reviewers:** 3 independent subagents (Domain+App, Infra+Server, Cross-cutting+Docs)
**Previous state:** tsc clean, 1801/1801 tests passing

## Deduplicated Findings (after cross-reviewer merge)

### CRITICAL (4 → 3 unique)

| ID  | Description                                                                                                                                                                          | Files                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| C1  | Activity context imports event types directly from other contexts' `domain/events.ts` — 11 files bypass public-api boundary                                                          | `activity/infrastructure/event-handlers/*.ts` |
| C2  | Review `public-api.ts` missing 6 documented exports: `ReviewReplyApproved`, `ReviewReplyRejected`, `ReplyEvent`, `reviewReplyApproved`, `reviewReplyRejected`, `GoogleReviewApiPort` | `review/application/public-api.ts`            |
| C3  | Goal `public-api.ts` missing event constructor exports (`goalCompleted`, `goalProgressUpdated`) documented in CONTEXT.md                                                             | `goal/application/public-api.ts`              |

### HIGH (9)

| ID  | Description                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------- |
| H1  | Event `_tag` names in 7+ CONTEXT.md files use old-style names, not `context.entity.verb` per standards §1.1 |
| H2  | Review CONTEXT.md uses wrong type names (`ReplyPublished` vs `ReviewReplyPublished`)                        |
| H3  | `'' as UserId` phantom value pattern in event constructors (4 review + 7 inbox events)                      |
| H4  | `deleteReply` only allows 'draft' but CONTEXT.md says 'draft' AND 'rejected'                                |
| H5  | `GoalProgressUpdated` event missing `propertyId` field                                                      |
| H6  | Staff domain invariant (no self-assignment) bypassed at application layer                                   |
| H7  | 9 CONTEXT.md files have `TODO: One sentence describing...` placeholder still present                        |

### MEDIUM (19)

| ID  | Description                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------- |
| M1  | `getReplyPerformance` JOIN missing `reviews.organizationId` filter                                        |
| M2  | Missing error handling (no try/catch) in `staff-portals.ts`, `staff-goals.ts`, `staff-recent-activity.ts` |
| M3  | `catchUntagged(e)` without `throw` in `dashboard.ts:73` and `portal-analytics.ts:74`                      |
| M4  | Mapper `as string` vs `unbrand()` inconsistency in 5 mappers (staff, review, reply, inbox-note, goal)     |
| M5  | No integration test for `goal.repository.ts` (largest repo, 538 lines)                                    |
| M6  | No integration test for `inbox-note.repository.ts`                                                        |
| M7  | Staff `build.ts` missing explicit `StaffContextApi` return type                                           |
| M8  | `StaffRecentReview` uses raw `string` for `id` instead of branded `ReviewId`                              |
| M9  | Dashboard `domain/types.ts` contains validation function `toDashboardReplyStatus` + neverthrow import     |
| M10 | Goal `build.ts` puts `events: EventBus` in `internal.repos` — not a repository                            |
| M11 | Dashboard use cases skip `can(role, 'dashboard.read')` permission checks                                  |
| M12 | 13 deprecated section markers remain in 5 CONTEXT.md files                                                |
| M13 | Root CONTEXT.md bounded-contexts table has broken markdown formatting                                     |
| M14 | Review + Inbox `build.ts` return `publicApi: {} as Record<string, never>` — empty public API              |
| M15 | `dashboard.read` permission incorrectly listed in Identity CONTEXT.md                                     |
| M16 | Inbox CONTEXT.md missing `getInboxFolderCounts` use case documentation                                    |
| M17 | Goal CONTEXT.md documents event constructors not exported from public-api                                 |
| M18 | Composition root uses `dashboard.publicApi.*` instead of `dashboard.internal.useCases.*`                  |
| M19 | Goal DTO re-exports domain types through unnecessary indirection chain                                    |

### LOW (7)

| ID  | Description                                                                  |
| --- | ---------------------------------------------------------------------------- |
| L1  | `listStaffAssignments` swallows DB errors silently (returns empty array)     |
| L2  | Missing `staff_assignment.read` permission check in list endpoint            |
| L3  | Missing `reply.manage` permission checks in 5 reply endpoints                |
| L4  | `KPIsForPortals` duplicates ~80 lines from `getKPIs` in dashboard repo       |
| L5  | `timeRangeToDates` + `MS_PER_DAY` duplicated across 3 dashboard server files |
| L6  | Goal repo `insert` doesn't verify `goal.organizationId === orgId`            |
| L7  | `staff-assignments.ts` doesn't explicitly pass `organizationId` from ctx     |

### NIT (2)

| ID  | Description                                             |
| --- | ------------------------------------------------------- |
| N1  | `GoalCompleted.completedValue` — ambiguous field name   |
| N2  | Guest CONTEXT.md permissions use colon-separated format |

## Summary

| Severity  | Count  |
| --------- | ------ |
| CRITICAL  | 3      |
| HIGH      | 7      |
| MEDIUM    | 19     |
| LOW       | 7      |
| NIT       | 2      |
| **Total** | **38** |

## VERDICT: NOT CLEAN

## Triage — Fix vs. Defer

### Fix in this round (code issues, doc quick-wins):

- **C1**: Add missing exports to review/goal public-api, update activity imports
- **C2**: Add missing exports to review public-api
- **C3**: Add constructor exports to goal public-api
- **H1+H2**: Update CONTEXT.md event tags across all contexts
- **H7**: Remove TODO placeholders from 9 CONTEXT.md files
- **M2**: Add try/catch to 3 server files
- **M3**: Add `throw` to catchUntagged calls
- **M10**: Move events out of repos in goal build.ts
- **M11**: Add permission checks to dashboard use cases
- **M13**: Fix root CONTEXT.md table
- **M15**: Remove dashboard.read from Identity CONTEXT.md
- **M18**: Use internal.useCases for dashboard in composition

### Defer (architectural changes, new tests, systemic refactor):

- **H3**: `'' as UserId` pattern — systemic change touching many event constructors + consumers
- **H4**: deleteReply business rule clarification needed
- **H5**: GoalProgressUpdated missing propertyId — needs goal domain model change
- **H6**: Staff invariant bypass — business decision needed
- **M1**: getReplyPerformance tenant filter — low risk (UUID propertyIds)
- **M4**: Mapper unbrand migration — 5 mappers, mechanical but wide
- **M5/M6**: Missing repo tests — separate task
- **M7**: StaffContextApi type — needs design alignment
- **M8**: StaffRecentReview branded ID — needs consumer update
- **M9**: Dashboard domain/types.ts function extraction — separate refactor
- **M12**: Deprecated sections cleanup — bulk doc task
- **M14**: Review/Inbox empty publicApi — architectural decision
- **M16/M17**: Doc updates
- **M19**: Goal DTO indirection — cosmetic
- **All LOW/NIT**: Deferred
