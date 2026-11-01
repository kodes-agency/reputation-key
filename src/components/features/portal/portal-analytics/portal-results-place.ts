import { buttonVariants } from '#/components/ui/button'
import type { PortalPublicationState } from '../shared/types'
/**
 * Where a portal's Results tab is: what its empty states and its Private notes
 * figure link to. Absent where the figures are drawn without a portal around
 * them; the figures then simply carry no links.
 */
export type PortalResultsPlace = Readonly<{
  propertyId: string
  portalId: string
  /** Guests can open it now. A portal that is not live has no results to wait for. */
  isLive: boolean
  skipPrivateRating?: boolean
  publicationState?: PortalPublicationState
  /**
   * The live code's scans are counted. False for a code that predates scan
   * counting: its scans are a dash with the reason, as in the Portals overview.
   */
  scansCounted: boolean
  /** The reader may open the Inbox, where the private notes are read and answered. */
  canOpenInbox: boolean
}>

/** A link under a card's evidence: a tap target on a phone, its line's height on a desktop. */
export const RESULTS_LINK_CLASS = buttonVariants({
  variant: 'link',
  size: 'inline',
  touch: true,
})
