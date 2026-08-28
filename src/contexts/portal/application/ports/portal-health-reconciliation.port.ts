export type PortalHealthReconciliationInput = Readonly<{
  eventId: string
  consumerName: string
  organizationId: string
  propertyId: string
  /** Null means every current Portal owned by the Property. */
  portalId: string | null
  sourceVersion: string
  occurredAt: Date
}>

export type PortalHealthReconciliationStore = Readonly<{
  reconcile: (
    input: PortalHealthReconciliationInput,
  ) => Promise<Readonly<{ status: 'applied' | 'duplicate'; changed: number }>>
}>
