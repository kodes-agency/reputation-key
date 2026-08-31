// Shared desktop/mobile Inbox detail hook. Query owns cache, dedup, and
// cancellation; InboxCachePolicy owns invalidation and polling decisions.
import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { Action } from '#/components/hooks/use-action'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  inboxCachePolicy,
  replyRefetchInterval,
  type InboxReplyCacheChange,
} from './inbox-cache-policy'
import {
  createInboxItemStatusObserver,
  type InboxItemStatusObserver,
} from './inbox-item-status-observer'
import { useTargetDeadlineRefresh } from './response-target-deadline-refresh'
import { useFeedbackHandlingMutations } from './use-feedback-handling-mutations'
import type {
  updateInboxStatusFn,
  escalateInboxItemFn,
  resolveEscalationFn,
  markFeedbackHandledFn,
  correctFeedbackHandlingOutcomeFn,
} from '#/contexts/inbox/server/inbox'
import type { InboxServerFns } from './types'
import type {
  InboxItem,
  InboxItemDetailResult,
  InboxNoteView,
} from '#/contexts/inbox/application/public-api'

export type UseInboxDetailOptions = Readonly<{
  autoMarkRead?: boolean
  /** Called with the updated item after a status change (mark-read / escalate /
   *  archive). The inbox page wires it to the optimistic list sync (instant UI
   *  update + drop-from-filter), replacing the old statusVersion effect. */
  onItemStatusChanged?: (updated: InboxItem) => void
}>

export type InboxDetailState = Readonly<{
  detail: InboxItemDetailResult | null
  /** Retry on error — refetches detail + notes via Query. */
  refetch: () => void
  notes: ReadonlyArray<InboxNoteView>
  isLoading: boolean
  currentItem: InboxItem | null
  updateStatus: Action<
    Parameters<typeof updateInboxStatusFn>[0],
    Awaited<ReturnType<typeof updateInboxStatusFn>>
  >
  escalate: Action<
    Parameters<typeof escalateInboxItemFn>[0],
    Awaited<ReturnType<typeof escalateInboxItemFn>>
  >
  resolveEscalation: Action<
    Parameters<typeof resolveEscalationFn>[0],
    Awaited<ReturnType<typeof resolveEscalationFn>>
  >
  markFeedbackHandled: Action<
    Parameters<typeof markFeedbackHandledFn>[0],
    Awaited<ReturnType<typeof markFeedbackHandledFn>>
  >
  correctFeedbackHandlingOutcome: Action<
    Parameters<typeof correctFeedbackHandlingOutcomeFn>[0],
    Awaited<ReturnType<typeof correctFeedbackHandlingOutcomeFn>>
  >
  /** Called after a note is added — refreshes notes + activity. */
  onNoteAdded: (resultingCommandRevision: number) => void
  /** Called after a classified reply change — patches only this item's reply. */
  onReplyMutated: (change: InboxReplyCacheChange) => void
  error: string | null
  lastMarkedId: string | null
}>

/** Detail + notes queries and their result shaping (loading/error/refetch). */
function useInboxDetailQueries(
  inboxFns: Pick<InboxServerFns, 'getInboxItemDetail' | 'getInboxNotes'>,
  id: string,
  enabled: boolean,
  fallbackItem: InboxItem | null,
) {
  const detailQuery = useQuery({
    queryKey: inboxKeys.detail(id),
    queryFn: () => inboxFns.getInboxItemDetail({ data: { inboxItemId: id } }),
    enabled,
    staleTime: 0,
    // Poll while a reply publish is pending (approved → published happens
    // asynchronously via BullMQ) — the predicate lives in the cache policy.
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
    isLoading: detailQuery.isLoading || notesQuery.isLoading,
    currentItem: detail?.item ?? fallbackItem,
    error: detailQuery.error ? 'Failed to load detail. Try again.' : null,
    refetch: () => {
      void detailQuery.refetch()
      void notesQuery.refetch()
    },
    /** Live item status — feeds auto-close detection while polling. */
    polledStatus: detailQuery.data?.item.status,
  }
}

/** Detect a server-side status transition (auto-close during reply-publish polling). */
function useInboxAutoCloseDetection(
  qc: QueryClient,
  id: string,
  polledStatus: string | undefined,
  observer: InboxItemStatusObserver,
): void {
  useEffect(() => {
    if (id && observer.observe({ itemId: id, status: polledStatus })) {
      inboxCachePolicy.onItemFolderChanged(qc)
    }
  }, [id, observer, polledStatus, qc])
}

/** The three status mutations sharing one success handler (policy + list sync). */
function useInboxStatusMutations(
  inboxFns: Pick<
    InboxServerFns,
    'updateInboxStatus' | 'escalateInboxItem' | 'resolveEscalation'
  >,
  qc: QueryClient,
  statusObserver: InboxItemStatusObserver,
  onItemStatusChanged?: (updated: InboxItem) => void,
) {
  // Notify the policy about the status change, then the list for the
  // optimistic sync (instant UI update + drop-from-filter).
  const handleStatusChanged = useCallback(
    (updated: InboxItem) => {
      statusObserver.accept({ itemId: updated.id, status: updated.status })
      inboxCachePolicy.onItemStatusChanged(qc, updated)
      onItemStatusChanged?.(updated)
    },
    [qc, statusObserver, onItemStatusChanged],
  )
  const updateStatus = useActionMutation(inboxFns.updateInboxStatus, {
    successMessage: 'Status updated',
    onSuccess: handleStatusChanged,
  })
  const escalate = useActionMutation(inboxFns.escalateInboxItem, {
    successMessage: 'Escalated',
    onSuccess: handleStatusChanged,
  })
  const resolveEscalation = useActionMutation(inboxFns.resolveEscalation, {
    successMessage: 'Escalation resolved',
    onSuccess: handleStatusChanged,
  })
  return { updateStatus, escalate, resolveEscalation }
}

export function useInboxDetail(
  item: InboxItem | null,
  active: boolean,
  inboxFns: Pick<
    InboxServerFns,
    | 'getInboxItemDetail'
    | 'getInboxNotes'
    | 'updateInboxStatus'
    | 'escalateInboxItem'
    | 'resolveEscalation'
    | 'markFeedbackHandled'
    | 'correctFeedbackHandlingOutcome'
  >,
  options?: UseInboxDetailOptions,
): InboxDetailState {
  const qc = useQueryClient()
  const { onItemStatusChanged } = options ?? {}
  const id = item?.id ?? ''
  const enabled = active && !!item
  const [statusObserver] = useState(createInboxItemStatusObserver)

  const queries = useInboxDetailQueries(inboxFns, id, enabled, item)
  useInboxAutoCloseDetection(qc, id, queries.polledStatus, statusObserver)
  const mutations = useInboxStatusMutations(
    inboxFns,
    qc,
    statusObserver,
    onItemStatusChanged,
  )
  const feedbackMutations = useFeedbackHandlingMutations(
    inboxFns,
    qc,
    statusObserver,
    onItemStatusChanged,
  )

  // Reply draft saves and workflow changes are classified before they reach
  // the policy. Neither moves an Inbox item between folders by itself.
  const onReplyMutated = useCallback(
    (change: InboxReplyCacheChange) => {
      inboxCachePolicy.onReplyChanged(qc, id, change)
    },
    [qc, id],
  )

  return {
    detail: queries.detail,
    notes: queries.notes,
    isLoading: queries.isLoading,
    currentItem: queries.currentItem,
    updateStatus: mutations.updateStatus,
    escalate: mutations.escalate,
    resolveEscalation: mutations.resolveEscalation,
    markFeedbackHandled: feedbackMutations.markFeedbackHandled,
    correctFeedbackHandlingOutcome: feedbackMutations.correctFeedbackHandlingOutcome,
    refetch: queries.refetch,
    onNoteAdded: (resultingCommandRevision) =>
      inboxCachePolicy.onNoteAdded(qc, id, resultingCommandRevision),
    onReplyMutated,
    error: queries.error,
    lastMarkedId: null,
  }
}
