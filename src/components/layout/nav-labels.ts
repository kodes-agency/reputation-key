// The names of the places the manager sidebar lists. Breadcrumbs (`page-identity`)
// use the same words, so a trail never says "Settings" where the sidebar says
// "Property settings". Labels are sentence case.

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
  /** A Property's staff accounts and personal codes; the address stays /people. */
  staff: 'Staff',
  portals: 'Portals',
  goals: 'Goals',
  propertySettings: 'Property settings',
  /** The root of the account and Organization settings trail. */
  settings: 'Settings',
} as const

export type NavLabelKey = keyof typeof NAV_LABEL
