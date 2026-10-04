import type * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * The one row a list's search, filter, sort and count sit in (UI consistency
 * scan: COLL-06, COLL-12). The Properties list and the Portals overview each drew
 * this row by hand and had drifted; the parts that go in it are `SearchField`,
 * `ListFilterMenu`, `ListChoiceMenu`, `ListSortMenu`, `ResultCount` and
 * `ClearFiltersButton`.
 *
 * It wraps rather than scrolls: a phone shows the search on a line of its own
 * and the menus below it. The Inbox keeps its own compact header (an icon that
 * opens the search, a popover or a sheet for the rest) and composes the same
 * parts inside it.
 */
function ListToolbar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-toolbar"
      className={cn('flex flex-wrap items-center gap-2', className)}
      {...props}
    />
  )
}

export { ListToolbar }
