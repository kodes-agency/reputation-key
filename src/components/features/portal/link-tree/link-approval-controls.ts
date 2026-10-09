// What an account admin can do about a tile's address from the tile itself:
// approve it while it waits, or turn it off. The section builds the controls
// from the property's allowed sites and the portal's actions; the tile gets only
// the ones for the site it opens, so the link tree never touches the actions.

import { TURN_OFF_REASON } from '../portal-settings/destination-turn-off'
import type {
  PortalApprovedDestinationList,
  PortalExperienceActions,
} from '../portal-settings/portal-experience-settings-types'
import { siteForLink, type LinkSite } from './linktree-approval-rules'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'

/** The approval actions for the whole link tree. */
export type LinkApprovalControls = Readonly<{
  sites: PortalApprovedDestinationList['destinations']
  approve: (siteId: string) => Promise<unknown>
  turnOff: (siteId: string) => Promise<unknown>
  isBusy: boolean
}>

/** The approval actions for one tile: the site it opens, and what may be done to it. */
export type LinkSiteControls = Readonly<{
  hostname: string
  approve: () => Promise<unknown>
  turnOff: () => Promise<unknown>
  isBusy: boolean
}>

/**
 * The controls for the portal's link tree, or undefined for a viewer who may not
 * approve (a manager sees the state of an address and who to ask, not the buttons).
 */
export function linkApprovalControls(
  portalId: string,
  list: PortalApprovedDestinationList | undefined,
  actions: PortalExperienceActions | undefined,
  canEdit: boolean,
): LinkApprovalControls | undefined {
  if (!canEdit || list === undefined || actions === undefined || !list.canApprove) {
    return undefined
  }
  return {
    sites: list.destinations,
    approve: (destinationId) =>
      actions.approveDestination({ data: { portalId, destinationId } }),
    turnOff: (destinationId) =>
      actions.disableDestination({
        data: { portalId, destinationId, reason: TURN_OFF_REASON },
      }),
    isBusy: actions.approveDestination.isPending || actions.disableDestination.isPending,
  }
}

/** The controls for the one tile, or undefined when it opens no site the list knows. */
export function siteControlsFor(
  link: Pick<PortalLinktreeLink, 'url'>,
  controls: LinkApprovalControls | undefined,
): LinkSiteControls | undefined {
  if (controls === undefined) return undefined
  const site: LinkSite | null = siteForLink(link, controls.sites)
  if (site === null) return undefined
  return {
    hostname: site.hostname,
    approve: () => controls.approve(site.id),
    turnOff: () => controls.turnOff(site.id),
    isBusy: controls.isBusy,
  }
}
