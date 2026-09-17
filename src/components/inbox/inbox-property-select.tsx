// The Inbox's property select: whose work the queues below are counting. It sits
// above the queues in the rail, because the scope decides their counts, and on
// the list header's scope line below the desktop floor, where there is no rail.
// Each option counts the queue in view, so where the backlog sits is one click
// away.
import { useId, useState, type ComponentProps } from 'react'
import { Building2, CheckIcon, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import type { InboxQueue } from '#/contexts/inbox/application/public-api'
import { cn } from '#/lib/utils'
import {
  matchesScopeSearch,
  offersScopeSearch,
  scopeCount,
  type InboxPropertyScope,
} from './inbox-property-scope'
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

function PropertyOption({
  value,
  label,
  count,
  isCurrent,
  withGlyph = false,
  onSelect,
}: Readonly<{
  value: string
  label: string
  count: number | undefined
  isCurrent: boolean
  withGlyph?: boolean
  onSelect: () => void
}>) {
  return (
    <CommandItem
      value={value}
      keywords={[label]}
      aria-current={isCurrent ? 'true' : undefined}
      // A finger-sized row on phones, where this list opens from the header.
      className="min-h-9 max-md:min-h-11"
      onSelect={onSelect}
    >
      {withGlyph ? (
        <Building2 aria-hidden="true" />
      ) : (
        <span className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
      <CheckIcon
        aria-hidden="true"
        className={cn('text-foreground', isCurrent ? 'opacity-100' : 'opacity-0')}
      />
    </CommandItem>
  )
}

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
  const listId = useId()
  const headingId = useId()
  const counts = useInboxPropertyCounts(queue, open, getInboxPropertyCounts)
  const choose = (propertyId: string | null) => {
    setOpen(false)
    scope.onSelect(propertyId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger
          placement={placement}
          scopeLabel={scopeLabel}
          role="combobox"
          aria-label={`Property: ${scopeLabel}`}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-labelledby={headingId}
        className={cn(
          'p-0',
          placement === 'rail' ? 'w-(--radix-popover-trigger-width) min-w-64' : 'w-64',
        )}
      >
        <Command
          filter={(_value, search, keywords) =>
            keywords?.some((keyword) => matchesScopeSearch(keyword, search)) ? 1 : 0
          }
        >
          {offersScopeSearch(scope.properties) && (
            <CommandInput
              placeholder="Search properties"
              aria-label="Search properties"
            />
          )}
          <p
            id={headingId}
            className="px-3 pt-2.5 pb-1 text-xs font-medium text-muted-foreground"
          >
            {queueLabel(queue)} by property
          </p>
          <CommandList id={listId} aria-labelledby={headingId}>
            <CommandEmpty>No property matches</CommandEmpty>
            {scope.includeAll && (
              // A border, not a CommandSeparator: a separator is not an
              // allowed child of a listbox (axe aria-required-children).
              <CommandGroup className="border-b">
                <PropertyOption
                  value={ALL_PROPERTIES}
                  label="All properties"
                  count={scopeCount(counts, null)}
                  isCurrent={scope.activePropertyId === null}
                  withGlyph
                  onSelect={() => choose(null)}
                />
              </CommandGroup>
            )}
            <CommandGroup>
              {scope.properties.map((property) => (
                <PropertyOption
                  key={property.id}
                  value={property.id}
                  label={property.name}
                  count={scopeCount(counts, property.id)}
                  isCurrent={property.id === scope.activePropertyId}
                  onSelect={() => choose(property.id)}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
