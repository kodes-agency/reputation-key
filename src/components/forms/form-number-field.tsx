// Whole-number field for forms — the control the Response Target cards share.
// Per conventions: shared form building blocks live in components/forms/.
//
// Deliberately not FormTextField with type="number": that one reports invalid
// from `isTouched && !isValid`, which hides a submit-time error on a field the
// person never focused. A target the server refused must show its reason, so
// this control reads the errors themselves.

import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { FieldError } from '#/components/ui/field'

/**
 * Just the surface a number control touches on a TanStack Form field. Named
 * structurally rather than through the form's generic field type, which would
 * make this component's props depend on the whole form shape.
 */
export type NumberFieldApi = Readonly<{
  state: Readonly<{
    value: number
    meta: Readonly<{ errors: Array<{ message?: string } | undefined> }>
  }>
  handleBlur: () => void
  handleChange: (value: number) => void
}>

/**
 * A whole-number control bound to one form field. Every target input is this
 * control with a different label and range; a cleared or non-numeric control
 * reads as NaN, which the schema names and the input must not show.
 */
export function FormNumberField({
  id,
  label,
  min,
  max,
  field,
  disabled,
  className = 'grid gap-1.5',
}: Readonly<{
  id: string
  label: string
  min: number
  max: number
  field: NumberFieldApi
  disabled?: boolean
  className?: string
}>) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        disabled={disabled}
        value={Number.isNaN(field.state.value) ? '' : field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.valueAsNumber)}
        aria-invalid={field.state.meta.errors.length > 0}
      />
      {field.state.meta.errors.length > 0 ? (
        <FieldError errors={field.state.meta.errors} />
      ) : null}
    </div>
  )
}
