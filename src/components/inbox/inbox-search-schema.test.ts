// The Inbox's address, read from whatever a bookmark, an old notice or a typed
// URL carries. A value the page cannot read is dropped and the rest is kept:
// refusing the page left the generic error and a "Try again" that parsed the
// same address again.
import { describe, expect, it } from 'vitest'
import { inboxSearchObjectSchema, inboxSearchSchema } from './inbox-search-schema'

const ITEM_ID = '7f1c2c9e-6c7b-4a0e-9d0e-2f6a3b1c4d5e'
const PROPERTY_ID = '0b9d7c1a-3e5f-4b2a-8c6d-1e2f3a4b5c6d'

describe('inboxSearchSchema', () => {
  it('reads an address made of values it knows', () => {
    expect(
      inboxSearchSchema.parse({
        queue: 'closed',
        itemId: ITEM_ID,
        propertyId: PROPERTY_ID,
        sourceType: 'review',
        attention: 'urgent',
        aspect: 'wait_time',
        polarity: 'negative',
        q: 'breakfast',
        sort: 'oldest',
      }),
    ).toEqual({
      queue: 'closed',
      itemId: ITEM_ID,
      propertyId: PROPERTY_ID,
      sourceType: 'review',
      attention: 'urgent',
      aspect: 'wait_time',
      polarity: 'negative',
      q: 'breakfast',
      sort: 'oldest',
    })
  })

  it.each([
    ['queue', 'everything'],
    ['itemId', '123'],
    ['sourceType', 'tweet'],
    ['ratingMin', 9],
    ['ratingMax', 'five'],
    ['attention', 'critical'],
    ['aspect', 'parking_valet'],
    ['polarity', 'angry'],
    // The router reads `?q=123` as a number.
    ['q', 123],
    ['sort', 'recent'],
  ])('drops %s it cannot read and keeps the rest of the address', (key, value) => {
    const rest = key === 'sort' ? { q: 'late checkout' } : { sort: 'oldest' }

    expect(inboxSearchSchema.parse({ [key]: value, ...rest })).toEqual(rest)
  })

  it('drops a property that is not an id, so the scope stays "All properties"', () => {
    expect(inboxSearchSchema.parse({ propertyId: 'foo', queue: 'reply' })).toEqual({
      queue: 'reply',
    })
  })

  it('still maps the folder of an old bookmark onto its queue', () => {
    expect(inboxSearchSchema.parse({ folder: 'open' })).toEqual({ queue: 'reply' })
    expect(inboxSearchSchema.parse({ folder: 'archive' })).toEqual({})
  })

  it('keeps the rating presets the filter can show and drops a range it cannot', () => {
    expect(inboxSearchSchema.parse({ ratingMin: '4' })).toEqual({ ratingMin: 4 })
    expect(inboxSearchSchema.parse({ ratingMin: 2, ratingMax: 4 })).toEqual({})
  })
})

describe("a property's Reviews address", () => {
  // The route omits `propertyId` (it is in the path) and parses the rest.
  const reviewsSearch = inboxSearchObjectSchema.omit({ propertyId: true })

  it('drops a value it cannot read instead of refusing the page', () => {
    expect(
      reviewsSearch.parse({ sort: 'recent', itemId: 'abc', queue: 'closed' }),
    ).toEqual({ queue: 'closed' })
  })
})
