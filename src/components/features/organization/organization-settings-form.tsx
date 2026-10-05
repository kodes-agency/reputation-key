// Organization settings form — edit beta organization identity.
// Per conventions: receives organization data and onSubmit callback, uses TanStack Form + Zod schema.

import { useForm } from '@tanstack/react-form'
import { FormActions } from '#/components/forms/form-actions'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  Card,
  CardContent,
  CardFooter,
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
    <form onSubmit={submitHandler(form)}>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Identity</CardTitle>
          <CardDescription>
            Organization name, slug, and contact information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgIdentityCard form={form} />
        </CardContent>
        <CardFooter>
          <FormActions form={form} error={error}>
            <SubmitButton mutation={{ isPending, error }} form={form}>
              Save changes
            </SubmitButton>
          </FormActions>
        </CardFooter>
      </Card>
    </form>
  )
}
