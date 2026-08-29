import type {
  FeedbackHandlingState,
  InboxItem,
} from '#/contexts/inbox/application/public-api'
import type { InboxDetailState } from './use-inbox-detail'
import type { FeedbackHandlingDecision } from './feedback-handling-dialog'

export type FeedbackHandlingDialogMode = 'mark' | 'correct' | null

type SubmitInput = Readonly<{
  mode: FeedbackHandlingDialogMode
  item: InboxItem
  state: FeedbackHandlingState
  decision: FeedbackHandlingDecision
  markFeedbackHandled: InboxDetailState['markFeedbackHandled']
  correctFeedbackHandlingOutcome: InboxDetailState['correctFeedbackHandlingOutcome']
}>

/**
 * Route a dialog decision to the command that matches the open dialog.
 *
 * Every command carries the four revisions the caller observed, so a stale tab
 * is rejected by the server rather than silently overwriting a newer outcome. A
 * correction additionally pins the outcome it is superseding; with no current
 * outcome to supersede there is nothing to correct, so the call is dropped.
 */
export function submitFeedbackHandlingDecision({
  mode,
  item,
  state,
  decision,
  markFeedbackHandled,
  correctFeedbackHandlingOutcome,
}: SubmitInput): Promise<unknown> {
  const expected = {
    inboxItemId: item.id,
    expectedCommandRevision: item.commandRevision,
    expectedCycleNumber: state.cycleNumber,
    expectedSourceRevision: state.sourceRevision,
    expectedStateRevision: state.stateRevision,
  }

  if (mode === 'mark') {
    return markFeedbackHandled({ data: { ...expected, ...decision } })
  }

  const current = state.currentOutcome
  if (mode === 'correct' && current) {
    return correctFeedbackHandlingOutcome({
      data: {
        ...expected,
        expectedOutcomeId: current.id,
        expectedOutcomeRevision: current.outcomeRevision,
        ...decision,
      },
    })
  }

  return Promise.resolve()
}
