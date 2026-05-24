# Review 9: Permissions & Authorization (CRITICAL)

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Scope

All server functions in `src/contexts/*/server/` and all use cases in `src/contexts/*/application/use-cases/`.

---

## Findings

### [MAJOR] `signInUser` server function logs PII (email) in structured log

File: `src/contexts/identity/server/organizations.ts:513`
Quote: ```ts
getLogger().warn({ email: data.email, err: e }, 'Sign-in failed')

````
Rule: No PII in log messages. Emails are PII.
Fix: Log only a hashed email or omit it: `{ err: e }` is sufficient for debugging. Or log `{ emailPrefix: data.email.substring(0, 3) + '***' }`.

### [MINOR] `refresh-google-token` use case has no `can()` check

File: `src/contexts/integration/application/use-cases/refresh-google-token.ts`
Quote: This use case takes `AuthContext` but has no `can(ctx.role, 'integration.manage')` check.
Rule: Every mutating operation that takes `AuthContext` should have a `can()` check.
Fix: Add `if (!can(ctx.role, 'integration.manage'))` at the top of the use case.

### [MINOR] `listInvitations` use case delegates `can()` to server function

File: `src/contexts/identity/application/use-cases/list-invitations.ts`
Quote: The use case does check `can(ctx.role, 'invitation.list')` ✓

However, `listInvitations` server function at `src/contexts/identity/server/organizations.ts:301-318` does NOT have a `can()` check before calling the use case. The permission check only happens inside the use case. This is acceptable (the use case is the canonical location), but inconsistent with other patterns where `can()` appears in both server function and use case.

Fix: This is a style inconsistency, not a bug. Consider standardizing on "use case only" or "both" pattern.

### [MINOR] `getPortal` use case uses `portal.update` permission for read

File: `src/contexts/portal/application/use-cases/get-portal.ts:18`
Quote: ```ts
if (!can(ctx.role, 'portal.update')) {
````

Rule: Permission strings should follow `resource.action` convention. Using `portal.update` for a read operation (`getPortal`) is semantically incorrect. The permission statement has no `portal.read`.
Fix: Either (a) add `portal.read` to the permission statement and use it here, or (b) rename this use case to make clear it's an "edit page data fetch" that requires update permission.

### [MINOR] `listPortals` and `listPortalLinks` use cases have no `can()` check

File: `src/contexts/portal/application/use-cases/list-portals.ts`
File: `src/contexts/portal/application/use-cases/list-portal-links.ts`
Quote: No `can()` call — relies on `resolveTenantContext()` for auth.
Rule: Per use case shape in CONTEXT.md, step 1 is "Authorize — `can(ctx.role, 'resource.action')`". Read operations for authenticated users should still check a read permission.
Fix: Add `portal.read` permission (after adding it to the permission statement) or document explicitly that these are public reads.

### [MINOR] `listProperties` and `getProperty` use cases have no `can()` check

File: `src/contexts/property/application/use-cases/list-properties.ts`
File: `src/contexts/property/application/use-cases/get-property.ts`
Quote: `getProperty` has a comment: "no role-based authorization check — all authenticated users within an organization can view properties."
Rule: If the intent is that all roles can read, then `property.read` should exist in the permission statement and be granted to all roles.
Fix: Add `property.read` to the permission statement, grant to all three roles, and add `can(ctx.role, 'property.read')` to the use cases.

### [MINOR] Permission statement missing `property.read`, `portal.read`, `team.read`, `staff_assignment.read`, `review.list`

File: `src/shared/auth/permissions.ts:21-38`
Quote: ```ts
export const statement = {
organization: ['update', 'delete'],
// ...
property: ['create', 'update', 'delete'], // no 'read'
portal: ['create', 'update', 'delete'], // no 'read'
team: ['create', 'update', 'delete'], // no 'read'
staff_assignment: ['create', 'delete'], // no 'read'
review: ['read', 'reply'], // ✓ has 'read'
// ...
}

```
Rule: Every resource:action pair used in code should be in the permission statement.
Fix: Add read permissions for resources that are accessed by authenticated routes: `property.read`, `portal.read`, `team.read`, `staff_assignment.read`. Grant to all three roles.

---

## Positive Observations

- **All mutating operations have `can()` checks.** Every create/update/delete use case calls `can(ctx.role, 'resource.action')`.
- **No string-based role comparison for permissions.** All checks use `can()` from `shared/domain/permissions`. The only `role ===` comparison is in `RoleBadge` component for presentation logic (acceptable).
- **Permission strings follow `resource.action` convention** consistently.
- **All three roles (AccountAdmin, PropertyManager, Staff) are covered** in the permission statement.
- **Guest-facing endpoints are properly unprotected** — they don't take `AuthContext` and don't need `can()` checks (e.g., `getPublicPortal`, `submitRating`, `submitFeedback`, `recordScan`, `resolveLinkAndTrack`).
- **Server functions consistently use `resolveTenantContext()`** to get `AuthContext` with `role`, then check `can()` before proceeding.
- **Route-level `beforeLoad` checks** in `settings/organization.tsx` and `portals/new.tsx` correctly use `can()` for client-side redirects.

---

## Summary

| Severity | Count |
|----------|-------|
| BLOCKER  | 0     |
| MAJOR    | 1     |
| MINOR    | 6     |
| NIT      | 0     |

**Most important thing to fix first:** The PII leak in `signInUser` — email is logged in plaintext on every failed sign-in attempt. Replace with a redacted or omitted email field.
```
