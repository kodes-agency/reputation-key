# Infra-03: Exhaustive Review — Goal Background Jobs & Tests

**Reviewer**: Angry Senior Staff Engineer  
**Date**: 2026-05-24  
**Branch**: feat/phase-15c-goal-ui  
**Files reviewed**:

- `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts` (178 lines)
- `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.test.ts` (397 lines)
- `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts` (212 lines)
- `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.test.ts` (404 lines)

---

## Executive Summary

I read every single line of all four files. These jobs have **five P0s** that can cause **silent data loss or data duplication**. The reconcile job can skip goals on partial failure, expire goals that met their targets, and silently ignore goals with no progress row. The spawner has a race condition that can produce **duplicate instances** under concurrent execution and can **never spawn the first instance** for a new template. The test suite has a cross-context import violation and is missing entire categories of failure tests.

Both jobs also embed business logic (expiry/completion rules) directly in the infrastructure layer — a direct violation of CONTEXT.md.

---

## File 1: `reconcile-goal-progress.job.ts`

### P0 — Critical

#### 1. No try/catch around loop body — partial failure kills entire job

**File**: `reconcile-goal-progress.job.ts:46-110`  
**Severity**: P0

```ts
for (const goal of goals) {
  // ... 70 lines of DB calls, metric queries, updates ...
}
```

If `deps.metricApi.queryAggregate()` or `deps.goalRepo.updateProgress()` throws for goal #3 of 500, the entire loop aborts. Goals 4–500 are **silently skipped**. They won't be reconciled until the next job run, and if the same error repeats, they may **never** be reconciled.

**Fix**: Wrap the loop body in try/catch. Log the error, increment a `failed` counter, and `continue`.

---

#### 2. Only AVG goals get "completed" at period end — SUM/COUNT/MAX goals that met targets get expired

**File**: `reconcile-goal-progress.job.ts:93`  
**Severity**: P0

```ts
if (goal.aggregationFunction === 'avg' && value >= goal.targetValue) {
  // completed
} else {
  // expired
}
```

This logic says: "At period end, ONLY AVG goals can be completed. Everything else expires." A SUM goal that reached 100/100 target will be marked **expired** if the event-driven path didn't already catch it. Any race condition, missed event, or bug in the increment path means the reconcile job — the safety net — will **incorrectly expire** a successful goal.

**Fix**: Check `value >= goal.targetValue` for ALL aggregation types, not just AVG.

---

#### 3. Goals without existing progress rows are silently skipped

**File**: `reconcile-goal-progress.job.ts:73-83`  
**Severity**: P0

```ts
const progress = await deps.goalRepo.getProgress(goal.id)
if (progress && progress.currentValue !== value) {
  await deps.goalRepo.updateProgress(...)
}
```

If `progress` is `null` (no progress row exists yet — e.g., newly created goal), the entire reconciliation is **silently skipped**. The goal will never get a progress value from reconciliation. It will sit at "no progress" until an event-driven increment happens, which may never happen if the metric data already exists.

**Fix**: When progress is null, call `deps.goalRepo.insertProgress()` to create the initial row.

---

### P1 — High

#### 4. Business logic (expiry/completion rules) in infrastructure layer

**File**: `reconcile-goal-progress.job.ts:86-109`  
**Severity**: P1

Lines 86–109 contain explicit business rules: "when to expire", "when to complete", "AVG goals get special completion treatment". This is domain/application logic embedded directly in a job handler. CONTEXT.md says: **"Infrastructure layer: forbidden from containing business rules."**

**Fix**: Extract an `ApplicationService.reconcileGoal(goal, now)` or at minimum move the expiry/completion logic to a domain service. The job should only orchestrate: "fetch goals → call reconcile service → count results."

---

### P2 — Medium

#### 5. Floating-point `!==` comparison may cause unnecessary writes

**File**: `reconcile-goal-progress.job.ts:74`  
**Severity**: P2

```ts
if (progress && progress.currentValue !== value) {
```

For AVG aggregation, `value` is computed as `aggregate.sum / aggregate.count`. Due to floating-point representation, this could produce `4.999999999999999` vs `5.0` and trigger a spurious update. Every job run would write the same logical value.

**Fix**: Use an epsilon comparison for floating-point, or round to a defined precision.

---

#### 6. No transactional guarantee between progress update and status update

**File**: `reconcile-goal-progress.job.ts:75+103`  
**Severity**: P2

If `updateProgress()` on line 75 succeeds but `update()` on line 103 fails (or vice versa), the goal has inconsistent state: progress says one thing, status says another. These two writes are not wrapped in a transaction.

---

#### 7. `goalsReconciled` metric includes skipped templates

**File**: `reconcile-goal-progress.job.ts:112-116`  
**Severity**: N3

```ts
goalsReconciled: goals.length
```

This counts ALL active goals including recurring templates that were skipped (line 48-50). The metric is misleading — "reconciled" implies work was done. Should be `goalsConsidered` or subtract skipped templates.

---

### Structural observations

- **Line 5**: `import type { Job } from 'bullmq'` — correct, typed import.
- **Line 10-11**: Imports `MetricReadingsQuery`, `MetricReadingsAggregate`, and `MetricPublicApi` from `#/contexts/metric/application/public-api` — **GOOD**, follows cross-context convention.
- **Line 14**: `import { buildProgressQuery }` from domain — OK, domain import from same context.
- **Line 17**: `import { trace }` — **GOOD**, job is wrapped in `trace()`.
- **Line 25-30**: `ReconcileGoalProgressDeps` is `Readonly<{...}>` — follows functional style.
- **Line 34-122**: Factory function — no class, no `this` — follows conventions.
- **Line 135-161**: `progressQueryToMetricReadingsQuery` — exhaustive switch on timeFilter.tag — good.
- **Line 164-178**: `computeValue` — exhaustive switch — good. Handles `0/0` for avg correctly.

---

## File 2: `reconcile-goal-progress.job.test.ts`

### P1 — High

#### 8. Cross-context import violation in test

**File**: `reconcile-goal-progress.job.test.ts:9-12`  
**Severity**: P1

```ts
import type {
  MetricReadingsAggregate,
  MetricRepository,
} from '#/contexts/metric/application/ports/metric.repository'
```

The test imports `MetricReadingsAggregate` AND `MetricRepository` directly from the metric context's **internal ports** instead of from `public-api.ts`. CONTEXT.md says: **"Cross-context imports: from `application/public-api.ts` only."** The fact that the test also creates a `MetricRepository` object and passes it as `metricApi: MetricPublicApi` means the test bypasses the public API abstraction entirely.

`MetricRepository` is NOT exported from `public-api.ts`. This is a direct layer violation.

**Fix**: Import `MetricReadingsAggregate` from `public-api.ts`. Create a fake that satisfies `MetricPublicApi` (which only has `queryAggregate`), not `MetricRepository`.

---

### P2 — Medium

#### 9. Fake `findAllActive` doesn't match real behavior

**File**: `reconcile-goal-progress.job.test.ts:100`  
**Severity**: P2

```ts
findAllActive: async () => goals.filter((g) => g.status === 'active'),
```

The fake filters by `status === 'active'` in-memory, but the test's `makeGoal` defaults status to `'active'`, so every pushed goal is always active. Tests never verify what happens when non-active goals (completed, expired) are returned — the real `findAllActive()` should never return them, but the fake's behavior masks this.

---

### N3 — Nit/Style

#### 10. Repeated `as string` casts on branded IDs

**File**: `reconcile-goal-progress.job.test.ts:89, 124, 127, 129, 132, 181, 194, etc.`  
**Severity**: N3

Throughout the test: `id as string`, `goalId as string`, `data.goalId as string`. These break branded type safety. While acceptable in test fakes, consider a helper `toKey(id: GoalId): string` for consistency.

---

### Missing Tests — P1

The test file has 397 lines and covers: progress update, no-update-same-value, one-shot expiry, no-expiry-future-period, AVG completion, AVG expiry, rolling window, and recurring template skip. **Good start.** But critically missing:

#### 11. No error handling tests

- No test for `buildProgressQuery` returning an error (source line 54-59)
- No test for `metricApi.queryAggregate` throwing
- No test for `goalRepo.updateProgress` throwing
- No test for `goalRepo.update` throwing
- No test for partial failure (5 goals, 3rd throws, verify 4th and 5th still processed)

**Severity**: P1 — without these, the P0 "no try/catch" bug in the source is invisible.

#### 12. No test for goals with no progress row

- No test for `getProgress()` returning `null` (source line 73)

**Severity**: P1 — this is the P0 bug (#3 above) and no test exercises it.

#### 13. No test for SUM/COUNT/MAX goals meeting target at period end

- No test verifying a SUM goal that hit 100/100 target gets "completed" (not "expired")

**Severity**: P1 — this is the P0 bug (#2 above) and no test exercises it.

#### 14. No test for concurrent execution

- What happens if two workers run reconcile simultaneously?

**Severity**: P2

#### 15. No timezone/period boundary edge cases

- `periodEnd` at exactly `now` (boundary)
- `periodEnd` 1ms before `now`
- DST transitions

**Severity**: P2

---

## File 3: `spawn-recurring-instances.job.ts`

### P0 — Critical

#### 16. No try/catch around loop body — partial failure kills entire job

**File**: `spawn-recurring-instances.job.ts:43-106`  
**Severity**: P0

Same issue as reconcile job. If `createGoalAndProgress()` throws for template #2 of 50, templates 3–50 are **silently skipped**. Their instances are never spawned.

**Fix**: Wrap the loop body in try/catch. Log the error, increment a `failed` counter, and `continue`.

---

#### 17. Race condition: duplicate instances under concurrent execution

**File**: `spawn-recurring-instances.job.ts:48-104`  
**Severity**: P0

The job reads `findLatestInstance()` and then writes `createGoalAndProgress()`. Between these two operations, another worker (or a retried job) could:

1. Also call `findLatestInstance()` — gets the same `latest`
2. Compute the same `nextStart`
3. Call `createGoalAndProgress()` — creates a duplicate instance

There is **no unique constraint** check, no `INSERT ... WHERE NOT EXISTS`, no idempotency key. Two concurrent runs will produce **duplicate instances** for the same period.

**Fix**: Either:

- Add a unique constraint on `(parentGoalId, periodStart)` at the DB level and handle the conflict
- Or use `findLatestInstance` + `createGoalAndProgress` in a single transactional `SELECT ... FOR UPDATE` + `INSERT` pattern
- Or check if an instance with `periodStart = nextStart` already exists before creating

---

#### 18. New recurring templates can never spawn their first instance

**File**: `spawn-recurring-instances.job.ts:49`  
**Severity**: P1 (design issue, not runtime crash)

```ts
const latest = await deps.goalRepo.findLatestInstance(template.id)
if (!latest?.periodEnd) continue
```

If a recurring template has NO instances yet (brand new), `findLatestInstance` returns `null`, and the job `continue`s. The template will **never** spawn its first instance unless something external creates a seed instance.

**Fix**: When `latest` is null, compute the first period start from the template's creation date or from a configured start date on the recurrence rule.

---

### P2 — Medium

#### 19. Loads ALL active goals when only recurring templates needed

**File**: `spawn-recurring-instances.job.ts:36-39`  
**Severity**: P2

```ts
const templates = await deps.goalRepo.findAllActive()
const recurringTemplates = templates.filter(...)
```

`findAllActive()` returns every active goal in the system (potentially thousands of one-shot, rolling, and recurring instances). The job then filters to recurring templates in-memory. The repository has `findActiveRecurringTemplates()` which would be more efficient, but it requires an `organizationId` parameter.

**Fix**: Either make `findActiveRecurringTemplates()` accept optional `organizationId` (null = all orgs), or accept the current approach if the goal count is small.

---

#### 20. `MS_PER_DAY` constant redefined every loop iteration

**File**: `spawn-recurring-instances.job.ts:56`  
**Severity**: N3

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000
```

Move to module level.

---

#### 21. No protection against spawning instances for already-started periods

**File**: `spawn-recurring-instances.job.ts:57`  
**Severity**: P2

```ts
if (Math.abs(nextStart.getTime() - now.getTime()) > MS_PER_DAY) {
```

`Math.abs` means the job will spawn if `nextStart` is up to 1 day in the PAST. If a job was delayed by 23 hours, it would spawn an instance whose period already started 23 hours ago. This instance would only have 1 hour of remaining period (for weekly) or ~7 days (for monthly). This is probably fine as catch-up behavior, but it should be documented.

More critically: if `nextStart` is 1.5 days in the past (job was down for 36 hours), the instance is NOT spawned, and the period is **permanently lost** — no catch-up mechanism exists.

**Fix**: Add a `catchUpMissedPeriods` mode that spawns all missed instances, not just the next one.

---

#### 22. Progress initialized with `computedSource: 'reconciliation'`

**File**: `spawn-recurring-instances.job.ts:101`  
**Severity**: N3

```ts
computedSource: 'reconciliation',
```

This progress row wasn't reconciled from metrics — it was freshly created. Should be `'event_increment'` (the default/initial source) or a new `'initial'` source. The `ComputedSource` type only allows `'event_increment' | 'reconciliation'`, so `'event_increment'` is more accurate.

---

#### 23. Quarterly `computePeriodEnd` uses `setUTCMonth(+3, 0)` — verify correctness

**File**: `spawn-recurring-instances.job.ts:171-177`  
**Severity**: N3

```ts
end.setUTCMonth(end.getUTCMonth() + 3, 0)
```

This computes "last day of the month 3 months from start's month." For Q1 (Jan 1 start): `setUTCMonth(3, 0)` = April 0 = March 31. ✓  
For Q2 (Apr 1 start): `setUTCMonth(6, 0)` = July 0 = June 30. ✓  
For Q3 (Jul 1 start): `setUTCMonth(9, 0)` = Oct 0 = Sep 30. ✓  
For Q4 (Oct 1 start): `setUTCMonth(12, 0)` = Jan 0 of next year = Dec 31. ✓

**Correct.** But worth adding a comment explaining the `day 0` trick.

---

### Structural observations

- **Line 9**: `import { buildGoal }` from domain constructor — **GOOD**, uses domain layer.
- **Line 12**: `import { trace }` — **GOOD**, job wrapped in `trace()`.
- **Line 20-25**: `SpawnRecurringInstancesDeps` is `Readonly<{...}>` — follows functional style.
- **Line 29-116**: Factory function — no class, no `this` — correct.
- **Line 135-146**: `computeNextPeriodStart` — exhaustive switch. Good.
- **Line 156-178**: `computePeriodEnd` — exhaustive switch. Good.
- **Line 183-192**: `nextMonday` — handles edge case of periodEnd on Monday correctly (searches from date+1).
- **Line 194-198**: `firstOfNextMonth` — handles month overflow. Good.
- **Line 201-212**: `firstOfNextQuarter` — handles year overflow. Good.

---

## File 4: `spawn-recurring-instances.job.test.ts`

### P2 — Medium

#### 24. Fake `findAllActive` hides the real filtering logic

**File**: `spawn-recurring-instances.job.test.ts:108`  
**Severity**: P2

```ts
findAllActive: async () => state.templates,
```

The fake returns `state.templates` directly as the result of `findAllActive()`. But the real `findAllActive()` would return ALL active goals (one-shots, rolling, instances, templates). The source code then filters to recurring templates (line 37-39 of source). The test never verifies this filtering works because the fake only provides templates.

**Fix**: Have `findAllActive` return a mix of goal types and verify the job correctly filters to recurring templates only.

---

### N3 — Nit/Style

#### 25. Double cast `as unknown as`

**File**: `spawn-recurring-instances.job.test.ts:77`  
**Severity**: N3

```ts
const fakeJob = { id: 'test-job' } as unknown as import('bullmq').Job
```

Works, but an inline `import()` type is unusual. Consider typing it at the top like the reconcile tests do (`{} as Job`).

---

### Missing Tests — P1

The test file has 404 lines and covers: spawning next instance, not spawning when too early, idempotency (run twice with updated latest), monthly anchoring, weekly anchoring, cross-month-boundary week, no-recurrence-rule skip, no-latest-instance skip, empty templates. **Good coverage for happy paths.** But critically missing:

#### 26. No error handling tests

- No test for `buildGoal` returning an error (source line 83-88)
- No test for `createGoalAndProgress` throwing
- No test for `findLatestInstance` throwing

**Severity**: P1

#### 27. No test for concurrent execution (race condition)

- Two handlers running simultaneously against same template — should NOT produce duplicates

**Severity**: P0 (this tests the P0 bug #17)

#### 28. No test for quarterly frequency

- `computeNextPeriodStart` and `computePeriodEnd` both handle `'quarterly'` but no test exercises it

**Severity**: P1

#### 29. No test for leap year / year boundary

- February 29 in leap year
- December → January year boundary for monthly
- Week spanning Dec 29 → Jan 4

**Severity**: P2

#### 30. No test for delayed job (nextStart slightly in the past)

- Job runs 12 hours late — `nextStart` is 12 hours in the past. `Math.abs` should allow it. No test.

**Severity**: P2

#### 31. No test for severely delayed job (nextStart far in the past)

- Job was down for 3 days — `nextStart` is 3 days ago. `Math.abs` prevents spawning. Instance is **permanently lost**. No test.

**Severity**: P2

#### 32. No test for `events` bus usage

- The job injects `EventBus` but never calls `emit()`. Should it? When a new instance is spawned, shouldn't an event be published? No test either way.

**Severity**: P2

---

## Summary Table

| #   | Severity | File                  | Line(s)     | Issue                                                              |
| --- | -------- | --------------------- | ----------- | ------------------------------------------------------------------ |
| 1   | **P0**   | reconcile.job.ts      | 46-110      | No try/catch — one failure kills entire job                        |
| 2   | **P0**   | reconcile.job.ts      | 93          | Only AVG goals completed at period end — SUM/COUNT/MAX get expired |
| 3   | **P0**   | reconcile.job.ts      | 73-83       | Goals with no progress row silently skipped                        |
| 4   | **P1**   | reconcile.job.ts      | 86-109      | Business logic (expiry/completion) in infrastructure layer         |
| 5   | **P2**   | reconcile.job.ts      | 74          | Floating-point `!==` may cause spurious writes                     |
| 6   | **P2**   | reconcile.job.ts      | 75+103      | No transaction between progress update and status update           |
| 7   | **N3**   | reconcile.job.ts      | 112         | `goalsReconciled` includes skipped templates                       |
| 8   | **P1**   | reconcile.job.test.ts | 9-12        | Cross-context import from metric ports (not public-api)            |
| 9   | **P2**   | reconcile.job.test.ts | 100         | Fake `findAllActive` doesn't match real behavior                   |
| 10  | **N3**   | reconcile.job.test.ts | 89,124,127+ | Repeated `as string` casts on branded IDs                          |
| 11  | **P1**   | reconcile.job.test.ts | —           | Missing: error handling tests                                      |
| 12  | **P1**   | reconcile.job.test.ts | —           | Missing: no-progress-row test                                      |
| 13  | **P1**   | reconcile.job.test.ts | —           | Missing: SUM/COUNT/MAX completion test                             |
| 14  | **P2**   | reconcile.job.test.ts | —           | Missing: concurrent execution test                                 |
| 15  | **P2**   | reconcile.job.test.ts | —           | Missing: timezone/boundary edge cases                              |
| 16  | **P0**   | spawn.job.ts          | 43-106      | No try/catch — one failure kills entire job                        |
| 17  | **P0**   | spawn.job.ts          | 48-104      | Race condition — duplicate instances under concurrency             |
| 18  | **P1**   | spawn.job.ts          | 49          | New templates can never spawn first instance                       |
| 19  | **P2**   | spawn.job.ts          | 36-39       | Loads ALL active goals, filters in-memory                          |
| 20  | **N3**   | spawn.job.ts          | 56          | `MS_PER_DAY` constant inside loop                                  |
| 21  | **P2**   | spawn.job.ts          | 57          | No catch-up for severely delayed jobs                              |
| 22  | **N3**   | spawn.job.ts          | 101         | `computedSource: 'reconciliation'` on fresh progress               |
| 23  | **N3**   | spawn.job.ts          | 174         | `day 0` trick undocumented                                         |
| 24  | **P2**   | spawn.job.test.ts     | 108         | Fake hides filtering logic                                         |
| 25  | **N3**   | spawn.job.test.ts     | 77          | Double cast `as unknown as`                                        |
| 26  | **P1**   | spawn.job.test.ts     | —           | Missing: error handling tests                                      |
| 27  | **P0**   | spawn.job.test.ts     | —           | Missing: concurrent execution test                                 |
| 28  | **P1**   | spawn.job.test.ts     | —           | Missing: quarterly frequency test                                  |
| 29  | **P2**   | spawn.job.test.ts     | —           | Missing: leap year / year boundary tests                           |
| 30  | **P2**   | spawn.job.test.ts     | —           | Missing: delayed job (nextStart in past) test                      |
| 31  | **P2**   | spawn.job.test.ts     | —           | Missing: severely delayed job (lost period) test                   |
| 32  | **P2**   | spawn.job.test.ts     | —           | Missing: events bus usage test                                     |

---

## Priority Action Items

### Must fix before merge (P0)

1. **Add try/catch in both job loops** — partial failure must not kill the entire job
2. **Fix expiry logic** — all aggregation types should check `value >= targetValue`, not just AVG
3. **Handle null progress** — create progress row when it doesn't exist
4. **Add duplicate detection in spawner** — unique constraint or existence check before `createGoalAndProgress`
5. **Add concurrent execution tests** for the spawner race condition

### Should fix before merge (P1)

6. Extract business logic from jobs to application/domain services
7. Fix cross-context import in reconcile test (use `public-api.ts`)
8. Handle first-instance spawning for new templates
9. Add error handling tests for both jobs
10. Add test for goals with no progress row
11. Add test for SUM/COUNT/MAX completion at period end
12. Add quarterly frequency test for spawner

### Nice to have (P2/N3)

13. Epsilon comparison for floating-point progress values
14. Transactional guarantees for multi-write operations
15. More efficient query for spawner (use `findActiveRecurringTemplates`)
16. Catch-up mechanism for delayed spawner runs
17. Date/timezone edge case tests
18. Move `MS_PER_DAY` to module level
19. Fix `computedSource` on initial progress rows
