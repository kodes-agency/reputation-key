# Review: Goal Infrastructure + Server + Jobs (FURIOUS MODE)

## Verdict

**FAIL** — Non-transactional write in `createGoalAndProgress` can corrupt data. Business logic leaked into infrastructure. Event handler can throw and isn't idempotent. Multiple convention violations in server functions.

---

## Critical Issues (P0)

### P0-1. `goal.repository.ts:190-201` — `createGoalAndProgress` is NOT in a transaction

```typescript
createGoalAndProgress: async (goal, progress) => {
    return trace('goal.createGoalAndProgress', async () => {
      await db.insert(goals).values({
        ...goalToInsertRow(goal),
        id: goal.id as string,
      })
      await db.insert(goalProgress).values({        // <-- SECOND INSERT
        ...goalProgressToInsertRow(progress),
        id: progress.id as string,
      })
    })
},
```

Two independent INSERT statements, no `db.transaction()` wrapper. If the second INSERT fails (connection drop, constraint violation, disk full), you have an orphan goal with NO progress row. The reconciliation job and spawn job both call this. Every spawned recurring instance is one network hiccup away from a broken goal. This is the kind of thing that causes 3 AM pages. Wrap it in `db.transaction(async (tx) => { ... })` or use `db.batch()`.

### P0-2. `on-metric-recorded.ts:39-103` — Handler CAN throw, violates "don't throw" convention

```typescript
export function onMetricRecorded(deps: OnMetricRecordedDeps) {
  return async (event: MetricRecorded): Promise<void> => {
    return trace('event.onMetricRecorded', async () => {
      // ...
      for (const goal of affectedGoals) {
        const result = await goalRepo.incrementProgress(
          goal.id,
          goal.aggregationFunction,
          event.value,
        )
        // ...
      }
    })
  }
}
```

No try/catch anywhere. `incrementProgress` explicitly throws on line 253-254:

```typescript
if (!result[0]) {
  throw new Error(`incrementProgress: no progress row for goal ${goalId}`)
}
```

If this throws, the entire handler blows up. The convention says: **"Handlers: idempotent, don't throw, log via shared logger."** Every other handler (on-portal-deleted, on-staff-unassigned, on-team-deleted) properly catches errors and logs them. This one doesn't even take a `getLogger` in its deps type. It's the odd one out and the most dangerous one — it processes real-time metric events.

### P0-3. `on-metric-recorded.ts:25-34` — Business rule in infrastructure layer

```typescript
function shouldEmitCompleted(goal: Goal): boolean {
  if (goal.aggregationFunction === 'avg') {
    if (goal.goalType === 'one_shot' || goal.goalType === 'recurring') {
      return false
    }
  }
  return true
}
```

This is a **domain decision**: "Should this goal type emit a completion event?" It determines business behavior based on goal type + aggregation function. The convention says **"infrastructure/ MUST NOT: contain business rules."** This function belongs in `domain/progress-strategy.ts` or `domain/types.ts`, not in an event handler in infrastructure.

### P0-4. `on-metric-recorded.ts` — Not idempotent; duplicate event = double increment

If `metric.recorded` is delivered twice (EventBus retry, network glitch, at-least-once delivery), the handler will:

1. Find the same goals again
2. Increment progress AGAIN
3. Potentially emit duplicate `goal.progress_updated` and `goal.completed` events

There's no dedup key check, no event ID tracking, no guard. In a system where the reconciliation job exists as a safety net, you'd expect the real-time handler to at least check if this event was already processed. The convention says handlers must be **idempotent**. This one is the opposite of idempotent.

---

## Major Issues (P1)

### P1-1. ALL server functions missing `clearTenantCache()` — `goals.ts`, `staff-goals.ts`

The convention requires **every** server function to call `clearTenantCache()` after completion. None of the 6 server functions (`createGoal`, `updateGoal`, `cancelGoal`, `listGoals`, `getGoal`, `listStaffGoals`) call it. This means stale cached data from one tenant could leak to another if the cache layer doesn't properly namespace. In a multi-tenant SaaS, this is negligence.

### P1-2. ALL server functions missing `catchUntagged` — `goals.ts`, `staff-goals.ts`

Convention requires: "catchUntagged for non-domain errors." Instead, every server function uses:

```typescript
} catch (e) {
  if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
  throw e
}
```

This is a raw try/catch that re-throws non-domain errors with no tagging or wrapping. `catchUntagged` presumably wraps the error with context (trace ID, function name, etc.) for observability. The current pattern loses error context.

### P1-3. `index.ts:26-33` — Duplicate `events` and `eventBus` in deps type

```typescript
export type RegisterGoalHandlersDeps = Readonly<{
  events: EventBus // <-- first EventBus
  goalRepo: GoalRepository
  cancelGoalFn: CancelGoalFn
  eventBus: EventBus // <-- SECOND EventBus (same type, same object)
  clock: () => Date
  getLogger: typeof getLoggerType
}>
```

And in `bootstrap.ts:176-183`:

```typescript
registerGoalEventHandlers({
    events: container.eventBus,
    eventBus: container.eventBus,    // <-- SAME OBJECT, TWO NAMES
    ...
})
```

Pick ONE name. Having both `events` and `eventBus` for the same object is confusing and suggests copy-paste slop. Every other context uses a single event bus reference.

### P1-4. `goal.repository.ts:285-317` — AVG `incrementProgress` does two non-transactional updates with race condition

```typescript
if (aggregation === 'avg') {
    // First UPDATE: increment sum and count
    const result = await db
      .update(goalProgress)
      .set({
        currentSum: sql`${goalProgress.currentSum} + ${delta}`,
        currentCount: sql`${goalProgress.currentCount} + 1`,
      })
      .where(eq(goalProgress.goalId, goalId))
      .returning(...)

    // Second UPDATE: set currentValue to recomputed average
    await db
      .update(goalProgress)
      .set({ currentValue: newAvg })
      .where(eq(goalProgress.goalId, goalId))
}
```

Two separate UPDATE queries, not in a transaction. Between the two updates, another concurrent `incrementProgress` call for the same goal could:

1. Read stale `currentSum`/`currentCount` from before the second UPDATE
2. Compute a wrong average
3. Write a wrong `currentValue`

In PostgreSQL, this should be a single atomic UPDATE:

```sql
UPDATE goal_progress SET
  current_sum = current_sum + $1,
  current_count = current_count + 1,
  current_value = (current_sum + $1) / (current_count + 1)
WHERE goal_id = $2
RETURNING ...
```

### P1-5. No tenant isolation test for `goal.repository.ts`

Convention says: **"Every repo: tenant isolation test."** There is NO test file for `goal.repository.ts` at all. Zero tests. The mapper has tests, the handlers have tests, the jobs have tests, but the repository — the most critical piece for tenant safety — has NO tests. Every query should be tested to confirm that `organizationId` filtering works. This is the ONE place where a missing filter causes data leakage between tenants, and there's ZERO test coverage.

### P1-6. No mapper round-trip test — `goal.mapper.test.ts`

Convention says: **"Mappers: round-trip tests."** The test file tests `goalFromRow` (row → domain) and validation, but there's NO round-trip test: `domain → goalToInsertRow → (simulated insert) → goalFromRow → domain`. This means if `goalToInsertRow` drops a field or maps something incorrectly, you'll never know until production data is corrupt.

### P1-7. `goal.schema.ts:31` — `staffId` has no FK, no cascade delete

```typescript
staffId: varchar('staff_id', { length: 255 }),
```

Compare with:

```typescript
portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }),
teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
```

`portalId` and `teamId` have FK constraints with cascade deletes. `staffId` has NEITHER. If a staff assignment is deleted (which is the whole point of the `staff.unassigned` handler), the goal's `staffId` becomes a dangling reference. The handler cancels active goals, but what about completed/expired goals with this staffId? They point to a non-existent entity. The schema is inconsistent.

---

## Minor Issues (P2)

### P2-1. `goal.mapper.ts:36-42` — Hardcoded `VALID_METRIC_KEYS` duplicates shared domain data

```typescript
const VALID_METRIC_KEYS: readonly MetricKey[] = [
  'portal.scan',
  'portal.rating',
  'portal.feedback',
  'portal.review_link_click',
  'property.review',
]
```

This list is already defined in `shared/domain/metric-keys.ts` as `METRIC_KEYS`. If someone adds a new metric key to the shared module and forgets to update the mapper, new metrics will silently throw "Invalid metricKey" at runtime. The mapper should import from shared, not duplicate.

### P2-2. `helpers.ts:128-129` — `daysRemaining` uses `new Date()` instead of injected clock

```typescript
export function daysRemaining(periodEnd: Date | null): number | null {
  if (periodEnd === null) return null
  const now = new Date() // <-- Real clock, untestable without vi.useFakeTimers()
  return Math.ceil((periodEnd.getTime() - now.getTime()) / MS_PER_DAY)
}
```

Every other piece of the codebase uses an injected `clock: () => Date` for testability. This helper uses `new Date()` directly. The tests correctly use `vi.useFakeTimers()` to work around it, but that's a code smell. The function signature should accept an optional `now?: Date` parameter.

### P2-3. `helpers.ts:150` — `formatDatePart` uses local timezone instead of UTC

```typescript
function formatDatePart(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
```

`getMonth()` and `getDate()` return LOCAL timezone values. If the server is in UTC+5, a date stored as `2026-01-01T23:00:00Z` would display as "Jan 2" instead of "Jan 1". All other date handling in the project uses UTC methods (`getUTCMonth`, `getUTCDate`). This is inconsistent.

### P2-4. `helpers.ts:207-220` — `goalTypeLabel` has unreachable `default` branch

```typescript
export function goalTypeLabel(type: string): string {
  switch (type) {
    // ...
    default:
      return type
  }
}
```

The parameter type is `string`, not `GoalType`. This means typos like `goalTypeLabel('onehsot')` silently pass through. Should be `(type: GoalType)` with no default — let the compiler catch exhaustiveness.

### P2-5. `goal.schema.ts:54` — `goals_staff_idx` index missing organizationId

```typescript
index('goals_staff_idx').on(t.staffId),
```

This index on just `staffId` without `organizationId` means a query filtering by both (`WHERE staff_id = $1 AND organization_id = $2`) can't fully utilize the index. Other composite indexes include orgId. This one doesn't. For a multi-tenant system, every index should include orgId as a leading or included column for tenant-scoped queries.

### P2-6. `goals.ts:125` — Inconsistent return shape between server functions

- `createGoal` returns `result._unsafeUnwrap()` (bare goal)
- `updateGoal` returns `{ goal: result._unsafeUnwrap() }`
- `cancelGoal` returns `{ goal: result._unsafeUnwrap() }`
- `getGoal` returns `result._unsafeUnwrap()` (bare goal)

Why does `updateGoal` wrap in `{ goal: ... }` while `createGoal` and `getGoal` don't? Pick ONE pattern. Either all return bare domain objects, or all return `{ goal: ... }`.

---

## Nits (P3)

### P3-1. `on-metric-recorded.test.ts:132` — `vi.fn()` used without explicit import

The file imports `{ describe, it, expect, beforeEach }` from vitest but uses `vi.fn()` on line 132 without importing `vi`. This only works if vitest globals are enabled. Fragile.

### P3-2. `makeGoal` helper duplicated across 7+ test files

The same `makeGoal` factory function is copy-pasted across:

- `on-metric-recorded.test.ts`
- `on-portal-deleted.test.ts`
- `on-staff-unassigned.test.ts`
- `on-team-deleted.test.ts`
- `reconcile-goal-progress.job.test.ts`
- `spawn-recurring-instances.job.test.ts`
- `helpers.test.ts`

Extract to `src/contexts/goal/testing/goal-factory.ts`.

### P3-3. `goal.schema.ts:42` — `recurrenceRule` type is `{ frequency: string }` not narrowed

```typescript
recurrenceRule: jsonb('recurrence_rule').$type<{ frequency: string }>(),
```

Should be `$type<RecurrenceRule>()` or at least `{ frequency: 'weekly' | 'monthly' | 'quarterly' }`. Using `string` loses type safety at the schema boundary.

### P3-4. `reconcile-goal-progress.job.test.ts:137-143` — Fake metric repo typed as `MetricRepository` instead of `MetricPublicApi`

```typescript
const metricRepo: MetricRepository = {
  queryAggregate: async () => aggregateResponse,
  insertReading: async () => {
    throw new Error('not used')
  },
  findByOrganizationId: async () => [],
}
```

The production code uses `MetricPublicApi`, but the test types the fake as `MetricRepository` which is a different (wider) interface. This means the test fake could satisfy the repo interface while the production code uses a narrower public API — any signature mismatch would be caught only at runtime.

### P3-5. `spawn-recurring-instances.job.ts:36-39` — Filters findAllActive in JS instead of querying DB

```typescript
const templates = await deps.goalRepo.findAllActive()
const recurringTemplates = templates.filter(
  (g) => g.goalType === 'recurring' && g.parentGoalId === null,
)
```

The port already has `findActiveRecurringTemplates(organizationId)` which does this at the DB level. The spawn job fetches ALL active goals (potentially thousands) just to filter them in JavaScript. Wasteful. Should use the targeted query.

### P3-6. `ui/helpers.ts:237-247` — `progressBarColorClass` has unreachable default for known color names

The `default` branch catches `'gray'` and everything else. Since `progressBarColor()` only returns `'green'`, `'blue'`, or `'gray'`, the default is technically reachable only for gray. But the switch should be exhaustive over those three values.

---

## Positive Findings

- **Repository pattern** is clean functional style: `createGoalRepository(db)` → `Readonly<{ method }>`. No classes, no `this`, no enums. Exactly right.

- **Tenant isolation on all CRUD queries** is solid. Every user-facing query (`getById`, `update`, `list`, `listInstances`, `cancelByParent`, `findActiveGoalsByMetric`) correctly filters by `organizationId`. The `findAllActive` exception is intentional for batch jobs.

- **Server function structure** is consistent: `tracedHandler` → `headersFromContext()` → `resolveTenantContext()` → `can()` permission check → use case call → error mapping. Every function follows this pattern.

- **Entity removal handlers** (portal, team, staff) are properly idempotent, catch errors, log them, and continue processing remaining goals. The error handling pattern with `result.isErr()` + `getLogger().error()` is exactly right.

- **Error mapping with `.exhaustive()`** ensures TypeScript catches new error codes at compile time. The `goalErrorStatus` function covers all `GoalErrorCode` variants.

- **Event naming** is correct past-tense: `metric.recorded`, `staff.unassigned`, `portal.deleted`, `team.deleted`.

- **FK cascades** on `propertyId`, `portalId`, `teamId` in the schema ensure goals are cleaned up when their parent entity is deleted.

- **Comprehensive indexes** cover all common query patterns (org, org+property, org+status, parent, staff, team).

- **UI helpers** are pure functions with no side effects, no React imports, no DOM access. Clean and testable.

- **Mapper validation** catches invalid database values at the boundary with `assertLiteral`. Good defense against schema drift.

- **Test coverage** is thorough for handlers (all four), mappers, jobs, and UI helpers. Tests are well-structured with clear `describe/it` blocks and meaningful assertions.

- **Bootstrap registration** correctly wraps job handlers with the contravariance pattern (lambda + type assertion) for BullMQ compatibility.

- **Worker scheduling** properly schedules both goal jobs (reconciliation hourly, spawn daily) in the worker entry point.

---

## Files Reviewed

1. `src/contexts/goal/CONTEXT.md`
2. `src/shared/db/schema/goal.schema.ts`
3. `src/contexts/goal/domain/types.ts`
4. `src/contexts/goal/domain/events.ts`
5. `src/contexts/goal/domain/errors.ts`
6. `src/contexts/goal/application/ports/goal.repository.ts`
7. `src/contexts/goal/application/dto/goal.dto.ts`
8. `src/shared/events/events.ts`
9. `src/contexts/goal/infrastructure/repositories/goal.repository.ts`
10. `src/contexts/goal/infrastructure/mappers/goal.mapper.ts`
11. `src/contexts/goal/infrastructure/mappers/goal.mapper.test.ts`
12. `src/contexts/goal/infrastructure/event-handlers/index.ts`
13. `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts`
14. `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.test.ts`
15. `src/contexts/goal/infrastructure/event-handlers/on-portal-deleted.ts`
16. `src/contexts/goal/infrastructure/event-handlers/on-portal-deleted.test.ts`
17. `src/contexts/goal/infrastructure/event-handlers/on-staff-unassigned.ts`
18. `src/contexts/goal/infrastructure/event-handlers/on-staff-unassigned.test.ts`
19. `src/contexts/goal/infrastructure/event-handlers/on-team-deleted.ts`
20. `src/contexts/goal/infrastructure/event-handlers/on-team-deleted.test.ts`
21. `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts`
22. `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.test.ts`
23. `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts`
24. `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.test.ts`
25. `src/contexts/goal/server/goals.ts`
26. `src/contexts/goal/server/goals.test.ts`
27. `src/contexts/goal/server/staff-goals.ts`
28. `src/contexts/goal/server/staff-goals.test.ts`
29. `src/contexts/goal/ui/helpers.ts`
30. `src/contexts/goal/ui/helpers.test.ts`
31. `src/contexts/goal/build.ts`
32. `src/composition.ts`
33. `src/bootstrap.ts`
34. `src/worker/index.ts`
