// Where "All properties" is, for the section you are in: Reviews and Portals have
// organization-wide views; any other section lands on the property list.

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
 * Whether this location is a page over every Property, so the tile names the
 * Organization. The import flow has no property in scope but keeps the prompt.
 */
export function isOrganisationView(pathname: string, propertyId: string | null): boolean {
  if (propertyId !== null) return false
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  return ORGANISATION_VIEW_PATHS.has(path)
}
