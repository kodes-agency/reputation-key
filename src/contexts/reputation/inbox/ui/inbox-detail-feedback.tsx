import type { ReactNode } from 'react'
import type {
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'
import { FeedbackHandlingPrimary } from './feedback-handling-primary'
import { feedbackHandlingAction } from './feedback-handling-presentation'
import type { InboxDetailState } from './use-inbox-detail'

export function inboxDetailFeedbackPresentation({
  item,
  detail,
  canAddNotes,
  canHandleFeedback,
  markFeedbackHandled,
  correctFeedbackHandlingOutcome,
}: Readonly<{
  item: InboxItem
  detail: InboxItemDetailResult | null
  canAddNotes: boolean
  canHandleFeedback: boolean
  markFeedbackHandled: InboxDetailState['markFeedbackHandled']
  correctFeedbackHandlingOutcome: InboxDetailState['correctFeedbackHandlingOutcome']
}>): Readonly<{
  action: 'mark' | 'correct' | null
  primary: ReactNode
}> {
  const state =
    item.sourceType === 'feedback' && canAddNotes && canHandleFeedback
      ? (detail?.feedbackHandling ?? null)
      : null
  if (!state) return { action: null, primary: null }
  return {
    action: feedbackHandlingAction(state),
    primary: (
      <FeedbackHandlingPrimary
        item={item}
        state={state}
        markFeedbackHandled={markFeedbackHandled}
        correctFeedbackHandlingOutcome={correctFeedbackHandlingOutcome}
      />
    ),
  }
}
