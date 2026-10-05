// The anatomy every shared form field has (UI consistency scan: FORM-05): a Field
// holding the label (with its optional marker), the control, a line of help and
// the error, in that order. FormTextField, FormTextarea and FormNumberField draw
// their control inside it; a control of another kind (a combobox, a time input)
// does the same instead of rebuilding Field, FieldLabel and FieldError.
import type { ReactNode } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/components/ui/field'

/** The id the help line takes, which the control names in `aria-describedby`. */
export const descriptionIdOf = (id: string): string => `${id}-description`

/** What a control's `aria-describedby` says: the help, when there is one. */
export const describedByOf = (id: string, description: ReactNode): string | undefined =>
  description ? descriptionIdOf(id) : undefined

type Props = Readonly<{
  /** The control's id: the label is for it and the help is `<id>-description`. */
  id: string
  label: string
  /** The person may leave it empty. */
  optional?: boolean
  /** What the field is for, under the control. */
  description?: ReactNode
  /** The field is in a state the person must fix: the Field and its control read as invalid. */
  invalid: boolean
  /** The faults to print under the help (nothing prints for an empty list). */
  errors?: Array<{ message?: string } | undefined>
  className?: string
  labelClassName?: string
  /** The control. */
  children: ReactNode
}>

export function FormFieldFrame({
  id,
  label,
  optional = false,
  description,
  invalid,
  errors,
  className,
  labelClassName,
  children,
}: Props) {
  const describedBy = describedByOf(id, description)
  return (
    <Field data-invalid={invalid} className={className}>
      <FieldLabel htmlFor={id} optional={optional} className={labelClassName}>
        {label}
      </FieldLabel>
      {children}
      {describedBy === undefined ? null : (
        <FieldDescription id={describedBy}>{description}</FieldDescription>
      )}
      {errors === undefined ? null : <FieldError errors={errors} />}
    </Field>
  )
}
