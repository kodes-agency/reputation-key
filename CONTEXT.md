# Context — Reputation Key

## Architecture

Layered hexagonal (clean architecture). Sixteen bounded contexts in `src/contexts/`, shared infrastructure in `src/shared/`, React frontend in `src/components/` and `src/routes/`.

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

|     | Context      | Responsibility                                                                          | Key Entities                            |
| --- | ------------ | --------------------------------------------------------------------------------------- | --------------------------------------- |
|     | Identity     | Users, organizations, members, invitations                                              | User, Organization, Member, Invitation  |
|     | Property     | Properties (hotels/restaurants) owned by organizations                                  | Property                                |
|     | Portal       | Guest-facing portal pages with links and portal groups, per property                    | Portal, Link, LinkCategory, PortalGroup |
|     | Guest        | Public portal rendering, rating collection, feedback                                    | Rating, Feedback                        |
|     | Team         | Staff teams and shift management                                                        | Team                                    |
|     | Staff        | Staff assignments to properties                                                         | StaffAssignment                         |
|     | Integration  | Google connections, OAuth, tokens, GBP API adapter                                      | GoogleConnection                        |
|     | Review       | External platform reviews (Google), sync, replies                                       | Review                                  |
|     | Inbox        | Unified triage surface for reviews + feedback                                           | InboxItem, InboxNote                    |
|     | Metric       | Aggregation of raw counters (scans, ratings, clicks, reviews)                           | MetricReading                           |
|     | Goal         | Property-scoped goals with progress tracking                                            | Goal, GoalInstance                      |
|     | Badge        | Recognition awards earned by portals or portal groups from metric-driven criteria       | BadgeDefinition, BadgeAward             |
|     | Leaderboard  | Read-only ranking of portals and portal groups using composite and per-metric scores    | LeaderboardEntry, LeaderboardSnapshot   |
|     | Dashboard    | Read-only aggregation of metrics, reviews, replies into property-scoped KPIs and charts | —                                       |
|     | Notification | User-facing in-app/email notifications                                                  | —                                       |
|     | Activity     | Immutable audit log                                                                     | —                                       |

## Glossary

### Roles & Permissions

| Term                       | Definition                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Role**                   | A named set of permissions assigned to an organization member. Org-wide — not per-property.                                       |
| **AccountAdmin**           | Organization owner. Full permissions including role management (`ac.*`). Created when the org is created.                         |
| **PropertyManager**        | Can manage properties, portals, members, teams. Cannot delete resources or manage roles.                                          |
| **Staff**                  | Read-only access. Can view reviews.                                                                                               |
| **Permission**             | A `resource.action` string (e.g. `portal.create`). The atomic unit of authorization.                                              |
| **Dynamic Access Control** | Better-auth feature that loads org-specific role overrides from the DB at permission-check time. Built-in roles are the fallback. |
| **Staff Assignment**       | Links a member to a specific property. Controls which properties a PropertyManager can manage.                                    |

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

| Term                 | Definition                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portal Group**     | A named collection of portals within a property. Used for goal scoping and leaderboard ranking. One portal belongs to at most one group. Lives in the portal context. |
| **Ungrouped Portal** | A portal not assigned to any portal group. Still individually targetable by goals and rankable on leaderboards.                                                       |

### Badges

| Term                                          | Definition                                                                                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Badge**                                     | A recognition award earned by a portal or portal group when metric-driven criteria are met. Badges are recognition artifacts, not permissions or access-control labels.                                                       |
| **Badge Criteria**                            | The metric-driven condition for earning a badge. Criteria can target a portal or portal group and use metric keys, operators, thresholds, time windows, or streak rules.                                                      |
| **Badge Metric Scope**                        | Phase 16.2 badge criteria use portal-scoped metrics only; property-level metrics are not inherited by portal or portal group badges.                                                                                          |
| **Badge Criterion Operator**                  | Phase 16.2 badge criteria support `>=` and `<=` comparisons against metric history.                                                                                                                                           |
| **Badge Criteria Versioning**                 | Badge criteria versions increment only when the earning rule changes, not when presentation metadata changes.                                                                                                                 |
| **Badge Definition**                          | A reusable badge rule with criteria, target scope, name, icon, and enabled state. Phase 16.2 definitions are system-seeded and org-enabled, not manager-edited.                                                               |
| **Disabled Badge Definition Existing Awards** | Disabling a system badge definition prevents future awards but keeps already-earned awards visible as historical recognition.                                                                                                 |
| **Organization Badge Enablement**             | An organization-level choice to enable or disable a system badge definition. It does not change the badge criteria.                                                                                                           |
| **Badge Streak**                              | A streak criterion that requires a target to be met on consecutive calendar days. A streak is evaluated from metric history, not from goal progress.                                                                          |
| **Streak Timezone**                           | Badge streak days are evaluated in the target portal's property timezone.                                                                                                                                                     |
| **Badge Milestone**                           | A one-time badge criterion based on an all-time count threshold, such as first review or first feedback response.                                                                                                             |
| **Badge Time Window**                         | The period used to evaluate badge criteria. Phase 16.2 supports both calendar windows and rolling windows.                                                                                                                    |
| **Badge Time Window Set**                     | Phase 16.2 supports calendar periods today, this week, this month, this quarter, all time, and rolling periods last 7, 30, and 90 days.                                                                                       |
| **Badge Evaluation**                          | The process of checking badge criteria against metric history. Phase 16.2 uses immediate metric-event evaluation plus hourly reconciliation for missed events.                                                                |
| **Badge Reconciliation**                      | A safety pass that re-evaluates badge criteria so missed events or failed jobs do not permanently prevent valid awards.                                                                                                       |
| **Badge Award**                               | The fact that a specific portal or portal group earned a specific badge once. For portal group badges, membership is evaluated at award time; later membership changes do not revoke the award.                               |
| **Deleted Portal Badge History**              | Badge awards earned by a portal remain visible as historical recognition after the portal is soft-deleted.                                                                                                                    |
| **Badge Award Idempotency Key**               | A badge award is unique per badge definition, criteria version, and target.                                                                                                                                                   |
| **Deleted Portal Group Badge History**        | Badge awards earned by a portal group remain visible as historical recognition after the group is soft-deleted.                                                                                                               |
| **Badge Recurrence**                          | Phase 16.2 badges are one-time achievements per target; the same badge is not re-awarded in later periods.                                                                                                                    |
| **Role-Filtered Badge Visibility**            | Badge visibility follows role and assignment boundaries: managers see managed property badges; staff see badges for assigned portals and portal groups containing assigned portals.                                           |
| **Staff Badge History Visibility**            | Staff badge visibility follows current assignments only; historical portal/group badge history remains visible to managers and on the target itself.                                                                          |
| **Badge Notification Audience**               | Badge award notifications go to property managers and staff assigned to the awarded portal or portal group.                                                                                                                   |
| **Badge UI Placement**                        | Earned badges appear on staff home, leaderboard, and portal detail pages.                                                                                                                                                     |
| **Phase 16.2 Badge Library**                  | The initial system badge set: First Review, First Feedback Response, 100 Scans, 500 Scans, 1000 Scans, 10 Feedback Responses, 50 Feedback Responses, 4.5 Avg Rating This Month, 7-Day Scan Streak, and 5-Day Feedback Streak. |

### Leaderboards

| Term                                          | Definition                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Leaderboard Composite Score**               | A single rank score combining normalized portal or portal group metrics for an overall leaderboard.                                                                    |
| **Leaderboard Snapshot Strategy**             | Leaderboard snapshots are refreshed by metric events for the affected property/period, with hourly reconciliation for missed updates.                                  |
| **Leaderboard Snapshot Key**                  | Phase 16.2 leaderboard snapshots are keyed by property, period, scope, and metric.                                                                                     |
| **Leaderboard Ranking Scope**                 | Phase 16.2 ranks portals and portal groups within a selected property; ungrouped portals remain individually rankable.                                                 |
| **Leaderboard Tie Handling**                  | Equal leaderboard scores share the same rank; deterministic ordering is used only to stabilize display order within a tie.                                             |
| **Property-Scoped Leaderboard Normalization** | Metric normalization is computed within a selected property and leaderboard period, so portals and portal groups compete against peers in the same property.           |
| **Fixed Composite Score Formula**             | The system-defined metric weights used for the overall leaderboard. Phase 16.2 uses 40% average rating, 30% feedback responses, 20% scans, and 10% review-link clicks. |
| **Per-Metric Leaderboard**                    | A leaderboard ranked by one metric only, used as drill-down from the composite leaderboard.                                                                            |

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
| **Addressed**        | Inbox item has been handled. For reviews: reply published or manually marked. For feedback: internally handled.                                                                                                                                                                                                                                       |
| **Internal Note**    | A text annotation on an inbox item. Multiple per item, tracks author and timestamp. Lives in `inbox` context.                                                                                                                                                                                                                                         |
| **Response SLA**     | The organization's target maximum elapsed time between a review being received and a reply being published. Configurable per organization (default 48h). Used to flag reviews that still need a reply.                                                                                                                                                |

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

## Client/Server Boundary

TanStack Start builds **two bundles** — client and server. Server-only code that leaks into the client bundle **crashes hydration**: Vite externalizes Node builtins, and accessing them in the browser throws (`Module "crypto" has been externalized for browser compatibility`) before React hydrates — every page renders but nothing is interactive. This has bitten us twice (ADR 0012, ADR 0015).

### What is server-only (must never run in the browser)

Node builtins (`crypto`, `async_hooks`, `fs`, `stream`, …), the packages `pg` / `ioredis` / `bullmq` / `drizzle-orm`, and these app modules: `src/composition.ts`, `src/contexts/*/build.ts`, `src/contexts/*/infrastructure/**` (repositories), `src/shared/db/**`, `src/shared/cache/**`, `src/shared/jobs/**`, `src/shared/observability/**`, `src/shared/auth/auth.ts`, `src/routes/api/**`.

### Rules

| Rule                                                                                                                | Why                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Put Node-builtin-using helpers in a `*.server.ts` file                                                              | Import protection mocks `*.server.*` in the client automatically (default rule)                                                                                          |
| Or add `import '@tanstack/react-start/server-only'` at the top of a server-only file                                | Marks it server-only without renaming                                                                                                                                    |
| Never mix a plain (non-`createServerFn`) export that uses Node builtins into a server-function file                 | The RPC transform stubs handler bodies but does **not** strip module-level imports used by plain exports — the whole module leaks when a barrel imports the plain export |
| `server/` barrels must re-export only `createServerFn` results and `import type`                                    | Value-importing a plain server-only helper drags the module (and its Node imports) into the client                                                                       |
| API routes (`routes/api/**`) are statically imported by `routeTree.gen.ts` and reach the client graph               | They are **not** `createServerFn`, so they are not RPC-stubbed — keep their imports server-only                                                                          |
| When adding a new server-only directory under `src/`, add it to `importProtection.client.files` in `vite.config.ts` | The default rules only match `*.server.*`; a directory convention needs an explicit deny rule                                                                            |

### Forbidden patterns

- Never export a plain function that uses Node builtins (`createHash`, `AsyncLocalStorage`, `randomUUID`) from a file that also exports `createServerFn` — move it to a `*.server.ts` file.
- Never value-import a server-only helper into a `server/` barrel that client code reaches (`import { hashIp } from './guest-scans'`). Use `import type` or import from a `*.server.ts` file.
- Never import `getAuth()` / `getDb()` / `getContainer()` / `getLogger()` from routes, components, or hooks — only from inside `createServerFn` handler bodies or API routes.
- `createServerFn` server functions are **safe** to import from client code — TanStack RPC-stubs them. `**/server/**` is deliberately **not** in the import-protection deny list; do not add it.

### Verify after touching this boundary

1. Dev server running, browser console open — **no** `externalized for browser compatibility` errors.
2. A `<button>` or `<input>` has `__reactProps*` keys (React hydrated).
3. A known server function (e.g. `auth.getSession`) logs `request complete` in the server output.

## Architecture Decisions

See `docs/adr/` for formal ADRs. Key ADRs:

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
|| 0009 | Permission Model | Architecture, Authorization |
|| 0010 | Activity Context: BullMQ Event Delivery | Activity Context, Event Delivery |
|| 0011 | Notification Context: BullMQ Event Delivery | Notification Context, Event Delivery |
|| 0012 | Nitro Vite Plugin — Dev-Mode Exclusion | Dev Tooling, Vite Config, TanStack Start |
|| 0013 | Portal Groups Replace Team and Staff as Goal/Leaderboard Scopes | Goal Scoping, Portal Groups |
|| 0014 | Badges and Leaderboards as Separate Recognition Contexts | Badges, Leaderboards, Recognition |
|| 0015 | Import Protection — Server-Only Code Leak | Dev Tooling, Client/Server Boundary |

## Key Files

| Area                        | Path                                               |
| --------------------------- | -------------------------------------------------- |
| Permission definitions      | `src/shared/auth/permissions.ts`                   |
| Permission type + `can()`   | `src/shared/domain/permissions.ts`                 |
| Role types + `hasRole()`    | `src/shared/domain/roles.ts`                       |
| Client permission hook      | `src/shared/hooks/usePermissions.ts`               |
| Auth context type           | `src/shared/domain/auth-context.ts`                |
| Auth middleware             | `src/shared/auth/middleware.ts`                    |
| Better-auth config          | `src/shared/auth/auth.ts`                          |
| Better-auth client          | `src/shared/auth/auth-client.ts`                   |
| Authenticated route         | `src/routes/_authenticated.tsx`                    |
| Composition root            | `src/composition.ts`                               |
| Bootstrap                   | `src/bootstrap.ts`                                 |
| Request tracing             | `src/shared/observability/traced-server-fn.ts`     |
| Tenant cache                | `src/shared/auth/middleware.ts`                    |
| Import protection deny list | `vite.config.ts` (`importProtection.client.files`) |
