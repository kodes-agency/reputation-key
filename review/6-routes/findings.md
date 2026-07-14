# Section 6 — Routes Findings

**Date:** 2026-05-29
**Scope:** `src/routes/` (all files)
**Baseline:** Zero `useQuery` in route files. All routes use loaders for data fetching.

---

## Summary

| Severity  | Count |
| --------- | ----- |
| MAJOR     | 2     |
| MINOR     | 1     |
| NIT       | 0     |
| **Total** | **3** |

---

## MAJOR Findings

### S6-1 MAJOR: 6 protected routes missing `can()` permission guards in `beforeLoad`

**Files:**

- `src/routes/_authenticated/inbox/index.tsx` — needs `inbox.read`
- `src/routes/_authenticated/properties/$propertyId/people.tsx` — needs `staff_assignment.read`
- `src/routes/_authenticated/properties/$propertyId/reviews.tsx` — needs `review.read`
- `src/routes/_authenticated/properties/$propertyId/metrics.tsx` — needs `dashboard.read`
- `src/routes/_authenticated/properties/$propertyId/portals/index.tsx` — needs `portal.read`
- `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx` — needs `portal.read`

**Category:** pattern-violation
**Tag:** [code-fix]

**What:** These routes are inside `_authenticated` (so the user IS logged in) but have no `can()` check in `beforeLoad`. Per `src/routes/CONTEXT.md:139-148`: "Use `can()` from `shared/domain/permissions` in `beforeLoad`."

Only 5 routes currently have `beforeLoad` permission checks: settings/organization, goals/index, goals/$goalId, goals/new, portals/new.

**Why it matters:** Without route-level guards, a Staff member can navigate directly to `/properties/$id/people` or `/properties/$id/reviews` even if the server functions would reject them. The route renders before the server function returns, potentially flashing UI that the user shouldn't see. Defense-in-depth: route guards are the first line, server function checks are the second.

**DOCS SAY:** Use `can(role, 'resource.action')` in `beforeLoad`.
**CODE DOES:** 6 protected routes have no `beforeLoad` permission check.

**Fix direction:** Add `can()` checks in `beforeLoad` for each route:

```typescript
beforeLoad: ({ context }) => {
  const role = (context as AuthRouteContext).role
  if (!can(role, '<permission>')) {
    throw redirect({ to: '/properties' })
  }
}
```

**Note:** Layout routes like `$propertyId.tsx` (which just loads property data) and `properties/index.tsx` (property list) are NOT flagged — they serve as data-loading shells, not permission boundaries. Their child routes handle specific permissions.

---

### S6-2 MAJOR: 15+ components directly import server functions — violates component dependency rules

**Files:**

- `src/components/inbox/inbox-detail-content.tsx` — imports `updateInboxStatusFn`
- `src/components/inbox/inbox-bulk-actions.tsx` — imports `bulkUpdateInboxStatusFn`
- `src/components/inbox/inbox-notes-thread.tsx` — imports `addInboxNoteFn`
- `src/components/inbox/reply-editor.tsx` — imports 5+ review server functions
- `src/components/inbox/inbox-filters.tsx` — imports `listProperties`
- `src/components/inbox/use-inbox-state.ts` — imports `getInboxItemsFn`
- `src/components/inbox/inbox-unread-badge.tsx` — imports `getUnreadCountFn`
- `src/components/inbox/use-inbox-detail.ts` — imports inbox server functions
- `src/components/features/organization/organization-settings-page.tsx` — imports org server functions
- `src/components/features/portal/link-tree/use-link-tree-mutations.ts` — imports portal-link server functions
- `src/components/features/portal/portal-delete-button.tsx` — imports `deletePortal`
- `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx` — imports dashboard analytics
- `src/components/features/property/delete-property-dialog.tsx` — imports `deleteProperty`
- `src/components/features/property/people/people-page.tsx` — imports staff assignment functions

**Category:** pattern-violation
**Tag:** [code-fix]

**What:** `src/components/CONTEXT.md:44` states: "Components must **never** import from `domain/`, `application/` (non-dto), `infrastructure/`. ... Components with 5+ server function mutations may import from `server/` to avoid excessive prop drilling. This is a deliberate trade-off — document it with a comment when used."

The exception allows components with **5+ mutations** to import from server. Only `reply-editor.tsx` (5 server fn imports) and `use-link-tree-mutations.ts` (3+) qualify. The rest import 1-2 server functions each — below the threshold. **None have the required documenting comment.**

**Why it matters:** Components importing server functions directly creates tight coupling. The route file should own the `useServerFn`/`useMutationAction` instance and pass it as a prop. This enables:

- Route-level invalidation (router knows when to refetch)
- Consistent error handling
- Testability (components can receive mock actions)

**DOCS SAY:** Components must never import from server/ (exception: 5+ mutations, documented).
**CODE DOES:** 13+ components import server functions with 1-2 mutations each, no documenting comments.

**Fix direction:** Refactor to pass server function hooks as props from route files. For the 5+ mutation exceptions (`reply-editor.tsx`, `use-link-tree-mutations.ts`), add the documenting comment as required by the exception.

---

## MINOR Findings

### S6-3 MINOR: `useMutationAction` adoption — not verified

**File:** Multiple route files
**Category:** pattern-consistency
**Tag:** [code-fix] (audit needed)

**What:** `src/routes/CONTEXT.md:101` says mutations should use `useMutationAction` (combines `useServerFn` + router invalidation + toast). This was not exhaustively verified — the grep was focused on `can()` and `useQuery`.

**Why it matters:** Raw `useServerFn` calls don't invalidate the router cache, potentially showing stale data after mutations.

**Fix direction:** Audit all route files for `useServerFn` vs `useMutationAction` usage. Convert raw `useServerFn` calls to `useMutationAction` where mutations occur.

---

## Verified Compliant

1. **Zero `useQuery` in route files** — All data fetching via route loaders. Excellent compliance.
2. **Route loaders used for data** — Components read via `Route.useLoaderData()`.
3. **Public routes correctly outside `_authenticated`** — Login, register, password reset, guest portal, webhooks.
4. **Webhook routes follow exception rules** — Direct DB access, no server fn wrapping.
5. **Parent layout routes load data** — `$propertyId.tsx`, `settings.tsx` load shared data.
6. **`_authenticated.tsx` beforeLoad** — Proper session check, redirects to `/login`.
