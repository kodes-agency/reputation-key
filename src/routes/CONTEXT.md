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
    inbox/
      index.tsx                       unified inbox (reviews + feedback)
    settings.tsx                      settings layout
    settings/index.tsx, profile.tsx, preferences.tsx, organization.tsx, security.tsx
    properties/
      index.tsx                       property list
      import/                         GBP property import
        index.tsx, $importId.tsx
      new.tsx                         create property
      $propertyId.tsx                 property layout (loads property data)
      $propertyId/
        index.tsx                     property detail
        metrics.tsx
        reviews.tsx
        people.tsx
        goals/
          index.tsx, new.tsx, $goalId.tsx
        portals/
          index.tsx, new.tsx, $portalId.tsx
        teams/
          $teamId.tsx, $teamId/index.tsx, $teamId/members.tsx
    leaderboard.tsx
    team.tsx
    progress.tsx
  login.tsx                           unauthenticated
  register.tsx                        registration
  reset-password.tsx                  password reset
  join.tsx                            member invitation acceptance
  accept-invitation.tsx               invitation flow
  p/$propertySlug/$portalSlug.tsx     guest portal (public, no auth)
  api/
    auth/google/callback.ts           Google OAuth callback
    health/index.ts                   health check
    portals/$id/qr.ts                 QR code generation
    public/click/$linkId.ts           public link click tracking
    webhooks/gbp/notifications.ts     Google Pub/Sub webhook
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

- **Route `loader` primes the shared TanStack Query cache** via `context.queryClient.ensureQueryData(opts)` (runs on SSR) and still returns the data for `head()`/cutover safety.
- **Components read via `useSuspenseQuery(opts)`** — the SAME `queryOptions` the loader used, so it resolves from the primed cache with zero extra fetch. Route data no longer flows through `Route.useLoaderData()` (only loader-computed derived values like `allowedRoles` still do).

### Reading parent layout data

Parent layout data (orgs, properties, property) lives in the shared Query cache via cross-cutting query options in `src/routes/-queries/route-queries.ts` (`organizationsQuery`, `propertiesQuery`, `propertyQuery(propertyId)`). The parent loaders `ensureQueryData` these (SSR prime); every consumer reads the same options — no `getRouteApi().useLoaderData()`:

```tsx
import { propertyQuery } from '#/routes/-queries/route-queries'
const { data } = useSuspenseQuery(propertyQuery(propertyId))
const property = data.property
```

### StaleTime strategy

| Data type                 | staleTime            | Why                             |
| ------------------------- | -------------------- | ------------------------------- |
| Organizations, properties | 5 min (layout level) | Structural data, rarely changes |
| Property detail           | 60s                  | Moderate freshness needed       |
| Active sub-routes         | 30s                  | Most dynamic                    |

### TanStack Query (client server-state cache)

TanStack Query is wired app-wide (`QueryClient` in `router.tsx` via `setupRouterSsrQueryIntegration`, exposed through the router context + auto-`<QueryClientProvider>`). It owns fetch/cache/dedupe/refetch/invalidation so components don't hand-roll `useState`+`useEffect` fetch lifecycles.

| Data class                                                | Pattern                                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Route data** (SSR-critical)                             | `loader: ({ context }) => context.queryClient.ensureQueryData(opts)` + component reads `useSuspenseQuery(opts)` (suspends; streams during SSR) |
| **Interactive / component data** (fetched on user action) | `useQuery({ queryKey, queryFn })` directly in the component                                                                                    |

- **Query keys** live in `src/shared/queries/query-keys.ts` as hierarchical factories (parent keys are prefixes of children), so `invalidateQueries(parentKey)` refreshes all descendants — **targeted**, never `router.invalidate()`.
- **Mutations** use `useActionMutation` (`src/components/hooks/use-action-mutation.ts`) with `invalidateKeys: QueryKey[]` for targeted invalidation. Never the whole-app `router.invalidate()` sledgehammer.
- **SSR:** `useSuspenseQuery` runs on the server and streams; `useQuery` runs client-side only.
- **Reference implementations:** inbox detail (`src/components/inbox/use-inbox-detail.ts` — `useQuery`) + inbox list (`src/components/inbox/use-inbox-state.ts` — `useInfiniteQuery` for cursor pagination, debounced filter key, `setQueryData` for optimistic updates). Other features migrate opportunistically.

> Replaces the old "never `useQuery`" rule. Manual `useState`+`useEffect` fetching and whole-app `router.invalidate()` are anti-patterns — use Query's cache + targeted invalidation.

## Mutation pattern

### `useActionMutation` — the Query-native hook

```tsx
const deleteAction = useActionMutation(deleteProperty, {
  successMessage: 'Property deleted',
  invalidateKeys: [identityKeys.organizations(), propertyKeys.list()],
})
```

Wraps `useMutation` and returns the SAME `Action<TInput, TOutput>` shape form components already consume (callable + `isPending`/`error`/`data`). Invalidation is **targeted Query keys** (`invalidateKeys`), never `router.invalidate()`. The callable is `mutateAsync`, so `await action({ data })` and `.then()` chains work.

Options (`src/components/hooks/use-action-mutation.ts`):

- `successMessage` — auto-toasts on success (omit for a silent mutation, the old `useMutationActionSilent`)
- `invalidateKeys` — Query keys to invalidate on success (targeted; never `router.invalidate()`)
- `onSuccess(output, input)` — runs after invalidation + toast
- `navigateTo` — `{ to, params?: (output) => Record<string, string> }` navigate after success

### For forms — pass action as prop

The `useActionMutation` instance is defined in the **route file** and passed to the form component as a prop. Components never import server functions directly.

```tsx
// route file
const createAction = useActionMutation(createPortal, {
  successMessage: 'Portal created',
  invalidateKeys: [portalKeys.all],
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

- Import values from `domain/`, `application/`, `infrastructure/` — `type`-only imports from `application/dto/` are allowed for loader return types
- Access the database directly
- Contain business logic

## Public routes

Login (`/login`), join (`/join`), accept-invitation — these are outside `_authenticated` and have no auth guard. Guest portal routes resolve org from URL slug, not from session.

### Webhook route exception

Webhook routes (`routes/api/webhooks/`) are exempt from the standard API route rules. Allowed:

- `getDb()` + Drizzle schema table imports + `drizzle-orm` helpers for resource resolution
- `getContainer()` for queue access (to enqueue background jobs)
- `shared/auth/` imports for token/JWT verification
- Direct `Response` construction (no server fn wrapping needed)
- **Exception:** `routes/api/webhooks/gbp/notifications.ts` imports `handleGbpNotification` from `contexts/integration/infrastructure/handlers/` — this is allowed because the webhook handler is a thin infrastructure adapter that verifies the JWT and delegates to the use case. The eslint-disable comment on the import documents this exception.

NOT allowed:

- Importing use cases, repositories, or domain logic directly
- Creating new Queue instances (use container's singleton)

**Pattern:** Verify the request signature/token, extract the relevant identifiers from the payload, look up the local resource, enqueue a job for processing, return 200 OK immediately.
