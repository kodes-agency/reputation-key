import { describe, expect, it } from 'vitest'
import { isOrganisationView, organisationViewFor } from './organisation-scope'

describe('organisationViewFor', () => {
  it.each([
    ['portals', '/portals'],
    ['inbox', '/inbox'],
    ['reviews', '/inbox'],
  ] as const)('sends the %s section to its own organisation view', (section, to) => {
    expect(organisationViewFor(section)).toBe(to)
  })

  it.each(['dashboard', 'ratings', 'google', 'guests', 'people', 'goals', ''])(
    'sends %j, which has no organisation view of its own, to the property list',
    (section) => {
      expect(organisationViewFor(section)).toBe('/properties')
    },
  )
})

describe('isOrganisationView', () => {
  it.each(['/inbox', '/portals', '/portals/', '/properties', '/properties/'])(
    'treats %s with no property in scope as an organisation view',
    (pathname) => {
      expect(isOrganisationView(pathname, null)).toBe(true)
    },
  )

  it('is never an organisation view once a property is in scope', () => {
    expect(isOrganisationView('/inbox', '10000000-0000-4000-8000-000000000001')).toBe(
      false,
    )
  })

  it.each(['/', '/properties/import-google', '/properties/import-google/review'])(
    'does not call %s an organisation view: it is not a view of all properties',
    (pathname) => {
      expect(isOrganisationView(pathname, null)).toBe(false)
    },
  )
})
