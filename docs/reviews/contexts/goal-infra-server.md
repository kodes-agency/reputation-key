# Goal Context — Infrastructure & Server Review

**Date:** 2026-06-10
**Scope:** `src/contexts/goal/infrastructure/`, `src/contexts/goal/server/`
**Dimensions:** D5 (Repository Ports), D7 (Multi-Tenancy), D8 (Server Functions), D12 (Context Doc Accuracy), D15 (Error Handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 2     |
| MAJOR    | 5     |
| MINOR    | 4     |
| NIT      | 2     |

---

## BLOCKER

### [D7] BLOCKER `findAllActive()` loads all tenants' goals — cross-tenant data exposure

File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:179-183
Quote: ```ts
findAllActive: async () => {
return trace('goal.findAllActive', async () => {
const rows = await db.select().from(goals).where(eq(goals.status, 'active'))
return rows.map(goalFromRow)
})
},

````
Rule:  D7 — every DB query on tenant-owned table must include organizationId
Fix:   Accept `organizationId` parameter and add `eq(goals.organizationId, organizationId)` to WHERE. The port already documents this as safe for background jobs, but both callers (reconcile + spawn) process org-scoped data anyway. Alternatively, if intentional cross-tenant batch processing is required, add a dedicated `findAllActiveGlobal()` method with an explicit comment and ensure callers never expose results to a single-tenant context.

### [D7] BLOCKER spawn-recurring job uses `findAllActive()` without orgId filter
File: src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts:40-43
Quote: ```ts
const templates = await deps.goalRepo.findAllActive()
const recurringTemplates = templates.filter(
  (g) => g.goalType === 'recurring' && g.parentGoalId === null,
)
````

Rule: D7 — every DB query on tenant-owned table must include organizationId; also wastes memory loading non-recurring goals
Fix: Use `findActiveRecurringTemplates(organizationId)` which is already defined on the port (line 52-54) and implemented in the repo (line 186-201). The port exists and is org-scoped — the job should iterate per-org or accept orgId. If the job must be global, call `findActiveRecurringTemplates` in a loop per organization.

---

## MAJOR

### [D5] MAJOR `upsertProgress` tenant check uses separate SELECT — race condition

File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:354-365
Quote: ```ts
  upsertProgress: async (goalId, organizationId, aggregation, delta) => {
    return trace('goal.upsertProgress', async () => {
      const [row] = await db
        .select({ organizationId: goals.organizationId })
        .from(goals)
        .where(eq(goals.id, goalId))
        .limit(1)
      if (!row || row.organizationId !== organizationId) {
        throw new Error(`upsertProgress: goal ${goalId} not found or tenant mismatch`)
}

````
Rule:  D7 — tenant check should be in the same atomic operation as the write
Fix:   Use a CTE or add organizationId into the upsert's WHERE clause via a JOIN/subquery so the check and write are atomic. The current SELECT-then-INSERT/UPDATE allows TOCTOU race.

### [D15] MAJOR `throw new Error()` in repository — infrastructure throws bare Error
File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:35-36
Quote: ```ts
if (!result[0]) {
  throw new Error('Goal insert failed — no row returned')
}
````

Rule: D15 — no `throw new Error` in infrastructure; should use tagged error or structured failure
Fix: Define a repository-level tagged error (e.g., `{ _tag: 'RepoError', operation: 'insert', entity: 'goal' }`) or return `Result<Goal, RepoError>`. Same pattern repeated at lines 126, 295, 317, 341, 350, 364, 392, 423, 457, 466.

### [D12] MAJOR CONTEXT.md lists `server/` as `goals.ts, staff-goals.ts` but 4 split files exist as dead code

File: src/contexts/goal/CONTEXT.md:77
Quote: ```
server/ goals.ts, staff-goals.ts

````
Rule:  D12 — context documentation must match actual code
Fix:   Either remove the dead split files (`create-goal.ts`, `update-goal.ts`, `cancel-goal.ts`, `goal-queries.ts`, plus `goal-shared.ts`) or update CONTEXT.md to reflect them. Currently no route imports from the split files — only `goals.ts` and `staff-goals.ts` are used.

### [D12] MAJOR CONTEXT.md missing `goal-shared.ts` from server layer listing
File: src/contexts/goal/CONTEXT.md:77
Quote: ```
server/              goals.ts, staff-goals.ts
````

Rule: D12 — context documentation must match actual code
Fix: If `goal-shared.ts` is intentional (shared utilities for the monolithic server file), add it to the architecture listing. Currently it only re-exports utilities used by the dead split files.

### [D12] MAJOR CONTEXT.md does not list `getAssignedPortals` or `portalRepo.findGroupIdsByPortalIds` as dependencies

File: src/contexts/goal/server/staff-goals.ts:53-64
Quote: ```ts
const portalIds = await container.useCases.getAssignedPortals(
{ userId: ctx.userId, propertyId },
ctx,
)
...
const groupIds = await container.portalRepo.findGroupIdsByPortalIds(
ctx.organizationId,
portalIds,
)

````
Rule:  D12 — context documentation must list cross-context dependencies
Fix:   Add `getAssignedPortals` (staff context) and `portalRepo.findGroupIdsByPortalIds` to CONTEXT.md dependencies. The doc only mentions `MetricPublicApi` and `PortalGroupPublicApi.findGroupForPortal`.

---

## MINOR

### [D8] MAJOR Duplicate server functions — monolithic `goals.ts` and split files define identical endpoints
File: src/contexts/goal/server/create-goal.ts:25-111
Quote: ```ts
export const createGoal = createServerFn({ method: 'POST' })
  .inputValidator(createGoalSchema)
````

Rule: D8 — server functions should be defined once
Fix: Remove the dead split files (`create-goal.ts`, `update-goal.ts`, `cancel-goal.ts`, `goal-queries.ts`, `goal-shared.ts`). They duplicate the handlers in `goals.ts` and are not imported anywhere.

### [D15] MINOR `goals.ts` catch block re-throws untagged errors without wrapping

File: src/contexts/goal/server/goals.ts:126-128
Quote: ```ts
} catch (e) {
if (isGoalError(e)) throwContextError('GoalError', e, goalErrorStatus(e.code))
throw e
}

````
Rule:  D15 — consistent error envelope; bare `throw e` may propagate unstructured errors to client
Fix:   Use `catchUntagged(e)` (imported and used in split files) instead of bare `throw e`, matching the pattern in `staff-goals.ts:98` and `cancel-goal.ts:77`.

### [D5] MINOR `getProgress`, `getProgressBatch`, `updateProgress` lack organizationId filter
File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:133-142
Quote: ```ts
// Safe: goalId is a globally unique UUID — no cross-tenant risk
getProgress: async (goalId) => {
  ...
  .where(eq(goalProgress.goalId, goalId))
````

Rule: D5/D7 — defense-in-depth: even UUID-keyed rows benefit from orgId in WHERE
Fix: The comment justifies this, and `goalId` is indeed a UUID, so this is acceptable. However, for defense-in-depth, consider accepting orgId and joining through the goals table. Low risk.

### [D8] MINOR `staff-goals.ts` directly accesses `container.goalRepo` and `container.portalRepo` — bypasses use cases

File: src/contexts/goal/server/staff-goals.ts:68-89
Quote: ```ts
const allGoals = await container.goalRepo.list({
organizationId: ctx.organizationId,
propertyId,
})
...
const progressMap = await container.goalRepo.getProgressBatch(allGoalIds)

````
Rule:  D8 — server functions should go through use cases, not access repos directly
Fix:   Create a `listStaffGoals` use case or reuse `listGoals` with appropriate filtering. The current approach loads all org goals then filters in-memory, which is fragile and bypasses the application layer.

---

## NIT

### [D12] NIT CONTEXT.md permission matrix says Staff has `goal.create` but server hardcodes "AccountAdmin or PropertyManager"
File: src/contexts/goal/CONTEXT.md:119-124
Quote: ```
| `goal.create` | ✓            | ✓               | ✓     |
````

Rule: D12 — context documentation must match actual code
Fix: Either update the permission matrix to show Staff = — for `goal.create` (matching the server's error message), or update the server to allow Staff to create goals.

### [D5] NIT `goalProgressToInsertRow` omits `organizationId` — relies on JOIN through `goalId`

File: src/contexts/goal/infrastructure/mappers/goal.mapper.ts:139-148
Quote: ```ts
export const goalProgressToInsertRow = (
progress: Omit<GoalProgress, 'id'>,
): typeof goalProgress.$inferInsert => ({
goalId: progress.goalId as string,

```
Rule:  D5 — if goal_progress table has an organizationId column, it should be populated
Fix:   Verify schema. If `goal_progress` has no `organizationId` column, this is fine. If it does, the mapper must pass it through for tenant-scoped queries.
```
