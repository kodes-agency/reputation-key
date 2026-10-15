import { describe, expect, it } from 'vitest'
import { overviewRatingMissing } from './overview-rating-missing'

describe('overviewRatingMissing', () => {
  it('says Google has not sent the rating yet while the link is active', () => {
    expect(overviewRatingMissing('active')).toBe(
      'Google hasn’t sent this property’s rating yet.',
    )
  })

  it('names what to do when the link is not active, never "wait"', () => {
    expect(overviewRatingMissing('unbound')).toBe(
      'Link Google to see this property’s rating.',
    )
    expect(overviewRatingMissing('disconnected')).toBe(
      'Reconnect Google to see this property’s rating.',
    )
    expect(overviewRatingMissing('account_confirmation_required')).toBe(
      'Confirm the Google account to see this property’s rating.',
    )
  })
})
