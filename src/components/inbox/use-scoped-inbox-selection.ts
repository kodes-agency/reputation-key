import { useCallback, useState, type SetStateAction } from 'react'
import type { InboxFilterValues } from './inbox-filters'

function selectionScope(orgId: string | undefined, filters: InboxFilterValues) {
  return JSON.stringify([
    orgId,
    filters.status,
    filters.isEscalated,
    filters.sourceType,
    filters.platform,
    filters.ratingMin,
    filters.ratingMax,
    filters.attention,
    filters.category,
    filters.propertyId,
    filters.q,
    filters.sort,
  ])
}

export function useScopedInboxSelection(
  orgId: string | undefined,
  filters: InboxFilterValues,
) {
  const scope = selectionScope(orgId, filters)
  const [selection, setSelection] = useState<{
    scope: string
    ids: ReadonlyArray<string>
  }>({ scope, ids: [] })
  const selectedIds = selection.scope === scope ? selection.ids : []
  const setSelectedIds = useCallback(
    (next: SetStateAction<ReadonlyArray<string>>) => {
      setSelection((current) => {
        const currentIds = current.scope === scope ? current.ids : []
        return {
          scope,
          ids: typeof next === 'function' ? next(currentIds) : next,
        }
      })
    },
    [scope],
  )
  return { selectedIds, setSelectedIds } as const
}
