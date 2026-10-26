// The row of a group that is either the property's or the portal's own (Colours,
// Name and logo): what it follows and what that is worth, and the one button that
// starts a value of its own or gives it back. It is written at once, the button is
// busy while it runs, and a refusal is a toast (the group's draft is untouched).
import type { ReactNode } from 'react'
import { InheritedSetting } from '#/components/forms/inherited-setting'
import { PropertyLookLink } from './portal-look-property-link'
import { usePortalLookSwitch } from './use-portal-look-draft'

type Props = Readonly<{
  propertyId: string
  /** What the property has, in words: "accent #B8860B, automatic background". */
  value: ReactNode
  /** The portal has a value of its own. */
  isOwn: boolean
  inheritLabel: string
  overrideLabel: string
  /** Writes the group's mode; "own" starts from the property's values. */
  onSwitch: (mode: 'inherit' | 'own') => Promise<unknown>
}>

export function PortalLookGroupSetting({
  propertyId,
  value,
  isOwn,
  inheritLabel,
  overrideLabel,
  onSwitch,
}: Props) {
  const { isPending, run } = usePortalLookSwitch()
  return (
    <InheritedSetting
      source={<PropertyLookLink propertyId={propertyId} />}
      value={value}
      overridden={isOwn}
      commit="immediate"
      pending={isPending}
      inheritLabel={inheritLabel}
      overrideLabel={overrideLabel}
      onInherit={() => void run(() => onSwitch('inherit'))}
      onOverride={() => void run(() => onSwitch('own'))}
    />
  )
}
