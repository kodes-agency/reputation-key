# Review 9: Permissions & Authorization (Re-audit R2)

**Date:** 2026-05-23
**Scope:** `server/`, `application/use-cases/`, `routes/_authenticated.tsx`, `components/`, `shared/domain/permissions.ts`, `shared/auth/permissions.ts`

## Summary

The permission system follows the three-API pattern well: `can()` in server/use-case layer, `usePermissions()` in components, `hasRole()` for sidebar/hierarchy. The permission statement in `shared/auth/permissions.ts` is the single source of truth and the `Permission` type in `shared/domain/permissions.ts` is kept in sync. Most server functions delegate authorization to use cases via `can(ctx.role, ...)`. A few findings remain.

## Findings

### [MAJOR] Reply server functions lack `can()` check — authorization only in use case layer

- **File:** `src/contexts/review/server/reply.ts`
- **Quote:** Lines 86–112 (draftReplyFn), 116–140 (submitReplyFn), 144–168 (approveReplyFn), 170–197 (rejectReplyFn), 199–226 (deleteReplyFn), 230–254 (retryPublishFn) — none have `can(ctx.role, ...)` in the server function body
- **Rule:** "Every server function has can() check" — server functions are the HTTP entry point and should guard authorization, either inline or by delegating to a use case that does. The reply functions delegate to `useCases.draftReply(...)` etc. which check `reply.manage` via `requireManager()`, but the server layer itself has no guard. Only `getReplyFn` (line 59) has an inline `can(ctx.role, 'review.read')` check; the other 6 reply server functions do not.
- **Fix:** This is a design trade-off — authorization IS enforced, just deeper in the use case layer. If the convention is "every server function has can() check," add inline `can()` checks to the reply server functions for defense-in-depth. If the convention is "authorization may live in use cases," this is acceptable. **Verdict: acceptable as-is since `requireManager()` in `reply-operations.ts` covers all mutations. No user-facing gap.**

---

### [MAJOR] `getGoogleAuthUrl` server function has no permission check

- **File:** `src/contexts/integration/server/google-connections.ts`
- **Quote:** Lines 40–85 — `const ctx = await resolveTenantContext(headers)` is called but `can(ctx.role, 'integration.manage')` is never checked
- **Rule:** "Every server function has can() check"
- **Fix:** Add `if (!can(ctx.role, 'integration.manage')) { ... }` after `resolveTenantContext()` on line 47. The other functions (`connectGoogle`, `listGoogleConnections`, `disconnectGoogle`, `updateConnectionVisibility`) correctly delegate to use cases that check permissions, but `getGoogleAuthUrl` bypasses use cases entirely and goes straight to building the OAuth URL.

---

### [MINOR] `listProperties` server function has no `can()` check

- **File:** `src/contexts/property/server/properties.ts`
- **Quote:** Lines 90–110 — comment says "All authenticated roles can list properties" but there is no `can()` check
- **Rule:** "Every server function has can() check" — while the comment justifies the omission, there is no `property.list` permission defined in the statement. The use case itself filters by staff assignment, so data is scoped correctly.
- **Fix:** Consider adding a `property.list` permission to the statement and checking it, or accept that listing is implicitly authorized for all authenticated users with results filtered by assignment.

---

### [MINOR] `role === 'AccountAdmin'` string check in test stub

- **File:** `src/contexts/property/application/use-cases/list-properties.test.ts`
- **Quote:** Line 20: `if (role === 'AccountAdmin') return null // all accessible`
- **Rule:** "No `role === 'AccountAdmin'` string checks" — however, this is a test file's mock stub, not production code. The production equivalent uses `hasRole(role, 'AccountAdmin')` in `staff/build.ts`.
- **Fix:** Acceptable in test code. No change needed.

---

### [MINOR] `role === 'AccountAdmin'` in RoleBadge component — display-only

- **File:** `src/components/features/identity/shared/role-badge.tsx`
- **Quote:** Lines 11–14: `role === 'AccountAdmin' ? 'default' : role === 'PropertyManager' ? 'secondary' : 'outline'`
- **Rule:** "No `role === 'AccountAdmin'` string checks" — this is a UI variant mapping, not a permission check. It determines badge color.
- **Fix:** Acceptable for display logic. Could use a lookup map for extensibility but not a security concern.

---

### [NIT] `canEdit` local variables in components — not prop drilling

- **Files:** `src/components/features/portal/link-tree/sortable-category.tsx` (line 48), `sortable-link.tsx` (line 30), `link-tree-category-list.tsx` (line 67)
- **Quote:** `const canEdit = can('portal.update')` (from `usePermissions()`)
- **Rule:** "No boolean prop drilling (canEdit, canCreate)" — these are local variables derived from `usePermissions()`, not props passed down from parent components. The `can()` comes from the `usePermissions()` hook's returned function.
- **Fix:** This is the correct pattern — `usePermissions()` in the component, local variable for readability. No change needed.

---

### [NIT] `canManageReplies` local variable in component

- **File:** `src/components/inbox/inbox-detail-content.tsx`
- **Quote:** Line 35: `const canManageReplies = can('reply.manage')`
- **Rule:** Same as above — local variable from `usePermissions()`, not prop drilling.
- **Fix:** Correct pattern. No change needed.

---

### [NIT] Permission `ac.read` is defined but never enforced

- **File:** `src/shared/auth/permissions.ts`
- **Quote:** Line 29: `ac: ['create', 'read', 'update', 'delete']`
- **Rule:** "No dead permissions (granted but never enforced)"
- **Fix:** `ac.*` permissions are granted to AccountAdmin only (Phase B dynamic access control). The `ac.read` permission is defined for future use but currently has no `can()` check anywhere in the codebase. This is expected for Phase B and can remain. No enforcement gap since AccountAdmin already has full access.

---

### [NIT] Permission strings are consistent between definition and usage

- All `can(ctx.role, '...')` calls across server functions and use cases use permission strings that exist in the `Permission` type and are defined in the `statement` object. No mismatches found.

---

### [NIT] `hasRole()` usage is correct — sidebar and domain hierarchy only

- `routes/_authenticated.tsx` line 153: `hasRole(ctx.role, 'PropertyManager')` — used for sidebar selection. ✅
- `components/layout/settings-sidebar.tsx` line 29: `hasRole(role, 'PropertyManager')` — used for navigation link. ✅
- `contexts/identity/domain/rules.ts`: `hasRole(inviterRole, 'PropertyManager')` — domain invariant (hierarchy check). ✅
- `contexts/inbox/application/use-cases/*.ts`: `hasRole(input.role, ADMIN_ROLE)` — checks minimum hierarchy for property access scoping. ✅
- `contexts/staff/build.ts` line 51: `hasRole(role, 'AccountAdmin')` — determines whether to return all properties. ✅
- `contexts/integration/application/use-cases/list-google-connections.ts` line 28: `hasRole(ctx.role, 'AccountAdmin')` — visibility filter, not a permission gate. ✅

All `hasRole()` uses are for hierarchy/visibility, not permission gating. Permission checks use `can()`. ✅

## Final Severity Counts

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 1     |
| MINOR    | 3     |
| NIT      | 5     |

**MAJOR (1):** `getGoogleAuthUrl` missing `can()` check — any authenticated user can generate OAuth URLs regardless of `integration.manage` permission.
