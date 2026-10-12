import type * as React from 'react'

import { Button, type ButtonProps } from '#/components/ui/button'

/**
 * What the control says (UI consistency scan: COLL-22). "Clear" meant the search
 * and the filter on the Properties list, only the filters in the Inbox's popover
 * and the filters and the sort in its sheet, under four wordings. One control
 * now clears what narrows a list, the search and the filters, and never the sort
 * (the sort is a view of the list, not a cut of it). It says so: "Clear filters",
 * or "Clear search and filters" while a search is in force. A list that has no
 * filter to clear (All properties, Google import) says only what it takes away,
 * "Clear search", rather than promise a reset that does not exist.
 */
export function clearFiltersLabel(searching: boolean, filters = true): string {
  if (!filters) return 'Clear search'
  return searching ? 'Clear search and filters' : 'Clear filters'
}

type Props = Omit<ButtonProps, 'children' | 'onClick' | 'asChild' | 'pending'> &
  Readonly<{
    /** A search is in force, so the control clears it too and says so. */
    searching: boolean
    /** The list has filters. `false` for a list with only a search: Clear then says "Clear search". */
    filters?: boolean
    onClear: (event: React.MouseEvent<HTMLButtonElement>) => void
  }>

/**
 * The one Clear control of a list: a ghost button beside the toolbar, the outline
 * button of an empty result (`variant="outline"`), a small one in a popover
 * header (`size="xs"`). Show it only while something narrows the list, or
 * `disabled` where it has a fixed place.
 */
export function ClearFiltersButton({
  searching,
  filters = true,
  onClear,
  variant = 'ghost',
  ...props
}: Props) {
  return (
    <Button type="button" variant={variant} onClick={onClear} {...props}>
      {clearFiltersLabel(searching, filters)}
    </Button>
  )
}
