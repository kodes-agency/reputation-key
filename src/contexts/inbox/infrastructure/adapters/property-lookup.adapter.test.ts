import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { PropertyLookupSource } from '../../application/ports/lookup-sources.port'
import { createPropertyLookupAdapter } from './property-lookup.adapter'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('00000000-0000-4000-8000-0000000000a1')
const WRITE_REVIEW =
  'https://search.google.com/local/writereview?placeid=repkey-synthetic-place-0001'
const REVIEWS_PAGE =
  'https://search.google.com/local/reviews?placeid=repkey-synthetic-place-0001'

function adapter(source: Partial<PropertyLookupSource> = {}) {
  return createPropertyLookupAdapter({
    getPropertyName: vi.fn(async () => 'Seaside Rooms'),
    getPropertyNames: vi.fn(async () => []),
    ...source,
  })
}

const holding = (state: string, uri: string | null) => vi.fn(async () => ({ state, uri }))

describe("the Property's Google reviews page", () => {
  it('comes from a verified write-a-review destination', async () => {
    const getGoogleReviewDestination = holding('verified', WRITE_REVIEW)
    const lookup = adapter({ getGoogleReviewDestination })

    await expect(lookup.getPropertyGoogleReviewsPageById?.(PROPERTY, ORG)).resolves.toBe(
      REVIEWS_PAGE,
    )
    expect(getGoogleReviewDestination).toHaveBeenCalledWith(ORG, PROPERTY)
  })

  it.each([
    ['awaiting_refresh', WRITE_REVIEW],
    ['unavailable', null],
    ['verified', null],
  ])('is not offered for a destination that is %s (%s)', async (state, uri) => {
    const lookup = adapter({ getGoogleReviewDestination: holding(state, uri) })
    await expect(
      lookup.getPropertyGoogleReviewsPageById?.(PROPERTY, ORG),
    ).resolves.toBeNull()
  })

  it('is not offered for a verified destination in another form', async () => {
    const lookup = adapter({
      getGoogleReviewDestination: holding('verified', 'https://g.page/r/place/review'),
    })
    await expect(
      lookup.getPropertyGoogleReviewsPageById?.(PROPERTY, ORG),
    ).resolves.toBeNull()
  })

  it('is not offered when the Property is not found or the source cannot say', async () => {
    const missing = adapter({ getGoogleReviewDestination: vi.fn(async () => null) })
    await expect(
      missing.getPropertyGoogleReviewsPageById?.(PROPERTY, ORG),
    ).resolves.toBeNull()

    const legacy = adapter()
    await expect(
      legacy.getPropertyGoogleReviewsPageById?.(PROPERTY, ORG),
    ).resolves.toBeNull()
  })
})
