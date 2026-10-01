// Where "All properties" is, for the section you are in. The app tile is the
// app's property context on every page, so choosing All properties from it
// keeps you in the same section when that section has a view over the whole
// Organization: Reviews opens the organization-wide Inbox and Portals the
// Portals of every Property. A section with no view of its own (Dashboard,
// People, Goals, ...) lands on the property list, where "all my properties"
// lives for everything else.

export type OrganisationViewPath = '/inbox' | '/portals' | '/properties'

export function organisationViewFor(activeSection: string): OrganisationViewPath {
  if (activeSection === 'inbox' || activeSection === 'reviews') return '/inbox'
  if (activeSection === 'portals') return '/portals'
  return '/properties'
}

const ORGANISATION_VIEW_PATHS: ReadonlySet<string> = new Set([
  '/inbox',
  '/portals',
  '/properties',
])

/**
 * Whether this location is a page over every Property: the tile then names the
 * Organization instead of prompting for a property. The import flow also has no
 * property in scope, but it is not a view of all properties, so it keeps the
 * prompt.
 */
export function isOrganisationView(pathname: string, propertyId: string | null): boolean {
  if (propertyId !== null) return false
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  return ORGANISATION_VIEW_PATHS.has(path)
}
