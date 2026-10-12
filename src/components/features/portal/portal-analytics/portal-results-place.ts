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
  /** The reader may open the Inbox, where the private notes are read and answered. */
  canOpenInbox: boolean
}>
