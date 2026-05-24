# Infra-01: Goal Repository & Mapper — Exhaustive Code Review

**Reviewer:** Senior Staff Engineer (angry, moody, hates slop)
**Date:** 2026-05-24
**Branch:** `feat/phase-15c-goal-ui`
**Files reviewed:**

1. `src/contexts/goal/infrastructure/repositories/goal.repository.ts` (323 lines)
2. `src/contexts/goal/infrastructure/mappers/goal.mapper.ts` (151 lines)
3. `src/contexts/goal/infrastructure/mappers/goal.mapper.test.ts` (185 lines)

---

## Summary Verdict

The code is _mostly_ competent but riddled with the kind of slop that makes me question whether anyone actually read CONTEXT.md. Missing `organizationId` filters, unsafe type casts, an `update` method that accepts raw untyped objects, race conditions in the avg increment, missing test coverage for round-trip mappers, and a `findAllActive` that ignores multi-tenancy entirely. Let's go line by line.

---

## File 1: `goal.repository.ts`

### P0 — CRITICAL

**P0-1 | repo:154 `findAllActive` — MISSING `organizationId` FILTER**
`findAllActive()` selects ALL active goals across ALL organizations. This is a multi-tenant data leak. The port signature `findAllActive(): Promise<ReadonlyArray<Goal>>` doesn't accept an `organizationId` either, which means the port itself is broken. If this is genuinely a cross-org admin query, it needs explicit documentation and access control at the application layer. As it stands, any handler calling this gets data from every tenant on the platform.

**P0-2 | repo:178 `findLatestInstance` — MISSING `organizationId` FILTER**
`findLatestInstance(parentGoalId)` queries by `parentGoalId` only. No `organizationId` filter. A tenant-scoped caller can read another tenant's goal instances. The port signature confirms this — no `orgId` parameter. This is a multi-tenant violation.

**P0-3 | repo:130 `getProgress` — MISSING `organizationId` FILTER**
`getProgress(goalId)` queries `goalProgress` by `goalId` alone. No `organizationId` check. Any authenticated user who knows a goal ID can read progress for any organization. Yes, the progress table doesn't have `organizationId` directly, but you need to JOIN on `goals` and filter by org there, or at minimum validate the goal belongs to the caller's org before returning.

**P0-4 | repo:141 `updateProgress` — MISSING `organizationId` FILTER**
Same as P0-3. Updates `goalProgress` by `goalId` alone. No ownership check. Anyone can modify any organization's progress data.

### P1 — HIGH

**P1-1 | repo:54 `update` — TYPING HOLE: accepts raw `data` object**
The method signature `update(id, orgId, data)` passes `data` directly to `.set(data)` on line 58. The port type constrains `data` to a specific shape, but the implementation never validates or re-maps it. If the port type is widened or a bug passes extra keys, they'll be written directly to the database. The mapper layer is bypassed entirely — `data` goes straight to Drizzle. This is a SQL injection vector via key injection (not value injection — Drizzle parameterizes values — but arbitrary column writes).

**P1-2 | repo:104 `cancelByParent` — Hardcoded string `'cancelled'` instead of using the type system**
Line 104: `.set({ status: 'cancelled', updatedAt: now })`. This should be a typed literal. If someone renames the status enum value, this silently writes an invalid status. Use a constant or the `GoalStatus` type.

**P1-3 | repo:156 `findAllActive` — No index coverage for status-only query**
`findAllActive` queries `WHERE status = 'active'` with no org filter. The existing index `goals_org_status_idx` is composite `(organizationId, status)` — useless without an org predicate. This will do a full table scan on production. Needs a standalone index on `status` if this query is legitimate.

**P1-4 | repo:240-312 `incrementProgress` — Race condition in `avg` aggregation**
Lines 291-293 compute avg as three separate SET clauses in one UPDATE:

```
currentSum = currentSum + delta
currentCount = currentCount + 1
currentValue = (currentSum + delta) / (currentCount + 1)
```

The `currentValue` line re-derives the division. This is correct within a single UPDATE statement (Drizzle/PG evaluate all SET expressions from the OLD row), BUT the entire `incrementProgress` method has no concurrency protection. Two concurrent events for the same goal will both read the same old row and the second UPDATE will overwrite the first. There's no `UPDATE ... WHERE goalId = ? AND currentValue = ?old` optimistic lock. For `sum`/`count` this is fine (additive, no read-before-write). For `avg` it's also fine within a single statement since all three SETs are computed from the pre-update row. **BUT** — the `currentSum` and `currentCount` are updated atomically within the statement, while `currentValue` is derived from them. This IS correct within PG's semantics. Downgrading my initial alarm, but adding a note: there's no application-level deduplication or idempotency check. If the same event is processed twice, the increment fires twice.

**P1-5 | repo:315 `markGoalCompleted` — MISSING `organizationId` FILTER**
`markGoalCompleted(goalId, completedAt)` updates by `goalId` alone. No `organizationId` check. The port signature confirms: no `orgId` param. Multi-tenant violation.

**P1-6 | repo:287-309 `incrementProgress` — `avg` branch doesn't handle null `currentSum`/`currentCount`**
The schema shows `currentSum` and `currentCount` are nullable (`real` and `integer` without `.notNull()`). The `avg` branch does `currentSum + delta` and `currentCount + 1`. In PostgreSQL, `NULL + number = NULL`. If these columns are NULL (which is valid per schema), the avg calculation produces NULL for currentValue. This is a **data corruption bug**.

### P2 — MEDIUM

**P2-1 | repo:29 `organizationId as string` — Unnecessary type assertion**
Line 29: `organizationId: goal.organizationId as string`. The `goal` parameter is `Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>`, and `organizationId` is already a branded `OrganizationId`. The `as string` is only needed because the mapper function does the unwrapping. This cast happens here (in logging) but is harmless. The real question: why are you logging the goal parameter before insert? This is debug-level, fine, but the `as string` is noise.

**P2-2 | repo:68 `filter.organizationId as string` — Same as P2-1**
Line 68: redundant `as string` in log context.

**P2-3 | repo:71 `filter.propertyId as string` — Unsafe cast on optional**
Line 71: `eq(goals.propertyId, filter.propertyId as string)`. The `propertyId` on the filter is `PropertyId | undefined`. The `as string` cast doesn't handle `undefined`. If somehow `filter.propertyId` is `undefined` at runtime but TypeScript is satisfied (which it shouldn't be due to the `if` guard on line 70), this would pass `undefined` to `eq()`. The `as string` is wrong — should be `filter.propertyId!` or just let the branded type work.

**P2-4 | repo:209 `organizationId as string` — Same logging noise.**

**P2-5 | repo:193-200 `createGoalAndProgress` — Double-setting `id` field**
Lines 195 and 199: `id: goal.id as string` and `id: progress.id as string`. The `goalToInsertRow()` and `goalProgressToInsertRow()` already omit `id` (they take `Omit<Goal, 'id' | ...>`). So the spread `...goalToInsertRow(goal)` does NOT contain `id`. Then line 195 explicitly sets `id: goal.id as string`. This means the domain `Goal` object must have an `id` already set — but the port says `createGoalAndProgress(goal: Goal, progress: GoalProgress)`. So the caller must pre-generate the ID. This is fragile — nothing prevents passing a `Goal` with a missing `id`. The `as string` cast on a branded type is also sloppy.

**P2-6 | repo:223 `or(...) !` — Non-null assertion on `or()` result**
Line 223: `conditions.push(or(eq(goals.portalId, portalId), sql\`${goals.portalId} IS NULL\`)!)`. The `!`assertion is because`or()`can return`undefined` when all args are falsy. Here both args are always present, so the assertion is technically safe. But it's still a code smell. Use a local variable with an explicit check.

**P2-7 | repo:21 Module-level logger instantiation**
`const log = getLogger().child(...)` at module load time. If `getLogger()` hasn't been configured yet, this silently creates a default logger. Not a bug, but fragile — depends on import order.

### N3 — LOW / STYLE

**N3-1 | repo:5 Unused import `desc`?** Actually used on line 184. Fine.

**N3-2 | repo:5 Unused import `or`?** Used on line 223. Fine.

**N3-3 | repo:5 `sql` import — Used extensively for raw SQL.** Fine but note P1-6 regarding null arithmetic.

**N3-4 | repo:24 Return type annotation**
`createGoalRepository = (db: Database): GoalRepository => ({...})` — Good, returns the port type. But the individual method return types are inferred, not explicit. Adding explicit return types on each method would catch signature drift.

---

## File 2: `goal.mapper.ts`

### P1 — HIGH

**P1-1 | mapper:67 `description` not guarded for null**
Line 67: `description: row.description`. The schema column is `text('description')` — nullable. The domain type is `description: string | null`. This is correctly typed. But the `goalToInsertRow` on line 122 passes `goal.description` directly. If the domain type is `string | null` and the insert type expects `string | null`, this is fine. **Actually OK on closer inspection.**

**P1-2 | mapper:48-57 `assertLiteral` — Throws on invalid data**
This function `throw new Error(...)` at the infrastructure layer. Per CONTEXT.md: "Throw tagged errors at boundaries." The error thrown here is a plain `Error`, not a tagged discriminated union. It should throw a tagged error like `{ _tag: 'InvalidRowError', ... }` or similar.

**P1-3 | mapper:113 `goalToInsertRow` — Parameter type accepts Goal without id**
The function takes `Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>`. But in `createGoalAndProgress` (repo line 193-200), the caller passes a full `Goal` (which has `id`), then overrides `id` separately. This works because `Omit` still allows extra properties at runtime. But it means `goalToInsertRow` silently ignores any `id`, `createdAt`, `updatedAt` on the input. This is technically correct but confusing.

**P1-4 | mapper:131-132 `recurrenceRule` mapping — No validation of frequency**
`goalToInsertRow` line 132: `{ frequency: goal.recurrenceRule.frequency }`. No `assertLiteral` validation on the outbound path. If the domain object somehow has an invalid frequency string, it'll be written to the DB. The `goalFromRow` validates on read, but `goalToInsertRow` trusts the domain. This is asymmetric validation — acceptable if you trust the domain layer, but the comment says "the only place where both row and domain shapes are known."

### P2 — MEDIUM

**P2-1 | mapper:116-123 Excessive `as string` casts on branded IDs**
Lines 116-120, 123, 135: Multiple `as string` casts to unwrap branded types for Drizzle. This is the standard pattern for branded→DB, but there should be a shared `unwrap()` utility to make this explicit and type-safe. Currently, `as string` silences the compiler but also silences potential future type changes.

**P2-2 | mapper:28-46 Duplicated validation constants**
The `VALID_GOAL_TYPES`, `VALID_STATUSES`, `VALID_AGGREGATIONS`, `VALID_METRIC_KEYS`, `VALID_COMPUTED_SOURCES` arrays are duplicated in the mapper instead of imported from `#/shared/domain/metric-keys` or the domain types. If a new metric key is added, you have to update both places. `METRIC_KEYS` and `AGGREGATION_FUNCTIONS` already exist in `metric-keys.ts`.

**P2-3 | mapper:36-42 `VALID_METRIC_KEYS` is a hardcoded duplicate of `METRIC_KEYS`**
The mapper has its own `VALID_METRIC_KEYS` array that duplicates `METRIC_KEYS` from `#/shared/domain/metric-keys.ts`. Slop. Import the canonical constant.

**P2-4 | mapper:83-84 Recurrence frequency validation is inline**
`assertLiteral(row.recurrenceRule.frequency, ['weekly', 'monthly', 'quarterly'], 'recurrenceFrequency')` — the valid values are hardcoded here instead of using a shared constant from the domain types.

### N3 — LOW / STYLE

**N3-1 | mapper:1-2 Good file header comment.** Follows convention.

**N3-2 | mapper:25-26 Type aliases `GoalRow` / `GoalProgressRow`**
Clean. Uses Drizzle's `$inferSelect`. Good.

---

## File 3: `goal.mapper.test.ts`

### P1 — HIGH

**P1-1 | tests: NO ROUND-TRIP TEST**
There is no test that does `goalToInsertRow(goalFromRow(row))` or `goalFromRow(goalToInsertRow(...))` to verify the mappers are inverse operations. This is the SINGLE MOST IMPORTANT mapper test and it's missing. A field could be silently dropped in one direction and you'd never know.

**P1-2 | tests: NO test for `goalToInsertRow` at all**
The test file only imports and tests `goalFromRow` and `goalProgressFromRow`. `goalToInsertRow` and `goalProgressToInsertRow` are completely untested. Half the mapper has zero test coverage.

**P1-3 | tests: NO test for `goalProgressToInsertRow`**
Same as P1-2. The outbound mapper for progress is untested.

### P2 — MEDIUM

**P2-1 | tests:14-37 `sampleGoalRow` — Hardcoded, not derived from schema**
The test fixture is manually constructed. If the schema changes (e.g., a new column is added), the fixture won't fail — it'll just be stale. Use a factory or at minimum type-assert the fixture against `GoalRow`.

**P2-2 | tests: No test for null `description`**
The domain type is `description: string | null`. There's no test case where `description` is null. Line 67 of the mapper passes it through, which is correct, but there should be a test.

**P2-3 | tests: No test for null `periodStart` / `periodEnd`**
The domain type is `periodStart: Date | null`. The sample has non-null dates. No null-case test.

**P2-4 | tests: No test for `rollingWindowDays` with a non-null value**
Line 89 of mapper maps `rollingWindowDays`. The test only checks the null case (line 72). No test with `rollingWindowDays: 30`.

**P2-5 | tests: No test for non-null `completedAt`**
`completedAt` is only tested as null (line 74). No test with an actual Date.

**P2-6 | tests:54 `String(goal.id)` — Fragile brand assertion**
`expect(String(goal.id)).toBe('goal-uuid-001')` — this works if branded types have a custom `toString()` or are just string brand types. But it's testing the brand's string representation, not the brand itself. If the brand factory changes, this silently passes or fails incorrectly. Should test the underlying value more explicitly.

**P2-7 | tests: No edge case for `currentValue = 0` in progress**
`currentValue` defaults to 0 in the schema. No test for the zero case (the sample uses 23).

### N3 — LOW / STYLE

**N3-1 | tests:1 Good file header.**

**N3-2 | tests:3 Uses vitest.** Fine.

**N3-3 | tests:129-143 Validation loop tests**
Lines 129-143 test all valid values for `goalType` and `status`. Good coverage for the valid paths.

---

## Consolidated Finding Count

| Severity | Count | Summary                                                                                                                                                                              |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0**   | 4     | Missing `organizationId` filters (`findAllActive`, `findLatestInstance`, `getProgress`, `updateProgress`) — multi-tenant data leaks                                                  |
| **P1**   | 10    | Untyped `update` method, hardcoded status strings, null-unsafe avg increment, missing round-trip tests, untested outbound mappers, untagged error throws, asymmetric validation      |
| **P2**   | 11    | Excessive `as string` casts, duplicated validation constants, missing test edge cases (null description, null periods, non-null completedAt, rollingWindowDays), non-null assertions |
| **N3**   | 7     | Style noise, import ordering, minor test fragility                                                                                                                                   |

## Required Fixes (Before Merge)

1. **Fix all P0s.** Every query MUST filter by `organizationId`. For `goalProgress` queries, JOIN on `goals` and filter. For `findAllActive` and `findLatestInstance`, either add `orgId` to the port or document why they're cross-tenant.
2. **Fix P1-6** — `avg` increment with null `currentSum`/`currentCount` produces NULL. Add `COALESCE` or ensure the domain never allows null for these when aggregation is `avg`.
3. **Add round-trip mapper tests.** `goalFromRow(row)` → `goalToInsertRow(result)` → compare fields. And the reverse.
4. **Add tests for `goalToInsertRow` and `goalProgressToInsertRow`.**
5. **Tag thrown errors** in `assertLiteral` with `_tag: 'InvalidRowError'` or similar.
6. **Import validation constants** from `#/shared/domain/metric-keys` instead of duplicating them.

---

_End of review. Fix the P0s or I will find you._
