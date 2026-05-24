# Review 7: Routes, Loaders & Mutations (Re-audit R2)

Date: 2026-05-23
Scope: All files in `src/routes/` — 30 authenticated route files, plus root/authenticated layouts and API routes.
Auditor: Automated audit against route architecture rules.

## Summary

Routes are well-structured overall. All authenticated routes are correctly nested under `_authenticated.tsx`. The `_authenticated.tsx` beforeLoad does auth resolution only (session check, org resolution, role mapping), with data fetching correctly moved to the `loader` phase. Loaders consistently call server functions rather than repositories directly. No `organizationId` is pulled from URL parameters for tenant scoping — all tenant context comes from session resolution. Permission gating in routes uses `can()` correctly (not `role === '...'`). Mutation invalidation generally matches loader cache keys with one minor mismatch. A few routes are missing `beforeLoad` permission gates where they would add defense-in-depth.

## Findings

### [MINOR] \_authenticated.tsx — beforeLoad calls `getActiveOrganization()` server function (data fetching in auth phase)

**File:** `src/routes/_authenticated.tsx`, line 79
**Quote:** `const org = await getActiveOrganization()` inside `beforeLoad`.
**Rule:** "beforeLoad does auth only, not data fetching."
**Fix:** This is arguably auth resolution (determining the active org and role), not general data fetching. The server function `getActiveOrganization` resolves tenant context and returns the org — it's more auth than data. **Accepted with documentation.** The `listUserOrganizations` and `listProperties` calls are correctly in the `loader` (line 123-127).

### [MINOR] Missing beforeLoad permission gates on property-scoped routes

**File:** `src/routes/_authenticated/properties/$propertyId.tsx`, `src/routes/_authenticated/properties/$propertyId/goals.tsx`, `src/routes/_authenticated/properties/$propertyId/goals/$goalId.tsx`, `src/routes/_authenticated/properties/$propertyId/people.tsx`, `src/routes/_authenticated/properties/$propertyId/metrics.tsx`, `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`, `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`, `src/routes/_authenticated/properties/$propertyId/teams/$teamId.tsx`
**Quote:** These routes have loaders that call server functions but no `beforeLoad` that checks permissions. E.g., `properties/$propertyId/index.tsx` (property dashboard) loads data without checking `can(role, 'dashboard.read')`.
**Rule:** Routes should gate with `can()` in `beforeLoad` for defense-in-depth. The `_authenticated/properties/$propertyId/portals/new.tsx` and `_authenticated/settings/organization.tsx` correctly do this.
**Fix:** Add `beforeLoad` permission gates consistent with `portals/new.tsx` and `settings/organization.tsx` patterns. At minimum, property-scoped routes should check `property.read`.

### [NIT] properties/$propertyId/portals/new.tsx — invalidateRoutes uses trailing slash

**File:** `src/routes/_authenticated/properties/$propertyId/portals/new.tsx`, line 27
**Quote:** `invalidateRoutes: ['/_authenticated/properties/$propertyId/portals/']` — trailing slash may or may not match the route ID (depends on TanStack Router config). The list route is `/_authenticated/properties/$propertyId/portals/index` per file structure.
**Rule:** "Mutation invalidation matches loader cache keys."
**Fix:** Verify the route ID matches exactly. If TanStack uses `index` suffix, change to `'/_authenticated/properties/$propertyId/portals/index'` or `'/_authenticated/properties/$propertyId/portals'`.

### [NIT] \_authenticated.tsx — Loader calls multiple server functions in parallel

**File:** `src/routes/_authenticated.tsx`, line 123-127
**Quote:** `const [orgsResult, propsResult] = await Promise.all([listUserOrganizations(), listProperties()])` — this is correct behavior (parallel fetching in loader), but means the layout loader fetches data for all nested routes. Document that structural data (orgs, properties) is intentionally loaded at layout level.
**Rule:** Loaders call server functions, not repos directly. ✅ Correct.
**Fix:** No fix needed — this is the intended pattern for structural data shared across all authenticated routes.

### Verified: Authenticated routes nested under \_authenticated.tsx ✅

All route files under `src/routes/_authenticated/` are correctly nested. Files like `login.tsx`, `register.tsx`, `join.tsx`, `accept-invitation.tsx`, `reset-password.tsx` are correctly at the top-level (not under `_authenticated`). API routes (`api/`) and the public portal route (`p/$propertySlug/$portalSlug.tsx`) are also correctly unauthenticated.

### Verified: Loaders call server functions, not repos directly ✅

All loaders import from `contexts/*/server/` files:

- `properties/$propertyId.tsx` → `getProperty`, `listStaffAssignments`, `listTeams`
- `properties/$propertyId/portals/$portalId.tsx` → `getPortal`, `listPortalLinks`
- `properties/$propertyId/teams/$teamId.tsx` → `listTeams`, `listMembers`, `listStaffAssignments`
- `properties/$propertyId/goals.tsx` → `listGoals`
- `properties/$propertyId/goals/$goalId.tsx` → `getGoal`
- `properties/import/index.tsx` → `listGoogleConnections`
- `settings/organization.tsx` → `getActiveOrganization`, `listUserOrganizations`

### Verified: No organizationId from URL for tenant scoping ✅

No route extracts `organizationId` from URL params. Tenant scoping is done exclusively through `resolveTenantContext()` in server functions (cookie-based session). Property-scoped routes use `propertyId` from URL for property-level filtering, not tenant identity.

### Verified: Permission gating uses can(), not role === '...' ✅

- `settings/organization.tsx` (line 13): `if (!can(role, 'organization.update'))` ✅
- `properties/$propertyId/portals/new.tsx` (line 14): `if (!can(role, 'portal.create'))` ✅
- No route files contain `role === '...'` patterns for permission checks.

### Verified: \_authenticated.tsx uses hasRole() only for sidebar hierarchy ✅

**File:** `src/routes/_authenticated.tsx`, line 153
**Quote:** `hasRole(ctx.role, 'PropertyManager')` — used only to choose sidebar component, not for permission gating. This matches the architecture rule: "hasRole() for sidebar visibility, hierarchy only."

### Verified: Mutation invalidation generally matches loader cache keys ✅

Spot checks:

- `properties/$propertyId/goals/new.tsx` → invalidates `'/_authenticated/properties/$propertyId/goals'` → matches goals list loader ✅
- `properties/$propertyId/goals/$goalId.tsx` → invalidates `'/_authenticated/properties/$propertyId/goals'` → matches goals list ✅
- `properties/$propertyId/portals/$portalId.tsx` → invalidates `'/_authenticated/properties/$propertyId/portals/$portalId'` → matches portal detail loader ✅
- `properties/import/index.tsx` → invalidates `['/_authenticated']` → refreshes layout-level structural data ✅
- `properties/$propertyId/teams/$teamId/index.tsx` → invalidates `'/_authenticated/properties/$propertyId/teams/$teamId'` → matches team detail loader ✅

## Severity Counts

- **BLOCKER:** 0
- **MAJOR:** 0
- **MINOR:** 2
- **NIT:** 2
