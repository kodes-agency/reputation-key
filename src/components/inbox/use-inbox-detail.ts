// Shared desktop/mobile Inbox detail hook. Query owns cache, dedup, and
// cancellation; InboxCachePolicy owns invalidation and polling decisions.
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { Action } from '#/components/hooks/use-action'
import { inboxCachePolicy, type InboxReplyCacheChange } from './inbox-cache-policy'
import {
  useInboxDetailQueries,
  withFreshCommandRevision,
} from './use-inbox-detail-queries'
import {
  createInboxItemStatusObserver,
  type InboxItemStatusObserver,
} from './inbox-item-status-observer'
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
    'getInboxItemDetail' | 'updateInboxStatus' | 'escalateInboxItem' | 'resolveEscalation'
  >,
  id: string,
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
  const recover = withFreshCommandRevision(qc, id, inboxFns.getInboxItemDetail)
  const updateStatus = useActionMutation(inboxFns.updateInboxStatus, {
    successMessage: 'Status updated',
    onSuccess: handleStatusChanged,
    recover,
  })
  const escalate = useActionMutation(inboxFns.escalateInboxItem, {
    successMessage: 'Escalated',
    onSuccess: handleStatusChanged,
    recover,
  })
  const resolveEscalation = useActionMutation(inboxFns.resolveEscalation, {
    successMessage: 'Escalation resolved',
    onSuccess: handleStatusChanged,
    recover,
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
    id,
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
