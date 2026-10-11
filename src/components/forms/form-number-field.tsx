// Number field for forms — the control the Response Target cards and the rows
// of the table that sets several goals share. A whole number unless it is given
// a `step` (a rating average takes one decimal place).
// Per conventions: shared form building blocks live in components/forms/.
//
// Deliberately not FormTextField with type="number": that one reports invalid
// from `isTouched && !isValid`, which hides a submit-time error on a field the
// person never focused. A target the server refused must show its reason, so
// this control reads the errors themselves. It is otherwise the same field: the
// same Field, FieldLabel, help line and optional marker as FormTextField.

import type { ReactNode } from 'react'
import { Input } from '#/components/ui/input'
import { describedByOf, FormFieldFrame } from './form-field-frame'

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
 * A number control bound to one form field. Every target input is this control
 * with a different label and range; a cleared or non-numeric control reads as
 * NaN, which the schema names and the input must not show.
 */
export function FormNumberField({
  id,
  label,
  min,
  max,
  step,
  field,
  disabled,
  className,
  labelClassName,
  optional,
  description,
}: Readonly<{
  id: string
  label: string
  min: number
  /** Left out for a number with no upper bound (a count). */
  max?: number
  /** The grain of the number: left out, a whole number. */
  step?: number
  field: NumberFieldApi
  disabled?: boolean
  /** Merged onto the Field: a width a card gives it (`max-w-40`). */
  className?: string
  /** Merged onto the label: `sr-only` where a column header already shows it. */
  labelClassName?: string
  /** The person may leave it empty: the label says "Optional". */
  optional?: boolean
  /** A line under the field on what it is for; the input names it as its description. */
  description?: ReactNode
}>) {
  const invalid = field.state.meta.errors.length > 0
  return (
    <FormFieldFrame
      id={id}
      label={label}
      optional={optional}
      description={description}
      invalid={invalid}
      errors={invalid ? field.state.meta.errors : undefined}
      className={className}
      labelClassName={labelClassName}
    >
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={Number.isNaN(field.state.value) ? '' : field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.valueAsNumber)}
        aria-invalid={invalid}
        aria-describedby={describedByOf(id, description, invalid)}
      />
    </FormFieldFrame>
  )
}
