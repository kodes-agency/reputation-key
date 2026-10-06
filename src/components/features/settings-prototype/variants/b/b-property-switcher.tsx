// PROTOTYPE — the property switcher: the shared searchable property list (search
// appears from eight properties) behind one outline control. It keeps the section:
// on a section page it opens the same section of the other property.
import { useState } from 'react'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { PropertyPicker } from '#/components/property/property-picker'
import { setupProgressOf } from '../../settings-prototype-fixtures'
import type {
  PropertyFixture,
  SettingsPrototypeContext,
} from '../../settings-prototype-types'
import { useGotoB } from './b-links'

/** Finished properties wear a check, the ones with a step left a warning: the setup dots of the brief. */
function SetupGlyph({ done }: Readonly<{ done: boolean }>) {
  return done ? (
    <CircleCheck aria-hidden className="text-positive" />
  ) : (
    <TriangleAlert aria-hidden className="text-warn" />
  )
}

export function PropertySwitcher({
  ctx,
  property,
}: Readonly<{ ctx: SettingsPrototypeContext; property: PropertyFixture }>) {
  const [open, setOpen] = useState(false)
  const goto = useGotoB()
  const options = ctx.data.properties.map((p) => ({
    value: p.id,
    label: p.name,
    glyph: (
      <SetupGlyph done={setupProgressOf(p, ctx.data.viewer.role).nextStep === null} />
    ),
  }))
  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      triggerLabel={property.name}
      triggerAriaLabel={`Property: ${property.name}. Change property`}
      heading="Properties"
      activeValue={property.id}
      groups={[options]}
      onSelect={(id) => {
        setOpen(false)
        goto({ scope: 'property', property: id })
      }}
      className="w-auto min-w-0 flex-1 lg:w-72 lg:flex-none"
    />
  )
}
