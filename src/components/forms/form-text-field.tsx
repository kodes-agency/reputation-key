// Reusable text field for forms — eliminates render-prop duplication.
// Wraps TanStack Form's form.Field with shadcn's Field components.
// Per conventions: shared form building blocks live in components/forms/.

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
  /** Shown and submitted, never edited (a value the page already decided). */
  readOnly?: boolean
  /** One line of help, tied to the input for assistive technology. */
  description?: string
  maxLength?: number
  className?: string
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
  description,
  maxLength,
  className,
}: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  const descriptionId = description ? `${id}-description` : undefined

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
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        readOnly={readOnly}
        aria-describedby={descriptionId}
        maxLength={maxLength}
        className={className}
      />
      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}
