import { describe, expect, it } from 'vitest'
import {
  allPropertiesMembers,
  allPropertiesProperties,
  allPropertiesRows,
} from './portal-all-properties-fixtures'
import { buildAllPropertiesOverview } from './portal-all-properties-view'

const build = (search: Parameters<typeof buildAllPropertiesOverview>[2] = {}) =>
  buildAllPropertiesOverview(
    allPropertiesRows(),
    allPropertiesProperties,
    search,
    allPropertiesMembers,
    20,
  )

const portalNames = (page: ReturnType<typeof build>) =>
  page.properties.flatMap((property) =>
    property.sections.flatMap((section) => section.items.map((item) => item.row.name)),
  )

describe('the All properties Needs attention filter', () => {
  it('counts, across every Property, the Portals that need attention before any search', () => {
    const page = build()
    // The same count as the Portals the filter keeps: the page offers a number it can honour.
    expect(page.needingAttention).toBeGreaterThan(0)
    expect(build({ show: 'attention' }).matched).toBe(page.needingAttention)
  })

  it('keeps only the Portals that need attention, under their own Property', () => {
    const page = build({ show: 'attention' })
    const names = portalNames(page)

    expect(names.length).toBe(page.matched)
    expect(names.length).toBeLessThan(build().matched)
    // A Property with nothing to attend to is not a head over nothing.
    expect(page.properties.every((property) => property.sections.length > 0)).toBe(true)
    expect(names).toContain('Pool bar')
    expect(names).not.toContain('Reception')
  })

  it('says how many need attention whatever the search leaves', () => {
    expect(build({ q: 'reception' }).needingAttention).toBe(build().needingAttention)
  })
})
