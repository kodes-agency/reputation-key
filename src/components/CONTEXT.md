# Components — Context

**Audience:** Developers and agents working in `src/components/`.

## Responsibility

Components own reusable UI primitives, forms, layouts, hooks, and feature-facing
presentation. Business state and effects remain in bounded contexts; route loaders
and actions supply server state.

- `ui/` contains vendored shadcn primitives.
- `forms/` contains shared TanStack Form fields, submission, and error UI.
- `layout/` contains app-shell and navigation pieces.
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

A component with five or more closely related mutations may value-import its
server functions when prop drilling would obscure one cohesive workflow. Document
the exception in the component and add it to the checker allowlist; do not widen
the exception to its whole feature without the same mutation density.

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
`use-page-visible-and-focused` pauses sensitive polling; `use-property-id` reads
Property route scope; `use-theme-mode` owns persisted theme state.

## Presentation

Use `src/components/ui/chart.tsx` for Recharts composition. Define a `ChartConfig`,
wrap the chart in `ChartContainer`, and use generated `--color-*` variables. Choose
bar, area, or pie geometry from the data relationship, not decoration.

Use `usePermissions()` for presentation affordances rather than threading
`canEdit` flags. These affordances never replace server authorization. Prefer one
cohesive component over one-caller fragments; extract only independently meaningful
UI or behavior.

## Verification

Keep behavior-focused unit tests and stories beside components. Verify forms across
success, tagged error, pending, and disabled states; verify query transitions and
cache preservation at observable boundaries. Use a running browser for layout,
hydration, keyboard, responsive, and visual behavior.
