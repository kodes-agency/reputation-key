import { ListFilter, type LucideIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

export type ListMenuOption<V extends string> = Readonly<{ value: V; label: string }>

/** The choice in force as the trigger says it, or `fallback` for none (or one the options no longer offer). */
export function listMenuValueText(
  options: ReadonlyArray<ListMenuOption<string>>,
  value: string | null,
  fallback: string,
): string {
  return options.find((option) => option.value === value)?.label ?? fallback
}

/**
 * The trigger of every list menu: an outline button that reads "Label: value".
 * The label names the dimension and the value the choice in force, so the closed
 * menu already answers "what is this list showing?" (UI consistency scan: COLL-12).
 */
export function ListMenuTrigger({
  icon: Icon,
  label,
  valueText,
}: Readonly<{ icon: LucideIcon; label: string; valueText: string }>) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="outline">
        <Icon aria-hidden="true" />
        {`${label}: ${valueText}`}
      </Button>
    </DropdownMenuTrigger>
  )
}

function Options<V extends string>({
  options,
}: Readonly<{ options: ReadonlyArray<ListMenuOption<V>> }>) {
  return options.map((option) => (
    <DropdownMenuRadioItem key={option.value} value={option.value}>
      {option.label}
    </DropdownMenuRadioItem>
  ))
}

type ChoiceProps<V extends string> = Readonly<{
  /** The dimension: "Group by". */
  label: string
  icon: LucideIcon
  value: V
  options: ReadonlyArray<ListMenuOption<V>>
  onChange: (value: V) => void
}>

/**
 * One choice out of a few for how a list is shown (Group by): a "Label: value"
 * button over a radio menu. A choice that narrows the list is a `ListFilterMenu`,
 * and an order is a `ListSortMenu`.
 */
export function ListChoiceMenu<V extends string>({
  label,
  icon,
  value,
  options,
  onChange,
}: ChoiceProps<V>) {
  return (
    <DropdownMenu>
      <ListMenuTrigger
        icon={icon}
        label={label}
        valueText={listMenuValueText(options, value, value)}
      />
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as V)}
        >
          <Options options={options} />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The menu's own value for "no filter": never a real option's. */
const NO_FILTER = '__none__'

type FilterProps<V extends string> = Readonly<{
  /** The dimension: "Show". */
  label: string
  icon?: LucideIcon
  /** The filter in force, or `null` when none is. */
  value: V | null
  options: ReadonlyArray<ListMenuOption<V>>
  /** The first entry of the menu, which takes the filter off: "All properties". */
  allLabel: string
  onChange: (value: V | null) => void
}>

/**
 * A filter over a list: "Show: Needs attention", with an entry that takes it off
 * ("Show: All" while none is in force). Clear (`ClearFiltersButton`) takes off
 * every filter and the search at once.
 */
export function ListFilterMenu<V extends string>({
  label,
  icon = ListFilter,
  value,
  options,
  allLabel,
  onChange,
}: FilterProps<V>) {
  return (
    <DropdownMenu>
      <ListMenuTrigger
        icon={icon}
        label={label}
        valueText={listMenuValueText(options, value, 'All')}
      />
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuRadioGroup
          value={value ?? NO_FILTER}
          onValueChange={(next) => onChange(next === NO_FILTER ? null : (next as V))}
        >
          <DropdownMenuRadioItem value={NO_FILTER}>{allLabel}</DropdownMenuRadioItem>
          <Options options={options} />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
