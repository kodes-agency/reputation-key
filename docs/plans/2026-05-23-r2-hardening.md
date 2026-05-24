# Deep Review Hardening R2 — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix all 4 BLOCKERs and 26 MAJORs from the R2 re-audit across the reputation-key codebase.

**Architecture:** Hexagonal TypeScript. Bounded contexts communicate through `public-api.ts` facades. Domain uses `Result<T,E>` (neverthrow). Auth uses `can(role, permission)`. Tests use Vitest.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, Postgres, BullMQ, Redis, neverthrow, Zod

**Working Directory:** `~/conductor/workspaces/reputation-key/dublin`
**Branch:** `feat/phase-15c-goal-ui` (or a new branch from it)

---

## Stream Map

| Stream | Theme                        | BLOCKER | MAJOR | Tasks | Strategy                                                |
| ------ | ---------------------------- | ------- | ----- | ----- | ------------------------------------------------------- |
| A      | Cross-Context Boundaries     | 4       | 6     | A1–A8 | Sequential — deepest infra changes, widest blast radius |
| B      | Use Case Authorization       | 0       | 2     | B1–B2 | Sequential — depends on Stream A ports                  |
| C      | Error Handling & Logging     | 0       | 2     | C1–C2 | Parallel after A — touches different files              |
| D      | Missing Tests                | 0       | 3     | D1–D3 | Parallel after B — independent files                    |
| E      | Documentation & Housekeeping | 0       | 3     | E1–E3 | Parallel — docs only, no code risk                      |

**Execution order:** A (sequential) → B+C (parallel) → D+E (parallel)

---

## Stream A: Cross-Context Boundaries (4 BLOCKER + 6 MAJOR)

### Task A1: Create Goal public-api.ts

**TDD:** Skip — pure facade, no behavior change.

**Objective:** Add `src/contexts/goal/application/public-api.ts` exporting goal use case functions and event types, consistent with all other contexts.

**Files:**

- Create: `src/contexts/goal/application/public-api.ts`
- Modify: `src/contexts/goal/application/index.ts` (re-export)

**Steps:**

1. Read existing public-api patterns: `src/contexts/staff/application/public-api.ts`, `src/contexts/metric/application/public-api.ts`
2. Create `goal/application/public-api.ts` re-exporting:
   - Goal use case types and DTOs from `application/dto/goal.dto`
   - Event types from `domain/events` (if any)
   - `GoalRepository` port type (for consumers to depend on)
3. Add re-export from `goal/application/index.ts`
4. Run: `pnpm tsc --noEmit` — verify 0 errors
5. Run: `pnpm vitest run` — verify all tests pass
6. Commit: `git add -A && git commit -m "feat(goal): add public-api.ts facade for cross-context access"`

### Task A2: Wire Integration→Property through PropertyPublicApi

**TDD:** Skip — wiring refactor, existing tests cover behavior.

**Objective:** Replace Integration's direct DB access to `properties` table with calls through `PropertyPublicApi`.

**Files:**

- Modify: `src/contexts/integration/build.ts` — remove direct `properties` schema import, use injected port
- Modify: `src/contexts/integration/application/ports/property-import.repository.ts` — rename/refactor if needed
- Modify: `src/composition.ts` — wire PropertyPublicApi methods as Integration's port implementations

**Context — what exists:**

- `PropertyPublicApi` already has: `findByGbpPlaceId`, `findIdsByGoogleConnection`, `clearGoogleConnectionRef`
- `PropertyPublicApi` is MISSING: `importProperty` (creating a property from GBP import)
- Integration's `build.ts` currently implements `PropertyFkCleanupPort` and `PropertyQueryPort` inline with direct DB queries
- Integration's `property-import.repository.ts` directly INSERTs into `properties` table

**Steps:**

1. Read `src/contexts/property/application/public-api.ts` to see existing API surface
2. Read `src/contexts/integration/build.ts` to understand the inline port implementations
3. Add `importProperty` method to `PropertyPublicApi` interface and its implementation in `PropertyRepository`:
   ```typescript
   importProperty(input: { orgId: OrganizationId; name: string; gbpPlaceId: string; address?: string }): Promise<Result<Property, PropertyError>>
   ```
4. In `src/contexts/integration/build.ts`:
   - Remove `import { properties } from '#/shared/db/schema/property.schema'`
   - Replace inline `propertyFkCleanup` and `propertyQuery` implementations with calls to the injected `PropertyPublicApi`
   - Pass `PropertyPublicApi` via deps instead of `db`
5. In `src/contexts/integration/infrastructure/repositories/property-import.repository.ts`:
   - Replace `db.insert(properties).values(...)` with a call through PropertyPublicApi or a dedicated port
6. In `src/composition.ts`:
   - Wire PropertyPublicApi into Integration's dependency graph
7. Run: `pnpm tsc --noEmit`
8. Run: `pnpm vitest run`
9. Commit: `git add -A && git commit -m "refactor(integration): wire Property access through PropertyPublicApi"`

### Task A3: Fix Inbox→Review/Guest/Property cross-context JOINs

**TDD:** Skip — query refactor, existing tests cover behavior.

**Objective:** Replace Inbox's direct JOINs against Review, Guest (feedback/ratings), and Property tables with calls through those contexts' public APIs.

**Files:**

- Modify: `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts`
- Modify: `src/contexts/inbox/build.ts`
- Modify: `src/composition.ts`

**Context:**

- Inbox currently does LEFT JOINs to `reviews`, `feedback`, `ratings`, `properties` tables for enrichment
- The inbox items themselves are owned by the Inbox context, but enrichment data comes from other contexts
- Two approaches: (a) denormalize enrichment data into inbox_items at write time, or (b) call public APIs after fetching items
- **Recommended approach (b):** Fetch inbox items first, then call Review/Guest/Property public APIs to enrich

**Steps:**

1. Read `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts` to understand the JOIN patterns
2. Define new ports in `inbox/application/ports/`:
   - `ReviewLookupPort` — `getReviewById(id) => ReviewSnippet`
   - `FeedbackLookupPort` — `getFeedbackBySourceId(id) => FeedbackSnippet`
   - `PropertyLookupPort` — already exists via PropertyPublicApi
3. Implement these ports by calling the respective contexts' public APIs
4. Refactor `inbox.repository.ts`:
   - Remove `reviews`, `feedback`, `ratings`, `properties` schema imports
   - Fetch inbox_items without JOINs
   - Call lookup ports to enrich with review/feedback/property data
5. Wire in `composition.ts`
6. Run: `pnpm tsc --noEmit`
7. Run: `pnpm vitest run`
8. Commit: `git add -A && git commit -m "refactor(inbox): replace cross-context JOINs with public API calls"`

### Task A4: Fix Guest→Staff cross-context violation

**TDD:** Skip — wiring refactor.

**Objective:** Replace `src/contexts/guest/build.ts`'s direct import of `StaffAssignmentRepository` with a call through `StaffPublicApi`.

**Files:**

- Modify: `src/contexts/guest/build.ts`
- Modify: `src/contexts/staff/application/public-api.ts` (if `getStaffByReferralCode` not already exposed)

**Steps:**

1. Read `src/contexts/guest/build.ts` to see how `StaffAssignmentRepository` is used
2. Check if `StaffPublicApi` already has the needed method (likely `getAccessiblePropertyIds` or `resolveReferralCode`)
3. If not, add `getStaffByReferralCode` or `resolveReferralCode` to `StaffPublicApi`
4. In `guest/build.ts`, replace `StaffAssignmentRepository` import with `StaffPublicApi` usage
5. Wire in composition.ts if needed
6. Run: `pnpm tsc --noEmit`
7. Run: `pnpm vitest run`
8. Commit: `git add -A && git commit -m "refactor(guest): replace direct StaffAssignmentRepository with StaffPublicApi"`

### Task A5: Export MetricRecorded event from Metric public-api

**TDD:** Skip — re-export only.

**Objective:** Add `MetricRecorded` event type to Metric's `public-api.ts` so Goal doesn't need to duplicate it.

**Files:**

- Modify: `src/contexts/metric/application/public-api.ts`
- Modify: `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts` — import from public-api

**Steps:**

1. Read `src/contexts/metric/application/public-api.ts` to see what's exported
2. Add re-export of `MetricRecorded` event type from `domain/events`
3. Update Goal's event handler to import from metric public-api instead of duplicating
4. Run: `pnpm tsc --noEmit`
5. Commit: `git add -A && git commit -m "refactor(metric): export MetricRecorded event from public-api"`

### Task A6: Fix Dashboard→Review/Metric direct table queries

**TDD:** Skip — query refactor.

**Objective:** Replace Dashboard's direct queries to Review/Metric tables with calls through facade ports (per ADR-0007).

**Files:**

- Modify: `src/contexts/dashboard/infrastructure/repositories/dashboard.repository.ts`
- Modify: `src/contexts/dashboard/build.ts`
- Modify: `src/composition.ts`

**Steps:**

1. Read ADR-0007 and `dashboard.repository.ts` to understand the facade port pattern
2. Create/extend facade ports in `dashboard/application/ports/`:
   - `ReviewStatsPort` — aggregate review stats
   - `MetricStatsPort` — aggregate metric values
3. Implement ports by calling Review and Metric public APIs
4. Refactor dashboard repo to use ports instead of direct SQL
5. Wire in composition.ts
6. Run: `pnpm tsc --noEmit`
7. Run: `pnpm vitest run`
8. Commit: `git add -A && git commit -m "refactor(dashboard): replace direct table queries with facade ports (ADR-0007)"`

### Task A7: Fix Guest resolvers querying Portal/Property tables

**TDD:** Skip — wiring refactor.

**Objective:** Replace Guest's direct table queries to Portal and Property with public API calls.

**Files:**

- Modify: `src/contexts/guest/infrastructure/resolvers/*.ts`
- Modify: `src/contexts/guest/build.ts`

**Steps:**

1. Read the guest resolver files to identify direct Portal/Property table queries
2. Replace with calls through PortalPublicApi and PropertyPublicApi
3. Wire in composition.ts if needed
4. Run: `pnpm tsc --noEmit`
5. Run: `pnpm vitest run`
6. Commit: `git add -A && git commit -m "refactor(guest): replace direct Portal/Property queries with public API calls"`

### Task A8: Fix goal/ui/helpers direct domain import

**TDD:** Skip — import path change.

**Objective:** Fix `src/contexts/goal/ui/helpers.ts` importing from `goal/domain/types` directly instead of through the DTO layer.

**Files:**

- Modify: `src/contexts/goal/ui/helpers.ts`

**Steps:**

1. Read `src/contexts/goal/ui/helpers.ts` to see the import
2. Replace domain import with DTO import from `application/dto/goal.dto`
3. Run: `pnpm tsc --noEmit`
4. Commit: `git add -A && git commit -m "fix(goal): route UI helpers through DTO layer, not domain"`

---

## Stream B: Use Case Authorization (2 MAJOR)

### Task B1: Add can() checks to 15 use cases

**TDD:** Yes — add tests for authorization denial.

**Objective:** Add `can(ctx, permission)` checks to 15 use cases that accept `AuthContext` but never authorize.

**Files:**

- Modify: 15 use case files across identity, integration, portal, property, staff
- Create/Modify: corresponding test files for forbidden-path tests

**Affected use cases:**

- identity: `finalizeAvatarUpload`, `finalizeOrgLogoUpload`, `requestAvatarUpload`, `requestOrgLogoUpload`, `leaveOrganization`
- integration: `connectGoogle`, `disconnectGoogle`, `connectGbp`, `refreshGbpLocations`
- portal: `createPortal`, `updatePortal`, `deletePortal`, `publishPortal`
- property: `createProperty`, `updateProperty`, `deleteProperty`

**Steps (per use case):**

1. Read the use case file
2. Add `import { can } from '#/shared/domain/permissions'` if missing
3. Add `if (!can(ctx.role, 'resource:action')) return err(...)` after the initial validation
4. Write test for forbidden role
5. Run: `pnpm vitest run <test-file>`
6. Commit after batch: `git add -A && git commit -m "feat(auth): add can() authorization checks to 15 use cases"`

**Batch by context:**

- Batch 1: identity (5 use cases + tests)
- Batch 2: integration (4 use cases + tests)
- Batch 3: portal (4 use cases + tests)
- Batch 4: property (3 use cases + tests)

### Task B2: Add can() check to getGoogleAuthUrl server function

**TDD:** Yes — add test for unauthorized role.

**Objective:** Add permission check to `getGoogleAuthUrl` which currently bypasses authorization.

**Files:**

- Modify: `src/contexts/integration/server/google-connections.ts`
- Modify/Create: corresponding test file

**Steps:**

1. Read the file, locate `getGoogleAuthUrl` function
2. Add `can(ctx.role, 'integration.manage')` check after `resolveTenantContext()`
3. Write test for Staff role being denied
4. Run: `pnpm vitest run`
5. Commit: `git add -A && git commit -m "fix(auth): add permission check to getGoogleAuthUrl server function"`

---

## Stream C: Error Handling & Logging (2 MAJOR)

### Task C1: Add structured logging to ~20 silent catch blocks

**TDD:** Skip — logging addition, no behavior change.

**Objective:** Add `logger.error(...)` to every catch block that currently swallows errors silently.

**Files:**

- Modify: ~20 use case files across guest, identity, inbox, integration, review contexts

**Pattern to apply:**

```typescript
// Before:
} catch (error) {
  return err({ _tag: 'XxxError', code: 'UNEXPECTED_ERROR', message: 'Failed' })
}

// After:
} catch (error) {
  logger.error({ err: error, useCase: 'xxx' }, 'Failed to ...')
  return err({ _tag: 'XxxError', code: 'UNEXPECTED_ERROR', message: 'Failed' })
}
```

**Steps:**

1. Search for all catch blocks in application/use-cases that don't call `logger`
2. For each, add `logger.error(...)` before the `return err(...)`
3. Ensure `logger` is imported (from injected LoggerPort or via context)
4. Run: `pnpm tsc --noEmit`
5. Run: `pnpm vitest run`
6. Commit: `git add -A && git commit -m "fix(logging): add structured logging to 20 silent catch blocks"`

### Task C2: Replace throw new Error() with exhaustive never pattern in domain

**TDD:** Skip — error pattern refactor.

**Objective:** Replace `throw new Error()` in goal domain exhaustive checks with a proper exhaustive-never helper.

**Files:**

- Modify: `src/contexts/goal/domain/constructors.ts`
- Modify: `src/contexts/goal/domain/progress-strategy.ts`
- Create: `src/shared/domain/assert.ts` (exhaustive check helper)

**Pattern:**

```typescript
// Before:
default:
  throw new Error(`Unknown strategy: ${strategy.type}`)

// After:
default: {
  const _exhaustive: never = strategy
  throw new UnreachableError('progress-strategy', _exhaustive)
}
```

**Steps:**

1. Create `src/shared/domain/assert.ts` with `class UnreachableError extends Error` helper
2. Update goal domain files to use the new pattern
3. Also fix any `throw new Error()` in application layer (create-goal.ts)
4. Run: `pnpm tsc --noEmit`
5. Run: `pnpm vitest run`
6. Commit: `git add -A && git commit -m "fix(domain): replace throw with exhaustive-never pattern in goal context"`

---

## Stream D: Missing Tests (3 MAJOR)

### Task D1: Add unit tests for 7 untested use cases

**TDD:** Yes — this IS the test.

**Objective:** Create test files for 7 use cases that have none.

**Files to create:**

- `src/contexts/guest/application/use-cases/get-public-portal.test.ts`
- `src/contexts/guest/application/use-cases/resolve-link-and-track.test.ts`
- `src/contexts/guest/application/use-cases/resolve-portal-context.test.ts`
- `src/contexts/identity/application/use-cases/finalize-avatar-upload.test.ts`
- `src/contexts/identity/application/use-cases/finalize-org-logo-upload.test.ts`
- `src/contexts/identity/application/use-cases/request-avatar-upload.test.ts`
- `src/contexts/identity/application/use-cases/request-org-logo-upload.test.ts`

**Pattern per test file:**

```typescript
import { describe, it, expect } from 'vitest'
// Import use case + mocks
// Test: happy path
// Test: validation error
// Test: authorization denied (if can() added in B1)
// Test: repository error
```

**Steps:**

1. Read each use case to understand its logic and ports
2. Write test with in-memory port fakes (following existing test patterns)
3. Run: `pnpm vitest run <test-file>`
4. Commit after batch: `git add -A && git commit -m "test: add unit tests for 7 previously untested use cases"`

### Task D2: Add auth/forbidden path tests for Goal use cases

**TDD:** Yes.

**Objective:** Add forbidden-role test paths to Goal use case tests.

**Files:**

- Modify: existing Goal use case test files

**Steps:**

1. Read existing Goal use case test files
2. Add test cases for Staff role being denied goal.create/goal.write
3. Run: `pnpm vitest run`
4. Commit: `git add -A && git commit -m "test(goal): add forbidden-path authorization tests"`

### Task D3: Add end-to-end server function tests (beyond DTO-only)

**TDD:** Yes.

**Objective:** Extend server function tests to exercise the full pipeline: auth → permission → use case → error mapping.

**Files:**

- Modify: existing server function test files (goal, staff)

**Steps:**

1. Read existing server function tests
2. Add tests that verify: forbidden role returns proper error, missing auth returns 401
3. Run: `pnpm vitest run`
4. Commit: `git add -A && git commit -m "test: add full-pipeline server function tests with auth+permission checks"`

---

## Stream E: Documentation & Housekeeping (3 MAJOR)

### Task E1: Update ADR-0005 status from "Accepted" to "Implemented"

**TDD:** Skip — doc change.

**Objective:** ADR-0005 is marked "Accepted" but the code is fully implemented. Update status.

**Files:**

- Modify: `docs/adr/0005-*.md`

**Steps:**

1. Read ADR-0005
2. Change status from "Accepted" to "Implemented"
3. Commit: `git add -A && git commit -m "docs: update ADR-0005 status to Implemented"`

### Task E2: Add CONTEXT.md for Property, Portal, Team contexts

**TDD:** Skip — doc creation.

**Objective:** Thick contexts missing per-context CONTEXT.md files (only Goal and Staff have them).

**Files to create:**

- `src/contexts/property/CONTEXT.md`
- `src/contexts/portal/CONTEXT.md`
- `src/contexts/team/CONTEXT.md`

**Pattern:** Follow `src/contexts/goal/CONTEXT.md` and `src/contexts/staff/CONTEXT.md` structure:

- Domain entities owned + invariants
- Use cases
- Ports vs adapters
- Server functions
- Cross-context interactions
- Key files

**Steps:**

1. Read goal/CONTEXT.md for template
2. Scan each context's domain/application/infrastructure/server dirs
3. Write CONTEXT.md for each
4. Commit: `git add -A && git commit -m "docs: add CONTEXT.md for Property, Portal, Team contexts"`

### Task E3: Fix toDomainRole() usage outside auth middleware

**TDD:** Skip — import path cleanup.

**Objective:** Ensure `toDomainRole()` is only called in auth middleware, not scattered elsewhere.

**Files:**

- Check: `src/contexts/identity/` for direct `toDomainRole()` calls
- Check: server functions for `toDomainRole()` usage

**Steps:**

1. Search for `toDomainRole` across codebase
2. If found outside `shared/auth/middleware.ts`, document whether intentional or remove
3. If identity adapter legitimately needs it, add a comment explaining why
4. Commit if changes needed: `git add -A && git commit -m "fix(auth): confine toDomainRole() to auth middleware"`

---

## Verification (Final Step)

After ALL streams complete:

1. Run: `pnpm tsc --noEmit` — must be 0 errors
2. Run: `pnpm eslint .` — must be clean
3. Run: `pnpm vitest run` — all tests pass
4. Run: `git diff --stat origin/main..HEAD` — review changed files
5. Push: `git push`
6. Create PR targeting main with summary of R2→R3 delta

---

## Estimated Effort

| Stream    | Tasks  | Files   | Est. Time               |
| --------- | ------ | ------- | ----------------------- |
| A         | 8      | ~30     | 3-4 subagent dispatches |
| B         | 2      | ~20     | 2 subagent dispatches   |
| C         | 2      | ~25     | 2 subagent dispatches   |
| D         | 3      | ~15     | 2 subagent dispatches   |
| E         | 3      | ~8      | 1 subagent dispatch     |
| **Total** | **18** | **~98** | **~12 dispatches**      |
