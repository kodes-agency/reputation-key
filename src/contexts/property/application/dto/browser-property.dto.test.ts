import { describe, expect, it } from 'vitest'
import { googleConnectionId } from '#/shared/domain/ids'
import { buildTestProperty } from '#/shared/testing/fixtures'
import { toBrowserProperty } from './browser-property.dto'

const RETRIEVED_AT = new Date('2026-09-01T09:00:00.000Z')

const linked = buildTestProperty({
  name: 'Harbour Hotel',
  gbpAccountId: 'account-suffix-4410',
  gbpLocationId: 'location-suffix-7731',
  googleConnectionId: googleConnectionId('f9000000-0000-4000-8000-0000000000c1'),
  googleBindingState: 'active',
  googleReviewDestination: {
    state: 'verified',
    uri: 'https://search.google.com/local/writereview?placeid=held-9902',
    retrievedAt: RETRIEVED_AT,
    sourceEpoch: 4,
    profileVersion: 2,
  },
})

describe('toBrowserProperty', () => {
  it('withholds the Google account, location and connection identifiers', () => {
    const browser = toBrowserProperty(linked)

    expect(Object.keys(browser).sort()).toEqual(
      Object.keys(linked)
        .filter(
          (key) => !['gbpAccountId', 'gbpLocationId', 'googleConnectionId'].includes(key),
        )
        .sort(),
    )
  })

  it('keeps the destination state and read time, and no URI or pin, even when verified', () => {
    expect(toBrowserProperty(linked).googleReviewDestination).toEqual({
      state: 'verified',
      retrievedAt: RETRIEVED_AT,
    })
  })

  it('leaves every other field as the Property holds it', () => {
    const browser = toBrowserProperty(linked)

    expect(browser).toMatchObject({
      id: linked.id,
      organizationId: linked.organizationId,
      name: 'Harbour Hotel',
      slug: linked.slug,
      timezone: linked.timezone,
      countryCode: linked.countryCode,
      googleBindingState: 'active',
      lifecycleState: linked.lifecycleState,
      profileVersion: linked.profileVersion,
      sourceEpoch: linked.sourceEpoch,
      updatedAt: linked.updatedAt,
    })
  })

  it('invents no destination for a Property that carries none', () => {
    const { googleReviewDestination: _none, ...withoutDestination } = linked

    expect(Object.keys(toBrowserProperty(withoutDestination))).not.toContain(
      'googleReviewDestination',
    )
  })

  it('does not change the Property it is given', () => {
    toBrowserProperty(linked)

    expect(linked.gbpLocationId).toBe('location-suffix-7731')
    expect(linked.googleReviewDestination?.uri).toBe(
      'https://search.google.com/local/writereview?placeid=held-9902',
    )
  })
})
