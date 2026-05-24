# Frontend Review Fix Plan

## Priority 0 — Data loss / crash

### F-P0-1: Route loader ignores filter params

**File:** `src/routes/_authenticated/properties/$propertyId/goals.tsx`
**Problem:** Loader calls `listGoals({ data: { propertyId } })` without passing `status`/`goalType` search params. Server function accepts them but they never arrive. Filtering is client-side on stale loader data.
**Fix:** Pass search params from `loader` context to server function:

```ts
loader: async ({ params: { propertyId }, search }) => {
  const { goals } = await listGoals({ data: { propertyId, status: search.status, goalType: search.goalType } })
  return { goals }
},
```

Remove client-side filtering from `GoalsListPage` component.

### F-P0-2: Double navigation race after create

**File:** `src/routes/_authenticated/properties/$propertyId/goals/new.tsx` + `src/components/features/property/goals/goal-create-form.tsx`
**Problem:** Both the route's `onSuccess` callback AND the form's `handleSubmit` navigate after creation. The form navigates on line 134, AND the route's `onSuccess` navigates on line 27-30. Double navigation = loader race.
**Fix:** Remove navigation from `GoalCreateForm`. Let the route's `onSuccess` handle ALL post-create navigation. The form should only call `mutation({ data: input })` and let the mutation result flow through the hook.

### F-P0-3: ProgressBar NaN/negative guard

**File:** `src/contexts/goal/ui/helpers.ts` line 48-51
**Problem:** `progressBarWidth` divides by `targetValue`. If 0 or negative → NaN. Already has `targetValue === 0` guard but missing negative.
**Fix:**

```ts
export function progressBarWidth(currentValue: number, targetValue: number): number {
  if (targetValue <= 0) return 0
  return Math.min(100, Math.floor((currentValue / targetValue) * 100))
}
```

Also add ARIA attributes to `ProgressBar` component.

## Priority 1 — Broken features

### F-P1-1: Detail route NOT invalidated after cancel

**File:** `src/routes/_authenticated/properties/$propertyId/goals/$goalId.tsx`
**Problem:** `invalidateRoutes` only has `/_authenticated/properties/$propertyId/goals` (the list). The detail route `/_authenticated/properties/$propertyId/goals/$goalId` is NOT included, so the detail page shows stale data after cancel.
**Fix:** Add the detail route to `invalidateRoutes`:

```ts
invalidateRoutes: [
  '/_authenticated/properties/$propertyId/goals',
  '/_authenticated/properties/$propertyId/goals/$goalId',
],
```

### F-P1-2: Post-create navigation path wrong

**File:** `src/routes/_authenticated/properties/$propertyId/goals/new.tsx` line 28
**Problem:** Navigate uses `to: '/properties/$propertyId/goals/$goalId'` — missing `/_authenticated` prefix. This works because TanStack Router resolves relative paths, BUT the form component in goal-create-form.tsx also navigates with `to: '/properties/$propertyId/goals/$goalId'` on line 135 (which is the one we're removing in P0-2).
**Fix:** After removing form navigation (P0-2), verify the route's navigation path is correct. TanStack Router's `to` should use the registered route path. Check if `/_authenticated/properties/$propertyId/goals/$goalId` or `/properties/$propertyId/goals/$goalId` is the correct format.

### F-P1-3: Unsafe mutation result extraction in form

**File:** `src/components/features/property/goals/goal-create-form.tsx` line 132
**Problem:** `const goalId = (result as { goal?: { id: string } } | undefined)?.goal?.id` — unsafe type assertion. After removing navigation from form (P0-2), this line goes away entirely.

### F-P1-4: Form not reset after successful submission

**File:** `src/components/features/property/goals/goal-create-form.tsx`
**Problem:** After successful creation, form state persists. If user navigates back to create another goal, stale values remain.
**Fix:** Add `setS(initial)` after successful mutation call. Actually, since we're removing navigation from the form, the route navigates away so this is less critical. But add it anyway for robustness.

### F-P1-5: GoalWithProgress type duplicated

**Files:** `goals-list-page.tsx` (line 24-27), `goal-detail-page.tsx` (line 22), `staff-goals-section.tsx`
**Fix:** Extract to a single shared type in `src/contexts/goal/ui/helpers.ts` or a dedicated `types.ts`.

### F-P1-6: staff-goals.ts missing inputValidator

**File:** `src/contexts/goal/server/staff-goals.ts`
**Problem:** No `.inputValidator()` on the server function.
**Fix:** Since it's a stub returning empty array with no input needed, this is acceptable for now. Add a comment explaining why no validator is needed.

### F-P1-7: ARIA attributes on ProgressBar

**File:** `src/components/features/property/goals/progress-bar.tsx`
**Fix:** Add `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label`.

## Priority 2 — Code quality

### F-P2-1: Remove client-side filtering from GoalsListPage

**File:** `src/components/features/property/goals/goals-list-page.tsx` lines 43-50
**Fix:** After server-side filtering (P0-1), remove the client-side filter logic. The component receives pre-filtered data from the loader.

### F-P2-2: Unhandled promise rejection on create error

**File:** `src/components/features/property/goals/goal-create-form.tsx`
**Fix:** Wrap `mutation({ data: input })` in try/catch. Although `mutation` should handle errors internally, the post-mutation navigation should be guarded.

### F-P2-3: Duplicate STATUS_ORDER constant

**Files:** `goals-list-page.tsx` (line 35-40), `helpers.ts` (line 68-73)
**Fix:** Remove from `goals-list-page.tsx`, use `sortGoalsByStatus` from helpers.

### F-P2-4: Detail component missing Readonly on Detail sub-component

**File:** `src/components/features/property/goals/goal-detail-page.tsx` line 137
**Fix:** Add `Readonly<>` to Detail props.

## Execution order

1. Agent A: Routes + server functions (P0-1, P1-1, P1-2, P2-1)
2. Agent B: Components (P0-2, P0-3, P1-3, P1-4, P1-5, P1-7, P2-2, P2-3, P2-4)
3. Verify: tsc + tests
