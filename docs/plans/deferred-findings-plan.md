# Deferred Findings — Implementation Plan

**Date:** 2026-05-29
**Source:** review/S0-S9 findings, Sessions A-C deferred items

---

## Priority Tiers

| Tier              | Definition                                                             | Count |
| ----------------- | ---------------------------------------------------------------------- | ----- |
| **P1 — Now**      | Pattern gaps, security, correctness. Fix before building new features. | 3     |
| **P2 — Soon**     | Code quality, technical debt. Fix alongside next feature work.         | 5     |
| **P3 — Phase 22** | Production hardening. Deferred to dedicated hardening phase.           | 3     |
| **P4 — Icebox**   | Nice-to-have. Don't block anything.                                    | 4     |

---

## P1 — Now

### P1.1: Add `catchUntagged` to server function files (S5-1)

**Files:** 14 server files across all contexts
**Effort:** ~30 min
**Risk:** Low — pure addition, no behavior change for existing error paths

**What:** Currently only 3/17 server files use `catchUntagged` to wrap untagged errors (DB failures, network timeouts). The other 14 let raw errors propagate — users see cryptic messages like "Connection refused" instead of friendly HTTP 500s.

**Approach:**

1. Add `import { catchUntagged } from '#/shared/auth/server-errors'`
2. Wrap the `try { ... } catch (e) { if (isXxxError(e)) throwContextError(...); throw e }` pattern with `catchUntagged`
3. Per-file: read → add import → wrap catch → verify tests pass

**Gate:** All tests pass. No new type errors.

---

### P1.2: `useMutationAction` adoption audit (S6-3)

**Files:** All route files in `src/routes/_authenticated/`
**Effort:** ~45 min
**Risk:** Low — finding and converting patterns

**What:** `src/routes/CONTEXT.md` says mutations should use `useMutationAction` (combines `useServerFn` + router invalidation + toast). Some routes may use raw `useServerFn` without invalidation, causing stale data after mutations.

**Approach:**

1. Grep all route files for `useServerFn(` vs `useMutationAction(`
2. For each raw `useServerFn`, check if it's a mutation (POST) or query (GET)
3. Convert mutation `useServerFn` calls to `useMutationAction` with appropriate `invalidateRoutes`
4. Verify each changed route renders correctly

**Gate:** No regressions. Routes that already use `useMutationAction` are verified correct.

---

### P1.3: Permission-denied tests for 6 fixed use cases (from B7)

**Files:** 6 use case test files
**Effort:** ~60 min
**Risk:** Low — additive tests

**What:** We added `can()` checks to 6 use cases but didn't add tests verifying that the permission check rejects unauthorized users. Each needs a "Staff tries to update portal → forbidden" style test.

**Approach:**

1. For each use case: `create-link`, `create-link-category`, `finalize-upload`, `get-portal-qr-url`, `get-team`, `list-teams`
2. Add test: create use case with Staff role → expect `forbidden` error
3. Add test: create use case with PropertyManager role → expect success

**Gate:** 6 new passing tests. All existing tests still pass.

---

## P2 — Soon

### P2.1: Portal-group domain file reorganization (S2-1)

**Files:** `portal/domain/portal-group-{types,constructors,events}.ts` → merge into standard files
**Also:** `goal/infrastructure/event-handlers/on-group-deleted.ts` imports from portal domain directly (cross-context violation)
**Effort:** ~90 min
**Risk:** Medium — 10+ files touched, cross-context import to fix

**What:** Portal-group domain code lives in three hyphenated files outside the standard `types.ts`/`constructors.ts`/`events.ts` structure. Also, goal context imports `PortalGroupDeleted` directly from portal domain — should go through `portal/application/public-api.ts`.

**Approach:**

1. Move `portal-group-types.ts` content into `types.ts`
2. Move `portal-group-constructors.ts` content into `constructors.ts`
3. Move `portal-group-events.ts` content into `events.ts`
4. Update all imports in portal context (5 files)
5. Add `PortalGroupDeleted` to `portal/application/public-api.ts`
6. Fix goal's import to use public-api
7. Delete the three hyphenated files
8. Run full test suite

**Gate:** Zero changed imports break. All portal and goal tests pass.

---

### P2.2: Component server fn decoupling — single-mutation components (S6-2)

**Files:**

- `portal-delete-button.tsx` → receives `deleteAction` as prop
- `delete-property-dialog.tsx` → receives `deleteAction` as prop
- `portal-analytics-tab.tsx` → receives `analyticsAction` as prop
- `organization-settings-page.tsx` → receives action props

**Also:** `inbox-detail-content.tsx`, `inbox-bulk-actions.tsx` — both tagged REVIEW(S6-2), inbox tree refactor needed

**Effort:** ~120 min
**Risk:** Medium — route file changes, prop drilling, needs UI verification

**What:** Components import 1-2 server functions directly instead of receiving actions as props. Per `src/components/CONTEXT.md`: "Components must never import from server/."

**Approach (per component):**

1. In the route file: define `useMutationAction(serverFn, { ... })` or `useServerFn(serverFn)`
2. Pass the resulting action as a prop to the component
3. In the component: receive the action as a prop, remove the server fn import
4. Verify the component renders and submits correctly

**Inbox components:** `inbox-detail-content.tsx` and `inbox-bulk-actions.tsx` are 3 levels deep (route → inbox-page → detail-content). These require the inbox page to pass actions through. Handle as a separate sub-task.

**Gate:** Zero server fn imports remain in these components (except documented 5+ exceptions). All pages render. All mutations work.

---

### P2.3: Over-150-line component extraction (S7-1)

**Files:** 7 files, prioritized by complexity

| Priority | File                          | Lines | Extraction candidates                                    |
| -------- | ----------------------------- | ----- | -------------------------------------------------------- |
| 1        | `inbox-filters.tsx`           | 199   | Filter sections (property, status, source, rating, date) |
| 2        | `portal-analytics-tab.tsx`    | 170   | KPI cards, chart sections                                |
| 3        | `portal-detail-page.tsx`      | 165   | Form sections, preview panel                             |
| 4        | `property-dashboard.tsx`      | 158   | KPI strip, chart sections                                |
| 5        | `visually-hidden-input.tsx`   | 157   | Variant components                                       |
| 6        | `inbox-page.tsx`              | 156   | Detail panel, filter bar                                 |
| 7        | `portal-analytics-charts.tsx` | 155   | Individual chart components                              |

**Effort:** ~120 min (all 7) or ~30 min (top 3)
**Risk:** Low — pure extraction, no behavior change

**Approach (per file):**

1. Identify natural extraction boundaries (sections, panels, chart groups)
2. Extract sub-component into same concept folder
3. Replace inline code with sub-component usage
4. Verify rendering unchanged

**Gate:** File under 150 lines after extraction. No visual regressions. All tests pass.

---

### P2.4: Dashboard test coverage (S8-2)

**Files:** New test files for `src/contexts/dashboard/`
**Effort:** ~90 min
**Risk:** Low — additive tests

**What:** Dashboard has only 2 test files. Needs:

- Use case tests (getDashboardData, getPortalAnalytics) with in-memory fakes
- Repository test with tenant isolation
- Adapter tests

**Approach:**

1. Create in-memory fakes: `in-memory-dashboard-repo.ts` (exists), `in-memory-metric-stats-port.ts`, `in-memory-review-stats-port.ts`, `in-memory-portal-metrics-port.ts`
2. Write use case tests: happy path, error paths, tenant isolation
3. Write repository integration test
4. Create dashboard integration test helper

**Gate:** Dashboard goes from 2 test files → 6+ test files. All pass.

---

### P2.5: Error mapping duplication cleanup (S5-3)

**Files:** 5 contexts with duplicated error-to-HTTP-status mapping
**Effort:** ~45 min
**Risk:** Low — extract shared pattern

**What:** Each context defines its own `xxxErrorStatus()` function with identical `match(code).with(...).exhaustive()` pattern. Extract a shared utility.

**Approach:**

1. Create `src/shared/auth/error-status.ts` with a generic `makeErrorStatusMapper(map)` factory
2. Update inbox, integration, portal, goal, review contexts to use the factory
3. Remove per-context error status functions

**Gate:** All tests pass. Error responses return same HTTP status codes.

---

## P3 — Phase 22 (Production Hardening)

### P3.1: Drizzle migrations (S8-5)

**What:** No migration files exist. Schema managed via `drizzle-kit push`.
**Fix:** Generate initial migrations, add to CI.
**Effort:** ~30 min in Phase 22.

### P3.2: Composition/worker wiring audit (S9-1, S9-2)

**What:** composition.ts (387 lines) and worker/index.ts (175 lines) have manual wiring that must stay in sync with job/handler implementations.
**Fix:** Split into per-context wiring functions, add integration tests verifying all jobs/handlers registered.
**Effort:** ~60 min in Phase 22.

### P3.3: Worker build in CI (S9-4)

**What:** `build:worker` script exists but not in CI pipeline.
**Fix:** Add `pnpm build:worker` to CI.
**Effort:** ~15 min in Phase 22.

---

## P4 — Icebox

| Item                                               | Why icebox                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| AuthError type in middleware (S1-4)                | Already done in Session B                                                |
| `fallow-ignore` on use case types (S3-3)           | Intentional pattern — types used by composition/tests via `ReturnType<>` |
| Orphaned comment fragments in constructors (G0-13) | False alarm — multi-line architecture quote                              |
| `visually-hidden-input.tsx` extraction (S7-2)      | Low impact, single utility component                                     |
| Integration build.ts decomposition (S8-4)          | 182 lines but well-organized, low priority                               |
| Metric context CONTEXT.md note (S8-3)              | Doc fix — 2 minutes, can do anytime                                      |
| Staff assignment deadlock test (S9-3)              | 99.94% pass rate, only fails under specific concurrency                  |
| Husky prepare script (G0-14)                       | Husky partially configured, `lint-staged` works directly                 |

---

## Execution Order

```
P1.1 (catchUntagged) → P1.2 (useMutationAction audit) → P1.3 (permission tests)
    ↓
P2.1 (portal-group merge) → P2.2 (component decoupling) → P2.3 (line limits top 3)
    ↓                                                            ↓
P2.4 (dashboard tests) ←────────────────────────────────── P2.5 (error mapping)
    ↓
P3.1 → P3.2 → P3.3 (Phase 22 — do together)
```

**Total effort:** ~10 hours across P1+P2. Phase 22 items add ~2 hours.

**Recommendation:** Do P1 in one session, P2 across 2-3 sessions. Phase 22 when approaching production.
