import { describe, expect, it } from 'vitest'
import { describeAllProperties } from './portal-all-properties-view'

describe('describeAllProperties', () => {
  const organizationWide = { organizationWide: true }

  it('says how many Properties and Portals the Organization has, as board 10 does', () => {
    expect(
      describeAllProperties(
        { properties: 3, portals: 11, known: 3, ...organizationWide },
        'Avela Hospitality',
      ),
    ).toBe('All 3 properties in Avela Hospitality · 11 portals')
  })

  it('does not say "all" when some Properties have no Portals', () => {
    expect(
      describeAllProperties(
        { properties: 2, portals: 8, known: 5, ...organizationWide },
        'Avela Hospitality',
      ),
    ).toBe('2 properties in Avela Hospitality · 8 portals')
  })

  it('does not say "all" when the reader is assigned only some of the Properties', () => {
    // A Property Manager assigned 2 of the Organization's 3 Properties is told
    // about those 2: every Property they can list has Portals, but "all" would be
    // about the Organization, which they cannot see whole.
    expect(
      describeAllProperties(
        { properties: 2, portals: 5, known: 2, organizationWide: false },
        'Avela Hospitality',
      ),
    ).toBe('2 properties in Avela Hospitality · 5 portals')
  })

  it('says one in the singular', () => {
    expect(
      describeAllProperties(
        { properties: 1, portals: 1, known: 1, ...organizationWide },
        'Avela Hospitality',
      ),
    ).toBe('1 property in Avela Hospitality · 1 portal')
  })

  it('names no Organization it was not given', () => {
    expect(
      describeAllProperties(
        { properties: 2, portals: 4, known: 2, ...organizationWide },
        undefined,
      ),
    ).toBe('All 2 properties · 4 portals')
  })

  it('has nothing to say with no Portals', () => {
    expect(
      describeAllProperties(
        { properties: 0, portals: 0, known: 2, ...organizationWide },
        'Avela',
      ),
    ).toBeUndefined()
  })
})
