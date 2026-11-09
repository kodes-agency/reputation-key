/** The editor needs only per-link counts from Reporting's authorized read. */
export type PortalLinkTapsRead = (input: {
  data: { propertyId: string; portalId: string }
}) => Promise<{ taps: Record<string, number> }>
