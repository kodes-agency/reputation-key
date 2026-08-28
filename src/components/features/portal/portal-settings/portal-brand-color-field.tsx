import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'

export function PortalBrandColorField({
  field,
  label,
  disabled,
}: Readonly<{
  field: BaseFieldApi
  label: string
  disabled: boolean
}>) {
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
  const id = `portal-brand-${label.toLowerCase()}`
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={field.name}
        type="color"
        value={field.state.value}
        disabled={disabled}
        aria-invalid={invalid}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
      />
      {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
    </Field>
  )
}
