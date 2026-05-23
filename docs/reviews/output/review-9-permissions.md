# Code Review #9: Permissions & Authorization

**Date:** 2026-05-23
**Auditor:** Hermes Agent (automated)
**Scope:** Server-side (`contexts/*/server/`, `shared/auth/`), client-side (`components/`, `routes/`, `shared/hooks/`), domain layer (`shared/domain/permissions.ts`, `shared/domain/roles.ts`)

---

## Summary

The permission system is **well-structured overall**. The three-API architecture (`can()`, `usePermissions()`, `hasRole()`) is consistently followed. No boolean-prop drilling (`canEdit: boolean`) was found. No `toDomainRole()` double-mapping detected outside infrastructure adapters. However, several findings require attention — one critical gap where a use case lacks a permission check, and a semantic misuse where the wrong permission gates a read operation.

**Findings:** 2 BLOCKER, 2 MAJOR, 0 MINOR, 1 NIT

---

## Findings

### BLOCKER-1: `getImportStatus` use case has no permission check

**File:** `src/contexts/integration/application/use-cases/get-import-status.ts:15-27`
**Quote:**

```ts
export const getImportStatus =
  (deps: GetImportStatusDeps) =>
  async (input: ImportStatusInput, ctx: AuthContext): Promise<GbpImportJob> => {
    const importJobId = gbpImportJobId(input.importId)
    const job = await deps.importRepo.findById(ctx.organizationId, importJobId)
    // ... returns job directly
  }
```

**Rule:** "Client-side permission check without matching server-side check" / Every use case must authorize before acting.
**Fix:** Add `can(ctx.role, 'property.create')` guard at the top of the use case (matching the `startPropertyImport` use case which initiates the job). The import status endpoint is a follow-up to an import that was already authorized, but any authenticated user in the org can poll any import job by ID. Add:

```ts
if (!can(ctx.role, 'property.create')) {
  throw integrationError('forbidden', 'Insufficient permissions to view import status')
}
```

### BLOCKER-2: `listInvitations` gates listing with `invitation.create` instead of a read-specific permission

**File:** `src/contexts/identity/application/use-cases/list-invitations.ts:29`
**Quote:**

```ts
if (!can(ctx.role, 'invitation.create')) {
  throw identityError('forbidden', 'Insufficient role to view invitations')
}
```

**Rule:** "Permission strings hard-coded as bare literals instead of referencing permission constant/enum" is not the issue here — the issue is semantic: `listInvitations` is a **read** operation gated by `invitation.create`. This means a role that should be able to view invitations but not create them cannot do so. The permission statement has no `invitation.list` or `invitation.read`.
**Fix:** Either:

1. Add `'invitation.list'` to the `Permission` type and to the `statement` object in `shared/auth/permissions.ts`, grant it to AccountAdmin and PropertyManager, and use it here, OR
2. Document explicitly that viewing invitations is intentionally coupled to `invitation.create` (current behavior). Option 1 is recommended.

### MAJOR-1: `review.read` permission exists but is never checked server-side

**File:** `src/shared/auth/permissions.ts` (statement line 31), `src/shared/domain/permissions.ts:38`
**Detail:** The `review.read` permission is defined in the permission statement and granted to all three roles (AccountAdmin, PropertyManager, Staff). However, no server function or use case in the review context calls `can(ctx.role, 'review.read')`. Reviews are returned without any permission gate beyond authentication.
**Rule:** "Permission added but no role grants it (dead permission)" — inverse case: permission granted to all roles but never enforced. If review visibility should be org-scoped-only (authenticated = authorized), the permission is dead and should be removed. If there's a future intent to restrict review reading, add the check now.
**Fix:** Either add `can(ctx.role, 'review.read')` to review listing use cases, or remove `review.read` from the permission statement and `Permission` type to avoid confusion.

### MAJOR-2: `listGoogleConnections` has no `can()` permission check — relies solely on `hasRole` for data scoping

**File:** `src/contexts/integration/application/use-cases/list-google-connections.ts:13-21`
**Quote:**

```ts
export const listGoogleConnections =
  (deps: ListGoogleConnectionsDeps) =>
  async (ctx: AuthContext): Promise<ReadonlyArray<GoogleConnection>> => {
    const filter: ConnectionVisibilityFilter = hasRole(ctx.role, 'AccountAdmin')
      ? { showAll: true }
      : { showAll: false, userId: ctx.userId }
    return deps.connectionRepo.listByOrganization(ctx.organizationId, filter)
  }
```

**Rule:** `hasRole()` is for "Sidebar visibility, domain hierarchy rules" — not for permission checks. Staff has `integration.manage` = NOT granted, so Staff should not reach this use case at all. But there's no `can()` guard to enforce that. The `hasRole` only affects visibility filtering, not authorization.
**Fix:** Add an authorization guard:

```ts
if (!can(ctx.role, 'integration.manage')) {
  throw integrationError('forbidden', 'Insufficient permissions to view connections')
}
```

Then keep the `hasRole` for the visibility filter (this is legitimate data-scoping, not authorization).

### NIT-1: `role === 'AccountAdmin'` in `RoleBadge` component

**File:** `src/components/features/identity/shared/role-badge.tsx:12-16`
**Quote:**

```ts
const variant =
  role === 'AccountAdmin'
    ? 'default'
    : role === 'PropertyManager'
      ? 'secondary'
      : 'outline'
```

**Detail:** Uses string equality on role for visual styling. This is purely presentational (badge color), not authorization. The `role` value is already typed as `Role` so this is type-safe. Not a blocker, but could use a map object for clarity.
**Fix:** Consider replacing with a `roleVariantMap: Record<Role, BadgeVariant>` for extensibility if roles are added later.

---

## Areas Audited (✓ = clean)

| Area                                 | Files Scanned | `can()` Guards                                                                                    | Status                                                       |
| ------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Identity server (`organizations.ts`) | 1             | `dashboard.read`, `member.list` + use cases                                                       | ✓ Clean                                                      |
| Identity use cases (6 files)         | 6             | `organization.update`, `invitation.create`, `invitation.resend`, `member.delete`, `member.update` | ✓ Clean (except list-invitations semantic)                   |
| Property server + use cases          | 5             | `property.create`, `property.update`, `property.delete` + staff scoping                           | ✓ Clean                                                      |
| Staff server + use cases             | 3             | `staff_assignment.create`, `staff_assignment.delete` + self-assignment guard                      | ✓ Clean                                                      |
| Portal use cases                     | ~6            | `portal.create`, `portal.update`, `portal.delete`                                                 | ✓ Clean                                                      |
| Team use cases                       | ~4            | `team.create`, `team.update`, `team.delete`                                                       | ✓ Clean                                                      |
| Integration use cases                | 7             | `integration.manage`, `property.create`                                                           | ⚠ `getImportStatus` missing, `listGoogleConnections` missing |
| Review use cases                     | ~5            | `review.reply`, `reply.manage`                                                                    | ✓ Clean (but `review.read` unused)                           |
| Inbox use cases                      | ~5            | `inbox.read`, `inbox.update` + staff scoping via `StaffPublicApi`                                 | ✓ Clean                                                      |
| Feedback use cases                   | ~3            | `feedback.read`, `feedback.respond`                                                               | ✓ Clean                                                      |
| Route `beforeLoad` guards            | 22            | `portal.create`, `organization.update`, etc.                                                      | ✓ Clean                                                      |
| Component `usePermissions()`         | 11            | `portal.update`, `reply.manage`, `member.update`, `member.delete`                                 | ✓ Clean                                                      |
| `hasRole()` usage                    | 3             | Sidebar nav, connection visibility                                                                | ✓ Clean (used for hierarchy/nav only)                        |
| Boolean prop drilling                | 0 found       | N/A                                                                                               | ✓ Clean                                                      |
| `toDomainRole()` double-mapping      | 0 found       | N/A — only in infrastructure adapters                                                             | ✓ Clean                                                      |

---

## Permission Matrix

Legend: ✓ = granted AND enforced | ○ = granted but NOT enforced | ✗ = not granted | — = not applicable

| Permission                | AccountAdmin | PropertyManager | Staff | Enforced Where                                                                                                                      |
| ------------------------- | ------------ | --------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `organization.update`     | ✓            | ✓               | ✗     | Server: `updateOrganization`, `requestOrgLogoUpload`, `finalizeOrgLogoUpload`. Route: `/settings/organization` beforeLoad           |
| `organization.delete`     | ✓            | ✗               | ✗     | Server: use case (owner-only per role definition)                                                                                   |
| `member.create`           | ✓            | ✗               | ✗     | Server: `inviteMember` use case                                                                                                     |
| `member.list`             | ✓            | ✓               | ✗     | Server: `listMembers` in `organizations.ts`                                                                                         |
| `member.update`           | ✓            | ✗               | ✗     | Server: `updateMemberRole` use case. Client: `member-table.tsx`                                                                     |
| `member.delete`           | ✓            | ✗               | ✗     | Server: `removeMember` use case. Client: `member-table.tsx`                                                                         |
| `invitation.create`       | ✓            | ✓               | ✗     | Server: `inviteMember`, `listInvitations` (semantic issue)                                                                          |
| `invitation.cancel`       | ✓            | ✓               | ✗     | Defined but no cancel use case found (not yet implemented?)                                                                         |
| `invitation.resend`       | ✓            | ✓               | ✗     | Server: `resendInvitation` use case                                                                                                 |
| `property.create`         | ✓            | ✓               | ✗     | Server: `createProperty`, `startPropertyImport`, `listGbpLocations`. Route: portal/new beforeLoad                                   |
| `property.update`         | ✓            | ✓               | ✗     | Server: `updateProperty` use case                                                                                                   |
| `property.delete`         | ✓            | ✗               | ✗     | Server: `deleteProperty` use case                                                                                                   |
| `team.create`             | ✓            | ✓               | ✗     | Server: use case                                                                                                                    |
| `team.update`             | ✓            | ✓               | ✗     | Server: use case                                                                                                                    |
| `team.delete`             | ✓            | ✗               | ✗     | Server: use case                                                                                                                    |
| `staff_assignment.create` | ✓            | ✓               | ✗     | Server: `createStaffAssignment`                                                                                                     |
| `staff_assignment.delete` | ✓            | ✓               | ✗     | Server: use case                                                                                                                    |
| `ac.create`               | ✓            | ✗               | ✗     | (Access control — admin only)                                                                                                       |
| `ac.read`                 | ✓            | ✗               | ✗     |                                                                                                                                     |
| `ac.update`               | ✓            | ✗               | ✗     |                                                                                                                                     |
| `ac.delete`               | ✓            | ✗               | ✗     |                                                                                                                                     |
| `portal.create`           | ✓            | ✓               | ✗     | Server: use case. Route: `/portals/new` beforeLoad                                                                                  |
| `portal.update`           | ✓            | ✓               | ✗     | Server: use case. Client: `sortable-category.tsx`, portal components                                                                |
| `portal.delete`           | ✓            | ✗               | ✗     | Server: use case                                                                                                                    |
| `review.read`             | ✓            | ✓               | ✓     | **○ NOT ENFORCED** — no `can()` check in review listing use cases                                                                   |
| `review.reply`            | ✓            | ✓               | ✗     | Server: `replyOperations` use case                                                                                                  |
| `reply.manage`            | ✓            | ✓               | ✗     | Server: reply use cases. Client: `inbox-detail-content.tsx` gates ReplyEditor                                                       |
| `inbox.read`              | ✓            | ✓               | ✓     | Server: `getInboxItems` use case                                                                                                    |
| `inbox.update`            | ✓            | ✓               | ✓     | Server: `updateInboxStatus`, `bulkUpdateInboxStatus`                                                                                |
| `feedback.read`           | ✓            | ✓               | ✗     | Server: feedback use cases                                                                                                          |
| `feedback.respond`        | ✓            | ✓               | ✗     | Server: feedback use cases                                                                                                          |
| `integration.manage`      | ✓            | ✓               | ✗     | Server: `connectGoogleAccount`, `disconnectGoogleAccount`, `updateConnectionVisibility`. **NOT checked in `listGoogleConnections`** |
| `dashboard.read`          | ✓            | ✓               | ✓     | Server: `getActiveOrganization`                                                                                                     |

### Highlights

1. **`review.read`** — Granted to ALL roles but never enforced. Any authenticated user can read reviews. This is either intentional (reviews are org-public) or a gap. Marked as **granted but not enforced**.

2. **`invitation.cancel`** — Granted to AccountAdmin and PropertyManager, but no cancel invitation use case exists. This is **granted but no enforcement point** (dead permission until the feature is built).

3. **`listGoogleConnections`** — `integration.manage` is NOT checked. Staff could potentially call this endpoint and see their own connections. Marked as **enforced but not at entry point** (MAJOR-2).

---

## Architecture Assessment

### What's Working Well

- **Clean separation of concerns**: `can()` in server/use-case layer, `usePermissions()` in React components, `hasRole()` only for hierarchy/navigation.
- **No boolean prop drilling**: All components call `usePermissions().can()` directly — zero instances of `canEdit: boolean` prop passing.
- **`toDomainRole()` used correctly**: Only in infrastructure adapters (`auth-identity.adapter.ts`) and server boundary (`organizations.ts:172`) to map better-auth roles → domain roles. Not called on already-mapped domain roles.
- **Staff property scoping**: `StaffPublicApi.getAccessiblePropertyIds` correctly returns `null` for AccountAdmin (all properties) and filters for other roles.
- **Permission table injection**: `setPermissionLookup()` pattern keeps `shared/domain` pure while enabling O(1) lookups.
- **Type-safe permissions**: `Permission` union type prevents typos and ensures autocomplete.

### Action Items

| Priority | Finding                                                                   | Effort    |
| -------- | ------------------------------------------------------------------------- | --------- |
| BLOCKER  | Add `can()` guard to `getImportStatus`                                    | 3 lines   |
| BLOCKER  | Add `invitation.list` permission or document `invitation.create` coupling | 1–2 files |
| MAJOR    | Add `can(ctx.role, 'integration.manage')` to `listGoogleConnections`      | 3 lines   |
| MAJOR    | Decide: enforce `review.read` or remove it                                | 1–3 files |
| NIT      | Refactor `RoleBadge` to use a map                                         | 5 lines   |

---

## Files Reviewed

- `src/shared/domain/permissions.ts` — Permission type + `can()` function
- `src/shared/domain/roles.ts` — Role type + `hasRole()` function
- `src/shared/auth/permissions.ts` — Permission statement + role grants + `initPermissionTable()`
- `src/shared/auth/middleware.ts` — `resolveTenantContext()`
- `src/shared/hooks/usePermissions.ts` — Client-side permission hook
- `src/shared/domain/auth-context.ts` — `AuthContext` type
- `src/composition.ts` — DI container
- `src/routes/_authenticated.tsx` — Auth route layout + context
- `src/contexts/identity/server/organizations.ts` — Identity server functions
- `src/contexts/identity/application/use-cases/*.ts` — 6 identity use cases
- `src/contexts/property/server/properties.ts` — Property server functions
- `src/contexts/property/application/use-cases/*.ts` — Property use cases
- `src/contexts/staff/server/staff-assignments.ts` — Staff server functions
- `src/contexts/staff/application/use-cases/create-staff-assignment.ts`
- `src/contexts/integration/server/gbp-import.ts` — Integration server functions
- `src/contexts/integration/server/google-connections.ts`
- `src/contexts/integration/application/use-cases/*.ts` — 7 integration use cases
- `src/contexts/review/server/reply.ts` — Review reply server functions
- `src/contexts/review/application/use-cases/reply-operations.ts`
- `src/contexts/inbox/build.ts` — Inbox context wiring
- `src/contexts/staff/build.ts` — Staff context + `getAccessiblePropertyIds`
- `src/components/layout/settings-sidebar.tsx` — `hasRole()` usage (sidebar nav)
- `src/components/features/identity/shared/role-badge.tsx` — Role badge (visual only)
- `src/components/features/identity/member-directory/member-table.tsx` — Member table
- `src/components/features/portal/link-tree/sortable-category.tsx` — Portal editing
- `src/components/inbox/inbox-detail-content.tsx` — Reply editor gating
- 22 route files with `beforeLoad` guards
- `docs/adr/0001-dynamic-access-control.md`
