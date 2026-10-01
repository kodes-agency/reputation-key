// New portal — the name. Only the team sees it; guests read the welcome line.
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import type { PortalNewField } from './portal-new-types'

const NAME_HINT_ID = 'portal-new-name-hint'

export function PortalNewNameField({
  field,
  disabled,
}: Readonly<{ field: PortalNewField<string>; disabled: boolean }>) {
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor="portal-new-name">Name</FieldLabel>
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
        aria-describedby={NAME_HINT_ID}
      />
      {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
      <p id={NAME_HINT_ID} className="text-sm text-muted-foreground">
        Only your team sees this name, for example Front desk, Terrace or Checkout. Guests
        see the welcome line you write next.
      </p>
    </Field>
  )
}
