// PROTOTYPE — variant A. The property chip that heads the rail from two properties
// on: the app's own switcher tile (initials disc, name, up-down chevrons) opening the
// shared searchable property list. Its first entry is All properties (admins); the
// others keep the open section; the last jumps to the next property still to finish.
import { useRef, useState } from 'react'
import {
  ArrowRight,
  Building2,
  ChevronsUpDown,
  CircleAlert,
  CircleCheck,
} from 'lucide-react'
import { personInitials } from '#/components/inbox/person-initials'
import {
  PropertyPickerList,
  focusPropertyPicker,
} from '#/components/property/property-picker'
import { sortPropertiesByName } from '#/components/property/property-search'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import type { SettingsPrototypeHref, SettingsRail } from '../../settings-prototype-types'
import { useVariantAGoto } from './variant-a-nav'

const ALL = 'all'
const NEXT = 'next'

type Switcher = NonNullable<SettingsRail['switcher']>

/** The 32 px tile: initials for a property, a building for All properties. */
export function IdentityTile({ name }: Readonly<{ name: string | null }>) {
  const initials = name === null ? null : personInitials(name)
  return (
    <span
      aria-hidden
      className="flex aspect-square size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-(--accent)"
    >
      {initials ?? <Building2 className="size-4 text-link" />}
    </span>
  )
}

function glyphOf(done: number, total: number) {
  return done >= total ? (
    <CircleCheck className="text-positive" aria-hidden />
  ) : (
    <CircleAlert className="text-warn" aria-hidden />
  )
}

export function PropertyChip({
  switcher,
  title,
  subtitle,
  tileName,
  keepSection,
}: Readonly<{
  switcher: Switcher
  title: string
  subtitle: string
  /** The property the tile shows initials for; null while All properties is open. */
  tileName: string | null
  /** False on a phone's index, where picking a property must not open a section. */
  keepSection: boolean
}>) {
  const [open, setOpen] = useState(false)
  const goto = useVariantAGoto()
  const popover = useRef<HTMLDivElement>(null)
  const hrefs = new Map<string, SettingsPrototypeHref>([
    ...(switcher.all === null ? [] : [[ALL, switcher.all.href] as const]),
    ...switcher.items.map((item) => [item.id, item.href] as const),
    ...(switcher.nextToFinishHref === null
      ? []
      : [[NEXT, switcher.nextToFinishHref] as const]),
  ])
  const groups = [
    ...(switcher.all === null
      ? []
      : [
          [
            {
              value: ALL,
              label: 'All properties',
              glyph: <Building2 className="text-muted-foreground" aria-hidden />,
            },
          ],
        ]),
    sortPropertiesByName(switcher.items).map((item) => ({
      value: item.id,
      label: item.name,
      glyph: glyphOf(item.done, item.total),
    })),
    ...(switcher.nextToFinishHref === null
      ? []
      : [
          [
            {
              value: NEXT,
              label: 'Next property to finish',
              glyph: <ArrowRight className="text-muted-foreground" aria-hidden />,
            },
          ],
        ]),
  ]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`${title}. Switch property`}
          className="h-auto w-full justify-start gap-3 rounded-lg px-2.5 py-2 text-left font-normal"
        >
          <IdentityTile name={tileName} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Switch property"
        className="w-(--radix-popover-trigger-width) min-w-72 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focusPropertyPicker(popover.current)
        }}
      >
        <div ref={popover}>
          <PropertyPickerList
            groups={groups}
            activeValue={switcher.currentId ?? (switcher.all === null ? null : ALL)}
            heading="Properties"
            onSelect={(value) => {
              const href = hrefs.get(value)
              setOpen(false)
              if (href !== undefined) goto(href, { keepSection })
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
