// New portal — the name. Only the team sees it; guests read the welcome line.
import { describedByOf, FormFieldFrame } from '#/components/forms/form-field-frame'
import { Input } from '#/components/ui/input'
import type { PortalNewField } from './portal-new-types'

const NAME_HINT =
  'Only your team sees this name, for example Front desk, Terrace or Checkout. Guests see the welcome line you write next.'

export function PortalNewNameField({
  field,
  disabled,
}: Readonly<{ field: PortalNewField<string>; disabled: boolean }>) {
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <FormFieldFrame
      id="portal-new-name"
      label="Name"
      description={NAME_HINT}
      invalid={invalid}
      errors={invalid ? field.state.meta.errors : undefined}
    >
      <Input
        id="portal-new-name"
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        maxLength={100}
        autoFocus
        autoComplete="off"
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedByOf('portal-new-name', NAME_HINT, invalid)}
      />
    </FormFieldFrame>
  )
}
