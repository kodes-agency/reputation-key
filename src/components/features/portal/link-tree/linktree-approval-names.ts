// The one name for each state an address can be in, wherever it is named: a
// tile's approval line and its marker, the pill in the list of sites allowed for
// links, and the sentences that explain them. One spelling and one casing, so an
// admin who meets a state in one place knows it in the next.
//
// Pure, so the tile (linktree-rules.ts) and the list
// (portal-settings/portal-approved-destination-status.ts) cannot drift apart.

import type { PortalLinktreeDestinationState } from '#/contexts/portal/application/public-api'

export const LINK_APPROVAL_NAMES: Readonly<
  Record<PortalLinktreeDestinationState, string>
> = {
  approved: 'Approved',
  pending: 'Waiting for approval',
  disabled: 'Turned off',
  quarantined: 'Held back for safety',
  unclassified: 'Not checked',
}
