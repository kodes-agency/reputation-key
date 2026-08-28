import type { QueryClient } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxServerFns } from './types'
import { inboxCachePolicy } from './inbox-cache-policy'
import type { InboxItemStatusObserver } from './inbox-item-status-observer'

export function useFeedbackHandlingMutations(
  inboxFns: Pick<
    InboxServerFns,
    'markFeedbackHandled' | 'correctFeedbackHandlingOutcome'
  >,
  qc: QueryClient,
  statusObserver: InboxItemStatusObserver,
  onItemStatusChanged?: (updated: InboxItem) => void,
) {
  const markFeedbackHandled = useActionMutation(inboxFns.markFeedbackHandled, {
    successMessage: 'Feedback marked as handled',
    onSuccess: (result) => {
      statusObserver.accept({ itemId: result.item.id, status: result.item.status })
      inboxCachePolicy.onFeedbackHandlingChanged(qc, result, true)
      onItemStatusChanged?.(result.item)
    },
  })
  const correctFeedbackHandlingOutcome = useActionMutation(
    inboxFns.correctFeedbackHandlingOutcome,
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
