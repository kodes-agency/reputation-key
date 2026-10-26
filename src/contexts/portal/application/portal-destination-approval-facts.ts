// Portal context — what a notice about a site waiting for approval needs.
//
// A site allowed for links belongs to its Property, so the account admin who
// decides it is sent to a Portal's Linktree. Feed asks here which Portal, and
// whether the site is still waiting, rather than reading Portal tables.

import type {
  OrganizationId,
  PortalApprovedDestinationId,
  PortalId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type { PortalApprovedDestinationState } from '../domain/approved-destination'

/** A Portal the site is decided on. */
export type PortalDestinationApprovalPortal = Readonly<{
  id: PortalId
  name: string
}>

export type PortalDestinationApprovalFacts = Readonly<{
  propertyId: PropertyId
  /** The site's host, never its full address. */
  hostname: string
  approvalState: PortalApprovedDestinationState
  /** Who asked for the site first. */
  requestedBy: UserId
  /**
   * The Portal to open to decide it: the earliest live Portal whose links open
   * the site, else the Property's earliest live Portal (the site was asked for
   * from a tile that was refused, so no link opens it yet). Null when the
   * Property has no live Portal left.
   */
  portal: PortalDestinationApprovalPortal | null
  /** How many other live Portals' links open the site. */
  otherPortalCount: number
}>

/**
 * The site's current state and the Portal to decide it on; null when the site
 * is gone or belongs to another Organization.
 */
export type FindDestinationApprovalFacts = (
  organizationId: OrganizationId,
  destinationId: PortalApprovedDestinationId,
) => Promise<PortalDestinationApprovalFacts | null>
