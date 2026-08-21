import { describe, expect, it } from 'vitest'
import { reviewStatusMessage } from './content-review-status'

describe('reviewStatusMessage', () => {
  it('announces progress while a submission is in flight', () => {
    expect(reviewStatusMessage(true, null)).toBe('Recording content review')
  })

  it('prefers progress over the previous outcome on re-submission', () => {
    expect(reviewStatusMessage(true, { status: 'recorded' })).toBe(
      'Recording content review',
    )
    expect(reviewStatusMessage(true, { status: 'duplicate' })).toBe(
      'Recording content review',
    )
  })

  it('stays silent until there is an outcome to announce', () => {
    expect(reviewStatusMessage(false, null)).toBe('')
  })

  it('distinguishes a recorded review from an idempotent replay', () => {
    expect(reviewStatusMessage(false, { status: 'recorded' })).toBe(
      'Content review recorded.',
    )
    expect(reviewStatusMessage(false, { status: 'duplicate' })).toBe(
      'That review was already recorded.',
    )
  })
})
