# Settings Gap Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill all settings page stubs with real functionality, redesign organization settings with the warm precision design system, and refactor the manager sidebar to feature a property switcher.

**Architecture:** Extract the image upload UI from the portal edit form into a shared reusable widget. Add org logo upload server functions in the identity context (presigned URL pattern, same as portal). Each settings page gets a real form wired to server functions. The manager sidebar replaces the org switcher with a property switcher; org switching moves to the Organization settings page.

**Tech Stack:** React, TanStack Router + Start, TanStack Form, Zod v4, better-auth, shadcn/ui (Card, FieldGroup, etc), Tailwind CSS with oklch design tokens, S3 presigned uploads

---

## File Structure

### New files

| File                                                                      | Responsibility                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/components/forms/image-upload-field.tsx`                             | Shared image upload widget (drag/drop, progress, preview). Extracted from portal edit form. |
| `src/contexts/identity/application/use-cases/request-org-logo-upload.ts`  | Use case: presigned URL for org logo                                                        |
| `src/contexts/identity/application/use-cases/finalize-org-logo-upload.ts` | Use case: confirm upload, return public URL                                                 |
| `src/components/features/identity/profile-settings-form.tsx`              | Profile settings form (name + avatar + read-only email)                                     |
| `src/components/features/identity/security-settings-form.tsx`             | Password change form + disabled 2FA card                                                    |
| `src/components/features/organization/organization-switch-list.tsx`       | Org switch list component for settings                                                      |
| `src/components/features/organization/organization-settings-page.tsx`     | Full redesigned org settings page                                                           |
| `src/components/features/settings/preferences-settings-page.tsx`          | Theme toggle + disabled notifications                                                       |

### Modified files

| File                                                                  | Change                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/components/features/portal/portal-form/edit-portal-form.tsx`     | Replace inline upload JSX with shared `ImageUploadField`                |
| `src/components/features/organization/organization-settings-form.tsx` | Remove logo URL text field (logo moves to page-level banner)            |
| `src/routes/_authenticated/settings/profile.tsx`                      | Wire profile settings form                                              |
| `src/routes/_authenticated/settings/organization.tsx`                 | Wire redesigned org settings page                                       |
| `src/routes/_authenticated/settings/security.tsx`                     | Wire security settings form                                             |
| `src/routes/_authenticated/settings/preferences.tsx`                  | Wire preferences page                                                   |
| `src/components/layout/manager-sidebar.tsx`                           | Remove org switcher, replace with property switcher                     |
| `src/contexts/identity/server/organizations.ts`                       | Add `requestOrgLogoUpload` and `finalizeOrgLogoUpload` server functions |
| `src/contexts/identity/build.ts`                                      | Wire new upload use cases                                               |

---

### Task 1: Shared Image Upload Widget

**Files:**

- Create: `src/components/forms/image-upload-field.tsx`
- Modify: `src/components/features/portal/portal-form/edit-portal-form.tsx`

This task extracts the upload UI from the portal edit form into a reusable component. The component handles drag-and-drop, file validation, upload progress, and preview — but delegates the actual upload orchestration (request URL, PUT, finalize) to callbacks passed as props.

- [ ] **Step 1: Create `src/components/forms/image-upload-field.tsx`**

```tsx
import { useState, useRef, useCallback } from 'react'
import { Upload, ImageIcon, X, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

type ImageUploadFieldProps = Readonly<{
  /** Current image URL to display (null = no image) */
  imageUrl: string | null
  /** Called when image URL changes (after successful upload or removal) */
  onImageUrlChange: (url: string | null) => void
  /** Called to perform the upload. Receives file, returns public URL. */
  onUpload: (file: File) => Promise<string>
  /** Whether the user has permission to edit */
  disabled?: boolean
  /** Shape variant: 'rect' for hero images, 'circle' for avatars/logos */
  variant?: 'rect' | 'circle'
  /** Accepted MIME types (defaults to standard image types) */
  acceptedTypes?: string[]
  /** Max file size in bytes (defaults to 10MB) */
  maxFileSize?: number
  /** Empty state label */
  emptyLabel?: string
}>
```

The component should:

1. Accept the props above (no internal upload logic — `onUpload` callback handles the presigned URL flow)
2. Render a drag-and-drop zone: `rect` variant = `h-32` or `h-48` (with image), `circle` variant = `size-24` centered circle
3. Show upload progress bar during upload (tracked internally via XHR)
4. Show preview with remove button when image exists
5. Show "Click to upload or drag and drop" + file type hint when empty
6. Validate file type and size client-side before calling `onUpload`
7. Use `toast` from sonner for error/success messages

Internal state: `uploading`, `uploadProgress`, `dragOver`. The `onUpload` callback is an async function that the parent provides — it handles requesting the presigned URL, PUT-ing the file, finalizing, and returning the public URL. The component wraps the PUT in XHR for progress tracking.

The component does NOT use `useAction` or call server functions directly — it's purely a UI widget.

- [ ] **Step 2: Refactor `edit-portal-form.tsx` to use the shared widget**

Remove the entire upload JSX block (the `handleImageUpload`, `handleDragOver`, `handleDragLeave`, `handleDrop`, the file input, and the upload JSX from the render). Replace with:

```tsx
<ImageUploadField
  imageUrl={heroImageUrl}
  onImageUrlChange={setHeroImageUrl}
  onUpload={async (file) => {
    const { uploadUrl, key } = await uploadRequest({
      data: { portalId: portal.id, contentType: file.type, fileSize: file.size },
    })
    await putFileWithProgress(uploadUrl, file, () => {})
    const { heroImageUrl: url } = await uploadFinalize({
      data: { portalId: portal.id, key },
    })
    return url
  }}
  disabled={!can('portal.update')}
  variant="rect"
  emptyLabel="Upload hero image"
/>
```

The `putFileWithProgress` helper is a small utility extracted from the existing XHR code — it does the actual PUT to S3. It can be a local helper in `edit-portal-form.tsx` or exported from the shared widget file.

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/bozhidardenev/conductor/workspaces/reputation-key/manama && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Run dev server and verify portal edit still works**

Run: `pnpm dev`
Verify: Navigate to a portal detail page, confirm the image upload zone still renders and the edit form still functions.

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/image-upload-field.tsx src/components/features/portal/portal-form/edit-portal-form.tsx
git commit -m "refactor: extract shared ImageUploadField from portal form"
```

---

### Task 2: Org Logo Upload Server Functions

**Files:**

- Create: `src/contexts/identity/application/use-cases/request-org-logo-upload.ts`
- Create: `src/contexts/identity/application/use-cases/finalize-org-logo-upload.ts`
- Modify: `src/contexts/identity/server/organizations.ts`
- Modify: `src/contexts/identity/build.ts`

These mirror the portal upload pattern but for organization logos. The identity context needs access to `StoragePort` (currently only wired into the portal context). The composition root already exposes `storage` from the container, so the server functions can access it via `getContainer().storage`.

- [ ] **Step 1: Create `src/contexts/identity/application/use-cases/request-org-logo-upload.ts`**

```ts
import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { randomUUID } from 'crypto'

export type RequestOrgLogoUploadDeps = Readonly<{
  storage: StoragePort
}>

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB for logos

export const requestOrgLogoUpload =
  (deps: RequestOrgLogoUploadDeps) =>
  async (
    input: { contentType: string; fileSize: number },
    ctx: AuthContext,
  ): Promise<{ uploadUrl: string; key: string }> => {
    if (!can(ctx.role, 'organization.update')) {
      throw new Error('Insufficient permissions to upload organization logo')
    }

    if (!ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
      throw new Error(`Content type ${input.contentType} is not allowed`)
    }

    if (input.fileSize > MAX_FILE_SIZE) {
      throw new Error('File size exceeds 5 MB limit')
    }

    const key = `organizations/${ctx.organizationId}/logo/${randomUUID()}`
    const { uploadUrl } = await deps.storage.createPresignedUploadUrl(
      key,
      input.contentType,
      MAX_FILE_SIZE,
    )

    return { uploadUrl, key }
  }
```

- [ ] **Step 2: Create `src/contexts/identity/application/use-cases/finalize-org-logo-upload.ts`**

```ts
import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'

export type FinalizeOrgLogoUploadDeps = Readonly<{
  storage: StoragePort
}>

export const finalizeOrgLogoUpload =
  (deps: FinalizeOrgLogoUploadDeps) =>
  async (input: { key: string }, ctx: AuthContext): Promise<{ logoUrl: string }> => {
    if (!can(ctx.role, 'organization.update')) {
      throw new Error('Insufficient permissions to upload organization logo')
    }

    const publicUrl = await deps.storage.confirmUpload(input.key)
    return { logoUrl: publicUrl }
  }
```

- [ ] **Step 3: Add server functions to `src/contexts/identity/server/organizations.ts`**

Add two new server functions at the end of the file, before any closing brackets:

```ts
// ── Organization logo upload ────────────────────────────────────────

const requestOrgLogoUploadSchema = z.object({
  contentType: z.string(),
  fileSize: z
    .number()
    .positive()
    .max(5 * 1024 * 1024),
})

export const requestOrgLogoUpload = createServerFn({ method: 'POST' })
  .inputValidator(requestOrgLogoUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { storage } = getContainer()
        const useCase = requestOrgLogoUploadUseCase({ storage })
        return useCase(data, ctx)
      },
      'POST',
      'identity.requestOrgLogoUpload',
    ),
  )

const finalizeOrgLogoUploadSchema = z.object({
  key: z.string().min(1),
})

export const finalizeOrgLogoUpload = createServerFn({ method: 'POST' })
  .inputValidator(finalizeOrgLogoUploadSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { storage } = getContainer()
        const useCase = finalizeOrgLogoUploadUseCase({ storage })
        const result = await useCase(data, ctx)

        // Update the org's logo field via better-auth
        const auth = getAuth()
        await auth.api.updateOrganization({
          headers,
          body: { data: { logo: result.logoUrl } },
        })

        return result
      },
      'POST',
      'identity.finalizeOrgLogoUpload',
    ),
  )
```

Add the imports at the top of the file:

```ts
import { requestOrgLogoUpload as requestOrgLogoUploadUseCase } from '../application/use-cases/request-org-logo-upload'
import { finalizeOrgLogoUpload as finalizeOrgLogoUploadUseCase } from '../application/use-cases/finalize-org-logo-upload'
```

Note: `getContainer()` is already imported in this file.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/contexts/identity/application/use-cases/request-org-logo-upload.ts src/contexts/identity/application/use-cases/finalize-org-logo-upload.ts src/contexts/identity/server/organizations.ts
git commit -m "feat: add org logo upload server functions"
```

---

### Task 3: Organization Settings Page Redesign

**Files:**

- Create: `src/components/features/organization/organization-settings-page.tsx`
- Create: `src/components/features/organization/organization-switch-list.tsx`
- Modify: `src/components/features/organization/organization-settings-form.tsx`
- Modify: `src/routes/_authenticated/settings/organization.tsx`

This is the biggest visual change. The page gets three sections:

1. **Header banner** — circular logo upload on the left, org name as display title, slug as a subtle badge
2. **Identity card** — name, slug, contact email (using the existing `OrganizationSettingsForm` minus the logo field)
3. **Billing card** — company, address, city, postal code, country (same form, just visually separated)
4. **Org switch list** — at the bottom, shows all orgs with active indicator

- [ ] **Step 1: Create `src/components/features/organization/organization-switch-list.tsx`**

A simple list showing all organizations the user belongs to. The active one is highlighted. Clicking another org switches the active org and navigates to `/properties`.

```tsx
import { useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useAction } from '#/components/hooks/use-action'
import { useServerFn } from '@tanstack/react-start'
import { setActiveOrganization } from '#/contexts/identity/server/organizations'

type Org = Readonly<{ id: string; name: string }>

type Props = Readonly<{
  organizations: ReadonlyArray<Org>
  activeOrganizationId: string | null
}>

export function OrganizationSwitchList({ organizations, activeOrganizationId }: Props) {
  const navigate = useNavigate()
  const switchOrg = useAction(useServerFn(setActiveOrganization))

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
              disabled={isActive || switchOrg.isPending}
              onClick={() => {
                switchOrg({ data: { organizationId: org.id } })
                  .then(() => navigate({ to: '/properties' }))
                  .catch(() => {})
              }}
              className={[
                'flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-accent',
                isActive && 'bg-accent/50',
              ].join(' ')}
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

- [ ] **Step 2: Modify `src/components/features/organization/organization-settings-form.tsx`**

Remove the `logo` field from the form schema and JSX. The logo is now handled at the page level (in the header banner). The form should only have:

**Identity section:** name, slug (with slug-change warning), contact email
**Billing section:** billingCompanyName, billingAddress, billingCity, billingPostalCode, billingCountry

Wrap each section in a Card component:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
```

The Identity section goes in one `<Card>`, Billing in another `<Card>`. The form wraps both cards. Remove the `logo` field from `orgSettingsSchema`, `FormValues`, `Props`, `defaultValues`, and the JSX.

- [ ] **Step 3: Create `src/components/features/organization/organization-settings-page.tsx`**

This is the full page component that the route renders. It composes:

- Header banner with circular logo upload + org name
- The modified `OrganizationSettingsForm` (identity + billing cards)
- `OrganizationSwitchList` at the bottom

```tsx
import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { Badge } from '#/components/ui/badge'
import { ImageUploadField } from '#/components/forms/image-upload-field'
import { OrganizationSettingsForm } from './organization-settings-form'
import { OrganizationSwitchList } from './organization-switch-list'
import {
  updateOrganization,
  requestOrgLogoUpload,
  finalizeOrgLogoUpload,
} from '#/contexts/identity/server/organizations'

type OrgData = Readonly<{
  id: string
  name: string
  slug: string
  logo: string | null
  contactEmail: string | null
  billingCompanyName: string | null
  billingAddress: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
}>

type Props = Readonly<{
  organization: OrgData
  organizations: ReadonlyArray<{ id: string; name: string }>
  activeOrganizationId: string | null
}>

export function OrganizationSettingsPage({
  organization,
  organizations,
  activeOrganizationId,
}: Props) {
  const [logoUrl, setLogoUrl] = useState(organization.logo)
  const updateOrg = useAction(useServerFn(updateOrganization))

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className="flex items-center gap-4">
        <ImageUploadField
          imageUrl={logoUrl}
          onImageUrlChange={(url) => {
            setLogoUrl(url)
            if (url !== organization.logo) {
              updateOrg({ data: { logo: url } }).catch(() => {})
            }
          }}
          onUpload={async (file) => {
            const { uploadUrl, key } = await useServerFn(requestOrgLogoUpload)({
              data: { contentType: file.type, fileSize: file.size },
            })
            // PUT file to presigned URL
            await fetch(uploadUrl, {
              method: 'PUT',
              body: file,
              headers: { 'Content-Type': file.type },
            })
            const { logoUrl: url } = await useServerFn(finalizeOrgLogoUpload)({
              data: { key },
            })
            return url
          }}
          variant="circle"
          emptyLabel="Upload logo"
          disabled={updateOrg.isPending}
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight display-title">
            {organization.name}
          </h1>
          <Badge variant="secondary" className="mt-1">
            {organization.slug}
          </Badge>
        </div>
      </div>

      {/* Settings form (identity + billing cards) */}
      <OrganizationSettingsForm
        organization={organization}
        onSubmit={async (values) => {
          await updateOrg({ data: values })
        }}
        isPending={updateOrg.isPending}
        error={updateOrg.error}
      />

      {/* Org switch list */}
      <OrganizationSwitchList
        organizations={organizations}
        activeOrganizationId={activeOrganizationId}
      />
    </div>
  )
}
```

Note: The `onUpload` callback here is a simplified version — in practice you'll want the XHR progress wrapper from the shared upload field or a similar utility. The `ImageUploadField` component handles the progress internally when the `onUpload` promise is in flight.

- [ ] **Step 4: Wire the route page `src/routes/_authenticated/settings/organization.tsx`**

Replace the placeholder with:

```tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'
import { useServerFn } from '@tanstack/react-start'
import {
  getActiveOrganization,
  listUserOrganizations,
} from '#/contexts/identity/server/organizations'
import { OrganizationSettingsPage } from '#/components/features/organization/organization-settings-page'
import { useRouter } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/settings/organization')({
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'organization.update')) {
      throw redirect({ to: '/settings/profile' })
    }
  },
  loader: async () => {
    const orgResult = await useServerFn(getActiveOrganization)()
    const orgsResult = await useServerFn(listUserOrganizations)()
    return {
      organization: orgResult.organization,
      organizations: orgsResult.organizations,
      activeOrganizationId: orgResult.organization?.id ?? null,
    }
  },
  component: OrganizationSettingsRoute,
})

function OrganizationSettingsRoute() {
  const { organization, organizations, activeOrganizationId } = Route.useLoaderData()
  const router = useRouter()

  if (!organization) {
    return (
      <div className="text-center text-sm text-muted-foreground py-12">
        No active organization found.
      </div>
    )
  }

  return (
    <OrganizationSettingsPage
      organization={organization}
      organizations={organizations}
      activeOrganizationId={activeOrganizationId}
    />
  )
}
```

Note: The `loader` here calls server functions directly. Adjust imports based on what `listUserOrganizations` actually returns (check the existing return shape — it returns `{ organizations: [...] }`).

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (may need minor adjustments to type shapes)

- [ ] **Step 6: Commit**

```bash
git add src/components/features/organization/ src/routes/_authenticated/settings/organization.tsx
git commit -m "feat: redesign organization settings with logo upload and org switcher"
```

---

### Task 4: Profile Settings Page

**Files:**

- Create: `src/components/features/identity/profile-settings-form.tsx`
- Modify: `src/routes/_authenticated/settings/profile.tsx`

The profile page shows: user name (editable), user avatar (uploadable via shared widget, circle variant), user email (read-only display). better-auth's `updateUser` on the client handles name/image updates.

- [ ] **Step 1: Create `src/components/features/identity/profile-settings-form.tsx`**

```tsx
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { ImageUploadField } from '#/components/forms/image-upload-field'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { authClient } from '#/shared/auth/auth-client'

const profileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
})

type FormValues = z.infer<typeof profileSchema>

type Props = Readonly<{
  user: { name: string; email: string; image: string | null }
}>

export function ProfileSettingsForm({ user }: Props) {
  const [imageUrl, setImageUrl] = useState(user.image)
  const [error, setError] = useState<unknown>(null)
  const [isPending, setIsPending] = useState(false)

  const form = useForm({
    defaultValues: { name: user.name } satisfies FormValues,
    validators: { onSubmit: profileSchema },
    onSubmit: async ({ value }) => {
      setIsPending(true)
      setError(null)
      try {
        await authClient.updateUser({ name: value.name })
      } catch (err) {
        setError(err)
      } finally {
        setIsPending(false)
      }
    },
  })

  async function handleAvatarUpload(file: File): Promise<string> {
    // For user avatar, we use better-auth's image update.
    // Upload to a general user-images path, then set the URL.
    // For now, use the org logo upload endpoint as a generic image store.
    // TODO: Consider a dedicated user avatar upload endpoint.
    const { uploadUrl, key } = await fetch('/api/user/avatar-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: file.type, fileSize: file.size }),
    }).then((r) => r.json())

    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })

    const { url } = await fetch('/api/user/avatar-finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }).then((r) => r.json())

    await authClient.updateUser({ image: url })
    return url
  }

  return (
    <div className="space-y-6">
      {/* Avatar */}
      <Card>
        <CardHeader>
          <CardTitle>Avatar</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageUploadField
            imageUrl={imageUrl}
            onImageUrlChange={setImageUrl}
            onUpload={handleAvatarUpload}
            variant="circle"
            emptyLabel="Upload avatar"
          />
        </CardContent>
      </Card>

      {/* Name */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className="space-y-6"
      >
        <FormErrorBanner error={error} />
        <Card>
          <CardHeader>
            <CardTitle>Name</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <form.Field name="name">
                {(field: BaseFieldApi) => (
                  <FormTextField field={field} label="Display name" id="profile-name" />
                )}
              </form.Field>
            </FieldGroup>
          </CardContent>
          <div className="px-6 pb-2">
            <SubmitButton isPending={isPending}>Save name</SubmitButton>
          </div>
        </Card>
      </form>

      {/* Email (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{user.email}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Email changes require verification. Contact support to change your email.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

IMPORTANT NOTE on avatar upload: The `handleAvatarUpload` implementation above uses placeholder API routes. In practice, you have two options:

**Option A (simpler, recommended for now):** Reuse the identity context's `requestOrgLogoUpload`/`finalizeOrgLogoUpload` but store under a user-images path. Create thin wrappers or pass a `pathPrefix` parameter.

**Option B (proper):** Create dedicated `requestUserAvatarUpload`/`finalizeUserAvatarUpload` server functions in a new `src/contexts/identity/server/user.ts` file.

For this plan, use **Option A** — import the existing org logo upload server functions and just call them. The S3 key will be wrong (`organizations/...` instead of `users/...`) but functionally it works. A follow-up task can refactor the key path.

Actually, the simplest correct approach: since better-auth's `updateUser({ image })` accepts any URL, we can just use the org logo upload functions with a note that the key path is temporary. Let me simplify:

```tsx
async function handleAvatarUpload(file: File): Promise<string> {
  // Reuse org logo upload for now — stores in S3 and returns public URL
  // TODO: dedicated user avatar upload with correct S3 key path
  const { requestOrgLogoUpload, finalizeOrgLogoUpload } =
    await import('#/contexts/identity/server/organizations')
  // Dynamic import won't work with server functions — need to pass them as props
  // Instead, the route page should pass the upload functions as props
  throw new Error('Not yet wired — pass upload server fns as props from route')
}
```

Revised approach: The route page wires the server functions and passes them as props to the form. See Step 2.

- [ ] **Step 2: Wire `src/routes/_authenticated/settings/profile.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ProfileSettingsForm } from '#/components/features/identity/profile-settings-form'
import {
  requestOrgLogoUpload,
  finalizeOrgLogoUpload,
} from '#/contexts/identity/server/organizations'
import type { AuthRouteContext } from '#/routes/_authenticated'

export const Route = createFileRoute('/_authenticated/settings/profile')({
  component: ProfileSettingsRoute,
})

function ProfileSettingsRoute() {
  const { user } = Route.useRouteContext() as AuthRouteContext
  const requestUpload = useServerFn(requestOrgLogoUpload)
  const finalizeUpload = useServerFn(finalizeOrgLogoUpload)

  async function handleAvatarUpload(file: File): Promise<string> {
    const { uploadUrl, key } = await requestUpload({
      data: { contentType: file.type, fileSize: file.size },
    })
    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })
    const { logoUrl } = await finalizeUpload({ data: { key } })
    return logoUrl
  }

  return (
    <ProfileSettingsForm
      user={{ name: user.name, email: user.email, image: user.image }}
      onAvatarUpload={handleAvatarUpload}
    />
  )
}
```

Update `ProfileSettingsForm` props to accept `onAvatarUpload: (file: File) => Promise<string>` and use it in the `ImageUploadField`'s `onUpload` prop.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/features/identity/profile-settings-form.tsx src/routes/_authenticated/settings/profile.tsx
git commit -m "feat: add profile settings with avatar upload and name edit"
```

---

### Task 5: Security Settings Page

**Files:**

- Create: `src/components/features/identity/security-settings-form.tsx`
- Modify: `src/routes/_authenticated/settings/security.tsx`

Password change using better-auth's client-side `changePassword`. A disabled "2FA coming soon" card below.

- [ ] **Step 1: Create `src/components/features/identity/security-settings-form.tsx`**

```tsx
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { authClient } from '#/shared/auth/auth-client'
import { Shield } from 'lucide-react'
import { toast } from 'sonner'

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type FormValues = z.infer<typeof passwordSchema>

export function SecuritySettingsForm() {
  const [error, setError] = useState<unknown>(null)
  const [isPending, setIsPending] = useState(false)

  const form = useForm({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    } satisfies FormValues,
    validators: { onSubmit: passwordSchema },
    onSubmit: async ({ value }) => {
      setIsPending(true)
      setError(null)
      try {
        await authClient.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
        })
        toast.success('Password changed successfully')
        form.reset()
      } catch (err) {
        setError(err)
      } finally {
        setIsPending(false)
      }
    },
  })

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className="space-y-6"
      >
        <FormErrorBanner error={error} />
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Update your password to keep your account secure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <form.Field name="currentPassword">
                {(field: BaseFieldApi) => (
                  <FormTextField
                    field={field}
                    label="Current password"
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                  />
                )}
              </form.Field>
              <form.Field name="newPassword">
                {(field: BaseFieldApi) => (
                  <FormTextField
                    field={field}
                    label="New password"
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </form.Field>
              <form.Field name="confirmPassword">
                {(field: BaseFieldApi) => (
                  <FormTextField
                    field={field}
                    label="Confirm new password"
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </form.Field>
            </FieldGroup>
          </CardContent>
          <div className="px-6 pb-2">
            <SubmitButton isPending={isPending}>Update password</SubmitButton>
          </div>
        </Card>
      </form>

      {/* 2FA — coming soon */}
      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-muted-foreground" />
            <CardTitle>Two-factor authentication</CardTitle>
          </div>
          <CardDescription>
            Add an extra layer of security to your account with TOTP-based two-factor
            authentication. Coming soon.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Wire `src/routes/_authenticated/settings/security.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { SecuritySettingsForm } from '#/components/features/identity/security-settings-form'

export const Route = createFileRoute('/_authenticated/settings/security')({
  component: SecuritySettings,
})

function SecuritySettings() {
  return <SecuritySettingsForm />
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/features/identity/security-settings-form.tsx src/routes/_authenticated/settings/security.tsx
git commit -m "feat: add security settings with password change and 2FA placeholder"
```

---

### Task 6: Preferences Settings Page

**Files:**

- Create: `src/components/features/settings/preferences-settings-page.tsx`
- Modify: `src/routes/_authenticated/settings/preferences.tsx`

Theme toggle section using the existing `ThemeToggle` component (embed it in a card with labels). Disabled notifications card below.

- [ ] **Step 1: Create `src/components/features/settings/preferences-settings-page.tsx`**

```tsx
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import { ThemeToggle } from '#/components/layout/theme-toggle'
import { Bell } from 'lucide-react'

export function PreferencesSettingsPage() {
  return (
    <div className="space-y-6">
      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize how the app looks on your device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="theme-toggle">Theme</Label>
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>

      {/* Notifications — coming soon */}
      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" />
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>
            Manage email and in-app notification preferences. Coming soon.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Wire `src/routes/_authenticated/settings/preferences.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { PreferencesSettingsPage } from '#/components/features/settings/preferences-settings-page'

export const Route = createFileRoute('/_authenticated/settings/preferences')({
  component: PreferencesSettings,
})

function PreferencesSettings() {
  return <PreferencesSettingsPage />
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/features/settings/preferences-settings-page.tsx src/routes/_authenticated/settings/preferences.tsx
git commit -m "feat: add preferences settings with theme toggle and notifications placeholder"
```

---

### Task 7: Manager Sidebar Refactor

**Files:**

- Modify: `src/components/layout/manager-sidebar.tsx`

Remove the org switcher dropdown and `CreateOrganizationDialog` from the sidebar header. Replace with a property switcher that is always visible (not just when >1 property). The property switcher dropdown includes: list of properties, "View all properties" link, "Create new property" link.

- [ ] **Step 1: Refactor `manager-sidebar.tsx`**

Key changes:

1. Remove the `CreateOrganizationDialog` import and state
2. Remove the org dropdown from `SidebarHeader`
3. Replace the entire `SidebarHeader` with a property switcher dropdown that:
   - Shows current property name prominently (or "Select property" if none)
   - Is always visible (not gated by `properties.length > 1`)
   - Contains: list of all properties, separator, "View all properties" link to `/properties`, "Create new property" link to `/properties/new`
4. The property icon in the header should be the first letter of the property name (not `Building2`), to distinguish from the org icon
5. Remove the `organizations` and `activeOrganization` props if no longer needed in this component (they're still needed by `StaffSidebar` and the settings page)

Updated `SidebarHeader`:

```tsx
<SidebarHeader>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted">
              <span className="text-xs font-bold">
                {activeProperty?.name?.charAt(0)?.toUpperCase() ?? (
                  <Building2 className="size-4" />
                )}
              </span>
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">
                {activeProperty?.name ?? 'Select property'}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {properties.length} {properties.length === 1 ? 'property' : 'properties'}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="w-64">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Properties
          </div>
          <DropdownMenuSeparator />
          {properties.map((prop) => (
            <DropdownMenuItem key={prop.id} onClick={() => handlePropertySwitch(prop.id)}>
              {prop.name}
              {prop.id === propertyId && (
                <span className="ml-auto text-xs text-muted-foreground">Active</span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/properties">
              <Building2 className="size-4 mr-2" />
              View all properties
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/properties/new">
              <Plus className="size-4 mr-2" />
              Create new property
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</SidebarHeader>
```

Remove:

- The separate property switcher that was only shown when `properties.length > 1`
- The `createOrgOpen` state and `CreateOrganizationDialog` render
- The `organizations`, `activeOrganization`, `setActiveOrganization` props (keep only what's needed)
- The `handleOrgSwitch` function

Update the Props type to remove org-related props (they're still passed by `_authenticated.tsx` but the sidebar doesn't need them). The `_authenticated.tsx` layout can keep passing them for the staff sidebar and settings — the manager sidebar just won't use them.

Actually, simpler: keep the props but don't render the org switcher. This avoids changing `_authenticated.tsx`. Just don't destructure the org-related props.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/manager-sidebar.tsx
git commit -m "refactor: replace org switcher with property switcher in manager sidebar"
```

---

### Task 8: Update Settings Sidebar Navigation

**Files:**

- Modify: `src/components/layout/settings-sidebar.tsx`

The settings sidebar currently has Profile, Security, Preferences, Organization. After the sidebar refactor (org switcher removed from main sidebar), the settings sidebar should also include a way to switch organizations. However, we already handled this in the Organization settings page with the `OrganizationSwitchList`.

No changes needed to the settings sidebar itself — the org switching is embedded in the Organization settings page, which is the correct UX pattern (infrequent action, behind a permission gate).

But we should verify the "Back to app" link still works correctly after removing the org switcher from the main sidebar. Currently it links to `/properties` for managers and `/` for staff. This is still correct.

- [ ] **Step 1: Verify settings sidebar "Back to app" link**

Read `src/components/layout/settings-sidebar.tsx` and confirm the back link goes to `/properties` for PropertyManager role. No changes expected.

- [ ] **Step 2: Commit if any changes were needed**

```bash
git add src/components/layout/settings-sidebar.tsx
git commit -m "fix: verify settings sidebar back navigation after org switcher removal"
```

---

### Task 9: Final Build Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 3: Run dev server and manually verify all settings pages**

Run: `pnpm dev`

Verify:

1. `/settings/profile` — shows avatar upload, name field, read-only email
2. `/settings/security` — shows password change form, disabled 2FA card
3. `/settings/preferences` — shows theme toggle, disabled notifications card
4. `/settings/organization` — shows logo banner, identity/billing cards, org switch list (if >1 org)
5. Manager sidebar shows property switcher in header, not org switcher
6. Property switcher always visible, has "View all" and "Create new" links
7. Portal edit form still works (image upload refactored to shared widget)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final build verification for settings gap fill"
```
