// Reusable text field for forms — eliminates render-prop duplication.
// Wraps TanStack Form's form.Field with shadcn's Field components.
// Per conventions: shared form building blocks live in components/forms/.

import type { ReactNode } from 'react'
import { Input } from '#/components/ui/input'
import { describedByOf, FormFieldFrame } from './form-field-frame'

export type BaseFieldApi = {
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
  field: BaseFieldApi
  label: string
  id: string
  type?: string
  placeholder?: string
  autoComplete?: string
  disabled?: boolean
  maxLength?: number
  className?: string
  /** The person may leave it empty: the label says "Optional". */
  optional?: boolean
  /** A line under the field on what it is for; the input names it as its description. */
  description?: ReactNode
}>

export function FormTextField({
  field,
  label,
  id,
  type = 'text',
  placeholder,
  autoComplete,
  disabled,
  maxLength,
  className,
  optional,
  description,
}: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  return (
    <FormFieldFrame
      id={id}
      label={label}
      optional={optional}
      description={description}
      invalid={isInvalid}
      errors={isInvalid ? field.state.meta.errors : undefined}
    >
      <Input
        id={id}
        name={field.name}
        type={type}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        aria-describedby={describedByOf(id, description, isInvalid)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        maxLength={maxLength}
        className={className}
      />
    </FormFieldFrame>
  )
}

/**
 * A field that holds `string | null` (blank is null) as the string a text field
 * edits, for a value the schema allows to be absent. The empty control is null
 * again as soon as it is cleared.
 */
export function blankAsNull(field: {
  name: string
  state: { value: string | null; meta: BaseFieldApi['state']['meta'] }
  handleBlur: () => void
  handleChange: (value: string | null) => void
}): BaseFieldApi {
  return {
    name: field.name,
    state: { value: field.state.value ?? '', meta: field.state.meta },
    handleBlur: field.handleBlur,
    handleChange: (value) => field.handleChange(value === '' ? null : value),
  }
}
