# Goal Domain + Application — Exhaustive Review

**Scope:** 20 files (~3,846 lines) — domain types, constructors, progress-strategy, errors, events, DTOs, public-api, repository port, all 5 use cases, all tests
**Branch:** `feat/phase-15c-goal-ui`
**Verdict:** **FAIL** — 9 P0, 30 P1, 35+ P2

## P0 — Data loss / crash / invariant violation

### Domain

1. **`buildGoal` allows `targetValue: NaN`** — `NaN <= 0` is `false`, passes validation. Goal with NaN target persisted.
2. **`buildGoal` allows `targetValue: Infinity`** — same bypass.
3. **`buildGoal` does NOT validate "exactly one FK" invariant** — `staffId` AND `teamId` both set creates ambiguous Goal.
4. **`Math.max(...rows)` in `computeProgressValue`** — RangeError on >100K rows. Production crash.

### Application

5. **`createGoal` non-atomic multi-write** — template persisted, then instance, then progress. Partial failure = orphaned data.
6. **`cancelGoal` non-atomic cascade** — instances cancelled before parent. Parent failure = inconsistent state.
7. **`updateGoal` recurring INSTANCE can change recurrenceRule** — only checks `goalType`, not `parentGoalId`.

### DTO/Contract

8. **`updateGoalSchema` allows no-op updates** — neither targetValue nor recurrenceRule. Silent `updatedAt` corruption.
9. **`goal-create-form` builds input TWICE independently** — safeParse and final input can diverge.

## P1 — Broken feature / type safety / architecture

### Domain (11)

- `shouldEmitCompleted` doesn't check `goal.status !== 'active'` → duplicate completion events
- Non-null assertions in `resolveTimeFilter` → runtime crash on corrupted data
- Recurring instance can be created without period dates
- Recurring instance doesn't validate `periodEnd > periodStart`
- Event constructors (`goalCompleted`, `goalProgressUpdated`) have zero validation
- Missing `status_transition_invalid` error code
- `deriveEntityScope` doc says "exactly one" but implementation allows multiple
- ZERO tests for `shouldEmitCompleted`
- ZERO tests for NaN/Infinity targetValue
- ZERO tests for multiple-FK scope violation
- `rolling_window_missing` error tag defined but never used

### Application (10)

- All 5 use cases: `role` in input (should be separate ctx param)
- `update-goal`: `Record<string, unknown>` + `as` cast = type safety hole
- `computeCalendarPeriod` UTC-only (wrong for multi-tenant)
- N+1 queries in `listGoals` and `getGoal` (performance cliff)
- Port `insert` takes `Omit<Goal, 'id'...>` but use case passes full Goal — contract lie
- `handleRecurringGoal` returns template goal + instance progress (semantically confusing)
- Test fakes ignore `organizationId` — cross-tenant bugs masked
- Missing test: forbidden role rejection in all 5 use cases
- Missing test: recurring instance cancellation behavior
- `listGoals` leaks `role` into repo filter call

### DTO/Contract (8)

- `z.number()` allows NaN/Infinity — needs `.finite()`
- Components import directly from `goal.dto.ts` instead of `public-api.ts` (5 files)
- Event factory functions exported from `public-api.ts` (should be types only)
- `datetime-local` input format may not match Zod's `.datetime({ local: true })`
- Route search schema duplicates DTO enum literals
- `GoalWithProgress` not exported from `public-api.ts`
- Unsafe `as` casts for `AggregationFunction`/`MetricKey` in server function
- Optional FK fields lack `.nullable()` for explicit null representation

## Recommended fix order

1. **Domain constructors** — NaN/Infinity guard, exactly-one-FK validation
2. **Use case transactions** — wrap multi-write ops in `createGoal` and `cancelGoal`
3. **`updateGoal` type safety** — typed updates bag, recurring instance guard
4. **`computeProgressValue`** — replace `Math.max(...spread)` with `reduce`
5. **DTO improvements** — `.finite()`, no-op `.refine()`, `datetime-local` format
6. **Test coverage** — shouldEmitCompleted, NaN, forbidden role, cross-org, recurring instances
7. **Architecture** — role separation, public-api enforcement, event export cleanup
