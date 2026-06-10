# Review: Layout, Hooks, Inbox Components, and Routes

**Reviewer:** automated (LayoutHooksRoutes)
**Date:** 2026-06-10
**Scope:** `src/components/layout/`, `src/components/hooks/`, `src/components/inbox/`, `src/hooks/`, `src/routes/`
**Dimensions:** D9 (Routes, Loaders & Mutations), D10 (React Components & Hooks), D18 (UI/UX Pattern Adherence)

---

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 1      |
| MAJOR     | 5      |
| MINOR     | 7      |
| NIT       | 3      |
| **Total** | **16** |

---

## D9 — Routes, Loaders & Mutations

### [D9] BLOCKER `_authenticated.tsx` beforeLoad fetches active organization data (not auth-only)

- **File:** `src/routes/_authenticated.tsx:68-120`
- **Quote:**

```tsx
beforeLoad: async ({ location }) => {
  // ...
  try {
    const org = await getActiveOrganization()
    // ... extracts role, org fields
  }
```

- **Rule:** D9 §2 — `beforeLoad` does auth resolution only — no data fetching.
- **Fix:** Move `getActiveOrganization()` call into the `loader`. `beforeLoad` should only call `getSession()` + redirect. The role and activeOrganization can be resolved in `loader` (which already fetches `listUserOrganizations` and `listProperties`). If role is needed in child `beforeLoad` guards, consider storing a minimal `role` claim in the session itself or computing it from org data in the loader and attaching it to context after the loader runs. This is the single most impactful fix in this review.

---

### [D9] MAJOR Inbox sidebar fetches data via useEffect instead of route loader

- **File:** `src/components/layout/inbox-sidebar.tsx:101-110`
- **Quote:**

```tsx
const fetchCounts = useAction(useServerFn(getInboxFolderCountsFn))

useEffect(() => {
  fetchCounts({ data: {} })
    .then((result) => {
      const data = result as InboxFolderCounts | undefined
      if (data) setCounts(data)
    })
    .catch(() => {
      // Silently keep default counts on error
    })
}, [fetchCounts])
```

- **Rule:** D9 §1 + D10 §6 — No data fetching via useEffect; route loaders handle data fetching. CONTEXT.md exception clause applies (documented comment), but the `useEffect` with `fetchCounts` as a dependency causes re-fetches on every render cycle (since `useAction` returns a new function each call). The silent catch also swallows errors (D10 §9).
- **Fix:** Move folder count fetching into the inbox route's loader. Pass counts as a prop to `InboxSidebar`. If the self-contained exception is maintained, fix the dependency array to `[]` (run once on mount) and add error telemetry instead of silent catch.

---

### [D9] MAJOR `_authenticated.tsx` exceeds 150-line component limit

- **File:** `src/routes/_authenticated.tsx` — **186 lines**
- **Quote:** (entire file)
- **Rule:** D10 §5 — 150-line limit on component files. While routes are not component files in `components/`, CONTEXT.md §4 sets 150-line expectations. At 186 lines, the file combines auth logic, loader, and layout rendering.
- **Fix:** Extract the `AuthenticatedLayout` component into `src/components/layout/authenticated-layout.tsx` and import it. The route file should contain only the `createFileRoute` definition, `beforeLoad`, `loader`, and a one-line `component` reference.

---

### [D9] MAJOR `home.tsx` exceeds 150-line limit

- **File:** `src/routes/_authenticated/home.tsx` — **138 lines**
- **Quote:** (entire file)
- **Rule:** D10 §5 — While just under 150, the file combines route definition, loader, and component with sync logic. Combined with the `useEffect` for localStorage→URL sync, it's at the boundary.
- **Fix:** Not a violation yet at 138 lines. Monitor. The useEffect sync pattern is a legitimate use case but fragile — consider a custom hook like `useSyncSearchParam` to encapsulate it.

---

### [D9] MAJOR `google/callback.ts` API route at 163 lines

- **File:** `src/routes/api/auth/google/callback.ts` — **163 lines**
- **Quote:** (entire file)
- **Rule:** D10 §5 — 150-line limit. While API routes are somewhat exempt (they're server-only), the file mixes HMAC validation, state parsing, OAuth flow, and error classification.
- **Fix:** Extract `parseAndValidateState` and `classifyError` helpers into a separate utility file like `src/routes/api/auth/google/oauth-helpers.ts`. The main route handler should be < 50 lines.

---

### [D9] MINOR Portal list route passes raw `deletePortal` server fn instead of mutation action

- **File:** `src/routes/_authenticated/properties/$propertyId/portals/index.tsx:33`
- **Quote:**

```tsx
return (
  <PortalListPage
    portals={portals}
    propertyId={propertyId}
    propertySlug={propertySlug}
    deletePortalFn={deletePortal}
  />
)
```

- **Rule:** D9 §3 / CONTEXT.md — Mutations should use `useMutationAction` in the route file and pass the resulting `Action` to the component. `deletePortal` is a raw server function passed directly.
- **Fix:** Create a `deleteAction` with `useMutationAction(deletePortal, { ... })` in the route file and pass that instead. Follow the same pattern used by the properties index route.

---

### [D9] MINOR `reset-password.tsx` uses `authClient` directly in component instead of server function

- **File:** `src/routes/reset-password.tsx:13-25`
- **Quote:**

```tsx
const mutation = useAction(async (input: { email: string }) => {
  const result = await authClient.requestPasswordReset({
    email: input.email,
    redirectTo: `${window.location.origin}/login`,
  })
```

- **Rule:** D9 §3 — Loaders/mutations should call server functions. Using `authClient` directly in the component means the password reset runs client-side.
- **Fix:** Create a server function `requestPasswordReset` in `contexts/identity/server/` that wraps the auth-library call, then use `useMutationAction` with it. This also fixes the `window.location.origin` client-only reference.

---

### [D9] MINOR `beforeLoad` in `_authenticated.tsx` casts context without type safety

- **File:** `src/routes/_authenticated.tsx` (referenced in child routes)
- **Quote:**

```tsx
const { role } = context as AuthRouteContext
```

- **Rule:** D14 §2 — No `as` casts without guards. This pattern is repeated in 8+ child routes (`properties/index.tsx`, `people.tsx`, `goals/index.tsx`, `goals/new.tsx`, `goals/$goalId.tsx`, `portals/index.tsx`, `portals/$portalId.tsx`, `settings/organization.tsx`).
- **Fix:** TanStack Router supports typed context via route options. Either use `Route.useRouteContext()` with proper generics or add a runtime type guard function like `getAuthContext(context)` that validates the shape.

---

## D10 — React Components & Hooks

### [D10] MAJOR Duplicate theme management logic between `app-top-bar.tsx` and `theme-toggle.tsx`

- **File:** `src/components/layout/app-top-bar.tsx:22-46` and `src/components/layout/theme-toggle.tsx:1-81`
- **Quote:**

```tsx
// app-top-bar.tsx — useThemeMode hook (inline, 24 lines)
function useThemeMode() { ... }

// theme-toggle.tsx — ThemeToggle component (81 lines, duplicated logic)
```

- **Rule:** D10 §7 / CONTEXT.md §7 — DRY principle. Two independent implementations of theme state + localStorage + apply logic. `AppTopBar` has its own inline `useThemeMode` while `ThemeToggle` in the header has the same logic.
- **Fix:** Extract a shared `useThemeMode` hook to `src/components/hooks/use-theme-mode.ts`. Both `AppTopBar` and `ThemeToggle` should import from it.

---

### [D10] MINOR `app-top-bar.tsx` does not re-render on system theme changes

- **File:** `src/components/layout/app-top-bar.tsx:22-46`
- **Quote:**

```tsx
function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>('auto')
  useEffect(() => {
    const stored = window.localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark' || stored === 'auto') {
      setMode(stored)
    }
  }, [])
```

- **Rule:** D10 §6 — useEffect missing media query listener. Unlike `ThemeToggle` which listens for system theme changes, `AppTopBar`'s inline hook never updates when the system preference changes while `mode === 'auto'`.
- **Fix:** Extract shared hook (see above finding) that includes the media query listener.

---

### [D10] MINOR `inbox-sidebar.tsx` at 154 lines exceeds 150-line limit

- **File:** `src/components/layout/inbox-sidebar.tsx` — **154 lines**
- **Quote:** (entire file)
- **Rule:** D10 §5 / CONTEXT.md §4 — Max 150 lines per component file.
- **Fix:** Extract the `useInboxFolder` and `useInboxPlatform` hooks (and possibly the `InboxFolderCounts` type + `DEFAULT_COUNTS`) into a separate file like `src/components/hooks/use-inbox-sidebar.ts`.

---

### [D10] MINOR `staff-sidebar.tsx` uses `useEffect` for side effects that could be derived

- **File:** `src/components/layout/staff-sidebar.tsx:62-72`
- **Quote:**

```tsx
useEffect(() => {
  if (rawPropertyId && !properties.find((p) => p.id === rawPropertyId)) {
    setStaffPropertyId(properties[0]?.id ?? '')
  } else if (!rawPropertyId && properties.length > 0) {
    setStaffPropertyId(properties[0].id)
  }
}, [rawPropertyId, properties])
```

- **Rule:** D10 §6 — This useEffect is for syncing external state (localStorage) which is unavoidable here, but it risks infinite loops if `setStaffPropertyId` triggers a re-render that changes `rawPropertyId`.
- **Fix:** Add a ref to track whether the effect has already run for the current properties list to prevent redundant writes. Alternatively, compute the effective propertyId synchronously and only call `setStaffPropertyId` when the computed value differs.

---

### [D10] MINOR `staff-sidebar.tsx` at 138 lines — near limit with `useEffect` logic

- **File:** `src/components/layout/staff-sidebar.tsx` — **138 lines**
- **Quote:** (entire file)
- **Rule:** D10 §5 — Approaching 150-line limit. The component has both the sidebar rendering and the propertyId sync logic.
- **Fix:** Extract the property-sync `useEffect` logic into a custom hook `useStaffPropertySync(properties)` in a separate file to keep the component clean and under limit.

---

### [D10] NIT `header.tsx` passes `onSignOut` callback from root route

- **File:** `src/routes/__root.tsx:50` and `src/components/layout/header.tsx:70`
- **Quote:**

```tsx
// __root.tsx
<Header onSignOut={() => authClient.signOut()} />

// header.tsx
export function Header({ onSignOut }: Readonly<{ onSignOut: () => void }>) {
```

- **Rule:** D10 §7 — Inline arrow function creates a new reference every render. Not memoized.
- **Fix:** Extract the sign-out handler to a stable reference using `useCallback` in `__root.tsx`, or have Header call `authClient.signOut()` directly.

---

## D18 — UI/UX Pattern Adherence

### [D18] MINOR `leaderboard.tsx` and `team.tsx` are placeholder pages with no loading/empty state handling

- **File:** `src/routes/_authenticated/leaderboard.tsx:17-19` and `src/routes/_authenticated/team.tsx:15-17`
- **Quote:**

```tsx
// leaderboard.tsx
<div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
  Rankings will appear here.
</div>
```

- **Rule:** D18 §6 — Empty states handled. These use a dashed-border placeholder pattern rather than a proper empty state component with icon + action.
- **Fix:** Create a shared `EmptyState` component (or use the existing `StaffEmptyState` from staff features) for consistency across placeholder pages.

---

### [D18] NIT `app-top-bar.tsx` user avatar image lacks descriptive alt text

- **File:** `src/components/layout/app-top-bar.tsx:98`
- **Quote:**

```tsx
<img src={user.image} alt="" className="size-7 rounded-full object-cover" />
```

- **Rule:** D10 §10 / D18 — Accessibility: images with alt. Empty alt is correct for decorative images within a button that already has accessible text, but this is an avatar in a trigger button — the button lacks an `aria-label`.
- **Fix:** Add `aria-label={`User menu for ${user.name}`}` to the `DropdownMenuTrigger` button.

---

### [D18] NIT Inbox layout injects raw `<style>` tag for sidebar sizing

- **File:** `src/routes/_authenticated.tsx:179-181`
- **Quote:**

```tsx
return isInbox ? (
  <div className="h-screen overflow-hidden flex flex-col">
    <style>{`[data-slot="sidebar-wrapper"]{flex:1 1 0%;overflow:hidden}`}</style>
```

- **Rule:** D18 §3 — Layout patterns consistent. Inline `<style>` tags are fragile and bypass Tailwind's design token system.
- **Fix:** Move this style to `src/styles.css` as a proper CSS class scoped to the inbox layout, e.g. `.inbox-layout [data-slot="sidebar-wrapper"] { ... }`.

---

## Additional Observations (No Severity)

1. **Route structure is well-organized.** Authenticated routes are properly nested under `_authenticated.tsx`. Public routes (`login`, `register`, `join`, `accept-invitation`, guest portal) are correctly outside.
2. **`can()` is used consistently** for route-level authorization — no `if (user.role === '...')` found in any route.
3. **Mutation invalidation patterns are correct.** Routes that use `invalidateRoutes` target specific route IDs matching the route definitions. Routes that need full refresh use `/_authenticated`.
4. **StaleTime strategy follows CONTEXT.md guidelines:** 5 min for layout, 60s for property detail, 30s for active sub-routes.
5. **No `useQuery`/`useSuspenseQuery` found in components** — all data flows through route loaders, compliant with CONTEXT.md.
6. **No `canEdit`/`canCreate` boolean props** — components use `usePermissions()` internally. Local `canEdit` variables derived from `can()` are fine.
7. **`hasRole` in `settings-sidebar.tsx`** is used only for hierarchy (determining back-link destination), not for gating — compliant with D10 §2.
8. **Webhook route** properly documented with eslint-disable comment for its infrastructure import exception per CONTEXT.md.
