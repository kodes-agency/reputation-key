# Review 6: Server Functions (Re-audit R2)

Date: 2026-05-23
Scope: All `contexts/*/server/*.ts` files (excluding test files). 16 server function files across 12 bounded contexts.
Auditor: Automated audit against 7-step shape.

## Summary

Server functions generally follow the prescribed 7-step shape well. Most functions use `tracedHandler`, `resolveTenantContext`, Zod validation, `throwContextError`, and `getContainer`. The most common deviation is **missing explicit `can()` permission checks** in the server function itself — several contexts (portal, property, team, staff, integration) delegate auth to use cases instead of checking in the server layer. Guest context public functions legitimately skip auth. Identity context correctly uses `requireAuth` for pre-auth flows. A few functions have minor error-handling inconsistencies.

## Findings

### [MINOR] contexts/portal/server/portals.ts — All 8 functions delegate auth to use case

**File:** `src/contexts/portal/server/portals.ts`
**Functions:** `createPortal`, `updatePortal`, `listPortals`, `getPortal`, `deletePortal`, `requestUploadUrl`, `finalizeUpload`, `getPortalForQR`
**Quote:** No `can(ctx.role, '...')` call in any function — all resolve tenant context but don't check permissions at the server layer.
**Rule:** Step 4 — Permission check via `can(role, permission)`. Even if the use case checks, the server function should gate early.
**Fix:** Add explicit `can(ctx.role, 'portal.create')` / `'portal.update'` / `'portal.read'` / `'portal.delete'` checks before calling use cases.

### [MINOR] contexts/portal/server/portal-links.ts — All 9 functions delegate auth to use case

**File:** `src/contexts/portal/server/portal-links.ts`
**Functions:** `createLinkCategory`, `updateLinkCategory`, `deleteLinkCategory`, `reorderCategories`, `createLink`, `updateLink`, `deleteLink`, `reorderLinks`, `listPortalLinks`
**Quote:** No `can()` check — same pattern as portals.ts.
**Rule:** Step 4 — Permission check via `can(role, permission)`.
**Fix:** Add `can(ctx.role, 'portal.update')` for mutations and `can(ctx.role, 'portal.read')` for reads.

### [MINOR] contexts/property/server/properties.ts — All 5 functions delegate auth to use case

**File:** `src/contexts/property/server/properties.ts`
**Functions:** `createProperty`, `updateProperty`, `listProperties`, `getProperty`, `deleteProperty`
**Quote:** No `can()` check. `listProperties` even has a comment `// All authenticated roles can list properties` but doesn't enforce it.
**Rule:** Step 4 — Permission check via `can(role, permission)`.
**Fix:** Add explicit `can(ctx.role, 'property.create')` / `'property.update'` / `'property.read'` / `'property.delete'` checks.

### [MINOR] contexts/team/server/teams.ts — All 4 functions delegate auth to use case

**File:** `src/contexts/team/server/teams.ts`
**Functions:** `createTeam`, `updateTeam`, `listTeams`, `deleteTeam`
**Quote:** No `can()` check.
**Rule:** Step 4 — Permission check via `can(role, permission)`.
**Fix:** Add `can(ctx.role, 'team.create')` / `'team.update'` / `'team.read'` / `'team.delete'` checks.

### [MINOR] contexts/staff/server/staff-assignments.ts — All 3 functions delegate auth to use case

**File:** `src/contexts/staff/server/staff-assignments.ts`
**Functions:** `createStaffAssignment`, `removeStaffAssignment`, `listStaffAssignments`
**Quote:** No `can()` check.
**Rule:** Step 4 — Permission check via `can(role, permission)`.
**Fix:** Add `can(ctx.role, 'staff.create')` / `'staff.delete'` / `'staff.read'` checks.

### [MINOR] contexts/integration/server/gbp-import.ts — All 3 functions delegate auth to use case

**File:** `src/contexts/integration/server/gbp-import.ts`
**Functions:** `listGbpLocations`, `startPropertyImport`, `getImportStatus`
**Quote:** No `can()` check.
**Rule:** Step 4 — Permission check via `can(role, permission)`.
**Fix:** Add `can(ctx.role, 'integration.read')` / `'integration.import'` checks.

### [MINOR] contexts/integration/server/google-connections.ts — 5 of 5 functions missing `can()` check

**File:** `src/contexts/integration/server/google-connections.ts`
**Functions:** `getGoogleAuthUrl`, `connectGoogle`, `listGoogleConnections`, `disconnectGoogle`, `updateConnectionVisibility`
**Quote:** `getGoogleAuthUrl` calls `resolveTenantContext` but discards the result. Others resolve ctx but don't call `can()`.
**Rule:** Step 4 — Permission check via `can(role, permission)`.
**Fix:** Add appropriate permission checks. `getGoogleAuthUrl` should at least check `integration.manage`.

### [MINOR] contexts/review/server/reply.ts — `draftReplyFn`, `submitReplyFn`, `approveReplyFn`, `rejectReplyFn`, `deleteReplyFn`, `retryPublishFn` missing `can()` checks

**File:** `src/contexts/review/server/reply.ts`
**Quote:** Only `getReplyFn` checks `can(ctx.role, 'review.read')`. The remaining 6 mutation functions resolve tenant context but pass `role` directly to use cases without an explicit `can()` gate.
**Rule:** Step 4 — Permission check via `can(role, permission)`.
**Fix:** Add `can(ctx.role, 'reply.manage')` or appropriate permission checks before calling use cases.

### [MINOR] contexts/identity/server/organizations.ts — `listMembers`, `getActiveOrganization`, `listUserInvitations`, `listUserOrganizations`, `setActiveOrganization`, `acceptInvitation` missing `can()` checks

**File:** `src/contexts/identity/server/organizations.ts`
**Quote:** Several functions resolve auth context but don't check specific permissions. `listMembers` does check `can(ctx.role, 'member.list')`. `getActiveOrganization` checks `can(ctx.role, 'dashboard.read')`. But `listUserInvitations`, `listUserOrganizations`, `setActiveOrganization`, `acceptInvitation` use only `requireAuth(headers)` — no permission check.
**Rule:** Step 4 — Permission check via `can(role, permission)`.
**Fix:** These may be legitimate (pre-auth flows, user-scoped data), but document the rationale.

### [NIT] contexts/identity/server/auth-settings.ts — 3 functions missing `resolveTenantContext`

**File:** `src/contexts/identity/server/auth-settings.ts`
**Functions:** `changePasswordFn`, `updateProfileFn`, `updateUserImageFn`
**Quote:** Uses `headersFromContext()` directly with `getAuth()` — no `resolveTenantContext()` call. No `can()` check.
**Rule:** Steps 2 and 4. These are user-scoped operations (change own password, update own profile), so tenant context isn't strictly needed, but the pattern deviates.
**Fix:** Acceptable for user-scoped auth operations. Document as intentional exception.

### [NIT] contexts/dashboard/server/dashboard.ts — `getDashboardDataFn` throws raw error instead of using `throwContextError` for forbidden

**File:** `src/contexts/dashboard/server/dashboard.ts`, line 55-58
**Quote:** `throw makeDashboardError('forbidden', 'Insufficient permissions...')` — throws the raw domain error, not `throwContextError`.
**Rule:** Step 7 — Errors to stable envelope via `throwContextError`.
**Fix:** Change to `throwContextError('DashboardError', makeDashboardError('forbidden', '...'), 403)`.

### [NIT] contexts/goal/server/goals.ts — No `catchUntagged` usage

**File:** `src/contexts/goal/server/goals.ts`
**Quote:** Uses `if (isGoalError(e)) throwContextError(...); throw e` pattern but never wraps untagged errors with `catchUntagged()`.
**Rule:** Step 7 — The architecture pattern recommends `catchUntagged` for DB/network errors.
**Fix:** Add `catchUntagged(e)` in the final `catch` blocks, consistent with dashboard.ts pattern.

### [NIT] contexts/guest/server/public.ts — Public functions skip auth (by design)

**File:** `src/contexts/guest/server/public.ts`
**Functions:** `recordScanFn`, `getPublicPortal`, `submitRatingFn`, `submitFeedbackFn`, `resolveLinkAndTrack`
**Quote:** No `resolveTenantContext()` or `can()` checks. Functions resolve portal context via `useCases.resolvePortalContext()` instead.
**Rule:** Steps 2 and 4 — intentionally skipped for public/guest flows per architecture ("Anonymous/public use cases omit AuthContext").
**Fix:** No fix needed — documented as correct.

## Per-Function Checklist

### contexts/dashboard/server/dashboard.ts

| Function           | tracedHandler | resolveTenantCtx | Zod | can() | getContainer | use case | throwContextError            |
| ------------------ | ------------- | ---------------- | --- | ----- | ------------ | -------- | ---------------------------- |
| getDashboardDataFn | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ⚠️ (raw throw for forbidden) |

### contexts/goal/server/goals.ts

| Function   | tracedHandler | resolveTenantCtx | Zod | can() | getContainer | use case | throwContextError |
| ---------- | ------------- | ---------------- | --- | ----- | ------------ | -------- | ----------------- |
| createGoal | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| updateGoal | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| cancelGoal | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| listGoals  | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| getGoal    | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |

### contexts/goal/server/staff-goals.ts

| Function       | tracedHandler | resolveTenantCtx | Zod           | can() | getContainer | use case  | throwContextError |
| -------------- | ------------- | ---------------- | ------------- | ----- | ------------ | --------- | ----------------- |
| listStaffGoals | ✅            | ✅               | ❌ (no input) | ✅    | ❌ (stub)    | ❌ (stub) | ✅                |

### contexts/guest/server/public.ts

| Function            | tracedHandler | resolveTenantCtx | Zod | can()       | getContainer | use case | throwContextError |
| ------------------- | ------------- | ---------------- | --- | ----------- | ------------ | -------- | ----------------- |
| recordScanFn        | ✅            | ⏭️ (public)      | ✅  | ⏭️ (public) | ✅           | ✅       | ✅                |
| getPublicPortal     | ✅            | ⏭️ (public)      | ✅  | ⏭️ (public) | ✅           | ✅       | ✅                |
| submitRatingFn      | ✅            | ⏭️ (public)      | ✅  | ⏭️ (public) | ✅           | ✅       | ✅                |
| submitFeedbackFn    | ✅            | ⏭️ (public)      | ✅  | ⏭️ (public) | ✅           | ✅       | ✅                |
| resolveLinkAndTrack | ✅            | ⏭️ (public)      | ✅  | ⏭️ (public) | ✅           | ✅       | ✅                |

### contexts/identity/server/auth-settings.ts

| Function             | tracedHandler | resolveTenantCtx | Zod | can()           | getContainer     | use case        | throwContextError |
| -------------------- | ------------- | ---------------- | --- | --------------- | ---------------- | --------------- | ----------------- |
| changePasswordFn     | ✅            | ⏭️ (user-scope)  | ✅  | ⏭️ (user-scope) | ❌ (direct auth) | ❌ (delegation) | ✅                |
| updateProfileFn      | ✅            | ⏭️ (user-scope)  | ✅  | ⏭️ (user-scope) | ❌ (direct auth) | ❌ (delegation) | ✅                |
| updateUserImageFn    | ✅            | ⏭️ (user-scope)  | ✅  | ⏭️ (user-scope) | ❌ (direct auth) | ❌ (delegation) | ✅                |
| createOrganizationFn | ✅            | ⏭️ (user-scope)  | ✅  | ⏭️ (user-scope) | ❌ (direct auth) | ❌ (delegation) | ✅                |

### contexts/identity/server/organizations.ts

| Function              | tracedHandler | resolveTenantCtx | Zod           | can()         | getContainer     | use case         | throwContextError |
| --------------------- | ------------- | ---------------- | ------------- | ------------- | ---------------- | ---------------- | ----------------- |
| getActiveOrganization | ✅            | ✅               | ❌ (no input) | ✅            | ❌ (direct auth) | ❌ (direct auth) | ✅                |
| listMembers           | ✅            | ✅               | ❌ (no input) | ✅            | ❌ (direct auth) | ❌ (direct auth) | ✅                |
| inviteMember          | ✅            | ✅               | ✅            | ❌ (use case) | ✅               | ✅               | ✅                |
| acceptInvitation      | ✅            | ❌ (requireAuth) | ✅            | ⏭️ (pre-org)  | ❌ (direct auth) | ❌ (delegation)  | ❌                |
| cancelInvitation      | ✅            | ✅               | ✅            | ✅            | ❌ (direct auth) | ❌ (delegation)  | ✅                |
| resendInvitation      | ✅            | ✅               | ✅            | ❌ (use case) | ✅               | ✅               | ✅                |
| listInvitations       | ✅            | ✅               | ❌ (no input) | ❌ (use case) | ✅               | ✅               | ✅                |
| updateMemberRole      | ✅            | ✅               | ✅            | ❌ (use case) | ✅               | ✅               | ✅                |
| removeMember          | ✅            | ✅               | ✅            | ❌ (use case) | ✅               | ✅               | ✅                |
| listUserInvitations   | ✅            | ❌ (requireAuth) | ❌ (no input) | ❌            | ❌ (direct auth) | ❌ (delegation)  | ✅                |
| setActiveOrganization | ✅            | ❌ (requireAuth) | ✅            | ❌            | ❌ (direct auth) | ❌ (delegation)  | ❌                |
| listUserOrganizations | ✅            | ❌ (requireAuth) | ❌ (no input) | ❌            | ❌ (direct auth) | ❌ (delegation)  | ❌                |
| registerMember        | ✅            | ⏭️ (public)      | ✅            | ⏭️ (public)   | ✅               | ✅               | ✅                |
| registerUserAndOrg    | ✅            | ⏭️ (public)      | ✅            | ⏭️ (public)   | ✅               | ✅               | ✅                |
| signInUser            | ✅            | ⏭️ (public)      | ✅            | ⏭️ (public)   | ❌ (direct auth) | ❌ (delegation)  | ✅                |
| updateOrganization    | ✅            | ✅               | ✅            | ❌ (use case) | ✅               | ✅               | ✅                |
| requestOrgLogoUpload  | ✅            | ✅               | ✅            | ❌            | ✅               | ✅               | ✅                |
| finalizeOrgLogoUpload | ✅            | ✅               | ✅            | ❌            | ✅               | ✅               | ✅                |
| requestAvatarUpload   | ✅            | ✅               | ✅            | ❌            | ✅               | ✅               | ✅                |
| finalizeAvatarUpload  | ✅            | ✅               | ✅            | ❌            | ✅               | ✅               | ✅                |

### contexts/inbox/server/inbox.ts

| Function                | tracedHandler | resolveTenantCtx | Zod | can() | getContainer | use case | throwContextError |
| ----------------------- | ------------- | ---------------- | --- | ----- | ------------ | -------- | ----------------- |
| getInboxItemsFn         | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| updateInboxStatusFn     | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| bulkUpdateInboxStatusFn | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| assignInboxItemFn       | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| addInboxNoteFn          | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| getUnreadCountFn        | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| getInboxItemDetailFn    | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |
| getInboxNotesFn         | ✅            | ✅               | ✅  | ✅    | ✅           | ✅       | ✅                |

### contexts/integration/server/gbp-import.ts

| Function            | tracedHandler | resolveTenantCtx | Zod | can()         | getContainer | use case | throwContextError |
| ------------------- | ------------- | ---------------- | --- | ------------- | ------------ | -------- | ----------------- |
| listGbpLocations    | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| startPropertyImport | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| getImportStatus     | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |

### contexts/integration/server/google-connections.ts

| Function                   | tracedHandler | resolveTenantCtx | Zod           | can()         | getContainer | use case    | throwContextError |
| -------------------------- | ------------- | ---------------- | ------------- | ------------- | ------------ | ----------- | ----------------- |
| getGoogleAuthUrl           | ✅            | ✅               | ✅            | ❌            | ❌ (inline)  | ❌ (inline) | ❌                |
| connectGoogle              | ✅            | ✅               | ✅            | ❌ (use case) | ✅           | ✅          | ✅                |
| listGoogleConnections      | ✅            | ✅               | ❌ (no input) | ❌ (use case) | ✅           | ✅          | ✅                |
| disconnectGoogle           | ✅            | ✅               | ✅            | ❌ (use case) | ✅           | ✅          | ✅                |
| updateConnectionVisibility | ✅            | ✅               | ✅            | ❌ (use case) | ✅           | ✅          | ✅                |

### contexts/portal/server/portals.ts

| Function         | tracedHandler | resolveTenantCtx | Zod | can()         | getContainer | use case | throwContextError |
| ---------------- | ------------- | ---------------- | --- | ------------- | ------------ | -------- | ----------------- |
| createPortal     | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| updatePortal     | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| listPortals      | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| getPortal        | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| deletePortal     | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| requestUploadUrl | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| finalizeUpload   | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| getPortalForQR   | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |

### contexts/portal/server/portal-links.ts

| Function           | tracedHandler | resolveTenantCtx | Zod | can()         | getContainer | use case | throwContextError |
| ------------------ | ------------- | ---------------- | --- | ------------- | ------------ | -------- | ----------------- |
| createLinkCategory | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| updateLinkCategory | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| deleteLinkCategory | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| reorderCategories  | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| createLink         | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| updateLink         | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| deleteLink         | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| reorderLinks       | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| listPortalLinks    | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |

### contexts/property/server/properties.ts

| Function       | tracedHandler | resolveTenantCtx | Zod           | can()         | getContainer | use case | throwContextError |
| -------------- | ------------- | ---------------- | ------------- | ------------- | ------------ | -------- | ----------------- |
| createProperty | ✅            | ✅               | ✅            | ❌ (use case) | ✅           | ✅       | ✅                |
| updateProperty | ✅            | ✅               | ✅            | ❌ (use case) | ✅           | ✅       | ✅                |
| listProperties | ✅            | ✅               | ❌ (no input) | ❌            | ✅           | ✅       | ✅                |
| getProperty    | ✅            | ✅               | ✅            | ❌ (use case) | ✅           | ✅       | ✅                |
| deleteProperty | ✅            | ✅               | ✅            | ❌ (use case) | ✅           | ✅       | ✅                |

### contexts/review/server/reply.ts

| Function       | tracedHandler | resolveTenantCtx | Zod | can()         | getContainer | use case | throwContextError |
| -------------- | ------------- | ---------------- | --- | ------------- | ------------ | -------- | ----------------- |
| getReplyFn     | ✅            | ✅               | ✅  | ✅            | ✅           | ✅       | ✅                |
| draftReplyFn   | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| submitReplyFn  | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| approveReplyFn | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| rejectReplyFn  | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| deleteReplyFn  | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| retryPublishFn | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |

### contexts/staff/server/staff-assignments.ts

| Function              | tracedHandler | resolveTenantCtx | Zod | can()         | getContainer | use case | throwContextError |
| --------------------- | ------------- | ---------------- | --- | ------------- | ------------ | -------- | ----------------- |
| createStaffAssignment | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| removeStaffAssignment | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| listStaffAssignments  | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |

### contexts/team/server/teams.ts

| Function   | tracedHandler | resolveTenantCtx | Zod | can()         | getContainer | use case | throwContextError |
| ---------- | ------------- | ---------------- | --- | ------------- | ------------ | -------- | ----------------- |
| createTeam | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| updateTeam | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| listTeams  | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |
| deleteTeam | ✅            | ✅               | ✅  | ❌ (use case) | ✅           | ✅       | ✅                |

## Severity Counts

- **BLOCKER:** 0
- **MAJOR:** 0
- **MINOR:** 9
- **NIT:** 4
