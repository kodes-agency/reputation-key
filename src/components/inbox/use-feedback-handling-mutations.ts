import type { QueryClient } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import {
  isInboxRevisionConflictResult,
  type InboxItem,
  type InboxRevisionConflictResult,
} from '#/contexts/inbox/application/public-api'
import { HTTP_STATUS } from '#/shared/http/status'
import type { InboxServerFns } from './types'
import { inboxCachePolicy } from './inbox-cache-policy'
import type { InboxItemStatusObserver } from './inbox-item-status-observer'

type MarkFeedbackHandledInput = Parameters<InboxServerFns['markFeedbackHandled']>[0]
type CorrectFeedbackHandlingInput = Parameters<
  InboxServerFns['correctFeedbackHandlingOutcome']
>[0]

/**
 * The server's structured command conflict, thrown as the 4xx refusal it is.
 *
 * The `_tag` and the 409 the server maps `revision_conflict` to
 * (`inboxErrorStatus`, `inbox-shared.ts`) are the shape `actionErrorMessage`
 * shows verbatim, so the dialog's banner prints this sentence; without them it
 * printed the generic failure line and the browser reported a refusal as an
 * error. The same shape `withFreshCommandRevision` gives its second conflict.
 * The sentence asks for no refresh: `onFeedbackHandlingFailed` re-reads the
 * item behind the dialog.
 */
function refuseConflict<T>(result: T | InboxRevisionConflictResult): T {
  if (!isInboxRevisionConflictResult(result)) return result
  throw Object.assign(
    new Error('This item changed while you were working. Check it and try again.'),
    result,
    { _tag: 'InboxError', status: HTTP_STATUS.CONFLICT },
  )
}

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
  //
  // A refusal still means the pane is behind, and nothing else would bring it
  // forward, so the item is re-read: the manager sees what changed and the next
  // attempt carries the fences the server holds. The item is the command's own
  // input, never whichever one is open when a slow command settles.
  const reread = (
    _error: unknown,
    command: Readonly<{ data: Readonly<{ inboxItemId: string }> }>,
  ) => inboxCachePolicy.onFeedbackHandlingFailed(qc, command.data.inboxItemId)
  const markFeedbackHandled = useActionMutation(
    async (input: MarkFeedbackHandledInput) =>
      refuseConflict(await inboxFns.markFeedbackHandled(input)),
    {
      successMessage: 'Feedback marked as handled',
      onError: reread,
      onSuccess: (result) => {
        statusObserver.accept({ itemId: result.item.id, status: result.item.status })
        inboxCachePolicy.onFeedbackHandlingChanged(qc, result, true)
        onItemStatusChanged?.(result.item)
      },
    },
  )
  const correctFeedbackHandlingOutcome = useActionMutation(
    async (input: CorrectFeedbackHandlingInput) =>
      refuseConflict(await inboxFns.correctFeedbackHandlingOutcome(input)),
    {
      successMessage: 'Handling outcome corrected',
      onError: reread,
      onSuccess: (result) => {
        inboxCachePolicy.onFeedbackHandlingChanged(qc, result, false)
        onItemStatusChanged?.(result.item)
      },
    },
  )
  return { markFeedbackHandled, correctFeedbackHandlingOutcome }
}
