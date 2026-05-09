// Organization settings form — edit organization identity and billing information
// Per conventions: receives organization data and onSubmit callback, uses TanStack Form + Zod schema.
// Shows warning when slug changes (breaks guest URLs).

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { OrgIdentityCard } from './org-identity-card'
import { OrgBillingCard } from './org-billing-card'

// ── Schema ──────────────────────────────────────────────────────────

const orgSettingsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().min(1, 'Slug is required').max(64),
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

      {/* Identity Card */}
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            Organization name, slug, and contact information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgIdentityCard form={form} slugChanged={slugChanged} />
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
