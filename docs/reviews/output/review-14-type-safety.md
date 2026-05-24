# Review #14: Type Safety & Naming Conventions

**Date:** 2026-05-23
**Scope:** `src/` — all `.ts` / `.tsx` excluding `node_modules`, `dist`, generated files
**tsconfig:** `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`

---

## Summary

| Category | Count |
| -------- | ----- |
| BLOCKER  | 27    |
| MAJOR    | 6     |
| MINOR    | 33    |
| NIT      | 3     |

**Highest density file:** `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts` — 7 BLOCKERs (`as unknown as string` for branded→Drizzle interop)

---

## BLOCKER

### B1. `as unknown as` force-casts in production code (23 occurrences)

#### B1a. Portal infrastructure — branded ID → Drizzle column interop (portal-link.repository.ts)

```
[BLOCKER] Branded IDs force-cast to raw string for Drizzle `eq()` calls
  File: src/contexts/portal/infrastructure/repositories/portal-link.repository.ts:26
  Quote:
    const catOrg = (orgId: OrganizationId): SQL<unknown> =>
      eq(portalLinkCategories.organizationId, orgId as unknown as string)
  Rule: as unknown as T to force cast
  Fix: Create a typed `eqBranded(tableCol, brandedId)` helper that does the brand strip internally, or use the existing `unbrand()` from ids.ts
```

**All 7 occurrences in this file:** lines 26, 29, 35, 38, 41, 93, 136

#### B1b. Portal repository — same pattern

```
[BLOCKER] Branded IDs force-cast to raw string in portal.repository.ts
  File: src/contexts/portal/infrastructure/repositories/portal.repository.ts:35
  Quote:
    .where(and(...baseWhere(portals, orgId), eq(portals.id, id as unknown as string)))
  Rule: as unknown as T to force cast
  Fix: Same — use unbrand() helper in a wrapper
```

**All 7 occurrences in this file:** lines 35, 80, 119, 129, 139, 140, 145

#### B1c. Link resolver — Drizzle row → branded domain types

```
[BLOCKER] Row values force-cast to branded types without validation
  File: src/contexts/portal/infrastructure/repositories/link-resolver.repository.ts:39-40
  Quote:
    portalId: row.portalId as unknown as PortalId,
    propertyId: row.propertyId as unknown as PropertyId,
  Rule: as unknown as T to force cast
  Fix: Use branded constructor (e.g. `portalId(row.portalId)`) or a mapper function
```

#### B1d. Use-case layer — string input cast to branded PortalId

```
[BLOCKER] Raw string input.force-cast to PortalId without validation
  File: src/contexts/portal/application/use-cases/finalize-upload.ts:23
  Quote:
    input.portalId as unknown as import('#/shared/domain/ids').PortalId,
  Rule: as unknown as T to force cast
  Fix: Accept PortalId in input type (server function should parse/validate), or use portalId() constructor
```

```
[BLOCKER] Same pattern in request-upload-url.ts
  File: src/contexts/portal/application/use-cases/request-upload-url.ts:30
  Quote:
    input.portalId as unknown as import('#/shared/domain/ids').PortalId,
  Rule: as unknown as T to force cast
  Fix: Same as finalize-upload.ts — validate at boundary
```

#### B1e. Event handler — cross-context ID type mismatch

```
[BLOCKER] StaffAssignmentId force-cast to StaffId across context boundary
  File: src/contexts/goal/infrastructure/event-handlers/on-staff-unassigned.ts:30
  Quote:
    staffId: event.assignmentId as unknown as StaffId,
  Rule: as unknown as T to force cast
  Fix: Add a dedicated StaffId field to the event, or use a proper mapping function. These are different branded types for a reason.
```

#### B1f. Zod enum schema — const array force-cast

```
[BLOCKER] AGGREGATION_FUNCTIONS / METRIC_KEYS force-cast to satisfy z.enum()
  File: src/contexts/goal/application/dto/goal.dto.ts:28-29
  Quote:
    aggregationFunction: z.enum(AGGREGATION_FUNCTIONS as unknown as [string, ...string[]]),
    metricKey: z.enum(METRIC_KEYS as unknown as [string, ...string[]]),
  Rule: as unknown as T to force cast
  Fix: Type AGGREGATION_FUNCTIONS as `const` tuple: `['sum', 'count', ...] as const` satisfies `[string, ...string[]]` when defined inline, or use z.union/z.literal approach
```

### B2. Non-null assertions on optional `jobQueue` in build functions (4 occurrences)

```
[BLOCKER] Non-null assertion on optional `jobQueue` after truthy check but on separate closure
  File: src/contexts/review/build.ts:60
  Quote:
    const queue: ReviewQueuePort = input.jobQueue
      ? {
          addSyncJob: async (data, options) => {
            await input.jobQueue!.add('sync-property-reviews', data, {
  Rule: Non-null assertion ! used to dodge real possibility of undefined
  Fix: Capture `input.jobQueue` into a const in the ternary truthy branch: `const q = input.jobQueue!` → use `q` in closures. Or restructure to early-return pattern.
```

**Same pattern at:**

- `src/contexts/review/build.ts:77`
- `src/contexts/integration/build.ts:110`
- `src/shared/auth/permissions.ts:106` — `_table!` after `initPermissionTable()` assigns it (line 89→106) — the assertion is safe because assignment happens on line 93-101 but TS can't prove it across the closure boundary.

### B3. `any` in public hook types (3 types, 6 occurrences)

```
[BLOCKER] AnyAction type exports `(...args: any[]) => Promise<unknown>` with eslint-disable
  File: src/components/hooks/use-action.ts:30
  Quote:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type AnyAction = ((...args: any[]) => Promise<unknown>) & {
  Rule: any (explicit) outside test scaffolding
  Fix: Acceptable with documented reason. The eslint-disable comment + docstring justify this as a generic function wrapper. Consider tracking with a FIXME issue for a more type-safe approach using generic constraints.
```

```
[BLOCKER] useAction generic constraint uses any
  File: src/components/hooks/use-action.ts:48
  Quote:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export function useAction<TFn extends (...args: any[]) => Promise<any>>(
  Rule: any (explicit) outside test scaffolding
  Fix: Acceptable — this is a generic constraint to capture any server function shape. The output type is inferred. Low risk. Consider: `TFn extends (...args: unknown[]) => Promise<unknown>` if TS inference permits.
```

```
[BLOCKER] useMutationAction / useMutationActionSilent use same any constraint
  File: src/components/hooks/use-mutation-action.ts:48,94
  Quote:
    export function useMutationAction<TFn extends (...args: any[]) => Promise<any>>(
  Rule: any (explicit) outside test scaffolding
  Fix: Same as useAction — acceptable pattern for generic server fn wrappers. Track with FIXME.
```

**Verdict:** These `any` uses are ACCEPTABLE (documented with eslint-disable + rationale). Downgrading from BLOCKER to MAJOR.

**Revised BLOCKER count: 24** (23 `as unknown as` + 1 `_table!` on line 106 permissions.ts)

---

## MAJOR

### M1. Non-null assertions in production domain logic

```
[MAJOR] goal.periodStart! / periodEnd! / rollingWindowDays! — domain constructor invariant unchecked at type level
  File: src/contexts/goal/domain/progress-strategy.ts:97-98,104
  Quote:
    case 'one_shot': {
      return { tag: 'bounded', start: goal.periodStart!, end: goal.periodEnd! }
    }
    case 'rolling': {
      return { tag: 'sliding_window', days: goal.rollingWindowDays! }
    }
  Rule: Non-null assertion ! used to dodge real possibility of undefined
  Fix: Use a discriminated union on Goal so that `one_shot` goals carry `periodStart: Date; periodEnd: Date` and `rolling` goals carry `rollingWindowDays: number` in the type system. This makes the `!` unnecessary.
```

### M2. Generic parameters named `T` without domain meaning (minor instances)

```
[MAJOR] Generic parameter T in compose-refs, use-lazy-ref, use-as-ref could be more descriptive
  File: src/lib/compose-refs.ts:10,24,58
  File: src/hooks/use-lazy-ref.ts:4
  File: src/hooks/use-as-ref.ts:6
  Quote:
    function setRef<T>(ref: PossibleRef<T>, value: T) {
    function useLazyRef<T>(fn: () => T) {
  Rule: Generic parameters named T, U when they have clear meaning
  Fix: These are genuinely generic utilities — T is acceptable here. No action needed.
```

**Verdict:** Not a real MAJOR — these are utility hooks where `T` is idiomatic. Removing from count.

### M3. Missing return type annotations on exported functions

Spot-checked several exported functions — most have explicit return types or use `ReturnType<typeof>` patterns. The `buildXxxContext` factory functions all have explicit return types. Use-case factory functions use the `ReturnType<typeof>` pattern which is acceptable.

No systematic missing return types found.

### M4. Discriminated union switches without exhaustive never

```
[MAJOR] toBetterAuthRole switch on Role union has no default: assertNever
  File: src/shared/domain/roles.ts:44-51
  Quote:
    export function toBetterAuthRole(role: Role): BetterAuthRole {
      switch (role) {
        case 'AccountAdmin': return 'owner'
        case 'PropertyManager': return 'admin'
        case 'Staff': return 'member'
      }
    }
  Rule: Discriminated unions without exhaustive never assertions in switches
  Fix: Add `default: { const _exhaustive: never = role; throw ... }` — TS will error if a new Role variant is added
```

The `noFallthroughCasesInSwitch` tsconfig option provides partial protection but doesn't require exhaustive handling. The code relies on return-type checking which will catch unhandled cases. **However** explicit `never` asserts make the intent clear and provide better error messages.

### M5. `as unknown as string` pattern — systemic branded-to-Drizzle interop gap

This is counted as BLOCKER above (B1a, B1b) but warrants a MAJOR design note: the codebase lacks a standard pattern for passing branded IDs into Drizzle queries. The `unbrand()` function exists in `ids.ts` but is not used consistently.

### M6. `input.portalId: string` in use cases — raw string at application layer

```
[MAJOR] finalize-upload and request-upload-url accept raw string portalId instead of PortalId
  File: src/contexts/portal/application/use-cases/finalize-upload.ts:18
  File: src/contexts/portal/application/use-cases/request-upload-url.ts:18 (approx)
  Quote:
    input: { portalId: string; key: string },
  Rule: Branded ID types absent where codebase has them — raw string slipping in
  Fix: Change input type to `{ portalId: PortalId; key: string }` and validate at the server function boundary
```

---

## MINOR

### N1. Re-exports via `export *` in barrel files (31 occurrences)

```
[MINOR] Barrel files use export * instead of named re-exports
  File: src/shared/db/schema/index.ts (14 re-exports)
  File: src/shared/db/schema/business.ts (12 re-exports)
  File: src/components/features/integration/index.ts (5 re-exports)
  Rule: Re-exports via export * instead of named re-exports in barrel file
  Fix: Convert to named re-exports for explicit API surface: `export { schema } from './property.schema'`
  Note: Low risk for schema barrel files — Drizzle patterns commonly use `export *`. The integration component barrel could benefit from named exports.
```

### N2. `as unknown as` in test files (acceptable — test scaffolding)

110 occurrences of `as unknown as` across test files. All are test mock construction — **acceptable**.

### N3. Non-null assertions in test files (acceptable — test assertions)

~75 occurrences of `!` in test files — mostly `expect(stored!.value)` patterns after `toBeDefined()` guards. **Acceptable**.

---

## NIT

### N1. `expect.any(Object)` in test

```
[NIT] expect.any(Object) used instead of expect.any(Object)
  File: src/shared/auth/pubsub-jwt.verifier.test.ts:67
  Quote:
    expect.any(Object),
  Fix: Use `expect.any(Object)` — functionally identical but matches Jest idiom
```

### N2. `Object.is` / `Object.freeze` / `Object.assign` — not type-level usage

The `Object` references in color-picker, mappers, and hooks are runtime utility calls, not type annotations. **No issue**.

### N3. No `@ts-ignore` or `@ts-expect-error` found in codebase

Zero occurrences — clean.

---

## Counts per BLOCKER Category

| Blocker Category                                  | Count  |
| ------------------------------------------------- | ------ |
| `as unknown as` force-cast (production)           | 23     |
| Non-null assertion dodging undefined (production) | 1      |
| **Total BLOCKER**                                 | **24** |

| All Categories | Count                    |
| -------------- | ------------------------ |
| BLOCKER        | 24                       |
| MAJOR          | 4                        |
| MINOR          | 31 (export \*) + 2 other |
| NIT            | 3                        |

## File with Highest Density

**`src/contexts/portal/infrastructure/repositories/portal-link.repository.ts`**

- 7 × `as unknown as string` (BLOCKER)
- 184 lines total
- Density: **1 BLOCKER per 26 lines**

Root cause: Drizzle's `eq()` accepts `string` columns, but the domain uses branded `OrganizationId`, `PortalLinkCategoryId`, `PortalLinkId`. The infrastructure layer forces the cast at every query site instead of having a shared `eqBranded()` utility.

---

## Recommendations

1. **Add `eqBranded<C, B>(col: C, id: B)` utility** in shared/db that strips the brand internally. Eliminates all 14 portal-repository BLOCKERs.
2. **Create a typed row→domain mapper pattern** for link-resolver.repository.ts instead of inline `as unknown as` casts.
3. **Strengthen Goal's discriminated union** so `one_shot` carries `periodStart/End` in the type, removing `!` assertions in progress-strategy.ts.
4. **Validate at server function boundary** for finalize-upload and request-upload-url — accept `PortalId` not `string`.
5. **Add `assertNever` default cases** to switches on `Role` and `GoalType` unions for compile-time exhaustiveness.
6. **Track `any` in hook wrappers** with a FIXME issue for future type-safety improvement.
