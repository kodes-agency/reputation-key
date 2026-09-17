import { describe, expect, it } from 'vitest'
import {
  matchesScopeSearch,
  offersPropertyScope,
  offersScopeSearch,
  scopeCount,
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

describe('offersScopeSearch', () => {
  it('adds a search field only once the list is long enough to search', () => {
    expect(offersScopeSearch(portfolio(7))).toBe(false)
    expect(offersScopeSearch(portfolio(8))).toBe(true)
    expect(offersScopeSearch(portfolio(24))).toBe(true)
  })
})

describe('matchesScopeSearch', () => {
  it('finds a property by any part of its name, whatever the case', () => {
    expect(matchesScopeSearch('Rila Grand Hotel', 'rila')).toBe(true)
    expect(matchesScopeSearch('Rila Grand Hotel', 'GRAND')).toBe(true)
    expect(matchesScopeSearch('Rila Grand Hotel', 'sofia')).toBe(false)
  })

  it('ignores accents on either side', () => {
    expect(matchesScopeSearch('Café Plaza', 'cafe')).toBe(true)
    expect(matchesScopeSearch('Cafe Plaza', 'café')).toBe(true)
  })

  it('matches everything for an empty or blank search', () => {
    expect(matchesScopeSearch('Rila Grand Hotel', '')).toBe(true)
    expect(matchesScopeSearch('Rila Grand Hotel', '   ')).toBe(true)
  })

  it('is not fuzzy: letters in order are not a match', () => {
    expect(matchesScopeSearch('Rila Grand Hotel', 'rgh')).toBe(false)
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
