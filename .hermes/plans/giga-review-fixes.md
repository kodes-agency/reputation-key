# Giga Review Fix Plan

> **For Hermes:** Execute fixes for P0 + P1 issues from the Giga Review.

**Goal:** Fix all 7 P0 and top P1 issues identified in the 3-reviewer giga audit.

**Branch:** `feat/phase-15c-goal-ui`

---

## Batch 1 — Data Integrity (P0-1, P0-2) — SEQUENTIAL

### Task 1.1: Wrap `createGoalAndProgress` in a transaction

**File:** `src/contexts/goal/infrastructure/repositories/goal.repository.ts:190-201`

Replace the two independent INSERTs with a `db.transaction()` call. Drizzle supports `db.transaction(async (tx) => { ... })`. Use `tx.insert()` instead of `db.insert()`.

### Task 1.2: Merge AVG `incrementProgress` into single atomic UPDATE

**File:** `src/contexts/goal/infrastructure/repositories/goal.repository.ts:285-317`

Replace two UPDATEs with a single atomic SQL:

```sql
UPDATE goal_progress SET
  current_sum = current_sum + $delta,
  current_count = current_count + 1,
  current_value = (current_sum + $delta) / (current_count + 1)
WHERE goal_id = $goalId
RETURNING ...
```

---

## Batch 2 — Event Handler Safety (P0-3, P0-4, P0-5) — SEQUENTIAL (same files)

### Task 2.1: Move `shouldEmitCompleted` to domain layer

**Move from:** `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts:25-34`
**Move to:** `src/contexts/goal/domain/progress-strategy.ts`

Add `shouldEmitCompleted(goal: Goal): boolean` to progress-strategy.ts and re-export from public-api.

### Task 2.2: Add try/catch + logger to `on-metric-recorded`

**File:** `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts`

- Add `getLogger` to `OnMetricRecordedDeps`
- Wrap per-goal processing in try/catch
- Log errors via shared logger, continue processing remaining goals
- Match pattern from `on-portal-deleted.ts`

### Task 2.3: Deduplicate event handling deps (remove duplicate `events`/`eventBus`)

**File:** `src/contexts/goal/infrastructure/event-handlers/index.ts`

- Remove `events` from `RegisterGoalHandlersDeps`, keep only `eventBus`
- Update `registerGoalEventHandlers` to use `deps.eventBus`

---

## Batch 3 — Use Case Fixes (P0-6, P0-7, P1 validation) — SEQUENTIAL

### Task 3.1: Fix `list-goals` to return Result instead of throwing

**File:** `src/contexts/goal/application/use-cases/list-goals.ts`

- Change return type to `Result<ReadonlyArray<GoalWithProgress>, ListGoalsError>`
- Replace `throw goalError(...)` with `err({ tag: 'forbidden' })`
- Remove `goalError` import from domain

### Task 3.2: Add `targetValue > 0` validation to `update-goal`

**File:** `src/contexts/goal/application/use-cases/update-goal.ts`

Add check: if `targetValue` is provided and ≤ 0, return error.

### Task 3.3: Add `clearTenantCache()` to all 6 goal server functions

**File:** `src/contexts/goal/server/goals.ts`, `src/contexts/goal/server/staff-goals.ts`

Add `clearTenantCache()` call after each server function's main logic, inside the try block.

---

## Batch 4 — Frontend Form Rewrite (P0-8, P0-9, P1 Readonly) — PARALLEL with Batch 3

### Task 4.1: Rewrite `goal-create-form.tsx` with TanStack Form + Zod

**File:** `src/components/features/property/goals/goal-create-form.tsx`

Replace `useState` form with `useForm` from `@tanstack/react-form`, using `createGoalSchema` for validation.

### Task 4.2: Add `Readonly<>` to Props across all 9 goal components

**Files:** All 9 files in `src/components/features/property/goals/`

Change each Props type to `type Props = Readonly<{ ... }>`.

---

## Batch 5 — Route Guards + Schema (P1) — PARALLEL

### Task 5.1: Add `beforeLoad` auth guards to 3 goal routes

**Files:**

- `src/routes/_authenticated/properties/$propertyId/goals.tsx`
- `src/routes/_authenticated/properties/$propertyId/goals/$goalId.tsx`
- `src/routes/_authenticated/properties/$propertyId/goals/new.tsx`

### Task 5.2: Add `staffId` FK constraint to goal schema

**File:** `src/shared/db/schema/goal.schema.ts`

---

## Verification

After all batches:

```bash
npx tsc --noEmit
pnpm test -- --run
```
