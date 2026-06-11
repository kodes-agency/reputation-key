# Identity Context — Domain & Application Layer Review

**Reviewer:** automated deep review  
**Date:** 2026-06-10  
**Scope:** `src/contexts/identity/domain/`, `src/contexts/identity/application/`, `src/contexts/identity/build.ts`  
**Dimensions:** D2 (events), D3 (use cases), D4 (build function), D11 (domain purity), D12 (CONTEXT.md accuracy), D15 (error handling)

---

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 2     |
| MAJOR    | 7     |
| MINOR    | 5     |
| NIT      | 3     |

---

## Findings

### [D11] BLOCKER Domain events.ts uses `crypto.randomUUID()` directly instead of IdGenerator port

File: src/contexts/identity/domain/events.ts:31,55,77,98,120,147
Quote: ```ts
eventId: crypto.randomUUID(),

````
Rule:  Domain purity (D11) — "UUID via IdGenerator" port; domain layer must not depend on platform globals.
Fix:   Accept an `idGen: () => string` parameter in each constructor (or a shared options bag), mirroring the `clock` pattern already used by use cases. The constructors already take `args` — add `eventId` generation via an injected `idGen` or use the same `Omit` pattern used for `correlationId`.

---

### [D11] BLOCKER Domain events.ts imports `node:assert/strict` — Node.js runtime dependency

File: src/contexts/identity/domain/events.ts:10
Quote: ```ts
import assert from 'node:assert/strict'
````

Rule: Domain purity (D11) — domain layer must not import Node.js builtins, I/O, or runtime-specific modules.
Fix: Replace `assert()` calls with manual conditional checks that throw `identityError('validation_error', ...)` or return a `Result`. Since the constructors currently throw on invalid input, use a domain-native validation approach consistent with the error handling pattern in `rules.ts`.

---

### [D2] MAJOR `identityInvitationAccepted` and `identityInvitationRejected` constructors defined but never used

File: src/contexts/identity/domain/events.ts:71-81,92-102
Quote: ```ts
export const identityInvitationAccepted = (
args: Omit<IdentityInvitationAccepted, '\_tag' | 'eventId' | 'correlationId'>,
): IdentityInvitationAccepted => { ... }

````
Rule:  D2 4-layer consistency — "definition → constructor → union → handler" must all be present. These two events are defined and in the union, but no handler emits them.
Fix:   Either implement the accept/reject invitation use cases that emit these events (and add them to build.ts), or document them as planned-but-not-yet-implemented with a tracking issue. The comment at lines 4-8 acknowledges this but it should be tracked.

---

### [D2] MAJOR `identityInvitationAccepted` and `identityInvitationRejected` constructors not re-exported from public-api

File: src/contexts/identity/application/public-api.ts:5-10
Quote: ```ts
export {
  identityOrganizationCreated,
  identityMemberInvited,
  identityMemberRemoved,
  identityMemberRoleChanged,
} from '../domain/events'
````

Rule: D2 — CONTEXT.md §Public API claims re-export of `identityInvitationAccepted` and `identityInvitationRejected` constructors, but they are missing from public-api.ts. Only the _types_ are re-exported (line 14-15), not the constructors.
Fix: Add `identityInvitationAccepted` and `identityInvitationRejected` to the constructor re-export block, or remove them from CONTEXT.md's claim if intentionally omitted.

---

### [D4] MAJOR build.ts does not wire 4 upload use cases (requestAvatarUpload, finalizeAvatarUpload, requestOrgLogoUpload, finalizeOrgLogoUpload)

File: src/contexts/identity/build.ts:58-95
Quote: ```ts
const useCases = {
inviteMember: ...
updateMemberRole: ...
removeMember: ...
listInvitations: ...
resendInvitation: ...
registerUserAndOrg: ...
registerUser: ...
updateOrganization: ...
} as const

````
Rule:  D4 — build function must compose all use cases. CONTEXT.md §Use cases lists `requestOrgLogoUpload`, `finalizeOrgLogoUpload`, `requestAvatarUpload`, `finalizeAvatarUpload` — none appear in build.ts.
Fix:   Import and wire the 4 upload use cases in `buildIdentityContext`. They depend on `StoragePort` which needs to be added to `IdentityContextDeps`.

---

### [D1] MAJOR Upload use cases in application/ import across context boundary (`#/contexts/portal`)

File: src/contexts/identity/application/use-cases/request-avatar-upload.ts:4
Quote: ```ts
import type { StoragePort } from '#/contexts/portal/application/public-api'
````

Rule: D1 — application layer may import domain/ + shared/ only. Cross-context imports to another context's application layer violate layer boundaries.
Fix: Define a `StoragePort` type in `shared/` or in identity's own `application/ports/`, then have the portal context's adapter satisfy it. Identity's application layer should not know about portal.

---

### [D3] MAJOR `updateOrganization` use case accepts `Headers` via deps — framework object in application layer

File: src/contexts/identity/application/use-cases/update-organization.ts:9
Quote: ```ts
export type UpdateOrganizationDeps = Readonly<{
updateOrg: (headers: Headers, data: Record<string, unknown>) => Promise<void>
getHeaders: () => Headers | Promise<Headers> | undefined
}>

````
Rule:  D3 — "No framework objects" in use cases. `Headers` is a Web API type leaking into the application layer.
Fix:   Abstract the `updateOrg` dependency to accept a plain data bag without requiring `Headers`. Move header construction to the server function layer and pass only the necessary data down.

---

### [D3] MAJOR `registerUserAndOrg` use case accepts `Headers` via deps — framework object in application layer

File: src/contexts/identity/application/use-cases/register-user-and-org.ts:34-44
Quote: ```ts
createOrg: (
  headers: Headers,
  name: string,
  slug: string,
  userId?: string,
) => Promise<string>
...
headers: () => Headers | Promise<Headers>
````

Rule: D3 — "No framework objects" in use cases. Same `Headers` leak as update-organization.
Fix: Refactor deps so that header resolution is external to the use case. The server function can resolve headers and pass them through an opaque session token or callback that hides the `Headers` type from the use case.

---

### [D12] MAJOR CONTEXT.md §Use cases claims `requestOrgLogoUpload` and `finalizeOrgLogoUpload` input includes `organizationId` — actual code takes `contentType`/`key`

File: src/contexts/identity/CONTEXT.md:82-83
Quote: ```  |`requestOrgLogoUpload` |`organizationId`, `contentType`                           |`{ uploadUrl, key }`|`org:manage`        |
  |`finalizeOrgLogoUpload`|`organizationId`, `key`                                   |`Organization`      |`org:manage` |

````
Rule:  D12 — CONTEXT.md must match actual code.
Fix:   Update CONTEXT.md: `requestOrgLogoUpload` input is `{ contentType, fileSize }` (no explicit `organizationId` — it comes from `ctx.organizationId`). `finalizeOrgLogoUpload` input is `{ key }`. Output is `{ logoUrl }` not `Organization`. Permission is `identity.logo_upload` not `org:manage`.

---

### [D12] MINOR CONTEXT.md §Use cases claims `requestAvatarUpload`/`finalizeAvatarUpload` input includes `userId` — actual code uses `ctx.userId`

File: src/contexts/identity/CONTEXT.md:84-85
Quote: ```
| `requestAvatarUpload`   | `userId`, `contentType`                                    | `{ uploadUrl, key }` | authenticated        |
| `finalizeAvatarUpload`  | `userId`, `key`                                            | `User`               | authenticated        |
````

Rule: D12 — CONTEXT.md must match actual code.
Fix: `requestAvatarUpload` input is `{ contentType, fileSize }`, not `{ userId, contentType }`. `finalizeAvatarUpload` input is `{ key }` not `{ userId, key }`. Output is `{ avatarUrl }` not `User`. Permission is `identity.avatar_upload` not `authenticated`.

---

### [D12] MINOR CONTEXT.md §Permissions lists `org:manage` and `org:manage_members` — actual code uses granular permissions

File: src/contexts/identity/CONTEXT.md:125-137
Quote: ```

- `organization.update` — Update organization settings (name, slug, billing info)
- `member.update` — Change member roles
- `member.delete` — Remove members from organization
  ...

````
Rule:  D12 — CONTEXT.md §Server functions table says `org:manage_members` and `org:manage`, but §Permissions section lists granular permissions like `member.update`, `member.delete`, `invitation.create`, etc. The actual `can()` calls in code use the granular permissions.
Fix:   Reconcile the Server functions table to use actual permission strings from `can()` calls (`invitation.create`, `member.delete`, `organization.update`, etc.) instead of the higher-level `org:manage_members` / `org:manage`.

---

### [D12] MINOR CONTEXT.md §Events table has misaligned columns

File: src/contexts/identity/CONTEXT.md:37-44
Quote: ```
|                                 | Tag                                                      | Payload                 | When |
| ------------------------------- | -------------------------------------------------------- | ----------------------- | ---- |
| `identity.organization.created` | organizationId, organizationName, slug, ownerId          | Organization created    |
````

Rule: D12 — CONTEXT.md accuracy. The table header has 4 columns but rows have 3. The first column appears to be the tag, not the "name" column.
Fix: Fix the markdown table so the Tag column matches the first data column. Either add a "Name" header or remove the empty first column.

---

### [D15] MINOR `registerUser` use case wraps identity port error with try/catch but re-throws as identityError — loses stack trace

File: src/contexts/identity/application/use-cases/register-user.ts:34-42
Quote: ```ts
try {
const userId = await deps.identity.signUp(input.name, input.email, input.password)
return userId
} catch (e) {
throw identityError(
'registration_failed',
e instanceof Error ? e.message : 'Registration failed',
)
}

````
Rule:  D15 — error handling should preserve cause chain for debugging.
Fix:   Pass the original error as `context: { cause: e }` to `identityError()` so the stack trace is not lost, or use a `cause` field on the error type.

---

### [D3] NIT `removeMember` return type is `{ success: boolean }` instead of `void` as claimed in CONTEXT.md

File: src/contexts/identity/application/use-cases/remove-member.ts:18-19
Quote: ```ts
export type RemoveMemberOutput = Readonly<{
  success: boolean
}>
````

Rule: D3 — CONTEXT.md §Use cases says `removeMember` output is `void`.
Fix: Either update CONTEXT.md to reflect `{ success: boolean }` or change the use case to return `void` (preferred — the `success: boolean` wrapper is redundant when errors are thrown).

---

### [D3] NIT `listInvitations` input type is `void` but use case still accepts `_input` parameter

File: src/contexts/identity/application/use-cases/list-invitations.ts:10,30
Quote: ```ts
export type ListInvitationsInput = void
...
\_input: ListInvitationsInput,

````
Rule:  D3 — unnecessary parameter when input is void.
Fix:   Remove the `_input` parameter and update the function signature to `async (ctx: AuthContext)`.

---

### [D2] NIT Event constructors assert with `node:assert/strict` but domain rules use `Result` return — inconsistent validation strategy

File: src/contexts/identity/domain/events.ts:27,51
Quote: ```ts
assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
assert(args.userId !== '', 'userId required')
````

Rule: D2 — Constructor validation should use the same error strategy as domain rules (tagged errors), not assertions that throw untyped exceptions.
Fix: Use `identityError()` with `Result` return, consistent with `rules.ts`. Or at minimum, replace `node:assert` with a domain-native throw of `identityError`.

---

### [D4] MINOR build.ts `registerUser` use case wired with only `identity` port but build function requires different deps shape

File: src/contexts/identity/build.ts:90
Quote: ```ts
registerUser: registerUser({ identity: deps.identityPort }),

````
Rule:  D4 — The `registerUser` use case's `RegisterUserDeps` expects `{ identity: IdentityPort }` which matches, but the build function's `IdentityContextDeps` doesn't expose the full `IdentityPort` capability (it has separate `signUp`, `createOrg`, etc.). This wiring works because `identityPort` implements `IdentityPort` which includes `signUp`, but creates a discrepancy with `registerUserAndOrg` which takes individual functions instead of the port.
Fix:   Normalize: either all registration use cases use `IdentityPort`, or all use individual function deps. Current mix is inconsistent.

---

### [D3] MINOR `updateOrganization` use case does not call domain `validateSlug`/`validateOrganizationName` rules before delegating

File: src/contexts/identity/application/use-cases/update-organization.ts:25-67
Quote: ```ts
export const updateOrganization =
  (deps: UpdateOrganizationDeps) =>
  async (input: UpdateOrganizationInput, ctx: AuthContext): Promise<void> => {
    if (!can(ctx.role, 'organization.update')) { ... }
    const updateData: Record<string, unknown> = { ... }
    await deps.updateOrg(headers, updateData)
  }
````

Rule: D3 — use cases should validate domain rules before persisting. If `input.slug` is provided, `validateSlug()` should be called; if `input.name`, `validateOrganizationName()`.
Fix: Add domain rule validation for slug and name fields before delegating to the port, consistent with `registerUserAndOrg`.

---

## D12 Verification Matrix

### Events (CONTEXT.md §Events produced vs actual)

| Event                           | Defined | Constructor | In Union | Emitted by use case     | In public-api                     |
| ------------------------------- | ------- | ----------- | -------- | ----------------------- | --------------------------------- |
| `identity.organization.created` | ✅      | ✅          | ✅       | ✅ (registerUserAndOrg) | ✅ type + constructor             |
| `identity.member.invited`       | ✅      | ✅          | ✅       | ✅ (inviteMember)       | ✅ type + constructor             |
| `identity.invitation.accepted`  | ✅      | ✅          | ✅       | ❌ no use case emits    | ⚠️ type only, constructor missing |
| `identity.invitation.rejected`  | ✅      | ✅          | ✅       | ❌ no use case emits    | ⚠️ type only, constructor missing |
| `identity.member.removed`       | ✅      | ✅          | ✅       | ✅ (removeMember)       | ✅ type + constructor             |
| `identity.member.role_changed`  | ✅      | ✅          | ✅       | ✅ (updateMemberRole)   | ✅ type + constructor             |

### Use Cases (CONTEXT.md §Use cases vs actual files)

| Use Case              | File Exists | In build.ts | Matches CONTEXT.md signature                          |
| --------------------- | ----------- | ----------- | ----------------------------------------------------- |
| registerUser          | ✅          | ✅          | ⚠️ Output is `string` not `User`                      |
| registerUserAndOrg    | ✅          | ✅          | ⚠️ Output is `{ organizationId }` not `{ user, org }` |
| inviteMember          | ✅          | ✅          | ✅                                                    |
| resendInvitation      | ✅          | ✅          | ✅                                                    |
| listInvitations       | ✅          | ✅          | ✅                                                    |
| removeMember          | ✅          | ✅          | ⚠️ Output is `{ success: boolean }` not `void`        |
| updateMemberRole      | ✅          | ✅          | ⚠️ Output is `{ success: boolean }` not `Member`      |
| updateOrganization    | ✅          | ✅          | ⚠️ Returns `void` not `Organization`                  |
| requestOrgLogoUpload  | ✅          | ❌          | ❌ Input/output mismatch with CONTEXT.md              |
| finalizeOrgLogoUpload | ✅          | ❌          | ❌ Input/output mismatch with CONTEXT.md              |
| requestAvatarUpload   | ✅          | ❌          | ❌ Input/output mismatch with CONTEXT.md              |
| finalizeAvatarUpload  | ✅          | ❌          | ❌ Input/output mismatch with CONTEXT.md              |

### Permissions (CONTEXT.md §Server functions vs actual `can()` calls)

| CONTEXT.md claim                        | Actual `can()` call      | Match? |
| --------------------------------------- | ------------------------ | ------ |
| `org:manage_members` (invite)           | `invitation.create`      | ❌     |
| `org:manage_members` (remove)           | `member.delete`          | ❌     |
| `org:manage_members` (update role)      | `member.update`          | ❌     |
| `org:manage_members` (list invitations) | `invitation.list`        | ❌     |
| `org:manage_members` (resend)           | `invitation.resend`      | ❌     |
| `org:manage` (update org)               | `organization.update`    | ❌     |
| `authenticated` (avatar)                | `identity.avatar_upload` | ❌     |
| `authenticated` (logo)                  | `identity.logo_upload`   | ❌     |
