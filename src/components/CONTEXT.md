# Components — Context

**Audience:** AI agents and developers working in `src/components/`.

## Folder structure

```
components/
  ui/              shadcn primitives (alert-dialog, button, card, dialog, input, select, etc.)
  forms/           shared form building blocks (submit-button, form-text-field, form-textarea, form-error-banner)
  layout/          app shell pieces (header, footer, manager-sidebar, staff-sidebar, settings-sidebar, app-top-bar, auth-layout, theme-toggle)
  hooks/           shared React hooks used across features
  features/
    guest/         public-portal/
    identity/      login/, registration/, reset-password/, member-directory/, shared/
    organization/  (flat — too few files for sub-folders)
    portal/        link-tree/, portal-detail/, portal-form/, portal-preview/, portal-settings/, portal-share/
    property/      property-detail/, property-form/
    staff/         (flat)
    team/          team-form/, team-members/
```

**Also adjacent:** `src/hooks/` (lower-level utility hooks: `use-as-ref`, `use-isomorphic-layout-effect`, `use-lazy-ref`) and `src/lib/` (shared utilities: `utils.ts`, `compose-refs`, `lookups`). These are not component-specific.

## Rules

1. **Kebab-case filenames** — all `.tsx` and `.ts` files. Enforced by `scripts/check-filenames.mjs` on `pnpm lint`.
2. **Named exports only** — no default exports.
3. **Barrel re-exports** — each feature has `index.ts` exporting only page-level components. Sub-components stay internal. ESLint `no-restricted-imports` blocks deep imports into feature internals.
4. **Max 150 lines per file** — if a component exceeds this, extract sub-components into the same concept folder. **Exempt:** `ui/` (vendored shadcn code).
5. **Props typing** — `type Props = Readonly<{ ... }>` for all components. **Exempt:** `ui/` (shadcn components use library defaults).
6. **One concept per folder** — each sub-folder is a single user-facing concept (list, detail, form, widget).
7. **Feature `shared/`** — components used across multiple concept folders within that feature. Not for cross-feature sharing (those go in `forms/` or `ui/`).

## Dependency rules

Components may import from:
- Other `components/` directories
- `shared/` (hooks, utilities, domain types for display)
- `contexts/<ctx>/application/dto/` (to derive form schemas only)

Components must **never** import from:
- `domain/`, `application/` (non-dto), `infrastructure/`
- Direct DB access or Drizzle

**Exception:** Components with 5+ server function mutations (e.g., `link-tree.tsx`) may import from `server/` to avoid excessive prop drilling. This is a deliberate trade-off — document it with a comment when used.

## Form patterns

All forms use **TanStack Form + Zod v4 + shadcn/ui**. No React Hook Form, Formik, or plain `useState` forms.

1. **Schema source** — Zod schemas live in `contexts/<ctx>/application/dto/`. Forms derive their schema using `.required()`, `.extend()`, `.omit()`, or use the DTO directly. Never duplicate validation rules.
2. **Submission** — every form goes through `useServerFn` wrapping a server function. The `useServerFn` instance is defined in the route file and passed as a prop. Never call server functions directly from form components.
3. **Validation trigger** — `validators.onSubmit` (not `onChange`). TanStack Form v1 handles Zod schemas natively — pass the schema directly, no adapter needed.
4. **State** — `useServerFn` state (`isPending`, `error`, `status`) drives submit button and error display. Never manage `isSubmitting` manually.

### Form building blocks (`components/forms/`)

- `SubmitButton` — wraps shadcn `Button`, shows spinner when pending
- `FormErrorBanner` — displays top-level action errors (translates tagged errors)
- `FormTextField` / `FormTextarea` — standard field wrappers wired with TanStack Form

## Shared hooks (`components/hooks/`)

| Hook | Purpose |
|------|---------|
| `use-action` | Wraps `useServerFn` for fire-and-forget actions (non-form mutations) |
| `use-mutation-action` | Combines `useServerFn` + router invalidation + toast in one call. Supports `invalidateRoutes` for targeted invalidation instead of full `router.invalidate()`. Also available as `useMutationActionSilent` (no toast). |
| `use-property-id` | Extracts `propertyId` from route params. Use in any property-scoped component. |
| `use-mobile` | Responsive breakpoint hook |

## Anti-patterns

- Passing `canEdit`/`canCreate` booleans as props — use `usePermissions()` in the component
- Fetching route data inside components with `useQuery` — route loaders handle data fetching
- Calling server functions directly without `useServerFn`
- Defining server function hooks inside components — dependency rules forbid importing `server/` from `components/` (except for high-mutation components, see dependency rules above)
