# Review #6: Server Functions

**Date:** 2026-05-23  
**Reviewer:** Code Review Agent  
**Scope:** All `server/` folders across 12 bounded contexts (metric excluded per architecture — no server layer)

---

## Summary

Reviewed **60 server functions** across **11 contexts** (metric has no `server/` by design).  
Overall the architecture is well-followed: every function uses `tracedHandler`, validates input with Zod schemas, resolves auth from session (never from request body), delegates to use cases via composition root, and translates errors to stable envelopes via `throwContextError`.

**Critical pattern violation found in `goal/server/goals.ts`**: uses hardcoded role set (`WRITE_ROLES`) instead of `can()`, bypassing the permission table. Two read-only functions (`listGoals`, `getGoal`) have no permission check at all.

**Systematic gap**: Only `inbox` and `dashboard` contexts perform explicit `can()` checks in server functions. The remaining 9 contexts defer authorization to use cases. While this may be intentional per CONTEXT.md ("Authorize — `can(ctx.role, 'resource.action')`" is use case step 1), it creates inconsistency and contradicts the server-function checklist.

---

## Findings

### [BLOCKER] goals.ts — `requireWriteAccess()` uses hardcoded role set instead of `can()`

```
File: src/contexts/goal/server/goals.ts:32-45
Quote:
  const WRITE_ROLES: ReadonlySet<Role> = new Set(['AccountAdmin', 'PropertyManager'])

  function requireWriteAccess(role: Role): void {
    if (!WRITE_ROLES.has(role)) {
      throwContextError(
        'GoalError',
        goalError('forbidden', 'Only AccountAdmin or PropertyManager can perform this action'),
        403,
      )
    }
  }
Rule: Permission check must use `can(role, permission)`, not hardcoded role sets.
Fix: Replace `requireWriteAccess(ctx.role)` with `if (!can(ctx.role, 'goal.write'))` and
      `if (!can(ctx.role, 'goal.read'))` for read operations. Add `goal.write` and `goal.read`
      to the Permission union type in `shared/domain/permissions.ts`.
```

### [BLOCKER] goals.ts — `listGoals` missing permission check

```
File: src/contexts/goal/server/goals.ts:218-246
Quote:
  export const listGoals = createServerFn({ method: 'GET' })
    .inputValidator(listGoalsSchema)
    .handler(
      tracedHandler(
        async ({ data }) => {
          const headers = headersFromContext()
          const ctx = await resolveTenantContext(headers)
          // ← no can() check, no requireWriteAccess()
          try {
            const { useCases } = getContainer()
Rule: Step 4 — Permission check via can(role, permission) — is required.
Fix: Add `if (!can(ctx.role, 'goal.read')) { throwContextError(...) }` after resolving context.
```

### [BLOCKER] goals.ts — `getGoal` missing permission check

```
File: src/contexts/goal/server/goals.ts:250-278
Quote:
  export const getGoal = createServerFn({ method: 'GET' })
    .inputValidator(getGoalSchema)
    .handler(
      tracedHandler(
        async ({ data }) => {
          const headers = headersFromContext()
          const ctx = await resolveTenantContext(headers)
          // ← no can() check
Rule: Step 4 — Permission check via can(role, permission) — is required.
Fix: Add `if (!can(ctx.role, 'goal.read')) { throwContextError(...) }` after resolving context.
```

### [BLOCKER] goals.ts — `createGoal` leaks raw error via `String(result.error)`

```
File: src/contexts/goal/server/goals.ts:87-93
Quote:
          if (result.isErr()) {
            throwContextError(
              'GoalError',
              goalError('validation_error', String(result.error)),
              400,
            )
          }
Rule: Never expose raw error details to client — "Catching and returning raw error messages to client."
Fix: Map `result.error` by its discriminated tag (as updateGoal/cancelGoal do) instead of
      `String(result.error)`. Example: match on `result.error.tag` and return a stable message.
```

### [BLOCKER] goals.ts — Double-mapping the role

```
File: src/contexts/goal/server/goals.ts:32
Quote:
  const WRITE_ROLES: ReadonlySet<Role> = new Set(['AccountAdmin', 'PropertyManager'])
Rule: "Double-mapping the role" — server function reimplements role→permission mapping that
      `can()` already provides via the permission table.
Fix: Delete WRITE_ROLES and requireWriteAccess entirely. Use `can(ctx.role, 'goal.write')`.
```

### [BLOCKER] staff-goals.ts — `listStaffGoals` missing permission check

```
File: src/contexts/goal/server/staff-goals.ts:18-34
Quote:
  export const listStaffGoals = createServerFn({ method: 'GET' }).handler(
    tracedHandler(
      async () => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        void ctx
        void getContainer
        return { goals: [] as GoalWithProgress[] }
Rule: Step 4 missing. Even stub functions that resolve tenant context need permission checks.
Fix: Add `if (!can(ctx.role, 'goal.read')) { throwContextError(...) }`. Also remove `void ctx`.
```

### [MAJOR] Systematic gap — 9 of 11 contexts lack explicit `can()` checks in server functions

Only `inbox` and `dashboard` server functions call `can()` explicitly. The following contexts
resolve `AuthContext` via `resolveTenantContext()` but perform no permission check in the server
function layer, deferring entirely to use cases:

| Context     | Server File             | Functions                                                                                                                                                                                   |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| portal      | `portals.ts`            | createPortal, updatePortal, listPortals, getPortal, deletePortal, requestUploadUrl, finalizeUpload, getPortalForQR                                                                          |
| portal      | `portal-links.ts`       | createLinkCategory, updateLinkCategory, deleteLinkCategory, reorderCategories, createLink, updateLink, deleteLink, reorderLinks, listPortalLinks                                            |
| property    | `properties.ts`         | createProperty, updateProperty, listProperties, getProperty, deleteProperty                                                                                                                 |
| review      | `reply.ts`              | getReplyFn, draftReplyFn, submitReplyFn, approveReplyFn, rejectReplyFn, deleteReplyFn, retryPublishFn                                                                                       |
| team        | `teams.ts`              | createTeam, updateTeam, listTeams, deleteTeam                                                                                                                                               |
| staff       | `staff-assignments.ts`  | createStaffAssignment, removeStaffAssignment, listStaffAssignments                                                                                                                          |
| integration | `gbp-import.ts`         | listGbpLocations, startPropertyImport, getImportStatus                                                                                                                                      |
| integration | `google-connections.ts` | getGoogleAuthUrl, connectGoogle, listGoogleConnections, disconnectGoogle, updateConnectionVisibility                                                                                        |
| identity    | `organizations.ts`      | inviteMember, resendInvitation, listInvitations, updateMemberRole, removeMember, updateOrganization, requestOrgLogoUpload, finalizeOrgLogoUpload, requestAvatarUpload, finalizeAvatarUpload |
| inbox       | `inbox.ts`              | getUnreadCountFn, getInboxItemDetailFn, getInboxNotesFn                                                                                                                                     |

**Note:** Authorization may exist in use cases per architecture step 1. However, the inconsistency
with inbox/dashboard (which check in the server function) is a maintainability concern. Recommend
standardizing: either always check in the server function, or document the convention.

```
Rule: Step 4 — Permission check via can(role, permission) — should be present in server functions.
Fix: Add `if (!can(ctx.role, '<resource>.<action>')) { throwContextError('AuthError', ...) }`
      to each function. Create missing permission entries in `shared/domain/permissions.ts` as needed.
```

### [MAJOR] inbox.ts — `getUnreadCountFn`, `getInboxItemDetailFn`, `getInboxNotesFn` missing `can()` checks

```
File: src/contexts/inbox/server/inbox.ts:223-244 (getUnreadCountFn), 248-272 (getInboxItemDetailFn), 276-300 (getInboxNotesFn)
Quote:
  export const getUnreadCountFn = createServerFn({ method: 'GET' })
    .inputValidator(getUnreadCountDto)
    .handler(
      tracedHandler(
        async ({ data: _data }) => {
          const headers = headersFromContext()
          const ctx = await resolveTenantContext(headers)
          const { useCases } = getContainer()
          // ← no can() check, unlike other inbox functions
Rule: Inbox GET functions should check `inbox.read` like getInboxItemsFn does.
Fix: Add `if (!can(ctx.role, 'inbox.read')) { throwContextError(...) }`.
```

### [MAJOR] Missing integration tests for 4 server function modules

```
File: src/contexts/dashboard/server/dashboard.ts — no dashboard.test.ts
File: src/contexts/goal/server/staff-goals.ts — no staff-goals.test.ts
File: src/contexts/inbox/server/inbox.ts — no inbox.test.ts
File: src/contexts/review/server/reply.ts — no reply.test.ts
Rule: "No integration test" is MAJOR.
Fix: Add integration test files covering auth, permission, happy path, and error mapping for each.
```

### [MAJOR] `goalError('validation_error', String(result.error))` in createGoal leaks error internals

(Detailed in BLOCKER above — also qualifies as MAJOR for schema duplication since the error
mapping pattern in createGoal differs from updateGoal/cancelGoal which pattern-match on error tags.)

```
Rule: Validation schema duplicated / error mapping inconsistent across functions in same file.
Fix: Extract common Result→error mapping helper, use discriminated union matching consistently.
```

---

## Per-Function Checklist

Legend: ✅ = present, ❌ = missing, ➖ = not applicable (public/anonymous/delegation)

### dashboard

| Function             | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| -------------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `getDashboardDataFn` |      ✅       |     ✅      |     ✅     |  ✅   |    ✅    |     ✅     |       ✅       |

### goal

| Function         | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ---------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: | --- |
| `createGoal`     |      ✅       |     ✅      |     ✅     |  ❌¹  |    ✅    |     ✅     |      ❌³       | ✅  |
| `updateGoal`     |      ✅       |     ✅      |     ✅     |  ❌¹  |    ✅    |     ✅     |       ✅       | ✅  |
| `cancelGoal`     |      ✅       |     ✅      |     ✅     |  ❌¹  |    ✅    |     ✅     |       ✅       | ✅  |
| `listGoals`      |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       | ✅  |
| `getGoal`        |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       | ✅  |
| `listStaffGoals` |      ✅       |     ✅      |    ➖²     |  ❌   |   ❌⁴    |     ✅     |       ✅       |

¹ Uses `requireWriteAccess()` (hardcoded role set) instead of `can()` — **BLOCKER**  
² No `.inputValidator()` — no input to validate (GET with no params)  
³ `String(result.error)` leaks raw error — **BLOCKER**  
⁴ Stub — calls `void getContainer`, no use case

**⚠️ FLAGGED (failing >2 checks): `createGoal` (❌❌❌), `listStaffGoals` (❌❌❌)**

### guest (public — no auth required by design)

| Function              | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| --------------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `recordScanFn`        |      ✅       |     ➖⁵     |     ✅     |  ➖   |    ✅    |     ✅     |       ✅       |
| `getPublicPortal`     |      ✅       |     ➖      |     ✅     |  ➖   |    ✅    |     ✅     |       ✅       |
| `submitRatingFn`      |      ✅       |     ➖⁵     |     ✅     |  ➖   |    ✅    |     ✅     |       ✅       |
| `submitFeedbackFn`    |      ✅       |     ➖⁵     |     ✅     |  ➖   |    ✅    |     ✅     |       ✅       |
| `resolveLinkAndTrack` |      ✅       |     ➖      |     ✅     |  ➖   |    ✅    |     ✅     |       ✅       |

⁵ Resolves portal context via use case, not tenant context — correct for public endpoints

### identity — auth-settings.ts (better-auth delegation)

| Function               | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ---------------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `changePasswordFn`     |      ✅       |     ➖⁶     |     ✅     |  ➖⁶  |   ➖⁶    |     ✅     |       ✅       |
| `updateProfileFn`      |      ✅       |     ➖⁶     |     ✅     |  ➖⁶  |   ➖⁶    |     ✅     |       ✅       |
| `updateUserImageFn`    |      ✅       |     ➖⁶     |     ✅     |  ➖⁶  |   ➖⁶    |     ✅     |       ✅       |
| `createOrganizationFn` |      ✅       |     ➖⁶     |     ✅     |  ➖⁶  |   ➖⁶    |     ✅     |       ✅       |

⁶ Pure better-auth delegation — auth handled by better-auth API internally, per architecture exception

### identity — organizations.ts

| Function                | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ----------------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `getActiveOrganization` |      ✅       |     ✅      |    ➖⁷     |  ✅   |   ➖⁸    |     ✅     |       ✅       |
| `listMembers`           |      ✅       |     ✅      |    ➖⁷     |  ✅   |   ➖⁸    |     ✅     |       ✅       |
| `inviteMember`          |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `acceptInvitation`      |      ✅       |     ➖⁹     |     ✅     |  ➖⁹  |   ➖⁸    |     ✅     |       ✅       |
| `cancelInvitation`      |      ✅       |     ✅      |     ✅     |  ✅   |   ➖⁸    |     ✅     |       ✅       |
| `resendInvitation`      |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `listInvitations`       |      ✅       |     ✅      |    ➖⁷     |  ❌   |    ✅    |     ✅     |       ✅       |
| `updateMemberRole`      |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `removeMember`          |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `listUserInvitations`   |      ✅       |     ➖⁹     |    ➖⁷     |  ➖⁹  |   ➖⁸    |     ✅     |       ✅       |
| `setActiveOrganization` |      ✅       |     ➖⁹     |     ✅     |  ➖⁹  |   ➖⁸    |     ✅     |       ✅       |
| `listUserOrganizations` |      ✅       |     ➖⁹     |    ➖⁷     |  ➖⁹  |   ➖⁸    |     ✅     |       ✅       |
| `registerMember`        |      ✅       |    ➖¹⁰     |     ✅     | ➖¹⁰  |    ✅    |     ✅     |       ✅       |
| `registerUserAndOrg`    |      ✅       |    ➖¹⁰     |     ✅     | ➖¹⁰  |    ✅    |     ✅     |       ✅       |
| `signInUser`            |      ✅       |    ➖¹⁰     |     ✅     | ➖¹⁰  |   ➖⁸    |     ✅     |       ✅       |
| `updateOrganization`    |      ✅       |     ✅      |     ✅     | ❌¹¹  |    ✅    |     ✅     |       ✅       |
| `requestOrgLogoUpload`  |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `finalizeOrgLogoUpload` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `requestAvatarUpload`   |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `finalizeAvatarUpload`  |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

⁷ GET with no input params  
⁸ Direct better-auth API delegation per architecture exception  
⁹ Uses `requireAuth()` — user may not have org context yet  
¹⁰ Public/anonymous — no auth context needed  
¹¹ Comment says "authorization lives in the use case"

### inbox

| Function                  | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ------------------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `getInboxItemsFn`         |      ✅       |     ✅      |     ✅     |  ✅   |    ✅    |     ✅     |       ✅       |
| `updateInboxStatusFn`     |      ✅       |     ✅      |     ✅     |  ✅   |    ✅    |     ✅     |       ✅       |
| `bulkUpdateInboxStatusFn` |      ✅       |     ✅      |     ✅     |  ✅   |    ✅    |     ✅     |       ✅       |
| `assignInboxItemFn`       |      ✅       |     ✅      |     ✅     |  ✅   |    ✅    |     ✅     |       ✅       |
| `addInboxNoteFn`          |      ✅       |     ✅      |     ✅     |  ✅   |    ✅    |     ✅     |       ✅       |
| `getUnreadCountFn`        |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `getInboxItemDetailFn`    |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `getInboxNotesFn`         |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

### integration — gbp-import.ts

| Function              | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| --------------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `listGbpLocations`    |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `startPropertyImport` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `getImportStatus`     |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

### integration — google-connections.ts

| Function                     | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ---------------------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `getGoogleAuthUrl`           |      ✅       |     ✅      |     ✅     |  ❌   |   ➖¹²   |     ✅     |       ✅       |
| `connectGoogle`              |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `listGoogleConnections`      |      ✅       |     ✅      |    ➖⁷     |  ❌   |    ✅    |     ✅     |       ✅       |
| `disconnectGoogle`           |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `updateConnectionVisibility` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

¹² Builds OAuth URL inline — no use case delegation (acceptable for OAuth URL generation)

### portal — portals.ts

| Function           | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ------------------ | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `createPortal`     |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `updatePortal`     |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `listPortals`      |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `getPortal`        |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `deletePortal`     |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `requestUploadUrl` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `finalizeUpload`   |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `getPortalForQR`   |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

### portal — portal-links.ts

| Function             | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| -------------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `createLinkCategory` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `updateLinkCategory` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `deleteLinkCategory` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `reorderCategories`  |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `createLink`         |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `updateLink`         |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `deleteLink`         |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `reorderLinks`       |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `listPortalLinks`    |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

### property

| Function         | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ---------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `createProperty` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `updateProperty` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `listProperties` |      ✅       |     ✅      |    ➖⁷     |  ❌   |    ✅    |     ✅     |       ✅       |
| `getProperty`    |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `deleteProperty` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

### review

| Function         | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ---------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `getReplyFn`     |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `draftReplyFn`   |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `submitReplyFn`  |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `approveReplyFn` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `rejectReplyFn`  |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `deleteReplyFn`  |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `retryPublishFn` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

### staff

| Function                | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ----------------------- | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `createStaffAssignment` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `removeStaffAssignment` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `listStaffAssignments`  |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

### team

| Function     | tracedHandler | AuthContext | Validation | can() | Use Case | Map Result | Error Envelope |
| ------------ | :-----------: | :---------: | :--------: | :---: | :------: | :--------: | :------------: |
| `createTeam` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `updateTeam` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `listTeams`  |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |
| `deleteTeam` |      ✅       |     ✅      |     ✅     |  ❌   |    ✅    |     ✅     |       ✅       |

---

## Positive Patterns (Worth Highlighting)

1. **No `hasRole()` usage** found anywhere — zero false positives on that BLOCKER criterion.
2. **No cross-context imports** in any server/ folder — boundary discipline is excellent.
3. **No direct repo calls** — all server functions go through use cases or better-auth API.
4. **No `organizationId` from request body** — all use `ctx.organizationId` from `resolveTenantContext`.
5. **No raw error leaks** (except the `String(result.error)` in goals.ts) — all use `throwContextError`.
6. **`catchUntagged` safety net** — `tracedHandler` wrapper catches anything that slips through as 500.
7. **Error-to-HTTP mapping is exhaustive** — all contexts use `ts-pattern` `.exhaustive()` ensuring new error codes force a compiler error.
8. **Input validation is consistently applied** — every function with input uses `.inputValidator(zodSchema)`.

---

## Functions Failing >2 Checks (Flagged)

| Function         | File                       | Failed Checks                                                           |
| ---------------- | -------------------------- | ----------------------------------------------------------------------- |
| `createGoal`     | goal/server/goals.ts       | can()❌, map-result❌ (String(result.error)), double-role-map❌ = **3** |
| `listStaffGoals` | goal/server/staff-goals.ts | validation❌, can()❌, use-case❌ = **3**                               |

---

## Recommendations

1. **Immediate (BLOCKER):** Delete `WRITE_ROLES`/`requireWriteAccess` in goals.ts. Add `goal.read`/`goal.write`/`goal.delete` permissions. Use `can()` everywhere.
2. **Short-term:** Standardize permission check location — add `can()` to all server functions that resolve `AuthContext`, even if the use case also checks. This provides defense-in-depth and makes authorization auditable at the server boundary.
3. **Short-term:** Fix `String(result.error)` in goals.ts `createGoal` — pattern-match on error tag like other functions do.
4. **Medium-term:** Add integration tests for dashboard, staff-goals, inbox, and review/reply server modules.
5. **Medium-term:** Document the convention for "pure delegation" server functions (identity/auth-settings pattern) so future developers know when steps 2–5 can be skipped.
