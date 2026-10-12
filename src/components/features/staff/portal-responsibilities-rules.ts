// The pure words and rules of the Portal responsibilities dialog: what primary
// and supporting do for the person (how ratings are credited, per ADR 0052 and
// the identity context), and when a supporting portal can be offered at all.

/**
 * What the two kinds mean, in terms of the effect: a guest's rating on a portal
 * is credited to the one person whose primary portal it is; supporting portals
 * record where the person also helps, and credit them with nothing. The last
 * sentence keeps the old reminder that this is not access.
 */
export function describeResponsibilities(displayName: string): string {
  return `Ratings guests leave on the primary portal are credited to ${displayName}. Supporting portals are other portals they help with: their ratings are not credited to ${displayName}. This does not give access to the property.`
}

/** A supporting portal is a portal besides the primary one, so one portal has none to offer. */
export function offersSupportingPortals(portalCount: number): boolean {
  return portalCount > 1
}
