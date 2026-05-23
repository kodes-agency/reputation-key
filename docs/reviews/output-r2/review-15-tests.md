# Review 15: Tests (Re-audit R2)

**Date:** 2026-05-23
**Reviewer:** Hermes Agent
**Branch:** feat/phase-15c-goal-ui
**Scope:** All test files (`src/**/*.test.ts`, `src/**/*.test.tsx`) — 178 test files total.

## Summary

The test suite is comprehensive at 178 files with strong domain invariant coverage, per-use-case happy+error path testing, and tenant isolation tests in repository integration tests. No snapshot abuse, no testing of private methods, and good fixture hygiene. However, several gaps exist: server function tests validate DTOs and error mapping but don't exercise the full `createServerFn` pipeline; 7 use cases lack test files; and tenant-scoped second-org fixtures are missing in some newer contexts (goal, staff).

## Findings

### [MAJOR] F-15-01: 7 use cases have no test files

**File:** Missing test files
**Quote:** No test files for:

- `identity/application/use-cases/request-avatar-upload.ts`
- `identity/application/use-cases/finalize-avatar-upload.ts`
- `identity/application/use-cases/request-org-logo-upload.ts`
- `identity/application/use-cases/finalize-org-logo-upload.ts`
- `guest/application/use-cases/get-public-portal.ts`
- `guest/application/use-cases/resolve-link-and-track.ts`
- `guest/application/use-cases/resolve-portal-context.ts`

**Rule:** `src/contexts/CONTEXT.md` — "Every use case tested for happy + error paths."
**Fix:** Add test files for all 7 use cases. Upload use cases can share a describe block since they delegate to a storage port.

### [MAJOR] F-15-02: Server function tests are DTO-only, not end-to-end

**File:** `src/contexts/goal/server/goals.test.ts`, `src/contexts/staff/server/staff-assignments.test.ts`, `src/contexts/integration/server/google-connections.test.ts`

**Quote:** `goals.test.ts` comment: "Tests DTO validation, error→status mapping, and throwContextError construction." — never actually calls `createServerFn` handlers.

**Rule:** `src/contexts/CONTEXT.md` — server function pattern requires `tracedHandler`, `resolveTenantContext`, `can()`, error mapping. Tests should exercise the full pipeline or at minimum mock the container and verify auth gate + error propagation.
**Fix:** Add integration-level server function tests that mock `getContainer()` and `resolveTenantContext()`, then call the handler and verify: (1) 403 for unauthorized roles, (2) correct status codes for each error case, (3) result shape on success. The goal test file partially does this with `vi.mock` but only tests `can()` in isolation — never invokes the actual handler.

### [MAJOR] F-15-03: Goal context use cases lack auth/forbidden path tests

**File:** `src/contexts/goal/application/use-cases/create-goal.test.ts`, `update-goal.test.ts`, `cancel-goal.test.ts`

**Quote:** `create-goal.test.ts` — no `AuthContext` parameter, no `can()` call in tests. The use case accepts input without `ctx`, so auth checks live only in server functions.

**Rule:** `src/contexts/CONTEXT.md` — "Use case shape: Step 1: Authorize — `can(ctx.role, 'resource.action')`". If authorization is only in server functions, the server function tests must cover forbidden paths.
**Fix:** Either add `AuthContext` to goal use cases (preferred — makes auth testable at use case level), or ensure server function tests cover the forbidden path end-to-end.

### [MINOR] F-15-04: Goal context lacks second-tenant fixtures in use case tests

**File:** `src/contexts/goal/application/use-cases/*.test.ts`

**Quote:** None of the 5 goal use case test files contain `ORG_B` or cross-tenant assertions. The `create-goal.test.ts` uses `organizationId('org-1')` exclusively.

**Rule:** `src/contexts/CONTEXT.md` — "Every repo has tenant isolation test." While repo tests cover this, use cases that take `organizationId` should also verify cross-tenant rejection.
**Fix:** Add cross-tenant test cases to `get-goal.test.ts`, `update-goal.test.ts`, `cancel-goal.test.ts` to verify use cases reject operations on goals belonging to other orgs.

### [MINOR] F-15-05: Staff context lacks second-tenant fixtures in use case tests

**File:** `src/contexts/staff/application/use-cases/create-staff-assignment.test.ts`, `list-staff-assignments.test.ts`, `remove-staff-assignment.test.ts`

**Quote:** Tests use single-org fixtures. No test verifies that Staff A from Org A cannot access Org B's assignments.

**Rule:** Cross-tenant isolation should be verified at the use case level for tenant-scoped operations.
**Fix:** Add at least one test per mutation use case with a second org's context to verify cross-tenant rejection.

### [MINOR] F-15-06: `_unsafeUnwrap()` used extensively in domain tests

**File:** `src/contexts/goal/domain/constructors.test.ts`, `progress-strategy.test.ts`, and many others.

**Quote:** `expect(result._unsafeUnwrap().goalType).toBe('open')` — used 50+ times across domain tests.

**Rule:** neverthrow's `_unsafeUnwrap()` bypasses the Result type safety. In tests this is acceptable but verbose. Pattern could be simplified with a test helper like `unwrap(result)`.
**Fix:** Consider adding a `expectOk(result)` / `expectErr(result)` test helper to reduce boilerplate. Low priority.

### [NIT] F-15-07: Guest use case `list-portal-links` test exists but file not in portal test list

**File:** N/A — actually `list-portals.test.ts` covers the portal listing use case.

**Rule:** No issue. Portal context has full test coverage (25 files, 17/17 use cases tested).

### [NIT] F-15-08: Dashboard context has only 2 test files

**File:** `src/contexts/dashboard/` — 2 test files (get-dashboard-data.test.ts, dashboard.repository.test.ts)

**Quote:** Dashboard is a thin read-only aggregation context with one use case.
**Rule:** Per `src/contexts/CONTEXT.md` — thin contexts "may have sparse use cases. That's expected."
**Fix:** No action needed — 2 tests is appropriate for a single-query read-only context.

## Positive Observations

- **Zero snapshot abuse** — no `toMatchSnapshot()` calls found anywhere in the codebase.
- **No testing of private methods** — tests exercise public APIs (constructors, use cases, repos).
- **Good fixture hygiene** — `createFakeDeps()` pattern creates fresh instances per test via `beforeEach()`. No shared mutable state.
- **Excellent domain invariant testing** — Goal constructors test 35+ invariant combinations across 4 goal types × field validations. Progress strategy tests 16+ aggregation combinations.
- **Staff referral code collision tests** — comprehensive retry logic coverage with 3 test cases.
- **Repository tenant isolation** — Property, Portal, Portal-Link repos all have dedicated `ORG_A`/`ORG_B` isolation tests.
- **Use case second-org fixtures** — Inbox (3 files), Property, Integration (2 files), Team have cross-tenant test cases.
- **Good test naming** — descriptive test names like "rejects open goal with period dates", "retries on unique constraint violation and succeeds on second attempt".

## Counts

| Severity  | Count |
| --------- | ----- |
| BLOCKER   | 0     |
| MAJOR     | 3     |
| MINOR     | 3     |
| NIT       | 2     |
| **Total** | **8** |
