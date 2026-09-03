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
  // No `recover` here, deliberately. A handling outcome is a human decision
  // made against one specific cycle and state; replaying it against refreshed
  // revisions would apply a judgement to state the manager never saw. A
  // conflict here must reach the dialog as a visible refusal — proved by
  // e2e/critical/workflows/inbox-handling-cycle.spec.ts:385 ("a stale second
  // tab is refused with a visible conflict and overwrites nothing"). Only the
  // status and note mutations, whose token moves for system reasons, recover.
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
