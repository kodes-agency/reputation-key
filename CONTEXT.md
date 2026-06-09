# Context — Reputation Key

## Architecture

Layered hexagonal (clean architecture). Twelve bounded contexts in `src/contexts/`, shared infrastructure in `src/shared/`, React frontend in `src/components/` and `src/routes/`.

```
routes/ → contexts/<ctx>/server/ → contexts/<ctx>/application/ → contexts/<ctx>/domain/
                                        ↑
                          infrastructure/ implements ports
```

Composition root: `src/composition.ts`. Bootstrap: `src/bootstrap.ts`.

## Layer guides

| Working in                                        | Read this                   |
| ------------------------------------------------- | --------------------------- |
| Components, forms, hooks                          | `src/components/CONTEXT.md` |
| Domain, use cases, repos, server functions        | `src/contexts/CONTEXT.md`   |
| Shared infrastructure, auth, cache, observability | `src/shared/CONTEXT.md`     |
| Routes, loaders, mutations, auth guards           | `src/routes/CONTEXT.md`     |

## Bounded contexts

|| | Context | Responsibility | Key Entities |
|| --- | ------------ | --------------------------------------------------------------------------------------- | -------------------------------------- |
|| | Identity | Users, organizations, members, invitations | User, Organization, Member, Invitation |
|| | Property | Properties (hotels/restaurants) owned by organizations | Property |
|| | Portal | Guest-facing portal pages, links, and portal groups for aggregate metrics | Portal, Link, LinkCategory, PortalGroup |
|| | Guest | Public portal rendering, rating collection, feedback | Rating, Feedback |
|| | Team | Staff teams and shift management (no portal scoping, no metric attribution) | Team |
|| | Staff | Staff assignments to properties and portal access control | StaffAssignment |
| | Integration | Google connections, OAuth, tokens, GBP API adapter | GoogleConnection |
| | Review | External platform reviews (Google), sync, replies | Review |
| | Inbox | Unified triage surface for reviews + feedback | InboxItem, InboxNote |
| | Metric | Aggregation of raw counters (scans, ratings, clicks, reviews) | MetricReading |
|| Goal | Property-scoped goals with progress tracking; scope levels: property, portal, portal_group | Goal, GoalInstance |
|| Dashboard | Read-only aggregation of metrics, reviews, replies into property-scoped KPIs and charts | — |
|| Activity | Immutable audit log of user actions across all contexts. Pure subscriber (no commands, no use cases). | ActivityLog |
|| Notification | User-addressed, dismissable alerts about domain events. Event-driven subscriber with channel routing and preferences. | Notification |

## Glossary

### Roles & Permissions

| Term                       | Definition                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Role**                   | A named set of permissions assigned to an organization member. Org-wide — not per-property.                                       |
| **AccountAdmin**           | Organization owner. Full permissions including role management (`ac.*`). Created when the org is created.                         |
| **PropertyManager**        | Can manage properties, portals, members, teams. Cannot delete resources or manage roles.                                          |
| **Staff**                  | Read-only access. Can view reviews.                                                                                               |
| **Permission**             | A `resource.action` string (e.g. `portal.create`). The atomic unit of authorization.                                              |
| **Dynamic Access Control** | Better-auth feature that loads org-specific role overrides from the DB at permission-check time. Built-in roles are the fallback. |
|                            | **Staff Assignment**                                                                                                              | Links a member to a specific property. Controls which properties a PropertyManager can manage. Includes optional `portalId` for portal-level access control (not attribution). |

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

### Portal Groups

|| Term | Definition |
|| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|| **Portal Group** | A named grouping of portals within a property (e.g., "Reception" = 3 portals). Enables aggregate metrics and goals across multiple portals. A portal belongs to at most one group. Lives in the `portal_group` context. |
|| **Portal Group Goal** | A goal scoped to a portal group. Aggregates metric readings across all portals in the group. |

### Reviews & Feedback

| Term                 | Definition                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Review**           | A public review from an external platform (Google, future TripAdvisor). Has `platform`, `externalId`, `rating`, `text`, `reviewerName`. Reply state lives in a separate `Reply` entity. Lives in the `review` context.                                                                                                                                |
| **Rating**           | A private 1–5 star rating submitted by a portal visitor. Lives in the `guest` context.                                                                                                                                                                                                                                                                |
| **Feedback**         | A private text comment submitted by a portal visitor. Lives in the `guest` context.                                                                                                                                                                                                                                                                   |
| **GoogleConnection** | An OAuth connection to a Google account. Stores encrypted tokens, scopes, visibility. Lives in the `integration` context.                                                                                                                                                                                                                             |
| **ReviewPlatform**   | The external source of a review (`'google'`). Extensible for future platforms.                                                                                                                                                                                                                                                                        |
| **Review Sync**      | Process of fetching reviews from GBP. Triggered by Pub/Sub push notification (new/updated review) or manual "Sync Now" button. No periodic polling.                                                                                                                                                                                                   |
| **GBP Notification** | GCP Pub/Sub push from Google when a review is created or updated. Subscribed per-account on first property import, unsubscribed on last property removal or disconnect.                                                                                                                                                                               |
| **Reply**            | A response to a review. Separate entity from Review. Has `source`: `google_sync` (mirrored from GBP) or `internal` (staff-authored with draft/approve/reject lifecycle). Internal replies follow: `draft` → `pending_approval` → `approved` → `published` (or `publish_failed`). Only PM+ roles can manage replies; Staff cannot view or manage them. |
| **Inbox Item**       | A unified triage entry pointing to a Review or Feedback. Carries denormalized filter/sort fields and inbox state (status, assignment). Lives in the `inbox` context.                                                                                                                                                                                  |
| **Inbox Status**     | The triage state of an inbox item: `new`, `read`, `addressed`, `escalated`, `archived`. Transitions follow a defined graph (see ADR 0004).                                                                                                                                                                                                            |
| **Notification**     | A user-addressed, dismissable alert about a domain event. Distinct from ActivityLog (immutable audit) — notifications carry delivery state (unread/dismissed), channel routing, and user preferences. Lives in the `notification` context.                                                                                                            |
| **Addressed**        | Inbox item has been handled. For reviews: reply published or manually marked. For feedback: internally handled.                                                                                                                                                                                                                                       |
| **Internal Note**    | A text annotation on an inbox item. Multiple per item, tracks author and timestamp. Lives in `inbox` context.                                                                                                                                                                                                                                         |

## Permission Patterns

### When to use what

| API                           | When                                              | Import                          |
| ----------------------------- | ------------------------------------------------- | ------------------------------- |
| `can(role, permission)`       | Server functions, route `beforeLoad` guards       | `#/shared/domain/permissions`   |
| `usePermissions()`            | React components (reads role from route context)  | `#/shared/hooks/usePermissions` |
| `hasRole(role, requiredRole)` | Sidebar visibility, domain rules (hierarchy only) | `#/shared/domain/roles`         |

### Forbidden patterns

- Never pass `canEdit`/`canCreate`/`canDelete` boolean props — use `usePermissions()` in the component
- Never use `hasRole()` for permission checks — only for hierarchy
- Never call `toDomainRole()` on an already-mapped domain role — `resolveTenantContext()` already returns domain roles

## Pitfalls — Do Not Repeat

### P001: Nitro plugin in dev mode breaks TanStack Start hydration

**Symptom:** Pages render but server functions return 404 HTML instead of JSON. Client hydration never initializes. Browser console shows no TanStack router state.

**Root cause:** The `nitro()` Vite plugin (used for Sentry externalization in production builds) adds a `dispatchFetch` method to its Vite SSR environment during dev mode. TanStack Start's dev server plugin checks `"dispatchFetch" in serverEnv` and **skips installing its own middleware** when it finds it. Without TanStack's middleware, `/_serverFn/*` routes fall through to Nitro's catch-all, which returns HTML.

**Fix:** Only load `nitro()` during production builds:

```ts
const isBuild = mode === 'production'
return {
  plugins: [
    ...(isBuild ? [nitro({ rollupConfig: { external: [/^@sentry\//] } })] : []),
    // ...other plugins
  ],
}
```

**Rule:** Any Vite plugin that modifies the SSR environment must be validated against TanStack Start's dev server middleware. Test by hitting `/_serverFn/` — it must return JSON, never HTML.

**Reference:** ADR 0012.

### P002: NODE_ENV=production in shell skips devDependencies

**Symptom:** `vite: command not found`, missing TanStack devtools, no vitest.

**Root cause:** `NODE_ENV=production` in the shell environment causes `pnpm install` to skip all `devDependencies`.

**Fix:** The dev script explicitly sets `NODE_ENV=development`:

```json
"dev": "NODE_ENV=development vite dev --port 3000"
```

**Rule:** Never assume `NODE_ENV` defaults to `development`. Always set it explicitly in dev scripts.

### P003: TanStack @latest version drift breaks server function serialization

**Symptom:** Server functions return unexpected errors after a clean install. `start-plugin-core@1.171.x` vs `react-start@1.168.x` mismatch.

**Root cause:** Using `"latest"` in `package.json` means every `pnpm install` can pull different versions. TanStack Start's internal serialization protocol is version-sensitive.

**Fix:** Pin all TanStack packages to exact versions in `package.json`:

- `@tanstack/react-router`: `1.170.10`
- `@tanstack/react-start`: `1.168.18`
- `@tanstack/devtools-vite`: `0.7.0`

**Rule:** Never use `"latest"` or unbounded ranges for TanStack packages. Test version bumps deliberately.

### P004: Static import of @tanstack/react-start/server in shared modules

**Symptom:** Client-side build errors about server-only modules being imported in client bundles.

**Root cause:** `headersFromContext()` used a static `import { getRequest }` from `@tanstack/react-start/server`. Because `composition.ts` imports from shared and is reachable from both client and server, the static import pulled the server-only module into the client bundle.

**Fix:** Use dynamic import with try/catch:

```ts
export async function headersFromContext(): Promise<Headers> {
  try {
    const { getRequest } = await import('@tanstack/react-start/server')
    // ...
  } catch {
    // Outside server context — return empty headers
  }
}
```

**Rule:** Any shared module that touches `@tanstack/react-start/server` must use dynamic imports. Server functions are the only place where static imports from this package are safe.

## Architecture Decisions

See `docs/adr/` for formal ADRs. See `docs/standards.md` for codebase-wide naming and structural standards. Key ADRs:

|| ADR | Title | Context |
|| ---- | -------------------------------------- | -------------------------------- |
|| 0001 | Dynamic Access Control via Better-auth | Identity & Authorization |
|| 0002 | Section-Based Navigation | Navigation Architecture |
|| 0003 | Review as a Separate Bounded Context | Reviews, Google Integration |
|| 0004 | Inbox as a Separate Bounded Context | Unified Inbox, Reviews, Feedback |
|| 0005 | GBP Review API Path and Error Model Fix | Google Integration, Error Model |
|| 0006 | Staff as a Separate Bounded Context | Identity, Staff Management |
|| 0007 | Dashboard as a Read-Only Aggregation | Dashboard, Read Models |
|| 0008 | Cross-Context Data Access Rules | Architecture, Bounded Context Boundaries |
|| 0009 | Permission Model | Identity & Authorization |
|| 0010 | Activity Context: BullMQ Event Delivery | Activity, Event Delivery |
|| 0011 | Notification Context: BullMQ Event Delivery | Notification, Event Delivery |
| 0012 | Nitro Vite Plugin — Dev-Mode Exclusion | Dev Tooling, Vite, TanStack Start |

## Key Files

| Area                      | Path                                           |
| ------------------------- | ---------------------------------------------- |
| Permission definitions    | `src/shared/auth/permissions.ts`               |
| Permission type + `can()` | `src/shared/domain/permissions.ts`             |
| Role types + `hasRole()`  | `src/shared/domain/roles.ts`                   |
| Client permission hook    | `src/shared/hooks/usePermissions.ts`           |
| Auth context type         | `src/shared/domain/auth-context.ts`            |
| Auth middleware           | `src/shared/auth/middleware.ts`                |
| Better-auth config        | `src/shared/auth/auth.ts`                      |
| Better-auth client        | `src/shared/auth/auth-client.ts`               |
| Authenticated route       | `src/routes/_authenticated.tsx`                |
| Composition root          | `src/composition.ts`                           |
| Bootstrap                 | `src/bootstrap.ts`                             |
| Request tracing           | `src/shared/observability/traced-server-fn.ts` |
| Tenant cache              | `src/shared/auth/middleware.ts`                |
