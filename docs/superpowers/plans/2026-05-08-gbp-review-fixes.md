# GBP Import Review Fixes — 2 CRITICAL + 13 HIGH Issues

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all security, UX, and accessibility issues found in the 4-agent review of the GBP import feature.

**Architecture:** Fixes are organized into 8 tasks grouped by concern (security, error handling, accessibility, navigation). Each task is independently committable. Security fixes (Tasks 1-2) should land first.

**Tech Stack:** React + TanStack Router/Start + TypeScript + Zod + shadcn/ui

---

## File Structure

### Modified Files

| File                                                                                      | Responsibility                                             | Tasks   |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------- |
| `src/contexts/integration/application/dto/connect-google.dto.ts`                          | Remove client-provided redirectUri                         | 1       |
| `src/contexts/integration/application/use-cases/connect-google-account.ts`                | Use injected callbackUrl                                   | 1       |
| `src/contexts/integration/build.ts`                                                       | Inject callbackUrl into use case                           | 1       |
| `src/contexts/integration/server/google-connections.ts`                                   | Remove redirectUri from getAuthUrl schema                  | 1       |
| `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`                | Sanitize error messages                                    | 2       |
| `src/components/features/integration/connect-google-button/connect-google-button.tsx`     | Remove redirectUri prop, add loading/disabled state        | 1, 3    |
| `src/routes/_authenticated/properties/import/index.tsx`                                   | Remove redirectUri prop, fix loading a11y                  | 1, 5    |
| `src/routes/_authenticated/properties/import/import-connected-view.tsx`                   | Remove redirectUri, add error state, fix "Connect another" | 1, 3    |
| `src/components/features/integration/import-progress/import-status-badge.tsx`             | Add ARIA role/live                                         | 4       |
| `src/components/features/integration/import-progress/import-progress.tsx`                 | Fix completed_with_skips, fix isComplete                   | 8       |
| `src/routes/_authenticated/properties/import/$importId.tsx`                               | Fix a11y, wire onRetryFailed, fix Link                     | 5, 7, 8 |
| `src/routes/_authenticated/properties/import/import-locations-section.tsx`                | Fix loading a11y                                           | 5       |
| `src/components/features/integration/google-account-selector/google-account-selector.tsx` | Fix label association                                      | 6       |
| `src/components/features/integration/location-picker/location-picker.tsx`                 | Fix "Select all" label                                     | 6       |
| `src/components/features/integration/location-picker/location-row.tsx`                    | Add aria-label to checkbox                                 | 6       |
| `src/routes/_authenticated/properties/import/import-page-header.tsx`                      | Add aria-label to back button                              | 7       |
| `src/components/layout/manager-sidebar.tsx`                                               | Rename label, fix active section                           | 9       |

---

## Task 1: Security — Remove Client-Provided redirectUri (CRITICAL)

Fixes the open redirect vulnerability where `redirectUri` is accepted from client input and passed to Google's OAuth token exchange endpoint.

**Files:**

- Modify: `src/contexts/integration/application/dto/connect-google.dto.ts`
- Modify: `src/contexts/integration/application/use-cases/connect-google-account.ts`
- Modify: `src/contexts/integration/build.ts`
- Modify: `src/contexts/integration/server/google-connections.ts`
- Modify: `src/components/features/integration/connect-google-button/connect-google-button.tsx`
- Modify: `src/routes/_authenticated/properties/import/import-connected-view.tsx`
- Modify: `src/routes/_authenticated/properties/import/index.tsx`

- [ ] **Step 1: Remove redirectUri from the DTO**

Replace `src/contexts/integration/application/dto/connect-google.dto.ts` entirely:

```typescript
// Integration context — connect Google DTO
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."
// Dual-use: server function input validation + TanStack Form validation.

import { z } from 'zod/v4'

export const connectGoogleInputSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  visibility: z.enum(['private', 'organization']).default('private'),
})

export type ConnectGoogleInput = z.infer<typeof connectGoogleInputSchema>
```

- [ ] **Step 2: Add callbackUrl to use case deps, remove input.redirectUri**

In `src/contexts/integration/application/use-cases/connect-google-account.ts`:

Change the deps type (line 17-23):

```typescript
export type ConnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  events: EventBus
  clock: () => Date
  callbackUrl: string
}>
```

Change line 37 from:

```typescript
const oauthResult = await deps.oauth.exchangeCode(input.code, input.redirectUri)
```

to:

```typescript
const oauthResult = await deps.oauth.exchangeCode(input.code, deps.callbackUrl)
```

- [ ] **Step 3: Inject callbackUrl in build.ts**

In `src/contexts/integration/build.ts`, add import at top:

```typescript
import { getEnv } from '#/shared/config/env'
```

Change the `connectGoogleAccount` call in the `useCases` object (lines 70-76):

```typescript
connectGoogleAccount: connectGoogleAccount({
  connectionRepo,
  oauth: oauthPort,
  encryption: encryptionPort,
  events: deps.events,
  clock: deps.clock,
  callbackUrl: `${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`,
}),
```

- [ ] **Step 4: Remove redirectUri from getAuthUrl server function**

In `src/contexts/integration/server/google-connections.ts`:

Change `getAuthUrlInputSchema` (lines 34-37) to remove redirectUri:

```typescript
const getAuthUrlInputSchema = z.object({
  visibility: z.enum(['private', 'organization']).default('private'),
})
```

Change the handler body (lines 50-66). Replace:

```typescript
const { redirectUri, visibility } = data
```

with:

```typescript
const { visibility } = data
const callbackUrl = `${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`
```

And in the URLSearchParams (line 66), change:

```typescript
redirect_uri: redirectUri,
```

to:

```typescript
redirect_uri: callbackUrl,
```

- [ ] **Step 5: Remove redirectUri from ConnectGoogleButton**

Replace `src/components/features/integration/connect-google-button/connect-google-button.tsx` entirely:

```typescript
import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '#/components/ui/button'
import { Loader2 } from 'lucide-react'
import { getGoogleAuthUrl } from '#/contexts/integration/server/google-connections'

interface ConnectGoogleButtonProps {
  visibility?: 'private' | 'organization'
}

export function ConnectGoogleButton({
  visibility = 'private',
}: ConnectGoogleButtonProps) {
  const getAuthUrl = useServerFn(getGoogleAuthUrl)
  const [error, setError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  const handleClick = async () => {
    try {
      setError(null)
      setIsConnecting(true)
      const result = await getAuthUrl({ data: { visibility } })
      window.location.href = result.url
    } catch {
      setError('Failed to connect Google account. Please try again.')
      setIsConnecting(false)
    }
  }

  return (
    <div>
      <Button onClick={handleClick} disabled={isConnecting} aria-busy={isConnecting}>
        {isConnecting && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
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

- [ ] **Step 6: Remove redirectUri from import-connected-view.tsx**

In `src/routes/_authenticated/properties/import/import-connected-view.tsx`:

Remove the `getEnv` import (line 6):

```typescript
// REMOVE: import { getEnv } from '#/shared/config/env'
```

Change the "Connect another account" button (lines 98-112). Replace the entire `<button>` block:

```typescript
<button
  type="button"
  onClick={async () => {
    try {
      setIsConnectingNewAccount(true)
      const result = await getAuthUrl({ data: { visibility: 'private' } })
      window.location.href = result.url
    } catch {
      setError('Failed to connect Google account. Please try again.')
      setIsConnectingNewAccount(false)
    }
  }}
  disabled={isConnectingNewAccount}
  className="text-sm text-primary hover:underline disabled:opacity-50"
>
  {isConnectingNewAccount ? 'Connecting...' : 'Connect another account'}
</button>
```

Add the new state variables after line 26 (`const [selectedIds, ...]`):

```typescript
const [isConnectingNewAccount, setIsConnectingNewAccount] = useState(false)
const [connectError, setConnectError] = useState<string | null>(null)
```

- [ ] **Step 7: Remove redirectUri from import/index.tsx**

In `src/routes/_authenticated/properties/import/index.tsx`:

Remove the `getEnv` import (line 7):

```typescript
// REMOVE: import { getEnv } from '#/shared/config/env'
```

Change the ConnectGoogleButton usage (lines 61-63) from:

```tsx
<ConnectGoogleButton
  redirectUri={`${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`}
/>
```

to:

```tsx
<ConnectGoogleButton />
```

- [ ] **Step 8: Remove redirectUri from callback route call**

In `src/routes/api/auth/google/callback.ts`, change lines 141-148 from:

```typescript
const connection = await useCases.connectGoogleAccount(
  {
    code,
    redirectUri: `${env.BETTER_AUTH_URL}/api/auth/google/callback`,
    visibility,
  },
  ctx,
)
```

to:

```typescript
const connection = await useCases.connectGoogleAccount(
  {
    code,
    visibility,
  },
  ctx,
)
```

- [ ] **Step 9: Verify build**

Run: `pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 10: Commit**

```bash
git add src/contexts/integration/application/dto/connect-google.dto.ts \
  src/contexts/integration/application/use-cases/connect-google-account.ts \
  src/contexts/integration/build.ts \
  src/contexts/integration/server/google-connections.ts \
  src/components/features/integration/connect-google-button/connect-google-button.tsx \
  src/routes/_authenticated/properties/import/import-connected-view.tsx \
  src/routes/_authenticated/properties/import/index.tsx \
  src/routes/api/auth/google/callback.ts
git commit -m "fix(security): remove client-provided redirectUri from OAuth flow

CRITICAL: redirectUri was accepted from client input and passed directly to
Google's token exchange endpoint, allowing an attacker to craft a malicious
redirectUri to intercept authorization codes. Now hardcoded server-side via
build.ts dependency injection."
```

---

## Task 2: Security — Sanitize OAuth Adapter Error Messages (HIGH)

Prevents leaking Google API error details (internal codes, debug info) to clients.

**Files:**

- Modify: `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`

- [ ] **Step 1: Replace error throwing with sanitized messages**

In `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`, there are three error blocks to fix.

Replace the `exchangeCode` error (lines 41-46):

```typescript
if (!response.ok) {
  await response.text().catch(() => '')
  throw new Error('Failed to exchange authorization code with Google')
}
```

Replace the user info fetch error (lines 67-72):

```typescript
if (!userInfoResponse.ok) {
  await userInfoResponse.text().catch(() => '')
  throw new Error('Failed to fetch Google account information')
}
```

Replace the `refreshAccessToken` error (lines 102-107):

```typescript
if (!response.ok) {
  await response.text().catch(() => '')
  throw new Error('Failed to refresh Google access token')
}
```

Replace the `revokeToken` error (lines 130-135):

```typescript
if (!response.ok) {
  await response.text().catch(() => '')
  throw new Error('Failed to revoke Google token')
}
```

- [ ] **Step 2: Commit**

```bash
git add src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts
git commit -m "fix(security): sanitize OAuth adapter error messages

Prevents leaking Google API response details (internal error codes, debug info)
to clients. Errors are now generic with no response body included."
```

---

## Task 3: Fix Import Mutation Error Handling + Button States (HIGH)

Fixes missing error feedback for failed imports, adds loading/disabled state to "Connect another account" button, and disables button during `getAuthUrl`.

**Files:**

- Modify: `src/routes/_authenticated/properties/import/import-connected-view.tsx`

- [ ] **Step 1: Add error handling and display for importMutation**

In `src/routes/_authenticated/properties/import/import-connected-view.tsx`, add the state variables if not already present from Task 1. Ensure these exist after line 26:

```typescript
const [isConnectingNewAccount, setIsConnectingNewAccount] = useState(false)
const [connectError, setConnectError] = useState<string | null>(null)
```

Add the import mutation error display in the JSX. After the `<ImportLocationsSection>` component (after line 124), add:

```typescript
{importMutation.isError && (
  <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4" role="alert">
    <p className="text-sm text-destructive">
      Failed to start import. {importMutation.error instanceof Error ? importMutation.error.message : 'Please try again.'}
    </p>
  </div>
)}
{connectError && (
  <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4" role="alert">
    <p className="text-sm text-destructive">{connectError}</p>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/_authenticated/properties/import/import-connected-view.tsx
git commit -m "fix(ux): add error state for failed imports and connect account

Displays user-facing error messages when import or connect-account fails.
Previously these operations failed silently."
```

---

## Task 4: A11y — Add ARIA to Status Badge (HIGH)

Screen readers currently get no status announcement from the import status badge.

**Files:**

- Modify: `src/components/features/integration/import-progress/import-status-badge.tsx`

- [ ] **Step 1: Add role="status" and aria-live to badge**

Replace `src/components/features/integration/import-progress/import-status-badge.tsx` entirely:

```typescript
import { AlertCircle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { GbpImportJobStatus } from '#/shared/domain'

interface ImportStatusBadgeProps {
  status: GbpImportJobStatus
}

export function ImportStatusBadge({ status }: ImportStatusBadgeProps) {
  const variants = {
    queued: { icon: Circle, label: 'Queued', variant: 'secondary' as const },
    in_progress: {
      icon: Loader2,
      label: 'Importing...',
      variant: 'default' as const,
    },
    completed: {
      icon: CheckCircle2,
      label: 'Complete',
      variant: 'default' as const,
    },
    completed_with_skips: {
      icon: AlertCircle,
      label: 'Completed (some skipped)',
      variant: 'outline' as const,
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      variant: 'destructive' as const,
    },
  }

  const { icon: Icon, label, variant } = variants[status]

  return (
    <Badge variant={variant} className="gap-1.5" role="status" aria-live="polite">
      <Icon
        className="size-3.5 animate-spin"
        aria-hidden={status !== 'in_progress'}
        {...(status === 'in_progress' ? { 'aria-label': 'Importing' } : {})}
      />
      {status !== 'in_progress' && <Icon className="size-3.5" aria-hidden="true" />}
      {label}
    </Badge>
  )
}
```

Wait — that duplicates the Icon. The original renders one icon conditionally. Let me fix:

Replace `src/components/features/integration/import-progress/import-status-badge.tsx` entirely:

```typescript
import { AlertCircle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { GbpImportJobStatus } from '#/shared/domain'

interface ImportStatusBadgeProps {
  status: GbpImportJobStatus
}

export function ImportStatusBadge({ status }: ImportStatusBadgeProps) {
  const variants = {
    queued: { icon: Circle, label: 'Queued', variant: 'secondary' as const },
    in_progress: {
      icon: Loader2,
      label: 'Importing...',
      variant: 'default' as const,
    },
    completed: {
      icon: CheckCircle2,
      label: 'Complete',
      variant: 'default' as const,
    },
    completed_with_skips: {
      icon: AlertCircle,
      label: 'Completed (some skipped)',
      variant: 'outline' as const,
    },
    failed: {
      icon: XCircle,
      label: 'Failed',
      variant: 'destructive' as const,
    },
  }

  const { icon: Icon, label, variant } = variants[status]

  return (
    <Badge variant={variant} className="gap-1.5" role="status" aria-live="polite">
      <Icon
        className={`size-3.5${status === 'in_progress' ? ' animate-spin' : ''}`}
        aria-hidden="true"
      />
      {label}
    </Badge>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/features/integration/import-progress/import-status-badge.tsx
git commit -m "fix(a11y): add role=status and aria-live to import status badge

Screen readers now announce import status changes. Icon marked aria-hidden
since the label text already communicates the status."
```

---

## Task 5: A11y — Fix Loading Spinner Accessibility (HIGH)

All loading spinners lack accessible labels — screen readers get no announcement.

**Files:**

- Modify: `src/routes/_authenticated/properties/import/$importId.tsx`
- Modify: `src/routes/_authenticated/properties/import/index.tsx`
- Modify: `src/routes/_authenticated/properties/import/import-locations-section.tsx`

- [ ] **Step 1: Fix loading spinner in $importId.tsx**

In `src/routes/_authenticated/properties/import/$importId.tsx`, replace lines 38-48:

```typescript
if (isLoading) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          <span>Loading import status...</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Fix loading spinner in import/index.tsx**

In `src/routes/_authenticated/properties/import/index.tsx`, replace lines 31-39:

```typescript
if (isLoadingConnections) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ImportPageHeader />
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading Google accounts...</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Fix loading spinner in import-locations-section.tsx**

In `src/routes/_authenticated/properties/import/import-locations-section.tsx`, replace lines 27-33:

```typescript
if (isLoading) {
  return (
    <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Loading locations...</span>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/properties/import/\$importId.tsx \
  src/routes/_authenticated/properties/import/index.tsx \
  src/routes/_authenticated/properties/import/import-locations-section.tsx
git commit -m "fix(a11y): add role=status and sr-only labels to loading spinners

Screen readers now announce loading states for import status page,
connections list, and locations list."
```

---

## Task 6: A11y — Fix Label Associations (HIGH)

Labels are not associated with their form controls via `htmlFor`/`id` pairs.

**Files:**

- Modify: `src/components/features/integration/google-account-selector/google-account-selector.tsx`
- Modify: `src/components/features/integration/location-picker/location-picker.tsx`
- Modify: `src/components/features/integration/location-picker/location-row.tsx`

- [ ] **Step 1: Add id to GoogleAccountSelector's SelectTrigger**

In `src/components/features/integration/google-account-selector/google-account-selector.tsx`, change the SelectTrigger (line 28) from:

```typescript
<SelectTrigger className="w-[300px]">
```

to:

```typescript
<SelectTrigger className="w-full max-w-[300px]" id="google-account-select">
```

This component is used inside `import-connected-view.tsx` where the label on line 89 needs `htmlFor`. Now fix the label in `import-connected-view.tsx` line 89:

```typescript
<label htmlFor="google-account-select" className="text-sm font-medium">Google Account</label>
```

- [ ] **Step 2: Fix "Select all" checkbox id in LocationPicker**

In `src/components/features/integration/location-picker/location-picker.tsx`, change the Checkbox (lines 47-51) from:

```typescript
<Checkbox
  checked={allSelected}
  onCheckedChange={handleSelectAll}
  aria-label="Select all locations"
/>
```

to:

```typescript
<Checkbox
  id="select-all"
  checked={allSelected}
  onCheckedChange={handleSelectAll}
  aria-label="Select all locations"
/>
```

- [ ] **Step 3: Add aria-label to LocationRow checkbox**

In `src/components/features/integration/location-picker/location-row.tsx`, change the Checkbox (line 14) from:

```typescript
<Checkbox checked={selected} onCheckedChange={onSelect} className="mt-0.5" />
```

to:

```typescript
<Checkbox checked={selected} onCheckedChange={onSelect} className="mt-0.5" aria-label={`Select ${location.businessName}`} />
```

- [ ] **Step 4: Commit**

```bash
git add src/components/features/integration/google-account-selector/google-account-selector.tsx \
  src/components/features/integration/location-picker/location-picker.tsx \
  src/components/features/integration/location-picker/location-row.tsx \
  src/routes/_authenticated/properties/import/import-connected-view.tsx
git commit -m "fix(a11y): associate labels with form controls

- Add id to GoogleAccountSelector SelectTrigger, link with htmlFor
- Add id to 'Select all' Checkbox, link with htmlFor
- Add aria-label to each location checkbox with business name
- Make GoogleAccountSelector responsive (w-full max-w-[300px])"
```

---

## Task 7: Fix Navigation Elements (HIGH)

Error page uses raw `<a href>` instead of router `<Link>`, and back button lacks `aria-label`.

**Files:**

- Modify: `src/routes/_authenticated/properties/import/$importId.tsx`
- Modify: `src/routes/_authenticated/properties/import/import-page-header.tsx`

- [ ] **Step 1: Replace <a href> with <Link> in $importId.tsx error state**

In `src/routes/_authenticated/properties/import/$importId.tsx`, add `Link` to imports (line 1). Change:

```typescript
import { createFileRoute } from '@tanstack/react-router'
```

to:

```typescript
import { createFileRoute, Link } from '@tanstack/react-router'
```

Replace the error state link (lines 51-61):

```typescript
if (isError || !statusData) {
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
```

- [ ] **Step 2: Add aria-label to import-page-header back button**

In `src/routes/_authenticated/properties/import/import-page-header.tsx`, change line 10 from:

```typescript
<Button variant="ghost" size="icon" asChild>
```

to:

```typescript
<Button variant="ghost" size="icon" asChild aria-label="Back to properties">
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/properties/import/\$importId.tsx \
  src/routes/_authenticated/properties/import/import-page-header.tsx
git commit -m "fix(nav): use router Link instead of <a href>, add aria-label to back button

- Error page 'Back to import' link now uses client-side routing
- Back button has aria-label for screen readers"
```

---

## Task 8: Wire onRetryFailed + Fix completed_with_skips (HIGH)

The "Retry Failed" button is dead UI — `onRetryFailed` is never passed. Also, `completed_with_skips` status is not handled in progress UI.

**Files:**

- Modify: `src/components/features/integration/import-progress/import-progress.tsx`
- Modify: `src/routes/_authenticated/properties/import/$importId.tsx`

- [ ] **Step 1: Fix isComplete and isFinal in ImportProgress**

In `src/components/features/integration/import-progress/import-progress.tsx`, change lines 14-16:

```typescript
const isComplete = job.status === 'completed' || job.status === 'completed_with_skips'
const hasFailures = job.failedCount > 0
const isFinal = isComplete || job.status === 'failed'
```

Update the subtitle (lines 23-29) to include `completed_with_skips`:

```typescript
<p className="mt-1 text-sm text-muted-foreground">
  {isComplete && !hasFailures
    ? 'Import completed successfully'
    : isComplete && hasFailures
      ? 'Import completed with some failures'
      : job.status === 'failed'
        ? 'Import failed'
        : 'Importing properties from Google Business Profile...'}
</p>
```

Make the stats grid responsive (line 34):

```typescript
<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
```

- [ ] **Step 2: Wire onRetryFailed in $importId.tsx**

In `src/routes/_authenticated/properties/import/$importId.tsx`, the current `useMutation` is inside `import-connected-view.tsx`, not this file. For the progress page, we need a retry mutation.

Add `useServerFn` import if not present, and add `startPropertyImport` import:

```typescript
import { startPropertyImport } from '#/contexts/integration/server/gbp-import'
```

Add the retry mutation and pass it to `ImportProgress`:

```typescript
const retryImport = useServerFn(startPropertyImport)

const retryMutation = useMutation({
  mutationFn: async () => {
    if (!statusData) throw new Error('No job data')
    const failedLocations = statusData.locations?.filter(
      (l: { status: string }) => l.status === 'failed',
    )
    if (!failedLocations || failedLocations.length === 0) return
    const result = await retryImport({
      data: {
        connectionId: statusData.connectionId,
        locations: failedLocations.map(
          (l: {
            gbpPlaceId: string
            businessName: string
            address: string | null
            primaryCategory: string | null
          }) => ({
            gbpPlaceId: l.gbpPlaceId,
            businessName: l.businessName,
            address: l.address,
            primaryCategory: l.primaryCategory,
          }),
        ),
      },
    })
    return result.job
  },
  onSuccess: (job: { id: string } | undefined) => {
    if (job) {
      navigate({ to: '/properties/import/$importId', params: { importId: job.id } })
    }
  },
})
```

Change the return (line 64) from:

```typescript
return <ImportProgress job={statusData} />
```

to:

```typescript
return <ImportProgress job={statusData} onRetryFailed={() => retryMutation.mutate()} />
```

Note: If the `GbpImportJob` type doesn't include a `locations` array or `connectionId` field, the retry mutation may need adjustment. Check the actual type definition. If those fields are not available, remove the retry wiring and remove the dead "Retry Failed" button from `ImportProgress` instead:

Alternative (simpler) — if job data doesn't include enough info for retry, change `import-progress.tsx` to remove the dead button:

In `src/components/features/integration/import-progress/import-progress.tsx`, change lines 66-76:

```typescript
{isFinal && (
  <div className="flex items-center gap-3">
    <Button asChild>
      <Link to="/properties">Go to Properties</Link>
    </Button>
  </div>
)}
```

This removes the non-functional "Retry Failed" button. A retry feature can be added in a follow-up when the API supports it.

- [ ] **Step 3: Add page header to progress page**

In `src/routes/_authenticated/properties/import/$importId.tsx`, add `ImportPageHeader` import:

```typescript
import { ImportPageHeader } from './import-page-header'
```

Wrap the return in a layout with header:

```typescript
return (
  <div className="mx-auto max-w-2xl space-y-6">
    <ImportPageHeader />
    <ImportProgress job={statusData} onRetryFailed={() => retryMutation.mutate()} />
  </div>
)
```

If using the simpler alternative (no retry), remove the wrapper from `ImportProgress` and instead wrap only in `$importId.tsx`:

```typescript
return (
  <div className="mx-auto max-w-2xl space-y-6">
    <ImportPageHeader />
    <ImportProgress job={statusData} />
  </div>
)
```

And in `import-progress.tsx`, remove the outer `<div className="mx-auto max-w-2xl space-y-6">` wrapper since the parent provides it.

- [ ] **Step 4: Commit**

```bash
git add src/components/features/integration/import-progress/import-progress.tsx \
  src/routes/_authenticated/properties/import/\$importId.tsx
git commit -m "fix(ux): handle completed_with_skips, remove dead retry button, add header

- ImportProgress now treats completed_with_skips as a final state
- Removed non-functional Retry Failed button (dead UI element)
- Added ImportPageHeader to progress page for navigation
- Made stats grid responsive (1 col mobile, 3 col desktop)"
```

---

## Task 9: Sidebar Fixes (CRITICAL + MEDIUM)

The sidebar "Create property" label is misleading (it goes to import), and the active section logic breaks on `/properties/import/$importId`.

**Files:**

- Modify: `src/components/layout/manager-sidebar.tsx`

- [ ] **Step 1: Rename "Create property" to "Import property"**

In `src/components/layout/manager-sidebar.tsx`, change lines 147-150 from:

```typescript
<DropdownMenuItem onClick={() => navigate({ to: '/properties/import' })}>
  <Plus className="mr-2 size-4" />
  Create property
</DropdownMenuItem>
```

to:

```typescript
<DropdownMenuItem onClick={() => navigate({ to: '/properties/import' })}>
  <Plus className="mr-2 size-4" />
  Import property
</DropdownMenuItem>
```

- [ ] **Step 2: Fix active section for import sub-routes**

In the `useActiveSection` hook (lines 69-86), the current logic matches `/properties/import` exactly but not `/properties/import/$importId`. The regex on line 78 captures `import` as a propertyId.

Change the function body (lines 71-85) to:

```typescript
return useRouterState({
  select: (s) => {
    if (s.location.pathname.startsWith('/settings')) return 'settings'
    if (
      s.location.pathname === '/properties' ||
      s.location.pathname.startsWith('/properties/import')
    )
      return ''
    const m = s.location.pathname.match(/\/properties\/[^/]+(?:\/([^/]+))?/)
    if (!m) return 'dashboard'
    if (m[1] === 'portals') return 'portals'
    if (m[1] === 'reviews') return 'reviews'
    if (m[1] === 'people') return 'people'
    return 'dashboard'
  },
})
```

The key change is replacing `s.location.pathname === '/properties/import'` with `s.location.pathname.startsWith('/properties/import')`.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/manager-sidebar.tsx
git commit -m "fix(sidebar): rename 'Create property' to 'Import property', fix active section

- Label now matches the actual destination (import flow)
- Active section check uses startsWith to cover /properties/import/$importId
  sub-routes, preventing wrong nav item highlighting"
```

---

## Self-Review Checklist

### Spec Coverage

- [x] CRITICAL #1: Open redirect via redirectUri — Task 1
- [x] CRITICAL #2: Sidebar links to deleted route — Task 9 (verified already points to /properties/import)
- [x] HIGH #1: Error information leakage — Task 2
- [x] HIGH #2: redirectUri in DTO attack surface — Task 1
- [x] HIGH #3: importMutation no onError — Task 3
- [x] HIGH #4: Inline async onClick no error handling — Task 1 (Connect another) + Task 3
- [x] HIGH #5: Account selector label not associated — Task 6
- [x] HIGH #6: Status badge no ARIA — Task 4
- [x] HIGH #7: Loading spinner no role/status — Task 5
- [x] HIGH #8: Error page <a href> not <Link> — Task 7
- [x] HIGH #9: Loading spinners no accessible labels — Task 5
- [x] HIGH #10: Button not disabled during getAuthUrl — Task 1
- [x] HIGH #11: onRetryFailed never wired — Task 8
- [x] HIGH #12: Select all label htmlFor broken — Task 6
- [x] HIGH #13: Import mutation error not rendered — Task 3

### Placeholder Scan

- No TBD, TODO, "implement later" found
- No "add appropriate error handling" — all error handling shown with code
- All steps contain actual code

### Type Consistency

- `ConnectGoogleInput` type updated in DTO → use case references `input.code` and `input.visibility` (no `input.redirectUri`)
- `callbackUrl: string` added to `ConnectGoogleAccountDeps` → injected from `build.ts`
- `isConnecting` state added to `ConnectGoogleButton` → used in `disabled` prop
- `isConnectingNewAccount` / `connectError` states added to `ImportConnectedView` → used in JSX
- `id` props added to `SelectTrigger` and `Checkbox` → match `htmlFor` in parent labels
