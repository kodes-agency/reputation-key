/**
 * Reusable textarea field for forms — mirrors FormTextField for multiline fields.
 * Wraps TanStack Form's form.Field with shadcn's Field components.
 */

import type { ReactNode } from 'react'
import { Textarea } from '#/components/ui/textarea'
import { describedByOf, FormFieldFrame } from './form-field-frame'

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
  /** Shown at full contrast, never edited (a viewer's copy of a value). */
  readOnly?: boolean
  maxLength?: number
  /**
   * Merged onto the label and the textarea (`cn` in each primitive). Optional,
   * and absent by default, so every form that does not pass them renders
   * exactly as before. The inbox note form passes both to sit inside the
   * composer's dock as a borderless text row (`composer-dock-rows.ts`).
   */
  labelClassName?: string
  textareaClassName?: string
  /** The person may leave it empty: the label says "Optional". */
  optional?: boolean
  /** A line under the field on what it is for; the textarea names it as its description. */
  description?: ReactNode
}>

export function FormTextarea({
  field,
  label,
  id,
  placeholder,
  rows = 3,
  disabled,
  readOnly,
  maxLength,
  labelClassName,
  textareaClassName,
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
      labelClassName={labelClassName}
    >
      <Textarea
        id={id}
        className={textareaClassName}
        name={field.name}
        value={field.state.value ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        aria-describedby={describedByOf(id, description, isInvalid)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={maxLength}
      />
    </FormFieldFrame>
  )
}
