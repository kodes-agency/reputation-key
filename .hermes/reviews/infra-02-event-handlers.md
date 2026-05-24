# INFRA-02: Event Handlers — Exhaustive Code Review

**Reviewer:** Senior Staff (angry, moody, hates slop)
**Date:** 2026-05-24
**Branch:** `feat/phase-15c-goal-ui`
**Scope:** All 9 files under `src/contexts/goal/infrastructure/event-handlers/`

---

## Summary Verdict

The cancel-trio (portal-deleted, staff-unassigned, team-deleted) are **structurally identical** and share the same critical flaw: **NO try/catch wrapping the outer function body**. If `goalRepo.list()` throws (network timeout, DB connection dropped), the handler propagates the exception to the event bus emitter. This **violates the cardinal rule**: handlers must never throw.

`on-metric-recorded` is more careful — it wraps per-goal processing in try/catch — but misses the outer `goalRepo.findActiveGoalsByMetric()` call, which can also throw and would escape the trace wrapper.

The index.ts registration file has a **type mismatch** — it passes `deps` to all four handlers despite the cancel-trio not accepting `eventBus` or `clock` in their deps type. This compiles only because of structural subtyping (extra properties are allowed), but it's misleading.

---

## File-by-File Findings

---

### 1. `on-metric-recorded.ts` (99 lines)

| #   | Severity | Line(s) | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **P0**   | 28-33   | `goalRepo.findActiveGoalsByMetric()` is called **outside** any try/catch. If the DB query throws, the exception propagates up through `trace()` to the event bus. Handlers MUST NOT throw. The per-goal try/catch on line 39 is good, but it only protects the loop body. The outer query is naked.                                                                                                                                           |
| 2   | **P0**   | 25-97   | The `trace()` wrapper does NOT swallow exceptions — it re-throws after recording the span. So even wrapped in `trace`, a throw from line 28 will propagate to the emitter. This is NOT a safety boundary.                                                                                                                                                                                                                                     |
| 3   | **P1**   | 54-63   | `eventBus.emit()` for `GoalProgressUpdated` is inside the per-goal try/catch ✓ BUT: if `emit` throws, the error is caught and logged, but `incrementProgress` already committed to the repo. On replay (duplicate event), the progress gets double-incremented — the handler is **NOT idempotent**. There's no deduplication key or check against already-processed `readingId`.                                                              |
| 4   | **P1**   | 67      | `markGoalCompleted()` is also inside the try/catch ✓. But if it throws and the event was already emitted on line 69 for `goal.completed`, on retry: progress gets incremented again + another `goal.completed` fires. Double-emission.                                                                                                                                                                                                        |
| 5   | **P1**   | 66      | `shouldEmitCompleted(goal)` is imported from `../../domain/progress-strategy`. This is a domain function called from infrastructure. The call itself is fine (infrastructure can invoke domain pure functions), but the completion check logic (`result.currentValue >= goal.targetValue`) on line 66 is a **business rule living in infrastructure**. The `>=` comparison IS a business rule. It should be encapsulated in the domain layer. |
| 6   | **P1**   | 45-49   | `goalRepo.incrementProgress()` is called with `goal.aggregationFunction` — this means the handler is aware of aggregation semantics. While the repo handles the actual math, the handler orchestrates which function to use. This is borderline but acceptable as infrastructure plumbing.                                                                                                                                                    |
| 7   | **P2**   | 10      | `shouldEmitCompleted` imported from domain — this is fine architecturally (pure function). No issue.                                                                                                                                                                                                                                                                                                                                          |
| 8   | **P2**   | 5-8     | All imports from correct locations. Cross-context `MetricRecorded` from `#/contexts/metric/application/public-api` ✓.                                                                                                                                                                                                                                                                                                                         |
| 9   | **N3**   | 1-3     | Comment is accurate and helpful.                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10  | **P2**   | 14-19   | `OnMetricRecordedDeps` uses `Readonly<>` ✓. Good.                                                                                                                                                                                                                                                                                                                                                                                             |
| 11  | **P1**   | 36      | Early return when `affectedGoals.length === 0` — but what if `findActiveGoalsByMetric` returns goals that become inactive between the query and the loop iteration? There's no re-check of `goal.status` before processing. Minor race condition in concurrent environments.                                                                                                                                                                  |
| 12  | **P2**   | 41-42   | `prevProgress?.currentValue ?? 0` — safe null coalescing ✓.                                                                                                                                                                                                                                                                                                                                                                                   |

**CRITICAL: Lines 28-33 MUST be wrapped in try/catch with error logging. The handler is NOT idempotent on duplicate events — no dedup guard exists.**

---

### 2. `on-metric-recorded.test.ts` (579 lines)

| #   | Severity | Line(s) | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **P0**   | —       | **NO TEST for `goalRepo.findActiveGoalsByMetric()` throwing.** The fake repo on line 80 always succeeds. There is zero coverage for the outer query failure path. This is exactly the bug in the handler (finding #1 above).                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | **P0**   | —       | **NO TEST for `goalRepo.incrementProgress()` throwing.** The fake always succeeds. Missing error path coverage for the core increment operation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | **P1**   | —       | **NO idempotency test.** There is no test that calls `handler(event)` twice with the same event and asserts the result is correct. The handler should be safe to call twice, but there's no proof.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | **P1**   | —       | **NO test for `eventBus.emit()` throwing.** If the event bus rejects, what happens? The fake always succeeds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | **P1**   | —       | **NO test for `goalRepo.markGoalCompleted()` throwing.** What happens when the DB fails mid-completion?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | **P2**   | 62-126  | Fake `GoalRepository` is ~65 lines of boilerplate. This is duplicated across ALL 4 test files (with minor variations). Should be extracted to a shared test helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | **P2**   | 75      | `goalId as string` — unsafe cast. The fake uses `as string` to use branded IDs as Map keys. Works but is sloppy. Could use `String(goalId)` or a helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | **P2**   | 94      | Same `as string` cast issue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 9   | **P2**   | 152     | `getLogger: () => ({ ... }) as OnMetricRecordedDeps` — this cast is **WRONG**. It casts the logger object as `OnMetricRecordedDeps` (the entire deps type) instead of the logger return type. This works by accident because TypeScript allows it (the logger shape satisfies the deps type structurally? No, actually this is wrong). Wait — looking closer: `as OnMetricRecordedDeps` casts the `{info, error, warn, debug, child}` object as the full deps type. This should be `as ReturnType<typeof getLoggerType>` or just a properly typed mock. The fact that it compiles suggests the type is overly permissive somewhere. |
| 10  | **P2**   | 165     | `'progress-${++progressCounter}' as GoalProgressId` — string cast to branded type. Acceptable in test code but noted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 11  | **N3**   | 173     | Same `as string` cast for Map key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 12  | **P2**   | 128-134 | Fake eventBus has `emit: async (event: EmittedEvent)` — typed too narrowly. The real `EventBus.emit()` accepts `DomainEvent`. This works because the handler only emits these types, but the fake should match the real interface.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 13  | **P1**   | —       | **Missing test: `goalRepo.getProgress()` returning null.** The handler uses `prevProgress?.currentValue ?? 0` on line 42 of the handler, and the test only ever sets up progress via `addGoalWithProgress()`. No test verifies the `null` branch (first increment for a goal with no progress row).                                                                                                                                                                                                                                                                                                                                 |
| 14  | **N3**   | 197-204 | Good use of `beforeEach` to reset fakes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 15  | **P2**   | 208-493 | Test structure is well-organized by aggregation function ✓.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 16  | **N3**   | 511-578 | Portal-scoped matching tests are thorough ✓.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

### 3. `on-portal-deleted.ts` (49 lines)

| #   | Severity | Line(s) | Finding                                                                                                                                                                                                                                                                                           |
| --- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **P0**   | 28-32   | `deps.goalRepo.list()` is called **outside any try/catch**. If the DB is down, this throws directly to the event bus emitter. This handler CAN THROW. This is the #1 rule violation.                                                                                                              |
| 2   | **P0**   | 27      | The entire handler body has **NO try/catch wrapper**. Compare with `on-metric-recorded` which at least has per-goal try/catch. This handler is completely unprotected. If `cancelGoalFn` throws (not returns `err()`, but actually throws a TypeError), it propagates.                            |
| 3   | **P1**   | 35-39   | `cancelGoalFn` uses `await`, and `result.isErr()` is checked ✓. But if `cancelGoalFn` itself throws (not a neverthrow Err, but an actual exception — e.g., serialization error), there's no catch. The handler assumes `cancelGoalFn` always returns a Result, never throws.                      |
| 4   | **P1**   | 34-48   | **NOT idempotent.** If the same `portal.deleted` event is delivered twice, `list()` will return the same goals (they're still active because cancel might be in-process), and `cancelGoalFn` gets called again. The handler relies on `cancelGoalFn` being idempotent, but there's no guard here. |
| 5   | **P2**   | 38      | Hard-coded `'AccountAdmin'` role. This is a business decision (which role to use for system-initiated cancels) leaking into infrastructure. Should be a constant or config.                                                                                                                       |
| 6   | **P2**   | 5-11    | Imports are correct. Cross-context via public-api ✓.                                                                                                                                                                                                                                              |
| 7   | **P2**   | 15-21   | `OnPortalDeletedDeps` uses `Readonly<>` ✓.                                                                                                                                                                                                                                                        |
| 8   | **N3**   | 1-3     | Comment is accurate.                                                                                                                                                                                                                                                                              |
| 9   | **P2**   | 7       | `Goal` type imported but only used in the `cancelGoalFn` return type via `Result<Goal, unknown>`. Fine.                                                                                                                                                                                           |

**THIS HANDLER CAN THROW. Fix IMMEDIATELY.**

---

### 4. `on-portal-deleted.test.ts` (221 lines)

| #   | Severity | Line(s) | Finding                                                                                                                                                                                                                                                                                                                                                |
| --- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **P0**   | —       | **NO test for `goalRepo.list()` throwing.** The fake on line 59 always returns a filtered array. Missing coverage for the most critical failure path.                                                                                                                                                                                                  |
| 2   | **P0**   | —       | **NO test for `cancelGoalFn` throwing (vs returning `err()`).** The handler only handles `Result.isErr()`, not actual exceptions from `cancelGoalFn`.                                                                                                                                                                                                  |
| 3   | **P1**   | —       | **NO idempotency test.** What happens when the same event is processed twice?                                                                                                                                                                                                                                                                          |
| 4   | **P2**   | 107     | `getLogger: () => logger as any` — uses `any` cast with eslint-disable comment. Should use proper typing. Same issue in staff-unassigned and team-deleted tests.                                                                                                                                                                                       |
| 5   | **P2**   | 91      | `input.goalId as string` — branded ID cast. Acceptable in tests.                                                                                                                                                                                                                                                                                       |
| 6   | **P2**   | 59-66   | Fake `list` filter logic: `if (filter.portalId && g.portalId !== filter.portalId) return false` — this means if `filter.portalId` is null/undefined, it doesn't filter by portal. But the real handler always passes `event.portalId` which could be null. The filter works correctly for the test cases but doesn't test the null-portalId edge case. |
| 7   | **N3**   | 115-221 | Test coverage for happy path + error path (cancel fails) + partial failure (continue on error) is good ✓.                                                                                                                                                                                                                                              |
| 8   | **P2**   | 53-86   | Duplicated fake repo boilerplate. Same ~34 lines repeated in all 3 cancel-handler tests.                                                                                                                                                                                                                                                               |

---

### 5. `on-staff-unassigned.ts` (53 lines)

| #   | Severity | Line(s) | Finding                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **P0**   | 32-36   | Same as portal-deleted: `deps.goalRepo.list()` with **NO try/catch**. Handler can throw.                                                                                                                                                                                                                                                                                                           |
| 2   | **P0**   | 26-53   | **Entire handler body has NO try/catch.** Same critical flaw as `on-portal-deleted`.                                                                                                                                                                                                                                                                                                               |
| 3   | **P1**   | 39-43   | Same as portal-deleted: if `cancelGoalFn` throws (not returns Err), exception propagates.                                                                                                                                                                                                                                                                                                          |
| 4   | **P1**   | 34      | `staffId(event.assignmentId)` — this is a type coercion from `StaffAssignmentId` to `StaffId`. While `staffId()` is a brand constructor, this is an **implicit domain mapping** in infrastructure. The comment on lines 29-31 explains the rationale, which is good. But this is a subtle semantic mapping that should arguably be documented in the domain, not just a comment in infrastructure. |
| 5   | **P1**   | 38-48   | **NOT idempotent** — same issue as portal-deleted.                                                                                                                                                                                                                                                                                                                                                 |
| 6   | **P2**   | 38      | Hard-coded `'AccountAdmin'` role — same as portal-deleted.                                                                                                                                                                                                                                                                                                                                         |
| 7   | **P2**   | 9       | `import { staffId }` — imports a value (not just a type) from shared domain. This is fine for a constructor function.                                                                                                                                                                                                                                                                              |
| 8   | **P2**   | 16-22   | `Readonly<>` on deps ✓.                                                                                                                                                                                                                                                                                                                                                                            |

**THIS HANDLER CAN THROW. Identical structural flaw to `on-portal-deleted`.**

---

### 6. `on-staff-unassigned.test.ts` (230 lines)

| #   | Severity | Line(s) | Finding                                                                                                                                               |
| --- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **P0**   | —       | **NO test for `goalRepo.list()` throwing.** Same gap as portal-deleted tests.                                                                         |
| 2   | **P0**   | —       | **NO test for `cancelGoalFn` throwing (vs returning `err()`).**                                                                                       |
| 3   | **P1**   | —       | **NO idempotency test.**                                                                                                                              |
| 4   | **P2**   | 116     | `getLogger: () => logger as any` — same `any` cast issue.                                                                                             |
| 5   | **P2**   | 100     | `input.goalId as string` — branded cast.                                                                                                              |
| 6   | **P2**   | 62-95   | Duplicated fake repo boilerplate.                                                                                                                     |
| 7   | **N3**   | 124-229 | Test cases mirror portal-deleted structure. Good coverage of cancel success, wrong-staff filtering, empty results, cancel failure, partial failure ✓. |
| 8   | **P2**   | 73      | Fake filter: `if (filter.staffId && g.staffId !== filter.staffId)` — same null-handling observation as portal-deleted tests.                          |

---

### 7. `on-team-deleted.ts` (49 lines)

| #   | Severity | Line(s) | Finding                                                                                  |
| --- | -------- | ------- | ---------------------------------------------------------------------------------------- |
| 1   | **P0**   | 28-32   | Same as portal-deleted: `deps.goalRepo.list()` with **NO try/catch**. Handler can throw. |
| 2   | **P0**   | 25-49   | **Entire handler body has NO try/catch.** Identical structural flaw.                     |
| 3   | **P1**   | 35-39   | Same as portal-deleted: if `cancelGoalFn` throws, exception propagates.                  |
| 4   | **P1**   | 34-48   | **NOT idempotent** — same issue.                                                         |
| 5   | **P2**   | 38      | Hard-coded `'AccountAdmin'` role.                                                        |
| 6   | **P2**   | 5-11    | Imports correct ✓. Cross-context via public-api ✓.                                       |
| 7   | **P2**   | 15-21   | `Readonly<>` on deps ✓.                                                                  |

**THIS HANDLER CAN THROW. Same flaw, third occurrence.**

---

### 8. `on-team-deleted.test.ts` (189 lines)

| #   | Severity | Line(s) | Finding                                                                                                                                                                                                |
| --- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **P0**   | —       | **NO test for `goalRepo.list()` throwing.**                                                                                                                                                            |
| 2   | **P0**   | —       | **NO test for `cancelGoalFn` throwing.**                                                                                                                                                               |
| 3   | **P1**   | —       | **NO idempotency test.**                                                                                                                                                                               |
| 4   | **P2**   | 107     | `getLogger: () => logger as any` — same `any` cast.                                                                                                                                                    |
| 5   | **P2**   | 91      | `input.goalId as string`.                                                                                                                                                                              |
| 6   | **P2**   | 53-86   | Duplicated fake repo boilerplate.                                                                                                                                                                      |
| 7   | **N3**   | 115-189 | Test structure mirrors the other cancel handlers. Missing the "continues cancelling remaining goals when one cancel fails" test that portal-deleted and staff-unassigned have. **This is a test gap.** |

Wait — looking again at line 189: the file ends there. The test does NOT have the "continues cancelling remaining goals when one cancel fails" test case. Both portal-deleted (line 190) and staff-unassigned (line 199) have this test, but team-deleted does NOT.

| #   | Severity | Line(s) | Finding                                                                                                                                                                                              |
| --- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | **P1**   | —       | **Missing "continues on partial failure" test.** Portal-deleted and staff-unassigned both test that when one cancel fails, the handler continues with remaining goals. Team-deleted omits this test. |

---

### 9. `index.ts` (41 lines)

| #   | Severity | Line(s) | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **P2**   | 37-40   | `onStaffUnassigned(deps)`, `onPortalDeleted(deps)`, `onTeamDeleted(deps)` — the `deps` object is `RegisterGoalHandlersDeps` which includes `eventBus` and `clock`. But the cancel-trio deps types (`OnPortalDeletedDeps`, etc.) don't include `eventBus` or `clock`. This works because TypeScript structural subtyping allows passing an object with extra properties. But it's **misleading** — a reader would think the cancel handlers need `eventBus` and `clock`. Consider destructuring or passing minimal deps. |
| 2   | **P1**   | 36-41   | `registerGoalEventHandlers` does not return an unsubscribe function. Once registered, handlers cannot be removed (except via `eventBus.clear()`). For testing and modularity, returning an unsubscribe function would be better.                                                                                                                                                                                                                                                                                        |
| 3   | **P2**   | 7-9     | Unused imports: `Goal`, `GoalId`, `OrganizationId`, `Role`, `Result` — these are only used in the `CancelGoalFn` type definition on lines 20-22. The `Goal` import is unused because `CancelGoalFn` returns `Result<Goal, unknown>` but `Goal` is only needed for the type. Actually looking again: `Goal` IS used in `CancelGoalFn` return type. `GoalId` and `OrganizationId` are used in the input type. `Role` is used in the input type. `Result` is used in the return type. All used ✓.                          |
| 4   | **P2**   | 20-22   | `CancelGoalFn` type is defined here AND the same type is embedded in each handler's deps type. This is good DRY. But it means the handler deps types must stay in sync with this definition.                                                                                                                                                                                                                                                                                                                            |
| 5   | **N3**   | 1-3     | Good comment quoting the architecture rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | **P2**   | 26-32   | `RegisterGoalHandlersDeps` uses `Readonly<>` ✓.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7   | **N3**   | 36      | `registerGoalEventHandlers` returns `void` — correct for a registration function.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## Cross-Cutting Issues

### 1. ALL THREE CANCEL HANDLERS CAN THROW (P0 — Systemic)

`on-portal-deleted.ts`, `on-staff-unassigned.ts`, `on-team-deleted.ts` are **structurally identical** — same pattern, same flaw. None have try/catch around the handler body. Fix pattern:

```typescript
export const onPortalDeleted =
  (deps: OnPortalDeletedDeps) =>
  async (event: PortalDeleted): Promise<void> => {
    try {
      const goals = await deps.goalRepo.list({ ... })
      for (const goal of goals) { ... }
    } catch (err) {
      deps.getLogger().error({ err, eventId: event.portalId }, 'goal: fatal error in onPortalDeleted')
    }
  }
```

### 2. NO IDEMPOTENCY GUARANTEES (P1 — Systemic)

None of the 4 handlers have any deduplication mechanism. If the event bus redelivers an event:

- `on-metric-recorded`: double-increments progress, double-emits events
- Cancel handlers: `cancelGoalFn` gets called again (depends on fn's own idempotency)

The handlers rely entirely on downstream idempotency, which is fragile.

### 3. TEST BOILERPLATE DUPLICATION (P2 — Systemic)

The fake `GoalRepository` is copy-pasted across all 4 test files with minor variations (~34 lines each, ~136 lines total). Extract to a shared test factory like `tests/helpers/fake-goal-repository.ts`.

### 4. `any` TYPE CASTS IN TESTS (P2 — Systemic)

All 3 cancel-handler tests use `logger as any` for the `getLogger` mock. The metric-recorded test has a wrong cast (`as OnMetricRecordedDeps` instead of the logger return type). Use proper typing:

```typescript
getLogger: () => logger as unknown as ReturnType<typeof getLoggerType>
```

### 5. MISSING TEST COVERAGE (P0/P1 — Systemic)

**Zero tests across ALL files for:**

- Repository methods throwing (P0)
- EventBus.emit throwing (P1)
- `cancelGoalFn` throwing actual exceptions vs returning Err (P0)
- Idempotency — running same event twice (P1)
- `goalRepo.getProgress()` returning null in metric-recorded handler (P1)

---

## Severity Summary

| Severity | Count  | Summary                                                                                                       |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| **P0**   | **7**  | 3 handlers can throw (no try/catch), metric-recorded outer query unprotected, 0 test coverage for throw paths |
| **P1**   | **12** | No idempotency, business rules in infra, missing test scenarios, team-deleted missing partial-failure test    |
| **P2**   | **18** | Test boilerplate duplication, `any` casts, hard-coded role, type mismatches, narrow fake types                |
| **N3**   | **7**  | Good comments, correct import patterns, proper Readonly usage                                                 |

---

## Required Actions (Priority Order)

1. **P0 — Wrap ALL handler bodies in try/catch.** Every handler must catch all errors, log them, and return void. No exceptions. This is non-negotiable per architecture rules.

2. **P0 — Add tests for repository/list throwing.** Verify handlers log the error and don't propagate it.

3. **P0 — Add tests for `cancelGoalFn` throwing (not returning Err).** The current tests only cover `Result.isErr()`.

4. **P1 — Add idempotency tests.** Call handler twice with same event, assert no double-processing.

5. **P1 — Extract the `>=` completion check in on-metric-recorded to a domain function.** Line 66 (`result.currentValue >= goal.targetValue`) is a business rule.

6. **P1 — Add "continues on partial failure" test to team-deleted.** It's missing compared to the other two cancel handlers.

7. **P2 — Extract shared fake repo factory.** Eliminate ~136 lines of duplicated test boilerplate.

8. **P2 — Fix `any` casts in test mocks.** Use proper return types.

---

_End of review. This code would not pass review as-is. The throw-safety violations are shipping-critical._
