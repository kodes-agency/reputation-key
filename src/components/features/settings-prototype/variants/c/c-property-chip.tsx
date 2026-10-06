// PROTOTYPE — variant C. From two properties the group header of the Settings block
// is a chip: the property whose sections the rows below open. Its list is the
// product's own searchable property list (the Inbox scope select uses it), with
// All properties first for an admin. Choosing keeps the section (the rail's hrefs
// already do), and the list ends with "Next property to finish".
import { useRef, useState } from 'react'
import { Building2, ChevronsUpDown } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import {
  focusPropertyPicker,
  PropertyPickerList,
  type PropertyPickerOption,
} from '#/components/property/property-picker'
import { useSettingsPrototypeGoto } from '../../settings-prototype-nav'
import type {
  SettingsPrototypeContext,
  SettingsPrototypeHref,
} from '../../settings-prototype-types'
import { StatusMark } from './c-sidebar-rows'

const ALL = 'all'

/** Two letters for the avatar: "Old Town Bistro" is OT. */
export function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .map((word) => word.charAt(0))
    .join('')
  return letters.slice(0, 2).toUpperCase() || '·'
}

type Choices = Readonly<{
  groups: ReadonlyArray<ReadonlyArray<PropertyPickerOption>>
  hrefs: ReadonlyMap<string, SettingsPrototypeHref>
  activeValue: string
}>

/** The list's options and where each one goes; shared by the chip and the phone picker. */
export function propertyChoicesOf(ctx: SettingsPrototypeContext): Choices | null {
  const switcher = ctx.rail.switcher
  if (switcher === null) return null
  const hrefs = new Map<string, SettingsPrototypeHref>()
  const all: PropertyPickerOption[] = []
  if (switcher.all !== null) {
    hrefs.set(ALL, switcher.all.href)
    all.push({
      value: ALL,
      label: 'All properties',
      glyph: <Building2 aria-hidden="true" />,
    })
  }
  const properties = switcher.items.map((item) => {
    hrefs.set(item.id, item.href)
    return {
      value: item.id,
      label: item.name,
      // A dot beside the name: amber while a step is unfinished.
      glyph: <StatusMark tone={item.done === item.total ? 'ok' : 'needs'} />,
    }
  })
  return {
    groups: all.length > 0 ? [all, properties] : [properties],
    hrefs,
    activeValue: switcher.currentId ?? ALL,
  }
}

export function PropertyChip({ ctx }: Readonly<{ ctx: SettingsPrototypeContext }>) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const goto = useSettingsPrototypeGoto()
  const choices = propertyChoicesOf(ctx)
  const next = ctx.rail.switcher?.nextToFinishHref ?? null
  if (choices === null) return null

  const name = ctx.property?.name ?? 'All properties'
  const choose = (value: string) => {
    const href = choices.hrefs.get(value)
    setOpen(false)
    if (href !== undefined) goto(href)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`${ctx.shape.businessLabel}: ${name}`}
          className="h-auto w-full justify-start gap-2 border-sidebar-border px-2 py-1.5 text-left font-normal hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
        >
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-[10px] font-semibold text-(--accent)"
          >
            {ctx.property === null ? (
              <Building2 className="size-3.5" />
            ) : (
              initialsOf(ctx.property.name)
            )}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          <ChevronsUpDown aria-hidden="true" className="ml-auto opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Properties"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focusPropertyPicker(contentRef.current)
        }}
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
      >
        <div ref={contentRef}>
          <PropertyPickerList
            groups={choices.groups}
            activeValue={choices.activeValue}
            heading="Properties"
            onSelect={choose}
          />
          {next !== null ? (
            <div className="border-t p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false)
                  goto(next)
                }}
              >
                Next property to finish
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
