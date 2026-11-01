import { describe, expect, it } from 'vitest'
import { ratingSubjectSkipsPrivateRating } from './goal-rating-eligibility'

describe('rating goal subjects', () => {
  const portals = [
    { portalId: 'one', portalGroupId: 'group', skipPrivateRating: true },
    { portalId: 'two', portalGroupId: 'group', skipPrivateRating: false },
  ]
  it('refuses a switched Portal and accepts a mixed group', () => {
    expect(
      ratingSubjectSkipsPrivateRating(portals, { kind: 'portal', portalId: 'one' }),
    ).toBe(true)
    expect(
      ratingSubjectSkipsPrivateRating(portals, {
        kind: 'portal_group',
        portalGroupId: 'group',
      }),
    ).toBe(false)
  })
  it('refuses a group only when all its Portals skip ratings', () => {
    expect(
      ratingSubjectSkipsPrivateRating(
        portals.map((p) => ({ ...p, skipPrivateRating: true })),
        { kind: 'portal_group', portalGroupId: 'group' },
      ),
    ).toBe(true)
    expect(
      ratingSubjectSkipsPrivateRating([], {
        kind: 'portal_group',
        portalGroupId: 'empty',
      }),
    ).toBe(false)
    expect(
      ratingSubjectSkipsPrivateRating(portals, {
        kind: 'property',
        propertyId: 'property',
      }),
    ).toBe(false)
  })
})
