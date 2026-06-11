# Phase 4: Error Handling + Use Case Standards

**Findings covered:** #9-#11, #46-#61, #90-#97, #146-#157, #186-#195
**Estimated effort:** 5-6 developer-days
**Parallelism:** All streams independent. Within each stream, fixes per context are independent.

---

## Stream A: Replace throw new Error with Tagged Errors in Repositories [L]

**Findings:** #9, #10, #53, #54, #56, #146, #149, #151, #155, #156

**Pattern:** Infrastructure repositories use `throw new Error('...')` for invariant failures. These should use the context's domain error factory (`xxxError({ code, message })`) so server functions can catch and map to HTTP status.

### A1. Goal repository — 10+ sites [M]

**Finding:** #53
**File:** `src/contexts/goal/infrastructure/repositories/goal.repository.ts`

Replace all `throw new Error(...)` with `goalError({ code: 'GOAL_REPO_ERROR', message: '...' })`:

- Line 35: `'Goal insert failed'`
- Line 126: `'Goal progress insert failed'`
- Line 295, 317, 341: `'no progress row for goal'`
- Line 350, 466: `'unsupported aggregation'`
- Line 364: `'goal not found or tenant mismatch'`
- Line 391, 423, 457: `'upsertProgress failed'`

### A2. Metric repository — 3 sites [S]

**Finding:** #54
**File:** `src/contexts/metric/infrastructure/repositories/metric.repository.ts`

Replace:

- Line 35: `Invalid metric_key` → `metricError({ code: 'INVALID_METRIC_KEY', message: ... })`
- Line 48: `Invalid metric reading` → same pattern
- Line 70: `Metric reading insert failed` → same

### A3. Inbox repositories — 5 sites [M]

**Findings:** #9, #10
**Files:**

- `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts` (lines 219, 244, 294)
- `src/contexts/inbox/infrastructure/repositories/inbox-note.repository.ts` (lines 32, 39)

Replace with `inboxError({ code: 'REPO_INSERT_FAILED', message: '...' })`.

### A4. Review repository + mapper — 3 sites [S]

**Finding:** (in review-infra-server.md)
**Files:**

- `src/contexts/review/infrastructure/repositories/review.repository.ts:93`
- `src/contexts/review/infrastructure/repositories/reply.repository.ts:99`
- `src/contexts/review/infrastructure/mappers/review.mapper.ts:23,26`

Replace with `reviewError({ code: 'REPO_UPSERT_FAILED', message: '...' })` / `reviewError({ code: 'INVALID_PLATFORM', message: '...' })`.

### A5. Portal repository + job — 3 sites [S]

**Findings:** #50, #51
**Files:**

- `src/contexts/portal/infrastructure/jobs/process-image.job.ts:45`
- `src/contexts/portal/infrastructure/repositories/portal.repository.ts:223`

Replace with `portalError({ code: 'IMAGE_PROCESSING_FAILED', message: '...' })` and `portalError({ code: 'PORTAL_NOT_FOUND', message: '...' })`.

### A6. Integration mapper — 1 site [S]

**Finding:** #56
**File:** `src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.ts:26`

Replace with `integrationError({ code: 'INVALID_CACHE_ENTRY', message: ... })`.

### A7. Notification — 3 sites [S]

**Finding:** #4 (BLOCKER)
**Files:** `notification.repository.ts:49`, `notification-email.repository.ts:65`, `notification-preference.repository.ts:79`

Replace `returning()[0]!` (non-null assertion) with guarded access:

```typescript
const rows = result.returning()
if (!rows.length) throw notificationError({ code: 'INSERT_FAILED', message: '...' })
return rows[0]
```

---

## Stream B: Use Cases — throw vs Result [XL]

**Findings:** #46-#48, #84, #127, #156, #188, #147, #150

**Pattern:** Multiple contexts' use cases throw domain errors instead of returning `Result<T, DomainError>`. The project convention (per standards.md) is Result. However, this is a large-scale refactor that affects callers in server/ and tests.

**Decision needed:** Before starting, confirm whether to:

- (a) Convert ALL throwing use cases to Result — large refactor, high touch
- (b) Accept throw as the convention and update docs — minimal change

**If (a), fix these contexts:**

| Context      | Finding | Files                                                |
| ------------ | ------- | ---------------------------------------------------- |
| team         | #46     | All 5 use cases in `application/use-cases/`          |
| staff        | #47     | All 5 use cases                                      |
| review       | #48     | `reply-operations.ts`                                |
| guest        | #84     | `submit-rating.ts`, `record-scan.ts`                 |
| metric       | #127    | `record-metric.ts`                                   |
| notification | #156    | `insert-notification.ts`                             |
| goal         | #188    | `create-goal.ts`, `update-goal.ts`, `delete-goal.ts` |

For each: change return type from `T` to `Result<T, XxxError>`, replace `throw xxxError(...)` with `err(xxxError(...))`, update callers.

---

## Stream C: Silent Error Swallowing [M]

**Findings:** #11, #49, #55, #58, #59, #60, #70, #71, #152, #154, #157, #164

### C1. Dashboard portal-analytics swallowed error [S]

**Finding:** #11
**File:** `src/contexts/dashboard/server/portal-analytics.ts:79`

**Fix:** `catchUntagged(e)` returns the error but result is not thrown. Add `throw result` or restructure to propagate.

### C2. Review reply bare catch [S]

**Finding:** #49
**File:** `src/contexts/review/application/use-cases/reply-operations.ts:422-424`

**Fix:** Add logging inside the catch block. Don't silently swallow event emission failure:

```typescript
} catch (e) {
  logger.child({ replyId }).error('Failed to emit reply publish failed event', e)
}
```

### C3. Metric event handlers silent swallow [S]

**Finding:** #55
**File:** `src/contexts/metric/infrastructure/event-handlers/on-review-created.ts` (and 4 others)

**Fix:** Add `logger.child(...).error('...', e)` to each catch block instead of empty catch.

### C4. Activity adapters silent errors [S]

**Findings:** #58, #59, #70, #164
**Files:** `insert-activity-log.ts:67-69,85-91`, `db-user-lookup.adapter.ts:46`, `db-inbox-item-lookup.adapter.ts:21`

**Fix:** Add logging to all catch blocks. For `db-user-lookup`, log the error and still return FALLBACK_USER but with `logger.warn(...)`.

### C5. Redis counter adapter silent catches [S]

**Finding:** #60
**File:** `src/contexts/inbox/infrastructure/adapters/redis-new-counter.ts`

**Fix:** Add `logger.warn(...)` to all 6 bare catch blocks. Redis failures should be visible in telemetry.

### C6. Identity headersFromRequest catch [S]

**Finding:** #152
**File:** `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:41-43`

**Fix:** Log the caught error instead of silently returning `null`.

### C7. Inbox repo create no tenant guard [S]

**Findings:** #154, #155
**Files:** `inbox.repository.ts:213-223`, `inbox-note.repository.ts:30-33`

**Fix:** Replace `throw new Error(...)` tenant guard with `inboxError({ code: 'TENANT_MISMATCH', ... })`.

### C8. Portal-groups.ts throw e pattern [S]

**Finding:** #52
**File:** `src/contexts/portal/server/portal-groups.ts`

**Fix:** Replace 7 instances of `catch (e) { throw e }` with `catchUntagged(e)` pattern used elsewhere.

---

## Stream D: Use Case Logic Fixes [M]

**Findings:** #90-#97, #128-#129, #186-#190, #192-#193

### D1. Staff use case fixes [M]

**Finding:** #91 — Self-assignment bypass
**File:** `src/contexts/staff/application/use-cases/create-staff-assignment.ts:44-50`
**Fix:** Move self-assignment decision to domain rules layer, not application layer.

**Finding:** #90 — Remove skips steps
**File:** `src/contexts/staff/application/use-cases/remove-staff-assignment.ts:41-44`
**Fix:** Add load entity + check rules steps before removal.

**Finding:** #92 — Duplicate type
**File:** `src/contexts/staff/application/use-cases/` and `staff-assignment.dto.ts`
**Fix:** Remove `ListStaffAssignmentsInput` from use case, import from DTO.

### D2. Goal use case fixes [M]

**Finding:** #93 — Unsafe branded ID casts
**File:** `src/contexts/goal/application/use-cases/create-goal.ts:93,137,210`
**Fix:** Use proper `goalId()` / `goalProgressId()` constructors instead of `as` casts.

**Finding:** #94 — Mutation outside constructor
**File:** `src/contexts/goal/application/use-cases/update-goal.ts:69-94`
**Fix:** Move mutation into domain entity method or constructor.

**Finding:** #95 — Dead split server files
**Files:** `src/contexts/goal/server/create-goal.ts`, `update-goal.ts`, `cancel-goal.ts`, `goal-queries.ts`, `goal-shared.ts`
**Fix:** Delete these dead files (they duplicate `goals.ts`).

### D3. Inbox missing auth gate [S]

**Finding:** #96
**File:** `src/contexts/inbox/application/use-cases/get-inbox-notes.ts:30`
**Fix:** Add `if (!can(ctx.role, 'inbox.read')) throw inboxError({ code: 'FORBIDDEN' })`.

### D4. Metric use case fixes [S]

**Finding:** #128 — No authorization
**Finding:** #129 — No reading ID generation
**File:** `src/contexts/metric/application/use-cases/record-metric.ts`
**Fix:** Add `can(ctx.role, 'metric.record')` check. Use `deps.idGen()` for reading ID.

### D5. Minor use case fixes [S]

**Finding:** #186 — `UpdateTeamInput` raw string teamId
**Fix:** Use branded `TeamId` type.

**Finding:** #187 — `listTeams` returns empty instead of forbidden
**Fix:** Return `err(teamError({ code: 'FORBIDDEN' }))` when permission denied.

**Finding:** #192 — Goal createGoal re-validates
**Fix:** Remove redundant validation from server function — use case handles it.

**Finding:** #193 — staff-goals positional arguments
**Fix:** Pass as named object instead of positional args.

---

## Stream E: Server Function Fixes [M]

**Findings:** #57, #61, #74, #75, #147, #148, #150

### E1. Dashboard import from domain/errors [S]

**Finding:** #57
**Files:** `src/contexts/dashboard/server/dashboard.ts`, `portal-analytics.ts`
**Fix:** Import error types from `public-api` instead of `domain/errors`.

### E2. Notification server uses wrong permission [S]

**Finding:** #61
**File:** `src/contexts/notification/server/notifications.ts`
**Fix:** Replace `can(ctx.role, 'inbox.read')` with `can(ctx.role, 'notification.read')`.

### E3. Portal duplicate server exports [S]

**Findings:** #74, #75
**Files:** `src/contexts/portal/server/portals.ts`
**Fix:** Remove duplicate exports. Keep single canonical export per server function in the appropriate split file (`portal-uploads.ts`, `portal-read.ts`).

### E4. Portal upload fabricated errors [S]

**Finding:** #147
**File:** `src/contexts/portal/server/portals.ts:213-217`
**Fix:** Replace inline `Object.assign(new Error(...))` with `portalError({ code: '...', message: '...' })`.

### E5. Property build.ts PG error detection [S]

**Finding:** #148
**File:** `src/contexts/property/build.ts:134-137`
**Fix:** Add type guard for `DatabaseError` instead of checking `(e as any).code`.

### E6. Goal goals.ts re-throws untagged [S]

**Finding:** #150
**File:** `src/contexts/goal/server/goals.ts:126-128`
**Fix:** Use `catchUntagged(e)` pattern.

---

## Verification

```bash
# Type safety
pnpm typecheck

# Lint
pnpm lint

# Verify no throw new Error in infra (except shared/config/env.ts, shared/auth/auth-cli.ts)
grep -rn 'throw new Error(' src/contexts/*/infrastructure/

# Verify no bare catch blocks
grep -rn 'catch {' src/contexts/ || grep -rn '} catch (e) {' src/contexts/

# Tests
pnpm test
```
