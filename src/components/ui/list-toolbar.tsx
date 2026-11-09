import type * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * The one row a list's search, filter, sort and count sit in: `SearchField`,
 * `ListFilterMenu`, `ListChoiceMenu`, `ListSortMenu`, `ResultCount` and
 * `ClearFiltersButton` (the last two sit in a `ListToolbarStatus`). It wraps rather
 * than scrolls: a phone shows the search on its own line and the menus below.
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

/**
 * The `ResultCount` and the Clear beside it, as one unit. A ghost Clear that wrapped
 * alone would start a line 16px in from the search field (its own padding); together
 * they wrap as one, the count at the gutter and Clear after it.
 */
function ListToolbarStatus({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-toolbar-status"
      className={cn('flex items-center gap-2', className)}
      {...props}
    />
  )
}

export { ListToolbar, ListToolbarStatus }
