import { describe, expect, it } from 'vitest'
import { googleRatingLine, goalTargetWords } from './guest-voice-rating-goal-words'
describe('Google and goal header words', () => {
  it('keeps the real Google date and marks stale or disconnected numbers', () => {
    const google = {
      shows: 3.9,
      reviewCount: 132,
      asOf: '2026-10-01T12:00:00.000Z',
      current: true,
    }
    expect(googleRatingLine(google)).toBe('Google rating 3.9★ (as of Oct 1, 2026)')
    expect(googleRatingLine({ ...google, current: false })).toContain('last known')
    expect(googleRatingLine(null)).toBeNull()
    expect(googleRatingLine({ ...google, shows: null })).toBeNull()
  })
  it('distinguishes keep and climb without promising issue impact', () => {
    const goal = {
      mode: 'keep' as const,
      target: 4.2,
      shows: null,
      status: 'waiting_for_google' as const,
    }
    expect(goalTargetWords(goal)).toBe('Keeping 4.2★')
    expect(goalTargetWords({ ...goal, mode: 'climb' })).toBe('Your goal 4.2★')
  })
})
