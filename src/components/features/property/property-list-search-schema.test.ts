import { describe, expect, it } from 'vitest'
import { propertyListSearchSchema } from './property-list-search-schema'

describe('propertyListSearchSchema', () => {
  it('keeps a bare URL bare', () => {
    expect(propertyListSearchSchema.parse({})).toEqual({})
  })

  it('drops values a hand-edited URL cannot mean instead of refusing the page', () => {
    expect(
      propertyListSearchSchema.parse({
        q: 'x'.repeat(101),
        show: 'everything',
        sort: 'price',
        dir: 'sideways',
        tab: 'archive',
      }),
    ).toEqual({})
  })

  it('reads every value it owns', () => {
    expect(
      propertyListSearchSchema.parse({
        q: 'sofia',
        show: 'setup',
        sort: 'rating',
        dir: 'asc',
        tab: 'removed',
      }),
    ).toEqual({ q: 'sofia', show: 'setup', sort: 'rating', dir: 'asc', tab: 'removed' })
  })
})
