import { describe, expect, it } from 'vitest'
import type { PropertySetupStep } from '#/contexts/reporting/application/public-api'
import {
  buildPropertyListRows,
  filterPropertyListRows,
  propertyListSearchPatch,
  resolvePropertyListView,
  sortPropertyListRows,
  summarizePropertyList,
  type PropertyAttention,
  type PropertyComparison,
  type PropertyListProperty,
  type PropertySetupProgress,
} from './property-list-view'

const property = (
  id: string,
  name: string,
  overrides: Partial<PropertyListProperty> = {},
): PropertyListProperty => ({
  id,
  name,
  address: null,
  countryCode: null,
  googleBindingState: 'active',
  lifecycleState: 'active',
  ...overrides,
})

const attention = (overrides: Partial<PropertyAttention> = {}): PropertyAttention => ({
  total: 0,
  overdue: 0,
  itemsToTriage: 0,
  escalated: 0,
  goalsBehindPace: 0,
  ...overrides,
})

const figures = (
  avgRating: number | null,
  reviewCount: number,
  total = 0,
): PropertyComparison => ({
  avgRating,
  reviewCount,
  attention: attention({ total, itemsToTriage: total }),
})

const step: PropertySetupStep = {
  key: 'portal_published',
  status: 'pending',
  asked: false,
  section: 'portals',
}
const progress = (completedCount: number): PropertySetupProgress => ({
  completedCount,
  stepCount: 7,
  nextStep: completedCount === 7 ? null : step,
})

const ELEGANCE = property('p-elegance', 'Hotel Elegance', {
  address: 'улица „Петко Р. Славейков“ 54, Стара Загора, 6000',
  countryCode: 'BG',
})
const HARBORLINE = property('p-harborline', 'Harborline Suites', { countryCode: 'US' })
const KODES = property('p-kodes', 'KODES agency', { countryCode: 'BG' })
const INITECH = property('p-initech', 'Initech Campus', {
  countryCode: 'GB',
  googleBindingState: 'unbound',
})
const GLOBEX = property('p-globex', 'Globex HQ', { lifecycleState: 'suspended' })
const ACCENTED = property('p-cafe', 'Café Émile')

const rows = buildPropertyListRows(
  [HARBORLINE, INITECH, ELEGANCE, GLOBEX, KODES, ACCENTED],
  new Map([
    ['p-elegance', figures(3.9, 260, 7)],
    ['p-harborline', figures(4.3, 412, 4)],
    ['p-kodes', figures(5, 20, 1)],
    ['p-initech', figures(null, 0)],
    ['p-globex', figures(3.1, 26)],
    ['p-cafe', figures(5, 20)],
  ]),
  new Map([
    ['p-elegance', progress(6)],
    ['p-harborline', progress(7)],
    ['p-kodes', progress(5)],
    ['p-initech', progress(1)],
    ['p-globex', progress(7)],
    ['p-cafe', progress(7)],
  ]),
)
const names = (list: ReadonlyArray<{ property: PropertyListProperty }>) =>
  list.map((row) => row.property.name)

describe('buildPropertyListRows', () => {
  it('names the country and marks a paused property', () => {
    const byId = new Map(rows.map((row) => [row.property.id, row]))
    expect(byId.get('p-elegance')).toMatchObject({ country: 'Bulgaria', paused: false })
    expect(byId.get('p-globex')).toMatchObject({ country: null, paused: true })
  })
})

describe('resolvePropertyListView', () => {
  const ready = { fleet: 'ready', setup: 'ready' } as const

  it('opens on what needs attention first, most first', () => {
    expect(resolvePropertyListView({}, ready)).toMatchObject({
      sort: 'attention',
      dir: 'desc',
      appliedSort: 'attention',
      appliedDir: 'desc',
      q: '',
      show: null,
    })
  })

  it('gives each sort its natural direction until one is chosen', () => {
    expect(resolvePropertyListView({ sort: 'setup' }, ready)).toMatchObject({
      dir: 'asc',
    })
    expect(resolvePropertyListView({ sort: 'rating' }, ready)).toMatchObject({
      dir: 'desc',
    })
    expect(resolvePropertyListView({ sort: 'rating', dir: 'asc' }, ready)).toMatchObject({
      dir: 'asc',
    })
  })

  it('holds name order while the figures a sort needs are still loading', () => {
    expect(
      resolvePropertyListView({}, { fleet: 'loading', setup: 'ready' }),
    ).toMatchObject({ sort: 'attention', appliedSort: 'name', appliedDir: 'asc' })
  })

  it('falls back to name, and drops the filter, when the figures are unavailable', () => {
    expect(
      resolvePropertyListView(
        { sort: 'rating', dir: 'asc', show: 'attention' },
        { fleet: 'unavailable', setup: 'ready' },
      ),
    ).toMatchObject({ sort: 'name', dir: 'asc', appliedSort: 'name', show: null })
    expect(
      resolvePropertyListView(
        { show: 'setup' },
        { fleet: 'ready', setup: 'unavailable' },
      ),
    ).toMatchObject({ show: null })
    // Google state comes with the list itself, so it never needs a read.
    expect(
      resolvePropertyListView(
        { show: 'google' },
        { fleet: 'unavailable', setup: 'unavailable' },
      ),
    ).toMatchObject({ show: 'google' })
  })
})

describe('propertyListSearchPatch', () => {
  it('writes nothing for a default, so the default view keeps a bare URL', () => {
    expect(
      propertyListSearchPatch({ q: 'x', sort: 'rating' }, { q: '', sort: 'attention' }),
    ).toEqual({})
    expect(propertyListSearchPatch({}, { sort: 'setup', dir: 'asc' })).toEqual({
      sort: 'setup',
    })
  })

  it('keeps what differs from the default', () => {
    expect(propertyListSearchPatch({ q: 'sof' }, { sort: 'name', dir: 'desc' })).toEqual({
      q: 'sof',
      sort: 'name',
      dir: 'desc',
    })
    expect(propertyListSearchPatch({}, { show: 'google' })).toEqual({ show: 'google' })
  })
})

describe('propertyListSearchPatch then resolvePropertyListView', () => {
  const ready = { fleet: 'ready', setup: 'ready' } as const
  const roundTrip = (patch: Parameters<typeof propertyListSearchPatch>[1]) =>
    resolvePropertyListView(propertyListSearchPatch({}, patch), ready)

  it('keeps a reversed direction on the default sort, which the URL does not name', () => {
    expect(roundTrip({ sort: 'attention', dir: 'asc' })).toMatchObject({
      sort: 'attention',
      dir: 'asc',
      appliedDir: 'asc',
    })
  })

  it('keeps every sort and direction a control can write', () => {
    for (const sort of ['attention', 'name', 'rating', 'reviews', 'setup'] as const) {
      for (const dir of ['asc', 'desc'] as const) {
        expect(roundTrip({ sort, dir })).toMatchObject({ sort, dir })
      }
    }
  })
})

describe('sortPropertyListRows', () => {
  it('puts the most work first, then the least set-up, then the name', () => {
    expect(names(sortPropertyListRows(rows, 'attention', 'desc'))).toEqual([
      'Hotel Elegance',
      'Harborline Suites',
      'KODES agency',
      'Initech Campus',
      'Café Émile',
      'Globex HQ',
    ])
  })

  it('sorts a missing rating last in both directions', () => {
    expect(names(sortPropertyListRows(rows, 'rating', 'desc')).at(-1)).toBe(
      'Initech Campus',
    )
    expect(names(sortPropertyListRows(rows, 'rating', 'asc')).at(-1)).toBe(
      'Initech Campus',
    )
    expect(names(sortPropertyListRows(rows, 'rating', 'asc')).at(0)).toBe('Globex HQ')
  })

  it('breaks a rating tie by the larger sample', () => {
    // KODES agency and Café Émile both read 5.0 over 20 reviews: then by name.
    expect(names(sortPropertyListRows(rows, 'rating', 'desc')).slice(0, 2)).toEqual([
      'Café Émile',
      'KODES agency',
    ])
  })

  it('sorts unknown figures last', () => {
    const partial = buildPropertyListRows(
      [HARBORLINE, KODES],
      new Map([['p-kodes', figures(5, 20)]]),
      undefined,
    )
    expect(names(sortPropertyListRows(partial, 'reviews', 'asc'))).toEqual([
      'KODES agency',
      'Harborline Suites',
    ])
    expect(names(sortPropertyListRows(partial, 'setup', 'asc'))).toEqual([
      'Harborline Suites',
      'KODES agency',
    ])
  })

  it('orders names by letters, not by accents or case', () => {
    expect(names(sortPropertyListRows(rows, 'name', 'asc'))).toEqual([
      'Café Émile',
      'Globex HQ',
      'Harborline Suites',
      'Hotel Elegance',
      'Initech Campus',
      'KODES agency',
    ])
    expect(names(sortPropertyListRows(rows, 'name', 'desc')).at(0)).toBe('KODES agency')
  })

  it('does not reorder the list it was given', () => {
    const before = names(rows)
    sortPropertyListRows(rows, 'name', 'asc')
    expect(names(rows)).toEqual(before)
  })
})

describe('filterPropertyListRows', () => {
  it('matches the name, the address and the country, ignoring case and accents', () => {
    expect(names(filterPropertyListRows(rows, { q: 'cafe emile', show: null }))).toEqual([
      'Café Émile',
    ])
    expect(
      names(filterPropertyListRows(rows, { q: 'СТАРА загора', show: null })),
    ).toEqual(['Hotel Elegance'])
    expect(names(filterPropertyListRows(rows, { q: 'bulgaria', show: null }))).toEqual([
      'Hotel Elegance',
      'KODES agency',
    ])
  })

  it('shows what needs attention, what has setup left, or what Google does not link', () => {
    expect(names(filterPropertyListRows(rows, { q: '', show: 'attention' }))).toEqual([
      'Harborline Suites',
      'Hotel Elegance',
      'KODES agency',
    ])
    expect(names(filterPropertyListRows(rows, { q: '', show: 'setup' }))).toEqual([
      'Initech Campus',
      'Hotel Elegance',
      'KODES agency',
    ])
    expect(names(filterPropertyListRows(rows, { q: '', show: 'google' }))).toEqual([
      'Initech Campus',
    ])
  })

  it('keeps a row whose figures have not arrived rather than hiding it', () => {
    const pending = buildPropertyListRows([HARBORLINE], undefined, undefined)
    expect(filterPropertyListRows(pending, { q: '', show: 'attention' })).toHaveLength(1)
  })
})

describe('summarizePropertyList', () => {
  it('weights the average by reviews and counts the properties behind each figure', () => {
    expect(summarizePropertyList(rows)).toEqual({
      properties: 6,
      // (3.9·260 + 4.3·412 + 5·20 + 3.1·26 + 5·20) / 738
      averageRating: expect.closeTo(4.155, 3),
      ratedReviews: 738,
      needsAttention: 12,
      propertiesNeedingAttention: 3,
      propertiesWithSetupLeft: 3,
      googleLinked: 5,
    })
  })

  it('has no average without a rating', () => {
    const unrated = buildPropertyListRows(
      [INITECH],
      new Map([['p-initech', figures(null, 0)]]),
      undefined,
    )
    expect(summarizePropertyList(unrated)).toMatchObject({
      averageRating: null,
      ratedReviews: 0,
    })
  })
})
