/** The editor needs only per-link counts from Reporting's authorized read. */
export type PortalLinkTapsRead = (input: {
  data: { propertyId: string; portalId: string }
}) => Promise<{ taps: Record<string, number> }>

/**
 * Whether the settings screen may offer the contact-request switch. `launched`:
 * contact requests are switched on for the deployment. `noticeInForce`: a Privacy
 * Notice version covering them is in force, so a publication can carry the
 * setting. The control is absent unless `launched`.
 */
export type ContactRequestsLaunch = Readonly<{
  launched: boolean
  noticeInForce: boolean
}>
