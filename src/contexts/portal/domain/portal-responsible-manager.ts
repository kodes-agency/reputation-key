export type PortalResponsibleManager = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  portalId: string
  userId: string
  effectiveFrom: Date
  effectiveTo: Date | null
  createdBy: string
  endReason: string | null
}>
