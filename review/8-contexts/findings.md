# Section 8 — Per-Context Deep Dive Findings

**Date:** 2026-05-29
**Scope:** All 12 bounded contexts (holistic layer review)
**Baseline:** Type check passes. All contexts have build.ts. Phase 15.5 vestigial code is already cleaned.

---

## Summary

| Severity | Count |
|----------|-------|
| MAJOR | 1 |
| MINOR | 2 |
| NIT | 2 |
| **Total** | **5** |

---

## MAJOR Findings

### S8-1 MAJOR: Phase 15.5 is already applied — plan is out of date

**File:** `docs/plan/plan.md:715`
**Category:** doc-discrepancy
**Tag:** [doc-fix]

**What:** The plan marks Phase 15.5 (Portal Groups + Model Reconfiguration) as "Pending." But the code has already been reconfigured:
- Goals schema has `groupId` (not `staffId`/`teamId`)
- Goal domain types have `portalId | groupId` scope (not staff/team)
- `getStaffIdForSession`, `resolveReferralCode`, `recordScanWithRef` — all removed
- No `?ref=` extraction in portal route
- No `referralCode` in staff assignments schema
- No `portalId` in teams schema

**Why it matters:** The plan is the authoritative roadmap. If it says Phase 15.5 is pending but it's already done, a developer reading the plan might try to implement it again or hesitate to build on top of the new model.

**CODE DOES:** Portal groups exist, goal model uses `groupId`/`portalId`/`propertyId` scope.
**PLAN SAYS:** Phase 15.5 is "Pending."

**Fix direction:** Update `docs/plan/plan.md` to mark Phase 15.5 as "Completed." Update the phase summary table (line 715).

---

## MINOR Findings

### S8-2 MINOR: Context test coverage varies widely — dashboard has only 2 test files

**Files:** Test coverage by context:
| Context | Test files |
|---------|-----------|
| portal | 26 |
| integration | 24 |
| identity | 17 |
| inbox | 17 |
| goal | 16 |
| property | 12 |
| guest | 11 |
| review | 11 |
| staff | 11 |
| team | 11 |
| metric | 8 |
| **dashboard** | **2** |

**Category:** missing-coverage
**Tag:** [code-fix] (deferred)

**What:** Dashboard context has only 2 test files despite having use cases, repository, server functions, and adapters. Per `src/contexts/CONTEXT.md` testing table: use cases should have "Default test-first" coverage with in-memory port fakes.

**Why it matters:** Dashboard is the most user-visible feature. Low test coverage means regressions in KPI calculations, chart data, or time-range logic could go undetected.

**Fix direction:** Add tests for dashboard use cases (`getDashboardData`, `getPortalAnalytics`), repository (tenant isolation), and adapters. Create in-memory fakes for dashboard repository and port adapters.

---

### S8-3 MINOR: Metric context — has no `server/` layer by design, but CONTEXT.md doesn't say why

**File:** `src/contexts/metric/` (missing server/)
**Category:** doc-gap
**Tag:** [doc-fix]

**What:** Metric context has no `server/` directory. Per `src/contexts/CONTEXT.md:20`: "Metric context has no server/ layer by design — it records readings via event handlers and background jobs, not via server functions called from routes." This is documented in the top-level contexts doc but NOT in `src/contexts/metric/CONTEXT.md`.

**Why it matters:** A developer looking only at the metric CONTEXT.md might expect a server/ directory and think it was accidentally deleted.

**Fix direction:** Add a note in `src/contexts/metric/CONTEXT.md` explaining that metric has no server functions by design.

---

## NIT Findings

### S8-4 NIT: Integration context — `build.ts` is 182 lines, largest of all contexts

**File:** `src/contexts/integration/build.ts` (182 lines)
**Category:** slop
**Tag:** [code-fix] (minor)

**What:** Integration's build.ts is the largest composition root (182 lines). Next largest is portal at 169, inbox at 150. The composition logic may be complex, but 182 lines suggests it could be decomposed.

**Fix direction:** Review for extraction opportunities. If it's genuinely complex, document why. If it's boilerplate, extract shared patterns.

---

### S8-5 NIT: No Drizzle migration files — schema managed via `drizzle-kit push`

**File:** `drizzle/` directory (empty)
**Category:** operational-concern
**Tag:** [code-fix] (deferred)

**What:** No SQL migration files exist in the `drizzle/` directory. The `package.json` has `db:push` (direct schema push) but also `db:generate` and `db:migrate`. Either migrations were never generated, or the directory structure changed.

**Why it matters:** For production deployments, migrations are essential for versioned, repeatable schema changes. `drizzle-kit push` is fine for development but dangerous for production.

**Fix direction:** Generate initial migrations with `pnpm db:generate`. Add migration workflow to CI. This is deferred to Phase 22 (Production Hardening).
