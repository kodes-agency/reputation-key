# Routes — Context

**Audience:** AI agents and developers working in `src/routes/`.

## Structure

TanStack Router file-based routing. Layout routes use underscore prefix.

```
routes/
  __root.tsx                          root layout (providers, global styles)
  _authenticated.tsx                  auth guard + app shell (sidebar, top bar)
  _authenticated/
    home.tsx                          dashboard / landing after login
    dashboard.tsx
    settings.tsx                      settings layout
    settings/index.tsx, profile.tsx, preferences.tsx, organization.tsx, security.tsx
    properties/
      index.tsx                       property list
      new.tsx                         create property
      $propertyId.tsx                 property layout (loads property data)
      $propertyId/
        index.tsx                     property detail
        metrics.tsx
        reviews.tsx
        people.tsx
        portals/
          index.tsx, new.tsx, $portalId.tsx
        teams/
          $teamId.tsx, $teamId/index.tsx, $teamId/members.tsx
    leaderboard.tsx
    team.tsx
    progress.tsx
  login.tsx                           unauthenticated
  join.tsx                            member invitation acceptance
  accept-invitation.tsx               invitation flow
  p/$propertySlug/$portalSlug.tsx     guest portal (public, no auth)
```

## Authenticated layout (`_authenticated.tsx`)

This is the app shell. It:

1. **`beforeLoad`** — calls `getSession()` (server function, not `authClient` — SSR can't forward cookies otherwise). Redirects to `/login` if no session. Resolves role and active organization. Returns `AuthRouteContext` with `{ user, role, activeOrganization }`.

2. **`loader`** — loads organizations and properties in parallel (`Promise.allSettled`). Sets `staleTime: 5 * 60 * 1000` (5 min — structural data rarely changes).

3. **Component** — renders `SidebarProvider` with role-based sidebar: `ManagerSidebar` for PropertyManager+, `StaffSidebar` for Staff, `SettingsSidebar` for `/settings` routes.

## Data loading pattern

### Route loaders — the single source of truth

```tsx
export const Route = createFileRoute('/_authenticated/properties/$propertyId')({
  loader: async ({ params: { propertyId } }) => {
    const { property } = await getProperty({ data: { propertyId } })
    return { property }
  },
  component: PropertyPage,
})
```

- **Route `loader` runs on SSR** and blocks client navigation until data is ready
- **Components read via `Route.useLoaderData()`** — instant, cached by the router
- **Never use `useQuery` for route-scoped data** — route loaders provide SSR, caching, and preloading

### Reading parent layout data

Child routes read parent layout data via `getRouteApi()` instead of re-fetching:

```tsx
const parentLoader = getRouteApi('/_authenticated/properties/$propertyId')
const { property } = parentLoader.useLoaderData()
```

### StaleTime strategy

| Data type | staleTime | Why |
| --------- | --------- | --- |
| Organizations, properties | 5 min (layout level) | Structural data, rarely changes |
| Property detail | 60s | Moderate freshness needed |
| Active sub-routes | 30s | Most dynamic |

## Mutation pattern

### `useMutationAction` — the standard hook

```tsx
const deleteAction = useMutationAction(deleteProperty, {
  successMessage: 'Property deleted',
  invalidateRoutes: ['/_authenticated/properties'],
  navigateTo: '/properties',
})
```

Combines `useServerFn` + router invalidation + toast + optional navigation. Returns `Action<TInput, TOutput>` compatible with all form components.

Options:
- `successMessage` — auto-toasts on success (default: `'Saved'`)
- `invalidate: false` — skip router invalidation
- `invalidateRoutes` — targeted invalidation of specific route IDs instead of full `router.invalidate()`
- `navigateTo` — navigate after success
- `onSuccess` — custom callback

`useMutationActionSilent` — same but no toast (for inline mutations).

### For forms — pass action as prop

The `useServerFn` (or `useMutationAction`) instance is defined in the **route file** and passed to the form component as a prop. Components never import server functions directly.

```tsx
// route file
const createAction = useMutationAction(createPortal, {
  successMessage: 'Portal created',
  navigateTo: `/properties/${propertyId}/portals`,
})

return <CreatePortalForm action={createAction} propertyId={propertyId} />
```

## Route guards (authorization)

Use `can()` from `shared/domain/permissions` in `beforeLoad`:

```tsx
beforeLoad: ({ context }) => {
  const role = (context as AuthRouteContext).role
  if (!can(role, 'property.create')) {
    throw redirect({ to: '/properties' })
  }
}
```

## Dependency rules

Routes may import from:
- `contexts/<ctx>/server/` (server functions only — never domain, application, infrastructure)
- `components/`
- `shared/`

Routes must **never**:
- Import from `domain/`, `application/`, `infrastructure/`
- Access the database directly
- Contain business logic

## Public routes

Login (`/login`), join (`/join`), accept-invitation — these are outside `_authenticated` and have no auth guard. Guest portal routes resolve org from URL slug, not from session.
