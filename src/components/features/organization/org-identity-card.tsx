import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { FormWithField } from '#/components/forms/form-with-field'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { AlertTriangle } from 'lucide-react'

type OrgIdentityFormValues = {
  name: string
  slug: string
  contactEmail: string
  billingCompanyName: string
  billingAddress: string
  billingCity: string
  billingPostalCode: string
  billingCountry: string
}

type Props = Readonly<{
  form: FormWithField<OrgIdentityFormValues>
  slugChanged: boolean
}>

export function OrgIdentityCard({ form, slugChanged }: Props) {
  return (
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
          <FormTextField field={field} label="Slug" id="org-slug" autoComplete="off" />
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

      {slugChanged && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            Changing the slug will break existing guest portal URLs. Guests using the old
            slug URL will no longer be able to access the portal.
          </AlertDescription>
        </Alert>
      )}
    </FieldGroup>
  )
}
