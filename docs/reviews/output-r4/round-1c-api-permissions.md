# Round 1C: Cross-Context API Surface + Permission Coverage

**Branch:** feat/phase-15c-goal-ui
**Reviewer:** automated review agent
**Date:** 2026-05-24

---

## Public API Surface Findings

### [BLOCKER] Integration public-api exposes GoogleConnection with encrypted tokens

**File:** `src/contexts/integration/application/public-api.ts`
**Issue:** The `GoogleConnection` type is re-exported from `domain/types`. That type contains `encryptedAccessToken` and `encryptedRefreshToken` fields. Even though encrypted, exposing the fact that tokens exist and their shape in the public API is a security concern. Consumers (components, routes) should never see these fields.
**Fix:** Create a `GoogleConnectionDto` in `application/dto/` that omits token fields (`encryptedAccessToken`, `encryptedRefreshToken`, `tokenExpiresAt`). Export the DTO from public-api instead of the domain type. Keep the full type internal to the integration context.

### [MAJOR] getPortal use case checks portal.update for a read operation

**File:** `src/contexts/portal/application/use-cases/get-portal.ts`
**Issue:** The `getPortal` use case checks `can(ctx.role, 'portal.update')` but this is a GET/read endpoint. Staff role has `portal.read` but NOT `portal.update`, so Staff cannot view individual portals. The error message says "Insufficient permissions to view portal" but the gate requires update permission.
**Fix:** Change the permission check from `can(ctx.role, 'portal.update')` to `can(ctx.role, 'portal.read')`.

### [MAJOR] getReply server gate checks review.read but use case requires reply.manage

**File:** `src/contexts/review/server/reply.ts`
**Issue:** The `getReplyFn` server function checks `can(ctx.role, 'review.read')` (which Staff has), but the use case `getReply` in `reply-operations.ts` calls `requireManager(input.role)` which checks `can(role, 'reply.manage')` (which Staff does NOT have). Staff passes the server gate but fails at the use case with a confusing "unauthorized" error. The server permission gate is misleading.
**Fix:** Either (a) change the server check to `can(ctx.role, 'reply.manage')` to match the use case, or (b) change the use case to check `review.read` if viewing replies should be available to Staff.

---

## Domain Entity Leak Findings

### [MINOR] Multiple contexts re-export domain types instead of DTOs from public-api

**File:** `src/contexts/inbox/application/public-api.ts`, `src/contexts/integration/application/public-api.ts`, `src/contexts/dashboard/application/public-api.ts`, `src/contexts/team/application/public-api.ts`, `src/contexts/review/application/public-api.ts`, `src/contexts/guest/application/public-api.ts`
**Issue:** All six contexts re-export types directly from `../domain/types` (e.g., `InboxItem`, `GoogleConnection`, `Team`, `GoogleReview`, `DashboardData`, `ScanEvent`). The architecture says "components may import from `application/` but NOT from `domain/`" — public-api is the gateway. However, re-exporting raw domain entity shapes (which include internal fields like `deletedAt`, `organizationId`) leaks internals to consumers. Only the goal context correctly uses DTOs in its public-api.
**Fix:** For each context, create DTO types in `application/dto/` that expose only what components need. Export DTOs from public-api. This is a gradual migration — prioritize contexts whose types are consumed by UI components.

### [MINOR] Team public-api exports TeamRepository port

**File:** `src/contexts/team/application/public-api.ts`
**Issue:** Line 10 exports `type { TeamRepository } from './ports/team.repository'`. Repository ports are internal implementation details. The public-api should only expose DTOs and typed API interfaces (like `TeamPublicApi`), not repository abstractions.
**Fix:** Remove the `TeamRepository` export. If cross-context consumers need team data, define a `TeamPublicApi` interface (similar to `StaffPublicApi`, `PropertyPublicApi`, `PortalPublicApi`).

### [MINOR] Review public-api exports raw port types for components

**File:** `src/contexts/review/application/public-api.ts`
**Issue:** Exports `ReviewQueuePort`, `SyncPropertyReviewsJobData`, `AddSyncJobOptions`, and `GoogleReviewApiPort` from ports. These are infrastructure/job-layer abstractions, not component-facing DTOs. Components don't need to know about queue ports or job data shapes.
**Fix:** Move port type exports to an internal barrel (e.g., a context-internal index). Only export review DTOs and event types from public-api.

### [NIT] Goal DTO barrel re-exports domain types

**File:** `src/contexts/goal/application/dto/goal.dto.ts`
**Issue:** Lines 106-107 re-export `Goal`, `GoalProgress`, `GoalType`, `GoalStatus`, and `deriveEntityScope` from `../../domain/types`. This means the DTO layer passes through domain types unchanged. While the intent is correct (providing a single import surface), the domain types include internal fields.
**Fix:** Consider creating dedicated DTO types for `Goal` and `GoalProgress` that strip internal fields, or document this as an accepted trade-off since the Goal context is new.

---

## Permission Coverage Findings

### [MAJOR] Portal listPortals and listPortalLinks have no permission check at any layer

**File:** `src/contexts/portal/application/use-cases/list-portals.ts`, `src/contexts/portal/application/use-cases/list-portal-links.ts`
**Issue:** Neither the server functions nor the use cases check `portal.read` permission. The comment in `list-portal-links.ts` says "all authenticated roles can view portals" — but a `portal.read` permission IS defined in the permission system and granted to all three roles. Not checking it means the use cases don't participate in the permission system at all, making future permission changes invisible.
**Fix:** Add `if (!can(ctx.role, 'portal.read'))` at the top of both use cases for consistency with the authorization pattern used everywhere else.

### [MAJOR] Property listProperties and getProperty skip can() despite property.read existing

**File:** `src/contexts/property/application/use-cases/list-properties.ts`, `src/contexts/property/application/use-cases/get-property.ts`
**Issue:** Both use cases explicitly skip the `can()` check with comments like "all authenticated users within an organization can view properties." However, `property.read` is defined as a permission and granted to all three roles. Not checking it means: (1) if property.read is ever revoked from a role, these use cases won't enforce it, (2) it's inconsistent with other contexts that check their `.read` permission.
**Fix:** Add `if (!can(ctx.role, 'property.read'))` to both use cases. The current behavior won't change since all roles have `property.read`, but the use cases will correctly enforce future permission changes.

### [MAJOR] Staff listStaffAssignments has no permission check

**File:** `src/contexts/staff/application/use-cases/list-staff-assignments.ts`
**Issue:** The use case has no `can()` check. `staff_assignment.read` is defined as a permission. The server function also has no permission gate. Any authenticated user can list all staff assignments (filtered only by org).
**Fix:** Add `if (!can(ctx.role, 'staff_assignment.read'))` to the use case.

### [MINOR] GBP import use cases use property.create instead of integration.manage

**File:** `src/contexts/integration/application/use-cases/get-import-status.ts`, `src/contexts/integration/application/use-cases/start-property-import.ts`, `src/contexts/integration/application/use-cases/list-gbp-locations.ts`
**Issue:** These use cases check `can(ctx.role, 'property.create')` — a permission from the property context. While this is semantically reasonable (importing creates properties), it couples the integration context to the property context's permission model. If `property.create` changes meaning, it affects GBP import.
**Fix:** Consider adding a dedicated `integration.import` permission or document this cross-context permission usage as intentional. At minimum, add a comment explaining the permission choice.

### [MINOR] Inconsistent permission check location across contexts

**File:** Multiple contexts
**Issue:** Some contexts check permissions in both server functions AND use cases (goal, inbox), while others only check in use cases (portal, property, team, staff, integration, identity). This creates an inconsistent pattern:

- **Dual-check (server + use case):** goal, inbox, dashboard
- **Use-case-only:** portal, property, team, staff, integration, identity
- **Server-only:** review (getReplyFn checks `review.read` in server)
  **Fix:** Pick one pattern and apply consistently. The use-case-only pattern is the DRY option; the dual-check pattern provides defense-in-depth. Document the chosen pattern in `src/contexts/CONTEXT.md`.

### [MINOR] getActiveOrganization uses dashboard.read as a proxy permission

**File:** `src/contexts/identity/server/organizations.ts`
**Issue:** `getActiveOrganization` checks `can(ctx.role, 'dashboard.read')` but the operation retrieves organization info, not dashboard data. This works because all roles that have `dashboard.read` should also be able to see their active org, but it's semantically wrong.
**Fix:** Either create an `organization.read` permission, or remove the `can()` check entirely since `resolveTenantContext` already requires authentication. If the goal is to prevent unauthenticated access, `requireAuth()` is sufficient.

### [NIT] Permission snake_case resource naming for staff_assignment

**File:** `src/shared/domain/permissions.ts`
**Issue:** The permission uses `staff_assignment.create/delete/read` with an underscore in the resource name. All other multi-word concepts use single words (e.g., `inbox`, `portal`, `review`). This is a minor naming inconsistency.
**Fix:** Either rename to `staff.create/delete/read` (simpler) or document that multi-word resources use underscores. Not breaking — just cosmetic.

### [NIT] Identity server functions delegate all permission checks to use cases without server gates

**File:** `src/contexts/identity/server/organizations.ts`
**Issue:** `inviteMember`, `resendInvitation`, `listInvitations`, `updateMemberRole`, `removeMember` all delegate to use cases without a `can()` check in the server function. Only `listMembers`, `cancelInvitation`, and `getActiveOrganization` have server-level gates. The rest rely entirely on use-case-level authorization.
**Fix:** Add server-level `can()` checks for consistency with contexts like goal and inbox that use the dual-check pattern. Or document that identity uses the use-case-only pattern.

---

## Permission Name Consistency

### Verified: All permission names are consistent between definitions

The `Permission` type in `shared/domain/permissions.ts` lists 42 permissions. The `statement` object in `shared/auth/permissions.ts` defines the same resources and actions. Role definitions use subsets of these. All `can()` calls across use cases and server functions use permissions from the defined set.

**No orphan permissions found** — every permission in the `Permission` type is used by at least one role or checked by at least one `can()` call.

**No undefined permission checks found** — every string literal used in `can()` calls matches a value in the `Permission` type.

---

## Summary

**BLOCKER: 1** — GoogleConnection token leak in public-api
**MAJOR: 5** — getPortal wrong permission, getReply misleading gate, portal list without check, property list/get without check, staff list without check
**MINOR: 6** — domain type re-exports, TeamRepository port leak, review port exports, GBP cross-context permissions, inconsistent check location, proxy permission
**NIT: 3** — Goal DTO passthrough, staff_assignment naming, identity server delegation
