import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Field, FieldLabel } from '#/components/ui/field'

type Props = Readonly<{
  label: string
  value: string
  options: ReadonlyArray<Readonly<{ value: string; label: string }>>
  onChange: (value: string) => void
}>

export function InboxFilterSelect({ label, value, options, onChange }: Props) {
  return (
    <Field className="gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        {/* The listbox needs its OWN name: Radix does not copy the trigger's,
            and axe fails an unnamed `role="listbox"` (aria-input-field-name). */}
        <SelectContent position="popper" aria-label={label}>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
