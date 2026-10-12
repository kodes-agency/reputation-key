import { ArrowDownUp } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '#/components/ui/dropdown-menu'
import { ListMenuTrigger } from '#/components/ui/list-choice-menu'
import { directionsFor, type SortDirection } from '#/components/ui/list-sort'

type Props<S extends string> = Readonly<{
  sort: S
  dir: SortDirection
  /** The sorts on offer, already without the ones this reader cannot use. */
  options: ReadonlyArray<S>
  labels: Readonly<Record<S, string>>
  /** How each direction reads for each sort: "A to Z" and "Z to A", "Most first" and "Fewest first". */
  directionLabels: Readonly<Record<S, Readonly<Record<SortDirection, string>>>>
  defaultDirection: (sort: S) => SortDirection
  /** A new sort drops the direction (`dir: undefined`), so it starts at its own natural one. */
  onChange: (next: { sort: S; dir: SortDirection | undefined }) => void
}>

/**
 * The order of a list, in a menu at every width (UI consistency scan: COLL-06,
 * COLL-12): "Sort: Name", the sorts, then the two directions with the sort's
 * natural one first. A stacked phone layout has no column headers to click, so
 * the menu is the one control that is always there.
 */
export function ListSortMenu<S extends string>({
  sort,
  dir,
  options,
  labels,
  directionLabels,
  defaultDirection,
  onChange,
}: Props<S>) {
  return (
    <DropdownMenu>
      <ListMenuTrigger icon={ArrowDownUp} label="Sort" valueText={labels[sort]} />
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(next) => onChange({ sort: next as S, dir: undefined })}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {labels[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={dir}
          onValueChange={(next) => onChange({ sort, dir: next as SortDirection })}
        >
          {directionsFor(defaultDirection(sort)).map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {directionLabels[sort][option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
