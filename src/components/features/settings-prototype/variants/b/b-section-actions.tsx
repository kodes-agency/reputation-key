// PROTOTYPE — the section header's two controls: the property switcher, only on a
// section that is about one property, and the "Jump to" menu.
import type { SettingsPrototypeContext } from '../../settings-prototype-types'
import { JumpMenu } from './b-jump-menu'
import { isPropertyRow, type SettingsHome } from './b-model'
import { PropertySwitcher } from './b-property-switcher'

export function BJumpMenuSlot({
  home,
  open,
}: Readonly<{ home: SettingsHome; open: SettingsPrototypeContext }>) {
  const showSwitcher =
    open.shape.showPropertySwitcher &&
    isPropertyRow(open.current) &&
    home.property !== null
  return (
    <>
      {showSwitcher && home.property !== null ? (
        <PropertySwitcher ctx={open} property={home.property} />
      ) : null}
      <JumpMenu home={home} open={open} />
    </>
  )
}
