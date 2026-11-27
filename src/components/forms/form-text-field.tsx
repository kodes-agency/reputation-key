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
  /** Shown and submitted, never edited (a value the page already decided). */
  readOnly?: boolean
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
  readOnly,
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
        readOnly={readOnly}
        maxLength={maxLength}
        className={className}
      />
    </FormFieldFrame>
  )
}
