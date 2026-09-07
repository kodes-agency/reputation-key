import type { QueryClient } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import {
  isInboxRevisionConflictResult,
  type InboxItem,
} from '#/contexts/inbox/application/public-api'
import type { InboxServerFns } from './types'
import { inboxCachePolicy } from './inbox-cache-policy'
import type { InboxItemStatusObserver } from './inbox-item-status-observer'

type MarkFeedbackHandledInput = Parameters<InboxServerFns['markFeedbackHandled']>[0]
type CorrectFeedbackHandlingInput = Parameters<
  InboxServerFns['correctFeedbackHandlingOutcome']
>[0]

export function useFeedbackHandlingMutations(
  inboxFns: Pick<
    InboxServerFns,
    'markFeedbackHandled' | 'correctFeedbackHandlingOutcome'
  >,
  qc: QueryClient,
  statusObserver: InboxItemStatusObserver,
  onItemStatusChanged?: (updated: InboxItem) => void,
) {
  // Handling outcomes are decisions against an exact cycle and must not be
  // replayed against a newer state. Convert the server's structured command
  // conflict back into a visible refusal instead of invoking retry recovery.
  const markFeedbackHandled = useActionMutation(
    async (input: MarkFeedbackHandledInput) => {
      const result = await inboxFns.markFeedbackHandled(input)
      if (isInboxRevisionConflictResult(result)) {
        throw Object.assign(
          new Error('This item changed while you were working. Refresh and try again.'),
          result,
        )
      }
      return result
    },
    {
      successMessage: 'Feedback marked as handled',
      onSuccess: (result) => {
        statusObserver.accept({ itemId: result.item.id, status: result.item.status })
        inboxCachePolicy.onFeedbackHandlingChanged(qc, result, true)
        onItemStatusChanged?.(result.item)
      },
    },
  )
  const correctFeedbackHandlingOutcome = useActionMutation(
    async (input: CorrectFeedbackHandlingInput) => {
      const result = await inboxFns.correctFeedbackHandlingOutcome(input)
      if (isInboxRevisionConflictResult(result)) {
        throw Object.assign(
          new Error('This item changed while you were working. Refresh and try again.'),
          result,
        )
      }
      return result
    },
    {
      successMessage: 'Handling outcome corrected',
      onSuccess: (result) => {
        inboxCachePolicy.onFeedbackHandlingChanged(qc, result, false)
        onItemStatusChanged?.(result.item)
      },
    },
  )
  return { markFeedbackHandled, correctFeedbackHandlingOutcome }
}
