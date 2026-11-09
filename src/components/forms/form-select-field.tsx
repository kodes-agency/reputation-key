// A field that chooses one of a few named values: the shared Select in the shared field
// frame. Never a browser <select>, which draws its own popup, height and focus ring.
import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { cn } from '#/lib/utils'
import { describedByOf, FormFieldFrame } from './form-field-frame'

export type FormSelectOption<Value extends string> = Readonly<{
  value: Value
  label: string
}>

type Props<Value extends string> = Readonly<{
  id: string
  label: string
  placeholder?: string
  optional?: boolean
  value: Value
  onValueChange: (value: Value) => void
  options: ReadonlyArray<FormSelectOption<Value>>
  /** A line under the field on what it is for; the select names it as its description. */
  description?: ReactNode
  invalid?: boolean
  errors?: Array<{ message?: string } | undefined>
  disabled?: boolean
  className?: string
  /** Merged onto the select itself; it fills the field unless told otherwise. */
  triggerClassName?: string
  onBlur?: () => void
}>

/** The choices of a select, one item per named value. */
function SelectOptions<Value extends string>({
  options,
}: Readonly<{ options: ReadonlyArray<FormSelectOption<Value>> }>) {
  return (
    <SelectContent>
      <SelectGroup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  )
}

export function FormSelectField<Value extends string>({
  id,
  label,
  optional,
  placeholder,
  value,
  onValueChange,
  options,
  description,
  invalid = false,
  errors,
  disabled = false,
  className,
  triggerClassName,
  onBlur,
}: Props<Value>) {
  return (
    <FormFieldFrame
      id={id}
      label={label}
      optional={optional}
      description={description}
      invalid={invalid}
      errors={invalid ? errors : undefined}
      className={className}
    >
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => onValueChange(next as Value)}
      >
        <SelectTrigger
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedByOf(id, description, invalid)}
          className={cn('w-full min-w-0', triggerClassName)}
          onBlur={onBlur}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectOptions options={options} />
      </Select>
    </FormFieldFrame>
  )
}
