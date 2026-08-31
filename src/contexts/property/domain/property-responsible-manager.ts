export type PropertyResponsibleManager = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  userId: string
  effectiveFrom: Date
  effectiveTo: Date | null
  createdBy: string
  endReason: string | null
}>
