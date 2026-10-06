// PROTOTYPE — variant C, phone. The sidebar is a sheet there (it holds the same
// Settings block), so the page header carries the way around Settings itself: a
// property picker from two properties, a section picker, and the setup meter.
// Hidden from `md`, where the sidebar is on screen.
import { useState } from 'react'
import { PropertyPicker } from '#/components/property/property-picker'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { useSettingsPrototypeGoto } from '../../settings-prototype-nav'
import type { SettingsPrototypeContext } from '../../settings-prototype-types'
import { propertyChoicesOf } from './c-property-chip'
import { SetupMeter } from './c-sidebar-rows'

function PropertyField({ ctx }: Readonly<{ ctx: SettingsPrototypeContext }>) {
  const [open, setOpen] = useState(false)
  const goto = useSettingsPrototypeGoto()
  const choices = propertyChoicesOf(ctx)
  if (choices === null) return null
  const name = ctx.property?.name ?? 'All properties'
  return (
    <PropertyPicker
      open={open}
      onOpenChange={setOpen}
      triggerLabel={name}
      triggerAriaLabel={`${ctx.shape.businessLabel}: ${name}`}
      groups={choices.groups}
      activeValue={choices.activeValue}
      heading="Properties"
      onSelect={(value) => {
        const href = choices.hrefs.get(value)
        setOpen(false)
        if (href !== undefined) goto(href)
      }}
    />
  )
}

function SectionField({ ctx }: Readonly<{ ctx: SettingsPrototypeContext }>) {
  const goto = useSettingsPrototypeGoto()
  const group = ctx.rail.groups.find((candidate) => candidate.key === ctx.current.group)
  return (
    <Select
      value={ctx.current.key}
      onValueChange={(key) => {
        const row = ctx.rows.find((candidate) => candidate.key === key)
        if (row !== undefined) goto(row.href)
      }}
    >
      <SelectTrigger aria-label="Settings section" className="w-full">
        {/* The group and the section, so the trigger says where in Settings this is. */}
        <SelectValue>
          {group?.label ? `${group.label} · ` : ''}
          {ctx.current.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ctx.rail.groups.map((group) => (
          <SelectGroup key={group.key}>
            <SelectLabel>{group.label === '' ? 'More' : group.label}</SelectLabel>
            {group.rows.map((row) => (
              <SelectItem key={row.key} value={row.key}>
                {row.label}
                {row.locked ? ' (read only)' : ''}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PhonePickers({ ctx }: Readonly<{ ctx: SettingsPrototypeContext }>) {
  return (
    <div className="space-y-3 md:hidden">
      <PropertyField ctx={ctx} />
      <SectionField ctx={ctx} />
      <SetupMeter setup={ctx.rail.setup} className="px-0" />
    </div>
  )
}
