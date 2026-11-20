import { describe, expect, it } from 'vitest'
import { liveVersionName, reviewStatusMessage } from './content-review-status'

describe('reviewStatusMessage', () => {
  it('announces progress while a submission is in flight', () => {
    expect(reviewStatusMessage(true, null)).toBe('Recording the link check')
  })

  it('prefers progress over the previous outcome on re-submission', () => {
    expect(reviewStatusMessage(true, { status: 'recorded' })).toBe(
      'Recording the link check',
    )
    expect(reviewStatusMessage(true, { status: 'duplicate' })).toBe(
      'Recording the link check',
    )
  })

  it('stays silent until there is an outcome to announce', () => {
    expect(reviewStatusMessage(false, null)).toBe('')
  })

  it('distinguishes a recorded check from an idempotent replay', () => {
    expect(reviewStatusMessage(false, { status: 'recorded' })).toBe(
      'Link check recorded.',
    )
    expect(reviewStatusMessage(false, { status: 'duplicate' })).toBe(
      'That check was already recorded.',
    )
  })
})

describe('liveVersionName', () => {
  it('names the version the check covers', () => {
    expect(liveVersionName(5)).toBe('live version 5')
  })

  it('falls back to the live page when no version can be read', () => {
    expect(liveVersionName(null)).toBe('the live page')
  })
})
