import { describe, expect, it } from 'vitest'
import {
  isInboxScopeInView,
  searchAfterInboxScopeChange,
} from './use-inbox-scope-navigation'

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

describe('isInboxScopeInView', () => {
  const PROPERTY = '10000000-0000-4000-8000-000000000001'
  const OTHER = '10000000-0000-4000-8000-000000000002'

  it('reads All properties from the organization-wide inbox', () => {
    const inbox = { pathname: '/inbox', search: { queue: 'reply' } }
    expect(isInboxScopeInView(inbox, null)).toBe(true)
    expect(isInboxScopeInView(inbox, PROPERTY)).toBe(false)
  })

  it('reads a property from its own Reviews page, whatever item is open', () => {
    const reviews = {
      pathname: `/properties/${PROPERTY}/reviews`,
      search: { itemId: '20000000-0000-4000-8000-000000000001' },
    }
    expect(isInboxScopeInView(reviews, PROPERTY)).toBe(true)
    expect(isInboxScopeInView(reviews, OTHER)).toBe(false)
    expect(isInboxScopeInView(reviews, null)).toBe(false)
  })

  it('reads a property from an inbox deep link', () => {
    const deepLink = { pathname: '/inbox', search: { propertyId: PROPERTY } }
    expect(isInboxScopeInView(deepLink, PROPERTY)).toBe(true)
    expect(isInboxScopeInView(deepLink, null)).toBe(false)
  })
})
