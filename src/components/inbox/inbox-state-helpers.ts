// Inbox state helpers — pure predicates + a navigation sub-hook, split from
// use-inbox-state.ts for line-count compliance. (Paging/error appliers removed —
// TanStack Query owns those now.)

import { useCallback, useSyncExternalStore } from 'react'
import { hashKey, type QueryClient, type QueryState } from '@tanstack/react-query'
import type { InboxSearchParams } from '#/components/inbox/inbox-search-schema'
import {
  replyQueueStage,
  type InboxItem,
  type InboxItemDetailResult,
  type InboxQueue,
} from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import { queueReplyStage } from './inbox-queues'

export type InboxNavigate = (opts: {
  to: '.'
  search: (prev: InboxSearchParams) => Partial<InboxSearchParams>
}) => void

export type SelectedItemPresenceAction =
  'keep' | 'remember' | 'close' | 'reset' | 'refresh'

/**
 * What an open item's departure from the loaded queue means, from its detail
 * read: `keep` (its own reply moved it), `refresh` (the detail is older than
 * the list read that dropped it, so re-read it before deciding) or `close`.
 */
export type SelectedItemDeparture = 'keep' | 'refresh' | 'close'

/**
 * Distinguish an item that left a queue from a direct link whose item was
 * never in that queue. The latter still has an independently authorized
 * detail read and must remain open while that read resolves. An item that left
 * a reply queue is kept or re-read first as `departure` says.
 */
export const selectedItemPresenceAction = (
  seenSelectedId: string | undefined,
  selectedId: string | undefined,
  isLoading: boolean,
  items: ReadonlyArray<InboxItem>,
  departure: SelectedItemDeparture = 'close',
): SelectedItemPresenceAction => {
  if (!selectedId) return 'reset'
  if (items.some((item) => item.id === selectedId)) return 'remember'
  if (isLoading || seenSelectedId !== selectedId) return 'keep'
  return departure
}

type DetailReply = InboxItemDetailResult['reply']

function detailReplyStage(reply: DetailReply) {
  if (!reply) return 'needs_reply'
  return replyQueueStage({
    status: reply.status,
    publicationState: 'publicationState' in reply ? reply.publicationState : null,
    reconcileDueAt: 'reconcileDueAt' in reply ? reply.reconcileDueAt : null,
  })
}

export type SelectedItemDetailState = Readonly<{
  data: InboxItemDetailResult | undefined
  status: QueryState['status']
  fetchStatus: QueryState['fetchStatus']
  dataUpdatedAt: number
}>

/**
 * D8: approving, publishing or checking a reply from the open pane moves the
 * item between Needs reply, Awaiting approval and Waiting for Google, and the
 * pane must not close under the manager. But an item also leaves those queues
 * because it was closed, its Property was unassigned, or a filter changed —
 * and those must still close it. So the pane stays only on positive evidence
 * that the reply explains the move: a detail read that did not fail, of an open
 * review whose own reply's stage (the shared `replyQueueStage`) is no longer
 * the queue's. A detail that does not explain it but is older than the list
 * read that dropped the item is re-read first, because the list can notice a
 * reply's move before the detail poll does.
 */
export function selectedItemDeparture(
  queue: InboxQueue,
  detail: SelectedItemDetailState | undefined,
  listUpdatedAt: number,
): SelectedItemDeparture {
  const queueStage = queueReplyStage(queue)
  if (queueStage === null || !detail?.data || detail.status === 'error') return 'close'
  const { item, reply } = detail.data
  if (
    item.status === 'open' &&
    item.sourceType === 'review' &&
    detailReplyStage(reply) !== queueStage
  ) {
    return 'keep'
  }
  if (detail.fetchStatus === 'fetching') return 'keep'
  return detail.dataUpdatedAt < listUpdatedAt ? 'refresh' : 'close'
}

/**
 * `selectedItemDeparture` against the selected item's detail cache entry, which
 * both the detail poll and every command result write. Read by subscription
 * rather than a second `useQuery` observer: an observer shares the query's
 * options, and a query-function-less one would replace the detail query's
 * fetcher for later invalidations.
 */
export function useSelectedItemDeparture(
  qc: QueryClient,
  queue: InboxQueue,
  selectedId: string | undefined,
  listUpdatedAt: number,
): SelectedItemDeparture {
  // Only updates to this item's detail entry: query-cache events also fire
  // while other components create their queries during render, and reacting to
  // those would update this component in the middle of another one's render.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!selectedId) return () => {}
      const detailHash = hashKey(inboxKeys.detail(selectedId))
      return qc.getQueryCache().subscribe((event) => {
        if (event.type === 'updated' && event.query.queryHash === detailHash) onChange()
      })
    },
    [qc, selectedId],
  )
  return useSyncExternalStore(
    subscribe,
    () => selectedItemDepartureInCache(qc, queue, selectedId, listUpdatedAt),
    () => 'close',
  )
}

export function selectedItemDepartureInCache(
  qc: QueryClient,
  queue: InboxQueue,
  selectedId: string | undefined,
  listUpdatedAt: number,
): SelectedItemDeparture {
  if (!selectedId) return 'close'
  const state = qc.getQueryState<InboxItemDetailResult>(inboxKeys.detail(selectedId))
  return selectedItemDeparture(queue, state, listUpdatedAt)
}

/** Stable row-click / close-detail callbacks derived from the navigate fn. */
export function useInboxNavigation(onNavigate: InboxNavigate) {
  const handleRowClick = useCallback(
    (item: InboxItem) =>
      onNavigate({ to: '.', search: (prev) => ({ ...prev, itemId: item.id }) }),
    [onNavigate],
  )
  const closeDetail = useCallback(
    () => onNavigate({ to: '.', search: (prev) => ({ ...prev, itemId: undefined }) }),
    [onNavigate],
  )
  return { handleRowClick, closeDetail }
}
