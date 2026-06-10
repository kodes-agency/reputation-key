# Permission Matrix & Tenant Isolation Review

**Date**: 2026-06-10
**Scope**: `src/shared/domain/permissions.ts`, `src/shared/auth/permissions.ts`, all server/ files, all repository files
**Reviewer**: automated deep review

---

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 2     |
| MAJOR    | 5     |
| MINOR    | 4     |
| NIT      | 2     |

---

## Permission Matrix

### Defined Permissions (46 total)

| Permission              | AccountAdmin (owner) | PropertyManager (admin) | Staff (member) |
| ----------------------- | -------------------- | ----------------------- | -------------- |
| organization.update     | ✅                   | ✅                      | ❌             |
| organization.delete     | ✅                   | ❌                      | ❌             |
| member.create           | ✅                   | ✅                      | ❌             |
| member.list             | ✅                   | ✅                      | ❌             |
| member.update           | ✅                   | ❌                      | ❌             |
| member.delete           | ✅                   | ❌                      | ❌             |
| invitation.create       | ✅                   | ✅                      | ❌             |
| invitation.list         | ✅                   | ✅                      | ❌             |
| invitation.cancel       | ✅                   | ✅                      | ❌             |
| invitation.resend       | ✅                   | ✅                      | ❌             |
| property.create         | ✅                   | ✅                      | ❌             |
| property.read           | ✅                   | ✅                      | ✅             |
| property.update         | ✅                   | ✅                      | ❌             |
| property.delete         | ✅                   | ❌                      | ❌             |
| team.create             | ✅                   | ✅                      | ❌             |
| team.read               | ✅                   | ✅                      | ✅             |
| team.update             | ✅                   | ✅                      | ❌             |
| team.delete             | ✅                   | ❌                      | ❌             |
| staff_assignment.create | ✅                   | ✅                      | ❌             |
| staff_assignment.read   | ✅                   | ✅                      | ✅             |
| staff_assignment.delete | ✅                   | ✅                      | ❌             |
| ac.create               | ✅                   | ❌                      | ❌             |
| ac.read                 | ✅                   | ❌                      | ❌             |
| ac.update               | ✅                   | ❌                      | ❌             |
| ac.delete               | ✅                   | ❌                      | ❌             |
| portal.create           | ✅                   | ✅                      | ❌             |
| portal.read             | ✅                   | ✅                      | ✅             |
| portal.update           | ✅                   | ✅                      | ❌             |
| portal.delete           | ✅                   | ❌                      | ❌             |
| review.read             | ✅                   | ✅                      | ✅             |
| reply.manage            | ✅                   | ✅                      | ❌             |
| inbox.read              | ✅                   | ✅                      | ✅             |
| inbox.write             | ✅                   | ✅                      | ✅             |
| inbox.manage            | ✅                   | ✅                      | ❌             |
| feedback.read           | ✅                   | ✅                      | ❌             |
| feedback.respond        | ✅                   | ✅                      | ❌             |
| integration.manage      | ✅                   | ✅                      | ❌             |
| identity.avatar_upload  | ✅                   | ✅                      | ✅             |
| identity.logo_upload    | ✅                   | ✅                      | ❌             |
| identity.leave_org      | ✅                   | ✅                      | ✅             |
| dashboard.read          | ✅                   | ✅                      | ✅             |
| goal.read               | ✅                   | ✅                      | ✅             |
| goal.create             | ✅                   | ✅                      | ✅             |
| goal.update             | ✅                   | ✅                      | ❌             |
| goal.cancel             | ✅                   | ✅                      | ❌             |

### Unused Permissions (defined but zero `can()` calls in server/use-case code)

- `organization.delete` — reserved, no callers
- `ac.*` (create/read/update/delete) — reserved, no callers
- `feedback.read` — reserved, no callers
- `feedback.respond` — reserved, no callers
- `identity.leave_org` — reserved, no callers

---

## Findings

### BLOCKER-1: `canAssign()` in inbox domain rules uses `hasRole()` instead of `can()`

````
[PERMISSIONS] BLOCKER canAssign() uses hasRole() hierarchy check, bypassing permission matrix
  File: src/contexts/inbox/domain/rules.ts:42-44
  Quote: ```ts
  export const canAssign = (role: Role): boolean => {
    return hasRole(role, 'PropertyManager')
  }
````

Rule: "hasRole() for hierarchy only, can() for permission checks"
Fix: Replace with `can(role, 'inbox.manage')` or add a dedicated `inbox.assign` permission.
The `hasRole()` call means a future role restructure could grant PropertyManager a
different permission set while this function still grants assignment based on hierarchy
alone, creating a policy gap.

```

### BLOCKER-2: `organizations.query.ts` uses `dashboard.read` permission for org data read

```

[PERMISSIONS] BLOCKER getActiveOrganization uses wrong permission for org read
File: src/contexts/identity/server/organizations.query.ts:26
Quote: ```ts
if (!can(ctx.role, 'dashboard.read')) {

```
Rule:  "All new use cases must define a permission" — reusing dashboard.read for organization
       read conflates two unrelated resources. Staff can read the dashboard but the intent here
       is to gate org data reads. If dashboard.read semantics change, org reads break silently.
Fix:   Use `organization.update` (already grants AccountAdmin + PropertyManager, same effective
       set as intended) or define a new `organization.read` permission.
```

### MAJOR-1: `hasRole()` used for permission gating in identity domain rules

````
[PERMISSIONS] MAJOR canInviteWithRole / canChangeRole use hasRole() instead of can()
  File: src/contexts/identity/domain/rules.ts:64,97,102,112
  Quote: ```ts
  if (!hasRole(inviterRole, 'PropertyManager')) {
  if (!hasRole(changerRole, 'PropertyManager')) {
  if (hasRole(currentTargetRole, changerRole)) {
  if (!hasRole(changerRole, newTargetRole)) {
````

Rule: "hasRole() for hierarchy only" — Per architecture, `hasRole()` is for role hierarchy
checks only. The first two checks (`!hasRole(inviterRole, 'PropertyManager')`) are
effectively permission gates that should use `can(role, 'invitation.create')` and
`can(role, 'member.update')`. The latter two checks (lines 102, 112) are legitimate
hierarchy comparisons (can user X change user Y's role), so those are acceptable uses.
Fix: Move the permission check to the use-case layer using `can()` before calling these
domain rules. The domain rules should only contain the hierarchy comparison logic
(lines 102, 112). The calling use cases (invite-member.ts, update-member-role.ts)
already perform `can()` checks, making the `hasRole()` checks in rules.ts partially
redundant — but the redundancy means the domain rule is independently enforceable.
Recommend: keep as defense-in-depth but add a comment clarifying the intent.

```

### MAJOR-2: `notification-email.repository.ts` — `findById`, `markSent`, `markFailed`, `markSkipped` lack organizationId

```

[TENANT] MAJOR Notification email queue mutations/query by ID without organizationId
File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:68-76,112-151
Quote: ```ts
findById: async (id: string): Promise<NotificationEmail | null> => {
const rows = await db.select().from(notificationEmailQueue)
.where(eq(notificationEmailQueue.id, id)).limit(1)

markSent: async (id: string, sentAt: Date, updatedAt: Date): Promise<void> => {
await db.update(notificationEmailQueue)
.set({ status: 'sent', sentAt, updatedAt })
.where(and(eq(notificationEmailQueue.id, id), inArray(...)))

markFailed: async (id: string, failedAt: Date, updatedAt: Date): Promise<void> => { ... }
markSkipped: async (id: string, updatedAt: Date): Promise<void> => { ... }

```
Rule:  "Every repository query filters by organization_id" — findById, markSent, markFailed,
       markSkipped all operate on ID alone without orgId. A background job worker processing
       one org's emails could theoretically mutate another org's email queue entry if IDs
       collide or if job payloads are tampered with.
Fix:   Add orgId parameter to all four methods and include `eq(notificationEmailQueue.organizationId, orgId)`
       in the WHERE clause. The urgent-email.job.ts already has orgId from the job data —
       thread it through to these methods.
```

### MAJOR-3: `goal.repository.ts` — `findAllActive()` queries all tenants without orgId filter

````
[TENANT] MAJOR findAllActive queries across all organizations
  File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:179-184
  Quote: ```ts
  findAllActive: async () => {
    return trace('goal.findAllActive', async () => {
      const rows = await db.select().from(goals).where(eq(goals.status, 'active'))
      return rows.map(goalFromRow)
    })
  },
````

Rule: "Every repository query filters by organization_id" — No orgId parameter or filter.
The `findActiveGoalsByMetric` caller (event handler `on-metric-recorded.ts`) gets
the orgId from the event, so it could filter further, but `findAllActive` itself
returns goals across all orgs. Cross-tenant data leak risk if a consumer doesn't
re-filter.
Fix: Rename to `findAllActiveAcrossTenants` and add a ⚠️ comment matching the pattern in
`review.repository.ts`. Or add `organizationId` parameter and filter by it. The
event handler already has orgId available.

```

### MAJOR-4: `goal.repository.ts` — `getProgress`, `getProgressBatch`, `updateProgress`, `incrementProgress` lack orgId

```

[TENANT] MAJOR Goal progress queries operate on goalId alone without orgId
File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:133-175,279-352
Quote: ```ts
getProgress: async (goalId) => {
const rows = await db.select().from(goalProgress)
.where(eq(goalProgress.goalId, goalId)).limit(1)

getProgressBatch: async (goalIds) => {
const rows = await db.select().from(goalProgress)
.where(inArray(goalProgress.goalId, [...goalIds] as string[]))

incrementProgress: async (goalId, aggregation, delta) => {
const result = await db.update(goalProgress)
.set({ currentValue: sql`...` })
.where(eq(goalProgress.goalId, goalId))

```
Rule:  "Every repository query filters by organization_id" — These methods assume goalId is
       globally unique (UUID), so they skip orgId. The code comments say "Safe: goalId is a
       globally unique UUID — no cross-tenant risk". This is an acceptable defense IF goalIds
       are truly unguessable UUIDs. However, `incrementProgress` is a mutation, and the
       goalProgress table has no `organizationId` column at all, so there is no way to add
       tenant filtering even if desired.
Fix:   Low urgency but add `organizationId` column to `goal_progress` table for defense-in-depth.
       The goal table itself has orgId — add a FK-level orgId to progress for consistency.
```

### MAJOR-5: `settings-sidebar.tsx` — `hasRole()` used for UI routing decision

````
[PERMISSIONS] MAJOR Settings sidebar uses hasRole() for navigation routing
  File: src/components/layout/settings-sidebar.tsx:29
  Quote: ```ts
  const isManager = hasRole(role, 'PropertyManager')
````

Rule: "hasRole() for hierarchy only" — Used only for "Back to app" link target
(`/properties` vs `/`). Not a security issue (no data gating), but violates the
convention that UI should use `can()` for feature visibility.
Fix: Replace with `const isManager = can('property.create')` to align with convention.
Also in `src/routes/_authenticated.tsx:154` for the sidebar selection logic.

```

### MINOR-1: `_authenticated.tsx` route uses `hasRole()` for sidebar selection

```

[PERMISSIONS] MINOR Route layout uses hasRole() for sidebar selection
File: src/routes/\_authenticated.tsx:154
Quote: ```ts
} : hasRole(ctx.role, 'PropertyManager') ? (
<ManagerSidebar properties={properties} />

```
Rule:  "hasRole() for hierarchy only, can() for permission checks" — Used for UI layout
       selection. Not a security gate (no data exposure), but deviates from convention.
Fix:   Replace with `can(ctx.role, 'property.create')` for consistency.
```

### MINOR-2: `staff/build.ts` uses `hasRole()` for data access scoping

````
[PERMISSIONS] MINOR Staff build.ts uses hasRole() for data scoping
  File: src/contexts/staff/build.ts:63
  Quote: ```ts
  if (hasRole(role, 'AccountAdmin')) return null
````

Rule: "hasRole() for hierarchy only" — This is a performance optimization: AccountAdmin sees
all properties, so skip the DB query. Semantically correct (hierarchy-based shortcut),
but the permission check `can(role, 'organization.update')` would be more future-proof.
Fix: Replace with `if (can(role, 'organization.update')) return null` — matches the
same pattern used in `activity/queries/get-activity-timeline.ts:38`.

```

### MINOR-3: Component files use local `canEdit`/`canManage` boolean variables derived from `can()`

```

[PERMISSIONS] MINOR Components derive canEdit/canManage booleans from can()
File: src/components/features/portal/link-tree/sortable-category.tsx:48
File: src/components/features/portal/link-tree/sortable-link.tsx:30
File: src/components/features/portal/link-tree/link-tree-category-list.tsx:67
File: src/components/features/inbox/inbox-detail-content.tsx:42
File: src/components/features/identity/member-directory/invitation-table.tsx:52
Quote: ```ts
const canEdit = can('portal.update')
const canManageReplies = can('reply.manage')
const canManage = can('invitation.cancel')

```
Rule:  "Passing canEdit/canCreate booleans as props — use usePermissions() in the component"
       (from components/CONTEXT.md:120). These are derived inside the component using
       usePermissions(), which is the correct pattern — not passed as props.
Fix:   No fix needed. These are compliant — the rule prohibits passing booleans as props,
       not deriving them locally. Flagging for completeness as the naming mirrors the
       anti-pattern documented in CONTEXT.md.
```

### MINOR-4: `activity-repository.drizzle.ts` line 77 — unsafe cast of organizationId

````
[TENANT] MINOR Activity repository casts organizationId to string
  File: src/contexts/activity/infrastructure/activity-repository.drizzle.ts:77
  Quote: ```ts
  eq(activityLog.organizationId, input.organizationId as string),
````

Rule: "Branded IDs, type safety" — Casts branded OrganizationId to string instead of using
`unbrand()`. Works at runtime but defeats the branded type system.
Fix: Use `unbrand(input.organizationId)` for consistency with all other repositories.

```

### NIT-1: `role-badge.tsx` uses string equality for display logic

```

[PERMISSIONS] NIT role-badge.tsx uses role string equality for visual styling
File: src/components/features/identity/shared/role-badge.tsx:12-14
Quote: ```ts
role === 'AccountAdmin'
? 'default'
: role === 'PropertyManager'

```
Rule:  Not a security issue — purely visual styling. But uses raw string comparison
       instead of `hasRole()`. Acceptable for UI rendering.
Fix:   None required. Cosmetic only.
```

### NIT-2: `findPendingUrgent` in notification-email.repository.ts lacks orgId filter

````
[TENANT] NIT findPendingUrgent queries across all orgs (background job use)
  File: src/contexts/notification/infrastructure/repositories/notification-email.repository.ts:97-110
  Quote: ```ts
  findPendingUrgent: async (): Promise<NotificationEmail[]> => {
    const rows = await db.select().from(notificationEmailQueue)
      .where(and(eq(...status, 'pending'), eq(...priority, 'urgent')))
      .orderBy(asc(notificationEmailQueue.createdAt))
    return rows.map(emailFromRow)
  },
````

Rule: "Every repository query filters by organization_id" — Cross-tenant query. This is
a background job processor that picks up urgent emails across all orgs. By design
(the urgent-email job processes one email at a time by ID). Low risk but should
have a ⚠️ comment like the review repository's cross-tenant methods.
Fix: Add a `⚠️ CROSS-TENANT` comment matching the convention in `review.repository.ts:130`.

```

---

## Tenant Isolation Assessment

### Positive Findings

1. **`baseWhere()` enforcement**: All core repositories (property, portal, team, staff-assignment, portal-link, portal-group) use `baseWhere(table, orgId)` which enforces both `organizationId` and `deleted_at IS NULL`. This is the primary defense and is consistently applied.

2. **`resolveTenantContext()` pattern**: Every server function resolves `organizationId` from the authenticated session via `resolveTenantContext(headers)`, never from the request body. The one exception is `setActiveOrganization` which passes `body: { organizationId: data.organizationId }` to better-auth's API — this is correct because better-auth validates the user's membership in the target org before switching.

3. **Branded IDs**: `OrganizationId` is a branded type (`Brand<string, 'OrganizationId'>`), preventing accidental substitution with arbitrary strings.

4. **Review repository**: Cross-tenant methods (`findAllExpiringBeforeAcrossTenants`, `findAllExpiredBeforeAcrossTenants`) are explicitly documented with ⚠️ warnings and restricted to background job use.

5. **Public API pattern**: Cross-context data access goes through PublicApi interfaces (e.g., `PropertyPublicApi`, `StaffPublicApi`), which enforce orgId at the API boundary.

### Gaps

1. **Notification email queue**: `findById`, `markSent`, `markFailed`, `markSkipped` operate by ID without orgId (see MAJOR-2).
2. **Goal repository**: `findAllActive` scans all orgs (see MAJOR-3); progress methods use only `goalId` (see MAJOR-4).
3. **No `organizationId` column on `goal_progress`**: The goal_progress table cannot be tenant-filtered even if desired.

### organizationId Source Verification

| Server function pattern | orgId source | Verified |
|---|---|---|
| All `resolveTenantContext(headers)` calls | Auth session | ✅ |
| `setActiveOrganization` | Request body → better-auth validates membership | ✅ |
| Background jobs (notification, goal metric) | Job payload from events | ✅ |
| Public guest endpoints | `resolvePortalContext` (portal slug → org) | ✅ |

No server function was found that accepts `organizationId` from unvalidated request body for data mutation.
```
