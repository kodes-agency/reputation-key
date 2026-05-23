# Review 10: Auth Flow & Better-auth Integration (Re-audit R2)

**Date:** 2026-05-23
**Scope:** `shared/auth/`, `shared/domain/roles.ts`, `shared/domain/auth-context.ts`, `routes/_authenticated.tsx`, `contexts/identity/`, `contexts/*/server/`

## Summary

The auth flow is clean and well-layered. `resolveTenantContext()` in `shared/auth/middleware.ts` is the single point where better-auth sessions are resolved and domain roles are mapped. `AuthContext` flows downstream to all use cases. Better-auth imports are confined to `shared/auth/` and one infrastructure adapter. Domain roles (`AccountAdmin`, `PropertyManager`, `Staff`) are used consistently everywhere — no raw `owner`/`admin`/`member` strings in domain code.

## Findings

### [MAJOR] `toDomainRole()` called outside auth middleware — in identity adapter and organizations.ts server

- **File:** `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts`
- **Quote:** Lines 56, 158, 181: `role: toDomainRole(m.role)` / `role: toDomainRole(inv.role)`
- **Rule:** "toDomainRole() only called once in auth middleware"
- **Fix:** The identity adapter implements `IdentityPort` and calls `toDomainRole()` when mapping better-auth API responses to domain types. This is appropriate — the adapter IS the boundary between better-auth and the domain. However, `organizations.ts` server function (line 181, 388) also calls `toDomainRole()` directly on better-auth responses for `listMembers()` and `listUserInvitations()`. These server functions bypass the adapter and call `getAuth().api.*` directly, then map roles inline. **This is a layering concern, not a security risk.** The mapping is correct. Consider routing these through the identity adapter for consistency.

---

### [MAJOR] `organizations.ts` server functions call `getAuth().api.*` directly — bypassing use case layer

- **File:** `src/contexts/identity/server/organizations.ts`
- **Quote:** Lines 134–136 (`getActiveOrganization` calls `auth.api.getFullOrganization`), 173–175 (`listMembers` calls `auth.api.listMembers`), 230–235 (`acceptInvitation` calls `auth.api.acceptInvitation`), 262–267 (`cancelInvitation` calls `auth.api.cancelInvitation`), 376–378 (`listUserInvitations` calls `auth.api.listUserInvitations`), 414–419 (`setActiveOrganization` calls `auth.api.setActiveOrganization`), 433–435 (`listOrganizations` calls `auth.api.listOrganizations`)
- **Rule:** "Per architecture: 'server/ contains TanStack Start server functions. Forbidden: Business logic, direct DB access, domain rules.'" — the server functions bypass the application layer and call `getAuth().api.*` directly. This is intentional for identity context (thin wrapper around better-auth) but introduces direct better-auth coupling at the server layer.
- **Fix:** These are already documented as intentional delegation patterns (comments like "Direct delegation: no use case because this is pure delegation to better-auth"). The pattern is consistent. Acceptable but should be documented as a conscious exception in CONTEXT.md.

---

### [MINOR] `auth-settings.ts` server functions have no `requireAuth()` or `resolveTenantContext()` call

- **File:** `src/contexts/identity/server/auth-settings.ts`
- **Quote:** Lines 36–56 (`changePasswordFn`), 76–98 (`updateProfileFn`), 108–131 (`updateUserImageFn`) — these call `getAuth().api.*` with `headers` from `headersFromContext()` but never call `requireAuth()` or `resolveTenantContext()`
- **Rule:** Server functions should authenticate before performing operations
- **Fix:** The better-auth API calls (`changePassword`, `updateUser`, `createOrganization`) internally validate the session from the headers, so unauthorized requests will fail. However, explicit `requireAuth(headers)` would provide a clearer error (401 vs 500). The `createOrganizationFn` (line 144) similarly has no auth check. Add `await requireAuth(headers)` at the top of each handler for consistency.

---

### [MINOR] `toDomainRole()` called in `organizations.ts` server function

- **File:** `src/contexts/identity/server/organizations.ts`
- **Quote:** Line 181: `role: toDomainRole(m.role)` and line 388: `role: toDomainRole(inv.role)`
- **Rule:** "toDomainRole() only called once in auth middleware"
- **Fix:** These calls convert raw better-auth role strings to domain roles when mapping member/invitation lists for the UI. The server function has already authenticated via `resolveTenantContext()` (which itself calls `toDomainRole()`). The additional calls here are for formatting responses, not for authorization decisions. Acceptable but could be refactored through the identity adapter.

---

### [NIT] Domain code never imports from better-auth directly

- **Verification:** All `from 'better-auth'` imports are confined to:
  - `src/shared/auth/auth.ts` (server config)
  - `src/shared/auth/auth-cli.ts` (CLI config)
  - `src/shared/auth/auth-client.ts` (client plugin)
  - `src/shared/auth/permissions.ts` (access control plugin)

  No `better-auth` imports in `contexts/*/domain/` or `contexts/*/application/`. ✅

---

### [NIT] `resolveTenantContext()` produces `AuthContext`, used everywhere downstream

- **Verification:** All server functions that need tenant context call `resolveTenantContext(headers)`. The resulting `AuthContext` is passed to use cases as the second parameter. No server function constructs its own `AuthContext` from raw session data (except identity server functions that use `requireAuth()` for non-tenant-scoped operations). ✅

---

### [NIT] No session/cookie reads outside auth middleware

- **Verification:** Session reads (`getSession`, `getSessionFromHeaders`) are confined to:
  - `shared/auth/middleware.ts` (the canonical middleware)
  - `shared/auth/auth.functions.ts` (the `getSession` server function used by `_authenticated.tsx`)
  - `routes/api/auth/google/callback.ts` (OAuth callback)
  - Test files

  Cookie reads in `contexts/guest/server/public.ts` are for guest session tracking (`guest_session` cookie), not authentication. ✅

---

### [NIT] Roles: `AccountAdmin`/`PropertyManager`/`Staff` used consistently in domain

- **Verification:** No `owner`/`admin`/`member` strings found in domain code outside of `toDomainRole()` mapping and `toBetterAuthRole()` reverse mapping. The `BetterAuthRole` type exists only in `shared/domain/roles.ts` and is not used for authorization decisions. ✅

---

### [NIT] `_authenticated.tsx` correctly resolves route context

- **Verification:** `beforeLoad` calls `getSession()` (server function) → `getActiveOrganization()` (server function with `resolveTenantContext()` + `can(ctx.role, 'dashboard.read')`) → produces `AuthRouteContext` with `{ user, role, activeOrganization }`. The `role` is already a domain role from `resolveTenantContext()`. Components access it via `useRouteContext({ from: '/_authenticated' })`. ✅

## Final Severity Counts

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 2     |
| MINOR    | 2     |
| NIT      | 6     |

**MAJOR (2):** (1) `toDomainRole()` called in identity adapter + server functions beyond the single auth middleware point — layering concern but not a security issue. (2) Identity server functions call `getAuth().api.*` directly, bypassing the application layer — intentional but undocumented exception.
