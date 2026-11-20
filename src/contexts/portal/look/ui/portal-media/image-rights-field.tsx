// "Avela Resort owns this photo or has permission to use it." The upload is
// refused without it, so the button stays off until it is ticked. The sentence
// names the property, as the board does, so it is clear whose permission it is.

import { ConsentCheckbox } from '#/components/forms/consent-checkbox'

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
    <ConsentCheckbox
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      {propertyName} owns this {noun} or has permission to use it.
    </ConsentCheckbox>
  )
}
