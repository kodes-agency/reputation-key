# Routes — Context

**Audience:** Developers and agents working in `src/routes/`.

## Responsibility

TanStack Router file routes own navigation, loader orchestration, search parsing,
route-level availability affordances, and HTTP entry adapters. They do not own
business rules or persistence.

- `__root.tsx` supplies the root layout and providers.
- `_authenticated.tsx` resolves session, Organization, role, and the app shell.
- `_authenticated/` contains manager dashboard, inbox, Property, import, settings,
  notification, and progress routes.
- `p/$token.tsx` is the public rating-first Portal route.
- `api/` contains auth, health, notification unsubscribe, public click, and
  authenticated provider-webhook edges.

## Authenticated layout

`_authenticated.tsx` calls the server `getSession()` in `beforeLoad`; a browser
`authClient` call cannot forward SSR cookies. Missing sessions redirect to login.
Missing Organization access or role resolves to the appropriate unavailable state.
Never synthesize a fallback role or run tenant loaders before both bindings exist.

Route `beforeLoad` checks improve navigation and availability copy; they are not
the mutation authority. Server functions and owning contexts re-resolve current
tenant, permission, capability, and Property scope for every protected operation.

## Data loading

SSR-critical loaders call `context.queryClient.ensureQueryData(options)`. Components
read the same `queryOptions` with `useSuspenseQuery`, so hydration reuses the primed
cache. Parent Property queries live in `-queries/route-queries.ts`; derived values
needed by `head()` may also be returned by the loader.

Interactive or action-triggered reads may use `useQuery`; cursor lists use
`useInfiniteQuery`. Query keys come from `src/shared/queries/query-keys.ts`.
Invalidate the narrow parent key whose descendants changed—never the whole router.

## Server-function bundles and mutations

Routes are the sanctioned delivery layer for importing context server functions.
When several contexts power one component, expose a lazy getter bundle from a
route-local `-*-fns.ts` module and pass it as a prop. The getters preserve the
server-function wrappers without eagerly touching unrelated runtime modules.

Create mutations with `useActionMutation`, provide targeted `invalidateKeys`, and
pass the resulting `Action` to forms/components. Silent fire-and-forget work uses
`useAction`. Components may use type-only server imports to spell bundle/action
props; runtime imports follow the component exception policy.

## Boundaries

Routes may import context `server/` functions, components, route-local helpers, and
shared browser/server-safe contracts. They must not import context infrastructure,
repositories, business-rule modules, database runtime, worker containers, or
ambient configuration. API routes resolve only the narrow runtime operation they
serve.

Route import, database, deployable-container, and runtime-config boundaries are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Public and webhook edges

Login, join, invitation acceptance, password reset, the token Portal, and signed
notification unsubscribe are outside the authenticated layout. Each public edge
owns its exact bearer/origin/session and cache/referrer policy.

Webhook routes verify signatures or tokens, parse bounded identifiers, resolve one
narrow container operation, and return protocol-appropriate responses. They may
use shared authentication helpers and the application container, but must not
construct repositories, context use cases, or Queue instances.

## Verification

Colocated route tests cover auth redirects, search normalization, server-function
bundle laziness, unavailable states, public failures, webhook authentication, and
HTTP contracts. Browser behavior that depends on SSR/hydration is verified against
the running app rather than inferred from loader code.
