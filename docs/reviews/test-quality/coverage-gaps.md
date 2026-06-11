# Test Quality Audit — Coverage Gaps

**Date:** 2026-06-10
**Scope:** All 14 contexts, 90 use-case modules

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 12    |
| MINOR    | 4     |
| NIT      | 3     |

### Coverage Snapshot

| Context      | Source | Tested | Ratio     | Status   |
| ------------ | ------ | ------ | --------- | -------- |
| activity     | 1      | 0      | 0%        | 🔴 Empty |
| portal       | 23     | 19     | 83%       | 🟡 Low   |
| review       | 2      | 2      | 100%      | ✅       |
| notification | 1      | 1      | 100%      | ✅       |
| team         | 5      | 5      | 100%      | ✅       |
| staff        | 5      | 5      | 100%      | ✅       |
| property     | 5      | 5      | 100%      | ✅       |
| metric       | 1      | 1      | 100%      | ✅       |
| integration  | 10     | 10     | 100%      | ✅       |
| inbox        | 10     | 10     | 100%      | ✅       |
| identity     | 12     | 12     | 100%      | ✅       |
| guest        | 7      | 7      | 100%      | ✅       |
| goal         | 5      | 5      | 100%      | ✅       |
| dashboard    | 3      | 3      | 100%      | ✅       |
| **Total**    | **90** | **85** | **94.4%** |          |

---

## Untested Use Cases

### [ACTIVITY] [MAJOR] `insert-activity-log` — zero test coverage

```
File:  src/contexts/activity/application/use-cases/insert-activity-log.ts
Quote: // Idempotency gate — skip if a duplicate entry already exists
       const duplicate = await deps.repo.findDuplicate(...)
       if (duplicate) return
Rule:  Project convention — "Every use case tested for happy path + every error path."
Fix:   Create insert-activity-log.test.ts covering:
       (1) Happy path — inserts activity with resolved actor info
       (2) Idempotency — skips when duplicate found
       (3) User lookup fallback — falls back to "System" on lookup failure
       (4) Domain construction error — propagates `createActivityLog` errors
       (5) Repo insert failure — logs and re-throws
```

### [PORTAL] [MAJOR] `add-portal-to-group` — untested authorization gate

```
File:  src/contexts/portal/application/use-cases/add-portal-to-group.ts
Quote: if (!can(ctx.role, 'portal.update')) {
           throw portalError('forbidden', 'this role cannot manage portal group membership')
       }
Rule:  Project convention — forbidden path must be tested for every authorized use case
Fix:   Create add-portal-to-group.test.ts covering:
       (1) Happy path — adds portal to group and emits portal.added_to_group
       (2) Forbidden — rejects Staff role
       (3) Group not found — throws group_not_found
       (4) Already grouped — throws portal_already_grouped
```

### [PORTAL] [MAJOR] `remove-portal-from-group` — untested authorization gate

```
File:  src/contexts/portal/application/use-cases/remove-portal-from-group.ts
Quote: if (!can(ctx.role, 'portal.update')) {
           throw portalError('forbidden', 'this role cannot manage portal group membership')
       }
Rule:  Project convention — forbidden path must be tested for every authorized use case
Fix:   Create remove-portal-from-group.test.ts covering:
       (1) Happy path — removes portal from group and emits portal.removed_from_group
       (2) Forbidden — rejects unauthorized roles
       (3) Group not found — throws group_not_found
       (4) Portal not in group — throws portal_not_in_group
```

### [PORTAL] [MAJOR] `soft-delete-portal-group` — untested authorization + delete gate

```
File:  src/contexts/portal/application/use-cases/soft-delete-portal-group.ts
Quote: if (!can(ctx.role, 'portal.delete')) {
           throw portalError('forbidden', 'this role cannot delete portal groups')
       }
Rule:  Project convention — forbidden path must be tested for every authorized use case
Fix:   Create soft-delete-portal-group.test.ts covering:
       (1) Happy path — soft-deletes and emits portal_group.deleted
       (2) Forbidden — rejects roles without portal.delete
       (3) Group not found — throws group_not_found
```

### [PORTAL] [MAJOR] `get-portal-group` — untested read query with auth gate

```
File:  src/contexts/portal/application/use-cases/get-portal-group.ts
Quote: (uses can() permission check via shared pattern)
Rule:  Project convention — forbidden path must be tested for every authorized use case
Fix:   Create get-portal-group.test.ts covering:
       (1) Happy path — returns group by ID
       (2) Forbidden — rejects unauthorized roles
       (3) Group not found — throws group_not_found
```

---

## Test Quality Issues (Existing Tests)

### [METRIC] [MAJOR] `record-metric` — minimal coverage, no error paths

```
File:  src/contexts/metric/application/use-cases/record-metric.test.ts
Quote: it('accepts nullable groupId and passes it through', ...)
       it('emits a MetricRecorded event after inserting a reading', ...)
Rule:  Project convention — "happy path + every error path"
Fix:   Add tests for:
       (1) Invalid metricKey — should reject unknown keys
       (2) Missing required fields — should reject malformed input
       (3) Repo insert failure — should propagate error
```

### [DASHBOARD] [MAJOR] `get-staff-dashboard-data` — no forbidden/role-based path tested

```
File:  src/contexts/dashboard/application/use-cases/get-staff-dashboard-data.test.ts:35
Quote: describe('getStaffDashboardData (use case)', () => {
         it('returns empty KPIs with hasAssignments=false when no portals are assigned', ...)
Rule:  Project convention — role-based access control must be tested
Fix:   Add test verifying Staff with no assignments gets empty data
       without accessing another org's portal data (tenant isolation check).
```

### [DASHBOARD] [MAJOR] `get-dashboard-data` — no error path coverage

```
File:  src/contexts/dashboard/application/use-cases/get-dashboard-data.test.ts:14
Quote: describe('getDashboardData (use case)', () => {
         it('composes all dashboard sections from repo calls', ...)
         it('includes engagement funnel when portalId is provided', ...)
Rule:  Project convention — business failure path tested
Fix:   Add test for repo throwing (e.g. DB connection failure)
       and verify error propagation, not silent fallback.
```

### [DASHBOARD] [MAJOR] `get-portal-analytics` — no error path coverage

```
File:  src/contexts/dashboard/application/use-cases/get-portal-analytics.test.ts:47
Quote: describe('getPortalAnalytics (use case)', () => {
         it('composes portal KPI sums into PortalAnalyticsData', ...)
Rule:  Project convention — business failure path tested
Fix:   Add test for when portalMetrics or repo throws — verify error
       propagation and no partial/empty data returned.
```

### [GOAL] [MAJOR] `public-api.test.ts` — smoke test only, no behavioral coverage

```
File:  src/contexts/goal/application/public-api.test.ts:11
Quote: describe('GoalPublicApi', () => {
         it('exports goalCompleted factory', () => {
           expect(typeof goalCompleted).toBe('function')
         })
Rule:  Project convention — tests should verify behavior, not module structure
Fix:   The event factory tests are valuable but incomplete —
       add tests verifying deriveEntityScope returns correct scope
       for property/portal/group combinations, not just that it's a function.
```

### [INBOX] [MAJOR] `create-inbox-item` — missing forbidden/permission path

```
File:  src/contexts/inbox/application/use-cases/create-inbox-item.test.ts:42
Quote: describe('createInboxItem', () => {
         it('creates an inbox item and persists it', ...)
         it('emits inbox.item.created event', ...)
         it('throws already_exists for duplicate source', ...)
         it('increments new counter on creation', ...)
Rule:  Project convention — forbidden path tested
Fix:   Verify: the use case doesn't take AuthContext (system-level),
       so no forbidden path is needed. If this changes, add auth test.
       Consider adding a test for concurrent creation race condition.
```

### [NOTIFICATION] [MAJOR] `insert-notification` — `validInput` module-level constant shared across tests

```
File:  src/contexts/notification/application/use-cases/insert-notification.test.ts:74
Quote: const validInput: InsertNotificationInput = {
         userId: USER_ID,
         organizationId: ORG_ID,
         ...
Rule:  No shared fixture mutation — read-only constants are safe
Fix:   While `validInput` is read-only and safe, `beforeEach` correctly
       creates fresh `deps` per test. No action needed — noting for
       completeness that this pattern is correct.
```

### [REVIEW] [MAJOR] `reply-operations` — `makeDeps()` defaults include a live `makeDeps()` call in overrides

```
File:  src/contexts/review/application/use-cases/reply-operations.test.ts:138
Quote: const deps = makeDeps({
          replyRepo: {
            ...makeDeps().replyRepo,   // <-- nested call
            findInternalByReviewId: vi.fn(async () => existing),
          } as unknown as ReplyRepository,
       })
Rule:  No shared fixture mutation — fresh factories per test
Fix:   While each test calls `makeDeps()` fresh, the nested
       `makeDeps()` call in overrides creates redundant instances.
       Extract base repo mock separately to avoid confusion.
       Low risk — no mutation bug possible.
```

### [GUEST] [MAJOR] `submit-rating` — inline fake repo, no shared `in-memory` helper

```
File:  src/contexts/guest/application/use-cases/submit-rating.test.ts:8
Quote: function createInMemoryGuestRepo() {
         const ratings: Rating[] = []
         const repo: GuestInteractionRepository = { ... }
         return { ...repo, ratings }
       }
Rule:  Project convention — use shared testing helpers from #/shared/testing/
Fix:   Guest context defines its own in-memory repo inline instead of
       using the shared pattern in `src/shared/testing/`. If the repo
       interface grows, this inline fake will drift from the real one.
       Extract to `shared/testing/in-memory-guest-interaction-repo.ts`.
```

---

## Minor Findings

### [PORTAL] [MINOR] 4 untested use cases — all are group-membership mutations

```
File:  src/contexts/portal/application/use-cases/
       soft-delete-portal-group.ts, get-portal-group.ts,
       add-portal-to-group.ts, remove-portal-from-group.ts
Quote: // All follow "authorize → find → mutate → emit" pattern
Rule:  Project convention — every use case has a test
Fix:   These 4 use cases are structurally identical to tested counterparts
       (create-portal-group.test.ts, update-portal-group.test.ts).
       Create tests following the same pattern.
```

### [PORTAL] [MINOR] 23 use-case modules — largest context, 4 untested

```
File:  src/contexts/portal/application/use-cases/
Rule:  Maintainability — large surface area needs proportional test coverage
Fix:   Portal has the most use cases of any context (23).
       The 4 untested ones are all group-related.
       Consider a test helper for the common portal-group-test setup.
```

### [GOAL] [MINOR] `create-goal` uses `beforeEach` + module-level `BASE_INPUT`

```
File:  src/contexts/goal/application/use-cases/create-goal.test.ts:153
Quote: const BASE_INPUT = { ... }
Rule:  No shared fixture mutation — read-only template objects are safe
Fix:   BASE_INPUT is read-only and each test spreads it with overrides.
       Pattern is safe but should be documented with a comment
       to prevent future mutation.
```

### [REVIEW] [MINOR] `reply-operations` — no test for concurrent draft conflict

```
File:  src/contexts/review/application/use-cases/reply-operations.test.ts
Rule:  Business failure path tested — concurrent edits are a real scenario
Fix:   Consider adding a test for two users drafting on the same review
       simultaneously, verifying upsert semantics are correct.
```

---

## Nit Findings

### [DASHBOARD] [NIT] Tests use `new Date()` instead of fixed time constant

```
File:  src/contexts/dashboard/application/use-cases/get-dashboard-data.test.ts:16
Quote: const now = new Date()
Rule:  Time/random stubbed — dashboard use cases don't generate timestamps
Fix:   Acceptable — use case doesn't use a clock; dates are passed through.
       But for consistency with other contexts, prefer `FIXED_TIME`.
```

### [METRIC] [NIT] Test name describes implementation, not behavior

```
File:  src/contexts/metric/application/use-cases/record-metric.test.ts:50
Quote: it('accepts nullable groupId and passes it through', ...)
Rule:  Test names describe behavior, not implementation
Fix:   Rename to "records metric with optional portal group scope"
```

### [REVIEW] [NIT] Module-level context objects are safe but could use `as const satisfies`

```
File:  src/contexts/review/application/use-cases/reply-operations.test.ts:106
Quote: const MANAGER_CTX = {
          role: 'PropertyManager' as const,
          userId: USER_ID,
          organizationId: ORG_ID,
        }
Rule:  Style — consistent type narrowing
Fix:   Consider typing with `satisfies AuthContext` for compile-time safety.
```

---

## Most Critical Untested Paths (Priority Order)

1. **`activity/insert-activity-log`** — Only use case with zero coverage. Contains idempotency gate, user lookup fallback, and domain construction — all unverified.
2. **`portal/add-portal-to-group`** — Authorization gate + duplicate group check + event emission. Mutation of group membership is security-sensitive.
3. **`portal/remove-portal-from-group`** — Authorization gate + membership validation. Symmetric with add, same risk profile.
4. **`portal/soft-delete-portal-group`** — Delete operation with authorization. Irreversible action without test verification.
5. **`portal/get-portal-group`** — Read path with auth gate. Lowest risk of the five, but still an untested permission boundary.
6. **`metric/record-metric`** — Only 2 tests for the single source of truth on metric recording. Error paths completely uncovered.
7. **`dashboard/get-staff-dashboard-data`** — Role-based data scoping without a tenant isolation test.
8. **`dashboard/get-dashboard-data`** — No error propagation test.
9. **`dashboard/get-portal-analytics`** — No error propagation test.
10. **`goal/public-api`** — Smoke tests only; `deriveEntityScope` behavioral correctness untested.

## Positive Patterns Observed

- **Consistent `setup()` factory pattern** — Fresh in-memory deps per test, no cross-test leakage.
- **Fixed time via `FIXED_TIME` / `NOW`** — Deterministic timestamps across nearly all contexts.
- **Fixed IDs via `FIXED_ID`** — Deterministic identity generation, no flaky UUID assertions.
- **Capturing event bus** — Shared `createCapturingEventBus()` helper used consistently for event assertions.
- **Behavioral test names** — Vast majority describe user-facing behavior ("rejects users who cannot create teams", "emits team.created event on success").
- **Three-path coverage** — Most tested use cases cover happy path, forbidden path, and at least one business failure.
- **In-memory fakes over mocks** — Project consistently uses in-memory repo implementations rather than mock-heavy setups.
