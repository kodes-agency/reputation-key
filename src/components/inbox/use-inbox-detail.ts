import { useCallback, useEffect, useState } from 'react'
import {
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { Action } from '#/components/hooks/use-action'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  inboxCachePolicy,
  replyRefetchInterval,
  type InboxReplyCacheChange,
} from './inbox-cache-policy'
import { useTargetDeadlineRefresh } from './response-target-deadline-refresh'
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
import {
  isInboxRevisionConflictResult,
  type InboxItem,
  type FeedbackHandlingCommandResult,
  type InboxItemDetailResult,
  type InboxNoteView,
  type InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'

type RevisionedCommandInput = Readonly<{
  data: Readonly<{ expectedCommandRevision: number }>
}>

type SuccessfulCommandResult<T> = Exclude<Awaited<T>, InboxRevisionConflictResult>

const inboxDetailQueryOptions = (
  id: string,
  getInboxItemDetail: InboxServerFns['getInboxItemDetail'],
) =>
  queryOptions({
    queryKey: inboxKeys.detail(id),
    queryFn: () => getInboxItemDetail({ data: { inboxItemId: id } }),
    staleTime: 0,
  })

function applyRevisionConflict(
  qc: QueryClient,
  id: string,
  conflict: InboxRevisionConflictResult,
): void {
  qc.setQueryData<InboxItemDetailResult>(inboxKeys.detail(id), (current) =>
    current
      ? {
          ...current,
          item: {
            ...current.item,
            commandRevision: conflict.currentCommandRevision,
            status: conflict.currentStatus,
          },
        }
      : current,
  )
}

/**
 * Runs a revision-fenced command against the authoritative revision returned
 * by the command store. A second conflict is surfaced; this never polls or
 * retries more than once.
 */
export function withFreshCommandRevision<TInput extends RevisionedCommandInput, TResult>(
  qc: QueryClient,
  id: string,
  command: (input: TInput) => Promise<TResult>,
): (input: TInput) => Promise<SuccessfulCommandResult<TResult>> {
  return async (input) => {
    const result = await command(input)
    if (!isInboxRevisionConflictResult(result)) {
      return result as SuccessfulCommandResult<TResult>
    }

    applyRevisionConflict(qc, id, result)
    const retryInput = {
      ...input,
      data: {
        ...input.data,
        expectedCommandRevision: result.currentCommandRevision,
      },
    } as TInput
    const retried = await command(retryInput)
    if (!isInboxRevisionConflictResult(retried)) {
      return retried as SuccessfulCommandResult<TResult>
    }

    applyRevisionConflict(qc, id, retried)
    throw Object.assign(
      new Error('This item changed again while you were working. Please try again.'),
      retried,
    )
  }
}

export type UseInboxDetailOptions = Readonly<{
  autoMarkRead?: boolean
  onItemStatusChanged?: (updated: InboxItem) => void
}>

export type InboxDetailState = Readonly<{
  detail: InboxItemDetailResult | null
  refetch: () => void
  notes: ReadonlyArray<InboxNoteView>
  isLoading: boolean
  currentItem: InboxItem | null
  updateStatus: Action<Parameters<typeof updateInboxStatusFn>[0], InboxItem>
  escalate: Action<Parameters<typeof escalateInboxItemFn>[0], InboxItem>
  resolveEscalation: Action<Parameters<typeof resolveEscalationFn>[0], InboxItem>
  markFeedbackHandled: Action<
    Parameters<typeof markFeedbackHandledFn>[0],
    FeedbackHandlingCommandResult
  >
  correctFeedbackHandlingOutcome: Action<
    Parameters<typeof correctFeedbackHandlingOutcomeFn>[0],
    FeedbackHandlingCommandResult
  >
  onNoteAdded: (resultingCommandRevision: number) => void
  onReplyMutated: (change: InboxReplyCacheChange) => void
  error: string | null
  lastMarkedId: string | null
}>

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
  id: string,
  qc: QueryClient,
  statusObserver: InboxItemStatusObserver,
  onItemStatusChanged?: (updated: InboxItem) => void,
) {
  const handleStatusChanged = useCallback(
    (updated: InboxItem) => {
      statusObserver.accept({ itemId: updated.id, status: updated.status })
      inboxCachePolicy.onItemStatusChanged(qc, updated)
      onItemStatusChanged?.(updated)
    },
    [qc, statusObserver, onItemStatusChanged],
  )
  const updateStatus = useActionMutation(
    withFreshCommandRevision(qc, id, inboxFns.updateInboxStatus),
    {
      successMessage: 'Status updated',
      onSuccess: handleStatusChanged,
    },
  )
  const escalate = useActionMutation(
    withFreshCommandRevision(qc, id, inboxFns.escalateInboxItem),
    {
      successMessage: 'Escalated',
      onSuccess: handleStatusChanged,
    },
  )
  const resolveEscalation = useActionMutation(
    withFreshCommandRevision(qc, id, inboxFns.resolveEscalation),
    {
      successMessage: 'Escalation resolved',
      onSuccess: handleStatusChanged,
    },
  )
  return { updateStatus, escalate, resolveEscalation }
}

function useInboxDetailQueries(
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
    isLoading: detailQuery.isLoading || notesQuery.isLoading,
    currentItem: detail?.item ?? fallbackItem,
    error: detailQuery.error ? 'Failed to load detail. Try again.' : null,
    refetch: () => {
      void detailQuery.refetch()
      void notesQuery.refetch()
    },
    polledStatus: detailQuery.data?.item.status,
  }
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
