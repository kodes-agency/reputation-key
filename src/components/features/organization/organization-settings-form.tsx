// Organization settings form — edit organization identity and billing information
// Per conventions: receives organization data and onSubmit callback, uses TanStack Form + Zod schema.
// Shows warning when slug changes (breaks guest URLs).

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { AlertTriangle } from 'lucide-react'

// ── Schema ──────────────────────────────────────────────────────────

const orgSettingsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().min(1, 'Slug is required').max(64),
  logo: z.string().max(500).nullable(),
  contactEmail: z.union([z.string().email('Invalid email'), z.literal('')]).nullable(),
  billingCompanyName: z.string().max(200).nullable(),
  billingAddress: z.string().max(300).nullable(),
  billingCity: z.string().max(100).nullable(),
  billingPostalCode: z.string().max(20).nullable(),
  billingCountry: z.string().max(100).nullable(),
})

type FormValues = z.infer<typeof orgSettingsSchema>

// ── Types ────────────────────────────────────────────────────────────

type Props = Readonly<{
  organization: {
    name: string
    slug: string
    logo?: string | null
    contactEmail: string | null
    billingCompanyName: string | null
    billingAddress: string | null
    billingCity: string | null
    billingPostalCode: string | null
    billingCountry: string | null
  }
  onSubmit: (values: FormValues) => Promise<void>
  isPending: boolean
  error: unknown
}>

// ── Component ────────────────────────────────────────────────────────

export function OrganizationSettingsForm({
  organization,
  onSubmit,
  isPending,
  error,
}: Props) {
  const form = useForm({
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
    } as FormValues,
    validators: {
      onSubmit: orgSettingsSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value)
    },
  })

  const currentSlug = form.getFieldValue('slug')
  const slugChanged = currentSlug !== organization.slug && currentSlug !== ''

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="flex flex-col gap-6"
    >
      <FormErrorBanner error={error} />

      {/* Identity section */}
      <div className="flex flex-col gap-4">
        <h3 className="font-semibold">Identity</h3>
        <FieldGroup>
          <form.Field name="name">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="Name"
                id="org-name"
                autoComplete="organization"
              />
            )}
          </form.Field>

          <form.Field name="slug">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="Slug"
                id="org-slug"
                autoComplete="off"
              />
            )}
          </form.Field>

          <form.Field name="logo">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="Logo URL"
                id="org-logo"
                type="url"
                placeholder="https://example.com/logo.png"
                autoComplete="url"
              />
            )}
          </form.Field>

          <form.Field name="contactEmail">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="Contact email"
                id="org-contact-email"
                type="email"
                placeholder="contact@example.com"
                autoComplete="email"
              />
            )}
          </form.Field>
        </FieldGroup>
      </div>

      {/* Slug change warning */}
      {slugChanged && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            Changing the slug will break existing guest portal URLs. Guests using the old
            slug URL will no longer be able to access the portal.
          </AlertDescription>
        </Alert>
      )}

      {/* Billing section */}
      <div className="flex flex-col gap-4">
        <h3 className="font-semibold">Billing</h3>
        <FieldGroup>
          <form.Field name="billingCompanyName">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="Company name"
                id="billing-company-name"
                placeholder="Acme Inc."
                autoComplete="organization"
              />
            )}
          </form.Field>

          <form.Field name="billingAddress">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="Address"
                id="billing-address"
                placeholder="123 Main St"
                autoComplete="street-address"
              />
            )}
          </form.Field>

          <form.Field name="billingCity">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="City"
                id="billing-city"
                placeholder="San Francisco"
                autoComplete="address-level2"
              />
            )}
          </form.Field>

          <form.Field name="billingPostalCode">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="Postal code"
                id="billing-postal-code"
                placeholder="94102"
                autoComplete="postal-code"
              />
            )}
          </form.Field>

          <form.Field name="billingCountry">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="Country"
                id="billing-country"
                placeholder="United States"
                autoComplete="country-name"
              />
            )}
          </form.Field>
        </FieldGroup>
      </div>

      <SubmitButton
        mutation={{ isPending, error }}
        form={form}
        className="w-full sm:w-auto"
      >
        Save changes
      </SubmitButton>
    </form>
  )
}
