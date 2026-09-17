import { useMemo, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
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

export type SearchableSelectOption = Readonly<{
  value: string
  /** Shown on the trigger and as the option's first line. */
  label: string
  /** A quieter second line in the list. */
  description?: string
  /** More words a search matches, besides the label and description. */
  keywords?: readonly string[]
}>

export type SearchableSelectGroup = Readonly<{
  heading?: string
  options: readonly SearchableSelectOption[]
}>

type Props = Readonly<{
  id?: string
  value: string | null
  onValueChange: (value: string) => void
  groups: readonly SearchableSelectGroup[]
  placeholder: string
  searchPlaceholder: string
  emptyMessage: string
  disabled?: boolean
  className?: string
  onBlur?: () => void
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}>

/**
 * A select whose long list can be searched: shadcn's combobox pattern, a
 * trigger button opening a filtered Command list in a Popover. The list exists
 * only while it is open, and a re-render of the page around it leaves its
 * scroll position alone.
 */
export function SearchableSelect({
  id,
  value,
  onValueChange,
  groups,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
  className,
  onBlur,
  ...aria
}: Props) {
  const [open, setOpen] = useState(false)
  const entries = useMemo(
    () =>
      groups.map((group) => ({
        heading: group.heading,
        options: group.options.map((option) => ({
          option,
          keywords: [
            option.label,
            ...(option.description ? [option.description] : []),
            ...(option.keywords ?? []),
          ],
        })),
      })),
    [groups],
  )
  const selected = useMemo(
    () =>
      groups.flatMap((group) => group.options).find((option) => option.value === value) ??
      null,
    [groups, value],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          // No aria-controls here: Radix's trigger already points it at the
          // popover, and cmdk overwrites any id given to CommandList.
          aria-expanded={open}
          disabled={disabled}
          onBlur={onBlur}
          className={cn(
            'w-full justify-between px-3 font-normal',
            !selected && 'text-muted-foreground',
            className,
          )}
          {...aria}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDownIcon aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={placeholder}
        className="w-(--radix-popover-trigger-width) min-w-72 p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {entries.map((group, index) => (
              <CommandGroup key={group.heading ?? index} heading={group.heading}>
                {group.options.map(({ option, keywords }) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={keywords}
                    onSelect={() => {
                      onValueChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <CheckIcon
                      aria-hidden="true"
                      className={cn(option.value === value ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
