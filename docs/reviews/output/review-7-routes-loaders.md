# Review #7 — Routes, Loaders & Mutations

**Reviewer:** AI Code Reviewer  
**Date:** 2026-05-23  
**Scope:** `src/routes/` (46 files: \_\_root, \_authenticated layout, 10 public/API routes, 34 authenticated sub-routes)

---

## Verdict

The route layer is well-structured. All authenticated routes are correctly nested under `_authenticated.tsx`. Public routes implement their own auth guards where required. Loaders call server functions exclusively; mutations use `useMutationAction` consistently. Permission gating uses `can()` everywhere — no raw role comparisons found. No loaders return unsanitized errors.

**No BLOCKERs found.**  
**No MAJORs found.**  
**6 MINORs found.**

---

## Findings

### [MINOR] M1 — Most routes lack route-level `<head>` for title/meta

Only `__root.tsx` (global defaults) and `p/$propertySlug/$portalSlug.tsx` (guest portal) define `head()` with `<title>` and `<meta>` tags. All authenticated routes and remaining public routes rely solely on the root default `"Reputation Key"`.

File: `src/routes/_authenticated/inbox/index.tsx` (representative)
File: `src/routes/_authenticated/properties/index.tsx`
File: `src/routes/_authenticated/properties/$propertyId/index.tsx`
File: `src/routes/_authenticated/settings/profile.tsx`
File: `src/routes/_authenticated/settings/organization.tsx`
File: `src/routes/_authenticated/leaderboard.tsx`
File: `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`
File: `src/routes/_authenticated/properties/$propertyId/goals/$goalId.tsx`
File: `src/routes/login.tsx`
File: `src/routes/register.tsx`
Rule: Missing route-level title/meta
Fix: Add a `head()` function to each route returning `{ meta: [{ title: 'Inbox — Reputation Key' }] }` etc. Start with user-facing routes (inbox, property detail, portal detail, settings, login/register) and add placeholder pages later.

---

### [MINOR] M2 — `p/$portalSlug.tsx` references `portal` in useEffect before lexical destructuring

The `useEffect` on line 71 references `portal.id` on line 80, but `portal` is not destructured from `data` until line 87. While this works at runtime (useEffect callbacks run after render), it is confusing and would trigger `no-use-before-define` linters.

File: `src/routes/p/$propertySlug/$portalSlug.tsx:71-87`
Quote:

```tsx
useEffect(() => {
  // ...
  recordScan({
    data: {
      portalId: portal.id, // ← portal not yet destructured
      source,
      referralCode: search.ref ?? null,
    },
  })
}, [])

const { portal, categories, links } = data // ← destructured here
```

Rule: Code readability / temporal dead zone hygiene
Fix: Move the destructuring `const { portal, categories, links } = data` above the `useEffect` call.

---

### [MINOR] M3 — CONTEXT.md documents `Promise.allSettled` but `_authenticated.tsx` loader uses `Promise.all`

File: `src/routes/CONTEXT.md:58`
Quote:

```
loader — loads organizations and properties in parallel (Promise.allSettled).
```

File: `src/routes/_authenticated.tsx:124`
Quote:

```tsx
const [orgsResult, propsResult] = await Promise.all([
  listUserOrganizations(),
  listProperties(),
])
```

Rule: Documentation/code invariant drift
Fix: Either update CONTEXT.md to reflect `Promise.all` (the correct choice — if either fails, the shell should error-boundary), or switch the code to `Promise.allSettled` and handle partial failures. Recommend updating CONTEXT.md since `Promise.all` is the correct semantic here.

---

### [MINOR] M4 — CONTEXT.md documents `properties/new.tsx` but file does not exist

File: `src/routes/CONTEXT.md:24`
Quote:

```
new.tsx                         create property
```

Rule: File naming / documentation drift from router convention
Fix: Either implement `src/routes/_authenticated/properties/new.tsx` for property creation, or remove the entry from CONTEXT.md if property creation is handled solely through the import flow.

---

### [MINOR] M5 — `api/auth/google/callback.ts` accesses container use cases directly

The OAuth callback route calls `getContainer().useCases.connectGoogleAccount()` instead of going through a server function. This is architecturally justified — API routes that return `Response` objects (redirects) cannot use the standard `createServerFn` pattern. However, the route also contains 100+ lines of inline helpers (HMAC verification, state parsing, error classification) that could benefit from extraction.

File: `src/routes/api/auth/google/callback.ts:144-148`
Quote:

```tsx
const { useCases } = getContainer()
const connection = await useCases.connectGoogleAccount({ code, visibility }, ctx)
```

Rule: Dependency rules — routes should call server functions, not use cases directly
Fix: Extract `parseAndValidateState`, `redirectWithError`, and `classifyError` into `shared/auth/oauth-helpers.ts`. Consider wrapping the code-exchange + connection logic in a dedicated server function (e.g., `handleGoogleOAuthCallback`) that returns `{ connectionId, error? }`, keeping the route file to ~30 lines of HTTP wiring.

---

### [MINOR] M6 — `reset-password.tsx` has no `beforeLoad` guard for already-authenticated users

All other auth-aware public routes (`login.tsx`, `register.tsx`, `join.tsx`) check for an existing session in `beforeLoad` and redirect to `/dashboard`. `reset-password.tsx` skips this check, allowing authenticated users to reach the password reset page.

File: `src/routes/reset-password.tsx:8-9`
Quote:

```tsx
export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
})
```

Rule: Consistency with auth guard pattern across public routes
Fix: Add `beforeLoad: async () => { const session = await getSession(); if (session) throw redirect({ to: '/dashboard' }) }` to match the pattern in login/register/join, unless intentionally allowing authenticated users to reset their password (in which case document this as an intentional exception).

---

## Positive Observations

1. **Auth architecture is solid.** `_authenticated.tsx` correctly implements `beforeLoad` with `getSession()` (server function, not `authClient`), handles the `no_active_org` edge case, and propagates unexpected errors to the error boundary.

2. **Permission gating uses `can()` everywhere.** `settings/organization.tsx` uses `can(role, 'organization.update')`, `portals/new.tsx` uses `can(role, 'portal.create')`. No raw role string comparisons found.

3. **Loader pattern is consistent.** All loaders call server functions from `contexts/<ctx>/server/`. No direct database, ORM, or fetch calls in any loader or mutation.

4. **Mutation invalidation keys match route IDs.** All `invalidateRoutes` arrays use correct TanStack Router route IDs that correspond to actual routes. No key drift detected.

5. **Data ownership is in URL.** Inbox, people, and goals routes use `validateSearch` with Zod schemas for filters, keeping all filter/pagination state in the URL.

6. **Route files are thin.** No route file exceeds 80 lines of JSX. All routes delegate rendering to dedicated components in `components/`. The largest component JSX is `~38` lines in `$teamId.tsx`.

7. **No `useQuery`/`useSuspenseQuery` in routes.** All data fetching uses route loaders per the architecture mandate.

8. **Webhook route follows documented exception.** `api/webhooks/gbp/notifications.ts` correctly imports from infrastructure handlers per the CONTEXT.md webhook exemption, verifies the JWT, extracts identifiers, and delegates to the handler.

---

## Auth/Permission Posture Summary

| Route                                    | Auth Guard                                                | Permission Gate                    | Pattern                       |
| ---------------------------------------- | --------------------------------------------------------- | ---------------------------------- | ----------------------------- |
| `_authenticated.tsx`                     | `beforeLoad` → `getSession()` + `getActiveOrganization()` | —                                  | Auth shell                    |
| `settings/organization.tsx`              | inherited                                                 | `can(role, 'organization.update')` | ✓ `can()`                     |
| `properties/$propertyId/portals/new.tsx` | inherited                                                 | `can(role, 'portal.create')`       | ✓ `can()`                     |
| `login.tsx`                              | `beforeLoad` → redirect if session                        | —                                  | Public, redirect-to-dashboard |
| `register.tsx`                           | `beforeLoad` → redirect if session                        | —                                  | Public, redirect-to-dashboard |
| `join.tsx`                               | `beforeLoad` → redirect if session                        | —                                  | Public, redirect-to-dashboard |
| `accept-invitation.tsx`                  | `beforeLoad` → redirect if no session                     | —                                  | Public, redirect-to-login     |
| `reset-password.tsx`                     | **none**                                                  | —                                  | Public, no guard (see M6)     |
| `p/$propertySlug/$portalSlug.tsx`        | none (public guest portal)                                | —                                  | Public by design              |
| `api/*`                                  | manual (JWT, session)                                     | —                                  | API routes                    |

**No permission gating issues found.** All authorization checks use `can()` from `shared/domain/permissions`.

---

## Loader → Mutation Key Mismatches

**None found.** All mutation `invalidateRoutes` arrays target valid, existing route IDs:

| Mutation Location                                  | Invalidates                                                   | Target Route |
| -------------------------------------------------- | ------------------------------------------------------------- | ------------ |
| `_authenticated.tsx` (setActiveOrganization)       | `['_authenticated']`                                          | ✓            |
| `accept-invitation.tsx`                            | `['_authenticated']`                                          | ✓            |
| `properties/import/index.tsx`                      | `['_authenticated']`                                          | ✓            |
| `properties/$propertyId/portals/new.tsx`           | `['_authenticated/properties/$propertyId/portals/']`          | ✓            |
| `properties/$propertyId/portals/$portalId.tsx`     | `['_authenticated/properties/$propertyId/portals/$portalId']` | ✓            |
| `properties/$propertyId/teams/$teamId/index.tsx`   | `['_authenticated/properties/$propertyId/teams/$teamId']`     | ✓            |
| `properties/$propertyId/teams/$teamId/members.tsx` | `['_authenticated/properties/$propertyId/teams/$teamId']`     | ✓            |
| `properties/$propertyId/goals/new.tsx`             | `['_authenticated/properties/$propertyId/goals']`             | ✓            |
| `properties/$propertyId/goals/$goalId.tsx`         | `['_authenticated/properties/$propertyId/goals']`             | ✓            |

---

## Files Reviewed (46 total)

### Root & Layout

- `__root.tsx`
- `_authenticated.tsx`

### Public Routes

- `index.tsx`, `login.tsx`, `register.tsx`, `reset-password.tsx`, `join.tsx`, `accept-invitation.tsx`

### Guest Portal

- `p/$propertySlug/$portalSlug.tsx`

### Authenticated — Dashboard & Home

- `_authenticated/home.tsx`, `_authenticated/dashboard.tsx`

### Authenticated — Inbox

- `_authenticated/inbox/index.tsx`

### Authenticated — Staff Pages

- `_authenticated/leaderboard.tsx`, `_authenticated/team.tsx`, `_authenticated/progress.tsx`

### Authenticated — Settings

- `_authenticated/settings.tsx`, `_authenticated/settings/index.tsx`, `_authenticated/settings/profile.tsx`, `_authenticated/settings/preferences.tsx`, `_authenticated/settings/organization.tsx`, `_authenticated/settings/security.tsx`

### Authenticated — Properties

- `_authenticated/properties/index.tsx`, `_authenticated/properties/import/index.tsx`, `_authenticated/properties/import/-import-page-header.tsx`, `_authenticated/properties/import/$importId.tsx`, `_authenticated/properties/$propertyId.tsx`, `_authenticated/properties/$propertyId/index.tsx`, `_authenticated/properties/$propertyId/metrics.tsx`, `_authenticated/properties/$propertyId/reviews.tsx`, `_authenticated/properties/$propertyId/people.tsx`

### Authenticated — Portals

- `_authenticated/properties/$propertyId/portals/index.tsx`, `_authenticated/properties/$propertyId/portals/new.tsx`, `_authenticated/properties/$propertyId/portals/$portalId.tsx`

### Authenticated — Teams

- `_authenticated/properties/$propertyId/teams/$teamId.tsx`, `_authenticated/properties/$propertyId/teams/$teamId/index.tsx`, `_authenticated/properties/$propertyId/teams/$teamId/members.tsx`

### Authenticated — Goals

- `_authenticated/properties/$propertyId/goals.tsx`, `_authenticated/properties/$propertyId/goals/new.tsx`, `_authenticated/properties/$propertyId/goals/$goalId.tsx`

### API Routes

- `api/health/index.ts`, `api/auth/$.ts`, `api/auth/google/callback.ts`, `api/portals/$id/qr.ts`, `api/public/click/$linkId.ts`, `api/webhooks/gbp/notifications.ts`

---

## Summary

**routes reviewed:** 46 files across public, authenticated, guest, and API routes  
**auth/permission posture changes flagged:** 1 — `reset-password.tsx` missing `beforeLoad` guard (M6)  
**loader→mutation key mismatches listed:** 0 mismatches found; all 9 mutation invalidation targets verified correct  
**overall assessment:** Clean, well-structured route layer. The architecture mandates are consistently followed. Findings are limited to documentation drift and minor style issues.
