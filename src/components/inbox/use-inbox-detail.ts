import { useCallback, useEffect, useState } from 'react'
import {
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import {
  actionErrorMessage,
  useActionMutation,
} from '#/components/hooks/use-action-mutation'
import type { Action } from '#/components/hooks/use-action'
import { HTTP_STATUS } from '#/shared/http/status'
import { inboxKeys } from '#/shared/queries/query-keys'
import {
  inboxCachePolicy,
  replyRefetchInterval,
  type InboxReplyCacheChange,
} from './inbox-cache-policy'
import { useReplyPublicationChangeDetection } from './use-reply-publication-change'
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
  assignInboxItemFn,
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
 *
 * The second conflict is thrown as the 4xx refusal it is: the `_tag` and the
 * 409 the server maps `revision_conflict` to (`inboxErrorStatus`,
 * `inbox-shared.ts`) are the shape `actionErrorMessage` shows verbatim, so the
 * escalate / resolve / assign toast says this sentence rather than the generic
 * failure, and `isExpectedRefusal` keeps it out of Sentry. `retried` still
 * rides on it, so the error remains an `InboxRevisionConflictResult` too.
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
      { _tag: 'InboxError', status: HTTP_STATUS.CONFLICT },
    )
  }
}

export type UseInboxDetailOptions = Readonly<{
  autoMarkRead?: boolean
  selectedItemId?: string
  onItemStatusChanged?: (updated: InboxItem) => void
}>

export type InboxDetailState = Readonly<{
  detail: InboxItemDetailResult | null
  refetch: () => void
  notes: ReadonlyArray<InboxNoteView>
  /**
   * The notes read failed, as opposed to returning none.
   *
   * `notes` is `data ?? []` either way, so without this flag a failed read is
   * indistinguishable from a case nobody has written on — the thread renders a
   * complete-looking ledger with a colleague's note missing from it, and the
   * manager files a duplicate onto it. The pane already tells this truth about
   * Handling History (`inbox-thread.tsx`); notes are held to the same standard.
   */
  notesUnavailable: boolean
  isLoading: boolean
  currentItem: InboxItem | null
  updateStatus: Action<Parameters<typeof updateInboxStatusFn>[0], InboxItem>
  escalate: Action<Parameters<typeof escalateInboxItemFn>[0], InboxItem>
  resolveEscalation: Action<Parameters<typeof resolveEscalationFn>[0], InboxItem>
  assign: Action<Parameters<typeof assignInboxItemFn>[0], InboxItem>
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
      inboxCachePolicy.onItemFolderChanged(qc, id)
    }
  }, [id, observer, polledStatus, qc])
}

/**
 * The item commands sharing one success handler (policy + list sync). Assign
 * belongs here despite leaving the status untouched: it returns the same
 * authoritative snapshot, so it needs the same fence, cache write and list sync.
 */
function useInboxStatusMutations(
  inboxFns: Pick<
    InboxServerFns,
    'updateInboxStatus' | 'escalateInboxItem' | 'resolveEscalation' | 'assignInboxItem'
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
      // No `errorMessage`: this command's caller in the pane is
      // `InboxReopenDialog`, which catches the refusal and shows the server's
      // own reason in its `FormErrorBanner`. A toast here would report one
      // refused reopen twice.
      onSuccess: handleStatusChanged,
    },
  )
  const escalate = useActionMutation(
    withFreshCommandRevision(qc, id, inboxFns.escalateInboxItem),
    {
      successMessage: 'Escalated',
      // Escalate, resolve and assign are issued from the toolbar, and the first
      // two from the `e` shortcut; both narrow them to `() => void`
      // (`buildInboxCaseToolbarProps`, `bindEscalationShortcutCommands`), so the
      // Action's `.error` reaches no renderer. Without a toast a refused command
      // left the strip on its OLD value with nothing said — the manager believed
      // the item had moved. Same wording as the reply commands
      // (`use-reply-actions.ts`): the server's sentence for a refusal, a generic
      // one for a failure; a second revision conflict is refused in the same
      // shape (`withFreshCommandRevision`).
      errorMessage: actionErrorMessage,
      onSuccess: handleStatusChanged,
    },
  )
  const resolveEscalation = useActionMutation(
    withFreshCommandRevision(qc, id, inboxFns.resolveEscalation),
    {
      successMessage: 'Escalation resolved',
      errorMessage: actionErrorMessage,
      onSuccess: handleStatusChanged,
    },
  )
  const assign = useActionMutation(
    withFreshCommandRevision(qc, id, inboxFns.assignInboxItem),
    {
      successMessage: 'Assignment updated',
      errorMessage: actionErrorMessage,
      onSuccess: handleStatusChanged,
    },
  )
  return { updateStatus, escalate, resolveEscalation, assign }
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
    // Unavailable means there is nothing to show. A background refetch that
    // fails after an earlier success leaves the notes on screen, and saying
    // they are unavailable beneath them would contradict what the rail shows.
    notesUnavailable: notesQuery.isError && notesQuery.data === undefined,
    isLoading: detailQuery.isLoading || notesQuery.isLoading,
    currentItem: detail?.item ?? fallbackItem,
    error: detailQuery.error ? 'Failed to load detail. Try again.' : null,
    refetch: () => {
      void detailQuery.refetch()
      void notesQuery.refetch()
    },
    polledStatus: detailQuery.data?.item.status,
    polledReply: detailQuery.data?.reply,
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
    | 'assignInboxItem'
    | 'markFeedbackHandled'
    | 'correctFeedbackHandlingOutcome'
  >,
  options?: UseInboxDetailOptions,
): InboxDetailState {
  const qc = useQueryClient()
  const { onItemStatusChanged, selectedItemId } = options ?? {}
  const id = selectedItemId ?? item?.id ?? ''
  const enabled = active && !!id
  const [statusObserver] = useState(createInboxItemStatusObserver)

  const queries = useInboxDetailQueries(inboxFns, id, enabled, item)
  useInboxAutoCloseDetection(qc, id, queries.polledStatus, statusObserver)
  const acceptReplyMutation = useReplyPublicationChangeDetection(
    qc,
    id,
    queries.polledReply,
  )
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
      // A result about another item (the manager moved on while it was in
      // flight) is not this item's baseline; the policy files it under its own
      // review either way.
      if (inboxCachePolicy.isReplyChangeForItem(qc, id, change)) {
        acceptReplyMutation(change.reply)
      }
      inboxCachePolicy.onReplyChanged(qc, change)
    },
    [acceptReplyMutation, qc, id],
  )

  return {
    detail: queries.detail,
    notes: queries.notes,
    notesUnavailable: queries.notesUnavailable,
    isLoading: queries.isLoading,
    currentItem: queries.currentItem,
    updateStatus: mutations.updateStatus,
    escalate: mutations.escalate,
    resolveEscalation: mutations.resolveEscalation,
    assign: mutations.assign,
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
