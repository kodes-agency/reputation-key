import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { ThemeFieldGroup } from './theme-field-group'
import type { PortalThemeDraft } from '../shared/types'
import type { FormWithField } from '#/components/forms/form-with-field'

type PortalFormValues = {
  name: string
  slug: string
  description: string
  theme: PortalThemeDraft
}

// `theme` is not rendered through `form.Field`: `FormWithField`'s render prop is
// typed for string-valued fields, and the theme is an object. The create form
// owns the draft and hands it down.
type Props = Readonly<{
  form: FormWithField<PortalFormValues>
  theme: PortalThemeDraft
  onThemeChange: (theme: PortalThemeDraft) => void
}>

export function PortalNameSlugGroup({ form, theme, onThemeChange }: Props) {
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

      <ThemeFieldGroup theme={theme} onThemeChange={onThemeChange} />
    </FieldGroup>
  )
}
