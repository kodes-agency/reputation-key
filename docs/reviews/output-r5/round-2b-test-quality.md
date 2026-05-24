# Round 2B — Test Quality + Coverage Gaps

**Branch:** feat/phase-15c-goal-ui
**Scope:** `src/contexts/` — 321 source files, 172 test files
**Date:** 2026-05-24

---

## 1. Use Cases with NO Test File

### [MAJOR] Missing test: get-public-portal

**File:** src/contexts/guest/application/use-cases/get-public-portal.ts
**Fix:** Add `get-public-portal.test.ts` covering happy path and not-found error.

### [MAJOR] Missing test: resolve-link-and-track

**File:** src/contexts/guest/application/use-cases/resolve-link-and-track.ts
**Fix:** Add `resolve-link-and-track.test.ts` covering link resolution, event emission, and not-found.

### [MAJOR] Missing test: resolve-portal-context

**File:** src/contexts/guest/application/use-cases/resolve-portal-context.ts
**Fix:** Add `resolve-portal-context.test.ts` covering context resolution and missing portal/staff scenarios.

### [MAJOR] Missing test: list-portal-links

**File:** src/contexts/portal/application/use-cases/list-portal-links.ts
**Fix:** Add `list-portal-links.test.ts` covering filtered listing and empty result.

---

## 2. Event Handlers with NO Test File

### [MAJOR] Missing test: on-feedback-submitted (inbox)

**File:** src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.ts
**Fix:** Add `on-feedback-submitted.test.ts` — handler creates inbox items; test happy path, idempotent `already_exists`, and error swallowing.

### [MAJOR] Missing test: on-review-created (inbox)

**File:** src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts
**Fix:** Add `on-review-created.test.ts` — test inbox item creation, duplicate suppression, and error handling.

### [MAJOR] Missing test: on-review-updated (inbox)

**File:** src/contexts/inbox/infrastructure/event-handlers/on-review-updated.ts
**Fix:** Add `on-review-updated.test.ts` — test denormalized field sync and missing-item skip.

---

## 3. Background Jobs with NO Test File

### [MAJOR] Missing test: import-property.job

**File:** src/contexts/integration/infrastructure/jobs/import-property.job.ts
**Fix:** Add `import-property.job.test.ts` — BullMQ job handler processes imports; test success and failure paths.

### [MINOR] Missing test: refresh-materialized-view.job

**File:** src/contexts/metric/infrastructure/jobs/refresh-materialized-view.job.ts
**Fix:** Add `refresh-materialized-view.job.test.ts` — test refresh logic and error handling.

### [MINOR] Missing test: process-image.job

**File:** src/contexts/portal/infrastructure/jobs/process-image.job.ts
**Fix:** Add `process-image.job.test.ts` — test image processing and failure.

### [MAJOR] Missing test: publish-reply.job

**File:** src/contexts/review/infrastructure/jobs/publish-reply.job.ts
**Fix:** Add `publish-reply.job.test.ts` — critical for reply lifecycle; test publish, failure, and retry.

### [MAJOR] Missing test: sync-property-reviews.job

**File:** src/contexts/review/infrastructure/jobs/sync-property-reviews.job.ts
**Fix:** Add `sync-property-reviews.job.test.ts` — test sync trigger, error handling, and idempotency.

---

## 4. Server Functions with NO Test File

### [MAJOR] Missing test: inbox server functions

**File:** src/contexts/inbox/server/inbox.ts
**Fix:** Add `inbox.test.ts` covering DTO validation, error-to-status mapping, and permission gates.

### [MINOR] Missing test: dashboard server function

**File:** src/contexts/dashboard/server/dashboard.ts
**Fix:** Add `dashboard.test.ts` covering DTO validation and error mapping.

### [MAJOR] Missing test: reply server functions

**File:** src/contexts/review/server/reply.ts
**Fix:** Add `reply.test.ts` — 7 server functions (getReply, draftReply, submitReply, approveReply, rejectReply, deleteReply, retryPublish) with no test coverage for DTO validation or error mapping.

---

## 5. `as any` Type Escapes in Tests

### [NIT] `as any` in track-review-link-click test

**File:** src/contexts/guest/application/use-cases/track-review-link-click.test.ts:36
**Fix:** Type the throwing event bus as `Pick<EventBus, 'emit' | 'on' | 'off'>` instead of `as any`.

### [NIT] `as any` in on-staff-unassigned test

**File:** src/contexts/goal/infrastructure/event-handlers/on-staff-unassigned.test.ts:116
**Fix:** Use `createMockLogger()` from shared testing utilities instead of `logger as any`.

### [NIT] `as any` in on-team-deleted test

**File:** src/contexts/goal/infrastructure/event-handlers/on-team-deleted.test.ts:107
**Fix:** Use `createMockLogger()` from shared testing utilities instead of `logger as any`.

### [NIT] `as any` in on-portal-deleted test

**File:** src/contexts/goal/infrastructure/event-handlers/on-portal-deleted.test.ts:107
**Fix:** Use `createMockLogger()` from shared testing utilities instead of `logger as any`.

---

## 6. Broad Module Mocking (vi.mock)

### [MINOR] Mocks entire `#/shared/auth/auth` module

**File:** src/contexts/identity/infrastructure/adapters/auth-identity.adapter.test.ts:23
**Fix:** Mock is acceptable for adapter tests against third-party auth — but consider extracting a thinner interface to reduce mock surface.

### [MINOR] Mocks entire `@tanstack/react-start/server` module

**File:** src/contexts/identity/infrastructure/adapters/auth-identity.adapter.test.ts:42
**Fix:** Mock is expected for adapter boundary tests — document why this is intentional.

### [MINOR] Mocks entire `#/shared/observability/logger` module

**File:** src/contexts/review/application/use-cases/sync-reviews.test.ts:21
**Fix:** Inject a mock logger via deps instead of hoisted module mock to test behavior, not wiring.

### [MINOR] Mocks entire `#/shared/observability/logger` module

**File:** src/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job.test.ts:15
**Fix:** Pass mock logger via deps or a factory parameter rather than vi.mock.

### [MINOR] Mocks entire `#/shared/observability/logger` module

**File:** src/contexts/review/infrastructure/jobs/purge-expired-reviews.job.test.ts:10
**Fix:** Pass mock logger via deps or a factory parameter rather than vi.mock.

### [MAJOR] Mocks 3 modules for server function test

**File:** src/contexts/goal/server/goals.test.ts:356,360,370
**Fix:** `vi.mock('#/shared/auth/headers')`, `vi.mock('#/shared/auth/middleware')`, `vi.mock('#/composition')` — these mock the entire DI container. Consider testing at the use-case level instead, and only testing DTO validation + error mapping at the server layer.

### [MINOR] Mocks 2 auth modules for server function test

**File:** src/contexts/goal/server/staff-goals.test.ts:9,13
**Fix:** `vi.mock('#/shared/auth/headers')`, `vi.mock('#/shared/auth/middleware')` — same pattern as goals.test.ts.

---

## 7. Permission-Denied Edge Case Missing (33 use cases)

These use cases call `can(role, permission)` but their tests have **no test for wrong-role / permission-denied**:

### [MAJOR] Goal context — no permission-denied test

**Files:**

- `src/contexts/goal/application/use-cases/get-goal.ts`
- `src/contexts/goal/application/use-cases/list-goals.ts`

**Fix:** Add `it('rejects when role lacks required permission')` test case for each.

### [MAJOR] Identity context — no permission-denied test

**Files:**

- `src/contexts/identity/application/use-cases/invite-member.ts`
- `src/contexts/identity/application/use-cases/list-invitations.ts`
- `src/contexts/identity/application/use-cases/remove-member.ts`
- `src/contexts/identity/application/use-cases/resend-invitation.ts`
- `src/contexts/identity/application/use-cases/update-organization.ts`

**Fix:** Add permission-denied test for each use case.

### [MAJOR] Integration context — no permission-denied test

**Files:**

- `src/contexts/integration/application/use-cases/get-import-status.ts`
- `src/contexts/integration/application/use-cases/list-google-connections.ts`

**Fix:** Add permission-denied test for each use case.

### [MAJOR] Portal context — no permission-denied test (12 use cases)

**Files:**

- `src/contexts/portal/application/use-cases/create-portal.ts`
- `src/contexts/portal/application/use-cases/delete-link-category.ts`
- `src/contexts/portal/application/use-cases/delete-link.ts`
- `src/contexts/portal/application/use-cases/get-portal.ts`
- `src/contexts/portal/application/use-cases/list-portals.ts`
- `src/contexts/portal/application/use-cases/reorder-categories.ts`
- `src/contexts/portal/application/use-cases/reorder-links.ts`
- `src/contexts/portal/application/use-cases/request-upload-url.ts`
- `src/contexts/portal/application/use-cases/soft-delete-portal.ts`
- `src/contexts/portal/application/use-cases/update-link-category.ts`
- `src/contexts/portal/application/use-cases/update-link.ts`
- `src/contexts/portal/application/use-cases/update-portal.ts`

**Fix:** Add permission-denied test for each use case.

### [MAJOR] Property context — no permission-denied test

**Files:**

- `src/contexts/property/application/use-cases/create-property.ts`
- `src/contexts/property/application/use-cases/get-property.ts`
- `src/contexts/property/application/use-cases/list-properties.ts`
- `src/contexts/property/application/use-cases/soft-delete-property.ts`
- `src/contexts/property/application/use-cases/update-property.ts`

**Fix:** Add permission-denied test for each use case.

### [MAJOR] Review context — no permission-denied test

**File:** src/contexts/review/application/use-cases/reply-operations.ts
**Fix:** Add permission-denied test covering Staff role rejection on reply manage.

### [MAJOR] Staff context — no permission-denied test

**Files:**

- `src/contexts/staff/application/use-cases/create-staff-assignment.ts`
- `src/contexts/staff/application/use-cases/list-staff-assignments.ts`
- `src/contexts/staff/application/use-cases/remove-staff-assignment.ts`

**Fix:** Add permission-denied test for each use case.

### [MAJOR] Team context — no permission-denied test

**Files:**

- `src/contexts/team/application/use-cases/create-team.ts`
- `src/contexts/team/application/use-cases/update-team.ts`

**Fix:** Add permission-denied test for each use case.

---

## 8. Missing Error-Path / Repository-Failure Tests

These use case tests have **no test for repository returning error or not-found**:

### [MINOR] No error-path test: get-dashboard-data

**File:** src/contexts/dashboard/application/use-cases/get-dashboard-data.ts
**Fix:** Add test for repo/query failure returning error.

### [MINOR] No error-path test: list-goals

**File:** src/contexts/goal/application/use-cases/list-goals.ts
**Fix:** Add test for empty/error scenario.

### [MINOR] No error-path test: get-staff-id-for-session

**File:** src/contexts/guest/application/use-cases/get-staff-id-for-session.ts
**Fix:** Add test for session-not-found error.

### [MINOR] No error-path test: bulk-update-inbox-status

**File:** src/contexts/inbox/application/use-cases/bulk-update-inbox-status.ts
**Fix:** Add test for partial failure or empty input.

### [MINOR] No error-path test: list-google-connections

**File:** src/contexts/integration/application/use-cases/list-google-connections.ts
**Fix:** Add test for repo error.

### [MINOR] No error-path test: record-metric

**File:** src/contexts/metric/application/use-cases/record-metric.ts
**Fix:** Add test for repo insert failure.

### [MINOR] No error-path test: get-portal-qr-url

**File:** src/contexts/portal/application/use-cases/get-portal-qr-url.ts
**Fix:** Add test for portal-not-found error.

### [MINOR] No error-path test: list-portals

**File:** src/contexts/portal/application/use-cases/list-portals.ts
**Fix:** Add test for empty/error scenario.

### [MINOR] No error-path test: list-properties

**File:** src/contexts/property/application/use-cases/list-properties.ts
**Fix:** Add test for empty/error scenario.

### [MINOR] No error-path test: list-staff-assignments

**File:** src/contexts/staff/application/use-cases/list-staff-assignments.ts
**Fix:** Add test for empty/error scenario.

### [MINOR] No error-path test: list-teams

**File:** src/contexts/team/application/use-cases/list-teams.ts
**Fix:** Add test for empty/error scenario.

---

## 9. Event Handler Coverage vs. CONTEXT.md

All event types defined in `shared/events/events.ts`:

| Event                                  | Handler Exists                                                    | Test Exists              |
| -------------------------------------- | ----------------------------------------------------------------- | ------------------------ |
| `property.created`                     | ✅ `review/on-property-created`                                   | ✅                       |
| `staff.unassigned`                     | ✅ `goal/on-staff-unassigned`                                     | ✅                       |
| `team.deleted`                         | ✅ `goal/on-team-deleted`                                         | ✅                       |
| `portal.deleted`                       | ✅ `goal/on-portal-deleted`                                       | ✅                       |
| `metric.recorded`                      | ✅ `goal/on-metric-recorded`                                      | ✅                       |
| `scan.recorded`                        | ✅ `metric/on-scan-recorded`                                      | ✅                       |
| `rating.submitted`                     | ✅ `metric/on-rating-submitted`                                   | ✅                       |
| `feedback.submitted`                   | ✅ `metric/on-feedback-submitted` + `inbox/on-feedback-submitted` | ⚠️ inbox handler NO TEST |
| `review.created`                       | ✅ `metric/on-review-created` + `inbox/on-review-created`         | ⚠️ inbox handler NO TEST |
| `review.updated`                       | ✅ `inbox/on-review-updated`                                      | ❌ NO TEST               |
| `review.link.clicked`                  | ✅ `metric/on-review-link-clicked`                                | ✅                       |
| `reply.published`                      | ✅ `inbox/on-reply-published`                                     | ✅                       |
| `identity.*`                           | No subscribers                                                    | N/A                      |
| `team.created/updated`                 | No subscribers                                                    | N/A                      |
| `staff.assigned`                       | No subscribers                                                    | N/A                      |
| `portal.created/updated` + link events | No subscribers                                                    | N/A                      |
| `integration.*` events                 | No subscribers                                                    | N/A                      |
| `inbox.*` events                       | No subscribers                                                    | N/A                      |
| `goal.*` events                        | No subscribers                                                    | N/A                      |

### [MAJOR] Inbox event handler gap — 3 handlers untested

**Files:**

- `src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.ts`
- `src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts`
- `src/contexts/inbox/infrastructure/event-handlers/on-review-updated.ts`

**Fix:** All three handle critical inbox item creation/update flows and must have tests per the "every use case tested" requirement in CONTEXT.md.

---

## 10. Tests Asserting on Implementation Details

### [MINOR] staff-goals.test.ts tests `can()` directly instead of server function behavior

**File:** src/contexts/goal/server/staff-goals.test.ts
**Fix:** The test imports `can()` and `throwContextError()` directly, testing the permission function rather than the actual server function behavior. This doesn't verify the wiring between the server function and the permission check. Consider integration-style test or at minimum test that the server function calls `can()`.

### [NIT] goals.test.ts imports `goalErrorStatus` for direct unit testing

**File:** src/contexts/goal/server/goals.test.ts:16
**Fix:** Tests the private `goalErrorStatus` function directly. This is a lookup table — testing it is fine as a guard but the real value is testing the server function's error mapping end-to-end.

### [NIT] portal server tests test error-to-status mapping directly

**File:** src/contexts/portal/server/portals.test.ts
**Fix:** Tests `portalErrorStatus(code)` directly — acceptable as a regression guard but shouldn't be the only test.

### [MINOR] on-reply-published.test.ts asserts on `repo.updateStatus` mock calls

**File:** src/contexts/inbox/infrastructure/event-handlers/on-reply-published.test.ts:67
**Fix:** Uses `toHaveBeenCalledWith` to assert exact arguments on mock — asserts on which repo method is called and with what args, rather than verifying the state outcome. Consider also verifying the end state.

---

## 11. `skip` / `todo` in Tests

No instances of `.skip`, `.todo`, `xit`, `xdescribe`, `xtest`, `test.skip`, `it.skip`, `describe.skip`, `test.todo`, or `it.todo` found in any test file. ✅

---

## Summary

**BLOCKER: 0**, **MAJOR: 26**, **MINOR: 17**, **NIT: 5**

### Category Breakdown

- **Missing use case tests:** 4 (MAJOR)
- **Missing event handler tests:** 3 (MAJOR)
- **Missing job tests:** 5 (3 MAJOR, 2 MINOR)
- **Missing server function tests:** 3 (2 MAJOR, 1 MINOR)
- **`as any` type escapes:** 4 (NIT)
- **Broad module mocking:** 7 (1 MAJOR, 6 MINOR)
- **Missing permission-denied tests:** 33 use cases across 7 contexts (MAJOR — counted as 8 findings)
- **Missing error-path tests:** 11 (MINOR)
- **Implementation-detail assertions:** 4 (2 MINOR, 2 NIT)
- **Skip/todo:** 0 ✅

### Test Coverage Ratio

- Source files: 321
- Test files: 172
- Ratio: 53.6% of source files have co-located tests

### Top Priority

1. Add tests for 3 inbox event handlers (critical business logic — review/feedback ingestion)
2. Add permission-denied tests across all 33 use cases
3. Add tests for 3 missing server function files (inbox, dashboard, reply)
