# Phase 2: Multi-Tenancy Hardening

**Goal**: Close all orgId gaps so every tenant-scoped table query includes `organizationId`. Replace `hasRole()` permission bypasses with proper `can()` calls. Add defense-in-depth tenant assertions to cross-session adapters.

**Prerequisite**: Phase 1 (security/data-integrity) must be merged first. Several Phase 1 fixes touch the same repository files (error handling, non-null assertions) and must land before tenant-scoping changes to avoid merge conflicts.

**Estimated total**: 13 fixes, ~3-4 developer-days.

---

## Sub-Phase 2A: Repository Tenant Scoping (Parallel Group)

These fixes touch disjoint files/contexts and can execute in parallel.

---

### Fix 2A-1: Notification Email Queue — Add orgId to All Methods

**Findings**: #67, #126
**Files**:

- `src/contexts/notification/application/ports/notification-email.repository.ts` (port interface)
- `src/contexts/notification/infrastructure/repositories/notification-email.repository.ts` (adapter)
- `src/contexts/notification/infrastructure/jobs/urgent-email.job.ts` (caller)
- `src/contexts/notification/infrastructure/event-handlers/on-notification-created.ts` (caller)
- Any other callers of `findById`, `markSent`, `markFailed`, `markSkipped`

**Complexity**: M

**Change**:

1. Add `orgId: OrganizationId` parameter to port methods: `findById(id, orgId)`, `markSent(id, orgId, sentAt, updatedAt)`, `markFailed(id, orgId, failedAt, updatedAt)`, `markSkipped(id, orgId, updatedAt)`.
2. In the Drizzle adapter, add `eq(notificationEmailQueue.organizationId, unbrand(orgId))` to every WHERE clause for those four methods.
3. Thread orgId from callers:
   - `urgent-email.job.ts` already has orgId in job data — pass it to `markSent`/`markFailed`/`markSkipped`.
   - `findById` callers: pass orgId from the job or event handler context.
   - For `findPendingUrgent` (cross-tenant by design, #NIT-2), add a `⚠️ CROSS-TENANT` comment matching the `review.repository.ts` convention, plus a `LIMIT 1000` clause to prevent unbounded row loading.

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/notification/
```

- Confirm `findById`, `markSent`, `markFailed`, `markSkipped` all have orgId in WHERE.
- Confirm `findPendingUrgent` has LIMIT 1000 and ⚠️ comment.

---

### Fix 2A-2: Goal Repository — Scope findAllActive + Port + Job Caller

**Findings**: #63, #65, #127
**Files**:

- `src/contexts/goal/application/ports/goal.repository.port.ts` (port)
- `src/contexts/goal/infrastructure/repositories/goal.repository.ts` (adapter)
- `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts` (caller)
- `src/contexts/goal/infrastructure/event-handlers/on-metric-recorded.ts` (caller, if it uses findAllActive)

**Complexity**: M

**Change**:

1. Add `organizationId: OrganizationId` parameter to `findAllActive` in the port.
2. In the adapter, add `eq(goals.organizationId, unbrand(organizationId))` to the WHERE clause.
3. Update `spawn-recurring-instances.job.ts`: iterate per-organization (get org list, call `findAllActive(orgId)` per org) or accept orgId from job data. The existing `findActiveRecurringTemplates(orgId)` method is already org-scoped — prefer it where possible.
4. Update `on-metric-recorded.ts` event handler: it already has orgId from the event — pass it.
5. For `upsertProgress` (TOCTOU race, D5 MAJOR): add `organizationId` into the upsert's WHERE via a JOIN on the goals table so the tenant check and write are atomic:
   ```ts
   .where(and(eq(goalProgress.goalId, unbrand(goalId)), eq(goals.organizationId, unbrand(organizationId))))
   // needs a JOIN or CTE through goals table
   ```

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/goal/
```

- Confirm `findAllActive` filters by orgId.
- Confirm `spawn-recurring-instances.job` passes orgId.
- Confirm `upsertProgress` tenant check is atomic (single query, not SELECT-then-UPDATE).

---

### Fix 2A-3: Goal Progress Table — Add organizationId Column (Defense-in-Depth)

**Findings**: #128
**Files**:

- `src/contexts/goal/infrastructure/db/schema.ts` (or equivalent Drizzle schema file for `goal_progress` table)
- `src/contexts/goal/infrastructure/mappers/goal.mapper.ts` (`goalProgressToInsertRow`)
- `src/contexts/goal/infrastructure/repositories/goal.repository.ts` (`getProgress`, `getProgressBatch`, `incrementProgress`)
- New Drizzle migration file

**Complexity**: L

**Change**:

1. Add `organizationId` column to the `goal_progress` Drizzle schema (nullable initially for migration, then NOT NULL with default after backfill).
2. Create a Drizzle migration: `ALTER TABLE goal_progress ADD COLUMN organization_id TEXT REFERENCES organizations(id)`.
3. Backfill: `UPDATE goal_progress gp SET organization_id = (SELECT organization_id FROM goals WHERE goals.id = gp.goal_id) WHERE organization_id IS NULL`.
4. Update `goalProgressToInsertRow` mapper to include `organizationId` from the parent goal.
5. Update `getProgress`, `getProgressBatch`, `incrementProgress`, `updateProgress` to JOIN on goals and filter by orgId, or add orgId to goal_progress WHERE once backfilled.
6. After backfill, make column NOT NULL.

**Verification**:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
npx vitest run src/contexts/goal/
```

- Confirm schema includes `organizationId` on `goal_progress`.
- Confirm all progress queries can filter by orgId.

---

### Fix 2A-4: Inbox Repository — Add orgId Guard to create()

**Findings**: #62
**Files**:

- `src/contexts/inbox/application/ports/inbox.repository.ts` (port)
- `src/contexts/inbox/infrastructure/repositories/inbox.repository.ts` (adapter)

**Complexity**: S

**Change**:

1. Add `orgId: OrganizationId` parameter to `create()` in the port: `create(item: InboxItem, orgId: OrganizationId): Promise<InboxItem>`.
2. In the adapter, add an assertion before insert matching the inbox-note repo pattern:
   ```ts
   if (item.organizationId !== orgId) {
     throw new Error(
       `InboxItem.create: tenant mismatch — item.orgId=${item.organizationId}, expected=${orgId}`,
     )
   }
   ```
   (Phase 1 should replace the `throw new Error` with a tagged `InboxError` — if Phase 1 landed, use `inboxError('forbidden', ...)` instead.)
3. Update all callers (use cases) to pass orgId.

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/inbox/
```

- Confirm `create()` accepts orgId and asserts tenant match.

---

### Fix 2A-5: Guest Interaction Repository — Add organizationId Assertion on Inserts

**Findings**: #131
**Files**:

- `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts`

**Complexity**: S

**Change**:

1. In `insertRating` and `insertFeedback`, add a non-null assertion:
   ```ts
   if (!rating.organizationId) throw guestError('forbidden', 'organizationId is required')
   ```
2. This is defense-in-depth — orgId is already resolved server-side from `resolvePortalContext`. The assertion catches programming errors where a domain object is constructed without orgId.

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/guest/
```

---

### Fix 2A-6: Property Repository — Document Cross-Tenant Methods

**Findings**: #66, #70
**Files**:

- `src/contexts/property/infrastructure/repositories/property.repository.ts`
- `src/contexts/property/application/ports/property.repository.ts`

**Complexity**: S

**Change**:

1. `findByGbpPlaceId`: Add `orgId?: OrganizationId` optional parameter. When provided, add `eq(properties.organizationId, unbrand(orgId))` to WHERE. Add JSDoc: `⚠️ CROSS-TENANT when orgId is omitted — caller MUST be JWT-verified (GBP webhook handler).`
2. `findBySlug`: Add JSDoc: `⚠️ CROSS-TENANT by design — public-facing guest portal resolution. Not for internal API use.` Add a port-level comment gating future callers.
3. Both already have inline comments explaining the design — formalize into JSDoc with ⚠️ markers matching the `review.repository.ts` convention.

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/property/
```

- Confirm optional orgId parameter works for `findByGbpPlaceId`.
- Confirm existing callers (GBP webhook, guest portal) still compile.

---

## Sub-Phase 2B: Identity Adapter Tenant Defense (Sequential)

Identity adapter changes depend on understanding better-auth's API capabilities. Do these after 2A.

---

### Fix 2B-1: Identity Adapter — Add Defensive Tenant Assertions

**Findings**: #68, #69, #70, #71
**Files**:

- `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts`

**Complexity**: M

**Change**:

1. **`listMembers`**: After fetching from better-auth, verify at least one member's orgId (if the API returns it) matches `ctx.organizationId`. If better-auth doesn't return orgId, add a comment documenting the reliance on session scoping.
2. **`getMember`**: After fetching the member list and finding the target member, verify the member's `organizationId` matches `ctx.organizationId`. If the API response includes orgId, assert. If not, document.
3. **`updateMemberRole` / `removeMember`**: Before mutation, call `getMember(ctx, memberId)` and verify `member.organizationId === ctx.organizationId`. If mismatch, throw an identity error.
4. **`createInvitation`**: If better-auth supports passing `organizationId` in the body, pass `ctx.organizationId`. Otherwise, add a comment documenting session-bound reliance.
5. Remove the `_ctx` prefix from all parameters where ctx is now used (i.e., `ctx` instead of `_ctx`).

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/identity/
```

- Confirm mutations verify tenant ownership before operating.
- Confirm `listMembers`/`getMember` have defensive assertions or documented reliance.

---

## Sub-Phase 2C: Permission Matrix Fixes (Parallel Group)

These are independent of the repository changes and can run in parallel with 2A/2B.

---

### Fix 2C-1: Inbox canAssign — Replace hasRole with can()

**Findings**: #62
**Files**:

- `src/contexts/inbox/domain/rules.ts`
- `src/shared/domain/permissions.ts` (if adding `inbox.assign` permission)

**Complexity**: S

**Change**:

1. Replace `hasRole(role, 'PropertyManager')` with `can(role, 'inbox.manage')`.
   - `inbox.manage` already exists in the permission matrix and grants AccountAdmin + PropertyManager (not Staff), which is the intended behavior.
   - Alternatively, define a new `inbox.assign` permission if assignment should be independently controllable.
2. Add a comment: `// Uses can() for permission gating, not hasRole() hierarchy check`.

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/inbox/
```

- Confirm `canAssign` uses `can(role, 'inbox.manage')`.

---

### Fix 2C-2: Identity Domain Rules — Comment hasRole Defense-in-Depth

**Findings**: #64
**Files**:

- `src/contexts/identity/domain/rules.ts`

**Complexity**: S

**Change**:

1. The calling use cases (`invite-member.ts`, `update-member-role.ts`) already perform `can()` checks. The `hasRole()` checks in rules.ts are redundant defense-in-depth.
2. Add explicit comments to lines 64 and 97:
   ```ts
   // Defense-in-depth: use case already gates with can(role, 'invitation.create').
   // This ensures the domain rule is independently enforceable even if called outside a use case.
   if (!hasRole(inviterRole, 'PropertyManager')) {
   ```
3. Lines 102 and 112 are legitimate hierarchy comparisons — no change needed.

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/identity/
```

---

### Fix 2C-3: Organization Read Permission — Replace dashboard.read

**Findings**: #62
**Files**:

- `src/contexts/identity/server/organizations.query.ts`
- `src/shared/domain/permissions.ts`

**Complexity**: S

**Change**:

1. Define `organization.read` permission in `permissions.ts`: grants AccountAdmin + PropertyManager + Staff (same as `dashboard.read` currently, but semantically correct for org data reads).
2. Replace `can(ctx.role, 'dashboard.read')` with `can(ctx.role, 'organization.read')` in `getActiveOrganization` server function.
3. Update CONTEXT.md permission section to document `organization.read`.

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/identity/
```

- Confirm `getActiveOrganization` uses `organization.read`.

---

### Fix 2C-4: UI Sidebar — Replace hasRole with can()

**Findings**: #129, #130
**Files**:

- `src/components/layout/settings-sidebar.tsx`
- `src/routes/_authenticated.tsx`

**Complexity**: S

**Change**:

1. `settings-sidebar.tsx:29`: Replace `hasRole(role, 'PropertyManager')` with `can(role, 'property.create')`.
2. `_authenticated.tsx:154`: Replace `hasRole(ctx.role, 'PropertyManager')` with `can(ctx.role, 'property.create')`.
3. `staff/build.ts:63`: Replace `hasRole(role, 'AccountAdmin')` with `can(role, 'organization.update')`.

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/staff/
```

- Visual regression: sidebar renders identically for AccountAdmin, PropertyManager, and Staff roles.

---

## Sub-Phase 2D: Activity Repository Cleanup (Independent)

---

### Fix 2D-1: Activity Repository — Fix unbrand and Role Validation

**Findings**: #158, #159, #160
**Files**:

- `src/contexts/activity/infrastructure/activity-repository.drizzle.ts`
- `src/contexts/activity/infrastructure/adapters/db-user-lookup.adapter.ts`

**Complexity**: S

**Change**:

1. Line 77: Replace `input.organizationId as string` with `unbrand(input.organizationId)`.
2. Extract a shared `VALID_ROLES` set from `shared/domain/roles.ts` (or a shared constants file). Both the repository and user-lookup adapter should import from the same source. Current inconsistency:
   - Repository: `['Staff', 'PropertyManager', 'AccountAdmin']`
   - User-lookup: `['Owner', 'Admin', 'PropertyManager', 'Staff']`
3. Add runtime validation for `action` and `resourceType` fields similar to how `actorRole` is validated with `VALID_ROLES`. Invalid DB values should throw, not silently cast.

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/activity/
```

---

### Fix 2D-2: Activity Adapters — Add Error Logging to Silent Catches

**Findings**: #161, #162
**Files**:

- `src/contexts/activity/infrastructure/adapters/db-user-lookup.adapter.ts`
- `src/contexts/activity/infrastructure/adapters/db-inbox-item-lookup.adapter.ts`

**Complexity**: S

**Change**:

1. `db-user-lookup.adapter.ts:46`: Replace bare `catch { return FALLBACK_USER }` with:
   ```ts
   catch (e) {
     getLogger().error({ err: e, userId, orgId }, 'User lookup failed, returning FALLBACK_USER')
     return FALLBACK_USER
   }
   ```
2. `db-inbox-item-lookup.adapter.ts:21`: Replace bare `catch { return null }` with:
   ```ts
   catch (e) {
     getLogger().error({ err: e, sourceId, orgId }, 'Inbox item lookup failed, returning null')
     return null
   }
   ```

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/activity/
```

---

### Fix 2D-3: Activity Event Handlers — Log Warning on Null inboxItemId

**Findings**: #163
**Files**:

- `src/contexts/activity/infrastructure/event-handlers/on-reply-published.ts`
- `src/contexts/activity/infrastructure/event-handlers/on-reply-submitted.ts`
- `src/contexts/activity/infrastructure/event-handlers/on-reply-approved.ts`
- `src/contexts/activity/infrastructure/event-handlers/on-reply-rejected.ts`

**Complexity**: S

**Change**:

1. In all four reply handlers, replace `if (!inboxItemId) return` with:
   ```ts
   if (!inboxItemId) {
     getLogger().warn(
       { eventId: event.eventId, replyId: event.replyId },
       'Reply event has no inboxItemId — skipping activity log',
     )
     return
   }
   ```

**Verification**:

```bash
npx tsc --noEmit
npx vitest run src/contexts/activity/
```

---

## Dependency Graph

```
Phase 1 (merged) ─┬─► 2A-1 (notification)     ─┐
                   ├─► 2A-2 (goal findAllActive)─┤
                   ├─► 2A-4 (inbox create)      ─┤  All parallel
                   ├─► 2A-5 (guest inserts)     ─┤
                   ├─► 2A-6 (property docs)     ─┤
                   ├─► 2C-1 (canAssign)         ─┤
                   ├─► 2C-2 (identity comments) ─┤
                   ├─► 2C-3 (org.read perm)     ─┤
                   ├─► 2C-4 (UI sidebar)        ─┤
                   ├─► 2D-1 (activity unbrand)  ─┤
                   ├─► 2D-2 (activity logging)  ─┤
                   └─► 2D-3 (activity handlers) ─┘
                            │
                   2A-2 ──►│──► 2A-3 (goal_progress column) — needs schema + migration
                            │
                   2A group ──► 2B-1 (identity adapter assertions) — after repos are stable
```

**Parallelization**: 2A-1 through 2A-6, 2C-1 through 2C-4, and 2D-1 through 2D-3 are all independent and can run as parallel agent tasks. 2A-3 (schema migration) depends on 2A-2. 2B-1 can start after 2A completes.

---

## Global Verification

After all fixes are applied:

```bash
# Type check
npx tsc --noEmit

# Full test suite
npx vitest run

# Lint
npx biome check src/

# Specific multi-tenancy verification:
# 1. Grep for bare hasRole in server/domain code (should only be in hierarchy comparisons)
# 2. Grep for cross-tenant methods without ⚠️ comment
# 3. Grep for bare catch {} blocks in adapters
```

### Regression Test Checklist

| Check                                   | How                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| No cross-tenant data leak in goals      | Create goals in Org A and Org B; confirm `findAllActive(orgA)` returns only Org A goals    |
| Notification email mutations are scoped | Send urgent email for Org A; confirm `markSent` only updates Org A rows                    |
| Inbox create rejects tenant mismatch    | Attempt to create inbox item with mismatched orgId; confirm assertion fires                |
| canAssign uses permission matrix        | Call assign with Staff role; confirm it returns false                                      |
| organization.read gates org data        | Call getActiveOrganization as Staff; confirm it succeeds                                   |
| UI sidebar renders correctly            | Render settings sidebar as AccountAdmin, PropertyManager, and Staff; confirm correct links |
| Activity logging is observable          | Trigger reply event with missing inboxItemId; confirm warning log appears                  |
