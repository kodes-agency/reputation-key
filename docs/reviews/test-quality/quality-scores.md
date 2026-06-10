# Test Quality Scoring Report

**Date:** 2026-06-10
**Scope:** 22 test files sampled across all layers (domain, application, infrastructure, server, shared, E2E, smoke)
**Contexts covered:** review, inbox, notification, portal, team, staff, property, identity, guest, metric, goal, integration, shared

---

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 1      |
| MAJOR     | 9      |
| MINOR     | 7      |
| NIT       | 3      |
| **Total** | **20** |

---

## Scoring Criteria (1–5 per dimension)

| Dimension        | Description                                    |
| ---------------- | ---------------------------------------------- |
| **Behavior**     | Tests what (outcome), not how (implementation) |
| **Isolation**    | No shared mutable state between tests          |
| **Determinism**  | No time/random dependencies; fixed clocks/IDs  |
| **Completeness** | Happy + error + edge cases covered             |
| **Naming**       | Test name describes expected behavior          |

---

## Scored Files

### 1. `src/contexts/inbox/domain/rules.test.ts`

| Dimension    | Score                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Tests state machine transitions as black-box (canTransition returns boolean)                |
| Isolation    | 5 — Pure functions, no state                                                                    |
| Determinism  | 5 — No time/random deps                                                                         |
| Completeness | 5 — All valid transitions, same-status rejections, exhaustive invalid combos, error type guards |
| Naming       | 5 — `allows new → read`, `blocks published → any` — describes exactly what's expected           |
| **Average**  | **5.0**                                                                                         |

### 2. `src/contexts/review/domain/constructors.test.ts`

| Dimension    | Score                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Tests Result type outcomes, doesn't inspect internals                                           |
| Isolation    | 5 — No shared state                                                                                 |
| Determinism  | 5 — Fixed dates via `NOW` constant                                                                  |
| Completeness | 5 — Happy path, invalid rating, expiry calc, sentiment preservation, exhaustive error code coverage |
| Naming       | 5 — `builds a valid review with all fields`, `returns Err for invalid rating`                       |
| **Average**  | **5.0**                                                                                             |

### 3. `src/contexts/review/domain/rules.test.ts`

| Dimension    | Score                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Pure function return values                                                                     |
| Isolation    | 5 — Pure functions                                                                                  |
| Determinism  | 5 — Fixed timestamps                                                                                |
| Completeness | 5 — Every valid reply transition, every blocked transition, boundary values for expiresAt           |
| Naming       | 5 — `allows draft → pending_approval`, `blocks draft → approved (must go through pending_approval)` |
| **Average**  | **5.0**                                                                                             |

### 4. `src/contexts/staff/application/use-cases/create-staff-assignment.test.ts`

| Dimension    | Score                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Tests use-case outcomes (assignment created, event emitted, errors thrown)                                 |
| Isolation    | 5 — `setup()` factory creates fresh deps per test; in-memory repos                                             |
| Determinism  | 5 — Fixed IDs, fixed time                                                                                      |
| Completeness | 5 — Direct assign, team assign, permission denied, duplicate, event emission, self-assign, non-unique re-throw |
| Naming       | 5 — `assigns a user to a property directly`, `rejects duplicate assignments`                                   |
| **Average**  | **5.0**                                                                                                        |

### 5. `src/contexts/notification/infrastructure/event-handlers/on-review-created.test.ts`

| Dimension    | Score                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Behavior     | 5 — Verifies job enqueuing side-effects, not handler internals                                               |
| Isolation    | 5 — `createFakeDeps()` factory, fresh in `beforeEach`                                                        |
| Determinism  | 5 — Fixed `NOW`, fixed IDs                                                                                   |
| Completeness | 5 — Multi-manager, single-manager, no-manager, warning log, rating in body, error propagation from both deps |
| Naming       | 5 — `enqueues a notification job for each assigned manager`, `propagates error from queue.add`               |
| **Average**  | **5.0**                                                                                                      |

### 6. `src/contexts/inbox/application/use-cases/create-inbox-item.test.ts`

| Dimension    | Score                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Tests persistence, event emission, error codes                                                          |
| Isolation    | 5 — `setup()` factory per test; in-memory repos                                                             |
| Determinism  | 5 — `FIXED_ID`, `FIXED_TIME`, deterministic `idGen`/`clock`                                                 |
| Completeness | 4 — Happy path, duplicate source, event emission, counter increment. Missing: invalid source type edge case |
| Naming       | 5 — `creates an inbox item and persists it`, `throws already_exists for duplicate source`                   |
| **Average**  | **4.8**                                                                                                     |

### 7. `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.test.ts`

| Dimension    | Score                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Tests progress reconciliation outcomes (status updates, event emission)                                          |
| Isolation    | 5 — `createFakeDeps()` factory with in-memory stores                                                                 |
| Determinism  | 5 — Fixed `NOW`, fixed IDs                                                                                           |
| Completeness | 5 — Active goals, completed goals, no-progress goals, multiple goals per org, boundary at target, status transitions |
| Naming       | 4.5 — Mostly good; some tests use slightly generic names like `updates progress for active goal`                     |
| **Average**  | **4.9**                                                                                                              |

### 8. `src/contexts/property/infrastructure/repositories/property.repository.test.ts`

| Dimension    | Score                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| Behavior     | 5 — Integration tests against real Postgres; tests actual query results                   |
| Isolation    | 4 — `beforeEach` truncates test data but shares DB pool; parallel-safe due to org-scoping |
| Determinism  | 5 — Fixed IDs for org scoping                                                             |
| Completeness | 5 — CRUD, tenant isolation (cross-org), slug uniqueness, pagination, filtering            |
| Naming       | 5 — `creates and retrieves a property`, `never returns properties from another org`       |
| **Average**  | **4.8**                                                                                   |

### 9. `src/shared/auth/permissions.test.ts`

| Dimension    | Score                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Tests permission table outcomes                                                         |
| Isolation    | 4 — `initPermissionTable()` may share global state; re-init tests exist but order-dependent |
| Determinism  | 5 — No time/random                                                                          |
| Completeness | 5 — All three roles, exhaustive permission lists, denied permissions, re-initialization     |
| Naming       | 5 — `has every permission defined in the statement`, `cannot manage members`                |
| **Average**  | **4.8**                                                                                     |

### 10. `src/contexts/goal/ui/helpers.test.ts`

| Dimension    | Score                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------ |
| Behavior     | 5 — Tests pure UI helper functions by return value                                         |
| Isolation    | 5 — `makeGoal()` factory, no shared state                                                  |
| Determinism  | 5 — Fixed dates                                                                            |
| Completeness | 5 — 10 helper functions tested with edge cases (division by zero, over-100%, empty arrays) |
| Naming       | 5 — `returns 0% for goal with zero target`, `sorts active before completed`                |
| **Average**  | **5.0**                                                                                    |

### 11. `src/contexts/integration/domain/rules.test.ts`

| Dimension    | Score                                              |
| ------------ | -------------------------------------------------- |
| Behavior     | 5 — Pure function boolean returns                  |
| Isolation    | 5 — Pure                                           |
| Determinism  | 5 — No deps                                        |
| Completeness | 5 — 13 email cases, multiple visibility cases      |
| Naming       | 5 — `rejects missing @`, `accepts plus addressing` |
| **Average**  | **5.0**                                            |

### 12. `src/contexts/portal/domain/constructors.test.ts`

| Dimension    | Score                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Behavior     | 5 — Result type outcomes                                                         |
| Isolation    | 5 — No state                                                                     |
| Determinism  | 5 — Fixed `now`                                                                  |
| Completeness | 5 — Defaults, auto-slug, custom slug, invalid name/theme, custom theme, entityId |
| Naming       | 5 — `auto-generates slug from name`, `rejects invalid theme`                     |
| **Average**  | **5.0**                                                                          |

### 13. `src/contexts/inbox/infrastructure/mappers/inbox.mapper.test.ts`

| Dimension    | Score                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Behavior     | 4 — Tests mapper output fields, which is structurally tied to implementation     |
| Isolation    | 5 — Constants defined at module level, no mutation                               |
| Determinism  | 5 — Fixed dates                                                                  |
| Completeness | 5 — Branding, all fields, null assignedTo, null optional fields, reverse mapping |
| Naming       | 4.5 — `brands IDs correctly` is slightly vague                                   |
| **Average**  | **4.7**                                                                          |

### 14. `src/shared/auth/middleware.test.ts`

| Dimension    | Score                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Tests middleware return values and thrown errors                                            |
| Isolation    | 5 — `beforeEach` resets mocks and cache                                                         |
| Determinism  | 5 — `vi.useFakeTimers()` for time-dependent tests, real timers restored in `afterEach`          |
| Completeness | 5 — Auth present/missing, tenant resolution, org membership, cache hit/miss/expiry, error cases |
| Naming       | 5 — `returns null when no session cookie`, `resolves org from active membership`                |
| **Average**  | **5.0**                                                                                         |

### 15. `src/contexts/identity/application/use-cases/register-user.test.ts`

| Dimension    | Score                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Tests user ID return and error codes                                                                               |
| Isolation    | 5 — `setup()` factory per test                                                                                         |
| Determinism  | 5 — `FIXED_USER_ID`                                                                                                    |
| Completeness | 4 — Happy path, signUp failure, non-Error rejection. Missing: input validation edge cases (empty name, short password) |
| Naming       | 5 — `throws registration_failed when sign-up fails`                                                                    |
| **Average**  | **4.8**                                                                                                                |

### 16. `src/contexts/guest/application/use-cases/submit-feedback.test.ts`

| Dimension    | Score                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Behavior     | 5 — Tests return value, repo side-effect, event emission                                                                       |
| Isolation    | 4 — `createInMemoryGuestRepo()` creates fresh instance per test but `feedback` array is mutable internal state                 |
| Determinism  | 5 — Fixed IDs                                                                                                                  |
| Completeness | 4 — Happy path, empty feedback rejected, optional rating. Missing: very long comment, special characters, duplicate submission |
| Naming       | 4.5 — `submits feedback and emits event` is good; `accepts optional ratingId` is slightly vague                                |
| **Average**  | **4.5**                                                                                                                        |

### 17. `src/shared/cache/redis-cache.test.ts`

| Dimension    | Score                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| Behavior     | 5 — Tests cache API semantics (get/set/delete/exists)                                            |
| Isolation    | 5 — `createMockRedis()` fresh in `beforeEach`                                                    |
| Determinism  | 5 — Mock Redis with Map, no time deps                                                            |
| Completeness | 5 — Missing key, existing key, Redis error returns null, TTL expiration, delete existing/missing |
| Naming       | 5 — `returns null for missing key`, `returns null when Redis throws`                             |
| **Average**  | **5.0**                                                                                          |

### 18. `src/shared/rate-limit/middleware.test.ts`

| Dimension    | Score                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------- |
| Behavior     | 5 — Tests rate limit outcomes (allowed/blocked/remaining/reset)                                     |
| Isolation    | 5 — `createMockRedis()` fresh per test                                                              |
| Determinism  | 5 — Mock time via Map-based store                                                                   |
| Completeness | 4.5 — Redis available, unavailable, error. Missing: concurrent increment edge case, window rollover |
| Naming       | 5 — `allows requests within the limit`, `blocks requests over the limit`                            |
| **Average**  | **4.9**                                                                                             |

### 19. `src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts`

| Dimension    | Score                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| Behavior     | 3 — Primarily tests structural typing (compile-time checks) and in-memory repo, not real DB behavior          |
| Isolation    | 5 — Fresh mocks per test                                                                                      |
| Determinism  | 5 — No time deps                                                                                              |
| Completeness | 3 — Only structural type satisfaction + in-memory detail lookups. No error paths, no pagination, no filtering |
| Naming       | 4 — `returns an object satisfying InboxRepository` describes what, but test is thin                           |
| **Average**  | **4.0**                                                                                                       |

### 20. `src/contexts/goal/application/public-api.test.ts`

| Dimension    | Score                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| Behavior     | 2 — Only tests `typeof === 'function'` and `_tag` values; does not test actual business behavior |
| Isolation    | 5 — No state                                                                                     |
| Determinism  | 5 — Uses `crypto.randomUUID()` but deterministic for assertion                                   |
| Completeness | 2 — Only smoke-level checks; no error paths, no edge cases                                       |
| Naming       | 4 — `exports goalCompleted factory` — descriptive of what's tested but tests are trivial         |
| **Average**  | **3.6**                                                                                          |

### 21. `src/smoke.test.ts`

| Dimension    | Score                                                             |
| ------------ | ----------------------------------------------------------------- |
| Behavior     | 2 — Tests module importability and env schema, not behavior       |
| Isolation    | 5 — No state                                                      |
| Determinism  | 5 — Fixed env config                                              |
| Completeness | 2 — Two trivial assertions                                        |
| Naming       | 4 — `can import shared config module` — acceptable for smoke test |
| **Average**  | **3.6**                                                           |

### 22. `e2e/auth.spec.ts`

| Dimension    | Score                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Behavior     | 4 — Tests actual auth flows end-to-end                                                                |
| Isolation    | 3 — Uses `Date.now()` for unique email (non-deterministic); shares app state                          |
| Determinism  | 3 — `Date.now()` for unique email; no fixed time control                                              |
| Completeness | 3 — Register + sign-in happy paths only. Missing: invalid credentials, password reset, session expiry |
| Naming       | 4 — `register a new account and sign in` — descriptive                                                |
| **Average**  | **3.4**                                                                                               |

---

## Detailed Findings

### BLOCKER (1)

````
[DETERMINISM] BLOCKER E2E tests use Date.now() for uniqueness — flaky by design
  File: e2e/auth.spec.ts:8
  Quote: ```
  const uniqueEmail = `e2e-register-${Date.now()}@example.com`
````

Rule: Determinism — no time/random dependencies
Fix: Use a UUID or counter-based unique suffix instead of Date.now().
Same pattern in e2e/team-management.spec.ts:25,35.

```

### MAJOR (9)

```

[COMPLETENESS] MAJOR inbox.repository.test.ts tests structural typing, not behavior
File: src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts:110-156
Quote: ```
it('returns an object satisfying InboxRepository', () => { ... })
it('factory return type satisfies InboxRepository (compile-time check)', () => { ... })

```
Rule:  Behavior assertion — tests what, not how
Fix:   Add integration tests against real DB (like property.repository.test.ts) or
       test actual query logic with more thorough in-memory scenarios.
```

````
[COMPLETENESS] MAJOR public-api.test.ts is a smoke test masquerading as a unit test
  File: src/contexts/goal/application/public-api.test.ts:11-23
  Quote: ```
  it('exports goalCompleted factory', () => {
    expect(typeof goalCompleted).toBe('function')
  })
````

Rule: Completeness — happy + error + edge cases
Fix: Test actual event construction behavior (field mapping, validation, error cases)
not just that exports are functions.

```

```

[COMPLETENESS] MAJOR register-user.test.ts missing input validation edge cases
File: src/contexts/identity/application/use-cases/register-user.test.ts:22-69
Quote: ```
const validInput = { name: 'Test User', email: 'test@example.com', password: 'password123' }

```
Rule:  Completeness — edge cases
Fix:   Add tests for empty name, empty email, short password, SQL injection strings,
       very long inputs. Verify the use case validates or the adapter handles them.
```

````
[COMPLETENESS] MAJOR submit-feedback.test.ts missing edge cases
  File: src/contexts/guest/application/use-cases/submit-feedback.test.ts:30-106
  Quote: ```
  it('submits feedback and emits event', async () => { ... })
  it('rejects empty feedback', async () => { ... })
  it('accepts optional ratingId', async () => { ... })
````

Rule: Completeness — edge cases
Fix: Add tests for: max-length comment, special characters/emoji, duplicate feedback
submission, repo insertion failure.

```

```

[COMPLETENESS] MAJOR E2E tests lack error path coverage
File: e2e/auth.spec.ts:6-31
Quote: ```
test('register a new account and sign in', async ({ page }) => { ... })
test('sign in with existing credentials', async ({ page }) => { ... })

```
Rule:  Completeness — error paths
Fix:   Add tests for: wrong password, already-registered email, expired session,
       invalid email format in registration form.
```

````
[COMPLETENESS] MAJOR smoke.test.ts provides no behavioral confidence
  File: src/smoke.test.ts:4-18
  Quote: ```
  it('can import shared config module', async () => {
    const mod = await import('#/shared/config/env')
    expect(mod).toBeDefined()
  })
````

Rule: Behavior assertion — tests what, not how
Fix: Acceptable as a CI smoke test, but should be explicitly marked as such
and not counted toward coverage metrics.

```

```

[COMPLETENESS] MAJOR metric domain events test is trivially thin
File: src/contexts/metric/domain/events.test.ts:11-38
Quote: ```
it('accepts nullable groupId', () => { ... })

```
Rule:  Completeness — edge cases
Fix:   Add tests for: all metric key types, missing required fields, invalid values,
       event _tag correctness for all event types.
```

````
[ISOLATION] MAJOR permissions.test.ts shares mutable global permission table
  File: src/shared/auth/permissions.test.ts:229-242
  Quote: ```
  describe('initPermissionTable', () => { ... })
  describe('re-initializing permission table restores defaults', () => { ... })
````

Rule: Isolation — no shared mutable state
Fix: Re-initialize before each test or use a fresh table instance.
The re-init test proves it works but other tests depend on global state.

```

```

[COMPLETENESS] MAJOR create-inbox-item.test.ts missing invalid source type edge case
File: src/contexts/inbox/application/use-cases/create-inbox-item.test.ts:42-121
Quote: ```
it('creates an inbox item and persists it', async () => { ... })
it('throws already_exists for duplicate source', async () => { ... })

```
Rule:  Completeness — edge cases
Fix:   Add test for unrecognized source type, and verify the use case handles
       concurrent creation of same source (race condition scenario).
```

### MINOR (7)

````
[NAMING] MINOR inbox.mapper.test.ts uses vague "brands IDs correctly"
  File: src/contexts/inbox/infrastructure/mappers/inbox.mapper.test.ts:36-42
  Quote: ```
  it('brands IDs correctly', () => { ... })
````

Rule: Naming — describes expected behavior
Fix: Rename to `maps row IDs to branded types` or `applies branded ID types to mapped fields`.

```

```

[BEHAVIOR] MINOR inbox.repository.test.ts in-memory repo tests test the test helper
File: src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts:51-108
Quote: ```
function createInMemoryInboxRepo(): InboxRepository {
const items: InboxItem[] = []
return { ... }
}

```
Rule:  Behavior assertion — tests what, not how
Fix:   The in-memory repo tests verify the test helper, not production code.
       Remove or clearly separate as "fake verification" tests.
```

````
[DETERMINISM] MINOR goal public-api test uses crypto.randomUUID()
  File: src/contexts/goal/application/public-api.test.ts:26
  Quote: ```
  eventId: crypto.randomUUID(),
````

Rule: Determinism — no random dependencies
Fix: Use a fixed string for eventId: `eventId: 'test-event-1'`.

```

```

[NAMING] MINOR goal public-api test names describe trivial exports
File: src/contexts/goal/application/public-api.test.ts:12-22
Quote: ```
it('exports goalCompleted factory', () => { ... })
it('exports goalProgressUpdated factory', () => { ... })

```
Rule:  Naming — describes expected behavior
Fix:   Rename to describe what the factory produces, e.g.
       `goalCompleted creates an event tagged goal.completed`.
```

````
[COMPLETENESS] MINOR portal server test exhaustive but missing rate-limit integration
  File: src/contexts/portal/server/portals.test.ts:19-103
  Quote: ```
  it('all error codes are covered (exhaustive check)', () => { ... })
````

Rule: Completeness — edge cases
Fix: Error code mapping is excellent. Consider adding a test for
unrecognized/unknown error code fallback behavior.

```

```

[COMPLETENESS] MINOR digest-notification.job.test.ts uses `any` type casts
File: src/contexts/notification/infrastructure/jobs/digest-notification.job.test.ts:1
Quote: ```
/_ eslint-disable @typescript-eslint/no-explicit-any _/

```
Rule:  Type safety in tests
Fix:   Type the fake deps more precisely. The `Record<string, any>` return type
       from `createFakeDeps()` loses all type safety.
```

````
[COMPLETENESS] MINOR rate-limit test missing concurrent request edge case
  File: src/shared/rate-limit/middleware.test.ts:43-97
  Quote: ```
  describe('with Redis available', () => { ... })
````

Rule: Completeness — edge cases
Fix: Add test for: window rollover (request at second 59 then second 0),
concurrent requests within same tick, very high maxRequests.

```

### NIT (3)

```

[STYLE] NIT E2E team-management.spec.ts uses mixed quote styles
File: e2e/team-management.spec.ts:1-67
Quote: ```
import { test, expect } from "@playwright/test";

```
Rule:  Code style consistency
Fix:   Use single quotes consistently to match the rest of the codebase.
       The project uses Prettier with single quotes.
```

````
[NAMING] NIT assert.test.ts is minimal but acceptable for shared utility
  File: src/shared/domain/assert.test.ts:4-11
  Quote: ```
  it('throws UnreachableError', () => { ... })
````

Rule: Naming — describes expected behavior
Fix: Acceptable as-is for a 2-line utility. Could add test for error message format.

```

```

[STYLE] NIT E2E team-management.spec.ts dialog handling inline
File: e2e/team-management.spec.ts:57
Quote: ```
page.on("dialog", (dialog) => dialog.accept());

```
Rule:  Style — test readability
Fix:   Extract dialog handling to a helper or use `page.waitForEvent('dialog')`
       pattern for more explicit control.
```

---

## Common Anti-Patterns

### 1. Structural/Type-Only Tests (5 files affected)

Files like `inbox.repository.test.ts` and `public-api.test.ts` test that types compile and functions exist, not that they behave correctly. These inflate coverage numbers without providing real confidence.

**Files:** `inbox.repository.test.ts`, `public-api.test.ts`, `smoke.test.ts`, `metric/domain/events.test.ts`, `assert.test.ts`

### 2. Incomplete Edge Case Coverage (6 files affected)

Several use-case tests cover happy path + one error path but miss boundary conditions, concurrent scenarios, or input validation edges.

**Files:** `register-user.test.ts`, `submit-feedback.test.ts`, `create-inbox-item.test.ts`, `auth.spec.ts`, `metric/domain/events.test.ts`, `rate-limit/middleware.test.ts`

### 3. E2E Test Non-Determinism (3 files affected)

All E2E specs use `Date.now()` for unique identifiers. While functional, this makes tests order-sensitive and harder to reproduce.

**Files:** `e2e/auth.spec.ts`, `e2e/team-management.spec.ts` (and likely other E2E specs)

### 4. `any` Type Escapes in Test Helpers (1 file)

`digest-notification.job.test.ts` uses `Record<string, any>` for fake deps, losing type safety.

**Files:** `digest-notification.job.test.ts`

---

## Top 3 Best Test Files

### 1. `src/contexts/inbox/domain/rules.test.ts` — Score: 5.0

Exemplary state machine testing: every valid transition, every invalid transition, same-status rejections, error type guards, and validation function coverage. Pure functions, zero mocks, exhaustive without being brittle.

### 2. `src/contexts/staff/application/use-cases/create-staff-assignment.test.ts` — Score: 5.0

Clean `setup()` factory pattern, in-memory repos, fixed time/IDs, 7 test cases covering happy path, permissions, duplicates, events, self-assign, and error re-throwing. Every test is isolated and deterministic.

### 3. `src/contexts/review/domain/constructors.test.ts` — Score: 5.0

Demonstrates exhaustive error code coverage with compile-time safety. Tests all constructor paths, validates Result types, and includes a clever `ALL_REVIEW_ERROR_CODES` array that breaks at compile time when the union changes.

---

## Bottom 3 Test Files

### 1. `e2e/auth.spec.ts` — Score: 3.4

Only 2 test cases covering happy paths. Uses `Date.now()` for uniqueness (non-deterministic). Missing: invalid credentials, duplicate registration, session expiry, error scenarios. For a critical auth flow, this is dangerously thin.

### 2. `src/smoke.test.ts` — Score: 3.6

Two trivial assertions (`module is defined`, `env.NODE_ENV === 'test'`). Provides zero behavioral confidence. Should be explicitly excluded from coverage metrics.

### 3. `src/contexts/goal/application/public-api.test.ts` — Score: 3.6

Tests `typeof === 'function'` for exports. The only behavioral assertion checks `_tag` strings. No error paths, no validation, no edge cases. A smoke test wearing unit test clothing.

---

## Positive Patterns to Emulate

1. **`setup()` factory pattern** — Used consistently in use-case tests (`create-staff-assignment`, `create-inbox-item`, `register-user`). Creates fresh, isolated deps per test. No `beforeEach` mutation.

2. **Fixed time/ID injection** — Use cases accept `clock` and `idGen` deps, allowing tests to inject fixed values. Eliminates time-based flakiness entirely.

3. **Exhaustive error code coverage** — `review/domain/constructors.test.ts` maintains a compile-time-checked array of all error codes, ensuring new codes trigger test failures.

4. **Capturing event bus** — `createCapturingEventBus()` is a shared test helper that captures emitted events for assertion. Clean, reusable, no mock framework needed.

5. **In-memory repository test doubles** — 18 shared in-memory repos in `src/shared/testing/` provide consistent, type-safe fakes across all contexts.
