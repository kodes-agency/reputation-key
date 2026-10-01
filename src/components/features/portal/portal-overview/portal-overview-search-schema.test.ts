import { describe, expect, it } from 'vitest'
import {
  allPropertiesSearchSchema,
  defaultSortDirection,
  portalOverviewSearchPatch,
  portalOverviewSearchSchema,
} from './portal-overview-search-schema'

describe('portalOverviewSearchSchema', () => {
  it('keeps a bare URL bare', () => {
    expect(portalOverviewSearchSchema.parse({})).toEqual({})
  })

  it('drops values a hand-edited URL cannot mean instead of refusing the page', () => {
    expect(
      portalOverviewSearchSchema.parse({
        q: 'x'.repeat(101),
        groupBy: 'colour',
        show: 'everything',
        sort: 'price',
        dir: 'sideways',
        page: 0,
      }),
    ).toEqual({})
    expect(portalOverviewSearchSchema.parse({ page: 'two' })).toEqual({})
    expect(portalOverviewSearchSchema.parse({ page: 1.5 })).toEqual({})
  })

  it('reads every value it owns', () => {
    expect(
      portalOverviewSearchSchema.parse({
        q: 'pool',
        groupBy: 'none',
        show: 'attention',
        sort: 'attention',
        dir: 'asc',
        page: 3,
      }),
    ).toEqual({
      q: 'pool',
      groupBy: 'none',
      show: 'attention',
      sort: 'attention',
      dir: 'asc',
      page: 3,
    })
  })

  it('reads the open New portal dialog however the router spelled it', () => {
    for (const spelled of [true, 'true', 1, '1']) {
      expect(portalOverviewSearchSchema.parse({ new: spelled })).toEqual({ new: true })
    }
    expect(portalOverviewSearchSchema.parse({ new: false })).toEqual({})
    expect(portalOverviewSearchSchema.parse({ new: 'maybe' })).toEqual({})
  })

  it('reads the sort by qualified scans, most first unless told otherwise', () => {
    expect(portalOverviewSearchSchema.parse({ sort: 'scans' })).toEqual({ sort: 'scans' })
    expect(defaultSortDirection('scans')).toBe('desc')
    expect(portalOverviewSearchPatch({}, { sort: 'scans' })).toEqual({ sort: 'scans' })
    expect(portalOverviewSearchPatch({ sort: 'scans' }, { dir: 'asc' })).toEqual({
      sort: 'scans',
      dir: 'asc',
    })
  })

  it('reads a page number the router left as a string', () => {
    expect(portalOverviewSearchSchema.parse({ page: '2' })).toEqual({ page: 2 })
  })
})

describe('portalOverviewSearchPatch', () => {
  it('keeps the dialog open across list changes and closes it when asked', () => {
    expect(portalOverviewSearchPatch({ new: true }, { q: 'pool' })).toEqual({
      q: 'pool',
      new: true,
    })
    expect(
      portalOverviewSearchPatch({ q: 'pool', new: true }, { new: undefined }),
    ).toEqual({
      q: 'pool',
    })
    expect(portalOverviewSearchPatch({ q: 'pool' }, { new: true })).toEqual({
      q: 'pool',
      new: true,
    })
  })

  it('leaves the default view bare: defaults and blanks are not written', () => {
    expect(
      portalOverviewSearchPatch(
        { q: 'pool', groupBy: 'none', sort: 'attention', dir: 'desc', page: 2 },
        { q: '  ', groupBy: 'group', sort: 'name', dir: 'asc', page: 1 },
      ),
    ).toEqual({})
  })

  it('goes back to the first page whenever what is listed changes', () => {
    expect(portalOverviewSearchPatch({ page: 3 }, { q: 'spa' })).toEqual({ q: 'spa' })
    expect(portalOverviewSearchPatch({ page: 3 }, { show: 'attention' })).toEqual({
      show: 'attention',
    })
    expect(portalOverviewSearchPatch({ page: 3 }, { sort: 'attention' })).toEqual({
      sort: 'attention',
    })
    expect(portalOverviewSearchPatch({ page: 3 }, { groupBy: 'none' })).toEqual({
      groupBy: 'none',
    })
  })

  it('keeps the page when only the page changes', () => {
    expect(portalOverviewSearchPatch({ q: 'spa' }, { page: 2 })).toEqual({
      q: 'spa',
      page: 2,
    })
  })

  it('keeps what the patch does not mention', () => {
    expect(
      portalOverviewSearchPatch({ q: 'spa', show: 'attention' }, { sort: 'attention' }),
    ).toEqual({
      q: 'spa',
      show: 'attention',
      sort: 'attention',
    })
  })

  it('does not change the object it was given', () => {
    const current = Object.freeze({ q: 'spa' })
    expect(portalOverviewSearchPatch(current, { q: undefined })).toEqual({})
    expect(current).toEqual({ q: 'spa' })
  })
})

describe('allPropertiesSearchSchema', () => {
  it('keeps a bare URL bare', () => {
    expect(allPropertiesSearchSchema.parse({})).toEqual({})
  })

  it('reads the search, the order and the page', () => {
    expect(
      allPropertiesSearchSchema.parse({ q: 'bar', sort: 'scans', dir: 'asc', page: 2 }),
    ).toEqual({ q: 'bar', sort: 'scans', dir: 'asc', page: 2 })
  })

  it('drops the filter and the grouping, which the page has no control for', () => {
    expect(
      allPropertiesSearchSchema.parse({ show: 'attention', groupBy: 'none', q: 'bar' }),
    ).toEqual({ q: 'bar' })
  })

  it('drops values a hand-edited URL cannot mean instead of refusing the page', () => {
    expect(
      allPropertiesSearchSchema.parse({ sort: 'price', dir: 'sideways', page: 0 }),
    ).toEqual({})
  })
})
