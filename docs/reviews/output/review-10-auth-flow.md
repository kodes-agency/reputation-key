# Code Review #10 — Auth Flow & Better-auth Integration

**Reviewer:** Automated Code Review  
**Date:** 2026-05-23  
**Scope:** `src/shared/auth/*`, `src/shared/domain/roles.ts`, `src/shared/domain/permissions.ts`, `src/shared/domain/auth-context.ts`, `src/shared/hooks/usePermissions.ts`, `src/routes/_authenticated.tsx`, `src/contexts/identity/` (auth-adjacent), `src/composition.ts`

---

## Summary

The auth integration is **well-architected**. The codebase correctly isolates better-auth behind a shared/auth boundary, uses domain roles everywhere in application/domain layers, and delegates permission checks through a clean `can()` API. Dynamic Access Control is enabled in the organization plugin. The tenant cache is sensible and well-tested.

No blockers were found. Several major findings relate to stale-cache risk after role/membership mutations, and a few minor naming inconsistencies exist.

---

## BLOCKER Findings

### B1. Domain code importing from better-auth directly

**Status: ✅ PASS**

No domain or application layer files import directly from `better-auth`. All `import ... from 'better-auth'` are confined to:

- `src/shared/auth/auth.ts`
- `src/shared/auth/auth-client.ts`
- `src/shared/auth/permissions.ts`
- `src/contexts/identity/infrastructure/adapters/` (adapter layer, which is infrastructure)
- `src/contexts/identity/infrastructure/adapters/better-auth-schemas.ts`

The identity adapter (`auth-identity.adapter.ts`) is in the **infrastructure** layer, which is architecturally correct — infrastructure implements ports defined by the application layer.

### B2. owner/admin/member strings appearing outside shared/auth/

**Status: ✅ PASS**

All occurrences of `'owner'`, `'admin'`, `'member'` in `src/contexts/` are:

1. **Test files** (`auth-identity.adapter.test.ts`, `better-auth-schemas.test.ts`) — acceptable; tests construct raw better-auth fixtures.
2. **`auth-identity.adapter.ts`** — infrastructure adapter; this is the boundary translation layer. Uses `toDomainRole()`/`toBetterAuthRole()` to convert.
3. **`organizations.ts` (server functions)** — uses `toDomainRole()` at the boundary to map raw responses.

No domain or application-layer code references better-auth role strings.

### B3. Dynamic Access Control bypassed by hard-coded role check

**Status: ✅ PASS**

All server function permission checks use `can(ctx.role, 'resource.action')` from `shared/domain/permissions`. No hard-coded `=== 'AccountAdmin'` checks found outside of:

- `hasRole()` hierarchy checks in `_authenticated.tsx` sidebar selection (correct usage per conventions)
- Test files

The permission table (`permissions.ts`) is built from `owner.statements`, `admin.statements`, `memberRole.statements` which are the better-auth `createAccessControl` role definitions. When dynamic AC creates custom roles, the `can()` lookup table is static — but this is noted as a **known limitation** (Phase 4 deferred per ADR 0001). Custom roles from the `organizationRole` table are currently only checked by better-auth's own `hasPermission` API, not by the application-layer `can()`. This is acceptable for Phase 3 but will need addressing in Phase 4.

### B4. Session/cookie read by anything other than auth middleware

**Status: ✅ PASS (with architectural note)**

Session/cookie reads occur in:

- `src/shared/auth/middleware.ts` — canonical location
- `src/shared/auth/auth.functions.ts` — route-level session helper (documented as route-level pattern)
- `src/shared/auth/headers.ts` — shared header extraction utility
- `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts` — `headersFromRequest()` reads `getRequest()` headers for better-auth API calls

The adapter's `headersFromRequest()` duplicates logic from `headers.ts`. This is an architectural smell but not a blocker — the adapter needs raw headers for better-auth API calls.

### B5. OAuth/SSO/passwordless auto-creating accounts incorrectly

**Status: ✅ PASS (N/A)**

No OAuth/SSO/passwordless auth providers are configured in `auth.ts`. The only social OAuth in the codebase is the **Google OAuth adapter** in `src/contexts/integration/`, which connects Google Business Profile accounts — this is an integration feature, not a user authentication mechanism. It correctly does NOT auto-create user accounts.

Email+password is the only configured auth method. Registration flows (`registerUserAndOrg`, `registerMember`) correctly go through `IdentityPort.signUp()` → `auth.api.signUpEmail()`.

---

## MAJOR Findings

### M1. resolveTenantContext() not memoized per-request

**Status: ✅ RESOLVED** (but with caveats)

The module-level `tenantCache` Map provides cross-request deduplication (5s TTL, max 100 entries). This works correctly for deduplicating concurrent server function calls during a single page load. Tests confirm cache hits/misses/TTL expiry.

**Caveat:** The cache is a **module-level singleton**, not per-request. Under high concurrency, different requests from the same user can hit the same cache entry. This is actually _correct behavior_ — the session cookie is the same — but the `clearTenantCache()` called at the end of every server function (via `tracedHandler`) evicts expired entries for _all_ concurrent requests, not just the current one. The 5s TTL makes this safe in practice.

The `clearTenantCache()` in `traced-server-fn.ts` only evicts **expired** entries (line 44-48), so it doesn't aggressively invalidate fresh entries from concurrent requests. Well-designed.

### M2. Tenant cache invalidation missing on membership/role change

**Status: ⚠️ MAJOR — Stale cache risk**

When `updateMemberRole` or `removeMember` completes, the server function's `tracedHandler` calls `clearTenantCache()` which only evicts **TTL-expired** entries. If the affected user has an active page load in progress (within the 5s TTL), subsequent server function calls from that page may resolve with a **stale role** from cache.

**Impact:** Low in practice. The 5s TTL is short. After the affected user navigates (triggering new beforeLoad → new resolveTenantContext), the TTL will have expired and fresh data is fetched. But within a single page load, role changes won't be visible.

**Recommendation:** Consider adding a targeted cache eviction by cookie key (or userId) in the `updateMemberRole` server function. Or reduce TTL to 2s for safety.

### M3. Route context duplicated in component props instead of hook

**Status: ✅ MOSTLY RESOLVED**

The `usePermissions()` hook correctly reads from route context:

```ts
const { role } = useRouteContext({ from: '/_authenticated' })
```

Components use `usePermissions()` correctly (e.g., `sortable-category.tsx`, `sortable-link.tsx`, `link-tree-category-list.tsx`). No `canEdit`/`canCreate`/`canDelete` prop-drilling pattern was found — the existing `canEdit`/`canManage` variables are local to components, derived from `usePermissions().can()`.

**One minor duplication:** `StaffSidebar` receives `organizations` and `activeOrganization` as props (line 156-162 of `_authenticated.tsx`). These come from the loader data / route context respectively. The `activeOrganization` could be read via `useRouteContext()` inside the component, but passing as props from the layout is also acceptable.

### M4. activeOrganization switching not invalidating cache

**Status: ⚠️ MAJOR — Real stale-data risk**

`setActiveOrganization` in `organizations.ts` (line 391-408) changes the session's active org. The client then invalidates `/_authenticated` routes (confirmed in `_authenticated.tsx` line 144). However:

1. The server-side tenant cache is **not invalidated** when the active org changes. The cache is keyed by raw cookie string. After `setActiveOrganization`, better-auth updates the session's `activeOrganizationId` in the DB, but the **cookie value doesn't change** — better-auth uses the same session token. So subsequent `resolveTenantContext` calls with the same cookie will return the **cached old org's role**.

2. The `clearTenantCache()` in `tracedHandler` only removes expired entries. Since TTL hasn't expired (just switched), the stale entry persists.

3. The `invalidateRoutes: ['/_authenticated']` triggers `beforeLoad` again, which calls `getActiveOrganization()` → `resolveTenantContext()`. If the cache still has the old entry (same cookie, TTL < 5s), it returns the stale `AuthContext`.

**Impact:** After switching organizations, the user may see the old org's permissions for up to 5 seconds. This could cause permission check failures or data leakage (showing data from the wrong org).

**Recommendation:** Call `resetTenantCache()` (or a targeted eviction) inside the `setActiveOrganization` server function, after the better-auth API call succeeds. The function already has `tracedHandler` which calls `clearTenantCache()`, but that only evicts expired entries. Need explicit full reset here.

---

## MINOR Findings

### m1. Inconsistent naming between AuthContext and route context fields

**Status: ⚠️ MINOR — Naming inconsistency**

| AuthContext (domain)             | AuthRouteContext (route)        |
| -------------------------------- | ------------------------------- |
| `userId: UserId`                 | `user.id: string`               |
| `organizationId: OrganizationId` | `activeOrganization.id: string` |
| `role: Role`                     | `role: Role` ✅                 |

The `role` field name is consistent. But the user and organization identifiers use different shapes and names:

- AuthContext has flat `userId` / `organizationId` (branded types)
- AuthRouteContext has nested `user.id` / `activeOrganization.id` (plain strings)

This is **intentional** — AuthContext is a minimal server-side identity token, while AuthRouteContext carries UI-relevant data (user name, org name, billing fields). Documented in CONTEXT.md. Acceptable but could benefit from a shared comment or type helper.

### m2. Duplicate headersFromRequest() in auth-identity.adapter.ts

The adapter has its own `headersFromRequest()` (line 32-41) that duplicates `headersFromContext()` from `src/shared/auth/headers.ts`. The implementation is identical. Should import from the shared module.

### m3. `role as Role` cast in \_authenticated.tsx

Line 81: `role = org.role as Role` — `org.role` comes from `getActiveOrganization()` which returns `ctx.role` (already a domain `Role` from `resolveTenantContext`). The cast is technically safe but masks the type flow. Consider making the return type of `getActiveOrganization` more precise.

### m4. usePermissions() has redundant `role as Role` cast

In `usePermissions.ts` line 15: `role: role as Role` — the `role` was already destructured as `{ role }` from `useRouteContext` cast as `{ role: Role }`, so the second cast is redundant.

### m5. getMember() fetches all members to find one

`auth-identity.adapter.ts` line 95-107: `getMember()` calls `auth.api.listMembers({ headers })` then filters in-memory. Better-auth may offer a `getMember()` API that's more efficient. This is a performance concern for large organizations.

### m6. Permission table doesn't include dynamic roles

The `can()` function uses a static permission table built from the three built-in roles. Dynamic Access Control (enabled via `dynamicAccessControl: true`) allows creating custom roles via better-auth, but these custom roles would NOT be recognized by `can()`. The `_table` only has entries for `AccountAdmin`, `PropertyManager`, `Staff`. This is acknowledged as a Phase 4 limitation (ADR 0001), but worth flagging.

---

## Auth Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COOKIE → can() CHECK FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

  Browser Cookie
       │
       ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ HOP 1: Cookie → Session                                                  │
  │                                                                          │
  │ File:  src/shared/auth/auth.functions.ts                                 │
  │ Func:  getSession() — createServerFn handler                             │
  │ Code:  getAuth().api.getSession({ headers })                             │
  │ Notes: Uses getRequestHeaders() to forward cookies server-side.          │
  │        Called from _authenticated.tsx beforeLoad.                         │
  │ Tests: ✅ middleware.test.ts covers getSessionFromHeaders                │
  └──────────────────────────┬───────────────────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ HOP 2: Session → Active Member Role                                      │
  │                                                                          │
  │ File:  src/shared/auth/middleware.ts                                     │
  │ Func:  resolveTenantContext(headers)                                     │
  │ Code:  session.session.activeOrganizationId →                            │
  │        auth.api.getActiveMember({ headers }) → member.role               │
  │ Cache: Module-level Map<string, {ctx, ts}>, 5s TTL, max 100 entries      │
  │        Keyed by raw cookie header string.                                │
  │ Tests: ✅ middleware.test.ts (lines 130-289)                             │
  │        Covers cache hit, TTL expiry, different cookies, all error paths  │
  └──────────────────────────┬───────────────────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ HOP 3: member.role → Domain Role (toDomainRole)                          │
  │                                                                          │
  │ File:  src/shared/domain/roles.ts                                        │
  │ Func:  toDomainRole(betterAuthRole: string): Role                        │
  │ Map:   'owner' → 'AccountAdmin'                                          │
  │        'admin'  → 'PropertyManager'                                      │
  │        'member' → 'Staff'                                                │
  │        unknown → throws Error                                            │
  │ Tests: ✅ roles.test.ts (lines 7-23)                                    │
  └──────────────────────────┬───────────────────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ HOP 4: Domain Role → AuthContext                                         │
  │                                                                          │
  │ File:  src/shared/auth/middleware.ts (line 145-149)                      │
  │ Code:  const ctx: AuthContext = {                                        │
  │          userId: userId(session.user.id),                                │
  │          organizationId: organizationId(activeOrgId),                    │
  │          role: toDomainRole(member.role),                                │
  │        }                                                                 │
  │ Type:  src/shared/domain/auth-context.ts                                 │
  │        { userId: UserId, organizationId: OrganizationId, role: Role }    │
  │ Tests: ✅ (covered in HOP 2 tests)                                      │
  └──────────────────────────┬───────────────────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ HOP 5: AuthContext → Permission Check (can)                              │
  │                                                                          │
  │ Server-side:                                                             │
  │   File:  src/shared/domain/permissions.ts                                │
  │   Func:  can(role: Role, permission: Permission): boolean               │
  │   Impl:  Delegates to injected _lookup from shared/auth/permissions.ts  │
  │   Init:  initPermissionTable() builds Sets from role statements          │
  │   Tests: ✅ permissions.test.ts                                          │
  │                                                                          │
  │ Client-side:                                                             │
  │   File:  src/shared/hooks/usePermissions.ts                              │
  │   Func:  usePermissions() → { role, can(permission) }                    │
  │   Reads: useRouteContext({ from: '/_authenticated' }) → role            │
  │   Tests: ❌ NO UNIT TESTS for usePermissions hook                       │
  └──────────────────────────┬───────────────────────────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ ROUTE-LEVEL PATH (parallel to server functions)                          │
  │                                                                          │
  │ File:  src/routes/_authenticated.tsx                                     │
  │ Func:  beforeLoad()                                                      │
  │ Flow:  getSession() → getActiveOrganization() → resolveTenantContext()  │
  │        → returns AuthRouteContext { user, role, activeOrganization }     │
  │ Tests: ❌ NO UNIT TESTS for _authenticated beforeLoad                   │
  │                                                                          │
  │ The beforeLoad duplicates some of the resolveTenantContext logic:        │
  │ it calls getActiveOrganization() which internally calls                  │
  │ resolveTenantContext(), then extracts role from the response.            │
  └──────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                      HOPS WITHOUT TESTS                                     │
└─────────────────────────────────────────────────────────────────────────────┘

  ❌ HOP 5 client-side: usePermissions() hook — no unit test
     The hook reads from TanStack Router context which requires a router
     wrapper. Integration tests may cover this indirectly.

  ❌ Route beforeLoad: _authenticated.tsx beforeLoad — no unit test
     This is a complex function with multiple error paths (no session,
     no active org, network error). Only tested via E2E.

  ❌ auth.functions.ts: getSession(), ensureActiveOrg() — no dedicated tests
     Thin wrappers around getAuth().api.getSession().

  ❌ auth-client.ts: No tests for client-side auth configuration

  ❌ Composition root wiring: setOnAcceptInvitation hook not tested directly
     (covered indirectly by integration tests)


┌─────────────────────────────────────────────────────────────────────────────┐
│                      CACHE LIFECYCLE                                        │
└─────────────────────────────────────────────────────────────────────────────┘

  Request arrives
       │
       ▼
  tracedHandler() wraps every server function
       │
       ├─► resolveTenantContext() checks tenantCache (5s TTL, keyed by cookie)
       │   ├─ Cache HIT  → return cached AuthContext (no DB call)
       │   └─ Cache MISS → getSession + getActiveMember → build AuthContext → cache it
       │
       ├─► ... handler logic ...
       │
       └─► clearTenantCache() — evicts EXPIRED entries only (not fresh ones)
           Called in both success and error paths


┌─────────────────────────────────────────────────────────────────────────────┐
│                      FILES REVIEWED                                         │
└─────────────────────────────────────────────────────────────────────────────┘

  Core Auth:
    ✅ src/shared/auth/auth.ts             — Better-auth server config
    ✅ src/shared/auth/auth-client.ts      — Better-auth client config
    ✅ src/shared/auth/middleware.ts        — resolveTenantContext, cache
    ✅ src/shared/auth/middleware.test.ts   — Unit tests
    ✅ src/shared/auth/permissions.ts       — Permission table + init
    ✅ src/shared/auth/permissions.test.ts  — Tests
    ✅ src/shared/auth/auth.functions.ts    — Server functions for route auth
    ✅ src/shared/auth/headers.ts           — headersFromContext utility
    ✅ src/shared/auth/server-errors.ts     — Error translation
    ✅ src/shared/auth/emails.ts            — Email sending

  Domain Types:
    ✅ src/shared/domain/roles.ts           — Role type + toDomainRole
    ✅ src/shared/domain/roles.test.ts      — Tests
    ✅ src/shared/domain/permissions.ts     — can() + Permission type
    ✅ src/shared/domain/auth-context.ts    — AuthContext type
    ✅ src/shared/domain/ids.ts             — Branded ID types

  Client Hooks:
    ✅ src/shared/hooks/usePermissions.ts   — Client permission hook

  Route Integration:
    ✅ src/routes/_authenticated.tsx        — Authenticated layout + beforeLoad

  Identity Context:
    ✅ src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts
    ✅ src/contexts/identity/infrastructure/adapters/better-auth-schemas.ts
    ✅ src/contexts/identity/server/organizations.ts
    ✅ src/contexts/identity/application/use-cases/register-user-and-org.ts
    ✅ src/contexts/identity/application/use-cases/update-member-role.ts

  Wiring:
    ✅ src/composition.ts                   — Composition root
    ✅ src/shared/observability/traced-server-fn.ts

  ADR:
    ✅ docs/adr/0001-dynamic-access-control.md


┌─────────────────────────────────────────────────────────────────────────────┐
│                      VERDICT                                                │
└─────────────────────────────────────────────────────────────────────────────┘

  Blockers:   0  (all 5 checks pass)
  Major:      2  (M2: stale cache on role change, M4: stale cache on org switch)
  Minor:      6  (naming inconsistency, duplicate code, redundant casts, etc.)

  Overall:    The auth integration is clean and well-structured. The better-auth
              boundary is properly isolated. Dynamic AC is enabled but the static
              can() table will need extension for custom roles (Phase 4). The two
              major findings are cache invalidation gaps that could cause brief
              permission staleness after org switch or role change — low impact
              due to the 5s TTL but should be addressed before Phase 4.
```
