# Follow-Up Remediation Plan

> **Status:** Planning  
> **Created:** 2026-06-21  
> **Predecessor:** PR #114 (6-phase audit remediation — merged)  
> **Goal:** Complete all remaining audit findings to achieve pristine code quality

---

## Summary

The initial 6-phase remediation (PR #114) fixed all CRITICAL/HIGH data-correctness bugs, added 15 database indexes, hardened auth/security, fixed error handling, and applied type validation to the most critical mapper. This plan covers the remaining 40+ findings across 8 work streams.

**Execution model:** Each work stream is independently mergeable. Run typecheck + tests + lint after each. Create PRs per work stream or batch multiple.

---

## Work Stream 1: Type Safety Round 2 (8 items)

> **Risk:** Low — all mechanical pattern applications  
> **Estimated changes:** ~150 lines across 8 files  
> **Gate:** typecheck ✓ + tests ✓

### 1.1 Apply assertLiteral to activity mapper

- **File:** `src/contexts/activity/infrastructure/activity-repository.drizzle.ts:39-45`
- **What:** Replace `row.action as ActivityLog['action']`, `row.resourceType as ActivityLog['resourceType']`, `row.source as ActivityLog['source']` with `assertLiteral()` calls
- **Pattern:** Same as notification-row.mapper.ts (PR #114). Import `assertLiteral` from `#/shared/domain/assert`
- **Also:** `row.payload as ActivityLog['payload']` — this is JSONB, needs a runtime type guard per action variant. For now, keep the cast but add a comment that payload validation is a future enhancement.

### 1.2 Apply assertLiteral to leaderboard mapper

- **File:** `src/contexts/leaderboard/infrastructure/mappers/leaderboard.mapper.ts:23-25,39`
- **What:** Replace 4 `as` casts: `row.period`, `row.scope`, `row.metricKey`, `row.targetType`
- **Pattern:** Define VALID arrays for `LeaderboardPeriod`, `LeaderboardScope`, `MetricKey`, `LeaderboardTargetType`

### 1.3 Apply assertLiteral to badge mapper

- **File:** `src/contexts/badge/infrastructure/mappers/badge.mapper.ts:60,99,101,106`
- **What:** Replace casts for `targetType`, `targetScope`, `criteria` (JSONB), `award.targetType`
- **Note:** `definitionCriteria` is `Record<string, unknown>` cast to `BadgeCriteria` — this needs a zod schema, not just assertLiteral. Create a `badgeCriteriaSchema` and parse.

### 1.4 Add zod schemas for Google OAuth responses

- **File:** `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts:55,88,126`
- **What:** Define `googleTokenResponseSchema` and `googleUserInfoSchema`, then `schema.parse(await response.json())` instead of bare `data = await response.json()`
- **Schema shapes:**
  ```ts
  const googleTokenResponseSchema = z.object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
    expires_in: z.number(),
    scope: z.string().optional(),
    token_type: z.string().optional(),
  })
  const googleUserInfoSchema = z.object({
    id: z.string(),
    email: z.string(),
    verified_email: z.boolean().optional(),
    name: z.string().optional(),
  })
  ```

### 1.5 Add zod schemas for GBP API responses

- **File:** `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts:37,74,101,130`
- **What:** Define schemas for `listAccounts`, `listLocations`, `getLocation`, `batchGetReviews` responses
- **Pattern:** Focus on the fields actually accessed: `accounts[]`, `nextPageToken`, `locations[]`, `locationReviews[]`, `review.name`, `review.reviewReply`

### 1.6 Add zod schema for webhook payload

- **File:** `src/routes/api/webhooks/gbp/notifications.ts:42,65-67`
- **What:** Replace `as` casts with `z.object(...).parse()`
- **Schema:**
  ```ts
  const webhookBodySchema = z.object({
    message: z
      .object({
        data: z.string(),
        attributes: z.record(z.string()).optional(),
      })
      .optional(),
  })
  ```

### 1.7 Fix better-auth response double-casts

- **File:** `src/contexts/identity/server/organizations.invitations.ts:35`
  - Replace `as unknown as { organizationId: string }` with zod parse
- **File:** `src/contexts/identity/server/organizations.query.ts:123-125`
  - Replace `as AuthOrganizationResponse[]` with zod parse
- **File:** `src/contexts/identity/server/organizations.shared.ts:90-98`
  - Replace per-field `as string | null` casts with `typeof` guards
- **Schema:**
  ```ts
  const acceptInvitationResultSchema = z.object({
    organizationId: z.string(),
  })
  ```

### 1.8 Add zod validation for Redis cache deserialization

- **File:** `src/shared/cache/redis-cache.ts:15`
- **What:** Change `Cache` port to accept an optional schema parameter:
  ```ts
  get<T>(key: string, schema?: ZodType<T>): Promise<T | null>
  ```
  When schema is provided: `schema.parse(JSON.parse(raw))`. When not: current behavior (backward compat).
- **Impact:** Callers that pass a schema get runtime validation; existing callers continue working.

---

## Work Stream 2: Test Coverage — Repositories (3 items)

> **Risk:** Low — follows existing `review.repository.test.ts` pattern  
> **Gate:** tests ✓ (must include tenant isolation tests)  
> **Pattern file:** `src/contexts/review/infrastructure/repositories/review.repository.test.ts`

### 2.1 Replace inbox repository stub tests with real integration tests

- **File:** `src/contexts/inbox/infrastructure/repositories/inbox.repository.test.ts`
- **Current state:** 243 lines of compile-check stubs + in-memory tests. NO real SQL tested.
- **What:** Write integration tests against real Postgres (same pattern as review repo):
  - CRUD: create inbox item, findById, findFilteredPaginated
  - Tenant isolation: ORG_A cannot see ORG_B items
  - Status transitions: new → addressed → escalated
  - Denormalized field sync: syncDenormalizedFields
  - Folder counts: findFolderCounts by status
  - Upsert conflict handling: source_unique constraint
- **Depends on:** `inbox_items`, `reviews`, `feedback`, `inbox_notes` tables seeded
- **Cleanup:** `DELETE FROM inbox_items WHERE organization_id IN ($1, $2)`

### 2.2 Add leaderboard repository integration tests

- **File:** NEW `src/contexts/leaderboard/infrastructure/repositories/leaderboard.repository.test.ts`
- **What:** Test the 445-line repository with complex normalization/ranking/snapshot logic:
  - refresh: insert snapshot + entries, verify ranking
  - reconcile: update existing snapshot, verify idempotency
  - Multi-period queries: verify correct period filtering
  - Tenant isolation: ORG_A cannot query ORG_B snapshots
  - Normalization: verify composite score normalization math
  - Mapper: leaderboardSnapshotFromRow, leaderboardEntryFromRow

### 2.3 Add badge repository integration tests

- **File:** NEW `src/contexts/badge/infrastructure/repositories/badge.repository.test.ts`
- **What:** Test:
  - seedDefinitions: upsert behavior, idempotency
  - evaluateBadgeDefinitionForTarget: criteria matching
  - insertAward + findAwardByUniqueKey: uniqueness enforcement
  - listPortalTargets / listGroupTargets: verify orgId filter works (tests the Phase 1 fix)
  - listStaffAwards: join logic with staff_assignments + portals
  - Tenant isolation: cross-org returns empty

---

## Work Stream 3: Test Coverage — Server Functions (4 items)

> **Risk:** Low — follows existing `goal/server/goals.test.ts` pattern  
> **Pattern:** DTO validation tests + error→status mapping + throwContextError construction  
> **Gate:** tests ✓

### 3.1 Add review server function tests

- **Files:** NEW tests for `src/contexts/review/server/reply.ts`, `reply-draft.ts`, `reply-read.ts`, `staff-recent-activity.ts`
- **What per file:**
  - DTO schema validation (valid/invalid inputs)
  - Error→HTTP status mapping (`isReviewError` → `throwContextError`)
  - Permission enforcement (role-based access)

### 3.2 Add inbox server function tests

- **Files:** NEW tests for 6 source files in `src/contexts/inbox/server/`
- **What:** Same pattern as review — DTO validation, error mapping, permission checks

### 3.3 Add identity server function tests

- **Files:** NEW tests for the 11 untested files in `src/contexts/identity/server/`
- **Priority:** `organizations.invitations.ts` (invitation acceptance security), `organizations.members.ts` (role changes), `organizations.upload.ts` (file upload)

### 3.4 Add dashboard server function tests

- **Files:** NEW tests for 5 files in `src/contexts/dashboard/server/`
- **What:** Verify clock() usage (ADR 0017 compliance), query parameter validation, error handling

---

## Work Stream 4: Test Coverage — Domain & Use Cases (3 items)

> **Risk:** Low — pure unit tests  
> **Gate:** tests ✓

### 4.1 Add activity context tests

- **Files:** NEW tests for:
  - `insert-activity-log.ts` use case (happy path, construction failure, dedup)
  - All 11 event handlers (`on-reply-submitted`, `on-inbox-item-created`, etc.) — verify correct activity type + metadata per event
  - `activity-repository.drizzle.ts` integration test (tenant isolation)

### 4.2 Add badge domain constructor tests

- **File:** NEW `src/contexts/badge/domain/constructors.test.ts`
- **What:** Test `createBadgeDefinition` — valid inputs, invalid inputs, invariant enforcement

### 4.3 Add badge use case orchestrator tests

- **File:** Extend `src/contexts/badge/application/use-cases/evaluate-badge-for-target.test.ts`
- **What:** Test the OUTER `evaluateBadgeForTarget` function (currently only inner `evaluateBadgeDefinitionForTarget` is tested):
  - Multiple definitions, empty list, mixed results
  - Hoist `findPropertyTimezone` out of loop (DB-004 fix + test)
  - Concurrent award uniqueness (EDGE-02 race condition test)

---

## Work Stream 5: E2E Test Specs (3 items)

> **Risk:** Medium — E2E tests may reveal integration bugs  
> **Gate:** E2E suite ✓

### 5.1 Reply workflow E2E spec

- **File:** NEW `e2e/reply-workflow.spec.ts`
- **Flow:** Sign in → navigate to inbox → select review → draft reply → submit → approve → verify status changes → verify inbox item updates
- **Priority:** CRITICAL — this is the primary value-creating flow

### 5.2 Inbox management E2E spec

- **File:** NEW `e2e/inbox-management.spec.ts`
- **Flow:** Sign in → inbox → assign item → change status → add note → bulk operations → verify updates

### 5.3 Cross-tenant isolation E2E spec

- **File:** NEW `e2e/cross-tenant.spec.ts`
- **Flow:** Create data in Org A → log in as Org B → verify data not visible

---

## Work Stream 6: Database Hardening (5 items)

> **Risk:** Low-Medium — schema changes require migrations  
> **Gate:** typecheck ✓ + tests ✓ + migration applies cleanly

### 6.1 Add FK constraint: properties.googleConnectionId

- **File:** `src/shared/db/schema/property.schema.ts:18`
- **Change:** Add `.references(() => googleConnections.id, { onDelete: 'set null' })`
- **Migration:** `ALTER TABLE properties ADD CONSTRAINT ... FOREIGN KEY ...`

### 6.2 Add FK constraint: goals.parentGoalId

- **File:** `src/shared/db/schema/goal.schema.ts:46`
- **Change:** Add `.references(() => goals.id, { onDelete: 'cascade' })`
- **Note:** Self-referential FK — ensure no circular cascade

### 6.3 Wrap portal-link reorder in transactions

- **Files:** `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts:108-117,150-159`
- **Change:** Wrap `reorderCategories` and `reorderLinks` in `db.transaction()`

### 6.4 Wrap google-connection delete in transaction

- **File:** `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts:178-189`
- **Change:** Wrap `clearGoogleConnectionRef` + `db.delete` in `db.transaction()`

### 6.5 Add pagination LIMIT to unbounded list queries

- **Files:**
  - `notification-email.repository.ts:89-113` (findPendingByOrg) → add `.limit(500)`
  - `portal.repository.ts:67-84` (list/listByProperty) → add `.limit(200)`
  - `property.repository.ts:48-56` (list) → add `.limit(200)`
  - `goal.repository.ts:81-104` (list) → add `.limit(200)`
  - `gbp-import.repository.ts:24-33` (findByOrganization) → add `.limit(100)`

---

## Work Stream 7: Performance (4 items)

> **Risk:** Medium — changes to hot paths  
> **Gate:** typecheck ✓ + tests ✓ + manual verification

### 7.1 Parallelize fleet overview with bounded concurrency

- **File:** `src/contexts/dashboard/application/use-cases/get-fleet-overview.ts:54-103`
- **Change:** Replace unbounded `Promise.all(properties.map(...))` with chunked processing (5 properties at a time) or batch SQL queries

### 7.2 Move engagementFunnel into Promise.all batch

- **File:** `src/contexts/dashboard/application/use-cases/get-dashboard-data.ts:39-72`
- **Change:** Add engagementFunnel to the Promise.all array (7th element) instead of sequential await

### 7.3 Stagger hourly job schedules

- **File:** `src/worker/index.ts:103-170`
- **Change:** Use BullMQ cron patterns with minute offsets instead of `every: 3600000`:
  - Metrics refresh: `0 * * * *` (minute 0)
  - Badge reconcile: `10 * * * *` (minute 10)
  - Leaderboard reconcile: `20 * * * *` (minute 20)
  - Goal reconcile: `30 * * * *` (minute 30)
  - Digest notification: `0 * * * *` (stays at minute 0 — time-sensitive)

### 7.4 Add Vite manualChunks for recharts/dnd-kit

- **File:** `vite.config.ts`
- **Change:** Add `build.rollupOptions.output.manualChunks` to split heavy deps:
  ```ts
  manualChunks: {
    'vendor-charts': ['recharts'],
    'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
  }
  ```

---

## Work Stream 8: Architecture Cleanup (3 items)

> **Risk:** Low — consistency improvements  
> **Gate:** typecheck ✓ + tests ✓

### 8.1 Thread clock into goal repository

- **File:** `src/contexts/goal/infrastructure/repositories/goal.repository.ts:39,448,480,512`
- **Change:** Add `clock` parameter to `createGoalRepository(db, clock)`, use `clock()` for `lastComputedAt` writes
- **Update:** `composition.ts` and `build.ts` to pass clock

### 8.2 Move activity context ports to application/ports/

- **Files:** Move `src/contexts/activity/ports/*.ts` → `src/contexts/activity/application/ports/`
- **Also:** Move `activity-repository.drizzle.ts` → `infrastructure/repositories/activity.repository.ts`
- **Update:** All imports

### 8.3 Make timeRangeToDates now param required

- **Files:** `src/contexts/dashboard/application/utils.ts:13`, `src/contexts/leaderboard/application/utils.ts:16`
- **Change:** Remove default `now: Date = new Date()` — make it required
- **Verify:** All callers already pass `clock()` (confirmed by ArchTrack audit)

---

## Execution Order

Recommended order for minimal merge conflicts and logical progression:

```
1. WS-1 (Type Safety)     — 8 items, all independent, low risk
2. WS-6 (DB Hardening)    — 5 items, schema changes + migrations
3. WS-7 (Performance)     — 4 items, hot-path changes
4. WS-8 (Architecture)    — 3 items, file moves + refactors
5. WS-2 (Repo Tests)      — 3 items, may reveal bugs in WS-6/7/8 changes
6. WS-3 (Server Tests)    — 4 items
7. WS-4 (Domain Tests)    — 3 items
8. WS-5 (E2E)             — 3 items, highest risk of revealing integration bugs
```

**Each work stream = 1 PR.** Gate between each: typecheck + lint + tests + (E2E for WS-5).
