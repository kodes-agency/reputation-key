// The Inbox's property scope as rendered, and the per-property counts its select
// lists. The counts are read only while the select is open: nobody sees them
// otherwise, and each queue has its own.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  InboxPropertyCounts,
  InboxQueue,
} from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  offersPropertyScope,
  sortScopeProperties,
  type InboxPropertyScope,
  type InboxPropertyScopeInput,
} from './inbox-property-scope'
import type { InboxServerFns } from './types'

/** The route's choices sorted by name, or null when there is no choice to make. */
export function useInboxPropertyScope(
  input: InboxPropertyScopeInput | undefined,
): InboxPropertyScope | null {
  const properties = useMemo(
    () => sortScopeProperties(input?.properties ?? []),
    [input?.properties],
  )
  return input && offersPropertyScope(properties) ? { ...input, properties } : null
}

export function useInboxPropertyCounts(
  queue: InboxQueue,
  enabled: boolean,
  getInboxPropertyCounts: InboxServerFns['getInboxPropertyCounts'],
): InboxPropertyCounts | undefined {
  const { data } = useQuery({
    queryKey: inboxKeys.propertyCountsFor(queue),
    queryFn: () => getInboxPropertyCounts({ data: { queue } }),
    enabled,
    staleTime: 0,
  })
  return data
}
