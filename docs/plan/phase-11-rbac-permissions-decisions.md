# Phase 11 — Role-Based Permission System Overhaul — Decision Log

**Date:** 2026-05-02
**Status:** Phases 1-3 Implemented, Phase 4 Deferred
**Commits:** `6e14d50` `a15e1ca` `804389f` `0c637e3`
**Session:** Grilling session for RBAC system diagnosis and redesign — permission resolution bugs, dual API cleanup, dynamic access control enablement.

---

## Problem Statement

The organization creator (AccountAdmin) could not see the "Add Portal" button or edit portal fields. Root cause: double-mapping bug in `_authenticated.tsx` where `toDomainRole()` was called on an already-mapped domain role, silently degrading all users to `Staff`. Additionally, the developer experience was messy — two parallel permission APIs (`can()` and `hasRole()`), prop-drilled `canEdit`/`canCreate` booleans, and inconsistent server vs client permission resolution.

---

## Diagnosis

### Bug 1 — Double-Mapping in beforeLoad

**File:** `src/routes/_authenticated.tsx`
**Root cause:** `getActiveOrganization()` returns `ctx.role` from `resolveTenantContext()`, which already maps `owner` → `AccountAdmin` via `toDomainRole()`. Then `beforeLoad` calls `toDomainRole(org.role)` again. `toDomainRole("AccountAdmin")` hits the `default` branch → returns `"Staff"`.
**Evidence:** Debug logs showed raw response `role: "AccountAdmin"` but after `toDomainRole()` → `Staff`.

### Bug 2 — Dual Permission API

- **Server-side:** `can(ctx.role, 'portal.create')` — granular permission check
- **Client-side:** `hasRole(ctx.role, 'PropertyManager')` — hierarchy-based check
- These check the same thing differently. Future roles could pass one and fail the other.

### Bug 3 — Silent Error Swallowing

The `getActiveOrganization()` call in `beforeLoad` is wrapped in a try/catch that only re-throws redirects. Any other error silently falls back to `Staff`.

---

## Architecture Decisions

### A1. Use Better-auth Dynamic Access Control

**Decision:** Enable `dynamicAccessControl: { enabled: true }` in the better-auth organization plugin instead of building a custom RBAC layer.
**Reasoning:** Better-auth already provides the full stack — `organizationRole` table, CRUD endpoints, merge logic (built-in fallback + org override), permission caching. Zero custom infrastructure. See ADR 0001.

### A2. Single Permission API — `can()` everywhere

**Decision:** Replace all `hasRole()` calls in UI/route guards with `can(role, permission)`. Keep `hasRole()` only for sidebar visibility and hierarchy comparisons where no specific permission exists.
**Reasoning:** Two APIs for the same thing caused the bug class. `can()` is granular, auditable, and future-proof (custom roles work automatically).

### A3. `usePermissions()` Hook for Client DX

**Decision:** Create a `usePermissions()` React hook that reads the role from route context and exposes `can(permission)`. Components call this directly instead of receiving `canEdit`/`canCreate` props.
**Reasoning:** Eliminates prop drilling. Single source of truth for client-side permission checks. Route guards still use `can()` directly for redirects.

### A4. Fix Double-Mapping — Remove Second `toDomainRole()`

**Decision:** `getActiveOrganization()` already returns a domain role. `beforeLoad` should use it directly without calling `toDomainRole()` again.
**Reasoning:** `resolveTenantContext()` inside `getActiveOrganization()` already does the mapping. Double-mapping is the root cause of the bug.

### A5. Role Scope — Org-wide, Property Access via Assignment

**Decision:** Roles remain org-wide. Property-level access is controlled by `staff_assignments`, not per-property roles. A PropertyManager manages only assigned properties, but their permission level is the same across all of them.
**Reasoning:** Simpler mental model. Per-property roles would require a separate role assignment table per property, exploding the combinatorics.

---

## Domain Decisions

### D1. Three Built-in Roles + Custom Roles

**Decision:** `AccountAdmin`, `PropertyManager`, `Staff` are immutable system defaults. AccountAdmin can create custom roles (e.g., "Content Editor", "Support Agent") with cherry-picked permissions per organization.
**Reasoning:** Built-in roles cover 90% of use cases. Custom roles handle the long tail without over-engineering the default model.

### D2. Built-in Roles as Fallback

**Decision:** When an org has no custom role overrides, built-in role definitions apply. When an org customizes a built-in role or creates a custom role, the org-specific definition takes precedence. Better-auth handles this merge automatically.
**Reasoning:** Zero migration for existing orgs. New orgs start with sensible defaults. Customization is opt-in.

### D3. AccountAdmin Cannot Be Modified

**Decision:** The `AccountAdmin` (owner) role's permissions are always the full statement. It cannot be downgraded via dynamic AC. Only the `PropertyManager` and `Staff` roles can be customized per-org.
**Reasoning:** Every org must have at least one all-powerful role. Allowing AccountAdmin to be modified risks locking everyone out of admin functions.

---

## Implementation Decisions

### I1. Permission Statement — Single Source of Truth

**Decision:** The `statement` object in `shared/auth/permissions.ts` defines all resources and actions. Adding new resources requires a code deploy. Custom roles can only pick from existing resources/actions.
**Reasoning:** The statement is the universe of possible permissions. New resources (e.g., `analytics`) require a deploy to add the resource key. This is intentional — permission namespace changes should be deliberate.

### I2. Route Guard Pattern

**Decision:** Route `beforeLoad` hooks use `can(role, permission)` for access control:

```typescript
beforeLoad: ({ context }) => {
  const role = (context as AuthRouteContext).role
  if (!can(role, 'portal.create')) {
    throw redirect({ to: '/properties' })
  }
}
```

**Reasoning:** Consistent with server-side checks. Reads `can()` from `shared/domain/permissions` (boundary-compliant).

### I3. Component Permission Pattern

**Decision:** Components use `usePermissions()` hook:

```typescript
function PortalListPage() {
  const { can } = usePermissions()
  return (
    <>
      {can('portal.create') && <AddPortalButton />}
      {can('portal.delete') && <DeleteButton />}
    </>
  )
}
```

**Reasoning:** No prop drilling. Components are self-contained. Permission changes in one place propagate everywhere.

### I4. Error Handling in beforeLoad

**Decision:** Log errors from `getActiveOrganization()` instead of silently swallowing them. Do not fall back to `Staff` silently — if role resolution fails, redirect to an error page or show a clear error.
**Reasoning:** Silent fallback to `Staff` caused the original bug. Fail loudly so the issue is visible.

---

## Files to Create/Modify

| File                                 | Action | Status | Purpose                                                     |
| ------------------------------------ | ------ | ------ | ----------------------------------------------------------- |
| `src/shared/auth/auth.ts`            | Modify | Done   | Enable `dynamicAccessControl` in org plugin config          |
| `src/shared/auth/permissions.ts`     | Keep   | —      | Statement + role definitions (unchanged)                    |
| `src/shared/domain/permissions.ts`   | Keep   | —      | `can()` function + Permission type (unchanged)              |
| `src/shared/domain/roles.ts`         | Keep   | —      | Role type + `hasRole()` (keep for hierarchy only)           |
| `src/routes/_authenticated.tsx`      | Modify | Done   | Fix double-mapping, remove debug logs                       |
| `src/shared/hooks/usePermissions.ts` | Create | Done   | Client-side permission hook                                 |
| Route guard files (4)                | Modify | Done   | Replace `hasRole()` with `can()` in route guards            |
| Portal components (3)                | Modify | Done   | Replace `canEdit`/`canCreate` props with `usePermissions()` |
| Identity tables (2)                  | Modify | Done   | Replace `hasRole()` with `can()` using `viewerRole` prop    |

---

## Implementation Phases

### Phase 1 — Bug Fix (Immediate) — DONE

- Fixed double-mapping in `_authenticated.tsx` — removed second `toDomainRole()` call
- Removed all debug `console.log` lines
- `getActiveOrganization()` already returns domain role via `resolveTenantContext()` — used directly

### Phase 2 — Enable Dynamic AC — DONE

- Added `dynamicAccessControl: { enabled: true }` to org plugin config
- `organizationRole` table auto-created by better-auth
- Existing roles continue to work as fallback

### Phase 3 — DX Cleanup — DONE

- Created `usePermissions()` hook at `src/shared/hooks/usePermissions.ts`
- Replaced `hasRole()` with `can()` in all route guards (4 files)
- Replaced `canEdit`/`canCreate`/`canDelete` prop drilling with `usePermissions()` (5 component files)
- `hasRole()` kept only for: AppSidebar (sidebar visibility), domain rules (hierarchy), staff assignment use case

### Phase 4 — Admin UI (Future Session)

- Role management page for AccountAdmin
- Permission matrix editor
- Custom role creation form
- Member role assignment with custom roles

---

## Deferred Decisions

| Item                         | Reason                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Per-property roles           | Not needed — org-wide role + assignment is sufficient                         |
| Permission audit log         | Important but not blocking — add when admin UI ships                          |
| Custom role validation rules | E.g., "must have at least one read permission" — defer to admin UI design     |
| Role deletion safeguards     | What happens to members with a deleted custom role — defer to admin UI design |
