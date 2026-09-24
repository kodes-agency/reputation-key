// The Inbox's property select: whose work the queues below are counting. It sits
// above the queues in the rail, because the scope decides their counts, and on
// the list header's scope line below the desktop floor, where there is no rail.
// Each option counts the queue in view, so where the backlog sits is one click
// away.
import { useRef, useState, type ComponentProps } from 'react'
import { Building2, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import {
  focusPropertyPicker,
  PropertyPickerList,
  type PropertyPickerOption,
} from '#/components/property/property-picker'
import type { InboxQueue } from '#/contexts/inbox/application/public-api'
import { cn } from '#/lib/utils'
import { scopeCount, type InboxPropertyScope } from './inbox-property-scope'
import { queueLabel } from './inbox-queues'
import type { InboxServerFns } from './types'
import { useInboxPropertyCounts } from './use-inbox-property-scope'

/** cmdk value for the organization-wide scope; property ids are UUIDs. */
const ALL_PROPERTIES = 'all'

type Props = Readonly<{
  scope: InboxPropertyScope
  /** The scope in view, as the trigger names it. */
  scopeLabel: string
  /** The queue in view: its counts fill the list. */
  queue: InboxQueue
  /** `rail`: a full-width control above the queues. `header`: the list header's scope line. */
  placement: 'rail' | 'header'
  getInboxPropertyCounts: InboxServerFns['getInboxPropertyCounts']
}>

function Trigger({
  placement,
  scopeLabel,
  ...props
}: Readonly<{ placement: Props['placement']; scopeLabel: string }> &
  ComponentProps<'button'>) {
  if (placement === 'header') {
    return (
      <button
        type="button"
        className="flex max-w-full min-w-0 items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 max-md:h-9 max-md:rounded-md max-md:px-2 max-md:text-[13px] max-md:font-medium max-md:text-foreground"
        {...props}
      >
        <span className="truncate">{scopeLabel}</span>
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full justify-between gap-2 text-[13px] font-medium"
      {...props}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{scopeLabel}</span>
      </span>
      <ChevronsUpDown aria-hidden="true" className="opacity-50" />
    </Button>
  )
}

export function InboxPropertySelect({
  scope,
  scopeLabel,
  queue,
  placement,
  getInboxPropertyCounts,
}: Props) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const counts = useInboxPropertyCounts(queue, open, getInboxPropertyCounts)
  const heading = `${queueLabel(queue)} by property`
  const choose = (value: string) => {
    setOpen(false)
    scope.onSelect(value === ALL_PROPERTIES ? null : value)
  }

  const allProperties: PropertyPickerOption[] = scope.includeAll
    ? [
        {
          value: ALL_PROPERTIES,
          label: 'All properties',
          count: scopeCount(counts, null),
          glyph: <Building2 aria-hidden="true" />,
        },
      ]
    : []
  const groups = [
    ...(allProperties.length > 0 ? [allProperties] : []),
    scope.properties.map((property) => ({
      value: property.id,
      label: property.name,
      count: scopeCount(counts, property.id),
    })),
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger
          placement={placement}
          scopeLabel={scopeLabel}
          role="combobox"
          aria-label={`Property: ${scopeLabel}`}
          aria-expanded={open}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // The popover is a dialog, so it needs a name of its own; the list's
        // heading is that name (axe aria-dialog-name).
        aria-label={heading}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focusPropertyPicker(contentRef.current)
        }}
        className={cn(
          'p-0',
          placement === 'rail' ? 'w-(--radix-popover-trigger-width) min-w-64' : 'w-64',
        )}
      >
        <div ref={contentRef}>
          <PropertyPickerList
            groups={groups}
            activeValue={scope.activePropertyId ?? ALL_PROPERTIES}
            heading={heading}
            onSelect={choose}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
