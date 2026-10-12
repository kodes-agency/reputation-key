import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { FormWithField } from '#/components/forms/form-with-field'

type OrgIdentityFormValues = {
  name: string
  slug: string
  contactEmail: string
}

type Props = Readonly<{
  form: FormWithField<OrgIdentityFormValues>
}>

export function OrgIdentityCard({ form }: Props) {
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
            optional
            type="email"
            placeholder="contact@example.com"
            autoComplete="email"
          />
        )}
      </form.Field>
    </FieldGroup>
  )
}
