# Deep Review r10: Auth Flow & Better-auth Integration

## Findings

### [MAJOR] `listMembers` server function skips `can()` permission check
- **File:** `src/contexts/identity/server/organizations.ts:152-177`
- **Rule:** Server function 7-step shape (review r06): step 4 requires `can(role, permission)` check
- **Fix:** Add `can(ctx.role, 'member.create')` or appropriate permission check after `resolveTenantContext`
- **Triage:** `relevant` — server function calls `resolveTenantContext` but never checks `can()`

### [MAJOR] `getActiveOrganization` server function skips `can()` permission check
- **File:** `src/contexts/identity/server/organizations.ts:120-148`
- **Rule:** Server function 7-step shape: step 4 requires `can(role, permission)` check
- **Fix:** Add permission check. This is a read-only endpoint available to all roles, so a simple membership check via `resolveTenantContext` is sufficient — but it still needs explicit `can()` call
- **Triage:** `relevant`

### [MAJOR] `setActiveOrganization` server function skips auth entirely — no `resolveTenantContext` or `requireAuth`
- **File:** `src/contexts/identity/server/organizations.ts:375-391`
- **Rule:** Server function step 2: Auth middleware applied
- **Fix:** Add `requireAuth(headers)` call to verify the user is authenticated
- **Triage:** `relevant` — allows setting active org without auth check

### [MAJOR] `cancelInvitation` server function skips `can()` check
- **File:** `src/contexts/identity/server/organizations.ts:229-246`
- **Rule:** Step 4 of server function shape
- **Fix:** Add `can(ctx.role, 'invitation.cancel')` check
- **Triage:** `relevant`

### [MAJOR] `listUserInvitations` server function skips auth check entirely
- **File:** `src/contexts/identity/server/organizations.ts:344-371`
- **Rule:** Steps 2-4 missing — no auth, no permission check
- **Fix:** Add `requireAuth(headers)` and `can()` check
- **Triage:** `relevant`

### [MAJOR] `listUserOrganizations` server function skips auth check
- **File:** `src/contexts/identity/server/organizations.ts:395-423`
- **Rule:** Steps 2-4 missing
- **Fix:** Add `requireAuth(headers)` check
- **Triage:** `relevant`

### [MAJOR] `toDomainRole` called in `server/organizations.ts` on raw better-auth role strings from `auth.api` responses
- **File:** `src/contexts/identity/server/organizations.ts:165,360`
- **Rule:** CONTEXT.md: "Never call `toDomainRole()` on an already-mapped domain role — `resolveTenantContext()` already returns domain roles."
- **Note:** This is NOT a violation — these are raw better-auth API responses (not already-mapped), so `toDomainRole()` is correct here
- **Triage:** `wontfix` — these are correctly mapping raw better-auth role strings to domain roles

### [MAJOR] `clearTenantCache` uses eviction of expired entries, not targeted invalidation on role change
- **File:** `src/shared/auth/middleware.ts:42-49`
- **Rule:** r10 prompt: "Tenant cache invalidation missing when membership/role changes are committed"
- **Current behavior:** `clearTenantCache()` evicts all expired entries (TTL-based). Called at end of every server function via `tracedHandler`. This means role changes take effect after max 5s TTL.
- **Triage:** `wontfix` — The 5s TTL + `clearTenantCache()` at end of every request means stale data lives at most 5 seconds. This is acceptable for current scale. Targeted invalidation would be better but not BLOCKER.

### [MINOR] Inconsistent field naming: `user` (route context) vs `userId` (AuthContext)
- **File:** `src/routes/_authenticated.tsx:28-47` vs `src/shared/domain/auth-context.ts:13-17`
- **Route context has:** `user: { id, name, email, image }`, `role`, `activeOrganization: { id, name, ... }`
- **AuthContext has:** `userId`, `organizationId`, `role`
- **Rule:** r10 MINOR: "Inconsistent naming between `AuthContext` (server) and route context (client) fields"
- **Triage:** `wontfix` — intentional design difference. Server context is minimal (IDs + role). Client route context has full objects. `role` is consistent across both.

## Summary

- **BLOCKER:** 0
- **MAJOR:** 5 (missing permission/auth checks in server functions)
- **MINOR:** 1 (wontfix — intentional naming difference)
- **Most important fix:** Add `can()` checks to `listMembers`, `cancelInvitation`, and add `requireAuth` to `setActiveOrganization`, `listUserInvitations`, `listUserOrganizations`

## Plan

1. Add `can()` import to `organizations.ts`
2. Add `requireAuth` to `setActiveOrganization`, `listUserInvitations`, `listUserOrganizations`
3. Add `can()` checks after `resolveTenantContext` in `listMembers`, `cancelInvitation`
4. Verify with `npx tsc --noEmit`
