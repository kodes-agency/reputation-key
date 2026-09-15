import { describe, expect, it } from 'vitest'
import {
  offersPropertyScope,
  previewScopeProperties,
  scopeCount,
  searchAfterInboxScopeChange,
  sortScopeProperties,
  type InboxScopeProperty,
} from './inbox-property-scope'

const property = (id: string, name = id): InboxScopeProperty => ({ id, name })

const portfolio = (size: number) =>
  Array.from({ length: size }, (_, index) =>
    property(`p${String(index + 1).padStart(2, '0')}`),
  )

describe('sortScopeProperties', () => {
  it('orders by name the way a person reads it, never by count', () => {
    const sorted = sortScopeProperties([
      property('3', 'rila Grand Hotel'),
      property('1', 'Hotel 10'),
      property('2', 'Hotel 9'),
      property('4', 'Black Sea Residence'),
    ])

    expect(sorted.map((p) => p.name)).toEqual([
      'Black Sea Residence',
      'Hotel 9',
      'Hotel 10',
      'rila Grand Hotel',
    ])
  })

  it('leaves the route data it was given untouched', () => {
    const properties = [property('b', 'B'), property('a', 'A')]
    sortScopeProperties(properties)
    expect(properties.map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('offersPropertyScope', () => {
  it('offers a choice only when there is more than one property', () => {
    expect(offersPropertyScope([])).toBe(false)
    expect(offersPropertyScope([property('a')])).toBe(false)
    expect(offersPropertyScope([property('a'), property('b')])).toBe(true)
  })
})

describe('previewScopeProperties', () => {
  it('shows every property when folding would hide fewer than two', () => {
    expect(previewScopeProperties(portfolio(8), null, false)).toEqual({
      visible: portfolio(8),
      isFolded: false,
    })
  })

  it('shows the first seven by name, then folds the rest', () => {
    const { visible, isFolded } = previewScopeProperties(portfolio(24), null, false)

    expect(visible.map((p) => p.id)).toEqual(portfolio(7).map((p) => p.id))
    expect(isFolded).toBe(true)
  })

  it('keeps the property in view on screen even past seven, in its sorted place', () => {
    const { visible } = previewScopeProperties(portfolio(24), 'p20', false)

    expect(visible.map((p) => p.id)).toEqual([...portfolio(7).map((p) => p.id), 'p20'])
  })

  it('shows everything once expanded', () => {
    expect(previewScopeProperties(portfolio(24), null, true)).toEqual({
      visible: portfolio(24),
      isFolded: false,
    })
  })
})

describe('scopeCount', () => {
  const counts = {
    queue: 'reply' as const,
    total: 23,
    byProperty: { elegance: 12, rila: 8, blackSea: 3 },
  }

  it('reads the organization total for All properties', () => {
    expect(scopeCount(counts, null)).toBe(23)
  })

  it('reads zero for a property with nothing in the queue', () => {
    expect(scopeCount(counts, 'rila')).toBe(8)
    expect(scopeCount(counts, 'borovets')).toBe(0)
  })

  it('has no count before the counts load', () => {
    expect(scopeCount(undefined, null)).toBeUndefined()
    expect(scopeCount(undefined, 'rila')).toBeUndefined()
  })
})

describe('searchAfterInboxScopeChange', () => {
  it('keeps queue, filters and sort but drops the opened item and the old scope', () => {
    expect(
      searchAfterInboxScopeChange({
        queue: 'closed',
        ratingMax: 2,
        sort: 'oldest',
        itemId: '20000000-0000-4000-8000-000000000001',
        propertyId: '10000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({ queue: 'closed', ratingMax: 2, sort: 'oldest' })
  })

  it('carries nothing from a search that is not an object', () => {
    expect(searchAfterInboxScopeChange(null)).toEqual({})
    expect(searchAfterInboxScopeChange('queue=closed')).toEqual({})
  })
})
