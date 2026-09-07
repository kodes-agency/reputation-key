import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

export type PortalLifetimeMetricValues = Readonly<{
  qualifiedScanCount: number
  privateRatingCount: number
  privateRatingSum: number
  privateRating1Count: number
  privateRating2Count: number
  privateRating3Count: number
  privateRating4Count: number
  privateRating5Count: number
  privateFeedbackCount: number
  googleReviewSelectionCount: number
  secondaryLinkSelectionCount: number
}>

export type PortalLifetimeMetricAggregate = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  definitionVersionIds: Readonly<{
    qualifiedScans: string
    privateRatings: string
    privateFeedback: string
    destinationSelections: string
  }>
  values: PortalLifetimeMetricValues
  sealedThroughLocalDate: string | null
  projectionRevision: number
  lastRebuiltAt: Date | null
  lastSealedAt: Date | null
}>

export type PortalLifetimeMetricsPort = Readonly<{
  get(
    scope: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      portalId: PortalId
    }>,
  ): Promise<PortalLifetimeMetricAggregate | null>
}>
