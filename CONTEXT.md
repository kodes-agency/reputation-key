# Context — Reputation Key

## Bounded Contexts

| Context  | Responsibility                                         | Key Entities                           |
| -------- | ------------------------------------------------------ | -------------------------------------- |
| Identity | Users, organizations, members, invitations             | User, Organization, Member, Invitation |
| Property | Properties (hotels/restaurants) owned by organizations | Property                               |
| Portal   | Guest-facing portal pages with links, per property     | Portal, Link, LinkCategory             |
| Guest    | Public portal rendering, review collection, feedback   | Review, Feedback                       |
| Team     | Staff teams and shift management                       | Team, StaffAssignment                  |

## Glossary

### Roles & Permissions

| Term                       | Definition                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Role**                   | A named set of permissions assigned to an organization member. Org-wide — not per-property.                                            |
| **AccountAdmin**           | Organization owner. Full permissions including role management (`ac.*`). Created when the org is created.                              |
| **PropertyManager**        | Can manage properties, portals, members, teams. Cannot delete resources or manage roles.                                               |
| **Staff**                  | Read-only access. Can view reviews.                                                                                                    |
| **Custom Role**            | Org-specific role created by AccountAdmin via the admin UI. Stored in `organizationRole` table. Merged with built-in role definitions. |
| **Permission**             | A `resource.action` string (e.g. `portal.create`). The atomic unit of authorization.                                                   |
| **Dynamic Access Control** | Better-auth feature that loads org-specific role overrides from the DB at permission-check time. Built-in roles are the fallback.      |
| **Staff Assignment**       | Links a member to a specific property. Controls which properties a PropertyManager can manage.                                         |

### Auth Architecture

| Term                 | Definition                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Better-auth role** | Role string stored in better-auth's member table: `owner`, `admin`, `member`.                                           |
| **Domain role**      | Our business role type: `AccountAdmin`, `PropertyManager`, `Staff`. Mapped from better-auth roles via `toDomainRole()`. |
| **AuthContext**      | `{ userId, organizationId, role }` — attached to every server function call via `resolveTenantContext()`.               |
| **Route context**    | `{ user, role, activeOrganization }` — attached to every authenticated route via `_authenticated.tsx` `beforeLoad`.     |

### Property Access

| Term                    | Definition                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Property Assignment** | A `staff_assignment` record linking a user to a property. PropertyManagers only manage assigned properties.  |
| **Org-wide role**       | A member's role applies across the entire organization, but property-level actions are scoped by assignment. |

## Permission Patterns

### When to use what

| API                           | When                                              | Import                          |
| ----------------------------- | ------------------------------------------------- | ------------------------------- |
| `can(role, permission)`       | Server functions, route `beforeLoad` guards       | `#/shared/domain/permissions`   |
| `usePermissions()`            | React components (reads role from route context)  | `#/shared/hooks/usePermissions` |
| `hasRole(role, requiredRole)` | Sidebar visibility, domain rules (hierarchy only) | `#/shared/domain/roles`         |

### Route guard pattern

```typescript
import { can } from '#/shared/domain/permissions'

beforeLoad: ({ context }) => {
  const role = (context as AuthRouteContext).role
  if (!can(role, 'property.create')) {
    throw redirect({ to: '/properties' })
  }
}
```

### Component pattern

```typescript
import { usePermissions } from '#/shared/hooks/usePermissions'

function MyComponent() {
  const { can } = usePermissions()
  return <>{can('portal.create') && <Button />}</>
}
```

### Server function pattern

```typescript
import { can } from '#/shared/domain/permissions'

// Inside a server function handler:
const ctx = await resolveTenantContext(headers)
if (!can(ctx.role, 'member.update')) {
  throw new Error('Forbidden')
}
```

### Forbidden patterns

- **Never** pass `canEdit`/`canCreate`/`canDelete` boolean props — use `usePermissions()` in the component
- **Never** use `hasRole()` for permission checks — only for hierarchy (sidebar visibility, domain rules about who can manage whom)
- **Never** call `toDomainRole()` on an already-mapped domain role — `resolveTenantContext()` and `getActiveOrganization()` already return domain roles

## Architecture Decisions

See `docs/adr/` for formal ADRs.

## Navigation & Layout

| Term                         | Definition                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Section-based navigation** | Sidebar items represent functional sections (Reviews, People, Portals), not nested property sub-pages. Property switcher at top scopes all sections.                      |
| **Property switcher**        | Scope filter at the top of the sidebar. Selects which property data flows through all sections. Single-property orgs hide it.                                             |
| **Staff sidebar**            | Distinct sidebar for Staff role: Home, Progress, Leaderboard, Team (conditional). Not a trimmed manager sidebar.                                                          |
| **Progress**                 | Staff-only page combining stats and goals. Answers "where I am and where I'm going" in one view.                                                                          |
| **People section**           | Tabbed section replacing separate Staff/Members/Teams pages. Tabs: Directory (org members), Staff (property assignments), Teams (property teams).                         |
| **Settings route**           | Separate `/settings` route with its own sidebar. Profile, Security, Preferences, Organization, Property config, Billing (later), Agent (later). Not part of main sidebar. |
| **Dashboard**                | Manager landing page. Property-scoped summary: metric strip, recent reviews, goal progress, team snapshot. Teaser/router, not a data deep-dive.                           |
| **Layout width**             | Per-page declaration. Lists `max-w-4xl`, forms/settings `max-w-2xl`, data pages full-width with `px-8`. No width in layout wrapper.                                       |

## Component Organization

### Structure

Features use **domain-concept folders**, not type-based folders. Each concept collocates its components, hooks, and forms.

```
features/portal/
├── portal-form/
│   ├── create-portal-form.tsx
│   ├── edit-portal-form.tsx
│   └── portal-creation-with-preview.tsx
├── portal-detail/
│   └── portal-detail-page.tsx    # Thin orchestrator (~60 lines)
├── portal-settings/
│   ├── portal-settings.tsx
│   ├── theme-preset-selector.tsx
│   └── smart-routing-config.tsx
├── link-tree/
│   ├── link-tree.tsx             # Owns CRUD state, mutations, DnD
│   ├── sortable-category.tsx
│   ├── sortable-link.tsx
│   ├── category-add-form.tsx
│   ├── category-edit-inline-form.tsx
│   ├── link-add-inline-form.tsx
│   ├── link-edit-inline-form.tsx
│   └── link-inline-form.tsx
├── portal-share/
│   ├── portal-share.tsx
│   └── qr-code-modal.tsx
├── portal-preview/
│   └── portal-preview-panel.tsx
└── index.ts
```

`PortalDetailPage` is a thin orchestrator that composes `PortalSettings`, `LinkTree`, `PortalShare`, and `PortalPreviewPanel`. All link-tree CRUD state, mutations, and DnD logic live in `link-tree/link-tree.tsx`.

Each feature has a `shared/` subfolder for components used across multiple concept folders within that feature. Concept folders are self-contained. The feature barrel (`index.ts`) re-exports from both concept folders and `shared/`.

Shared directories: `components/ui/` (shadcn primitives), `components/forms/` (shared form blocks), `components/hooks/` (shared hooks) stay flat. `components/layout/` stays flat. `components/guest/` moves to `features/guest/` — Guest is a bounded context.

### Naming

All component files use **kebab-case** (`portal-detail.tsx`, `star-rating.tsx`). This applies to features, layout, forms, and guest components. UI primitives already follow this convention. Hook files use `use-` prefix with kebab-case (`use-action.ts`, `use-mobile.ts`).

### Exports

Named exports only. Barrel `index.ts` files re-export only page-level components (not internal sub-components) from each feature folder.

### Enforcement

- Kebab-case: `scripts/check-filenames.mjs` (runs on `pnpm lint`)
- Max file length: ESLint `max-lines` rule (150 lines, exempting old PascalCase files and `ui/` during migration)
- Barrel-only imports: ESLint `no-restricted-imports` blocks `#/components/features/*/*` deep imports

### Migration Plan

- **Phase 1:** Rename all 52 PascalCase files to kebab-case (mechanical, `scripts/rename-components.mjs`)
- **Phase 2:** Restructure Identity (pilot) into domain-concept folders
- **Phase 3:** Restructure Portal into domain-concept folders + extract `PortalDetailPage` god component
- **Phase 4:** Restructure remaining features:
  - **Property:** `property-form/` (create, edit, timezone components) + `property-detail/` (detail fields)
  - **Team:** `team-form/` (create, edit, lead select) + `team-members/` (member list)
  - **Guest:** `public-portal/` (content, star-rating, feedback-form) + standalone (`portal-unavailable`, `cookie-consent-banner`)
  - **Staff + Organization:** Leave flat, rename only (too few files to justify sub-folders)

## Key Files

| Area                      | Path                                 |
| ------------------------- | ------------------------------------ |
| Permission definitions    | `src/shared/auth/permissions.ts`     |
| Permission type + `can()` | `src/shared/domain/permissions.ts`   |
| Role types + `hasRole()`  | `src/shared/domain/roles.ts`         |
| Client permission hook    | `src/shared/hooks/usePermissions.ts` |
| Auth context type         | `src/shared/domain/auth-context.ts`  |
| Auth middleware           | `src/shared/auth/middleware.ts`      |
| Better-auth config        | `src/shared/auth/auth.ts`            |
| Better-auth client        | `src/shared/auth/auth-client.ts`     |
| Authenticated route       | `src/routes/_authenticated.tsx`      |
