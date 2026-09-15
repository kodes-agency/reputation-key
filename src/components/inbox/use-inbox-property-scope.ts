// The Inbox's property scope as rendered: the route's choices, sorted, with each
// property's count for the queue in view. Counted only when there is a choice.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { InboxQueue } from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  offersPropertyScope,
  sortScopeProperties,
  type InboxPropertyScope,
  type InboxPropertyScopeInput,
} from './inbox-property-scope'
import type { InboxServerFns } from './types'

export function useInboxPropertyScope(
  input: InboxPropertyScopeInput | undefined,
  queue: InboxQueue,
  hasOrganization: boolean,
  getInboxPropertyCounts: InboxServerFns['getInboxPropertyCounts'],
): InboxPropertyScope | null {
  const properties = useMemo(
    () => sortScopeProperties(input?.properties ?? []),
    [input?.properties],
  )
  const isOffered = input !== undefined && offersPropertyScope(properties)
  const { data: counts } = useQuery({
    queryKey: inboxKeys.propertyCountsFor(queue),
    queryFn: () => getInboxPropertyCounts({ data: { queue } }),
    enabled: hasOrganization && isOffered,
    staleTime: 0,
  })

  return input && isOffered ? { ...input, properties, counts } : null
}
