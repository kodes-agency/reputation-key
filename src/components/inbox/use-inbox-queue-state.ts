import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { inboxKeys } from '#/shared/queries/query-keys'
import { canUseReplyQueues, resolveReplyStages } from './inbox-queues'
import { resolveInboxQueue, type InboxQueueViewer } from './inbox-queue-sections'
import { offeredListFilters } from './inbox-filter-offer'
import type { InboxFilterValues } from './inbox-filters'
import type { InboxSearchParams } from './inbox-search-schema'
import type { InboxServerFns } from './types'

export function useInboxQueueState(
  orgId: string | undefined,
  search: InboxSearchParams,
  getInboxQueueCounts: InboxServerFns['getInboxQueueCounts'],
) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  // Counts depend on the scope, not the queue: their reply-stage answer decides
  // which queue the page can show, including before capability reads finish.
  const queueCounts = useQuery({
    queryKey: inboxKeys.countsFor(search.propertyId),
    queryFn: () => getInboxQueueCounts({ data: { propertyId: search.propertyId } }),
    enabled: !!orgId,
    staleTime: 0,
  })
  const canManageReplies = resolveReplyStages(
    queueCounts.data,
    canUseReplyQueues(can('reply.manage'), has('property.publish_reply')),
  )
  const canReadReviews = can('review.read')
  const canReadFeedback = can('feedback.read')
  const queueViewer: InboxQueueViewer = useMemo(
    () => ({ canManageReplies, canReadReviews, canReadFeedback }),
    [canManageReplies, canReadReviews, canReadFeedback],
  )
  const queue = resolveInboxQueue(search.queue, queueViewer)
  const filters: InboxFilterValues = useMemo(
    () => ({
      propertyId: search.propertyId ?? undefined,
      ...offeredListFilters(queue, {
        sourceType: search.sourceType ?? undefined,
        ratingMin: search.ratingMin ?? undefined,
        ratingMax: search.ratingMax ?? undefined,
        attention: search.attention ?? undefined,
        aspect: search.aspect ?? undefined,
        polarity: search.polarity ?? undefined,
        issue: search.issue ?? undefined,
        since: search.since ?? undefined,
        until: search.until ?? undefined,
      }),
      q: search.q ?? undefined,
      sort: search.sort ?? 'newest',
    }),
    [
      search.propertyId,
      search.sourceType,
      search.ratingMin,
      search.ratingMax,
      search.attention,
      search.aspect,
      search.polarity,
      search.issue,
      search.since,
      search.until,
      search.q,
      search.sort,
      queue,
    ],
  )

  return { queue, canManageReplies, queueViewer, queueCounts: queueCounts.data, filters }
}
