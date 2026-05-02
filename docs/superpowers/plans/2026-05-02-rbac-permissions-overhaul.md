# RBAC Permissions Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the double-mapping bug that degrades all users to `Staff`, enable better-auth dynamic access control for custom roles, and unify the permission API to `can()` everywhere.

**Architecture:** Three-phase approach — (1) fix the immediate bug in `_authenticated.tsx`, (2) flip the `dynamicAccessControl` flag in better-auth config, (3) create `usePermissions()` hook and replace all `hasRole()` / `canEdit` / `canCreate` prop drilling with `can()` calls. Phase 4 (Admin UI) is deferred to a future session.

**Tech Stack:** React, TanStack Router, TanStack Start, better-auth (organization plugin + `createAccessControl`), TypeScript

**Rule:** All file interactions MUST use context-mode MCP tools (`ctx_batch_execute`, `ctx_execute`, `ctx_execute_file`, `ctx_search`). No raw `cat`/`Read` for analysis. `Read` is acceptable only when immediately followed by `Edit` on the same file.

---

## File Structure

| File                                                                     | Action | Responsibility                                                   |
| ------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------- |
| `src/routes/_authenticated.tsx`                                          | Modify | Fix double-mapping, remove debug logs                            |
| `src/shared/auth/auth.ts`                                                | Modify | Enable `dynamicAccessControl`                                    |
| `src/shared/hooks/usePermissions.ts`                                     | Create | Client-side `can()` hook                                         |
| `src/shared/domain/roles.ts`                                             | Keep   | `hasRole()` stays for hierarchy-only use (sidebar, domain rules) |
| `src/shared/auth/permissions.ts`                                         | Keep   | Statement + role definitions unchanged                           |
| `src/shared/domain/permissions.ts`                                       | Keep   | `can()` function unchanged                                       |
| `src/routes/_authenticated/dashboard.tsx`                                | Modify | Replace `hasRole()` with `usePermissions()`                      |
| `src/routes/_authenticated/properties/index.tsx`                         | Modify | Replace `hasRole()` with `usePermissions()`                      |
| `src/routes/_authenticated/properties/new.tsx`                           | Modify | Replace `hasRole()` in `beforeLoad` with `can()`                 |
| `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`     | Modify | Replace `hasRole()` with `usePermissions()`                      |
| `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx` | Modify | Replace `canEdit` prop with `usePermissions()`                   |
| `src/components/features/portal/PortalDetailPage.tsx`                    | Modify | Replace `canEdit` prop with `usePermissions()`                   |
| `src/components/features/portal/EditPortalForm.tsx`                      | Modify | Replace `canEdit` prop with `usePermissions()`                   |
| `src/components/layout/AppSidebar.tsx`                                   | Keep   | `hasRole()` for hierarchy (sidebar visibility) — stays           |
| `src/contexts/identity/domain/rules.ts`                                  | Keep   | `hasRole()` for hierarchy (domain rules) — stays                 |
| `src/contexts/staff/application/use-cases/create-staff-assignment.ts`    | Keep   | `hasRole()` for hierarchy — stays                                |

---

## Phase 1 — Bug Fix (Immediate)

### Task 1: Fix double-mapping in `_authenticated.tsx`

**Files:**

- Modify: `src/routes/_authenticated.tsx`

**Context:** `getActiveOrganization()` calls `resolveTenantContext()`, which already maps `owner` → `AccountAdmin` via `toDomainRole()`. Then `beforeLoad` calls `toDomainRole(org.role)` again. `toDomainRole("AccountAdmin")` hits the `default` branch → returns `"Staff"`. The fix is to use `org.role` directly since it's already a domain role.

- [ ] **Step 1: Read the current file for editing**

Use context-mode `ctx_execute_file` to confirm the current state, then `Read` the file for the Edit tool.

- [ ] **Step 2: Fix the double-mapping**

Remove the `toDomainRole` import and the second mapping call. `org.role` is already a domain role from `resolveTenantContext()`.

Change the `beforeLoad` in `src/routes/_authenticated.tsx`:

```typescript
// REMOVE this import:
import { toDomainRole } from '#/shared/domain/roles'

// In beforeLoad, REPLACE:
//   if (org.role) {
//     role = toDomainRole(org.role)
//   }
// WITH:
//   if (org.role) {
//     role = org.role as Role
//   }
```

The full `beforeLoad` try block becomes:

```typescript
try {
  const org = await getActiveOrganization()
  if (org.role) {
    role = org.role as Role
  }
  if (org.organization) {
    activeOrganization = {
      id: org.organization.id,
      name: org.organization.name,
    }
  }
} catch (e) {
  if (isRedirect(e)) throw e
  console.error('[beforeLoad] getActiveOrganization failed:', e)
}
```

Key changes:

- Remove `toDomainRole` import entirely
- Use `org.role as Role` directly (it's already mapped by `resolveTenantContext()`)
- Remove all `console.log` debug lines (3 total)
- Keep the `console.error` for actual failures

- [ ] **Step 3: Verify the fix builds**

Run: `pnpm tsc --noEmit`
Expected: PASS (type cast is safe — `ctx.role` from `resolveTenantContext` is already `Role`)

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated.tsx
git commit -m "fix: remove double toDomainRole mapping that degraded all users to Staff"
```

---

## Phase 2 — Enable Dynamic Access Control

### Task 2: Enable `dynamicAccessControl` in better-auth config

**Files:**

- Modify: `src/shared/auth/auth.ts`

**Context:** Better-auth's organization plugin has a `dynamicAccessControl` option that creates an `organizationRole` table, provides CRUD endpoints, and merges org-specific role overrides with built-in roles at check time. Currently the config passes `ac` and `roles` but does not enable dynamic AC.

- [ ] **Step 1: Read `src/shared/auth/auth.ts` for editing**

Use context-mode `ctx_execute_file` to confirm the organization plugin config section, then `Read` the file for the Edit tool.

- [ ] **Step 2: Add `dynamicAccessControl` to the organization plugin config**

In the `organization({...})` call inside `createAuth()`, add:

```typescript
organization({
  ac,
  roles: {
    owner,
    admin,
    member: memberRole,
  },
  dynamicAccessControl: {
    enabled: true,
  },
  invitationExpiresIn: INVITATION_EXPIRY_SECONDS,
  // ... rest of config unchanged
})
```

This is a single addition — `dynamicAccessControl: { enabled: true }` — right after the `roles` block.

- [ ] **Step 3: Run better-auth migration to verify `organizationRole` table creation**

Run: `pnpm db:generate` (or the project's migration command)
Expected: Migration file created with `organizationRole` table, or confirmation table already exists.

If no migration command exists, start the dev server and verify the table is auto-created:
Run: `pnpm dev`

- [ ] **Step 4: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS — `dynamicAccessControl` is a recognized option in better-auth's organization plugin.

- [ ] **Step 5: Commit**

```bash
git add src/shared/auth/auth.ts
git commit -m "feat: enable better-auth dynamicAccessControl for custom roles"
```

---

## Phase 3 — DX Cleanup

### Task 3: Create `usePermissions()` hook

**Files:**

- Create: `src/shared/hooks/usePermissions.ts`

**Context:** Components currently receive `canEdit`/`canCreate`/`canDelete` boolean props derived from `hasRole(role, 'PropertyManager')`. This is prop drilling. The hook reads the role from route context and exposes `can(permission)` directly.

- [ ] **Step 1: Create the hook file**

Create `src/shared/hooks/usePermissions.ts`:

```typescript
// Client-side permission hook — reads role from route context and exposes can().
// Components call this instead of receiving canEdit/canCreate props.

import { useRouteContext } from '@tanstack/react-router'
import { can } from '#/shared/domain/permissions'
import type { Permission } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'
import type { AuthRouteContext } from '#/routes/_authenticated'

export function usePermissions() {
  const { role } = useRouteContext({ from: '/_authenticated' }) as AuthRouteContext

  return {
    role: role as Role,
    can: (permission: Permission) => can(role, permission),
  }
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/hooks/usePermissions.ts
git commit -m "feat: add usePermissions hook for client-side permission checks"
```

---

### Task 4: Replace `hasRole()` in `properties/new.tsx` route guard

**Files:**

- Modify: `src/routes/_authenticated/properties/new.tsx`

**Context:** The `beforeLoad` hook uses `hasRole(role, 'PropertyManager')` as a gate. Per decision A2, route guards should use `can(role, 'property.create')` instead.

- [ ] **Step 1: Read the file for editing**

Use `Read` to load the file for the Edit tool.

- [ ] **Step 2: Replace the route guard**

Replace the import and guard logic:

```typescript
// REMOVE:
import { hasRole } from '#/shared/domain/roles'

// ADD:
import { can } from '#/shared/domain/permissions'

// In beforeLoad, REPLACE:
//   if (!hasRole(role, "PropertyManager")) {
// WITH:
//   if (!can(role, "property.create")) {
```

The full `beforeLoad` becomes:

```typescript
beforeLoad: ({ context }) => {
  const role = (context as AuthRouteContext).role;
  if (!can(role, "property.create")) {
    throw redirect({ to: "/properties" });
  }
},
```

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/properties/new.tsx
git commit -m "refactor: replace hasRole with can() in property creation route guard"
```

---

### Task 5: Replace `hasRole()` in `dashboard.tsx`

**Files:**

- Modify: `src/routes/_authenticated/dashboard.tsx`

**Context:** Uses `const canCreate = hasRole(ctx.role, 'PropertyManager')` to conditionally render a "Create Property" button. Should use `usePermissions()` hook.

- [ ] **Step 1: Read the file for editing**

Use context-mode `ctx_execute_file` to see the component, then `Read` for the Edit tool.

- [ ] **Step 2: Replace hasRole with usePermissions**

```typescript
// REMOVE:
import { hasRole } from '#/shared/domain/roles'

// ADD:
import { usePermissions } from '#/shared/hooks/usePermissions'

// In the component, REPLACE:
//   const canCreate = hasRole(ctx.role, 'PropertyManager')
// WITH:
//   const { can: canDo } = usePermissions()
//
// Then REPLACE:
//   {canCreate && (
// WITH:
//   {canDo('property.create') && (
```

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/dashboard.tsx
git commit -m "refactor: replace hasRole with usePermissions in dashboard"
```

---

### Task 6: Replace `hasRole()` in `properties/index.tsx`

**Files:**

- Modify: `src/routes/_authenticated/properties/index.tsx`

**Context:** Uses `const canCreate = hasRole(role, 'PropertyManager')` to show a "New Property" button.

- [ ] **Step 1: Read the file for editing**

Use context-mode `ctx_execute_file`, then `Read` for the Edit tool.

- [ ] **Step 2: Replace hasRole with usePermissions**

```typescript
// REMOVE hasRole import (keep Role type import if used elsewhere)
// ADD:
import { usePermissions } from '#/shared/hooks/usePermissions'

// In the component, REPLACE:
//   const canCreate = hasRole(role, 'PropertyManager')
// WITH:
//   const { can } = usePermissions()
//
// Then REPLACE:
//   {canCreate && (
// WITH:
//   {can('property.create') && (
```

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/properties/index.tsx
git commit -m "refactor: replace hasRole with usePermissions in properties list"
```

---

### Task 7: Replace `hasRole()` in `portals/index.tsx`

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`

**Context:** Uses both `canCreate = hasRole(role, 'PropertyManager')` and `canDelete = hasRole(role, 'PropertyManager')`. Both should become `can()` calls with specific permissions.

- [ ] **Step 1: Read the file for editing**

Use context-mode `ctx_execute_file`, then `Read` for the Edit tool.

- [ ] **Step 2: Replace hasRole with usePermissions**

```typescript
// REMOVE:
import { hasRole } from '#/shared/domain/roles'

// ADD:
import { usePermissions } from '#/shared/hooks/usePermissions'

// In the component, REPLACE:
//   const canCreate = hasRole(role, 'PropertyManager')
//   const canDelete = hasRole(role, 'PropertyManager')
// WITH:
//   const { can } = usePermissions()
//
// Then replace all usages:
//   canCreate  →  can('portal.create')
//   canDelete  →  can('portal.delete')
```

All 5 usage sites (`canCreate &&` x3, `canDelete &&` x1, plus any conditional rendering) get updated to the corresponding `can('portal.create')` or `can('portal.delete')` call.

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/portals/index.tsx
git commit -m "refactor: replace hasRole with usePermissions in portal list"
```

---

### Task 8: Replace `canEdit` prop drilling in portal detail route and components

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`
- Modify: `src/components/features/portal/PortalDetailPage.tsx`
- Modify: `src/components/features/portal/EditPortalForm.tsx`

**Context:** The portal detail route computes `canEdit = hasRole(ctx.role, 'PropertyManager')` and passes it as a prop through `PortalDetailPage` → `EditPortalForm`. Each component should use `usePermissions()` directly instead.

- [ ] **Step 1: Read all three files for editing**

Use context-mode `ctx_batch_execute` to see all three files, then `Read` each for the Edit tool.

- [ ] **Step 2: Update `$portalId.tsx` route**

Remove the `hasRole` import, the `canEdit` variable, and the `canEdit={canEdit}` prop:

```typescript
// REMOVE:
import { hasRole } from '#/shared/domain/roles'

// REMOVE this line:
//   const canEdit = hasRole(ctx.role, 'PropertyManager')

// REMOVE canEdit prop from <PortalDetailPage>:
//   <PortalDetailPage portal={portal} mutation={mutation} canEdit={canEdit} />
// BECOMES:
//   <PortalDetailPage portal={portal} mutation={mutation} />
```

- [ ] **Step 3: Update `PortalDetailPage.tsx`**

Remove the `canEdit` prop and add `usePermissions()`:

```typescript
// ADD:
import { usePermissions } from '#/shared/hooks/usePermissions'

// REMOVE from Props type:
//   canEdit: boolean

// REMOVE from destructuring:
//   canEdit,

// ADD in component body:
//   const { can } = usePermissions()

// REPLACE all canEdit references:
//   canEdit  →  can('portal.update')
```

All `canEdit` usages (~10 occurrences) become `can('portal.update')`.

- [ ] **Step 4: Update `EditPortalForm.tsx`**

Remove the `canEdit` prop and add `usePermissions()`:

```typescript
// ADD:
import { usePermissions } from '#/shared/hooks/usePermissions'

// REMOVE from Props:
//   canEdit: boolean

// REMOVE from destructuring:
//   canEdit,

// ADD in component body:
//   const { can } = usePermissions()

// REPLACE all canEdit references:
//   canEdit  →  can('portal.update')
```

- [ ] **Step 5: Verify build**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/portals/\$portalId.tsx src/components/features/portal/PortalDetailPage.tsx src/components/features/portal/EditPortalForm.tsx
git commit -m "refactor: replace canEdit prop drilling with usePermissions hook"
```

---

### Task 9: Remove unused `hasRole` imports from route files

**Files:**

- Any remaining route files that imported `hasRole` but no longer use it

**Context:** After Tasks 4-8, some route files may still have unused `hasRole` imports. Clean them up.

- [ ] **Step 1: Search for remaining `hasRole` imports in routes**

```bash
grep -rn "import.*hasRole" src/routes --include='*.tsx'
```

Expected: No results (all route files should now use `can()` or `usePermissions()`)

If any remain, remove the unused import from each file.

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add -u
git commit -m "chore: remove unused hasRole imports from route files"
```

---

### Task 10: Verify end-to-end permission flow

**Files:**

- No file changes — verification only

- [ ] **Step 1: Run full type check**

Run: `pnpm tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run existing tests**

Run: `pnpm test`
Expected: All tests pass. The `hasRole` tests in `src/shared/auth/auth.test.ts` still pass because `hasRole()` is kept for hierarchy use in domain rules and sidebar.

- [ ] **Step 3: Run dev server and verify manually**

Run: `pnpm dev`

Test as `AccountAdmin`:

- Dashboard shows "Create Property" button
- Properties list shows "New Property" button
- Portal list shows create/delete buttons
- Portal detail page is editable

Test as `Staff`:

- Dashboard does NOT show "Create Property"
- Properties list does NOT show "New Property"
- Portal list does NOT show create/delete buttons
- Portal detail page is read-only

---

## Files NOT Modified (intentional)

These files use `hasRole()` for **role hierarchy** checks, not permission checks. Per decision A5 and A3, `hasRole()` stays for:

- `src/components/layout/AppSidebar.tsx` — `isManager = hasRole(role, 'PropertyManager')` controls sidebar section visibility (hierarchy, not specific permission)
- `src/contexts/identity/domain/rules.ts` — `hasRole(inviterRole, 'PropertyManager')` enforces business rules based on role level (not individual permissions)
- `src/contexts/staff/application/use-cases/create-staff-assignment.ts` — `hasRole(ctx.role, 'PropertyManager')` hierarchy check for self-assignment guard

## Phase 4 — Admin UI (Deferred)

Not in scope for this plan. Will be planned separately when the Admin UI is prioritized. See `docs/plan/phase-11-rbac-permissions-decisions.md` Phase 4 for requirements.
