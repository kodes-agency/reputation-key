# Review 6 — Server Functions

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Findings

### [MAJOR] Auth-settings server functions have no tenant context validation

File: `src/contexts/identity/server/auth-settings.ts`
No call to `resolveTenantContext()` and no `orgId` validation. The file handles `changePassword` and `updateProfile` which are user-scoped (not org-scoped), so this is partially acceptable. However, there is no authentication check that the user is actually logged in — it passes headers directly to better-auth which handles it internally.

Rule: Server functions should validate tenant context before operations.
Fix: Add a session validation check or document this as an intentional exception for user-scoped operations.

### [MINOR] Several server functions delegate all auth to use cases, none at server layer

The following server files call `resolveTenantContext()` but never call `can()` themselves:

- `src/contexts/portal/server/portals.ts` — can()=0
- `src/contexts/portal/server/portal-links.ts` — can()=0
- `src/contexts/property/server/properties.ts` — can()=0
- `src/contexts/staff/server/staff-assignments.ts` — can()=0
- `src/contexts/team/server/teams.ts` — can()=0
- `src/contexts/integration/server/gbp-import.ts` — can()=0

For these, the use cases DO have `can()` checks, so this is defended. This is acceptable per CONTEXT.md "When to skip layers" but defense-in-depth would add `can()` at both layers.

Fix: Consider adding `can()` at the server layer for defense-in-depth, or document this as an accepted pattern.

### [MINOR] Guest public server functions have no tenant resolution

File: `src/contexts/guest/server/public.ts`
Guest endpoints resolve context from the portal (not from user session), which is correct for public-facing endpoints. No `resolveTenantContext()` call — this is expected for anonymous flows.
Fix: No action needed — correct for public endpoints.

### Checks passed

- **Error handling** — all server functions use `tracedHandler()` and catch/map errors with typed error responses ✅
- **No business logic** in server functions — they orchestrate use cases ✅
- **No direct database queries** — all go through repos/use cases ✅
- **Sensitive data** not leaked in error messages ✅
- **Standard pattern** — `tracedHandler` + `resolveTenantContext` + `match(result).exhaustive()` ✅

## Counts

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 1     |
| MINOR    | 2     |
| NIT      | 0     |

**Most important thing to fix first:** Verify auth-settings server functions have proper session validation for user-scoped operations.
