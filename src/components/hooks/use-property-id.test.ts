import { describe, expect, it } from 'vitest'
import { propertyIdFromLocation } from './use-property-id'

const PATH_PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
const SEARCH_PROPERTY_ID = '10000000-0000-4000-8000-000000000002'

describe('propertyIdFromLocation', () => {
  it('uses a valid property route id before the search scope', () => {
    expect(
      propertyIdFromLocation(`/properties/${PATH_PROPERTY_ID}/reviews`, {
        propertyId: SEARCH_PROPERTY_ID,
      }),
    ).toBe(PATH_PROPERTY_ID)
  })

  it('does not manufacture a property scope from a static route segment', () => {
    expect(propertyIdFromLocation('/properties/import-google', {})).toBeNull()
  })

  it('falls back to a valid search scope when the path is not property-scoped', () => {
    expect(
      propertyIdFromLocation('/properties/import-google', {
        propertyId: SEARCH_PROPERTY_ID,
      }),
    ).toBe(SEARCH_PROPERTY_ID)
  })

  it('rejects malformed search scopes', () => {
    expect(
      propertyIdFromLocation('/inbox', { propertyId: 'not-a-property-id' }),
    ).toBeNull()
  })
})
