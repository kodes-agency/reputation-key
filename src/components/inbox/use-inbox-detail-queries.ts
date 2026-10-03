// The two reads behind the Inbox detail pane, and what the pane derives from
// them: the item with its detail, the notes, the error, and the retry.
import { queryOptions, useQuery } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import { replyRefetchInterval } from './inbox-cache-policy'
import { useTargetDeadlineRefresh } from './response-target-deadline-refresh'
import type { InboxServerFns } from './types'

const inboxDetailQueryOptions = (
  id: string,
  getInboxItemDetail: InboxServerFns['getInboxItemDetail'],
) =>
  queryOptions({
    queryKey: inboxKeys.detail(id),
    queryFn: () => getInboxItemDetail({ data: { inboxItemId: id } }),
    staleTime: 0,
  })

export function useInboxDetailQueries(
  inboxFns: Pick<InboxServerFns, 'getInboxItemDetail' | 'getInboxNotes'>,
  id: string,
  enabled: boolean,
  fallbackItem: InboxItem | null,
) {
  const detailQuery = useQuery({
    ...inboxDetailQueryOptions(id, inboxFns.getInboxItemDetail),
    enabled,
    refetchInterval: (query) => replyRefetchInterval(query.state.data?.reply),
  })
  const notesQuery = useQuery({
    queryKey: inboxKeys.notes(id),
    queryFn: () => inboxFns.getInboxNotes({ data: { inboxItemId: id } }),
    enabled,
    staleTime: 0,
  })
  useTargetDeadlineRefresh(enabled, detailQuery.data?.responseTarget, detailQuery.refetch)

  const detail = detailQuery.data ?? null
  return {
    detail,
    notes: notesQuery.data ?? [],
    // Unavailable means there is nothing to show. A background refetch that
    // fails after an earlier success leaves the notes on screen, and saying
    // they are unavailable beneath them would contradict what the rail shows.
    notesUnavailable: notesQuery.isError && notesQuery.data === undefined,
    isLoading: detailQuery.isLoading || notesQuery.isLoading,
    currentItem: detail?.item ?? fallbackItem,
    error: hasFailed(detailQuery) ? 'This item couldn’t be loaded.' : null,
    retrying: isRetrying(detailQuery, notesQuery),
    refetch: () => {
      void detailQuery.refetch()
      void notesQuery.refetch()
    },
    polledStatus: detailQuery.data?.item.status,
    polledReply: detailQuery.data?.reply,
  }
}
