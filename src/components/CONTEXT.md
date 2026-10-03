# Components — Context

**Audience:** Developers and agents working in `src/components/`.

## Responsibility

Components own reusable UI primitives, forms, layouts, hooks, and feature-facing
presentation. Business state and effects remain in bounded contexts; route loaders
and actions supply server state.

- `ui/` holds vendored shadcn primitives plus app-wide presentation primitives
  that no feature owns (Fact, OwnerDisc, MetricStrip, SegmentedControl, Timeline,
  StarRating, RatingFigure, ConfirmationDialog, EmptyState, RegionError). Every
  confirmation goes through `ConfirmationDialog`, never an AlertDialog put together
  by hand (`dialog-sources.test.ts` fails on one). Its `tone` is `destructive` only
  for an action the person cannot take back or that loses data; archive, restore,
  disable-a-public-page and turn-off-AI-features are `neutral`, and so are their
  menu items. A destructive
  confirm is started from a `ConfirmationTrigger` (a destructive Button). Only a
  low-blast action the person can undo on the spot skips the dialog (remove a
  language from a draft, delete an unsent reply draft, dismiss one notification);
  Leave organisation is a `Dialog` because it is a transfer form, and the Inbox's
  Reject opens its reason inline. `onConfirm` returns the action's promise: the dialog
  stays open with a pending Button, refuses Escape and Cancel meanwhile, closes
  when it resolves and says a refusal once, above its actions (focus returns to the
  confirm). The mutation behind it therefore passes no `errorMessage`, and a caller
  returns the promise rather than dropping it. A dialog that holds a confirmation as
  its body (the Portal Version dialog) is `<Dialog busy>` while the request runs. A dialog is `Dialog`: it gets its width
  from `size` (`sm` 24rem, `md` 32rem the default, `lg` 42rem, `xl` 56rem) and its
  height bound and scroll from the primitive, so no `DialogContent` types a
  `sm:max-w-*` or a `max-h-*`. Its footer is `DialogFooter` (`note` is the line
  at the start of the row) with `DialogCancel` then the primary. The corner close is
  one Button named "Close"; a dialog whose footer has Cancel or Close may drop it
  (`showCloseButton={false}`, as the Inbox's two do). A dialog that is committing
  cannot be dismissed: `<Dialog busy={isPending}>`, or `useDialogBusy(isPending)`
  in a body that owns the mutation (`dialog-dismissal.ts`). A refusal a mutation in
  the page still holds from the last time a dialog was open is not shown again:
  the dialog's banner is `DialogErrorBanner`, which shows only an error from an
  attempt made since the dialog opened. A region with nothing to show, nothing that matches, or
  a read that failed is `EmptyState` (`size` default or compact, `tone` neutral or
  error, `description` and `action` slots) or `RegionError`, whose only recovery is
  "Try again" wired to the region's refetch. Never hand-build a dashed box or a
  "Retry" button; `region-states.test.ts` fails on both. A region keeps its failure
  on screen, its button busy, while the retry reads: key the panel on
  `hasFailed(query)` and pass `retrying` (`isRetrying(query)`) from
  `hooks/is-retrying`, because a query with no data drops its error and goes
  `pending` the moment it refetches. A dense workspace (the Inbox) passes
  `data-density="compact"` on its container (36px on a phone, not the 44px target).
  The bell's could-not-load body is plain markup on purpose: it sits in the
  first-paint closure.
  A control's height is not spelled by the caller. `Button`, `Input`,
  `SelectTrigger` and the menu items are 44px below `md` (the `--control-touch`
  token) and keep their desktop height from `md`; a dense workspace (the Inbox, the
  top bar) sets `data-density="compact"` on its container and the same controls
  are 36px there. A menu, sheet or dialog that portals out of the container says
  `data-density="compact"` itself. A small button that must stay a tap target on a
  phone is `touch` (`size="xs"`, `icon-xs`), and one whose label hides below a width
  is `iconBelow="md"` (or `"sm"`): no caller spells `--control-touch`. `Button` owns `pending` / `pendingLabel` (a
  spinner that stops for reduced motion, `aria-busy`, disabled, an optional label
  swap) and `SubmitButton` is that Button wired to a mutation: never draw a
  spinner beside a Button or swap its label on `isPending`. An icon-only control is
  an `IconButton` (a required `label` that is its name and its tooltip; the root
  mounts the one `TooltipProvider`; one that opens a menu or popover shows no
  tooltip), a link set in a sentence is `InlineLink`, text that explains itself on
  request is `ExplainTrigger` (a Popover with the one dotted-underline cue,
  `EXPLAIN_UNDERLINE`), a key hint prints the modifier this platform has
  (`useShortcutModifier`), and a control that is not a Button wears `focus-ring`. `button-sources.test.ts` fails
  on a per-file height, a hand-placed spinner, an icon-only Button, the old ring,
  a hand-typed inline link or dotted underline, a `--control-touch` class and a
  hand-copied form submit.
  A notice is an `Alert`: `destructive`, `warning`, `success` and `info` each
  draw the one icon their tone wears (`ui/tone.ts`, which Alert, Badge and
  StatusBadge all read), and `default` is a plain card for a notice that brings
  its own icon. `destructive` and `warning` are announced at once
  (`role="alert"`); `info`, `success` and `default` are `role="status"`, so a
  notice already on the page does not interrupt a screen reader. A typed toast
  wears the same icons and the information notice's colours. A status pill is a
  `Badge` tone (`positive`, `warn`, `negative`, `neutral`) or, for a domain status, `StatusBadge`: the feature writes a
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
  item, a download) reports through a toast,
  `errorMessage` on its `useActionMutation`, and never also a banner. A toast for
  a failure reads "Couldn't …. Try again." (`actionFailureMessage`), shows the
  server's own sentence only for a 4xx refusal, and a success says what changed
  without "successfully". `FormErrorBanner` follows the same rule (a 4xx
  refusal's sentence, a rejected schema's issue list, one generic sentence for
  anything else), so hand it the mutation's error as it is. An autosaved portal
  form (`usePortalFormAutosave`) has no actions to sit above and renders no
  banner: the editor header's save status reports its failure.
  `feedback-ownership.test.ts` reads the sources and fails on a file that does
  both, a hand-built red paragraph, or a toast that
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
`SubmitButton`, `FormErrorBanner`, `FormTextField`, and `FormTextarea`. A form's
`onSubmit` is `submitHandler(form)` (`forms/form-submit.ts`), never a copy of its
`preventDefault` / `stopPropagation` / `handleSubmit`; a key shortcut calls
`submitForm(form)`.

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
