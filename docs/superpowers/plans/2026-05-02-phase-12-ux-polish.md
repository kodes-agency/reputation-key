# Phase 12 — UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish 8 UX items — org extended fields + settings, timezone combobox, guest URL restructure, portal archival toggle, client-side QR, URL overflow fix, property switcher always-visible with creation shortcut, create-organization dialog in sidebar.

**Architecture:** Extend Better Auth `additionalFields` for org billing fields (not raw Drizzle). Guest URL changes from `/p/{orgSlug}/{portalSlug}` to `/p/{propertySlug}/{portalSlug}` with property-slug-based lookup. QR generation moves client-side via `qrcode` package. Portal archival reuses existing `isActive` boolean with two-state Switch toggle.

**Tech Stack:** TanStack Start (server functions + file routes), Better Auth (organization plugin + additionalFields), Drizzle ORM, shadcn/ui (Command, Switch), qrcode (client-side), Zod v4, TanStack Form.

---

## File Structure

### Files to Create

| File                                                                | Responsibility                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/components/features/organization/OrganizationSettingsForm.tsx` | Form for editing org name, slug, logo, contact, billing fields  |
| `src/components/features/property/TimezoneCombobox.tsx`             | Searchable timezone picker with UTC offset labels using Command |
| `src/components/features/organization/CreateOrganizationDialog.tsx` | Dialog for creating new org (name + slug), used in AppSidebar   |
| `src/components/guest/portal-unavailable.tsx`                       | Guest-facing "portal unavailable" message for inactive portals  |

### Files to Modify

| File                                                                         | Changes                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/shared/auth/auth.ts`                                                    | Add `organization.additionalFields` for contactEmail + billing fields                |
| `src/contexts/identity/server/organizations.ts`                              | Update `AuthOrganizationResponse` type + add `updateOrganization` server fn          |
| `src/routes/_authenticated/properties/$propertyId/settings/organization.tsx` | Replace placeholder with `OrganizationSettingsForm`                                  |
| `src/components/features/property/CreatePropertyForm.tsx`                    | Swap `TimezoneSelect` for `TimezoneCombobox`                                         |
| `src/components/features/portal/QRCodeModal.tsx`                             | Client-side QR via `qrcode.toDataURL`, path-only URL, Tooltip for full URL           |
| `src/components/features/portal/ShareSection.tsx`                            | Change `organizationSlug` prop to `propertySlug`                                     |
| `src/components/features/portal/PortalDetailPage.tsx`                        | Add active/inactive Switch toggle, pass `propertySlug` instead of `organizationSlug` |
| `src/components/layout/AppTopBar.tsx`                                        | Always show property dropdown (even 1 property), add "Add Property" item             |
| `src/components/layout/AppSidebar.tsx`                                       | Add "Create Organization" item + `CreateOrganizationDialog` in org switcher dropdown |
| `src/contexts/guest/server/public.ts`                                        | Change lookup from orgSlug to propertySlug, check `isActive`                         |
| `src/contexts/guest/domain/errors.ts`                                        | Add `portal_inactive` error code                                                     |
| `src/routes/p/$orgSlug/$portalSlug.tsx`                                      | Rename file to `$propertySlug`, update params, handle inactive portals               |
| `src/routes/api/portals/$id/qr.ts`                                           | Remove server-side QR generation (keep only for PNG download fallback)               |
| `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`     | Pass `propertySlug` to `PortalDetailPage` instead of `organizationSlug`              |
| `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`         | Use `propertySlug` in URL display, dim inactive portal rows                          |

---

## Task 1: Extend Organization with Billing Fields (Backend)

**Files:**

- Modify: `src/shared/auth/auth.ts:92-102`
- Modify: `src/contexts/identity/server/organizations.ts:74-80, 87-110`

- [ ] **Step 1: Add organization additionalFields to auth.ts**

In `src/shared/auth/auth.ts`, inside the `organization({ ... })` plugin config, add `organization.additionalFields` alongside the existing `invitation.additionalFields`. The schema object currently has only `invitation` — add an `organization` key:

```typescript
// Inside organization({ ... }), at the schema property (line 92):
schema: {
  invitation: {
    additionalFields: {
      propertyIds: {
        type: 'string' as const,
        input: true,
        required: false,
      },
    },
  },
  organization: {
    additionalFields: {
      contactEmail: {
        type: 'string' as const,
        input: true,
        required: false,
      },
      billingCompanyName: {
        type: 'string' as const,
        input: true,
        required: false,
      },
      billingAddress: {
        type: 'string' as const,
        input: true,
        required: false,
      },
      billingCity: {
        type: 'string' as const,
        input: true,
        required: false,
      },
      billingPostalCode: {
        type: 'string' as const,
        input: true,
        required: false,
      },
      billingCountry: {
        type: 'string' as const,
        input: true,
        required: false,
      },
    },
  },
},
```

- [ ] **Step 2: Run Better Auth migration**

Run: `pnpm auth:generate`
Expected: New migration file generated with columns for `contact_email`, `billing_company_name`, `billing_address`, `billing_city`, `billing_postal_code`, `billing_country` on the `organization` table.

Then run: `pnpm auth:migrate`
Expected: Migration applied successfully.

- [ ] **Step 3: Update AuthOrganizationResponse type**

In `src/contexts/identity/server/organizations.ts`, update the `AuthOrganizationResponse` type (line 74) to include the new fields:

```typescript
type AuthOrganizationResponse = Readonly<{
  id: string
  name: string
  slug: string
  logo: string | null
  createdAt: Date
  contactEmail: string | null
  billingCompanyName: string | null
  billingAddress: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
}>
```

- [ ] **Step 4: Update getActiveOrganization return**

In the same file, update the `getActiveOrganization` handler (line 99) to include the new fields in the return:

```typescript
return {
  organization: {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logo: org.logo ?? null,
    createdAt: org.createdAt,
    contactEmail:
      ((org as Record<string, unknown>).contactEmail as string | null) ?? null,
    billingCompanyName:
      ((org as Record<string, unknown>).billingCompanyName as string | null) ?? null,
    billingAddress:
      ((org as Record<string, unknown>).billingAddress as string | null) ?? null,
    billingCity: ((org as Record<string, unknown>).billingCity as string | null) ?? null,
    billingPostalCode:
      ((org as Record<string, unknown>).billingPostalCode as string | null) ?? null,
    billingCountry:
      ((org as Record<string, unknown>).billingCountry as string | null) ?? null,
  },
  role: ctx.role,
}
```

Note: Better Auth returns additionalFields on the org object, but they're not typed. Cast via `Record<string, unknown>`.

- [ ] **Step 5: Update listUserOrganizations return**

In the same file, update the `listUserOrganizations` handler (line 318) to include the new fields:

```typescript
const organizations = rawOrgs.map((org) => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
  logo: org.logo ?? null,
  createdAt: org.createdAt,
  contactEmail: ((org as Record<string, unknown>).contactEmail as string | null) ?? null,
  billingCompanyName:
    ((org as Record<string, unknown>).billingCompanyName as string | null) ?? null,
  billingAddress:
    ((org as Record<string, unknown>).billingAddress as string | null) ?? null,
  billingCity: ((org as Record<string, unknown>).billingCity as string | null) ?? null,
  billingPostalCode:
    ((org as Record<string, unknown>).billingPostalCode as string | null) ?? null,
  billingCountry:
    ((org as Record<string, unknown>).billingCountry as string | null) ?? null,
}))
```

- [ ] **Step 6: Add updateOrganization server function**

Add at the end of `src/contexts/identity/server/organizations.ts` (before the final line), a new server function:

```typescript
import { z } from 'zod/v4'

const updateOrganizationInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(64).optional(),
  logo: z.string().max(500).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  billingCompanyName: z.string().max(200).nullable().optional(),
  billingAddress: z.string().max(300).nullable().optional(),
  billingCity: z.string().max(100).nullable().optional(),
  billingPostalCode: z.string().max(20).nullable().optional(),
  billingCountry: z.string().max(100).nullable().optional(),
})

export const updateOrganization = createServerFn({ method: 'POST' })
  .inputValidator(updateOrganizationInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)
    const auth = getAuth()

    // Only owner/admin can update organization
    if (ctx.role !== 'Owner' && ctx.role !== 'PropertyManager') {
      throwContextError(
        'IdentityError',
        { code: 'forbidden', message: 'Insufficient permissions' },
        403,
      )
    }

    const org = await auth.api.getFullOrganization({ headers })
    if (!org) {
      throwContextError(
        'IdentityError',
        { code: 'org_setup_failed', message: 'No active organization' },
        409,
      )
    }

    await auth.api.updateOrganization({
      headers,
      body: {
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.slug !== undefined ? { slug: data.slug } : {}),
          ...(data.logo !== undefined ? { logo: data.logo } : {}),
          ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail } : {}),
          ...(data.billingCompanyName !== undefined
            ? { billingCompanyName: data.billingCompanyName }
            : {}),
          ...(data.billingAddress !== undefined
            ? { billingAddress: data.billingAddress }
            : {}),
          ...(data.billingCity !== undefined ? { billingCity: data.billingCity } : {}),
          ...(data.billingPostalCode !== undefined
            ? { billingPostalCode: data.billingPostalCode }
            : {}),
          ...(data.billingCountry !== undefined
            ? { billingCountry: data.billingCountry }
            : {}),
        },
      },
    })
  })
```

- [ ] **Step 7: Update \_authenticated.tsx context type**

In `src/routes/_authenticated.tsx`, update `AuthRouteContext` (line 16) to carry the new org fields:

```typescript
export type AuthRouteContext = Readonly<{
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
  role: Role
  activeOrganization: {
    id: string
    name: string
    slug: string
    contactEmail: string | null
    billingCompanyName: string | null
    billingAddress: string | null
    billingCity: string | null
    billingPostalCode: string | null
    billingCountry: string | null
  } | null
}>
```

Update the `beforeLoad` handler (line 45) to pass the new fields:

```typescript
if (org.organization) {
  activeOrganization = {
    id: org.organization.id,
    name: org.organization.name,
    slug: org.organization.slug,
    contactEmail: org.organization.contactEmail ?? null,
    billingCompanyName: org.organization.billingCompanyName ?? null,
    billingAddress: org.organization.billingAddress ?? null,
    billingCity: org.organization.billingCity ?? null,
    billingPostalCode: org.organization.billingPostalCode ?? null,
    billingCountry: org.organization.billingCountry ?? null,
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add src/shared/auth/auth.ts src/contexts/identity/server/organizations.ts src/routes/_authenticated.tsx
git commit -m "feat: extend organization with billing fields via better-auth additionalFields"
```

---

## Task 2: Organization Settings Form

**Files:**

- Create: `src/components/features/organization/OrganizationSettingsForm.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/settings/organization.tsx`

- [ ] **Step 1: Create OrganizationSettingsForm component**

Create `src/components/features/organization/OrganizationSettingsForm.tsx`:

```tsx
import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { FormTextField } from '#/components/forms/FormTextField'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import { AlertTriangle } from 'lucide-react'

const orgSettingsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().min(1, 'Slug is required').max(64),
  logo: z.string().max(500).nullable(),
  contactEmail: z.string().email('Invalid email').nullable(),
  billingCompanyName: z.string().max(200).nullable(),
  billingAddress: z.string().max(300).nullable(),
  billingCity: z.string().max(100).nullable(),
  billingPostalCode: z.string().max(20).nullable(),
  billingCountry: z.string().max(100).nullable(),
})

type FormValues = z.infer<typeof orgSettingsSchema>

type OrganizationSettingsFormProps = Readonly<{
  organization: {
    name: string
    slug: string
    logo: string | null
    contactEmail: string | null
    billingCompanyName: string | null
    billingAddress: string | null
    billingCity: string | null
    billingPostalCode: string | null
    billingCountry: string | null
  }
  onSubmit: (values: FormValues) => Promise<void>
  isPending: boolean
  error: string | null
}>

export function OrganizationSettingsForm({
  organization,
  onSubmit,
  isPending,
  error,
}: OrganizationSettingsFormProps) {
  const form = useForm<FormValues>({
    defaultValues: {
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo ?? '',
      contactEmail: organization.contactEmail ?? '',
      billingCompanyName: organization.billingCompanyName ?? '',
      billingAddress: organization.billingAddress ?? '',
      billingCity: organization.billingCity ?? '',
      billingPostalCode: organization.billingPostalCode ?? '',
      billingCountry: organization.billingCountry ?? '',
    },
    validators: {
      onChange: orgSettingsSchema,
    },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="space-y-6"
    >
      <FormErrorBanner error={error} />

      {/* Identity */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Identity
        </h3>
        <FieldGroup>
          <form.Field name="name">
            {(field) => (
              <FormTextField
                field={field as BaseFieldApi}
                label="Organization Name"
                id="org-name"
                placeholder="Acme Hotels"
              />
            )}
          </form.Field>
          <form.Field name="slug">
            {(field) => (
              <>
                <FormTextField
                  field={field as BaseFieldApi}
                  label="Slug"
                  id="org-slug"
                  placeholder="acme-hotels"
                />
                {field.state.value !== organization.slug && (
                  <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-600 dark:text-yellow-400">
                    <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                    <span>
                      Changing the slug will break any existing guest portal URLs that
                      reference this organization.
                    </span>
                  </div>
                )}
              </>
            )}
          </form.Field>
          <form.Field name="logo">
            {(field) => (
              <FormTextField
                field={field as BaseFieldApi}
                label="Logo URL"
                id="org-logo"
                placeholder="https://..."
              />
            )}
          </form.Field>
          <form.Field name="contactEmail">
            {(field) => (
              <FormTextField
                field={field as BaseFieldApi}
                label="Contact Email"
                id="org-contact-email"
                placeholder="contact@acme.com"
                type="email"
              />
            )}
          </form.Field>
        </FieldGroup>
      </section>

      {/* Billing */}
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Billing
        </h3>
        <FieldGroup>
          <form.Field name="billingCompanyName">
            {(field) => (
              <FormTextField
                field={field as BaseFieldApi}
                label="Company Name"
                id="org-billing-company"
                placeholder="Acme Hotels Ltd."
              />
            )}
          </form.Field>
          <form.Field name="billingAddress">
            {(field) => (
              <FormTextField
                field={field as BaseFieldApi}
                label="Address"
                id="org-billing-address"
                placeholder="123 Main St"
              />
            )}
          </form.Field>
          <div className="grid grid-cols-2 gap-4">
            <form.Field name="billingCity">
              {(field) => (
                <FormTextField
                  field={field as BaseFieldApi}
                  label="City"
                  id="org-billing-city"
                  placeholder="New York"
                />
              )}
            </form.Field>
            <form.Field name="billingPostalCode">
              {(field) => (
                <FormTextField
                  field={field as BaseFieldApi}
                  label="Postal Code"
                  id="org-billing-postal"
                  placeholder="10001"
                />
              )}
            </form.Field>
          </div>
          <form.Field name="billingCountry">
            {(field) => (
              <FormTextField
                field={field as BaseFieldApi}
                label="Country"
                id="org-billing-country"
                placeholder="United States"
              />
            )}
          </form.Field>
        </FieldGroup>
      </section>

      <SubmitButton isPending={isPending}>Save Changes</SubmitButton>
    </form>
  )
}
```

- [ ] **Step 2: Replace org settings route placeholder**

Replace the entire contents of `src/routes/_authenticated/properties/$propertyId/settings/organization.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { updateOrganization } from '#/contexts/identity/server/organizations'
import { OrganizationSettingsForm } from '#/components/features/organization/OrganizationSettingsForm'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { useRouter } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/organization',
)({
  component: OrganizationSettingsPage,
})

function OrganizationSettingsPage() {
  const ctx = Route.useRouteContext()
  const router = useRouter()

  const mutation = useMutationAction(updateOrganization, {
    successMessage: 'Organization updated',
    onSuccess: () => {
      router.invalidate()
    },
  })

  if (!ctx.activeOrganization) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-sm text-muted-foreground">No active organization.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Organization Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your organization identity and billing information.
        </p>
      </div>

      <div className="rounded-lg border p-6">
        <OrganizationSettingsForm
          organization={ctx.activeOrganization}
          onSubmit={(values) =>
            mutation.mutate({
              data: {
                name: values.name,
                slug: values.slug,
                logo: values.logo || null,
                contactEmail: values.contactEmail || null,
                billingCompanyName: values.billingCompanyName || null,
                billingAddress: values.billingAddress || null,
                billingCity: values.billingCity || null,
                billingPostalCode: values.billingPostalCode || null,
                billingCountry: values.billingCountry || null,
              },
            })
          }
          isPending={mutation.isPending}
          error={mutation.error ? String(mutation.error) : null}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build compiles**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/features/organization/OrganizationSettingsForm.tsx src/routes/_authenticated/properties/$propertyId/settings/organization.tsx
git commit -m "feat: organization settings form with identity and billing fields"
```

---

## Task 3: Timezone Combobox

**Files:**

- Create: `src/components/features/property/TimezoneCombobox.tsx`
- Modify: `src/components/features/property/CreatePropertyForm.tsx`
- Modify: `src/shared/domain/timezones.ts`

- [ ] **Step 1: Install shadcn command component**

Run: `npx shadcn@latest add command`
Expected: `src/components/ui/command.tsx` created.

- [ ] **Step 2: Add UTC offset data to timezones.ts**

In `src/shared/domain/timezones.ts`, add a helper that computes UTC offset labels at the end of the file:

```typescript
/**
 * Returns a human-readable UTC offset string for a given IANA timezone.
 * Uses the Intl API to compute the offset for the current date.
 */
export function getTimezoneOffsetLabel(tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    })
    const parts = formatter.formatToParts(new Date())
    const offsetPart = parts.find((p) => p.type === 'timeZoneName')
    return offsetPart?.value ?? tz
  } catch {
    return tz
  }
}
```

- [ ] **Step 3: Create TimezoneCombobox component**

Create `src/components/features/property/TimezoneCombobox.tsx`:

```tsx
import { useState, useMemo } from 'react'
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '#/shared/lib/utils'
import { VALID_TIMEZONES, getTimezoneOffsetLabel } from '#/shared/domain/timezones'
import type { BaseFieldApi } from '#/components/forms/FormTextField'

type Props = Readonly<{
  field: BaseFieldApi
  label: string
  id: string
}>

export function TimezoneCombobox({ field, label, id }: Props) {
  const [open, setOpen] = useState(false)
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  const timezoneOptions = useMemo(
    () =>
      VALID_TIMEZONES.map((tz) => ({
        value: tz,
        label: `${tz} (${getTimezoneOffsetLabel(tz)})`,
      })),
    [],
  )

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-invalid={isInvalid}
            onBlur={field.handleBlur}
            className="flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={cn('truncate', !field.state.value && 'text-muted-foreground')}
            >
              {field.state.value
                ? `${field.state.value} (${getTimezoneOffsetLabel(field.state.value)})`
                : 'Search timezone...'}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search timezone..." />
            <CommandList>
              <CommandEmpty>No timezone found.</CommandEmpty>
              <CommandGroup>
                {timezoneOptions.map((tz) => (
                  <CommandItem
                    key={tz.value}
                    value={tz.value}
                    onSelect={() => {
                      field.handleChange(tz.value)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        field.state.value === tz.value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {tz.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}
```

- [ ] **Step 4: Swap TimezoneSelect for TimezoneCombobox in CreatePropertyForm**

In `src/components/features/property/CreatePropertyForm.tsx`:

Replace the import:

```typescript
// OLD:
import { TimezoneSelect } from './TimezoneSelect'
// NEW:
import { TimezoneCombobox } from './TimezoneCombobox'
```

Replace usage in the JSX (find `<TimezoneSelect` and replace with `<TimezoneCombobox`):

```tsx
<TimezoneCombobox field={field as BaseFieldApi} label="Timezone" id="timezone" />
```

- [ ] **Step 5: Verify build compiles**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/property/TimezoneCombobox.tsx src/components/features/property/CreatePropertyForm.tsx src/shared/domain/timezones.ts src/components/ui/command.tsx
git commit -m "feat: timezone combobox with searchable UTC offset labels"
```

---

## Task 4: Guest URL — Property-First Restructure

**Files:**

- Rename: `src/routes/p/$orgSlug/$portalSlug.tsx` → `src/routes/p/$propertySlug/$portalSlug.tsx`
- Modify: `src/contexts/guest/server/public.ts`
- Modify: `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`
- Modify: `src/components/features/portal/PortalDetailPage.tsx`
- Modify: `src/components/features/portal/ShareSection.tsx`
- Modify: `src/components/features/portal/QRCodeModal.tsx`

This task is the most cross-cutting. All components that reference `organizationSlug` in URLs must switch to `propertySlug`.

- [ ] **Step 1: Update guest server function to use propertySlug**

In `src/contexts/guest/server/public.ts`, update `getPublicPortal`:

Replace the schema (line 21):

```typescript
const publicPortalSchema = z.object({
  propertySlug: z.string().min(1),
  portalSlug: z.string().min(1),
})
```

Replace the query logic inside the handler (line 35-66). Instead of looking up org by slug, look up the property by slug, then join to portals:

```typescript
.handler(async ({ data }) => {
  const { db } = getContainer()
  const { portals, portalLinkCategories, portalLinks } =
    await import('#/shared/db/schema/portal.schema')
  const { properties } = await import('#/shared/db/schema/property.schema')
  const { eq, and } = await import('drizzle-orm')
  const { sql } = await import('drizzle-orm')

  // Find portal by property slug + portal slug
  const portalRows = await db
    .select({
      portal: portals,
      propertyName: properties.name,
    })
    .from(portals)
    .innerJoin(properties, eq(portals.propertyId, properties.id))
    .where(
      and(
        eq(properties.slug, data.propertySlug),
        eq(portals.slug, data.portalSlug),
      ),
    )
    .limit(1)

  if (portalRows.length === 0) {
    throw guestError('portal_not_found', 'Portal not found')
  }

  const { portal, propertyName } = portalRows[0]

  // Check if portal is active
  if (!portal.isActive) {
    throw guestError('portal_inactive', 'This portal is currently unavailable')
  }

  // Load link categories and links
  const categories = await db
    .select()
    .from(portalLinkCategories)
    .where(eq(portalLinkCategories.portalId, portal.id))
    .orderBy(portalLinkCategories.sortKey)

  const links = await db
    .select()
    .from(portalLinks)
    .where(eq(portalLinks.portalId, portal.id))
    .orderBy(portalLinks.sortKey)

  // Get org name via raw query (for display)
  const orgResult = await db.execute(
    sql`SELECT name FROM "organization" WHERE id = ${portal.organizationId} LIMIT 1`,
  )
  const org = orgResult.rows[0] as { name: string } | undefined

  return {
    portal: {
      id: portal.id,
      name: portal.name,
      slug: portal.slug,
      description: portal.description,
      heroImageUrl: portal.heroImageUrl,
      theme: portal.theme as Record<string, string | number | boolean | null> | null,
      smartRoutingEnabled: portal.smartRoutingEnabled,
      smartRoutingThreshold: portal.smartRoutingThreshold,
      organizationName: org?.name ?? propertyName,
    },
    categories,
    links,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
  }
})
```

- [ ] **Step 2: Add portal_inactive error code**

In `src/contexts/guest/domain/errors.ts`, add `'portal_inactive'` to `GuestErrorCode`:

```typescript
export type GuestErrorCode =
  | 'invalid_rating'
  | 'duplicate_rating'
  | 'feedback_too_long'
  | 'feedback_empty'
  | 'portal_not_found'
  | 'portal_inactive'
  | 'rate_limit_exceeded'
  | 'invalid_source'
  | 'invalid_session'
```

- [ ] **Step 3: Rename guest route file**

```bash
mv src/routes/p/\$orgSlug/\$portalSlug.tsx src/routes/p/\$propertySlug/\$portalSlug.tsx
rmdir src/routes/p/\$orgSlug
```

Then update the renamed file's content. Replace the entire content of `src/routes/p/$propertySlug/$portalSlug.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { getPublicPortal } from '#/contexts/guest/server/public'
import { PortalNotFound } from '#/components/guest/portal-not-found'
import { PortalUnavailable } from '#/components/guest/portal-unavailable'
import { PublicPortalContent } from '#/components/guest/PublicPortalContent'
import { CookieConsentBanner } from '#/components/guest/cookie-consent-banner'
import type { PublicPortalLoaderData } from '#/contexts/guest/application/dto/public-portal.dto'
import { isGuestError } from '#/contexts/guest/domain/errors'

const VALID_SOURCES: ReadonlySet<string> = new Set(['qr', 'nfc', 'direct'])
type ScanSource = 'qr' | 'nfc' | 'direct'

function parseSource(raw: string | null): ScanSource {
  return raw && VALID_SOURCES.has(raw) ? (raw as ScanSource) : 'direct'
}

export const Route = createFileRoute('/p/$propertySlug/$portalSlug')({
  validateSearch: (search: Record<string, string>) => ({
    source: search.source,
  }),
  loader: async ({ params }): Promise<PublicPortalLoaderData | null> => {
    try {
      const portalData = await getPublicPortal({
        data: {
          propertySlug: params.propertySlug,
          portalSlug: params.portalSlug,
        },
      })
      return portalData
    } catch (e) {
      // Distinguish "inactive" from "not found"
      if (isGuestError(e) && e.code === 'portal_inactive') {
        return null // Will show unavailable state
      }
      return null
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Portal Not Found' }] }
    return {
      meta: [
        { title: `${loaderData.portal.name} — ${loaderData.portal.organizationName}` },
        { name: 'description', content: loaderData.portal.description ?? '' },
        { property: 'og:title', content: loaderData.portal.name },
        { property: 'og:description', content: loaderData.portal.description ?? '' },
      ],
    }
  },
  component: PublicPortalPage,
})

function PublicPortalPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const source = parseSource(search.source ?? null)

  useEffect(() => {
    if (!document.cookie.includes('guest_session')) {
      const sessionId = crypto.randomUUID()
      document.cookie = `guest_session=${sessionId}; path=/p/; max-age=86400; SameSite=Lax`
    }
  }, [])

  if (!data) {
    return <PortalUnavailable />
  }

  const { portal, categories, links } = data

  return (
    <>
      <CookieConsentBanner />
      <PublicPortalContent
        portal={portal}
        categories={categories}
        links={links}
        source={source}
      />
    </>
  )
}
```

- [ ] **Step 4: Create PortalUnavailable component**

Create `src/components/guest/portal-unavailable.tsx`:

```tsx
import { Globe } from 'lucide-react'

export function PortalUnavailable() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center px-6">
        <div className="flex size-16 items-center justify-center rounded-full bg-muted">
          <Globe className="size-7 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold">Portal Unavailable</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This portal is currently unavailable. Please try again later.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Update PortalDetailPage — replace organizationSlug with propertySlug**

In `src/components/features/portal/PortalDetailPage.tsx`:

1. In the `PortalDetailPageProps` type (line 64), replace `organizationSlug: string` with `propertySlug: string`.

2. In the destructured props (line 98), replace `organizationSlug` with `propertySlug`.

3. In the `previewPortal` object (line 279), keep `organizationName` as-is.

4. In the `<ShareSection>` call (line 461), change:

```tsx
<ShareSection portalId={portal.id} portalSlug={portal.slug} propertySlug={propertySlug} />
```

- [ ] **Step 6: Update ShareSection — organizationSlug → propertySlug**

In `src/components/features/portal/ShareSection.tsx`:

1. Change `organizationSlug` prop to `propertySlug` in the type and destructuring:

```tsx
type ShareSectionProps = Readonly<{
  portalId: string
  portalSlug: string
  propertySlug: string
}>

export function ShareSection({ portalId, portalSlug, propertySlug }: ShareSectionProps) {
```

2. Update the URL construction:

```tsx
const guestUrl = `/p/${propertySlug}/${portalSlug}`
```

3. Update the `<QRCodeModal>` call to pass `propertySlug`:

```tsx
<QRCodeModal
  open={qrOpen}
  onOpenChange={setQrOpen}
  portalId={portalId}
  portalSlug={portalSlug}
  propertySlug={propertySlug}
/>
```

- [ ] **Step 7: Update QRCodeModal — organizationSlug → propertySlug, client-side QR**

Replace the entire content of `src/components/features/portal/QRCodeModal.tsx`:

```tsx
import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Copy, Download } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'

type QRCodeModalProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portalId: string
  portalSlug: string
  propertySlug: string
}>

export function QRCodeModal({
  open,
  onOpenChange,
  portalId,
  portalSlug,
  propertySlug,
}: QRCodeModalProps) {
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  const urlPath = `/p/${propertySlug}/${portalSlug}?source=qr`

  const getFullUrl = () =>
    typeof window !== 'undefined' ? `${window.location.origin}${urlPath}` : ''

  useEffect(() => {
    if (open) {
      QRCode.toDataURL(getFullUrl(), {
        width: 256,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null))
    }
  }, [open, urlPath])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getFullUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleDownload = () => {
    if (!qrDataUrl) return
    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = `qr-${portalSlug}.png`
    link.click()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>QR Code</DialogTitle>
          <DialogDescription>Scan this code to open the guest portal.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR code for ${portalSlug}`}
              className="w-64 h-64 rounded-lg border"
            />
          ) : (
            <div className="w-64 h-64 rounded-lg border bg-muted animate-pulse" />
          )}

          <div className="flex items-center gap-2 w-full px-4">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-md truncate cursor-default">
                    {urlPath}
                  </code>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">{getFullUrl()}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="size-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <Button
            variant="outline"
            onClick={handleDownload}
            className="w-full max-w-xs"
            disabled={!qrDataUrl}
          >
            <Download className="size-3.5 mr-2" />
            Download PNG
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 8: Update portal detail route — pass propertySlug**

In `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`, update the `PortalDetailPage` call (line 53):

The loader already returns `propertyId: params.propertyId`. We need to also pass the property's slug. Update the loader to fetch the property slug:

```tsx
loader: async ({ params }) => {
  const [{ portal }, { categories, links }] = await Promise.all([
    getPortal({ data: { portalId: params.portalId } }),
    listPortalLinks({ data: { portalId: params.portalId } }),
  ])
  return {
    portal,
    categories: categories.map((c: { id: string; title: string; sortKey: string }) => ({
      id: c.id,
      title: c.title,
      sortKey: c.sortKey,
    })),
    links: links.map(
      (l: {
        id: string
        label: string
        url: string
        sortKey: string
        categoryId: string
      }) => ({
        id: l.id,
        label: l.label,
        url: l.url,
        sortKey: l.sortKey,
        categoryId: l.categoryId,
      }),
    ),
    propertyId: params.propertyId,
  }
},
```

In the component, replace `organizationSlug` with a propertySlug. We need to get the property slug from the context. Update the component:

```tsx
function PortalDetailRoute() {
  const { portal, categories, links, propertyId } = Route.useLoaderData()
  const ctx = Route.useRouteContext()

  const mutation = useMutationAction(updatePortal, {
    successMessage: 'Portal updated',
  })

  // Get property slug from the authenticated layout's loaded properties
  const { properties } = Route.useLoaderData({ strict: false })
  const propertySlug =
    (properties as Array<{ id: string; slug: string }>)?.find((p) => p.id === propertyId)
      ?.slug ?? ''

  return (
    <PortalDetailPage
      portal={portal}
      propertyId={propertyId}
      categories={categories}
      links={links}
      updateMutation={mutation}
      organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
      propertySlug={propertySlug}
    />
  )
}
```

Note: The `properties` list is loaded in the `_authenticated.tsx` layout loader. Access it via the parent route's loader data. If `useLoaderData({ strict: false })` doesn't work, we need to load the property slug from the context differently. An alternative approach is to include the property slug in the portal data returned from `getPortal`, or look it up from `ctx.activeOrganization`.

**Simpler alternative:** Since each property has a slug and the `getPortal` server function returns `portal.propertyId`, add a `propertySlug` field to the portal route loader by querying the property. Or even simpler — since the `_authenticated` layout loads all properties, pass the slug through route context:

In `src/routes/_authenticated.tsx`, the `loader` already returns `properties`. The portal route can access it via `Route.useLoaderData({ strict: false })` from the parent.

Actually, the most reliable approach: add the property slug to the `getPortal` server function return. Check if `getPortal` already returns it.

If `getPortal` returns `propertyId` but not `propertySlug`, we need to either:

- Extend `getPortal` to include `propertySlug` (requires a JOIN)
- Or load the property in the route loader

The cleanest approach: load the property slug in the route loader:

```tsx
loader: async ({ params }) => {
  const [{ portal }, { categories, links }] = await Promise.all([
    getPortal({ data: { portalId: params.portalId } }),
    listPortalLinks({ data: { portalId: params.portalId } }),
  ])
  // Look up property slug
  const { db } = await import('#/composition').then(m => ({ db: m.getContainer().db }))
  const { properties } = await import('#/shared/db/schema/property.schema')
  const { eq } = await import('drizzle-orm')
  const propRows = await db.select({ slug: properties.slug }).from(properties).where(eq(properties.id, params.propertyId)).limit(1)

  return {
    portal,
    categories: categories.map((c: { id: string; title: string; sortKey: string }) => ({
      id: c.id,
      title: c.title,
      sortKey: c.sortKey,
    })),
    links: links.map(
      (l: { id: string; label: string; url: string; sortKey: string; categoryId: string }) => ({
        id: l.id,
        label: l.label,
        url: l.url,
        sortKey: l.sortKey,
        categoryId: l.categoryId,
      }),
    ),
    propertyId: params.propertyId,
    propertySlug: propRows[0]?.slug ?? '',
  }
},
```

Wait — that's importing from composition in a route loader. The project convention is to use server functions, not direct DB access in route loaders. Instead, use the existing `listProperties` loaded in the parent `_authenticated` route.

**Best approach:** In the component, get the properties from the parent route's loader data:

```tsx
function PortalDetailRoute() {
  const { portal, categories, links, propertyId } = Route.useLoaderData()
  const ctx = Route.useRouteContext()
  // Access parent _authenticated route's loaded properties
  const parentLoader = Route.useMatch({ from: '/_authenticated' })
  const propertySlug =
    parentLoader.loaderData?.properties?.find((p: { id: string }) => p.id === propertyId)
      ?.slug ?? ''

  const mutation = useMutationAction(updatePortal, {
    successMessage: 'Portal updated',
  })

  return (
    <PortalDetailPage
      portal={portal}
      propertyId={propertyId}
      categories={categories}
      links={links}
      updateMutation={mutation}
      organizationName={ctx.activeOrganization?.name ?? 'Your Organization'}
      propertySlug={propertySlug}
    />
  )
}
```

Actually, the simplest approach that follows existing patterns: pass `propertySlug` as part of the context. The `_authenticated.tsx` `beforeLoad` already has the active org with slug. But we need property slug. Since properties are already loaded in the layout, and the `listProperties` server function returns `{ id, name, slug }`, we can find the slug from there.

Let's use `Route.useMatch` from the parent route:

```tsx
import { createFileRoute, useMatch } from '@tanstack/react-router'
```

And in the component:

```tsx
const authMatch = useMatch({ from: '/_authenticated', strict: false })
const propertySlug =
  authMatch?.loaderData?.properties?.find(
    (p: { id: string; slug: string }) => p.id === propertyId,
  )?.slug ?? ''
```

This is the recommended approach since the data is already loaded.

- [ ] **Step 9: Update portal list — use propertySlug in URLs**

In `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`:

1. The loader currently gets `orgSlug` from context. Instead, we need `propertySlug`. Since the route already has `propertyId` as a param, and we have the properties list from the parent layout, look up the slug:

```tsx
loader: async ({ params, context }) => {
  const ctx = context as AuthRouteContext
  const { portals } = await listPortals({
    data: { propertyId: params.propertyId },
  })
  return {
    portals,
    propertyId: params.propertyId,
  }
},
```

2. In the component, get the property slug from the parent match:

```tsx
import { createFileRoute, Link, useMatch } from '@tanstack/react-router'
```

```tsx
function PortalListPage() {
  const { can } = usePermissions()
  const { propertyId } = Route.useParams()
  const { portals } = Route.useLoaderData()

  const authMatch = useMatch({ from: '/_authenticated', strict: false })
  const propertySlug = authMatch?.loaderData?.properties?.find(
    (p: { id: string; slug: string }) => p.id === propertyId
  )?.slug ?? ''

  // ... rest stays the same, but replace orgSlug with propertySlug in URLs:
  // /p/{orgSlug}/{p.slug} → /p/{propertySlug}/{p.slug}
```

3. Update all URL constructions from `/p/${orgSlug}/${p.slug}` to `/p/${propertySlug}/${p.slug}`.

4. For inactive portals, add dimmed styling to the table row:

Replace the `<TableRow>` for each portal:

```tsx
<TableRow key={p.id} className={p.isActive ? '' : 'opacity-50'}>
```

- [ ] **Step 10: Regenerate route tree**

Run: `pnpm dev` (briefly, to regenerate `src/routeTree.gen.ts`)

Then kill the dev server and verify the route tree reflects `$propertySlug` instead of `$orgSlug`.

- [ ] **Step 11: Verify build compiles**

Run: `pnpm typecheck`
Expected: No type errors related to the route rename or prop changes.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: restructure guest URLs to property-first, client-side QR generation"
```

---

## Task 5: Portal Active/Inactive Toggle

**Files:**

- Modify: `src/components/features/portal/PortalDetailPage.tsx`
- Install: shadcn `switch` component

- [ ] **Step 1: Install shadcn switch component**

Run: `npx shadcn@latest add switch`
Expected: `src/components/ui/switch.tsx` created.

- [ ] **Step 2: Add active/inactive toggle to PortalDetailPage**

In `src/components/features/portal/PortalDetailPage.tsx`:

1. Add import:

```typescript
import { Switch } from '#/components/ui/switch'
import { Label } from '#/components/ui/label'
```

2. Add state for `isActive` (near line 121, alongside other state):

```typescript
const [isActive, setIsActive] = useState(portal.isActive)
```

3. Add `isActive` to the `PortalDetailPageProps.portal` type (after line 74):

```typescript
isActive: boolean
```

4. Add the toggle UI in the Settings section, after the `<h2>Settings</h2>` line (around line 321):

```tsx
{
  /* Active/Inactive toggle */
}
;<div className="flex items-center justify-between rounded-md border px-4 py-3">
  <div className="space-y-0.5">
    <Label htmlFor="portal-active" className="text-sm font-medium">
      Portal Active
    </Label>
    <p className="text-xs text-muted-foreground">
      {isActive
        ? 'Guests can access this portal.'
        : 'Guests will see an "unavailable" message.'}
    </p>
  </div>
  <Switch
    id="portal-active"
    checked={isActive}
    onCheckedChange={(checked) => {
      setIsActive(checked)
      updateMutation.mutate({
        data: { portalId: portal.id, isActive: checked },
      })
    }}
    disabled={!can('portal.update') || updateMutation.isPending}
  />
</div>
```

5. Update the `updateMutation` action type to accept `isActive`:

The `PortalDetailPageProps.updateMutation` type needs `isActive?: boolean` in the data. Update the type:

```typescript
updateMutation: Action<{
  data: {
    portalId: string
    name?: string
    slug?: string
    description?: string | null
    theme?: { primaryColor: string }
    smartRoutingEnabled?: boolean
    smartRoutingThreshold?: number
    isActive?: boolean
  }
}>
```

- [ ] **Step 3: Verify the portal update server function accepts isActive**

Check `src/contexts/portal/application/dto/update-portal.dto.ts` — the decision log confirms `updatePortalInputSchema` already accepts `isActive` as optional boolean. No change needed.

- [ ] **Step 4: Pass isActive from the route loader**

In `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`, the `getPortal` return should include `isActive`. Verify the portal object passed to `PortalDetailPage` includes the `isActive` field. If the `getPortal` server function doesn't return it, check `src/contexts/portal/server/portals.ts` and ensure `isActive` is in the select.

- [ ] **Step 5: Verify build compiles**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/portal/PortalDetailPage.tsx src/components/ui/switch.tsx
git commit -m "feat: portal active/inactive toggle with Switch component"
```

---

## Task 6: Property Switcher — Always Visible + Add Property

**Files:**

- Modify: `src/components/layout/AppTopBar.tsx`

- [ ] **Step 1: Update AppTopBar to always show dropdown**

In `src/components/layout/AppTopBar.tsx`, replace the conditional rendering (lines 86-113). Currently it shows a dropdown only when `properties.length > 1`, else a static span. Change to always show the dropdown with an "Add Property" item:

Replace lines 85-113 with:

```tsx
{
  /* Property switcher — always interactive */
}
;<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" className="gap-2 px-2">
      <span className="text-sm font-medium">
        {currentProperty?.name ?? 'Select property'}
      </span>
      <ChevronsUpDown className="size-3.5 text-muted-foreground" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start" className="w-64">
    {properties.map((p) => (
      <DropdownMenuItem key={p.id} onClick={() => handlePropertySwitch(p.id)}>
        {p.name}
        {p.id === propertyId && (
          <span className="ml-auto text-xs text-muted-foreground">Active</span>
        )}
      </DropdownMenuItem>
    ))}
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={() => navigate({ to: '/properties/new' })}>
      <Plus className="size-3.5 mr-1" />
      Add Property
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

2. Add `Plus` to the lucide-react import (line 2):

```typescript
import { ChevronsUpDown, LogOut, Moon, Sun, Monitor, Plus } from 'lucide-react'
```

- [ ] **Step 2: Verify build compiles**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppTopBar.tsx
git commit -m "feat: property switcher always visible with add property shortcut"
```

---

## Task 7: Create Organization Dialog in Sidebar

**Files:**

- Create: `src/components/features/organization/CreateOrganizationDialog.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: Create CreateOrganizationDialog component**

Create `src/components/features/organization/CreateOrganizationDialog.tsx`:

```tsx
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { authClient } from '#/shared/auth/auth-client'

type CreateOrganizationDialogProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}>

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateOrganizationDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleNameChange = (value: string) => {
    setName(value)
    // Auto-generate slug from name
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64),
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) return

    setIsPending(true)
    setError(null)

    try {
      await authClient.organization.create({
        name: name.trim(),
        slug: slug.trim(),
      })
      setName('')
      setSlug('')
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription>Add a new organization to your account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Acme Hotels"
              disabled={isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-slug">Slug</Label>
            <Input
              id="org-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-hotels"
              disabled={isPending}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !name.trim() || !slug.trim()}>
              {isPending ? 'Creating...' : 'Create Organization'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Add Create Organization to AppSidebar**

In `src/components/layout/AppSidebar.tsx`:

1. Add import:

```typescript
import { CreateOrganizationDialog } from '#/components/features/organization/CreateOrganizationDialog'
import { Plus } from 'lucide-react'
```

2. Add `Plus` to the existing lucide-react imports (line 3-11).

3. Add state for the dialog inside the `AppSidebar` function (after line 118):

```typescript
const [createOrgOpen, setCreateOrgOpen] = useState(false)
```

Add `useState` to the React import.

4. Add the dialog + "Create Organization" item in the org switcher dropdown (after the organizations list, before the closing `</DropdownMenuContent>` — around line 270):

```tsx
<DropdownMenuSeparator />
<DropdownMenuItem onClick={() => setCreateOrgOpen(true)}>
  <Plus className="size-4 mr-2" />
  Create Organization
</DropdownMenuItem>
```

5. Add the dialog component after the closing `</Sidebar>` tag (but inside the return):

Actually, since the Dialog renders in a portal, it can go anywhere. Add it at the end of the component's return, wrapping the entire `Sidebar` in a fragment:

```tsx
return (
  <>
    <Sidebar collapsible="icon">
      {/* ... existing sidebar content ... */}
      <SidebarRail />
    </Sidebar>
    <CreateOrganizationDialog
      open={createOrgOpen}
      onOpenChange={setCreateOrgOpen}
      onSuccess={() => {
        // Reload the page to refresh the org list
        window.location.reload()
      }}
    />
  </>
)
```

- [ ] **Step 3: Verify build compiles**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/features/organization/CreateOrganizationDialog.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat: create organization dialog in sidebar org switcher"
```

---

## Task 8: Final Verification + Route Tree Regeneration

- [ ] **Step 1: Regenerate route tree**

Run: `pnpm dev` briefly to regenerate `src/routeTree.gen.ts` after the route file rename.

Verify `$orgSlug` references are replaced with `$propertySlug`.

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`
Expected: Clean — no errors.

- [ ] **Step 3: Run linter**

Run: `pnpm lint:fix`
Expected: No new warnings.

- [ ] **Step 4: Run existing tests**

Run: `pnpm test`
Expected: All existing tests pass.

- [ ] **Step 5: Manual smoke test checklist**

1. Create a new organization from sidebar — confirm auto-switch and new org appears in list
2. Edit org name/slug/billing fields in settings — confirm persistence after page reload
3. Create property — verify timezone combobox search works, offset labels display
4. Open a guest portal via new URL `/p/{propertySlug}/{portalSlug}` — confirm renders
5. Toggle portal to inactive — confirm guest URL shows "unavailable" and portal is dimmed in list
6. Open QR dialog — confirm QR image renders, URL is truncated with tooltip, download works
7. With single property — confirm top bar dropdown shows with "Add Property" option
8. Add second property — confirm switcher works, "Add Property" still present

- [ ] **Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address typecheck and lint issues from phase 12 polish"
```
