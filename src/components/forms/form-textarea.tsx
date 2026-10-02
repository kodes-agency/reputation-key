/**
 * Reusable textarea field for forms — mirrors FormTextField for multiline fields.
 * Wraps TanStack Form's form.Field with shadcn's Field components.
 */

import type { ReactNode } from 'react'
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import { Textarea } from '#/components/ui/textarea'

export type BaseFieldApiTextarea = {
  name: string
  state: {
    value: string | undefined
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
  maxLength?: number
  /**
   * Merged onto the label and the textarea (`cn` in each primitive). Optional,
   * and absent by default, so every form that does not pass them renders
   * exactly as before. The inbox note form passes both to sit inside the
   * composer's dock as a borderless text row (`composer-dock-rows.ts`).
   */
  labelClassName?: string
  textareaClassName?: string
  /** A line under the field on what it is for; the textarea names it as its description. */
  hint?: ReactNode
}>

export function FormTextarea({
  field,
  label,
  id,
  placeholder,
  rows = 3,
  disabled,
  maxLength,
  labelClassName,
  textareaClassName,
  hint,
}: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  const hintId = hint === undefined ? undefined : `${id}-hint`

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={id} className={labelClassName}>
        {label}
      </FieldLabel>
      <Textarea
        id={id}
        className={textareaClassName}
        name={field.name}
        value={field.state.value ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        aria-describedby={hintId}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        maxLength={maxLength}
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
