# Review #8: React Components & Hooks

**Date:** 2026-05-23
**Scope:** `src/components/`, `src/shared/hooks/`
**Files scanned:** ~155 non-UI component/hook files across features, inbox, layout, forms, hooks

---

## BLOCKER

[BLOCKER] `delete-property-dialog.tsx` imports from `server/` with only 1 mutation — no documented exception
File: src/components/features/property/delete-property-dialog.tsx:2
Quote:

```
import { deleteProperty } from '#/contexts/property/server/properties'
```

Rule: CONTEXT.md dependency rules — components may not import from `server/` unless they have 5+ mutations and document the exception with a comment
Fix: Move the `deleteProperty` server function import and `useMutationAction` call to the route file; pass the mutation as a prop to the dialog component.

[BLOCKER] `portal-delete-button.tsx` imports from `server/` with only 1 mutation — no documented exception
File: src/components/features/portal/portal-delete-button.tsx:15
Quote:

```
import { deletePortal } from '#/contexts/portal/server/portals'
```

Rule: CONTEXT.md dependency rules — components may not import from `server/` unless they have 5+ mutations and document the exception
Fix: Move the `deletePortal` server function import to the route file; pass the mutation action as a prop.

[BLOCKER] `inbox-bulk-actions.tsx` imports from `server/` with only 1 mutation — no documented exception
File: src/components/inbox/inbox-bulk-actions.tsx:4
Quote:

```
import { bulkUpdateInboxStatusFn } from '#/contexts/inbox/server/inbox'
```

Rule: CONTEXT.md dependency rules — components may not import from `server/` unless they have 5+ mutations and document the exception
Fix: Move the `bulkUpdateInboxStatusFn` server function import to the parent route or `use-inbox-state.ts`; pass the mutation as a prop.

[BLOCKER] `people-page.tsx` imports from 3 different `server/` modules with only 4 mutations — no documented exception
File: src/components/features/property/people/people-page.tsx:9-11
Quote:

```
import { listStaffAssignments, createStaffAssignment, removeStaffAssignment } from '#/contexts/staff/server/staff-assignments'
import { listTeams, createTeam, deleteTeam } from '#/contexts/team/server/teams'
import { listMembers } from '#/contexts/identity/server/organizations'
```

Rule: CONTEXT.md dependency rules — components may not import from `server/` unless they have 5+ mutations and document the exception
Fix: Move server function imports to the route file. Define `useMutationAction` wrappers in the route and pass them as props. The 4 mutations are below the 5+ threshold.

[BLOCKER] `reply-editor.tsx` calls `getReplyFn` directly inside a `useEffect` for data fetching
File: src/components/inbox/reply-editor.tsx:32
Quote:

```
getReplyFn({ data: { reviewId } })
```

Rule: CONTEXT.md anti-patterns — "Fetching route data inside components — route loaders handle data fetching" and "Calling server functions directly without useServerFn"
Fix: Either pass the reply data from the route loader via props, or wrap with `useServerFn` + `useAction` like other data-fetching hooks in the codebase.

[BLOCKER] `cookie-consent-banner.tsx` uses hardcoded color classes instead of theme tokens
File: src/components/features/guest/cookie-consent-banner.tsx:25
Quote:

```
<div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white border-t border-gray-200 shadow-lg">
```

Rule: Breaks theming — `bg-white`, `border-gray-200`, `text-gray-600` bypass the dark/light theme system. In dark mode this banner renders as a white box.
Fix: Replace `bg-white` → `bg-background`, `border-gray-200` → `border`, `text-gray-600` → `text-muted-foreground`.

---

## MAJOR

[MAJOR] `inbox-detail-content.tsx` exceeds 150-line limit (159 lines)
File: src/components/inbox/inbox-detail-content.tsx (159 lines)
Quote:

```
// File is 159 lines total
```

Rule: CONTEXT.md rule 4 — max 150 lines per file; extract sub-components into the same concept folder
Fix: Extract the review detail section (lines 38-72) and feedback detail section (lines 74-89) into separate sub-components like `review-detail-section.tsx` and `feedback-detail-section.tsx`.

[MAJOR] `inbox-filters.tsx` exceeds 150-line limit (199 lines, suppressed with eslint-disable)
File: src/components/inbox/inbox-filters.tsx:4
Quote:

```
/* eslint-disable max-lines */
```

Rule: CONTEXT.md rule 4 — max 150 lines per file; suppressing the lint rule does not exempt the file
Fix: Extract the filter data-fetching logic (lines 54-88) into a separate `use-filter-properties.ts` hook, reducing the component to under 150 lines.

[MAJOR] `feedback-form.tsx` uses hand-rolled `useState` for form state instead of TanStack Form
File: src/components/features/guest/public-portal/feedback-form.tsx:24-27
Quote:

```
const [comment, setComment] = useState('')
const [submitted, setSubmitted] = useState(false)
const [error, setError] = useState<string | null>(null)
const [isSubmitting, setIsSubmitting] = useState(false)
```

Rule: CONTEXT.md form patterns — "All forms use TanStack Form + Zod v4 + shadcn/ui. No plain useState forms."
Fix: Refactor to use TanStack Form with a Zod schema. Derive `isSubmitting` from the action's `isPending` state rather than managing it manually.

[MAJOR] `star-rating.tsx` manages `isSubmitting` manually with `useState` instead of deriving from action state
File: src/components/features/guest/public-portal/star-rating.tsx:21
Quote:

```
const [isSubmitting, setIsSubmitting] = useState(false)
```

Rule: CONTEXT.md form patterns — "useServerFn state (isPending, error, status) drives submit button and error display. Never manage isSubmitting manually."
Fix: Use `submitAction.isPending` from the `useAction` hook instead of the manual `isSubmitting` state. Remove the `try/finally` setIsSubmitting calls.

[MAJOR] `use-inbox-state.ts` swallows errors with empty catch
File: src/components/inbox/use-inbox-state.ts:48-49
Quote:

```
} catch {
  /* */
}
```

Rule: Error states swallowed — catch with no telemetry and no user-visible feedback
Fix: Either surface the error via state (e.g., `setError(...)`) and show a retry in the UI, or log to telemetry. Silent failure means users see an empty inbox with no explanation.

[MAJOR] `use-inbox-detail.ts` swallows errors without telemetry on data-fetch failure
File: src/components/inbox/use-inbox-detail.ts:68-69
Quote:

```
} catch {
  if (!abortRef.current) setError('Failed to load detail. Try again.')
```

Rule: Error states swallowed — the error is shown to the user but not sent to telemetry/logging
Fix: Add `getLogger().error(...)` or equivalent telemetry call alongside `setError` so failures are observable in production.

[MAJOR] `inbox-unread-badge.tsx` silently swallows all fetch errors with no telemetry
File: src/components/inbox/inbox-unread-badge.tsx:25-27
Quote:

```
} catch {
  // Silently fail — badge is non-critical
}
```

Rule: Error states swallowed — even non-critical components should log errors for observability
Fix: Add `getLogger().warn(...)` so repeated failures (e.g., auth issues) are detectable in production monitoring.

[MAJOR] `use-gbp-locations.ts` calls server function directly without `useServerFn` wrapper
File: src/components/features/integration/import-connected-view/use-gbp-locations.ts:31
Quote:

```
const result = await listGbpLocations({ data: { connectionId: id } })
```

Rule: CONTEXT.md anti-patterns — "Calling server functions directly without useServerFn"
Fix: Wrap with `useAction(useServerFn(listGbpLocations))` to follow the established pattern, or document why direct invocation is necessary here.

[MAJOR] `use-import-job-polling.ts` calls server function directly without `useServerFn` wrapper
File: src/components/features/integration/import-progress/use-import-job-polling.ts:42
Quote:

```
const result = await getImportStatus({ data: { importId } })
```

Rule: CONTEXT.md anti-patterns — "Calling server functions directly without useServerFn"
Fix: Wrap with `useAction(useServerFn(getImportStatus))` to follow the established pattern, or document the exception.

[MAJOR] `link-tree-category-list.tsx` has 20 props — well above the ~10 prop limit
File: src/components/features/portal/link-tree/link-tree-category-list.tsx:23-43
Quote:

```
type Props = Readonly<{
  categories: readonly LinkTreeCategory[]
  ...17 more props...
}>
```

Rule: Components > ~10 props — should decompose
Fix: Group related props into sub-objects (e.g., `editState: { editingCategory, editingLink, deletingCategoryId, deletingLinkId }`, `callbacks: { ... }`), or decompose into smaller components with fewer props.

[MAJOR] `inbox-list-panel.tsx` has 13 props — above the ~10 prop limit
File: src/components/inbox/inbox-list-panel.tsx:12-26
Quote:

```
interface InboxListPanelProps {
  filters: InboxFilterValues
  items: ReadonlyArray<InboxItem>
  ...11 more props...
}
```

Rule: Components > ~10 props — should decompose
Fix: Group selection-related props (`selectedIds`, `onToggleSelect`, `onSelectAll`, `onDeselectAll`, `onBulkDone`) into a `selectionState` object.

[MAJOR] `dashboard-page.tsx` calls `usePermissions()` conditionally — hook may not run on all paths
File: src/components/features/property/dashboard-page.tsx:56
Quote:

```
if (properties.length === 1) {
  return null
}
...
const { can } = usePermissions()
```

Rule: React Rules of Hooks — hooks must not be called conditionally. Early return at line 34-36 means `usePermissions` is skipped for the single-property case.
Fix: Move `const { can } = usePermissions()` above the early return at line 34.

[MAJOR] `cookie-consent-banner.tsx` dismiss button has no accessible label
File: src/components/features/guest/cookie-consent-banner.tsx:31
Quote:

```
<Button variant="ghost" size="sm" onClick={handleDismiss}>
  <X className="size-4" />
</Button>
```

Rule: Accessibility — icon-only button lacks `aria-label` or visible text
Fix: Add `aria-label="Dismiss cookie consent"` to the button.

---

## MINOR

[MINOR] Multiple components use `interface` instead of `type Props = Readonly<{...}>`
File: src/components/features/property/dashboard-page.tsx:17
Quote:

```
interface DashboardPageProps {
```

Rule: CONTEXT.md rule 5 — "Props typing: `type Props = Readonly<{ ... }>` for all components"
Fix: Convert to `type Props = Readonly<{ ... }>`.

[MINOR] `inbox-list-panel.tsx` uses `interface InboxListPanelProps` instead of `type Props = Readonly<{...}>`
File: src/components/inbox/inbox-list-panel.tsx:12
Quote:

```
interface InboxListPanelProps {
```

Rule: CONTEXT.md rule 5 — props typing convention
Fix: Convert to `type Props = Readonly<{ ... }>`.

[MINOR] `inbox-detail-panel.tsx` uses `interface InboxDetailPanelProps` instead of `type Props = Readonly<{...}>`
File: src/components/inbox/inbox-detail-panel.tsx:12
Quote:

```
interface InboxDetailPanelProps {
```

Rule: CONTEXT.md rule 5 — props typing convention
Fix: Convert to `type Props = Readonly<{ ... }>`.

[MINOR] `inbox-page.tsx` uses `interface InboxPageProps` instead of `type Props = Readonly<{...}>`
File: src/components/inbox/inbox-page.tsx:29
Quote:

```
interface InboxPageProps {
```

Rule: CONTEXT.md rule 5 — props typing convention
Fix: Convert to `type Props = Readonly<{ ... }>`.

[MINOR] `staff-tab.tsx` uses `interface StaffTabProps` instead of `type Props = Readonly<{...}>`
File: src/components/features/property/people/staff-tab.tsx:17
Quote:

```
interface StaffTabProps {
```

Rule: CONTEXT.md rule 5 — props typing convention
Fix: Convert to `type Props = Readonly<{ ... }>`.

[MINOR] `teams-tab.tsx` uses `interface TeamsTabProps` instead of `type Props = Readonly<{...}>`
File: src/components/features/property/people/teams-tab.tsx:30
Quote:

```
interface TeamsTabProps {
```

Rule: CONTEXT.md rule 5 — props typing convention
Fix: Convert to `type Props = Readonly<{ ... }>`.

[MINOR] `people-page.tsx` uses `interface PeoplePageProps` instead of `type Props = Readonly<{...}>`
File: src/components/features/property/people/people-page.tsx:26
Quote:

```
interface PeoplePageProps {
```

Rule: CONTEXT.md rule 5 — props typing convention
Fix: Convert to `type Props = Readonly<{ ... }>`.

[MINOR] `portal-delete-button.tsx` uses `interface PortalDeleteButtonProps` instead of `type Props = Readonly<{...}>`
File: src/components/features/portal/portal-delete-button.tsx:17
Quote:

```
interface PortalDeleteButtonProps {
```

Rule: CONTEXT.md rule 5 — props typing convention
Fix: Convert to `type Props = Readonly<{ ... }>`.

[MINOR] `property-dashboard.tsx` uses `export interface PropertyDashboardProps` instead of `type Props = Readonly<{...}>`
File: src/components/features/property/property-dashboard.tsx:14
Quote:

```
export interface PropertyDashboardProps {
```

Rule: CONTEXT.md rule 5 — props typing convention
Fix: Convert to `type Props = Readonly<{ ... }>`.

[MINOR] `property-dashboard-helpers.tsx` inline prop types not wrapped in `Readonly<{...}>`
File: src/components/features/property/property-dashboard-helpers.tsx:13
Quote:

```
export function TrendIndicator({ trend }: { trend: number | null }) {
```

Rule: CONTEXT.md rule 5 — props typing convention
Fix: Use `type Props = Readonly<{ trend: number | null }>` and destructure from `Props`.

[MINOR] `inbox-page.tsx` has inline mobile detection instead of using the existing `use-mobile` hook
File: src/components/inbox/inbox-page.tsx:66-73
Quote:

```
const [isMobile, setIsMobile] = useState(false)
useEffect(() => {
  const mql = window.matchMedia('(max-width: 767px)')
  ...
```

Rule: CONTEXT.md shared hooks table lists `use-mobile` — this duplicates its functionality
Fix: Replace with `const isMobile = useIsMobile()` from `#/components/hooks/use-mobile`.

[MINOR] Duplicated star rating rendering — `property-dashboard-helpers.tsx` `Stars` and `inbox-detail-helpers.tsx` `RatingStars`
File: src/components/features/property/property-dashboard-helpers.tsx:20, src/components/inbox/inbox-detail-helpers.tsx:73
Quote:

```
// Both render 5 stars using similar patterns with different styling
```

Rule: Duplicated logic — same concept rendered twice with minor style differences
Fix: Extract a shared `StarDisplay` component to `components/ui/` or `components/features/shared/` with configurable size and style variants.

[MINOR] `cookie-consent-banner.tsx` uses `localStorage` directly instead of checking SSR safety
File: src/components/features/guest/cookie-consent-banner.tsx:11
Quote:

```
const hasConsented = localStorage.getItem(CONSENT_KEY)
```

Rule: SSR safety — `localStorage` access should be guarded or deferred to `useEffect` (already inside `useEffect`, but worth noting for consistency)
Fix: No fix needed — the access is inside `useEffect`. Listing for awareness only.

---

## NIT

[NIT] Mixed prop type naming conventions across the codebase
Some files use named types (`InboxPageProps`, `DashboardPageProps`, `PortalDeleteButtonProps`), others use `Props`. No consistency.
Fix: Standardize on `type Props = Readonly<{...}>` as CONTEXT.md prescribes.

[NIT] Several `useEffect`-based data fetches in inbox hooks could benefit from a shared `useFetchAction` utility
`use-inbox-state.ts`, `use-inbox-detail.ts`, `inbox-unread-badge.tsx` all follow the same pattern: `useAction(useServerFn(...))` + ref + abort + useEffect.
Fix: Consider extracting a `useFetchAction(fn, params)` hook to reduce boilerplate.

---

## Summary

**Components reviewed:** ~155 non-UI files across components/ and shared/hooks/

**Top 3 with most findings:**

1. **`inbox-filters.tsx`** — 150-line violation (suppressed with eslint-disable), server import without exception comment, data fetching in useEffect, interface instead of type Props
2. **`inbox-detail-content.tsx`** — 150-line violation (159 lines), server import without exception comment
3. **`people-page.tsx`** — BLOCKER: imports from 3 server modules with only 4 mutations, no documented exception; interface instead of type Props

**Prop interfaces that smell like leaked server concerns:**

- `PeoplePageProps.assignments` typed as `Awaited<ReturnType<typeof listStaffAssignments>>['assignments']` — tightly couples the component to the server function's return shape
- `PeoplePageProps.members` typed as `Awaited<ReturnType<typeof listMembers>>['members']` — same issue
- `PeoplePageProps.teams` typed as `Awaited<ReturnType<typeof listTeams>>['teams']` — same issue
- `DetailContentProps.updateStatus` typed as `ReturnType<typeof useMutationAction<typeof updateInboxStatusFn>>` — exposes the mutation hook implementation type through props
- `InboxDetailPanelProps.detailState` typed as `ReturnType<typeof useInboxDetail>` — leaks the entire hook's return shape as a prop type

---

The component layer is generally well-structured with good separation of concerns. The most systemic issue is **undocumented `server/` imports** in components that don't meet the 5+ mutation threshold — 4 components violate this rule. The second most common issue is the **`interface` vs `type Props = Readonly<{}>` convention** violation, affecting 9+ component files. The `dashboard-page.tsx` has a hooks-ordering bug where `usePermissions()` is called after an early return. The inbox subsystem has the highest concentration of issues: line-limit violations, error swallowing without telemetry, duplicated mobile detection, and prop drilling that could benefit from shared utility hooks. No cross-context boundary leaks, no `hasRole()` misuse for UI gating, no `toDomainRole()` in components, and no raw `fetch()` calls were found.
