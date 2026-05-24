# Review 14: Type Safety & Naming Conventions

**Reviewer:** Automated architecture review
**Date:** 2026-05-23
**Branch:** feat/phase-15c-goal-ui

## Findings

### [MAJOR] `any` type in production code — `use-action.ts` and `use-mutation-action.ts`

File: src/components/hooks/use-action.ts:30,48
Quote:

```
export type AnyAction = ((...args: any[]) => Promise<unknown>) & {
export function useAction<TFn extends (...args: any[]) => Promise<any>>(
```

Rule: CONTEXT.md requires no `any` types in production code.
Fix: These are generic constraint types designed to match TanStack Start's server function signatures. Replace with `(...args: unknown[]) => Promise<unknown>` if possible, or add an explicit eslint-disable comment with justification.

File: src/components/hooks/use-mutation-action.ts:48,94
Quote:

```
export function useMutationAction<TFn extends (...args: any[]) => Promise<any>>(
```

Rule: Same as above.
Fix: Same as above.

### [MINOR] `any` type in `base-where.ts` — comment-only reference

File: src/shared/db/base-where.ts:16
Quote:

```
* Structural constraint: any Drizzle table with `organizationId` and `deletedAt` columns.
```

Rule: No `any` in production code — this is a JSDoc comment, not a type annotation.
Fix: No action needed — this is prose, not a type.

### [MINOR] `assertNever` used only in goal context, not consistently across all union dispatches

File: src/contexts/goal/domain/constructors.ts, src/contexts/goal/domain/progress-strategy.ts
Rule: CONTEXT.md requires exhaustive pattern matching with `assertNever` for default on union types. Only the goal context uses `assertNever`. Other contexts use `match().exhaustive()` in server functions (which is also valid) but don't use `assertNever` in domain switch statements.
Fix: The `match().exhaustive()` pattern is equally valid. No action needed — the goal context's `assertNever` usage is a stricter variant, but `match().exhaustive()` provides the same guarantee.

### [MINOR] `goal/ui/helpers.ts` imports from `application/dto/goal.dto` instead of `application/public-api`

File: src/contexts/goal/ui/helpers.ts:6
Quote:

```
import type { Goal, GoalStatus } from '#/contexts/goal/application/dto/goal.dto'
```

Rule: CONTEXT.md says cross-context imports should go through `public-api.ts`. This is same-context, but the `ui/` layer is unusual — it's neither server nor application. Should still use the public barrel.
Fix: Change import to `#/contexts/goal/application/public-api` which re-exports `Goal` and `GoalStatus` via the DTO barrel.

### [MINOR] `goal/server/goals.ts` uses unsafe `as` casts for Zod-validated enums

File: src/contexts/goal/server/goals.ts:79-80
Quote:

```
aggregationFunction: data.aggregationFunction as AggregationFunction,
metricKey: data.metricKey as MetricKey,
```

Rule: Avoid force-casts that could mask type errors.
Fix: These are safe because the Zod schema validates `data.aggregationFunction` as `z.enum(aggregationFunctionValues)` and `data.metricKey` as `z.enum(metricKeyValues)` — the runtime values are already constrained. Consider adding a comment documenting this.

### [NIT] All file naming follows kebab-case convention ✓

### [NIT] All domain functions use `camelCase` for variables/functions and `PascalCase` for types ✓

### [NIT] Branded IDs used consistently for entity identifiers across all contexts ✓

### [NIT] `readonly` on all domain fields ✓

### [NIT] No `class`, `this`, or `enum` in domain code ✓

## Summary

| Severity | Count                     |
| -------- | ------------------------- |
| BLOCKER  | 0                         |
| MAJOR    | 1                         |
| MINOR    | 4                         |
| NIT      | 5 (grouped, all positive) |

**Most important thing to fix first:** The `any` types in `use-action.ts` and `use-mutation-action.ts`. These are shared hooks used across the frontend. If the TanStack Start server function types can be expressed without `any`, that should be done. If not, an explicit eslint-disable with a justification comment is needed.
