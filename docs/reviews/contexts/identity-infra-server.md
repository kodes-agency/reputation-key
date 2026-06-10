# Identity Context — Infrastructure & Server Review

**Reviewer:** automated deep review
**Date:** 2026-06-10
**Scope:** `src/contexts/identity/infrastructure/`, `src/contexts/identity/server/`
**Dimensions:** D5 (repository ports), D7 (multi-tenancy), D8 (server functions), D12 (CONTEXT.md accuracy), D15 (error handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 7     |
| MINOR    | 5     |
| NIT      | 4     |

---

## D5 — Repository & Port Standards

### [D5] MAJOR — Adapter factory takes no DB parameter, defers to better-auth's active session

File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:67
Quote: ```ts
export function createBetterAuthIdentityAdapter(): IdentityPort {
const auth = getAuth()

````
Rule:  D5 — "create{Entity}Repository(db) factory" pattern for port adapters
Fix:   Identity context wraps better-auth rather than owning a DB, so the standard repository pattern doesn't apply directly. However, the port is `IdentityPort` not `{Entity}Repository`, and the factory takes no DI parameters (not even a db). This is architecturally correct for a thin wrapper context but deviates from the standard port naming pattern. Consider documenting this deviation in CONTEXT.md or in ARCHITECTURE.md.

### [D5] MINOR — Port `listMembers` and `listInvitations` accept `ctx: AuthContext` but never use it
File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:86-87
Quote: ```ts
  async listMembers(_ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
    const headers = await headersFromRequest()
````

Rule: D5 — adapter should return domain types derived from the provided context
Fix: The `_ctx` parameter is unused in `listMembers`, `getMember`, `createInvitation`, `listInvitations`, `updateMemberRole`, and `removeMember`. The adapter relies on better-auth's session-scoped headers instead of the passed `organizationId` from ctx. This means the tenant scope comes from the session cookie, not from the explicit context. While this works because better-auth is session-bound, it means the port cannot enforce multi-tenancy through the context parameter — the context is dead input.

---

## D7 — Multi-Tenancy

### [D7] MAJOR — `listMembers` adapter fetches members for the session's active org without explicit organizationId scope

File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:86-97
Quote: ```ts
async listMembers(\_ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
const headers = await headersFromRequest()
const result = await auth.api.listMembers({ headers })

````
Rule:  D7 — "Every DB query on tenant-owned table has organizationId"
Fix:   The adapter calls `auth.api.listMembers` which is scoped to the session's active org. However, the passed `AuthContext` contains an explicit `organizationId` that is ignored (`_ctx`). If a bug elsewhere sets a mismatched active org, the listMembers result will be for the wrong tenant with no cross-check. Add a defensive assertion that the returned members belong to the expected org, or at minimum pass `organizationId` through if better-auth supports it.

### [D7] MAJOR — `getMember` fetches all members then filters client-side by ID — no tenant-guaranteed scoping
File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:99-111
Quote: ```ts
  async getMember(_ctx: AuthContext, memberId: string): Promise<MemberRecord | null> {
    const headers = await headersFromRequest()
    const result = await auth.api.listMembers({ headers })
    ...
    const member = data.members.find((m) => m.id === memberId)
````

Rule: D7 — "Every DB query on tenant-owned table has organizationId"
Fix: `getMember` fetches the entire member list then filters client-side. This is (a) inefficient and (b) relies entirely on better-auth's session scoping. If better-auth ever returns cross-org data, this would leak members. Prefer a direct member lookup API if available, or at minimum validate the returned member's org matches ctx.organizationId.

### [D7] MAJOR — `updateMemberRole` and `removeMember` accept `_ctx` but never verify the target member belongs to the context's organization

File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:197-218
Quote: ```ts
async updateMemberRole(
\_ctx: AuthContext,
memberId: string,
role: string,
): Promise<void> {
const headers = await headersFromRequest()
await auth.api.updateMemberRole({
headers,
body: { memberId, role: toBetterAuthRole(...) },
})
},
async removeMember(\_ctx: AuthContext, memberId: string): Promise<void> {
const headers = await headersFromRequest()
await auth.api.removeMember({
headers,
body: { memberIdOrEmail: memberId },
})
},

````
Rule:  D7 — "Every DB query on tenant-owned table has organizationId"
Fix:   Both mutations operate on a `memberId` without verifying the member belongs to the active organization in ctx. If better-auth's session is somehow misconfigured, this could modify/remove a member from a different org. Add a pre-check (e.g., fetch the member first and verify org ownership) or verify after the call.

### [D7] MINOR — `createInvitation` ignores ctx.organizationId, relies on session scope
File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:113-138
Quote: ```ts
  async createInvitation(
    _ctx: AuthContext,
    email: string,
    role: string,
    propertyIds?: ReadonlyArray<string>,
  ): Promise<InvitationId> {
    const headers = await headersFromRequest()
    const result = await auth.api.createInvitation({
      headers,
      body: { email, role: toBetterAuthRole(...), propertyIds: ... },
````

Rule: D7 — organizationId from AuthContext, never request body/query
Fix: The invitation is created under whatever org better-auth's session is currently scoped to. The use case passes `ctx.organizationId` to the use case but the adapter never uses it. While consistent with better-auth's session model, it means the architecture's explicit tenant context is not the source of truth.

---

## D8 — Server Functions

### [D8] MAJOR — `getActiveOrganization` bypasses the use case layer and calls `getAuth().api.getFullOrganization` directly

File: src/contexts/identity/server/organizations.query.ts:36-52
Quote: ```ts
const auth = getAuth()
const org = await auth.api.getFullOrganization({ headers })
...
return {
organization: {
id: org.id,
name: org.name,
slug: org.slug,
logo: org.logo ?? null,
createdAt: org.createdAt,
...extractOrgBillingFields(org),
},
role: ctx.role,
}

````
Rule:  D8 — "server/ imports application/ + shared/ + TanStack Start. Forbidden: business logic, direct DB access"
Fix:   This server function performs business logic (mapping, field extraction) and directly accesses the better-auth API instead of going through a use case or the adapter port. Extract this into a use case or at minimum call through the adapter.

### [D8] MAJOR — `listMembers` server function bypasses the use case and calls `getAuth().api.listMembers` directly
File: src/contexts/identity/server/organizations.query.ts:79-97
Quote: ```ts
      const auth = getAuth()
      const result = await auth.api.listMembers({ headers })
      const rawMembers = (result?.members ?? ...) as AuthMemberResponse[] | null
      ...
      const members = rawMembers.map((m) => ({ ... }))
````

Rule: D8 — server/ should not contain business logic or direct data access
Fix: The server function manually parses and maps better-auth response data, duplicating logic from the adapter's `toMemberRecord`. This should go through `useCases.listMembers()` or at minimum through the adapter port.

### [D8] MAJOR — `cancelInvitation` calls `getAuth().api.cancelInvitation` directly instead of through a use case

File: src/contexts/identity/server/organizations.invitations.ts:64-68
Quote: ```ts
const auth = getAuth()
await auth.api.cancelInvitation({
headers,
body: { invitationId: data.invitationId },
})

````
Rule:  D8 — mutations should go through use cases, not call infrastructure directly from server/
Fix:   `cancelInvitation` directly calls the better-auth API from the server function. This bypasses the use case layer and loses the ability to emit domain events (e.g., there is no `identity.invitation.canceled` event, but if one were needed, the architecture can't support it from here). Create a `cancelInvitation` use case.

### [D8] MINOR — `acceptInvitation` calls `getAuth().api.acceptInvitation` directly with no use case
File: src/contexts/identity/server/organizations.invitations.ts:28-33
Quote: ```ts
        const auth = getAuth()
        await auth.api.acceptInvitation({
          headers,
          body: { invitationId: data.invitationId },
        })
````

Rule: D8 — mutations should go through use cases
Fix: The accept invitation has no use case. If an event needs to be emitted on invitation acceptance (CONTEXT.md lists `identity.invitation.accepted`), there's no place to do it. Note: the event `identity.invitation.accepted` exists in CONTEXT.md but this server function doesn't emit it.

### [D8] MINOR — `listUserOrganizations` calls `getAuth().api.listOrganizations` directly

File: src/contexts/identity/server/organizations.query.ts:117-131
Quote: ```ts
const auth = getAuth()
const result = await auth.api.listOrganizations({ headers })
const rawOrgs = (Array.isArray(result) ? result : []) as AuthOrganizationResponse[]

````
Rule:  D8 — server/ should not contain direct infrastructure access
Fix:   Calls better-auth directly instead of through the adapter port. The adapter already has `listUserOrganizations` — use it.

### [D8] MINOR — `listUserInvitations` in registration.ts calls `getAuth().api.listUserInvitations` directly
File: src/contexts/identity/server/organizations.registration.ts:123-139
Quote: ```ts
      const auth = getAuth()
      const result = await auth.api.listUserInvitations({ headers })
      const rawInvitations = (Array.isArray(result) ? result : []) as AuthInvitationResponse[]
      const invitations = rawInvitations.map((inv) => ({ ... }))
````

Rule: D8 — server/ should delegate to use cases or adapter ports
Fix: The adapter already has `listUserInvitations` method. This server function duplicates the mapping logic. Use the adapter.

### [D8] NIT — `signInUser` uses dynamic import for logger and PII inside handler

File: src/contexts/identity/server/organizations.registration.ts:75-77
Quote: ```ts
const { getLogger } = await import('#/shared/observability/logger')
const { maskEmail } = await import('#/shared/observability/pii')

````
Rule:  D8 — server functions should have static imports for clarity
Fix:   The dynamic imports are used inside the catch block. While they work, they make the dependency graph invisible to static analysis. Use top-level imports instead.

---

## D12 — CONTEXT.md Accuracy

### [D12] MAJOR — CONTEXT.md lists `acceptInvitation` as server function with permission `authenticated`, but the actual function never emits `identity.invitation.accepted` event
File: src/contexts/identity/CONTEXT.md:43,103
Quote: ```
| `identity.invitation.accepted`  | organizationId, userId, role, invitationId               | Invitation accepted     |
...
| `acceptInvitation`      | POST   | authenticated        | Accept pending invitation       |
````

Rule: D12 — verify CONTEXT.md events match actual code
Fix: CONTEXT.md declares `identity.invitation.accepted` as a produced event, but the `acceptInvitation` server function (organizations.invitations.ts:20-41) calls `auth.api.acceptInvitation` directly with no event emission. Either the event is emitted elsewhere (check composition/event bus), or this is a stale claim. If the event is never emitted, remove it from CONTEXT.md or add emission.

### [D12] MINOR — CONTEXT.md lists `createOrganizationFn` as a server function but does not document the auth-settings.org.ts file in architecture layers

File: src/contexts/identity/CONTEXT.md:67,98
Quote: ```  |`createOrganizationFn` | POST | authenticated | Create new organization |
...
server/ organizations.ts, auth-settings.ts

````
Rule:  D12 — CONTEXT.md architecture section should list all files
Fix:   The server/ directory contains `auth-settings.org.ts`, `organizations.members.ts`, `organizations.invitations.ts`, `organizations.registration.ts`, `organizations.query.ts`, `organizations.update.ts`, `organizations.upload.ts`, `auth-settings.helpers.ts`, and test files, but CONTEXT.md only lists `organizations.ts, auth-settings.ts`. Update the architecture section to reflect the actual file split.

### [D12] MINOR — CONTEXT.md events section claims `identity.invitation.rejected` is produced but no code path emits it
File: src/contexts/identity/CONTEXT.md:43
Quote: ```
| `identity.invitation.rejected`  | organizationId, invitationId, email                      | Invitation rejected     |
````

Rule: D12 — CONTEXT.md events consumed/produced must match actual code
Fix: No server function or use case in the reviewed infrastructure/server layers emits `identity.invitation.rejected`. The adapter has `rejectInvitation` but the server functions never call it (there is no `rejectInvitation` server function in the barrel export). Either this event is produced by a different path or the claim is stale.

### [D12] NIT — CONTEXT.md permission `organization.update` vs code's `org:manage` permission check

File: src/contexts/identity/CONTEXT.md:127
Quote: ```

- `organization.update` — Update organization settings (name, slug, billing info)

````
Rule:  D12 — CONTEXT.md permissions should match actual permission checks in code
Fix:   CONTEXT.md lists `organization.update` but the `updateOrganization` server function (organizations.update.ts) doesn't check any permission at all — it delegates auth to the use case. The CONTEXT.md server functions table says `org:manage` for `updateOrganization`, but the permissions section lists `organization.update`. These appear to be two different naming conventions. Reconcile — either the CONTEXT.md permissions section should use `org:manage` or the code should use `organization.update`.

---

## D15 — Error Handling

### [D15] MAJOR — `catch` block in `headersFromRequest` silently swallows all errors
File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:41-43
Quote: ```ts
  } catch {
    // Outside server context (e.g., worker) — return empty headers
  }
````

Rule: D15 — "No bare catch, no HTTP codes in domain, consistent error envelope"
Fix: This is a bare catch with no error binding. If the import fails for a reason other than "not in server context" (e.g., a module resolution error), it will be silently swallowed and the adapter will proceed with empty headers, likely causing cryptic auth failures downstream. At minimum, log the error or check the error type.

### [D15] NIT — `getActiveOrganization` server function has inconsistent error handling — outer catch wraps the entire body but `throwContextError` at line 27 is already inside try

File: src/contexts/identity/server/organizations.query.ts:23-57
Quote: ```ts
try {
...
if (!can(ctx.role, 'dashboard.read')) {
throwContextError('AuthError', { code: 'forbidden', ... }, 403)
}
...
} catch (e) {
throw catchUntagged(e)
}

````
Rule:  D15 — consistent error handling pattern
Fix:   The `throwContextError` at line 27 throws inside the `try` block. The `catch` at line 55 calls `catchUntagged(e)`. If `throwContextError` throws a non-ContextError, it would be re-wrapped. This works but is inconsistent with other server functions that do permission checks before the try block (e.g., `inviteMember` in members.ts). Move the permission check before the try for consistency.

### [D15] NIT — `handleAuthError` returns `never` but the catch blocks that call it have no post-catch handling
File: src/contexts/identity/server/auth-settings.helpers.ts:8-58
Quote: ```ts
export const handleAuthError = (
  error: unknown,
  errorName: string,
  code: string,
  fallbackMessage: string,
): never => {
````

Rule: D15 — consistent error handling
Fix: `handleAuthError` is typed as `never` which is correct. However, TypeScript may not enforce unreachable code after the catch block in all versions. This is a minor style concern — the pattern is safe but could confuse readers who expect a return after catch.

---

## Additional Findings

### [D1] NIT — `organizations.shared.ts` contains `extractOrgBillingFields` with `as Record<string, unknown>` type assertion

File: src/contexts/identity/server/organizations.shared.ts:87
Quote: ```ts
const o = org as Record<string, unknown>

````
Rule:  D1 — server/ should have typed data flow
Fix:   The function accepts `unknown` and asserts to `Record<string, unknown>`. This bypasses type safety. Define a proper type for the org response that includes billing fields (the `AuthOrganizationResponse` type already exists and includes them) and remove this function or type it properly.

### [D8] MAJOR — Several server functions bypass the use case / adapter port layer and call `getAuth().api.*` directly
File: src/contexts/identity/server/organizations.query.ts:36,79
File: src/contexts/identity/server/organizations.invitations.ts:64
File: src/contexts/identity/server/organizations.registration.ts:123
Quote: ```ts
// getActiveOrganization
const auth = getAuth()
const org = await auth.api.getFullOrganization({ headers })

// listMembers
const auth = getAuth()
const result = await auth.api.listMembers({ headers })

// cancelInvitation
const auth = getAuth()
await auth.api.cancelInvitation({ headers, body: { invitationId: ... } })

// listUserInvitations
const auth = getAuth()
const result = await auth.api.listUserInvitations({ headers })
````

Rule: D8 — "server/ imports application/ + shared/ + TanStack Start. Forbidden: business logic, direct DB access"
Fix: These 4 server functions call `getAuth().api.*` directly, duplicating logic from the adapter layer. The adapter (`createBetterAuthIdentityAdapter`) already implements all these methods with Zod validation. The server functions should go through the adapter port or through use cases, not call better-auth directly. This creates two parallel code paths that can drift.

### [D7] MAJOR — `updateOrganization` server function passes no permission check in the server layer, delegates entirely to use case

File: src/contexts/identity/server/organizations.update.ts:37-49
Quote: ```ts
async ({ data }) => {
const headers = await headersFromContext()
const ctx = await resolveTenantContext(headers)
// No permission check here
try {
const useCase = updateOrganizationUseCase({ ... })
await useCase(data, ctx)

````
Rule:  D8 — "Wrapped in tracedServerFn, auth middleware, input validation, permission check, use case from composition"
Fix:   The comment says "Per architecture: authorization lives in the use case, not the server function." However, the D8 standard says server functions should have a permission check. Other server functions in this context (inviteMember, updateMemberRole, etc.) check `can(ctx.role, ...)` before calling the use case. `updateOrganization` is inconsistent. Add `can(ctx.role, 'org:manage')` check or document why this one differs.

### [D15] MINOR — `acceptInvitation` server function catches all errors with `catchUntagged` but doesn't check for `isIdentityError`
File: src/contexts/identity/server/organizations.invitations.ts:34-36
Quote: ```ts
      } catch (e) {
        throw catchUntagged(e)
      }
````

Rule: D15 — "No bare catch, consistent error envelope"
Fix: Other server functions in the same file check `isIdentityError(e)` before calling `throwIdentityError(e)`, then fall back to `catchUntagged(e)` for untagged errors. This function skips the `isIdentityError` check, meaning domain errors won't get proper HTTP status mapping via `identityErrorStatus`. Add the same `isIdentityError` guard pattern.

### [D5] MINOR — `createInvitation` adapter coerces role with `as ReturnType<typeof toDomainRole>` — unsafe cast

File: src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:124
Quote: ```ts
role: toBetterAuthRole(role as ReturnType<typeof toDomainRole>),

```
Rule:  D5 — adapter should handle types safely
Fix:   The role parameter is typed as `string` in the adapter but cast to `Role` via `as`. This is an unsafe cast — if the string is not a valid role, `toBetterAuthRole` may produce unexpected output. The port signature types it as `Role`, but the adapter implementation overrides with `string`. Fix the adapter signature to use the port's `Role` type or add a validation step.
```
