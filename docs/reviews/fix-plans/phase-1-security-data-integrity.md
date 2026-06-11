# Phase 1: Security & Data Integrity Fix Plan

**Phase:** 1 of N
**Priority:** P0 — must ship before any other phase
**Scope:** BLOCKER findings (#1-#7, #9-#11, #22-#25) + security MAJORs (#117-#120)
**Total findings:** 18
**Estimated effort:** 3-4 developer-days

---

## Work Streams

Four parallel work streams with no shared files. Each stream can be executed independently.

| Stream | Focus                       | Findings                             | Files                                                           | Complexity |
| ------ | --------------------------- | ------------------------------------ | --------------------------------------------------------------- | ---------- |
| A      | Multi-tenancy (D7)          | #1, #2, #3                           | goal + notification repos                                       | M          |
| B      | Authorization gates (D3/D8) | #5, #6, #7                           | inbox use cases + integration server                            | M          |
| C      | Error handling (D15/D4)     | #4, #9, #10, #11, #22, #23, #24, #25 | inbox/notification/dashboard repos, property build, composition | L          |
| D      | Security (SEC)              | #117, #118, #119, #120               | identity use cases, auth config                                 | L          |

---

## Stream A: Multi-Tenancy — Goal & Notification Repos

### Fix A1: Add orgId to `findAllActive()` and fix spawn-recurring job

**Findings:** #1, #2
**Files:**

- `src/contexts/goal/application/ports/goal.repository.ts` — port signature
- `src/contexts/goal/infrastructure/repositories/goal.repository.ts` — implementation
- `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts` — caller

**Changes:**

1. In the port, add `organizationId: OrganizationId` parameter to `findAllActive`:
   ```ts
   findAllActive: (organizationId: OrganizationId) => Promise<readonly Goal[]>
   ```
2. In the repository, add `eq(goals.organizationId, organizationId)` to the WHERE clause at line 182.
3. In `spawn-recurring-instances.job.ts`, change from `findAllActive()` to `findActiveRecurringTemplates(organizationId)` which already exists on the port and is org-scoped. Iterate per-organization, or accept orgId on the job and call the scoped method.

**Complexity:** S (3 files, same pattern)
**Verification:**

- `vitest run src/contexts/goal/infrastructure/repositories/goal.repository.test.ts`
- `vitest run src/contexts/goal/infrastructure/jobs/`
- Typecheck: `tsc --noEmit`
- Confirm no call site still calls `findAllActive()` without orgId

---

### Fix A2: Add orgId to notification email queue mutations

**Findings:** #3
**Files:**

- `src/contexts/notification/application/ports/notification-email.repository.ts` — port signatures
- `src/contexts/notification/infrastructure/repositories/notification-email.repository.ts` — implementation
- `src/contexts/notification/infrastructure/jobs/urgent-email.job.ts` — caller (thread orgId through)
- Any other callers of `markSent`, `markFailed`, `markSkipped`

**Changes:**

1. In the port, add `orgId: OrganizationId` parameter to `markSent`, `markFailed`, `markSkipped` signatures.
2. In the repository, add `eq(notificationEmailQueue.organizationId, orgId)` to WHERE for each method (lines 112-151).
3. In `urgent-email.job.ts`, the job data already contains orgId — thread it into these method calls.
4. Search all callers and update imports/signatures.

**Complexity:** S (3-4 files, mechanical parameter threading)
**Verification:**

- `vitest run src/contexts/notification/`
- `grep -r 'markSent\|markFailed\|markSkipped' src/` — confirm no caller passes without orgId
- Typecheck: `tsc --noEmit`

---

## Stream B: Authorization Gates

### Fix B1: Add permission checks to integration server functions

**Findings:** #5
**Files:**

- `src/contexts/integration/server/google-connections.ts` — lines 93-131

**Changes:**

1. In `disconnectGoogle` handler (~line 93), add before the try block:
   ```ts
   if (!can(ctx.role, 'integration.manage')) {
     throwContextError(
       'AuthError',
       { code: 'forbidden', message: 'Insufficient permissions to manage integrations' },
       403,
     )
   }
   ```
2. In `updateConnectionVisibility` handler (~line 118), add the identical guard.
3. Both handlers already resolve `ctx` via `resolveTenantContext` — just insert the `can()` check between tenant resolution and business logic, matching the pattern in `connectGoogle`, `listGoogleConnections`, and `getGoogleAuthUrl`.

**Complexity:** S (1 file, 2 guard additions, copy-paste pattern from lines above)
**Verification:**

- `vitest run src/contexts/integration/server/`
- Manual: confirm Staff role gets 403, PropertyManager/AccountAdmin gets through
- `grep 'can(ctx.role' src/contexts/integration/server/google-connections.ts` — should show 5 checks (3 existing + 2 new)

---

### Fix B2: Add `can()` authorization gates to inbox use cases

**Findings:** #6, #7
**Files:**

- `src/contexts/inbox/application/use-cases/get-inbox-item-detail.ts` — line 28
- `src/contexts/inbox/application/use-cases/add-inbox-note.ts` — line 41

**Changes:**

1. In `get-inbox-item-detail.ts`, add as the first line of the use case function body:
   ```ts
   if (!can(input.role, 'inbox.read')) {
     throw inboxError('forbidden', 'No inbox read permission')
   }
   ```
   Import `can` from `#/shared/domain/permissions`.
2. In `add-inbox-note.ts`, add as the first line:
   ```ts
   if (!can(input.role, 'inbox.write')) {
     throw inboxError('forbidden', 'No inbox write permission')
   }
   ```
3. Verify that both use case input types include `role: Role` — they should per CONTEXT.md.

**Complexity:** S (2 files, 1 guard each)
**Verification:**

- `vitest run src/contexts/inbox/application/`
- Test: call each use case with a Staff role that lacks the permission → should throw forbidden
- `grep 'can(input.role' src/contexts/inbox/application/use-cases/` — should show both new checks

---

## Stream C: Error Handling & Data Integrity

### Fix C1: Replace non-null assertions with guards in notification repositories

**Findings:** #4
**Files:**

- `src/contexts/notification/infrastructure/repositories/notification.repository.ts` — line 49-51
- `src/contexts/notification/infrastructure/repositories/notification-email.repository.ts` — line 65
- `src/contexts/notification/infrastructure/repositories/notification-preference.repository.ts` — line 79

**Changes:**
Replace all `row[0]!` patterns with a guard:

```ts
const r = row[0]
if (!r)
  throw new NotificationRepoError('insert', 'notification', 'No row returned from INSERT')
return notificationFromRow(r)
```

Define `NotificationRepoError` as a tagged error (or reuse a shared repo error type):

```ts
export type NotificationRepoError = Readonly<{
  _tag: 'NotificationRepoError'
  operation: string
  entity: string
  message: string
}>
```

Same pattern for all 3 files.

**Complexity:** S (3 files, same pattern)
**Verification:**

- `vitest run src/contexts/notification/infrastructure/`
- Typecheck: `tsc --noEmit`
- `grep '\[0\]!' src/contexts/notification/infrastructure/` — should return 0 results

---

### Fix C2: Replace `throw new Error()` with tagged errors in inbox repositories

**Findings:** #9, #10
**Files:**

- `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts` — lines 219, 244, 294
- `src/contexts/inbox/infrastructure/repositories/inbox-note.repository.ts` — lines 32, 39

**Changes:**

1. Define a shared infrastructure error in inbox (or import from a shared location):
   ```ts
   export const inboxRepoError = (operation: string, message: string) =>
     Object.assign(new Error(message), { _tag: 'InboxRepoError' as const, operation })
   export type InboxRepoError = ReturnType<typeof inboxRepoError>
   ```
2. Replace all `throw new Error(...)` at the 5 sites with `throw inboxRepoError(operation, message)`.
3. Update the server layer's error handler to recognize `InboxRepoError` via `_tag` check.

**Complexity:** S (2 files, 5 sites)
**Verification:**

- `vitest run src/contexts/inbox/infrastructure/`
- `grep 'throw new Error' src/contexts/inbox/infrastructure/repositories/` — should return 0 results

---

### Fix C3: Fix swallowed error in dashboard portal-analytics

**Findings:** #11
**Files:**

- `src/contexts/dashboard/server/portal-analytics.ts` — line 79

**Changes:**
The `catchUntagged(e)` call result is assigned but never thrown. Add:

```ts
if (catchResult) throw catchResult
```

or restructure the catch block to always throw after `catchUntagged` processing.

**Complexity:** S (1 file, 1-2 line fix)
**Verification:**

- `vitest run src/contexts/dashboard/`
- Confirm error propagation: trigger an untagged error in a test → should surface as HTTP 500, not silently return

---

### Fix C4: Include gbpPlaceId/googleConnectionId in `property.created` event from createProperty

**Findings:** #22
**Files:**

- `src/contexts/property/application/use-cases/create-property.ts` — lines 64-72

**Changes:**
The `property.created` event emitted from `createProperty` omits `gbpPlaceId` and `googleConnectionId` fields. These are available on the created property entity. Include them in the event payload so downstream consumers (integration context, metric context) can use them without a second DB lookup.

**Complexity:** S (1 file, add 2 fields to event constructor args)
**Verification:**

- `vitest run src/contexts/property/application/`
- Verify event snapshot includes both fields

---

### Fix C5: Emit `property.created` event from `importProperty`

**Findings:** #23
**Files:**

- `src/contexts/property/build.ts` — lines 108-145

**Changes:**
The `importProperty` function in the build layer creates a property via `propertyRepo.insert()` but never emits a `property.created` event. Add the same event emission that `createProperty` uses:

```ts
await deps.eventBus.emit(propertyCreated(importedProperty, ctx.organizationId))
```

Use the same event constructor imported from domain/events.

**Complexity:** S (1 file, 2-3 lines)
**Verification:**

- `vitest run src/contexts/property/build.test.ts` (if exists) or integration test
- Confirm event bus receives `property.created` after import flow

---

### Fix C6: Fix E2E test flakiness — replace `Date.now()` with deterministic IDs

**Findings:** #24
**Files:**

- `e2e/auth.spec.ts` — line 8

**Changes:**
Replace `Date.now()` for uniqueness with `crypto.randomUUID()` or a test-specific counter/factory. If timing-based uniqueness is needed for test ordering, use a monotonic counter.

**Complexity:** S (1 file)
**Verification:**

- `vitest run e2e/auth.spec.ts` — passes consistently
- Run 5x in sequence to confirm no flakes

---

### Fix C7: Eliminate dual goal repository instance in composition

**Findings:** #25
**Files:**

- `src/composition.ts` — lines 282-283

**Changes:**
The composition root creates two separate `goalRepository` instances — one used by `cancelGoalFn` and another by event handlers. These hold separate state if any in-memory caching is added later. Consolidate to a single instance:

```ts
const goalRepo = createGoalRepository(db)
// Use goalRepo everywhere instead of creating a second instance
```

Verify all consumers reference the same instance.

**Complexity:** S (1 file, remove duplicate instantiation)
**Verification:**

- `vitest run` (full suite, especially goal context tests)
- `grep 'goalRepository\|goalRepo' src/composition.ts` — should show single creation

---

## Stream D: Security

### Fix D1: Add PostgreSQL advisory lock for last-admin mutation

**Findings:** #117
**Files:**

- `src/contexts/identity/application/use-cases/remove-member.ts` — lines 44-60
- `src/contexts/identity/application/use-cases/update-member-role.ts` — lines 65-75
- `src/contexts/identity/application/ports/identity.port.ts` — add lock method to port
- `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts` — implement lock

**Changes:**

1. Add to the identity port:
   ```ts
   withOrgLock: <T>(organizationId: OrganizationId, fn: () => Promise<T>) => Promise<T>
   ```
2. In the adapter, implement using `pg_advisory_xact_lock`:
   ```ts
   withOrgLock: async (orgId, fn) => {
     return db.transaction(async (tx) => {
       await tx.execute(sql`SELECT pg_advisory_xact_lock(${hashOrgId(orgId)})`)
       return fn()
     })
   }
   ```
   Use a stable hash of `orgId` as the lock key (e.g., hash to integer).
3. In `remove-member.ts`, wrap the count-check + remove in `deps.identity.withOrgLock(input.organizationId, async () => { ... })`.
4. In `update-member-role.ts`, wrap the count-check + update the same way.

**Complexity:** M (4 files, new port method + 2 callers + adapter)
**Verification:**

- `vitest run src/contexts/identity/`
- Concurrency test: spawn two simultaneous `removeMember` calls for the last admin → exactly one should succeed
- Typecheck: `tsc --noEmit`

---

### Fix D2: Add migration plan for email verification

**Findings:** #118
**Files:**

- `src/shared/auth/auth.ts` — lines 51-71
- `SECURITY_ONBOARDING.md` — add migration step
- New: `scripts/migrations/verify-existing-emails.sql` (migration script)

**Changes:**
This is a preparation fix — do NOT enable email verification yet.

1. Uncomment the `emailVerification` block at lines 65-71.
2. Add a guard comment above `requireEmailVerification: false`:
   ```ts
   // FUTURE: Enable after:
   // 1. Run scripts/migrations/verify-existing-emails.sql to set emailVerified=true for all existing users
   // 2. Confirm Resend domain verification is complete
   // 3. Test full signup → verify → sign-in flow
   ```
3. Create the migration script:
   ```sql
   -- Run before enabling requireEmailVerification
   UPDATE "user" SET email_verified = true WHERE email_verified IS NULL OR email_verified = false;
   ```
4. Add §4.1 to `SECURITY_ONBOARDING.md` documenting the migration prerequisite.

**Complexity:** S (2 existing files + 1 new SQL script)
**Verification:**

- `tsc --noEmit` — no type errors from uncommented block
- Manual: verify the commented code is syntactically valid
- Confirm `requireEmailVerification` is still `false` after changes

---

### Fix D3: Add rate limiting to authentication endpoints

**Findings:** #119
**Files:**

- `src/contexts/identity/server/organizations.registration.ts` — lines 63-87 (`signInUser`)
- `src/contexts/identity/server/organizations.registration.ts` — `registerUserAndOrg`
- `src/contexts/identity/server/organizations.registration.ts` — `registerMember`
- `src/contexts/identity/server/organizations.ts` — `changePasswordFn`, `createOrganizationFn`
- `src/shared/rate-limit.ts` — verify rate limiter interface

**Changes:**

1. Import the rate limiter from `getContainer()` in each handler.
2. Extract client IP from the request headers (`x-forwarded-for` or `x-real-ip`).
3. Add per-IP rate limiting before the auth operation:
   ```ts
   const ip = headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'
   await rateLimiter.check(ip, { limit: 10, window: '60s' }) // 10 req/min for sign-in
   ```
4. Use stricter limits for sign-in (5/min) vs registration (3/min).
5. The `auth-settings.helpers.ts` already handles 429 responses (line 42-48) — no client changes needed.

**Complexity:** M (2 files, 5 endpoints, shared rate limiter already exists)
**Verification:**

- `vitest run src/contexts/identity/server/`
- Test: send 6 rapid sign-in requests from same IP → 6th should return 429
- `grep 'rateLimiter.check' src/contexts/identity/server/` — should show 5 calls

---

### Fix D4: Make registration + org creation atomic

**Findings:** #120
**Files:**

- `src/contexts/identity/application/use-cases/register-user-and-org.ts` — lines 82-101
- `src/contexts/identity/application/ports/identity.port.ts` — may need transactional method

**Changes:**
Two options, ranked by risk:

**Option A (Recommended — compensating transaction):**
Add cleanup logic when org setup fails after user creation succeeds:

```ts
try {
  orgResult = await setupOrg(user, input)
} catch (orgError) {
  // Compensating transaction: remove the orphaned user
  await deps.identity.deleteUser(user.id)
  throw integrationError(
    'org_setup_failed',
    'Organization setup failed. Please try again.',
  )
}
```

This requires adding `deleteUser` to the identity port.

**Option B (Full transaction):**
Wrap both operations in a database transaction via the identity adapter. This requires refactoring better-auth calls to accept a transaction client, which is more invasive.

Go with Option A — lower risk, covers the data integrity concern, and the user sees a clean error message instead of an orphaned account.

**Complexity:** M (2 files, new port method + compensating logic)
**Verification:**

- `vitest run src/contexts/identity/application/`
- Test: mock org setup failure → verify user is cleaned up
- Test: successful flow → no cleanup triggered
- Confirm no orphaned user records in test DB after failed registration

---

## Dependency Graph

```
Stream A (Multi-tenancy)
├── A1: goal findAllActive + spawn-recurring ───┐
└── A2: notification email queue orgId     ─────┤  ← PARALLEL
                                                  │
Stream B (Authorization)                         │
├── B1: integration permission checks       ─────┤
└── B2: inbox use case auth gates           ─────┤  ← PARALLEL
                                                  │
Stream C (Error handling)                        │
├── C1: notification non-null guards        ─────┤
├── C2: inbox repo tagged errors            ─────┤
├── C3: dashboard swallowed error           ─────┤  ← PARALLEL
├── C4: property event fields               ─────┤
├── C5: importProperty event emission       ─────┤
├── C6: E2E test flakiness                  ─────┤
└── C7: dual goal repo instance             ─────┘
                                                  │
Stream D (Security)                              │
├── D1: last-admin advisory lock            ─────┤
├── D2: email verification prep             ─────┤  ← PARALLEL
├── D3: auth rate limiting                  ─────┤
└── D4: atomic registration                 ─────┘
```

All four streams can run in parallel — they touch disjoint files and contexts.

Within Stream C, fixes C1-C7 are all independent of each other and can also be parallelized.

---

## Global Verification

After all fixes are applied, run the full verification suite:

```bash
# Typecheck everything
tsc --noEmit

# Full test suite
vitest run

# Grep for remaining bare Error throws in modified contexts
grep -rn 'throw new Error' src/contexts/{goal,notification,inbox,integration,identity,dashboard,property}/

# Grep for remaining non-null assertions on .returning()
grep -rn '\[0\]!' src/contexts/notification/infrastructure/

# Verify all auth endpoints have rate limiting
grep -rn 'rateLimiter.check' src/contexts/identity/server/

# Verify no unguarded server functions in integration context
grep -rn 'can(ctx.role' src/contexts/integration/server/google-connections.ts

# Verify inbox use case auth gates
grep -rn 'can(input.role' src/contexts/inbox/application/use-cases/
```

---

## Summary Table

| Fix | Findings | Stream | Files | Complexity | Can Parallel With |
| --- | -------- | ------ | ----- | ---------- | ----------------- |
| A1  | #1, #2   | A      | 3     | S          | All others        |
| A2  | #3       | A      | 3-4   | S          | All others        |
| B1  | #5       | B      | 1     | S          | All others        |
| B2  | #6, #7   | B      | 2     | S          | All others        |
| C1  | #4       | C      | 3     | S          | All others        |
| C2  | #9, #10  | C      | 2     | S          | All others        |
| C3  | #11      | C      | 1     | S          | All others        |
| C4  | #22      | C      | 1     | S          | All others        |
| C5  | #23      | C      | 1     | S          | All others        |
| C6  | #24      | C      | 1     | S          | All others        |
| C7  | #25      | C      | 1     | S          | All others        |
| D1  | #117     | D      | 4     | M          | All others        |
| D2  | #118     | D      | 2+1   | S          | All others        |
| D3  | #119     | D      | 2     | M          | All others        |
| D4  | #120     | D      | 2     | M          | All others        |

**Totals:** 18 findings, 14 fix items, ~25 files touched, 0 blocking dependencies between streams.
