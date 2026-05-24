# Review 7: Routes, Loaders & Mutations

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Scope

All 46 files in `src/routes/`.

---

## Findings

### [MAJOR] Components import server functions directly — violates architecture rule

File: `src/components/inbox/inbox-detail-content.tsx:8`
Quote: ```ts
import { updateInboxStatusFn } from '#/contexts/inbox/server/inbox'

````
Rule: `src/routes/CONTEXT.md` — "Components never import server functions directly. The useServerFn instance is defined in the route file and passed to the form component as a prop."
Fix: Move `useServerFn(updateInboxStatusFn)` to the route file and pass the action as a prop.

### [MAJOR] Components import server functions directly — inbox-bulk-actions

File: `src/components/inbox/inbox-bulk-actions.tsx:4`
Quote: ```ts
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
````

Rule: Same as above — components must receive actions as props, not import server functions.
Fix: Move `useServerFn(bulkUpdateInboxStatusFn)` to the route file, pass action as prop.

### [MAJOR] Components import server functions directly — inbox-notes-thread

File: `src/components/inbox/inbox-notes-thread.tsx:6`
Quote: ```ts
import { addInboxNoteFn } from '#/contexts/inbox/server/inbox'

````
Rule: Same as above.
Fix: Move `useServerFn(addInboxNoteFn)` to the route file, pass action as prop.

### [MAJOR] Components import server functions directly — inbox-filters

File: `src/components/inbox/inbox-filters.tsx:17`
Quote: ```ts
import { listProperties } from '#/contexts/property/server/properties'
````

Rule: Components must not import from server/ layer. The comment acknowledges this as an exception but the architecture rule is clear.
Fix: Either (a) pass the property list from the route loader data, or (b) accept it as a prop from the parent.

### [MAJOR] Components import server functions directly — inbox-unread-badge

File: `src/components/inbox/inbox-unread-badge.tsx:8`
Quote: ```ts
import { getUnreadCountFn } from '#/contexts/inbox/server/inbox'

````
Rule: Same — components must not import server functions.
Fix: Pass the server function action as a prop from the route file.

### [MAJOR] Components import server functions directly — portal-delete-button

File: `src/components/features/portal/portal-delete-button.tsx:15`
Quote: ```ts
import { deletePortal } from '#/contexts/portal/server/portals'
````

Rule: Same.
Fix: Pass the delete action as a prop.

### [MAJOR] Components import server functions directly — delete-property-dialog

File: `src/components/features/property/delete-property-dialog.tsx:2`
Quote: ```ts
import { deleteProperty } from '#/contexts/property/server/properties'

````
Rule: Same.
Fix: Pass the delete action as a prop.

### [MAJOR] Components import server functions directly — people-page

File: `src/components/features/property/people/people-page.tsx:10-11`
Quote: ```ts
import { listTeams, createTeam, deleteTeam } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
````

Rule: Same — four server function imports from a component.
Fix: Define all `useServerFn` wrappers in the route file and pass as props.

### [MAJOR] Components import server functions directly — use-gbp-locations

File: `src/components/features/integration/import-connected-view/use-gbp-locations.ts:7`
Quote: ```ts
import { listGbpLocations } from '#/contexts/integration/server/gbp-import'

````
Rule: Hooks in components also must not import server functions directly.
Fix: Accept the server function as a parameter to the hook, or define useServerFn in the route and pass.

### [MAJOR] Components import server functions directly — use-import-job-polling

File: `src/components/features/integration/import-progress/use-import-job-polling.ts:10`
Quote: ```ts
import { getImportStatus } from '#/contexts/integration/server/gbp-import'
````

Rule: Same.
Fix: Accept the server function as a parameter to the hook.

### [MAJOR] Component imports DTO schema from application layer

File: `src/components/features/team/team-form/create-team-form.tsx:14`
Quote: ```ts
import { createTeamInputSchema } from '#/contexts/team/application/dto/create-team.dto'

````
Rule: Per contexts/CONTEXT.md dependency rules, components may only import from `shared/`, not from context internals.
Fix: Re-export the schema from a shared barrel or pass it from the route file.

### [MAJOR] Unsafe `as` casts on route params in inbox route

File: `src/routes/_authenticated/inbox/index.tsx:16-33`
Quote: ```ts
const status = prev.status as string | undefined
// ...
itemId: prev.itemId as string | undefined,
propertyId: prev.propertyId as string | undefined,
// ...
? (status as InboxSearchParams['status'])
sourceType: prev.sourceType as InboxSearchParams['sourceType'],
platform: prev.platform as string | undefined,
ratingMin: prev.ratingMin as number | undefined,
ratingMax: prev.ratingMax as number | undefined,
// ...
const ctx = authRoute.useRouteContext() as AuthRouteContext
````

Rule: Type-safe params parsing required — no `as` casts on route params.
Fix: Use TanStack Router's `validateSearch` with a Zod schema to get typed search params, and use `Route.useRouteContext()` which is already typed.

### [MAJOR] Unsafe `as` cast on route context in settings/organization

File: `src/routes/_authenticated/settings/organization.tsx:12`
Quote: ```ts
const { role } = context as AuthRouteContext

````
Rule: Type-safe params — no `as` casts on route context.
Fix: Use typed `Route.useRouteContext()` from the parent route.

### [MAJOR] Unsafe `as` cast on route context in portals/new

File: `src/routes/_authenticated/properties/$propertyId/portals/new.tsx:13`
Quote: ```ts
const role = (context as AuthRouteContext).role
````

Rule: Same.
Fix: Use typed route context from the parent route.

### [MAJOR] Unsafe `as` cast on search params in join, login, accept-invitation, import

File: `src/routes/join.tsx:23`
Quote: ```ts
const search = Route.useSearch() as { redirect?: string }

````
File: `src/routes/login.tsx:27`
File: `src/routes/accept-invitation.tsx:34`
File: `src/routes/_authenticated/properties/import/index.tsx:26`
Rule: Type-safe params — use `validateSearch` with Zod schema.
Fix: Define `validateSearch` with Zod on each route to get fully-typed search params.

### [MAJOR] Unsafe `as Role` cast on better-auth role string

File: `src/routes/_authenticated.tsx:81`
Quote: ```ts
role = org.role as Role
````

Rule: Type-safe params — `as` casts on roles are unsafe.
Fix: Use `toDomainRole(org.role)` (already imported) to properly map and validate the role.

### [MINOR] No error boundaries defined on any data-fetching route

File: `src/routes/__root.tsx` and all route files
Quote: No `errorComponent` or `ErrorBoundary` found in any route file.
Rule: "Verify error boundaries exist for all data-fetching routes."
Fix: Add `errorComponent` to the root route and/or individual data-fetching routes for graceful error handling.

### [MINOR] Unsafe `as Response` casts in click API route

File: `src/routes/api/public/click/$linkId.ts:15,23,30,36`
Quote: ```ts
return new Response('Link not found', { status: 404 }) as Response

````
Rule: No `as` casts — use explicit typing or let TypeScript infer.
Fix: These are technically unnecessary since `new Response()` already returns `Response`. Remove the `as Response` casts.

### [MINOR] Unsafe `as` casts in Google OAuth callback

File: `src/routes/api/auth/google/callback.ts:42,67,97,99,100`
Quote: ```ts
const body = (await request.json()) as { ... }
// ...
(e as { _tag: string })._tag === 'AuthError' &&
(e as { code: string }).code === 'session_expired'
````

Rule: Type-safe parsing.
Fix: Use Zod schema validation for the request body, and type guards for error classification.

---

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 15    |
| MINOR    | 3     |
| NIT      | 0     |

**Most important thing to fix first:** The 10+ components that directly import server functions from `contexts/*/server/` violate the architecture rule that components must receive actions as props from route files. This is a systemic pattern — fix all at once by refactoring route→component prop passing.
