# Review: Goal Frontend + Cross-Cutting (RAGING MODE)

## Verdict

**FAIL** — The create form is a validation-free `useState` dumpster fire that ignores every form convention we have.

## Critical Issues (P0)

- `goal-create-form.tsx:51-126` — **Uses `useState` form instead of TanStack Form + Zod v4.** The `components/CONTEXT.md` says, and I QUOTE: _"All forms use TanStack Form + Zod v4 + shadcn/ui. No React Hook Form, Formik, or plain useState forms."_ This form uses `useState<FormState>` with a hand-rolled setter map (`const $: Record<string, (v: string) => void> = {}` built from `Object.keys(s)`) and a manual `handleSubmit(e: React.FormEvent)`. This is not TanStack Form. This is not Zod validation. This is a 2018 React pattern. The entire `GoalCreateForm` component needs to be rewritten using `useForm` from `@tanstack/react-form` with the `createGoalSchema` from `goal.dto.ts`.

- `goal-create-form.tsx:87-95` — **Duplicates validation logic instead of using DTO schemas.** The code manually checks:

  ```typescript
  if (!s.name.trim()) errs.name = 'Name is required'
  if (!s.metricKey) errs.metricKey = 'Metric key is required'
  if (!s.targetValue || Number(s.targetValue) <= 0)
    errs.targetValue = 'Target value must be positive'
  ```

  The `createGoalSchema` in `goal.dto.ts` already defines ALL of these rules with proper Zod v4 schemas (`.min(1, 'Goal name is required')`, `.positive('Target value must be positive')`, etc.). The convention says: _"Schema from DTOs, NEVER duplicate validation."_ This isn't just a style issue — if someone updates the DTO schema, this manual validation will silently drift out of sync.

- `goal-create-form.tsx:98-117` — **Manually constructs `CreateGoalInput` instead of deriving from schema.** The form hand-assembles the input object with 20+ lines of conditional logic (`if (s.entityScope === 'portal') input.portalId = ...`) instead of letting the Zod schema parse + validate the form state. This is EXACTLY what `createGoalSchema.parse()` is for.

## Major Issues (P1)

- `goal-create-form.tsx` — **151 lines, exceeds the 150-line component limit.** The `components/CONTEXT.md` rule 4: _"Max 150 lines per file — if a component exceeds this, extract sub-components into the same concept folder."_ The file is 151 lines. ONE line over. Either extract something or trim the blank lines. This is sloppiness incarnate.

- `goal-detail-page.tsx:22`, `goals-list-page.tsx:24`, `staff-goals-section.tsx:15` — **`GoalWithProgress` type defined THREE times across three files.** Identical type:

  ```typescript
  export type GoalWithProgress = { goal: Goal; progress: GoalProgress | null }
  ```

  Three separate exported definitions. Any change to this type needs to be made in three places. Extract to a shared type file or to the DTO barrel.

- `goals.tsx` (route):12-20, `$goalId.tsx` (route):8-17, `new.tsx` (route):7-9 — **All three goal routes lack `beforeLoad` authorization guards.** The `routes/CONTEXT.md` explicitly documents:

  ```tsx
  beforeLoad: ({ context }) => {
    const role = (context as AuthRouteContext).role
    if (!can(role, 'property.create')) {
      throw redirect({ to: '/properties' })
    }
  }
  ```

  None of the goal routes have this. Yes, the server functions check permissions — but the convention is defense-in-depth at the route boundary. Users without `goal.create` permission can navigate to `/goals/new` and see the full form before being rejected by the server. Add `beforeLoad` guards with `can(role, 'goal.read')`, `can(role, 'goal.create')`, etc.

- **Systematic `Readonly<>` omission on all Props types.** The `components/CONTEXT.md` rule 5: _"Props typing — `type Props = Readonly<{ ... }>` for all components."_ Here is EVERY violation:

  | File                               | Current                                  | Should be                               |
  | ---------------------------------- | ---------------------------------------- | --------------------------------------- |
  | `goal-create-extra-fields.tsx:14`  | `interface GoalCreateExtraFieldsProps {` | `type Props = Readonly<{...}>`          |
  | `goal-create-fields.tsx:16`        | `type F = {`                             | `type Props = Readonly<{...}>`          |
  | `goal-create-form.tsx:17`          | `type Props = { ... }`                   | `type Props = Readonly<{ ... }>`        |
  | `goal-create-metric-fields.tsx:14` | `interface MetricFieldsProps {`          | `type Props = Readonly<{...}>`          |
  | `goal-detail-page.tsx:24`          | `type Props = {`                         | `type Props = Readonly<{`               |
  | `goals-list-page.tsx:29`           | `type GoalsListPageProps = {`            | `type Props = Readonly<{`               |
  | `instance-history-table.tsx:21-25` | inline `{ instances: ... }`              | separate `type Props = Readonly<{...}>` |
  | `progress-bar.tsx:11`              | `type ProgressBarProps = {`              | `type Props = Readonly<{`               |
  | `staff-goals-section.tsx:20`       | `type StaffGoalsSectionProps = {`        | `type Props = Readonly<{`               |

  NINE files. NINE. Every single component file violates this. The convention is RIGHT THERE in the CONTEXT.md.

## Minor Issues (P2)

- `goal-create-extra-fields.tsx:14-28` — Props type uses `interface` instead of `type`. Convention specifies `type Props = Readonly<{ ... }>`. Also uses `interface` keyword which the functional style guide implicitly discourages (prefer type aliases for data shapes).

- `goal-create-fields.tsx:16` — Props type aliased as `type F = { ... }`. Single-letter type alias for props. Unreadable. Should be `type Props = Readonly<{ ... }>`.

- `goal-create-metric-fields.tsx:14` — Props type named `MetricFieldsProps` instead of just `Props`. The convention says `type Props = Readonly<{...}>`. Within a single-component file, `Props` is sufficient — the filename already tells you which component.

- `progress-bar.tsx:33` — Hardcoded Tailwind class `bg-gray-100` for the track background. If theme changes are needed, this is yet another hardcoded value to hunt down. Should use a design token or CSS variable.

- `goals-list-page.tsx:23` — Comment `// fallow-ignore-file unused-export` — is `fallow` a real linting tool or is this a typo for `fallow` (itself unusual)? Every other file in the codebase doesn't use this directive. This looks like a stale lint suppression that should either be documented or removed.

- `staff-goals-section.tsx:14` — Same `// fallow-ignore-file unused-export` comment. If this is needed because the exported type is only used by external consumers, document WHY. If it's not needed, remove it.

- `goal-create-form.tsx:13` — `import type { Action } from '#/components/hooks/use-action'` — the component imports `Action` type directly from the hooks module. Per the components CONTEXT.md, `components/hooks/` is allowed. ✓ But this import means the component knows about the action abstraction rather than receiving a more generic mutation handler. Minor coupling concern.

## Nits (P3)

- `goal-create-fields.tsx:75` — Hardcoded scope list `(['property', 'portal', 'team', 'staff'] as EntityScope[])` duplicated from `shared/domain/metric-keys`. The `EntityScope` type already exists — the values should be sourced from a single constant rather than a hardcoded inline array.

- `goal-create-fields.tsx:101` — Same for goal types: `(['open', 'one_shot', 'rolling', 'recurring'] as const)` hardcoded inline instead of derived from a shared constant.

- `goal-create-extra-fields.tsx:84-86` — Recurrence frequency options `['weekly', 'monthly', 'quarterly']` hardcoded in JSX. These values exist in `goal.dto.ts` as `recurrenceFrequencySchema`. Should be sourced from there.

- `goal-detail-page.tsx:137` — Internal helper `Detail` component doesn't follow the naming convention of being in its own file or at least being extracted if the parent grows. It's only 7 lines so it's fine for now, but it's not exported and has no Props type.

- `goals-list-page.tsx:35-40` — `STATUS_ORDER` constant defined locally. This exact same constant exists in `ui/helpers.ts` (also called `STATUS_ORDER`). Duplication within the same context.

- `goal-create-form.tsx:120` — Unsafe type assertion `(result as { goal?: { id: string } } | undefined)?.goal?.id`. The mutation return type should be properly typed so this cast isn't necessary.

- `new.tsx:18-23` — The `onSuccess` callback in `useMutationAction` navigates on success, but `GoalCreateForm` ALSO navigates on success (lines 121-125). Double navigation logic — the route's `onSuccess` will fire first, then the form's internal `navigate` call may fire. Redundant and potentially race-condition-prone.

## Positive Findings

- (through gritted teeth) **No cross-context boundary violations in any component.** All imports from contexts go through `application/dto/` or `ui/helpers`. No component imports from `domain/`, `infrastructure/`, or `server/` directly. The hexagonal boundary is intact on the component side.

- The `ui/helpers.ts` file is well-structured: pure functions, no side effects, no React imports. The intentional deviation documented in `goal/CONTEXT.md` is justified and properly documented.

- **All filenames follow kebab-case.** All components use named exports. ✓

- **Route loaders are correct** — single source of truth, no `useQuery` for route data. The `staleTime: 30_000` on both goal routes follows the convention for active sub-routes. ✓

- **The `useMutationAction` pattern is used correctly** in the route files for cancel and create operations. Mutations are defined in the route and passed as props to components. ✓

- **Auth hardening is correct.** The permission definitions in `shared/auth/permissions.ts` and `shared/domain/permissions.ts` are consistent. Goal permissions (`goal.read`, `goal.create`, `goal.update`, `goal.cancel`) are properly defined. Role assignments match the CONTEXT.md: AccountAdmin gets all, PropertyManager gets all, Staff gets `read` + `create` only. ✓

- **All CONTEXT.md files are accurate and complete.** They all contain the required sections: Glossary, Relationships, Invariants, Events, Architecture layers, Use cases, Public API, Server functions, Permissions. The goal CONTEXT.md accurately documents the actual code structure. ✓

- **All public-api.ts files re-export correctly.** Each context's public API barrel properly re-exports types, event types, event constructors, and port types. No stale exports detected. ✓

- **The `shared/hooks/usePermissions.ts` hook is clean** — reads role from route context, exposes typed `can()` function. Components should use this instead of boolean props. The goal components don't currently need permission checks in the UI (server-side is the gate), which is architecturally correct. ✓

- **The DTO schemas in `goal.dto.ts` are thorough** — proper Zod v4 schemas with error messages, enum constraints derived from shared constants, and clean type inference. If only the form actually USED them. 😤

## Files Reviewed

### Goal Frontend Components (9 files)

- `src/components/features/property/goals/goal-create-extra-fields.tsx` (111 lines)
- `src/components/features/property/goals/goal-create-fields.tsx` (134 lines)
- `src/components/features/property/goals/goal-create-form.tsx` (151 lines)
- `src/components/features/property/goals/goal-create-metric-fields.tsx` (91 lines)
- `src/components/features/property/goals/goal-detail-page.tsx` (144 lines)
- `src/components/features/property/goals/goals-list-page.tsx` (139 lines)
- `src/components/features/property/goals/instance-history-table.tsx` (67 lines)
- `src/components/features/property/goals/progress-bar.tsx` (42 lines)
- `src/components/features/property/goals/staff-goals-section.tsx` (82 lines)

### Route Files (3 files)

- `src/routes/_authenticated/properties/$propertyId/goals.tsx` (36 lines)
- `src/routes/_authenticated/properties/$propertyId/goals/$goalId.tsx` (40 lines)
- `src/routes/_authenticated/properties/$propertyId/goals/new.tsx` (37 lines)

### CONTEXT.md Files (16 files)

- `src/contexts/goal/CONTEXT.md`
- `src/contexts/CONTEXT.md`
- `src/contexts/dashboard/CONTEXT.md`
- `src/contexts/guest/CONTEXT.md`
- `src/contexts/identity/CONTEXT.md`
- `src/contexts/inbox/CONTEXT.md`
- `src/contexts/integration/CONTEXT.md`
- `src/contexts/metric/CONTEXT.md`
- `src/contexts/portal/CONTEXT.md`
- `src/contexts/property/CONTEXT.md`
- `src/contexts/review/CONTEXT.md`
- `src/contexts/staff/CONTEXT.md`
- `src/contexts/team/CONTEXT.md`
- `src/components/CONTEXT.md`
- `src/routes/CONTEXT.md`
- `src/shared/CONTEXT.md`

### Public API Files (12 files)

- `src/contexts/goal/application/public-api.ts`
- `src/contexts/metric/application/public-api.ts`
- `src/contexts/integration/application/public-api.ts`
- `src/contexts/dashboard/application/public-api.ts`
- `src/contexts/inbox/application/public-api.ts`
- `src/contexts/portal/application/public-api.ts`
- `src/contexts/property/application/public-api.ts`
- `src/contexts/staff/application/public-api.ts`
- `src/contexts/team/application/public-api.ts`
- `src/contexts/identity/application/public-api.ts`
- `src/contexts/guest/application/public-api.ts`
- `src/contexts/review/application/public-api.ts`

### Auth Hardening (3 files)

- `src/shared/auth/permissions.ts`
- `src/shared/domain/permissions.ts`
- `src/shared/hooks/usePermissions.ts`

### Supporting Files (5 files)

- `src/contexts/goal/ui/helpers.ts` (257 lines)
- `src/contexts/goal/application/dto/goal.dto.ts` (107 lines)
- `src/shared/domain/metric-keys.ts` (93 lines)
- `src/components/hooks/use-action.ts` (108 lines)
- `src/components/hooks/use-mutation-action.ts` (124 lines)
- `src/contexts/goal/server/goals.ts` (371 lines)

**Total: 48 files reviewed.**
