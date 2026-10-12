import { describe, expect, it } from 'vitest'
import { presentGoogleReviewDestination } from './google-review-destination-status'

describe('presentGoogleReviewDestination', () => {
  it('presents a verified property destination without exposing its URI', () => {
    const result = presentGoogleReviewDestination({
      state: 'verified',
      retrievedAt: new Date('2026-08-20T10:00:00.000Z'),
    })

    expect(result).toEqual({
      label: 'Ready',
      tone: 'positive',
      description:
        'The Google review action is supplied automatically by this portal’s property.',
      confirmedAt: 'Aug 20, 2026',
    })
    expect(JSON.stringify(result)).not.toContain('http')
  })

  it('says a held destination is on hold, what that blocks and what brings it back', () => {
    const result = presentGoogleReviewDestination({
      state: 'awaiting_refresh',
      retrievedAt: '2026-08-19T10:00:00.000Z',
    })

    expect(result).toEqual({
      label: 'On hold',
      tone: 'neutral',
      description:
        'The property’s Google review link is on hold, so guests cannot continue to Google and publishing is blocked. Private ratings and feedback are not affected. Restoring an archived property that is still linked to Google brings the link back; a property disconnected from Google has to be relinked, and this portal published again.',
      confirmedAt: 'Aug 19, 2026',
    })
  })

  it('never claims a refresh is under way, because nothing performs one', () => {
    const presentations = (['verified', 'awaiting_refresh', 'unavailable'] as const).map(
      (state) =>
        presentGoogleReviewDestination({
          state,
          retrievedAt: state === 'unavailable' ? null : '2026-08-19T10:00:00.000Z',
        }),
    )

    expect(
      presentations.filter(({ label, description }) =>
        /refresh/i.test(`${label} ${description}`),
      ),
    ).toEqual([])
  })

  it('explains the guest and publication impact when no destination is available', () => {
    const result = presentGoogleReviewDestination({
      state: 'unavailable',
      retrievedAt: null,
    })

    expect(result).toMatchObject({
      label: 'Needs connection',
      tone: 'warn',
      confirmedAt: null,
    })
    expect(result.description).toContain('Guests cannot continue to Google')
    expect(result.description).toContain('Publishing is also blocked')
  })
})
