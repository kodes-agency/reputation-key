import { useCallback, useState, type SetStateAction } from 'react'
import type { InboxQueue } from '#/contexts/inbox/application/public-api'
import type { InboxFilterValues } from './inbox-filters'

function selectionScope(
  orgId: string | undefined,
  queue: InboxQueue,
  filters: InboxFilterValues,
) {
  return JSON.stringify([
    orgId,
    queue,
    filters.sourceType,
    filters.ratingMin,
    filters.ratingMax,
    filters.attention,
    filters.aspect,
    filters.polarity,
    filters.propertyId,
    filters.q,
    filters.sort,
  ])
}

export function useScopedInboxSelection(
  orgId: string | undefined,
  queue: InboxQueue,
  filters: InboxFilterValues,
) {
  const scope = selectionScope(orgId, queue, filters)
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
