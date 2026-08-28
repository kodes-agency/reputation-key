import { describe, expect, it } from 'vitest'
import {
  feedbackHandlingOutcomeLabel,
  feedbackHandlingTimelineLabel,
} from './feedback-handling-presentation'

describe('feedback handling presentation', () => {
  it('uses calm, specific labels for every controlled outcome', () => {
    expect(feedbackHandlingOutcomeLabel('follow_up_completed')).toBe(
      'Follow-up completed',
    )
    expect(feedbackHandlingOutcomeLabel('follow_up_attempted')).toBe(
      'Follow-up attempted',
    )
    expect(feedbackHandlingOutcomeLabel('handled_with_team')).toBe(
      'Handled with the team',
    )
    expect(feedbackHandlingOutcomeLabel('reviewed_no_additional_step')).toBe(
      'Reviewed — no additional step',
    )
    expect(feedbackHandlingOutcomeLabel('content_concern_reviewed')).toBe(
      'Content concern reviewed',
    )
  })

  it('distinguishes the original completion from later corrections', () => {
    expect(feedbackHandlingTimelineLabel(1)).toBe('Marked as handled')
    expect(feedbackHandlingTimelineLabel(2)).toBe('Outcome corrected')
    expect(feedbackHandlingTimelineLabel(8)).toBe('Outcome corrected')
  })
})
