// Organization settings form — edit beta organization identity.
// Per conventions: receives organization data and onSubmit callback, uses TanStack Form + Zod schema.

import { useForm } from '@tanstack/react-form'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitForm } from '#/components/forms/form-submit'
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
import { updateOrgSettingsSchema } from '#/contexts/identity/application/dto/update-org-settings.dto'
import type { UpdateOrgSettingsInput } from '#/contexts/identity/application/dto/update-org-settings.dto'

// ── Types ────────────────────────────────────────────────────────────

type Props = Readonly<{
  organization: {
    name: string
    slug: string
    contactEmail: string | null
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
        void submitForm(form)
      }}
      className="flex flex-col gap-6"
    >
      {/* Identity Card */}
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            Organization name, slug, and contact information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgIdentityCard form={form} />
        </CardContent>
      </Card>

      <FormErrorBanner error={error} />
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
