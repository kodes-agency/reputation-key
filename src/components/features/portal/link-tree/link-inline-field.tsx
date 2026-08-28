import { FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import type { BaseFieldApi } from '#/components/forms/form-text-field'

type Props = Readonly<{
  field: BaseFieldApi
  id: string
  label: string
  placeholder: string
  maxLength: number
  disabled?: boolean
}>

export function LinkInlineField({
  field,
  id,
  label,
  placeholder,
  maxLength,
  disabled,
}: Props) {
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <div className="min-w-0 flex-1">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Input
        id={id}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={invalid}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
      />
      {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
    </div>
  )
}
