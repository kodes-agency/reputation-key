# Feature Components Review — D10 (Component Patterns) & D18 (UI/UX Adherence)

**Date:** 2026-06-10
**Scope:** `src/components/features/` (91 `.tsx` files)
**Reference:** `src/components/CONTEXT.md`, `REUI.md`

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 4     |
| MAJOR    | 8     |
| MINOR    | 6     |
| NIT      | 5     |

---

## BLOCKER Findings

### B1. Server import without documented exception — `portal-analytics-tab.tsx`

**[D10] [BLOCKER] Component imports server function directly for data fetching, bypassing route loader pattern**
File: src/components/features/portal/portal-analytics/portal-analytics-tab.tsx:5-6
Quote:

```
import { useServerFn } from '@tanstack/react-start'
import { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
```

Rule: CONTEXT.md Dependency Rules — Components must **never** import from `application/` (non-dto) or `server/`. Exception documented for 5+ mutation components only.
Fix: Move data fetching to the route loader; pass analytics data as a prop. The component currently uses `useEffect` + `useServerFn` to fetch data directly (lines 43-65), which violates both the dependency rule and the "no data fetching in components" anti-pattern.

### B2. Server import without documented exception — `staff-tab.tsx`

**[D10] [BLOCKER] Component imports server function directly**
File: src/components/features/property/people/staff-tab.tsx:16
Quote:

```
import { updateStaffPortals } from '#/contexts/staff/server/staff-assignments'
```

Rule: CONTEXT.md Dependency Rules — Components must **never** import from `server/`.
Fix: Pass the mutation as a prop from the parent route, consistent with the pattern used for assign/remove mutations in the same file. The `useMutationActionSilent` call (line 62) should be lifted to the route.

### B3. Server import without documented exception — `portal-list-page.tsx`

**[D10] [BLOCKER] Component imports server function directly**
File: src/components/features/portal/portal-list-page.tsx:19
Quote:

```
import { deletePortal } from '#/contexts/portal/server/portals'
```

Rule: CONTEXT.md Dependency Rules — Components must **never** import from `server/`.
Fix: The `PortalDeleteButton` already receives `deletePortalFn` as a prop, but `portal-list-page.tsx` imports `deletePortal` to type the prop as `typeof deletePortal`. Use a structural type instead and remove the server import.

### B4. useEffect for data fetching — `portal-analytics-tab.tsx`

**[D10] [BLOCKER] useEffect for data fetching that belongs in route loaders**
File: src/components/features/portal/portal-analytics/portal-analytics-tab.tsx:43-65
Quote:

```
useEffect(() => {
  let cancelled = false
  setLoading(true)
  setError(null)
  analyticsFn({ data: { propertyId, portalId, timeRange } })
    .then((result) => { ... })
  return () => { cancelled = true }
}, [propertyId, portalId, timeRange])
```

Rule: CONTEXT.md Anti-patterns — "Fetching route data inside components with `useQuery` — route loaders handle data fetching." The component manually manages `loading`, `error`, `data` state with useEffect + useServerFn instead of receiving data from a route loader.
Fix: Move analytics fetching to a route loader that revalidates on `timeRange` search param change. If loader revalidation is impractical due to tab-scoped data, at minimum extract this into a dedicated hook in `components/hooks/` rather than inline useEffect.

---

## MAJOR Findings

### M1. Props not using `type Props = Readonly<{...}>` — `property-dashboard.tsx`

**[D10] [MAJOR] Props defined as exported `interface` without `Readonly`**
File: src/components/features/property/property-dashboard.tsx:12-18
Quote:

```
export interface PropertyDashboardProps {
  property: Readonly<{ id: string; name: string }> | null | undefined
  ...
}
```

Rule: CONTEXT.md Rule 5 — `type Props = Readonly<{ ... }>` for all components.
Fix: Convert to `type PropertyDashboardProps = Readonly<{ ... }>`.

### M2. Props not using `type Props = Readonly<{...}>` — `dashboard-page.tsx`

**[D10] [MAJOR] Props defined as `interface` without `Readonly`**
File: src/components/features/property/dashboard-page.tsx:19-25
Quote:

```
interface DashboardPageProps {
  properties: ReadonlyArray<Property>
  deleteAction: Action<...>
}
```

Rule: CONTEXT.md Rule 5 — `type Props = Readonly<{ ... }>` for all components.
Fix: Convert to `type DashboardPageProps = Readonly<{ ... }>`.

### M3. Props not using `type Props = Readonly<{...}>` — `portal-list-page.tsx`

**[D10] [MAJOR] Props defined as exported `interface` without `Readonly`**
File: src/components/features/portal/portal-list-page.tsx:29-34
Quote:

```
export interface PortalListPageProps {
  portals: readonly Portal[]
  ...
}
```

Rule: CONTEXT.md Rule 5 — `type Props = Readonly<{ ... }>` for all components.
Fix: Convert to `type PortalListPageProps = Readonly<{ ... }>`.

### M4. Props not using `type Props = Readonly<{...}>` — `directory-tab.tsx`

**[D10] [MAJOR] Props defined as `interface` without `Readonly`**
File: src/components/features/property/people/directory-tab.tsx:12-19
Quote:

```
interface DirectoryTabProps {
  members: ReadonlyArray<{...}>
}
```

Rule: CONTEXT.md Rule 5 — `type Props = Readonly<{ ... }>` for all components.
Fix: Convert to `type DirectoryTabProps = Readonly<{ ... }>`.

### M5. Props not using `type Props = Readonly<{...}>` — `staff-tab.tsx`, `teams-tab.tsx`

**[D10] [MAJOR] Props defined as `interface` without `Readonly`**
File: src/components/features/property/people/staff-tab.tsx:23-38
File: src/components/features/property/people/teams-tab.tsx:30-39
Rule: CONTEXT.md Rule 5.
Fix: Convert both to `type Props = Readonly<{ ... }>`.

### M6. Swallowed error — `portal-share.tsx`

**[D10] [MAJOR] Clipboard write error silently swallowed**
File: src/components/features/portal/portal-share/portal-share.tsx:25-27
Quote:

```
} catch {
  // fallback
}
```

Rule: REUI.md — Error states not swallowed.
Fix: Either display an error message to the user (e.g., toast or inline text) or log via `getLogger`.

### M7. Swallowed error — `qr-code-modal.tsx`

**[D10] [MAJOR] Clipboard write error silently swallowed**
File: src/components/features/portal/portal-share/qr-code-modal.tsx:55-63
Quote:

```
} catch {
  // Failed to copy
}
```

Rule: REUI.md — Error states not swallowed.
Fix: Show user-visible feedback when copy fails (the `copied` state stays `false`, but there's no error message).

### M8. `portal-analytics-tab.tsx` exceeds 150-line limit

**[D10] [MAJOR] File exceeds 150-line limit (167 lines)**
File: src/components/features/portal/portal-analytics/portal-analytics-tab.tsx
Rule: CONTEXT.md Rule 4 — Max 150 lines per file.
Fix: Extract the inline `TimeRangePicker` sub-component (lines 147-167) and the loading/error states into separate files.

---

## MINOR Findings

### m1. `property-dashboard.tsx` exceeds 150-line limit (158 lines)

**[D10] [MINOR] File at 158 lines, marginally exceeds 150-line limit**
File: src/components/features/property/property-dashboard.tsx
Rule: CONTEXT.md Rule 4 — Max 150 lines per file.
Fix: Extract the review list section or engagement funnel section into a sub-component.

### m2. `portal-detail-page.tsx` exceeds 150-line limit (165 lines)

**[D10] [MINOR] File at 165 lines, exceeds 150-line limit**
File: src/components/features/portal/portal-detail/portal-detail-page.tsx
Rule: CONTEXT.md Rule 4 — Max 150 lines per file.
Fix: Extract the header + tab bar section into a sub-component.

### m3. `portal-analytics-charts.tsx` exceeds 150-line limit (155 lines)

**[D10] [MINOR] File at 155 lines, marginally exceeds 150-line limit**
File: src/components/features/portal/portal-analytics/portal-analytics-charts.tsx
Rule: CONTEXT.md Rule 4 — Max 150 lines per file.
Fix: Extract one of the chart components into a separate file.

### m4. Inline `onToggle*` handlers recreated every render

**[D18] [MINOR] Inline closures in list `.map()` create new function references per render**
File: src/components/features/portal/link-tree/sortable-category.tsx:87
File: src/components/features/portal/link-tree/link-tree-category-list.tsx:108,121
File: src/components/features/team/team-members/member-table.tsx:40
Quote (example):

```
onRemove={() => onRemove(a.id)}
```

Rule: REUI.md — Event handlers stable (not recreated every render).
Fix: Low severity since these are not passed to expensive children, but for consistency, consider extracting a memoized callback wrapper.

### m5. Non-shadcn native checkbox used in `smart-routing-config.tsx`

**[D18] [MINOR] Native `<input type="checkbox">` instead of shadcn Switch component**
File: src/components/features/portal/portal-settings/smart-routing-config.tsx:27-33
Quote:

```
<input type="checkbox" ... className="size-5 cursor-pointer rounded border" />
```

Rule: REUI.md — Use design system components consistently. The same file uses a native `<input type="range">` (line 65). Other settings components use shadcn `Switch`.
Fix: Replace with shadcn `Switch` component for consistency with the rest of the settings UI.

### m6. Non-shadcn native range input in `smart-routing-config.tsx`

**[D18] [MINOR] Native `<input type="range">` without consistent styling**
File: src/components/features/portal/portal-settings/smart-routing-config.tsx:65-72
Quote:

```
<input type="range" min={1} max={4} ... className="w-full" />
```

Rule: REUI.md — Use design system components.
Fix: Style the range input consistently or use a shadcn `Slider` component.

---

## NIT Findings

### n1. `cookie-consent-banner.tsx` uses inline Tailwind for fixed positioning

**[D18] [NIT] Hardcoded `bg-white` instead of theme-aware `bg-background`**
File: src/components/features/guest/cookie-consent-banner.tsx:25
Quote:

```
<div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white border-t border-gray-200 shadow-lg">
```

Rule: REUI.md — Use design token classes.
Fix: Replace `bg-white` with `bg-background`, `border-gray-200` with `border-border`, `text-gray-600` with `text-muted-foreground`.

### n2. `star-rating.tsx` uses hardcoded color classes

**[D18] [NIT] Hardcoded `text-gray-300`, `text-red-500`, `text-gray-500` instead of theme tokens**
File: src/components/features/guest/public-portal/star-rating.tsx:54,65,87,94
Quote:

```
className={`size-8 ${... 'text-gray-300' ...}`}
{error && <p className="text-center text-red-500 text-sm">{error}</p>}
```

Rule: REUI.md — Use design token classes.
Fix: Replace `text-gray-300` → `text-muted-foreground/30`, `text-red-500` → `text-destructive`, `text-gray-500` → `text-muted-foreground`.

### n3. `portal-settings-page.tsx` — Props interface exported but could be type

**[D10] [NIT] Uses `interface` instead of `type` for props (not `Readonly`-wrapped)**
File: src/components/features/organization/organization-settings-page.tsx:22-33
Rule: CONTEXT.md Rule 5.
Fix: Convert to `type Props = Readonly<{...}>`.

### n4. `organization-switch-list.tsx` — Promise rejection silently caught

**[D10] [NIT] `.catch(() => {})` swallows switch-org errors**
File: src/components/features/organization/organization-switch-list.tsx:37
Quote:

```
onSwitch(org.id).catch(() => {})
```

Rule: REUI.md — Error states not swallowed.
Fix: Propagate error to parent or show a toast notification.

### n5. `notification-panel.tsx` at exactly 150 lines

**[D10] [NIT] File at exactly 150 lines — borderline**
File: src/components/features/notification/notification-panel.tsx
Rule: CONTEXT.md Rule 4.
Fix: No action needed, but any addition will violate the limit. The `NotificationRow` sub-component (lines 25-67) could be extracted proactively.

---

## Positive Observations

1. **No boolean permission props** — All components correctly use `usePermissions()` with `can()` for gating. No `canEdit`/`canCreate`/`canDelete` boolean props found.
2. **No `hasRole()` usage** — Not found anywhere in feature components.
3. **No raw `fetch()`** — No direct fetch calls in any feature component.
4. **No `useQuery` for data fetching** — Route loaders handle data; no `useQuery` usage found.
5. **Named exports only** — All files use named exports; no default exports.
6. **Kebab-case filenames** — All files follow kebab-case naming.
7. **Form patterns** — All forms correctly use TanStack Form + Zod schemas derived from DTOs.
8. **Server function props** — Most components correctly receive mutation actions as props.
9. **Documented exceptions** — `people-page.tsx` and `organization-settings-page.tsx` properly document their server import exceptions with comments.
10. **Accessibility** — `ProgressBar` has proper ARIA (`role="progressbar"`, `aria-valuenow`, `aria-label`). `ImportStatusBadge` uses `role="status"` and `aria-live="polite"`. `ConnectGoogleButton` uses `aria-busy`. `StarRating` uses `fieldset` + `aria-label` + `sr-only` radio inputs.
