import { Checkbox } from '#/components/ui/checkbox'
import { Field } from '#/components/ui/field'

export function GoalSelectAllPortalsField({
  checked,
  onChange,
}: Readonly<{ checked: boolean; onChange: (checked: boolean) => void }>) {
  return (
    <Field>
      <label className="flex items-start gap-3 rounded-md border p-3">
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onChange(value === true)}
        />
        <span className="text-sm">
          <span className="block font-medium">Select all current portals</span>
          <span className="block text-muted-foreground">
            Takes a one-time snapshot when you submit. Portals created later are not added
            automatically.
          </span>
        </span>
      </label>
    </Field>
  )
}
