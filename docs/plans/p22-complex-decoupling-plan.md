# P2.2 — Remaining Component Decoupling Plan

**Date:** 2026-05-29
**Context:** 4 complex components still import server functions directly. Each needs decoupling per `src/components/CONTEXT.md`.

---

## Component 1: `portal-analytics-tab.tsx`

**Current state:**
- Imports: `getPortalAnalyticsFn` + `PortalAnalyticsData` type from `#/contexts/dashboard/server/portal-analytics`
- Used in: `portal-detail-page.tsx` which is rendered by route `properties/$propertyId/portals/$portalId.tsx`
- Pattern: Data-fetching component — calls `useServerFn(getPortalAnalyticsFn)` on mount
- ~170 lines, already tagged REVIEW(S6-2)

**Fix approach:**
1. Route `portals/$portalId.tsx` already has a loader that fetches portal data. Add `getPortalAnalyticsFn` there (not in loader — it's lazy-loaded on tab switch per the existing pattern).
2. Pass `getPortalAnalyticsFn` as prop through `PortalDetailPage` → `PortalAnalyticsTab`
3. Remove direct server fn import from `PortalAnalyticsTab`

**Files to touch:**
- `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx` — remove server fn import, add prop
- `src/components/features/portal/portal-detail/portal-detail-page.tsx` — accept prop, pass through
- `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx` — import server fn, pass as prop

**Verification:** TypeScript compiles. Portal detail page still renders analytics tab.

---

## Component 2: `organization-settings-page.tsx`

**Current state:**
- Imports: `updateOrganizationFn`, `removeMemberFn`, `updateMemberRoleFn` (3+ server fns) from `#/contexts/identity/server/organizations`
- Used in: route `settings/organization.tsx`
- Pattern: Multiple mutations. This page directly calls org management server fns.

**Fix approach:**
1. Route `settings/organization.tsx` imports all 3 server fns, wraps with `useMutationAction`, passes as props
2. `OrganizationSettingsPage` receives them as props, removes direct imports
3. Each server fn passed as a named prop: `updateOrganizationAction`, `removeMemberAction`, `updateMemberRoleAction`

**Files to touch:**
- `src/components/features/organization/organization-settings-page.tsx` — remove server fn imports, add props
- `src/routes/_authenticated/settings/organization.tsx` — import server fns, pass as props via `useMutationAction`

**Verification:** TypeScript compiles. Organization settings page renders and mutations work.

---

## Component 3+4: `inbox-detail-content.tsx` + `inbox-bulk-actions.tsx`

**Current state:**
- `inbox-detail-content.tsx` imports `updateInboxStatusFn` (1 mutation)
- `inbox-bulk-actions.tsx` imports `bulkUpdateInboxStatusFn` (1 mutation)
- Both are 3 levels deep: route `inbox/index.tsx` → `InboxPage` → `InboxDetailContent` / `InboxBulkActions`
- Both already tagged REVIEW(S6-2)

**Chain:**
```
inbox/index.tsx → InboxPage → [InboxDetailContent, InboxBulkActions]
```

**Fix approach:**
1. Route `inbox/index.tsx` imports `updateInboxStatusFn` and `bulkUpdateInboxStatusFn`
2. Each wraps with `useMutationAction` (or passes raw fn — component calls `useMutationAction` internally for per-instance state)
3. `InboxPage` accepts `updateStatusAction` and `bulkUpdateAction` props, passes through
4. `InboxDetailContent` receives `updateStatusAction` as prop, removes direct import
5. `InboxBulkActions` receives `bulkUpdateAction` as prop, removes direct import

**Files to touch:**
- `src/routes/_authenticated/inbox/index.tsx` — import server fns, pass as props
- `src/components/inbox/inbox-page.tsx` — accept props, pass through
- `src/components/inbox/inbox-detail-content.tsx` — remove server fn import, add prop
- `src/components/inbox/inbox-bulk-actions.tsx` — remove server fn import, add prop

**Verification:** TypeScript compiles. Inbox page renders, status updates and bulk actions work.

---

## Execution

Components 1 and 2 are independent — can run in parallel. Component 3+4 share the inbox tree — must run together.

**Dispatch 3 subagents:**
- Agent A: portal-analytics-tab decoupling (3 files)
- Agent B: organization-settings-page decoupling (2 files)
- Agent C: inbox-detail-content + inbox-bulk-actions decoupling (4 files)
