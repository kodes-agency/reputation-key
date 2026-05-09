import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { ThemeFieldGroup } from './theme-field-group'
import type { FormApi } from '@tanstack/react-form'

type Props = Readonly<{
  form: FormApi<
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown
  >
}>

export function PortalNameSlugGroup({ form }: Props) {
  return (
    <FieldGroup>
      <form.Field name="name">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            label="Name"
            id="portal-name"
            placeholder="My Portal"
          />
        )}
      </form.Field>

      <form.Field name="slug">
        {(field: BaseFieldApi) => (
          <FormTextField
            field={field}
            label="Slug (optional)"
            id="portal-slug"
            placeholder="auto-generated from name"
          />
        )}
      </form.Field>

      <form.Field name="description">
        {(field: BaseFieldApiTextarea) => (
          <FormTextarea
            field={field}
            label="Description (optional)"
            id="portal-description"
            placeholder="A short description of this portal"
            rows={3}
          />
        )}
      </form.Field>

      <form.Field name="primaryColor">
        {(field: { state: { value: string }; handleChange: (value: string) => void }) => (
          <ThemeFieldGroup
            primaryColor={field.state.value}
            onPrimaryColorChange={(color) => field.handleChange(color)}
          />
        )}
      </form.Field>
    </FieldGroup>
  )
}
