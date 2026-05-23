# Review #15 — Tests

## Summary

The project has ~177 test files under `src/` plus 9 e2e spec files. Domain coverage is thorough (all 9 contexts have `rules.test.ts` and `constructors.test.ts`). Use-case coverage is strong (70 of ~77 use cases have tests). Repository integration tests against real Postgres with tenant isolation exist for most contexts. The reply state machine and inbox status transitions are well-tested with both happy and failure paths including role-based authorization. However, three server files with permission checks are entirely untested, five external-system adapters have zero contract tests, two inbox repository tests are structural-typing-only stubs skipping tenant isolation, and four identity upload use cases with security logic have no tests.

---

## BLOCKER

### B1. Server functions with auth/permission logic — no tests exercising forbidden roles

Three server files contain `can()` permission checks or auth-protected handlers but have **no test file at all**:

- `inbox/server/inbox.ts` — Calls `can(ctx.role, 'inbox.read')` and `can(ctx.role, 'inbox.update')` before delegating. No test file exists.
- `review/server/reply.ts` — Seven server functions (getReply, draftReply, submitReply, approveReply, rejectReply, deleteReply, retryPublish) all resolve tenant context and delegate to use cases that enforce role checks. No test file exists.
- `dashboard/server/dashboard.ts` — Calls `can(ctx.role, 'dashboard.read')`. No test file exists.

Per CONTEXT.md: _"Every use case tested for happy + error paths."_ While the underlying use cases are tested, the server boundary (permission gates, error→HTTP status mapping, resolveTenantContext integration) is unverified for these three files. The inbox and dashboard servers perform `can()` checks directly at the server layer, meaning a bug in the permission gate would not be caught by any test.

### B2. External-system adapters — zero contract/integration tests

Five of seven infrastructure adapters touching external systems have no test file:

- `integration/infrastructure/adapters/google-oauth.adapter.ts` — OAuth token exchange with Google. No test.
- `integration/infrastructure/adapters/google-review-api.adapter.ts` — Google review API calls. No test.
- `integration/infrastructure/adapters/gbp-api.adapter.ts` — Google Business Profile API. No test.
- `integration/infrastructure/adapters/property-event.adapter.ts` — Event publishing adapter. No test.
- `portal/infrastructure/adapters/s3-storage.adapter.ts` — S3 upload/finalize. No test.

Only `identity/infrastructure/adapters/auth-identity.adapter.test.ts` and `inbox/infrastructure/adapters/redis-unread-counter.test.ts` have tests. Per CONTEXT.md: _"Adapters: Integration with mocked external API — Test-after."_ These adapters are the boundary where third-party errors (HTTP failures, malformed responses) must be caught and translated to tagged errors. Without tests, error translation is unverified.

### B3. Inbox repository tests — structural-typing-only, no real tenant isolation

`inbox/infrastructure/repositories/inbox.repository.test.ts` and `inbox-note.repository.test.ts` contain comments admitting: _"No DB test infrastructure exists in this project."_ They verify that the repository factory compiles against the port interface using a mock DB chain. They do **not** test against real Postgres and do **not** verify tenant isolation.

Every other context's repository tests (property, review, reply, team, portal, portal-link, dashboard, metric, staff-assignment) run real integration tests with `ORG_A` vs `ORG_B` tenant isolation. Inbox is the sole context where tenant-scoped data access is unverified at the database layer.

### B4. Use cases without tests — some contain security logic

Eight use case source files have no corresponding test:

| Context  | Use case                   | Risk                                                               |
| -------- | -------------------------- | ------------------------------------------------------------------ |
| guest    | `get-public-portal`        | Public-facing, throws on not found                                 |
| guest    | `resolve-link-and-track`   | Orchestrates link resolution + tracking                            |
| guest    | `resolve-portal-context`   | Public-facing, throws on not found                                 |
| identity | `request-avatar-upload`    | Validates content type + file size, has `AuthContext`              |
| identity | `finalize-avatar-upload`   | Path traversal guard (`key.startsWith(prefix)`), has `AuthContext` |
| identity | `request-org-logo-upload`  | Similar validation to avatar upload                                |
| identity | `finalize-org-logo-upload` | Similar path guard to avatar finalize                              |
| portal   | `list-portal-links`        | Query use case, lower risk                                         |

The identity upload use cases are particularly concerning: `finalize-avatar-upload` contains a path-traversal security check that is completely untested.

---

## MAJOR

### M1. Reply use case tests use `vi.fn()` for all deps — functional but fragile

`review/application/use-cases/reply-operations.test.ts` constructs `ReplyDeps` using `vi.fn()` for every port method. This works but means:

- If the port interface adds a required method, tests silently pass because `vi.fn()` handles any call.
- The test is coupled to the specific mock structure, not to port behavior.

The inbox use case tests (e.g., `update-inbox-status.test.ts`) use shared in-memory implementations from `shared/testing/`, which is the better pattern — in-memory fakes enforce port contracts.

### M2. Server tests only verify error→status mapping, not handler flow

Most server test files (`properties.test.ts`, `teams.test.ts`, `goals.test.ts`, `portal-links.test.ts`, `portals.test.ts`, `staff-assignments.test.ts`, `google-connections.test.ts`, `gbp-import.test.ts`, `organizations.test.ts`, `auth-settings.test.ts`) test only the `errorStatus` mapping function and `throwContextError` construction. They do not test:

- Whether `resolveTenantContext` is called correctly
- Whether DTO validation passes/fails
- Whether the use case is invoked with the correct arguments
- Whether the permission gate fires before delegation

### M3. Team server test duplicates production mapping instead of importing

`team/server/teams.test.ts` copies the `teamErrorStatus` function body into the test file with a `switch` statement, commenting _"Since it's not exported, we test the same logic."_ This will silently pass if the production mapping changes. By contrast, `property/server/properties.test.ts` correctly imports `propertyErrorStatus` from the server module.

### M4. Test names describe implementation mechanics, not expected behavior

Multiple test suites use names like _"maps forbidden → 403"_ and _"throws Error with correct name, code, and status."_ These describe what code does, not what behavior is expected. Compare: _"rejects request from unauthorized role with 403"_ vs _"maps forbidden → 403."_

---

## MINOR

### m1. Inconsistent describe/it phrasing

Some test files use `describe('propertyErrorStatus (imported from server module)')` while others use `describe('teamErrorStatus (error → HTTP status mapping)')`. Minor but inconsistent.

### m2. Shared fixtures exist but some tests inline factory functions

`shared/testing/fixtures.ts` provides `buildTestProperty`, `buildTestTeam`, `buildTestPortal`. However, `reply-operations.test.ts` and `update-inbox-status.test.ts` define local `makeReview()`, `makeReply()`, `seedNew()` factories inline rather than using or extending shared fixtures.

---

## Layer-by-Layer Coverage Estimate

| Layer                               | Coverage | Notes                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Domain**                          | ~95%     | All `rules.ts`, `constructors.ts`, `errors.ts` have tests. `goal/domain/progress-strategy.ts` tested. `events.ts` tested in metric and guest. `metric/domain/types.ts` not tested but is pure types. Missing: `identity/domain/rules.test.ts` tests only `canInviteRole` — no invariant tests for org member constraints. |
| **Application (use cases)**         | ~90%     | 70/77 use cases have tests. Missing 7 noted in B4. Tests that exist cover both happy and error paths well. In-memory fakes from `shared/testing/` used in most. Reply operations tests are thorough on state machine transitions.                                                                                         |
| **Infrastructure (repos)**          | ~85%     | 9/11 repositories have real Postgres integration tests with tenant isolation. Inbox and inbox-note repos are structural-typing-only (no DB, no tenant test).                                                                                                                                                              |
| **Infrastructure (adapters)**       | ~15%     | 2 of 7 adapters have tests. Five external-system adapters untested.                                                                                                                                                                                                                                                       |
| **Infrastructure (mappers)**        | ~95%     | All mapper files have corresponding tests.                                                                                                                                                                                                                                                                                |
| **Infrastructure (jobs)**           | ~100%    | Both goal jobs and review jobs have tests. Shared `health-check.job` tested.                                                                                                                                                                                                                                              |
| **Infrastructure (event handlers)** | ~100%    | All event handlers across metric, goal, review, inbox contexts have tests.                                                                                                                                                                                                                                                |
| **Server**                          | ~55%     | 12 of 16 server files have tests, but tests only verify error→status mapping, not handler flow or permission gates. Three server files with `can()` checks have no tests at all.                                                                                                                                          |
| **Route/Component**                 | N/A      | No route-level unit tests found. 9 e2e spec files cover critical user flows.                                                                                                                                                                                                                                              |

---

## Top 3 Code Paths Most Urgently Needing Tests

1. **`inbox/server/inbox.ts`** — All `can()` permission gates are untested. Any regression in authorization would ship to production silently. This is the highest-risk gap because inbox operations are tenant-scoped and role-restricted.

2. **`identity/application/use-cases/finalize-avatar-upload.ts`** and **`finalize-org-logo-upload.ts`** — Contain path-traversal security guards (`key.startsWith(prefix)`) that are completely untested. A bug here could allow users to confirm uploads for keys outside their scope.

3. **`integration/infrastructure/adapters/google-review-api.adapter.ts`** and **`gbp-api.adapter.ts`** — These adapters translate external API responses into domain types and catch library errors into tagged errors. Without contract tests, malformed Google API responses will cause unhandled exceptions in production.

---

## One-Paragraph Summary

177 test files provide strong domain coverage (9/9 contexts have rules + constructors tests) and good use-case coverage (70/77 tested, most with both happy and failure paths including role-based authorization). Repository integration tests with real Postgres tenant isolation exist for 9 of 11 repositories. The critical gaps are: (1) three server files with `can()` permission checks have zero tests, (2) five external-system adapters have no contract tests, (3) inbox repository tests are structural-typing-only stubs skipping tenant isolation, and (4) four identity upload use cases including path-traversal guards are untested. The highest priority is adding permission-gate tests to `inbox/server/inbox.ts`, `review/server/reply.ts`, and `dashboard/server/dashboard.ts`.
