// The searchable property list, shared by every surface that asks "which
// property?" — the Inbox's scope select (#582) and the notification settings
// page, which had a plain <select> a thirty-property manager had to scroll.
//
// The list is the shared part. Each surface keeps its own trigger: the Inbox
// has two placements and its own counts, settings has a labelled field.

import { useId, useRef, type ReactNode } from 'react'
import { CheckIcon, ChevronsUpDown } from 'lucide-react'
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
import { cn } from '#/lib/utils'
import { matchesPropertySearch, offersPropertySearch } from './property-search'

export type PropertyPickerOption = Readonly<{
  /** cmdk value; property ids are UUIDs, so they never collide with a keyword. */
  value: string
  label: string
  /** Shown right-aligned when it is worth counting, e.g. an Inbox queue. */
  count?: number
  /** A glyph for an option that is not one property, like "All properties". */
  glyph?: ReactNode
}>

type ListProps = Readonly<{
  /** Rendered in order; a group after the first is separated by a border. */
  groups: ReadonlyArray<ReadonlyArray<PropertyPickerOption>>
  /** The option in view: the keyboard cursor starts there, not on row one. */
  activeValue: string | null
  heading: string
  searchLabel?: string
  emptyLabel?: string
  onSelect: (value: string) => void
}>

function Option({
  option,
  isCurrent,
  onSelect,
}: Readonly<{
  option: PropertyPickerOption
  isCurrent: boolean
  onSelect: () => void
}>) {
  return (
    <CommandItem
      value={option.value}
      keywords={[option.label]}
      aria-current={isCurrent ? 'true' : undefined}
      // A finger-sized row on phones, where this list opens from a header.
      className="min-h-9 max-md:min-h-11"
      onSelect={onSelect}
    >
      {option.glyph ?? <span className="size-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      {option.count !== undefined && option.count > 0 && (
        <span className="text-xs tabular-nums text-muted-foreground">{option.count}</span>
      )}
      <CheckIcon
        aria-hidden="true"
        className={cn('text-foreground', isCurrent ? 'opacity-100' : 'opacity-0')}
      />
    </CommandItem>
  )
}

/**
 * Radix focuses the first tabbable element when a popover opens, and without a
 * search field there is none: focus fell on the popover itself, outside cmdk's
 * root, so arrow keys and Enter never reached the list. The field when there is
 * one, otherwise the list's own root, which carries `tabIndex={-1}`.
 */
export function focusPropertyPicker(container: HTMLElement | null): void {
  const search = container?.querySelector('input')
  const root = container?.querySelector<HTMLElement>('[data-slot="command"]')
  ;(search ?? root)?.focus()
}

export function PropertyPickerList({
  groups,
  activeValue,
  heading,
  searchLabel = 'Search properties',
  emptyLabel = 'No property matches',
  onSelect,
}: ListProps) {
  const headingId = useId()
  const commandRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const total = groups.reduce((count, group) => count + group.length, 0)

  return (
    <Command
      ref={commandRef}
      tabIndex={-1}
      className="outline-none"
      // The keyboard cursor starts on the option in view, not the first row.
      defaultValue={activeValue ?? undefined}
      filter={(_value, search, keywords) =>
        keywords?.some((keyword) => matchesPropertySearch(keyword, search)) ? 1 : 0
      }
    >
      {offersPropertySearch(total) && (
        <CommandInput
          ref={searchRef}
          placeholder={searchLabel}
          aria-label={searchLabel}
        />
      )}
      <p
        id={headingId}
        className="px-3 pt-2.5 pb-1 text-xs font-medium text-muted-foreground"
      >
        {heading}
      </p>
      <CommandList aria-labelledby={headingId}>
        <CommandEmpty>{emptyLabel}</CommandEmpty>
        {groups.map((group, index) => (
          <CommandGroup
            // Group membership is positional and stable for the life of the
            // list; there is no other identity to key on.
            key={group[0]?.value ?? index}
            // A border, not a CommandSeparator: a separator is not an allowed
            // child of a listbox (axe aria-required-children).
            className={index < groups.length - 1 ? 'border-b' : undefined}
          >
            {group.map((option) => (
              <Option
                key={option.value}
                option={option}
                isCurrent={option.value === activeValue}
                onSelect={() => onSelect(option.value)}
              />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}

type PickerProps = ListProps &
  Readonly<{
    open: boolean
    onOpenChange: (open: boolean) => void
    /** What the closed control says, and what its accessible name repeats. */
    triggerLabel: string
    triggerId?: string
    triggerAriaLabel: string
    className?: string
  }>

/**
 * The list behind a labelled outline trigger — the shape a settings field
 * wants. A surface with its own trigger (the Inbox rail and list header) uses
 * `PropertyPickerList` directly.
 */
export function PropertyPicker({
  open,
  onOpenChange,
  triggerLabel,
  triggerId,
  triggerAriaLabel,
  className,
  ...list
}: PickerProps) {
  const commandRef = useRef<HTMLDivElement>(null)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={triggerId}
          variant="outline"
          role="combobox"
          aria-label={triggerAriaLabel}
          aria-expanded={open}
          className={cn(
            'h-11 min-h-11 w-full justify-between gap-2 font-normal',
            className,
          )}
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronsUpDown aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // The popover is a dialog, so it needs a name of its own (axe
        // aria-dialog-name); the list's heading is that name.
        aria-label={list.heading}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focusPropertyPicker(commandRef.current)
        }}
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
      >
        <div ref={commandRef}>
          <PropertyPickerList {...list} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
