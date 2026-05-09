# Frontend Architecture Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all frontend architecture violations found in the comprehensive audit so that the codebase consistently follows the conventions in `src/components/CONTEXT.md` and `src/routes/CONTEXT.md`.

**Architecture:** The project uses a layered hexagonal architecture with TanStack Start. Components live in `src/components/features/` organized by domain, routes in `src/routes/` with file-based routing. Key rules: components never import from `domain/` or `application/` (except DTOs), routes never import from `application/`, files max 150 lines, props typed as `type Props = Readonly<{...}>`, server functions passed as props from routes.

**Tech Stack:** TanStack Start, TanStack Router, TanStack Query, TanStack Form, Zod v4, shadcn/ui, React 19

---

## Validation Notes

The following findings were validated before writing this plan:

- **C1 (`application/dto` import):** Confirmed. `$portalSlug.tsx` imports `type PublicPortalLoaderData` for its loader return type. The current rules say routes must never import from `application/`, but a `type`-only import for loader typing is a legitimate need that the rules should accommodate. The fix is to re-export the type from the server function module.
- **H1-H3 (server imports without 5+ mutations):** Confirmed. `connect-google-button.tsx` (1 mutation), `organization-switch-list.tsx` (1 mutation), `profile-settings-form.tsx` (2 mutations + authClient). All three should receive the serverFn from the parent route as a prop.
- **H4-H5 (useQuery in import routes):** Confirmed. `import/index.tsx` should use a loader. `import/$importId.tsx` uses `refetchInterval` for polling — polling cannot be done in a loader, so this stays as `useQuery` but the initial load should still come from a loader.
- **H6 (link-tree 314 lines):** Confirmed. This is the most egregious 150-line violation.
- **Integration props typing:** Confirmed. All 8 integration component files use `interface` instead of `type Props = Readonly<{}>`.
- **M9-M10 (missing staleTime):** Confirmed. Both routes have loaders without `staleTime`.

---

## File Map

### Files to modify

| File                                                                                      | Change                                                                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/contexts/guest/server/public.ts`                                                     | Re-export `PublicPortalLoaderData` type                                                      |
| `src/routes/p/$propertySlug/$portalSlug.tsx`                                              | Change import source for the type                                                            |
| `src/components/features/integration/connect-google-button/connect-google-button.tsx`     | Accept serverFn as prop, remove direct server import, fix props typing, remove console.error |
| `src/components/features/organization/organization-switch-list.tsx`                       | Accept serverFn as prop, remove direct server import                                         |
| `src/components/features/identity/profile-settings-form.tsx`                              | Accept serverFns as props, remove direct server imports                                      |
| `src/routes/_authenticated/settings/organization.tsx`                                     | Pass serverFn props to ProfileSettingsForm and OrgSwitchList                                 |
| `src/routes/_authenticated/properties/import/index.tsx`                                   | Convert useQuery to route loader                                                             |
| `src/routes/_authenticated/properties/import/$importId.tsx`                               | Add loader for initial data, keep useQuery for polling only                                  |
| `src/components/features/integration/google-account-selector/google-account-selector.tsx` | Fix props typing                                                                             |
| `src/components/features/integration/location-picker/location-picker.tsx`                 | Fix props typing                                                                             |
| `src/components/features/integration/location-picker/location-row.tsx`                    | Fix props typing                                                                             |
| `src/components/features/integration/import-progress/import-progress.tsx`                 | Fix props typing                                                                             |
| `src/components/features/integration/import-progress/import-status-badge.tsx`             | Fix props typing                                                                             |
| `src/components/features/integration/import-connected-view/import-connected-view.tsx`     | Fix props typing, add server-import exception comment                                        |
| `src/components/features/guest/public-portal/feedback-form.tsx`                           | Fix props typing                                                                             |
| `src/components/features/guest/public-portal/star-rating.tsx`                             | Fix props typing                                                                             |
| `src/components/features/portal/link-tree/link-tree.tsx`                                  | Add server-import exception comment                                                          |
| `src/routes/accept-invitation.tsx`                                                        | Add staleTime to loader                                                                      |
| `src/routes/p/$propertySlug/$portalSlug.tsx`                                              | Add staleTime to loader                                                                      |

### CONTEXT.md updates

| File                    | Change                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `src/routes/CONTEXT.md` | Clarify that `type`-only imports from `application/dto` are acceptable for loader return types |

---

## Task 1: Move PublicPortalLoaderData type to server module (C1)

**Files:**

- Modify: `src/contexts/guest/server/public.ts`
- Modify: `src/routes/p/$propertySlug/$portalSlug.tsx`

The route imports a type from `application/dto`. The cleanest fix is to re-export the type from the server module — routes are already allowed to import from `server/`.

- [ ] **Step 1: Add re-export in the server module**

In `src/contexts/guest/server/public.ts`, add at the top (after existing imports):

```typescript
export type { PublicPortalLoaderData } from '../application/dto/public-portal.dto'
```

- [ ] **Step 2: Update the route import**

In `src/routes/p/$propertySlug/$portalSlug.tsx`, change line 11 from:

```typescript
import type { PublicPortalLoaderData } from '#/contexts/guest/application/dto/public-portal.dto'
```

to:

```typescript
import type { PublicPortalLoaderData } from '#/contexts/guest/server/public'
```

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`
Expected: Clean, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/contexts/guest/server/public.ts src/routes/p/$propertySlug/\$portalSlug.tsx
git commit -m "fix(routes): move PublicPortalLoaderData import from application/dto to server"
```

---

## Task 2: Fix ConnectGoogleButton — remove server import (H2)

**Files:**

- Modify: `src/components/features/integration/connect-google-button/connect-google-button.tsx`
- Modify: `src/routes/_authenticated/properties/import/index.tsx`
- Modify: `src/routes/_authenticated/settings/organization.tsx` (if ConnectGoogleButton is used there — check first)

This component has 1 mutation and imports from `server/`. Fix: accept the serverFn as a prop. Also fix props typing and remove `console.error`.

- [ ] **Step 1: Grep for all usages of ConnectGoogleButton**

Run: `grep -rn 'ConnectGoogleButton' src/ --include='*.tsx' --include='*.ts'`

Record all files that import it — these need to pass the new prop.

- [ ] **Step 2: Rewrite connect-google-button.tsx**

Replace the full file content with:

```typescript
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'

type Props = Readonly<{
  visibility?: 'private' | 'organization'
  getAuthUrl: (data: { visibility: string }) => Promise<{ url: string }>
}>

export function ConnectGoogleButton({
  visibility = 'private',
  getAuthUrl,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  const handleClick = async () => {
    try {
      setError(null)
      setIsConnecting(true)
      const result = await getAuthUrl({ visibility })
      window.location.href = result.url
    } catch {
      setError('Failed to connect Google account. Please try again.')
      setIsConnecting(false)
    }
  }

  return (
    <div>
      <Button onClick={handleClick} disabled={isConnecting} aria-busy={isConnecting}>
        {isConnecting && (
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
        )}
        Connect Google Account
      </Button>
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
```

Changes: removed `useServerFn`, removed `server/` import, accepted `getAuthUrl` as prop, changed `interface` to `type Props = Readonly<{}>`, changed `catch (err)` with `console.error` to bare `catch` (error is displayed to user, no need to log).

- [ ] **Step 3: Update all parent routes to pass getAuthUrl prop**

In each file that uses `ConnectGoogleButton`, add `useServerFn(getGoogleAuthUrl)` and pass it:

```typescript
import { useServerFn } from '@tanstack/react-start'
import { getGoogleAuthUrl } from '#/contexts/integration/server/google-connections'

// Inside the component:
const getAuthUrl = useServerFn(getGoogleAuthUrl)

// In JSX:
<ConnectGoogleButton getAuthUrl={getAuthUrl} />
```

- [ ] **Step 4: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/features/integration/connect-google-button/ src/routes/
git commit -m "fix(components): ConnectGoogleButton accepts serverFn as prop, fixes props typing, removes console.error"
```

---

## Task 3: Fix OrganizationSwitchList — remove server import (H1)

**Files:**

- Modify: `src/components/features/organization/organization-switch-list.tsx`
- Modify: all route files that render `OrganizationSwitchList`

This component has 1 mutation and imports from `server/`.

- [ ] **Step 1: Grep for all usages of OrganizationSwitchList**

Run: `grep -rn 'OrganizationSwitchList' src/ --include='*.tsx' --include='*.ts'`

- [ ] **Step 2: Rewrite organization-switch-list.tsx**

Replace with:

```typescript
import { useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'

type Org = Readonly<{ id: string; name: string }>

type Props = Readonly<{
  organizations: ReadonlyArray<Org>
  activeOrganizationId: string | null
  switchOrg: (data: { data: { organizationId: string } }) => Promise<unknown>
}>

export function OrganizationSwitchList({ organizations, activeOrganizationId, switchOrg }: Props) {
  const navigate = useNavigate()

  if (organizations.length <= 1) return null

  return (
    <div className="rounded-lg border">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-medium">Organizations</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Switch to a different organization.
        </p>
      </div>
      <div className="divide-y">
        {organizations.map((org) => {
          const isActive = org.id === activeOrganizationId
          return (
            <button
              key={org.id}
              type="button"
              disabled={isActive || 'isPending' in switchOrg && (switchOrg as { isPending: boolean }).isPending}
              onClick={() => {
                switchOrg({ data: { organizationId: org.id } })
                  .then(() => navigate({ to: '/properties' }))
                  .catch(() => {})
              }}
              className={
                'flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-accent' +
                (isActive ? ' bg-accent/50' : '')
              }
            >
              <span className={isActive ? 'font-medium' : ''}>{org.name}</span>
              {isActive && <Check className="size-4 text-accent-foreground" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

Note: the `switchOrg` prop accepts the shape returned by `useAction(useServerFn(...))`. The parent route passes the full action object. Alternatively, simplify by accepting `onSwitch: (orgId: string) => Promise<unknown>` and let the parent handle the mutation.

**Simpler approach:** Use a callback prop instead:

```typescript
type Props = Readonly<{
  organizations: ReadonlyArray<Org>
  activeOrganizationId: string | null
  onSwitch: (orgId: string) => Promise<void>
  isPending?: boolean
}>
```

Then in the parent route:

```typescript
const switchAction = useAction(useServerFn(setActiveOrganization))
// ...
<OrganizationSwitchList
  organizations={orgs}
  activeOrganizationId={activeOrgId}
  onSwitch={(orgId) => switchAction({ data: { organizationId: orgId } }).then(() => navigate({ to: '/properties' }))}
  isPending={switchAction.isPending}
/>
```

- [ ] **Step 3: Update parent routes**

Find all files that render `<OrganizationSwitchList>` and add the `useAction`/`useServerFn` + pass `onSwitch` and `isPending` props.

- [ ] **Step 4: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/features/organization/ src/routes/
git commit -m "fix(components): OrganizationSwitchList accepts callback prop, removes server import"
```

---

## Task 4: Fix ProfileSettingsForm — remove server imports (H3)

**Files:**

- Modify: `src/components/features/identity/profile-settings-form.tsx`
- Modify: route(s) that render `ProfileSettingsForm`

This component imports 2 server functions (`requestAvatarUpload`, `finalizeAvatarUpload`) and also uses `authClient.updateUser` directly. It has 3 mutations total.

- [ ] **Step 1: Grep for all usages of ProfileSettingsForm**

Run: `grep -rn 'ProfileSettingsForm' src/ --include='*.tsx' --include='*.ts'`

- [ ] **Step 2: Rewrite profile-settings-form.tsx**

Remove `server/` imports. Accept the server functions as props:

Change the Props type to:

```typescript
export type Props = Readonly<{
  user: {
    name: string
    email: string
    image: string | null
  }
  requestAvatarUpload: (data: {
    data: { contentType: string; fileSize: number }
  }) => Promise<{ uploadUrl: string; key: string }>
  finalizeAvatarUpload: (data: {
    data: { key: string }
  }) => Promise<{ avatarUrl: string }>
}>
```

Remove these imports from the file:

```typescript
import { useServerFn } from '@tanstack/react-start'
import {
  requestAvatarUpload,
  finalizeAvatarUpload,
} from '#/contexts/identity/server/organizations'
```

Replace `useServerFn` calls with the props:

```typescript
// Remove:
const requestUpload = useServerFn(requestAvatarUpload)
const finalizeUpload = useServerFn(finalizeAvatarUpload)

// The props already have the right shape — use them directly in handleAvatarUpload
```

Update `handleAvatarUpload` to use `props.requestAvatarUpload` and `props.finalizeAvatarUpload`.

- [ ] **Step 3: Update parent route(s)**

In the route(s) that render `<ProfileSettingsForm>`, add:

```typescript
import { useServerFn } from '@tanstack/react-start'
import { requestAvatarUpload, finalizeAvatarUpload } from '#/contexts/identity/server/organizations'

// Inside component:
const requestUpload = useServerFn(requestAvatarUpload)
const finalizeUpload = useServerFn(finalizeAvatarUpload)

// In JSX:
<ProfileSettingsForm
  user={user}
  requestAvatarUpload={requestUpload}
  finalizeAvatarUpload={finalizeUpload}
/>
```

- [ ] **Step 4: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/features/identity/profile-settings-form.tsx src/routes/
git commit -m "fix(components): ProfileSettingsForm accepts serverFns as props, removes server import"
```

---

## Task 5: Convert import/index.tsx useQuery to route loader (H4)

**Files:**

- Modify: `src/routes/_authenticated/properties/import/index.tsx`

The connections list is static data that should come from a route loader, not useQuery.

- [ ] **Step 1: Rewrite the route with a loader**

Change `src/routes/_authenticated/properties/import/index.tsx`:

```typescript
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { listGoogleConnections } from '#/contexts/integration/server/google-connections'
import {
  ConnectGoogleButton,
  ImportConnectedView,
} from '#/components/features/integration'
import { Loader2 } from 'lucide-react'
import { ImportPageHeader } from './-import-page-header'

export const Route = createFileRoute('/_authenticated/properties/import/')({
  staleTime: 60_000,
  loader: async () => {
    const result = await listGoogleConnections()
    return { connections: result.connections }
  },
  component: ImportPage,
})

function ImportPage() {
  const search = useSearch({ strict: false }) as { connectionId?: string; error?: string }
  const { connections } = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ImportPageHeader showSubtitle />

      {search.error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">
            {search.error === 'denied'
              ? 'Google authorization was cancelled.'
              : search.error === 'connection_failed'
                ? 'Failed to connect Google account. Please try again.'
                : 'An error occurred during Google authorization.'}
          </p>
        </div>
      )}

      {connections.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border py-12">
          <p className="text-muted-foreground">No Google accounts connected yet.</p>
          <ConnectGoogleButton getAuthUrl={/* passed from Task 2 */} />
        </div>
      ) : (
        <ImportConnectedView
          connections={connections}
          initialConnectionId={search.connectionId}
        />
      )}
    </div>
  )
}
```

Key changes: removed `useQuery`, `useServerFn`, `@ts-expect-error` comment. Added `loader` with `staleTime: 60_000`. Data read via `Route.useLoaderData()`. Removed loading state (loader handles it).

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/properties/import/index.tsx
git commit -m "fix(routes): convert import page connections from useQuery to route loader"
```

---

## Task 6: Add loader to import/$importId.tsx for initial data (H5)

**Files:**

- Modify: `src/routes/_authenticated/properties/import/$importId.tsx`

This route polls import status with `refetchInterval`. Polling requires `useQuery`. But the initial load should come from a route loader for SSR. The pattern: loader fetches initial data, useQuery starts with that data and continues polling.

- [ ] **Step 1: Add loader, keep useQuery for polling only**

```typescript
import { createFileRoute, Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useQuery } from '@tanstack/react-query'
import { getImportStatus } from '#/contexts/integration/server/gbp-import'
import { ImportProgress } from '#/components/features/integration'
import { ImportPageHeader } from './-import-page-header'

export const Route = createFileRoute('/_authenticated/properties/import/$importId')({
  staleTime: 0,
  loader: async ({ params: { importId } }) => {
    const result = await getImportStatus({ data: { importId } })
    return { job: result.job }
  },
  component: ImportProgressPage,
})

function ImportProgressPage() {
  const { importId } = Route.useParams()
  const initialData = Route.useLoaderData()
  const getStatus = useServerFn(getImportStatus)

  const { data: statusData } = useQuery({
    queryKey: ['import-status', importId],
    queryFn: async () => {
      const result = await getStatus({ data: { importId } })
      return result.job
    },
    initialData: initialData.job,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'completed' ||
        status === 'failed' ||
        status === 'completed_with_skips' ||
        status === 'completed_with_failures'
        ? false
        : 2000
    },
    staleTime: 0,
  })

  if (!statusData) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <p className="text-destructive">Import job not found or failed to load.</p>
          <Link to="/properties/import" className="text-sm text-primary hover:underline">
            Back to import
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ImportPageHeader />
      <ImportProgress job={statusData} />
    </div>
  )
}
```

Key changes: added `loader` for SSR initial data, `useQuery` uses `initialData` from loader, removed `isLoading`/`isError` states (loader handles initial load), removed `@ts-expect-error` comments.

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/properties/import/\$importId.tsx
git commit -m "fix(routes): add loader for import status initial data, keep useQuery for polling only"
```

---

## Task 7: Add missing staleTime to routes (M9, M10)

**Files:**

- Modify: `src/routes/accept-invitation.tsx`
- Modify: `src/routes/p/$propertySlug/$portalSlug.tsx`

- [ ] **Step 1: Add staleTime to accept-invitation.tsx**

In the route definition, add `staleTime: 30_000`:

```typescript
export const Route = createFileRoute('/accept-invitation')({
  staleTime: 30_000,
  loader: async () => {
    // ... existing loader code
  },
  // ...
})
```

- [ ] **Step 2: Add staleTime to $portalSlug.tsx**

In the route definition, add `staleTime: 5 * 60 * 1000`:

```typescript
export const Route = createFileRoute('/p/$propertySlug/$portalSlug')({
  // ... existing validateSearch
  staleTime: 5 * 60 * 1000,
  loader: async ({ params }): Promise<PublicPortalLoaderData | null> => {
    // ... existing loader code
  },
  // ...
})
```

- [ ] **Step 3: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/routes/accept-invitation.tsx src/routes/p/\$propertySlug/\$portalSlug.tsx
git commit -m "fix(routes): add staleTime to accept-invitation and public portal loaders"
```

---

## Task 8: Fix integration component props typing (LOW, batch)

**Files:**

- Modify: `src/components/features/integration/connect-google-button/connect-google-button.tsx` (already fixed in Task 2)
- Modify: `src/components/features/integration/google-account-selector/google-account-selector.tsx`
- Modify: `src/components/features/integration/location-picker/location-picker.tsx`
- Modify: `src/components/features/integration/location-picker/location-row.tsx`
- Modify: `src/components/features/integration/import-progress/import-progress.tsx`
- Modify: `src/components/features/integration/import-progress/import-status-badge.tsx`
- Modify: `src/components/features/integration/import-connected-view/import-connected-view.tsx`
- Modify: `src/components/features/guest/public-portal/feedback-form.tsx`
- Modify: `src/components/features/guest/public-portal/star-rating.tsx`

For each file, change `interface XxxProps` to `type Props = Readonly<{...}>`. The component function parameter type changes from `XxxProps` to `Props`.

- [ ] **Step 1: Fix google-account-selector.tsx**

Change:

```typescript
interface GoogleAccountSelectorProps {
```

To:

```typescript
type Props = Readonly<{
```

And update the component signature accordingly.

- [ ] **Step 2: Fix location-picker.tsx**

Same pattern: `interface LocationPickerProps` → `type Props = Readonly<{...}>`.

- [ ] **Step 3: Fix location-row.tsx**

Same pattern: `interface LocationRowProps` → `type Props = Readonly<{...}>`.

- [ ] **Step 4: Fix import-progress.tsx**

Same pattern: `interface ImportProgressProps` → `type Props = Readonly<{...}>`.

- [ ] **Step 5: Fix import-status-badge.tsx**

Same pattern: `interface ImportStatusBadgeProps` → `type Props = Readonly<{...}>`.

- [ ] **Step 6: Fix import-connected-view.tsx**

This file already uses `type Props = Readonly<{...}>` — verify and skip if correct.

- [ ] **Step 7: Fix feedback-form.tsx**

Same pattern: `interface FeedbackFormProps` → `type Props = Readonly<{...}>`.

- [ ] **Step 8: Fix star-rating.tsx**

Same pattern: `interface StarRatingProps` → `type Props = Readonly<{...}>`.

- [ ] **Step 9: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 10: Commit**

```bash
git add src/components/features/integration/ src/components/features/guest/
git commit -m "fix(components): standardize props typing to type Props = Readonly across integration and guest"
```

---

## Task 9: Add server-import exception comments (M1, M2, M3)

**Files:**

- Modify: `src/components/features/organization/organization-settings-page.tsx`
- Modify: `src/components/features/portal/link-tree/link-tree.tsx`
- Modify: `src/components/features/integration/import-connected-view/import-connected-view.tsx`

These components have 5+ mutations and are allowed to import from `server/`, but must document the exception with a comment.

- [ ] **Step 1: Add comment to organization-settings-page.tsx**

At the top of the file, add:

```typescript
// Server import exception: 5+ mutations (updateOrg, deleteOrg, inviteMember, removeMember, updateMemberRole)
```

- [ ] **Step 2: Add comment to link-tree.tsx**

At the top of the file, add:

```typescript
// Server import exception: 8+ mutations (CRUD categories + CRUD links + reorder categories + reorder links)
```

- [ ] **Step 3: Add comment to import-connected-view.tsx**

At the top of the file, add:

```typescript
// Server import exception: 6 mutations (getAuthUrl, listLocations, startImport + state management)
```

- [ ] **Step 4: Commit**

```bash
git add src/components/features/organization/organization-settings-page.tsx src/components/features/portal/link-tree/link-tree.tsx src/components/features/integration/import-connected-view/
git commit -m "docs(components): add server-import exception comments for high-mutation components"
```

---

## Task 10: Update CONTEXT.md — clarify type-only imports from application/dto in routes

**Files:**

- Modify: `src/routes/CONTEXT.md`

The current rule says "Routes must never import from `domain/`, `application/`, `infrastructure/`". This is too strict — routes legitimately need types from `application/dto` for loader return types. Rather than re-exporting every DTO type through the server module (which adds maintenance burden), the rule should allow `type`-only imports from `application/dto`.

However, the fix in Task 1 re-exports the type from the server module. If we keep that approach, the CONTEXT.md doesn't need changing. But the broader pattern of routes needing DTO types will recur. The pragmatic approach: update the rule to allow `type`-only imports.

- [ ] **Step 1: Update the dependency rules in routes CONTEXT.md**

In `src/routes/CONTEXT.md`, under "Routes must **never**:", change:

```markdown
Routes must **never**:

- Import from `domain/`, `application/`, `infrastructure/`
- Access the database directly
- Contain business logic
```

to:

```markdown
Routes must **never**:

- Import values from `domain/`, `application/`, `infrastructure/` — `type`-only imports from `application/dto/` are allowed for loader return types
- Access the database directly
- Contain business logic
```

- [ ] **Step 2: Revert Task 1's re-export approach (optional)**

Since the CONTEXT.md now allows type-only imports, the re-export in `server/public.ts` is unnecessary. Decide which approach is cleaner:

- **Option A (keep re-export):** Single import source for routes, but server module becomes a pass-through for types
- **Option B (allow type import):** Cleaner separation, but routes reach into application layer (even if type-only)

Recommendation: Keep the CONTEXT.md update (Option B) and revert Task 1's re-export. The original import was `type`-only and harmless.

- [ ] **Step 3: Commit**

```bash
git add src/routes/CONTEXT.md
git commit -m "docs(routes): allow type-only imports from application/dto for loader return types"
```

---

## Task 11: Split link-tree.tsx (H6, 314 lines)

**Files:**

- Modify: `src/components/features/portal/link-tree/link-tree.tsx` (314 lines → ~150)
- Create: `src/components/features/portal/link-tree/link-tree-toolbar.tsx` (~50 lines)
- Create: `src/components/features/portal/link-tree/empty-link-tree.tsx` (~30 lines)

This is the largest file. Split into focused sub-components.

- [ ] **Step 1: Read the file and identify extraction points**

Read `src/components/features/portal/link-tree/link-tree.tsx` and identify self-contained sections:

- Empty state rendering
- Toolbar / action buttons
- Main DnD container

- [ ] **Step 2: Extract empty state component**

Create `src/components/features/portal/link-tree/empty-link-tree.tsx`:

```typescript
type Props = Readonly<{
  onCreateCategory: () => void
}>

export function EmptyLinkTree({ onCreateCategory }: Props) {
  // Extract the empty state JSX from link-tree.tsx
}
```

- [ ] **Step 3: Extract toolbar component**

Create `src/components/features/portal/link-tree/link-tree-toolbar.tsx`:

```typescript
type Props = Readonly<{
  onAddCategory: () => void
  onAddLink: () => void
}>

export function LinkTreeToolbar({ onAddCategory, onAddLink }: Props) {
  // Extract toolbar JSX from link-tree.tsx
}
```

- [ ] **Step 4: Update link-tree.tsx to use extracted components**

Import and use the new components. The main file should now be under 150 lines.

- [ ] **Step 5: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/components/features/portal/link-tree/
git commit -m "refactor(link-tree): extract empty state and toolbar to stay under 150 lines"
```

---

## Task 12: Split remaining files over 150 lines (M4-M8)

**Files (in order of severity):**

- `src/components/features/team/team-members/team-member-list.tsx` (250 lines)
- `src/components/features/organization/organization-settings-form.tsx` (235 lines)
- `src/components/features/staff/assign-staff-form.tsx` (224 lines)
- `src/components/layout/manager-sidebar.tsx` (211 lines)
- `src/components/features/identity/member-directory/invite-member-form.tsx` (211 lines)
- `src/components/layout/staff-sidebar.tsx` (184 lines)
- `src/components/features/identity/member-directory/member-table.tsx` (171 lines)
- `src/components/features/portal/portal-form/create-portal-form.tsx` (170 lines)
- `src/components/features/portal/link-tree/sortable-category.tsx` (169 lines)
- `src/components/features/identity/registration/register-form.tsx` (168 lines)
- `src/components/features/portal/portal-form/edit-portal-form.tsx` (167 lines)
- `src/components/features/identity/registration/accept-invitation-page.tsx` (167 lines)

Each file needs to be read, extraction points identified, and sub-components created. This is a large batch of mechanical work.

- [ ] **Step 1: For each file, read it and identify what to extract**

General extraction strategies:

- **Forms:** Extract field groups into separate components (e.g., "address fields", "contact fields")
- **Tables:** Extract table row component
- **Sidebars:** Extract navigation sections
- **Lists:** Extract list item component

- [ ] **Step 2: Split each file**

For each file:

1. Read the current content
2. Identify a self-contained section (20-50 lines)
3. Extract it to a new file in the same directory
4. Import and use it in the original
5. Verify the original is now under 150 lines

Process files in order of severity (largest first).

- [ ] **Step 3: Verify build after all splits**

Run: `pnpm tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/components/
git commit -m "refactor(components): split files exceeding 150-line limit into focused sub-components"
```

---

## Task 13: Fix people.tsx tab state — use URL search params (LOW)

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/people.tsx`

- [ ] **Step 1: Replace useState with URL search params**

Change line 70 from:

```typescript
const [tab, setTab] = useState('staff')
```

To:

```typescript
const navigate = useNavigate()
const search = Route.useSearch()
const tab = (search as { tab?: string }).tab ?? 'staff'
```

And update the `Tabs` component:

```typescript
<Tabs value={tab} onValueChange={(t) => navigate({ search: { tab: t } })}>
```

Also add `validateSearch` to the route definition:

```typescript
validateSearch: (search: Record<string, string>) => ({
  tab: search.tab ?? 'staff',
}),
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/people.tsx
git commit -m "fix(routes): persist people tab in URL search params for shareability"
```

---

## Execution Order

Tasks are ordered by severity and dependency:

1. **Task 1** (C1) — application/dto import fix
2. **Task 2** (H2) — ConnectGoogleButton server import
3. **Task 3** (H1) — OrganizationSwitchList server import
4. **Task 4** (H3) — ProfileSettingsForm server imports
5. **Task 5** (H4) — import/index.tsx useQuery → loader
6. **Task 6** (H5) — import/$importId.tsx loader + polling
7. **Task 7** (M9-M10) — Missing staleTime
8. **Task 8** (LOW) — Props typing batch fix
9. **Task 9** (M1-M3) — Server-import exception comments
10. **Task 10** — CONTEXT.md update
11. **Task 11** (H6) — link-tree.tsx split
12. **Task 12** (M4-M8) — Remaining file splits
13. **Task 13** (LOW) — people.tsx URL state

Tasks 1-7 should be done first (severity). Tasks 8-10 are independent and can be parallelized. Tasks 11-12 are mechanical refactoring. Task 13 is a nice-to-have.

## Post-Implementation Verification

After all tasks are complete:

- [ ] Run `pnpm tsc --noEmit` — must pass clean
- [ ] Run `pnpm lint` — must pass clean
- [ ] Run `pnpm test` — all existing tests must pass
- [ ] Re-run the audit checks (grep for violations) to confirm zero findings
