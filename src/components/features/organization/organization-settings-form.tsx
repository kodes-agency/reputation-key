// Organization settings form — edit organization identity and billing information
// Per conventions: receives organization data and onSubmit callback, uses TanStack Form + Zod schema.
// Shows warning when slug changes (breaks guest URLs).

import { useForm } from '@tanstack/react-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { OrgIdentityCard } from './org-identity-card'
import { OrgBillingCard } from './org-billing-card'
import { updateOrgSettingsSchema } from '#/contexts/identity/application/dto/update-org-settings.dto'
import type { UpdateOrgSettingsInput } from '#/contexts/identity/application/dto/update-org-settings.dto'

// ── Types ────────────────────────────────────────────────────────────

type Props = Readonly<{
  organization: {
    name: string
    slug: string
    contactEmail: string | null
    billingCompanyName: string | null
    billingAddress: string | null
    billingCity: string | null
    billingPostalCode: string | null
    billingCountry: string | null
  }
  onSubmit: (values: UpdateOrgSettingsInput) => Promise<void>
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
      contactEmail: organization.contactEmail ?? '',
      billingCompanyName: organization.billingCompanyName ?? '',
      billingAddress: organization.billingAddress ?? '',
      billingCity: organization.billingCity ?? '',
      billingPostalCode: organization.billingPostalCode ?? '',
      billingCountry: organization.billingCountry ?? '',
    } as UpdateOrgSettingsInput,
    validators: {
      onSubmit: updateOrgSettingsSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value)
    },
  })

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

      {/* Identity Card */}
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            Organization name, slug, and contact information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Subscribe to slug so slugChanged reactively updates — a plain
              form.getFieldValue read in the parent doesn't subscribe, so the
              warning would never re-render when the slug field changes. */}
          <form.Subscribe selector={(state) => state.values.slug}>
            {(slug) => (
              <OrgIdentityCard
                form={form}
                slugChanged={slug !== organization.slug && slug !== ''}
              />
            )}
          </form.Subscribe>
        </CardContent>
      </Card>

      {/* Billing Card */}
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
          <CardDescription>Billing address and company information.</CardDescription>
        </CardHeader>
        <CardContent>
          <OrgBillingCard form={form} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SubmitButton
          mutation={{ isPending, error }}
          form={form}
          className="w-full sm:w-auto"
        >
          Save changes
        </SubmitButton>
        <Button type="button" variant="outline" asChild className="w-full sm:w-auto">
          <Link to="/settings/profile">Cancel</Link>
        </Button>
      </div>
    </form>
  )
}
