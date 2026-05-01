# Data Loading & UI Refinement Design

**Date:** 2026-05-01
**Scope:** Route data loading, caching strategy, light UI shell refinements
**Approach:** A — fix data flow, keep UI shell, light refinements
**Conflicts with existing plan:** None. The `docs/superpowers/plans/2026-05-01-code-review-fixes.md` plan touches `src/contexts/` and `src/shared/` only. This design touches `src/routes/`, `src/components/layout/`, and `src/router.tsx`.

---

## Problem

1. **Slow navigation** — every route transition re-fetches data that the parent layout already loaded. `listProperties()` is called in 5 independent route loaders.
2. **Sledgehammer invalidation** — `useMutationAction` calls `router.invalidate()` after every mutation, forcing all active routes to reload.
3. **Suboptimal caching** — 30s global staleTime is too short for reference data (properties, orgs) and too long for frequently-changing data. 5min gcTime is aggressive.
4. **UI friction for primary use case** — single-property users (most hotels) see a full property-scoped navigation even though they'll never switch properties. Dashboard auto-redirects. Sidebar shows unbuilt features.

## Product Context

- **Primary user:** Single hotel, single property, many portals
- **Secondary user:** Hotel chains with multiple properties
- **Current phase:** Up to Phase 7 (portal builder). Reviews, metrics, AI still ahead.
- **Stack:** TanStack Start + TanStack Router + Drizzle ORM + better-auth + Nitro

---

## Section 1: Eliminate Duplicate Fetches

### Duplicate calls identified

| Route | Server call | Parent has it? |
|-------|-------------|----------------|
| `_authenticated.tsx` loader | `listProperties()` + `listUserOrganizations()` | This IS the parent |
| `dashboard.tsx` loader | `listProperties()` | Yes |
| `properties/index.tsx` loader | `listProperties()` | Yes |
| `$propertyId/members.tsx` loader | `listProperties()` | Yes |
| `staff/index.tsx` (org-level) loader | `listProperties()` | Yes |

### Changes

**1. `dashboard.tsx` — remove `listProperties()` call**

Current:
```typescript
loader: async () => {
  const { properties } = await listProperties();
  if (properties.length > 0) { throw redirect(...) }
  return { properties };
}
```

After:
```typescript
// No loader needed — read from parent route
component: DashboardPage,
```

The component reads properties from `getRouteApi('/_authenticated').useLoaderData()`. If `properties.length > 0`, navigate to first property on mount. If 0, show empty state. Multiple properties show a list (see Section 3A).

**2. `properties/index.tsx` — remove `listProperties()` call**

Remove the loader entirely. The component reads properties from parent route data via `getRouteApi('/_authenticated').useLoaderData()`.

**3. `$propertyId/members.tsx` — remove `listProperties()` from its loader**

The members loader currently fetches `listProperties()` alongside members and invitations. Remove the properties call. Only fetch members + invitations.

**4. `staff/index.tsx` (org-level) — remove `listProperties()` call**

Remove the loader's `listProperties()` call. Read from parent route data.

### Result

Every navigation within the authenticated area makes zero redundant `listProperties()` calls. The parent `_authenticated.tsx` loader fetches properties once; all children consume via `getRouteApi()`.

---

## Section 2: Caching Strategy

### Per-route staleTime

Remove `defaultStaleTime: 30_000` from `router.tsx`. Fall back to TanStack's default (0 — always stale). Each route opts into its own staleTime based on data volatility:

| Data type | Route | staleTime | Rationale |
|-----------|-------|-----------|-----------|
| Orgs + properties (shell) | `_authenticated.tsx` | `Infinity` | Structural data, refetch only on mutation |
| Property detail | `$propertyId.tsx` | `60_000` | Rarely changes |
| Portals list | `portals/index.tsx` | `30_000` | Moderate change frequency |
| Portal detail + links | `portals/$portalId.tsx` | `30_000` | Active editing |
| Teams list | `teams/index.tsx` | `30_000` | Moderate |
| Team detail | `teams/$teamId.tsx` | `30_000` | Moderate |
| Staff | `staff/index.tsx` | `30_000` | Moderate |
| Members | `members.tsx` | `30_000` | Moderate |

### gcTime increase

```typescript
defaultGcTime: 30 * 60 * 1000  // 30min — TanStack default
```

Increase from 5min to 30min so navigating away and back within 30 minutes uses cached data.

### Targeted invalidation in `useMutationAction`

Current: `router.invalidate()` invalidates ALL routes after every mutation.

Add to `MutationActionOptions`:
```typescript
/** Routes to invalidate. Defaults to all (router.invalidate). */
invalidateRoutes?: string[]
```

When `invalidateRoutes` is provided, use TanStack Router's `router.invalidate()` with a filter to target only matching routes. When not provided, keep current behavior for backward compatibility.

Example usage after creating a portal:
```typescript
const mutation = useMutationAction(createPortal, {
  successMessage: 'Portal created',
  invalidateRoutes: ['/_authenticated/properties/$propertyId/portals'],
})
```

After updating a portal's links:
```typescript
const mutation = useMutationAction(updateLink, {
  successMessage: 'Link updated',
  invalidateRoutes: ['/_authenticated/properties/$propertyId/portals/$portalId'],
})
```

After mutations that affect the property list (create/delete property), use `invalidateRoutes: undefined` to invalidate everything as before.

### Preload staleTime increase

```typescript
defaultPreloadStaleTime: 30_000  // 30s — up from 10s
```

Preloaded data persists longer so hover-preload investment pays off.

---

## Section 3: UI Shell Refinements

No structural changes. Keep sidebar + top bar + main content layout. Keep route structure and component organization.

### A. Smart dashboard

For single-property users (`properties.length === 1`): redirect to the property overview page as today.

For multi-property users (`properties.length > 1`): show a property list on the dashboard instead of auto-redirecting. Reuse the `properties/index.tsx` list component.

For no properties (`properties.length === 0`): show the empty state with "Create Property" CTA.

This is a component-level change in `dashboard.tsx` only. No new routes or layouts.

### B. Sidebar — only show implemented sections

Remove nav items for unbuilt features: Reviews, Metrics. Add them back when corresponding phases ship.

Sidebar should only show: Overview, Portals, Teams, Staff, Members, Settings.

This is a config change in `AppSidebar.tsx` nav items array. No structural change.

### C. Auto-scope for single-property users

When `properties.length === 1`:
- Hide the property switcher dropdown in `AppTopBar.tsx`, show only the property name (non-interactive)
- Sidebar starts at property-scoped navigation directly

When `properties.length > 1`:
- Keep current behavior with property switcher dropdown

This is conditional rendering in `AppTopBar.tsx` based on `properties.length`, already available from parent loader data passed via props.

---

## File Change Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/routes/_authenticated/dashboard.tsx` | Remove loader, read parent data, smart redirect/list |
| Modify | `src/routes/_authenticated/properties/index.tsx` | Remove loader, read parent data |
| Modify | `src/routes/_authenticated/properties/$propertyId/members.tsx` | Remove `listProperties()` from loader |
| Modify | `src/routes/_authenticated/staff/index.tsx` | Remove `listProperties()` from loader |
| Modify | `src/router.tsx` | Remove defaultStaleTime, increase gcTime and preloadStaleTime |
| Modify | `src/routes/_authenticated.tsx` | Add `staleTime: Infinity` to route options |
| Modify | `src/components/hooks/use-mutation-action.ts` | Add `invalidateRoutes` option for targeted invalidation |
| Modify | `src/components/layout/AppSidebar.tsx` | Remove unbuilt nav items |
| Modify | `src/components/layout/AppTopBar.tsx` | Conditional property switcher for single-property users |

## Out of Scope

- Route restructuring or navigation model changes (deferred to future "spaces" approach)
- Adding TanStack Query back (current route loader pattern is correct)
- Component design system changes
- Server function or use-case layer changes
- Any files touched by the existing code-review-fixes plan
