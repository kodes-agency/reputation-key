// Timezone select component for property forms.
// Uses shadcn's Select component for consistent dropdown behavior.

import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import { VALID_TIMEZONES } from '#/shared/domain/timezones'

type Props = Readonly<{
  field: BaseFieldApi
  label: string
  id: string
}>

export function TimezoneSelect({ field, label, id }: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value)}
      >
        <SelectTrigger id={id} onBlur={field.handleBlur} aria-invalid={isInvalid}>
          <SelectValue placeholder="Select timezone" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {VALID_TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}
