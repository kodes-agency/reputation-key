import { describe, expect, it } from 'vitest'
import { PORTAL_OVERVIEW_LONG_LIST, toolbarParts } from './portal-overview-toolbar'

const base = {
  scope: 'property' as const,
  total: 3,
  hasGroups: false,
  needingAttention: 0,
  search: {},
}

describe('toolbarParts', () => {
  it('draws nothing for one Property with a few Portals, no group and nothing to attend to', () => {
    expect(toolbarParts(base)).toEqual({
      search: false,
      sort: false,
      groupBy: false,
      attention: false,
    })
  })

  it('draws the search and the sort once the list is long enough to need them', () => {
    expect(toolbarParts({ ...base, total: PORTAL_OVERVIEW_LONG_LIST - 1 })).toMatchObject(
      { search: false, sort: false },
    )
    expect(toolbarParts({ ...base, total: PORTAL_OVERVIEW_LONG_LIST })).toMatchObject({
      search: true,
      sort: true,
    })
  })

  it('offers Group by only to a Property that has a group', () => {
    expect(toolbarParts({ ...base, hasGroups: true }).groupBy).toBe(true)
    expect(toolbarParts({ ...base, hasGroups: false, total: 40 }).groupBy).toBe(false)
  })

  it('offers the filter while a Portal needs attention, and keeps it while it is on', () => {
    expect(toolbarParts({ ...base, needingAttention: 2 }).attention).toBe(true)
    expect(toolbarParts({ ...base, search: { show: 'attention' } }).attention).toBe(true)
  })

  it('keeps the search and the sort while the list is searched, however short', () => {
    expect(toolbarParts({ ...base, search: { q: 'pool' } })).toMatchObject({
      search: true,
      sort: true,
    })
    // A blank search narrows nothing.
    expect(toolbarParts({ ...base, search: { q: '  ' } }).search).toBe(false)
  })

  it('does not bring a search in front of the filter it was pressed on: the toggle undoes itself', () => {
    expect(toolbarParts({ ...base, search: { show: 'attention' } })).toEqual({
      search: false,
      sort: false,
      groupBy: false,
      attention: true,
    })
  })

  it('always offers the search and the sort on All properties, which has no grouping', () => {
    const all = toolbarParts({ ...base, scope: 'organization', hasGroups: true })
    expect(all).toMatchObject({ search: true, sort: true, groupBy: false })
  })
})
