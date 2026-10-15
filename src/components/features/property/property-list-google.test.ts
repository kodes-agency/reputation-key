// The Properties list's Rating and Reviews are Google's own number and count
// (decision 16): its order and its summary read them, never RepKey's average.
import { describe, expect, it } from 'vitest'
import type { GoogleNumbersView } from '#/contexts/reporting/application/public-api'
import {
  buildPropertyListRows,
  sortPropertyListRows,
  summarizePropertyList,
  type PropertyComparison,
  type PropertyListProperty,
} from './property-list-view'

const property = (id: string, name: string): PropertyListProperty => ({
  id,
  name,
  address: null,
  countryCode: null,
  googleBindingState: 'active',
  lifecycleState: 'active',
})

const google = (overrides: Partial<GoogleNumbersView> = {}): GoogleNumbersView => ({
  shows: 4.3,
  reviewCount: 100,
  asOf: '2026-10-12T08:00:00.000Z',
  current: true,
  ...overrides,
})

const withGoogle = (numbers: GoogleNumbersView | null): PropertyComparison => ({
  timezone: 'Europe/Sofia',
  google: numbers,
  ratingGoal: null,
  attention: { total: 0, overdue: 0, itemsToTriage: 0, escalated: 0, goalsBehindPace: 0 },
})

const HARBORLINE = property('p-harborline', 'Harborline Suites')
const KODES = property('p-kodes', 'KODES agency')
const INITECH = property('p-initech', 'Initech Campus')

describe('the list’s Google numbers', () => {
  it('keeps Google’s last numbers in the average while they are more than a day old', () => {
    // Arrange
    const rows = buildPropertyListRows(
      [HARBORLINE, KODES],
      new Map([
        ['p-harborline', withGoogle(google({ shows: 4, current: false }))],
        ['p-kodes', withGoogle(google({ shows: 5 }))],
      ]),
      undefined,
    )

    // Act / Assert
    expect(summarizePropertyList(rows)).toMatchObject({
      averageRating: 4.5,
      ratedReviews: 200,
    })
  })

  it('leaves out of the average a Property Google shows no number for', () => {
    // Arrange: Google counts no review for Harborline, and never rated Initech.
    const rows = buildPropertyListRows(
      [HARBORLINE, KODES, INITECH],
      new Map([
        ['p-harborline', withGoogle(google({ shows: null, reviewCount: 0 }))],
        ['p-kodes', withGoogle(google({ shows: 5, reviewCount: 10 }))],
        ['p-initech', withGoogle(null)],
      ]),
      undefined,
    )

    // Act / Assert
    expect(summarizePropertyList(rows)).toMatchObject({
      averageRating: 5,
      ratedReviews: 10,
    })
  })

  it('orders by what Google shows, then by Google’s count, and a Property without numbers last', () => {
    // Arrange
    const rows = buildPropertyListRows(
      [INITECH, HARBORLINE, KODES],
      new Map([
        ['p-harborline', withGoogle(google({ shows: 4.6, reviewCount: 412 }))],
        ['p-kodes', withGoogle(google({ shows: 4.6, reviewCount: 20 }))],
        ['p-initech', withGoogle(null)],
      ]),
      undefined,
    )
    const names = (sorted: ReturnType<typeof sortPropertyListRows>) =>
      sorted.map((row) => row.property.name)

    // Act / Assert
    expect(names(sortPropertyListRows(rows, 'rating', 'desc'))).toEqual([
      'Harborline Suites',
      'KODES agency',
      'Initech Campus',
    ])
    expect(names(sortPropertyListRows(rows, 'reviews', 'asc'))).toEqual([
      'KODES agency',
      'Harborline Suites',
      'Initech Campus',
    ])
  })
})
