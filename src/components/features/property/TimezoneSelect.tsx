// Timezone select component for property forms.
// Uses the shared VALID_TIMEZONES list as the option source.
// Wraps shadcn's Field components for consistent visual structure.

import { Field, FieldLabel, FieldError } from '#/components/ui/field'
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
      <select
        id={id}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {VALID_TIMEZONES.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </select>
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}
