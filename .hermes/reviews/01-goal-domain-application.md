# Review: Goal Domain + Application (ANGRY MODE)

## Verdict

**PASS WITH WARNINGS** — The architecture is mostly sound, domain purity is good, and test coverage is thorough. But there are several violations of documented conventions and a few real bugs that need fixing before this ships.

## Critical Issues (P0)

- `application/use-cases/create-goal.ts:88` — **Use case signature violates the documented pattern.** The convention says use cases must be `(deps) => async (input, ctx) => Promise<T>` where `ctx` carries `AuthContext` (role, orgId, userId). Instead, `role` is jammed into the `input` object at line 57: `role: Role`. Same problem in every single use case:
  - `create-goal.ts:88` — `async (input: CreateGoalInput)` with `role` baked into input
  - `update-goal.ts:41` — `async (input: UpdateGoalInput)` with `role` baked into input
  - `cancel-goal.ts:38` — `async (input: CancelGoalInput)` with `role` baked into input
  - `list-goals.ts:39` — `async (input: GoalListFilter & { role: Role })` with `role` tacked onto filter
  - `get-goal.ts:36` — `async (input: { goalId, organizationId, role })` inline type with role in input

  **WHY this is unacceptable:** The convention explicitly documents `(input, ctx)` as two separate arguments. Blending auth context into business input mixes concerns and makes it impossible to distinguish what's authorization data vs. what's business payload. Every server function calling these has to unpack role separately. Fix: extract `AuthContext` as a second parameter.

- `application/use-cases/list-goals.ts:43` — **`throw goalError(...)` in list-goals violates the application error convention.** Every other use case returns `Result<T, E>` (neverthrow). This one THROWS on forbidden:

  ```typescript
  throw goalError('forbidden', 'Insufficient permissions')
  ```

  The convention says "Application throws tagged errors on Result.isErr()" — but that means the _server boundary_ handles the throw, not the use case itself. All use cases should return `Result`. `get-goal.ts` does it correctly with `return err({ tag: 'forbidden' })`. This is inconsistent AND a runtime crash waiting to happen if the caller doesn't catch.

- `application/use-cases/create-goal.ts:10` — **Cross-context import bypasses public-api.** The import:

  ```typescript
  import type {
    MetricReadingsQuery,
    MetricReadingsAggregate,
    MetricPublicApi,
  } from '../../../metric/application/public-api'
  ```

  This is a relative import into the metric context's public-api. The convention says "Import from application/public-api.ts only" but that refers to the _goal_ context's public-api for cross-context consumers. This import is from the _metric_ context, which is allowed per the layer rules ("application/ imports from domain/, shared/domain/, shared/events/"). However, the CONTEXT.md also says "Cross-context: Import from application/public-api.ts only" — and the metric context's `public-api.ts` IS the metric public-api, so this is technically correct. But it's still a relative path `../../../metric/` which couples the directory structure. I'll downgrade this to P1 since it does follow the spirit of the rule even if the path is fragile.

- `domain/constructors.ts:25-40` — **GoalConstructionError uses `tag` instead of `_tag`.** Every other error in the codebase follows the pattern `{ _tag: 'XxxError', code: '<reason>', message: string }`. But `GoalConstructionError` is a discriminated union on `tag` (not `_tag`) and has no `code` or `message` fields:

  ```typescript
  | { tag: 'empty_name' }
  | { tag: 'invalid_target_value' }
  ```

  This doesn't follow the error pattern documented in the conventions. It's a _domain-internal_ error type that gets wrapped by the use case, so it doesn't need the full `{ _tag, code, message }` shape — but it should at least use `_tag` for consistency with the discriminated union convention stated as "Discriminated unions tagged with \_tag".

  Actually, looking more carefully, `GoalConstructionError` is used purely within the domain → application boundary and gets converted. The `ProgressQueryError` also uses `tag`. So this is an _internal_ error representation, not the external error shape. Downgrading to P1.

## Major Issues (P1)

- `application/use-cases/create-goal.ts:129-221` — **Recurring goal creation is missing from the use case shape.** The use case does: (1) authorize, (2) build domain object, (3) persist, (4) compute progress. But step 3 (persist at line 125) happens BEFORE step 4. For recurring goals, it persists the template, then creates an instance (another build + persist), then computes progress. This means if the instance build fails, we have an orphaned template in the database. There's no transaction wrapping. The use case should use `createGoalAndProgress` from the repository (which exists at `goal.repository.ts:57`) to atomically create goal + progress together. Instead it calls `insert` then `insertProgress` separately — two independent DB operations.

- `application/use-cases/create-goal.ts:94` — **Unsafe `as GoalId` cast.** `const goalId = deps.idGen() as GoalId`. The `idGen` returns `string`, and the brand cast is necessary, but this bypasses the branded ID constructor pattern. The codebase has `goalId()` as the canonical constructor in `shared/domain/ids.ts`. Should be: `const gid = goalId(deps.idGen())`. Same issue at line 162: `const instanceId = deps.idGen() as GoalId`.

- `application/use-cases/update-goal.ts:63-64` — **No validation on updated targetValue.** The CONTEXT.md says "targetValue must be > 0". The create use case validates this via `buildGoal`. But `update-goal.ts` just does:

  ```typescript
  if (input.targetValue !== undefined) {
    updates.targetValue = input.targetValue
  }
  ```

  Zero validation. You can set `targetValue: -1` or `targetValue: 0`. The domain invariant is violated. This is a **domain rule leak** — the application layer is bypassing the domain constructor for updates instead of using a "rebuild" or "update" smart constructor.

- `application/use-cases/update-goal.ts:67-73` — **No validation on updated recurrenceRule.** Similarly, you can set any `RecurrenceRule` on a recurring goal without validating that the goal is actually a _template_ (parentGoalId === null). The check at line 69 only verifies `goalType === 'recurring'` but not that it's a template vs. an instance. An instance's recurrenceRule should arguably not be changeable independently.

- `application/use-cases/create-goal.ts:127-150` — **No event emission.** Per the use case shape convention, step 6 is "Emit event — via event bus." The `createGoal` use case does NOT emit any event. Neither do `updateGoal`, `cancelGoal`, or `getGoal`. The CONTEXT.md documents that `goal.completed` and `goal.progress_updated` are the events produced, which would come from the progress-tracking infrastructure, not from CRUD use cases. So this may be intentional — but then the use case shape in the conventions is misleading. At minimum, `cancelGoal` should probably emit something since cancellation is a significant lifecycle event. The event constructors (`goalCompleted`, `goalProgressUpdated`) exist but are unused in the application layer.

- `domain/errors.ts:11-16` — **GoalError shape uses `_tag: 'GoalError'` as a monomorphic tag**, but the documented error pattern says errors should be tagged with their specific type name. Looking at the pattern: `{ _tag: 'XxxError', code: '<reason>', message: string }`. `GoalError` does have `_tag: 'GoalError'`, `code`, and `message` — so it follows the shape. But it's a generic container with a `code` union instead of individual discriminated error types. This is a style choice and acceptable, just noting it differs from how `GoalConstructionError` works.

- `application/use-cases/list-goals.ts:10` — **Imports `goalError` from domain directly to THROW.** This is the only use case that imports from `domain/errors.ts` and the only one that throws. All other use cases use neverthrow `Result`. This inconsistency means the calling convention is split: some use cases return Results, listGoals throws. The server layer will have to handle both patterns.

- `application/use-cases/create-goal.ts:5-9` — **Import from metric context via relative path.** While metric's `public-api.ts` is the correct entry point, the relative path `../../../metric/application/public-api` is fragile. If either context moves, this breaks silently. This is a build-time coupling risk.

## Minor Issues (P2)

- `domain/types.ts:20-25` — **Comments say "Enums" but these are union types.** The section header at line 20 says `// ── Enums ──` but the convention explicitly says "NO class, NO this, NO enum." These are string literal union types, which is correct, but the misleading comment could confuse contributors. Change to `// ── Type literals ──` or similar.

- `domain/types.ts:69-83` — **`deriveEntityScope` is a function in types.ts.** The file is called `types.ts` and is supposed to be pure type definitions per the header comment "domain types ... no business logic." But `deriveEntityScope` has actual runtime logic (if/else chain). It should be in `constructors.ts` or a separate `helpers.ts`. The CONTEXT.md architecture listing puts `deriveEntityScope` as something the public-api exports, but doesn't specify which file it lives in.

- `application/dto/goal.dto.ts:106-107` — **Re-exports from domain bypass the dto abstraction.** Lines 106-107:

  ```typescript
  export type { Goal, GoalProgress, GoalType, GoalStatus } from '../../domain/types'
  export { deriveEntityScope } from '../../domain/types'
  ```

  This DTO file's purpose is Zod schemas and input validation. Mixing domain type re-exports into the DTO file conflates responsibilities. These re-exports should be in `public-api.ts` directly (which they already are at line 6-18 of public-api.ts — so this is duplicated).

- `application/public-api.ts:18` — **`deriveEntityScope` is re-exported from `./dto/goal.dto` which re-exports from `domain/types`.** The public-api says:

  ```typescript
  export { deriveEntityScope } from './dto/goal.dto'
  ```

  This is a re-export chain: public-api → dto → domain/types. The public-api should import directly from domain if it needs to, since it's the application layer's facade.

- `domain/constructors.ts:26-40` — **GoalConstructionError discriminant is `tag` not `_tag`.** While this is an internal-only error type, the convention says "Discriminated unions tagged with \_tag." Using `tag` here creates an inconsistency with `GoalError` (which uses `_tag`), `TimeFilter` (which uses `tag`), and `ProgressQueryError` (which uses `tag`). At least be consistent — if internal domain unions use `tag` and external errors use `_tag`, document it. But currently it's mixed without rationale.

- `application/use-cases/update-goal.ts:59` — **Mutable `Record<string, unknown>` for updates.** The update data is built as:

  ```typescript
  const updates: Record<string, unknown> = { updatedAt: now }
  ```

  This is completely untyped. The `goalRepo.update` has a typed third parameter, but the code bypasses that by casting with `as Parameters<typeof deps.goalRepo.update>[2]` at line 79. This defeats the purpose of having typed repository parameters. Should use a properly typed update object.

- `application/use-cases/cancel-goal.ts:57` — **Recurring template check uses `parentGoalId === null` but doesn't check `goalType === 'recurring'` correctly.** Wait, it does: `goal.goalType === 'recurring' && goal.parentGoalId === null`. This is correct. Retracted.

- `application/use-cases/create-goal.ts:322` — **`computeValue` function is dead code.** Wait, it IS used at lines 139 and 210. But it duplicates logic from `computeProgressValue` in `progress-strategy.ts`. The domain already has `computeProgressValue(agg, rows)` that computes from raw rows. The use case's `computeValue(agg, aggregate)` computes from pre-aggregated results. These are different — one works on rows, the other on aggregate. But the AVG logic is duplicated: both do `sum/count` manually. Should extract to a shared helper.

- `application/use-cases/get-goal.ts:63` — **`instancesWithProgress` is mutable array.** Line 63: `const instancesWithProgress: GoalWithProgress[] = []` then push in a loop. Should use `map` for functional style per conventions.

- `application/use-cases/list-goals.ts:48` — **`results` is mutable array.** Line 48: `const results: GoalWithProgress[] = []` then push in a loop, then sort in-place at line 69. The convention favors immutable patterns. Use `map` + `toSorted` (or spread sort).

## Nits (P3)

- `domain/types.ts:1` — Header comment says "Per architecture: readonly branded types, no business logic" — but `deriveEntityScope` at line 74 IS business logic. Misleading file header.

- `domain/events.ts:15-16` — `fallow-ignore-next-line unused-type` comments on every event type. This is necessary for the linter but ugly. Consider a single comment block at the top explaining why.

- `domain/constructors.test.ts:14-28` — `BASE` test fixture has verbose type annotations like `null as ReturnType<typeof portalId> | null`. Could simplify with a helper type or just `as PortalId | null`.

- `application/use-cases/create-goal.test.ts:100-109` — The fake `metricRepo` has private methods (`_setAggregate`, `_getQueries`) using underscore prefix. This is a test convention choice, not a bug, but the underscore pattern typically signals "private" in JS conventions while these are the test's control surface.

- `application/use-cases/create-goal.ts:37` — Unused import `Result` type is imported from neverthrow but the `ok` and `err` functions are what's used. Actually `Result` IS used in the return type at line 88 and in `buildMetricQuery` at line 270. Fine.

- `application/ports/goal.repository.ts:34` — `insert(goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>)` — The insert method takes a Goal without id/timestamps and returns a full Goal with generated values. This means the caller has to construct a near-complete Goal object. The `createGoal` use case at line 125 calls `deps.goalRepo.insert(goal)` where `goal` already has an id (generated at line 94). So the `Omit<Goal, 'id'>` type doesn't match — the use case is passing a full Goal with id. This is a type mismatch that TypeScript might not catch because of the `as GoalId` cast. The repo insert ignores the provided id and generates its own (per the fake at test line 37-38), which means the id generated at line 94 is silently discarded. This is a latent bug.

- `application/use-cases/list-goals.ts:6-7` — `Goal` and `GoalProgress` are imported from `../../domain/types` but `Goal` is only used for the status sort order type at line 28. `GoalProgress` is used for the return type. Fine, but `Goal` could be referenced via `GoalWithProgress['goal']` instead.

- `domain/progress-strategy.ts:103-104` — Non-null assertions `goal.periodStart!` and `goal.periodEnd!` for one_shot. The comment says "Constructor guarantees" which is true, but using `!` is still a code smell. A safer pattern would be to validate at the type level.

- `domain/progress-strategy.ts:110` — `goal.rollingWindowDays!` — Same non-null assertion pattern.

- `application/use-cases/create-goal.ts:147` — `'reconciliation' as ComputedSource` — The `as` cast is unnecessary if you import `ComputedSource` properly. It's already imported at line 16. Could just use a satisfies expression or const assertion.

- `application/dto/goal.dto.ts:43-44` — `periodStart` and `periodEnd` use `z.string().datetime({ local: true })`. This means they accept ISO datetime strings but not `Date` objects. The use case layer works with `Date` objects. The server layer would need to parse these strings into Dates. This type boundary is fine for the DTO layer but should be documented.

- `application/public-api.ts:24-26` — Event re-exports import from `../domain/events`. Per convention, "application/ imports from domain/" is allowed. But the comment says "cross-context consumers must import events from public-api, not domain/events" which is correct for external consumers. Within the context, the import path is fine.

## Positive Findings

- **Domain purity is solid.** `types.ts`, `constructors.ts`, `events.ts`, `progress-strategy.ts` — all pure, no async, no I/O, no mutation, no framework imports. Neverthrow `Result` everywhere. This is exactly right.

- **Smart constructor `buildGoal` is thorough.** Validates every invariant from CONTEXT.md: empty name, targetValue ≤ 0, scope→metric key, metric→aggregation, goal type rules (open/one_shot/rolling/recurring), period date ordering. Returns `Result<Goal, GoalConstructionError>`. Never throws. This is textbook.

- **Test coverage is genuinely comprehensive.** `constructors.test.ts` covers all 4 goal types, all error paths, field validation, scope constraints, metric×aggregation combinations. `progress-strategy.test.ts` has 4×4 matrix coverage, edge cases (empty rows, negatives, zeros). Every use case has happy + error path tests. The `list-goals.test.ts` sorting tests are particularly good.

- **Permission checks are consistent and FIRST.** Every use case checks `can(input.role, 'goal.xxx')` as the very first line. This matches the convention. Tests verify forbidden paths for Staff on update/cancel, and allowed paths for all roles on create.

- **Event types match CONTEXT.md exactly.** `goal.completed` and `goal.progress_updated` are past-tense, have all documented payload fields, use `Readonly<>`, tagged with `_tag`. The constructors are clean.

- **Progress strategy design is elegant.** `buildProgressQuery` maps goal types to time filters cleanly, `buildProgressQueryForInstance` handles the recurring template case, `computeProgressValue` handles all 4 aggregations including the manual sum/count for AVG. The test's 4×4 matrix is excellent.

- **Repository port is well-typed.** `GoalRepository` uses branded IDs, `Readonly<>` on parameters, `ReadonlyArray` on returns. Clear separation between CRUD, queries, and event-driven methods.

- **Cancel cascading for recurring templates is correct.** `cancel-goal.ts:57-59` properly checks `parentGoalId === null` to identify templates and cascades via `cancelByParent`. Tests verify the cascade count.

## Files Reviewed

- `src/contexts/goal/CONTEXT.md`
- `src/contexts/goal/domain/types.ts`
- `src/contexts/goal/domain/constructors.ts`
- `src/contexts/goal/domain/constructors.test.ts`
- `src/contexts/goal/domain/errors.ts`
- `src/contexts/goal/domain/events.ts`
- `src/contexts/goal/domain/progress-strategy.ts`
- `src/contexts/goal/domain/progress-strategy.test.ts`
- `src/contexts/goal/application/dto/goal.dto.ts`
- `src/contexts/goal/application/ports/goal.repository.ts`
- `src/contexts/goal/application/use-cases/create-goal.ts`
- `src/contexts/goal/application/use-cases/create-goal.test.ts`
- `src/contexts/goal/application/use-cases/update-goal.ts`
- `src/contexts/goal/application/use-cases/update-goal.test.ts`
- `src/contexts/goal/application/use-cases/cancel-goal.ts`
- `src/contexts/goal/application/use-cases/cancel-goal.test.ts`
- `src/contexts/goal/application/use-cases/list-goals.ts`
- `src/contexts/goal/application/use-cases/list-goals.test.ts`
- `src/contexts/goal/application/use-cases/get-goal.ts`
- `src/contexts/goal/application/use-cases/get-goal.test.ts`
- `src/contexts/goal/application/public-api.ts`
- `src/contexts/goal/application/public-api.test.ts`
- `src/shared/domain/metric-keys.ts`
- `src/shared/domain/metric-keys.test.ts`
- `src/shared/domain/ids.ts`
- `src/shared/events/events.ts`
- `src/contexts/metric/domain/events.ts`
- `src/shared/domain/permissions.ts`
- `src/contexts/metric/application/public-api.ts`
