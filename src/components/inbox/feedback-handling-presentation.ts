import type { PrivateFeedbackHandlingOutcome } from '#/contexts/inbox/application/public-api'

const OUTCOME_LABELS = {
  follow_up_completed: 'Follow-up completed',
  follow_up_attempted: 'Follow-up attempted',
  handled_with_team: 'Handled with the team',
  reviewed_no_additional_step: 'Reviewed — no additional step',
  content_concern_reviewed: 'Content concern reviewed',
} as const satisfies Readonly<Record<PrivateFeedbackHandlingOutcome, string>>

export const feedbackHandlingOutcomeLabel = (
  outcome: PrivateFeedbackHandlingOutcome,
): string => OUTCOME_LABELS[outcome]

export const feedbackHandlingTimelineLabel = (outcomeRevision: number): string =>
  outcomeRevision === 1 ? 'Marked as handled' : 'Outcome corrected'
