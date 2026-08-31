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
      badgeVariant: 'default',
      description:
        'The Google review action is supplied automatically by this portal’s property.',
      confirmedAt: 'Aug 20, 2026',
    })
    expect(JSON.stringify(result)).not.toContain('http')
  })

  it('keeps private-response availability clear while refresh is pending', () => {
    expect(
      presentGoogleReviewDestination({
        state: 'awaiting_refresh',
        retrievedAt: '2026-08-19T10:00:00.000Z',
      }),
    ).toMatchObject({
      label: 'Refreshing',
      description: expect.stringContaining(
        'Private ratings and feedback remain available',
      ),
      confirmedAt: 'Aug 19, 2026',
    })
  })

  it('gives a mild next step when no destination is available', () => {
    expect(
      presentGoogleReviewDestination({ state: 'unavailable', retrievedAt: null }),
    ).toEqual({
      label: 'Needs connection',
      badgeVariant: 'outline',
      description:
        'Connect or refresh Google for this property before publishing the portal.',
      confirmedAt: null,
    })
  })
})
