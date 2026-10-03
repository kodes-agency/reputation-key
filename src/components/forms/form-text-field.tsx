// Reusable text field for forms — eliminates render-prop duplication.
// Wraps TanStack Form's form.Field with shadcn's Field components.
// Per conventions: shared form building blocks live in components/forms/.

import type { ReactNode } from 'react'
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'

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
  /** A line under the field on what it is for; the input names it as its description. */
  hint?: ReactNode
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
  hint,
}: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  const hintId = hint === undefined ? undefined : `${id}-hint`

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={field.name}
        type={type}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        aria-describedby={hintId}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        maxLength={maxLength}
        className={className}
      />
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </Field>
  )
}
