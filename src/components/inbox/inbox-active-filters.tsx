import { useEffect, useRef, type RefObject } from 'react'
import { X } from 'lucide-react'
import type { InboxSort } from '#/contexts/inbox/application/public-api'
import { Button } from '#/components/ui/button'
import { activeInboxFilterChips, type InboxFilterChip } from './inbox-filter-options'
import type { InboxListFilterValues } from './inbox-filters'
import { stripFadeStyle } from './inbox-queue-strip-scroll'
import { useStripOverflow } from './use-strip-overflow'

type Props = Readonly<{
  filters: InboxListFilterValues
  sort: InboxSort
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  /** Drops every filter and the sort in one navigation. */
  onClearAll: () => void
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
  onRemove: (chip: InboxFilterChip, index: number, control: HTMLElement) => void
  onClearAll: (control: HTMLElement) => void
}>

function ActiveFiltersRow({ rowRef, chips, onRemove, onClearAll }: RowProps) {
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
        <button
          key={chip.key}
          type="button"
          data-active-filter-chip
          aria-label={`Remove filter: ${chip.label}`}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border bg-background pr-2 pl-3 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={(event) => onRemove(chip, index, event.currentTarget)}
        >
          {chip.label}
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ))}
      {chips.length >= 2 && (
        <Button
          variant="ghost"
          className="h-8 shrink-0 px-2 text-xs"
          onClick={(event) => onClearAll(event.currentTarget)}
        >
          Clear all
        </Button>
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
  onClearAll,
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
    const target =
      next ?? pending.scope.querySelector<HTMLElement>('[data-inbox-filter-trigger]')
    target?.focus()
  })

  if (chips.length === 0) return null

  function remove(chip: InboxFilterChip, index: number, control: HTMLElement) {
    handoff.current = { removedKeys: [chip.key], index, scope: scopeOf(control) }
    if (chip.clear.filters !== undefined) onFiltersChange(chip.clear.filters)
    if (chip.clear.sort !== undefined) onSortChange(chip.clear.sort)
  }

  function clearAll(control: HTMLElement) {
    handoff.current = {
      removedKeys: chips.map((chip) => chip.key),
      index: 0,
      scope: scopeOf(control),
    }
    onClearAll()
  }

  return (
    <ActiveFiltersRow
      rowRef={rowRef}
      chips={chips}
      onRemove={remove}
      onClearAll={clearAll}
    />
  )
}
