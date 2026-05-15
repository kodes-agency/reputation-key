import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import type { FormWithField } from '#/components/forms/form-with-field'

type PortalBasicInfoFormValues = {
  name: string
  slug: string
  description: string
}

type Props = Readonly<{
  form: FormWithField<PortalBasicInfoFormValues>
  disabled?: boolean
}>

export function BasicInfoSection({ form, disabled }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-semibold">Basic Info</h3>
      <FieldGroup>
        <form.Field name="name">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Name"
              id="edit-portal-name"
              disabled={disabled}
            />
          )}
        </form.Field>

        <form.Field name="description">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              label="Description"
              id="edit-portal-description"
              rows={3}
              disabled={disabled}
            />
          )}
        </form.Field>
      </FieldGroup>
    </div>
  )
}
