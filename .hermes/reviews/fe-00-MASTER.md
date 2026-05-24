# Goal Frontend — Exhaustive Focused Review

**Scope:** 16 frontend files (~1,543 lines) — routes, server functions, components
**Branch:** `feat/phase-15c-goal-ui`
**Verdict:** **FAIL** — 5 P0, 17 P1, 49 P2, 15 N3

## Reports

| File                     | Focus                     | Findings                |
| ------------------------ | ------------------------- | ----------------------- |
| `fe-01-routes-server.md` | Routes + server functions | 8 P1, 21 P2, 3 N3       |
| `fe-02-components.md`    | UI components             | 4 P0, 9 P1, 23 P2, 7 N3 |
| `fe-03-data-flow.md`     | End-to-end data flow      | 1 P0, 4 P1, 5 P2, 5 N3  |

## P0 — Must fix (data loss / crash)

1. **Double navigation race after goal creation** — form AND route `onSuccess` both navigate → loader race, possible stale data flash (fe-03)
2. **GoalCreateForm still uses plain `useState`** — previous fix was superficial; half the fields bypass Zod validation entirely (fe-02 P0-001)
3. **Conditional fields (period, rolling window, recurrence) have zero validation** — invalid data silently submitted to server (fe-02 P0-002)
4. **ProgressBar NaN/negative guard missing** — `targetValue` of 0 or negative → NaN% displayed, Infinity progress bar (fe-02 P0-004)

## P1 — Broken features

1. **Route loader ignores URL filter params** — `status`/`goalType` search params never reach `listGoals` server fn; filtering is client-side only on stale loader data
2. **Detail route NOT invalidated after cancel** — stale "Active" badge + visible cancel button for ~30s
3. **Cancel invalidation misses detail route key** — `queryKey` doesn't include goal detail
4. **Post-create navigation path wrong** — missing `/_authenticated` prefix → 404
5. **No `entityId` validation for non-property scopes** — portal/team/staff scoped goals created with unvalidated IDs
6. **Form not reset after successful submission** — stale form values on next create
7. **`GoalWithProgress` type duplicated across 3 files** — divergence risk
8. **Unsafe mutation result extraction** — `as { goal: Goal }` type assertion hides errors
9. **staff-goals.ts missing `.inputValidator()`** — no input validation at all
10. **No input validation on `propertyId` param** — any string accepted
11. **Period date / rolling window / recurrence fields have no error display** — validation errors invisible to user
12. **Missing ARIA attributes on ProgressBar** — screen readers can't interpret progress
13. **`progress_query_error` mapped to wrong HTTP status** — returns 404 instead of 500

## Top 5 fixes by impact

1. Fix route loader to pass search params to server function (P1-001)
2. Fix double navigation race after create (P0-001)
3. Add detail route invalidation after cancel (P1-002)
4. Add NaN/Infinity guard to ProgressBar (P0-004)
5. Fix post-create navigation path (P1-004)
