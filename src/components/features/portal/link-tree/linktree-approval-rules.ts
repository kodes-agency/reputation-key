// The pure rules for what a tile says about the approval of the place it opens:
// the line under its address, the marker on its collapsed row, how many tiles
// guests cannot see, and which allowed site a tile opens (to approve or turn it
// off from the tile). The names come from linktree-approval-names.ts.

import type {
  PortalLinktreeDestination,
  PortalLinktreeLink,
} from '#/contexts/portal/application/public-api'
import { LINK_APPROVAL_NAMES } from './linktree-approval-names'

export type LinkApprovalFact = Readonly<{ tone: 'ok' | 'warn'; text: string }>

type ApprovalViewer = Readonly<{
  /** The viewer can approve addresses: the line then says "you", and offers the action. */
  canApprove?: boolean
}>

/** The one line under a tile's address: who vouched for it, or why guests cannot see it yet. */
export function describeLinkApproval(
  destination: PortalLinktreeDestination,
  names: ReadonlyMap<string, string>,
  viewer: ApprovalViewer = {},
): LinkApprovalFact {
  const name = LINK_APPROVAL_NAMES[destination.state]
  switch (destination.state) {
    case 'approved': {
      if (
        destination.sourceType === 'recognized' ||
        destination.sourceType === 'provider'
      ) {
        return { tone: 'ok', text: `${name} · recognised service` }
      }
      const approver =
        destination.approvedByUserId === null
          ? undefined
          : names.get(destination.approvedByUserId)
      return { tone: 'ok', text: approver === undefined ? name : `${name} · ${approver}` }
    }
    case 'pending':
      return {
        tone: 'warn',
        text: `${name} · guests will not see this link until ${viewer.canApprove === true ? 'you approve it' : 'an account admin approves it'}`,
      }
    case 'disabled':
      return {
        tone: 'warn',
        text: `${name} · an account admin turned this address off, so guests do not see this link`,
      }
    case 'quarantined':
      return {
        tone: 'warn',
        text: `${name} · this address did not pass a safety check, so guests do not see this link`,
      }
    case 'unclassified':
      return {
        tone: 'warn',
        text: `${name} · guests will not see this link until its address is checked`,
      }
  }
}

/**
 * What a collapsed tile says when guests cannot see it: "Hidden from guests ·
 * waiting for approval". Null for an approved tile, which stays quiet.
 */
export function describeHiddenFromGuests(
  destination: PortalLinktreeDestination,
): string | null {
  if (destination.state === 'approved') return null
  return `Hidden from guests · ${LINK_APPROVAL_NAMES[destination.state].toLowerCase()}`
}

/** How many tiles guests cannot see because their address is not approved. */
export function countHiddenLinks(
  links: ReadonlyArray<Pick<PortalLinktreeLink, 'destination'>>,
): number {
  return links.filter((link) => link.destination.state !== 'approved').length
}

/** What the tile needs to know of a site allowed for links. */
export type LinkSite = Readonly<{
  id: string
  hostname: string
  normalizedUri: string
}>

/**
 * The allowed site a tile opens, or null when it opens none the list knows (a
 * link from before approvals has no site). A tile's address is saved in the
 * site's normalised form, so the two are equal.
 */
export function siteForLink<Site extends LinkSite>(
  link: Pick<PortalLinktreeLink, 'url'>,
  sites: ReadonlyArray<Site>,
): Site | null {
  return sites.find((site) => site.normalizedUri === link.url) ?? null
}
