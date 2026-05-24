# Round 3B — Test Gaps & Code Quality Final Check

**Branch:** `feat/phase-15c-goal-ui`
**Date:** 2026-05-24
**Scope:** All bounded contexts under `src/contexts/`

---

## 1. Use Cases with `can()` Checks — Missing Permission-Denied Tests

### 1a. Use case with `can()` and NO test file at all

| Severity | File                                                | Detail                            |
| -------- | --------------------------------------------------- | --------------------------------- |
| MAJOR    | `portal/application/use-cases/list-portal-links.ts` | Has `can()`, no `.test.ts` exists |

### 1b. Use cases with tests but NO permission-denied coverage (20 files)

All have ≥1 `can()` call but their test files contain no assertion for `forbidden` / `denied` / `permission` scenarios.

| Severity | File                                                           | `can()` calls |
| -------- | -------------------------------------------------------------- | ------------- |
| MAJOR    | `goal/application/use-cases/get-goal.ts`                       | 1             |
| MAJOR    | `goal/application/use-cases/list-goals.ts`                     | 1             |
| MAJOR    | `guest/application/use-cases/record-scan-with-ref.ts`          | 2             |
| MAJOR    | `guest/application/use-cases/record-scan.ts`                   | 1             |
| MAJOR    | `inbox/application/use-cases/add-inbox-note.ts`                | 1             |
| MAJOR    | `inbox/application/use-cases/assign-inbox-item.ts`             | 1             |
| MAJOR    | `inbox/application/use-cases/bulk-update-inbox-status.ts`      | 1             |
| MAJOR    | `inbox/application/use-cases/get-inbox-item-detail.ts`         | 1             |
| MAJOR    | `inbox/application/use-cases/get-inbox-items.ts`               | 1             |
| MAJOR    | `inbox/application/use-cases/update-inbox-status.ts`           | 1             |
| MAJOR    | `integration/application/use-cases/get-import-status.ts`       | 1             |
| MAJOR    | `integration/application/use-cases/list-google-connections.ts` | 3             |
| MAJOR    | `portal/application/use-cases/get-portal.ts`                   | 1             |
| MAJOR    | `portal/application/use-cases/list-portals.ts`                 | 1             |
| MAJOR    | `portal/application/use-cases/request-upload-url.ts`           | 1             |
| MAJOR    | `property/application/use-cases/get-property.ts`               | 1             |
| MAJOR    | `property/application/use-cases/list-properties.ts`            | 1             |
| MAJOR    | `review/application/use-cases/reply-operations.ts`             | 1             |
| MAJOR    | `staff/application/use-cases/list-staff-assignments.ts`        | 1             |
| MAJOR    | `staff/application/use-cases/resolve-referral-code.ts`         | 1             |

**False positives excluded:** 9 `.test.ts` files were matched by `grep -rl "can("` (the test files themselves import/use `can()` in assertions). These are NOT source files — they already have tests.

---

## 2. Event Handlers Without Tests

All 3 are in the **inbox** context:

| Severity | File                                                           | Lines |
| -------- | -------------------------------------------------------------- | ----- |
| MINOR    | `inbox/infrastructure/event-handlers/on-review-updated.ts`     | 38    |
| MINOR    | `inbox/infrastructure/event-handlers/on-feedback-submitted.ts` | 37    |
| MINOR    | `inbox/infrastructure/event-handlers/on-review-created.ts`     | 37    |

These are small (~37 lines each) delegation handlers. Missing coverage is low risk but should be added for completeness.

---

## 3. Server Functions Without Tests

| Severity | File                            | Lines | Note                 |
| -------- | ------------------------------- | ----- | -------------------- |
| MAJOR    | `inbox/server/inbox.ts`         | 341   | Large file, no test  |
| MAJOR    | `review/server/reply.ts`        | 254   | Large file, no test  |
| MINOR    | `dashboard/server/dashboard.ts` | 79    | Small file, low risk |

The inbox and reply server files are substantial. Server functions are the public API surface — untested server code means authorization routing and input validation are unverified.

---

## 4. Happy-Path-Only Test Files (No Error/Failure Coverage)

15 use-case test files contain no assertions for error, failure, rejection, forbidden, denied, or invalid scenarios:

| Severity | File                                                                     |
| -------- | ------------------------------------------------------------------------ |
| MINOR    | `portal/application/use-cases/list-portals.test.ts`                      |
| MINOR    | `portal/application/use-cases/get-portal-qr-url.test.ts`                 |
| MINOR    | `inbox/application/use-cases/get-inbox-items.test.ts`                    |
| MINOR    | `property/application/use-cases/list-properties.test.ts`                 |
| MINOR    | `integration/application/use-cases/list-google-connections.test.ts`      |
| MINOR    | `integration/application/use-cases/handle-gbp-notification.test.ts`      |
| MINOR    | `dashboard/application/use-cases/get-dashboard-data.test.ts`             |
| MINOR    | `team/application/use-cases/list-teams.test.ts`                          |
| MINOR    | `guest/application/use-cases/record-scan-with-ref.test.ts`               |
| MINOR    | `guest/application/use-cases/get-staff-id-for-session.test.ts`           |
| MINOR    | `guest/application/use-cases/staff-attribution-flow.integration.test.ts` |
| MINOR    | `staff/application/use-cases/list-staff-assignments.test.ts`             |
| MINOR    | `metric/application/use-cases/record-metric.test.ts`                     |
| MINOR    | `goal/application/use-cases/get-goal.test.ts`                            |
| MINOR    | `goal/application/use-cases/list-goals.test.ts`                          |

Many of these overlap with §1b — the same files that lack permission-denied tests also lack any error-path tests at all.

---

## 5. `as any` in Test Files

Only **4 occurrences** across 4 files — very low:

| Severity | File                                                             | Count |
| -------- | ---------------------------------------------------------------- | ----- |
| NIT      | `guest/application/use-cases/track-review-link-click.test.ts`    | 1     |
| NIT      | `goal/infrastructure/event-handlers/on-team-deleted.test.ts`     | 1     |
| NIT      | `goal/infrastructure/event-handlers/on-staff-unassigned.test.ts` | 1     |
| NIT      | `goal/infrastructure/event-handlers/on-portal-deleted.test.ts`   | 1     |

No action needed — these are isolated and harmless.

---

## 6. Mock-Heavy Tests (>5 Mocked Functions)

| Severity | File                                                              | Mock Calls | Note                                                         |
| -------- | ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| MINOR    | `identity/infrastructure/adapters/auth-identity.adapter.test.ts`  | 33         | Adapter test — high mock count expected for external service |
| MINOR    | `review/infrastructure/jobs/purge-expired-reviews.job.test.ts`    | 32         | Job test — orchestrates many deps                            |
| MINOR    | `review/application/use-cases/reply-operations.test.ts`           | 28         | Complex use case with many deps                              |
| MINOR    | `review/application/use-cases/sync-reviews.test.ts`               | 25         | Complex use case with many deps                              |
| MINOR    | `review/infrastructure/jobs/refresh-expiring-reviews.job.test.ts` | 23         | Job test                                                     |
| MINOR    | `inbox/infrastructure/event-handlers/on-reply-published.test.ts`  | 10         | Moderate                                                     |
| MINOR    | `goal/infrastructure/event-handlers/on-staff-unassigned.test.ts`  | 7          | Moderate                                                     |
| MINOR    | `goal/infrastructure/event-handlers/on-team-deleted.test.ts`      | 6          | Borderline                                                   |
| MINOR    | `goal/infrastructure/event-handlers/on-portal-deleted.test.ts`    | 6          | Borderline                                                   |
| MINOR    | `identity/application/use-cases/register-user-and-org.test.ts`    | 6          | Borderline                                                   |
| MINOR    | `goal/server/goals.test.ts`                                       | 6          | Borderline                                                   |

The top 5 (23-33 mocks) are in infrastructure/job layers that naturally have many dependencies. Not necessarily wrong, but worth reviewing to ensure tests verify behavior rather than mock setup.

---

## Summary

**BLOCKER: 0**, **MAJOR: 23**, **MINOR: 19**, **NIT: 4**

### Breakdown

- **MAJOR (23):** 20 use cases with `can()` authorization but no permission-denied test + 1 use case with `can()` and no test at all + 2 large untested server files (674 combined lines)
- **MINOR (19):** 15 happy-path-only tests + 3 untested small event handlers + 1 small untested server file
- **NIT (4):** 4 `as any` occurrences in tests (isolated, harmless)

### Top Priority Fixes

1. **Add permission-denied tests** for the 20 use cases in §1b — these guard the authorization boundary
2. **Create test for `list-portal-links.ts`** — the only use case with `can()` that has zero test coverage
3. **Add tests for `inbox/server/inbox.ts` (341 lines)** and **`review/server/reply.ts` (254 lines)** — these are the largest untested server surfaces
