// The names of the places the manager sidebar lists, in one place. The sidebar
// draws its rows from these and a breadcrumb names the same place by the same
// word (`page-identity`), so a trail never says "Settings" where the sidebar says
// "Property settings". A label is sentence case, and the destination a trail passes
// through is the place the person came from.

export const NAV_LABEL = {
  /** The Properties list, the page every Property trail starts at. */
  properties: 'Properties',
  /** The sidebar's Dashboard category, which opens the Overview. */
  dashboard: 'Dashboard',
  overview: 'Overview',
  ratings: 'Ratings',
  google: 'Google',
  guests: 'Guest voice',
  reviews: 'Reviews',
  /** A Property's Staff (profiles without a login); the address stays /people. */
  staff: 'Staff',
  portals: 'Portals',
  goals: 'Goals',
  propertySettings: 'Property settings',
  /** The root of the account and Organization settings trail. */
  settings: 'Settings',
} as const

export type NavLabelKey = keyof typeof NAV_LABEL
