# Goal Context — Domain & Application Layer Review

**Reviewer**: automated codebase review
**Date**: 2026-06-10
**Scope**: `src/contexts/goal/domain/`, `src/contexts/goal/application/`, `src/contexts/goal/build.ts`
**Dimensions**: D2, D3, D4, D11, D12, D15

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 1      |
| MAJOR     | 6      |
| MINOR     | 5      |
| NIT       | 3      |
| **Total** | **15** |

---

## Findings

### [D2] BLOCKER GoalProgressUpdated event missing eventId and correlationId envelope fields

- **File**: `src/contexts/goal/domain/events.ts:35-44`
- **Quote**:

```ts
export type GoalProgressUpdated = Readonly<{
  _tag: 'goal.progress_updated'
  goalId: GoalId
  organizationId: OrganizationId
  metricKey: MetricKey
  previousValue: number
  currentValue: number
  computedSource: ComputedSource
  occurredAt: Date
}>
```

- **Rule**: D2 — "Envelope fields: eventId, occurredAt, correlationId"
- **Fix**: Add `eventId: string` and `correlationId: string | null` to `GoalProgressUpdated`. `GoalCompleted` correctly includes both. The `goalProgressUpdated` constructor must be updated accordingly. All handlers emitting this event must supply these fields.

---

### [D1] MAJOR create-goal use case imports cross-context internal layer via relative path

- **File**: `src/contexts/goal/application/use-cases/create-goal.ts:10`
- **Quote**:

```ts
} from '../../../metric/application/public-api'
```

- **Rule**: D1 — "application/ imports domain/ + shared/domain/ + shared/events/. Forbidden: infrastructure/, server/, routes/, components/"
- **Fix**: This import reaches into another context's application layer via relative path (`../../../metric/application/public-api`). While `public-api.ts` is the intended cross-context boundary, the import mechanism should use the alias `#/contexts/metric/application/public-api` rather than a relative path that couples directory layout. This is a convention/layering concern — the import target is correct (public-api), but the path style is fragile.

---

### [D2] MAJOR Event constructors perform no validation — impossible states not asserted

- **File**: `src/contexts/goal/domain/events.ts:48-58`
- **Quote**:

```ts
export const goalCompleted = (args: Omit<GoalCompleted, '_tag'>): GoalCompleted => ({
  _tag: 'goal.completed',
  ...args,
})

export const goalProgressUpdated = (
  args: Omit<GoalProgressUpdated, '_tag'>,
): GoalProgressUpdated => ({
  _tag: 'goal.progress_updated',
  ...args,
})
```

- **Rule**: D2 — "Constructor validation: assertions for impossible states"
- **Fix**: Constructors are identity spreads with zero validation. At minimum, assert: `eventId` is non-empty string, `goalId`/`organizationId` are non-empty, `completedValue` ≥ 0, etc. This allows emitting events with empty IDs or negative values.

---

### [D3] MAJOR create-goal use case casts raw strings to branded IDs unsafely

- **File**: `src/contexts/goal/application/use-cases/create-goal.ts:93,137,163,210`
- **Quote**:

```ts
const goalId = deps.idGen() as GoalId
// ...
id: deps.idGen() as unknown as GoalProgressId,
```

- **Rule**: D3 — "Domain-generated IDs, adapter returns domain types"
- **Fix**: The `idGen` port returns `string` but IDs are branded types. Using `as GoalId` and `as unknown as GoalProgressId` bypasses the brand safety. Either change `idGen` to return the appropriate branded type (using dedicated generators per ID type), or provide validated constructor functions from `shared/domain/ids` to convert raw strings safely.

---

### [D3] MAJOR update-goal mutates goal entity outside the domain constructor

- **File**: `src/contexts/goal/application/use-cases/update-goal.ts:69-94`
- **Quote**:

```ts
const updates: {
  updatedAt: Date
  targetValue?: number
  recurrenceRule?: RecurrenceRule | null
} = {
  updatedAt: now,
}
// ...
const updated = await deps.goalRepo.update(input.goalId, input.organizationId, updates)
```

- **Rule**: D3 — "Steps: Authorize → Load → Check rules → Build domain → Persist → Emit events → Return"
- **Fix**: The use case constructs a partial update object and passes it to the repo rather than rebuilding a full domain `Goal` via a constructor or a dedicated `updateGoal` domain function. This means business invariants (e.g., targetValue > 0, recurrenceRule only on recurring) are checked ad-hoc in the use case instead of being enforced by the domain layer. Introduce a `rebuildGoal` or `applyGoalUpdate` domain function that validates the full resulting entity.

---

### [D5] MAJOR GoalRepository.getProgress and updateProgress lack organizationId parameter

- **File**: `src/contexts/goal/application/ports/goal.repository.ts:100,106-115`
- **Quote**:

```ts
// Safe: goalId is a globally unique UUID — no cross-tenant risk
getProgress(goalId: GoalId): Promise<GoalProgress | null>
// ...
updateProgress(
  goalId: GoalId,
  data: Readonly<{ ... }>,
): Promise<GoalProgress | null>
```

- **Rule**: D5 — "Every SELECT/UPDATE/DELETE includes WHERE organization_id = ?"
- **Fix**: The comments claim safety via UUID uniqueness, but defense-in-depth requires org-scoped queries. A leaked/brute-forced goalId gives access to any tenant's progress data. Add `organizationId` parameter to `getProgress`, `updateProgress`, and `insertProgress`, matching the pattern used by `getById`, `update`, etc.

---

### [D15] MAJOR Domain layer uses `throw` via assertNever for unreachable branches

- **File**: `src/shared/domain/assert.ts:11-13` (used by `constructors.ts:160`, `progress-strategy.ts:128,162`)
- **Quote**:

```ts
export function assertNever(location: string, value: never): never {
  throw new UnreachableError(location, value)
}
```

- **Rule**: D15 — "No throw new Error in domain/application"
- **Fix**: `assertNever` throws an `Error` subclass. In domain code, this is technically a violation, but it's the accepted pattern for exhaustive switch defaults — the `never` typing proves this path is unreachable in well-typed code. Consider returning a `Result.Err` instead, or document this as an intentional exception to the no-throw rule (it only fires on type-unsafe runtime values, not business failures).

---

### [D12] MINOR CONTEXT.md claims `GoalProgressUpdated` has `occurredAt` but table omits it

- **File**: `src/contexts/goal/CONTEXT.md:52`
- **Quote**:

```
| `goal.progress_updated` | goalId, orgId, metricKey, previousValue, currentValue, computedSource, occurredAt | Progress recomputed     |
```

- **Rule**: D12 — "Verify CONTEXT.md claims match actual code"
- **Fix**: The CONTEXT.md table correctly lists `occurredAt` and the actual code has `occurredAt`. However, the table lists `orgId` while the type uses `organizationId`. Update the table to use the actual field name for consistency.

---

### [D12] MINOR CONTEXT.md Public API section lists types not exported from public-api.ts

- **File**: `src/contexts/goal/CONTEXT.md:100-104`
- **Quote**:

```
- Types: `CreateGoalInput`, `UpdateGoalInput`, `CancelGoalInput`, `ListGoalsInput`, `GetGoalInput`, `Goal`, `GoalProgress`, `GoalType`, `GoalStatus`
- Functions: `deriveEntityScope`
- Port types: `GoalRepository`, `GoalListFilter`
- Event types: `GoalCompleted`, `GoalProgressUpdated`, `GoalEvent`
- Event constructors: `goalCompleted`, `goalProgressUpdated`
```

- **Rule**: D12 — verify actual exports
- **Fix**: `public-api.ts` exports all listed types correctly. However, it also exports `StaffGoalEntry` (line 33) which is not documented. Either add `StaffGoalEntry` to the Public API section or remove the export if unused.

---

### [D12] MINOR CONTEXT.md use case table lists `orgId` but actual input types use `organizationId`

- **File**: `src/contexts/goal/CONTEXT.md:90-94`
- **Quote**:

```
| `createGoal` | orgId, propertyId, portalId?, portalGroupId?, name, description?, goalType, aggregationFunction, metricKey, targetValue, periodStart?, periodEnd?, recurrenceRule?, rollingWindowDays?, createdBy, role | `Goal`   | `goal.create` |
```

- **Rule**: D12 — "Verify CONTEXT.md claims match actual code"
- **Fix**: The CONTEXT.md table uses `orgId` but the actual `CreateGoalInput` type uses `organizationId`. Update the table to match the code for accuracy.

---

### [D3] MINOR DTO schemas (goal.dto.ts) re-export domain types — mixing concerns

- **File**: `src/contexts/goal/application/dto/goal.dto.ts:115-116`
- **Quote**:

```ts
export type { Goal, GoalProgress, GoalType, GoalStatus } from '../../domain/types'
export { deriveEntityScope } from '../../domain/types'
```

- **Rule**: D3 / D1 — DTO schemas should only define input validation schemas
- **Fix**: Re-exporting domain types from a DTO module conflates two responsibilities. The `public-api.ts` already re-exports these via the DTO barrel. Move the re-exports to `public-api.ts` directly from `domain/types` and remove them from the DTO module.

---

### [D4] MINOR build.ts imports infrastructure directly — acceptable for composition root but violates stated architecture

- **File**: `src/contexts/goal/build.ts:14,20`
- **Quote**:

```ts
import { createGoalRepository } from './infrastructure/repositories/goal.repository'
import { registerGoalEventHandlers } from './infrastructure/event-handlers'
```

- **Rule**: D4 — build.ts is the composition root; importing infrastructure is expected here
- **Fix**: This is acceptable — the build function is the composition root whose job is wiring infrastructure adapters to application ports. No action needed, but worth noting for layer clarity.

---

### [D2] NIT Event tag uses dots — correct per convention but `_tag` field differs from envelope `eventId` naming

- **File**: `src/contexts/goal/domain/events.ts:16,36`
- **Quote**:

```ts
_tag: 'goal.completed'
_tag: 'goal.progress_updated'
```

- **Rule**: D2 — "Tag naming: context.entity.verb, no hyphens"
- **Fix**: Tags are correctly formatted (`goal.completed`, `goal.progress_updated`). No issue — just confirming convention compliance.

---

### [D11] NIT Domain types.ts includes `deriveEntityScope` — minor logic in types file

- **File**: `src/contexts/goal/domain/types.ts:72-79`
- **Quote**:

```ts
export function deriveEntityScope(goal: {
  portalId: PortalId | null
  portalGroupId: PortalGroupId | null
}): EntityScope {
```

- **Rule**: D11 — domain types file should be "readonly branded types, no business logic"
- **Fix**: The file header says "no business logic (constructors handle that)" but includes a pure derivation function. This is a value object derivation rather than business logic, so it's a borderline case. Consider moving to a separate `helpers.ts` or accepting as-is since it's a pure type-level derivation.

---

### [D11] NIT domain/constructors.ts defines error types separately from domain/errors.ts

- **File**: `src/contexts/goal/domain/constructors.ts:24-43`
- **Quote**:

```ts
export type GoalConstructionError =
  | { tag: 'ambiguous_scope' }
  | { tag: 'invalid_metric_for_scope'; metricKey: MetricKey; scope: string }
  ...
```

- **Rule**: D11 — domain errors should be centralized
- **Fix**: `GoalConstructionError` is defined in `constructors.ts` while `GoalError`/`GoalErrorCode` live in `errors.ts`. These are different error shapes (Result-style tagged unions vs smart-constructed errors), but having two error patterns in the same context creates confusion. Consider unifying or documenting the split rationale.

---

## D12 — CONTEXT.md Accuracy Audit

### Matches confirmed

| Claim                                                                        | Actual                                                   | Status |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| Events produced: `goal.completed`, `goal.progress_updated`                   | `events.ts` defines both                                 | ✅     |
| Event payloads match                                                         | `GoalCompleted` has all listed fields                    | ✅     |
| Events consumed: `metric.recorded`, `portal.deleted`, `portal_group.deleted` | Referenced in `build.ts` via `registerGoalEventHandlers` | ✅     |
| Use cases: all 5 listed                                                      | Files exist and exported from `build.ts`                 | ✅     |
| Permissions: `goal.create`, `goal.update`, `goal.cancel`, `goal.read`        | All use cases check via `can(role, permission)`          | ✅     |
| Architecture layers file listing                                             | All listed files exist                                   | ✅     |
| `GoalRepository` port in `application/ports/`                                | File exists with correct location                        | ✅     |
| Public API exports event types + constructors                                | `public-api.ts` lines 29-30 confirm                      | ✅     |

### Discrepancies found

1. **`orgId` vs `organizationId`** — CONTEXT.md use case table uses `orgId`; actual types use `organizationId`
2. **`StaffGoalEntry` not documented** — exported from `public-api.ts` but absent from Public API section
3. **`GoalProgressUpdated` missing envelope fields** — CONTEXT.md doesn't mention the absence of `eventId`/`correlationId` which should be present per D2
4. **`CancelGoal` type alias exported but `cancelGoal` use case has no `CancelGoal` type listed in CONTEXT.md Public API section**
