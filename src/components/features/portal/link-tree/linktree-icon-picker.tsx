// The icon a tile wears: one choice from the closed catalogue, as a radio group
// so the arrow keys move between the icons and Tab enters and leaves it once.
// Photos join the picker when uploads are switched on.

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { LINK_ICONS, LINK_ICON_CHOICES, linkIconLabel } from './link-icons'
import {
  parsePortalLinkIconKey,
  type PortalLinkIconKey,
} from '#/shared/domain/portal-link-icon'

type Props = Readonly<{
  value: string | null
  onChange: (key: PortalLinkIconKey) => void
  disabled?: boolean
}>

const CHOICE_CLASS =
  'grid size-10 place-items-center rounded-md border border-input text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary'

export function LinktreeIconPicker({ value, onChange, disabled }: Props) {
  return (
    <RadioGroupPrimitive.Root
      aria-label="Icon"
      value={parsePortalLinkIconKey(value) ?? ''}
      disabled={disabled}
      onValueChange={(key) => {
        const chosen = parsePortalLinkIconKey(key)
        if (chosen !== null) onChange(chosen)
      }}
      className="flex flex-wrap gap-2"
    >
      {LINK_ICON_CHOICES.map((key) => {
        const Icon = LINK_ICONS[key]
        return (
          <RadioGroupPrimitive.Item
            key={key}
            value={key}
            aria-label={linkIconLabel(key)}
            className={CHOICE_CLASS}
          >
            <Icon aria-hidden="true" className="size-5" />
          </RadioGroupPrimitive.Item>
        )
      })}
    </RadioGroupPrimitive.Root>
  )
}
