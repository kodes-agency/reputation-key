import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

type Props = Readonly<{
  field: BaseFieldApi
  id: string
  label: string
  disabled: boolean
  autoFocus?: boolean
  labelHidden?: boolean
}>

export function PortalGroupNameField({
  field,
  id,
  label,
  disabled,
  autoFocus,
  labelHidden,
}: Props) {
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <div className="flex flex-1 flex-col gap-2">
      <Label htmlFor={id} className={labelHidden ? 'sr-only' : undefined}>
        {label}
      </Label>
      <Input
        id={id}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        maxLength={100}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid}
        className="max-w-md"
      />
      {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
    </div>
  )
}
