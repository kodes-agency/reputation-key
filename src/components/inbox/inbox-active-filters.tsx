import { useEffect, useRef, type RefObject } from 'react'
import type { InboxSort } from '#/contexts/inbox/application/public-api'
import { ClearFiltersButton } from '#/components/ui/clear-filters-button'
import { RemovableChip } from '#/components/ui/removable-chip'
import { stripFadeStyle } from '#/components/ui/strip-scroll'
import { useStripOverflow } from '#/components/ui/use-strip-overflow'
import { activeInboxFilterChips, type InboxFilterChip } from './inbox-filter-options'
import type { InboxListFilterValues } from './inbox-filters'

type Props = Readonly<{
  filters: InboxListFilterValues
  sort: InboxSort
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  /** A search is in force: Clear takes it away too, and says so. */
  searching: boolean
  /** Drops the search and every filter in one navigation; the sort stays. */
  onClearFilters: () => void
}>

/**
 * Where focus goes once the control that held it has left the row: the chip
 * that took the removed one's place, else the one before it, else (the row is
 * gone) the Filters trigger. The removal lands a render or a navigation later,
 * so this waits, in a ref, until `removedKeys` are no longer shown.
 */
type FocusHandoff = Readonly<{
  removedKeys: ReadonlyArray<string>
  index: number
  scope: ParentNode
}>

/** The list panel around the row holds the Filters trigger; `document` if it is not in one. */
function scopeOf(control: HTMLElement): ParentNode {
  return control.closest('[data-inbox-list-panel]') ?? document
}

type RowProps = Readonly<{
  rowRef: RefObject<HTMLDivElement | null>
  chips: ReadonlyArray<InboxFilterChip>
  searching: boolean
  onRemove: (chip: InboxFilterChip, index: number, control: HTMLElement) => void
  onClearFilters: (control: HTMLElement) => void
}>

/** A filter, not the order: Clear takes these away and leaves the sort chip. */
const isFilterChip = (chip: InboxFilterChip): boolean => chip.clear.filters !== undefined

function ActiveFiltersRow({
  rowRef,
  chips,
  searching,
  onRemove,
  onClearFilters,
}: RowProps) {
  const edges = useStripOverflow(rowRef)
  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="Active filters"
      style={stripFadeStyle(edges)}
      className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b px-4 scroll-px-6 [scrollbar-width:none]"
    >
      {chips.map((chip, index) => (
        <RemovableChip
          key={chip.key}
          data-active-filter-chip
          label={chip.label}
          removeLabel={`Remove filter: ${chip.label}`}
          onRemove={(event) => onRemove(chip, index, event.currentTarget)}
        />
      ))}
      {/* One filter is its own remedy; the search counts as one more thing it takes away. */}
      {chips.filter(isFilterChip).length + (searching ? 1 : 0) >= 2 && (
        <ClearFiltersButton
          size="sm"
          searching={searching}
          // The chips' height on a phone (36px in the compact Inbox) as well: the
          // row is chips, and this is the last of them, not a control of its own.
          className="shrink-0 px-2 text-xs"
          onClear={(event) => onClearFilters(event.currentTarget)}
        />
      )}
    </div>
  )
}

/**
 * What is narrowing the list, one removable chip each. The filter sheet hides
 * its choices behind a tap; this row is what keeps a phone user from wondering
 * why the list looks short.
 */
export function InboxActiveFilters({
  filters,
  sort,
  onFiltersChange,
  onSortChange,
  searching,
  onClearFilters,
}: Props) {
  const chips = activeInboxFilterChips(filters, sort)
  const rowRef = useRef<HTMLDivElement>(null)
  const handoff = useRef<FocusHandoff | null>(null)

  // After every render, because the removal may arrive in a later one: act only
  // once the removed chips are really gone.
  useEffect(() => {
    const pending = handoff.current
    if (pending === null) return
    if (chips.some((chip) => pending.removedKeys.includes(chip.key))) return
    handoff.current = null
    const left =
      rowRef.current?.querySelectorAll<HTMLElement>('[data-active-filter-chip]') ?? []
    const next = left[Math.min(pending.index, left.length - 1)]
    // The Filters trigger, or the search field while one is open: the header shows one of them.
    const target =
      next ??
      pending.scope.querySelector<HTMLElement>(
        '[data-inbox-filter-trigger], [data-inbox-list-header] input[type=search]',
      )
    target?.focus()
  })

  if (chips.length === 0) return null

  function remove(chip: InboxFilterChip, index: number, control: HTMLElement) {
    handoff.current = { removedKeys: [chip.key], index, scope: scopeOf(control) }
    if (chip.clear.filters !== undefined) onFiltersChange(chip.clear.filters)
    if (chip.clear.sort !== undefined) onSortChange(chip.clear.sort)
  }

  function clearFilters(control: HTMLElement) {
    handoff.current = {
      removedKeys: chips.filter(isFilterChip).map((chip) => chip.key),
      index: 0,
      scope: scopeOf(control),
    }
    onClearFilters()
  }

  return (
    <ActiveFiltersRow
      rowRef={rowRef}
      chips={chips}
      searching={searching}
      onRemove={remove}
      onClearFilters={clearFilters}
    />
  )
}
