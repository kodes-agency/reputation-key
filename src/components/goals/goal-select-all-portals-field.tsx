import { ConsentCheckbox } from '#/components/forms/consent-checkbox'

export function GoalSelectAllPortalsField({
  checked,
  onChange,
}: Readonly<{ checked: boolean; onChange: (checked: boolean) => void }>) {
  return (
    <ConsentCheckbox
      id="goal-select-all-portals"
      checked={checked}
      onCheckedChange={onChange}
      description="Takes a one-time snapshot when you submit. Portals created later are not added automatically."
    >
      Select all current portals
    </ConsentCheckbox>
  )
}
