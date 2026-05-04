/**
 * Reusable textarea field for forms — mirrors FormTextField for multiline fields.
 * Wraps TanStack Form's form.Field with shadcn's Field components.
 */

import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import { Textarea } from '#/components/ui/textarea'

export type BaseFieldApiTextarea = {
  name: string
  state: {
    value: string
    meta: {
      isTouched: boolean
      isValid: boolean
      errors: Array<{ message?: string } | undefined>
    }
  }
  handleBlur: () => void
  handleChange: (value: string) => void
}

type Props = Readonly<{
  field: BaseFieldApiTextarea
  label: string
  id: string
  placeholder?: string
  rows?: number
  disabled?: boolean
}>

export function FormTextarea({
  field,
  label,
  id,
  placeholder,
  rows = 3,
  disabled,
}: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        name={field.name}
        value={field.state.value ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
      />
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}
