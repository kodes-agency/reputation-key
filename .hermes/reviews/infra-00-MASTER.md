# Goal Infrastructure — Exhaustive Focused Review

**Scope:** All 16 infrastructure files (3,360 lines)
**Branch:** `feat/phase-15c-goal-ui`
**Date:** Post-fix commit `c4d2cc5`
**Verdict:** **FAIL** — 16 P0, 28 P1, 41 P2, 14 N3

## Reports

| #   | Segment             | File                                         |
| --- | ------------------- | -------------------------------------------- |
| 01  | Repository + Mapper | `.hermes/reviews/infra-01-repo-mapper.md`    |
| 02  | Event Handlers      | `.hermes/reviews/infra-02-event-handlers.md` |
| 03  | Background Jobs     | `.hermes/reviews/infra-03-jobs.md`           |

## P0 Summary (must fix before merge)

### Multi-tenant data leaks (4 issues — repo)

1. **`findAllActive`**: No `organizationId` filter — returns ALL active goals across ALL orgs
2. **`findLatestInstance`**: No `organizationId` filter — cross-tenant instance lookup
3. **`getProgress`**: No `organizationId` filter — any tenant can read any goal's progress
4. **`updateProgress`**: No `organizationId` filter — any tenant can modify any progress row

### Event handler safety (4 issues — handlers)

5. **`on-portal-deleted`**: No try/catch — can throw to event bus emitter
6. **`on-staff-unassigned`**: No try/catch — can throw to event bus emitter
7. **`on-team-deleted`**: No try/catch — can throw to event bus emitter
8. **`on-metric-recorded`** outer call: `findActiveGoalsByMetric` not wrapped — if it throws, handler dies

### Job data integrity (5 issues — jobs)

9. **Reconcile job**: No try/catch in per-goal loop — one failure kills entire batch
10. **Spawn job**: No try/catch in per-template loop — one failure kills entire batch
11. **Reconcile job**: SUM/COUNT/MAX goals that met targets get **expired** instead of **completed** at period end
12. **Reconcile job**: Silently skips goals with no progress row — never creates one
13. **Spawn job**: Race condition — concurrent workers can create duplicate instances (no unique constraint)

### NULL arithmetic (1 issue — repo)

14. **`incrementProgress` AVG branch**: `currentSum + delta` on NULL = NULL in PG — breaks first increment on new progress row

### Mapper gaps (2 issues — mapper)

15. **Zero tests for outbound mappers** (`goalToInsertRow`, `goalProgressToInsertRow`)
16. **No round-trip test** (domain → row → domain)

## P1 Summary (high — should fix)

| #   | File     | Issue                                                                      |
| --- | -------- | -------------------------------------------------------------------------- |
| 1   | repo     | `update` method bypasses mapper — accepts untyped `Record<string,unknown>` |
| 2   | repo     | `markGoalCompleted` missing orgId filter                                   |
| 3   | repo     | Hardcoded status strings (`'active'`, `'completed'`, `'cancelled'`)        |
| 4   | repo     | Untagged errors in `assertLiteral`                                         |
| 5   | handlers | No idempotency guards on any handler                                       |
| 6   | handlers | `>=` completion comparison is business rule in infrastructure              |
| 7   | handlers | `team-deleted.test.ts` missing "continues on partial failure" test         |
| 8   | handlers | Zero test coverage for repository throws                                   |
| 9   | jobs     | Business logic in infrastructure (completion rules in reconcile job)       |
| 10  | jobs     | Cross-context import violation in test                                     |
| 11  | jobs     | New templates can't spawn first instance                                   |
| 12  | jobs     | Missing tests: error handling, no-progress-row, SUM/COUNT/MAX completion   |
| 13  | mapper   | Missing test: null description                                             |
| 14  | mapper   | Missing test: null periodStart/periodEnd                                   |
| 15  | mapper   | Missing test: non-null completedAt                                         |
| 16  | mapper   | Missing test: rollingWindowDays value                                      |

## Action plan

### Phase 1: Multi-tenant (P0 #1-4)

Add `organizationId` filter to `findAllActive`, `findLatestInstance`, `getProgress`, `updateProgress`. Methods that need it but don't currently receive it must have their port interface updated.

### Phase 2: Handler safety (P0 #5-8)

Wrap ALL handler bodies in try/catch. Add throw-path tests for every handler.

### Phase 3: Job resilience (P0 #9-13)

Wrap per-item loops in try/catch. Fix SUM/COUNT/MAX completion logic. Add upsert-or-skip guard in spawner. Ensure progress rows exist before reconciliation.

### Phase 4: NULL arithmetic (P0 #14)

Use `COALESCE(currentSum, 0) + delta` in AVG SQL.

### Phase 5: Mapper tests (P0 #15-16)

Add outbound mapper tests and round-trip test.
