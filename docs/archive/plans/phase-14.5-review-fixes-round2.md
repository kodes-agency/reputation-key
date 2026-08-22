# Phase 14.5 — Round 2 Review Fix Plan

## Triage of 40 findings

### FIXING NOW (24 items)

| #     | Severity | Issue                                                                            | Fix                                                                                           |
| ----- | -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 6     | HIGH     | `StaffPortalEntry` duplicated in server/staff-portals.ts                         | Remove local type, import from public-api                                                     |
| 7     | HIGH     | `StaffRecentReview` duplicated in server/staff-recent-activity.ts                | Remove local type, import from public-api                                                     |
| 8     | MED      | `StaffGoalEntry` re-exported from server                                         | Remove re-export                                                                              |
| 9     | MED      | `as string` cast on branded PortalId in staff-portals.ts                         | Use branded PortalId in StaffPortalEntry type                                                 |
| 10    | MED      | `as string` cast on branded ReviewId in staff-recent-activity.ts                 | Use string in StaffRecentReview (server serializes, so string is correct — keep but document) |
| 11    | HIGH     | staff/build.ts empty repos                                                       | Expose `repo` as `staffAssignmentRepo`                                                        |
| 12    | CRITICAL | getAssignedPortals not on publicApi                                              | Add to StaffPublicApi interface and build.ts                                                  |
| 13    | HIGH     | StaffPublicApi interface missing getAssignedPortals                              | Add it                                                                                        |
| 14    | MED      | StaffPortalEntry uses unbranded string                                           | Use PortalId                                                                                  |
| 16    | LOW      | StaffGoalEntry duplicates GoalWithProgress                                       | Use type alias instead                                                                        |
| 17    | MED      | staff/CONTEXT.md has Dependencies section                                        | Remove it                                                                                     |
| 18    | LOW      | goal/CONTEXT.md TODO prefix                                                      | Remove TODO                                                                                   |
| 19    | LOW      | dashboard/CONTEXT.md TODO prefix                                                 | Remove TODO                                                                                   |
| 20-23 | HIGH     | Events missing portalId                                                          | Add portalId to StaffAssigned/StaffUnassigned                                                 |
| 27    | MED      | staff/CONTEXT.md wrong permission strings                                        | Fix to staff_assignment.create/delete/read                                                    |
| 28    | MED      | staff/CONTEXT.md wrong updateStaffPortals output                                 | Fix to { added, removed }                                                                     |
| 29    | HIGH     | staff/CONTEXT.md claims getAssignedPortals is on public API but it's not         | Fix after adding it                                                                           |
| 30    | MED      | dashboard/CONTEXT.md missing StaffDashboardData, KPIs                            | Add them                                                                                      |
| 36    | MED      | staff/server/staff-portals.ts reaches into container.useCases.getAssignedPortals | Use publicApi after fix #12                                                                   |
| 37    | CRITICAL | review/server/staff-recent-activity.ts cross-context bypass                      | Use staff publicApi                                                                           |
| 38    | CRITICAL | goal/server/staff-goals.ts cross-context bypass                                  | Use staff publicApi                                                                           |
| 39    | MED      | staff/CONTEXT.md wrong port method signature                                     | Fix to include orgId                                                                          |

### NOT FIXING — Architectural Debt (4 items)

| #   | Severity | Issue                                                                  | Reason                                                                                                                                                                                                                                                                                    |
| --- | -------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2-5 | CRITICAL | Cross-context repo access via container.portalRepo/reviewRepo/goalRepo | Container IS the composition root. These repos are wired there intentionally. Moving to port-based access requires creating port interfaces and adapters for each cross-context repo access — a multi-day refactor affecting composition.ts and all server functions. Flag for Phase 16+. |
| 24  | HIGH     | Goal tests use vi.mock                                                 | Existing pattern across project. Rewriting all tests with in-memory fakes is a separate task.                                                                                                                                                                                             |
| 1   | MED      | toDashboardReplyStatus in domain/types.ts                              | Function is a pure validator (no I/O). Accepted as domain utility per precedent in codebase.                                                                                                                                                                                              |

### WON'T FIX — Low Priority / Cosmetic (12 items)

| #   | Issue                                                       | Reason                                                      |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| 15  | Unbranded string in StaffRecentReview.date                  | ISO string is correct for wire format                       |
| 25  | `as any` in goal test                                       | Part of vi.mock test pattern                                |
| 26  | Missing orgId in GetAssignedPortalsInput                    | orgId comes from ctx — documented wrong, code is correct    |
| 31  | Missing KPIs in dashboard CONTEXT.md                        | Will fix with #30                                           |
| 32  | Unused import comment                                       | Low noise                                                   |
| 33  | Unnecessary `as UserId` in tests                            | Branded ID constructors already return correct type — minor |
| 34  | Inline mock EventBus in test                                | Minor test quality issue                                    |
| 35  | getStaffDashboardData on publicApi but only used internally | Fine — public API can be broader                            |
| 40  | Non-null assertion `!` in update-staff-portals              | TypeScript can't narrow in .map() — acceptable              |

## Implementation Order

1. **Events:** Add portalId to StaffAssigned/StaffUnassigned events
2. **Public API:** Add getAssignedPortals to StaffPublicApi + build.ts
3. **Types:** Fix StaffPortalEntry to use PortalId, unify StaffGoalEntry
4. **Server functions:** Remove duplicate types, import from public-api, use publicApi for cross-context
5. **Build:** Expose repos in staff/build.ts
6. **CONTEXT.md:** Fix all documentation inaccuracies
7. **Verify:** tsc --noEmit + full test suite
