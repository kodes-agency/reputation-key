# Components — Context

**Audience:** Developers and agents working in `src/components/`.

## Responsibility

Components own reusable UI primitives, forms, layouts, hooks, and feature-facing
presentation. Business state and effects remain in bounded contexts; route loaders
and actions supply server state.

- `ui/` holds vendored shadcn primitives plus app-wide presentation primitives
  that no feature owns (Fact, OwnerDisc, MetricStrip, SegmentedControl, Timeline,
  StarRating, ConfirmationDialog, EmptyState, RegionError). Every confirmation goes
  through `ConfirmationDialog`; its `tone` is `destructive` only for an action the
  person cannot take back. A region with nothing to show, nothing that matches, or
  a read that failed is `EmptyState` (`size` default or compact, `tone` neutral or
  error, `description` and `action` slots) or `RegionError`, whose only recovery is
  "Try again" wired to the region's refetch. Never hand-build a dashed box or a
  "Retry" button; `region-states.test.ts` fails on both. A region keeps its failure
  on screen, its button busy, while the retry reads: key the panel on
  `hasFailed(query)` and pass `retrying` (`isRetrying(query)`) from
  `hooks/is-retrying`, because a query with no data drops its error and goes
  `pending` the moment it refetches. A dense workspace (the Inbox) passes
  `density="compact"` (36px on a phone, not the 44px target). The bell's
  could-not-load body is plain markup on purpose: it sits in the first-paint
  closure.
  A notice is an `Alert`: `destructive`, `warning`, `success` and `info` each
  draw the one icon their tone wears (`ui/tone.ts`, which Alert, Badge and
  StatusBadge all read), and `default` is a plain card for a notice that brings
  its own icon. A status pill is a `Badge` tone (`positive`, `warn`, `negative`,
  `neutral`) or, for a domain status, `StatusBadge`: the feature writes a
  `StatusMap` once (label and tone per status) and never prints the raw enum.
  Red text is `text-negative`, the text-grade red; the fill-grade red belongs to
  a destructive button or bar. Colour comes from the tokens in `styles.css`: no
  Tailwind palette class, no `oklch()` or hex in a component, no hand-tinted
  box. `tone-sources.test.ts` fails on all three, and `token-contrast.test.ts`
  holds every tone's ink on its own tint to 4.5:1 in both themes. The guest
  renderer keeps its own colours.
- `forms/` contains shared TanStack Form fields, submission, and error UI. A
  failure has one reporter. A form submit reports through `FormErrorBanner`,
  placed directly above that form's actions (the bottom of a card's body, above
  its footer), and never also toasts. A row or immediate action (a switch, a menu
  item, a download, a command whose dialog has closed) reports through a toast,
  `errorMessage` on its `useActionMutation`, and never also a banner. A toast for
  a failure reads "Couldn't …. Try again." (`actionFailureMessage`), shows the
  server's own sentence only for a 4xx refusal, and a success says what changed
  without "successfully". `feedback-ownership.test.ts` reads the sources and
  fails on a file that does both, a hand-built red paragraph, or a toast that
  echoes `error.message`. Typed toasts take their colours from the tone tokens
  (`toaster-theme.ts`) and follow the applied theme.
- `ui/metric-delta` draws a period-over-period change (arrow, size, baseline,
  and the direction in words) and `#/lib/format` is the one place a date or a
  number becomes text: en-US, UTC unless a zone is named, `null` for an instant
  that is not one. Notifications and the guest renderer keep their own
  formatters because they honour a person's or a guest's own locale.
- `layout/` contains app-shell and navigation pieces. `PageState` is the one
  page-level state (`loading`, `error`, `notFound`, `unavailable`): the router's
  defaults and every route fallback draw it through `RoutePending`, `RouteError`
  and `RouteNotFound`, in the title, breadcrumbs and `PageShell` tier the loaded
  page has. A page is named once, on its route (`staticData: { page: { title,
tier, under } }`, see `page-identity.ts`): that gives its fallbacks their frame
  and its tab title (`<Page> | Reputation Key`). A route does not write its own
  `pendingComponent`, `errorComponent` or `notFoundComponent` unless it names a
  missing entity (`RouteNotFound` with `entity`). The error state takes the
  guarded behaviour (sanitised message, report, 401 sign-in redirect, Try again)
  from `useGuardedRouteError`. A refusal is drawn by the shell route's not-found
  boundary (`ShellNoticeBoundary`), which replaces the shell; what a person set
  (the sidebar's open state, the focused sidebar link) is kept in
  `shell-continuity` so the swap does not reset it, and the refusal takes the
  frame of the page it replaces (`refusal-frame`).
- `hooks/` contains cross-feature React behavior and action wrappers.
- `inbox/` and `goals/` contain large cohesive manager experiences.
- `features/<feature>/` contains feature presentation grouped by user concept;
  `shared/` inside one feature is not a cross-feature dumping ground.

Use named exports. Export page-level feature components from the feature barrel;
keep concept-specific children internal.

Filename, feature-barrel, dependency, and 300-counted-line limits are enforced by `scripts/check-filenames.mjs` and `eslint.config.js`.

## Server-function boundary

Routes are the normal runtime import site for context server functions. A route
creates an `Action` with `useActionMutation` or `useAction`, then passes it to the
component. Type-only server imports are allowed to spell those props.

A component — or the single hook that owns its mutations — with five or more
closely related mutations may value-import its server functions when prop
drilling would obscure one cohesive workflow. Document the exception in that file
and add it to the checker allowlist; do not widen the exception to its whole
feature without the same mutation density.

Component/server value-import rules and their allowlist are enforced by `scripts/check-component-boundaries.mjs`; database and context-layer boundaries are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Forms

Use TanStack Form, Zod v4 DTO schemas, and shadcn fields. The owning context's
`application/dto/` schema is the source; derive a form shape with `.required()`,
`.extend()`, or `.omit()` rather than copying validation.

Validate on submit unless the interaction has a specific live-validation need.
Drive pending/error/result UI from the sanctioned `Action`; do not call a server
function directly or hand-roll submission state. Shared building blocks include
`SubmitButton`, `FormErrorBanner`, `FormTextField`, and `FormTextarea`.

## Queries and actions

SSR-critical route data is primed by the route and read with the same
`useSuspenseQuery` options. Interactive reads use `useQuery`; cursor lists use
`useInfiniteQuery`. Use key factories from `src/shared/queries/query-keys.ts` and
invalidate the narrow parent key rather than the router.

`use-action-mutation` wraps `useMutation` with the shared `Action` shape, success
toasts, and targeted invalidation. `use-action` covers non-form fire-and-forget
work. `use-hydrated` provides an SSR-safe client signal;
`use-page-visible` pauses sensitive polling while the page is hidden (focus is deliberately not part of it); `use-property-id` reads
Property route scope; `use-theme-mode` owns persisted theme state.

Viewport breakpoints go through `useViewportBelow` (`useIsMobile`,
`useInboxCompactLayout`). It reads `matchMedia` in the browser, and on the
server, and during the hydration that must match it, it answers from the
request's viewport hint: the width the authenticated layout keeps in the
`rk_viewport` cookie, else a mobile user agent. A phone's first paint is then
already the phone layout. Do not add a `matchMedia` hook with a fixed server
answer.

## Presentation

Use `src/components/ui/chart.tsx` for Recharts composition. Define a `ChartConfig`,
wrap the chart in `ChartContainer`, and use generated `--color-*` variables. Choose
bar, area, or pie geometry from the data relationship, not decoration.

A plain `<a>` or `Link` is a content link: `styles.css` gives it the accent ink as
a default in `@layer base`, so any utility on the anchor wins and nothing needs
an `!`. A link that belongs to a component with its own ink opts out by
`data-slot` (button, badge, sidebar entry, dropdown-menu-item, breadcrumb-link).
Navigation-like links (nav items, tabs, whole-row links) name their ink in
classes. `link-ink.test.ts` fails on an important modifier on colour or
decoration. What colour a link's classes actually resolve to, in both themes, is
read only by `e2e/storybook-metrics/link-ink.metrics.ts` (`pnpm
test:storybook:metrics`), because the Storybook Vitest runner compiles no
Tailwind. That spec is not wired into CI (see `playwright.storybook.config.ts`),
so a change to link ink, `@layer base` in `styles.css` or the sidebar entry
classes must run it by hand before merge.

Use `usePermissions()` for presentation affordances rather than threading
`canEdit` flags. These affordances never replace server authorization. Prefer one
cohesive component over one-caller fragments; extract only independently meaningful
UI or behavior.

## Verification

Keep behavior-focused unit tests and stories beside components. Verify forms across
success, tagged error, pending, and disabled states; verify query transitions and
cache preservation at observable boundaries. Use a running browser for layout,
hydration, keyboard, responsive, and visual behavior.
