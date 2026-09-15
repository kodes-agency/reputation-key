import { describe, expect, it } from 'vitest'
import { searchAfterInboxScopeChange } from './use-inbox-scope-navigation'

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
