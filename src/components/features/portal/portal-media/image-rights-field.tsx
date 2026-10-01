// "Avela Resort owns this photo or has permission to use it." The upload is
// refused without it, so the button stays off until it is ticked. The sentence
// names the property, as the board does, so it is clear whose permission it is.

import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldLabel } from '#/components/ui/field'

type Props = Readonly<{
  id: string
  /** What is being uploaded, as the sentence names it: "photo" or "logo". */
  noun: 'photo' | 'logo'
  propertyName: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}>

export function ImageRightsField({
  id,
  noun,
  propertyName,
  checked,
  onCheckedChange,
  disabled = false,
}: Props) {
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <FieldLabel htmlFor={id} className="font-normal">
        {propertyName} owns this {noun} or has permission to use it.
      </FieldLabel>
    </Field>
  )
}
