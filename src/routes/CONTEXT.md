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

## Invitation links

`/join` and `/accept-invitation` read the link's anonymous preview in `beforeLoad`
(`-invitation-entry.ts`: one `getInvitationPreview` plus the session), so a link
never renders a page that cannot work. `/accept-invitation` never accepts on load.
Signed-out visitors go to `/join` (a new address) or `/login` (an address that
already has an account, with the way back to the link kept). Signed-in visitors
confirm explicitly: the page shows what is offered and the signed-in address, with
a mismatch card and Sign out when the address differs. `/join` shows the
Organization, inviter, role and Properties and locks the invited email. An expired,
cancelled, used or unknown link renders a state card with a next step instead of a
form. `/accept-invitation` without an id stays as the signed-in list of pending
invitations, which `/unavailable` links to; its query is primed in the same
`beforeLoad` (`-pending-invitations-query.ts`), so the route file carries no
`loader`. After registration signs the member in, `-join-entry.ts` makes the
Organization active and navigates; a failure there shows a retry, because the
session already exists.

Two limits shape the entry. An id is read only up to `INVITATION_ID_MAX_LENGTH`
(the preview's own bound); a longer one is no invitation, so it never reaches the
server to be refused there. And the preview is rate limited per IP: one link open
reads it twice (the emailed link, then the page it sends the visitor to), three
times when someone signed in as another address signs out, which is why the limit
is 60 per 10 minutes. Running out is an expected state, rendered as the "Too many
attempts" card (`rate_limited`); any other preview failure still reaches the error
page, where it is reported. The signed-in confirm step also watches the client
session (`useOnSessionEnd`): the header's user menu signs out without navigating,
so the page hands the link back to `/join` itself when the session it was shown
for ends.

The two `beforeLoad` hooks import `-invitation-entry` on demand because the
route files' non-component code is in the first-paint bundle, which is budgeted
to the byte (`pnpm check:bundles`). Keep route-level additions out of them: new
logic goes in the lazy module, and modules only it needs (like the
server-function error check, recognised by shape) are not imported into the route
files.

## Verification

Colocated route tests cover auth redirects, search normalization, server-function
bundle laziness, unavailable states, public failures, webhook authentication, and
HTTP contracts. Browser behavior that depends on SSR/hydration is verified against
the running app rather than inferred from loader code.
