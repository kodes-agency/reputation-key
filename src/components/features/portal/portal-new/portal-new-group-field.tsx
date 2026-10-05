// New portal — the group. Groups share results and goals; guests never see them.
// Not drawn at all while the Property has no group: a one-choice select asks
// nothing of the person.
import { describedByOf, FormFieldFrame } from '#/components/forms/form-field-frame'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { PortalNewField, PortalNewGroup } from './portal-new-types'

/** Radix Select cannot hold an empty value, so "no group" has a word of its own. */
const NO_GROUP = 'none'

const GROUP_HELP = "For shared results and goals. Guests don't see groups."

export function PortalNewGroupField({
  field,
  groups,
  disabled,
}: Readonly<{
  field: PortalNewField<string>
  groups: readonly PortalNewGroup[]
  disabled: boolean
}>) {
  if (groups.length === 0) return null
  return (
    <FormFieldFrame
      id="portal-new-group"
      label="Group"
      description={GROUP_HELP}
      invalid={false}
    >
      <Select
        value={field.state.value === '' ? NO_GROUP : field.state.value}
        onValueChange={(next) => field.handleChange(next === NO_GROUP ? '' : next)}
        disabled={disabled}
      >
        <SelectTrigger
          id="portal-new-group"
          className="w-full"
          aria-describedby={describedByOf('portal-new-group', GROUP_HELP)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_GROUP}>No group</SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormFieldFrame>
  )
}
